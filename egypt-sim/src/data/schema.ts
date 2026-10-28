/**
 * Types for every dataset the simulation consumes, plus lightweight runtime
 * validators (run in tests and once at startup in dev builds).
 */

// ───────────── baked GIS (public/data/egypt-gis.json, from tools/bake-gis.mjs) ─────────────

/** Flat [lon, lat, lon, lat, …], implicitly closed. */
export type FlatRing = number[];

export interface GisRiver {
  id: string;
  name: string;
  nameAr: string;
  /** Channel width in metres. */
  width: number;
  /** Flat [lon, lat, …] polyline in flow direction. */
  points: number[];
  /** Water-surface elevation (m) per vertex, non-increasing downstream. */
  surface: number[];
}

export interface GisLake {
  id: string;
  name: string;
  nameAr: string;
  approx: boolean;
  rings: FlatRing[];
  surface: number;
}

export interface GisGovernorate {
  iso: string;
  neName: string;
  nameAr: string;
  rings: FlatRing[];
}

export interface GisData {
  meta: { bbox: [number, number, number, number]; sources: string[] };
  land: FlatRing[];
  egypt: FlatRing[];
  governorates: GisGovernorate[];
  rivers: GisRiver[];
  lakes: GisLake[];
  /** Hand-digitised land carved out of lake outlines (see tools/bake-gis.mjs). */
  landPatches: FlatRing[];
}

// ───────────── hand-authored datasets (src/data/*.json) ─────────────

export type EgyptRegion =
  | 'Greater Cairo'
  | 'Alexandria & North Coast'
  | 'Nile Delta'
  | 'Suez Canal'
  | 'Sinai'
  | 'Red Sea'
  | 'Upper Egypt'
  | 'Western Desert';

export interface Governorate {
  iso: string;
  name: string;
  nameAr: string;
  capital: string;
  capitalAr: string;
  lat: number;
  lon: number;
  region: EgyptRegion;
  /** Approximate 2023 population, millions. */
  populationM: number;
}

export type CityProfileId = 'megacity' | 'historic' | 'modern' | 'cbd' | 'coastal' | 'resort' | 'provincial';

export interface CityDistrict {
  id: string;
  name: string;
  nameAr: string;
  governorate: string;
  lat: number;
  lon: number;
  profile: CityProfileId;
  /** Semi-major radius of the urban footprint (m). */
  radius: number;
  /** Major/minor axis ratio of the footprint ellipse (≥ 1). */
  elongation: number;
  /** Bearing of the footprint's major axis (degrees clockwise from north). */
  axisDeg: number;
  /** Bearing of the street grid's primary axis. */
  gridDeg: number;
  /** Higher priority districts claim contested ground (e.g. a historic core inside a megacity). */
  priority: number;
  /** Optional density multiplier (1 = profile default). */
  density?: number;
  /** Show a map label for this district. */
  label?: boolean;
  approx?: boolean;
}

export interface Oasis {
  name: string;
  lat: number;
  lon: number;
  /** Radius of irrigated land (m). */
  radius: number;
}

export interface SandSea {
  name: string;
  ring: FlatRing;
  /** Bearing of the dune crests (seif dunes follow the prevailing NNW wind). */
  crestDeg: number;
  /** Crest spacing (m) and amplitude (m). */
  spacing: number;
  amplitude: number;
}

export interface RegionsData {
  oases: Oasis[];
  sandSeas: SandSea[];
}

