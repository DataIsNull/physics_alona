import { describe, expect, it } from 'vitest';
import { DistanceConstraint } from '../core/constraints';
import { drivenAmplitude, drivenOscillator } from '../core/exact';
import { HarmonicForce, LinearDrag, Spring, UniformGravity } from '../core/forces';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { WaveField, gridModeFrequency } from './field';
import { WaveString, travellingPulse } from './string';

function run(sim: { step(dt: number): void }, seconds: number, dt = 1 / 120): void {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) sim.step(dt);
}

describe('string', () => {
  const L = 4;
  const c = 4;

  it.each([1, 3])('mode %i oscillates at the grid frequency exactly, and close to n·c/2L', (mode) => {
    const s = new WaveString({
      length: L,
      nodes: 101,
      speed: c,
      initial: (x) => ({ u: 0.1 * Math.sin((mode * Math.PI * x) / L), v: 0 }),
    });
    const dt = 1 / 120;
    const h = s.substep(dt);
    const lambda = ((4 * c * c) / s.dx ** 2) * Math.sin((mode * Math.PI * s.dx) / (2 * L)) ** 2;
    const omega = Math.acos(1 - (lambda * h * h) / 2) / h;
    run(s, 2, dt);
    let worst = 0;
    for (let i = 0; i < s.n; i++) {
      const exact = 0.1 * Math.sin((mode * Math.PI * i * s.dx) / L) * Math.cos(omega * s.t);
      worst = Math.max(worst, Math.abs(s.u[i] - exact));
    }
    expect(worst).toBeLessThan(1e-12);
    expect(omega / (2 * Math.PI) / ((mode * c) / (2 * L))).toBeCloseTo(1, 3);
    expect(Math.abs(s.energyDrift())).toBeLessThan(1e-3);
  });

  it.each(['fixed', 'free'] as const)('a pulse travels at c and reflects off a %s end', (end) => {
    const g = (x: number) => 0.2 * Math.exp(-(((x - 1) / 0.15) ** 2));
    const exact = travellingPulse(g, L, c, end);
    const s = new WaveString({
      length: L,
      nodes: 401,
      speed: c,
      right: { kind: end },
      initial: (x) => ({ u: g(x), v: (-c * -2 * (x - 1) * g(x)) / 0.15 ** 2 }),
      exact,
    });
    // After 1.25 s the pulse has bounced off the right end and is back at x = 2.
    run(s, 1.25, 1 / 240);
    expect(s.exactError()! / 0.2).toBeLessThan(0.03);
    const middle = s.u[Math.round(2 / s.dx)];
    if (end === 'fixed') expect(middle).toBeLessThan(-0.15); // inverted
    else expect(middle).toBeGreaterThan(0.15); // upright
  });

  it('a hand shaking at a resonance pumps energy in, and the books balance', () => {
    const drive = (frequency: number) =>
      new WaveString({ length: L, nodes: 101, speed: c, damping: 0.1, left: { kind: 'driven', amplitude: 0.02, frequency } });
    const resonant = drive((2 * c) / (2 * L)); // second harmonic, 1 Hz
    const detuned = drive(1.25);
    run(resonant, 20);
    run(detuned, 20);
    expect(resonant.totalEnergy()).toBeGreaterThan(20 * detuned.totalEnergy());
    expect(resonant.externalWork).toBeGreaterThan(0);
    expect(Math.abs(resonant.energyDrift())).toBeLessThan(1e-2);
  });
});

