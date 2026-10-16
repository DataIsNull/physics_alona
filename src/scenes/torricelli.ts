import { Vec2 } from '../core/vec2';
import { SphWorld } from '../fluid/sph';
import type { Camera } from '../render/camera';
import { theme } from '../render/theme';
import { FLUID_DT, FLUID_DT_RANGE, SPH_NOTE, speedUnit, vessel } from './fluidKit';
import type { Scene } from './types';

const DX = 0.04;
/** Top of the tank's floor, m above the ground. */
const BASE = 0.6;
const TANK = 0.8;
const WALL = 3 * DX;
const HOLE = [BASE, BASE + 4 * DX] as const;
const HOLE_Y = (HOLE[0] + HOLE[1]) / 2;
const FAR = 3;

/** Head h: height of the surface above the hole, m. */
function head(sph: SphWorld): number {
  const surface = sph.surfaceIn(-TANK + DX, -DX);
  return Number.isFinite(surface) ? Math.max(0, surface - HOLE_Y) : 0;
}

/** Mean speed of the water just outside the hole, where the jet has stopped contracting, m/s. */
function jetSpeed(sph: SphWorld): number {
  let v = 0;
  let count = 0;
  for (let i = 0; i < sph.nFluid; i++) {
    if (sph.x[i] > WALL && sph.x[i] < WALL + 3 * DX && sph.y[i] > HOLE[0] - 2 * DX && sph.y[i] < HOLE[1]) {
      v += Math.hypot(sph.vx[i], sph.vy[i]);
      count++;
    }
  }
  return count > 0 ? v / count : 0;
}

export const torricelli: Scene<SphWorld> = {
  id: 'torricelli',
  stage: 6,
  title: 'Закон Торрічеллі',
  description:
    'Вода б’є з отвору біля дна бака. Торрічеллі (1643): швидкість струменя така, ніби вода впала з висоти h від поверхні до отвору, v = √(2gh) — енергія, а не тиск, задає швидкість. Пунктир — ідеальна парабола з такою швидкістю. Поки бак порожніє, h падає, а з нею швидкість і дальність. Справжній отвір дає ~97 % від √(2gh); тут — 80–90 %: великі частинки в’язкіші за воду, а отвір лише в чотири частинки заввишки.',
  dt: FLUID_DT,
  dtRange: FLUID_DT_RANGE,
  view: { min: new Vec2(-1.1, -0.2), max: new Vec2(FAR + 0.1, BASE + 1.9) },
  fixedIntegrators: true,
  integratorNote: SPH_NOTE,
  loopAfter: 8,
  params: [{ id: 'level', label: 'Рівень води в баку', min: 0.6, max: 1.6, step: 0.2, value: 1.2, format: (v) => `${v.toFixed(1)} м` }],
  graph: () => ({
    title: 'Швидкість струменя',
    series: [
      { label: 'Модель', color: theme.series[0] },
      { label: '√(2gh)', color: theme.series[2] },
    ],
    format: speedUnit,
    sample: ([sph]) => [jetSpeed(sph), Math.sqrt(2 * sph.gravity * head(sph))],
  }),
  build: (_integrator, p) => {
    const top = BASE + p.level + 0.4;
    const solid = (x: number, y: number) =>
      y < 0 ||
      x < -TANK - WALL - 0.2 ||
      x > FAR ||
      (x > -TANK - WALL && x < WALL && y > BASE - WALL && y < BASE) ||
      (x > -TANK - WALL && x < -TANK && y > BASE - WALL) ||
      (x > 0 && x < WALL && y > BASE - WALL && !(y > HOLE[0] && y < HOLE[1]));
    const water = (x: number, y: number) => x > -TANK && x < 0 && y > BASE && y < BASE + p.level;
    const { fluid, walls } = vessel(new Vec2(-TANK - WALL - 0.36, -0.2), new Vec2(FAR + 0.2, top), DX, solid, water);
    return [new SphWorld({ spacing: DX, fluid, walls, label: 'Вода' })];
  },
  overlay: (ctx: CanvasRenderingContext2D, camera: Camera, [sph]) => {
    if (!sph) return;
    const v = Math.sqrt(2 * sph.gravity * head(sph));
    if (v < 0.05) return;
    // Ideal jet: x = v·t, y = y₀ − g·t²/2, from the outer face of the wall.
    ctx.strokeStyle = theme.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    for (let t = 0; ; t += 0.01) {
      const x = WALL + v * t;
      const y = HOLE_Y - 0.5 * sph.gravity * t * t;
      if (t === 0) ctx.moveTo(camera.toScreenX(x), camera.toScreenY(y));
      else ctx.lineTo(camera.toScreenX(x), camera.toScreenY(y));
      if (y < 0 || x > FAR) break;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  },
};
