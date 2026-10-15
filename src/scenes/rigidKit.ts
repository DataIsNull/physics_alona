import { Vec2 } from '../core/vec2';
import { type PolygonShape, box } from '../rigid/shapes';

/** Shown in place of the integrator picker for rigid-body scenes. */
export const RIGID_NOTE =
  'Тверді тіла: напівнеявний Ейлер; контакти й шарніри розв’язуються послідовними імпульсами (як у Box2D), шарніри ще й SHAKE, щоб не губили енергію.';

/** A straight bar from `from` to `to`, overhanging each end by half its thickness. */
export function bar(from: Vec2, to: Vec2, thickness: number): { shape: PolygonShape; position: Vec2; angle: number } {
  const d = to.sub(from);
  return {
    shape: box(d.length() + thickness, thickness),
    position: from.lerp(to, 0.5),
    angle: Math.atan2(d.y, d.x),
  };
}

/** Direction angle of the vector from → to, degrees. */
export function headingDeg(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** Swing angle from the downward vertical of a point hanging off `pivot`, degrees. */
export function swingDeg(pivot: Vec2, point: { x: number; y: number }): number {
  return (Math.atan2(point.x - pivot.x, -(point.y - pivot.y)) * 180) / Math.PI;
}

export const degrees = (v: number) => `${Number(v.toPrecision(3))}°`;

/** Upper intersection of two circles (used to assemble linkages). */
export function circleIntersection(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2 {
  const d = c2.sub(c1);
  const dist = d.length();
  const along = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(r1 * r1 - along * along, 0));
  const u = d.scale(1 / dist);
  return c1.add(u.scale(along)).add(u.perp().scale(h));
}
