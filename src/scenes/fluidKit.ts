import { formatSI } from '../core/units';
import type { Vec2 } from '../core/vec2';
import { fillLattice, wallLattice } from '../fluid/sph';

/** App step for liquid scenes; the solvers take as many sub-steps inside as they need. */
export const FLUID_DT = 1 / 60;
export const FLUID_DT_RANGE = [1 / 240, 1 / 30] as const;

export const SPH_NOTE =
  'SPH: вода — тисяча-дві частинок. Тиск — з рівняння стану Тейта (звук у 10 разів швидший за течію), рух — Störmer–Verlet із підкроками за умовою Куранта. Стінки й тіла — шари частинок у тих самих рівняннях.';
export const LBM_NOTE =
  'Решіточний Больцман D2Q9: популяції частинок стрибають між вузлами ґратки й релаксують до рівноваги (TRT); у середньому це рівняння Нав’є–Стокса.';

export const forceUnit = (v: number) => formatSI(v, 'Н');
export const energyUnit = (v: number) => formatSI(v, 'Дж');
export const speedUnit = (v: number) => formatSI(v, 'м/с');
export const lengthUnit = (v: number) => formatSI(v, 'м');

/**
 * Water and wall particles on one lattice of spacing dx over [min, max]:
 * walls fill `solid` within three layers of open space, water fills `water`.
 */
export function vessel(
  min: Vec2,
  max: Vec2,
  dx: number,
  solid: (x: number, y: number) => boolean,
  water: (x: number, y: number) => boolean,
): { fluid: Vec2[]; walls: Vec2[] } {
  return {
    fluid: fillLattice(min, max, dx, (x, y) => !solid(x, y) && water(x, y)),
    walls: wallLattice(min, max, dx, solid),
  };
}
