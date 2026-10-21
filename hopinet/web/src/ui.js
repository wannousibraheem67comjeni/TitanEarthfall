// DOM user interface: lobby, HUD, world map, bottom sheets and modal screens.
import { t, L, fmt, fmtShort, fmtTime, getLang } from './i18n.js';
import { icon, ICONS } from './icons.js';
import * as PR from './progress.js';
import {
  WORLDS, CHARACTERS, POWERUPS, POWERUP_IDS, UPGRADE_IDS, MAX_UPGRADE, HOUSE_STAGES, HOUSE_STAGE_NAMES, VAULTS,
  WHEEL, DAILY_REWARDS, PRODUCTS, GEM_OFFERS, REVIVE_COSTS, REVIVE_GEM_PER_BATTERY, MAX_VAULT_SLOTS,
  HOME_ITEMS, HOME_ITEM_BONUS, STAGES, PLACES, VEHICLES, VEHICLE_IDS,
  charById, worldById, worldIndex, GAME_VERSION, CLUB_DAILY, BRAND,
} from './config.js';
import { Billing } from './billing.js';
import { Audio } from './audio.js';
import { critterPortraitSVG } from './critter.js';
import { LAND_PATH, MAP_LAT_TOP, MAP_LAT_BOTTOM } from './worldmap.js';

const $ = (sel, root = document) => root.querySelector(sel);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GOAL_ICON = { dist: 'flag', coins: 'gold', vehicle: 'vehicle', swim: 'swim', boss: 'boss' };

