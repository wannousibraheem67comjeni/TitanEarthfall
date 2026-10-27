/**
 * Visual feedback in the world: banknotes fluttering into your pocket, the occasional
 * note blowing down the street, empty cans to collect, a dropped wallet, objective
 * beacons, and small particle bursts (water, foam, sparkles).
 */
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
} from 'three';
import { Rng } from '../core/rng';
import { breakdown } from './catalog';
import { coinTexture, glowTexture, iconTexture, noteTexture } from '../world/textures';
import { makeCan, makeWallet } from '../world/props';
import { groundHeight } from './Player';

interface FlyingNote {
  mesh: Mesh;
  pos: Vector3;
  vel: Vector3;
  age: number;
  spin: number;
}

const noteGeo = new PlaneGeometry(0.56, 0.27);
const coinGeo = new CylinderGeometry(0.1, 0.1, 0.02, 16);
const noteMats = new Map<number, MeshStandardMaterial>();

function noteMaterial(value: number): MeshStandardMaterial {
  let m = noteMats.get(value);
  if (!m) {
    m = new MeshStandardMaterial({ map: value === 1 ? coinTexture() : noteTexture(value), side: DoubleSide, roughness: value === 1 ? 0.3 : 0.7, metalness: value === 1 ? 0.7 : 0 });
    noteMats.set(value, m);
  }
  return m;
}

export class MoneyFx {
  private readonly notes: FlyingNote[] = [];
  private readonly rng = new Rng(13);
  /** Fired as each note reaches the player (for the coin sound). */
  onArrive: ((value: number) => void) | null = null;

  constructor(private readonly scene: Scene) {}

  /** Notes burst out of `from` and fly to the player: shows a payment physically. */
  burst(from: Vector3, amount: number): void {
    const parts = breakdown(amount);
    let count = 0;
    for (const { value, count: n } of parts) {
      for (let i = 0; i < Math.min(n, 4) && count < 14; i++, count++) {
        const mesh = new Mesh(value === 1 ? coinGeo : noteGeo, noteMaterial(value));
        mesh.userData.value = value;
        mesh.castShadow = true;
        const pos = from.clone();
        pos.y += 1.2;
        mesh.position.copy(pos);
        this.scene.add(mesh);
        const a = this.rng.range(0, Math.PI * 2);
        this.notes.push({ mesh, pos, vel: new Vector3(Math.cos(a) * 1.6, this.rng.range(2.5, 4.2), Math.sin(a) * 1.6), age: -count * 0.06, spin: this.rng.range(-6, 6) });
      }
    }
  }

  update(dt: number, player: Vector3): void {
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      n.age += dt;
      if (n.age < 0) continue;
      if (n.age < 0.55) {
        n.vel.y -= 7 * dt;
        n.vel.multiplyScalar(Math.exp(-1.5 * dt));
      } else {
        // Home in on the player's chest.
        const target = new Vector3(player.x, player.y + 1.1, player.z);
        const to = target.sub(n.pos);
        const d = to.length();
        if (d < 0.35 || n.age > 3) {
          this.scene.remove(n.mesh);
          this.notes.splice(i, 1);
          this.onArrive?.(n.mesh.userData.value as number);
          continue;
        }
        n.vel.lerp(to.normalize().multiplyScalar(9 + n.age * 6), 1 - Math.exp(-6 * dt));
      }
      n.pos.addScaledVector(n.vel, dt);
      n.mesh.position.copy(n.pos);
      n.mesh.rotation.x += n.spin * dt;
      n.mesh.rotation.y += n.spin * 0.7 * dt;
    }
  }
}

// ---------------------------------------------------------------------------
// Things lying around
// ---------------------------------------------------------------------------

export interface GroundItem {
  kind: 'can' | 'note' | 'wallet';
  obj: Group | Mesh;
  x: number;
  z: number;
  value: number;
  age: number;
}

/** Spots where litter and lost notes may appear: sidewalks, the alley, the park. */
function randomSpot(rng: Rng): { x: number; z: number } {
  const r = rng.next();
  if (r < 0.4) return { x: rng.range(-118, 108), z: rng.range(-9.5, -6.6) };
  if (r < 0.75) return { x: rng.range(-118, 108), z: rng.range(6.6, 9.6) };
  if (r < 0.88) return { x: rng.range(-21, -13), z: rng.range(12, 78) };
  return { x: rng.range(70, 110), z: rng.range(16, 50) };
}

