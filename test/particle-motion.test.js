import assert from "node:assert/strict";
import test from "node:test";

import { ParticleMotion } from "../src/scene/particle-motion.js";

const FAR_STARS = [
    { x: 20, y: 0, z: 0 },
    { x: 0, y: 20, z: 0 },
    { x: 0, y: 0, z: 20 },
];
const NEAR_STARS = [{ x: -0.2, y: 0, z: 0 }, ...FAR_STARS.slice(1)];
const RADIUS = 1.5;

function advance(motion, stars, seconds, fps = 60) {
    for (let frame = 0; frame < seconds * fps; frame += 1) {
        motion.update(stars, 1 / fps, RADIUS);
    }
}

test("near stars scatter particles radially with swirl while distant particles only drift slightly", () => {
    const motion = new ParticleMotion(new Float32Array([0, 0, 0, 10, 0, 0]));
    advance(motion, NEAR_STARS, 1);
    assert.ok(motion.positions[0] > 1 && motion.positions[0] < 3);
    assert.ok(motion.positions[1] > 0.2);
    assert.ok(motion.activity[0] > 0.2 && motion.activity[0] <= 1);
    assert.ok(Math.abs(motion.positions[3] - 10) < 0.1);
    assert.equal(motion.activity[1], 0);
});

test("particles return to the text and slowly lose activity when stars leave", () => {
    const motion = new ParticleMotion(new Float32Array([0, 0, 0]));
    advance(motion, NEAR_STARS, 0.2);
    const displaced = motion.positions[0];
    const outwardVelocity = motion.velocities[0];
    const activity = motion.activity[0];
    advance(motion, FAR_STARS, 1 / 60);
    assert.ok(motion.positions[0] > displaced, "inertia should carry particles outward after the star leaves");
    assert.ok(motion.velocities[0] > outwardVelocity * 0.9);
    assert.ok(motion.activity[0] > activity * 0.8);
    advance(motion, FAR_STARS, 3);
    assert.ok(Math.hypot(...motion.positions) > 1.5, "the cloud should remain dispersed after a brief encounter");
    assert.ok(motion.activity[0] > 0.05, "the disturbance should fade gradually");
    advance(motion, FAR_STARS, 12);
    assert.ok(Math.hypot(...motion.positions) < 0.15);
    assert.ok(Math.hypot(...motion.velocities) < 0.15);
    assert.ok(motion.activity[0] < 0.01);
});

test("zero delta freezes all particle state even when stars change", () => {
    const motion = new ParticleMotion(new Float32Array([0, 0, 0]));
    advance(motion, NEAR_STARS, 0.5);
    const positions = motion.positions.slice();
    const velocities = motion.velocities.slice();
    const activity = motion.activity.slice();
    const time = motion.time;
    motion.update(FAR_STARS, 0, RADIUS);
    assert.deepEqual(motion.positions, positions);
    assert.deepEqual(motion.velocities, velocities);
    assert.deepEqual(motion.activity, activity);
    assert.equal(motion.time, time);
});

test("different frame rates agree and a large frame delta is capped", () => {
    const motions = [30, 60, 120].map((fps) => {
        const motion = new ParticleMotion(new Float32Array([0, 0, 0]));
        advance(motion, NEAR_STARS, 1, fps);
        advance(motion, FAR_STARS, 1, fps);
        return motion;
    });
    for (const motion of motions.slice(1)) {
        assert.ok(Math.abs(motion.positions[0] - motions[0].positions[0]) < 1e-6);
        assert.ok(Math.abs(motion.activity[0] - motions[0].activity[0]) < 1e-6);
    }
    const capped = new ParticleMotion(new Float32Array([0, 0, 0]));
    const normal = new ParticleMotion(new Float32Array([0, 0, 0]));
    capped.update(NEAR_STARS, 3, RADIUS);
    normal.update(NEAR_STARS, 0.05, RADIUS);
    assert.deepEqual(capped.positions, normal.positions);
    assert.deepEqual(capped.velocities, normal.velocities);
    assert.deepEqual(capped.activity, normal.activity);
});

test("rest positions and stars stay untouched and output arrays keep their identities", () => {
    const rest = new Float32Array([0, 0, 0, 0.2, 0.1, 0]);
    const before = rest.slice();
    const stars = NEAR_STARS.map((star) => ({ ...star }));
    const starsBefore = structuredClone(stars);
    const motion = new ParticleMotion(rest);
    const positions = motion.positions;
    const velocities = motion.velocities;
    const activity = motion.activity;
    advance(motion, stars, 1);
    assert.deepEqual(rest, before);
    assert.deepEqual(stars, starsBefore);
    assert.equal(motion.positions, positions);
    assert.equal(motion.velocities, velocities);
    assert.equal(motion.activity, activity);
    assert.notEqual(motion.restPositions, rest);
});

test("sustained encounters remain finite and bounded, including coincident stars", () => {
    const motion = new ParticleMotion(new Float32Array([0, 0, 0, 0.4, 0.1, 0.2]));
    const stars = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
    for (let frame = 0; frame < 60 * 120; frame += 1) {
        stars[0].x = Math.sin(frame / 60) * 0.5;
        motion.update(stars, 1 / 60, 2);
        for (let particle = 0; particle < motion.activity.length; particle += 1) {
            const offset = particle * 3;
            assert.ok(Math.hypot(
                motion.positions[offset] - motion.restPositions[offset],
                motion.positions[offset + 1] - motion.restPositions[offset + 1],
                motion.positions[offset + 2] - motion.restPositions[offset + 2],
            ) < 8);
            assert.ok(motion.activity[particle] >= 0 && motion.activity[particle] <= 1);
        }
        for (const value of motion.velocities) assert.ok(Number.isFinite(value));
    }
    advance(motion, FAR_STARS, 20);
    for (let index = 0; index < motion.positions.length; index += 1) {
        assert.ok(Math.abs(motion.positions[index] - motion.restPositions[index]) < 0.2,
            "particles should recover even after sustained encounters");
    }
});

test("ambient drift is deterministic real position motion and does not excite star activity", () => {
    const first = new ParticleMotion(new Float32Array([0, 0, 0, 1, 0, 0]));
    const second = new ParticleMotion(new Float32Array([0, 0, 0, 1, 0, 0]));
    advance(first, FAR_STARS, 20);
    advance(second, FAR_STARS, 20);
    assert.deepEqual(first.positions, second.positions);
    assert.deepEqual([...first.activity], [0, 0]);
    assert.ok(Math.hypot(...first.positions.slice(0, 3)) > 0.01);
    assert.ok(Math.hypot(...first.positions.slice(0, 3)) < 0.2);
});
