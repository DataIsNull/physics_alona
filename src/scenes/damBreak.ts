import { Vec2 } from '../core/vec2';
import { SphWorld } from '../fluid/sph';
import { theme } from '../render/theme';
import { FLUID_DT, FLUID_DT_RANGE, SPH_NOTE, energyUnit, vessel } from './fluidKit';
import type { Scene } from './types';

const W = 4.8;
const DX = 0.05;
const COLUMN = new Vec2(1.2, 1.8);
const LIQUIDS = [
  { nu: 1e-6, name: 'вода', viscosity: '10⁻⁶' },
  { nu: 1e-2, name: 'мед', viscosity: '10⁻²' },
  { nu: 0.3, name: 'лава', viscosity: '0.3' },
];

export const damBreak: Scene<SphWorld> = {
  id: 'dam-break',
  stage: 6,
  title: 'Прорив греблі',
  description:
    'Стовп води висотою 1.8 м раптом лишається без стінки. Тиск ρ·g·h біля дна виштовхує воду вбік, хвиля біжить дном, налітає на поріг і стіну, здіймається й перекидається. Колір — швидкість. Енергія на графіку: потенціальна перетікає в кінетичну, а та через в’язкість і хаос бризок — у тепло. Перемкни рідину на лаву, щоб побачити справжню в’язкість. Мед тут майже як вода: частинки по 5 см самі «в’язкі» (штучна в’язкість схеми порядку 10⁻² м²/с), тож тонка різниця губиться. Тягни воду мишею.',
  dt: FLUID_DT,
  dtRange: FLUID_DT_RANGE,
  view: { min: new Vec2(-0.3, -0.3), max: new Vec2(W + 0.3, 2.5) },
  fixedIntegrators: true,
  integratorNote: SPH_NOTE,
  loopAfter: 12,
  params: [
    {
      id: 'liquid',
      label: 'Рідина',
      min: 0,
      max: LIQUIDS.length - 1,
      step: 1,
      value: 0,
      format: (v) => `${LIQUIDS[v].name} · ν = ${LIQUIDS[v].viscosity} м²/с`,
    },
  ],
  graph: () => ({
    title: 'Енергія води',
    series: [
      { label: 'Потенціальна', color: theme.series[1] },
      { label: 'Кінетична', color: theme.series[0] },
      { label: 'Тепло', color: theme.series[3] },
    ],
    format: energyUnit,
    sample: ([sph]) => [sph.potentialEnergy(), sph.kineticEnergy(), sph.dissipated],
  }),
  build: (_integrator, p) => {
    const solid = (x: number, y: number) => x < 0 || x > W || y < 0 || (x > 3 && x < 3.3 && y < 0.25);
    const water = (x: number, y: number) => x < COLUMN.x && y < COLUMN.y;
    const { fluid, walls } = vessel(new Vec2(-0.2, -0.2), new Vec2(W + 0.2, 2.6), DX, solid, water);
    return [new SphWorld({ spacing: DX, fluid, walls, viscosity: LIQUIDS[p.liquid].nu, label: LIQUIDS[p.liquid].name })];
  },
};
