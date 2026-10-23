import { describe, expect, it } from 'vitest';
import type { CityDistrict, Governorate, Landmark } from '../src/data/schema';
import { validateCities, validateGovernorates, validateLandmarks } from '../src/data/schema';
import { RingIndex } from '../src/core/spatialIndex';
import { distToSegment } from '../src/core/geometry2d';
import { buildLandmark } from '../src/landmarks/models';
import governorates from '../src/data/governorates.json';
import cities from '../src/data/cities.json';
import landmarks from '../src/data/landmarks.json';
import { loadGis } from './helpers';

const gis = loadGis();
const govs = governorates as Governorate[];
const isos = new Set(govs.map((g) => g.iso));
const bbox = gis.meta.bbox;
const govIndex = new Map(gis.governorates.map((g) => [g.iso, new RingIndex(g.rings, 0.05)]));

/** Inside the governorate polygon, or within `tol` degrees of its outline (1:10m outlines are generalised). */
function inGovernorate(iso: string, lon: number, lat: number, tol = 0.02): boolean {
  if (govIndex.get(iso)!.contains(lon, lat)) return true;
  for (const r of gis.governorates.find((g) => g.iso === iso)!.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (distToSegment(lon, lat, r[j], r[j + 1], r[i], r[i + 1]) < tol) return true;
    }
  }
  return false;
}

/**
 * Landmarks whose governorate is right but whose Natural Earth 1:10m outline is too
 * coarse to contain them; checked with a wider tolerance instead.
 */
const GENERALISED: Record<string, string> = {
  'valley-of-the-kings': 'NE Luxor polygon omits the Theban west bank',
  hatshepsut: 'NE Luxor polygon omits the Theban west bank',
  'colossi-of-memnon': 'NE Luxor polygon omits the Theban west bank',
};

describe('datasets', () => {
  it('has all 27 governorates, matching the baked boundaries', () => {
    expect(validateGovernorates(govs, bbox)).toEqual([]);
    expect([...isos].sort()).toEqual(gis.governorates.map((g) => g.iso).sort());
  });

  it('places every capital inside its own governorate', () => {
    for (const g of govs) expect.soft(inGovernorate(g.iso, g.lon, g.lat), `${g.capital} in ${g.iso}`).toBe(true);
  });

  it('validates cities and landmarks', () => {
    expect(validateCities(cities as CityDistrict[], isos, bbox)).toEqual([]);
    expect(validateLandmarks(landmarks as Landmark[], isos, bbox)).toEqual([]);
  });

  it('places every landmark inside the governorate it names', () => {
    for (const l of landmarks as Landmark[]) {
      const tol = GENERALISED[l.id] ? 0.06 : 0.02;
      expect.soft(inGovernorate(l.governorate, l.lon, l.lat, tol), `${l.id} in ${l.governorate}`).toBe(true);
    }
  });

  it('builds a mesh for every non-marker landmark', () => {
    for (const l of landmarks as Landmark[]) {
      const m = buildLandmark(l.model, { groundY: 100 });
      if (l.model.type === 'marker' || l.model.type === 'avenue') {
        expect(m).toBeNull();
        continue;
      }
      expect(m, l.id).not.toBeNull();
      expect(m!.detail.indices.length).toBeGreaterThan(0);
      expect(m!.detail.positions.every(Number.isFinite), l.id).toBe(true);
    }
  });
});
