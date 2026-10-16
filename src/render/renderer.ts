import type { Wall } from '../core/collisions';
import { Spring, type SpringEnd } from '../core/forces';
import type { Simulation, TrailSource } from '../core/simulation';
import { type LengthUnit, METRES } from '../core/units';
import type { Vec2 } from '../core/vec2';
import { MIN_PARTICLE_PX, World } from '../core/world';
import { RigidWorld } from '../rigid/world';
import { GasWorld } from '../thermo/gas';
import { WaveField } from '../waves/field';
import { WaveString } from '../waves/string';
import type { Camera } from './camera';
import { drawGrid } from './grid';
import { drawGas } from './gasRenderer';
import { drawRigidWorld } from './rigidRenderer';
import { drawField, drawString } from './waveRenderer';
import { theme } from './theme';
import type { Trail } from './trail';

export interface RenderLayers {
  trails: boolean;
  velocities: boolean;
  analytic: boolean;
  /** Contact points and normals of rigid bodies. */
  contacts: boolean;
}

/** A simulation plus its motion trails, one per trail source. */
export interface SimView {
  sim: Simulation;
  sources: TrailSource[];
  trails: Trail[];
}

/** Exact solution: position of `particle` in world `world` at time t, if known. */
export type AnalyticFn = (world: number, particle: number, t: number) => Vec2 | null;

/** Velocity arrows show the displacement over this much time, s. */
const VELOCITY_ARROW_TIME = 0.25;

/** Scene-specific drawing on top of everything else. */
export type Overlay = (ctx: CanvasRenderingContext2D, camera: Camera, sims: readonly Simulation[]) => void;

export class Renderer {
  /** Display unit for grid labels. */
  unit: LengthUnit = METRES;
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

  render(views: readonly SimView[], layers: RenderLayers, analytic?: AnalyticFn, overlay?: Overlay, foreground?: Overlay): void {
    const { ctx, camera } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, camera.width, camera.height);
    drawGrid(ctx, camera, this.unit);
    for (const view of views) if (view.sim instanceof WaveField) drawField(ctx, camera, view.sim);
    overlay?.(ctx, camera, views.map((v) => v.sim));
    for (const view of views) if (view.sim instanceof WaveString) drawString(ctx, camera, view.sim, layers);
    for (const view of views) if (view.sim instanceof GasWorld) drawGas(ctx, camera, view.sim);

    for (const view of views) {
      if (view.sim instanceof RigidWorld) drawRigidWorld(ctx, camera, view.sim, layers);
    }
    const worlds = views.map((v) => v.sim).filter((s): s is World => s instanceof World);
    for (const world of worlds) {
      for (const w of world.collisions?.walls ?? []) this.drawWall(w);
    }
    for (const world of worlds) {
      this.drawSprings(world);
      this.drawRods(world);
    }
    if (layers.trails) {
      for (const view of views) view.trails.forEach((trail, k) => this.drawTrail(trail, view.sources[k].color));
    }
    if (layers.analytic && analytic) {
      views.forEach((view, w) => {
        const sim = view.sim;
        if (sim instanceof World) this.drawGhosts(sim, (i) => analytic(w, i, sim.t));
      });
    }
    for (const world of worlds) this.drawParticles(world);
    if (layers.velocities) for (const world of worlds) this.drawVelocities(world);
    for (const world of worlds) this.drawGrab(world);
    foreground?.(ctx, camera, views.map((v) => v.sim));
  }

  /** Shades the solid side of a wall and draws its surface line. */
  private drawWall(wall: Wall): void {
    const { ctx, camera } = this;
    const { min, max } = camera.visibleBounds();
    // Long enough to cross the whole view from the wall's anchor point.
    const reach =
      Math.hypot(max.x - min.x, max.y - min.y) +
      Math.hypot(wall.point.x - (min.x + max.x) / 2, wall.point.y - (min.y + max.y) / 2);
    const tx = -wall.normal.y * reach;
    const ty = wall.normal.x * reach;
    const nx = -wall.normal.x * reach;
    const ny = -wall.normal.y * reach;
    const p = wall.point;
    const corners: Array<[number, number]> = [
      [p.x - tx, p.y - ty],
      [p.x + tx, p.y + ty],
      [p.x + tx + nx, p.y + ty + ny],
      [p.x - tx + nx, p.y - ty + ny],
    ];
    ctx.beginPath();
    corners.forEach(([x, y], k) => {
      const sx = camera.toScreenX(x);
      const sy = camera.toScreenY(y);
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fillStyle = theme.wall;
    ctx.fill();

    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(camera.toScreenX(p.x - tx), camera.toScreenY(p.y - ty));
    ctx.lineTo(camera.toScreenX(p.x + tx), camera.toScreenY(p.y + ty));
    ctx.stroke();
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

  private drawRods(world: World): void {
    if (world.constraints.length === 0) return;
    const { ctx, camera } = this;
    const pos = world.particles.pos;
    // Many rods (cloth) read better thin; a few (pendulums) read better bold.
    ctx.lineWidth = world.constraints.length > 20 ? 1 : 2;
    ctx.strokeStyle = theme.spring;
    ctx.beginPath();
    for (const c of world.constraints) {
      ctx.moveTo(camera.toScreenX(pos[2 * c.a]), camera.toScreenY(pos[2 * c.a + 1]));
      ctx.lineTo(camera.toScreenX(pos[2 * c.b]), camera.toScreenY(pos[2 * c.b + 1]));
    }
    ctx.stroke();
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

  private drawGhosts(world: World, exact: (particle: number) => Vec2 | null): void {
    const { ctx, camera } = this;
    ctx.strokeStyle = theme.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i < world.particles.count; i++) {
      if (world.particles.isFixed(i)) continue;
      const p = exact(i);
      if (!p) continue;
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
    const crowd = count > 300;
    for (let i = 0; i < count; i++) {
      const x = camera.toScreenX(pos[2 * i]);
      const y = camera.toScreenY(pos[2 * i + 1]);
      const fixed = world.particles.isFixed(i);
      if (radius[i] === 0) {
        // Point masses (cloth nodes) are drawn through their rods; only anchors show.
        if (fixed) drawAnchor(ctx, x, y);
        continue;
      }
      const realRadius = radius[i] * camera.scale;
      if (crowd && realRadius < 1.2 && !fixed) {
        // Star-field fast path: thousands of specks are cheaper as tiny squares.
        ctx.fillStyle = color[i];
        ctx.fillRect(x - 1, y - 1, 2, 2);
        continue;
      }
      const r = Math.max(realRadius, MIN_PARTICLE_PX);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
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
      if (world.particles.isFixed(i)) continue;
      const x0 = camera.toScreenX(pos[2 * i]);
      const y0 = camera.toScreenY(pos[2 * i + 1]);
      const x1 = camera.toScreenX(pos[2 * i] + vel[2 * i] * VELOCITY_ARROW_TIME);
      const y1 = camera.toScreenY(pos[2 * i + 1] + vel[2 * i + 1] * VELOCITY_ARROW_TIME);
      drawArrow(ctx, x0, y0, x1, y1);
    }
  }

  /** Dashed tether from a grabbed particle to the pointer. */
  private drawGrab(world: World): void {
    if (!world.grab) return;
    const { ctx, camera } = this;
    const i = world.grab.particle;
    const tx = camera.toScreenX(world.grab.target.x);
    const ty = camera.toScreenY(world.grab.target.y);
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(camera.toScreenX(world.particles.pos[2 * i]), camera.toScreenY(world.particles.pos[2 * i + 1]));
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, 2 * Math.PI);
    ctx.stroke();
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
