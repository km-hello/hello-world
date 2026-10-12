const SPRING_STIFFNESS = 0.4;
const VELOCITY_DAMPING = 0.95;
const STAR_IMPACT_PER_SPEED = 6;
const STAR_LATERAL_SPREAD = 0.35;
const AMBIENT_FORCE = 0.055;
const MAX_SUBSTEP = 1 / 120;

export class ParticleMotion {
    constructor(restPositions) {
        this.restPositions = restPositions.slice();
        this.positions = restPositions.slice();
        this.velocities = new Float32Array(restPositions.length);
        this.activity = new Float32Array(restPositions.length / 3);
        this.phases = new Float32Array(this.activity.length);
        this.mobility = new Float32Array(this.activity.length);
        this.starDirections = new Float64Array(9);
        this.starSpeeds = new Float64Array(3);
        this.time = 0;
        for (let particle = 0; particle < this.activity.length; particle += 1) {
            this.phases[particle] = particle * 2.399963229728653;
            this.mobility[particle] = 1 + 0.25 * Math.sin(particle * 1.61803398875);
        }
    }

    update(starPositions, starVelocities, deltaTime, influenceRadius) {
        if (!(deltaTime > 0)) return;

        const delta = Math.min(deltaTime, 0.05);
        const substeps = Math.ceil(delta / MAX_SUBSTEP);
        const step = delta / substeps;
        const activityRise = 1 - Math.exp(-step / 0.12);
        const activityFall = 1 - Math.exp(-step / 2.4);
        const influenceRadiusSquared = influenceRadius * influenceRadius;
        for (let star = 0; star < 3; star += 1) {
            const velocity = starVelocities[star];
            const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
            const offset = star * 3;
            this.starDirections[offset] = speed > 0 ? velocity.x / speed : 0;
            this.starDirections[offset + 1] = speed > 0 ? velocity.y / speed : 0;
            this.starDirections[offset + 2] = speed > 0 ? velocity.z / speed : 0;
            this.starSpeeds[star] = speed;
        }

        for (let substep = 0; substep < substeps; substep += 1) {
            this.time += step;
            for (let particle = 0; particle < this.activity.length; particle += 1) {
                const offset = particle * 3;
                const x = this.positions[offset];
                const y = this.positions[offset + 1];
                const z = this.positions[offset + 2];
                const phase = this.phases[particle];
                const mobility = this.mobility[particle];
                let forceX = AMBIENT_FORCE * Math.sin(this.time * 0.65 + phase);
                let forceY = AMBIENT_FORCE * Math.sin(this.time * 0.91 + phase * 1.3);
                let forceZ = AMBIENT_FORCE * Math.sin(this.time * 0.73 + phase * 0.7);
                let influence = 0;

                for (let star = 0; star < 3; star += 1) {
                    const speed = this.starSpeeds[star];
                    if (speed === 0) continue;
                    let dx = x - starPositions[star].x;
                    let dy = y - starPositions[star].y;
                    let dz = z - starPositions[star].z;
                    const distanceSquared = dx * dx + dy * dy + dz * dz;
                    if (distanceSquared >= influenceRadiusSquared) continue;
                    const distance = Math.sqrt(distanceSquared);

                    const proximity = 1 - distance / influenceRadius;
                    const strength = proximity * proximity * (3 - 2 * proximity);
                    influence = Math.max(influence, strength * Math.min(1, speed / 3));
                    const directionOffset = star * 3;
                    const directionX = this.starDirections[directionOffset];
                    const directionY = this.starDirections[directionOffset + 1];
                    const directionZ = this.starDirections[directionOffset + 2];
                    if (distance > 0) {
                        dx /= distance;
                        dy /= distance;
                        dz /= distance;
                    } else {
                        dx = directionX;
                        dy = directionY;
                        dz = directionZ;
                    }
                    const projection = dx * directionX + dy * directionY + dz * directionZ;
                    const impact = STAR_IMPACT_PER_SPEED * strength * speed;
                    forceX += impact * (directionX + STAR_LATERAL_SPREAD * (dx - projection * directionX));
                    forceY += impact * (directionY + STAR_LATERAL_SPREAD * (dy - projection * directionY));
                    forceZ += impact * (directionZ + STAR_LATERAL_SPREAD * (dz - projection * directionZ));
                }

                this.velocities[offset] += (
                    SPRING_STIFFNESS * (this.restPositions[offset] - x)
                        - VELOCITY_DAMPING * this.velocities[offset]
                        + forceX * mobility
                ) * step;
                this.velocities[offset + 1] += (
                    SPRING_STIFFNESS * (this.restPositions[offset + 1] - y)
                        - VELOCITY_DAMPING * this.velocities[offset + 1]
                        + forceY * mobility
                ) * step;
                this.velocities[offset + 2] += (
                    SPRING_STIFFNESS * (this.restPositions[offset + 2] - z)
                        - VELOCITY_DAMPING * this.velocities[offset + 2]
                        + forceZ * mobility
                ) * step;
                this.positions[offset] += this.velocities[offset] * step;
                this.positions[offset + 1] += this.velocities[offset + 1] * step;
                this.positions[offset + 2] += this.velocities[offset + 2] * step;
                const activityBlend = influence > this.activity[particle] ? activityRise : activityFall;
                this.activity[particle] += (influence - this.activity[particle])
                    * activityBlend;
            }
        }
    }
}
