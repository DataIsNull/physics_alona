import { BOLTZMANN, formatKelvin } from '../core/units';
import { Vec2 } from '../core/vec2';
import { densityHistogram, drawInset } from '../render/inset';
import { theme } from '../render/theme';
import { ARGON, GasWorld, gridPositions, seededRandom, thermalVelocities } from '../thermo/gas';
import { MASS, MD_DT, MD_DT_RANGE, MD_SPEED_RANGE, SIGMA, THERMO_NOTE } from './gasKit';
import type { Scene } from './types';

const WIDTH = 60 * SIGMA;
const HEIGHT = 100 * SIGMA;
/** Gravity chosen so the scale height kT/(mg) is 20σ at 150 K: about 10¹² times Earth's. */
const GRAVITY = (BOLTZMANN * 150) / (MASS * 20 * SIGMA);
const scaleHeight = (T: number) => (BOLTZMANN * T) / (MASS * GRAVITY);

export const atmosphere: Scene<GasWorld> = {
  id: 'atmosphere',
  stage: 5,
  title: 'Атмосфера: барометрична формула',
  description:
    'Газ у полі тяжіння осідає, але не падає на дно: тепловий рух підкидає атоми вгору. Кожен шар підтримує вагу шарів над ним, і густина спадає в e разів на кожну висоту kT/(mg): n(h) ∝ e^(−mgh/kT), множник Больцмана в дії. Тяжіння тут у 10¹² разів сильніше за земне, щоб «атмосфера» вмістилася в 30 нм. У рівновазі температура на всіх висотах однакова: нижні й верхні атоми на графіку однаково гарячі, хоча верхніх у кожному шарі набагато менше; справжня атмосфера холоне вгору через конвекцію й випромінювання.',
  dt: MD_DT,
  dtRange: MD_DT_RANGE,
  speed: 30e-12,
  speedRange: MD_SPEED_RANGE,
  view: { min: new Vec2(-WIDTH / 2, -HEIGHT / 2), max: new Vec2(WIDTH / 2, HEIGHT / 2) },
  fixedIntegrators: true,
  integratorNote: THERMO_NOTE,
  params: [{ id: 'T', label: 'Температура', min: 60, max: 400, step: 10, value: 150, format: formatKelvin }],
  graph: () => ({
    title: 'Температура на різних висотах',
    series: [
      { label: 'Нижня половина атомів', color: theme.series[1] },
      { label: 'Верхня половина атомів', color: theme.series[0] },
    ],
    format: formatKelvin,
    // Split at the median height: the top half of the box is nearly empty.
    sample: ([gas]) => {
      const order = Array.from({ length: gas.n }, (_, i) => i).sort((a, b) => gas.y[a] - gas.y[b]);
      const middle = Math.floor(gas.n / 2);
      return [gas.temperature(order.slice(0, middle)), gas.temperature(order.slice(middle))];
    },
  }),
  build: (_integrator, p) => {
    const random = seededRandom(19);
    const half = new Vec2(WIDTH / 2 - SIGMA, HEIGHT / 2 - SIGMA);
    const positions = gridPositions(150, half.scale(-1), half, 0.3, random);
    const vel = thermalVelocities(positions.length, MASS, p.T, random);
    return [
      new GasWorld({
        width: WIDTH,
        height: HEIGHT,
        species: [ARGON],
        interaction: 'repulsive',
        gravity: GRAVITY,
        thermostat: { temperature: p.T, time: 5e-12 },
        particles: positions.map((pos, i) => ({ pos, vel: vel[i], species: 0 })),
        label: 'Атмосфера',
      }),
    ];
  },
  update: ([gas], p) => {
    if (gas?.thermostat) gas.thermostat.temperature = p.T;
  },
  foreground: (ctx, camera, [gas]) => {
    if (!gas) return;
    const floor = gas.y0 + SIGMA / 2;
    const top = gas.y0 + gas.height - SIGMA / 2;
    const heights = Array.from(gas.y, (y) => y - floor);
    const h = scaleHeight(gas.temperature());
    // Normalised density of the exponential on [0, top − floor].
    const span = top - floor;
    const norm = 1 / (h * (1 - Math.exp(-span / h)));
    drawInset(ctx, camera, {
      title: `Густина за висотою · kT/mg = ${(h / SIGMA).toFixed(0)}σ`,
      bars: densityHistogram(heights, 0, span, 20),
      range: [0, span],
      theory: (y) => norm * Math.exp(-y / h),
      formatX: (y) => `${(y / SIGMA).toFixed(0)}σ`,
      barLabel: 'модель',
      theoryLabel: 'e^(−mgh/kT)',
    });
  },
};
