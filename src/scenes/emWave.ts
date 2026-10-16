import { SPEED_OF_LIGHT, formatSI } from '../core/units';
import { Vec2 } from '../core/vec2';
import { MaxwellWorld } from '../em/fdtd';
import { theme } from '../render/theme';
import { FDTD_NOTE } from './emKit';
import type { Scene } from './types';

const UM = 1e-6;
const DX = 25e-9;
const NX = 400;
const NY = 240;
const GLASS = [0.5 * UM, 2.5 * UM] as const;

export const emWave: Scene<MaxwellWorld> = {
  id: 'em-wave',
  stage: 7,
  title: 'Світло — електромагнітна хвиля',
  description:
    'Рівняння Максвелла (1865) на сітці. Змінне електричне поле породжує магнітне, а змінне магнітне — електричне (закон Фарадея); так вони підтримують одне одного й біжать хвилею зі швидкістю c = 1/√(ε₀μ₀) ≈ 300 000 км/с. Максвелл порахував це число з електричних дослідів і впізнав у ньому швидкість світла: світло — це електромагнітна хвиля. Колір — поле E (червоне вгору з екрана, синє вниз), білий кружечок — антена (тягни мишею). Праворуч скло: у ньому хвиля сповільнюється в n разів, і довжина хвилі коротшає; частина світла відбивається від поверхонь і інтерферує з падаючим.',
  dt: 2e-16,
  dtRange: [5e-17, 1e-15],
  speed: 3e-15,
  speedRange: [2e-16, 3e-14],
  view: { min: new Vec2((-NX / 2) * DX, (-NY / 2) * DX), max: new Vec2((NX / 2) * DX, (NY / 2) * DX) },
  fixedIntegrators: true,
  integratorNote: FDTD_NOTE,
  losesEnergy: true,
  params: [
    { id: 'n', label: 'Показник заломлення скла', min: 1, max: 2.5, step: 0.1, value: 1.5, format: (v) => `n = ${v.toFixed(1)}` },
    { id: 'lambda', label: 'Довжина хвилі', min: 400, max: 700, step: 50, value: 500, format: (v) => `${v} нм` },
    { id: 'plane', label: 'Джерело', min: 0, max: 1, step: 1, value: 0, format: (v) => (v ? 'плоска хвиля' : 'антена') },
  ],
  graph: (_worlds, p) => ({
    title: `Поле E у точках A (повітря) і B (скло) · період ${((p.lambda * 1e-9) / SPEED_OF_LIGHT * 1e15).toFixed(2)} фс`,
    series: [
      { label: 'A', color: theme.series[0] },
      { label: 'B', color: theme.series[1] },
    ],
    format: (v) => formatSI(v, 'В/м'),
    sample: ([sim]) => sim.probeValues(),
  }),
  build: (_integrator, p) => [
    new MaxwellWorld({
      nx: NX,
      ny: NY,
      spacing: DX,
      edges: p.plane ? 'periodic' : 'absorbing',
      permittivity: (x) => (x > GLASS[0] && x < GLASS[1] ? p.n * p.n : 1),
      sources: [
        p.plane
          ? { kind: 'line', position: new Vec2(-3.6 * UM, 0), wavelength: p.lambda * 1e-9, amplitude: 1 }
          : { kind: 'point', position: new Vec2(-2.5 * UM, 0.3 * UM), wavelength: p.lambda * 1e-9, amplitude: 1 },
      ],
      probes: [new Vec2(-1 * UM, 1 * UM), new Vec2(1.5 * UM, 1 * UM)],
      label: 'Світло',
    }),
  ],
};
