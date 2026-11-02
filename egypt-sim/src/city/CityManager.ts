/**
 * Streams city tiles around the camera:
 *   distance < detailRange   → LOD 0 (lots, roofs, minarets, streets, palms, lamps)
 *   distance < massingRange  → LOD 1 (one extrusion per block)
 *   beyond                   → nothing (terrain urban tint + night glow represent the city)
 * Tiles swap LOD only once the replacement is built (no holes), with hysteresis to
 * avoid thrashing at range boundaries. Optional live OpenStreetMap footprints replace
 * the procedural buildings of detail tiles.
 */
import {
  BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, Points, Quaternion, Vector3,
  type Camera,
} from 'three';
import { CITY, LIVE_SOURCES } from '../config';
import type { World } from '../gis/world';
import type { WorkerPool } from '../workers/WorkerPool';
import { OverpassClient, buildingHeight, type BBox, type OsmExtract } from '../gis/osm';
import type { MeshArrays } from './meshBuilder';
import type { CityTileData, OsmTileInput } from './cityGenerator';
import {
  createBuildingMaterial, createGroundMaterial, createLampMaterial, createPalmGeometry, createPalmMaterial,
} from './cityMaterials';

interface TileEntry {
  tx: number;
  tz: number;
  lod: 0 | 1 | -1;
  group: Group | null;
  pending: 0 | 1 | -1;
  lastUsed: number;
  buildings: number;
  triangles: number;
}

export type OsmMode = 'off' | 'live';

export class CityManager {
  readonly group = new Group();
  private readonly tiles = new Map<string, TileEntry>();
  private readonly urbanTiles = new Set<string>();
  private readonly buildingMat = createBuildingMaterial();
  private readonly groundMat = createGroundMaterial();
  private readonly palmGeo = createPalmGeometry();
  private readonly palmMat = createPalmMaterial();
  readonly lampMat = createLampMaterial();
  private frame = 0;
  private osmMode: OsmMode = 'off';
  private readonly overpass = new OverpassClient(LIVE_SOURCES.overpass);
  private osmFailures = 0;
  private generation = 0;
  stats = { detail: 0, massing: 0, pending: 0, buildings: 0, triangles: 0, osm: 'off' as string };

  constructor(
    private readonly world: World,
    private readonly pool: WorkerPool,
  ) {
    this.group.name = 'cities';
    // Pre-compute which tiles can contain buildings at all.
    const s = CITY.tileSize;
    for (const d of world.districts.list) {
      const [x0, z0, x1, z1] = d.bbox;
      for (let tz = Math.floor(z0 / s); tz <= Math.floor(z1 / s); tz++) {
        for (let tx = Math.floor(x0 / s); tx <= Math.floor(x1 / s); tx++) {
          const cx = (tx + 0.5) * s;
          const cz = (tz + 0.5) * s;
          if (world.districts.ellipse(d, cx, cz) < 1 + (s * 0.8) / d.b) this.urbanTiles.add(`${tx},${tz}`);
        }
      }
    }
  }

  setOsmMode(mode: OsmMode): void {
    if (mode === this.osmMode) return;
    this.osmMode = mode;
    this.osmFailures = 0;
    this.generation++;
    // Rebuild detail tiles with the new source.
    for (const [key, t] of this.tiles) if (t.lod === 0) this.unload(key, t);
  }

