import { describe, expect, it } from 'vitest';
import {
  type OrbitalElements,
  eccentricAnomaly,
  keplerState,
  lagrangePoints,
  orbitalPeriod,
} from './exact';
import type { Force } from './forces';
import {
  BarnesHutGravity,
  NewtonianGravity,
  PointMassField,
  RelativisticCorrection,
  RotatingFrame,
  gravityTimestep,
} from './gravity';
import { createIntegrator, type IntegratorId } from './integrators';
import { type ParticleSpec, Particles } from './particles';
import { AU, DAY, G, SOLAR_MASS, SPEED_OF_LIGHT, YEAR } from './units';
import { Vec2 } from './vec2';
import { World } from './world';

const MU_SUN = G * SOLAR_MASS;

describe('Kepler problem, exact', () => {
  it.each([0, 0.3, 0.9, 0.99])('eccentric anomaly solves E − e·sin E = M (e = %d)', (e) => {
    for (const M of [-3, 0.1, 2, 10, 100]) {
      const E = eccentricAnomaly(M, e);
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 11);
    }
  });

  it('state vectors obey vis-viva and conserve angular momentum', () => {
    const el: OrbitalElements = { a: AU, e: 0.6, periapsis: 0.7, meanAnomaly: 0 };
    for (const t of [0, 0.1 * YEAR, 0.37 * YEAR]) {
      const { pos, vel } = keplerState(el, MU_SUN, t);
      expect((vel.lengthSq() / 2 - MU_SUN / pos.length()) / (-MU_SUN / (2 * AU))).toBeCloseTo(1, 12);
      expect(pos.cross(vel) / Math.sqrt(MU_SUN * AU * (1 - 0.36))).toBeCloseTo(1, 12);
    }
  });
});

/** Star plus one light planet, set up around their barycentre. */
function twoBody(el: OrbitalElements, integrator: IntegratorId = 'velocity-verlet', planetMass = 3e-6 * SOLAR_MASS) {
  const mu = G * (SOLAR_MASS + planetMass);
  const { pos, vel } = keplerState(el, mu, 0);
  const fStar = planetMass / (SOLAR_MASS + planetMass);
  const world = new World({
    integrator,
    forces: [new NewtonianGravity()],
    particles: [
      { pos: pos.scale(-fStar), vel: vel.scale(-fStar), mass: SOLAR_MASS },
      { pos: pos.scale(1 - fStar), vel: vel.scale(1 - fStar), mass: planetMass },
    ],
  });
  const relative = () => world.particles.position(1).sub(world.particles.position(0));
  return { world, mu, relative };
}

function run(world: World, seconds: number, dt: number): void {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) world.step(dt);
}

/** Time between successive crossings of the +x axis (counter-clockwise), s. */
function measurePeriod(world: World, relative: () => Vec2, dt: number): number {
  const crossings: number[] = [];
  let prev = relative();
  while (crossings.length < 2) {
    world.step(dt);
    const now = relative();
    if (prev.y < 0 && now.y >= 0 && now.x > 0) crossings.push(world.t - dt * (now.y / (now.y - prev.y)));
    prev = now;
  }
  return crossings[1] - crossings[0];
}

describe('two-body orbits', () => {
  it('velocity Verlet follows the exact ellipse for 10 orbits', () => {
    const el: OrbitalElements = { a: AU, e: 0.6, periapsis: 0, meanAnomaly: 0 };
    const { world, mu, relative } = twoBody(el);
    run(world, 10 * orbitalPeriod(AU, mu), 0.05 * DAY);
    const exact = keplerState(el, mu, world.t).pos;
    expect(relative().distanceTo(exact) / AU).toBeLessThan(2e-3);
    expect(Math.abs(world.energyDrift())).toBeLessThan(1e-5);
  });

  it('third law: quadrupling a multiplies the period by 8', () => {
    const near = twoBody({ a: AU, e: 0, periapsis: 0, meanAnomaly: 0 });
    const far = twoBody({ a: 4 * AU, e: 0, periapsis: 0, meanAnomaly: 0 });
    const tNear = measurePeriod(near.world, near.relative, 0.05 * DAY);
    const tFar = measurePeriod(far.world, far.relative, 0.2 * DAY);
    expect(tNear / orbitalPeriod(AU, near.mu)).toBeCloseTo(1, 5);
    expect(tFar / tNear).toBeCloseTo(8, 4);
  });

  it('direct-sum gravity conserves momentum to round-off (Newton’s third law)', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const specs: ParticleSpec[] = Array.from({ length: 20 }, () => ({
      pos: new Vec2(random() * 2e11, random() * 2e11),
      vel: new Vec2(random() * 1e4, random() * 1e4),
      mass: 1e28 * (0.5 + random()),
    }));
    const world = new World({ integrator: 'leapfrog', forces: [new NewtonianGravity(1e9)], particles: specs });
    const p0 = world.momentum();
    run(world, 200 * DAY, DAY);
    expect(world.momentum().distanceTo(p0) / p0.length()).toBeLessThan(1e-12);
  });
});

