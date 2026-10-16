// Application entry: wires profile, game engine, UI, audio, input and Google Play Billing.
import { setLang, t, L, fmt } from './i18n.js';
import { loadProfile, defaultProfile, writeNow } from './save.js';
import * as PR from './progress.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { Billing } from './billing.js';
import { worldById, charById, REVIVE_COSTS, PRODUCTS } from './config.js';

const native = () => window.EbotNative || null;
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

class App {
  constructor() {
    const P = loadProfile();
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
    this.game.setLobby(w, PR.houseStage(w.id), PR.currentSkin());
  }
  previewSkin(skin) {
    const P = PR.profile();
    const w = worldById(P.world);
    this.game.setLobby(w, PR.houseStage(w.id), skin);
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
      onCrash: ({ revives }) => {
        if (revives >= REVIVE_COSTS.length) { this.finishRun(); return; }
        this.ui.openRevive(revives, (ok) => { if (ok) this.game.revive(); else this.finishRun(); });
      },
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
      case 'thief': ui.speech(t(d.key)); break;
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
      default: break;
    }
  }

  // ---------- run flow ----------
  startRun() {
    const P = PR.profile();
    Audio.unlock();
    const charId = P.char;
    const durations = {};
    for (const id of ['magnet', 'shield', 'jet', 'double']) durations[id] = PR.powerupDuration(id, charId);
    this.ui.showHud();
    this.game.startRun({
      world: worldById(P.world),
      skin: PR.currentSkin(charId),
      durations,
      mult: PR.multiplier(),
      doubler: P.iap.doubler,
      scoreBonus: PR.perkFor(charId, 'score'),
      tutorial: !P.tutorialDone,
      headstarts: P.headstart,
    });
    Audio.startMusic('run');
  }

  useHeadstart() {
    const P = PR.profile();
    if (P.headstart <= 0) return;
    if (this.game.useHeadstart()) { P.headstart--; PR.changed(); }
  }

  pause() {
    if (!this.inRun() || this.game.paused || this.game.run.state === 'crashed') return;
    this.game.pause();
    this.ui.openPause();
  }
  resume() { this.game.resume(); }

  finishRun() {
    const res = this.game.finishRun();
    const P = PR.profile();
    PR.grant([{ k: 'gold', n: res.gold }, { k: 'gems', n: res.gems }], { silent: true });
    PR.commitRunStats({ ...res.stats, runs: 1 });
    const isBest = PR.recordRun({ score: res.score, dist: res.dist, gold: res.gold });
    void P;
    this.ui.showResults({ ...res, isBest, doubled: false, doubleCost: Math.max(5, Math.ceil(res.gold / 50)) });
    if (isBest) Audio.play('fanfare');
    return res;
  }

  // From the pause menu: restart or go home (collected rewards are kept).
  endRun(restart) {
    const res = this.game.finishRun();
    PR.grant([{ k: 'gold', n: res.gold }, { k: 'gems', n: res.gems }], { silent: true });
    PR.commitRunStats({ ...res.stats, runs: 1 });
    PR.recordRun({ score: res.score, dist: res.dist, gold: res.gold });
    if (restart) this.startRun(); else this.goLobby();
  }

  goLobby() {
    this.game.showLobby();
    this.ui.closeAllModals();
    this.syncLobby();
    this.ui.showLobby();
    Audio.startMusic('lobby');
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
    Billing.demoConfirm = (p) => ui.confirm(`${t('demoConfirm', { p: this.productName(p) })}<br><small>${t('demoStore')}</small>`);
    Billing.init({
      grant: (def, qty, token, purchase) => this.grantPurchase(def, qty, token, purchase),
      message: (key, kind) => ui.toast(t(key), kind === 'error' ? 'warn' : kind === 'ok' ? 'ok' : 'info', { center: true }),
      onPrices: () => ui.refresh(),
      onReady: () => ui.refresh(),
      onRestore: (r) => {
        const P = PR.profile();
        if (r.ok && !(r.subsActive || []).includes('ebot_club') && P.iap.clubUntil > Date.now()) { P.iap.clubUntil = Date.now(); PR.changed(); }
        if (r.manual) ui.toast(t('restored'), 'ok', { center: true });
      },
    });
  }

  productName(p) {
    if (p.id.startsWith('gems_')) return `${fmt(p.grant[0].n)} ${t('gems')}`;
    if (p.id.startsWith('gold_') && p.consumable) return `${fmt(p.grant[0].n)} ${t('gold')}`;
    return t('p_' + p.id);
  }

  // Returns true when the purchase was granted now (false when it was already delivered before).
  grantPurchase(def, qty, token, purchase) {
    const P = PR.profile();
    const known = P.iap.tokens.includes(token);
    if (def.type === 'subs') {
      P.iap.clubUntil = Math.max(P.iap.clubUntil, Date.now() + 2 * 24 * 3600 * 1000);
      if (!known) { P.iap.tokens.push(token); this.ui.popup(t('p_ebot_club'), [], `<p class="msg">${t('p_ebot_club_d')}</p>`); }
      PR.changed();
      return !known;
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
    void purchase;
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
    window.ebotOnBack = () => this.ui.back();
    window.ebotOnPause = () => { this.pause(); Audio.suspend(); writeNow(PR.profile()); };
    window.ebotOnResume = () => { Audio.resume(); };
    window.ebotSetInsets = (top, bottom) => {
      document.documentElement.style.setProperty('--safe-top', top + 'px');
      document.documentElement.style.setProperty('--safe-bottom', bottom + 'px');
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.pause(); Audio.suspend(); writeNow(PR.profile()); } else Audio.resume();
    });
    window.addEventListener('pagehide', () => writeNow(PR.profile()));
  }
}

function boot() {
  const splash = document.getElementById('splash');
  let app;
  try {
    app = new App();
    window.__ebot = app;
    window.__ebotPR = PR; // debug/test hook
  } catch (e) {
    console.error(e);
    splash.querySelector('.hint').textContent = 'Error: ' + e.message;
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
    Audio.startMusic('lobby');
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 500);
    app.ui.showLobby();
  };
  splash.addEventListener('pointerup', go);
  if (window.EbotNative && window.EbotNative.appReady) { try { window.EbotNative.appReady(); } catch (e) { /* ignore */ } }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
void L; void charById; void PRODUCTS;
