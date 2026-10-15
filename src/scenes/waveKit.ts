import { formatSI } from '../core/units';
import type { Camera } from '../render/camera';
import { theme } from '../render/theme';

/** Shown in place of the integrator picker for wave scenes. */
export const WAVE_NOTE =
  'Хвилі: схема «стрибок» (leapfrog) на сітці вузлів; крок сам ділиться на підкроки за умовою Куранта, щоб схема не розходилась.';

export const hertz = (v: number) => `${Number(v.toPrecision(3))} Гц`;
/** Displacement; round-off specks below a femtometre read as zero. */
export const metres = (v: number) => formatSI(Math.abs(v) < 1e-15 ? 0 : v, 'м');

/** A dashed polyline through world points. */
export function dashedPath(ctx: CanvasRenderingContext2D, camera: Camera, points: ReadonlyArray<{ x: number; y: number }>, color: string = theme.inkSecondary): void {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = camera.toScreenX(p.x);
    const y = camera.toScreenY(p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Root of a monotonic function on [lo, hi] by bisection. */
export function bisect(f: (x: number) => number, lo: number, hi: number): number {
  const sign = Math.sign(f(lo));
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(f(mid)) === sign) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
