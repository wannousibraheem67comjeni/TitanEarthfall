/**
 * Customers: who they are (name, look, voice, how far they can be trusted with a
 * debt), and how they move: in through the door, along the shelves with a basket,
 * into the line, the goods onto the counter one by one, then out with a bag (or
 * empty-handed when refused).
 */
import { CylinderGeometry, Group, Mesh, TorusGeometry, Vector3, type Scene } from 'three';
import { dampAngle } from '../core/math';
import type { Rng } from '../core/rng';
import { Character } from '../world/characters';
import type { Look } from '../world/look';
import { productGeometry, solid, type ShopLayout } from '../world/shop';
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

const SKIN = ['#e7c3a0', '#c99a72', '#a8754f', '#7c5235'];

type Preset = { names: string[]; gender: 'm' | 'f'; trust: [number, number]; look: (rng: Rng) => Look; pitch: number };

const PRESETS: Preset[] = [
  {
    names: ['أبو سعيد', 'بو راشد', 'سالم', 'خليفة', 'مطر', 'عبيد', 'سيف'],
    gender: 'm',
    trust: [0.6, 0.95],
    pitch: 0.92,
    look: (r) => ({ build: 'man', outfit: 'kandura', skin: r.pick(SKIN.slice(0, 3)), primary: '#fbfaf6', secondary: '#eeeae2', head: 'ghutra', headColor: r.pick(['#ffffff', '#ffffff', '#d64545']), beard: r.pick(['full', 'short', 'moustache']), beardColor: '#1a1410', height: r.range(1.68, 1.84) }),
  },
  {
    names: ['أم سعيد', 'أم خالد', 'مريم', 'عائشة', 'شمّا', 'حصة', 'موزة'],
    gender: 'f',
    trust: [0.6, 0.95],
    pitch: 1.12,
    look: (r) => ({ build: 'woman', outfit: 'abaya', skin: r.pick(SKIN.slice(0, 3)), primary: '#1b191d', secondary: r.pick(['#7a5aa6', '#c9a54a', '#3a3a3a']), head: 'shayla', headColor: '#16141a', beard: 'none', beardColor: '#000', height: r.range(1.56, 1.68) }),
  },
  {
    names: ['رامو', 'محمد علي', 'جوزيف', 'ريان', 'كريم', 'أبو يوسف', 'فيصل'],
    gender: 'm',
    trust: [0.3, 0.8],
    pitch: 1.0,
    look: (r) => ({ build: 'man', outfit: r.pick(['casual', 'overalls', 'tunic']), skin: r.pick(SKIN), primary: r.pick(['#2b4c7e', '#3f9150', '#c2453c', '#e0a526', '#5a5d63']), secondary: r.pick(['#2a2a2e', '#3b3b3b', '#1f3b5a']), head: r.pick(['cap', 'hair', 'hair']), headColor: r.pick(['#2a1d14', '#d64545', '#1f6fd0']), beard: r.pick(['short', 'none', 'moustache']), beardColor: '#2a1d14', height: r.range(1.66, 1.82), glasses: r.chance(0.2) }),
  },
  {
    names: ['ماريا', 'سارة', 'رنا', 'ليلى', 'جوي'],
    gender: 'f',
    trust: [0.4, 0.85],
    pitch: 1.2,
    look: (r) => ({ build: 'woman', outfit: 'casual', skin: r.pick(SKIN), primary: r.pick(['#c46aa8', '#3f86b8', '#e0a526', '#4f7f73']), secondary: r.pick(['#2a2a2e', '#f4f4f2']), head: r.pick(['hair', 'shayla']), headColor: r.pick(['#2a1d14', '#1b191d', '#7a5aa6']), beard: 'none', beardColor: '#000', height: r.range(1.55, 1.7) }),
  },
  {
    names: ['الحجي مبارك', 'الشايب أبو علي', 'بو حمد'],
    gender: 'm',
    trust: [0.8, 1],
    pitch: 0.78,
    look: (r) => ({ build: 'old', outfit: 'kandura', skin: r.pick(SKIN.slice(0, 3)), primary: '#f2efe8', secondary: '#e6e0d4', head: 'ghutra', headColor: '#ffffff', beard: 'full', beardColor: '#cfcac2', height: r.range(1.62, 1.72), cane: true, glasses: r.chance(0.5) }),
  },
];

