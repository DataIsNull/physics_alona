import type { Simulation, TrailSource } from '../core/simulation';
import { SPEED_OF_LIGHT, VACUUM_PERMEABILITY, VACUUM_PERMITTIVITY } from '../core/units';
import { Vec2 } from '../core/vec2';

/** Impedance of free space √(μ₀/ε₀), Ω. */
const ETA0 = Math.sqrt(VACUUM_PERMEABILITY / VACUUM_PERMITTIVITY);

export interface LightSource {
  /** 'point': an oscillating current at one spot (a tiny antenna); 'line': a vertical sheet at x that launches plane waves. */
  kind: 'point' | 'line';
  /** Position of a point source; for a line only x matters. */
  position: Vec2;
  /** Vacuum wavelength, m. */
  wavelength: number;
  /** Amplitude of the wave a line source launches, V/m (a point source uses the same current density). */
  amplitude: number;
  /** A short pulse with this Gaussian half-width, s, centred at `delay`; a steady wave when absent. */
  pulse?: { width: number; delay: number };
}

export interface MaxwellOptions {
  /** Cells across and up; each cell is `spacing` wide, m. */
  nx: number;
  ny: number;
  spacing: number;
  center?: Vec2;
  /** Relative permittivity at a point (glass ≈ 2.25, so n = √εr = 1.5). */
  permittivity?: (x: number, y: number) => number;
  /** Metal (a perfect conductor). */
  conductor?: (x: number, y: number) => boolean;
  /** 'absorbing': a matched lossy layer on every edge. 'periodic': top and bottom wrap round (an endless plane wave); left and right absorb. */
  edges?: 'absorbing' | 'periodic';
  /** Absorbing layer thickness, m. */
  sponge?: number;
  sources?: LightSource[];
  probes?: Vec2[];
  label?: string;
  color?: string;
}

/**
 * Maxwell's equations on a Yee grid (FDTD), the transverse-magnetic case:
 * the electric field Ez points out of the screen and the magnetic field
 * (Hx, Hy) lies in it. Faraday's law ∂B/∂t = −∇×E and the Ampère–Maxwell
 * law ∂D/∂t = ∇×H − J are leapfrogged on grids offset by half a cell and
 * half a step, which is what makes the scheme exact for the curl structure
 * (∇·B stays zero). Light then appears by itself: a changing E makes a
 * changing B and back, travelling at c = 1/√(ε₀μ₀). Dielectrics slow it to
 * c/n; metal reflects it; a graded lossy layer on the edges, with electric
 * and magnetic losses matched (σ/ε = σₘ/μ), soaks it up.
 */
export class MaxwellWorld implements Simulation {
  readonly label: string;
  readonly color: string;
  readonly dissipative = false;
  readonly dissipated = 0;
  readonly externalWork = 0;
  readonly initialEnergy = 0;
  readonly nx: number;
  readonly ny: number;
  readonly spacing: number;
  readonly x0: number;
  readonly y0: number;
  /** Fixed time step: 0.9 of the 2D Courant limit dx/(c√2). */
  readonly dt: number;
  readonly periodic: boolean;
  readonly ez: Float64Array;
  readonly hx: Float64Array;
  readonly hy: Float64Array;
  /** Relative permittivity per cell (for drawing the materials). */
  readonly epsilon: Float64Array;
  readonly metal: Uint8Array;
  readonly sources: LightSource[];
  readonly probes: Vec2[];

  t = 0;
  steps = 0;
  diverged = false;
  grab: { target: Vec2 } | null = null;

  private readonly ca: Float64Array;
  private readonly cb: Float64Array;
  private readonly da: Float64Array;
  private readonly db: Float64Array;
  private pending = 0;

