import type { Simulation, TrailSource } from '../core/simulation';
import type { Vec2 } from '../core/vec2';

export interface RailOptions {
  /** Distance between the rails, which is the rod's working length L, m. */
  length: number;
  /** Rod mass, kg. */
  mass: number;
  /** Resistance of the circuit, Ω. */
  resistance: number;
  /** Magnetic field across the circuit (out of the screen), T. */
  field: number;
  /** Steady pull on the rod along the rails (a weight over a pulley), N. */
  pull?: number;
  /** Starting speed, m/s, and position along the rails, m. */
  speed?: number;
  position?: number;
  /** The rails run from the resistor at x = 0 to x = `end`, m. */
  end: number;
  label?: string;
  color?: string;
}

/**
 * A metal rod sliding on two rails joined by a resistor, in a magnetic
 * field: the textbook case of electromagnetic induction. As the rod moves,
 * the circuit's area and so the magnetic flux Φ = B·L·x change, inducing
 * the EMF ε = −dΦ/dt = B·L·v (Faraday). The current I = ε/R in turn feels
 * the force B·I·L against the motion (Lenz): m·dv/dt = F − B²L²v/R. That
 * equation is linear, so each step uses its exact exponential solution; the
 * Joule heat ∫I²R dt is integrated exactly too.
 */
export class RailWorld implements Simulation {
  readonly label: string;
  readonly color: string;
  readonly dissipative = true;
  readonly length: number;
  readonly mass: number;
  readonly resistance: number;
  readonly end: number;
  field: number;
  pull: number;

  x: number;
  v: number;
  t = 0;
  steps = 0;
  diverged = false;
  dissipated = 0;
  externalWork = 0;
  readonly initialEnergy: number;
  grab: { offset: number; target: number } | null = null;

  private readonly x0: number;
  private readonly v0: number;

  constructor(options: RailOptions) {
    this.length = options.length;
    this.mass = options.mass;
    this.resistance = options.resistance;
    this.field = options.field;
    this.pull = options.pull ?? 0;
    this.end = options.end;
    this.x = this.x0 = options.position ?? 0.2 * options.end;
    this.v = this.v0 = options.speed ?? 0;
    this.label = options.label ?? 'Стрижень';
    this.color = options.color ?? '#c98500';
    this.initialEnergy = this.totalEnergy();
  }

  /** Closest the rod gets to the resistor, m. */
  get start(): number {
    return 0.1 * this.length;
  }

  /** Braking time m·R/(B²L²), s (infinite without a field). */
  get timeConstant(): number {
    const k = (this.field * this.length) ** 2 / this.resistance;
    return k > 0 ? this.mass / k : Infinity;
  }

  /** Speed at which the pull and the magnetic braking balance, m/s. */
  get terminalSpeed(): number {
    const k = (this.field * this.length) ** 2 / this.resistance;
    return k > 0 ? this.pull / k : Infinity;
  }

  /** Induced EMF ε = B·L·v, V (positive drives the current counterclockwise round the circuit). */
  emf(): number {
    return this.field * this.length * this.v;
  }

  current(): number {
    return this.emf() / this.resistance;
  }

  /** Force of the field on the rod's current, N (always against the motion). */
  brakingForce(): number {
    return -this.field * this.current() * this.length;
  }

  /** Magnetic flux through the circuit, Wb. */
  flux(): number {
    return this.field * this.length * this.x;
  }

  step(dt: number): void {
    if (this.grab) {
      // The hand moves the rod; its work is what the rod gains plus the heat.
      const x = Math.min(Math.max(this.grab.target - this.grab.offset, this.start), this.end);
      const v = (x - this.x) / dt;
      const heat = ((this.field * this.length * v) ** 2 / this.resistance) * dt;
      // Hand and pull together supply the rod's new kinetic energy and the heat.
      this.externalWork += 0.5 * this.mass * (v * v - this.v * this.v) + heat;
      this.dissipated += heat;
      this.x = x;
      this.v = v;
    } else {
      const k = (this.field * this.length) ** 2 / this.resistance;
      const before = this.x;
      if (k === 0) {
        const a = this.pull / this.mass;
        this.x += this.v * dt + 0.5 * a * dt * dt;
        this.v += a * dt;
      } else {
        const tau = this.mass / k;
        const vt = this.pull / k;
        const a = this.v - vt;
        const decay = Math.exp(-dt / tau);
        this.x += vt * dt + a * tau * (1 - decay);
        this.v = vt + a * decay;
        // Joule heat: (B²L²/R)·∫v² dt over the step, exactly.
        this.dissipated += k * (vt * vt * dt + 2 * vt * a * tau * (1 - decay) + ((a * a * tau) / 2) * (1 - decay * decay));
      }
      this.externalWork += this.pull * (this.x - before);
      // The rod stops at the ends of the rails (an inelastic bump: the lost energy is heat).
      const stop = this.x < this.start ? this.start : this.x > this.end ? this.end : null;
      if (stop !== null) {
        this.dissipated += 0.5 * this.mass * this.v * this.v;
        this.externalWork += this.pull * (stop - this.x);
        this.x = stop;
        this.v = 0;
      }
    }
    this.t += dt;
    this.steps++;
  }

  reset(): void {
    this.x = this.x0;
    this.v = this.v0;
    this.t = 0;
    this.steps = 0;
    this.dissipated = 0;
    this.externalWork = 0;
    this.grab = null;
  }

  kineticEnergy(): number {
    return 0.5 * this.mass * this.v * this.v;
  }

  potentialEnergy(): number {
    return 0;
  }

  totalEnergy(): number {
    return this.kineticEnergy();
  }

  energyBalance(): number {
    return this.totalEnergy() + this.dissipated - this.externalWork;
  }

  energyDrift(): number {
    const scale = Math.max(Math.abs(this.initialEnergy), Math.abs(this.externalWork), this.dissipated) || 1;
    return (this.energyBalance() - this.initialEnergy) / scale;
  }

  trailSources(): TrailSource[] {
    return [];
  }

  hitTest(point: Vec2, pixel: number): boolean {
    return Math.abs(point.x - this.x) < 10 * pixel && Math.abs(point.y) < this.length / 2 + 10 * pixel;
  }

  grabAt(point: Vec2, pixel: number): boolean {
    if (!this.hitTest(point, pixel)) return false;
    this.grab = { offset: point.x - this.x, target: point.x };
    return true;
  }

  dragTo(point: Vec2): void {
    if (this.grab) this.grab.target = point.x;
  }

  release(): void {
    this.grab = null;
  }
}
