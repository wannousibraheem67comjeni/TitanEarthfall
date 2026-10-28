/**
 * The people: who they are (name, look, voice, how far they can be trusted with a
 * debt) and what they do. A customer comes along the pavement, pushes the door open,
 * walks the aisles taking things off the shelves into a basket, waits in line, sets
 * the goods down on the desk one by one, says the bill, pays or hands over a card,
 * and leaves with a bag. Passers-by just walk past.
 */
import { Vector3, type Scene } from 'three';
import { dampAngle } from '../core/math';
import type { Rng } from '../core/rng';
import type { Desk } from '../world/desk';
import { Human } from '../world/humans';
import type { Look } from '../world/look';
import { productObject } from '../world/products';
import type { ShopLayout } from '../world/shop';
import type { Bill, Kind } from './economy';

export interface Persona {
  name: string;
  look: Look;
  gender: 'm' | 'f';
  pitch: number;
  key: string;
  /** 0–1: how likely a debt comes back. */
  trust: number;
  child: boolean;
}

const SKIN_GULF = ['#e3c0a3', '#d8b293', '#cba282', '#bb9072', '#a87f62'];
const SKIN_ASIA = ['#9e7055', '#8b6149', '#7a543f', '#ae7f60', '#c49c80'];
const SKIN_ALL = [...SKIN_GULF, ...SKIN_ASIA, '#efd2bb', '#e0b99b'];
const HAIR = ['#1a1310', '#120d0b', '#2a1d14', '#3b2a1e', '#1a1310'];
const KANDURA = ['#fbfaf6', '#fbfaf6', '#f4f1e8', '#ebe7de', '#dcd6c8', '#cfd6dc', '#c9c2b4'];

type Preset = { names: string[]; gender: 'm' | 'f'; trust: [number, number]; pitch: number; weight: number; look: (rng: Rng) => Look };

const pick = <T,>(r: Rng, a: readonly T[]) => r.pick(a);

