import { lagrangePoints } from '../core/exact';
import { PointMassField, RotatingFrame } from '../core/gravity';
import { ASTRONOMICAL_UNITS, AU, DEG, G, SOLAR_MASS, YEAR } from '../core/units';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { theme } from '../render/theme';
import { SUN_COLOR } from './astroKit';
import { degrees } from './rigidKit';
import type { Scene } from './types';

const M_SUN = SOLAR_MASS;
const M_JUPITER = 1.898_13e27;
const A = 5.2 * AU;
const MU = M_JUPITER / (M_SUN + M_JUPITER);
const OMEGA = Math.sqrt((G * (M_SUN + M_JUPITER)) / A ** 3);
const SUN_POS = new Vec2(-MU * A, 0);
const JUPITER_POS = new Vec2((1 - MU) * A, 0);
const POINTS = lagrangePoints(M_SUN, M_JUPITER, A);
const NUDGE = 1e-5 * A;

/** Test particles: where they start, how they're labelled, how they're drawn. */
const ASTEROIDS = [
  { label: 'Троянець біля L4', pos: POINTS[3].rotate(8 * DEG), color: theme.series[2], plotted: true, around: 60 },
  { label: 'Троянець біля L5', pos: POINTS[4].rotate(-5 * DEG), color: theme.series[3], plotted: true, around: -60 },
  { label: 'Підкова', pos: POINTS[2].add(new Vec2(-0.002 * A, 0)), color: theme.series[4], plotted: true, around: 180 },
  { label: 'Біля L1', pos: POINTS[0].add(new Vec2(NUDGE, 0)), color: theme.series[7], plotted: true, around: 0 },
  { label: 'L2', pos: POINTS[1].add(new Vec2(NUDGE, 0)), color: theme.series[7], plotted: false, around: 0 },
  { label: 'L4', pos: POINTS[3], color: theme.series[2], plotted: false, around: 60 },
  { label: 'L5', pos: POINTS[4], color: theme.series[3], plotted: false, around: -60 },
];
const PLOTTED = ASTEROIDS.map((a, i) => ({ ...a, index: i + 2 })).filter((a) => a.plotted);

/** Angle of a point from the Sun–Jupiter line, degrees, within ±180° of `around` (no wrap-around jumps). */
function longitude(p: Vec2, around: number): number {
  const angle = Math.atan2(p.y, p.x) / DEG;
  return around + ((((angle - around + 180) % 360) + 360) % 360) - 180;
}

export const lagrange: Scene<World> = {
  id: 'lagrange',
  stage: 3,
  title: 'Точки Лагранжа',
  description:
    'Система, що обертається разом із Юпітером: Сонце і Юпітер тут нерухомі, а на астероїди діють тяжіння, відцентрова сила й сила Коріоліса. У п’яти точках Лагранжа ці сили зрівноважуються. L4 і L5 стійкі: троянці, зсунуті на кілька градусів, гойдаються навколо них по «пуголовках». Тіло біля L3 описує «підкову». L1 і L2 нестійкі: найменший зсув, і тіло тікає. Зберігається інтеграл Якобі — енергія в обертовій системі.',
  dt: 0.005 * YEAR,
  dtRange: [0.0005 * YEAR, 0.1 * YEAR],
  speed: 15 * YEAR,
  speedRange: [0.1 * YEAR, 200 * YEAR],
  integrator: 'rk4',
  lengthUnit: ASTRONOMICAL_UNITS,
  view: { min: new Vec2(-7 * AU, -6.5 * AU), max: new Vec2(7 * AU, 6.5 * AU) },
  graph: () => ({
    title: 'Кут від лінії Сонце–Юпітер',
    series: PLOTTED.map((a) => ({ label: a.label, color: a.color })),
    format: degrees,
    sample: ([world]) => PLOTTED.map((a) => longitude(world.particles.position(a.index), a.around)),
  }),
  build: (integrator) => [
    new World({
      integrator,
      label: 'Астероїди',
      forces: [
        new PointMassField([
          { position: SUN_POS, mass: M_SUN },
          { position: JUPITER_POS, mass: M_JUPITER },
        ]),
        new RotatingFrame(OMEGA),
      ],
      particles: [
        { pos: SUN_POS, mass: M_SUN, fixed: true, radius: 0.3 * AU, color: SUN_COLOR },
        { pos: JUPITER_POS, mass: M_JUPITER, fixed: true, radius: 0.15 * AU, color: theme.series[1] },
        ...ASTEROIDS.map((a) => ({ pos: a.pos, mass: 1, radius: 0.05 * AU, color: a.color })),
      ],
    }),
  ],
  overlay: (ctx, camera) => {
    ctx.strokeStyle = theme.inkSecondary;
    ctx.fillStyle = theme.inkSecondary;
    ctx.font = theme.font;
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    POINTS.forEach((p, i) => {
      const x = camera.toScreenX(p.x);
      const y = camera.toScreenY(p.y);
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x - 5, y + 5);
      ctx.lineTo(x + 5, y - 5);
      ctx.stroke();
      ctx.fillText(`L${i + 1}`, x + 7, y - 4);
    });
  },
};
