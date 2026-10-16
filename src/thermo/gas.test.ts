import { describe, expect, it } from 'vitest';
import { BOLTZMANN } from '../core/units';
import { Vec2 } from '../core/vec2';
import {
  ARGON,
  type GasOptions,
  GasWorld,
  gridPositions,
  hexPositions,
  randomDirection,
  scatteredPositions,
  seededRandom,
  thermalVelocities,
  thermalVelocity,
} from './gas';

const SIGMA = ARGON.sigma;
const M = ARGON.mass;
/** Lennard-Jones time unit σ·√(m/ε) ≈ 2.2 ps. */
const TAU = SIGMA * Math.sqrt(M / ARGON.epsilon);
const DT = 0.005 * TAU;

function gas(count: number, width: number, height: number, temperature: number, extra: Partial<GasOptions> = {}, seed = 1) {
  const random = seededRandom(seed);
  const half = new Vec2(width / 2 - SIGMA, height / 2 - SIGMA);
  return new GasWorld({
    width,
    height,
    species: [ARGON],
    particles: gridPositions(count, half.scale(-1), half, 0.3, random).map((pos) => ({
      pos,
      vel: thermalVelocity(M, temperature, random),
      species: 0,
    })),
    ...extra,
  });
}

function run(world: GasWorld, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) world.step(DT);
}

describe('forces', () => {
  it('the cell list finds exactly the forces of a brute-force sum, and they obey Newton’s third law', () => {
    const world = gas(200, 30 * SIGMA, 30 * SIGMA, 120);
    const ax = (world as unknown as { ax: Float64Array }).ax;
    const ay = (world as unknown as { ay: Float64Array }).ay;
    const cut2 = (2.5 * SIGMA) ** 2;
    let worst = 0;
    let px = 0;
    let py = 0;
    for (let i = 0; i < world.n; i++) {
      let fx = 0;
      let fy = 0;
      for (let j = 0; j < world.n; j++) {
        if (i === j) continue;
        const dx = world.x[j] - world.x[i];
        const dy = world.y[j] - world.y[i];
        const r2 = dx * dx + dy * dy;
        if (r2 >= cut2) continue;
        const sr6 = (SIGMA * SIGMA / r2) ** 3;
        const f = (24 * ARGON.epsilon * sr6 * (2 * sr6 - 1)) / r2;
        fx -= f * dx;
        fy -= f * dy;
      }
      worst = Math.max(worst, Math.hypot(ax[i] * M - fx, ay[i] * M - fy) / (Math.hypot(fx, fy) + 1e-30));
      px += ax[i] * M;
      py += ay[i] * M;
    }
    expect(worst).toBeLessThan(1e-10);
    expect(Math.hypot(px, py) / (ARGON.epsilon / SIGMA)).toBeLessThan(1e-9);
  });
});

