/**
 * Macro-scale cartographic overlays: the Nile system and canals as screen-space
 * lines (they are narrower than a coarse terrain vertex spacing, so the terrain
 * alone would lose them from orbit), plus governorate and national borders.
 * Opacity follows camera altitude so they hand over to real geometry when close.
 */
import { Group } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { World } from '../gis/world';
import { smoothstep } from '../core/math';

export class MapOverlays {
  readonly group = new Group();
  private readonly riverMats: LineMaterial[] = [];
  private readonly borderMats: LineMaterial[] = [];
  private readonly highlightMat: LineMaterial;
  private readonly govLines = new Map<string, Line2[]>();
  private highlighted: string | null = null;
  bordersEnabled = true;
  riversEnabled = true;

  constructor(private readonly world: World) {
    this.group.name = 'overlays';
    this.group.renderOrder = 20;
    const mat = (color: number, width: number) => {
      const m = new LineMaterial({ color, linewidth: width, transparent: true, depthTest: false, depthWrite: false, worldUnits: false });
      return m;
    };
    for (const r of world.gis.rivers) {
      const m = mat(r.id === 'nile' ? 0x4f9be0 : r.id === 'suez' ? 0x3aa6d8 : 0x5aa0d0, r.id === 'nile' ? 2.6 : r.width >= 200 ? 2 : 1.2);
      this.riverMats.push(m);
      this.addLine(r.points, m, 25);
    }
    const egyptMat = mat(0xffe2a8, 2.2);
    this.borderMats.push(egyptMat);
    for (const ring of world.gis.egypt) this.addLine(closed(ring), egyptMat, 40);
    const govMat = mat(0xd9c3a0, 1);
    this.borderMats.push(govMat);
    for (const g of world.gis.governorates) {
      this.govLines.set(g.iso, g.rings.map((ring) => this.addLine(closed(ring), govMat, 35)));
    }
    this.highlightMat = mat(0xffd36b, 3);
  }

  private addLine(flat: number[], m: LineMaterial, lift: number): Line2 {
    const pos: number[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      const [x, z] = this.world.proj.forward(flat[i], flat[i + 1]);
      pos.push(x, Math.max(0, this.world.terrain.sample(x, z, 4000).height) + lift, z);
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    const line = new Line2(g, m);
    line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = 20;
    this.group.add(line);
    return line;
  }

  highlight(iso: string | null): void {
    if (this.highlighted) for (const l of this.govLines.get(this.highlighted) ?? []) l.material = this.borderMats[1];
    this.highlighted = iso;
    if (iso) for (const l of this.govLines.get(iso) ?? []) l.material = this.highlightMat;
  }

  /** @param dim overall opacity multiplier (e.g. dimmer at night). */
  update(width: number, height: number, altitude: number, dim = 1): void {
    const riverA = this.riversEnabled ? smoothstep(15000, 80000, altitude) * dim : 0;
    const borderA = this.bordersEnabled ? smoothstep(25000, 140000, altitude) : 0;
    for (const m of this.riverMats) this.style(m, width, height, riverA * 0.9);
    this.style(this.borderMats[0], width, height, borderA * 0.85);
    this.style(this.borderMats[1], width, height, borderA * 0.45);
    this.style(this.highlightMat, width, height, this.bordersEnabled ? Math.max(0.35, borderA) : 0);
    this.group.visible = riverA > 0 || borderA > 0 || !!this.highlighted;
  }

  private style(m: LineMaterial, w: number, h: number, opacity: number): void {
    m.resolution.set(w, h);
    m.opacity = opacity;
    m.visible = opacity > 0.01;
  }
}

function closed(ring: number[]): number[] {
  return ring.concat(ring[0], ring[1]);
}
