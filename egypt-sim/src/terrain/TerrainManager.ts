/**
 * Owns the terrain quadtree on the main thread: runs LOD selection each frame,
 * streams node meshes from the worker pool (most urgent first, bounded in flight),
 * keeps an LRU cache of GPU meshes, and answers height/ray queries.
 */
import {
  Box3, BufferAttribute, BufferGeometry, Frustum, Group, Matrix4, Mesh, Sphere, Vector3, type Camera,
} from 'three';
import { TERRAIN } from '../config';
import type { World } from '../gis/world';
import type { WorkerPool } from '../workers/WorkerPool';
import { buildTerrainIndices, type TerrainNodeData } from './buildNode';
import { createTerrainMaterial, type TerrainUniforms } from './terrainMaterial';
import { makeNode, nodeKey, selectNodes, type QuadNode, type SelectionContext } from './quadtree';

interface NodeEntry {
  node: QuadNode;
  mesh: Mesh | null;
  pending: boolean;
  minY: number;
  maxY: number;
  lastUsed: number;
  live: boolean;
}

/**
 * Nodes at or below this vertex spacing (m) use the live high-resolution DEM when
 * enabled — anything finer than the ≈1.1 km baked grid benefits from real data.
 */
const LIVE_DEM_SPACING = 700;

export class TerrainManager {
  readonly group = new Group();
  readonly uniforms: TerrainUniforms;
  private readonly material;
  private readonly index: BufferAttribute;
  private readonly entries = new Map<number, NodeEntry>();
  private visible: NodeEntry[] = [];
  private frame = 0;
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly box = new Box3();
  private liveDem = false;
  private generation = 0;
  stats = { rendered: 0, cached: 0, pending: 0, triangles: 0 };

  constructor(
    private readonly world: World,
    private readonly pool: WorkerPool,
  ) {
    const { material, uniforms } = createTerrainMaterial();
    this.material = material;
    this.uniforms = uniforms;
    this.index = new BufferAttribute(buildTerrainIndices(TERRAIN.segments), 1);
    this.group.name = 'terrain';
  }

  /** Toggle streaming of live ~30 m DEM tiles for close-range nodes (rebuilds them). */
  setLiveDem(on: boolean): void {
    if (on === this.liveDem) return;
    this.liveDem = on;
    this.generation++;
    for (const [key, e] of this.entries) {
      if (e.node.size / TERRAIN.segments <= LIVE_DEM_SPACING) this.evict(key, e);
    }
  }

  get liveDemEnabled(): boolean {
    return this.liveDem;
  }

  /** @param maxJobs cap on new node builds this frame (the rest of the pool serves cities). */
  update(camera: Camera, maxJobs = Infinity): void {
    this.frame++;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const cam = camera.position;

    const ctx: SelectionContext = {
      camX: cam.x,
      camY: cam.y,
      camZ: cam.z,
      rootSize: TERRAIN.rootSize,
      maxDepth: TERRAIN.maxDepth,
      splitFactor: TERRAIN.splitFactor,
      heightRange: (n) => this.heightRange(n),
      isReady: (n) => !!this.entries.get(n.key)?.mesh,
      isVisible: (n, minY, maxY) => {
        const h = n.size / 2;
        this.box.min.set(n.x - h, minY - n.size * TERRAIN.skirtFactor, n.z - h);
        this.box.max.set(n.x + h, maxY, n.z + h);
        return this.frustum.intersectsBox(this.box);
      },
    };
    const sel = selectNodes(ctx);

    for (const e of this.visible) if (e.mesh) e.mesh.visible = false;
    this.visible = [];
    let tris = 0;
    const perNode = this.index.count / 3;
    for (const n of sel.render) {
      const e = this.entries.get(n.key);
      if (!e?.mesh) continue;
      e.mesh.visible = true;
      e.lastUsed = this.frame;
      this.visible.push(e);
      tris += perNode;
      // Keep ancestors warm so zooming out is instant.
      for (let l = n.level - 1, ix = n.ix >> 1, iz = n.iz >> 1; l >= 0; l--, ix >>= 1, iz >>= 1) {
        const a = this.entries.get(nodeKey(l, ix, iz));
        if (a) a.lastUsed = this.frame;
      }
    }

    sel.wanted.sort((a, b) => a.priority - b.priority);
    let budget = Math.min(this.pool.capacity, maxJobs, TERRAIN.maxInFlight - this.pendingCount());
    for (const w of sel.wanted) {
      if (budget <= 0) break;
      const e = this.entries.get(w.node.key);
      if (e?.pending || e?.mesh) continue;
      this.request(w.node);
      budget--;
    }

    this.evictLru();
    this.stats = { rendered: this.visible.length, cached: this.entries.size, pending: this.pendingCount(), triangles: tris };
  }

