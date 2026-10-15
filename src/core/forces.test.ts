import { describe, expect, it } from 'vitest';
import { linearDragPosition } from './exact';
import { LinearDrag, QuadraticDrag, SurfaceFriction, UniformGravity } from './forces';
import { AIR_DENSITY } from './units';
import { Vec2 } from './vec2';
import { World } from './world';

const g = 9.81;

function run(world: World, dt: number, seconds: number): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) world.step(dt);
}

describe('linear drag', () => {
  const mass = 0.5;
  const b = 0.2;
  const tau = mass / b;

  it('matches the exact drag trajectory', () => {
    const v0 = new Vec2(12, 15);
    const world = new World({
      integrator: 'rk4',
      forces: [new UniformGravity(new Vec2(0, -g)), new LinearDrag(b)],
      particles: [{ pos: Vec2.ZERO, vel: v0, mass }],
    });
    run(world, 1 / 240, 3);
    expect(world.particles.position(0).distanceTo(linearDragPosition(v0, g, tau, world.t))).toBeLessThan(1e-8);
  });

  it('reaches terminal velocity m·g/b', () => {
    const world = new World({
      integrator: 'velocity-verlet',
      forces: [new UniformGravity(new Vec2(0, -g)), new LinearDrag(b)],
      particles: [{ pos: Vec2.ZERO, mass }],
    });
    run(world, 1 / 120, 20 * tau);
    expect(world.particles.velocity(0).y).toBeCloseTo((-mass * g) / b, 6);
  });
});

describe('quadratic drag', () => {
  const mass = 0.057; // tennis ball
  const radius = 0.033;

  it('reaches terminal velocity √(m·g/k)', () => {
    const drag = new QuadraticDrag();
    const world = new World({
      integrator: 'rk4',
      forces: [new UniformGravity(new Vec2(0, -g)), drag],
      particles: [{ pos: Vec2.ZERO, mass, radius }],
    });
    run(world, 1 / 240, 30);
    const k = 0.5 * AIR_DENSITY * 0.47 * Math.PI * radius ** 2;
    expect(world.particles.velocity(0).y).toBeCloseTo(-Math.sqrt((mass * g) / k), 6);
  });

  it('accounts for every joule: E + losses = E₀', () => {
    const world = new World({
      integrator: 'rk4',
      forces: [new UniformGravity(new Vec2(0, -g)), new QuadraticDrag()],
      particles: [{ pos: Vec2.ZERO, vel: new Vec2(30, 30), mass, radius }],
    });
    run(world, 1 / 240, 5);
    expect(world.dissipated).toBeGreaterThan(0.5 * world.initialEnergy); // drag matters here
    expect(Math.abs(world.energyDrift())).toBeLessThan(1e-5);
  });
});

describe('surface friction', () => {
  it('stops a sliding body after v₀²/(2μg)', () => {
    const mu = 0.2;
    const v0 = 2;
    const world = new World({
      integrator: 'velocity-verlet',
      forces: [new SurfaceFriction(mu, g)],
      particles: [{ pos: Vec2.ZERO, vel: new Vec2(v0, 0), mass: 3 }],
    });
    run(world, 1 / 480, 3);
    expect(world.particles.velocity(0).length()).toBeLessThan(1e-3);
    expect(world.particles.position(0).x).toBeCloseTo((v0 * v0) / (2 * mu * g), 3);
    expect(Math.abs(world.energyDrift())).toBeLessThan(1e-3);
  });
});
