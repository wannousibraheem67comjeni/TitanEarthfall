/**
 * Every surface is painted in code: porcelain floor tiles with grout, painted walls,
 * the suspended ceiling, asphalt, paving, kerbs, wood, quartz, cardboard, the buildings
 * across the street, palm fronds, the shop sign and the wall clock. Each comes with the
 * roughness and normal maps a physically based material needs, so light behaves on it.
 */
import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

export const DISPLAY_FONT = "'Lalezar', 'Readex Pro', 'Noto Kufi Arabic', 'Segoe UI', Tahoma, sans-serif";
export const BODY_FONT = "'Readex Pro', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: false })!];
}

export function toTexture(c: HTMLCanvasElement, opts: { repeat?: boolean; color?: boolean } = {}): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = opts.color === false ? LinearSRGBColorSpace : SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const cache = new Map<string, unknown>();
export function cached<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (v === undefined) cache.set(key, (v = make()));
  return v;
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/** Seeded hash noise: smooth value noise and fractal sums of it, tileable over `period`. */
export class Noise {
  private readonly p: Uint8Array;

  constructor(seed = 1) {
    this.p = new Uint8Array(512);
    const a = new Uint8Array(256).map((_, i) => i);
    let s = seed * 9301 + 49297;
    for (let i = 255; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = a[i & 255];
  }

  private h(x: number, y: number, period: number): number {
    x = ((x % period) + period) % period;
    y = ((y % period) + period) % period;
    return this.p[this.p[x & 255] + (y & 255)] / 255;
  }

  /** Value noise in [0,1], tileable with integer period (in lattice cells). */
  value(x: number, y: number, period = 256): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = this.h(xi, yi, period);
    const b = this.h(xi + 1, yi, period);
    const c = this.h(xi, yi + 1, period);
    const d = this.h(xi + 1, yi + 1, period);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Fractal sum: `oct` octaves, starting at `period` cells across the tile. */
  fbm(x: number, y: number, oct: number, period: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      sum += this.value(x * f, y * f, period * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

/** A normal map from a height field (Sobel), as a linear texture. */
export function normalFromHeight(height: Float32Array, w: number, h: number, strength: number): CanvasTexture {
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { repeat: true, color: false });
}

/** A grey roughness map from values in [0,1]. */
function greyTexture(values: Float32Array, w: number, h: number): CanvasTexture {
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, values[i] * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { repeat: true, color: false });
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export interface Surface {
  map: Texture;
  roughnessMap?: Texture;
  normalMap?: Texture;
  /** Metres covered by one repeat of the texture. */
  size: number;
}

// ---------------------------------------------------------------------------
// Floors, walls, ceiling
// ---------------------------------------------------------------------------

/** 60 cm porcelain tiles, 4 × 4 per repeat, polished with soft clouding and fine grout. */
export function porcelainFloor(base = '#e9e2d6', veins = false): Surface {
  return cached(`floor${base}${veins}`, () => {
    const S = 1024;
    const tiles = 4;
    const T = S / tiles;
    const n = new Noise(3);
    const [c, ctx] = canvas(S, S);
    const img = ctx.createImageData(S, S);
    const rough = new Float32Array(S * S);
    const height = new Float32Array(S * S);
    const [br, bg, bb] = hexRgb(base);
    const tone: number[] = [];
    for (let i = 0; i < tiles * tiles; i++) tone.push((n.value(i * 3.1, i * 1.7) - 0.5) * 0.06);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const tx = Math.floor(x / T);
        const ty = Math.floor(y / T);
        const gx = Math.min(x % T, T - 1 - (x % T));
        const gy = Math.min(y % T, T - 1 - (y % T));
        const g = Math.min(gx, gy);
        const i = y * S + x;
        let v = 1 + tone[ty * tiles + tx] + (n.fbm(x / 64, y / 64, 4, 16) - 0.5) * 0.08;
        if (veins) {
          const w = Math.abs(Math.sin((x * 0.012 + n.fbm(x / 90, y / 90, 4, 12) * 7 + y * 0.004) * Math.PI));
          v -= Math.pow(1 - w, 18) * 0.22;
        }
        const grout = g < 2;
        const edge = g < 4 ? (g - 2) / 2 : 1;
        if (grout) {
          img.data[i * 4] = br * 0.62;
          img.data[i * 4 + 1] = bg * 0.6;
          img.data[i * 4 + 2] = bb * 0.58;
          rough[i] = 0.85;
          height[i] = 0;
        } else {
          img.data[i * 4] = Math.min(255, br * v);
          img.data[i * 4 + 1] = Math.min(255, bg * v);
          img.data[i * 4 + 2] = Math.min(255, bb * v);
          rough[i] = 0.14 + n.fbm(x / 40, y / 40, 3, 25) * 0.16;
          height[i] = 0.4 + 0.6 * edge;
        }
        img.data[i * 4 + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), roughnessMap: greyTexture(rough, S, S), normalMap: normalFromHeight(height, S, S, 2.5), size: 2.4 };
  });
}

/** Matt emulsion paint with a faint roller texture. */
export function paintedWall(color: string): Surface {
  return cached(`paint${color}`, () => {
    const S = 256;
    const n = new Noise(7);
    const [c, ctx] = canvas(S, S);
    const img = ctx.createImageData(S, S);
    const height = new Float32Array(S * S);
    const [r, g, b] = hexRgb(color);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const k = n.fbm(x / 8, y / 8, 3, 32);
        const v = 0.97 + (k - 0.5) * 0.05 + (n.fbm(x / 60, y / 60, 2, 4) - 0.5) * 0.04;
        img.data[i * 4] = Math.min(255, r * v);
        img.data[i * 4 + 1] = Math.min(255, g * v);
        img.data[i * 4 + 2] = Math.min(255, b * v);
        img.data[i * 4 + 3] = 255;
        height[i] = k;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(height, S, S, 0.12), size: 1.5 };
  });
}

/** Suspended ceiling: 60 cm mineral tiles in a white T-bar grid. */
export function ceilingTiles(): Surface {
  return cached('ceiling', () => {
    const S = 512;
    const [c, ctx] = canvas(S, S);
    const n = new Noise(11);
    ctx.fillStyle = '#efeeea';
    ctx.fillRect(0, 0, S, S);
    // Fissures.
    ctx.fillStyle = 'rgba(120,115,105,0.18)';
    for (let i = 0; i < 2600; i++) {
      const x = n.value(i * 1.3, 0.5) * S * 4;
      const y = n.value(0.5, i * 1.7) * S * 4;
      ctx.fillRect(x % S, y % S, 1 + (i % 3), 1);
    }
    ctx.fillStyle = '#d9d8d4';
    for (const p of [0, S / 2]) {
      ctx.fillRect(p - 3, 0, 6, S);
      ctx.fillRect(0, p - 3, S, 6);
    }
    return { map: toTexture(c, { repeat: true }), size: 1.2 };
  });
}

/** Wall tiles for the bottom band and behind the fridges. */
export function wallTiles(color = '#f4f2ee'): Surface {
  return cached(`wtiles${color}`, () => {
    const S = 256;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = shade(color, -0.12);
    ctx.fillRect(0, 0, S, S);
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, color);
    g.addColorStop(1, shade(color, -0.04));
    ctx.fillStyle = g;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) ctx.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
    return { map: toTexture(c, { repeat: true }), size: 0.6 };
  });
}

