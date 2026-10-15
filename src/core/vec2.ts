/**
 * Immutable 2D vector for setup code, camera math and rendering.
 * Hot simulation loops work directly on Float64Array buffers instead.
 */
export class Vec2 {
  static readonly ZERO = new Vec2(0, 0);

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  static fromAngle(radians: number, length = 1): Vec2 {
    return new Vec2(Math.cos(radians) * length, Math.sin(radians) * length);
  }

  add(v: Vec2): Vec2 {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v: Vec2): Vec2 {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  scale(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  /** z-component of the 3D cross product. */
  cross(v: Vec2): number {
    return this.x * v.y - this.y * v.x;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  normalize(): Vec2 {
    const len = this.length();
    return len === 0 ? Vec2.ZERO : this.scale(1 / len);
  }

  distanceTo(v: Vec2): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  /** Rotated 90° counter-clockwise. */
  perp(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  rotate(radians: number): Vec2 {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  lerp(v: Vec2, t: number): Vec2 {
    return new Vec2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
  }

  equals(v: Vec2, eps = 0): boolean {
    return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps;
  }

  toString(): string {
    return `(${this.x}, ${this.y})`;
  }
}
