/**
 * Places every landmark from landmarks.json as a THREE.LOD (detailed → simplified →
 * hidden), on terrain flattened by the terrain model, plus the instanced Avenue of
 * Sphinxes. Also exposes world positions and camera presets for navigation and UI.
 */
import {
  BufferAttribute, BufferGeometry, Group, InstancedMesh, LOD, Matrix4, Mesh, Object3D, Quaternion, Vector3,
  type Camera,
} from 'three';
import type { Landmark } from '../data/schema';
import type { World } from '../gis/world';
import { DEG } from '../core/math';
import type { MeshArrays } from '../city/meshBuilder';
import { createBuildingMaterial } from '../city/cityMaterials';
import { avenueSphinx, buildLandmark } from './models';

export interface PlacedLandmark {
  def: Landmark;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  object: Object3D | null;
}

export class LandmarkManager {
  readonly group = new Group();
  readonly placed: PlacedLandmark[] = [];
  private readonly material = createBuildingMaterial();
  private readonly instMaterial = createBuildingMaterial(true);
  private avenues: { group: Group; x: number; z: number }[] = [];

  constructor(private readonly world: World) {
    this.group.name = 'landmarks';
    for (const def of world.landmarks) this.place(def);
  }

  private place(def: Landmark): void {
    const [x, z] = this.world.proj.forward(def.lon, def.lat);
    const ground = this.world.terrain.sample(x, z, 1).height;
    const p: PlacedLandmark = { def, x, y: ground, z, radius: 60, height: 20, object: null };
    this.placed.push(p);
    if (def.model.type === 'avenue') {
      this.avenue(def, def.model.path, def.model.spacing);
      return;
    }
    const meshes = buildLandmark(def.model, { groundY: ground });
    if (!meshes) return;
    p.radius = meshes.radius;
    p.height = meshes.height;
    const lod = new LOD();
    lod.addLevel(this.mesh(meshes.detail), 0);
    if (meshes.simple) lod.addLevel(this.mesh(meshes.simple), Math.max(500, meshes.radius * 6));
    lod.addLevel(new Object3D(), Math.max(15000, meshes.radius * 120, meshes.height * 150));
    lod.position.set(x, ground, z);
    lod.rotation.y = -def.headingDeg * DEG;
    lod.name = def.id;
    lod.updateMatrix();
    lod.updateMatrixWorld(true);
    this.group.add(lod);
    p.object = lod;
  }

  private mesh(a: MeshArrays): Mesh {
    const m = new Mesh(geometry(a), this.material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private avenue(def: Landmark, path: number[], spacing: number): void {
    const pts = [];
    for (let i = 0; i < path.length; i += 2) pts.push(this.world.proj.forward(path[i], path[i + 1]));
    const [ox, oz] = pts[0];
    const transforms: Matrix4[] = [];
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      for (let s = spacing / 2; s < len; s += spacing) {
        for (const side of [-1, 1]) {
          const x = ax + ux * s - uz * side * 9;
          const z = az + uz * s + ux * side * 9;
          const y = this.world.terrain.sample(x, z, 1).height;
          // Sphinxes face the processional way.
          q.setFromAxisAngle(up, Math.atan2(-uz * side, ux * side) + Math.PI / 2);
          transforms.push(new Matrix4().compose(new Vector3(x - ox, y, z - oz), q, new Vector3(1, 1, 1)));
        }
      }
    }
    const inst = new InstancedMesh(geometry(avenueSphinx()), this.instMaterial, transforms.length);
    transforms.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.computeBoundingSphere();
    const group = new Group();
    group.position.set(ox, 0, oz);
    group.add(inst);
    group.name = def.id;
    this.group.add(group);
    const [mx, mz] = this.world.proj.forward(def.lon, def.lat);
    this.avenues.push({ group, x: mx, z: mz });
  }

  update(camera: Camera): void {
    for (const a of this.avenues) {
      a.group.visible = Math.hypot(camera.position.x - a.x, camera.position.z - a.z, camera.position.y) < 6000;
    }
  }

  byId(id: string): PlacedLandmark | undefined {
    return this.placed.find((p) => p.def.id === id);
  }
}

function geometry(a: MeshArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(a.positions, 3));
  g.setAttribute('normal', new BufferAttribute(a.normals, 3, true));
  g.setAttribute('aColor', new BufferAttribute(a.colors, 4, true));
  g.setAttribute('aFacade', new BufferAttribute(a.facade, 3));
  g.setIndex(new BufferAttribute(a.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export { geometry as meshArraysToGeometry };
