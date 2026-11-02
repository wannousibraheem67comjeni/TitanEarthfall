/**
 * Procedural landmark models from the parameters in landmarks.json. Each builder
 * emits a detailed mesh and a simplified one (for THREE.LOD). Local frame: the
 * principal façade / entrance faces −z (north) before the landmark's heading is
 * applied; y = 0 is the (flattened) ground at the landmark's centre.
 */
import type { LandmarkModel } from '../data/schema';
import { MeshBuilder, type MeshArrays } from '../city/meshBuilder';
import { Facade, type Rgb } from '../city/profiles';

const STONE = 6;
const PLAIN = 7;

const LIMESTONE: Rgb = [0.8, 0.7, 0.52];
const CASING: Rgb = [0.9, 0.85, 0.74];
const SANDSTONE: Rgb = [0.78, 0.64, 0.45];
const GRANITE: Rgb = [0.55, 0.42, 0.38];
const MUDBRICK: Rgb = [0.62, 0.5, 0.36];
const MARBLE: Rgb = [0.88, 0.86, 0.82];
const CONCRETE: Rgb = [0.7, 0.69, 0.66];
const ROCKFILL: Rgb = [0.48, 0.44, 0.4];
const STEEL: Rgb = [0.75, 0.76, 0.78];
const GLASS: Rgb = [0.42, 0.55, 0.62];

export interface LandmarkMeshes {
  detail: MeshArrays;
  simple: MeshArrays | null;
  /** Bounding radius (m) — drives LOD distances. */
  radius: number;
  height: number;
}

export interface BuildOptions {
  /** Ground height (m) at the landmark centre, for models with absolute elevations (dams). */
  groundY: number;
}

