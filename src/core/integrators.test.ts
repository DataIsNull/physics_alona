import { describe, expect, it } from 'vitest';
import { Spring, UniformGravity } from './forces';
import { INTEGRATORS, type IntegratorId } from './integrators';
import { Vec2 } from './vec2';
import { World } from './world';

const OMEGA = 2 * Math.PI; // period 1 s with k = ω², m = 1

/** 1D harmonic oscillator x(t) = cos ωt via a zero-length spring to the origin. */
function oscillator(integrator: IntegratorId): World {
  return new World({
    integrator,
    forces: [new Spring(Vec2.ZERO, 0, OMEGA * OMEGA, 0)],
    particles: [{ pos: new Vec2(1, 0), mass: 1 }],
  });
}

function run(world: World, dt: number, steps: number): void {
  for (let i = 0; i < steps; i++) world.step(dt);
}

/** Phase-space distance from the exact oscillator solution. */
function oscillatorError(world: World): number {
  const t = world.t;
  const x = world.particles.pos[0];
  const v = world.particles.vel[0];
  return Math.hypot(x - Math.cos(OMEGA * t), (v + OMEGA * Math.sin(OMEGA * t)) / OMEGA);
}

describe('free fall (constant acceleration)', () => {
  const g = new Vec2(0, -9.81);
  const v0 = new Vec2(3, 4);
  const dt = 1 / 60;
  const steps = 120;
  const exact = (t: number) => v0.scale(t).add(g.scale((t * t) / 2));

  function fall(integrator: IntegratorId): Vec2 {
    const world = new World({
      integrator,
      forces: [new UniformGravity(g)],
      particles: [{ pos: Vec2.ZERO, vel: v0 }],
    });
    run(world, dt, steps);
    return world.particles.position(0);
  }

  it.each(['velocity-verlet', 'rk4'] as const)('%s matches the exact parabola', (id) => {
    expect(fall(id).distanceTo(exact(steps * dt))).toBeLessThan(1e-9);
  });

  it('explicit Euler lags by about g·t·dt/2', () => {
    const error = fall('euler').distanceTo(exact(steps * dt));
    expect(error).toBeCloseTo((9.81 * 2 * dt) / 2, 6);
  });
});

describe('convergence order on the harmonic oscillator', () => {
  const T = 0.3;

  it.each(INTEGRATORS.map((info) => [info.id, info.order] as const))(
    '%s converges with order %i',
    (id, order) => {
      const coarse = oscillator(id);
      run(coarse, T / 30, 30);
      const fine = oscillator(id);
      run(fine, T / 60, 60);
      const observed = Math.log2(oscillatorError(coarse) / oscillatorError(fine));
      expect(observed).toBeGreaterThan(order - 0.25);
      expect(observed).toBeLessThan(order + 0.25);
    },
  );
});

describe('long-run energy behaviour (1000 periods, dt = 1/60 s)', () => {
  const dt = 1 / 60;
  const stepsPerPeriod = 60;

  /** Max |ΔE/E₀| over each period. */
  function driftPerPeriod(id: IntegratorId, periods: number): number[] {
    const world = oscillator(id);
    const maxima: number[] = [];
    for (let p = 0; p < periods; p++) {
      let max = 0;
      for (let s = 0; s < stepsPerPeriod; s++) {
        world.step(dt);
        max = Math.max(max, Math.abs(world.energyDrift()));
      }
      maxima.push(max);
    }
    return maxima;
  }

  it('velocity Verlet keeps energy within (ω·dt)²/4 without growth', () => {
    const drift = driftPerPeriod('velocity-verlet', 1000);
    // Verlet exactly conserves a shadow energy; E itself wobbles by up to (ω·dt)²/4.
    const bound = (OMEGA * dt) ** 2 / 4;
    expect(Math.max(...drift)).toBeLessThan(bound * 1.05);
    expect(drift[999]).toBeLessThan(drift[0] * 1.01);
  });

  it('semi-implicit Euler oscillates but stays bounded', () => {
    const drift = driftPerPeriod('semi-implicit-euler', 1000);
    expect(Math.max(...drift)).toBeLessThan(0.06);
    expect(drift[999]).toBeLessThan(drift[0] * 1.01);
  });

  it('RK4 is accurate but slowly loses energy', () => {
    const world = oscillator('rk4');
    run(world, dt, 100 * stepsPerPeriod);
    const after100 = world.energyDrift();
    run(world, dt, 900 * stepsPerPeriod);
    const after1000 = world.energyDrift();
    expect(after100).toBeLessThan(0);
    expect(after1000).toBeLessThan(after100 * 5); // monotonic decay, roughly linear
    expect(Math.abs(after1000)).toBeLessThan(5e-3);
  });

  it('explicit Euler gains energy exponentially', () => {
    const world = oscillator('euler');
    run(world, dt, 10 * stepsPerPeriod);
    // Each step multiplies energy by 1 + (ω·dt)².
    const expected = (1 + (OMEGA * dt) ** 2) ** (10 * stepsPerPeriod) - 1;
    expect(world.energyDrift()).toBeCloseTo(expected, 6);
    expect(world.energyDrift()).toBeGreaterThan(100);
  });
});
