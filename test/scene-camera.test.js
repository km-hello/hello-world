import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "three";
import { ThreeBodyScene } from "../src/scene/three-body-scene.js";

function createScene(t) {
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    globalThis.document = { hidden: false };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    t.after(() => {
        for (const key of ["document", "requestAnimationFrame", "cancelAnimationFrame"]) {
            if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
            else delete globalThis[key];
        }
    });
    const camera = new PerspectiveCamera(42, 1, 0.05, 60);
    camera.position.set(0, 0, 6);
    const calls = { renders: 0, trailDeltas: [] };
    const scene = Object.assign(Object.create(ThreeBodyScene.prototype), {
        camera, cameraSwayEnabled: true, cameraSwayTime: 0,
        started: true, destroyed: false, contextLost: false,
        manuallyPaused: false, pageSuspended: false, resizePending: false,
        controls: { enabled: true }, motionPreference: { matches: false },
        canvas: { dataset: {} }, animationFrameId: null,
        accumulator: 0, lastTimestamp: 0, sceneOpacity: 1,
        system: { positions: new Float64Array(9), step: () => true },
        bodyVisuals: {
            updateTrails(delta) { calls.trailDeltas.push(delta); },
            updateBodies() {}, resetTrailSampling() {},
        },
        monument: { update() {} },
        renderer: { getContext: () => ({ isContextLost: () => false }) },
        _resize() { this.resizePending = false; },
        _render() { calls.renders += 1; },
    });
    return { scene, calls };
}

test("camera sway is time-based, bounded and keeps its viewing distance", (t) => {
    const { scene } = createScene(t);
    for (let frame = 0; frame < 96 * 60; frame += 1) {
        scene._advanceCameraSway(1 / 60);
        const { x, y, z } = scene.camera.position;
        assert.ok(Math.abs(scene.camera.position.length() - 6) < 1e-12);
        assert.ok(Math.abs(Math.atan2(x, z)) <= Math.PI / 30 + 1e-12);
        assert.ok(Math.abs(Math.asin(y / 6)) <= Math.PI / 60 + 1e-12);
    }
    scene.cameraSwayTime = 0;
    scene._advanceCameraSway(6);
    const expected = scene.camera.position.clone();
    assert.ok(expected.x > 0.6);
    scene.cameraSwayTime = 0;
    for (let step = 0; step < 120; step += 1) scene._advanceCameraSway(0.05);
    assert.ok(scene.camera.position.distanceTo(expected) < 1e-12);
});

test("animation renders once per frame and freezes sway through lifecycle suspension", (t) => {
    const { scene, calls } = createScene(t);
    scene._onAnimationFrame(1000);
    scene._onAnimationFrame(1050);
    assert.equal(calls.renders, 2);
    assert.equal(scene.cameraSwayTime, 0.05);
    for (const [object, key] of [
        [scene, "manuallyPaused"], [scene, "pageSuspended"],
        [document, "hidden"], [scene.motionPreference, "matches"],
        [scene, "contextLost"],
    ]) {
        const position = scene.camera.position.clone();
        const phase = scene.cameraSwayTime;
        object[key] = true;
        scene._onAnimationFrame(2000);
        assert.equal(scene.cameraSwayTime, phase);
        assert.ok(scene.camera.position.equals(position));
        object[key] = false;
        scene._syncAnimationState();
        scene._onAnimationFrame(10000);
        assert.equal(scene.cameraSwayTime, phase);
        assert.ok(scene.camera.position.equals(position));
        scene._onAnimationFrame(10050);
        assert.ok(scene.cameraSwayTime > phase);
    }
});

test("manual takeover persists through resume and graphics recovery; paused rotation refreshes trails", (t) => {
    const { scene, calls } = createScene(t);
    scene._onAnimationFrame(1000);
    scene._onAnimationFrame(1050);
    scene._onControlsStart();
    const position = scene.camera.position.clone();
    const phase = scene.cameraSwayTime;
    scene.pause();
    const renders = calls.renders;
    scene._onControlsChange();
    assert.equal(calls.renders, renders + 1);
    assert.equal(calls.trailDeltas.at(-1), 0);
    scene.resume();
    scene._onContextLost({ preventDefault() {} });
    scene._onContextRestored();
    scene._onAnimationFrame(10000);
    scene._onAnimationFrame(10050);
    assert.equal(scene.cameraSwayEnabled, false);
    assert.equal(scene.cameraSwayTime, phase);
    assert.ok(scene.camera.position.equals(position));
});
