/**
 * Flat-array 2D polygon utilities: a polygon is [x0, y0, x1, y1, …], implicitly
 * closed. Flat arrays keep the city generator allocation-light and make results
 * trivially transferable from workers.
 */
export type Poly = number[];

export function polyArea(p: Poly): number {
  let s = 0;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) s += p[j] * p[i + 1] - p[i] * p[j + 1];
  return s / 2;
}

export function polyCentroid(p: Poly): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const f = p[j] * p[i + 1] - p[i] * p[j + 1];
    a += f;
    cx += (p[j] + p[i]) * f;
    cy += (p[j + 1] + p[i + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate: fall back to the vertex average.
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i += 2) {
      sx += p[i];
      sy += p[i + 1];
    }
    return [sx / (n / 2), sy / (n / 2)];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Returns the polygon with counter-clockwise (positive-area) winding. */
export function ensureCCW(p: Poly): Poly {
  if (polyArea(p) >= 0) return p;
  const out: Poly = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

/** Even-odd point-in-polygon. */
export function pointInPoly(p: Poly, x: number, y: number): boolean {
  let inside = false;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const yi = p[i + 1];
    const yj = p[j + 1];
    if (yi > y !== yj > y && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) inside = !inside;
  }
  return inside;
}

/** Distance from (px, py) to segment a→b; `out[0]` receives the segment parameter t ∈ [0, 1]. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, out?: Float64Array | number[]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (out) out[0] = t;
  const ex = px - ax - t * dx;
  const ey = py - ay - t * dy;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Index (vertex i → i+1) of the longest edge. */
export function longestEdge(p: Poly): number {
  let best = 0;
  let bestLen = -1;
  const m = p.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const len = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return best;
}

/**
 * Offsets every edge of a CCW polygon inward by `d` (scalar or per-edge) and
 * re-intersects neighbouring edges. Returns null if the result collapses or flips.
 */
export function insetPolygon(p: Poly, d: number | number[]): Poly | null {
  const m = p.length / 2;
  if (m < 3) return null;
  const lines: number[] = []; // per edge: point (x, y) + direction (dx, dy)
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ax = p[i * 2];
    const ay = p[i * 2 + 1];
    let dx = p[j * 2] - ax;
    let dy = p[j * 2 + 1] - ay;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const off = typeof d === 'number' ? d : d[i];
    // Inward normal of a CCW polygon is the left normal (−dy, dx).
    lines.push(ax - dy * off, ay + dx * off, dx, dy);
  }
  const out: Poly = [];
  for (let i = 0; i < m; i++) {
    const a = ((i + m - 1) % m) * 4;
    const b = i * 4;
    const den = lines[a + 2] * lines[b + 3] - lines[a + 3] * lines[b + 2];
    if (Math.abs(den) < 1e-9) {
      // Collinear neighbours: the offset start point of edge i is the vertex.
      out.push(lines[b], lines[b + 1]);
      continue;
    }
    const t = ((lines[b] - lines[a]) * lines[b + 3] - (lines[b + 1] - lines[a + 1]) * lines[b + 2]) / den;
    out.push(lines[a] + lines[a + 2] * t, lines[a + 1] + lines[a + 3] * t);
  }
  const area = polyArea(out);
  if (!(area > 0) || area > polyArea(p)) return null;
  // Reject self-overlapping results (inset larger than the polygon is thick).
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ex = p[j * 2] - p[i * 2];
    const ey = p[j * 2 + 1] - p[i * 2 + 1];
    const ox = out[j * 2] - out[i * 2];
    const oy = out[j * 2 + 1] - out[i * 2 + 1];
    if (ex * ox + ey * oy <= 0) return null;
  }
  return out;
}

/**
 * Splits a polygon by the line through (px, py) with normal (nx, ny) into the
 * positive and negative half-plane parts (Sutherland–Hodgman against each side).
 */
export function splitPolygon(p: Poly, px: number, py: number, nx: number, ny: number): [Poly, Poly] {
  const pos: Poly = [];
  const neg: Poly = [];
  const n = p.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = p[i];
    const ay = p[i + 1];
    const bx = p[j];
    const by = p[j + 1];
    const da = (ax - px) * nx + (ay - py) * ny;
    const db = (bx - px) * nx + (by - py) * ny;
    if (da >= 0) pos.push(ax, ay);
    if (da <= 0) neg.push(ax, ay);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      const ix = ax + (bx - ax) * t;
      const iy = ay + (by - ay) * t;
      pos.push(ix, iy);
      neg.push(ix, iy);
    }
  }
  return [pos, neg];
}
