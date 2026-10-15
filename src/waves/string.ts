import type { Simulation, TrailSource } from '../core/simulation';
import { Vec2 } from '../core/vec2';

/** How an end of the string is held. */
export type StringEnd =
  | { kind: 'fixed' }
  /** A ring sliding freely on a vertical pole: no transverse force, ∂u/∂x = 0. */
  | { kind: 'free' }
  /** Shaken by hand: u = A·sin(2πft). */
  | { kind: 'driven'; amplitude: number; frequency: number };

export interface WaveStringOptions {
  /** m */
  length: number;
  nodes: number;
  /** Wave speed c = √(T/μ), m/s. */
  speed: number;
  /** Linear density μ, kg/m. */
  density?: number;
  /** Velocity damping γ, 1/s. */
  damping?: number;
  left?: StringEnd;
  right?: StringEnd;
  /** Initial displacement and velocity at distance x from the left end. */
  initial?: (x: number) => { u: number; v: number };
  /** World position of the left end at rest. */
  origin?: Vec2;
  /** Exact solution u(x, t), drawn as a ghost and used for the error readout. */
  exact?: (x: number, t: number) => number;
  label?: string;
  color?: string;
}

/** Fraction of the stability limit c·dt/dx ≤ 1 used for sub-steps. */
const COURANT = 0.9;

/**
 * A stretched string: the 1D wave equation u_tt = c²·u_xx − γ·u_t on a
 * row of nodes, stepped with velocity Verlet. Ends can be fixed, free or
 * shaken. The app's step is split into sub-steps that respect the Courant
 * condition, so any step size stays stable.
 */
export class WaveString implements Simulation {
  readonly length: number;
  readonly n: number;
  readonly dx: number;
  readonly speed: number;
  readonly density: number;
  readonly tension: number;
  readonly damping: number;
  readonly left: StringEnd;
  readonly right: StringEnd;
  readonly origin: Vec2;
  readonly label: string;
  readonly color: string;
  readonly exact: ((x: number, t: number) => number) | null;
  readonly dissipative: boolean;

  readonly u: Float64Array;
  readonly v: Float64Array;
  t = 0;
  steps = 0;
  diverged = false;
  dissipated = 0;
  externalWork = 0;
  readonly initialEnergy: number;
  /** Node held by the pointer, and where. */
  grab: { node: number; target: Vec2 } | null = null;

  private readonly a0: Float64Array;
  private readonly a1: Float64Array;
  private readonly vPred: Float64Array;
  /** Mass per node: μ·dx inside, half that at the ends. */
  private readonly mass: Float64Array;
  private readonly initialU: Float64Array;
  private readonly initialV: Float64Array;

  constructor(options: WaveStringOptions) {
    this.length = options.length;
    this.n = options.nodes;
    this.dx = this.length / (this.n - 1);
    this.speed = options.speed;
    this.density = options.density ?? 0.1;
    this.tension = this.density * this.speed ** 2;
    this.damping = options.damping ?? 0;
    this.left = options.left ?? { kind: 'fixed' };
    this.right = options.right ?? { kind: 'fixed' };
    this.origin = options.origin ?? Vec2.ZERO;
    this.label = options.label ?? 'Струна';
    this.color = options.color ?? '#c3c2b7';
    this.exact = options.exact ?? null;
    this.dissipative = this.damping > 0;

    this.u = new Float64Array(this.n);
    this.v = new Float64Array(this.n);
    this.a0 = new Float64Array(this.n);
    this.a1 = new Float64Array(this.n);
    this.vPred = new Float64Array(this.n);
    this.mass = new Float64Array(this.n).fill(this.density * this.dx);
    this.mass[0] = this.mass[this.n - 1] = (this.density * this.dx) / 2;
    if (options.initial) {
      for (let i = 0; i < this.n; i++) {
        const { u, v } = options.initial(i * this.dx);
        this.u[i] = u;
        this.v[i] = v;
      }
    }
    this.applyEnds(0);
    this.initialU = this.u.slice();
    this.initialV = this.v.slice();
    this.initialEnergy = this.totalEnergy();
  }

