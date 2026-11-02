/**
 * Procedural city tiles (pure; runs in workers).
 *
 * Pipeline per 1 km tile, for every district overlapping it:
 *   1. Street grid in the district's frame (primary axis = gridDeg), corners displaced
 *      by smooth noise (`warp`): 0 → planned grid (New Capital), high → medina.
 *   2. 2×2 superblocks merge by hash into larger/irregular blocks (dropping streets).
 *   3. Each block is inset by its four street half-widths (avenues every Nth line).
 *   4. Block → lots → buildings by the profile's layout: recursive subdivision
 *      (dense fabric), perimeter blocks, CBD towers, or resort compounds.
 *   5. Streets become ribbons with lane markings, lamps and palms.
 *
 * Ownership rules make tiles independent: a block (or street) belongs to the tile
 * containing its centroid (midpoint) and to the highest-priority district there, so
 * neighbouring tiles and overlapping districts never duplicate geometry.
 *
 * LOD 1 ("massing") emits one extrusion per block at its mean height — ~50× fewer
 * triangles — for mid-range views; LOD 0 emits lots, roof clutter, domes, roads.
 */
import type { World } from '../gis/world';
import { WaterKind } from '../gis/hydrography';
import { newSample } from '../gis/terrainModel';
import { createNoise2D } from '../core/noise';
import { Rng, hash01, hash3i } from '../core/rng';
import { clamp, saturate } from '../core/math';
import { distToSegment, insetPolygon, longestEdge, polyArea, polyCentroid, splitPolygon, type Poly } from '../core/geometry2d';
import { MeshBuilder, type MeshArrays } from './meshBuilder';
import { Facade, type CityProfile, type Rgb } from './profiles';
import type { District } from './districts';

export interface OsmTileInput {
  /** Footprints in lon/lat with resolved heights (metres). */
  buildings: { ring: number[]; height: number }[];
  roads: { points: number[]; width: number }[];
}

export interface CityTileRequest {
  tx: number;
  tz: number;
  size: number;
  lod: 0 | 1;
  osm?: OsmTileInput | null;
}

export interface CityTileData {
  tx: number;
  tz: number;
  lod: 0 | 1;
  /** Mesh origin (tile centre). */
  cx: number;
  cz: number;
  buildings: MeshArrays | null;
  ground: MeshArrays | null;
  /** Palm instances: x, y, z, scale, rotation (local). */
  palms: Float32Array | null;
  /** Street lamps: x, y, z (local). */
  lamps: Float32Array | null;
  buildingCount: number;
  minY: number;
  maxY: number;
}

/** Ground decal styles (shared with the ground material). */
export const GroundStyle = { Street: 10, Avenue: 11, Park: 12, Plaza: 13 } as const;

const SIDEWALK = 1.5;
const ROOF_TANK: Rgb = [0.78, 0.78, 0.76];
const DOME: Rgb = [0.86, 0.8, 0.7];
const PARK: Rgb = [0.3, 0.42, 0.2];
const PLAZA: Rgb = [0.72, 0.66, 0.56];
const ASPHALT: Rgb = [0.2, 0.2, 0.21];

interface Exclusion {
  x: number;
  z: number;
  r: number;
  path?: number[];
}

/** Per-worker state shared by all tiles. */
export class CityGenerator {
  private readonly warpA = createNoise2D(901);
  private readonly warpB = createNoise2D(902);
  private readonly heightNoise = createNoise2D(903);
  private readonly exclusions: Exclusion[] = [];

  constructor(private readonly world: World) {
    for (const l of world.landmarks) {
      if (l.model.type === 'avenue') {
        const path: number[] = [];
        for (let i = 0; i < l.model.path.length; i += 2) path.push(...world.proj.forward(l.model.path[i], l.model.path[i + 1]));
        this.exclusions.push({ x: 0, z: 0, r: l.clearRadius, path });
      } else if (l.clearRadius > 0) {
        const [x, z] = world.proj.forward(l.lon, l.lat);
        this.exclusions.push({ x, z, r: l.clearRadius });
      }
    }
  }

  generate(req: CityTileRequest): CityTileData {
    const t = new TileContext(this.world, req, this.exclusions);
    if (req.osm) {
      this.fromOsm(t, req.osm);
    } else {
      for (const d of t.districts) this.district(t, d);
    }
    return t.finish();
  }

  // ───────────────────────── street grid ─────────────────────────

  private corner(d: District, i: number, j: number): [number, number] {
    const p = d.profile;
    const bx = d.x + d.gx * i * p.block[0] - d.gz * j * p.block[1];
    const bz = d.z + d.gz * i * p.block[0] + d.gx * j * p.block[1];
    if (p.warp <= 0) return [bx, bz];
    return [bx + this.warpA(bx / p.warpScale, bz / p.warpScale) * p.warp, bz + this.warpB(bx / p.warpScale, bz / p.warpScale) * p.warp];
  }

