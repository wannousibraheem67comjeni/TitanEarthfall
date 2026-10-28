/**
 * The shop, seen from the till at the back: a glass shopfront with the door straight
 * ahead and the street beyond, metal shelving stocked product by product with price
 * tags on every shelf edge, drinks fridges with lit glass doors, an ice-cream chest,
 * a fruit stand, posters, an air conditioner, a wall clock that keeps shop time, and
 * a suspended ceiling with LED panels. Rebuilt for every stage, from a kiosk to a
 * flagship store.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
} from 'three';
import { PRODUCTS, STAGES, stocked, type Product } from '../game/economy';
import { Batcher, worldBox } from './batch';
import { buildDesk, type Desk } from './desk';
import { mat, productModel, Stocker } from './products';
import { buildStreet, type Street } from './street';
import { BODY_FONT, brushed, cached, canvas, ceilingTiles, clockFace, DISPLAY_FONT, doorSticker, hoursSticker, paintedWall, porcelainFloor, poster, quartz, signTexture, toTexture, wood, type Surface } from './textures';

export interface Pick {
  /** Where to stand, which way to face, and how high the shelf is (for the reach). */
  at: Vector3;
  face: number;
  shelfY: number;
}

export interface ShopLayout {
  w: number;
  d: number;
  h: number;
  /** Desk centre (z), top height, the customer-side edge, half its width. */
  deskZ: number;
  deskTop: number;
  deskFront: number;
  deskHalf: number;
  /** Where the customer at the desk stands, and the line behind them. */
  spot: Vector3;
  queue(i: number): Vector3;
  /** Just inside and just outside the door, and the pavement line people walk along. */
  door: Vector3;
  doorOut: Vector3;
  walkZ: number;
  /** Cross aisles near the shopfront and in front of the desk. */
  frontZ: number;
  backZ: number;
  picks: Pick[];
  camera: { pos: Vector3; look: Vector3 };
}

export interface Door {
  pivot: Object3D;
  /** +1 opens outward to the right, −1 to the left. */
  dir: number;
  open: number;
  at: Vector3;
}

export interface Shop {
  group: Group;
  layout: ShopLayout;
  desk: Desk;
  street: Street;
  doors: Door[];
  clockHands: { hour: Object3D; minute: Object3D };
  /** Lights that stay on day and night. */
  lights: (PointLight | SpotLight)[];
  update(dt: number, minute: number, night: number, people: Vector3[]): void;
}

const SIZES: [number, number, number][] = [
  [3.8, 4.8, 2.9],
  [5.4, 6.2, 3.0],
  [7.2, 7.6, 3.1],
  [9.2, 9.2, 3.3],
  [12.4, 11, 3.6],
  [15.4, 13, 4.0],
  [15.4, 13, 4.0],
  [17.6, 14, 4.4],
];

/** A physically based material from a painted surface, tiled every `size` metres in world UVs. */
function surfaceMat(s: Surface, rough = 0.8, metal = 0, envI = 1): MeshStandardMaterial {
  return cached(`sm${s.map.uuid}${rough}${metal}`, () => {
    const m = new MeshStandardMaterial({ map: s.map, roughness: rough, metalness: metal });
    if (s.roughnessMap) m.roughnessMap = s.roughnessMap;
    if (s.normalMap) m.normalMap = s.normalMap;
    m.envMapIntensity = envI;
    return m;
  });
}

const metalWhite = () => mat('#eceeef', 0.42, 0.35);
const alu = () => cached('alu', () => new MeshStandardMaterial({ color: '#c4c8cc', roughness: 0.32, metalness: 1, roughnessMap: brushed() }));
const glassMat = () => mat('#d7ecf2', 0.03, 0.1, { opacity: 0.16 });

// ---------------------------------------------------------------------------
// Price tags: one atlas for every product, drawn the way shelf labels look.
// ---------------------------------------------------------------------------

class TagAtlas {
  private readonly index = new Map<Product, number>();
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  static readonly COLS = 8;
  static readonly ROWS = 8;
  private static readonly W = 160;
  private static readonly H = 80;

  constructor() {
    const [c, ctx] = canvas(TagAtlas.COLS * TagAtlas.W, TagAtlas.ROWS * TagAtlas.H);
    this.ctx = ctx;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    PRODUCTS.forEach((p, i) => this.draw(p, i));
    this.texture = toTexture(c);
  }