  update(camera: Camera, groundHeight: number): void {
    this.frame++;
    const cam = camera.position;
    const s = CITY.tileSize;
    const alt = Math.max(0, cam.y - groundHeight);
    if (alt > CITY.massingRange) {
      this.unloadBeyond(-1);
      this.updateStats();
      return;
    }
    const reach = Math.sqrt(Math.max(0, CITY.massingRange ** 2 - alt * alt));
    const want: { key: string; tx: number; tz: number; lod: 0 | 1; d: number }[] = [];
    for (let tz = Math.floor((cam.z - reach) / s); tz <= Math.floor((cam.z + reach) / s); tz++) {
      for (let tx = Math.floor((cam.x - reach) / s); tx <= Math.floor((cam.x + reach) / s); tx++) {
        const key = `${tx},${tz}`;
        if (!this.urbanTiles.has(key)) continue;
        const dx = Math.max(0, Math.abs(cam.x - (tx + 0.5) * s) - s / 2);
        const dz = Math.max(0, Math.abs(cam.z - (tz + 0.5) * s) - s / 2);
        const d = Math.sqrt(dx * dx + dz * dz + alt * alt);
        const cur = this.tiles.get(key);
        const hyst = cur?.lod === 0 ? 1.15 : 1;
        const lod: 0 | 1 | -1 = d < CITY.detailRange * hyst ? 0 : d < CITY.massingRange * (cur ? 1.1 : 1) ? 1 : -1;
        if (lod >= 0) want.push({ key, tx, tz, lod: lod as 0 | 1, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    let detail = 0;
    let massing = 0;
    const keep = new Set<string>();
    for (const w of want) {
      let lod = w.lod;
      if (lod === 0 && ++detail > CITY.maxDetailTiles) lod = 1;
      if (lod === 1 && ++massing > CITY.maxMassingTiles) continue;
      keep.add(w.key);
      let t = this.tiles.get(w.key);
      if (!t) {
        t = { tx: w.tx, tz: w.tz, lod: -1, group: null, pending: -1, lastUsed: this.frame, buildings: 0, triangles: 0 };
        this.tiles.set(w.key, t);
      }
      t.lastUsed = this.frame;
      if (t.lod !== lod && t.pending !== lod) this.queue.push({ key: w.key, t, lod, d: w.d });
    }
    this.dispatch();
    for (const [key, t] of this.tiles) if (!keep.has(key) && t.pending < 0) this.unload(key, t);
    this.updateStats();
  }

  private queue: { key: string; t: TileEntry; lod: 0 | 1; d: number }[] = [];

  private dispatch(): void {
    // Cities use whatever capacity the terrain left this frame, but always progress a little.
    let budget = Math.max(2, this.pool.capacity);
    const q = this.queue;
    this.queue = [];
    for (const job of q) {
      if (budget <= 0) break;
      if (job.t.pending >= 0) continue;
      budget--;
      this.request(job.key, job.t, job.lod);
    }
  }

  private async request(key: string, t: TileEntry, lod: 0 | 1): Promise<void> {
    t.pending = lod;
    const gen = this.generation;
    try {
      const osm = lod === 0 && this.osmMode === 'live' ? await this.osmFor(t.tx, t.tz) : null;
      const res = await this.pool.run({ type: 'city', tx: t.tx, tz: t.tz, size: CITY.tileSize, lod, osm });
      if (res.type !== 'city' || this.tiles.get(key) !== t || gen !== this.generation) return;
      const group = this.buildGroup(res);
      if (t.group) this.disposeGroup(t.group);
      t.group = group;
      t.lod = lod;
      t.buildings = res.buildingCount;
      t.triangles = ((res.buildings?.indices.length ?? 0) + (res.ground?.indices.length ?? 0)) / 3;
      this.group.add(group);
    } catch (err) {
      console.warn('city tile failed', key, err);
    } finally {
      if (this.tiles.get(key) === t) t.pending = -1;
    }
  }

  /** Live OSM footprints for a tile (null → fall back to procedural). */
  private async osmFor(tx: number, tz: number): Promise<OsmTileInput | null> {
    if (this.osmFailures >= 3) return null;
    const s = CITY.tileSize;
    const proj = this.world.proj;
    const corners = [proj.inverse(tx * s, tz * s), proj.inverse((tx + 1) * s, (tz + 1) * s), proj.inverse(tx * s, (tz + 1) * s), proj.inverse((tx + 1) * s, tz * s)];
    const bbox: BBox = [
      Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])),
      Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1])),
    ];
    let ex: OsmExtract;
    try {
      ex = await this.overpass.fetchExtract(bbox, { water: false });
      this.osmFailures = 0;
    } catch {
      this.osmFailures++;
      return null;
    }
    if (!ex.buildings.length) return null;
    const [cx, cz] = [(tx + 0.5) * s, (tz + 0.5) * s];
    const d = this.world.districts.owner(cx, cz);
    const floorH = d?.profile.floorHeight ?? 3.1;
    const fallback = d ? ((d.profile.floors[0] + d.profile.floors[1]) / 2) * floorH : 9;
    return {
      buildings: ex.buildings.map((b) => ({ ring: b.ring, height: buildingHeight(b, floorH, fallback) })),
      roads: ex.roads.map((r) => ({ points: r.points, width: r.width })),
    };
  }

  private buildGroup(res: CityTileData): Group {
    const g = new Group();
    g.position.set(res.cx, 0, res.cz);
    if (res.buildings) {
      const m = new Mesh(this.geometry(res.buildings), this.buildingMat);
      m.castShadow = res.lod === 0;
      m.receiveShadow = true;
      g.add(m);
    }
    if (res.ground) {
      const m = new Mesh(this.geometry(res.ground), this.groundMat);
      m.receiveShadow = true;
      m.renderOrder = 1;
      g.add(m);
    }
    if (res.palms) {
      const n = res.palms.length / 5;
      const inst = new InstancedMesh(this.palmGeo, this.palmMat, n);
      const mat = new Matrix4();
      const q = new Quaternion();
      const up = new Vector3(0, 1, 0);
      const pos = new Vector3();
      const scl = new Vector3();
      for (let i = 0; i < n; i++) {
        const p = res.palms.subarray(i * 5, i * 5 + 5);
        q.setFromAxisAngle(up, p[4]);
        mat.compose(pos.set(p[0], p[1], p[2]), q, scl.setScalar(p[3]));
        inst.setMatrixAt(i, mat);
      }
      inst.castShadow = true;
      inst.computeBoundingSphere();
      g.add(inst);
    }
    if (res.lamps) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(res.lamps, 3));
      const pts = new Points(geo, this.lampMat);
      pts.renderOrder = 5;
      g.add(pts);
    }
    g.updateMatrixWorld(true);
    return g;
  }

  private geometry(a: MeshArrays): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(a.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(a.normals, 3, true));
    geo.setAttribute('aColor', new BufferAttribute(a.colors, 4, true));
    geo.setAttribute('aFacade', new BufferAttribute(a.facade, 3));
    geo.setIndex(new BufferAttribute(a.indices, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  private unload(key: string, t: TileEntry): void {
    if (t.group) this.disposeGroup(t.group);
    this.tiles.delete(key);
  }

  private unloadBeyond(lod: number): void {
    for (const [key, t] of this.tiles) if (t.lod > lod && t.pending < 0) this.unload(key, t);
  }

  private disposeGroup(g: Group): void {
    this.group.remove(g);
    g.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry && m.geometry !== this.palmGeo) m.geometry.dispose();
      if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
    });
  }

  private updateStats(): void {
    let detail = 0, massing = 0, pending = 0, buildings = 0, triangles = 0;
    for (const t of this.tiles.values()) {
      if (t.lod === 0) detail++;
      if (t.lod === 1) massing++;
      if (t.pending >= 0) pending++;
      buildings += t.buildings;
      triangles += t.triangles;
    }
    this.stats = { detail, massing, pending, buildings, triangles, osm: this.osmMode === 'live' ? (this.osmFailures >= 3 ? 'unavailable' : 'live') : 'off' };
  }
}
