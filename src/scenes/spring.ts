import { Spring } from '../core/forces';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { energyGraph } from './graphs';
import type { Scene } from './types';

const MASS = 1; // kg
const STIFFNESS = 4 * Math.PI ** 2; // N/m → period of exactly 1 s
const REST_LENGTH = 3; // m
const AMPLITUDE = 1; // m
const OMEGA = Math.sqrt(STIFFNESS / MASS);
const ANCHOR = new Vec2(-REST_LENGTH, 0);

export const springOscillator: Scene<World> = {
  id: 'spring',
  stage: 0,
  title: 'Пружинний маятник',
  description:
    'Тягарець 1 кг на пружині k = 4π² Н/м без тертя, період рівно 1 с. Кінетична й потенціальна енергія перетікають одна в одну, а повна має лишатися сталою. Спробуй явний Ейлер і великий крок dt.',
  dt: 1 / 60,
  view: { min: new Vec2(-3.4, -1.2), max: new Vec2(1.6, 1.2) },
  graph: energyGraph(),
  build: (integrator) => [
    new World({
      integrator,
      forces: [new Spring(ANCHOR, 0, STIFFNESS, REST_LENGTH)],
      particles: [{ pos: new Vec2(AMPLITUDE, 0), mass: MASS, radius: 0.15, color: theme.series[0] }],
    }),
  ],
  analytic: (_world, _i, t) => new Vec2(AMPLITUDE * Math.cos(OMEGA * t), 0),
};
