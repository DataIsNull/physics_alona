import type { Vec2 } from '../core/vec2';
import type { Body } from './body';

const MAX_LINEAR_CORRECTION = 0.2;
/**
 * Joints are iterated to a much tighter tolerance than contacts: SHAKE only
 * conserves energy when the rods are actually restored, m.
 */
const JOINT_TOLERANCE = 1e-7;

/** A velocity-level constraint between two bodies, solved alongside contacts. */
export interface Joint {
  readonly a: Body;
  readonly b: Body;
  /** Motorised joints keep their bodies awake. */
  readonly hasMotor: boolean;
  initVelocity(dt: number): void;
  warmStart(): void;
  solveVelocity(): void;
  /** Returns true when the position error is within tolerance. */
  solvePosition(): boolean;
  /** Work done by a motor during the step just solved, J (0 without one). */
  motorWork(): number;
  /** Current anchor points in world space (for drawing). */
  anchors(): [Vec2Like, Vec2Like];
  reset(): void;
}

export interface Vec2Like {
  x: number;
  y: number;
}

/** Rotates a body-local vector into world space. */
const rotX = (b: Body, x: number, y: number) => b.cos * x - b.sin * y;
const rotY = (b: Body, x: number, y: number) => b.sin * x + b.cos * y;

function applyLinear(a: Body, b: Body, rAx: number, rAy: number, rBx: number, rBy: number, px: number, py: number): void {
  a.vx -= a.invMass * px;
  a.vy -= a.invMass * py;
  a.omega -= a.invInertia * (rAx * py - rAy * px);
  b.vx += b.invMass * px;
  b.vy += b.invMass * py;
  b.omega += b.invInertia * (rBx * py - rBy * px);
}

/**
 * Position correction for joints, applied with the lever arms from the start
 * of the step and fed into the velocities (Δv = Δx/dt): SHAKE for rigid
 * bodies. Pushing along the current geometry instead (as Box2D does), or not
 * feeding velocities, quietly drains energy from every swinging chain.
 */
function moveLinear(a: Body, b: Body, rAx: number, rAy: number, rBx: number, rBy: number, px: number, py: number, dt: number): void {
  const daX = -a.invMass * px;
  const daY = -a.invMass * py;
  const daA = -a.invInertia * (rAx * py - rAy * px);
  const dbX = b.invMass * px;
  const dbY = b.invMass * py;
  const dbA = b.invInertia * (rBx * py - rBy * px);
  a.x += daX;
  a.y += daY;
  a.angle += daA;
  a.syncRotation();
  b.x += dbX;
  b.y += dbY;
  b.angle += dbA;
  b.syncRotation();
  a.vx += daX / dt;
  a.vy += daY / dt;
  a.omega += daA / dt;
  b.vx += dbX / dt;
  b.vy += dbY / dt;
  b.omega += dbA / dt;
}

export interface RevoluteOptions {
  /** Target relative angular velocity ωB − ωA, rad/s. */
  motorSpeed?: number;
  /** Strongest torque the motor can apply, N·m. 0 = no motor. */
  maxMotorTorque?: number;
}

/**
 * Pin joint: a point fixed in both bodies stays coincident, while the bodies
 * rotate freely about it. Optionally drives the relative rotation with a
 * torque-limited motor.
 */
export class RevoluteJoint implements Joint {
  readonly motorSpeed: number;
  readonly maxMotorTorque: number;

  private readonly lax: number;
  private readonly lay: number;
  private readonly lbx: number;
  private readonly lby: number;
  private impulseX = 0;
  private impulseY = 0;
  private motorImpulse = 0;
  private maxMotorImpulse = 0;
  private dt = 1;
  /** Relative angle θB − θA at the start of the step. */
  private startAngle = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private k11 = 0;
  private k12 = 0;
  private k22 = 0;

  constructor(
    readonly a: Body,
    readonly b: Body,
    anchor: Vec2,
    options: RevoluteOptions = {},
  ) {
    this.lax = a.localX(anchor.x, anchor.y);
    this.lay = a.localY(anchor.x, anchor.y);
    this.lbx = b.localX(anchor.x, anchor.y);
    this.lby = b.localY(anchor.x, anchor.y);
    this.motorSpeed = options.motorSpeed ?? 0;
    this.maxMotorTorque = options.maxMotorTorque ?? 0;
  }

  get hasMotor(): boolean {
    return this.maxMotorTorque > 0;
  }

