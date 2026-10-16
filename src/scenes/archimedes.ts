import { Vec2 } from '../core/vec2';
import { SphWorld } from '../fluid/sph';
import type { Camera } from '../render/camera';
import { theme } from '../render/theme';
import { FLUID_DT, FLUID_DT_RANGE, SPH_NOTE, forceUnit, vessel } from './fluidKit';
import type { Scene } from './types';

const W = 3;
const DEPTH = 1.2;
const DX = 0.05;
const SIZE = 0.5;
const WATER = 1000;
const MATERIALS = new Map([
  [200, 'корок'],
  [500, 'сосна'],
  [700, 'дуб'],
  [900, 'лід'],
  [1000, 'як вода'],
  [1300, 'пластик'],
  [2400, 'бетон'],
  [2700, 'алюміній'],
]);

/** Buoyancy smoothed over ~0.15 s: SPH pressure on a few particles is noisy. */
const smoothed = new WeakMap<SphWorld, { force: number; t: number }>();

function buoyancy(sph: SphWorld): number {
  const b = sph.bodies[0];
  let s = smoothed.get(sph);
  if (!s || sph.t < s.t) s = { force: sph.buoyancy(b), t: sph.t };
  s.force += Math.min(1, (sph.t - s.t) / 0.15) * (sph.buoyancy(b) - s.force);
  s.t = sph.t;
  smoothed.set(sph, s);
  return s.force;
}

/** Area of a polygon (shoelace). */
function area(points: readonly Vec2[]): number {
  let a = 0;
  points.forEach((p, k) => {
    const q = points[(k + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  });
  return Math.abs(a) / 2;
}

/** Share of the box's area below the undisturbed water surface on either side of it, however it is turned. */
function submerged(sph: SphWorld): number {
  const b = sph.bodies[0];
  const sides = [sph.surfaceIn(0.1, b.x - 0.5), sph.surfaceIn(b.x + 0.5, W - 0.1)].filter(Number.isFinite);
  if (sides.length === 0) return 0;
  const level = sides.reduce((a, v) => a + v, 0) / sides.length;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => new Vec2(b.x, b.y).add(new Vec2((sx * b.width) / 2, (sy * b.height) / 2).rotate(b.angle)));
  // Clip the box to the half-plane y < level (Sutherland–Hodgman with one edge).
  const below: Vec2[] = [];
  corners.forEach((p, k) => {
    const q = corners[(k + 1) % corners.length];
    if (p.y < level) below.push(p);
    if (p.y < level !== q.y < level) below.push(p.lerp(q, (level - p.y) / (q.y - p.y)));
  });
  return below.length > 2 ? area(below) / (b.width * b.height) : 0;
}

export const archimedes: Scene<SphWorld> = {
  id: 'archimedes',
  stage: 6,
  title: 'Закон Архімеда',
  description:
    'Брусок 50 × 50 см падає у воду. Вода тисне на нього з усіх боків, і знизу, глибше, тисне сильніше: різниця і є виштовхувальною силою, рівною вазі витісненої води, ρ_в·g·V. Легкий брусок занурюється, доки ця сила не зрівняється з його вагою, тож занурена частка дорівнює ρ/ρ_в (сосна — наполовину, лід — на 90 %). Важчий за воду тоне: навіть повністю занурений, він важить більше за ρ_в·g·V. Сосновий брусок перевертається ребром донизу: для квадрата з густиною між 21 % і 79 % від води лише таке положення стійке. Крути густину на ходу й тягни брусок мишею. Ребра на дні тримають під бруском воду, бо інакше вода знизу не тиснула б.',
  dt: FLUID_DT,
  dtRange: FLUID_DT_RANGE,
  view: { min: new Vec2(-0.3, -0.3), max: new Vec2(W + 0.3, 2.1) },
  fixedIntegrators: true,
  integratorNote: SPH_NOTE,
  params: [
    {
      id: 'density',
      label: 'Густина бруска',
      min: 100,
      max: 3000,
      step: 100,
      value: 500,
      format: (v) => (MATERIALS.has(v) ? `${v} кг/м³ · ${MATERIALS.get(v)}` : `${v} кг/м³`),
    },
  ],
  graph: () => ({
    title: 'Сили на брусок',
    series: [
      { label: 'Вага', color: theme.series[1] },
      { label: 'Сила тиску води', color: theme.series[0] },
      { label: 'ρ_в·g·V (повністю занурений)', color: theme.series[2] },
    ],
    format: forceUnit,
    sample: ([sph]) => {
      const b = sph.bodies[0];
      return [sph.weight(b), buoyancy(sph), WATER * sph.gravity * b.width * b.height * sph.thickness];
    },
  }),
  build: (_integrator, p) => {
    const rib = (x: number) => ((x % 0.3) + 0.3) % 0.3 < DX;
    const solid = (x: number, y: number) => x < 0 || x > W || y < 0 || (y < DX && rib(x));
    const { fluid, walls } = vessel(new Vec2(-0.2, -0.2), new Vec2(W + 0.2, 1.9), DX, solid, (_x, y) => y < DEPTH);
    return [
      new SphWorld({
        spacing: DX,
        fluid,
        walls,
        density: WATER,
        bodies: [{ width: SIZE, height: SIZE, position: new Vec2(W / 2, DEPTH + SIZE / 2 + 0.15), density: p.density, color: '#c98500', label: 'Брусок' }],
        label: 'Вода',
      }),
    ];
  },
  update: ([sph], p) => sph?.setBodyDensity(0, p.density),
  foreground: (ctx: CanvasRenderingContext2D, camera: Camera, [sph], p) => {
    if (!sph) return;
    const b = sph.bodies[0];
    const x = camera.toScreenX(b.x);
    // Above the highest corner, however the box is turned.
    const reach = (Math.abs(Math.cos(b.angle)) * b.height + Math.abs(Math.sin(b.angle)) * b.width) / 2;
    const y = camera.toScreenY(b.y + reach) - 8;
    ctx.font = theme.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = theme.ink;
    ctx.fillText(`занурено ${Math.round(100 * submerged(sph))} %`, x, y - 14);
    ctx.fillStyle = theme.inkSecondary;
    const ratio = p.density / WATER;
    ctx.fillText(ratio < 1 ? `ρ/ρ_в = ${Math.round(100 * ratio)} %` : 'важчий за воду', x, y);
  },
};