  constructor(options: MaxwellOptions) {
    const { nx, ny, spacing: dx } = options;
    this.nx = nx;
    this.ny = ny;
    this.spacing = dx;
    this.label = options.label ?? 'Світло';
    this.color = options.color ?? '#3987e5';
    const center = options.center ?? Vec2.ZERO;
    this.x0 = center.x - (nx * dx) / 2;
    this.y0 = center.y - (ny * dx) / 2;
    this.dt = (0.9 * dx) / (SPEED_OF_LIGHT * Math.SQRT2);
    this.periodic = options.edges === 'periodic';
    this.sources = options.sources ?? [];
    this.probes = options.probes ?? [];
    const size = nx * ny;
    this.ez = new Float64Array(size);
    this.hx = new Float64Array(size);
    this.hy = new Float64Array(size);
    this.epsilon = new Float64Array(size);
    this.metal = new Uint8Array(size);
    this.ca = new Float64Array(size);
    this.cb = new Float64Array(size);
    this.da = new Float64Array(size);
    this.db = new Float64Array(size);

    // Graded losses near the absorbing edges: σ(d) = σmax·(d/L)³, with σmax for ~10⁻⁴ reflection.
    const L = options.sponge ?? 12 * dx;
    const sigmaMax = (-4 * Math.log(1e-4)) / (2 * ETA0 * L);
    const dt = this.dt;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = this.cellX(i);
        const y = this.cellY(j);
        const er = options.permittivity?.(x, y) ?? 1;
        const eps = VACUUM_PERMITTIVITY * er;
        this.epsilon[k] = er;
        if (options.conductor?.(x, y)) this.metal[k] = 1;
        const depthX = Math.max(L - (i + 0.5) * dx, L - (nx - i - 0.5) * dx, 0);
        const depthY = this.periodic ? 0 : Math.max(L - (j + 0.5) * dx, L - (ny - j - 0.5) * dx, 0);
        const sigma = sigmaMax * (Math.max(depthX, depthY) / L) ** 3;
        // Electric loss σ and the matched magnetic loss σₘ = σ·μ₀/ε, so the layer has the medium's impedance.
        const e = (sigma * dt) / (2 * eps);
        this.ca[k] = (1 - e) / (1 + e);
        this.cb[k] = dt / eps / (1 + e);
        const sigmaM = (sigma * VACUUM_PERMEABILITY) / eps;
        const m = (sigmaM * dt) / (2 * VACUUM_PERMEABILITY);
        this.da[k] = (1 - m) / (1 + m);
        this.db[k] = dt / VACUUM_PERMEABILITY / (1 + m);
      }
    }
  }

  cellX(i: number): number {
    return this.x0 + (i + 0.5) * this.spacing;
  }

  cellY(j: number): number {
    return this.y0 + (j + 0.5) * this.spacing;
  }

  // ── Dynamics ────────────────────────────────────────────────────────────

  /** Runs as many grid steps as fit in the app step (the grid step is fixed by the Courant limit). */
  step(dt: number): void {
    if (this.diverged) return;
    this.pending += dt;
    const count = Math.floor(this.pending / this.dt + 1e-9);
    this.pending -= count * this.dt;
    for (let k = 0; k < count; k++) this.advance();
    this.steps++;
    if (!Number.isFinite(this.ez[(this.ny >> 1) * this.nx + (this.nx >> 1)])) this.diverged = true;
  }

  /** One leapfrog step: H from the curl of E, then E from the curl of H minus the source current. */
  private advance(): void {
    const { nx, ny, ez, hx, hy, ca, cb, da, db, metal, periodic } = this;
    const inv = 1 / this.spacing;
    // Faraday: μ ∂H/∂t = −∇×E. Hx sits half a cell above Ez, Hy half a cell to the right.
    for (let j = 0; j < ny; j++) {
      const up = j < ny - 1 ? nx : periodic ? -(ny - 1) * nx : 0;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (up !== 0) hx[k] = da[k] * hx[k] - db[k] * (ez[k + up] - ez[k]) * inv;
        if (i < nx - 1) hy[k] = da[k] * hy[k] + db[k] * (ez[k + 1] - ez[k]) * inv;
      }
    }
    // Ampère–Maxwell: ε ∂E/∂t = ∇×H − J.
    for (let j = 0; j < ny; j++) {
      const down = j > 0 ? -nx : periodic ? (ny - 1) * nx : 0;
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (metal[k] || (down === 0 && !periodic) || (!periodic && j === ny - 1)) {
          ez[k] = 0;
          continue;
        }
        const curl = (hy[k] - hy[k - 1] - hx[k] + hx[k + down]) * inv;
        ez[k] = ca[k] * ez[k] + cb[k] * curl;
      }
    }
    this.t += this.dt;
    this.inject();
  }

  /** Soft sources: a current density J added to the E update at the source cells. */
  private inject(): void {
    for (const s of this.sources) {
      const omega = (2 * Math.PI * SPEED_OF_LIGHT) / s.wavelength;
      const envelope = s.pulse
        ? Math.exp(-(((this.t - s.pulse.delay) / s.pulse.width) ** 2))
        : Math.min(1, this.t / (3 * (s.wavelength / SPEED_OF_LIGHT))) ** 2;
      // A current sheet K launches E = η₀K/2 each way; one cell thick, J = K/dx.
      const J = ((2 * s.amplitude) / (ETA0 * this.spacing)) * envelope * Math.sin(omega * this.t);
      const i = Math.round((s.position.x - this.x0) / this.spacing - 0.5);
      if (i < 1 || i >= this.nx - 1) continue;
      if (s.kind === 'line') {
        for (let j = 0; j < this.ny; j++) {
          const k = j * this.nx + i;
          if (!this.metal[k]) this.ez[k] -= this.cb[k] * J;
        }
      } else {
        const j = Math.round((s.position.y - this.y0) / this.spacing - 0.5);
        if (j < 1 || j >= this.ny - 1) continue;
        const k = j * this.nx + i;
        this.ez[k] -= this.cb[k] * J;
      }
    }
  }

  // ── Measurements ────────────────────────────────────────────────────────

  /** Ez at the cell containing a point, V/m. */
  fieldAt(point: Vec2): number {
    const i = Math.round((point.x - this.x0) / this.spacing - 0.5);
    const j = Math.round((point.y - this.y0) / this.spacing - 0.5);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return 0;
    return this.ez[j * this.nx + i];
  }

  /** Readings of the probes, V/m. */
  probeValues(): number[] {
    return this.probes.map((p) => this.fieldAt(p));
  }

  /** Strongest |Ez| anywhere, V/m. */
  peak(): number {
    let m = 0;
    for (const v of this.ez) m = Math.max(m, Math.abs(v));
    return m;
  }

  // ── Simulation interface ────────────────────────────────────────────────

  reset(): void {
    this.ez.fill(0);
    this.hx.fill(0);
    this.hy.fill(0);
    this.t = 0;
    this.steps = 0;
    this.pending = 0;
    this.diverged = false;
  }

  /** Electromagnetic energy per metre of depth, ½Σ(εE² + μH²)·dx², J/m. */
  kineticEnergy(): number {
    let e = 0;
    for (let k = 0; k < this.ez.length; k++) {
      e += VACUUM_PERMITTIVITY * this.epsilon[k] * this.ez[k] ** 2 + VACUUM_PERMEABILITY * (this.hx[k] ** 2 + this.hy[k] ** 2);
    }
    return 0.5 * e * this.spacing ** 2;
  }

  potentialEnergy(): number {
    return 0;
  }

  totalEnergy(): number {
    return this.kineticEnergy();
  }

  /** Sources pump energy in and the edges soak it up: there are no closed books to keep. */
  energyBalance(): number {
    return NaN;
  }

  energyDrift(): number {
    return NaN;
  }

  trailSources(): TrailSource[] {
    return [];
  }

  /** The pointer moves the point sources. */
  hitTest(point: Vec2, pixel: number): boolean {
    return this.sourceNear(point, pixel) !== null;
  }

  grabAt(point: Vec2, pixel: number): boolean {
    const s = this.sourceNear(point, pixel);
    if (s === null) return false;
    this.grab = { target: point };
    this.grabbed = s;
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab && this.grabbed) this.grabbed.position = point;
  }

  release(): void {
    this.grab = null;
    this.grabbed = null;
  }

  private grabbed: LightSource | null = null;

  private sourceNear(point: Vec2, pixel: number): LightSource | null {
    for (const s of this.sources) {
      if (s.kind === 'point' && Math.hypot(s.position.x - point.x, s.position.y - point.y) < 12 * pixel) return s;
    }
    return null;
  }
}
