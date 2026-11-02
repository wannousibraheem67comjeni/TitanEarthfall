#!/usr/bin/env node
/**
 * Offline GIS bake: turns heavy public datasets into the small static files the
 * simulation ships with (≈1.5 MB total), so the browser never has to parse
 * national-scale GeoJSON or thousands of DEM tiles at startup.
 *
 * Sources (all public domain):
 *   - Natural Earth 1:10m — land, country outline, 27 governorates (admin-1),
 *     rivers/canals and lakes.
 *   - AWS Open Data "Terrain Tiles" (Terrarium PNG encoding). Over Egypt these are
 *     derived from SRTM (NASA/USGS) and GMTED2010 (USGS) on land and ETOPO1 (NOAA)
 *     bathymetry at sea. See tools/build-dem.sh for the equivalent pipeline that
 *     starts directly from USGS EarthExplorer downloads with GDAL.
 *
 * Outputs:
 *   public/data/egypt-gis.json    clipped + simplified vectors, flat [lon,lat,…] rings
 *   public/data/egypt-dem.v1.bin  gzip(header + row-delta Int16 metres), 0.01° national grid
 *   public/data/context-dem.v1.bin same container, 0.05° regional context grid (Libya → Arabia)
 *   .cache/preview.png            hillshade/water/borders preview (with --preview)
 *
 * Usage: node tools/bake-gis.mjs [--preview] [--dem-raw dem.raw]
 *   --dem-raw  use a raw little-endian Int16 grid (north row first, matching the
 *              0.01° grid below) produced by tools/build-dem.sh from USGS SRTM
 *              instead of fetching Terrarium tiles.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');

/** Must match WORLD.bounds in src/config.ts. */
const BBOX = { west: 24.0, south: 21.4, east: 37.6, north: 32.2 };
const DEM_STEP = 0.01;
const DEM_ZOOM = 8;
/**
 * Regional context around Egypt (eastern Mediterranean, Arabia, Sudan): covers the
 * whole terrain quadtree root so the macro view never runs off the data. Must match
 * WORLD.context in src/config.ts.
 */
const CONTEXT = { west: 10.5, south: 11.5, east: 51.0, north: 42.0 };
const CONTEXT_STEP = 0.05;
const CONTEXT_ZOOM = 6;
/** Vector detail: fine inside Egypt (+ margin), coarse in the context ring. */
const FINE_ZONE = { west: BBOX.west - 0.3, south: BBOX.south - 0.3, east: BBOX.east + 0.3, north: BBOX.north + 0.3 };
const inFine = (p) => p[0] >= FINE_ZONE.west && p[0] <= FINE_ZONE.east && p[1] >= FINE_ZONE.south && p[1] <= FINE_ZONE.north;
const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

const RIVERS = [
  // id, Natural Earth name, width (m), include NE "Lake Centerline" parts, flow orientation
  { id: 'nile', ne: 'Nile', name: 'Nile', nameAr: 'نهر النيل', width: 600, lakeParts: true, flow: 'north' },
  { id: 'rosetta', ne: 'Rosetta Branch', name: 'Rosetta Branch', nameAr: 'فرع رشيد', width: 280, lakeParts: false, flow: 'north' },
  { id: 'damietta', ne: 'Damietta Branch', name: 'Damietta Branch', nameAr: 'فرع دمياط', width: 260, lakeParts: false, flow: 'north' },
  { id: 'suez', ne: 'Suez Canal', name: 'Suez Canal', nameAr: 'قناة السويس', width: 300, lakeParts: true, flow: 'south', seaLevel: true },
  { id: 'ismailiya', ne: 'Ismailiya Canal', name: 'Ismailiya Canal', nameAr: 'ترعة الإسماعيلية', width: 45, lakeParts: false, flow: 'east' },
  { id: 'mahmoudiya', ne: null, name: 'Mahmoudiya Canal', nameAr: 'ترعة المحمودية', width: 45, lakeParts: false, flow: 'west' },
];

