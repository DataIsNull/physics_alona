import type { FlowWorld } from '../fluid/lbm';
import type { SphWorld } from '../fluid/sph';
import type { Camera } from './camera';
import { theme } from './theme';
import { LUT_SIZE, lut as divergingLut } from './waveRenderer';

/** Sequential blue ramp: still or low-pressure water dark, fast or squeezed water bright (one hue for a magnitude). */
const RAMP = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
const WALL = '#45453f';

export function drawSph(ctx: CanvasRenderingContext2D, camera: Camera, sph: SphWorld): void {
  const dx = sph.spacing;
  const side = dx * camera.scale;

  // Walls: their particles as solid squares.
  ctx.fillStyle = WALL;
  ctx.beginPath();
  for (let i = sph.nFluid; i < sph.n; i++) {
    if (!sph.isWall(i)) continue;
    ctx.rect(camera.toScreenX(sph.x[i] - dx / 2), camera.toScreenY(sph.y[i] + dx / 2), side + 0.5, side + 0.5);
  }
  ctx.fill();

  // Water: one path per colour bin.
  const bins: number[][] = RAMP.map(() => []);
  const byPressure = sph.colorBy === 'pressure';
  const scale = byPressure ? sph.referencePressure : 1.2 * sph.referenceSpeed;
  for (let i = 0; i < sph.nFluid; i++) {
    const value = byPressure ? sph.pressureOf(i) : Math.hypot(sph.vx[i], sph.vy[i]);
    const k = Math.min(RAMP.length - 1, Math.max(0, Math.floor((value / scale) * RAMP.length)));
    bins[k].push(i);
  }
  // Well over half the diagonal, so drops overlap into solid water even where the particles shear apart into rows.
  const r = Math.max(0.85 * side, 1.5);
  bins.forEach((list, k) => {
    if (list.length === 0) return;
    ctx.fillStyle = RAMP[k];
    ctx.beginPath();
    for (const i of list) {
      const x = camera.toScreenX(sph.x[i]);
      const y = camera.toScreenY(sph.y[i]);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, 2 * Math.PI);
    }
    ctx.fill();
  });

  // Floating bodies.
  for (const b of sph.bodies) {
    const cos = Math.cos(b.angle);
    const sin = Math.sin(b.angle);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sy]) => {
      const lx = (sx * b.width) / 2;
      const ly = (sy * b.height) / 2;
      return [camera.toScreenX(b.x + cos * lx - sin * ly), camera.toScreenY(b.y + sin * lx + cos * ly)];
    });
    ctx.beginPath();
    corners.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.strokeStyle = theme.surface;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const g = sph.grab;
  if (g) {
    let from: [number, number];
    if (g.kind === 'body') {
      const b = sph.bodies[g.body];
      const p = g.local.rotate(b.angle);
      from = [b.x + p.x, b.y + p.y];
    } else {
      let sx = 0;
      let sy = 0;
      for (const i of g.particles) {
        sx += sph.x[i];
        sy += sph.y[i];
      }
      from = [sx / g.particles.length, sy / g.particles.length];
    }
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(camera.toScreenX(from[0]), camera.toScreenY(from[1]));
    ctx.lineTo(camera.toScreenX(g.target.x), camera.toScreenY(g.target.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ── Lattice flow ────────────────────────────────────────────────────────────

const SOLID: [number, number, number] = [0x89, 0x87, 0x81];
const DARK: [number, number, number] = [0x1b, 0x1b, 0x1a];

/** Sequential table for speed: near-black still water up through the blue ramp. */
const speedLut = (() => {
  const stops = [DARK, ...RAMP.map((c) => [1, 3, 5].map((o) => parseInt(c.slice(o, o + 2), 16)) as [number, number, number])];
  const table = new Uint8ClampedArray(LUT_SIZE * 3);
  for (let k = 0; k < LUT_SIZE; k++) {
    const s = (k / (LUT_SIZE - 1)) * (stops.length - 1);
    const a = Math.min(stops.length - 2, Math.floor(s));
    const w = s - a;
    for (let c = 0; c < 3; c++) table[3 * k + c] = stops[a][c] + (stops[a + 1][c] - stops[a][c]) * w;
  }
  return table;
})();

interface FlowCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  /** Smoothed colour-scale range, so the picture doesn't flicker. */
  range: number;
}

const caches = new WeakMap<FlowWorld, FlowCache>();

function cacheFor(flow: FlowWorld): FlowCache {
  let cache = caches.get(flow);
  if (!cache) {
    const canvas = document.createElement('canvas');
    canvas.width = flow.nx;
    canvas.height = flow.ny;
    const ctx = canvas.getContext('2d')!;
    cache = { canvas, ctx, image: ctx.createImageData(flow.nx, flow.ny), range: 0 };
    caches.set(flow, cache);
  }
  return cache;
}

export function drawFlow(ctx: CanvasRenderingContext2D, camera: Camera, flow: FlowWorld): void {
  const cache = cacheFor(flow);
  const { nx, ny, solid } = flow;
  const vorticity = flow.show === 'vorticity';
  const values = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      values[k] = solid[k] ? 0 : vorticity ? flow.vorticity(i, j) : flow.speed(k);
    }
  }
  // Robust range: the 99th percentile of a sample, smoothed over frames.
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(values.length / 4000));
  for (let k = 0; k < values.length; k += stride) sample.push(Math.abs(values[k]));
  sample.sort((a, b) => a - b);
  const target = Math.max(sample[Math.floor(0.99 * (sample.length - 1))] ?? 0, 1e-12);
  cache.range = cache.range === 0 ? target : cache.range + (target - cache.range) * 0.05;

  const data = cache.image.data;
  for (let j = 0; j < ny; j++) {
    const row = (ny - 1 - j) * nx; // image rows run top-down, y runs bottom-up
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const p = 4 * (row + i);
      if (solid[k]) {
        data[p] = SOLID[0];
        data[p + 1] = SOLID[1];
        data[p + 2] = SOLID[2];
      } else if (vorticity) {
        const idx = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(((values[k] / cache.range + 1) / 2) * (LUT_SIZE - 1))));
        data[p] = divergingLut[3 * idx];
        data[p + 1] = divergingLut[3 * idx + 1];
        data[p + 2] = divergingLut[3 * idx + 2];
      } else {
        const idx = Math.min(LUT_SIZE - 1, Math.max(0, Math.round((values[k] / cache.range) * (LUT_SIZE - 1))));
        data[p] = speedLut[3 * idx];
        data[p + 1] = speedLut[3 * idx + 1];
        data[p + 2] = speedLut[3 * idx + 2];
      }
      data[p + 3] = 255;
    }
  }
  cache.ctx.putImageData(cache.image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cache.canvas, camera.toScreenX(flow.x0), camera.toScreenY(flow.y0 + ny * flow.spacing), nx * flow.spacing * camera.scale, ny * flow.spacing * camera.scale);

  // Dye.
  const right = flow.x0 + nx * flow.spacing;
  const top = flow.y0 + ny * flow.spacing;
  // Small squares: thousands of them, so no arcs.
  ctx.fillStyle = vorticity ? 'rgba(255, 255, 255, 0.75)' : theme.series[3];
  const size = vorticity ? 2 : 3.5;
  for (let k = 0; k < flow.tracerCount; k++) {
    const x = flow.tracerX[k];
    const y = flow.tracerY[k];
    if (x < flow.x0 || x > right || y < flow.y0 || y > top) continue;
    ctx.fillRect(camera.toScreenX(x) - size / 2, camera.toScreenY(y) - size / 2, size, size);
  }

  // The box outline.
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(camera.toScreenX(flow.x0), camera.toScreenY(top), nx * flow.spacing * camera.scale, ny * flow.spacing * camera.scale);

  if (flow.grab) {
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(camera.toScreenX(flow.grab.target.x), camera.toScreenY(flow.grab.target.y), 4 * flow.spacing * camera.scale, 0, 2 * Math.PI);
    ctx.stroke();
  }
}
