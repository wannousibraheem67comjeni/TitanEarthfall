/**
 * World frame: spherical Transverse Mercator centred on Egypt (conformal, so street
 * grids and landmark footprints keep their true shape; scale error < 0.5 % at the
 * borders). Three.js axes: +X east, +Y up, +Z south (north is −Z), metres.
 *
 * Precision note: world coordinates reach ±800 km. Every mesh is positioned at its
 * own local origin (node/tile centre), and Three.js composes modelView matrices in
 * float64 on the CPU, so vertex data stays well inside float32 precision.
 */
import { DEG } from '../core/math';

export interface LonLat {
  lon: number;
  lat: number;
}

export class GeoProjection {
  private readonly lon0: number;
  private readonly lat0: number;

  constructor(origin: LonLat, readonly radius: number) {
    this.lon0 = origin.lon * DEG;
    this.lat0 = origin.lat * DEG;
  }

  /** (lon, lat) in degrees → world [x, z] in metres. */
  forward(lon: number, lat: number): [number, number] {
    const lam = lon * DEG - this.lon0;
    const phi = lat * DEG;
    const b = Math.cos(phi) * Math.sin(lam);
    const x = this.radius * Math.atanh(b);
    const y = this.radius * (Math.atan2(Math.tan(phi), Math.cos(lam)) - this.lat0);
    return [x, -y];
  }

  /** World [x, z] → [lon, lat] in degrees. */
  inverse(x: number, z: number): [number, number] {
    const d = -z / this.radius + this.lat0;
    const xr = x / this.radius;
    const phi = Math.asin(Math.sin(d) / Math.cosh(xr));
    const lam = Math.atan2(Math.sinh(xr), Math.cos(d));
    return [(lam + this.lon0) / DEG, phi / DEG];
  }

  /** Point scale factor k at a world position (1 on the central meridian). */
  scaleFactor(x: number): number {
    return Math.cosh(x / this.radius);
  }
}

// ── Web Mercator (XYZ tile) helpers for imagery / DEM tile services ──

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const r = lat * DEG;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return Math.atan(Math.sinh(n)) / DEG;
}

/** Ground metres per pixel of a 256 px XYZ tile at latitude `lat`. */
export function tileGroundResolution(lat: number, z: number): number {
  return (Math.cos(lat * DEG) * 2 * Math.PI * 6378137) / (256 * 2 ** z);
}
