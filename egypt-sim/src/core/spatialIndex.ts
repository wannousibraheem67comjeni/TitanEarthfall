/**
 * Uniform-grid acceleration structures over world-space line work. They make exact
 * vector queries (distance to the Nile, inside the Mediterranean?) cheap enough to
 * run per terrain vertex: O(segments in one cell) instead of O(all segments).
 */
import { distToSegment } from './geometry2d';

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NearestHit {
  dist: number;
  /** Index of the segment as passed to `add`. */
  segment: number;
  /** Parameter along that segment, 0..1. */
  t: number;
}

/** Nearest-segment queries, exact within `maxRadius` and "nothing" beyond it. */
export class SegmentGrid {
  private segs: number[] = [];
  private cellStart = new Int32Array(0);
  private cellItems = new Int32Array(0);
  private readonly nx: number;
  private readonly ny: number;
  private readonly tmp = new Float64Array(1);

  constructor(
    private readonly bounds: Bounds2,
    private readonly cellSize: number,
    readonly maxRadius: number,
  ) {
    this.nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
    this.ny = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellSize));
  }

  get size(): number {
    return this.segs.length / 4;
  }

  add(ax: number, ay: number, bx: number, by: number): number {
    this.segs.push(ax, ay, bx, by);
    return this.segs.length / 4 - 1;
  }

  build(): this {
    const counts = new Int32Array(this.nx * this.ny + 1);
    const visit = (fn: (cell: number, seg: number) => void) => {
      for (let s = 0; s < this.size; s++) {
        const [c0, r0, c1, r1] = this.cellRange(s);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.nx + c, s);
      }
    };
    visit((cell) => counts[cell + 1]++);
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    const fill = counts.slice();
    const items = new Int32Array(counts[counts.length - 1]);
    visit((cell, seg) => (items[fill[cell]++] = seg));
    this.cellStart = counts;
    this.cellItems = items;
    return this;
  }

  private cellRange(s: number): [number, number, number, number] {
    const g = this.segs;
    const r = this.maxRadius;
    const b = this.bounds;
    const cs = this.cellSize;
    const x0 = Math.min(g[s * 4], g[s * 4 + 2]) - r;
    const x1 = Math.max(g[s * 4], g[s * 4 + 2]) + r;
    const y0 = Math.min(g[s * 4 + 1], g[s * 4 + 3]) - r;
    const y1 = Math.max(g[s * 4 + 1], g[s * 4 + 3]) + r;
    return [
      Math.max(0, Math.floor((x0 - b.minX) / cs)),
      Math.max(0, Math.floor((y0 - b.minY) / cs)),
      Math.min(this.nx - 1, Math.floor((x1 - b.minX) / cs)),
      Math.min(this.ny - 1, Math.floor((y1 - b.minY) / cs)),
    ];
  }

  /** Nearest segment within maxRadius, or null. */
  nearest(x: number, y: number, out: NearestHit): NearestHit | null {
    const c = Math.floor((x - this.bounds.minX) / this.cellSize);
    const r = Math.floor((y - this.bounds.minY) / this.cellSize);
    if (c < 0 || r < 0 || c >= this.nx || r >= this.ny) return null;
    const cell = r * this.nx + c;
    let best = this.maxRadius;
    let found = -1;
    let bestT = 0;
    const g = this.segs;
    for (let i = this.cellStart[cell], e = this.cellStart[cell + 1]; i < e; i++) {
      const s = this.cellItems[i];
      const d = distToSegment(x, y, g[s * 4], g[s * 4 + 1], g[s * 4 + 2], g[s * 4 + 3], this.tmp);
      if (d < best) {
        best = d;
        found = s;
        bestT = this.tmp[0];
      }
    }
    if (found < 0) return null;
    out.dist = best;
    out.segment = found;
    out.t = bestT;
    return out;
  }
}

/** Even-odd point-in-polygon over many rings, bucketed into horizontal bands. */
export class RingIndex {
  private edges: number[] = [];
  private bandStart = new Int32Array(0);
  private bandItems = new Int32Array(0);
  private minY = Infinity;
  private maxY = -Infinity;
  private minX = Infinity;
  private maxX = -Infinity;
  private bands = 1;

  constructor(rings: ArrayLike<number>[], private readonly bandHeight: number) {
    for (const r of rings) {
      const n = r.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        if (r[i + 1] === r[j + 1]) continue; // horizontal edges never cross a scanline
        this.edges.push(r[j], r[j + 1], r[i], r[i + 1]);
        this.minY = Math.min(this.minY, r[i + 1]);
        this.maxY = Math.max(this.maxY, r[i + 1]);
        this.minX = Math.min(this.minX, r[i]);
        this.maxX = Math.max(this.maxX, r[i]);
      }
    }
    if (!this.edges.length) return;
    this.bands = Math.max(1, Math.ceil((this.maxY - this.minY) / bandHeight) + 1);
    const counts = new Int32Array(this.bands + 1);
    const each = (fn: (band: number, edge: number) => void) => {
      for (let e = 0; e < this.edges.length / 4; e++) {
        const y0 = Math.min(this.edges[e * 4 + 1], this.edges[e * 4 + 3]);
        const y1 = Math.max(this.edges[e * 4 + 1], this.edges[e * 4 + 3]);
        const b0 = Math.floor((y0 - this.minY) / bandHeight);
        const b1 = Math.min(this.bands - 1, Math.floor((y1 - this.minY) / bandHeight));
        for (let b = b0; b <= b1; b++) fn(b, e);
      }
    };
    each((b) => counts[b + 1]++);
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    const fill = counts.slice();
    this.bandItems = new Int32Array(counts[this.bands]);
    each((b, e) => (this.bandItems[fill[b]++] = e));
    this.bandStart = counts;
  }

  /** Rough bounds of all ring vertices (useful for quick rejection). */
  get bounds(): Bounds2 {
    return { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY };
  }

  contains(x: number, y: number): boolean {
    if (y < this.minY || y > this.maxY || x < this.minX || x > this.maxX) return false;
    const b = Math.floor((y - this.minY) / this.bandHeight);
    const e = this.edges;
    let inside = false;
    for (let i = this.bandStart[b], end = this.bandStart[b + 1]; i < end; i++) {
      const k = this.bandItems[i] * 4;
      const ya = e[k + 1];
      const yb = e[k + 3];
      if (ya > y !== yb > y && x < ((e[k + 2] - e[k]) * (y - ya)) / (yb - ya) + e[k]) inside = !inside;
    }
    return inside;
  }
}
