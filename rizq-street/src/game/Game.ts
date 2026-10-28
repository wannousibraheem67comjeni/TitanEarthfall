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
  Plane,
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
import { GuideBrain } from '../dialogue/GuideBrain';
import type { GuideAction, MoveDir } from '../dialogue/guide';
import { ApiBackend, ArtifactBackend, type LlmBackend } from '../dialogue/llm';
import { NPCS } from '../dialogue/npcs';
import { makePasserby } from '../dialogue/pedestrians';
import type { Action, Speaker } from '../dialogue/brain';
import { fillTemplate, formatMoney, normalizeArabic, setArabicDigits } from '../lang/arabic';
import { analyze } from '../lang/intents';
import { Mic, type MicPermission } from '../voice/mic';
import { SpeechInput, SpeechOutput, MIC_ERROR_TEXT, type MicError, type VoiceProfile } from '../voice/speech';
import { Character } from '../world/characters';
import type { CircleCollider } from '../world/collision';
import { BARBER_FLOOR, BOUNDS, COMPANY, DELIVERY_DOORS, HOME, HOUSE, insideHouse, PLACES, PLACE_BY_ID, STALL_SPOT, type DeliveryDoor, type PlaceId } from '../world/layout';
import { solid } from '../world/materials';
import { CAR_COLORS, makeTrashBag } from '../world/props';
import { Sky } from '../world/sky';
import { buildWorld, type WorldRefs } from '../world/World';
import { signTexture } from '../world/textures';
import { Hud, type LabelInfo } from '../ui/Hud';
import { DialoguePanel } from '../ui/DialoguePanel';
import { GuidePanel } from '../ui/GuidePanel';
import { GAME_URL } from '../ui/Intro';
import { Phone } from '../ui/Phone';
import { TouchControls } from '../ui/TouchControls';
import { h } from '../ui/dom';
import { Atm, GroceryShop, UpgradeShop } from '../ui/minigames/Commerce';
import { DealsBoard, JobBoard, TradeGame } from '../ui/minigames/Business';
import { CashierGame } from '../ui/minigames/CashierGame';
import { AccountingGame, InterviewGame, ReceptionGame, SalesGame } from '../ui/minigames/Company';
import { CoffeeGame, DishesGame, LaundryGame } from '../ui/minigames/House';
import { KarakGame } from '../ui/minigames/KarakGame';
import { LaptopGame } from '../ui/minigames/LaptopGame';
import { Overlay, type MiniEnv } from '../ui/minigames/Overlay';
import { PerfumeGame } from '../ui/minigames/PerfumeGame';
import { StallGame } from '../ui/minigames/StallGame';
import { TutorGame } from '../ui/minigames/TutorGame';
import { CameraRig } from './CameraRig';
import { isOpenAt, item, job, JOBS, UPGRADE_BY_ID, type ItemId, type JobId, type NpcId, type UpgradeId } from './catalog';
import { NpcEntity, Pedestrians, Traffic, type Walker } from './entities';
import { Beacons, GroundItems, MoneyFx, Particles, type GroundItem } from './fx';
import { Input } from './Input';
import { NavGraph, type Pt } from './Nav';
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
  | { kind: 'sweep'; job: 'barber' | 'sweep'; piles: Mesh[] }
  | { kind: 'tidy'; items: Mesh[]; held: number };

type Talk = { kind: 'npc'; ent: NpcEntity } | { kind: 'walker'; w: Walker };

/** The guide walking the player somewhere along waypoints. */
interface AutoWalk {
  path: Pt[];
  i: number;
  target: Pt;
  /** What to turn toward on arrival (a person, a desk). */
  face: Pt | null;
  label: string;
  onArrive: () => void;
  best: number;
  stuckT: number;
  mounted: boolean;
  warping: boolean;
}

