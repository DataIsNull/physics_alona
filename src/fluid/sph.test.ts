import { describe, expect, it } from 'vitest';
import { Vec2 } from '../core/vec2';
import { EARTH_GRAVITY, SphWorld, fillLattice, wallLattice, type BodyOptions } from './sph';

const DX = 0.02;
const g = EARTH_GRAVITY;

function run(world: SphWorld, seconds: number): void {
  for (let k = 0, n = Math.round(seconds * 60); k < n; k++) world.step(1 / 60);
}

/** Open-topped tank [0, W] × [0, ∞) with water up to `depth`. */
function tank(W: number, depth: number, extra: { bodies?: BodyOptions[]; viscosity?: number } = {}) {
  const solid = (x: number, y: number) => x < 0 || x > W || y < 0;
  return new SphWorld({
    spacing: DX,
    fluid: fillLattice(new Vec2(0, 0), new Vec2(W, depth), DX, () => true),
    walls: wallLattice(new Vec2(-4 * DX, -4 * DX), new Vec2(W + 4 * DX, depth + 0.4), DX, solid),
    ...extra,
  });
}

describe('SPH basics', () => {
  it('a free blob keeps zero momentum, its angular momentum and its energy', () => {
    const fluid = fillLattice(new Vec2(-0.2, -0.2), new Vec2(0.2, 0.2), DX, () => true);
    const sph = new SphWorld({ spacing: DX, fluid, walls: [], gravity: 0, soundSpeed: 10, viscosity: 0 });
    // Spin it like a rigid wheel, 2 rad/s.
    for (let i = 0; i < sph.nFluid; i++) {
      sph.vx[i] = -2 * sph.y[i];
      sph.vy[i] = 2 * sph.x[i];
    }
    const angular = () => {
      let L = 0;
      for (let i = 0; i < sph.nFluid; i++) L += sph.x[i] * sph.vy[i] - sph.y[i] * sph.vx[i];
      return L;
    };
    const L0 = angular();
    const E0 = sph.totalEnergy();
    run(sph, 1);
    let px = 0;
    let py = 0;
    for (let i = 0; i < sph.nFluid; i++) {
      px += sph.vx[i];
      py += sph.vy[i];
    }
    expect(Math.hypot(px, py) / sph.nFluid).toBeLessThan(1e-12);
    expect(Math.abs(angular() / L0 - 1)).toBeLessThan(1e-9);
    expect(Math.abs((sph.totalEnergy() + sph.dissipated - E0) / E0)).toBeLessThan(5e-3);
  });

  it('water at rest stays at rest with pressure ρ·g·depth', () => {
    const depth = 0.4;
    const sph = tank(0.4, depth);
    run(sph, 1);
    expect(sph.maxSpeed()).toBeLessThan(0.05);
    for (const d of [0.1, 0.2, 0.3]) {
      const p = sph.pressureAt(new Vec2(0.2, depth - d));
      expect(p / (1000 * g * d)).toBeGreaterThan(0.95);
      expect(p / (1000 * g * d)).toBeLessThan(1.05);
    }
  }, 30000);

  it('a collapsing water column books its lost energy as heat', () => {
    const W = 1.2;
    const solid = (x: number, y: number) => x < 0 || x > W || y < 0;
    const sph = new SphWorld({
      spacing: DX,
      fluid: fillLattice(new Vec2(0, 0), new Vec2(0.3, 0.45), DX, () => true),
      walls: wallLattice(new Vec2(-4 * DX, -4 * DX), new Vec2(W + 4 * DX, 0.8), DX, solid),
    });
    run(sph, 1.5);
    // Much of the drop's energy is gone into heat, yet the books balance to under a per cent.
    expect(sph.dissipated / sph.initialEnergy).toBeGreaterThan(0.1);
    expect(Math.abs(sph.energyDrift())).toBeLessThan(0.01);
  }, 30000);
});

