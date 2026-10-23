import { describe, expect, it } from 'vitest';
import { makeNode, nodeKey, selectNodes, type SelectionContext } from '../src/terrain/quadtree';
import { buildTerrainIndices, buildTerrainNode, vertexCount } from '../src/terrain/buildNode';
import { TERRAIN } from '../src/config';
import { loadWorld } from './helpers';

const ROOT = TERRAIN.rootSize;

function ctx(cam: [number, number, number], ready: (key: number) => boolean): SelectionContext {
  return {
    camX: cam[0], camY: cam[1], camZ: cam[2], rootSize: ROOT, maxDepth: TERRAIN.maxDepth, splitFactor: TERRAIN.splitFactor,
    heightRange: () => [0, 100],
    isReady: (n) => ready(n.key),
    isVisible: () => true,
  };
}

describe('quadtree LOD selection', () => {
  it('tiles the root exactly once, finest near the camera', () => {
    const sel = selectNodes(ctx([12_000, 300, -340_000], () => true));
    const area = sel.render.reduce((a, n) => a + n.size * n.size, 0);
    expect(area).toBeCloseTo(ROOT * ROOT, -3);
    const under = sel.render.find((n) => Math.abs(n.x - 12_000) <= n.size / 2 && Math.abs(n.z + 340_000) <= n.size / 2)!;
    expect(under.level).toBe(TERRAIN.maxDepth);
    // Far nodes stay coarse.
    expect(Math.min(...sel.render.map((n) => n.level))).toBeLessThan(4);
    // ~1k nodes for a full 360° view (no frustum here; the app culls ~70 %), not tens of thousands.
    expect(sel.render.length).toBeLessThan(1500);
  });

  it('keeps the parent visible until all visible children are built', () => {
    const root = makeNode(0, 0, 0, ROOT);
    const sel = selectNodes(ctx([0, 1000, 0], (k) => k === root.key));
    expect(sel.render.map((n) => n.key)).toEqual([root.key]);
    expect(sel.wanted.map((w) => w.node.level)).toEqual([1, 1, 1, 1]);
    expect(nodeKey(1, 1, 1)).not.toBe(nodeKey(1, 1, 0));
  });
});

describe('terrain node meshes', () => {
  it('builds a consistent grid + skirt over real terrain', () => {
    const world = loadWorld();
    const [cx, cz] = world.proj.forward(31.13, 29.97); // Giza plateau
    const s = TERRAIN.segments;
    const node = buildTerrainNode(world.terrain, cx, cz, 3200, s, 64);
    const n = vertexCount(s);
    expect(node.positions.length).toBe(n * 3);
    expect(node.geo.length).toBe(n * 4);
    expect(node.maxY).toBeGreaterThan(node.minY);
    const idx = buildTerrainIndices(s);
    expect(Math.max(...idx)).toBe(n - 1);
    // Skirt vertices hang below their edge vertex.
    expect(node.positions[(s + 1) * (s + 1) * 3 + 1]).toBeCloseTo(node.positions[1] - 64, 3);
    for (let v = 0; v < (s + 1) * (s + 1); v++) {
      const len = Math.hypot(node.normals[v * 3], node.normals[v * 3 + 1], node.normals[v * 3 + 2]);
      expect(len).toBeGreaterThan(120);
      expect(node.normals[v * 3 + 1]).toBeGreaterThan(0);
    }
  });
});
