/**
 * Central configuration: world frame, LOD budgets and data sources. Everything
 * tunable for performance lives here so profiles (desktop / mobile) are one place.
 */
export const WORLD = {
  /** Projection origin: central meridian and origin latitude (≈ Egypt's centroid). */
  origin: { lon: 30.8, lat: 26.8 },
  /** Extent of the fine national data (0.01° DEM + rasters). Must match BBOX in tools/bake-gis.mjs. */
  bounds: { west: 24.0, south: 21.4, east: 37.6, north: 32.2 },
  /** Regional context (0.05° DEM, coarse vectors) so macro views never run off the data. */
  context: { west: 10.5, south: 11.5, east: 51.0, north: 42.0 },
  earthRadius: 6_371_008.8,
} as const;

export const TERRAIN = {
  /** Root quad edge (m): 100 m × 2^15, so leaves are 100 m with ~3 m vertex spacing. */
  rootSize: 3_276_800,
  maxDepth: 15,
  /** Quads per node edge (vertices = segments + 1). */
  segments: 32,
  /** A node splits while camera distance < size × splitFactor (≈ constant screen-space error). */
  splitFactor: 2.4,
  /** GPU-resident node meshes kept before LRU eviction. */
  maxCachedNodes: 900,
  /** Max node builds in flight across all workers. */
  maxInFlight: 12,
  /** Skirt depth as a fraction of node size (hides T-junction cracks between LODs). */
  skirtFactor: 0.02,
} as const;

export const CITY = {
  /** City tile edge (m); each tile is generated independently and deterministically. */
  tileSize: 1000,
  /** Camera distance (m) below which a tile gets full lot/building detail. */
  detailRange: 2600,
  /** Camera distance (m) below which a tile shows block massing. */
  massingRange: 9000,
  maxDetailTiles: 36,
  maxMassingTiles: 220,
} as const;

export const NAVIGATION = {
  minDistance: 25,
  maxDistance: 2_000_000,
  minClearance: 1.8,
  fovDeg: 50,
  /** Initial macro view: the whole country. */
  home: { lon: 30.4, lat: 26.9, distance: 1_550_000, headingDeg: 0, pitchDeg: 88 },
} as const;

/** Static files produced by tools/bake-gis.mjs (served from /public). */
export const DATA_URLS = {
  gis: 'data/egypt-gis.json',
  dem: 'data/egypt-dem.v1.bin',
  contextDem: 'data/context-dem.v1.bin',
} as const;

export interface TileSource {
  id: string;
  name: string;
  url: string;
  maxZoom: number;
  attribution: string;
}

/** Optional live sources, all switchable at runtime from the Layers panel. */
export const LIVE_SOURCES = {
  dem: {
    id: 'terrarium',
    name: 'AWS Terrain Tiles (SRTM/GMTED, USGS)',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    maxZoom: 14,
    encoding: 'terrarium' as 'terrarium' | 'mapbox',
    attribution: 'Elevation: SRTM & GMTED2010 (USGS/NASA), ETOPO1 (NOAA) via AWS Terrain Tiles',
  },
  imagery: [
    {
      id: 'esri',
      name: 'Esri World Imagery',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 18,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    {
      id: 's2cloudless',
      name: 'Sentinel-2 cloudless (EOX)',
      url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
      maxZoom: 15,
      attribution: 'Sentinel-2 cloudless 2020 by EOX IT Services GmbH (CC BY-NC-SA 4.0)',
    },
  ] as TileSource[],
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'],
  osmAttribution: '© OpenStreetMap contributors (ODbL)',
} as const;
