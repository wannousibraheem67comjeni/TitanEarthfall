/**
 * Slow-varying national fields, rasterised once at startup onto the DEM's lon/lat
 * lattice (≈1.1 km): land/lake/Egypt coverage, distance to water and to rivers, and
 * the water level of the nearest river. They answer "far-field" questions in O(1)
 * (is this valley floor irrigated? how humid is the air here?) and gate the exact —
 * but costlier — vector queries in WaterModel to the few vertices that need them.
 */
import type { FlatRing, GisData } from '../data/schema';
import type { DemGrid } from './dem';

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQ = 111_320;
/** Distance fields are stored in 10 m units in Uint16 (max ≈ 655 km). */
const DIST_UNIT = 10;

export interface RasterBuffers {
  width: number;
  height: number;
  west: number;
  north: number;
  stepLon: number;
  stepLat: number;
  /** Sea + lake coverage, 0..255. */
  water: Uint8Array;
  /** Lake index + 1 where a lake covers the cell, else 0. */
  lakeId: Uint8Array;
  /** Egypt coverage, 0..255. */
  egypt: Uint8Array;
  riverDist: Uint16Array;
  /** Water level (dm) of the nearest river. */
  riverSurf: Int16Array;
  waterDist: Uint16Array;
  coastDist: Uint16Array;
}

export class GeoRasters {
  private constructor(readonly b: RasterBuffers) {}

  static fromBuffers(b: RasterBuffers): GeoRasters {
    return new GeoRasters(b);
  }

  static build(gis: GisData, dem: DemGrid): GeoRasters {
    const width = dem.width;
    const height = dem.height;
    const grid = { width, height, west: dem.west, north: dem.north, stepLon: dem.stepLon, stepLat: dem.stepLat };
    const n = width * height;

    const land = rasterize(gis.land, grid);
    const egypt = rasterize(gis.egypt, grid);
    const lakeId = new Uint8Array(n);
    const lakeCov = new Uint8Array(n);
    const patch = rasterize(gis.landPatches ?? [], grid);
    gis.lakes.forEach((lake, i) => {
      const cov = rasterize(lake.rings, grid);
      for (let k = 0; k < n; k++) {
        cov[k] = Math.round((cov[k] * (255 - patch[k])) / 255);
        if (cov[k] > lakeCov[k]) lakeCov[k] = cov[k];
        if (cov[k] >= 128) lakeId[k] = i + 1;
      }
    });
    const water = new Uint8Array(n);
    for (let k = 0; k < n; k++) water[k] = Math.max(255 - land[k], lakeCov[k]);

    // River seeds: walk every segment at sub-cell steps, keep the closest walked point per cell.
    const riverD = new Float32Array(n).fill(Infinity);
    const riverS = new Float32Array(n);
    for (const river of gis.rivers) {
      const p = river.points;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        const steps = Math.max(1, Math.ceil(len / (grid.stepLon / 3)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const lon = p[i] + (p[i + 2] - p[i]) * t;
          const lat = p[i + 1] + (p[i + 3] - p[i + 1]) * t;
          const cf = (lon - grid.west) / grid.stepLon;
          const rf = (grid.north - lat) / grid.stepLat;
          const c = Math.round(cf);
          const r = Math.round(rf);
          if (c < 0 || r < 0 || c >= width || r >= height) continue;
          const k = r * width + c;
          const kx = (cf - c) * grid.stepLon * M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180);
          const ky = (rf - r) * grid.stepLat * M_PER_DEG_LAT;
          const d = Math.hypot(kx, ky);
          if (d < riverD[k]) {
            riverD[k] = d;
            riverS[k] = river.surface[i / 2] + (river.surface[i / 2 + 1] - river.surface[i / 2]) * t;
          }
        }
      }
    }
    const riverSeedD = riverD.slice();
    chamfer(riverD, riverS, grid);