  /** Superblock merge mode: 0 = four blocks, 1 = row pairs, 2 = column pairs, 3 = one block. */
  private mergeMode(d: District, I: number, J: number): number {
    const r = hash01(I, J, d.seed);
    const m = d.profile.merge;
    return r < m * 0.35 ? 3 : r < m * 0.7 ? 1 : r < m ? 2 : 0;
  }

  /** Canonical id of the block containing cell (i, j). */
  private blockOf(d: District, i: number, j: number): number {
    const I = Math.floor(i / 2);
    const J = Math.floor(j / 2);
    const di = i - I * 2;
    const dj = j - J * 2;
    const mode = this.mergeMode(d, I, J);
    const local = mode === 3 ? 0 : mode === 1 ? dj * 2 : mode === 2 ? di : dj * 2 + di;
    return hash3i(I, J, local);
  }

  private lineHalfWidth(p: CityProfile, line: number): number {
    const n = p.avenueEvery;
    return (((line % n) + n) % n === 0 ? p.avenue : p.street) / 2;
  }

  private district(t: TileContext, d: District): void {
    const p = d.profile;
    const [bw, bd] = p.block;
    const margin = Math.max(bw, bd) * 2.2 + p.warp;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of [[t.x0 - margin, t.z0 - margin], [t.x1 + margin, t.z0 - margin], [t.x0 - margin, t.z1 + margin], [t.x1 + margin, t.z1 + margin]]) {
      const u = ((x - d.x) * d.gx + (z - d.z) * d.gz) / bw;
      const v = (-(x - d.x) * d.gz + (z - d.z) * d.gx) / bd;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const I0 = Math.floor(Math.floor(u0) / 2);
    const I1 = Math.floor(Math.ceil(u1) / 2);
    const J0 = Math.floor(Math.floor(v0) / 2);
    const J1 = Math.floor(Math.ceil(v1) / 2);

    for (let J = J0; J <= J1; J++) {
      for (let I = I0; I <= I1; I++) {
        const mode = this.mergeMode(d, I, J);
        const i = I * 2;
        const j = J * 2;
        const rects: [number, number, number, number][] =
          mode === 3 ? [[i, j, i + 1, j + 1]]
            : mode === 1 ? [[i, j, i + 1, j], [i, j + 1, i + 1, j + 1]]
              : mode === 2 ? [[i, j, i, j + 1], [i + 1, j, i + 1, j + 1]]
                : [[i, j, i, j], [i + 1, j, i + 1, j], [i, j + 1, i, j + 1], [i + 1, j + 1, i + 1, j + 1]];
        for (const [ia, ja, ib, jb] of rects) this.block(t, d, ia, ja, ib, jb);
      }
    }
    if (t.lod === 0) this.streets(t, d, Math.floor(u0) - 1, Math.ceil(u1) + 1, Math.floor(v0) - 1, Math.ceil(v1) + 1);
  }

  /** Block over cells [ia..ib] × [ja..jb] (inclusive). */
  private block(t: TileContext, d: District, ia: number, ja: number, ib: number, jb: number): void {
    const p = d.profile;
    const poly: Poly = [];
    const insets: number[] = [];
    const push = (i: number, j: number, inset: number) => {
      const [x, z] = this.corner(d, i, j);
      poly.push(x, z);
      insets.push(inset + SIDEWALK);
    };
    // CCW walk in grid space (preserved in world xz): bottom, right, top, left.
    for (let i = ia; i <= ib; i++) push(i, ja, this.lineHalfWidth(p, ja));
    for (let j = ja; j <= jb; j++) push(ib + 1, j, this.lineHalfWidth(p, ib + 1));
    for (let i = ib + 1; i > ia; i--) push(i, jb + 1, this.lineHalfWidth(p, jb + 1));
    for (let j = jb + 1; j > ja; j--) push(ia, j, this.lineHalfWidth(p, ia));

    const [cx, cz] = polyCentroid(poly);
    if (!t.owns(cx, cz) || polyArea(poly) <= 0) return;
    if (t.owner(cx, cz) !== d || t.isWater(cx, cz, 5) || t.excluded(cx, cz, 0)) return;
    const core = insetPolygon(poly, insets);
    if (!core || polyArea(core) < 80) return;

    const seed = hash3i(ia, ja, d.seed ^ (ib * 7919 + jb));
    const rng = new Rng(seed);
    const centrality = t.centrality(d, cx, cz);
    if (t.lod === 1) {
      this.massing(t, d, core, centrality, rng);
      return;
    }
    if (rng.chance(p.parks)) {
      this.park(t, core, rng);
      return;
    }
    switch (p.layout) {
      case 'perimeter':
        this.perimeter(t, d, core, centrality, rng);
        break;
      case 'towers':
        this.towers(t, d, core, centrality, rng);
        break;
      case 'resort':
        this.resort(t, d, core, centrality, rng);
        break;
      default:
        this.subdivided(t, d, core, centrality, rng);
    }
  }

