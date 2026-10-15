import { Vec2 } from '../core/vec2';
import { box, circle } from '../rigid/shapes';
import { type RigidBodySpec, RigidWorld } from '../rigid/world';
import { theme } from '../render/theme';
import { energyGraph } from './graphs';
import { RIGID_NOTE } from './rigidKit';
import type { Scene } from './types';

const ROWS = 7;
const SIZE = 0.5; // m, box side
const PITCH = 0.51; // m between box centres in a row
const CENTRE_X = 2; // m

function bodies(): RigidBodySpec[] {
  const specs: RigidBodySpec[] = [{ shape: box(30, 1), position: new Vec2(-5, -0.5), static: true, friction: 0.7 }];
  for (let row = 0; row < ROWS; row++) {
    const n = ROWS - row;
    for (let i = 0; i < n; i++) {
      specs.push({
        shape: box(SIZE, SIZE),
        position: new Vec2(CENTRE_X + (i - (n - 1) / 2) * PITCH, SIZE / 2 + row * SIZE),
        density: 8,
        friction: 0.6,
        color: theme.series[row],
      });
    }
  }
  specs.push({
    shape: circle(0.3),
    position: new Vec2(-9, 1.2),
    velocity: new Vec2(12, 4),
    mass: 25,
    restitution: 0.2,
    friction: 0.4,
    color: '#e8e6df',
    trail: true,
  });
  return specs;
}

export const tower: Scene<RigidWorld> = {
  id: 'tower',
  stage: 2,
  title: 'Піраміда і ядро',
  description:
    'Піраміда з 28 ящиків тримається лише на контактах і терті. Тіла, що завмерли, засинають (стають блідими): їх не рахують, доки щось не зачепить. Ядро масою 25 кг руйнує піраміду, і сон поширюється назад, коли уламки зупиняються. Увімкни «Контакти», щоб побачити точки дотику й нормалі; ящики можна кидати мишею.',
  dt: 1 / 240,
  view: { min: new Vec2(-10, -0.8), max: new Vec2(8, 5) },
  loopAfter: 10,
  fixedIntegrators: true,
  integratorNote: RIGID_NOTE,
  losesEnergy: true,
  graph: energyGraph(),
  build: () => [new RigidWorld({ bodies: bodies(), label: 'Піраміда' })],
};
