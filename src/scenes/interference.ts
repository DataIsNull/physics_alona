import { Vec2 } from '../core/vec2';
import { theme } from '../render/theme';
import { WaveField } from '../waves/field';
import { WAVE_NOTE, bisect, dashedPath, hertz, metres } from './waveKit';
import type { Params, Scene } from './types';

const C = 0.3; // m/s
const SOURCE_Y = -0.35; // m
const TOP = 0.42; // m, where the nodal lines stop (inside the sponge-free area)

const sourcesOf = (p: Params) => [new Vec2(-p.d / 2, SOURCE_Y), new Vec2(p.d / 2, SOURCE_Y)];

/** Point at height y where the path difference r₁ − r₂ equals `delta`. */
function nodalPoint(p: Params, y: number, delta: number): Vec2 | null {
  const [a, b] = sourcesOf(p);
  const diff = (x: number) => Math.hypot(x - a.x, y - a.y) - Math.hypot(x - b.x, y - b.y) - delta;
  if (Math.sign(diff(-0.78)) === Math.sign(diff(0.78))) return null;
  return new Vec2(bisect(diff, -0.78, 0.78), y);
}

/** A point on the central antinodal line and one on the first nodal line, at y = 0.2. */
const probesOf = (p: Params) => [new Vec2(0, 0.2), nodalPoint(p, 0.2, C / p.f / 2) ?? new Vec2(0.3, 0.2)];

export const interference: Scene<WaveField> = {
  id: 'interference',
  stage: 4,
  title: 'Інтерференція двох джерел',
  description:
    'Два джерела коливаються в фазі. У кожній точці їхні хвилі додаються: де різниця шляхів r₁ − r₂ — ціле число довжин хвиль, гребінь зустрічає гребінь (підсилення), де півціле — гребінь зустрічає западину, і вода майже стоїть. Ці вузлові лінії — гіперболи |r₁ − r₂| = (m + ½)λ (пунктир — теорія). Ближчі джерела або довша хвиля — менше ліній. Датчик A — на осі підсилення, B — на першій вузловій лінії.',
  dt: 1 / 60,
  view: { min: new Vec2(-0.8, -0.6), max: new Vec2(0.8, 0.6) },
  fixedIntegrators: true,
  integratorNote: WAVE_NOTE,
  params: [
    { id: 'd', label: 'Відстань між джерелами', min: 0.1, max: 0.5, step: 0.01, value: 0.3, format: metres },
    { id: 'f', label: 'Частота', min: 1.5, max: 5, step: 0.1, value: 3, format: hertz },
  ],
  graph: () => ({
    title: 'Коливання в датчиках',
    series: [
      { label: 'A — підсилення', color: theme.series[0] },
      { label: 'B — вузлова лінія', color: theme.series[1] },
    ],
    format: metres,
    sample: ([f]) => [f.probe(0), f.probe(1)],
  }),
  build: (_integrator, p) => [
    new WaveField({
      width: 1.6,
      height: 1.2,
      cells: 241,
      speed: C,
      edges: 'absorbing',
      sponge: 0.18,
      sources: sourcesOf(p).map((at) => ({ position: () => at, frequency: p.f, amplitude: 50, radius: 0.012 })),
      probes: probesOf(p),
      label: 'Хвильова ванна',
    }),
  ],
  overlay: (ctx, camera, _worlds, p) => {
    const lambda = C / p.f;
    for (let m = 0; (m + 0.5) * lambda < p.d; m++) {
      for (const sign of [-1, 1]) {
        const points: Vec2[] = [];
        for (let y = SOURCE_Y + 0.02; y <= TOP; y += 0.01) {
          const pt = nodalPoint(p, y, sign * (m + 0.5) * lambda);
          if (pt) points.push(pt);
        }
        dashedPath(ctx, camera, points, theme.inkMuted);
      }
    }
  },
};