  // ───────────────────────── heights & looks ─────────────────────────

  private floors(d: District, x: number, z: number, centrality: number, rng: Rng | null): number {
    const p = d.profile;
    const local = 0.75 + 0.25 * this.heightNoise(x / 650, z / 650);
    const tMean = saturate((0.15 + 0.85 * Math.pow(centrality, 0.8)) * local);
    const tt = rng ? saturate(tMean * rng.range(0.65, 1.2)) : tMean;
    return Math.max(1, Math.round(p.floors[0] + (p.floors[1] - p.floors[0]) * tt));
  }

  private look(p: CityProfile, rng: Rng): { facade: number; color: Rgb } {
    const f = rng.weighted(p.facades, p.facades.map((x) => x.weight));
    const c = rng.pick(f.colors);
    const j = rng.range(0.94, 1.06);
    return { facade: f.facade, color: [clamp(c[0] * j, 0, 1), clamp(c[1] * j, 0, 1), clamp(c[2] * j, 0, 1)] };
  }

  /** Extrudes a footprint on the terrain (base sunk below the lowest corner). */
  private building(t: TileContext, foot: Poly, height: number, color: Rgb, facade: number, seed: number, roof: Rgb): number {
    let minG = Infinity;
    for (let i = 0; i < foot.length; i += 2) minG = Math.min(minG, t.ground(foot[i], foot[i + 1]));
    const local = t.toLocal(foot);
    t.buildings.extrude(local, minG - 2, minG + height, color, facade, seed, roof, minG);
    t.count++;
    t.track(minG + height);
    return minG;
  }

  // ───────────────────────── layouts ─────────────────────────

  private subdivided(t: TileContext, d: District, core: Poly, centrality: number, rng: Rng): void {
    const p = d.profile;
    const lots: Poly[] = [];
    subdivide(core, p.lotArea, rng, lots, 0);
    const mosqueLot = rng.chance(p.mosques) ? largest(lots) : -1;
    lots.forEach((lot, k) => {
      const [lx, lz] = polyCentroid(lot);
      if (t.excluded(lx, lz, 4) || t.isWater(lx, lz, 3)) return;
      if (k === mosqueLot) {
        this.mosque(t, lot, rng);
        return;
      }
      if (rng.chance(p.openLot)) return;
      const foot = insetPolygon(lot, p.setback + 0.25) ?? lot;
      if (polyArea(foot) < 30) return;
      const floors = this.floors(d, lx, lz, centrality, rng);
      const { facade, color } = this.look(p, rng);
      const seed = rng.next();
      const height = floors * p.floorHeight + rng.range(0, 1.2);
      const g = this.building(t, foot, height, color, facade, seed, p.roofColor);
      if (rng.chance(p.rooftop) && polyArea(foot) > 70) this.roofClutter(t, foot, g + height, rng);
    });
  }

  private perimeter(t: TileContext, d: District, core: Poly, centrality: number, rng: Rng): void {
    const p = d.profile;
    const m = core.length / 2;
    const depth = rng.range(12, 16);
    for (let e = 0; e < m; e++) {
      const ax = core[e * 2];
      const az = core[e * 2 + 1];
      const bx = core[((e + 1) % m) * 2];
      const bz = core[((e + 1) % m) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < depth * 2) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const nx = -uz;
      const nz = ux;
      let s = 0;
      while (s < len - depth - 8) {
        const blen = Math.min(len - depth - s, rng.range(22, 48));
        const foot = rectOnFrame(ax, az, ux, uz, nx, nz, s, s + blen, 0, depth);
        const [fx, fz] = polyCentroid(foot);
        if (!t.excluded(fx, fz, 4) && !t.isWater(fx, fz, 3)) {
          const { facade, color } = this.look(p, rng);
          this.building(t, foot, this.floors(d, fx, fz, centrality, rng) * p.floorHeight, color, facade, rng.next(), p.roofColor);
        }
        s += blen + rng.range(0, 7);
      }
    }
    const yard = insetPolygon(core, depth + 4);
    if (yard && polyArea(yard) > 200) {
      this.decal(t, yard, PARK, GroundStyle.Park);
      if (rng.chance(p.palms)) this.scatterPalms(t, yard, rng, 0.0015);
      if (rng.chance(p.pools)) {
        const [yx, yz] = polyCentroid(yard);
        this.pool(t, yx, yz, 14, 7, rng);
      }
    }
  }

