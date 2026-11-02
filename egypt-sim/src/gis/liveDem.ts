/**
 * Live high-resolution elevation streaming (≈30 m SRTM at z12–14) for close-up
 * terrain. Runs inside mesh workers: fetch → createImageBitmap → OffscreenCanvas →
 * decode. If any tile fails the node silently falls back to the baked DEM.
 */
import { decodeMapboxRgb, decodeTerrarium } from './dem';
import { latToTileY, lonToTileX, tileGroundResolution } from './projection';
import { tileUrl } from './imagery';

export type ElevationFn = (lon: number, lat: number) => number;

const MAX_TILES = 64;

export class LiveDemProvider {
  private readonly cache = new Map<string, Promise<Float32Array | null>>();

  constructor(
    private readonly template: string,
    private readonly encoding: 'terrarium' | 'mapbox',
    private readonly maxZoom: number,
  ) {}

  /** Coarsest zoom whose pixels are at least as fine as the mesh spacing. */
  zoomFor(spacing: number, lat: number): number {
    for (let z = 8; z < this.maxZoom; z++) if (tileGroundResolution(lat, z) <= spacing) return z;
    return this.maxZoom;
  }

  /** Elevation function covering `bbox`, or null if tiles are unavailable. */
  async sampler(bbox: [number, number, number, number], spacing: number): Promise<ElevationFn | null> {
    const [w, s, e, n] = bbox;
    let z = this.zoomFor(spacing, (s + n) / 2);
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    for (; z >= 8; z--) {
      x0 = Math.floor(lonToTileX(w, z));
      x1 = Math.floor(lonToTileX(e, z));
      y0 = Math.floor(latToTileY(n, z));
      y1 = Math.floor(latToTileY(s, z));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 9) break;
    }
    const tiles = new Map<string, Float32Array>();
    const jobs: Promise<void>[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        jobs.push(this.tile(z, x, y).then((t) => { if (t) tiles.set(`${x}/${y}`, t); }));
      }
    }
    await Promise.all(jobs);
    if (tiles.size !== (x1 - x0 + 1) * (y1 - y0 + 1)) return null;
    const zz = z;
    return (lon, lat) => {
      const fx = lonToTileX(lon, zz);
      const fy = latToTileY(lat, zz);
      const t = tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
      if (!t) return NaN;
      const px = Math.min(254.999, Math.max(0, (fx - Math.floor(fx)) * 256 - 0.5));
      const py = Math.min(254.999, Math.max(0, (fy - Math.floor(fy)) * 256 - 0.5));
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const tx = px - ix;
      const ty = py - iy;
      const o = iy * 256 + ix;
      const top = t[o] + (t[o + 1] - t[o]) * tx;
      const bot = t[o + 256] + (t[o + 257] - t[o + 256]) * tx;
      return top + (bot - top) * ty;
    };
  }

  private tile(z: number, x: number, y: number): Promise<Float32Array | null> {
    const key = `${z}/${x}/${y}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.load(z, x, y);
      this.cache.set(key, p);
      if (this.cache.size > MAX_TILES) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  private async load(z: number, x: number, y: number): Promise<Float32Array | null> {
    try {
      const res = await fetch(tileUrl(this.template, z, x, y));
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      const decode = this.encoding === 'terrarium' ? decodeTerrarium : decodeMapboxRgb;
      for (let i = 0; i < out.length; i++) out[i] = decode(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      return out;
    } catch {
      return null;
    }
  }
}
