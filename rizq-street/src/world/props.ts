/**
 * Street furniture and vegetation: palms, ghaf trees, lamps, benches, bins, the ATM,
 * the recycling machine, cars, the stall cart, plant pots. Static props go into the
 * batcher; repeated ones are instanced; props that change are returned as groups.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  Euler,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { Batcher } from './batch';
import { M, registerNightGlow, solid, textured } from './materials';
import * as T from './textures';

const UP = new Vector3(0, 1, 0);

function moved(g: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): BufferGeometry {
  const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const clean = parts.map((g) => {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    return g.index ? g.toNonIndexed() : g;
  });
  return mergeGeometries(clean, false)!;
}

// ---------------------------------------------------------------------------
// Vegetation (instanced)
// ---------------------------------------------------------------------------

function palmTemplate(): { trunk: BufferGeometry; fronds: BufferGeometry } {
  const trunkParts: BufferGeometry[] = [];
  const segs = 7;
  const h = 7.5;
  for (let i = 0; i < segs; i++) {
    const y0 = (i / segs) * h;
    const bend = Math.pow(i / segs, 2) * 0.6;
    const r0 = 0.24 - i * 0.012;
    const g = new CylinderGeometry(r0 - 0.012, r0, h / segs + 0.02, 9, 1, true);
    trunkParts.push(moved(g, bend, y0 + h / segs / 2, 0));
  }
  const top = new Vector3(0.6, h, 0);
  const frondParts: BufferGeometry[] = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const len = 3.4 + (i % 3) * 0.3;
    const g = new PlaneGeometry(len, 0.95, 8, 1);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + len / 2; // 0 at the trunk
      const droop = 0.12 * x * x;
      pos.setXYZ(k, x, -droop + Math.abs(pos.getY(k)) * 0.15, pos.getY(k));
    }
    g.computeVertexNormals();
    const tilt = i < 4 ? -0.5 : i < 9 ? -0.15 : 0.25;
    frondParts.push(moved(g, top.x, top.y, top.z, 0, (i / n) * Math.PI * 2 + i * 0.3, tilt));
  }
  // Date cluster.
  frondParts.push(moved(new SphereGeometry(0.35, 6, 4), top.x + 0.2, top.y - 0.45, 0.1));
  return { trunk: merge(trunkParts), fronds: merge(frondParts) };
}

export class Vegetation {
  readonly group = new Group();
  private palms: { x: number; z: number; s: number; r: number }[] = [];
  private trees: { x: number; z: number; s: number }[] = [];
  private shrubs: { x: number; z: number; s: number }[] = [];

  palm(x: number, z: number, s = 1, r = Math.random() * Math.PI * 2): void {
    this.palms.push({ x, z, s, r });
  }

  ghaf(x: number, z: number, s = 1): void {
    this.trees.push({ x, z, s });
  }

  shrub(x: number, z: number, s = 1): void {
    this.shrubs.push({ x, z, s });
  }

  build(): Group {
    const m = new Matrix4();
    const q = new Quaternion();
    const v = new Vector3();
    const sc = new Vector3();
    const tpl = palmTemplate();
    const trunkMat = textured('bark', T.barkTexture(), { roughness: 1 });
    const frondMat = textured('frond', T.frondTexture(), { alphaTest: 0.5, doubleSide: true, roughness: 0.9 });
    frondMat.side = DoubleSide;
    const trunks = new InstancedMesh(tpl.trunk, trunkMat, this.palms.length);
    const fronds = new InstancedMesh(tpl.fronds, frondMat, this.palms.length);
    this.palms.forEach((p, i) => {
      q.setFromAxisAngle(UP, p.r);
      m.compose(v.set(p.x, 0, p.z), q, sc.set(p.s, p.s, p.s));
      trunks.setMatrixAt(i, m);
      fronds.setMatrixAt(i, m);
    });
    trunks.castShadow = fronds.castShadow = true;
    trunks.receiveShadow = true;
    this.group.add(trunks, fronds);

    const canopy = new IcosahedronGeometry(1, 1);
    const canopyParts = [moved(canopy.clone().scale(2.6, 1.3, 2.6), 0, 4.2, 0), moved(canopy.clone().scale(1.8, 1.0, 1.8), 1.4, 4.9, 0.6), moved(canopy.clone().scale(1.7, 0.9, 1.7), -1.3, 4.7, -0.7)];
    const canopyGeo = merge(canopyParts);
    const trunkGeo = merge([moved(new CylinderGeometry(0.16, 0.26, 3.4, 7), 0, 1.7, 0), moved(new CylinderGeometry(0.08, 0.12, 2, 5), 0.7, 3.4, 0, 0, 0, -0.7)]);
    const leafMat = new MeshStandardMaterial({ color: '#6d8f45', roughness: 1, flatShading: true });
    const treeTrunks = new InstancedMesh(trunkGeo, solid('#6b5038', 1), this.trees.length);
    const treeTops = new InstancedMesh(canopyGeo, leafMat, this.trees.length);
    this.trees.forEach((t, i) => {
      q.setFromAxisAngle(UP, i * 1.7);
      m.compose(v.set(t.x, 0, t.z), q, sc.set(t.s, t.s, t.s));
      treeTrunks.setMatrixAt(i, m);
      treeTops.setMatrixAt(i, m);
    });
    treeTrunks.castShadow = treeTops.castShadow = true;
    this.group.add(treeTrunks, treeTops);

    const shrubGeo = new IcosahedronGeometry(0.7, 1);
    const shrubs = new InstancedMesh(shrubGeo, new MeshStandardMaterial({ color: '#5d8a3c', roughness: 1, flatShading: true }), this.shrubs.length);
    this.shrubs.forEach((s, i) => {
      m.compose(v.set(s.x, 0.45 * s.s, s.z), q.identity(), sc.set(s.s, s.s * 0.8, s.s));
      shrubs.setMatrixAt(i, m);
    });
    shrubs.castShadow = true;
    this.group.add(shrubs);
    return this.group;
  }

  /** Trunk positions for collisions. */
  get obstacles(): { x: number; z: number; r: number }[] {
    return [...this.palms.map((p) => ({ x: p.x, z: p.z, r: 0.35 * p.s })), ...this.trees.map((t) => ({ x: t.x, z: t.z, r: 0.35 * t.s }))];
  }
}

