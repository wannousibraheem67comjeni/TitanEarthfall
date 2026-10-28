/**
 * The goods themselves, at their real sizes: half-litre water bottles, fizzy cans, milk
 * jugs, crisp packets with crimped seals, tins of tuna, trays of thirty eggs, rice
 * sacks, honey jars, television boxes. Each has a printed label (a made-up brand, the
 * product name, the size, a barcode). The same models stock the shelves, thousands at
 * a time through instancing, and land on the desk one by one.
 */
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, LatheGeometry, type Material, Matrix4, Mesh, MeshStandardMaterial, SphereGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Product } from '../game/economy';
import { BODY_FONT, cached, canvas, cardboard, DISPLAY_FONT, shade, toTexture } from './textures';

export interface Part {
  geometry: BufferGeometry;
  material: Material | Material[];
}

export interface Model {
  parts: Part[];
  /** Width (x), height (y), depth (z), in metres. */
  size: Vector3;
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

const mats = new Map<string, MeshStandardMaterial>();
export function mat(color: string, rough = 0.6, metal = 0, opts: { opacity?: number; emissive?: string; side?: boolean } = {}): MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${opts.opacity ?? 1}|${opts.emissive ?? ''}|${opts.side ?? false}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color: new Color(color), roughness: rough, metalness: metal });
    if (opts.opacity !== undefined && opts.opacity < 1) {
      m.transparent = true;
      m.opacity = opts.opacity;
      m.depthWrite = false;
    }
    if (opts.emissive) {
      m.emissive = new Color(opts.emissive);
      m.emissiveIntensity = 1;
    }
    if (opts.side) m.side = DoubleSide;
    mats.set(key, m);
  }
  return m;
}

const clearPlastic = () => mat('#d8eef7', 0.06, 0, { opacity: 0.38 });
const film = () => mat('#ffffff', 0.05, 0, { opacity: 0.22 });

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function luminance(hex: string): number {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function shortName(p: Product): string {
  return p.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
}

/** Size printed on the pack, from the name ("١ لتر" → "1L") or a sensible default. */
function sizeText(p: Product): string {
  const m: Record<string, string> = { water: '500 ml', milk: '1 L', laban: '1 L', oil: '1.8 L', juice: '200 ml', cola: '330 ml', sugar: '1 kg', rice: '5 kg', ricesack: '40 kg', tea: '100 bags', eggs: '30 pcs', tuna: '185 g', cheese: '16 pcs', pasta: '400 g', coffee: '500 g', dates: '1 kg', honey: '500 g', chips: '45 g', biscuit: '120 g', perfume: '100 ml', shampoo: '400 ml', soap: '1.5 L', card: '50 AED', watercase: '24 × 500 ml' };
  return m[p.id] ?? '';
}

function barcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = '#111';
  let s = seed;
  for (let i = 0; i < w; ) {
    s = (s * 9301 + 49297) % 233280;
    const bw = 1 + (s % 3);
    if ((s >> 3) % 2) ctx.fillRect(x + i, y, bw, h);
    i += bw + 1;
  }
}

function seedOf(p: Product): number {
  let h = 7;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) % 100000;
  return h;
}

/**
 * A printed label. `w`×`h` in pixels; the design adapts: brand on a band, product name,
 * a coloured swoosh, the size in a roundel, and a barcode.
 */