  /** Sub-step size for an app step dt. */
  substep(dt: number): number {
    return dt / Math.max(1, Math.ceil(dt / ((COURANT * this.dx) / this.speed)));
  }

  step(dt: number): void {
    if (this.diverged) return;
    const h = this.substep(dt);
    for (let k = 0, n = Math.round(dt / h); k < n; k++) this.advance(h);
    this.steps++;
    if (!this.u.every(Number.isFinite)) this.diverged = true;
  }

  private advance(h: number): void {
    const { u, v, a0, a1, vPred, n } = this;
    const grabbed = this.grab !== null;
    const before = grabbed ? this.totalEnergy() + this.dissipated : 0;
    const lossBefore = this.dampingPower(v);
    const driveBefore = this.drivePower(this.t);

    this.accel(u, v, a0);
    for (let i = 0; i < n; i++) {
      u[i] += v[i] * h + 0.5 * a0[i] * h * h;
      vPred[i] = v[i] + a0[i] * h;
    }
    this.t += h;
    this.applyEnds(this.t, vPred);
    this.accel(u, vPred, a1);
    for (let i = 0; i < n; i++) v[i] += 0.5 * (a0[i] + a1[i]) * h;
    this.applyEnds(this.t);

    this.dissipated -= 0.5 * (lossBefore + this.dampingPower(v)) * h;
    if (grabbed) this.externalWork += this.totalEnergy() + this.dissipated - before;
    else this.externalWork += 0.5 * (driveBefore + this.drivePower(this.t)) * h;
  }

  /** Acceleration of every node; prescribed nodes get whatever, they're reset afterwards. */
  private accel(u: Float64Array, v: Float64Array, out: Float64Array): void {
    const { n } = this;
    const k = (this.speed / this.dx) ** 2;
    for (let i = 1; i < n - 1; i++) out[i] = k * (u[i - 1] - 2 * u[i] + u[i + 1]) - this.damping * v[i];
    // A free end mirrors its neighbour (ghost node), which makes the slope vanish.
    out[0] = this.left.kind === 'free' ? 2 * k * (u[1] - u[0]) - this.damping * v[0] : 0;
    out[n - 1] = this.right.kind === 'free' ? 2 * k * (u[n - 2] - u[n - 1]) - this.damping * v[n - 1] : 0;
  }

  /** Sets fixed, driven and grabbed nodes to their prescribed motion at time t. */
  private applyEnds(t: number, vel: Float64Array = this.v): void {
    const set = (i: number, end: StringEnd) => {
      if (end.kind === 'fixed') {
        this.u[i] = 0;
        vel[i] = 0;
      } else if (end.kind === 'driven') {
        const w = 2 * Math.PI * end.frequency;
        this.u[i] = end.amplitude * Math.sin(w * t);
        vel[i] = end.amplitude * w * Math.cos(w * t);
      }
    };
    set(0, this.left);
    set(this.n - 1, this.right);
    if (this.grab) {
      this.u[this.grab.node] = this.grab.target.y - this.origin.y;
      vel[this.grab.node] = 0;
    }
  }

  private isPrescribed(i: number): boolean {
    if (i === 0 && this.left.kind !== 'free') return true;
    if (i === this.n - 1 && this.right.kind !== 'free') return true;
    return this.grab?.node === i;
  }

  /** −γ·Σm·v² over the nodes that move freely. */
  private dampingPower(v: Float64Array): number {
    if (this.damping === 0) return 0;
    let p = 0;
    for (let i = 0; i < this.n; i++) if (!this.isPrescribed(i)) p -= this.damping * this.mass[i] * v[i] * v[i];
    return p;
  }

