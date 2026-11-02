/**
 * «سند» on screen: one big microphone button to ask for anything ("أبي شغل أونلاين
 * يجيب 1000 درهم بالشهر"), a speech bubble with the answer and suggestion chips, and
 * the auto-walk chip with "take me there now" and stop. The text box only appears when
 * there is no microphone (or on Enter), so the screen keeps a single button.
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
  /** No microphone here: the one button opens the text box, and the box stays on screen. */
  private typingFirst = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: GuideHooks,
    touch: boolean,
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
    this.bar.append(this.input, send, h('button.x', { type: 'button', title: 'إغلاق', onclick: () => this.blurInput(true) }, '✕'));
    this.bar.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = this.input.value.trim();
      if (!t) return;
      this.input.value = '';
      // Leave the box (so the arrow keys walk again); in typing-first mode it stays visible.
      this.blurInput();
      hooks.submit(t);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.blurInput(true);
    });
    this.micBtn.addEventListener('click', () => hooks.mic());
    this.el.append(this.bubble, this.walk, this.bar);
    if (!touch) this.el.append(h('div.guide-dock', this.micBtn));
    this.el.classList.toggle('touch', touch);
    parent.append(this.el);
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on;
    this.micBtn.hidden = !on;
  }

  /** The HUD's "press E" prompt sits above the mic on desktop so nothing overlaps. */
  dock(el: HTMLElement): void {
    this.el.insertBefore(el, this.bar);
  }

  /** Live microphone level (0–1): the ring around the button grows with the voice. */
  setLevel(level: number): void {
    this.micBtn.classList.toggle('metered', level > 0);
    this.micBtn.style.setProperty('--lvl', level.toFixed(3));
  }

  /** Draw the eye to the mic after the guide asks a question. */
  invite(on: boolean): void {
    this.micBtn.classList.toggle('invite', on);
  }

  setListening(on: boolean, interim = ''): void {
    this.micBtn.classList.toggle('live', on);
    if (!on) this.setLevel(0);
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
    this.el.classList.add('typing');
    if (hint) this.say(hint, [], false);
    this.input.focus();
  }

  blurInput(close = false): void {
    this.input.blur();
    if (close || !this.typingFirst || this.el.classList.contains('touch')) this.closeTyping();
  }

  /** Typing instead of the mic (claude.ai blocks it): the button reads «اكتب». */
  setTypingFirst(on: boolean): void {
    this.typingFirst = on;
    this.micBtn.querySelector('.ico')!.textContent = on ? '⌨️' : '🎤';
    this.micBtn.querySelector('.lbl')!.textContent = on ? 'اكتب' : 'تكلم';
    this.micBtn.title = on ? 'اكتب لسند (Enter)، أو استخدم مايك الكيبورد' : 'اضغط وتكلم مع سند (V)';
    this.input.placeholder = on ? 'اكتب هنا وش تبي… أو اضغط مايك الكيبورد 🎤' : 'قول أو اكتب شو تبي… مثلاً: أبي شغل أونلاين يجيب 1000 درهم بالشهر';
    if (on && !this.el.classList.contains('touch')) this.el.classList.add('typing');
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
