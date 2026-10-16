import { Vec2 } from '../core/vec2';
import { type ChargeWorld, traceFieldLine } from '../em/charges';
import type { MaxwellWorld } from '../em/fdtd';
import type { RailWorld } from '../em/induction';
import type { Camera } from './camera';
import { theme } from './theme';
import { LUT_SIZE, lut as divergingLut } from './waveRenderer';

const POSITIVE = '#e66767';
const NEGATIVE = '#3987e5';
/** Screen pixels per cell of the background field map. */
const MAP_CELL = 4;

interface MapCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData | null;
}

const mapCache: MapCache = (() => {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : (null as unknown as HTMLCanvasElement);
  return { canvas, ctx: canvas?.getContext('2d') as CanvasRenderingContext2D, image: null };
})();

/** Sequential ramp for field strength, dark to bright blue. */
const RAMP: [number, number, number][] = [
  [0x1b, 0x1b, 0x1a],
  [0x18, 0x4f, 0x95],
  [0x25, 0x6a, 0xbf],
  [0x39, 0x87, 0xe5],
  [0x6d, 0xa7, 0xec],
  [0xb7, 0xd3, 0xf6],
];

function ramp(s: number): [number, number, number] {
  const x = Math.min(0.999, Math.max(0, s)) * (RAMP.length - 1);
  const a = Math.floor(x);
  const w = x - a;
  return [0, 1, 2].map((c) => RAMP[a][c] + (RAMP[a + 1][c] - RAMP[a][c]) * w) as [number, number, number];
}

/**
 * Background map: the electric potential (diverging, red positive, blue
 * negative) in bands, so the band edges are equipotential lines; or, for
 * currents, the magnetic field strength.
 */
function drawFieldMap(ctx: CanvasRenderingContext2D, camera: Camera, sim: ChargeWorld): void {
  const cols = Math.ceil(camera.width / MAP_CELL);
  const rows = Math.ceil(camera.height / MAP_CELL);
  const cache = mapCache;
  if (cache.canvas.width !== cols || cache.canvas.height !== rows || !cache.image) {
    cache.canvas.width = cols;
    cache.canvas.height = rows;
    cache.image = cache.ctx.createImageData(cols, rows);
  }
  // Scale: the potential (or field) one fifth of the view away from the strongest particle.
  let strongest = 0;
  for (let i = 0; i < sim.n; i++) if (sim.active[i]) strongest = Math.max(strongest, Math.abs(sim.q[i]));
  const reach = Math.min(camera.width, camera.height) / camera.scale / 5;
  const probe = sim.law === 'coulomb' ? (8.99e9 * strongest) / reach : (2e-7 * strongest) / reach;
  if (probe === 0) return;
  const data = cache.image.data;
  const bands = 14;
  const origin = camera.toWorld(0, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = origin.x + ((c + 0.5) * MAP_CELL) / camera.scale;
      const y = origin.y - ((r + 0.5) * MAP_CELL) / camera.scale;
      const p = 4 * (r * cols + c);
      let rgb: [number, number, number];
      if (sim.law === 'coulomb') {
        // Compressed (asinh) and banded: each band edge is an equipotential.
        const u = Math.asinh(sim.potentialAt(x, y) / probe) / Math.asinh(40);
        const band = Math.round(Math.max(-1, Math.min(1, u)) * bands);
        const idx = Math.round(((band / bands + 1) / 2) * (LUT_SIZE - 1));
        const shade = band % 2 === 0 ? 1 : 0.85;
        rgb = [divergingLut[3 * idx] * shade, divergingLut[3 * idx + 1] * shade, divergingLut[3 * idx + 2] * shade];
      } else {
        const [bx, by] = sim.particleField(x, y);
        rgb = ramp(Math.asinh(Math.hypot(bx, by) / probe) / Math.asinh(30));
      }
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
  }
  cache.ctx.putImageData(cache.image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cache.canvas, 0, 0, cols * MAP_CELL, rows * MAP_CELL);
}

