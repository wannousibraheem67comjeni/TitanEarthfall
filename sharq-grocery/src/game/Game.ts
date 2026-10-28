/**
 * The shop running, seen from behind the desk. Shop time passes (one minute a second,
 * seven in the morning to eleven at night) with busy and quiet hours. Now and then
 * someone walks in, shops, queues, puts the goods on the desk and says the bill out
 * loud while the receipt prints; when they finish, the accept and refuse buttons come
 * up. The pink button saves the till or, when the savings are enough, grows the shop.
 */
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { Sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import { h } from '../ui/dom';
import { Hud } from '../ui/hud';
import { Card, showDaySummary, showHowTo, showPrices, showRank, showUpgrade } from '../ui/overlays';
import { DecisionBar, Receipt } from '../ui/receipt';
import { SpeechOutput } from '../voice/speech';
import { pickQuality, View } from '../world/render';
import { buildShop, type Shop } from '../world/shop';
import { DayLight } from '../world/sky';
import { CLOSE, LAST_IN, rush, RUSH_AVERAGE } from './clock';
import { Customer, makePersona, Passerby, personaAgain } from './customers';
import { decide, fmt, LADDER, makeBill, STAGES, type Bill } from './economy';
import { billSpeech, keeperLine, type Speech } from './lines';
import type { Store } from './state';

/** Seconds a customer waits for a decision after finishing before giving up. */
const PATIENCE = 28;
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
  private hourT = 0;
  private hourIncome = 0;
  private closing = false;
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
    this.daylight.set(8 * 60);
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
    const at = this.customers.find((c) => c.slot === 0 && (c.phase === 'desk' || c.phase === 'talk' || c.phase === 'wait' || c.phase === 'pay'));
    const target = new Vector3();
    if (at) target.set(at.pos.x * 0.6, Math.min(portrait ? 1.32 : 1.2, at.human.height * 0.82 - (portrait ? 0.08 : 0.15)), at.pos.z - 0.1);
    else {
      // Idle: down the aisle to the door, drifting toward whoever is moving about.
      target.copy(L.camera.look);
      const mover = this.customers.find((c) => c.phase === 'arrive' || c.phase === 'browse' || c.phase === 'line');
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
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !this.modal && !this.decision.open) {
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
    this.receipt?.hide();
    this.decision?.hide();
    this.hud?.subtitle(null);
    this.hud?.showPink(true);
    this.shop.group.removeFromParent();
    this.shop = buildShop(stage, { shadows: this.view.shadows });
    this.shop.street.onPass = (d) => this.sfx.whoosh(d);
    this.scene.add(this.shop.group);
    this.daylight.focus.set(0, 0, this.shop.layout.walkZ - 2);
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
    else if (!this.store) this.shop.update(dt, 8 * 60, 0, []);
    this.updateCamera(dt);
    this.view.render(dt);
  }

  step(dt: number): void {
    const s = this.store.s;
    const st = STAGES[s.stage];
    const L = this.shop.layout;

    // Shop time, branch income by the hour.
    const passive = this.store.advance(dt);
    this.hourIncome += passive;
    this.hourT += dt;
    if (this.hourT >= 60) {
      this.hourT = 0;
      if (this.hourIncome >= 1) this.hud.toast(`🏬 دخل الفروع والعقود هالساعة: +${fmt(Math.round(this.hourIncome))}`, 'good');
      this.hourIncome = 0;
      this.hud.refresh();
    }
    this.hud.clock();
    const night = this.daylight.set(s.minute);
    // The sky's share of the ambient light fades after sunset; the shop's own lights carry on.
    this.scene.environmentIntensity = 0.18 + 0.3 * (1 - night);
    const people = [...this.customers.map((c) => c.pos), ...this.walkers.map((w) => w.pos)];
    this.shop.update(dt, s.minute, night, people);
    this.sfx.setOutside(rush(s.minute) / 1.6, night);

    // Someone new, now and then: busier at rush hours and with more stars.
    const inside = this.customers.length;
    const maxIn = 2 + Math.floor(s.stage / 2);
    this.spawnT -= dt;
    if (this.spawnT <= 0 && inside < maxIn && s.minute < LAST_IN) {
      const busy = rush(s.minute) / RUSH_AVERAGE;
      const stars = (1.5 - s.rep * 0.15) / 1.125;
      this.spawnT = (st.spawn / Math.max(0.3, busy)) * stars * this.rng.range(0.6, 1.4);
      this.spawn(makeBill(this.rng, s.stage));
    }
    // Debtors come back (or don't).
    for (const d of [...s.debts]) {
      if (d.due > s.time || s.minute >= LAST_IN) continue;
      s.debts.splice(s.debts.indexOf(d), 1);
      if (this.rng.next() < d.trust) {
        const bill: Bill = { kind: 'repay', lines: [], total: 0, cost: 0, pays: d.amount, note: noteFor(d.amount), pay: 'cash', debt: d.amount };
        this.spawn(bill, personaAgain(this.rng, d.name, d.gender, d.look));
      } else {
        s.stats.lostDebts++;
        this.hud.toast(`${d.name} ${d.gender === 'f' ? 'ما رجعت تسدد دينها' : 'ما رجع يسدد دينه'} (${fmt(d.amount)}) 😅 الدين مخاطرة.`, 'bad');
      }
    }
    // People walking past outside.
    this.walkerT -= dt;
    if (this.walkerT <= 0 && this.walkers.length < 4) {
      this.walkerT = this.rng.range(5, 16) / Math.max(0.3, rush(s.minute));
      if (s.minute < CLOSE - 30 || this.rng.chance(0.3)) this.walkers.push(new Passerby(this.rng, this.scene, L));
    }
    for (const w of this.walkers) w.update(dt, this.eyes);
    this.walkers = this.walkers.filter((w) => !w.gone);

    // The line: whoever has finished shopping joins in order; the desk is slot 0.
    const atDesk = this.customers.find((c) => c.slot === 0 && (c.phase === 'desk' || c.phase === 'talk' || c.phase === 'wait' || c.phase === 'pay'));
    let slot = atDesk ? 1 : 0;
    for (const c of this.customers) {
      if (c === atDesk) continue;
      if (c.shopped || c.phase === 'line') c.goTo(slot++);
    }
    for (const c of this.customers) c.update(dt, this.eyes, this.blocked(c));
    this.customers = this.customers.filter((c) => c.phase !== 'gone');

    // The one at the desk: once the goods are down, they say the bill.
    const at = this.customers.find((c) => c.slot === 0 && c.phase === 'desk' && c.ready);
    if (at && !this.talk && !this.deciding) this.startTalk(at);
    if (this.talk) this.followTalk();
    if (this.deciding) {
      const c = this.deciding;
      this.decision.setPatience(1 - c.waited / PATIENCE);
      if (c.waited > PATIENCE) this.giveUp(c);
    }

    // Closing time.
    if (s.minute >= CLOSE && !this.closing && this.customers.length === 0) this.closeDay();
    this.saveT -= dt;
    if (this.saveT < 0) {
      this.saveT = 5;
      this.store.persist();
    }
  }

  /** Someone right in front: wait for them to move. */
  private blocked(c: Customer): boolean {
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

  private spawn(bill: Bill, persona = makePersona(this.rng, bill.kind)): void {
    const c = new Customer(persona, bill, this.scene, this.shop.layout, this.shop.desk, this.rng);
    this.customers.push(c);
    // The door chime rings each time they go through it.
    c.onDoor = () => this.sfx.doorChime();
  }

  // ------------------------------------------------------------------ the conversation

  private startTalk(c: Customer): void {
    const s = this.store.s;
    const speech = billSpeech(this.rng, c.bill, c.persona, s.gender, s.minute);
    const estimate = speech.text.length / CHARS_PER_SECOND + 0.6;
    this.talk = { c, speech, started: this.t, heard: 0, boundaries: false, voiceDone: false, estimate, done: false };
    c.talk(true);
    this.receipt.begin(c.bill, c.persona, s.name, s.stage, s.day, s.minute);
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
    this.hud.showPink(false);
    this.sfx.pop();
    this.decision.show(() => this.settle(c, true), b.kind === 'repay' ? '✅ استلم' : '✅ قبول');
  }

  private giveUp(c: Customer): void {
    this.deciding = null;
    this.decision.hide();
    this.hud.showPink(true);
    this.store.stars(-0.3);
    this.hud.toast(`${c.persona.name} ${c.persona.gender === 'f' ? 'ملّت من الانتظار وطلعت' : 'ملّ من الانتظار وطلع'} ⏳`, 'bad');
    this.say(c, c.persona.gender === 'f' ? 'خلاص، بروح.' : 'خلاص، بروح.');
    this.clearDesk(c, false);
    c.settle(false, 'cross', false);
  }

  private settle(c: Customer, accept: boolean): void {
    if (this.deciding !== c) return;
    this.deciding = null;
    const s = this.store.s;
    const b = c.bill;
    const out = decide(b, accept, this.rng.next(), { she: c.persona.gender === 'f', keeperShe: s.gender === 'f' });
    if (out.money) this.store.till(out.money);
    this.store.stars(out.rep);
    s.stats.customers++;
    s.today.customers++;
    if (accept) {
      s.stats.accepted++;
      s.today.accepted++;
    } else {
      s.stats.refused++;
      s.today.refused++;
    }
    const k = b.kind;
    const trick = k === 'fake' || k === 'trick' || k === 'coupon';
    if (!accept && trick) {
      s.stats.caught++;
      s.today.caught++;
    }
    if (accept && trick) s.stats.fooled++;
    if (k === 'repay') s.stats.repaid += b.debt ?? 0;
    if (out.money > 0) {
      s.today.profit += out.money;
      s.today.sales += k === 'repay' ? b.debt ?? 0 : out.money > 0 ? (accept ? b.pays : b.total) : 0;
    } else if (out.money < 0) s.today.profit += out.money;
    if (out.debt) s.debts.push({ id: this.debtId++, name: c.persona.name, amount: out.debt, trust: c.persona.trust, due: s.time + this.rng.range(150, 420), gender: c.persona.gender, look: c.persona.look });

    // What the shopkeeper says, then the customer's reply.
    const mine = keeperLine(this.rng, b, accept, c.persona, s.gender);
    this.hud.subtitle('أنت', mine, mine.length, true);
    const paid = out.money > 0 || (accept && (k === 'fake' || k === 'credit'));
    const takesGoods = accept ? k !== 'fake' : out.money > 0;
    if (accept && b.pay === 'card' && k !== 'credit') {
      this.sfx.cardBeep();
      this.shop.desk.terminal('ok');
    } else if (paid && k !== 'credit') this.sfx.drawer();
    else if (!out.good) this.sfx.fail();
    if (out.money) {
      const p = this.shop.desk.itemZone.clone().project(this.camera);
      this.hud.pop(((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight - 40, out.money);
    }
    this.hud.toast(out.text, out.good ? 'good' : 'bad');
    const mood = accept ? 'happy' : k === 'normal' || k === 'big' || k === 'kid' ? 'sad' : out.money > 0 ? 'neutral' : 'cross';
    setTimeout(() => this.say(c, out.says), 1300);
    this.clearDesk(c, takesGoods);
    c.settle(takesGoods, mood, accept && k !== 'credit');
    this.hud.showPink(true);
    this.hud.refresh();
    this.store.persist();
  }

  /** Tidy the desk once they have gone: the note into the drawer, the screen back to idle. */
  private clearDesk(c: Customer, _sold: boolean): void {
    setTimeout(() => {
      this.shop.desk.note(null);
      this.shop.desk.terminal('idle');
      this.shop.desk.debtBook(false);
      this.shop.desk.paper(0);
      this.shop.desk.screen([], 0, 'ضريبة القيمة المضافة 5٪ مشمولة');
      this.receipt.hide();
      if (!this.talk) this.hud.subtitle(null);
    }, 2600);
    void c;
  }

  /** A customer's short reply, spoken and subtitled. */
  private say(c: Customer, text: string): void {
    if (!text || text === '…' || this.talk) return;
    this.hud.subtitle(c.persona.name, text, text.length);
    c.human.pose.talking = true;
    void this.voice.speak(text, { gender: c.persona.gender, pitch: c.persona.pitch, rate: 1.02, key: c.persona.key }).then(() => (c.human.pose.talking = false));
    setTimeout(() => (c.human.pose.talking = false), 2500);
  }

  // ------------------------------------------------------------------ closing time

  private closeDay(): void {
    this.closing = true;
    const summary = this.store.closeDay();
    this.store.persist();
    this.sfx.success();
    this.queueModal(() =>
      showDaySummary(this.ui, summary, () => {
        this.store.newDay();
        this.closing = false;
        this.spawnT = 7;
        this.hud.refresh();
        this.store.persist();
        this.hud.toast(`🌅 صباح الخير! يوم جديد — ${this.store.s.day}`, 'big');
        this.closeModal();
      }),
    );
  }

  // ------------------------------------------------------------------ the pink button

  private pressPink(): void {
    if (!this.store || this.modal || this.decision.open) return;
    this.sfx.unlock();
    if (this.store.canUpgrade) {
      this.store.upgrade();
      const stage = this.store.s.stage;
      this.sfx.level();
      this.setStage(stage);
      this.hud.refresh();
      this.store.persist();
      void this.voice.speak(`مبروك! صارت بقالتك ${STAGES[stage].name}.`, { gender: 'm', pitch: 1, rate: 1, key: 'sanad' });
      this.queueModal(() => showUpgrade(this.ui, stage, () => this.closeModal()));
      return;
    }
    const moved = this.store.save();
    if (!moved) {
      this.hud.nudge();
      this.hud.toast('الدرج فاضي. انتظر زبون يدفع، بعدين ادّخر 💗');
      return;
    }
    this.sfx.save();
    const r = this.hud.saveBtn.getBoundingClientRect();
    this.hud.pop(r.left + r.width / 2, r.top - 10, moved);
    const cost = this.store.nextCost;
    if (this.store.canUpgrade) this.hud.toast('🎉 الادخار يكفي! اضغط الزر الوردي عشان تطوّر البقالة.', 'good');
    else if (cost !== null) this.hud.toast(`💗 ادّخرت ${fmt(moved)}. باقي ${fmt(Math.ceil(cost - this.store.s.savings))} وتصير ${STAGES[this.store.s.stage + 1].name}.`, 'good');
    this.store.persist();
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
