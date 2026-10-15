import type { IntegratorId } from '../core/integrators';
import type { Vec2 } from '../core/vec2';
import type { World } from '../core/world';
import type { Bounds } from '../render/camera';
import type { AxisScale, SeriesSpec } from '../render/graph';

/** What the graph under the canvas plots, sampled from the scene's worlds. */
export interface GraphSpec {
  title: string;
  series: SeriesSpec[];
  format(value: number): string;
  scale?: AxisScale;
  sample(worlds: readonly World[]): number[];
}

export interface Scene {
  id: string;
  /** Roadmap stage the scene belongs to. */
  stage: number;
  title: string;
  description: string;
  /** Default physics step, s. */
  dt: number;
  /** World region framed on load. */
  view: Bounds;
  graph(worlds: readonly World[]): GraphSpec;
  /** Each world brings its own integrator; the UI picker is disabled. */
  fixedIntegrators?: boolean;
  /** Restart automatically after this much simulated time, s. */
  loopAfter?: number;
  build(integrator: IntegratorId): World[];
  /**
   * Exact solution, when one exists, drawn as ghosts and used for error stats.
   * Returns null for particles without one.
   */
  analytic?(world: number, particle: number, t: number): Vec2 | null;
}
