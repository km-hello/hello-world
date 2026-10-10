const SPRING_STIFFNESS = 0.4;
const VELOCITY_DAMPING = 0.95;
const STAR_REPULSION = 18;
const STAR_SWIRL = 4.5;
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
        this.time = 0;
        for (let particle = 0; particle < this.activity.length; particle += 1) {
            this.phases[particle] = particle * 2.399963229728653;
            this.mobility[particle] = 1 + 0.25 * Math.sin(particle * 1.61803398875);
        }
    }

    update(starPositions, deltaTime, influenceRadius) {
        if (!(deltaTime > 0)) return;

        const delta = Math.min(deltaTime, 0.05);
        const substeps = Math.ceil(delta / MAX_SUBSTEP);
        const step = delta / substeps;
        const activityRise = 1 - Math.exp(-step / 0.12);
        const activityFall = 1 - Math.exp(-step / 2.4);

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
                    let dx = x - starPositions[star].x;
                    let dy = y - starPositions[star].y;
                    let dz = z - starPositions[star].z;
                    const distance = Math.hypot(dx, dy, dz);
                    if (distance >= influenceRadius) continue;

                    const proximity = 1 - distance / influenceRadius;
                    const strength = proximity * proximity * (3 - 2 * proximity);
                    influence = Math.max(influence, strength);
                    if (distance > 0) {
                        dx /= distance;
                        dy /= distance;
                        dz /= distance;
                    } else {
                        // Stable directions disperse coincident particles without random flicker.
                        dx = Math.cos(phase);
                        dy = Math.sin(phase);
                        dz = 0;
                    }
                    forceX += STAR_REPULSION * strength * dx;
                    forceY += STAR_REPULSION * strength * dy;
                    forceZ += STAR_REPULSION * strength * dz;
                    const swirl = STAR_SWIRL * strength;
                    if (star === 0) {
                        forceX -= swirl * dy;
                        forceY += swirl * dx;
                    } else if (star === 1) {
                        forceX -= swirl * dz;
                        forceZ += swirl * dx;
                    } else {
                        forceY -= swirl * dz;
                        forceZ += swirl * dy;
                    }
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
