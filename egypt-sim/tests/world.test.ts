import { describe, expect, it } from 'vitest';
import { WaterKind } from '../src/gis/hydrography';
import { loadWorld } from './helpers';

const world = loadWorld();
const at = (lon: number, lat: number, spacing = 1) => {
  const [x, z] = world.proj.forward(lon, lat);
  return world.terrain.sample(x, z, spacing);
};

describe('world model (real baked DEM + vectors)', () => {
  it('reproduces known elevations', () => {
    expect(at(33.955, 28.511).height).toBeGreaterThan(1800); // Mount Catherine (2,629 m; DEM is ~1 km averaged)
    expect(at(27.15, 29.45).height).toBeLessThan(-50); // Qattara Depression floor
    expect(at(31.2357, 30.0444).height).toBeLessThan(60); // Cairo, Nile valley floor
  });

  it('classifies seas, lakes and rivers', () => {
    expect(at(30.0, 32.0).kind).toBe(WaterKind.Sea); // Mediterranean
    expect(at(36.0, 25.0).kind).toBe(WaterKind.Sea); // Red Sea
    const nasser = at(32.85, 23.6);
    expect(nasser.kind).toBe(WaterKind.Lake);
    expect(nasser.height).toBeCloseTo(179, 0);
    expect(at(28.0, 26.0).kind).toBe(WaterKind.Land); // Western Desert
  });

  it('carves the Nile channel below its water surface, which falls downstream', () => {
    const nile = world.gis.rivers.find((r) => r.id === 'nile')!;
    // The vertex nearest Sohag's latitude (Upper Egypt, well below the High Dam).
    let mid = 0;
    for (let i = 0; i < nile.points.length; i += 2) if (Math.abs(nile.points[i + 1] - 26.56) < Math.abs(nile.points[mid + 1] - 26.56)) mid = i;
    const s = at(nile.points[mid], nile.points[mid + 1]);
    // Rivers are drawn as vector ribbons; the terrain carves the bed beneath them.
    expect(s.body).toBe(WaterKind.River);
    expect(s.ground).toBeLessThan(nile.surface[mid / 2] - 1);
    for (let i = 1; i < nile.surface.length; i++) expect(nile.surface[i]).toBeLessThanOrEqual(nile.surface[i - 1]);
  });

  it('keeps every landmark site on dry land', () => {
    for (const l of world.landmarks) {
      if (l.model.type === 'dam' || l.model.type === 'bridge') continue;
      const s = at(l.lon, l.lat);
      expect.soft(s.kind, `${l.id} should be on land`).toBe(WaterKind.Land);
    }
  });

  it('marks the Nile valley and Delta as farmland but not the open desert', () => {
    expect(at(31.0, 30.8).fertility).toBeGreaterThan(0.5); // central Delta near Tanta
    expect(at(30.0, 26.5).fertility).toBe(0); // Western Desert plateau
    expect(at(31.2357, 30.0444).urban).toBeGreaterThan(0.5); // Cairo
  });

  it('covers the regional context outside the national grid', () => {
    const sinaiPeakContext = at(35.5, 31.5); // Dead Sea, far outside the 0.01° grid
    expect(sinaiPeakContext.kind).toBe(WaterKind.Lake);
    expect(sinaiPeakContext.height).toBeLessThan(-350);
    expect(at(45.0, 25.0).kind).toBe(WaterKind.Land); // central Arabia
    expect(at(45.0, 25.0).foreign).toBe(1);
    expect(at(20.0, 35.0).kind).toBe(WaterKind.Sea); // Ionian Sea
  });

  it('is deterministic', () => {
    const a = at(32.64, 25.69);
    const b = at(32.64, 25.69);
    expect(a).toEqual(b);
  });
});
