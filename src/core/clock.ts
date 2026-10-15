/**
 * Fixed-timestep clock. Physics always advances in steps of exactly `dt`
 * regardless of frame rate; leftover real time carries over to the next frame.
 */
export class FixedStepClock {
  /** Physics step, s of simulated time. */
  dt: number;
  /** Simulated seconds per real second. */
  timeScale = 1;
  paused = false;
  /** Guards against the "spiral of death" when steps cost more than a frame. */
  maxStepsPerFrame = 2000;
  /** True if the last frame hit maxStepsPerFrame and dropped time. */
  lagging = false;

  private accumulator = 0;

  constructor(dt: number) {
    this.dt = dt;
  }

  /** Returns how many fixed steps to run for a frame that took `realDt` seconds. */
  advance(realDt: number): number {
    this.lagging = false;
    if (this.paused) return 0;

    // Clamp long gaps (tab in background, debugger pause) to a quarter second.
    this.accumulator += Math.min(Math.max(realDt, 0), 0.25) * this.timeScale;

    let steps = Math.floor(this.accumulator / this.dt);
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.accumulator = 0;
      this.lagging = true;
    } else {
      this.accumulator -= steps * this.dt;
    }
    return steps;
  }

  /** Forgets simulated time still owed; used when a frame runs out of real time. */
  dropBacklog(): void {
    this.accumulator = 0;
    this.lagging = true;
  }

  reset(): void {
    this.accumulator = 0;
    this.lagging = false;
  }
}