  private pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.pending) n++;
    return n;
  }

  private heightRange(n: QuadNode): [number, number] {
    const e = this.entries.get(n.key);
    if (e && Number.isFinite(e.minY)) return [e.minY, e.maxY];
    // Inherit from the nearest built ancestor (conservative), else a national range.
    for (let l = n.level - 1, ix = n.ix >> 1, iz = n.iz >> 1; l >= 0; l--, ix >>= 1, iz >>= 1) {
      const a = this.entries.get(nodeKey(l, ix, iz));
      if (a && Number.isFinite(a.minY)) return [a.minY - 50, a.maxY + 50];
    }
    return [-450, 3000];
  }

  private request(node: QuadNode): void {
    const live = this.liveDem && node.size / TERRAIN.segments <= LIVE_DEM_SPACING;
    const entry: NodeEntry = { node, mesh: null, pending: true, minY: Infinity, maxY: -Infinity, lastUsed: this.frame, live };
    this.entries.set(node.key, entry);
    const gen = this.generation;
    this.pool
      .run({ type: 'terrain', cx: node.x, cz: node.z, size: node.size, segments: TERRAIN.segments, skirt: node.size * TERRAIN.skirtFactor, live })
      .then((res) => {
        if (res.type !== 'terrain' || this.entries.get(node.key) !== entry || gen !== this.generation) return;
        entry.pending = false;
        entry.minY = res.minY;
        entry.maxY = res.maxY;
        entry.mesh = this.createMesh(node, res);
        this.group.add(entry.mesh);
      })
      .catch((err) => {
        console.warn('terrain node failed', node.key, err);
        if (this.entries.get(node.key) === entry) this.entries.delete(node.key);
      });
  }

  private createMesh(node: QuadNode, d: TerrainNodeData): Mesh {
    const g = new BufferGeometry();
    g.setIndex(this.index);
    g.setAttribute('position', new BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new BufferAttribute(d.normals, 3, true));
    g.setAttribute('aSurfA', new BufferAttribute(d.surfA, 4, true));
    g.setAttribute('aSurfB', new BufferAttribute(d.surfB, 4, true));
    g.setAttribute('aGeo', new BufferAttribute(d.geo, 4));
    const h = node.size / 2;
    g.boundingBox = new Box3(new Vector3(-h, d.minY - node.size * TERRAIN.skirtFactor, -h), new Vector3(h, d.maxY, h));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
    const mesh = new Mesh(g, this.material);
    mesh.position.set(node.x, 0, node.z);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.name = `terrain-${node.level}-${node.ix}-${node.iz}`;
    return mesh;
  }

  private evictLru(): void {
    const excess = this.entries.size - TERRAIN.maxCachedNodes;
    if (excess <= 0) return;
    const candidates = [...this.entries.entries()]
      .filter(([, e]) => !e.pending && e.lastUsed < this.frame && e.node.level > 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (let i = 0; i < Math.min(excess, candidates.length); i++) this.evict(candidates[i][0], candidates[i][1]);
  }

  private evict(key: number, e: NodeEntry): void {
    if (e.mesh) {
      this.group.remove(e.mesh);
      // The index buffer is shared by every node: detach it so dispose() leaves it alone.
      e.mesh.geometry.setIndex(null);
      e.mesh.geometry.dispose();
    }
    this.entries.delete(key);
    const vi = this.visible.indexOf(e);
    if (vi >= 0) this.visible.splice(vi, 1);
  }

  /** Full-resolution rendered height (water surface over water). */
  heightAt(x: number, z: number): number {
    return this.world.terrain.height(x, z);
  }

  /** Ray–terrain intersection by marching the height function, refined by bisection. */
  raycast(origin: Vector3, dir: Vector3, maxDist = 4_000_000): Vector3 | null {
    let t = 0;
    let prevT = 0;
    let prevAbove = origin.y - this.heightAt(origin.x, origin.z);
    if (prevAbove < 0) return null;
    while (t < maxDist) {
      const step = Math.max(2, prevAbove * 0.6, t * 0.004);
      t += step;
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const above = y - this.heightAt(x, z);
      if (above <= 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + dir.y * mid;
          if (my - this.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid) > 0) lo = mid;
          else hi = mid;
        }
        return new Vector3(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
      }
      if (dir.y >= 0 && y > 60000) return null;
      prevT = t;
      prevAbove = above;
    }
    return null;
  }

  /** Root node, built synchronously-on-demand so the first frame isn't empty. */
  get rootReady(): boolean {
    return !!this.entries.get(makeNode(0, 0, 0, TERRAIN.rootSize).key)?.mesh;
  }
}
