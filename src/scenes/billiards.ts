import { Collisions, box } from '../core/collisions';
import { SurfaceFriction } from '../core/forces';
import type { ParticleSpec } from '../core/particles';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { energyGraph } from './graphs';
import type { Scene } from './types';

// Pool table (9 ft playing surface) and regulation balls.
const TABLE = new Vec2(2.54, 1.27); // m
const RADIUS = 0.028_575; // m
const MASS = 0.17; // kg
const GAP = 0.0005; // m between racked balls
const FOOT_SPOT = new Vec2(TABLE.x * 0.75, TABLE.y / 2);
const CUE_START = new Vec2(TABLE.x * 0.25, TABLE.y / 2);
const CUE_VELOCITY = new Vec2(7, 0.03); // m/s; slightly off-axis so the break isn't symmetric
const CUE_COLOR = '#e8e6df';

/** 15 balls in a triangle, apex on the foot spot pointing at the cue ball. */
function rack(): ParticleSpec[] {
  const balls: ParticleSpec[] = [];
  const pitch = 2 * RADIUS + GAP;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      balls.push({
        pos: FOOT_SPOT.add(new Vec2((row * pitch * Math.sqrt(3)) / 2, (j - row / 2) * pitch)),
        color: theme.series[balls.length % theme.series.length],
      });
    }
  }
  return balls;
}

export const billiards: Scene = {
  id: 'billiards',
  stage: 1,
  title: 'Більярд',
  description:
    'Розбиття піраміди, вид згори. Біток летить зі швидкістю 7 м/с у 15 куль. Удари куль майже пружні (e = 0.95), борти м’якші (e = 0.75), а тертя кочення об сукно поступово зупиняє все. Кінетична енергія тане, але сума з втратами лишається сталою.',
  dt: 1 / 480,
  view: { min: new Vec2(-0.05, -0.05), max: TABLE.add(new Vec2(0.05, 0.05)) },
  loopAfter: 20,
  graph: energyGraph({ potential: false, losses: true }),
  build: (integrator) => [
    new World({
      integrator,
      forces: [new SurfaceFriction(0.02)],
      collisions: new Collisions({ walls: box(Vec2.ZERO, TABLE, 0.75), iterations: 10 }),
      particles: [{ pos: CUE_START, vel: CUE_VELOCITY, color: CUE_COLOR }, ...rack()].map((ball) => ({
        ...ball,
        mass: MASS,
        radius: RADIUS,
        restitution: 0.95,
      })),
    }),
  ],
};