export function buildLandmark(model: LandmarkModel, opts: BuildOptions): LandmarkMeshes | null {
  const d = new MeshBuilder();
  const s = new MeshBuilder();
  let radius = 50;
  let height = 20;
  switch (model.type) {
    case 'pyramid': {
      const w = model.base;
      const dd = model.baseDepth ?? model.base;
      for (const [mb, detail] of [[d, true], [s, false]] as const) pyramid(mb, w, dd, model.height, model.topWidth ?? 0, detail ? model.capFraction ?? 0 : 0);
      radius = Math.max(w, dd) * 0.75;
      height = model.height;
      break;
    }
    case 'bentPyramid': {
      const half = model.base / 2;
      const breakHalf = half - model.breakHeight / Math.tan((model.lowerAngle * Math.PI) / 180);
      for (const mb of [d, s]) {
        mb.frustum(0, 0, model.base + 4, model.base + 4, model.base, model.base, -12, 0, LIMESTONE, STONE, 0.1, false);
        mb.frustum(0, 0, model.base, model.base, breakHalf * 2, breakHalf * 2, 0, model.breakHeight, CASING, STONE, 0.2, false);
        mb.frustum(0, 0, breakHalf * 2, breakHalf * 2, 0, 0, model.breakHeight, model.height, CASING, STONE, 0.3, false);
      }
      radius = model.base * 0.75;
      height = model.height;
      break;
    }
    case 'stepPyramid': {
      for (const mb of [d, s]) {
        mb.frustum(0, 0, model.baseW + 4, model.baseD + 4, model.baseW, model.baseD, -10, 0, LIMESTONE, STONE, 0.1, false);
        const stepH = model.height / model.steps;
        for (let k = 0; k < model.steps; k++) {
          const f0 = 1 - (k / model.steps) * 0.62;
          const f1 = 1 - ((k + 0.92) / model.steps) * 0.62;
          mb.frustum(0, 0, model.baseW * f0, model.baseD * f0, model.baseW * f1, model.baseD * f1, k * stepH, (k + 1) * stepH, LIMESTONE, STONE, 0.2 + k * 0.1);
        }
      }
      radius = Math.max(model.baseW, model.baseD) * 0.75;
      height = model.height;
      break;
    }
    case 'sphinx': {
      sphinx(d, model.length, model.height, model.width, true);
      sphinx(s, model.length, model.height, model.width, false);
      // The Sphinx sits in its quarried enclosure: a sunken floor ring around it.
      radius = model.length * 0.8;
      height = model.height;
      break;
    }
    case 'temple': {
      temple(d, model, true);
      temple(s, model, false);
      radius = Math.max(model.length, model.width, model.enclosure?.[0] ?? 0, model.enclosure?.[1] ?? 0) * 0.7;
      height = model.pylonHeight;
      break;
    }
    case 'terraceTemple': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) terraceTemple(mb, model.width, model.depth, model.terraces, model.height, detail);
      radius = Math.max(model.width, model.depth) * 0.75;
      height = model.height * 3;
      break;
    }
    case 'rockTemple': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) rockTemple(mb, model.width, model.height, model.statues, model.statueHeight, detail);
      radius = model.width * 2.5;
      height = model.height * 1.4;
      break;
    }
    case 'colossi': {
      for (const mb of [d, s]) {
        for (const side of [-1, 1]) seatedStatue(mb, side * model.spacing / 2, 0, model.height, SANDSTONE);
      }
      radius = model.spacing + model.height;
      height = model.height;
      break;
    }
    case 'obelisk': {
      for (const mb of [d, s]) obelisk(mb, 0, 0, model.height, model.base);
      radius = model.height / 2;
      height = model.height;
      break;
    }
    case 'column': {
      for (const mb of [d, s]) {
        mb.box(0, 0, 1, 0, model.radius * 2, model.radius * 2, -1, model.height * 0.12, GRANITE, STONE, 0.4);
        mb.cylinder(0, 0, model.height * 0.12, model.height * 0.9, model.radius, model.radius * 0.85, 16, GRANITE, PLAIN, 0.4);
        mb.box(0, 0, 1, 0, model.radius * 1.4, model.radius * 1.4, model.height * 0.9, model.height, GRANITE, PLAIN, 0.4);
      }
      radius = model.height / 2;
      height = model.height;
      break;
    }
    case 'tower': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) {
        const podBase = model.height - model.podHeight - 25;
        mb.cylinder(0, 0, -2, 4, model.radius * 2.2, model.radius * 2.2, 16, CONCRETE, PLAIN, 0.2);
        mb.cylinder(0, 0, 4, podBase, model.radius, model.radius * 0.8, detail ? 16 : 8, CONCRETE, STONE, 0.3, false);
        mb.cylinder(0, 0, podBase, podBase + 6, model.radius * 0.8, model.podRadius, 16, CONCRETE, PLAIN, 0.3, false);
        mb.cylinder(0, 0, podBase + 6, podBase + 6 + model.podHeight, model.podRadius, model.podRadius * 0.9, 16, GLASS, Facade.Glass, 0.4);
        mb.cylinder(0, 0, podBase + 6 + model.podHeight, model.height, 1.2, 0.3, 8, STEEL, PLAIN, 0.5, false);
      }
      radius = model.height / 2;
      height = model.height;
      break;
    }
    case 'skyscraper': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) {
        const r0 = model.base / 2;
        const r1 = r0 * model.taper;
        const shaft = model.height * 0.86;
        mb.cylinder(0, 0, -3, 30, r0 * 1.8, r0 * 1.8, 8, CONCRETE, Facade.Glass, 0.3);
        mb.cylinder(0, 0, 30, shaft, r0, r1, detail ? 8 : 6, GLASS, Facade.Glass, 0.6);
        mb.cylinder(0, 0, shaft, model.height, r1 * 0.85, 0.5, 8, STEEL, PLAIN, 0.6, false);
      }
      radius = model.height / 2;
      height = model.height;
      break;
    }
    case 'mosque': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) mosque(mb, model, detail);
      radius = Math.max(model.width, model.depth) * 0.8;
      height = model.minaretHeight;
      break;
    }
    case 'courtyardMosque': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) courtyardMosque(mb, model.size, model.minaretHeight, detail);
      radius = model.size * 0.75;
      height = model.minaretHeight;
      break;
    }
    case 'fortress': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) fortress(mb, model.width, model.depth, model.wallHeight, model.keep, detail);
      radius = Math.max(model.width, model.depth) * 0.7;
      height = model.keep?.[2] ?? model.wallHeight;
      break;
    }
    case 'disc': {
      for (const mb of [d, s]) tiltedDisc(mb, model.diameter / 2, model.tiltDeg, model.height);
      radius = model.diameter * 0.6;
      height = model.height;
      break;
    }
    case 'wedge': {
      for (const mb of [d, s]) wedge(mb, model.length, model.depth, model.height);
      radius = Math.max(model.length, model.depth) * 0.6;
      height = model.height;
      break;
    }
    case 'dam': {
      const crestY = model.crestElevation - opts.groundY;
      for (const mb of [d, s]) {
        mb.frustum(0, 0, model.length, model.baseWidth, model.length, model.crestWidth, Math.min(-40, crestY - 120), crestY, ROCKFILL, PLAIN, 0.2);
        mb.frustum(0, 0, model.length, model.crestWidth * 0.6, model.length, model.crestWidth * 0.6, crestY, crestY + 0.6, [0.3, 0.3, 0.32], PLAIN, 0.3);
      }
      radius = model.length / 2;
      height = crestY;
      break;
    }
    case 'bridge': {
      for (const [mb, detail] of [[d, true], [s, false]] as const) bridge(mb, model.length, model.deckHeight, model.pylonHeight, model.span, detail);
      radius = model.length / 2;
      height = model.pylonHeight;
      break;
    }
    case 'lighthouse': {
      for (const mb of [d, s]) {
        mb.cylinder(0, 0, -1, model.height * 0.85, model.radius, model.radius * 0.75, 8, [0.88, 0.85, 0.78], PLAIN, 0.3);
        mb.cylinder(0, 0, model.height * 0.85, model.height * 0.95, model.radius * 0.7, model.radius * 0.7, 8, GLASS, Facade.Glass, 0.6);
        mb.cylinder(0, 0, model.height * 0.95, model.height, model.radius * 0.75, 0.2, 8, [0.2, 0.3, 0.25], PLAIN, 0.6, false);
      }
      radius = model.height / 2;
      height = model.height;
      break;
    }
    case 'building': {
      for (const mb of [d, s]) {
        mb.box(0, 0, 1, 0, model.width / 2, model.depth / 2, -2, model.height, [0.8, 0.55, 0.45], Facade.Plaster, 0.4, [0.6, 0.55, 0.5]);
      }
      d.dome(0, 0, model.height, Math.min(model.width, model.depth) * 0.12, 1, 16, [0.72, 0.68, 0.6], PLAIN, 0.5);
      radius = Math.max(model.width, model.depth) * 0.6;
      height = model.height;
      break;
    }
    case 'avenue':
    case 'marker':
      return null;
  }
  return { detail: d.finish(), simple: s.vCount ? s.finish() : null, radius, height };
}

