/**
 * The terrain function: f(x, z, spacing) → elevation + surface classification.
 *
 *   elevation = real DEM (bicubic, ≈1.1 km SRTM/GMTED)
 *             + band-limited procedural detail for wavelengths the DEM cannot resolve
 *               (rock relief, seif dunes, micro-roughness), pre-filtered by `spacing`
 *               so coarse LOD nodes never alias
 *             + exact vector water (rivers carved, lakes/sea flattened to their level)
 *             + landmark flatten zones
 *
 * Deterministic and dependency-free (no DOM, no Three.js) so it runs identically in
 * the main thread (camera collision, picking) and in mesh-building workers.
 */
import type { Landmark, RegionsData } from '../data/schema';
import { createNoise2D, type Noise2D } from '../core/noise';
import { DEG, lerp, saturate, smoothstep } from '../core/math';
import { RingIndex, SegmentGrid, type Bounds2, type NearestHit } from '../core/spatialIndex';
import type { DistrictIndex } from '../city/districts';
import type { DemGrid } from './dem';
import type { GeoRasters } from './rasters';
import type { GeoProjection } from './projection';
import { SHORE_RANGE, WaterKind, type WaterModel, type WaterQuery } from './hydrography';
import type { ElevationFn } from './liveDem';

export interface TerrainSample {
  /** Rendered surface: ground on land, the water surface over water. */
  height: number;
  /** Ground / bed elevation. */
  ground: number;
  /** Water depth (m), 0 on land. */
  water: number;
  kind: WaterKind;
  /** Kind of the water body this sample belongs or is nearest to (shading of shorelines). */
  body: WaterKind;
  /** Signed distance to the shoreline (m, negative in water), saturating at ±SHORE_RANGE. */
  shore: number;
  fertility: number;
  urban: number;
  rock: number;
  sand: number;
  /** 1 outside Egypt. */
  foreign: number;
  lon: number;
  lat: number;
}

export const newSample = (): TerrainSample => ({
  height: 0, ground: 0, water: 0, kind: WaterKind.Land, body: WaterKind.Sea, shore: SHORE_RANGE,
  fertility: 0, urban: 0, rock: 0, sand: 0, foreign: 0, lon: 0, lat: 0,
});

interface FlattenZone {
  x: number;
  z: number;
  r: number;
  h: number;
}

interface SandSeaZone {
  index: RingIndex;
  /** Unit normal to the dune crests (world xz) and crest direction. */
  nx: number;
  nz: number;
  spacing: number;
  amplitude: number;
}

export interface TerrainModelDeps {
  proj: GeoProjection;
  /** Fine national DEM (0.01°) — the rasters share its lattice. */
  dem: DemGrid;
  /** Coarse regional DEM (0.05°) used outside the national grid. */
  contextDem: DemGrid;
  rasters: GeoRasters;
  water: WaterModel;
  districts: DistrictIndex;
  regions: RegionsData;
  landmarks: Landmark[];
  lakeSurfaces: number[];
  bounds: Bounds2;
}

const M_PER_DEG = 111_195;
/** Width (degrees) of the band where the fine national grid fades into the context grid. */
const EDGE_BLEND = 0.15;

export class TerrainModel {
  private readonly nRock: Noise2D = createNoise2D(11);
  private readonly nGentle: Noise2D = createNoise2D(23);
  private readonly nFine: Noise2D = createNoise2D(37);
  private readonly nPatch: Noise2D = createNoise2D(41);
  private readonly nDune: Noise2D = createNoise2D(53);
  private readonly oases: { x: number; z: number; r: number }[];
  private readonly flatten: FlattenZone[] = [];
  private readonly sandSeas: SandSeaZone[] = [];
  private readonly sandEdges: SegmentGrid;
  private readonly q: WaterQuery = { kind: WaterKind.Land, body: WaterKind.Sea, shore: 0, surface: 0, halfWidth: 0 };
  private readonly hit: NearestHit = { dist: 0, segment: 0, t: 0 };
  private readonly scratch = newSample();

