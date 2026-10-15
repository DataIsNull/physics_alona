// Narrow-phase collision detection between circles and convex polygons.
//
// Manifolds are stored in body-local coordinates (the Box2D scheme) so the
// position solver can recompute separations as bodies move during a step,
// and feature ids let impulses carry over between steps (warm starting).

import type { Body } from './body';
import type { CircleShape, PolygonShape } from './shapes';

/** Penetration the solver tolerates; keeps resting contacts from flickering, m. */
export const LINEAR_SLOP = 0.005;

export type ManifoldType = 'circles' | 'faceA' | 'faceB';

export interface ManifoldPoint {
  /**
   * circles: centre of B in B's frame. faceA: clip point in B's frame.
   * faceB: clip point in A's frame.
   */
  localX: number;
  localY: number;
  /** Identifies the touching features, for matching across steps. */
  id: number;
  normalImpulse: number;
  tangentImpulse: number;
}

export interface Manifold {
  type: ManifoldType;
  /** faceA/faceB: reference face normal in the reference body's frame. */
  normalX: number;
  normalY: number;
  /** circles: centre of A in A's frame. faceA/faceB: a point on the reference face. */
  pointX: number;
  pointY: number;
  points: ManifoldPoint[];
}

const point = (localX: number, localY: number, id: number): ManifoldPoint => ({
  localX,
  localY,
  id,
  normalImpulse: 0,
  tangentImpulse: 0,
});

/** Contact manifold for a pair of bodies, or null if they don't touch. Circle–polygon pairs must come polygon first. */
export function collide(a: Body, b: Body): Manifold | null {
  const sa = a.shape;
  const sb = b.shape;
  if (sa.kind === 'circle' && sb.kind === 'circle') return collideCircles(a, sa, b, sb);
  if (sa.kind === 'polygon' && sb.kind === 'circle') return collidePolygonCircle(a, sa, b, sb);
  if (sa.kind === 'polygon' && sb.kind === 'polygon') return collidePolygons(a, sa, b, sb);
  throw new Error('collide(): put the polygon first in circle–polygon pairs');
}

function collideCircles(a: Body, sa: CircleShape, b: Body, sb: CircleShape): Manifold | null {
  const reach = sa.radius + sb.radius;
  if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 > reach * reach) return null;
  return { type: 'circles', normalX: 0, normalY: 0, pointX: 0, pointY: 0, points: [point(0, 0, 0)] };
}

function collidePolygonCircle(a: Body, poly: PolygonShape, b: Body, circ: CircleShape): Manifold | null {
  // Circle centre in the polygon's frame.
  const cx = a.localX(b.x, b.y);
  const cy = a.localY(b.x, b.y);
  const r = circ.radius;

  // Face of greatest separation.
  let face = 0;
  let separation = -Infinity;
  for (let i = 0; i < poly.count; i++) {
    const s = poly.nxs[i] * (cx - poly.xs[i]) + poly.nys[i] * (cy - poly.ys[i]);
    if (s > r) return null;
    if (s > separation) {
      separation = s;
      face = i;
    }
  }
  const next = (face + 1) % poly.count;
  const x1 = poly.xs[face];
  const y1 = poly.ys[face];
  const x2 = poly.xs[next];
  const y2 = poly.ys[next];
  const manifold = (nx: number, ny: number, px: number, py: number): Manifold => ({
    type: 'faceA',
    normalX: nx,
    normalY: ny,
    pointX: px,
    pointY: py,
    points: [point(0, 0, face)],
  });

  // Centre inside the polygon: push out through the nearest face.
  if (separation < 1e-12) return manifold(poly.nxs[face], poly.nys[face], (x1 + x2) / 2, (y1 + y2) / 2);

  // Otherwise: vertex region of v1, vertex region of v2, or the face region.
  const u1 = (cx - x1) * (x2 - x1) + (cy - y1) * (y2 - y1);
  const u2 = (cx - x2) * (x1 - x2) + (cy - y2) * (y1 - y2);
  if (u1 <= 0 || u2 <= 0) {
    const vx = u1 <= 0 ? x1 : x2;
    const vy = u1 <= 0 ? y1 : y2;
    const d = Math.hypot(cx - vx, cy - vy);
    if (d > r) return null;
    return d > 0 ? manifold((cx - vx) / d, (cy - vy) / d, vx, vy) : manifold(poly.nxs[face], poly.nys[face], vx, vy);
  }
  return manifold(poly.nxs[face], poly.nys[face], (x1 + x2) / 2, (y1 + y2) / 2);
}