/**
 * Water bodies missing from Natural Earth 1:10m. Hand-digitised approximations
 * (±1 km); replace with OSM `natural=water` polygons for survey-grade work.
 */
const SUPPLEMENTARY_LAKES = [
  { id: 'qarun', name: 'Lake Qarun', nameAr: 'بحيرة قارون', ring: [30.40, 29.43, 30.48, 29.46, 30.58, 29.49, 30.68, 29.51, 30.78, 29.53, 30.83, 29.51, 30.80, 29.48, 30.70, 29.47, 30.60, 29.45, 30.50, 29.42, 30.42, 29.41] },
  { id: 'timsah', seaLevel: true, name: 'Lake Timsah', nameAr: 'بحيرة التمساح', ring: [32.26, 30.575, 32.29, 30.59, 32.33, 30.585, 32.345, 30.565, 32.31, 30.555, 32.275, 30.56] },
  { id: 'manzala', seaLevel: true, name: 'Lake Manzala', nameAr: 'بحيرة المنزلة', ring: [31.88, 31.38, 32.0, 31.33, 32.12, 31.29, 32.24, 31.24, 32.27, 31.18, 32.2, 31.1, 32.05, 31.1, 31.95, 31.15, 31.88, 31.22, 31.85, 31.3] },
  { id: 'burullus', seaLevel: true, name: 'Lake Burullus', nameAr: 'بحيرة البرلس', ring: [30.55, 31.47, 30.65, 31.52, 30.8, 31.55, 30.95, 31.57, 31.08, 31.52, 31.05, 31.45, 30.9, 31.42, 30.75, 31.4, 30.6, 31.4] },
  { id: 'idku', seaLevel: true, name: 'Lake Idku', nameAr: 'بحيرة إدكو', ring: [30.1, 31.27, 30.17, 31.3, 30.25, 31.29, 30.24, 31.25, 30.15, 31.23] },
  { id: 'mariout', name: 'Lake Mariout', nameAr: 'بحيرة مريوط', ring: [29.82, 31.13, 29.88, 31.17, 29.95, 31.175, 29.98, 31.15, 29.9, 31.12, 29.84, 31.1] },
  { id: 'bardawil', seaLevel: true, name: 'Lake Bardawil', nameAr: 'بحيرة البردويل', ring: [32.78, 31.1, 32.95, 31.16, 33.15, 31.19, 33.35, 31.18, 33.52, 31.14, 33.45, 31.08, 33.25, 31.06, 33.05, 31.05, 32.88, 31.04] },
];

/**
 * Land carved back out of over-generous 1:10m lake outlines, so shoreline
 * landmarks sit on their real bank (the patch edge becomes the shore).
 */
const LAND_PATCHES = [
  // West bank of Lake Nasser at Abu Simbel: both temples face east onto the water.
  { id: 'abu-simbel-bank', ring: [31.598, 22.322, 31.6285, 22.322, 31.6295, 22.3365, 31.6292, 22.34, 31.62, 22.352, 31.598, 22.352] },
];

/** Natural Earth lakes kept (by name) — everything else in the bbox is outside Egypt. */
const NE_LAKES = { 'Lake Nasser': { id: 'nasser', nameAr: 'بحيرة ناصر' }, 'Great Bitter Lake': { id: 'great-bitter', nameAr: 'البحيرة المرة الكبرى', seaLevel: true } };

// ───────────────────────────── helpers ─────────────────────────────

async function cached(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return buf;
}

