import { airDrag } from './airDrag';
import { billiards } from './billiards';
import { bouncingBalls } from './bouncingBalls';
import { cloth } from './cloth';
import { doublePendulum } from './doublePendulum';
import { freeFall } from './freeFall';
import { integratorCompare } from './integratorCompare';
import { pendulum } from './pendulum';
import { springOscillator } from './spring';
import type { Scene } from './types';

export const STAGES: Record<number, string> = {
  0: 'Етап 0 · Ядро',
  1: 'Етап 1 · Механіка точок',
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
];
