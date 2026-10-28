/**
 * «سند» on screen: a big microphone button and a text box to ask for anything
 * ("أبي شغل أونلاين يجيب 1000 درهم بالشهر"), a speech bubble with the answer and
 * suggestion chips, and the auto-walk chip with "take me there now" and stop.
 */
import { h } from './dom';

export interface GuideHooks {
  submit(text: string): void;
  mic(): void;
  warp(): void;
  stopWalk(): void;
}

export class GuidePanel {
  readonly el = h('div.guide');
  readonly micBtn = h('button.guide-mic', { type: 'button', title: 'اضغط وتكلم مع سند (V)' }, h('span.ico', '🎤'), h('span.lbl', 'تكلم')) as HTMLButtonElement;
  readonly kbBtn = h('button.guide-kb', { type: 'button', title: 'اكتب لسند (Enter)' }, '⌨️') as HTMLButtonElement;
  private readonly input = h('input.field', { type: 'text', id: 'guide-input', autocomplete: 'off', enterkeyhint: 'send', placeholder: 'قول أو اكتب شو تبي… مثلاً: أبي شغل أونلاين يجيب 1000 درهم بالشهر' }) as HTMLInputElement;
  private readonly bar = h('form.guide-bar');
  private readonly bubble = h('div.guide-bubble');
  private readonly text = h('div.guide-text');
  private readonly you = h('div.guide-you');
  private readonly chips = h('div.guide-chips');
  private readonly walk = h('div.guide-walk');
  private readonly walkText = h('span.grow');
  private hideTimer = 0;
  private hovering = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: GuideHooks,
    private readonly touch: boolean,
  ) {
    const close = h('button.x', { type: 'button', title: 'إخفاء', onclick: () => this.hideBubble() }, '✕');
    this.bubble.append(h('div.guide-head', h('span.guide-avatar', 'س'), h('b', 'سند'), h('span.muted', 'مساعدك بالفريج'), close), this.you, this.text, this.chips);
    this.bubble.hidden = true;
    this.bubble.addEventListener('pointerenter', () => (this.hovering = true));
    this.bubble.addEventListener('pointerleave', () => {
      this.hovering = false;
      this.scheduleHide();
    });
    this.walk.append(h('span', '🚶'), this.walkText, h('button.btn.warm', { type: 'button', id: 'guide-warp', onclick: () => hooks.warp() }, '⏩ وصّلني الحين'), h('button.btn.secondary', { type: 'button', title: 'وقف المشي', onclick: () => hooks.stopWalk() }, '✕'));
    this.walk.hidden = true;
    const send = h('button.guide-send', { type: 'submit', title: 'أرسل' }, '➤');
    this.bar.append(this.input, send);
    if (!touch) this.bar.prepend(this.micBtn);
    this.bar.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = this.input.value.trim();
      if (!t) return;
      this.input.value = '';
      if (this.touch) this.closeTyping();
      hooks.submit(t);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.input.blur();
        this.closeTyping();
      }
    });
    this.micBtn.addEventListener('click', () => hooks.mic());
    this.kbBtn.addEventListener('click', () => this.focusInput());
    this.el.append(this.bubble, this.walk, this.bar);
    this.el.classList.toggle('touch', touch);
    parent.append(this.el);
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on;
    this.micBtn.hidden = this.kbBtn.hidden = !on;
  }

  /** The HUD's "press E" prompt sits in the dock on desktop so nothing overlaps. */
  dock(el: HTMLElement): void {
    this.el.insertBefore(el, this.bar);
  }

  setListening(on: boolean, interim = ''): void {
    this.micBtn.classList.toggle('live', on);
    this.micBtn.querySelector('.lbl')!.textContent = on ? 'أسمعك…' : 'تكلم';
    if (on) {
      this.showBubble();
      this.you.textContent = interim ? `«${interim}»` : '';
      this.text.textContent = 'تكلم الحين… قول شو تبي، وأنا أسمعك 👂';
      this.chips.replaceChildren();
    }
  }

  youSaid(text: string): void {
    this.showBubble();
    this.you.textContent = `أنت: «${text}»`;
    this.text.textContent = '…';
    this.text.classList.add('thinking');
    this.chips.replaceChildren();
  }

  say(text: string, suggestions: string[] = [], keepYou = true): void {
    this.showBubble();
    if (!keepYou) this.you.textContent = '';
    this.text.classList.remove('thinking');
    this.text.textContent = text;
    this.chips.replaceChildren(...suggestions.slice(0, 4).map((s) => h('button', { type: 'button', onclick: () => this.hooks.submit(s) }, s)));
    this.scheduleHide(Math.min(20000, Math.max(8000, text.length * 85)));
  }

  /** A hint that needs the text box (no mic here): open it and explain. */
  focusInput(hint?: string): void {
    if (this.touch) this.el.classList.add('typing');
    if (hint) this.say(hint, [], false);
    this.input.focus();
  }

  blurInput(): void {
    this.input.blur();
    this.closeTyping();
  }

  get inputFocused(): boolean {
    return document.activeElement === this.input;
  }

  setInterim(text: string): void {
    this.input.value = text;
  }

  setWalk(label: string | null): void {
    this.walk.hidden = !label;
    if (label) this.walkText.textContent = label;
  }

  hideBubble(): void {
    this.bubble.hidden = true;
    clearTimeout(this.hideTimer);
  }

  private closeTyping(): void {
    this.el.classList.remove('typing');
  }

  private showBubble(): void {
    this.bubble.hidden = false;
    clearTimeout(this.hideTimer);
  }

  private scheduleHide(ms = 9000): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.hovering || this.inputFocused) this.scheduleHide(4000);
      else this.bubble.hidden = true;
    }, ms);
  }
}
