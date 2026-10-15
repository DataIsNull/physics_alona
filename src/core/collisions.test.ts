import { describe, expect, it } from 'vitest';
import { Collisions, wall } from './collisions';
import { UniformGravity } from './forces';
import type { ParticleSpec } from './particles';
import { SpatialHash } from './spatialHash';
import { Vec2 } from './vec2';
import { World } from './world';

/** One near-zero step: positions barely move, so the collision response is isolated. */
function collide(particles: ParticleSpec[], collisions = new Collisions()): World {
  const world = new World({ integrator: 'euler', particles, collisions });
  world.step(1e-9);
  return world;
}

const ball = (x: number, vx: number, extra: Partial<ParticleSpec> = {}): ParticleSpec => ({
  pos: new Vec2(x, 0),
  vel: new Vec2(vx, 0),
  radius: 0.5,
  mass: 1,
  ...extra,
});

describe('particle–particle collisions', () => {
  it('equal masses swap velocities in an elastic head-on collision', () => {
    const world = collide([ball(0, 2), ball(0.99, 0)]);
    expect(world.particles.velocity(0).x).toBeCloseTo(0, 12);
    expect(world.particles.velocity(1).x).toBeCloseTo(2, 12);
  });

  it('unequal masses: elastic formulas, momentum and energy conserved', () => {
    const m1 = 1;
    const m2 = 3;
    const v1 = 4;
    const v2 = -1;
    const world = collide([ball(0, v1, { mass: m1 }), ball(0.99, v2, { mass: m2 })]);
    expect(world.particles.velocity(0).x).toBeCloseTo(((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2), 12);
    expect(world.particles.velocity(1).x).toBeCloseTo(((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2), 12);
    expect(world.momentum().x).toBeCloseTo(m1 * v1 + m2 * v2, 12);
    expect(world.kineticEnergy()).toBeCloseTo(world.initialEnergy, 10);
  });

  it('restitution e scales the separation speed and losses are counted', () => {
    const world = collide([ball(0, 3, { restitution: 0.5 }), ball(0.99, -1, { mass: 2, restitution: 0.5 })]);
    const v1 = world.particles.velocity(0).x;
    const v2 = world.particles.velocity(1).x;
    expect(v2 - v1).toBeCloseTo(-0.5 * (-1 - 3), 12);
    expect(world.momentum().x).toBeCloseTo(3 - 2, 12);
    expect(world.dissipated).toBeGreaterThan(0);
    expect(world.kineticEnergy() + world.dissipated).toBeCloseTo(world.initialEnergy, 10);
  });

  it('a fixed peg reflects a ball and stays put', () => {
    const world = collide([ball(0, 0, { fixed: true }), ball(0.99, -2)]);
    expect(world.particles.velocity(1).x).toBeCloseTo(2, 12);
    expect(world.particles.position(0)).toEqual(Vec2.ZERO);
  });
});

describe('wall collisions', () => {
  const floor = (restitution: number, friction: number) =>
    new Collisions({ walls: [wall(Vec2.ZERO, new Vec2(0, 1), restitution, friction)] });

  const falling = (friction: number): ParticleSpec => ({
    pos: new Vec2(0, 0.49),
    vel: new Vec2(2, -3),
    radius: 0.5,
    restitution: 1,
    friction,
  });

  it('bounces with the wall restitution', () => {
    const world = collide([falling(0)], floor(0.8, 0));
    expect(world.particles.velocity(0)).toEqual(new Vec2(2, 0.8 * 3));
  });

  it('friction removes at most μ times the normal impulse', () => {
    const slip = collide([falling(0.1)], floor(0.8, 0.1));
    // Normal impulse per unit mass = (1 + e)·3 = 5.4; with μ = 0.1 friction takes 0.54.
    expect(slip.particles.velocity(0).x).toBeCloseTo(2 - 0.1 * 5.4, 12);
    const stick = collide([falling(1)], floor(0.8, 1));
    expect(stick.particles.velocity(0).x).toBeCloseTo(0, 12);
  });

  it('a ball resting on the floor stays at rest', () => {
    const world = new World({
      integrator: 'velocity-verlet',
      forces: [new UniformGravity()],
      collisions: floor(0.9, 0.5),
      particles: [{ pos: new Vec2(0, 0.5), radius: 0.5, restitution: 0.9, friction: 0.5 }],
    });
    for (let i = 0; i < 2400; i++) world.step(1 / 240);
    expect(Math.abs(world.particles.velocity(0).y)).toBeLessThan(0.05);
    // Settles within the 0.2 % penetration slop.
    expect(world.particles.position(0).y).toBeGreaterThan(0.498);
    expect(world.particles.position(0).y).toBeLessThan(0.501);
    expect(Math.abs(world.energyDrift())).toBeLessThan(1e-3);
  });
});

describe('SpatialHash', () => {
  it('finds exactly the pairs brute force finds', () => {
    let seed = 42;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 400;
    const pos = new Float64Array(2 * n);
    for (let k = 0; k < 2 * n; k++) pos[k] = random() * 20 - 10;
    const reach = 0.6;

    const expected = new Set<string>();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.hypot(pos[2 * j] - pos[2 * i], pos[2 * j + 1] - pos[2 * i + 1]) < reach) expected.add(`${i},${j}`);
      }
    }

    const hash = new SpatialHash();
    hash.build(pos, n, reach);
    const found = new Set<string>();
    hash.forEachPair(n, (i, j) => {
      const key = `${i},${j}`;
      expect(found.has(key)).toBe(false); // no duplicates
      if (Math.hypot(pos[2 * j] - pos[2 * i], pos[2 * j + 1] - pos[2 * i + 1]) < reach) found.add(key);
    });
    expect(expected.size).toBeGreaterThan(50);
    expect(found).toEqual(expected);
  });
});