// ---------------------------------------------------------------------------
// Outside
// ---------------------------------------------------------------------------

export function asphalt(): Surface {
  return cached('asphalt', () => {
    const S = 512;
    const n = new Noise(5);
    const [c, ctx] = canvas(S, S);
    const img = ctx.createImageData(S, S);
    const height = new Float32Array(S * S);
    const rough = new Float32Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const grain = n.value(x * 0.9, y * 0.9, 461);
        const cloud = n.fbm(x / 70, y / 70, 3, 8);
        const stone = grain > 0.86 ? 1 : 0;
        const v = 52 + cloud * 26 + grain * 14 + stone * 40;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v + 3;
        img.data[i * 4 + 3] = 255;
        height[i] = grain * 0.6 + stone * 0.4;
        rough[i] = 0.82 + grain * 0.15 - stone * 0.2;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), roughnessMap: greyTexture(rough, S, S), normalMap: normalFromHeight(height, S, S, 1.6), size: 4 };
  });
}

/** Interlocking concrete pavers in a herringbone of greys. */
export function pavers(): Surface {
  return cached('pavers', () => {
    const S = 512;
    const [c, ctx] = canvas(S, S);
    const height = new Float32Array(S * S);
    const n = new Noise(9);
    ctx.fillStyle = '#7d7871';
    ctx.fillRect(0, 0, S, S);
    const u = S / 8;
    const tones = ['#bdb6ab', '#b2aa9e', '#c6bfb4', '#a9a296'];
    const blocks: [number, number, number, number][] = [];
    for (let y = -1; y < 9; y++)
      for (let x = -1; x < 9; x++) {
        if ((x + y) % 2 === 0) blocks.push([x * u, y * u, u * 2, u]);
        else blocks.push([x * u, y * u, u, u * 2]);
      }
    for (const [x, y, w, h] of blocks) {
      ctx.fillStyle = tones[Math.floor(n.value(x * 0.07 + 0.3, y * 0.05 + 0.7) * tones.length) % tones.length];
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    }
    const data = ctx.getImageData(0, 0, S, S).data;
    for (let i = 0; i < S * S; i++) height[i] = data[i * 4] > 140 ? 1 : 0;
    // Weathering.
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const k = 0.9 + n.fbm(x / 30, y / 30, 3, 16) * 0.2;
        img.data[i] *= k;
        img.data[i + 1] *= k;
        img.data[i + 2] *= k;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(height, S, S, 1.2), size: 1.6 };
  });
}

