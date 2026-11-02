/**
 * Exact vector water queries in world space: signed distance to the nearest
 * shoreline (negative = in water) and that water body's surface level. This is what
 * gives street-level views crisp Nile banks, a 300 m Suez Canal and a sharp Corniche,
 * independent of the 1 km DEM.
 */
import type { GisData } from '../data/schema';
import { RingIndex, SegmentGrid, type Bounds2, type NearestHit } from '../core/spatialIndex';
import type { GeoProjection } from './projection';

export const WaterKind = { Land: 0, Sea: 1, Lake: 2, River: 3 } as const;
export type WaterKind = (typeof WaterKind)[keyof typeof WaterKind];

export interface WaterQuery {
  kind: WaterKind;
  /** Kind of the nearest water body, even when the point itself is dry land. */
  body: WaterKind;
  /** Signed distance (m) to the nearest shoreline; negative inside water. */
  shore: number;
  /** Surface elevation (m) of the water body that is nearest (or containing). */
  surface: number;
  /** For rivers: channel half-width (m). */
  halfWidth: number;
}

export interface DryZone {
  x: number;
  z: number;
  radius: number;
}

/** Radius (m) within which shore distances are exact; beyond it they saturate. */
export const SHORE_RANGE = 3000;

export class WaterModel {
  private readonly landIndex: RingIndex;
  private readonly coast: SegmentGrid;
  private readonly lakeEdges: SegmentGrid;
  private readonly lakeEdgeOwner: number[] = [];
  private readonly lakes: { index: RingIndex; bounds: Bounds2; surface: number }[] = [];
  private readonly patches: RingIndex;
  private readonly rivers: SegmentGrid;
  private readonly riverSeg: { width: number; s0: number; s1: number }[] = [];
  private readonly hit: NearestHit = { dist: 0, segment: 0, t: 0 };
  private dryZones: DryZone[] = [];

  constructor(gis: GisData, proj: GeoProjection, bounds: Bounds2) {
    const toWorld = (ring: number[]) => {
      const out: number[] = [];
      for (let i = 0; i < ring.length; i += 2) out.push(...proj.forward(ring[i], ring[i + 1]));
      return out;
    };
    // 5 km cells keep the grids small (≈1.7 MB each) over the 3,300 km root square.
    const cell = 5000;
    const maxWidth = Math.max(...gis.rivers.map((r) => r.width));

    const landWorld = gis.land.map(toWorld);
    this.landIndex = new RingIndex(landWorld, 4000);
    this.coast = new SegmentGrid(bounds, cell, SHORE_RANGE);
    for (const r of landWorld) forEachEdge(r, (ax, ay, bx, by) => this.coast.add(ax, ay, bx, by));
    this.coast.build();

    this.lakeEdges = new SegmentGrid(bounds, cell, SHORE_RANGE);
    gis.lakes.forEach((lake, li) => {
      const rings = lake.rings.map(toWorld);
      const index = new RingIndex(rings, 1000);
      this.lakes.push({ index, bounds: index.bounds, surface: lake.surface });
      for (const r of rings) {
        forEachEdge(r, (ax, ay, bx, by) => {
          this.lakeEdges.add(ax, ay, bx, by);
          this.lakeEdgeOwner.push(li);
        });
      }
    });
    // Land patches: their edges become lake shoreline, their interior is dry.
    const patchRings = (gis.landPatches ?? []).map(toWorld);
    this.patches = new RingIndex(patchRings, 1000);
    for (const r of patchRings) {
      const owner = this.lakes.findIndex((l) => l.index.contains(r[0], r[1]));
      if (owner < 0) continue;
      forEachEdge(r, (ax, ay, bx, by) => {
        this.lakeEdges.add(ax, ay, bx, by);
        this.lakeEdgeOwner.push(owner);
      });
    }
    this.lakeEdges.build();

    this.rivers = new SegmentGrid(bounds, cell, SHORE_RANGE + maxWidth / 2);
    for (const river of gis.rivers) {
      const p = river.points;
      let prev = proj.forward(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) {
        const cur = proj.forward(p[i], p[i + 1]);
        this.rivers.add(prev[0], prev[1], cur[0], cur[1]);
        this.riverSeg.push({ width: river.width, s0: river.surface[i / 2 - 1], s1: river.surface[i / 2] });
        prev = cur;
      }
    }
    this.rivers.build();
  }

  /** Circles that are always dry land (e.g. Gezira and Agilkia islands under landmarks). */
  setDryZones(zones: DryZone[]): void {
    this.dryZones = zones;
  }

  /** True in the sea or inside a lake (rivers excluded). */
  inStandingWater(x: number, z: number): boolean {
    if (!this.landIndex.contains(x, z)) return true;
    if (this.patches.contains(x, z)) return false;
    for (const l of this.lakes) {
      const b = l.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minY && z <= b.maxY && l.index.contains(x, z)) return true;
    }
    return false;
  }

  query(x: number, z: number, out: WaterQuery): WaterQuery {
    out.kind = WaterKind.Land;
    out.body = WaterKind.Sea;
    out.shore = SHORE_RANGE;
    out.surface = 0;
    out.halfWidth = 0;

    // Sea: outside every land ring.
    const onLand = this.landIndex.contains(x, z);
    const c = this.coast.nearest(x, z, this.hit);
    const dCoast = c ? c.dist : SHORE_RANGE;
    let best = onLand ? dCoast : -dCoast;
    let kind: WaterKind = onLand ? WaterKind.Land : WaterKind.Sea;
    let body: WaterKind = WaterKind.Sea;
    let surface = 0;

    // Lakes: containment is independent of shore proximity (lakes can be 30 km wide).
    let inLake = -1;
    if (onLand && !this.patches.contains(x, z)) {
      for (let li = 0; li < this.lakes.length; li++) {
        const b = this.lakes[li].bounds;
        if (x < b.minX || x > b.maxX || z < b.minY || z > b.maxY) continue;
        if (this.lakes[li].index.contains(x, z)) {
          inLake = li;
          break;
        }
      }
    }
    const l = this.lakeEdges.nearest(x, z, this.hit);
    if (inLake >= 0) {
      best = -(l ? l.dist : SHORE_RANGE);
      kind = body = WaterKind.Lake;
      surface = this.lakes[inLake].surface;
    } else if (l && l.dist < best) {
      best = l.dist;
      kind = WaterKind.Land;
      body = WaterKind.Lake;
      surface = this.lakes[this.lakeEdgeOwner[l.segment]].surface;
    }

    // Rivers and canals.
    const r = this.rivers.nearest(x, z, this.hit);
    if (r) {
      const seg = this.riverSeg[r.segment];
      const half = seg.width / 2;
      const sd = r.dist - half;
      if (sd < best) {
        best = sd;
        kind = sd < 0 ? WaterKind.River : WaterKind.Land;
        body = WaterKind.River;
        surface = seg.s0 + (seg.s1 - seg.s0) * r.t;
        out.halfWidth = half;
      }
    }

    for (const zone of this.dryZones) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      if (d < zone.radius) {
        best = Math.max(best, zone.radius - d);
        kind = WaterKind.Land;
      }
    }

    out.kind = kind;
    out.body = body;
    out.shore = best;
    out.surface = surface;
    return out;
  }
}

function forEachEdge(r: number[], fn: (ax: number, ay: number, bx: number, by: number) => void): void {
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) fn(r[j], r[j + 1], r[i], r[i + 1]);
}
