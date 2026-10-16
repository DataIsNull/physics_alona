import type { Simulation, TrailSource } from '../core/simulation';
import { Vec2 } from '../core/vec2';

export const EARTH_GRAVITY = 9.81;
/** Stiffness exponent of the Tait equation of state for water. */
const GAMMA = 7;
/** Courant number for the speed of sound. */
const CFL = 0.4;

/** A rigid box that floats, sinks and gets pushed around by the fluid. */
export interface BodyOptions {
  /** m */
  width: number;
  height: number;
  position: Vec2;
  angle?: number;
  /** kg/m³ */
  density: number;
  color: string;
  label?: string;
}

export interface SphOptions {
  /** Particle spacing dx, m. */
  spacing: number;
  /** Starting fluid particle positions, on a lattice of spacing dx. */
  fluid: Vec2[];
  /** Fixed wall particles, a few layers thick. */
  walls: Vec2[];
  bodies?: BodyOptions[];
  /** Rest density ρ₀, kg/m³. */
  density?: number;
  /** Physical kinematic viscosity ν, m²/s. */
  viscosity?: number;
  /** Monaghan's artificial viscosity α, which keeps a coarse fluid stable. */
  artificialViscosity?: number;
  /** Numerical speed of sound, m/s; by default ten times the fastest free-fall speed. */
  soundSpeed?: number;
  /** Downward gravity, m/s². */
  gravity?: number;
  /** The 2D slice stands for a tank this thick, m: masses, forces and energies are reported for it. */
  thickness?: number;
  /** Smoothing length h in units of dx. */
  smoothing?: number;
  /** What the particle colour shows. */
  colorBy?: 'speed' | 'pressure';
  /**
   * 'dynamic' (default): walls are squeezed by the water and push back, which
   * keeps the energy books exact. 'pressure': walls read their pressure off
   * the water every step (like bodies), so they keep no memory of past
   * impacts and narrow tubes level out exactly; the books are then only
   * approximate, and bodies can't touch such walls.
   */
  wallModel?: 'dynamic' | 'pressure';
  label?: string;
  color?: string;
}

/** A floating body's state; positions are of its centre, forces in newtons for the full thickness. */
export interface FloatingBody {
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly label: string;
  density: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  omega: number;
  /** Mass and moment of inertia per unit thickness. */
  mass: number;
  inertia: number;
  /** Force of the fluid alone (buoyancy and drag) per unit thickness, N/m. */
  fluidFx: number;
  fluidFy: number;
  /** All contact forces (fluid, walls, other bodies) and their torque, per unit thickness. */
  fx: number;
  fy: number;
  torque: number;
  /** The viscous part of fx, fy and torque, which turns motion into heat. */
  viscousFx: number;
  viscousFy: number;
  viscousTorque: number;
  /** Its particles: indices first … first + count − 1. */
  readonly first: number;
  readonly count: number;
}

type Grab =
  | { kind: 'body'; body: number; local: Vec2; target: Vec2 }
  | { kind: 'fluid'; particles: number[]; offsets: Vec2[]; target: Vec2 };

const enum Kind {
  Fluid = 0,
  Body = 1,
  Wall = 2,
}

