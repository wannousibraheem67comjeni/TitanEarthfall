/**
 * A run of multiple-choice steps (an interview, phone calls, customers, invoices):
 * someone says a line, the player picks an answer, sees right or wrong with a short
 * reason, and the next step comes. Used by several work screens.
 */
import { fillTemplate } from '../../lang/arabic';
import { h } from '../dom';
import type { MiniEnv } from './Overlay';

export interface Step {
  /** Who is speaking, and their line (templates use {|ين} gender forms). */
  who: string;
  line: string;
  /** Extra content under the line (an invoice table, for instance). */
  extra?: HTMLElement;
  options: string[];
  right: number;
  why?: string;
  voice?: { gender: 'm' | 'f'; key: string; pitch?: number };
}

export function runChoices(env: MiniEnv, screen: HTMLElement, steps: Step[], onEnd: (right: number) => void, onStep?: (i: number) => void): void {
  const fill = (t: string) => fillTemplate(t, env.store.s.player.gender, { name: env.store.s.player.name });
  let i = 0;
  let right = 0;
  const show = () => {
    const st = steps[i];
    onStep?.(i);
    const order = env.rng.shuffle(st.options.map((_, k) => k));
    const grid = h(st.options.some((o) => o.length > 16) ? 'div.choice-grid.long' : st.options.length === 4 ? 'div.choice-grid.four' : 'div.choice-grid');
    const note = h('div.feedback');
    note.hidden = true;
    for (const k of order) {
      const b = h('button', { type: 'button' }, fill(st.options[k]));
      b.onclick = () => {
        if (grid.classList.contains('done')) return;
        grid.classList.add('done');
        const ok = k === st.right;
        if (ok) right++;
        b.classList.add(ok ? 'right' : 'wrong');
        for (const el of Array.from(grid.children)) if (el.textContent === fill(st.options[st.right])) el.classList.add('right');
        ok ? env.sfx.success() : env.sfx.fail();
        if (st.why) {
          note.hidden = false;
          note.className = `feedback ${ok ? 'good' : 'bad'}`;
          note.textContent = (ok ? '✓ ' : '✗ ') + fill(st.why);
        }
        setTimeout(
          () => {
            i++;
            if (i >= steps.length) onEnd(right);
            else show();
          },
          st.why ? 1700 : 800,
        );
      };
      grid.append(b);
    }
    screen.replaceChildren(h('div.muted', `${i + 1} من ${steps.length}`), h('div.speech', h('span.from', st.who), fill(st.line)), ...(st.extra ? [st.extra] : []), grid, note);
    if (st.voice) env.speak(fill(st.line), st.voice.gender, st.voice.key, st.voice.pitch);
  };
  show();
}

/** Pay line and a close button at the end of a shift. */
export function shiftResult(screen: HTMLElement, text: string, good: boolean, close: () => void, more?: { label: string; run: () => void }): void {
  screen.replaceChildren(
    h('div.feedback', { class: good ? 'good' : 'bad' }, text),
    h('div.row', ...(more ? [h('button.btn', { type: 'button', onclick: more.run }, more.label)] : []), h('button.btn.secondary', { type: 'button', onclick: close }, 'خلاص')),
  );
}
