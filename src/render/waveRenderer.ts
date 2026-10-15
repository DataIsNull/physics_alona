import type { WaveField } from '../waves/field';
import type { StringEnd, WaveString } from '../waves/string';
import type { Camera } from './camera';
import type { RenderLayers } from './renderer';
import { theme } from './theme';

/** Diverging colour scale for signed displacement: blue troughs, neutral calm, red crests. */
const NEGATIVE: [number, number, number] = [0x39, 0x87, 0xe5];
const NEUTRAL: [number, number, number] = [0x2b, 0x2b, 0x29];
const POSITIVE: [number, number, number] = [0xe6, 0x67, 0x67];
const WALL: [number, number, number] = [0x89, 0x87, 0x81];
const LUT_SIZE = 512;

const lut = (() => {
  const table = new Uint8ClampedArray(LUT_SIZE * 3);
  for (let k = 0; k < LUT_SIZE; k++) {
    const s = (2 * k) / (LUT_SIZE - 1) - 1; // −1 … 1
    const pole = s < 0 ? NEGATIVE : POSITIVE;
    const w = Math.abs(s) ** 0.8; // lift small amplitudes a little
    for (let c = 0; c < 3; c++) table[3 * k + c] = NEUTRAL[c] + (pole[c] - NEUTRAL[c]) * w;
  }
  return table;
})();

interface FieldCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  /** Smoothed colour-scale range, so the picture doesn't flicker. */
  range: number;
}

const caches = new WeakMap<WaveField, FieldCache>();

function cacheFor(field: WaveField): FieldCache {
  let cache = caches.get(field);
  if (!cache) {
    const canvas = document.createElement('canvas');
    canvas.width = field.nx;
    canvas.height = field.ny;
    const ctx = canvas.getContext('2d')!;
    cache = { canvas, ctx, image: ctx.createImageData(field.nx, field.ny), range: 0 };
    caches.set(field, cache);
  }
  return cache;
}

/** Robust amplitude: the 98th percentile of |u| over a sample of cells (sources' own peaks don't wash the rest out). */
function typicalAmplitude(field: WaveField): number {
  const stride = Math.max(1, Math.floor(field.u.length / 3000));
  const values: number[] = [];
  for (let k = 0; k < field.u.length; k += stride) if (!field.wall[k]) values.push(Math.abs(field.u[k]));
  values.sort((a, b) => a - b);
  return values[Math.floor(0.98 * (values.length - 1))] ?? 0;
}

