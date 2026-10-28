/**
 * The shop seen from behind the till: four walls, the door to the street with the
 * name board over it, shelves full of goods, and the counter in front of the
 * shopkeeper. It is rebuilt for every stage, from a one-shelf kiosk to a marble
 * flagship store.
 */
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { PRODUCTS, STAGES, stocked, type Product } from '../game/economy';
import { Batcher } from './batch';
import { branchesTexture, marbleTexture, signTexture, tileTexture } from './textures';

export interface ShopLayout {
  w: number;
  d: number;
  h: number;
  /** Middle of the counter, along z. */
  counterZ: number;
  counterHalf: number;
  /** Where a customer stands to put things on the counter, and the line behind. */
  queue(i: number): Vector3;
  /** Just inside the door, and out on the street. */
  door: Vector3;
  outside: Vector3;
  /** Places to stand while taking things off a shelf, with the way to face. */
  picks: { at: Vector3; face: number }[];
  camera: { pos: Vector3; look: Vector3 };
}

const SIZES: [number, number, number][] = [
  [5, 5.5, 3],
  [6.5, 6.5, 3.2],
  [8, 7.5, 3.4],
  [10, 9, 3.6],
  [13, 11, 4],
  [16, 13, 4.4],
  [16, 13, 4.4],
  [18, 14, 5],
];

const mats = new Map<string, MeshStandardMaterial>();
export function solid(color: string, rough = 0.8, metal = 0, emissive?: string): MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${emissive ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color: new Color(color), roughness: rough, metalness: metal });
    if (emissive) {
      m.emissive = new Color(emissive);
      m.emissiveIntensity = 0.9;
    }
    mats.set(key, m);
  }
  return m;
}

/** A product's shape at a given size (height in metres). */
export function productGeometry(p: Product, size = 0.24): BufferGeometry {
  const s = size;
  switch (p.shape) {
    case 'bottle':
      return new CylinderGeometry(s * 0.22, s * 0.26, s, 10).translate(0, s / 2, 0);
    case 'can':
      return new CylinderGeometry(s * 0.28, s * 0.28, s * 0.62, 12).translate(0, s * 0.31, 0);
    case 'bag':
      return new SphereGeometry(s * 0.42, 10, 8).scale(1, 0.8, 0.55).translate(0, s * 0.34, 0);
    case 'tray':
      return new BoxGeometry(s * 1.2, s * 0.28, s * 0.8).translate(0, s * 0.14, 0);
    case 'jar':
      return new CylinderGeometry(s * 0.32, s * 0.32, s * 0.7, 12).translate(0, s * 0.35, 0);
    case 'crate':
      return new BoxGeometry(s * 1.1, s * 0.7, s * 0.8).translate(0, s * 0.35, 0);
    default:
      return new BoxGeometry(s * 0.62, s * 0.85, s * 0.3).translate(0, s * 0.425, 0);
  }
}

export interface Shop {
  group: Group;
  layout: ShopLayout;
  lights: PointLight[];
}

