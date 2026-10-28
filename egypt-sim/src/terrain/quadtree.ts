/**
 * Chunked quadtree LOD selection (pure; no Three.js).
 *
 * A node splits while the camera is closer than `size × splitFactor` to its 3D
 * bounds — i.e. roughly constant screen-space geometric error. A node only descends
 * once all of its *visible* children have meshes, so the view never shows holes:
 * until the finer data streams in, the coarser parent keeps rendering.
 */
export interface QuadNode {
  key: number;
  level: number;
  ix: number;
  iz: number;
  /** Centre (world x, z) and edge length (m). */
  x: number;
  z: number;
  size: number;
}

export const nodeKey = (level: number, ix: number, iz: number): number => level * 4294967296 + ix * 65536 + iz;

export function makeNode(level: number, ix: number, iz: number, rootSize: number): QuadNode {
  const size = rootSize / 2 ** level;
  return { key: nodeKey(level, ix, iz), level, ix, iz, size, x: -rootSize / 2 + (ix + 0.5) * size, z: -rootSize / 2 + (iz + 0.5) * size };
}

export function children(n: QuadNode, rootSize: number): QuadNode[] {
  const l = n.level + 1;
  return [
    makeNode(l, n.ix * 2, n.iz * 2, rootSize),
    makeNode(l, n.ix * 2 + 1, n.iz * 2, rootSize),
    makeNode(l, n.ix * 2, n.iz * 2 + 1, rootSize),
    makeNode(l, n.ix * 2 + 1, n.iz * 2 + 1, rootSize),
  ];
}

export interface SelectionContext {
  camX: number;
  camY: number;
  camZ: number;
  rootSize: number;
  maxDepth: number;
  splitFactor: number;
  /** Vertical bounds of a node (measured once built, else inherited/estimated). */
  heightRange(node: QuadNode): [number, number];
  isReady(node: QuadNode): boolean;
  isVisible(node: QuadNode, minY: number, maxY: number): boolean;
}

export interface Selection {
  /** Nodes to draw this frame. */
  render: QuadNode[];
  /** Nodes to build, with priority (lower = sooner). */
  wanted: { node: QuadNode; priority: number }[];
}

export function distanceToNode(ctx: SelectionContext, n: QuadNode, minY: number, maxY: number): number {
  const half = n.size / 2;
  const dx = Math.max(0, Math.abs(ctx.camX - n.x) - half);
  const dz = Math.max(0, Math.abs(ctx.camZ - n.z) - half);
  const dy = ctx.camY < minY ? minY - ctx.camY : ctx.camY > maxY ? ctx.camY - maxY : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function selectNodes(ctx: SelectionContext): Selection {
  const out: Selection = { render: [], wanted: [] };
  const root = makeNode(0, 0, 0, ctx.rootSize);
  if (!ctx.isReady(root)) {
    out.wanted.push({ node: root, priority: -1 });
    return out;
  }
  visit(ctx, root, out);
  return out;
}

function visit(ctx: SelectionContext, n: QuadNode, out: Selection): void {
  const [minY, maxY] = ctx.heightRange(n);
  if (!ctx.isVisible(n, minY, maxY)) return;
  const d = distanceToNode(ctx, n, minY, maxY);
  const wantSplit = n.level < ctx.maxDepth && d < n.size * ctx.splitFactor;
  if (wantSplit) {
    const kids = children(n, ctx.rootSize);
    let allReady = true;
    for (const k of kids) {
      const [kMin, kMax] = ctx.heightRange(k);
      if (!ctx.isVisible(k, kMin, kMax) || ctx.isReady(k)) continue;
      allReady = false;
      out.wanted.push({ node: k, priority: k.level * 0.25 + distanceToNode(ctx, k, kMin, kMax) / k.size });
    }
    if (allReady) {
      for (const k of kids) visit(ctx, k, out);
      return;
    }
  }
  out.render.push(n);
}
