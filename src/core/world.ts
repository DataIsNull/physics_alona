import type { Collisions } from './collisions';
import { ConstraintSolver, type DistanceConstraint } from './constraints';
import type { Force } from './forces';
import { type AccelFn, type Integrator, type IntegratorId, createIntegrator, integratorInfo } from './integrators';
import { type ParticleSpec, Particles } from './particles';
import { Vec2 } from './vec2';

export interface WorldOptions {
  particles: readonly ParticleSpec[];
  forces?: readonly Force[];
  constraints?: readonly DistanceConstraint[];
  /** Gauss–Seidel passes per step; more = stiffer rods. */
  constraintIterations?: number;
  /**
   * Count energy removed when rods snap taut as heat (nets, chains: a jerk on
   * an inextensible rod is an inelastic collision). Leave off for pendulums,
   * where it would hide integration error.
   */
  constraintLosses?: boolean;
  collisions?: Collisions;
  integrator: IntegratorId;
  /** Shown in stats and graph legends. Defaults to the integrator name. */
  label?: string;
  color?: string;
}

/** A particle pulled towards a point by the user's pointer. */
export interface Grab {
  particle: number;
  target: Vec2;
}

/** Natural frequency of the critically damped spring that drags grabbed particles, rad/s. */
const GRAB_OMEGA = 2 * Math.PI * 3;

/**
 * A self-contained particle system. One step runs the pipeline:
 * forces → integrator → constraints → collisions.
 */
export class World {
  readonly particles: Particles;
  readonly forces: readonly Force[];
  readonly constraints: readonly DistanceConstraint[];
  readonly collisions: Collisions | null;
  readonly color: string;
  /** True when energy can leave the system (drag, friction, inelastic collisions). */
  readonly dissipative: boolean;
  integrator: Integrator;
  readonly constraintSolver: ConstraintSolver;
  private readonly constraintLosses: boolean;
  grab: Grab | null = null;
  t = 0;
  steps = 0;
  /** Energy turned into heat so far, J. */
  dissipated = 0;
  /** Work done on the system by the user's pointer, J. E + dissipated − externalWork stays ≈ E₀. */
  externalWork = 0;
  /** Set once the state stops being finite; the world then stops advancing. */
  diverged = false;
  readonly initialEnergy: number;

  private readonly customLabel: string | undefined;
  private readonly initialPos: Float64Array;
  private readonly initialVel: Float64Array;
  private readonly fixedIndices: number[] = [];
  private readonly dissipativeForces: Force[];

  constructor(options: WorldOptions) {
    this.particles = new Particles(options.particles);
    this.forces = options.forces ?? [];
    this.constraints = options.constraints ?? [];
    this.constraintSolver = new ConstraintSolver(options.constraintIterations);
    this.constraintLosses = options.constraintLosses ?? false;
    this.collisions = options.collisions ?? null;
    this.integrator = createIntegrator(options.integrator);
    this.customLabel = options.label;
    this.color = options.color ?? '#e2e8f0';
    for (let i = 0; i < this.particles.count; i++) if (this.particles.isFixed(i)) this.fixedIndices.push(i);
    this.dissipativeForces = this.forces.filter((f) => f.power);
    this.dissipative = this.dissipativeForces.length > 0 || this.collisions !== null || this.constraintLosses;
    this.initialPos = this.particles.pos.slice();
    this.initialVel = this.particles.vel.slice();
    this.initialEnergy = this.totalEnergy();
  }

  get label(): string {
    return this.customLabel ?? integratorInfo(this.integrator.id).name;
  }

  /** Total acceleration at an arbitrary trial state. Fixed particles get none. */
  readonly accel: AccelFn = (pos, vel, t, out) => {
    out.fill(0);
    for (const force of this.forces) force.apply(this.particles, pos, vel, t, out);
    const grab = this.grab;
    if (grab) {
      const i = grab.particle;
      out[2 * i] += GRAB_OMEGA ** 2 * (grab.target.x - pos[2 * i]) - 2 * GRAB_OMEGA * vel[2 * i];
      out[2 * i + 1] += GRAB_OMEGA ** 2 * (grab.target.y - pos[2 * i + 1]) - 2 * GRAB_OMEGA * vel[2 * i + 1];
    }
    for (const i of this.fixedIndices) {
      out[2 * i] = 0;
      out[2 * i + 1] = 0;
    }
  };