  constructor(private readonly d: TerrainModelDeps) {
    const { proj } = d;
    this.oases = d.regions.oases.map((o) => {
      const [x, z] = proj.forward(o.lon, o.lat);
      return { x, z, r: o.radius };
    });

    this.sandEdges = new SegmentGrid(d.bounds, 4000, 20000);
    for (const s of d.regions.sandSeas) {
      const ring: number[] = [];
      for (let i = 0; i < s.ring.length; i += 2) ring.push(...proj.forward(s.ring[i], s.ring[i + 1]));
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) this.sandEdges.add(ring[j], ring[j + 1], ring[i], ring[i + 1]);
      const crest = s.crestDeg * DEG;
      this.sandSeas.push({ index: new RingIndex([ring], 5000), nx: Math.cos(crest), nz: Math.sin(crest), spacing: s.spacing, amplitude: s.amplitude });
    }
    this.sandEdges.build();

    // Landmarks: dry islands first (they change the water answer), then flatten pads.
    const dry: { x: number; z: number; radius: number }[] = [];
    for (const l of d.landmarks) {
      if (!l.forceLand) continue;
      const [x, z] = proj.forward(l.lon, l.lat);
      dry.push({ x, z, radius: Math.max(60, l.clearRadius * 0.6) });
    }
    d.water.setDryZones(dry);
    for (const l of d.landmarks) {
      if (l.clearRadius <= 0 || l.model.type === 'marker' || l.model.type === 'avenue' || l.model.type === 'dam') continue;
      const [x, z] = proj.forward(l.lon, l.lat);
      const s = this.sample(x, z, 1, this.scratch);
      this.flatten.push({ x, z, r: l.clearRadius, h: s.ground });
    }
  }

  /** Full-detail rendered height (water surface over water). */
  height(x: number, z: number): number {
    return this.sample(x, z, 1, this.scratch).height;
  }

  /**
   * @param spacing   vertex spacing (m) of the mesh being built; detail finer than
   *                  ~2–5× spacing is faded out, and channels narrower than the
   *                  spacing are left to the macro texture and line overlays.
   * @param elevation optional live high-resolution DEM; replaces the baked grid and
   *                  most of the synthetic relief where it has data.
   */
  sample(x: number, z: number, spacing: number, out: TerrainSample = newSample(), elevation?: ElevationFn | null): TerrainSample {
    const { proj, dem, rasters } = this.d;
    const [lon, lat] = proj.inverse(x, z);
    out.lon = lon;
    out.lat = lat;

    // Weight of the fine national grid: 1 well inside it, fading to 0 at its edge.
    const wFine = Math.min(
      smoothstep(0, EDGE_BLEND, lon - dem.west), smoothstep(0, EDGE_BLEND, dem.east - lon),
      smoothstep(0, EDGE_BLEND, lat - dem.south), smoothstep(0, EDGE_BLEND, dem.north - lat),
    );
    const live = elevation ? elevation(lon, lat) : NaN;
    const hasLive = Number.isFinite(live);
    const grid = wFine > 0 ? dem : this.d.contextDem;
    const hGrid = wFine >= 1 ? dem.sampleBicubic(lon, lat) : wFine <= 0 ? this.d.contextDem.sampleBicubic(lon, lat)
      : lerp(this.d.contextDem.sampleBicubic(lon, lat), dem.sampleBicubic(lon, lat), wFine);
    const h0 = hasLive ? live : hGrid;
    // Slope from the DEM (m/m), via bilinear central differences ≈ 400 m (or one context cell) apart.
    const e = wFine > 0 ? 0.0036 : grid.stepLon;
    const kLon = M_PER_DEG * Math.cos(lat * DEG);
    const sx = (grid.sampleBilinear(lon + e, lat) - grid.sampleBilinear(lon - e, lat)) / (2 * e * kLon);
    const sz = (grid.sampleBilinear(lon, lat + e) - grid.sampleBilinear(lon, lat - e)) / (2 * e * M_PER_DEG);
    const slope = Math.hypot(sx, sz);

    // Raster-derived fields only exist on the national lattice.
    const foreign = 1 - rasters.egypt(lon, lat) * wFine;
    const waterDist = wFine >= 1 ? rasters.waterDistance(lon, lat) : 0;

    // ── fertility: irrigated valley floor near the Nile system, plus oases ──
    const riverD = rasters.riverDistance(lon, lat);
    const riverS = rasters.riverSurface(lon, lat);
    // Valley floors near the river system are irrigated; in the Delta lowlands (< ~20 m)
    // the canal network reaches everything between the branches, so extend the range.
    const reach = lerp(30000, 65000, smoothstep(22, 8, h0));
    let fertility = smoothstep(16, 6, h0 - riverS) * smoothstep(reach, reach * 0.5, riverD) * wFine;
    for (const o of this.oases) {
      const dx = x - o.x;
      const dz = z - o.z;
      if (Math.abs(dx) > o.r || Math.abs(dz) > o.r) continue;
      // Oases are clusters of fields around springs, not discs: break them up with noise.
      const radial = smoothstep(o.r, o.r * 0.35, Math.hypot(dx, dz));
      fertility = Math.max(fertility, radial * smoothstep(-0.35, 0.25, this.nPatch(x / 3500 + 5.3, z / 3500 - 2.1)));
    }
    const patch = this.nPatch(x / 900, z / 900);
    fertility *= (0.82 + 0.18 * patch) * (1 - 0.6 * foreign) * smoothstep(0.12, 0.05, slope);

    // ── urban: districts plus a scatter of villages over farmland ──
    let urban = this.d.districts.urban(x, z, spacing);
    // Villages pepper the farmland; coarse levels use their area-average density.
    const villages = spacing > 1500 ? fertility * 0.3 : smoothstep(0.6, 0.8, this.nPatch(x / 2300 + 31.7, z / 2300 - 8.3)) * fertility * 0.6;
    urban = Math.max(urban, villages);

    // ── sand seas (seif dunes) ──
    let sand = 0;
    let dune = 0;
    for (const s of this.sandSeas) {
      if (!s.index.contains(x, z)) continue;
      const edge = this.sandEdges.nearest(x, z, this.hit);
      const mask = edge ? smoothstep(0, 20000, edge.dist) : 1;
      sand = Math.max(sand, mask);
      const w = smoothstep(s.spacing * 0.6, s.spacing * 0.25, spacing);
      const along = (x * -s.nz + z * s.nx) / (s.spacing * 9);
      const across = (x * s.nx + z * s.nz) / s.spacing + 0.7 * this.nDune(x / (s.spacing * 7), z / (s.spacing * 7));
      const f = across - Math.floor(across);
      const profile = f < 0.72 ? smoothstep(0, 0.72, f) : smoothstep(1, 0.72, f);
      const crestVar = 0.55 + 0.45 * this.nDune(along, 3.1);
      dune += mask * s.amplitude * lerp(0.5, profile * crestVar, w);
    }

    // ── band-limited micro relief ──
    const rough = smoothstep(0.015, 0.12, slope);
    const synth = hasLive ? 0.2 : 1;
    let detail =
      synth * rough * 45 * bandFbm(this.nRock, x, z, 1100, 4, spacing, true) +
      synth * (1 - rough) * 3 * bandFbm(this.nGentle, x, z, 3200, 3, spacing, false) +
      (0.7 + 3 * rough) * bandFbm(this.nFine, x, z, 90, 3, spacing, false) +
      dune;
    detail *= (1 - 0.9 * fertility) * (1 - 0.85 * urban) * smoothstep(300, 2500, waterDist);

    let ground = h0 + detail;
    let height = ground;
    let water = 0;
    let kind: WaterKind = WaterKind.Land;
    let body: WaterKind = WaterKind.Sea;
    let inChannel = false;
    let shore = Math.min(SHORE_RANGE, waterDist);

    if (spacing > 3000 && wFine >= 1) {
      // Coarse LOD: rasterised sea/lake coverage is cheaper and already band-limited.
      if (rasters.water(lon, lat) > 0.5) {
        const lake = rasters.lake(lon, lat);
        const surface = lake >= 0 ? this.d.lakeSurfaces[lake] : 0;
        kind = body = lake >= 0 ? WaterKind.Lake : WaterKind.Sea;
        ground = Math.min(h0, surface - 4);
        height = surface;
        water = surface - ground;
        shore = -SHORE_RANGE;
      }
    } else if (wFine < 1 || waterDist < SHORE_RANGE + 1500 || rasters.water(lon, lat) > 0) {
      const q = this.d.water.query(x, z, this.q);
      shore = q.shore;
      body = q.body;
      if (q.body === WaterKind.River && q.halfWidth > 0 && (q.kind === WaterKind.River || q.kind === WaterKind.Land)) {
        // Rivers and canals are drawn by vector ribbons (WaterRibbons.ts); the terrain
        // only carves their channel. Where the mesh is coarser than the channel, carve a
        // trench at least ¾ of a vertex step wide so the ribbon is never buried.
        const centre = q.shore + q.halfWidth;
        const half = Math.max(q.halfWidth, spacing * 1.25);
        if (centre < half) {
          ground = Math.min(ground, q.surface - (1 + 6 * Math.sqrt(saturate(1 - centre / half))));
          inChannel = true;
        } else if (q.shore < 2500 && spacing < 2000) {
          ground = this.bank(ground, q.surface, q.shore);
        }
        shore = Math.max(0.5, q.shore);
        height = ground;
      } else if (q.kind !== WaterKind.Land) {
        const inside = -q.shore;
        const bed = q.kind === WaterKind.Sea ? Math.min(hGrid, -1.5 - inside * 0.03) : q.surface - Math.min(70, 1.5 + inside * 0.05);
        kind = q.kind;
        ground = bed;
        height = q.surface;
        water = q.surface - bed;
      } else if (q.shore < 2500 && spacing < 2000) {
        ground = this.bank(ground, q.surface, q.shore);
        // Beaches at the sea.
        if (q.surface === 0 && q.shore < 300) ground = lerp(0.4 + q.shore * 0.008, ground, smoothstep(0, 300, q.shore));
        height = ground;
      }
    }

    if (kind === WaterKind.Land && !inChannel) {
      for (const f of this.flatten) {
        const dx = x - f.x;
        const dz = z - f.z;
        if (Math.abs(dx) > f.r || Math.abs(dz) > f.r) continue;
        const t = smoothstep(f.r, f.r * 0.55, Math.hypot(dx, dz));
        ground = lerp(ground, f.h, t);
      }
      height = ground;
    }

    const rockNoise = this.nPatch(x / 5000 - 17.3, z / 5000 + 4.1);
    out.height = height;
    out.ground = ground;
    out.water = water;
    out.kind = kind;
    out.body = body;
    out.shore = shore;
    out.fertility = kind === WaterKind.Land ? fertility : 0;
    out.urban = kind === WaterKind.Land ? urban : 0;
    out.rock = saturate(smoothstep(0.02, 0.11, slope) + 0.2 * rockNoise + (h0 > 900 ? 0.3 : 0)) * (1 - sand);
    out.sand = sand;
    out.foreign = foreign;
    return out;
  }

  /** Keeps land just above an adjacent water level (levees / banks), fading out by 2.5 km. */
  private bank(ground: number, surface: number, shore: number): number {
    const minH = surface + 0.6 + Math.max(0, shore) * 0.003;
    return ground < minH ? ground + (minH - ground) * smoothstep(2500, 500, shore) : ground;
  }

  /** Cheap raster-only classification on the DEM lattice, for the macro texture and minimap. */
  macroAt(lon: number, lat: number, x: number, z: number): { fertility: number; urban: number; rock: number; water: number; height: number } {
    const { dem, rasters } = this.d;
    const h0 = dem.sampleBilinear(lon, lat);
    const e = dem.stepLon;
    const kLon = M_PER_DEG * Math.cos(lat * DEG);
    const slope = Math.hypot(
      (dem.sampleBilinear(lon + e, lat) - dem.sampleBilinear(lon - e, lat)) / (2 * e * kLon),
      (dem.sampleBilinear(lon, lat + e) - dem.sampleBilinear(lon, lat - e)) / (2 * e * M_PER_DEG),
    );
    const s = this.sample(x, z, 4000, this.scratch);
    const riverCover = saturate((300 + 550 - rasters.riverDistance(lon, lat)) / 1100);
    const water = Math.max(rasters.water(lon, lat), riverCover);
    return {
      fertility: s.fertility * (1 - water),
      urban: Math.max(s.urban, this.d.districts.urban(x, z, 1500)) * (1 - water),
      rock: saturate(smoothstep(0.02, 0.11, slope) + (h0 > 900 ? 0.3 : 0)),
      water,
      height: h0,
    };
  }
}

/**
 * Fractal noise restricted to wavelengths ≥ ~3× the sampling spacing (anti-aliased),
 * normalised against the full octave stack so amplitude is LOD-independent.
 */
function bandFbm(noise: Noise2D, x: number, z: number, wavelength: number, octaves: number, spacing: number, ridged: boolean): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let wl = wavelength;
  for (let o = 0; o < octaves; o++) {
    norm += amp;
    const w = smoothstep(2 * spacing, 5 * spacing, wl);
    if (w > 0) {
      const n = noise(x / wl, z / wl);
      sum += amp * w * (ridged ? (1 - Math.abs(n)) ** 2 - 0.45 : n);
    }
    amp *= 0.5;
    wl *= 0.5;
  }
  return sum / norm;
}
