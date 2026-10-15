import type { Simulation, TrailSource } from '../core/simulation';
import { Vec2 } from '../core/vec2';

/** A small oscillating patch that pushes the surface: a vibrating dipper or a loudspeaker. */
export interface PointSource {
  /** Position at time t; moving sources make the Doppler effect. */
  position(t: number): Vec2;
  /** Hz */
  frequency: number;
  /** Peak forcing (acceleration of the surface under the source), m/s². */
  amplitude: number;
  /** Gaussian footprint radius σ, m. */
  radius: number;
  phase?: number;
}

/** A straight dipper along x = const that makes plane waves. */
export interface LineSource {
  x: number;
  frequency: number;
  amplitude: number;
  phase?: number;
  /** Gaussian thickness σ across x, m (default two cells). A one-cell edge would ring at the grid's own frequency. */
  width?: number;
}

export interface WaveFieldOptions {
  /** m; the grid spans [−width/2, width/2] × [−height/2, height/2] around `center`. */
  width: number;
  height: number;
  /** Grid nodes along x; the spacing is the same along y. */
  cells: number;
  /** Wave speed, m/s. */
  speed: number;
  /** Background velocity damping γ, 1/s. */
  damping?: number;
  center?: Vec2;
  /** Fixed edges reflect; absorbing edges soak waves up in a sponge layer, like an open sea. */
  edges?: 'fixed' | 'absorbing';
  /** Sponge thickness, m. */
  sponge?: number;
  /** Cells inside a wall stay at rest: barriers, slits, drum rims. */
  walls?: (x: number, y: number) => boolean;
  sources?: PointSource[];
  lineSources?: LineSource[];
  initial?: (x: number, y: number) => { u: number; v: number };
  /** Points whose displacement can be read with probe(). */
  probes?: Vec2[];
  /** A vertical line x = const where the time-averaged intensity ⟨u²⟩ is collected. */
  screen?: { x: number; averaging: number };
  /** Exact solution u(x, y, t) for the error readout. */
  exact?: (x: number, y: number, t: number) => number;
  /** Fixed sub-step instead of the Courant-limited default, s (for exact comparisons). */
  substep?: number;
  label?: string;
  color?: string;
}

/**
 * Peak sponge damping is SPONGE_STRENGTH·c/thickness, ramped up
 * quadratically. Weaker sponges let a third of a wave's amplitude bounce
 * back (round-trip attenuation is only e^(−K/3)); much stronger ones reflect
 * off their own steep gradient. 20 measured best for point and plane waves.
 */
const SPONGE_STRENGTH = 20;

/** Fraction of the 2D stability limit c·dt/dx ≤ 1/√2 used for sub-steps. */
const COURANT = 0.9 / Math.SQRT2;
/**
 * Sub-steps per period of the fastest source. Leapfrog conserves a "shadow"
 * energy that differs from KE + PE by about (ωh)²/4; 60 steps a period keep
 * that under 0.3 %.
 */
const STEPS_PER_PERIOD = 60;

/**
 * Transverse waves on a membrane or a water surface: the 2D wave equation
 * u_tt = c²∇²u − γ·u_t + f on a square grid (5-point Laplacian), stepped
 * with leapfrog (kick–drift–kick) between exact damping half-steps.
 * Sources add forcing f, walls pin cells,
 * an optional sponge absorbs outgoing waves. Energy, heat lost to damping
 * and work done by the sources are all tracked.
 */
export class WaveField implements Simulation {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly speed: number;
  /** Bottom-left grid node in world coordinates. */
  readonly x0: number;
  readonly y0: number;
  readonly label: string;
  readonly color: string;
  readonly dissipative: boolean;
  readonly sources: readonly PointSource[];
  readonly lineSources: readonly LineSource[];
  readonly probes: readonly Vec2[];
  readonly screen: { column: number; averaging: number; intensity: Float64Array } | null;
  /** 1 for pinned cells (walls and the outer rim). */
  readonly wall: Uint8Array;
  readonly u: Float64Array;
  readonly v: Float64Array;

  t = 0;
  steps = 0;
  diverged = false;
  dissipated = 0;
  externalWork = 0;
  readonly initialEnergy: number;
  /** A finger pressing the surface. */
  grab: { target: Vec2 } | null = null;

