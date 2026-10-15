import { Spring, type SpringEnd } from '../core/forces';
import type { Vec2 } from '../core/vec2';
import type { World } from '../core/world';
import type { Camera } from './camera';
import { drawGrid } from './grid';
import { theme } from './theme';
import type { Trail } from './trail';

export interface RenderLayers {
  trails: boolean;
  velocities: boolean;
  analytic: boolean;
}

/** A world plus per-particle render state. */
export interface WorldView {
  world: World;
  trails: Trail[];
}

/** Exact solution: position of `particle` in world `world` at time t. */
export type AnalyticFn = (world: number, particle: number, t: number) => Vec2;

/** Velocity arrows show the displacement over this much time, s. */
const VELOCITY_ARROW_TIME = 0.25;
const MIN_PARTICLE_PX = 3;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly camera: Camera,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Syncs the backing store with the canvas' CSS size. Returns true if it changed. */
  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(Math.round(rect.width * this.dpr), 1);
    const h = Math.max(Math.round(rect.height * this.dpr), 1);
    const changed = this.canvas.width !== w || this.canvas.height !== h;
    if (changed) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.camera.setViewport(rect.width, rect.height);
    return changed;
  }

  render(views: readonly WorldView[], layers: RenderLayers, analytic?: AnalyticFn): void {
    const { ctx, camera } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, camera.width, camera.height);
    drawGrid(ctx, camera);

    for (const { world } of views) this.drawSprings(world);
    if (layers.trails) {
      for (const view of views) {
        view.trails.forEach((trail, i) => this.drawTrail(trail, view.world.particles.color[i]));
      }
    }
    if (layers.analytic && analytic) {
      views.forEach((view, w) => this.drawGhosts(view.world, (i) => analytic(w, i, view.world.t)));
    }
    for (const { world } of views) this.drawParticles(world);
    if (layers.velocities) for (const { world } of views) this.drawVelocities(world);
  }

  private drawSprings(world: World): void {
    const { ctx, camera } = this;
    const pos = world.particles.pos;
    const endX = (e: SpringEnd) => camera.toScreenX(typeof e === 'number' ? pos[2 * e] : e.x);
    const endY = (e: SpringEnd) => camera.toScreenY(typeof e === 'number' ? pos[2 * e + 1] : e.y);

    for (const force of world.forces) {
      if (!(force instanceof Spring)) continue;
      ctx.strokeStyle = theme.spring;
      ctx.lineWidth = 1.5;
      drawZigzag(ctx, endX(force.a), endY(force.a), endX(force.b), endY(force.b));
      for (const end of [force.a, force.b]) {
        if (typeof end !== 'number') drawAnchor(ctx, endX(end), endY(end));
      }
    }
  }

  private drawTrail(trail: Trail, color: string): void {
    const n = trail.length;
    if (n < 2) return;
    const { ctx, camera } = this;
    const bands = 6; // older segments fade out
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (let b = 0; b < bands; b++) {
      const from = Math.floor((b * (n - 1)) / bands);
      const to = Math.floor(((b + 1) * (n - 1)) / bands);
      if (to <= from) continue;
      ctx.globalAlpha = 0.1 + 0.5 * ((b + 1) / bands);
      ctx.beginPath();
      ctx.moveTo(camera.toScreenX(trail.x(from)), camera.toScreenY(trail.y(from)));
      for (let i = from + 1; i <= to; i++) {
        ctx.lineTo(camera.toScreenX(trail.x(i)), camera.toScreenY(trail.y(i)));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawGhosts(world: World, exact: (particle: number) => Vec2): void {
    const { ctx, camera } = this;
    ctx.strokeStyle = theme.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i < world.particles.count; i++) {
      const p = exact(i);
      const r = Math.max(world.particles.radius[i] * camera.scale, MIN_PARTICLE_PX) + 2;
      ctx.beginPath();
      ctx.arc(camera.toScreenX(p.x), camera.toScreenY(p.y), r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawParticles(world: World): void {
    const { ctx, camera } = this;
    const { count, pos, radius, color } = world.particles;
    for (let i = 0; i < count; i++) {
      const r = Math.max(radius[i] * camera.scale, MIN_PARTICLE_PX);
      ctx.beginPath();
      ctx.arc(camera.toScreenX(pos[2 * i]), camera.toScreenY(pos[2 * i + 1]), r, 0, 2 * Math.PI);
      ctx.fillStyle = color[i];
      ctx.fill();
      // 2px surface ring keeps overlapping particles distinct
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private drawVelocities(world: World): void {
    const { ctx, camera } = this;
    const { count, pos, vel } = world.particles;
    ctx.strokeStyle = theme.velocity;
    ctx.fillStyle = theme.velocity;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < count; i++) {
      const x0 = camera.toScreenX(pos[2 * i]);
      const y0 = camera.toScreenY(pos[2 * i + 1]);
      const x1 = camera.toScreenX(pos[2 * i] + vel[2 * i] * VELOCITY_ARROW_TIME);
      const y1 = camera.toScreenY(pos[2 * i + 1] + vel[2 * i + 1] * VELOCITY_ARROW_TIME);
      drawArrow(ctx, x0, y0, x1, y1);
    }
  }
}

function drawZigzag(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  if (len < 4) {
    ctx.lineTo(bx, by);
    ctx.stroke();
    return;
  }
  const ux = dx / len;
  const uy = dy / len;
  const coils = 12;
  const amplitude = 5;
  const lead = Math.min(10, len * 0.15);
  const body = len - 2 * lead;
  const segments = 2 * coils;
  ctx.lineTo(ax + ux * lead, ay + uy * lead);
  for (let s = 0; s < segments; s++) {
    const along = lead + (body * (s + 0.5)) / segments;
    const side = s % 2 === 0 ? amplitude : -amplitude;
    ctx.lineTo(ax + ux * along - uy * side, ay + uy * along + ux * side);
  }
  ctx.lineTo(bx - ux * lead, by - uy * lead);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = theme.anchor;
  ctx.fillRect(x - 4, y - 4, 8, 8);
}

function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2 || !Number.isFinite(len)) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const head = Math.min(7, len * 0.4);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * head, y1 - uy * head);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
  ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
}
