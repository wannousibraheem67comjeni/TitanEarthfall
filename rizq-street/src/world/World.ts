/**
 * Builds the whole street from the layout: road and sidewalks, the shop row with
 * signs and awnings, walled villas, the mosque, the car wash, the park, the side alley,
 * the far skyline, and every collider. Static geometry is batched; things the game
 * changes (plants, the stall, Hamad's car) come back as references.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import { Rng } from '../core/rng';
import { Batcher, worldBox } from './batch';
import { Colliders } from './collision';
import { buildHouse, type HouseRefs } from './house';
import {
  ALLEY_HOUSES,
  BOUNDS,
  CARWASH,
  COMPANY,
  HOME,
  MOSQUE,
  PARK,
  SHOP_LOTS,
  STALL_SPOT,
  VILLA_LOTS,
  type ShopLot,
  type VillaLot,
} from './layout';
import { M, registerNightGlow, solid, textured } from './materials';
import * as P from './props';
import * as T from './textures';

export interface WorldRefs {
  colliders: Colliders;
  lamps: Vector3[];
  plants: { x: number; z: number; setWater: (t: number) => void; group: Group }[];
  stall: Group;
  hamadCar: Group;
  washCar: Group;
  skyline: Skyline;
  house: HouseRefs;
}

const rng = new Rng(2024);

function ground(b: Batcher, x0: number, z0: number, x1: number, z1: number, y: number, material: MeshStandardMaterial, tileU: number, tileV = tileU): void {
  const w = x1 - x0;
  const d = z1 - z0;
  const g = new PlaneGeometry(w, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tileU, (uv.getY(i) * d) / tileV);
  b.place(g, material, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, { rotX: -Math.PI / 2, cast: false, receive: true });
}

/** Little triangular crenellations along a wall top, the Gulf parapet motif. */
function crenellate(b: Batcher, x0: number, z0: number, x1: number, z1: number, y: number, color: string, step = 0.9, size = 0.42): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.floor(len / step));
  const rot = Math.atan2(x1 - x0, z1 - z0);
  const mat = M.stucco(color);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    b.place(new ConeGeometry(size * 0.55, size, 4), mat, x0 + (x1 - x0) * t, y + size / 2, z0 + (z1 - z0) * t, rot + Math.PI / 4, { cast: false });
  }
}

function wall(b: Batcher, c: Colliders, x0: number, z0: number, x1: number, z1: number, h: number, color: string, trim: string, thick = 0.35, crenel = true): void {
  const minX = Math.min(x0, x1) - (x0 === x1 ? thick / 2 : 0);
  const maxX = Math.max(x0, x1) + (x0 === x1 ? thick / 2 : 0);
  const minZ = Math.min(z0, z1) - (z0 === z1 ? thick / 2 : 0);
  const maxZ = Math.max(z0, z1) + (z0 === z1 ? thick / 2 : 0);
  b.boxMinMax(minX, 0, minZ, maxX, h, maxZ, M.stucco(color), 3, 3);
  b.boxMinMax(minX - 0.05, h, minZ - 0.05, maxX + 0.05, h + 0.14, maxZ + 0.05, M.trim(trim), 1, 1, { cast: false });
  if (crenel) crenellate(b, x0, z0, x1, z1, h + 0.14, color);
  c.addBox(minX, minZ, maxX, maxZ, h);
}

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

