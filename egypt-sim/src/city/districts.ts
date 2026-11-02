/**
 * World-space index of city districts (elliptical footprints with organic edges).
 * Shared by the terrain model (urban tint, night lights) and the city generator
 * (which district owns a block), so both always agree on where a city is.
 */
import type { CityDistrict } from '../data/schema';
import { createNoise2D, fbm } from '../core/noise';
import { DEG, saturate, smoothstep } from '../core/math';
import { hashString } from '../core/rng';
import type { GeoProjection } from '../gis/projection';
import { PROFILES, type CityProfile } from './profiles';

export interface District {
  def: CityDistrict;
  profile: CityProfile;
  x: number;
  z: number;
  /** Major-axis unit vector (world xz). */
  ux: number;
  uz: number;
  /** Semi-axes (m). */
  a: number;
  b: number;
  /** Street-grid primary axis unit vector (world xz). */
  gx: number;
  gz: number;
  seed: number;
  bbox: [number, number, number, number];
}

/** Unit vector in world xz for a compass bearing (north = −z, east = +x). */
export const bearingToVector = (deg: number): [number, number] => [Math.sin(deg * DEG), -Math.cos(deg * DEG)];

const edgeNoise = createNoise2D(7331);

export class DistrictIndex {
  readonly list: District[];

  constructor(defs: CityDistrict[], proj: GeoProjection) {
    this.list = defs.map((def) => {
      const [x, z] = proj.forward(def.lon, def.lat);
      const [ux, uz] = bearingToVector(def.axisDeg);
      const [gx, gz] = bearingToVector(def.gridDeg);
      const a = def.radius;
      const b = def.radius / def.elongation;
      const pad = a * 1.25;
      return {
        def, profile: PROFILES[def.profile], x, z, ux, uz, a, b, gx, gz,
        seed: hashString(def.id),
        bbox: [x - pad, z - pad, x + pad, z + pad] as [number, number, number, number],
      };
    });
  }

  /** Normalised elliptical distance (0 centre, 1 edge), with a noise-perturbed, organic edge. */
  ellipse(d: District, x: number, z: number): number {
    const px = x - d.x;
    const pz = z - d.z;
    const u = (px * d.ux + pz * d.uz) / d.a;
    const v = (-px * d.uz + pz * d.ux) / d.b;
    const e = Math.sqrt(u * u + v * v);
    return e * (1 + 0.16 * fbm(edgeNoise, x / 1800, z / 1800, 2));
  }

  overlapping(x0: number, z0: number, x1: number, z1: number): District[] {
    return this.list.filter((d) => d.bbox[0] <= x1 && d.bbox[2] >= x0 && d.bbox[1] <= z1 && d.bbox[3] >= z0);
  }

  /** The district that owns a point: highest priority among those containing it. */
  owner(x: number, z: number, candidates: District[] = this.list): District | null {
    let best: District | null = null;
    for (const d of candidates) {
      if (x < d.bbox[0] || x > d.bbox[2] || z < d.bbox[1] || z > d.bbox[3]) continue;
      if (this.ellipse(d, x, z) >= 1) continue;
      if (!best || d.def.priority > best.def.priority) best = d;
    }
    return best;
  }

  /** 0 at the edge … 1 at the centre. */
  centrality(d: District, x: number, z: number): number {
    return saturate(1 - this.ellipse(d, x, z));
  }

  /**
   * Urban density for terrain tinting / night lights. `spacing` widens the edge
   * ramp so coarse terrain LODs see a pre-filtered (alias-free) footprint.
   */
  urban(x: number, z: number, spacing: number): number {
    let u = 0;
    for (const d of this.list) {
      if (x < d.bbox[0] || x > d.bbox[2] || z < d.bbox[1] || z > d.bbox[3]) continue;
      const e = this.ellipse(d, x, z);
      const edge = 0.18 + spacing / d.b;
      const core = 0.75 + 0.25 * smoothstep(0.9, 0.2, e);
      u = Math.max(u, d.profile.density * core * smoothstep(1 + edge * 0.5, 1 - edge, e));
    }
    return u;
  }
}
