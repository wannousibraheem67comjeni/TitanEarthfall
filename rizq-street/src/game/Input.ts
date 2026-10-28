/**
 * Keyboard, mouse and touch input in one place. Keys are read by physical position
 * (event.code) so WASD works on Arabic keyboard layouts too.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly hits = new Set<string>();
  /** Touch joystick: x right, y forward, each −1…1. */
  readonly stick = { x: 0, y: 0 };
  touchRun = false;
  touchJump = false;
  /** Camera drag accumulated since the last frame, in pixels. */
  readonly look = { x: 0, y: 0 };
  zoom = 0;
  /** While a text box or menu has focus the game ignores movement keys. */
  blocked = false;
  private dragId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  /** Extra pointer-down handler (scrubbing a car, for instance) gets first refusal. */
  onPointer: ((e: PointerEvent, phase: 'down' | 'move' | 'up') => boolean) | null = null;
  /** A quick tap or click on the view without dragging (walk there). */
  onTap: ((x: number, y: number) => void) | null = null;
  private tap: { id: number; x: number; y: number; t: number } | null = null;

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.hits.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.focus({ preventScroll: true });
      if (this.onPointer?.(e, 'down')) return;
      if (e.isPrimary && e.button === 0) this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.dragId !== null) return;
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.onPointer?.(e, 'move')) return;
      if (e.pointerId !== this.dragId) return;
      this.look.x += e.clientX - this.lastX;
      this.look.y += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      this.onPointer?.(e, 'up');
      if (e.pointerId === this.dragId) this.dragId = null;
      const t = this.tap;
      this.tap = null;
      if (e.type === 'pointerup' && t && t.id === e.pointerId && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && performance.now() - t.t < 400) this.onTap?.(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => (this.zoom += Math.sign(e.deltaY)), { passive: true });
  }

  held(code: string): boolean {
    return !this.blocked && this.down.has(code);
  }

  /** True once per key press. */
  hit(code: string): boolean {
    if (this.blocked) return false;
    return this.hits.has(code);
  }

  /** Movement intent: x right, y forward. */
  axis(): { x: number; y: number } {
    let x = this.stick.x;
    let y = this.stick.y;
    if (this.held('KeyW') || this.held('ArrowUp')) y += 1;
    if (this.held('KeyS') || this.held('ArrowDown')) y -= 1;
    if (this.held('KeyD') || this.held('ArrowRight')) x += 1;
    if (this.held('KeyA') || this.held('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  get running(): boolean {
    return this.touchRun || this.held('ShiftLeft') || this.held('ShiftRight');
  }

  endFrame(): void {
    this.hits.clear();
    this.look.x = this.look.y = 0;
    this.zoom = 0;
    this.touchJump = false;
  }

  releaseAll(): void {
    this.down.clear();
    this.stick.x = this.stick.y = 0;
    this.touchRun = false;
  }
}

export function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}
