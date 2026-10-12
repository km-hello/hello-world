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
            const trail = visuals.trails[body];
            assert.equal(trail.geometry.instanceCount, 1);
            assert.deepEqual(Array.from(trail.positionBuffer.array.slice(3, 6)), expectedPosition);
            assert.deepEqual(
                Array.from(trail.positionBuffer.array.slice(0, 3)),
                Array.from(
                    previousPositions.slice(offset, offset + 3),
                    (coordinate) => coordinate * scale,
                ),
            );
        }
    }
});

test("bodies fade before reaching the near plane", (t) => {
    const { visuals } = createFixture(t);
    const positions = new Float64Array([
        0, 0, 0,
        0, 0, CAMERA_DISTANCE - 0.25,
        0, 0, CAMERA_DISTANCE,
    ]);
    visuals.updateBodies(positions);
    assert.ok(Math.abs(visuals.visuals[1].halo.material.opacity - 0.475) < 1e-12);
    assert.equal(visuals.visuals[2].halo.visible, false);
    assert.equal(visuals.visuals[2].core.material.opacity, 0);
});

test("approaching bodies become larger and brighter across the normal viewing range", (t) => {
    const { camera, visuals } = createFixture(t);
    const positions = new Float64Array(9);
    for (const direction of [[0, 0, 1], [1, 0, 0], [0, 0, -1]]) {
        camera.position.fromArray(direction).multiplyScalar(CAMERA_DISTANCE);
        camera.lookAt(0, 0, 0);
        const sizes = [];
        const brightness = [];
        for (const distance of [8, 6, 4]) {
            for (let axis = 0; axis < 3; axis += 1) {
                positions[axis] = direction[axis] * (CAMERA_DISTANCE - distance);
            }
            visuals.updateBodies(positions);
            const { halo, core } = visuals.visuals[0];
            sizes.push([halo.scale.x / distance, core.scale.x / distance]);
            brightness.push([halo.material.opacity, core.material.opacity]);
        }
        for (let part = 0; part < 2; part += 1) {
            assert.ok(sizes[0][part] < sizes[1][part]);
            assert.ok(sizes[1][part] < sizes[2][part]);
            assert.ok(sizes[2][part] > sizes[0][part] * 3);
            assert.ok(brightness[0][part] < brightness[1][part]);
            assert.ok(brightness[1][part] < brightness[2][part]);
            assert.ok(brightness[2][part] > brightness[0][part] * 2);
        }
    }
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


test("trail depth brightness updates with camera rotation and preserves buffers", (t) => {
    const { camera, visuals } = createFixture(t);
    const previous = new Float64Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const positions = new Float64Array([3, 0, 0, -3, 0, 0, 0, 0, -30]);
    visuals.resetTrails(previous);
    visuals.updateTrails(1 / 30, positions);
    const buffers = visuals.trails.map(({ positionBuffer, colorBuffer }) => (
        [positionBuffer, colorBuffer, positionBuffer.array, colorBuffer.array]
    ));
    const baseColor = visuals.visuals[0].color.r;
    assert.ok(Math.abs(visuals.trails[0].colorBuffer.array[3] - baseColor) < 1e-7);
    const farColor = visuals.visuals[2].color.r;
    assert.ok(Math.abs(visuals.trails[2].colorBuffer.array[3] - farColor * 0.35) < 1e-7);

    camera.position.set(CAMERA_DISTANCE, 0, 0);
    camera.lookAt(0, 0, 0);
    visuals.updateTrails(0, positions);
    assert.ok(Math.abs(visuals.trails[0].colorBuffer.array[3] - baseColor * 1.5) < 1e-7);
    assert.ok(Math.abs(visuals.trails[1].colorBuffer.array[3]
        - visuals.visuals[1].color.r * (6 / 9)) < 1e-7);
    visuals.trails.forEach((trail, index) => {
        assert.equal(trail.positionBuffer, buffers[index][0]);
        assert.equal(trail.colorBuffer, buffers[index][1]);
        assert.equal(trail.positionBuffer.array, buffers[index][2]);
        assert.equal(trail.colorBuffer.array, buffers[index][3]);
    });
});

test("world-width trails fade at the near plane and reset without zero-length segments", (t) => {
    const { visuals } = createFixture(t);
    const trailLines = visuals.scene.children.filter((object) => object.isLine2);
    for (const line of trailLines) {
        assert.ok(visuals.visuals.every(({ halo, core }) => (
            line.renderOrder < halo.renderOrder && line.renderOrder < core.renderOrder
        )));
    }
    const previous = new Float64Array(9);
    visuals.resetTrails(previous);
    assert.ok(visuals.trails.every(({ geometry }) => geometry.instanceCount === 0));
    const positions = new Float64Array([
        1, 0, CAMERA_DISTANCE - 0.25,
        1, 0, CAMERA_DISTANCE - 0.05,
        1, 0, CAMERA_DISTANCE + 1,
    ]);
    visuals.updateTrails(1 / 30, positions);
    assert.ok(Math.abs(visuals.trails[0].colorBuffer.array[3]
        - visuals.visuals[0].color.r * 1.5 * 0.5) < 1e-7);
    assert.ok(Math.abs(visuals.trails[1].colorBuffer.array[3]) < 1e-12);
    assert.equal(visuals.trails[2].colorBuffer.array[3], 0);
    visuals.resize(0.75, 2);
    for (const trail of visuals.trails) {
        assert.equal(trail.material.worldUnits, true);
        assert.equal(trail.material.linewidth, 0.02);
        assert.ok(Array.from(trail.positionBuffer.array).every(Number.isFinite));
        assert.ok(Array.from(trail.colorBuffer.array).every(Number.isFinite));
    }
    visuals.resetTrails(positions);
    assert.ok(visuals.trails.every(({ geometry }) => geometry.instanceCount === 0));
});

test("trails retain 40 samples, fixed sampling interval, and tail age fade", (t) => {
    const { visuals } = createFixture(t);
    const positions = new Float64Array(9);
    visuals.resetTrails(positions);
    positions[0] = 1;
    visuals.updateTrails(1 / 60, positions);
    assert.equal(visuals.trails[0].geometry.instanceCount, 0);
    visuals.updateTrails(1 / 60, positions);
    assert.equal(visuals.trails[0].geometry.instanceCount, 1);
    for (let point = 2; point <= 41; point += 1) {
        positions[0] = point;
        visuals.updateTrails(1 / 30, positions);
    }
    const trail = visuals.trails[0];
    assert.equal(trail.geometry.instanceCount, 39);
    assert.equal(trail.positionBuffer.array[0], 2);
    assert.equal(trail.positionBuffer.array[233], 0);
    assert.equal(trail.positionBuffer.array[231], 41);
    assert.ok(Math.abs(trail.colorBuffer.array[0] - visuals.visuals[0].color.r * 0.015) < 1e-7);
    assert.ok(Math.abs(trail.colorBuffer.array[231] - visuals.visuals[0].color.r) < 1e-7);
});
