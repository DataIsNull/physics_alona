import { Vec2 } from './vec2';

export interface ParticleSpec {
  pos: Vec2;
  vel?: Vec2;
  /** kg */
  mass?: number;
  /** m. Used for collisions and air drag; 0 is a point particle. */
  radius?: number;
  /** Fixed particles never move on their own: pivots, anchors, pegs. */
  fixed?: boolean;
  /** Coefficient of restitution, 0 (perfectly plastic) … 1 (perfectly elastic). */
  restitution?: number;
  /** Coulomb friction coefficient used in collisions. */
  friction?: number;
  color?: string;
  /** Record a motion trail. Defaults to true for movable particles. */
  trail?: boolean;
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
  /** 1/m, or 0 for fixed particles (infinite mass). */
  readonly invMass: Float64Array;
  readonly radius: Float64Array;
  readonly restitution: Float64Array;
  readonly friction: Float64Array;
  readonly color: string[] = [];
  readonly trail: boolean[] = [];

  constructor(specs: readonly ParticleSpec[]) {
    const n = specs.length;
    this.count = n;
    this.pos = new Float64Array(2 * n);
    this.vel = new Float64Array(2 * n);
    this.mass = new Float64Array(n);
    this.invMass = new Float64Array(n);
    this.radius = new Float64Array(n);
    this.restitution = new Float64Array(n);
    this.friction = new Float64Array(n);

    specs.forEach((spec, i) => {
      const mass = spec.mass ?? 1;
      if (!(mass > 0)) throw new RangeError(`Particle ${i}: mass must be positive, got ${mass}`);
      this.pos[2 * i] = spec.pos.x;
      this.pos[2 * i + 1] = spec.pos.y;
      if (!spec.fixed) {
        this.vel[2 * i] = spec.vel?.x ?? 0;
        this.vel[2 * i + 1] = spec.vel?.y ?? 0;
      }
      this.mass[i] = mass;
      this.invMass[i] = spec.fixed ? 0 : 1 / mass;
      this.radius[i] = spec.radius ?? 0.1;
      this.restitution[i] = spec.restitution ?? 1;
      this.friction[i] = spec.friction ?? 0;
      this.color.push(spec.color ?? '#e2e8f0');
      this.trail.push(spec.trail ?? !spec.fixed);
    });
  }

  isFixed(i: number): boolean {
    return this.invMass[i] === 0;
  }

  position(i: number): Vec2 {
    return new Vec2(this.pos[2 * i], this.pos[2 * i + 1]);
  }

  velocity(i: number): Vec2 {
    return new Vec2(this.vel[2 * i], this.vel[2 * i + 1]);
  }
}
