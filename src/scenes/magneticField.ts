import { CENTIMETRES, ELEMENTARY_CHARGE, PROTON_MASS } from '../core/units';
import { Vec2 } from '../core/vec2';
import { ChargeWorld } from '../em/charges';
import { theme } from '../render/theme';
import { CHARGE_NOTE, speedUnit } from './emKit';
import type { Scene } from './types';

const e = ELEMENTARY_CHARGE;
const mp = PROTON_MASS;
const SPEED = 1e6;
const KINDS = [
  { name: 'Протон', q: e, mass: mp, color: '#e66767' },
  { name: 'Антипротон', q: -e, mass: mp, color: '#3987e5' },
  { name: 'Альфа-частинка', q: 2 * e, mass: 4 * mp, color: '#c98500' },
  { name: 'Іон He⁺', q: e, mass: 4 * mp, color: '#199e70' },
];

/**
 * Exact motion from the origin with velocity (v, 0) in B along z and E along y:
 * drift E/B along x plus a circle at ω = −qB/m in the drifting frame.
 */
function exact(kind: (typeof KINDS)[number], B: number, E: number, t: number): Vec2 {
  const drift = E / B;
  const w = (-kind.q * B) / kind.mass;
  const ux = SPEED - drift;
  const uy = 0;
  const s = Math.sin(w * t);
  const c = Math.cos(w * t);
  // ∫₀ᵗ R(ωτ)dτ·u = [sin ωt, −(1 − cos ωt); 1 − cos ωt, sin ωt]·u/ω
  return new Vec2(drift * t + (s * ux - (1 - c) * uy) / w, ((1 - c) * ux + s * uy) / w);
}

export const magneticField: Scene<ChargeWorld> = {
  id: 'magnetic-field',
  stage: 7,
  title: 'Заряди в магнітному полі',
  description:
    'Чотири частинки вилітають з однієї точки з однаковою швидкістю 1000 км/с у магнітне поле, напрямлене до нас (кружечки ⊙). Сила Лоренца F = q·v×B завжди перпендикулярна до швидкості, тож поле лише повертає частинку, ніколи не розганяючи: швидкість на графіку стала, а шлях — коло радіусом r = mv/(qB). Антипротон крутиться в інший бік. Альфа-частинка вчетверо важча за протон, але й заряд має подвійний: її коло вдвічі більше. He⁺ має той самий заряд, що й протон, і вчетверо більшу масу: коло вчетверо більше. Додай електричне поле E — і кола поповзуть убік зі швидкістю E/B (дрейф E×B), однаковою для всіх. На цьому принципі працюють циклотрон і мас-спектрометр. Пунктирні точки — точний розв’язок.',
  dt: 2e-10,
  dtRange: [2e-11, 1e-9],
  speed: 50e-9,
  speedRange: [5e-9, 500e-9],
  lengthUnit: CENTIMETRES,
  view: { min: new Vec2(-0.09, -0.09), max: new Vec2(0.09, 0.03) },
  fixedIntegrators: true,
  integratorNote: CHARGE_NOTE,
  params: [
    { id: 'B', label: 'Магнітне поле B', min: 0.2, max: 2, step: 0.1, value: 1, format: (v) => `${v.toFixed(1)} Тл` },
    { id: 'E', label: 'Електричне поле E', min: 0, max: 100, step: 10, value: 0, format: (v) => `${v} кВ/м` },
  ],
  graph: () => ({
    title: 'Швидкість частинок',
    series: [
      { label: 'Протон', color: KINDS[0].color },
      { label: 'Іон He⁺', color: KINDS[3].color },
    ],
    format: speedUnit,
    sample: ([sim]) => [sim.speed(0), sim.speed(3)],
  }),
  build: (_integrator, p) => {
    const E = p.E * 1e3;
    return [
      new ChargeWorld({
        law: 'none',
        fields: [{ B: p.B, E: new Vec2(0, E) }],
        particles: KINDS.map((k) => ({ pos: Vec2.ZERO, vel: new Vec2(SPEED, 0), q: k.q, mass: k.mass, radius: 0.0012, color: k.color, name: k.name, trail: true })),
        exact: (i, t) => exact(KINDS[i], p.B, E, t),
        label: 'Частинки',
      }),
    ];
  },
  overlay: (ctx, camera, [sim]) => {
    if (!sim) return;
    ctx.fillStyle = theme.ghost;
    for (let i = 0; i < sim.n; i++) {
      const q = sim.exactPosition(i);
      if (!q) continue;
      ctx.beginPath();
      ctx.arc(camera.toScreenX(q.x), camera.toScreenY(q.y), 5, 0, 2 * Math.PI);
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = theme.ghost;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },
};
