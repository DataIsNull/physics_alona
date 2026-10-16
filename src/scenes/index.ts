import { airDrag } from './airDrag';
import { ampereForce } from './ampereForce';
import { archimedes } from './archimedes';
import { atmosphere } from './atmosphere';
import { billiards } from './billiards';
import { bouncingBalls } from './bouncingBalls';
import { bridge } from './bridge';
import { brownian } from './brownian';
import { cloth } from './cloth';
import { coulombField } from './coulombField';
import { coupledPendulums } from './coupledPendulums';
import { crt } from './crt';
import { damBreak } from './damBreak';
import { doublePendulum } from './doublePendulum';
import { doubleSlit } from './doubleSlit';
import { doppler } from './doppler';
import { emWave } from './emWave';
import { freeFall } from './freeFall';
import { galaxies } from './galaxies';
import { halley } from './halley';
import { idealGas } from './idealGas';
import { incline } from './incline';
import { integratorCompare } from './integratorCompare';
import { interference } from './interference';
import { kepler } from './kepler';
import { lagrange } from './lagrange';
import { linkage } from './linkage';
import { magneticField } from './magneticField';
import { membrane } from './membrane';
import { mercury } from './mercury';
import { mixing } from './mixing';
import { phases } from './phases';
import { pendulum } from './pendulum';
import { physicalPendulum } from './physicalPendulum';
import { poiseuille } from './poiseuille';
import { railInduction } from './railInduction';
import { resonance } from './resonance';
import { solarSystem } from './solarSystem';
import { springOscillator } from './spring';
import { standingWaves } from './standingWaves';
import { stringPulse } from './stringPulse';
import { torricelli } from './torricelli';
import { tower } from './tower';
import type { Scene } from './types';
import { vessels } from './vessels';
import { vortexStreet } from './vortexStreet';

export const STAGES: Record<number, string> = {
  0: 'Етап 0 · Ядро',
  1: 'Етап 1 · Механіка точок',
  2: 'Етап 2 · Тверді тіла',
  3: 'Етап 3 · Гравітація N тіл',
  4: 'Етап 4 · Коливання і хвилі',
  5: 'Етап 5 · Термодинаміка',
  6: 'Етап 6 · Рідини',
  7: 'Етап 7 · Електромагнетизм',
};

export const SCENES: readonly Scene[] = [
  freeFall,
  springOscillator,
  integratorCompare,
  pendulum,
  doublePendulum,
  airDrag,
  bouncingBalls,
  billiards,
  cloth,
  incline,
  physicalPendulum,
  tower,
  linkage,
  bridge,
  kepler,
  solarSystem,
  lagrange,
  halley,
  mercury,
  galaxies,
  resonance,
  coupledPendulums,
  stringPulse,
  standingWaves,
  membrane,
  interference,
  doubleSlit,
  doppler,
  idealGas,
  mixing,
  phases,
  brownian,
  atmosphere,
  damBreak,
  archimedes,
  vessels,
  torricelli,
  vortexStreet,
  poiseuille,
  coulombField,
  crt,
  magneticField,
  ampereForce,
  railInduction,
  emWave,
];