export type LandmarkModel =
  | { type: 'pyramid'; base: number; baseDepth?: number; height: number; topWidth?: number; capFraction?: number }
  | { type: 'bentPyramid'; base: number; height: number; lowerAngle: number; breakHeight: number }
  | { type: 'stepPyramid'; baseW: number; baseD: number; height: number; steps: number }
  | { type: 'sphinx'; length: number; height: number; width: number }
  | {
      type: 'temple';
      length: number;
      width: number;
      pylonWidth: number;
      pylonHeight: number;
      hallColumns: [number, number];
      columnHeight: number;
      enclosure?: [number, number, number];
      obelisks?: number;
    }
  | { type: 'terraceTemple'; width: number; depth: number; terraces: number; height: number }
  | { type: 'rockTemple'; width: number; height: number; statues: number; statueHeight: number }
  | { type: 'colossi'; height: number; spacing: number }
  | { type: 'obelisk'; height: number; base: number }
  | { type: 'column'; height: number; radius: number }
  | { type: 'tower'; height: number; radius: number; podRadius: number; podHeight: number }
  | { type: 'skyscraper'; height: number; base: number; taper: number }
  | { type: 'mosque'; width: number; depth: number; domeRadius: number; domeHeight: number; minarets: number; minaretHeight: number }
  | { type: 'courtyardMosque'; size: number; minaretHeight: number }
  | { type: 'fortress'; width: number; depth: number; wallHeight: number; keep?: [number, number, number] }
  | { type: 'disc'; diameter: number; tiltDeg: number; height: number }
  | { type: 'wedge'; length: number; depth: number; height: number }
  | { type: 'dam'; length: number; crestElevation: number; crestWidth: number; baseWidth: number }
  | { type: 'bridge'; length: number; deckHeight: number; pylonHeight: number; span: number }
  | { type: 'lighthouse'; height: number; radius: number }
  | { type: 'avenue'; path: number[]; spacing: number }
  | { type: 'building'; width: number; depth: number; height: number }
  | { type: 'marker' };

export type LandmarkCategory = 'ancient' | 'medieval' | 'modern' | 'infrastructure' | 'natural';

export interface Landmark {
  id: string;
  name: string;
  nameAr: string;
  governorate: string;
  category: LandmarkCategory;
  lat: number;
  lon: number;
  /** Bearing the main façade / axis faces (degrees clockwise from north). */
  headingDeg: number;
  model: LandmarkModel;
  /** Radius (m) kept free of procedural buildings and flattened in the terrain. */
  clearRadius: number;
  /** Force dry land within clearRadius (islands such as Gezira or Agilkia). */
  forceLand?: boolean;
  /** Fly-to camera preset. */
  camera?: { distance: number; pitchDeg: number; headingDeg: number };
  description: string;
  approx?: boolean;
}

// ───────────── validators ─────────────

const inBounds = (lat: number, lon: number, b: [number, number, number, number]) =>
  lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

export function validateGovernorates(items: Governorate[], bbox: [number, number, number, number]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const g of items) {
    if (seen.has(g.iso)) errors.push(`duplicate governorate ${g.iso}`);
    seen.add(g.iso);
    if (!/^EG-[A-Z]{1,3}$/.test(g.iso)) errors.push(`${g.iso}: bad ISO 3166-2 code`);
    if (!inBounds(g.lat, g.lon, bbox)) errors.push(`${g.iso}: capital outside bounds`);
    if (!g.nameAr || !g.capitalAr) errors.push(`${g.iso}: missing Arabic names`);
    if (!(g.populationM > 0)) errors.push(`${g.iso}: population must be positive`);
  }
  if (items.length !== 27) errors.push(`expected 27 governorates, got ${items.length}`);
  return errors;
}

export function validateCities(items: CityDistrict[], governorates: Set<string>, bbox: [number, number, number, number]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const c of items) {
    if (seen.has(c.id)) errors.push(`duplicate city ${c.id}`);
    seen.add(c.id);
    if (!governorates.has(c.governorate)) errors.push(`${c.id}: unknown governorate ${c.governorate}`);
    if (!inBounds(c.lat, c.lon, bbox)) errors.push(`${c.id}: outside bounds`);
    if (!(c.radius >= 300 && c.radius <= 30000)) errors.push(`${c.id}: radius out of range`);
    if (!(c.elongation >= 1)) errors.push(`${c.id}: elongation must be ≥ 1`);
  }
  return errors;
}

export function validateLandmarks(items: Landmark[], governorates: Set<string>, bbox: [number, number, number, number]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const l of items) {
    if (seen.has(l.id)) errors.push(`duplicate landmark ${l.id}`);
    seen.add(l.id);
    if (!governorates.has(l.governorate)) errors.push(`${l.id}: unknown governorate ${l.governorate}`);
    if (!inBounds(l.lat, l.lon, bbox)) errors.push(`${l.id}: outside bounds`);
    if (!(l.clearRadius >= 0)) errors.push(`${l.id}: clearRadius must be ≥ 0`);
    if (!l.model || !l.model.type) errors.push(`${l.id}: missing model`);
    const m = l.model as Record<string, unknown>;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number' && !Number.isFinite(v)) errors.push(`${l.id}: model.${k} is not finite`);
    }
  }
  return errors;
}
