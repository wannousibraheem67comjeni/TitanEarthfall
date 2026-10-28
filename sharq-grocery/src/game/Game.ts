/**
 * The shop running: customers come in on a timer that depends on the stage and the
 * stars, line up, put their goods on the counter, and the bill waits for the
 * shopkeeper's decision. The pink button saves the till into the jar or, when the jar
 * is full enough, grows the shop to the next stage.
 */
import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { Sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import { SpeechOutput } from '../voice/speech';
import { buildShop, type Shop } from '../world/shop';
import { Hud } from '../ui/hud';
import { h } from '../ui/dom';
import { InvoicePanel } from '../ui/invoice';
import { Card, showHowTo, showPrices, showRank, showUpgrade } from '../ui/overlays';
import { Customer, makePersona, personaAgain } from './customers';
import { decide, fmt, LADDER, makeBill, STAGES, type Bill } from './economy';
import { customerLine } from './lines';
import { Store } from './state';

/** Seconds a customer waits at the counter before giving up. */
const PATIENCE = 30;

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.1, 200);
  readonly sfx = new Sfx();
  readonly voice = new SpeechOutput();
  readonly rng = new Rng();
  readonly ui = h('div.ui');
  store!: Store;
  hud!: Hud;
  invoice!: InvoicePanel;
  shop: Shop;
  private customers: Customer[] = [];
  private current: Customer | null = null;
  private spawnT = 3;
  private saveT = 5;
  private incomeT = 0;
  private income = { interest: 0, passive: 0 };
  /** A card is open: the shop waits. */
  private modal = false;
  private modals: (() => void)[] = [];
  private paused = true;
  private last = performance.now();
  private readonly tmp = new Vector3();
  private debtId = 1;

  constructor(readonly root: HTMLElement) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer = new WebGLRenderer({ antialias: !coarse, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = !coarse;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = 'view';
    root.append(this.renderer.domElement, this.ui);
    this.scene.background = new Color('#cfe6f5');
    this.scene.add(new HemisphereLight('#fff6e8', '#bfa985', 1.25));
    const sun = new DirectionalLight('#fff1d6', 1.4);
    sun.position.set(-6, 12, -14);
    sun.castShadow = !coarse;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -14;
    sun.shadow.camera.right = sun.shadow.camera.top = 14;
    this.scene.add(sun);
    this.shop = buildShop(0);
    this.scene.add(this.shop.group);
    this.placeCamera();
    window.addEventListener('resize', () => this.placeCamera());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private placeCamera(): void {
    const w = innerWidth;
    const hh = innerHeight;
    this.renderer.setSize(w, hh);
    this.camera.aspect = w / hh;
    const portrait = w < hh;
    this.camera.fov = portrait ? 74 : 56;
    const c = this.shop.layout.camera;
    this.camera.position.copy(c.pos);
    if (portrait) this.camera.position.add(new Vector3(0, 0.5, 1.4));
    this.camera.lookAt(c.look);
    this.camera.updateProjectionMatrix();
  }

  start(store: Store, first: boolean): void {
    this.store = store;
    this.setStage(store.s.stage);
    this.hud = new Hud(this.ui, store);
    this.invoice = new InvoicePanel(this.ui);
    this.invoice.onPrices = () => this.openCard(() => showPrices(this.ui, this.store.s.stage));
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
      this.say(final ? `مبروك يا ${store.s.name}! صرت أغنى شخص على الإطلاق!` : `لقب جديد: ${title}`, 'sanad');
      this.queueModal(() => showRank(this.ui, title, final, this.statsLine(), () => this.closeModal()));
    });
    const s = store.s;
    const hello = first ? `أهلاً بيك يا ${s.name}! هذي بقالتك، بقالة شرق الإمارات. صغيرة، وما يجيها أحد كثير… بس بإذن الله بتكبر.` : `أهلاً بيك يا ${s.name}! ${s.gender === 'f' ? 'نوّرتي' : 'نوّرت'} البقالة. يلا نشتغل.`;
    this.hud.toast(hello, 'big');
    void this.say(hello, 'sanad');
    if (first) this.queueModal(() => showHowTo(this.ui, () => this.closeModal()));
    this.paused = false;
  }

  private setStage(stage: number): void {
    for (const c of this.customers) c.dispose();
    this.customers = [];
    this.current = null;
    this.invoice?.hide();
    this.shop.group.removeFromParent();
    this.shop = buildShop(stage);
    this.scene.add(this.shop.group);
    this.placeCamera();
  }

  // ------------------------------------------------------------------ loop

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.store && !this.paused && !this.modal) this.step(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private step(dt: number): void {
    const s = this.store.s;
    const st = STAGES[s.stage];
    // Interest and branch income, reported once a minute.
    const inc = this.store.tick(dt);
    this.income.interest += inc.interest;
    this.income.passive += inc.passive;
    this.incomeT += dt;
    if (this.incomeT > 60) {
      this.incomeT = 0;
      if (this.income.interest >= 0.5) this.hud.toast(`💗 أرباح الادخار: +${fmt(Math.round(this.income.interest * 10) / 10)}`, 'good');
      if (this.income.passive >= 1) this.hud.toast(`🏬 دخل الفروع والعقود: +${fmt(Math.round(this.income.passive))}`, 'good');
      this.income = { interest: 0, passive: 0 };
    }
    if (inc.interest || inc.passive) this.hud.refresh();

    // New customers: quicker with more stars.
    const inside = this.customers.filter((c) => c.phase !== 'gone').length;
    const maxIn = 2 + Math.floor(s.stage / 2);
    this.spawnT -= dt;
    if (this.spawnT <= 0 && inside < maxIn) {
      this.spawnT = st.spawn * (1.5 - s.rep * 0.15) * this.rng.range(0.7, 1.3);
      this.spawn(makeBill(this.rng, s.stage));
    }
    // Debtors come back (or don't).
    for (const d of [...s.debts]) {
      if (d.due > s.time) continue;
      s.debts.splice(s.debts.indexOf(d), 1);
      if (this.rng.next() < d.trust) {
        const bill: Bill = { kind: 'repay', lines: [], total: 0, cost: 0, pays: d.amount, note: d.amount, debt: d.amount };
        this.spawn(bill, personaAgain(this.rng, d.name, d.gender, d.look));
      } else {
        s.stats.lostDebts++;
        this.hud.toast(`${d.name} ${d.gender === 'f' ? 'ما رجعت تسدد دينها' : 'ما رجع يسدد دينه'} (${fmt(d.amount)}) 😅 الدين مخاطرة.`, 'bad');
      }
    }

    // The line: whoever has finished shopping joins it in order of arrival.
    let slot = 0;
    for (const c of this.customers) {
      if (c.phase === 'shop' || c.phase === 'line' || c.phase === 'counter') {
        if (c.phase !== 'counter') c.goTo(slot);
        slot++;
      }
      c.update(dt);
    }
    this.customers = this.customers.filter((c) => c.phase !== 'gone');

    // The customer at the till.
    const at = this.customers.find((c) => c.phase === 'counter');
    if (at && at.ready && !this.current) this.openBill(at);
    if (this.current) {
      this.invoice.setPatience(1 - this.current.waited / PATIENCE);
      if (this.current.waited > PATIENCE) {
        const c = this.current;
        this.current = null;
        this.invoice.timeout();
        this.store.stars(-0.3);
        this.hud.toast(`${c.persona.name} ${c.persona.gender === 'f' ? 'ملّت من الانتظار وطلعت' : 'ملّ من الانتظار وطلع'} ⏳`, 'bad');
        c.leave(false);
      }
    }
    // What the person at the till is saying, over their head.
    const talker = this.current ?? this.customers.find((c) => c.phase === 'leave' && c.talking);
    if (talker) {
      this.tmp.set(talker.pos.x, talker.char.height * 1.08 + 0.15, talker.pos.z).project(this.camera);
      this.hud.say(this.bubbleText.get(talker) ?? null, ((this.tmp.x + 1) / 2) * innerWidth, ((1 - this.tmp.y) / 2) * innerHeight);
    } else this.hud.say(null);

    this.saveT -= dt;
    if (this.saveT < 0) {
      this.saveT = 5;
      this.store.persist();
    }
  }

  private readonly bubbleText = new Map<Customer, string>();

  private spawn(bill: Bill, persona = makePersona(this.rng, bill.kind)): void {
    const c = new Customer(persona, bill, this.scene, this.shop.layout, this.rng);
    this.customers.push(c);
    this.sfx.bell();
  }

  private openBill(c: Customer): void {
    this.current = c;
    const line = customerLine(this.rng, c.bill, c.persona, this.store.s.gender);
    this.bubbleText.set(c, line);
    c.talking = true;
    void this.voice.speak(line, { gender: c.persona.gender, pitch: c.persona.pitch, rate: 1, key: c.persona.key }).then(() => (c.talking = false));
    this.sfx.pop();
    this.invoice.show(c.persona, c.bill, line, this.store.s.name, this.store.s.stage, (accept) => this.settle(c, accept));
  }

  private settle(c: Customer, accept: boolean): void {
    if (this.current !== c) return;
    this.current = null;
    const s = this.store.s;
    const out = decide(c.bill, accept, this.rng.next(), { she: c.persona.gender === 'f', keeperShe: s.gender === 'f' });
    if (out.money) this.store.till(out.money);
    this.store.stars(out.rep);
    s.stats.customers++;
    if (accept) s.stats.accepted++;
    else s.stats.refused++;
    const k = c.bill.kind;
    if (!accept && (k === 'fake' || k === 'trick' || k === 'coupon')) s.stats.caught++;
    if (accept && (k === 'fake' || k === 'trick' || k === 'coupon')) s.stats.fooled++;
    if (k === 'repay') s.stats.repaid += c.bill.debt ?? 0;
    if (out.debt) s.debts.push({ id: this.debtId++, name: c.persona.name, amount: out.debt, trust: c.persona.trust, due: s.time + this.rng.range(50, 140), gender: c.persona.gender, look: c.persona.look });
    this.hud.toast(out.text, out.good ? 'good' : 'bad');
    if (out.money) {
      this.tmp.set(0, 1.4, this.shop.layout.counterZ).project(this.camera);
      this.hud.pop(((this.tmp.x + 1) / 2) * innerWidth, ((1 - this.tmp.y) / 2) * innerHeight, out.money);
      if (out.money > 0) this.sfx.register();
      else this.sfx.fail();
    } else if (!out.good) this.sfx.fail();
    else this.sfx.success();
    // A refused bluff that folded still leaves with the goods.
    c.leave(accept ? k !== 'fake' : out.money > 0);
    this.bubbleText.set(c, out.says);
    c.talking = true;
    void this.voice.speak(out.says, { gender: c.persona.gender, pitch: c.persona.pitch, rate: 1.05, key: c.persona.key }).then(() => {
      c.talking = false;
      this.bubbleText.delete(c);
    });
    setTimeout(() => {
      c.talking = false;
      this.bubbleText.delete(c);
    }, 3500);
    this.hud.refresh();
    this.store.persist();
  }

  // ------------------------------------------------------------------ the pink button

  private pressPink(): void {
    if (!this.store || this.modal) return;
    this.sfx.unlock();
    if (this.store.canUpgrade) {
      this.store.upgrade();
      const stage = this.store.s.stage;
      this.sfx.level();
      this.setStage(stage);
      this.hud.refresh();
      this.store.persist();
      void this.say(`مبروك! صارت بقالتك ${STAGES[stage].name}.`, 'sanad');
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

  // ------------------------------------------------------------------ helpers

  /** Cards pause the shop; they open one at a time. */
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

  private say(text: string, key: string): Promise<void> {
    return this.voice.speak(text, { gender: 'm', pitch: 1, rate: 1, key });
  }

  private statsLine(): string {
    const st = this.store.s.stats;
    return `خدمت ${st.customers} زبون، كشفت ${st.caught} حيلة، وجمعت أرباح ${fmt(Math.round(st.profit))}، وأرباح الادخار ${fmt(Math.round(st.interest))}.`;
  }
}