// ---------------------------------------------------------------------------
// Lamps (instanced poles, glowing heads)
// ---------------------------------------------------------------------------

export class Lamps {
  readonly positions: Vector3[] = [];
  private readonly items: { x: number; z: number; dir: number }[] = [];

  add(x: number, z: number, dir: number): void {
    this.items.push({ x, z, dir });
    this.positions.push(new Vector3(x + Math.sin(dir) * 1.6, 7.6, z + Math.cos(dir) * 1.6));
  }

  build(): Group {
    const group = new Group();
    const pole = merge([new CylinderGeometry(0.07, 0.11, 8, 8).translate(0, 4, 0), new BoxGeometry(0.08, 0.08, 1.8).translate(0, 7.9, 0.9), new CylinderGeometry(0.2, 0.2, 0.3, 8).translate(0, 0.15, 0)]);
    const head = new BoxGeometry(0.34, 0.12, 0.6).translate(0, 7.78, 1.65);
    const poles = new InstancedMesh(pole, M.darkMetal(), this.items.length);
    const glow = registerNightGlow(solid('#fff6dc', 0.4, 0, { emissive: '#ffcf7a', emissiveIntensity: 0 }), 2.2);
    const heads = new InstancedMesh(head, glow, this.items.length);
    const m = new Matrix4();
    const q = new Quaternion();
    this.items.forEach((it, i) => {
      q.setFromAxisAngle(UP, it.dir);
      m.compose(new Vector3(it.x, 0, it.z), q, new Vector3(1, 1, 1));
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    group.add(poles, heads);
    return group;
  }
}

// ---------------------------------------------------------------------------
// Static furniture (batched)
// ---------------------------------------------------------------------------

export function bench(b: Batcher, x: number, z: number, rot: number): void {
  const wood = M.wood();
  const metal = M.darkMetal();
  const g = merge([new BoxGeometry(1.8, 0.08, 0.45).translate(0, 0.45, 0), new BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.75, -0.22)]);
  b.place(g, wood, x, 0, z, rot);
  const legs = merge([new BoxGeometry(0.06, 0.45, 0.45).translate(-0.8, 0.22, 0), new BoxGeometry(0.06, 0.45, 0.45).translate(0.8, 0.22, 0)]);
  b.place(legs, metal, x, 0, z, rot);
}

export function bin(b: Batcher, x: number, z: number, color = '#2f6f4f'): void {
  b.place(new CylinderGeometry(0.32, 0.28, 0.95, 10), solid(color, 0.6), x, 0.48, z);
  b.place(new CylinderGeometry(0.34, 0.34, 0.08, 10), solid('#1f1f1f', 0.6), x, 0.98, z);
}

/** Big wheeled municipal bin (the one trash bags go into). */
export function streetBin(b: Batcher, x: number, z: number): void {
  b.place(new BoxGeometry(1.4, 1.2, 1.0), solid('#2e7d4f', 0.6), x, 0.75, z);
  b.place(new BoxGeometry(1.5, 0.1, 1.1), solid('#245f3c', 0.6), x, 1.38, z, 0, { rotX: -0.12 });
  for (const dx of [-0.55, 0.55]) b.place(new CylinderGeometry(0.12, 0.12, 0.1, 10), M.black(), x + dx, 0.12, z + 0.45, 0, { rotX: Math.PI / 2 });
}

export function atm(b: Batcher, x: number, z: number): void {
  b.place(new BoxGeometry(1.0, 2.0, 0.7), solid('#20406b', 0.5, 0.3), x, 1.0, z);
  const screen = registerNightGlow(solid('#7fd3ff', 0.2, 0, { emissive: '#4fb8ff', emissiveIntensity: 0.8 }), 1.4);
  b.place(new BoxGeometry(0.5, 0.36, 0.04), screen, x, 1.35, z + 0.36, 0, { cast: false });
  b.place(new BoxGeometry(0.6, 0.06, 0.25), M.metal(), x, 1.0, z + 0.42);
  b.place(new BoxGeometry(1.1, 0.25, 0.75), solid('#e8c33a', 0.5), x, 2.1, z);
}

export function recycleMachine(b: Batcher, x: number, z: number): void {
  b.place(new BoxGeometry(1.6, 2.1, 0.9), solid('#2f8a57', 0.55, 0.2), x, 1.05, z);
  b.place(new BoxGeometry(1.0, 0.5, 0.05), registerNightGlow(solid('#d9f5e3', 0.3, 0, { emissive: '#7ff0b0', emissiveIntensity: 0.5 }), 1.2), x, 1.55, z + 0.46, 0, { cast: false });
  b.place(new CylinderGeometry(0.18, 0.18, 0.06, 16), M.black(), x - 0.4, 0.95, z + 0.46, 0, { rotX: Math.PI / 2 });
  b.place(new CylinderGeometry(0.18, 0.18, 0.06, 16), M.black(), x + 0.4, 0.95, z + 0.46, 0, { rotX: Math.PI / 2 });
  // Recycling symbol made of three bars.
  for (let i = 0; i < 3; i++) b.place(new BoxGeometry(0.3, 0.06, 0.02), M.white(), x + Math.cos((i * Math.PI * 2) / 3) * 0.12, 0.45 + Math.sin((i * Math.PI * 2) / 3) * 0.12, z + 0.46, 0, { rotZ: (i * Math.PI * 2) / 3 + Math.PI / 2 });
}

export function busStop(b: Batcher, x: number, z: number): void {
  const metal = M.metal();
  for (const dx of [-3.6, 3.6]) b.place(new CylinderGeometry(0.06, 0.06, 2.6, 8), metal, x + dx, 1.3, z - 0.6);
  b.place(new BoxGeometry(7.6, 0.12, 2.0), solid('#e9eef2', 0.4, 0.2), x, 2.65, z - 0.2);
  b.place(new BoxGeometry(7.4, 2.0, 0.05), solid('#a9c9de', 0.1, 0.1), x, 1.5, z - 1.15, 0, { cast: false });
  b.place(new BoxGeometry(4, 0.08, 0.5), M.wood(), x, 0.5, z - 0.85);
  // Air-conditioned shelter sign.
  b.place(new BoxGeometry(1.2, 0.6, 0.08), solid('#2b67b3', 0.5), x + 3.0, 2.2, z + 0.2);
}

export function jerseyBarrier(b: Batcher, x: number, z: number, rot: number): void {
  const g = merge([new BoxGeometry(2, 0.5, 0.6).translate(0, 0.25, 0), new BoxGeometry(2, 0.4, 0.3).translate(0, 0.7, 0)]);
  b.place(g, solid('#d9d4c8', 0.95), x, 0, z, rot);
  b.place(new BoxGeometry(2.02, 0.12, 0.62), solid('#d8352b', 0.7), x, 0.15, z, rot);
}

/** A rooftop air-conditioner unit (also stuck to walls everywhere in the Gulf). */
export function acUnit(b: Batcher, x: number, y: number, z: number, rot = 0): void {
  b.place(new BoxGeometry(0.9, 0.55, 0.6), solid('#e9e9e6', 0.6), x, y, z, rot);
  b.place(new CylinderGeometry(0.2, 0.2, 0.02, 14), solid('#4a4a4a', 0.6), x, y, z + Math.cos(rot) * 0.31, rot, { rotX: Math.PI / 2 });
}

export function waterTank(b: Batcher, x: number, y: number, z: number): void {
  b.place(new CylinderGeometry(0.75, 0.75, 1.5, 14), solid('#e9e6df', 0.6), x, y + 0.95, z);
  b.place(new CylinderGeometry(0.8, 0.8, 0.2, 14), solid('#3b6fb0', 0.6), x, y + 1.75, z);
  b.place(new BoxGeometry(1.4, 0.2, 1.4), M.darkMetal(), x, y + 0.1, z);
}

export function satelliteDish(b: Batcher, x: number, y: number, z: number, rot: number): void {
  const dish = new SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, 0.6);
  b.place(dish, M.white(), x, y + 0.9, z, rot, { rotX: -1.1 });
  b.place(new CylinderGeometry(0.03, 0.04, 0.9, 6), M.metal(), x, y + 0.45, z);
}

