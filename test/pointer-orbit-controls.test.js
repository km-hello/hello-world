import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "three";
import { PointerOrbitControls } from "../src/scene/pointer-orbit-controls.js";

function setup() {
    const listeners = new Map();
    const captures = new Set();
    const canvas = {
        style: {}, clientHeight: 600,
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type, handler) {
            assert.equal(listeners.get(type), handler);
            listeners.delete(type);
        },
        setPointerCapture(id) { captures.add(id); },
        hasPointerCapture(id) { return captures.has(id); },
        releasePointerCapture(id) { captures.delete(id); },
    };
    const camera = new PerspectiveCamera();
    camera.position.set(0.4, 0.2, 5.9).setLength(6);
    const controls = new PointerOrbitControls(camera, canvas);
    const emit = (type, overrides = {}) => listeners.get(type)?.({
        pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100,
        ...overrides,
    });
    return { controls, camera, canvas, listeners, captures, emit };
}

test("only pointer events are registered; dragging preserves distance and starts at current view", () => {
    const { controls, camera, canvas, listeners, emit } = setup();
    assert.deepEqual([...listeners.keys()], [
        "pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture",
    ]);
    let starts = 0;
    let changes = 0;
    controls.addEventListener("start", () => starts++);
    controls.addEventListener("change", () => changes++);
    const initial = camera.position.clone();
    emit("pointerdown");
    emit("pointermove", { clientX: 160 });
    assert.ok(camera.position.equals(initial));
    controls.enabled = true;
    emit("pointerdown", { button: 2 });
    emit("pointerdown", { isPrimary: false, pointerId: 2 });
    assert.equal(starts, 0);
    emit("pointerdown", { ctrlKey: true, shiftKey: true, metaKey: true });
    assert.ok(camera.position.equals(initial));
    emit("pointermove", { pointerId: 2, clientX: 160 });
    assert.equal(changes, 0);
    emit("pointermove", { clientX: 160 });
    assert.equal(starts, 1);
    assert.equal(changes, 1);
    assert.ok(Math.abs(camera.position.length() - 6) < 1e-12);
    const angle = Math.atan2(initial.x, initial.z) - 2 * Math.PI * 60 / 600;
    assert.ok(Math.abs(Math.atan2(camera.position.x, camera.position.z) - angle) < 1e-12);
    emit("pointermove", { clientY: -100000 });
    assert.ok(camera.position.toArray().every(Number.isFinite));
    emit("pointerup");
    assert.equal(canvas.style.cursor, "grab");
    controls.dispose();
});

test("touch cancellation, lost capture, disabling and disposal end dragging and release listeners", () => {
    for (const end of ["pointercancel", "lostpointercapture", "disable", "dispose"]) {
        const { controls, camera, canvas, listeners, captures, emit } = setup();
        controls.enabled = true;
        emit("pointerdown", { pointerType: "touch" });
        assert.equal(canvas.style.cursor, "grabbing");
        assert.equal(captures.size, 1);
        if (end === "disable") controls.enabled = false;
        else if (end === "dispose") controls.dispose();
        else emit(end);
        assert.equal(captures.size, 0);
        const position = camera.position.clone();
        emit("pointermove", { clientX: 300 });
        assert.ok(camera.position.equals(position));
        if (end !== "dispose") controls.dispose();
        assert.equal(listeners.size, 0);
        assert.equal(canvas.style.cursor, "auto");
    }
});
