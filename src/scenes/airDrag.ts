import { Collisions, wall } from '../core/collisions';
import { linearDragPosition } from '../core/exact';
import { type Force, LinearDrag, QuadraticDrag, UniformGravity } from '../core/forces';
import { AIR_DENSITY, DEG, STANDARD_GRAVITY, formatSI } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { perWorldGraph } from './graphs';
import type { Scene } from './types';

// A tennis ball.
const MASS = 0.057; // kg
const RADIUS = 0.033; // m
const DRAG_COEFFICIENT = 0.47;
const V0 = Vec2.fromAngle(45 * DEG, 30); // m/s
const START = new Vec2(0, RADIUS);
const g = STANDARD_GRAVITY;

// Linear drag tuned to the same terminal speed as real (quadratic) air drag.
const QUADRATIC_K = 0.5 * AIR_DENSITY * DRAG_COEFFICIENT * Math.PI * RADIUS * RADIUS;
const TERMINAL_SPEED = Math.sqrt((MASS * g) / QUADRATIC_K);
const LINEAR_B = (MASS * g) / TERMINAL_SPEED;

const CASES: Array<{ label: string; drag: Force | null }> = [
  { label: 'Вакуум', drag: null },
  { label: 'Лінійний опір', drag: new LinearDrag(LINEAR_B) },
  { label: 'Повітря (v²)', drag: new QuadraticDrag(AIR_DENSITY, DRAG_COEFFICIENT) },
];

export const airDrag: Scene = {
  id: 'air-drag',
  stage: 1,
  title: 'Опір повітря',
  description:
    'Тенісний м’ячик (57 г) кинуто зі швидкістю 30 м/с під 45°. У вакуумі він пролітає 92 м по симетричній параболі. З опором траєкторія несиметрична: м’ячик падає круче, ніж злітав, і пролітає лише 39–45 м. Лінійний опір F = −bv має точний розв’язок (пунктир); справжнє повітря гальмує пропорційно v². Обидва опори налаштовано на однакову граничну швидкість падіння ≈ 24 м/с.',
  dt: 1 / 240,
  view: { min: new Vec2(-3, -3), max: new Vec2(95, 26) },
  loopAfter: 6,
  graph: perWorldGraph('Механічна енергія', (v) => formatSI(v, 'Дж'), (w) => w.totalEnergy()),
  build: (integrator) =>
    CASES.map(
      ({ label, drag }, k) =>
        new World({
          integrator,
          label,
          color: theme.series[k],
          forces: drag ? [new UniformGravity(new Vec2(0, -g)), drag] : [new UniformGravity(new Vec2(0, -g))],
          collisions: new Collisions({ walls: [wall(Vec2.ZERO, new Vec2(0, 1), 0.3, 0.8)] }),
          particles: [
            { pos: START, vel: V0, mass: MASS, radius: RADIUS, restitution: 0.3, friction: 0.8, color: theme.series[k] },
          ],
        }),
    ),
  analytic: (world, _i, t) => {
    let p: Vec2 | null = null;
    if (world === 0) p = START.add(V0.scale(t)).add(new Vec2(0, (-g * t * t) / 2));
    if (world === 1) p = START.add(linearDragPosition(V0, g, MASS / LINEAR_B, t));
    // Exact flight only: no formula covers the landing.
    return p && p.y >= RADIUS ? p : null;
  },
};
