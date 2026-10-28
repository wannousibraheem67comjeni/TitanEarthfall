/**
 * The family house you can walk into: the hall (majlis) behind the front door, your
 * room to the west, the kitchen to the east. The upper storey and the roof are their
 * own group so the game can hide them while the player is inside and the camera can
 * look down into the rooms.
 */
import { BoxGeometry, CylinderGeometry, Group, PlaneGeometry, SphereGeometry } from 'three';
import { Batcher } from './batch';
import type { Colliders } from './collision';
import { HOUSE } from './layout';
import { M, registerNightGlow, solid, textured } from './materials';
import * as P from './props';
import * as T from './textures';

export interface HouseRefs {
  /** Upper storey, roof and rooftop clutter: hidden while the player is inside. */
  upper: Group;
}

export function buildHouse(b: Batcher, c: Colliders, color: string, trim: string): HouseRefs {
  const { x0, x1, z0, z1, wallH: h } = HOUSE;
  const vt = T.villaTextures();
  const outer = registerNightGlow(textured(`villa${color}`, vt.map, { color, emissiveMap: vt.emissive, emissive: '#ffd59a' }), 0.9);
  const t = 0.3;
  const wallBox = (ax: number, az: number, bx: number, bz: number, mat = outer, height = h) => {
    b.boxMinMax(ax, 0, az, bx, height, bz, mat, 3, 3);
    c.addBox(ax, az, bx, bz, height + 0.2);
  };

  // Floor.
  const floor = textured('housefloor', T.tileTexture('#efe7d8', '#e3d8c4'), { roughness: 0.55 });
  const g = new PlaneGeometry(x1 - x0, z1 - z0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / 1.6, (uv.getY(i) * (z1 - z0)) / 1.6);
  b.place(g, floor, (x0 + x1) / 2, 0.03, (z0 + z1) / 2, 0, { rotX: -Math.PI / 2, cast: false, receive: true });

  // Outside walls of the ground floor, with the front doorway open.
  const { x0: dx0, x1: dx1 } = HOUSE.door;
  wallBox(x0, z0 - t / 2, dx0, z0 + t / 2);
  wallBox(dx1, z0 - t / 2, x1, z0 + t / 2);
  b.boxMinMax(dx0, 2.75, z0 - t / 2, dx1, h, z0 + t / 2, outer, 1, 1);
  wallBox(x0, z1 - t / 2, x1, z1 + t / 2);
  wallBox(x0 - t / 2, z0, x0 + t / 2, z1);
  wallBox(x1 - t / 2, z0, x1 + t / 2, z1);
  // Carved frame around the doorway.
  const frame = M.trim(trim);
  b.boxMinMax(dx0 - 0.25, 0, z0 - t / 2 - 0.1, dx0, 3.0, z0 - t / 2, frame);
  b.boxMinMax(dx1, 0, z0 - t / 2 - 0.1, dx1 + 0.25, 3.0, z0 - t / 2, frame);
  b.boxMinMax(dx0 - 0.25, 2.75, z0 - t / 2 - 0.1, dx1 + 0.25, 3.0, z0 - t / 2, frame);
  // The front door stands open against the hall wall.
  b.boxMinMax(dx0 + 0.02, 0, z0 + t / 2, dx0 + 0.1, 2.6, z0 + t / 2 + 0.95, solid('#5a3a22', 0.6));
  b.place(new PlaneGeometry(0.6, 0.3), textured('plate7door', T.plateTexture('7'), { roughness: 0.5 }), dx1 + 0.75, 2.0, z0 - t / 2 - 0.02, Math.PI, { cast: false });

  // Inside: painted lining on the outside walls, by room.
  const [w1, w2] = HOUSE.inner;
  const paint = { room: solid('#dde8ef', 0.95), hall: solid('#f3e7cf', 0.95), kitchen: solid('#f5f1e6', 0.9) };
  const lining = (ax: number, az: number, bx: number, bz: number, mat: ReturnType<typeof solid>) => b.boxMinMax(ax, 0.03, az, bx, h - 0.05, bz, mat, 1, 1, { cast: false });
  const li = 0.04;
  lining(x0 + t / 2, z0 + t / 2, x0 + t / 2 + li, z1 - t / 2, paint.room);
  lining(x1 - t / 2 - li, z0 + t / 2, x1 - t / 2, z1 - t / 2, paint.kitchen);
  for (const [ax, bx, mat] of [
    [x0 + t / 2, w1, paint.room],
    [w1, w2, paint.hall],
    [w2, x1 - t / 2, paint.kitchen],
  ] as const) {
    lining(ax, z1 - t / 2 - li, bx, z1 - t / 2, mat);
    if (ax < dx0 && bx > dx1) {
      lining(ax, z0 + t / 2, dx0, z0 + t / 2 + li, mat);
      lining(dx1, z0 + t / 2, bx, z0 + t / 2 + li, mat);
    } else lining(ax, z0 + t / 2, bx, z0 + t / 2 + li, mat);
  }
  // Skirting.
  b.boxMinMax(x0 + t / 2, 0.03, z1 - t / 2 - 0.08, x1 - t / 2, 0.18, z1 - t / 2 - 0.04, solid('#b9a27c', 0.8), 1, 1, { cast: false });

  // Partition walls with doorways between the rooms.
  const inner = solid('#efe4cc', 0.95);
  const { z0: d0, z1: d1 } = HOUSE.doorway;
  for (const wx of [w1, w2]) {
    wallBox(wx - 0.1, z0 + t / 2, wx + 0.1, d0, inner, h - 0.2);
    wallBox(wx - 0.1, d1, wx + 0.1, z1 - t / 2, inner, h - 0.2);
    b.boxMinMax(wx - 0.1, 2.6, d0, wx + 0.1, h - 0.2, d1, inner);
    b.boxMinMax(wx - 0.14, 0, d0 - 0.1, wx + 0.14, 2.65, d0, frame);
    b.boxMinMax(wx - 0.14, 0, d1, wx + 0.14, 2.65, d1 + 0.1, frame);
  }

  hall(b, c);
  bedroom(b, c);
  kitchen(b, c);

  // Upper storey and roof, in their own group.
  const ub = new Batcher();
  const top = 7.6;
  ub.boxMinMax(x0 - t / 2, h, z0 - t / 2, x1 + t / 2, top, z1 + t / 2, outer, 6, 4);
  ub.boxMinMax(x0 - t / 2 - 0.15, 3.7, z0 - t / 2 - 0.15, x1 + t / 2 + 0.15, 3.9, z1 + t / 2 + 0.15, M.trim(trim), 1);
  ub.boxMinMax(x0, top, z0, x1, top + 0.1, z1, M.roof(), 4);
  const st = M.stucco(color);
  ub.boxMinMax(x0 - 0.1, top, z0 - 0.25, x1 + 0.1, top + 0.7, z0, st, 3);
  ub.boxMinMax(x0 - 0.1, top, z1, x1 + 0.1, top + 0.7, z1 + 0.25, st, 3);
  ub.boxMinMax(x0 - 0.25, top, z0, x0, top + 0.7, z1, st, 3);
  ub.boxMinMax(x1, top, z0, x1 + 0.25, top + 0.7, z1, st, 3);
  for (let k = 0, n = Math.floor((x1 - x0) / 0.9); k < n; k++) {
    const x = x0 + ((k + 0.5) / n) * (x1 - x0);
    ub.place(new BoxGeometry(0.3, 0.42, 0.3), st, x, top + 0.91, z0 - 0.12, Math.PI / 4, { cast: false });
  }
  P.acUnit(ub, x0 + 1.5, top + 0.45, z1 - 1.5, 0);
  P.waterTank(ub, x1 - 1.6, top + 0.1, z1 - 1.8);
  const upper = ub.build();
  return { upper };
}

