import { Vec2 } from '../core/vec2';
import { RevoluteJoint } from '../rigid/joints';
import { polygon } from '../rigid/shapes';
import { RigidWorld } from '../rigid/world';
import { theme } from '../render/theme';
import { RIGID_NOTE, bar, circleIntersection, degrees, headingDeg } from './rigidKit';
import type { Scene } from './types';

// Crank–rocker four-bar linkage (Grashof: 0.6 + 2.0 ≤ 2.0 + 1.4).
const O2 = new Vec2(0, 0); // crank pivot
const O4 = new Vec2(2, 0); // rocker pivot
const CRANK = 0.6;
const COUPLER = 2;
const ROCKER = 1.4;
const A = O2.add(new Vec2(0, CRANK));
const B = circleIntersection(A, COUPLER, O4, ROCKER);
/** Coupler point that traces the coupler curve, off the A–B line. */
const P = A.lerp(B, 0.5).add(B.sub(A).normalize().perp().scale(0.8));
const COUPLER_CENTROID = A.add(B).add(P).scale(1 / 3);
const THICKNESS = 0.08;
const MOTOR_SPEED = 2; // rad/s
const LINKS = 1; // collision group: links pass over each other like stacked plates

export const linkage: Scene<RigidWorld> = {
  id: 'linkage',
  stage: 2,
  title: 'Шарнірний чотириланковик',
  description:
    'Кривошип 0.6 м, шатун 2 м, коромисло 1.4 м, стійка 2 м. Умова Грасгофа s + l ≤ p + q (0.6 + 2 ≤ 2 + 1.4) виконується, тож найкоротша ланка, кривошип, обертається повністю, а коромисло лише гойдається. Мотор тримає сталу швидкість 2 рад/с і виконує роботу проти тяжіння; вона входить у баланс енергії. Вершина трикутного шатуна малює шатунну криву.',
  // Tiny scene, so a fine step: the closed loop's joint error scales with dt.
  dt: 1 / 960,
  view: { min: new Vec2(-1, -0.7), max: new Vec2(3.3, 3.1) },
  fixedIntegrators: true,
  integratorNote: RIGID_NOTE,
  graph: () => ({
    title: 'Кути ланок',
    series: [
      { label: 'Кривошип', color: theme.series[0] },
      { label: 'Коромисло', color: theme.series[2] },
    ],
    format: degrees,
    sample: ([world]) => {
      const crankTip = world.joints[1].anchors()[0];
      const rockerTip = world.joints[2].anchors()[1];
      // Crank angle wrapped to 0…360°, so each full turn reads as one sawtooth.
      return [(headingDeg(O2, crankTip) + 360) % 360, headingDeg(O4, rockerTip)];
    },
  }),
  build: () => [
    new RigidWorld({
      label: 'Механізм',
      bodies: [
        { ...bar(O2, A, THICKNESS), density: 20, group: LINKS, color: theme.series[0] },
        {
          shape: polygon([A, B, P]),
          position: COUPLER_CENTROID,
          density: 20,
          group: LINKS,
          color: theme.series[1],
          trail: P.sub(COUPLER_CENTROID),
        },
        { ...bar(B, O4, THICKNESS), density: 20, group: LINKS, color: theme.series[2] },
        // Decorative bearing blocks under the fixed pivots.
        { shape: polygon([new Vec2(-0.2, -0.35), new Vec2(0.2, -0.35), new Vec2(0, 0)]), position: O2.add(new Vec2(0, -0.35 * (2 / 3))), static: true, group: LINKS },
        { shape: polygon([new Vec2(1.8, -0.35), new Vec2(2.2, -0.35), new Vec2(2, 0)]), position: O4.add(new Vec2(0, -0.35 * (2 / 3))), static: true, group: LINKS },
      ],
      joints: ([crank, coupler, rocker], ground) => [
        new RevoluteJoint(ground, crank, O2, { motorSpeed: MOTOR_SPEED, maxMotorTorque: 1000 }),
        new RevoluteJoint(crank, coupler, A),
        new RevoluteJoint(coupler, rocker, B),
        new RevoluteJoint(ground, rocker, O4),
      ],
    }),
  ],
};
