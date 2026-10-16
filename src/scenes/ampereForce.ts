import { CENTIMETRES } from '../core/units';
import { Vec2 } from '../core/vec2';
import { ChargeWorld } from '../em/charges';
import { theme } from '../render/theme';
import { CHARGE_NOTE, energyUnit } from './emKit';
import type { Scene } from './types';

const CM = 0.01;
/** Copper rod about 1.7 mm across: 0.02 kg per metre. */
const LAMBDA = 0.02;

export const ampereForce: Scene<ChargeWorld> = {
  id: 'ampere-force',
  stage: 7,
  title: 'Струми й магнітне поле',
  description:
    'Три довгі прямі провідники перпендикулярні до екрана: ⊙ — струм до нас, ⊗ — від нас. Кожен струм оточений колами магнітного поля, B = μ₀I/(2πr) (Ерстед, 1820: стрілка компаса біля дроту повертається). Колір — сила поля, лінії — його напрям; на відміну від електричних, магнітні лінії замкнені: магнітних зарядів не буває. Поле одного струму штовхає інший з силою F/L = μ₀I₁I₂/(2πd) (Ампер): однаково напрямлені струми притягуються, протилежні — відштовхуються. Саме так до 2019 року визначали ампер. Два ліві провідники вільні, правий закріплений; зміни його струм і тягни провідники мишею.',
  dt: 5e-5,
  dtRange: [1e-5, 5e-4],
  speed: 0.25,
  speedRange: [0.02, 2],
  lengthUnit: CENTIMETRES,
  view: { min: new Vec2(-7 * CM, -4.5 * CM), max: new Vec2(7 * CM, 4.5 * CM) },
  fixedIntegrators: true,
  integratorNote: CHARGE_NOTE,
  params: [{ id: 'I3', label: 'Струм правого провідника', min: -300, max: 300, step: 50, value: -200, format: (v) => `${v} А` }],
  graph: () => ({
    title: 'Енергія провідників (на метр довжини)',
    series: [
      { label: 'Кінетична', color: theme.series[0] },
      { label: 'Магнітна', color: theme.series[1] },
      { label: 'Повна', color: theme.series[2] },
    ],
    format: energyUnit,
    sample: ([sim]) => {
      const ke = sim.kineticEnergy();
      const pe = sim.potentialEnergy();
      return [ke, pe, ke + pe];
    },
  }),
  build: (_integrator, p) => [
    new ChargeWorld({
      law: 'ampere',
      particles: [
        { pos: new Vec2(-4 * CM, 1.5 * CM), q: 150, mass: LAMBDA, radius: 0.35 * CM, color: '#c98500', trail: true },
        { pos: new Vec2(-1 * CM, -1 * CM), q: 150, mass: LAMBDA, radius: 0.35 * CM, color: '#c98500', trail: true },
        { pos: new Vec2(3.5 * CM, 0), q: p.I3, mass: LAMBDA, radius: 0.35 * CM, color: '#898781', fixed: true },
      ],
      box: { min: new Vec2(-7 * CM, -4.5 * CM), max: new Vec2(7 * CM, 4.5 * CM) },
      label: 'Провідники',
    }),
  ],
};