function shop(b: Batcher, c: Colliders, lot: ShopLot, variant: number): void {
  const front = lot.maxZ;
  const w = lot.maxX - lot.minX;
  const groundH = 3.6;
  const totalH = groundH + (lot.floors - 1) * 3.4;
  const wallMat = M.stucco(lot.facade);
  const kind = lot.place ?? 'grocery';
  const small = lot.place === 'atm';

  if (small) {
    b.boxMinMax(lot.minX, 0, lot.minZ, lot.maxX, 2.9, front, solid('#cfd6dc', 0.6), 1);
    b.boxMinMax(lot.minX - 0.1, 2.9, lot.minZ - 0.1, lot.maxX + 0.1, 3.4, front + 0.1, solid('#20406b', 0.5));
    const signMat = registerNightGlow(new MeshStandardMaterial({ map: T.signTexture(lot.sign, lot.signColor, lot.signText, 'ATM'), emissiveMap: T.signTexture(lot.sign, lot.signColor, lot.signText, 'ATM'), emissive: new Color('#ffffff'), emissiveIntensity: 0.2, roughness: 0.5 }), 0.9);
    b.place(new PlaneGeometry(lot.maxX - lot.minX, 0.5), signMat, (lot.minX + lot.maxX) / 2, 3.15, front + 0.12, 0, { cast: false });
    P.atm(b, (lot.minX + lot.maxX) / 2, front + 0.0);
    c.addBox(lot.minX, lot.minZ, lot.maxX, front + 0.4, 3.4);
    return;
  }

  // Ground floor shell behind the glass.
  b.boxMinMax(lot.minX, 0, lot.minZ, lot.maxX, groundH, front - 0.6, wallMat, 3);
  // Pillars and lintel frame the glass.
  b.boxMinMax(lot.minX, 0, front - 0.6, lot.minX + 0.7, groundH, front, wallMat, 3);
  b.boxMinMax(lot.maxX - 0.7, 0, front - 0.6, lot.maxX, groundH, front, wallMat, 3);
  b.boxMinMax(lot.minX + 0.7, 3.1, front - 0.6, lot.maxX - 0.7, groundH, front, wallMat, 3);
  // Glass front with the interior painted behind it; lit at night.
  const interior = T.interiorTexture(kind);
  const glassMat = registerNightGlow(new MeshStandardMaterial({ map: interior, emissiveMap: interior, emissive: new Color('#fff4dc'), emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.1 }), 0.85);
  b.place(new PlaneGeometry(w - 1.4, 3.0), glassMat, (lot.minX + lot.maxX) / 2, 1.6, front - 0.55, 0, { cast: false });
  // Door frame in the middle.
  b.boxMinMax((lot.minX + lot.maxX) / 2 - 0.9, 0.02, front - 0.52, (lot.minX + lot.maxX) / 2 + 0.9, 0.1, front - 0.45, M.darkMetal());
  b.boxMinMax((lot.minX + lot.maxX) / 2 - 0.95, 0, front - 0.52, (lot.minX + lot.maxX) / 2 - 0.85, 2.6, front - 0.45, M.darkMetal());
  b.boxMinMax((lot.minX + lot.maxX) / 2 + 0.85, 0, front - 0.52, (lot.minX + lot.maxX) / 2 + 0.95, 2.6, front - 0.45, M.darkMetal());
  b.boxMinMax((lot.minX + lot.maxX) / 2 - 0.95, 2.55, front - 0.52, (lot.minX + lot.maxX) / 2 + 0.95, 2.65, front - 0.45, M.darkMetal());

  // Upper floors with windows.
  const fac = T.facadeTextures(variant);
  const facMat = registerNightGlow(textured(`facade${variant}${lot.facade}`, fac.map, { color: lot.facade, emissiveMap: fac.emissive, emissive: '#ffd9a0' }), 1.1);
  if (lot.floors > 1) {
    const g = worldBox(w, totalH - groundH, front - lot.minZ, 9, 3.4);
    g.translate((lot.minX + lot.maxX) / 2, (groundH + totalH) / 2, (front + lot.minZ) / 2);
    b.add(g, facMat);
  }
  // Roof, parapet and crenellations.
  b.boxMinMax(lot.minX, totalH, lot.minZ, lot.maxX, totalH + 0.1, front, M.roof(), 4);
  b.boxMinMax(lot.minX, totalH, front - 0.25, lot.maxX, totalH + 0.9, front, wallMat, 3);
  b.boxMinMax(lot.minX, totalH, lot.minZ, lot.maxX, totalH + 0.9, lot.minZ + 0.25, wallMat, 3);
  b.boxMinMax(lot.minX, totalH, lot.minZ, lot.minX + 0.25, totalH + 0.9, front, wallMat, 3);
  b.boxMinMax(lot.maxX - 0.25, totalH, lot.minZ, lot.maxX, totalH + 0.9, front, wallMat, 3);
  crenellate(b, lot.minX + 0.2, front - 0.12, lot.maxX - 0.2, front - 0.12, totalH + 0.9, lot.facade);
  // Floor bands.
  for (let f = 1; f < lot.floors; f++) b.boxMinMax(lot.minX - 0.05, groundH + (f - 1) * 3.4 - 0.12, front, lot.maxX + 0.05, groundH + (f - 1) * 3.4 + 0.08, front + 0.12, M.trim('#d8cdb8'));

  // Sign board above the shop front, lit at night.
  const signTex = T.signTexture(lot.sign, lot.signColor, lot.signText, kind === 'grocery' ? 'AL NOOR GROCERY' : kind === 'karak' ? 'FREEJ KARAK' : kind === 'shawarma' ? 'AL SHAM SHAWARMA' : kind === 'perfume' ? 'ABU SALEM PERFUMES' : kind === 'barber' ? 'ELEGANCE SALON' : kind === 'company' ? 'AL RIZQ GROUP' : 'MOBILE WORLD');
  const signMat = registerNightGlow(new MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: new Color('#ffffff'), emissiveIntensity: 0.25, roughness: 0.4 }), 1.0);
  const sw = Math.min(w - 1.6, 13);
  b.boxMinMax((lot.minX + lot.maxX) / 2 - sw / 2 - 0.1, 3.75, front, (lot.minX + lot.maxX) / 2 + sw / 2 + 0.1, 5.15, front + 0.25, solid(lot.signColor, 0.5));
  b.place(new PlaneGeometry(sw, sw / 5.33), signMat, (lot.minX + lot.maxX) / 2, 4.45, front + 0.27, 0, { cast: false });
  // Awning over the sidewalk.
  if (lot.awning) {
    const aw = textured(`awn${lot.awning[0]}`, T.awningTexture(lot.awning[0], lot.awning[1]), { doubleSide: true, roughness: 0.9 });
    aw.side = DoubleSide;
    const awW = w - 1.6;
    const g = new PlaneGeometry(awW, 1.9);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * awW) / 2.4);
    b.place(g, aw, (lot.minX + lot.maxX) / 2, 3.3, front + 0.85, 0, { rotX: -Math.PI / 2 + 0.42 });
    b.place(new PlaneGeometry(awW, 0.3), aw, (lot.minX + lot.maxX) / 2, 2.78, front + 1.72, 0);
  }
  // Wall AC units on the upper floors, rooftop tanks and dishes.
  for (let f = 1; f < lot.floors; f++) {
    for (let k = 0; k < 2; k++) {
      if (!rng.chance(0.7)) continue;
      P.acUnit(b, lot.minX + 2 + rng.next() * (w - 4), groundH + (f - 1) * 3.4 + 0.9, front + 0.32, 0);
    }
  }
  P.waterTank(b, lot.minX + 2.5, totalH + 0.1, lot.minZ + 3);
  for (let k = 0; k < 2; k++) P.acUnit(b, lot.minX + 4 + k * 3, totalH + 0.4, lot.minZ + 6 + rng.next() * 3, rng.next() * 3);
  if (rng.chance(0.7)) P.satelliteDish(b, lot.maxX - 2, totalH + 0.1, lot.minZ + 4, rng.next() * 6);

  c.addBox(lot.minX, lot.minZ, lot.maxX, front - 0.1, totalH + 1);
}

// ---------------------------------------------------------------------------
// Villas
// ---------------------------------------------------------------------------

