/**
 * Composition root and main loop: builds the street, the people and the interface,
 * then runs time, movement, conversations, jobs, pickups and saving.
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PointLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { Sfx } from '../audio/sfx';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { DialogueManager, type Turn } from '../dialogue/DialogueManager';
import { ApiBackend, ArtifactBackend } from '../dialogue/llm';
import { NPCS } from '../dialogue/npcs';
import { makePasserby } from '../dialogue/pedestrians';
import type { Action, Speaker } from '../dialogue/brain';
import { formatMoney, setArabicDigits } from '../lang/arabic';
import { analyze } from '../lang/intents';
import { SpeechInput, SpeechOutput, MIC_ERROR_TEXT, type MicError, type VoiceProfile } from '../voice/speech';
import { Character } from '../world/characters';
import type { CircleCollider } from '../world/collision';
import { BARBER_FLOOR, DELIVERY_DOORS, HOME, PLACE_BY_ID, STALL_SPOT, type DeliveryDoor, type PlaceId } from '../world/layout';
import { solid } from '../world/materials';
import { CAR_COLORS, makeTrashBag } from '../world/props';
import { Sky } from '../world/sky';
import { buildWorld, type WorldRefs } from '../world/World';
import { signTexture } from '../world/textures';
import { Hud, type LabelInfo } from '../ui/Hud';
import { DialoguePanel } from '../ui/DialoguePanel';
import { Phone } from '../ui/Phone';
import { TouchControls } from '../ui/TouchControls';
import { h } from '../ui/dom';
import { Atm, GroceryShop, UpgradeShop } from '../ui/minigames/Commerce';
import { CashierGame } from '../ui/minigames/CashierGame';
import { KarakGame } from '../ui/minigames/KarakGame';
import { LaptopGame } from '../ui/minigames/LaptopGame';
import { Overlay, type MiniEnv } from '../ui/minigames/Overlay';
import { PerfumeGame } from '../ui/minigames/PerfumeGame';
import { StallGame } from '../ui/minigames/StallGame';
import { TutorGame } from '../ui/minigames/TutorGame';
import { CameraRig } from './CameraRig';
import { item, job, type ItemId, type JobId } from './catalog';
import { NpcEntity, Pedestrians, Traffic, type Walker } from './entities';
import { Beacons, GroundItems, MoneyFx, Particles, type GroundItem } from './fx';
import { Input } from './Input';
import { Player, SPEEDS } from './Player';
import { checkAchievements, saveSettings, type Settings } from './progression';
import { Store } from './state';
import { deliveryPay, timeLimit } from './jobs/delivery';
import { washPay } from './jobs/carwash';

interface Interactable {
  key: string;
  label: string;
  x: number;
  z: number;
  r: number;
  /** Seconds of work (watering, sweeping); 0 for an instant action. */
  work?: number;
  activity?: 'water' | 'sweep' | 'scrub';
  run(): void;
}

type WorldJob =
  | { kind: 'plants'; watered: number[] }
  | { kind: 'trash'; bags: Mesh[]; carrying: boolean; delivered: number }
  | { kind: 'errand' }
  | { kind: 'delivery'; door: DeliveryDoor; limit: number; left: number; customer: Character | null; bag: Object3D }
  | { kind: 'wash'; job: 'carwash' | 'hamadcar'; car: Group; spots: Mesh[]; total: number; left: number }
  | { kind: 'sweep'; piles: Mesh[] };

type Talk = { kind: 'npc'; ent: NpcEntity } | { kind: 'walker'; w: Walker };

