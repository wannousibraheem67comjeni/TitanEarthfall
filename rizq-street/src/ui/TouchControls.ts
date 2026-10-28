/** On-screen joystick and buttons for phones and tablets. */
import type { Input } from '../game/Input';
import { h } from './dom';

export class TouchControls {
  readonly el = h('div.touch');
  readonly act = h('button.act', { type: 'button' }, 'تفاعل');

  constructor(parent: HTMLElement, input: Input, onAct: () => void) {
    const knob = h('i');
    const stick = h('div.stick', h('b.up', '▲'), h('b.down', '▼'), h('b.left', '◀'), h('b.right', '▶'), knob, h('span.stick-label', 'امشِ'));
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const R = 50;
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.stick.x = dx / R;
      input.stick.y = -dy / R;
      input.touchRun = d > R * 0.9;
    };
    stick.addEventListener('pointermove', move);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      input.stick.x = input.stick.y = 0;
      input.touchRun = false;
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    this.act.onclick = onAct;
    this.el.append(stick, h('div.touch-buttons', this.act));
    parent.append(this.el);
  }

  /** Extra buttons on top of the right-hand cluster (the guide's mic and keyboard). */
  addTop(...buttons: HTMLElement[]): void {
    this.el.querySelector('.touch-buttons')!.prepend(...buttons);
  }

  setAction(label: string | null): void {
    this.act.hidden = !label;
    if (label) this.act.textContent = label;
  }

  static wanted(): boolean {
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }
}
