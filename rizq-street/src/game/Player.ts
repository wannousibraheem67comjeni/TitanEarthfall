/** The player: movement, stamina, jumping, riding, carrying, and the character model. */
import { Group, Vector3, type Object3D } from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { Character, type Activity } from '../world/characters';
import type { CircleCollider, Colliders } from '../world/collision';
import { makeRide } from '../world/props';
import type { Look } from '../dialogue/npcs';

export const SPEEDS = { walk: 3.9, run: 6.7, bike: 9.5, scooter: 12.5 };

/** Sidewalks are a kerb higher than the road. */
export function groundHeight(x: number, z: number): number {
  if (x > -124 && x < 114 && Math.abs(z) >= 6 && Math.abs(z) <= 10) return 0.15;
  return 0;
}

export class Player {
  readonly char: Character;
  readonly pos = new Vector3();
  heading = 0;
  speed = 0;
  stamina = 100;
  staminaMax = 100;
  private vy = 0;
  private y = 0;
  airborne = false;
  ride: 'none' | 'bike' | 'scooter' = 'none';
  private readonly rides: Record<'bike' | 'scooter', Group>;
  activity: Activity = 'none';
  talking = false;
  carried: Object3D | null = null;
  /** Temporary speed bonus after a snack (seconds left). */
  boost = 0;
  frozen = false;

  constructor(look: Look) {
    this.char = new Character(look);
    this.rides = { bike: makeRide('bike'), scooter: makeRide('scooter') };
    for (const r of Object.values(this.rides)) {
      r.visible = false;
      this.char.root.add(r);
      r.scale.setScalar(1 / this.char.root.scale.x);
    }
  }

  get object(): Group {
    return this.char.root;
  }

  setRide(kind: 'none' | 'bike' | 'scooter'): void {
    this.ride = kind;
    this.rides.bike.visible = kind === 'bike';
    this.rides.scooter.visible = kind === 'scooter';
  }

  carry(obj: Object3D | null): void {
    if (this.carried) this.carried.removeFromParent();
    this.carried = obj;
    if (obj) {
      obj.position.set(0, -0.12, 0.05);
      this.char.handR.add(obj);
    }
  }

  /**
   * Advance one frame. `move` is the input axis relative to the camera; camYaw is the
   * camera's orbit angle (camera sits at +yaw looking back at the player).
   */
  update(dt: number, move: { x: number; y: number }, run: boolean, jump: boolean, camYaw: number, colliders: Colliders, extra: CircleCollider[], speedMul: number): void {
    const mag = this.frozen ? 0 : Math.hypot(move.x, move.y);
    let target = 0;
    if (mag > 0.05) {
      // Forward is away from the camera.
      const fwdX = -Math.sin(camYaw);
      const fwdZ = -Math.cos(camYaw);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const dx = fwdX * move.y + rightX * move.x;
      const dz = fwdZ * move.y + rightZ * move.x;
      const want = Math.atan2(dx, dz);
      this.heading = dampAngle(this.heading, want, this.ride === 'none' ? 12 : 6, dt);
      const canRun = run && this.stamina > 3 && this.ride === 'none';
      const base = this.ride === 'bike' ? SPEEDS.bike : this.ride === 'scooter' ? SPEEDS.scooter : canRun ? SPEEDS.run : SPEEDS.walk;
      target = base * speedMul * Math.min(1, mag) * (this.boost > 0 ? 1.15 : 1);
      if (canRun) this.stamina = Math.max(0, this.stamina - 13 * dt);
    }
    if (!(run && mag > 0.05)) this.stamina = Math.min(this.staminaMax, this.stamina + 9 * dt);
    this.boost = Math.max(0, this.boost - dt);
    this.speed = damp(this.speed, target, this.ride === 'none' ? 10 : 3.5, dt);

    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    const r = this.ride === 'none' ? 0.34 : 0.55;
    const res = colliders.resolve(nx, nz, r, extra);
    // Lose speed when pushing into a wall.
    const moved = Math.hypot(res.x - this.pos.x, res.z - this.pos.z);
    if (dt > 0 && moved / dt < this.speed * 0.5) this.speed *= 0.9;
    this.pos.x = res.x;
    this.pos.z = res.z;

    const gh = groundHeight(this.pos.x, this.pos.z);
    if (jump && !this.airborne && this.ride === 'none' && !this.frozen) {
      this.vy = 5.2;
      this.airborne = true;
    }
    if (this.airborne) {
      this.vy -= 15 * dt;
      this.y += this.vy * dt;
      if (this.y <= gh) {
        this.y = gh;
        this.vy = 0;
        this.airborne = false;
      }
    } else this.y = damp(this.y, gh, 18, dt);
    this.pos.y = this.y;

    this.char.root.position.set(this.pos.x, this.pos.y + (this.ride === 'bike' ? 0.42 : this.ride === 'scooter' ? 0.2 : 0), this.pos.z);
    this.char.root.rotation.y = this.heading;
    this.rides.bike.position.y = -0.42 / this.char.root.scale.x;
    this.rides.scooter.position.y = -0.2 / this.char.root.scale.x;
    this.char.update(dt, {
      speed: this.speed,
      talking: this.talking,
      activity: this.carried && this.activity === 'none' ? 'carry' : this.activity,
      riding: this.ride,
      sitting: false,
      airborne: this.airborne,
    });
  }

  place(x: number, z: number, heading: number): void {
    this.pos.set(x, groundHeight(x, z), z);
    this.y = this.pos.y;
    this.heading = heading;
    this.speed = 0;
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = heading;
  }

  get staminaFraction(): number {
    return clamp(this.stamina / this.staminaMax, 0, 1);
  }
}
