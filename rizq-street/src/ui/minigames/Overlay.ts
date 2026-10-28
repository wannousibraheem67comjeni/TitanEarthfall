/** Shared frame for work screens, shops and the ATM: a paper card over the street. */
import type { Sfx } from '../../audio/sfx';
import type { Rng } from '../../core/rng';
import type { Store } from '../../game/state';
import { h } from '../dom';

export interface MiniEnv {
  store: Store;
  rng: Rng;
  sfx: Sfx;
  /** Listen for one spoken answer; rejects when the mic is unavailable. */
  listen(onInterim: (t: string) => void): Promise<string>;
  micAvailable(): boolean;
  /** A customer or employer says a line out loud. */
  speak(text: string, gender: 'm' | 'f', key: string, pitch?: number): void;
  /** Pay the player: credits the wallet (or bank) and shows the notes. */
  pay(amount: number, label: string, opts?: { bank?: boolean }): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
}

export class Overlay {
  readonly root = h('div.overlay');
  readonly card = h('div.card');
  readonly title = h('h2');
  readonly who = h('div.who');
  readonly stat = h('div.stat');
  readonly body = h('div.card-body');
  private closed = false;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement, title: string, who = '', opts: { closable?: boolean; wide?: boolean } = {}) {
    this.title.textContent = title;
    this.who.textContent = who;
    const head = h('div.card-head', h('div.grow', this.title, this.who), this.stat);
    if (opts.closable !== false) head.append(h('button.x', { title: 'إغلاق (Esc)', onclick: () => this.close() }, '✕'));
    this.card.append(head, this.body);
    if (opts.wide) this.card.style.width = 'min(860px, 100%)';
    this.root.append(this.card);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root && opts.closable !== false) this.close();
    });
    parent.append(this.root);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.root.remove();
    this.onClose?.();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/** A mic button that fills an answer box by voice, used by every work screen. */
export function voiceButton(env: MiniEnv, onText: (text: string) => void, onInterim?: (t: string) => void): HTMLButtonElement {
  const btn = h('button.mic', { type: 'button', title: 'جاوب بصوتك' }, '🎤') as HTMLButtonElement;
  if (!env.micAvailable()) btn.classList.add('off');
  let live = false;
  btn.onclick = async () => {
    if (live) return;
    live = true;
    btn.classList.add('live');
    env.sfx.micOn();
    try {
      const t = await env.listen((i) => onInterim?.(i));
      if (t) onText(t);
    } catch (e) {
      env.toast(typeof e === 'string' ? micError(e) : 'ما قدرت أسمعك، اكتب جوابك.', 'bad');
    } finally {
      live = false;
      btn.classList.remove('live');
      env.sfx.micOff();
    }
  };
  return btn;
}

function micError(code: string): string {
  return code === 'denied' ? 'المايك مقفول من المتصفح. اكتب جوابك.' : code === 'unsupported' ? 'المتصفح ما يدعم المايك. اكتب جوابك.' : code === 'no-speech' ? 'ما سمعت شي، جرّب مرة ثانية.' : 'ما قدرت أسمعك، اكتب جوابك.';
}

/** Countdown that updates a label each second and calls back at zero. */
export class Countdown {
  private id = 0;
  left: number;

  constructor(
    seconds: number,
    private readonly onTick: (left: number) => void,
    private readonly onEnd: () => void,
  ) {
    this.left = seconds;
    onTick(this.left);
    this.id = window.setInterval(() => {
      this.left -= 1;
      this.onTick(this.left);
      if (this.left <= 0) {
        this.stop();
        this.onEnd();
      }
    }, 1000);
  }

  stop(): void {
    clearInterval(this.id);
  }
}
