import { describe, expect, it } from 'vitest';
import { ellipticK, jacobiSn, pendulumAngle, pendulumPeriod } from './exact';

describe('elliptic functions', () => {
  it('K(m) matches reference values', () => {
    expect(ellipticK(0)).toBeCloseTo(Math.PI / 2, 15);
    expect(ellipticK(0.5)).toBeCloseTo(1.854_074_677_301_372, 13);
    expect(ellipticK(0.99)).toBeCloseTo(3.695_637_362_989_875, 12);
  });

  it('sn reduces to sin for m = 0 and reaches 1 at u = K', () => {
    for (const u of [0.3, 1.1, 2.5]) expect(jacobiSn(u, 0)).toBeCloseTo(Math.sin(u), 14);
    for (const m of [0.2, 0.7, 0.99]) expect(jacobiSn(ellipticK(m), m)).toBeCloseTo(1, 12);
  });
});

describe('exact pendulum', () => {
  it('period tends to 2π/ω₀ for small swings', () => {
    expect(pendulumPeriod(1e-4, 3)).toBeCloseTo((2 * Math.PI) / 3, 8);
  });

  it.each([10, 90, 170])('θ(t) solves θ″ = −ω₀² sin θ for θ₀ = %i°', (deg) => {
    // Reference: RK4 on the pendulum ODE with a tiny step.
    const theta0 = (deg * Math.PI) / 180;
    const omega0 = 2;
    const f = (th: number) => -omega0 * omega0 * Math.sin(th);
    let th = theta0;
    let w = 0;
    const h = 1e-4;
    for (let n = 1; n <= 30_000; n++) {
      const k1t = w;
      const k1w = f(th);
      const k2t = w + (h / 2) * k1w;
      const k2w = f(th + (h / 2) * k1t);
      const k3t = w + (h / 2) * k2w;
      const k3w = f(th + (h / 2) * k2t);
      const k4t = w + h * k3w;
      const k4w = f(th + h * k3t);
      th += (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
      w += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
      if (n % 5000 === 0) expect(pendulumAngle(theta0, omega0, n * h)).toBeCloseTo(th, 8);
    }
  });
});
