/**
 * Procedural people at human proportions. Each person has a skeleton of joints (hips,
 * spine, chest, neck, head, shoulders, elbows, wrists, hips, knees, ankles) carrying
 * smooth body parts; a sculpted head with eye sockets, cheekbones and a jaw, a nose,
 * ears and lips; eyeballs that turn to look at you, eyelids that blink, brows, beards
 * and hair; and real clothes: the kandura with ghutra and agal, the abaya with shayla,
 * work coveralls, shirts, school uniforms. They walk heel to toe with the robe swinging
 * from the legs, breathe, glance around, reach for shelves, set goods down, hand over
 * money, and move their lips while they talk.
 */
import {
  Bone,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cached, canvas, DISPLAY_FONT, toTexture } from './textures';
import type { Look } from './look';

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------


function solid(color: string, rough = 0.6, metal = 0): MeshStandardMaterial {
  return cached(`hsolid${color}${rough}${metal}`, () => new MeshStandardMaterial({ color: new Color(color), roughness: rough, metalness: metal }));
}

function irisTexture(color: string): CanvasTexture {
  return cached(`iris${color}`, () => {
    const [c, ctx] = canvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, '#050505');
    g.addColorStop(0.36, '#050505');
    g.addColorStop(0.42, color);
    g.addColorStop(0.85, new Color(color).multiplyScalar(0.6).getStyle());
    g.addColorStop(1, '#1a120c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(24, 22, 5, 0, Math.PI * 2);
    ctx.fill();
    return toTexture(c);
  });
}

/** White cotton with a faint weave; or the red-and-white shemagh check. */
function ghutraTexture(red: boolean): CanvasTexture {
  return cached(`ghutra${red}`, () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, 256, 256);
    if (red) {
      ctx.fillStyle = '#c4242c';
      for (let y = 0; y < 256; y += 16)
        for (let x = 0; x < 256; x += 16) {
          if ((x / 16 + y / 16) % 2 === 0) ctx.fillRect(x + 3, y + 3, 10, 10);
          else ctx.fillRect(x + 6, y + 6, 4, 4);
        }
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.035)';
      for (let i = 0; i < 256; i += 3) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.stroke();
      }
    }
    const t = toTexture(c, { repeat: true });
    t.repeat.set(4, 4);
    return t;
  });
}

