import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "three";
import { MirrorMonumentScene } from "../src/scene/mirror-monument-scene.js";
import { GRAVITY_PHYSICS_CONFIG, ThreeBodySystem } from "../src/simulation/physics.js";

test("escaping bodies keep moving without reframing; resize depends only on viewport", () => {
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    globalThis.document = { hidden: false, documentElement: { clientWidth: 1280 } };
    globalThis.window = { innerHeight: 720, devicePixelRatio: 1 };
    globalThis.requestAnimationFrame = () => 1;
    try {
        const scene = Object.create(MirrorMonumentScene.prototype);
        scene.system = new ThreeBodySystem(GRAVITY_PHYSICS_CONFIG);
        scene.system.setState([0, 0, 0, 1, 0, 0, 100, 0, 0], [0, 0, 0, 0, 0, 0, 8, 0, 0]);
        scene.camera = new PerspectiveCamera(42, 1, 0.05, 60);
        scene.renderer = { setPixelRatio() {}, setSize() {} };
        scene.monument = { resize() {}, updateReflection() {} };
        let resizeCount = 0;
        let displayedX;
        scene.bodyVisuals = {
            resize(scale) { this.scale = scale; resizeCount += 1; },
            updateTrails() {},
            updateBodies(positions) { displayedX = positions[6] * this.scale; },
        };
        scene.started = true;
        scene.motionPreference = { matches: false };
        scene.accumulator = 0;
        scene.lastTimestamp = 1000;
        scene.transitionPhase = 0;
        scene._render = () => {};
        scene._resize();
        const initialScale = scene.positionWorldScale;
        const initialX = scene.system.positions[6] * initialScale;
        for (let frame = 1; frame <= 100; frame += 1) {
            scene._onAnimationFrame(1000 + frame * 50);
        }
        assert.equal(resizeCount, 1);
        assert.equal(scene.positionWorldScale, initialScale);
        assert.ok(displayedX > initialX + 30 * initialScale);
        assert.equal(scene.system.resetCount, 1);
        scene._resize();
        assert.equal(scene.positionWorldScale, initialScale);
        document.documentElement.clientWidth = 390;
        window.innerHeight = 844;
        scene._resize();
        assert.ok(scene.positionWorldScale < initialScale);
        assert.equal(scene.system.resetCount, 1);
    } finally {
        for (const key of ["document", "window", "requestAnimationFrame"]) {
            if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
            else delete globalThis[key];
        }
    }
});
