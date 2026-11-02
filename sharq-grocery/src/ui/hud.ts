/**
 * What stays on screen: the shop's stage and stars, the savings, the wealth and its
 * title, the till drawer; the big pink savings button at the bottom; subtitles of what
 * is being said; short notes; money floating up from the desk.
 */
import { fmt, LADDER, STAGES } from '../game/economy';
import type { Store } from '../game/state';
import { h } from './dom';

export class Hud {
  readonly el = h('div.hud');
  private readonly stageEl = h('span.name');
  private readonly starsEl = h('span.stars');
  private readonly savedEl = h('b');
  private readonly worthEl = h('b');
  private readonly titleEl = h('span.title');
  private readonly ladderFill = h('i');
  private readonly drawerEl = h('b');
  readonly saveBtn = h('button.pink', { type: 'button' }) as HTMLButtonElement;
  private readonly saveLabel = h('span.big');
  private readonly saveSub = h('span.sub');
  private readonly saveFill = h('i');
  readonly dock = h('div.dock');
  private readonly toasts = h('div.toasts');
  private readonly sub = h('div.subtitle');
  private readonly subWho = h('b');
  private readonly subSaid = h('span.said');
  private readonly subRest = h('span.rest');
  readonly soundBtn = h('button.round', { type: 'button', title: 'الصوت' }, '🔊') as HTMLButtonElement;
  readonly pricesBtn = h('button.round', { type: 'button', title: 'قائمة الأسعار' }, '📋') as HTMLButtonElement;
  /** Tap the subtitle to skip to the end of what is being said. */
  onSkip: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly store: Store,
  ) {
    const top = h(
      'div.topbar',
      h('div.chip.stage', h('span.ico', '🏪'), h('div', this.stageEl, this.starsEl)),
      h('div.chip.worth', h('div.row1', h('span', 'ثروتك '), this.worthEl), this.titleEl, h('span.ladder', this.ladderFill)),
      h('div.chip.saved', h('span', '💗 الادخار'), this.savedEl),
      h('div.chip.drawer', h('span', 'الدرج'), this.drawerEl),
    );
    this.saveBtn.append(this.saveLabel, this.saveSub, h('span.bar', this.saveFill));
    this.sub.append(this.subWho, h('p', this.subSaid, this.subRest));
    this.sub.hidden = true;
    this.sub.onclick = () => this.onSkip?.();
    this.dock.append(this.saveBtn);
    this.el.append(top, h('div.tools', this.soundBtn, this.pricesBtn), this.toasts, this.sub, this.dock);
    parent.append(this.el);
    store.on('money', () => this.refresh());
    store.on('rep', () => this.refresh());
    store.on('stage', () => this.refresh());
    this.refresh();
  }

  refresh(): void {
    const s = this.store.s;
    const st = STAGES[s.stage];
    this.stageEl.textContent = st.name;
    this.stageEl.title = `${s.stage + 1}/${STAGES.length}`;
    const full = Math.floor(s.rep);
    const half = s.rep - full >= 0.5;
    this.starsEl.textContent = '★'.repeat(full) + (half ? '⯪' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
    this.worthEl.textContent = fmt(Math.floor(this.store.worth));
    this.titleEl.textContent = this.store.title;
    const r = this.store.rank;
    const next = LADDER[r + 1];
    this.ladderFill.style.width = next ? `${Math.min(100, ((this.store.worth - LADDER[r].at) / (next.at - LADDER[r].at)) * 100)}%` : '100%';
    this.drawerEl.textContent = fmt(Math.floor(s.drawer * 10) / 10);
    this.savedEl.textContent = fmt(Math.floor(s.savings));
    // The pink button always saves; the bar shows how close the next stage is.
    const cost = this.store.nextCost;
    this.saveBtn.classList.toggle('ready', s.drawer >= 1);
    this.saveLabel.textContent = '💗 ادخار';
    if (cost === null) {
      this.saveSub.textContent = s.drawer >= 1 ? `اضغط وادّخر ${fmt(Math.floor(s.drawer))}` : `بالادخار ${fmt(Math.floor(s.savings))}`;
      this.saveFill.style.width = '100%';
    } else {
      const next = STAGES[s.stage + 1].name;
      this.saveSub.textContent = s.drawer >= 1 ? `اضغط وادّخر ${fmt(Math.floor(s.drawer))} · ${next} بـ${fmt(cost)}` : `${fmt(Math.floor(s.savings))} من ${fmt(cost)} · ${next}`;
      this.saveFill.style.width = `${Math.min(100, (s.savings / cost) * 100)}%`;
    }
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' | 'big' = 'info'): void {
    const t = h(`div.toast.${kind}`, text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 3) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), kind === 'big' ? 4200 : 3200);
    setTimeout(() => t.remove(), kind === 'big' ? 4700 : 3700);
  }

  /** "+3.5" floating up from a point on screen. */
  pop(x: number, y: number, amount: number): void {
    const el = h(`div.pop${amount < 0 ? '.neg' : ''}`, { style: { left: `${x}px`, top: `${y}px` } }, `${amount >= 0 ? '+' : '−'}${fmt(Math.abs(amount))}`);
    this.el.append(el);
    setTimeout(() => el.remove(), 1500);
  }

  /** Subtitles: who is speaking, the words said so far brighter than the rest. */
  subtitle(who: string | null, text = '', said = text.length, me = false): void {
    this.sub.hidden = !who;
    if (!who) return;
    this.sub.classList.toggle('me', me);
    this.subWho.textContent = who;
    // Break at a word boundary so the highlight moves word by word.
    let cut = Math.min(text.length, said);
    while (cut < text.length && text[cut] !== ' ' && text[cut] !== '،' && text[cut] !== '.') cut++;
    this.subSaid.textContent = text.slice(0, cut);
    this.subRest.textContent = text.slice(cut);
  }

  nudge(): void {
    this.saveBtn.classList.remove('shake');
    void this.saveBtn.offsetWidth;
    this.saveBtn.classList.add('shake');
  }
}
