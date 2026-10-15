import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { WaveField } from '../waves/field';
import { WAVE_NOTE, dashedPath, metres } from './waveKit';
import type { Params, Scene } from './types';

const C = 0.3; // m/s
const F = 3; // Hz
const START = -0.6; // m
const STOP = 0.6; // m
const PROBES = [new Vec2(0.7, 0), new Vec2(-0.7, 0)];

const sourceX = (p: Params, t: number) => Math.min(START + p.mach * C * t, STOP);

export const doppler: Scene<WaveField> = {
  id: 'doppler',
  stage: 4,
  title: 'Ефект Доплера',
  description:
    'Джерело з частотою 3 Гц рухається праворуч. Попереду гребені стискаються, позаду розтягуються: нерухомий датчик A чує f′ = f/(1 − v/c), датчик B — f/(1 + v/c). Так змінюється тон сирени, що проїжджає, і так за червоним зсувом міряють швидкості галактик. Коли джерело обганяє власні хвилі (v > c), гребені складаються в конус Маха з кутом sin α = c/v (пунктир): ударна хвиля, звуковий удар, слід за човном.',
  dt: 1 / 60,
  view: { min: new Vec2(-0.9, -0.45), max: new Vec2(0.9, 0.45) },
  loopAfter: 8,
  fixedIntegrators: true,
  integratorNote: WAVE_NOTE,
  params: [{ id: 'mach', label: 'Швидкість джерела v/c', min: 0, max: 1.6, step: 0.05, value: 0.5, format: (v) => v.toFixed(2) }],
  graph: (_worlds, p) => ({
    title: 'Що чують датчики',
    series: [
      {
        label: p.mach < 1 ? `A, спереду: ${(F / (1 - p.mach)).toFixed(2)} Гц` : 'A, спереду: тиша до прольоту',
        color: theme.series[0],
      },
      { label: `B, позаду: ${(F / (1 + p.mach)).toFixed(2)} Гц`, color: theme.series[1] },
    ],
    format: metres,
    sample: ([f]) => [f.probe(0), f.probe(1)],
  }),
  build: (_integrator, p) => [
    new WaveField({
      width: 1.8,
      height: 0.9,
      cells: 271,
      speed: C,
      edges: 'absorbing',
      sponge: 0.12,
      sources: [{ position: (t) => new Vec2(sourceX(p, t), 0), frequency: F, amplitude: 50, radius: 0.01 }],
      probes: PROBES,
      label: 'Хвильова ванна',
    }),
  ],
  overlay: (ctx, camera, [field], p) => {
    if (p.mach <= 1 || !field) return;
    const x = sourceX(p, field.t);
    if (x >= STOP) return;
    // Mach cone: half-angle α with sin α = c/v, trailing behind the source.
    const alpha = Math.asin(1 / p.mach);
    const reach = 1;
    for (const sign of [-1, 1]) {
      dashedPath(ctx, camera, [new Vec2(x, 0), new Vec2(x - reach * Math.cos(alpha), sign * reach * Math.sin(alpha))], theme.ink);
    }
  },
};
