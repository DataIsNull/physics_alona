import type { Simulation, TrailSource } from '../core/simulation';
import { BOLTZMANN } from '../core/units';
import { Vec2 } from '../core/vec2';

/** One kind of atom: Lennard-Jones size σ and well depth ε. */
export interface Species {
  name: string;
  /** kg */
  mass: number;
  /** Distance where the pair potential crosses zero, m. Drawn as the atom's diameter. */
  sigma: number;
  /** Depth of the pair potential well, J. */
  epsilon: number;
  color: string;
}

/** Argon, the textbook Lennard-Jones atom. */
export const ARGON: Species = {
  name: 'Аргон',
  mass: 6.6335e-26,
  sigma: 3.405e-10,
  epsilon: 119.8 * BOLTZMANN,
  color: '#3987e5',
};

export interface GasParticle {
  pos: Vec2;
  vel: Vec2;
  species: number;
}

export interface GasOptions {
  /** Box size, m; the box is centred on `center`. */
  width: number;
  height: number;
  center?: Vec2;
  species: Species[];
  particles: GasParticle[];
  /**
   * 'lj': full Lennard-Jones cut at 2.5σ (attraction makes liquids and crystals);
   * 'repulsive': only the repulsive core (WCA), a nearly ideal gas of soft disks.
   */
  interaction?: 'lj' | 'repulsive';
  /** Downward gravity, m/s². */
  gravity?: number;
  /** Berendsen thermostat: nudges the temperature towards `temperature` with time constant `time`. */
  thermostat?: { temperature: number; time: number } | null;
  /** Averaging time for the wall pressure, s. */
  pressureTime?: number;
  colorBy?: 'species' | 'speed';
  /** Particles that leave a trail. */
  trails?: number[];
  label?: string;
  color?: string;
}

/** Cutoffs in units of σ. */
const LJ_CUTOFF = 2.5;
const WCA_CUTOFF = 2 ** (1 / 6);
/** Atoms this many times wider than the smallest species are handled outside the cell list. */
const LARGE_FACTOR = 2;

/**
 * Molecular dynamics of atoms in a box: velocity Verlet with pairwise
 * Lennard-Jones forces found through a cell list (O(N)), specular walls
 * that measure pressure as momentum transfer, optional gravity and a
 * Berendsen heat bath. Temperature, pressure and the Maxwell distribution
 * are not inputs: they come out of the motion.
 */
export class GasWorld implements Simulation {
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly species: Uint8Array;
  readonly speciesList: readonly Species[];
  readonly width: number;
  readonly height: number;
  readonly x0: number;
  readonly y0: number;
  readonly gravity: number;
  readonly label: string;
  readonly color: string;
  readonly colorBy: 'species' | 'speed';
  readonly dissipative = false;
  readonly dissipated = 0;
  thermostat: { temperature: number; time: number } | null;

  t = 0;
  steps = 0;
  diverged = false;
  /** Heat from the thermostat plus work by the pointer, J. */
  externalWork = 0;
  readonly initialEnergy: number;
  grab: { particle: number; target: Vec2 } | null = null;

  /** Wall pressure (force per unit length in 2D), averaged over `pressureTime`, N/m. */
  pressure = 0;

  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly mass: Float64Array;
  private readonly radius: Float64Array;
  private readonly large: number[] = [];
  private readonly small: number[] = [];
  private readonly cutoffFactor: number;
  private readonly pressureTime: number;
  private readonly trailIndices: number[];
  private potential = 0;
  private forcesValid = false;
  private readonly initial: Float64Array[];

  // Cell list over the small atoms.
  private readonly cellSize: number;
  private readonly cellsX: number;
  private readonly cellsY: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;

  // Pair constants by species pair.
  private readonly pairSigma2: Float64Array;
  private readonly pairEpsilon: Float64Array;
  private readonly pairCut2: Float64Array;
  private readonly pairShift: Float64Array;
  private readonly kinds: number;

