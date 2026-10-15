import { DistanceConstraint } from '../core/constraints';
import { UniformGravity } from '../core/forces';
import { DEG, STANDARD_GRAVITY } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import type { Scene } from './types';

const L1 = 1; // m
const L2 = 1; // m
const THETA1 = 120 * DEG;
const THETA2 = 150 * DEG;
/** Extra initial angle of the lower rod in each copy, rad. */
const OFFSETS = [0, 1e-9, 1e-6, 1e-3];
const OFFSET_LABELS = ['Δθ₀ = 0', 'Δθ₀ = 10⁻⁹ рад', 'Δθ₀ = 10⁻⁶ рад', 'Δθ₀ = 10⁻³ рад'];

const down = (theta: number, length: number) => new Vec2(Math.sin(theta), -Math.cos(theta)).scale(length);

/** Upper and lower rod angles from the vertical. Particles: pivot 0, bob 1, bob 2. */
function angles(world: World): [number, number] {
  const p = world.particles.pos;
  return [Math.atan2(p[2] - p[0], -(p[3] - p[1])), Math.atan2(p[4] - p[2], -(p[5] - p[3]))];
}

/** Wraps an angle difference into (−π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Distance between two copies in angle space, rad. */
function separation(a: World, b: World): number {
  const [a1, a2] = angles(a);
  const [b1, b2] = angles(b);
  return Math.hypot(wrap(a1 - b1), wrap(a2 - b2));
}

const radians = (v: number) => (v >= 0.01 ? `${Number(v.toPrecision(2))} рад` : `${v.toExponential(0)} рад`);

export const doublePendulum: Scene<World> = {
  id: 'double-pendulum',
  stage: 1,
  title: 'Подвійний маятник: хаос',
  description:
    'Чотири подвійні маятники стартують майже однаково: нижній стрижень відхилено ще на 0, 10⁻⁹, 10⁻⁶ і 10⁻³ рад. Різниця росте експоненційно, приблизно вдесятеро кожні 2 с (на логарифмічній шкалі це пряма), доки траєкторії не стануть зовсім різними. Це детермінований хаос: закони точні, але найменша похибка в початкових умовах робить далеке майбутнє непередбачуваним.',
  dt: 1 / 480,
  view: { min: new Vec2(-2.3, -2.3), max: new Vec2(2.3, 2.3) },
  loopAfter: 30,
  graph: (worlds) => ({
    title: 'Відхилення від першого маятника',
    series: worlds.slice(1).map((w) => ({ label: w.label, color: w.color })),
    format: radians,
    scale: 'log',
    sample: ([first, ...rest]) => rest.map((w) => separation(first, w)),
  }),
  build: (integrator) =>
    OFFSETS.map((offset, k) => {
      const upper = down(THETA1, L1);
      const lower = upper.add(down(THETA2 + offset, L2));
      return new World({
        integrator,
        label: OFFSET_LABELS[k],
        color: theme.series[k],
        forces: [new UniformGravity(new Vec2(0, -STANDARD_GRAVITY), new Vec2(0, -L1 - L2))],
        constraints: [new DistanceConstraint(0, 1, L1), new DistanceConstraint(1, 2, L2)],
        particles: [
          { pos: Vec2.ZERO, fixed: true, radius: 0.05 },
          { pos: upper, mass: 1, radius: 0.08, color: theme.series[k], trail: false },
          { pos: lower, mass: 1, radius: 0.1, color: theme.series[k] },
        ],
      });
    }),
};