async function loadNE(layer) {
  const buf = await cached(`${NE_BASE}/${layer}.geojson`, `ne/${layer}.geojson`);
  return JSON.parse(buf.toString('utf8')).features.filter((f) => f.geometry);
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** Sutherland–Hodgman clip of a closed ring against an axis-aligned rectangle. */
function clipRing(ring, b) {
  const edges = [
    (p) => p[0] >= b.west, (p) => p[0] <= b.east, (p) => p[1] >= b.south, (p) => p[1] <= b.north,
  ];
  const intersect = [
    (a, c) => lerpAt(a, c, 0, b.west), (a, c) => lerpAt(a, c, 0, b.east),
    (a, c) => lerpAt(a, c, 1, b.south), (a, c) => lerpAt(a, c, 1, b.north),
  ];
  let out = ring;
  for (let e = 0; e < 4 && out.length; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = edges[e](cur);
      const prevIn = edges[e](prev);
      if (curIn) {
        if (!prevIn) out.push(intersect[e](prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect[e](prev, cur));
      }
    }
  }
  return out;
}

function lerpAt(a, c, axis, value) {
  const t = (value - a[axis]) / (c[axis] - a[axis]);
  return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return s / 2;
}

/** Douglas–Peucker simplification (degrees); `tol` may be a function of position. */
function simplify(points, tolArg) {
  const tol = typeof tolArg === 'function' ? tolArg : () => tolArg;
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > tol(points[idx])) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function polygonsOf(geom) {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
}

function linesOf(geom) {
  return geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
}

/** Clip + simplify every ring of a (multi)polygon; returns flat rings. */
function bakeRings(geoms, { tol, minArea, bbox = BBOX }) {
  const rings = [];
  for (const g of geoms) {
    for (const poly of polygonsOf(g)) {
      for (const ring of poly) {
        const open = ring.slice(0, -1);
        const clipped = clipRing(open, bbox);
        if (clipped.length < 3 || Math.abs(ringArea(clipped)) < minArea) continue;
        const simple = simplify([...clipped, clipped[0]], tol).slice(0, -1);
        if (typeof tol === 'function' && Math.abs(ringArea(simple)) < minArea) continue;
        if (simple.length >= 3) rings.push(simple.flatMap((p) => [round(p[0], 4), round(p[1], 4)]));
      }
    }
  }
  return rings;
}

/**
 * Joins polyline parts into one chain: starts from the longest part and extends either
 * end only through parts whose endpoint touches it (≤ tol°), preferring the longest
 * candidate. Disconnected fragments and side channels are left out.
 */
function chainLines(parts, tol = 0.02) {
  const pool = parts.map((p) => p.slice()).sort((a, b) => b.length - a.length);
  let chain = pool.shift();
  const t2 = tol * tol;
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      const head = chain[0];
      const tail = chain[chain.length - 1];
      let next = null;
      if (dist2(tail, p[0]) <= t2) next = chain.concat(p.slice(1));
      else if (dist2(tail, p[p.length - 1]) <= t2) next = chain.concat(p.slice().reverse().slice(1));
      else if (dist2(head, p[p.length - 1]) <= t2) next = p.slice(0, -1).concat(chain);
      else if (dist2(head, p[0]) <= t2) next = p.slice().reverse().slice(0, -1).concat(chain);
      if (next) {
        chain = next;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
  }
  return chain;
}

/** Chaikin corner cutting: rounds hand-digitised outlines (closed flat ring). */
function chaikin(ring, iterations) {
  let r = ring;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      out.push(round(r[i] * 0.75 + r[j] * 0.25, 5), round(r[i + 1] * 0.75 + r[j + 1] * 0.25, 5));
      out.push(round(r[i] * 0.25 + r[j] * 0.75, 5), round(r[i + 1] * 0.25 + r[j + 1] * 0.75, 5));
    }
    r = out;
  }
  return r;
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const inContext = (p) => p[0] >= CONTEXT.west && p[0] <= CONTEXT.east && p[1] >= CONTEXT.south && p[1] <= CONTEXT.north;

function orient(line, flow) {
  const [a, b] = [line[0], line[line.length - 1]];
  const wrong = (flow === 'north' && a[1] > b[1]) || (flow === 'south' && a[1] < b[1]) ||
    (flow === 'east' && a[0] > b[0]) || (flow === 'west' && a[0] < b[0]);
  return wrong ? line.slice().reverse() : line;
}

