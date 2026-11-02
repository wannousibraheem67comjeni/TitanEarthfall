#!/usr/bin/env node
/**
 * Bakes OpenStreetMap building/road/water extracts for one or more cities, so the
 * simulation can show surveyed footprints without hitting Overpass at runtime.
 *
 *   node tools/fetch-osm.mjs alexandria luxor            # districts from src/data/cities.json
 *   node tools/fetch-osm.mjs --bbox 31.23,30.03,31.27,30.06 --id downtown
 *
 * Writes public/data/osm/<id>.json plus an index.json the runtime consults before
 * falling back to live Overpass queries. Large cities are fetched in ≤ 0.04° chunks,
 * one request at a time (Overpass fair-use policy). Requires Node ≥ 22.18 (it
 * imports the TypeScript client in src/gis/osm.ts directly). Data © OpenStreetMap
 * contributors, ODbL — keep the attribution visible when shipping extracts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OverpassClient } from '../src/gis/osm.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'osm');
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const CHUNK = 0.04;

const args = process.argv.slice(2);
const jobs = [];
const bboxArg = args.indexOf('--bbox');
if (bboxArg >= 0) {
  const bbox = args[bboxArg + 1].split(',').map(Number);
  const idArg = args.indexOf('--id');
  jobs.push({ id: idArg >= 0 ? args[idArg + 1] : 'custom', bbox });
} else {
  const cities = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cities.json'), 'utf8'));
  for (const id of args) {
    const c = cities.find((x) => x.id === id);
    if (!c) throw new Error(`unknown city ${id}; see src/data/cities.json`);
    const dLat = c.radius / 111_195;
    const dLon = c.radius / (111_195 * Math.cos((c.lat * Math.PI) / 180));
    jobs.push({ id, bbox: [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat] });
  }
}
if (!jobs.length) {
  console.error('usage: node tools/fetch-osm.mjs <city-id…> | --bbox w,s,e,n --id name');
  process.exit(1);
}

const client = new OverpassClient(ENDPOINTS, 1500);
fs.mkdirSync(OUT, { recursive: true });
const indexPath = path.join(OUT, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { extracts: [] };
const r6 = (v) => Math.round(v * 1e6) / 1e6;

for (const job of jobs) {
  const [w, s, e, n] = job.bbox;
  const merged = { bbox: job.bbox, buildings: [], roads: [], water: [] };
  const seen = new Set();
  for (let lat = s; lat < n; lat += CHUNK) {
    for (let lon = w; lon < e; lon += CHUNK) {
      const chunk = [lon, lat, Math.min(e, lon + CHUNK), Math.min(n, lat + CHUNK)];
      process.stdout.write(`${job.id}: ${chunk.map((v) => v.toFixed(3)).join(',')} … `);
      const ex = await client.fetchExtract(chunk);
      for (const b of ex.buildings) if (!seen.has('b' + b.id)) { seen.add('b' + b.id); merged.buildings.push({ ...b, ring: b.ring.map(r6), holes: b.holes.map((h) => h.map(r6)) }); }
      for (const r of ex.roads) if (!seen.has('r' + r.id)) { seen.add('r' + r.id); merged.roads.push({ ...r, points: r.points.map(r6) }); }
      merged.water.push(...ex.water.map((ring) => ring.map(r6)));
      console.log(`${ex.buildings.length} buildings, ${ex.roads.length} roads`);
    }
  }
  const file = `${job.id}.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(merged));
  index.extracts = index.extracts.filter((x) => x.id !== job.id).concat({ id: job.id, file, bbox: job.bbox, buildings: merged.buildings.length });
  console.log(`→ public/data/osm/${file}: ${merged.buildings.length} buildings, ${merged.roads.length} roads`);
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