// ───────────────────────── builders ─────────────────────────

function pyramid(mb: MeshBuilder, w: number, d: number, h: number, top: number, cap: number): void {
  mb.frustum(0, 0, w + 6, d + 6, w, d, -14, 0, LIMESTONE, STONE, 0.1, false);
  const topF = top / w;
  if (cap > 0) {
    const yc = h * (1 - cap);
    const fc = 1 - (1 - topF) * (yc / h);
    mb.frustum(0, 0, w, d, w * fc, d * fc, 0, yc, LIMESTONE, STONE, 0.2, false);
    mb.frustum(0, 0, w * fc, d * fc, w * topF, d * topF, yc, h, CASING, STONE, 0.3);
  } else {
    mb.frustum(0, 0, w, d, w * topF, d * topF, 0, h, LIMESTONE, STONE, 0.2);
  }
}

function sphinx(mb: MeshBuilder, L: number, H: number, W: number, detail: boolean): void {
  // Body lies along z with the head at −z (facing the landmark heading).
  const body = SANDSTONE;
  mb.box(0, L * 0.12, 1, 0, W * 0.42, L * 0.36, -1, H * 0.42, body, STONE, 0.3); // haunches + back
  mb.box(0, -L * 0.18, 1, 0, W * 0.45, L * 0.1, -1, H * 0.55, body, STONE, 0.31); // chest
  for (const side of [-1, 1]) mb.box(side * W * 0.27, -L * 0.37, 1, 0, W * 0.14, L * 0.13, -1, H * 0.12, body, STONE, 0.32); // forepaws
  mb.box(0, -L * 0.22, 1, 0, W * 0.2, W * 0.24, H * 0.55, H * 0.82, body, STONE, 0.33); // neck + face
  // Nemes headdress: flaring trapezoid behind and beside the face.
  mb.frustum(0, -L * 0.2, W * 0.62, W * 0.4, W * 0.36, W * 0.3, H * 0.6, H, [0.74, 0.62, 0.45], STONE, 0.34);
  if (detail) mb.box(0, -L * 0.255, 1, 0, W * 0.07, W * 0.05, H * 0.62, H * 0.75, [0.7, 0.58, 0.42], STONE, 0.35); // nose/face relief
  if (detail) mb.frustum(0, L * 0.05, W * 2.6, L * 1.35, W * 2.6, L * 1.35, -6, -1, [0.72, 0.62, 0.46], STONE, 0.36, true); // enclosure floor
}

