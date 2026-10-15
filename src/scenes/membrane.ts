import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { WaveField, gridModeFrequency } from '../waves/field';
import { WAVE_NOTE, metres } from './waveKit';
import type { Scene } from './types';

const SIZE = 1; // m, square drum
const C = 1; // m/s
const AMPLITUDE = 0.02; // m
const PROBE = new Vec2(-0.32, 0.18);
const APP_STEP = 1 / 60;

const shape = (m: number, n: number) => (x: number, y: number) =>
  Math.sin((m * Math.PI * (x + SIZE / 2)) / SIZE) * Math.sin((n * Math.PI * (y + SIZE / 2)) / SIZE);

const modeFrequency = (m: number, n: number) => (C / 2) * Math.hypot(m / SIZE, n / SIZE);

export const membrane: Scene<WaveField> = {
  id: 'membrane',
  stage: 4,
  title: 'Мембрана: моди барабана',
  description:
    'Квадратна мембрана з закріпленим краєм коливається в одній власній моді (m, n): m і n півхвиль уздовж сторін, частота f = (c/2)·√(m²/a² + n²/b²). Сірі лінії вузлів не рухаються, сусідні ділянки ходять у протифазі — це фігури Хладні. Обертони барабана не кратні основному тону, тому він звучить «глухо», а не як струна. Ткни мембрану мишею, щоб збудити суміш мод. Пунктирна крива на графіку — точний розв’язок.',
  dt: APP_STEP,
  view: { min: new Vec2(-0.55, -0.55), max: new Vec2(0.55, 0.55) },
  fixedIntegrators: true,
  integratorNote: WAVE_NOTE,
  params: [
    { id: 'm', label: 'Півхвиль уздовж x (m)', min: 1, max: 6, step: 1, value: 2 },
    { id: 'n', label: 'Півхвиль уздовж y (n)', min: 1, max: 6, step: 1, value: 1 },
  ],
  graph: (worlds, p) => {
    const field = worlds[0];
    const omega = gridModeFrequency(p.m, p.n, field, field.substep(APP_STEP));
    const phi = shape(p.m, p.n)(PROBE.x, PROBE.y);
    return {
      title: `Зміщення в точці A · f = ${modeFrequency(p.m, p.n).toFixed(3)} Гц`,
      series: [
        { label: 'Модель', color: theme.series[0] },
        { label: 'Точний розв’язок', color: theme.series[2] },
      ],
      format: metres,
      sample: ([f]) => [f.probe(0), AMPLITUDE * phi * Math.cos(omega * f.t)],
    };
  },
  build: (_integrator, p) => {
    const mode = shape(p.m, p.n);
    let omega = 0;
    const field: WaveField = new WaveField({
      width: SIZE,
      height: SIZE,
      cells: 101,
      speed: C,
      edges: 'fixed',
      initial: (x, y) => ({ u: AMPLITUDE * mode(x, y), v: 0 }),
      probes: [PROBE],
      exact: (x, y, t) => AMPLITUDE * mode(x, y) * Math.cos(omega * t),
      label: `Мода (${p.m}, ${p.n})`,
    });
    omega = gridModeFrequency(p.m, p.n, field, field.substep(APP_STEP));
    return [field];
  },
};