/** The striped canvas awning over the shopfront. */
export function awningTexture(): CanvasTexture {
  return cached('awning', () => {
    const [c, ctx] = canvas(256, 64);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#e8508f';
      ctx.fillRect(i * 32, 0, 32, 64);
    }
    return toTexture(c, { repeat: true });
  });
}

/** Painted kerb stones, black and white. */
export function kerb(): Surface {
  return cached('kerb', () => {
    const [c, ctx] = canvas(256, 64);
    ctx.fillStyle = '#efeee9';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#1d1d1f';
    ctx.fillRect(0, 0, 128, 64);
    return { map: toTexture(c, { repeat: true }), size: 2 };
  });
}

export function concrete(color = '#d9cfbf'): Surface {
  return cached(`concrete${color}`, () => {
    const S = 256;
    const n = new Noise(13);
    const [c, ctx] = canvas(S, S);
    const img = ctx.createImageData(S, S);
    const [r, g, b] = hexRgb(color);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const v = 0.9 + n.fbm(x / 20, y / 20, 4, 12) * 0.18;
        img.data[i] = Math.min(255, r * v);
        img.data[i + 1] = Math.min(255, g * v);
        img.data[i + 2] = Math.min(255, b * v);
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), size: 3 };
  });
}

// ---------------------------------------------------------------------------
// Materials for furniture
// ---------------------------------------------------------------------------

export function wood(color = '#9c6b43'): Surface {
  return cached(`wood${color}`, () => {
    const W = 256;
    const H = 512;
    const n = new Noise(17);
    const [c, ctx] = canvas(W, H);
    const img = ctx.createImageData(W, H);
    const [r, g, b] = hexRgb(color);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const warp = n.fbm(x / 40, y / 160, 3, 8) * 6;
        const ring = Math.sin((x / 7 + warp) * Math.PI);
        const v = 0.86 + ring * 0.06 + n.value(x * 0.5, y * 0.02, 128) * 0.08;
        img.data[i] = Math.min(255, r * v);
        img.data[i + 1] = Math.min(255, g * v);
        img.data[i + 2] = Math.min(255, b * v);
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), size: 1 };
  });
}