type TempleModel = Extract<LandmarkModel, { type: 'temple' }>;

function temple(mb: MeshBuilder, m: TempleModel, detail: boolean): void {
  const L = m.length;
  const W = m.width;
  const z0 = -L / 2; // entrance (north in local frame)
  // Pylon: two battered towers flanking a lower gateway.
  const towerW = m.pylonWidth * 0.42;
  for (const side of [-1, 1]) {
    mb.frustum(side * (m.pylonWidth / 2 - towerW / 2), z0 + 7, towerW, 15, towerW * 0.86, 10, -2, m.pylonHeight, SANDSTONE, STONE, 0.2 + side * 0.01);
  }
  mb.frustum(0, z0 + 7, m.pylonWidth * 0.16, 13, m.pylonWidth * 0.16, 13, -2, m.pylonHeight * 0.68, SANDSTONE, STONE, 0.22);
  // Forecourt walls, hypostyle hall, sanctuary.
  const courtL = L * 0.3;
  const hallL = L * 0.38;
  const hallZ = z0 + 14 + courtL + hallL / 2;
  wallRing(mb, 0, z0 + 14 + courtL / 2, W, courtL, 3, m.pylonHeight * 0.33, SANDSTONE, detail);
  if (detail) {
    const [rows, cols] = m.hallColumns;
    const dx = (W * 0.9) / cols;
    const dz = hallL / rows;
    const r = Math.min(dx, dz) * 0.32;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -W * 0.45 + dx * (i + 0.5);
        const z = hallZ - hallL / 2 + dz * (j + 0.5);
        const central = Math.abs(x) < dx;
        const h = m.columnHeight * (central ? 1.4 : 1);
        mb.cylinder(x, z, -1, h, r, r * 0.9, 8, SANDSTONE, STONE, 0.4);
        mb.cylinder(x, z, h, h + r * 0.8, r * 1.35, r * 1.35, 8, SANDSTONE, STONE, 0.41);
      }
    }
    // Architraves over the colonnade rows.
    for (let j = 0; j < m.hallColumns[0]; j++) {
      const z = hallZ - hallL / 2 + dz * (j + 0.5);
      mb.box(0, z, 1, 0, W * 0.45, r * 0.8, m.columnHeight + r * 0.8, m.columnHeight + r * 1.6, SANDSTONE, STONE, 0.42);
    }
    wallRing(mb, 0, hallZ, W, hallL, 3, m.columnHeight * 0.9, SANDSTONE, true);
  } else {
    mb.box(0, hallZ, 1, 0, W / 2, hallL / 2, -1, m.columnHeight + 1, SANDSTONE, STONE, 0.4);
  }
  const sanctL = L - 14 - courtL - hallL;
  mb.box(0, z0 + 14 + courtL + hallL + sanctL / 2, 1, 0, W * 0.4, sanctL / 2, -1, m.columnHeight * 0.75, SANDSTONE, STONE, 0.5);
  if (m.enclosure) {
    const [ew, ed, eh] = m.enclosure;
    wallRing(mb, 0, z0 + ed / 2 - 30, ew, ed, 9, eh, MUDBRICK, detail);
  }
  if (detail && m.obelisks) {
    for (let k = 0; k < m.obelisks; k++) {
      const x = m.obelisks === 1 ? -m.pylonWidth * 0.3 : (k === 0 ? -1 : 1) * m.pylonWidth * 0.3;
      obelisk(mb, x, z0 - 12, 25, 2.5);
    }
  }
}

