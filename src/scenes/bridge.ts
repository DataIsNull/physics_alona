import { Vec2 } from '../core/vec2';
import { RevoluteJoint } from '../rigid/joints';
import { box, circle } from '../rigid/shapes';
import { type RigidBodySpec, RigidWorld } from '../rigid/world';
import { theme } from '../render/theme';
import { energyGraph } from './graphs';
import { RIGID_NOTE, bar } from './rigidKit';
import type { Scene } from './types';

const PLANKS = 14;
const PLANK = 0.5; // m
const SPAN = 6; // m between the end pins
const LEFT = new Vec2(-SPAN / 2, 0);
/** The planks are longer than the span, so the bridge starts as a V and sags. */
const DIP = Math.acos(SPAN / (PLANKS * PLANK));
const DECK = 2; // collision group shared by planks and posts

/** End points of the planks, starting at the left pin. */
function joints(): Vec2[] {
  const points = [LEFT];
  for (let i = 0; i < PLANKS; i++) {
    const dir = new Vec2(Math.cos(DIP), i < PLANKS / 2 ? -Math.sin(DIP) : Math.sin(DIP));
    points.push(points[i].add(dir.scale(PLANK)));
  }
  return points;
}

function bodies(): RigidBodySpec[] {
  const pts = joints();
  const specs: RigidBodySpec[] = [];
  for (let i = 0; i < PLANKS; i++) {
    specs.push({ ...bar(pts[i], pts[i + 1], 0.1), density: 20, friction: 0.8, group: DECK, color: theme.series[1] });
  }
  // Posts under the end pins.
  for (const x of [-SPAN / 2, SPAN / 2]) {
    specs.push({ shape: box(0.3, 3), position: new Vec2(x + Math.sign(x) * 0.15, -1.5), static: true, group: DECK });
  }
  // Loads dropped onto the deck.
  const loads: RigidBodySpec[] = [
    { shape: box(0.4, 0.4), position: new Vec2(-1.8, 2.5), angle: 0.3 },
    { shape: circle(0.2), position: new Vec2(-0.7, 3.2) },
    { shape: box(0.5, 0.3), position: new Vec2(0.4, 2.2), angle: -0.2 },
    { shape: circle(0.25), position: new Vec2(1.5, 3) },
    { shape: box(0.35, 0.35), position: new Vec2(2.2, 2.4), angle: 0.5 },
  ];
  loads.forEach((load, i) => specs.push({ ...load, mass: 3, friction: 0.6, color: theme.series[[0, 2, 3, 4, 6][i]] }));
  return specs;
}

export const bridge: Scene<RigidWorld> = {
  id: 'bridge',
  stage: 2,
  title: 'Підвісний міст',
  description:
    'Міст із 14 дощок на шарнірах провисає між двома опорами. На нього падають вантажі; шарніри передають навантаження від дошки до дошки, і міст прогинається під кожним. Невелике демпфування гасить коливання. Тягай вантажі й дошки мишею.',
  dt: 1 / 240,
  view: { min: new Vec2(-3.9, -3.2), max: new Vec2(3.9, 3.5) },
  loopAfter: 15,
  fixedIntegrators: true,
  integratorNote: RIGID_NOTE,
  losesEnergy: true,
  graph: energyGraph(),
  build: () => [
    new RigidWorld({
      label: 'Міст',
      damping: 0.3,
      reference: new Vec2(0, -3),
      bodies: bodies(),
      joints: (bs, ground) => {
        const pts = joints();
        return [
          new RevoluteJoint(ground, bs[0], pts[0]),
          ...Array.from({ length: PLANKS - 1 }, (_, i) => new RevoluteJoint(bs[i], bs[i + 1], pts[i + 1])),
          new RevoluteJoint(bs[PLANKS - 1], ground, pts[PLANKS]),
        ];
      },
    }),
  ],
};