/** Low cushions and a carpet under a shade sail: grandpa's open-air majlis. */
export function majlis(b: Batcher, x: number, z: number): void {
  b.place(new BoxGeometry(4.2, 0.03, 3.0), solid('#8a2f2a', 0.95), x, 0.02, z + 0.2, 0, { cast: false });
  b.place(new BoxGeometry(4.0, 0.25, 0.7), solid('#b8452f', 0.95), x, 0.14, z + 1.3);
  b.place(new BoxGeometry(4.0, 0.5, 0.25), solid('#c45c3a', 0.95), x, 0.4, z + 1.6);
  for (const dx of [-1.9, 1.9]) b.place(new BoxGeometry(0.4, 0.3, 0.4), solid('#e0b04a', 0.9), x + dx, 0.3, z + 1.25);
  for (const [dx, dz] of [
    [-2.4, -1.2],
    [2.4, -1.2],
    [-2.4, 1.8],
    [2.4, 1.8],
  ])
    b.place(new CylinderGeometry(0.05, 0.05, 3, 6), M.wood(), x + dx, 1.5, z + dz);
  b.place(new BoxGeometry(5.0, 0.04, 3.2), solid('#efe6d2', 0.9), x, 3.0, z + 0.3, 0, { rotX: 0.08 });
  // Dallah and cups on a small tray.
  b.place(new CylinderGeometry(0.35, 0.35, 0.04, 16), solid('#c9a54a', 0.4, 0.6), x + 0.6, 0.06, z + 0.3);
  b.place(new CylinderGeometry(0.06, 0.1, 0.25, 10), solid('#d4b25a', 0.3, 0.8), x + 0.6, 0.2, z + 0.3);
}