    // Distance to any water (sea, lakes, rivers) and to the sea alone.
    const waterD = new Float32Array(n);
    const coastD = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      waterD[k] = water[k] >= 128 ? 0 : riverSeedD[k];
      coastD[k] = land[k] < 128 ? 0 : Infinity;
    }
    chamfer(waterD, null, grid);
    chamfer(coastD, null, grid);

    const toU16 = (src: Float32Array) => {
      const out = new Uint16Array(n);
      for (let k = 0; k < n; k++) out[k] = Math.min(65535, Math.round(src[k] / DIST_UNIT));
      return out;
    };
    const riverSurf = new Int16Array(n);
    for (let k = 0; k < n; k++) riverSurf[k] = Math.round(riverS[k] * 10);

    return new GeoRasters({
      ...grid,
      water,
      lakeId,
      egypt,
      riverDist: toU16(riverD),
      riverSurf,
      waterDist: toU16(waterD),
      coastDist: toU16(coastD),
    });
  }

  /** Copies of all buffers, safe to transfer to a worker. */
  cloneBuffers(): RasterBuffers {
    const b = this.b;
    return {
      ...b,
      water: b.water.slice(),
      lakeId: b.lakeId.slice(),
      egypt: b.egypt.slice(),
      riverDist: b.riverDist.slice(),
      riverSurf: b.riverSurf.slice(),
      waterDist: b.waterDist.slice(),
      coastDist: b.coastDist.slice(),
    };
  }

  get width(): number {
    return this.b.width;
  }

  get height(): number {
    return this.b.height;
  }

  /** Bilinear sample of a raster at lon/lat. */
  private bilerp(arr: ArrayLike<number>, lon: number, lat: number): number {
    const b = this.b;
    let fx = (lon - b.west) / b.stepLon;
    let fy = (b.north - lat) / b.stepLat;
    fx = fx < 0 ? 0 : fx > b.width - 1.001 ? b.width - 1.001 : fx;
    fy = fy < 0 ? 0 : fy > b.height - 1.001 ? b.height - 1.001 : fy;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const o = iy * b.width + ix;
    const top = arr[o] + (arr[o + 1] - arr[o]) * tx;
    const bot = arr[o + b.width] + (arr[o + b.width + 1] - arr[o + b.width]) * tx;
    return top + (bot - top) * ty;
  }

  private nearestIndex(lon: number, lat: number): number {
    const b = this.b;
    const c = Math.min(b.width - 1, Math.max(0, Math.round((lon - b.west) / b.stepLon)));
    const r = Math.min(b.height - 1, Math.max(0, Math.round((b.north - lat) / b.stepLat)));
    return r * b.width + c;
  }

  /** 0..1 coverage of sea or lake. */
  water(lon: number, lat: number): number {
    return this.bilerp(this.b.water, lon, lat) / 255;
  }

  egypt(lon: number, lat: number): number {
    return this.bilerp(this.b.egypt, lon, lat) / 255;
  }

  /** Index into GisData.lakes, or −1. */
  lake(lon: number, lat: number): number {
    return this.b.lakeId[this.nearestIndex(lon, lat)] - 1;
  }

  riverDistance(lon: number, lat: number): number {
    return this.bilerp(this.b.riverDist, lon, lat) * DIST_UNIT;
  }

  riverSurface(lon: number, lat: number): number {
    return this.b.riverSurf[this.nearestIndex(lon, lat)] / 10;
  }

  waterDistance(lon: number, lat: number): number {
    return this.bilerp(this.b.waterDist, lon, lat) * DIST_UNIT;
  }

  coastDistance(lon: number, lat: number): number {
    return this.bilerp(this.b.coastDist, lon, lat) * DIST_UNIT;
  }

  /** Raw grid accessors for whole-raster passes (macro texture, minimap). */
  cell(c: number, r: number): { lon: number; lat: number } {
    return { lon: this.b.west + c * this.b.stepLon, lat: this.b.north - r * this.b.stepLat };
  }
}

