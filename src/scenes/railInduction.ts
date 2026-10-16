import { formatSI } from '../core/units';
import { Vec2 } from '../core/vec2';
import { RailWorld } from '../em/induction';
import type { Camera } from '../render/camera';
import { theme } from '../render/theme';
import { RAIL_NOTE, speedUnit } from './emKit';
import type { Scene } from './types';

const LENGTH = 0.5;
const MASS = 0.2;
const END = 4;
const V0 = 2;

export const railInduction: Scene<RailWorld> = {
  id: 'rail-induction',
  stage: 7,
  title: 'Електромагнітна індукція',
  description:
    'Металевий стрижень ковзає рейками, з’єднаними резистором, у магнітному полі ⊙. Рухаючись, він збільшує площу контуру, отже й магнітний потік Φ = B·L·x. За законом Фарадея (1831) це наводить ЕРС ε = −dΦ/dt = B·L·v, і контуром тече струм I = ε/R (зелені стрілки). Поле тисне на струм у стрижні з силою B·I·L, що завжди гальмує рух (правило Ленца: індукований струм протидіє своїй причині). Без тяги стрижень зупиняється за законом v = v₀·e^(−t/τ), τ = mR/(B²L²), і вся його кінетична енергія стає теплом у резисторі. З тягою F він виходить на сталу швидкість F·R/(B²L²): так працює магнітне гальмо й, навпаки, генератор. Тягни стрижень мишею — і відчуй опір.',
  dt: 1 / 240,
  view: { min: new Vec2(-0.6, -0.55), max: new Vec2(END + 0.3, 0.55) },
  fixedIntegrators: true,
  integratorNote: RAIL_NOTE,
  loopAfter: 8,
  params: [
    { id: 'B', label: 'Магнітне поле B', min: 0, max: 2, step: 0.1, value: 1, format: (v) => `${v.toFixed(1)} Тл` },
    { id: 'R', label: 'Опір R', min: 0.2, max: 5, step: 0.2, value: 1, format: (v) => `${v.toFixed(1)} Ом` },
    { id: 'pull', label: 'Тяга F', min: 0, max: 1, step: 0.1, value: 0, format: (v) => `${v.toFixed(1)} Н` },
  ],
  graph: (_worlds, p) => ({
    title: 'Швидкість стрижня',
    series: [
      { label: 'Модель', color: theme.series[3] },
      { label: 'v_т + (v₀ − v_т)·e^(−t/τ)', color: theme.series[2] },
    ],
    format: speedUnit,
    sample: ([rail]) => {
      const tau = rail.timeConstant;
      const vt = Number.isFinite(rail.terminalSpeed) ? rail.terminalSpeed : 0;
      const exact = Number.isFinite(tau) ? vt + (V0 - vt) * Math.exp(-rail.t / tau) : V0 + (p.pull / MASS) * rail.t;
      return [rail.v, exact];
    },
  }),
  build: (_integrator, p) => [
    new RailWorld({ length: LENGTH, mass: MASS, resistance: p.R, field: p.B, pull: p.pull, speed: V0, position: 0.3, end: END }),
  ],
  foreground: (ctx: CanvasRenderingContext2D, camera: Camera, [rail]) => {
    if (!rail) return;
    ctx.font = theme.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const x = camera.toScreenX(rail.x) + 14;
    const y = camera.toScreenY(LENGTH / 2) + 6;
    const lines = [
      `ε = B·L·v = ${formatSI(rail.emf(), 'В')}`,
      `I = ε/R = ${formatSI(rail.current(), 'А')}`,
      `F = B·I·L = ${formatSI(Math.abs(rail.brakingForce()), 'Н')}`,
    ];
    ctx.fillStyle = theme.ink;
    lines.forEach((text, k) => ctx.fillText(text, x, y + 14 * k));
  },
};
