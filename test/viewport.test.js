import assert from "node:assert/strict";
import test from "node:test";

import { ThreeBodySystem } from "../src/simulation/physics.js";
import {
    getGlowScale,
    getNearCameraFade,
    getPositionScale,
    getRecoveryOverflow,
    getVisualPerspective,
    MAX_RECOVERY_STALL_DURATION,
    updateRecoveryTracking,
} from "../src/scene/viewport.js";

const FIXED_STEP = 1 / 120;
const FRAME_STEP = 1 / 60;
const CAMERA_DISTANCE = 6;

test("portrait layouts constrain position scale without shrinking the glow equally", () => {
    assert.equal(getPositionScale(1280, 720), 180);
    assert.equal(getGlowScale(1280, 720), 180);
    assert.ok(Math.abs(getPositionScale(390, 844) - 390 / 3.4) < 1e-12);
    assert.equal(getGlowScale(390, 844), 195);
    assert.ok(getGlowScale(390, 844) > getPositionScale(390, 844));
});

test("recovery overflow tracks projected position and the camera depth limit", () => {
    assert.equal(getRecoveryOverflow(0, 0, 0, 400, 400, 100, 0, 6, 1), 0);
    assert.ok(Math.abs(
        getRecoveryOverflow(10, 0, 0, 400, 400, 100, 0, 6, 1) - 734.88,
    ) < 1e-10);
    assert.ok(Math.abs(
        getRecoveryOverflow(10, 0, 10, 400, 400, 100, 0, 6, 1) - 1354.88,
    ) < 1e-10);
    assert.ok(Math.abs(
        getRecoveryOverflow(10, 0, 1, 400, 400, 100, 0, 6, 1) - 934.88,
    ) < 1e-10);
    assert.ok(Math.abs(
        getRecoveryOverflow(10, 0, 1, 400, 400, 100, 0, 6, 2) - 1234.88,
    ) < 1e-10);
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

test("offscreen fallback tracks stalled recovery instead of total return time", () => {
    const offscreenDurations = new Float64Array(1);
    const stallDurations = new Float64Array(1);
    const previousOverflows = new Float64Array(1);

    for (let frame = 0; frame < 8 / FRAME_STEP; frame += 1) {
        updateRecoveryTracking(
            offscreenDurations,
            stallDurations,
            previousOverflows,
            0,
            200 - frame * 0.1,
            FRAME_STEP,
        );
    }

    assert.ok(offscreenDurations[0] > 7.9);
    assert.equal(stallDurations[0], 0);

    for (let frame = 0; frame < 12.1 / FRAME_STEP; frame += 1) {
        updateRecoveryTracking(
            offscreenDurations,
            stallDurations,
            previousOverflows,
            0,
            152,
            FRAME_STEP,
        );
    }

    assert.ok(stallDurations[0] >= MAX_RECOVERY_STALL_DURATION);
});

for (const [width, height] of [[1280, 720], [390, 844]]) {
    test(`balanced motion and stable recovery at ${width}x${height} over twenty minutes`, () => {
        const positionScale = getPositionScale(width, height);
        const glowScale = getGlowScale(width, height);
        const pixelsPerWorldUnit = height / (2 * Math.tan(42 * Math.PI / 360) * CAMERA_DISTANCE);
        const positionWorldScale = positionScale / pixelsPerWorldUnit;
        const offscreenDurations = new Float64Array(3);
        const stallDurations = new Float64Array(3);
        const previousOverflows = new Float64Array(3);
        const system = new ThreeBodySystem();
        const minima = [Infinity, Infinity, Infinity];
        const maxima = [-Infinity, -Infinity, -Infinity];
        const squaredSums = [0, 0, 0];
        const checkpoints = [20, 60, 120].map((seconds) => seconds / FRAME_STEP);
        let maximumSpeed = 0;
        let hardLimitFrames = 0;
        let maximumStallDuration = 0;

        for (let frame = 0; frame < 20 * 60 / FRAME_STEP; frame += 1) {
            system.step(FIXED_STEP);
            system.step(FIXED_STEP);

            for (let body = 0; body < 3; body += 1) {
                const offset = body * 3;
                if (frame < 120 / FRAME_STEP) {
                    for (let axis = 0; axis < 3; axis += 1) {
                        const position = system.positions[offset + axis];
                        minima[axis] = Math.min(minima[axis], position);
                        maxima[axis] = Math.max(maxima[axis], position);
                        squaredSums[axis] += position * position;
                    }
                }
                const overflow = getRecoveryOverflow(
                    system.positions[offset],
                    system.positions[offset + 1],
                    system.positions[offset + 2],
                    width,
                    height,
                    positionScale,
                    glowScale,
                    CAMERA_DISTANCE,
                    positionWorldScale,
                );
                const urgency = updateRecoveryTracking(
                    offscreenDurations,
                    stallDurations,
                    previousOverflows,
                    body,
                    overflow,
                    FRAME_STEP,
                );
                const speed = Math.hypot(
                    system.velocities[offset],
                    system.velocities[offset + 1],
                    system.velocities[offset + 2],
                );

                system.setRecoveryUrgency(body, urgency);
                maximumSpeed = Math.max(maximumSpeed, speed);
                maximumStallDuration = Math.max(
                    maximumStallDuration,
                    stallDurations[body],
                );

                if (speed >= system.config.hardSpeedLimit * 0.99) {
                    hardLimitFrames += 1;
                }
            }

            if (checkpoints.includes(frame + 1)) {
                const ranges = maxima.map((maximum, axis) => maximum - minima[axis]);
                const ratio = Math.max(...ranges) / Math.min(...ranges);
                const limit = frame + 1 === 120 / FRAME_STEP ? 1.15 : 1.25;
                assert.ok(ratio <= limit, `axis range ratio at ${(frame + 1) * FRAME_STEP}s: ${ratio}`);
            }
            if (frame + 1 === 120 / FRAME_STEP) {
                const rmsRatio = Math.sqrt(Math.max(...squaredSums) / Math.min(...squaredSums));
                assert.ok(rmsRatio <= 1.25, `axis RMS ratio: ${rmsRatio}`);
            }
        }

        assert.ok(maximumSpeed < 4.5, `unexpected maximum speed: ${maximumSpeed}`);
        assert.equal(hardLimitFrames, 0);
        assert.ok(
            maximumStallDuration < MAX_RECOVERY_STALL_DURATION,
            `unexpected recovery stall: ${maximumStallDuration}`,
        );
        assert.equal(system.resetCount, 1);

    });
}
