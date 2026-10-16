import type { Camera } from './camera';
import { theme } from './theme';

export interface InsetChart {
  title: string;
  /** Measured values per bin, plotted as bars. */
  bars: readonly number[];
  /** x range covered by the bars. */
  range: readonly [number, number];
  /** Theory on the same axes, drawn as a line. */
  theory?: (x: number) => number;
  /** Shared y ceiling; defaults to the largest bar or theory value. */
  yMax?: number;
  formatX(x: number): string;
  /** Marks on the x axis (e.g. ideal lattice distances). */
  ticks?: readonly number[];
  barLabel?: string;
  theoryLabel?: string;
}

/**
 * Small chart pinned to the top-right corner of the canvas: a histogram of
 * the simulation against theory (speed distribution, g(r), density
 * profile). Thin bars with gaps, a 2px theory line, labels in ink colours.
 */
export function drawInset(ctx: CanvasRenderingContext2D, camera: Camera, chart: InsetChart): void {
  const w = Math.min(280, camera.width * 0.36);
  const h = Math.min(170, camera.height * 0.38);
  const x0 = camera.width - w - 12;
  const y0 = 44;
  const pad = { left: 10, right: 10, top: 22, bottom: 34 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  ctx.fillStyle = 'rgba(26, 26, 25, 0.92)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 8);
  ctx.fill();
  ctx.stroke();

  ctx.font = theme.font;
  ctx.fillStyle = theme.inkSecondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(chart.title, x0 + pad.left, y0 + 6);

  const [lo, hi] = chart.range;
  const n = chart.bars.length;
  let yMax = chart.yMax ?? Math.max(...chart.bars, 1e-30);
  if (chart.theory && chart.yMax === undefined) {
    for (let k = 0; k <= 60; k++) yMax = Math.max(yMax, chart.theory(lo + ((hi - lo) * k) / 60));
  }
  yMax *= 1.1;
  const px = (x: number) => x0 + pad.left + ((x - lo) / (hi - lo)) * pw;
  const py = (y: number) => y0 + pad.top + ph - (Math.min(y, yMax) / yMax) * ph;

  // Baseline.
  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.moveTo(x0 + pad.left, y0 + pad.top + ph + 0.5);
  ctx.lineTo(x0 + pad.left + pw, y0 + pad.top + ph + 0.5);
  ctx.stroke();

  // Bars with a 2px gap.
  const barW = pw / n;
  ctx.fillStyle = theme.series[0];
  for (let k = 0; k < n; k++) {
    const top = py(chart.bars[k]);
    const height = y0 + pad.top + ph - top;
    if (height <= 0) continue;
    ctx.fillRect(x0 + pad.left + k * barW + 1, top, Math.max(barW - 2, 1), height);
  }

  if (chart.theory) {
    ctx.strokeStyle = theme.series[1];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 80; k++) {
      const x = lo + ((hi - lo) * k) / 80;
      const sx = px(x);
      const sy = py(chart.theory(x));
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  ctx.fillStyle = theme.inkMuted;
  ctx.strokeStyle = theme.inkMuted;
  ctx.lineWidth = 1;
  for (const t of chart.ticks ?? []) {
    const sx = px(t);
    ctx.beginPath();
    ctx.moveTo(sx, y0 + pad.top + ph);
    ctx.lineTo(sx, y0 + pad.top + ph + 5);
    ctx.stroke();
  }

  // Axis ends and legend.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(chart.formatX(lo), x0 + pad.left, y0 + pad.top + ph + 4);
  ctx.textAlign = 'right';
  ctx.fillText(chart.formatX(hi), x0 + pad.left + pw, y0 + pad.top + ph + 4);
  const legendY = y0 + h - 12;
  ctx.textAlign = 'left';
  let lx = x0 + pad.left;
  const key = (color: string, label: string, bar: boolean) => {
    ctx.fillStyle = color;
    if (bar) ctx.fillRect(lx, legendY - 4, 8, 8);
    else ctx.fillRect(lx, legendY - 1, 12, 2);
    lx += bar ? 12 : 16;
    ctx.fillStyle = theme.inkSecondary;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx, legendY);
    lx += ctx.measureText(label).width + 12;
  };
  key(theme.series[0], chart.barLabel ?? 'модель', true);
  if (chart.theory) key(theme.series[1], chart.theoryLabel ?? 'теорія', false);
}

/** Histogram of values into `bins` equal bins over [lo, hi], normalised to a probability density. */
export function densityHistogram(values: readonly number[], lo: number, hi: number, bins: number): number[] {
  const counts = new Array<number>(bins).fill(0);
  const width = (hi - lo) / bins;
  for (const v of values) {
    const k = Math.floor((v - lo) / width);
    if (k >= 0 && k < bins) counts[k]++;
  }
  return counts.map((c) => c / (values.length * width || 1));
}