export function labelTexture(p: Product, w = 512, h = 256): CanvasTexture2 {
  return cached(`label${p.id}${w}x${h}`, () => {
    const [c, ctx] = canvas(w, h);
    const base = p.color;
    const light = luminance(base) > 0.6;
    const ink = light ? '#1f2a44' : '#ffffff';
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, shade(base, 0.12));
    g.addColorStop(1, shade(base, -0.18));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // A swoosh across the label.
    ctx.fillStyle = light ? 'rgba(232,80,143,0.22)' : 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    ctx.bezierCurveTo(w * 0.3, h * 0.55, w * 0.7, h * 0.95, w, h * 0.7);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    const cx = w / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    if (p.brand) {
      // Brand in a white oval.
      ctx.fillStyle = light ? '#e8508f' : '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.24, Math.min(w * 0.36, 180), h * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = light ? '#ffffff' : base;
      fitText(ctx, p.brand, cx, h * 0.25, Math.min(w * 0.62, 320), Math.round(h * 0.17), DISPLAY_FONT);
    }
    ctx.fillStyle = ink;
    fitText(ctx, shortName(p), cx, h * (p.brand ? 0.53 : 0.4), w * 0.86, Math.round(h * 0.2), DISPLAY_FONT);
    const sz = sizeText(p);
    if (sz) {
      ctx.direction = 'ltr';
      ctx.fillStyle = light ? '#1f2a44' : 'rgba(255,255,255,0.92)';
      ctx.font = `600 ${Math.round(h * 0.09)}px ${BODY_FONT}`;
      ctx.fillText(sz, cx, h * 0.72);
    }
    barcode(ctx, w * 0.06, h * 0.8, Math.round(w * 0.16), Math.round(h * 0.12), seedOf(p));
    return toTexture(c);
  });
}
type CanvasTexture2 = ReturnType<typeof toTexture>;

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string): void {
  let s = size;
  do {
    ctx.font = `${s}px ${font}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 8);
  ctx.fillText(text, x, y);
}

const labelMat = (p: Product, w?: number, h?: number, rough = 0.45, metal = 0) =>
  cached(`lm${p.id}${w}${h}${rough}${metal}`, () => new MeshStandardMaterial({ map: labelTexture(p, w, h), roughness: rough, metalness: metal }));

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A lathe from (radius, height) pairs, base at y = 0. */
function lathe(points: [number, number][], seg = 18): LatheGeometry {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    seg,
  );
}

/** A box with its base at y = 0. Faces: +x, −x, +y, −y, +z (front), −z. */
function boxAt(w: number, h: number, d: number, segs = 1): BoxGeometry {
  const g = new BoxGeometry(w, h, d, segs, segs, segs);
  g.translate(0, h / 2, 0);
  return g;
}

/** Puff a box into a pillow pack: sealed edges at top and bottom, bulging in the middle. */
function pillow(w: number, h: number, d: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d, 10, 14, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2);
    const y = pos.getY(i) / (h / 2);
    const z = pos.getZ(i);
    const seal = Math.max(0, Math.abs(y) - 0.82) / 0.18;
    const bulge = (1 - Math.pow(Math.abs(x), 4)) * (1 - seal) * Math.cos((y * Math.PI) / 2.3);
    pos.setZ(i, Math.sign(z) * (0.004 + (d / 2) * Math.max(0, bulge)));
    pos.setX(i, x * (w / 2) * (1 - 0.05 * (1 - seal) * Math.abs(y)));
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return g;
}

/** A soft sack: rounded corners, bellied sides. */
function sack(w: number, h: number, d: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d, 8, 10, 6);
  const pos = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = v.x / (w / 2);
    const ny = v.y / (h / 2);
    const nz = v.z / (d / 2);
    const belly = 1 + 0.12 * (1 - ny * ny) * (1 - nx * nx);
    const round = 1 - 0.18 * Math.pow(Math.abs(nx * ny), 2) - 0.1 * Math.pow(Math.abs(nz * ny), 2);
    pos.setXYZ(i, v.x * round, v.y * (ny > 0 ? 1 - 0.05 * nx * nx : 1), v.z * belly * round);
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return g;
}

function merge(geos: BufferGeometry[]): BufferGeometry {
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    n.clearGroups();
    return n;
  });
  return mergeGeometries(clean, false)!;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function model(p: Product): Model {
  const c = p.color;
  switch (p.pack) {
    case 'water': {
      const H = 0.205;
      const body = lathe([
        [0.0, 0],
        [0.03, 0.002],
        [0.032, 0.02],
        [0.03, 0.05],
        [0.032, 0.08],
        [0.032, 0.14],
        [0.026, 0.17],
        [0.013, 0.188],
        [0.012, H],
      ]);
      const label = new CylinderGeometry(0.0325, 0.0325, 0.05, 18, 1, true).translate(0, 0.11, 0);
      const cap = new CylinderGeometry(0.014, 0.014, 0.014, 12).translate(0, H + 0.006, 0);
      return { parts: [{ geometry: body, material: clearPlastic() }, { geometry: label, material: labelMat(p, 512, 128) }, { geometry: cap, material: mat('#1f6fd0', 0.4) }], size: new Vector3(0.065, H + 0.013, 0.065) };
    }
    case 'bottle': {
      // Oil, detergent and shampoo bottles: an opaque body in the product colour.
      const tall = p.id === 'oil' ? 0.3 : p.id === 'soap' ? 0.28 : 0.22;
      const r = p.id === 'oil' ? 0.048 : p.id === 'soap' ? 0.05 : 0.036;
      const body = lathe([
        [0, 0],
        [r * 0.94, 0.003],
        [r, 0.02],
        [r, tall * 0.7],
        [r * 0.8, tall * 0.82],
        [r * 0.38, tall * 0.92],
        [r * 0.34, tall],
      ]);
      body.scale(1, 1, p.id === 'oil' ? 1 : 0.62);
      const label = new CylinderGeometry(r * 1.01, r * 1.01, tall * 0.42, 18, 1, true).translate(0, tall * 0.38, 0).scale(1, 1, p.id === 'oil' ? 1 : 0.62);
      const cap = new CylinderGeometry(r * 0.36, r * 0.36, 0.025, 12).translate(0, tall + 0.012, 0);
      const bodyMat = p.id === 'oil' ? mat('#e2b33a', 0.08, 0, { opacity: 0.8 }) : mat(c, 0.35);
      return { parts: [{ geometry: body, material: bodyMat }, { geometry: label, material: labelMat(p, 512, 256) }, { geometry: cap, material: mat(p.id === 'oil' ? '#c62828' : '#f4f4f4', 0.4) }], size: new Vector3(r * 2, tall + 0.025, r * 2 * (p.id === 'oil' ? 1 : 0.62)) };
    }
    case 'jug': {
      const H = p.id === 'milk' ? 0.24 : 0.2;
      const r = 0.045;
      const body = lathe([
        [0, 0],
        [r * 0.9, 0.002],
        [r, 0.02],
        [r, H * 0.75],
        [r * 0.55, H * 0.9],
        [r * 0.4, H],
      ]);
      body.scale(1, 1, 0.9);
      const label = new CylinderGeometry(r * 1.01, r * 1.01, H * 0.4, 18, 1, true).translate(0, H * 0.4, 0).scale(1, 1, 0.9);
      const cap = new CylinderGeometry(r * 0.42, r * 0.42, 0.02, 12).translate(0, H + 0.01, 0);
      return { parts: [{ geometry: body, material: mat('#f7f7f4', 0.4) }, { geometry: label, material: labelMat(p, 512, 256) }, { geometry: cap, material: mat(p.id === 'milk' ? '#1f6fd0' : '#2e9e5b', 0.4) }], size: new Vector3(r * 2, H + 0.02, r * 1.8) };
    }
    case 'can': {
      const H = 0.122;
      const side = new CylinderGeometry(0.033, 0.033, H - 0.016, 20, 1, true).translate(0, H / 2, 0);
      const ends = merge([new CylinderGeometry(0.028, 0.033, 0.008, 20).translate(0, H - 0.004, 0), new CylinderGeometry(0.033, 0.028, 0.008, 20).translate(0, 0.004, 0)]);
      return { parts: [{ geometry: side, material: labelMat(p, 512, 256, 0.3, 0.5) }, { geometry: ends, material: mat('#c9ccd0', 0.25, 1) }], size: new Vector3(0.066, H, 0.066) };
    }
    case 'tin': {
      const H = 0.045;
      const side = new CylinderGeometry(0.043, 0.043, H - 0.006, 20, 1, true).translate(0, H / 2, 0);
      const ends = merge([new CylinderGeometry(0.041, 0.043, 0.004, 20).translate(0, H - 0.002, 0), new CylinderGeometry(0.043, 0.041, 0.004, 20).translate(0, 0.002, 0)]);
      return { parts: [{ geometry: side, material: labelMat(p, 512, 128, 0.35, 0.3) }, { geometry: ends, material: mat('#c9ccd0', 0.25, 1) }], size: new Vector3(0.086, H, 0.086) };
    }
    case 'carton': {
      const box = boxAt(0.062, 0.105, 0.04);
      const straw = new CylinderGeometry(0.0025, 0.0025, 0.06, 6).rotateZ(0.25).translate(0.012, 0.125, -0.008);
      const side = mat(shade(c, -0.05), 0.5);
      return { parts: [{ geometry: box, material: [side, side, mat('#f2f2ee', 0.5), side, labelMat(p, 256, 384), labelMat(p, 256, 384)] }, { geometry: straw, material: mat('#ffffff', 0.4) }], size: new Vector3(0.062, 0.13, 0.04) };
    }
    case 'box':
    case 'flatbox': {
      const dims: Record<string, [number, number, number]> = {
        tea: [0.13, 0.17, 0.08],
        cheese: [0.12, 0.05, 0.12],
        dates: [0.2, 0.08, 0.14],
        toy: [0.25, 0.22, 0.1],
        headphones: [0.18, 0.2, 0.08],
        biscuit: [0.06, 0.14, 0.035],
        icecream: [0.07, 0.03, 0.18],
        charger: [0.09, 0.14, 0.04],
      };
      const [w, h, d] = dims[p.id] ?? [0.12, 0.16, 0.06];
      const side = mat(c, 0.55);
      const front = labelMat(p, 256, Math.min(512, Math.max(96, Math.round((256 * h) / w))));
      return { parts: [{ geometry: boxAt(w, h, d), material: [side, side, side, side, front, front] }], size: new Vector3(w, h, d) };
    }
    case 'pillow': {
      const dims: Record<string, [number, number, number]> = { chips: [0.15, 0.21, 0.07], sugar: [0.13, 0.2, 0.07], pasta: [0.11, 0.22, 0.05], coffee: [0.12, 0.2, 0.07] };
      const [w, h, d] = dims[p.id] ?? [0.14, 0.2, 0.06];
      const g = pillow(w, h, d);
      const side = mat(c, 0.4);
      const front = labelMat(p, 256, 384, 0.3);
      return { parts: [{ geometry: g, material: [side, side, side, side, front, front] }], size: new Vector3(w, h, d) };
    }
    case 'bread': {
      const discs: BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) discs.push(new CylinderGeometry(0.105, 0.105, 0.008, 22).translate(0, 0.006 + i * 0.008, 0));
      const bag = new CylinderGeometry(0.112, 0.112, 0.05, 22).translate(0, 0.025, 0);
      const label = boxAt(0.09, 0.002, 0.05).translate(0, 0.05, 0);
      return { parts: [{ geometry: merge(discs), material: mat('#dcb27a', 0.85) }, { geometry: bag, material: film() }, { geometry: label, material: labelMat(p, 256, 128) }], size: new Vector3(0.22, 0.052, 0.22) };
    }
    case 'sack': {
      const dims: Record<string, [number, number, number]> = { rice: [0.28, 0.4, 0.12], ricesack: [0.5, 0.75, 0.24], diapers: [0.3, 0.3, 0.16] };
      const [w, h, d] = dims[p.id] ?? [0.28, 0.4, 0.12];
      const side = mat(shade(c, -0.05), 0.75);
      const front = labelMat(p, 384, Math.round((384 * h) / w), 0.7);
      return { parts: [{ geometry: sack(w, h, d), material: [side, side, side, side, front, front] }], size: new Vector3(w, h, d * 1.2) };
    }
    case 'eggs': {
      const tray = boxAt(0.3, 0.035, 0.3);
      const eggs: BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) eggs.push(new SphereGeometry(0.021, 8, 6).scale(1, 1.25, 1).translate(-0.125 + i * 0.05, 0.045, -0.1 + j * 0.05));
      return { parts: [{ geometry: tray, material: mat('#a9a49a', 0.95) }, { geometry: merge(eggs), material: mat('#e9cfa9', 0.55) }], size: new Vector3(0.3, 0.07, 0.3) };
    }
    case 'tray': {
      const tray = boxAt(0.24, 0.025, 0.17);
      const meat = p.id === 'fish' ? new SphereGeometry(0.1, 16, 8).scale(1, 0.2, 0.35).translate(0, 0.03, 0) : boxAt(0.19, 0.03, 0.12, 3).translate(0, 0.018, 0);
      const wrap = boxAt(0.242, 0.055, 0.172);
      const sticker = boxAt(0.08, 0.002, 0.05).translate(0.05, 0.055, 0.03);
      return { parts: [{ geometry: tray, material: mat('#f4f4f2', 0.6) }, { geometry: meat, material: p.id === 'fish' ? mat('#9fb4bf', 0.25, 0.4) : mat('#a8322b', 0.55) }, { geometry: wrap, material: film() }, { geometry: sticker, material: labelMat(p, 256, 160) }], size: new Vector3(0.24, 0.056, 0.17) };
    }
    case 'produce': {
      const balls: BufferGeometry[] = [];
      const r = p.id === 'apple' ? 0.038 : 0.033;
      const spots: [number, number, number][] = [
        [-0.04, r, -0.02],
        [0.035, r, -0.025],
        [0, r, 0.035],
        [-0.005, r * 2.6, 0],
        [0.045, r, 0.04],
      ];
      for (const [x, y, z] of spots) balls.push(new SphereGeometry(r, 14, 10).scale(1, 0.9, 1).translate(x, y, z));
      const bag = new SphereGeometry(0.09, 14, 10).scale(1, 0.9, 1).translate(0, 0.065, 0);
      return { parts: [{ geometry: merge(balls), material: mat(c, 0.35) }, { geometry: bag, material: film() }], size: new Vector3(0.18, 0.16, 0.18) };
    }
    case 'jar': {
      const body = lathe([
        [0, 0],
        [0.04, 0.002],
        [0.042, 0.02],
        [0.042, 0.1],
        [0.036, 0.11],
        [0.034, 0.115],
      ]);
      const lid = new CylinderGeometry(0.037, 0.037, 0.02, 20).translate(0, 0.124, 0);
      const label = new CylinderGeometry(0.0425, 0.0425, 0.05, 20, 1, true).translate(0, 0.055, 0);
      return { parts: [{ geometry: body, material: mat('#c97a10', 0.08, 0, { opacity: 0.88 }) }, { geometry: lid, material: mat('#d4a73c', 0.3, 1) }, { geometry: label, material: labelMat(p, 512, 192) }], size: new Vector3(0.085, 0.134, 0.085) };
    }
    case 'perfume': {
      const box = boxAt(0.08, 0.14, 0.05);
      const side = mat('#1c1a1f', 0.35);
      return { parts: [{ geometry: box, material: [side, side, mat('#c9a54a', 0.3, 1), side, labelMat(p, 192, 320, 0.3), labelMat(p, 192, 320, 0.3)] }], size: new Vector3(0.08, 0.14, 0.05) };
    }
    case 'card': {
      const g = boxAt(0.09, 0.13, 0.006);
      const side = mat('#ffffff', 0.4);
      return { parts: [{ geometry: g, material: [side, side, side, side, labelMat(p, 192, 256, 0.3), side] }], size: new Vector3(0.09, 0.13, 0.006) };
    }
    case 'folded': {
      const body = boxAt(0.28, 0.06, 0.22, 2);
      const collar = new CylinderGeometry(0.05, 0.05, 0.01, 16, 1, true, 0, Math.PI).rotateY(Math.PI / 2).translate(0, 0.062, -0.08);
      return { parts: [{ geometry: body, material: mat(c, 0.85) }, { geometry: collar, material: mat(shade(c, -0.2), 0.85, 0, { side: true }) }], size: new Vector3(0.28, 0.07, 0.22) };
    }
    case 'bigbox': {
      const dims: Record<string, [number, number, number]> = { tv: [1.25, 0.8, 0.16], bike: [0.95, 0.58, 0.25], pots: [0.48, 0.32, 0.32], oilcase: [0.38, 0.3, 0.28], datesbox: [0.42, 0.16, 0.3] };
      const [w, h, d] = dims[p.id] ?? [0.5, 0.4, 0.3];
      const kraft = cached('kraftmat', () => new MeshStandardMaterial({ map: cardboard().map, roughness: 0.9 }));
      const front = labelMat(p, 512, Math.max(128, Math.round((512 * h) / w)), 0.6);
      return { parts: [{ geometry: boxAt(w, h, d), material: [kraft, kraft, kraft, kraft, front, front] }], size: new Vector3(w, h, d) };
    }
    case 'case': {
      const bottles: BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) bottles.push(new CylinderGeometry(0.031, 0.031, 0.2, 10).translate(-0.165 + i * 0.066, 0.1, -0.1 + j * 0.066));
      const caps: BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) caps.push(new CylinderGeometry(0.013, 0.013, 0.014, 8).translate(-0.165 + i * 0.066, 0.207, -0.1 + j * 0.066));
      const wrap = boxAt(0.4, 0.215, 0.27);
      const band = boxAt(0.402, 0.06, 0.272).translate(0, 0.07, 0);
      return {
        parts: [
          { geometry: merge(bottles), material: mat('#cfe9f6', 0.08, 0, { opacity: 0.55 }) },
          { geometry: merge(caps), material: mat('#1f6fd0', 0.4) },
          { geometry: band, material: labelMat(p, 512, 96) },
          { geometry: wrap, material: film() },
        ],
        size: new Vector3(0.4, 0.215, 0.27),
      };
    }
    case 'folder': {
      const g = boxAt(0.32, 0.025, 0.24);
      const paper = boxAt(0.3, 0.004, 0.22).translate(0.006, 0.026, 0);
      return { parts: [{ geometry: g, material: mat(c, 0.6) }, { geometry: paper, material: mat('#fbfbf8', 0.8) }], size: new Vector3(0.32, 0.03, 0.24) };
    }
    case 'chicken': {
      const body = new SphereGeometry(0.1, 16, 12).scale(1, 0.55, 0.7).translate(0, 0.055, 0);
      const bag = new SphereGeometry(0.106, 16, 12).scale(1, 0.6, 0.74).translate(0, 0.058, 0);
      const label = boxAt(0.1, 0.002, 0.07).translate(0, 0.118, 0);
      return { parts: [{ geometry: body, material: mat('#ecd3b4', 0.45) }, { geometry: bag, material: mat('#ffffff', 0.15, 0, { opacity: 0.35 }) }, { geometry: label, material: labelMat(p, 256, 176) }], size: new Vector3(0.2, 0.12, 0.15) };
    }
    case 'gum': {
      const side = mat(c, 0.4);
      return { parts: [{ geometry: boxAt(0.075, 0.02, 0.018), material: [side, side, side, side, labelMat(p, 256, 96), labelMat(p, 256, 96)] }], size: new Vector3(0.075, 0.02, 0.018) };
    }
  }
}

const models = new Map<string, Model>();

export function productModel(p: Product): Model {
  let m = models.get(p.id);
  if (!m) models.set(p.id, (m = model(p)));
  return m;
}

/** One item as a movable object (on the desk, in a hand). */
export function productObject(p: Product): Group {
  const g = new Group();
  for (const part of productModel(p).parts) {
    const mesh = new Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.userData.size = productModel(p).size;
  return g;
}

/** Collects shelf placements per product, then builds one instanced mesh per model part. */
export class Stocker {
  private readonly placed = new Map<Product, Matrix4[]>();

  add(p: Product, m: Matrix4): void {
    let list = this.placed.get(p);
    if (!list) this.placed.set(p, (list = []));
    list.push(m.clone());
  }

  get count(): number {
    let n = 0;
    for (const l of this.placed.values()) n += l.length;
    return n;
  }

  build(shadows: boolean): Group {
    const g = new Group();
    g.name = 'stock';
    for (const [p, list] of this.placed) {
      for (const part of productModel(p).parts) {
        const im = new InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = shadows && list.length < 400;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        g.add(im);
      }
    }
    return g;
  }
}
