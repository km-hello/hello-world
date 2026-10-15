import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "three";
import { ThreeBodyScene } from "../src/scene/three-body-scene.js";
import { GRAVITY_PHYSICS_CONFIG, ThreeBodySystem } from "../src/simulation/physics.js";

test("escaping bodies keep moving without reframing; resize depends only on viewport", () => {
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    globalThis.document = { hidden: false, documentElement: { clientWidth: 1280 } };
    globalThis.window = { innerHeight: 720, devicePixelRatio: 1 };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "0" });
    try {
        const scene = Object.create(ThreeBodyScene.prototype);
        scene.controls = {};
        scene.canvas = { clientWidth: 1280, clientHeight: 720 };
        scene.system = new ThreeBodySystem(GRAVITY_PHYSICS_CONFIG);
        scene.system.setState([0, 0, 0, 1, 0, 0, 100, 0, 0], [0, 0, 0, 0, 0, 0, 8, 0, 0]);
        scene.camera = new PerspectiveCamera(42, 1, 0.05, 60);
        scene.camera.position.set(0, 0, 6);
        scene.cameraSwayEnabled = true;
        scene.cameraSwayTime = 0;
        scene.renderer = { setPixelRatio() {}, setSize() {} };
        scene.monument = { resize() {}, update() {} };
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
        scene.sceneOpacity = 1;
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
        scene.canvas.clientWidth = 390;
        scene.canvas.clientHeight = 844;
        scene._resize();
        assert.ok(scene.positionWorldScale < initialScale);
        assert.equal(scene.system.resetCount, 1);
    } finally {
        for (const key of ["document", "window", "requestAnimationFrame", "getComputedStyle"]) {
            if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
            else delete globalThis[key];
        }
    }
});

test("canvas layout drives landscape framing and keeps mobile resolution stable", (t) => {
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    let rotated = "1";
    globalThis.window = { devicePixelRatio: 3 };
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => rotated });
    t.after(() => {
        for (const key of ["window", "getComputedStyle"]) {
            if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
            else delete globalThis[key];
        }
    });
    const sizes = [];
    const ratios = [];
    const textWidths = [];
    const scene = Object.assign(Object.create(ThreeBodyScene.prototype), {
        canvas: { clientWidth: 844, clientHeight: 390 },
        controls: {}, camera: new PerspectiveCamera(42, 1, 0.05, 60),
        renderer: { setSize(w, h) { sizes.push([w, h]); }, setPixelRatio(r) { ratios.push(r); } },
        monument: { resize(w) { textWidths.push(w); } },
    });
    scene._resize();
    assert.equal(scene.controls.rotated, true);
    const scale = scene.positionWorldScale;
    rotated = "0";
    scene._resize();
    assert.equal(scene.controls.rotated, false);
    assert.equal(scene.positionWorldScale, scale);
    assert.deepEqual(sizes, [[844, 390], [844, 390]]);
    assert.deepEqual(textWidths, [844, 844]);
    assert.deepEqual(ratios, [1.2, 1.2]);
    assert.equal(scene.camera.aspect, 844 / 390);
    scene.canvas.clientWidth = 760;
    scene._resize();
    assert.equal(scene.camera.aspect, 760 / 390);
    scene.canvas.clientWidth = 1440;
    scene.canvas.clientHeight = 900;
    scene._resize();
    assert.equal(ratios.at(-1), 1.5);
});