function gate(b: Batcher, x: number, z: number, axis: 'x' | 'z', color: string, open: boolean): void {
  const tex = textured(`gate${color}`, T.gateTexture(color), { roughness: 0.5, metalness: 0.3 });
  const leafW = 1.75;
  for (const side of [-1, 1]) {
    const g = new BoxGeometry(leafW, 2.5, 0.08);
    if (axis === 'x') {
      if (open) b.place(g, tex, x + side * 1.8, 1.3, z + leafW / 2 + 0.05, Math.PI / 2);
      else b.place(g, tex, x + side * (leafW / 2 + 0.02), 1.3, z, 0);
    } else {
      if (open) b.place(g, tex, x + leafW / 2, 1.3, z + side * 1.8, 0);
      else b.place(g, tex, x, 1.3, z + side * (leafW / 2 + 0.02), Math.PI / 2);
    }
  }
}

function gatePillars(b: Batcher, c: Colliders, x: number, z: number, axis: 'x' | 'z', color: string, trim: string): void {
  for (const side of [-1, 1]) {
    const px = axis === 'x' ? x + side * 2.05 : x;
    const pz = axis === 'x' ? z : z + side * 2.05;
    b.boxMinMax(px - 0.35, 0, pz - 0.35, px + 0.35, 3.1, pz + 0.35, M.stucco(color), 1);
    b.boxMinMax(px - 0.42, 3.1, pz - 0.42, px + 0.42, 3.3, pz + 0.42, M.trim(trim));
    b.place(new BoxGeometry(0.3, 0.35, 0.3), registerNightGlow(solid('#fff3d6', 0.3, 0, { emissive: '#ffcf7a', emissiveIntensity: 0 }), 1.6), px, 3.5, pz);
    c.addBox(px - 0.35, pz - 0.35, px + 0.35, pz + 0.35, 3.3);
  }
}

function house(b: Batcher, c: Colliders, x0: number, z0: number, x1: number, z1: number, color: string, trim: string, windTower: boolean, facingZ: 1 | -1 = -1): void {
  const h = 7.6;
  const vt = T.villaTextures();
  const mat = registerNightGlow(textured(`villa${color}`, vt.map, { color, emissiveMap: vt.emissive, emissive: '#ffd59a' }), 0.9);
  b.boxMinMax(x0, 0, z0, x1, h, z1, mat, 6, 7.6);
  b.boxMinMax(x0 - 0.15, 3.7, z0 - 0.15, x1 + 0.15, 3.9, z1 + 0.15, M.trim(trim), 1);
  b.boxMinMax(x0, h, z0, x1, h + 0.1, z1, M.roof(), 4);
  b.boxMinMax(x0 - 0.1, h, z0 - 0.1, x1 + 0.1, h + 0.7, z0 + 0.15, M.stucco(color), 3);
  b.boxMinMax(x0 - 0.1, h, z1 - 0.15, x1 + 0.1, h + 0.7, z1 + 0.1, M.stucco(color), 3);
  b.boxMinMax(x0 - 0.1, h, z0, x0 + 0.15, h + 0.7, z1, M.stucco(color), 3);
  b.boxMinMax(x1 - 0.15, h, z0, x1 + 0.1, h + 0.7, z1, M.stucco(color), 3);
  crenellate(b, x0, facingZ < 0 ? z0 : z1, x1, facingZ < 0 ? z0 : z1, h + 0.7, color);
  // Front door with a carved frame.
  const dz = facingZ < 0 ? z0 - 0.06 : z1 + 0.06;
  const cx = (x0 + x1) / 2;
  b.boxMinMax(cx - 1.2, 0, dz - 0.08, cx + 1.2, 3.0, dz + 0.08, M.trim(trim));
  b.boxMinMax(cx - 0.95, 0, dz - 0.12, cx + 0.95, 2.7, dz + 0.12, solid('#5a3a22', 0.6));
  if (windTower) {
    const tx = x1 - 3;
    const tz = (z0 + z1) / 2;
    b.boxMinMax(tx - 1.3, h, tz - 1.3, tx + 1.3, h + 4.2, tz + 1.3, textured('barjeel', T.windTowerTexture(), { roughness: 1 }), 2.6, 4.2);
    b.boxMinMax(tx - 1.45, h + 4.2, tz - 1.45, tx + 1.45, h + 4.45, tz + 1.45, M.trim(trim));
    crenellate(b, tx - 1.3, tz - 1.3, tx + 1.3, tz - 1.3, h + 4.45, color, 0.6, 0.35);
  }
  P.acUnit(b, x0 + 1.5, h + 0.45, z1 - 1.5, 0);
  P.waterTank(b, x1 - 1.6, h + 0.1, z1 - 1.8);
  c.addBox(x0, z0, x1, z1, h + 1);
}

function villa(b: Batcher, c: Colliders, v: VillaLot, veg: P.Vegetation): HouseRefs | null {
  const wallH = 2.6;
  const gx = v.gateX;
  // Front wall in two pieces around the gate.
  wall(b, c, v.minX, v.minZ, gx - 2.4, v.minZ, wallH, v.wall, v.trim);
  wall(b, c, gx + 2.4, v.minZ, v.maxX, v.minZ, wallH, v.wall, v.trim);
  wall(b, c, v.minX, v.minZ, v.minX, v.maxZ, wallH, v.wall, v.trim, 0.35, false);
  wall(b, c, v.maxX, v.minZ, v.maxX, v.maxZ, wallH, v.wall, v.trim, 0.35, false);
  wall(b, c, v.minX, v.maxZ, v.maxX, v.maxZ, wallH, v.wall, v.trim, 0.35, false);
  gatePillars(b, c, gx, v.minZ, 'x', v.wall, v.trim);
  gate(b, gx, v.minZ, 'x', v.open ? '#6b4a2b' : rng.pick(['#5a3e2b', '#2f4f5f', '#3a3a3a', '#6b4a2b']), v.open);
  if (!v.open) c.addBox(gx - 1.8, v.minZ - 0.1, gx + 1.8, v.minZ + 0.1, 2.6);
  // Number plate.
  b.place(new PlaneGeometry(0.6, 0.3), textured(`plate${v.number}`, T.plateTexture(v.number), { roughness: 0.5 }), gx + 2.9, 2.0, v.minZ - 0.19, 0, { cast: false });
  // The family's own house (the open gate) can be walked into.
  const refs = v.open ? buildHouse(b, c, v.house, v.trim) : null;
  if (!v.open) house(b, c, v.minX + 3, v.minZ + 14, v.maxX - 3, v.maxZ - 2, v.house, v.trim, v.windTower);
  // Courtyard palms peeking over the wall.
  veg.palm(v.minX + 2.2, v.minZ + 3, 0.95);
  veg.palm(v.maxX - 2.2, v.minZ + 5, 1.05);
  return refs;
}

