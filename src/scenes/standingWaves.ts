import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { WaveString } from '../waves/string';
import { energyGraph } from './graphs';
import { WAVE_NOTE, hertz } from './waveKit';
import type { Scene } from './types';

const L = 4; // m
const C = 4; // m/s → harmonics at n·c/2L = 0.5·n Hz

export const standingWaves: Scene<WaveString> = {
  id: 'standing-waves',
  stage: 4,
  title: 'Стоячі хвилі й резонанс',
  description:
    'Ліву частину струни розгойдує рука з малою амплітудою, правий кінець закріплений. Хвиля біжить, відбивається й накладається сама на себе. Якщо на довжині вкладається ціле число півхвиль, f = n·c/(2L) = 0.5, 1, 1.5, 2… Гц, відбиття підсилюють одне одне: це резонанс, виникає стояча хвиля з n пучностями, а енергія росте, доки її не врівноважить згасання. Трикутники — де мають бути вузли за поточної частоти. Покрути частоту між гармоніками й на них.',
  dt: 1 / 120,
  view: { min: new Vec2(-0.3, -1.3), max: new Vec2(L + 0.3, 1.3) },
  fixedIntegrators: true,
  integratorNote: WAVE_NOTE,
  params: [{ id: 'frequency', label: 'Частота руки', min: 0.2, max: 3, step: 0.01, value: 1, format: hertz }],
  graph: energyGraph({ losses: true }),
  build: (_integrator, p) => [
    new WaveString({
      length: L,
      nodes: 161,
      speed: C,
      damping: 0.15,
      left: { kind: 'driven', amplitude: 0.03, frequency: p.frequency },
      label: 'Струна',
      color: theme.series[0],
    }),
  ],
  overlay: (ctx, camera, _worlds, p) => {
    // Nodes of the standing wave sit every half wavelength from the fixed end.
    const half = C / p.frequency / 2;
    ctx.fillStyle = theme.inkSecondary;
    for (let x = L; x > 0; x -= half) {
      const sx = camera.toScreenX(x);
      const sy = camera.toScreenY(0) + 14;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(sx - 5, sy + 3);
      ctx.lineTo(sx + 5, sy + 3);
      ctx.closePath();
      ctx.fill();
    }
  },
};
