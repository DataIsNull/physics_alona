import { type LengthUnit, METRES, formatLength } from '../core/units';
import type { Camera } from './camera';
import { theme } from './theme';

/** Smallest "nice" step (1, 2 or 5 × 10ⁿ) that is at least `min`. */
export function niceStep(min: number): number {
  const base = 10 ** Math.floor(Math.log10(min));
  for (const m of [1, 2, 5]) if (m * base >= min) return m * base;
  return 10 * base;
}

/** Labelled grid; spacing adapts to the zoom level and is "nice" in the display unit. */
export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, unit: LengthUnit = METRES): void {
  const step = niceStep(80 / (camera.scale * unit.metres)) * unit.metres;
  const { min, max } = camera.visibleBounds();
  const { width, height } = camera;

  ctx.lineWidth = 1;
  ctx.font = theme.font;
  ctx.fillStyle = theme.inkMuted;

  const firstX = Math.ceil(min.x / step);
  const lastX = Math.floor(max.x / step);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (let i = firstX; i <= lastX; i++) {
    const sx = Math.round(camera.toScreenX(i * step)) + 0.5;
    ctx.strokeStyle = i === 0 ? theme.axis : theme.grid;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
    ctx.fillText(formatLength(i * step, unit), sx + 4, height - 4);
  }

  const firstY = Math.ceil(min.y / step);
  const lastY = Math.floor(max.y / step);
  ctx.textBaseline = 'top';
  for (let i = firstY; i <= lastY; i++) {
    const sy = Math.round(camera.toScreenY(i * step)) + 0.5;
    ctx.strokeStyle = i === 0 ? theme.axis : theme.grid;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
    ctx.fillText(formatLength(i * step, unit), 4, sy + 3);
  }
}