/** Speckled white quartz for the desk top. */
export function quartz(): Surface {
  return cached('quartz', () => {
    const S = 512;
    const n = new Noise(19);
    const [c, ctx] = canvas(S, S);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const fleck = n.value(x * 0.7, y * 0.7, 358);
        const cloud = n.fbm(x / 80, y / 80, 3, 6);
        let v = 236 + cloud * 12;
        if (fleck > 0.88) v -= 70 * (fleck - 0.88) * 8;
        img.data[i] = v;
        img.data[i + 1] = v - 2;
        img.data[i + 2] = v - 5;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), size: 1.2 };
  });
}

export function cardboard(): Surface {
  return cached('cardboard', () => {
    const S = 256;
    const n = new Noise(23);
    const [c, ctx] = canvas(S, S);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const v = 0.92 + n.fbm(x / 3, y / 30, 2, 64) * 0.12;
        img.data[i] = 196 * v;
        img.data[i + 1] = 160 * v;
        img.data[i + 2] = 112 * v;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c, { repeat: true }), size: 0.6 };
  });
}

/** Brushed metal: roughness streaks only (colour comes from the material). */
export function brushed(): Texture {
  return cached('brushed', () => {
    const W = 256;
    const H = 64;
    const n = new Noise(29);
    const v = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) v[y * W + x] = 0.28 + n.value(x * 0.02, y * 1.3, 64) * 0.25;
    return greyTexture(v, W, H);
  });
}

// ---------------------------------------------------------------------------
// Signs, posters, screens
// ---------------------------------------------------------------------------

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, weight = ''): void {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${font}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 10);
  ctx.fillText(text, x, y);
}

/** The shop's light-box sign: white face with the name in pink, a thin pink frame. */
export function signTexture(text: string, sub = 'SHARQ AL EMARAT GROCERY'): CanvasTexture {
  return cached(`sign${text}`, () => {
    const [c, ctx] = canvas(1536, 300);
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#f6eef2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1536, 300);
    ctx.fillStyle = '#e8508f';
    ctx.fillRect(0, 0, 1536, 18);
    ctx.fillRect(0, 282, 1536, 18);
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d63a7c';
    fitText(ctx, text, 768, 128, 1400, 170, DISPLAY_FONT);
    ctx.direction = 'ltr';
    ctx.fillStyle = '#6d3a52';
    ctx.font = `600 40px ${BODY_FONT}`;
    ctx.fillText(sub, 768, 238);
    return toTexture(c);
  });
}

/** Window stickers on the glass door. */
export function doorSticker(): CanvasTexture {
  return cached('sticker', () => {
    const [c, ctx] = canvas(512, 512);
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.roundRect(56, 40, 400, 150, 24);
    ctx.fill();
    ctx.fillStyle = '#2f9e5b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `110px ${DISPLAY_FONT}`;
    ctx.fillText('مفتوح', 256, 105);
    ctx.font = `600 34px ${BODY_FONT}`;
    ctx.fillText('OPEN', 256, 165);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.roundRect(96, 360, 320, 96, 18);
    ctx.fill();
    ctx.fillStyle = '#1b3a6b';
    ctx.font = `600 30px ${BODY_FONT}`;
    ctx.fillText('💳 نقبل البطاقات', 256, 410);
    return toTexture(c);
  });
}

/** Opening hours lettering on the side glass. */
export function hoursSticker(): CanvasTexture {
  return cached('hours', () => {
    const [c, ctx] = canvas(512, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.0)';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.font = `64px ${DISPLAY_FONT}`;
    ctx.fillText('أوقات الدوام', 256, 80);
    ctx.font = `600 44px ${BODY_FONT}`;
    ctx.fillText('7 صباحاً — 11 مساءً', 256, 160);
    ctx.font = `500 32px ${BODY_FONT}`;
    ctx.fillText('توصيل للمنازل 📞', 256, 222);
    return toTexture(c);
  });
}

