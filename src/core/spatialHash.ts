/**
 * Uniform-grid broad phase with a dense hash table (no per-frame allocation
 * once sized). Cells are `spacing` wide, so with spacing ≥ the largest
 * contact distance every touching pair shares a cell or a neighbouring one.
 */
export class SpatialHash {
  private tableSize = 0;
  private cellStart = new Int32Array(1);
  private entries = new Int32Array(0);
  private cellX = new Int32Array(0);
  private cellY = new Int32Array(0);
  private readonly buckets = new Int32Array(9);

  build(pos: Float64Array, count: number, spacing: number): void {
    if (this.entries.length < count) {
      this.entries = new Int32Array(count);
      this.cellX = new Int32Array(count);
      this.cellY = new Int32Array(count);
    }
    this.tableSize = Math.max(2 * count, 1);
    if (this.cellStart.length < this.tableSize + 1) this.cellStart = new Int32Array(this.tableSize + 1);
    const start = this.cellStart;
    start.fill(0, 0, this.tableSize + 1);

    // Counting sort of particles by bucket.
    for (let i = 0; i < count; i++) {
      this.cellX[i] = Math.floor(pos[2 * i] / spacing);
      this.cellY[i] = Math.floor(pos[2 * i + 1] / spacing);
      start[this.bucket(this.cellX[i], this.cellY[i])]++;
    }
    for (let b = 1; b <= this.tableSize; b++) start[b] += start[b - 1];
    for (let i = 0; i < count; i++) {
      this.entries[--start[this.bucket(this.cellX[i], this.cellY[i])]] = i;
    }
  }

  /** Calls `visit(i, j)` once for every candidate pair i < j in neighbouring cells. */
  forEachPair(count: number, visit: (i: number, j: number) => void): void {
    const { buckets, cellStart, entries } = this;
    for (let i = 0; i < count; i++) {
      // Distinct buckets of the 3×3 neighbourhood (hash collisions can repeat one).
      let nb = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const b = this.bucket(this.cellX[i] + dx, this.cellY[i] + dy);
          let seen = false;
          for (let k = 0; k < nb; k++) if (buckets[k] === b) seen = true;
          if (!seen) buckets[nb++] = b;
        }
      }
      for (let k = 0; k < nb; k++) {
        const b = buckets[k];
        for (let e = cellStart[b]; e < cellStart[b + 1]; e++) {
          const j = entries[e];
          if (j > i) visit(i, j);
        }
      }
    }
  }

  private bucket(cx: number, cy: number): number {
    return Math.abs(Math.imul(cx, 92837111) ^ Math.imul(cy, 689287499)) % this.tableSize;
  }
}
