/** Fixed-capacity ring buffer of recent positions, oldest first. */
export class Trail {
  readonly capacity: number;
  length = 0;

  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private start = 0;

  constructor(capacity = 1500) {
    this.capacity = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
  }

  push(x: number, y: number): void {
    let idx: number;
    if (this.length < this.capacity) {
      idx = (this.start + this.length) % this.capacity;
      this.length++;
    } else {
      idx = this.start;
      this.start = (this.start + 1) % this.capacity;
    }
    this.xs[idx] = x;
    this.ys[idx] = y;
  }

  x(i: number): number {
    return this.xs[(this.start + i) % this.capacity];
  }

  y(i: number): number {
    return this.ys[(this.start + i) % this.capacity];
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
  }
}