function hall(b: Batcher, c: Colliders): void {
  const [w1, w2] = HOUSE.inner;
  const { z1 } = HOUSE;
  const cx = (w1 + w2) / 2;
  // Carpet, and floor cushions (jalsa) along three walls.
  b.place(new BoxGeometry(6.6, 0.025, 9.2), solid('#8a2f2a', 0.95), cx, 0.045, 36.3, 0, { cast: false });
  b.place(new BoxGeometry(5.6, 0.03, 8.0), solid('#b8892f', 0.95), cx, 0.05, 36.3, 0, { cast: false });
  const seat = solid('#b8452f', 0.95);
  const back = solid('#c45c3a', 0.95);
  const pillow = solid('#e0b04a', 0.9);
  for (const side of [-1, 1]) {
    const x = side < 0 ? w1 + 0.55 : w2 - 0.55;
    b.place(new BoxGeometry(0.75, 0.24, 8.4), seat, x, 0.15, 36.5);
    b.place(new BoxGeometry(0.22, 0.55, 8.4), back, x + side * 0.4, 0.4, 36.5);
    for (const z of [33.4, 36.5, 39.6]) b.place(new BoxGeometry(0.3, 0.32, 0.4), pillow, x + side * 0.18, 0.42, z);
    c.addBox(x - 0.45, 32.3, x + 0.55, 40.7, 0.6);
  }
  b.place(new BoxGeometry(5.4, 0.24, 0.75), seat, cx, 0.15, z1 - 0.7);
  b.place(new BoxGeometry(5.4, 0.55, 0.22), back, cx, 0.4, z1 - 0.3);
  c.addBox(cx - 2.7, z1 - 1.1, cx + 2.7, z1 - 0.15, 0.6);
  // Coffee tray with the dallah and cups in the middle.
  b.place(new CylinderGeometry(0.45, 0.45, 0.04, 18), solid('#c9a54a', 0.4, 0.6), cx, 0.08, 37.6);
  b.place(new CylinderGeometry(0.07, 0.12, 0.3, 12), solid('#d4b25a', 0.3, 0.8), cx - 0.12, 0.25, 37.6);
  b.place(new SphereGeometry(0.06, 8, 6), solid('#d4b25a', 0.3, 0.8), cx - 0.12, 0.42, 37.6);
  for (let i = 0; i < 4; i++) b.place(new CylinderGeometry(0.04, 0.03, 0.06, 8), M.white(), cx + 0.15 + (i % 2) * 0.12, 0.13, 37.5 + Math.floor(i / 2) * 0.15);
  // A framed calligraphy panel and a wall clock.
  b.place(new BoxGeometry(2.2, 0.9, 0.05), solid('#2b4a3a', 0.6), cx, 2.3, z1 - 0.2);
  b.place(new BoxGeometry(1.9, 0.6, 0.06), solid('#e9d9a6', 0.6), cx, 2.3, z1 - 0.2);
  b.place(new CylinderGeometry(0.3, 0.3, 0.05, 20), M.white(), w1 + 0.08, 2.5, 30.2, 0, { rotZ: Math.PI / 2 });
}

