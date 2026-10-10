import assert from "node:assert/strict";
import { createVisualSystem } from "../src/simulation/physics.js";
import { getPositionScale } from "../src/scene/viewport.js";

const duration = 20 * 60;
const stepDuration = 1 / 480;
const frameDuration = 1 / 60;
const viewports = [[1280, 720], [390, 844]].map(([width, height]) => {
    const halfHeight = 6 * Math.tan(42 * Math.PI / 360);
    return {
        width,
        height,
        halfHeight,
        halfWidth: halfHeight * width / height,
        scale: getPositionScale(width, height) * 1.5 / (height / (2 * halfHeight)),
    };
});
const results = [];

for (let seed = 1; seed <= 24; seed += 1) {
    let state = seed;
    const system = createVisualSystem(() => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 2 ** 32;
    });
    let radius = 0;
    let speed = 0;
    let pair = -1;
    let isolatedTime = 0;
    let longestIsolation = 0;
    const offscreenTimes = viewports.map(() => [0, 0, 0]);
    const longestOffscreen = [0, 0];
    for (let frame = 0; frame < duration * 60; frame += 1) {
        for (let substep = 0; substep < 8; substep += 1) {
            assert.equal(system.step(stepDuration), true, `seed ${seed}: unsafe state`);
        }
        const nextPair = system._detectBoundPair(pair);
        isolatedTime = nextPair < 0 ? 0
            : nextPair === pair ? isolatedTime + frameDuration : frameDuration;
        pair = nextPair;
        longestIsolation = Math.max(longestIsolation, isolatedTime);
        for (let body = 0; body < 3; body += 1) {
            const offset = body * 3;
            const [x, y, z] = system.positions.subarray(offset, offset + 3);
            radius = Math.max(radius, Math.hypot(x, y, z));
            speed = Math.max(speed, Math.hypot(...system.velocities.subarray(offset, offset + 3)));
            viewports.forEach((viewport, index) => {
                const depth = 6 - z * viewport.scale;
                // Measure star centers, not glow or trails, with the default camera direction.
                const visible = depth > 0.05 && depth < 60
                    && Math.abs(x * viewport.scale * 6 / depth) <= viewport.halfWidth
                    && Math.abs(y * viewport.scale * 6 / depth) <= viewport.halfHeight;
                offscreenTimes[index][body] = visible ? 0
                    : offscreenTimes[index][body] + frameDuration;
                longestOffscreen[index] = Math.max(longestOffscreen[index], offscreenTimes[index][body]);
            });
        }
    }
    assert.equal(system.resetCount, 1, `seed ${seed}: unexpected reset`);
    assert.ok(radius < 6 && speed < 6, `seed ${seed}: excessive radius ${radius} or speed ${speed}`);
    assert.ok(longestIsolation < 40, `seed ${seed}: isolated binary for ${longestIsolation}s`);
    assert.ok(Math.max(...longestOffscreen) < 30, `seed ${seed}: prolonged offscreen motion`);
    results.push({
        seed,
        radius: radius.toFixed(3),
        speed: speed.toFixed(3),
        isolatedSeconds: longestIsolation.toFixed(2),
        desktopOffscreenSeconds: longestOffscreen[0].toFixed(2),
        portraitOffscreenSeconds: longestOffscreen[1].toFixed(2),
        interventions: system.binaryInterventionCount,
    });
}
console.table(results);
console.log(`Passed ${results.length} seeds × ${duration / 60} minutes at 480 Hz; metrics sampled at 60 Hz.`);
