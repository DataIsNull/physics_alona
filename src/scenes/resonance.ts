import { drivenAmplitude, drivenOscillator } from '../core/exact';
import { HarmonicForce, LinearDrag, Spring } from '../core/forces';
import { formatSI } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { hertz } from './waveKit';
import type { Params, Scene } from './types';

const NATURAL = [0.6, 0.8, 1, 1.25, 1.6]; // Hz
const MASS = 0.5; // kg
const PUSH = 1.2; // force per mass, m/s²
const ROW = 0.7; // m between oscillators
const ANCHOR_X = -2.4; // springs hang from here; rest position x = 0
const rowY = (i: number) => (NATURAL.length - 1 - i) * ROW;

const omegaOf = (hz: number) => 2 * Math.PI * hz;

export const resonance: Scene<World> = {
  id: 'resonance',
  stage: 4,
  title: 'Резонанс',
  description:
    'П’ять тягарців на пружинах із власними частотами від 0.6 до 1.6 Гц штовхає та сама періодична сила. Найсильніше розгойдується той, чия власна частота збігається з частотою сили: амплітуда A = (F/m)/√((ω₀² − ω²)² + γ²ω²). Згасання γ обмежує пік і розширює його. Пунктир — точний розв’язок разом із перехідним процесом; у легенді — усталені амплітуди. Покрути частоту й згасання.',
  dt: 1 / 240,
  view: { min: new Vec2(-2.6, -0.5), max: new Vec2(1.5, (NATURAL.length - 1) * ROW + 0.5) },
  params: [
    { id: 'frequency', label: 'Частота сили', min: 0.4, max: 2, step: 0.01, value: 1, format: hertz },
    { id: 'damping', label: 'Згасання γ', min: 0.05, max: 1.5, step: 0.05, value: 0.3, format: (v) => `${v.toFixed(2)} с⁻¹` },
  ],
  graph: (_worlds, p) => ({
    title: 'Зміщення тягарців',
    series: NATURAL.map((f0, i) => {
      const A = drivenAmplitude(omegaOf(f0), p.damping, PUSH, omegaOf(p.frequency));
      return { label: `f₀ = ${f0} Гц · A = ${formatSI(A, 'м', 2)}`, color: theme.series[i] };
    }),
    format: (v) => formatSI(v, 'м'),
    sample: ([world]) => NATURAL.map((_, i) => world.particles.pos[2 * i]),
  }),
  build: (integrator, p: Params) => [
    new World({
      integrator,
      label: 'Осцилятори',
      forces: [
        ...NATURAL.map((f0, i) => new Spring(new Vec2(ANCHOR_X, rowY(i)), i, MASS * omegaOf(f0) ** 2, -ANCHOR_X)),
        new LinearDrag(p.damping * MASS),
        new HarmonicForce(
          NATURAL.map((_, i) => i),
          PUSH * MASS,
          omegaOf(p.frequency),
        ),
      ],
      particles: NATURAL.map((_, i) => ({ pos: new Vec2(0, rowY(i)), mass: MASS, radius: 0.12, color: theme.series[i], trail: false })),
    }),
  ],
  analytic: (_world, i, t, p) => new Vec2(drivenOscillator(omegaOf(NATURAL[i]), p.damping, PUSH, omegaOf(p.frequency), t), rowY(i)),
};
