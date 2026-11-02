/**
 * The shop running, seen from behind the desk, on a street in daylight. Customers come
 * in waves: one or two at a time in a small shop, dozens in a big one, where other
 * cashiers work their own tills beside you. Those who come to your desk put the goods
 * down and say the bill out loud while the receipt prints; when they finish, the
 * accept button comes up. Everything paid lands in the till; the pink button saves it
 * all, and when the savings reach the goal the shop grows.
 */
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { Sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import { h } from '../ui/dom';
import { Hud } from '../ui/hud';
import { Card, showHowTo, showPrices, showRank, showUpgrade } from '../ui/overlays';
import { DecisionBar, Receipt } from '../ui/receipt';
import { SpeechOutput } from '../voice/speech';
import { pickQuality, View } from '../world/render';
import { buildShop, type Shop } from '../world/shop';
import { DayLight } from '../world/sky';
import { Customer, makePersona, Passerby, personaAgain } from './customers';
import { decide, fmt, LADDER, makeBill, STAGES, type Bill } from './economy';
import { billSpeech, keeperLine, type Speech } from './lines';
import type { Store } from './state';

/** Seconds a customer waits for a decision after finishing before giving up. */
const PATIENCE = 28;
/** The light of a fine late morning; the game has no clock. */
const DAYTIME = 10.5 * 60;
/** How many people can be in the shop at once, by quality (people cost drawing time). */
const CROWD_CAP = { high: 50, medium: 28, low: 14 };
/** Speaking rate used to follow speech when the voice gives no word timings (characters a second). */
const CHARS_PER_SECOND = 12.5;

interface Talk {
  c: Customer;
  speech: Speech;
  started: number;
  /** Characters spoken so far (from word boundaries when the voice reports them). */
  heard: number;
  boundaries: boolean;
  voiceDone: boolean;
  estimate: number;
  done: boolean;
}

export class Game {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.05, 400);
  readonly view: View;
  readonly sfx = new Sfx();
  readonly voice = new SpeechOutput();
  readonly rng = new Rng();
  readonly ui = h('div.ui');
  readonly daylight: DayLight;
  store!: Store;
  hud!: Hud;
  receipt!: Receipt;
  decision!: DecisionBar;
  shop: Shop;
  /** Multiplies time (for testing). */
  timeScale = 1;
  private customers: Customer[] = [];
  private walkers: Passerby[] = [];
  private talk: Talk | null = null;
  private deciding: Customer | null = null;
  private spawnT = 8;
  private walkerT = 3;
  private saveT = 5;
  private minuteT = 0;
  private minuteIncome = 0;
  /** Waves of customers: a quiet spell, an ordinary one, a rush. */
  private wave: { mult: number; left: number } = { mult: 1, left: 30 };
  private pendingUpgrade = false;
  private readonly stuck = new Map<Customer, number>();
  private modal = false;
  private modals: (() => void)[] = [];
  private paused = true;
  private last = performance.now();
  private t = 0;
  private debtId = 1;
  // Camera: where it looks, and the player's own glance (drag).
  private readonly look = new Vector3();
  private yawOff = 0;
  private pitchOff = 0;
  private dragIdle = 10;

  constructor(readonly root: HTMLElement) {
    this.view = new View(root, this.scene, this.camera, pickQuality());
    root.append(this.ui);
    this.daylight = new DayLight(this.scene, this.view.shadows, new Vector3(0, 0, -6));
    if (this.view.quality === 'medium') this.daylight.setShadowSize(1024);
    this.view.onDowngrade = () => this.rebuild();
    this.shop = buildShop(0, { shadows: this.view.shadows });
    this.scene.add(this.shop.group);
    this.shop.street.onPass = (d) => this.sfx.whoosh(d);
    this.look.copy(this.shop.layout.camera.look);
    this.daylight.set(DAYTIME);
    this.placeCamera();
    window.addEventListener('resize', () => {
      this.view.resize();
      this.placeCamera();
    });
    this.dragControls();
    this.view.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------------ camera

  private placeCamera(): void {
    const portrait = innerWidth < innerHeight;
    this.camera.fov = portrait ? 76 : 60;
    this.camera.updateProjectionMatrix();
  }

  private dragControls(): void {
    const el = this.view.renderer.domElement;
    let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, yaw: this.yawOff, pitch: this.pitchOff };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const k = 2.6 / Math.max(innerWidth, innerHeight);
      this.yawOff = Math.max(-1.3, Math.min(1.3, down.yaw + (e.clientX - down.x) * k));
      this.pitchOff = Math.max(-0.7, Math.min(0.5, down.pitch + (e.clientY - down.y) * k));
      this.dragIdle = 0;
    });
    const up = () => (down = null);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** Look at whoever is at the desk (and the goods), else down the shop to the door. */
  private updateCamera(dt: number): void {
    const L = this.shop.layout;
    const base = L.camera.pos;
    const portrait = innerWidth < innerHeight;
    // On a tall phone screen, step back a little so the customer fits between the bars.
    this.camera.position.set(base.x + Math.sin(this.t * 0.31) * 0.006, base.y + Math.sin(this.t * 1.6) * 0.004 + (portrait ? 0.08 : 0), base.z + (portrait ? 0.38 : 0));
    const at = this.customers.find((c) => c.lane === 0 && c.slot === 0 && (c.phase === 'desk' || c.phase === 'talk' || c.phase === 'wait' || c.phase === 'pay'));
    const target = new Vector3();
    if (at) target.set(at.pos.x * 0.6, Math.min(portrait ? 1.32 : 1.2, at.human.height * 0.82 - (portrait ? 0.08 : 0.15)), at.pos.z - 0.1);
    else {
      // Idle: down the aisle to the door, drifting toward whoever is moving about.
      target.copy(L.camera.look);
      const mover = this.customers.find((c) => c.lane === 0 && (c.phase === 'arrive' || c.phase === 'browse' || c.phase === 'line'));
      if (mover) target.x += Math.max(-2.5, Math.min(2.5, mover.pos.x)) * 0.35;
    }
    this.look.lerp(target, Math.min(1, dt * 2.2));
    this.dragIdle += dt;
    if (this.dragIdle > 4) {
      this.yawOff *= 1 - Math.min(1, dt * 1.5);
      this.pitchOff *= 1 - Math.min(1, dt * 1.5);
    }
    const dir = this.look.clone().sub(this.camera.position);
    const yaw = Math.atan2(dir.x, -dir.z) + this.yawOff;
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) - this.pitchOff;
    const lookAt = this.camera.position.clone().add(new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)));
    this.camera.lookAt(lookAt);
  }

  /** The point customers look at when they talk to the shopkeeper. */
  private get eyes(): Vector3 {
    return this.camera.position;
  }

  // ------------------------------------------------------------------ start

  start(store: Store, first: boolean): void {
    this.store = store;
    this.hud = new Hud(this.ui, store);
    this.receipt = new Receipt(this.ui);
    this.decision = new DecisionBar(this.hud.dock);
    this.hud.onSkip = () => this.skipTalk();
    this.hud.saveBtn.onclick = () => this.pressPink();
    this.hud.pricesBtn.onclick = () => this.openCard(() => showPrices(this.ui, this.store.s.stage));
    this.hud.soundBtn.onclick = () => {
      const muted = this.sfx.toggleMute();
      this.voice.enabled = !muted;
      if (muted) this.voice.cancel();
      this.hud.soundBtn.textContent = muted ? '🔇' : '🔊';
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !this.modal) {
        e.preventDefault();
        this.pressPink();
      }
    });
    store.on('rank', (e) => {
      const final = e.rank === LADDER.length - 1;
      const title = LADDER[e.rank].title[store.s.gender === 'm' ? 0 : 1];
      this.sfx.level();
      this.queueModal(() => showRank(this.ui, title, final, this.statsLine(), () => this.closeModal()));
    });
    this.setStage(store.s.stage);
    const s = store.s;
    const hello = first ? `أهلاً بيك يا ${s.name}! هذي بقالتك، بقالة شرق الإمارات. صغيرة، وما يجيها أحد كثير… بس بإذن الله بتكبر.` : `أهلاً بيك يا ${s.name}! ${s.gender === 'f' ? 'نوّرتي' : 'نوّرت'} البقالة. يلا نشتغل.`;
    this.hud.toast(hello, 'big');
    void this.voice.speak(hello, { gender: 'm', pitch: 1, rate: 1, key: 'sanad' });
    if (first) this.queueModal(() => showHowTo(this.ui, () => this.closeModal()));
    this.spawnT = first ? 9 : 6;
    this.paused = false;
  }

  private setStage(stage: number): void {
    for (const c of this.customers) c.dispose();
    for (const w of this.walkers) w.dispose();
    this.customers = [];
    this.walkers = [];
    this.talk = null;
    this.deciding = null;
    this.stuck.clear();
    this.receipt?.hide();
    this.decision?.hide();
    this.hud?.subtitle(null);
    this.shop.group.removeFromParent();
    this.shop = buildShop(stage, { shadows: this.view.shadows });
    this.shop.street.onPass = (d) => this.sfx.whoosh(d);
    this.scene.add(this.shop.group);
    this.daylight.focus.set(0, 0, this.shop.layout.walkZ - 2);
    this.daylight.set(DAYTIME);
    this.look.copy(this.shop.layout.camera.look);
  }

  /** After the renderer changes quality, rebuild so shadows match. */
  private rebuild(): void {
    if (this.view.quality === 'low') {
      this.daylight.sun.castShadow = false;
      if (this.store) this.setStage(this.store.s.stage);
    } else this.daylight.setShadowSize(1024);
  }

  // ------------------------------------------------------------------ loop

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (this.store && !this.paused && !this.modal) this.step(dt * this.timeScale);
    else if (!this.store) this.shop.update(dt, DAYTIME, 0, []);
    this.updateCamera(dt);
    this.view.render(dt);
  }

  step(dt: number): void {
    const s = this.store.s;
    const st = STAGES[s.stage];
    const L = this.shop.layout;

    // Branches and contracts pay in every minute.
    const passive = this.store.advance(dt);
    this.minuteIncome += passive;
    this.minuteT += dt;
    if (this.minuteT >= 60) {
      this.minuteT = 0;
      if (this.minuteIncome >= 1) this.hud.toast(`🏬 دخل الفروع والعقود: +${fmt(Math.round(this.minuteIncome))} بالدرج`, 'good');
      this.minuteIncome = 0;
    }
    if (passive) this.hud.refresh();
    const people = [...this.customers.map((c) => c.pos), ...this.walkers.map((w) => w.pos)];
    this.shop.update(dt, DAYTIME, 0, people);
    this.sfx.setOutside(Math.min(1, 0.4 + this.wave.mult * 0.4), 0);

    // Waves: a quiet spell (often just one person), an ordinary stretch, a rush.
    this.wave.left -= dt;
    if (this.wave.left <= 0) {
      const r = this.rng.next();
      this.wave = r < 0.3 ? { mult: 0.4, left: this.rng.range(20, 45) } : r < 0.72 ? { mult: 1, left: this.rng.range(30, 70) } : { mult: 1.8, left: this.rng.range(25, 50) };
    }
    const cap = CROWD_CAP[this.view.quality];
    // A small shop sees one to three people at a time; a big one, dozens.
    const target = Math.min(cap, st.crowd < 10 ? Math.min(st.crowd + 1, Math.max(1, Math.round(st.crowd * this.wave.mult))) : Math.max(3, Math.round(st.crowd * this.wave.mult)));
    const inside = this.customers.length;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && inside < target) {
      // Big shops fill quickly; a kiosk gets someone every little while.
      this.spawnT = (st.crowd >= 10 ? this.rng.range(0.35, 1.3) : this.rng.range(3, 9)) * (1.25 - s.rep * 0.1);
      this.spawnCustomer();
    }
    // Debtors come back (or don't).
    for (const d of [...s.debts]) {
      if (d.due > s.time) continue;
      s.debts.splice(s.debts.indexOf(d), 1);
      if (this.rng.next() < d.trust) {
        const bill: Bill = { kind: 'repay', lines: [], total: 0, cost: 0, pays: d.amount, note: noteFor(d.amount), pay: 'cash', debt: d.amount };
        this.spawn(bill, 0, personaAgain(this.rng, d.name, d.gender, d.look));
      } else {
        s.stats.lostDebts++;
        this.hud.toast(`${d.name} ${d.gender === 'f' ? 'ما رجعت تسدد دينها' : 'ما رجع يسدد دينه'} (${fmt(d.amount)}) 😅 الدين مخاطرة.`, 'bad');
      }
    }
    // People walking past outside.
    this.walkerT -= dt;
    if (this.walkerT <= 0 && this.walkers.length < 4) {
      this.walkerT = this.rng.range(5, 14);
      this.walkers.push(new Passerby(this.rng, this.scene, L));
    }
    for (const w of this.walkers) w.update(dt, this.eyes);
    this.walkers = this.walkers.filter((w) => !w.gone);

    // The lines: whoever has finished shopping joins their till's line in order.
    for (let k = 0; k < L.lanes.length; k++) {
      const serving = this.customers.find((c) => c.lane === k && c.slot === 0 && (c.phase === 'desk' || c.phase === 'talk' || c.phase === 'wait' || c.phase === 'pay' || c.phase === 'checkout'));
      let slot = serving ? 1 : 0;
      const room = k === 0 && s.stage < 3 ? 4 : 3;
      for (const c of this.customers) {
        if (c.lane !== k || c === serving) continue;
        if (!(c.shopped || c.phase === 'line')) continue;
        if (slot < room) c.goTo(slot++);
        else if (c.shopped && L.picks.length) c.browseMore(this.rng.pick(L.picks));
      }
      // The cashier looks up at whoever is being served, and rings it up.
      const cashier = k > 0 ? this.shop.cashiers[k - 1] : null;
      if (cashier) {
        const busy = serving && serving.phase === 'checkout';
        cashier.pose.reach += ((busy ? 0.7 : 0) - cashier.pose.reach) * Math.min(1, dt * 4);
        cashier.pose.reachY = 1.0;
        cashier.pose.lookAt = busy ? serving.human.root.position.clone().setY(1.5) : null;
      }
    }
    for (const c of this.customers) c.update(dt, this.eyes, this.blocked(c, dt));
    for (const c of this.customers) if (c.phase === 'gone') this.stuck.delete(c);
    this.customers = this.customers.filter((c) => c.phase !== 'gone');

    // The one at the desk: once the goods are down, they say the bill.
    const at = this.customers.find((c) => c.lane === 0 && c.slot === 0 && c.phase === 'desk' && c.ready);
    if (at && !this.talk && !this.deciding) this.startTalk(at);
    if (this.talk) this.followTalk();
    if (this.deciding) {
      const c = this.deciding;
      this.decision.setPatience(1 - c.waited / PATIENCE);
      if (c.waited > PATIENCE) this.giveUp(c);
    }

    // A full savings jar grows the shop, once nobody is mid-sentence at the desk.
    if (this.pendingUpgrade && !this.talk && !this.deciding) this.doUpgrade();
    this.saveT -= dt;
    if (this.saveT < 0) {
      this.saveT = 5;
      this.store.persist();
    }
  }

  /** Someone right in front: wait for them to move (but not for ever). */
  private blocked(c: Customer, dt: number): boolean {
    const b = this.ahead(c);
    const waited = b ? (this.stuck.get(c) ?? 0) + dt : 0;
    this.stuck.set(c, waited);
    return b && waited < 2.5;
  }

  private ahead(c: Customer): boolean {
    const hd = c.w.heading;
    const fx = Math.sin(hd);
    const fz = Math.cos(hd);
    for (const o of this.customers) {
      if (o === c || o.phase === 'gone') continue;
      const dx = o.pos.x - c.pos.x;
      const dz = o.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6 && (dx * fx + dz * fz) / (d || 1) > 0.6 && this.customers.indexOf(o) < this.customers.indexOf(c)) return true;
    }
    return false;
  }

  /** A new customer, sent to your desk or to another cashier. */
  private spawnCustomer(): void {
    const lanes = this.shop.layout.lanes.length;
    let lane = 0;
    if (lanes > 1) {
      // Your desk takes its share while its line is short; the other tills take the rest.
      const mine = this.customers.filter((c) => c.lane === 0 && c.phase !== 'leave').length;
      if (mine >= 3 || !this.rng.chance(1.4 / lanes)) {
        const load = (k: number) => this.customers.filter((c) => c.lane === k && c.phase !== 'leave').length;
        lane = 1;
        for (let k = 2; k < lanes; k++) if (load(k) < load(lane)) lane = k;
      }
    }
    const s = this.store.s;
    // Other tills take ordinary shopping; children and credit come to you.
    const bill = lane === 0 ? makeBill(this.rng, s.stage) : makeBill(this.rng, s.stage, this.rng.chance(0.75) ? 'normal' : 'big');
    this.spawn(bill, lane);
  }

  private spawn(bill: Bill, lane: number, persona = makePersona(this.rng, bill.kind)): void {
    const c = new Customer(persona, bill, this.scene, this.shop.layout, this.shop.desk, this.rng, lane);
    this.customers.push(c);
    // The door chime rings each time someone goes through it (not for every one of a crowd).
    c.onDoor = () => {
      if (this.customers.length < 8 || this.rng.chance(0.25)) this.sfx.doorChime();
    };
    c.onPaid = (who) => this.paidElsewhere(who);
  }

  /** Someone paid at another cashier's till: the money goes in your till all the same. */
  private paidElsewhere(c: Customer): void {
    const money = c.bill.total;
    this.store.till(money);
    this.store.s.stats.customers++;
    const lane = this.shop.layout.lanes[c.lane];
    if (lane) {
      const p = new Vector3(lane.x, 1.3, this.shop.layout.deskZ).project(this.camera);
      if (p.z < 1 && Math.abs(p.x) < 1.05) this.hud.pop(((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight, money);
    }
    if (this.rng.chance(0.5)) this.sfx.register();
    this.hud.refresh();
  }

  // ------------------------------------------------------------------ the conversation

  private startTalk(c: Customer): void {
    const s = this.store.s;
    const speech = billSpeech(this.rng, c.bill, c.persona, s.gender);
    const estimate = speech.text.length / CHARS_PER_SECOND + 0.6;
    this.talk = { c, speech, started: this.t, heard: 0, boundaries: false, voiceDone: false, estimate, done: false };
    c.talk(true);
    this.receipt.begin(c.bill, c.persona, s.name, s.stage);
    this.shop.desk.screen([], 0, 'جاري التسجيل…');
    this.shop.desk.paper(0.05);
    const talk = this.talk;
    void this.voice
      .speak(speech.text, { gender: c.persona.gender, pitch: c.persona.pitch, rate: 0.98, key: c.persona.key }, (i) => {
        talk.boundaries = true;
        talk.heard = Math.max(talk.heard, i);
      })
      .then(() => (talk.voiceDone = true));
  }

  /** Follow the speech: subtitles word by word, the receipt printing each item as it is named. */
  private followTalk(): void {
    const k = this.talk!;
    const elapsed = this.t - k.started;
    const len = k.speech.text.length;
    // A voice that ended almost at once did not really speak: follow the clock instead.
    const voiceWorked = k.voiceDone ? k.boundaries || elapsed > k.estimate * 0.45 : true;
    let heard = k.boundaries ? k.heard : Math.min(len, elapsed * CHARS_PER_SECOND);
    const finished = (k.voiceDone && voiceWorked) || (!this.voice.enabled && elapsed >= k.estimate) || elapsed >= k.estimate * 1.8 + 2;
    if (finished) heard = len;
    else if (k.voiceDone && !voiceWorked) heard = Math.min(len, elapsed * CHARS_PER_SECOND);
    this.hud.subtitle(k.c.persona.name, k.speech.text, heard);
    const b = k.c.bill;
    for (const m of k.speech.marks)
      if (m.at <= heard + 6 && this.receipt.print(m.line)) {
        this.sfx.beep();
        this.sfx.printer(0.25);
        this.shop.desk.screen(b.lines.slice(0, m.line + 1), sumLines(b, m.line + 1), 'جاري التسجيل…');
        this.shop.desk.paper(0.15 + (0.6 * (m.line + 1)) / Math.max(1, b.lines.length));
      }
    if (finished || (!k.voiceDone && heard >= len && !k.boundaries && elapsed >= k.estimate)) this.endTalk();
  }

  /** Tap the subtitles: hear no more, decide now. */
  private skipTalk(): void {
    if (!this.talk) return;
    this.voice.cancel();
    this.talk.voiceDone = true;
    this.talk.boundaries = true;
    this.talk.heard = this.talk.speech.text.length;
    this.endTalk();
  }

  private endTalk(): void {
    const k = this.talk;
    if (!k || k.done) return;
    k.done = true;
    this.talk = null;
    const c = k.c;
    const b = c.bill;
    c.talk(false);
    this.hud.subtitle(c.persona.name, k.speech.text, k.speech.text.length);
    this.receipt.finish();
    this.sfx.printer(0.6);
    this.shop.desk.paper(1);
    const how = b.kind === 'credit' ? 'دين — على الحساب' : b.pay === 'card' ? 'الدفع: بطاقة' : b.kind === 'repay' ? `سداد دين: ${fmt(b.debt ?? 0)}` : `نقداً: ${b.note} درهم`;
    this.shop.desk.screen(b.lines, b.total, how);
    if (b.pay === 'card' && b.kind !== 'credit') this.shop.desk.terminal('card');
    else if (b.kind !== 'credit') this.shop.desk.note(b.note, b.kind === 'fake');
    if (b.kind === 'credit') this.shop.desk.debtBook(true);
    this.deciding = c;
    c.waited = 0;
    this.sfx.pop();
    this.decision.show(() => this.settle(c), b.kind === 'repay' ? '✅ استلم' : '✅ قبول');
  }

  private giveUp(c: Customer): void {
    this.deciding = null;
    this.decision.hide();
    this.store.stars(-0.3);
    this.hud.toast(`${c.persona.name} ${c.persona.gender === 'f' ? 'ملّت من الانتظار وطلعت' : 'ملّ من الانتظار وطلع'} ⏳`, 'bad');
    this.say(c, 'خلاص، بروح.');
    this.clearDesk();
    c.settle(false, 'cross', false);
  }

  /** You take the bill: everything paid goes in the till. */
  private settle(c: Customer): void {
    if (this.deciding !== c) return;
    this.deciding = null;
    const s = this.store.s;
    const b = c.bill;
    const k = b.kind;
    const out = decide(b, { she: c.persona.gender === 'f', keeperShe: s.gender === 'f' });
    if (out.money) this.store.till(out.money);
    this.store.stars(out.rep);
    s.stats.customers++;
    s.stats.accepted++;
    if (k === 'repay') s.stats.repaid += b.debt ?? 0;
    if (out.debt) s.debts.push({ id: this.debtId++, name: c.persona.name, amount: out.debt, trust: c.persona.trust, due: s.time + this.rng.range(150, 420), gender: c.persona.gender, look: c.persona.look });

    // What the shopkeeper says, then the customer's reply.
    const mine = keeperLine(this.rng, b, c.persona);
    this.hud.subtitle('أنت', mine, mine.length, true);
    if (b.pay === 'card' && k !== 'credit') {
      this.sfx.cardBeep();
      this.shop.desk.terminal('ok');
    } else if (k !== 'credit') this.sfx.drawer();
    if (out.money) {
      const p = this.shop.desk.itemZone.clone().project(this.camera);
      this.hud.pop(((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight - 40, out.money);
    }
    this.hud.toast(out.text, 'good');
    setTimeout(() => this.say(c, out.says), 1300);
    this.clearDesk();
    c.settle(true, 'happy', k !== 'credit');
    this.hud.refresh();
    this.store.persist();
  }

  /** Tidy the desk once they have gone: the note into the drawer, the screen back to idle. */
  private clearDesk(): void {
    setTimeout(() => {
      this.shop.desk.note(null);
      this.shop.desk.terminal('idle');
      this.shop.desk.debtBook(false);
      this.shop.desk.paper(0);
      this.shop.desk.screen([], 0, 'ضريبة القيمة المضافة 5٪ مشمولة');
      this.receipt.hide();
      if (!this.talk) this.hud.subtitle(null);
    }, 2600);
  }

  /** A customer's short reply, spoken and subtitled. */
  private say(c: Customer, text: string): void {
    if (!text || text === '…' || this.talk) return;
    this.hud.subtitle(c.persona.name, text, text.length);
    c.human.pose.talking = true;
    void this.voice.speak(text, { gender: c.persona.gender, pitch: c.persona.pitch, rate: 1.02, key: c.persona.key }).then(() => (c.human.pose.talking = false));
    setTimeout(() => (c.human.pose.talking = false), 2500);
  }

  // ------------------------------------------------------------------ the pink button

  /** Save everything in the till, every time. A full jar grows the shop by itself. */
  private pressPink(): void {
    if (!this.store || this.modal) return;
    this.sfx.unlock();
    const moved = this.store.save();
    if (!moved) {
      this.hud.nudge();
      this.hud.toast('الدرج فاضي. لما يدفع زبون، اضغط وادّخر 💗');
      return;
    }
    this.sfx.save();
    const r = this.hud.saveBtn.getBoundingClientRect();
    this.hud.pop(r.left + r.width / 2, r.top - 10, moved);
    const cost = this.store.nextCost;
    if (this.store.canUpgrade) {
      this.hud.toast(`🎉 ادّخرت ${fmt(moved)}، وكمل المبلغ! البقالة بتتطور.`, 'big');
      this.pendingUpgrade = true;
    } else if (cost !== null) this.hud.toast(`💗 ادّخرت ${fmt(moved)}. بالادخار ${fmt(Math.floor(this.store.s.savings))}، باقي ${fmt(Math.ceil(cost - this.store.s.savings))} وتصير ${STAGES[this.store.s.stage + 1].name}.`, 'good');
    else this.hud.toast(`💗 ادّخرت ${fmt(moved)}. بالادخار ${fmt(Math.floor(this.store.s.savings))}.`, 'good');
    this.hud.refresh();
    this.store.persist();
  }

  /** The savings reached the goal: the shop moves up a stage (maybe more than one). */
  private doUpgrade(): void {
    this.pendingUpgrade = false;
    if (!this.store.upgrade()) return;
    while (this.store.canUpgrade) this.store.upgrade();
    const stage = this.store.s.stage;
    this.sfx.level();
    this.setStage(stage);
    this.hud.refresh();
    this.store.persist();
    void this.voice.speak(`مبروك! صارت بقالتك ${STAGES[stage].name}.`, { gender: 'm', pitch: 1, rate: 1, key: 'sanad' });
    this.queueModal(() => showUpgrade(this.ui, stage, () => this.closeModal()));
  }

  // ------------------------------------------------------------------ cards

  private queueModal(open: () => void): void {
    this.modals.push(open);
    if (!this.modal) this.nextModal();
  }

  private nextModal(): void {
    const open = this.modals.shift();
    if (!open) return;
    this.modal = true;
    open();
  }

  private closeModal(): void {
    this.modal = false;
    this.last = performance.now();
    this.nextModal();
  }

  private openCard(make: () => Card): void {
    if (this.modal) return;
    this.modal = true;
    make().onClose = () => this.closeModal();
  }

  private statsLine(): string {
    const st = this.store.s.stats;
    return `خدمت ${st.customers} زبون، وجمعت أرباح ${fmt(Math.round(st.profit))}، وأرباح الادخار ${fmt(Math.round(st.interest))}.`;
  }
}

function sumLines(b: Bill, n: number): number {
  return Math.round(b.lines.slice(0, n).reduce((a, l) => a + l.product.price * l.qty, 0) * 100) / 100;
}

function noteFor(amount: number): number {
  for (const n of [5, 10, 20, 50, 100, 200, 500, 1000]) if (n >= amount) return n;
  return Math.ceil(amount / 1000) * 1000;
}
