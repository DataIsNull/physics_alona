import { describe, expect, it } from 'vitest';
import { COULOMB, ELECTRON_MASS, ELEMENTARY_CHARGE, PROTON_MASS, VACUUM_PERMEABILITY } from '../core/units';
import { Vec2 } from '../core/vec2';
import { ChargeWorld, traceFieldLine } from './charges';

const e = ELEMENTARY_CHARGE;

describe('Lorentz force', () => {
  it('a proton in a magnetic field circles with r = mv/(qB) and T = 2πm/(qB), keeping its speed', () => {
    const B = 1;
    const v = 1e6;
    const r = (PROTON_MASS * v) / (e * B);
    const T = (2 * Math.PI * PROTON_MASS) / (e * B);
    const sim = new ChargeWorld({
      law: 'none',
      fields: [{ B }],
      particles: [{ pos: Vec2.ZERO, vel: new Vec2(v, 0), q: e, mass: PROTON_MASS, radius: 1e-4 }],
    });
    const steps = 400;
    let far = 0;
    for (let k = 0; k < 3 * steps; k++) {
      sim.step(T / steps);
      far = Math.max(far, Math.hypot(sim.x[0], sim.y[0]));
    }
    // Positive charge, B out of the screen: clockwise, so the circle's centre is below the start.
    expect(far / (2 * r)).toBeCloseTo(1, 4);
    expect(Math.hypot(sim.x[0], sim.y[0]) / r).toBeLessThan(1e-9);
    expect(Math.abs(sim.speed(0) / v - 1)).toBeLessThan(1e-12);
  });

  it('crossed E and B make a charge drift at E/B along E×B (a cycloid)', () => {
    const B = 0.5;
    const E = 2e4;
    const T = (2 * Math.PI * PROTON_MASS) / (e * B);
    const sim = new ChargeWorld({
      law: 'none',
      fields: [{ B, E: new Vec2(0, E) }],
      particles: [{ pos: Vec2.ZERO, q: e, mass: PROTON_MASS, radius: 1e-4 }],
    });
    for (let k = 0; k < 5 * 200; k++) sim.step(T / 200);
    // From rest the path is a cycloid; after whole turns the charge is back at rest, E·T/B along x.
    expect(sim.x[0] / ((5 * E * T) / B)).toBeCloseTo(1, 3);
    expect(Math.abs(sim.y[0]) / ((E * T) / B)).toBeLessThan(1e-3);
    expect(sim.speed(0) / (E / B)).toBeLessThan(0.01);
  });

  it('an electron between charged plates follows the parabola y = (eE/2m)(x/v)²', () => {
    const E = 1e4;
    const v = 2e7;
    const L = 0.05;
    const sim = new ChargeWorld({
      law: 'none',
      fields: [{ min: new Vec2(0, -0.01), max: new Vec2(L, 0.01), E: new Vec2(0, -E) }],
      particles: [{ pos: new Vec2(0, 0), vel: new Vec2(v, 0), q: -e, mass: ELECTRON_MASS, radius: 1e-4 }],
    });
    const time = L / v;
    for (let k = 0; k < 1000; k++) sim.step(time / 1000);
    const expected = ((e * E) / (2 * ELECTRON_MASS)) * time * time;
    expect(sim.y[0] / expected).toBeCloseTo(1, 6);
    // The field's work on the electron is booked: the energy books balance.
    expect(Math.abs(sim.energyDrift())).toBeLessThan(1e-9);
  });
});

