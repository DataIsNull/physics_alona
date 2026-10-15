import { describe, expect, it } from 'vitest';
import { DEG } from '../core/units';
import { Vec2 } from '../core/vec2';
import { LINEAR_SLOP } from './collide';
import { DistanceJoint, RevoluteJoint } from './joints';
import { box, circle } from './shapes';
import { type RigidBodySpec, RigidWorld } from './world';

const g = 9.81;
const gravity = new Vec2(0, -g);

function run(world: RigidWorld, seconds: number, dt = 1 / 240): void {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) world.step(dt);
}

describe('incline', () => {
  const alpha = 20 * DEG;
  const down = new Vec2(Math.cos(alpha), -Math.sin(alpha)); // along the slope, downhill
  const normal = new Vec2(Math.sin(alpha), Math.cos(alpha));
  const ramp: RigidBodySpec = { shape: box(40, 1), position: Vec2.ZERO, angle: -alpha, static: true, friction: 0.6 };
  /** A spot on the ramp surface, `along` metres downhill of the middle, lifted by `lift`. */
  const onRamp = (along: number, lift: number) => normal.scale(0.5 + lift).add(down.scale(along));

  /** Speed along the slope after one second, starting from rest. */
  function speedAfter1s(body: RigidBodySpec): number {
    const world = new RigidWorld({ gravity, sleep: false, bodies: [ramp, body] });
    run(world, 1);
    const b = world.bodies[1];
    return b.vx * down.x + b.vy * down.y;
  }

  const r = 0.25;
  const m = 2;
  const rolling = (inertiaFactor: number): RigidBodySpec => ({
    shape: circle(r),
    position: onRamp(-5, r),
    mass: m,
    inertia: inertiaFactor * m * r * r,
    friction: 0.6,
  });

  it.each([
    ['solid sphere', 2 / 5],
    ['disc', 1 / 2],
    ['hoop', 1],
  ])('%s rolls with a = g·sinα / (1 + I/mr²)', (_name, k) => {
    const expected = (g * Math.sin(alpha)) / (1 + k);
    expect(speedAfter1s(rolling(k)) / expected).toBeCloseTo(1, 2);
  });

  it('a box with μ < tanα slides with a = g(sinα − μ·cosα)', () => {
    const mu = 0.2;
    const crate: RigidBodySpec = { shape: box(0.5, 0.5), position: onRamp(-5, 0.25), angle: -alpha, friction: mu };
    const world = new RigidWorld({ gravity, sleep: false, bodies: [{ ...ramp, friction: mu }, crate] });
    run(world, 1);
    const b = world.bodies[1];
    const expected = g * (Math.sin(alpha) - mu * Math.cos(alpha));
    expect((b.vx * down.x + b.vy * down.y) / expected).toBeCloseTo(1, 2);
  });

  it('a box with μ > tanα stays put', () => {
    const crate: RigidBodySpec = { shape: box(0.5, 0.5), position: onRamp(-5, 0.25), angle: -alpha, friction: 0.6 };
    const world = new RigidWorld({ gravity, bodies: [ramp, crate] });
    const start = new Vec2(world.bodies[1].x, world.bodies[1].y);
    run(world, 2);
    expect(new Vec2(world.bodies[1].x, world.bodies[1].y).distanceTo(start)).toBeLessThan(0.005);
  });
});

