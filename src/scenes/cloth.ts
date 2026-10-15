import { DistanceConstraint } from '../core/constraints';
import { LinearDrag, UniformGravity } from '../core/forces';
import type { ParticleSpec } from '../core/particles';
import { Vec2 } from '../core/vec2';
import { World } from '../core/world';
import { energyGraph } from './graphs';
import type { Scene } from './types';

const COLS = 25;
const ROWS = 17;
const SPACING = 0.1; // m
const TOP_LEFT = new Vec2(-((COLS - 1) * SPACING) / 2, 1);
/** Pinned columns of the top row; the right half hangs free and falls. */
const PINS = [0, 12];

const index = (row: number, col: number) => row * COLS + col;

function nodes(): ParticleSpec[] {
  const specs: ParticleSpec[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      specs.push({
        pos: TOP_LEFT.add(new Vec2(col * SPACING, -row * SPACING)),
        mass: 0.02,
        radius: 0,
        fixed: row === 0 && PINS.includes(col),
        trail: false,
      });
    }
  }
  return specs;
}

/**
 * Rods along rows and columns only. In 2D, diagonal rods would triangulate
 * the mesh into a rigid plate; without them the cells can shear and the
 * mesh drapes like a net.
 */
function rods(): DistanceConstraint[] {
  const out: DistanceConstraint[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (col + 1 < COLS) out.push(new DistanceConstraint(index(row, col), index(row, col + 1), SPACING));
      if (row + 1 < ROWS) out.push(new DistanceConstraint(index(row, col), index(row + 1, col), SPACING));
    }
  }
  return out;
}

export const cloth: Scene<World> = {
  id: 'cloth',
  stage: 1,
  title: 'Сітка',
  description:
    'Сітка 25 × 17 точкових мас на жорстких стрижнях закріплена у двох точках: права половина падає й розгойдується. Ті самі в’язі, що тримають маятник, тут тримають 400 вузлів. Коли стрижень різко натягується, частина енергії йде в тепло, як при непружному ударі, і панель це враховує. Хапай сітку або шпильки мишею.',
  dt: 1 / 120,
  view: { min: new Vec2(-1.7, -1.95), max: new Vec2(1.7, 1.15) },
  graph: energyGraph({ losses: true }),
  build: (integrator) => [
    new World({
      integrator,
      forces: [new UniformGravity(), new LinearDrag(0.004)],
      constraints: rods(),
      constraintIterations: 12,
      constraintLosses: true,
      particles: nodes(),
    }),
  ],
};