function bagTexture(): CanvasTexture {
  return cached('bagTex', () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#e8508f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `44px ${DISPLAY_FONT}`;
    ctx.fillText('شكراً لزيارتكم', 128, 110);
    ctx.font = `30px ${DISPLAY_FONT}`;
    ctx.fillText('بقالة شرق الإمارات', 128, 160);
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function merge(geos: BufferGeometry[]): BufferGeometry {
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') n.deleteAttribute(k);
    n.clearGroups();
    return n;
  });
  const hasColor = clean.some((g) => g.getAttribute('color'));
  if (hasColor)
    for (const g of clean)
      if (!g.getAttribute('color')) {
        const n = g.attributes.position.count;
        g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
  return mergeGeometries(clean, false)!;
}

function tint(g: BufferGeometry, color: Color): BufferGeometry {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Head proportions (half sizes, metres): width, height, depth.
const HA = 0.074;
const HB = 0.112;
const HC = 0.095;

/** Front surface depth of the head at (x, y), for placing features on the face. */
function faceZ(x: number, y: number): number {
  const k = 1 - (x / HA) ** 2 - (y / HB) ** 2;
  let z = HC * Math.sqrt(Math.max(0, k));
  if (y < 0) z *= 1 - 0.1 * (-y / HB) ** 1.3;
  return z;
}

/** Sculpt a sphere into a head: jaw and chin, eye sockets, brow, cheekbones, fuller skull. */
function sculptHead(female: boolean, child: boolean, jaw: number, lite = false): BufferGeometry {
  const g = new SphereGeometry(1, lite ? 20 : 40, lite ? 15 : 30);
  const pos = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = v.x;
    const ny = v.y;
    const nz = v.z;
    let x = nx * HA;
    let y = ny * HB;
    let z = nz * HC;
    if (ny < 0) {
      const t = (-ny) ** 1.3;
      // Jaw narrows towards the chin; the back of the lower head tucks into the neck.
      x *= 1 - (female || child ? 0.38 : 0.3 - jaw * 0.06) * t;
      if (nz < 0) z *= 1 - 0.25 * t;
      else z *= 1 - 0.1 * t;
      if (nz > 0.3 && ny < -0.75) z += 0.01 * (1 - Math.abs(nx) * 2);
    }
    if (nz < -0.2) z *= 1.07;
    if (ny > 0.3) y *= child ? 1.05 : 1;
    // Flatter face plane, deeper eye sockets, brow ridge, cheekbones.
    if (nz > 0.55) z -= (nz - 0.55) * 0.012;
    for (const ex of [-0.031, 0.031]) {
      const d = Math.hypot((x - ex) * 0.9, y - 0.011);
      if (nz > 0.4 && d < 0.027) z -= 0.009 * (1 - d / 0.027) ** 2;
    }
    if (nz > 0.5 && Math.abs(y - 0.036) < 0.012 && Math.abs(x) < 0.055) z += (female ? 0.0015 : 0.003) * (1 - Math.abs(y - 0.036) / 0.012);
    for (const cx of [-0.046, 0.046]) {
      const d = Math.hypot(x - cx, y + 0.012);
      if (nz > 0.25 && d < 0.03) {
        const k = 0.004 * (1 - d / 0.03);
        x += Math.sign(cx) * k;
        z += k * 0.6;
      }
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** Vertex colours for the head: rosier cheeks and nose, darker brows region, a shaved shadow for men. */
function paintHead(g: BufferGeometry, skin: Color, male: boolean, shaved: boolean): void {
  const pos = g.attributes.position;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const rose = new Color('#c4604f');
  const shadow = new Color('#3d3b44');
  const c = new Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    c.copy(skin);
    for (const cx of [-0.045, 0.045]) {
      const d = Math.hypot(x - cx, y + 0.022);
      if (z > 0.03 && d < 0.03) c.lerp(rose, 0.12 * (1 - d / 0.03));
    }
    if (z > 0.04) {
      const d = Math.hypot(x, y + 0.05);
      if (d < 0.025) c.lerp(rose, 0.08 * (1 - d / 0.025));
    }
    if (male && shaved && y < -0.03 && z > -0.02) c.lerp(shadow, 0.16 * smooth(-0.03, -0.07, y));
    if (Math.abs(x) > 0.06 && z < 0.03 && Math.abs(y) < 0.04) c.multiplyScalar(0.94);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
}

/**
 * A shell over part of the head (hair, caps, ghutra crown, beards): spherical angles θ
 * (from the top) and φ (around, 0 = front), pushed out from the sculpted surface.
 */
function headShell(thetaTop: (phi: number) => number, thetaBottom: (phi: number) => number, phi0: number, phi1: number, out: number, segU = 28, segV = 12): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= segV; j++)
    for (let i = 0; i <= segU; i++) {
      uvs.push((i / segU) * 2, j / segV);
      const phi = phi0 + ((phi1 - phi0) * i) / segU;
      const t0 = thetaTop(phi);
      const t1 = thetaBottom(phi);
      const th = t0 + ((t1 - t0) * j) / segV;
      const nx = Math.sin(th) * Math.sin(phi);
      const ny = Math.cos(th);
      const nz = Math.sin(th) * Math.cos(phi);
      let x = nx * HA;
      const y = ny * HB;
      let z = nz * HC;
      if (ny < 0) {
        const t = (-ny) ** 1.3;
        x *= 1 - 0.3 * t;
        z *= nz < 0 ? 1 - 0.25 * t : 1 - 0.1 * t;
      }
      if (nz < -0.2) z *= 1.07;
      const len = Math.hypot(x / HA, y / HB, z / HC) || 1;
      positions.push(x + (nx / len) * out, y + (ny / len) * out, z + (nz / len) * out);
    }
  for (let j = 0; j < segV; j++)
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i;
      const b = a + segU + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Cloth falling from the head over the shoulders (ghutra, shayla): a sleeve of fabric
 * open at the face, spreading from the temples to the shoulders and down the chest.
 */
function headDrape(opts: { open: (v: number) => number; top: number; bottom: number; spread: number; tight: number; folds: number }, lite = false): BufferGeometry {
  const segU = lite ? 18 : 36;
  const segV = lite ? 8 : 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const y = opts.top + (opts.bottom - opts.top) * v;
    const open = opts.open(v);
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const a = open + u * (Math.PI * 2 - 2 * open);
      // Around the head first, then out over the shoulders and onto the chest and back.
      const headRx = HA * opts.tight;
      const headRz = HC * opts.tight;
      const sh = smooth(0.18, 0.62, v);
      const rx = headRx + (0.215 - headRx) * sh * opts.spread;
      const rz = headRz + (0.14 - headRz) * sh * opts.spread;
      const fold = 1 + Math.sin(a * 9 + v * 4) * 0.035 * v * opts.folds;
      // The front edges fold back on themselves, as cloth does.
      const edge = Math.min(u, 1 - u);
      const curl = edge < 0.09 ? (0.09 - edge) / 0.09 : 0;
      // The back hangs a little lower than the front edges.
      const back = Math.cos(a) < 0 ? -Math.cos(a) * 0.06 * v : 0;
      positions.push(Math.sin(a) * rx * fold * (1 + curl * 0.07), y - back, Math.cos(a) * rz * fold - curl * 0.014);
      uvs.push(u * 3, v * 2);
    }
  }
  for (let j = 0; j < segV; j++)
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i;
      const b = a + segU + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A limb hanging from a joint along −y: a tapered tube with rounded ends. */
function limb(len: number, r0: number, r1: number, seg = 14): BufferGeometry {
  return merge([
    new CylinderGeometry(r0, r1, len, seg, 3, true).translate(0, -len / 2, 0),
    new SphereGeometry(r0, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new SphereGeometry(r1, seg, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -len, 0),
  ]);
}

/** Flat disc UVs for a spherical cap around +y (so a round texture lands centred). */
function capUV(g: BufferGeometry, radius: number, maxTheta: number): BufferGeometry {
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const k = 1 / (2 * radius * Math.sin(maxTheta));
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) * k, 0.5 - pos.getZ(i) * k);
  return g;
}

function handGeometry(right: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(new SphereGeometry(1, 12, 10).scale(0.038, 0.048, 0.016).translate(0, -0.045, 0));
  for (let f = 0; f < 4; f++) {
    const len = [0.042, 0.048, 0.046, 0.036][f];
    const fg = new CapsuleGeometry(0.0085, len, 4, 6);
    fg.translate(0, -len / 2, 0);
    fg.rotateX(0.35);
    fg.translate(-0.024 + f * 0.016, -0.088, 0.004);
    parts.push(fg);
  }
  const th = new CapsuleGeometry(0.01, 0.035, 4, 6);
  th.translate(0, -0.02, 0);
  th.rotateZ(right ? -0.7 : 0.7);
  th.rotateX(0.5);
  th.translate(right ? -0.035 : 0.035, -0.03, 0.012);
  parts.push(th);
  return merge(parts);
}

// ---------------------------------------------------------------------------
// The person
// ---------------------------------------------------------------------------

export interface Pose {
  /** Walking speed, m/s. */
  speed: number;
  talking: boolean;
  /** World point to look at, or null to look ahead. */
  lookAt: Vector3 | null;
  /** 0…1: right arm reaching out (to a shelf at `reachY`, or the desk). */
  reach: number;
  reachY: number;
  /** 0…1: right hand held out (paying, handing over). */
  give: number;
  mood: 'neutral' | 'happy' | 'sad' | 'cross';
}

/** How a part is painted: a shared material by kind, tinted per vertex; or a material of its own. */
type Paint = { k: 'skin' | 'cloth' | 'clothDS' | 'silk' | 'silkDS' | 'matte' | 'gloss'; c: string | null } | { k: 'own'; m: Material };

const C = (c: string): Paint => ({ k: 'cloth', c });
const CD = (c: string): Paint => ({ k: 'clothDS', c });
const SILK = (c: string, ds = false): Paint => ({ k: ds ? 'silkDS' : 'silk', c });
const M = (c: string, rough = 0.7): Paint => ({ k: rough < 0.45 ? 'gloss' : 'matte', c });
const OWN = (m: Material): Paint => ({ k: 'own', m });

/** The few materials every person shares; colours ride on the vertices. */
const SHARED = {
  skin: () => cached('pSkin', () => new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.58, sheen: 0.22, sheenRoughness: 0.7, sheenColor: new Color('#ffe2d4') })),
  cloth: () => cached('pCloth', () => new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.84, sheen: 0.3, sheenRoughness: 0.8, sheenColor: new Color('#f4f0ea') })),
  clothDS: () => cached('pClothDS', () => new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.84, sheen: 0.3, sheenRoughness: 0.8, sheenColor: new Color('#f4f0ea'), side: DoubleSide })),
  silk: () => cached('pSilk', () => new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.66, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new Color('#8a8496') })),
  silkDS: () => cached('pSilkDS', () => new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.66, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new Color('#8a8496'), side: DoubleSide })),
  matte: () => cached('pMatte', () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })),
  gloss: () => cached('pGloss', () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1 })),
};