  step(dt: number): void {
    if (this.diverged) return;
    const { pos, vel } = this.particles;

    // While the user drags, energy they put in is booked as external work,
    // so impulsive losses (collisions, rod jerks) are not tracked separately.
    const grab = this.grab;
    const balanceBefore = grab ? this.totalEnergy() + this.dissipated : 0;
    if (grab && this.particles.isFixed(grab.particle)) {
      // A grabbed fixed particle (pivot, pin) glides towards the pointer rather than teleporting.
      const k = Math.min(1, GRAB_OMEGA * dt);
      const i = grab.particle;
      this.moveFixed(i, new Vec2(pos[2 * i] + (grab.target.x - pos[2 * i]) * k, pos[2 * i + 1] + (grab.target.y - pos[2 * i + 1]) * k));
    }

    const powerBefore = this.dissipativePower();
    const constrained = this.constraints.length > 0;
    if (constrained) this.constraintSolver.begin(pos);
    this.integrator.step(pos, vel, this.t, dt, this.accel);
    if (constrained) {
      const track = this.constraintLosses && !grab;
      const before = track ? this.totalEnergy() : 0;
      this.constraintSolver.solve(this.particles, this.constraints, dt);
      if (track) this.dissipated += before - this.totalEnergy();
    }
    if (this.collisions) {
      const before = grab ? 0 : this.totalEnergy();
      this.collisions.resolve(this.particles);
      if (!grab) this.dissipated += before - this.totalEnergy();
    }
    if (this.dissipativeForces.length > 0) {
      // Trapezoidal rule on the dissipated power.
      this.dissipated -= 0.5 * (powerBefore + this.dissipativePower()) * dt;
    }
    if (grab) this.externalWork += this.totalEnergy() + this.dissipated - balanceBefore;

    this.t += dt;
    this.steps++;
    if (!allFinite(pos) || !allFinite(vel)) this.diverged = true;
  }

  /** Teleports a fixed particle; used for dragging pivots and anchors. */
  moveFixed(i: number, to: Vec2): void {
    this.particles.pos[2 * i] = to.x;
    this.particles.pos[2 * i + 1] = to.y;
  }

  reset(): void {
    this.particles.pos.set(this.initialPos);
    this.particles.vel.set(this.initialVel);
    this.t = 0;
    this.steps = 0;
    this.dissipated = 0;
    this.externalWork = 0;
    this.diverged = false;
    this.grab = null;
  }

  setIntegrator(id: IntegratorId): void {
    this.integrator = createIntegrator(id);
  }

  kineticEnergy(): number {
    const { count, mass, vel } = this.particles;
    let e = 0;
    for (let i = 0; i < count; i++) {
      const vx = vel[2 * i];
      const vy = vel[2 * i + 1];
      e += 0.5 * mass[i] * (vx * vx + vy * vy);
    }
    return e;
  }

  potentialEnergy(): number {
    let u = 0;
    for (const force of this.forces) u += force.potential?.(this.particles, this.particles.pos) ?? 0;
    return u;
  }

  totalEnergy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  /** E + losses − work done by the user: constant for exact physics, J. */
  energyBalance(): number {
    return this.totalEnergy() + this.dissipated - this.externalWork;
  }

  /**
   * Energy balance error (E + dissipated − externalWork − E₀)/|E₀|: zero for
   * exact physics. Falls back to absolute error in J when E₀ = 0.
   */
  energyDrift(): number {
    const e0 = this.initialEnergy;
    return (this.energyBalance() - e0) / (Math.abs(e0) || 1);
  }

  momentum(): Vec2 {
    const { count, mass, vel } = this.particles;
    let px = 0;
    let py = 0;
    for (let i = 0; i < count; i++) {
      px += mass[i] * vel[2 * i];
      py += mass[i] * vel[2 * i + 1];
    }
    return new Vec2(px, py);
  }

  private dissipativePower(): number {
    let p = 0;
    for (const force of this.dissipativeForces) p += force.power!(this.particles, this.particles.pos, this.particles.vel);
    return p;
  }
}

function allFinite(values: Float64Array): boolean {
  for (let k = 0; k < values.length; k++) if (!Number.isFinite(values[k])) return false;
  return true;
}