export function deskWithLaptop(b: Batcher, x: number, z: number, rot: number): void {
  b.place(new BoxGeometry(1.4, 0.06, 0.7), M.wood(), x, 0.75, z, rot);
  for (const [dx, dz] of [
    [-0.62, -0.28],
    [0.62, -0.28],
    [-0.62, 0.28],
    [0.62, 0.28],
  ])
    b.place(new BoxGeometry(0.05, 0.75, 0.05), M.wood(), x + Math.cos(rot) * dx + Math.sin(rot) * dz, 0.37, z - Math.sin(rot) * dx + Math.cos(rot) * dz, rot);
  b.place(new BoxGeometry(0.42, 0.02, 0.3), solid('#2b2d31', 0.4, 0.4), x, 0.79, z, rot);
  const screen = registerNightGlow(solid('#2b2d31', 0.3, 0.2, { emissive: '#6fb6ff', emissiveIntensity: 0.6 }), 1.0);
  b.place(new BoxGeometry(0.42, 0.28, 0.02), screen, x + Math.sin(rot) * -0.15, 0.94, z + Math.cos(rot) * -0.15, rot, { rotX: -0.25 });
  // Chair.
  b.place(new BoxGeometry(0.5, 0.06, 0.5), solid('#3b3b3b', 0.7), x + Math.sin(rot) * 0.6, 0.48, z + Math.cos(rot) * 0.6, rot);
  b.place(new BoxGeometry(0.5, 0.6, 0.06), solid('#3b3b3b', 0.7), x + Math.sin(rot) * 0.85, 0.8, z + Math.cos(rot) * 0.85, rot);
}