function itemHTML(it, big = false) {
  const ic = it.k === 'vault' ? 'vault_' + (it.v || 'steel') : it.k;
  return `<span class="item ${big ? 'big' : ''}">${icon(ic)}<b>${it.k === 'vault' ? '×' + it.n : fmtShort(it.n)}</b></span>`;
}
function costHTML(c) {
  const parts = [];
  if (c.gold) parts.push(`${icon('gold')}${fmtShort(c.gold)}`);
  if (c.gems) parts.push(`${icon('gems')}${fmtShort(c.gems)}`);
  if (c.batteries) parts.push(`${icon('batteries')}${fmtShort(c.batteries)}`);
  return `<span class="cost">${parts.join(' ')}</span>`;
}
// '/month' style suffix built from the billing period Google Play reports (ISO 8601, e.g. P1M).
function periodSuffix(p) {
  const m = /^P(\d+)([DWMY])$/.exec(p || '');
  if (!m) return '';
  const unit = { D: 'day', W: 'week', M: 'month', Y: 'year' }[m[2]];
  return m[1] === '1' ? t('per_' + unit) : ` / ${m[1]} ${t('unit_' + unit)}`;
}
function portrait(ch, skin, size = 56) {
  let s = '';
  try { s = critterPortraitSVG(ch.species, skin, size); } catch (e) { s = ''; }
  if (s && s.length > 20) return `<span class="portrait" style="width:${size}px;height:${size}px">${s}</span>`;
  return `<span class="portrait" style="width:${size}px;height:${size}px"><svg viewBox="0 0 64 64" width="${size}" height="${size}"><circle cx="32" cy="34" r="24" fill="${hex(skin.fur)}" stroke="#0b1a4a" stroke-width="3"/><circle cx="24" cy="32" r="5" fill="${hex(skin.lens)}"/><circle cx="40" cy="32" r="5" fill="${hex(skin.lens)}"/><path d="M26 44q6 5 12 0" fill="none" stroke="#0b1a4a" stroke-width="3" stroke-linecap="round"/></svg></span>`;
}
function starsHTML(n, total = 3) {
  return `<span class="stars">${Array.from({ length: total }, (_, i) => icon(i < n ? 'stars' : 'starOff')).join('')}</span>`;
}
function goalText(g) {
  return t('goal_' + g.type, { n: fmt(g.n) });
}
// Great-circle distance in km.
function haversine(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const mapX = (lon) => ((lon + 180) / 360) * 100;
const mapY = (lat) => ((MAP_LAT_TOP - lat) / (MAP_LAT_TOP - MAP_LAT_BOTTOM)) * 100;

export class UI {
  constructor(app) {
    this.app = app;
    this.root = $('#ui');
    this.modals = [];
    this.sheet = null;
    this.buildTab = 'house';
    this.viewChar = null;
    this.viewSkin = null;
    this.mapWorld = null;
    this.popupQueue = [];
    this.hudFrame = 0;
    this.lastTut = undefined;
    this.goalStage = null;
    this.root.innerHTML = `
      <div id="lobby" class="layer hidden"></div>
      <div id="hud" class="layer hidden"></div>
      <div id="sheet" class="hidden"></div>
      <div id="modals"></div>
      <div id="toasts"></div>`;
    this.lobbyEl = $('#lobby'); this.hudEl = $('#hud'); this.sheetEl = $('#sheet');
    this.modalsEl = $('#modals'); this.toastsEl = $('#toasts');
    this.root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-a]');
      if (!el || el.disabled) return;
      e.preventDefault();
      Audio.play('click');
      this.action(el.dataset.a, el);
    });
    this._lobbyDrag();
    PR.onChange(() => this.refresh());
    setInterval(() => this.tick(), 1000);
  }

  // ---------------- generic modal plumbing ----------------
  openModal(id, render, opts = {}) {
    const el = document.createElement('div');
    el.className = 'modal-wrap ' + (opts.cls || '');
    el.dataset.id = id;
    this.modalsEl.appendChild(el);
    const m = { id, el, render, opts };
    this.modals.push(m);
    this._renderModal(m);
    requestAnimationFrame(() => el.classList.add('show'));
    return m;
  }
  _renderModal(m) {
    if (!m) return;
    const body = m.el.querySelector('.mbody');
    const scroll = body ? body.scrollTop : 0;
    const content = m.render();
    if (content === m.lastHTML) return;
    m.lastHTML = content;
    m.el.innerHTML = m.opts.raw ? content : `
      <div class="modal ${m.opts.size || ''}">
        <div class="mhead"><h2>${m.opts.title ? m.opts.title() : ''}</h2>${m.opts.noClose ? '' : `<button class="x" data-a="modal:close">${icon('close')}</button>`}</div>
        <div class="mbody">${content}</div>
      </div>`;
    const nb = m.el.querySelector('.mbody');
    if (nb) nb.scrollTop = scroll;
    if (m.opts.after) m.opts.after(m.el);
    this._updateTimers(m.el);
  }
  closeModal(id) {
    const i = id ? this.modals.findIndex((m) => m.id === id) : this.modals.length - 1;
    if (i < 0) return;
    const [m] = this.modals.splice(i, 1);
    m.el.classList.remove('show');
    m.el.style.pointerEvents = 'none'; // a second tap must not hit the fading copy
    setTimeout(() => m.el.remove(), 180);
    if (m.opts.onClose) m.opts.onClose();
    if (!this.modals.length) this._showNextPopup();
  }
  closeAllModals() {
    this._closingAll = true;
    try { while (this.modals.length) this.closeModal(); } finally { this._closingAll = false; }
  }
  topModal() { return this.modals[this.modals.length - 1]; }
  hasModal(id) { return this.modals.some((m) => m.id === id); }
  refresh() {
    if (!this.lobbyEl.classList.contains('hidden')) this.renderLobby();
    if (this.sheet) this.renderSheet();
    for (const m of this.modals) if (!m.opts.static && !m.busy) this._renderModal(m);
  }
  // Countdown labels are updated in place once per second; the DOM is only rebuilt when a
  // timer expires (so buttons are never replaced under the player's finger).
  tick() {
    const expired = this._updateTimers(this.root);
    if (expired) this.refresh();
  }
  _updateTimers(root) {
    let expired = false;
    const now = Date.now();
    root.querySelectorAll('[data-until]').forEach((el) => {
      const left = +el.dataset.until - now;
      if (left <= 0) { expired = true; return; }
      el.textContent = el.dataset.tpl ? t(el.dataset.tpl, { t: fmtTime(left) }) : fmtTime(left);
    });
    return expired;
  }

  confirm(msg, yes = t('yes'), no = t('no')) {
    return new Promise((resolve) => {
      const m = this.openModal('confirm', () => `
        <p class="msg">${msg}</p>
        <div class="btn-row"><button class="btn red" data-a="confirm:no">${no}</button><button class="btn green" data-a="confirm:yes">${yes}</button></div>`,
      { title: () => t('confirmBuy'), size: 'small', static: true, onClose: () => resolve(false) });
      m.resolve = (v) => { m.opts.onClose = null; this.closeModal('confirm'); resolve(v); };
    });
  }
  info(title, html) {
    this.openModal('info', () => html, { title: () => title, size: 'small', static: true });
  }

  toast(text, kind = 'info', opts = {}) {
    const el = document.createElement('div');
    el.className = `toast ${kind} ${opts.big ? 'big' : ''} ${opts.center ? 'center' : ''}`;
    el.innerHTML = (opts.icon ? icon(opts.icon) : '') + `<span>${text}</span>`;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.classList.add('out'), opts.dur || 1500);
    setTimeout(() => el.remove(), (opts.dur || 1500) + 500);
  }

  // Reward popups are queued so they never stack on top of each other.
  popup(title, items, extra = '') {
    this.popupQueue.push({ title, items, extra });
    if (!this.hasModal('popup')) this._showNextPopup();
  }
  _showNextPopup() {
    if (this._closingAll || this.hasModal('popup') || !this.popupQueue.length) return;
    if (this.app.inRun()) return;
    const p = this.popupQueue.shift();
    Audio.play('reward');
    this.openModal('popup', () => `
      <div class="burst"></div>
      ${p.extra}
      <div class="items">${(p.items || []).map((it) => itemHTML(it, true)).join('')}</div>
      <button class="btn green wide" data-a="modal:close">${t('collect')}</button>`,
    { title: () => p.title, size: 'small reward', static: true, onClose: () => setTimeout(() => this._showNextPopup(), 200) });
  }

  // ---------------- screens ----------------
  showLobby() {
    this.hudEl.classList.add('hidden');
    this.lobbyEl.classList.remove('hidden');
    this.renderLobby();
    this._showNextPopup();
  }
  showHud(stage = null) {
    this.closeAllModals();
    this.closeSheet(true);
    this.lobbyEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
    this.goalStage = stage;
    this.renderHud();
  }

  renderLobby() {
    const P = PR.profile();
    const b = PR.badges();
    const w = worldById(P.world);
    const st = PR.currentStage();
    const realStore = !Billing.free;
    // Only advertise the starter pack when Google Play can actually sell it.
    const offer = PR.clubActive() ? 'club' : (!P.iap.starter && Billing.available('starter_pack') ? 'starter' : 'offers');
    const btn = (a, ic, label, badge, extra = '') => `<button class="side-btn" data-a="${a}">${icon(ic)}<span>${label}</span>${badge ? `<i class="badge">${badge === true ? '!' : badge}</i>` : ''}${extra}</button>`;
    const gift = PR.giftReady() ? '' : `<small class="timer" data-until="${P.giftNext}"></small>`;
    this.lobbyEl.classList.toggle('sheet-open', !!this.sheet);
    const gb = Math.round(PR.goldBonus() * 100);
    const html = `
      ${this.topBar()}
      <div class="lobby-title"><div class="logo">${icon('logo')}<span>${t('title')}</span></div>
        <div class="stats-row"><span class="chip">${icon('trophy')}${fmt(P.best)}</span><span class="chip mult">${t('multiplier')} x${PR.multiplier()}</span>${gb ? `<span class="chip goldb">${icon('gold')}+${gb}%</span>` : ''}<span class="chip">${icon('stars')}${PR.totalStars()}/${STAGES.length * 3}</span></div></div>
      <div class="side start">
        ${btn('open:daily', 'daily', t('daily'), b.daily)}
        ${btn('open:missions', 'missions', t('missions'), b.missions || false)}
        ${btn('open:wheel', 'wheel', t('wheel'), b.wheel)}
        ${btn('open:upgrades', 'upgrades', t('upgrades'), false)}
      </div>
      <div class="side end">
        ${btn('gift', 'gift', t('gift'), b.gift, gift)}
        ${btn('open:vaults', 'vault', t('vaults'), b.vaults)}
        ${btn(realStore ? 'open:shop:gems' : 'open:shop:items', 'shop', t('shop'), false)}
        ${!realStore ? '' : offer === 'club' ? btn('club', 'club', t('p_hopinet_club'), b.club) : btn('open:shop:offers', 'offer', offer === 'starter' ? t('p_starter_pack') : t('tabOffers'), offer === 'starter')}
      </div>
      <div class="lobby-bottom">
        <button class="world-chip" data-a="open:map">${icon('map')}<span>${L(w.name)}<small>${st ? t('stageN', { n: st.n }) + ' · ' + goalText(st.goal) : t('freeRun')}</small></span><i class="badge-ish">${b.stages ? '!' : ''}</i></button>
        <div class="row">
          <button class="big-btn blue" data-a="sheet:chars">${icon('characters')}<span>${t('characters')}</span></button>
          <button class="play-btn" data-a="play"><span>${st ? t('startStage') : t('play')}</span></button>
          <button class="big-btn orange" data-a="sheet:build">${icon('house')}<span>${t('myHome')}</span>${b.build ? '<i class="badge">!</i>' : ''}</button>
        </div>
      </div>`;
    if (html !== this._lobbyHTML) {
      this._lobbyHTML = html;
      this.lobbyEl.innerHTML = html;
      this._updateTimers(this.lobbyEl);
    }
  }

  topBar() {
    const P = PR.profile();
    const tab = Billing.free ? 'items' : null;
    return `<div class="topbar">
      <button class="pill" data-a="open:shop:${tab || 'gold'}">${icon('gold')}<b>${fmtShort(P.gold)}</b><i class="plus">+</i></button>
      <button class="pill" data-a="open:shop:${tab || 'gems'}">${icon('gems')}<b>${fmtShort(P.gems)}</b><i class="plus">+</i></button>
      <button class="pill" data-a="open:shop:items">${icon('batteries')}<b>${fmtShort(P.batteries)}</b><i class="plus">+</i></button>
      <button class="round-btn" data-a="open:settings">${icon('settings')}</button>
    </div>`;
  }

  _lobbyDrag() {
    let x0 = null;
    this.lobbyEl.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) x0 = e.clientX; });
    window.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      this.app.game.dragLobby(e.clientX - x0);
      x0 = e.clientX;
    });
    window.addEventListener('pointerup', () => { x0 = null; });
  }

  // ---------------- HUD ----------------
  renderHud() {
    this.hudEl.innerHTML = `
      <div class="hud-top">
        <div class="score-box"><div class="score" id="hScore">0</div><div class="mult" id="hMult">x1</div></div>
        <div class="hud-right">
          <div class="gold-count">${icon('gold')}<b id="hGold">0</b></div>
          <div class="gem-count hidden" id="hGemsBox">${icon('gems')}<b id="hGems">0</b></div>
          <div class="dist" id="hDist">0 ${t('m')}</div>
        </div>
        <button class="round-btn pause" data-a="pause">${icon('pause')}</button>
      </div>
      <div class="goal-chip hidden" id="hGoal"><span class="gi" id="hGoalIc"></span><div><b id="hGoalTxt"></b><div class="bar"><i id="hGoalBar"></i></div></div></div>
      <div class="veh-chip hidden" id="hVeh"><span class="vi" id="hVehIc"></span><div class="bar"><i id="hVehBar"></i></div><b id="hVehT"></b></div>
      <div class="boss-bar hidden" id="hBoss">${icon('boss')}<div class="pips"></div></div>
      <div class="pu-list" id="hPu"></div>
      <div class="speech hidden" id="hSpeech"></div>
      <div class="tutorial hidden" id="hTut"></div>
      <button class="headstart hidden" id="hHead" data-a="headstart">${icon('headstart')}<span>${t('headstart')}</span><b id="hHeadN"></b></button>
      <div class="swipe-zone" id="swipeZone"></div>`;
    this.hud = {
      score: $('#hScore'), mult: $('#hMult'), gold: $('#hGold'), dist: $('#hDist'), pu: $('#hPu'),
      boss: $('#hBoss'), speech: $('#hSpeech'), tut: $('#hTut'), head: $('#hHead'), headN: $('#hHeadN'),
      gems: $('#hGems'), gemsBox: $('#hGemsBox'),
      goal: $('#hGoal'), goalIc: $('#hGoalIc'), goalTxt: $('#hGoalTxt'), goalBar: $('#hGoalBar'),
      veh: $('#hVeh'), vehIc: $('#hVehIc'), vehBar: $('#hVehBar'), vehT: $('#hVehT'),
    };
    this.puShown = '';
    this.vehShown = '';
    this.lastTut = undefined;
    this.setGoal(this.goalStage);
  }

  // Stage goal shown at the top while a campaign stage is being played.
  setGoal(stage) {
    this.goalStage = stage || null;
    const h = this.hud;
    if (!h) return;
    if (!stage) { h.goal.classList.add('hidden'); return; }
    h.goal.classList.remove('hidden');
    h.goalIc.innerHTML = icon(GOAL_ICON[stage.goal.type]);
  }

  updateHud(r) {
    if (!this.hud) return;
    this.hudFrame++;
    if (this.hudFrame % 2) return;
    const h = this.hud;
    h.score.textContent = fmt(r.score);
    h.mult.textContent = 'x' + r.mult;
    h.gold.textContent = fmt(r.gold);
    h.dist.textContent = fmt(r.d) + ' ' + t('m');
    if (r.gems > 0) { h.gemsBox.classList.remove('hidden'); h.gems.textContent = r.gems; }
    const active = POWERUP_IDS.filter((id) => r.pu[id] > 0);
    const key = active.join(',');
    if (key !== this.puShown) {
      this.puShown = key;
      h.pu.innerHTML = active.map((id) => `<div class="pu" data-pu="${id}">${icon(id)}<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" class="bg"/><circle cx="18" cy="18" r="16" class="fg" style="stroke:${hex(POWERUPS[id].color)}"/></svg></div>`).join('');
    }
    for (const id of active) {
      const el = h.pu.querySelector(`[data-pu="${id}"] .fg`);
      if (el) el.style.strokeDashoffset = String(100.5 * (1 - r.pu[id] / r.puMax[id]));
    }
    // vehicle ride timer
    const v = r.vehicle;
    const vk = v ? v.kind : '';
    if (vk !== this.vehShown) {
      this.vehShown = vk;
      h.veh.classList.toggle('hidden', !v);
      if (v) { h.vehIc.innerHTML = icon('veh_' + v.kind); h.veh.dataset.kind = v.kind; }
    }
    if (v) {
      h.vehBar.style.width = Math.max(0, (v.t / v.max) * 100) + '%';
      h.vehT.textContent = Math.max(0, Math.ceil(v.t)) + t('sec');
      h.veh.classList.toggle('low', v.t < 3);
    }
    // stage goal progress
    const st = this.goalStage;
    if (st) {
      const g = st.goal;
      let cur = 0;
      if (g.type === 'dist') cur = r.d; else if (g.type === 'coins') cur = r.stats.gold; else if (g.type === 'vehicle') cur = r.stats.vehicles;
      else if (g.type === 'swim') cur = r.stats.swim; else if (g.type === 'boss') cur = r.stats.bosses;
      cur = Math.min(g.n, Math.floor(cur));
      h.goalTxt.textContent = g.type === 'boss' ? t('goalShort_boss') : `${t('goalShort_' + g.type)} ${fmt(cur)}/${fmt(g.n)}`;
      h.goalBar.style.width = (cur / g.n) * 100 + '%';
    }
  }

  setBoss(phase, data) {
    const el = this.hud && this.hud.boss;
    if (!el) return;
    if (phase === 'start' || phase === 'hit') {
      el.classList.remove('hidden');
      el.querySelector('.pips').innerHTML = Array.from({ length: data.max }, (_, i) => `<i class="${i < data.max - data.hits ? 'on' : ''}"></i>`).join('');
      if (phase === 'hit') { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    } else if (phase === 'defeat' || phase === 'end') {
      el.classList.add('hidden');
      if (phase === 'defeat') this.toast(`+${data.gold}`, 'gold', { icon: 'gold' });
    }
  }

  speech(text) {
    const el = this.hud && this.hud.speech;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this._sp);
    this._sp = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  tutorial(kind) {
    if (!this.hud || this.lastTut === kind) return;
    this.lastTut = kind;
    const el = this.hud.tut;
    if (!kind) { el.classList.add('hidden'); return; }
    const txt = { jump: t('tutJump'), slide: t('tutSlide'), lane: t('tutLane') }[kind];
    el.className = 'tutorial ' + kind;
    el.innerHTML = `<div class="hand">${icon('swipe')}</div><p>${txt}</p>`;
  }

  headstartOffer(show, n) {
    if (!this.hud) return;
    this.hud.head.classList.toggle('hidden', !show);
    this.hud.headN.textContent = '×' + n;
  }

  // ---------------- bottom sheets (3D view stays visible) ----------------
  openSheet(kind) {
    this.sheet = kind;
    const P = PR.profile();
    if (kind === 'chars') { this.viewChar = P.char; this.viewSkin = P.skins[P.char]; }
    this.app.game.setView(kind === 'chars' ? 'char' : 'house');
    this.sheetEl.classList.remove('hidden');
    requestAnimationFrame(() => this.sheetEl.classList.add('show'));
    this.renderSheet();
    this.renderLobby();
  }
  closeSheet(silent) {
    if (!this.sheet) return;
    this.sheet = null;
    this.sheetEl.classList.remove('show');
    setTimeout(() => { if (!this.sheet) this.sheetEl.classList.add('hidden'); }, 200);
    this.app.game.setView('home');
    this.app.syncLobby();
    if (!silent) this.renderLobby();
  }
  renderSheet() {
    const html = this.sheet === 'chars' ? this.charsHTML() : this.sheet === 'build' ? this.buildHTML() : '';
    if (html !== this._sheetHTML) {
      const strip = this.sheetEl.querySelector('.char-strip');
      const sx = strip ? strip.scrollLeft : 0;
      const list = this.sheetEl.querySelector('.luxury-list');
      const sy = list ? list.scrollTop : 0;
      this._sheetHTML = html;
      this.sheetEl.innerHTML = html;
      const ns = this.sheetEl.querySelector('.char-strip');
      if (ns) ns.scrollLeft = sx;
      const nl = this.sheetEl.querySelector('.luxury-list');
      if (nl) nl.scrollTop = sy;
    }
    if (this.sheet === 'chars') {
      const c = charById(this.viewChar);
      const skin = c.skins.find((s) => s.id === this.viewSkin) || c.skins[0];
      this.app.previewSkin(c, skin);
    } else this.app.syncLobby();
  }

  charsHTML() {
    const P = PR.profile();
    const c = charById(this.viewChar);
    const owned = PR.charOwned(c.id);
    const skin = c.skins.find((s) => s.id === this.viewSkin) || c.skins[0];
    const skinOwned = PR.skinOwned(c.id, skin.id);
    const perks = Object.entries(c.perk).map(([k, v]) => `<span class="chip perk">${k === 'score' ? icon('star') : icon(k)}${t('perk_' + k)} +${Math.round(v * 100)}%</span>`).join('');
    let action;
    if (!owned) {
      if (c.unlock.type === 'gems') action = `<button class="btn purple wide" data-a="char:unlock">${t('unlock')} ${costHTML({ gems: c.unlock.gems })}</button>`;
      else action = `<div class="locked-note">${icon('lock')}${t('unlockByHouse', { w: L(worldById(c.unlock.world).name) })}</div>`;
    } else if (!skinOwned) {
      action = `<button class="btn ${skin.cost.gems ? 'purple' : 'gold'} wide" data-a="skin:buy">${t('buy')} ${costHTML(skin.cost)}</button>`;
    } else if (P.char === c.id && P.skins[c.id] === skin.id) {
      action = `<button class="btn grey wide" disabled>${icon('check')}${t('selected')}</button>`;
    } else {
      action = `<button class="btn green wide" data-a="char:select">${t('select')}</button>`;
    }
    return `
      <div class="sheet-head"><button class="round-btn" data-a="sheet:close">${icon(getLang() === 'ar' ? 'arrowR' : 'arrowL')}</button><h2>${t('characters')}</h2>${this.miniWallet()}</div>
      <div class="char-strip">${CHARACTERS.map((ch) => {
        const own = PR.charOwned(ch.id);
        const sk = own ? PR.currentSkin(ch.id) : ch.skins[0];
        return `<button class="char-card ${ch.id === c.id ? 'on' : ''} ${own ? '' : 'locked'} ${P.char === ch.id ? 'cur' : ''}" data-a="char:view:${ch.id}">${portrait(ch, sk, 54)}<span>${L(ch.name)}</span>${own ? '' : icon('lock', 'lk')}</button>`;
      }).join('')}</div>
      <div class="char-detail">
        <h3>${L(c.name)} <small>${L(skin.name)}</small></h3>
        <p>${L(c.bio)}</p>
        <div class="perks">${perks}</div>
        <div class="skins"><span class="lbl">${t('skins')}</span>${c.skins.map((s) => {
          const so = PR.skinOwned(c.id, s.id);
          return `<button class="skin ${s.id === skin.id ? 'on' : ''}" data-a="skin:view:${s.id}" style="--b:${hex(s.fur)};--a:${hex(s.accent)}"><i></i>${so ? '' : `<small>${s.cost.gems ? icon('gems') + s.cost.gems : icon('gold') + fmtShort(s.cost.gold)}</small>`}</button>`;
        }).join('')}</div>
      </div>
      <div class="sheet-actions">${action}</div>`;
  }

  miniWallet() {
    const P = PR.profile();
    return `<div class="mini-wallet"><span>${icon('gold')}${fmtShort(P.gold)}</span><span>${icon('gems')}${fmtShort(P.gems)}</span></div>`;
  }

  buildHTML() {
    const P = PR.profile();
    const w = worldById(P.world);
    const stage = PR.houseStage(w.id);
    const unlockedList = WORLDS.filter((x) => PR.isWorldUnlocked(x.id));
    const multi = unlockedList.length > 1;
    const arrowPrev = icon(getLang() === 'ar' ? 'arrowR' : 'arrowL');
    const arrowNext = icon(getLang() === 'ar' ? 'arrowL' : 'arrowR');
    const head = `
      <div class="sheet-head"><button class="round-btn" data-a="sheet:close">${arrowPrev}</button>
        <h2>${multi ? `<button class="mini" data-a="world:prev">${arrowPrev}</button>` : ''}${t('houseOf', { w: L(w.name) })}${multi ? `<button class="mini" data-a="world:next">${arrowNext}</button>` : ''}</h2>${this.miniWallet()}</div>
      <div class="tabs sheet-tabs"><button class="${this.buildTab === 'house' ? 'on' : ''}" data-a="buildtab:house">${icon('build')}${t('tabBuild')}</button><button class="${this.buildTab === 'luxury' ? 'on' : ''}" data-a="buildtab:luxury">${icon('crown')}${t('tabLuxury')}</button></div>`;
    if (this.buildTab === 'luxury') return head + this.luxuryHTML(w);
    const cost = PR.nextStageCost(w.id);
    const rows = HOUSE_STAGE_NAMES.map((n, i) => {
      const c = i === stage ? cost : null;
      const st = i < stage ? 'done' : i === stage ? 'next' : 'todo';
      return `<li class="${st}"><span class="num">${i < stage ? icon('check') : i + 1}</span><span class="nm">${L(n)}</span>${c ? costHTML(c) : ''}</li>`;
    }).join('');
    const nextWorld = WORLDS[worldIndex(w.id) + 1];
    const unlockInfo = stage < HOUSE_STAGES.length
      ? `<p class="hint">${t('multiplierInfo')}</p>`
      : `<p class="hint done">${icon('check')} ${t('complete')}</p>`;
    let action;
    if (!cost) action = `<button class="btn grey wide" disabled>${t('complete')}</button>`;
    else if (PR.canAfford(cost)) action = `<button class="btn gold wide pulse" data-a="build">${icon('build')}${t('buildHouse')} ${costHTML(cost)}</button>`;
    else action = `<button class="btn grey wide" data-a="build">${t('needMore')} ${costHTML(cost)}</button>`;
    const reward = w.unlocks ? `<div class="unlock-preview">${portrait(charById(w.unlocks), charById(w.unlocks).skins[0], 40)}<span>${L(charById(w.unlocks).name)}${nextWorld ? ' + ' + L(nextWorld.name) : ''}</span></div>` : '';
    return `${head}
      <div class="build-progress"><div class="bar"><i style="width:${(stage / HOUSE_STAGES.length) * 100}%"></i></div><b>${stage}/${HOUSE_STAGES.length}</b><span class="chip mult">x${PR.multiplier()}</span></div>
      ${reward}
      <ul class="stages">${rows}</ul>
      ${unlockInfo}
      <div class="sheet-actions">${action}</div>`;
  }

  luxuryHTML(w) {
    const open = PR.homeItemUnlocked(w.id);
    const gb = Math.round(HOME_ITEM_BONUS * 1000) / 10;
    const rows = HOME_ITEMS.map((it) => {
      const own = PR.hasHomeItem(w.id, it.id);
      const cost = PR.homeItemPrice(w.id, it.id);
      const afford = PR.canAfford(cost);
      return `<li class="lux ${own ? 'owned' : ''}">
        <span class="lux-ic">${icon(it.id)}</span>
        <span class="lux-nm"><b>${L(it.name)}</b><small>+${gb}% ${t('goldBonus')}</small></span>
        ${own ? `<span class="owned-tag">${icon('check')}${t('owned')}</span>`
          : `<button class="btn ${afford ? (cost.gems ? 'purple' : 'gold') : 'grey'}" data-a="luxbuy:${it.id}" ${open ? '' : 'disabled'}>${costHTML(cost)}</button>`}
      </li>`;
    }).join('');
    return `
      <div class="build-progress"><div class="bar"><i style="width:${(PR.homeItemsOf(w.id).length / HOME_ITEMS.length) * 100}%"></i></div><b>${PR.homeItemsOf(w.id).length}/${HOME_ITEMS.length}</b><span class="chip goldb">${icon('gold')}+${Math.round(PR.goldBonus() * 100)}%</span></div>
      ${open ? '' : `<p class="hint">${icon('lock')} ${t('luxLocked', { n: PR.HOME_ITEM_MIN_STAGE })}</p>`}
      <ul class="luxury-list">${rows}</ul>`;
  }

  // ---------------- modal screens ----------------
  openShop(tab = 'gems') {
    // The free edition has no real-money store: only the in-game gem exchange.
    this.shopTab = Billing.free ? 'items' : tab;
    if (!Billing.free) Billing.refresh();
    if (this.hasModal('shop')) { this._renderModal(this.modals.find((m) => m.id === 'shop')); return; }
    this.openModal('shop', () => this.shopHTML(), { title: () => t('shop'), size: 'tall' });
  }
  shopHTML() {
    const P = PR.profile();
    const tabs = Billing.free ? ['items'] : ['gems', 'gold', 'offers', 'items'];
    const tabLbl = { gems: t('tabGems'), gold: t('tabGold'), offers: t('tabOffers'), items: t('tabItems') };
    // Real-money buttons only show a price Google Play returned; otherwise they are disabled.
    const buyBtn = (id, suffix = '') => (Billing.available(id)
      ? `<button class="btn green" data-a="buy:${id}">${esc(Billing.price(id))}${suffix}</button>`
      : `<button class="btn grey" disabled>${t('notAvailable')}</button>`);
    const prodCard = (p, n, ic) => `
      <div class="prod ${p.tag ? 'tagged' : ''}">${p.tag ? `<span class="tag">${t('tag_' + p.tag)}</span>` : ''}
        <div class="pile">${icon(ic)}${n > 400 ? icon(ic, 'b2') : ''}${n > 2000 ? icon(ic, 'b3') : ''}</div>
        <b class="amt">${fmt(n)}</b>
        ${buyBtn(p.id)}</div>`;
    let body = '';
    if (this.shopTab === 'gems') {
      body = `<div class="grid3">${PRODUCTS.filter((p) => p.id.startsWith('gems_')).map((p) => prodCard(p, p.grant[0].n, 'gems')).join('')}</div>`;
    } else if (this.shopTab === 'gold') {
      body = `<div class="grid3">${PRODUCTS.filter((p) => p.id.startsWith('gold_') && p.consumable).map((p) => prodCard(p, p.grant[0].n, 'gold')).join('')}
        ${GEM_OFFERS.filter((o) => o.give.k === 'gold').map((o) => `<div class="prod"><div class="pile">${icon('gold')}</div><b class="amt">${fmt(o.give.n)}</b><button class="btn purple" data-a="gemoffer:${o.id}">${icon('gems')}${o.gems}</button></div>`).join('')}</div>`;
    } else if (this.shopTab === 'offers') {
      const sp = PRODUCTS.find((p) => p.id === 'starter_pack');
      body = `
        <div class="offer-card starter ${P.iap.starter ? 'owned' : ''}"><span class="tag">${t('tag_starter')}</span>
          <h3>${t('p_starter_pack')}</h3><div class="items">${sp.grant.map((it) => itemHTML(it)).join('')}</div>
          ${P.iap.starter ? `<button class="btn grey" disabled>${icon('check')}${t('purchased')}</button>` : buyBtn('starter_pack')}</div>
        <div class="offer-card doubler ${P.iap.doubler ? 'owned' : ''}"><span class="tag">${t('tag_forever')}</span>
          <h3>${icon('double')}${t('p_gold_doubler')}</h3><p>${t('p_gold_doubler_d')}</p>
          ${P.iap.doubler ? `<button class="btn grey" disabled>${icon('check')}${t('owned')}</button>` : buyBtn('gold_doubler')}</div>
        <div class="offer-card club ${PR.clubActive() ? 'owned' : ''}"><span class="tag">${t('tag_club')}</span>
          <h3>${icon('club')}${t('p_hopinet_club')}</h3><p>${t('p_hopinet_club_d')}</p><div class="items">${CLUB_DAILY.map((it) => itemHTML(it)).join('')}</div>
          ${PR.clubActive() ? (PR.clubClaimAvailable() ? `<button class="btn gold" data-a="club">${t('claim')}</button>` : `<button class="btn grey" disabled>${icon('check')}${t('active')}</button>`) : buyBtn('hopinet_club', periodSuffix(Billing.period('hopinet_club')))}</div>`;
    } else {
      body = `<div class="grid3">${GEM_OFFERS.filter((o) => o.give.k !== 'gold').map((o) => `<div class="prod"><div class="pile">${icon(o.give.k)}</div><b class="amt">×${o.give.n}</b><small>${t(o.give.k)}</small><button class="btn purple" data-a="gemoffer:${o.id}">${icon('gems')}${o.gems}</button></div>`).join('')}</div>
        ${Billing.free ? `<p class="store-status info">${icon('info')}<span>${t('freeEdition')}</span></p>` : ''}`;
    }
    const realMoneyTab = this.shopTab !== 'items';
    return `
      <div class="wallet-row">${this.miniWallet()}<span>${icon('batteries')}${P.batteries}</span><span>${icon('headstart')}${P.headstart}</span></div>
      ${tabs.length > 1 ? `<div class="tabs">${tabs.map((k) => `<button class="${k === this.shopTab ? 'on' : ''}" data-a="shoptab:${k}">${tabLbl[k]}</button>`).join('')}</div>` : ''}
      ${realMoneyTab ? this.storeBanner() : ''}
      ${body}
      ${Billing.mode === 'play' ? `<button class="link" data-a="restore">${t('restore')}</button>` : ''}`;
  }

  // Tells the player exactly what Google Play answered; nothing here is simulated.
  storeBanner() {
    const st = Billing.status();
    const cls = { ok: 'ok', web: 'info', connecting: 'info', offline: 'warn', none: 'warn', missing: 'warn' }[st];
    let text;
    if (st === 'missing') text = t('st_missing', { n: Billing.missing.length, ids: Billing.missing.join(', ') });
    else if (st === 'offline' && Billing.queryError()) text = t('st_offline') + ` <small dir="ltr">(${esc(Billing.queryError())})</small>`;
    else text = t('st_' + st);
    return `<p class="store-status ${cls}">${icon(st === 'ok' ? 'check' : 'info')}<span>${text}</span></p>`;
  }

  openUpgrades() {
    this.openModal('upgrades', () => {
      const P = PR.profile();
      return `<div class="wallet-row">${this.miniWallet()}</div>` + UPGRADE_IDS.map((id) => {
        const lvl = P.upgrades[id] || 0;
        const cost = PR.upgradeCost(id);
        const dur = PR.upgradeSeconds(id, lvl);
        const next = cost != null ? PR.upgradeSeconds(id, lvl + 1) : null;
        const vehIcons = id === 'vehicle' ? `<div class="veh-row">${VEHICLE_IDS.map((k) => icon('veh_' + k)).join('')}</div>` : '';
        return `<div class="upg">
          <div class="upg-ic">${icon(id)}</div>
          <div class="upg-info"><h4>${t('pu_' + id)}</h4><p>${t('pu_' + id + '_d')}</p>${vehIcons}
            <div class="pips">${Array.from({ length: MAX_UPGRADE }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
            <small>${t('duration')}: <b>${dur.toFixed(1)}${t('sec')}</b>${next ? ` → <b class="up">${next.toFixed(1)}${t('sec')}</b>` : ''}</small></div>
          ${cost != null ? `<button class="btn ${P.gold >= cost ? 'gold' : 'grey'}" data-a="upgrade:${id}">${costHTML({ gold: cost })}</button>` : `<span class="maxed">${t('max')}</span>`}
        </div>`;
      }).join('');
    }, { title: () => t('upgrades'), size: 'tall' });
  }

  // ---------------- world map + campaign stages ----------------
  openMap() {
    const P = PR.profile();
    this.mapWorld = PR.isWorldUnlocked(P.world) ? P.world : WORLDS[0].id;
    this.openModal('map', () => this.mapHTML(), { title: () => t('map'), size: 'tall' });
  }
  mapHTML() {
    const P = PR.profile();
    const sel = worldById(this.mapWorld);
    const me = P.myPlace;
    let nearest = null;
    if (me) {
      for (const w of WORLDS) {
        const d = haversine(me, PLACES[w.id]);
        if (!nearest || d < nearest.d) nearest = { w, d };
      }
    }
    const pins = WORLDS.map((w, i) => {
      const pl = PLACES[w.id];
      const un = PR.isWorldUnlocked(w.id);
      return `<button class="pin ${un ? '' : 'locked'} ${w.id === sel.id ? 'on' : ''}" style="left:${mapX(pl.lon)}%;top:${mapY(pl.lat)}%;--c:${hex(w.sky[0])};--c2:${hex(w.sky[1])}" data-a="map:world:${w.id}"><i>${un ? i + 1 : icon('lock')}</i><span>${L(pl)}</span></button>`;
    }).join('');
    const mePin = me ? `<div class="me-pin" style="left:${mapX(me.lon)}%;top:${mapY(me.lat)}%"><i></i><span>${t('you')}</span></div>` : '';
    const grid = [-60, -30, 0, 30, 60].map((la) => `<path d="M0 ${90 - la}H360" class="grid"/>`).join('') + [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lo) => `<path d="M${lo + 180} 10V148" class="grid"/>`).join('');
    const stages = STAGES.filter((s) => s.world === sel.id);
    const unlocked = PR.isWorldUnlocked(sel.id);
    const prev = WORLDS[worldIndex(sel.id) - 1];
    const nodes = stages.map((st) => {
      const un = PR.stageUnlocked(st);
      const stars = PR.stageStars(st.id);
      return `<button class="stage-node ${un ? '' : 'locked'} ${stars ? 'done' : ''} ${st.goal.type === 'boss' ? 'boss' : ''} ${P.stage === st.id ? 'cur' : ''}" data-a="stage:play:${st.id}" ${un ? '' : 'disabled'}>
        <b class="n">${un ? st.n : icon('lock')}</b>
        <span class="g">${icon(GOAL_ICON[st.goal.type])}<em>${goalText(st.goal)}</em></span>
        <span class="r">${itemHTML({ k: 'gold', n: st.reward.gold })}${itemHTML({ k: 'gems', n: st.reward.gems })}</span>
        ${starsHTML(stars)}
      </button>`;
    }).join('');
    const dist = me ? Math.round(haversine(me, PLACES[sel.id])) : null;
    return `
      <div class="worldmap" style="--ar:${360 / (MAP_LAT_TOP - MAP_LAT_BOTTOM)}">
        <svg viewBox="0 ${90 - MAP_LAT_TOP} 360 ${MAP_LAT_TOP - MAP_LAT_BOTTOM}" preserveAspectRatio="none" aria-hidden="true">
          <rect x="0" y="0" width="360" height="180" class="sea"/>${grid}<path d="${LAND_PATH}" class="land"/>
        </svg>${pins}${mePin}
      </div>
      <div class="map-tools">
        <button class="btn blue" data-a="map:locate">${icon('target')}${t('myLocation')}</button>
        ${me ? `<button class="btn grey" data-a="map:forget">${t('forgetLocation')}</button>` : ''}
        ${nearest ? `<small class="near">${icon('pin')}${t('nearest', { w: L(PLACES[nearest.w.id]), d: fmt(nearest.d) })}</small>` : `<small class="near">${t('locationHint')}</small>`}
      </div>
      <div class="map-world" style="--s1:${hex(sel.sky[0])};--s2:${hex(sel.sky[1])}">
        <div><h3>${L(sel.name)}</h3><p>${L(sel.desc)} · ${L(PLACES[sel.id])}${dist !== null ? ` · ${fmt(dist)} ${t('km')}` : ''}</p></div>
        ${unlocked ? `<button class="btn green" data-a="map:free:${sel.id}">${t('freeRun')}</button>` : ''}
      </div>
      ${unlocked ? `<div class="stage-grid">${nodes}</div>` : `<p class="hint lk">${icon('lock')} ${t('worldLocked', { w: prev ? L(prev.name) : '' })}</p>`}`;
  }
  mapLocate() {
    const P = PR.profile();
    if (!navigator.geolocation) { this.toast(t('locationFail'), 'warn'); return; }
    this.toast(t('locating'), 'info', { icon: 'target' });
    navigator.geolocation.getCurrentPosition((pos) => {
      // Rounded to ~10 km and kept only on this device; never sent anywhere.
      P.myPlace = { lat: Math.round(pos.coords.latitude * 10) / 10, lon: Math.round(pos.coords.longitude * 10) / 10 };
      PR.changed();
      Audio.play('reward');
    }, () => { this.toast(t('locationFail'), 'warn'); Audio.play('error'); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  }

  openVaults() {
    this.openModal('vaults', () => {
      const P = PR.profile();
      const now = Date.now();
      const unlockingOther = P.vaults.some((v) => v.unlockAt && v.unlockAt > now);
      const slots = [];
      for (let i = 0; i < MAX_VAULT_SLOTS; i++) {
        const v = P.vaults[i];
        if (!v) { slots.push(`<div class="slot empty"><span>${t('emptySlot')}</span></div>`); continue; }
        let inner;
        if (PR.vaultReady(v)) inner = `<button class="btn green" data-a="vault:open:${v.id}">${t('open')}</button>`;
        else if (v.unlockAt) inner = `<small class="timer" data-until="${v.unlockAt}"></small><button class="btn purple" data-a="vault:instant:${v.id}">${t('openNow')} ${costHTML({ batteries: PR.vaultInstantCost(v) })}</button>`;
        else inner = `<small>${VAULTS[v.type].unlockH}${t('h')}</small>${unlockingOther ? `<button class="btn purple" data-a="vault:instant:${v.id}">${costHTML({ batteries: PR.vaultInstantCost(v) })}</button>` : `<button class="btn blue" data-a="vault:start:${v.id}">${t('startUnlock')}</button>`}`;
        slots.push(`<div class="slot ${v.type}">${icon('vault_' + v.type)}<b>${L(VAULTS[v.type].name)}</b>${inner}</div>`);
      }
      const wood = PR.woodReady()
        ? `<button class="btn green" data-a="vault:wood">${t('free')}</button>`
        : `<small class="timer" data-until="${P.woodNext}" data-tpl="freeVaultIn"></small>`;
      return `
        <div class="wallet-row">${this.miniWallet()}<span>${icon('batteries')}${P.batteries}</span></div>
        <div class="vault-free ${PR.woodReady() ? 'ready' : ''}">${icon('vault_wood')}<div><b>${L(VAULTS.wood.name)}</b><small>${t('contains', { n: VAULTS.wood.rolls })}</small></div>${wood}<button class="link" data-a="odds:wood">${t('odds')}</button></div>
        <h4 class="sec">${t('vaultSlots')}</h4>
        <div class="slots">${slots.join('')}</div>
        <div class="vault-shop">
          <div class="vs">${icon('vault_steel')}<b>${L(VAULTS.steel.name)}</b><button class="btn gold" data-a="vault:buySteel">${costHTML({ gold: VAULTS.steel.goldPrice })}</button><button class="link" data-a="odds:steel">${t('odds')}</button></div>
          <div class="vs">${icon('vault_diamond')}<b>${L(VAULTS.diamond.name)}</b><div class="btn-col"><button class="btn purple" data-a="vault:diamond:bat">${costHTML({ batteries: VAULTS.diamond.batteryPrice })}</button><button class="btn purple" data-a="vault:diamond:gems">${costHTML({ gems: VAULTS.diamond.gemPrice })}</button></div><button class="link" data-a="odds:diamond">${t('odds')}</button></div>
        </div>`;
    }, { title: () => t('vaults'), size: 'tall' });
  }

  showVaultOpen(res) {
    if (!res) return;
    Audio.play('build');
    this.openModal('vaultopen', () => `
      <div class="vault-anim">${icon('vault_' + res.type)}</div>
      <div class="items reveal">${res.items.map((it, i) => `<span style="animation-delay:${0.7 + i * 0.25}s">${itemHTML(it, true)}</span>`).join('')}</div>
      <button class="btn green wide" data-a="modal:close">${t('collect')}</button>`,
    { title: () => L(VAULTS[res.type].name), size: 'small reward', static: true });
    setTimeout(() => Audio.play('reward'), 700);
  }

  showOdds(type) {
    const rows = PR.vaultOdds(type).map((o) => `<tr><td>${icon(o.k)} ${t(o.k)}</td><td>${fmt(o.min)}–${fmt(o.max)}</td><td>${o.pct.toFixed(1)}%</td></tr>`).join('');
    const extra = VAULTS[type].guaranteeGems ? `<p class="hint">${icon('gems')} 100% ×1</p>` : '';
    this.info(t('odds') + ' — ' + L(VAULTS[type].name), `<table class="odds">${rows}</table><p class="hint">${t('contains', { n: VAULTS[type].rolls })}</p>${extra}`);
  }

  openWheel() {
    const segs = WHEEL.segments;
    const n = segs.length, a = 360 / n;
    const wedge = (i) => {
      const r = 100, a0 = ((i * a - 90 - a / 2) * Math.PI) / 180, a1 = (((i + 1) * a - 90 - a / 2) * Math.PI) / 180;
      return `M0 0 L${(Math.cos(a0) * r).toFixed(2)} ${(Math.sin(a0) * r).toFixed(2)} A${r} ${r} 0 0 1 ${(Math.cos(a1) * r).toFixed(2)} ${(Math.sin(a1) * r).toFixed(2)} Z`;
    };
    const wheelSVG = `<svg viewBox="-104 -104 208 208" class="wheel-svg">${segs.map((s, i) => `<path d="${wedge(i)}" fill="${s.color}" stroke="#fff" stroke-width="2"/>`).join('')}
      ${segs.map((s, i) => `<g transform="rotate(${i * a}) translate(0 -66)"><g transform="translate(-14 -16) scale(0.44)">${ICONS[s.k].replace('class="ico"', 'width="64" height="64"')}</g><text y="30" text-anchor="middle" font-size="14" font-weight="900" fill="#1b1b3a">${s.jackpot ? '★' : ''}${fmtShort(s.n)}</text></g>`).join('')}
      <circle r="16" fill="#fff" stroke="#1f3a8a" stroke-width="4"/></svg>`;
    this.wheelAngle = this.wheelAngle || 0;
    const m = this.openModal('wheel', () => {
      const P = PR.profile();
      const free = PR.wheelFreeReady();
      return `<div class="wheel-box"><div class="pointer"></div><div class="wheel-rot" style="transform:rotate(${this.wheelAngle}deg)">${wheelSVG}</div></div>
        <div class="btn-row">${free ? `<button class="btn green wide" data-a="spin:free">${t('spinFree')}</button>` : `<button class="btn purple wide" data-a="spin:paid">${t('spinFor', { n: WHEEL.spinGemCost })} ${icon('gems')}</button>`}</div>
        ${free ? '' : `<p class="hint" data-until="${P.wheelNext}" data-tpl="nextSpin"></p>`}
        <button class="link" data-a="odds:wheel">${t('odds')}</button>`;
    }, { title: () => t('wheel') });
    return m;
  }
  spin(paid) {
    const m = this.modals.find((x) => x.id === 'wheel');
    if (!m || m.busy) return;
    const res = PR.spinWheel(paid);
    if (!res) { this.toast(t('notEnough'), 'warn'); Audio.play('error'); return; }
    m.busy = true;
    const n = WHEEL.segments.length, a = 360 / n;
    const cur = this.wheelAngle % 360;
    const target = 360 * 5 + (360 - res.index * a) - cur + (Math.random() - 0.5) * a * 0.6;
    this.wheelAngle += target;
    const rot = m.el.querySelector('.wheel-rot');
    rot.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.16,1)';
    rot.style.transform = `rotate(${this.wheelAngle}deg)`;
    m.el.querySelectorAll('[data-a^="spin"]').forEach((b) => { b.disabled = true; });
    let ticks = 0;
    const tk = setInterval(() => { Audio.play('tick'); if (++ticks > 26) clearInterval(tk); }, 150);
    setTimeout(() => {
      m.busy = false;
      rot.style.transition = '';
      const seg = WHEEL.segments[res.index];
      this.popup(seg.jackpot ? t('jackpot') : t('reward'), res.items);
      this._renderModal(m);
    }, 4400);
  }
  showWheelOdds() {
    const rows = PR.wheelOdds().map((s) => `<tr><td>${icon(s.k)} ${t(s.k)}</td><td>${fmt(s.n)}</td><td>${s.pct.toFixed(1)}%</td></tr>`).join('');
    this.info(t('odds') + ' — ' + t('wheel'), `<table class="odds">${rows}</table>`);
  }

  openDaily() {
    this.openModal('daily', () => {
      const avail = PR.dailyAvailable();
      const idx = PR.dailyIndex();
      return `<div class="daily">${DAILY_REWARDS.map((rw, i) => {
        const st = avail ? (i < idx ? 'past' : i === idx ? 'today' : 'future') : (i <= idx ? 'past' : 'future');
        return `<div class="day ${st} ${i === 6 ? 'd7' : ''}"><small>${t('day', { n: i + 1 })}</small><div class="items">${rw.map((it) => itemHTML(it)).join('')}</div>${st === 'past' ? `<span class="done">${icon('check')}</span>` : ''}</div>`;
      }).join('')}</div>
      ${avail ? `<button class="btn green wide pulse" data-a="daily:claim">${t('claim')}</button>` : `<p class="hint">${t('comeBack')}</p>`}`;
    }, { title: () => t('dailyTitle') });
  }

  openMissions() {
    this.openModal('missions', () => {
      const P = PR.profile();
      return P.missions.map((m, i) => {
        const d = PR.missionDef(m.id);
        const prog = PR.missionProgress(m, null);
        const pct = Math.min(100, (prog / d.n) * 100);
        return `<div class="mission ${m.done ? 'done' : ''}">
          <div class="m-info"><p>${t('m_' + d.stat, { n: fmt(d.n) })}${d.scope === 'run' ? ` <small>(${t('inOneRun')})</small>` : ''}</p>
            <div class="bar"><i style="width:${pct}%"></i></div><small>${fmt(prog)}/${fmt(d.n)}</small></div>
          <div class="m-rew">${itemHTML(d.reward)}${m.done ? `<button class="btn green" data-a="mission:claim:${i}">${t('claim')}</button>` : ''}</div>
        </div>`;
      }).join('') + `<div class="records"><h4 class="sec">${icon('trophy')} ${t('records')}</h4>${(P.records || []).slice(0, 5).map((r, i) => `<div class="rec"><b>#${i + 1}</b><span>${fmt(r.score)}</span><small>${fmt(r.dist)} ${t('m')} · ${L(charById(r.char).name)}</small></div>`).join('') || '<p class="hint">—</p>'}</div>`;
    }, { title: () => t('missionsTitle') });
  }

  openSettings() {
    this.openModal('settings', () => {
      const P = PR.profile();
      const s = P.settings;
      const tog = (k, ic, label) => `<div class="set-row">${icon(ic)}<span>${label}</span><button class="toggle ${s[k] ? 'on' : ''}" data-a="set:${k}"><i></i></button></div>`;
      const st = P.stats;
      const edition = this.app.isAndroid() ? (Billing.free ? ' · Free' : ' · Google Play') : ' · Web';
      return `
        ${tog('sound', 'sound', t('sound'))}
        ${tog('music', 'music', t('music'))}
        ${tog('vibe', 'vibe', t('vibration'))}
        <div class="set-row">${icon('globe')}<span>${t('language')}</span><div class="seg"><button class="${getLang() === 'ar' ? 'on' : ''}" data-a="lang:ar">العربية</button><button class="${getLang() === 'en' ? 'on' : ''}" data-a="lang:en">English</button></div></div>
        <div class="set-row">${icon('star')}<span>${t('quality')}</span><div class="seg"><button class="${s.quality === 'low' ? 'on' : ''}" data-a="quality:low">${t('qLow')}</button><button class="${s.quality !== 'low' ? 'on' : ''}" data-a="quality:high">${t('qHigh')}</button></div></div>
        <h4 class="sec">${t('stats')}</h4>
        <div class="stats-grid">
          <div><small>${t('st_best')}</small><b>${fmt(P.best)}</b></div><div><small>${t('st_bestDist')}</small><b>${fmt(P.bestDist)} ${t('m')}</b></div>
          <div><small>${t('st_runs')}</small><b>${fmt(st.runs)}</b></div><div><small>${t('st_dist')}</small><b>${fmtShort(st.dist)} ${t('m')}</b></div>
          <div><small>${t('st_gold')}</small><b>${fmtShort(st.gold)}</b></div><div><small>${t('st_bosses')}</small><b>${fmt(P.missionTotals.bosses || 0)}</b></div>
          <div><small>${t('st_stars')}</small><b>${PR.totalStars()}/${STAGES.length * 3}</b></div><div><small>${t('st_swim')}</small><b>${fmtShort(st.swim || 0)} ${t('m')}</b></div>
        </div>
        <div class="btn-col">
          ${Billing.mode === 'play' ? `<button class="btn blue" data-a="restore">${t('restore')}</button>` : ''}
          ${this.app.isAndroid() ? `<button class="btn gold" data-a="rate">${icon('star')}${t('rate')}</button>` : ''}
          <button class="btn grey" data-a="privacy">${t('privacy')}</button>
          <button class="btn red" data-a="reset">${t('resetProgress')}</button>
        </div>
        <p class="hint ver">${t('title')} · ${t('version')} ${GAME_VERSION}${edition}</p>
        <p class="hint ver">© ${BRAND.developer}</p>`;
    }, { title: () => t('settings'), size: 'tall' });
  }

  openPause() {
    this.openModal('pause', () => `
      <div class="btn-col">
        <button class="btn green wide" data-a="resume">${icon('play')}${t('resume')}</button>
        <button class="btn blue wide" data-a="restart">${icon('retry')}${t('restart')}</button>
        <button class="btn grey wide" data-a="home">${t('home')}</button>
      </div>
      <div class="quick-toggles">
        <button class="toggle-ic ${PR.profile().settings.sound ? 'on' : ''}" data-a="set:sound">${icon('sound')}</button>
        <button class="toggle-ic ${PR.profile().settings.music ? 'on' : ''}" data-a="set:music">${icon('music')}</button>
      </div>`, { title: () => t('paused'), size: 'small', noClose: true });
  }

  // Shown after a crash or a fall: the big "Run again" button is always the first choice.
  openRevive(revives, cause, onChoice) {
    const P = PR.profile();
    const cost = REVIVE_COSTS[Math.min(revives, REVIVE_COSTS.length - 1)];
    const gemCost = cost * REVIVE_GEM_PER_BATTERY;
    this.reviveChoice = onChoice;
    const m = this.openModal('revive', () => `
      <p class="cause">${t(cause === 'fall' ? 'fellDown' : cause === 'drown' ? 'drowned' : 'crashed')}</p>
      <button class="btn green wide huge run-again" data-a="revive:again">${icon('retry')}<span>${t('runAgain')}</span></button>
      <div class="revive-row">
        <div class="revive-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" id="revRing"/></svg><b id="revNum">5</b></div>
        <div class="btn-col">
          <p class="msg">${t('reviveQ')}</p>
          ${P.batteries >= cost ? `<button class="btn gold wide" data-a="revive:battery">${icon('play')}${t('continueRun')} ${costHTML({ batteries: cost })}</button>` : ''}
          ${P.gems >= gemCost ? `<button class="btn purple wide" data-a="revive:gems">${icon('play')}${t('continueRun')} ${costHTML({ gems: gemCost })}</button>` : ''}
          ${P.batteries < cost && P.gems < gemCost && !Billing.free && PRODUCTS.some((p) => p.id.startsWith('gems_') && Billing.available(p.id)) ? `<button class="btn gold wide" data-a="revive:shop">${t('getMore')} ${icon('gems')}</button>` : ''}
        </div>
      </div>
      <button class="btn grey" data-a="revive:skip">${t('showResults')}</button>`, { title: () => t('revive'), size: 'small', noClose: true, static: true });
    m.cost = cost; m.gemCost = gemCost;
    m.paused = !!this._reviveHeld; // opened while the app is in the background
    this._restartReviveCountdown(m);
    clearInterval(this.reviveTimer);
    this.reviveTimer = setInterval(() => {
      if (m.paused || !this.modals.includes(m)) return;
      m.left--;
      const num = m.el.querySelector('#revNum');
      if (num) num.textContent = Math.max(0, m.left);
      Audio.play('tick');
      if (m.left <= 0) this.resolveRevive('skip');
    }, 1000);
  }
  _restartReviveCountdown(m) {
    m.left = 5;
    const num = m.el.querySelector('#revNum');
    if (num) num.textContent = '5';
    const ring = m.el.querySelector('#revRing');
    if (!ring) return;
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
    void ring.getBoundingClientRect();
    requestAnimationFrame(() => { ring.style.transition = 'stroke-dashoffset 5s linear'; ring.style.strokeDashoffset = '327'; });
  }
  // App went to the background (hold) or came back (release): the countdown restarts from 5.
  holdRevive(hold) {
    this._reviveHeld = hold;
    const m = this.modals.find((x) => x.id === 'revive');
    if (!m) return;
    if (hold) {
      m.paused = true;
      const ring = m.el.querySelector('#revRing');
      if (ring) { ring.style.transition = 'none'; ring.style.strokeDashoffset = '0'; }
    } else if (m.paused && !m.shopDetour) {
      m.paused = false;
      this._restartReviveCountdown(m);
    }
  }
  // choice: 'battery' | 'gems' (revive) | 'again' (restart the run at once) | 'skip' (show results)
  resolveRevive(choice) {
    const m = this.modals.find((x) => x.id === 'revive');
    if (!m || m.resolved) return;
    if (choice === 'battery' && !PR.spend({ batteries: m.cost })) { this.notEnough('batteries'); return; }
    if (choice === 'gems' && !PR.spend({ gems: m.gemCost })) { this.notEnough('gems'); return; }
    m.resolved = true;
    clearInterval(this.reviveTimer);
    const cb = this.reviveChoice; this.reviveChoice = null;
    this.closeModal('revive');
    if (cb) cb(choice);
  }

  showResults(res) {
    const P = PR.profile();
    this.lastResult = res;
    const win = !!res.stageInfo;
    this.openModal('results', () => {
      const missions = P.missions.map((m) => {
        const d = PR.missionDef(m.id);
        const prog = PR.missionProgress(m, null);
        return `<div class="mini-mission ${m.done ? 'done' : ''}"><span>${t('m_' + d.stat, { n: fmt(d.n) })}</span><div class="bar"><i style="width:${Math.min(100, (prog / d.n) * 100)}%"></i></div></div>`;
      }).join('');
      const si = res.stageInfo;
      const stageBlock = si ? `
        <div class="stage-win"><h3>${icon('flag')} ${t('stageDone', { n: res.stage.n })}</h3>
          <div class="stars big">${[1, 2, 3].map((n) => `<span class="star ${n <= si.stars ? 'on' : ''}" style="animation-delay:${0.2 + n * 0.28}s">${icon(n <= si.stars ? 'stars' : 'starOff')}</span>`).join('')}</div>
          <div class="star-rules"><small class="${si.stars >= 1 ? 'ok' : ''}">${icon('check')}${t('star1')}</small><small class="${si.stars >= 2 ? 'ok' : ''}">${icon('check')}${t('star2', { n: res.stage.coinsStar })}</small><small class="${si.stars >= 3 ? 'ok' : ''}">${icon('check')}${t('star3')}</small></div>
          ${si.rewards.length ? `<div class="items">${si.rewards.map((it) => itemHTML(it, true)).join('')}</div>` : ''}
        </div>` : (res.stage ? `<p class="hint">${t('stageFailed', { n: res.stage.n })}</p>` : '');
      return `
        ${res.isBest ? `<div class="ribbon">${icon('trophy')}${t('newBest')}</div>` : ''}
        ${stageBlock}
        <div class="res-score"><small>${t('score')}</small><b>${fmt(res.score)}</b><small>${t('best')}: ${fmt(P.best)}</small></div>
        <div class="res-rows">
          <div><span>${t('distance')}</span><b>${fmt(res.dist)} ${t('m')}</b></div>
          <div><span>${icon('gold')}${t('goldCollected')}</span><b>${fmt(res.gold)}${res.doubled ? ' ×2' : ''}</b></div>
          ${res.gems ? `<div><span>${icon('gems')}${t('gems')}</span><b>+${res.gems}</b></div>` : ''}
          ${res.vaults ? `<div><span>${icon('vault_steel')}${t('vault')}</span><b>+${res.vaults}</b></div>` : ''}
          <div><span>${t('multiplier')}</span><b>x${PR.multiplier()}</b></div>
        </div>
        ${res.gold > 0 && !res.doubled ? `<button class="btn purple wide" data-a="results:double">${t('doubleIt', { n: '' })}${costHTML({ gems: res.doubleCost })}</button>` : ''}
        <div class="res-missions">${missions}</div>
        <button class="btn green wide huge run-again" data-a="results:again">${icon('retry')}<span>${win ? t('replayStage') : t('runAgain')}</span></button>
        <div class="btn-row">${win && res.stageInfo.next ? `<button class="btn gold" data-a="results:next">${t('nextStage')}</button>` : ''}<button class="btn blue" data-a="results:map">${icon('map')}${t('map')}</button><button class="btn grey" data-a="results:home">${t('home')}</button></div>`;
    }, { title: () => (win ? t('stageClear') : t('results')), size: 'tall', noClose: true });
  }

  // ---------------- actions ----------------
  async action(a, el) {
    const [cmd, arg, arg2] = a.split(':');
    const app = this.app;
    const P = PR.profile();
    switch (cmd) {
      case 'modal': { const w = el && el.closest('.modal-wrap'); this.closeModal(w ? w.dataset.id : undefined); break; }
      case 'confirm': { const m = this.modals.find((x) => x.id === 'confirm'); if (m && m.resolve) m.resolve(arg === 'yes'); break; }
      case 'play': app.startRun(); break;
      case 'open':
        if (arg === 'shop') this.openShop(arg2);
        else if (arg === 'daily') this.openDaily();
        else if (arg === 'missions') this.openMissions();
        else if (arg === 'wheel') this.openWheel();
        else if (arg === 'vaults') this.openVaults();
        else if (arg === 'settings') this.openSettings();
        else if (arg === 'upgrades') this.openUpgrades();
        else if (arg === 'map') this.openMap();
        break;
      case 'map':
        if (arg === 'world') { this.mapWorld = arg2; this._renderModal(this.modals.find((m) => m.id === 'map')); }
        else if (arg === 'locate') this.mapLocate();
        else if (arg === 'forget') { P.myPlace = null; PR.changed(); }
        else if (arg === 'free') { PR.setWorld(arg2); PR.selectStage(null); app.syncLobby(); this.closeModal('map'); }
        break;
      case 'stage': {
        const st = STAGES.find((x) => x.id === arg2);
        if (arg === 'play' && st && PR.stageUnlocked(st)) { this.closeModal('map'); app.startStage(st.id); }
        break;
      }
      case 'shoptab': this.shopTab = arg; this._renderModal(this.modals.find((m) => m.id === 'shop')); break;
      case 'gift': {
        if (!PR.giftReady()) { this.toast(t('giftIn', { t: fmtTime(P.giftNext - Date.now()) }), 'info'); break; }
        const items = PR.claimGift();
        if (items) this.popup(t('gift'), items);
        break;
      }
      case 'club': {
        const items = PR.claimClub();
        if (items) this.popup(t('clubClaim'), items); else this.toast(t('clubActive'), 'info');
        break;
      }
      case 'sheet':
        if (arg === 'close') this.closeSheet(); else this.openSheet(arg);
        break;
      case 'buildtab': this.buildTab = arg; this.renderSheet(); break;
      case 'luxbuy': {
        const w = P.world;
        const cost = PR.homeItemPrice(w, arg);
        if (PR.buyHomeItem(w, arg)) {
          Audio.play('build'); app.game.buildPulse(); app.syncLobby();
        } else this.notEnough(P.gold < (cost.gold || 0) ? 'gold' : 'gems');
        break;
      }
      case 'char':
        if (arg === 'view') { this.viewChar = arg2; this.viewSkin = PR.charOwned(arg2) ? P.skins[arg2] : charById(arg2).skins[0].id; this.renderSheet(); }
        else if (arg === 'select') {
          PR.equipSkin(this.viewChar, this.viewSkin);
          PR.selectChar(this.viewChar);
          app.game.celebrateLobby();
          Audio.play('buy');
        } else if (arg === 'unlock') {
          const ch = charById(this.viewChar);
          if (P.gems >= ch.unlock.gems && !(await this.confirm(t('costIs', { c: costHTML({ gems: ch.unlock.gems }) })))) break;
          if (PR.unlockCharWithGems(this.viewChar)) { Audio.play('fanfare'); this.viewSkin = charById(this.viewChar).skins[0].id; PR.selectChar(this.viewChar); app.game.celebrateLobby(); }
          else this.notEnough('gems');
        }
        break;
      case 'skin':
        if (arg === 'view') { this.viewSkin = arg2; if (PR.charOwned(this.viewChar) && PR.skinOwned(this.viewChar, arg2)) { PR.equipSkin(this.viewChar, arg2); } this.renderSheet(); }
        else if (arg === 'buy') {
          const s = charById(this.viewChar).skins.find((x) => x.id === this.viewSkin);
          const ok = await this.confirm(t('costIs', { c: costHTML(s.cost) }));
          if (!ok) break;
          if (PR.buySkin(this.viewChar, this.viewSkin)) { Audio.play('fanfare'); PR.selectChar(this.viewChar); app.game.celebrateLobby(); }
          else this.notEnough(s.cost.gems ? 'gems' : 'gold');
        }
        break;
      case 'build': {
        const w = P.world;
        const res = PR.buildNextStage(w);
        if (!res.ok) { this.notEnough(PR.nextStageCost(w) && P.gold < PR.nextStageCost(w).gold ? 'gold' : 'gems'); break; }
        Audio.play('build');
        app.game.buildPulse();
        app.syncLobby();
        if (res.completed) {
          Audio.play('fanfare');
          if (res.unlockedChar) { const uc = charById(res.unlockedChar); this.popup(t('newChar'), [], `<div class="unlock-big">${portrait(uc, uc.skins[0], 90)}<h3>${L(uc.name)}</h3></div>`); }
          if (res.unlockedWorld) this.popup(t('newWorld'), [], `<div class="unlock-big">${icon('map')}<h3>${L(worldById(res.unlockedWorld).name)}</h3></div>`);
          if (res.rewards) this.popup(t('complete'), res.rewards);
        }
        break;
      }
      case 'world': {
        const unlocked = WORLDS.filter((x) => PR.isWorldUnlocked(x.id));
        const i = unlocked.findIndex((x) => x.id === P.world);
        const n = unlocked[(i + (arg === 'next' ? 1 : -1) + unlocked.length) % unlocked.length];
        PR.setWorld(n.id);
        if (PR.currentStage() && PR.currentStage().world !== n.id) PR.selectStage(null);
        app.syncLobby();
        break;
      }
      case 'upgrade':
        if (PR.upgradePowerup(arg)) Audio.play('buy'); else this.notEnough('gold');
        break;
      case 'vault': {
        if (arg === 'wood') this.showVaultOpen(PR.openWoodVault());
        else if (arg === 'start') PR.startVaultUnlock(arg2);
        else if (arg === 'open') this.showVaultOpen(PR.openVault(arg2));
        else if (arg === 'instant') { const r = PR.openVault(arg2, true); if (r) this.showVaultOpen(r); else this.notEnough('batteries'); }
        else if (arg === 'buySteel') { if (PR.vaultSlotsFree() <= 0) this.toast(t('slotsFull'), 'warn'); else if (!PR.buySteelVault()) this.notEnough('gold'); else Audio.play('buy'); }
        else if (arg === 'diamond') { const r = PR.buyDiamondVault(arg2 === 'gems'); if (r) this.showVaultOpen(r); else this.notEnough(arg2 === 'gems' ? 'gems' : 'batteries'); }
        break;
      }
      case 'odds': if (arg === 'wheel') this.showWheelOdds(); else this.showOdds(arg); break;
      case 'spin': this.spin(arg === 'paid'); break;
      case 'daily': { const items = PR.claimDaily(); if (items) this.popup(t('dailyTitle'), items); break; }
      case 'mission': { const items = PR.claimMission(+arg); if (items) this.popup(t('missionDone'), items); break; }
      case 'buy': Billing.buy(arg); break;
      case 'gemoffer': {
        const o = GEM_OFFERS.find((x) => x.id === arg);
        if (o && PR.spend({ gems: o.gems })) { PR.grant([o.give]); Audio.play('buy'); this.toast(`+${fmt(o.give.n)}`, 'ok', { icon: o.give.k }); }
        else this.notEnough('gems');
        break;
      }
      case 'restore': Billing.restore(); break;
      case 'set': app.toggleSetting(arg); break;
      case 'lang': app.setLanguage(arg); break;
      case 'quality': app.setQuality(arg); break;
      case 'privacy': this.info(t('privacy'), `<p class="msg">${t('privacyText')}</p>`); break;
      case 'rate': app.rate(); break;
      case 'reset': if (await this.confirm(t('resetConfirm'))) app.resetProgress(); break;
      case 'pause': app.pause(); break;
      case 'resume': this.closeModal('pause'); app.resume(); break;
      case 'restart': this.closeModal('pause'); app.endRun(true); break;
      case 'home': this.closeModal('pause'); app.endRun(false); break;
      case 'revive':
        if (arg === 'shop') { const m = this.modals.find((x) => x.id === 'revive'); if (m) { m.paused = true; m.shopDetour = true; } this.openShop('gems'); const sm = this.modals.find((x) => x.id === 'shop'); if (sm) sm.opts.onClose = () => { this.closeModal('revive'); clearInterval(this.reviveTimer); const cb = this.reviveChoice; this.reviveChoice = null; this.openRevive(app.game.run.revives, app.game.run.crashCause, cb); }; }
        else this.resolveRevive(arg);
        break;
      case 'results':
        if (arg === 'double') {
          const r = this.lastResult;
          if (PR.spend({ gems: r.doubleCost })) { PR.grant([{ k: 'gold', n: r.gold }]); r.doubled = true; Audio.play('reward'); this._renderModal(this.modals.find((m) => m.id === 'results')); }
          else this.notEnough('gems');
        } else if (arg === 'home') { this.closeModal('results'); app.goLobby(); }
        else if (arg === 'map') { this.closeModal('results'); app.goLobby(); this.openMap(); }
        else if (arg === 'again') { this.closeModal('results'); app.startRun(); }
        else if (arg === 'next') { const nx = this.lastResult && this.lastResult.stageInfo && this.lastResult.stageInfo.next; this.closeModal('results'); if (nx) app.startStage(nx); else app.goLobby(); }
        break;
      case 'headstart': app.useHeadstart(); break;
      default: break;
    }
  }

  notEnough(kind) {
    Audio.play('error');
    this.toast(t('notEnough') + ' ' + t(kind), 'warn', { icon: kind });
  }

  // Android back button / Escape key. Returns true when handled.
  back() {
    if (this.modals.length) {
      const m = this.topModal();
      if (m.id === 'revive') { this.resolveRevive('skip'); return true; }
      if (m.id === 'results') { this.closeModal('results'); this.app.goLobby(); return true; }
      if (m.id === 'pause') { this.closeModal('pause'); this.app.resume(); return true; }
      if (m.busy) return true;
      this.closeModal();
      return true;
    }
    if (this.sheet) { this.closeSheet(); return true; }
    if (this.app.inRun()) { this.app.pause(); return true; }
    return false;
  }
}