  initVelocity(dt: number): void {
    const { a, b } = this;
    this.rAx = rotX(a, this.lax, this.lay);
    this.rAy = rotY(a, this.lax, this.lay);
    this.rBx = rotX(b, this.lbx, this.lby);
    this.rBy = rotY(b, this.lbx, this.lby);
    this.computeK();
    this.maxMotorImpulse = this.maxMotorTorque * dt;
    this.dt = dt;
    this.startAngle = b.angle - a.angle;
  }

  warmStart(): void {
    const { a, b } = this;
    applyLinear(a, b, this.rAx, this.rAy, this.rBx, this.rBy, this.impulseX, this.impulseY);
    this.applyAngular(this.motorImpulse);
  }

  solveVelocity(): void {
    const { a, b } = this;
    if (this.hasMotor) {
      const relative = b.omega - a.omega;
      const angularMass = a.invInertia + b.invInertia;
      if (angularMass > 0) {
        const old = this.motorImpulse;
        const target = old - (relative - this.motorSpeed) / angularMass;
        this.motorImpulse = Math.min(Math.max(target, -this.maxMotorImpulse), this.maxMotorImpulse);
        this.applyAngular(this.motorImpulse - old);
      }
    }

    // Relative velocity of the two anchor points must vanish: K·λ = −Ċ.
    const cx = b.vx - b.omega * this.rBy - a.vx + a.omega * this.rAy;
    const cy = b.vy + b.omega * this.rBx - a.vy - a.omega * this.rAx;
    const [lx, ly] = this.solveK(-cx, -cy);
    this.impulseX += lx;
    this.impulseY += ly;
    applyLinear(a, b, this.rAx, this.rAy, this.rBx, this.rBy, lx, ly);
  }

  solvePosition(): boolean {
    const { a, b, rAx, rAy, rBx, rBy } = this;
    // Where the anchors are now…
    const cAx = rotX(a, this.lax, this.lay);
    const cAy = rotY(a, this.lax, this.lay);
    const cBx = rotX(b, this.lbx, this.lby);
    const cBy = rotY(b, this.lbx, this.lby);
    const cx = b.x + cBx - a.x - cAx;
    const cy = b.y + cBy - a.y - cAy;
    // …and how they respond to an impulse applied with the step-start lever
    // arms (r): K' = (mA + mB)·1 + iA·perp(cA)·perp(rA)ᵀ + iB·perp(cB)·perp(rB)ᵀ.
    const m = a.invMass + b.invMass;
    const iA = a.invInertia;
    const iB = b.invInertia;
    const k11 = m + iA * cAy * rAy + iB * cBy * rBy;
    const k12 = -iA * cAy * rAx - iB * cBy * rBx;
    const k21 = -iA * cAx * rAy - iB * cBx * rBy;
    const k22 = m + iA * cAx * rAx + iB * cBx * rBx;
    const det = k11 * k22 - k12 * k21;
    if (det !== 0) {
      const px = (-k22 * cx + k12 * cy) / det;
      const py = (k21 * cx - k11 * cy) / det;
      moveLinear(a, b, rAx, rAy, rBx, rBy, px, py, this.dt);
    }
    return Math.hypot(cx, cy) <= JOINT_TOLERANCE;
  }

  anchors(): [Vec2Like, Vec2Like] {
    const { a, b } = this;
    return [
      { x: a.worldX(this.lax, this.lay), y: a.worldY(this.lax, this.lay) },
      { x: b.worldX(this.lbx, this.lby), y: b.worldY(this.lbx, this.lby) },
    ];
  }

  /**
   * The motor holds a constant torque Λ/dt through the step, so its work is
   * torque × relative rotation. (Summing λ·Δω over solver iterations instead
   * would depend on the iteration path, not on the motion.)
   */
  motorWork(): number {
    if (!this.hasMotor) return 0;
    return (this.motorImpulse / this.dt) * (this.b.angle - this.a.angle - this.startAngle);
  }

  reset(): void {
    this.impulseX = this.impulseY = this.motorImpulse = 0;
  }

  /** Applies an angular impulse: B gets +λ, A gets −λ. */
  private applyAngular(lambda: number): void {
    this.a.omega -= this.a.invInertia * lambda;
    this.b.omega += this.b.invInertia * lambda;
  }

  private computeK(): void {
    const { a, b, rAx, rAy, rBx, rBy } = this;
    const m = a.invMass + b.invMass;
    this.k11 = m + a.invInertia * rAy * rAy + b.invInertia * rBy * rBy;
    this.k12 = -a.invInertia * rAx * rAy - b.invInertia * rBx * rBy;
    this.k22 = m + a.invInertia * rAx * rAx + b.invInertia * rBx * rBx;
  }

