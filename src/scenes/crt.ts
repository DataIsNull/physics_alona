import { ELECTRON_MASS, ELEMENTARY_CHARGE, formatSI } from '../core/units';
import { Vec2 } from '../core/vec2';
import { ChargeWorld } from '../em/charges';
import type { Camera } from '../render/camera';
import { theme } from '../render/theme';
import { CHARGE_NOTE } from './emKit';
import type { Scene } from './types';

const CM = 0.01;
/** Deflecting plates from x1 to x2, gap d; the screen at SCREEN. */
const X1 = 3 * CM;
const X2 = 7 * CM;
const GAP = 1.6 * CM;
const SCREEN = 25 * CM;
const e = ELEMENTARY_CHARGE;
const m = ELECTRON_MASS;

/** Electron speed after the gun's accelerating voltage: e·U = mv²/2. */
const gunSpeed = (kilovolts: number) => Math.sqrt((2 * e * kilovolts * 1e3) / m);

/** Exact path: straight, a parabola between the plates (acceleration a upward), then straight again. */
function path(age: number, v: number, a: number): Vec2 {
  const x = v * age;
  const t1 = X1 / v;
  const t2 = X2 / v;
  if (age <= t1) return new Vec2(x, 0);
  if (age <= t2) return new Vec2(x, 0.5 * a * (age - t1) ** 2);
  const T = t2 - t1;
  return new Vec2(x, 0.5 * a * T * T + a * T * (age - t2));
}

export const crt: Scene<ChargeWorld> = {
  id: 'crt',
  stage: 7,
  title: 'Електрон між пластинами',
  description:
    'Електронно-променева трубка, серце старих телевізорів і осцилографів. Гармата розганяє електрони напругою U_a до швидкості v = √(2eU_a/m), десятки тисяч кілометрів за секунду. Між пластинами поле E = U/d тягне їх до «+» зі сталою силою eE, тож шлях там — парабола, як у кинутого каменя, лише в 10¹⁵ разів швидше. Далі електрони летять прямо й світять плямою на екрані. Відхилення y = U·l·(l/2 + D)/(2d·U_a) росте з напругою на пластинах і падає з напругою гармати: швидкий електрон менше часу в полі. Пунктир — точний розв’язок.',
  dt: 1e-11,
  dtRange: [2e-12, 5e-11],
  speed: 5e-9,
  speedRange: [0.5e-9, 50e-9],
  view: { min: new Vec2(-1 * CM, -8 * CM), max: new Vec2(26 * CM, 8 * CM) },
  fixedIntegrators: true,
  integratorNote: CHARGE_NOTE,
  params: [
    { id: 'ua', label: 'Напруга гармати U_a', min: 0.5, max: 3, step: 0.5, value: 1, format: (v) => `${v} кВ` },
    { id: 'ud', label: 'Напруга на пластинах U', min: -150, max: 150, step: 10, value: 80, format: (v) => `${v} В` },
  ],
  graph: (_worlds, p) => {
    const v = gunSpeed(p.ua);
    const a = (e * (p.ud / GAP)) / m;
    const expected = path(SCREEN / v, v, a).y;
    return {
      title: 'Пляма на екрані',
      series: [
        { label: 'Модель', color: theme.series[2] },
        { label: `Теорія ${formatSI(expected, 'м')}`, color: theme.series[1] },
      ],
      format: (y) => formatSI(y, 'м'),
      sample: ([sim]) => [sim.hits.length > 0 ? sim.hits[sim.hits.length - 1] : 0, expected],
    };
  },
  build: (_integrator, p) => {
    const v = gunSpeed(p.ua);
    // Top plate positive for U > 0: the field points down and pulls the electrons up.
    const E = p.ud / GAP;
    const a = (e * E) / m;
    return [
      new ChargeWorld({
        law: 'none',
        particles: [],
        fields: [{ min: new Vec2(X1, -GAP / 2), max: new Vec2(X2, GAP / 2), E: new Vec2(0, -E) }],
        emitter: { template: { pos: Vec2.ZERO, vel: new Vec2(v, 0), q: -e, mass: m, radius: 0.08 * CM, color: '#7fd3a8' }, interval: 0.4e-9, capacity: 60 },
        screen: SCREEN,
        box: { min: new Vec2(-1 * CM, -8 * CM), max: new Vec2(SCREEN + 0.5 * CM, 8 * CM) },
        exact: (_k, age) => path(age, v, a),
        label: 'Електрони',
      }),
    ];
  },
  overlay: (ctx: CanvasRenderingContext2D, camera: Camera, _worlds, p) => {
    const v = gunSpeed(p.ua);
    const a = (e * (p.ud / GAP)) / m;
    ctx.strokeStyle = theme.ghost;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    for (let k = 0; k <= 200; k++) {
      const q = path(((SCREEN / v) * k) / 200, v, a);
      if (k === 0) ctx.moveTo(camera.toScreenX(q.x), camera.toScreenY(q.y));
      else ctx.lineTo(camera.toScreenX(q.x), camera.toScreenY(q.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // The gun.
    ctx.fillStyle = theme.inkMuted;
    ctx.fillRect(camera.toScreenX(-1 * CM), camera.toScreenY(0.4 * CM), camera.toScreenX(0) - camera.toScreenX(-1 * CM), 0.8 * CM * camera.scale);
  },
};
