import type { Particles } from './particles';
import { SpatialHash } from './spatialHash';
import { Vec2 } from './vec2';

/** Static boundary: the half-plane (x − point)·normal ≥ 0 is open space. */
export interface Wall {
  point: Vec2;
  /** Unit normal pointing into open space. */
  normal: Vec2;
  restitution: number;
  friction: number;
}

export function wall(point: Vec2, normal: Vec2, restitution = 1, friction = 0): Wall {
  return { point, normal: normal.normalize(), restitution, friction };
}

/** Four walls enclosing the rectangle [min, max]. */
export function box(min: Vec2, max: Vec2, restitution = 1, friction = 0): Wall[] {
  return [
    wall(min, new Vec2(1, 0), restitution, friction),
    wall(min, new Vec2(0, 1), restitution, friction),
    wall(max, new Vec2(-1, 0), restitution, friction),
    wall(max, new Vec2(0, -1), restitution, friction),
  ];
}

export interface CollisionOptions {
  walls?: Wall[];
  /** Velocity solver passes per step. */
  iterations?: number;
  /** Approach speeds below this don't bounce, so resting contacts stay put, m/s. */
  restingSpeed?: number;
}

/** Contact between A and B with unit normal n pointing from A to B. A = −1 is a wall. */
interface Contact {
  a: number;
  b: number;
  nx: number;
  ny: number;
  depth: number;
  slop: number;
  restitution: number;
  friction: number;
  /** Normal relative velocity the solver aims for (from restitution). */
  bounce: number;
  normalImpulse: number;
  tangentImpulse: number;
}

/** Fraction of penetration removed per step; below 1 avoids overshoot jitter. */
const POSITION_CORRECTION = 0.8;
/** Penetration tolerated without correction, as a fraction of the radii sum. */
const SLOP = 0.002;

/**
 * Circle–circle and circle–wall contacts resolved with sequential impulses:
 * restitution along the normal, Coulomb friction along the tangent (|Jt| ≤ μ·Jn),
 * then a positional push-out for any remaining overlap. Mixing rules for two
 * materials: restitution = min(e₁, e₂), friction = √(μ₁·μ₂).
 */
export class Collisions {
  readonly walls: readonly Wall[];
  iterations: number;
  restingSpeed: number;

  private readonly hash = new SpatialHash();
  private readonly contacts: Contact[] = [];
  private contactCount = 0;

  constructor(options: CollisionOptions = {}) {
    this.walls = options.walls ?? [];
    this.iterations = options.iterations ?? 8;
    this.restingSpeed = options.restingSpeed ?? 0.1;
  }

  resolve(p: Particles): void {
    this.contactCount = 0;
    this.findParticleContacts(p);
    this.findWallContacts(p);
    if (this.contactCount === 0) return;

    for (let k = 0; k < this.contactCount; k++) this.prepare(p, this.contacts[k]);
    for (let it = 0; it < this.iterations; it++) {
      for (let k = 0; k < this.contactCount; k++) this.solveVelocity(p, this.contacts[k]);
    }
    for (let k = 0; k < this.contactCount; k++) this.correctPosition(p, this.contacts[k]);
  }

  private findParticleContacts(p: Particles): void {
    const { count, pos, radius, invMass, restitution, friction } = p;
    let maxRadius = 0;
    for (let i = 0; i < count; i++) maxRadius = Math.max(maxRadius, radius[i]);
    if (count < 2 || maxRadius === 0) return;

    this.hash.build(pos, count, 2 * maxRadius);
    this.hash.forEachPair(count, (i, j) => {
      if (invMass[i] + invMass[j] === 0) return;
      const reach = radius[i] + radius[j];
      if (reach === 0) return;
      const dx = pos[2 * j] - pos[2 * i];
      const dy = pos[2 * j + 1] - pos[2 * i + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) return;
      const d = Math.sqrt(d2);
      const c = this.push();
      c.a = i;
      c.b = j;
      // Coincident centres: any direction will do.
      c.nx = d > 0 ? dx / d : 1;
      c.ny = d > 0 ? dy / d : 0;
      c.depth = reach - d;
      c.slop = SLOP * reach;
      c.restitution = Math.min(restitution[i], restitution[j]);
      c.friction = Math.sqrt(friction[i] * friction[j]);
    });
  }