const SANAD: VoiceProfile = { gender: 'm', key: 'sanad', pitch: 1, rate: 1.03 };
const GUIDE_SUGGESTIONS = ['أبي شغل أونلاين يجيب 1000 درهم بالشهر', 'ادخل البيت', 'شو في شغل على قدي؟', 'أبي أصير غني'];
/** Where to stand to use the laptop on the desk in the courtyard. */
const DESK_STAND = { x: -61.5, z: 22.8 };

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
  guide!: GuidePanel;
  guideBrain!: GuideBrain;
  nav!: NavGraph;
  private autoWalk: AutoWalk | null = null;
  private micBlocked = false;
  private guideShown = true;
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
  start(store: Store, mic: MicPermission = 'prompt'): void {
    this.store = store;
    this.speechIn.permission = mic;
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
    this.hud.onWallet = () => this.togglePhone();
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
      voiceInfo: () => ({ ...this.speechOut.describe(), lastError: this.speechOut.lastError }),
    });
    if (TouchControls.wanted()) this.touch = new TouchControls(this.ui, this.input, () => this.activate());
    this.ui.classList.toggle('touchmode', !!this.touch);
    this.nav = new NavGraph(this.world.colliders);
    this.guideBrain = new GuideBrain(store, this.rng);
    this.guide = new GuidePanel(
      this.ui,
      {
        submit: (t) => void this.askGuide(t),
        mic: () => void this.guideMic(),
        warp: () => this.warp(),
        stopWalk: () => this.stopWalk('button'),
      },
      !!this.touch,
    );
    if (this.touch) this.touch.addTop(this.guide.micBtn);
    else this.guide.dock(this.hud.prompt);
    this.input.onTap = (x, y) => this.handleTap(x, y);
    // From outside, the camera treats the whole house as solid (it would slip in through the doorway).
    this.rig.blockers = [{ minX: HOUSE.x0 - 0.2, maxX: HOUSE.x1 + 0.2, minY: 0, maxY: 8.4, minZ: HOUSE.z0 + 0.1, maxZ: HOUSE.z1 + 0.2 }];
    this.hud.onMapPick = (x, z) => this.mapPick(x, z);

    store.on('money', (e) => {
      if (e.delta > 0) this.checkGoal();
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
      this.markPlace('home', 'ادخل البيت وكلّم أمك بالمطبخ');
      this.beacons.move('dest', HOME.mum.x, HOME.mum.z);
    }
    this.running = true;
    this.renderer.setAnimationLoop(() => this.frame());
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.renderer.domElement.focus({ preventScroll: true });
    this.hud.refreshGoal();
    const first = !s.flags.onboarded;
    s.flags.onboarded = true;
    setTimeout(() => void this.welcome(first, mic), 700);
  }

  /** The street greets the player by name, then asks what work they would like. */
  private async welcome(first: boolean, mic: MicPermission): Promise<void> {
    await this.guideSay(this.fill(first ? 'أهلاً بيك يا {name}!' : 'أهلاً بيك يا {name}، نوّرت{|ي} الفريج من جديد!'), [], false);
    await new Promise((r) => setTimeout(r, 300));
    if (this.talk || this.overlay) return;
    const ask = this.fill('وش حاب{|ة} تشتغل{|ين}؟');
    const canTalk = mic === 'granted' || (mic === 'prompt' && Mic.supported());
    this.guide.invite(canTalk);
    await this.guideSay(ask, ['أبي شغل أونلاين', 'أبي أساعد أهلي بالبيت', 'أبي شغل بشركة', 'شو في شغل على قدي؟'], false, `${ask} ${this.touch ? 'اضغط الزر البرتقالي' : 'اضغط زر 🎤 تكلم'} وقول لي بصوتك.`);
    if (!canTalk) this.guide.focusInput(this.micProblem(mic === 'nomic' ? 'nomic' : mic === 'unsupported' ? 'unsupported' : 'denied'));
    this.showWalkHint();
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
    const azure = st.azureKey ? { key: st.azureKey, region: st.azureRegion || 'uaenorth' } : null;
    this.speechIn.azure = azure;
    this.speechOut.azure = azure;
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
    let b: LlmBackend | null = null;
    if (this.settings.brain !== 'offline') b = this.settings.apiKey ? new ApiBackend(this.settings.apiKey, this.settings.apiModel) : await ArtifactBackend.detect();
    this.dm.backend = b;
    if (this.guideBrain) this.guideBrain.backend = b;
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
      if (e.code === 'KeyV' && !this.vHeld && !e.repeat && !this.overlay && !this.phone.isOpen) {
        this.vHeld = true;
        void (this.talk ? this.micTurn() : this.guideMic());
        return;
      }
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !this.talk && !this.overlay && !this.phone.isOpen && this.guideShown) {
        e.preventDefault();
        this.guide.focusInput();
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
    let move = frozen ? { x: 0, y: 0 } : this.input.axis();
    let run = this.input.running;
    // Press and hold on the street: walk toward the finger.
    const steer = !frozen && Math.hypot(move.x, move.y) < 0.2 ? this.steerMove() : null;
    if (steer) {
      if (this.autoWalk) this.stopWalk('manual');
      move = steer.move;
      run = steer.run;
    }
    if (this.autoWalk && !frozen) {
      // Any key or stick input means the player wants to walk themselves.
      if (Math.hypot(move.x, move.y) > 0.2) this.stopWalk('manual');
      else {
        move = this.walkMove(dt);
        run = true;
      }
    }
    this.player.update(dt, move, run, this.input.hit('Space') || this.input.touchJump, this.rig.yaw, this.world.colliders, this.obstacles, speedMul);
    if (this.player.speed > 0.5 && this.player.ride === 'none' && !this.player.airborne) {
      this.stepTimer -= dt * this.player.speed;
      if (this.stepTimer < 0) {
        this.stepTimer = 1.4;
        this.sfx.step(this.player.pos.y < 0.1);
      }
    }

    // Inside the house the roof comes off and the camera looks down into the rooms.
    const inside = insideHouse(this.player.pos.x, this.player.pos.z);
    if (inside !== this.inside) {
      this.inside = inside;
      this.world.house.upper.visible = !inside;
      this.rig.indoor = inside;
      this.lampTimer = 0;
    }
    if (!this.walkedHint && this.hintEl) {
      this.walkedDist += this.player.speed * dt;
      if (this.walkedDist > 14) this.dropWalkHint();
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
    const showGuide = !paused && !this.talk && this.job?.kind !== 'wash' && !this.hud.mapOpen;
    if (showGuide !== this.guideShown) {
      this.guideShown = showGuide;
      this.guide.setVisible(showGuide);
      if (!showGuide) this.guide.blurInput();
    }
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
    return JOBS.filter((j) => j.daily && this.store.jobBlock(j.id) === null).length;
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
    if (h24 >= 19 || h24 < 5) list.push({ key: 'sleep', label: 'نام لين الصبح', x: HOUSE.bed.x, z: HOUSE.bed.z, r: 2.6, run: () => this.sleep() });
    list.push({ key: 'jobboard', label: 'شوف لوحة الوظائف', x: COMPANY.board.x, z: COMPANY.board.z, r: 2.2, run: () => this.openBoard() });
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

  private startTalk(t: Talk, offer: JobId | null = null): void {
    if (this.talk) return;
    this.sfx.unlock();
    this.stopWalk();
    if (this.speechIn.listening) this.speechIn.abort();
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
    const turn = offer && sp.kind === 'npc' ? this.dm.openWithOffer(sp, offer) : this.dm.open(sp);
    this.showTurn(turn, t);
    if (!offer) this.panel.focusInput();
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
          setTimeout(() => {
            if (this.talk === t) this.endTalk();
            if (a.shop === 'deals') this.openDeals();
            else if (a.shop === 'jobboard') this.openBoard();
            else this.openOverlay((root, env) => (a.shop === 'grocery' ? new GroceryShop(root, env) : new UpgradeShop(root, env)));
          }, 1400);
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
      const text = await this.speechIn.listen(
        (i) => this.panel.setListening(true, i),
        (l) => this.panel.setLevel(l),
      );
      this.panel.setListening(false);
      this.sfx.micOff();
      if (text) await this.send(text, true);
      else if (this.handsFree && this.talk) this.panel.setMicAvailable(true, 'ما سمعت شي. اضغط 🎤 أو تكلم مرة ثانية.');
    } catch (e) {
      this.panel.setListening(false);
      const code = (typeof e === 'string' ? e : 'other') as MicError;
      this.panel.setMicAvailable(code !== 'unsupported' && code !== 'denied', code === 'denied' || code === 'unsupported' || code === 'nomic' ? this.micProblem(code) : (MIC_ERROR_TEXT[code] ?? MIC_ERROR_TEXT.other));
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
        this.job = { kind: 'sweep', job: 'barber', piles };
        this.hud.toast('كنّس الشعر من الرصيف قدام الصالون: قرّب من كل كومة واضغط E.');
        break;
      }
      case 'sweep': {
        const piles = HOUSE.dust.map((d) => {
          const m = new Mesh(new SphereGeometry(0.34, 8, 4), solid('#a8957a', 1));
          m.scale.set(1, 0.16, 1);
          m.position.set(d.x, 0.08, d.z);
          this.scene.add(m);
          return m;
        });
        this.job = { kind: 'sweep', job: 'sweep', piles };
        this.hud.toast('كنّس الغبار بالصالة والمطبخ وغرفتك: قرّب من كل كومة واضغط E.');
        break;
      }
      case 'tidy': {
        const colors = ['#d8352b', '#2f7fb8', '#3f9150', '#e0a526', '#7a5aa6'];
        const items = HOUSE.mess.map((p, i) => {
          const m = new Mesh(i % 2 ? new BoxGeometry(0.4, 0.12, 0.3) : new SphereGeometry(0.16, 10, 8), solid(colors[i], 0.7));
          m.position.set(p.x, i % 2 ? 0.1 : 0.17, p.z);
          m.rotation.y = this.rng.range(0, Math.PI);
          m.castShadow = true;
          this.scene.add(m);
          return m;
        });
        this.job = { kind: 'tidy', items, held: 0 };
        this.hud.toast('شيل الأغراض المرمية بغرفتك (E) وحطها بالكبت.');
        break;
      }
      case 'dishes':
        return this.openOverlay((root, env) => new DishesGame(root, env, () => this.afterWork()));
      case 'laundry':
        return this.openOverlay((root, env) => new LaundryGame(root, env, () => this.afterWork()));
      case 'coffee':
        return this.openOverlay((root, env) => new CoffeeGame(root, env, () => this.afterWork()));
      case 'trade':
        return this.openOverlay((root, env) => new TradeGame(root, env, () => this.afterWork()));
      case 'reception':
      case 'sales':
      case 'accounting':
        if (!this.store.s.flags.companyHired) return this.openOverlay((root, env) => new InterviewGame(root, env, () => setTimeout(() => this.startJob('reception'), 50)));
        return this.openOverlay((root, env) => (id === 'reception' ? new ReceptionGame(root, env, () => this.afterWork()) : id === 'sales' ? new SalesGame(root, env, () => this.afterWork()) : new AccountingGame(root, env, () => this.afterWork())));
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
    if (j.kind === 'tidy') {
      for (const m of j.items) m.removeFromParent();
      this.player.carry(null);
    }
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
    } else if (j.kind === 'tidy') {
      for (const m of j.items)
        out.push({
          key: 'mess',
          label: 'شيل الغرض',
          x: m.position.x,
          z: m.position.z,
          r: 1.5,
          run: () => {
            j.items.splice(j.items.indexOf(m), 1);
            m.removeFromParent();
            j.held++;
            this.sfx.pop();
            if (j.held === 1) {
              const box = new Mesh(new BoxGeometry(0.4, 0.3, 0.3), solid('#c9a46a', 0.9));
              this.player.carry(box);
            }
          },
        });
      if (j.held > 0)
        out.push({
          key: 'wardrobe',
          label: j.items.length ? `حط ${j.held} بالكبت` : 'حط كل الأغراض بالكبت',
          x: HOUSE.wardrobe.x,
          z: HOUSE.wardrobe.z - 0.6,
          r: 1.9,
          run: () => {
            this.player.carry(null);
            this.sfx.pop();
            j.held = 0;
            if (!j.items.length) {
              this.store.finishJob('tidy');
              this.store.gainXp('tidy', 8);
              this.pay(this.store.payFor('tidy', job('tidy').pay) * (this.store.has('gift') ? 2 : 1), 'ترتيب غرفتي', this.player.pos);
              void this.speakLine(this.fill('ما شاء الله، غرفتك صارت مرتبة! تسلم{|ين}.'), { gender: 'f', key: 'mum', pitch: 1.12, rate: 1 });
              this.hud.toast(`ماما من المطبخ: «الله يرضى عليك!»`, 'good');
              this.job = null;
              this.beacons.clear('job');
            }
          },
        });
    } else if (j.kind === 'sweep') {
      const home = j.job === 'sweep';
      for (const p of j.piles)
        out.push({
          key: 'pile',
          label: home ? 'كنّس الغبار' : 'كنّس الشعر',
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
              if (home) {
                this.store.finishJob('sweep');
                this.store.gainXp('sweep', 8);
                this.pay(this.store.payFor('sweep', job('sweep').pay) * (this.store.has('gift') ? 2 : 1), 'كنس البيت', this.player.pos);
                void this.speakLine(this.fill('الله يعطيك العافية، البيت يلمع!'), { gender: 'f', key: 'mum', pitch: 1.12, rate: 1 });
              } else {
                const barber = this.npcs.find((n) => n.def.id === 'barber')!;
                this.store.finishJob('barber');
                this.store.gainXp('barber', 8);
                this.pay(this.store.payFor('barber', job('barber').pay), 'ترتيب الصالون', barber.pos);
                void this.speakLine('تسلم إيدك! الصالون بقى بيلمع.', { gender: 'm', key: 'barber', pitch: 0.94, rate: 1.05 });
              }
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
    } else if (j.kind === 'tidy') {
      const list = j.items.map((m, i) => ({ id: `job-mess${i}`, x: m.position.x, z: m.position.z, icon: '🧸' }));
      if (j.held && !j.items.length) list.push({ id: 'job-wardrobe', x: HOUSE.wardrobe.x, z: HOUSE.wardrobe.z - 0.6, icon: '🚪' });
      this.syncJobBeacons(list);
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
        return this.hud.setObjective(`🧹 ${j.job === 'sweep' ? 'كنّس الغبار بالبيت' : 'كنّس الشعر'}: ${6 - j.piles.length}/6`, null, true);
      case 'tidy':
        return this.hud.setObjective(j.items.length ? `🧸 رتّب غرفتك: شلت ${5 - j.items.length}/5` : '🚪 حط الأغراض بالكبت', null, true);
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
  private inside = false;

  private updateLampLights(): void {
    const night = this.sky.night;
    if (this.inside) {
      // Ceiling lights in the hall, the kitchen and my room.
      if (--this.lampTimer <= 0) {
        this.lampTimer = 30;
        const rooms = [HOUSE.hall, { x: -62.6, z: 35 }, { x: -77.5, z: 35 }, { x: -70, z: 38 }];
        this.lampLights.forEach((l, i) => rooms[i] && l.position.set(rooms[i].x, 3.2, rooms[i].z));
      }
      for (const [i, l] of this.lampLights.entries()) l.intensity = i < 4 ? 6 + night * 22 : 0;
      return;
    }
    if (--this.lampTimer <= 0) {
      this.lampTimer = 20;
      const p = this.player.pos;
      const near = [...this.world.lamps].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      this.lampLights.forEach((l, i) => near[i] && l.position.set(near[i].x, near[i].y - 0.4, near[i].z));
    }
    for (const l of this.lampLights) l.intensity = night * 60;
  }

  // ------------------------------------------------------------------ guide (سند)

  private fill(t: string, vars: Record<string, string | number> = {}): string {
    return fillTemplate(t, this.store.s.player.gender, { name: this.store.s.player.name, ...vars });
  }

  /** Say something as the guide: bubble (optionally longer than the spoken line) plus voice. */
  private guideSay(text: string, suggestions: string[] = [], keepYou = false, bubble = text): Promise<void> {
    this.guide.say(bubble, suggestions, keepYou);
    const said = performance.now();
    return this.speakLine(text, SANAD).then(() => {
      // While walking, fold the bubble away once it has been heard (or had time to be read).
      const left = Math.max(1500, 7000 - (performance.now() - said));
      setTimeout(() => this.autoWalk && this.guide.hideBubble(), left);
    });
  }

  private async askGuide(text: string, byVoice = false): Promise<void> {
    const t = text.trim();
    if (!t || this.talk || this.overlay) return;
    this.sfx.unlock();
    if (byVoice) this.store.bump('voiceTurns');
    if (this.autoWalk && /وصلني|اختصر/.test(normalizeArabic(t))) return this.warp();
    this.speechOut.cancel();
    this.guide.youSaid(t);
    const r = await this.guideBrain.ask(t);
    if (this.talk || this.overlay) return;
    this.guideSay(r.text, r.suggestions, true);
    this.runGuide(r.actions);
  }

  private async guideMic(): Promise<void> {
    if (this.talk || this.overlay) return;
    this.sfx.unlock();
    if (this.speechIn.listening) {
      this.speechIn.stop();
      return;
    }
    this.guide.invite(false);
    if (this.micBlocked) {
      this.guide.focusInput(this.micProblem('denied'));
      return;
    }
    this.speechOut.cancel();
    this.sfx.micOn();
    this.guide.setListening(true);
    try {
      const text = await this.speechIn.listen(
        (i) => this.guide.setListening(true, i),
        (l) => this.guide.setLevel(l),
      );
      this.guide.setListening(false);
      this.sfx.micOff();
      if (text) await this.askGuide(text, true);
      else this.guide.say('ما سمعت شي. اضغط 🎤 وتكلم بوضوح.', GUIDE_SUGGESTIONS);
    } catch (e) {
      this.guide.setListening(false);
      const code = (typeof e === 'string' ? e : 'other') as MicError;
      // Inside claude.ai the page can never get the mic; elsewhere the player can still allow it.
      if (code === 'denied' && 'claude' in window) this.micBlocked = true;
      if (code === 'denied' || code === 'unsupported' || code === 'nomic') this.guide.focusInput(this.micProblem(code));
      else this.guide.say(MIC_ERROR_TEXT[code] ?? MIC_ERROR_TEXT.other, GUIDE_SUGGESTIONS, false);
    }
  }

  /** Why the mic can't be used here, and what to do instead. */
  private micProblem(code: 'denied' | 'unsupported' | 'nomic'): string {
    if ('claude' in window) return `صفحة claude.ai ما تسمح بالمايك. للعب بصوتك افتح اللعبة من الرابط: ${GAME_URL} — والحين اكتب طلبك بالمربع، أو تكلم بمايك الكيبورد (بالجوال 🎤 اللي بالكيبورد، بويندوز Win+H، بالماك Fn مرتين).`;
    return `${MIC_ERROR_TEXT[code]} والحين تقدر تكتب طلبك بالمربع.`;
  }

  private runGuide(actions: GuideAction[]): void {
    for (const a of actions) {
      switch (a.type) {
        case 'setGoal':
          this.store.setGoal(a.amount, a.days, a.job);
          this.store.s.flags.goalDone = false;
          this.hud.refreshGoal();
          this.hud.toast(`🎯 هدف جديد: ${formatMoney(a.amount)} خلال ${a.days} يوم`, 'good');
          break;
        case 'goJob':
          this.goToJob(a.job);
          break;
        case 'talkTo':
          this.goToNpc(a.npc, null);
          break;
        case 'goPlace':
          this.goToPlace(a.place);
          break;
        case 'buy':
          this.goBuy(a.upgrade);
          break;
        case 'move':
          this.moveDir(a.dir);
          break;
        case 'openBoard':
          this.goToPlace('jobboard');
          break;
        case 'invest':
          this.goToNpc('partner', null, () => this.openDeals());
          break;
        case 'help':
          setTimeout(() => !this.overlay && !this.talk && this.showHowTo(), 1200);
          break;
        case 'openPhone':
          this.stopWalk();
          setTimeout(() => !this.overlay && !this.talk && this.phone.open(a.tab), 900);
          break;
        case 'sleep':
          this.walkTo({ x: -77.6, z: 38.4 }, 'سريرك', () => this.sleep(), HOUSE.bed);
          break;
        case 'stop':
          this.stopWalk('button');
          break;
      }
    }
  }

  private checkGoal(): void {
    this.hud.refreshGoal();
    const g = this.store.goalProgress();
    if (!g || g.got < g.amount || this.store.s.flags.goalDone) return;
    this.store.s.flags.goalDone = true;
    this.sfx.level();
    this.hud.toast(`🎯 وصلت هدفك: ${formatMoney(g.amount)}!`, 'achievement');
    setTimeout(() => !this.talk && !this.overlay && this.guideSay(this.fill('مبروك يا {name}! وصلت{|ي} هدفك {amount}. تبي{|ن} هدف أكبر؟', { amount: formatMoney(g.amount) }), ['أبي أجمع 2000 درهم بالشهر', 'وين أحسن شغل الحين؟']), 1500);
  }

  /** Go to where a job happens and start it there. */
  private goToJob(id: JobId): void {
    const def = job(id);
    if (id === 'online') {
      if (this.store.has('phone') && Math.hypot(this.player.pos.x - DESK_STAND.x, this.player.pos.z - DESK_STAND.z) > 8) {
        // The smartphone works from anywhere.
        setTimeout(() => !this.talk && !this.overlay && this.startJob('online'), 1600);
        return;
      }
      return this.walkTo(DESK_STAND, 'اللابتوب بحوش البيت', () => this.startJob('online'), HOME.desk);
    }
    if (id === 'stall') return this.walkTo({ x: STALL_SPOT.x, z: STALL_SPOT.z + 1.4 }, 'البسطة', () => this.startJob('stall'), STALL_SPOT);
    if (id === 'recycle') return this.walkTo({ x: 33, z: -7.8 }, 'آلة التدوير', () => this.startJob('recycle'), { x: 33, z: -9 });
    if (def.employer) return this.goToNpc(def.employer, id);
    this.goToPlace(def.place);
  }

  private npcWord(id: NpcId): string {
    return id === 'mum' ? 'أمك' : id === 'dad' ? 'أبوك' : id === 'grandpa' ? 'جدك' : NPCS.find((n) => n.id === id)!.name;
  }

  /** Walk up to a character; with a job, they offer it on arrival and it starts. */
  private goToNpc(id: NpcId, offer: JobId | null, then?: () => void): void {
    const ent = this.npcs.find((n) => n.def.id === id)!;
    if (ent.def.hours && !isOpenAt(ent.def.hours, this.store.hour)) {
      const from = ent.def.hours?.[0] ?? 8;
      this.guideSay(this.fill('{who} مو موجود الحين، يطلع الساعة {h}. خلنا نسوي شي ثاني.', { who: this.npcWord(id), h: from % 12 || 12 }), ['وين أحسن شغل الحين؟', 'أبي شغل أونلاين']);
      return;
    }
    let tries = 0;
    const arrive = () => {
      if (this.talk || this.overlay) return;
      if (!ent.present) return this.hud.toast(`${ent.def.name} راح، ارجع له بعدين.`);
      // Someone who wandered off (Ali with his ball) gets followed once more.
      if (Math.hypot(ent.pos.x - this.player.pos.x, ent.pos.z - this.player.pos.z) > 3.4 && tries++ < 2) return this.walkTo(this.approach(ent), this.npcWord(id), arrive, ent.pos);
      if (then) then();
      else this.startTalk({ kind: 'npc', ent }, offer);
    };
    this.walkTo(this.approach(ent), this.npcWord(id), arrive, ent.pos);
  }

  private goToPlace(id: PlaceId): void {
    const p = PLACE_BY_ID.get(id)!;
    if (id === 'home') return this.walkTo(HOUSE.hall, 'داخل البيت', () => {}, null);
    if (id === 'company') return this.goToNpc('hr', null);
    if (id === 'jobboard') return this.walkTo({ x: COMPANY.board.x, z: COMPANY.board.z + 1.4 }, p.name, () => this.openBoard(), COMPANY.board);
    if (id === 'atm') return this.walkTo({ x: -69.25, z: -8.6 }, p.name, () => this.openOverlay((root, env) => new Atm(root, env)), { x: -69.25, z: -10.2 });
    if (id === 'grandpa') return this.goToNpc('grandpa', null);
    this.walkTo(this.stand(p.x, p.z), p.name, () => {}, p);
  }

  /** Take the player to whoever sells the thing and open their shop. */
  private goBuy(id: UpgradeId): void {
    const u = UPGRADE_BY_ID.get(id)!;
    const open = (title: string, ids?: UpgradeId[]) => () => this.openOverlay((root, env) => new UpgradeShop(root, env, title, ids));
    if (u.seller === 'grocery') return this.goToNpc('grocer', null, open('بقالة النور', ['stall', 'cooler']));
    if (u.seller === 'perfume') return this.goToNpc('dad', null, open('عطور أبو سالم', ['gift']));
    this.walkTo({ x: 16, z: -8.2 }, 'عالم الجوال', open('عالم الجوال'), { x: 16, z: -9.6 });
  }

  /** A spot in front of a character, on their side of the counter. */
  private approach(ent: NpcEntity): Pt {
    const f = ent.spot.facing;
    for (const r of [1.6, 1.2, 2.2]) {
      const p = { x: ent.pos.x + Math.sin(f) * r, z: ent.pos.z + Math.cos(f) * r };
      if (!this.world.colliders.blocked(p.x, p.z, 0.36)) return p;
    }
    return this.stand(ent.pos.x, ent.pos.z);
  }

  /** The nearest free spot to (x, z) a person can stand on. */
  private stand(x: number, z: number): Pt {
    const c = this.world.colliders;
    if (!c.blocked(x, z, 0.4)) return { x, z };
    for (let r = 0.75; r <= 10; r += 0.75)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const p = { x: x + Math.sin(a) * r, z: z + Math.cos(a) * r };
        if (!c.blocked(p.x, p.z, 0.4)) return p;
      }
    return { x, z };
  }

  /** Walk the player to `target` along the street, then run `onArrive`. */
  private walkTo(target: Pt, label: string, onArrive: () => void, face: Pt | null = null): void {
    this.stopWalk();
    if (this.work) {
      this.work = null;
      this.player.activity = 'none';
    }
    const from = { x: this.player.pos.x, z: this.player.pos.z };
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    const w: AutoWalk = { path: [], i: 0, target, face: face ? { x: face.x, z: face.z } : null, label, onArrive, best: Infinity, stuckT: 0, mounted: false, warping: false };
    if (dist < 1) {
      this.autoWalk = w;
      return this.arrive();
    }
    const path = this.nav.route(from, target);
    this.autoWalk = w;
    if (label) this.beacons.set('dest', w.face?.x ?? target.x, w.face?.z ?? target.z, '📍', label);
    if (dist > 12) this.guide.setWalk(`بالطريق إلى ${label || 'المكان اللي اخترته'}…`);
    if (!path) return this.warp();
    w.path = path;
    if (this.player.ride === 'none' && !this.player.carried && dist > 30) {
      const ride = (['scooter', 'bike'] as const).find((k) => this.store.has(k));
      if (ride) {
        this.player.setRide(ride);
        w.mounted = true;
      }
    }
    this.player.tireless = true;
  }

  /** This frame's stick input that steers toward the next waypoint. */
  private walkMove(dt: number): { x: number; y: number } {
    const w = this.autoWalk!;
    if (w.warping || !w.path.length) return { x: 0, y: 0 };
    const p = this.player.pos;
    let wp = w.path[w.i];
    let last = w.i === w.path.length - 1;
    let d = Math.hypot(wp.x - p.x, wp.z - p.z);
    if (d < (last ? 0.55 : 1.3)) {
      if (last) {
        this.arrive();
        return { x: 0, y: 0 };
      }
      w.i++;
      w.best = Infinity;
      w.stuckT = 0;
      wp = w.path[w.i];
      last = w.i === w.path.length - 1;
      d = Math.hypot(wp.x - p.x, wp.z - p.z);
    }
    // Stuck behind a car or a crowd: hop to the waypoint.
    if (d < w.best - 0.25) {
      w.best = d;
      w.stuckT = 0;
    } else if ((w.stuckT += dt) > 2.5) {
      this.player.place(wp.x, wp.z, this.player.heading);
      w.best = Infinity;
      w.stuckT = 0;
    }
    const dx = (wp.x - p.x) / d;
    const dz = (wp.z - p.z) / d;
    const fx = -Math.sin(this.rig.yaw);
    const fz = -Math.cos(this.rig.yaw);
    const m = last ? Math.min(1, 0.3 + d / 2) : 1;
    return { x: (dx * -fz + dz * fx) * m, y: (dx * fx + dz * fz) * m };
  }

  private arrive(): void {
    const w = this.autoWalk;
    if (!w) return;
    this.stopWalk();
    this.player.speed = 0;
    if (w.face) this.player.heading = Math.atan2(w.face.x - this.player.pos.x, w.face.z - this.player.pos.z);
    w.onArrive();
  }

  /** "وصّلني الحين": skip the walk. */
  private warp(): void {
    const w = this.autoWalk;
    if (!w || w.warping) return;
    w.warping = true;
    const fade = h('div', { style: 'position:absolute;inset:0;background:#1a130c;opacity:0;transition:opacity .25s;z-index:60;pointer-events:none' });
    this.ui.append(fade);
    requestAnimationFrame(() => (fade.style.opacity = '1'));
    setTimeout(() => {
      if (this.autoWalk === w) {
        const heading = w.face ? Math.atan2(w.face.x - w.target.x, w.face.z - w.target.z) : this.player.heading;
        this.player.place(w.target.x, w.target.z, heading);
        this.rig.snapBehind(heading);
        this.arrive();
      }
      fade.style.opacity = '0';
      setTimeout(() => fade.remove(), 300);
    }, 280);
  }

  /** End the auto-walk; `button` also clears the marker, `manual` keeps it to follow. */
  private stopWalk(why: 'arrive' | 'button' | 'manual' = 'arrive'): void {
    const w = this.autoWalk;
    if (!w) return;
    this.autoWalk = null;
    this.guide.setWalk(null);
    this.player.tireless = false;
    if (w.mounted) this.player.setRide('none');
    if (why !== 'manual') this.beacons.remove('dest');
    if (why === 'button') this.hud.toast('وقفنا. امشِ بنفسك أو قول لسند وين تبي تروح.');
  }

  /** Spoken movement: walk a stretch forward, back, to a side, out to the street or into the house. */
  private moveDir(dir: MoveDir): void {
    const p = this.player.pos;
    if (dir === 'in') return this.goToPlace('home');
    if (dir === 'out') {
      // Out of the house and the courtyard, onto the sidewalk in front of the gate.
      return this.walkTo({ x: -70, z: 8.2 }, 'الشارع', () => {}, null);
    }
    const turn = { forward: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[dir];
    const h = this.player.heading + turn;
    for (const d of [16, 11, 7, 4]) {
      const t = { x: p.x + Math.sin(h) * d, z: p.z + Math.cos(h) * d };
      const stand = this.stand(t.x, t.z);
      if (this.nav.route({ x: p.x, z: p.z }, stand)) return this.walkTo(stand, '', () => {});
    }
    this.hud.toast('ما في طريق من هالجهة. جرّب جهة ثانية.');
  }

  /** Where the held finger points on the ground, as stick input; null when not steering. */
  private steerMove(): { move: { x: number; y: number }; run: boolean } | null {
    const s = this.input.steer;
    if (!s) return null;
    const ndc = new Vector2((s.x / innerWidth) * 2 - 1, -(s.y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -0.1), this.tmp);
    if (!hit) return null;
    const dx = hit.x - this.player.pos.x;
    const dz = hit.z - this.player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.7) return { move: { x: 0, y: 0 }, run: false };
    const fx = -Math.sin(this.rig.yaw);
    const fz = -Math.cos(this.rig.yaw);
    const ux = dx / d;
    const uz = dz / d;
    this.dropWalkHint();
    return { move: { x: ux * -fz + uz * fx, y: ux * fx + uz * fz }, run: d > 7 };
  }

  private openBoard(): void {
    this.openOverlay((root, env) => new JobBoard(root, env, (id) => setTimeout(() => this.goToJob(id), 50), () => setTimeout(() => this.goToNpc('partner', null, () => this.openDeals()), 50)));
  }

  private openDeals(): void {
    this.openOverlay((root, env) => new DealsBoard(root, env));
  }

  /** "Walk forward" hint for new players, until they have walked a few metres. */
  private hintEl: HTMLElement | null = null;
  private walkedHint = false;
  private walkedDist = 0;

  private showWalkHint(): void {
    if (this.store.s.flags.walked || this.hintEl) return;
    const text = this.touch ? '👈 امشِ بالعصا تحت يسار، أو اضغط مطولاً على الشارع' : '⬆️ امشِ لقدام: اضغط ↑ أو W — أو اضغط مطولاً بالماوس على الشارع';
    this.hintEl = h('div.walk-hint', text);
    this.ui.append(this.hintEl);
  }

  private dropWalkHint(): void {
    if (!this.hintEl) return;
    this.hintEl.remove();
    this.hintEl = null;
    this.walkedHint = true;
    this.store.s.flags.walked = true;
  }

  /** Tap or click on the street: walk there; on a person, walk up and talk. */
  private handleTap(x: number, y: number): void {
    if (!this.running || this.talk || this.overlay || this.phone.isOpen || this.job?.kind === 'wash' || this.hud.mapOpen) return;
    this.sfx.unlock();
    const screen = (wx: number, wy: number, wz: number) => {
      this.tmp.set(wx, wy, wz).project(this.camera);
      return this.tmp.z < 1 ? Math.hypot(((this.tmp.x + 1) / 2) * innerWidth - x, ((1 - this.tmp.y) / 2) * innerHeight - y) : Infinity;
    };
    const near = (px: number, py: number, pz: number) => Math.min(screen(px, py + 0.5, pz), screen(px, py + 1, pz), screen(px, py + 1.5, pz));
    let best: Talk | null = null;
    let bd = 48;
    for (const n of this.npcs) {
      if (!n.present || n.pos.distanceTo(this.camera.position) > 45) continue;
      const d = near(n.pos.x, n.pos.y, n.pos.z);
      if (d < bd) {
        bd = d;
        best = { kind: 'npc', ent: n };
      }
    }
    for (const w of this.peds.walkers) {
      if (!w.active || w.pos.distanceTo(this.camera.position) > 40) continue;
      const d = near(w.pos.x, w.pos.y, w.pos.z);
      if (d < bd) {
        bd = d;
        best = { kind: 'walker', w };
      }
    }
    this.tapRing(x, y);
    if (best?.kind === 'npc') return this.goToNpc(best.ent.def.id, null);
    if (best?.kind === 'walker') {
      const w = best.w;
      return this.walkTo(this.stand(w.pos.x, w.pos.z), w.p.name, () => {
        if (w.active && Math.hypot(w.pos.x - this.player.pos.x, w.pos.z - this.player.pos.z) < 3.5) this.startTalk({ kind: 'walker', w });
      }, w.pos);
    }
    // Things you use: the laptop, the ATM, shelves, the recycling machine.
    const things: { key: string; x: number; z: number; stand: Pt; label: string }[] = [
      { key: 'laptop', x: HOME.desk.x, z: HOME.desk.z, stand: DESK_STAND, label: 'اللابتوب' },
      { key: 'atm', x: -69.25, z: -10.2, stand: { x: -69.25, z: -8.6 }, label: 'الصراف' },
      { key: 'shelves', x: -84, z: -9.6, stand: { x: -84, z: -8.2 }, label: 'رفوف البقالة' },
      { key: 'phones', x: 16, z: -9.6, stand: { x: 16, z: -8.2 }, label: 'عالم الجوال' },
      { key: 'recycle', x: 33, z: -9, stand: { x: 33, z: -7.8 }, label: 'آلة التدوير' },
      { key: 'jobboard', x: COMPANY.board.x, z: COMPANY.board.z, stand: { x: COMPANY.board.x, z: COMPANY.board.z + 1.4 }, label: 'لوحة الوظائف' },
    ];
    if (this.store.has('stall')) things.push({ key: 'stall', x: STALL_SPOT.x, z: STALL_SPOT.z, stand: { x: STALL_SPOT.x, z: STALL_SPOT.z + 1.4 }, label: 'البسطة' });
    for (const t of things) {
      if (Math.hypot(t.x - this.camera.position.x, t.z - this.camera.position.z) < 40 && screen(t.x, 1, t.z) < 52) {
        return this.walkTo(t.stand, t.label, () => {
          this.current = this.findInteractable();
          if (this.current?.key === t.key) this.activate();
        }, t);
      }
    }
    // Otherwise the ground under the finger.
    const ndc = new Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -0.1), new Vector3());
    if (!hit || hit.distanceTo(this.player.pos) > 160) return;
    const gx = clamp(hit.x, BOUNDS.minX + 2, BOUNDS.maxX - 2);
    const gz = clamp(hit.z, BOUNDS.minZ + 2, BOUNDS.maxZ - 2);
    this.walkTo(this.stand(gx, gz), '', () => {});
  }

  private tapRing(x: number, y: number): void {
    const ring = h('div.tap-ring', { style: { left: `${x}px`, top: `${y}px` } });
    this.ui.append(ring);
    setTimeout(() => ring.remove(), 700);
  }

  /** Clicking the big map: go to the place nearest the click. */
  private mapPick(x: number, z: number): boolean {
    if (this.talk || this.overlay) return false;
    let best: PlaceId | null = null;
    let bd = 16;
    for (const p of PLACES) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    if (best) {
      this.goToPlace(best);
      this.guide.say(this.fill('يلا نروح {place}.', { place: PLACE_BY_ID.get(best)!.name }), ['وصّلني الحين', 'وقف']);
      return true;
    }
    if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) return false;
    this.walkTo(this.stand(x, z), 'المكان اللي اخترته', () => {});
    return true;
  }

  /** How to play, shown once to new players (and on request). */
  private showHowTo(): void {
    const k = (t: string) => h('kbd', t);
    const inClaude = 'claude' in window;
    this.openOverlay((root) => {
      const ov = new Overlay(root, 'كيف ألعب؟ 👋', 'سند، مساعدك بالفريج، يسوي لك كل شي');
      ov.body.append(
        h(
          'div.howto',
          h('div.step', h('span', '🎤'), h('div', h('b', 'زر واحد بس: المايك. '), this.touch ? 'اضغط الزر البرتقالي الكبير (يمين تحت)' : ['اضغط الزر البرتقالي ', h('b', '🎤 تكلم'), ' تحت (أو ', k('V'), ')'], ' وقول شو تبي بوضوح: «أبي شغل أونلاين يجيب 1000 درهم بالشهر»، «ادخل البيت»، «امشي لقدام»، «شو في شغل على قدي؟». سند يرد عليك ويوديك ويبدأ لك.', inClaude ? ' (داخل claude.ai المتصفح يمنع المايك: لما تضغطه يطلع لك مربع، تكلم فيه بمايك الكيبورد: بالجوال 🎤 اللي بالكيبورد، بويندوز Win+H، بالماك Fn مرتين.)' : '')),
          h('div.step', h('span', '🚶'), h('div', h('b', 'المشي لقدام: '), this.touch ? 'حرّك العصا اللي تحت يسار لفوق، أو اضغط مطولاً على الشارع وتمشي باتجاه إصبعك.' : ['اضغط ', k('↑'), ' أو ', k('W'), ' (و', k('Shift'), ' للركض)، أو اضغط مطولاً بالماوس على الشارع وتمشي باتجاهه.'], ' وضغطة وحدة على أي مكان أو شخص توديك له.')),
          h('div.step', h('span', '🏠'), h('div', h('b', 'البيت: '), 'ادخل من الباب: أمك بالمطبخ، وأبوك بالمجلس الصبح. عندهم طلبات بفلوس: كنس البيت، المواعين، ترتيب غرفتك، الغسيل، ضيافة القهوة.')),
          h('div.step', h('span', '🏢'), h('div', h('b', 'برا: '), 'لوحة الوظائف قدام برج الشركة فيها كل الشغل اللي على قدك. الشركة فيها مقابلة وترقيات (متدرب، موظف، مشرف، مدير)، وأبو راشد التاجر عند الكرك عنده صفقات وشراكات تجيب دخل كل يوم.')),
          h('div.step', h('span', '📱'), h('div', 'الجوال: اضغط على المحفظة فوق. والخريطة: اضغط على الخريطة الصغيرة، وبعدين على أي مكان تبي تروح له.')),
          h('div.row', h('button.btn', { type: 'button', id: 'howto-ok', onclick: () => ov.close() }, 'يلا نبدأ!')),
        ),
      );
      return { ov };
    });
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

