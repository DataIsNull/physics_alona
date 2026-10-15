import { Vec2 } from '../core/vec2';

export interface CircleShape {
  readonly kind: 'circle';
  /** m */
  readonly radius: number;
}

/** Convex polygon in body space: counter-clockwise, centroid at the origin. */
export interface PolygonShape {
  readonly kind: 'polygon';
  readonly count: number;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** Outward unit normal of edge i, which runs from vertex i to vertex i + 1. */
  readonly nxs: readonly number[];
  readonly nys: readonly number[];
  /** Largest vertex distance from the centroid, m. */
  readonly boundingRadius: number;
}

export type Shape = CircleShape | PolygonShape;

export function circle(radius: number): CircleShape {
  if (!(radius > 0)) throw new RangeError(`Circle radius must be positive, got ${radius}`);
  return { kind: 'circle', radius };
}

/**
 * Convex polygon from points in any winding order. Vertices are shifted so
 * the centroid sits at the origin: a body's position is its centre of mass.
 */
export function polygon(points: readonly Vec2[]): PolygonShape {
  if (points.length < 3) throw new RangeError('A polygon needs at least 3 vertices');
  let pts = [...points];
  if (signedArea(pts) < 0) pts.reverse();
  const area = signedArea(pts);
  if (!(area > 0)) throw new RangeError('Polygon has zero area');

  // Area-weighted centroid of the triangle fan.
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.cross(q);
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  const centroid = new Vec2(cx / (6 * area), cy / (6 * area));
  pts = pts.map((p) => p.sub(centroid));

  const n = pts.length;
  const nxs: number[] = [];
  const nys: number[] = [];
  for (let i = 0; i < n; i++) {
    const edge = pts[(i + 1) % n].sub(pts[i]);
    const next = pts[(i + 2) % n].sub(pts[(i + 1) % n]);
    if (edge.cross(next) <= 0) throw new RangeError('Polygon must be strictly convex');
    // Outward normal of a CCW edge is the edge rotated −90°.
    const normal = new Vec2(edge.y, -edge.x).normalize();
    nxs.push(normal.x);
    nys.push(normal.y);
  }
  return {
    kind: 'polygon',
    count: n,
    xs: pts.map((p) => p.x),
    ys: pts.map((p) => p.y),
    nxs,
    nys,
    boundingRadius: Math.max(...pts.map((p) => p.length())),
  };
}

export function box(width: number, height: number): PolygonShape {
  const w = width / 2;
  const h = height / 2;
  return polygon([new Vec2(-w, -h), new Vec2(w, -h), new Vec2(w, h), new Vec2(-w, h)]);
}

export function regularPolygon(sides: number, radius: number): PolygonShape {
  return polygon(Array.from({ length: sides }, (_, i) => Vec2.fromAngle((2 * Math.PI * i) / sides, radius)));
}

export interface MassData {
  /** kg */
  mass: number;
  /** Moment of inertia about the centroid, kg·m². */
  inertia: number;
}

/** Mass and moment of inertia of a uniform plate with areal density ρ (kg/m²). */
export function massData(shape: Shape, density: number): MassData {
  if (shape.kind === 'circle') {
    const mass = density * Math.PI * shape.radius ** 2;
    return { mass, inertia: 0.5 * mass * shape.radius ** 2 };
  }
  // Sum over triangles (origin, pᵢ, pᵢ₊₁); the origin is the centroid.
  // A triangle with a vertex at the origin has polar moment A/6·(p·p + p·q + q·q).
  let area = 0;
  let polar = 0;
  for (let i = 0; i < shape.count; i++) {
    const j = (i + 1) % shape.count;
    const px = shape.xs[i];
    const py = shape.ys[i];
    const qx = shape.xs[j];
    const qy = shape.ys[j];
    const a = 0.5 * (px * qy - py * qx);
    area += a;
    polar += (a / 6) * (px * px + py * py + px * qx + py * qy + qx * qx + qy * qy);
  }
  return { mass: density * area, inertia: density * polar };
}

function signedArea(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].cross(pts[(i + 1) % pts.length]);
  return a / 2;
}
