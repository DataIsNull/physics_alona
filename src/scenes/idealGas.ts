import { BOLTZMANN, formatKelvin } from '../core/units';
import { Vec2 } from '../core/vec2';
import { drawInset, densityHistogram } from '../render/inset';
import { theme } from '../render/theme';
import { ARGON, GasWorld, gridPositions, maxwell2D, randomDirection, seededRandom } from '../thermo/gas';
import { MASS, MD_DT, MD_DT_RANGE, MD_SPEED, MD_SPEED_RANGE, SIGMA, THERMO_NOTE, pressureUnit, speedUnit } from './gasKit';
import type { Scene } from './types';

const WIDTH = 80 * SIGMA;
const HEIGHT = 56 * SIGMA;

export const idealGas: Scene<GasWorld> = {
  id: 'ideal-gas',
  stage: 5,
  title: 'Газ у коробці',
  description:
    'Атоми аргону стартують з однаковими швидкостями у випадкових напрямках. Після кількох зіткнень швидкості розходяться в розподіл Максвелла (гістограма проти теорії) — порядок із хаосу без жодного правила. Температура — це середня кінетична енергія атома (у 2D: E = kT), тиск — імпульс, який атоми щосекунди передають стінкам. Разом вони дають P·A = N·k·T. Надлишок над ідеальним газом — від власного розміру атомів: близько 2 % для 100 атомів і помітно більше для щільнішого газу. Колір — швидкість.',
  dt: MD_DT,
  dtRange: MD_DT_RANGE,
  speed: MD_SPEED,
  speedRange: MD_SPEED_RANGE,
  view: { min: new Vec2(-WIDTH / 2, -HEIGHT / 2), max: new Vec2(WIDTH / 2, HEIGHT / 2) },
  fixedIntegrators: true,
  integratorNote: THERMO_NOTE,
  params: [
    { id: 'n', label: 'Кількість атомів', min: 100, max: 600, step: 50, value: 300 },
    { id: 'T', label: 'Температура', min: 50, max: 400, step: 10, value: 150, format: formatKelvin },
  ],
  graph: () => ({
    title: 'Тиск на стінки',
    series: [
      { label: 'Виміряний', color: theme.series[0] },
      { label: 'Ідеальний газ NkT/A', color: theme.series[1] },
    ],
    format: pressureUnit,
    sample: ([gas]) => [gas.pressure, gas.idealPressure()],
  }),
  build: (_integrator, p) => {
    const random = seededRandom(7);
    const speed = Math.sqrt((2 * BOLTZMANN * p.T) / MASS); // same energy as a gas at T
    const half = new Vec2(WIDTH / 2 - SIGMA, HEIGHT / 2 - SIGMA);
    return [
      new GasWorld({
        width: WIDTH,
        height: HEIGHT,
        species: [ARGON],
        interaction: 'repulsive',
        pressureTime: 4e-12,
        particles: gridPositions(p.n, half.scale(-1), half, 0.3, random).map((pos) => ({
          pos,
          vel: randomDirection(speed, random),
          species: 0,
        })),
        label: 'Аргон',
      }),
    ];
  },
  foreground: (ctx, camera, [gas]) => {
    if (!gas) return;
    const T = gas.temperature();
    const vMax = 3 * Math.sqrt((BOLTZMANN * T) / MASS);
    drawInset(ctx, camera, {
      title: `Швидкості атомів · T = ${formatKelvin(T)}`,
      bars: densityHistogram(gas.speeds(), 0, vMax, 24),
      range: [0, vMax],
      theory: (v) => maxwell2D(v, MASS, T),
      formatX: speedUnit,
      barLabel: 'модель',
      theoryLabel: 'Максвелл',
    });
  },
};