  private draw(p: Product, i: number): void {
    const { ctx } = this;
    const x = (i % TagAtlas.COLS) * TagAtlas.W;
    const y = Math.floor(i / TagAtlas.COLS) * TagAtlas.H;
    this.index.set(p, i);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, TagAtlas.W, TagAtlas.H);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(x, y, 56, TagAtlas.H);
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 34px ${BODY_FONT}`;
    const price = p.price >= 1000 ? `${p.price / 1000}k` : Number.isInteger(p.price) ? String(p.price) : p.price.toFixed(2);
    ctx.fillText(price, x + 28, y + 36);
    ctx.font = `500 13px ${BODY_FONT}`;
    ctx.fillText('درهم', x + 28, y + 64);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = `600 17px ${BODY_FONT}`;
    const name = p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name;
    ctx.fillText(name, x + TagAtlas.W - 8, y + 26);
    ctx.fillStyle = '#666';
    ctx.font = `400 12px ${BODY_FONT}`;
    ctx.fillText('شامل الضريبة', x + TagAtlas.W - 8, y + 54);
    ctx.direction = 'ltr';
    ctx.strokeStyle = '#ddd';
    ctx.strokeRect(x + 0.5, y + 0.5, TagAtlas.W - 1, TagAtlas.H - 1);
  }

  /** A small tag quad facing +z, UVs pointing at the product's cell. */
  quad(p: Product): PlaneGeometry {
    const i = this.index.get(p) ?? 0;
    const g = new PlaneGeometry(0.075, 0.0375);
    const u0 = (i % TagAtlas.COLS) / TagAtlas.COLS;
    const v1 = 1 - Math.floor(i / TagAtlas.COLS) / TagAtlas.ROWS;
    const u1 = u0 + 1 / TagAtlas.COLS;
    const v0 = v1 - 1 / TagAtlas.ROWS;
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
    return g;
  }
}

const tags = () => cached('tags', () => new TagAtlas());
const tagMat = () => cached('tagmat', () => new MeshStandardMaterial({ map: tags().texture, roughness: 0.5 }));

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const up = new Vector3(0, 1, 0);

/** Shelving along z between z0 and z1. `side` is the way the shelf faces (+1 → +x). */
function shelfRun(b: Batcher, stock: Stocker, xBack: number, z0: number, z1: number, side: 1 | -1, levels: number[], depth: number, pool: Product[], seed: number): void {
  const len = z1 - z0;
  const xFront = xBack + side * depth;
  const top = levels[levels.length - 1] + 0.42;
  const frame = metalWhite();
  // Back panel, base plinth, uprights.
  b.boxMinMax(Math.min(xBack, xBack + side * 0.03), 0, z0, Math.max(xBack, xBack + side * 0.03), top, z1, frame, 1, 1);
  b.boxMinMax(Math.min(xBack, xFront), 0, z0, Math.max(xBack, xFront), 0.1, z1, mat('#d9dcde', 0.5, 0.3), 1, 1);
  for (const z of [z0, z1]) b.boxMinMax(Math.min(xBack, xFront), 0, z - 0.02, Math.max(xBack, xFront), top, z + 0.02, mat('#d0d4d7', 0.45, 0.4), 1, 1);
  const yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  tmpQ.setFromAxisAngle(up, yaw);
  let k = seed;
  levels.forEach((y, li) => {
    // The shelf plate and the price-tag strip on its front edge.
    b.boxMinMax(Math.min(xBack, xFront), y - 0.018, z0 + 0.02, Math.max(xBack, xFront), y, z1 - 0.02, mat('#e6e8ea', 0.4, 0.3), 1, 1);
    const stripX = xFront + side * 0.004;
    b.boxMinMax(Math.min(stripX, xFront), y - 0.045, z0 + 0.02, Math.max(stripX, xFront), y, z1 - 0.02, mat('#c9ced2', 0.4, 0.4), 1, 1);
    const room = (levels[li + 1] ?? top + 0.35) - y - 0.03;
    let z = z0 + 0.04;
    let guard = 0;
    while (z < z1 - 0.12 && guard++ < 40) {
      const p = pool[k++ % pool.length];
      const s = productModel(p).size;
      if (s.y > room || s.x > len * 0.6) continue;
      const facings = Math.max(1, Math.min(Math.floor((z1 - 0.04 - z) / (s.x + 0.008)), Math.round(0.34 / (s.x + 0.008)) + (k % 3)));
      if (facings < 1 || z + s.x > z1 - 0.04) break;
      const rows = Math.max(1, Math.min(3, Math.floor((depth - 0.04) / (s.z + 0.006))));
      for (let f = 0; f < facings; f++)
        for (let r = 0; r < rows; r++) {
          const x = xFront - side * (0.02 + s.z / 2 + r * (s.z + 0.006));
          tmpM.compose(new Vector3(x, y, z + s.x / 2 + f * (s.x + 0.008)), tmpQ, new Vector3(1, 1, 1));
          stock.add(p, tmpM);
        }
      // Its tag, on the strip under the first facing.
      const tag = tags().quad(p);
      b.place(tag, tagMat(), stripX + side * 0.002, y - 0.023, z + 0.04, yaw, { cast: false });
      z += facings * (s.x + 0.008) + 0.012;
    }
  });
}

/** An upright drinks fridge with `doors` glass doors, its back against x = xBack. */
function fridge(b: Batcher, stock: Stocker, group: Group, xBack: number, z0: number, doors: number, side: 1 | -1, pool: Product[]): number {
  const W = 0.72;
  const D = 0.72;
  const H = 2.05;
  const len = doors * W;
  const xFront = xBack + side * D;
  const body = mat('#f2f3f4', 0.35, 0.2);
  const x0 = Math.min(xBack, xFront);
  const x1 = Math.max(xBack, xFront);
  b.boxMinMax(x0, 0, z0, x1, 0.12, z0 + len, mat('#2b2d30', 0.6), 1, 1);
  b.boxMinMax(x0, H - 0.22, z0, x1, H, z0 + len, body, 1, 1);
  b.boxMinMax(x0, 0, z0 - 0.03, x1, H, z0, body, 1, 1);
  b.boxMinMax(x0, 0, z0 + len, x1, H, z0 + len + 0.03, body, 1, 1);
  // Lit white inside.
  b.boxMinMax(Math.min(xBack, xBack + side * 0.02), 0.12, z0, Math.max(xBack, xBack + side * 0.02), H - 0.22, z0 + len, mat('#ffffff', 0.5, 0, { emissive: '#dfeeff' }), 1, 1);
  const header = new Mesh(new PlaneGeometry(len - 0.04, 0.16), new MeshStandardMaterial({ map: fridgeHeader(), emissive: '#ffffff', emissiveMap: fridgeHeader(), emissiveIntensity: 0.8 }));
  header.position.set(xFront + side * 0.002, H - 0.11, z0 + len / 2);
  header.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  group.add(header);
  const levels = [0.16, 0.52, 0.88, 1.24, 1.56];
  const yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  tmpQ.setFromAxisAngle(up, yaw);
  let k = 0;
  for (const y of levels) {
    b.boxMinMax(x0 + 0.02, y - 0.012, z0, x1 - 0.06, y, z0 + len, mat('#cfd6dc', 0.3, 0.6), 1, 1);
    for (let dI = 0; dI < doors; dI++) {
      const p = pool[k++ % pool.length];
      const s = productModel(p).size;
      if (s.y > 0.33) continue;
      const n = Math.floor((W - 0.06) / (s.x + 0.006));
      const rows = Math.min(4, Math.floor((D - 0.14) / (s.z + 0.006)));
      for (let f = 0; f < n; f++)
        for (let r = 0; r < rows; r++) {
          const x = xFront - side * (0.07 + s.z / 2 + r * (s.z + 0.006));
          tmpM.compose(new Vector3(x, y, z0 + dI * W + 0.03 + s.x / 2 + f * (s.x + 0.006)), tmpQ, new Vector3(1, 1, 1));
          stock.add(p, tmpM);
        }
    }
  }
  // Glass doors with aluminium frames and long handles.
  for (let dI = 0; dI < doors; dI++) {
    const zc = z0 + dI * W + W / 2;
    const gx = xFront + side * 0.015;
    b.boxMinMax(Math.min(gx, gx + side * 0.03), 0.12, zc - W / 2 + 0.005, Math.max(gx, gx + side * 0.03), 0.17, zc + W / 2 - 0.005, alu(), 1, 1);
    b.boxMinMax(Math.min(gx, gx + side * 0.03), H - 0.27, zc - W / 2 + 0.005, Math.max(gx, gx + side * 0.03), H - 0.22, zc + W / 2 - 0.005, alu(), 1, 1);
    for (const e of [-1, 1]) b.boxMinMax(Math.min(gx, gx + side * 0.03), 0.12, zc + e * (W / 2 - 0.03) - 0.025, Math.max(gx, gx + side * 0.03), H - 0.22, zc + e * (W / 2 - 0.03) + 0.025, alu(), 1, 1);
    const g = new Mesh(new PlaneGeometry(W - 0.06, H - 0.4), glassMat());
    g.position.set(gx + side * 0.016, (H - 0.05) / 2 + 0.07, zc);
    g.rotation.y = yaw;
    g.renderOrder = 2;
    group.add(g);
    b.boxMinMax(Math.min(gx + side * 0.03, gx + side * 0.06), 0.7, zc + W / 2 - 0.09, Math.max(gx + side * 0.03, gx + side * 0.06), 1.5, zc + W / 2 - 0.07, alu(), 1, 1);
  }
  return len;
}

function fridgeHeader(): CanvasTexture {
  return cached('fridgeHeader', () => {
    const [c, ctx] = canvas(512, 64);
    const g = ctx.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0, '#0b5fa5');
    g.addColorStop(1, '#2a9bd6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.font = `40px ${DISPLAY_FONT}`;
    ctx.fillText('مشروبات باردة ❄', 256, 34);
    return toTexture(c);
  });
}

/** A chest freezer with a sliding glass top and ice creams inside. */
function iceFreezer(b: Batcher, stock: Stocker, group: Group, x: number, z: number): void {
  const W = 1.1;
  const D = 0.62;
  const H = 0.85;
  b.boxMinMax(x - W / 2, 0, z - D / 2, x + W / 2, H, z + D / 2, mat('#f7f7f6', 0.3, 0.2), 1, 1);
  b.boxMinMax(x - W / 2 + 0.05, H - 0.02, z - D / 2 + 0.05, x + W / 2 - 0.05, H, z + D / 2 - 0.05, mat('#9fd4ff', 0.2, 0, { emissive: '#3a7fbf' }), 1, 1);
  const side = new Mesh(new PlaneGeometry(W - 0.04, 0.3), new MeshStandardMaterial({ map: iceSign(), roughness: 0.5 }));
  side.position.set(x, 0.45, z - D / 2 - 0.002);
  side.rotation.y = Math.PI;
  group.add(side);
  const ice = PRODUCTS.find((p) => p.id === 'icecream')!;
  const s = productModel(ice).size;
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 2; j++) {
      tmpQ.setFromAxisAngle(up, (i * 0.7 + j) % 0.4);
      tmpM.compose(new Vector3(x - W / 2 + 0.1 + i * (s.x + 0.012), H - 0.12, z - 0.12 + j * 0.2), tmpQ, new Vector3(1, 1, 1));
      stock.add(ice, tmpM);
    }
  const glass = new Mesh(new PlaneGeometry(W - 0.06, D - 0.06), glassMat());
  glass.rotation.x = -Math.PI / 2;
  glass.position.set(x, H + 0.004, z);
  group.add(glass);
}

function iceSign(): CanvasTexture {
  return cached('iceSign', () => {
    const [c, ctx] = canvas(512, 140);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 140);
    ctx.fillStyle = '#e8508f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `76px ${DISPLAY_FONT}`;
    ctx.fillText('آيس كريم 🍦', 256, 72);
    return toTexture(c);
  });
}

/** A tiered fruit and vegetable stand of wooden crates. */
function fruitStand(b: Batcher, group: Group, x: number, z: number): void {
  const crate = cached('crateMat', () => new MeshStandardMaterial({ map: wood('#b98a57').map, roughness: 0.85 }));
  const produce: [string, number, number][] = [
    ['#d8352b', 0.035, 0.9],
    ['#c8302c', 0.04, 0.95],
    ['#f39c12', 0.04, 0.9],
    ['#7bb33d', 0.032, 0.85],
    ['#8a5a2b', 0.034, 0.9],
    ['#f2d14b', 0.03, 1],
  ];
  let k = 0;
  for (let tier = 0; tier < 2; tier++)
    for (let i = 0; i < 3; i++) {
      const cx = x - 0.62 + i * 0.62;
      const cz = z + tier * 0.42;
      const y = 0.55 + (1 - tier) * 0.25;
      b.boxMinMax(cx - 0.28, y - 0.14, cz - 0.19, cx + 0.28, y, cz + 0.19, crate, 0.6, 0.6);
      const [color, r] = produce[k++ % produce.length];
      const balls: number[][] = [];
      for (let a = 0; a < 6; a++) for (let c = 0; c < 4; c++) balls.push([cx - 0.22 + a * 0.085, y + r * 0.6 + ((a + c) % 2) * 0.02, cz - 0.13 + c * 0.085]);
      const geo = new SphereGeometry(r, 10, 8);
      for (const [bx, by, bz] of balls) b.place(geo.clone(), mat(color, 0.35), bx, by, bz, 0, { cast: false });
    }
  // Legs.
  for (const [dx, dz] of [
    [-0.95, -0.2],
    [0.95, -0.2],
    [-0.95, 0.6],
    [0.95, 0.6],
  ])
    b.boxMinMax(x + dx - 0.03, 0, z + dz - 0.03, x + dx + 0.03, 0.75, z + dz + 0.03, mat('#5b4632', 0.8), 1, 1);
  void group;
}

/** Stacked cartons of water on a pallet by the door, as every UAE grocery has. */
function waterStack(stock: Stocker, b: Batcher, x: number, z: number, rows: number): void {
  const p = PRODUCTS.find((q) => q.id === 'watercase')!;
  const s = productModel(p).size;
  b.boxMinMax(x - 0.3, 0, z - 0.42, x + 0.3, 0.12, z + 0.42, mat('#b58b5a', 0.9), 1, 1);
  for (let lvl = 0; lvl < rows; lvl++)
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        tmpQ.setFromAxisAngle(up, Math.PI / 2 + (lvl % 2 ? Math.PI : 0));
        tmpM.compose(new Vector3(x - 0.14 + i * 0.28, 0.12 + lvl * (s.y + 0.002), z - 0.205 + j * 0.41), tmpQ, new Vector3(1, 1, 1));
        stock.add(p, tmpM);
      }
}

function clockMesh(group: Group, x: number, y: number, z: number): { hour: Object3D; minute: Object3D } {
  const face = new Mesh(new CircleGeometry(0.17, 40), new MeshStandardMaterial({ map: clockFace(), roughness: 0.3 }));
  face.position.set(x, y, z);
  group.add(face);
  const rim = new Mesh(new TorusGeometry(0.17, 0.012, 8, 40), mat('#2b2b2e', 0.4, 0.5));
  rim.position.set(x, y, z);
  group.add(rim);
  const hand = (len: number, wdt: number) => {
    const pivot = new Object3D();
    pivot.position.set(x, y, z + 0.006);
    const m = new Mesh(new BoxGeometry(wdt, len, 0.004).translate(0, len / 2 - 0.02, 0), mat('#151515', 0.5));
    pivot.add(m);
    group.add(pivot);
    return pivot;
  };
  return { hour: hand(0.09, 0.012), minute: hand(0.135, 0.008) };
}

/** A wall-mounted split air conditioner with a ribbon fluttering in the draught. */
function airConditioner(group: Group, x: number, y: number, z: number, faceX: 1 | -1): Mesh {
  const body = new Mesh(new BoxGeometry(0.24, 0.3, 0.95), mat('#f7f7f5', 0.35));
  body.position.set(x + faceX * 0.12, y, z);
  body.castShadow = true;
  group.add(body);
  const vent = new Mesh(new BoxGeometry(0.02, 0.05, 0.85), mat('#d7d9da', 0.5));
  vent.position.set(x + faceX * 0.245, y - 0.1, z);
  group.add(vent);
  const led = new Mesh(new BoxGeometry(0.004, 0.012, 0.02), mat('#55ff99', 0.3, 0, { emissive: '#22ff77' }));
  led.position.set(x + faceX * 0.242, y + 0.05, z + 0.35);
  group.add(led);
  const ribbon = new Mesh(new PlaneGeometry(0.03, 0.18).translate(0, -0.09, 0), mat('#e8508f', 0.6, 0, { side: true }));
  ribbon.position.set(x + faceX * 0.25, y - 0.12, z - 0.2);
  group.add(ribbon);
  return ribbon;
}

/** Branch map on a wall screen. */
function branchesScreen(): CanvasTexture {
  return cached('branches', () => {
    const [c, ctx] = canvas(768, 432);
    const g = ctx.createLinearGradient(0, 0, 0, 432);
    g.addColorStop(0, '#0f2a44');
    g.addColorStop(1, '#16385a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 768, 432);
    ctx.strokeStyle = '#4fb3ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(500, 30);
    ctx.bezierCurveTo(450, 140, 540, 230, 480, 410);
    ctx.stroke();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = `600 30px ${BODY_FONT}`;
    for (const [name, x, y] of [
      ['دبا', 478, 60],
      ['خورفكان', 500, 180],
      ['الفجيرة', 506, 285],
      ['كلباء', 484, 380],
    ] as [string, number, number][]) {
      ctx.fillStyle = '#ff5fa2';
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, x - 24, y + 10);
    }
    ctx.textAlign = 'center';
    ctx.font = `48px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#ffd6e8';
    ctx.fillText('فروعنا', 190, 90);
    ctx.font = `500 26px ${BODY_FONT}`;
    ctx.fillStyle = '#cfe6ff';
    ctx.fillText('شرق الإمارات', 190, 136);
    return toTexture(c);
  });
}