  private solveK(bx: number, by: number): [number, number] {
    const det = this.k11 * this.k22 - this.k12 * this.k12;
    if (det === 0) return [0, 0];
    return [(this.k22 * bx - this.k12 * by) / det, (this.k11 * by - this.k12 * bx) / det];
  }
}

/** Massless rigid rod between two anchor points; each end pivots freely. */
export class DistanceJoint implements Joint {
  readonly length: number;
  readonly hasMotor = false;

  private readonly lax: number;
  private readonly lay: number;
  private readonly lbx: number;
  private readonly lby: number;
  private impulse = 0;
  private dt = 1;
  private ux = 0;
  private uy = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private mass = 0;

  constructor(
    readonly a: Body,
    readonly b: Body,
    anchorA: Vec2,
    anchorB: Vec2,
  ) {
    this.lax = a.localX(anchorA.x, anchorA.y);
    this.lay = a.localY(anchorA.x, anchorA.y);
    this.lbx = b.localX(anchorB.x, anchorB.y);
    this.lby = b.localY(anchorB.x, anchorB.y);
    this.length = anchorA.distanceTo(anchorB);
  }

  initVelocity(dt: number): void {
    this.dt = dt;
    const len = this.prepare();
    if (len === 0) this.mass = 0;
  }

  warmStart(): void {
    applyLinear(this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy, this.impulse * this.ux, this.impulse * this.uy);
  }

  solveVelocity(): void {
    const { a, b } = this;
    const vx = b.vx - b.omega * this.rBy - a.vx + a.omega * this.rAy;
    const vy = b.vy + b.omega * this.rBx - a.vy - a.omega * this.rAx;
    const lambda = -this.mass * (vx * this.ux + vy * this.uy);
    this.impulse += lambda;
    applyLinear(a, b, this.rAx, this.rAy, this.rBx, this.rBy, lambda * this.ux, lambda * this.uy);
  }

  solvePosition(): boolean {
    const { a, b, rAx, rAy, rBx, rBy, ux, uy } = this;
    const cAx = rotX(a, this.lax, this.lay);
    const cAy = rotY(a, this.lax, this.lay);
    const cBx = rotX(b, this.lbx, this.lby);
    const cBy = rotY(b, this.lbx, this.lby);
    const dx = b.x + cBx - a.x - cAx;
    const dy = b.y + cBy - a.y - cAy;
    const len = Math.hypot(dx, dy);
    if (len === 0) return false;
    const error = len - this.length;
    const C = Math.min(Math.max(error, -MAX_LINEAR_CORRECTION), MAX_LINEAR_CORRECTION);
    // Response of the current length to an impulse along the step-start rod direction u.
    const crA = rAx * uy - rAy * ux;
    const crB = rBx * uy - rBy * ux;
    const shiftX = (a.invMass + b.invMass) * ux - a.invInertia * crA * cAy - b.invInertia * crB * cBy;
    const shiftY = (a.invMass + b.invMass) * uy + a.invInertia * crA * cAx + b.invInertia * crB * cBx;
    const k = (dx * shiftX + dy * shiftY) / len;
    if (k !== 0) {
      const lambda = -C / k;
      moveLinear(a, b, rAx, rAy, rBx, rBy, lambda * ux, lambda * uy, this.dt);
    }
    return Math.abs(error) <= JOINT_TOLERANCE;
  }

  anchors(): [Vec2Like, Vec2Like] {
    const { a, b } = this;
    return [
      { x: a.worldX(this.lax, this.lay), y: a.worldY(this.lax, this.lay) },
      { x: b.worldX(this.lbx, this.lby), y: b.worldY(this.lbx, this.lby) },
    ];
  }

  motorWork(): number {
    return 0;
  }

  reset(): void {
    this.impulse = 0;
  }

  /** Lever arms, rod direction and effective mass at the current poses; returns the rod length. */
  private prepare(): number {
    const { a, b } = this;
    this.rAx = rotX(a, this.lax, this.lay);
    this.rAy = rotY(a, this.lax, this.lay);
    this.rBx = rotX(b, this.lbx, this.lby);
    this.rBy = rotY(b, this.lbx, this.lby);
    const dx = b.x + this.rBx - a.x - this.rAx;
    const dy = b.y + this.rBy - a.y - this.rAy;
    const len = Math.hypot(dx, dy);
    if (len === 0) return 0;
    this.ux = dx / len;
    this.uy = dy / len;
    const crA = this.rAx * this.uy - this.rAy * this.ux;
    const crB = this.rBx * this.uy - this.rBy * this.ux;
    const k = a.invMass + b.invMass + a.invInertia * crA * crA + b.invInertia * crB * crB;
    this.mass = k > 0 ? 1 / k : 0;
    return len;
  }
}
