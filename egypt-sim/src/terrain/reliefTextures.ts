/**
 * Per-fragment relief for coarse terrain nodes. A node 50 km wide has vertices
 * every 1.5 km, far too sparse to shade the Red Sea Hills or Sinai from orbit, so
 * slopes are baked from the DEMs into textures and used as normals instead:
 *   national (0.01°): RG = slope east/south, B = Egypt coverage (crisp borders)
 *   context  (0.05°): RG = slope east/south, B = water coverage (sea + lakes)
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType, Vector4 } from 'three';
import type { DemGrid } from '../gis/dem';
import type { World } from '../gis/world';
import { rasterize } from '../gis/rasters';

/** Slope (m/m) mapped to the full byte range; ±0.6 covers escarpments at 1 km scale. */
export const SLOPE_RANGE = 0.6;
const M_PER_DEG = 111_195;

export interface ReliefTextures {
  national: DataTexture;
  nationalRect: Vector4;
  context: DataTexture;
  contextRect: Vector4;
}

function slopes(dem: DemGrid, out: Uint8Array): void {
  const { width: w, height: h } = dem;
  const dy = dem.stepLat * M_PER_DEG;
  for (let r = 0; r < h; r++) {
    const lat = dem.north - r * dem.stepLat;
    const dx = dem.stepLon * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
    for (let c = 0; c < w; c++) {
      const gx = (dem.at(c + 1, r) - dem.at(c - 1, r)) / (2 * dx);
      const gz = (dem.at(c, r + 1) - dem.at(c, r - 1)) / (2 * dy); // rows run south = +z
      const o = (r * w + c) * 4;
      out[o] = 128 + Math.max(-127, Math.min(127, (gx / SLOPE_RANGE) * 127));
      out[o + 1] = 128 + Math.max(-127, Math.min(127, (gz / SLOPE_RANGE) * 127));
    }
  }
}

function texture(data: Uint8Array, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Rect (west, north, lonSpan, latSpan) whose texel centres sit on the DEM lattice. */
const rectOf = (d: DemGrid) => new Vector4(d.west - d.stepLon / 2, d.north + d.stepLat / 2, d.stepLon * d.width, d.stepLat * d.height);

export function buildReliefTextures(world: World): ReliefTextures {
  const nat = world.dem;
  const natData = new Uint8Array(nat.width * nat.height * 4);
  slopes(nat, natData);
  const egypt = rasterize(world.gis.egypt, { width: nat.width, height: nat.height, west: nat.west, north: nat.north, stepLon: nat.stepLon, stepLat: nat.stepLat });
  for (let i = 0; i < egypt.length; i++) {
    natData[i * 4 + 2] = egypt[i];
    natData[i * 4 + 3] = 255;
  }

  const ctx = world.contextDem;
  const lattice = { width: ctx.width, height: ctx.height, west: ctx.west, north: ctx.north, stepLon: ctx.stepLon, stepLat: ctx.stepLat };
  const ctxData = new Uint8Array(ctx.width * ctx.height * 4);
  slopes(ctx, ctxData);
  const land = rasterize(world.gis.land, lattice);
  const lakes = rasterize(world.gis.lakes.flatMap((l) => l.rings), lattice);
  for (let i = 0; i < land.length; i++) {
    ctxData[i * 4 + 2] = Math.max(255 - land[i], lakes[i]);
    ctxData[i * 4 + 3] = 255;
  }
  return { national: texture(natData, nat.width, nat.height), nationalRect: rectOf(nat), context: texture(ctxData, ctx.width, ctx.height), contextRect: rectOf(ctx) };
}
