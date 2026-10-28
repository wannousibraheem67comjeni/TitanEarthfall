/**
 * Everyone and everything that moves on its own: the named characters at their posts,
 * passers-by on the sidewalks, and cars on the road.
 */
import { Group, Mesh, SphereGeometry, Vector3, type Scene } from 'three';
import { Rng } from '../core/rng';
import { angleDelta, clamp, damp, dampAngle } from '../core/math';
import { Character, type Activity } from '../world/characters';
import type { CircleCollider } from '../world/collision';
import { pedestrianRoutes } from '../world/layout';
import { CAR_COLORS, makeCar, type CarStyle } from '../world/props';
import { solid } from '../world/materials';
import type { NpcDef } from '../dialogue/npcs';
import { makePasserby, type Passerby } from '../dialogue/pedestrians';
import { isOpenAt } from './catalog';
import { groundHeight } from './Player';

// ---------------------------------------------------------------------------
// Named characters
// ---------------------------------------------------------------------------

export class NpcEntity {
  readonly char: Character;
  readonly pos: Vector3;
  heading: number;
  talking = false;
  activity: Activity = 'none';
  present = true;
  /** At the second spot (home) rather than the usual one. */
  atHome = false;
  private wanderT = 0;
  private wanderTarget: Vector3 | null = null;
  private readonly ball: Mesh | null = null;
  private ballVel = new Vector3();

  constructor(
    readonly def: NpcDef,
    scene: Scene,
  ) {
    this.char = new Character(def.look);
    this.pos = new Vector3(def.x, groundHeight(def.x, def.z), def.z);
    this.heading = def.facing;
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.heading;
    scene.add(this.char.root);
    if (def.id === 'ali') {
      this.ball = new Mesh(new SphereGeometry(0.11, 12, 8), solid('#f4f4f4', 0.5));
      this.ball.castShadow = true;
      this.ball.position.set(def.x + 1, 0.11, def.z);
      scene.add(this.ball);
    }
  }

  /** Where the character stands right now: the usual post, or home. */
  get spot(): { x: number; z: number; facing: number } {
    return this.atHome && this.def.home ? this.def.home : this.def;
  }

  get sitting(): boolean {
    return this.def.id === 'grandpa';
  }

  update(dt: number, hour: number, player: Vector3, focused: boolean): void {
    const home = this.def.home && isOpenAt(this.def.home.hours, hour) ? this.def.home : null;
    const spot = home ?? this.def;
    if (this.atHome !== !!home) {
      // Moved between the shop and the house while nobody was looking.
      this.atHome = !!home;
      this.pos.set(spot.x, groundHeight(spot.x, spot.z), spot.z);
      this.heading = spot.facing;
      this.char.root.position.copy(this.pos);
    }
    this.present = !!home || !this.def.hours || isOpenAt(this.def.hours, hour);
    this.char.root.visible = this.present;
    if (this.ball) this.ball.visible = this.present;
    if (!this.present) return;
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    let speed = 0;
    // Far-away people are skipped entirely: they are specks at that distance.
    this.char.root.visible = dist < 85;
    if (dist > 85 && !focused) return;

    if (this.def.id === 'ali' && !focused && this.ball) {
      // Ali dribbles a ball around in front of his house.
      this.wanderT -= dt;
      if (!this.wanderTarget || this.wanderT < 0) {
        this.wanderT = 2 + Math.random() * 3;
        this.wanderTarget = new Vector3(this.def.x + (Math.random() - 0.5) * 7, 0, this.def.z + (Math.random() - 0.5) * 1.6);
      }
      const tx = this.wanderTarget.x - this.pos.x;
      const tz = this.wanderTarget.z - this.pos.z;
      const d = Math.hypot(tx, tz);
      if (d > 0.3) {
        speed = Math.min(2.6, d * 2);
        this.heading = dampAngle(this.heading, Math.atan2(tx, tz), 8, dt);
        this.pos.x += Math.sin(this.heading) * speed * dt;
        this.pos.z += Math.cos(this.heading) * speed * dt;
      }
      const b = this.ball.position;
      const bd = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
      if (bd < 0.45 && speed > 0.5) this.ballVel.set(Math.sin(this.heading) * 3.5, 0, Math.cos(this.heading) * 3.5);
      b.addScaledVector(this.ballVel, dt);
      this.ballVel.multiplyScalar(Math.exp(-1.6 * dt));
      b.z = clamp(b.z, 10.4, 13.4);
      b.x = clamp(b.x, this.def.x - 6, this.def.x + 6);
      b.y = 0.11;
      this.ball.rotation.x += this.ballVel.z * dt * 8;
      this.ball.rotation.z -= this.ballVel.x * dt * 8;
    } else if (focused || dist < 5) {
      // Turn toward the player when they come close; the whole body when talking.
      if (!this.sitting && (focused || dist < 2.6)) this.heading = dampAngle(this.heading, toPlayer, 5, dt);
      else if (!focused && !this.sitting && Math.abs(angleDelta(this.heading, spot.facing)) > 0.05 && dist > 3.5) this.heading = dampAngle(this.heading, spot.facing, 2, dt);
    } else if (!this.sitting) {
      this.heading = dampAngle(this.heading, spot.facing, 2, dt);
      // Drift back to the post.
      const hx = spot.x - this.pos.x;
      const hz = spot.z - this.pos.z;
      const hd = Math.hypot(hx, hz);
      if (hd > 0.2) {
        speed = Math.min(1.4, hd);
        this.pos.x += (hx / hd) * speed * dt;
        this.pos.z += (hz / hd) * speed * dt;
      }
    }
    this.char.lookAtYaw(dist < 7 || focused ? toPlayer : null);
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
    this.char.root.position.copy(this.pos);
    if (this.sitting) this.char.root.position.y += 0.02;
    this.char.root.rotation.y = this.heading;
    this.char.update(dt, { speed, talking: this.talking, activity: this.activity, riding: 'none', sitting: this.sitting, airborne: false });
  }

