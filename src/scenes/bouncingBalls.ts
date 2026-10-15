import { Collisions, wall } from '../core/collisions';
import { UniformGravity } from '../core/forces';
import { formatSI } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import type { Scene } from './types';

const RESTITUTION = [0.9, 0.7, 0.5, 0.3];
const RADIUS = 0.1; // m
const DROP_HEIGHT = 2; // m, of the centre

export const bouncingBalls: Scene = {
  id: 'bouncing-balls',
  stage: 1,
  title: 'Стрибки м’ячів',
  description:
    'Чотири м’ячі падають з 2 м на тверду підлогу. Коефіцієнт відновлення e — частка швидкості, що лишається після удару, тож кожен наступний стрибок нижчий у e² раз: hₙ = e²ⁿ·h₀. Втрачена при ударах енергія йде в тепло й рахується на панелі.',
  dt: 1 / 480,
  view: { min: new Vec2(0, -0.15), max: new Vec2(4, 2.25) },
  loopAfter: 8,
  graph: () => ({
    title: 'Висота над підлогою',
    series: RESTITUTION.map((e, i) => ({ label: `e = ${e}`, color: theme.series[i] })),
    format: (v) => formatSI(v, 'м'),
    sample: ([world]) => RESTITUTION.map((_, i) => world.particles.pos[2 * i + 1] - RADIUS),
  }),
  build: (integrator) => [
    new World({
      integrator,
      forces: [new UniformGravity()],
      collisions: new Collisions({ walls: [wall(Vec2.ZERO, new Vec2(0, 1))] }),
      particles: RESTITUTION.map((e, i) => ({
        pos: new Vec2(0.5 + i, DROP_HEIGHT),
        mass: 0.06,
        radius: RADIUS,
        restitution: e,
        color: theme.series[i],
      })),
    }),
  ],
};
