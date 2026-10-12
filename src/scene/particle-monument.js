import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DynamicDrawUsage,
    Matrix3,
    Mesh,
    Points,
    ShaderMaterial,
    Vector3,
} from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, FontLoader } from "three/addons/loaders/FontLoader.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { ParticleMotion } from "./particle-motion.js";

const PARTICLE_COUNT = 3600;

export class ParticleMonument {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.motion = null;
        this.localWidth = 1;
        this.cssWidth = 0;
        this.pixelsPerWorldUnit = 1;
        this.pixelRatio = 1;
        this.disposed = false;
        this.starPositions = Array.from({ length: 3 }, () => new Vector3(1000, 1000, 1000));
        this.starVelocities = Array.from({ length: 3 }, () => new Vector3());
        this.worldToLocalVelocity = new Matrix3();
        this.starColors = Array.from({ length: 3 }, () => new Color(0));
    }

    resize(cssWidth, pixelsPerWorldUnit, pixelRatio = 1) {
        this.cssWidth = cssWidth;
        this.pixelsPerWorldUnit = pixelsPerWorldUnit;
        this.pixelRatio = pixelRatio;
        this._resizeMesh();
    }

    async create() {
        const font = await new FontLoader().loadAsync(new URL(
            "../assets/helvetiker_regular.typeface.json", import.meta.url,
        ).href);
        if (this.disposed) return false;
        const spacedFont = new Font({
            ...font.data,
            glyphs: Object.fromEntries(Object.entries(font.data.glyphs).map(([character, glyph]) => [
                character, { ...glyph, ha: glyph.ha + font.data.resolution * 0.24 },
            ])),
        });
        const surface = new TextGeometry("HELLO WORLD !", {
            font: spacedFont,
            size: 1,
            depth: 0.04,
            curveSegments: 8,
            bevelEnabled: false,
        });
        surface.scale(1, 1.18, 1);
        surface.center();
        surface.computeBoundingBox();
        this.localWidth = surface.boundingBox.max.x - surface.boundingBox.min.x;
        const sampleMesh = new Mesh(surface);
        const sampler = new MeshSurfaceSampler(sampleMesh).build();
        const point = new Vector3();
        const restPositions = new Float32Array(PARTICLE_COUNT * 3);
        const seeds = new Float32Array(PARTICLE_COUNT);
        for (let index = 0; index < PARTICLE_COUNT; index += 1) {
            sampler.sample(point);
            seeds[index] = Math.random();
            // Dimmer particles form a diffuse halo around the legible core.
            const spread = 0.12 + 0.65 * (1 - seeds[index]) ** 6;
            point.x += (Math.random() - 0.5) * spread;
            point.y += (Math.random() - 0.5) * spread * 1.4;
            point.z += (Math.random() - 0.5) * (0.5 + spread);
            point.toArray(restPositions, index * 3);
        }
        surface.dispose();
        sampleMesh.material.dispose();
        this.motion = new ParticleMotion(restPositions);
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(this.motion.positions, 3).setUsage(DynamicDrawUsage));
        geometry.setAttribute("activity", new BufferAttribute(this.motion.activity, 1).setUsage(DynamicDrawUsage));
        geometry.setAttribute("seed", new BufferAttribute(seeds, 1));
        const material = new ShaderMaterial({
            uniforms: {
                pixelRatio: { value: this.pixelRatio },
                starPositions: { value: this.starPositions },
                starColors: { value: this.starColors },
            },
            vertexShader: `
                attribute float activity;
                attribute float seed;
                uniform float pixelRatio;
                uniform vec3 starPositions[3];
                uniform vec3 starColors[3];
                varying float vActivity;
                varying float vSeed;
                varying vec3 vStarlight;
                varying float vIllumination;
                void main() {
                    vActivity = activity;
                    vSeed = seed;
                    vStarlight = vec3(0.0);
                    vIllumination = 0.0;
                    for (int star = 0; star < 3; star++) {
                        float light = 1.0 - smoothstep(0.0, 3.5, distance(position, starPositions[star]));
                        vStarlight += starColors[star] * light;
                        vIllumination += light;
                    }
                    vStarlight /= max(vIllumination, 0.001);
                    vIllumination = min(vIllumination, 1.0);
                    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * viewPosition;
                    gl_PointSize = clamp((1.7 + seed * 1.1 + activity * 1.4)
                        * pixelRatio * 6.0 / max(0.1, -viewPosition.z), 1.0, 8.0 * pixelRatio);
                }
            `,
            fragmentShader: `
                varying float vActivity;
                varying float vSeed;
                varying vec3 vStarlight;
                varying float vIllumination;
                void main() {
                    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
                    if (radius > 1.0) discard;
                    float glow = exp(-radius * radius * 3.5);
                    vec3 color = mix(vec3(0.17, 0.30, 0.38), vec3(0.29, 0.24, 0.43), vSeed);
                    color = mix(color, vStarlight, vIllumination * 0.8);
                    color += vec3(0.12, 0.14, 0.16) * vActivity;
                    float opacity = mix(0.18, 0.58, smoothstep(0.0, 0.65, vSeed));
                    gl_FragColor = vec4(color, glow * (opacity + 0.22 * vIllumination + 0.26 * vActivity));
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        });
        this.mesh = new Points(geometry, material);
        this.mesh.rotation.set(-0.11, -0.14, 0);
        // Displacement extends beyond the sampled glyph bounds.
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
        this._resizeMesh();
        return true;
    }

    update(bodyVisuals, frameDelta = 0, bodyVelocities) {
        if (!this.mesh || !bodyVisuals) return;
        this.mesh.updateMatrixWorld();
        for (let body = 0; body < 3; body += 1) {
            this.starPositions[body].copy(bodyVisuals.visuals[body].group.position);
            this.mesh.worldToLocal(this.starPositions[body]);
            this.starColors[body].copy(bodyVisuals.visuals[body].color);
        }
        if (frameDelta <= 0) return;
        // Transform velocity without translation, preserving local distance per second.
        this.worldToLocalVelocity.setFromMatrix4(this.mesh.matrixWorld).invert();
        for (let body = 0; body < 3; body += 1) {
            this.starVelocities[body].fromArray(bodyVelocities, body * 3)
                .multiplyScalar(bodyVisuals.positionWorldScale)
                .applyMatrix3(this.worldToLocalVelocity);
        }
        this.motion.update(this.starPositions, this.starVelocities, frameDelta, 2.0);
        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.attributes.activity.needsUpdate = true;
    }

    _resizeMesh() {
        if (!this.mesh || this.cssWidth <= 0) return;
        const widthRatio = this.cssWidth < 600 ? 0.92 : 0.8;
        const scale = Math.min(this.cssWidth * widthRatio, 1280)
            / this.pixelsPerWorldUnit / this.localWidth;
        this.mesh.scale.setScalar(scale);
        this.mesh.material.uniforms.pixelRatio.value = this.pixelRatio;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
        this.mesh = null;
        this.motion = null;
    }
}
