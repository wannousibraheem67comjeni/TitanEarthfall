/**
 * Procedural canvas textures: street surfaces, façades, Arabic shop signs, shop
 * interiors seen through the glass, and the banknotes themselves. Everything is
 * drawn at start-up so the game ships without image files.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../core/rng';
import { denomination } from '../game/catalog';

export const DISPLAY_FONT = "'Lalezar', 'Readex Pro', 'Noto Kufi Arabic', 'Segoe UI', Tahoma, sans-serif";
export const BODY_FONT = "'Readex Pro', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = false, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, count: number, colors: string[], size: [number, number]): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.pick(colors);
    const s = rng.range(size[0], size[1]);
    ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

const cache = new Map<string, Texture>();
function cached<T extends Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) cache.set(key, (t = make()));
  return t;
}

// ---------------------------------------------------------------------------
// Ground and street
// ---------------------------------------------------------------------------

export function sandTexture(): Texture {
  return cached('sand', () => {
    const [c, ctx] = canvas(512, 512);
    const rng = new Rng(11);
    ctx.fillStyle = '#dcc49a';
    ctx.fillRect(0, 0, 512, 512);
    // Wind ripples.
    for (let y = 0; y < 512; y += 6) {
      ctx.strokeStyle = rng.chance(0.5) ? 'rgba(255,240,210,0.18)' : 'rgba(150,110,60,0.10)';
      ctx.lineWidth = rng.range(1, 3);
      ctx.beginPath();
      for (let x = 0; x <= 512; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + y) * 3);
      ctx.stroke();
    }
    speckle(ctx, 512, 512, rng, 9000, ['#c9ae82', '#e8d5ae', '#b8996c', '#f0e2c4'], [1, 2.5]);
    return finish(c, true);
  });
}

/** Asphalt with the main street's markings, one tile = 16 m along x, 12 m across. */
export function roadTexture(): Texture {
  return cached('road', () => {
    const [c, ctx] = canvas(1024, 768);
    const rng = new Rng(21);
    ctx.fillStyle = '#3b3d40';
    ctx.fillRect(0, 0, 1024, 768);
    speckle(ctx, 1024, 768, rng, 26000, ['#323436', '#46484b', '#2b2c2e', '#505255'], [1, 3]);
    // Tyre-worn lanes are slightly darker.
    ctx.fillStyle = 'rgba(20,20,22,0.12)';
    for (const y of [140, 250, 520, 630]) ctx.fillRect(0, y - 30, 1024, 60);
    // Edge lines (yellow) and dashed centre line (white).
    ctx.fillStyle = '#e8c33a';
    ctx.fillRect(0, 22, 1024, 12);
    ctx.fillRect(0, 734, 1024, 12);
    ctx.fillStyle = '#f2f2ee';
    for (let x = 0; x < 1024; x += 256) ctx.fillRect(x + 32, 378, 150, 12);
    // A few patches and cracks.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(30,30,32,0.5)';
      ctx.fillRect(rng.range(0, 980), rng.range(60, 700), rng.range(30, 90), rng.range(20, 50));
    }
    ctx.strokeStyle = 'rgba(15,15,15,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      let x = rng.range(0, 1024);
      let y = rng.range(60, 700);
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) ctx.lineTo((x += rng.range(-20, 20)), (y += rng.range(-14, 14)));
      ctx.stroke();
    }
    return finish(c, true);
  });
}

export function asphaltTexture(): Texture {
  return cached('asphalt', () => {
    const [c, ctx] = canvas(512, 512);
    const rng = new Rng(22);
    ctx.fillStyle = '#404245';
    ctx.fillRect(0, 0, 512, 512);
    speckle(ctx, 512, 512, rng, 9000, ['#36383a', '#4a4c4f', '#2e2f31'], [1, 3]);
    return finish(c, true);
  });
}

/** Interlocking pavers, the standard UAE sidewalk: one tile = 2 m. */
export function paverTexture(): Texture {
  return cached('paver', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng(31);
    ctx.fillStyle = '#8f8a84';
    ctx.fillRect(0, 0, 256, 256);
    const bw = 32;
    const bh = 16;
    for (let y = 0; y < 256; y += bh) {
      const off = (y / bh) % 2 ? bw / 2 : 0;
      for (let x = -bw; x < 256; x += bw) {
        const tint = rng.pick(['#c9b9a2', '#bfae95', '#cdbfa9', '#b8a68c', '#d4c6b1']);
        ctx.fillStyle = tint;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
    speckle(ctx, 256, 256, rng, 1500, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.07)'], [1, 2]);
    return finish(c, true);
  });
}

/** Painted kerb stones, alternating black and yellow. */
export function curbTexture(): Texture {
  return cached('curb', () => {
    const [c, ctx] = canvas(128, 16);
    ctx.fillStyle = '#1d1d1d';
    ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = '#e3bf2c';
    ctx.fillRect(0, 0, 64, 16);
    return finish(c, true);
  });
}

export function grassTexture(): Texture {
  return cached('grass', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng(41);
    ctx.fillStyle = '#5f8f3a';
    ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, 256, 256, rng, 7000, ['#6fa043', '#557f33', '#7aac4c', '#4c7530'], [1, 3]);
    // Mower stripes.
    for (let x = 0; x < 256; x += 64) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, 0, 32, 256);
    }
    return finish(c, true);
  });
}

