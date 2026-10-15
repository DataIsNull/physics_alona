import type { Simulation, TrailSource } from '../core/simulation';
import { STANDARD_GRAVITY } from '../core/units';
import { Vec2 } from '../core/vec2';
import { GRAB_OMEGA } from '../core/world';
import { Body, type BodySpec } from './body';
import { LINEAR_SLOP } from './collide';
import { Contact } from './contact';
import type { Joint } from './joints';
import { circle } from './shapes';

/** Bodies slower than this (and spinning slower than the angular tolerance) may fall asleep, m/s. */
const LINEAR_SLEEP_TOLERANCE = 0.01;
/** rad/s (2°/s) */
const ANGULAR_SLEEP_TOLERANCE = (2 * Math.PI) / 180;
/** A whole island must stay still this long before it sleeps, s. */
const TIME_TO_SLEEP = 0.5;
/** Largest distance a body may travel in one step; guards against tunnelling explosions, m. */
const MAX_TRANSLATION = 2;

export interface RigidWorldOptions {
  bodies: readonly RigidBodySpec[];
  /** Joints are built once the bodies exist; `ground` is a static body for pinning to the world. */
  joints?: (bodies: readonly Body[], ground: Body) => Joint[];
  gravity?: Vec2;
  /** Point of zero potential energy. */
  reference?: Vec2;
  velocityIterations?: number;
  positionIterations?: number;
  /** Let resting islands of bodies sleep. */
  sleep?: boolean;
  /** Linear and angular velocity damping, 1/s (air drag, joint friction). */
  damping?: number;
  label?: string;
  color?: string;
}

export interface RigidBodySpec extends BodySpec {
  /** Bodies sharing a non-zero group never collide with each other. */
  group?: number;
}

interface RigidGrab {
  body: Body;
  /** Grabbed point in the body's frame. */
  localX: number;
  localY: number;
  target: Vec2;
}

/**
 * Rigid-body world in the style of Box2D: semi-implicit Euler for forces,
 * sequential impulses for contacts and joints (velocity level), then
 * non-linear Gauss–Seidel to remove leftover overlap (position level).
 */
export class RigidWorld implements Simulation {
  readonly bodies: Body[];
  readonly joints: Joint[];
  /** Static anchor for joints that pin bodies to the world. Not drawn, never collides. */
  readonly ground: Body;
  readonly gravity: Vec2;
  readonly reference: Vec2;
  readonly label: string;
  readonly color: string;
  /** Losses at contacts aren't tracked separately; they show up as a drop in E. */
  readonly dissipative = false;
  readonly dissipated = 0;
  velocityIterations: number;
  positionIterations: number;
  readonly sleepEnabled: boolean;
  readonly damping: number;

  t = 0;
  steps = 0;
  diverged = false;
  externalWork = 0;
  readonly initialEnergy: number;
  grab: RigidGrab | null = null;

  private readonly contacts = new Map<number, Contact>();
  private readonly groups: number[];
  private readonly jointedPairs = new Set<number>();
  /** Body indices sorted by bounding-box left edge (kept nearly sorted between steps). */
  private readonly order: number[];
  private readonly parent: number[];

  constructor(options: RigidWorldOptions) {
    this.bodies = options.bodies.map((spec, i) => new Body(spec, i));
    this.groups = options.bodies.map((spec) => spec.group ?? 0);
    this.ground = new Body({ shape: circle(1), position: Vec2.ZERO, static: true }, -1);
    this.joints = options.joints?.(this.bodies, this.ground) ?? [];
    for (const j of this.joints) {
      if (j.a.index >= 0 && j.b.index >= 0) this.jointedPairs.add(this.pairKey(j.a, j.b));
    }
    this.gravity = options.gravity ?? new Vec2(0, -STANDARD_GRAVITY);
    this.reference = options.reference ?? Vec2.ZERO;
    this.velocityIterations = options.velocityIterations ?? 10;
    // Joints need several SHAKE passes to conserve energy; contacts exit early.
    this.positionIterations = options.positionIterations ?? 10;
    this.sleepEnabled = options.sleep ?? true;
    this.damping = options.damping ?? 0;
    this.label = options.label ?? 'Тверді тіла';
    this.color = options.color ?? '#c3c2b7';
    this.order = this.bodies.map((_, i) => i);
    this.parent = this.bodies.map((_, i) => i);
    this.initialEnergy = this.totalEnergy();
  }