function wallRing(mb: MeshBuilder, cx: number, cz: number, w: number, d: number, t: number, h: number, c: Rgb, detail: boolean): void {
  if (!detail) {
    mb.box(cx, cz, 1, 0, w / 2, d / 2, -1, h * 0.6, c, STONE, 0.6);
    return;
  }
  mb.box(cx, cz - d / 2 + t / 2, 1, 0, w / 2, t / 2, -1, h, c, STONE, 0.6);
  mb.box(cx, cz + d / 2 - t / 2, 1, 0, w / 2, t / 2, -1, h, c, STONE, 0.61);
  mb.box(cx - w / 2 + t / 2, cz, 1, 0, t / 2, d / 2, -1, h, c, STONE, 0.62);
  mb.box(cx + w / 2 - t / 2, cz, 1, 0, t / 2, d / 2, -1, h, c, STONE, 0.63);
}

function obelisk(mb: MeshBuilder, x: number, z: number, h: number, base: number): void {
  mb.frustum(x, z, base * 1.6, base * 1.6, base * 1.6, base * 1.6, -1, 1.2, GRANITE, STONE, 0.7);
  mb.frustum(x, z, base, base, base * 0.66, base * 0.66, 1.2, h * 0.92 + 1.2, GRANITE, PLAIN, 0.71, false);
  mb.frustum(x, z, base * 0.66, base * 0.66, 0, 0, h * 0.92 + 1.2, h + 1.2, [0.85, 0.75, 0.45], PLAIN, 0.72, false);
}

function seatedStatue(mb: MeshBuilder, x: number, z: number, h: number, c: Rgb): void {
  const s = h / 18;
  mb.box(x, z, 1, 0, 3.4 * s, 5.5 * s, -1, 2.5 * s, c, STONE, 0.5); // plinth
  mb.box(x, z + 1.2 * s, 1, 0, 3 * s, 3.2 * s, 2.5 * s, 9 * s, c, STONE, 0.51); // throne + lap
  mb.box(x, z - 2.8 * s, 1, 0, 2.6 * s, 1.2 * s, 2.5 * s, 7.5 * s, c, STONE, 0.52); // legs
  mb.box(x, z + 1.6 * s, 1, 0, 2.4 * s, 1.6 * s, 9 * s, 14.5 * s, c, STONE, 0.53); // torso
  mb.frustum(x, z + 1.4 * s, 3.4 * s, 2.4 * s, 1.8 * s, 1.8 * s, 14.5 * s, h, c, STONE, 0.54); // head + nemes
}

function terraceTemple(mb: MeshBuilder, w: number, d: number, terraces: number, h: number, detail: boolean): void {
  const step = d / (terraces + 1);
  for (let k = 0; k < terraces; k++) {
    const z = -d / 2 + step * (k + 1);
    const top = (k + 1) * (h / terraces) * 1.1;
    const ww = w * (1 - k * 0.12);
    mb.box(0, z + step / 2, 1, 0, ww / 2, step / 2 + (terraces - k) * 4, -2, top, [0.84, 0.76, 0.6], STONE, 0.3 + k * 0.05);
    if (detail) {
      // Colonnade along each terrace front.
      for (let i = 0; i < 22; i++) {
        const x = -ww / 2 + 4 + (i * (ww - 8)) / 21;
        if (Math.abs(x) < 9) continue;
        mb.box(x, z - 2, 1, 0, 0.9, 0.9, top - h / terraces * 0.9, top + 5.5, [0.88, 0.8, 0.64], STONE, 0.6);
      }
      mb.box(0, z - 2, 1, 0, ww / 2, 1.2, top + 5.5, top + 6.6, [0.86, 0.78, 0.62], STONE, 0.61);
    }
  }
  // Central ramps rising toward the cliff (back = +z).
  for (let k = 0; k < terraces; k++) {
    const z0 = -d / 2 + step * k + 6;
    const z1 = -d / 2 + step * (k + 1) + 4;
    const y0 = k * (h / terraces) * 1.1;
    const y1 = (k + 1) * (h / terraces) * 1.1;
    // Upper edge first so the ramp faces up and toward the front (−z).
    mb.face([-7, y1, z1, 7, y1, z1, 7, y0, z0, -7, y0, z0], [0.8, 0.72, 0.56], STONE, 0.7);
  }
}