interface Piece {
  bone: Bone;
  geo: BufferGeometry;
  paint: Paint;
  /** Custom skinning (the robe); otherwise rigid to `bone`. */
  weights?: (p: Vector3) => [Bone, number][];
}

const tmpV = new Vector3();
const tmpP = new Vector3();
const IDENT = new Matrix4();

export class Human {
  readonly root = new Group();
  readonly height: number;
  readonly handR = new Object3D();
  readonly handL = new Object3D();
  readonly pose: Pose = { speed: 0, talking: false, lookAt: null, reach: 0, reachY: 1, give: 0, mood: 'neutral' };
  private readonly hips = new Bone();
  private readonly spine = new Bone();
  private readonly chest = new Bone();
  private readonly neck = new Bone();
  private readonly head = new Bone();
  private readonly shoulder: [Bone, Bone] = [new Bone(), new Bone()];
  private readonly elbow: [Bone, Bone] = [new Bone(), new Bone()];
  private readonly wrist: [Bone, Bone] = [new Bone(), new Bone()];
  private readonly hip: [Bone, Bone] = [new Bone(), new Bone()];
  private readonly knee: [Bone, Bone] = [new Bone(), new Bone()];
  private readonly ankle: [Bone, Bone] = [new Bone(), new Bone()];
  private readonly eyes: Bone[] = [];
  private readonly lids: Bone[] = [];
  private readonly brows: Bone[] = [];
  private mouth: Bone | null = null;
  private lowerLip: Bone | null = null;
  private tassel: Bone | null = null;
  private readonly pieces: Piece[] = [];
  private readonly skinned: SkinnedMesh[] = [];
  private phase = Math.random() * 6;
  private t = Math.random() * 10;
  private blinkT = 1 + Math.random() * 3;
  private blink = 0;
  private talkT = 0;
  private open = 0;
  private headYaw = 0;
  private headPitch = 0;
  private glance = 0;
  private glanceT = 2;
  private gesture = 0;
  private gestureT = 0;
  private readonly old: boolean;
  private readonly child: boolean;
  private readonly female: boolean;
  private carry: Object3D | null = null;
  private readonly extras: Mesh[] = [];

  /** `full` for people who come up to the desk; `lite` (no face detail, fewer polygons) for the crowd. */
  constructor(
    readonly look: Look,
    readonly detail: 'full' | 'lite' = 'full',
  ) {
    this.old = look.build === 'old';
    this.child = look.build === 'boy' || look.build === 'girl';
    this.female = look.build === 'woman' || look.build === 'girl';
    this.height = look.height;
    this.root.add(this.hips);
    this.build();
    this.bind();
    // Built at 1.75 m and scaled; children get a larger head and shorter legs.
    this.root.scale.setScalar(look.height / (this.child ? 1.62 : 1.75));
  }

  /** A joint under `parent` at a local offset. */
  private joint(parent: Object3D, x = 0, y = 0, z = 0): Bone {
    const b = new Bone();
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  }

  private add(bone: Bone, geo: BufferGeometry, paint: Paint, x = 0, y = 0, z = 0): void {
    if (x || y || z) geo.translate(x, y, z);
    this.pieces.push({ bone, geo, paint });
  }

