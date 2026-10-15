import type { Particles } from './particles';
import { AIR_DENSITY, STANDARD_GRAVITY } from './units';
import { Vec2 } from './vec2';

/**
 * A force acting on particles. `pos`/`vel` are passed separately from
 * `particles` because integrators evaluate forces at trial states.
 */
export interface Force {
  /** Adds this force's contribution to accelerations in `acc` (length 2n). */
  apply(particles: Particles, pos: Float64Array, vel: Float64Array, t: number, acc: Float64Array): void;
  /** Potential energy, J. Only conservative forces define it. */
  potential?(particles: Particles, pos: Float64Array): number;
  /**
   * Power of a non-conservative force, W. Dissipative forces (drag,
   * friction) return ≤ 0 and feed the heat tally; driving forces
   * (`drives: true`) feed the external-work tally.
   */
  power?(particles: Particles, pos: Float64Array, vel: Float64Array, t: number): number;
  /** Marks a force that pumps energy in from outside (a hand, a motor, a loudspeaker). */
  readonly drives?: boolean;
}

/**
 * Periodic driving force F(t) = F₀·cos(ωt + φ) along a fixed direction on
 * chosen particles. Its work is booked as external work, so the energy
 * balance still closes for driven, damped oscillators.
 */
export class HarmonicForce implements Force {
  readonly drives = true;

  constructor(
    readonly targets: readonly number[],
    /** Force amplitude, N. */
    readonly amplitude: number,
    /** Angular frequency, rad/s. */
    readonly omega: number,
    readonly direction: Vec2 = new Vec2(1, 0),
    readonly phase = 0,
  ) {}

  force(t: number): number {
    return this.amplitude * Math.cos(this.omega * t + this.phase);
  }

  apply(particles: Particles, _pos: Float64Array, _vel: Float64Array, t: number, acc: Float64Array): void {
    const f = this.force(t);
    for (const i of this.targets) {
      acc[2 * i] += f * this.direction.x * particles.invMass[i];
      acc[2 * i + 1] += f * this.direction.y * particles.invMass[i];
    }
  }

  power(_particles: Particles, _pos: Float64Array, vel: Float64Array, t: number): number {
    const f = this.force(t);
    let p = 0;
    for (const i of this.targets) p += f * (this.direction.x * vel[2 * i] + this.direction.y * vel[2 * i + 1]);
    return p;
  }
}

/** Stokes drag F = −b·v: slow motion through a viscous medium, or plain damping. */
export class LinearDrag implements Force {
  constructor(
    /** Drag coefficient, kg/s. */
    readonly b: number,
  ) {}

  apply(particles: Particles, _pos: Float64Array, vel: Float64Array, _t: number, acc: Float64Array): void {
    for (let i = 0; i < particles.count; i++) {
      const s = this.b * particles.invMass[i];
      acc[2 * i] -= s * vel[2 * i];
      acc[2 * i + 1] -= s * vel[2 * i + 1];
    }
  }

  power(particles: Particles, _pos: Float64Array, vel: Float64Array): number {
    let p = 0;
    for (let i = 0; i < particles.count; i++) {
      if (particles.invMass[i] === 0) continue;
      p -= this.b * (vel[2 * i] ** 2 + vel[2 * i + 1] ** 2);
    }
    return p;
  }
}

/**
 * Air resistance on spheres, F = −½·ρ·C_d·A·|v|·v with A = πr² taken from
 * each particle's radius. Dominates over linear drag at everyday speeds.
 */
export class QuadraticDrag implements Force {
  constructor(
    /** Fluid density, kg/m³. */
    readonly density = AIR_DENSITY,
    /** Drag coefficient; about 0.47 for a smooth sphere. */
    readonly dragCoefficient = 0.47,
  ) {}

  /** ½·ρ·C_d·A for particle i, kg/m. */
  factor(particles: Particles, i: number): number {
    const r = particles.radius[i];
    return 0.5 * this.density * this.dragCoefficient * Math.PI * r * r;
  }

  apply(particles: Particles, _pos: Float64Array, vel: Float64Array, _t: number, acc: Float64Array): void {
    for (let i = 0; i < particles.count; i++) {
      const vx = vel[2 * i];
      const vy = vel[2 * i + 1];
      const s = this.factor(particles, i) * Math.hypot(vx, vy) * particles.invMass[i];
      acc[2 * i] -= s * vx;
      acc[2 * i + 1] -= s * vy;
    }
  }

  power(particles: Particles, _pos: Float64Array, vel: Float64Array): number {
    let p = 0;
    for (let i = 0; i < particles.count; i++) {
      if (particles.invMass[i] === 0) continue;
      p -= this.factor(particles, i) * Math.hypot(vel[2 * i], vel[2 * i + 1]) ** 3;
    }
    return p;
  }
}

