import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Scene } from "three";

import { BodyVisuals } from "../src/scene/body-visuals.js";

const CAMERA_DISTANCE = 6;

function createFixture(t) {
    const originalDocument = globalThis.document;
    globalThis.document = {
        createElement: () => ({ getContext: () => null }),
    };
    const camera = new PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);
    const visuals = new BodyVisuals(new Scene(), CAMERA_DISTANCE, camera);
    visuals.resize(1, 1);
    t.after(() => {
        visuals.dispose();
        globalThis.document = originalDocument;
    });
    return { camera, visuals };
}

test("bodies and trail history share uniform XYZ scaling after resize", (t) => {
    const { visuals } = createFixture(t);
    const previousPositions = new Float64Array([
        0.25, -0.5, 0.75,
        -0.5, 0.75, -0.25,
        0.75, 0.25, -0.5,
    ]);
    const positions = new Float64Array([
        0.5, -0.75, 1,
        -0.75, 1, -0.5,
        1, 0.5, -0.75,
    ]);
    visuals.resetTrails(previousPositions);
    visuals.updateTrails(1 / 30, positions);

    for (const scale of [2, 0.75]) {
        visuals.resize(scale, 1);
        visuals.updateBodies(positions);

        for (let body = 0; body < 3; body += 1) {
            const offset = body * 3;
            const expectedPosition = Array.from(
                positions.slice(offset, offset + 3),
                (coordinate) => coordinate * scale,
            );
            assert.deepEqual(visuals.visuals[body].group.position.toArray(), expectedPosition);
            const trail = visuals.trails[body].positionAttribute.array;
            assert.deepEqual(Array.from(trail.slice(-3)), expectedPosition);

            for (let point = 0; point < trail.length - 3; point += 3) {
                assert.deepEqual(
                    Array.from(trail.slice(point, point + 3)),
                    Array.from(
                        previousPositions.slice(offset, offset + 3),
                        (coordinate) => coordinate * scale,
                    ),
                );
            }
        }
    }
});

test("default view preserves body styling and fades bodies at the near plane", (t) => {
    const { visuals } = createFixture(t);
    const positions = new Float64Array([
        0, 0, 0,
        0, 0, CAMERA_DISTANCE - 0.25,
        0, 0, CAMERA_DISTANCE,
    ]);
    visuals.updateBodies(positions);
    const perspective = 1;
    const intensityProgress = (perspective - 0.44) / (2.18 - 0.44);
    const intensity = intensityProgress ** 2 * (3 - 2 * intensityProgress);
    assert.equal(visuals.visuals[0].halo.scale.x, 0.58 + 0.82 * intensity);
    assert.equal(visuals.visuals[0].halo.material.opacity, 0.46 + 0.49 * intensity);
    assert.ok(Math.abs(visuals.visuals[1].halo.material.opacity - 0.475) < 1e-12);
    assert.equal(visuals.visuals[2].halo.visible, false);
    assert.equal(visuals.visuals[2].core.material.opacity, 0);
});

test("camera rotation refreshes depth styling without moving bodies", (t) => {
    const { camera, visuals } = createFixture(t);
    const positions = new Float64Array([7, 0, 0, 0, 0, 7, -7, 0, 0]);
    visuals.updateBodies(positions);
    const worldPositions = visuals.visuals.map((visual) => visual.group.position.toArray());
    assert.equal(visuals.visuals[1].halo.visible, false);

    const rotate = (x, z) => {
        camera.position.set(x, 0, z);
        camera.lookAt(0, 0, 0);
        visuals.updateBodies(positions);
        assert.deepEqual(visuals.visuals.map((visual) => visual.group.position.toArray()), worldPositions);
    };
    rotate(CAMERA_DISTANCE, 0);
    assert.ok(camera.position.x > 5.99);
    assert.equal(visuals.visuals[0].halo.visible, false);
    assert.equal(visuals.visuals[1].halo.visible, true);
    assert.equal(visuals.visuals[2].halo.visible, true);
    rotate(0, -CAMERA_DISTANCE);
    assert.ok(camera.position.z < -5.99);
    assert.equal(visuals.visuals[0].halo.visible, true);
    assert.equal(visuals.visuals[1].halo.visible, true);
    assert.ok(visuals.visuals[1].halo.scale.x < visuals.visuals[0].halo.scale.x);
});

test("magnified bodies fade correctly when viewed from all six axis directions", (t) => {
    const { camera, visuals } = createFixture(t);
    const positions = new Float64Array(9);

    for (const scale of [5, 2.72]) {
        visuals.resize(scale, 1);
        for (const direction of [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1],
        ]) {
            camera.position.fromArray(direction).multiplyScalar(CAMERA_DISTANCE);
            camera.lookAt(0, 0, 0);

            for (const forwardDistance of [0.25, -0.1]) {
                for (let axis = 0; axis < 3; axis += 1) {
                    positions[axis] = direction[axis]
                        * (CAMERA_DISTANCE - forwardDistance) / scale;
                }
                visuals.updateBodies(positions);
                const expectedOpacity = forwardDistance > 0 ? 0.475 : 0;
                assert.ok(Math.abs(visuals.visuals[0].halo.material.opacity - expectedOpacity) < 1e-7);
            }
        }
    }
});


test("dispose releases shared sprite resources and trail resources once", (t) => {
    const { visuals } = createFixture(t);
    const resources = [
        ...visuals.textures,
        ...visuals.visuals.flatMap(({ halo, core }) => [halo.material, core.material]),
        ...visuals.trails.flatMap(({ geometry, material }) => [geometry, material]),
        visuals.visuals[0].halo.geometry,
    ];
    const disposeCounts = resources.map(() => 0);
    resources.forEach((resource, index) => {
        resource.addEventListener("dispose", () => { disposeCounts[index] += 1; });
    });
    visuals.dispose();
    visuals.dispose();
    assert.deepEqual(disposeCounts, resources.map(() => 1));
    assert.equal(visuals.visuals.length, 0);
    assert.equal(visuals.trails.length, 0);
    assert.equal(visuals.textures.length, 0);
});