export function plasticTable(b: Batcher, x: number, z: number): void {
  const plastic = solid('#e9e9e4', 0.6);
  b.place(new CylinderGeometry(0.45, 0.45, 0.04, 14), plastic, x, 0.72, z);
  b.place(new CylinderGeometry(0.04, 0.04, 0.72, 6), plastic, x, 0.36, z);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    const cx = x + Math.cos(a) * 0.75;
    const cz = z + Math.sin(a) * 0.75;
    b.place(new BoxGeometry(0.42, 0.05, 0.42), plastic, cx, 0.44, cz, -a);
    b.place(new BoxGeometry(0.42, 0.45, 0.05), plastic, cx + Math.cos(a) * 0.2, 0.68, cz + Math.sin(a) * 0.2, -a + Math.PI / 2);
  }
  // Paper cups of karak.
  b.place(new CylinderGeometry(0.04, 0.03, 0.1, 8), solid('#f3e6c8', 0.8), x + 0.1, 0.79, z);
}

export function playground(b: Batcher, x: number, z: number): void {
  const red = solid('#d8352b', 0.6);
  const blue = solid('#2b67b3', 0.6);
  const yellow = solid('#f2c230', 0.6);
  // Slide tower.
  for (const [dx, dz] of [
    [0, 0],
    [1.4, 0],
    [0, 1.4],
    [1.4, 1.4],
  ])
    b.place(new CylinderGeometry(0.07, 0.07, 2.4, 8), blue, x + dx, 1.2, z + dz);
  b.place(new BoxGeometry(1.6, 0.1, 1.6), yellow, x + 0.7, 1.5, z + 0.7);
  b.place(new ConeGeometry(1.25, 0.8, 4), red, x + 0.7, 2.65, z + 0.7, Math.PI / 4);
  b.place(new BoxGeometry(0.8, 0.06, 3.2), yellow, x + 0.7, 0.8, z + 3.0, 0, { rotX: 0.5 });
  // Swings.
  b.place(new BoxGeometry(3.6, 0.1, 0.1), blue, x + 5, 2.4, z + 1);
  for (const dx of [3.3, 6.7]) b.place(new CylinderGeometry(0.06, 0.06, 2.4, 6), blue, x + dx, 1.2, z + 1);
  for (const dx of [4.3, 5.7]) b.place(new BoxGeometry(0.5, 0.05, 0.3), red, x + dx, 0.5, z + 1);
  // Soft rubber ground.
  b.place(new CircleGeometry(4.5, 24), solid('#c7553b', 1), x + 3, 0.02, z + 1.5, 0, { rotX: -Math.PI / 2, cast: false });
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

export type CarStyle = 'sedan' | 'suv' | 'pickup' | 'taxi';

export const CAR_COLORS = ['#f4f4f2', '#f4f4f2', '#1d1f22', '#9aa2aa', '#7b1e1e', '#20406b', '#c8b48a', '#f4f4f2'];

/** A car as a group; the body faces +x (its length runs along x). */
export function makeCar(style: CarStyle, color: string): Group {
  const g = new Group();
  const L = style === 'suv' ? 4.9 : style === 'pickup' ? 5.2 : 4.6;
  const W = style === 'suv' ? 1.95 : 1.8;
  const bodyH = style === 'suv' ? 0.95 : 0.7;
  const ride = style === 'suv' ? 0.45 : 0.32;
  const paint = solid(style === 'taxi' ? '#e8e8e4' : color, 0.35, 0.35);
  const body = new Mesh(new BoxGeometry(L, bodyH, W), paint);
  body.position.y = ride + bodyH / 2;
  g.add(body);
  const cabinL = style === 'pickup' ? 2.2 : style === 'suv' ? 3.2 : 2.5;
  const cabinH = style === 'suv' ? 0.85 : 0.65;
  const cabinX = style === 'pickup' ? 0.6 : style === 'suv' ? -0.3 : -0.2;
  const glass = solid('#1d2a33', 0.1, 0.5);
  const cabin = new Mesh(new BoxGeometry(cabinL, cabinH, W * 0.9), glass);
  cabin.position.set(cabinX, ride + bodyH + cabinH / 2 - 0.02, 0);
  g.add(cabin);
  const roof = new Mesh(new BoxGeometry(cabinL * 0.92, 0.08, W * 0.86), paint);
  roof.position.set(cabinX, ride + bodyH + cabinH, 0);
  g.add(roof);
  if (style === 'taxi') {
    const top = new Mesh(new BoxGeometry(0.6, 0.18, 0.3), solid('#d8352b', 0.5));
    top.position.set(cabinX, ride + bodyH + cabinH + 0.12, 0);
    g.add(top);
  }
  const wheelGeo = new CylinderGeometry(0.36, 0.36, 0.26, 14);
  wheelGeo.rotateX(Math.PI / 2);
  const tyre = solid('#161616', 0.9);
  for (const [dx, dz] of [
    [L * 0.32, W / 2],
    [-L * 0.32, W / 2],
    [L * 0.32, -W / 2],
    [-L * 0.32, -W / 2],
  ]) {
    const w = new Mesh(wheelGeo, tyre);
    w.position.set(dx, 0.36, dz);
    w.name = 'wheel';
    g.add(w);
  }
  const headlight = registerNightGlow(solid('#fffbe8', 0.2, 0, { emissive: '#fff3c4', emissiveIntensity: 0 }), 2);
  const tail = registerNightGlow(solid('#a01010', 0.4, 0, { emissive: '#ff2a1a', emissiveIntensity: 0 }), 1.5);
  for (const dz of [-W * 0.35, W * 0.35]) {
    const h = new Mesh(new BoxGeometry(0.05, 0.14, 0.32), headlight);
    h.position.set(L / 2, ride + bodyH * 0.65, dz);
    const t = new Mesh(new BoxGeometry(0.05, 0.12, 0.3), tail);
    t.position.set(-L / 2, ride + bodyH * 0.65, dz);
    g.add(h, t);
  }
  g.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.userData.length = L;
  g.userData.width = W;
  g.userData.height = ride + bodyH + cabinH;
  g.userData.bodyTop = ride + bodyH;
  return g;
}

/** Copy a group's meshes into the static batcher (for parked cars and fixed props). */
export function bakeGroup(b: Batcher, group: Object3D): void {
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o instanceof Mesh) b.add((o.geometry as BufferGeometry).clone(), o.material as Material, o.matrixWorld);
  });
}

