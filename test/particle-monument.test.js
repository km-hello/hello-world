import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, Object3D, Scene, Vector3 } from 'three';
import { ParticleMonument } from '../src/scene/particle-monument.js';

test('paused particle lighting follows stars in local space without advancing motion', () => {
    const monument = new ParticleMonument(new Scene());
    monument.mesh = new Object3D();
    monument.mesh.rotation.set(-0.11, -0.14, 0);
    monument.mesh.scale.setScalar(0.4);
    monument.mesh.updateMatrixWorld();
    monument.motion = { update() { assert.fail('paused particles must not move'); } };
    const local = new Vector3(1, 2, 3);
    const world = monument.mesh.localToWorld(local.clone());
    const bodies = { visuals: [0x52ddff, 0xa87cff, 0xffaa5c].map(color => ({
        group: { position: world.clone() }, color: new Color(color),
    })) };
    monument.update(bodies, 0);
    for (let i = 0; i < 3; i++) {
        assert.ok(monument.starPositions[i].distanceTo(local) < 1e-12);
        assert.ok(monument.starColors[i].equals(bodies.visuals[i].color));
        assert.ok(bodies.visuals[i].group.position.equals(world));
    }
    bodies.visuals[0].group.position.set(0, 0, 0);
    monument.update(bodies, 0);
    assert.equal(monument.starPositions[0].length(), 0);
});

test('impact velocity follows the star in rotated, scaled text space without translation', () => {
    const monument = new ParticleMonument(new Scene());
    monument.mesh = new Object3D();
    monument.mesh.rotation.set(-0.11, -0.14, 0.3);
    monument.mesh.position.set(2, -1, 0.5);
    monument.mesh.geometry = { attributes: { position: {}, activity: {} } };
    const localVelocity = new Vector3(-2, 3, 1);
    const bodies = {
        positionWorldScale: 0.7,
        visuals: [0, 1, 2].map(() => ({ group: { position: new Vector3() }, color: new Color() })),
    };
    const velocities = new Float64Array(9);
    const cachedVelocities = monument.starVelocities.slice();
    for (const scale of [0.4, 0.8]) {
        monument.mesh.scale.setScalar(scale);
        monument.mesh.updateMatrixWorld();
        const worldOrigin = monument.mesh.localToWorld(new Vector3());
        const worldVelocity = monument.mesh.localToWorld(localVelocity.clone()).sub(worldOrigin);
        for (let body = 0; body < 3; body++) {
            worldVelocity.clone().divideScalar(bodies.positionWorldScale).toArray(velocities, body * 3);
        }
        const before = velocities.slice();
        let updates = 0;
        monument.motion = { update(positions, localVelocities, delta, radius) {
            updates++;
            assert.equal(positions, monument.starPositions);
            assert.equal(delta, 1 / 60);
            assert.equal(radius, 2);
            localVelocities.forEach((velocity, i) => {
                assert.ok(velocity.distanceTo(localVelocity) < 1e-12);
                assert.equal(velocity, cachedVelocities[i]);
            });
        } };
        monument.update(bodies, 1 / 60, velocities);
        assert.equal(updates, 1);
        assert.deepEqual(velocities, before);
        assert.equal(monument.mesh.geometry.attributes.position.needsUpdate, true);
    }
});