/** Largest separation of `b` from the faces of `a` (world space), and the face that achieves it. */
function maxSeparation(a: Body, pa: PolygonShape, b: Body, pb: PolygonShape): [face: number, separation: number] {
  let bestFace = 0;
  let best = -Infinity;
  for (let i = 0; i < pa.count; i++) {
    const nx = a.wnxs[i];
    const ny = a.wnys[i];
    let min = Infinity;
    for (let j = 0; j < pb.count; j++) {
      const s = nx * (b.wxs[j] - a.wxs[i]) + ny * (b.wys[j] - a.wys[i]);
      if (s < min) min = s;
    }
    if (min > best) {
      best = min;
      bestFace = i;
    }
  }
  return [bestFace, best];
}

interface ClipVertex {
  x: number;
  y: number;
  id: number;
}

/** Keeps the part of a segment with n·v ≤ offset; a cut point gets id `cutId`. */
function clipSegment(v: ClipVertex[], nx: number, ny: number, offset: number, cutId: number): ClipVertex[] {
  const out: ClipVertex[] = [];
  const d0 = nx * v[0].x + ny * v[0].y - offset;
  const d1 = nx * v[1].x + ny * v[1].y - offset;
  if (d0 <= 0) out.push(v[0]);
  if (d1 <= 0) out.push(v[1]);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    out.push({ x: v[0].x + t * (v[1].x - v[0].x), y: v[0].y + t * (v[1].y - v[0].y), id: cutId });
  }
  return out;
}

function collidePolygons(a: Body, pa: PolygonShape, b: Body, pb: PolygonShape): Manifold | null {
  const [faceA, sepA] = maxSeparation(a, pa, b, pb);
  if (sepA > 0) return null;
  const [faceB, sepB] = maxSeparation(b, pb, a, pa);
  if (sepB > 0) return null;

  // Prefer A as the reference body unless B's face is clearly better; the
  // tolerance stops the choice from flipping back and forth between steps.
  const flip = sepB > sepA + 0.1 * LINEAR_SLOP;
  const ref = flip ? b : a;
  const refShape = flip ? pb : pa;
  const inc = flip ? a : b;
  const incShape = flip ? pa : pb;
  const face = flip ? faceB : faceA;
  const nx = ref.wnxs[face];
  const ny = ref.wnys[face];

  // Incident edge: the edge of the other polygon most anti-parallel to the reference normal.
  let incident = 0;
  let minDot = Infinity;
  for (let i = 0; i < incShape.count; i++) {
    const d = nx * inc.wnxs[i] + ny * inc.wnys[i];
    if (d < minDot) {
      minDot = d;
      incident = i;
    }
  }
  const incNext = (incident + 1) % incShape.count;
  let clip: ClipVertex[] = [
    { x: inc.wxs[incident], y: inc.wys[incident], id: 100 + incident },
    { x: inc.wxs[incNext], y: inc.wys[incNext], id: 100 + incNext },
  ];

  // Clip the incident edge to the side planes of the reference face.
  const refNext = (face + 1) % refShape.count;
  const v1x = ref.wxs[face];
  const v1y = ref.wys[face];
  const v2x = ref.wxs[refNext];
  const v2y = ref.wys[refNext];
  const len = Math.hypot(v2x - v1x, v2y - v1y);
  const tx = (v2x - v1x) / len;
  const ty = (v2y - v1y) / len;
  clip = clipSegment(clip, -tx, -ty, -(tx * v1x + ty * v1y), 200 + face);
  if (clip.length < 2) return null;
  clip = clipSegment(clip, tx, ty, tx * v2x + ty * v2y, 200 + refNext);
  if (clip.length < 2) return null;

  const front = nx * v1x + ny * v1y;
  const points: ManifoldPoint[] = [];
  for (const c of clip) {
    if (nx * c.x + ny * c.y - front > 0) continue; // not penetrating
    const base = (flip ? 100_000 : 0) + face * 1000;
    points.push(point(inc.localX(c.x, c.y), inc.localY(c.x, c.y), base + c.id));
  }
  if (points.length === 0) return null;

  return {
    type: flip ? 'faceB' : 'faceA',
    normalX: refShape.nxs[face],
    normalY: refShape.nys[face],
    pointX: (refShape.xs[face] + refShape.xs[refNext]) / 2,
    pointY: (refShape.ys[face] + refShape.ys[refNext]) / 2,
    points,
  };
}