describe('membrane and ripple tank', () => {
  it('a drum mode (2, 1) rings at the grid frequency exactly', () => {
    const W = 1;
    const mode = (x: number, y: number) => Math.sin(2 * Math.PI * (x + 0.5)) * Math.sin(Math.PI * (y + 0.5));
    const h = 0.004;
    const field = new WaveField({ width: W, height: W, cells: 61, speed: 1, substep: h, initial: (x, y) => ({ u: 0.01 * mode(x, y), v: 0 }) });
    const omega = gridModeFrequency(2, 1, field, field.substep(1 / 60));
    run(field, 2, 1 / 60);
    let worst = 0;
    for (let j = 0; j < field.ny; j++) {
      for (let i = 0; i < field.nx; i++) {
        worst = Math.max(worst, Math.abs(field.u[j * field.nx + i] - 0.01 * mode(field.x(i), field.y(j)) * Math.cos(omega * field.t)));
      }
    }
    expect(worst).toBeLessThan(1e-12);
    // Continuum: f = (c/2)·√(m²/W² + n²/H²).
    expect(omega / (2 * Math.PI) / (0.5 * Math.sqrt(5))).toBeCloseTo(1, 2);
    expect(Math.abs(field.energyDrift())).toBeLessThan(1e-3);
  });

  it('a circular ripple spreads at speed c', () => {
    const field = new WaveField({
      width: 2,
      height: 2,
      cells: 201,
      speed: 0.5,
      edges: 'absorbing',
      sponge: 0.2,
      initial: (x, y) => ({ u: Math.exp(-(x * x + y * y) / 0.002), v: 0 }),
    });
    run(field, 1.2, 1 / 60);
    // The crest should be near r = c·t = 0.6 m.
    let bestR = 0;
    let best = -Infinity;
    for (let r = 0.3; r < 0.8; r += 0.005) {
      const u = field.sample(new Vec2(r, 0));
      if (u > best) {
        best = u;
        bestR = r;
      }
    }
    expect(bestR).toBeCloseTo(0.6, 1);
  });

  /** Time-averaged u² at points, over `seconds` after `warmup`. */
  function intensity(field: WaveField, points: Vec2[], warmup: number, seconds: number): number[] {
    run(field, warmup, 1 / 60);
    const sums = points.map(() => 0);
    const n = Math.round(seconds * 240);
    for (let k = 0; k < n; k++) {
      field.step(1 / 240);
      points.forEach((p, i) => (sums[i] += field.sample(p) ** 2));
    }
    return sums.map((s) => s / n);
  }

  it('two sources interfere: quiet where paths differ by λ/2, loud where they match', () => {
    const c = 0.3;
    const f = 3;
    const lambda = c / f;
    const d = 0.3;
    const field = new WaveField({
      width: 1.6,
      height: 1.2,
      cells: 241,
      speed: c,
      edges: 'absorbing',
      sponge: 0.18,
      sources: [-d / 2, d / 2].map((x) => ({ position: () => new Vec2(x, -0.3), frequency: f, amplitude: 50, radius: 0.012 })),
    });
    // At height 0.6 m above the sources: on the axis (equal paths) and where r₁ − r₂ = λ/2.
    const y = 0.3;
    const pathDifference = (x: number) => Math.hypot(x + d / 2, y + 0.3) - Math.hypot(x - d / 2, y + 0.3);
    let lo = 0;
    let hi = 0.6;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (pathDifference(mid) < lambda / 2) lo = mid;
      else hi = mid;
    }
    const [loud, quiet] = intensity(field, [new Vec2(0, y), new Vec2(lo, y)], 6, 2);
    expect(quiet / loud).toBeLessThan(0.15);
  });

  it('Doppler: a moving source sounds higher ahead and lower behind', () => {
    const c = 0.3;
    const f = 3;
    const v = 0.5 * c;
    const ahead = new Vec2(0.55, 0);
    const behind = new Vec2(-0.55, 0);
    const field = new WaveField({
      width: 1.6,
      height: 0.8,
      cells: 321,
      speed: c,
      edges: 'absorbing',
      sponge: 0.15,
      sources: [{ position: (t) => new Vec2(-0.3 + v * t, 0), frequency: f, amplitude: 50, radius: 0.008 }],
      probes: [ahead, behind],
    });
    // Count upward zero crossings at both probes while the source is between them.
    const crossings: number[][] = [[], []];
    const prev = [0, 0];
    const dt = 1 / 480;
    for (let k = 0; k < Math.round(3.5 / dt); k++) {
      field.step(dt);
      for (let p = 0; p < 2; p++) {
        const u = field.probe(p);
        if (field.t > 1.8 && prev[p] < 0 && u >= 0) crossings[p].push(field.t);
        prev[p] = u;
      }
    }
    const frequency = (times: number[]) => (times.length - 1) / (times[times.length - 1] - times[0]);
    expect(frequency(crossings[0]) / (f / (1 - v / c))).toBeCloseTo(1, 1);
    expect(frequency(crossings[1]) / (f / (1 + v / c))).toBeCloseTo(1, 1);
  });

  it('two slits: bright fringes where d·sin θ = m·λ', () => {
    const d = 0.3;
    const f = 4;
    const lambda = 0.3 / f;
    const field = new WaveField({
      width: 2.2,
      height: 2.2,
      cells: 276,
      speed: 0.3,
      edges: 'absorbing',
      sponge: 0.3,
      walls: (x, y) => Math.abs(x + 0.55) < 0.012 && Math.abs(Math.abs(y) - d / 2) > 0.02,
      lineSources: [{ x: -0.8, frequency: f, amplitude: 1 }],
      screen: { x: 0.75, averaging: 1.5 },
    });
    run(field, 20, 1 / 60);
    const I = field.screen!.intensity;
    const max = Math.max(...I);
    const peaks: number[] = [];
    for (let j = 2; j < field.ny - 2; j++) {
      if (I[j] > I[j - 1] && I[j] >= I[j + 1] && I[j] > 0.3 * max && Math.abs(field.y(j)) < 0.8) peaks.push(field.y(j));
    }
    const expected = [-2, -1, 0, 1, 2].map((m) => 1.3 * Math.tan(Math.asin((m * lambda) / d)));
    expect(peaks).toHaveLength(expected.length);
    peaks.forEach((y, k) => expect(Math.abs(y - expected[k])).toBeLessThan(0.03));
  }, 30_000);

  it('a driven, absorbing tank balances its energy books', () => {
    const field = new WaveField({
      width: 1,
      height: 1,
      cells: 121,
      speed: 0.3,
      edges: 'absorbing',
      sponge: 0.15,
      sources: [{ position: () => Vec2.ZERO, frequency: 3, amplitude: 50, radius: 0.012 }],
    });
    run(field, 5, 1 / 60);
    expect(field.externalWork).toBeGreaterThan(0);
    expect(field.dissipated).toBeGreaterThan(0.3 * field.externalWork);
    expect(Math.abs(field.energyDrift())).toBeLessThan(1e-2);
  });
});