  /** Position of the head, for camera framing and speech bubbles. */
  headPosition(out: Vector3): Vector3 {
    return out.set(this.pos.x, this.pos.y + this.char.height * (this.sitting ? 0.68 : 0.93), this.pos.z);
  }
}

// ---------------------------------------------------------------------------
// Passers-by
// ---------------------------------------------------------------------------

export interface Walker {
  p: Passerby;
  char: Character;
  pos: Vector3;
  heading: number;
  route: { x: number; z: number }[];
  index: number;
  dir: 1 | -1;
  offset: number;
  speed: number;
  pause: number;
  /** Held by the game while talking or buying. */
  hold: boolean;
  ownsWallet: boolean;
  active: boolean;
}

export class Pedestrians {
  readonly walkers: Walker[] = [];
  private readonly rng = new Rng(97);
  private readonly routes = pedestrianRoutes();

  constructor(
    private readonly scene: Scene,
    count: number,
  ) {
    for (let i = 0; i < count; i++) this.spawn(i);
  }

  private spawn(i: number): void {
    const p = makePasserby(this.rng, `walker-${i}`);
    const char = new Character(p.look);
    const route = this.routes[i % 5 === 4 ? 2 + (i % 2) : i % 2];
    const index = this.rng.int(0, route.length - 1);
    const offset = this.rng.range(-0.8, 0.8);
    const pos = new Vector3(route[index].x + this.rng.range(-4, 4), 0, route[index].z + offset);
    const w: Walker = { p, char, pos, heading: 0, route, index, dir: this.rng.chance(0.5) ? 1 : -1, offset, speed: this.rng.range(1.0, 1.45), pause: 0, hold: false, ownsWallet: false, active: true };
    this.scene.add(char.root);
    this.walkers.push(w);
  }

  /** How many walk the street at this hour: quiet nights, busy evenings. */
  static wanted(hour: number, total: number): number {
    if (hour < 5) return Math.round(total * 0.2);
    if (hour < 8) return Math.round(total * 0.5);
    if (hour < 16) return Math.round(total * 0.75);
    if (hour < 23) return total;
    return Math.round(total * 0.45);
  }

