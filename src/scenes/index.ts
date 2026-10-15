import { freeFall } from './freeFall';
import { integratorCompare } from './integratorCompare';
import { springOscillator } from './spring';
import type { Scene } from './types';

export const SCENES: readonly Scene[] = [freeFall, springOscillator, integratorCompare];