describe('oscillators', () => {
  it('a driven, damped spring follows the exact solution and its resonance curve', () => {
    const m = 0.5;
    const omega0 = 2 * Math.PI;
    const gamma = 0.4;
    const a = 2; // force per mass, m/s²
    for (const omega of [0.7 * omega0, omega0, 1.4 * omega0]) {
      const world = new World({
        integrator: 'velocity-verlet',
        forces: [new Spring(Vec2.ZERO, 0, m * omega0 * omega0, 0), new LinearDrag(gamma * m), new HarmonicForce([0], a * m, omega)],
        particles: [{ pos: Vec2.ZERO, mass: m }],
      });
      let worst = 0;
      let late = 0;
      for (let k = 0, n = 30 * 1000; k < n; k++) {
        world.step(1 / 1000);
        const x = world.particles.pos[0];
        worst = Math.max(worst, Math.abs(x - drivenOscillator(omega0, gamma, a, omega, world.t)));
        if (world.t > 25) late = Math.max(late, Math.abs(x));
      }
      const A = drivenAmplitude(omega0, gamma, a, omega);
      expect(worst / A).toBeLessThan(1e-4);
      // The transient has decayed to e^(−γt/2) ≈ 0.7 % by t = 25 s.
      expect(late / A).toBeCloseTo(1, 1);
      expect(Math.abs(world.energyDrift())).toBeLessThan(1e-4);
    }
  });

  it('coupled pendulums swap their energy every π/(ω₂ − ω₁)', () => {
    const g = 9.81;
    const L = 1;
    const m = 1;
    const k = 0.6;
    const gap = 0.5;
    const theta = 0.05;
    const world = new World({
      integrator: 'velocity-verlet',
      forces: [new UniformGravity(new Vec2(0, -g), new Vec2(0, -L)), new Spring(1, 3, k, gap)],
      constraints: [new DistanceConstraint(0, 1, L), new DistanceConstraint(2, 3, L)],
      particles: [
        { pos: new Vec2(0, 0), fixed: true },
        { pos: new Vec2(L * Math.sin(theta), -L * Math.cos(theta)), mass: m },
        { pos: new Vec2(gap, 0), fixed: true },
        { pos: new Vec2(gap, -L), mass: m },
      ],
    });
    const w1 = Math.sqrt(g / L);
    const w2 = Math.sqrt(g / L + (2 * k) / m);
    const swap = Math.PI / (w2 - w1);
    // Energy of the second pendulum peaks after one swap time.
    const energy2 = () => 0.5 * m * world.particles.velocity(3).lengthSq() + m * g * (world.particles.pos[7] + L);
    let peakTime = 0;
    let peak = 0;
    const dt = 1 / 960;
    for (let i = 0; i < Math.round((1.5 * swap) / dt); i++) {
      world.step(dt);
      if (energy2() > peak) {
        peak = energy2();
        peakTime = world.t;
      }
    }
    expect(peakTime / swap).toBeCloseTo(1, 1);
    expect(peak / (m * g * L * (1 - Math.cos(theta)))).toBeGreaterThan(0.9);
  });
});
