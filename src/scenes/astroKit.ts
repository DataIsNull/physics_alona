import { Vec2 } from '../core/vec2';
import type { Camera } from '../render/camera';
import { theme } from '../render/theme';

export const SUN_COLOR = '#f2c14e';

export interface PointBody {
  pos: Vec2;
  vel: Vec2;
  mass: number;
}

/** Shifts bodies into their centre-of-mass frame (zero total momentum). */
export function barycentric<T extends PointBody>(bodies: T[]): T[] {
  let m = 0;
  let px = 0;
  let py = 0;
  let mx = 0;
  let my = 0;
  for (const b of bodies) {
    m += b.mass;
    px += b.mass * b.vel.x;
    py += b.mass * b.vel.y;
    mx += b.mass * b.pos.x;
    my += b.mass * b.pos.y;
  }
  const v = new Vec2(px / m, py / m);
  const c = new Vec2(mx / m, my / m);
  return bodies.map((b) => ({ ...b, pos: b.pos.sub(c), vel: b.vel.sub(v) }));
}

/**
 * Direction of the Laplace–Runge–Lenz vector A = v × L − μ·r̂, which points
 * at the periapsis and stays put for a pure 1/r² force. Radians.
 */
export function periapsisAngle(r: Vec2, v: Vec2, mu: number): number {
  const L = r.cross(v);
  const len = r.length();
  return Math.atan2(-v.x * L - (mu * r.y) / len, v.y * L - (mu * r.x) / len);
}

/** Dashed reference circle with a label, e.g. Earth's orbit for scale. */
export function drawReferenceCircle(ctx: CanvasRenderingContext2D, camera: Camera, radius: number, label: string): void {
  const cx = camera.toScreenX(0);
  const cy = camera.toScreenY(0);
  const r = radius * camera.scale;
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = theme.inkMuted;
  ctx.font = theme.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, cx + r * Math.SQRT1_2 + 4, cy - r * Math.SQRT1_2 - 2);
}