export function buildShop(stage: number): Shop {
  const [w, d, h] = SIZES[stage];
  const b = new Batcher();
  const group = new Group();
  const lux = stage >= 7;
  const counterZ = d / 2 - 1.6;
  const counterHalf = Math.min(2.4, 1.3 + stage * 0.15);

  // Floor, walls, ceiling.
  const floorTex = lux ? marbleTexture() : stage >= 4 ? tileTexture('#f4f1ea', '#e7e2d8') : tileTexture('#e9dcc2', '#d9c9a8');
  const floor = new Mesh(new PlaneGeometry(w, d), new MeshStandardMaterial({ map: floorTex, roughness: lux ? 0.25 : 0.7 }));
  floorTex.repeat.set(w / (lux ? 2.5 : 1.2), d / (lux ? 2.5 : 1.2));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const wallColor = ['#f3e3c3', '#f6ead2', '#f4e6cf', '#eef3f1', '#f6f4ef', '#f2f2f0', '#f2f2f0', '#f7efe0'][stage];
  const wall = solid(wallColor, 0.95);
  const doorW = stage >= 4 ? 2.6 : 1.6;
  const doorH = 2.5;
  // Back wall with the door.
  b.boxMinMax(-w / 2, 0, -d / 2 - 0.2, -doorW / 2, h, -d / 2, wall);
  b.boxMinMax(doorW / 2, 0, -d / 2 - 0.2, w / 2, h, -d / 2, wall);
  b.boxMinMax(-doorW / 2, doorH, -d / 2 - 0.2, doorW / 2, h, -d / 2, wall);
  // Side walls.
  b.boxMinMax(-w / 2 - 0.2, 0, -d / 2 - 0.2, -w / 2, h, d / 2 + 1, wall);
  b.boxMinMax(w / 2, 0, -d / 2 - 0.2, w / 2 + 0.2, h, d / 2 + 1, wall);
  // A painted band and skirting.
  const band = solid(lux ? '#c9a54a' : '#e8508f', 0.6, lux ? 0.6 : 0);
  b.boxMinMax(-w / 2 + 0.01, h - 0.35, -d / 2 + 0.01, w / 2 - 0.01, h - 0.25, -d / 2 + 0.03, band);
  b.boxMinMax(-w / 2 + 0.01, 0, -d / 2 + 0.01, w / 2 - 0.01, 0.12, -d / 2 + 0.04, solid('#7a5233', 0.8));
  // Ceiling with light panels.
  b.boxMinMax(-w / 2, h, -d / 2 - 0.2, w / 2, h + 0.1, d / 2 + 1, solid('#fbf8f2', 0.95));
  const panel = solid('#ffffff', 0.4, 0, '#fff4dc');
  const nx = Math.max(1, Math.round(w / 4));
  const nz = Math.max(1, Math.round(d / 4));
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) b.boxMinMax(-w / 2 + ((i + 0.5) * w) / nx - 0.5, h - 0.04, -d / 2 + ((k + 0.5) * d) / nz - 0.25, -w / 2 + ((i + 0.5) * w) / nx + 0.5, h, -d / 2 + ((k + 0.5) * d) / nz + 0.25, panel);

  // The street outside the door: sand, the road, a palm.
  const out = new Mesh(new PlaneGeometry(60, 30), solid('#e3cfa3', 1));
  out.rotation.x = -Math.PI / 2;
  out.position.set(0, -0.01, -d / 2 - 15);
  group.add(out);
  b.boxMinMax(-30, 0, -d / 2 - 9, 30, 0.02, -d / 2 - 5, solid('#5b5d61', 0.95));
  b.boxMinMax(-30, 0, -d / 2 - 5, 30, 0.12, -d / 2 - 0.2, solid('#cfc6b4', 0.9));
  b.place(new CylinderGeometry(0.16, 0.22, 4.5, 8), solid('#8a6a45', 0.9), 3.5, 2.25, -d / 2 - 3.5);
  for (let i = 0; i < 7; i++) b.place(new BoxGeometry(0.25, 0.06, 2.2), solid('#3f8f50', 0.8), 3.5 + Math.sin((i / 7) * Math.PI * 2) * 0.9, 4.4, -d / 2 - 3.5 + Math.cos((i / 7) * Math.PI * 2) * 0.9, (i / 7) * Math.PI * 2, { rotX: 0.5 });
  // Windows either side of the door from the mini-market on.
  if (stage >= 3) {
    const glass = new MeshBasicMaterial({ color: '#cfe8f6', transparent: true, opacity: 0.35 });
    for (const sx of [-1, 1]) {
      const win = new Mesh(new PlaneGeometry(Math.min(3, w / 2 - doorW / 2 - 1), 1.6), glass);
      win.position.set(sx * (doorW / 2 + Math.min(3, w / 2 - doorW / 2 - 1) / 2 + 0.4), 1.6, -d / 2 + 0.02);
      group.add(win);
    }
  }

  // Name board over the door, inside, facing the shopkeeper.
  const st = STAGES[stage];
  const signTex = signTexture(st.sign, lux ? '#2a1a2e' : '#e8508f', lux ? '#e9c46a' : '#ffffff', 'SHARQ AL EMARAT');
  const signW = Math.min(w - 1, 5.5);
  const sign = new Mesh(new PlaneGeometry(signW, signW * (220 / 1024)), new MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: new Color('#ffffff'), emissiveIntensity: 0.35 }));
  sign.position.set(0, Math.min(h - 0.5, doorH + 0.15 + (signW * (220 / 1024)) / 2), -d / 2 + 0.03);
  group.add(sign);

  // Shelves full of goods along the side walls.
  const goods = stocked(stage);
  const shelfColor = lux ? '#3a2a1e' : stage >= 4 ? '#e9eef2' : '#a0764a';
  const shelfZ0 = -d / 2 + 0.9;
  const shelfZ1 = counterZ - 1.3;
  const picks: ShopLayout['picks'] = [];
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - 0.35);
    shelfUnit(b, x, shelfZ0, shelfZ1, side, shelfColor, goods, stage);
    const n = Math.max(1, Math.round((shelfZ1 - shelfZ0) / 1.6));
    for (let i = 0; i < n; i++) picks.push({ at: new Vector3(side * (w / 2 - 1.15), 0, shelfZ0 + ((i + 0.5) * (shelfZ1 - shelfZ0)) / n), face: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  // Free-standing aisles from the mini-market on.
  if (stage >= 3) {
    const ax = Math.min(w / 4, 3);
    for (const side of [-1, 1]) {
      const z0 = shelfZ0 + 1.2;
      const z1 = shelfZ1 - 0.6;
      gondola(b, side * ax, z0, z1, shelfColor, goods, stage);
      const n = Math.max(1, Math.round((z1 - z0) / 1.8));
      for (let i = 0; i < n; i++) picks.push({ at: new Vector3(side * (ax - 0.85), 0, z0 + ((i + 0.5) * (z1 - z0)) / n), face: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  // A drinks fridge and an ice-cream chest from the small grocery on.
  if (stage >= 1) fridge(b, -w / 2 + 1.0, -d / 2 + 0.45, stage);
  if (stage >= 1) freezer(b, w / 2 - 1.2, -d / 2 + 0.9);
  if (stage >= 3) fruitStand(b, -doorW / 2 - 1.1, -d / 2 + 1.4);
  if (stage >= 5) {
    // A wall of televisions by the door.
    for (let i = 0; i < 3; i++) b.boxMinMax(doorW / 2 + 0.6 + i * 1.1, 1.6, -d / 2 + 0.02, doorW / 2 + 1.5 + i * 1.1, 2.2, -d / 2 + 0.08, solid('#1b1d22', 0.3, 0.2, i % 2 ? '#2a6fb0' : '#3fbf9f'));
  }
  if (stage >= 6) {
    const scr = new Mesh(new PlaneGeometry(2.6, 1.46), new MeshBasicMaterial({ map: branchesTexture() }));
    scr.position.set(-w / 2 + 0.03, 2.4, counterZ - 3.2);
    scr.rotation.y = Math.PI / 2;
    group.add(scr);
  }
  if (lux) {
    // Chandelier.
    const gold = solid('#d4b25a', 0.3, 0.8);
    b.place(new TorusGeometry(0.9, 0.05, 8, 32), gold, 0, h - 0.9, -1, 0, { rotX: Math.PI / 2 });
    b.place(new CylinderGeometry(0.02, 0.02, 0.8, 6), gold, 0, h - 0.45, -1);
    for (let i = 0; i < 10; i++) b.place(new SphereGeometry(0.08, 8, 6), solid('#fff8e0', 0.2, 0, '#ffe9b0'), Math.cos((i / 10) * Math.PI * 2) * 0.9, h - 1.0, -1 + Math.sin((i / 10) * Math.PI * 2) * 0.9);
  }

  // The counter, the till and a basket of sweets.
  const top = lux ? solid('#2a2a2a', 0.2, 0.3) : solid('#d8c3a0', 0.5);
  const front = lux ? solid('#c9a54a', 0.35, 0.6) : stage >= 4 ? solid('#e8508f', 0.6) : solid('#9a6b45', 0.8);
  b.boxMinMax(-counterHalf, 0, counterZ - 0.35, counterHalf, 0.95, counterZ + 0.35, front);
  b.boxMinMax(-counterHalf - 0.05, 0.95, counterZ - 0.4, counterHalf + 0.05, 1.02, counterZ + 0.4, top);
  b.boxMinMax(counterHalf - 0.75, 1.02, counterZ + 0.0, counterHalf - 0.15, 1.25, counterZ + 0.35, solid('#2b2d31', 0.4, 0.3));
  b.boxMinMax(counterHalf - 0.7, 1.25, counterZ + 0.12, counterHalf - 0.2, 1.5, counterZ + 0.16, solid('#1b1d22', 0.2, 0.2, '#3fbf9f'));
  b.place(new CylinderGeometry(0.2, 0.15, 0.14, 14), solid('#c8963e', 0.8), -counterHalf + 0.35, 1.09, counterZ + 0.05);
  for (let i = 0; i < 6; i++) b.place(new SphereGeometry(0.035, 6, 5), solid(['#e85aa0', '#f2c230', '#3fbf9f'][i % 3], 0.5), -counterHalf + 0.3 + (i % 3) * 0.05, 1.17, counterZ + (i < 3 ? 0 : 0.08));
  // Shelves of cigarettes-free goods behind the till (the shopkeeper's wall): small boxes.
  group.add(b.build());

  // Real lights: a warm fill and a couple of ceiling lights.
  const lights: PointLight[] = [];
  for (const z of [counterZ - 1.5, -d / 4]) {
    const l = new PointLight('#fff1d8', 14 + stage * 3, Math.max(w, d) * 1.4, 1.4);
    l.position.set(0, h - 0.3, z);
    group.add(l);
    lights.push(l);
  }

  const queue = (i: number) => new Vector3(Math.sin(i * 1.3) * 0.25 * Math.min(1, i), 0, counterZ - 0.95 - i * 0.95);
  return {
    group,
    lights,
    layout: {
      w,
      d,
      h,
      counterZ,
      counterHalf,
      queue,
      door: new Vector3(0, 0, -d / 2 + 0.7),
      outside: new Vector3(0, 0, -d / 2 - 3),
      picks,
      camera: { pos: new Vector3(0, 2.15, d / 2 + 0.2), look: new Vector3(0, 0.85, -d / 2 + 0.6) },
    },
  };
}

/** A wall shelf from z0 to z1 with four boards of goods. */
function shelfUnit(b: Batcher, x: number, z0: number, z1: number, side: number, color: string, goods: Product[], stage: number): void {
  const m = solid(color, 0.7);
  const depth = 0.5;
  const xi = x - side * depth;
  b.boxMinMax(Math.min(x, xi), 0, z0, Math.max(x, xi), 0.1, z1, m);
  b.boxMinMax(x - 0.03, 0, z0, x + 0.03, 1.9, z1, m);
  for (let lvl = 0; lvl < 4; lvl++) {
    const y = 0.15 + lvl * 0.45;
    b.boxMinMax(Math.min(x, xi), y, z0, Math.max(x, xi), y + 0.03, z1, m);
    fillRow(b, (x + xi) / 2, y + 0.03, z0, z1, goods, stage, lvl + Math.round(x));
  }
}

/** A double-sided island shelf. */
function gondola(b: Batcher, x: number, z0: number, z1: number, color: string, goods: Product[], stage: number): void {
  const m = solid(color, 0.7);
  b.boxMinMax(x - 0.45, 0, z0, x + 0.45, 0.12, z1, m);
  b.boxMinMax(x - 0.03, 0, z0, x + 0.03, 1.6, z1, m);
  for (let lvl = 0; lvl < 3; lvl++) {
    const y = 0.18 + lvl * 0.45;
    b.boxMinMax(x - 0.45, y, z0, x + 0.45, y + 0.03, z1, m);
    fillRow(b, x - 0.22, y + 0.03, z0, z1, goods, stage, lvl * 7 + 1);
    fillRow(b, x + 0.22, y + 0.03, z0, z1, goods, stage, lvl * 7 + 4);
  }
}

/** Products side by side along a shelf board; newer products in front. */
function fillRow(b: Batcher, x: number, y: number, z0: number, z1: number, goods: Product[], stage: number, seed: number): void {
  const recent = goods.filter((g) => g.stage >= stage - 1);
  const pool = recent.length >= 4 ? recent.concat(goods) : goods;
  let z = z0 + 0.12;
  let i = seed * 3;
  while (z < z1 - 0.12) {
    const p = pool[(((i++ % pool.length) + pool.length) % pool.length)];
    const size = p.shape === 'crate' || p.shape === 'tray' ? 0.22 : 0.26;
    b.place(productGeometry(p, size), solid(p.color, 0.55), x, y, z, 0);
    z += size * (p.shape === 'crate' || p.shape === 'tray' ? 1.25 : 0.75) + 0.04;
  }
}

function fridge(b: Batcher, x: number, z: number, stage: number): void {
  b.boxMinMax(x - 0.75, 0, z - 0.4, x + 0.75, 2.1, z + 0.4, solid('#e9eef2', 0.4, 0.3));
  b.boxMinMax(x - 0.68, 0.15, z + 0.38, x + 0.68, 2.0, z + 0.41, solid('#bfe6f6', 0.1, 0.1, '#9fdcff'));
  const drinks = PRODUCTS.filter((p) => (p.shape === 'bottle' || p.shape === 'can') && p.stage <= stage);
  for (let lvl = 0; lvl < 4; lvl++)
    for (let k = 0; k < 7; k++) {
      const p = drinks[(lvl * 7 + k) % drinks.length];
      b.place(productGeometry(p, 0.22), solid(p.color, 0.5), x - 0.55 + k * 0.18, 0.25 + lvl * 0.45, z + 0.15);
    }
}

function freezer(b: Batcher, x: number, z: number): void {
  b.boxMinMax(x - 0.6, 0, z - 0.45, x + 0.6, 0.85, z + 0.45, solid('#f4f4f2', 0.4, 0.2));
  b.boxMinMax(x - 0.55, 0.85, z - 0.4, x + 0.55, 0.88, z + 0.4, solid('#cfe8f6', 0.1, 0.1, '#bfe6ff'));
  b.boxMinMax(x - 0.62, 0.55, z + 0.45, x + 0.62, 0.8, z + 0.47, solid('#e8508f', 0.6));
}

function fruitStand(b: Batcher, x: number, z: number): void {
  b.boxMinMax(x - 0.9, 0, z - 0.5, x + 0.9, 0.7, z + 0.5, solid('#a0764a', 0.8));
  const fruit = ['#d8352b', '#f2c230', '#3f9150', '#f28b30'];
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 6; k++) b.place(new SphereGeometry(0.07, 8, 6), solid(fruit[i], 0.6), x - 0.7 + i * 0.45 + (k % 2) * 0.12, 0.78 + Math.floor(k / 2) * 0.06, z - 0.25 + (k % 3) * 0.2);
}
