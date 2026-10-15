import type { Body } from '../rigid/body';
import { DistanceJoint } from '../rigid/joints';
import type { RigidWorld } from '../rigid/world';
import type { Camera } from './camera';
import type { RenderLayers } from './renderer';
import { theme } from './theme';

/** Velocity arrows show the displacement over this much time, s. */
const VELOCITY_ARROW_TIME = 0.25;

/** Draws bodies, joints and (optionally) contact points of a rigid world. */
export function drawRigidWorld(ctx: CanvasRenderingContext2D, camera: Camera, world: RigidWorld, layers: RenderLayers): void {
  for (const b of world.bodies) if (b.isStatic) drawBody(ctx, camera, b);
  for (const b of world.bodies) if (!b.isStatic) drawBody(ctx, camera, b);
  drawJoints(ctx, camera, world);
  if (layers.contacts) drawContacts(ctx, camera, world);
  if (layers.velocities) drawVelocities(ctx, camera, world);
  drawGrab(ctx, camera, world);
}

function bodyPath(ctx: CanvasRenderingContext2D, camera: Camera, b: Body): void {
  const s = b.shape;
  ctx.beginPath();
  if (s.kind === 'circle') {
    ctx.arc(camera.toScreenX(b.x), camera.toScreenY(b.y), s.radius * camera.scale, 0, 2 * Math.PI);
    return;
  }
  for (let i = 0; i < s.count; i++) {
    const x = camera.toScreenX(b.worldX(s.xs[i], s.ys[i]));
    const y = camera.toScreenY(b.worldY(s.xs[i], s.ys[i]));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawBody(ctx: CanvasRenderingContext2D, camera: Camera, b: Body): void {
  bodyPath(ctx, camera, b);
  if (b.isStatic) {
    ctx.fillStyle = theme.wall;
    ctx.fill();
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  // Sleeping bodies fade so you can watch islands doze off and wake up.
  ctx.globalAlpha = b.awake ? 0.55 : 0.25;
  ctx.fillStyle = b.color;
  ctx.fill();
  ctx.globalAlpha = b.awake ? 1 : 0.5;
  ctx.strokeStyle = b.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // A spoke shows rotation, which is otherwise invisible for a disc.
  if (b.shape.kind === 'circle') {
    const r = b.shape.radius;
    ctx.beginPath();
    ctx.moveTo(camera.toScreenX(b.x), camera.toScreenY(b.y));
    ctx.lineTo(camera.toScreenX(b.worldX(r, 0)), camera.toScreenY(b.worldY(r, 0)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawJoints(ctx: CanvasRenderingContext2D, camera: Camera, world: RigidWorld): void {
  for (const j of world.joints) {
    const [p, q] = j.anchors();
    const px = camera.toScreenX(p.x);
    const py = camera.toScreenY(p.y);
    const qx = camera.toScreenX(q.x);
    const qy = camera.toScreenY(q.y);
    if (j instanceof DistanceJoint) {
      ctx.strokeStyle = theme.spring;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(qx, qy);
      ctx.stroke();
      for (const [x, y] of [
        [px, py],
        [qx, qy],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = theme.inkSecondary;
        ctx.fill();
      }
      continue;
    }
    // Pin: a ring at the anchor (both anchors coincide up to solver error).
    ctx.beginPath();
    ctx.arc(qx, qy, 4, 0, 2 * Math.PI);
    ctx.fillStyle = theme.surface;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawContacts(ctx: CanvasRenderingContext2D, camera: Camera, world: RigidWorld): void {
  ctx.strokeStyle = theme.series[7];
  ctx.fillStyle = theme.series[7];
  ctx.lineWidth = 1.5;
  for (const c of world.touchingContacts()) {
    const g = c.worldGeometry();
    if (!g) continue;
    for (let i = 0; i < g.px.length; i++) {
      const x = camera.toScreenX(g.px[i]);
      const y = camera.toScreenY(g.py[i]);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + g.nx * 14, y - g.ny * 14);
      ctx.stroke();
    }
  }
}

function drawVelocities(ctx: CanvasRenderingContext2D, camera: Camera, world: RigidWorld): void {
  ctx.strokeStyle = theme.velocity;
  ctx.lineWidth = 1.5;
  for (const b of world.bodies) {
    if (b.isStatic || !b.awake) continue;
    const x0 = camera.toScreenX(b.x);
    const y0 = camera.toScreenY(b.y);
    const x1 = camera.toScreenX(b.x + b.vx * VELOCITY_ARROW_TIME);
    const y1 = camera.toScreenY(b.y + b.vy * VELOCITY_ARROW_TIME);
    if (Math.hypot(x1 - x0, y1 - y0) < 2) continue;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

function drawGrab(ctx: CanvasRenderingContext2D, camera: Camera, world: RigidWorld): void {
  const from = world.grabPoint();
  if (!from || !world.grab) return;
  const tx = camera.toScreenX(world.grab.target.x);
  const ty = camera.toScreenY(world.grab.target.y);
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(camera.toScreenX(from.x), camera.toScreenY(from.y));
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(tx, ty, 4, 0, 2 * Math.PI);
  ctx.stroke();
}