describe('collisions between bodies', () => {
  it('elastic head-on collision of discs conserves momentum and energy', () => {
    const world = new RigidWorld({
      gravity: Vec2.ZERO,
      bodies: [
        { shape: circle(0.5), position: new Vec2(-1, 0), velocity: new Vec2(3, 0), mass: 1, restitution: 1, friction: 0 },
        { shape: circle(0.5), position: new Vec2(1, 0), velocity: new Vec2(-1, 0), mass: 3, restitution: 1, friction: 0 },
      ],
    });
    run(world, 1);
    expect(world.momentum().x).toBeCloseTo(0, 9);
    expect(world.bodies[0].vx).toBeCloseTo(-3, 6);
    expect(world.bodies[1].vx).toBeCloseTo(1, 6);
    expect(world.totalEnergy()).toBeCloseTo(world.initialEnergy, 6);
  });

  it('off-centre hit with friction conserves linear and angular momentum', () => {
    const world = new RigidWorld({
      gravity: Vec2.ZERO,
      bodies: [
        { shape: box(1, 1), position: new Vec2(-2, 0.3), velocity: new Vec2(4, 0), restitution: 0.5, friction: 0.4 },
        { shape: box(1, 2), position: new Vec2(0, 0), angle: 0.2, restitution: 0.5, friction: 0.4 },
      ],
    });
    const p0 = world.momentum();
    const l0 = world.angularMomentum();
    run(world, 1.5);
    expect(world.bodies[1].omega).not.toBeCloseTo(0, 2); // the hit made it spin
    expect(world.momentum().distanceTo(p0)).toBeLessThan(1e-9);
    expect(Math.abs(world.angularMomentum() - l0) / Math.abs(l0)).toBeLessThan(2e-3);
    expect(world.totalEnergy()).toBeLessThan(world.initialEnergy); // inelastic
  });
});

describe('stacking and sleeping', () => {
  it('a tower of 10 boxes stands still and falls asleep', () => {
    const bodies: RigidBodySpec[] = [{ shape: box(20, 1), position: new Vec2(0, -0.5), static: true }];
    for (let i = 0; i < 10; i++) bodies.push({ shape: box(0.5, 0.5), position: new Vec2(0, 0.25 + 0.5 * i) });
    const world = new RigidWorld({ gravity, bodies });
    run(world, 5, 1 / 120);
    const top = world.bodies[10];
    expect(Math.abs(top.x)).toBeLessThan(0.01);
    // Each of the 10 contacts rests about one slop deep.
    expect(Math.abs(top.y - (4.75 - 10 * LINEAR_SLOP))).toBeLessThan(0.01);
    expect(world.bodies.every((b) => b.isStatic || !b.awake)).toBe(true);
  });

  it('a falling body wakes a sleeping one it lands on', () => {
    const world = new RigidWorld({
      gravity,
      bodies: [
        { shape: box(20, 1), position: new Vec2(0, -0.5), static: true },
        { shape: box(1, 1), position: new Vec2(0, 0.5) },
      ],
    });
    run(world, 2);
    expect(world.bodies[1].awake).toBe(false);

    const dropped = new RigidWorld({
      gravity,
      bodies: [
        { shape: box(20, 1), position: new Vec2(0, -0.5), static: true },
        { shape: box(1, 1), position: new Vec2(0, 0.5) },
        { shape: circle(0.2), position: new Vec2(0.3, 8), mass: 5 },
      ],
    });
    let woke = false;
    let slept = false;
    for (let i = 0; i < 4 * 240; i++) {
      dropped.step(1 / 240);
      if (!dropped.bodies[1].awake) slept = true;
      if (slept && dropped.bodies[1].awake) woke = true;
    }
    expect(slept).toBe(true);
    expect(woke).toBe(true);
  });
});