describe('Coulomb law', () => {
  it('the field of a point charge is k·q/r² and its potential k·q/r', () => {
    const q = 1e-9;
    const sim = new ChargeWorld({ particles: [{ pos: Vec2.ZERO, q, mass: 1, radius: 1e-3, fixed: true }] });
    const [ex, ey] = sim.particleField(0.03, 0.04);
    expect(Math.hypot(ex, ey) / ((COULOMB * q) / 0.05 ** 2)).toBeCloseTo(1, 12);
    expect(ex / ey).toBeCloseTo(0.75, 12);
    expect(sim.potentialAt(0.03, 0.04) / ((COULOMB * q) / 0.05)).toBeCloseTo(1, 12);
  });

  it('two like charges fly apart, turning k·q²/r₀ into kinetic energy', () => {
    const q = 1e-7;
    const m = 1e-3;
    const r0 = 0.02;
    const sim = new ChargeWorld({
      particles: [
        { pos: new Vec2(-r0 / 2, 0), q, mass: m, radius: 1e-3 },
        { pos: new Vec2(r0 / 2, 0), q, mass: m, radius: 1e-3 },
      ],
    });
    for (let k = 0; k < 20000; k++) sim.step(1e-4);
    const r = sim.x[1] - sim.x[0];
    const expected = Math.sqrt(((COULOMB * q * q) / r0 - (COULOMB * q * q) / r) / m);
    expect(sim.speed(1) / expected).toBeCloseTo(1, 4);
    expect(sim.vx[0] + sim.vx[1]).toBeCloseTo(0, 12);
    expect(Math.abs(sim.energyDrift())).toBeLessThan(1e-5);
  });

  it('a light charge orbits an opposite one with Kepler’s period 2π√(m·a³/(k|qQ|))', () => {
    const Q = 1e-8;
    const q = -1e-9;
    const m = 1e-6;
    const r = 0.05;
    const v = Math.sqrt((COULOMB * Q * -q) / (m * r));
    const T = 2 * Math.PI * Math.sqrt((m * r ** 3) / (COULOMB * Q * -q));
    const sim = new ChargeWorld({
      particles: [
        { pos: Vec2.ZERO, q: Q, mass: 1, radius: 2e-3, fixed: true },
        { pos: new Vec2(r, 0), vel: new Vec2(0, v), q, mass: m, radius: 1e-3 },
      ],
    });
    for (let k = 0; k < 2000; k++) sim.step(T / 2000);
    expect(Math.hypot(sim.x[1] - r, sim.y[1]) / r).toBeLessThan(1e-3);
    expect(Math.abs(sim.energyDrift())).toBeLessThan(1e-6);
  });
});

describe('Ampère force', () => {
  it('parallel currents attract and antiparallel repel with F/L = μ₀I₁I₂/(2πd)', () => {
    const I = 100;
    const d = 0.01;
    const lambda = 0.01; // kg per metre
    for (const sign of [1, -1]) {
      const sim = new ChargeWorld({
        law: 'ampere',
        particles: [
          { pos: new Vec2(0, 0), q: I, mass: lambda, radius: 1e-3, fixed: true },
          { pos: new Vec2(d, 0), q: sign * I, mass: lambda, radius: 1e-3 },
        ],
      });
      const dt = 1e-6;
      sim.step(dt);
      const accel = sim.vx[1] / dt;
      expect(accel / ((-sign * VACUUM_PERMEABILITY * I * I) / (2 * Math.PI * d * lambda))).toBeCloseTo(1, 4);
    }
  });

  it('a current’s magnetic field circles it at μ₀I/(2πr), and its field lines close', () => {
    const I = 10;
    const sim = new ChargeWorld({ law: 'ampere', particles: [{ pos: Vec2.ZERO, q: I, mass: 1, radius: 1e-3, fixed: true }] });
    const [bx, by] = sim.particleField(0.02, 0);
    expect(bx).toBeCloseTo(0, 15);
    expect(by / ((VACUUM_PERMEABILITY * I) / (2 * Math.PI * 0.02))).toBeCloseTo(1, 12);
    const line = traceFieldLine((x, y) => sim.particleField(x, y), new Vec2(0.02, 0), 0.0005, 2000, () => false);
    expect(line.length).toBeLessThan(2000);
    for (const p of line) expect(Math.abs(Math.hypot(p.x, p.y) / 0.02 - 1)).toBeLessThan(1e-3);
  });
});