export function tileTexture(a = '#e9dfcc', b = '#d8ccb4'): Texture {
  return cached(`tile${a}${b}`, () => {
    const [c, ctx] = canvas(128, 128);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 ? a : b;
        ctx.fillRect(x * 32, y * 32, 32, 32);
      }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i <= 128; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 128);
      ctx.moveTo(0, i);
      ctx.lineTo(128, i);
      ctx.stroke();
    }
    return finish(c, true);
  });
}

// ---------------------------------------------------------------------------
// Walls and façades
// ---------------------------------------------------------------------------

/** Rendered stucco, tinted by the material colour. */
export function stuccoTexture(): Texture {
  return cached('stucco', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng(51);
    ctx.fillStyle = '#f2f0ec';
    ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, 256, 256, rng, 6000, ['#e6e2db', '#fbfaf7', '#ddd8cf'], [1, 3]);
    // Faint dust streaks from the top.
    for (let i = 0; i < 14; i++) {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, 'rgba(160,140,110,0.10)');
      g.addColorStop(1, 'rgba(160,140,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(rng.range(0, 256), 0, rng.range(3, 10), rng.range(60, 256));
    }
    return finish(c, true);
  });
}

/**
 * Upper-floor façade: rows of windows with frames, some with mashrabiya screens.
 * Returns the colour map and an emissive map with a random set of lit windows.
 * One tile spans 3 windows × 1 floor (9 m × 3.4 m).
 */
export function facadeTextures(variant: number): { map: Texture; emissive: Texture } {
  const key = `facade${variant}`;
  const map = cached(key, () => {
    const [c, ctx] = canvas(512, 192);
    const rng = new Rng(61 + variant);
    ctx.fillStyle = '#f2efe9';
    ctx.fillRect(0, 0, 512, 192);
    speckle(ctx, 512, 192, rng, 2500, ['#e8e3da', '#faf8f4'], [1, 3]);
    // Floor band.
    ctx.fillStyle = 'rgba(120,100,70,0.18)';
    ctx.fillRect(0, 176, 512, 16);
    for (let i = 0; i < 3; i++) {
      const x = 30 + i * 170;
      const arch = variant % 2 === 1;
      ctx.fillStyle = '#6b5a45';
      ctx.fillRect(x - 6, 34, 122, 112);
      ctx.fillStyle = '#28435a';
      if (arch) {
        ctx.beginPath();
        ctx.moveTo(x, 140);
        ctx.lineTo(x, 80);
        ctx.arc(x + 55, 80, 55, Math.PI, 0);
        ctx.lineTo(x + 110, 140);
        ctx.closePath();
        ctx.fill();
      } else ctx.fillRect(x, 40, 110, 100);
      // Sky reflection.
      const g = ctx.createLinearGradient(x, 40, x + 110, 140);
      g.addColorStop(0, 'rgba(180,215,240,0.45)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(120,170,210,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 40, 110, 100);
      ctx.strokeStyle = '#d9d3c8';
      ctx.lineWidth = 4;
      ctx.strokeRect(x, 40, 110, 100);
      ctx.beginPath();
      ctx.moveTo(x + 55, 40);
      ctx.lineTo(x + 55, 140);
      ctx.stroke();
      if ((i + variant) % 3 === 0) drawMashrabiya(ctx, x + 4, 44, 102, 92, '#8a6a3f');
      // Sill.
      ctx.fillStyle = '#d6cdbd';
      ctx.fillRect(x - 10, 146, 130, 8);
    }
    return finish(c, true);
  });
  const emissive = cached(key + 'e', () => {
    const [c, ctx] = canvas(512, 192);
    const rng = new Rng(71 + variant);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 192);
    for (let i = 0; i < 3; i++) {
      if (!rng.chance(0.55)) continue;
      const x = 30 + i * 170;
      ctx.fillStyle = rng.pick(['#ffcf87', '#ffe3b0', '#fff1cf', '#bfe0ff']);
      ctx.fillRect(x, 40, 110, 100);
    }
    return finish(c, true);
  });
  return { map, emissive };
}