describe('joints', () => {
  it('a rod pivoted at one end swings with T = 2π√(2L/3g)', () => {
    const L = 1.2;
    const theta0 = 4 * DEG;
    const dir = new Vec2(Math.sin(theta0), -Math.cos(theta0));
    const world = new RigidWorld({
      gravity,
      bodies: [{ shape: box(0.02, L), position: dir.scale(L / 2), angle: theta0 }],
      joints: ([rod], ground) => [new RevoluteJoint(ground, rod, Vec2.ZERO)],
    });
    const dt = 1 / 960;
    const crossings: number[] = [];
    let prev = world.bodies[0].x;
    while (crossings.length < 3) {
      world.step(dt);
      const x = world.bodies[0].x;
      if (prev > 0 && x <= 0) crossings.push(world.t - dt * (x / (x - prev)));
      prev = x;
    }
    // Small-amplitude correction for 4°: T ≈ T₀(1 + θ₀²/16).
    const expected = 2 * Math.PI * Math.sqrt((2 * L) / (3 * g)) * (1 + theta0 ** 2 / 16);
    expect((crossings[2] - crossings[0]) / 2 / expected).toBeCloseTo(1, 3);
  });

  it('a whipping chain keeps its pins together and its energy', () => {
    const links = 6;
    const bodies: RigidBodySpec[] = [];
    // One collision group: links pass through each other, so any energy change is solver error.
    for (let i = 0; i < links; i++) bodies.push({ shape: box(0.5, 0.05), position: new Vec2(0.25 + 0.5 * i, 0), group: 1 });
    const world = new RigidWorld({
      gravity,
      reference: new Vec2(0, -3),
      bodies,
      joints: (bs, ground) => [
        new RevoluteJoint(ground, bs[0], Vec2.ZERO),
        ...bs.slice(1).map((b, i) => new RevoluteJoint(bs[i], b, new Vec2(0.5 * (i + 1), 0))),
      ],
    });
    let worst = 0;
    for (let i = 0; i < 5 * 480; i++) {
      world.step(1 / 480);
      worst = Math.max(worst, Math.abs(world.energyDrift()));
    }
    for (const j of world.joints) {
      const [p, q] = j.anchors();
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.01);
    }
    expect(worst).toBeLessThan(5e-3);
  });

  it('a motor spins a wheel up and its work is booked', () => {
    const world = new RigidWorld({
      gravity,
      bodies: [{ shape: circle(0.5), position: Vec2.ZERO, mass: 2 }],
      joints: ([wheel], ground) => [new RevoluteJoint(ground, wheel, Vec2.ZERO, { motorSpeed: 6, maxMotorTorque: 1 })],
    });
    run(world, 0.5);
    const wheel = world.bodies[0];
    // I = ½·m·r² = 0.25 kg·m²; torque 1 N·m → α = 4 rad/s², so after 0.5 s ω = 2 rad/s (still accelerating).
    expect(wheel.omega).toBeCloseTo(2, 3);
    run(world, 2);
    expect(wheel.omega).toBeCloseTo(6, 6); // reached the target speed
    // Work = torque × angle turned. Semi-implicit Euler turns the wheel by the
    // already-updated ω each step, so during spin-up it books ½·τ·ω·dt more
    // than the kinetic energy gained: 0.0125 J here.
    const dt = 1 / 240;
    expect(world.externalWork).toBeCloseTo(0.5 * 0.25 * 36 + 0.5 * 1 * 6 * dt, 6);
  });

  it('a distance joint is a massless rod', () => {
    const world = new RigidWorld({
      gravity,
      bodies: [{ shape: circle(0.05), position: new Vec2(1, 0), fixedRotation: true }],
      joints: ([bob], ground) => [new DistanceJoint(ground, bob, Vec2.ZERO, new Vec2(1, 0))],
    });
    run(world, 3);
    expect(Math.hypot(world.bodies[0].x, world.bodies[0].y)).toBeCloseTo(1, 2);
  });
});

describe('pointer dragging', () => {
  it('books the work of the hand so the balance still holds', () => {
    const world = new RigidWorld({
      gravity,
      bodies: [
        { shape: box(20, 1), position: new Vec2(0, -0.5), static: true },
        { shape: box(1, 1), position: new Vec2(0, 0.5), mass: 2 },
      ],
    });
    expect(world.grabAt(new Vec2(0.2, 0.7), 0.01)).toBe(true);
    world.dragTo(new Vec2(0.2, 2.7));
    run(world, 1);
    world.release();
    run(world, 2);
    expect(world.externalWork).toBeGreaterThan(30); // lifted ~2 m and dropped: m·g·h ≈ 39 J put in
    expect(world.hitTest(new Vec2(50, 50), 0.01)).toBe(false);
  });
});