// ───────────────────────────── DEM ─────────────────────────────

const lonToPx = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const latToPx = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z;
};

async function bakeDem(box = BBOX, step = DEM_STEP, z = DEM_ZOOM) {
  const x0 = Math.floor(lonToPx(box.west, z) / 256);
  const x1 = Math.floor(lonToPx(box.east, z) / 256);
  const y0 = Math.floor(latToPx(box.north, z) / 256);
  const y1 = Math.floor(latToPx(box.south, z) / 256);
  const mw = (x1 - x0 + 1) * 256;
  const mh = (y1 - y0 + 1) * 256;
  const mosaic = new Float32Array(mw * mh);
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  console.log(`DEM: fetching ${jobs.length} Terrarium tiles at z${z}…`);
  const worker = async () => {
    for (let job = jobs.pop(); job; job = jobs.pop()) {
      const [tx, ty] = job;
      const buf = await cached(`${TERRARIUM}/${z}/${tx}/${ty}.png`, `terrarium/${z}/${tx}/${ty}.png`);
      const png = PNG.sync.read(buf);
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const i = (py * 256 + px) * 4;
          const h = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
          mosaic[((ty - y0) * 256 + py) * mw + (tx - x0) * 256 + px] = h;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  const sampleMosaic = (lon, lat) => {
    const fx = Math.min(mw - 1.001, Math.max(0, lonToPx(lon, z) - x0 * 256 - 0.5));
    const fy = Math.min(mh - 1.001, Math.max(0, latToPx(lat, z) - y0 * 256 - 0.5));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const a = mosaic[iy * mw + ix];
    const b = mosaic[iy * mw + ix + 1];
    const c = mosaic[(iy + 1) * mw + ix];
    const d = mosaic[(iy + 1) * mw + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  const width = Math.round((box.east - box.west) / step) + 1;
  const height = Math.round((box.north - box.south) / step) + 1;
  const grid = new Int16Array(width * height);
  const q = step / 4;
  for (let row = 0; row < height; row++) {
    const lat = box.north - row * step;
    for (let col = 0; col < width; col++) {
      const lon = box.west + col * step;
      // 2×2 supersample ≈ box prefilter from the finer source pixels to the grid.
      const h = (sampleMosaic(lon - q, lat - q) + sampleMosaic(lon + q, lat - q) +
        sampleMosaic(lon - q, lat + q) + sampleMosaic(lon + q, lat + q)) / 4;
      grid[row * width + col] = Math.round(h);
    }
  }
  return { width, height, grid, box, step };
}

function loadRawDem(file) {
  const width = Math.round((BBOX.east - BBOX.west) / DEM_STEP) + 1;
  const height = Math.round((BBOX.north - BBOX.south) / DEM_STEP) + 1;
  const buf = fs.readFileSync(file);
  if (buf.length !== width * height * 2) throw new Error(`${file}: expected ${width}×${height} Int16 samples`);
  const grid = new Int16Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = buf.readInt16LE(i * 2);
  console.log(`DEM: loaded ${width}×${height} raw grid from ${file}`);
  return { width, height, grid, box: BBOX, step: DEM_STEP };
}

function encodeDem({ width, height, grid, box }) {
  const header = Buffer.alloc(56);
  header.write('EGDEM1\0\0', 0, 'latin1');
  header.writeUInt32LE(width, 8);
  header.writeUInt32LE(height, 12);
  header.writeDoubleLE(box.west, 16);
  header.writeDoubleLE(box.south, 24);
  header.writeDoubleLE(box.east, 32);
  header.writeDoubleLE(box.north, 40);
  header.writeUInt32LE(0, 48); // flags: row-delta Int16, north row first
  header.writeUInt32LE(0, 52);
  const deltas = new Int16Array(grid.length);
  for (let row = 0; row < height; row++) {
    let prev = 0;
    for (let col = 0; col < width; col++) {
      const v = grid[row * width + col];
      deltas[row * width + col] = v - prev;
      prev = v;
    }
  }
  return zlib.gzipSync(Buffer.concat([header, Buffer.from(deltas.buffer)]), { level: 9 });
}

function demSampler({ width, height, grid, box, step }) {
  return (lon, lat) => {
    const fx = Math.min(width - 1.001, Math.max(0, (lon - box.west) / step));
    const fy = Math.min(height - 1.001, Math.max(0, (box.north - lat) / step));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const g = (c, r) => grid[r * width + c];
    return (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
  };
}

/**
 * Water-surface profile: 25th percentile of DEM samples within ~2 km of each vertex
 * (robust to SRTM pits and bank pixels), then an isotonic non-increasing fit along
 * the flow (pool-adjacent-violators) so a single bad sample cannot drain the river.
 */
function riverSurface(points, sample, seaLevel) {
  if (seaLevel) return points.map(() => 0);
  const raw = points.map(([lon, lat]) => {
    const vals = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) vals.push(sample(lon + dx * 0.01, lat + dy * 0.01));
    vals.sort((a, b) => a - b);
    return vals[6];
  });
  const blocks = [];
  for (const v of raw) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n >= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  }
  return blocks.flatMap((b) => Array(b.n).fill(Math.max(0, Math.round((b.sum / b.n) * 10) / 10)));
}

// ───────────────────────────── point-in-polygon (preview + lake levels) ─────────────────────────────

function pointInRings(rings, lon, lat) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const [land, admin0, admin1, rivers, lakes] = await Promise.all([
    loadNE('ne_10m_land'), loadNE('ne_10m_admin_0_countries'), loadNE('ne_10m_admin_1_states_provinces'),
    loadNE('ne_10m_rivers_lake_centerlines'), loadNE('ne_10m_lakes'),
  ]);

  const rawIdx = process.argv.indexOf('--dem-raw');
  const dem = rawIdx > 0 ? loadRawDem(process.argv[rawIdx + 1]) : await bakeDem();
  const context = await bakeDem(CONTEXT, CONTEXT_STEP, CONTEXT_ZOOM);
  const fine = demSampler(dem);
  const coarse = demSampler(context);
  const inBbox = (lon, lat) => lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
  const sample = (lon, lat) => (inBbox(lon, lat) ? fine(lon, lat) : coarse(lon, lat));

  const margin = { west: BBOX.west - 0.5, south: BBOX.south - 0.5, east: BBOX.east + 0.5, north: BBOX.north + 0.5 };
  const landTol = (p) => (inFine(p) ? 0.0015 : 0.02);
  const landRings = bakeRings(land.map((f) => f.geometry), { tol: landTol, minArea: 2e-5, bbox: CONTEXT });
  const egypt = admin0.find((f) => f.properties.ADM0_A3 === 'EGY');
  const egyptRings = bakeRings([egypt.geometry], { tol: 0.002, minArea: 1e-4, bbox: margin });

  const governorates = admin1
    .filter((f) => f.properties.adm0_a3 === 'EGY')
    .map((f) => ({
      iso: f.properties.iso_3166_2,
      neName: f.properties.name,
      nameAr: f.properties.name_ar.replace(/^محافظة\s+/, ''),
      rings: bakeRings([f.geometry], { tol: 0.003, minArea: 1e-4, bbox: margin }),
    }))
    .sort((a, b) => a.iso.localeCompare(b.iso));

  const riverOut = [];
  for (const spec of RIVERS) {
    const feats = rivers.filter((f) => (spec.ne ? f.properties.name === spec.ne : f.properties.name == null) &&
      (spec.lakeParts || f.properties.featurecla === 'River'));
    const lineLen = (l) => l.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0);
    let parts = feats.flatMap((f) => linesOf(f.geometry)).map((l) => l.filter((p) => inContext(p))).filter((l) => l.length >= 2 && lineLen(l) > 0.01);
    if (spec.ne === null) parts = parts.filter((l) => l.some((p) => p[0] > 29.5 && p[0] < 31 && p[1] > 30.5 && p[1] < 31.4));
    if (!parts.length) throw new Error(`river ${spec.id} not found`);
    // Canals crossing lakes arrive as several parts and are chained; rivers keep their
    // longest in-bbox part so upstream fragments in Sudan don't bridge Lake Nasser.
    const main = spec.lakeParts ? chainLines(parts) : parts.reduce((a, b) => (b.length > a.length ? b : a));
    const line = orient(main, spec.flow);
    const surface = riverSurface(line, sample, spec.seaLevel);
    riverOut.push({
      id: spec.id, name: spec.name, nameAr: spec.nameAr, width: spec.width,
      points: line.flatMap((p) => [round(p[0], 5), round(p[1], 5)]), surface,
    });
  }

  const lakeOut = [];
  for (const f of lakes) {
    const meta = NE_LAKES[f.properties.name];
    if (meta) {
      lakeOut.push({ id: meta.id, name: f.properties.name, nameAr: meta.nameAr, approx: false, seaLevel: !!meta.seaLevel, rings: bakeRings([f.geometry], { tol: 0.002, minArea: 1e-5 }) });
      continue;
    }
    // Context lakes outside Egypt (Dead Sea, Lake Tana, …): coarse, for the regional view only.
    const rings = bakeRings([f.geometry], { tol: 0.01, minArea: 0.01, bbox: CONTEXT });
    if (!rings.length || !f.properties.name) continue;
    let id = f.properties.name.toLowerCase().replace(/[^a-z]+/g, '-');
    while (lakeOut.some((l) => l.id === id)) id += '-2';
    lakeOut.push({ id, name: f.properties.name, nameAr: f.properties.name_ar ?? f.properties.name, approx: false, seaLevel: false, rings });
  }
  for (const l of SUPPLEMENTARY_LAKES) lakeOut.push({ id: l.id, name: l.name, nameAr: l.nameAr, approx: true, seaLevel: !!l.seaLevel, rings: [chaikin(l.ring, 3)] });
  for (const lake of lakeOut) {
    if (lake.seaLevel) { lake.surface = 0; delete lake.seaLevel; continue; }
    delete lake.seaLevel;
    // Surface = median DEM sample inside the polygon (SRTM records the water surface).
    const vals = [];
    const xs = lake.rings[0].filter((_, i) => i % 2 === 0);
    const ys = lake.rings[0].filter((_, i) => i % 2 === 1);
    for (let lat = Math.min(...ys); lat <= Math.max(...ys); lat += 0.01) {
      for (let lon = Math.min(...xs); lon <= Math.max(...xs); lon += 0.01) {
        if (pointInRings(lake.rings, lon, lat)) vals.push(sample(lon, lat));
      }
    }
    vals.sort((a, b) => a - b);
    const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    lake.surface = Math.round(Math.abs(median) < 2 ? 0 : median);
  }

  const gis = {
    meta: {
      generator: 'tools/bake-gis.mjs',
      sources: ['Natural Earth 1:10m (public domain)', 'AWS Terrain Tiles: SRTM, GMTED2010 (USGS), ETOPO1 (NOAA)'],
      bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
      context: [CONTEXT.west, CONTEXT.south, CONTEXT.east, CONTEXT.north],
      ringEncoding: 'flat [lon, lat, lon, lat, …], implicitly closed; even-odd fill across all rings',
    },
    land: landRings,
    egypt: egyptRings,
    governorates,
    rivers: riverOut,
    lakes: lakeOut,
    landPatches: LAND_PATCHES.map((p) => p.ring),
  };
  const gisJson = JSON.stringify(gis);
  fs.writeFileSync(path.join(OUT, 'egypt-gis.json'), gisJson);
  const demBin = encodeDem(dem);
  fs.writeFileSync(path.join(OUT, 'egypt-dem.v1.bin'), demBin);
  const ctxBin = encodeDem(context);
  fs.writeFileSync(path.join(OUT, 'context-dem.v1.bin'), ctxBin);

  console.log(`egypt-gis.json   ${(gisJson.length / 1024).toFixed(0)} KB — land rings ${landRings.length}, governorates ${governorates.length}, rivers ${riverOut.length}, lakes ${lakeOut.length}`);
  console.log(`egypt-dem.v1.bin ${(demBin.length / 1024).toFixed(0)} KB — ${dem.width}×${dem.height} @ ${DEM_STEP}°`);
  console.log(`context-dem.v1.bin ${(ctxBin.length / 1024).toFixed(0)} KB — ${context.width}×${context.height} @ ${CONTEXT_STEP}°`);
  for (const r of riverOut) console.log(`  river ${r.id.padEnd(10)} ${r.points.length / 2} pts, surface ${r.surface[0]} → ${r.surface[r.surface.length - 1]} m`);
  for (const l of lakeOut) console.log(`  lake  ${l.id.padEnd(12)} surface ${l.surface} m${l.approx ? ' (approx outline)' : ''}`);

  if (process.argv.includes('--preview')) writePreview(dem, gis);
}

function writePreview(dem, gis) {
  const { width, height, grid } = dem;
  const png = new PNG({ width, height });
  for (let row = 0; row < height; row++) {
    const lat = BBOX.north - row * DEM_STEP;
    for (let col = 0; col < width; col++) {
      const lon = BBOX.west + col * DEM_STEP;
      const h = grid[row * width + col];
      const hx = grid[row * width + Math.min(width - 1, col + 1)] - h;
      const hy = grid[Math.min(height - 1, row + 1) * width + col] - h;
      const shade = Math.max(0, Math.min(1, 0.75 - (hx - hy) * 0.004));
      const isLand = pointInRings(gis.land, lon, lat) &&
        (!gis.lakes.some((l) => pointInRings(l.rings, lon, lat)) || pointInRings(gis.landPatches, lon, lat));
      const inEgypt = pointInRings(gis.egypt, lon, lat);
      let c = isLand ? [214, 186, 140] : [40, 90, 150];
      if (isLand && !inEgypt) c = [150, 150, 150];
      const t = isLand ? Math.min(1, Math.max(0, h / 1500)) : 0;
      const i = (row * width + col) * 4;
      png.data[i] = (c[0] * (1 - t * 0.4)) * shade;
      png.data[i + 1] = (c[1] * (1 - t * 0.5)) * shade;
      png.data[i + 2] = (c[2] * (1 - t * 0.3)) * shade;
      png.data[i + 3] = 255;
    }
  }
  const plot = (lon, lat, rgb) => {
    const col = Math.round((lon - BBOX.west) / DEM_STEP);
    const row = Math.round((BBOX.north - lat) / DEM_STEP);
    if (col < 0 || row < 0 || col >= width || row >= height) return;
    const i = (row * width + col) * 4;
    png.data.set(rgb, i);
  };
  for (const g of gis.governorates) for (const r of g.rings) for (let i = 0; i < r.length; i += 2) plot(r[i], r[i + 1], [90, 40, 40]);
  for (const r of gis.rivers) {
    for (let i = 0; i + 3 < r.points.length; i += 2) {
      for (let t = 0; t <= 1; t += 0.1) plot(r.points[i] + (r.points[i + 2] - r.points[i]) * t, r.points[i + 1] + (r.points[i + 3] - r.points[i + 1]) * t, [0, 60, 255]);
    }
  }
  fs.writeFileSync(path.join(CACHE, 'preview.png'), PNG.sync.write(png));
  console.log('preview → .cache/preview.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
