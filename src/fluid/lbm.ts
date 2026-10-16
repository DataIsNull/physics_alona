import type { Simulation, TrailSource } from '../core/simulation';
import { Vec2 } from '../core/vec2';

/** D2Q9 lattice: rest, four axis and four diagonal velocities. */
const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
const OPPOSITE = [0, 3, 4, 1, 2, 7, 8, 5, 6];
/** One direction of each opposite pair. */
const PAIRS = [1, 2, 5, 6];
/** TRT "magic" parameter: with 3/16 bounce-back walls sit exactly halfway between nodes for any viscosity. */
const MAGIC = 3 / 16;

export interface FlowOptions {
  /** Cells across and up. */
  nx: number;
  ny: number;
  /** Cell size, m. */
  spacing: number;
  /** Lattice time step, s. */
  dt: number;
  /** Kinematic viscosity ν, m²/s. */
  viscosity: number;
  /** Fluid density, kg/m³, for forces and energies. */
  density?: number;
  /** The 2D slice stands for a layer this thick, m. */
  thickness?: number;
  center?: Vec2;
  /**
   * 'channel': fluid enters on the left at `inflow`, leaves on the right,
   * and the top and bottom edges are far field moving at `inflow`.
   * 'periodic': what leaves on the right comes back on the left; the
   * top and bottom are walls.
   */
  boundary: 'channel' | 'periodic';
  /** Inflow speed, m/s. */
  inflow?: number;
  /** Uniform driving acceleration (a pressure gradient over the density), m/s². */
  force?: Vec2;
  /** Solid obstacles. */
  solid?: (x: number, y: number) => boolean;
  /** Starting velocity, m/s; the inflow speed everywhere by default. */
  initial?: (x: number, y: number) => Vec2;
  /** Dye particles carried by the flow from the start. */
  tracers?: Vec2[];
  /** Points that release a dye particle every `emitEvery` steps; the oldest dye is reused. */
  emitters?: Vec2[];
  emitEvery?: number;
  tracerLimit?: number;
  /** What the picture shows: signed vorticity or speed. */
  show?: 'vorticity' | 'speed';
  label?: string;
  color?: string;
}

/**
 * Lattice Boltzmann flow (D2Q9). Instead of solving the Navier–Stokes
 * equations directly, the fluid is a gas of fictitious particle populations
 * hopping between lattice nodes along nine directions and relaxing towards a
 * local equilibrium in collisions. Mass and momentum are conserved in every
 * collision, and on scales larger than a few cells the populations move
 * exactly like a viscous liquid with ν = (τ − ½)·dx²/(3dt). Two-relaxation-
 * time collisions (TRT) with Guo's forcing; walls bounce populations back.
 */
export class FlowWorld implements Simulation {
  readonly label: string;
  readonly color: string;
  readonly dissipative = false;
  readonly dissipated = 0;
  readonly externalWork = 0;
  readonly initialEnergy: number;
  readonly nx: number;
  readonly ny: number;
  readonly spacing: number;
  readonly latticeDt: number;
  readonly viscosity: number;
  readonly density: number;
  readonly thickness: number;
  readonly x0: number;
  readonly y0: number;
  readonly boundary: 'channel' | 'periodic';
  readonly show: 'vorticity' | 'speed';
  /** Lattice units: inflow speed and driving acceleration. */
  readonly inflow: number;
  readonly forceX: number;
  readonly forceY: number;
  readonly solid: Uint8Array;
  /** Density and velocity per cell, lattice units. */
  readonly rho: Float64Array;
  readonly ux: Float64Array;
  readonly uy: Float64Array;
  /** Dye positions, m. */
  readonly tracerX: Float64Array;
  readonly tracerY: Float64Array;
  tracerCount = 0;

  t = 0;
  steps = 0;
  diverged = false;
  /** Force of the fluid on all solids per unit thickness, from the last lattice step, N/m. */
  dragX = 0;
  dragY = 0;
  grab: { target: Vec2; last: Vec2 } | null = null;

