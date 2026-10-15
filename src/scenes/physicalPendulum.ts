import { DEG } from '../core/units';
import { Vec2 } from '../core/vec2';
import { DistanceJoint, RevoluteJoint } from '../rigid/joints';
import { box, circle } from '../rigid/shapes';
import { RigidWorld } from '../rigid/world';
import { theme } from '../render/theme';
import { RIGID_NOTE, degrees, swingDeg } from './rigidKit';
import type { Scene } from './types';

const AMPLITUDE = 40 * DEG;
const ROD_LENGTH = 1.5; // m → equivalent length 2L/3 = 1 m
const DISC_RADIUS = 2 / 3; // m, hung by its rim → equivalent length 3R/2 = 1 m
const STRING_LENGTH = 1; // m
const PIVOTS = [new Vec2(-2.6, 0), new Vec2(0, 0), new Vec2(2.6, 0)];
const LABELS = ['Стрижень 1.5 м', 'Диск R = ⅔ м', 'Точка на нитці 1 м'];
const DOWN = new Vec2(Math.sin(AMPLITUDE), -Math.cos(AMPLITUDE));

export const physicalPendulum: Scene<RigidWorld> = {
  id: 'physical-pendulum',
  stage: 2,
  title: 'Фізичний маятник',
  description:
    'Стрижень 1.5 м, підвішений за кінець, диск, підвішений за край, і точкова маса на нитці 1 м. Період фізичного маятника T = 2π√(I/(m·g·d)) залежить від моменту інерції відносно осі: для стрижня I = mL²/3, d = L/2, і він гойдається як нитка довжиною 2L/3 = 1 м. У диска радіусом ⅔ м зведена довжина 3R/2 — теж 1 м. Різні тіла, той самий рух: криві на графіку збігаються.',
  dt: 1 / 240,
  view: { min: new Vec2(-4, -2.1), max: new Vec2(3.9, 0.5) },
  fixedIntegrators: true,
  integratorNote: RIGID_NOTE,
  graph: () => ({
    title: 'Кут відхилення',
    series: LABELS.map((label, i) => ({ label, color: theme.series[i] })),
    format: degrees,
    sample: ([world]) => world.bodies.map((b, i) => swingDeg(PIVOTS[i], b)),
  }),
  build: () => [
    new RigidWorld({
      label: 'Маятники',
      reference: new Vec2(0, -2),
      bodies: [
        {
          shape: box(0.06, ROD_LENGTH),
          position: PIVOTS[0].add(DOWN.scale(ROD_LENGTH / 2)),
          angle: AMPLITUDE,
          color: theme.series[0],
        },
        { shape: circle(DISC_RADIUS), position: PIVOTS[1].add(DOWN.scale(DISC_RADIUS)), color: theme.series[1] },
        {
          shape: circle(0.08),
          position: PIVOTS[2].add(DOWN.scale(STRING_LENGTH)),
          fixedRotation: true,
          color: theme.series[2],
        },
      ],
      joints: ([rod, disc, bob], ground) => [
        new RevoluteJoint(ground, rod, PIVOTS[0]),
        new RevoluteJoint(ground, disc, PIVOTS[1]),
        new DistanceJoint(ground, bob, PIVOTS[2], PIVOTS[2].add(DOWN.scale(STRING_LENGTH))),
      ],
    }),
  ],
};
