import { describe, expect, it } from 'vitest';
import { Vec2 } from '../core/vec2';
import { FlowWorld, startingPoiseuille } from './lbm';

/** Channel 2 mm wide filled with water, driven by a pressure gradient. */
function poiseuille(tau: number, ny = 20) {
  const H = 2e-3;
  const dx = H / ny;
  const nu = 1e-6;
  const dt = ((tau - 0.5) / 3) * (dx * dx) / nu;
  const uMax = 5e-3;
  const g = (8 * nu * uMax) / (H * H);
  const flow = new FlowWorld({ nx: 4, ny, spacing: dx, dt, viscosity: nu, boundary: 'periodic', force: new Vec2(g, 0) });
  return { flow, H, nu, g, uMax, dt };
}

describe('Poiseuille flow', () => {
  it.each([0.6, 0.9, 2])('settles into the exact parabola u = g·s(H − s)/2ν (τ = %s)', (tau) => {
    const { flow, H, nu, g, uMax, dt } = poiseuille(tau);
    const settle = (8 * H * H) / nu;
    for (let k = 0, n = Math.ceil(settle / dt); k < n; k++) flow.step(dt);
    const profile = flow.profile(1);
    let worst = 0;
    profile.forEach((u, j) => {
      const s = (j + 0.5) * flow.spacing;
      worst = Math.max(worst, Math.abs(u - (g / (2 * nu)) * s * (H - s)));
    });
    expect(worst / uMax).toBeLessThan(1e-3);
  });

  it('starts from rest as the diffusion series predicts', () => {
    const { flow, H, nu, g, uMax, dt } = poiseuille(0.9, 30);
    const t = (0.05 * H * H) / nu;
    for (let k = 0, n = Math.round(t / dt); k < n; k++) flow.step(dt);
    const profile = flow.profile(1);
    let worst = 0;
    profile.forEach((u, j) => {
      worst = Math.max(worst, Math.abs(u - startingPoiseuille((j + 0.5) * flow.spacing, flow.t, H, nu, g)));
    });
    expect(worst / uMax).toBeLessThan(0.01);
  });

  it('conserves mass exactly in a closed channel', () => {
    const { flow, dt } = poiseuille(0.7);
    const m0 = flow.totalMass();
    for (let k = 0; k < 2000; k++) flow.step(dt);
    expect(Math.abs(flow.totalMass() / m0 - 1)).toBeLessThan(1e-12);
  });
});

describe('flow past a cylinder', () => {
  it('sheds a von Kármán vortex street at Strouhal number ≈ 0.2 (Re = 100)', () => {
    // Lattice units: dx = dt = 1, so speeds are fractions of a cell per step.
    const D = 20;
    const U = 0.1;
    const Re = 100;
    const cx = 60;
    const cy = 50.7; // slightly off-centre, so the symmetric wake breaks quickly
    const flow = new FlowWorld({
      nx: 260,
      ny: 100,
      spacing: 1,
      dt: 1,
      viscosity: (U * D) / Re,
      density: 1,
      thickness: 1,
      center: new Vec2(130, 50),
      boundary: 'channel',
      inflow: U,
      solid: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < (D / 2) ** 2,
    });
    const lift: number[] = [];
    let drag = 0;
    const total = 14000;
    const record = 6000;
    for (let k = 0; k < total; k++) {
      flow.step(1);
      if (k >= total - record) {
        lift.push(flow.dragY);
        drag += flow.dragX / record;
      }
    }
    const mean = lift.reduce((a, b) => a + b, 0) / lift.length;
    const crossings: number[] = [];
    for (let k = 1; k < lift.length; k++) if (lift[k - 1] < mean && lift[k] >= mean) crossings.push(k);
    const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    const strouhal = D / (period * U);
    const dragCoefficient = drag / (0.5 * U * U * D);
    expect(crossings.length).toBeGreaterThan(3);
    expect(strouhal).toBeGreaterThan(0.15);
    expect(strouhal).toBeLessThan(0.24);
    expect(dragCoefficient).toBeGreaterThan(1.2);
    expect(dragCoefficient).toBeLessThan(2.2);
  }, 60000);
});