  private towers(t: TileContext, d: District, core: Poly, centrality: number, rng: Rng): void {
    const p = d.profile;
    const [cx, cz] = polyCentroid(core);
    const e = longestEdge(core);
    const m = core.length / 2;
    const ex = core[((e + 1) % m) * 2] - core[e * 2];
    const ez = core[((e + 1) % m) * 2 + 1] - core[e * 2 + 1];
    const el = Math.hypot(ex, ez);
    const ux = ex / el;
    const uz = ez / el;
    const podium = insetPolygon(core, 4);
    if (podium) {
      const { color } = this.look(p, rng);
      this.building(t, podium, 3 * 4.2, color, Facade.Glass, rng.next(), p.roofColor);
    }
    const count = el > 140 && rng.chance(0.6) ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const off = count === 2 ? (k === 0 ? -0.22 : 0.22) * el : 0;
      const tx = cx + ux * off;
      const tz = cz + uz * off;
      const half = rng.range(13, 20);
      const floors = this.floors(d, tx, tz, centrality, rng);
      const height = floors * p.floorHeight;
      const { facade, color } = this.look(p, rng);
      const seed = rng.next();
      const g = t.ground(tx, tz);
      const [lx, lz] = t.local(tx, tz);
      // Two-tier massing: a wider shaft, then a set-back crown.
      t.buildings.box(lx, lz, ux, uz, half, half * rng.range(0.7, 1), g - 2, g + height * 0.72, color, facade, seed, p.roofColor);
      t.buildings.box(lx, lz, ux, uz, half * 0.78, half * 0.62, g + height * 0.72, g + height, color, facade, seed, p.roofColor);
      t.count++;
      t.track(g + height);
    }
  }

  private resort(t: TileContext, d: District, core: Poly, centrality: number, rng: Rng): void {
    const p = d.profile;
    if (rng.chance(0.3)) {
      // Villa cluster.
      const lots: Poly[] = [];
      subdivide(core, 450, rng, lots, 0);
      for (const lot of lots) {
        const [lx, lz] = polyCentroid(lot);
        if (t.isWater(lx, lz, 4) || t.excluded(lx, lz, 4)) continue;
        const foot = insetPolygon(lot, 5);
        if (!foot || polyArea(foot) < 40) continue;
        const { facade, color } = this.look(p, rng);
        this.building(t, foot, rng.int(1, 2) * p.floorHeight + 0.8, color, facade, rng.next(), p.roofColor);
        if (rng.chance(0.4)) this.scatterPalms(t, lot, rng, 0.004);
      }
      return;
    }
    // Hotel compound: U-shaped wings around a pool, opening away from the long edge.
    const e = longestEdge(core);
    const m = core.length / 2;
    const ax = core[e * 2];
    const az = core[e * 2 + 1];
    const ex = core[((e + 1) % m) * 2] - ax;
    const ez = core[((e + 1) % m) * 2 + 1] - az;
    const L = Math.hypot(ex, ez);
    const ux = ex / L;
    const uz = ez / L;
    const nx = -uz;
    const nz = ux;
    let W = 0;
    for (let i = 0; i < m; i++) W = Math.max(W, (core[i * 2] - ax) * nx + (core[i * 2 + 1] - az) * nz);
    if (L < 50 || W < 40) return;
    const floors = clamp(this.floors(d, ax, az, centrality, rng), p.floors[0], p.floors[1]);
    const { facade, color } = this.look(p, rng);
    const seed = rng.next();
    const h = floors * p.floorHeight;
    const wings = [
      rectOnFrame(ax, az, ux, uz, nx, nz, 0.08 * L, 0.92 * L, 0, 14),
      rectOnFrame(ax, az, ux, uz, nx, nz, 0.08 * L, 0.08 * L + 13, 14, 0.75 * W),
      rectOnFrame(ax, az, ux, uz, nx, nz, 0.92 * L - 13, 0.92 * L, 14, 0.75 * W),
    ];
    for (const w of wings) {
      const [wx, wz] = polyCentroid(w);
      if (!t.isWater(wx, wz, 3)) this.building(t, w, h, color, facade, seed, p.roofColor);
    }
    const px = ax + ux * 0.5 * L + nx * 0.45 * W;
    const pz = az + uz * 0.5 * L + nz * 0.45 * W;
    if (!t.isWater(px, pz, 6)) {
      this.pool(t, px, pz, 0.15 * L, 0.1 * W, rng, ux, uz);
      this.decal(t, rectOnFrame(ax, az, ux, uz, nx, nz, 0.1 * L, 0.9 * L, 16, 0.9 * W), PLAZA, GroundStyle.Plaza);
      this.scatterPalms(t, rectOnFrame(ax, az, ux, uz, nx, nz, 0.15 * L, 0.85 * L, 18, 0.95 * W), rng, 0.003);
    }
  }

  private massing(t: TileContext, d: District, core: Poly, centrality: number, rng: Rng): void {
    const p = d.profile;
    if (p.parks > 0 && rng.chance(p.parks)) return;
    const foot = insetPolygon(core, p.layout === 'subdivide' ? 0.5 : p.layout === 'resort' ? 12 : 6);
    if (!foot || polyArea(foot) < 60) return;
    const [cx, cz] = polyCentroid(foot);
    if (t.excluded(cx, cz, 10)) return;
    let floors = this.floors(d, cx, cz, centrality, null);
    if (p.layout === 'towers') floors = Math.round(floors * 0.55);
    const { facade, color } = this.look(p, rng);
    this.building(t, foot, floors * p.floorHeight, color, facade, rng.next(), p.roofColor);
  }

  // ───────────────────────── features ─────────────────────────

  private mosque(t: TileContext, lot: Poly, rng: Rng): void {
    const foot = insetPolygon(lot, 1.5);
    if (!foot || polyArea(foot) < 60) return;
    const area = polyArea(foot);
    const g = this.building(t, foot, 9, DOME, Facade.Stone, rng.next(), DOME);
    const [cx, cz] = polyCentroid(foot);
    const [lx, lz] = t.local(cx, cz);
    const r = Math.min(9, Math.sqrt(area) / 3.2);
    t.buildings.cylinder(lx, lz, g + 9, g + 10.5, r, r, 16, DOME, Facade.Stone, 0.5, false);
    t.buildings.dome(lx, lz, g + 10.5, r, 1.05, 16, DOME, Facade.Stone, 0.5);
    // Minaret at the first footprint corner.
    const [mx, mz] = t.local(foot[0] + (cx - foot[0]) * 0.15, foot[1] + (cz - foot[1]) * 0.15);
    const mh = rng.range(24, 38);
    t.buildings.cylinder(mx, mz, g, g + mh * 0.75, 1.9, 1.6, 8, DOME, Facade.Stone, 0.3);
    t.buildings.cylinder(mx, mz, g + mh * 0.75, g + mh * 0.78, 2.5, 2.5, 8, DOME, Facade.Stone, 0.3);
    t.buildings.cylinder(mx, mz, g + mh * 0.78, g + mh * 0.92, 1.3, 1.2, 8, DOME, Facade.Stone, 0.3);
    t.buildings.cylinder(mx, mz, g + mh * 0.92, g + mh, 1.3, 0.05, 8, DOME, Facade.Stone, 0.3, false);
    t.track(g + mh);
  }

  private roofClutter(t: TileContext, foot: Poly, roofY: number, rng: Rng): void {
    const [cx, cz] = polyCentroid(foot);
    const [lx, lz] = t.local(cx + rng.range(-2, 2), cz + rng.range(-2, 2));
    // Stair hut and a water tank — the familiar Egyptian rooftop silhouette.
    t.buildings.box(lx, lz, 1, 0, 1.4, 1.4, roofY - 0.2, roofY + 2.6, [0.62, 0.6, 0.56], Facade.Plaster, 0.9);
    if (rng.chance(0.7)) {
      const [tx, tz] = t.local(cx + rng.range(-4, 4), cz + rng.range(-4, 4));
      t.buildings.cylinder(tx, tz, roofY, roofY + 1.8, 0.75, 0.75, 8, ROOF_TANK, Facade.Plaster, 0.95);
    }
  }

  private pool(t: TileContext, x: number, z: number, halfU: number, halfV: number, rng: Rng, ux = 1, uz = 0): void {
    const g = t.ground(x, z);
    const [lx, lz] = t.local(x, z);
    t.buildings.box(lx, lz, ux, uz, halfU, halfV, g - 1, g + 0.25, [0.1, 0.55, 0.7], Facade.Water, rng.next(), [0.1, 0.55, 0.7]);
  }

  private park(t: TileContext, core: Poly, rng: Rng): void {
    this.decal(t, core, PARK, GroundStyle.Park);
    this.scatterPalms(t, core, rng, 0.0025);
  }

  private decal(t: TileContext, poly: Poly, color: Rgb, style: number): void {
    const [cx, cz] = polyCentroid(poly);
    const y = t.ground(cx, cz) + 0.2;
    t.groundMesh.cap(t.toLocal(poly), y, color, style, 0);
  }

  private scatterPalms(t: TileContext, poly: Poly, rng: Rng, density: number): void {
    const count = Math.min(40, Math.round(Math.abs(polyArea(poly)) * density));
    const [cx, cz] = polyCentroid(poly);
    for (let k = 0; k < count; k++) {
      // Rejection-free: blend centroid towards a random vertex.
      const v = rng.int(0, poly.length / 2 - 1);
      const f = rng.range(0.1, 0.85);
      const x = cx + (poly[v * 2] - cx) * f + rng.range(-3, 3);
      const z = cz + (poly[v * 2 + 1] - cz) * f + rng.range(-3, 3);
      if (!t.isWater(x, z, 2)) t.palm(x, z, rng);
    }
  }

  private streets(t: TileContext, d: District, i0: number, i1: number, j0: number, j1: number): void {
    const p = d.profile;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // Horizontal edge on line j (between cells (i, j−1) and (i, j)).
        if (this.blockOf(d, i, j - 1) !== this.blockOf(d, i, j)) this.street(t, d, this.corner(d, i, j), this.corner(d, i + 1, j), this.lineHalfWidth(p, j) * 2, j, i);
        // Vertical edge on line i (between cells (i−1, j) and (i, j)).
        if (this.blockOf(d, i - 1, j) !== this.blockOf(d, i, j)) this.street(t, d, this.corner(d, i, j), this.corner(d, i, j + 1), this.lineHalfWidth(p, i) * 2, i, j + 7777);
      }
    }
  }

  private street(t: TileContext, d: District, a: [number, number], b: [number, number], width: number, line: number, k: number): void {
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    if (!t.owns(mx, mz) || t.owner(mx, mz) !== d) return;
    if (t.isWater(mx, mz, 3) || t.isWater(a[0], a[1], 0) || t.isWater(b[0], b[1], 0) || t.excluded(mx, mz, 0)) return;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) return;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const nx = -uz;
    const nz = ux;
    const hw = width / 2;
    const avenue = width >= d.profile.avenue - 0.01 && d.profile.avenue > d.profile.street;
    const style = avenue ? GroundStyle.Avenue : GroundStyle.Street;
    // Extend through the intersection so crossings are paved; follow terrain in ≤ 30 m steps.
    const s0 = -hw;
    const s1 = len + hw;
    const steps = Math.max(1, Math.ceil((s1 - s0) / 30));
    let prevL = -1;
    let prevR = -1;
    for (let q = 0; q <= steps; q++) {
      const s = s0 + ((s1 - s0) * q) / steps;
      const px = a[0] + ux * s;
      const pz = a[1] + uz * s;
      const y = t.ground(px, pz) + 0.12;
      const [lx, lz] = t.local(px - nx * hw, pz - nz * hw);
      const [rx, rz] = t.local(px + nx * hw, pz + nz * hw);
      const l = t.groundMesh.vertex(lx, y, lz, 0, 1, 0, ASPHALT, style, s, -hw, width);
      const r = t.groundMesh.vertex(rx, y, rz, 0, 1, 0, ASPHALT, style, s, hw, width);
      if (prevL >= 0) {
        // `l` sits at −n (the right-hand side of travel), so this order is CCW from above.
        t.groundMesh.tri(prevL, r, l);
        t.groundMesh.tri(prevL, prevR, r);
      }
      prevL = l;
      prevR = r;
    }
    const rng = new Rng(hash3i(line, k, d.seed));
    if (rng.chance(avenue ? 1 : 0.5)) {
      const spacing = avenue ? 32 : 45;
      for (let s = spacing / 2; s < len; s += spacing) {
        for (const side of avenue ? [-1, 1] : [1]) {
          const x = a[0] + ux * s + nx * (hw + 0.6) * side;
          const z = a[1] + uz * s + nz * (hw + 0.6) * side;
          t.lamp(x, z);
        }
      }
    }
    if (rng.chance(d.profile.palms * (avenue ? 1 : 0.35))) {
      for (let s = 6; s < len - 4; s += 12) {
        const off = avenue && width >= 26 ? 0 : hw + 2.2;
        for (const side of off === 0 ? [0] : [-1, 1]) {
          const x = a[0] + ux * s + nx * off * side;
          const z = a[1] + uz * s + nz * off * side;
          if (!t.isWater(x, z, 2)) t.palm(x, z, rng);
        }
      }
    }
  }

  // ───────────────────────── live OpenStreetMap ─────────────────────────

  private fromOsm(t: TileContext, osm: OsmTileInput): void {
    const proj = this.world.proj;
    for (const b of osm.buildings) {
      const ring: number[] = [];
      for (let i = 0; i < b.ring.length; i += 2) ring.push(...proj.forward(b.ring[i], b.ring[i + 1]));
      let poly = ring;
      if (polyArea(poly) < 0) {
        poly = [];
        for (let i = ring.length - 2; i >= 0; i -= 2) poly.push(ring[i], ring[i + 1]);
      }
      const [cx, cz] = polyCentroid(poly);
      if (!t.owns(cx, cz)) continue;
      const d = t.owner(cx, cz);
      const p = d?.profile;
      const rng = new Rng(hash3i(Math.round(cx), Math.round(cz), 17));
      const look = p ? this.look(p, rng) : { facade: Facade.Plaster as number, color: [0.82, 0.76, 0.64] as Rgb };
      this.building(t, poly, b.height, look.color, look.facade, rng.next(), p?.roofColor ?? [0.6, 0.58, 0.54]);
    }
    for (const r of osm.roads) {
      for (let i = 0; i + 3 < r.points.length; i += 2) {
        const a = proj.forward(r.points[i], r.points[i + 1]);
        const b = proj.forward(r.points[i + 2], r.points[i + 3]);
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        if (!t.owns(mx, mz)) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.5) continue;
        const ux = (b[0] - a[0]) / len;
        const uz = (b[1] - a[1]) / len;
        const hw = r.width / 2;
        const ext = Math.min(hw, len / 2);
        const quad: Poly = [
          a[0] - ux * ext + uz * hw, a[1] - uz * ext - ux * hw,
          b[0] + ux * ext + uz * hw, b[1] + uz * ext - ux * hw,
          b[0] + ux * ext - uz * hw, b[1] + uz * ext + ux * hw,
          a[0] - ux * ext - uz * hw, a[1] - uz * ext + ux * hw,
        ];
        this.decal(t, quad, ASPHALT, r.width >= 16 ? GroundStyle.Avenue : GroundStyle.Street);
      }
    }
  }
}

