/**
 * Two opposing convoys of container ships moving along the real Suez Canal
 * polyline at ~8 knots of simulation time (capped so fast-forward stays readable).
 */
import { Group, InstancedMesh, Matrix4, Quaternion, Vector3, type Camera } from 'three';
import type { World } from '../gis/world';
import { createBuildingMaterial } from '../city/cityMaterials';
import { containerShip } from './models';
import { meshArraysToGeometry } from './LandmarkManager';

const SPEED = 4.1; // m/s ≈ 8 knots
const PER_CONVOY = 9;
const LANE = 55;

export class SuezTraffic {
  readonly group = new Group();
  private readonly pts: [number, number, number][] = [];
  private readonly cum: number[] = [0];
  private readonly ships: InstancedMesh;
  private readonly origin: [number, number];
  private distance = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly pos = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  constructor(world: World) {
    const canal = world.gis.rivers.find((r) => r.id === 'suez');
    const p = canal?.points ?? [];
    for (let i = 0; i < p.length; i += 2) {
      const [x, z] = world.proj.forward(p[i], p[i + 1]);
      this.pts.push([x, z, 0]);
      if (i > 0) {
        const [px, pz] = this.pts[this.pts.length - 2];
        this.cum.push(this.cum[this.cum.length - 1] + Math.hypot(x - px, z - pz));
      }
    }
    this.origin = this.pts.length ? [this.pts[0][0], this.pts[0][1]] : [0, 0];
    this.ships = new InstancedMesh(meshArraysToGeometry(containerShip(0.3)), createBuildingMaterial(true), PER_CONVOY * 2);
    this.ships.castShadow = true;
    this.ships.frustumCulled = false;
    this.group.add(this.ships);
    this.group.position.set(this.origin[0], 0, this.origin[1]);
    this.group.name = 'suez-traffic';
  }

  get length(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }

  /** @param simDt simulation seconds elapsed this frame. */
  update(simDt: number, camera: Camera): void {
    const L = this.length;
    if (!L) return;
    const near = Math.hypot(camera.position.y, 0) < 120000;
    this.group.visible = near;
    if (!near) return;
    this.distance = (this.distance + SPEED * Math.min(simDt, 2)) % L;
    for (let k = 0; k < PER_CONVOY * 2; k++) {
      const north = k < PER_CONVOY;
      const offset = ((k % PER_CONVOY) / PER_CONVOY) * L;
      // Southbound convoy travels with increasing arc length (polyline runs Port Said → Suez).
      const s = north ? (L - ((this.distance + offset) % L)) : (this.distance + offset) % L;
      const [x, z, dx, dz] = this.at(s);
      const side = north ? 1 : -1;
      const heading = north ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
      this.q.setFromAxisAngle(this.up, heading + Math.PI);
      this.pos.set(x - this.origin[0] - dz * LANE * side, 0, z - this.origin[1] + dx * LANE * side);
      this.ships.setMatrixAt(k, this.m.compose(this.pos, this.q, this.one));
    }
    this.ships.instanceMatrix.needsUpdate = true;
  }

  /** Position and unit tangent at arc length s. */
  private at(s: number): [number, number, number, number] {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const t = (s - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    const [ax, az] = this.pts[i - 1];
    const [bx, bz] = this.pts[i];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    return [ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / len, (bz - az) / len];
  }
}