function drawMashrabiya(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  const s = 14;
  for (let i = -h; i < w + h; i += s) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.moveTo(x + i + h, y);
    ctx.lineTo(x + i, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/** Villa windows: shuttered and arched, for the two-storey houses behind walls. */
export function villaTextures(): { map: Texture; emissive: Texture } {
  const map = cached('villa', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng(81);
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, 256, 256, rng, 2000, ['#ebe6dc', '#fbfaf6'], [1, 3]);
    for (const row of [0, 128]) {
      const x = 78;
      const y = row + 28;
      ctx.fillStyle = '#7a5a3a';
      ctx.fillRect(x - 6, y - 6, 112, 90);
      ctx.fillStyle = '#2d4a5e';
      ctx.beginPath();
      ctx.moveTo(x, y + 78);
      ctx.lineTo(x, y + 40);
      ctx.arc(x + 50, y + 40, 50, Math.PI, 0);
      ctx.lineTo(x + 100, y + 78);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,230,250,0.3)';
      ctx.fillRect(x + 6, y + 30, 40, 44);
      drawMashrabiya(ctx, x + 2, y + 2, 96, 74, 'rgba(110,80,50,0.55)');
    }
    return finish(c, true);
  });
  const emissive = cached('villae', () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#ffd59a';
    ctx.fillRect(84, 60, 88, 46);
    return finish(c, true);
  });
  return { map, emissive };
}

/** Decorative metal gate leaf. */
export function gateTexture(color: string): Texture {
  return cached('gate' + color, () => {
    const [c, ctx] = canvas(128, 256);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 128, 256);
    ctx.strokeStyle = 'rgba(255,220,150,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 112, 240);
    // Arch and geometric star.
    ctx.beginPath();
    ctx.arc(64, 70, 40, Math.PI, 0);
    ctx.stroke();
    ctx.save();
    ctx.translate(64, 160);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-22, -22, 44, 44);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 16; x < 120; x += 12) ctx.fillRect(x, 96, 3, 30);
    return finish(c);
  });
}

export function windTowerTexture(): Texture {
  return cached('barjeel', () => {
    const [c, ctx] = canvas(128, 256);
    ctx.fillStyle = '#d9c7a4';
    ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = '#5a4630';
    for (let i = 0; i < 4; i++) ctx.fillRect(10 + i * 30, 40, 18, 150);
    ctx.fillStyle = '#c4b08c';
    ctx.fillRect(0, 0, 128, 20);
    return finish(c);
  });
}

/** Striped fabric awning. */
export function awningTexture(a: string, b: string): Texture {
  return cached(`awning${a}${b}`, () => {
    const [c, ctx] = canvas(256, 64);
    for (let x = 0; x < 256; x += 32) {
      ctx.fillStyle = (x / 32) % 2 ? b : a;
      ctx.fillRect(x, 0, 32, 64);
    }
    // Scalloped edge shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 0; x < 256; x += 32) {
      ctx.beginPath();
      ctx.arc(x + 16, 64, 16, Math.PI, 0);
      ctx.fill();
    }
    return finish(c, true);
  });
}

// ---------------------------------------------------------------------------
// Signs and shop windows
// ---------------------------------------------------------------------------

/** An illuminated Arabic shop sign with a thin English line, like the real ones. */
export function signTexture(text: string, bg: string, fg: string, sub = ''): CanvasTexture {
  const [c, ctx] = canvas(1024, 192);
  const g = ctx.createLinearGradient(0, 0, 0, 192);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 192);
  ctx.strokeStyle = shade(fg, -0.1);
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 1004, 172);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  fitText(ctx, text, 512, sub ? 88 : 100, 940, 118, DISPLAY_FONT);
  if (sub) {
    ctx.shadowBlur = 0;
    ctx.direction = 'ltr';
    ctx.font = `500 30px ${BODY_FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, 512, 160);
    ctx.globalAlpha = 1;
  }
  return finish(c);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string): void {
  let s = size;
  do {
    ctx.font = `${s}px ${font}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 4;
  } while (s > 20);
  ctx.fillText(text, x, y);
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

/**
 * What you see through each shop's glass front: shelves of goods, the karak counter,
 * perfume bottles, barber chairs, phones on display.
 */