  /** Turn the parts into one skinned mesh per material, all driven by the same skeleton. */
  private bind(): void {
    this.root.updateMatrixWorld(true);
    const bones: Bone[] = [];
    this.root.traverse((o) => {
      if ((o as Bone).isBone) bones.push(o as Bone);
    });
    const index = new Map(bones.map((b, i) => [b, i]));
    const buckets = new Map<Material, BufferGeometry[]>();
    const tint = new Color();
    for (const piece of this.pieces) {
      const material = piece.paint.k === 'own' ? piece.paint.m : SHARED[piece.paint.k]();
      let g = piece.geo.index ? piece.geo.toNonIndexed() : piece.geo;
      const own = piece.paint.k === 'own';
      const keepUv = own && !!(material as MeshStandardMaterial).map;
      const keepColor = !own || (material as MeshStandardMaterial).vertexColors;
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'uv' && keepUv) && !(k === 'color' && keepColor)) g.deleteAttribute(k);
      g.clearGroups();
      const n = g.attributes.position.count;
      const paintColor = piece.paint.k === 'own' ? null : piece.paint.c;
      if (!own && (paintColor !== null || !g.getAttribute('color'))) {
        tint.set(paintColor ?? '#ffffff');
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([tint.r, tint.g, tint.b], i * 3);
        g.setAttribute('color', new Float32BufferAttribute(col, 3));
      }
      // Skin weights, computed in the part's own joint space, then the part moves into body space.
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const pos = g.attributes.position;
      for (let i = 0; i < n; i++) {
        if (piece.weights) {
          tmpP.fromBufferAttribute(pos, i);
          piece.weights(tmpP).forEach(([b, w], j) => {
            si[i * 4 + j] = index.get(b) ?? 0;
            sw[i * 4 + j] = w;
          });
        } else {
          si[i * 4] = index.get(piece.bone) ?? 0;
          sw[i * 4] = 1;
        }
      }
      g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
      g = g.applyMatrix4(piece.bone.matrixWorld);
      let list = buckets.get(material);
      if (!list) buckets.set(material, (list = []));
      list.push(g);
    }
    const skeleton = new Skeleton(bones);
    for (const [material, list] of buckets) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      for (const g of list) g.dispose();
      const mesh = new SkinnedMesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      mesh.bind(skeleton, IDENT);
      this.skinned.push(mesh);
    }
    this.pieces.length = 0;
  }

  setShadows(on: boolean): void {
    for (const m of this.skinned) m.castShadow = on;
  }

  private build(): void {
    const L = this.look;
    const fem = this.female;
    const kid = this.child;
    const lite = this.detail === 'lite';
    const seg = lite ? 0.55 : 1;
    const S = (n: number) => Math.max(5, Math.round(n * seg));
    const robe = L.outfit === 'kandura' || L.outfit === 'abaya';
    const abaya = L.outfit === 'abaya';
    const wide = 1 + L.weight * 0.22;
    const skinC = new Color(L.skin);
    const top = abaya ? '#141216' : L.primary;
    const bottom = L.outfit === 'uniform' ? L.primary : L.secondary;
    const topPaint = abaya ? SILK(top) : C(top);
    const bottomPaint = C(bottom);
    const skin: Paint = { k: 'skin', c: L.skin };
    const legLen = kid ? 0.38 : 0.42;

    // ------------------------------------------------------------- skeleton
    this.hips.position.y = legLen * 2 + 0.1;
    this.hips.add(this.spine);
    this.spine.position.y = 0.1;
    this.spine.add(this.chest);
    this.chest.position.y = 0.24;
    this.chest.add(this.neck);
    this.neck.position.y = 0.22;
    this.neck.add(this.head);
    this.head.position.y = 0.12;
    if (kid) this.head.scale.setScalar(1.22);
    for (const s of [0, 1] as const) {
      const sx = s === 0 ? 1 : -1; // 0 = left (+x), 1 = right (−x)
      const sh = this.shoulder[s];
      sh.position.set(sx * (fem ? 0.16 : 0.178) * wide, 0.15, 0);
      this.chest.add(sh);
      sh.add(this.elbow[s]);
      this.elbow[s].position.y = -0.29;
      this.elbow[s].add(this.wrist[s]);
      this.wrist[s].position.y = -0.25;
      const hp = this.hip[s];
      hp.position.set(sx * 0.09 * wide, -0.04, 0);
      this.hips.add(hp);
      hp.add(this.knee[s]);
      this.knee[s].position.y = -legLen;
      this.knee[s].add(this.ankle[s]);
      this.ankle[s].position.y = -legLen;
    }
    this.wrist[1].add(this.handR);
    this.wrist[0].add(this.handL);
    this.handR.position.set(0, -0.09, 0.02);
    this.handL.position.set(0, -0.09, 0.02);

    // ------------------------------------------------------------- torso
    const torsoProfile: [number, number][] = fem
      ? [
          [0.0, -0.2],
          [0.165, -0.19],
          [0.175, -0.1],
          [0.135, 0.06],
          [0.14, 0.16],
          [0.165, 0.26],
          [0.17, 0.33],
          [0.18, 0.38],
          [0.15, 0.43],
          [0.09, 0.47],
          [0.052, 0.49],
        ]
      : [
          [0.0, -0.2],
          [0.158, -0.19],
          [0.162, -0.1],
          [0.15, 0.04],
          [0.155, 0.16],
          [0.175, 0.28],
          [0.19, 0.36],
          [0.19, 0.39],
          [0.155, 0.44],
          [0.095, 0.475],
          [0.056, 0.495],
        ];
    const torso = () => {
      const g = new LatheGeometry(
        torsoProfile.map(([r, y]) => new Vector2(r * wide, y)),
        S(28),
      );
      g.scale(1, 1, 0.62 + L.weight * 0.08);
      return g;
    };
    if (!robe) this.add(this.spine, torso(), topPaint, 0, 0.02, 0);
    if (!robe && L.outfit !== 'dress') {
      const pelvis = new LatheGeometry(
        (
          [
            [0.0, -0.15],
            [0.1, -0.14],
            [0.155, -0.08],
            [0.165, 0.0],
            [0.16, 0.08],
          ] as [number, number][]
        ).map(([r, y]) => new Vector2(r * wide, y)),
        S(24),
      );
      pelvis.scale(1, 1, 0.68);
      this.add(this.hips, pelvis, bottomPaint);
      if (L.outfit === 'shirt') this.add(this.hips, new CylinderGeometry(0.164 * wide, 0.164 * wide, 0.035, S(24), 1, true).scale(1, 1, 0.69), M('#2a2420', 0.4), 0, 0.06, 0);
    }
    this.add(this.neck, new CylinderGeometry(0.048, 0.055, 0.14, S(14)).translate(0, 0.02, 0), skin);

    if (!lite && (L.outfit === 'shirt' || L.outfit === 'school' || L.outfit === 'uniform')) {
      this.add(this.chest, new TorusGeometry(0.062, 0.014, 6, 18, Math.PI * 1.4).rotateX(Math.PI / 2).rotateY(Math.PI * 0.8), C(L.outfit === 'school' ? '#ffffff' : top), 0, 0.2, 0.0);
      this.add(this.chest, new CylinderGeometry(0.006, 0.006, 0.36, 4).translate(0, 0.03, 0), M('#f2f2f0', 0.4), 0, 0, 0.112);
    }
    if (L.outfit === 'uniform') this.add(this.spine, new CylinderGeometry(0.175 * wide, 0.175 * wide, 0.035, S(28), 1, true).scale(1, 1, 0.66), M('#d8dde0', 0.25), 0, 0.3, 0);
    if (L.backpack) this.add(this.chest, new CapsuleGeometry(0.11, 0.14, 4, S(10)).scale(1, 1, 0.55), C('#2f6fb0'), 0, -0.05, -0.15);

    // ------------------------------------------------------------- robe (kandura / abaya / long skirt)
    if (robe || L.outfit === 'dress') {
      const from = L.outfit === 'dress' ? 0.05 : 0.86;
      const hem = abaya ? 0.27 : L.outfit === 'dress' ? 0.25 : 0.205;
      const pts: [number, number][] = [
        [0.05, -0.86],
        [hem * wide, -0.86],
        [hem * 0.96 * wide, -0.62],
        [0.205 * wide, -0.25],
        [0.19 * wide, 0.0],
        [0.172 * wide, 0.14],
        [(fem ? 0.165 : 0.17) * wide, 0.28],
        [(fem ? 0.17 : 0.18) * wide, 0.4],
        [0.185 * wide, 0.47],
        [0.15 * wide, 0.52],
        [0.09, 0.55],
        [0.056, 0.57],
      ];
      const g = new LatheGeometry(
        pts.filter(([, y]) => y <= from).map(([r, y]) => new Vector2(r, y)),
        S(40),
      );
      g.scale(1, 1, 0.66 + L.weight * 0.08);
      // Fabric folds running down from the waist.
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < -0.05) {
          const a = Math.atan2(pos.getX(i), pos.getZ(i));
          const f = 1 + Math.sin(a * 11) * 0.025 * smooth(-0.05, -0.8, y);
          pos.setX(i, pos.getX(i) * f);
          pos.setZ(i, pos.getZ(i) * f);
        }
      }
      g.computeVertexNormals();
      // The skirt swings with the thighs; the top follows the spine and chest.
      const hips = this.hips;
      const spine = this.spine;
      const chest = this.chest;
      const [hipL, hipR] = this.hip;
      this.pieces.push({
        bone: hips,
        geo: g,
        paint: L.outfit === 'dress' ? bottomPaint : topPaint,
        weights: (p) => {
          if (p.y < 0) {
            const k = Math.min(0.8, -p.y * 1.1) * smooth(0, 0.25, -p.y);
            const side = smooth(-0.08, 0.1, p.x);
            return [
              [hips, 1 - k],
              [hipL, k * side],
              [hipR, k * (1 - side)],
            ];
          }
          const wc = smooth(0.3, 0.42, p.y);
          const ws = smooth(0.0, 0.15, p.y) * (1 - wc);
          return [
            [hips, 1 - wc - ws],
            [spine, ws],
            [chest, wc],
          ];
        },
      });
      if (L.outfit === 'dress') this.add(this.spine, torso(), topPaint, 0, 0.02, 0);
      if (L.outfit === 'kandura') {
        this.add(this.chest, new CylinderGeometry(0.058, 0.064, 0.035, S(18), 1, true), CD(top), 0, 0.225, 0.005);
        if (!lite) {
          this.tassel = this.joint(this.chest, 0.012, 0.2, 0.1);
          this.add(this.tassel, new CylinderGeometry(0.006, 0.004, 0.24, 6).translate(0, -0.12, 0), C(top));
        }
      }
    }

    // ------------------------------------------------------------- arms and hands
    const sleeveLong = L.outfit !== 'tshirt' && !(L.outfit === 'school' && !fem);
    for (const s of [0, 1] as const) {
      this.add(this.shoulder[s], new SphereGeometry(0.047 * wide, S(14), S(10)), topPaint, 0, -0.02, 0);
      this.add(this.shoulder[s], limb(0.29, (fem ? 0.043 : 0.047) * wide, 0.039 * wide, S(14)), topPaint);
      const fore = abaya ? limb(0.25, 0.045, 0.075, S(14)) : limb(0.25, 0.041 * wide, 0.033, S(14));
      this.add(this.elbow[s], fore, robe || sleeveLong ? topPaint : skin);
      if (!robe && !sleeveLong) this.add(this.shoulder[s], new CylinderGeometry(0.058 * wide, 0.055 * wide, 0.14, S(14), 1, true).translate(0, -0.07, 0), topPaint);
      this.add(this.wrist[s], lite ? new SphereGeometry(1, 8, 6).scale(0.036, 0.07, 0.018).translate(0, -0.06, 0) : handGeometry(s === 1), skin, 0, 0.01, 0);
    }

    // ------------------------------------------------------------- legs and feet
    for (const s of [0, 1] as const) {
      const legPaint = robe ? C(abaya ? '#141216' : '#efeeea') : L.outfit === 'dress' ? skin : bottomPaint;
      this.add(this.hip[s], limb(legLen, 0.075 * wide, 0.055 * wide, S(14)), legPaint);
      this.add(this.knee[s], limb(legLen, 0.054 * wide, 0.04, S(14)), legPaint);
      const ft = this.ankle[s];
      if (L.shoes === 'sandals') {
        this.add(ft, new CapsuleGeometry(0.035, 0.15, 4, 8).rotateX(Math.PI / 2).scale(1, 0.55, 1), skin, 0, -0.03, 0.05);
        this.add(ft, new CylinderGeometry(0.05, 0.05, 0.016, 12).scale(1, 1, 2.6).translate(0, -0.052, 0.045), M('#5a3a22', 0.7));
        if (!lite) this.add(ft, new TorusGeometry(0.036, 0.008, 4, 12, Math.PI).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, -0.03, 0.07), M('#4a2e1a', 0.6));
      } else {
        this.add(ft, new CapsuleGeometry(0.045, 0.16, 4, 10).rotateX(Math.PI / 2).scale(1, 0.62, 1), L.shoes === 'sneakers' ? M(fem ? '#f2f2f2' : '#e9e9e9', 0.6) : M('#1c1a18', 0.3), 0, -0.035, 0.05);
        if (L.shoes === 'sneakers') this.add(ft, new CylinderGeometry(0.048, 0.048, 0.02, 12).scale(1, 1, 2.5).translate(0, -0.06, 0.05), M('#cfcfcf', 0.8));
      }
    }

    // ------------------------------------------------------------- head and face
    const male = !fem;
    const headG = sculptHead(fem, kid, L.weight, lite);
    paintHead(headG, skinC, male && !kid, L.beard === 'none' || L.beard === 'moustache');
    const face: BufferGeometry[] = [headG];
    const nz = faceZ(0, -0.01);
    face.push(tint(new SphereGeometry(1, 12, 10).scale(fem ? 0.0062 : 0.0072, 0.024, 0.0085).rotateX(-0.36).translate(0, -0.005, nz + 0.0035), skinC));
    face.push(tint(new SphereGeometry(fem ? 0.0074 : 0.0086, 12, 10).scale(1, 0.9, 1).translate(0, -0.024, faceZ(0, -0.024) + 0.0105), skinC));
    if (!lite) for (const sx of [-1, 1]) face.push(tint(new SphereGeometry(fem ? 0.0052 : 0.006, 10, 8).scale(1, 0.85, 1).translate(sx * (fem ? 0.0092 : 0.0102), -0.0265, faceZ(0.0102, -0.0265) + 0.0042), skinC.clone().multiplyScalar(0.96)));
    for (const sx of [-1, 1]) face.push(tint(new SphereGeometry(1, 10, 8).scale(0.009, 0.03, 0.019).rotateY(sx * 0.4).translate(sx * (HA - 0.002), 0.0, -0.01), skinC.clone().multiplyScalar(0.96)));
    this.add(this.head, merge(face), { k: 'skin', c: null });

    const my = -0.051;
    const mz = faceZ(0, my);
    if (lite) {
      // From across the shop: dark eyes and a mouth line are enough.
      for (const sx of [-1, 1]) this.add(this.head, new SphereGeometry(0.0085, 8, 6), M('#2a1d14', 0.3), sx * 0.031, 0.012, faceZ(0.031, 0.012) - 0.004);
      this.add(this.head, new SphereGeometry(1, 8, 6).scale(0.016, 0.003, 0.004), M(skinC.clone().lerp(new Color('#7a3a33'), 0.5).getStyle(), 0.6), 0, my, mz);
      for (const sx of [-1, 1]) this.add(this.head, new CylinderGeometry(0.0025, 0.0025, 0.03, 5).rotateZ(Math.PI / 2 + sx * 0.12), M(L.hairColor, 0.8), sx * 0.03, 0.037, faceZ(0.03, 0.037) + 0.002);
    } else {
      // Eyes: whites, irises that turn, lids that blink.
      const irisColor = ['#4a2f1c', '#3a2416', '#5c3b22', '#2b1d12', '#6a5a3a'][Math.floor(Math.abs(Math.sin(L.height * 97)) * 5)];
      const irisMat = cached(`irisMat${irisColor}`, () => new MeshStandardMaterial({ map: irisTexture(irisColor), roughness: 0.08 }));
      for (const sx of [-1, 1]) {
        const ex = sx * 0.031;
        const ey = 0.012;
        const ez = faceZ(ex, ey) - 0.013;
        const eye = this.joint(this.head, ex, ey, ez);
        this.add(eye, new SphereGeometry(0.0118, 16, 12), M('#f1ede6', 0.12));
        this.add(eye, capUV(new SphereGeometry(0.0119, 16, 12, 0, Math.PI * 2, 0, 0.55), 0.0119, 0.55).rotateX(Math.PI / 2), OWN(irisMat));
        this.eyes.push(eye);
        const lid = this.joint(this.head, ex, ey, ez);
        lid.rotation.x = -0.1;
        this.add(lid, new SphereGeometry(0.0127, 18, 8, 0, Math.PI * 2, 0, 1.12), skin);
        this.add(lid, new TorusGeometry(0.0115, fem ? 0.0011 : 0.0008, 4, 24).rotateX(Math.PI / 2).translate(0, 0.0055, 0), M('#120c0a', 0.6));
        this.lids.push(lid);
        this.add(this.head, new SphereGeometry(0.0125, 16, 6, 0, Math.PI * 2, Math.PI - 0.82, 0.82), skin, ex, ey, ez);
        const by = 0.036;
        const curve = new CatmullRomCurve3([
          new Vector3(sx * 0.011, by - 0.003, faceZ(0.011, by) + 0.0025),
          new Vector3(sx * 0.024, by + (fem ? 0.005 : 0.003), faceZ(0.024, by) + 0.003),
          new Vector3(sx * 0.038, by + (fem ? 0.006 : 0.003), faceZ(0.038, by) + 0.0025),
          new Vector3(sx * 0.05, by - 0.002, faceZ(0.05, by) + 0.0015),
        ]);
        // Each brow hangs on its own joint at its middle, so it can frown.
        const mid = curve.getPoint(0.5);
        const brow = this.joint(this.head, mid.x, mid.y, mid.z);
        this.add(brow, new TubeGeometry(curve, 10, fem ? 0.0017 : 0.0024, 5, false).scale(1, 0.8, 1).translate(-mid.x, -mid.y, -mid.z), M(L.hairColor, 0.78));
        this.brows.push(brow);
      }
      // Lips and the mouth between them.
      const lipC = skinC.clone().lerp(new Color('#a85a52'), fem ? 0.42 : 0.24).getStyle();
      this.mouth = this.joint(this.head, 0, my, mz - 0.0012);
      this.add(this.mouth, new SphereGeometry(1, 12, 8).scale(0.016, 0.0022, 0.004), M('#2a0e0e', 0.9));
      this.add(this.head, new CapsuleGeometry(0.0033, 0.03, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.55), C(lipC), 0, my + 0.0038, mz + 0.0008);
      this.lowerLip = this.joint(this.head, 0, my - 0.0045, mz + 0.0002);
      this.add(this.lowerLip, new CapsuleGeometry(fem ? 0.0046 : 0.0042, 0.026, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.6), C(lipC));
    }

    // Facial hair.
    if (L.beard === 'full' || L.beard === 'trim' || L.beard === 'goatee') {
      const thick = L.beard === 'full' ? 0.009 : 0.0035;
      const span = L.beard === 'goatee' ? 0.7 : 2.2;
      const g = headShell(
        (phi) => 2.12 - 0.62 * Math.min(1, Math.abs(phi) / 1.6) ** 1.4,
        () => 2.9,
        -span,
        span,
        thick,
        lite ? 16 : 30,
        lite ? 6 : 10,
      );
      if (lite) this.add(this.head, g, M(L.beardColor, 0.95));
      else {
        // Soft upper edge: the top rows fade out.
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 4);
        const bc = new Color(L.beardColor);
        for (let i = 0; i < n; i++) col.set([bc.r, bc.g, bc.b, Math.min(1, Math.floor(i / 31) / 3.5)], i * 4);
        g.setAttribute('color', new Float32BufferAttribute(col, 4));
        this.add(this.head, g, OWN(cached('beardMat', () => new MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.95 }))));
      }
    }
    if (!lite && (L.beard === 'full' || L.beard === 'trim' || L.beard === 'goatee' || L.beard === 'moustache')) {
      const r = L.beard === 'full' ? 0.0045 : L.beard === 'moustache' ? 0.004 : 0.0035;
      const mc = new CatmullRomCurve3([new Vector3(-0.022, my + 0.009, faceZ(0.022, my + 0.009) + 0.003), new Vector3(0, my + 0.013, mz + 0.008), new Vector3(0.022, my + 0.009, faceZ(0.022, my + 0.009) + 0.003)]);
      this.add(this.head, new TubeGeometry(mc, 10, r, 6, false), M(L.beardColor, 0.78));
    }

    // Hair and head coverings.
    const hairP = M(L.hairColor, 0.78);
    const hs = lite ? 0.5 : 1;
    const U = (n: number) => Math.max(8, Math.round(n * hs));
    switch (L.head) {
      case 'hair':
      case 'longhair': {
        const a = (phi: number) => Math.abs(phi);
        this.add(this.head, headShell(() => 0, (phi) => (fem ? 1.16 : 1.2) + 0.12 * smooth(0.2, 0.9, a(phi)) + (fem ? 0.75 : 0.35) * smooth(1.0, 1.6, a(phi)) + (fem ? 0.2 : 0.45) * smooth(1.9, 3.0, a(phi)), -Math.PI, Math.PI, fem ? 0.008 : 0.0055, U(40), U(14)), hairP);
        if (L.head === 'longhair') this.add(this.head, new CapsuleGeometry(0.05, 0.16, 4, 12).scale(1.3, 1, 0.6), hairP, 0, -0.12, -0.075);
        else if (fem) this.add(this.head, new SphereGeometry(0.038, 14, 10), hairP, 0, 0.03, -0.1);
        break;
      }
      case 'cap': {
        this.add(this.head, headShell(() => 0, () => 1.3, -Math.PI, Math.PI, 0.01, U(28), U(8)), C(L.headColor));
        this.add(this.head, new CylinderGeometry(0.075, 0.075, 0.006, 20, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.1).rotateX(0.18), C(L.headColor), 0, 0.05, 0.075);
        this.add(this.head, headShell(() => 1.3, () => 1.75, -Math.PI, -1.9, 0.004, 8, 3), hairP);
        break;
      }
      case 'kufi':
        this.add(this.head, headShell(() => 0, () => 0.95, -Math.PI, Math.PI, 0.008, U(28), 6), C('#f7f6f2'));
        this.add(this.head, headShell(() => 0.95, (phi) => 1.3 + 0.6 * Math.min(1, Math.abs(phi) / Math.PI), -Math.PI, Math.PI, 0.005, U(28), 6), hairP);
        break;
      case 'ghutra':
      case 'shemagh': {
        const red = L.head === 'shemagh';
        const m = cached(`ghutraMat${red}`, () => new MeshPhysicalMaterial({ map: ghutraTexture(red), roughness: 0.85, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new Color('#ffffff'), side: DoubleSide }));
        this.add(this.head, headShell(() => 0, (phi) => 1.1 + 0.8 * smooth(0.9, 1.7, Math.abs(phi)), -Math.PI, Math.PI, 0.011, U(40), U(12)), OWN(m));
        this.add(this.head, headDrape({ open: (v) => 0.86 + v * 0.42, top: 0.05, bottom: -0.6, spread: 1.05, tight: 1.13, folds: 1.6 }, lite), OWN(m));
        for (const dy of [0, 0.017]) this.add(this.head, new TorusGeometry(0.083, 0.0085, 8, U(40)).rotateX(Math.PI / 2).scale(0.93, 1, 1.12).rotateX(-0.14), M('#0c0c0d', 0.55), 0, 0.07 + dy, -0.008);
        break;
      }
      case 'shayla':
      case 'niqab':
      case 'hijab': {
        const color = L.head === 'hijab' ? L.headColor : '#141216';
        const p = L.head === 'hijab' ? CD(color) : SILK(color, true);
        this.add(this.head, headShell(() => 0, (phi) => 1.16 + 0.7 * smooth(0.8, 1.6, Math.abs(phi)), -Math.PI, Math.PI, 0.009, U(40), U(12)), p);
        this.add(this.head, headDrape({ open: (v) => 0.72 * (1 - smooth(0.28, 0.4, v)) + 0.02, top: 0.04, bottom: -0.42, spread: 0.85, tight: 1.12, folds: 0.6 }, lite), p);
        if (L.head === 'niqab') this.add(this.head, headShell(() => 1.62, () => 2.75, -1.25, 1.25, 0.014, 18, 8), SILK('#0f0e11', true));
        break;
      }
    }
    if (L.glasses && !lite) {
      const frame = M('#1b1b1b', 0.35);
      for (const sx of [-1, 1]) this.add(this.head, new TorusGeometry(0.017, 0.0016, 6, 20), frame, sx * 0.031, 0.011, faceZ(0.031, 0.011) + 0.008);
      this.add(this.head, new CylinderGeometry(0.0013, 0.0013, 0.026, 4).rotateZ(Math.PI / 2), frame, 0, 0.015, faceZ(0, 0.015) + 0.007);
    }
    if (L.cane) {
      const cane = new Mesh(new CylinderGeometry(0.011, 0.011, 0.9, 8).translate(0, -0.45, 0), solid('#5b3a1e', 0.5));
      cane.castShadow = true;
      this.handL.add(cane);
      this.extras.push(cane);
    }
  }

  /** Hold something in the left hand (a basket) or the right (a bag). */
  hold(kind: 'none' | 'basket' | 'bag', items = 3): void {
    this.carry?.removeFromParent();
    this.carry = null;
    if (kind === 'basket') {
      const g = new Group();
      const red = solid('#d32f2f', 0.45);
      const body = new Mesh(basketGeo(), cached('basketMat', () => new MeshStandardMaterial({ color: '#d32f2f', roughness: 0.45, side: DoubleSide })));
      body.position.y = -0.27;
      const bottomPlate = new Mesh(cached('basketBottom', () => new CylinderGeometry(0.17, 0.17, 0.01, 4).rotateY(Math.PI / 4).scale(1.25, 1, 0.75)), red);
      bottomPlate.position.y = -0.37;
      const handle = new Mesh(cached('basketHandle', () => new TorusGeometry(0.17, 0.01, 6, 20, Math.PI)), solid('#b71c1c', 0.4));
      handle.position.y = -0.17;
      g.add(body, bottomPlate, handle);
      const colors = ['#f2c230', '#1f6fd0', '#f4f4f0', '#c2302a', '#3f9150'];
      for (let i = 0; i < Math.min(5, items); i++) {
        const m = new Mesh(cached('basketItem', () => new CylinderGeometry(0.03, 0.03, 0.14, 10)), solid(colors[i], 0.5));
        m.position.set(-0.1 + i * 0.05, -0.26, (i % 2) * 0.05 - 0.02);
        g.add(m);
      }
      g.traverse((o) => (o.castShadow = true));
      this.handL.add(g);
      this.carry = g;
    } else if (kind === 'bag') {
      const g = new Group();
      const bag = new Mesh(cached('bagGeo', () => new SphereGeometry(0.16, 16, 12).scale(1, 1.25, 0.6)), cached('bagMat', () => new MeshStandardMaterial({ map: bagTexture(), roughness: 0.6, side: DoubleSide })));
      bag.position.y = -0.24;
      const handles = new Mesh(cached('bagHandles', () => new TorusGeometry(0.05, 0.008, 6, 16)), solid('#fbfbf8', 0.6));
      handles.position.y = -0.04;
      g.add(bag, handles);
      g.traverse((o) => (o.castShadow = true));
      this.handR.add(g);
      this.carry = g;
    }
  }

  /** Advance the animation. */
  update(dt: number): void {
    const p = this.pose;
    this.t += dt;
    const speed = p.speed;
    const walk = Math.min(1, speed / 1.1);
    const stride = this.child ? 1.0 : this.old ? 0.95 : 1.35;
    this.phase += (speed / stride) * Math.PI * 2 * dt;
    const ph = this.phase;

    // Legs: thigh swing, knee bend during the swing, the foot rolling heel to toe.
    for (const s of [0, 1] as const) {
      const q = ph + (s === 0 ? 0 : Math.PI);
      const thigh = Math.sin(q) * 0.42 * walk;
      const knee = Math.max(0, Math.sin(q + 1.15)) ** 1.6 * 0.95 * walk;
      this.hip[s].rotation.x = -thigh;
      this.knee[s].rotation.x = knee;
      this.ankle[s].rotation.x = (-Math.sin(q) * 0.2 - knee * 0.25) * walk;
    }
    // Pelvis bob, sway and twist; chest counter-twist; breathing.
    const breathe = Math.sin(this.t * (this.old ? 1.4 : 1.8)) * 0.012;
    this.hips.position.y = (this.child ? 0.86 : 0.94) + Math.cos(ph * 2) * 0.014 * walk - (this.old ? 0.02 : 0);
    this.hips.position.x = Math.sin(ph) * 0.016 * walk + Math.sin(this.t * 0.37) * 0.008 * (1 - walk);
    this.hips.rotation.y = Math.sin(ph) * 0.09 * walk;
    this.hips.rotation.z = Math.sin(ph) * 0.03 * walk;
    this.chest.rotation.y = -Math.sin(ph) * 0.12 * walk;
    this.chest.scale.set(1 + breathe * 0.4, 1 + breathe, 1 + breathe);
    // Stoop for the elderly, a lean into reaching.
    this.spine.rotation.x = (this.old ? 0.16 : 0.02) + p.reach * 0.18 + p.give * 0.05;

    // Arms: swing opposite the legs, or reach / give / gesture.
    if (this.gestureT > 0) this.gestureT -= dt;
    if (p.talking && this.gestureT <= 0 && Math.random() < dt * 0.5) this.gestureT = 1.2 + Math.random();
    this.gesture += ((this.gestureT > 0 && p.talking ? 1 : 0) - this.gesture) * Math.min(1, dt * 4);
    for (const s of [0, 1] as const) {
      const q = ph + (s === 0 ? Math.PI : 0);
      let sx = Math.sin(q) * 0.38 * walk;
      let el = -0.22 - Math.max(0, Math.sin(q)) * 0.25 * walk;
      let sz = (s === 0 ? 1 : -1) * 0.035;
      if (s === 1) {
        const reachAngle = p.reachY > 1.3 ? 1.9 : p.reachY > 0.95 ? 1.3 : 0.9;
        sx = sx * (1 - p.reach) - p.reach * reachAngle;
        el = el * (1 - p.reach) - p.reach * 0.25;
        sx = sx * (1 - p.give) - p.give * 1.15;
        el = el * (1 - p.give) - p.give * 0.35;
        sx -= this.gesture * 0.45 * (1 - p.give) * (1 - p.reach);
        el -= this.gesture * (1.1 + Math.sin(this.t * 3) * 0.2) * (1 - p.give) * (1 - p.reach);
        sz -= this.gesture * 0.12;
      } else if (this.carry && this.carry.parent === this.handL) {
        sx = Math.sin(q) * 0.12 * walk;
        el = -0.15;
        sz = 0.12;
      } else if (this.look.cane) {
        sx = -0.3 + Math.sin(q) * 0.2 * walk;
        el = -0.3;
      }
      this.shoulder[s].rotation.set(sx, 0, sz);
      this.elbow[s].rotation.set(el, 0, 0);
      this.wrist[s].rotation.set(s === 1 ? -p.give * 0.4 : 0, 0, 0);
    }

    // Head: look at a target (the shopkeeper), or glance around now and then.
    this.glanceT -= dt;
    if (this.glanceT <= 0) {
      this.glanceT = 1.5 + Math.random() * 4;
      this.glance = (Math.random() - 0.5) * 0.9;
    }
    let yaw = this.glance * (1 - walk * 0.6);
    let pitch = speed > 0.2 ? 0.08 : 0;
    if (p.lookAt) {
      this.head.updateWorldMatrix(true, false);
      const wp = this.head.getWorldPosition(tmpV);
      const dx = p.lookAt.x - wp.x;
      const dy = p.lookAt.y - wp.y;
      const dz = p.lookAt.z - wp.z;
      const bodyYaw = this.root.rotation.y + this.hips.rotation.y + this.chest.rotation.y;
      let a = Math.atan2(dx, dz) - bodyYaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      yaw = Math.max(-1.1, Math.min(1.1, a));
      pitch = Math.max(-0.5, Math.min(0.5, -Math.atan2(dy, Math.hypot(dx, dz))));
    }
    if (p.mood === 'sad') pitch += 0.2;
    if (p.talking) pitch += Math.sin(this.t * 4.2) * 0.03;
    this.headYaw += (yaw - this.headYaw) * Math.min(1, dt * 5);
    this.headPitch += (pitch - this.headPitch) * Math.min(1, dt * 5);
    this.neck.rotation.set(this.headPitch * 0.35, this.headYaw * 0.35, 0);
    this.head.rotation.set(this.headPitch * 0.65, this.headYaw * 0.65, Math.sin(this.t * 0.6) * 0.02);
    if (this.detail === 'lite') return;
    // Eyes follow a little further than the head; lids blink.
    for (const e of this.eyes) e.rotation.set(this.headPitch * 0.3, (yaw - this.headYaw) * 0.6 + this.headYaw * 0.1, 0);
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lidClose = Math.sin(this.blink * Math.PI);
    for (const l of this.lids) l.rotation.x = -0.12 + this.headPitch * 0.3 + lidClose * 0.62 + (p.mood === 'cross' ? 0.1 : 0);
    for (let i = 0; i < this.brows.length; i++) this.brows[i].rotation.z = p.mood === 'cross' ? (i ? -0.12 : 0.12) : p.mood === 'sad' ? (i ? 0.1 : -0.1) : 0;

    // Mouth: syllables while talking.
    if (p.talking) {
      this.talkT -= dt;
      if (this.talkT <= 0) {
        this.talkT = 0.07 + Math.random() * 0.12;
        this.open = Math.random() < 0.18 ? 0.1 : 0.35 + Math.random() * 0.65;
      }
    } else this.open = p.mood === 'happy' ? 0.15 : 0;
    if (this.mouth && this.lowerLip) {
      const cur = this.mouth.scale.y;
      this.mouth.scale.y = cur + (1 + this.open * 2.2 - cur) * Math.min(1, dt * 18);
      this.lowerLip.position.y = -0.0555 - (this.mouth.scale.y - 1) * 0.0022;
    }
    if (this.tassel) this.tassel.rotation.x = Math.sin(this.t * 3 + ph) * 0.08 * (0.3 + walk) + p.reach * 0.3;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.skinned) {
      m.geometry.dispose();
      m.skeleton.dispose();
    }
    for (const m of this.extras) m.geometry.dispose();
  }
}

function basketGeo(): BufferGeometry {
  return cached('basketGeo', () => new CylinderGeometry(0.21, 0.17, 0.2, 4, 1, true).rotateY(Math.PI / 4).scale(1.25, 1, 0.75));
}
