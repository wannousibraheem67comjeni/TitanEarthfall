/**
 * What stays on screen: the stage and stars, the wealth and its title, the till
 * drawer, the big pink savings button with the jar's progress toward the next stage,
 * toasts, money popping up over the counter, and what the customer at the till says.
 */
import { fmt, LADDER, SAVINGS_RATE, STAGES } from '../game/economy';
import type { Store } from '../game/state';
import { h } from './dom';

export class Hud {
  readonly el = h('div.hud');
  private readonly stageEl = h('span');
  private readonly starsEl = h('span.stars');
  private readonly worthEl = h('b');
  private readonly titleEl = h('span.title');
  private readonly ladderFill = h('i');
  private readonly drawerEl = h('b');
  readonly saveBtn = h('button.pink', { type: 'button' }) as HTMLButtonElement;
  private readonly saveLabel = h('span.big');
  private readonly saveSub = h('span.sub');
  private readonly saveFill = h('i');
  private readonly jarNote = h('div.jar-note');
  private readonly toasts = h('div.toasts');
  readonly bubble = h('div.say');
  readonly soundBtn = h('button.round', { type: 'button', title: 'الصوت' }, '🔊') as HTMLButtonElement;
  readonly pricesBtn = h('button.round', { type: 'button', title: 'قائمة الأسعار' }, '📋') as HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly store: Store,
  ) {
    const top = h(
      'div.topbar',
      h('div.chip.stage', h('span.shopico', '🏪'), h('div', this.stageEl, this.starsEl)),
      h('div.chip.worth', h('div.row1', h('span', '💰 ثروتك '), this.worthEl), this.titleEl, h('span.ladder', this.ladderFill)),
      h('div.chip.drawer', h('span', '🗃️ الدرج'), this.drawerEl),
    );
    this.saveBtn.append(this.saveLabel, this.saveSub, h('span.bar', this.saveFill));
    const tools = h('div.tools', this.soundBtn, this.pricesBtn);
    this.bubble.hidden = true;
    this.el.append(top, tools, this.toasts, this.bubble, h('div.dock', this.saveBtn, this.jarNote));
    parent.append(this.el);
    store.on('money', () => this.refresh());
    store.on('rep', () => this.refresh());
    store.on('stage', () => this.refresh());
    this.refresh();
  }

  refresh(): void {
    const s = this.store.s;
    const st = STAGES[s.stage];
    this.stageEl.textContent = `${st.name} · ${s.stage + 1}/${STAGES.length}`;
    const full = Math.floor(s.rep);
    const half = s.rep - full >= 0.5;
    this.starsEl.textContent = '★'.repeat(full) + (half ? '⯪' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
    this.worthEl.textContent = fmt(Math.floor(this.store.worth));
    this.titleEl.textContent = this.store.title;
    const r = this.store.rank;
    const next = LADDER[r + 1];
    this.ladderFill.style.width = next ? `${Math.min(100, ((this.store.worth - LADDER[r].at) / (next.at - LADDER[r].at)) * 100)}%` : '100%';
    this.drawerEl.textContent = fmt(Math.floor(s.drawer * 10) / 10);
    const cost = this.store.nextCost;
    const can = this.store.canUpgrade;
    this.saveBtn.classList.toggle('ready', can);
    this.saveLabel.textContent = can ? '🎉 طوّر البقالة' : '💗 ادخار';
    if (cost === null) {
      this.saveSub.textContent = `بالادخار: ${fmt(Math.floor(s.savings))}`;
      this.saveFill.style.width = '100%';
    } else {
      const have = s.savings + (can ? s.drawer : 0);
      this.saveSub.textContent = can ? `${STAGES[s.stage + 1].name} بـ${fmt(cost)}` : `بالادخار ${fmt(Math.floor(s.savings))} من ${fmt(cost)}`;
      this.saveFill.style.width = `${Math.min(100, (have / cost) * 100)}%`;
    }
    this.jarNote.textContent = s.savings > 0 ? `الادخار يكبر ${Math.round(SAVINGS_RATE * 100)}٪ كل دقيقة` : 'اجمع من الزباين، واضغط الزر الوردي عشان تدّخر';
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' | 'big' = 'info'): void {
    const t = h(`div.toast.${kind}`, text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), kind === 'big' ? 4200 : 3000);
    setTimeout(() => t.remove(), kind === 'big' ? 4700 : 3500);
  }

  /** "+3.5" floating up from a point on screen. */
  pop(x: number, y: number, amount: number): void {
    const el = h(`div.pop${amount < 0 ? '.neg' : ''}`, { style: { left: `${x}px`, top: `${y}px` } }, `${amount >= 0 ? '+' : '−'}${fmt(Math.abs(amount))}`);
    this.el.append(el);
    setTimeout(() => el.remove(), 1400);
  }

  /** The customer's words over their head (screen position), or hide. */
  say(text: string | null, x = 0, y = 0): void {
    this.bubble.hidden = !text;
    if (!text) return;
    if (this.bubble.textContent !== text) this.bubble.textContent = text;
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
  }

  nudge(): void {
    this.saveBtn.classList.remove('shake');
    void this.saveBtn.offsetWidth;
    this.saveBtn.classList.add('shake');
  }
}
