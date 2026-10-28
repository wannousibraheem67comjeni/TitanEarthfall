import { describe, expect, it } from 'vitest';
import { CityGenerator, subdivide } from '../src/city/cityGenerator';
import { CITY } from '../src/config';
import { Rng } from '../src/core/rng';
import { polyArea } from '../src/core/geometry2d';
import { WaterKind } from '../src/gis/hydrography';
import { loadWorld } from './helpers';

const world = loadWorld();
const gen = new CityGenerator(world);
const tileAt = (lon: number, lat: number) => {
  const [x, z] = world.proj.forward(lon, lat);
  return { tx: Math.floor(x / CITY.tileSize), tz: Math.floor(z / CITY.tileSize), size: CITY.tileSize };
};

describe('procedural cities', () => {
  it('is deterministic per tile', () => {
    const t = tileAt(31.261, 30.0455);
    const a = gen.generate({ ...t, lod: 0 });
    const b = gen.generate({ ...t, lod: 0 });
    expect(a.buildingCount).toBe(b.buildingCount);
    expect(Array.from(a.buildings!.positions.slice(0, 300))).toEqual(Array.from(b.buildings!.positions.slice(0, 300)));
  });

  it('builds dense low-rise fabric in Islamic Cairo and towers in the New Capital CBD', () => {
    const medina = gen.generate({ ...tileAt(31.261, 30.0455), lod: 0 });
    const cbd = gen.generate({ ...tileAt(31.747, 30.015), lod: 0 });
    expect(medina.buildingCount).toBeGreaterThan(1000);
    expect(cbd.buildingCount).toBeLessThan(medina.buildingCount);
    const heightSpan = (d: typeof medina) => d.maxY - (d.minY + 30);
    expect(heightSpan(cbd)).toBeGreaterThan(heightSpan(medina) * 2);
  });

  it('massing LOD is an order of magnitude lighter than detail', () => {
    const t = tileAt(31.245, 30.05);
    const detail = gen.generate({ ...t, lod: 0 });
    const massing = gen.generate({ ...t, lod: 1 });
    expect(massing.buildings!.indices.length * 10).toBeLessThan(detail.buildings!.indices.length);
  });

  it('keeps landmark clearances free of buildings', () => {
    const giza = gen.generate({ ...tileAt(31.1342, 29.9792), lod: 0 });
    expect(giza.buildingCount).toBe(0);
  });

  it('emits valid geometry and keeps buildings out of the sea', () => {
    const t = tileAt(29.93, 31.2); // Alexandria Corniche
    const d = gen.generate({ ...t, lod: 0 });
    const p = d.buildings!.positions;
    expect(p.every(Number.isFinite)).toBe(true);
    expect(Math.max(...d.buildings!.indices)).toBeLessThan(p.length / 3);
    let wet = 0;
    const q = { kind: WaterKind.Land, body: WaterKind.Land, shore: 0, surface: 0, halfWidth: 0 } as Parameters<typeof world.water.query>[2];
    for (let i = 0; i < p.length; i += 3 * 7) if (world.water.query(p[i] + d.cx, p[i + 2] + d.cz, q).kind === WaterKind.Sea) wet++;
    expect(wet / (p.length / 21)).toBeLessThan(0.01);
  });

  it('subdivides blocks into lots that conserve area', () => {
    const block = [0, 0, 120, 0, 120, 80, 0, 80];
    const lots: number[][] = [];
    subdivide(block, 300, new Rng(5), lots, 0);
    expect(lots.length).toBeGreaterThan(10);
    expect(lots.reduce((a, l) => a + polyArea(l), 0)).toBeCloseTo(polyArea(block), 3);
  });
});
