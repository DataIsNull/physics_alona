import { TIME_UNITS, formatDuration, formatSI } from '../core/units';
import { niceStep } from './grid';
import { theme } from './theme';

export interface SeriesSpec {
  label: string;
  color: string;
}

export type AxisScale = 'linear' | 'log';

const CAPACITY = 3000;
const PAD = { top: 12, bottom: 22, left: 64, right: 12 };
const DIRECT_LABEL_LIMIT = 4;

interface TooltipRow {
  row: HTMLElement;
  value: HTMLElement;
}

/**
 * Rolling time-series line chart on one shared y-axis. Legend entries toggle
 * series; hovering shows a crosshair snapped to the nearest sample.
 */
export class TimeGraph {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private series: SeriesSpec[] = [];
  private readonly hidden = new Set<number>();
  private readonly times = new Float64Array(CAPACITY);
  private values: Float64Array[] = [];
  private start = 0;
  private length = 0;
  private format: (v: number) => string = String;
  private scale: AxisScale = 'linear';
  private hoverX: number | null = null;
  private legendValues: HTMLElement[] = [];
  private tooltipTime!: HTMLElement;
  private tooltipRows: TooltipRow[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly legend: HTMLElement,
    private readonly tooltip: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointermove', (e) => {
      this.hoverX = e.clientX - canvas.getBoundingClientRect().left;
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
    });
  }

  configure(series: SeriesSpec[], format: (v: number) => string, scale: AxisScale = 'linear'): void {
    this.series = series;
    this.format = format;
    this.scale = scale;
    this.hidden.clear();
    this.values = series.map(() => new Float64Array(CAPACITY));
    this.clear();
    this.buildLegend();
    this.buildTooltip();
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
  }

  push(t: number, values: readonly number[]): void {
    let idx: number;
    if (this.length < CAPACITY) {
      idx = (this.start + this.length) % CAPACITY;
      this.length++;
    } else {
      idx = this.start;
      this.start = (this.start + 1) % CAPACITY;
    }
    this.times[idx] = t;
    for (let s = 0; s < this.values.length; s++) this.values[s][idx] = values[s];
  }

  /** Refreshes the legend readouts with the latest values. Call at a low rate. */
  updateLegend(): void {
    const last = this.length > 0 ? this.index(this.length - 1) : -1;
    this.legendValues.forEach((el, s) => {
      el.textContent = last < 0 ? '—' : this.format(this.values[s][last]);
    });
  }

  draw(): void {
    const { ctx, canvas } = this;
    const rect = canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const bw = Math.max(Math.round(rect.width * this.dpr), 1);
    const bh = Math.max(Math.round(rect.height * this.dpr), 1);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const width = rect.width;
    const height = rect.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, width, height);
    ctx.font = theme.font;

    const visible = this.series.map((_, s) => s).filter((s) => !this.hidden.has(s));
    if (this.length < 2 || visible.length === 0) {
      ctx.fillStyle = theme.inkMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.length < 2 ? 'Чекаю даних…' : 'Усі ряди приховано', width / 2, height / 2);
      this.tooltip.hidden = true;
      return;
    }

    // Data extents
    const t0 = this.times[this.index(0)];
    const t1 = this.times[this.index(this.length - 1)];
    const tSpan = Math.max(t1 - t0, 1e-9);
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of visible) {
      const vals = this.values[s];
      for (let i = 0; i < this.length; i++) {
        const v = this.toAxis(vals[this.index(i)]);
        if (!Number.isFinite(v)) continue;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    if (!Number.isFinite(yMin)) {
      yMin = 0;
      yMax = 1;
    }
    let yStep: number;
    let yLo: number;
    let yHi: number;
    if (this.scale === 'log') {
      // Axis values are decades; tick on whole powers of ten.
      yLo = Math.floor(yMin);
      yHi = Math.max(Math.ceil(yMax), yLo + 1);
      yStep = Math.max(1, Math.ceil((yHi - yLo) / 5));
      yLo = Math.floor(yLo / yStep) * yStep;
      yHi = Math.ceil(yHi / yStep) * yStep;
    } else {
      if (yMax - yMin < Math.max(Math.abs(yMax), Math.abs(yMin)) * 1e-9 || yMax === yMin) {
        const pad = Math.max(Math.abs(yMax) * 0.05, 1e-12);
        yMin -= pad;
        yMax += pad;
      }
      yStep = niceStep((yMax - yMin) / 4);
      yLo = Math.floor(yMin / yStep) * yStep;
      yHi = Math.ceil(yMax / yStep) * yStep;
    }

    // Room for direct labels at line ends
    const direct = visible.length <= DIRECT_LABEL_LIMIT;
    const labelWidth = direct ? Math.max(...visible.map((s) => ctx.measureText(this.series[s].label).width)) + 22 : 0;
    // Wide enough for the longest y label (log axes can have long ones).
    let widestLabel = 0;
    for (let k = Math.round(yLo / yStep); k <= Math.round(yHi / yStep); k++) {
      const v = k * yStep;
      widestLabel = Math.max(widestLabel, ctx.measureText(this.format(this.scale === 'log' ? 10 ** v : v)).width);
    }
    const left = Math.max(PAD.left, widestLabel + 14);
    const top = PAD.top;
    const plotW = Math.max(width - left - PAD.right - labelWidth, 10);
    const plotH = Math.max(height - top - PAD.bottom, 10);
    const px = (t: number) => left + ((t - t0) / tSpan) * plotW;
    const py = (v: number) => top + ((yHi - v) / (yHi - yLo)) * plotH;

    // Horizontal grid + y labels
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = Math.round(yLo / yStep); k <= Math.round(yHi / yStep); k++) {
      const v = k * yStep;
      const y = Math.round(py(v)) + 0.5;
      ctx.strokeStyle = k === 0 && this.scale === 'linear' ? theme.axis : theme.grid;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = theme.inkMuted;
      ctx.fillText(this.format(this.scale === 'log' ? 10 ** v : v), left - 8, y);
    }

    // x labels (time), in the largest calendar unit that fits the span twice
    const unit = TIME_UNITS.find(([f]) => tSpan >= 2 * f);
    const unitSeconds = unit ? unit[0] : 1;
    const tStep = niceStep(tSpan / unitSeconds / Math.max(plotW / 90, 1)) * unitSeconds;
    const timeLabel = (t: number) => (unit ? `${Number((t / unitSeconds).toPrecision(3))} ${unit[1]}` : formatSI(t, 'с'));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let k = Math.ceil(t0 / tStep); k * tStep <= t1; k++) {
      ctx.fillText(timeLabel(k * tStep), px(k * tStep), top + plotH + 6);
    }

    // Series lines, downsampled to ~2 points per pixel
    const stride = Math.max(1, Math.floor(this.length / (plotW * 2)));
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const s of visible) {
      const vals = this.values[s];
      ctx.strokeStyle = this.series[s].color;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < this.length; i += stride) {
        const idx = this.index(i);
        const v = this.toAxis(vals[idx]);
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const x = px(this.times[idx]);
        const y = py(v);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      const lastIdx = this.index(this.length - 1);
      const lastV = this.toAxis(vals[lastIdx]);
      if (pen && Number.isFinite(lastV)) ctx.lineTo(px(this.times[lastIdx]), py(lastV));
      ctx.stroke();
    }

    if (direct) this.drawDirectLabels(visible, left + plotW, top, plotH, py);
    this.drawHover(visible, left, plotW, top, plotH, px, py, width);
  }

  private drawDirectLabels(
    visible: number[],
    x: number,
    top: number,
    plotH: number,
    py: (v: number) => number,
  ): void {
    const { ctx } = this;
    const last = this.index(this.length - 1);
    const labels = visible
      .map((s) => {
        const v = this.toAxis(this.values[s][last]);
        return { s, y: Number.isFinite(v) ? py(v) : top + plotH };
      })
      .sort((a, b) => a.y - b.y);
    // Push labels apart so they never overlap, then keep them inside the plot.
    const gap = 13;
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
    const overflow = labels.length ? labels[labels.length - 1].y - (top + plotH) : 0;
    if (overflow > 0) for (const l of labels) l.y -= overflow;
    for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2;
    for (const { s, y } of labels) {
      ctx.strokeStyle = this.series[s].color;
      ctx.beginPath();
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + 14, y);
      ctx.stroke();
      ctx.fillStyle = theme.inkSecondary;
      ctx.fillText(this.series[s].label, x + 18, y);
    }
  }

  private drawHover(
    visible: number[],
    left: number,
    plotW: number,
    top: number,
    plotH: number,
    px: (t: number) => number,
    py: (v: number) => number,
    width: number,
  ): void {
    const { ctx } = this;
    if (this.hoverX === null || this.hoverX < left || this.hoverX > left + plotW) {
      this.tooltip.hidden = true;
      return;
    }
    const tTarget = this.times[this.index(0)] + ((this.hoverX - left) / plotW) * (this.times[this.index(this.length - 1)] - this.times[this.index(0)]);
    const i = this.nearest(tTarget);
    const idx = this.index(i);
    const x = Math.round(px(this.times[idx])) + 0.5;

    ctx.strokeStyle = theme.inkMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotH);
    ctx.stroke();

    for (const s of visible) {
      const v = this.toAxis(this.values[s][idx]);
      if (!Number.isFinite(v)) continue;
      ctx.beginPath();
      ctx.arc(x, py(v), 4, 0, 2 * Math.PI);
      ctx.fillStyle = this.series[s].color;
      ctx.fill();
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    this.tooltipTime.textContent = `t = ${formatDuration(this.times[idx], 4)}`;
    this.tooltipRows.forEach(({ row, value }, s) => {
      row.hidden = this.hidden.has(s);
      value.textContent = this.format(this.values[s][idx]);
    });
    this.tooltip.hidden = false;
    const tipW = this.tooltip.offsetWidth;
    const flip = x + 14 + tipW > width;
    this.tooltip.style.left = `${flip ? x - 14 - tipW : x + 14}px`;
    this.tooltip.style.top = `${top}px`;
  }

  /** Logical index (0 = oldest) of the sample closest to time t. */
  private nearest(t: number): number {
    let lo = 0;
    let hi = this.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[this.index(mid)] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(this.times[this.index(lo - 1)] - t) < Math.abs(this.times[this.index(lo)] - t)) lo--;
    return lo;
  }

  /** Value in axis units: decades on a log axis (NaN for v ≤ 0). */
  private toAxis(v: number): number {
    if (this.scale === 'linear') return v;
    return v > 0 ? Math.log10(v) : NaN;
  }

  private index(i: number): number {
    return (this.start + i) % CAPACITY;
  }

  private buildLegend(): void {
    this.legend.replaceChildren();
    this.legendValues = this.series.map((spec, s) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'legend-item';
      button.setAttribute('aria-pressed', 'true');
      button.title = 'Показати або сховати ряд';

      const key = document.createElement('span');
      key.className = 'line-key';
      key.style.background = spec.color;
      const label = document.createElement('span');
      label.className = 'legend-label';
      label.textContent = spec.label;
      const value = document.createElement('span');
      value.className = 'legend-value';
      value.textContent = '—';

      button.append(key, label, value);
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => {
        if (this.hidden.has(s)) this.hidden.delete(s);
        else this.hidden.add(s);
        button.setAttribute('aria-pressed', String(!this.hidden.has(s)));
      });
      this.legend.append(button);
      return value;
    });
  }

  private buildTooltip(): void {
    this.tooltip.replaceChildren();
    this.tooltipTime = document.createElement('div');
    this.tooltipTime.className = 'tooltip-time';
    this.tooltip.append(this.tooltipTime);
    this.tooltipRows = this.series.map((spec) => {
      const row = document.createElement('div');
      row.className = 'tooltip-row';
      const key = document.createElement('span');
      key.className = 'line-key';
      key.style.background = spec.color;
      const value = document.createElement('strong');
      const label = document.createElement('span');
      label.className = 'tooltip-label';
      label.textContent = spec.label;
      row.append(key, value, label);
      this.tooltip.append(row);
      return { row, value };
    });
    this.tooltip.hidden = true;
  }
}