function tvScreen(): CanvasTexture {
  return cached('tvScreen', () => {
    const [c, ctx] = canvas(512, 288);
    const g = ctx.createLinearGradient(0, 0, 512, 288);
    g.addColorStop(0, '#1d4e89');
    g.addColorStop(0.5, '#3fb6c9');
    g.addColorStop(1, '#f5d061');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(380, 90, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20343d';
    ctx.beginPath();
    ctx.moveTo(0, 288);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, 200 - Math.sin(x / 50) * 30 - (x % 64 ? 10 : 0));
    ctx.lineTo(512, 288);
    ctx.fill();
    return toTexture(c);
  });
}

export function buildShop(stage: number, opts: { shadows: boolean }): Shop {
  const [w, d, h] = SIZES[stage];
  const b = new Batcher();
  const stock = new Stocker();
  const group = new Group();
  const lux = stage >= 7;
  const st = STAGES[stage];

  // ----------------------------------------------------------------- layout
  const deskHalf = stage === 0 ? 0.75 : stage === 1 ? 0.85 : 1.0;
  const deskZ = d / 2 - 1.05;
  const deskTop = 0.95;
  const deskFront = deskZ - 0.31;
  const doorW = stage <= 2 ? 0.95 : stage <= 4 ? 1.6 : 2.2;
  const frontZ = -d / 2 + (stage >= 3 ? 1.8 : 1.15);
  const backZ = deskFront - 1.25;
  const spot = new Vector3(0, 0, deskFront - 0.3);
  const layout: ShopLayout = {
    w,
    d,
    h,
    deskZ,
    deskTop,
    deskFront,
    deskHalf,
    spot,
    queue: (i) => new Vector3(0, 0, spot.z - 0.85 * i),
    door: new Vector3(0, 0, -d / 2 + 0.6),
    doorOut: new Vector3(0, 0, -d / 2 - 0.9),
    walkZ: -d / 2 - 1.7,
    frontZ,
    backZ,
    picks: [],
    camera: { pos: new Vector3(0, 1.6, deskZ + 0.62), look: new Vector3(0, 1.35, -d / 2) },
  };

  // ----------------------------------------------------------------- room
  const floorS = lux ? porcelainFloor('#f3efe8', true) : stage >= 3 ? porcelainFloor('#ece8e0') : porcelainFloor('#e6dccb');
  const floorMat = surfaceMat(floorS, 1, 0, 1);
  const floor = new Mesh(worldPlane(w, d + 0.2, floorS.size), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 0.1;
  floor.receiveShadow = true;
  group.add(floor);
  const wallColor = ['#f1e7d6', '#f3ece0', '#f4efe6', '#f5f3ef', '#f6f5f2', '#f4f4f2', '#f4f4f2', '#f7f1e6'][stage];
  const wallS = paintedWall(wallColor);
  const wallM = surfaceMat(wallS, 0.92);
  const T = wallS.size;
  // Side and back walls.
  b.boxMinMax(-w / 2 - 0.15, 0, -d / 2 - 0.15, -w / 2, h, d / 2 + 0.15, wallM, T, T);
  b.boxMinMax(w / 2, 0, -d / 2 - 0.15, w / 2 + 0.15, h, d / 2 + 0.15, wallM, T, T);
  b.boxMinMax(-w / 2, 0, d / 2, w / 2, h, d / 2 + 0.15, wallM, T, T);
  // Skirting.
  const skirt = mat(lux ? '#c9a54a' : '#6b6f74', 0.5, lux ? 0.8 : 0.2);
  b.boxMinMax(-w / 2, 0, -d / 2, -w / 2 + 0.015, 0.1, d / 2, skirt, 1, 1);
  b.boxMinMax(w / 2 - 0.015, 0, -d / 2, w / 2, 0.1, d / 2, skirt, 1, 1);
  // Ceiling with LED panels on the 60 cm grid.
  const ceilS = ceilingTiles();
  const ceil = new Mesh(worldPlane(w, d, ceilS.size), surfaceMat(ceilS, 0.95));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = h;
  ceil.receiveShadow = false;
  group.add(ceil);
  const panelMat = mat('#ffffff', 0.4, 0, { emissive: '#fffaf0' });
  panelMat.emissiveIntensity = 3.2;
  const lights: (PointLight | SpotLight)[] = [];
  const nx = Math.max(1, Math.round(w / 2.4));
  const nz = Math.max(2, Math.round(d / 2.4));
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++) {
      const px = -w / 2 + ((i + 0.5) * w) / nx;
      const pz = -d / 2 + ((k + 0.5) * d) / nz;
      b.boxMinMax(px - 0.3, h - 0.015, pz - 0.3, px + 0.3, h - 0.002, pz + 0.3, panelMat, 1, 1, { cast: false, receive: false });
    }
  // Two or three real lights stand in for the panels (the image-based light does the rest).
  const count = stage <= 2 ? 2 : 3;
  for (let k = 0; k < count; k++) {
    // A cut-off range keeps the shop's light from washing over the street at night.
    const l = new PointLight('#fff4e5', 7 + stage * 2.2, Math.max(7, d * 0.9), 1.6);
    l.position.set(0, h - 0.3, -d / 2 + ((k + 0.5) * d) / count);
    group.add(l);
    lights.push(l);
  }
  // The light over the desk casts the shadows that matter: the customer and the goods.
  const spotL = new SpotLight('#fff6ea', 14, 0, Math.PI / 3.2, 0.6, 2);
  spotL.position.set(0.3, h - 0.1, deskZ - 0.3);
  spotL.target.position.set(0, 0.9, deskZ - 0.6);
  spotL.castShadow = opts.shadows;
  spotL.shadow.mapSize.set(1024, 1024);
  spotL.shadow.bias = -0.0004;
  spotL.shadow.normalBias = 0.02;
  spotL.shadow.radius = 4;
  group.add(spotL, spotL.target);
  lights.push(spotL);

  // ----------------------------------------------------------------- shopfront
  const fz = -d / 2;
  const transom = 2.3;
  const frameM = alu();
  // Fascia above the glass, inside.
  b.boxMinMax(-w / 2, transom + 0.08, fz - 0.15, w / 2, h, fz, wallM, T, T);
  // Kick plate and transom bar.
  b.boxMinMax(-w / 2, 0, fz - 0.06, -doorW / 2, 0.28, fz, frameM, 1, 1);
  b.boxMinMax(doorW / 2, 0, fz - 0.06, w / 2, 0.28, fz, frameM, 1, 1);
  b.boxMinMax(-w / 2, transom, fz - 0.06, w / 2, transom + 0.08, fz, frameM, 1, 1);
  // Mullions and glass panes either side of the door.
  for (const sgn of [-1, 1]) {
    const a = doorW / 2;
    const bEnd = w / 2;
    const n = Math.max(1, Math.round((bEnd - a) / 1.4));
    for (let i = 0; i <= n; i++) {
      const x = sgn * (a + ((bEnd - a) * i) / n);
      b.boxMinMax(x - 0.035, 0, fz - 0.07, x + 0.035, transom, fz + 0.005, frameM, 1, 1);
    }
    const pane = new Mesh(new PlaneGeometry(bEnd - a, transom - 0.28), glassMat());
    pane.position.set(sgn * (a + (bEnd - a) / 2), 0.28 + (transom - 0.28) / 2, fz - 0.03);
    pane.renderOrder = 2;
    group.add(pane);
    // Lettering on the glass.
    const hours = new Mesh(new PlaneGeometry(0.8, 0.4), new MeshStandardMaterial({ map: hoursSticker(), transparent: true, roughness: 0.5 }));
    hours.position.set(sgn * Math.min(bEnd - 0.6, a + 0.9), 1.55, fz - 0.025);
    if (sgn > 0) group.add(hours);
  }
  // The door (one or two leaves of glass in aluminium, opening outwards).
  const doors: Door[] = [];
  const leaves = doorW > 1.2 ? 2 : 1;
  const leafW = doorW / leaves;
  for (let i = 0; i < leaves; i++) {
    // The left leaf hinges on the left and swings out (+y rotation); the right one mirrors it.
    const dir = i === 0 ? 1 : -1;
    const hingeX = i === 0 ? -doorW / 2 : doorW / 2;
    const pivot = new Object3D();
    pivot.position.set(hingeX, 0, fz - 0.03);
    const leaf = new Group();
    const sx = i === 0 ? 1 : -1;
    const frame = (x0: number, y0: number, x1: number, y1: number) => {
      const m = new Mesh(new BoxGeometry(Math.abs(x1 - x0), y1 - y0, 0.045), frameM);
      m.position.set(sx * ((x0 + x1) / 2), (y0 + y1) / 2, 0);
      m.castShadow = true;
      leaf.add(m);
    };
    frame(0, 0, leafW, 0.12);
    frame(0, transom - 0.08, leafW, transom - 0.02);
    frame(0, 0, 0.05, transom - 0.02);
    frame(leafW - 0.05, 0, leafW, transom - 0.02);
    const glass = new Mesh(new PlaneGeometry(leafW - 0.1, transom - 0.22), glassMat());
    glass.position.set((sx * leafW) / 2, 0.12 + (transom - 0.22) / 2, 0);
    glass.renderOrder = 2;
    leaf.add(glass);
    const sticker = new Mesh(new PlaneGeometry(0.5, 0.5), new MeshStandardMaterial({ map: doorSticker(), transparent: true, roughness: 0.5 }));
    sticker.position.set((sx * leafW) / 2, 1.35, 0.006);
    if (i === 0) leaf.add(sticker);
    const bar = new Mesh(new CylinderGeometry(0.014, 0.014, Math.min(0.6, leafW - 0.3), 10).rotateZ(Math.PI / 2), alu());
    bar.position.set(sx * (leafW - 0.2), 1.05, 0.05);
    leaf.add(bar);
    pivot.add(leaf);
    group.add(pivot);
    doors.push({ pivot, dir, open: 0, at: new Vector3(0, 0, fz) });
  }
  // Door mat.
  b.boxMinMax(-doorW / 2 - 0.1, 0, fz + 0.05, doorW / 2 + 0.1, 0.012, fz + 0.75, mat('#3b3f45', 0.95), 1, 1, { cast: false });

  // Name sign and clock over the door, inside.
  const signW = Math.min(w - 1.4, 2.4 + stage * 0.35);
  const sign = new Mesh(new BoxGeometry(signW, signW * 0.195, 0.06), [mat('#ffffff', 0.4), mat('#ffffff', 0.4), mat('#ffffff', 0.4), mat('#ffffff', 0.4), new MeshStandardMaterial({ map: signTexture(st.sign), emissive: '#ffffff', emissiveMap: signTexture(st.sign), emissiveIntensity: 0.35, roughness: 0.4 }), mat('#ffffff', 0.4)]);
  sign.position.set(-0.25 * (stage > 0 ? 1 : 0), Math.min(h - 0.3, transom + 0.18 + signW * 0.1), fz + 0.04);
  group.add(sign);
  const clockHands = clockMesh(group, signW / 2 + 0.35 - 0.25 * (stage > 0 ? 1 : 0), sign.position.y, fz + 0.02);
  // Exit sign.
  const exit = new Mesh(new BoxGeometry(0.34, 0.14, 0.04), [mat('#eee'), mat('#eee'), mat('#eee'), mat('#eee'), new MeshStandardMaterial({ map: exitSign(), emissive: '#ffffff', emissiveMap: exitSign(), emissiveIntensity: 0.9 }), mat('#eee')]);
  exit.position.set(-signW / 2 - 0.45, sign.position.y, fz + 0.04);
  if (w > 4.5) group.add(exit);

  // ----------------------------------------------------------------- shelving
  const pool = stocked(stage);
  const drinks = pool.filter((p) => ['water', 'cola', 'juice', 'laban', 'milk'].includes(p.id));
  const shelfPool = pool.filter((p) => !['icecream', 'watercase', 'tv', 'bike', 'oilcase', 'datesbox', 'ricesack', 'school', 'hotel', 'airline', 'pots', 'tomato', 'apple'].includes(p.id) && !drinks.includes(p));
  const pickRun = (x: number, z0: number, z1: number, face: number, shelfY = 1.1) => {
    for (let z = z0 + 0.5; z < z1 - 0.3; z += 1.3) layout.picks.push({ at: new Vector3(x, 0, z), face, shelfY });
  };
  const wallDepth = 0.42;
  const wallLevels = [0.14, 0.52, 0.9, 1.28, 1.66];
  const runEnd = backZ - 0.2;
  // Left wall: groceries along the whole wall.
  shelfRun(b, stock, -w / 2, -d / 2 + 0.35, runEnd, 1, wallLevels, wallDepth, mixFor(shelfPool, 0), 1);
  pickRun(-w / 2 + wallDepth + 0.45, -d / 2 + 0.35, runEnd, -Math.PI / 2, 1.1);
  // Right wall: shelving by the door, drinks fridges further in.
  const fridgeDoors = [1, 2, 3, 4, 5, 6, 6, 7][stage];
  const fridgeLen = fridgeDoors * 0.72;
  const fridgeZ0 = Math.max(-d / 2 + 1.2, runEnd - fridgeLen);
  fridge(b, stock, group, w / 2, fridgeZ0, fridgeDoors, -1, drinks.length ? drinks : pool.slice(0, 3));
  pickRun(w / 2 - 0.72 - 0.45, fridgeZ0, fridgeZ0 + fridgeLen, Math.PI / 2, 1.0);
  if (fridgeZ0 - (-d / 2 + 0.35) > 0.8) {
    shelfRun(b, stock, w / 2, -d / 2 + 0.35, fridgeZ0 - 0.05, -1, wallLevels, wallDepth, mixFor(shelfPool, 3), 2);
    pickRun(w / 2 - wallDepth - 0.45, -d / 2 + 0.35, fridgeZ0, Math.PI / 2, 1.1);
  }
  // Gondolas either side of the centre aisle, double-sided.
  const gondolaX: number[] = stage < 2 ? [] : stage < 4 ? [1.45] : stage < 5 ? [1.45, 3.55] : [1.45, 3.55, 5.65];
  const gLevels = [0.14, 0.5, 0.86, 1.22];
  let seed = 5;
  for (const gx of gondolaX)
    for (const sgn of [-1, 1]) {
      const x = sgn * gx;
      const z0 = frontZ + 0.75;
      const z1 = backZ - 0.5;
      if (z1 - z0 < 1) continue;
      // Spine at x, faces on both sides.
      shelfRun(b, stock, x, z0, z1, 1, gLevels, 0.42, mixFor(shelfPool, seed++), seed);
      shelfRun(b, stock, x, z0, z1, -1, gLevels, 0.42, mixFor(shelfPool, seed++), seed);
      pickRun(x + 0.42 + 0.45, z0, z1, -Math.PI / 2, 0.9);
      pickRun(x - 0.42 - 0.45, z0, z1, Math.PI / 2, 0.9);
      // End cap facing the front: a display of one product.
      const cap = shelfPool[(seed * 3) % shelfPool.length];
      shelfRun(b, stock, x - 0.42, z0 - 0.45, z0, 1, [0.14, 0.62, 1.1], 0.84, [cap], seed);
    }

  // ----------------------------------------------------------------- floor displays
  waterStack(stock, b, (stage >= 3 ? -1 : 1) * (doorW / 2 + 0.5), -d / 2 + 0.5, stage === 0 ? 3 : 4);
  if (stage >= 1) iceFreezer(b, stock, group, -deskHalf - 0.75, deskZ - 0.25);
  if (stage >= 3) fruitStand(b, group, doorW / 2 + 1.4, -d / 2 + 0.9);
  if (stage >= 5) {
    // Electronics corner: a TV playing on the wall over boxed ones.
    const tv = new Mesh(new BoxGeometry(1.2, 0.7, 0.05), [mat('#111'), mat('#111'), mat('#111'), mat('#111'), new MeshStandardMaterial({ map: tvScreen(), emissive: '#ffffff', emissiveMap: tvScreen(), emissiveIntensity: 0.9 }), mat('#111')]);
    tv.position.set(-w / 2 + 0.06, 2.55, -d / 2 + 2.4);
    tv.rotation.y = Math.PI / 2;
    group.add(tv);
  }
  if (stage >= 6) {
    const screen = new Mesh(new BoxGeometry(1.6, 0.9, 0.05), [mat('#111'), mat('#111'), mat('#111'), mat('#111'), new MeshStandardMaterial({ map: branchesScreen(), emissive: '#ffffff', emissiveMap: branchesScreen(), emissiveIntensity: 0.9 }), mat('#111')]);
    screen.position.set(w / 2 - 0.06, 2.7, -d / 2 + 3.2);
    screen.rotation.y = -Math.PI / 2;
    group.add(screen);
  }
  if (lux) {
    // A chandelier over the centre aisle.
    const ring = new Mesh(new TorusGeometry(0.9, 0.035, 10, 48), mat('#c9a54a', 0.25, 1));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, h - 0.9, -0.5);
    group.add(ring);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const bulb = new Mesh(new SphereGeometry(0.05, 10, 8), mat('#fff8e0', 0.2, 0, { emissive: '#ffe9b0' }));
      bulb.position.set(Math.cos(a) * 0.9, h - 0.85, -0.5 + Math.sin(a) * 0.9);
      group.add(bulb);
    }
    b.cylinder(0, h - 0.9, -0.5, 0.012, 0.9, mat('#c9a54a', 0.25, 1));
  }

  // ----------------------------------------------------------------- walls: posters, AC, extinguisher
  const posters: [string, string, string, string][] = [
    ['عروض الأسبوع', '-20٪', '#e8508f', '🛒'],
    ['حليب طازج', '6 د', '#1f6fd0', '🥛'],
    ['تمر الإمارات', 'جديد', '#8a5a2b', '🌴'],
    ['مشروبات باردة', '3 د', '#0b8f6a', '🥤'],
  ];
  const posterY = Math.min(h - 0.5, 2.55);
  if (h - 2.1 > 0.6) {
    posters.slice(0, stage >= 3 ? 4 : 2).forEach(([t, line, color, icon], i) => {
      const left = i % 2 === 0;
      const m = new Mesh(new PlaneGeometry(0.45, 0.63), new MeshStandardMaterial({ map: poster(t, line, color, icon), roughness: 0.6 }));
      m.position.set(left ? -w / 2 + 0.005 : w / 2 - 0.005, posterY, -d / 2 + 1.0 + Math.floor(i / 2) * 1.8);
      m.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
      group.add(m);
    });
  }
  const ribbon = airConditioner(group, -w / 2, h - 0.35, deskZ - 1.5, 1);
  const ext = new Mesh(new CylinderGeometry(0.08, 0.08, 0.5, 16), mat('#c0261d', 0.35, 0.1));
  ext.position.set(w / 2 - 0.12, 0.62, -d / 2 + 0.25);
  group.add(ext);
  const cctv = new Mesh(new SphereGeometry(0.09, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#1b1c1f', 0.15, 0.2, { opacity: 0.85 }));
  cctv.rotation.x = Math.PI;
  cctv.position.set(w / 2 - 0.4, h - 0.01, -d / 2 + 0.4);
  group.add(cctv);

  // ----------------------------------------------------------------- the desk
  const desk = buildDesk(stage, layout, opts.shadows);
  group.add(desk.group);
  // Desk top material by stage.
  void quartz;

  // ----------------------------------------------------------------- the street
  const street = buildStreet(fz, w, stage, opts.shadows);
  group.add(street.group);

  const staticGroup = b.build();
  group.add(staticGroup);
  group.add(stock.build(opts.shadows));

  let t = 0;
  const update = (dt: number, minute: number, night: number, people: Vector3[]) => {
    t += dt;
    // Clock hands keep shop time.
    const hr = (minute / 60) % 12;
    clockHands.hour.rotation.z = -(hr / 12) * Math.PI * 2;
    clockHands.minute.rotation.z = -((minute % 60) / 60) * Math.PI * 2;
    ribbon.rotation.x = Math.sin(t * 7) * 0.25 + Math.sin(t * 13) * 0.1 + 0.35;
    // Doors open for anyone close.
    for (const door of doors) {
      const near = people.some((p) => Math.abs(p.x - door.at.x) < doorW / 2 + 0.4 && Math.abs(p.z - door.at.z) < 1.1);
      door.open += ((near ? 1 : 0) - door.open) * Math.min(1, dt * (near ? 5 : 2.2));
      door.pivot.rotation.y = door.dir * door.open * 1.35;
    }
    desk.update(dt);
    street.update(dt, minute, night, people);
  };

  return { group, layout, desk, street, doors, clockHands, lights, update };
}

/** A plane whose UVs repeat every `size` metres. */
function worldPlane(w: number, d: number, size: number): PlaneGeometry {
  const g = new PlaneGeometry(w, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / size, (uv.getY(i) * d) / size);
  return g;
}

/** Products for one shelf run: a shuffled slice so neighbouring runs differ. */
function mixFor(pool: Product[], seed: number): Product[] {
  const a = pool.slice();
  let s = seed * 7 + 3;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function exitSign(): CanvasTexture {
  return cached('exit', () => {
    const [c, ctx] = canvas(256, 104);
    ctx.fillStyle = '#0f8a3c';
    ctx.fillRect(0, 0, 256, 104);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `44px ${DISPLAY_FONT}`;
    ctx.fillText('مخرج', 150, 40);
    ctx.font = `600 22px ${BODY_FONT}`;
    ctx.fillText('EXIT', 150, 82);
    ctx.font = `600 64px ${BODY_FONT}`;
    ctx.fillText('←', 46, 56);
    return toTexture(c);
  });
}

export type { Material };
export { worldBox };
