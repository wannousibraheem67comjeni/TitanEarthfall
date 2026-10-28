/** Third-person camera: orbit with drag, follow behind when walking, frame conversations. */
import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import type { Colliders } from '../world/collision';

export class CameraRig {
  yaw = Math.PI;
  pitch = 0.32;
  dist = 6.5;
  private readonly target = new Vector3();
  private readonly desired = new Vector3();
  private lastManual = 0;
  private time = 0;
  private snapped = false;
  /** When set, the camera frames this point (a conversation partner, a car being washed). */
  focus: { point: Vector3; yaw: number; pitch: number; dist: number } | null = null;
  /** Inside the house: look down from above into the rooms (the roof is hidden). */
  indoor = false;
  private indoorT = 0;
  /** Solid volumes only the camera avoids (the upper floor of the house). */
  blockers: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }[] = [];

  constructor(readonly camera: PerspectiveCamera) {}

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.0055;
    this.pitch = clamp(this.pitch + dy * 0.004, -0.15, 1.25);
    this.lastManual = this.time;
  }

  zoomBy(steps: number): void {
    this.dist = clamp(this.dist + steps * 0.8, 2.6, 14);
  }

  snapBehind(heading: number): void {
    this.yaw = heading + Math.PI;
  }

  update(dt: number, player: Vector3, heading: number, moving: boolean, colliders: Colliders): void {
    this.time += dt;
    let pitch = this.pitch;
    let dist = this.dist;
    let yaw = this.yaw;
    if (this.focus) {
      this.target.lerp(this.focus.point, 1 - Math.exp(-5 * dt));
      yaw = this.focus.yaw;
      pitch = this.focus.pitch;
      dist = this.focus.dist;
      this.yaw = dampAngle(this.yaw, yaw, 4, dt);
      this.pitch = damp(this.pitch, pitch, 4, dt);
      yaw = this.yaw;
      pitch = this.pitch;
    } else {
      this.target.set(player.x, player.y + 1.55, player.z);
      // Drift behind the player while walking, unless the player just steered the camera.
      if (moving && this.time - this.lastManual > 1.6) this.yaw = dampAngle(this.yaw, heading + Math.PI, 1.2, dt);
      yaw = this.yaw;
      this.indoorT = damp(this.indoorT, this.indoor ? 1 : 0, 5, dt);
      pitch += (Math.max(pitch, 1.0) - pitch) * this.indoorT;
      dist += (clamp(dist, 7, 9) - dist) * this.indoorT;
    }
    this.desired.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist).add(this.target);
    if (!this.focus && !this.indoor) {
      // Keep the camera on this side of walls.
      let t = colliders.raycast(this.target.x, this.target.y, this.target.z, this.desired.x, this.desired.y, this.desired.z);
      for (const b of this.blockers) t = Math.min(t, rayBox(this.target, this.desired, b));
      if (t < 1) this.desired.lerpVectors(this.target, this.desired, Math.max(0.12, t - 0.06));
    }
    this.desired.y = Math.max(this.desired.y, 0.4);
    if (!this.snapped) {
      this.camera.position.copy(this.desired);
      this.snapped = true;
    } else this.camera.position.lerp(this.desired, 1 - Math.exp(-14 * dt));
    this.camera.lookAt(this.target);
  }
}

/** Fraction along a→b where the segment first enters the box (1 when it misses). */
function rayBox(a: Vector3, b: Vector3, box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }): number {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.y, b.y - a.y, box.minY, box.maxY],
    [a.z, b.z - a.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return 1;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return 1;
  }
  return t0;
}
