import type { Particles } from './particles';

/** Keeps two particles at a fixed distance: a massless rigid rod. */
export class DistanceConstraint {
  constructor(
    readonly a: number,
    readonly b: number,
    /** m */
    readonly length: number,
  ) {}

  /** A rod whose length is the particles' current separation. */
  static between(particles: Particles, a: number, b: number): DistanceConstraint {
    return new DistanceConstraint(a, b, particles.position(a).distanceTo(particles.position(b)));
  }
}

/**
 * Enforces rods around an unconstrained integrator step, RATTLE-style:
 *
 * 1. SHAKE: Gauss–Seidel passes move positions back onto the rods, pushing
 *    along each rod's direction *before* the step (projecting along the new
 *    direction instead would bleed energy every step).
 * 2. The position correction is a constraint impulse, so it also goes into
 *    the velocities: v += Δx/dt.
 * 3. Velocity components that would stretch a rod are removed.
 *
 * With velocity Verlet this reproduces RATTLE, which conserves energy over
 * long runs. Fixed particles (invMass = 0) never move.
 */
export class ConstraintSolver {
  private before = new Float64Array(0);
  private unconstrained = new Float64Array(0);

  constructor(public iterations = 10) {}

  /** Call with the positions at the start of the step, before integrating. */
  begin(pos: Float64Array): void {
    if (this.before.length !== pos.length) {
      this.before = new Float64Array(pos.length);
      this.unconstrained = new Float64Array(pos.length);
    }
    this.before.set(pos);
  }

  /** Call after the integrator has advanced positions and velocities by dt. */
  solve(particles: Particles, constraints: readonly DistanceConstraint[], dt: number): void {
    const { pos, vel, invMass } = particles;
    const before = this.before;
    this.unconstrained.set(pos);

    for (let it = 0; it < this.iterations; it++) {
      for (const c of constraints) {
        const wa = invMass[c.a];
        const wb = invMass[c.b];
        const w = wa + wb;
        if (w === 0) continue;
        const dx = pos[2 * c.b] - pos[2 * c.a];
        const dy = pos[2 * c.b + 1] - pos[2 * c.a + 1];
        let ox = before[2 * c.b] - before[2 * c.a];
        let oy = before[2 * c.b + 1] - before[2 * c.a + 1];
        let dot = dx * ox + dy * oy;
        const d2 = dx * dx + dy * dy;
        if (dot <= 0.5 * Math.sqrt(d2 * (ox * ox + oy * oy))) {
          // Rod turned more than 60° within one step (violent motion or huge dt):
          // SHAKE's correction blows up, so project along the current direction.
          ox = dx;
          oy = dy;
          dot = d2;
          if (dot === 0) continue;
        }
        const g = (dx * dx + dy * dy - c.length * c.length) / (2 * dot * w);
        pos[2 * c.a] += wa * g * ox;
        pos[2 * c.a + 1] += wa * g * oy;
        pos[2 * c.b] -= wb * g * ox;
        pos[2 * c.b + 1] -= wb * g * oy;
      }
    }

    for (let k = 0; k < pos.length; k++) vel[k] += (pos[k] - this.unconstrained[k]) / dt;

    for (let it = 0; it < this.iterations; it++) {
      for (const c of constraints) {
        const wa = invMass[c.a];
        const wb = invMass[c.b];
        const w = wa + wb;
        if (w === 0) continue;
        const dx = pos[2 * c.b] - pos[2 * c.a];
        const dy = pos[2 * c.b + 1] - pos[2 * c.a + 1];
        const d = Math.hypot(dx, dy);
        if (d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const lambda = ((vel[2 * c.b] - vel[2 * c.a]) * nx + (vel[2 * c.b + 1] - vel[2 * c.a + 1]) * ny) / w;
        vel[2 * c.a] += wa * lambda * nx;
        vel[2 * c.a + 1] += wa * lambda * ny;
        vel[2 * c.b] -= wb * lambda * nx;
        vel[2 * c.b + 1] -= wb * lambda * ny;
      }
    }
  }
}
