import { Spring } from '../core/forces';
import { INTEGRATORS } from '../core/integrators';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { driftGraph } from './graphs';
import type { Scene } from './types';

// Zero-length spring to a fixed centre: an isotropic 2D oscillator whose
// exact orbit is a closed ellipse, so any spiralling is integrator error.
const MASS = 1; // kg
const STIFFNESS = Math.PI ** 2; // N/m → period 2 s
const OMEGA = Math.sqrt(STIFFNESS / MASS);
const OFFSET = new Vec2(0.9, 0); // m, from centre
const VELOCITY = new Vec2(0, 0.45 * OMEGA); // m/s → ellipse 0.9 × 0.45 m
const SPACING = 5; // m between centres

const center = (i: number) => new Vec2((i - (INTEGRATORS.length - 1) / 2) * SPACING, 0);

export const integratorCompare: Scene<World> = {
  id: 'integrator-compare',
  stage: 0,
  title: 'Порівняння інтеграторів',
  description:
    'Чотири однакові осцилятори, кожен зі своїм методом інтегрування. Точна траєкторія — замкнений еліпс. Явний Ейлер розкручується назовні, симплектичні методи тримають орбіту. На графіку — відносна зміна повної енергії; клацни ряд у легенді, щоб сховати його.',
  dt: 1 / 60,
  view: { min: new Vec2(-10, -2.6), max: new Vec2(10, 2.6) },
  graph: driftGraph,
  fixedIntegrators: true,
  loopAfter: 12,
  build: () =>
    INTEGRATORS.map(
      (info, i) =>
        new World({
          integrator: info.id,
          label: info.name,
          color: theme.series[i],
          forces: [new Spring(center(i), 0, STIFFNESS, 0)],
          particles: [{ pos: center(i).add(OFFSET), vel: VELOCITY, mass: MASS, radius: 0.08, color: theme.series[i] }],
        }),
    ),
  analytic: (world, _i, t) =>
    center(world)
      .add(OFFSET.scale(Math.cos(OMEGA * t)))
      .add(VELOCITY.scale(Math.sin(OMEGA * t) / OMEGA)),
};
