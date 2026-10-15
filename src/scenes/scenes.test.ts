import { describe, expect, it } from 'vitest';
import { SCENES } from '.';

describe.each(SCENES.map((s) => [s.id, s] as const))('scene %s', (_id, scene) => {
  /** 3 s of simulated time, but at least 50 steps (orbital scenes step in days). */
  const steps = Math.max(Math.round(3 / scene.dt), 50);

  it('builds, runs without diverging and samples its graph', () => {
    const worlds = scene.build(scene.integrator ?? 'velocity-verlet');
    const graph = scene.graph(worlds);
    for (let s = 0; s < steps; s++) for (const w of worlds) w.step(scene.dt);
    for (const w of worlds) expect(w.diverged).toBe(false);
    const sample = graph.sample(worlds);
    expect(sample).toHaveLength(graph.series.length);
    for (const v of sample) expect(Number.isNaN(v)).toBe(false);
  });

  it.skipIf(scene.losesEnergy)('keeps its energy books balanced', () => {
    const worlds = scene.build(scene.integrator ?? 'velocity-verlet');
    for (let s = 0; s < steps; s++) for (const w of worlds) w.step(scene.dt);
    for (const w of worlds) {
      if (w.label === 'Явний Ейлер') continue; // unstable by design
      expect(Math.abs(w.energyDrift())).toBeLessThan(0.01);
    }
  });
});
