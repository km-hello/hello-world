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
