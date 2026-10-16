import { describe, expect, it } from 'vitest';
import { RailWorld } from './induction';

const base = { length: 0.5, mass: 0.2, resistance: 1, field: 1, end: 100 };

describe('electromagnetic induction', () => {
  it('a pushed rod brakes as v₀·e^(−t/τ), τ = mR/(B²L²), and all its energy becomes Joule heat', () => {
    const rail = new RailWorld({ ...base, speed: 2, position: 1 });
    const tau = (base.mass * base.resistance) / (base.field * base.length) ** 2;
    for (let k = 0; k < 300; k++) rail.step(0.01);
    expect(rail.v / (2 * Math.exp(-3 / tau))).toBeCloseTo(1, 10);
    expect(rail.dissipated + rail.kineticEnergy()).toBeCloseTo(0.5 * base.mass * 4, 12);
    expect(Math.abs(rail.energyDrift())).toBeLessThan(1e-12);
  });

  it('the EMF is minus the rate of change of flux, ε = B·L·v', () => {
    const rail = new RailWorld({ ...base, speed: 3, position: 1 });
    const dt = 1e-6;
    const before = rail.flux();
    const emf = rail.emf();
    rail.step(dt);
    expect((rail.flux() - before) / dt / emf).toBeCloseTo(1, 4);
    expect(rail.current()).toBeCloseTo(rail.emf() / base.resistance, 12);
  });

  it('under a steady pull the rod reaches F·R/(B²L²); the pull’s work goes into heat and motion', () => {
    const rail = new RailWorld({ ...base, pull: 0.5, position: 1 });
    for (let k = 0; k < 1000; k++) rail.step(0.01);
    expect(rail.v / rail.terminalSpeed).toBeCloseTo(1, 4);
    expect(rail.terminalSpeed).toBeCloseTo((0.5 * base.resistance) / (base.field * base.length) ** 2, 12);
    expect(rail.externalWork).toBeCloseTo(rail.dissipated + rail.kineticEnergy(), 9);
  });
});
