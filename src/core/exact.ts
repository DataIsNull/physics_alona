// Closed-form solutions used as ghosts in scenes and as references in tests.

import { Vec2 } from './vec2';

const MAX_AGM_STEPS = 64;

/** Arithmetic–geometric mean of a and b. */
function agm(a: number, b: number): number {
  for (let i = 0; i < MAX_AGM_STEPS && Math.abs(a - b) > 1e-15 * a; i++) {
    [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  }
  return a;
}

/** Complete elliptic integral of the first kind K(m), with parameter m = k². */
export function ellipticK(m: number): number {
  return Math.PI / (2 * agm(1, Math.sqrt(1 - m)));
}

/** Jacobi elliptic function sn(u | m) via the descending Landen (AGM) scheme, A&S 16.4. */
export function jacobiSn(u: number, m: number): number {
  const a = [1];
  const c = [Math.sqrt(m)];
  let b = Math.sqrt(1 - m);
  let n = 0;
  while (Math.abs(c[n]) > 1e-15 * a[n] && n < MAX_AGM_STEPS) {
    a.push((a[n] + b) / 2);
    c.push((a[n] - b) / 2);
    b = Math.sqrt(a[n] * b);
    n++;
  }
  let phi = 2 ** n * a[n] * u;
  for (let i = n; i >= 1; i--) phi = (phi + Math.asin((c[i] / a[i]) * Math.sin(phi))) / 2;
  return Math.sin(phi);
}

/**
 * Angle of an undamped pendulum released from rest at θ₀ (any amplitude):
 * θ(t) = 2·asin(k·sn(K − ω₀t | k²)), with k = sin(θ₀/2) and ω₀ = √(g/L).
 */
export function pendulumAngle(theta0: number, omega0: number, t: number): number {
  const k = Math.sin(theta0 / 2);
  const m = k * k;
  return 2 * Math.asin(k * jacobiSn(ellipticK(m) - omega0 * t, m));
}

/** Pendulum period T = 4K(k²)/ω₀; tends to 2π/ω₀ for small amplitudes. */
export function pendulumPeriod(theta0: number, omega0: number): number {
  return (4 * ellipticK(Math.sin(theta0 / 2) ** 2)) / omega0;
}

/**
 * Projectile under gravity g (pointing down) with linear drag F = −b·v,
 * time constant τ = m/b. Starts at the origin.
 */
export function linearDragPosition(v0: Vec2, g: number, tau: number, t: number): Vec2 {
  const decay = tau * (1 - Math.exp(-t / tau));
  return new Vec2(v0.x * decay, (v0.y + g * tau) * decay - g * tau * t);
}

/**
 * Solves Kepler's equation E − e·sin E = M for the eccentric anomaly E
 * (Newton's method; continuous in M across whole turns).
 */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  const wrapped = Math.atan2(Math.sin(meanAnomaly), Math.cos(meanAnomaly));
  let E = e < 0.8 ? wrapped : Math.sign(wrapped || 1) * Math.PI;
  for (let i = 0; i < 60; i++) {
    const step = (E - e * Math.sin(E) - wrapped) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-15) break;
  }
  return E + (meanAnomaly - wrapped);
}

export interface OrbitalElements {
  /** Semi-major axis, m. */
  a: number;
  /** Eccentricity, 0 ≤ e < 1. */
  e: number;
  /** Longitude of periapsis ϖ (direction of closest approach), rad. */
  periapsis: number;
  /** Mean anomaly at t = 0, rad. */
  meanAnomaly: number;
}

/** Orbital period T = 2π√(a³/μ), μ = G(M + m). */
export function orbitalPeriod(a: number, mu: number): number {
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

/**
 * Position and velocity on a Keplerian ellipse, relative to the attracting
 * body, at time t (exact two-body solution).
 */
export function keplerState(el: OrbitalElements, mu: number, t: number): { pos: Vec2; vel: Vec2 } {
  const { a, e } = el;
  const n = Math.sqrt(mu / (a * a * a));
  const E = eccentricAnomaly(el.meanAnomaly + n * t, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const rate = n / (1 - e * cosE); // dE/dt
  const local = new Vec2(a * (cosE - e), b * sinE);
  const localVel = new Vec2(-a * sinE * rate, b * cosE * rate);
  return { pos: local.rotate(el.periapsis), vel: localVel.rotate(el.periapsis) };
}

/**
 * Lagrange points L1…L5 of masses m1 and m2 on a circular orbit of radius a,
 * in the co-rotating frame centred on the barycentre: m1 sits at (−μa, 0)
 * and m2 at ((1 − μ)a, 0) with μ = m2/(m1 + m2).
 */
export function lagrangePoints(m1: number, m2: number, a: number): Vec2[] {
  const mu = m2 / (m1 + m2);
  // Net force along the x-axis in units a = 1, G(m1 + m2) = 1, Ω = 1.
  const f = (x: number) =>
    x - ((1 - mu) * (x + mu)) / Math.abs(x + mu) ** 3 - (mu * (x - 1 + mu)) / Math.abs(x - 1 + mu) ** 3;
  const root = (lo: number, hi: number) => {
    const sign = Math.sign(f(lo));
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (Math.sign(f(mid)) === sign) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const tiny = 1e-9;
  const L1 = root(-mu + tiny, 1 - mu - tiny);
  const L2 = root(1 - mu + tiny, 2);
  const L3 = root(-2, -mu - tiny);
  const h = Math.sqrt(3) / 2;
  return [
    new Vec2(L1 * a, 0),
    new Vec2(L2 * a, 0),
    new Vec2(L3 * a, 0),
    new Vec2((0.5 - mu) * a, h * a),
    new Vec2((0.5 - mu) * a, -h * a),
  ];
}