const PRESETS: Preset[] = [
  {
    // Emirati men in kandura and ghutra.
    names: ['أبو سعيد', 'بو راشد', 'سالم', 'خليفة', 'مطر', 'عبيد', 'سيف', 'حمد', 'سعيد', 'راشد'],
    gender: 'm',
    trust: [0.6, 0.95],
    pitch: 0.92,
    weight: 4,
    look: (r) => ({
      build: 'man',
      outfit: 'kandura',
      skin: pick(r, SKIN_GULF),
      primary: pick(r, KANDURA),
      secondary: '#efeeea',
      head: r.chance(0.72) ? 'ghutra' : 'shemagh',
      headColor: '#ffffff',
      hairColor: '#15100d',
      beard: r.weighted(['full', 'trim', 'goatee', 'moustache'] as const, [3, 4, 2, 1]),
      beardColor: pick(r, ['#15100d', '#1d1612', '#2a201a']),
      height: r.range(1.68, 1.86),
      weight: r.range(0.1, 0.65),
      shoes: 'sandals',
      glasses: r.chance(0.15),
    }),
  },
  {
    // Emirati women in abaya and shayla.
    names: ['أم سعيد', 'أم خالد', 'مريم', 'عائشة', 'شمّا', 'حصة', 'موزة', 'فاطمة', 'علياء'],
    gender: 'f',
    trust: [0.6, 0.95],
    pitch: 1.12,
    weight: 3,
    look: (r) => ({
      build: 'woman',
      outfit: 'abaya',
      skin: pick(r, SKIN_GULF),
      primary: '#141216',
      secondary: '#141216',
      head: r.chance(0.82) ? 'shayla' : 'niqab',
      headColor: '#141216',
      hairColor: '#120d0b',
      beard: 'none',
      beardColor: '#000',
      height: r.range(1.56, 1.7),
      weight: r.range(0.1, 0.5),
      shoes: 'formal',
      glasses: r.chance(0.12),
    }),
  },
  {
    // Workers in coveralls, delivery riders, office men in shirts.
    names: ['رامو', 'محمد علي', 'جوزيف', 'ريان', 'كريم', 'أبو يوسف', 'فيصل', 'أنور', 'سنيل', 'عمران'],
    gender: 'm',
    trust: [0.3, 0.8],
    pitch: 1.0,
    weight: 5,
    look: (r) => {
      const kind = r.weighted(['uniform', 'shirt', 'tshirt'] as const, [4, 4, 2]);
      return {
        build: 'man',
        outfit: kind,
        skin: pick(r, kind === 'uniform' ? SKIN_ASIA : SKIN_ALL),
        primary: kind === 'uniform' ? pick(r, ['#2b4c7e', '#2f5f8f', '#d9772b', '#3f7d4c', '#6b7075']) : kind === 'shirt' ? pick(r, ['#dfe8f2', '#ffffff', '#b8cfe6', '#e9dccb', '#c9d9c5']) : pick(r, ['#e06a1f', '#2d8f5a', '#c0392b', '#2b2d31', '#f2c230']),
        secondary: kind === 'shirt' ? pick(r, ['#1f2a44', '#3a3a3a', '#6b5a43', '#2b2d31']) : '#2f4766',
        head: kind === 'tshirt' && r.chance(0.6) ? 'cap' : r.chance(0.2) ? 'cap' : 'hair',
        headColor: pick(r, ['#e06a1f', '#1f6fd0', '#2b2d31', '#c0392b']),
        hairColor: pick(r, HAIR),
        beard: r.weighted(['none', 'moustache', 'trim', 'full'] as const, [3, 3, 3, 1]),
        beardColor: '#15100d',
        height: r.range(1.64, 1.82),
        weight: r.range(0, 0.6),
        shoes: kind === 'shirt' ? 'formal' : 'sneakers',
        glasses: r.chance(0.18),
      };
    },
  },
  {
    // Expat women: housekeepers, teachers, mothers.
    names: ['ماريا', 'سارة', 'رنا', 'ليلى', 'جوي', 'هبة', 'ديما', 'أنجيلا'],
    gender: 'f',
    trust: [0.4, 0.85],
    pitch: 1.2,
    weight: 2,
    look: (r) => {
      const hijab = r.chance(0.5);
      return {
        build: 'woman',
        outfit: r.chance(0.5) ? 'dress' : 'shirt',
        skin: pick(r, SKIN_ALL),
        primary: pick(r, ['#c46aa8', '#3f86b8', '#e0a526', '#4f7f73', '#e9dccb', '#ffffff']),
        secondary: pick(r, ['#2a2a2e', '#3b4a6b', '#6b5a43', '#7a2e4a']),
        head: hijab ? 'hijab' : 'longhair',
        headColor: pick(r, ['#7a5aa6', '#c46aa8', '#3b4a6b', '#e9dccb', '#2b2d31']),
        hairColor: pick(r, HAIR),
        beard: 'none',
        beardColor: '#000',
        height: r.range(1.54, 1.7),
        weight: r.range(0.05, 0.5),
        shoes: r.chance(0.5) ? 'sneakers' : 'formal',
        glasses: r.chance(0.15),
      };
    },
  },
  {
    // The old men of the neighbourhood.
    names: ['الحجي مبارك', 'الشايب أبو علي', 'بو حمد', 'الوالد سعيد'],
    gender: 'm',
    trust: [0.8, 1],
    pitch: 0.8,
    weight: 1,
    look: (r) => ({
      build: 'old',
      outfit: 'kandura',
      skin: pick(r, SKIN_GULF),
      primary: pick(r, ['#f2efe8', '#e6e0d4', '#d9d2c3']),
      secondary: '#efeeea',
      head: r.chance(0.6) ? 'ghutra' : 'shemagh',
      headColor: '#ffffff',
      hairColor: '#d9d4cc',
      beard: 'full',
      beardColor: pick(r, ['#e8e4dc', '#cfcac2', '#bdb6ab']),
      height: r.range(1.62, 1.72),
      weight: r.range(0.2, 0.6),
      shoes: 'sandals',
      cane: true,
      glasses: r.chance(0.6),
    }),
  },
];

const KID_NAMES: [string, 'm' | 'f'][] = [
  ['حمدان الصغير', 'm'],
  ['مايد', 'm'],
  ['عبودي', 'm'],
  ['سلامة', 'f'],
  ['نورة الصغيرة', 'f'],
  ['سيفوه', 'm'],
];

