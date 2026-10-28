/**
 * The always-on interface: wallet (with the notes it holds), clock and reputation,
 * minimap, current objective, interaction prompt, stamina, toasts, floating money,
 * name tags over people, and the arrow that points to the next destination.
 */
import { breakdown, denomination } from '../game/catalog';
import type { Store } from '../game/state';
import { formatNumber } from '../lang/arabic';
import { formatClock } from '../dialogue/brain';
import { ALLEY, ALLEY_HOUSES, CARWASH, MOSQUE, PARK, PLACES, SHOP_LOTS, VILLA_LOTS } from '../world/layout';
import { h } from './dom';

const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export interface LabelInfo {
  key: string;
  x: number;
  y: number;
  name: string;
  sub: string;
  job: 'open' | 'closed' | null;
  scale: number;
}

export interface MapMarker {
  x: number;
  z: number;
  icon: string;
}

export class Hud {
  readonly el = h('div.hud');
  private readonly walletEl = h('div.chip.wallet');
  private readonly amountEl = h('span.num');
  private readonly notesEl = h('div.notes-row');
  private readonly bankEl = h('span.num');
  private readonly timeEl = h('span.time');
  private readonly dayEl = h('span');
  private readonly repFill = h('i');
  private readonly objective = h('div.chip.objective');
  private readonly objText = h('span');
  private readonly objTimer = h('span.timer');
  private readonly objCancel = h('button.cancel', 'إلغاء');
  readonly prompt = h('button.chip.prompt');
  private readonly promptKey = h('span.key', 'E');
  private readonly promptText = h('span');
  private readonly promptBar = h('span.progress', h('i'));
  private readonly staminaEl = h('div.chip.stamina');
  private readonly staminaFill = h('i');
  private readonly rideEl = h('span');
  private readonly toasts = h('div.toasts');
  readonly map = h('canvas.minimap') as HTMLCanvasElement;
  readonly labels = h('div.labels');
  private readonly labelPool = new Map<string, HTMLDivElement>();
  readonly arrow = h('div.nav-arrow');
  private readonly arrowDist = h('span.dist');
  readonly phoneBtn = h('button', { title: 'الجوال (Tab)' }, '📱', h('small', 'Tab'));
  readonly talkBtn = h('button', { title: 'كلم أقرب شخص (T)' }, '💬', h('small', 'T'));
  readonly mapBtn = h('button', { title: 'الخريطة (M)' }, '🗺️', h('small', 'M'));
  readonly phoneBadge = h('span.badge');
  private bigMap = false;
  private shownWallet = -1;
  onPrompt: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  /** Clicking the big map at a street position (x, z); true when handled. */
  onMapPick: ((x: number, z: number) => boolean) | null = null;
  private readonly goalEl = h('div.goal');
  private readonly goalText = h('span');
  private readonly goalFill = h('i');

  constructor(
    parent: HTMLElement,
    private readonly store: Store,
  ) {
    this.goalEl.append(this.goalText, h('span.bar', this.goalFill));
    this.goalEl.hidden = true;
    this.walletEl.append(h('span.label', 'محفظتي'), h('div.amount', this.amountEl, h('small', 'درهم')), this.notesEl, h('div.bank', h('span', 'في البنك'), this.bankEl), this.goalEl);
    const clock = h('div.chip.clock', this.dayEl, this.timeEl, h('span.rep', 'السمعة', h('span.bar', this.repFill)));
    this.objective.append(this.objText, this.objTimer, this.objCancel);
    this.objective.hidden = true;
    this.objCancel.onclick = () => this.onCancel?.();
    this.prompt.append(this.promptKey, this.promptText, this.promptBar);
    this.prompt.hidden = true;
    this.prompt.onclick = () => this.onPrompt?.();
    this.staminaEl.append(h('span', 'النَّفَس'), h('span.bar', this.staminaFill), this.rideEl);
    this.phoneBtn.append(this.phoneBadge);
    this.phoneBadge.hidden = true;
    const toolbar = h('div.toolbar', this.talkBtn, this.mapBtn, this.phoneBtn);
    this.arrow.innerHTML = '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="rgba(28,20,12,0.75)"/><path d="M22 8 L32 28 L22 23 L12 28 Z" fill="#ffd66b"/></svg>';
    this.arrow.append(this.arrowDist);
    this.arrow.hidden = true;
    this.map.width = 336;
    this.map.height = 336;
    this.map.onclick = (e) => {
      if (this.bigMap && this.onMapPick) {
        const r = this.map.getBoundingClientRect();
        const W = this.map.width;
        const scale = W / 250;
        const x = -5 + (((e.clientX - r.left) / r.width) * W - W / 2) / scale;
        const z = 30 + (((e.clientY - r.top) / r.height) * W - W / 2) / scale;
        if (this.onMapPick(x, z)) return this.toggleMap(false);
      }
      this.toggleMap();
    };
    this.mapBtn.onclick = () => this.toggleMap();
    this.el.append(this.labels, this.walletEl, clock, this.map, this.objective, this.prompt, this.staminaEl, toolbar, this.toasts, this.arrow);
    parent.append(this.el);
    store.on('money', () => this.refreshMoney(true));
    store.on('toast', (t) => this.toast(t.text, t.kind));
    store.on('reputation', () => this.refreshClock());
    this.refreshMoney(false);
  }

