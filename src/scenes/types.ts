import type { IntegratorId } from '../core/integrators';
import type { Simulation } from '../core/simulation';
import type { Vec2 } from '../core/vec2';
import type { LengthUnit } from '../core/units';
import type { Bounds, Camera } from '../render/camera';
import type { AxisScale, SeriesSpec } from '../render/graph';

/** What the graph under the canvas plots, sampled from the scene's simulations. */
export interface GraphSpec<S extends Simulation = Simulation> {
  title: string;
  series: SeriesSpec[];
  format(value: number): string;
  scale?: AxisScale;
  sample(worlds: readonly S[]): number[];
}

/**
 * A demo: how to build its simulations and what to plot. Methods (not
 * function properties) keep Scene<World> assignable to Scene<Simulation>.
 */
export interface Scene<S extends Simulation = Simulation> {
  id: string;
  /** Roadmap stage the scene belongs to. */
  stage: number;
  title: string;
  description: string;
  /** Default physics step, s. */
  dt: number;
  /** World region framed on load. */
  view: Bounds;
  graph(worlds: readonly S[]): GraphSpec<S>;
  /** Each world brings its own integrator; the UI picker is disabled. */
  fixedIntegrators?: boolean;
  /** Shown instead of the integrator summary when the picker is disabled. */
  integratorNote?: string;
  /** Restart automatically after this much simulated time, s. */
  loopAfter?: number;
  /** Display unit for lengths (grid, cursor, errors); metres by default. */
  lengthUnit?: LengthUnit;
  /** Range of the physics-step slider, s. */
  dtRange?: readonly [number, number];
  /** Starting time scale (simulated seconds per real second) and its slider range. */
  speed?: number;
  speedRange?: readonly [number, number];
  /** Integrator selected when the scene loads (velocity Verlet otherwise). */
  integrator?: IntegratorId;
  /** Extra drawing under the bodies, e.g. Kepler's equal-area sectors. */
  overlay?(ctx: CanvasRenderingContext2D, camera: Camera, worlds: readonly S[]): void;
  /**
   * Energy leaves without being booked as losses (rigid-body impacts,
   * damping), so it only shows as a drop in E.
   */
  losesEnergy?: boolean;
  build(integrator: IntegratorId): S[];
  /**
   * Exact solution, when one exists, drawn as ghosts and used for error stats.
   * Returns null for particles without one.
   */
  analytic?(world: number, particle: number, t: number): Vec2 | null;
}