// ---------------------------------------------------------------------------
// Dynamic props
// ---------------------------------------------------------------------------

/** Terracotta pot with a plant whose colour shows how watered it is. */
export function makePlant(rng: Rng): { group: Group; setWater: (t: number) => void } {
  const g = new Group();
  const pot = new Mesh(new CylinderGeometry(0.38, 0.28, 0.6, 12), solid('#b5643c', 0.85));
  pot.position.y = 0.3;
  pot.castShadow = true;
  g.add(pot);
  const soil = new Mesh(new CylinderGeometry(0.34, 0.34, 0.04, 12), solid('#5a3e2b', 1));
  soil.position.y = 0.58;
  g.add(soil);
  const leafMat = new MeshStandardMaterial({ color: '#9a9a4a', roughness: 0.9, flatShading: true });
  const dry = new Vector3(0.62, 0.58, 0.3);
  const wet = new Vector3(0.25, 0.6, 0.22);
  for (let i = 0; i < 5; i++) {
    const leaf = new Mesh(new IcosahedronGeometry(0.22 + rng.range(0, 0.1), 0), leafMat);
    leaf.position.set(rng.range(-0.15, 0.15), 0.8 + rng.range(0, 0.35), rng.range(-0.15, 0.15));
    leaf.castShadow = true;
    g.add(leaf);
  }
  const flower = new Mesh(new SphereGeometry(0.08, 6, 4), solid(rng.pick(['#d8352b', '#f2c230', '#e07aa0']), 0.7));
  flower.position.set(0, 1.25, 0);
  flower.visible = false;
  g.add(flower);
  const setWater = (t: number) => {
    const c = dry.clone().lerp(wet, t);
    leafMat.color.setRGB(c.x, c.y, c.z);
    g.scale.setScalar(0.9 + 0.12 * t);
    flower.visible = t > 0.95;
  };
  setWater(0);
  return { group: g, setWater };
}