  toggleMap(force?: boolean): void {
    this.bigMap = force ?? !this.bigMap;
    this.map.classList.toggle('big', this.bigMap);
    this.map.width = this.map.height = this.bigMap ? 900 : 336;
  }

  get mapOpen(): boolean {
    return this.bigMap;
  }

  /** The savings goal under the wallet: earned so far, target, days left. */
  refreshGoal(): void {
    const g = this.store.goalProgress();
    this.goalEl.hidden = !g;
    if (!g) return;
    this.goalText.textContent = `🎯 ${formatNumber(g.got)} / ${formatNumber(g.amount)} · باقي ${formatNumber(g.daysLeft)} يوم`;
    this.goalFill.style.width = `${Math.min(100, (g.got / g.amount) * 100)}%`;
  }

  refreshMoney(animate: boolean): void {
    this.refreshGoal();
    const s = this.store.s;
    if (s.wallet === this.shownWallet) {
      this.bankEl.textContent = formatNumber(s.bank);
      return;
    }
    this.shownWallet = s.wallet;
    this.amountEl.textContent = formatNumber(s.wallet);
    this.bankEl.textContent = formatNumber(s.bank);
    this.notesEl.replaceChildren(
      ...breakdown(s.wallet)
        .flatMap(({ value, count }) => Array.from({ length: Math.min(count, value === 1 ? 4 : 5) }, () => value))
        .slice(0, 14)
        .map((v) => {
          const d = denomination(v);
          return h(`span.mini-note${v === 1 ? '.coin' : ''}`, { style: { background: d.color } }, v === 1 ? '' : String(v));
        }),
    );
    if (animate) {
      this.walletEl.classList.remove('bump');
      void this.walletEl.offsetWidth;
      this.walletEl.classList.add('bump');
    }
  }

  refreshClock(): void {
    const s = this.store.s;
    this.dayEl.textContent = `${DAY_NAMES[(s.day - 1) % 7]} · اليوم ${s.day}`;
    this.timeEl.textContent = formatClock(s.minute);
    this.repFill.style.width = `${s.reputation}%`;
  }

  setObjective(text: string | null, timer: number | null = null, cancelable = false): void {
    this.objective.hidden = !text;
    if (!text) return;
    if (this.objText.textContent !== text) this.objText.textContent = text;
    this.objTimer.hidden = timer === null;
    if (timer !== null) {
      this.objTimer.textContent = `${Math.max(0, Math.ceil(timer))}ث`;
      this.objTimer.classList.toggle('low', timer < 10);
    }
    this.objCancel.hidden = !cancelable;
  }

  setPrompt(text: string | null, key = 'E', progress: number | null = null): void {
    this.prompt.hidden = !text;
    if (!text) return;
    this.promptKey.textContent = key;
    if (this.promptText.textContent !== text) this.promptText.textContent = text;
    this.promptBar.hidden = progress === null;
    if (progress !== null) (this.promptBar.firstChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  setStamina(fraction: number, ride: string): void {
    this.staminaFill.style.width = `${Math.round(fraction * 100)}%`;
    this.rideEl.textContent = ride === 'bike' ? '🚲' : ride === 'scooter' ? '🛴' : '';
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'level' | 'achievement' = 'info'): void {
    const t = h(`div.chip.toast.${kind}`, text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 450);
    }, kind === 'achievement' || kind === 'level' ? 5200 : 3800);
  }

  moneyPop(x: number, y: number, amount: number): void {
    const el = h(`div.money-pop${amount < 0 ? '.minus' : ''}`, `${amount > 0 ? '+' : '−'}${formatNumber(Math.abs(amount))} درهم`);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.el.append(el);
    setTimeout(() => el.remove(), 1500);
  }

