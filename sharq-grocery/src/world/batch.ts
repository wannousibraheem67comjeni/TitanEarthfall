/**
 * Static geometry batching: everything that never moves is collected per material and
 * merged into one mesh per material, so the whole street draws in a few dozen calls.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Matrix4, Mesh, Euler, Quaternion, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpS = new Vector3();
const tmpP = new Vector3();

/**
 * A box whose UVs are scaled to world size so a texture repeats every `tile` metres
 * (u along the face width, v along its height).
 */
export function worldBox(w: number, h: number, d: number, tileU = 1, tileV = tileU): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Face order in BoxGeometry: +x, −x, +y, −y, +z, −z; 4 vertices each.
  const sizes: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = sizes[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * fw) / tileU, (uv.getY(k) * fh) / tileV);
    }
  }
  return g;
}

interface Bucket {
  material: Material;
  parts: BufferGeometry[];
  cast: boolean;
  receive: boolean;
}

export class Batcher {
  private readonly buckets = new Map<Material, Bucket>();

  /** Add a geometry (consumed) with a world transform. */
  add(geometry: BufferGeometry, material: Material, matrix?: Matrix4, shadows: { cast?: boolean; receive?: boolean } = {}): void {
    let b = this.buckets.get(material);
    if (!b) this.buckets.set(material, (b = { material, parts: [], cast: shadows.cast ?? true, receive: shadows.receive ?? true }));
    if (matrix) geometry.applyMatrix4(matrix);
    // Merging needs identical attribute sets: drop extras and de-index everything.
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.clearGroups();
    b.parts.push(g);
  }

  /** Place a geometry at a position with a y rotation (and optional x/z rotation, scale). */
  place(geometry: BufferGeometry, material: Material, x: number, y: number, z: number, rotY = 0, opts: { rotX?: number; rotZ?: number; scale?: number; cast?: boolean; receive?: boolean } = {}): void {
    tmpE.set(opts.rotX ?? 0, rotY, opts.rotZ ?? 0);
    tmpQ.setFromEuler(tmpE);
    const s = opts.scale ?? 1;
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(s, s, s));
    this.add(geometry, material, tmpM, opts);
  }

  /** Axis-aligned box from min/max corners, UVs tiled in world units. */
  boxMinMax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: Material, tileU = 1, tileV = tileU, shadows?: { cast?: boolean; receive?: boolean }): void {
    const g = worldBox(x1 - x0, y1 - y0, z1 - z0, tileU, tileV);
    tmpM.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g, material, tmpM, shadows);
  }

  cylinder(x: number, y0: number, z: number, r: number, h: number, material: Material, seg = 10, rTop = r): void {
    const g = new CylinderGeometry(rTop, r, h, seg);
    tmpM.makeTranslation(x, y0 + h / 2, z);
    this.add(g, material, tmpM);
  }

  build(): Group {
    const group = new Group();
    group.name = 'static';
    for (const b of this.buckets.values()) {
      if (!b.parts.length) continue;
      const merged = mergeGeometries(b.parts, false);
      for (const p of b.parts) p.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}