export class GroundItems {
  readonly items: GroundItem[] = [];
  private readonly rng = new Rng(31);
  private canTimer = 0;
  private noteTimer = 40;

  constructor(private readonly scene: Scene) {
    for (let i = 0; i < 10; i++) this.spawnCan();
  }

  spawnCan(): void {
    const { x, z } = randomSpot(this.rng);
    const obj = makeCan(this.rng);
    obj.position.x = x;
    obj.position.z = z;
    obj.position.y += groundHeight(x, z);
    this.scene.add(obj);
    this.items.push({ kind: 'can', obj, x, z, value: 0, age: 0 });
  }

  /** A note blowing along the sidewalk, free to whoever runs and catches it. */
  spawnNote(): void {
    const { x, z } = randomSpot(this.rng);
    const value = this.rng.weighted([5, 10, 20], [6, 3, 1]);
    const obj = new Mesh(noteGeo, noteMaterial(value));
    obj.castShadow = true;
    obj.position.set(x, 0.3 + groundHeight(x, z), z);
    this.scene.add(obj);
    this.items.push({ kind: 'note', obj, x, z, value, age: 0 });
  }

  dropWallet(x: number, z: number): GroundItem {
    const obj = makeWallet();
    obj.position.set(x, groundHeight(x, z), z);
    this.scene.add(obj);
    const it: GroundItem = { kind: 'wallet', obj, x, z, value: 0, age: 0 };
    this.items.push(it);
    return it;
  }

  remove(it: GroundItem): void {
    this.scene.remove(it.obj);
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** Walk-over pickups (cans and notes). Returns what was collected this frame. */
  update(dt: number, player: Vector3, time: number): GroundItem[] {
    this.canTimer -= dt;
    this.noteTimer -= dt;
    const cans = this.items.filter((i) => i.kind === 'can').length;
    if (this.canTimer < 0 && cans < 14) {
      this.canTimer = 25;
      this.spawnCan();
    }
    if (this.noteTimer < 0) {
      this.noteTimer = this.rng.range(90, 160);
      if (!this.items.some((i) => i.kind === 'note')) this.spawnNote();
    }
    const got: GroundItem[] = [];
    for (const it of [...this.items]) {
      it.age += dt;
      if (it.kind === 'note') {
        // Drift in the breeze, flapping.
        it.x += Math.sin(time * 0.4 + it.age) * dt * 0.9;
        it.z += Math.cos(time * 0.3 + it.age * 1.3) * dt * 0.3;
        it.obj.position.set(it.x, groundHeight(it.x, it.z) + 0.25 + Math.abs(Math.sin(time * 3 + it.age)) * 0.35, it.z);
        it.obj.rotation.set(Math.sin(time * 5) * 0.6, time * 1.5, Math.cos(time * 4) * 0.4);
        if (it.age > 150) this.remove(it);
      }
      if (it.kind === 'wallet') it.obj.rotation.y += dt;
      const d = Math.hypot(player.x - it.x, player.z - it.z);
      if (it.kind !== 'wallet' && d < (it.kind === 'note' ? 1.3 : 0.95)) {
        this.remove(it);
        got.push(it);
      }
    }
    return got;
  }
}

// ---------------------------------------------------------------------------
// Objective beacons
// ---------------------------------------------------------------------------

export interface Beacon {
  id: string;
  pos: Vector3;
  group: Group;
  icon: string;
  label: string;
  primary: boolean;
}

export class Beacons {
  readonly list = new Map<string, Beacon>();
  private time = 0;

  constructor(private readonly scene: Scene) {}

