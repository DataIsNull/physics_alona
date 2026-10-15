import type { Force } from './forces';
import type { Particles } from './particles';
import { G, SPEED_OF_LIGHT } from './units';
import type { Vec2 } from './vec2';
import type { World } from './world';

/**
 * Newtonian gravity between every pair of particles, summed directly: exact
 * and O(n²). Plummer softening ε replaces r² by r² + ε², which keeps close
 * encounters finite (and models smeared-out mass such as stars in a galaxy).
 */
export class NewtonianGravity implements Force {
  constructor(
    /** m */
    readonly softening = 0,
    readonly g = G,
  ) {}

  apply(particles: Particles, pos: Float64Array, _vel: Float64Array, _t: number, acc: Float64Array): void {
    const { count, mass } = particles;
    const eps2 = this.softening * this.softening;
    for (let i = 0; i < count; i++) {
      const xi = pos[2 * i];
      const yi = pos[2 * i + 1];
      for (let j = i + 1; j < count; j++) {
        const dx = pos[2 * j] - xi;
        const dy = pos[2 * j + 1] - yi;
        const r2 = dx * dx + dy * dy + eps2;
        if (r2 === 0) continue;
        const s = this.g / (r2 * Math.sqrt(r2));
        acc[2 * i] += s * mass[j] * dx;
        acc[2 * i + 1] += s * mass[j] * dy;
        acc[2 * j] -= s * mass[i] * dx;
        acc[2 * j + 1] -= s * mass[i] * dy;
      }
    }
  }

  potential(particles: Particles, pos: Float64Array): number {
    const { count, mass } = particles;
    const eps2 = this.softening * this.softening;
    let u = 0;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const r = Math.sqrt((pos[2 * j] - pos[2 * i]) ** 2 + (pos[2 * j + 1] - pos[2 * i + 1]) ** 2 + eps2);
        if (r > 0) u -= (this.g * mass[i] * mass[j]) / r;
      }
    }
    return u;
  }
}

/**
 * Quadtree over point masses. Each node stores its subtree's total mass and
 * mass-weighted position sums, so a far-away cell acts like one particle at
 * its centre of mass. Flat typed arrays, regrown only when N grows.
 */
class QuadTree {
  count = 0;
  private capacity = 0;
  private minX = new Float64Array(0);
  private minY = new Float64Array(0);
  private size = new Float64Array(0);
  private mass = new Float64Array(0);
  private mx = new Float64Array(0);
  private my = new Float64Array(0);
  private comX = new Float64Array(0);
  private comY = new Float64Array(0);
  /** Squared distance beyond which the cell may act as one mass (see prepare). */
  private crit2 = new Float64Array(0);
  /** Particle index for a leaf holding one particle, −1 for an internal node, −2 for an empty leaf. */
  private body = new Int32Array(0);
  private child = new Int32Array(0);
  private stack = new Int32Array(0);