function bedroom(b: Batcher, c: Colliders): void {
  const { x0, z1 } = HOUSE;
  const [w1] = HOUSE.inner;
  const wood = solid('#a0764a', 0.75);
  // Bed against the west wall, head at the back.
  const bx0 = x0 + 0.2;
  b.boxMinMax(bx0, 0, 37.4, bx0 + 2.2, 0.42, z1 - 0.2, wood);
  b.boxMinMax(bx0 + 0.05, 0.42, 37.5, bx0 + 2.15, 0.62, z1 - 0.25, solid('#f4f4f2', 0.9));
  b.boxMinMax(bx0 + 0.05, 0.62, 37.5, bx0 + 2.15, 0.7, 40.2, solid('#3f7fbf', 0.9));
  b.boxMinMax(bx0 + 0.3, 0.62, 40.7, bx0 + 1.9, 0.8, 41.5, M.white());
  b.boxMinMax(bx0, 0, z1 - 0.3, bx0 + 2.2, 1.2, z1 - 0.18, wood);
  c.addBox(bx0, 37.4, bx0 + 2.2, z1 - 0.15, 0.9);
  // Wardrobe on the back wall.
  const wd = HOUSE.wardrobe;
  b.boxMinMax(wd.x - 1.5, 0, z1 - 0.85, wd.x + 1.5, 2.2, z1 - 0.18, wood);
  b.boxMinMax(wd.x - 0.03, 0.1, z1 - 0.87, wd.x + 0.03, 2.1, z1 - 0.84, solid('#6b4a2b', 0.7));
  for (const dx of [-0.2, 0.2]) b.place(new BoxGeometry(0.04, 0.3, 0.04), M.metal(), wd.x + dx, 1.1, z1 - 0.9);
  c.addBox(wd.x - 1.5, z1 - 0.85, wd.x + 1.5, z1 - 0.15, 2.2);
  // Bookshelf by the front wall and a round rug.
  b.boxMinMax(x0 + 0.2, 0, 28.3, x0 + 1.4, 1.7, 29.0, wood);
  for (let k = 0; k < 3; k++) b.boxMinMax(x0 + 0.3, 0.35 + k * 0.5, 28.35, x0 + 1.3, 0.6 + k * 0.5, 28.95, solid(['#c23b2e', '#2f7fb8', '#3f9150'][k], 0.8));
  c.addBox(x0 + 0.2, 28.2, x0 + 1.4, 29.0, 1.7);
  b.place(new CylinderGeometry(1.3, 1.3, 0.02, 24), solid('#7fb3d5', 0.95), (x0 + w1) / 2 + 0.3, 0.045, 33.6, 0, { cast: false });
}

