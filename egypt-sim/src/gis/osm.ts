/**
 * OpenStreetMap via the Overpass API: query builder, response parser and a polite
 * rate-limited client. Used live (per city tile, when "Live OSM" is on) and offline by
 * tools/fetch-osm.mjs to bake city extracts.
 *
 * Deliberately import-free and enum-free so Node (≥ 22.18, native type stripping)
 * can load this file directly from the bake tool.
 */

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

export interface OsmBuilding {
  id: number;
  /** Outer ring, flat [lon, lat, …], open (first vertex not repeated). */
  ring: number[];
  holes: number[][];
  /** Metres above ground, from `height` or `building:levels`; null when untagged. */
  height: number | null;
  levels: number | null;
  kind: string;
  name?: string;
}

export interface OsmRoad {
  id: number;
  points: number[];
  highway: string;
  /** Carriageway width (m), tagged or estimated from the class. */
  width: number;
  name?: string;
}

export interface OsmExtract {
  bbox: BBox;
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  water: number[][];
}

const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian'];
const ROAD_WIDTH: Record<string, number> = {
  motorway: 24, trunk: 20, primary: 16, secondary: 13, tertiary: 10, unclassified: 7,
  residential: 7, living_street: 5, service: 4.5, pedestrian: 5,
};

export interface QueryOptions {
  buildings?: boolean;
  roads?: boolean;
  water?: boolean;
  timeoutSec?: number;
}

/** Overpass QL for one bbox. `out geom` inlines coordinates so no node join is needed. */
export function buildOverpassQuery(bbox: BBox, opts: QueryOptions = {}): string {
  const { buildings = true, roads = true, water = true, timeoutSec = 60 } = opts;
  const [w, s, e, n] = bbox.map((v) => v.toFixed(6));
  const b = `(${s},${w},${n},${e})`;
  const parts: string[] = [];
  if (buildings) parts.push(`way["building"]${b};`, `relation["building"]["type"="multipolygon"]${b};`);
  if (roads) parts.push(`way["highway"~"^(${ROAD_CLASSES.join('|')})$"]${b};`);
  if (water) parts.push(`way["natural"="water"]${b};`, `relation["natural"="water"]${b};`);
  return `[out:json][timeout:${timeoutSec}];(${parts.join('')});out body geom qt;`;
}

/** Parses "12", "12 m", "12.5m", "40 ft", "40'" → metres. */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|ft|')?\s*$/i.exec(v);
  if (!m) return null;
  const num = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  return m[2] && m[2].toLowerCase() !== 'm' ? num * 0.3048 : num;
}

interface OverpassGeom {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: (OverpassGeom | null)[];
  members?: { type: string; role: string; geometry?: (OverpassGeom | null)[] }[];
}

export function parseOverpass(json: { elements?: OverpassElement[] }, bbox: BBox): OsmExtract {
  const out: OsmExtract = { bbox, buildings: [], roads: [], water: [] };
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    if (el.type === 'way' && el.geometry) {
      const flat = toFlat(el.geometry);
      if (tags.building && isClosed(flat)) {
        out.buildings.push(makeBuilding(el.id, tags, openRing(flat), []));
      } else if (tags.highway && flat.length >= 4) {
        const width = parseLength(tags.width) ?? (tags.lanes ? parseInt(tags.lanes, 10) * 3.3 : ROAD_WIDTH[tags.highway] ?? 6);
        out.roads.push({ id: el.id, points: flat, highway: tags.highway, width, name: tags.name });
      } else if (tags.natural === 'water' && isClosed(flat)) {
        out.water.push(openRing(flat));
      }
    } else if (el.type === 'relation' && el.members) {
      const outer = joinRings(el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => toFlat(m.geometry!)));
      const inner = joinRings(el.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => toFlat(m.geometry!)));
      if (tags.building) {
        for (const ring of outer) out.buildings.push(makeBuilding(el.id, tags, ring, inner));
      } else if (tags.natural === 'water') {
        out.water.push(...outer);
      }
    }
  }
  return out;
}