/** Half of the neighbouring cells, so that each pair of cells is visited once. */
const HALF_SHELL = [
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Weakly compressible SPH (smoothed particle hydrodynamics). Water is a
 * crowd of particles; each carries a density that changes with the flow
 * around it (continuity equation), the pressure follows from the density
 * through Tait's stiff equation of state, and pressure and viscosity forces
 * act between neighbours within 2h (Wendland C2 kernel, cell list).
 * Walls are layers of particles that take part in the same equations
 * (dynamic boundary particles): water squeezes them and they push back.
 * Floating bodies are particle layers too, but read their pressure off the
 * surrounding water (see readPressureFromWater), so they feel buoyancy without a
 * separate model and float at the right depth. Störmer–Verlet sub-steps
 * within the app step keep to the acoustic CFL limit.
 *
 * Energy: kinetic + gravitational + elastic (from compressing the particles)
 * is conserved by the pressure forces; viscous losses are booked as heat.
 * Body pressure is read off the water rather than stored, so its small work
 * is left in the balance error.
 */
export class SphWorld implements Simulation {
  readonly label: string;
  readonly color: string;
  readonly dissipative = true;
  readonly spacing: number;
  readonly smoothing: number;
  readonly density: number;
  readonly gravity: number;
  readonly thickness: number;
  readonly soundSpeed: number;
  viscosity: number;
  readonly alpha: number;
  readonly colorBy: 'speed' | 'pressure';
  readonly wallMode: 'dynamic' | 'pressure';
  /** Scales for colouring: the speed of a fall from the top of the water, and the pressure at its deepest point. */
  readonly referenceSpeed: number;
  readonly referencePressure: number;

  /** Particle counts: fluid first, then body particles, then walls. */
  readonly nFluid: number;
  readonly nBody: number;
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly rho: Float64Array;
  readonly bodies: FloatingBody[];
  /** Height that gravitational energy is counted from (the lowest wall), m. */
  readonly floor: number;

  t = 0;
  steps = 0;
  diverged = false;
  dissipated = 0;
  externalWork = 0;
  readonly initialEnergy: number;
  grab: Grab | null = null;
  /** Sub-steps taken in the last app step. */
  lastSubsteps = 0;

  /** SPH mass of a particle per unit thickness (ρ₀·dx²), kg/m. */
  private readonly m: number;
  private readonly h: number;
  private readonly support2: number;
  private readonly gradFactor: number;
  private readonly eta2: number;
  private readonly stiffness: number;
  private readonly kind: Uint8Array;
  private readonly bodyOf: Int32Array;
  private readonly localX: Float64Array;
  private readonly localY: Float64Array;
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  /** The viscous part of the acceleration. */
  private readonly vax: Float64Array;
  private readonly vay: Float64Array;
  /** p/ρ² per particle, refreshed before each force pass. */
  private readonly pOverRho2: Float64Array;
  private forcesValid = false;

  // Neighbour pairs within 2h: indices, separation r⃗ᵢⱼ = r⃗ᵢ − r⃗ⱼ, r² and the kernel gradient factor.
  private pairI = new Int32Array(1024);
  private pairJ = new Int32Array(1024);
  private pairDx = new Float64Array(1024);
  private pairDy = new Float64Array(1024);
  private pairR2 = new Float64Array(1024);
  private pairF = new Float64Array(1024);
  private pairCount = 0;

  // Cell grid over the walls' bounding box (particles outside are clamped to the edge cells).
  private readonly gx0: number;
  private readonly gy0: number;
  private readonly cell: number;
  private readonly cellsX: number;
  private readonly cellsY: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private readonly wallHead: Int32Array;
  private readonly wallNext: Int32Array;

  private readonly initial: { arrays: Float64Array[]; bodies: FloatingBody[] };

  constructor(options: SphOptions) {
    const dx = (this.spacing = options.spacing);
    this.label = options.label ?? 'Вода';
    this.color = options.color ?? '#3987e5';
    this.density = options.density ?? 1000;
    this.gravity = options.gravity ?? EARTH_GRAVITY;
    this.thickness = options.thickness ?? 0.1;
    this.viscosity = options.viscosity ?? 1e-6;
    this.alpha = options.artificialViscosity ?? 0.02;
    this.smoothing = options.smoothing ?? 1.3;
    this.colorBy = options.colorBy ?? 'speed';
    this.wallMode = options.wallModel ?? 'dynamic';
    const h = (this.h = this.smoothing * dx);
    this.support2 = 4 * h * h;
    // Wendland C2 in 2D: W = 7/(4πh²)·(1 − q/2)⁴(2q + 1); ∇W = −5·7/(4πh⁴)·(1 − q/2)³·r⃗.
    this.gradFactor = (-5 * 7) / (4 * Math.PI * h ** 4);
    this.eta2 = 0.01 * h * h;
    this.m = this.density * dx * dx;

    // Bodies: carve their space out of the fluid and fill them with particles.
    const bodyOptions = options.bodies ?? [];
    const inside = (p: Vec2, b: BodyOptions, margin: number) => {
      const d = p.sub(b.position).rotate(-(b.angle ?? 0));
      return Math.abs(d.x) < b.width / 2 + margin && Math.abs(d.y) < b.height / 2 + margin;
    };
    const fluid = options.fluid.filter((p) => !bodyOptions.some((b) => inside(p, b, dx / 2)));
    const bodyLocal: Vec2[][] = bodyOptions.map((b) => {
      const cols = Math.max(1, Math.round(b.width / dx));
      const rows = Math.max(1, Math.round(b.height / dx));
      const pts: Vec2[] = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push(new Vec2((c + 0.5 - cols / 2) * dx, (r + 0.5 - rows / 2) * dx));
      return pts;
    });

    this.nFluid = fluid.length;
    this.nBody = bodyLocal.reduce((s, b) => s + b.length, 0);
    const n = (this.n = this.nFluid + this.nBody + options.walls.length);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.rho = new Float64Array(n).fill(this.density);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.vax = new Float64Array(n);
    this.vay = new Float64Array(n);
    this.pOverRho2 = new Float64Array(n);
    this.kind = new Uint8Array(n);
    this.bodyOf = new Int32Array(n).fill(-1);
    this.localX = new Float64Array(n);
    this.localY = new Float64Array(n);

    fluid.forEach((p, i) => {
      this.x[i] = p.x;
      this.y[i] = p.y;
    });
    this.bodies = [];
    let index = this.nFluid;
    bodyOptions.forEach((b, k) => {
      const w = Math.round(b.width / dx) * dx;
      const hgt = Math.round(b.height / dx) * dx;
      const mass = b.density * w * hgt;
      this.bodies.push({
        width: w,
        height: hgt,
        color: b.color,
        label: b.label ?? '',
        density: b.density,
        x: b.position.x,
        y: b.position.y,
        angle: b.angle ?? 0,
        vx: 0,
        vy: 0,
        omega: 0,
        mass,
        inertia: (mass * (w * w + hgt * hgt)) / 12,
        fluidFx: 0,
        fluidFy: 0,
        fx: 0,
        fy: 0,
        torque: 0,
        viscousFx: 0,
        viscousFy: 0,
        viscousTorque: 0,
        first: index,
        count: bodyLocal[k].length,
      });
      for (const p of bodyLocal[k]) {
        this.kind[index] = Kind.Body;
        this.bodyOf[index] = k;
        this.localX[index] = p.x;
        this.localY[index] = p.y;
        index++;
      }
    });
    this.placeBodyParticles();
    options.walls.forEach((p, k) => {
      const i = index + k;
      this.kind[i] = Kind.Wall;
      this.x[i] = p.x;
      this.y[i] = p.y;
    });

    let bottom = Infinity;
    for (let i = 0; i < n; i++) bottom = Math.min(bottom, this.y[i]);
    this.floor = bottom;
    let waterTop = -Infinity;
    let waterBottom = Infinity;
    for (let i = 0; i < this.nFluid; i++) {
      waterTop = Math.max(waterTop, this.y[i]);
      waterBottom = Math.min(waterBottom, this.y[i]);
    }
    const depth = Math.max(waterTop - waterBottom + dx, dx);
    this.referenceSpeed = Math.sqrt(2 * this.gravity * depth) || 1;
    this.referencePressure = this.density * this.gravity * depth || 1;
    // Sound speed ten times the speed of a fall through the water's depth keeps density changes near 1 %.
    this.soundSpeed = options.soundSpeed ?? Math.max(10 * this.referenceSpeed, 10);
    this.stiffness = (this.density * this.soundSpeed ** 2) / GAMMA;
    this.settleHydrostatically();

    // Cell grid sized to the support 2h over the walls' extent.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.x[i]);
      maxX = Math.max(maxX, this.x[i]);
      minY = Math.min(minY, this.y[i]);
      maxY = Math.max(maxY, this.y[i]);
    }
    this.cell = 2 * h;
    this.gx0 = minX - this.cell;
    this.gy0 = minY - this.cell;
    this.cellsX = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 2);
    this.cellsY = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 2);
    this.head = new Int32Array(this.cellsX * this.cellsY);
    this.next = new Int32Array(n);
    this.wallHead = new Int32Array(this.cellsX * this.cellsY).fill(-1);
    this.wallNext = new Int32Array(n).fill(-1);
    for (let i = this.nFluid + this.nBody; i < n; i++) {
      const c = this.cellOf(i);
      this.wallNext[i] = this.wallHead[c];
      this.wallHead[c] = i;
    }

    // Walls start with the pressure of the water touching them.
    this.findPairs();
    this.readPressureFromWater(Kind.Wall);

    this.initial = {
      arrays: [this.x.slice(), this.y.slice(), this.vx.slice(), this.vy.slice(), this.rho.slice()],
      bodies: this.bodies.map((b) => ({ ...b })),
    };
    this.computeForces();
    this.initialEnergy = this.totalEnergy();
  }

  /**
   * Starts the water already pressed down by its own weight: each particle's
   * density gives ρ₀·g·depth, measured from the top of its column. Otherwise
   * the water would first sag and bounce.
   */
  private settleHydrostatically(): void {
    const dx = this.spacing;
    const surface = new Map<number, number>();
    const column = (x: number) => Math.round(x / dx);
    for (let i = 0; i < this.nFluid; i++) {
      const c = column(this.x[i]);
      surface.set(c, Math.max(surface.get(c) ?? -Infinity, this.y[i] + dx / 2));
    }
    // Under a floating body the column's own top is the body's underside; the water there feels the open surface beside it.
    for (const b of this.bodies) {
      const reach = Math.hypot(b.width, b.height) / 2 + dx;
      const first = column(b.x - reach);
      const last = column(b.x + reach);
      const open = Math.max(surface.get(first - 1) ?? -Infinity, surface.get(last + 1) ?? -Infinity);
      for (let c = first; c <= last; c++) if (surface.has(c) || open > -Infinity) surface.set(c, Math.max(surface.get(c) ?? -Infinity, open));
    }
    const densityAt = (depth: number) => this.density * (1 + (this.density * this.gravity * depth) / this.stiffness) ** (1 / GAMMA);
    for (let i = 0; i < this.nFluid; i++) {
      const top = surface.get(column(this.x[i]))!;
      if (top > this.y[i]) this.rho[i] = densityAt(top - this.y[i]);
    }
  }

  private cellOf(i: number): number {
    const cx = Math.min(this.cellsX - 1, Math.max(0, Math.floor((this.x[i] - this.gx0) / this.cell)));
    const cy = Math.min(this.cellsY - 1, Math.max(0, Math.floor((this.y[i] - this.gy0) / this.cell)));
    return cy * this.cellsX + cx;
  }

  /** Puts body particles where their bodies are and gives them the rigid velocity v + ω × r. */
  private placeBodyParticles(): void {
    for (const b of this.bodies) {
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      for (let i = b.first; i < b.first + b.count; i++) {
        const rx = cos * this.localX[i] - sin * this.localY[i];
        const ry = sin * this.localX[i] + cos * this.localY[i];
        this.x[i] = b.x + rx;
        this.y[i] = b.y + ry;
        this.vx[i] = b.vx - b.omega * ry;
        this.vy[i] = b.vy + b.omega * rx;
      }
    }
  }

  // ── Equation of state ───────────────────────────────────────────────────

  /**
   * Tait: p = B((ρ/ρ₀)^γ − 1), cut at zero: like real water at these scales,
   * the fluid doesn't hold tension. Stretched SPH particles would otherwise
   * pull into chains and stripes (the tensile instability), and water would
   * stick to walls and bodies.
   */
  pressureOf(i: number): number {
    return Math.max(this.stiffness * ((this.rho[i] / this.density) ** GAMMA - 1), 0);
  }

  /** Elastic energy per unit mass stored by compression: e(ρ) = ∫ p/ρ² dρ from ρ₀. */
  private elasticEnergy(i: number): number {
    const r = this.rho[i];
    const r0 = this.density;
    // A body's pressure is read off the water, not stored in it.
    if (r < r0 || this.kind[i] === Kind.Body || (this.kind[i] === Kind.Wall && this.wallMode === 'pressure')) return 0;
    return this.stiffness * (((r / r0) ** (GAMMA - 1) / r0 - 1 / r0) / (GAMMA - 1) + 1 / r - 1 / r0);
  }

  // ── Dynamics ────────────────────────────────────────────────────────────

  /** Largest stable sub-step: acoustic CFL, force and viscous limits. */
  stableStep(): number {
    let v2 = 0;
    let a2 = 0;
    for (let i = 0; i < this.nFluid; i++) {
      v2 = Math.max(v2, this.vx[i] ** 2 + this.vy[i] ** 2);
      a2 = Math.max(a2, this.ax[i] ** 2 + this.ay[i] ** 2);
    }
    const h = this.h;
    const acoustic = (CFL * h) / (this.soundSpeed + Math.sqrt(v2));
    const force = a2 > 0 ? 0.25 * Math.sqrt(h / Math.sqrt(a2)) : Infinity;
    const viscous = this.viscosity > 0 ? (0.125 * h * h) / this.viscosity : Infinity;
    return Math.min(acoustic, force, viscous);
  }

  step(dt: number): void {
    if (this.diverged) return;
    if (!this.forcesValid) this.computeForces();
    const count = Math.max(1, Math.ceil(dt / this.stableStep() - 1e-9));
    const h = dt / count;
    const grabbed = this.grab !== null;
    const before = grabbed ? this.totalEnergy() + this.dissipated : 0;
    for (let k = 0; k < count; k++) this.advance(h);
    if (grabbed) this.externalWork += this.totalEnergy() + this.dissipated - before;
    this.lastSubsteps = count;
    this.steps++;
    if (!Number.isFinite(this.kineticEnergy())) this.diverged = true;
  }

  /**
   * One Störmer–Verlet sub-step. Densities belong with the positions: both
   * advance with the half-step velocities, the density rate taken half from
   * the old neighbour pairs and half from the new ones, so the step is time-
   * symmetric and the energy error stays bounded. Velocities are kicked by
   * the forces at the ends.
   */
  private advance(dt: number): void {
    const { x, y, vx, vy, nFluid } = this;
    this.kick(dt / 2);
    this.advanceDensity(dt / 2);
    for (let i = 0; i < nFluid; i++) {
      x[i] += dt * vx[i];
      y[i] += dt * vy[i];
    }
    for (const b of this.bodies) {
      b.x += dt * b.vx;
      b.y += dt * b.vy;
      b.angle += dt * b.omega;
    }
    this.placeBodyParticles();
    this.findPairs();
    this.advanceDensity(dt / 2);
    this.applyForces();
    this.kick(dt / 2);
    this.t += dt;
  }

  /**
   * Velocity kick. The heat is the work of the viscous impulse, booked
   * exactly as impulse × mean velocity over the kick, so only the
   * (bounded) error of the conservative forces is left in the balance.
   */
  private kick(dt: number): void {
    const { vx, vy, ax, ay, vax, vay, nFluid } = this;
    let work = 0;
    for (let i = 0; i < nFluid; i++) {
      const ux = vx[i] + dt * ax[i];
      const uy = vy[i] + dt * ay[i];
      work += 0.5 * dt * this.m * ((vx[i] + ux) * vax[i] + (vy[i] + uy) * vay[i]);
      vx[i] = ux;
      vy[i] = uy;
    }
    for (const b of this.bodies) {
      const ux = b.vx + (dt * b.fx) / b.mass;
      const uy = b.vy + dt * (b.fy / b.mass - this.gravity);
      const w = b.omega + (dt * b.torque) / b.inertia;
      work += 0.5 * dt * ((b.vx + ux) * b.viscousFx + (b.vy + uy) * b.viscousFy + (b.omega + w) * b.viscousTorque);
      b.vx = ux;
      b.vy = uy;
      b.omega = w;
    }
    this.dissipated -= work * this.thickness;
    if (this.bodies.length > 0) this.placeBodyParticles();
  }

  /** Continuity: dρᵢ/dt = Σ m·v⃗ᵢⱼ·∇ᵢWᵢⱼ over the stored neighbour pairs (the same for j), applied for dt. */
  private advanceDensity(dt: number): void {
    const { pairI, pairJ, pairF, pairDx, pairDy, vx, vy, rho, m } = this;
    for (let k = 0; k < this.pairCount; k++) {
      const i = pairI[k];
      const j = pairJ[k];
      const change = dt * m * pairF[k] * ((vx[i] - vx[j]) * pairDx[k] + (vy[i] - vy[j]) * pairDy[k]);
      rho[i] += change;
      rho[j] += change;
    }
  }

  /** Neighbour pairs within 2h at the current positions, through the cell list. */
  private findPairs(): void {
    const { x, y, kind, bodyOf, head, next, wallHead, wallNext, cellsX, cellsY, support2 } = this;
    const dynamic = this.nFluid + this.nBody;
    head.fill(-1);
    for (let i = 0; i < dynamic; i++) {
      const c = this.cellOf(i);
      next[i] = head[c];
      head[c] = i;
    }
    this.pairCount = 0;
    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const c = cy * cellsX + cx;
        if (head[c] === -1) continue;
        for (const [ox, oy] of HALF_SHELL) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || nx >= cellsX || ny >= cellsY) continue;
          const same = ox === 0 && oy === 0;
          for (let i = head[c]; i !== -1; i = next[i]) {
            const xi = x[i];
            const yi = y[i];
            for (let j = same ? next[i] : head[ny * cellsX + nx]; j !== -1; j = next[j]) {
              const dx = xi - x[j];
              const dy = yi - y[j];
              const r2 = dx * dx + dy * dy;
              if (r2 >= support2) continue;
              // Particles of one rigid body don't act on each other.
              if (kind[i] === Kind.Body && kind[j] === Kind.Body && bodyOf[i] === bodyOf[j]) continue;
              this.addPair(i, j, dx, dy, r2);
            }
          }
        }
        // Walls around this cell, seen from its moving particles.
        for (let oy = -1; oy <= 1; oy++) {
          const ny = cy + oy;
          if (ny < 0 || ny >= cellsY) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = cx + ox;
            if (nx < 0 || nx >= cellsX) continue;
            const w0 = wallHead[ny * cellsX + nx];
            if (w0 === -1) continue;
            for (let i = head[c]; i !== -1; i = next[i]) {
              const xi = x[i];
              const yi = y[i];
              for (let j = w0; j !== -1; j = wallNext[j]) {
                const dx = xi - x[j];
                const dy = yi - y[j];
                const r2 = dx * dx + dy * dy;
                if (r2 < support2) this.addPair(i, j, dx, dy, r2);
              }
            }
          }
        }
      }
    }
  }

  private addPair(i: number, j: number, dx: number, dy: number, r2: number): void {
    if (this.pairCount === this.pairI.length) this.growPairs();
    const k = this.pairCount++;
    const t = 1 - Math.sqrt(r2) / (2 * this.h);
    this.pairI[k] = i;
    this.pairJ[k] = j;
    this.pairDx[k] = dx;
    this.pairDy[k] = dy;
    this.pairR2[k] = r2;
    this.pairF[k] = this.gradFactor * t * t * t; // ∇ᵢWᵢⱼ = F·r⃗ᵢⱼ, F < 0
  }

  private growPairs(): void {
    const size = 2 * this.pairI.length;
    const grow = <T extends Int32Array | Float64Array>(a: T, make: (n: number) => T): T => {
      const b = make(size);
      b.set(a);
      return b;
    };
    this.pairI = grow(this.pairI, (k) => new Int32Array(k));
    this.pairJ = grow(this.pairJ, (k) => new Int32Array(k));
    this.pairDx = grow(this.pairDx, (k) => new Float64Array(k));
    this.pairDy = grow(this.pairDy, (k) => new Float64Array(k));
    this.pairR2 = grow(this.pairR2, (k) => new Float64Array(k));
    this.pairF = grow(this.pairF, (k) => new Float64Array(k));
  }

  /**
   * Gives boundary particles of one kind the pressure of the water around
   * them (Adami, Hu & Adams 2012): the kernel-weighted average of the
   * neighbours' pressure, plus ρ·g times how much deeper the boundary
   * particle sits. Particles with no water around get none. Needs the
   * neighbour pairs.
   */
  private readPressureFromWater(target: Kind): void {
    const { pairI, pairJ, pairR2, kind, rho, y, n } = this;
    const sum = new Float64Array(n);
    const weight = new Float64Array(n);
    const norm = 7 / (4 * Math.PI * this.h * this.h);
    for (let k = 0; k < this.pairCount; k++) {
      let b = pairI[k];
      let f = pairJ[k];
      if (kind[b] !== target) [b, f] = [f, b];
      if (kind[b] !== target || kind[f] !== Kind.Fluid) continue;
      const q = Math.sqrt(pairR2[k]) / this.h;
      const W = norm * (1 - q / 2) ** 4 * (2 * q + 1);
      sum[b] += W * (this.pressureOf(f) + rho[f] * this.gravity * (y[f] - y[b]));
      weight[b] += W;
    }
    for (let i = this.nFluid; i < n; i++) {
      if (kind[i] !== target) continue;
      const p = weight[i] > 0 ? Math.max(0, sum[i] / weight[i]) : 0;
      rho[i] = this.density * (1 + p / this.stiffness) ** (1 / GAMMA);
    }
  }

  /** Neighbour pairs, then forces, at the current state. */
  private computeForces(): void {
    this.findPairs();
    this.applyForces();
  }

  /**
   * Accelerations and viscous heating at the current positions, densities
   * and velocities. Pressure: aᵢ = −Σ m(pᵢ/ρᵢ² + pⱼ/ρⱼ² + Πᵢⱼ)∇ᵢWᵢⱼ, where Π is
   * Monaghan's artificial viscosity for approaching pairs; plus Morris's
   * laminar viscosity for the fluid's real ν.
   */
  private applyForces(): void {
    const { n, nFluid, rho, pOverRho2, ax, ay, vax, vay, vx, vy, kind, bodyOf, pairI, pairJ, pairF, pairDx, pairDy, pairR2, m } = this;
    // A body reads its pressure off the water every step, so it keeps no memory
    // of how hard it hit the water: no gap opens around it, and it floats at the right depth.
    if (this.nBody > 0) this.readPressureFromWater(Kind.Body);
    if (this.wallMode === 'pressure') this.readPressureFromWater(Kind.Wall);
    for (let i = 0; i < n; i++) pOverRho2[i] = this.pressureOf(i) / (rho[i] * rho[i]);
    ax.fill(0);
    ay.fill(0);
    vax.fill(0);
    vay.fill(0);
    for (const b of this.bodies) b.fluidFx = b.fluidFy = 0;
    const h = this.h;
    const eta2 = this.eta2;
    const alphaC = this.alpha * this.soundSpeed;
    const nu = this.viscosity;
    for (let k = 0; k < this.pairCount; k++) {
      const i = pairI[k];
      const j = pairJ[k];
      const F = pairF[k];
      const dx = pairDx[k];
      const dy = pairDy[k];
      const r2 = pairR2[k];
      const dvx = vx[i] - vx[j];
      const dvy = vy[i] - vy[j];
      const vr = dvx * dx + dvy * dy;
      const pressure = -m * (pOverRho2[i] + pOverRho2[j]) * F;
      const artificial = vr < 0 ? (2 * m * alphaC * h * vr * F) / ((r2 + eta2) * (rho[i] + rho[j])) : 0;
      const lam = nu > 0 ? (m * nu * (rho[i] + rho[j]) * F * r2) / (rho[i] * rho[j] * (r2 + eta2)) : 0;
      const vfx = artificial * dx + lam * dvx;
      const vfy = artificial * dy + lam * dvy;
      const fx = pressure * dx + vfx;
      const fy = pressure * dy + vfy;
      ax[i] += fx;
      ay[i] += fy;
      vax[i] += vfx;
      vay[i] += vfy;
      if (kind[j] !== Kind.Wall) {
        ax[j] -= fx;
        ay[j] -= fy;
        vax[j] -= vfx;
        vay[j] -= vfy;
      }
      // The fluid's share of the force on a body (buoyancy and drag).
      if (kind[i] === Kind.Body && kind[j] === Kind.Fluid) {
        const b = this.bodies[bodyOf[i]];
        b.fluidFx += m * fx;
        b.fluidFy += m * fy;
      } else if (kind[j] === Kind.Body && kind[i] === Kind.Fluid) {
        const b = this.bodies[bodyOf[j]];
        b.fluidFx -= m * fx;
        b.fluidFy -= m * fy;
      }
    }

    // Gravity on the fluid; bodies get theirs in the kick.
    for (let i = 0; i < nFluid; i++) ay[i] -= this.gravity;
    this.applyGrab();
    this.collectBodyForces();
    this.forcesValid = true;
  }

  /** Sums the particle forces of each body into a force and torque about its centre. */
  private collectBodyForces(): void {
    for (const b of this.bodies) {
      let fx = 0;
      let fy = 0;
      let torque = 0;
      let vfx = 0;
      let vfy = 0;
      let vtorque = 0;
      for (let i = b.first; i < b.first + b.count; i++) {
        const rx = this.x[i] - b.x;
        const ry = this.y[i] - b.y;
        const px = this.m * this.ax[i];
        const py = this.m * this.ay[i];
        fx += px;
        fy += py;
        torque += rx * py - ry * px;
        const qx = this.m * this.vax[i];
        const qy = this.m * this.vay[i];
        vfx += qx;
        vfy += qy;
        vtorque += rx * qy - ry * qx;
      }
      b.fx = fx;
      b.fy = fy;
      b.torque = torque;
      b.viscousFx = vfx;
      b.viscousFy = vfy;
      b.viscousTorque = vtorque;
    }
  }

  /** A critically damped spring towards the pointer: on a body at the grabbed point, or on a blob of water. */
  private applyGrab(): void {
    const g = this.grab;
    if (!g) return;
    const w = 12; // rad/s
    if (g.kind === 'fluid') {
      g.particles.forEach((i, k) => {
        this.ax[i] += w * w * (g.target.x + g.offsets[k].x - this.x[i]) - 2 * w * this.vx[i];
        this.ay[i] += w * w * (g.target.y + g.offsets[k].y - this.y[i]) - 2 * w * this.vy[i];
      });
      return;
    }
    const b = this.bodies[g.body];
    const r = g.local.rotate(b.angle);
    const px = b.x + r.x;
    const py = b.y + r.y;
    const vx = b.vx - b.omega * r.y;
    const vy = b.vy + b.omega * r.x;
    // Spread over the body's particles as an extra force, so collectBodyForces adds its torque.
    const fx = b.mass * (w * w * (g.target.x - px) - 2 * w * vx);
    const fy = b.mass * (w * w * (g.target.y - py) - 2 * w * vy);
    // Apply at the nearest body particle to the grabbed point.
    let best = b.first;
    let bestD = Infinity;
    for (let i = b.first; i < b.first + b.count; i++) {
      const d = (this.x[i] - px) ** 2 + (this.y[i] - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.ax[best] += fx / this.m;
    this.ay[best] += fy / this.m;
  }

  // ── Measurements ────────────────────────────────────────────────────────

  /** Smoothing length h, m. */
  get smoothingLength(): number {
    return this.h;
  }

  isFluid(i: number): boolean {
    return this.kind[i] === Kind.Fluid;
  }

  isWall(i: number): boolean {
    return this.kind[i] === Kind.Wall;
  }

  /**
   * Pressure at a point, Pa: the SPH average of nearby fluid particles,
   * Σ(m/ρ)·p·W / Σ(m/ρ)·W (Shepard-normalised so the edge of the water reads right).
   */
  pressureAt(point: Vec2): number {
    let num = 0;
    let den = 0;
    const h = this.h;
    const norm = 7 / (4 * Math.PI * h * h);
    for (let i = 0; i < this.nFluid; i++) {
      const r2 = (this.x[i] - point.x) ** 2 + (this.y[i] - point.y) ** 2;
      if (r2 >= this.support2) continue;
      const q = Math.sqrt(r2) / h;
      const W = norm * (1 - q / 2) ** 4 * (2 * q + 1);
      const v = (this.m / this.rho[i]) * W;
      num += v * this.pressureOf(i);
      den += v;
    }
    return den > 0 ? num / den : 0;
  }

  /** Number of fluid particles inside a rectangle. */
  countIn(x0: number, x1: number, y0: number, y1: number): number {
    let count = 0;
    for (let i = 0; i < this.nFluid; i++) if (this.x[i] >= x0 && this.x[i] < x1 && this.y[i] >= y0 && this.y[i] < y1) count++;
    return count;
  }

  /**
   * Height of the free surface over [x0, x1], m: the top fluid particle of
   * each dx-wide column (ignoring anything above `ceiling`, such as spray),
   * plus half a spacing, averaged over the columns that hold water.
   */
  surfaceIn(x0: number, x1: number, ceiling = Infinity): number {
    const dx = this.spacing;
    const columns = Math.max(1, Math.round((x1 - x0) / dx));
    const top = new Array<number>(columns).fill(-Infinity);
    for (let i = 0; i < this.nFluid; i++) {
      const c = Math.floor(((this.x[i] - x0) / (x1 - x0)) * columns);
      if (c >= 0 && c < columns && this.y[i] < ceiling) top[c] = Math.max(top[c], this.y[i]);
    }
    const wet = top.filter(Number.isFinite);
    return wet.length > 0 ? wet.reduce((a, b) => a + b, 0) / wet.length + dx / 2 : NaN;
  }

  /** Largest fluid speed, m/s. */
  maxSpeed(): number {
    let v2 = 0;
    for (let i = 0; i < this.nFluid; i++) v2 = Math.max(v2, this.vx[i] ** 2 + this.vy[i] ** 2);
    return Math.sqrt(v2);
  }

  /** A body's weight for the full thickness, N. */
  weight(b: FloatingBody): number {
    return b.mass * this.gravity * this.thickness;
  }

  /** The fluid's upward force on a body for the full thickness, N. */
  buoyancy(b: FloatingBody): number {
    return b.fluidFy * this.thickness;
  }

  /** Changes a body's density on the fly; the energy that takes is booked as outside work. */
  setBodyDensity(index: number, density: number): void {
    const b = this.bodies[index];
    const before = this.totalEnergy();
    const ratio = density / b.density;
    b.density = density;
    b.mass *= ratio;
    b.inertia *= ratio;
    this.externalWork += this.totalEnergy() - before;
  }

  // ── Simulation interface ────────────────────────────────────────────────

  reset(): void {
    const [x, y, vx, vy, rho] = this.initial.arrays;
    this.x.set(x);
    this.y.set(y);
    this.vx.set(vx);
    this.vy.set(vy);
    this.rho.set(rho);
    this.initial.bodies.forEach((b, k) => Object.assign(this.bodies[k], b));
    this.t = 0;
    this.steps = 0;
    this.diverged = false;
    this.dissipated = 0;
    this.externalWork = 0;
    this.grab = null;
    this.placeBodyParticles();
    this.computeForces();
  }

  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.nFluid; i++) e += 0.5 * this.m * (this.vx[i] ** 2 + this.vy[i] ** 2);
    for (const b of this.bodies) e += 0.5 * b.mass * (b.vx ** 2 + b.vy ** 2) + 0.5 * b.inertia * b.omega ** 2;
    return e * this.thickness;
  }

  /** Gravitational energy above the floor plus the elastic energy of compressed particles. */
  potentialEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.nFluid; i++) e += this.m * this.gravity * (this.y[i] - this.floor);
    for (const b of this.bodies) e += b.mass * this.gravity * (b.y - this.floor);
    for (let i = 0; i < this.n; i++) e += this.m * this.elasticEnergy(i);
    return e * this.thickness;
  }

  /** Elastic part of the potential energy alone, J. */
  elasticEnergyTotal(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += this.m * this.elasticEnergy(i);
    return e * this.thickness;
  }

  totalEnergy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  energyBalance(): number {
    return this.totalEnergy() + this.dissipated - this.externalWork;
  }

  energyDrift(): number {
    const scale = Math.max(Math.abs(this.initialEnergy), Math.abs(this.externalWork), this.dissipated) || 1;
    return (this.energyBalance() - this.initialEnergy) / scale;
  }

  trailSources(): TrailSource[] {
    return this.bodies.map((b) => ({ color: b.color, x: () => b.x, y: () => b.y }));
  }

  hitTest(point: Vec2, pixel: number): boolean {
    return this.bodyAt(point) !== null || this.fluidNear(point, pixel).length > 0;
  }

  grabAt(point: Vec2, pixel: number): boolean {
    const body = this.bodyAt(point);
    if (body !== null) {
      const b = this.bodies[body];
      this.grab = { kind: 'body', body, local: new Vec2(point.x - b.x, point.y - b.y).rotate(-b.angle), target: point };
      return true;
    }
    const particles = this.fluidNear(point, pixel);
    if (particles.length === 0) return false;
    this.grab = { kind: 'fluid', particles, offsets: particles.map((i) => new Vec2(this.x[i] - point.x, this.y[i] - point.y)), target: point };
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab) this.grab.target = point;
  }

  release(): void {
    this.grab = null;
    this.forcesValid = false;
  }

  private bodyAt(point: Vec2): number | null {
    for (let k = 0; k < this.bodies.length; k++) {
      const b = this.bodies[k];
      const d = new Vec2(point.x - b.x, point.y - b.y).rotate(-b.angle);
      if (Math.abs(d.x) <= b.width / 2 && Math.abs(d.y) <= b.height / 2) return k;
    }
    return null;
  }

  /** Fluid particles within a grab radius of the point. */
  private fluidNear(point: Vec2, pixel: number): number[] {
    const r = Math.max(3 * this.spacing, 20 * pixel);
    const out: number[] = [];
    for (let i = 0; i < this.nFluid; i++) if ((this.x[i] - point.x) ** 2 + (this.y[i] - point.y) ** 2 < r * r) out.push(i);
    return out;
  }
}

// ── Building tanks ────────────────────────────────────────────────────────

/** Points (i + ½)·dx of a square lattice over a rectangle where `inside` holds. */
export function fillLattice(min: Vec2, max: Vec2, dx: number, inside: (x: number, y: number) => boolean): Vec2[] {
  const out: Vec2[] = [];
  const cols = Math.round((max.x - min.x) / dx);
  const rows = Math.round((max.y - min.y) / dx);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = min.x + (c + 0.5) * dx;
      const y = min.y + (r + 0.5) * dx;
      if (inside(x, y)) out.push(new Vec2(x, y));
    }
  }
  return out;
}

/**
 * Wall particles: lattice points inside the solid that lie within `layers`
 * spacings of open space, so every wall is `layers` particles thick. Use the
 * same lattice origin as the fluid so that water starts one dx from the walls.
 */
export function wallLattice(min: Vec2, max: Vec2, dx: number, solid: (x: number, y: number) => boolean, layers = 3): Vec2[] {
  return fillLattice(min, max, dx, (x, y) => {
    if (!solid(x, y)) return false;
    for (let a = -layers; a <= layers; a++) for (let b = -layers; b <= layers; b++) if (!solid(x + a * dx, y + b * dx)) return true;
    return false;
  });
}
