import { formatSI } from '../core/units';
import { ARGON } from '../thermo/gas';

export const SIGMA = ARGON.sigma;
export const MASS = ARGON.mass;
/** Lennard-Jones time unit σ·√(m/ε) ≈ 2.2 ps. */
export const TAU = SIGMA * Math.sqrt(MASS / ARGON.epsilon);
/** Molecular-dynamics step, about 10 fs. */
export const MD_DT = 0.005 * TAU;
export const MD_DT_RANGE = [0.001 * TAU, 0.012 * TAU] as const;
/** Simulated picoseconds per real second. */
export const MD_SPEED = 10e-12;
export const MD_SPEED_RANGE = [0.5e-12, 100e-12] as const;

export const THERMO_NOTE =
  'Молекулярна динаміка: velocity Verlet із кроком ~10 фс; сили між атомами — потенціал Леннард-Джонса через список комірок.';

export const pressureUnit = (v: number) => formatSI(v, 'Н/м');
export const speedUnit = (v: number) => `${Math.round(v)} м/с`;
