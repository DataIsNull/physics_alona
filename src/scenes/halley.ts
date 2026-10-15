import { type OrbitalElements, keplerState, orbitalPeriod } from '../core/exact';
import { NewtonianGravity, gravityTimestep } from '../core/gravity';
import { ASTRONOMICAL_UNITS, AU, DAY, G, SOLAR_MASS, YEAR, formatLength } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { SUN_COLOR, barycentric, drawReferenceCircle } from './astroKit';
import type { Scene } from './types';

const COMET = 2.2e14; // kg
const MU = G * (SOLAR_MASS + COMET);
const ORBIT: OrbitalElements = { a: 17.834 * AU, e: 0.967_14, periapsis: 0, meanAnomaly: 0 };
const PERIOD = orbitalPeriod(ORBIT.a, MU);
const START: OrbitalElements = { ...ORBIT, meanAnomaly: (-2 * Math.PI * 6 * YEAR) / PERIOD }; // 6 years before perihelion
/** The Sun's share of the separation: both bodies circle the barycentre. */
const SUN_SHARE = COMET / (SOLAR_MASS + COMET);
const exact = (t: number) => keplerState(START, MU, t).pos;

const CASES = [
  { label: 'Сталий крок', adaptive: false },
  { label: 'Адаптивний крок', adaptive: true },
];

export const halley: Scene<World> = {
  id: 'halley',
  stage: 3,
  title: 'Комета Галлея: адаптивний крок',
  description:
    'Комета Галлея (a = 17.8 а.о., e = 0.967) біля перигелію рухається в 60 разів швидше, ніж в афелії. Сталий крок 5 діб удалині достатній, а біля Сонця завеликий. Адаптивний варіант ділить крок на підкроки, коротші за 1 % часу вільного падіння √(r³/GM), лише поблизу Сонця. Підступ: при сталому кроці енергія після перигелію повертається (метод симплектичний), але комета вже на десяті частки а.о. не там — збережена енергія ще не означає точну траєкторію. Графік — відхилення від точного розв’язку Кеплера (пунктирне коло), логарифмічна шкала.',
  dt: 5 * DAY,
  dtRange: [0.1 * DAY, 60 * DAY],
  speed: 1.5 * YEAR,
  speedRange: [DAY, 50 * YEAR],
  lengthUnit: ASTRONOMICAL_UNITS,
  view: { min: new Vec2(-35.5 * AU, -5 * AU), max: new Vec2(2 * AU, 5 * AU) },
  fixedIntegrators: true,
  integratorNote: 'Обидва світи: velocity Verlet; другий ще й ділить крок на підкроки біля Сонця.',
  graph: (worlds) => ({
    title: 'Відхилення комети від точної орбіти',
    series: worlds.map((w) => ({ label: w.label, color: w.color })),
    // Plotted in AU so the log axis ticks read as powers of ten of AU.
    format: (v) => formatLength(v * AU, ASTRONOMICAL_UNITS),
    scale: 'log',
    sample: (ws) =>
      ws.map((w) => w.particles.position(1).sub(w.particles.position(0)).distanceTo(exact(w.t)) / AU),
  }),
  build: () =>
    CASES.map(({ label, adaptive }, k) => {
      const { pos, vel } = keplerState(START, MU, 0);
      const [sun, comet] = barycentric([
        { pos: Vec2.ZERO, vel: Vec2.ZERO, mass: SOLAR_MASS },
        { pos, vel, mass: COMET },
      ]);
      return new World({
        integrator: 'velocity-verlet',
        label,
        color: theme.series[k],
        forces: [new NewtonianGravity()],
        maxStep: adaptive ? gravityTimestep(0.01) : undefined,
        particles: [
          { ...sun, radius: 0.3 * AU, color: SUN_COLOR, trail: false },
          { ...comet, radius: 0.12 * AU, color: theme.series[k] },
        ],
      });
    }),
  analytic: (_world, i, t) => exact(t).scale(i === 0 ? -SUN_SHARE : 1 - SUN_SHARE),
  overlay: (ctx, camera) => drawReferenceCircle(ctx, camera, AU, 'Земля'),
};