  /** Point the edge arrow; `angle` is screen-space radians, null hides it. */
  setArrow(x: number, y: number, angle: number | null, dist: number): void {
    this.arrow.hidden = angle === null;
    if (angle === null) return;
    this.arrow.style.left = `${x}px`;
    this.arrow.style.top = `${y}px`;
    (this.arrow.firstChild as SVGElement).style.transform = `rotate(${angle}rad)`;
    this.arrowDist.textContent = `${Math.round(dist)} م`;
  }

  setLabels(list: LabelInfo[]): void {
    const seen = new Set<string>();
    for (const l of list) {
      seen.add(l.key);
      let el = this.labelPool.get(l.key);
      if (!el) {
        el = h('div.name-tag');
        this.labelPool.set(l.key, el);
        this.labels.append(el);
      }
      const html = `<b>${l.name}</b>${l.sub ? `<span>${l.sub}</span>` : ''}${l.job ? `<br><span class="job ${l.job === 'closed' ? 'closed' : ''}">${l.job === 'open' ? '💼 عنده شغل' : '🕒 مسكّر'}</span>` : ''}`;
      if (el.dataset.html !== html) {
        el.innerHTML = html;
        el.dataset.html = html;
      }
      el.style.left = `${l.x}px`;
      el.style.top = `${l.y}px`;
      el.style.transform = `translate(-50%, -100%) scale(${l.scale.toFixed(2)})`;
      el.hidden = false;
    }
    for (const [k, el] of this.labelPool) if (!seen.has(k)) el.hidden = true;
  }

  setBadge(n: number): void {
    this.phoneBadge.hidden = n <= 0;
    this.phoneBadge.textContent = String(n);
  }

  /** Draw the minimap (north up) centred on the player, or the whole street when big. */
  drawMap(px: number, pz: number, heading: number, markers: MapMarker[]): void {
    const c = this.map;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const big = this.bigMap;
    const scale = big ? W / 250 : W / 150;
    const cx = big ? -5 : px;
    const cz = big ? 30 : pz;
    const tx = (x: number) => W / 2 + (x - cx) * scale;
    const tz = (z: number) => W / 2 + (z - cz) * scale;
    ctx.save();
    ctx.fillStyle = '#d9c59c';
    ctx.fillRect(0, 0, W, W);
    const rect = (x0: number, z0: number, x1: number, z1: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(tx(x0), tz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
    };
    rect(-200, -10, 200, 10, '#c9bfae');
    rect(-200, -6, 200, 6, '#5b5d61');
    rect(ALLEY.minX, 10, ALLEY.maxX, ALLEY.maxZ, '#6a6c70');
    rect(PARK.minX, PARK.minZ, PARK.maxX, PARK.maxZ, '#8fb26a');
    rect(CARWASH.minX, CARWASH.minZ, CARWASH.maxX, -10, '#b9b4ab');
    rect(MOSQUE.minX, MOSQUE.minZ, MOSQUE.maxX, -10, '#efe7d6');
    for (const l of SHOP_LOTS) rect(l.minX, l.minZ, l.maxX, l.maxZ, l.signColor);
    for (const v of VILLA_LOTS) {
      rect(v.minX, v.minZ, v.maxX, v.maxZ, v.open ? '#f4e9cf' : '#e6d6b4');
      rect(v.minX + 3, v.minZ + 14, v.maxX - 3, v.maxZ - 2, '#cdb78f');
    }
    for (const a of ALLEY_HOUSES) rect(a.minX, a.minZ, a.maxX, a.maxZ, '#e6d6b4');
    ctx.font = `${big ? 30 : 22}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of PLACES) {
      if (p.id === 'alley' || p.id === 'busstop') continue;
      ctx.fillText(p.icon, tx(p.x), tz(p.z + (p.z < 0 ? -4 : 4)));
    }
    if (big) {
      ctx.font = `600 18px 'Readex Pro', sans-serif`;
      ctx.fillStyle = '#2a1e14';
      ctx.direction = 'rtl';
      for (const p of PLACES) {
        if (p.id === 'busstop' || p.id === 'stall') continue;
        ctx.fillText(p.name, tx(p.x), tz(p.z + (p.z < 0 ? -9 : 9)));
      }
    }
    for (const m of markers) {
      const x = Math.max(14, Math.min(W - 14, tx(m.x)));
      const y = Math.max(14, Math.min(W - 14, tz(m.z)));
      ctx.fillStyle = '#ffd34d';
      ctx.strokeStyle = '#6b4a12';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, big ? 14 : 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillText(m.icon, x, y + 1);
    }
    // Player arrow.
    ctx.translate(tx(px), tz(pz));
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = '#c23b2e';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const s = big ? 16 : 13;
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, s * 0.8);
    ctx.lineTo(0, s * 0.4);
    ctx.lineTo(-s * 0.7, s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
