import type { IntegratorId } from '../core/integrators';
import type { Vec2 } from '../core/vec2';
import type { World } from '../core/world';
import type { Bounds } from '../render/camera';

/**
 * What the graph plots: kinetic/potential/total energy of the first world,
 * or relative energy drift of every world (for side-by-side comparisons).
 */
export type GraphMode = 'energy' | 'drift';

export interface Scene {
  id: string;
  title: string;
  description: string;
  /** Default physics step, s. */
  dt: number;
  /** World region framed on load. */
  view: Bounds;
  graph: GraphMode;
  /** Each world brings its own integrator; the UI picker is disabled. */
  fixedIntegrators?: boolean;
  /** Restart automatically after this much simulated time, s. */
  loopAfter?: number;
  build(integrator: IntegratorId): World[];
  /** Exact solution, when one exists, drawn as ghosts and used for error stats. */
  analytic?(world: number, particle: number, t: number): Vec2;
}
