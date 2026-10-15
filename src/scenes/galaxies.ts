import { BarnesHutGravity } from '../core/gravity';
import type { ParticleSpec } from '../core/particles';
import { G, KILOPARSECS, KPC, SOLAR_MASS, YEAR, formatLength } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import type { Scene } from './types';

const MYR = 1e6 * YEAR;
const STARS_PER_GALAXY = 1200;
const CORE_MASS = 1e10 * SOLAR_MASS; // bulge and black hole, lumped
const DISC_MASS = 2e9 * SOLAR_MASS;
const DISC_INNER = 1 * KPC;
const DISC_OUTER = 7 * KPC;
const SOFTENING = 0.3 * KPC;
const SEPARATION = 30 * KPC; // at the start
const PERICENTRE = 8 * KPC; // of the parabolic encounter

/** Seeded generator, so every reset rebuilds the same galaxies. */
function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A disc of stars on circular orbits around a heavy core, moving as a whole. */
function galaxy(centre: Vec2, velocity: Vec2, seed: number, color: string): ParticleSpec[] {
  const rnd = random(seed);
  const starMass = DISC_MASS / STARS_PER_GALAXY;
  const stars: ParticleSpec[] = [{ pos: centre, vel: velocity, mass: CORE_MASS, radius: 0.35 * KPC, color: theme.ink }];
  for (let i = 0; i < STARS_PER_GALAXY; i++) {
    // Uniform surface density between the inner and outer radius.
    const r = Math.sqrt(DISC_INNER ** 2 + rnd() * (DISC_OUTER ** 2 - DISC_INNER ** 2));
    const angle = 2 * Math.PI * rnd();
    const inside = CORE_MASS + (DISC_MASS * (r * r - DISC_INNER ** 2)) / (DISC_OUTER ** 2 - DISC_INNER ** 2);
    const speed = Math.sqrt((G * inside) / Math.sqrt(r * r + SOFTENING ** 2));
    const offset = Vec2.fromAngle(angle, r);
    stars.push({
      pos: centre.add(offset),
      vel: velocity.add(offset.perp().normalize().scale(speed)), // counter-clockwise
      mass: starMass,
      radius: 0.01 * KPC,
      color,
      trail: false,
    });
  }
  return stars;
}

/** Two equal galaxies on a parabolic orbit with the given pericentre. */
function encounter(): ParticleSpec[] {
  const mu = G * 2 * (CORE_MASS + DISC_MASS);
  const speed = Math.sqrt((2 * mu) / SEPARATION);
  const tangential = Math.sqrt(2 * mu * PERICENTRE) / SEPARATION;
  const relative = new Vec2(-Math.sqrt(speed * speed - tangential * tangential), tangential);
  const half = new Vec2(SEPARATION / 2, 0);
  return [
    ...galaxy(half.scale(-1), relative.scale(-0.5), 1, theme.series[0]),
    ...galaxy(half, relative.scale(0.5), 2, theme.series[1]),
  ];
}

const CORE_B = STARS_PER_GALAXY + 1;

export const galaxies: Scene<World> = {
  id: 'galaxies',
  stage: 3,
  title: 'Зіткнення галактик',
  description:
    'Дві дискові галактики по 1200 зірок і важкому ядру проходять одна повз одну по параболі. Кожна зірка притягує кожну, але пряма сума — 2.9 млн пар на крок — для браузера заважка. Алгоритм Barnes–Hut групує далекі зірки в клітинах квадродерева й рахує їх як одну масу: O(n log n) замість O(n²) при похибці близько відсотка. Припливні сили витягують із дисків довгі хвости, як у галактик Антени (NGC 4038/4039).',
  dt: 0.5 * MYR,
  dtRange: [0.05 * MYR, 5 * MYR],
  speed: 25 * MYR,
  speedRange: [MYR, 300 * MYR],
  integrator: 'leapfrog',
  loopAfter: 1000 * MYR,
  lengthUnit: KILOPARSECS,
  view: { min: new Vec2(-32 * KPC, -20 * KPC), max: new Vec2(32 * KPC, 20 * KPC) },
  graph: () => ({
    title: 'Відстань між ядрами',
    series: [{ label: 'Ядра', color: theme.series[2] }],
    // Plotted in kpc, so the axis ticks are round numbers of kpc.
    format: (v) => formatLength(v * KPC, KILOPARSECS),
    sample: ([world]) => [world.particles.position(0).distanceTo(world.particles.position(CORE_B)) / KPC],
  }),
  build: (integrator) => [
    new World({
      integrator,
      label: 'Галактики',
      forces: [new BarnesHutGravity(0.6, SOFTENING)],
      particles: encounter(),
    }),
  ],
};
