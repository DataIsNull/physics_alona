import { keplerState } from '../core/exact';
import { NewtonianGravity } from '../core/gravity';
import { ASTRONOMICAL_UNITS, AU, DAY, DEG, G, SOLAR_MASS, YEAR, formatLength } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { SUN_COLOR, barycentric } from './astroKit';
import type { Scene } from './types';

/**
 * Planets at J2000 (2000-01-01 12:00 TT): mass (kg), semi-major axis a (AU),
 * eccentricity e, mean longitude L and longitude of perihelion ϖ (degrees),
 * from JPL's approximate Keplerian elements. Inclinations are dropped: the
 * system is flattened into the ecliptic.
 */
const PLANETS = [
  { name: 'Меркурій', mass: 3.3011e23, a: 0.387_099_27, e: 0.205_635_93, L: 252.250_323_5, varpi: 77.457_796_28, size: 0.025 },
  { name: 'Венера', mass: 4.8675e24, a: 0.723_335_66, e: 0.006_776_72, L: 181.979_099_5, varpi: 131.602_467_18, size: 0.035 },
  { name: 'Земля', mass: 6.0458e24, a: 1.000_002_61, e: 0.016_711_23, L: 100.464_571_66, varpi: 102.937_681_93, size: 0.035 },
  { name: 'Марс', mass: 6.4171e23, a: 1.523_710_34, e: 0.093_394_1, L: -4.553_432_05, varpi: -23.943_629_59, size: 0.03 },
  { name: 'Юпітер', mass: 1.898_13e27, a: 5.202_887, e: 0.048_386_24, L: 34.396_440_51, varpi: 14.728_479_83, size: 0.09 },
  { name: 'Сатурн', mass: 5.6834e26, a: 9.536_675_94, e: 0.053_861_79, L: 49.954_244_23, varpi: 92.598_878_31, size: 0.08 },
  { name: 'Уран', mass: 8.681e25, a: 19.189_164_64, e: 0.047_257_44, L: 313.238_104_51, varpi: 170.954_276_3, size: 0.06 },
  { name: 'Нептун', mass: 1.024_13e26, a: 30.069_922_76, e: 0.008_590_48, L: -55.120_029_69, varpi: 44.964_762_27, size: 0.06 },
];
const INNER = 4;

function bodies() {
  const planets = PLANETS.map((p) => {
    const { pos, vel } = keplerState(
      { a: p.a * AU, e: p.e, periapsis: p.varpi * DEG, meanAnomaly: (p.L - p.varpi) * DEG },
      G * (SOLAR_MASS + p.mass),
      0,
    );
    return { pos, vel, mass: p.mass };
  });
  return barycentric([{ pos: Vec2.ZERO, vel: Vec2.ZERO, mass: SOLAR_MASS }, ...planets]);
}

export const solarSystem: Scene<World> = {
  id: 'solar-system',
  stage: 3,
  title: 'Сонячна система',
  description:
    'Сонце і вісім планет зі справжніми масами й орбітами на 1 січня 2000 року (елементи JPL), сплюснуті в площину екліптики. Кожна пара тіл притягується, тож Юпітер і Сатурн трохи розгойдують решту. Третій закон Кеплера: T² = a³ у роках і астрономічних одиницях — Меркурій обертається за 0.24 року, Юпітер за 11.9. Віддали камеру колесом, щоб побачити Сатурн, Уран і Нептун.',
  dt: DAY / 2,
  dtRange: [0.05 * DAY, 20 * DAY],
  speed: YEAR / 4,
  speedRange: [DAY, 50 * YEAR],
  lengthUnit: ASTRONOMICAL_UNITS,
  view: { min: new Vec2(-6 * AU, -5.6 * AU), max: new Vec2(6 * AU, 5.6 * AU) },
  graph: () => ({
    title: 'Відстань до Сонця (внутрішні планети)',
    series: PLANETS.slice(0, INNER).map((p, i) => ({ label: p.name, color: theme.series[i] })),
    // Plotted in AU, so the axis ticks are round numbers of AU.
    format: (v) => formatLength(v * AU, ASTRONOMICAL_UNITS),
    sample: ([world]) => {
      const sun = world.particles.position(0);
      return PLANETS.slice(0, INNER).map((_, i) => world.particles.position(i + 1).distanceTo(sun) / AU);
    },
  }),
  build: (integrator) => {
    const [sun, ...planets] = bodies();
    return [
      new World({
        integrator,
        label: 'Сонячна система',
        forces: [new NewtonianGravity()],
        particles: [
          { ...sun, radius: 0.12 * AU, color: SUN_COLOR, trail: false },
          ...planets.map((p, i) => ({ ...p, radius: PLANETS[i].size * AU, color: theme.series[i] })),
        ],
      }),
    ];
  },
};