  constructor(options: GasOptions) {
    this.n = options.particles.length;
    this.speciesList = options.species;
    this.width = options.width;
    this.height = options.height;
    const center = options.center ?? Vec2.ZERO;
    this.x0 = center.x - this.width / 2;
    this.y0 = center.y - this.height / 2;
    this.gravity = options.gravity ?? 0;
    this.thermostat = options.thermostat ?? null;
    this.pressureTime = options.pressureTime ?? 2e-12;
    this.colorBy = options.colorBy ?? 'speed';
    this.trailIndices = options.trails ?? [];
    this.label = options.label ?? 'Газ';
    this.color = options.color ?? '#3987e5';
    this.cutoffFactor = options.interaction === 'repulsive' ? WCA_CUTOFF : LJ_CUTOFF;

    const n = this.n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.species = new Uint8Array(n);
    this.mass = new Float64Array(n);
    this.radius = new Float64Array(n);
    const minSigma = Math.min(...this.speciesList.map((s) => s.sigma));
    options.particles.forEach((p, i) => {
      const s = this.speciesList[p.species];
      this.x[i] = p.pos.x;
      this.y[i] = p.pos.y;
      this.vx[i] = p.vel.x;
      this.vy[i] = p.vel.y;
      this.species[i] = p.species;
      this.mass[i] = s.mass;
      this.radius[i] = s.sigma / 2;
      (s.sigma > LARGE_FACTOR * minSigma ? this.large : this.small).push(i);
    });

    // Lorentz–Berthelot mixing: σᵢⱼ = (σᵢ + σⱼ)/2, εᵢⱼ = √(εᵢεⱼ); the potential is shifted to 0 at the cutoff.
    const k = (this.kinds = this.speciesList.length);
    this.pairSigma2 = new Float64Array(k * k);
    this.pairEpsilon = new Float64Array(k * k);
    this.pairCut2 = new Float64Array(k * k);
    this.pairShift = new Float64Array(k * k);
    let maxSmallCut = 0;
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) {
        const sigma = (this.speciesList[a].sigma + this.speciesList[b].sigma) / 2;
        const eps = Math.sqrt(this.speciesList[a].epsilon * this.speciesList[b].epsilon);
        const cut = this.cutoffFactor * sigma;
        const sr6 = (sigma / cut) ** 6;
        this.pairSigma2[a * k + b] = sigma * sigma;
        this.pairEpsilon[a * k + b] = eps;
        this.pairCut2[a * k + b] = cut * cut;
        this.pairShift[a * k + b] = 4 * eps * (sr6 * sr6 - sr6);
        const bothSmall =
          this.speciesList[a].sigma <= LARGE_FACTOR * minSigma && this.speciesList[b].sigma <= LARGE_FACTOR * minSigma;
        if (bothSmall) maxSmallCut = Math.max(maxSmallCut, cut);
      }
    }
    this.cellsX = Math.max(1, Math.floor(this.width / maxSmallCut));
    this.cellsY = Math.max(1, Math.floor(this.height / maxSmallCut));
    this.cellSize = Math.min(this.width / this.cellsX, this.height / this.cellsY);
    this.head = new Int32Array(this.cellsX * this.cellsY);
    this.next = new Int32Array(n);

    this.initial = [this.x.slice(), this.y.slice(), this.vx.slice(), this.vy.slice()];
    this.computeForces();
    this.initialEnergy = this.totalEnergy();
  }

  // ── Dynamics ────────────────────────────────────────────────────────────

  step(dt: number): void {
    if (this.diverged) return;
    const { n, x, y, vx, vy, ax, ay } = this;
    const grabbed = this.grab !== null;
    const before = grabbed ? this.totalEnergy() : 0;
    if (!this.forcesValid || grabbed) this.computeForces(dt);

    for (let i = 0; i < n; i++) {
      vx[i] += 0.5 * dt * ax[i];
      vy[i] += 0.5 * dt * ay[i];
      x[i] += dt * vx[i];
      y[i] += dt * vy[i];
    }
    const impulse = this.reflectOffWalls();
    this.computeForces(dt);
    for (let i = 0; i < n; i++) {
      vx[i] += 0.5 * dt * ax[i];
      vy[i] += 0.5 * dt * ay[i];
    }
    this.forcesValid = !grabbed;

    if (grabbed) this.externalWork += this.totalEnergy() - before;
    if (this.thermostat) this.applyThermostat(dt);

    // Pressure: momentum delivered to the walls per unit time and per unit wall length.
    const instant = impulse / (dt * 2 * (this.width + this.height));
    const w = Math.min(1, dt / this.pressureTime);
    this.pressure += w * (instant - this.pressure);

    this.t += dt;
    this.steps++;
    if (!Number.isFinite(this.kineticEnergy())) this.diverged = true;
  }

  /** Specular walls; returns the total normal momentum handed to them this step. */
  private reflectOffWalls(): number {
    const { n, x, y, vx, vy, mass, radius } = this;
    const right = this.x0 + this.width;
    const top = this.y0 + this.height;
    let impulse = 0;
    for (let i = 0; i < n; i++) {
      const r = radius[i];
      if (x[i] < this.x0 + r) {
        x[i] = 2 * (this.x0 + r) - x[i];
        if (vx[i] < 0) {
          impulse += -2 * mass[i] * vx[i];
          vx[i] = -vx[i];
        }
      } else if (x[i] > right - r) {
        x[i] = 2 * (right - r) - x[i];
        if (vx[i] > 0) {
          impulse += 2 * mass[i] * vx[i];
          vx[i] = -vx[i];
        }
      }
      if (y[i] < this.y0 + r) {
        y[i] = 2 * (this.y0 + r) - y[i];
        if (vy[i] < 0) {
          impulse += -2 * mass[i] * vy[i];
          vy[i] = -vy[i];
        }
      } else if (y[i] > top - r) {
        y[i] = 2 * (top - r) - y[i];
        if (vy[i] > 0) {
          impulse += 2 * mass[i] * vy[i];
          vy[i] = -vy[i];
        }
      }
      // A body that crossed more than the whole margin in one step (a violent start) is put back inside.
      x[i] = Math.min(Math.max(x[i], this.x0 + r), right - r);
      y[i] = Math.min(Math.max(y[i], this.y0 + r), top - r);
    }
    return impulse;
  }

  /** Berendsen: v ← λv with λ² = 1 + (dt/τ)(T₀/T − 1). The energy change is heat from the bath. */
  private applyThermostat(dt: number): void {
    const target = this.thermostat!;
    const ke = this.kineticEnergy();
    const T = this.temperature();
    if (T <= 0) return;
    const lambda = Math.sqrt(Math.max(0, 1 + (dt / target.time) * (target.temperature / T - 1)));
    for (let i = 0; i < this.n; i++) {
      this.vx[i] *= lambda;
      this.vy[i] *= lambda;
    }
    this.externalWork += (lambda * lambda - 1) * ke;
  }

  /** Accelerations and potential energy at the current positions. */
  private computeForces(dt = 0): void {
    const { n, x, y, ax, ay, mass, head, next, cellsX, cellsY, cellSize } = this;
    ax.fill(0);
    ay.fill(0);
    let pe = 0;

    // Cell list for the small atoms.
    head.fill(-1);
    for (const i of this.small) {
      const cx = Math.min(cellsX - 1, Math.max(0, Math.floor((x[i] - this.x0) / cellSize)));
      const cy = Math.min(cellsY - 1, Math.max(0, Math.floor((y[i] - this.y0) / cellSize)));
      const c = cy * cellsX + cx;
      next[i] = head[c];
      head[c] = i;
    }
    // Each cell with itself and four neighbours (a half shell), so every pair is seen once.
    const offsets = [
      [0, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];
    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        for (const [ox, oy] of offsets) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || nx >= cellsX || ny >= cellsY) continue;
          const same = ox === 0 && oy === 0;
          for (let i = head[cy * cellsX + cx]; i !== -1; i = next[i]) {
            for (let j = same ? next[i] : head[ny * cellsX + nx]; j !== -1; j = next[j]) pe += this.pair(i, j);
          }
        }
      }
    }
    // Large particles (Brownian grains) interact with everyone directly.
    for (const L of this.large) {
      for (let j = 0; j < n; j++) {
        if (j === L || (this.isLarge(j) && j < L)) continue;
        pe += this.pair(L, j);
      }
    }

    if (this.gravity !== 0) {
      for (let i = 0; i < n; i++) {
        ay[i] -= this.gravity;
        pe += mass[i] * this.gravity * (y[i] - this.y0);
      }
    }
    if (this.grab && dt > 0) {
      // Critically damped spring to the pointer, quick on the step's own timescale.
      const i = this.grab.particle;
      const w = 0.05 / dt;
      ax[i] += w * w * (this.grab.target.x - x[i]) - 2 * w * this.vx[i];
      ay[i] += w * w * (this.grab.target.y - y[i]) - 2 * w * this.vy[i];
    }
    this.potential = pe;
  }

  /** Adds the Lennard-Jones force between i and j; returns their (shifted) potential energy. */
  private pair(i: number, j: number): number {
    const dx = this.x[j] - this.x[i];
    const dy = this.y[j] - this.y[i];
    const r2 = dx * dx + dy * dy;
    const p = this.species[i] * this.kinds + this.species[j];
    if (r2 >= this.pairCut2[p] || r2 === 0) return 0;
    const sr2 = this.pairSigma2[p] / r2;
    const sr6 = sr2 * sr2 * sr2;
    const eps = this.pairEpsilon[p];
    // F·r̂/r = 24ε(2(σ/r)¹² − (σ/r)⁶)/r²; positive pushes apart.
    const f = (24 * eps * sr6 * (2 * sr6 - 1)) / r2;
    this.ax[i] -= (f * dx) / this.mass[i];
    this.ay[i] -= (f * dy) / this.mass[i];
    this.ax[j] += (f * dx) / this.mass[j];
    this.ay[j] += (f * dy) / this.mass[j];
    return 4 * eps * (sr6 * sr6 - sr6) - this.pairShift[p];
  }

  private isLarge(i: number): boolean {
    return this.large.includes(i);
  }

  // ── Measurements ────────────────────────────────────────────────────────

  /** 2D equipartition: KE = N·k·T (two degrees of freedom per atom). */
  temperature(indices?: readonly number[]): number {
    const list = indices ?? null;
    let ke = 0;
    let count = 0;
    const visit = (i: number) => {
      ke += 0.5 * this.mass[i] * (this.vx[i] ** 2 + this.vy[i] ** 2);
      count++;
    };
    if (list) list.forEach(visit);
    else for (let i = 0; i < this.n; i++) visit(i);
    return count > 0 ? ke / (count * BOLTZMANN) : 0;
  }

  /**
   * Ideal-gas pressure N·k·T/A for the current temperature, N/m. A is the
   * area open to the atoms' centres: a wall stops an atom one radius early.
   */
  idealPressure(): number {
    const d = 2 * (this.small.length > 0 ? this.radius[this.small[0]] : 0);
    return (this.n * BOLTZMANN * this.temperature()) / ((this.width - d) * (this.height - d));
  }

  /** Speeds of the small atoms. */
  speeds(): number[] {
    return this.small.map((i) => Math.hypot(this.vx[i], this.vy[i]));
  }

  /** Indices of small atoms of a species. */
  ofSpecies(s: number): number[] {
    return this.small.filter((i) => this.species[i] === s);
  }

  /**
   * Radial distribution function g(r) of the small atoms: how much more
   * likely a neighbour sits at distance r than in a uniform gas.
   */
  radialDistribution(rMax: number, bins: number): number[] {
    const counts = new Array<number>(bins).fill(0);
    const atoms = this.small;
    const dr = rMax / bins;
    for (let a = 0; a < atoms.length; a++) {
      for (let b = a + 1; b < atoms.length; b++) {
        const r = Math.hypot(this.x[atoms[b]] - this.x[atoms[a]], this.y[atoms[b]] - this.y[atoms[a]]);
        if (r < rMax) counts[Math.floor(r / dr)] += 2;
      }
    }
    const density = atoms.length / (this.width * this.height);
    return counts.map((c, k) => c / (atoms.length * density * 2 * Math.PI * (k + 0.5) * dr * dr));
  }

  isSmall(i: number): boolean {
    return !this.isLarge(i);
  }

  massOf(i: number): number {
    return this.mass[i];
  }

  radiusOf(i: number): number {
    return this.radius[i];
  }

  /** RMS speed for the current temperature, for colour scaling. */
  thermalSpeed(): number {
    const m = this.small.length > 0 ? this.mass[this.small[0]] : this.mass[0];
    return Math.sqrt((2 * BOLTZMANN * Math.max(this.temperature(), 1e-9)) / m);
  }

  // ── Simulation interface ────────────────────────────────────────────────

  reset(): void {
    this.x.set(this.initial[0]);
    this.y.set(this.initial[1]);
    this.vx.set(this.initial[2]);
    this.vy.set(this.initial[3]);
    this.t = 0;
    this.steps = 0;
    this.diverged = false;
    this.externalWork = 0;
    this.pressure = 0;
    this.grab = null;
    this.computeForces();
    this.forcesValid = true;
  }

  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += 0.5 * this.mass[i] * (this.vx[i] ** 2 + this.vy[i] ** 2);
    return e;
  }

  potentialEnergy(): number {
    if (!this.forcesValid) this.computeForces();
    return this.potential;
  }

  totalEnergy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  energyBalance(): number {
    return this.totalEnergy() - this.externalWork;
  }

  energyDrift(): number {
    const scale = Math.max(Math.abs(this.initialEnergy), Math.abs(this.externalWork), this.kineticEnergy()) || 1;
    return (this.energyBalance() - this.initialEnergy) / scale;
  }

  trailSources(): TrailSource[] {
    return this.trailIndices.map((i) => ({ color: this.speciesList[this.species[i]].color, x: () => this.x[i], y: () => this.y[i] }));
  }

  hitTest(point: Vec2, pixel: number): boolean {
    return this.nearest(point, pixel) !== null;
  }

  grabAt(point: Vec2, pixel: number): boolean {
    const i = this.nearest(point, pixel);
    if (i === null) return false;
    this.grab = { particle: i, target: point };
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab) this.grab.target = point;
  }

  release(): void {
    this.grab = null;
    this.forcesValid = false;
  }

  private nearest(point: Vec2, pixel: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = Math.hypot(this.x[i] - point.x, this.y[i] - point.y);
      if (d <= Math.max(this.radius[i], 3 * pixel) + 6 * pixel && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }
}

