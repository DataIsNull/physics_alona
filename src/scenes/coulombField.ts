import { CENTIMETRES, COULOMB } from '../core/units';
import { Vec2 } from '../core/vec2';
import { ChargeWorld } from '../em/charges';
import { theme } from '../render/theme';
import { CHARGE_NOTE, energyUnit } from './emKit';
import type { Scene } from './types';

const NC = 1e-9;
const CM = 0.01;

export const coulombField: Scene<ChargeWorld> = {
  id: 'coulomb-field',
  stage: 7,
  title: 'Поле точкових зарядів',
  description:
    'Два закріплені заряди створюють навколо електричне поле. Білі лінії показують, куди штовхало б позитивний заряд: вони виходять із «+» і входять у «−». Кольорові смуги — потенціал φ = Σ k·q/r: червоне вище, синє нижче, а межі смуг — еквіпотенціалі, завжди перпендикулярні до ліній поля. Між зарядами діє закон Кулона, F = k·q₁q₂/r². Маленький від’ємний пробний заряд облітає «+», як планета Сонце (та сама залежність 1/r²), а сусідній заряд збурює його орбіту. Енергія на графіку переходить з потенціальної в кінетичну й назад. Тягни заряди мишею.',
  dt: 1e-4,
  dtRange: [2e-5, 5e-4],
  speed: 0.3,
  speedRange: [0.02, 2],
  lengthUnit: CENTIMETRES,
  view: { min: new Vec2(-8 * CM, -5 * CM), max: new Vec2(8 * CM, 5 * CM) },
  fixedIntegrators: true,
  integratorNote: CHARGE_NOTE,
  params: [{ id: 'q2', label: 'Правий заряд', min: -4, max: 4, step: 1, value: -2, format: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} нКл` }],
  graph: () => ({
    title: 'Енергія пробного заряду',
    series: [
      { label: 'Кінетична', color: theme.series[0] },
      { label: 'Потенціальна', color: theme.series[1] },
      { label: 'Повна', color: theme.series[2] },
    ],
    format: energyUnit,
    sample: ([sim]) => {
      // The fixed pair's mutual energy is a constant; leave it out so the test charge's share shows.
      const fixed = (COULOMB * sim.q[0] * sim.q[1]) / Math.hypot(sim.x[0] - sim.x[1], sim.y[0] - sim.y[1]);
      const ke = sim.kineticEnergy();
      const pe = sim.potentialEnergy() - fixed;
      return [ke, pe, ke + pe];
    },
  }),
  build: (_integrator, p) => {
    const q = -0.2 * NC;
    const m = 5e-7;
    const r = 3 * CM;
    const v = Math.sqrt((COULOMB * 3 * NC * -q) / (m * r));
    return [
      new ChargeWorld({
        particles: [
          { pos: new Vec2(-3 * CM, 0), q: 3 * NC, mass: 1, radius: 0.4 * CM, fixed: true, name: 'A' },
          { pos: new Vec2(3 * CM, 0), q: p.q2 * NC, mass: 1, radius: 0.4 * CM, fixed: true, name: 'B' },
          { pos: new Vec2(-3 * CM, r), vel: new Vec2(v, 0), q, mass: m, radius: 0.15 * CM, color: '#c3c2b7', name: 'пробний', trail: true },
        ],
        box: { min: new Vec2(-8 * CM, -5 * CM), max: new Vec2(8 * CM, 5 * CM) },
        label: 'Пробний заряд',
      }),
    ];
  },
};
