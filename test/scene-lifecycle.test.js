import assert from "node:assert/strict";
import test from "node:test";
import { ThreeBodyScene } from "../src/scene/three-body-scene.js";

test("graphics recovery respects running, paused, hidden and reduced-motion states", () => {
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    globalThis.document = { hidden: false };
    globalThis.requestAnimationFrame = () => 42;
    globalThis.cancelAnimationFrame = () => {};
    try {
        for (const mode of ["running", "paused", "hidden", "reduced-motion"]) {
            document.hidden = mode === "hidden";
            let renders = 0;
            let resizes = 0;
            const scene = Object.assign(Object.create(ThreeBodyScene.prototype), {
                started: true, destroyed: false, contextLost: false,
                manuallyPaused: mode === "paused", pageSuspended: false,
                motionPreference: { matches: mode === "reduced-motion" },
                controls: { enabled: true }, canvas: { dataset: {} },
                animationFrameId: 10, lastTimestamp: 1000, accumulator: 0.02,
                bodyVisuals: { resetTrailSampling() {}, updateBodies() {} },
                monument: { update() {} }, system: { positions: [] },
                _render() { renders += 1; },
                _resize() { resizes += 1; this.resizePending = false; },
            });
            let prevented = false;
            scene._onContextLost({ preventDefault() { prevented = true; } });
            assert.ok(prevented);
            assert.equal(scene.manuallyPaused, mode === "paused");
            assert.equal(scene.animationFrameId, null);
            assert.equal(scene.controls.enabled, false);
            assert.equal(scene.canvas.dataset.simulationState, "context-lost");
            scene._requestResize();
            scene._syncAnimationState();
            assert.equal(renders, 0);
            assert.equal(resizes, 0);
            scene._onContextRestored();
            assert.equal(scene.contextLost, false);
            assert.equal(scene.animationFrameId, mode === "running" ? 42 : null);
            assert.equal(scene.canvas.dataset.simulationState, mode === "hidden" ? "paused" : mode);
            assert.equal(renders, mode === "paused" || mode === "reduced-motion" ? 1 : 0);
            assert.equal(resizes, renders);
            assert.equal(scene.lastTimestamp, 0);
            assert.equal(scene.accumulator, 0);
            if (mode === "hidden") {
                document.hidden = false;
                scene._syncAnimationState();
                assert.equal(scene.animationFrameId, 42);
            }
            scene.destroyed = true;
            scene.contextLost = true;
            scene.animationFrameId = null;
            scene._onContextRestored();
            assert.equal(scene.contextLost, true);
            assert.equal(scene.animationFrameId, null);
        }
    } finally {
        for (const key of ["document", "requestAnimationFrame", "cancelAnimationFrame"]) {
            if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
            else delete globalThis[key];
        }
    }
});

test("unsafe-state recovery fades back in and stops writing opacity once complete", () => {
    const scene = Object.assign(Object.create(ThreeBodyScene.prototype), {
        sceneOpacity: 1,
        canvas: { style: {} },
    });
    scene._advanceResetTransition(0.05);
    assert.equal(scene.canvas.style.opacity, undefined);
    scene.sceneOpacity = 0;
    scene._advanceResetTransition(0);
    assert.equal(scene.canvas.style.opacity, "0");
    scene._advanceResetTransition(0.225);
    assert.equal(scene.canvas.style.opacity, "0.5");
    scene._advanceResetTransition(0.225);
    assert.equal(scene.canvas.style.opacity, "1");
    scene.canvas.style = Object.freeze({ opacity: "1" });
    scene._advanceResetTransition(0.05);
});