function homeCourtyard(b: Batcher, veg: P.Vegetation): void {
  ground(b, -83.8, 14.2, -56.2, 30, 0.02, textured('courtyard', T.tileTexture('#ece3d0', '#ddd1ba'), { roughness: 0.8 }), 2);
  // Pergola over the desk.
  const wood = M.wood();
  for (const [x, z] of [
    [-64, 22.3],
    [-59, 22.3],
    [-64, 26.8],
    [-59, 26.8],
  ])
    b.place(new BoxGeometry(0.14, 2.8, 0.14), wood, x, 1.4, z);
  for (let x = -64.2; x <= -58.8; x += 0.6) b.place(new BoxGeometry(0.08, 0.1, 4.8), wood, x, 2.85, 24.55);
  P.deskWithLaptop(b, HOME.desk.x, HOME.desk.z, Math.PI);
  // Swing bench and a rug.
  b.place(new BoxGeometry(3, 0.03, 2), solid('#7b2f2a', 0.95), -76, 0.04, 24.5, 0, { cast: false });
  P.bench(b, -76, 26.6, Math.PI);
  veg.shrub(-66, 15.5, 0.8);
  veg.shrub(-74, 15.5, 0.8);
}

/** A notice board on two posts: «لوحة الوظائف», with pinned job ads. */
function jobBoard(b: Batcher, c: Colliders, x: number, z: number): void {
  for (const dx of [-1.15, 1.15]) b.place(new BoxGeometry(0.1, 2.4, 0.1), M.darkMetal(), x + dx, 1.2, z);
  b.place(new BoxGeometry(2.4, 1.3, 0.08), solid('#b98a55', 0.9), x, 1.55, z);
  const head = T.signTexture('لوحة الوظائف', '#1e7b4e', '#ffffff', 'JOBS');
  b.place(new PlaneGeometry(2.4, 0.45), registerNightGlow(new MeshStandardMaterial({ map: head, emissiveMap: head, emissive: new Color('#ffffff'), emissiveIntensity: 0.25 }), 1), x, 2.45, z + 0.05, 0, { cast: false });
  const papers = ['#fffaf0', '#fdf3c4', '#e8f4ff', '#ffe8e0', '#eaf7e6'];
  for (let i = 0; i < 6; i++) b.place(new PlaneGeometry(0.5, 0.42), solid(papers[i % papers.length], 0.9), x - 0.85 + (i % 3) * 0.85, 1.85 - Math.floor(i / 3) * 0.6, z + 0.05, 0, { cast: false, rotZ: (i % 2 ? 1 : -1) * 0.05 });
  c.addBox(x - 1.25, z - 0.12, x + 1.25, z + 0.12, 2.4);
}

// ---------------------------------------------------------------------------
// Mosque
// ---------------------------------------------------------------------------

function mosque(b: Batcher, c: Colliders): void {
  const cream = '#efe6d2';
  const hall = registerNightGlow(textured('mosqueWall', T.villaTextures().map, { color: cream, emissiveMap: T.villaTextures().emissive, emissive: '#ffe2a8' }), 0.6);
  const x0 = -120;
  const x1 = -98;
  const z0 = MOSQUE.minZ + 2;
  const z1 = -18;
  b.boxMinMax(x0, 0, z0, x1, 9, z1, hall, 5.5, 9);
  b.boxMinMax(x0 - 0.2, 9, z0 - 0.2, x1 + 0.2, 9.4, z1 + 0.2, M.trim('#c9b48a'));
  crenellate(b, x0, z1 + 0.1, x1, z1 + 0.1, 9.4, cream, 1.1, 0.6);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  b.cylinder(cx, 9.4, cz, 7.4, 1.8, M.stucco(cream), 24);
  b.place(new SphereGeometry(7.2, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), solid('#f4efe4', 0.5), cx, 11.2, cz, 0, { scale: 1 });
  b.cylinder(cx, 18.3, cz, 0.12, 2.2, solid('#d9b45a', 0.3, 0.8), 6);
  b.place(new TorusGeometry(0.45, 0.08, 6, 16, Math.PI * 1.4), solid('#d9b45a', 0.3, 0.8), cx, 20.9, cz, 0, { rotZ: 0.8 });
  // Minaret.
  const mx = -99.5;
  const mz = -16.5;
  b.boxMinMax(mx - 1.8, 0, mz - 1.8, mx + 1.8, 7, mz + 1.8, M.stucco(cream), 2);
  b.cylinder(mx, 7, mz, 1.35, 15, M.stucco(cream), 16, 1.1);
  b.cylinder(mx, 22, mz, 1.9, 0.7, M.trim('#c9b48a'), 16);
  crenellate(b, mx - 1.5, mz + 1.5, mx + 1.5, mz + 1.5, 22.7, cream, 0.5, 0.3);
  b.cylinder(mx, 22.7, mz, 0.95, 4.5, M.stucco(cream), 14, 0.85);
  b.place(new SphereGeometry(1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), solid('#f4efe4', 0.5), mx, 27.2, mz);
  b.cylinder(mx, 28.2, mz, 0.06, 1.6, solid('#d9b45a', 0.3, 0.8), 6);
  b.place(new TorusGeometry(0.28, 0.05, 6, 14, Math.PI * 1.4), solid('#d9b45a', 0.3, 0.8), mx, 30, mz, 0, { rotZ: 0.8 });
  // Courtyard and low wall with an arched gate.
  ground(b, x0 - 2, -18, x1 + 2, -10.05, 0.03, textured('mosqueTiles', T.tileTexture('#efe8da', '#e2d7c2'), { roughness: 0.7 }), 2);
  wall(b, c, x0 - 2, -18, x0 - 2, -10.4, 1.4, cream, '#c9b48a', 0.3, false);
  wall(b, c, x1 + 2, -18, x1 + 2, -10.4, 1.4, cream, '#c9b48a', 0.3, false);
  b.place(new BoxGeometry(5, 0.2, 2.2), solid('#d9cdb4', 0.8), cx, 0.1, -19, 0, { cast: false });
  c.addBox(x0, z0, x1, z1, 10);
  c.addBox(mx - 1.8, mz - 1.8, mx + 1.8, mz + 1.8, 28);
}