interface Lattice {
  width: number;
  height: number;
  west: number;
  north: number;
  stepLon: number;
  stepLat: number;
}

/**
 * Even-odd scanline fill of flat lon/lat rings with 2×2 supersampling per lattice
 * point (pixel-is-point: each point owns the cell ±½ step around it). Returns 0..255.
 */
export function rasterize(rings: FlatRing[], g: Lattice): Uint8Array {
  const out = new Uint8Array(g.width * g.height);
  const counts = new Uint8Array(g.width);
  const edges: number[] = [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1] === r[j + 1]) continue;
      edges.push(r[j], r[j + 1], r[i], r[i + 1]);
      minLat = Math.min(minLat, r[i + 1]);
      maxLat = Math.max(maxLat, r[i + 1]);
    }
  }
  const xs: number[] = [];
  const subCols = g.width * 2;
  for (let row = 0; row < g.height; row++) {
    counts.fill(0);
    for (let sr = 0; sr < 2; sr++) {
      const lat = g.north - (row + (sr === 0 ? -0.25 : 0.25)) * g.stepLat;
      if (lat < minLat || lat > maxLat) continue;
      xs.length = 0;
      for (let e = 0; e < edges.length; e += 4) {
        const ya = edges[e + 1];
        const yb = edges[e + 3];
        if (ya > lat !== yb > lat) xs.push(edges[e] + ((lat - ya) * (edges[e + 2] - edges[e])) / (yb - ya));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        // Sub-column k sits at lon = west + (k/2 − ¼)·step.
        const k0 = Math.max(0, Math.ceil(2 * ((xs[i] - g.west) / g.stepLon + 0.25)));
        const k1 = Math.min(subCols - 1, Math.ceil(2 * ((xs[i + 1] - g.west) / g.stepLon + 0.25)) - 1);
        for (let k = k0; k <= k1; k++) counts[k >> 1]++;
      }
    }
    const o = row * g.width;
    for (let c = 0; c < g.width; c++) out[o + c] = Math.round((counts[c] * 255) / 4);
  }
  return out;
}

/**
 * Two-pass 8-neighbour chamfer distance transform with latitude-dependent metric
 * weights. Optionally propagates a payload (the nearest seed's value) alongside.
 */
function chamfer(dist: Float32Array, payload: Float32Array | null, g: Lattice): void {
  const { width: w, height: h } = g;
  const wy = g.stepLat * M_PER_DEG_LAT;
  const relax = (k: number, nk: number, step: number) => {
    const d = dist[nk] + step;
    if (d < dist[k]) {
      dist[k] = d;
      if (payload) payload[k] = payload[nk];
    }
  };
  for (let r = 0; r < h; r++) {
    const wx = g.stepLon * M_PER_DEG_LON_EQ * Math.cos(((g.north - r * g.stepLat) * Math.PI) / 180);
    const wd = Math.hypot(wx, wy);
    for (let c = 0; c < w; c++) {
      const k = r * w + c;
      if (c > 0) relax(k, k - 1, wx);
      if (r > 0) {
        relax(k, k - w, wy);
        if (c > 0) relax(k, k - w - 1, wd);
        if (c < w - 1) relax(k, k - w + 1, wd);
      }
    }
  }
  for (let r = h - 1; r >= 0; r--) {
    const wx = g.stepLon * M_PER_DEG_LON_EQ * Math.cos(((g.north - r * g.stepLat) * Math.PI) / 180);
    const wd = Math.hypot(wx, wy);
    for (let c = w - 1; c >= 0; c--) {
      const k = r * w + c;
      if (c < w - 1) relax(k, k + 1, wx);
      if (r < h - 1) {
        relax(k, k + w, wy);
        if (c < w - 1) relax(k, k + w + 1, wd);
        if (c > 0) relax(k, k + w - 1, wd);
      }
    }
  }
}
