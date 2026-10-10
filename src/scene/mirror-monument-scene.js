import {
    ACESFilmicToneMapping,
    Color,
    PerspectiveCamera,
    Scene,
    SRGBColorSpace,
    WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { createVisualSystem } from "../simulation/physics.js";
import { BodyVisuals } from "./body-visuals.js";
import { MirrorMonument } from "./mirror-monument.js";
import { getPositionScale, getGlowScale } from "./viewport.js";

const FIXED_TIME_STEP = 1 / 480;
const MAX_FRAME_DELTA = 0.05;
const MAX_SUBSTEPS = 24;
const CAMERA_DISTANCE = 6;
const POSITION_DISPLAY_GAIN = 1.5;
const CAMERA_FOV = 42;
const CAMERA_NEAR_DISTANCE = 0.05;

export class MirrorMonumentScene {
    constructor(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("MirrorMonumentScene requires a canvas element.");
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
        this.renderer.setClearColor(0x000000, 1);

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

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enabled = false;
        this.controls.enableZoom = false;
        this.controls.enablePan = false;
        this.controls.mouseButtons.MIDDLE = null;
        this.controls.mouseButtons.RIGHT = null;
        this.controls.cursorStyle = "grab";
        this.controls.listenToKeyEvents(canvas);

        this.system = createVisualSystem();
        this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.bodyVisuals = null;
        this.monument = new MirrorMonument(this.scene, this.renderer);

        this.cssWidth = 0;
        this.cssHeight = 0;
        this.pixelRatio = 1;
        this.pixelsPerWorldUnit = 1;
        this.positionWorldScale = 0;
        this.glowWorldDiameter = 1;
        this.glowScale = 1;
        this.resizePending = true;

        this.accumulator = 0;
        this.lastTimestamp = 0;
        this.animationFrameId = null;
        this.sceneOpacity = 1;
        this.transitionPhase = 0;
        this.starting = false;
        this.started = false;
        this.destroyed = false;
        this.manuallyPaused = false;
        this.pageSuspended = false;

        this._onAnimationFrame = this._onAnimationFrame.bind(this);
        this._onVisibilityChange = this._onVisibilityChange.bind(this);
        this._onPageHide = this._onPageHide.bind(this);
        this._onPageShow = this._onPageShow.bind(this);
        this._onMotionPreferenceChange = this._onMotionPreferenceChange.bind(this);
        this._onFallbackResize = this._onFallbackResize.bind(this);
        this._onContextLost = this._onContextLost.bind(this);
        this._onControlsChange = this._onControlsChange.bind(this);

        this.controls.addEventListener("change", this._onControlsChange);

        document.addEventListener("visibilitychange", this._onVisibilityChange);
        window.addEventListener("pagehide", this._onPageHide);
        window.addEventListener("pageshow", this._onPageShow);
        this.motionPreference.addEventListener("change", this._onMotionPreferenceChange);
        this.canvas.addEventListener("webglcontextlost", this._onContextLost);

        if ("ResizeObserver" in window) {
            this.resizeObserver = new ResizeObserver(() => {
                this._requestResize();
            });
            this.resizeObserver.observe(document.documentElement);
        } else {
            this.resizeObserver = null;
            window.addEventListener("resize", this._onFallbackResize, { passive: true });
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
            this.bodyVisuals.updateBodies(
                this.system.positions,
                this.monument.reflectionProbePosition,
            );
            this.monument.updateReflection(this.bodyVisuals, true);
            this._render();

            this.started = true;
            this.canvas.dataset.renderingMode = "webgl-mirror";
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
        this.controls.dispose();
        this.controls.cursorStyle = "auto";

        document.removeEventListener("visibilitychange", this._onVisibilityChange);
        window.removeEventListener("pagehide", this._onPageHide);
        window.removeEventListener("pageshow", this._onPageShow);
        window.removeEventListener("resize", this._onFallbackResize);
        this.motionPreference.removeEventListener("change", this._onMotionPreferenceChange);
        this.canvas.removeEventListener("webglcontextlost", this._onContextLost);

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

        if (this.animationFrameId === null && this.started) {
            this._resize();
            this.bodyVisuals.updateBodies(
                this.system.positions,
                this.monument.reflectionProbePosition,
            );
            this.monument.updateReflection(this.bodyVisuals, true);
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

        this.cssWidth = width;
        this.cssHeight = height;
        this.pixelRatio = pixelRatio;
        this.pixelsPerWorldUnit = height / verticalWorldSpan;
        this.glowScale = getGlowScale(width, height);
        this.glowWorldDiameter =
            (this.glowScale * 1.1) / this.pixelsPerWorldUnit;
        this.resizePending = false;

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.positionWorldScale =
            getPositionScale(width, height) * POSITION_DISPLAY_GAIN / this.pixelsPerWorldUnit;
        this.bodyVisuals?.resize(this.positionWorldScale, this.glowWorldDiameter);
        this.monument.resize(
            width,
            this.pixelsPerWorldUnit,
            isConstrained,
        );
    }

    _syncAnimationState() {
        this.controls.enabled =
            this.started
            && !this.destroyed
            && !this.pageSuspended
            && !document.hidden;

        const shouldAnimate =
            this.started
            && !this.destroyed
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

        if (this.motionPreference.matches) {
            this.canvas.dataset.simulationState = "reduced-motion";
        } else if (!this.destroyed) {
            this.canvas.dataset.simulationState = "paused";
        }

        if (!document.hidden && !this.pageSuspended && this.started) {
            this.bodyVisuals.updateBodies(
                this.system.positions,
                this.monument.reflectionProbePosition,
            );
            this.monument.updateReflection(this.bodyVisuals, true);
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
            this.transitionPhase = 2;
            this.bodyVisuals.resetTrails(this.system.positions);
        }

        this._advanceResetTransition(frameDelta);
        this.bodyVisuals.updateTrails(frameDelta, this.system.positions);
        this.bodyVisuals.updateBodies(
            this.system.positions,
            this.monument.reflectionProbePosition,
        );
        this.monument.updateReflection(this.bodyVisuals);
        this._render();
        this.animationFrameId = requestAnimationFrame(this._onAnimationFrame);
    }

    _advanceResetTransition(frameDelta) {
        if (this.transitionPhase === 0) {
            return;
        }

        this.sceneOpacity = Math.min(1, this.sceneOpacity + frameDelta / 0.45);
        if (this.sceneOpacity === 1) {
            this.transitionPhase = 0;
        }

        this.canvas.style.opacity = String(this.sceneOpacity);
    }

    _render() {
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
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

        this.bodyVisuals.updateBodies(
            this.system.positions,
            this.monument.reflectionProbePosition,
        );
        this._render();
    }

    _onVisibilityChange() {
        this._syncAnimationState();
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

    _onMotionPreferenceChange() {
        this._syncAnimationState();
    }

    _onFallbackResize() {
        this._requestResize();
    }

    _onContextLost(event) {
        event.preventDefault();
        this.pause();
        this.canvas.dataset.simulationState = "context-lost";
    }
}