export function makeTrashBag(): Mesh {
  const m = new Mesh(new SphereGeometry(0.32, 8, 6), solid('#1c1c1f', 0.4, 0.1));
  m.scale.set(1, 1.2, 1);
  m.castShadow = true;
  const knot = new Mesh(new ConeGeometry(0.08, 0.16, 6), solid('#1c1c1f', 0.4));
  knot.position.y = 0.42;
  m.add(knot);
  return m;
}

/** The street stall: a cart with an umbrella and a cool box. */
export function makeStall(): Group {
  const g = new Group();
  const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(new BoxGeometry(1.8, 0.8, 0.9), solid('#c8a46a', 0.8), 0, 0.75, 0);
  add(new BoxGeometry(1.9, 0.06, 1.0), solid('#e9dcc2', 0.8), 0, 1.18, 0);
  for (const dx of [-0.7, 0.7]) {
    const w = add(new CylinderGeometry(0.28, 0.28, 0.08, 14), M.black(), dx, 0.28, 0.5);
    w.rotation.x = Math.PI / 2;
  }
  add(new CylinderGeometry(0.03, 0.03, 2.2, 6), M.metal(), 0.8, 1.9, -0.3);
  const umb = add(new CylinderGeometry(0.05, 1.5, 0.5, 8, 1, true), textured('awningStall', T.awningTexture('#d8352b', '#f6efe0'), { doubleSide: true }), 0.8, 3.0, -0.3);
  (umb.material as MeshStandardMaterial).side = DoubleSide;
  add(new BoxGeometry(0.7, 0.45, 0.45), solid('#2b67b3', 0.5), -0.4, 1.45, 0);
  // Bottles and ice cream on the counter.
  for (let i = 0; i < 4; i++) add(new CylinderGeometry(0.05, 0.05, 0.24, 8), solid('#9ec9e6', 0.2), 0.2 + i * 0.13, 1.33, 0.2);
  return g;
}

