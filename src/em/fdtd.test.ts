import { describe, expect, it } from 'vitest';
import { SPEED_OF_LIGHT } from '../core/units';
import { Vec2 } from '../core/vec2';
import { MaxwellWorld } from './fdtd';

const LAMBDA = 500e-9;
const DX = LAMBDA / 20;
const PERIOD = LAMBDA / SPEED_OF_LIGHT;

/** An endless plane-wave pulse (periodic top and bottom) launched at x = −3 µm, glass of index n from x = 0. */
function slab(n: number, probes: Vec2[]) {
  return new MaxwellWorld({
    nx: 480,
    ny: 4,
    spacing: DX,
    edges: 'periodic',
    permittivity: (x) => (x > 0 ? n * n : 1),
    sources: [{ kind: 'line', position: new Vec2(-3e-6, 0), wavelength: LAMBDA, amplitude: 1, pulse: { width: 1.5 * PERIOD, delay: 4 * PERIOD } }],
    probes,
  });
}

/** Runs and returns, per probe, the envelope (|Ez| smoothed over a period) against time. */
function record(sim: MaxwellWorld, duration: number): { t: number[]; envelope: number[][] } {
  const t: number[] = [];
  const raw: number[][] = sim.probes.map(() => []);
  while (sim.t < duration) {
    sim.step(sim.dt);
    t.push(sim.t);
    sim.probeValues().forEach((v, k) => raw[k].push(v * v));
  }
  const window = Math.round(PERIOD / sim.dt);
  const envelope = raw.map((r) =>
    r.map((_, i) => {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, i - window); k <= Math.min(r.length - 1, i + window); k++, c++) s += r[k];
      return Math.sqrt((2 * s) / c);
    }),
  );
  return { t, envelope };
}

const peakTime = (t: number[], env: number[], from = 0, to = Infinity) => {
  let best = -1;
  let at = 0;
  env.forEach((v, i) => {
    if (t[i] >= from && t[i] <= to && v > best) {
      best = v;
      at = t[i];
    }
  });
  return { time: at, value: best };
};

describe('light on a Yee grid', () => {
  it('a pulse travels at c in vacuum and at c/n in glass', () => {
    const n = 1.5;
    const sim = slab(n, [new Vec2(-2e-6, 0), new Vec2(-0.5e-6, 0), new Vec2(0.5e-6, 0), new Vec2(2e-6, 0)]);
    const { t, envelope } = record(sim, 40 * PERIOD);
    const [a, b, c, d] = envelope.map((env) => peakTime(t, env, 0, 30 * PERIOD).time);
    // Within 2 %: the probes sit on cell centres, half a cell from where they were asked for.
    expect(Math.abs(1.5e-6 / (b - a) / SPEED_OF_LIGHT - 1)).toBeLessThan(0.02);
    expect(Math.abs(1.5e-6 / (d - c) / (SPEED_OF_LIGHT / n) - 1)).toBeLessThan(0.02);
  });

  it('glass reflects (1 − n)/(1 + n) of the field and lets 2/(1 + n) through', () => {
    const n = 1.5;
    const sim = slab(n, [new Vec2(-1.5e-6, 0), new Vec2(1e-6, 0)]);
    const { t, envelope } = record(sim, 45 * PERIOD);
    // At −1.5 µm the incident pulse passes first; its reflection comes back 2·1.5 µm/c later.
    const incident = peakTime(t, envelope[0], 0, 9 * PERIOD + 3e-6 / SPEED_OF_LIGHT / 2);
    const reflected = peakTime(t, envelope[0], incident.time + 3e-6 / SPEED_OF_LIGHT / 2);
    const transmitted = peakTime(t, envelope[1]);
    // Within 5 %: on the grid the glass surface is only sharp to a cell.
    expect(Math.abs(reflected.value / incident.value / ((n - 1) / (n + 1)) - 1)).toBeLessThan(0.05);
    expect(Math.abs(transmitted.value / incident.value / (2 / (n + 1)) - 1)).toBeLessThan(0.05);
  });

  it('the absorbing edges swallow a pulse that leaves the box', () => {
    const sim = slab(1, []);
    let most = 0;
    while (sim.t < 25 * PERIOD) {
      sim.step(sim.dt);
      most = Math.max(most, sim.totalEnergy());
    }
    for (let k = 0; k < 2000; k++) sim.step(sim.dt);
    expect(sim.totalEnergy() / most).toBeLessThan(1e-3);
  });

  it('a point source sends out a cylindrical wave that fades as 1/√r', () => {
    const r1 = 1.5e-6;
    const r2 = 3e-6;
    const sim = new MaxwellWorld({
      nx: 300,
      ny: 300,
      spacing: DX,
      sources: [{ kind: 'point', position: Vec2.ZERO, wavelength: LAMBDA, amplitude: 1 }],
      probes: [new Vec2(r1, 0), new Vec2(r2, 0), new Vec2(0, r2)],
    });
    while (sim.t < 16 * PERIOD) sim.step(sim.dt);
    const peaks = [0, 0, 0];
    while (sim.t < 20 * PERIOD) {
      sim.step(sim.dt);
      sim.probeValues().forEach((v, k) => (peaks[k] = Math.max(peaks[k], Math.abs(v))));
    }
    expect(peaks[0] / peaks[1] / Math.SQRT2).toBeCloseTo(1, 1);
    // The same in every direction.
    expect(peaks[2] / peaks[1]).toBeCloseTo(1, 1);
  });

  it('keeps the magnetic field divergence-free (∇·B = 0) away from the absorbing edges', () => {
    const sim = new MaxwellWorld({
      nx: 120,
      ny: 120,
      spacing: DX,
      sources: [{ kind: 'point', position: Vec2.ZERO, wavelength: LAMBDA, amplitude: 1 }],
    });
    while (sim.t < 6 * PERIOD) sim.step(sim.dt);
    let worst = 0;
    let scale = 0;
    for (let j = 20; j < 100; j++) {
      for (let i = 20; i < 100; i++) {
        const k = j * sim.nx + i;
        const div = sim.hx[k + 1] - sim.hx[k] + sim.hy[k + sim.nx] - sim.hy[k];
        worst = Math.max(worst, Math.abs(div));
        scale = Math.max(scale, Math.abs(sim.hx[k]), Math.abs(sim.hy[k]));
      }
    }
    expect(worst / scale).toBeLessThan(1e-12);
  });
});
