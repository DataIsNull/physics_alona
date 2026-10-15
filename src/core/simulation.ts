import type { Vec2 } from './vec2';

/** A point that leaves a motion trail. */
export interface TrailSource {
  readonly color: string;
  x(): number;
  y(): number;
}

/**
 * What the app needs from any simulated system, whatever it is made of
 * (particles, rigid bodies, later fields): stepping, energy books, trails
 * and pointer interaction.
 */
export interface Simulation {
  readonly label: string;
  readonly color: string;
  /** True when losses to heat are tracked in `dissipated`. */
  readonly dissipative: boolean;
  readonly t: number;
  readonly steps: number;
  /** Set once the state stops being finite; the system then stops advancing. */
  readonly diverged: boolean;
  /** Energy turned into heat so far, J. */
  readonly dissipated: number;
  /** Work done on the system from outside (pointer drags, motors), J. */
  readonly externalWork: number;
  readonly initialEnergy: number;

  step(dt: number): void;
  reset(): void;

  kineticEnergy(): number;
  potentialEnergy(): number;
  totalEnergy(): number;
  /** E + dissipated − externalWork: constant for exact physics, J. */
  energyBalance(): number;
  /** (energyBalance − E₀)/|E₀|. */
  energyDrift(): number;

  trailSources(): TrailSource[];

  /** Whether a press at `point` would grab something; `pixel` is metres per screen pixel. */
  hitTest(point: Vec2, pixel: number): boolean;
  /** Starts dragging whatever lies under `point`; false if nothing does. */
  grabAt(point: Vec2, pixel: number): boolean;
  dragTo(point: Vec2): void;
  release(): void;
}
