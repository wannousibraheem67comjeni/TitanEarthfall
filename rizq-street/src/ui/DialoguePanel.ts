/**
 * The conversation panel: who you are talking to, what they said, quick replies, and
 * the two ways to answer, typing or the microphone (tap once, or keep it open for a
 * hands-free conversation).
 */
import { h } from './dom';

export interface DialogueHandlers {
  send(text: string): void;
  close(): void;
  mic(): void;
  handsFree(on: boolean): void;
}

export class DialoguePanel {
  readonly el = h('div.dialogue');
  private readonly avatar = h('div.avatar');
  private readonly nameEl = h('b');
  private readonly titleEl = h('span');
  private readonly line = h('div.line');
  private readonly you = h('div.line.you');
  private readonly chips = h('div.chips');
  private readonly input = h('input.field', { type: 'text', id: 'say-input', placeholder: 'اكتب اللي تبي تقوله…', autocomplete: 'off', enterkeyhint: 'send' }) as HTMLInputElement;
  readonly micBtn = h('button.mic', { title: 'اضغط وتكلم (V)' }, '🎤');
  private readonly handsFreeBox = h('input', { type: 'checkbox', id: 'hands-free' }) as HTMLInputElement;
  private readonly src = h('span.badge-src');
  private readonly micNote = h('span');
  private typer = 0;

  constructor(
    parent: HTMLElement,
    private readonly handlers: DialogueHandlers,
  ) {
    const send = h('button.btn', { type: 'submit' }, 'قول');
    const form = h('form.say', this.micBtn, this.input, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = this.input.value.trim();
      if (!t) return;
      this.input.value = '';
      this.handlers.send(t);
    });
    this.micBtn.type = 'button';
    this.micBtn.onclick = () => this.handlers.mic();
    this.handsFreeBox.onchange = () => this.handlers.handsFree(this.handsFreeBox.checked);
    const close = h('button.x', { title: 'إنهاء المحادثة (Esc)', onclick: () => this.handlers.close() }, '✕');
    this.el.append(
      h('div.top', this.avatar, h('div.grow', h('div.who', this.nameEl, this.titleEl), this.line, this.you), close),
      this.chips,
      form,
      h('div.foot', h('label.toggle', { for: 'hands-free' }, this.handsFreeBox, 'محادثة صوتية مستمرة'), this.micNote, this.src),
    );
    this.el.hidden = true;
    parent.append(this.el);
  }

  open(name: string, title: string, color: string): void {
    this.el.hidden = false;
    this.avatar.textContent = name.replace(/^(ال|أبو |أم )/, '').slice(0, 1);
    this.avatar.style.background = color;
    this.nameEl.textContent = name;
    this.titleEl.textContent = title;
    this.you.textContent = '';
    this.line.textContent = '';
    this.input.value = '';
  }

  close(): void {
    this.el.hidden = true;
    clearInterval(this.typer);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Show the character's line with a quick typewriter effect. */
  say(text: string): void {
    clearInterval(this.typer);
    const words = text.split(' ');
    let i = 0;
    this.line.textContent = '';
    this.typer = window.setInterval(() => {
      i++;
      this.line.textContent = words.slice(0, i).join(' ');
      if (i >= words.length) clearInterval(this.typer);
    }, 45);
  }

  thinking(): void {
    clearInterval(this.typer);
    this.line.replaceChildren(h('span.dots', h('span'), h('span'), h('span')));
  }

  youSaid(text: string): void {
    this.you.textContent = text ? `أنت: ${text}` : '';
  }

  setSuggestions(list: string[]): void {
    this.chips.replaceChildren(...list.map((s) => h('button', { type: 'button', onclick: () => this.handlers.send(s) }, s)));
  }

  setListening(on: boolean, interim = ''): void {
    this.micBtn.classList.toggle('live', on);
    this.micBtn.textContent = on ? '⏺' : '🎤';
    this.input.placeholder = on ? (interim ? interim : 'أسمعك… تكلم') : 'اكتب اللي تبي تقوله…';
    if (on && interim) this.youSaid(interim);
  }

  setLevel(level: number): void {
    this.micBtn.classList.toggle('metered', level > 0);
    this.micBtn.style.setProperty('--lvl', level.toFixed(3));
  }

  setMicAvailable(ok: boolean, note = ''): void {
    this.micBtn.classList.toggle('off', !ok);
    this.micNote.textContent = note;
  }

  setHandsFree(on: boolean): void {
    this.handsFreeBox.checked = on;
  }

  setSource(text: string): void {
    this.src.textContent = text;
  }

  focusInput(): void {
    // On touch devices focusing would pop the keyboard over the scene; only on desktop.
    if (matchMedia('(pointer: fine)').matches) this.input.focus();
  }

  blurInput(): void {
    this.input.blur();
  }
}