function kidLook(r: Rng, g: 'm' | 'f'): Look {
  const emirati = r.chance(0.5);
  if (g === 'm')
    return emirati
      ? { build: 'boy', outfit: 'kandura', skin: pick(r, SKIN_GULF), primary: '#fbfaf6', secondary: '#efeeea', head: 'kufi', headColor: '#fff', hairColor: '#15100d', beard: 'none', beardColor: '#000', height: r.range(1.15, 1.35), weight: r.range(0, 0.4), shoes: 'sandals' }
      : { build: 'boy', outfit: 'school', skin: pick(r, SKIN_ALL), primary: '#ffffff', secondary: '#5b6470', head: 'hair', headColor: '#000', hairColor: pick(r, HAIR), beard: 'none', beardColor: '#000', height: r.range(1.15, 1.35), weight: r.range(0, 0.4), shoes: 'sneakers', backpack: true };
  return { build: 'girl', outfit: 'dress', skin: pick(r, SKIN_ALL), primary: '#ffffff', secondary: pick(r, ['#3b4a6b', '#7a2e4a', '#2f6b5a']), head: emirati ? 'hijab' : 'longhair', headColor: '#ffffff', hairColor: pick(r, HAIR), beard: 'none', beardColor: '#000', height: r.range(1.12, 1.32), weight: r.range(0, 0.3), shoes: 'sneakers', backpack: true };
}

export function makePersona(rng: Rng, kind: Kind | 'walker', preset?: number): Persona {
  if (kind === 'kid') {
    const [name, g] = rng.pick(KID_NAMES);
    return { name, look: kidLook(rng, g), gender: g, pitch: 1.5 * rng.range(0.95, 1.05), key: `cust-${name}`, trust: 0.5, child: true };
  }
  const p = preset !== undefined ? PRESETS[preset % PRESETS.length] : rng.weighted(PRESETS, PRESETS.map((x) => x.weight));
  const name = rng.pick(p.names);
  return { name, look: p.look(rng), gender: p.gender, pitch: p.pitch * rng.range(0.95, 1.05), key: `cust-${name}`, trust: rng.range(p.trust[0], p.trust[1]), child: false };
}

/** The same person again (a debtor coming back to pay). */
export function personaAgain(rng: Rng, name: string, gender: 'm' | 'f', look?: Look): Persona {
  const preset = PRESETS.find((p) => p.gender === gender && p.names.includes(name)) ?? PRESETS[gender === 'f' ? 1 : 0];
  return { name, look: look ?? preset.look(rng), gender, pitch: preset.pitch, key: `cust-${name}`, trust: 1, child: false };
}

// ---------------------------------------------------------------------------

export type Phase = 'arrive' | 'browse' | 'line' | 'desk' | 'talk' | 'wait' | 'pay' | 'leave' | 'gone';

/** Someone walking on their own legs between waypoints. */
class Walker {
  readonly human: Human;
  path: Vector3[] = [];
  heading: number;
  speed = 0;
  readonly pace: number;

  constructor(look: Look, scene: Scene, at: Vector3, heading: number) {
    this.human = new Human(look);
    this.human.root.position.copy(at);
    this.heading = heading;
    this.human.root.rotation.y = heading;
    scene.add(this.human.root);
    this.pace = look.build === 'old' ? 0.75 : look.build === 'boy' || look.build === 'girl' ? 1.15 : 1.15 + Math.random() * 0.25;
  }

  get pos(): Vector3 {
    return this.human.root.position;
  }

  /** Step along the path; true while still walking. */
  walk(dt: number, blocked = false): boolean {
    if (!this.path.length) {
      this.speed = Math.max(0, this.speed - dt * 4);
      return false;
    }
    const t = this.path[0];
    const dx = t.x - this.pos.x;
    const dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.06) {
      this.pos.x = t.x;
      this.pos.z = t.z;
      this.path.shift();
      return this.path.length > 0;
    }
    const want = blocked ? 0 : Math.min(this.pace, d * 2.2 + 0.25);
    this.speed += (want - this.speed) * Math.min(1, dt * 5);
    this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 7, dt);
    const step = Math.min(d, this.speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    return true;
  }

  face(angle: number, dt: number): void {
    this.heading = dampAngle(this.heading, angle, 6, dt);
  }

  animate(dt: number): void {
    this.human.root.rotation.y = this.heading;
    this.human.pose.speed = this.speed;
    this.human.update(dt);
  }
}

/** Someone on the pavement who is not coming in. */
export class Passerby {
  readonly w: Walker;
  gone = false;
  /** Some people glance in through the glass as they pass. */
  private readonly curious: boolean;