// ---------------------------------------------------------------------------
// Car wash, park, alley
// ---------------------------------------------------------------------------

function carwash(b: Batcher, c: Colliders): void {
  const { minX, maxX, minZ } = CARWASH;
  ground(b, minX, minZ, maxX, -10.05, 0.02, solid('#9e9a93', 0.95), 4);
  // Canopy on columns.
  const blue = solid('#1f5fa8', 0.5, 0.2);
  for (const x of [54, 69, 84])
    for (const z of [-28, -15]) {
      b.boxMinMax(x - 0.25, 0, z - 0.25, x + 0.25, 5, z + 0.25, M.white());
      c.addBox(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 5);
    }
  b.boxMinMax(52, 5, -30, 86, 5.35, -13.5, M.white());
  b.boxMinMax(52, 5.35, -13.8, 86, 6.4, -13.4, blue);
  const tex = T.signTexture('مغسلة البريق', '#1f5fa8', '#ffffff', 'AL BAREEQ CAR WASH');
  const sign = registerNightGlow(new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new Color('#ffffff'), emissiveIntensity: 0.25 }), 1.0);
  b.place(new PlaneGeometry(10, 1.875), sign, 69, 5.88, -13.38, 0, { cast: false });
  // Bay lines and drains.
  for (const x of [55.5, 69, 83]) b.boxMinMax(x - 0.08, 0.025, -29, x + 0.08, 0.035, -14, M.white(), 1, 1, { cast: false });
  for (const bay of CARWASH.bays) b.boxMinMax(bay.x - 0.6, 0.025, bay.z - 0.15, bay.x + 0.6, 0.04, bay.z + 0.15, M.darkMetal(), 1, 1, { cast: false });
  // Office booth.
  b.boxMinMax(86, 0, -18, 91, 3, -12.5, solid('#e9eef2', 0.6));
  b.boxMinMax(86.2, 1.0, -12.45, 90.8, 2.4, -12.4, M.glassDark(), 1, 1, { cast: false });
  c.addBox(86, -18, 91, -12.5, 3);
  // Walls around the lot.
  wall(b, c, minX, minZ, maxX, minZ, 2.2, '#d6d0c4', '#9e9a93', 0.3, false);
  wall(b, c, minX, minZ, minX, -10.4, 2.2, '#d6d0c4', '#9e9a93', 0.3, false);
  wall(b, c, maxX, minZ, maxX, -10.4, 2.2, '#d6d0c4', '#9e9a93', 0.3, false);
  // Buckets, a hose reel and a foam cannon.
  for (const [x, z, col] of [
    [57.5, -24, '#2b67b3'],
    [72, -24, '#d8352b'],
    [58, -24.6, '#f2c230'],
  ] as const)
    b.place(new CylinderGeometry(0.2, 0.16, 0.35, 10), solid(col, 0.6), x, 0.18, z);
  b.place(new TorusGeometry(0.4, 0.06, 8, 18), solid('#2a6a3a', 0.7), 54.6, 1.1, -27.6, Math.PI / 2);
  b.boxMinMax(54.3, 0, -28.2, 54.9, 1.6, -27.6, M.darkMetal());
}