/** A promotional poster on the wall. */
export function poster(title: string, line: string, color: string, icon: string): CanvasTexture {
  return cached(`poster${title}`, () => {
    const [c, ctx] = canvas(400, 560);
    const g = ctx.createLinearGradient(0, 0, 0, 560);
    g.addColorStop(0, color);
    g.addColorStop(1, shade(color, -0.35));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 560);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.font = `76px ${DISPLAY_FONT}`;
    ctx.fillText(title, 200, 110);
    ctx.font = '180px serif';
    ctx.fillText(icon, 200, 330);
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.arc(300, 440, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c0182c';
    ctx.font = `600 40px ${BODY_FONT}`;
    ctx.fillText(line, 300, 455);
    return toTexture(c);
  });
}

/** Clock face (the hands are separate meshes). */
export function clockFace(): CanvasTexture {
  return cached('clock', () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#fbfbf8';
    ctx.beginPath();
    ctx.arc(128, 128, 126, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = i % 5 === 0 ? 100 : 110;
      ctx.lineWidth = i % 5 === 0 ? 5 : 2;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
      ctx.lineTo(128 + Math.sin(a) * 118, 128 - Math.cos(a) * 118);
      ctx.stroke();
    }
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 26px ${BODY_FONT}`;
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillText(String(i), 128 + Math.sin(a) * 82, 128 - Math.cos(a) * 82);
    }
    return toTexture(c);
  });
}

/** The UAE flag on the desk. */
export function flagTexture(): CanvasTexture {
  return cached('flag', () => {
    const [c, ctx] = canvas(240, 120);
    ctx.fillStyle = '#00843d';
    ctx.fillRect(0, 0, 240, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 40, 240, 40);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 80, 240, 40);
    ctx.fillStyle = '#ef3340';
    ctx.fillRect(0, 0, 60, 120);
    return toTexture(c);
  });
}

/** One palm frond: a midrib with leaflets, on transparent. */
export function frondTexture(): CanvasTexture {
  return cached('frond', () => {
    const [c, ctx] = canvas(512, 128);
    ctx.clearRect(0, 0, 512, 128);
    ctx.strokeStyle = '#6b7a2e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(512, 64);
    ctx.stroke();
    for (let i = 8; i < 500; i += 9) {
      const len = 56 * Math.sin((i / 512) * Math.PI) + 6;
      for (const s of [-1, 1]) {
        const g = ctx.createLinearGradient(i, 64, i + 24, 64 + s * len);
        g.addColorStop(0, '#4d6b22');
        g.addColorStop(1, '#7f9a3a');
        ctx.strokeStyle = g;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(i, 64);
        ctx.quadraticCurveTo(i + 10, 64 + s * len * 0.5, i + 24, 64 + s * len);
        ctx.stroke();
      }
    }
    return toTexture(c);
  });
}

const SHOPS = [
  { name: 'كافتيريا الصداقة', color: '#c0392b' },
  { name: 'صالون الأناقة للرجال', color: '#1f5f8b' },
  { name: 'مغسلة النظافة', color: '#2e8b57' },
  { name: 'خياط الإمارات', color: '#8e44ad' },
  { name: 'مطعم البحر', color: '#d35400' },
  { name: 'محل الجوالات', color: '#2c3e50' },
  { name: 'صيدلية الشفاء', color: '#16a085' },
  { name: 'مخبز الفريج', color: '#b9770e' },
];

/** A two-storey building front across the street: a shop below, flats above. */
export function facadeTexture(i: number): CanvasTexture {
  return cached(`facade${i}`, () => {
    const W = 1024;
    const H = 768;
    const [c, ctx] = canvas(W, H);
    const n = new Noise(31 + i);
    const walls = ['#e7dcc8', '#d9c9ad', '#efe6d6', '#cdbb9b', '#e3d3bd'];
    ctx.fillStyle = walls[i % walls.length];
    ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        const k = 0.94 + n.fbm(x / 40, y / 40, 3, 16) * 0.1;
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const j = ((y + dy) * W + x + dx) * 4;
          img.data[j] *= k;
          img.data[j + 1] *= k;
          img.data[j + 2] *= k;
        }
      }
    ctx.putImageData(img, 0, 0);
    // Upper floor: windows with mashrabiya-like screens and AC units.
    for (let k = 0; k < 3; k++) {
      const x = 90 + k * 310;
      ctx.fillStyle = '#5b6b78';
      ctx.fillRect(x, 70, 200, 190);
      const sky = ctx.createLinearGradient(x, 70, x + 200, 260);
      sky.addColorStop(0, 'rgba(200,225,240,0.75)');
      sky.addColorStop(1, 'rgba(60,80,95,0.6)');
      ctx.fillStyle = sky;
      ctx.fillRect(x + 8, 78, 184, 174);
      ctx.strokeStyle = '#f4efe6';
      ctx.lineWidth = 6;
      ctx.strokeRect(x, 70, 200, 190);
      ctx.beginPath();
      ctx.moveTo(x + 100, 70);
      ctx.lineTo(x + 100, 260);
      ctx.stroke();
      if ((k + i) % 2 === 0) {
        ctx.fillStyle = '#f1f1ee';
        ctx.fillRect(x + 120, 262, 90, 54);
        ctx.fillStyle = '#c9c9c4';
        for (let j = 0; j < 6; j++) ctx.fillRect(x + 126, 270 + j * 7, 78, 3);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 352, W, 10);
    // Ground floor: two shops with signs and shutters.
    for (let k = 0; k < 2; k++) {
      const shop = SHOPS[(i * 2 + k) % SHOPS.length];
      const x = 30 + k * 500;
      ctx.fillStyle = shop.color;
      ctx.fillRect(x, 380, 460, 110);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';
      fitText(ctx, shop.name, x + 230, 436, 420, 74, DISPLAY_FONT);
      const glass = ctx.createLinearGradient(x, 500, x, 760);
      glass.addColorStop(0, '#26323b');
      glass.addColorStop(1, '#46545e');
      ctx.fillStyle = glass;
      ctx.fillRect(x, 500, 460, 268);
      ctx.fillStyle = 'rgba(255,240,200,0.25)';
      ctx.fillRect(x + 20, 520, 420, 120);
      ctx.strokeStyle = '#b8bcc0';
      ctx.lineWidth = 8;
      ctx.strokeRect(x, 500, 460, 268);
      ctx.beginPath();
      ctx.moveTo(x + 230, 500);
      ctx.lineTo(x + 230, 768);
      ctx.stroke();
    }
    return toTexture(c);
  });
}

/** Where a facade glows at night: shop signs and lit windows only. */
export function facadeGlow(i: number): CanvasTexture {
  return cached(`facadeGlow${i}`, () => {
    const [c, ctx] = canvas(512, 384);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 384);
    const s = 0.5;
    for (let k = 0; k < 3; k++) {
      if ((k + i) % 3 === 1) continue;
      ctx.fillStyle = 'rgb(255,214,150)';
      ctx.fillRect((90 + k * 310 + 8) * s, 78 * s, 184 * s, 174 * s);
    }
    for (let k = 0; k < 2; k++) {
      const x = 30 + k * 500;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x * s, 380 * s, 460 * s, 110 * s);
      ctx.fillStyle = 'rgb(255,236,200)';
      ctx.fillRect((x + 20) * s, 520 * s, 420 * s, 230 * s);
    }
    return toTexture(c);
  });
}

/** A distant ridge of the Hajar mountains, as seen from the east coast. */
export function mountainTexture(): CanvasTexture {
  return cached('mountains', () => {
    const [c, ctx] = canvas(2048, 256);
    const n = new Noise(41);
    ctx.clearRect(0, 0, 2048, 256);
    for (const [layer, color, base] of [
      [0, 'rgba(150,140,140,0.9)', 120],
      [1, 'rgba(120,110,110,1)', 170],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 256);
      for (let x = 0; x <= 2048; x += 8) {
        const y = base - n.fbm(x / 300 + layer * 7, layer * 3, 5, 8) * 160 + 40;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(2048, 256);
      ctx.fill();
    }
    return toTexture(c);
  });
}
