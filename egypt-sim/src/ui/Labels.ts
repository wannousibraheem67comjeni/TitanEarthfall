/**
 * Projected HTML labels with priority-based decluttering. Each label has a camera
 * distance window, so the map reads like a cartographic style: seas and regions from
 * orbit, governorate capitals at national scale, districts and landmarks up close.
 */
import { Vector3, type Camera } from 'three';

export type LabelKind = 'region' | 'water' | 'capital' | 'city' | 'landmark';

export interface LabelDef {
  id: string;
  text: string;
  sub?: string;
  kind: LabelKind;
  x: number;
  y: number;
  z: number;
  priority: number;
  minDist: number;
  maxDist: number;
  category?: string;
  /** Only shown above this camera altitude (m) — e.g. seas and regions from orbit. */
  minAltitude?: number;
  onClick?: () => void;
}

interface Slot {
  el: HTMLDivElement;
  def: LabelDef | null;
}

const MAX_LABELS = 90;

export class Labels {
  private readonly defs: LabelDef[] = [];
  private readonly slots: Slot[] = [];
  private readonly v = new Vector3();
  enabled = true;

  constructor(root: HTMLElement) {
    for (let i = 0; i < MAX_LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'label';
      el.style.display = 'none';
      el.addEventListener('click', () => this.slots[i].def?.onClick?.());
      root.appendChild(el);
      this.slots.push({ el, def: null });
    }
  }

  add(def: LabelDef): void {
    this.defs.push(def);
  }

  /** @param altitude camera height above ground (m): limits how far labels reach near the ground. */
  update(camera: Camera, width: number, height: number, altitude = Infinity): void {
    if (!this.enabled) {
      for (const s of this.slots) s.el.style.display = 'none';
      return;
    }
    const cam = camera.position;
    const reach = 30000 + altitude * 40;
    const candidates: { def: LabelDef; sx: number; sy: number; d: number }[] = [];
    for (const def of this.defs) {
      const d = Math.hypot(def.x - cam.x, def.y - cam.y, def.z - cam.z);
      if (def.minAltitude !== undefined && altitude < def.minAltitude) continue;
      if (d < def.minDist || d > Math.min(def.maxDist, def.minAltitude !== undefined ? Infinity : reach)) continue;
      this.v.set(def.x, def.y, def.z).project(camera);
      if (this.v.z > 1 || this.v.z < -1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * width;
      const sy = (-this.v.y * 0.5 + 0.5) * height;
      if (sx < -50 || sx > width + 50 || sy < -20 || sy > height + 20) continue;
      candidates.push({ def, sx, sy, d });
    }
    candidates.sort((a, b) => b.def.priority - a.def.priority || a.d - b.d);
    const placed: [number, number, number, number][] = [];
    let used = 0;
    for (const c of candidates) {
      if (used >= MAX_LABELS) break;
      const w = Math.max(c.def.text.length, (c.def.sub?.length ?? 0) * 0.9) * (c.def.kind === 'region' ? 8.5 : 7) + 22;
      const h = c.def.sub ? 34 : 20;
      const box: [number, number, number, number] = [c.sx - w / 2, c.sy - h, c.sx + w / 2, c.sy + 4];
      if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      const slot = this.slots[used++];
      if (slot.def !== c.def) {
        slot.def = c.def;
        slot.el.className = `label label-${c.def.kind}${c.def.category ? ` cat-${c.def.category}` : ''}${c.def.onClick ? ' clickable' : ''}`;
        slot.el.innerHTML = `<span class="t">${escapeHtml(c.def.text)}</span>${c.def.sub ? `<span class="s" dir="rtl" lang="ar">${escapeHtml(c.def.sub)}</span>` : ''}`;
      }
      slot.el.style.display = '';
      slot.el.style.transform = `translate(${c.sx.toFixed(1)}px, ${c.sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (let i = used; i < this.slots.length; i++) {
      this.slots[i].el.style.display = 'none';
      this.slots[i].def = null;
    }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
