import { airDrag } from './airDrag';
import { billiards } from './billiards';
import { bouncingBalls } from './bouncingBalls';
import { bridge } from './bridge';
import { cloth } from './cloth';
import { doublePendulum } from './doublePendulum';
import { freeFall } from './freeFall';
import { galaxies } from './galaxies';
import { halley } from './halley';
import { incline } from './incline';
import { integratorCompare } from './integratorCompare';
import { kepler } from './kepler';
import { lagrange } from './lagrange';
import { linkage } from './linkage';
import { mercury } from './mercury';
import { pendulum } from './pendulum';
import { physicalPendulum } from './physicalPendulum';
import { solarSystem } from './solarSystem';
import { springOscillator } from './spring';
import { tower } from './tower';
import type { Scene } from './types';

export const STAGES: Record<number, string> = {
  0: 'Етап 0 · Ядро',
  1: 'Етап 1 · Механіка точок',
  2: 'Етап 2 · Тверді тіла',
  3: 'Етап 3 · Гравітація N тіл',
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
];