describe('Barnes–Hut', () => {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const n = 400;
  const particles = new Particles(
    Array.from({ length: n }, () => ({ pos: new Vec2(random() - 0.5, random() - 0.5).scale(1e20), mass: 1e30 * (0.1 + random()) })),
  );
  const accel = (force: Force) => {
    const acc = new Float64Array(2 * n);
    force.apply(particles, particles.pos, particles.vel, 0, acc);
    return acc;
  };
  const direct = accel(new NewtonianGravity(1e18));

  it('θ = 0 reproduces the direct sum', () => {
    const exact = accel(new BarnesHutGravity(0, 1e18));
    for (let k = 0; k < 2 * n; k++) expect(exact[k]).toBeCloseTo(direct[k], -Math.log10(Math.abs(direct[k]) * 1e-10));
    const u = new NewtonianGravity(1e18).potential(particles, particles.pos);
    expect(new BarnesHutGravity(0, 1e18).potential(particles, particles.pos) / u).toBeCloseTo(1, 10);
  });

  it('θ = 0.5 stays within a few percent of the typical acceleration', () => {
    const approx = accel(new BarnesHutGravity(0.5, 1e18));
    // Measured against the RMS acceleration: where forces nearly cancel, a
    // relative error per particle would blow up without meaning much.
    let rms = 0;
    for (let k = 0; k < 2 * n; k++) rms += direct[k] ** 2;
    rms = Math.sqrt(rms / n);
    const errors: number[] = [];
    for (let i = 0; i < n; i++) {
      errors.push(Math.hypot(approx[2 * i] - direct[2 * i], approx[2 * i + 1] - direct[2 * i + 1]) / rms);
    }
    errors.sort((a, b) => a - b);
    expect(errors[n / 2]).toBeLessThan(0.02);
    expect(errors[n - 1]).toBeLessThan(0.06);
  });
});

describe('restricted three-body problem (Sun–Jupiter, rotating frame)', () => {
  const m1 = SOLAR_MASS;
  const m2 = 1.898_13e27;
  const a = 5.2 * AU;
  const mu = m2 / (m1 + m2);
  const omega = Math.sqrt((G * (m1 + m2)) / a ** 3);
  const forces = () => [
    new PointMassField([
      { position: new Vec2(-mu * a, 0), mass: m1 },
      { position: new Vec2((1 - mu) * a, 0), mass: m2 },
    ]),
    new RotatingFrame(omega),
  ];
  const points = lagrangePoints(m1, m2, a);

  it('gravity and centrifugal force cancel at all five Lagrange points', () => {
    const scale = (G * m1) / a ** 2;
    const particles = new Particles(points.map((p) => ({ pos: p, mass: 1 })));
    const acc = new Float64Array(10);
    for (const f of forces()) f.apply(particles, particles.pos, particles.vel, 0, acc);
    for (let k = 0; k < 10; k++) expect(Math.abs(acc[k]) / scale).toBeLessThan(1e-9);
  });

  const period = (2 * Math.PI) / omega;
  /** Runs one test particle for 30 Jupiter years; returns its farthest distance from `from`. */
  function farthest(start: Vec2, from: Vec2): { distance: number; world: World } {
    const world = new World({ integrator: 'rk4', forces: forces(), particles: [{ pos: start, mass: 1 }] });
    let distance = 0;
    for (let i = 0, steps = Math.round((30 * period) / (0.01 * YEAR)); i < steps; i++) {
      world.step(0.01 * YEAR);
      distance = Math.max(distance, world.particles.position(0).distanceTo(from));
    }
    return { distance, world };
  }

  it('a Trojan near L4 librates around it and keeps its Jacobi integral', () => {
    // 8° ahead of L4 along the orbit, at rest in the rotating frame: a tadpole orbit.
    const { distance, world } = farthest(points[3].rotate(8 * (Math.PI / 180)), points[3]);
    expect(distance / a).toBeLessThan(0.2);
    expect(Math.abs(world.energyDrift())).toBeLessThan(1e-8);
  });

  it('a body nudged off L1 runs away', () => {
    const { distance } = farthest(points[0].add(new Vec2(1e-4 * a, 0)), points[0]);
    expect(distance / (1e-4 * a)).toBeGreaterThan(300);
  });
});