/** Field lines: out of the positive charges (or into the negative ones), or loops round each current. */
function drawFieldLines(ctx: CanvasRenderingContext2D, camera: Camera, sim: ChargeWorld): void {
  const view = Math.max(camera.width, camera.height) / camera.scale;
  const step = view / 300;
  const lo = camera.toWorld(-camera.width * 0.25, camera.height * 1.25);
  const hi = camera.toWorld(camera.width * 1.25, -camera.height * 0.25);
  const field = (x: number, y: number) => sim.particleField(x, y);
  const inside = (x: number, y: number, sign: number) => {
    for (let j = 0; j < sim.n; j++) {
      if (sim.active[j] && Math.sign(sim.q[j]) === sign && Math.hypot(x - sim.x[j], y - sim.y[j]) < sim.radius[j]) return true;
    }
    return false;
  };
  const outside = (x: number, y: number) => x < lo.x || x > hi.x || y < lo.y || y > hi.y;
  const lines: Vec2[][] = [];
  let strongest = 0;
  for (let i = 0; i < sim.n; i++) if (sim.active[i]) strongest = Math.max(strongest, Math.abs(sim.q[i]));
  if (strongest === 0) return;

  if (sim.law === 'coulomb') {
    let net = 0;
    for (let i = 0; i < sim.n; i++) if (sim.active[i]) net += sim.q[i];
    // Seed on the side that has more charge, so every line ends somewhere sensible.
    const sign = net >= 0 ? 1 : -1;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.active[i] || Math.sign(sim.q[i]) !== sign) continue;
      const count = Math.max(4, Math.round((16 * Math.abs(sim.q[i])) / strongest));
      for (let k = 0; k < count; k++) {
        const a = (2 * Math.PI * (k + 0.5)) / count;
        const start = new Vec2(sim.x[i] + 1.2 * sim.radius[i] * Math.cos(a), sim.y[i] + 1.2 * sim.radius[i] * Math.sin(a));
        lines.push(traceFieldLine(field, start, step, 900, (x, y) => outside(x, y) || inside(x, y, -sign), sign as 1 | -1));
      }
    }
  } else {
    // Loops at growing distances to the right of each current.
    for (let i = 0; i < sim.n; i++) {
      if (!sim.active[i] || sim.q[i] === 0) continue;
      for (const d of [1.6, 3, 5, 8, 12, 17]) {
        const start = new Vec2(sim.x[i] + d * sim.radius[i] * 2, sim.y[i]);
        lines.push(traceFieldLine(field, start, step, 1500, outside));
      }
    }
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1;
  for (const line of lines) {
    if (line.length < 2) continue;
    ctx.beginPath();
    line.forEach((p, k) => (k === 0 ? ctx.moveTo(camera.toScreenX(p.x), camera.toScreenY(p.y)) : ctx.lineTo(camera.toScreenX(p.x), camera.toScreenY(p.y))));
    ctx.stroke();
    // An arrowhead a third of the way along, pointing with the field.
    const m = Math.floor(line.length / 3);
    if (m < 1) continue;
    const a = line[m - 1];
    const b = line[m];
    const x = camera.toScreenX(b.x);
    const y = camera.toScreenY(b.y);
    const ang = Math.atan2(camera.toScreenY(b.y) - camera.toScreenY(a.y), camera.toScreenX(b.x) - camera.toScreenX(a.x));
    // Coulomb lines from negative seeds were traced backwards: flip.
    const flip = sim.law === 'coulomb' && line.length > 1 && sim.particleField(b.x, b.y)[0] * (b.x - a.x) + sim.particleField(b.x, b.y)[1] * (b.y - a.y) < 0;
    const dir = flip ? ang + Math.PI : ang;
    ctx.beginPath();
    ctx.moveTo(x + 5 * Math.cos(dir), y + 5 * Math.sin(dir));
    ctx.lineTo(x + 4 * Math.cos(dir + 2.5), y + 4 * Math.sin(dir + 2.5));
    ctx.lineTo(x + 4 * Math.cos(dir - 2.5), y + 4 * Math.sin(dir - 2.5));
    ctx.closePath();
    ctx.fill();
  }
}

