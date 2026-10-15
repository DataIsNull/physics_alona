import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { WaveString, travellingPulse } from '../waves/string';
import { WAVE_NOTE, metres } from './waveKit';
import type { Scene } from './types';

const L = 4; // m
const C = 2; // m/s
const PULSE = (x: number) => 0.25 * Math.exp(-(((x - 0.8) / 0.15) ** 2));
const SLOPE = (x: number) => ((-2 * (x - 0.8)) / 0.15 ** 2) * PULSE(x);
const CASES = [
  { label: 'Закріплений кінець', end: 'fixed' as const, y: 0.6 },
  { label: 'Вільний кінець', end: 'free' as const, y: -0.6 },
];

export const stringPulse: Scene<WaveString> = {
  id: 'string-pulse',
  stage: 4,
  title: 'Імпульс на струні',
  description:
    'Два однакові імпульси біжать праворуч зі швидкістю c = √(T/μ) = 2 м/с. Від закріпленого кінця (верхня струна) імпульс відбивається перевернутим: кінець не рухається, тож відбита хвиля мусить гасити прихідну. Від вільного кінця (кільце на стрижні) — неперевернутим, а кінець злітає вдвічі вище. Пунктир — точний розв’язок д’Аламбера з дзеркальними імпульсами. Струну можна смикнути мишею.',
  dt: 1 / 120,
  view: { min: new Vec2(-0.2, -1.2), max: new Vec2(L + 0.3, 1.2) },
  loopAfter: (4 * L) / C,
  fixedIntegrators: true,
  integratorNote: WAVE_NOTE,
  graph: (worlds) => ({
    title: 'Зміщення посередині струни',
    series: worlds.map((w) => ({ label: w.label, color: w.color })),
    format: metres,
    sample: (ws) => ws.map((w) => w.u[Math.round(L / 2 / w.dx)]),
  }),
  build: () =>
    CASES.map(
      ({ label, end, y }, k) =>
        new WaveString({
          length: L,
          nodes: 401,
          speed: C,
          right: { kind: end },
          origin: new Vec2(0, y),
          initial: (x) => ({ u: PULSE(x), v: -C * SLOPE(x) }),
          exact: travellingPulse(PULSE, L, C, end),
          label,
          color: theme.series[k],
        }),
    ),
};