describe('general relativity', () => {
  it('perihelion advances by 6πGM/(c²a(1−e²)) per orbit', () => {
    const c = SPEED_OF_LIGHT / 100; // exaggerate 10⁴ times so it shows within a few orbits
    const a = 0.387_098 * AU;
    const e = 0.205_630;
    const { pos, vel } = keplerState({ a, e, periapsis: 0, meanAnomaly: 0 }, MU_SUN, 0);
    const world = new World({
      integrator: 'rk4',
      forces: [new PointMassField([{ position: Vec2.ZERO, mass: SOLAR_MASS }]), new RelativisticCorrection(Vec2.ZERO, SOLAR_MASS, c)],
      particles: [{ pos, vel, mass: 1 }],
    });
    /** Direction of the Laplace–Runge–Lenz vector: where the perihelion points. */
    const perihelion = () => {
      const r = world.particles.position(0);
      const v = world.particles.velocity(0);
      const L = r.cross(v);
      return Math.atan2(-v.x * L - (MU_SUN * r.y) / r.length(), v.y * L - (MU_SUN * r.x) / r.length());
    };
    const orbits = 10;
    run(world, orbits * orbitalPeriod(a, MU_SUN), 0.02 * DAY);
    const expected = (orbits * 6 * Math.PI * MU_SUN) / (c * c * a * (1 - e * e));
    expect(perihelion() / expected).toBeCloseTo(1, 1);
  });
});

describe('adaptive time stepping', () => {
  it('keeps a comet on course through perihelion', () => {
    // Halley-like: a = 17.8 AU, e = 0.967; one full orbit from aphelion.
    const el: OrbitalElements = { a: 17.8 * AU, e: 0.967, periapsis: 0, meanAnomaly: Math.PI };
    const orbit = (maxStep?: (w: World) => number) => {
      const { world, mu, relative } = twoBody(el, 'velocity-verlet', 1e14);
      if (maxStep) (world as unknown as { maxStep: typeof maxStep }).maxStep = maxStep;
      const dt = 5 * DAY;
      let peakEnergyError = 0;
      for (let i = 0, n = Math.round(orbitalPeriod(el.a, mu) / dt); i < n; i++) {
        world.step(dt);
        peakEnergyError = Math.max(peakEnergyError, Math.abs(world.energyDrift()));
      }
      return { peakEnergyError, miss: relative().distanceTo(keplerState(el, mu, world.t).pos) / AU };
    };
    const fixed = orbit();
    const adaptive = orbit(gravityTimestep(0.01));
    // Fixed steps: big energy excursion at perihelion and the comet ends up far off course…
    expect(fixed.peakEnergyError).toBeGreaterThan(0.05);
    expect(fixed.miss).toBeGreaterThan(0.1);
    // …adaptive sub-steps keep both small.
    expect(adaptive.peakEnergyError).toBeLessThan(fixed.peakEnergyError / 50);
    expect(adaptive.miss).toBeLessThan(fixed.miss / 50);
  });
});

describe('leapfrog', () => {
  it('moves exactly like velocity Verlet with one force evaluation per step', () => {
    const el: OrbitalElements = { a: AU, e: 0.3, periapsis: 0, meanAnomaly: 0 };
    const a = twoBody(el, 'velocity-verlet');
    const b = twoBody(el, 'leapfrog');
    run(a.world, YEAR, DAY);
    run(b.world, YEAR, DAY);
    expect(b.relative().distanceTo(a.relative()) / AU).toBeLessThan(1e-12);

    const integrator = createIntegrator('leapfrog');
    const pos = new Float64Array([1, 0]);
    const vel = new Float64Array([0, 1]);
    let calls = 0;
    for (let i = 0; i < 100; i++) {
      integrator.step(pos, vel, 0, 0.01, (p, _v, _t, out) => {
        calls++;
        out[0] = -p[0];
        out[1] = -p[1];
      });
    }
    expect(calls).toBe(101);
  });
});
