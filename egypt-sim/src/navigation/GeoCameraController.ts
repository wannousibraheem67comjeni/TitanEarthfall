/**
 * Geographic orbit camera spanning 1,500 km → 2 m:
 *   - grab-to-pan (the ground point under the cursor stays under the cursor)
 *   - wheel / pinch zoom toward the cursor, right-drag / two-finger rotate & tilt
 *   - WASD/arrows pan, Q/E rotate, R/F tilt, +/− zoom
 *   - altitude-aware tilt limits (top-down from orbit, horizon views at street level)
 *   - terrain following and collision, inertia
 *   - flyTo() along a van Wijk–Nuij zoom-pan path
 */
import { Euler, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { NAVIGATION } from '../config';
import { angleDelta, clamp, damp, DEG, easeInOutCubic, lerp, smoothstep } from '../core/math';
import { flightDuration, zoomPanPath, type ZoomPanPath } from './flightPath';

export interface CameraPose {
  x: number;
  z: number;
  distance: number;
  /** Bearing of the view direction (radians, clockwise from north). */
  heading: number;
  /** Angle below the horizon (radians): π/2 looks straight down. */
  pitch: number;
}

interface Flight {
  path: ZoomPanPath;
  from: CameraPose;
  to: CameraPose;
  t: number;
  duration: number;
  onDone?: () => void;
}

export class GeoCameraController {
  readonly target = new Vector3();
  distance: number = NAVIGATION.home.distance;
  heading: number = NAVIGATION.home.headingDeg * DEG;
  pitch: number = NAVIGATION.home.pitchDeg * DEG;
  enabled = true;
  private flight: Flight | null = null;
  private readonly panVel = new Vector2();
  private readonly keys = new Set<string>();
  private drag: { mode: 'pan' | 'rotate'; x: number; y: number; ground: Vector3 | null } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; angle: number; midY: number } | null = null;
  private lastManualTilt = -1e9;
  private zoomIntent = 0;
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private clock = 0;
  /** Fired when the user takes over (cancels flights, closes tours). */
  onUserInput: (() => void) | null = null;

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly pick: (ndcX: number, ndcY: number) => Vector3 | null,
  ) {
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('dblclick', this.onDblClick);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get pose(): CameraPose {
    return { x: this.target.x, z: this.target.z, distance: this.distance, heading: this.heading, pitch: this.pitch };
  }

  get flying(): boolean {
    return !!this.flight;
  }

  /** Steepest allowed view: near top-down from orbit, down to the horizon at street level. */
  minPitch(distance: number): number {
    return lerp(2 * DEG, 62 * DEG, smoothstep(15000, 900000, distance));
  }

  /** Pitch the camera eases toward while zooming (unless the user tilted recently). */
  preferredPitch(distance: number): number {
    return lerp(22 * DEG, 88 * DEG, smoothstep(2500, 500000, distance));
  }

  private widthOf(distance: number): number {
    return 2 * distance * Math.tan((this.camera.fov * DEG) / 2);
  }

  flyTo(to: Partial<CameraPose> & { x: number; z: number }, onDone?: () => void): void {
    const from = this.pose;
    const dest: CameraPose = {
      x: to.x,
      z: to.z,
      distance: clamp(to.distance ?? from.distance, NAVIGATION.minDistance, NAVIGATION.maxDistance),
      heading: to.heading ?? from.heading,
      pitch: to.pitch ?? this.preferredPitch(to.distance ?? from.distance),
    };
    const path = zoomPanPath({ x: from.x, z: from.z, w: this.widthOf(from.distance) }, { x: dest.x, z: dest.z, w: this.widthOf(dest.distance) });
    this.flight = { path, from, to: dest, t: 0, duration: flightDuration(path.S), onDone };
    this.panVel.set(0, 0);
  }

  jumpTo(p: CameraPose): void {
    this.flight = null;
    this.target.x = p.x;
    this.target.z = p.z;
    this.target.y = this.heightAt(p.x, p.z);
    this.distance = p.distance;
    this.heading = p.heading;
    this.pitch = p.pitch;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(f.duration, f.t + dt);
      const e = easeInOutCubic(f.t / f.duration);
      const v = f.path.at(f.path.S * e);
      this.target.x = v.x;
      this.target.z = v.z;
      this.distance = v.w / (2 * Math.tan((this.camera.fov * DEG) / 2));
      this.heading = f.from.heading + angleDelta(f.from.heading, f.to.heading) * e;
      // Tilt toward top-down while high, settle on the destination pitch at the end.
      const mid = Math.max(this.preferredPitch(this.distance), lerp(f.from.pitch, f.to.pitch, e));
      this.pitch = lerp(mid, f.to.pitch, smoothstep(0.6, 1, e));
      if (f.t >= f.duration) {
        this.flight = null;
        f.onDone?.();
      }
    } else {
      this.applyKeys(dt);
      // Inertial panning.
      if (!this.drag && this.panVel.lengthSq() > 1e-6) {
        this.target.x += this.panVel.x * dt;
        this.target.z += this.panVel.y * dt;
        this.panVel.multiplyScalar(1 - damp(0.12, dt));
      }
      if (this.zoomIntent !== 0 && this.clock - this.lastManualTilt > 3) {
        this.pitch += (this.preferredPitch(this.distance) - this.pitch) * damp(0.35, dt);
      }
      this.zoomIntent *= 1 - damp(0.25, dt);
      if (Math.abs(this.zoomIntent) < 0.01) this.zoomIntent = 0;
    }

    const half = 1_600_000;
    this.target.x = clamp(this.target.x, -half, half);
    this.target.z = clamp(this.target.z, -half, half);
    this.distance = clamp(this.distance, NAVIGATION.minDistance, NAVIGATION.maxDistance);
    this.pitch = clamp(this.pitch, this.minPitch(this.distance), 89.9 * DEG);
    const groundY = Math.max(this.heightAt(this.target.x, this.target.z), -500);
    this.target.y += (groundY - this.target.y) * (this.flight ? 1 : damp(0.08, dt));
    this.applyPose();
  }

  private applyPose(): void {
    const cp = Math.cos(this.pitch);
    const fx = Math.sin(this.heading) * cp;
    const fy = -Math.sin(this.pitch);
    const fz = -Math.cos(this.heading) * cp;
    const cam = this.camera.position;
    cam.set(this.target.x - fx * this.distance, this.target.y - fy * this.distance, this.target.z - fz * this.distance);
    const ground = this.heightAt(cam.x, cam.z);
    const minY = ground + NAVIGATION.minClearance;
    if (cam.y < minY) cam.y = minY;
    this.euler.set(-this.pitch, -this.heading, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
    // Near/far track altitude; the logarithmic depth buffer keeps precision across the range.
    const alt = Math.max(1, cam.y - ground);
    this.camera.near = clamp(alt * 0.05, 0.3, 500);
    this.camera.far = Math.max(4_000_000, this.distance * 4);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  // ───────────────────────── input ─────────────────────────

  private userInput(): void {
    this.flight = null;
    this.onUserInput?.();
  }

  private toNdc(clientX: number, clientY: number): Vector2 {
    const r = this.dom.getBoundingClientRect();
    return this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** Intersection of the cursor ray with the horizontal plane through the target. */
  private planePoint(clientX: number, clientY: number): Vector3 | null {
    this.ray.setFromCamera(this.toNdc(clientX, clientY), this.camera);
    this.plane.constant = -this.target.y;
    const hit = this.ray.ray.intersectPlane(this.plane, new Vector3());
    if (!hit) return null;
    // Rays grazing the horizon would fling the map; cap the reach.
    const reach = Math.hypot(hit.x - this.camera.position.x, hit.z - this.camera.position.z);
    return reach > this.distance * 25 ? null : hit;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.userInput();
    this.panVel.set(0, 0);
    if (this.pointers.size === 2) {
      this.drag = null;
      this.pinch = this.pinchState();
      return;
    }
    const rotate = e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey || e.altKey;
    this.drag = { mode: rotate ? 'rotate' : 'pan', x: e.clientX, y: e.clientY, ground: rotate ? null : this.planePoint(e.clientX, e.clientY) };
  };

  private pinchState(): { dist: number; angle: number; midY: number } {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midY: (a.y + b.y) / 2 };
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const p = this.pinchState();
      this.distance *= this.pinch.dist / Math.max(1, p.dist);
      this.heading -= angleDelta(this.pinch.angle, p.angle);
      this.pitch += (p.midY - this.pinch.midY) * 0.004;
      this.lastManualTilt = this.clock;
      this.pinch = p;
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'rotate') {
      this.heading += (e.clientX - d.x) * 0.005;
      this.pitch += (e.clientY - d.y) * 0.004;
      this.lastManualTilt = this.clock;
    } else if (d.ground) {
      const now = this.planePoint(e.clientX, e.clientY);
      if (now) {
        const dx = d.ground.x - now.x;
        const dz = d.ground.z - now.z;
        this.target.x += dx;
        this.target.z += dz;
        this.panVel.set(dx / 0.016, dz / 0.016).multiplyScalar(0.5);
        this.applyPose();
      }
    }
    d.x = e.clientX;
    d.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.drag = null;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.userInput();
    const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    const factor = Math.exp(clamp(delta, -300, 300) * 0.0018);
    const next = clamp(this.distance * factor, NAVIGATION.minDistance, NAVIGATION.maxDistance);
    // Zoom toward the point under the cursor.
    const ndc = this.toNdc(e.clientX, e.clientY);
    const p = this.pick(ndc.x, ndc.y) ?? this.planePoint(e.clientX, e.clientY);
    if (p) {
      const f = 1 - next / this.distance;
      this.target.x += (p.x - this.target.x) * f;
      this.target.z += (p.z - this.target.z) * f;
    }
    this.distance = next;
    this.zoomIntent = Math.sign(delta);
  };

  private onDblClick = (e: MouseEvent) => {
    const ndc = this.toNdc(e.clientX, e.clientY);
    const p = this.pick(ndc.x, ndc.y);
    if (p) this.flyTo({ x: p.x, z: p.z, distance: Math.max(NAVIGATION.minDistance * 4, this.distance / 4) });
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    this.keys.add(e.code);
  };

  private applyKeys(dt: number): void {
    if (!this.keys.size || !this.enabled) return;
    const k = this.keys;
    const speed = this.distance * 0.9 * dt;
    let fwd = 0;
    let right = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) right += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) right -= 1;
    if (fwd || right) {
      this.userInput();
      this.target.x += (Math.sin(this.heading) * fwd + Math.cos(this.heading) * right) * speed;
      this.target.z += (-Math.cos(this.heading) * fwd + Math.sin(this.heading) * right) * speed;
    }
    if (k.has('KeyQ')) this.heading -= 1.2 * dt;
    if (k.has('KeyE')) this.heading += 1.2 * dt;
    if (k.has('KeyR')) { this.pitch += 0.8 * dt; this.lastManualTilt = this.clock; }
    if (k.has('KeyF')) { this.pitch -= 0.8 * dt; this.lastManualTilt = this.clock; }
    if (k.has('Equal') || k.has('NumpadAdd')) { this.distance *= Math.exp(-1.6 * dt); this.zoomIntent = -1; }
    if (k.has('Minus') || k.has('NumpadSubtract')) { this.distance *= Math.exp(1.6 * dt); this.zoomIntent = 1; }
  }
}
