import { BOLTZMANN, formatElectronvolts, formatKelvin } from '../core/units';
import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { ARGON, GasWorld, gridPositions, seededRandom, thermalVelocities } from '../thermo/gas';
import { MASS, MD_DT, MD_DT_RANGE, MD_SPEED_RANGE, SIGMA, THERMO_NOTE } from './gasKit';
import type { Scene } from './types';

const WIDTH = 80 * SIGMA;
const HEIGHT = 60 * SIGMA;
const GRAIN_SIZE = 6 * SIGMA;

/** Time average of the grain's kinetic energy since the start, kept per simulation. */
const averages = new WeakMap<GasWorld, { ke: number; t: number }>();

function grainEnergy(gas: GasWorld): number {
  return 0.5 * gas.massOf(0) * (gas.vx[0] ** 2 + gas.vy[0] ** 2);
}

export const brownian: Scene<GasWorld> = {
  id: 'brownian',
  stage: 5,
  title: 'Броунівський рух',
  description:
    'Велика порошинка серед атомів аргону безладно блукає: з усіх боків її штовхають атоми, і поштовхи не врівноважуються. Броун побачив це під мікроскопом у 1827 році, Ейнштейн пояснив у 1905-му, а Перрен за цим рухом уперше «зважив» атоми. За рівнорозподілом енергії порошинка в середньому має ту саму кінетичну енергію, що й кожен атом, — kT, тому важча рухається повільніше. Графік: її енергія, усереднена від старту, проти kT — спершу порошинка нерухома, далі середнє повільно підходить до kT (для важкої — довше: кілька наносекунд).',
  dt: MD_DT,
  dtRange: MD_DT_RANGE,
  speed: 30e-12,
  speedRange: MD_SPEED_RANGE,
  view: { min: new Vec2(-WIDTH / 2, -HEIGHT / 2), max: new Vec2(WIDTH / 2, HEIGHT / 2) },
  fixedIntegrators: true,
  integratorNote: THERMO_NOTE,
  params: [
    { id: 'mass', label: 'Маса порошинки', min: 5, max: 200, step: 5, value: 50, format: (v) => `${v} атомів` },
    { id: 'T', label: 'Температура', min: 50, max: 400, step: 10, value: 200, format: formatKelvin },
  ],
  graph: () => ({
    title: 'Кінетична енергія порошинки',
    series: [
      { label: 'Середня з початку', color: theme.series[3] },
      { label: 'kT (як у кожного атома)', color: theme.series[2] },
    ],
    format: formatElectronvolts,
    sample: ([gas]) => {
      let avg = averages.get(gas);
      if (!avg || gas.t < avg.t) avg = { ke: grainEnergy(gas), t: 0 };
      // Weight by elapsed time so the average doesn't depend on the sampling rate.
      if (gas.t > 0) avg.ke += ((gas.t - avg.t) / gas.t) * (grainEnergy(gas) - avg.ke);
      avg.t = gas.t;
      averages.set(gas, avg);
      return [avg.ke, BOLTZMANN * gas.temperature(gas.ofSpecies(0))];
    },
  }),
  build: (_integrator, p) => {
    const random = seededRandom(17);
    const grain = { ...ARGON, name: 'Порошинка', mass: p.mass * MASS, sigma: GRAIN_SIZE, color: '#e8e6df' };
    const half = new Vec2(WIDTH / 2 - SIGMA, HEIGHT / 2 - SIGMA);
    const atoms = gridPositions(600, half.scale(-1), half, 0.3, random).filter((q) => q.length() > GRAIN_SIZE / 2 + SIGMA);
    const vel = thermalVelocities(atoms.length, MASS, p.T, random);
    return [
      new GasWorld({
        width: WIDTH,
        height: HEIGHT,
        species: [ARGON, grain],
        interaction: 'repulsive',
        particles: [
          { pos: Vec2.ZERO, vel: Vec2.ZERO, species: 1 },
          ...atoms.map((pos, i) => ({ pos, vel: vel[i], species: 0 })),
        ],
        trails: [0],
        label: 'Аргон і порошинка',
      }),
    ];
  },
};