function rockTemple(mb: MeshBuilder, w: number, h: number, statues: number, sh: number, detail: boolean): void {
  // Artificial hill behind the façade (the 1960s relocation dome).
  mb.frustum(0, 45, w * 4.5, 100, w * 2.2, 50, -5, h * 1.35, [0.7, 0.55, 0.4], PLAIN, 0.1);
  mb.box(0, 2, 1, 0, w / 2, 4, -1, h, [0.82, 0.66, 0.48], STONE, 0.2);
  if (!detail) return;
  for (let k = 0; k < statues; k++) {
    const x = -w / 2 + (w / statues) * (k + 0.5);
    seatedStatue(mb, x, -4, sh, [0.84, 0.68, 0.5]);
  }
  mb.box(0, -2, 1, 0, w * 0.06, 0.5, -0.5, h * 0.3, [0.25, 0.2, 0.18], PLAIN, 0.3); // doorway shadow
}

type MosqueModel = Extract<LandmarkModel, { type: 'mosque' }>;

function mosque(mb: MeshBuilder, m: MosqueModel, detail: boolean): void {
  const wallH = Math.max(12, m.domeHeight * 0.42);
  const hall = Math.min(m.depth, m.width * 1.1);
  const hallZ = m.depth / 2 - hall / 2;
  mb.box(0, hallZ, 1, 0, m.width / 2, hall / 2, -2, wallH, MARBLE, STONE, 0.2);
  if (m.depth > hall + 5) {
    // Open courtyard in front of the prayer hall.
    const cd = m.depth - hall;
    wallRing(mb, 0, -m.depth / 2 + cd / 2, m.width, cd, 4, wallH * 0.55, MARBLE, detail);
  }
  const drumTop = m.domeHeight - m.domeRadius * 1.05;
  mb.cylinder(0, hallZ, wallH, drumTop, m.domeRadius * 1.02, m.domeRadius, detail ? 24 : 12, MARBLE, STONE, 0.3, false);
  mb.dome(0, hallZ, drumTop, m.domeRadius, 1.05, detail ? 24 : 12, [0.62, 0.64, 0.66], PLAIN, 0.4);
  if (detail) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const r = m.domeRadius * 1.25;
      mb.dome(Math.cos(a) * r, hallZ + Math.sin(a) * r, wallH, m.domeRadius * 0.45, 1, 12, [0.62, 0.64, 0.66], PLAIN, 0.41);
    }
  }
  for (let k = 0; k < m.minarets; k++) {
    const x = m.minarets === 1 ? m.width / 2 - 3 : (k % 2 === 0 ? -1 : 1) * (m.width / 2 - 3);
    const z = k < 2 ? hallZ - hall / 2 + 3 : hallZ + hall / 2 - 3;
    minaret(mb, x, z, m.minaretHeight, detail);
  }
}

function minaret(mb: MeshBuilder, x: number, z: number, h: number, detail: boolean): void {
  const seg = detail ? 12 : 6;
  mb.box(x, z, 1, 0, 2.6, 2.6, -1, h * 0.12, MARBLE, STONE, 0.6);
  mb.cylinder(x, z, h * 0.12, h * 0.72, 2.0, 1.8, seg, MARBLE, STONE, 0.61, false);
  if (detail) {
    mb.cylinder(x, z, h * 0.6, h * 0.62, 2.8, 2.8, seg, MARBLE, PLAIN, 0.62);
    mb.cylinder(x, z, h * 0.72, h * 0.74, 2.6, 2.6, seg, MARBLE, PLAIN, 0.63);
  }
  mb.cylinder(x, z, h * 0.74, h * 0.86, 1.6, 1.5, seg, MARBLE, STONE, 0.64, false);
  mb.cylinder(x, z, h * 0.86, h, 1.6, 0.05, seg, [0.55, 0.58, 0.6], PLAIN, 0.65, false);
}

function courtyardMosque(mb: MeshBuilder, size: number, minH: number, detail: boolean): void {
  wallRing(mb, 0, 0, size, size, detail ? 26 : 30, 12, [0.78, 0.68, 0.54], detail);
  mb.dome(0, 0, 0, 7, 1.2, 16, [0.76, 0.66, 0.52], STONE, 0.5); // ablution fountain
  // Spiral minaret (stacked tiers) outside the north-west wall.
  const x = -size / 2 - 14;
  const z = -size / 2 + 20;
  mb.box(x, z, 1, 0, 6.5, 6.5, -1, minH * 0.45, [0.76, 0.65, 0.5], STONE, 0.6);
  mb.cylinder(x, z, minH * 0.45, minH * 0.75, 5, 4.4, detail ? 16 : 8, [0.76, 0.65, 0.5], STONE, 0.61);
  mb.cylinder(x, z, minH * 0.75, minH * 0.92, 2.6, 2.4, 8, [0.76, 0.65, 0.5], STONE, 0.62);
  mb.dome(x, z, minH * 0.92, 2.4, 1.6, 8, [0.76, 0.65, 0.5], STONE, 0.63);
}

