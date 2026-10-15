import { DEG, STANDARD_GRAVITY } from '../core/units';
import { Vec2 } from '../core/vec2';
import { type Shape, box, circle } from '../rigid/shapes';
import { type RigidBodySpec, RigidWorld } from '../rigid/world';
import { theme } from '../render/theme';
import { RIGID_NOTE } from './rigidKit';
import type { Scene } from './types';

const ALPHA = 20 * DEG;
const RAMP_LENGTH = 7; // m
const RAMP_THICKNESS = 0.3; // m
const SPACING = 1.15; // m between ramps (vertical)
const DOWN = new Vec2(Math.cos(ALPHA), -Math.sin(ALPHA)); // along the slope
const NORMAL = new Vec2(Math.sin(ALPHA), Math.cos(ALPHA)); // out of the slope
const g = STANDARD_GRAVITY;
const R = 0.2; // m, rollers' radius and half the boxes' side

interface Racer {
  name: string;
  shape: Shape;
  friction: number;
  /** I / (m·r²) for rollers; null for sliding boxes. */
  inertiaFactor: number | null;
  /** Theoretical acceleration along the slope, m/s². */
  a: number;
}

const RACERS: Racer[] = [
  { name: 'Ящик без тертя', shape: box(2 * R, 2 * R), friction: 0, inertiaFactor: null, a: g * Math.sin(ALPHA) },
  { name: 'Куля', shape: circle(R), friction: 0.6, inertiaFactor: 2 / 5, a: (g * Math.sin(ALPHA)) / (1 + 2 / 5) },
  { name: 'Диск', shape: circle(R), friction: 0.6, inertiaFactor: 1 / 2, a: (g * Math.sin(ALPHA)) / (1 + 1 / 2) },
  { name: 'Обруч', shape: circle(R), friction: 0.6, inertiaFactor: 1, a: (g * Math.sin(ALPHA)) / 2 },
  { name: 'Ящик, μ = 0.6', shape: box(2 * R, 2 * R), friction: 0.6, inertiaFactor: null, a: 0 },
];

/** Centre of the top surface of ramp k. */
const surface = (k: number) => new Vec2(0, -k * SPACING).add(NORMAL.scale(RAMP_THICKNESS / 2));

function bodies(): RigidBodySpec[] {
  const specs: RigidBodySpec[] = [];
  RACERS.forEach((racer, k) => {
    const top = surface(k).sub(DOWN.scale(RAMP_LENGTH / 2));
    const bottom = surface(k).add(DOWN.scale(RAMP_LENGTH / 2));
    specs.push(
      { shape: box(RAMP_LENGTH, RAMP_THICKNESS), position: new Vec2(0, -k * SPACING), angle: -ALPHA, static: true, friction: 0.6 },
      // Stopper at the bottom end.
      { shape: box(0.1, 0.6), position: bottom.add(NORMAL.scale(0.3)).sub(DOWN.scale(0.05)), angle: -ALPHA, static: true },
      {
        shape: racer.shape,
        position: top.add(DOWN.scale(0.5)).add(NORMAL.scale(R)),
        angle: -ALPHA,
        mass: 1,
        inertia: racer.inertiaFactor === null ? undefined : racer.inertiaFactor * R * R,
        friction: racer.friction,
        color: theme.series[k],
      },
    );
  });
  return specs;
}

export const incline: Scene<RigidWorld> = {
  id: 'incline',
  stage: 2,
  title: 'Похила площина',
  description:
    'П’ять тіл на однакових схилах 20°. Ящик без тертя ковзає найшвидше: a = g·sinα. Тіла, що котяться, частину енергії віддають обертанню, тому a = g·sinα / (1 + I/mr²): куля обганяє диск, диск — обруч. Ящик з μ = 0.6 > tg 20° тримає статичне тертя. Нахил кожної прямої на графіку — прискорення; теоретичні значення в легенді.',
  dt: 1 / 240,
  view: { min: new Vec2(-3.8, -4 * SPACING - 1.6), max: new Vec2(3.8, 1.7) },
  loopAfter: 3.5,
  fixedIntegrators: true,
  integratorNote: RIGID_NOTE,
  losesEnergy: true,
  graph: () => ({
    title: 'Швидкість уздовж схилу',
    series: RACERS.map((r, k) => ({ label: `${r.name} · ${r.a.toFixed(2)} м/с²`, color: theme.series[k] })),
    format: (v) => `${Number(v.toPrecision(3))} м/с`,
    sample: ([world]) => RACERS.map((_, k) => {
      const b = world.bodies[3 * k + 2];
      return b.vx * DOWN.x + b.vy * DOWN.y;
    }),
  }),
  build: () => [new RigidWorld({ bodies: bodies(), label: 'Похила площина' })],
};
