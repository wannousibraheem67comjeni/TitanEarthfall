/**
 * Growable typed-array mesh builder used by the city generator (in workers) and
 * landmark models. Vertex layout:
 *   position  f32×3
 *   normal    i8×3 (normalised)
 *   color     u8×4 (rgb + style id in alpha)
 *   facade    f32×3 (u along wall in metres, v height above base in metres or −1 on
 *             roofs, per-building seed 0..1) — drives the procedural window shader
 */
import earcut from 'earcut';
import type { Poly } from '../core/geometry2d';
import type { Rgb } from './profiles';

export interface MeshArrays {
  positions: Float32Array;
  normals: Int8Array;
  colors: Uint8Array;
  facade: Float32Array;
  indices: Uint32Array;
}

export class MeshBuilder {
  private pos = new Float32Array(4096 * 3);
  private nrm = new Int8Array(4096 * 3);
  private col = new Uint8Array(4096 * 4);
  private fac = new Float32Array(4096 * 3);
  private idx = new Uint32Array(8192);
  vCount = 0;
  iCount = 0;

  private ensure(v: number, i: number): void {
    if (this.vCount + v > this.pos.length / 3) {
      const cap = Math.max(this.pos.length / 3 * 2, this.vCount + v);
      this.pos = grow(this.pos, cap * 3);
      this.nrm = grow(this.nrm, cap * 3);
      this.col = grow(this.col, cap * 4);
      this.fac = grow(this.fac, cap * 3);
    }
    if (this.iCount + i > this.idx.length) this.idx = grow(this.idx, Math.max(this.idx.length * 2, this.iCount + i));
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: Rgb, style: number, u: number, v: number, seed: number): number {
    this.ensure(1, 0);
    const k = this.vCount++;
    this.pos[k * 3] = x;
    this.pos[k * 3 + 1] = y;
    this.pos[k * 3 + 2] = z;
    this.nrm[k * 3] = Math.round(nx * 127);
    this.nrm[k * 3 + 1] = Math.round(ny * 127);
    this.nrm[k * 3 + 2] = Math.round(nz * 127);
    this.col[k * 4] = c[0] * 255;
    this.col[k * 4 + 1] = c[1] * 255;
    this.col[k * 4 + 2] = c[2] * 255;
    this.col[k * 4 + 3] = style;
    this.fac[k * 3] = u;
    this.fac[k * 3 + 1] = v;
    this.fac[k * 3 + 2] = seed;
    return k;
  }

  tri(a: number, b: number, c: number): void {
    this.ensure(0, 3);
    this.idx[this.iCount++] = a;
    this.idx[this.iCount++] = b;
    this.idx[this.iCount++] = c;
  }

  /**
   * Prism over a CCW polygon (math sense in the x/z plane): outward-facing walls with
   * facade coordinates, plus a flat roof. Walls start at `base` (sunk below grade).
   */
  extrude(poly: Poly, base: number, top: number, c: Rgb, style: number, seed: number, roof: Rgb, grade = base): void {
    const m = poly.length / 2;
    let u = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ax = poly[i * 2];
      const az = poly[i * 2 + 1];
      const bx = poly[j * 2];
      const bz = poly[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const v0 = base - grade;
      const v1 = top - grade;
      const a0 = this.vertex(ax, base, az, nx, 0, nz, c, style, u, v0, seed);
      const b0 = this.vertex(bx, base, bz, nx, 0, nz, c, style, u + len, v0, seed);
      const b1 = this.vertex(bx, top, bz, nx, 0, nz, c, style, u + len, v1, seed);
      const a1 = this.vertex(ax, top, az, nx, 0, nz, c, style, u, v1, seed);
      this.tri(a0, a1, b1);
      this.tri(a0, b1, b0);
      u += len;
    }
    this.cap(poly, top, roof, style, seed);
  }

  /** Upward-facing flat polygon (roof, plaza, pool surface). */
  cap(poly: Poly, y: number, c: Rgb, style: number, seed: number): void {
    const m = poly.length / 2;
    const first = this.vCount;
    for (let i = 0; i < m; i++) this.vertex(poly[i * 2], y, poly[i * 2 + 1], 0, 1, 0, c, style, poly[i * 2], -1, seed);
    if (m === 3 || m === 4) {
      // Convex fast path; reversed fan because CCW (math) reads clockwise from above.
      for (let i = 1; i < m - 1; i++) this.tri(first, first + i + 1, first + i);
      return;
    }
    const tris = earcut(poly);
    for (let i = 0; i < tris.length; i += 3) this.tri(first + tris[i], first + tris[i + 2], first + tris[i + 1]);
  }

  box(cx: number, cz: number, ux: number, uz: number, halfU: number, halfV: number, base: number, top: number, c: Rgb, style: number, seed: number, roof: Rgb = c): void {
    const vx = -uz;
    const vz = ux;
    this.extrude([
      cx - ux * halfU - vx * halfV, cz - uz * halfU - vz * halfV,
      cx + ux * halfU - vx * halfV, cz + uz * halfU - vz * halfV,
      cx + ux * halfU + vx * halfV, cz + uz * halfU + vz * halfV,
      cx - ux * halfU + vx * halfV, cz - uz * halfU + vz * halfV,
    ], base, top, c, style, seed, roof);
  }