function fortress(mb: MeshBuilder, w: number, d: number, h: number, keep: [number, number, number] | undefined, detail: boolean): void {
  wallRing(mb, 0, 0, w, d, 7, h, [0.76, 0.66, 0.5], detail);
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (const [x, z] of corners) mb.cylinder(x, z, -1, h * 1.3, 7.5, 7, detail ? 16 : 8, [0.74, 0.64, 0.48], STONE, 0.7);
  if (detail) {
    for (let k = 1; k < 4; k++) {
      mb.cylinder(-w / 2 + (w * k) / 4, -d / 2, -1, h * 1.15, 5, 5, 12, [0.74, 0.64, 0.48], STONE, 0.71);
      mb.cylinder(-w / 2 + (w * k) / 4, d / 2, -1, h * 1.15, 5, 5, 12, [0.74, 0.64, 0.48], STONE, 0.72);
    }
  }
  if (keep) mb.box(0, 0, 1, 0, keep[0] / 2, keep[1] / 2, -1, keep[2], [0.8, 0.7, 0.54], STONE, 0.8);
}

function tiltedDisc(mb: MeshBuilder, r: number, tiltDeg: number, h: number): void {
  // Roof plane rises southward (+z) from below grade at the sea side to `h`.
  const k = Math.tan((tiltDeg * Math.PI) / 180);
  const seg = 48;
  const yTop = (z: number) => h / 2 + z * k * (h / (2 * r * k));
  const ring: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    ring.push(x, yTop(z), z);
  }
  // Walls (granite drum, the famous inscribed wall).
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const [ax, ay, az] = [ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2]];
    const [bx, by, bz] = [ring[j * 3], ring[j * 3 + 1], ring[j * 3 + 2]];
    if (Math.max(ay, by) <= 0) continue;
    // Ring runs CCW in x/z, so (a0, a1, b1, b0) is CCW seen from outside (as in extrude()).
    mb.face([ax, -3, az, ax, ay, az, bx, by, bz, bx, -3, bz], GRANITE, STONE, 0.3);
  }
  // Glazed roof: CCW seen from above means descending angle order.
  const roof: number[] = [];
  for (let i = seg - 1; i >= 0; i--) roof.push(ring[i * 3], Math.max(0.3, ring[i * 3 + 1]), ring[i * 3 + 2]);
  mb.face(roof, GLASS, Facade.Glass, 0.6);
}

function wedge(mb: MeshBuilder, L: number, D: number, H: number): void {
  // Ground-hugging front edge at −z rising to the full height at the back (+z).
  // Every face is listed counter-clockwise as seen from outside.
  const a = L / 2;
  const b = D / 2;
  mb.face([-a, 2, -b, a, 2, -b, a, -2, -b, -a, -2, -b], CONCRETE, PLAIN, 0.2); // low front wall
  mb.face([-a, H, b, a, H, b, a, 2, -b, -a, 2, -b], [0.82, 0.78, 0.68], Facade.Glass, 0.3); // sloped façade/roof
  mb.face([a, H, b, -a, H, b, -a, -2, b, a, -2, b], [0.78, 0.74, 0.66], Facade.Plaster, 0.4); // back wall
  mb.face([a, 2, -b, a, H, b, a, -2, b, a, -2, -b], [0.78, 0.74, 0.66], PLAIN, 0.5); // east end
  mb.face([-a, H, b, -a, 2, -b, -a, -2, -b, -a, -2, b], [0.78, 0.74, 0.66], PLAIN, 0.51); // west end
}

