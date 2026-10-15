import type { Vec2 } from '../core/vec2';
import { type Shape, massData } from './shapes';

export interface BodySpec {
  shape: Shape;
  /** Centre of mass, m. */
  position: Vec2;
  /** rad */
  angle?: number;
  velocity?: Vec2;
  /** rad/s, counter-clockwise positive. */
  angularVelocity?: number;
  /** Areal density, kg/m². Ignored when `mass` is given. */
  density?: number;
  /** kg; overrides density. */
  mass?: number;
  /** Moment of inertia about the centroid, kg·m²; overrides the shape's. */
  inertia?: number;
  /** Static bodies never move: ground, walls, ramps. */
  static?: boolean;
  /** Translates but never rotates (a point mass on a rod, a sliding piston). */
  fixedRotation?: boolean;
  /** Coefficient of restitution, 0 … 1. */
  restitution?: number;
  /** Coulomb friction coefficient. */
  friction?: number;
  color?: string;
  /** Leave a trail of the centre of mass, or of this point in the body's frame. */
  trail?: boolean | Vec2;
}

/**
 * A rigid body: position of the centre of mass, angle, and their rates.
 * World-space vertices and the bounding box are cached by syncTransform().
 */
export class Body {
  readonly index: number;
  readonly shape: Shape;
  readonly isStatic: boolean;
  readonly mass: number;
  readonly invMass: number;
  readonly inertia: number;
  readonly invInertia: number;
  readonly restitution: number;
  readonly friction: number;
  readonly color: string;
  readonly trail: boolean;
  /** Body-local point that leaves the trail. */
  readonly trailPoint: { x: number; y: number };

  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  omega: number;
  cos = 1;
  sin = 0;

  /** Sleeping bodies are skipped by the integrator and solver until something wakes them. */
  awake = true;
  /** How long the body has been nearly still, s. */
  sleepTime = 0;

  // Cached world-space geometry
  readonly wxs: number[] = [];
  readonly wys: number[] = [];
  readonly wnxs: number[] = [];
  readonly wnys: number[] = [];
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  private readonly initial: [x: number, y: number, angle: number, vx: number, vy: number, omega: number];

  constructor(spec: BodySpec, index: number) {
    this.index = index;
    this.shape = spec.shape;
    this.isStatic = spec.static ?? false;
    const md = massData(spec.shape, spec.density ?? 1);
    const scale = spec.mass !== undefined ? spec.mass / md.mass : 1;
    this.mass = md.mass * scale;
    this.inertia = spec.inertia ?? md.inertia * scale;
    this.invMass = this.isStatic ? 0 : 1 / this.mass;
    this.invInertia = this.isStatic || spec.fixedRotation ? 0 : 1 / this.inertia;
    this.restitution = spec.restitution ?? 0;
    this.friction = spec.friction ?? 0.5;
    this.color = spec.color ?? '#c3c2b7';
    this.trail = spec.trail !== undefined && spec.trail !== false;
    this.trailPoint = typeof spec.trail === 'object' ? { x: spec.trail.x, y: spec.trail.y } : { x: 0, y: 0 };

    this.x = spec.position.x;
    this.y = spec.position.y;
    this.angle = spec.angle ?? 0;
    this.vx = this.isStatic ? 0 : (spec.velocity?.x ?? 0);
    this.vy = this.isStatic ? 0 : (spec.velocity?.y ?? 0);
    this.omega = this.isStatic ? 0 : (spec.angularVelocity ?? 0);
    this.initial = [this.x, this.y, this.angle, this.vx, this.vy, this.omega];
    this.syncTransform();
  }

  reset(): void {
    [this.x, this.y, this.angle, this.vx, this.vy, this.omega] = this.initial;
    this.awake = true;
    this.sleepTime = 0;
    this.syncTransform();
  }

  /** Updates the rotation cache only (cheap; used inside the position solver). */
  syncRotation(): void {
    this.cos = Math.cos(this.angle);
    this.sin = Math.sin(this.angle);
  }

  /** Recomputes rotation, world-space vertices/normals and the bounding box. */
  syncTransform(): void {
    this.syncRotation();
    const s = this.shape;
    if (s.kind === 'circle') {
      this.minX = this.x - s.radius;
      this.maxX = this.x + s.radius;
      this.minY = this.y - s.radius;
      this.maxY = this.y + s.radius;
      return;
    }
    this.minX = this.minY = Infinity;
    this.maxX = this.maxY = -Infinity;
    for (let i = 0; i < s.count; i++) {
      const wx = this.worldX(s.xs[i], s.ys[i]);
      const wy = this.worldY(s.xs[i], s.ys[i]);
      this.wxs[i] = wx;
      this.wys[i] = wy;
      this.wnxs[i] = this.cos * s.nxs[i] - this.sin * s.nys[i];
      this.wnys[i] = this.sin * s.nxs[i] + this.cos * s.nys[i];
      if (wx < this.minX) this.minX = wx;
      if (wx > this.maxX) this.maxX = wx;
      if (wy < this.minY) this.minY = wy;
      if (wy > this.maxY) this.maxY = wy;
    }
  }

  worldX(lx: number, ly: number): number {
    return this.x + this.cos * lx - this.sin * ly;
  }

  worldY(lx: number, ly: number): number {
    return this.y + this.sin * lx + this.cos * ly;
  }

  localX(wx: number, wy: number): number {
    return this.cos * (wx - this.x) + this.sin * (wy - this.y);
  }

  localY(wx: number, wy: number): number {
    return -this.sin * (wx - this.x) + this.cos * (wy - this.y);
  }

  /** Whether a world point lies inside the shape (expanded by `margin`). */
  contains(wx: number, wy: number, margin = 0): boolean {
    const s = this.shape;
    if (s.kind === 'circle') return Math.hypot(wx - this.x, wy - this.y) <= s.radius + margin;
    const lx = this.localX(wx, wy);
    const ly = this.localY(wx, wy);
    for (let i = 0; i < s.count; i++) {
      if (s.nxs[i] * (lx - s.xs[i]) + s.nys[i] * (ly - s.ys[i]) > margin) return false;
    }
    return true;
  }

  kineticEnergy(): number {
    return 0.5 * this.mass * (this.vx * this.vx + this.vy * this.vy) + 0.5 * this.inertia * this.omega * this.omega;
  }

  wake(): void {
    if (this.isStatic) return;
    this.awake = true;
    this.sleepTime = 0;
  }
}