const KIDS: Preset = {
  names: ['حمدان الصغير', 'مايد', 'عبودي', 'سلامة', 'نورة الصغيرة'],
  gender: 'm',
  trust: [0.5, 0.5],
  pitch: 1.55,
  look: (r) => ({ build: 'boy', outfit: r.pick(['kandura', 'casual']), skin: r.pick(SKIN), primary: r.pick(['#fbfaf6', '#e85aa0', '#3f86b8', '#f2c230']), secondary: '#2a2a2e', head: r.pick(['hair', 'kufi', 'cap']), headColor: r.pick(['#2a1d14', '#ffffff', '#d8352b']), beard: 'none', beardColor: '#000', height: r.range(1.12, 1.3) }),
};

export function makePersona(rng: Rng, kind: Kind): Persona {
  const p = kind === 'kid' ? KIDS : rng.weighted(PRESETS, [3, 3, 4, 2, 1]);
  const name = rng.pick(p.names);
  return { name, look: p.look(rng), gender: p.gender, pitch: p.pitch * rng.range(0.95, 1.05), key: `cust-${name}`, trust: rng.range(p.trust[0], p.trust[1]), child: kind === 'kid' };
}

/** The same person again (a debtor coming back to pay). */
export function personaAgain(rng: Rng, name: string, gender: 'm' | 'f', look?: Look): Persona {
  const preset = PRESETS.find((p) => p.gender === gender && p.names.includes(name)) ?? PRESETS[gender === 'f' ? 1 : 0];
  return { name, look: look ?? preset.look(rng), gender, pitch: preset.pitch, key: `cust-${name}`, trust: 1, child: false };
}

export type Phase = 'enter' | 'shop' | 'line' | 'counter' | 'leave' | 'gone';

const SPEED = 1.35;

export class Customer {
  readonly char: Character;
  phase: Phase = 'enter';
  /** Waypoints still to walk. */
  private path: Vector3[] = [];
  private pause = 0;
  private face: number | null = null;
  heading = Math.PI;
  speed = 0;
  /** Seconds waiting at the counter. */
  waited = 0;
  /** True once every item is on the counter and the bill can be shown. */
  ready = false;
  slot = -1;
  private readonly basket: Group;
  private bag: Mesh | null = null;
  private readonly onCounter: Mesh[] = [];
  private placeT = 0;
  private placed = 0;
  talking = false;
  mood: 'happy' | 'sad' | 'neutral' = 'neutral';

  constructor(
    readonly persona: Persona,
    readonly bill: Bill,
    private readonly scene: Scene,
    private readonly layout: ShopLayout,
    rng: Rng,
  ) {
    this.char = new Character(persona.look);
    this.char.root.position.copy(layout.outside);
    scene.add(this.char.root);
    this.basket = makeBasket();
    this.basket.visible = false;
    this.char.handR.add(this.basket);
    // In through the door, then along one or two shelves (debtors come straight to the till).
    this.path.push(layout.door.clone());
    if (bill.kind !== 'repay' && layout.picks.length) {
      const n = Math.min(layout.picks.length, rng.int(1, bill.lines.length > 2 ? 3 : 2));
      for (const p of rng.shuffle(layout.picks).slice(0, n)) {
        this.path.push(new Vector3(0, 0, p.at.z), p.at.clone());
        this.stops.push({ at: p.at.clone(), face: p.face });
      }
    }
  }

  private readonly stops: { at: Vector3; face: number }[] = [];

  get pos(): Vector3 {
    return this.char.root.position;
  }

  /** Join the line (or move up in it). */
  goTo(slot: number): void {
    if (this.slot === slot && this.phase !== 'shop') return;
    this.slot = slot;
    const q = this.layout.queue(slot);
    this.path = [new Vector3(0, 0, Math.min(this.pos.z, q.z - 0.2)), q];
    this.phase = 'line';
  }

  /** Accepted: the goods go into a bag. Refused: they go back on the shelf. */
  leave(accepted: boolean): void {
    for (const m of this.onCounter) m.removeFromParent();
    this.onCounter.length = 0;
    this.basket.visible = false;
    if (accepted && this.bill.kind !== 'repay' && this.bill.kind !== 'fake') {
      this.bag = new Mesh(new CylinderGeometry(0.16, 0.13, 0.32, 10).translate(0, -0.12, 0), solid('#f7f2ea', 0.85));
      this.char.handR.add(this.bag);
    }
    this.mood = accepted ? 'happy' : 'sad';
    this.phase = 'leave';
    this.ready = false;
    this.path = [new Vector3(0, 0, this.pos.z - 0.6), this.layout.door.clone(), this.layout.outside.clone()];
  }