/** A bicycle or scooter the player rides; faces +z. */
export function makeRide(kind: 'bike' | 'scooter'): Group {
  const g = new Group();
  const frameMat = solid(kind === 'bike' ? '#d8352b' : '#1f1f22', 0.4, 0.4);
  const wheelGeo = new TorusGeometry(kind === 'bike' ? 0.34 : 0.12, kind === 'bike' ? 0.04 : 0.05, 8, 20);
  const back = new Mesh(wheelGeo, M.black());
  const front = new Mesh(wheelGeo, M.black());
  back.rotation.y = front.rotation.y = Math.PI / 2;
  if (kind === 'bike') {
    back.position.set(0, 0.36, -0.55);
    front.position.set(0, 0.36, 0.55);
    const bar = (len: number, x: number, y: number, z: number, rx: number) => {
      const m = new Mesh(new CylinderGeometry(0.025, 0.025, len, 6), frameMat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      g.add(m);
    };
    bar(1.0, 0, 0.62, 0, Math.PI / 2);
    bar(0.6, 0, 0.6, -0.3, 0.6);
    bar(0.7, 0, 0.62, 0.45, -0.3);
    const seat = new Mesh(new BoxGeometry(0.12, 0.05, 0.25), M.black());
    seat.position.set(0, 0.92, -0.25);
    const handle = new Mesh(new BoxGeometry(0.55, 0.03, 0.03), M.black());
    handle.position.set(0, 0.98, 0.55);
    g.add(seat, handle);
  } else {
    back.position.set(0, 0.12, -0.38);
    front.position.set(0, 0.12, 0.42);
    const deck = new Mesh(new BoxGeometry(0.18, 0.05, 0.8), frameMat);
    deck.position.set(0, 0.17, 0);
    const stem = new Mesh(new CylinderGeometry(0.025, 0.025, 1.0, 6), frameMat);
    stem.position.set(0, 0.65, 0.42);
    const handle = new Mesh(new BoxGeometry(0.45, 0.03, 0.03), M.black());
    handle.position.set(0, 1.12, 0.42);
    g.add(deck, stem, handle);
  }
  g.add(back, front);
  g.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
  });
  return g;
}

export function makeCan(rng: Rng): Mesh {
  const color = rng.pick(['#d8352b', '#c0c4c8', '#2f8a57', '#2b67b3', '#f2c230', '#9ec9e6']);
  const plastic = color === '#9ec9e6';
  const m = new Mesh(new CylinderGeometry(plastic ? 0.07 : 0.065, plastic ? 0.07 : 0.065, plastic ? 0.3 : 0.18, 10), solid(color, plastic ? 0.15 : 0.35, plastic ? 0 : 0.6));
  m.rotation.z = Math.PI / 2;
  m.rotation.y = rng.range(0, Math.PI);
  m.position.y = plastic ? 0.07 : 0.065;
  m.castShadow = true;
  return m;
}

export function makeWallet(): Group {
  const g = new Group();
  const m = new Mesh(new BoxGeometry(0.22, 0.04, 0.16), solid('#6b3e22', 0.6));
  m.position.y = 0.03;
  m.castShadow = true;
  const flap = new Mesh(new BoxGeometry(0.22, 0.01, 0.06), solid('#8a5230', 0.6));
  flap.position.set(0, 0.055, 0.03);
  g.add(m, flap);
  return g;
}