  constructor(rng: Rng, scene: Scene, layout: ShopLayout) {
    const dir = rng.chance(0.5) ? 1 : -1;
    const z = layout.walkZ - rng.range(-0.4, 0.9);
    this.w = new Walker(makePersona(rng, 'walker').look, scene, new Vector3(-dir * 18, 0, z), dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.w.path = [new Vector3(dir * 18, 0, z)];
    if (rng.chance(0.25)) this.w.human.hold('bag');
    this.curious = rng.chance(0.5);
  }

  get pos(): Vector3 {
    return this.w.pos;
  }

  update(dt: number, camera: Vector3): void {
    if (this.gone) return;
    // A glance into the shop when passing the door.
    this.w.human.pose.lookAt = this.curious && Math.abs(this.w.pos.x) < 2.5 ? camera : null;
    if (!this.w.walk(dt)) {
      this.gone = true;
      this.w.human.dispose();
      return;
    }
    this.w.animate(dt);
  }

  dispose(): void {
    this.w.human.dispose();
    this.gone = true;
  }
}

export class Customer {
  readonly w: Walker;
  phase: Phase = 'arrive';
  /** Seconds waiting at the desk for a decision. */
  waited = 0;
  /** True once every item is on the desk and the bill can be said. */
  ready = false;
  slot = -1;
  private stops: { at: Vector3; face: number; shelfY: number }[] = [];
  private pause = 0;
  private facing: number | null = null;
  private toPlace: (() => void)[] = [];
  private placeT = 0;
  private payT = 0;
  private picked = 0;
  private inside = false;
  /** Called when they pass through the door (for the chime). */
  onDoor: (() => void) | null = null;

  constructor(
    readonly persona: Persona,
    readonly bill: Bill,
    scene: Scene,
    private readonly layout: ShopLayout,
    private readonly desk: Desk,
    rng: Rng,
  ) {
    const side = rng.chance(0.5) ? 1 : -1;
    this.w = new Walker(persona.look, scene, new Vector3(side * 16, 0, layout.walkZ - rng.range(0, 0.6)), -side * (Math.PI / 2));
    // Along the pavement, then in through the door.
    this.w.path = [new Vector3(side * 1.4, 0, layout.walkZ + 0.3), layout.doorOut.clone(), layout.door.clone()];
    // Which shelves to visit (a debtor comes straight to the desk).
    if (bill.kind !== 'repay' && layout.picks.length) {
      const n = Math.min(layout.picks.length, Math.max(1, Math.min(3, Math.ceil(bill.lines.length / 1.5))));
      this.stops = rng.shuffle(layout.picks).slice(0, n);
      this.stops.sort((a, b) => a.at.z - b.at.z);
    }
    // The goods that will land on the desk.
    let count = 0;
    for (const l of bill.lines) {
      const copies = Math.min(l.qty, l.product.pack === 'bigbox' || l.product.pack === 'folder' || l.product.pack === 'case' ? 1 : 3);
      for (let i = 0; i < copies && count < 8; i++, count++) this.toPlace.push(() => desk.place(productObject(l.product)));
    }
  }

  get human(): Human {
    return this.w.human;
  }

  get pos(): Vector3 {
    return this.w.pos;
  }

  /** Route to a point inside, using the cross aisles at the front and in front of the desk. */
  private route(to: Vector3): Vector3[] {
    const from = this.pos;
    const L = this.layout;
    if (Math.abs(from.x - to.x) < 0.3) return [to.clone()];
    const viaFront = Math.abs(from.z - L.frontZ) + Math.abs(to.z - L.frontZ) < Math.abs(from.z - L.backZ) + Math.abs(to.z - L.backZ);
    const z = viaFront ? L.frontZ : L.backZ;
    return [new Vector3(from.x, 0, z), new Vector3(to.x, 0, z), to.clone()];
  }

  /** Join the line at a place (0 = at the desk). */
  goTo(slot: number): void {
    if (this.slot === slot) return;
    this.slot = slot;
    const q = slot === 0 ? this.layout.spot : this.layout.queue(slot);
    this.w.path = this.route(q);
    this.phase = 'line';
  }

  /** Done shopping and ready to queue? */
  get shopped(): boolean {
    return this.phase === 'browse' && this.stops.length === 0 && !this.pendingStop && this.pause <= 0 && this.w.path.length === 0;
  }

  /** Accepted: hand over the money (or card), take the bag. Refused: leave the goods. */
  settle(accepted: boolean, mood: 'happy' | 'neutral' | 'sad' | 'cross', paysNow: boolean): void {
    this.human.pose.mood = mood;
    this.phase = paysNow ? 'pay' : 'leave';
    this.payT = paysNow ? 1.3 : 0;
    this.ready = false;
    if (!paysNow) this.depart(accepted);
    else this.pendingBag = accepted;
  }