describe('a gas in a box', () => {
  it('conserves energy without a heat bath', () => {
    const world = gas(300, 40 * SIGMA, 40 * SIGMA, 100);
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      world.step(DT);
      worst = Math.max(worst, Math.abs(world.energyDrift()));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('pressure on the walls follows P·A ≈ N·k·T and doubles with temperature', () => {
    const measure = (temperature: number) => {
      const world = gas(300, 80 * SIGMA, 60 * SIGMA, temperature, { interaction: 'repulsive', pressureTime: 5e-12 });
      run(world, 30e-12);
      let p = 0;
      let ideal = 0;
      const samples = 400;
      for (let k = 0; k < samples; k++) {
        run(world, 0.1e-12);
        p += world.pressure;
        ideal += world.idealPressure();
      }
      return { p: p / samples, ideal: ideal / samples };
    };
    const cold = measure(100);
    const hot = measure(200);
    // Within a few percent of ideal; the rest is the atoms' own size (excluded area).
    expect(cold.p / cold.ideal).toBeGreaterThan(1);
    expect(cold.p / cold.ideal).toBeLessThan(1.2);
    expect(hot.p / cold.p).toBeCloseTo(2, 0);
    expect(Math.abs(hot.p / cold.p - 2)).toBeLessThan(0.15);
  });

  it('equal speeds relax into the Maxwell distribution', () => {
    const random = seededRandom(3);
    const T = 150;
    const speed = Math.sqrt((2 * BOLTZMANN * T) / M); // same energy as a gas at T
    const half = new Vec2(30 * SIGMA, 20 * SIGMA);
    const world = new GasWorld({
      width: 64 * SIGMA,
      height: 44 * SIGMA,
      species: [ARGON],
      interaction: 'repulsive',
      particles: gridPositions(400, half.scale(-1), half, 0.3, random).map((pos) => ({ pos, vel: randomDirection(speed, random), species: 0 })),
    });
    run(world, 40e-12);
    // 2D Maxwell: fraction below the most probable speed √(kT/m) is 1 − e^(−1/2) ≈ 0.393.
    let below = 0;
    let mean = 0;
    let samples = 0;
    for (let k = 0; k < 20; k++) {
      run(world, 1e-12);
      const temp = world.temperature();
      const vp = Math.sqrt((BOLTZMANN * temp) / M);
      for (const v of world.speeds()) {
        if (v < vp) below++;
        mean += v / Math.sqrt((Math.PI * BOLTZMANN * temp) / (2 * M));
        samples++;
      }
    }
    expect(below / samples).toBeCloseTo(1 - Math.exp(-0.5), 1);
    expect(Math.abs(below / samples - (1 - Math.exp(-0.5)))).toBeLessThan(0.03);
    expect(mean / samples).toBeCloseTo(1, 1);
  });

  it('starting velocities hit the requested temperature exactly, with no net drift', () => {
    const v = thermalVelocities(200, M, 300, seededRandom(11));
    const momentum = v.reduce((sum, u) => sum.add(u.scale(M)), Vec2.ZERO);
    const ke = v.reduce((sum, u) => sum + 0.5 * M * u.lengthSq(), 0);
    expect(momentum.length()).toBeLessThan(1e-12 * M * v[0].length());
    expect(ke / (200 * BOLTZMANN)).toBeCloseTo(300, 9);
  });

  it('a thermostat brings the gas to its temperature and books the heat', () => {
    const world = gas(300, 40 * SIGMA, 40 * SIGMA, 300, { thermostat: { temperature: 100, time: 1e-12 } });
    run(world, 15e-12);
    expect(world.temperature() / 100).toBeCloseTo(1, 1);
    expect(world.externalWork).toBeLessThan(0); // heat flowed out into the bath
    expect(Math.abs(world.energyDrift())).toBeLessThan(5e-3);
  });
});

describe('phases', () => {
  it('cold argon holds a hexagonal crystal: g(r) peaks at 2^(1/6)·σ', () => {
    const spacing = 2 ** (1 / 6) * SIGMA;
    const world = new GasWorld({
      width: 40 * SIGMA,
      height: 40 * SIGMA,
      species: [ARGON],
      thermostat: { temperature: 10, time: 1e-12 },
      particles: hexPositions(200, spacing, Vec2.ZERO).map((pos) => ({ pos, vel: Vec2.ZERO, species: 0 })),
    });
    run(world, 20e-12);
    const bins = 60;
    const rMax = 3 * SIGMA;
    const g = world.radialDistribution(rMax, bins);
    const peak = g.indexOf(Math.max(...g));
    expect(((peak + 0.5) * rMax) / bins / spacing).toBeCloseTo(1, 1);
    // Each inner atom has six neighbours in the well: about −3ε per atom, less at the edges.
    expect(world.potentialEnergy() / world.n / ARGON.epsilon).toBeLessThan(-2.4);
  });
});

describe('gravity', () => {
  it('density falls off as exp(−m·g·h/kT): the barometric formula', () => {
    const T = 150;
    const scale = 20 * SIGMA; // kT/(mg)
    const g = (BOLTZMANN * T) / (M * scale);
    const width = 60 * SIGMA;
    const height = 100 * SIGMA;
    const random = seededRandom(2);
    // Dilute (≈0.1 atom per σ² at the floor) so the gas stays ideal; start already layered.
    const world = new GasWorld({
      width,
      height,
      species: [ARGON],
      interaction: 'repulsive',
      gravity: g,
      thermostat: { temperature: T, time: 5e-12 },
      particles: scatteredPositions(
        120,
        new Vec2(-width / 2 + SIGMA, -height / 2 + SIGMA),
        new Vec2(width / 2 - SIGMA, height / 2 - SIGMA),
        1.2 * SIGMA,
        random,
        () => -height / 2 + SIGMA - scale * Math.log(1 - 0.9 * random()),
      ).map((pos) => ({ pos, vel: thermalVelocity(M, T, random), species: 0 })),
    });
    run(world, 50e-12);
    const bottom = world.y0 + SIGMA / 2;
    let lower = 0;
    let upper = 0;
    for (let k = 0; k < 300; k++) {
      run(world, 1e-12);
      for (let i = 0; i < world.n; i++) {
        const h = world.y[i] - bottom;
        if (h < scale) lower++;
        else if (h < 2 * scale) upper++;
      }
    }
    expect(lower / upper / Math.E).toBeGreaterThan(0.85);
    expect(lower / upper / Math.E).toBeLessThan(1.1);
  }, 30_000);
});

describe('Brownian motion', () => {
  it('heavy grains get the same mean kinetic energy, k·T, as every atom', () => {
    const random = seededRandom(5);
    const T = 150;
    const grain = { ...ARGON, name: 'Порошинка', mass: 10 * M, sigma: 3 * SIGMA, color: '#e8e6df' };
    const grains = Array.from({ length: 6 }, (_, k) => new Vec2(((k % 3) - 1) * 22 * SIGMA, (Math.floor(k / 3) - 0.5) * 22 * SIGMA));
    const half = new Vec2(38 * SIGMA, 28 * SIGMA);
    const atoms = gridPositions(500, half.scale(-1), half, 0.3, random).filter((p) => grains.every((q) => p.distanceTo(q) > 2.5 * SIGMA));
    // No thermostat: a Berendsen bath rescales everyone alike and skews equipartition by ~10 %.
    const world = new GasWorld({
      width: 80 * SIGMA,
      height: 60 * SIGMA,
      species: [ARGON, grain],
      interaction: 'repulsive',
      particles: [
        ...grains.map((pos) => ({ pos, vel: Vec2.ZERO, species: 1 })),
        ...atoms.map((pos) => ({ pos, vel: thermalVelocity(M, T, random), species: 0 })),
      ],
    });
    run(world, 30e-12);
    let ke = 0;
    let kT = 0;
    let samples = 0;
    for (let k = 0; k < 2500; k++) {
      run(world, 0.1e-12);
      for (let i = 0; i < grains.length; i++) ke += 0.5 * grain.mass * (world.vx[i] ** 2 + world.vy[i] ** 2);
      kT += grains.length * BOLTZMANN * world.temperature(world.ofSpecies(0));
      samples++;
    }
    expect(ke / kT).toBeGreaterThan(0.85);
    expect(ke / kT).toBeLessThan(1.15);
  }, 30_000);
});