// ───────────────────────── per-tile context ─────────────────────────

const GRID = 41;
const GRID_MARGIN = 160;

class TileContext {
  readonly lod: 0 | 1;
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly cx: number;
  readonly cz: number;
  readonly districts: District[];
  readonly buildings = new MeshBuilder();
  readonly groundMesh = new MeshBuilder();
  private palms: number[] = [];
  private lamps: number[] = [];
  count = 0;
  private maxY = -Infinity;
  private minY = Infinity;
  private readonly hGrid = new Float32Array(GRID * GRID);
  private readonly shoreGrid = new Float32Array(GRID * GRID);
  private readonly gx0: number;
  private readonly gz0: number;
  private readonly gStep: number;
  private readonly near: Exclusion[];

  constructor(private readonly world: World, req: CityTileRequest, exclusions: Exclusion[]) {
    this.lod = req.lod;
    this.x0 = req.tx * req.size;
    this.z0 = req.tz * req.size;
    this.x1 = this.x0 + req.size;
    this.z1 = this.z0 + req.size;
    this.cx = this.x0 + req.size / 2;
    this.cz = this.z0 + req.size / 2;
    const pad = 400;
    this.districts = world.districts.overlapping(this.x0 - pad, this.z0 - pad, this.x1 + pad, this.z1 + pad);
    this.near = exclusions.filter((e) => e.path || (Math.abs(e.x - this.cx) < req.size + e.r && Math.abs(e.z - this.cz) < req.size + e.r));
    this.gx0 = this.x0 - GRID_MARGIN;
    this.gz0 = this.z0 - GRID_MARGIN;
    this.gStep = (req.size + 2 * GRID_MARGIN) / (GRID - 1);
    if (!this.districts.length && !req.osm) return;
    // Sample terrain once on a ~30 m grid; buildings and streets interpolate it.
    const s = newSample();
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        world.terrain.sample(this.gx0 + i * this.gStep, this.gz0 + j * this.gStep, this.gStep, s);
        this.hGrid[j * GRID + i] = s.kind === WaterKind.Land ? s.ground : s.height - 3;
        this.shoreGrid[j * GRID + i] = s.kind === WaterKind.Land ? Math.max(0.5, s.shore) : Math.min(-0.5, s.shore);
      }
    }
  }

  private bilerp(arr: Float32Array, x: number, z: number): number {
    const fx = clamp((x - this.gx0) / this.gStep, 0, GRID - 1.001);
    const fz = clamp((z - this.gz0) / this.gStep, 0, GRID - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const o = iz * GRID + ix;
    const top = arr[o] + (arr[o + 1] - arr[o]) * tx;
    const bot = arr[o + GRID] + (arr[o + GRID + 1] - arr[o + GRID]) * tx;
    return top + (bot - top) * tz;
  }

  ground(x: number, z: number): number {
    return this.bilerp(this.hGrid, x, z);
  }

  /** True if the point is in water or within `margin` metres of it. */
  isWater(x: number, z: number, margin: number): boolean {
    return this.bilerp(this.shoreGrid, x, z) < margin;
  }

  owns(x: number, z: number): boolean {
    return x >= this.x0 && x < this.x1 && z >= this.z0 && z < this.z1;
  }

  owner(x: number, z: number): District | null {
    return this.world.districts.owner(x, z, this.districts);
  }

  centrality(d: District, x: number, z: number): number {
    return this.world.districts.centrality(d, x, z);
  }

  excluded(x: number, z: number, pad: number): boolean {
    for (const e of this.near) {
      if (e.path) {
        for (let i = 0; i + 3 < e.path.length; i += 2) {
          if (distToSegment(x, z, e.path[i], e.path[i + 1], e.path[i + 2], e.path[i + 3]) < e.r + pad) return true;
        }
      } else if (Math.hypot(x - e.x, z - e.z) < e.r + pad) {
        return true;
      }
    }
    return false;
  }

  local(x: number, z: number): [number, number] {
    return [x - this.cx, z - this.cz];
  }

  toLocal(poly: Poly): Poly {
    const out: Poly = new Array(poly.length);
    for (let i = 0; i < poly.length; i += 2) {
      out[i] = poly[i] - this.cx;
      out[i + 1] = poly[i + 1] - this.cz;
    }
    return out;
  }

  track(y: number): void {
    if (y > this.maxY) this.maxY = y;
    if (y - 30 < this.minY) this.minY = y - 30;
  }

  palm(x: number, z: number, rng: Rng): void {
    this.palms.push(x - this.cx, this.ground(x, z), z - this.cz, rng.range(0.8, 1.25), rng.range(0, Math.PI * 2));
  }

  lamp(x: number, z: number): void {
    if (this.lod === 0 && !this.isWater(x, z, 1)) this.lamps.push(x - this.cx, this.ground(x, z) + 7.5, z - this.cz);
  }

  finish(): CityTileData {
    const b = this.buildings.vCount ? this.buildings.finish() : null;
    const g = this.groundMesh.vCount ? this.groundMesh.finish() : null;
    return {
      tx: Math.round(this.x0 / (this.x1 - this.x0)),
      tz: Math.round(this.z0 / (this.z1 - this.z0)),
      lod: this.lod,
      cx: this.cx,
      cz: this.cz,
      buildings: b,
      ground: g,
      palms: this.palms.length ? new Float32Array(this.palms) : null,
      lamps: this.lamps.length ? new Float32Array(this.lamps) : null,
      buildingCount: this.count,
      minY: Number.isFinite(this.minY) ? this.minY : 0,
      maxY: Number.isFinite(this.maxY) ? this.maxY : 0,
    };
  }
}