  update(dt: number): void {
    if (this.phase === 'gone') return;
    if (this.pause > 0) {
      this.pause -= dt;
      this.speed = 0;
      if (this.face !== null) this.heading = dampAngle(this.heading, this.face, 6, dt);
      if (this.pause <= 0) {
        this.face = null;
        this.basket.visible = true;
      }
    } else if (this.path.length) {
      const t = this.path[0];
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) {
        this.pos.set(t.x, 0, t.z);
        this.path.shift();
        const stop = this.stops.find((s) => s.at.distanceTo(t) < 0.01);
        if (stop) {
          this.pause = 1.1 + Math.random() * 0.8;
          this.face = stop.face;
          this.stops.splice(this.stops.indexOf(stop), 1);
        }
      } else {
        this.speed = SPEED;
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 9, dt);
        const step = Math.min(d, SPEED * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
      }
    } else {
      this.speed = 0;
      if (this.phase === 'enter') this.phase = 'shop';
      else if (this.phase === 'line' && this.slot === 0) {
        this.phase = 'counter';
        this.placeT = 0.3;
      } else if (this.phase === 'leave') {
        this.phase = 'gone';
        this.char.root.removeFromParent();
        return;
      }
      if (this.phase === 'line' || this.phase === 'counter') this.heading = dampAngle(this.heading, 0, 6, dt);
    }
    if (this.phase === 'counter') this.placeOnCounter(dt);
    this.char.root.rotation.y = this.heading;
    this.char.update(dt, { speed: this.speed, talking: this.talking, activity: this.mood === 'happy' && this.phase === 'leave' ? 'wave' : 'none', riding: 'none', sitting: false, airborne: false });
  }

  /** Put the goods on the counter, one every fraction of a second. */
  private placeOnCounter(dt: number): void {
    this.waited += dt;
    if (this.ready) return;
    this.placeT -= dt;
    if (this.placeT > 0) return;
    const lines = this.bill.lines;
    const total = Math.min(8, lines.reduce((n, l) => n + Math.min(l.qty, 3), 0));
    if (this.placed >= total || this.bill.kind === 'repay') {
      this.ready = true;
      this.basket.visible = false;
      return;
    }
    // Which line this item belongs to.
    let k = this.placed;
    let line = lines[0];
    for (const l of lines) {
      const c = Math.min(l.qty, 3);
      if (k < c) {
        line = l;
        break;
      }
      k -= c;
    }
    const big = line.product.shape === 'crate' || line.product.shape === 'tray';
    const m = new Mesh(productGeometry(line.product, big ? 0.26 : 0.3), solid(line.product.color, 0.55));
    const half = this.layout.counterHalf;
    const span = half * 2 - 1.3;
    const x = -half + 0.55 + ((this.placed + 0.5) / total) * span;
    m.position.set(x, 1.02, this.layout.counterZ - 0.08 + (this.placed % 2) * 0.14);
    m.rotation.y = (Math.random() - 0.5) * 0.6;
    m.castShadow = true;
    this.scene.add(m);
    this.onCounter.push(m);
    this.placed++;
    this.placeT = 0.28;
  }

  dispose(): void {
    for (const m of this.onCounter) m.removeFromParent();
    this.char.root.removeFromParent();
    this.phase = 'gone';
  }
}

function makeBasket(): Group {
  const g = new Group();
  const red = solid('#d8352b', 0.6);
  const body = new Mesh(new CylinderGeometry(0.17, 0.13, 0.16, 12, 1, true), red);
  body.position.y = -0.2;
  const handle = new Mesh(new TorusGeometry(0.13, 0.012, 6, 16, Math.PI), red);
  handle.position.y = -0.12;
  g.add(body, handle);
  // A few goods poking out.
  const goods = ['#f2c230', '#3f86b8', '#f4f4f0'];
  goods.forEach((c, i) => {
    const m = new Mesh(new CylinderGeometry(0.035, 0.035, 0.14, 8), solid(c, 0.6));
    m.position.set(-0.06 + i * 0.06, -0.14, 0);
    g.add(m);
  });
  return g;
}