function park(b: Batcher, c: Colliders, veg: P.Vegetation): void {
  const { minX, maxX, minZ, maxZ, gateMinX, gateMaxX } = PARK;
  ground(b, minX, minZ, maxX, maxZ, 0.03, M.grass(), 4);
  ground(b, gateMinX + 1, minZ, gateMaxX - 1, maxZ - 6, 0.045, M.paver(), 2);
  ground(b, gateMaxX - 1, 34, maxX - 4, 38, 0.046, M.paver(), 2);
  // Fence: posts and two rails, with an opening at the gate.
  const metal = solid('#2f4f3a', 0.5, 0.4);
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(len / 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      b.place(new BoxGeometry(0.08, 1.2, 0.08), metal, x0 + (x1 - x0) * t, 0.6, z0 + (z1 - z0) * t, 0, { cast: false });
    }
    const rot = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.5, 1.1]) b.place(new BoxGeometry(0.05, 0.05, len), metal, (x0 + x1) / 2, y, (z0 + z1) / 2, rot, { cast: false });
    c.addBox(Math.min(x0, x1) - 0.1, Math.min(z0, z1) - 0.1, Math.max(x0, x1) + 0.1, Math.max(z0, z1) + 0.1, 1.2);
  };
  fence(minX, minZ, gateMinX, minZ);
  fence(gateMaxX, minZ, maxX, minZ);
  fence(minX, minZ, minX, maxZ);
  fence(maxX, minZ, maxX, maxZ);
  fence(minX, maxZ, maxX, maxZ);
  P.playground(b, 96, 22);
  for (const [x, z, r] of [
    [86, 30, 0],
    [74, 40, Math.PI / 2],
    [104, 44, Math.PI],
    [92, 33, Math.PI],
  ])
    P.bench(b, x, z, r);
  for (const [x, z] of [
    [72, 20],
    [106, 18],
    [72, 47],
    [100, 49],
    [88, 46],
  ])
    veg.ghaf(x, z, 1 + rng.next() * 0.3);
  for (const [x, z] of [
    [75, 27],
    [85, 27],
    [110, 30],
    [90, 50],
  ])
    veg.palm(x, z, 1.1);
  for (let i = 0; i < 10; i++) veg.shrub(70 + rng.next() * 40, 16 + rng.next() * 34, 0.6 + rng.next() * 0.5);
  // Fountain.
  b.cylinder(80, 0, 40, 2.4, 0.5, M.stucco('#e8dfcc'), 20);
  b.place(new CircleGeometry(2.1, 20), solid('#4aa3c8', 0.1, 0.2), 80, 0.46, 40, 0, { rotX: -Math.PI / 2, cast: false });
  b.cylinder(80, 0.5, 40, 0.25, 1.2, M.stucco('#e8dfcc'), 10);
  c.addCircle(80, 40, 2.5);
  P.bin(b, 85, 15.5);
}

function alley(b: Batcher, c: Colliders): void {
  ground(b, -22, 10, -12, 80, 0.01, M.asphalt(), 4);
  // Walls that close the alley between the main villas and the alley houses.
  wall(b, c, -22, 44, -22, 48, 2.6, '#e2d6c0', '#4f6d7a', 0.35, false);
  wall(b, c, -12, 44, -12, 48, 2.6, '#dccaa6', '#6b4e2e', 0.35, false);
  wall(b, c, -22, 72, -22, 80, 2.6, '#e4d4b4', '#7a5c3c', 0.35, false);
  wall(b, c, -12, 72, -12, 80, 2.6, '#ddd2bf', '#6b4e2e', 0.35, false);
  for (const hse of ALLEY_HOUSES) {
    const { gate: gt } = hse;
    const trim = '#6b4e2e';
    if (gt.axis === 'z') {
      const wallX = gt.x;
      const otherX = wallX === hse.minX ? hse.maxX : hse.minX;
      wall(b, c, wallX, hse.minZ, wallX, gt.z - 2.4, 2.6, hse.wall, trim);
      wall(b, c, wallX, gt.z + 2.4, wallX, hse.maxZ, 2.6, hse.wall, trim);
      wall(b, c, otherX, hse.minZ, otherX, hse.maxZ, 2.6, hse.wall, trim, 0.35, false);
      wall(b, c, hse.minX, hse.minZ, hse.maxX, hse.minZ, 2.6, hse.wall, trim, 0.35, false);
      wall(b, c, hse.minX, hse.maxZ, hse.maxX, hse.maxZ, 2.6, hse.wall, trim, 0.35, false);
      gatePillars(b, c, wallX, gt.z, 'z', hse.wall, trim);
      gate(b, wallX, gt.z, 'z', rng.pick(['#5a3e2b', '#2f4f5f']), false);
      c.addBox(wallX - 0.1, gt.z - 1.8, wallX + 0.1, gt.z + 1.8, 2.6);
      // The house sits back from the gate wall, on the far side of the plot.
      const westPlot = wallX === hse.maxX;
      const hx0 = westPlot ? hse.minX + 3 : wallX + 9;
      const hx1 = westPlot ? wallX - 9 : hse.maxX - 3;
      house(b, c, hx0, hse.minZ + 3, hx1, hse.maxZ - 3, hse.house, trim, false, 1);
      b.place(new PlaneGeometry(0.6, 0.3), textured(`plate${hse.number}`, T.plateTexture(hse.number), { roughness: 0.5 }), wallX + (westPlot ? 0.19 : -0.19), 2.0, gt.z + 2.9, westPlot ? Math.PI / 2 : -Math.PI / 2, { cast: false });
    } else {
      wall(b, c, hse.minX, gt.z, gt.x - 2.4, gt.z, 2.6, hse.wall, trim);
      wall(b, c, gt.x + 2.4, gt.z, hse.maxX, gt.z, 2.6, hse.wall, trim);
      wall(b, c, hse.minX, hse.minZ, hse.minX, hse.maxZ, 2.6, hse.wall, trim, 0.35, false);
      wall(b, c, hse.maxX, hse.minZ, hse.maxX, hse.maxZ, 2.6, hse.wall, trim, 0.35, false);
      wall(b, c, hse.minX, hse.maxZ, hse.maxX, hse.maxZ, 2.6, hse.wall, trim, 0.35, false);
      gatePillars(b, c, gt.x, gt.z, 'x', hse.wall, trim);
      gate(b, gt.x, gt.z, 'x', '#6b4a2b', false);
      c.addBox(gt.x - 1.8, gt.z - 0.1, gt.x + 1.8, gt.z + 0.1, 2.6);
      house(b, c, hse.minX + 4, gt.z + 8, hse.maxX - 4, hse.maxZ - 2, hse.house, trim, true);
      b.place(new PlaneGeometry(0.6, 0.3), textured(`plate${hse.number}`, T.plateTexture(hse.number), { roughness: 0.5 }), gt.x + 2.9, 2.0, gt.z - 0.19, 0, { cast: false });
    }
  }
}

// ---------------------------------------------------------------------------
// Skyline
// ---------------------------------------------------------------------------