  private pendingBag = false;

  private depart(withBag: boolean): void {
    const goods = this.desk.clear();
    void goods;
    this.human.hold(withBag && this.bill.kind !== 'repay' ? 'bag' : 'none');
    this.human.pose.give = 0;
    this.phase = 'leave';
    const L = this.layout;
    const side = Math.random() < 0.5 ? 1 : -1;
    this.w.path = [...this.route(new Vector3(0, 0, L.frontZ)), L.door.clone(), L.doorOut.clone(), new Vector3(side * 1.6, 0, L.walkZ + 0.2), new Vector3(side * 17, 0, L.walkZ - 0.3)];
  }

  update(dt: number, camera: Vector3, blocked: boolean): void {
    if (this.phase === 'gone') return;
    const pose = this.human.pose;
    pose.reach += ((this.phase === 'browse' && this.pause > 0 && this.pause < 1.1 ? 1 : this.phase === 'desk' && this.toPlace.length ? 0.8 : 0) - pose.reach) * Math.min(1, dt * 5);
    pose.give += ((this.phase === 'pay' ? 1 : 0) - pose.give) * Math.min(1, dt * 5);
    if (this.pause > 0) {
      this.pause -= dt;
      this.w.speed = Math.max(0, this.w.speed - dt * 5);
      if (this.facing !== null) this.w.face(this.facing, dt);
      if (this.pause <= 0) {
        this.facing = null;
        this.picked++;
        if (this.picked === 1 && this.toPlace.length > 2) this.human.hold('basket', this.toPlace.length);
      }
    } else if (!this.w.walk(dt, blocked)) {
      switch (this.phase) {
        case 'arrive':
          this.phase = 'browse';
          break;
        case 'browse': {
          if (this.pendingStop) {
            // At the shelf: turn to it and take something.
            this.pause = 1.6 + Math.random() * 1.4;
            this.facing = this.pendingStop.face;
            pose.reachY = this.pendingStop.shelfY + Math.random() * 0.5 - 0.2;
            this.pendingStop = null;
            break;
          }
          const stop = this.stops.shift();
          if (stop) {
            this.w.path = this.route(stop.at);
            this.pendingStop = stop;
          }
          break;
        }
        case 'line':
          if (this.slot === 0) {
            this.phase = 'desk';
            this.placeT = 0.5;
          } else this.w.face(0, dt);
          break;
        case 'leave':
          this.phase = 'gone';
          this.human.dispose();
          return;
      }
    }
    if (this.phase === 'desk' || this.phase === 'talk' || this.phase === 'wait' || this.phase === 'pay') {
      this.w.face(0, dt);
      if (this.phase === 'desk') this.placeOnDesk(dt);
      if (this.phase === 'wait') this.waited += dt;
      if (this.phase === 'pay') {
        this.payT -= dt;
        if (this.payT <= 0) this.depart(this.pendingBag);
      }
    }
    // Through the door: the chime.
    const insideNow = this.pos.z > this.layout.door.z - 0.6;
    if (insideNow !== this.inside) {
      this.inside = insideNow;
      this.onDoor?.();
    }
    // Where they look: at the shopkeeper near and at the desk, otherwise around.
    const near = this.phase === 'desk' || this.phase === 'talk' || this.phase === 'wait' || this.phase === 'pay' || (this.phase === 'line' && this.slot <= 1);
    pose.lookAt = near ? camera : this.phase === 'arrive' && this.pos.z > this.layout.walkZ + 0.5 ? camera : null;
    this.w.animate(dt);
  }

  private pendingStop: { at: Vector3; face: number; shelfY: number } | null = null;

  private placeOnDesk(dt: number): void {
    if (this.ready) return;
    this.placeT -= dt;
    if (this.placeT > 0) return;
    const next = this.toPlace.shift();
    if (!next) {
      this.ready = true;
      this.human.hold('none');
      this.human.pose.reach = 0;
      return;
    }
    next();
    this.placeT = 0.42;
  }

  /** Start or stop saying the bill. */
  talk(on: boolean): void {
    this.human.pose.talking = on;
    if (on) this.phase = 'talk';
    else if (this.phase === 'talk') this.phase = 'wait';
  }

  dispose(): void {
    this.human.dispose();
    this.phase = 'gone';
  }
}
