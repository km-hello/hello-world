import assert from "node:assert/strict";
import test from "node:test";

import {
    getGlowScale,
    getNearCameraFade,
    getPositionScale,
    getVisualPerspective,
} from "../src/scene/viewport.js";

const CAMERA_DISTANCE = 6;

test("portrait layouts constrain position scale without shrinking the glow equally", () => {
    assert.equal(getPositionScale(1280, 720), 180);
    assert.equal(getGlowScale(1280, 720), 180);
    assert.ok(Math.abs(getPositionScale(390, 844) - 390 / 3.4) < 1e-12);
    assert.equal(getGlowScale(390, 844), 195);
    assert.ok(getGlowScale(390, 844) > getPositionScale(390, 844));
});

test("main-camera depth remains continuous and uncapped through a close pass", () => {
    assert.equal(getVisualPerspective(CAMERA_DISTANCE, CAMERA_DISTANCE), 1);
    assert.equal(getVisualPerspective(CAMERA_DISTANCE / 2, CAMERA_DISTANCE), 2);
    assert.ok(
        getVisualPerspective(0.001, CAMERA_DISTANCE) > 1_000,
    );
    assert.equal(
        getVisualPerspective(0, CAMERA_DISTANCE),
        Number.POSITIVE_INFINITY,
    );
});

test("near-camera fade reaches zero before clipping without capping perspective", () => {
    const nearDistance = 0.05;
    const fullOpacityDistance = 0.45;

    assert.equal(
        getNearCameraFade(
            fullOpacityDistance,
            nearDistance,
            fullOpacityDistance,
        ),
        1,
    );
    assert.ok(
        Math.abs(
            getNearCameraFade(
                0.25,
                nearDistance,
                fullOpacityDistance,
            ) - 0.5,
        ) < 1e-12,
    );
    assert.equal(
        getNearCameraFade(
            nearDistance,
            nearDistance,
            fullOpacityDistance,
        ),
        0,
    );
    assert.equal(
        getNearCameraFade(
            -0.1,
            nearDistance,
            fullOpacityDistance,
        ),
        0,
    );
});