/** Distant towers drawn unlit and hazed toward the horizon colour. */
export class Skyline {
  readonly group = new Group();
  private readonly mats: { mat: MeshBasicMaterial; base: Color; win: MeshBasicMaterial }[] = [];

  constructor() {
    const r = new Rng(77);
    const winTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 256;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 64, 256);
      for (let y = 4; y < 256; y += 8)
        for (let x = 4; x < 64; x += 8) {
          if (r.chance(0.45)) {
            ctx.fillStyle = r.pick(['#ffd28a', '#fff0c8', '#bfe0ff']);
            ctx.fillRect(x, y, 4, 4);
          }
        }
      return new CanvasTexture(cv);
    })();
    winTex.wrapS = winTex.wrapT = RepeatWrapping;
    const add = (x: number, z: number, w: number, d: number, h: number, base: string, y0 = 0) => {
      const mat = new MeshBasicMaterial({ color: base, fog: false });
      const win = new MeshBasicMaterial({ map: winTex, transparent: true, opacity: 0, fog: false, blending: AdditiveBlending, depthWrite: false });
      this.mats.push({ mat, base: new Color(base), win });
      const m = new Mesh(new BoxGeometry(w, h, d), mat);
      m.position.set(x, y0 + h / 2, z);
      const wm = new Mesh(new BoxGeometry(w + 0.5, h, d + 0.5), win);
      wm.position.copy(m.position);
      this.group.add(m, wm);
    };
    for (let i = 0; i < 26; i++) {
      const x = -340 + i * 26 + r.range(-8, 8);
      const z = -300 - r.range(0, 140);
      const h = r.range(40, 150);
      add(x, z, r.range(14, 26), r.range(14, 26), h, r.pick(['#8d9aa8', '#a3adb7', '#7d8a99', '#9aa6b0']));
    }
    // A supertall needle tower on the horizon.
    const sx = 140;
    const sz = -420;
    let y = 0;
    let w = 40;
    for (let k = 0; k < 7; k++) {
      const h = 60 - k * 4;
      add(sx, sz, w, w, h, '#a9b6c2', y);
      y += h;
      w *= 0.78;
    }
    add(sx, sz, 2.5, 2.5, 160, '#c2ccd5', y);
    // Dunes to the south.
    for (let i = 0; i < 14; i++) {
      const g = new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const m = new Mesh(g, new MeshStandardMaterial({ color: '#d9bd8c', roughness: 1 }));
      m.scale.set(r.range(40, 90), r.range(8, 22), r.range(30, 60));
      m.position.set(-300 + i * 48 + r.range(-10, 10), -1, 150 + r.range(0, 120));
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  update(fog: Color, night: number): void {
    for (const m of this.mats) {
      m.mat.color.copy(m.base).multiplyScalar(1 - night * 0.82).lerp(fog, 0.55);
      m.win.opacity = night * 0.9;
    }
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildWorld(scene: Scene): WorldRefs {
  const b = new Batcher();
  const colliders = new Colliders(BOUNDS);
  const veg = new P.Vegetation();
  const lamps = new P.Lamps();

  // Ground, road and sidewalks.
  ground(b, -400, -360, 400, 360, 0, M.sand(), 6);
  ground(b, -190, -6, 190, 6, 0.01, M.road(), 16, 12);
  b.boxMinMax(-124, 0, -10, 114, 0.15, -6, M.paver(), 2, 2, { cast: false });
  b.boxMinMax(-124, 0, 6, 114, 0.15, 10, M.paver(), 2, 2, { cast: false });
  b.boxMinMax(-124, 0, -6.2, 114, 0.17, -6, M.curb(), 2, 1, { cast: false });
  b.boxMinMax(-124, 0, 6, 114, 0.17, 6.2, M.curb(), 2, 1, { cast: false });
  // Zebra crossings.
  for (const cx of [-17, -86, 46])
    for (let i = 0; i < 6; i++) b.boxMinMax(cx - 2 + 0.05, 0.015, -5.4 + i * 1.9, cx + 2, 0.02, -4.6 + i * 1.9, M.white(), 1, 1, { cast: false });

  // Ends of the street: barriers and dunes.
  for (const ex of [BOUNDS.minX - 1, BOUNDS.maxX + 1]) {
    for (let z = -10; z <= 10; z += 2.1) P.jerseyBarrier(b, ex, z, Math.PI / 2);
    colliders.addBox(ex - 0.5, -12, ex + 0.5, 14, 1);
  }
  // Behind the shops, an endless wall closes the north side; behind the villas the south.
  colliders.addBox(BOUNDS.minX - 2, -60, BOUNDS.maxX + 2, -36, 4);

  SHOP_LOTS.forEach((lot, i) => shop(b, colliders, lot, i % 4));
  // Close the narrow gaps between neighbouring buildings so nobody slips behind them.
  const northEdges = [MOSQUE.maxX, ...SHOP_LOTS.flatMap((l) => [l.minX, l.maxX]), CARWASH.minX];
  for (let i = 0; i + 1 < northEdges.length; i += 2) {
    const [x0, x1] = [northEdges[i], northEdges[i + 1]];
    if (x1 - x0 > 0.05) {
      b.boxMinMax(x0, 0, -24, x1, 4, -10.4, M.stucco('#e3d8c2'), 3);
      colliders.addBox(x0, -24, x1, -10.4, 4);
    }
  }
  // A two-storey block fills the plot behind the ATM kiosk.
  b.boxMinMax(-71, 0, -24, -67.5, 6.8, -13, M.stucco('#ddd0b8'), 3);
  colliders.addBox(-71, -24, -67.5, -13, 6.8);
  const southEdges = [BOUNDS.minX - 1, ...VILLA_LOTS.flatMap((v) => [v.minX, v.maxX]), PARK.minX, PARK.maxX, BOUNDS.maxX + 1];
  for (let i = 0; i + 1 < southEdges.length; i += 2) {
    const [x0, x1] = [southEdges[i], southEdges[i + 1]];
    if (x1 - x0 > 0.05 && !(x0 <= -22 && x1 >= -12)) wall(b, colliders, x0, 14, x1, 14, 2.6, '#e0d4bc', '#8a6a3f');
  }
  let house: HouseRefs | null = null;
  for (const v of VILLA_LOTS) house = villa(b, colliders, v, veg) ?? house;
  homeCourtyard(b, veg);
  mosque(b, colliders);
  carwash(b, colliders);
  park(b, colliders, veg);
  alley(b, colliders);

  // Recycling machine and the job board in front of the company tower; the bus stop at the far end.
  colliders.addBox(-8, -36, 50, -24, 6);
  P.recycleMachine(b, 33, -9.6);
  colliders.addBox(32.2, -10.1, 33.8, -9.1, 2.2);
  jobBoard(b, colliders, COMPANY.board.x, COMPANY.board.z);
  P.busStop(b, 100, -8.4);
  colliders.addBox(96.4, -9.7, 103.6, -9.4, 2.6);

  // Grandpa's majlis on the strip in front of his house.
  P.majlis(b, -104, 11.2);
  P.streetBin(b, HOME.streetBin.x, HOME.streetBin.z);
  colliders.addBox(HOME.streetBin.x - 0.7, HOME.streetBin.z - 0.5, HOME.streetBin.x + 0.7, HOME.streetBin.z + 0.5, 1.4);

  // Karak café seating.
  for (const x of [-63, -59.5, -50]) P.plasticTable(b, x, -7.6);
  for (const x of [-63, -59.5, -50]) colliders.addCircle(x, -7.6, 0.55);

  // Lamps, palms, bins along the street.
  for (let x = -118; x <= 108; x += 18) {
    lamps.add(x, -6.6, 0);
    lamps.add(x + 9, 6.6, Math.PI);
    colliders.addCircle(x, -6.6, 0.2);
    colliders.addCircle(x + 9, 6.6, 0.2);
  }
  for (const z of [24, 44, 64]) {
    lamps.add(-21.6, z, Math.PI / 2);
    colliders.addCircle(-21.6, z, 0.2);
  }
  for (const [x, z] of [
    [80, 22],
    [80, 32],
    [94, 36],
  ]) {
    lamps.add(x - 1.2, z, Math.PI / 2);
    colliders.addCircle(x - 1.2, z, 0.2);
  }
  const avoid = (x: number) => VILLA_LOTS.some((v) => Math.abs(x - v.gateX) < 4) || (x > -25 && x < -9) || (x > 74 && x < 86) || Math.abs(x + 104) < 4 || Math.abs(x - HOME.streetBin.x) < 2 || Math.abs(x - 8.5) < 3.5;
  for (let x = -118; x <= 110; x += 11) {
    if (!avoid(x)) veg.palm(x, 12.2, 0.9 + rng.next() * 0.25);
  }
  for (const x of [-121, -96, 47.5, 51.5, 93]) veg.palm(x, -12.5, 1.0);
  for (let x = -112; x < 110; x += 31) {
    P.bin(b, x, 9.4);
    colliders.addCircle(x, 9.4, 0.35);
  }

  // Parked cars along the street.
  const parked: [number, number, number, P.CarStyle][] = [
    [-95, 12.1, 0, 'suv'],
    [-30, 12.1, Math.PI, 'sedan'],
    [38, 12.1, 0, 'suv'],
    [60, 12.1, Math.PI, 'pickup'],
    [-79, -4.9, 0, 'sedan'],
    [-40, -4.9, 0, 'taxi'],
    [16, -4.9, Math.PI, 'suv'],
  ];
  for (const [x, z, rot, style] of parked) {
    const car = P.makeCar(style, rng.pick(P.CAR_COLORS));
    car.position.set(x, 0, z);
    car.rotation.y = rot;
    P.bakeGroup(b, car);
    const L = car.userData.length / 2;
    const W = car.userData.width / 2;
    colliders.addBox(x - L, z - W, x + L, z + W, 1.6);
  }

  // Dynamic props.
  const plants = HOME.plants.map((p, i) => {
    const pl = P.makePlant(new Rng(400 + i));
    pl.group.position.set(p.x, 0, p.z);
    scene.add(pl.group);
    colliders.addCircle(p.x, p.z, 0.45);
    return { x: p.x, z: p.z, setWater: pl.setWater, group: pl.group };
  });
  const stall = P.makeStall();
  stall.position.set(STALL_SPOT.x, 0.0, STALL_SPOT.z + 0.3);
  stall.visible = false;
  scene.add(stall);
  const hamadCar = P.makeCar('suv', '#f4f4f2');
  hamadCar.position.set(8.5, 0, 12.1);
  hamadCar.rotation.y = Math.PI;
  scene.add(hamadCar);
  colliders.addBox(8.5 - 2.45, 12.1 - 1.0, 8.5 + 2.45, 12.1 + 1.0, 1.6);
  const washCar = P.makeCar('sedan', '#20406b');
  washCar.position.set(CARWASH.bays[0].x, 0, CARWASH.bays[0].z);
  washCar.rotation.y = Math.PI / 2;
  scene.add(washCar);
  colliders.addBox(CARWASH.bays[0].x - 1.0, CARWASH.bays[0].z - 2.4, CARWASH.bays[0].x + 1.0, CARWASH.bays[0].z + 2.4, 1.5);

  for (const o of veg.obstacles) colliders.addCircle(o.x, o.z, o.r);
  scene.add(b.build(), veg.build(), lamps.build(), house!.upper);
  const skyline = new Skyline();
  scene.add(skyline.group);
  return { colliders, lamps: lamps.positions, plants, stall, hamadCar, washCar, skyline, house: house! };
}