function bridge(mb: MeshBuilder, L: number, deckH: number, pylonH: number, span: number, detail: boolean): void {
  // Deck along local x, ramps descending to the ground at both ends.
  const ramp = (L - span) / 2;
  const deckY = (x: number) => (Math.abs(x) <= span / 2 ? deckH : deckH * Math.max(0.05, 1 - (Math.abs(x) - span / 2) / ramp));
  const segs = 24;
  for (let i = 0; i < segs; i++) {
    const x0 = -L / 2 + (L * i) / segs;
    const x1 = -L / 2 + (L * (i + 1)) / segs;
    const y0 = deckY(x0);
    const y1 = deckY(x1);
    mb.face([x0, y0, 10, x1, y1, 10, x1, y1, -10, x0, y0, -10], [0.4, 0.4, 0.42], PLAIN, 0.2);
    mb.face([x0, y0 - 3, 10, x1, y1 - 3, 10, x1, y1, 10, x0, y0, 10], CONCRETE, PLAIN, 0.21);
    mb.face([x1, y1 - 3, -10, x0, y0 - 3, -10, x0, y0, -10, x1, y1, -10], CONCRETE, PLAIN, 0.22);
    if (i % 2 === 0 && Math.abs(x0) > span / 2 + 10) mb.box((x0 + x1) / 2, 0, 1, 0, 2.5, 6, -5, (y0 + y1) / 2 - 3, CONCRETE, PLAIN, 0.23);
  }
  for (const side of [-1, 1]) {
    const px = side * span / 2;
    for (const z of [-11, 11]) mb.frustum(px, z, 5, 5, 3, 3, -10, pylonH, CONCRETE, PLAIN, 0.3);
    mb.box(px, 0, 1, 0, 2.5, 12, deckH - 4, deckH - 1, CONCRETE, PLAIN, 0.31);
    mb.box(px, 0, 1, 0, 2, 12, pylonH - 12, pylonH - 8, CONCRETE, PLAIN, 0.32);
    if (detail) {
      // Stay cables as thin slabs from the pylon head to the deck.
      for (let k = 1; k <= 8; k++) {
        for (const dir of [-1, 1]) {
          const ax = px + dir * k * (span / 2 / 9);
          const ay = deckY(ax);
          const top = pylonH - 10 - k * 3;
          for (const z of [-10.5, 10.5]) {
            mb.face([px, top, z - 0.15, ax, ay, z - 0.15, ax, ay, z + 0.15, px, top, z + 0.15], STEEL, PLAIN, 0.4);
            mb.face([px, top, z + 0.15, ax, ay, z + 0.15, ax, ay, z - 0.15, px, top, z - 0.15], STEEL, PLAIN, 0.4);
          }
        }
      }
    }
  }
}

/** Small sphinx used by the Avenue of Sphinxes instancing (≈ 4 m long). */
export function avenueSphinx(): MeshArrays {
  const mb = new MeshBuilder();
  mb.box(0, 0, 1, 0, 0.9, 1.9, 0, 0.9, SANDSTONE, STONE, 0.5);
  mb.box(0, -1.4, 1, 0, 0.7, 0.6, 0.9, 1.8, SANDSTONE, STONE, 0.51);
  mb.box(0, 0.3, 1, 0, 1.1, 2.3, -0.3, 0, [0.7, 0.6, 0.45], STONE, 0.52);
  return mb.finish();
}

/** Container ship for the Suez Canal convoy (bow toward −z, length ≈ 300 m). */
export function containerShip(seed: number): MeshArrays {
  const mb = new MeshBuilder();
  const hull: Rgb = seed > 0.5 ? [0.2, 0.22, 0.25] : [0.42, 0.12, 0.1];
  mb.frustum(0, 10, 44, 260, 44, 260, -10, 14, hull, PLAIN, 0.1);
  mb.box(0, -131, 1, 0, 14, 11, -10, 14, hull, PLAIN, 0.11); // narrower bow section
  mb.box(0, 118, 1, 0, 19, 9, 14, 46, [0.92, 0.92, 0.9], Facade.Plaster, 0.3); // bridge house aft
  const palette: Rgb[] = [[0.7, 0.18, 0.12], [0.12, 0.3, 0.6], [0.85, 0.65, 0.12], [0.2, 0.5, 0.3], [0.85, 0.85, 0.85], [0.55, 0.32, 0.18]];
  for (let k = 0; k < 9; k++) {
    const z = -110 + k * 24;
    const c = palette[Math.floor(((seed * 7.3 + k * 0.37) % 1) * palette.length)];
    mb.box(0, z, 1, 0, 20, 10.5, 14, 14 + 8 + ((k * 7 + Math.floor(seed * 10)) % 4) * 2.6, c, PLAIN, 0.5 + k * 0.01);
  }
  return mb.finish();
}