export function interiorTexture(kind: string): CanvasTexture {
  const [c, ctx] = canvas(512, 256);
  const rng = new Rng(kind.length * 97 + kind.charCodeAt(0));
  const wall = { grocery: '#f1ede4', karak: '#e9d7b8', shawarma: '#efe3cf', perfume: '#2c2018', barber: '#e8eef2', electronics: '#e9eef5', atm: '#d9dee3' }[kind] ?? '#eee';
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, 512, 256);
  const floorY = 200;
  ctx.fillStyle = kind === 'perfume' ? '#1d140e' : '#cfc6b6';
  ctx.fillRect(0, floorY, 512, 56);
  const shelves = (rows: number[], colors: string[], itemW: number, itemH: number) => {
    for (const y of rows) {
      ctx.fillStyle = kind === 'perfume' ? '#5a3e2b' : '#9a8f80';
      ctx.fillRect(20, y, 472, 6);
      for (let x = 24; x < 486; x += itemW + 3) {
        ctx.fillStyle = rng.pick(colors);
        const h = itemH * rng.range(0.7, 1);
        ctx.fillRect(x, y - h, itemW, h);
      }
    }
  };
  switch (kind) {
    case 'grocery':
      shelves([70, 120, 170], ['#d8352b', '#f2c230', '#2f8a57', '#2b67b3', '#f08a24', '#ffffff', '#8a3b8a'], 14, 28);
      ctx.fillStyle = '#4a7da8';
      ctx.fillRect(380, 150, 110, 50); // fridge
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(386, 156, 98, 38);
      break;
    case 'karak':
      ctx.fillStyle = '#7a4a24';
      ctx.fillRect(40, 140, 430, 60); // counter
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#b8b8b8';
        ctx.beginPath();
        ctx.ellipse(110 + i * 90, 128, 26, 18, 0, 0, Math.PI * 2);
        ctx.fill(); // pots
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(98 + i * 90, 100, 24, 16);
      }
      ctx.fillStyle = '#c0521e';
      ctx.font = `48px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillText('كرك ٢ درهم', 256, 60);
      break;
    case 'shawarma':
      ctx.fillStyle = '#a0522d';
      ctx.beginPath();
      ctx.moveTo(90, 50);
      ctx.lineTo(130, 50);
      ctx.lineTo(120, 180);
      ctx.lineTo(100, 180);
      ctx.fill(); // the spit
      ctx.fillStyle = '#c96f3a';
      ctx.fillRect(60, 40, 8, 160);
      ctx.fillStyle = '#d0d0d0';
      ctx.fillRect(160, 140, 320, 60);
      ctx.fillStyle = '#b3261e';
      ctx.font = `40px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillText('شاورما دجاج ٧ — لحم ٩', 320, 70);
      break;
    case 'perfume':
      for (const y of [80, 140, 190]) {
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(20, y, 472, 5);
        for (let x = 30; x < 480; x += 26) {
          ctx.fillStyle = rng.pick(['#e9c46a', '#c98a2b', '#d0587e', '#8a5a2b', '#f4e3b0']);
          ctx.beginPath();
          ctx.ellipse(x + 8, y - 12, 8, 12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#e9c46a';
          ctx.fillRect(x + 6, y - 30, 4, 8);
        }
      }
      // Warm glow.
      ctx.fillStyle = 'rgba(255,200,120,0.12)';
      ctx.fillRect(0, 0, 512, 256);
      break;
    case 'barber':
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#9fc4dc';
        ctx.fillRect(40 + i * 160, 40, 110, 80); // mirrors
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(70 + i * 160, 140, 50, 50); // chairs
        ctx.fillRect(60 + i * 160, 125, 70, 18);
      }
      break;
    case 'electronics':
      for (const y of [90, 160]) {
        ctx.fillStyle = '#c9d1db';
        ctx.fillRect(20, y, 472, 6);
        for (let x = 30; x < 480; x += 36) {
          ctx.fillStyle = '#111';
          ctx.fillRect(x, y - 44, 24, 44);
          ctx.fillStyle = rng.pick(['#2b67b3', '#4ab3e0', '#7a5aa6', '#2f8a57']);
          ctx.fillRect(x + 2, y - 42, 20, 38);
        }
      }
      break;
  }
  // Glass reflection.
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.02)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  return finish(c);
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

