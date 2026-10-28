/**
 * Automatic walking: a waypoint graph over the walkable street (sidewalks, road
 * crossings, the home courtyard, the alley, the park, the car-wash lot) and A* over
 * it. Edges are kept only where a straight walk is clear of walls.
 */
import type { Colliders } from '../world/collision';

export interface Pt {
  x: number;
  z: number;
}

/** Hand-placed anchors in the open areas off the main sidewalks. */
const EXTRA: Pt[] = [
  // Home courtyard, through the gate.
  { x: -70, z: 12.4 },
  { x: -70, z: 15.5 },
  { x: -70, z: 19.5 },
  { x: -75, z: 19.5 },
  { x: -65, z: 19.5 },
  { x: -62.5, z: 22.6 },
  { x: -73, z: 24 },
  { x: -70, z: 26.2 },
  { x: -79, z: 22 },
  { x: -60, z: 17 },
  // Grandpa's majlis.
  { x: -104, z: 10.5 },
  // Mosque plaza.
  { x: -109, z: -12.5 },
  { x: -100, z: -12.5 },
  // Car-wash lot.
  { x: 60, z: -12 },
  { x: 66, z: -15 },
  { x: 70, z: -18 },
  { x: 72, z: -25 },
  { x: 84, z: -12 },
  // Park.
  { x: 80, z: 12.4 },
  { x: 80, z: 18 },
  { x: 80, z: 26 },
  { x: 86, z: 33 },
  { x: 96, z: 30 },
  { x: 102, z: 42 },
  { x: 74, z: 36 },
  { x: 92, z: 46 },
];

export class NavGraph {
  readonly nodes: Pt[] = [];
  readonly edges: number[][] = [];

  constructor(private readonly colliders: Colliders) {
    // Both sidewalks, the strip in front of the villas, and points across the road.
    for (let x = -120; x <= 110; x += 6) {
      this.nodes.push({ x, z: -8.2 }, { x, z: 8.2 });
      if (x % 12 === 0) this.nodes.push({ x, z: 0 });
      this.nodes.push({ x: x + 3, z: 11.6 });
    }
    for (let z = 12; z <= 78; z += 6) this.nodes.push({ x: -17, z });
    this.nodes.push(...EXTRA);
    // Drop anchors that ended up inside something.
    for (let i = this.nodes.length - 1; i >= 0; i--) if (colliders.blocked(this.nodes[i].x, this.nodes[i].z, 0.3)) this.nodes.splice(i, 1);
    for (let i = 0; i < this.nodes.length; i++) this.edges.push([]);
    for (let i = 0; i < this.nodes.length; i++)
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) <= 13 && this.clear(a, b)) {
          this.edges[i].push(j);
          this.edges[j].push(i);
        }
      }
  }

  /** A straight walk from a to b stays out of every wall (with body width to spare). */
  clear(a: Pt, b: Pt, r = 0.38): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / 0.4));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (this.colliders.blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false;
    }
    return true;
  }

  /** Nodes a point can walk to directly, nearest first. */
  private reachable(p: Pt, max = 4): number[] {
    return this.nodes
      .map((n, i) => ({ i, d: Math.hypot(n.x - p.x, n.z - p.z) }))
      .filter((o) => o.d < 30)
      .sort((a, b) => a.d - b.d)
      .filter((o) => this.clear(p, this.nodes[o.i], 0.3))
      .slice(0, max)
      .map((o) => o.i);
  }

  /** Waypoints from `from` to `to` (ending exactly at `to`), or null when unreachable. */
  route(from: Pt, to: Pt): Pt[] | null {
    if (this.clear(from, to, 0.3) && Math.hypot(to.x - from.x, to.z - from.z) < 20) return [to];
    const starts = this.reachable(from);
    const goals = new Set(this.reachable(to));
    if (!starts.length || !goals.size) return null;
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const open = new Set<number>();
    const h = (i: number) => Math.hypot(this.nodes[i].x - to.x, this.nodes[i].z - to.z);
    for (const s of starts) {
      g[s] = Math.hypot(this.nodes[s].x - from.x, this.nodes[s].z - from.z);
      open.add(s);
    }
    while (open.size) {
      let cur = -1;
      let best = Infinity;
      for (const i of open) {
        const f = g[i] + h(i);
        if (f < best) {
          best = f;
          cur = i;
        }
      }
      open.delete(cur);
      if (goals.has(cur)) {
        const path: Pt[] = [to];
        for (let i = cur; i !== -1; i = prev[i]) path.unshift(this.nodes[i]);
        return this.smooth(from, path);
      }
      for (const nb of this.edges[cur]) {
        const cost = g[cur] + Math.hypot(this.nodes[nb].x - this.nodes[cur].x, this.nodes[nb].z - this.nodes[cur].z);
        if (cost < g[nb]) {
          g[nb] = cost;
          prev[nb] = cur;
          open.add(nb);
        }
      }
    }
    return null;
  }

  /** Skip waypoints that can be cut straight past, so the walk looks natural. */
  private smooth(from: Pt, path: Pt[]): Pt[] {
    const out: Pt[] = [];
    let at = from;
    let i = 0;
    while (i < path.length) {
      let j = path.length - 1;
      while (j > i && !this.clear(at, path[j], 0.36)) j--;
      out.push(path[j]);
      at = path[j];
      i = j + 1;
    }
    return out;
  }
}
