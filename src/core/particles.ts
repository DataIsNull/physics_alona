import { Vec2 } from './vec2';

export interface ParticleSpec {
  pos: Vec2;
  vel?: Vec2;
  /** kg */
  mass?: number;
  /** m. Visual only until collisions arrive in stage 1. */
  radius?: number;
  color?: string;
}

/**
 * Particle storage in structure-of-arrays layout: particle i lives at
 * pos[2i], pos[2i + 1] (likewise for vel). Flat typed arrays keep the
 * integrators allocation-free and map directly onto GPU buffers later.
 */
export class Particles {
  readonly count: number;
  readonly pos: Float64Array;
  readonly vel: Float64Array;
  readonly mass: Float64Array;
  readonly radius: Float64Array;
  readonly color: string[] = [];

  constructor(specs: readonly ParticleSpec[]) {
    this.count = specs.length;
    this.pos = new Float64Array(2 * this.count);
    this.vel = new Float64Array(2 * this.count);
    this.mass = new Float64Array(this.count);
    this.radius = new Float64Array(this.count);

    specs.forEach((spec, i) => {
      const mass = spec.mass ?? 1;
      if (!(mass > 0)) throw new RangeError(`Particle ${i}: mass must be positive, got ${mass}`);
      this.pos[2 * i] = spec.pos.x;
      this.pos[2 * i + 1] = spec.pos.y;
      this.vel[2 * i] = spec.vel?.x ?? 0;
      this.vel[2 * i + 1] = spec.vel?.y ?? 0;
      this.mass[i] = mass;
      this.radius[i] = spec.radius ?? 0.1;
      this.color.push(spec.color ?? '#e2e8f0');
    });
  }

  position(i: number): Vec2 {
    return new Vec2(this.pos[2 * i], this.pos[2 * i + 1]);
  }

  velocity(i: number): Vec2 {
    return new Vec2(this.vel[2 * i], this.vel[2 * i + 1]);
  }
}
