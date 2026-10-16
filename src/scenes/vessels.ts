import { Vec2 } from '../core/vec2';
import { SphWorld } from '../fluid/sph';
import { drawInset } from '../render/inset';
import { theme } from '../render/theme';
import { FLUID_DT, FLUID_DT_RANGE, SPH_NOTE, lengthUnit, vessel } from './fluidKit';
import type { Scene } from './types';

const DX = 0.04;
/** Height of the shared channel along the bottom. */
const CHANNEL = 0.2;
const TOP = 1.7;
/** The right vessel narrows upwards: its right wall leans in. */
const coneRight = (y: number) => 2 - 0.4 * Math.max(0, y - CHANNEL);
/** Columns to read each vessel's surface over. */
const SPANS = [
  [0.04, 0.76],
  [1.0, 1.16],
  [1.4, 1.6],
] as const;

function levels(sph: SphWorld): number[] {
  return SPANS.map(([a, b]) => sph.surfaceIn(a, b));
}

export const vessels: Scene<SphWorld> = {
  id: 'vessels',
  stage: 6,
  title: 'Сполучені посудини',
  description:
    'Три посудини різної форми — широка, вузька трубка й конус — з’єднані знизу. Ліва спершу повна. Вода перетікає, кілька разів гойдається туди-сюди й стає на один рівень у всіх трьох, хоч у широкій її в десятки разів більше: тиск залежить лише від глибини, p = ρ·g·h, а не від форми й кількості води над точкою (гідростатичний парадокс). Колір — тиск: однаковий на одній висоті в усіх посудинах. Вставка: середній тиск за висотою проти ρ·g·(рівень − y). Стінки тут беруть тиск просто від води (інакше вузька трубка «заїдає»), тому баланс енергії лише наближений, близько 1 %.',
  dt: FLUID_DT,
  dtRange: FLUID_DT_RANGE,
  view: { min: new Vec2(-0.2, -0.2), max: new Vec2(2.2, TOP + 0.1) },
  fixedIntegrators: true,
  integratorNote: SPH_NOTE,
  // Walls that read their pressure off the water don't store the energy of being squeezed: the books close to ~1 %.
  losesEnergy: true,
  graph: () => ({
    title: 'Рівень води',
    series: [
      { label: 'Широка', color: theme.series[0] },
      { label: 'Вузька', color: theme.series[1] },
      { label: 'Конус', color: theme.series[2] },
    ],
    format: lengthUnit,
    sample: ([sph]) => levels(sph).map((v) => (Number.isFinite(v) ? v : CHANNEL)),
  }),
  build: () => {
    const solid = (x: number, y: number) =>
      x < 0 || y < 0 || x > coneRight(y) || (y > CHANNEL && ((x > 0.8 && x < 1.0) || (x > 1.16 && x < 1.36)));
    const water = (x: number, y: number) => y < CHANNEL || (x < 0.8 ? y < 1.4 : y < 0.4);
    const { fluid, walls } = vessel(new Vec2(-0.2, -0.2), new Vec2(2.2, TOP), DX, solid, water);
    // Walls read their pressure off the water: squeezed walls would remember the first rush and hold the narrow tube low.
    return [new SphWorld({ spacing: DX, fluid, walls, wallModel: 'pressure', colorBy: 'pressure', label: 'Вода' })];
  },
  foreground: (ctx, camera, [sph]) => {
    if (!sph) return;
    const bins = 16;
    const top = 1.6;
    const sum = new Array<number>(bins).fill(0);
    const count = new Array<number>(bins).fill(0);
    for (let i = 0; i < sph.nFluid; i++) {
      const k = Math.floor((sph.y[i] / top) * bins);
      if (k < 0 || k >= bins) continue;
      sum[k] += sph.pressureOf(i);
      count[k]++;
    }
    const level = levels(sph).reduce((a, v) => a + v, 0) / SPANS.length;
    const rhoG = sph.density * sph.gravity;
    drawInset(ctx, camera, {
      title: 'Тиск за висотою, усі посудини',
      bars: sum.map((s, k) => (count[k] > 0 ? Math.max(0, s / count[k]) : 0)),
      range: [0, top],
      theory: (y) => Math.max(0, rhoG * (level - y)),
      yMax: rhoG * 1.5,
      formatX: (y) => `${y.toFixed(1)} м`,
      barLabel: 'модель',
      theoryLabel: 'ρ·g·(рівень − y)',
    });
  },
};
