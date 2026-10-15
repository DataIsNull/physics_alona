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
