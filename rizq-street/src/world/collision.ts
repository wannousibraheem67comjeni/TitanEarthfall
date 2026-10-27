/**
 * Ground-plane collisions: walls, buildings and parked cars are axis-aligned boxes,
 * trees, lamps and people are circles. The player is a circle pushed out of both.
 * Boxes also carry a height so the camera can avoid clipping into buildings.
 */

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

const CELL = 16;

export class Colliders {
  readonly boxes: BoxCollider[] = [];
  readonly circles: CircleCollider[] = [];
  private readonly grid = new Map<number, number[]>();

  constructor(public readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {}

  addBox(minX: number, minZ: number, maxX: number, maxZ: number, height = 3): void {
    if (minX > maxX) [minX, maxX] = [maxX, minX];
    if (minZ > maxZ) [minZ, maxZ] = [maxZ, minZ];
    const i = this.boxes.push({ minX, maxX, minZ, maxZ, height }) - 1;
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = cx * 4096 + cz;
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, (list = []));
        list.push(i);
      }
  }

  addCircle(x: number, z: number, r: number): void {
    this.circles.push({ x, z, r });
  }

  private nearbyBoxes(x: number, z: number, out: Set<number>): void {
    out.clear();
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.grid.get((cx + dx) * 4096 + (cz + dz));
        if (list) for (const i of list) out.add(i);
      }
  }

  private readonly near = new Set<number>();

  /**
   * Push a circle of radius r at (x, z) out of every obstacle. Returns the corrected
   * position; `extra` adds moving obstacles for this query (cars, people).
   */
  resolve(x: number, z: number, r: number, extra: CircleCollider[] = []): { x: number; z: number } {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.nearbyBoxes(x, z, this.near);
      for (const i of this.near) {
        const b = this.boxes[i];
        const px = Math.max(b.minX, Math.min(x, b.maxX));
        const pz = Math.max(b.minZ, Math.min(z, b.maxZ));
        const dx = x - px;
        const dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = px + (dx / d) * r;
          z = pz + (dz / d) * r;
        } else {
          // Centre inside the box: leave by the nearest side.
          const left = x - b.minX;
          const right = b.maxX - x;
          const top = z - b.minZ;
          const bottom = b.maxZ - z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = b.minX - r;
          else if (m === right) x = b.maxX + r;
          else if (m === top) z = b.minZ - r;
          else z = b.maxZ + r;
        }
        moved = true;
      }
      for (const list of [this.circles, extra]) {
        for (const c of list) {
          const dx = x - c.x;
          const dz = z - c.z;
          const min = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min || d2 < 1e-8) continue;
          const d = Math.sqrt(d2);
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
          moved = true;
        }
      }
      x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, x));
      z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, z));
      if (!moved) break;
    }
    return { x, z };
  }

  /** True when the point sits inside a box (with margin r). */
  blocked(x: number, z: number, r = 0): boolean {
    this.nearbyBoxes(x, z, this.near);
    for (const i of this.near) {
      const b = this.boxes[i];
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    return false;
  }

  /**
   * Fraction (0–1) along the 3D segment from a to b where it first enters a box
   * volume; 1 when the path is clear. Used to pull the camera in front of walls.
   */
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    let best = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const minX = Math.min(ax, bx) - 1;
    const maxX = Math.max(ax, bx) + 1;
    const minZ = Math.min(az, bz) - 1;
    const maxZ = Math.max(az, bz) + 1;
    for (const b of this.boxes) {
      if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
      let t0 = 0;
      let t1 = best;
      const slabs: [number, number, number, number][] = [
        [ax, dx, b.minX, b.maxX],
        [ay, dy, 0, b.height],
        [az, dz, b.minZ, b.maxZ],
      ];
      let hit = true;
      for (const [o, d, lo, hi] of slabs) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) {
            hit = false;
            break;
          }
          continue;
        }
        let ta = (lo - o) / d;
        let tb = (hi - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
      if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
  }
}
