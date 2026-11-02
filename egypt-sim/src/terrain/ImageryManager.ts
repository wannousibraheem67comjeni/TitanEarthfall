/**
 * Satellite imagery as two camera-centred mosaics (near: fine zoom, far: 3 zoom
 * levels coarser), each 4×4 XYZ tiles. Tiles are drawn into a Web-Mercator canvas,
 * then resampled row-by-row to linear latitude, so the terrain shader can map
 * lon/lat → UV linearly with full float precision at any zoom.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import type { TileSource } from '../config';
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from '../gis/projection';
import { tileUrl } from '../gis/imagery';
import type { TerrainUniforms } from './terrainMaterial';

const TILES = 4;
const PX = 256 * TILES;

interface Mosaic {
  key: string;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
}

export class ImageryManager {
  private source: TileSource | null = null;
  private readonly near: Mosaic;
  private readonly far: Mosaic;
  private readonly images = new Map<string, Promise<HTMLImageElement | null>>();
  private loading = 0;

  constructor(private readonly uniforms: TerrainUniforms) {
    this.near = this.makeMosaic();
    this.far = this.makeMosaic();
    uniforms.uImgNear.value = this.near.texture;
    uniforms.uImgFar.value = this.far.texture;
  }

  private makeMosaic(): Mosaic {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PX;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = 4;
    return { key: '', canvas, texture };
  }

  setSource(source: TileSource | null): void {
    this.source = source;
    this.uniforms.uImageryMix.value = source ? 1 : 0;
    this.near.key = this.far.key = '';
    this.uniforms.uImgNearRect.value.w = 0;
    this.uniforms.uImgFarRect.value.w = 0;
  }

  get attribution(): string | null {
    return this.source?.attribution ?? null;
  }

  get busy(): boolean {
    return this.loading > 0;
  }

  /** Re-centres the mosaics on the camera target when it moves a tile or changes zoom. */
  update(lon: number, lat: number, distance: number): void {
    if (!this.source) return;
    const res = distance / 900; // desired ground metres per pixel
    const zNear = Math.max(4, Math.min(this.source.maxZoom, Math.floor(Math.log2((156543 * Math.cos((lat * Math.PI) / 180)) / res))));
    this.refresh(this.near, zNear, lon, lat, this.uniforms.uImgNearRect.value);
    this.refresh(this.far, Math.max(2, zNear - 3), lon, lat, this.uniforms.uImgFarRect.value);
  }

  private refresh(m: Mosaic, z: number, lon: number, lat: number, rect: { set(x: number, y: number, z: number, w: number): unknown }): void {
    const x0 = Math.floor(lonToTileX(lon, z) - TILES / 2 + 0.5);
    const y0 = Math.floor(latToTileY(lat, z) - TILES / 2 + 0.5);
    const key = `${this.source!.id}/${z}/${x0}/${y0}`;
    if (m.key === key) return;
    m.key = key;
    const src = this.source!;
    const raw = document.createElement('canvas');
    raw.width = raw.height = PX;
    const rctx = raw.getContext('2d')!;
    const jobs: Promise<void>[] = [];
    for (let j = 0; j < TILES; j++) {
      for (let i = 0; i < TILES; i++) {
        const n = 2 ** z;
        const tx = ((x0 + i) % n + n) % n;
        const ty = y0 + j;
        if (ty < 0 || ty >= n) continue;
        jobs.push(this.image(tileUrl(src.url, z, tx, ty)).then((img) => { if (img) rctx.drawImage(img, i * 256, j * 256); }));
      }
    }
    this.loading++;
    void Promise.all(jobs).then(() => {
      this.loading--;
      if (m.key !== key) return; // superseded while loading
      const west = tileXToLon(x0, z);
      const east = tileXToLon(x0 + TILES, z);
      const north = tileYToLat(y0, z);
      const south = tileYToLat(y0 + TILES, z);
      // Resample Mercator rows onto rows linear in latitude.
      const ctx = m.canvas.getContext('2d')!;
      ctx.clearRect(0, 0, PX, PX);
      for (let row = 0; row < PX; row++) {
        const latRow = north - ((row + 0.5) / PX) * (north - south);
        const srcRow = Math.min(PX - 1, Math.max(0, (latToTileY(latRow, z) - y0) * 256));
        ctx.drawImage(raw, 0, Math.floor(srcRow), PX, 1, 0, row, PX, 1);
      }
      m.texture.needsUpdate = true;
      rect.set(west, north, east - west, north - south);
    });
  }

  private image(url: string): Promise<HTMLImageElement | null> {
    let p = this.images.get(url);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
      this.images.set(url, p);
      if (this.images.size > 400) this.images.delete(this.images.keys().next().value!);
    }
    return p;
  }
}