describe('hydrostatics', () => {
  it('Archimedes: a box half as dense as water floats half submerged, with buoyancy equal to its weight', () => {
    const depth = 0.4;
    const size = 0.2;
    const sph = tank(0.8, depth, { bodies: [{ width: size, height: size, position: new Vec2(0.4, depth), density: 500, color: '#fff' }] });
    run(sph, 2.5);
    let fraction = 0;
    let force = 0;
    const samples = 60;
    for (let k = 0; k < samples; k++) {
      sph.step(1 / 60);
      const b = sph.bodies[0];
      const level = (sph.surfaceIn(0.04, 0.24) + sph.surfaceIn(0.56, 0.76)) / 2;
      fraction += (level - (b.y - b.height / 2)) / b.height / samples;
      force += sph.buoyancy(b) / sph.weight(b) / samples;
    }
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.6);
    expect(Math.abs(force - 1)).toBeLessThan(0.05);
  }, 60000);

  it('a box denser than water sinks to the bottom', () => {
    const sph = tank(0.8, 0.4, { bodies: [{ width: 0.2, height: 0.2, position: new Vec2(0.4, 0.4), density: 2500, color: '#fff' }] });
    run(sph, 2.5);
    const b = sph.bodies[0];
    expect(b.y - b.height / 2).toBeLessThan(0.05);
    expect(Math.abs(b.vy)).toBeLessThan(0.05);
  }, 60000);

  it('communicating vessels end up at one level', () => {
    // Two arms joined at the bottom; the left one starts much fuller.
    const solid = (x: number, y: number) => x < 0 || x > 0.6 || y < 0 || (y > 0.1 && x > 0.2 && x < 0.4);
    const water = (x: number, y: number) => !solid(x, y) && (y < 0.1 || (x < 0.2 ? y < 0.5 : y < 0.2));
    const sph = new SphWorld({
      spacing: DX,
      fluid: fillLattice(new Vec2(0, 0), new Vec2(0.6, 0.6), DX, water),
      walls: wallLattice(new Vec2(-4 * DX, -4 * DX), new Vec2(0.6 + 4 * DX, 0.7), DX, solid),
      viscosity: 2e-3,
    });
    run(sph, 4);
    const left = sph.surfaceIn(0.02, 0.18);
    const right = sph.surfaceIn(0.42, 0.58);
    expect(Math.abs(left - right)).toBeLessThan(DX / 2);
    expect(Math.abs((left + right) / 2 - 0.35)).toBeLessThan(DX);
  }, 60000);
});

describe('narrow tubes', () => {
  it('with walls that take the water’s pressure, a narrow tube comes to the level of a wide vessel', () => {
    const dx = 0.04;
    // A wide vessel and a tube four particles across, joined at the bottom; the vessel starts much fuller.
    const solid = (x: number, y: number) => x < 0 || y < 0 || x > 1.16 || (y > 0.2 && x > 0.8 && x < 1.0);
    const water = (x: number, y: number) => y < 0.2 || (x < 0.8 ? y < 1.0 : y < 0.4);
    const sph = new SphWorld({
      spacing: dx,
      fluid: fillLattice(new Vec2(-0.2, -0.2), new Vec2(1.4, 1.4), dx, (x, y) => !solid(x, y) && water(x, y)),
      walls: wallLattice(new Vec2(-0.2, -0.2), new Vec2(1.4, 1.4), dx, solid),
      wallModel: 'pressure',
    });
    run(sph, 5);
    expect(Math.abs(sph.surfaceIn(dx, 0.8 - dx) - sph.surfaceIn(1.0, 1.16))).toBeLessThan(dx / 2);
  }, 60000);
});

describe('Torricelli', () => {
  it('the jet leaves a hole at about √(2·g·h)', () => {
    // A tank on a stand with a hole low in its right wall; the jet lands on the floor.
    const base = 0.4;
    const hole = [base, base + 4 * DX];
    const opening = (y: number) => y > hole[0] && y < hole[1];
    const solid = (x: number, y: number) =>
      y < 0 ||
      x < -0.6 ||
      x > 2 ||
      (Math.abs(x) <= 0.36 && y >= base - 0.06 && y <= base) ||
      (x >= -0.36 && x <= -0.3 && y >= base) ||
      (x >= 0.3 && x <= 0.36 && y >= base && !opening(y));
    const water = (x: number, y: number) => x > -0.3 && x < 0.3 && y > base && y < base + 0.5;
    const sph = new SphWorld({
      spacing: DX,
      fluid: fillLattice(new Vec2(-0.3, base), new Vec2(0.3, base + 0.5), DX, water),
      walls: wallLattice(new Vec2(-0.7, -4 * DX), new Vec2(2.1, base + 0.7), DX, solid),
    });
    run(sph, 0.3);
    const ratios: number[] = [];
    for (let k = 0; k < 30; k++) {
      sph.step(1 / 60);
      // Speed just outside the wall, where the jet has finished contracting.
      let v = 0;
      let count = 0;
      for (let i = 0; i < sph.nFluid; i++) {
        if (sph.x[i] > 0.36 && sph.x[i] < 0.44 && sph.y[i] > hole[0] - 0.1 && sph.y[i] < hole[1]) {
          v += Math.hypot(sph.vx[i], sph.vy[i]);
          count++;
        }
      }
      const h = sph.surfaceIn(-0.28, 0.28) - (hole[0] + hole[1]) / 2;
      if (count > 0) ratios.push(v / count / Math.sqrt(2 * g * h));
    }
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    // Coarse particles are more viscous than water: the jet keeps 80–90 % of the ideal speed.
    expect(mean).toBeGreaterThan(0.75);
    expect(mean).toBeLessThan(1);
  }, 60000);
});