const NPC_COLORS: Record<string, string> = { mum: '#8a3b5c', dad: '#5a3e2b', grandpa: '#6b5a3a', grocer: '#1f6f4a', karak: '#c0521e', shawarma: '#b3261e', carwash: '#1f5fa8', umali: '#5a4a7a', ali: '#d8352b', hamad: '#7a5c3c', electro: '#0d4fa3', barber: '#24324a' };

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 2000);
  readonly rig = new CameraRig(this.camera);
  readonly input: Input;
  readonly sfx = new Sfx();
  readonly speechIn = new SpeechInput();
  readonly speechOut = new SpeechOutput();
  readonly rng = new Rng();
  readonly sky: Sky;
  readonly world: WorldRefs;
  readonly ui = h('div.ui');
  hud!: Hud;
  panel!: DialoguePanel;
  phone!: Phone;
  touch: TouchControls | null = null;
  player!: Player;
  npcs: NpcEntity[] = [];
  peds!: Pedestrians;
  traffic!: Traffic;
  money!: MoneyFx;
  ground!: GroundItems;
  beacons!: Beacons;
  particles!: Particles;
  dm!: DialogueManager;
  store!: Store;
  private overlay: Overlay | null = null;
  private job: WorldJob | null = null;
  private talk: Talk | null = null;
  private current: Interactable | null = null;
  private work: { it: Interactable; t: number } | null = null;
  private walletOwner: Walker | null = null;
  private walletTimer = 200;
  private time = 0;
  private saveTimer = 0;
  private achTimer = 0;
  private stepTimer = 0;
  private handsFree = false;
  private vHeld = false;
  private running = false;
  private kiosk: Group | null = null;
  private washBar: HTMLElement | null = null;
  private readonly raycaster = new Raycaster();
  private readonly tmp = new Vector3();
  private readonly obstacles: CircleCollider[] = [];
  /** A few real lights that hop to the street lamps nearest the player at night. */
  private readonly lampLights: PointLight[] = [];

  constructor(
    readonly root: HTMLElement,
    readonly settings: Settings,
  ) {
    this.renderer = new WebGLRenderer({ antialias: settings.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality === 'high' ? 2 : 1.25));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = 'view';
    this.renderer.domElement.tabIndex = 0;
    root.append(this.renderer.domElement, this.ui);
    this.input = new Input(this.renderer.domElement);
    this.sky = new Sky(this.scene);
    if (settings.quality === 'low') this.sky.sun.shadow.mapSize.set(1024, 1024);
    this.world = buildWorld(this.scene);
    for (let i = 0; i < (settings.quality === 'high' ? 6 : 3); i++) {
      const l = new PointLight('#ffcf8a', 0, 26, 1.3);
      this.lampLights.push(l);
      this.scene.add(l);
    }
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Called once the player picked a name (or continued a save). */
  start(store: Store): void {
    this.store = store;
    const s = store.s;
    setArabicDigits(this.settings.arabicDigits);
    const g = s.player.gender;
    this.player = new Player(
      g === 'm'
        ? { build: 'man', outfit: 'kandura', skin: '#c99a72', primary: '#fbfaf6', secondary: '#eeeae2', head: 'ghutra', headColor: '#ffffff', beard: 'none', beardColor: '#1a1410', height: 1.66 }
        : { build: 'woman', outfit: 'abaya', skin: '#c99a72', primary: '#1b191d', secondary: '#7a5aa6', head: 'shayla', headColor: '#16141a', beard: 'none', beardColor: '#000', height: 1.6 },
    );
    this.scene.add(this.player.object);
    const p = s.pos ?? HOME.spawn;
    this.player.place(p.x, p.z, 'heading' in p ? p.heading : HOME.spawn.heading);
    this.rig.snapBehind(this.player.heading);
    this.npcs = NPCS.map((d) => new NpcEntity(d, this.scene));
    this.peds = new Pedestrians(this.scene, this.settings.quality === 'high' ? 16 : 9);
    this.traffic = new Traffic(this.scene, this.settings.quality === 'high' ? 8 : 5);
    this.traffic.onHonk = (x, z) => {
      if (Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < 18) this.sfx.horn();
    };
    this.money = new MoneyFx(this.scene);
    this.money.onArrive = (v) => (v === 1 ? this.sfx.coin() : this.sfx.note());
    this.ground = new GroundItems(this.scene);
    this.beacons = new Beacons(this.scene);
    this.particles = new Particles(this.scene);
    this.dm = new DialogueManager(store, this.rng);

    this.hud = new Hud(this.ui, store);
    this.hud.onPrompt = () => this.activate();
    this.hud.onCancel = () => this.cancelJob();
    this.hud.phoneBtn.onclick = () => this.togglePhone();
    this.hud.talkBtn.onclick = () => this.talkToNearest();
    this.panel = new DialoguePanel(this.ui, {
      send: (t) => void this.send(t, false),
      close: () => this.endTalk(),
      mic: () => void this.micTurn(),
      handsFree: (on) => {
        this.handsFree = on;
        if (on && !this.speechOut.speaking && !this.dm.busy) void this.micTurn();
      },
    });
    this.phone = new Phone(this.ui, store, this.settings, {
      mark: (place) => {
        this.markPlace(place);
        this.phone.close();
      },
      openOnline: () => {
        this.phone.close();
        this.openOverlay((p, env) => new LaptopGame(p, env, () => this.afterWork()));
      },
      settingsChanged: (st) => this.applySettings(st),
      reset: () => {
        Store.clear();
        location.reload();
      },
      testMic: () => this.testMic(),
      testVoice: () => this.speakLine('هلا والله! أنا رحيم من بقالة النور. صوتي واضح؟', { gender: 'm', key: 'grocer', pitch: 1, rate: 1 }),
      close: () => this.phone.close(),
      claudeStatus: () => this.claudeStatus(),
    });
    if (TouchControls.wanted()) this.touch = new TouchControls(this.ui, this.input, () => this.activate());

    store.on('money', (e) => {
      if (e.delta > 0) {
        this.tmp.set(this.player.pos.x, this.player.pos.y + 2.1, this.player.pos.z).project(this.camera);
        this.hud.moneyPop(((this.tmp.x + 1) / 2) * innerWidth, ((1 - this.tmp.y) / 2) * innerHeight, e.delta);
      }
    });
    store.on('upgrade', (e) => this.onUpgrade(e.id));
    store.on('levelup', () => this.sfx.level());
    store.on('day', (e) => {
      const bits = [];
      if (e.interest) bits.push(`أرباح التوفير +${e.interest}`);
      if (e.passive) bits.push(`دخل محلك +${e.passive}`);
      this.hud.toast(`صباح يوم جديد! اليوم ${e.day}${bits.length ? ' · ' + bits.join(' · ') : ''}`, 'good');
    });

    for (const id of ['stall', 'shop', 'sneakers'] as const) if (store.has(id)) this.onUpgrade(id, true);
    if (s.errand) this.job = { kind: 'errand' };
    this.applySettings(this.settings);
    void this.setupClaude();
    this.bindKeys();
    this.hud.refreshClock();
    if (!store.npc('mum').met) {
      this.markPlace('home', 'كلّم أمك بالحوش');
      this.beacons.move('dest', HOME.mum.x, HOME.mum.z);
    }
    this.running = true;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------------ setup

  private resize(): void {
    const w = window.innerWidth;
    const h2 = window.innerHeight;
    this.renderer.setSize(w, h2);
    this.camera.aspect = w / h2;
    this.camera.fov = w < h2 ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  private applySettings(st: Settings): void {
    saveSettings(st);
    this.speechIn.lang = st.voiceLang;
    this.speechOut.enabled = st.tts;
    this.speechOut.rateScale = st.ttsRate;
    this.sfx.setVolume(st.volume);
    this.handsFree = st.handsFree;
    this.panel?.setHandsFree(st.handsFree);
    setArabicDigits(st.arabicDigits);
    this.hud?.refreshMoney(false);
    this.hud?.labels.toggleAttribute('hidden', !st.labels);
    void this.setupClaude();
  }

  private async setupClaude(): Promise<void> {
    if (!this.dm) return;
    if (this.settings.brain === 'offline') {
      this.dm.backend = null;
      return;
    }
    if (this.settings.apiKey) {
      this.dm.backend = new ApiBackend(this.settings.apiKey, this.settings.apiModel);
      return;
    }
    const art = await ArtifactBackend.detect();
    this.dm.backend = art;
  }

  private claudeStatus(): string {
    const b = this.dm?.backend;
    if (this.settings.brain === 'offline') return 'الشخصيات تفهمك بدون إنترنت (فهم الكلمات واللهجات المحلي).';
    if (!b) return 'بدون إنترنت: الشخصيات تفهم الكلام الشائع باللهجات. لمحادثة حرة أكثر، العب داخل claude.ai أو حط مفتاح API.';
    return `الشخصيات تتكلم بذكاء Claude: ${b.label}.${this.dm.lastError ? ` (آخر خطأ: ${this.dm.lastError}، رجعنا للفهم المحلي)` : ''}`;
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.running) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.code === 'Escape') {
        if (this.overlay) this.overlay.close();
        else if (this.phone.isOpen) this.phone.close();
        else if (this.talk) this.endTalk();
        else if (this.hud.mapOpen) this.hud.toggleMap(false);
        else if (this.job?.kind === 'wash') this.finishWash(false);
        return;
      }
      if (typing) return;
      if (e.code === 'KeyV' && this.talk && !this.vHeld && !e.repeat) {
        this.vHeld = true;
        void this.micTurn();
        return;
      }
      if ((e.code === 'Tab' || e.code === 'KeyP') && !this.overlay) {
        e.preventDefault();
        this.togglePhone();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyV' && this.vHeld) {
        this.vHeld = false;
        this.speechIn.stop();
      }
    });
    // Car washing: pointer scrubs dirt instead of turning the camera.
    this.input.onPointer = (e, phase) => {
      if (this.job?.kind !== 'wash') return false;
      if (phase === 'up') return true;
      if (phase === 'move' && e.buttons === 0 && e.pointerType === 'mouse') return true;
      this.scrubAt(e.clientX, e.clientY);
      return true;
    };
  }

  // ------------------------------------------------------------------ loop

  private last = performance.now();

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const paused = !!this.overlay || this.phone.isOpen;
    this.input.blocked = paused || this.panelFocused();
    if (!paused) this.store.advance(dt * (this.talk ? 0.4 : 1));
    const hour = this.store.hour;

    // Camera input.
    if (this.job?.kind !== 'wash' && !this.talk) {
      this.rig.rotate(this.input.look.x, this.input.look.y);
      this.rig.zoomBy(this.input.zoom);
    } else if (this.job?.kind === 'wash') {
      if (this.input.held('KeyA') || this.input.held('ArrowLeft')) this.washYaw += dt * 1.6;
      if (this.input.held('KeyD') || this.input.held('ArrowRight')) this.washYaw -= dt * 1.6;
    }

    // Player.
    const frozen = !!this.talk || paused || this.job?.kind === 'wash' || !!this.work;
    this.player.frozen = frozen;
    this.obstacles.length = 0;
    this.traffic.obstacles(this.obstacles);
    this.peds.obstacles(this.obstacles);
    for (const n of this.npcs) if (n.present) this.obstacles.push({ x: n.pos.x, z: n.pos.z, r: 0.32 });
    const speedMul = this.store.has('sneakers') ? 1.15 : 1;
    this.player.update(dt, frozen ? { x: 0, y: 0 } : this.input.axis(), this.input.running, this.input.hit('Space') || this.input.touchJump, this.rig.yaw, this.world.colliders, this.obstacles, speedMul);
    if (this.player.speed > 0.5 && this.player.ride === 'none' && !this.player.airborne) {
      this.stepTimer -= dt * this.player.speed;
      if (this.stepTimer < 0) {
        this.stepTimer = 1.4;
        this.sfx.step(this.player.pos.y < 0.1);
      }
    }

    // World.
    const talkingTo = this.talk?.kind === 'npc' ? this.talk.ent : null;
    for (const n of this.npcs) n.update(dt, hour, this.player.pos, n === talkingTo);
    this.peds.update(dt, hour, this.player.pos, this.talk?.kind === 'walker' ? this.talk.w : null);
    this.traffic.update(dt, this.player.pos);
    this.money.update(dt, this.player.pos);
    this.particles.update(dt);
    this.beacons.update(dt, this.player.pos);
    for (const it of this.ground.update(dt, this.player.pos, this.time)) this.collect(it);
    this.updateWallet(dt);
    // A destination mark has done its job once the player gets there.
    const dest = this.beacons.list.get('dest');
    if (dest && this.job?.kind !== 'errand' && Math.hypot(dest.pos.x - this.player.pos.x, dest.pos.z - this.player.pos.z) < 3.5) this.beacons.remove('dest');
    this.updateJob(dt);
    this.updateWork(dt);

    // Interaction prompt.
    if (!paused && !this.talk && this.job?.kind !== 'wash') {
      this.current = this.findInteractable();
      const label = this.work ? `${this.work.it.label}…` : this.current ? this.current.label : null;
      this.hud.setPrompt(label, 'E', this.work ? this.work.t / (this.work.it.work ?? 1) : null);
      this.touch?.setAction(this.current && !this.work ? this.current.label : null);
      if (this.input.hit('KeyE')) this.activate();
      if (this.input.hit('KeyT')) this.talkToNearest();
      if (this.input.hit('KeyM')) this.hud.toggleMap();
      if (this.input.hit('KeyB')) this.toggleRide();
    } else {
      this.hud.setPrompt(null);
      this.touch?.setAction(null);
    }

    // Camera.
    if (this.talk) this.frameTalk();
    else if (this.job?.kind === 'wash') this.frameWash();
    else this.rig.focus = null;
    this.rig.update(dt, this.player.pos, this.player.heading, this.player.speed > 0.5, this.world.colliders);
    this.sky.update(hour, this.player.pos, this.camera.position);
    this.updateLampLights();
    this.world.skyline.update(this.sky.fog.color, this.sky.night);

    // Interface.
    this.hud.refreshClock();
    this.hud.setStamina(this.player.staminaFraction, this.player.ride);
    this.updateObjective();
    this.updateLabels();
    this.updateArrow();
    if (Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) {
      const markers = [...this.beacons.list.values()].map((b) => ({ x: b.pos.x, z: b.pos.z, icon: b.icon }));
      for (const it of this.ground.items) if (it.kind === 'wallet') markers.push({ x: it.x, z: it.z, icon: '👛' });
      this.hud.drawMap(this.player.pos.x, this.player.pos.z, this.player.heading, markers);
    }
    this.achTimer -= dt;
    if (this.achTimer < 0) {
      this.achTimer = 1;
      for (const a of checkAchievements(this.store)) {
        this.hud.toast(`${a.icon} إنجاز جديد: ${a.title} — ${a.desc}`, 'achievement');
        this.sfx.level();
      }
      this.hud.setBadge(this.availableJobsCount());
    }
    this.saveTimer -= dt;
    if (this.saveTimer < 0) this.save();

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }

  private panelFocused(): boolean {
    const a = document.activeElement;
    return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
  }

  save(): void {
    this.saveTimer = 15;
    this.store.s.pos = { x: this.player.pos.x, z: this.player.pos.z, heading: this.player.heading };
    this.store.save();
  }

  private availableJobsCount(): number {
    return ['plants', 'trash', 'tutor', 'hamadcar'].filter((j) => this.store.jobBlock(j as JobId) === null).length;
  }

  // ------------------------------------------------------------------ interactions

  private findInteractable(): Interactable | null {
    const p = this.player.pos;
    const list: Interactable[] = [];
    for (const n of this.npcs) if (n.present) list.push({ key: n.def.id, label: `تكلم مع ${n.def.name}`, x: n.pos.x, z: n.pos.z, r: n.sitting ? 3.6 : 3, run: () => this.startTalk({ kind: 'npc', ent: n }) });
    const w = this.peds.nearest(p.x, p.z, 2.2);
    if (w) list.push({ key: w.p.key, label: `تكلم مع ${w.p.name}${w.ownsWallet && this.store.count('wallet') ? ' (صاحب المحفظة؟)' : ''}`, x: w.pos.x, z: w.pos.z, r: 2.2, run: () => this.startTalk({ kind: 'walker', w }) });
    list.push({ key: 'atm', label: 'استخدم الصراف الآلي', x: -69.25, z: -10.2, r: 1.9, run: () => this.openOverlay((root, env) => new Atm(root, env)) });
    list.push({ key: 'laptop', label: 'افتح اللابتوب واشتغل أونلاين', x: HOME.desk.x, z: HOME.desk.z, r: 1.8, run: () => this.openOverlay((root, env) => new LaptopGame(root, env, () => this.afterWork())) });
    list.push({ key: 'shelves', label: 'تسوّق من رفوف البقالة', x: -84, z: -9.6, r: 1.8, run: () => this.openOverlay((root, env) => new GroceryShop(root, env)) });
    list.push({ key: 'phones', label: 'شوف بضاعة عالم الجوال', x: 16, z: -9.6, r: 1.8, run: () => this.openOverlay((root, env) => new UpgradeShop(root, env)) });
    const h24 = this.store.hour;
    if (h24 >= 19 || h24 < 5) list.push({ key: 'sleep', label: 'نام لين الصبح', x: HOME.door.x, z: HOME.door.z, r: 1.8, run: () => this.sleep() });
    const cans = this.store.count('cans');
    list.push({ key: 'recycle', label: cans ? `حط ${cans} علب بآلة التدوير` : 'آلة التدوير (اجمع علب من الشارع)', x: 33, z: -9.0, r: 2, run: () => this.recycle() });
    if (this.store.has('stall')) list.push({ key: 'stall', label: 'افتح البسطة وبيع', x: STALL_SPOT.x, z: STALL_SPOT.z + 1.2, r: 2.2, run: () => this.openStall() });
    for (const it of this.ground.items) if (it.kind === 'wallet') list.push({ key: 'wallet', label: 'خذ المحفظة الضايعة', x: it.x, z: it.z, r: 1.5, run: () => this.pickWallet(it) });
    list.push(...this.jobInteractables());
    let best: Interactable | null = null;
    let bd = Infinity;
    for (const it of list) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      // Prefer what the player is facing a little.
      const facing = Math.cos(Math.atan2(it.x - p.x, it.z - p.z) - this.player.heading);
      const score = d - facing * 0.4;
      if (d < it.r && score < bd) {
        bd = score;
        best = it;
      }
    }
    return best;
  }

  private activate(): void {
    if (this.work || this.talk || this.overlay) return;
    const it = this.current;
    if (!it) return;
    this.sfx.unlock();
    if (it.work) {
      this.work = { it, t: 0 };
      this.player.activity = it.activity ?? 'none';
    } else it.run();
  }

  private updateWork(dt: number): void {
    if (!this.work) return;
    const { it } = this.work;
    if (Math.hypot(it.x - this.player.pos.x, it.z - this.player.pos.z) > it.r + 0.5) {
      this.work = null;
      this.player.activity = 'none';
      return;
    }
    this.work.t += dt;
    // Face the work.
    this.player.heading = Math.atan2(it.x - this.player.pos.x, it.z - this.player.pos.z);
    if (it.activity === 'water' && Math.random() < 0.5) this.particles.emit(new Vector3(it.x, 1.3, it.z), 'water', 2);
    if (it.activity === 'sweep' && Math.random() < 0.2) this.particles.emit(new Vector3(it.x, 0.1, it.z), 'dust', 1);
    if (this.work.t >= (it.work ?? 1)) {
      this.work = null;
      this.player.activity = 'none';
      it.run();
    }
  }

  private toggleRide(): void {
    const kinds = (['scooter', 'bike'] as const).filter((k) => this.store.has(k));
    if (!kinds.length) {
      this.hud.toast('ما عندك دراجة. تقدر تشتريها من عالم الجوال بـ450 درهم.');
      return;
    }
    if (this.player.ride === 'none') this.player.setRide(kinds[0]);
    else if (this.player.ride === kinds[0] && kinds[1]) this.player.setRide(kinds[1]);
    else this.player.setRide('none');
    if (this.player.carried && this.player.ride !== 'none' && this.job?.kind === 'trash') this.player.setRide('none');
  }

  private togglePhone(): void {
    if (this.phone.isOpen) this.phone.close();
    else if (!this.overlay) {
      if (this.talk) this.endTalk();
      this.phone.open();
      this.sfx.click();
    }
  }

  private openOverlay(make: (root: HTMLElement, env: MiniEnv) => { ov: Overlay }): void {
    if (this.overlay) return;
    if (this.talk) this.endTalk();
    this.phone.close();
    this.input.releaseAll();
    this.sfx.unlock();
    const { ov } = make(this.ui, this.env());
    const inner = ov.onClose;
    ov.onClose = () => {
      inner?.();
      if (this.overlay === ov) this.overlay = null;
      this.save();
    };
    this.overlay = ov;
  }

  env(): MiniEnv {
    return {
      store: this.store,
      rng: this.rng,
      sfx: this.sfx,
      listen: (onInterim) => this.listenOnce(onInterim),
      micAvailable: () => SpeechInput.supported(),
      speak: (text, gender, key, pitch) => void this.speakLine(text, { gender, key, pitch: pitch ?? (gender === 'f' ? 1.15 : 0.95), rate: 1 }),
      pay: (amount, label, opts) => this.pay(amount, label, this.player.pos, opts),
      toast: (t, k) => this.hud.toast(t, k),
    };
  }

  /** Credit money and show it physically: notes flying from `from` to the player. */
  pay(amount: number, label: string, from: Vector3, opts: { bank?: boolean } = {}): void {
    if (amount <= 0) return;
    this.store.earn(amount, label, opts);
    if (opts.bank) {
      this.hud.toast(`🏦 تحوّل لحسابك ${formatMoney(amount)} — ${label}`, 'good');
      this.sfx.register();
    } else {
      this.money.burst(from, amount);
      this.sfx.register();
    }
  }

  private afterWork(): void {
    this.save();
  }

  // ------------------------------------------------------------------ conversation

  private talkToNearest(): void {
    if (this.talk || this.overlay) return;
    const p = this.player.pos;
    let best: Talk | null = null;
    let bd = 6;
    for (const n of this.npcs) {
      if (!n.present) continue;
      const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
      if (d < bd) {
        bd = d;
        best = { kind: 'npc', ent: n };
      }
    }
    const w = this.peds.nearest(p.x, p.z, bd);
    if (w) best = { kind: 'walker', w };
    if (best) this.startTalk(best);
    else this.hud.toast('ما في أحد قريب تكلمه. قرّب من أي شخص واضغط T.');
  }

  private speakerOf(t: Talk): Speaker {
    return t.kind === 'npc' ? { kind: 'npc', def: t.ent.def } : { kind: 'passerby', p: t.w.p, ownsWallet: t.w.ownsWallet };
  }

  private voiceOf(t: Talk): VoiceProfile {
    if (t.kind === 'npc') return { gender: t.ent.def.gender, pitch: t.ent.def.voice.pitch, rate: t.ent.def.voice.rate, key: t.ent.def.id };
    return { gender: t.w.p.gender, pitch: t.w.p.voice.pitch, rate: t.w.p.voice.rate, key: t.w.p.key };
  }

  private startTalk(t: Talk): void {
    if (this.talk) return;
    this.sfx.unlock();
    this.talk = t;
    if (t.kind === 'walker') t.w.hold = true;
    this.player.speed = 0;
    this.input.releaseAll();
    const sp = this.speakerOf(t);
    const name = sp.kind === 'npc' ? sp.def.name : sp.p.name;
    const title = sp.kind === 'npc' ? sp.def.title : sp.p.gender === 'f' ? 'جارة من الفريج' : 'جار من الفريج';
    this.panel.open(name, title, sp.kind === 'npc' ? NPC_COLORS[sp.def.id] ?? '#555' : '#6a5642');
    this.panel.setMicAvailable(SpeechInput.supported(), SpeechInput.supported() ? '' : 'المايك غير مدعوم هنا، اكتب كلامك');
    this.panel.setHandsFree(this.handsFree);
    this.panel.setSource(this.dm.backend ? 'Claude' : 'بدون إنترنت');
    const turn = this.dm.open(sp);
    this.showTurn(turn, t);
    this.panel.focusInput();
  }

  private endTalk(): void {
    const t = this.talk;
    if (!t) return;
    this.speechIn.abort();
    this.speechOut.cancel();
    this.dm.close();
    this.panel.close();
    this.panel.blurInput();
    if (t.kind === 'walker') t.w.hold = false;
    if (t.kind === 'npc') t.ent.talking = false;
    this.player.talking = false;
    this.talk = null;
    this.save();
  }

  private async send(text: string, byVoice: boolean): Promise<void> {
    const t = this.talk;
    if (!t || !text.trim()) return;
    if (byVoice) this.store.bump('voiceTurns');
    if (analyze(text).has('salam')) this.store.bump('salams');
    this.speechOut.cancel();
    this.panel.youSaid(text);
    this.panel.thinking();
    this.player.talking = true;
    setTimeout(() => (this.player.talking = false), 600);
    const turn = await this.dm.say(text);
    if (this.talk !== t) return;
    this.panel.setSource(turn.source === 'claude' ? 'Claude' : this.dm.backend ? 'بدون إنترنت (احتياطي)' : 'بدون إنترنت');
    this.showTurn(turn, t);
  }

  private showTurn(turn: Turn, t: Talk): void {
    this.panel.say(turn.text);
    this.panel.setSuggestions(turn.suggestions);
    const ent = t.kind === 'npc' ? t.ent : null;
    if (ent) ent.talking = true;
    const ending = turn.actions.some((a) => a.type === 'end' || a.type === 'startJob' || a.type === 'openShop');
    void this.speakLine(turn.text, this.voiceOf(t)).then(() => {
      if (ent) ent.talking = false;
      if (this.talk !== t) return;
      if (ending) return;
      if (this.handsFree && !this.dm.busy) void this.micTurn();
    });
    this.applyActions(turn.actions, t);
  }

  private applyActions(actions: Action[], t: Talk): void {
    const from = t.kind === 'npc' ? t.ent.pos : t.w.pos;
    for (const a of actions) {
      switch (a.type) {
        case 'pay':
          this.pay(a.amount, a.label, from);
          break;
        case 'sell':
          if (this.store.spend(a.total, 'مشتريات من البقالة')) {
            for (const l of a.lines) this.store.addItem(l.id, l.qty);
            this.sfx.register();
          }
          break;
        case 'buyUpgrade':
          this.store.buy(a.id);
          break;
        case 'snack':
          if (a.price === 0 || this.store.spend(a.price, a.name)) {
            this.player.stamina = this.player.staminaMax;
            this.player.boost = 60;
            this.hud.toast(`${a.name}: نَفَسك تجدد وصرت أسرع شوي لمدة دقيقة!`, 'good');
          }
          break;
        case 'openShop':
          setTimeout(() => this.openOverlay((root, env) => (a.shop === 'grocery' ? new GroceryShop(root, env) : new UpgradeShop(root, env))), 1400);
          break;
        case 'mark':
          this.markPlace(a.place);
          break;
        case 'completeErrand':
          this.completeErrand(from);
          break;
        case 'returnWallet':
          this.returnWallet(from);
          break;
        case 'rep':
          this.store.rep(a.delta);
          break;
        case 'startJob': {
          const id = a.job;
          setTimeout(() => {
            if (this.talk === t) this.endTalk();
            this.startJob(id, a.items, a.cash, from);
          }, 1300);
          break;
        }
        case 'end':
          setTimeout(() => {
            if (this.talk === t) this.endTalk();
          }, 2200);
          break;
      }
    }
  }

  private async micTurn(): Promise<void> {
    if (!this.talk) return;
    if (this.speechIn.listening) {
      this.speechIn.stop();
      return;
    }
    this.speechOut.cancel();
    this.sfx.micOn();
    this.panel.setListening(true);
    try {
      const text = await this.speechIn.listen((i) => this.panel.setListening(true, i));
      this.panel.setListening(false);
      this.sfx.micOff();
      if (text) await this.send(text, true);
      else if (this.handsFree && this.talk) this.panel.setMicAvailable(true, 'ما سمعت شي. اضغط 🎤 أو تكلم مرة ثانية.');
    } catch (e) {
      this.panel.setListening(false);
      const code = (typeof e === 'string' ? e : 'other') as MicError;
      this.panel.setMicAvailable(code !== 'unsupported' && code !== 'denied', MIC_ERROR_TEXT[code] ?? MIC_ERROR_TEXT.other);
      if (code === 'denied' || code === 'unsupported') {
        this.handsFree = false;
        this.panel.setHandsFree(false);
      }
    }
  }

  private listenOnce(onInterim: (t: string) => void): Promise<string> {
    this.speechOut.cancel();
    return this.speechIn.listen(onInterim);
  }

  private async testMic(): Promise<string> {
    this.sfx.unlock();
    try {
      return await this.speechIn.listen(() => {});
    } catch (e) {
      throw MIC_ERROR_TEXT[(e as MicError) ?? 'other'] ?? MIC_ERROR_TEXT.other;
    }
  }

  speakLine(text: string, v: VoiceProfile): Promise<void> {
    return this.speechOut.speak(text, v);
  }

  private frameTalk(): void {
    const t = this.talk!;
    const pos = t.kind === 'npc' ? t.ent.pos : t.w.pos;
    const headY = t.kind === 'npc' ? t.ent.headPosition(this.tmp).y : t.w.pos.y + t.w.char.height * 0.93;
    const dx = this.player.pos.x - pos.x;
    const dz = this.player.pos.z - pos.z;
    this.player.heading = Math.atan2(-dx, -dz);
    const yaw = Math.atan2(dx, dz) + 0.42;
    const dist = Math.hypot(dx, dz) + 2.4;
    // Aim below the face so the character sits in the upper half, clear of the panel.
    this.rig.focus = { point: new Vector3(pos.x, headY - 0.75, pos.z), yaw, pitch: 0.06, dist };
  }

  // ------------------------------------------------------------------ jobs

  startJob(id: JobId, items?: ItemId[], cash?: number, from?: Vector3): void {
    const block = this.store.jobBlock(id);
    if (block) {
      this.hud.toast(block === 'closed' ? 'هالشغل مسكّر الحين.' : block === 'done' ? 'خلصت هالشغل اليوم.' : 'تحتاج بسطة أول.', 'bad');
      return;
    }
    if (this.job && this.job.kind !== 'errand') this.cancelJob(true);
    const src = from ?? this.player.pos;
    switch (id) {
      case 'cashier':
        return this.openOverlay((root, env) => new CashierGame(root, env, () => this.afterWork()));
      case 'karak':
        return this.openOverlay((root, env) => new KarakGame(root, env, () => this.afterWork()));
      case 'perfume':
        return this.openOverlay((root, env) => new PerfumeGame(root, env, () => this.afterWork()));
      case 'tutor':
        return this.openOverlay((root, env) => new TutorGame(root, env, () => this.afterWork()));
      case 'online':
        return this.openOverlay((root, env) => new LaptopGame(root, env, () => this.afterWork()));
      case 'stall':
        return this.openStall();
      case 'plants':
        this.job = { kind: 'plants', watered: [] };
        this.world.plants.forEach((p) => p.setWater(0));
        this.hud.toast('اسقِ الستة أصص بالحوش: قرّب من كل أص واضغط E.');
        break;
      case 'trash': {
        const bags = [0, 1].map((i) => {
          const b = makeTrashBag();
          b.position.set(HOME.trashPickup.x + i * 0.8, 0.35, HOME.trashPickup.z);
          this.scene.add(b);
          return b;
        });
        this.job = { kind: 'trash', bags, carrying: false, delivered: 0 };
        this.hud.toast('شيل أكياس الزبالة من جنب باب البيت للحاوية الخضرا برا البوابة.');
        break;
      }
      case 'errand':
        if (!items?.length) return;
        this.store.s.errand = { items, cash: cash ?? 0 };
        if (cash) this.pay(cash, 'فلوس المقاضي من أمي', src);
        this.job = { kind: 'errand' };
        this.markPlace('grocery');
        break;
      case 'delivery':
        return this.startDelivery();
      case 'carwash':
      case 'hamadcar':
        return this.startWash(id);
      case 'barber': {
        const piles = Array.from({ length: 6 }, (_, i) => {
          const m = new Mesh(new SphereGeometry(0.28, 8, 4), solid('#2a2018', 1));
          m.scale.set(1, 0.18, 1);
          m.position.set(BARBER_FLOOR.x - 4 + i * 1.6 + this.rng.range(-0.3, 0.3), 0.16, -7.4 - this.rng.range(0, 1.6));
          this.scene.add(m);
          return m;
        });
        this.job = { kind: 'sweep', piles };
        this.hud.toast('كنّس الشعر من الرصيف قدام الصالون: قرّب من كل كومة واضغط E.');
        break;
      }
      case 'recycle':
        this.hud.toast('اجمع العلب الفاضية من الشارع (امشِ فوقها) وحطها بالآلة جنب موقف الباص.');
        this.markPlace('recycle');
        break;
    }
  }

  private cancelJob(silent = false): void {
    const j = this.job;
    if (!j) return;
    if (j.kind === 'trash') {
      for (const b of j.bags) b.removeFromParent();
      this.player.carry(null);
    }
    if (j.kind === 'delivery') {
      this.player.carry(null);
      if (j.customer) j.customer.root.removeFromParent();
    }
    if (j.kind === 'wash') this.finishWash(false, true);
    if (j.kind === 'sweep') for (const p of j.piles) p.removeFromParent();
    if (j.kind === 'errand') {
      this.store.s.errand = null;
    }
    this.beacons.clear('job');
    this.beacons.remove('dest');
    this.job = null;
    if (!silent) this.hud.toast('تركت الشغل.');
  }

  private jobInteractables(): Interactable[] {
    const j = this.job;
    if (!j) return [];
    const out: Interactable[] = [];
    if (j.kind === 'plants') {
      this.world.plants.forEach((p, i) => {
        if (j.watered.includes(i)) return;
        out.push({
          key: `plant${i}`,
          label: 'اسقِ الأص',
          x: p.x,
          z: p.z,
          r: 1.6,
          work: 1.3,
          activity: 'water',
          run: () => {
            j.watered.push(i);
            this.sfx.splash();
            const plant = p;
            let t = 0;
            const grow = () => {
              t = Math.min(1, t + 0.05);
              plant.setWater(t);
              if (t < 1) requestAnimationFrame(grow);
            };
            grow();
            if (j.watered.length >= this.world.plants.length) {
              const mum = this.npcs.find((n) => n.def.id === 'mum')!;
              const pay = this.store.payFor('plants', job('plants').pay) * (this.store.has('gift') ? 2 : 1);
              this.store.finishJob('plants');
              this.store.gainXp('plants', 12);
              this.pay(pay, 'سقاية الزرع', mum.pos);
              void this.speakLine(this.store.s.player.gender === 'm' ? 'تسلم يا عيني، الزرع ارتوى! هذا مصروفك.' : 'تسلمين يا عيني، الزرع ارتوى! هذا مصروفك.', { gender: 'f', key: 'mum', pitch: 1.12, rate: 1 });
              this.job = null;
              this.beacons.clear('job');
            }
          },
        });
      });
    } else if (j.kind === 'trash') {
      if (!j.carrying)
        for (const b of j.bags)
          out.push({
            key: 'bag',
            label: 'شيل كيس الزبالة',
            x: b.position.x,
            z: b.position.z,
            r: 1.5,
            run: () => {
              j.bags.splice(j.bags.indexOf(b), 1);
              b.removeFromParent();
              const carried = makeTrashBag();
              carried.scale.setScalar(0.7);
              this.player.carry(carried);
              this.player.setRide('none');
              j.carrying = true;
            },
          });
      else
        out.push({
          key: 'bin',
          label: 'ارمِ الكيس بالحاوية',
          x: HOME.streetBin.x,
          z: HOME.streetBin.z,
          r: 2,
          run: () => {
            this.player.carry(null);
            j.carrying = false;
            j.delivered++;
            this.sfx.pop();
            if (j.delivered >= 2) {
              const pay = this.store.payFor('trash', job('trash').pay) * (this.store.has('gift') ? 2 : 1);
              this.store.finishJob('trash');
              this.store.gainXp('trash', 8);
              this.pay(pay, 'طلّعت الزبالة', this.player.pos);
              this.hud.toast('ماما: «تسلم يا عيني!»', 'good');
              this.job = null;
              this.beacons.clear('job');
            }
          },
        });
    } else if (j.kind === 'delivery' && j.customer) {
      out.push({ key: 'deliver', label: 'سلّم الطلب للزبون', x: j.customer.root.position.x, z: j.customer.root.position.z, r: 3.4, run: () => this.completeDelivery() });
    } else if (j.kind === 'sweep') {
      for (const p of j.piles)
        out.push({
          key: 'pile',
          label: 'كنّس الشعر',
          x: p.position.x,
          z: p.position.z,
          r: 1.4,
          work: 0.9,
          activity: 'sweep',
          run: () => {
            j.piles.splice(j.piles.indexOf(p), 1);
            p.removeFromParent();
            this.sfx.scrub();
            if (!j.piles.length) {
              const barber = this.npcs.find((n) => n.def.id === 'barber')!;
              this.store.finishJob('barber');
              this.store.gainXp('barber', 8);
              this.pay(this.store.payFor('barber', job('barber').pay), 'ترتيب الصالون', barber.pos);
              void this.speakLine('تسلم إيدك! الصالون بقى بيلمع.', { gender: 'm', key: 'barber', pitch: 0.94, rate: 1.05 });
              this.job = null;
              this.beacons.clear('job');
            }
          },
        });
    }
    return out;
  }

  private updateJob(dt: number): void {
    const j = this.job;
    if (!j) return;
    if (j.kind === 'plants') {
      const left = this.world.plants.map((p, i) => ({ p, i })).filter(({ i }) => !j.watered.includes(i));
      this.syncJobBeacons(left.map(({ p, i }) => ({ id: `job-plant${i}`, x: p.x, z: p.z, icon: '💧' })));
    } else if (j.kind === 'trash') {
      this.syncJobBeacons(j.carrying ? [{ id: 'job-bin', x: HOME.streetBin.x, z: HOME.streetBin.z, icon: '🗑️' }] : j.bags.map((b, i) => ({ id: `job-bag${i}`, x: b.position.x, z: b.position.z, icon: '🛍️' })));
    } else if (j.kind === 'errand') {
      const e = this.store.s.errand;
      if (!e) {
        this.job = null;
        this.beacons.remove('dest');
        return;
      }
      const have = this.errandReady();
      const target = have ? PLACE_BY_ID.get('home')! : PLACE_BY_ID.get('grocery')!;
      const b = this.beacons.list.get('dest');
      if (!b || Math.abs(b.pos.x - (have ? HOME.mum.x : target.x)) > 0.5) {
        this.beacons.set('dest', have ? HOME.mum.x : target.x, have ? HOME.mum.z : target.z, have ? '🏠' : '🛒', have ? 'ارجع لأمك' : 'بقالة النور');
      }
    } else if (j.kind === 'delivery') {
      j.left -= dt;
      const d = Math.hypot(j.door.x - this.player.pos.x, j.door.z - this.player.pos.z);
      if (!j.customer && d < 9) {
        // The customer comes out to the gate.
        const p = makePasserby(this.rng, `cust-${this.time}`);
        const c = new Character(p.look);
        const off = 1.2;
        c.root.position.set(j.door.x + Math.sin(j.door.facing) * off, 0, j.door.z + Math.cos(j.door.facing) * off);
        c.root.rotation.y = j.door.facing;
        c.root.userData.gender = p.gender;
        c.root.userData.key = p.key;
        c.root.userData.pitch = p.voice.pitch;
        this.scene.add(c.root);
        j.customer = c;
      }
      j.customer?.update(dt, { speed: 0, talking: false, activity: 'wave', riding: 'none', sitting: false, airborne: false });
    } else if (j.kind === 'wash') {
      j.left -= dt;
      if (j.left <= 0) this.finishWash(true);
    } else if (j.kind === 'sweep') {
      this.syncJobBeacons(j.piles.map((p, i) => ({ id: `job-pile${i}`, x: p.position.x, z: p.position.z, icon: '🧹' })));
    }
  }

  private syncJobBeacons(list: { id: string; x: number; z: number; icon: string }[]): void {
    const keep = new Set(list.map((l) => l.id));
    for (const id of [...this.beacons.list.keys()]) if (id.startsWith('job-') && !keep.has(id)) this.beacons.remove(id);
    for (const l of list) if (!this.beacons.list.has(l.id)) this.beacons.set(l.id, l.x, l.z, l.icon, '', { height: 6, primary: true });
  }

  private updateObjective(): void {
    const j = this.job;
    if (!j) {
      const dest = this.beacons.list.get('dest');
      this.hud.setObjective(dest ? `📍 ${dest.label}` : null, null, false);
      return;
    }
    switch (j.kind) {
      case 'plants':
        return this.hud.setObjective(`💧 اسقِ الزرع: ${j.watered.length}/${this.world.plants.length}`, null, true);
      case 'trash':
        return this.hud.setObjective(j.carrying ? '🗑️ ودِّ الكيس للحاوية الخضرا برا' : `🛍️ شيل أكياس الزبالة: ${j.delivered}/2`, null, true);
      case 'errand': {
        const e = this.store.s.errand;
        if (!e) return this.hud.setObjective(null);
        const ready = this.errandReady();
        const missing = e.items.filter((i) => this.store.count(i) < e.items.filter((x) => x === i).length).map((i) => item(i).name);
        return this.hud.setObjective(ready ? '🏠 ارجع لأمك بالأغراض' : `🛒 اشترِ من بقالة النور: ${[...new Set(missing)].join('، ')}`, null, true);
      }
      case 'delivery':
        return this.hud.setObjective(`🥡 وصّل الطلب لـ${j.door.name}`, j.left, true);
      case 'wash':
        return this.hud.setObjective(`🧽 نظّف البقع: ${j.total - j.spots.length}/${j.total} — امسحها بالسحب`, j.left, true);
      case 'sweep':
        return this.hud.setObjective(`🧹 كنّس الشعر: ${6 - j.piles.length}/6`, null, true);
    }
  }

  private errandReady(): boolean {
    const e = this.store.s.errand;
    if (!e) return false;
    const need = new Map<ItemId, number>();
    for (const i of e.items) need.set(i, (need.get(i) ?? 0) + 1);
    for (const [id, n] of need) if (this.store.count(id) < n) return false;
    return true;
  }

  private completeErrand(from: Vector3): void {
    const e = this.store.s.errand;
    if (!e) return;
    for (const i of e.items) this.store.takeItem(i);
    this.store.s.errand = null;
    const pay = this.store.payFor('errand', job('errand').pay) * (this.store.has('gift') ? 2 : 1);
    this.store.finishJob('errand');
    this.store.gainXp('errand', 10);
    this.pay(pay, 'مقاضي البيت', from);
    if (this.job?.kind === 'errand') this.job = null;
    this.beacons.remove('dest');
  }

  // Delivery ------------------------------------------------------------------

  private startDelivery(): void {
    const shop = PLACE_BY_ID.get('shawarma')!;
    const doors = DELIVERY_DOORS.filter((d) => Math.hypot(d.x - shop.x, d.z - shop.z) > 25);
    const door = this.rng.pick(doors);
    const dist = Math.abs(door.x - shop.x) + Math.abs(door.z - shop.z) * 1.2;
    const speed = this.store.has('scooter') ? SPEEDS.scooter * 0.8 : this.store.has('bike') ? SPEEDS.bike * 0.8 : SPEEDS.run * 0.85;
    const limit = timeLimit(dist, speed);
    const bag = new Mesh(new BoxGeometry(0.32, 0.28, 0.2), solid('#c9a46a', 0.9));
    this.player.carry(bag);
    this.job = { kind: 'delivery', door, limit, left: limit, customer: null, bag };
    this.beacons.set('job-door', door.x, door.z, '🥡', door.name, { color: '#ff9a4d' });
    this.hud.toast(`وصّل الطلب لـ${door.name} خلال ${limit} ثانية!`);
  }

  private completeDelivery(): void {
    const j = this.job;
    if (j?.kind !== 'delivery') return;
    const base = this.store.payFor('delivery', job('delivery').pay);
    const r = deliveryPay(base, j.left, j.limit, this.store.tipFactor(), this.store.has('phone'));
    this.player.carry(null);
    const custPos = j.customer ? j.customer.root.position.clone() : new Vector3(j.door.x, 0, j.door.z);
    this.pay(r.wage + r.tip, r.tip ? 'توصيل + بقشيش' : 'توصيل', custPos);
    this.store.finishJob('delivery');
    this.store.gainXp('delivery', j.left > 0 ? 12 : 4);
    this.store.bump('deliveries');
    if (j.left > j.limit / 2) this.store.bump('fastDeliveries');
    const c = j.customer;
    const line = j.left > 0 ? this.rng.pick(['يعطيك العافية، وصلت بسرعة!', 'تسلم! بعده حار.', 'مشكور، هذا بقشيشك.']) : 'تأخرت شوي، الأكل برد… بس مشكور.';
    if (c) void this.speakLine(line, { gender: c.root.userData.gender, key: c.root.userData.key, pitch: c.root.userData.pitch, rate: 1 });
    this.hud.toast(`${line} (${formatMoney(r.wage)}${r.tip ? ` + بقشيش ${formatMoney(r.tip)}` : ''})`, j.left > 0 ? 'good' : 'bad');
    this.beacons.clear('job');
    this.job = null;
    setTimeout(() => c?.root.removeFromParent(), 3000);
    setTimeout(() => {
      if (!this.job && this.store.jobBlock('delivery') === null) {
        this.hud.toast('أبو أحمد: عندي طلب ثاني جاهز، تعال!', 'info');
        this.markPlace('shawarma');
      }
    }, 3500);
  }

  // Car washing ---------------------------------------------------------------

  private washYaw = 0;

  private startWash(id: 'carwash' | 'hamadcar'): void {
    const car = id === 'hamadcar' ? this.world.hamadCar : this.world.washCar;
    const L = car.userData.length as number;
    const W = car.userData.width as number;
    const top = car.userData.bodyTop as number;
    const roof = car.userData.height as number;
    const spots: Mesh[] = [];
    const mat = new MeshStandardMaterial({ color: '#6b5236', roughness: 1, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const n = id === 'hamadcar' ? 14 : 11;
    for (let i = 0; i < n; i++) {
      const m = new Mesh(new CircleGeometry(this.rng.range(0.2, 0.36), 12), mat.clone());
      const face = i % 5;
      if (face === 0 || face === 1) {
        const side = face === 0 ? 1 : -1;
        m.position.set(this.rng.range(-L * 0.42, L * 0.42), this.rng.range(0.45, top - 0.1), side * (W / 2 + 0.012));
        m.rotation.y = side > 0 ? 0 : Math.PI;
      } else if (face === 2) {
        m.position.set(this.rng.range(L * 0.15, L * 0.45), top + 0.012, this.rng.range(-W * 0.35, W * 0.35));
        m.rotation.x = -Math.PI / 2;
      } else if (face === 3) {
        m.position.set(this.rng.range(-L * 0.2, L * 0.1), roof + 0.012, this.rng.range(-W * 0.3, W * 0.3));
        m.rotation.x = -Math.PI / 2;
      } else {
        const side = this.rng.chance(0.5) ? 1 : -1;
        m.position.set(side * (L / 2 + 0.012), this.rng.range(0.5, top - 0.1), this.rng.range(-W * 0.35, W * 0.35));
        m.rotation.y = side * (Math.PI / 2);
      }
      car.add(m);
      spots.push(m);
    }
    this.washYaw = Math.atan2(this.player.pos.x - car.position.x, this.player.pos.z - car.position.z);
    this.job = { kind: 'wash', job: id, car, spots, total: spots.length, left: id === 'hamadcar' ? 60 : 50 };
    this.player.activity = 'scrub';
    const left = h('button.btn.secondary', { type: 'button', onpointerdown: () => (this.washYaw += 0.6) }, '⟲ لف');
    const right = h('button.btn.secondary', { type: 'button', onpointerdown: () => (this.washYaw -= 0.6) }, 'لف ⟳');
    const done = h('button.btn.warm', { type: 'button', onclick: () => this.finishWash(true) }, 'خلصت');
    this.washBar = h('div.chip', { style: 'position:absolute;bottom:calc(16px + var(--safe-b));left:50%;transform:translateX(-50%);display:flex;gap:8px;padding:8px;z-index:20' }, left, right, done);
    this.ui.append(this.washBar);
    this.hud.toast('اسحب على البقع البنية عشان تنظفها. لف حول السيارة بالأزرار أو A/D.');
  }

  private frameWash(): void {
    const j = this.job;
    if (j?.kind !== 'wash') return;
    const c = j.car.position;
    this.rig.focus = { point: new Vector3(c.x, 0.9, c.z), yaw: this.washYaw, pitch: 0.42, dist: 6.2 };
    // Stand the player off to one side so the car stays in full view.
    const side = this.washYaw + 1.15;
    this.player.place(c.x + Math.sin(side) * 2.7, c.z + Math.cos(side) * 2.7, side + Math.PI);
  }

  private scrubAt(x: number, y: number): void {
    const j = this.job;
    if (j?.kind !== 'wash') return;
    const ndc = new Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(j.spots, false);
    if (!hits.length) return;
    const spot = hits[0].object as Mesh;
    const m = spot.material as MeshStandardMaterial;
    m.opacity -= 0.16;
    this.particles.emit(hits[0].point, 'foam', 2);
    if (Math.random() < 0.3) this.sfx.scrub();
    if (m.opacity <= 0.08) {
      spot.removeFromParent();
      j.spots.splice(j.spots.indexOf(spot), 1);
      this.particles.emit(hits[0].point, 'sparkle', 6);
      this.sfx.pop();
      if (!j.spots.length) this.finishWash(true);
    }
  }

  private finishWash(paid: boolean, silent = false): void {
    const j = this.job;
    if (j?.kind !== 'wash') return;
    for (const s of j.spots) s.removeFromParent();
    this.washBar?.remove();
    this.washBar = null;
    this.player.activity = 'none';
    this.job = null;
    if (!paid || silent) return;
    const cleaned = (j.total - j.spots.length) / j.total;
    const base = this.store.payFor(j.job, job(j.job).pay);
    const r = washPay(base, cleaned, j.left, this.store.tipFactor());
    const boss = this.npcs.find((n) => n.def.id === (j.job === 'hamadcar' ? 'hamad' : 'carwash'))!;
    if (r.wage > 0) {
      this.pay(r.wage + r.tip, j.job === 'hamadcar' ? 'غسيل سيارة العم حمد' : 'غسيل سيارة', boss.pos);
      this.store.finishJob(j.job);
      this.store.gainXp(j.job, cleaned >= 1 ? 14 : 6);
      this.store.bump('carsWashed');
      const line = cleaned >= 1 ? 'تلمع مثل الجديدة! الله يعطيك العافية.' : 'زينة، بس بقت بقع. المرة الجاية أحسن.';
      void this.speakLine(line, { gender: 'm', key: boss.def.id, pitch: boss.def.voice.pitch, rate: 1 });
      this.hud.toast(`${line} (+${formatMoney(r.wage + r.tip)})`, 'good');
    } else this.hud.toast('السيارة بعدها وسخة، ما حسبها لك.', 'bad');
    if (j.job === 'carwash') {
      // A new customer's car arrives.
      const paint = this.rng.pick(CAR_COLORS);
      j.car.traverse((o) => {
        if (o instanceof Mesh && (o.material as MeshStandardMaterial).metalness === 0.35) {
          const m = (o.material as MeshStandardMaterial).clone();
          m.color = new Color(paint);
          o.material = m;
        }
      });
    }
  }

  // Stall, recycling, wallets, notes --------------------------------------------

  private openStall(): void {
    if (!this.store.has('stall')) {
      this.hud.toast('تحتاج بسطة أول: رحيم بالبقالة يبيعها بـ200 درهم.', 'bad');
      return;
    }
    this.openOverlay((root, env) => new StallGame(root, env, () => this.afterWork()));
  }

  private recycle(): void {
    const n = this.store.count('cans');
    if (!n) {
      this.hud.toast('ما معك علب. امشِ فوق العلب الفاضية اللي بالشارع عشان تجمعها.');
      return;
    }
    this.store.takeItem('cans', n);
    this.store.bump('cansRecycled', n);
    this.store.gainXp('recycle', n);
    this.store.finishJob('recycle');
    this.pay(n, 'إعادة تدوير', new Vector3(33, 0, -9.4));
    this.hud.toast(`الآلة طلّعت ${formatMoney(n)} على ${n} علب. شكراً لأنك تحافظ على نظافة الفريج!`, 'good');
  }

  private collect(it: GroundItem): void {
    if (it.kind === 'can') {
      this.store.addItem('cans');
      this.sfx.pop();
      const n = this.store.count('cans');
      if (n === 1 || n % 5 === 0) this.hud.toast(`🥫 معك ${n} علب. حطها بآلة التدوير جنب موقف الباص.`);
    } else if (it.kind === 'note') {
      this.store.earn(it.value, 'ورقة طايرة بالهوا');
      this.sfx.note();
      this.particles.emit(new Vector3(it.x, 0.6, it.z), 'sparkle', 8);
      this.hud.toast(`لقطت ${formatMoney(it.value)} طايرة بالهوا! 🍃`, 'good');
    }
  }

  private updateWallet(dt: number): void {
    this.walletTimer -= dt;
    const dropped = this.ground.items.some((i) => i.kind === 'wallet');
    if (this.walletTimer < 0 && !dropped && !this.walletOwner && this.store.count('wallet') === 0) {
      this.walletTimer = this.rng.range(240, 420);
      const far = this.peds.walkers.filter((w) => w.active && Math.hypot(w.pos.x - this.player.pos.x, w.pos.z - this.player.pos.z) > 20 && Math.abs(w.pos.z) < 11);
      if (far.length) {
        const w = this.rng.pick(far);
        w.ownsWallet = true;
        this.walletOwner = w;
        this.ground.dropWallet(w.pos.x, w.pos.z + (w.pos.z < 0 ? -0.6 : 0.6));
      }
    }
    for (const it of this.ground.items) if (it.kind === 'wallet' && Math.random() < dt * 2) this.particles.emit(new Vector3(it.x, 0.3, it.z), 'sparkle', 1);
    if (this.walletOwner && this.store.count('wallet') > 0) {
      const b = this.beacons.list.get('owner');
      if (b) this.beacons.move('owner', this.walletOwner.pos.x, this.walletOwner.pos.z);
    }
  }

  private pickWallet(it: GroundItem): void {
    this.ground.remove(it);
    this.store.addItem('wallet');
    this.sfx.pop();
    const owner = this.walletOwner;
    if (owner) {
      this.beacons.set('owner', owner.pos.x, owner.pos.z, '👛', `صاحب المحفظة: ${owner.p.name}`, { color: '#7fd3ff' });
      this.hud.toast(`لقيت محفظة! فيها بطاقة باسم ${owner.p.name}. صاحبها ماشي بالشارع، رجّعها له.`, 'info');
    }
  }

  private returnWallet(from: Vector3): void {
    if (!this.store.takeItem('wallet')) return;
    this.store.bump('walletsReturned');
    this.store.rep(8);
    this.pay(50, 'مكافأة الأمانة', from);
    if (this.walletOwner) this.walletOwner.ownsWallet = false;
    this.walletOwner = null;
    this.beacons.remove('owner');
    this.hud.toast('رجّعت الأمانة لأهلها. سمعتك بالفريج ارتفعت! 🤝', 'good');
  }

  // Places, sleep, upgrades --------------------------------------------------

  markPlace(id: PlaceId, label?: string): void {
    const p = PLACE_BY_ID.get(id);
    if (!p) return;
    this.beacons.set('dest', p.x, p.z, p.icon, label ?? p.name);
    this.hud.toast(`📍 حطيت علامة على ${p.name}`);
  }

  private sleep(): void {
    const fade = h('div', { style: 'position:absolute;inset:0;background:#000;opacity:0;transition:opacity .8s;z-index:90;display:grid;place-items:center;color:#f6ead2;font:400 34px var(--display)' }, 'تصبح على خير… 🌙');
    this.ui.append(fade);
    requestAnimationFrame(() => (fade.style.opacity = '1'));
    setTimeout(() => {
      this.store.sleep();
      this.player.place(HOME.spawn.x, HOME.spawn.z, HOME.spawn.heading);
      this.player.stamina = this.player.staminaMax;
      this.save();
      fade.style.opacity = '0';
      setTimeout(() => fade.remove(), 900);
    }, 1200);
  }

  private onUpgrade(id: string, silent = false): void {
    if (id === 'stall') this.world.stall.visible = true;
    if (id === 'sneakers') this.player.staminaMax = 150;
    if ((id === 'bike' || id === 'scooter') && !silent) this.hud.toast('اضغط B عشان تركب. 🚲');
    if (id === 'shop') {
      this.buildKiosk();
      if (!silent) this.celebrate();
    }
  }

  private buildKiosk(): void {
    if (this.kiosk) return;
    const g = new Group();
    const body = new Mesh(new BoxGeometry(6, 3.2, 4), solid('#f1e6cf', 0.8));
    body.position.y = 1.6;
    const roof = new Mesh(new BoxGeometry(6.6, 0.3, 4.6), solid('#1e7b4e', 0.6));
    roof.position.y = 3.35;
    const tex = signTexture(`كشك ${this.store.s.player.name}`, '#1e7b4e', '#ffe9a6', 'MY OWN SHOP');
    const sign = new Mesh(new BoxGeometry(5.6, 1.05, 0.12), new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new Color('#ffffff'), emissiveIntensity: 0.3 }));
    sign.position.set(0, 4.1, 2.05);
    g.add(body, roof, sign);
    g.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = o.receiveShadow = true;
    });
    g.position.set(39, 0, -16);
    this.scene.add(g);
    this.kiosk = g;
  }

  private celebrate(): void {
    const conf = h('div.confetti');
    const colors = ['#b07a3e', '#3f9150', '#3f86b8', '#7a5aa6', '#c2453c', '#8c9a3a', '#2c4f8a', '#4f7f73'];
    for (let i = 0; i < 70; i++) conf.append(h('i', { style: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDuration: `${2.5 + Math.random() * 3}s`, animationDelay: `${Math.random() * 1.5}s` } }));
    this.ui.append(conf);
    setTimeout(() => conf.remove(), 7000);
    this.sfx.level();
    this.openOverlay((root) => {
      const ov = new Overlay(root, 'مبروك! 🎉', 'صار عندك محلك الخاص');
      const s = this.store.s;
      ov.body.append(
        h(
          'div.celebrate',
          h('div.big', 'كشك ' + s.player.name),
          h('p', `من أول درهم لين محلك الخاص، كله من تعبك وشغلك الحلال. جمعت بالمجموع ${formatMoney(s.earnedTotal)} بـ${s.day} يوم.`),
          h('p.muted', 'المحل يعطيك 300 درهم كل يوم بالبنك. كمّل اللعب: باقي إنجازات، وجدك يبي يشوفك!'),
          h('button.btn', { type: 'button', onclick: () => ov.close() }, 'الحمد لله'),
        ),
      );
      return { ov };
    });
    void this.speakLine('مبروك يا بطل! صار عندك محلك الخاص.', { gender: 'm', key: 'grandpa', pitch: 0.72, rate: 0.9 });
  }

  private lampTimer = 0;

  private updateLampLights(): void {
    const night = this.sky.night;
    if (--this.lampTimer <= 0) {
      this.lampTimer = 20;
      const p = this.player.pos;
      const near = [...this.world.lamps].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      this.lampLights.forEach((l, i) => near[i] && l.position.set(near[i].x, near[i].y - 0.4, near[i].z));
    }
    for (const l of this.lampLights) l.intensity = night * 60;
  }

  // ------------------------------------------------------------------ HUD helpers

  private updateLabels(): void {
    if (!this.settings.labels) return;
    const list: LabelInfo[] = [];
    const cam = this.camera.position;
    for (const n of this.npcs) {
      if (!n.present || (this.talk?.kind === 'npc' && this.talk.ent === n)) continue;
      const d = n.pos.distanceTo(cam);
      if (d > 30) continue;
      n.headPosition(this.tmp);
      this.tmp.y += 0.45;
      this.tmp.project(this.camera);
      if (this.tmp.z > 1 || Math.abs(this.tmp.x) > 1.1 || Math.abs(this.tmp.y) > 1.1) continue;
      const jobs = n.def.jobs;
      let jobState: LabelInfo['job'] = null;
      if (jobs.length) jobState = jobs.some((j) => this.store.jobBlock(j) === null) ? 'open' : jobs.every((j) => this.store.jobBlock(j) === 'closed') ? 'closed' : null;
      list.push({ key: n.def.id, x: ((this.tmp.x + 1) / 2) * innerWidth, y: ((1 - this.tmp.y) / 2) * innerHeight, name: n.def.name, sub: d < 14 ? n.def.title : '', job: jobState, scale: clamp(1.25 - d / 40, 0.6, 1.1) });
    }
    const owner = this.walletOwner;
    if (owner && this.store.count('wallet') > 0) {
      this.tmp.set(owner.pos.x, owner.pos.y + 2.3, owner.pos.z).project(this.camera);
      if (this.tmp.z < 1) list.push({ key: 'owner', x: ((this.tmp.x + 1) / 2) * innerWidth, y: ((1 - this.tmp.y) / 2) * innerHeight, name: `👛 ${owner.p.name}`, sub: 'صاحب المحفظة', job: null, scale: 1 });
    }
    this.hud.setLabels(list);
  }

  private updateArrow(): void {
    const b = this.beacons.primary(this.player.pos);
    if (!b || this.talk || this.overlay) return this.hud.setArrow(0, 0, null, 0);
    const d = Math.hypot(b.pos.x - this.player.pos.x, b.pos.z - this.player.pos.z);
    if (d < 4) return this.hud.setArrow(0, 0, null, 0);
    this.tmp.set(b.pos.x, 2.5, b.pos.z).project(this.camera);
    const behind = this.tmp.z > 1;
    let x = this.tmp.x;
    let y = this.tmp.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    // On screen the beacon speaks for itself; the arrow only guides toward off-screen ones.
    if (!behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.9) return this.hud.setArrow(0, 0, null, 0);
    const ang = Math.atan2(-y, x);
    const m = Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
    const ex = (Math.cos(ang) / m) * 0.86;
    const ey = (Math.sin(ang) / m) * 0.8;
    this.hud.setArrow(((ex + 1) / 2) * innerWidth, ((ey + 1) / 2) * innerHeight, ang + Math.PI / 2, d);
  }
}

