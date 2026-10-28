/**
 * Procedural people: kandura and ghutra with agal, abaya and shayla, work clothes,
 * children and the elderly. Each body part is one merged mesh with vertex colours, so
 * a whole person is about a dozen draw calls sharing a single material. The animator
 * drives walking, running, riding, sitting, talking and working poses.
 */
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, dampAngle } from '../core/math';
import type { Look } from './look';

const SHARED = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
const MOUTH = new MeshStandardMaterial({ color: '#5a2a24', roughness: 0.9 });

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpV = new Vector3();
const tmpS = new Vector3();
const tmpC = new Color();

/** Collects coloured primitives and merges them into one vertex-coloured mesh. */
class Part {
  private readonly geos: BufferGeometry[] = [];

  add(geo: BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    tmpE.set(rx, ry, rz);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(tmpM);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    tmpC.set(color).convertSRGBToLinear();
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.geos.push(g);
    return this;
  }

  mesh(): Mesh {
    const m = new Mesh(mergeGeometries(this.geos, false)!, SHARED);
    m.castShadow = true;
    m.receiveShadow = false;
    return m;
  }

  get empty(): boolean {
    return this.geos.length === 0;
  }
}

const sphere = (r: number, w = 10, h = 8) => new SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, seg = 10) => new CylinderGeometry(rt, rb, h, seg);
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);

function darker(hex: string, f: number): string {
  return '#' + new Color(hex).multiplyScalar(f).getHexString();
}

export type Activity = 'none' | 'scrub' | 'water' | 'sweep' | 'cook' | 'type' | 'carry' | 'wave' | 'phone';

export interface PoseState {
  speed: number;
  talking: boolean;
  activity: Activity;
  riding: 'none' | 'bike' | 'scooter';
  sitting: boolean;
  airborne: boolean;
}

export class Character {
  readonly root = new Group();
  readonly body = new Group();
  readonly head = new Group();
  readonly armL = new Group();
  readonly armR = new Group();
  readonly foreL = new Group();
  readonly foreR = new Group();
  readonly legL = new Group();
  readonly legR = new Group();
  readonly shinL = new Group();
  readonly shinR = new Group();
  /** Attach carried things here. */
  readonly handR = new Object3D();
  readonly mouth: Mesh;
  private robe: Mesh | null = null;
  private phase = Math.random() * 10;
  private t = Math.random() * 10;
  private headYaw = 0;
  private lookTarget = 0;
  private idleLook = 0;
  private idleTimer = 2 + Math.random() * 3;
  private gesture = 0;
  readonly height: number;
  private readonly old: boolean;