  /** Vertical cylinder / frustum (r1 = top radius) with optional cap. */
  cylinder(cx: number, cz: number, base: number, top: number, r0: number, r1: number, seg: number, c: Rgb, style: number, seed: number, capTop = true): void {
    const first = this.vCount;
    const slope = (r0 - r1) / Math.max(0.01, top - base);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ln = Math.hypot(1, slope);
      this.vertex(cx + ca * r0, base, cz + sa * r0, ca / ln, slope / ln, sa / ln, c, style, (i / seg) * Math.PI * 2 * r0, 0, seed);
      this.vertex(cx + ca * r1, top, cz + sa * r1, ca / ln, slope / ln, sa / ln, c, style, (i / seg) * Math.PI * 2 * r1, top - base, seed);
    }
    for (let i = 0; i < seg; i++) {
      const a0 = first + i * 2;
      const a1 = a0 + 1;
      const b0 = a0 + 2;
      const b1 = a0 + 3;
      // Angle grows from +x toward +z: CCW in the x/z plane, so same winding as extrude().
      this.tri(a0, a1, b1);
      this.tri(a0, b1, b0);
    }
    if (capTop && r1 > 0.01) {
      const ring: number[] = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(cx + Math.cos(a) * r1, cz + Math.sin(a) * r1);
      }
      this.cap(ring, top, c, style, seed);
    }
  }

  /** Hemispherical (or onion-ish when `stretch` > 1) dome. */
  dome(cx: number, cz: number, base: number, radius: number, stretch: number, seg: number, c: Rgb, style: number, seed: number): void {
    const rings = Math.max(3, Math.floor(seg / 2));
    const first = this.vCount;
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * (Math.PI / 2);
      const y = Math.sin(phi) * radius * stretch;
      const rr = Math.cos(phi) * radius;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const nx = Math.cos(a) * Math.cos(phi);
        const ny = Math.sin(phi);
        const nz = Math.sin(a) * Math.cos(phi);
        this.vertex(cx + Math.cos(a) * rr, base + y, cz + Math.sin(a) * rr, nx, ny, nz, c, style, i, -1, seed);
      }
    }
    const row = seg + 1;
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < seg; i++) {
        const a = first + r * row + i;
        const b = a + row;
        this.tri(a, b, b + 1);
        this.tri(a, b + 1, a + 1);
      }
    }
  }

  /**
   * Planar convex face from [x, y, z, …] listed counter-clockwise as seen from outside.
   * Facade u runs along the first edge, v is height above the lowest vertex.
   */
  face(pts: number[], c: Rgb, style: number, seed: number): void {
    const n = pts.length / 3;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      nx += (pts[i * 3 + 1] - pts[j * 3 + 1]) * (pts[i * 3 + 2] + pts[j * 3 + 2]);
      ny += (pts[i * 3 + 2] - pts[j * 3 + 2]) * (pts[i * 3] + pts[j * 3]);
      nz += (pts[i * 3] - pts[j * 3]) * (pts[i * 3 + 1] + pts[j * 3 + 1]);
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let tx = pts[3] - pts[0], tz = pts[5] - pts[2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    let minY = Infinity;
    for (let i = 0; i < n; i++) minY = Math.min(minY, pts[i * 3 + 1]);
    const first = this.vCount;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      this.vertex(x, y, z, nx, ny, nz, c, style, (x - pts[0]) * tx + (z - pts[2]) * tz, y - minY, seed);
    }
    for (let i = 1; i < n - 1; i++) this.tri(first, first + i, first + i + 1);
  }

  /**
   * Axis-aligned frustum: rectangle w0×d0 at y0 tapering to w1×d1 at y1, centred on
   * (cx, cz) — pyramids (w1 = 0), stepped tiers, pylons with battered walls, plinths.
   */
  frustum(cx: number, cz: number, w0: number, d0: number, w1: number, d1: number, y0: number, y1: number, c: Rgb, style: number, seed: number, top = true): void {
    const a = w0 / 2, b = d0 / 2, e = w1 / 2, f = d1 / 2;
    const P = (x: number, y: number, z: number) => [cx + x, y, cz + z];
    this.face([...P(-a, y0, b), ...P(a, y0, b), ...P(e, y1, f), ...P(-e, y1, f)], c, style, seed); // south (+z)
    this.face([...P(a, y0, -b), ...P(-a, y0, -b), ...P(-e, y1, -f), ...P(e, y1, -f)], c, style, seed); // north
    this.face([...P(a, y0, b), ...P(a, y0, -b), ...P(e, y1, -f), ...P(e, y1, f)], c, style, seed); // east
    this.face([...P(-a, y0, -b), ...P(-a, y0, b), ...P(-e, y1, f), ...P(-e, y1, -f)], c, style, seed); // west
    if (top && e > 0.01 && f > 0.01) this.face([...P(-e, y1, f), ...P(e, y1, f), ...P(e, y1, -f), ...P(-e, y1, -f)], c, style, seed);
  }

  finish(): MeshArrays {
    return {
      positions: this.pos.slice(0, this.vCount * 3),
      normals: this.nrm.slice(0, this.vCount * 3),
      colors: this.col.slice(0, this.vCount * 4),
      facade: this.fac.slice(0, this.vCount * 3),
      indices: this.idx.slice(0, this.iCount),
    };
  }
}

function grow<T extends Float32Array | Int8Array | Uint8Array | Uint32Array>(a: T, size: number): T {
  const out = new (a.constructor as new (n: number) => T)(size);
  out.set(a);
  return out;
}