function makeBuilding(id: number, tags: Record<string, string>, ring: number[], holes: number[][]): OsmBuilding {
  const levels = tags['building:levels'] ? parseFloat(tags['building:levels']) + (parseFloat(tags['roof:levels'] ?? '0') || 0) : null;
  return {
    id,
    ring,
    holes,
    height: parseLength(tags.height),
    levels: levels !== null && Number.isFinite(levels) ? levels : null,
    kind: tags.building,
    name: tags.name,
  };
}

/** Height to extrude: tagged height, else levels × floor height, else the fallback. */
export function buildingHeight(b: OsmBuilding, floorHeight: number, fallback: number): number {
  if (b.height !== null && b.height > 0) return b.height;
  if (b.levels !== null && b.levels > 0) return b.levels * floorHeight + 1;
  return fallback;
}

function toFlat(geom: (OverpassGeom | null)[]): number[] {
  const out: number[] = [];
  for (const g of geom) if (g) out.push(g.lon, g.lat);
  return out;
}

function isClosed(flat: number[]): boolean {
  const n = flat.length;
  return n >= 8 && flat[0] === flat[n - 2] && flat[1] === flat[n - 1];
}

function openRing(flat: number[]): number[] {
  return isClosed(flat) ? flat.slice(0, -2) : flat;
}

/** Assembles multipolygon member ways (which may be split arbitrarily) into closed rings. */
export function joinRings(parts: number[][]): number[][] {
  const rings: number[][] = [];
  const pool = parts.filter((p) => p.length >= 4).map((p) => p.slice());
  while (pool.length) {
    let ring = pool.shift()!;
    let grew = true;
    while (!isClosed(ring) && grew) {
      grew = false;
      const ex = ring[ring.length - 2];
      const ey = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (p[0] === ex && p[1] === ey) {
          ring = ring.concat(p.slice(2));
        } else if (p[p.length - 2] === ex && p[p.length - 1] === ey) {
          const rev: number[] = [];
          for (let k = p.length - 2; k >= 0; k -= 2) rev.push(p[k], p[k + 1]);
          ring = ring.concat(rev.slice(2));
        } else {
          continue;
        }
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (isClosed(ring)) rings.push(openRing(ring));
  }
  return rings;
}

/**
 * Serial, rate-limited Overpass client honouring the public instances' fair-use
 * policy (one request at a time, ≥ 1 s apart), with endpoint failover and caching.
 */
export class OverpassClient {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  private endpoint = 0;
  private readonly cache = new Map<string, Promise<OsmExtract>>();
  private readonly endpoints: readonly string[];
  private readonly minIntervalMs: number;

  constructor(endpoints: readonly string[], minIntervalMs = 1100) {
    this.endpoints = endpoints;
    this.minIntervalMs = minIntervalMs;
  }

  fetchExtract(bbox: BBox, opts: QueryOptions = {}): Promise<OsmExtract> {
    const key = bbox.map((v) => v.toFixed(5)).join(',') + JSON.stringify(opts);
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this.enqueue(() => this.request(bbox, opts));
      hit.catch(() => this.cache.delete(key));
      this.cache.set(key, hit);
    }
    return hit;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await job();
      } finally {
        this.last = Date.now();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request(bbox: BBox, opts: QueryOptions): Promise<OsmExtract> {
    const body = 'data=' + encodeURIComponent(buildOverpassQuery(bbox, opts));
    let lastError: unknown = null;
    for (let attempt = 0; attempt < this.endpoints.length; attempt++) {
      const url = this.endpoints[this.endpoint];
      try {
        const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (res.ok) return parseOverpass(await res.json(), bbox);
        lastError = new Error(`Overpass ${res.status} at ${url}`);
      } catch (e) {
        lastError = e;
      }
      this.endpoint = (this.endpoint + 1) % this.endpoints.length;
    }
    throw lastError;
  }
}
