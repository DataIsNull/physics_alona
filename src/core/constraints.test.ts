import { describe, expect, it } from 'vitest';
import { DistanceConstraint } from './constraints';
import { pendulumAngle, pendulumPeriod } from './exact';
import { UniformGravity } from './forces';
import { DEG } from './units';
import { Vec2 } from './vec2';
import { World } from './world';

const g = 9.81;
const L = 1;
const omega0 = Math.sqrt(g / L);

/** Pivot (fixed, index 0) and bob (index 1) released from rest at θ₀ from vertical. */
function pendulum(theta0: number): World {
  return new World({
    integrator: 'velocity-verlet',
    forces: [new UniformGravity(new Vec2(0, -g))],
    constraints: [new DistanceConstraint(0, 1, L)],
    particles: [
      { pos: Vec2.ZERO, fixed: true },
      { pos: new Vec2(L * Math.sin(theta0), -L * Math.cos(theta0)), mass: 1 },
    ],
  });
}

const angle = (world: World) => {
  const bob = world.particles.position(1);
  return Math.atan2(bob.x, -bob.y);
};

describe('pendulum on a rigid rod', () => {
  it.each([10, 90, 170])('period at θ₀ = %i° matches the elliptic-integral formula', (deg) => {
    const world = pendulum(deg * DEG);
    const dt = 1 / 960;
    // Time between successive downward zero crossings of θ.
    const crossings: number[] = [];
    let prev = angle(world);
    while (crossings.length < 3) {
      world.step(dt);
      const now = angle(world);
      if (prev > 0 && now <= 0) crossings.push(world.t - dt * (now / (now - prev)));
      prev = now;
    }
    const measured = (crossings[2] - crossings[0]) / 2;
    expect(measured / pendulumPeriod(deg * DEG, omega0)).toBeCloseTo(1, 3);
  });

  it('follows the exact nonlinear solution at 90°', () => {
    const world = pendulum(90 * DEG);
    for (let i = 0; i < 5 * 480; i++) world.step(1 / 480);
    expect(Math.abs(angle(world) - pendulumAngle(90 * DEG, omega0, world.t))).toBeLessThan(5e-3);
  });

  it('keeps the rod length and conserves energy over 100 periods', () => {
    const world = pendulum(120 * DEG);
    const steps = Math.round((100 * pendulumPeriod(120 * DEG, omega0)) / (1 / 240));
    let worstDrift = 0;
    for (let i = 0; i < steps; i++) {
      world.step(1 / 240);
      worstDrift = Math.max(worstDrift, Math.abs(world.energyDrift()));
    }
    expect(world.particles.position(1).length()).toBeCloseTo(L, 9);
    expect(worstDrift).toBeLessThan(2e-3);
  });

  it('double pendulum keeps energy bounded through chaos', () => {
    const world = new World({
      integrator: 'velocity-verlet',
      forces: [new UniformGravity(new Vec2(0, -g))],
      constraints: [new DistanceConstraint(0, 1, 1), new DistanceConstraint(1, 2, 1)],
      particles: [
        { pos: Vec2.ZERO, fixed: true },
        { pos: Vec2.fromAngle(30 * DEG, 1), mass: 1 },
        { pos: Vec2.fromAngle(30 * DEG, 1).add(Vec2.fromAngle(60 * DEG, 1)), mass: 1 },
      ],
    });
    let worstDrift = 0;
    for (let i = 0; i < 20 * 480; i++) {
      world.step(1 / 480);
      worstDrift = Math.max(worstDrift, Math.abs(world.energyDrift()));
    }
    expect(worstDrift).toBeLessThan(5e-3);
  });
});
