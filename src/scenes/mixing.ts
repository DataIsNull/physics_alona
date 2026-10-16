import { formatKelvin } from '../core/units';
import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { ARGON, GasWorld, gridPositions, seededRandom, thermalVelocities } from '../thermo/gas';
import { MASS, MD_DT, MD_DT_RANGE, MD_SPEED_RANGE, SIGMA, THERMO_NOTE } from './gasKit';
import type { Scene } from './types';

const WIDTH = 80 * SIGMA;
const HEIGHT = 40 * SIGMA;
const HOT = { ...ARGON, name: 'Гарячий', color: theme.series[7] };
const COLD = { ...ARGON, name: 'Холодний', color: theme.series[0] };

export const mixing: Scene<GasWorld> = {
  id: 'mixing',
  stage: 5,
  title: 'Тепле й холодне',
  description:
    'Ліворуч гарячий аргон (червоний), праворуч холодний (синій) — це той самий газ, кольори лише мітки. Зіткнення передають енергію від швидких атомів до повільних, і за кількасот пікосекунд температури сходяться до спільної (графік): так тепло тече від гарячого до холодного. Далі вони лише тремтять навколо неї — у системі з 400 атомів флуктуації помітні. Повільніше атоми ще й перемішуються (дифузія). Зворотне — щоб суміш сама розділилась на гарячу й холодну половини — не трапляється ніколи: це другий закон термодинаміки, ріст ентропії.',
  dt: MD_DT,
  dtRange: MD_DT_RANGE,
  speed: 30e-12,
  speedRange: MD_SPEED_RANGE,
  view: { min: new Vec2(-WIDTH / 2, -HEIGHT / 2), max: new Vec2(WIDTH / 2, HEIGHT / 2) },
  fixedIntegrators: true,
  integratorNote: THERMO_NOTE,
  params: [
    { id: 'hot', label: 'Гарячий газ', min: 100, max: 500, step: 10, value: 300, format: formatKelvin },
    { id: 'cold', label: 'Холодний газ', min: 10, max: 200, step: 10, value: 50, format: formatKelvin },
  ],
  graph: () => ({
    title: 'Температура',
    series: [
      { label: 'Гарячі атоми', color: HOT.color },
      { label: 'Холодні атоми', color: COLD.color },
      { label: 'Усі атоми', color: theme.series[2] },
    ],
    format: formatKelvin,
    sample: ([gas]) => [gas.temperature(gas.ofSpecies(0)), gas.temperature(gas.ofSpecies(1)), gas.temperature()],
  }),
  build: (_integrator, p) => {
    const random = seededRandom(11);
    const half = (sign: number) =>
      gridPositions(
        200,
        new Vec2(sign < 0 ? -WIDTH / 2 + SIGMA : SIGMA, -HEIGHT / 2 + SIGMA),
        new Vec2(sign < 0 ? -SIGMA : WIDTH / 2 - SIGMA, HEIGHT / 2 - SIGMA),
        0.3,
        random,
      );
    const hot = half(-1);
    const cold = half(1);
    const hotVel = thermalVelocities(hot.length, MASS, p.hot, random);
    const coldVel = thermalVelocities(cold.length, MASS, p.cold, random);
    return [
      new GasWorld({
        width: WIDTH,
        height: HEIGHT,
        species: [HOT, COLD],
        interaction: 'repulsive',
        colorBy: 'species',
        particles: [
          ...hot.map((pos, i) => ({ pos, vel: hotVel[i], species: 0 })),
          ...cold.map((pos, i) => ({ pos, vel: coldVel[i], species: 1 })),
        ],
        label: 'Аргон',
      }),
    ];
  },
};