/** 2D Maxwell (Rayleigh) speed density: f(v) = (m v/kT)·exp(−m v²/2kT). */
export function maxwell2D(v: number, mass: number, temperature: number): number {
  const a = mass / (BOLTZMANN * temperature);
  return a * v * Math.exp((-a * v * v) / 2);
}

/** Positions on a jittered square grid filling a rectangle, for starting a gas without overlaps. */
export function gridPositions(count: number, min: Vec2, max: Vec2, jitter: number, random: () => number): Vec2[] {
  const w = max.x - min.x;
  const h = max.y - min.y;
  const cols = Math.ceil(Math.sqrt((count * w) / h));
  const rows = Math.ceil(count / cols);
  const dx = w / cols;
  const dy = h / rows;
  const out: Vec2[] = [];
  for (let k = 0; k < count; k++) {
    const c = k % cols;
    const r = Math.floor(k / cols);
    out.push(new Vec2(min.x + (c + 0.5 + jitter * (random() - 0.5)) * dx, min.y + (r + 0.5 + jitter * (random() - 0.5)) * dy));
  }
  return out;
}

/** Triangular (hexagonal) lattice patch with spacing a, centred on `center`. */
export function hexPositions(count: number, spacing: number, center: Vec2): Vec2[] {
  const cols = Math.ceil(Math.sqrt(count * 1.15));
  const out: Vec2[] = [];
  const rowHeight = (spacing * Math.sqrt(3)) / 2;
  const rows = Math.ceil(count / cols);
  for (let r = 0; out.length < count; r++) {
    for (let c = 0; c < cols && out.length < count; c++) {
      out.push(
        new Vec2(
          center.x + (c - (cols - 1) / 2 + (r % 2) * 0.5) * spacing,
          center.y + (r - (rows - 1) / 2) * rowHeight,
        ),
      );
    }
  }
  return out;
}

