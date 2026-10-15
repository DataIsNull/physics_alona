import type { Particles } from './particles';
import { STANDARD_GRAVITY } from './units';
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
}

/** Constant gravitational field, e.g. near Earth's surface. */
export class UniformGravity implements Force {
  constructor(readonly g: Vec2 = new Vec2(0, -STANDARD_GRAVITY)) {}

  apply(particles: Particles, _pos: Float64Array, _vel: Float64Array, _t: number, acc: Float64Array): void {
    for (let i = 0; i < particles.count; i++) {
      acc[2 * i] += this.g.x;
      acc[2 * i + 1] += this.g.y;
    }
  }

  potential(particles: Particles, pos: Float64Array): number {
    // U = −m g·r
    let u = 0;
    for (let i = 0; i < particles.count; i++) {
      u -= particles.mass[i] * (this.g.x * pos[2 * i] + this.g.y * pos[2 * i + 1]);
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