function kitchen(b: Batcher, c: Colliders): void {
  const { x1, z1 } = HOUSE;
  const [, w2] = HOUSE.inner;
  const cab = solid('#8a6a4a', 0.7);
  const top = solid('#e9e2d4', 0.4);
  const cx0 = x1 - 1.0;
  // Counter along the east wall with the sink and the stove.
  b.boxMinMax(cx0, 0, 29.6, x1 - 0.15, 0.86, 40.2, cab);
  b.boxMinMax(cx0 - 0.04, 0.86, 29.6, x1 - 0.15, 0.92, 40.2, top);
  const s = HOUSE.sink;
  b.boxMinMax(s.x - 0.35, 0.8, s.z - 0.45, s.x + 0.3, 0.93, s.z + 0.45, solid('#b9c2c9', 0.25, 0.8));
  b.place(new CylinderGeometry(0.03, 0.03, 0.35, 8), M.metal(), s.x + 0.25, 1.1, s.z);
  b.boxMinMax(cx0 + 0.05, 0.92, 37.4, x1 - 0.2, 0.96, 38.6, M.black());
  for (const [dz, dx] of [
    [37.7, -0.25],
    [38.3, 0.15],
  ])
    b.place(new CylinderGeometry(0.15, 0.15, 0.02, 14), solid('#2a2a2a', 0.5), x1 - 0.55 + dx, 0.975, dz);
  // Wall cabinets and a tiled splashback.
  b.boxMinMax(x1 - 0.55, 1.65, 29.6, x1 - 0.15, 2.35, 40.2, cab);
  b.boxMinMax(x1 - 0.2, 0.92, 29.6, x1 - 0.15, 1.65, 40.2, textured('splash', T.tileTexture('#dfeef2', '#c7dde4'), { roughness: 0.3 }), 4, 2);
  c.addBox(cx0, 29.6, x1, 40.2, 1);
  // Fridge in the corner.
  b.boxMinMax(x1 - 1.1, 0, z1 - 1.05, x1 - 0.18, 1.95, z1 - 0.2, solid('#eef0f2', 0.3, 0.2));
  b.boxMinMax(x1 - 1.12, 1.0, z1 - 1.07, x1 - 1.08, 1.6, z1 - 0.95, M.metal());
  c.addBox(x1 - 1.1, z1 - 1.05, x1 - 0.15, z1 - 0.15, 2);
  // Dining table with four stools.
  const tx = w2 + 2.4;
  const tz = 37.2;
  b.boxMinMax(tx - 0.7, 0.72, tz - 0.5, tx + 0.7, 0.78, tz + 0.5, solid('#c9a072', 0.6));
  for (const [dx, dz] of [
    [-0.6, -0.4],
    [0.6, -0.4],
    [-0.6, 0.4],
    [0.6, 0.4],
  ])
    b.place(new BoxGeometry(0.06, 0.72, 0.06), cab, tx + dx, 0.36, tz + dz);
  for (const [dx, dz] of [
    [0, -0.85],
    [0, 0.85],
    [-1.0, 0],
    [1.0, 0],
  ])
    b.place(new CylinderGeometry(0.2, 0.18, 0.46, 10), solid('#d8b07a', 0.8), tx + dx, 0.23, tz + dz);
  b.place(new CylinderGeometry(0.16, 0.14, 0.08, 12), solid('#e07a2e', 0.6), tx, 0.82, tz);
  c.addBox(tx - 0.8, tz - 0.6, tx + 0.8, tz + 0.6, 0.8);
}
