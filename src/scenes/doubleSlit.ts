import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { WaveField } from '../waves/field';
import { WAVE_NOTE, hertz, metres } from './waveKit';
import type { Params, Scene } from './types';

const C = 0.3; // m/s
const BARRIER_X = -0.55; // m
const SOURCE_X = -0.8; // m, plane-wave dipper
const SCREEN_X = 0.75; // m
const DISTANCE = SCREEN_X - BARRIER_X;
const SLIT_WIDTH = 0.04; // m
/** Tall tank: the first fringes must sit well clear of the top and bottom sponges. */
const HALF_HEIGHT = 1.1;
const HALF_WIDTH = 1.1;
const SPONGE = 0.3;

/** Bright fringe m sits where d·sin θ = m·λ. */
function fringes(p: Params): number[] {
  const lambda = C / p.f;
  const ys: number[] = [];
  for (let m = -4; m <= 4; m++) {
    const s = (m * lambda) / p.d;
    if (Math.abs(s) >= 1) continue;
    const y = DISTANCE * Math.tan(Math.asin(s));
    if (Math.abs(y) < HALF_HEIGHT - SPONGE) ys.push(y);
  }
  return ys;
}

export const doubleSlit: Scene<WaveField> = {
  id: 'double-slit',
  stage: 4,
  title: 'Дві щілини',
  description:
    'Плоска хвиля проходить крізь дві вузькі щілини. За кожною вона розходиться півколами (дифракція), а далі ці дві хвилі інтерферують. На екрані праворуч жовта крива — усереднена інтенсивність: світлі смуги там, де d·sin θ = m·λ (риски — теорія). Ширші щілини чи довша хвиля розводять смуги. Цей самий дослід зі світлом довів хвильову природу світла (Юнг, 1801), а з електронами — хвильову природу речовини.',
  dt: 1 / 60,
  view: { min: new Vec2(-HALF_WIDTH, -0.85), max: new Vec2(HALF_WIDTH, 0.85) },
  fixedIntegrators: true,
  integratorNote: WAVE_NOTE,
  params: [
    { id: 'd', label: 'Відстань між щілинами', min: 0.15, max: 0.5, step: 0.01, value: 0.3, format: metres },
    { id: 'f', label: 'Частота', min: 2, max: 5, step: 0.1, value: 3, format: hertz },
  ],
  graph: () => ({
    title: 'Коливання на екрані',
    series: [
      { label: 'Центр екрана', color: theme.series[0] },
      { label: 'Біля першого мінімуму', color: theme.series[1] },
    ],
    format: metres,
    sample: ([f]) => [f.probe(0), f.probe(1)],
  }),
  build: (_integrator, p) => {
    const lambda = C / p.f;
    const firstDark = DISTANCE * Math.tan(Math.asin(Math.min(0.99, lambda / (2 * p.d))));
    return [
      new WaveField({
        width: 2 * HALF_WIDTH,
        height: 2 * HALF_HEIGHT,
        cells: 276,
        speed: C,
        edges: 'absorbing',
        sponge: SPONGE,
        walls: (x, y) =>
          Math.abs(x - BARRIER_X) < 0.012 && Math.abs(Math.abs(y) - p.d / 2) > SLIT_WIDTH / 2,
        lineSources: [{ x: SOURCE_X, frequency: p.f, amplitude: 1 }],
        probes: [new Vec2(SCREEN_X - 0.02, 0), new Vec2(SCREEN_X - 0.02, firstDark)],
        screen: { x: SCREEN_X, averaging: 1.5 },
        label: 'Хвильова ванна',
      }),
    ];
  },
  overlay: (ctx, camera, _worlds, p) => {
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    const x = camera.toScreenX(SCREEN_X);
    for (const y of fringes(p)) {
      const sy = camera.toScreenY(y);
      ctx.beginPath();
      ctx.moveTo(x - 8, sy);
      ctx.lineTo(x, sy);
      ctx.stroke();
    }
  },
};
