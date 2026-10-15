import type { Body } from './body';
import { type ContactGeometry, LINEAR_SLOP, type Manifold, collide, contactGeometry } from './collide';

/** Approach speeds below this don't bounce, so resting contacts settle, m/s. */
export const RESTITUTION_THRESHOLD = 0.5;
/** Fraction of penetration removed per position iteration. */
const BAUMGARTE = 0.2;
/** Cap on one position correction, so deep overlaps resolve over several steps, m. */
const MAX_LINEAR_CORRECTION = 0.2;

/**
 * A potentially touching pair of bodies. Holds the manifold across steps and
 * solves it with sequential impulses: accumulated normal impulses stay ≥ 0,
 * friction stays inside the Coulomb cone |Jt| ≤ μ·Jn, and the previous
 * step's impulses are applied up front (warm starting) so stacks settle.
 * Mixing: friction = √(μa·μb), restitution = max(ea, eb).
 */
export class Contact {
  readonly friction: number;
  readonly restitution: number;
  manifold: Manifold | null = null;

  private readonly geometry: ContactGeometry = { nx: 0, ny: 0, px: [], py: [], separation: [] };
  private nx = 0;
  private ny = 0;
  private readonly rAx = [0, 0];
  private readonly rAy = [0, 0];
  private readonly rBx = [0, 0];
  private readonly rBy = [0, 0];
  private readonly normalMass = [0, 0];
  private readonly tangentMass = [0, 0];
  private readonly bias = [0, 0];

  constructor(
    readonly a: Body,
    readonly b: Body,
  ) {
    this.friction = Math.sqrt(a.friction * b.friction);
    this.restitution = Math.max(a.restitution, b.restitution);
  }

  get touching(): boolean {
    return this.manifold !== null;
  }

  /** Re-runs the narrow phase, carrying impulses over to points whose features still touch. */
  update(): void {
    const previous = this.manifold;
    const next = collide(this.a, this.b);
    if (next && previous) {
      for (const p of next.points) {
        const match = previous.points.find((q) => q.id === p.id);
        if (match) {
          p.normalImpulse = match.normalImpulse;
          p.tangentImpulse = match.tangentImpulse;
        }
      }
    }
    this.manifold = next;
  }

  /** Lever arms, effective masses and restitution targets for this step. */
  initVelocity(): void {
    const m = this.manifold!;
    const { a, b, geometry: g } = this;
    contactGeometry(m, a, b, g);
    this.nx = g.nx;
    this.ny = g.ny;
    const tx = g.ny;
    const ty = -g.nx;
    for (let i = 0; i < m.points.length; i++) {
      const rAx = (this.rAx[i] = g.px[i] - a.x);
      const rAy = (this.rAy[i] = g.py[i] - a.y);
      const rBx = (this.rBx[i] = g.px[i] - b.x);
      const rBy = (this.rBy[i] = g.py[i] - b.y);
      const rnA = rAx * g.ny - rAy * g.nx;
      const rnB = rBx * g.ny - rBy * g.nx;
      const kn = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
      this.normalMass[i] = kn > 0 ? 1 / kn : 0;
      const rtA = rAx * ty - rAy * tx;
      const rtB = rBx * ty - rBy * tx;
      const kt = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;
      this.tangentMass[i] = kt > 0 ? 1 / kt : 0;
      const vn = this.relativeVelocityX(i) * g.nx + this.relativeVelocityY(i) * g.ny;
      this.bias[i] = vn < -RESTITUTION_THRESHOLD ? -this.restitution * vn : 0;
    }
  }

  warmStart(): void {
    const m = this.manifold!;
    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i];
      this.applyImpulse(i, p.normalImpulse * this.nx + p.tangentImpulse * this.ny, p.normalImpulse * this.ny - p.tangentImpulse * this.nx);
    }
  }

  solveVelocity(): void {
    const m = this.manifold!;
    const { nx, ny } = this;
    const tx = ny;
    const ty = -nx;

    // Friction first, bounded by the current normal impulse.
    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i];
      const vt = this.relativeVelocityX(i) * tx + this.relativeVelocityY(i) * ty;
      const limit = this.friction * p.normalImpulse;
      const total = Math.min(Math.max(p.tangentImpulse - this.tangentMass[i] * vt, -limit), limit);
      const lambda = total - p.tangentImpulse;
      p.tangentImpulse = total;
      this.applyImpulse(i, lambda * tx, lambda * ty);
    }

    // Normal impulse: push apart (never pull), aiming at the restitution target.
    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i];
      const vn = this.relativeVelocityX(i) * nx + this.relativeVelocityY(i) * ny;
      const total = Math.max(p.normalImpulse - this.normalMass[i] * (vn - this.bias[i]), 0);
      const lambda = total - p.normalImpulse;
      p.normalImpulse = total;
      this.applyImpulse(i, lambda * nx, lambda * ny);
    }
  }

  /**
   * Non-linear Gauss–Seidel push-out: moves the bodies directly (no velocity
   * change, so no energy is injected). Returns the smallest separation seen.
   */
  solvePosition(): number {
    const m = this.manifold!;
    const { a, b, geometry: g } = this;
    let minSeparation = 0;
    for (let i = 0; i < m.points.length; i++) {
      contactGeometry(m, a, b, g);
      const sep = g.separation[i];
      minSeparation = Math.min(minSeparation, sep);
      const C = Math.min(Math.max(BAUMGARTE * (sep + LINEAR_SLOP), -MAX_LINEAR_CORRECTION), 0);
      if (C === 0) continue;
      const rAx = g.px[i] - a.x;
      const rAy = g.py[i] - a.y;
      const rBx = g.px[i] - b.x;
      const rBy = g.py[i] - b.y;
      const rnA = rAx * g.ny - rAy * g.nx;
      const rnB = rBx * g.ny - rBy * g.nx;
      const k = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
      if (k === 0) continue;
      const impulse = -C / k;
      const px = impulse * g.nx;
      const py = impulse * g.ny;
      a.x -= a.invMass * px;
      a.y -= a.invMass * py;
      a.angle -= a.invInertia * (rAx * py - rAy * px);
      a.syncRotation();
      b.x += b.invMass * px;
      b.y += b.invMass * py;
      b.angle += b.invInertia * (rBx * py - rBy * px);
      b.syncRotation();
    }
    return minSeparation;
  }

  /** World contact points and normal at the current poses (for debug drawing). */
  worldGeometry(): ContactGeometry | null {
    if (!this.manifold) return null;
    const g: ContactGeometry = { nx: 0, ny: 0, px: [], py: [], separation: [] };
    contactGeometry(this.manifold, this.a, this.b, g);
    return g;
  }

  /** Velocity of B relative to A at contact point i. */
  private relativeVelocityX(i: number): number {
    return this.b.vx - this.b.omega * this.rBy[i] - (this.a.vx - this.a.omega * this.rAy[i]);
  }

  private relativeVelocityY(i: number): number {
    return this.b.vy + this.b.omega * this.rBx[i] - (this.a.vy + this.a.omega * this.rAx[i]);
  }

  /** Applies impulse P to B at point i and −P to A. */
  private applyImpulse(i: number, px: number, py: number): void {
    const { a, b } = this;
    a.vx -= a.invMass * px;
    a.vy -= a.invMass * py;
    a.omega -= a.invInertia * (this.rAx[i] * py - this.rAy[i] * px);
    b.vx += b.invMass * px;
    b.vy += b.invMass * py;
    b.omega += b.invInertia * (this.rBx[i] * py - this.rBy[i] * px);
  }
}