  update(dt: number, hour: number, player: Vector3, talkingTo: Walker | null): void {
    const want = Pedestrians.wanted(hour, this.walkers.length);
    this.walkers.forEach((w, i) => {
      const shouldBe = i < want || w.ownsWallet || w === talkingTo;
      if (!shouldBe && w.active && !w.hold) {
        w.active = false;
        w.char.root.visible = false;
      } else if (shouldBe && !w.active) {
        w.active = true;
        w.char.root.visible = true;
      }
      if (!w.active) return;
      let speed = 0;
      const dx = player.x - w.pos.x;
      const dz = player.z - w.pos.z;
      const dist = Math.hypot(dx, dz);
      if (w.hold || w === talkingTo) {
        w.heading = dampAngle(w.heading, Math.atan2(dx, dz), 5, dt);
      } else if (w.pause > 0) {
        w.pause -= dt;
      } else {
        const t = w.route[w.index];
        const tx = t.x - w.pos.x;
        const tz = t.z + w.offset - w.pos.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.6) {
          let next = w.index + w.dir;
          if (next < 0 || next >= w.route.length) {
            w.dir = w.dir === 1 ? -1 : 1;
            next = w.index + w.dir;
          }
          w.index = next;
          if (this.rng.chance(0.15)) w.pause = this.rng.range(1, 4);
        } else {
          speed = w.speed;
          // Step aside for the player.
          let hx = tx / d;
          let hz = tz / d;
          if (dist < 1.4) {
            hx -= (dx / dist) * 0.8;
            hz -= (dz / dist) * 0.8;
          }
          w.heading = dampAngle(w.heading, Math.atan2(hx, hz), 6, dt);
          w.pos.x += Math.sin(w.heading) * speed * dt;
          w.pos.z += Math.cos(w.heading) * speed * dt;
        }
      }
      w.char.root.visible = dist < 80;
      if (dist > 80) {
        w.char.root.position.copy(w.pos);
        return;
      }
      w.char.lookAtYaw(dist < 5 ? Math.atan2(dx, dz) : null);
      w.pos.y = groundHeight(w.pos.x, w.pos.z);
      w.char.root.position.copy(w.pos);
      w.char.root.rotation.y = w.heading;
      w.char.update(dt, { speed, talking: false, activity: 'none', riding: 'none', sitting: false, airborne: false });
    });
  }

  nearest(x: number, z: number, maxDist: number): Walker | null {
    let best: Walker | null = null;
    let bd = maxDist;
    for (const w of this.walkers) {
      if (!w.active) continue;
      const d = Math.hypot(w.pos.x - x, w.pos.z - z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  obstacles(out: CircleCollider[]): void {
    for (const w of this.walkers) if (w.active) out.push({ x: w.pos.x, z: w.pos.z, r: 0.3 });
  }
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

interface Car {
  group: Group;
  dir: 1 | -1;
  x: number;
  speed: number;
  max: number;
  honk: number;
}

const LANE_Z = 3;
const ROAD_END = 200;

export class Traffic {
  readonly cars: Car[] = [];
  onHonk: ((x: number, z: number) => void) | null = null;

  constructor(scene: Scene, count: number) {
    const rng = new Rng(55);
    const styles: CarStyle[] = ['sedan', 'suv', 'sedan', 'taxi', 'pickup', 'suv'];
    for (let i = 0; i < count; i++) {
      const dir: 1 | -1 = i % 2 ? 1 : -1;
      const group = makeCar(styles[i % styles.length], rng.pick(CAR_COLORS));
      const x = -ROAD_END + ((i * 2 * ROAD_END) / count + rng.range(0, 30));
      group.position.set(x, 0, dir * LANE_Z);
      group.rotation.y = dir === 1 ? 0 : Math.PI;
      // Cars are modelled facing +x; heading east keeps rotation 0.
      scene.add(group);
      const max = rng.range(9, 13);
      this.cars.push({ group, dir, x, speed: max, max, honk: 0 });
    }
  }

  update(dt: number, player: Vector3): void {
    for (const c of this.cars) {
      const laneZ = c.dir * LANE_Z;
      let limit = c.max;
      // Brake for the player standing in the lane ahead.
      const ahead = (player.x - c.x) * c.dir;
      if (Math.abs(player.z - laneZ) < 1.9 && ahead > 0 && ahead < 14) {
        limit = Math.max(0, (ahead - 3.2) * 1.4);
        if (ahead < 9 && c.honk <= 0) {
          c.honk = 4;
          this.onHonk?.(c.x, laneZ);
        }
      }
      // Keep distance to the car in front.
      for (const o of this.cars) {
        if (o === c || o.dir !== c.dir) continue;
        const gap = (o.x - c.x) * c.dir;
        if (gap > 0 && gap < 12) limit = Math.min(limit, Math.max(0, (gap - 6) * 1.2));
      }
      c.honk -= dt;
      c.speed = damp(c.speed, limit, limit < c.speed ? 4 : 1.2, dt);
      c.x += c.speed * c.dir * dt;
      if (c.x * c.dir > ROAD_END) c.x = -ROAD_END * c.dir;
      c.group.position.set(c.x, 0, laneZ);
      // Wheels roll forward in the car's own frame whichever way it drives.
      for (const w of c.group.children) if (w.name === 'wheel') w.rotation.z -= (c.speed * dt) / 0.36;
    }
  }

  obstacles(out: CircleCollider[]): void {
    for (const c of this.cars) {
      // Two circles approximate the car body.
      const z = c.dir * LANE_Z;
      out.push({ x: c.x + 1.2, z, r: 1.0 }, { x: c.x - 1.2, z, r: 1.0 });
    }
  }
}