  build(pos: Float64Array, masses: Float64Array, n: number): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, pos[2 * i]);
      y0 = Math.min(y0, pos[2 * i + 1]);
      x1 = Math.max(x1, pos[2 * i]);
      y1 = Math.max(y1, pos[2 * i + 1]);
    }
    const size = Math.max(x1 - x0, y1 - y0, 1e-30) * 1.000001;
    this.count = 0;
    this.ensure(4 * n + 4);
    const root = this.node(x0, y0, size);
    const minSize = size * 1e-12;
    for (let i = 0; i < n; i++) this.insert(root, i, pos, masses, minSize);
  }

  /**
   * Centres of mass and opening distances for accuracy parameter θ. A cell
   * of size s may act as one mass at distances beyond s/θ + δ, where δ is how
   * far its centre of mass sits from its middle. The δ term (Barnes 1994)
   * guards the worst case of the plain s/r < θ test: a lopsided cell right
   * next to the point. For θ ≤ 1 a cell never passes for a point inside it.
   */
  prepare(invTheta: number): void {
    for (let k = 0; k < this.count; k++) {
      const m = this.mass[k];
      const cx = (this.comX[k] = this.mx[k] / m);
      const cy = (this.comY[k] = this.my[k] / m);
      const half = this.size[k] / 2;
      const reach = this.size[k] * invTheta + Math.hypot(cx - this.minX[k] - half, cy - this.minY[k] - half);
      this.crit2[k] = reach * reach; // θ = 0 → ∞: always opened, i.e. the exact direct sum
    }
  }

  /** Acceleration at (x, y) from everything except particle `self`. */
  accel(self: number, x: number, y: number, eps2: number, g: number, out: [number, number]): void {
    const { comX, comY, crit2, mass, body, child, stack } = this;
    let ax = 0;
    let ay = 0;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const k = stack[--top];
      const b = body[k];
      if (b === self) continue;
      const dx = comX[k] - x;
      const dy = comY[k] - y;
      const r2 = dx * dx + dy * dy;
      if (b >= 0 || r2 > crit2[k]) {
        const d2 = r2 + eps2;
        if (d2 === 0) continue;
        const s = (g * mass[k]) / (d2 * Math.sqrt(d2));
        ax += s * dx;
        ay += s * dy;
      } else {
        for (let q = 4 * k; q < 4 * k + 4; q++) if (child[q] >= 0) stack[top++] = child[q];
      }
    }
    out[0] = ax;
    out[1] = ay;
  }

  /** Gravitational potential (per unit mass) at (x, y) from everything except particle `self`. */
  potential(self: number, x: number, y: number, eps2: number, g: number): number {
    const { comX, comY, crit2, mass, body, child, stack } = this;
    let phi = 0;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const k = stack[--top];
      const b = body[k];
      if (b === self) continue;
      const dx = comX[k] - x;
      const dy = comY[k] - y;
      const r2 = dx * dx + dy * dy;
      if (b >= 0 || r2 > crit2[k]) {
        const d = Math.sqrt(r2 + eps2);
        if (d > 0) phi -= (g * mass[k]) / d;
      } else {
        for (let q = 4 * k; q < 4 * k + 4; q++) if (child[q] >= 0) stack[top++] = child[q];
      }
    }
    return phi;
  }

  private insert(root: number, i: number, pos: Float64Array, masses: Float64Array, minSize: number): void {
    const x = pos[2 * i];
    const y = pos[2 * i + 1];
    const m = masses[i];
    let k = root;
    for (;;) {
      const b = this.body[k];
      if (b === -2) {
        this.body[k] = i;
        this.addMass(k, m, x, y);
        return;
      }
      if (b >= 0) {
        if (this.size[k] < minSize) {
          // Coincident particles: merge into this leaf rather than subdivide forever.
          this.addMass(k, m, x, y);
          return;
        }
        // Split the leaf: push its particle one level down.
        this.body[k] = -1;
        const q = this.quadrant(k, pos[2 * b], pos[2 * b + 1]);
        const c = this.childAt(k, q);
        this.body[c] = b;
        this.addMass(c, masses[b], pos[2 * b], pos[2 * b + 1]);
      }
      this.addMass(k, m, x, y);
      k = this.childAt(k, this.quadrant(k, x, y));
    }
  }

  private quadrant(k: number, x: number, y: number): number {
    const half = this.size[k] / 2;
    return (x >= this.minX[k] + half ? 1 : 0) + (y >= this.minY[k] + half ? 2 : 0);
  }

  private childAt(k: number, q: number): number {
    let c = this.child[4 * k + q];
    if (c < 0) {
      const half = this.size[k] / 2;
      c = this.node(this.minX[k] + (q & 1 ? half : 0), this.minY[k] + (q & 2 ? half : 0), half);
      this.child[4 * k + q] = c;
    }
    return c;
  }

  private addMass(k: number, m: number, x: number, y: number): void {
    this.mass[k] += m;
    this.mx[k] += m * x;
    this.my[k] += m * y;
  }

  private node(x: number, y: number, size: number): number {
    if (this.count === this.capacity) this.ensure(this.capacity * 2);
    const k = this.count++;
    this.minX[k] = x;
    this.minY[k] = y;
    this.size[k] = size;
    this.mass[k] = this.mx[k] = this.my[k] = 0;
    this.body[k] = -2;
    this.child.fill(-1, 4 * k, 4 * k + 4);
    return k;
  }

  private ensure(capacity: number): void {
    if (capacity <= this.capacity) return;
    const grow = <T extends Float64Array | Int32Array>(a: T, size: number): T => {
      const next = new (a.constructor as new (n: number) => T)(size);
      next.set(a);
      return next;
    };
    this.minX = grow(this.minX, capacity);
    this.minY = grow(this.minY, capacity);
    this.size = grow(this.size, capacity);
    this.mass = grow(this.mass, capacity);
    this.mx = grow(this.mx, capacity);
    this.my = grow(this.my, capacity);
    this.comX = grow(this.comX, capacity);
    this.comY = grow(this.comY, capacity);
    this.crit2 = grow(this.crit2, capacity);
    this.stack = grow(this.stack, 3 * capacity + 4);
    this.body = grow(this.body, capacity);
    this.child = grow(this.child, 4 * capacity);
    this.capacity = capacity;
  }
}

