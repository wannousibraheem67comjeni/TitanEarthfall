// Application entry: wires profile, game engine, UI, audio, input and Google Play Billing.
import { setLang, t, L } from './i18n.js';
import { loadProfile, defaultProfile, writeNow } from './save.js';
import * as PR from './progress.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { Billing } from './billing.js';
import { worldById, charById, stageById, REVIVE_COSTS, POWERUP_IDS } from './config.js';

const native = () => window.HopinetNative || null;
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const isFreeEdition = () => { const n = native(); try { return !!(n && n.flavor && n.flavor() === 'free'); } catch (e) { return false; } };

// Real-money items can only come from Google Play. In a browser build, which has no Google Play,
// and in the free Android edition, every paid entitlement is switched off.
function removeUnpaidPurchases(P) {
  if (!native() || isFreeEdition()) {
    P.iap.doubler = false; P.iap.starter = false; P.iap.clubUntil = 0;
  }
}

class App {
  constructor() {
    const P = loadProfile();
    removeUnpaidPurchases(P);
    PR.initProgress(P);
    const s = P.settings;
    if (!s.lang) s.lang = (navigator.language || 'ar').toLowerCase().startsWith('ar') ? 'ar' : (native() ? 'ar' : 'en');
    if (!s.quality) s.quality = isMobile && (navigator.hardwareConcurrency || 4) <= 4 ? 'low' : 'high';
    setLang(s.lang);
    Audio.setSfx(s.sound);
    Audio.setMusic(s.music);

    this.game = new Game(document.getElementById('game'), this.hooks(), s.quality);
    this.ui = new UI(this);
    this.syncLobby();
    this.setupInput();
    this.setupBilling();
    this.setupLifecycle();
    document.title = t('title');
    PR.changed();
  }

  // ---------- helpers used by the UI ----------
  isAndroid() { return !!native(); }
  inRun() { return this.game.mode === 'run' && this.game.run && this.game.run.state !== 'over'; }
  syncLobby() {
    const P = PR.profile();
    const w = worldById(P.world);
    const ch = charById(P.char);
    this.game.setLobby(w, PR.houseStage(w.id), PR.homeItemsOf(w.id), ch.species, PR.currentSkin());
  }
  previewSkin(ch, skin) {
    const P = PR.profile();
    const w = worldById(P.world);
    this.game.setLobby(w, PR.houseStage(w.id), PR.homeItemsOf(w.id), ch.species, skin);
  }

