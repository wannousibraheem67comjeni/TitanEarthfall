/**
 * Builds the shared world model (projection → DEM → rasters → water → districts →
 * terrain function). The main thread builds it once from the network files; workers
 * rebuild it from transferred buffers so every thread samples the identical function.
 */
import type { CityDistrict, GisData, Landmark, RegionsData } from '../data/schema';
import type { Bounds2 } from '../core/spatialIndex';
import { WORLD, TERRAIN } from '../config';
import { DistrictIndex } from '../city/districts';
import { DemGrid } from './dem';
import { GeoRasters, type RasterBuffers } from './rasters';
import { GeoProjection } from './projection';
import { WaterModel } from './hydrography';
import { TerrainModel } from './terrainModel';

export interface Datasets {
  gis: GisData;
  cities: CityDistrict[];
  landmarks: Landmark[];
  regions: RegionsData;
}

export interface World extends Datasets {
  proj: GeoProjection;
  dem: DemGrid;
  contextDem: DemGrid;
  rasters: GeoRasters;
  water: WaterModel;
  districts: DistrictIndex;
  terrain: TerrainModel;
  bounds: Bounds2;
}

/** Serializable snapshot handed to workers. */
type DemTransfer = { width: number; height: number; west: number; south: number; east: number; north: number; data: Int16Array };

export interface WorldTransfer extends Datasets {
  dem: DemTransfer;
  contextDem: DemTransfer;
  rasters: RasterBuffers;
}

export function worldBounds(): Bounds2 {
  const h = TERRAIN.rootSize / 2;
  return { minX: -h, minY: -h, maxX: h, maxY: h };
}

export function buildWorld(data: Datasets, dem: DemGrid, contextDem: DemGrid, rasters?: GeoRasters): World {
  const proj = new GeoProjection(WORLD.origin, WORLD.earthRadius);
  const bounds = worldBounds();
  const r = rasters ?? GeoRasters.build(data.gis, dem);
  const water = new WaterModel(data.gis, proj, bounds);
  const districts = new DistrictIndex(data.cities, proj);
  const terrain = new TerrainModel({
    proj, dem, contextDem, rasters: r, water, districts, regions: data.regions, landmarks: data.landmarks,
    lakeSurfaces: data.gis.lakes.map((l) => l.surface), bounds,
  });
  return { ...data, proj, dem, contextDem, rasters: r, water, districts, terrain, bounds };
}

export function toTransfer(w: World): { payload: WorldTransfer; transfer: ArrayBuffer[] } {
  const rasters = w.rasters.cloneBuffers();
  const pack = (g: DemGrid): DemTransfer => ({ width: g.width, height: g.height, west: g.west, south: g.south, east: g.east, north: g.north, data: g.data.slice() });
  const dem = pack(w.dem);
  const contextDem = pack(w.contextDem);
  const transfer = [
    dem.data.buffer, contextDem.data.buffer, rasters.water.buffer, rasters.lakeId.buffer, rasters.egypt.buffer, rasters.riverDist.buffer,
    rasters.riverSurf.buffer, rasters.waterDist.buffer, rasters.coastDist.buffer,
  ] as ArrayBuffer[];
  return { payload: { gis: w.gis, cities: w.cities, landmarks: w.landmarks, regions: w.regions, dem, contextDem, rasters }, transfer };
}

export function fromTransfer(t: WorldTransfer): World {
  const unpack = (d: DemTransfer) => new DemGrid(d.width, d.height, d.west, d.south, d.east, d.north, d.data);
  return buildWorld(t, unpack(t.dem), unpack(t.contextDem), GeoRasters.fromBuffers(t.rasters));
}