export function drawField(ctx: CanvasRenderingContext2D, camera: Camera, field: WaveField): void {
  const cache = cacheFor(field);
  const target = Math.max(typicalAmplitude(field), field.peak() * 0.05, 1e-30);
  cache.range = cache.range === 0 ? target : cache.range + (target - cache.range) * 0.08;
  const scale = (LUT_SIZE - 1) / 2 / cache.range;
  const data = cache.image.data;
  const { nx, ny, u, wall } = field;
  for (let j = 0; j < ny; j++) {
    const row = (ny - 1 - j) * nx; // image rows run top-down, y runs bottom-up
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const p = 4 * (row + i);
      if (wall[k] && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
        data[p] = WALL[0];
        data[p + 1] = WALL[1];
        data[p + 2] = WALL[2];
      } else {
        const idx = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(u[k] * scale + (LUT_SIZE - 1) / 2)));
        data[p] = lut[3 * idx];
        data[p + 1] = lut[3 * idx + 1];
        data[p + 2] = lut[3 * idx + 2];
      }
      data[p + 3] = 255;
    }
  }
  cache.ctx.putImageData(cache.image, 0, 0);

  const half = field.dx / 2;
  const left = camera.toScreenX(field.x0 - half);
  const top = camera.toScreenY(field.y(ny - 1) + half);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cache.canvas, left, top, nx * field.dx * camera.scale, ny * field.dx * camera.scale);

  // Sources: rings that follow moving sources.
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1.5;
  for (const s of field.sources) {
    const p = s.position(field.t);
    ctx.beginPath();
    ctx.arc(camera.toScreenX(p.x), camera.toScreenY(p.y), Math.max(4, s.radius * camera.scale), 0, 2 * Math.PI);
    ctx.stroke();
  }
  for (const line of field.lineSources) {
    const x = camera.toScreenX(line.x);
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, camera.toScreenY(field.y(ny - 1)));
    ctx.lineTo(x, camera.toScreenY(field.y(0)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Probes: small squares with letters.
  ctx.font = theme.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  field.probes.forEach((p, k) => {
    const x = camera.toScreenX(p.x);
    const y = camera.toScreenY(p.y);
    ctx.fillStyle = theme.ink;
    ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.fillText(String.fromCharCode(65 + k), x + 5, y - 4);
  });

  if (field.screen) drawScreen(ctx, camera, field);
}

/** The screen line and its time-averaged intensity profile, drawn sideways to its right. */
function drawScreen(ctx: CanvasRenderingContext2D, camera: Camera, field: WaveField): void {
  const s = field.screen!;
  const x = camera.toScreenX(field.x(s.column));
  ctx.strokeStyle = theme.inkSecondary;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, camera.toScreenY(field.y(field.ny - 1)));
  ctx.lineTo(x, camera.toScreenY(field.y(0)));
  ctx.stroke();
  ctx.setLineDash([]);

  let max = 0;
  for (const v of s.intensity) max = Math.max(max, v);
  if (max === 0) return;
  const width = 0.18 * (field.nx - 1) * field.dx * camera.scale;
  ctx.strokeStyle = theme.series[3];
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let j = 0; j < field.ny; j++) {
    const px = x + (width * s.intensity[j]) / max;
    const py = camera.toScreenY(field.y(j));
    if (j === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export function drawString(ctx: CanvasRenderingContext2D, camera: Camera, s: WaveString, layers: RenderLayers): void {
  // Rest line.
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(camera.toScreenX(s.origin.x), camera.toScreenY(s.origin.y));
  ctx.lineTo(camera.toScreenX(s.origin.x + s.length), camera.toScreenY(s.origin.y));
  ctx.stroke();
  ctx.setLineDash([]);

  if (layers.analytic && s.exact) {
    const exact = s.exact;
    ctx.strokeStyle = theme.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i < s.n; i++) {
      const x = camera.toScreenX(s.nodeX(i));
      const y = camera.toScreenY(s.origin.y + exact(i * s.dx, s.t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = s.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < s.n; i++) {
    const x = camera.toScreenX(s.nodeX(i));
    const y = camera.toScreenY(s.nodeY(i));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (s.n <= 80) {
    ctx.fillStyle = s.color;
    for (let i = 0; i < s.n; i++) {
      ctx.beginPath();
      ctx.arc(camera.toScreenX(s.nodeX(i)), camera.toScreenY(s.nodeY(i)), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  drawEnd(ctx, camera, s, s.left, 0);
  drawEnd(ctx, camera, s, s.right, s.n - 1);

  if (s.grab) {
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(camera.toScreenX(s.nodeX(s.grab.node)), camera.toScreenY(s.nodeY(s.grab.node)), 6, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

function drawEnd(ctx: CanvasRenderingContext2D, camera: Camera, s: WaveString, end: StringEnd, i: number): void {
  const x = camera.toScreenX(s.nodeX(i));
  const y = camera.toScreenY(s.nodeY(i));
  if (end.kind === 'fixed') {
    ctx.fillStyle = theme.anchor;
    ctx.fillRect(x - 4, y - 4, 8, 8);
  } else if (end.kind === 'free') {
    // A ring on a frictionless pole.
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, camera.toScreenY(s.origin.y) - 60);
    ctx.lineTo(x, camera.toScreenY(s.origin.y) + 60);
    ctx.stroke();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 5, 3, 0, 0, 2 * Math.PI);
    ctx.stroke();
  } else {
    // The shaking hand.
    ctx.fillStyle = theme.ink;
    ctx.fillRect(x - 6, y - 6, 12, 12);
  }
}