  step(dt: number): void {
    if (this.diverged) return;
    const grab = this.grab;
    const energyBefore = grab ? this.totalEnergy() : 0;
    const dynamic = this.bodies.filter((b) => !b.isStatic);

    for (const body of this.bodies) body.syncTransform();
    this.updateContacts();
    this.wakeConnected();
    if (grab) grab.body.wake();

    // Forces → velocities.
    const damp = 1 / (1 + this.damping * dt);
    for (const b of dynamic) {
      if (!b.awake) continue;
      b.vx = (b.vx + this.gravity.x * dt) * damp;
      b.vy = (b.vy + this.gravity.y * dt) * damp;
      b.omega *= damp;
    }
    if (grab) this.applyGrabForce(grab, dt);

    // Velocity constraints.
    const contacts = [...this.contacts.values()].filter((c) => c.touching && (this.isActive(c.a) || this.isActive(c.b)));
    const joints = this.joints.filter((j) => this.isActive(j.a) || this.isActive(j.b));
    for (const c of contacts) {
      c.initVelocity();
      c.warmStart();
    }
    for (const j of joints) {
      j.initVelocity(dt);
      j.warmStart();
    }
    for (let it = 0; it < this.velocityIterations; it++) {
      for (const j of joints) j.solveVelocity();
      for (const c of contacts) c.solveVelocity();
    }

    // Velocities → positions.
    for (const b of dynamic) {
      if (!b.awake) continue;
      const travel = Math.hypot(b.vx, b.vy) * dt;
      if (travel > MAX_TRANSLATION) {
        const s = MAX_TRANSLATION / travel;
        b.vx *= s;
        b.vy *= s;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.omega * dt;
      b.syncRotation();
    }

    // Position constraints.
    for (let it = 0; it < this.positionIterations; it++) {
      let minSeparation = 0;
      for (const c of contacts) minSeparation = Math.min(minSeparation, c.solvePosition());
      let jointsOk = true;
      for (const j of joints) jointsOk = j.solvePosition() && jointsOk;
      if (minSeparation >= -3 * LINEAR_SLOP && jointsOk) break;
    }

    let motorWork = 0;
    for (const j of joints) motorWork += j.motorWork();
    // While dragging, every change of energy is the hand's doing.
    this.externalWork += grab ? this.totalEnergy() - energyBefore : motorWork;

    if (this.sleepEnabled) this.updateSleep(dt);
    this.t += dt;
    this.steps++;
    if (dynamic.some((b) => !Number.isFinite(b.x + b.y + b.angle + b.vx + b.vy + b.omega))) this.diverged = true;
  }

  reset(): void {
    for (const b of this.bodies) b.reset();
    for (const j of this.joints) j.reset();
    this.contacts.clear();
    this.t = 0;
    this.steps = 0;
    this.diverged = false;
    this.externalWork = 0;
    this.grab = null;
  }

  kineticEnergy(): number {
    let e = 0;
    for (const b of this.bodies) if (!b.isStatic) e += b.kineticEnergy();
    return e;
  }

  potentialEnergy(): number {
    let u = 0;
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      u -= b.mass * (this.gravity.x * (b.x - this.reference.x) + this.gravity.y * (b.y - this.reference.y));
    }
    return u;
  }

  totalEnergy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  energyBalance(): number {
    return this.totalEnergy() - this.externalWork;
  }

  energyDrift(): number {
    const e0 = this.initialEnergy;
    return (this.energyBalance() - e0) / (Math.abs(e0) || 1);
  }

