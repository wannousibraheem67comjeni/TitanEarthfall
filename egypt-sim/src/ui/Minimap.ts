/**
 * Overview map: shaded relief + land use from the baked national data, governorate
 * borders and the Nile, the camera's ground footprint, and click-to-fly.
 */
import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { World } from '../gis/world';
import { macroSize } from '../terrain/macro';

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  private readonly w: number;
  private readonly h: number;
  private readonly west: number;
  private readonly east: number;
  private readonly north: number;
  private readonly south: number;
  private readonly ray = new Raycaster();
  onPick: ((lon: number, lat: number) => void) | null = null;

  constructor(private readonly world: World, macro: Uint8Array, width = 250) {
    const b = world.gis.meta.bbox;
    [this.west, this.south, this.east, this.north] = b;
    const aspect = ((this.east - this.west) * Math.cos((((this.north + this.south) / 2) * Math.PI) / 180)) / (this.north - this.south);
    this.w = width;
    this.h = Math.round(width / aspect);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.base = document.createElement('canvas');
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.drawBase(macro);
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const lon = this.west + ((e.clientX - r.left) / r.width) * (this.east - this.west);
      const lat = this.north - ((e.clientY - r.top) / r.height) * (this.north - this.south);
      this.onPick?.(lon, lat);
    });
  }

  private px(lon: number, lat: number): [number, number] {
    return [((lon - this.west) / (this.east - this.west)) * this.base.width, ((this.north - lat) / (this.north - this.south)) * this.base.height];
  }

  private drawBase(macro: Uint8Array): void {
    const ctx = this.base.getContext('2d')!;
    const W = this.base.width;
    const H = this.base.height;
    const img = ctx.createImageData(W, H);
    const { width: mw, height: mh } = macroSize(this.world);
    const dem = this.world.dem;
    for (let y = 0; y < H; y++) {
      const lat = this.north - ((y + 0.5) / H) * (this.north - this.south);
      for (let x = 0; x < W; x++) {
        const lon = this.west + ((x + 0.5) / W) * (this.east - this.west);
        const mx = Math.min(mw - 1, Math.floor(((lon - this.west) / (this.east - this.west)) * mw));
        const my = Math.min(mh - 1, Math.floor(((this.north - lat) / (this.north - this.south)) * mh));
        const o = (my * mw + mx) * 4;
        const fert = macro[o] / 255;
        const urban = macro[o + 1] / 255;
        const rock = macro[o + 2] / 255;
        const water = macro[o + 3] / 255;
        const h = dem.sampleBilinear(lon, lat);
        const hx = dem.sampleBilinear(lon + 0.06, lat) - h;
        const hy = dem.sampleBilinear(lon, lat - 0.06) - h;
        const shade = Math.max(0.45, Math.min(1.2, 0.95 - (hx - hy) * 0.004));
        const egypt = this.world.rasters.egypt(lon, lat);
        let r = 205 - rock * 60, g = 172 - rock * 55, bl = 122 - rock * 35;
        r += (52 - r) * fert; g += (92 - g) * fert; bl += (40 - bl) * fert;
        r += (170 - r) * urban; g += (160 - g) * urban; bl += (150 - bl) * urban;
        r *= shade; g *= shade; bl *= shade;
        const grey = (r + g + bl) / 3;
        r += (grey - r) * (1 - egypt) * 0.7; g += (grey - g) * (1 - egypt) * 0.7; bl += (grey - bl) * (1 - egypt) * 0.7;
        r += (24 - r) * water; g += (62 - g) * water; bl += (102 - bl) * water;
        const i = (y * W + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = bl; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.lineWidth = Math.max(1, W / 400);
    ctx.strokeStyle = 'rgba(70, 30, 20, 0.45)';
    for (const g of this.world.gis.governorates) for (const ring of g.rings) this.path(ctx, ring, true);
    ctx.strokeStyle = 'rgba(255, 226, 168, 0.9)';
    ctx.lineWidth = Math.max(1.2, W / 260);
    for (const ring of this.world.gis.egypt) this.path(ctx, ring, true);
    ctx.strokeStyle = 'rgba(70, 150, 230, 0.95)';
    for (const r of this.world.gis.rivers) this.path(ctx, r.points, false);
  }

  private path(ctx: CanvasRenderingContext2D, flat: number[], close: boolean): void {
    ctx.beginPath();
    for (let i = 0; i < flat.length; i += 2) {
      const [x, y] = this.px(flat[i], flat[i + 1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (close) ctx.closePath();
    ctx.stroke();
  }

  /** Redraws the camera footprint (ground quad of the view frustum) and target. */
  update(camera: PerspectiveCamera, target: Vector3): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0);
    const corners: [number, number][] = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.ray.setFromCamera(new Vector2(nx, ny), camera);
      const d = this.ray.ray.direction;
      const o = this.ray.ray.origin;
      // Intersect with the ground plane; clamp rays above the horizon to a far point.
      const t = d.y < -1e-3 ? (target.y - o.y) / d.y : 2_000_000;
      const p = new Vector3().copy(o).addScaledVector(d, Math.min(t, 2_000_000));
      const [lon, lat] = this.world.proj.inverse(p.x, p.z);
      corners.push(this.px(lon, lat));
    }
    ctx.fillStyle = 'rgba(255, 211, 107, 0.15)';
    ctx.strokeStyle = 'rgba(255, 211, 107, 0.95)';
    ctx.lineWidth = Math.max(1, this.canvas.width / 220);
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const [lon, lat] = this.world.proj.inverse(target.x, target.z);
    const [tx, ty] = this.px(lon, lat);
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath();
    ctx.arc(tx, ty, Math.max(2.5, this.canvas.width / 90), 0, Math.PI * 2);
    ctx.fill();
  }
}
