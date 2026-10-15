import { UniformGravity } from '../core/forces';
import { DEG, STANDARD_GRAVITY } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import type { Scene } from './types';

const SPEED = 20; // m/s
const ANGLES = [15, 30, 45, 60, 75]; // degrees
const GRAVITY = new Vec2(0, -STANDARD_GRAVITY);

const launchVelocity = (i: number) => Vec2.fromAngle(ANGLES[i] * DEG, SPEED);

export const freeFall: Scene = {
  id: 'free-fall',
  title: 'Вільне падіння',
  description:
    "П'ять тіл кинуто з однаковою швидкістю 20 м/с під кутами 15–75°. Пунктирні кола — точний розв'язок r = r₀ + v₀t + gt²/2. Найдалі летить тіло під 45°, а пари 15°/75° і 30°/60° падають в одну точку.",
  dt: 1 / 60,
  view: { min: new Vec2(-3, -3), max: new Vec2(44, 21) },
  graph: 'energy',
  loopAfter: 4,
  build: (integrator) => [
    new World({
      integrator,
      forces: [new UniformGravity(GRAVITY)],
      particles: ANGLES.map((_, i) => ({
        pos: Vec2.ZERO,
        vel: launchVelocity(i),
        mass: 1,
        radius: 0.45,
        color: theme.series[i],
      })),
    }),
  ],
  analytic: (_world, i, t) => launchVelocity(i).scale(t).add(GRAVITY.scale((t * t) / 2)),
};