  private findWallContacts(p: Particles): void {
    const { count, pos, radius, invMass, restitution, friction } = p;
    for (const w of this.walls) {
      for (let i = 0; i < count; i++) {
        if (invMass[i] === 0) continue;
        const gap = (pos[2 * i] - w.point.x) * w.normal.x + (pos[2 * i + 1] - w.point.y) * w.normal.y - radius[i];
        if (gap >= 0) continue;
        const c = this.push();
        c.a = -1;
        c.b = i;
        c.nx = w.normal.x;
        c.ny = w.normal.y;
        c.depth = -gap;
        c.slop = SLOP * radius[i];
        c.restitution = Math.min(restitution[i], w.restitution);
        c.friction = Math.sqrt(friction[i] * w.friction);
      }
    }
  }

  private prepare(p: Particles, c: Contact): void {
    const vn = this.relativeVelocityX(p, c) * c.nx + this.relativeVelocityY(p, c) * c.ny;
    c.bounce = vn < -this.restingSpeed ? -c.restitution * vn : 0;
    c.normalImpulse = 0;
    c.tangentImpulse = 0;
  }

  private solveVelocity(p: Particles, c: Contact): void {
    const { vel, invMass } = p;
    const wa = c.a < 0 ? 0 : invMass[c.a];
    const wb = invMass[c.b];
    const w = wa + wb;

    // Normal impulse, accumulated and clamped so contacts only ever push.
    let rvx = this.relativeVelocityX(p, c);
    let rvy = this.relativeVelocityY(p, c);
    const vn = rvx * c.nx + rvy * c.ny;
    const total = Math.max(c.normalImpulse + (c.bounce - vn) / w, 0);
    const jn = total - c.normalImpulse;
    c.normalImpulse = total;
    this.applyImpulse(vel, c, wa, wb, jn * c.nx, jn * c.ny);

    // Friction impulse along the tangent, bounded by the Coulomb cone.
    if (c.friction === 0) return;
    rvx = this.relativeVelocityX(p, c);
    rvy = this.relativeVelocityY(p, c);
    const tx = -c.ny;
    const ty = c.nx;
    const limit = c.friction * c.normalImpulse;
    const tangent = Math.min(Math.max(c.tangentImpulse - (rvx * tx + rvy * ty) / w, -limit), limit);
    const jt = tangent - c.tangentImpulse;
    c.tangentImpulse = tangent;
    this.applyImpulse(vel, c, wa, wb, jt * tx, jt * ty);
  }

  private correctPosition(p: Particles, c: Contact): void {
    const { pos, invMass } = p;
    const wa = c.a < 0 ? 0 : invMass[c.a];
    const wb = invMass[c.b];
    const push = (POSITION_CORRECTION * Math.max(c.depth - c.slop, 0)) / (wa + wb);
    if (push === 0) return;
    if (c.a >= 0) {
      pos[2 * c.a] -= wa * push * c.nx;
      pos[2 * c.a + 1] -= wa * push * c.ny;
    }
    pos[2 * c.b] += wb * push * c.nx;
    pos[2 * c.b + 1] += wb * push * c.ny;
  }

  private applyImpulse(vel: Float64Array, c: Contact, wa: number, wb: number, jx: number, jy: number): void {
    if (c.a >= 0) {
      vel[2 * c.a] -= wa * jx;
      vel[2 * c.a + 1] -= wa * jy;
    }
    vel[2 * c.b] += wb * jx;
    vel[2 * c.b + 1] += wb * jy;
  }

  private relativeVelocityX(p: Particles, c: Contact): number {
    return p.vel[2 * c.b] - (c.a < 0 ? 0 : p.vel[2 * c.a]);
  }

  private relativeVelocityY(p: Particles, c: Contact): number {
    return p.vel[2 * c.b + 1] - (c.a < 0 ? 0 : p.vel[2 * c.a + 1]);
  }

  private push(): Contact {
    if (this.contactCount === this.contacts.length) {
      this.contacts.push({
        a: 0,
        b: 0,
        nx: 0,
        ny: 0,
        depth: 0,
        slop: 0,
        restitution: 0,
        friction: 0,
        bounce: 0,
        normalImpulse: 0,
        tangentImpulse: 0,
      });
    }
    return this.contacts[this.contactCount++];
  }
}
