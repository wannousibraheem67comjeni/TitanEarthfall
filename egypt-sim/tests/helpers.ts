import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { CityDistrict, GisData, Landmark, RegionsData } from '../src/data/schema';
import { DemGrid } from '../src/gis/dem';
import { buildWorld, type World } from '../src/gis/world';
import cities from '../src/data/cities.json';
import landmarks from '../src/data/landmarks.json';
import regions from '../src/data/regions.json';

const ROOT = path.resolve(__dirname, '..');
let cached: World | null = null;

export function loadGis(): GisData {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/egypt-gis.json'), 'utf8')) as GisData;
}

export function loadDemFile(name: string): DemGrid {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'public/data', name)));
  return DemGrid.decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
}

/** The full world model, built once per test process (≈ a second). */
export function loadWorld(): World {
  if (!cached) {
    cached = buildWorld(
      { gis: loadGis(), cities: cities as CityDistrict[], landmarks: landmarks as Landmark[], regions: regions as RegionsData },
      loadDemFile('egypt-dem.v1.bin'),
      loadDemFile('context-dem.v1.bin'),
    );
  }
  return cached;
}
