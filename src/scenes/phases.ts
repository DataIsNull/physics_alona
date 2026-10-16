import { formatElectronvolts, formatKelvin } from '../core/units';
import { Vec2 } from '../core/vec2';
import { drawInset } from '../render/inset';
import { theme } from '../render/theme';
import { ARGON, GasWorld, hexPositions, seededRandom, thermalVelocities } from '../thermo/gas';
import { MASS, MD_DT, MD_DT_RANGE, MD_SPEED, MD_SPEED_RANGE, SIGMA, THERMO_NOTE } from './gasKit';
import type { Scene } from './types';

const SIZE = 45 * SIGMA;
const COUNT = 300;
/** Nearest-neighbour distance of the Lennard-Jones crystal, at the potential's minimum. */
const SPACING = 2 ** (1 / 6) * SIGMA;
const R_MAX = 3 * SIGMA;

export const phases: Scene<GasWorld> = {
  id: 'phases',
  stage: 5,
  title: 'Фази: кристал, рідина, газ',
  description:
    'Атоми аргону з потенціалом Леннард-Джонса: зблизька відштовхуються, трохи далі притягуються. Термостат тримає задану температуру — крути її повільно. Приблизно до 40 К атоми сидять у гексагональній ґратці: на g(r) гострі піки на відстанях r₀, √3·r₀, 2·r₀ (риски). Близько 45–55 К ґратка плавиться в рідку краплю (піки розмиваються), а вище ~70 К атоми розлітаються в газ (g ≈ 1). Потенціальна енергія на графіку росте найкрутіше біля переходів — це прихована теплота плавлення й випаровування. У плоскому аргоні переходи нижчі, ніж у справжньому (плавлення 84 К, кипіння 87 К).',
  dt: MD_DT,
  dtRange: MD_DT_RANGE,
  speed: MD_SPEED,
  speedRange: MD_SPEED_RANGE,
  view: { min: new Vec2(-SIZE / 2, -SIZE / 2), max: new Vec2(SIZE / 2, SIZE / 2) },
  fixedIntegrators: true,
  integratorNote: THERMO_NOTE,
  params: [{ id: 'T', label: 'Температура термостата', min: 5, max: 200, step: 1, value: 20, format: formatKelvin }],
  graph: () => ({
    title: 'Енергія на атом',
    series: [
      { label: 'Потенціальна', color: theme.series[1] },
      { label: 'Кінетична (kT)', color: theme.series[0] },
    ],
    format: formatElectronvolts,
    sample: ([gas]) => [gas.potentialEnergy() / gas.n, gas.kineticEnergy() / gas.n],
  }),
  build: (_integrator, p) => {
    const vel = thermalVelocities(COUNT, MASS, p.T, seededRandom(13));
    return [
      new GasWorld({
        width: SIZE,
        height: SIZE,
        species: [ARGON],
        interaction: 'lj',
        thermostat: { temperature: p.T, time: 2e-12 },
        particles: hexPositions(COUNT, SPACING, Vec2.ZERO).map((pos, i) => ({ pos, vel: vel[i], species: 0 })),
        label: 'Аргон',
      }),
    ];
  },
  update: ([gas], p) => {
    if (gas?.thermostat) gas.thermostat.temperature = p.T;
  },
  foreground: (ctx, camera, [gas]) => {
    if (!gas) return;
    const bins = 45;
    drawInset(ctx, camera, {
      title: `Радіальний розподіл g(r) · T = ${formatKelvin(gas.temperature())}`,
      bars: gas.radialDistribution(R_MAX, bins),
      range: [0, R_MAX],
      theory: () => 1,
      formatX: (r) => `${(r / SIGMA).toFixed(0)}σ`,
      ticks: [1, Math.sqrt(3), 2].map((k) => k * SPACING),
      barLabel: 'g(r)',
      theoryLabel: 'ідеальний газ',
    });
  },
};