/**
 * Kinetic friction from a surface the particles slide or roll on, seen from
 * above (billiard table, ice rink): F = −μ·m·g·v̂.
 *
 * Coulomb friction flips direction at v = 0, which makes explicit integrators
 * chatter. Below `smoothing` speed the force fades linearly to zero instead.
 */
export class SurfaceFriction implements Force {
  constructor(
    readonly mu: number,
    readonly g = STANDARD_GRAVITY,
    /** m/s */
    readonly smoothing = 0.005,
  ) {}

  apply(particles: Particles, _pos: Float64Array, vel: Float64Array, _t: number, acc: Float64Array): void {
    for (let i = 0; i < particles.count; i++) {
      const vx = vel[2 * i];
      const vy = vel[2 * i + 1];
      const s = (this.mu * this.g) / Math.max(Math.hypot(vx, vy), this.smoothing);
      acc[2 * i] -= s * vx;
      acc[2 * i + 1] -= s * vy;
    }
  }

  power(particles: Particles, _pos: Float64Array, vel: Float64Array): number {
    let p = 0;
    for (let i = 0; i < particles.count; i++) {
      if (particles.invMass[i] === 0) continue;
      const speed = Math.hypot(vel[2 * i], vel[2 * i + 1]);
      p -= (particles.mass[i] * this.mu * this.g * speed * speed) / Math.max(speed, this.smoothing);
    }
    return p;
  }
}

/** Constant gravitational field, e.g. near Earth's surface. */
export class UniformGravity implements Force {
  constructor(
    readonly g: Vec2 = new Vec2(0, -STANDARD_GRAVITY),
    /** Point of zero potential energy, e.g. a pendulum's lowest point. */
    readonly reference: Vec2 = Vec2.ZERO,
  ) {}

  apply(particles: Particles, _pos: Float64Array, _vel: Float64Array, _t: number, acc: Float64Array): void {
    for (let i = 0; i < particles.count; i++) {
      acc[2 * i] += this.g.x;
      acc[2 * i + 1] += this.g.y;
    }
  }

  potential(particles: Particles, pos: Float64Array): number {
    // U = −m g·(r − r₀)
    let u = 0;
    for (let i = 0; i < particles.count; i++) {
      const dx = pos[2 * i] - this.reference.x;
      const dy = pos[2 * i + 1] - this.reference.y;
      u -= particles.mass[i] * (this.g.x * dx + this.g.y * dy);
    }
    return u;
  }
}

/** Spring endpoint: a particle index or a fixed anchor point. */
export type SpringEnd = number | Vec2;

/** Hookean spring: F = −k (|d| − L) d̂. A rest length of 0 gives F = −k d. */
export class Spring implements Force {
  constructor(
    readonly a: SpringEnd,
    readonly b: SpringEnd,
    /** Stiffness, N/m. */
    readonly k: number,
    /** Rest length, m. */
    readonly restLength = 0,
  ) {}

  apply(particles: Particles, pos: Float64Array, _vel: Float64Array, _t: number, acc: Float64Array): void {
    const ax = endX(this.a, pos);
    const ay = endY(this.a, pos);
    const dx = endX(this.b, pos) - ax;
    const dy = endY(this.b, pos) - ay;

    let s: number;
    if (this.restLength === 0) {
      s = -this.k;
    } else {
      const d = Math.hypot(dx, dy);
      if (d === 0) return; // direction undefined
      s = (-this.k * (d - this.restLength)) / d;
    }
    // (fx, fy) is the force on end b; end a gets the opposite.
    const fx = s * dx;
    const fy = s * dy;

    if (typeof this.b === 'number') {
      acc[2 * this.b] += fx / particles.mass[this.b];
      acc[2 * this.b + 1] += fy / particles.mass[this.b];
    }
    if (typeof this.a === 'number') {
      acc[2 * this.a] -= fx / particles.mass[this.a];
      acc[2 * this.a + 1] -= fy / particles.mass[this.a];
    }
  }

  potential(_particles: Particles, pos: Float64Array): number {
    const d = Math.hypot(endX(this.b, pos) - endX(this.a, pos), endY(this.b, pos) - endY(this.a, pos));
    const stretch = d - this.restLength;
    return 0.5 * this.k * stretch * stretch;
  }
}

function endX(end: SpringEnd, pos: Float64Array): number {
  return typeof end === 'number' ? pos[2 * end] : end.x;
}

function endY(end: SpringEnd, pos: Float64Array): number {
  return typeof end === 'number' ? pos[2 * end + 1] : end.y;
}
