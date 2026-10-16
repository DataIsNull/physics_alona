import { describe, expect, it } from 'vitest';
import { SCENES } from '.';

describe.each(SCENES.map((s) => [s.id, s] as const))('scene %s', (_id, scene) => {
  /** 3 s of simulated time, but between 50 steps (orbits step in days) and 1500 (molecules step in femtoseconds). */
  const steps = Math.min(Math.max(Math.round(3 / scene.dt), 50), 1500);
  const params = Object.fromEntries((scene.params ?? []).map((p) => [p.id, p.value]));

  it('builds, runs without diverging and samples its graph', () => {
    const worlds = scene.build(scene.integrator ?? 'velocity-verlet', params);
    const graph = scene.graph(worlds, params);
    for (let s = 0; s < steps; s++) for (const w of worlds) w.step(scene.dt);
    for (const w of worlds) expect(w.diverged).toBe(false);
    const sample = graph.sample(worlds);
    expect(sample).toHaveLength(graph.series.length);
    for (const v of sample) expect(Number.isNaN(v)).toBe(false);
  }, 30000);

  it.skipIf(scene.losesEnergy)('keeps its energy books balanced', () => {
    const worlds = scene.build(scene.integrator ?? 'velocity-verlet', params);
    for (let s = 0; s < steps; s++) for (const w of worlds) w.step(scene.dt);
    for (const w of worlds) {
      if (w.label === 'Явний Ейлер') continue; // unstable by design
      expect(Math.abs(w.energyDrift())).toBeLessThan(0.01);
    }
  }, 30000);
});
