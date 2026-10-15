/**
 * Writes accelerations for the given state into `out`, overwriting it.
 * pos/vel may be temporary trial states rather than the live particle buffers.
 */
export type AccelFn = (pos: Float64Array, vel: Float64Array, t: number, out: Float64Array) => void;

export type IntegratorId = 'euler' | 'semi-implicit-euler' | 'velocity-verlet' | 'leapfrog' | 'rk4';

export interface Integrator {
  readonly id: IntegratorId;
  /** Advances pos and vel in place from t to t + dt. */
  step(pos: Float64Array, vel: Float64Array, t: number, dt: number, accel: AccelFn): void;
  /** Drops anything cached between steps; call after the state is changed from outside. */
  reset?(): void;
}

export interface IntegratorInfo {
  id: IntegratorId;
  name: string;
  /** Global error order: halving dt divides error by 2^order. */
  order: number;
  /** Symplectic methods keep energy bounded over long runs. */
  symplectic: boolean;
  summary: string;
}

export const INTEGRATORS: readonly IntegratorInfo[] = [
  {
    id: 'euler',
    name: 'Явний Ейлер',
    order: 1,
    symplectic: false,
    summary: 'Найпростіший метод. Енергія росте, орбіти розкручуються назовні.',
  },
  {
    id: 'semi-implicit-euler',
    name: 'Напівнеявний Ейлер',
    order: 1,
    symplectic: true,
    summary: 'Спочатку швидкість, потім положення. Енергія коливається, але не дрейфує.',
  },
  {
    id: 'velocity-verlet',
    name: 'Velocity Verlet',
    order: 2,
    symplectic: true,
    summary: 'Стандарт молекулярної динаміки. Точний для сталої сили, енергія стабільна.',
  },
  {
    id: 'leapfrog',
    name: 'Leapfrog (KDK)',
    order: 2,
    symplectic: true,
    summary:
      'Той самий Verlet, але прискорення з кінця кроку переходить у наступний: одне обчислення сил замість двох. Стандарт задачі N тіл; для сил, що залежать від швидкості, лише наближений.',
  },
  {
    id: 'rk4',
    name: 'Рунге–Кутта 4',
    order: 4,
    symplectic: false,
    summary: 'Дуже точний за крок, але енергія повільно згасає на довгих прогонах.',
  },
];

export function integratorInfo(id: IntegratorId): IntegratorInfo {
  return INTEGRATORS.find((info) => info.id === id)!;
}

/** Each instance owns scratch buffers, so create one per simulated world. */
export function createIntegrator(id: IntegratorId): Integrator {
  switch (id) {
    case 'euler':
      return explicitEuler();
    case 'semi-implicit-euler':
      return semiImplicitEuler();
    case 'velocity-verlet':
      return velocityVerlet();
    case 'leapfrog':
      return leapfrog();
    case 'rk4':
      return rungeKutta4();
  }
}

/** Reusable Float64Array buffers, reallocated only when the state size changes. */
class Scratch {
  private buffers: Float64Array[] = [];

  get(count: number, length: number): Float64Array[] {
    if (this.buffers.length !== count || this.buffers[0]?.length !== length) {
      this.buffers = Array.from({ length: count }, () => new Float64Array(length));
    }
    return this.buffers;
  }
}

// x' = x + v·dt, v' = v + a(x, v)·dt
function explicitEuler(): Integrator {
  const scratch = new Scratch();
  return {
    id: 'euler',
    step(pos, vel, t, dt, accel) {
      const [a] = scratch.get(1, pos.length);
      accel(pos, vel, t, a);
      for (let k = 0; k < pos.length; k++) {
        pos[k] += vel[k] * dt;
        vel[k] += a[k] * dt;
      }
    },
  };
}

// v' = v + a(x, v)·dt, x' = x + v'·dt
function semiImplicitEuler(): Integrator {
  const scratch = new Scratch();
  return {
    id: 'semi-implicit-euler',
    step(pos, vel, t, dt, accel) {
      const [a] = scratch.get(1, pos.length);
      accel(pos, vel, t, a);
      for (let k = 0; k < pos.length; k++) {
        vel[k] += a[k] * dt;
        pos[k] += vel[k] * dt;
      }
    },
  };
}

// x' = x + v·dt + a·dt²/2, v' = v + (a + a')·dt/2.
// a' is evaluated with a predicted velocity so velocity-dependent forces still work.
function velocityVerlet(): Integrator {
  const scratch = new Scratch();
  return {
    id: 'velocity-verlet',
    step(pos, vel, t, dt, accel) {
      const [a0, a1, vPred] = scratch.get(3, pos.length);
      accel(pos, vel, t, a0);
      for (let k = 0; k < pos.length; k++) {
        pos[k] += vel[k] * dt + 0.5 * a0[k] * dt * dt;
        vPred[k] = vel[k] + a0[k] * dt;
      }
      accel(pos, vPred, t + dt, a1);
      for (let k = 0; k < pos.length; k++) {
        vel[k] += 0.5 * (a0[k] + a1[k]) * dt;
      }
    },
  };
}

// Kick–drift–kick: v += a·dt/2, x += v·dt, a = a(x), v += a·dt/2. The closing
// acceleration is reused as the next step's opening one, so each step costs
// one force evaluation (gravity on thousands of bodies is the expensive part).
function leapfrog(): Integrator {
  const scratch = new Scratch();
  let cached: Float64Array | null = null;
  return {
    id: 'leapfrog',
    step(pos, vel, t, dt, accel) {
      const [a] = scratch.get(1, pos.length);
      if (cached !== a) {
        accel(pos, vel, t, a);
        cached = a;
      }
      for (let k = 0; k < pos.length; k++) {
        vel[k] += 0.5 * a[k] * dt;
        pos[k] += vel[k] * dt;
      }
      accel(pos, vel, t + dt, a);
      for (let k = 0; k < pos.length; k++) vel[k] += 0.5 * a[k] * dt;
    },
    reset() {
      cached = null;
    },
  };
}

// Classic RK4 on the first-order system y = (x, v), y' = (v, a(x, v)).
function rungeKutta4(): Integrator {
  const scratch = new Scratch();
  return {
    id: 'rk4',
    step(pos, vel, t, dt, accel) {
      const n = pos.length;
      const [a1, a2, a3, a4, v2, v3, v4, xt] = scratch.get(8, n);
      const h = dt / 2;

      accel(pos, vel, t, a1);

      for (let k = 0; k < n; k++) {
        xt[k] = pos[k] + vel[k] * h;
        v2[k] = vel[k] + a1[k] * h;
      }
      accel(xt, v2, t + h, a2);

      for (let k = 0; k < n; k++) {
        xt[k] = pos[k] + v2[k] * h;
        v3[k] = vel[k] + a2[k] * h;
      }
      accel(xt, v3, t + h, a3);

      for (let k = 0; k < n; k++) {
        xt[k] = pos[k] + v3[k] * dt;
        v4[k] = vel[k] + a3[k] * dt;
      }
      accel(xt, v4, t + dt, a4);

      const w = dt / 6;
      for (let k = 0; k < n; k++) {
        pos[k] += w * (vel[k] + 2 * v2[k] + 2 * v3[k] + v4[k]);
        vel[k] += w * (a1[k] + 2 * a2[k] + 2 * a3[k] + a4[k]);
      }
    },
  };
}