// ───────────────────────── helpers ─────────────────────────

/** Recursive lot subdivision: split perpendicular to the longest edge until lots reach the target area. */
export function subdivide(poly: Poly, target: number, rng: Rng, out: Poly[], depth: number): void {
  const area = polyArea(poly);
  if (area < target * rng.range(1.1, 1.9) || depth > 10) {
    out.push(poly);
    return;
  }
  const e = longestEdge(poly);
  const m = poly.length / 2;
  const ax = poly[e * 2];
  const az = poly[e * 2 + 1];
  const bx = poly[((e + 1) % m) * 2];
  const bz = poly[((e + 1) % m) * 2 + 1];
  const len = Math.hypot(bx - ax, bz - az);
  const t = rng.range(0.38, 0.62);
  const [a, b] = splitPolygon(poly, ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / len, (bz - az) / len);
  if (a.length < 6 || b.length < 6 || polyArea(a) < target * 0.3 || polyArea(b) < target * 0.3) {
    out.push(poly);
    return;
  }
  subdivide(a, target, rng, out, depth + 1);
  subdivide(b, target, rng, out, depth + 1);
}

function largest(polys: Poly[]): number {
  let best = -1;
  let area = 0;
  polys.forEach((p, i) => {
    const a = polyArea(p);
    if (a > area) {
      area = a;
      best = i;
    }
  });
  return best;
}

/** CCW rectangle in a local frame (origin a, axis u, inward normal n): s ∈ [s0, s1], t ∈ [t0, t1]. */
function rectOnFrame(ax: number, az: number, ux: number, uz: number, nx: number, nz: number, s0: number, s1: number, t0: number, t1: number): Poly {
  return [
    ax + ux * s0 + nx * t0, az + uz * s0 + nz * t0,
    ax + ux * s1 + nx * t0, az + uz * s1 + nz * t0,
    ax + ux * s1 + nx * t1, az + uz * s1 + nz * t1,
    ax + ux * s0 + nx * t1, az + uz * s0 + nz * t1,
  ];
}