  // ---------- game hooks ----------
  hooks() {
    return {
      onTick: (r) => {
        this.ui.updateHud(r);
        this._tick = (this._tick || 0) + 1;
        if (this._tick % 30 === 0) {
          for (const m of PR.liveMissionCheck(r.stats)) {
            this.ui.toast(t('missionDone'), 'gold', { icon: 'missions' });
            void m;
          }
        }
      },
      event: (name, d) => this.onGameEvent(name, d),
      onCrash: ({ revives, cause }) => {
        if (!this.inRun()) return;
        if (revives >= REVIVE_COSTS.length) { this.finishRun(); return; }
        this.ui.openRevive(revives, cause, (choice) => {
          if (choice === 'battery' || choice === 'gems') this.game.revive();
          else if (choice === 'again') this.runAgain();
          else this.finishRun();
        });
      },
      onWin: () => { if (this.inRun()) this.finishWin(); },
      foundVault: () => PR.addVault('steel'),
      vibrate: (ms) => {
        if (!PR.profile().settings.vibe) return;
        const n = native();
        try { if (n && n.vibrate) n.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
      },
    };
  }

  onGameEvent(name, d) {
    const ui = this.ui;
    switch (name) {
      case 'toast': ui.toast(d.key ? t(d.key) : d.text, d.kind || 'info', { icon: d.icon, big: d.big, center: true }); break;
      case 'villain': ui.speech(t(d.key)); break;
      case 'powerup': ui.toast(t('pu_' + d.type), 'power', { icon: d.type, center: true }); break;
      case 'boss': ui.setBoss(d.phase, d); break;
      case 'tutorial': ui.tutorial(d.kind); break;
      case 'tutorialDone': {
        const P = PR.profile();
        P.tutorialDone = true; PR.changed();
        ui.toast(t('tutGo'), 'gold', { big: true, center: true, dur: 2200 });
        break;
      }
      case 'headstartOffer': ui.headstartOffer(d.show && PR.profile().headstart > 0, PR.profile().headstart); break;
      case 'zone': {
        // One reminder per minute at most; the swim hint matters most for new players.
        const now = Date.now();
        if (d.type === 'water' && now - (this._zoneHint || 0) > 60000) { this._zoneHint = now; ui.toast(t('zoneWater'), 'info', { icon: 'swim', center: true, dur: 2200 }); }
        break;
      }
      case 'crash': Audio.play('crash'); break;
      default: break;
    }
  }

  // ---------- run flow ----------
  // Plays the stage selected on the map (or a free run when none is selected).
  startRun() {
    const P = PR.profile();
    Audio.unlock();
    const stage = PR.currentStage();
    const charId = P.char;
    const ch = charById(charId);
    const world = worldById(stage ? stage.world : P.world);
    const durations = {};
    for (const id of POWERUP_IDS) durations[id] = PR.powerupDuration(id, charId);
    this.ui.showHud(stage);
    this.game.startRun({
      world,
      species: ch.species,
      skin: PR.currentSkin(charId),
      durations,
      vehicleExtra: PR.vehicleExtraSec(),
      vehicleBonus: PR.perkFor(charId, 'vehicle'),
      mult: PR.multiplier(),
      doubler: P.iap.doubler,
      scoreBonus: PR.perkFor(charId, 'score'),
      goldBonus: PR.goldBonus(),
      tutorial: !P.tutorialDone && !stage,
      headstarts: P.headstart,
      stage,
    });
    Audio.startMusic('run', { world: world.id });
  }

  startStage(id) {
    if (!PR.selectStage(id)) return;
    const st = stageById(id);
    if (st && PR.profile().world !== st.world) PR.setWorld(st.world);
    this.syncLobby();
    this.startRun();
  }

  useHeadstart() {
    const P = PR.profile();
    if (P.headstart <= 0) return;
    if (this.game.useHeadstart()) { P.headstart--; PR.changed(); }
  }

  pause() {
    if (!this.inRun() || this.game.paused || this.game.run.state === 'crashed' || this.game.run.state === 'won') return;
    this.game.pause();
    this.ui.openPause();
  }
  resume() { this.game.resume(); }

  // Pays out the run exactly once (game.finishRun returns null if it already ended).
  settleRun() {
    const res = this.game.finishRun();
    if (!res) return null;
    PR.grant([{ k: 'gold', n: res.gold }, { k: 'gems', n: res.gems }], { silent: true });
    PR.commitRunStats({ ...res.stats, runs: 1 });
    res.isBest = PR.recordRun({ score: res.score, dist: res.dist, gold: res.gold, swim: res.stats.swim || 0 });
    return res;
  }

  finishRun() {
    const res = this.settleRun();
    if (!res) return null;
    this.ui.showResults({ ...res, doubled: false, doubleCost: Math.max(5, Math.ceil(res.gold / 50)) });
    if (res.isBest) Audio.play('fanfare');
    return res;
  }

  // A campaign stage was completed: pay the run, then the stage rewards and stars.
  finishWin() {
    const res = this.settleRun();
    if (!res) return null;
    const stage = res.stage || PR.currentStage();
    const stageInfo = stage ? PR.completeStage(stage, res) : null;
    this.ui.showResults({ ...res, stage, stageInfo, doubled: false, doubleCost: Math.max(5, Math.ceil(res.gold / 50)) });
    Audio.play('fanfare');
    if (stageInfo && stageInfo.unlockedWorld) this.ui.popup(t('newWorld'), [], `<div class="unlock-big"><h3>${L(worldById(stageInfo.unlockedWorld).name)}</h3></div>`);
    return res;
  }

  // "Run again": the current run is paid out and a fresh one starts at once.
  runAgain() {
    this.settleRun();
    this.startRun();
  }

  // From the pause menu: restart or go home (collected rewards are kept).
  endRun(restart) {
    // Only from the pause menu of a live run; a second tap on a fading button is ignored.
    if (!this.inRun() || !this.game.paused) return;
    this.settleRun();
    if (restart) this.startRun(); else this.goLobby();
  }

  goLobby() {
    this.game.showLobby();
    this.ui.closeAllModals();
    this.syncLobby();
    this.ui.showLobby();
    Audio.startMusic('lobby', { world: PR.profile().world });
  }

  // ---------- settings ----------
  toggleSetting(k) {
    const s = PR.profile().settings;
    s[k] = !s[k];
    if (k === 'sound') Audio.setSfx(s.sound);
    if (k === 'music') Audio.setMusic(s.music);
    PR.changed();
  }
  setLanguage(l) {
    PR.profile().settings.lang = l;
    setLang(l);
    document.title = t('title');
    PR.changed();
  }
  setQuality(q) {
    PR.profile().settings.quality = q;
    this.game.setQuality(q);
    PR.changed();
  }
  rate() { const n = native(); if (n && n.openStorePage) n.openStorePage(); }
  resetProgress() {
    const old = PR.profile();
    const np = defaultProfile();
    np.iap = old.iap;          // purchases stay owned
    np.settings = old.settings;
    np.woodNext = Date.now();
    PR.replaceProfile(np);
    writeNow(np);
    this.ui.closeAllModals();
    this.syncLobby();
    this.ui.renderLobby();
  }

  // ---------- billing ----------
  setupBilling() {
    const ui = this.ui;
    Billing.init({
      grant: (def, qty, token, purchase) => this.grantPurchase(def, qty, token, purchase),
      message: (key, kind) => ui.toast(t(key), kind === 'error' ? 'warn' : kind === 'ok' ? 'ok' : 'info', { center: true }),
      onPrices: () => ui.refresh(),
      onReady: () => ui.refresh(),
      onRestore: (r) => {
        const P = PR.profile();
        if (r.ok) {
          let dirty = false;
          if (!(r.subsActive || []).includes('hopinet_club') && P.iap.clubUntil > Date.now()) { P.iap.clubUntil = Date.now(); dirty = true; }
          // A refunded/revoked lifetime doubler is no longer returned by Google Play.
          if (P.iap.doubler && !(r.owned || []).includes('gold_doubler')) { P.iap.doubler = false; dirty = true; }
          if (dirty) PR.changed();
        }
        if (r.manual) {
          const found = (r.owned || []).length + (r.subsActive || []).length > 0;
          ui.toast(t(!r.ok ? 'storeUnavailable' : found ? 'restored' : 'noPurchases'), r.ok && found ? 'ok' : 'info', { center: true });
        }
      },
    });
  }

  // Returns true when the purchase was granted now (false when it was already delivered before).
  grantPurchase(def, qty, token, purchase) {
    if (Billing.mode !== 'play') return false; // nothing is ever granted without Google Play
    const P = PR.profile();
    // Google Play reports a lifetime product as acknowledged only after an earlier grant was
    // saved, so a lost save gets the ownership flag back but not the pack contents again.
    if (!def.consumable && def.type !== 'subs' && purchase && purchase.acknowledged) {
      if (def.id === 'starter_pack') P.iap.starter = true;
      if (def.entitlement === 'doubler') P.iap.doubler = true;
      if (!P.iap.tokens.includes(token)) P.iap.tokens.push(token);
      PR.changed();
      return false;
    }
    // Lifetime products are de-duplicated by their flag as well, so an evicted token can never
    // grant the starter pack twice.
    const known = P.iap.tokens.includes(token) || (def.id === 'starter_pack' && P.iap.starter) || (def.entitlement === 'doubler' && P.iap.doubler);
    if (def.type === 'subs') {
      const wasActive = PR.clubActive();
      P.iap.clubUntil = Math.max(P.iap.clubUntil, Date.now() + 2 * 24 * 3600 * 1000);
      if (!P.iap.tokens.includes(token)) P.iap.tokens.push(token);
      if (!wasActive) this.ui.popup(t('p_hopinet_club'), [], `<p class="msg">${t('p_hopinet_club_d')}</p>`);
      PR.changed();
      writeNow(P);
      return !wasActive;
    }
    if (known) {
      if (def.id === 'starter_pack') P.iap.starter = true;
      if (def.entitlement === 'doubler') P.iap.doubler = true;
      PR.changed();
      return false;
    }
    P.iap.tokens.push(token);
    if (P.iap.tokens.length > 300) P.iap.tokens = P.iap.tokens.slice(-300);
    if (def.id === 'starter_pack') P.iap.starter = true;
    if (def.entitlement === 'doubler') P.iap.doubler = true;
    const items = [];
    for (let i = 0; i < qty; i++) items.push(...def.grant);
    const got = PR.grant(items, { silent: true });
    PR.changed();
    writeNow(P); // persist immediately before Google Play is told to consume
    if (got.length) this.ui.popup(t('purchaseOk'), got);
    else this.ui.popup(t('purchaseOk'), [], `<p class="msg">${t('p_' + def.id)}</p>`);
    return true;
  }

  // ---------- input ----------
  setupInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'Escape') { this.ui.back(); return; }
      if (!this.inRun() || this.ui.modals.length) return;
      const map = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ' ': 'up', ArrowDown: 'down', s: 'down', S: 'down' };
      if (map[k]) { e.preventDefault(); this.game.input(map[k]); }
      if (k === 'p' || k === 'P') this.pause();
    });
    let sx = 0, sy = 0, active = false, fired = false;
    const TH = 26;
    window.addEventListener('pointerdown', (e) => {
      if (!this.inRun() || this.ui.modals.length) return;
      if (e.target.closest('button')) return;
      sx = e.clientX; sy = e.clientY; active = true; fired = false;
    }, { passive: true });
    window.addEventListener('pointermove', (e) => {
      if (!active || fired) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TH) return;
      fired = true;
      if (Math.abs(dx) > Math.abs(dy)) this.game.input(dx > 0 ? 'right' : 'left');
      else this.game.input(dy > 0 ? 'down' : 'up');
    }, { passive: true });
    window.addEventListener('pointerup', () => { active = false; }, { passive: true });
    window.addEventListener('pointercancel', () => { active = false; }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- lifecycle (Android back/pause, browser visibility) ----------
  setupLifecycle() {
    window.hopinetOnBack = () => this.ui.back();
    window.hopinetOnPause = () => { this.pause(); this.ui.holdRevive(true); Audio.suspend(); writeNow(PR.profile()); };
    window.hopinetOnResume = () => { Audio.resume(); this.ui.holdRevive(false); };
    window.hopinetSetInsets = (top, bottom) => {
      document.documentElement.style.setProperty('--safe-top', top + 'px');
      document.documentElement.style.setProperty('--safe-bottom', bottom + 'px');
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.pause(); this.ui.holdRevive(true); Audio.suspend(); writeNow(PR.profile()); } else { Audio.resume(); this.ui.holdRevive(false); }
    });
    window.addEventListener('pagehide', () => writeNow(PR.profile()));
    const n = native();
    try {
      if (n && n.getInsets) { const i = JSON.parse(n.getInsets()); window.hopinetSetInsets(i.top || 0, i.bottom || 0); }
    } catch (e) { /* ignore */ }
  }
}

function boot() {
  const splash = document.getElementById('splash');
  let app;
  try {
    app = new App();
    if (/[?&]debug\b/.test(location.search)) { window.__hopinet = app; window.__hopinetPR = PR; } // test hooks (?debug only)
  } catch (e) {
    console.error(e);
    const gl = /WebGL/i.test(String(e && e.message));
    splash.querySelector('.hint').textContent = gl
      ? 'هذا الجهاز لا يدعم WebGL2 اللازم للعبة / This device does not support WebGL2'
      : 'Error: ' + e.message;
    return;
  }
  splash.querySelector('.bar i').style.width = '100%';
  splash.querySelector('.hint').textContent = t('tapToStart');
  splash.querySelector('h1').textContent = t('title');
  splash.querySelector('.sub').textContent = t('subtitle');
  splash.classList.add('ready');
  const go = () => {
    splash.removeEventListener('pointerup', go);
    Audio.unlock();
    Audio.startMusic('lobby', { world: PR.profile().world });
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 500);
    app.ui.showLobby();
  };
  splash.addEventListener('pointerup', go);
  if (window.HopinetNative && window.HopinetNative.appReady) { try { window.HopinetNative.appReady(); } catch (e) { /* ignore */ } }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