  /** Populations, flat: population q of cell k at q·N + k. `post` holds the last post-collision state. */
  private f: Float64Array;
  private post: Float64Array;
  /** Cells next to a solid or the edge of the box take the careful streaming path. */
  private readonly edge: Uint8Array;
  private readonly fin = new Float64Array(9);
  private latticeSteps = 0;
  /** Scratch result of velocityAtXY, m/s. */
  private sampleU = 0;
  private sampleV = 0;
  private readonly omegaPlus: number;
  private readonly omegaMinus: number;
  private readonly emitters: Vec2[];
  private readonly initialVelocity: ((x: number, y: number) => Vec2) | null;
  private readonly emitEvery: number;
  private nextTracer = 0;
  private readonly initialTracers: Vec2[];
  /** Pointer stirring force per cell this step, lattice units. */
  private readonly stirX: Float64Array;
  private readonly stirY: Float64Array;
  private stirring = false;
  /** Leftover simulated time when the app step isn't a whole number of lattice steps. */
  private pending = 0;

  constructor(options: FlowOptions) {
    const { nx, ny } = options;
    this.nx = nx;
    this.ny = ny;
    this.spacing = options.spacing;
    this.latticeDt = options.dt;
    this.viscosity = options.viscosity;
    this.density = options.density ?? 1000;
    this.thickness = options.thickness ?? 0.1;
    this.boundary = options.boundary;
    this.show = options.show ?? 'vorticity';
    this.label = options.label ?? 'Течія';
    this.color = options.color ?? '#3987e5';
    const center = options.center ?? Vec2.ZERO;
    this.x0 = center.x - (nx * this.spacing) / 2;
    this.y0 = center.y - (ny * this.spacing) / 2;

    const velocityUnit = this.spacing / this.latticeDt;
    this.inflow = (options.inflow ?? 0) / velocityUnit;
    const accelerationUnit = this.spacing / this.latticeDt ** 2;
    this.forceX = (options.force?.x ?? 0) / accelerationUnit;
    this.forceY = (options.force?.y ?? 0) / accelerationUnit;
    const nuLattice = (this.viscosity * this.latticeDt) / this.spacing ** 2;
    const tau = 3 * nuLattice + 0.5;
    this.omegaPlus = 1 / tau;
    this.omegaMinus = 1 / (0.5 + MAGIC / (tau - 0.5));

    const size = nx * ny;
    this.solid = new Uint8Array(size);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (options.solid?.(this.cellX(i), this.cellY(j))) this.solid[j * nx + i] = 1;
      }
    }
    this.rho = new Float64Array(size).fill(1);
    this.ux = new Float64Array(size);
    this.uy = new Float64Array(size);
    this.stirX = new Float64Array(size);
    this.stirY = new Float64Array(size);
    this.initialVelocity = options.initial ?? null;
    this.f = new Float64Array(9 * size);
    this.post = new Float64Array(9 * size);
    this.edge = new Uint8Array(size);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let near = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
        for (let q = 1; q < 9 && !near; q++) near = this.solid[(j - CY[q]) * nx + i - CX[q]] === 1;
        this.edge[j * nx + i] = near ? 1 : 0;
      }
    }
    this.fillEquilibrium();

    this.emitters = options.emitters ?? [];
    this.emitEvery = options.emitEvery ?? 10;
    this.initialTracers = options.tracers ?? [];
    const limit = Math.max(options.tracerLimit ?? 0, this.initialTracers.length);
    this.tracerX = new Float64Array(limit);
    this.tracerY = new Float64Array(limit);
    this.resetTracers();
    this.initialEnergy = this.kineticEnergy();
  }

  /** Centre of cell (i, j), m. */
  cellX(i: number): number {
    return this.x0 + (i + 0.5) * this.spacing;
  }

  cellY(j: number): number {
    return this.y0 + (j + 0.5) * this.spacing;
  }

  /** Lattice speed dx/dt, m/s: multiply lattice velocities by it. */
  get velocityUnit(): number {
    return this.spacing / this.latticeDt;
  }

  /** Relaxation time τ; the scheme is stable and accurate for τ comfortably above ½. */
  get tau(): number {
    return 1 / this.omegaPlus;
  }

  /** Equilibrium start at the initial velocity: the inflow speed everywhere (or rest) unless given. */
  private fillEquilibrium(): void {
    const size = this.nx * this.ny;
    const unit = this.velocityUnit;
    for (let k = 0; k < size; k++) {
      let u = this.solid[k] ? 0 : this.inflow;
      let v = 0;
      if (this.initialVelocity && !this.solid[k]) {
        const start = this.initialVelocity(this.cellX(k % this.nx), this.cellY(Math.floor(k / this.nx)));
        u = start.x / unit;
        v = start.y / unit;
      }
      this.rho[k] = 1;
      this.ux[k] = u;
      this.uy[k] = v;
      for (let q = 0; q < 9; q++) this.post[q * size + k] = equilibrium(q, 1, u, v);
    }
  }

  // ── Dynamics ────────────────────────────────────────────────────────────

  step(dt: number): void {
    if (this.diverged) return;
    this.pending += dt;
    const count = Math.max(0, Math.round(this.pending / this.latticeDt - 1e-9));
    this.pending -= count * this.latticeDt;
    this.prepareStirring(count * this.latticeDt);
    for (let k = 0; k < count; k++) this.advance();
    // Dye moves once per app step: it crosses well under a cell in that time.
    const before = this.latticeSteps - count;
    this.advectTracers(count * this.latticeDt, Math.floor(this.latticeSteps / this.emitEvery) - Math.floor(before / this.emitEvery));
    this.steps++;
    if (!Number.isFinite(this.ux[Math.floor(this.nx * this.ny / 2)])) this.diverged = true;
  }

  /** Stream (pull from neighbours, bounce back off solids) and collide, one lattice step. */
  private advance(): void {
    const { nx, ny, solid, edge, rho, ux, uy, post, f, stirX, stirY, fin } = this;
    const N = nx * ny;
    const periodic = this.boundary === 'periodic';
    const wp = this.omegaPlus;
    const wm = this.omegaMinus;
    let dragX = 0;
    let dragY = 0;
    const jStart = periodic ? 0 : 1;
    const jEnd = periodic ? ny : ny - 1;
    const iStart = periodic ? 0 : 1;
    const iEnd = periodic ? nx : nx - 1;

    for (let j = jStart; j < jEnd; j++) {
      for (let i = iStart; i < iEnd; i++) {
        const k = j * nx + i;
        if (solid[k]) continue;
        // Streaming: population q arrives from the cell behind it.
        if (edge[k]) {
          for (let q = 0; q < 9; q++) {
            let si = i - CX[q];
            const sj = j - CY[q];
            if (periodic) si = (si + nx) % nx;
            if (sj < 0 || sj >= ny || solid[sj * nx + si]) {
              // Bounce-back: what this cell sent towards the wall comes straight back.
              const value = post[OPPOSITE[q] * N + k];
              dragX -= 2 * value * CX[q];
              dragY -= 2 * value * CY[q];
              fin[q] = value;
            } else {
              fin[q] = post[q * N + sj * nx + si];
            }
          }
        } else {
          fin[0] = post[k];
          fin[1] = post[N + k - 1];
          fin[2] = post[2 * N + k - nx];
          fin[3] = post[3 * N + k + 1];
          fin[4] = post[4 * N + k + nx];
          fin[5] = post[5 * N + k - 1 - nx];
          fin[6] = post[6 * N + k + 1 - nx];
          fin[7] = post[7 * N + k + 1 + nx];
          fin[8] = post[8 * N + k - 1 + nx];
        }
        const density = fin[0] + fin[1] + fin[2] + fin[3] + fin[4] + fin[5] + fin[6] + fin[7] + fin[8];
        const mx = fin[1] - fin[3] + fin[5] - fin[6] - fin[7] + fin[8];
        const my = fin[2] - fin[4] + fin[5] + fin[6] - fin[7] - fin[8];
        // Guo forcing: the velocity includes half the step's impulse.
        const Fx = (this.forceX + stirX[k]) * density;
        const Fy = (this.forceY + stirY[k]) * density;
        const u = (mx + 0.5 * Fx) / density;
        const v = (my + 0.5 * Fy) / density;
        rho[k] = density;
        ux[k] = u;
        uy[k] = v;

        // TRT collision: symmetric parts relax at ω₊ (sets the viscosity), antisymmetric at ω₋.
        const usq = 1.5 * (u * u + v * v);
        const uF = u * Fx + v * Fy;
        f[k] = fin[0] - wp * (fin[0] - density * W[0] * (1 - usq)) + (1 - wp / 2) * W[0] * -3 * uF;
        for (let p = 0; p < 4; p++) {
          // Pairs (1,3), (2,4), (5,7), (6,8).
          const q = PAIRS[p];
          const o = OPPOSITE[q];
          const cu = CX[q] * u + CY[q] * v;
          const cF = CX[q] * Fx + CY[q] * Fy;
          const eqPlus = density * W[q] * (1 + 4.5 * cu * cu - usq);
          const eqMinus = density * W[q] * 3 * cu;
          const plus = 0.5 * (fin[q] + fin[o]);
          const minus = 0.5 * (fin[q] - fin[o]);
          const sourcePlus = W[q] * (9 * cu * cF - 3 * uF);
          const sourceMinus = W[q] * 3 * cF;
          const relaxPlus = -wp * (plus - eqPlus) + (1 - wp / 2) * sourcePlus;
          const relaxMinus = -wm * (minus - eqMinus) + (1 - wm / 2) * sourceMinus;
          f[q * N + k] = fin[q] + relaxPlus + relaxMinus;
          f[o * N + k] = fin[o] + relaxPlus - relaxMinus;
        }
      }
    }

    if (!periodic) this.openBoundaries();
    // The new post-collision populations become the next step's sources.
    this.f = post;
    this.post = f;

    // Lattice momentum per step → N per metre of thickness: ρ₀·dx²·(dx/dt)/dt.
    const unit = (this.density * this.spacing ** 3) / this.latticeDt ** 2;
    this.dragX = dragX * unit;
    this.dragY = dragY * unit;
    this.latticeSteps++;
    this.t += this.latticeDt;
  }

  /** Inflow and far field held at the free stream; the outlet copies its neighbour (zero gradient). */
  private openBoundaries(): void {
    const { nx, ny, f } = this;
    const N = nx * ny;
    const U = this.inflow;
    const setFree = (k: number) => {
      this.rho[k] = 1;
      this.ux[k] = U;
      this.uy[k] = 0;
      for (let q = 0; q < 9; q++) f[q * N + k] = equilibrium(q, 1, U, 0);
    };
    for (let j = 0; j < ny; j++) {
      setFree(j * nx);
      const out = j * nx + nx - 1;
      const inner = out - 1;
      for (let q = 0; q < 9; q++) f[q * N + out] = f[q * N + inner];
      this.rho[out] = this.rho[inner];
      this.ux[out] = this.ux[inner];
      this.uy[out] = this.uy[inner];
    }
    for (let i = 1; i < nx - 1; i++) {
      setFree(i);
      setFree((ny - 1) * nx + i);
    }
  }

  // ── Dye ─────────────────────────────────────────────────────────────────

  private resetTracers(): void {
    this.initialTracers.forEach((p, k) => {
      this.tracerX[k] = p.x;
      this.tracerY[k] = p.y;
    });
    this.tracerCount = this.initialTracers.length;
    this.nextTracer = this.tracerCount % Math.max(1, this.tracerX.length);
  }

  /** Moves dye with the local flow for dt (bilinear velocity, midpoint rule) and releases `emissions` new rounds of dye. */
  private advectTracers(dt: number, emissions: number): void {
    const width = this.nx * this.spacing;
    for (let k = 0; k < this.tracerCount; k++) {
      const x = this.tracerX[k];
      const y = this.tracerY[k];
      this.velocityAtXY(x, y);
      this.velocityAtXY(x + 0.5 * dt * this.sampleU, y + 0.5 * dt * this.sampleV);
      let nx = x + dt * this.sampleU;
      if (this.boundary === 'periodic') nx = this.x0 + ((((nx - this.x0) % width) + width) % width);
      this.tracerX[k] = nx;
      this.tracerY[k] = y + dt * this.sampleV;
    }
    if (this.emitters.length === 0 || this.tracerX.length === 0) return;
    for (let e = 0; e < emissions; e++) {
      for (const p of this.emitters) {
        this.tracerX[this.nextTracer] = p.x;
        this.tracerY[this.nextTracer] = p.y;
        this.nextTracer = (this.nextTracer + 1) % this.tracerX.length;
        this.tracerCount = Math.min(this.tracerCount + 1, this.tracerX.length);
      }
    }
  }

  /** Flow velocity at a point by bilinear interpolation, m/s (zero inside solids and outside). */
  velocityAt(point: Vec2): Vec2 {
    this.velocityAtXY(point.x, point.y);
    return new Vec2(this.sampleU, this.sampleV);
  }

  /** Writes the interpolated velocity into sampleU, sampleV (no allocation: dye calls it a lot). */
  private velocityAtXY(x: number, y: number): void {
    this.sampleU = this.sampleV = 0;
    const gx = (x - this.x0) / this.spacing - 0.5;
    const gy = (y - this.y0) / this.spacing - 0.5;
    if (gx < 0 || gy < 0 || gx > this.nx - 1 || gy > this.ny - 1) return;
    const i = Math.min(this.nx - 2, Math.floor(gx));
    const j = Math.min(this.ny - 2, Math.floor(gy));
    const a = gx - i;
    const b = gy - j;
    const k = j * this.nx + i;
    let u = 0;
    let v = 0;
    const add = (cell: number, w: number) => {
      if (this.solid[cell]) return;
      u += w * this.ux[cell];
      v += w * this.uy[cell];
    };
    add(k, (1 - a) * (1 - b));
    add(k + 1, a * (1 - b));
    add(k + this.nx, (1 - a) * b);
    add(k + this.nx + 1, a * b);
    const unit = this.velocityUnit;
    this.sampleU = u * unit;
    this.sampleV = v * unit;
  }

  // ── Stirring ────────────────────────────────────────────────────────────

  /** Turns pointer motion since the last app step into a local push towards the pointer's velocity. */
  private prepareStirring(elapsed: number): void {
    if (this.stirring) {
      this.stirX.fill(0);
      this.stirY.fill(0);
      this.stirring = false;
    }
    const g = this.grab;
    if (!g || elapsed <= 0) return;
    const unit = this.velocityUnit;
    // Pointer velocity in lattice units, capped to keep the flow subsonic.
    let pu = (g.target.x - g.last.x) / elapsed / unit;
    let pv = (g.target.y - g.last.y) / elapsed / unit;
    const speed = Math.hypot(pu, pv);
    if (speed > 0.1) {
      pu *= 0.1 / speed;
      pv *= 0.1 / speed;
    }
    g.last = g.target;
    const radius = 4;
    const ci = Math.floor((g.target.x - this.x0) / this.spacing);
    const cj = Math.floor((g.target.y - this.y0) / this.spacing);
    for (let j = Math.max(0, cj - radius); j <= Math.min(this.ny - 1, cj + radius); j++) {
      for (let i = Math.max(0, ci - radius); i <= Math.min(this.nx - 1, ci + radius); i++) {
        const k = j * this.nx + i;
        if (this.solid[k] || (i - ci) ** 2 + (j - cj) ** 2 > radius * radius) continue;
        // Relax the local velocity towards the pointer's over a few steps.
        this.stirX[k] = 0.2 * (pu - this.ux[k]);
        this.stirY[k] = 0.2 * (pv - this.uy[k]);
      }
    }
    this.stirring = true;
  }

  // ── Measurements ────────────────────────────────────────────────────────

  /** Vorticity ∂v/∂x − ∂u/∂y at cell (i, j), 1/s. */
  vorticity(i: number, j: number): number {
    const { nx, ny, ux, uy } = this;
    if (i <= 0 || j <= 0 || i >= nx - 1 || j >= ny - 1) return 0;
    const k = j * nx + i;
    const dvdx = (uy[k + 1] - uy[k - 1]) / 2;
    const dudy = (ux[k + nx] - ux[k - nx]) / 2;
    return (dvdx - dudy) / this.latticeDt;
  }

  /** Speed at cell k, m/s. */
  speed(k: number): number {
    return Math.hypot(this.ux[k], this.uy[k]) * this.velocityUnit;
  }

  /** Total mass per unit thickness in lattice units (constant in a closed box). */
  totalMass(): number {
    let m = 0;
    for (let k = 0; k < this.rho.length; k++) if (!this.solid[k]) m += this.rho[k];
    return m;
  }

  /** x-velocity profile across the channel at column i, m/s. */
  profile(i: number): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.ny; j++) out.push(this.solid[j * this.nx + i] ? 0 : this.ux[j * this.nx + i] * this.velocityUnit);
    return out;
  }

  // ── Simulation interface ────────────────────────────────────────────────

  reset(): void {
    this.fillEquilibrium();
    this.t = 0;
    this.steps = 0;
    this.diverged = false;
    this.pending = 0;
    this.latticeSteps = 0;
    this.dragX = this.dragY = 0;
    this.grab = null;
    this.stirX.fill(0);
    this.stirY.fill(0);
    this.resetTracers();
  }

  kineticEnergy(): number {
    let e = 0;
    for (let k = 0; k < this.rho.length; k++) if (!this.solid[k]) e += 0.5 * this.rho[k] * (this.ux[k] ** 2 + this.uy[k] ** 2);
    return e * this.density * this.spacing ** 2 * this.thickness * this.velocityUnit ** 2;
  }

  potentialEnergy(): number {
    return 0;
  }

  totalEnergy(): number {
    return this.kineticEnergy();
  }

  /** An open flow has no closed energy books: power comes in with the stream and leaves as heat and outflow. */
  energyBalance(): number {
    return NaN;
  }

  energyDrift(): number {
    return NaN;
  }

  trailSources(): TrailSource[] {
    return [];
  }

  hitTest(point: Vec2): boolean {
    return this.inside(point);
  }

  grabAt(point: Vec2): boolean {
    if (!this.inside(point)) return false;
    this.grab = { target: point, last: point };
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab) this.grab.target = point;
  }

  release(): void {
    this.grab = null;
  }

  private inside(point: Vec2): boolean {
    return point.x > this.x0 && point.y > this.y0 && point.x < this.x0 + this.nx * this.spacing && point.y < this.y0 + this.ny * this.spacing;
  }
}

/** Second-order equilibrium populations for density ρ and velocity (u, v), lattice units. */
export function equilibrium(q: number, rho: number, u: number, v: number): number {
  const cu = CX[q] * u + CY[q] * v;
  return W[q] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (u * u + v * v));
}

/**
 * Flow between walls at s = 0 and s = H started from rest by a steady
 * driving acceleration g, m/s: the parabola g·s(H − s)/2ν minus its odd
 * sine modes, each dying away as exp(−n²π²νt/H²).
 */
export function startingPoiseuille(s: number, t: number, H: number, nu: number, g: number): number {
  let u = (g / (2 * nu)) * s * (H - s);
  for (let n = 1; n < 400; n += 2) {
    const decay = Math.exp((-n * n * Math.PI ** 2 * nu * t) / (H * H));
    if (decay < 1e-16) break;
    u -= ((4 * g * H * H) / (nu * Math.PI ** 3 * n ** 3)) * Math.sin((n * Math.PI * s) / H) * decay;
  }
  return u;
}