/**
 * Barnes–Hut gravity: the same physics as NewtonianGravity, but a quadtree
 * lets distant groups of particles act as one mass. A cell of size s is used
 * whole once it is farther than s/θ (plus its centre-of-mass offset). Cost
 * O(n log n) instead of O(n²); θ = 0 reproduces the direct sum exactly.
 */
export class BarnesHutGravity implements Force {
  /** Tree nodes built in the last call, a measure of the work done. */
  lastNodes = 0;
  private readonly tree = new QuadTree();
  private readonly out: [number, number] = [0, 0];

  constructor(
    /** Accuracy parameter, 0 (exact) … 1 (fast and rough). */
    readonly theta = 0.5,
    /** m */
    readonly softening = 0,
    readonly g = G,
  ) {
    if (!(theta >= 0 && theta <= 1)) throw new RangeError(`Barnes–Hut θ must be in [0, 1], got ${theta}`);
  }

  apply(particles: Particles, pos: Float64Array, _vel: Float64Array, _t: number, acc: Float64Array): void {
    const { count, mass, invMass } = particles;
    this.tree.build(pos, mass, count);
    this.tree.prepare(1 / this.theta);
    this.lastNodes = this.tree.count;
    const eps2 = this.softening * this.softening;
    for (let i = 0; i < count; i++) {
      if (invMass[i] === 0) continue; // fixed particles don't need their acceleration
      this.tree.accel(i, pos[2 * i], pos[2 * i + 1], eps2, this.g, this.out);
      acc[2 * i] += this.out[0];
      acc[2 * i + 1] += this.out[1];
    }
  }

  potential(particles: Particles, pos: Float64Array): number {
    const { count, mass } = particles;
    this.tree.build(pos, mass, count);
    this.tree.prepare(1 / this.theta);
    const eps2 = this.softening * this.softening;
    let u = 0;
    for (let i = 0; i < count; i++) u += mass[i] * this.tree.potential(i, pos[2 * i], pos[2 * i + 1], eps2, this.g);
    return u / 2; // every pair was counted from both ends
  }
}

/**
 * Gravity of point masses held in place (say, the Sun and Jupiter in a
 * rotating frame), acting on movable particles only. The particles don't
 * attract each other: they are test particles.
 */
export class PointMassField implements Force {
  constructor(
    readonly sources: ReadonlyArray<{ position: Vec2; mass: number }>,
    readonly g = G,
  ) {}

  apply(particles: Particles, pos: Float64Array, _vel: Float64Array, _t: number, acc: Float64Array): void {
    for (let i = 0; i < particles.count; i++) {
      if (particles.invMass[i] === 0) continue;
      for (const s of this.sources) {
        const dx = s.position.x - pos[2 * i];
        const dy = s.position.y - pos[2 * i + 1];
        const r2 = dx * dx + dy * dy;
        if (r2 === 0) continue;
        const k = (this.g * s.mass) / (r2 * Math.sqrt(r2));
        acc[2 * i] += k * dx;
        acc[2 * i + 1] += k * dy;
      }
    }
  }

