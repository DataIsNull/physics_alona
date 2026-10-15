import { keplerState, orbitalPeriod } from '../core/exact';
import { PointMassField, RelativisticCorrection } from '../core/gravity';
import { ASTRONOMICAL_UNITS, AU, DAY, G, SOLAR_MASS, SPEED_OF_LIGHT, YEAR } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { SUN_COLOR, periapsisAngle } from './astroKit';
import { degrees } from './rigidKit';
import type { Scene } from './types';

const MU = G * SOLAR_MASS;
const A = 0.387_098 * AU;
const E = 0.205_630;
/** Light slowed 100× so the precession grows 10⁴× and shows within decades. */
const C = SPEED_OF_LIGHT / 100;
const PERIOD = orbitalPeriod(A, MU);
/** Perihelion advance per orbit predicted by general relativity, rad. */
const ADVANCE = (6 * Math.PI * MU) / (C * C * A * (1 - E * E));

const CASES = [
  { label: 'Ньютон', relativity: false },
  { label: 'Ньютон + ЗТВ (c/100)', relativity: true },
];

export const mercury: Scene<World> = {
  id: 'mercury',
  stage: 3,
  title: 'Прецесія Меркурія (ЗТВ)',
  description:
    'Перигелій Меркурія повертається на 43″ за століття більше, ніж пояснює Ньютон, — цю різницю пояснила загальна теорія відносності. Тут до тяжіння Сонця додано її поправку першого порядку, а швидкість світла зменшено в 100 разів, тож ефект зростає в 10⁴ разів. Ньютонівська орбіта (синя) замкнена, релятивістська повертається розеткою. На графіку напрям перигелію і передбачення 6πGM/(c²a(1−e²)) за оберт. Ньютонівська енергія в релятивістському світі вже не точно стала: поправка змінює її на величину порядку v²/c².',
  dt: 0.05 * DAY,
  dtRange: [0.005 * DAY, 5 * DAY],
  speed: 2 * YEAR,
  speedRange: [DAY, 20 * YEAR],
  integrator: 'rk4',
  lengthUnit: ASTRONOMICAL_UNITS,
  view: { min: new Vec2(-0.55 * AU, -0.45 * AU), max: new Vec2(0.4 * AU, 0.45 * AU) },
  graph: (worlds) => ({
    title: 'Напрям перигелію',
    series: [
      ...worlds.map((w) => ({ label: w.label, color: w.color })),
      { label: 'Теорія ЗТВ', color: theme.series[2] },
    ],
    format: degrees,
    sample: (ws) => [
      ...ws.map((w) => periapsisAngle(w.particles.position(1), w.particles.velocity(1), MU) / (Math.PI / 180)),
      ((ws[0].t / PERIOD) * ADVANCE) / (Math.PI / 180),
    ],
  }),
  build: (integrator) =>
    CASES.map(({ label, relativity }, k) => {
      const { pos, vel } = keplerState({ a: A, e: E, periapsis: 0, meanAnomaly: 0 }, MU, 0);
      return new World({
        integrator,
        label,
        color: theme.series[k],
        forces: [
          new PointMassField([{ position: Vec2.ZERO, mass: SOLAR_MASS }]),
          ...(relativity ? [new RelativisticCorrection(Vec2.ZERO, SOLAR_MASS, C)] : []),
        ],
        particles: [
          { pos: Vec2.ZERO, mass: SOLAR_MASS, fixed: true, radius: 0.02 * AU, color: SUN_COLOR },
          { pos, vel, mass: 3.3011e23, radius: 0.008 * AU, color: theme.series[k] },
        ],
      });
    }),
};