  private readonly gamma: Float64Array;
  private readonly a: Float64Array;
  private readonly force: Float64Array;
  /** Forcing at the start of the current sub-step, and each cell's displacement change. */
  private readonly forcePrev: Float64Array;
  private readonly du: Float64Array;
  private accelValid = false;
  private readonly fixedStep: number | null;
  private readonly maxSubstep: number;
  private readonly exact: ((x: number, y: number, t: number) => number) | null;
  private readonly initialU: Float64Array;
  private readonly initialV: Float64Array;

  constructor(options: WaveFieldOptions) {
    this.nx = options.cells;
    this.dx = options.width / (this.nx - 1);
    this.ny = Math.round(options.height / this.dx) + 1;
    this.speed = options.speed;
    const center = options.center ?? Vec2.ZERO;
    this.x0 = center.x - ((this.nx - 1) * this.dx) / 2;
    this.y0 = center.y - ((this.ny - 1) * this.dx) / 2;
    this.label = options.label ?? 'Хвилі';
    this.color = options.color ?? '#3987e5';
    this.sources = options.sources ?? [];
    this.lineSources = options.lineSources ?? [];
    this.probes = options.probes ?? [];
    this.fixedStep = options.substep ?? null;
    const fastest = Math.max(0, ...this.sources.map((s) => s.frequency), ...this.lineSources.map((s) => s.frequency));
    this.maxSubstep = Math.min((COURANT * this.dx) / this.speed, fastest > 0 ? 1 / (STEPS_PER_PERIOD * fastest) : Infinity);
    this.exact = options.exact ?? null;

    const size = this.nx * this.ny;
    this.u = new Float64Array(size);
    this.v = new Float64Array(size);
    this.a = new Float64Array(size);
    this.force = new Float64Array(size);
    this.forcePrev = new Float64Array(size);
    this.du = new Float64Array(size);
    this.wall = new Uint8Array(size);
    this.gamma = new Float64Array(size).fill(options.damping ?? 0);

    const sponge = options.edges === 'absorbing' ? (options.sponge ?? 0.15 * Math.min(options.width, options.height)) : 0;
    const maxSponge = sponge > 0 ? (SPONGE_STRENGTH * this.speed) / sponge : 0;
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        const x = this.x(i);
        const y = this.y(j);
        if (i === 0 || j === 0 || i === this.nx - 1 || j === this.ny - 1 || options.walls?.(x, y)) this.wall[k] = 1;
        if (sponge > 0) {
          const edge = Math.min(i, j, this.nx - 1 - i, this.ny - 1 - j) * this.dx;
          if (edge < sponge) this.gamma[k] += maxSponge * ((sponge - edge) / sponge) ** 2;
        }
        if (options.initial && !this.wall[k]) {
          const { u, v } = options.initial(x, y);
          this.u[k] = u;
          this.v[k] = v;
        }
      }
    }
    this.dissipative = this.gamma.some((g) => g > 0);
    this.screen = options.screen
      ? {
          column: Math.round((options.screen.x - this.x0) / this.dx),
          averaging: options.screen.averaging,
          intensity: new Float64Array(this.ny),
        }
      : null;
    this.initialU = this.u.slice();
    this.initialV = this.v.slice();
    this.initialEnergy = this.totalEnergy();
  }

  x(i: number): number {
    return this.x0 + i * this.dx;
  }

  y(j: number): number {
    return this.y0 + j * this.dx;
  }

  /** Sub-step used for an app step dt. */
  substep(dt: number): number {
    const limit = this.fixedStep ?? this.maxSubstep;
    return dt / Math.max(1, Math.ceil(dt / limit - 1e-9));
  }

  step(dt: number): void {
    if (this.diverged) return;
    const h = this.substep(dt);
    for (let k = 0, n = Math.round(dt / h); k < n; k++) this.advance(h);
    this.steps++;
    if (!this.u.every(Number.isFinite)) this.diverged = true;
  }

  /**
   * Damping half-step, kick–drift–kick, damping half-step (Strang splitting).
   * Damping is applied as the exact decay v·e^(−γh/2), so the heat it takes
   * is known exactly and even a stiff sponge stays stable. The closing
   * acceleration is reused by the next sub-step.
   */
  private advance(h: number): void {
    const { u, v, a } = this;
    const size = u.length;
    const grabbed = this.grab !== null;
    if (grabbed) this.accelValid = false;
    const energyBefore = grabbed ? this.totalEnergy() + this.dissipated : 0;

    this.decay(h / 2);
    if (!this.accelValid) this.accel(this.t);
    const { du, force, forcePrev } = this;
    forcePrev.set(force);
    for (let k = 0; k < size; k++) {
      v[k] += 0.5 * h * a[k];
      du[k] = h * v[k];
      u[k] += du[k];
    }
    this.t += h;
    this.accel(this.t);
    for (let k = 0; k < size; k++) v[k] += 0.5 * h * a[k];
    this.accelValid = true;
    this.decay(h / 2);

    if (grabbed) {
      this.externalWork += this.totalEnergy() + this.dissipated - energyBefore;
    } else {
      // Work of the sources as leapfrog sees it: average force times displacement.
      let work = 0;
      for (let k = 0; k < size; k++) if (force[k] !== 0 || forcePrev[k] !== 0) work += 0.5 * (forcePrev[k] + force[k]) * du[k];
      this.externalWork += work * this.dx * this.dx;
    }
    this.sampleScreen(h);
  }

  /** Exact velocity decay over time τ; books the kinetic energy it removes. */
  private decay(tau: number): void {
    if (!this.dissipative) return;
    const { v, gamma } = this;
    let lost = 0;
    for (let k = 0; k < v.length; k++) {
      if (gamma[k] === 0) continue;
      const next = v[k] * Math.exp(-gamma[k] * tau);
      lost += v[k] * v[k] - next * next;
      v[k] = next;
    }
    this.dissipated += 0.5 * lost * this.dx * this.dx;
  }

  /** Fills `a` (and the forcing in `force`) at time t from the current u, v. */
  private accel(t: number): void {
    const { u, a, nx, ny, wall, force } = this;
    this.computeForcing(t);
    const k = (this.speed / this.dx) ** 2;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (wall[c]) {
          a[c] = 0;
          continue;
        }
        const lap = u[c - 1] + u[c + 1] + u[c - nx] + u[c + nx] - 4 * u[c];
        a[c] = k * lap + force[c];
      }
    }
  }

  /** Forcing per cell at time t: sources, plane-wave dippers and a pressing finger. */
  private computeForcing(t: number): void {
    const { force, nx, ny, dx } = this;
    force.fill(0);
    for (const s of this.sources) {
      const p = s.position(t);
      const amp = s.amplitude * Math.sin(2 * Math.PI * s.frequency * t + (s.phase ?? 0));
      const reach = Math.ceil((3 * s.radius) / dx);
      const ci = Math.round((p.x - this.x0) / dx);
      const cj = Math.round((p.y - this.y0) / dx);
      for (let j = Math.max(1, cj - reach); j <= Math.min(ny - 2, cj + reach); j++) {
        for (let i = Math.max(1, ci - reach); i <= Math.min(nx - 2, ci + reach); i++) {
          const r2 = (this.x(i) - p.x) ** 2 + (this.y(j) - p.y) ** 2;
          force[j * nx + i] += amp * Math.exp(-r2 / (2 * s.radius * s.radius));
        }
      }
    }
    for (const line of this.lineSources) {
      const sigma = line.width ?? 2 * dx;
      const reach = Math.ceil((3 * sigma) / dx);
      const ci = Math.round((line.x - this.x0) / dx);
      const amp = line.amplitude * Math.sin(2 * Math.PI * line.frequency * t + (line.phase ?? 0));
      for (let i = Math.max(1, ci - reach); i <= Math.min(nx - 2, ci + reach); i++) {
        const profile = amp * Math.exp(-((this.x(i) - line.x) ** 2) / (2 * sigma * sigma));
        for (let j = 1; j < ny - 1; j++) force[j * nx + i] += profile;
      }
    }
    if (this.grab) {
      // Spring pulling a dimple under the finger, stiff but stable for the sub-step.
      const g = this.grab.target;
      const radius = 3 * dx;
      const reach = Math.ceil((2.5 * radius) / dx);
      const ci = Math.round((g.x - this.x0) / dx);
      const cj = Math.round((g.y - this.y0) / dx);
      const stiffness = (0.3 * this.speed) / dx;
      for (let j = Math.max(1, cj - reach); j <= Math.min(ny - 2, cj + reach); j++) {
        for (let i = Math.max(1, ci - reach); i <= Math.min(nx - 2, ci + reach); i++) {
          const c = j * nx + i;
          const r2 = (this.x(i) - g.x) ** 2 + (this.y(j) - g.y) ** 2;
          const target = -this.dimpleDepth() * Math.exp(-r2 / (2 * radius * radius));
          force[c] += stiffness * stiffness * (target - this.u[c]) - 2 * stiffness * this.v[c];
        }
      }
    }
  }

  /** How deep the finger presses: about the size of the current waves, or half a cell if calm. */
  private dimpleDepth(): number {
    return Math.max(this.peak(), 0.5 * this.dx);
  }

  private sampleScreen(h: number): void {
    const s = this.screen;
    if (!s) return;
    const w = Math.min(1, h / s.averaging);
    for (let j = 0; j < this.ny; j++) {
      const u = this.u[j * this.nx + s.column];
      s.intensity[j] += w * (u * u - s.intensity[j]);
    }
  }

  /** Displacement at a world point (bilinear interpolation). */
  sample(p: Vec2): number {
    const fx = (p.x - this.x0) / this.dx;
    const fy = (p.y - this.y0) / this.dx;
    const i = Math.min(Math.max(Math.floor(fx), 0), this.nx - 2);
    const j = Math.min(Math.max(Math.floor(fy), 0), this.ny - 2);
    const tx = fx - i;
    const ty = fy - j;
    const k = j * this.nx + i;
    const { u, nx } = this;
    return (1 - ty) * ((1 - tx) * u[k] + tx * u[k + 1]) + ty * ((1 - tx) * u[k + nx] + tx * u[k + nx + 1]);
  }

  probe(index: number): number {
    return this.sample(this.probes[index]);
  }

  /** Largest |u| over the grid. */
  peak(): number {
    let m = 0;
    for (let k = 0; k < this.u.length; k++) m = Math.max(m, Math.abs(this.u[k]));
    return m;
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
    this.accelValid = false;
    this.screen?.intensity.fill(0);
  }

  /** ½·Σ v²·dA with areal density 1 kg/m². */
  kineticEnergy(): number {
    let e = 0;
    for (let k = 0; k < this.v.length; k++) e += this.v[k] * this.v[k];
    return 0.5 * e * this.dx * this.dx;
  }

  /** ½·T·Σ (Δu)² over grid edges, T = c² (tension per unit length for density 1). */
  potentialEnergy(): number {
    const { u, nx, ny } = this;
    let e = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (i + 1 < nx) e += (u[c + 1] - u[c]) ** 2;
        if (j + 1 < ny) e += (u[c + nx] - u[c]) ** 2;
      }
    }
    return 0.5 * this.speed * this.speed * e;
  }

  totalEnergy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  energyBalance(): number {
    return this.totalEnergy() + this.dissipated - this.externalWork;
  }

  energyDrift(): number {
    // A driven tank starts at rest: measure against the energy that flowed through.
    const scale = Math.max(Math.abs(this.initialEnergy), Math.abs(this.externalWork), this.dissipated) || 1;
    return (this.energyBalance() - this.initialEnergy) / scale;
  }

  exactError(): number | null {
    if (!this.exact) return null;
    let worst = 0;
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        worst = Math.max(worst, Math.abs(this.u[j * this.nx + i] - this.exact(this.x(i), this.y(j), this.t)));
      }
    }
    return worst;
  }

  trailSources(): TrailSource[] {
    return [];
  }

  hitTest(point: Vec2): boolean {
    return this.inside(point);
  }

  grabAt(point: Vec2): boolean {
    if (!this.inside(point)) return false;
    this.grab = { target: point };
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab && this.inside(point)) this.grab.target = point;
  }

  release(): void {
    this.grab = null;
    this.accelValid = false;
  }

  private inside(p: Vec2): boolean {
    return p.x > this.x(1) && p.x < this.x(this.nx - 2) && p.y > this.y(1) && p.y < this.y(this.ny - 2);
  }
}

/**
 * Exact solution for one standing mode of the grid itself, cos(θ·t/h)·φ
 * with cos θ = 1 − λh²/2: what leapfrog produces from rest, to round-off.
 * λ is the 5-point Laplacian eigenvalue of sin(mπx/W)·sin(nπy/H).
 */
export function gridModeFrequency(m: number, n: number, field: WaveField, h: number): number {
  const width = (field.nx - 1) * field.dx;
  const height = (field.ny - 1) * field.dx;
  const lambda =
    ((4 * field.speed ** 2) / field.dx ** 2) *
    (Math.sin((m * Math.PI * field.dx) / (2 * width)) ** 2 + Math.sin((n * Math.PI * field.dx) / (2 * height)) ** 2);
  return Math.acos(1 - (lambda * h * h) / 2) / h; // angular frequency, rad/s
}