  potential(particles: Particles, pos: Float64Array): number {
    let u = 0;
    for (let i = 0; i < particles.count; i++) {
      if (particles.invMass[i] === 0) continue;
      for (const s of this.sources) {
        const r = Math.hypot(pos[2 * i] - s.position.x, pos[2 * i + 1] - s.position.y);
        if (r > 0) u -= (this.g * s.mass * particles.mass[i]) / r;
      }
    }
    return u;
  }
}

/**
 * Fictitious forces in a frame rotating at angular velocity Ω about the
 * origin: centrifugal Ω²·r and Coriolis −2Ω×v. Coriolis does no work, so
 * KE plus the centrifugal potential −½mΩ²r² (the Jacobi integral) is conserved.
 */
export class RotatingFrame implements Force {
  constructor(
    /** rad/s, counter-clockwise */
    readonly omega: number,
  ) {}

  apply(particles: Particles, pos: Float64Array, vel: Float64Array, _t: number, acc: Float64Array): void {
    const w = this.omega;
    for (let i = 0; i < particles.count; i++) {
      acc[2 * i] += w * w * pos[2 * i] + 2 * w * vel[2 * i + 1];
      acc[2 * i + 1] += w * w * pos[2 * i + 1] - 2 * w * vel[2 * i];
    }
  }

  potential(particles: Particles, pos: Float64Array): number {
    let u = 0;
    for (let i = 0; i < particles.count; i++) {
      if (particles.invMass[i] === 0) continue;
      u -= 0.5 * particles.mass[i] * this.omega ** 2 * (pos[2 * i] ** 2 + pos[2 * i + 1] ** 2);
    }
    return u;
  }
}

/**
 * First post-Newtonian (general-relativistic) correction for test particles
 * orbiting a mass M at `center` (Schwarzschild field, harmonic coordinates):
 * a = GM/(c²r³)·[(4GM/r − v²)·r + 4(r·v)·v]. Makes orbits precess by
 * 6πGM/(c²a(1−e²)) per revolution: 43″ per century for Mercury.
 */
export class RelativisticCorrection implements Force {
  constructor(
    readonly center: Vec2,
    readonly mass: number,
    /** Speed of light; scenes may lower it to exaggerate the effect. */
    readonly c = SPEED_OF_LIGHT,
    readonly g = G,
  ) {}

  apply(particles: Particles, pos: Float64Array, vel: Float64Array, _t: number, acc: Float64Array): void {
    const gm = this.g * this.mass;
    for (let i = 0; i < particles.count; i++) {
      if (particles.invMass[i] === 0) continue;
      const rx = pos[2 * i] - this.center.x;
      const ry = pos[2 * i + 1] - this.center.y;
      const r = Math.hypot(rx, ry);
      if (r === 0) continue;
      const vx = vel[2 * i];
      const vy = vel[2 * i + 1];
      const k = gm / (this.c * this.c * r * r * r);
      const radial = (4 * gm) / r - (vx * vx + vy * vy);
      const rv = 4 * (rx * vx + ry * vy);
      acc[2 * i] += k * (radial * rx + rv * vx);
      acc[2 * i + 1] += k * (radial * ry + rv * vy);
    }
  }
}

/**
 * Adaptive step limit for a few gravitating bodies: η times the shortest
 * mutual free-fall time √(r³/G(m₁+m₂)). Close passes get small steps,
 * quiet stretches get large ones.
 */
export function gravityTimestep(eta: number, softening = 0, g = G): (world: World) => number {
  return (world) => {
    const { count, pos, mass, invMass } = world.particles;
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (invMass[i] === 0 && invMass[j] === 0) continue;
        const r2 = (pos[2 * j] - pos[2 * i]) ** 2 + (pos[2 * j + 1] - pos[2 * i + 1]) ** 2 + softening * softening;
        best = Math.min(best, Math.sqrt((r2 * Math.sqrt(r2)) / (g * (mass[i] + mass[j]))));
      }
    }
    return eta * best;
  };
}