  /** Total angular momentum about the origin, kg·m²/s. */
  angularMomentum(): number {
    let l = 0;
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      l += b.mass * (b.x * b.vy - b.y * b.vx) + b.inertia * b.omega;
    }
    return l;
  }

  momentum(): Vec2 {
    let px = 0;
    let py = 0;
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      px += b.mass * b.vx;
      py += b.mass * b.vy;
    }
    return new Vec2(px, py);
  }

  /** Touching contacts, for debug drawing. */
  touchingContacts(): Contact[] {
    return [...this.contacts.values()].filter((c) => c.touching);
  }

  trailSources(): TrailSource[] {
    return this.bodies
      .filter((b) => b.trail)
      .map((b) => {
        const lx = b.trailPoint.x;
        const ly = b.trailPoint.y;
        return { color: b.color, x: () => b.worldX(lx, ly), y: () => b.worldY(lx, ly) };
      });
  }

  hitTest(point: Vec2, pixel: number): boolean {
    return this.bodyAt(point, pixel) !== null;
  }

  grabAt(point: Vec2, pixel: number): boolean {
    const body = this.bodyAt(point, pixel);
    if (!body) return false;
    this.grab = { body, localX: body.localX(point.x, point.y), localY: body.localY(point.x, point.y), target: point };
    body.wake();
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab) this.grab.target = point;
  }

  release(): void {
    this.grab = null;
  }

  /** Grabbed point in world space. */
  grabPoint(): Vec2 | null {
    const g = this.grab;
    return g ? new Vec2(g.body.worldX(g.localX, g.localY), g.body.worldY(g.localX, g.localY)) : null;
  }

  /** Topmost dynamic body under the point (with a few pixels of slack). */
  private bodyAt(point: Vec2, pixel: number): Body | null {
    if (this.diverged) return null;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (!b.isStatic && b.contains(point.x, point.y, 4 * pixel)) return b;
    }
    return null;
  }

  /** Critically damped spring from the grabbed point to the pointer, scaled by the body's mass. */
  private applyGrabForce(grab: RigidGrab, dt: number): void {
    const b = grab.body;
    const rx = b.cos * grab.localX - b.sin * grab.localY;
    const ry = b.sin * grab.localX + b.cos * grab.localY;
    const vx = b.vx - b.omega * ry;
    const vy = b.vy + b.omega * rx;
    const fx = b.mass * (GRAB_OMEGA ** 2 * (grab.target.x - b.x - rx) - 2 * GRAB_OMEGA * vx);
    const fy = b.mass * (GRAB_OMEGA ** 2 * (grab.target.y - b.y - ry) - 2 * GRAB_OMEGA * vy);
    b.vx += b.invMass * fx * dt;
    b.vy += b.invMass * fy * dt;
    b.omega += b.invInertia * (rx * fy - ry * fx) * dt;
  }

  private isActive(b: Body): boolean {
    return !b.isStatic && b.awake;
  }

  private pairKey(a: Body, b: Body): number {
    const lo = Math.min(a.index, b.index);
    const hi = Math.max(a.index, b.index);
    return lo * 1_000_003 + hi;
  }

  /** Sweep-and-prune on x, then narrow phase for each overlapping pair of boxes. */
  private updateContacts(): void {
    const { bodies, order } = this;
    // Insertion sort: the order barely changes between steps.
    for (let i = 1; i < order.length; i++) {
      const k = order[i];
      let j = i - 1;
      while (j >= 0 && bodies[order[j]].minX > bodies[k].minX) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = k;
    }

    const seen = new Set<number>();
    for (let i = 0; i < order.length; i++) {
      const a = bodies[order[i]];
      for (let j = i + 1; j < order.length; j++) {
        const b = bodies[order[j]];
        if (b.minX > a.maxX) break;
        if (b.minY > a.maxY || a.minY > b.maxY) continue;
        if (!this.shouldCollide(a, b)) continue;
        const key = this.pairKey(a, b);
        seen.add(key);
        // Keep sleeping pairs' manifolds (and impulses) untouched for when they wake.
        if (!this.isActive(a) && !this.isActive(b)) continue;
        let contact = this.contacts.get(key);
        if (!contact) {
          // Narrow phase wants the polygon first in circle–polygon pairs.
          const swap = a.shape.kind === 'circle' && b.shape.kind === 'polygon';
          contact = swap ? new Contact(b, a) : new Contact(a, b);
          this.contacts.set(key, contact);
        }
        contact.update();
      }
    }
    for (const key of this.contacts.keys()) if (!seen.has(key)) this.contacts.delete(key);
  }

  private shouldCollide(a: Body, b: Body): boolean {
    if (a.isStatic && b.isStatic) return false;
    const ga = this.groups[a.index];
    if (ga !== 0 && ga === this.groups[b.index]) return false;
    return !this.jointedPairs.has(this.pairKey(a, b));
  }

  /** Wakes sleeping bodies touched by, or jointed to, awake ones (until nothing changes). */
  private wakeConnected(): void {
    let changed = true;
    while (changed) {
      changed = false;
      const pairs: Array<[Body, Body]> = [];
      for (const c of this.contacts.values()) if (c.touching) pairs.push([c.a, c.b]);
      for (const j of this.joints) pairs.push([j.a, j.b]);
      for (const [a, b] of pairs) {
        if (this.isActive(a) && !b.isStatic && !b.awake) {
          b.wake();
          changed = true;
        } else if (this.isActive(b) && !a.isStatic && !a.awake) {
          a.wake();
          changed = true;
        }
      }
    }
  }

  /**
   * Union–find islands over touching contacts and joints; an island sleeps
   * once every body in it has been still for TIME_TO_SLEEP.
   */
  private updateSleep(dt: number): void {
    const { bodies, parent } = this;
    for (let i = 0; i < bodies.length; i++) parent[i] = i;
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: Body, b: Body) => {
      if (a.isStatic || b.isStatic) return;
      parent[find(a.index)] = find(b.index);
    };
    for (const c of this.contacts.values()) if (c.touching) union(c.a, c.b);
    for (const j of this.joints) if (j.a.index >= 0 && j.b.index >= 0) union(j.a, j.b);

    const restless = new Set<Body>();
    if (this.grab) restless.add(this.grab.body);
    for (const j of this.joints) {
      if (j.hasMotor) {
        restless.add(j.a);
        restless.add(j.b);
      }
    }

    const minSleep = new Map<number, number>();
    for (const b of bodies) {
      if (b.isStatic || !b.awake) continue;
      const moving =
        b.vx * b.vx + b.vy * b.vy > LINEAR_SLEEP_TOLERANCE ** 2 || b.omega * b.omega > ANGULAR_SLEEP_TOLERANCE ** 2;
      b.sleepTime = moving || restless.has(b) ? 0 : b.sleepTime + dt;
      const root = find(b.index);
      minSleep.set(root, Math.min(minSleep.get(root) ?? Infinity, b.sleepTime));
    }
    for (const b of bodies) {
      if (b.isStatic || !b.awake) continue;
      if ((minSleep.get(find(b.index)) ?? 0) >= TIME_TO_SLEEP) {
        b.awake = false;
        b.vx = b.vy = b.omega = 0;
      }
    }
  }
}