/** World-space contact data derived from a manifold at the bodies' current poses. */
export interface ContactGeometry {
  /** Unit normal pointing from A to B. */
  nx: number;
  ny: number;
  /** Contact point i (midway between the surfaces) and its separation (< 0 means overlap). */
  px: number[];
  py: number[];
  separation: number[];
}

const radiusOf = (body: Body) => (body.shape.kind === 'circle' ? body.shape.radius : 0);

/** Evaluates a manifold at the bodies' current positions (uses cached cos/sin). */
export function contactGeometry(m: Manifold, a: Body, b: Body, out: ContactGeometry): void {
  const ra = radiusOf(a);
  const rb = radiusOf(b);
  const n = m.points.length;
  out.px.length = out.py.length = out.separation.length = n;

  if (m.type === 'circles') {
    const ax = a.worldX(m.pointX, m.pointY);
    const ay = a.worldY(m.pointX, m.pointY);
    const bx = b.worldX(m.points[0].localX, m.points[0].localY);
    const by = b.worldY(m.points[0].localX, m.points[0].localY);
    const d = Math.hypot(bx - ax, by - ay);
    out.nx = d > 1e-12 ? (bx - ax) / d : 1;
    out.ny = d > 1e-12 ? (by - ay) / d : 0;
    const cax = ax + ra * out.nx;
    const cay = ay + ra * out.ny;
    const cbx = bx - rb * out.nx;
    const cby = by - rb * out.ny;
    out.px[0] = (cax + cbx) / 2;
    out.py[0] = (cay + cby) / 2;
    out.separation[0] = (cbx - cax) * out.nx + (cby - cay) * out.ny;
    return;
  }

  // Reference body owns the face; the other body owns the clip points.
  const ref = m.type === 'faceA' ? a : b;
  const other = m.type === 'faceA' ? b : a;
  const rRef = m.type === 'faceA' ? ra : rb;
  const rOther = m.type === 'faceA' ? rb : ra;
  const nx = ref.cos * m.normalX - ref.sin * m.normalY;
  const ny = ref.sin * m.normalX + ref.cos * m.normalY;
  const planeX = ref.worldX(m.pointX, m.pointY);
  const planeY = ref.worldY(m.pointX, m.pointY);
  for (let i = 0; i < n; i++) {
    const cx = other.worldX(m.points[i].localX, m.points[i].localY);
    const cy = other.worldY(m.points[i].localX, m.points[i].localY);
    const sep = (cx - planeX) * nx + (cy - planeY) * ny - rRef - rOther;
    // Midpoint between the reference surface and the other body's surface.
    out.px[i] = cx - nx * (rOther + sep / 2);
    out.py[i] = cy - ny * (rOther + sep / 2);
    out.separation[i] = sep;
  }
  // The normal must point from A to B.
  out.nx = m.type === 'faceA' ? nx : -nx;
  out.ny = m.type === 'faceA' ? ny : -ny;
}