/** Plates for electric field regions, and ⊙/⊗ marks where there is a magnetic field. */
function drawRegions(ctx: CanvasRenderingContext2D, camera: Camera, sim: ChargeWorld): void {
  for (const f of sim.fields) {
    const lo = f.min ?? camera.toWorld(0, camera.height);
    const hi = f.max ?? camera.toWorld(camera.width, 0);
    const left = camera.toScreenX(lo.x);
    const right = camera.toScreenX(hi.x);
    const top = camera.toScreenY(hi.y);
    const bottom = camera.toScreenY(lo.y);
    if (f.B) {
      // A sparse grid of field marks.
      const gap = 36;
      ctx.strokeStyle = 'rgba(201, 133, 0, 0.55)';
      ctx.fillStyle = 'rgba(201, 133, 0, 0.55)';
      ctx.lineWidth = 1.2;
      for (let y = top + gap / 2; y < bottom; y += gap) {
        for (let x = left + gap / 2; x < right; x += gap) {
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
          ctx.stroke();
          if (f.B > 0) {
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.moveTo(x - 3, y - 3);
            ctx.lineTo(x + 3, y + 3);
            ctx.moveTo(x + 3, y - 3);
            ctx.lineTo(x - 3, y + 3);
            ctx.stroke();
          }
        }
      }
    }
    if (f.E && f.min && f.max && (f.E.x !== 0 || f.E.y !== 0)) {
      // Plates across the field: the one the field points away from is positive.
      ctx.lineWidth = 4;
      const up = f.E.y < 0; // field pointing down: top plate positive
      ctx.strokeStyle = up ? POSITIVE : NEGATIVE;
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(right, top);
      ctx.stroke();
      ctx.strokeStyle = up ? NEGATIVE : POSITIVE;
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      // Faint field arrows between the plates.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      const dir = up ? 1 : -1;
      for (let x = left + 20; x < right - 10; x += 30) {
        const y0 = dir > 0 ? top + 6 : bottom - 6;
        const y1 = dir > 0 ? bottom - 6 : top + 6;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.lineTo(x - 3, y1 - 5 * dir);
        ctx.moveTo(x, y1);
        ctx.lineTo(x + 3, y1 - 5 * dir);
        ctx.stroke();
      }
    }
  }
}

