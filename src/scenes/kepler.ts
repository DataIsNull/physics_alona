import { type OrbitalElements, keplerState, orbitalPeriod } from '../core/exact';
import { NewtonianGravity } from '../core/gravity';
import { ASTRONOMICAL_UNITS, AU, DAY, G, SOLAR_MASS, YEAR } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { SUN_COLOR } from './astroKit';
import type { Scene } from './types';

const STAR = SOLAR_MASS;
const PLANET = 3e-6 * SOLAR_MASS; // about one Earth
const ORBIT: OrbitalElements = { a: AU, e: 0.6, periapsis: 0, meanAnomaly: Math.PI }; // starts at aphelion
const MU = G * (STAR + PLANET);
const PERIOD = orbitalPeriod(ORBIT.a, MU);
/** The star's share of the separation (it orbits the barycentre too). */
const STAR_SHARE = PLANET / (STAR + PLANET);
const SECTORS = 12;

const relative = (t: number) => keplerState(ORBIT, MU, t);

/** Planet relative to star, position and velocity. */
function separation(world: World): { r: Vec2; v: Vec2 } {
  const p = world.particles;
  return { r: p.position(1).sub(p.position(0)), v: p.velocity(1).sub(p.velocity(0)) };
}

const SPEED0 = relative(0).vel.length();
const AREAL0 = Math.abs(relative(0).pos.cross(relative(0).vel)) / 2;

export const kepler: Scene<World> = {
  id: 'kepler',
  stage: 3,
  title: 'Закони Кеплера',
  description:
    'Планета на орбіті з ексцентриситетом 0.6 навколо зорі масою Сонця, лише закон тяжіння F = GMm/r². Перший закон: орбіта — еліпс із зорею в фокусі (пунктир — точний розв’язок рівняння Кеплера). Другий: за рівні проміжки часу радіус-вектор замітає рівні площі — 12 секторів однакової площі, вузькі біля афелію й широкі біля перигелію. На графіку швидкість змінюється вчетверо, а секторна швидкість лишається сталою.',
  dt: DAY / 4,
  dtRange: [0.01 * DAY, 30 * DAY],
  speed: YEAR / 8,
  speedRange: [DAY, 10 * YEAR],
  lengthUnit: ASTRONOMICAL_UNITS,
  view: { min: new Vec2(-1.75 * AU, -0.95 * AU), max: new Vec2(0.55 * AU, 0.95 * AU) },
  graph: () => ({
    title: 'Відносно початкових значень',
    series: [
      { label: 'Швидкість v', color: theme.series[0] },
      { label: 'Секторна швидкість ½|r×v|', color: theme.series[2] },
    ],
    format: (v) => `×${Number(v.toPrecision(3))}`,
    sample: ([world]) => {
      const { r, v } = separation(world);
      return [v.length() / SPEED0, Math.abs(r.cross(v)) / 2 / AREAL0];
    },
  }),
  build: (integrator) => [
    new World({
      integrator,
      label: 'Зоря і планета',
      forces: [new NewtonianGravity()],
      particles: [
        { pos: relative(0).pos.scale(-STAR_SHARE), vel: relative(0).vel.scale(-STAR_SHARE), mass: STAR, radius: 0.06 * AU, color: SUN_COLOR, trail: false },
        { pos: relative(0).pos.scale(1 - STAR_SHARE), vel: relative(0).vel.scale(1 - STAR_SHARE), mass: PLANET, radius: 0.03 * AU, color: theme.series[0] },
      ],
    }),
  ],
  analytic: (_world, i, t) => relative(t).pos.scale(i === 0 ? -STAR_SHARE : 1 - STAR_SHARE),
  overlay: (ctx, camera) => {
    // Twelve sectors swept in equal times, from the exact orbit. They differ
    // wildly in shape but have the same area.
    const focus = Vec2.ZERO;
    const sub = 24;
    for (let k = 0; k < SECTORS; k++) {
      ctx.beginPath();
      ctx.moveTo(camera.toScreenX(focus.x), camera.toScreenY(focus.y));
      for (let j = 0; j <= sub; j++) {
        const p = relative(((k + j / sub) * PERIOD) / SECTORS).pos;
        ctx.lineTo(camera.toScreenX(p.x), camera.toScreenY(p.y));
      }
      ctx.closePath();
      ctx.fillStyle = theme.series[0];
      ctx.globalAlpha = k % 2 === 0 ? 0.16 : 0.07;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};
