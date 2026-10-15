import { Vec2 } from '../core/vec2';

export interface Bounds {
  min: Vec2;
  max: Vec2;
}

/** Pixels per metre: from galaxies (~10⁻¹⁹) to atoms (~10¹²) and beyond. */
const MIN_SCALE = 1e-30;
const MAX_SCALE = 1e30;

/** Maps world space (metres, y up) to screen space (CSS pixels, y down). */
export class Camera {
  /** World point at the viewport centre. */
  center = Vec2.ZERO;
  /** Pixels per metre. */
  scale = 50;
  width = 1;
  height = 1;

  setViewport(width: number, height: number): void {
    this.width = Math.max(width, 1);
    this.height = Math.max(height, 1);
  }

  toScreenX(x: number): number {
    return (x - this.center.x) * this.scale + this.width / 2;
  }

  toScreenY(y: number): number {
    return this.height / 2 - (y - this.center.y) * this.scale;
  }

  toScreen(v: Vec2): Vec2 {
    return new Vec2(this.toScreenX(v.x), this.toScreenY(v.y));
  }

  toWorld(sx: number, sy: number): Vec2 {
    return new Vec2(
      (sx - this.width / 2) / this.scale + this.center.x,
      (this.height / 2 - sy) / this.scale + this.center.y,
    );
  }

  /** Moves the view by a screen-space drag of (dx, dy) pixels. */
  panBy(dx: number, dy: number): void {
    this.center = this.center.add(new Vec2(-dx / this.scale, dy / this.scale));
  }

  /** Zooms by `factor` keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    const after = this.toWorld(sx, sy);
    this.center = this.center.add(before.sub(after));
  }

  /** Frames `bounds` inside the viewport with `padding` pixels on each side. */
  fit(bounds: Bounds, padding = 24): void {
    const w = Math.max(bounds.max.x - bounds.min.x, 1e-9);
    const h = Math.max(bounds.max.y - bounds.min.y, 1e-9);
    const availW = Math.max(this.width - 2 * padding, 1);
    const availH = Math.max(this.height - 2 * padding, 1);
    this.scale = clamp(Math.min(availW / w, availH / h), MIN_SCALE, MAX_SCALE);
    this.center = bounds.min.lerp(bounds.max, 0.5);
  }

  visibleBounds(): Bounds {
    return { min: this.toWorld(0, this.height), max: this.toWorld(this.width, 0) };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
