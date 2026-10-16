import { CENTIMETRES } from '../core/units';
import { Vec2 } from '../core/vec2';
import { FlowWorld, startingPoiseuille } from '../fluid/lbm';
import { drawInset } from '../render/inset';
import { theme } from '../render/theme';
import { FLUID_DT, FLUID_DT_RANGE, LBM_NOTE, speedUnit } from './fluidKit';
import type { Scene } from './types';

/** Oil in a 2 cm slit between two plates. */
const H = 0.02;
const NY = 30;
const NX = 90;
const DX = H / NY;
const NU = 1e-4;
const DENSITY = 900;
const TAU = 1.5;
const DT = (((TAU - 0.5) / 3) * DX * DX) / NU;
const MIDDLE = NY / 2;

const centreline = (flow: FlowWorld) => flow.ux[MIDDLE * flow.nx + flow.nx / 2] * flow.velocityUnit;

export const poiseuille: Scene<FlowWorld> = {
  id: 'poiseuille',
  stage: 6,
  title: 'В’язка течія між пластинами',
  description:
    'Олія між двома пластинами, спершу нерухома, і раптом на неї діє перепад тиску. Шари рідини тягнуть один одного через в’язкість, а біля стінок рідина прилипає (u = 0). Рух поширюється від середини до стінок дифузією за час ~H²/ν, і профіль стає параболою Пуазейля: u = (G/2μ)·y·(H − y). Помаранчеві лінії барвника, випущені з лівого краю, вигинаються в ту саму параболу. Графік і вставка — модель проти точного розв’язку (ряд Фур’є): розбіжність менша за товщину лінії. Тягни мишею, щоб збурити потік.',
  dt: FLUID_DT,
  dtRange: FLUID_DT_RANGE,
  lengthUnit: CENTIMETRES,
  view: { min: new Vec2(-1.6 * H, -0.7 * H), max: new Vec2(1.6 * H, 0.7 * H) },
  fixedIntegrators: true,
  integratorNote: LBM_NOTE,
  losesEnergy: true,
  loopAfter: 10,
  params: [{ id: 'G', label: 'Перепад тиску', min: 5, max: 50, step: 5, value: 20, format: (v) => `${v} Па/м` }],
  graph: (_worlds, p) => ({
    title: 'Швидкість посередині каналу',
    series: [
      { label: 'Модель', color: theme.series[0] },
      { label: 'Точний розв’язок', color: theme.series[2] },
    ],
    format: speedUnit,
    sample: ([flow]) => [centreline(flow), startingPoiseuille((MIDDLE + 0.5) * DX, flow.t, H, NU, p.G / DENSITY)],
  }),
  build: (_integrator, p) => {
    const emitters: Vec2[] = [];
    for (let j = 0; j < NY; j += 2) emitters.push(new Vec2(-1.45 * H, -H / 2 + (j + 1) * DX));
    return [
      new FlowWorld({
        nx: NX,
        ny: NY,
        spacing: DX,
        dt: DT,
        viscosity: NU,
        density: DENSITY,
        boundary: 'periodic',
        force: new Vec2(p.G / DENSITY, 0),
        emitters,
        emitEvery: Math.round(0.5 / DT),
        tracerLimit: emitters.length * 12,
        show: 'speed',
        label: 'Олія',
      }),
    ];
  },
  foreground: (ctx, camera, [flow], p) => {
    if (!flow) return;
    const g = p.G / DENSITY;
    const steady = (g * H * H) / (8 * NU);
    drawInset(ctx, camera, {
      title: `Профіль швидкості · u_max = ${speedUnit(steady)}`,
      bars: flow.profile(flow.nx / 2),
      range: [0, H],
      theory: (s) => startingPoiseuille(s, flow.t, H, NU, g),
      yMax: 1.1 * steady,
      formatX: (s) => `${(s * 1000).toFixed(0)} мм`,
      barLabel: 'модель',
      theoryLabel: 'точний розв’язок',
    });
  },
};