export function drawCharges(ctx: CanvasRenderingContext2D, camera: Camera, sim: ChargeWorld): void {
  if (sim.law !== 'none') {
    drawFieldMap(ctx, camera, sim);
    drawFieldLines(ctx, camera, sim);
  }
  drawRegions(ctx, camera, sim);

  if (sim.screen !== null) {
    const x = camera.toScreenX(sim.screen);
    ctx.strokeStyle = theme.inkSecondary;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, camera.toScreenY(sim.box?.max.y ?? 1));
    ctx.lineTo(x, camera.toScreenY(sim.box?.min.y ?? -1));
    ctx.stroke();
    // Glow where the beam lands.
    ctx.fillStyle = 'rgba(25, 158, 112, 0.35)';
    for (const y of sim.hits.slice(-60)) {
      ctx.beginPath();
      ctx.arc(x, camera.toScreenY(y), 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < sim.n; i++) {
    if (!sim.active[i]) continue;
    const x = camera.toScreenX(sim.x[i]);
    const y = camera.toScreenY(sim.y[i]);
    const r = Math.max(sim.radius[i] * camera.scale, 2.5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = sim.colors[i];
    ctx.fill();
    if (r < 7) continue;
    ctx.strokeStyle = theme.surface;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = theme.surface;
    ctx.strokeStyle = theme.surface;
    if (sim.law === 'ampere') {
      // Current out of the screen ⊙, into it ⊗.
      if (sim.q[i] >= 0) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.25, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        const d = r * 0.45;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - d, y - d);
        ctx.lineTo(x + d, y + d);
        ctx.moveTo(x + d, y - d);
        ctx.lineTo(x - d, y + d);
        ctx.stroke();
      }
    } else {
      ctx.fillText(sim.q[i] >= 0 ? '+' : '−', x, y + 0.5);
    }
  }

  if (sim.grab) {
    const i = sim.grab.particle;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(camera.toScreenX(sim.x[i]), camera.toScreenY(sim.y[i]));
    ctx.lineTo(camera.toScreenX(sim.grab.target.x), camera.toScreenY(sim.grab.target.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ── Rails ──────────────────────────────────────────────────────────────────

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - 7 * Math.cos(a - 0.45), y1 - 7 * Math.sin(a - 0.45));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - 7 * Math.cos(a + 0.45), y1 - 7 * Math.sin(a + 0.45));
  ctx.stroke();
}

export function drawRails(ctx: CanvasRenderingContext2D, camera: Camera, rail: RailWorld): void {
  const half = rail.length / 2;
  const sx = (x: number) => camera.toScreenX(x);
  const sy = (y: number) => camera.toScreenY(y);

  // The field: ⊙ (out of the screen) or ⊗ marks over the whole circuit.
  if (rail.field !== 0) {
    const gap = 34;
    ctx.strokeStyle = 'rgba(201, 133, 0, 0.5)';
    ctx.fillStyle = 'rgba(201, 133, 0, 0.5)';
    ctx.lineWidth = 1.2;
    for (let y = sy(half * 1.6); y < sy(-half * 1.6); y += gap) {
      for (let x = sx(-0.1 * rail.end) + gap / 2; x < sx(rail.end * 1.05); x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
        ctx.stroke();
        if (rail.field > 0) {
          ctx.beginPath();
          ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(x - 3, y - 3);
          ctx.lineTo(x + 3, y + 3);
          ctx.moveTo(x + 3, y - 3);
          ctx.lineTo(x - 3, y + 3);
          ctx.stroke();
        }
      }
    }
  }

  // Rails and the resistor joining them at x = 0.
  ctx.strokeStyle = theme.inkSecondary;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx(0), sy(half));
  ctx.lineTo(sx(rail.end), sy(half));
  ctx.moveTo(sx(0), sy(-half));
  ctx.lineTo(sx(rail.end), sy(-half));
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  const zig = 8;
  const top = sy(half);
  const bottom = sy(-half);
  ctx.moveTo(sx(0), top);
  ctx.lineTo(sx(0), top + (bottom - top) * 0.25);
  for (let k = 0; k <= zig; k++) {
    const y = top + (bottom - top) * (0.25 + (0.5 * k) / zig);
    ctx.lineTo(sx(0) + (k % 2 === 0 ? -7 : 7), y);
  }
  ctx.lineTo(sx(0), top + (bottom - top) * 0.75);
  ctx.lineTo(sx(0), bottom);
  ctx.stroke();
  ctx.font = theme.font;
  ctx.fillStyle = theme.inkSecondary;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`R = ${rail.resistance} Ом`, sx(0) - 12, sy(0));

  // The rod.
  ctx.strokeStyle = rail.color;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx(rail.x), sy(half * 1.15));
  ctx.lineTo(sx(rail.x), sy(-half * 1.15));
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Current round the circuit: v×B pushes charges along the rod.
  const I = rail.current();
  if (Math.abs(I) > 1e-4) {
    const down = I > 0; // B out of the screen, rod moving right: v×B drives the current down the rod
    ctx.strokeStyle = theme.series[2];
    ctx.lineWidth = 2;
    const dir = down ? -1 : 1;
    const midRod = sx(rail.x) - 14;
    arrow(ctx, midRod, sy(0) - 14 * dir, midRod, sy(0) + 14 * dir);
    const midRail = (sx(0) + sx(rail.x)) / 2;
    arrow(ctx, midRail + 14 * dir, sy(half) - 8, midRail - 14 * dir, sy(half) - 8);
    arrow(ctx, midRail - 14 * dir, sy(-half) + 8, midRail + 14 * dir, sy(-half) + 8);
  }

  // The pull, as an arrow from the rod.
  if (rail.pull > 0) {
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    arrow(ctx, sx(rail.x) + 6, sy(-half * 1.3), sx(rail.x) + 6 + 40, sy(-half * 1.3));
  }
}

