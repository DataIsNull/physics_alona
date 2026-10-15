import { DistanceConstraint } from '../core/constraints';
import { Spring, UniformGravity } from '../core/forces';
import { DEG, STANDARD_GRAVITY, formatSI } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import type { Scene } from './types';

const L = 1.2; // m
const MASS = 1; // kg
const GAP = 0.8; // m between pivots (and the spring's rest length)
const THETA0 = 8 * DEG;
const g = STANDARD_GRAVITY;
const PIVOTS = [new Vec2(-GAP / 2, 0), new Vec2(GAP / 2, 0)];

const modes = (k: number) => ({ w1: Math.sqrt(g / L), w2: Math.sqrt(g / L + (2 * k) / MASS) });

/** Energy of one pendulum: kinetic plus height above its lowest point. */
function energy(world: World, bob: number): number {
  const v = world.particles.velocity(bob);
  return 0.5 * MASS * v.lengthSq() + MASS * g * (world.particles.pos[2 * bob + 1] + L);
}

export const coupledPendulums: Scene<World> = {
  id: 'coupled-pendulums',
  stage: 4,
  title: 'Зв’язані маятники: биття',
  description:
    'Два однакові маятники з’єднані слабкою пружиною; спочатку гойдається лише лівий. Система має дві нормальні моди: обидва в фазі (ω₁ = √(g/L), пружина не працює) і в протифазі (ω₂ = √(g/L + 2k/m)). Їх сума — це биття: енергія повністю перетікає з одного маятника в інший за час π/(ω₂ − ω₁) і назад. Що слабша пружина, то повільніший обмін. Пунктир — розв’язок через нормальні моди (малі кути).',
  dt: 1 / 240,
  view: { min: new Vec2(-1.3, -1.5), max: new Vec2(1.3, 0.2) },
  params: [{ id: 'k', label: 'Жорсткість пружини k', min: 0.1, max: 3, step: 0.05, value: 0.6, format: (v) => `${v.toFixed(2)} Н/м` }],
  graph: (_worlds, p) => {
    const { w1, w2 } = modes(p.k);
    const swap = Math.PI / (w2 - w1);
    return {
      title: `Енергія маятників · обмін за ${swap.toFixed(1)} с`,
      series: [
        { label: 'Лівий', color: theme.series[0] },
        { label: 'Правий', color: theme.series[1] },
      ],
      format: (v) => formatSI(v, 'Дж'),
      sample: ([world]) => [energy(world, 1), energy(world, 3)],
    };
  },
  build: (integrator, p) => [
    new World({
      integrator,
      label: 'Маятники',
      forces: [new UniformGravity(new Vec2(0, -g), new Vec2(0, -L)), new Spring(1, 3, p.k, GAP)],
      constraints: [new DistanceConstraint(0, 1, L), new DistanceConstraint(2, 3, L)],
      particles: [
        { pos: PIVOTS[0], fixed: true, radius: 0.03 },
        { pos: PIVOTS[0].add(new Vec2(L * Math.sin(THETA0), -L * Math.cos(THETA0))), mass: MASS, radius: 0.08, color: theme.series[0] },
        { pos: PIVOTS[1], fixed: true, radius: 0.03 },
        { pos: PIVOTS[1].add(new Vec2(0, -L)), mass: MASS, radius: 0.08, color: theme.series[1] },
      ],
    }),
  ],
  analytic: (_world, i, t, p) => {
    if (i % 2 === 0) return null;
    // Small-angle normal modes: x₁,₂ = (A/2)(cos ω₁t ± cos ω₂t).
    const { w1, w2 } = modes(p.k);
    const A = L * Math.sin(THETA0);
    const x = (A / 2) * (Math.cos(w1 * t) + (i === 1 ? 1 : -1) * Math.cos(w2 * t));
    const pivot = PIVOTS[i === 1 ? 0 : 1];
    return pivot.add(new Vec2(x, -Math.sqrt(L * L - x * x)));
  },
};
