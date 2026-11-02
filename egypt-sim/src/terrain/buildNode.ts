/**
 * Terrain node mesh builder (pure; runs in workers). Produces a (S+1)² vertex grid
 * plus a skirt ring, with per-vertex surface attributes for the terrain shader.
 * Topology (indices) is identical for every node and built once on the main thread.
 */
import { newSample, type TerrainModel } from '../gis/terrainModel';
import { WaterKind } from '../gis/hydrography';
import type { ElevationFn } from '../gis/liveDem';

export interface TerrainNodeData {
  /** Local positions (relative to the node centre on x/z, absolute y). */
  positions: Float32Array;
  normals: Int8Array;
  /** fertility, urban, rock, sand (unorm8). */
  surfA: Uint8Array;
  /** foreign, log2(spacing)·16, nearest water-body kind·85, unused (unorm8). */
  surfB: Uint8Array;
  /** lon, lat, water depth (m), signed shore distance (m). */
  geo: Float32Array;
  minY: number;
  maxY: number;
}

export const vertexCount = (s: number): number => (s + 1) * (s + 1) + 4 * (s + 1);

/** Shared index buffer: grid triangles (CCW seen from above) + double-sided skirts. */
export function buildTerrainIndices(s: number): Uint16Array {
  const n = s + 1;
  const idx: number[] = [];
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const a = j * n + i;
      const b = (j + 1) * n + i;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const edges = edgeVertexOrder(s);
  let skirt = n * n;
  for (const edge of edges) {
    for (let k = 0; k < s; k++) {
      const a = edge[k];
      const b = edge[k + 1];
      const sa = skirt + k;
      const sb = skirt + k + 1;
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
    skirt += n;
  }
  return new Uint16Array(idx);
}

/** Grid vertex indices along the four edges (N, E, S, W), in skirt order. */
function edgeVertexOrder(s: number): number[][] {
  const n = s + 1;
  const north: number[] = [];
  const east: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  for (let k = 0; k <= s; k++) {
    north.push(k);
    east.push(k * n + s);
    south.push(s * n + (s - k));
    west.push((s - k) * n);
  }
  return [north, east, south, west];
}

const spacingCode = (spacing: number): number => Math.max(0, Math.min(255, Math.round(Math.log2(Math.max(1, spacing)) * 16)));

export function buildTerrainNode(
  model: TerrainModel,
  cx: number,
  cz: number,
  size: number,
  s: number,
  skirtDepth: number,
  elevation?: ElevationFn | null,
): TerrainNodeData {
  const n = s + 1;
  const step = size / s;
  const b = s + 3; // bordered grid edge (one extra sample on each side, for normals)
  const heights = new Float32Array(b * b);
  const verts = vertexCount(s);
  const positions = new Float32Array(verts * 3);
  const normals = new Int8Array(verts * 3);
  const surfA = new Uint8Array(verts * 4);
  const surfB = new Uint8Array(verts * 4);
  const geo = new Float32Array(verts * 4);
  const water = new Uint8Array(n * n);
  const sample = newSample();
  const code = spacingCode(step);
  let minY = Infinity;
  let maxY = -Infinity;
  const x0 = cx - size / 2;
  const z0 = cz - size / 2;

  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const interior = i >= 0 && j >= 0 && i < n && j < n;
      model.sample(x, z, step, sample, elevation);
      heights[(j + 1) * b + (i + 1)] = sample.height;
      if (!interior) continue;
      const v = j * n + i;
      positions[v * 3] = x - cx;
      positions[v * 3 + 1] = sample.height;
      positions[v * 3 + 2] = z - cz;
      surfA[v * 4] = sample.fertility * 255;
      surfA[v * 4 + 1] = sample.urban * 255;
      surfA[v * 4 + 2] = sample.rock * 255;
      surfA[v * 4 + 3] = sample.sand * 255;
      surfB[v * 4] = sample.foreign * 255;
      surfB[v * 4 + 1] = code;
      surfB[v * 4 + 2] = sample.body * 85;
      geo[v * 4] = sample.lon;
      geo[v * 4 + 1] = sample.lat;
      geo[v * 4 + 2] = sample.water;
      geo[v * 4 + 3] = sample.shore;
      water[v] = sample.kind !== WaterKind.Land ? 1 : 0;
      if (sample.height < minY) minY = sample.height;
      if (sample.height > maxY) maxY = sample.height;
    }
  }

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      let nx = 0;
      let ny = 1;
      let nz = 0;
      if (!water[v]) {
        const c = (j + 1) * b + (i + 1);
        nx = -(heights[c + 1] - heights[c - 1]) / (2 * step);
        nz = -(heights[c + b] - heights[c - b]) / (2 * step);
        const len = Math.hypot(nx, 1, nz);
        nx /= len;
        ny = 1 / len;
        nz /= len;
      }
      normals[v * 3] = Math.round(nx * 127);
      normals[v * 3 + 1] = Math.round(ny * 127);
      normals[v * 3 + 2] = Math.round(nz * 127);
    }
  }

  // Skirts: copies of the edge vertices dropped by skirtDepth.
  let sv = n * n;
  for (const edge of edgeVertexOrder(s)) {
    for (const v of edge) {
      positions.set([positions[v * 3], positions[v * 3 + 1] - skirtDepth, positions[v * 3 + 2]], sv * 3);
      normals.set(normals.subarray(v * 3, v * 3 + 3), sv * 3);
      surfA.set(surfA.subarray(v * 4, v * 4 + 4), sv * 4);
      surfB.set(surfB.subarray(v * 4, v * 4 + 4), sv * 4);
      geo.set(geo.subarray(v * 4, v * 4 + 4), sv * 4);
      sv++;
    }
  }

  return { positions, normals, surfA, surfB, geo, minY, maxY };
}