  set(id: string, x: number, z: number, icon: string, label: string, opts: { color?: string; primary?: boolean; height?: number } = {}): Beacon {
    this.remove(id);
    const group = new Group();
    const beam = new Mesh(new CylinderGeometry(0.55, 0.55, opts.height ?? 26, 16, 1, true), new MeshBasicMaterial({ color: opts.color ?? '#ffd34d', transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }));
    beam.position.y = (opts.height ?? 26) / 2;
    const ring = new Mesh(new CylinderGeometry(1.1, 1.1, 0.04, 28, 1, true), new MeshBasicMaterial({ color: opts.color ?? '#ffd34d', transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    ring.position.y = 0.2;
    const sprite = new Sprite(new SpriteMaterial({ map: iconTexture(icon), depthTest: false, transparent: true }));
    sprite.scale.setScalar(1.1);
    sprite.position.y = 3.2;
    sprite.renderOrder = 10;
    group.add(beam, ring, sprite);
    group.position.set(x, groundHeight(x, z), z);
    this.scene.add(group);
    const b: Beacon = { id, pos: new Vector3(x, 0, z), group, icon, label, primary: opts.primary ?? true };
    this.list.set(id, b);
    return b;
  }

  move(id: string, x: number, z: number): void {
    const b = this.list.get(id);
    if (!b) return;
    b.pos.set(x, 0, z);
    b.group.position.set(x, groundHeight(x, z), z);
  }

  remove(id: string): void {
    const b = this.list.get(id);
    if (!b) return;
    this.scene.remove(b.group);
    this.list.delete(id);
  }

  clear(prefix = ''): void {
    for (const id of [...this.list.keys()]) if (id.startsWith(prefix)) this.remove(id);
  }

  /** The beacon the HUD arrow should point at: the nearest primary one. */
  primary(from: Vector3): Beacon | null {
    let best: Beacon | null = null;
    let bd = Infinity;
    for (const b of this.list.values()) {
      if (!b.primary) continue;
      const d = b.pos.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  update(dt: number, player: Vector3): void {
    this.time += dt;
    for (const b of this.list.values()) {
      const d = Math.hypot(player.x - b.pos.x, player.z - b.pos.z);
      const [beam, ring, sprite] = b.group.children as [Mesh, Mesh, Sprite];
      (beam.material as MeshBasicMaterial).opacity = Math.min(0.2, 0.03 + d / 150);
      ring.scale.setScalar(1 + Math.sin(this.time * 3) * 0.12);
      sprite.position.y = 3.2 + Math.sin(this.time * 2.5) * 0.15;
    }
  }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

interface Particle {
  s: Sprite;
  vel: Vector3;
  life: number;
  max: number;
  grow: number;
}

export class Particles {
  private readonly ps: Particle[] = [];
  private readonly mats = new Map<string, SpriteMaterial>();

  constructor(private readonly scene: Scene) {}

  private mat(color: string, additive: boolean): SpriteMaterial {
    const key = color + additive;
    let m = this.mats.get(key);
    if (!m) {
      m = new SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false });
      if (additive) m.blending = AdditiveBlending;
      this.mats.set(key, m);
    }
    return m;
  }

  emit(at: Vector3, kind: 'water' | 'foam' | 'sparkle' | 'dust', n = 6): void {
    const rng = Math.random;
    for (let i = 0; i < n; i++) {
      const color = kind === 'water' ? '#8fd0ff' : kind === 'foam' ? '#ffffff' : kind === 'sparkle' ? '#ffe27a' : '#d8c4a0';
      const s = new Sprite(this.mat(color, kind === 'sparkle').clone());
      s.position.copy(at);
      const size = kind === 'foam' ? 0.25 : kind === 'dust' ? 0.4 : 0.12;
      s.scale.setScalar(size);
      this.scene.add(s);
      const vel =
        kind === 'water'
          ? new Vector3((rng() - 0.5) * 0.6, -1.5 - rng(), (rng() - 0.5) * 0.6)
          : kind === 'sparkle'
            ? new Vector3((rng() - 0.5) * 2, 1 + rng() * 2, (rng() - 0.5) * 2)
            : new Vector3((rng() - 0.5) * 0.8, rng() * 0.6, (rng() - 0.5) * 0.8);
      const max = kind === 'foam' ? 1.2 : 0.8;
      this.ps.push({ s, vel, life: max, max, grow: kind === 'foam' || kind === 'dust' ? 1.2 : 0 });
    }
  }

  update(dt: number): void {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.s);
        p.s.material.dispose();
        this.ps.splice(i, 1);
        continue;
      }
      p.vel.y -= (p.grow ? 0.2 : 4) * dt;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.multiplyScalar(1 + p.grow * dt);
      p.s.material.opacity = p.life / p.max;
    }
  }
}