/** A stylised game banknote in the denomination's colour family. */
export function noteTexture(value: number): Texture {
  return cached('note' + value, () => {
    const d = denomination(value);
    const [c, ctx] = canvas(512, 248);
    const g = ctx.createLinearGradient(0, 0, 512, 248);
    g.addColorStop(0, shade(d.color, 0.35));
    g.addColorStop(0.5, d.color);
    g.addColorStop(1, shade(d.color, 0.2));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 248);
    // Guilloche bands.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 18; k++) {
      ctx.beginPath();
      for (let x = 0; x <= 512; x += 6) ctx.lineTo(x, 124 + Math.sin(x * 0.035 + k * 0.6) * (40 + k * 3));
      ctx.stroke();
    }
    ctx.strokeStyle = d.ink;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 492, 228);
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 472, 208);
    // Watermark window with a falcon-like emblem: a simple palm silhouette here.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(400, 124, 62, 80, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = d.ink;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(397, 110, 7, 70);
    for (let i = 0; i < 7; i++) {
      ctx.save();
      ctx.translate(400, 108);
      ctx.rotate(-Math.PI / 2 + (i - 3) * 0.45);
      ctx.beginPath();
      ctx.ellipse(28, 0, 30, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `92px ${DISPLAY_FONT}`;
    ctx.fillText(toArabicDigits(value), 170, 112);
    ctx.font = `34px ${DISPLAY_FONT}`;
    ctx.direction = 'rtl';
    // Arabic counted noun: 5/10 دراهم، 20/50 درهماً، 100+ درهم.
    ctx.fillText(value === 1 || value >= 100 ? 'درهم' : value <= 10 ? 'دراهم' : 'درهماً', 170, 182);
    ctx.direction = 'ltr';
    ctx.font = `600 30px ${BODY_FONT}`;
    ctx.fillText(String(value), 52, 44);
    ctx.fillText(String(value), 460, 214);
    return finish(c);
  });
}

/** Round coin face. */
export function coinTexture(): Texture {
  return cached('coin', () => {
    const [c, ctx] = canvas(128, 128);
    const g = ctx.createRadialGradient(54, 50, 10, 64, 64, 64);
    g.addColorStop(0, '#f4f5f7');
    g.addColorStop(1, '#a8adb3');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7b8086';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#5d6268';
    ctx.font = `56px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('١', 64, 66);
    return finish(c);
  });
}

// ---------------------------------------------------------------------------
// Vegetation and small things
// ---------------------------------------------------------------------------

/** Palm frond with transparent background (alpha-tested). */
export function frondTexture(): Texture {
  return cached('frond', () => {
    const [c, ctx] = canvas(256, 64);
    ctx.clearRect(0, 0, 256, 64);
    ctx.strokeStyle = '#6b6a2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 32);
    ctx.lineTo(256, 32);
    ctx.stroke();
    for (let x = 6; x < 250; x += 7) {
      const len = 28 * Math.sin((x / 256) * Math.PI) + 4;
      for (const dir of [-1, 1]) {
        ctx.strokeStyle = (x / 7) % 2 ? '#4f7a2a' : '#5e8a33';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, 32);
        ctx.lineTo(x + 14, 32 + dir * len);
        ctx.stroke();
      }
    }
    const t = finish(c);
    return t;
  });
}

export function leafClusterTexture(): Texture {
  return cached('leaves', () => {
    const [c, ctx] = canvas(128, 128);
    const rng = new Rng(91);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rng.pick(['#4d7a33', '#5f8f3a', '#3f6a2a', '#6f9f45']);
      ctx.beginPath();
      ctx.ellipse(rng.range(8, 120), rng.range(8, 120), rng.range(3, 7), rng.range(2, 4), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

/** Palm trunk: overlapping frond scars. */
export function barkTexture(): Texture {
  return cached('bark', () => {
    const [c, ctx] = canvas(128, 256);
    ctx.fillStyle = '#7a5b3c';
    ctx.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 256; y += 16) {
      for (let x = (y / 16) % 2 ? 0 : 16; x < 128; x += 32) {
        ctx.fillStyle = '#5e432a';
        ctx.beginPath();
        ctx.moveTo(x, y + 14);
        ctx.lineTo(x + 16, y);
        ctx.lineTo(x + 32, y + 14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#8f6c48';
        ctx.fillRect(x + 4, y + 10, 24, 3);
      }
    }
    return finish(c, true);
  });
}

/** Soft round glow sprite for lamps and markers. */
export function glowTexture(): Texture {
  return cached('glow', () => {
    const [c, ctx] = canvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return finish(c);
  });
}

/** A label drawn on a transparent canvas, for floating icons above things. */
export function iconTexture(glyph: string, bg = 'rgba(255,255,255,0.92)'): Texture {
  return cached('icon' + glyph + bg, () => {
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `64px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 70);
    return finish(c);
  });
}

/** House number plate. */
export function plateTexture(text: string): Texture {
  return cached('plate' + text, () => {
    const [c, ctx] = canvas(128, 64);
    ctx.fillStyle = '#1f4f7a';
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 120, 56);
    ctx.fillStyle = '#fff';
    ctx.font = `34px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 34);
    return finish(c);
  });
}