/**
 * Random positions in a rectangle, at least `spacing` apart (rejection
 * sampling), drawn from `sampleY` for the height if given.
 */
export function scatteredPositions(
  count: number,
  min: Vec2,
  max: Vec2,
  spacing: number,
  random: () => number,
  sampleY: () => number = () => min.y + random() * (max.y - min.y),
): Vec2[] {
  const out: Vec2[] = [];
  for (let attempts = 0; out.length < count && attempts < count * 2000; attempts++) {
    const p = new Vec2(min.x + random() * (max.x - min.x), Math.min(Math.max(sampleY(), min.y), max.y));
    if (out.every((q) => q.distanceTo(p) >= spacing)) out.push(p);
  }
  return out;
}

/** Seeded generator so every reset rebuilds the same gas. */
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Velocity of magnitude `speed` in a random direction. */
export function randomDirection(speed: number, random: () => number): Vec2 {
  return Vec2.fromAngle(2 * Math.PI * random(), speed);
}

/** A Maxwell-distributed 2D velocity at temperature T (Box–Muller). */
export function thermalVelocity(mass: number, temperature: number, random: () => number): Vec2 {
  const s = Math.sqrt((BOLTZMANN * temperature) / mass);
  const r = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-300)));
  const phi = 2 * Math.PI * random();
  return new Vec2(s * r * Math.cos(phi), s * r * Math.sin(phi));
}

/**
 * `count` Maxwell-distributed velocities with zero net momentum, rescaled so
 * their kinetic energy is exactly count·k·T. A few hundred raw samples land
 * several per cent off the requested temperature.
 */
export function thermalVelocities(count: number, mass: number, temperature: number, random: () => number): Vec2[] {
  const raw = Array.from({ length: count }, () => thermalVelocity(mass, temperature, random));
  if (count < 2) return raw;
  const mean = raw.reduce((sum, v) => sum.add(v), Vec2.ZERO).scale(1 / count);
  const centred = raw.map((v) => v.sub(mean));
  const ke = centred.reduce((sum, v) => sum + 0.5 * mass * v.lengthSq(), 0);
  const factor = ke > 0 ? Math.sqrt((count * BOLTZMANN * temperature) / ke) : 0;
  return centred.map((v) => v.scale(factor));
}