  constructor(readonly look: Look) {
    const child = look.build === 'boy';
    this.old = look.build === 'old';
    const scale = look.height / 1.75;
    this.height = look.height;
    this.root.add(this.body);
    this.root.scale.setScalar(scale);

    const skin = look.skin;
    const robed = look.outfit === 'kandura' || look.outfit === 'abaya';
    const top = look.primary;
    const bottom = look.outfit === 'overalls' ? look.primary : look.secondary;

    // Torso / robe (fixed to the body).
    const torso = new Part();
    if (robed) {
      const bottomR = look.outfit === 'abaya' ? 0.31 : 0.27;
      const robe = new Part().add(cyl(0.2, bottomR, 1.4, 14), top, 0, 0.76, 0, 0, 0, 0, 1, 1, 0.78);
      if (look.outfit === 'kandura') robe.add(cyl(0.012, 0.012, 0.22, 4), darker(top, 0.85), 0, 1.32, 0.15, 0.1); // tarboosha tassel
      this.robe = robe.mesh();
      this.body.add(this.robe);
      torso.add(sphere(0.2, 12, 8), top, 0, 1.4, 0, 0, 0, 0, 1.05, 0.55, 0.8);
    } else {
      torso.add(cyl(0.2, 0.17, 0.56, 12), top, 0, 1.18, 0, 0, 0, 0, 1, 1, 0.68);
      torso.add(sphere(0.2, 12, 8), top, 0, 1.43, 0, 0, 0, 0, 1.05, 0.5, 0.72);
      torso.add(cyl(0.17, 0.17, 0.14, 12), bottom, 0, 0.93, 0, 0, 0, 0, 1, 1, 0.7);
      if (look.outfit === 'apron') torso.add(box(0.34, 0.62, 0.02), look.secondary, 0, 0.95, 0.13);
      if (look.outfit === 'overalls') {
        torso.add(box(0.03, 0.4, 0.02), darker(top, 0.7), -0.08, 1.25, 0.125);
        torso.add(box(0.03, 0.4, 0.02), darker(top, 0.7), 0.08, 1.25, 0.125);
      }
    }
    torso.add(cyl(0.05, 0.055, 0.1, 8), skin, 0, 1.52, 0);
    this.body.add(torso.mesh());

    // Head.
    this.head.position.set(0, 1.5, 0);
    this.body.add(this.head);
    const headScale = child ? 1.18 : 1;
    const h = new Part();
    h.add(sphere(0.11, 14, 10), skin, 0, 0.13, 0, 0, 0, 0, 0.95 * headScale, 1.06 * headScale, headScale);
    h.add(sphere(0.022, 6, 4), skin, -0.104 * headScale, 0.13, 0);
    h.add(sphere(0.022, 6, 4), skin, 0.104 * headScale, 0.13, 0);
    h.add(sphere(0.016, 6, 4), '#1a1410', -0.038, 0.145, 0.097 * headScale);
    h.add(sphere(0.016, 6, 4), '#1a1410', 0.038, 0.145, 0.097 * headScale);
    h.add(sphere(0.006, 4, 3), '#ffffff', -0.034, 0.15, 0.111 * headScale);
    h.add(sphere(0.006, 4, 3), '#ffffff', 0.042, 0.15, 0.111 * headScale);
    const brow = look.beard !== 'none' ? look.beardColor : look.head === 'hair' ? look.headColor : '#2a1d14';
    h.add(box(0.045, 0.009, 0.012), brow, -0.04, 0.175, 0.1 * headScale, 0, 0, 0.08);
    h.add(box(0.045, 0.009, 0.012), brow, 0.04, 0.175, 0.1 * headScale, 0, 0, -0.08);
    h.add(box(0.022, 0.045, 0.03), darker(skin, 0.92), 0, 0.12, 0.106 * headScale);
    if (look.beard === 'full') h.add(sphere(0.102, 12, 8), look.beardColor, 0, 0.075, 0.028, 0, 0, 0, 1.0, 0.78, 0.85);
    if (look.beard === 'short') h.add(sphere(0.1, 12, 8), look.beardColor, 0, 0.08, 0.02, 0, 0, 0, 0.98, 0.62, 0.86);
    if (look.beard === 'full' || look.beard === 'moustache' || look.beard === 'short') h.add(box(0.07, 0.014, 0.016), look.beardColor, 0, 0.093, 0.107);
    switch (look.head) {
      case 'ghutra':
        h.add(sphere(0.126, 14, 8), look.headColor, 0, 0.14, -0.004, 0, 0, 0, 1.0, 1.0, 1.04);
        h.add(new CylinderGeometry(0.128, 0.21, 0.36, 14, 1, true, 0.85, Math.PI * 2 - 1.7), look.headColor, 0, -0.02, -0.01);
        if (look.headColor === '#c64848') h.add(new CylinderGeometry(0.129, 0.211, 0.36, 14, 1, true, 0.85, Math.PI * 2 - 1.7), '#f4f0ea', 0, -0.021, -0.012, 0, 0, 0, 1, 0.2, 1);
        h.add(new TorusGeometry(0.112, 0.012, 6, 18), '#141414', 0, 0.205, -0.006, Math.PI / 2);
        h.add(new TorusGeometry(0.106, 0.011, 6, 18), '#141414', 0, 0.225, -0.006, Math.PI / 2);
        break;
      case 'shayla':
        h.add(new SphereGeometry(0.137, 16, 10, Math.PI / 2 + 0.78, Math.PI * 2 - 1.56, 0, Math.PI * 0.78), look.headColor, 0, 0.135, -0.005);
        h.add(cyl(0.13, 0.25, 0.32, 14), look.headColor, 0, -0.06, -0.01);
        break;
      case 'kufi':
        h.add(new SphereGeometry(0.118, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.36), look.headColor, 0, 0.15, 0);
        break;
      case 'cap':
        h.add(new SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), look.headColor, 0, 0.15, 0);
        h.add(box(0.15, 0.012, 0.11), look.headColor, 0, 0.165, 0.13);
        break;
      case 'hair':
        h.add(new SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), look.headColor, 0, 0.15, -0.012, -0.15, 0, 0, headScale, headScale * 0.95, headScale * 1.05);
        break;
    }
    if (look.glasses) {
      h.add(new TorusGeometry(0.024, 0.004, 4, 12), '#1a1a1a', -0.038, 0.145, 0.115 * headScale);
      h.add(new TorusGeometry(0.024, 0.004, 4, 12), '#1a1a1a', 0.038, 0.145, 0.115 * headScale);
      h.add(box(0.03, 0.004, 0.004), '#1a1a1a', 0, 0.148, 0.117 * headScale);
    }
    this.head.add(h.mesh());
    this.mouth = new Mesh(box(0.04, 0.01, 0.012), MOUTH);
    this.mouth.position.set(0, 0.078, 0.108 * headScale);
    this.head.add(this.mouth);

    // Arms.
    const sleeve = top;
    const wide = look.outfit === 'abaya';
    for (const [arm, fore, side] of [
      [this.armL, this.foreL, -1],
      [this.armR, this.foreR, 1],
    ] as const) {
      arm.position.set(0.215 * side, 1.42, 0);
      this.body.add(arm);
      const upper = new Part().add(cyl(wide ? 0.07 : 0.055, wide ? 0.08 : 0.05, 0.3, 8), sleeve, 0, -0.15, 0);
      arm.add(upper.mesh());
      fore.position.set(0, -0.3, 0);
      arm.add(fore);
      const lower = new Part();
      const shortSleeve = look.outfit === 'casual' && look.build !== 'woman';
      lower.add(cyl(wide ? 0.08 : 0.048, wide ? 0.1 : 0.044, 0.25, 8), shortSleeve ? skin : sleeve, 0, -0.125, 0);
      lower.add(sphere(0.048, 8, 6), skin, 0, -0.29, 0.005, 0, 0, 0, 0.9, 1.1, 0.8);
      if (side === 1 && look.cane) lower.add(cyl(0.015, 0.015, 0.95, 6), '#4a3220', 0, -0.62, 0.05);
      fore.add(lower.mesh());
      if (side === 1) {
        this.handR.position.set(0, -0.32, 0.03);
        fore.add(this.handR);
      }
    }

    // Legs: under a robe only the sandals show.
    for (const [leg, shin, side] of [
      [this.legL, this.shinL, -1],
      [this.legR, this.shinR, 1],
    ] as const) {
      leg.position.set(0.095 * side, 0.92, 0);
      this.body.add(leg);
      if (!robed) leg.add(new Part().add(cyl(0.075, 0.062, 0.44, 8), bottom, 0, -0.22, 0).mesh());
      shin.position.set(0, -0.44, 0);
      leg.add(shin);
      const lower = new Part();
      if (!robed) lower.add(cyl(0.058, 0.05, 0.4, 8), bottom, 0, -0.2, 0);
      else lower.add(cyl(0.04, 0.04, 0.36, 6), skin, 0, -0.22, 0);
      const shoe = robed ? '#5a3e2b' : look.outfit === 'casual' ? '#e8e8e8' : '#2a2a2a';
      lower.add(box(0.1, 0.06, 0.25), shoe, 0, -0.43, 0.045);
      shin.add(lower.mesh());
    }
    if (this.old) this.body.rotation.x = 0.1;
  }

  /** Turn the head toward a world-space yaw (absolute), within neck limits. */
  lookAtYaw(yaw: number | null): void {
    if (yaw === null) {
      this.lookTarget = this.idleLook;
      return;
    }
    let d = yaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.lookTarget = clamp(d, -1.1, 1.1);
  }

  update(dt: number, s: PoseState): void {
    this.t += dt;
    const speed = s.riding !== 'none' ? 0 : s.speed;
    const a = clamp(speed / 1.5, 0, 1.4);
    const run = clamp((speed - 4) / 3, 0, 1);
    const rate = speed > 0.1 ? 3.0 + speed * (this.old ? 0.8 : 1.05) : 0;
    this.phase += rate * dt;
    const p = this.phase;
    const sin = Math.sin(p);

    // Idle glances when standing.
    this.idleTimer -= dt;
    if (this.idleTimer < 0) {
      this.idleTimer = 2 + Math.random() * 4;
      this.idleLook = (Math.random() - 0.5) * 1.2;
    }
    this.headYaw = dampAngle(this.headYaw, this.lookTarget, 6, dt);
    this.head.rotation.y = this.headYaw;

    let legLx = -sin * 0.6 * a;
    let legRx = sin * 0.6 * a;
    let shinLx = Math.max(0, Math.sin(p - 1.2)) * (0.5 + 0.7 * run) * a;
    let shinRx = Math.max(0, Math.sin(p - 1.2 + Math.PI)) * (0.5 + 0.7 * run) * a;
    let armLx = sin * (0.45 + 0.4 * run) * a;
    let armRx = -sin * (0.45 + 0.4 * run) * a;
    let foreLx = -0.15 - run * 0.9 * a;
    let foreRx = -0.15 - run * 0.9 * a;
    let armLz = 0.06;
    let armRz = -0.06;
    let bodyY = Math.abs(Math.cos(p)) * 0.035 * a * (1 + run);
    let lean = run * 0.18 * a + (this.old ? 0.1 : 0);

    if (s.sitting) {
      legLx = legRx = -1.45;
      shinLx = shinRx = 1.45;
      bodyY = -0.45;
      armLx = armRx = -0.35;
      foreLx = foreRx = -0.6;
      lean = 0.05;
    } else if (s.riding === 'bike') {
      const pedal = this.t * 7 * clamp(s.speed / 5, 0, 1.5);
      legLx = -1.0 + Math.sin(pedal) * 0.45;
      legRx = -1.0 - Math.sin(pedal) * 0.45;
      shinLx = 1.1 + Math.cos(pedal) * 0.4;
      shinRx = 1.1 - Math.cos(pedal) * 0.4;
      armLx = armRx = -1.05;
      foreLx = foreRx = -0.25;
      bodyY = -0.18;
      lean = 0.28;
    } else if (s.riding === 'scooter') {
      legLx = -0.15;
      legRx = 0.2;
      shinLx = shinRx = 0.1;
      armLx = armRx = -1.0;
      foreLx = foreRx = -0.35;
      lean = 0.08;
    } else if (s.airborne) {
      legLx = -0.5;
      legRx = 0.3;
      shinLx = shinRx = 0.6;
      armLx = armRx = -0.6;
    }

    // Arm work overrides the swing.
    switch (s.activity) {
      case 'scrub':
        armRx = -1.25 + Math.sin(this.t * 9) * 0.25;
        armRz = -0.25 + Math.cos(this.t * 9) * 0.25;
        foreRx = -0.4;
        break;
      case 'water':
        armRx = -1.0;
        foreRx = -0.2;
        armLx = -0.8;
        foreLx = -0.4;
        lean = 0.1;
        break;
      case 'sweep':
        armRx = -0.7 + Math.sin(this.t * 6) * 0.35;
        armLx = -0.9 + Math.sin(this.t * 6) * 0.35;
        foreRx = foreLx = -0.5;
        lean = 0.15;
        break;
      case 'cook':
        armRx = -0.9 + Math.sin(this.t * 5) * 0.15;
        armLx = -0.7;
        foreRx = -0.9;
        foreLx = -0.8;
        break;
      case 'type':
        armRx = armLx = -0.6;
        foreRx = foreLx = -0.9 + Math.sin(this.t * 20) * 0.05;
        break;
      case 'carry':
        armRx = -0.15;
        foreRx = -0.25;
        armRz = -0.18;
        break;
      case 'wave':
        armRz = -2.5;
        foreRx = -0.2 + Math.sin(this.t * 10) * 0.4;
        armRx = 0;
        break;
      case 'phone':
        armRx = -0.5;
        foreRx = -1.9;
        armRz = -0.2;
        break;
    }

    // Talking: mouth moves, the occasional hand gesture.
    if (s.talking) {
      this.mouth.scale.y = 1 + Math.abs(Math.sin(this.t * 17)) * 3.2;
      this.head.rotation.x = Math.sin(this.t * 3.1) * 0.05;
      this.gesture = damp(this.gesture, Math.sin(this.t * 1.3) > 0.3 ? 1 : 0, 3, dt);
      if (s.activity === 'none' && speed < 0.2 && !s.sitting) {
        armRx = armRx * (1 - this.gesture) + (-0.75 + Math.sin(this.t * 4) * 0.15) * this.gesture;
        foreRx = foreRx * (1 - this.gesture) + -0.8 * this.gesture;
      }
    } else {
      this.mouth.scale.y = damp(this.mouth.scale.y, 1, 12, dt);
      this.head.rotation.x = damp(this.head.rotation.x, 0, 6, dt);
    }

    // Breathing.
    const breathe = Math.sin(this.t * 2.2) * 0.008;
    const k = 14;
    this.legL.rotation.x = damp(this.legL.rotation.x, legLx, k, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, legRx, k, dt);
    this.shinL.rotation.x = damp(this.shinL.rotation.x, shinLx, k, dt);
    this.shinR.rotation.x = damp(this.shinR.rotation.x, shinRx, k, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, armLx, k, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armRx, k, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, armLz, k, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armRz, k, dt);
    this.foreL.rotation.x = damp(this.foreL.rotation.x, foreLx, k, dt);
    this.foreR.rotation.x = damp(this.foreR.rotation.x, foreRx, k, dt);
    this.body.position.y = damp(this.body.position.y, bodyY + breathe, 16, dt);
    this.body.rotation.x = damp(this.body.rotation.x, lean, 8, dt);
    if (this.robe) this.robe.rotation.x = -sin * 0.04 * a;
  }
}
