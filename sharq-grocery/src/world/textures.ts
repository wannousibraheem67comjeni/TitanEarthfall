/** Canvas-drawn textures: the shop sign, floor tiles, marble, and product labels. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

export const DISPLAY_FONT = "'Lalezar', 'Readex Pro', 'Noto Kufi Arabic', 'Segoe UI', Tahoma, sans-serif";
export const BODY_FONT = "'Readex Pro', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const cache = new Map<string, CanvasTexture>();
function cached(key: string, make: () => CanvasTexture): CanvasTexture {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
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

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** The shop's name board: Arabic in the display face, English underneath. */
export function signTexture(text: string, bg: string, fg: string, sub = ''): CanvasTexture {
  const [c, ctx] = canvas(1024, 220);
  const g = ctx.createLinearGradient(0, 0, 0, 220);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, -0.3));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 220);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 7;
  ctx.strokeRect(12, 12, 1000, 196);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;
  fitText(ctx, text, 512, sub ? 96 : 110, 930, 120, DISPLAY_FONT);
  if (sub) {
    ctx.shadowBlur = 0;
    ctx.direction = 'ltr';
    ctx.font = `600 32px ${BODY_FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, 512, 182);
  }
  return finish(c);
}

export function tileTexture(a: string, b: string): CanvasTexture {
  return cached(`tile${a}${b}`, () => {
    const [c, ctx] = canvas(128, 128);
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        ctx.fillStyle = (x + y) % 2 ? a : b;
        ctx.fillRect(x * 64, y * 64, 64, 64);
      }
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 128; i += 64) {
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

/** Polished marble with soft veins, for the top stage. */
export function marbleTexture(): CanvasTexture {
  return cached('marble', () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#f2efe9';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(150,140,130,0.35)';
    for (let i = 0; i < 14; i++) {
      ctx.lineWidth = 0.6 + Math.random() * 1.6;
      ctx.beginPath();
      let x = Math.random() * 256;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < 256) {
        x += (Math.random() - 0.5) * 30;
        y += 12 + Math.random() * 20;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(200,170,90,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256);
    return finish(c, true);
  });
}

/** A screen showing the branch map on the east coast. */
export function branchesTexture(): CanvasTexture {
  return cached('branches', () => {
    const [c, ctx] = canvas(512, 288);
    const g = ctx.createLinearGradient(0, 0, 0, 288);
    g.addColorStop(0, '#0f2a44');
    g.addColorStop(1, '#16385a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 288);
    // A stylised coast line.
    ctx.strokeStyle = '#4fb3ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(330, 20);
    ctx.bezierCurveTo(300, 90, 360, 150, 320, 270);
    ctx.stroke();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = `600 22px ${BODY_FONT}`;
    const towns: [string, number, number][] = [
      ['دبا', 318, 42],
      ['خورفكان', 334, 120],
      ['الفجيرة', 338, 190],
      ['كلباء', 322, 252],
    ];
    for (const [name, x, y] of towns) {
      ctx.fillStyle = '#ff5fa2';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, x - 18, y + 7);
    }
    ctx.textAlign = 'center';
    ctx.font = `30px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#ffd6e8';
    ctx.fillText('فروعنا', 130, 60);
    ctx.font = `500 18px ${BODY_FONT}`;
    ctx.fillStyle = '#cfe6ff';
    ctx.fillText('شرق الإمارات', 130, 92);
    return finish(c);
  });
}