// ── Light ──────────────────────────────────────────────────────────────────

interface FieldCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  range: number;
}

const lightCaches = new WeakMap<MaxwellWorld, FieldCache>();

export function drawMaxwell(ctx: CanvasRenderingContext2D, camera: Camera, sim: MaxwellWorld): void {
  let cache = lightCaches.get(sim);
  if (!cache) {
    const canvas = document.createElement('canvas');
    canvas.width = sim.nx;
    canvas.height = sim.ny;
    const c = canvas.getContext('2d')!;
    cache = { canvas, ctx: c, image: c.createImageData(sim.nx, sim.ny), range: 0 };
    lightCaches.set(sim, cache);
  }
  // Colour range: the 99th percentile of |Ez|, smoothed over frames.
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(sim.ez.length / 4000));
  for (let k = 0; k < sim.ez.length; k += stride) sample.push(Math.abs(sim.ez[k]));
  sample.sort((a, b) => a - b);
  const target = Math.max(sample[Math.floor(0.99 * (sample.length - 1))] ?? 0, 1e-12);
  cache.range = cache.range === 0 ? target : cache.range + (target - cache.range) * 0.05;

  const { nx, ny, ez, epsilon, metal } = sim;
  const data = cache.image.data;
  for (let j = 0; j < ny; j++) {
    const row = (ny - 1 - j) * nx;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const p = 4 * (row + i);
      if (metal[k]) {
        data[p] = 0x89;
        data[p + 1] = 0x87;
        data[p + 2] = 0x81;
      } else {
        const idx = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(((ez[k] / cache.range + 1) / 2) * (LUT_SIZE - 1))));
        // Glass shows as a lighter tint behind the wave.
        const lift = epsilon[k] > 1.01 ? 22 : 0;
        data[p] = Math.min(255, divergingLut[3 * idx] + lift);
        data[p + 1] = Math.min(255, divergingLut[3 * idx + 1] + lift);
        data[p + 2] = Math.min(255, divergingLut[3 * idx + 2] + lift);
      }
      data[p + 3] = 255;
    }
  }
  cache.ctx.putImageData(cache.image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cache.canvas, camera.toScreenX(sim.x0), camera.toScreenY(sim.y0 + ny * sim.spacing), nx * sim.spacing * camera.scale, ny * sim.spacing * camera.scale);

  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1.5;
  for (const s of sim.sources) {
    if (s.kind === 'point') {
      ctx.beginPath();
      ctx.arc(camera.toScreenX(s.position.x), camera.toScreenY(s.position.y), 6, 0, 2 * Math.PI);
      ctx.stroke();
    } else {
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(camera.toScreenX(s.position.x), camera.toScreenY(sim.y0));
      ctx.lineTo(camera.toScreenX(s.position.x), camera.toScreenY(sim.y0 + ny * sim.spacing));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.font = theme.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  sim.probes.forEach((p, k) => {
    const x = camera.toScreenX(p.x);
    const y = camera.toScreenY(p.y);
    ctx.fillStyle = theme.ink;
    ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.fillText(String.fromCharCode(65 + k), x + 5, y - 4);
  });
}
