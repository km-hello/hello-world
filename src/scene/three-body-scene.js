import {
    ACESFilmicToneMapping,
    Color,
    PerspectiveCamera,
    Scene,
    SRGBColorSpace,
    WebGLRenderer,
} from "three";
import { PointerOrbitControls } from "./pointer-orbit-controls.js";

import { createVisualSystem } from "../simulation/physics.js";
import { BodyVisuals } from "./body-visuals.js";
import { ParticleMonument } from "./particle-monument.js";
import { getPositionScale, getGlowScale } from "./viewport.js";

const FIXED_TIME_STEP = 1 / 480;
const MAX_FRAME_DELTA = 0.05;
const MAX_SUBSTEPS = 24;
const CAMERA_DISTANCE = 6;
const POSITION_DISPLAY_GAIN = 1.5;
const CAMERA_FOV = 42;
const CAMERA_NEAR_DISTANCE = 0.05;

export class ThreeBodyScene {
    constructor(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("ThreeBodyScene requires a canvas element.");
        }

        this.canvas = canvas;
        this.renderer = new WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
            precision: "highp",
        });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1;

        this.scene = new Scene();
        this.scene.background = new Color(0x000000);
        this.camera = new PerspectiveCamera(
            CAMERA_FOV,
            1,
            CAMERA_NEAR_DISTANCE,
            60,
        );
        this.camera.position.set(0, 0, CAMERA_DISTANCE);
        this.camera.lookAt(0, 0, 0);
        this.cameraSwayEnabled = true;
        this.cameraSwayTime = 0;

        this.controls = new PointerOrbitControls(this.camera, canvas);

        this.system = createVisualSystem();
        this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.bodyVisuals = null;
        this.monument = new ParticleMonument(this.scene);

        this.positionWorldScale = 0;
        this.glowWorldDiameter = 1;
        this.resizePending = true;

        this.accumulator = 0;
        this.lastTimestamp = 0;
        this.animationFrameId = null;
        this.sceneOpacity = 1;
        this.starting = false;
        this.started = false;
        this.destroyed = false;
        this.manuallyPaused = false;
        this.pageSuspended = false;
        this.contextLost = false;

        this._onAnimationFrame = this._onAnimationFrame.bind(this);
        this._onPageHide = this._onPageHide.bind(this);
        this._onPageShow = this._onPageShow.bind(this);
        this._syncAnimationState = this._syncAnimationState.bind(this);
        this._requestResize = this._requestResize.bind(this);
        this._onContextLost = this._onContextLost.bind(this);
        this._onContextRestored = this._onContextRestored.bind(this);
        this._onControlsChange = this._onControlsChange.bind(this);
        this._onControlsStart = this._onControlsStart.bind(this);

        this.controls.addEventListener("change", this._onControlsChange);
        this.controls.addEventListener("start", this._onControlsStart);

        document.addEventListener("visibilitychange", this._syncAnimationState);
        window.addEventListener("pagehide", this._onPageHide);
        window.addEventListener("pageshow", this._onPageShow);
        this.motionPreference.addEventListener("change", this._syncAnimationState);
        this.canvas.addEventListener("webglcontextlost", this._onContextLost);
        this.canvas.addEventListener("webglcontextrestored", this._onContextRestored);

        if ("ResizeObserver" in window) {
            this.resizeObserver = new ResizeObserver(this._requestResize);
            this.resizeObserver.observe(document.documentElement);
        } else {
            this.resizeObserver = null;
            window.addEventListener("resize", this._requestResize, { passive: true });
        }
    }

    async start() {
        if (this.destroyed || this.started || this.starting) {
            return;
        }

        this.starting = true;

        try {
            this._resize();
            this.bodyVisuals = new BodyVisuals(this.scene, CAMERA_DISTANCE, this.camera);
            this.bodyVisuals.resize(
                this.positionWorldScale,
                this.glowWorldDiameter,
            );
            const monumentCreated = await this.monument.create();

            if (!monumentCreated || this.destroyed) {
                return;
            }

            this.bodyVisuals.resetTrails(this.system.positions);
            this.bodyVisuals.updateBodies(this.system.positions);
            this.monument.update(this.bodyVisuals);
            this._render();

            this.started = true;
            this.canvas.dataset.renderingMode = "webgl-particles";
            document.body.classList.add("scene-ready");
            this._syncAnimationState();
        } finally {
            this.starting = false;
        }
    }

    pause() {
        this.manuallyPaused = true;
        this._syncAnimationState();
    }

    resume() {
        this.manuallyPaused = false;
        this._syncAnimationState();
    }

    destroy() {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.started = false;
        this._cancelAnimationFrame();

        this.controls.enabled = false;
        this.controls.removeEventListener("change", this._onControlsChange);
        this.controls.removeEventListener("start", this._onControlsStart);
        this.controls.dispose();

        document.removeEventListener("visibilitychange", this._syncAnimationState);
        window.removeEventListener("pagehide", this._onPageHide);
        window.removeEventListener("pageshow", this._onPageShow);
        window.removeEventListener("resize", this._requestResize);
        this.motionPreference.removeEventListener("change", this._syncAnimationState);
        this.canvas.removeEventListener("webglcontextlost", this._onContextLost);
        this.canvas.removeEventListener("webglcontextrestored", this._onContextRestored);

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this.bodyVisuals?.dispose();
        this.monument.dispose();
        this.scene.clear();
        this.bodyVisuals = null;
        this.renderer.dispose();
        if (this.renderer.extensions.has("WEBGL_lose_context")) {
            this.renderer.forceContextLoss();
        }
        this.canvas.dataset.simulationState = "destroyed";
    }

    _requestResize() {
        if (this.destroyed) {
            return;
        }

        this.resizePending = true;

        if (this.animationFrameId === null && this.started && !this.contextLost) {
            this._resize();
            this.bodyVisuals.updateBodies(this.system.positions);
            this.monument.update(this.bodyVisuals);
            this._render();
        }
    }

    _resize() {
        const width = Math.max(
            1,
            document.documentElement.clientWidth || window.innerWidth,
        );
        const height = Math.max(
            1,
            window.innerHeight || document.documentElement.clientHeight,
        );
        const devicePixelRatio = window.devicePixelRatio || 1;
        const isConstrained =
            width < 720
            || (Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4);
        const maximumPixelRatio = isConstrained ? 1.2 : 1.5;
        const pixelRatio = Math.min(devicePixelRatio, maximumPixelRatio);
        const verticalWorldSpan =
            2
            * Math.tan((CAMERA_FOV * Math.PI) / 360)
            * CAMERA_DISTANCE;

        const pixelsPerWorldUnit = height / verticalWorldSpan;
        const glowScale = getGlowScale(width, height);
        this.glowWorldDiameter =
            (glowScale * 1.1) / pixelsPerWorldUnit;
        this.resizePending = false;

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.positionWorldScale =
            getPositionScale(width, height) * POSITION_DISPLAY_GAIN / pixelsPerWorldUnit;
        this.bodyVisuals?.resize(this.positionWorldScale, this.glowWorldDiameter);
        this.monument.resize(
            width,
            pixelsPerWorldUnit,
            pixelRatio,
        );
    }

    _syncAnimationState() {
        if (this.destroyed) return;

        this.controls.enabled =
            this.started
            && !this.contextLost
            && !this.pageSuspended
            && !document.hidden;

        const shouldAnimate =
            this.started
            && !this.contextLost
            && !this.manuallyPaused
            && !this.pageSuspended
            && !document.hidden
            && !this.motionPreference.matches;

        if (shouldAnimate) {
            this.canvas.dataset.simulationState = "running";

            if (this.animationFrameId === null) {
                this.lastTimestamp = 0;
                this.accumulator = 0;
                this.animationFrameId = requestAnimationFrame(this._onAnimationFrame);
            }
            return;
        }

        this._cancelAnimationFrame();

        if (this.contextLost) {
            this.canvas.dataset.simulationState = "context-lost";
            return;
        }

        if (this.motionPreference.matches) {
            this.canvas.dataset.simulationState = "reduced-motion";
        } else {
            this.canvas.dataset.simulationState = "paused";
        }

        if (!document.hidden && !this.pageSuspended && this.started) {
            if (this.resizePending) this._resize();
            this.bodyVisuals.updateBodies(this.system.positions);
            this.monument.update(this.bodyVisuals);
            this._render();
        }
    }

    _cancelAnimationFrame() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.lastTimestamp = 0;
        this.accumulator = 0;
        this.bodyVisuals?.resetTrailSampling();
    }

    _onAnimationFrame(timestamp) {
        this.animationFrameId = null;

        if (
            this.destroyed
            || this.contextLost
            || !this.started
            || this.manuallyPaused
            || this.pageSuspended
            || document.hidden
            || this.motionPreference.matches
        ) {
            this._syncAnimationState();
            return;
        }

        if (this.resizePending) {
            this._resize();
        }

        let frameDelta = 0;

        if (this.lastTimestamp > 0) {
            frameDelta = Math.min(
                (timestamp - this.lastTimestamp) / 1000,
                MAX_FRAME_DELTA,
            );
        }

        this.lastTimestamp = timestamp;
        this.accumulator += frameDelta;

        let substeps = 0;
        let stateIsSafe = true;

        while (this.accumulator >= FIXED_TIME_STEP && substeps < MAX_SUBSTEPS) {
            stateIsSafe = this.system.step(FIXED_TIME_STEP) && stateIsSafe;
            this.accumulator -= FIXED_TIME_STEP;
            substeps += 1;
        }

        if (substeps === MAX_SUBSTEPS && this.accumulator >= FIXED_TIME_STEP) {
            this.accumulator = 0;
        }

        if (!stateIsSafe) {
            this.sceneOpacity = 0;
            this.bodyVisuals.resetTrails(this.system.positions);
        }

        this._advanceResetTransition(frameDelta);
        this._advanceCameraSway(frameDelta);
        this.bodyVisuals.updateTrails(frameDelta, this.system.positions);
        this.bodyVisuals.updateBodies(this.system.positions);
        this.monument.update(this.bodyVisuals, frameDelta);
        this._render();
        this.animationFrameId = requestAnimationFrame(this._onAnimationFrame);
    }

    _advanceCameraSway(frameDelta) {
        if (!this.cameraSwayEnabled || frameDelta <= 0) return;

        this.cameraSwayTime += frameDelta;
        const azimuth = Math.sin(this.cameraSwayTime * Math.PI * 2 / 24) * Math.PI / 30;
        const elevation = Math.sin(this.cameraSwayTime * Math.PI * 2 / 32) * Math.PI / 60;
        this.camera.position.setFromSphericalCoords(
            CAMERA_DISTANCE,
            Math.PI / 2 - elevation,
            azimuth,
        );
        this.camera.lookAt(0, 0, 0);
    }

    _advanceResetTransition(frameDelta) {
        if (this.sceneOpacity === 1) {
            return;
        }

        this.sceneOpacity = Math.min(1, this.sceneOpacity + frameDelta / 0.45);

        this.canvas.style.opacity = String(this.sceneOpacity);
    }

    _render() {
        if (this.contextLost || this.destroyed) return;
        this.renderer.render(this.scene, this.camera);
    }

    _onControlsStart() {
        this.cameraSwayEnabled = false;
    }

    _onControlsChange() {
        if (
            !this.started
            || this.destroyed
            || this.pageSuspended
            || document.hidden
            || this.animationFrameId !== null
            || this.renderer.getContext().isContextLost()
        ) {
            return;
        }

        this.bodyVisuals.updateTrails(0, this.system.positions);
        this.bodyVisuals.updateBodies(this.system.positions);
        this._render();
    }

    _onPageHide(event) {
        if (event.persisted) {
            this.pageSuspended = true;
            this._syncAnimationState();
        } else {
            this.destroy();
        }
    }

    _onPageShow() {
        this.pageSuspended = false;
        this._syncAnimationState();
    }

    _onContextLost(event) {
        event.preventDefault();
        if (this.destroyed) return;
        this.contextLost = true;
        this._syncAnimationState();
    }

    _onContextRestored() {
        if (this.destroyed) return;
        this.contextLost = false;
        this.resizePending = true;
        this._syncAnimationState();
    }
}
