import { describe, expect, it } from 'vitest';
import { Spring, UniformGravity } from './forces';
import { INTEGRATORS } from './integrators';
import { Vec2 } from './vec2';
import { World } from './world';

describe('World', () => {
  it('computes kinetic, potential and total energy', () => {
    const world = new World({
      integrator: 'velocity-verlet',
      forces: [new UniformGravity(new Vec2(0, -10)), new Spring(Vec2.ZERO, 0, 4, 0)],
      particles: [{ pos: new Vec2(0, 3), vel: new Vec2(2, 0), mass: 2 }],
    });
    expect(world.kineticEnergy()).toBeCloseTo(4); // ½·2·2²
    expect(world.potentialEnergy()).toBeCloseTo(2 * 10 * 3 + 0.5 * 4 * 9); // mgh + ½kx²
    expect(world.totalEnergy()).toBeCloseTo(4 + 60 + 18);
    expect(world.energyDrift()).toBe(0);
  });

  it.each(INTEGRATORS.map((i) => i.id))('%s conserves momentum under internal forces', (id) => {
    // Two free masses joined by a spring: no external force, so p must stay constant.
    const world = new World({
      integrator: id,
      forces: [new Spring(0, 1, 50, 1)],
      particles: [
        { pos: new Vec2(0, 0), vel: new Vec2(1, 2), mass: 1 },
        { pos: new Vec2(1.5, 0.3), vel: new Vec2(-0.5, 0), mass: 3 },
      ],
    });
    const p0 = world.momentum();
    for (let i = 0; i < 1000; i++) world.step(1 / 120);
    expect(world.momentum().equals(p0, 1e-10)).toBe(true);
  });

  it('reset restores the initial state', () => {
    const world = new World({
      integrator: 'rk4',
      forces: [new UniformGravity()],
      particles: [{ pos: new Vec2(1, 2), vel: new Vec2(3, 4) }],
    });
    for (let i = 0; i < 50; i++) world.step(0.01);
    world.reset();
    expect(world.t).toBe(0);
    expect(world.steps).toBe(0);
    expect(world.particles.position(0)).toEqual(new Vec2(1, 2));
    expect(world.particles.velocity(0)).toEqual(new Vec2(3, 4));
  });

  it('flags divergence and stops advancing', () => {
    const world = new World({
      integrator: 'euler',
      forces: [new Spring(Vec2.ZERO, 0, 1e6, 0)],
      particles: [{ pos: new Vec2(1, 0) }],
    });
    for (let i = 0; i < 1000; i++) world.step(1);
    expect(world.diverged).toBe(true);
    expect(world.steps).toBeLessThan(1000);
  });

  it('rejects non-positive mass', () => {
    expect(
      () => new World({ integrator: 'euler', particles: [{ pos: Vec2.ZERO, mass: 0 }] }),
    ).toThrow(RangeError);
  });
});
