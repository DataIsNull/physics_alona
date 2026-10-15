import type { Force } from './forces';
import { type AccelFn, type Integrator, type IntegratorId, createIntegrator, integratorInfo } from './integrators';
import { type ParticleSpec, Particles } from './particles';
import { Vec2 } from './vec2';

export interface WorldOptions {
  particles: readonly ParticleSpec[];
  forces?: readonly Force[];
  integrator: IntegratorId;
  /** Shown in stats and graph legends. Defaults to the integrator name. */
  label?: string;
  color?: string;
}

/** A self-contained particle system advanced by one integrator. */
export class World {
  readonly particles: Particles;
  readonly forces: readonly Force[];
  readonly color: string;
  integrator: Integrator;
  t = 0;
  steps = 0;
  /** Set once the state stops being finite; the world then stops advancing. */
  diverged = false;
  readonly initialEnergy: number;

  private readonly customLabel: string | undefined;
  private readonly initialPos: Float64Array;
  private readonly initialVel: Float64Array;

  constructor(options: WorldOptions) {
    this.particles = new Particles(options.particles);
    this.forces = options.forces ?? [];
    this.integrator = createIntegrator(options.integrator);
    this.customLabel = options.label;
    this.color = options.color ?? '#e2e8f0';
    this.initialPos = this.particles.pos.slice();
    this.initialVel = this.particles.vel.slice();
    this.initialEnergy = this.totalEnergy();
  }

  get label(): string {
    return this.customLabel ?? integratorInfo(this.integrator.id).name;
  }

  /** Total acceleration from all forces at an arbitrary trial state. */
  readonly accel: AccelFn = (pos, vel, t, out) => {
    out.fill(0);
    for (const force of this.forces) force.apply(this.particles, pos, vel, t, out);
  };

  step(dt: number): void {
    if (this.diverged) return;
    this.integrator.step(this.particles.pos, this.particles.vel, this.t, dt, this.accel);
    this.t += dt;
    this.steps++;
    if (!allFinite(this.particles.pos) || !allFinite(this.particles.vel)) this.diverged = true;
  }

  reset(): void {
    this.particles.pos.set(this.initialPos);
    this.particles.vel.set(this.initialVel);
    this.t = 0;
    this.steps = 0;
    this.diverged = false;
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

  /** (E − E₀)/|E₀|; falls back to absolute drift in J when E₀ = 0. */
  energyDrift(): number {
    const e0 = this.initialEnergy;
    return (this.totalEnergy() - e0) / (Math.abs(e0) || 1);
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
}

function allFinite(values: Float64Array): boolean {
  for (let k = 0; k < values.length; k++) if (!Number.isFinite(values[k])) return false;
  return true;
}
