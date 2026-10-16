import { CENTIMETRES } from '../core/units';
import { Vec2 } from '../core/vec2';
import { FlowWorld } from '../fluid/lbm';
import { theme } from '../render/theme';
import { FLUID_DT, FLUID_DT_RANGE, LBM_NOTE, forceUnit } from './fluidKit';
import type { Scene } from './types';

/** A 1 cm cylinder in a 1 cm/s stream; the Reynolds number is set through the viscosity. */
const D = 0.01;
const U = 0.01;
const CELLS = 24;
const DX = D / CELLS;
/** Lattice speed of the stream 0.1 (cells per step) keeps the flow well below the lattice "sound speed". */
const DT = (0.1 * DX) / U;
const NX = 15 * CELLS;
const NY = 100;
/** Domain from 3.5 D upstream to 11.5 D downstream; the cylinder sits a hair above the axis. */
const CENTER = new Vec2(4 * D, 0);
const OFFSET = 0.03 * D;
/** The wake starts with a slight upward drift, so shedding begins within seconds instead of waiting for round-off to break the symmetry. */
const KICK = 0.3 * U;

/** Upward crossings of the lift through its running mean, for the shedding frequency. */
const shedding = new WeakMap<FlowWorld, { mean: number; last: number; t: number; crossings: number[] }>();

function strouhal(flow: FlowWorld): number | null {
  let s = shedding.get(flow);
  if (!s || flow.t < s.t) s = { mean: flow.dragY, last: 0, t: flow.t, crossings: [] };
  const w = Math.min(1, (flow.t - s.t) / 10);
  s.mean += w * (flow.dragY - s.mean);
  const now = flow.dragY - s.mean;
  if (s.last < 0 && now >= 0) s.crossings = [...s.crossings.slice(-5), flow.t];
  s.last = now;
  s.t = flow.t;
  shedding.set(flow, s);
  const c = s.crossings;
  if (c.length < 3) return null;
  const period = (c[c.length - 1] - c[0]) / (c.length - 1);
  return D / (period * U);
}

export const vortexStreet: Scene<FlowWorld> = {
  id: 'vortex-street',
  stage: 6,
  title: 'Вихрова доріжка Кармана',
  description:
    'Вода обтікає циліндр діаметром 1 см. Колір — завихореність: червоне крутиться проти годинникової стрілки, синє — за нею; білі точки — барвник. Усе вирішує число Рейнольдса Re = U·D/ν, відношення інерції до в’язкості. До Re ≈ 47 за циліндром стоять два нерухомі вихори. Вище вони по черзі зриваються то згори, то знизу й пливуть шаховою доріжкою (Карман, 1911). Частота зриву — число Струхаля St = f·D/U ≈ 0.2 — майже не залежить від Re. Ця сама доріжка змушує «співати» дроти на вітрі. Щоб не чекати, поки симетрію зламають похибки округлення, слід на старті легенько штовхнуто вгору. Тягни мишею, щоб збурити потік.',
  dt: FLUID_DT,
  dtRange: FLUID_DT_RANGE,
  speed: 2,
  speedRange: [0.25, 10],
  lengthUnit: CENTIMETRES,
  view: { min: new Vec2(-3.6 * D, -2.3 * D), max: new Vec2(11.6 * D, 2.3 * D) },
  fixedIntegrators: true,
  integratorNote: LBM_NOTE,
  losesEnergy: true,
  params: [{ id: 're', label: 'Число Рейнольдса', min: 20, max: 250, step: 10, value: 100 }],
  graph: () => ({
    title: 'Сили на циліндр',
    series: [
      { label: 'Опір (уздовж потоку)', color: theme.series[1] },
      { label: 'Бічна сила', color: theme.series[0] },
    ],
    format: forceUnit,
    sample: ([flow]) => [flow.dragX * flow.thickness, flow.dragY * flow.thickness],
  }),
  build: (_integrator, p) => {
    const emitters: Vec2[] = [];
    for (let k = -6; k <= 6; k++) emitters.push(new Vec2(-3 * D, k * 0.25 * D + OFFSET));
    return [
      new FlowWorld({
        nx: NX,
        ny: NY,
        spacing: DX,
        dt: DT,
        viscosity: (U * D) / p.re,
        center: CENTER,
        boundary: 'channel',
        inflow: U,
        solid: (x, y) => x * x + (y - OFFSET) ** 2 < (D / 2) ** 2,
        initial: (x, y) => new Vec2(U, x > 0 && x < 4 * D && Math.abs(y) < D ? KICK : 0),
        emitters,
        emitEvery: 4,
        tracerLimit: 10000,
        show: 'vorticity',
        label: `Вода, Re = ${p.re}`,
      }),
    ];
  },
  foreground: (ctx, camera, [flow], p) => {
    if (!flow) return;
    const st = strouhal(flow);
    ctx.font = theme.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.ink;
    const x = camera.toScreenX(flow.x0);
    const y = camera.toScreenY(flow.y0) + 8;
    const text = st === null ? (p.re < 50 ? 'вихори не зриваються' : 'вимірюю частоту зриву…') : `St = f·D/U ≈ ${st.toFixed(2)}`;
    ctx.fillText(`Re = ${p.re} · ${text}`, x, y);
  },
};
