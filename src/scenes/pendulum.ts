import { DistanceConstraint } from '../core/constraints';
import { pendulumAngle } from '../core/exact';
import { UniformGravity } from '../core/forces';
import type { ParticleSpec } from '../core/particles';
import { DEG, STANDARD_GRAVITY } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import type { Scene } from './types';

const LENGTH = 1.5; // m
const OMEGA0 = Math.sqrt(STANDARD_GRAVITY / LENGTH);
const AMPLITUDES = [10, 90, 170]; // degrees
const SPACING = 3.6; // m between pivots

const pivot = (i: number) => new Vec2((i - (AMPLITUDES.length - 1) / 2) * SPACING, 0);
const bob = (i: number, theta: number) => pivot(i).add(new Vec2(Math.sin(theta), -Math.cos(theta)).scale(LENGTH));

/** Angle of pendulum i from the downward vertical, rad. Pivot is particle 2i, bob 2i + 1. */
function angle(world: World, i: number): number {
  const { pos } = world.particles;
  return Math.atan2(pos[4 * i + 2] - pos[4 * i], -(pos[4 * i + 3] - pos[4 * i + 1]));
}

export const pendulum: Scene<World> = {
  id: 'pendulum',
  stage: 1,
  title: 'Маятник і амплітуда',
  description:
    'Три однакові маятники довжиною 1.5 м відпущено з 10°, 90° і 170°. Для малих кутів період T = 2π√(L/g) від амплітуди не залежить, для великих росте: при 170° він у 2.4 раза довший. Пунктир — точний розв’язок через еліптичні функції Якобі. Тягарці й опори можна тягати мишею.',
  dt: 1 / 240,
  view: { min: new Vec2(-SPACING - LENGTH - 0.3, -LENGTH - 0.4), max: new Vec2(SPACING + LENGTH + 0.3, LENGTH + 0.4) },
  graph: () => ({
    title: 'Кут відхилення θ',
    series: AMPLITUDES.map((deg, i) => ({ label: `θ₀ = ${deg}°`, color: theme.series[i] })),
    format: (v) => `${Number(v.toPrecision(3))}°`,
    sample: ([world]) => AMPLITUDES.map((_, i) => angle(world, i) / DEG),
  }),
  build: (integrator) => [
    new World({
      integrator,
      // Zero potential energy at the lowest point of the swing.
      forces: [new UniformGravity(new Vec2(0, -STANDARD_GRAVITY), new Vec2(0, -LENGTH))],
      constraints: AMPLITUDES.map((_, i) => new DistanceConstraint(2 * i, 2 * i + 1, LENGTH)),
      particles: AMPLITUDES.flatMap((deg, i): ParticleSpec[] => [
        { pos: pivot(i), fixed: true, radius: 0.05 },
        { pos: bob(i, deg * DEG), mass: 1, radius: 0.12, color: theme.series[i] },
      ]),
    }),
  ],
  analytic: (_world, particle, t) => {
    if (particle % 2 === 0) return null;
    const i = (particle - 1) / 2;
    return bob(i, pendulumAngle(AMPLITUDES[i] * DEG, OMEGA0, t));
  },
};