  /**
   * Power of a hand shaking an end: it must accelerate the end node and pull
   * against the string's tension, P = (m·ü − T·(u₁ − u₀)/dx)·u̇.
   */
  private drivePower(t: number): number {
    let p = 0;
    const end = (e: StringEnd, i: number, neighbour: number) => {
      if (e.kind !== 'driven') return;
      const w = 2 * Math.PI * e.frequency;
      const pos = e.amplitude * Math.sin(w * t);
      const vel = e.amplitude * w * Math.cos(w * t);
      const acc = -e.amplitude * w * w * Math.sin(w * t);
      p += (this.mass[i] * acc - (this.tension * (this.u[neighbour] - pos)) / this.dx) * vel;
    };
    end(this.left, 0, 1);
    end(this.right, this.n - 1, this.n - 2);
    return p;
  }

  reset(): void {
    this.u.set(this.initialU);
    this.v.set(this.initialV);
    this.t = 0;
    this.steps = 0;
    this.diverged = false;
    this.dissipated = 0;
    this.externalWork = 0;
    this.grab = null;
  }

  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += 0.5 * this.mass[i] * this.v[i] ** 2;
    return e;
  }

  potentialEnergy(): number {
    let e = 0;
    for (let i = 0; i + 1 < this.n; i++) e += (0.5 * this.tension * (this.u[i + 1] - this.u[i]) ** 2) / this.dx;
    return e;
  }

  totalEnergy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  energyBalance(): number {
    return this.totalEnergy() + this.dissipated - this.externalWork;
  }

  energyDrift(): number {
    // Driven strings start nearly at rest: measure against the energy that flowed through.
    const scale = Math.max(Math.abs(this.initialEnergy), Math.abs(this.externalWork), this.dissipated) || 1;
    return (this.energyBalance() - this.initialEnergy) / scale;
  }

  exactError(): number | null {
    if (!this.exact) return null;
    let worst = 0;
    for (let i = 0; i < this.n; i++) worst = Math.max(worst, Math.abs(this.u[i] - this.exact(i * this.dx, this.t)));
    return worst;
  }

  trailSources(): TrailSource[] {
    return [];
  }

  /** World position of node i. */
  nodeX(i: number): number {
    return this.origin.x + i * this.dx;
  }

  nodeY(i: number): number {
    return this.origin.y + this.u[i];
  }

  hitTest(point: Vec2, pixel: number): boolean {
    return this.nodeAt(point, pixel) !== null;
  }

  grabAt(point: Vec2, pixel: number): boolean {
    const node = this.nodeAt(point, pixel);
    if (node === null) return false;
    this.grab = { node, target: point };
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab) this.grab.target = point;
  }

  release(): void {
    this.grab = null;
  }

  private nodeAt(point: Vec2, pixel: number): number | null {
    const i = Math.round((point.x - this.origin.x) / this.dx);
    if (i < 1 || i > this.n - 2) return null; // ends are held by their own rules
    return Math.abs(point.y - this.nodeY(i)) <= 12 * pixel ? i : null;
  }
}

/**
 * Exact motion of a pulse g(x) sent rightwards (u_t = −c·g′) along a string
 * of length L with a fixed left end, by the method of images. Displacement
 * is extended beyond each end oddly (fixed) or evenly (free) into F; the
 * velocity's antiderivative needs the opposite parities, G. d'Alembert then
 * gives u = ½(F + G)(x − ct) + ½(F − G)(x + ct): inside the string the first
 * term is the outgoing pulse, the second its reflections.
 */
export function travellingPulse(g: (x: number) => number, length: number, speed: number, right: 'fixed' | 'free') {
  /** Extension of g with sign `left` under reflection about 0 and `rightSign` about L. */
  const extend = (left: number, rightSign: number) => {
    const ext = (s: number): number => {
      if (s < 0) return left * ext(-s);
      if (s > length) return rightSign * ext(2 * length - s);
      return g(s);
    };
    return ext;
  };
  const rightParity = right === 'fixed' ? -1 : 1;
  const F = extend(-1, rightParity);
  const G = extend(1, -rightParity);
  return (x: number, t: number) => {
    const a = x - speed * t;
    const b = x + speed * t;
    return 0.5 * (F(a) + G(a)) + 0.5 * (F(b) - G(b));
  };
}
