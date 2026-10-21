// props.js - roadside scenery and ground tiles for the six Hopinet worlds.
//
// Contains:
//  * makeGroundTile(world, len, kind)  road / gap / water ground tiles: a painted road atlas (asphalt, neon
//    asphalt, boardwalk, dirt, packed snow, sand road) with lane markings, kerbs and pavements, the land on
//    both sides (textured, vertex-coloured, with dunes / hills / beach / shoreline profile), shoreline foam,
//    near-road street furniture, and for 'gap' the broken-bridge edges (built here, no obstacles.js import).
//  * makeProps(world, side, len, rng)  one 30 m roadside chunk: per-world stamped prefabs (harbor containers,
//    cranes, lighthouse, sailboats; neon skyscrapers, billboards, monorail; coral palms, tiki bars, umbrellas;
//    jungle giant trees, ruins, mushrooms, waterfall; frost pines, igloos, cabins, snowmen; dunes arches, domes,
//    minarets, camels, tents).
//
// Technique: every prop is a "prefab" (vertex-coloured triangle soup with baked gradient + ground AO) built once
// per world and stamped into a few merged meshes per chunk (lit, double-sided lit, glow, halo, facade, blob
// shadows), so a chunk costs <= 6 draw calls and cloning a chunk is free. Chunk props stay at |x| >= 8.4 so they
// never float over the swim channel on 'water' tiles; the strip between the kerb and x = 8.4 is decorated inside
// the road / gap ground tiles (street furniture) and therefore disappears on flooded tiles.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TILE, ROAD_EDGE, GROUND_HALF, SEA_Y, WATER_Y, PHYS } from './config.js';
import { blobShadowTex, sparkTex } from './models.js';

// ===================================================================================================
// small helpers
// ===================================================================================================
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rr = (rng, a, b) => a + (b - a) * rng();
const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const PI = Math.PI, TAU = Math.PI * 2;
function hexMix(a, b, t) { _c0.set(a); _c1.set(b); _c0.lerp(_c1, t); return _c0.getHex(); }

const EMPTY = {};
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _lm = new THREE.Matrix4(), _fm = new THREE.Matrix4(), _nm = new THREE.Matrix3();
const _c0 = new THREE.Color(), _c1 = new THREE.Color();

// ===================================================================================================
// primitive cache: unit geometries converted to non-indexed arrays once
// ===================================================================================================
const primCache = new Map();
function prim(key, make) {
  let p = primCache.get(key);
  if (!p) {
    let g = make();
    if (g.index) g = g.toNonIndexed();
    g.computeBoundingBox();
    p = {
      p: g.attributes.position.array, n: g.attributes.normal.array, uv: g.attributes.uv ? g.attributes.uv.array : null,
      y0: g.boundingBox.min.y, y1: g.boundingBox.max.y, count: g.attributes.position.count,
    };
    primCache.set(key, p);
    g.dispose();
  }
  return p;
}
function toPrim(g) {
  if (g.index) g = g.toNonIndexed();
  g.computeBoundingBox();
  const p = {
    p: g.attributes.position.array, n: g.attributes.normal.array, uv: g.attributes.uv ? g.attributes.uv.array : null,
    y0: g.boundingBox.min.y, y1: g.boundingBox.max.y, count: g.attributes.position.count,
  };
  return p;
}
const P_BOX = () => prim('box', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
const P_QUAD = () => prim('quad', () => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
const P_FLAT = () => prim('flat', () => new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2));

// ===================================================================================================
// Mesher: one merged vertex-coloured mesh being assembled from transformed primitives
// ===================================================================================================
class Mesher {
  constructor(kit, o = {}) {
    this.kit = kit; this.unlit = !!o.unlit; this.rgba = !!o.rgba; this.hasUV = !!o.uv;
    this.p = []; this.n = []; this.c = []; this.uv = o.uv ? [] : null;
  }

  // Appends a transformed copy of a cached primitive. (x,y,z) position, (sx,sy,sz) scale, col colour,
  // o: ry/rx/rz rotation, top (colour at the top of the part), g gradient multipliers, ao ground-AO strength,
  // j brightness jitter, flat flat shading, rough vertex noise, a alpha, fs per-face uv scale (facade boxes).
  put(pr, x, y, z, sx, sy, sz, col, o) {
    o = o || EMPTY;
    const kit = this.kit;
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z); _s.set(sx, sy, sz);
    _lm.compose(_p, _q, _s);
    _fm.multiplyMatrices(kit.mat, _lm);
    _nm.getNormalMatrix(_fm);
    const e = _fm.elements, ne = _nm.elements;
    _c0.set(col);
    if (o.top !== undefined) _c1.set(o.top); else _c1.copy(_c0);
    const r0 = _c0.r, g0 = _c0.g, b0 = _c0.b, dr = _c1.r - r0, dg = _c1.g - g0, db = _c1.b - b0;
    const unlit = this.unlit;
    const gb = unlit ? 1 : (o.g ? o.g[0] : 0.85), gt = unlit ? 1 : (o.g ? o.g[1] : 1.05);
    const aoS = unlit ? 0 : (o.ao !== undefined ? o.ao : 0.36);
    const jit = o.j ? 1 + (kit.rng() - 0.5) * 2 * o.j : 1;
    const tc = kit.tint, tr = tc ? tc.r : 1, tg = tc ? tc.g : 1, tb = tc ? tc.b : 1;
    const gain = unlit ? 1 : GAIN;
    const rough = o.rough || 0, flat = !!o.flat;
    const al = o.a === undefined ? 1 : o.a;
    const pp = pr.p, nn = pr.n, cnt = pr.count, h = (pr.y1 - pr.y0) || 1;
    const Pa = this.p, Na = this.n, Ca = this.c, rgba = this.rgba;
    const UV = this.uv, puv = pr.uv, fs = o.fs, uo = o.uo || 0, vo = o.vo || 0;
    for (let i = 0; i < cnt; i++) {
      let px = pp[i * 3], py = pp[i * 3 + 1], pz = pp[i * 3 + 2];
      const t = (py - pr.y0) / h;
      if (rough) {
        const k = 1 + (hash3(Math.round(px * 997), Math.round(py * 997), Math.round(pz * 997)) - 0.5) * rough;
        px *= k; py *= k; pz *= k;
      }
      const wx = e[0] * px + e[4] * py + e[8] * pz + e[12];
      const wy = e[1] * px + e[5] * py + e[9] * pz + e[13];
      const wz = e[2] * px + e[6] * py + e[10] * pz + e[14];
      Pa.push(wx, wy, wz);
      const nx = nn[i * 3], ny = nn[i * 3 + 1], nz = nn[i * 3 + 2];
      let ax = ne[0] * nx + ne[3] * ny + ne[6] * nz, ay = ne[1] * nx + ne[4] * ny + ne[7] * nz, az = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const il = 1 / (Math.hypot(ax, ay, az) || 1);
      Na.push(ax * il, ay * il, az * il);
      const gm = (gb + (gt - gb) * t) * jit * gain;
      const ao = aoS ? (1 - aoS) + aoS * smooth(-0.1, 0.9, wy) : 1;
      const m = gm * ao;
      Ca.push((r0 + dr * t) * m * tr, (g0 + dg * t) * m * tg, (b0 + db * t) * m * tb);
      if (rgba) Ca.push(al);
      if (UV) {
        const f = Math.floor(i / 6);
        UV.push(puv[i * 2] * (fs ? fs[f * 2] : 1) + uo, puv[i * 2 + 1] * (fs ? fs[f * 2 + 1] : 1) + vo);
      }
      if (flat && i % 3 === 2) {
        const L = Pa.length, ox = L - 9;
        const ux = Pa[ox + 3] - Pa[ox], uy = Pa[ox + 4] - Pa[ox + 1], uz = Pa[ox + 5] - Pa[ox + 2];
        const vx = Pa[ox + 6] - Pa[ox], vy = Pa[ox + 7] - Pa[ox + 1], vz = Pa[ox + 8] - Pa[ox + 2];
        let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const f = 1 / (Math.hypot(fx, fy, fz) || 1);
        fx *= f; fy *= f; fz *= f;
        for (let k = 0; k < 3; k++) { Na[ox + k * 3] = fx; Na[ox + k * 3 + 1] = fy; Na[ox + k * 3 + 2] = fz; }
      }
    }
  }

  // ---- shapes (all base-anchored unless noted) ----
  box(x, y, z, w, h, d, c, o) { this.put(P_BOX(), x, y, z, w, h, d, c, o); }
  quad(x, y, z, w, h, c, o) { this.put(P_QUAD(), x, y, z, w, h, 1, c, o); }
  flat(x, y, z, w, d, c, o) { this.put(P_FLAT(), x, y, z, w, 1, d, c, o); }
  cyl(x, y, z, rb, rt, h, c, o) {
    const seg = (o && o.seg) || 10;
    const ratio = Math.round((rb > 0 ? rt / rb : 0) * 100) / 100;
    this.put(prim('cyl' + seg + '_' + ratio, () => new THREE.CylinderGeometry(ratio, 1, 1, seg, 1).translate(0, 0.5, 0)), x, y, z, rb * ((o && o.sx) || 1), h, rb * ((o && o.sz) || 1), c, o);
  }
  cone(x, y, z, r, h, c, o) { this.cyl(x, y, z, r, 0, h, c, o); }
  // centred sphere; o.sx/sy/sz extra axis scales
  sph(x, y, z, r, c, o) {
    const seg = (o && o.seg) || 8;
    this.put(prim('sph' + seg, () => new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.7)))), x, y, z, r * ((o && o.sx) || 1), r * ((o && o.sy) || 1), r * ((o && o.sz) || 1), c, o);
  }
  ico(x, y, z, r, c, o) {
    const d = (o && o.det !== undefined) ? o.det : 1;
    this.put(prim('ico' + d, () => new THREE.IcosahedronGeometry(1, d)), x, y, z, r * ((o && o.sx) || 1), r * ((o && o.sy) || 1), r * ((o && o.sz) || 1), c, o);
  }
  dome(x, y, z, r, c, o) {
    const seg = (o && o.seg) || 12;
    this.put(prim('dome' + seg, () => new THREE.SphereGeometry(1, seg, Math.ceil(seg / 2), 0, TAU, 0, PI / 2)), x, y, z, r * ((o && o.sx) || 1), r * ((o && o.sy) || 1), r * ((o && o.sz) || 1), c, o);
  }
  // gable roof: ridge along z, width w (x), height h, length l
  prism(x, y, z, w, h, l, c, o) {
    this.put(prim('prism', () => {
      const sh = new THREE.Shape(); sh.moveTo(-0.5, 0); sh.lineTo(0.5, 0); sh.lineTo(0, 1); sh.closePath();
      return new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
    }), x, y, z, w, h, l, c, o);
  }
  // square pyramid (hip roof)
  pyr(x, y, z, w, h, d, c, o) {
    this.put(prim('pyr', () => new THREE.CylinderGeometry(0, Math.SQRT1_2, 1, 4, 1).rotateY(PI / 4).translate(0, 0.5, 0)), x, y, z, w, h, d, c, o);
  }
  rbox(x, y, z, w, h, d, r, c, o) {
    const sg = (o && o.rs) || 1;
    const key = 'rb' + w + ',' + h + ',' + d + ',' + r + ',' + sg;
    this.put(prim(key, () => new RoundedBoxGeometry(w, h, d, sg, r).translate(0, h / 2, 0)), x, y, z, 1, 1, 1, c, o);
  }
  // torus in the XY plane (axis z); rotate with o.rx = PI/2 to lay it flat
  tor(x, y, z, R, t, c, o) {
    const ratio = Math.round((t / R) * 100) / 100;
    this.put(prim('tor' + ratio, () => new THREE.TorusGeometry(1, ratio, 5, 16)), x, y, z, R, R, R, c, o);
  }
  // semicircular arch ring in the XY plane: outer radius R, inner radius 0.62 R, depth d, base at y
  arch(x, y, z, R, d, c, o) {
    this.put(prim('arch', () => {
      const s = new THREE.Shape(); s.moveTo(-1, 0); s.absarc(0, 0, 1, PI, 0, true); s.lineTo(0.62, 0); s.absarc(0, 0, 0.62, 0, PI, false); s.closePath();
      return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -0.5);
    }), x, y, z, R, R, d, c, o);
  }
  lathe(x, y, z, pts, c, o) {
    const seg = (o && o.seg) || 12;
    this.put(prim('lat' + seg + JSON.stringify(pts), () => new THREE.LatheGeometry(pts.map((q) => new THREE.Vector2(q[0], q[1])), seg)), x, y, z, 1, 1, 1, c, o);
  }
  // tube along points [[x,y,z]...]
  tube(pts, r, c, o) {
    const segs = (o && o.segs) || pts.length * 3;
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2]))), segs, r, (o && o.rad) || 5, false);
    this.put(toPrim(geo), 0, 0, 0, 1, 1, 1, c, o);
    geo.dispose();
  }
  // raw triangle (flat shaded, for sails / flags / leaves); a,b,c are [x,y,z]
  tri(a, b, c3, col, o) {
    o = o || EMPTY;
    const kit = this.kit, m = kit.mat.elements;
    const T = (v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
    const A = T(a), B = T(b), C = T(c3);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const f = 1 / (Math.hypot(fx, fy, fz) || 1); fx *= f; fy *= f; fz *= f;
    _c0.set(col);
    if (o.top !== undefined) _c1.set(o.top); else _c1.copy(_c0);
    const tc = kit.tint, tr = tc ? tc.r : 1, tg = tc ? tc.g : 1, tb = tc ? tc.b : 1;
    const gain = this.unlit ? 1 : GAIN;
    const ys = [A[1], B[1], C[1]], ymin = Math.min(...ys), ymax = Math.max(...ys), yh = ymax - ymin || 1;
    for (let i = 0; i < 3; i++) {
      const V = [A, B, C][i];
      this.p.push(V[0], V[1], V[2]); this.n.push(fx, fy, fz);
      const t = o.tc ? o.tc[i] : (V[1] - ymin) / yh;
      const ao = this.unlit ? 1 : 0.64 + 0.36 * smooth(-0.1, 0.9, V[1]);
      this.c.push((_c0.r + (_c1.r - _c0.r) * t) * ao * tr * gain, (_c0.g + (_c1.g - _c0.g) * t) * ao * tg * gain, (_c0.b + (_c1.b - _c0.b) * t) * ao * tb * gain);
      if (this.rgba) this.c.push(o.a === undefined ? 1 : o.a);
      if (this.uv) this.uv.push(i === 1 ? 1 : 0, i === 2 ? 1 : 0);
    }
  }
  // quad from four points (two triangles)
  quad4(a, b, c3, d, col, o) {
    o = o || EMPTY;
    const tc = o.tc;
    this.tri(a, b, c3, col, tc ? Object.assign({}, o, { tc: [tc[0], tc[1], tc[2]] }) : o);
    this.tri(a, c3, d, col, tc ? Object.assign({}, o, { tc: [tc[0], tc[2], tc[3]] }) : o);
  }
  // neon sign panel (double sided) using cell (cx, cy) of the 4x4 sign atlas
  sigQuad(x, y, z, w, h, cell, col, o) {
    o = o || {};
    const cx = cell % 4, cy = Math.floor(cell / 4);
    const oo = { fs: [0.25, 0.25], uo: cx * 0.25, vo: (3 - cy) * 0.25, ry: o.ry || 0 };
    this.put(P_QUAD(), x, y, z, w, h, 1, col === undefined ? 0xffffff : col, oo);
    this.put(P_QUAD(), x, y, z, w, h, 1, col === undefined ? 0xffffff : col, { fs: oo.fs, uo: oo.uo, vo: oo.vo, ry: (o.ry || 0) + PI });
  }
  // facade box: window texture repeats every (cw x ch) metres, ncol x nrow cells per texture
  fbox(x, y, z, w, h, d, c, o) {
    o = o || {};
    const cu = 1 / (FAC_CW * FAC_N), cv = 1 / (FAC_CH * FAC_N);
    o.fs = [d * cu, h * cv, d * cu, h * cv, w * cu, d * cv, w * cu, d * cv, w * cu, h * cv, w * cu, h * cv];
    o.uo = o.uo !== undefined ? o.uo : Math.floor(this.kit.rng() * FAC_N) / FAC_N;
    o.vo = o.vo !== undefined ? o.vo : Math.floor(this.kit.rng() * FAC_N) / FAC_N;
    this.put(P_BOX(), x, y, z, w, h, d, c, o);
  }
}

// Global brightness gain for lit vertex colours (compensates the 1/pi Lambert response of r170).
let GAIN = 1.0;
const WGAIN = { harbor: 1.0, neon: 1.0, coral: 1.03, jungle: 1.1, frost: 1.0, dunes: 1.2 };
const FAC_CW = 1.5, FAC_CH = 1.7, FAC_N = 8;

const BUCKETS = ['lit', 'lit2', 'glow', 'halo', 'fac', 'sig', 'shd'];

// ===================================================================================================
// Kit: a set of buckets plus a transform stack; prefabs are frozen kits that can be stamped repeatedly
// ===================================================================================================
class Kit {
  constructor(rng) {
    this.rng = rng || Math.random;
    this.mat = new THREE.Matrix4(); this.stack = []; this.tint = null;
    this.lit = new Mesher(this); this.lit2 = new Mesher(this);
    this.glow = new Mesher(this, { unlit: true });
    this.halo = new Mesher(this, { unlit: true, rgba: true, uv: true });
    this.fac = new Mesher(this, { uv: true });
    this.sig = new Mesher(this, { unlit: true, uv: true });
    this.shd = new Mesher(this, { unlit: true, rgba: true, uv: true });
  }
  push(x = 0, y = 0, z = 0, ry = 0, s = 1, rx = 0, rz = 0) {
    this.stack.push(this.mat.clone());
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(s, s, s);
    _lm.compose(_p, _q, _s); this.mat.multiply(_lm);
    return this;
  }
  pop() { this.mat.copy(this.stack.pop()); return this; }
  with(x, y, z, ry, s, fn) { this.push(x, y, z, ry, s); fn(this); this.pop(); }

  // soft blob shadow on the ground (rx, rz radii, alpha a)
  shadow(x, z, rx, rz, a = 0.5, ry = 0, y = 0.04, col = 0x000000) { this.shd.put(P_FLAT(), x, y, z, rx * 2, 1, rz * 2, col, { ry, a, ao: 0 }); }
  // glow halo made of three crossed quads (fake bloom), colour c, radius r, alpha a
  halo_(x, y, z, r, c, a = 0.6) {
    const H = this.halo;
    H.put(P_QUAD(), x, y - r, z, r * 2, r * 2, 1, c, { a });
    H.put(P_QUAD(), x, y - r, z, r * 2, r * 2, 1, c, { a, ry: PI / 2 });
    H.put(P_FLAT(), x, y, z, r * 2, 1, r * 2, c, { a: a * 0.8 });
  }

  // freeze to typed arrays
  freeze() {
    const out = {};
    for (const b of BUCKETS) {
      const m = this[b];
      if (!m.p.length) continue;
      out[b] = { p: new Float32Array(m.p), n: new Float32Array(m.n), c: new Float32Array(m.c), uv: m.uv ? new Float32Array(m.uv) : null, rgba: m.rgba };
    }
    return out;
  }

  // append a frozen prefab at (x,y,z) with yaw ry and uniform scale s; tint multiplies lit colours
  stamp(pf, x, y, z, ry = 0, s = 1, tint = null) {
    _e.set(0, ry, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(s, s, s);
    _lm.compose(_p, _q, _s); _fm.multiplyMatrices(this.mat, _lm); _nm.getNormalMatrix(_fm);
    const e = _fm.elements, ne = _nm.elements;
    const tr = tint ? tint.r : 1, tg = tint ? tint.g : 1, tb = tint ? tint.b : 1;
    for (const b of BUCKETS) {
      const src = pf[b]; if (!src) continue;
      const dst = this[b], sp = src.p, sn = src.n, sc = src.c, su = src.uv, cs = src.rgba ? 4 : 3;
      const tinted = tint && (b === 'lit' || b === 'lit2' || b === 'fac');
      const Pa = dst.p, Na = dst.n, Ca = dst.c, Ua = dst.uv;
      const n = sp.length / 3;
      for (let i = 0; i < n; i++) {
        const px = sp[i * 3], py = sp[i * 3 + 1], pz = sp[i * 3 + 2];
        Pa.push(e[0] * px + e[4] * py + e[8] * pz + e[12], e[1] * px + e[5] * py + e[9] * pz + e[13], e[2] * px + e[6] * py + e[10] * pz + e[14]);
        const nx = sn[i * 3], ny = sn[i * 3 + 1], nz = sn[i * 3 + 2];
        const ax = ne[0] * nx + ne[3] * ny + ne[6] * nz, ay = ne[1] * nx + ne[4] * ny + ne[7] * nz, az = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        const il = 1 / (Math.hypot(ax, ay, az) || 1);
        Na.push(ax * il, ay * il, az * il);
        if (tinted) Ca.push(sc[i * cs] * tr, sc[i * cs + 1] * tg, sc[i * cs + 2] * tb);
        else Ca.push(sc[i * cs], sc[i * cs + 1], sc[i * cs + 2]);
        if (cs === 4) Ca.push(sc[i * cs + 3]);
        if (Ua) Ua.push(su[i * 2], su[i * 2 + 1]);
      }
    }
  }

  // build meshes into a group
  build(group, mats) {
    for (const b of BUCKETS) {
      const m = this[b];
      if (!m.p.length || !mats[b]) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.p), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m.n), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.c), m.rgba ? 4 : 3));
      if (m.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(m.uv), 2));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats[b]);
      mesh.name = 'props_' + b;
      if (b === 'shd') mesh.renderOrder = 1;
      if (b === 'halo') mesh.renderOrder = 3;
      group.add(mesh);
    }
  }
}

// ===================================================================================================
// shared materials
// ===================================================================================================
let _mats = null;
function sharedMats() {
  if (_mats) return _mats;
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lit2 = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const halo = new THREE.MeshBasicMaterial({ vertexColors: true, map: sparkTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shd = new THREE.MeshBasicMaterial({ vertexColors: true, map: blobShadowTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  _mats = { lit, lit2, glow, halo, shd, fac: null, sig: null };
  return _mats;
}

// ===================================================================================================
// canvas textures
// ===================================================================================================
const texCache = new Map();
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const css = (n, a) => (a === undefined || a >= 1) ? '#' + n.toString(16).padStart(6, '0') : `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
function shadeHex(n, f) {
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255), gg = clamp(Math.round(((n >> 8) & 255) * f), 0, 255), b = clamp(Math.round((n & 255) * f), 0, 255);
  return (r << 16) | (gg << 8) | b;
}
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}
function makeTex(cv, repeat, aniso = 4) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// luminance noise on a rectangle: a small pre-made noise tile blended with 'overlay' (much cheaper than per-pixel JS)
let _noiseCv = null;
function grain(g, x, y, w, h, amt, rng) {
  if (!_noiseCv) {
    _noiseCv = mkCanvas(128, 128);
    const ng = _noiseCv.getContext('2d'), im = ng.createImageData(128, 128), d = im.data, r = mulberry(4242);
    for (let i = 0; i < d.length; i += 4) { const v = 40 + r() * 175; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ng.putImageData(im, 0, 0);
  }
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = clamp(amt / 70, 0, 1);
  g.fillStyle = g.createPattern(_noiseCv, 'repeat');
  g.fillRect(x, y, w, h);
  g.restore();
}
// radial blob (wrapped vertically when wrapH is given)
function blob(g, x, y, r, col, a, wrapH) {
  const draw = (yy) => {
    const gr = g.createRadialGradient(x, yy, 0, x, yy, r);
    gr.addColorStop(0, css(col, a)); gr.addColorStop(1, css(col, 0));
    g.fillStyle = gr; g.fillRect(x - r, yy - r, r * 2, r * 2);
  };
  draw(y);
  if (wrapH) { if (y < r) draw(y + wrapH); if (y > wrapH - r) draw(y - wrapH); }
}
// soft vertical band (horizontal gradient) between x0..x1
function band(g, x0, x1, H, col, a, soft) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, css(col, 0)); gr.addColorStop(soft, css(col, a)); gr.addColorStop(1 - soft, css(col, a)); gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr; g.fillRect(x0, 0, x1 - x0, H);
}
function pavers(g, x0, x1, H, size, base, rng, joint, vary = 0.07, jw = 1.6, offsetRows = true) {
  const rows = Math.ceil(H / size);
  for (let r = 0; r < rows; r++) {
    const off = offsetRows && r % 2 ? size / 2 : 0;
    for (let x = x0 - off; x < x1; x += size) {
      const f = 1 + (rng() - 0.5) * vary * 2;
      g.fillStyle = css(shadeHex(base, f));
      const xa = Math.max(x, x0), xb = Math.min(x + size, x1);
      g.fillRect(xa, r * size, xb - xa, size);
      g.fillStyle = css(joint, 0.5);
      g.fillRect(xa, r * size, xb - xa, jw);
      if (x >= x0) g.fillRect(x, r * size, jw, size);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// road atlas: x from -5.7 to +5.7 m, z from 0 to -30 m (canvas top = z 0). Returns { map, emissive }.
// ---------------------------------------------------------------------------------------------------
function roadAtlas(world) {
  const key = 'road' + world.id;
  if (texCache.has(key)) return texCache.get(key);
  const W = 512, H = 1536, S = W / 11.4, PM = H / 30;
  const X = (m) => (m + 5.7) * S;
  const rng = mulberry(hashStr(world.id) + 11);
  const cv = mkCanvas(W, H), g = cv.getContext('2d');
  const neon = world.id === 'neon';
  const ecv = neon ? mkCanvas(W, H) : null, eg = ecv ? ecv.getContext('2d') : null;
  if (eg) { eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H); }
  const R = world.road, SD = world.side, LN = world.line, id = world.id;
  const rL = X(-4.3), rR = X(4.3), rW = rR - rL;
  const laneX = [-2.4, 0, 2.4];

  // ---------- pavement (outside |x| 4.3) ----------
  g.fillStyle = css(SD); g.fillRect(0, 0, W, H);
  const pave = (x0, x1) => {
    if (id === 'harbor') pavers(g, x0, x1, H, 0.7 * S, SD, rng, shadeHex(SD, 0.6), 0.05, 1.8, false);
    else if (id === 'neon') pavers(g, x0, x1, H, 0.7 * S, SD, rng, 0x1a1238, 0.10, 2.2, false);
    else if (id === 'coral') pavers(g, x0, x1, H, 0.46 * S, SD, rng, shadeHex(SD, 0.7), 0.07, 1.6, true);
    else if (id === 'jungle') {
      g.fillStyle = css(shadeHex(SD, 0.8)); g.fillRect(x0, 0, x1 - x0, H);
      for (let i = 0; i < 520; i++) {
        const x = x0 + rng() * (x1 - x0), y = rng() * H, r = (0.1 + rng() * 0.12) * S;
        g.fillStyle = css(shadeHex(rng() < 0.55 ? 0x8b8f86 : SD, 0.8 + rng() * 0.35));
        g.beginPath(); g.ellipse(x, y, r, r * 0.8, rng() * 3, 0, TAU); g.fill();
        g.strokeStyle = css(0x2a3a1a, 0.4); g.lineWidth = 1.5; g.stroke();
      }
    } else if (id === 'frost') {
      g.fillStyle = css(SD); g.fillRect(x0, 0, x1 - x0, H);
      for (let i = 0; i < 90; i++) blob(g, x0 + rng() * (x1 - x0), rng() * H, (0.3 + rng() * 0.5) * S, rng() < 0.5 ? 0xffffff : 0xb9d0ea, 0.45, H);
    } else pavers(g, x0, x1, H, 0.56 * S, SD, rng, shadeHex(SD, 0.62), 0.07, 1.8, true);
  };
  pave(0, rL); pave(rR, W);

  // ---------- road surface ----------
  if (id === 'coral') {
    // wooden boardwalk, planks along the direction of travel with staggered butt joints
    const nP = 28, pw = rW / nP;
    for (let i = 0; i < nP; i++) {
      const x = rL + i * pw;
      let y = -rng() * 2.4 * PM;
      while (y < H) {
        const len = (2.0 + rng() * 3.4) * PM;
        const f = 0.88 + rng() * 0.22, warm = rng() * 0.08;
        g.fillStyle = css(mixHex(shadeHex(R, f), 0xc98b4c, warm));
        g.fillRect(x, y, pw, len);
        // grain
        for (let k = 0; k < 3; k++) { g.fillStyle = css(0x6b4420, 0.10 + rng() * 0.08); g.fillRect(x + rng() * pw, y, 1.2, len); }
        g.fillStyle = css(0x4a2e14, 0.55); g.fillRect(x, y, pw, 2.2);
        g.fillStyle = css(0x2e1a0a, 0.8); g.beginPath(); g.arc(x + pw * 0.28, y + 7, 1.8, 0, TAU); g.arc(x + pw * 0.72, y + 7, 1.8, 0, TAU); g.fill();
        y += len;
      }
      g.fillStyle = css(0x3b2410, 0.65); g.fillRect(x, 0, 1.8, H);
    }
  } else {
    g.fillStyle = css(R); g.fillRect(rL, 0, rW, H);
    if (id === 'neon') {
      const gr = g.createLinearGradient(rL, 0, rR, 0);
      gr.addColorStop(0, css(0x1a1a34)); gr.addColorStop(0.5, css(0x34345a)); gr.addColorStop(1, css(0x1a1a34));
      g.fillStyle = gr; g.fillRect(rL, 0, rW, H);
      for (const lx of laneX) band(g, X(lx - 1.0), X(lx + 1.0), H, 0x7b61ff, 0.10, 0.5);
    }
  }
  // large soft tonal variation
  for (let i = 0; i < 34; i++) {
    const dark = rng() < 0.5;
    blob(g, rL + rng() * rW, rng() * H, (0.8 + rng() * 2.2) * S, dark ? 0x000000 : 0xffffff, id === 'neon' ? 0.05 : (dark ? 0.07 : 0.05), H);
  }
  if (id === 'jungle' || id === 'dunes' || id === 'frost') {
    // texture details of soft ground roads
    const n = id === 'frost' ? 700 : 900;
    for (let i = 0; i < n; i++) {
      const x = rL + rng() * rW, y = rng() * H;
      if (id === 'jungle') {
        const r = (0.03 + rng() * 0.07) * S;
        g.fillStyle = css(rng() < 0.5 ? 0x5a4126 : (rng() < 0.5 ? 0xa4875c : 0x6f8f3a), 0.55);
        g.beginPath(); g.ellipse(x, y, r * 1.4, r, rng() * 3, 0, TAU); g.fill();
      } else if (id === 'dunes') {
        const r = (0.02 + rng() * 0.045) * S;
        g.fillStyle = css(rng() < 0.5 ? 0xa97a44 : 0xf0cc94, 0.45);
        g.beginPath(); g.ellipse(x, y, r * 1.8, r, rng() * 3, 0, TAU); g.fill();
      } else {
        const r = (0.015 + rng() * 0.04) * S;
        g.fillStyle = css(rng() < 0.7 ? 0xffffff : 0x8aa6c4, 0.55);
        g.beginPath(); g.ellipse(x, y, r * 1.6, r, rng() * 3, 0, TAU); g.fill();
      }
    }
    if (id === 'dunes') {
      // wind ripples
      g.lineWidth = 2.2;
      for (let i = 0; i < 110; i++) {
        const y0 = rng() * H, x0 = rL + rng() * rW * 0.8, len = (1.5 + rng() * 3) * S;
        g.strokeStyle = css(rng() < 0.5 ? 0xf6d8aa : 0x9c6d3a, 0.3);
        g.beginPath(); g.moveTo(x0, y0);
        for (let k = 1; k <= 8; k++) g.lineTo(x0 + len * k / 8, y0 + Math.sin(k * 1.1 + i) * 6);
        g.stroke();
      }
    }
  }
  // vehicle tracks
  const trackCol = id === 'frost' ? 0x6c829c : id === 'neon' ? 0x000000 : id === 'jungle' ? 0x4a3420 : id === 'dunes' ? 0x8a5f33 : id === 'coral' ? 0x6b4420 : 0x000000;
  const trackA = id === 'jungle' ? 0.28 : id === 'frost' ? 0.30 : id === 'coral' ? 0.10 : id === 'dunes' ? 0.22 : 0.14;
  for (const lx of laneX) for (const o of [-0.62, 0.62]) band(g, X(lx + o - 0.24), X(lx + o + 0.24), H, trackCol, trackA, 0.42);
  grain(g, rL, 0, rW, H, id === 'neon' ? 10 : 15, rng);

  // cracks, patches, manholes (asphalt styles)
  if (id === 'harbor' || id === 'neon') {
    for (let i = 0; i < 6; i++) {
      let x = rL + rng() * rW, y = rng() * H;
      g.strokeStyle = css(id === 'neon' ? 0x7b61ff : 0x000000, id === 'neon' ? 0.22 : 0.28); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += (rng() - 0.5) * 22; y += 10 + rng() * 16; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle = css(0x000000, 0.08);
      g.fillRect(rL + rng() * (rW - 90), rng() * (H - 120), 50 + rng() * 80, 60 + rng() * 120);
    }
  }

  // ---------- kerbs (light stone lines at the road edge and the pavement edge) ----------
  const kerb = id === 'neon' ? 0x5a4aa0 : id === 'frost' ? 0xf4f8ff : shadeHex(SD, 1.08);
  for (const sgn of [-1, 1]) {
    const kx = sgn < 0 ? X(-4.38) : X(4.3);
    g.fillStyle = css(kerb); g.fillRect(kx, 0, 0.08 * S, H);
    g.fillStyle = css(shadeHex(kerb, 0.8), 0.9);
    const ox = sgn < 0 ? X(-5.7) : X(5.58);
    g.fillRect(ox, 0, 0.12 * S, H);
    // shadow line where the road meets the kerb
    g.fillStyle = css(0x000000, 0.18);
    g.fillRect(sgn < 0 ? X(-4.3) - 0.28 * S : X(4.3) + 0.08 * S, 0, 0.0, H);
  }
  // edge darkening along the raised pavement
  for (const sgn of [-1, 1]) band(g, sgn < 0 ? X(-4.3) : X(4.38), sgn < 0 ? X(-4.22) : X(4.46), H, 0x000000, 0.0, 0.5);

  // ---------- markings ----------
  const dashes = (x, w, col, a, ctx, dashLen, period, off) => {
    ctx.fillStyle = css(col, a);
    for (let z = off; z < 30; z += period) ctx.fillRect(X(x) - w * S / 2, z * PM, w * S, dashLen * PM);
  };
  const worn = (ctx, x0, x1) => {
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { ctx.fillStyle = 'rgba(0,0,0,' + (0.25 + rng() * 0.4) + ')'; ctx.fillRect(x0 + rng() * (x1 - x0), rng() * H, 1 + rng() * 3, 1 + rng() * 6); }
    ctx.restore();
  };
  if (id === 'harbor' || id === 'frost' || id === 'neon' || id === 'coral') {
    const lw = id === 'coral' ? 0.13 : 0.15;
    const target = g;
    const draw = (ctx, glow) => {
      for (const sgn of [-1, 1]) {
        // solid edge line
        ctx.fillStyle = css(glow ? 0xff3df2 : (id === 'neon' ? 0xff3df2 : LN), id === 'neon' ? 1 : 0.94);
        ctx.fillRect(X(sgn * 3.98) - lw * S / 2, 0, lw * S, H);
        // lane dashes
        dashes(sgn * 1.2, lw, glow ? LN : LN, id === 'harbor' ? 0.92 : 0.95, ctx, 3.0, 6, 0.75);
      }
    };
    if (id === 'neon') {
      // glow pass on the emissive canvas
      eg.shadowColor = css(0x39f3ff); eg.shadowBlur = 16;
      draw(eg, true);
      eg.shadowBlur = 0;
      // sidewalk edge light strips
      eg.fillStyle = css(0xff3df2); eg.shadowColor = css(0xff3df2); eg.shadowBlur = 14;
      for (const sgn of [-1, 1]) eg.fillRect(sgn < 0 ? X(-4.36) : X(4.3), 0, 0.06 * S, H);
      eg.shadowBlur = 0;
      // base map gets the same lines (so it reads even when emissive is dim)
      draw(g, false);
      g.fillStyle = css(0xff3df2); for (const sgn of [-1, 1]) g.fillRect(sgn < 0 ? X(-4.36) : X(4.3), 0, 0.06 * S, H);
      // faint tech grid on the road
      g.strokeStyle = css(0x39f3ff, 0.07); g.lineWidth = 1;
      for (let z = 0; z < 30; z += 1.5) { g.beginPath(); g.moveTo(rL, z * PM); g.lineTo(rR, z * PM); g.stroke(); }
    } else draw(g, false);
    worn(g, rL, rR);
  } else if (id === 'jungle') {
    // row of flat stones as lane markers
    for (const sgn of [-1, 1]) for (let z = 0.3; z < 30; z += 0.95) {
      const x = X(sgn * 1.2), y = z * PM, w = (0.12 + rng() * 0.06) * S, h = (0.34 + rng() * 0.2) * PM;
      g.fillStyle = css(0x000000, 0.25); g.beginPath(); g.ellipse(x + 2, y + 2, w * 0.75, h * 0.56, 0, 0, TAU); g.fill();
      g.fillStyle = css(shadeHex(LN, 0.88 + rng() * 0.3)); g.beginPath(); g.ellipse(x, y, w * 0.7, h * 0.52, 0, 0, TAU); g.fill();
      g.fillStyle = css(0xffffff, 0.18); g.beginPath(); g.ellipse(x - 2, y - 2, w * 0.4, h * 0.3, 0, 0, TAU); g.fill();
    }
    // grassy edges
    for (const sgn of [-1, 1]) for (let i = 0; i < 120; i++) {
      const x = X(sgn * (4.05 + rng() * 0.3)), y = rng() * H, r = (0.05 + rng() * 0.1) * S;
      g.fillStyle = css(rng() < 0.5 ? 0x4f8f2c : 0x78b040, 0.8); g.beginPath(); g.ellipse(x, y, r, r * 1.6, rng() * 3, 0, TAU); g.fill();
    }
  } else if (id === 'dunes') {
    for (const sgn of [-1, 1]) {
      // sandstone brick border
      for (let z = 0; z < 30; z += 0.5) {
        const x = X(sgn * 4.05), y = z * PM;
        g.fillStyle = css(shadeHex(0xe0ac6a, 0.9 + rng() * 0.2)); g.fillRect(x - 0.24 * S, y, 0.48 * S, 0.5 * PM);
        g.fillStyle = css(0x6b4420, 0.5); g.fillRect(x - 0.24 * S, y, 0.48 * S, 1.6); g.fillRect(x - 0.24 * S, y, 1.6, 0.5 * PM);
      }
      // cream stone dashes
      for (let z = 0.75; z < 30; z += 6) {
        const x = X(sgn * 1.2), y = z * PM;
        g.fillStyle = css(0x000000, 0.2); g.fillRect(x - 0.09 * S + 2, y + 2, 0.18 * S, 3 * PM);
        g.fillStyle = css(LN); g.fillRect(x - 0.09 * S, y, 0.18 * S, 3 * PM);
        g.fillStyle = css(0xc9935a, 0.5); for (let k = 1; k < 6; k++) g.fillRect(x - 0.09 * S, y + k * 0.5 * PM, 0.18 * S, 1.4);
      }
    }
  }
  if (id === 'frost') {
    // snow banks softening the road edges
    for (const sgn of [-1, 1]) for (let i = 0; i < 60; i++) blob(g, X(sgn * (4.2 - rng() * 0.5)), rng() * H, (0.25 + rng() * 0.3) * S, 0xffffff, 0.5, H);
  }
  if (id === 'harbor') {
    // painted chevrons on the pavement edge (bollard line) and drains
    for (const sgn of [-1, 1]) for (let z = 3; z < 30; z += 7.5) {
      g.fillStyle = css(0x2f3640, 0.8); g.fillRect(X(sgn * 4.95) - 0.22 * S, z * PM, 0.44 * S, 0.1 * PM);
    }
  }
  const map = makeTex(cv, false, 8);
  const out = { map, emissive: ecv ? makeTex(ecv, false, 4) : null };
  texCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// seamless land textures (repeat every 7.5 m)
// ---------------------------------------------------------------------------------------------------
function landTexture(kind, base) {
  const key = 'land' + kind + base;
  if (texCache.has(key)) return texCache.get(key);
  const N = 256, rng = mulberry(hashStr(key));
  const cv = mkCanvas(N, N), g = cv.getContext('2d');
  g.fillStyle = css(base); g.fillRect(0, 0, N, N);
  const wrapDraw = (x, y, r, fn) => {
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) { if (x + dx < -r || x + dx > N + r || y + dy < -r || y + dy > N + r) continue; fn(x + dx, y + dy); }
  };
  const dots = (n, rmin, rmax, cols, a, squash = 1) => {
    for (let i = 0; i < n; i++) {
      const x = rng() * N, y = rng() * N, r = rmin + rng() * (rmax - rmin), c = cols[Math.floor(rng() * cols.length)], rot = rng() * 3;
      wrapDraw(x, y, r * 2, (xx, yy) => { g.fillStyle = css(c, a); g.beginPath(); g.ellipse(xx, yy, r, r * squash, rot, 0, TAU); g.fill(); });
    }
  };
  if (kind === 'grass') {
    dots(60, 14, 38, [shadeHex(base, 0.88), shadeHex(base, 1.1)], 0.22);
    // mowing bands
    for (let i = 0; i < 4; i++) { g.fillStyle = css(0xffffff, i % 2 ? 0.05 : 0.0); g.fillRect(0, i * N / 4, N, N / 4); g.fillStyle = css(0x000000, i % 2 ? 0 : 0.04); g.fillRect(0, i * N / 4, N, N / 4); }
    g.lineWidth = 1.4;
    for (let i = 0; i < 1100; i++) {
      const x = rng() * N, y = rng() * N, l = 3 + rng() * 5, c = rng() < 0.5 ? shadeHex(base, 0.78) : shadeHex(base, 1.22);
      wrapDraw(x, y, 8, (xx, yy) => { g.strokeStyle = css(c, 0.55); g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + (rng() - 0.5) * 3, yy - l); g.stroke(); });
    }
    dots(26, 1.4, 2.6, [0xffffff, 0xfff27a, 0xffb3d1], 0.9);
  } else if (kind === 'moss') {
    dots(120, 10, 34, [shadeHex(base, 0.7), shadeHex(base, 1.25), 0x2f6b2a], 0.25);
    for (let i = 0; i < 700; i++) {
      const x = rng() * N, y = rng() * N, c = rng() < 0.5 ? shadeHex(base, 0.6) : shadeHex(base, 1.4);
      wrapDraw(x, y, 8, (xx, yy) => { g.strokeStyle = css(c, 0.6); g.lineWidth = 1.5; g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + (rng() - 0.5) * 6, yy - 3 - rng() * 6); g.stroke(); });
    }
    dots(40, 2, 4, [0x8a6a3a, 0xc2a35a, 0x6d4c41], 0.7, 0.6);
    dots(10, 1.6, 2.6, [0xffd54a, 0xff6f91, 0xffffff], 0.9);
  } else if (kind === 'sand' || kind === 'desert') {
    dots(70, 14, 40, [shadeHex(base, 0.92), shadeHex(base, 1.08)], 0.25);
    g.lineWidth = 1.6;
    const amp = kind === 'desert' ? 5 : 3;
    for (let i = 0; i < 26; i++) {
      const y0 = (i / 26) * N + rng() * 4, c = i % 2 ? shadeHex(base, 0.86) : shadeHex(base, 1.14);
      g.strokeStyle = css(c, 0.32); g.beginPath();
      for (let x = 0; x <= N; x += 8) { const y = y0 + Math.sin(x / N * TAU * 2 + i) * amp; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    if (kind === 'sand') dots(26, 1.2, 2.4, [0xffffff, 0xffb3a0, 0xffe0f0], 0.8, 0.7);
  } else if (kind === 'snow') {
    dots(90, 16, 46, [0xffffff, shadeHex(base, 0.93), 0xdcebfb], 0.28);
    dots(160, 0.7, 1.5, [0xffffff, 0xaed4ff], 0.95);
    g.lineWidth = 1.2;
    for (let i = 0; i < 60; i++) {
      const x = rng() * N, y = rng() * N, l = 10 + rng() * 22;
      wrapDraw(x, y, 30, (xx, yy) => { g.strokeStyle = css(0x9bbbe0, 0.22); g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + l / 2, yy - 4, xx + l, yy); g.stroke(); });
    }
  } else if (kind === 'plaza') {
    const n = 4, s = N / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = css(shadeHex(base, 0.94 + rng() * 0.12)); g.fillRect(i * s, j * s, s, s);
      g.fillStyle = css(0xffffff, 0.12); g.fillRect(i * s, j * s, s, 3);
    }
    g.fillStyle = css(shadeHex(base, 0.62), 0.7);
    for (let i = 0; i <= n; i++) { g.fillRect(i * s - 1.5, 0, 3, N); g.fillRect(0, i * s - 1.5, N, 3); }
    dots(60, 1, 3, [shadeHex(base, 0.7), shadeHex(base, 1.2)], 0.4);
    g.strokeStyle = css(0x000000, 0.18); g.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) { let x = rng() * N, y = rng() * N; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rng() - 0.5) * 18; y += 6 + rng() * 10; g.lineTo(x, y); } g.stroke(); }
  } else if (kind === 'neonplaza') {
    g.fillStyle = css(shadeHex(base, 0.9)); g.fillRect(0, 0, N, N);
    const n = 4, s = N / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = css(shadeHex(base, 0.9 + rng() * 0.3)); g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    g.fillStyle = css(0x39f3ff, 0.35);
    for (let i = 0; i <= n; i += 2) { g.fillRect(i * s - 1, 0, 2, N); }
    g.fillStyle = css(0xff3df2, 0.30);
    for (let j = 0; j <= n; j += 2) { g.fillRect(0, j * s - 1, N, 2); }
    dots(40, 1, 2, [0x39f3ff, 0xff3df2, 0xffffff], 0.5);
  } else if (kind === 'wetsand') {
    dots(60, 10, 30, [shadeHex(base, 0.9), shadeHex(base, 1.1)], 0.3);
  }
  grain(g, 0, 0, N, N, kind === 'snow' ? 6 : 10, rng);
  const t = makeTex(cv, true, 8);
  texCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------------------------------
// neon facade + sign atlases
// ---------------------------------------------------------------------------------------------------
function facadeTextures() {
  if (texCache.has('facade')) return texCache.get('facade');
  const N = FAC_N, C = 64, rng = mulberry(777);
  const cv = mkCanvas(N * C, N * C), g = cv.getContext('2d');
  const ecv = mkCanvas(N * C, N * C), eg = ecv.getContext('2d');
  g.fillStyle = css(0x2a2358); g.fillRect(0, 0, N * C, N * C);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, N * C, N * C);
  const lit = [0xffd37a, 0x6ff6ff, 0xff6ee8, 0xfff2c9, 0x9d7bff, 0x7dffb3];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = c * C, y = r * C;
      const gr = g.createLinearGradient(0, y, 0, y + C);
      gr.addColorStop(0, css(0x332c6a)); gr.addColorStop(1, css(0x241e4e));
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      g.fillStyle = css(0x4a3f88, 0.9); g.fillRect(x, y, C, 2.5);      // floor slab line
      g.fillStyle = css(0x1c1740, 0.8); g.fillRect(x, y + C - 2, C, 2);
      const wx = x + 7, wy = y + 11, ww = C - 14, wh = C - 24;
      const on = rng() < 0.5;
      if (on) {
        const col = lit[Math.floor(rng() * lit.length)];
        g.fillStyle = css(col, 0.95); g.fillRect(wx, wy, ww, wh);
        eg.fillStyle = css(col, 0.95); eg.fillRect(wx, wy, ww, wh);
        eg.fillStyle = css(0xffffff, 0.25); eg.fillRect(wx, wy, ww, 4);
      } else {
        g.fillStyle = css(0x161436); g.fillRect(wx, wy, ww, wh);
        g.fillStyle = css(0x6a5fd0, 0.25); g.fillRect(wx, wy, ww * 0.5, 3);
      }
      g.fillStyle = css(0x120f2e); g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
    }
  }
  // glowing vertical accent strips on a couple of columns
  for (const c of [1, 5]) { g.fillStyle = css(0x39f3ff, 0.85); g.fillRect(c * C + C - 4, 0, 3, N * C); eg.fillStyle = css(0x39f3ff, 0.9); eg.fillRect(c * C + C - 4, 0, 3, N * C); }
  for (const c of [3]) { g.fillStyle = css(0xff3df2, 0.85); g.fillRect(c * C + C - 4, 0, 3, N * C); eg.fillStyle = css(0xff3df2, 0.9); eg.fillRect(c * C + C - 4, 0, 3, N * C); }
  const out = { map: makeTex(cv, true, 8), emissive: makeTex(ecv, true, 4) };
  texCache.set('facade', out);
  return out;
}

// 4 x 4 atlas of abstract neon icons (symmetric, so mirrored chunks still read well)
function signAtlas() {
  if (texCache.has('sign')) return texCache.get('sign');
  const N = 4, C = 128, cv = mkCanvas(N * C, N * C), g = cv.getContext('2d');
  const cols = [0xff3df2, 0x39f3ff, 0xffe14d, 0x3dff9a];
  const icons = [
    (c, r) => { g.beginPath(); g.arc(0, 0, r * 0.7, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.35, 0, TAU); g.stroke(); },
    (c, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, rad = i % 2 ? r * 0.35 : r * 0.78; g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); } g.closePath(); g.stroke(); },
    (c, r) => { g.beginPath(); g.moveTo(0, r * 0.7); g.bezierCurveTo(-r * 1.1, -r * 0.1, -r * 0.5, -r * 0.9, 0, -r * 0.35); g.bezierCurveTo(r * 0.5, -r * 0.9, r * 1.1, -r * 0.1, 0, r * 0.7); g.stroke(); },
    (c, r) => { g.beginPath(); g.moveTo(-r * 0.8, 0); for (let i = 0; i <= 16; i++) g.lineTo(-r * 0.8 + i * r * 0.1, Math.sin(i * 0.8) * r * 0.3); g.stroke(); g.beginPath(); g.moveTo(-r * 0.8, r * 0.4); for (let i = 0; i <= 16; i++) g.lineTo(-r * 0.8 + i * r * 0.1, r * 0.4 + Math.sin(i * 0.8) * r * 0.3); g.stroke(); },
    (c, r) => { g.beginPath(); g.moveTo(0, -r * 0.8); g.lineTo(r * 0.8, 0); g.lineTo(0, r * 0.8); g.lineTo(-r * 0.8, 0); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, -r * 0.4); g.lineTo(r * 0.4, 0); g.lineTo(0, r * 0.4); g.lineTo(-r * 0.4, 0); g.closePath(); g.stroke(); },
    (c, r) => { for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-r * 0.6, -r * 0.55 + k * r * 0.55); g.lineTo(0, -r * 0.1 + k * r * 0.55); g.lineTo(r * 0.6, -r * 0.55 + k * r * 0.55); g.stroke(); } },
    (c, r) => { g.beginPath(); g.moveTo(-r * 0.6, -r * 0.7); g.lineTo(r * 0.6, -r * 0.7); g.lineTo(0, 0.1 * r); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, 0.1 * r); g.lineTo(0, r * 0.65); g.moveTo(-r * 0.4, r * 0.7); g.lineTo(r * 0.4, r * 0.7); g.stroke(); },
    (c, r) => { g.beginPath(); g.arc(0, 0, r * 0.75, 0.3, PI * 2 - 0.3); g.stroke(); g.beginPath(); g.arc(-r * 0.2, -r * 0.1, r * 0.1, 0, TAU); g.fill(); g.beginPath(); g.arc(r * 0.3, -r * 0.1, r * 0.1, 0, TAU); g.fill(); },
  ];
  for (let i = 0; i < N * N; i++) {
    const cx = (i % N) * C, cy = Math.floor(i / N) * C, col = cols[i % cols.length];
    g.fillStyle = css(0x120c2c); g.fillRect(cx, cy, C, C);
    g.strokeStyle = css(col, 0.9); g.lineWidth = 3; g.strokeRect(cx + 6, cy + 6, C - 12, C - 12);
    g.save(); g.translate(cx + C / 2, cy + C / 2);
    g.strokeStyle = css(col); g.fillStyle = css(col); g.lineWidth = 6; g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = css(col); g.shadowBlur = 14;
    icons[i % icons.length](col, C * 0.34);
    g.restore();
  }
  const t = makeTex(cv, false, 4);
  t.wrapT = THREE.ClampToEdgeWrapping;
  texCache.set('sign', t);
  return t;
}

// ===================================================================================================
// geometry builder for ground meshes (explicit vertices, optional colours / uvs)
// ===================================================================================================
class GB {
  constructor(o = {}) { this.p = []; this.n = []; this.u = []; this.c = o.col ? [] : null; this.c4 = !!o.rgba; }
  v(p, n, uv, c) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    if (this.c) { this.c.push(c[0], c[1], c[2]); if (this.c4) this.c.push(c.length > 3 ? c[3] : 1); }
  }
  // quad a,b,c,d (any winding); the winding is fixed to face n. attrs: per-vertex arrays optional.
  quad(a, b, c, d, n, uvs, cols, ns) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const dot = cx * n[0] + cy * n[1] + cz * n[2];
    const P = [a, b, c, d], I = dot >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 3, 2, 0, 2, 1];
    for (const i of I) this.v(P[i], ns ? ns[i] : n, uvs ? uvs[i] : null, cols ? cols[i] : null);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.u), 2));
    if (this.c) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), this.c4 ? 4 : 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ===================================================================================================
// terrain model: shore profile + hills, shared by the ground tiles and the prop placement
// ===================================================================================================
const SHORE_PTS = {
  beach: [[-3.4, 0], [-2.2, -0.1], [-1.1, -0.45], [-0.2, -0.95], [0.8, -1.5]],
  bank: [[-4.0, 0], [-2.6, -0.18], [-1.5, -0.55], [-0.6, -1.0], [0.6, -1.5]],
  wall: [[-1.3, 0], [-1.0, 0], [-0.9, -0.05], [-0.8, -0.2], [-0.76, -0.9], [-0.74, -1.5]],
  cliff: [[-2.2, 0], [-1.2, 0.03], [-0.9, -0.08], [-0.6, -0.5], [-0.5, -1.0], [-0.45, -1.5]],
};
// per-world look of the land: texture, apron, shore type, vertex-colour palette along the shore profile
const LP = {
  harbor: { tex: 'grass', apron: { x: 9.4, tex: 'plaza', base: 0xdcd3c2 }, shore: 'wall', sc: [0xeee8da, 0xb1a894, 0x8f9a86, 0x4f7d70, 0x2d6a7a], chan: 0xcfc7b6, hilly: 0 },
  neon: { tex: 'neonplaza', apron: null, shore: 'wall', sc: [0x8f7be0, 0x4a3f86, 0x30286a, 0x24206a, 0x1a1450], chan: 0x6a5aa8, hilly: 0, ground: 0x4a3f86 },
  coral: { tex: 'sand', apron: null, shore: 'beach', sc: [0xfff3cf, 0xf6e2ae, 0xd7bd86, 0x86d8c0, 0x3ab8c8], chan: 0xf6e2ae, hilly: 0 },
  jungle: { tex: 'moss', apron: null, shore: 'bank', sc: [0x78a04a, 0x8a6c42, 0x54422c, 0x35634f, 0x1f5a50], chan: 0x7a6240, hilly: 1 },
  frost: { tex: 'snow', apron: null, shore: 'cliff', sc: [0xffffff, 0xcfeaff, 0x8fcdf4, 0x5aa6e0, 0x2a6fb4], chan: 0xcfeaff, hilly: 1 },
  dunes: { tex: 'desert', apron: null, shore: 'beach', sc: [0xf8dca0, 0xf2cf8c, 0xc99a5a, 0x7cc4a8, 0x3aa8a8], chan: 0xf2cf8c, hilly: 1 },
};
const CHAN_PTS = [[7.0, -0.62], [7.5, -0.42], [8.0, -0.15], [8.4, 0]];
function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1); return lerp(pts[i - 1][1], pts[i][1], t); }
  return pts[pts.length - 1][1];
}
function shoreBase(world, ax) {
  const H = GROUND_HALF[world.id], pts = SHORE_PTS[LP[world.id].shore];
  return interp(pts.map((p) => [H + p[0], p[1]]), ax);
}
// Rolling terrain beyond the props zone (even in z and periodic with TILE so mirrored / consecutive tiles match).
function hillH(world, ax, z) {
  const id = world.id, u = TAU * z / TILE;
  if (id === 'dunes') {
    const a1 = smooth(13, 30, ax) * 3.4, a2 = smooth(20, 44, ax) * 3.2;
    return a1 * (0.5 + 0.5 * Math.cos(u)) + a2 * (0.5 + 0.5 * Math.cos(2 * u + 0.0) * Math.cos(ax * 0.07)) + smooth(13, 20, ax) * 0.25 * Math.cos(3 * u) * Math.cos(ax * 0.3);
  }
  if (id === 'jungle') {
    const a = smooth(15, 26, ax);
    return a * (1.5 + 1.1 * Math.cos(u) + 0.7 * Math.cos(2 * u) * Math.cos(ax * 0.2)) * (1 - smooth(23, 26, ax) * 0.6);
  }
  if (id === 'frost') {
    const a = smooth(12, 19, ax);
    return a * (0.55 + 0.45 * Math.cos(u)) * 1.1 * (1 - smooth(19.5, 22, ax));
  }
  return 0;
}
// y of the land surface at |x| = ax (as seen from a road tile)
function groundY(world, ax, z) { return shoreBase(world, ax) + hillH(world, ax, z); }
function landY(world, ax, z, kind) {
  if (kind === 'water' && ax < 8.4) return interp(CHAN_PTS, ax);
  return groundY(world, ax, z);
}
function stationsFor(world, kind) {
  const L = LP[world.id], H = GROUND_HALF[world.id], sh = SHORE_PTS[L.shore];
  const xs = [kind === 'water' ? 7.0 : 5.7];
  const push = (x) => { if (x > xs[xs.length - 1] + 0.12) xs.push(x); };
  if (kind === 'water') { push(7.5); push(8.0); }
  push(8.4);
  if (L.apron) push(L.apron.x);
  const flatEnd = H + sh[0][0], step = L.hilly ? 2.4 : 3.0;
  for (let x = xs[xs.length - 1] + step; x < flatEnd - 0.6; x += step) push(x);
  push(flatEnd);
  for (let i = 1; i < sh.length; i++) push(H + sh[i][0]);
  return xs;
}
// x where the shore profile crosses the sea level
function seaX(world) {
  const H = GROUND_HALF[world.id], pts = SHORE_PTS[LP[world.id].shore];
  for (let i = 1; i < pts.length; i++) if (pts[i][1] <= SEA_Y) {
    const t = (SEA_Y - pts[i - 1][1]) / (pts[i][1] - pts[i - 1][1]);
    return H + lerp(pts[i - 1][0], pts[i][0], t);
  }
  return H;
}

// ===================================================================================================
// land meshes (both sides in one geometry)
// ===================================================================================================
const groundCache = new Map();
function landGeometry(world, len, kind, part /* 'apron' | 'main' */) {
  const L = LP[world.id], id = world.id;
  const xsAll = stationsFor(world, kind);
  const apX = L.apron ? L.apron.x : 0;
  let xs;
  if (part === 'apron') xs = xsAll.filter((x) => x <= apX + 1e-6);
  else xs = L.apron ? xsAll.filter((x) => x >= apX - 1e-6) : xsAll;
  if (xs.length < 2) return null;
  const nz = L.hilly ? 10 : 6;
  const gb = new GB({ col: true });
  const H = GROUND_HALF[id];
  const eps = 0.25;
  const grid = [];
  for (let side = -1; side <= 1; side += 2) {
    const rows = [];
    for (let j = 0; j <= nz; j++) {
      const z = -len * j / nz, jj = j % nz;
      const row = [];
      for (let i = 0; i < xs.length; i++) {
        const ax = xs[i], y = landY(world, ax, z, kind);
        const n = hash3(i * 1.7 + (id.length), jj * 3.1, hashStr(id) % 17);
        const col = landColorPalette(world, ax, z, n, kind, part === 'apron');
        const hx = (landY(world, ax + eps, z, kind) - landY(world, ax - eps, z, kind)) / (2 * eps);
        const hz = (landY(world, ax, z + eps, kind) - landY(world, ax, z - eps, kind)) / (2 * eps);
        let nx = -hx * side, ny = 1, nzz = -hz;
        const il = 1 / Math.hypot(nx, ny, nzz); nx *= il; ny *= il; nzz *= il;
        row.push({ p: [side * ax, y, z], n: [nx, ny, nzz], uv: [ax / 7.5, -z / 7.5], c: [col.r, col.g, col.b] });
      }
      rows.push(row);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < xs.length - 1; i++) {
      const a = rows[j][i], b = rows[j][i + 1], c = rows[j + 1][i + 1], d = rows[j + 1][i];
      gb.quad(a.p, b.p, c.p, d.p, [0, 1, 0], [a.uv, b.uv, c.uv, d.uv], [a.c, b.c, c.c, d.c], [a.n, b.n, c.n, d.n]);
    }
    grid.push(rows);
  }
  // end skirts (closed ground volumes where neighbours are lower, e.g. next to a flooded tile)
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1, rows = grid[s];
    for (const [j, nzs] of [[0, 1], [nz, -1]]) {
      for (let i = 0; i < xs.length - 1; i++) {
        const a = rows[j][i], b = rows[j][i + 1];
        const dark = [a.c[0] * 0.5, a.c[1] * 0.5, a.c[2] * 0.5], dark2 = [b.c[0] * 0.5, b.c[1] * 0.5, b.c[2] * 0.5];
        const bot = -1.7;
        gb.quad(a.p, b.p, [b.p[0], bot, b.p[2]], [a.p[0], bot, a.p[2]], [0, 0, nzs], [a.uv, b.uv, [b.uv[0], b.uv[1]], [a.uv[0], a.uv[1]]], [dark, dark2, dark2, dark]);
      }
    }
  }
  return gb.build();
}
// Vertex colour of the land at a station. Inland the colour is a neutral multiplier of the texture; along the
// shore profile the palette colours are absolute (divided by the texture base so the texture only adds detail).
const _lbase = new THREE.Color(), _lt = new THREE.Color(), _lt2 = new THREE.Color();
function landColorPalette(world, ax, z, n, kind, onApron) {
  const L = LP[world.id], H = GROUND_HALF[world.id], sh = SHORE_PTS[L.shore];
  const out = new THREE.Color();
  _lbase.set(onApron ? L.apron.base : (L.tex === 'neonplaza' ? 0x35295c : world.ground));
  const toAbs = (c) => out.setRGB(c.r / Math.max(_lbase.r, 0.06), c.g / Math.max(_lbase.g, 0.06), c.b / Math.max(_lbase.b, 0.06));
  const gv = 0.9 + 0.2 * n;
  const dark = 0.86 + 0.14 * smooth(5.7, 7.6, ax);
  if (kind === 'water' && ax < 8.4) {
    const y = interp(CHAN_PTS, ax);
    _lt.set(L.chan).multiplyScalar(0.8 + 0.2 * n);
    _lt2.set(world.sea.shallow);
    _lt.lerp(_lt2, smooth(-0.1, -0.55, y) * 0.5);
    return toAbs(_lt);
  }
  const x0 = H + sh[0][0];
  if (ax <= x0 + 1e-6) return out.setRGB(1, 1, 1).multiplyScalar((onApron ? 0.96 + 0.08 * n : gv) * dark * (L.tex === 'neonplaza' ? 1.1 : 1));
  let i = 1; while (i < sh.length - 1 && ax > H + sh[i][0] + 1e-6) i++;
  const ta = clamp01((ax - (H + sh[i - 1][0])) / ((sh[i][0] - sh[i - 1][0]) || 1));
  const nm = 0.92 + 0.12 * n;
  const cb = L.sc[i - 1];
  _lt2.set(cb);
  if (i === 1) {
    // from the inland (neutral) colour towards the first palette colour
    toAbs(_lt2);
    const r = out.r, gg = out.g, b = out.b;
    out.setRGB(lerp(gv * dark, r, ta), lerp(gv * dark, gg, ta), lerp(gv * dark, b, ta)).multiplyScalar(nm);
    return out;
  }
  _lt.set(L.sc[i - 2]).lerp(_lt2, ta).multiplyScalar(nm);
  return toAbs(_lt);
}

// ===================================================================================================
// shoreline foam / shallow tint bands
// ===================================================================================================
function foamGeometry(world, len, kind) {
  const gb = new GB({ col: true, rgba: true });
  const fc = new THREE.Color(world.sea.foam), sc = new THREE.Color(world.sea.shallow);
  const nz = 20;
  const wob = (z, side, k) => Math.sin(TAU * 3 * z / TILE + side + k) * 0.16 + Math.sin(TAU * 7 * z / TILE + side * 2 + k) * 0.07;
  const strip = (xm, y, bands, wobAmp) => {
    for (let side = -1; side <= 1; side += 2) for (let j = 0; j < nz; j++) {
      const z0 = -len * j / nz, z1 = -len * (j + 1) / nz;
      for (let b = 0; b < bands.length - 1; b++) {
        const A = bands[b], B = bands[b + 1];
        const mk = (z, band) => ({ p: [side * (xm + band.dx + wob(z, side, b) * wobAmp * (band.w || 1)), y, z], c: [band.col.r, band.col.g, band.col.b, band.a] });
        const a = mk(z0, A), b2 = mk(z0, B), c = mk(z1, B), d = mk(z1, A);
        gb.quad(a.p, b2.p, c.p, d.p, [0, 1, 0], null, [a.c, b2.c, c.c, d.c]);
      }
    }
  };
  if (kind !== 'water') {
    const xs = seaX(world), wall = LP[world.id].shore === 'wall' || LP[world.id].shore === 'cliff';
    if (wall) {
      // narrow foam kissing the wall + wide shallow tint
      strip(xs, SEA_Y + 0.02, [{ dx: -0.02, col: fc, a: 0.0 }, { dx: 0.0, col: fc, a: 0.9 }, { dx: 0.35, col: fc, a: 0.55 }, { dx: 0.9, col: fc, a: 0 }], 0.5);
      strip(xs, SEA_Y + 0.012, [{ dx: 0.0, col: sc, a: 0.55 }, { dx: 1.8, col: sc, a: 0.22 }, { dx: 4.5, col: sc, a: 0 }], 0.0);
    } else {
      strip(xs, SEA_Y + 0.02, [{ dx: -0.9, col: fc, a: 0.0 }, { dx: -0.45, col: fc, a: 0.85 }, { dx: -0.1, col: fc, a: 0.95 }, { dx: 0.3, col: fc, a: 0.55 }, { dx: 0.8, col: fc, a: 0 }], 1.0);
      strip(xs, SEA_Y + 0.012, [{ dx: -0.2, col: sc, a: 0.6 }, { dx: 1.6, col: sc, a: 0.28 }, { dx: 4.5, col: sc, a: 0 }], 0.0);
    }
    if (world.id === 'neon') {
      // glowing quay edge lines
      const pk = new THREE.Color(0xff3df2), cy = new THREE.Color(0x39f3ff);
      for (let side = -1; side <= 1; side += 2) {
        const xe = GROUND_HALF[world.id] - 1.0;
        gb.quad([side * (xe - 0.07), 0.03, 0], [side * (xe + 0.07), 0.03, 0], [side * (xe + 0.07), 0.03, -len], [side * (xe - 0.07), 0.03, -len], [0, 1, 0], null, [[pk.r, pk.g, pk.b, 1], [pk.r, pk.g, pk.b, 1], [pk.r, pk.g, pk.b, 1], [pk.r, pk.g, pk.b, 1]]);
        gb.quad([side * (xe - 0.34), 0.03, 0], [side * (xe - 0.2), 0.03, 0], [side * (xe - 0.2), 0.03, -len], [side * (xe - 0.34), 0.03, -len], [0, 1, 0], null, [[cy.r, cy.g, cy.b, 0.85], [cy.r, cy.g, cy.b, 0.85], [cy.r, cy.g, cy.b, 0.85], [cy.r, cy.g, cy.b, 0.85]]);
      }
    }
  } else {
    // surf where the swim channel meets the beach
    strip(7.9, WATER_Y + 0.012, [{ dx: -0.5, col: fc, a: 0.0 }, { dx: -0.15, col: fc, a: 0.7 }, { dx: 0.2, col: fc, a: 0.8 }, { dx: 0.5, col: fc, a: 0 }], 0.8);
    strip(seaX(world), SEA_Y + 0.012, [{ dx: -0.2, col: sc, a: 0.4 }, { dx: 1.6, col: sc, a: 0.18 }, { dx: 4.5, col: sc, a: 0 }], 0);
  }
  return gb.build();
}

// ===================================================================================================
// road / pavement mesh using the road atlas
// ===================================================================================================
function roadGeometry(len, gap) {
  const gb = new GB();
  const segs = gap ? [[0, PHYS.gapStart], [PHYS.gapStart + PHYS.gapLength, len]] : [[0, len]];
  const ux = (x) => (x + 5.7) / 11.4, vz = (z) => 1 + z / len;
  const KH = 0.14;
  for (const [za, zb] of segs) {
    const z0 = -za, z1 = -zb;
    const Q = (xa, ya, xb, yb, n, ua, ub) => {
      // vertical or horizontal quad spanning x/y range with z0..z1 (xa->xb along x or y changes)
      gb.quad([xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1], n, [[ua, vz(z0)], [ub, vz(z0)], [ub, vz(z1)], [ua, vz(z1)]]);
    };
    // road top
    Q(-4.3, 0, 4.3, 0, [0, 1, 0], ux(-4.3), ux(4.3));
    for (const s of [-1, 1]) {
      // pavement top
      Q(s * 4.3, KH, s * 5.7, KH, [0, 1, 0], ux(s * 4.3), ux(s * 5.7));
      // kerb face (towards the road) and outer face (towards the land)
      const uk = s < 0 ? ux(-4.34) : ux(4.34), uo = s < 0 ? ux(-5.64) : ux(5.64);
      gb.quad([s * 4.3, 0, z0], [s * 4.3, KH, z0], [s * 4.3, KH, z1], [s * 4.3, 0, z1], [-s, 0, 0], [[uk, vz(z0)], [uk, vz(z0)], [uk, vz(z1)], [uk, vz(z1)]]);
      gb.quad([s * 5.7, 0, z0], [s * 5.7, KH, z0], [s * 5.7, KH, z1], [s * 5.7, 0, z1], [s, 0, 0], [[uo, vz(z0)], [uo, vz(z0)], [uo, vz(z1)], [uo, vz(z1)]]);
    }
  }
  return gb.build();
}

// ===================================================================================================
// ground tile
// ===================================================================================================
let _roadMats = new Map();
function roadMaterial(world) {
  let m = _roadMats.get(world.id);
  if (m) return m;
  const at = roadAtlas(world);
  m = new THREE.MeshLambertMaterial({ map: at.map });
  if (at.emissive) { m.emissiveMap = at.emissive; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 1.0; }
  _roadMats.set(world.id, m);
  return m;
}
const _landMats = new Map();
function landMaterial(world, part) {
  const key = world.id + part;
  let m = _landMats.get(key);
  if (m) return m;
  const L = LP[world.id];
  const tex = part === 'apron' ? landTexture(L.apron.tex, L.apron.base) : landTexture(L.tex, L.ground !== undefined && L.tex === 'neonplaza' ? 0x35295c : world.ground);
  m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  _landMats.set(key, m);
  return m;
}
let _foamMat = null;
function foamMaterial() {
  if (!_foamMat) _foamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return _foamMat;
}

export function makeGroundTile(world, len, kind) {
  GAIN = WGAIN[world.id] || 1;
  const key = world.id + '|' + len + '|' + kind;
  let parts = groundCache.get(key);
  if (!parts) {
    parts = [];
    const L = LP[world.id];
    if (kind !== 'water') {
      parts.push({ name: 'road', geo: roadGeometry(len, kind === 'gap'), mat: roadMaterial(world), shadow: true });
    }
    if (L.apron) { const g = landGeometry(world, len, kind, 'apron'); if (g) parts.push({ name: 'apron', geo: g, mat: landMaterial(world, 'apron') }); }
    const gm = landGeometry(world, len, kind, 'main');
    if (gm) parts.push({ name: 'land', geo: gm, mat: landMaterial(world, 'main') });
    parts.push({ name: 'foam', geo: foamGeometry(world, len, kind), mat: foamMaterial(), order: 2 });
    if (kind !== 'water') {
      const kit = new Kit(mulberry(hashStr(world.id + 'street')));
      streetDecor(world, kit, len, kind === 'gap');
      if (kind === 'gap') gapEdges(world, kit, len);
      const kg = new THREE.Group();
      kit.build(kg, worldMats(world));
      for (const m of kg.children) parts.push({ name: m.name, geo: m.geometry, mat: m.material, order: m.renderOrder });
    }
    groundCache.set(key, parts);
  }
  const g = new THREE.Group();
  g.name = 'ground_' + kind;
  for (const p of parts) {
    const m = new THREE.Mesh(p.geo, p.mat);
    m.name = 'ground_' + p.name;
    if (p.shadow) m.receiveShadow = true;
    if (p.order) m.renderOrder = p.order;
    g.add(m);
  }
  return g;
}

// ===================================================================================================
// per-world materials, prefab cache, chunk scene helper
// ===================================================================================================
const _wm = new Map();
function worldMats(world) {
  let m = _wm.get(world.id);
  if (m) return m;
  m = Object.assign({}, sharedMats());
  if (world.id === 'neon') {
    const ft = facadeTextures();
    m.fac = new THREE.MeshLambertMaterial({ map: ft.map, emissiveMap: ft.emissive, emissive: 0xffffff, emissiveIntensity: 1.0, vertexColors: true });
    m.sig = new THREE.MeshBasicMaterial({ map: signAtlas(), vertexColors: true, side: THREE.DoubleSide });
  }
  _wm.set(world.id, m);
  return m;
}

const PF = new Map();
// build (once) a prefab named `name` for this world: fn(K, world) draws at the origin (+y up, front = +z)
function pf(world, name, fn) {
  const k = world.id + ':' + name;
  let p = PF.get(k);
  if (!p) {
    const kit = new Kit(mulberry(hashStr(k)));
    fn(kit, world);
    p = kit.freeze();
    PF.set(k, p);
  }
  return p;
}

function jitterTint(rng, amt) {
  const f = 1 + (rng() - 0.5) * 2 * amt;
  return new THREE.Color(f, f * (1 + (rng() - 0.5) * amt * 0.5), f * (1 + (rng() - 0.5) * amt * 0.5));
}

// Chunk scene: places prefabs on one side of the road in "absolute x" coordinates (ax >= 8.4)
class Chunk {
  constructor(world, side, len, rng) {
    this.world = world; this.side = side; this.len = len; this.rng = rng;
    this.kit = new Kit(rng);
  }
  // prefab placement; o: face (turn the front towards the road), yaw, s, tint (colour or amount), y
  put(pfab, ax, z, o = {}) {
    const side = this.side;
    const y = (o.yAbs !== undefined ? o.yAbs : groundY(this.world, ax, z)) + (o.y || 0);
    const ry = (o.face ? -side * PI / 2 : 0) + (o.yaw || 0);
    const tint = typeof o.tint === 'number' ? jitterTint(this.rng, o.tint) : (o.tint || null);
    this.kit.stamp(pfab, side * ax, y, z, ry, o.s || 1, tint);
  }
  // random walk along z placing weighted items. item = { w, r (half length along z), x:[a,b], fn(chunk, ax, z) }
  row(items, x0, x1, gapMin, gapMax, startPad = 0) {
    const rng = this.rng;
    let tot = 0; for (const it of items) tot += it.w;
    let z = -startPad, prev = 0, guard = 0;
    while (guard++ < 60) {
      let r = rng() * tot, it = items[0];
      for (const c of items) { r -= c.w; if (r <= 0) { it = c; break; } }
      const gap = rr(rng, gapMin, gapMax);
      const zc = z - prev - gap - it.r;
      if (zc - it.r < -this.len + 0.4) break;
      const ax = it.x ? rr(rng, it.x[0], it.x[1]) : rr(rng, x0, x1);
      it.fn(this, ax, zc);
      z = zc; prev = it.r;
    }
  }
  // scatter n small things over a band
  scatter(list, n, x0, x1, o = {}) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      const ax = rr(rng, x0, x1), z = -rng() * this.len;
      this.put(pick(rng, list), ax, z, { yaw: rng() * TAU, s: rr(rng, 0.8, 1.25), tint: o.tint === undefined ? 0.1 : o.tint });
    }
  }
  // fill the chunk with vignettes: templates = [{ w: width along z, weight, fn(chunk, zCentre) }]
  compose(templates, fillers) {
    const rng = this.rng, len = this.len;
    const picks = [];
    let used = 0, last = null, tries = 0;
    while (tries++ < 40) {
      let tot = 0; for (const t of templates) if (t !== last) tot += t.weight;
      let r = rng() * tot, t = templates[0];
      for (const c of templates) { if (c === last) continue; r -= c.weight; if (r <= 0) { t = c; break; } }
      if (used + t.w > len - 0.6) { if (tries > 25) break; continue; }
      picks.push(t); used += t.w; last = t;
      if (used > len - 5) break;
    }
    const slack = Math.max(0, len - used), gap = slack / (picks.length + 1);
    let z = 0;
    for (const t of picks) { z -= gap; t.fn(this, z - t.w / 2); z -= t.w; }
    if (fillers) fillers(this);
  }
  group() {
    const g = new THREE.Group();
    g.name = 'props_' + this.world.id + '_' + (this.side < 0 ? 'L' : 'R');
    this.kit.build(g, worldMats(this.world));
    return g;
  }
}

// ---- shared ground-cover prefabs ----
function tuftPrefab(world, name, cols, h = 0.42, blades = 6) {
  return pf(world, name, (K) => {
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * TAU + K.rng() * 0.6, lean = 0.12 + K.rng() * 0.18, hh = h * (0.7 + K.rng() * 0.6), w = 0.05 + K.rng() * 0.03;
      const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean, cx = Math.cos(a) * 0.04, cz = Math.sin(a) * 0.04;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      K.lit2.tri([cx - px, 0, cz - pz], [cx + px, 0, cz + pz], [cx + dx, hh, cz + dz], cols[i % cols.length], { top: cols[(i + 1) % cols.length], tc: [0, 0, 1] });
    }
  });
}
function flowerPrefab(world, name, petal, center, stem = 0x3f9a3a) {
  return pf(world, name, (K) => {
    K.lit.cyl(0, 0, 0, 0.012, 0.012, 0.22, stem, { seg: 3, ao: 0 });
    K.lit.ico(0, 0.26, 0, 0.08, petal, { det: 0, sy: 0.6, ao: 0 });
    K.lit.ico(0, 0.3, 0, 0.035, center, { det: 0, ao: 0 });
  });
}
function rockPrefab(world, name, col, top, size = 1, seed = 1) {
  return pf(world, name, (K) => {
    const r = size;
    K.lit.ico(0, r * 0.38, 0, r * 0.62, col, { top, sy: 0.7, sx: 1.1, rough: 0.35, flat: true, det: 1, ao: 0.5 });
    K.lit.ico(r * 0.55, r * 0.2, r * 0.2, r * 0.32, col, { top, sy: 0.7, rough: 0.35, flat: true, det: 1, ao: 0.5 });
    K.shadow(0.1, 0.05, r * 0.95, r * 0.75, 0.4);
  });
}

// ===================================================================================================
// shared building blocks used by several worlds
// ===================================================================================================
// curved leaf strip in lit2: base point (ox,oy,oz), horizontal direction yaw, length, initial rise, droop
function frond(K, ox, oy, oz, yaw, len, rise, droop, w, c0, c1, segs = 3, bucket) {
  const B = bucket || K.lit2;
  const dx = Math.cos(yaw), dz = Math.sin(yaw), sx = -dz, sz = dx;
  let prevL = null, prevR = null;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, d = len * t, y = oy + len * (rise * t - droop * t * t);
    const ww = w * Math.sin(Math.min(1, (1 - t * t * 0.95)) * PI * 0.5) * (i === segs ? 0 : 1);
    const L = [ox + dx * d - sx * ww, y, oz + dz * d - sz * ww], R = [ox + dx * d + sx * ww, y, oz + dz * d + sz * ww];
    if (prevL) B.quad4(prevL, prevR, R, L, c0, { top: c1, tc: [(i - 1) / segs, (i - 1) / segs, t, t] });
    prevL = L; prevR = R;
  }
}
// leaning trunk made of tilted tapered cylinders; returns the top point
function leanTrunk(K, x, z, h, lean, r0, r1, colA, colB, n = 7, bandCol) {
  let px = x, py = 0, pz = z, last = [x, 0, z];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const x1 = x + lean * t1 * t1 * h, y1 = h * t1;
    const dx = x1 - px, dy = y1 - py, l = Math.hypot(dx, dy) * 1.06, th = Math.atan2(-dx, dy);
    const rb = lerp(r0, r1, t0), rt = lerp(r0, r1, t1);
    K.lit.cyl(px, py, pz, rb, rt, l, i % 2 ? colB : colA, { seg: 7, rz: th, g: [0.88, 1.04], ao: i ? 0 : 0.4 });
    px = x1; py = y1; last = [px, py, pz];
  }
  return last;
}
function palmPrefab(world, name, o) {
  return pf(world, name, (K) => {
    const h = o.h || 6, lean = o.lean || 0.12;
    const top = leanTrunk(K, 0, 0, h, lean, o.r0 || 0.26, o.r1 || 0.14, o.trunkA || 0xb58a52, o.trunkB || 0xa5783f, 7);
    const nf = o.nf || 9;
    for (let i = 0; i < nf; i++) {
      const yaw = (i / nf) * TAU + (K.rng() - 0.5) * 0.3;
      frond(K, top[0], top[1] + 0.05, top[2], yaw, (o.fl || 2.6) * (0.85 + K.rng() * 0.3), 0.55 + K.rng() * 0.3, 0.95 + K.rng() * 0.35, o.fw || 0.5, o.leafA || 0x2a8a45, o.leafB || 0x7fd05a, 3);
    }
    if (o.nuts !== false) for (let i = 0; i < 3; i++) K.lit.sph(top[0] + Math.cos(i * 2.1) * 0.22, top[1] - 0.2, top[2] + Math.sin(i * 2.1) * 0.22, 0.14, 0x6b4426, { seg: 5, ao: 0 });
    K.shadow(top[0] * 0.5, 0, 1.5 + h * 0.18, 1.5 + h * 0.18, 0.4);
  });
}
function pineTree(world, name, o) {
  return pf(world, name, (K) => {
    const h = o.h || 6, tiers = o.tiers || 4, r = o.r || 1.5;
    K.lit.cyl(0, 0, 0, 0.22, 0.16, h * 0.3, 0x6b4a2e, { seg: 6 });
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, rr_ = r * (1 - t * 0.75), hh = (h * 0.85) / tiers * 1.6, y = h * 0.16 + t * h * 0.72;
      K.lit.cone(0, y, 0, rr_, hh, o.col || 0x2f7d5a, { seg: 8, top: o.colTop || 0x55b07a, g: [0.78, 1.02], ao: i ? 0.1 : 0.3 });
      if (o.snow) K.lit.cone(0, y + hh * 0.38, 0, rr_ * 0.66, hh * 0.64, 0xffffff, { seg: 8, top: 0xf0f8ff, g: [0.95, 1.05], ao: 0 });
    }
    K.lit.cone(0, h * 0.9, 0, 0.18, 0.5, o.col || 0x2f7d5a, { seg: 6, ao: 0 });
    K.shadow(0.2, 0.1, r * 1.1, r * 1.0, 0.4);
  });
}
// striped umbrella / canopy from 8 triangles
function canopy(K, x, y, z, r, h, c0, c1, n = 8, drop = 0.0) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, c = i % 2 ? c1 : c0;
    K.lit2.tri([x, y + h, z], [x + Math.cos(a0) * r, y + drop, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y + drop, z + Math.sin(a1) * r], c, { top: shadeHex(c, 1.15), tc: [1, 0, 0] });
  }
}

// ===================================================================================================
// street furniture on the strip between the kerb and x = 8.4 (road / gap tiles only)
// ===================================================================================================
function ropeBetween(K, x, y, za, zb, col, sag = 0.12, r = 0.022) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([x, y - Math.sin(t * PI) * sag, lerp(za, zb, t)]); }
  K.lit.tube(pts, r, col, { segs: 6, rad: 3, ao: 0.1 });
}

function streetDecor(world, K, len, hasGap) {
  const id = world.id;
  const inGap = (z, pad = 1.4) => hasGap && z < -(PHYS.gapStart - pad) && z > -(PHYS.gapStart + PHYS.gapLength + pad);
  for (const s of [-1, 1]) {
    K.push(0, 0, 0, 0, 1);
    const face = -s * PI / 2;        // front (+z) turned towards the road
    const X = (ax) => s * ax;
    if (id === 'harbor') {
      // bollards on the pavement
      for (let k = 0; k < 8; k++) {
        const z = -1.9 - k * 3.75; if (inGap(z, 0.8)) continue;
        K.lit.cyl(X(5.15), 0.14, z, 0.17, 0.15, 0.5, 0x39424f, { seg: 7, top: 0x5b6677 });
        K.lit.cyl(X(5.15), 0.55, z, 0.155, 0.1, 0.12, 0xffc21a, { seg: 7 });
      }
      // lamp posts with a curved arm
      for (const z of [-7.5, -22.5]) {
        K.lit.cyl(X(5.95), 0, z, 0.2, 0.2, 0.22, 0x2c3440, { seg: 8 });
        K.lit.cyl(X(5.95), 0.2, z, 0.08, 0.06, 4.9, 0x3b4658, { seg: 8 });
        K.lit.tube([[X(5.95), 5.0, z], [X(5.9), 5.35, z], [X(5.2), 5.55, z], [X(4.6), 5.4, z]], 0.045, 0x3b4658, { segs: 7, rad: 4 });
        K.lit.rbox(X(4.55), 5.2, z, 0.62, 0.14, 0.26, 0.05, 0xdfe6ee);
        K.glow.box(X(4.55), 5.16, z, 0.5, 0.05, 0.2, 0xfff3c4);
        K.halo_(X(4.55), 5.1, z, 0.8, 0xfff0b0, 0.14);
        K.shadow(X(5.95), z, 0.5, 0.5, 0.35);
      }
      // hedges + benches on the land strip
      for (let k = 0; k < 4; k++) {
        const z = -3.75 - k * 7.5; if (inGap(z, 2.5)) continue;
        K.lit.rbox(X(7.0), 0, z, 0.95, 0.62, 5.3, 0.22, 0x4aa14a, { top: 0x74c552, ao: 0.5 });
        for (let f = 0; f < 5; f++) K.lit.ico(X(7.0 + (K.rng() - 0.5) * 0.5), 0.66, z + (f - 2) * 1.0 + (K.rng() - 0.5) * 0.3, 0.12, pick(K.rng, [0xff7a59, 0xffc14d, 0xff9ecf, 0xffffff]), { det: 0, ao: 0 });
        K.shadow(X(7.0), z, 0.8, 2.8, 0.25);
      }
      for (const z of [-15]) {
        if (inGap(z, 2.5)) continue;
        K.push(X(7.9), 0, z, face + (s < 0 ? PI : 0) * 0, 1);
        K.lit.rbox(0, 0.42, 0, 1.7, 0.09, 0.5, 0.03, 0x9a6a3a); K.lit.rbox(0, 0.78, -0.2, 1.7, 0.4, 0.07, 0.03, 0x9a6a3a);
        for (const bx of [-0.75, 0.75]) K.lit.box(bx, 0, 0, 0.08, 0.45, 0.46, 0x2c3440);
        K.pop();
      }
      // curb between the stone apron and the grass
      K.lit.box(X(9.4), 0, -len / 2, 0.16, 0.1, len, 0xeee8da, { ao: 0.0, g: [1, 1] });
    } else if (id === 'neon') {
      for (const z of [-7.5, -22.5]) {
        K.lit.cyl(X(5.95), 0, z, 0.2, 0.2, 0.2, 0x181433, { seg: 8 });
        K.lit.cyl(X(5.95), 0.2, z, 0.07, 0.06, 4.4, 0x241d4a, { seg: 8 });
        K.glow.cyl(X(5.95), 1.4, z, 0.1, 0.1, 0.05, 0xff3df2, { seg: 10 });
        K.glow.cyl(X(5.95), 2.6, z, 0.1, 0.1, 0.05, 0x39f3ff, { seg: 10 });
        K.glow.sph(X(5.95), 4.75, z, 0.2, 0x39f3ff, { seg: 8 });
        K.halo_(X(5.95), 4.75, z, 1.2, 0x39f3ff, 0.5);
        K.halo_(X(5.95), 1.4, z, 0.5, 0xff3df2, 0.4);
        K.shadow(X(5.95), z, 0.5, 0.5, 0.4);
      }
      for (let k = 0; k < 8; k++) {
        const z = -1.9 - k * 3.75; if (inGap(z, 0.8)) continue;
        K.lit.cyl(X(5.15), 0.14, z, 0.14, 0.12, 0.42, 0x1f1a40, { seg: 8 });
        K.glow.cyl(X(5.15), 0.55, z, 0.115, 0.115, 0.05, k % 2 ? 0xff3df2 : 0x39f3ff, { seg: 8 });
      }
      for (let k = 0; k < 4; k++) {
        const z = -3.75 - k * 7.5; if (inGap(z, 2.5)) continue;
        K.lit.rbox(X(7.0), 0, z, 1.1, 0.5, 4.6, 0.12, 0x241d4a, { top: 0x3a2f78 });
        K.glow.box(X(7.0), 0.5, z, 0.7, 0.04, 4.1, k % 2 ? 0xff3df2 : 0x39f3ff);
        K.halo_(X(7.0), 0.55, z, 2.0, k % 2 ? 0xff3df2 : 0x39f3ff, 0.18);
        for (let f = 0; f < 3; f++) K.glow.sph(X(7.0), 0.75, z + (f - 1) * 1.3, 0.14, pick(K.rng, [0x3dff9a, 0xffe14d, 0xff3df2]), { seg: 6 });
      }
    } else if (id === 'coral') {
      for (let k = 0; k < 4; k++) {
        const z = -3.75 - k * 7.5; if (inGap(z, 1.6)) continue;
        // tiki torch
        K.lit.cyl(X(6.0), 0, z, 0.07, 0.06, 2.1, 0xc99a4a, { seg: 6, top: 0xe3bb68 });
        for (const y of [0.5, 1.0, 1.5]) K.lit.cyl(X(6.0), y, z, 0.085, 0.085, 0.05, 0x8a5a2b, { seg: 6, ao: 0 });
        K.lit.cyl(X(6.0), 2.05, z, 0.13, 0.09, 0.14, 0x7a4a24, { seg: 8 });
        K.glow.cone(X(6.0), 2.15, z, 0.1, 0.34, 0xffa21a, { seg: 6 });
        K.glow.cone(X(6.0), 2.18, z, 0.055, 0.28, 0xffe27a, { seg: 6 });
        K.halo_(X(6.0), 2.3, z, 0.8, 0xffa040, 0.4);
        K.shadow(X(6.0), z, 0.4, 0.4, 0.3);
      }
      // rope posts on the pavement edge
      for (let k = 0; k < 8; k++) {
        const z = 0 - k * 3.75;
        const gapNear = inGap(z, 0.5) || inGap(z - 3.75, 0.5);
        if (!inGap(z, 0.5)) {
          K.lit.cyl(X(5.5), 0.14, z, 0.07, 0.065, 0.62, 0xa97b3c, { seg: 6, top: 0xcfa05a });
          K.lit.sph(X(5.5), 0.78, z, 0.075, 0xcfa05a, { seg: 5 });
        }
        if (!gapNear && k < 7) ropeBetween(K, X(5.5), 0.7, z, z - 3.75, 0xe9d3a0, 0.1);
      }
      // hibiscus bushes
      for (let k = 0; k < 4; k++) {
        const z = -1.9 - k * 7.5; if (inGap(z, 2)) continue;
        for (let b = 0; b < 2; b++) K.lit.ico(X(7.0 + b * 0.35), 0.28 + b * 0.04, z + (b - 0.5) * 0.7, 0.46, 0x3f9a4a, { top: 0x6ac85a, flat: true, det: 1, rough: 0.25, sy: 0.8 });
        for (let f = 0; f < 5; f++) K.lit.ico(X(6.9 + K.rng() * 0.6), 0.45 + K.rng() * 0.25, z + (K.rng() - 0.5) * 1.3, 0.1, pick(K.rng, [0xff5a7a, 0xff8a3d, 0xffd23f]), { det: 0, ao: 0 });
        K.shadow(X(7.1), z, 0.9, 0.9, 0.3);
      }
    } else if (id === 'jungle') {
      for (let k = 0; k < 8; k++) {
        const z = 0 - k * 3.75;
        if (!inGap(z, 0.5)) {
          K.lit.cyl(X(5.5), 0.14, z, 0.09, 0.08, 0.85, 0x7a5030, { seg: 6, top: 0x9a6a3c });
          K.lit.cyl(X(5.5), 0.98, z, 0.09, 0.0, 0.08, 0x7a5030, { seg: 6 });
        }
        if (!inGap(z, 0.5) && !inGap(z - 3.75, 0.5) && k < 7) ropeBetween(K, X(5.5), 0.85, z, z - 3.75, 0xc9a96a, 0.14, 0.03);
      }
      for (let k = 0; k < 4; k++) {
        const z = -2.5 - k * 7.5; if (inGap(z, 2)) continue;
        K.stamp(fernPrefab(world), X(6.6 + (k % 2) * 0.5), 0, z, K.rng() * TAU, 1.0 + K.rng() * 0.3);
      }
      for (let k = 0; k < 2; k++) {
        const z = -6 - k * 15; if (inGap(z, 2)) continue;
        K.stamp(mushroomPrefab(world, 0), X(7.4), 0, z, K.rng() * TAU, 1);
      }
    } else if (id === 'frost') {
      for (let k = 0; k < 4; k++) {
        const z = -3.75 - k * 7.5; if (inGap(z, 1.5)) continue;
        for (let j = 0; j < 5; j++) K.lit.cyl(X(5.95), j * 0.4, z, 0.06, 0.06, 0.4, j % 2 ? 0xffffff : 0xd84a4a, { seg: 6, ao: j ? 0 : 0.3 });
        K.glow.sph(X(5.95), 2.05, z, 0.07, 0xffb347, { seg: 5 });
        K.shadow(X(5.95), z, 0.35, 0.35, 0.25);
      }
      for (const z of [-15]) {
        if (inGap(z, 2)) continue;
        K.lit.cyl(X(6.1), 0, z, 0.16, 0.16, 0.2, 0x3b5370, { seg: 8 });
        K.lit.cyl(X(6.1), 0.2, z, 0.07, 0.055, 4.1, 0x4b6a8c, { seg: 8 });
        K.lit.tube([[X(6.1), 4.2, z], [X(6.05), 4.55, z], [X(5.4), 4.65, z]], 0.04, 0x4b6a8c, { segs: 8 });
        K.glow.sph(X(5.35), 4.55, z, 0.2, 0xfff0c8, { seg: 8 });
        K.halo_(X(5.35), 4.55, z, 1.0, 0xffe6a8, 0.35);
        for (let i = 0; i < 5; i++) K.lit.cone(X(6.1) + (i - 2) * 0.05, 3.7 - (i % 2) * 0.2, z + (i - 2) * 0.03, 0.035, -0.28, 0xdff2ff, { seg: 4, ao: 0 });
        K.shadow(X(6.1), z, 0.4, 0.4, 0.3);
      }
      for (let k = 0; k < 4; k++) {
        const z = -1.5 - k * 7.5; if (inGap(z, 2)) continue;
        K.lit.ico(X(6.9), 0.05, z, 1.0, 0xffffff, { sx: 0.8, sy: 0.38, sz: 1.5, top: 0xf0f8ff, det: 1, rough: 0.1, ao: 0.2 });
        K.lit.ico(X(7.6), 0.0, z - 1.5, 0.7, 0xffffff, { sx: 0.8, sy: 0.4, sz: 1.2, top: 0xf0f8ff, det: 1, rough: 0.1, ao: 0.2 });
      }
    } else if (id === 'dunes') {
      for (const z of [-7.5, -22.5]) {
        K.lit.cyl(X(5.95), 0, z, 0.17, 0.17, 0.25, 0x6a4a2a, { seg: 8 });
        K.lit.cyl(X(5.95), 0.25, z, 0.06, 0.05, 3.1, 0x3d3028, { seg: 8 });
        K.lit.tube([[X(5.95), 3.2, z], [X(5.9), 3.5, z], [X(5.3), 3.55, z], [X(4.95), 3.3, z]], 0.035, 0x3d3028, { segs: 10 });
        K.lit.cyl(X(4.95), 2.92, z, 0.1, 0.12, 0.05, 0x3d3028, { seg: 6 });
        K.glow.cyl(X(4.95), 2.55, z, 0.13, 0.17, 0.36, 0xffb347, { seg: 6 });
        K.lit.cone(X(4.95), 2.9, z, 0.2, 0.18, 0x3d3028, { seg: 6 });
        K.halo_(X(4.95), 2.7, z, 1.1, 0xffa840, 0.4);
        K.shadow(X(5.95), z, 0.4, 0.4, 0.3);
      }
      for (let k = 0; k < 4; k++) {
        const z = -3.75 - k * 7.5; if (inGap(z, 2)) continue;
        K.lit.box(X(6.7), 0, z, 0.55, 0.62, 3.6, 0xe6bf80, { top: 0xf2d29a, ao: 0.5 });
        K.lit.box(X(6.7), 0.62, z, 0.7, 0.1, 3.8, 0xf2d29a);
        for (let c = 0; c < 4; c++) K.lit.box(X(6.7), 0.72, z + (c - 1.5) * 0.9, 0.5, 0.16, 0.4, 0xe6bf80, { top: 0xf2d29a });
        K.shadow(X(6.7), z, 0.6, 2.0, 0.28);
      }
      for (let k = 0; k < 2; k++) {
        const z = -5.6 - k * 15; if (inGap(z, 2)) continue;
        K.stamp(jarPrefab(world), X(7.7), 0, z, K.rng() * TAU, 1.0);
        K.stamp(jarPrefab(world), X(7.45), 0, z - 0.7, K.rng() * TAU, 0.8);
      }
    }
    K.pop();
  }
}

function jarPrefab(world) {
  return pf(world, 'jar', (K) => {
    K.lit.lathe(0, 0, 0, [[0, 0], [0.22, 0.02], [0.3, 0.2], [0.34, 0.45], [0.26, 0.72], [0.14, 0.82], [0.17, 0.92], [0.0, 0.92]], 0xc2603a, { seg: 10, top: 0xe28a54 });
    K.lit.cyl(0, 0.46, 0, 0.345, 0.345, 0.06, 0x2a9d8f, { seg: 10 });
    K.shadow(0.05, 0.05, 0.5, 0.5, 0.35);
  });
}

// ===================================================================================================
// broken bridge edges for the 'gap' tile (z from -12 to -18)
// ===================================================================================================
function gapEdges(world, K, len) {
  const z0 = -PHYS.gapStart, z1 = -(PHYS.gapStart + PHYS.gapLength), id = world.id;
  const rng = K.rng;
  const wood = id === 'coral' || id === 'jungle';
  const deckTop = id === 'coral' ? 0xcfa25c : id === 'jungle' ? 0x7a5a38 : id === 'dunes' ? 0xd0a066 : id === 'frost' ? 0xaec4da : id === 'neon' ? 0x2c2c4c : 0x464e5c;
  const core = id === 'neon' ? 0x3b3566 : id === 'frost' ? 0xdce9f6 : id === 'dunes' ? 0xe0b679 : wood ? 0x6b4a2a : 0x9c9a92;
  const coreLow = id === 'neon' ? 0x1b1648 : id === 'frost' ? 0x6fa6d8 : id === 'dunes' ? 0x8a6a40 : wood ? 0x3a2a18 : 0x4f6b66;
  const pave = world.side;
  for (const end of [0, 1]) {
    const zE = end === 0 ? z0 : z1, dir = end === 0 ? -1 : 1;        // dir = towards the gap
    const zin = (d) => zE - dir * d;                                   // d metres inside the road
    // cross-section slabs (road + pavements) going down below the sea level
    K.lit.box(0, -1.45, zin(0.35), 8.6, 1.22, 0.7, core, { top: core, g: [0.45, 1.0], ao: 0 });
    K.lit.box(0, -0.23, zin(0.36), 8.6, 0.2, 0.72, deckTop, { g: [0.9, 1.05], ao: 0 });
    for (const s of [-1, 1]) {
      K.lit.box(s * 5.0, -1.45, zin(0.35), 1.4, 1.57, 0.7, core, { g: [0.45, 1.0], ao: 0 });
      K.lit.box(s * 5.0, -0.02, zin(0.36), 1.4, 0.15, 0.72, pave, { g: [0.9, 1.05], ao: 0 });
    }
    // ragged teeth of the broken deck
    const nT = wood ? 9 : 7;
    for (let t = 0; t < nT; t++) {
      const x = -4.1 + (t + 0.5) * (8.2 / nT) + (rng() - 0.5) * 0.3, w = (8.2 / nT) * (0.7 + rng() * 0.45), ext = 0.12 + rng() * (wood ? 1.1 : 0.7), th = 0.16 + rng() * 0.22;
      const droop = (rng() * 0.35) * (wood ? 1.4 : 1);
      K.push(x, -0.03, zE + dir * 0.02, 0, 1, dir * droop * -1 * 0);
      const lenZ = ext + 0.15;
      K.lit.box(0, -th, -dir * 0 + dir * lenZ / 2 - dir * 0.15, w, th, lenZ, deckTop, { g: [0.8, 1.05], ao: 0, rx: dir * droop * 0.5 });
      if (!wood && rng() < 0.7) K.lit.box(0, -th - 0.28, dir * (lenZ / 2 - 0.15) * 0.8, w * 0.9, 0.3, lenZ * 0.8, core, { g: [0.6, 1.0], ao: 0, rx: dir * droop * 0.4 });
      K.pop();
    }
    if (wood) {
      // joists + splintered planks hanging
      for (let b = 0; b < 4; b++) {
        const x = -3.6 + b * 2.4, ext = 0.3 + rng() * 1.3;
        K.lit.box(x, -0.62, zE + dir * (ext / 2 - 0.5) , 0.28, 0.4, ext + 1.0, 0x4a3320, { rx: dir * rng() * 0.12 });
      }
      for (let p = 0; p < 6; p++) {
        const x = rr(rng, -3.9, 3.9), l = 0.5 + rng() * 0.9, ang = 0.7 + rng() * 0.8;
        K.push(x, -0.03, zE, 0, 1);
        K.lit.box(0, -l * Math.cos(ang), dir * l * Math.sin(ang), 0.28, 0.05, l, deckTop, { rx: dir * -ang, g: [0.8, 1.0], ao: 0, top: 0xe8c98a });
        K.pop();
      }
    } else {
      // rebar sticking out of the cut
      for (let r = 0; r < 8; r++) {
        const x = rr(rng, -4.1, 4.1), y = rr(rng, -1.0, -0.4), l = 0.4 + rng() * 0.6, droop = 0.2 + rng() * 0.5;
        K.lit.cyl(x, y, zE + dir * 0.0, 0.022, 0.018, l, 0x9a5a34, { seg: 4, rx: dir * (PI / 2 + droop), ao: 0, g: [1, 1] });
      }
    }
    if (id === 'frost') for (let i = 0; i < 12; i++) K.lit.cone(rr(rng, -4.2, 4.2), -0.9 - rng() * 0.2, zE + dir * 0.05, 0.07 + rng() * 0.06, -(0.35 + rng() * 0.6), 0xdff2ff, { seg: 5, ao: 0, g: [1, 1] });
    if (id === 'neon') {
      K.glow.box(-4.3, -0.5, zE + dir * 0.0, 8.6, 0.05, 0.05, 0xff3df2);
      K.glow.box(-4.3, -0.12, zE + dir * 0.0, 8.6, 0.03, 0.04, 0x39f3ff);
      K.halo_(0, -0.3, zE + dir * 0.2, 3.2, 0xff3df2, 0.18);
    }
    // hazard stripes painted on the road in front of the edge
    for (let i = 0; i < 14; i++) {
      const x = -4.0 + i * 0.6 + 0.3;
      K.lit.box(x, 0, zin(0.9), 0.3, 0.025, 0.5, i % 2 ? 0x1b1b1b : 0xffc21a, { ao: 0, g: [1, 1], rz: 0, ry: 0 });
    }
    // striped cones + flashing lamp on the pavement
    for (const s of [-1, 1]) {
      for (let c = 0; c < 2; c++) {
        K.lit.cyl(s * 4.0, 0, zin(1.6 + c * 1.9), 0.2, 0.05, 0.62, 0xff6a1f, { seg: 8, top: 0xff8a3a });
        K.lit.cyl(s * 4.0, 0.3, zin(1.6 + c * 1.9), 0.13, 0.1, 0.1, 0xffffff, { seg: 8 });
        K.lit.box(s * 4.0 - 0.27, 0, zin(1.6 + c * 1.9) - 0.27, 0.54, 0.05, 0.54, 0x2f3640, { ao: 0 });
      }
      K.lit.cyl(s * 5.2, 0.14, zin(0.7), 0.05, 0.05, 1.1, 0x39424f, { seg: 6 });
      K.glow.sph(s * 5.2, 1.3, zin(0.7), 0.13, 0xffa21a, { seg: 6 });
      K.halo_(s * 5.2, 1.3, zin(0.7), 0.9, 0xffa21a, 0.5);
      // bent guard rail
      K.lit.cyl(s * 5.5, 0.14, zin(0.45), 0.05, 0.05, 0.9, 0xb6bdc6, { seg: 6, rx: dir * 0.35, rz: s * -0.1 });
      K.lit.tube([[s * 5.5, 0.9, zin(0.4)], [s * 5.5, 0.95, zin(-0.1)], [s * 5.5, 0.55, zin(-0.55)], [s * 5.5, -0.3, zin(-0.8)]], 0.035, 0xb6bdc6, { segs: 10 });
    }
    // dangling cables
    for (let c = 0; c < 2; c++) {
      const x = rr(rng, -3, 3);
      K.lit.tube([[x, -0.2, zE], [x + 0.05, -0.5, zE + dir * 0.2], [x + 0.1, -0.9, zE + dir * 0.35]], 0.03, 0x20242c, { segs: 8, rad: 4, ao: 0 });
    }
  }
  // stone embankment where the land meets the missing road
  for (const s of [-1, 1]) {
    const wallCol = id === 'neon' ? 0x2c2552 : id === 'frost' ? 0xb5d4ee : id === 'dunes' ? 0xd8a864 : id === 'jungle' ? 0x6b6a5a : id === 'coral' ? 0xd9c08a : 0x9a9484;
    for (let c = 0; c < 4; c++) {
      const y = -1.45 + c * 0.36;
      K.lit.box(s * 5.84, y, (z0 + z1) / 2, 0.3 + (c % 2) * 0.04, 0.36, Math.abs(z1 - z0), mixHex(wallCol, 0x335a5a, clamp01((0.6 - c * 0.2))), { g: [0.8, 1.04], ao: 0, top: wallCol });
    }
    K.lit.box(s * 5.84, -0.02, (z0 + z1) / 2, 0.3, 0.04, Math.abs(z1 - z0), wallCol, { ao: 0 });
  }
}

// ===================================================================================================
// HARBOR: containers, cranes, lighthouse, warehouses, moored sailboats, park corners
// ===================================================================================================
const HB_CONT = [0xe5533d, 0x2f80ed, 0xf2a900, 0x20b2a0, 0xff7a1f, 0x5fbf5a, 0xe9eef4, 0x7b61ff];

function hbContainer(world, ci) {
  return pf(world, 'container' + ci, (K) => {
    const col = HB_CONT[ci], w = 6.0, h = 2.55, d = 2.44;
    K.lit.rbox(0, 0, 0, w, h, d, 0.06, col, { top: shadeHex(col, 1.18), g: [0.8, 1.05], ao: 0.3 });
    const rib = shadeHex(col, 0.78);
    for (let i = 0; i < 7; i++) {
      const px = -w / 2 + 0.4 + i * ((w - 0.8) / 6);
      for (const sz of [-1, 1]) K.lit.box(px - 0.07, 0.12, sz * (d / 2 + 0.012), 0.14, h - 0.3, 0.04, rib, { ao: 0.2, g: [0.9, 1] });
    }
    for (const e of [-1, 1]) {
      K.lit.box(e * (w / 2 + 0.012), 0.12, 0, 0.04, h - 0.3, d - 0.3, shadeHex(col, 0.9), { ao: 0.2 });
      for (const bz of [-0.35, 0.35]) K.lit.box(e * (w / 2 + 0.05) - 0.02, 0.25, bz - 0.02, 0.04, h - 0.6, 0.04, 0xc4ccd4, { ao: 0.1, g: [1, 1] });
    }
  });
}
function hbStack(world, name, specs) {
  return pf(world, name, (K) => {
    let xmin = 9, zmin = 9, xmax = -9, zmax = -9;
    for (const s of specs) {
      K.stamp(hbContainer(world, s.ci), s.x, s.y, s.z, s.yaw || 0, 1);
      xmin = Math.min(xmin, s.x - 3); xmax = Math.max(xmax, s.x + 3); zmin = Math.min(zmin, s.z - 1.3); zmax = Math.max(zmax, s.z + 1.3);
    }
    K.shadow((xmin + xmax) / 2 + 0.3, (zmin + zmax) / 2 - 0.2, (xmax - xmin) / 2 + 0.5, (zmax - zmin) / 2 + 0.6, 0.45);
  });
}
const hbWoodCrate = (K, x, y, z, s, yaw = 0) => {
  K.push(x, y, z, yaw, 1);
  K.lit.rbox(0, 0, 0, s, s, s, 0.05, 0xc99250, { top: 0xdcac68, g: [0.78, 1.05], ao: 0.3 });
  for (const sg of [-1, 1]) {
    K.lit.box(sg * (s / 2 - 0.05), 0, s / 2 + 0.01, 0.1, s, 0.03, 0x8a5a2b, { ao: 0 });
    K.lit.box(-s / 2, 0.06, s / 2 + 0.01, s, 0.1, 0.03, 0x8a5a2b, { ao: 0 });
    K.lit.box(-s / 2, s - 0.16, s / 2 + 0.01, s, 0.1, 0.03, 0x8a5a2b, { ao: 0 });
    K.lit.box(sg * (s / 2 + 0.01), 0, 0, 0.03, s, 0.1, 0x8a5a2b, { ao: 0 });
  }
  K.pop();
};
function hbCrates(world) {
  return pf(world, 'crates', (K) => {
    hbWoodCrate(K, -0.7, 0, 0, 1.1, 0.05); hbWoodCrate(K, 0.5, 0, 0.1, 1.1, -0.08); hbWoodCrate(K, -0.1, 1.1, 0.0, 1.0, 0.25);
    hbWoodCrate(K, 1.5, 0, -0.9, 0.8, 0.5);
    K.shadow(0.1, -0.1, 1.8, 1.4, 0.4);
  });
}
function hbBarrels(world) {
  return pf(world, 'barrels', (K) => {
    const cols = [0xe5533d, 0x2f80ed, 0xf2a900];
    [[0, 0], [0.7, 0.2], [0.3, -0.7]].forEach(([x, z], i) => {
      K.lit.cyl(x, 0, z, 0.34, 0.34, 0.95, cols[i], { seg: 10, top: shadeHex(cols[i], 1.2) });
      for (const y of [0.18, 0.7]) K.lit.cyl(x, y, z, 0.355, 0.355, 0.07, shadeHex(cols[i], 0.7), { seg: 10, ao: 0 });
      K.lit.cyl(x, 0.95, z, 0.27, 0.27, 0.03, 0x39424f, { seg: 10, ao: 0 });
    });
    K.shadow(0.3, -0.2, 1.2, 1.1, 0.4);
  });
}
function hbTree(world, v) {
  return pf(world, 'tree' + v, (K) => {
    const h = [3.0, 3.6, 4.4][v] || 3.4, r = [1.3, 1.5, 1.8][v] || 1.4;
    K.lit.cyl(0, 0, 0, 0.2, 0.13, h * 0.55, 0x7a5030, { seg: 7, top: 0x93653a });
    const cols = [[0x3f9a46, 0x6bc455], [0x4aa04a, 0x80cf5e], [0x2f8d4a, 0x5cbd5a]][v] || [0x3f9a46, 0x6bc455];
    K.lit.ico(0, h * 0.62, 0, r, cols[0], { top: cols[1], flat: true, det: 1, rough: 0.22, sy: 0.9 });
    K.lit.ico(r * 0.6, h * 0.5, r * 0.2, r * 0.7, cols[0], { top: cols[1], flat: true, det: 1, rough: 0.25 });
    K.lit.ico(-r * 0.55, h * 0.55, -r * 0.2, r * 0.68, shadeHex(cols[0], 1.05), { top: cols[1], flat: true, det: 1, rough: 0.25 });
    K.lit.ico(0.1, h * 0.62 + r * 0.55, 0.1, r * 0.55, cols[1], { top: shadeHex(cols[1], 1.15), flat: true, det: 1, rough: 0.25 });
    K.shadow(0.3, 0.1, r * 1.1, r * 1.0, 0.4);
  });
}
function hbBed(world, v) {
  return pf(world, 'bed' + v, (K) => {
    K.lit.rbox(0, 0, 0, 2.6, 0.38, 1.3, 0.1, 0xd9cfbf, { top: 0xefe8da, g: [0.8, 1.05] });
    K.lit.rbox(0, 0.28, 0, 2.3, 0.14, 1.0, 0.06, 0x6b4a2a);
    const cols = v ? [0xff7a59, 0xffc14d, 0xffffff] : [0xff9ecf, 0xb39dff, 0xffffff];
    for (let i = 0; i < 12; i++) {
      const x = -1.0 + (i % 6) * 0.4 + (K.rng() - 0.5) * 0.1, z = (i < 6 ? -0.25 : 0.25) + (K.rng() - 0.5) * 0.12;
      K.lit.ico(x, 0.42, z, 0.13, cols[i % 3], { det: 0, ao: 0, sy: 0.8 });
    }
    K.lit.ico(-0.9, 0.5, 0.1, 0.32, 0x3f9a46, { top: 0x6bc455, flat: true, det: 1, rough: 0.2 });
    K.lit.ico(0.95, 0.5, -0.1, 0.3, 0x3f9a46, { top: 0x6bc455, flat: true, det: 1, rough: 0.2 });
    K.shadow(0, 0, 1.7, 1.0, 0.3);
  });
}
function hbBench(world) {
  return pf(world, 'bench', (K) => {
    K.lit.rbox(0, 0.42, 0, 1.7, 0.09, 0.5, 0.03, 0xb7824a, { top: 0xd09a5a });
    K.lit.rbox(0, 0.74, -0.2, 1.7, 0.38, 0.07, 0.03, 0xb7824a, { top: 0xd09a5a });
    for (const bx of [-0.75, 0.75]) { K.lit.box(bx, 0, 0, 0.08, 0.45, 0.46, 0x39424f); K.lit.box(bx, 0.4, -0.2, 0.08, 0.7, 0.06, 0x39424f); }
    K.shadow(0, 0, 1.0, 0.55, 0.3);
  });
}
function hbFlag(world, ci) {
  return pf(world, 'flag' + ci, (K) => {
    K.lit.cyl(0, 0, 0, 0.12, 0.1, 0.25, 0x39424f, { seg: 8 });
    K.lit.cyl(0, 0.2, 0, 0.05, 0.035, 6.2, 0xdfe6ee, { seg: 6, top: 0xffffff });
    K.lit.sph(0, 6.42, 0, 0.08, 0xffc21a, { seg: 6 });
    const c = [0xe5533d, 0x2f80ed, 0xf2a900][ci % 3], c2 = [0xffffff, 0xffffff, 0x20b2a0][ci % 3];
    K.lit2.tri([0, 5.1, 0], [0, 6.2, 0], [1.4, 5.8, 0.15], c, { top: c2, tc: [0, 1, 0.6] });
    K.lit2.tri([0, 5.1, 0], [1.4, 5.8, 0.15], [1.35, 5.2, -0.1], c, { top: c2, tc: [0, 0.6, 0.2] });
    K.shadow(0.2, 0, 0.5, 0.5, 0.3);
  });
}
function hbKiosk(world, v) {
  return pf(world, 'kiosk' + v, (K) => {
    const wall = v ? 0xffe7b0 : 0xbfe6f5, aw = v ? [0x2f80ed, 0xffffff] : [0xe5533d, 0xffffff];
    K.lit.rbox(0, 0, 0, 3.0, 2.3, 2.0, 0.08, wall, { top: shadeHex(wall, 1.1) });
    K.lit.rbox(0, 2.25, 0, 3.4, 0.2, 2.4, 0.06, 0x4a5568, { top: 0x5c6a80 });
    K.lit.box(0, 0.95, 1.02, 2.2, 0.08, 0.5, 0xb7824a);                 // counter
    K.lit.box(0, 1.05, 1.0, 2.0, 0.9, 0.02, 0x20262e);                  // window opening
    K.glow.box(0, 1.1, 1.01, 1.9, 0.8, 0.01, 0xffd98a);
    // striped awning
    for (let i = 0; i < 7; i++) {
      const x0 = -1.75 + i * 0.5, c = aw[i % 2];
      K.lit2.quad4([x0, 2.0, 1.0], [x0 + 0.5, 2.0, 1.0], [x0 + 0.5, 1.55, 1.75], [x0, 1.55, 1.75], c, { top: shadeHex(c, 0.92), tc: [1, 1, 0, 0] });
    }
    K.lit.box(-1.4, 0, 1.0, 0.07, 1.6, 0.07, 0xdfe6ee, { ao: 0 }); K.lit.box(1.4, 0, 1.0, 0.07, 1.6, 0.07, 0xdfe6ee, { ao: 0 });
    // table + umbrella
    K.lit.cyl(2.2, 0, 1.6, 0.05, 0.05, 0.75, 0xdfe6ee, { seg: 6 }); K.lit.cyl(2.2, 0.72, 1.6, 0.45, 0.45, 0.05, 0xffffff, { seg: 10 });
    K.lit.cyl(2.2, 0, 1.6, 0.025, 0.025, 2.2, 0xdfe6ee, { seg: 5, ao: 0 });
    K.lit.cone(2.2, 2.0, 1.6, 1.15, 0.38, aw[0], { seg: 8, top: shadeHex(aw[0], 1.1) });
    K.lit.sph(2.2, 2.4, 1.6, 0.06, 0xffc21a, { seg: 5 });
    K.shadow(0.5, 0.3, 2.3, 1.7, 0.4);
  });
}
function hbCrane(world) {
  return pf(world, 'crane', (K) => {
    const frame = 0xdfe7ee, accent = 0xe5533d, dark = 0x39424f;
    const gx = 3.6, gz = 2.0, H = 14.0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      K.lit.box(sx * gx - 0.25, 0, sz * gz - 0.25, 0.5, H, 0.5, frame, { top: 0xffffff, g: [0.75, 1.05], ao: 0.4 });
      K.lit.box(sx * gx - 0.4, 0, sz * gz - 0.4, 0.8, 0.8, 0.8, accent, { ao: 0.1 });
      K.lit.box(sx * gx - 0.45, 0, sz * gz - 0.9, 0.9, 0.35, 1.8, dark, { ao: 0.1 });
    }
    // portal beams
    for (const y of [4.6, 9.2, H - 0.4]) for (const sz of [-1, 1]) K.lit.box(-gx, y, sz * gz - 0.15, gx * 2, 0.35, 0.3, frame, { g: [0.85, 1.0], ao: 0.1 });
    for (const y of [4.6, 9.2, H - 0.4]) for (const sx of [-1, 1]) K.lit.box(sx * gx - 0.15, y, -gz, 0.3, 0.35, gz * 2, frame, { g: [0.85, 1.0], ao: 0.1 });
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {   // diagonal braces
      K.lit.box(sx * gx, 4.6, sz * gz, 0.2, 5.0, 0.2, frame, { rz: sx * 0.38, ao: 0 });
      K.lit.box(sx * gx, 9.2, sz * gz, 0.2, 5.0, 0.2, frame, { rz: -sx * 0.38, ao: 0 });
    }
    // machinery house + cab
    K.lit.rbox(0, H - 0.05, 0, 5.6, 1.6, 3.4, 0.12, accent, { top: 0xff7a59 });
    K.lit.rbox(-1.2, H + 1.5, 1.0, 1.4, 1.1, 1.2, 0.1, 0xffffff);
    K.glow.box(-1.2, H + 1.75, 1.61, 1.0, 0.6, 0.01, 0xaee8ff);
    // booms: seaward (local -z) long, landward short
    K.lit.box(-0.55, H + 0.3, -17, 1.1, 0.7, 17.5, 0xf2a900, { top: 0xffd24a, g: [0.8, 1.05], ao: 0.1 });
    K.lit.box(-0.55, H + 0.3, 0.8, 1.1, 0.7, 5.5, 0xf2a900, { top: 0xffd24a, ao: 0.1 });
    for (let i = 0; i < 10; i++) K.lit.box(-0.2, H + 0.75, -16.4 + i * 1.65, 0.4, 0.5, 0.2, 0xf2a900, { rx: 0.0, ao: 0, g: [1, 1] });
    // stay cables
    K.lit.tube([[0, H + 1.0, 0.5], [0, H + 4.2, 0], [0, H + 1.0, -8], [0, H + 0.9, -16.2]], 0.05, 0x39424f, { segs: 12 });
    // trolley, hoist cables and spreader with a container
    K.lit.box(-0.6, H + 0.0, -12, 1.2, 0.35, 1.6, dark);
    for (const sx of [-0.5, 0.5]) K.lit.cyl(sx, H - 6.2, -12, 0.03, 0.03, 6.2, 0x20262e, { seg: 4, ao: 0, g: [1, 1] });
    K.lit.box(-1.4, H - 6.5, -13.3, 2.8, 0.25, 2.6, dark);
    K.stamp(hbContainer(world, 2), 0, H - 9.15, -12, PI / 2, 1);
    // lights
    K.glow.sph(0, H + 2.7, 0, 0.14, 0xff3d3d, { seg: 5 });
    K.halo_(0, H + 2.7, 0, 1.0, 0xff3d3d, 0.45);
    K.shadow(0, 0, 5.0, 3.2, 0.35);
  });
}
function hbLighthouse(world) {
  return pf(world, 'lighthouse', (K) => {
    const bands = [0xffffff, 0xe5533d, 0xffffff, 0xe5533d];
    let y = 0.0;
    K.lit.cyl(0, 0, 0, 2.0, 1.85, 0.5, 0x9a9484, { seg: 14, top: 0xb5ae9c });
    y = 0.5;
    const heights = [3.0, 2.8, 2.8, 2.6], r0 = [1.55, 1.42, 1.3, 1.18], r1 = [1.42, 1.3, 1.18, 1.06];
    for (let i = 0; i < 4; i++) { K.lit.cyl(0, y, 0, r0[i], r1[i], heights[i], bands[i], { seg: 14, g: [0.82, 1.06] }); y += heights[i]; }
    K.lit.cyl(0, y, 0, 1.55, 1.3, 0.28, 0x39424f, { seg: 14 });
    K.lit.cyl(0, y + 0.28, 0, 1.5, 1.5, 0.08, 0x39424f, { seg: 14, ao: 0 });
    K.lit.tor(0, y + 0.85, 0, 1.45, 0.05, 0xdfe6ee, { rx: PI / 2 });
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; K.lit.cyl(Math.cos(a) * 1.45, y + 0.3, Math.sin(a) * 1.45, 0.035, 0.035, 0.58, 0xdfe6ee, { seg: 4, ao: 0 }); }
    K.glow.cyl(0, y + 0.3, 0, 0.78, 0.78, 1.3, 0xfff0a0, { seg: 12 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; K.lit.box(Math.cos(a) * 0.8 - 0.04, y + 0.3, Math.sin(a) * 0.8 - 0.04, 0.08, 1.3, 0.08, 0x39424f, { ao: 0 }); }
    K.lit.cyl(0, y + 1.6, 0, 1.0, 0.0, 1.0, 0xe5533d, { seg: 12, top: 0xff7a59 });
    K.lit.sph(0, y + 2.65, 0, 0.12, 0xffc21a, { seg: 6 });
    K.halo_(0, y + 0.95, 0, 3.0, 0xfff0b0, 0.2);
    K.shadow(0.4, 0, 2.6, 2.4, 0.4);
  });
}
function hbCottage(world) {
  return pf(world, 'cottage', (K) => {
    K.lit.rbox(0, 0, 0, 4.2, 2.3, 3.2, 0.08, 0xfff1d6, { top: 0xffffff });
    K.lit.prism(0, 2.2, 0, 3.8, 1.6, 4.8, 0xd9573f, { ry: PI / 2, top: 0xf0735a });
    K.lit.box(-0.5, 0, 1.62, 0.9, 1.7, 0.06, 0x2f80ed);
    for (const x of [1.0, -1.45]) { K.lit.box(x - 0.4, 1.0, 1.61, 0.8, 0.8, 0.05, 0xffffff); K.glow.box(x - 0.32, 1.08, 1.64, 0.64, 0.64, 0.01, 0x9ad8ff); }
    K.lit.box(1.2, 2.4, -0.7, 0.5, 1.4, 0.5, 0xb87a5a);
    K.shadow(0.2, 0, 3.0, 2.4, 0.4);
  });
}
function hbWarehouse(world, v) {
  return pf(world, 'warehouse' + v, (K) => {
    const wall = [0xf4e6c8, 0x9fc3d9, 0xe7a98f][v % 3], roof = [0xd9573f, 0x4a5a78, 0x2f8d7a][v % 3];
    const w = 11.0, d = 4.4, h = 3.7;
    K.lit.rbox(0, 0, 0, w, h, d, 0.08, wall, { top: shadeHex(wall, 1.1), g: [0.8, 1.05] });
    K.lit.prism(0, h - 0.05, 0, d + 0.8, 1.7, w + 0.7, roof, { ry: PI / 2, top: shadeHex(roof, 1.2), g: [0.85, 1.05] });
    for (let i = 0; i < 12; i++) K.lit.box(-w / 2 - 0.25 + i * ((w + 0.5) / 11) - 0.03, h + 0.78, -0.4, 0.06, 0.04, d * 0.6, shadeHex(roof, 0.85), { ao: 0, g: [1, 1], rz: 0 });
    // trim band and rolling door
    K.lit.box(-w / 2 - 0.01, 3.0, d / 2 - 0.02, w + 0.02, 0.3, 0.06, shadeHex(wall, 0.8), { ao: 0 });
    K.lit.box(-1.8, 0, d / 2 - 0.02, 3.6, 2.9, 0.08, 0x55657a, { top: 0x6e819a, g: [0.8, 1.05], ao: 0.1 });
    for (let i = 0; i < 8; i++) K.lit.box(-1.8, 0.3 + i * 0.34, d / 2 + 0.03, 3.6, 0.04, 0.03, 0x3d4a5c, { ao: 0, g: [1, 1] });
    K.lit.box(-1.8, 2.92, d / 2 - 0.02, 3.6, 0.14, 0.12, 0xf2a900, { ao: 0 });
    for (const x of [-4.3, -3.2, 2.2, 3.4, 4.5]) { K.lit.box(x - 0.45, 1.8, d / 2 - 0.02, 0.9, 1.0, 0.07, 0xffffff, { ao: 0 }); K.glow.box(x - 0.38, 1.88, d / 2 + 0.02, 0.76, 0.84, 0.01, 0x9ad8ff); K.lit.box(x - 0.02, 1.88, d / 2 + 0.03, 0.04, 0.84, 0.02, 0xffffff, { ao: 0, g: [1, 1] }); }
    K.lit.box(4.3, 0, d / 2 - 0.02, 1.0, 2.1, 0.08, 0xe5533d, { ao: 0.1 });
    // sign
    K.lit.rbox(-1.8, 3.1, d / 2 + 0.0, 3.0, 0.5, 0.1, 0.04, 0x1f3a5f, {});
    K.glow.box(-3.05, 3.22, d / 2 + 0.06, 0.5, 0.26, 0.01, 0xffc21a); K.glow.box(-2.3, 3.22, d / 2 + 0.06, 1.8, 0.26, 0.01, 0xffffff);
    // side details: pipe + lamp
    K.lit.cyl(5.2, 0, d / 2 - 0.15, 0.09, 0.09, 3.6, 0x8a97a6, { seg: 6 });
    K.lit.box(-w / 2 + 0.2, 0, -1, 0.9, 0.8, 0.9, 0x8a97a6);
    K.shadow(0.2, -0.2, 6.2, 3.3, 0.4);
  });
}
function hbJetty(world, v) {
  return pf(world, 'jetty' + v, (K) => {
    // origin at the quay edge; the jetty runs outwards along local -z; boats sit on the sea (y = SEA_Y)
    const L = 9.0, wdt = 1.9;
    for (let i = 0; i < 9; i++) K.lit.box(-wdt / 2, 0.02, -i * 1.0 - 0.5, wdt, 0.1, 0.95, i % 2 ? 0xa97542 : 0xb7824a, { ao: 0, top: 0xd09a5a, g: [0.95, 1.05] });
    for (const sx of [-1, 1]) {
      K.lit.box(sx * (wdt / 2 - 0.08), -0.1, -L / 2, 0.16, 0.14, L, 0x6b4a2a, { ao: 0 });
      for (let i = 0; i < 3; i++) K.lit.cyl(sx * (wdt / 2 - 0.02), -1.6, -0.6 - i * 3.6, 0.12, 0.11, 2.1, 0x5a3d22, { seg: 5, top: 0x7a5030, ao: 0 });
    }
    for (const z of [-0.5, -4.5, -8.5]) for (const sx of [-1, 1]) {
      K.lit.cyl(sx * 0.85, 0.12, z, 0.1, 0.09, 0.3, 0x39424f, { seg: 6, top: 0x5b6677 });
    }
    K.lit.cyl(0.0, 0.12, -L + 0.4, 0.05, 0.05, 2.6, 0xdfe6ee, { seg: 5 });
    K.glow.sph(0, 2.8, -L + 0.4, 0.14, 0xfff3c4, { seg: 6 });
    K.halo_(0, 2.8, -L + 0.4, 0.9, 0xfff0b0, 0.25);
    const boatA = hbSailboat(world, v), boatB = hbSailboat(world, v + 1);
    K.stamp(boatA, -2.55, SEA_Y, -3.2, 0.05, 1);
    K.stamp(boatB, 2.6, SEA_Y, -6.8, -0.08, 0.95);
    ropeBetween(K, -1.0, 0.45, -0.5, -2.2, 0xe9d3a0, 0.02);
    K.lit.tube([[-0.95, 0.2, -0.5], [-1.5, 0.15, -1.2], [-2.2, 0.35, -2.0]], 0.02, 0xe9d3a0, { segs: 6, rad: 3, ao: 0 });
    K.lit.tube([[0.95, 0.2, -4.5], [1.6, 0.15, -5.4], [2.3, 0.35, -6.1]], 0.02, 0xe9d3a0, { segs: 6, rad: 3, ao: 0 });
  });
}
function hbSailboat(world, v) {
  const hulls = [[0x1f3a5f, 0xffffff], [0xe5533d, 0xffffff], [0x20b2a0, 0xf2f6fa]];
  const hc = hulls[((v % 3) + 3) % 3];
  return pf(world, 'sailboat' + (((v % 3) + 3) % 3), (K) => {
    // origin = waterline; the hull is a half ellipsoid hanging below the deck level (y = 0.62)
    K.lit.dome(0, 0.62, 0, 1.0, hc[0], { sx: 0.82, sy: 1.0, sz: 2.8, rx: PI, top: hc[0], g: [0.7, 1.0], seg: 10, ao: 0 });
    K.lit.cyl(0, 0.5, 0, 0.82, 0.82, 0.14, hc[1], { sx: 1, sz: 2.8 / 0.82, seg: 10, ao: 0, g: [1, 1] });
    K.lit.cyl(0, 0.6, 0, 0.78, 0.78, 0.05, 0xcf9a5c, { sx: 1, sz: 2.72 / 0.78, seg: 10, ao: 0, g: [1, 1], top: 0xe3b274 });
    K.lit.box(-0.45, 0.66, -0.15, 0.9, 0.45, 1.3, 0xffffff, { top: 0xf4f8ff });
    K.glow.box(-0.462, 0.9, 0.3, 0.02, 0.18, 0.7, 0x7ccfff);
    K.glow.box(0.442, 0.9, 0.3, 0.02, 0.18, 0.7, 0x7ccfff);
    K.lit.cyl(0, 0.62, -0.4, 0.045, 0.035, 6.6, 0xe9eef4, { seg: 6 });
    K.lit.box(-0.03, 1.2, -2.2, 0.06, 0.06, 2.0, 0xe9eef4, { ao: 0, g: [1, 1] });
    const sail = hc[1] === 0xffffff ? 0xffffff : 0xf8fbff;
    K.lit2.tri([0, 1.35, -0.45], [0, 6.9, -0.45], [0.18, 1.5, -2.3], sail, { top: 0xdfe9f4, tc: [0, 1, 0] });
    K.lit2.tri([0, 1.35, -0.45], [0.18, 1.5, -2.3], [0.2, 1.3, -1.0], sail, { top: 0xdfe9f4, tc: [0, 0, 0] });
    K.lit2.tri([0, 1.2, 0.3], [0, 6.4, -0.35], [0, 0.85, 2.3], hc[0], { top: shadeHex(hc[0], 1.4), tc: [0, 1, 0] });
    K.lit2.tri([0.0, 6.8, -0.45], [0, 7.25, -0.45], [0.5, 7.0, -0.2], 0xffc21a, { tc: [0, 0, 0] });
    K.shadow(0, 0, 1.5, 3.5, 0.5, 0, 0.03, 0xffffff);
  });
}
function hbBollardRow() { return null; }

function genHarbor(world, side, len, rng) {
  const S = new Chunk(world, side, len, rng);
  const ci = () => Math.floor(rng() * HB_CONT.length);
  const H = GROUND_HALF.harbor;
  const T = [
    { w: 10, weight: 3, fn: (S, z) => {          // container yard
      const a = ci(), b = ci(), c = ci(), d = ci();
      S.put(hbStack(world, 'stackA' + a + b + c, [{ ci: a, x: 0, y: 0, z: 0 }, { ci: b, x: 0, y: 2.55, z: 0, yaw: 0.02 }, { ci: c, x: 0, y: 0, z: -2.7 }]), 12.4, z - 2.4, { face: true });
      S.put(hbStack(world, 'stackB' + d, [{ ci: d, x: 0, y: 0, z: 0, yaw: PI / 2 }]), 9.6, z + 3.1, { face: true });
      S.put(hbCrates(world), 9.0, z - 2.2, { face: true, yaw: 0.3, tint: 0.05 });
      S.put(hbBarrels(world), 9.2, z + 0.4, { yaw: rng() * 3 });
    } },
    { w: 13, weight: 2.6, fn: (S, z) => {          // warehouse
      S.put(hbWarehouse(world, Math.floor(rng() * 3)), 12.9, z, { face: true });
      S.put(hbBed(world, Math.floor(rng() * 2)), 9.1, z - 3.2, { face: true });
      S.put(hbTree(world, 0), 9.4, z + 3.6, { yaw: rng() * 6, tint: 0.06 });
      S.put(hbBench(world), 9.3, z + 0.6, { face: true });
      S.put(hbFlag(world, Math.floor(rng() * 3)), 9.5, z - 5.7);
    } },
    { w: 13, weight: 2.4, fn: (S, z) => {          // ship-to-shore crane with a container underneath
      S.put(hbCrane(world), 11.2, z, { face: true });
      const a = ci();
      S.put(hbStack(world, 'under' + a, [{ ci: a, x: 0, y: 0, z: 0, yaw: 0 }]), 11.2, z, { face: true, yaw: 0 });
      S.put(hbStack(world, 'stackC' + ((a + 3) % 8), [{ ci: (a + 3) % 8, x: 0, y: 0, z: 0 }, { ci: (a + 5) % 8, x: 0, y: 2.55, z: 0 }]), 9.5, z + 5.2, { face: true, yaw: PI / 2 });
      S.put(hbCrates(world), 9.0, z - 4.6, { face: true, yaw: 0.2 });
    } },
    { w: 9.5, weight: 2.3, fn: (S, z) => {          // park corner
      S.put(hbTree(world, 1), 9.6, z - 2.2, { yaw: rng() * 6, tint: 0.06 });
      S.put(hbTree(world, 2), 12.6, z + 2.3, { yaw: rng() * 6, tint: 0.06 });
      S.put(hbTree(world, 0), 12.0, z - 3.2, { yaw: rng() * 6, tint: 0.06 });
      S.put(hbBed(world, 0), 9.3, z + 2.4, { face: true });
      S.put(hbBench(world), 10.8, z - 0.1, { face: true });
      S.put(hbFlag(world, 1), 14.2, z + 0.6);
    } },
    { w: 11, weight: 1.5, fn: (S, z) => {          // lighthouse point
      S.put(hbLighthouse(world), 13.6, z + 0.8, { yaw: 0 });
      S.put(hbCottage(world), 10.2, z - 2.4, { face: true });
      S.put(hbBed(world, 1), 9.2, z + 3.4, { face: true });
    } },
    { w: 12, weight: 2.6, fn: (S, z) => {          // marina with a jetty
      S.put(hbJetty(world, Math.floor(rng() * 3)), H - 1.28, z, { face: true, yaw: 0 });
      S.put(hbKiosk(world, Math.floor(rng() * 2)), 10.4, z - 0.4, { face: true });
      S.put(hbTree(world, 1), 9.0, z + 4.4, { yaw: rng() * 6, tint: 0.06 });
      S.put(hbBed(world, 1), 9.1, z - 4.4, { face: true });
      S.put(hbBarrels(world), 12.8, z + 4.2, { yaw: 1 });
    } },
  ];
  S.compose(T, (S) => {
    const tufts = [tuftPrefab(world, 'tuftA', [0x4f9f44, 0x7cc552, 0x3f8a3c]), tuftPrefab(world, 'tuftB', [0x5cae4a, 0x8ad45a, 0x4a9a3e], 0.5, 7)];
    S.scatter(tufts, 26, 8.6, 14.5);
    S.scatter([flowerPrefab(world, 'fl1', 0xffffff, 0xffc21a), flowerPrefab(world, 'fl2', 0xff9ecf, 0xffe27a), flowerPrefab(world, 'fl3', 0xb39dff, 0xffffff)], 10, 8.6, 14.5, { tint: 0 });
  });
  return S.group();
}

// ===================================================================================================
// NEON BAY: glowing skyscrapers, billboards, holo globes, neon palms, monorail, lantern strings
// ===================================================================================================
const NEON_TINT = [0xffffff, 0xd6c6ff, 0xb4f0ff, 0xffc4ef];
const NEON_COL = [0xff3df2, 0x39f3ff, 0xffe14d, 0x7b61ff, 0x3dff9a];

function nSkyscraper(world, v) {
  const S = [
    { w: 6.0, d: 4.5, h: 25.5, c: 0x39f3ff, c2: 0xff3df2 }, { w: 7.5, d: 4.5, h: 18.7, c: 0xff3df2, c2: 0x39f3ff },
    { w: 4.5, d: 4.5, h: 32.3, c: 0xffe14d, c2: 0x39f3ff }, { w: 6.0, d: 4.5, h: 21.3, c: 0x3dff9a, c2: 0xff3df2 },
    { w: 7.5, d: 4.5, h: 28.9, c: 0x7b61ff, c2: 0x39f3ff },
  ][v % 5];
  return pf(world, 'sky' + v, (K) => {
    const { w, d, h } = S, pod = 5.1, tint = NEON_TINT[v % 4];
    K.fac.fbox(0, 0, 0, w + 1.5, pod, d + 0.9, tint);
    K.fac.fbox(0, pod, 0, w, h - pod, d, tint);
    // roof cap and details
    K.lit.rbox(0, h - 0.05, 0, w + 0.3, 0.4, d + 0.3, 0.06, 0x2b2550, { top: 0x3a3070, ao: 0 });
    K.glow.box(-w / 2 - 0.15, h + 0.3, d / 2 + 0.1, w + 0.3, 0.1, 0.08, S.c);
    K.glow.box(-w / 2 - 0.15, h + 0.3, -d / 2 - 0.18, w + 0.3, 0.1, 0.08, S.c);
    K.lit.box(-w / 4, h + 0.35, 0, 1.4, 0.8, 1.2, 0x4a4090, { ao: 0 });
    K.lit.box(w / 4 - 0.4, h + 0.35, -0.5, 1.0, 0.6, 1.0, 0x4a4090, { ao: 0 });
    K.lit.cyl(w / 3, h + 0.3, d / 4, 0.07, 0.04, 4.0, 0x6a5aa8, { seg: 5 });
    K.glow.sph(w / 3, h + 4.4, d / 4, 0.16, 0xff3d5a, { seg: 5 });
    K.halo_(w / 3, h + 4.4, d / 4, 1.3, 0xff3d5a, 0.5);
    // neon corner strips (front corners) and a podium band
    for (const sx of [-1, 1]) K.glow.box(sx * (w / 2) - 0.05, pod, d / 2 - 0.02, 0.1, h - pod, 0.1, sx > 0 ? S.c : S.c2);
    for (const sx of [-1, 1]) K.glow.box(sx * ((w + 1.5) / 2) - 0.06, 0, (d + 0.9) / 2 - 0.02, 0.12, pod, 0.1, sx > 0 ? S.c2 : S.c);
    K.glow.box(-(w + 1.5) / 2, pod - 0.05, (d + 0.9) / 2 - 0.01, w + 1.5, 0.12, 0.08, S.c2);
    K.glow.box(-(w + 1.5) / 2, 0.9, (d + 0.9) / 2 + 0.01, w + 1.5, 0.1, 0.06, S.c);
    // big vertical sign on the tower
    if (v % 2 === 0) { K.sig.sigQuad(w / 2 - 0.9, pod + 4.2, d / 2 + 0.1, 1.6, 1.6, (v * 3) % 8, 0xffffff); K.sig.sigQuad(w / 2 - 0.9, pod + 6.1, d / 2 + 0.1, 1.6, 1.6, (v * 3 + 1) % 8, 0xffffff); }
    K.sig.sigQuad(-0.4, 2.0, (d + 0.9) / 2 + 0.06, 1.7, 1.7, (v + 2) % 8, 0xffffff);
    K.halo_(0, h + 0.4, d / 2, 3.0, S.c, 0.25);
    K.halo_(0, 3.0, d / 2 + 0.6, 3.5, S.c2, 0.2);
    K.shadow(0.4, 0.3, w * 0.75, d * 0.8, 0.5);
  });
}
function nShop(world, v) {
  const body = [0x2b2550, 0x3a2f78, 0x241d4a][v % 3], c1 = NEON_COL[v % 5], c2 = NEON_COL[(v + 1) % 5];
  return pf(world, 'shop' + v, (K) => {
    K.lit.rbox(0, 0, 0, 4.6, 3.0, 2.2, 0.08, body, { top: shadeHex(body, 1.3) });
    K.lit.rbox(0, 2.95, 0, 5.0, 0.2, 2.6, 0.05, 0x1a1540, { top: 0x2b2550, ao: 0 });
    K.glow.box(-2.3, 2.7, 1.12, 4.6, 0.1, 0.05, c1);
    K.glow.box(-2.1, 0.5, 1.12, 2.4, 1.7, 0.04, shadeHex(c2, 0.55));
    K.lit.box(-2.1, 0.5, 1.1, 0.05, 1.7, 0.05, 0x1a1540); K.lit.box(-0.9, 0.5, 1.1, 0.05, 1.7, 0.05, 0x1a1540); K.lit.box(0.3, 0.5, 1.1, 0.05, 1.7, 0.05, 0x1a1540);
    K.glow.box(0.8, 0.0, 1.12, 1.2, 2.0, 0.04, shadeHex(c1, 0.35));
    for (let i = 0; i < 6; i++) { const c = i % 2 ? c1 : 0xffffff; K.lit2.quad4([-2.3 + i * 0.77, 2.5, 1.1], [-1.53 + i * 0.77, 2.5, 1.1], [-1.53 + i * 0.77, 2.1, 1.75], [-2.3 + i * 0.77, 2.1, 1.75], c, { top: shadeHex(c, 0.8), tc: [1, 1, 0, 0] }); }
    K.sig.sigQuad(-1.3, 3.25, 1.1, 1.1, 1.1, (v * 2 + 1) % 8, 0xffffff);
    K.halo_(0, 1.5, 1.6, 2.6, c2, 0.25);
    K.shadow(0.2, 0.2, 3.0, 1.9, 0.45);
  });
}
function nBillboard(world, v) {
  return pf(world, 'billboard' + v, (K) => {
    const c = NEON_COL[v % 5], c2 = NEON_COL[(v + 2) % 5];
    for (const sx of [-1, 1]) { K.lit.cyl(sx * 2.4, 0, 0, 0.22, 0.16, 6.4, 0x2b2550, { seg: 6, top: 0x4a4090 }); K.lit.box(sx * 2.4 - 0.4, 0, -0.4, 0.8, 0.25, 0.8, 0x1a1540); }
    K.lit.rbox(0, 5.3, 0, 7.4, 3.8, 0.3, 0.06, 0x1a1540, { ao: 0, g: [1, 1] });
    K.sig.sigQuad(-1.75, 5.5, 0.17, 3.4, 3.4, v % 8, 0xffffff, { ry: 0 });
    K.sig.sigQuad(1.75, 5.5, 0.17, 3.4, 3.4, (v + 3) % 8, 0xffffff, { ry: 0 });
    K.glow.box(-3.7, 5.3, 0.15, 7.4, 0.12, 0.08, c); K.glow.box(-3.7, 9.0, 0.15, 7.4, 0.12, 0.08, c2);
    K.glow.box(-3.7, 5.3, 0.15, 0.12, 3.8, 0.08, c2); K.glow.box(3.58, 5.3, 0.15, 0.12, 3.8, 0.08, c);
    for (const sx of [-1.8, 0, 1.8]) { K.lit.cyl(sx, 9.1, 0.1, 0.04, 0.04, 0.9, 0x4a4090, { seg: 4, rx: -0.9, ao: 0 }); K.glow.sph(sx, 9.55, 0.45, 0.1, 0xfff2c9, { seg: 5 }); }
    K.halo_(0, 7.2, 0.8, 5.5, c, 0.28);
    K.shadow(0, 0, 3.6, 1.0, 0.3);
  });
}
function nPalm(world, v) {
  return pf(world, 'npalm' + v, (K) => {
    const h = 4.6 + v * 0.9, top = leanTrunk(K, 0, 0, h, 0.1, 0.18, 0.1, 0x2a2050, 0x3a2f78, 6);
    const cA = v % 2 ? 0x39f3ff : 0xff3df2, cB = v % 2 ? 0xb8fbff : 0xffb0f8;
    for (let i = 0; i < 8; i++) frond(K, top[0], top[1] + 0.05, top[2], (i / 8) * TAU + 0.2, 2.0, 0.6, 1.0, 0.42, cA, cB, 3, K.glow);
    K.glow.sph(top[0], top[1] + 0.1, top[2], 0.18, 0xffe14d, { seg: 5 });
    for (let i = 0; i < 4; i++) K.glow.cyl(0, 0.8 + i * (h / 5), 0, 0.2 - i * 0.015, 0.2 - i * 0.015, 0.06, i % 2 ? 0x39f3ff : 0xff3df2, { seg: 7 });
    K.halo_(top[0], top[1] + 0.2, top[2], 2.4, cA, 0.3);
    K.shadow(0.3, 0, 1.6, 1.6, 0.4);
  });
}
function nSakura(world, v) {
  return pf(world, 'sakura' + v, (K) => {
    const h = 3.0 + v * 0.5;
    K.lit.cyl(0, 0, 0, 0.2, 0.12, h * 0.7, 0x2a2050, { seg: 6 });
    K.lit.cyl(0, h * 0.5, 0, 0.09, 0.06, h * 0.4, 0x2a2050, { seg: 5, rz: 0.7 });
    const cs = [[0xff6ad9, 0xffb5ee], [0xff8ae0, 0xffd0f5]];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26, r = i ? 0.95 : 0.0, c = cs[i % 2];
      K.lit.ico(Math.cos(a) * r, h * 0.85 + (i % 2) * 0.3, Math.sin(a) * r, 1.0 + (i === 0 ? 0.2 : 0), c[0], { top: c[1], flat: true, det: 1, rough: 0.2, g: [0.9, 1.1] });
    }
    for (let i = 0; i < 9; i++) K.glow.ico(Math.cos(i * 2.4) * 1.5, h * 0.85 + Math.sin(i * 1.7) * 0.8, Math.sin(i * 2.4) * 1.4, 0.06, 0xfff0fb, { det: 0 });
    K.halo_(0, h * 0.9, 0, 2.4, 0xff5ad8, 0.18);
    K.shadow(0.2, 0.1, 2.0, 2.0, 0.4);
  });
}
function nGlobe(world) {
  return pf(world, 'globe', (K) => {
    K.lit.cyl(0, 0, 0, 0.7, 0.5, 0.5, 0x2b2550, { seg: 10, top: 0x4a4090 });
    K.glow.cyl(0, 0.5, 0, 0.42, 0.42, 0.07, 0x39f3ff, { seg: 10 });
    for (const [rx, ry] of [[0, 0], [PI / 2, 0], [0, PI / 2]]) K.glow.tor(0, 1.6, 0, 0.8, 0.035, 0x39f3ff, { rx, ry });
    K.glow.sph(0, 1.6, 0, 0.28, 0xff3df2, { seg: 6 });
    K.halo_(0, 1.6, 0, 2.2, 0x39f3ff, 0.45);
    K.shadow(0, 0, 1.0, 1.0, 0.4);
  });
}
function nVending(world, v) {
  const c = NEON_COL[v % 5];
  return pf(world, 'vend' + v, (K) => {
    K.lit.rbox(0, 0, 0, 1.0, 2.0, 0.8, 0.06, 0x2b2550, { top: 0x4a4090 });
    K.glow.box(-0.4, 0.5, 0.405, 0.8, 1.2, 0.02, c);
    for (let i = 0; i < 4; i++) K.glow.box(-0.35 + (i % 2) * 0.4, 0.65 + Math.floor(i / 2) * 0.55, 0.42, 0.28, 0.4, 0.01, i % 2 ? 0xffffff : 0xffe14d);
    K.halo_(0, 1.0, 0.7, 1.8, c, 0.3);
    K.shadow(0, 0, 0.8, 0.6, 0.4);
  });
}
function nLanternString(world, v) {
  return pf(world, 'lant' + v, (K) => {
    const L = 8.0;
    for (const z of [0, -L]) { K.lit.cyl(0, 0, z, 0.1, 0.07, 3.6, 0x2b2550, { seg: 6, top: 0x4a4090 }); K.glow.sph(0, 3.65, z, 0.1, 0xffe14d, { seg: 5 }); }
    const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([0, 3.55 - Math.sin(t * PI) * 0.6, -L * t]); }
    K.lit.tube(pts, 0.025, 0x20193f, { segs: 12, rad: 3, ao: 0 });
    for (let i = 1; i < 8; i++) {
      const p = pts[i], c = NEON_COL[(i + v) % 5];
      K.glow.sph(p[0], p[1] - 0.25, p[2], 0.2, c, { seg: 6, sy: 1.2 });
      K.halo_(p[0], p[1] - 0.25, p[2], 0.7, c, 0.45);
    }
  });
}
function nTrain(world) {
  return pf(world, 'train', (K) => {
    for (let c = 0; c < 2; c++) {
      const z = -c * 5.3;
      K.lit.rbox(0, 0, z, 2.6, 2.0, 5.0, 0.4, 0xf2f0ff, { top: 0xffffff, g: [0.75, 1.05], ao: 0 });
      K.glow.box(-1.31, 0.9, z - 2.2, 0.02, 0.6, 4.4, 0x9ad8ff); K.glow.box(1.29, 0.9, z - 2.2, 0.02, 0.6, 4.4, 0x9ad8ff);
      K.glow.box(-1.32, 0.3, z - 2.4, 0.03, 0.12, 4.8, 0xff3df2); K.glow.box(1.29, 0.3, z - 2.4, 0.03, 0.12, 4.8, 0xff3df2);
      K.lit.box(-1.1, 2.0, z - 1.5, 2.2, 0.2, 3.0, 0x7b61ff, { ao: 0 });
    }
    K.glow.box(-0.7, 0.5, 2.5, 1.4, 0.35, 0.03, 0xfff0a0);
    K.halo_(0, 0.7, 3.0, 1.6, 0xfff0b0, 0.5);
  });
}

function genNeon(world, side, len, rng) {
  const S = new Chunk(world, side, len, rng);
  const K = S.kit;
  const ri = (n) => Math.floor(rng() * n);
  // monorail along the bay (continuous beam, pylons at fixed z)
  const bx = side * 15.9;
  K.lit.box(bx - 0.8, 7.0, -len, 1.6, 0.8, len, 0xe9e4ff, { top: 0xffffff, ao: 0, g: [0.7, 1.05] });
  K.lit.box(bx - 0.9, 7.0, -len, 0.12, 0.12, len, 0x7b61ff, { ao: 0, g: [1, 1] });
  K.glow.box(bx - 0.82, 7.08, -len, 0.05, 0.08, len, 0x39f3ff); K.glow.box(bx + 0.77, 7.08, -len, 0.05, 0.08, len, 0x39f3ff);
  K.glow.box(bx - 0.3, 6.96, -len, 0.6, 0.05, len, 0xff3df2);
  for (const z of [-7.5, -22.5]) {
    K.lit.cyl(bx, 0, z, 0.55, 0.38, 6.2, 0x4a4090, { seg: 8, top: 0x7b61ff });
    K.lit.rbox(bx, 6.1, z, 3.0, 0.7, 1.0, 0.1, 0x2b2550, { ao: 0 });
    K.glow.box(bx - 0.3, 0.9, z + 0.52, 0.6, 0.06, 0.02, 0x39f3ff);
    K.shadow(bx, z, 1.2, 1.2, 0.4);
  }
  if (rng() < 0.4) { const z = -len * (0.35 + 0.3 * rng()); K.stamp(nTrain(world), bx, 7.8, z + 4, 0, 1); }
  const T = [
    { w: 11, weight: 3, fn: (S, z) => {
      S.put(nSkyscraper(world, ri(5)), 13.0, z - 2.6, { face: true });
      S.put(nShop(world, ri(3)), 9.7, z - 3.0, { face: true });
      S.put(nSkyscraper(world, ri(5)), 12.6, z + 3.4, { face: true });
      S.put(nVending(world, ri(5)), 9.2, z + 3.4, { face: true });
      S.put(nPalm(world, ri(3)), 9.0, z + 0.2, { yaw: rng() * 6 });
    } },
    { w: 10, weight: 2.4, fn: (S, z) => {
      S.put(nBillboard(world, ri(8)), 11.4, z - 0.4, { face: true });
      S.put(nSkyscraper(world, ri(5)), 14.0, z + 3.0, { face: true });
      S.put(nSakura(world, ri(2)), 9.5, z + 3.2, { yaw: rng() * 6 });
      S.put(nVending(world, ri(5)), 9.0, z - 3.6, { face: true });
      S.put(nPalm(world, ri(3)), 9.0, z - 2.0, { yaw: rng() * 6 });
    } },
    { w: 9, weight: 2.0, fn: (S, z) => {
      S.put(nSakura(world, 0), 10.2, z - 1.6, { yaw: 1 });
      S.put(nSakura(world, 1), 12.6, z + 2.0, { yaw: 2 });
      S.put(nGlobe(world), 9.3, z + 0.9, {});
      S.put(nPalm(world, ri(3)), 9.0, z - 3.5, { yaw: rng() * 6 });
      S.put(nLanternString(world, ri(5)), 10.4, z + 3.8 + 0, { face: true, yaw: 0 });
      S.put(nSkyscraper(world, ri(5)), 14.2, z - 1.0, { face: true });
    } },
    { w: 12, weight: 2.4, fn: (S, z) => {
      S.put(nSkyscraper(world, 2), 13.2, z - 4.2, { face: true });
      S.put(nSkyscraper(world, 4), 13.6, z + 2.6, { face: true });
      S.put(nShop(world, ri(3)), 9.7, z - 0.6, { face: true });
      S.put(nPalm(world, ri(3)), 9.0, z + 4.0, { yaw: rng() * 6 });
      S.put(nLanternString(world, ri(5)), 9.3, z - 5.9, { face: true });
    } },
    { w: 10, weight: 2.0, fn: (S, z) => {
      S.put(nShop(world, ri(3)), 9.7, z - 3.2, { face: true });
      S.put(nShop(world, ri(3)), 9.7, z + 2.4, { face: true });
      S.put(nBillboard(world, ri(8)), 13.2, z + 0.4, { face: true, s: 1.1 });
      S.put(nSkyscraper(world, ri(5)), 14.4, z - 3.6, { face: true });
    } },
  ];
  S.compose(T, (S) => {
    const tufts = [tuftPrefab(world, 'ntuft', [0x3a3070, 0x7b61ff, 0x2a2050], 0.38, 5)];
    S.scatter(tufts, 14, 8.6, 14);
  });
  return S.group();
}

// ===================================================================================================
// CORAL ISLANDS: palms, tiki bars, beach umbrellas, surfboards, lifeguard towers, hammocks, bungalows, reef
// ===================================================================================================
const CO_PAL = [0xff6f61, 0x2ec4b6, 0xffbf69, 0xff9f1c, 0xcbf3f0, 0xff8fb8];

function coPalm(world, v) {
  return palmPrefab(world, 'palm' + v, [
    { h: 6.4, lean: 0.14, nf: 9, fl: 2.7 }, { h: 5.2, lean: -0.18, nf: 8, fl: 2.4 }, { h: 7.6, lean: 0.1, nf: 10, fl: 3.0, r0: 0.28 }, { h: 4.0, lean: 0.22, nf: 7, fl: 2.1 },
  ][v % 4]);
}
function coTiki(world) {
  return pf(world, 'tiki', (K) => {
    K.lit.cyl(0, 0, 0, 2.1, 2.1, 0.22, 0x9a6a3a, { seg: 10, top: 0xc08a50 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.3; K.lit.cyl(Math.cos(a) * 1.8, 0.2, Math.sin(a) * 1.8, 0.09, 0.08, 2.1, 0xc99a4a, { seg: 6, top: 0xe3bb68 }); }
    K.lit.cyl(0, 2.2, 0, 2.55, 2.7, 0.35, 0xb8903f, { seg: 10, top: 0xd9b25a, rough: 0.06 });
    K.lit.cone(0, 2.5, 0, 2.5, 1.5, 0xd9b25a, { seg: 10, top: 0xf0d07a, rough: 0.08, flat: true, g: [0.8, 1.1] });
    K.lit.cyl(0, 3.9, 0, 0.08, 0.06, 0.5, 0x8a5a2b, { seg: 5 });
    // counter, stools, shelf
    K.lit.rbox(0, 0.22, 1.15, 2.8, 1.0, 0.7, 0.06, 0xb7824a, { top: 0xd9a566 });
    K.lit.box(-1.5, 1.22, 0.9, 3.0, 0.1, 1.05, 0xe3b274, { ao: 0 });
    for (const sx of [-0.9, 0, 0.9]) { K.lit.cyl(sx, 0.2, 2.1, 0.06, 0.06, 0.55, 0x8a5a2b, { seg: 5 }); K.lit.cyl(sx, 0.72, 2.1, 0.24, 0.24, 0.12, CO_PAL[(Math.round(sx * 2) + 4) % 6], { seg: 8 }); }
    K.lit.box(-1.0, 1.5, -0.4, 2.0, 0.06, 0.3, 0x8a5a2b); K.lit.box(-1.0, 1.0, -0.4, 2.0, 0.06, 0.3, 0x8a5a2b);
    for (let i = 0; i < 6; i++) K.lit.cyl(-0.85 + i * 0.34, 1.56, -0.35, 0.06, 0.045, 0.3, CO_PAL[i % 6], { seg: 5, ao: 0 });
    // string lights
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; K.glow.sph(Math.cos(a) * 2.45, 2.3, Math.sin(a) * 2.45, 0.08, i % 2 ? 0xffe27a : 0xff8fb8, { seg: 4 }); }
    K.halo_(0, 2.4, 1.5, 2.2, 0xffd080, 0.22);
    K.lit.rbox(1.45, 0.22, 0.0, 0.5, 0.9, 0.5, 0.05, 0xc99a4a, {}); K.lit.sph(1.45, 1.35, 0, 0.22, 0xe3bb68, { seg: 6, sy: 1.15 }); K.glow.box(1.32, 1.3, 0.2, 0.26, 0.05, 0.02, 0x3a2a14);
    K.shadow(0.1, 0, 3.0, 2.8, 0.4);
  });
}
function coUmbrella(world, v) {
  return pf(world, 'umb' + v, (K) => {
    const c0 = CO_PAL[v % 6], c1 = v % 2 ? 0xffffff : 0xfff3cf;
    K.lit.cyl(0, 0, 0, 0.04, 0.035, 2.4, 0xeadfc8, { seg: 5, ao: 0.2 });
    canopy(K, 0, 1.9, 0, 1.45, 0.55, c0, c1, 8, 0.0);
    K.lit.sph(0, 2.47, 0, 0.07, 0xffc21a, { seg: 4 });
    for (const sx of [-1, 1]) {
      K.push(sx * 1.15, 0, 0.9, sx * 0.35, 1);
      K.lit.box(-0.3, 0.22, -0.6, 0.6, 0.06, 1.2, 0xf4f1ea, { rx: 0, ao: 0.3 });
      K.lit.box(-0.3, 0.3, -0.6, 0.6, 0.1, 0.8, CO_PAL[(v + 2) % 6], { ao: 0 });
      K.lit.box(-0.3, 0.38, 0.2, 0.6, 0.1, 0.55, CO_PAL[(v + 2) % 6], { rx: 0.9, ao: 0 });
      K.pop();
    }
    K.lit.cyl(0.0, 0, 1.3, 0.28, 0.28, 0.4, 0xffffff, { seg: 8 });
    K.lit.sph(0.1, 0.52, 1.3, 0.1, 0xff6f61, { seg: 5, ao: 0 });
    K.shadow(0, 0.4, 1.7, 1.7, 0.35);
  });
}
function coSurf(world) {
  return pf(world, 'surf', (K) => {
    for (const sx of [-1.3, 1.3]) { K.lit.box(sx - 0.07, 0, -0.5, 0.14, 1.2, 0.14, 0x8a5a2b, { rx: 0.0 }); K.lit.box(sx - 0.07, 0, 0.5, 0.14, 1.2, 0.14, 0x8a5a2b); K.lit.box(sx - 0.07, 1.1, -0.5, 0.14, 0.14, 1.14, 0x8a5a2b); }
    K.lit.box(-1.4, 0.55, -0.55, 2.8, 0.1, 0.1, 0x8a5a2b);
    for (let i = 0; i < 4; i++) {
      const x = -1.0 + i * 0.66, c = CO_PAL[(i * 2) % 6];
      K.lit.sph(x, 1.55, 0.2, 1.0, c, { sx: 0.27, sy: 1.1, sz: 0.05, rz: (i - 1.5) * 0.04, rx: -0.12, g: [1, 1], ao: 0, seg: 6 });
      K.lit.sph(x, 1.55, 0.25, 1.0, 0xffffff, { sx: 0.06, sy: 1.0, sz: 0.052, rz: (i - 1.5) * 0.04, rx: -0.12, g: [1, 1], ao: 0, seg: 5 });
    }
    K.shadow(0, 0, 1.8, 1.0, 0.3);
  });
}
function coLifeguard(world) {
  return pf(world, 'lifeguard', (K) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.lit.cyl(sx * 0.9, 0, sz * 0.9, 0.09, 0.09, 2.4, 0xf4f1ea, { seg: 6, rz: sx * -0.06, rx: sz * 0.06 });
    K.lit.box(-1.2, 1.6, -1.2, 2.4, 0.14, 2.4, 0xc9a06a, { top: 0xe3bb80 });
    K.lit.box(-0.5, 0.0, 1.0, 1.0, 0.1, 0.1, 0xf4f1ea, { rx: -0.4, ao: 0 });
    for (let i = 0; i < 6; i++) K.lit.box(-0.45, 0.2 + i * 0.28, 1.45 - i * 0.12, 0.9, 0.06, 0.2, 0xf4f1ea, { ao: 0 });
    K.lit.rbox(0, 1.74, 0, 1.9, 1.5, 1.7, 0.08, 0xffffff, { top: 0xfff7e8 });
    K.lit.box(-0.95, 2.2, 0.85, 1.9, 0.3, 0.05, 0xe5533d, { ao: 0 });
    K.lit.box(-0.5, 2.1, 0.86, 1.0, 0.7, 0.06, 0x9ad8ff, { ao: 0 }); K.glow.box(-0.44, 2.16, 0.9, 0.88, 0.58, 0.01, 0xbfe9ff);
    K.lit.prism(0, 3.2, 0, 2.4, 0.7, 2.4, 0xe5533d, { ry: PI / 2, top: 0xff7a59 });
    K.lit.cyl(0.8, 3.5, -0.5, 0.03, 0.03, 1.6, 0xf4f1ea, { seg: 4 });
    K.lit2.tri([0.8, 4.9, -0.5], [0.8, 4.3, -0.5], [1.7, 4.65, -0.4], 0xe5533d, { tc: [1, 0, 0.5] });
    K.shadow(0.1, 0, 2.2, 2.2, 0.4);
  });
}
function coHammock(world) {
  return pf(world, 'hammock', (K) => {
    const w = 4.2;
    K.stamp(coPalm(world, 3), -w / 2, 0, 0, 0, 0.9);
    K.stamp(coPalm(world, 1), w / 2, 0, 0, PI, 0.78);
    const cols = [0xff6f61, 0xffffff, 0x2ec4b6, 0xffffff, 0xff6f61];
    for (let i = 0; i < 5; i++) {
      const a0 = i / 5, a1 = (i + 1) / 5;
      const P = (t, dz) => [lerp(-w / 2 + 0.3, w / 2 - 0.3, t), 1.55 - Math.sin(t * PI) * 0.95, dz];
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6, t1 = (s + 1) / 6;
        const z0 = -0.38 + a0 * 0.76, z1 = -0.38 + a1 * 0.76;
        K.lit2.quad4(P(t0, z0), P(t1, z0), P(t1, z1), P(t0, z1), cols[i], { top: shadeHex(cols[i], 0.9), tc: [0, 0, 0, 0] });
      }
    }
    K.lit.tube([[-w / 2 + 0.3, 1.5, -0.3], [-w / 2 + 0.1, 3.2, 0]], 0.02, 0xe9d3a0, { segs: 4, rad: 3, ao: 0 });
    K.lit.tube([[w / 2 - 0.3, 1.5, -0.3], [w / 2 - 0.1, 3.0, 0]], 0.02, 0xe9d3a0, { segs: 4, rad: 3, ao: 0 });
    K.shadow(0, 0, 2.0, 0.7, 0.3);
  });
}
function coBungalow(world, v) {
  const wall = [0xffe2b0, 0xbfe6e0, 0xffc9b5][v % 3], trim = [0x2ec4b6, 0xff6f61, 0x2a8fd0][v % 3];
  return pf(world, 'bungalow' + v, (K) => {
    K.lit.box(-2.2, 0, -1.8, 4.4, 0.45, 3.9, 0x9a6a3a, { top: 0xc08a50 });
    K.lit.rbox(0, 0.45, -0.3, 3.4, 2.2, 2.6, 0.08, wall, { top: shadeHex(wall, 1.1) });
    K.lit.box(-0.5, 0.45, 1.0, 1.0, 1.7, 0.08, trim);
    for (const sx of [-1.15, 1.15]) { K.lit.box(sx - 0.4, 1.2, 1.0, 0.8, 0.8, 0.07, 0xffffff, { ao: 0 }); K.glow.box(sx - 0.32, 1.28, 1.04, 0.64, 0.64, 0.01, 0x9adfff); K.lit.box(sx - 0.62, 1.2, 1.05, 0.2, 0.8, 0.05, trim, { ao: 0 }); K.lit.box(sx + 0.42, 1.2, 1.05, 0.2, 0.8, 0.05, trim, { ao: 0 }); }
    K.lit.pyr(0, 2.5, -0.3, 4.6, 1.8, 3.8, 0xc9a050, { top: 0xe8c878, g: [0.78, 1.1], rough: 0.04, flat: true });
    K.lit.cyl(0, 4.2, -0.3, 0.1, 0.06, 0.5, 0x8a5a2b, { seg: 5 });
    for (const sx of [-1, 1]) K.lit.cyl(sx * 1.9, 0.45, 1.8, 0.07, 0.07, 2.1, 0xc99a4a, { seg: 5 });
    K.lit.box(-1.9, 2.5, 1.7, 3.8, 0.08, 0.2, 0xc99a4a, { ao: 0 });
    for (let i = 0; i < 4; i++) K.lit.box(-0.7, 0.0 + i * 0.12, 2.2 + (3 - i) * 0.2, 1.4, 0.12, 0.22, 0xc08a50, { ao: 0 });
    K.glow.sph(1.9, 2.3, 1.8, 0.1, 0xffe27a, { seg: 4 }); K.halo_(1.9, 2.3, 1.8, 0.8, 0xffd080, 0.3);
    K.shadow(0, -0.2, 3.2, 3.0, 0.4);
  });
}
function coReef(world, v) {
  return pf(world, 'reef' + v, (K) => {
    const cs = [[0xff6f61, 0xffa08a], [0xff8fb8, 0xffc4dc], [0xff9f1c, 0xffd070], [0xb388ff, 0xdac4ff]];
    K.lit.ico(0, 0.3, 0, 0.9, 0x6a6a78, { top: 0x9a9aa8, flat: true, det: 1, rough: 0.3, sy: 0.6 });
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1 + v, r = 0.3 + (i % 3) * 0.25, c = cs[(i + v) % 4], hh = 0.7 + (i % 4) * 0.25;
      K.lit.cyl(Math.cos(a) * r, 0.35, Math.sin(a) * r, 0.1, 0.03, hh, c[0], { seg: 5, top: c[1], rz: Math.cos(a) * 0.35, rx: Math.sin(a) * 0.35, ao: 0.1, g: [0.9, 1.1] });
      K.lit.sph(Math.cos(a) * r + Math.cos(a) * hh * 0.3, 0.35 + hh * 0.93, Math.sin(a) * r + Math.sin(a) * hh * 0.3, 0.07, c[1], { seg: 4, ao: 0 });
    }
    const b = cs[(v + 1) % 4];
    K.lit.ico(0.9, 0.25, 0.4, 0.5, b[0], { top: b[1], flat: true, det: 1, rough: 0.35, sy: 0.7, g: [0.8, 1.1] });
    K.lit.ico(-0.8, 0.2, -0.5, 0.4, cs[(v + 2) % 4][0], { top: cs[(v + 2) % 4][1], flat: true, det: 1, rough: 0.35, sy: 0.7 });
    K.shadow(0.1, 0, 1.6, 1.4, 0.4);
  });
}
function coStar(world) {
  return pf(world, 'star', (K) => {
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU, b = a + TAU / 10, c = a + TAU / 5; K.lit2.tri([0, 0.04, 0], [Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3], [Math.cos(b) * 0.1, 0.04, Math.sin(b) * 0.1], 0xff7a3d, { ao: 0 }); K.lit2.tri([0, 0.04, 0], [Math.cos(b) * 0.1, 0.04, Math.sin(b) * 0.1], [Math.cos(c) * 0.3, 0.04, Math.sin(c) * 0.3], 0xff7a3d, { ao: 0 }); }
  });
}
function coShell(world, v) {
  return pf(world, 'shell' + v, (K) => { K.lit.ico(0, 0.08, 0, 0.12, v ? 0xffd9e6 : 0xffffff, { det: 0, sy: 0.7, ao: 0.1 }); K.lit.ico(0.22, 0.06, 0.1, 0.09, v ? 0xffffff : 0xffc4a8, { det: 0, sy: 0.7, ao: 0.1 }); });
}
function coBall(world) {
  return pf(world, 'ball', (K) => {
    for (let i = 0; i < 6; i++) { const a0 = i / 6 * TAU, a1 = (i + 1) / 6 * TAU, c = [0xff6f61, 0xffffff, 0x2ec4b6][i % 3]; K.lit.tri([0, 0.5, 0], [Math.cos(a0) * 0.4, 0.15, Math.sin(a0) * 0.4], [Math.cos(a1) * 0.4, 0.15, Math.sin(a1) * 0.4], c, { ao: 0 }); K.lit.tri([0, 0.0, 0], [Math.cos(a1) * 0.4, 0.15, Math.sin(a1) * 0.4], [Math.cos(a0) * 0.4, 0.15, Math.sin(a0) * 0.4], c, { ao: 0 }); }
    K.shadow(0, 0, 0.5, 0.5, 0.3);
  });
}

function genCoral(world, side, len, rng) {
  const S = new Chunk(world, side, len, rng);
  const ri = (n) => Math.floor(rng() * n);
  const T = [
    { w: 10, weight: 3, fn: (S, z) => {          // tiki bar
      S.put(coTiki(world), 9.9, z - 0.8, { face: true });
      S.put(coPalm(world, ri(4)), 11.0, z + 4.0, { yaw: rng() * 6, tint: 0.05 });
      S.put(coPalm(world, ri(4)), 10.8, z - 4.6, { yaw: rng() * 6, tint: 0.05 });
      S.put(coUmbrella(world, ri(6)), 9.0, z + 3.7, { yaw: 0.5 });
      S.put(coBall(world), 8.9, z - 3.2, {});
    } },
    { w: 9, weight: 2.4, fn: (S, z) => {          // umbrellas and surf
      S.put(coUmbrella(world, ri(6)), 9.2, z - 2.6, { yaw: rng() * 3 });
      S.put(coUmbrella(world, ri(6)), 9.4, z + 1.6, { yaw: rng() * 3 });
      S.put(coSurf(world), 10.6, z + 3.4, { face: true, yaw: 0 });
      S.put(coPalm(world, ri(4)), 10.9, z - 1.0, { yaw: rng() * 6, tint: 0.05 });
      S.put(coShell(world, 0), 8.8, z + 3.6, { yaw: 1 }); S.put(coStar(world), 8.8, z - 0.4, { yaw: 2 });
    } },
    { w: 9, weight: 2.2, fn: (S, z) => {          // lifeguard tower
      S.put(coLifeguard(world), 10.0, z, { face: true });
      S.put(coPalm(world, ri(4)), 10.9, z + 3.6, { yaw: rng() * 6, tint: 0.05 });
      S.put(coPalm(world, ri(4)), 10.4, z - 3.6, { yaw: rng() * 6, tint: 0.05 });
      S.put(coStar(world), 8.8, z + 2.0, { yaw: 0.3 }); S.put(coShell(world, 1), 8.9, z - 2.0, { yaw: 1 });
    } },
    { w: 11, weight: 2.2, fn: (S, z) => {          // bungalows + hammock
      S.put(coBungalow(world, ri(3)), 10.4, z + 2.4, { face: true, s: 0.92 });
      S.put(coHammock(world), 9.2, z - 4.1, { face: true, s: 0.95 });
      S.put(coPalm(world, ri(4)), 11.1, z - 1.2, { yaw: rng() * 6, tint: 0.05 });
    } },
    { w: 8, weight: 2.0, fn: (S, z) => {          // reef shore
      S.put(coReef(world, ri(4)), 10.2, z - 1.5, { yaw: rng() * 6 });
      S.put(coReef(world, ri(4)), 11.0, z + 2.4, { yaw: rng() * 6, s: 1.1 });
      S.put(coPalm(world, ri(4)), 9.2, z + 0.6, { yaw: rng() * 6, tint: 0.05 });
      S.put(coShell(world, 0), 8.9, z - 3.0, { yaw: 1 });
    } },
    { w: 7, weight: 1.6, fn: (S, z) => {          // palm grove
      S.put(coPalm(world, 0), 9.4, z - 1.2, { yaw: 1 }); S.put(coPalm(world, 2), 10.6, z + 1.4, { yaw: 2 }); S.put(coPalm(world, 3), 9.0, z + 2.6, { yaw: 3 });
      S.put(coReef(world, ri(4)), 10.6, z - 2.8, { yaw: rng() * 6, s: 0.8 });
    } },
  ];
  S.compose(T, (S) => {
    S.scatter([tuftPrefab(world, 'ctuft', [0x7ab648, 0xa6d66a, 0x5a9a3a], 0.4, 6)], 14, 8.5, 10.0);
    S.scatter([coShell(world, 0), coShell(world, 1), coStar(world)], 7, 8.5, 10.4, { tint: 0 });
  });
  return S.group();
}

// ===================================================================================================
// EMERALD JUNGLE: giant vine trees, mossy ruins, glowing mushrooms, ferns, rope bridge, waterfall
// ===================================================================================================
function fernPrefab(world) {
  return pf(world, 'fern', (K) => {
    for (let i = 0; i < 9; i++) {
      const yaw = i / 9 * TAU + K.rng() * 0.4;
      frond(K, 0, 0.12, 0, yaw, 1.0 + K.rng() * 0.45, 0.65 + K.rng() * 0.3, 1.0 + K.rng() * 0.4, 0.2, 0x2f7d32, 0x8fd05a, 3);
    }
    K.shadow(0, 0, 0.9, 0.9, 0.3);
  });
}
function mushroomPrefab(world, v) {
  const cols = [[0x5dffd0, 0xc8fff0], [0xff6ad9, 0xffc4f2], [0xffb347, 0xffe0a0]][v % 3];
  return pf(world, 'mush' + (v % 3), (K) => {
    const sizes = [[0, 0, 1.0], [0.6, 0.35, 0.65], [-0.45, 0.5, 0.5]];
    for (const [x, z, s] of sizes) {
      K.lit.cyl(x, 0, z, 0.14 * s, 0.11 * s, 0.7 * s, 0xf4ecd6, { seg: 5, top: 0xffffff, ao: 0.3 });
      K.glow.dome(x, 0.62 * s, z, 0.55 * s, cols[0], { sy: 0.7, seg: 7, top: cols[1] });
      for (let i = 0; i < 2; i++) { const a = i * 3.1 + x; K.glow.ico(x + Math.cos(a) * 0.3 * s, 0.62 * s + 0.3 * s, z + Math.sin(a) * 0.3 * s, 0.05 * s, 0xffffff, { det: 0 }); }
    }
    K.halo_(0.1, 0.5, 0.1, 1.5, cols[0], 0.35);
    K.shadow(0.1, 0, 0.9, 0.9, 0.3);
  });
}
function jGiant(world, v) {
  return pf(world, 'giant' + v, (K) => {
    const h = [10.5, 8.6][v % 2], r = [1.15, 1.3][v % 2];
    K.lit.cyl(0, 0, 0, r, r * 0.68, h, 0x6d4c41, { seg: 9, top: 0x86604a, g: [0.7, 1.05], ao: 0.5 });
    K.lit.cyl(0, 0, 0, r * 1.45, r * 1.0, 1.5, 0x6d4c41, { seg: 9, top: 0x7a5648, g: [0.7, 1.0], ao: 0.4 });
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2 + v * 0.7 + 0.4;
      K.lit.ico(Math.cos(a) * r * 1.5, 0.15, Math.sin(a) * r * 1.5, 0.75, 0x6d4c41, { top: 0x86604a, det: 1, flat: true, rough: 0.25, sy: 0.45, sx: 1.4, ry: -a, g: [0.75, 1.0], ao: 0.3 });
    }
    // moss on the trunk
    K.lit.ico(r * 0.5, 2.0, r * 0.6, 0.55, 0x5b9a3a, { top: 0x86c04a, det: 0, flat: true, rough: 0.3, sy: 0.5, sx: 0.7 });
    const cs = [[0x2f7d32, 0x58b457], [0x3a8a3c, 0x6cc45a], [0x277a45, 0x4fb06a]];
    const spots = [[0, 0, 3.1], [2.5, 0.4, 2.3], [-2.4, -0.5, 2.4], [0.5, 2.3, 2.1], [-0.4, -2.3, 2.2]];
    spots.forEach(([x, z, s], i) => { const c = cs[(i + v) % 3]; K.lit.ico(x, h + (i % 3) * 0.55 - 0.4, z, s, c[0], { top: c[1], flat: true, det: 1, rough: 0.25, sy: 0.78, g: [0.72, 1.12] }); });
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6 + v, rr_ = 2.6 + (i % 2) * 0.5, hh = 4 + (i % 3) * 1.6;
      K.lit.tube([[Math.cos(a) * rr_, h - 0.6, Math.sin(a) * rr_], [Math.cos(a) * (rr_ + 0.25), h - hh * 0.5, Math.sin(a) * (rr_ + 0.25)], [Math.cos(a) * (rr_ + 0.1), h - hh, Math.sin(a) * (rr_ + 0.1)]], 0.055, 0x2f6b2a, { segs: 5, rad: 3, ao: 0, g: [1, 1] });
      K.lit.ico(Math.cos(a) * (rr_ + 0.1), h - hh, Math.sin(a) * (rr_ + 0.1), 0.16, 0x58b457, { det: 0, ao: 0 });
    }
    for (let i = 0; i < 4; i++) K.lit.ico(Math.cos(i * 2.3) * 2.8, h + 1.0 + Math.sin(i * 1.7) * 0.9, Math.sin(i * 2.3) * 2.6, 0.13, i % 2 ? 0xffb74d : 0xff6f91, { det: 0, ao: 0, g: [1, 1] });
    K.shadow(0.5, 0.2, 4.2, 3.8, 0.45);
  });
}
function jRuins(world, v) {
  const st = 0x8e9a8a, st2 = 0xb2bdab, moss = 0x5b9a3a;
  return pf(world, 'ruins' + v, (K) => {
    K.lit.box(-3.0, 0, -1.6, 6.0, 0.35, 3.2, st, { top: st2, g: [0.75, 1.05] });
    K.lit.box(-2.5, 0.35, -1.3, 5.0, 0.3, 2.6, st, { top: st2 });
    const hs = [3.4, 2.6];
    for (let i = 0; i < 2; i++) {
      const x = i ? 1.8 : -1.8;
      K.lit.cyl(x, 0.65, 0, 0.42, 0.38, hs[i], st, { seg: 8, top: st2, g: [0.75, 1.05] });
      K.lit.box(x - 0.55, 0.65 + hs[i], -0.55, 1.1, 0.25, 1.1, st2, { top: 0xd0d9c8 });
      for (let k = 0; k < 3; k++) K.lit.cyl(x, 0.9 + k * 0.9, 0, 0.45, 0.45, 0.07, shadeHex(st, 0.82), { seg: 8, ao: 0 });
    }
    // broken lintel on top of the tall pillar, fallen piece in front
    K.lit.box(-2.4, 4.28, -0.5, 2.8, 0.55, 1.0, st2, { top: 0xd0d9c8, rz: -0.07, g: [0.8, 1.05] });
    K.lit.box(0.4, 0.65, 1.0, 1.4, 0.5, 0.7, st, { ry: 0.5, rz: 0.1, top: st2 });
    K.lit.cyl(2.8, 0.65, 1.0, 0.36, 0.34, 1.2, st, { seg: 8, rx: PI / 2 - 0.1, top: st2 });
    // carved head block with glowing eyes
    K.lit.rbox(-0.7, 0.65, 0.5, 1.2, 1.1, 0.9, 0.1, st2, { top: 0xd0d9c8 });
    K.glow.box(-0.5, 1.3, 0.96, 0.2, 0.14, 0.02, 0x5dffd0); K.glow.box(-0.0, 1.3, 0.96, 0.2, 0.14, 0.02, 0x5dffd0);
    K.lit.box(-0.4, 0.95, 0.96, 0.5, 0.1, 0.03, 0x5a6a58, { ao: 0 });
    K.halo_(-0.35, 1.37, 1.1, 0.9, 0x5dffd0, 0.4);
    for (const [x, y, z, s] of [[-2.0, 4.0, -0.3, 0.5], [1.8, 3.6, 0, 0.45], [-3.0, 0.65, -1.0, 0.7], [2.4, 0.65, -1.0, 0.6]]) K.lit.ico(x, y, z, s, moss, { top: 0x86c04a, det: 1, flat: true, rough: 0.3, sy: 0.55 });
    for (const [x, z] of [[-1.8, 0.4], [2.0, -0.2], [-2.6, 0.9]]) K.lit.tube([[x, 4.0, z], [x + 0.05, 3.0, z], [x - 0.05, 1.8, z]], 0.04, 0x3f8a3a, { segs: 5, rad: 3, ao: 0, g: [1, 1] });
    K.shadow(0, 0, 3.6, 2.4, 0.4);
  });
}
function jWaterfall(world) {
  return pf(world, 'waterfall', (K) => {
    const rocks = [[0, 3.0, -1.0, 3.2], [-3.0, 2.0, -0.5, 2.6], [3.0, 1.9, -0.3, 2.5], [-1.2, 5.6, -1.6, 2.6], [1.4, 5.5, -1.4, 2.4], [0, 7.4, -2.0, 2.0]];
    rocks.forEach(([x, y, z, s], i) => K.lit.ico(x, y, z, s, i % 2 ? 0x7a6f66 : 0x6f665e, { top: 0xa0968a, flat: true, det: 1, rough: 0.3, sy: 0.85, g: [0.7, 1.1] }));
    for (const [x, y, z, s] of [[-1.6, 7.7, -1.4, 0.9], [1.8, 6.6, -0.8, 0.8], [-3.4, 3.7, 0, 0.8], [3.4, 3.4, 0.4, 0.7]]) K.lit.ico(x, y, z, s, 0x5b9a3a, { top: 0x86c04a, det: 0, flat: true, rough: 0.3, sy: 0.55 });
    // water sheet
    const zf = 1.25;
    K.glow.quad4([-0.8, 8.2, zf - 0.6], [0.8, 8.2, zf - 0.6], [0.95, 3.2, zf + 0.1], [-0.95, 3.2, zf + 0.1], 0xeaffff, { top: 0xbfe9ff, tc: [0, 0, 0.5, 0.5] });
    K.glow.quad4([-0.95, 3.2, zf + 0.1], [0.95, 3.2, zf + 0.1], [1.15, 0.3, zf + 1.1], [-1.15, 0.3, zf + 1.1], 0xf4ffff, { top: 0xdff6ff, tc: [0.5, 0.5, 1, 1] });
    for (const x of [-0.45, 0.1, 0.55]) K.glow.quad4([x - 0.04, 8.0, zf - 0.55], [x + 0.04, 8.0, zf - 0.55], [x + 0.06, 0.4, zf + 1.05], [x - 0.06, 0.4, zf + 1.05], 0xffffff, { top: 0xdff6ff, tc: [0, 0, 1, 1] });
    K.glow.cyl(0.0, 0.02, zf + 2.2, 3.0, 3.0, 0.06, 0x58d6a0, { seg: 14, top: 0x8af0c8 });
    for (let i = 0; i < 4; i++) K.glow.ico(Math.cos(i * 1.1) * 1.3, 0.25, zf + 1.3 + Math.sin(i * 1.1) * 0.5, 0.45, 0xffffff, { det: 0, sy: 0.55 });
    K.halo_(0, 1.2, zf + 1.2, 4.2, 0xdffff0, 0.4);
    K.shadow(0, 0, 5.4, 3.0, 0.4);
  });
}
function jBridge(world) {
  return pf(world, 'bridge', (K) => {
    const L = 9.0, y0 = 3.6;
    for (const sx of [-1, 1]) { K.lit.cyl(sx * (L / 2 + 0.2), 0, 0, 0.26, 0.2, y0 + 1.5, 0x7a5030, { seg: 7, top: 0x9a6a3c }); K.lit.box(sx * (L / 2 + 0.2) - 0.5, y0 + 0.9, -0.12, 1.0, 0.18, 0.24, 0x7a5030, { ao: 0 }); }
    const n = 17, sag = (t) => Math.sin(t * PI) * 0.6;
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; K.lit.box(-L / 2 + t * L - 0.2, y0 - sag(t), -0.8, 0.4, 0.07, 1.6, i % 3 ? 0xa97542 : 0x8f6034, { top: 0xc08a50, ao: 0, g: [0.85, 1.05] }); }
    for (const sz of [-0.8, 0.8]) {
      const top = [], low = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; top.push([-L / 2 + t * L, y0 - sag(t) + 1.0, sz]); low.push([-L / 2 + t * L, y0 - sag(t) + 0.04, sz]); }
      K.lit.tube(top, 0.04, 0xc9a96a, { segs: 10, rad: 3, ao: 0, g: [1, 1] });
      K.lit.tube(low, 0.035, 0xc9a96a, { segs: 10, rad: 3, ao: 0, g: [1, 1] });
      for (let i = 1; i < 6; i += 1) { const t = i / 6; K.lit.cyl(-L / 2 + t * L, y0 - sag(t) + 0.04, sz, 0.02, 0.02, 0.96, 0xc9a96a, { seg: 3, ao: 0, g: [1, 1] }); }
    }
    for (const x of [-2.5, 0.5, 3.0]) K.lit.tube([[x, y0 - sag((x + L / 2) / L) - 0.0, 0.8], [x + 0.1, y0 - 1.6, 0.9], [x - 0.05, y0 - 3.0, 0.85]], 0.03, 0x3f8a3a, { segs: 5, rad: 3, ao: 0, g: [1, 1] });
    K.shadow(0, 0, 4.8, 1.6, 0.25);
  });
}
function jBamboo(world, v) {
  return pf(world, 'bamboo' + v, (K) => {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + v, r = 0.15 + (i % 3) * 0.3, h = 4.6 + ((i * 7 + v) % 5) * 0.6, lx = Math.cos(a) * 0.06, lz = Math.sin(a) * 0.06;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      K.lit.cyl(x, 0, z, 0.1, 0.075, h, i % 2 ? 0x9ccc65 : 0x84b84a, { seg: 6, rz: -lx, rx: lz, top: 0xc5e08a, g: [0.8, 1.05], ao: 0.4 });
      K.lit.cyl(x, h * 0.35, z, 0.108, 0.108, 0.05, 0x5f8a30, { seg: 6, ao: 0, rz: -lx, rx: lz });
      for (let k = 0; k < 2; k++) frond(K, x + lx * h, h * 0.97, z + lz * h, a + k * 2.6, 0.9, 0.4, 0.9, 0.13, 0x4a9a3a, 0xa6d66a, 2);
    }
    K.shadow(0, 0, 1.2, 1.2, 0.35);
  });
}
function jTotem(world) {
  return pf(world, 'totem', (K) => {
    const bands = [0xc2562f, 0xf2b705, 0x2a9d8f, 0xe9d8b4];
    K.lit.box(-0.6, 0, -0.6, 1.2, 0.3, 1.2, 0x6f5a46, { top: 0x8a7258 });
    for (let i = 0; i < 4; i++) {
      K.lit.rbox(0, 0.3 + i * 0.7, 0, 0.9, 0.7, 0.9, 0.06, bands[i], { top: shadeHex(bands[i], 1.15) });
      K.glow.box(-0.25, 0.6 + i * 0.7, 0.46, 0.15, 0.1, 0.02, 0xffe14d); K.glow.box(0.1, 0.6 + i * 0.7, 0.46, 0.15, 0.1, 0.02, 0xffe14d);
      K.lit.box(-0.2, 0.42 + i * 0.7, 0.46, 0.4, 0.08, 0.03, 0x3b2a1a, { ao: 0 });
    }
    K.lit.box(-1.0, 2.2, -0.1, 2.0, 0.2, 0.2, 0xc2562f, { ao: 0 });
    K.lit.cone(0, 3.1, 0, 0.5, 0.6, 0xf2b705, { seg: 5 });
    K.shadow(0, 0, 1.1, 1.1, 0.4);
  });
}

function genJungle(world, side, len, rng) {
  const S = new Chunk(world, side, len, rng);
  const ri = (n) => Math.floor(rng() * n);
  const fern = fernPrefab(world), rock = rockPrefab(world, 'jrock', 0x8a8f86, 0xaab0a2, 1.1);
  const T = [
    { w: 13, weight: 3, fn: (S, z) => {          // giant tree grove
      S.put(jGiant(world, 0), 13.6, z - 3.0, { yaw: rng() * 6 });
      S.put(jGiant(world, 1), 18.0, z + 3.6, { yaw: rng() * 6 });
      S.put(fern, 9.2, z - 4.4, { yaw: rng() * 6, s: 1.2 }); S.put(fern, 10.0, z + 1.2, { yaw: rng() * 6, s: 1.1 }); S.put(fern, 9.0, z + 4.8, { yaw: rng() * 6, s: 1.3 });
      S.put(mushroomPrefab(world, ri(3)), 9.6, z - 1.8, { yaw: rng() * 6 });
      S.put(jBamboo(world, ri(2)), 11.4, z + 4.4, {});
    } },
    { w: 11, weight: 2.4, fn: (S, z) => {          // mossy ruins
      S.put(jRuins(world, 0), 11.6, z, { face: true });
      S.put(jGiant(world, 1), 17.4, z - 2.4, { yaw: rng() * 6 });
      S.put(rock, 9.2, z + 3.6, { yaw: rng() * 6, s: 1.2 }); S.put(fern, 9.0, z - 3.8, { yaw: rng() * 6, s: 1.2 });
      S.put(mushroomPrefab(world, ri(3)), 9.5, z + 0.8, { yaw: rng() * 6, s: 0.9 });
    } },
    { w: 14, weight: 2.2, fn: (S, z) => {          // rope bridge between two giant trees
      S.put(jGiant(world, 0), 11.8, z - 5.6, { yaw: 1 });
      S.put(jGiant(world, 1), 11.8, z + 5.8, { yaw: 3 });
      S.put(jBridge(world), 11.8, z + 0.1, { face: true });
      S.put(fern, 9.2, z + 1.0, { yaw: rng() * 6, s: 1.2 }); S.put(fern, 9.0, z - 2.8, { yaw: rng() * 6 });
      S.put(jBamboo(world, ri(2)), 15.4, z + 2.0, {});
    } },
    { w: 12, weight: 2.2, fn: (S, z) => {          // waterfall
      S.put(jWaterfall(world), 19.0, z, { face: true });
      S.put(jGiant(world, 0), 13.8, z + 4.2, { yaw: rng() * 6 });
      S.put(fern, 9.2, z - 3.0, { yaw: rng() * 6, s: 1.3 }); S.put(fern, 10.4, z + 2.4, { yaw: rng() * 6, s: 1.1 });
      S.put(mushroomPrefab(world, ri(3)), 9.5, z - 0.4, { yaw: rng() * 6 });
      S.put(rock, 12.4, z - 3.8, { yaw: rng() * 6, s: 1.5 });
      S.put(jBamboo(world, ri(2)), 12.6, z - 0.8, {});
    } },
    { w: 8, weight: 2.0, fn: (S, z) => {          // glowing mushroom glade
      S.put(mushroomPrefab(world, 0), 9.8, z - 2.2, { yaw: 1, s: 1.5 }); S.put(mushroomPrefab(world, 1), 10.6, z + 2.0, { yaw: 2, s: 1.3 }); S.put(mushroomPrefab(world, 2), 9.0, z + 0.4, { yaw: 3, s: 1.0 });
      S.put(fern, 9.2, z - 3.4, { yaw: 2, s: 1.3 }); S.put(fern, 11.2, z - 0.4, { yaw: 1, s: 1.2 });
      S.put(jBamboo(world, ri(2)), 13.2, z + 1.6, {}); S.put(rock, 12.4, z - 2.6, { yaw: 2, s: 1.3 });
    } },
    { w: 9, weight: 1.6, fn: (S, z) => {          // totem + bamboo
      S.put(jTotem(world), 9.6, z - 0.4, { face: true });
      S.put(jBamboo(world, ri(2)), 11.8, z - 3.2, {}); S.put(jBamboo(world, ri(2)), 12.6, z + 3.0, {});
      S.put(fern, 9.2, z + 2.6, { yaw: rng() * 6, s: 1.2 }); S.put(fern, 9.4, z - 3.4, { yaw: rng() * 6, s: 1.1 });
      S.put(jGiant(world, 0), 17.0, z + 0.5, { yaw: rng() * 6 });
    } },
  ];
  S.compose(T, (S) => {
    S.scatter([tuftPrefab(world, 'jtuft', [0x2f7d32, 0x58b457, 0x1f6a30], 0.5, 6), tuftPrefab(world, 'jtuft2', [0x3a8a3c, 0x8bc34a, 0x2a7a3a], 0.36, 5)], 22, 8.6, 20);
    S.scatter([flowerPrefab(world, 'jfl1', 0xff6f91, 0xffe27a), flowerPrefab(world, 'jfl2', 0xffb74d, 0xffffff), flowerPrefab(world, 'jfl3', 0xb388ff, 0xffffff)], 8, 8.6, 18, { tint: 0 });
  });
  return S.group();
}

// ===================================================================================================
// FROST FJORD: snowy pines, ice crystals, igloos, log cabins with smoke, snowmen, penguins, drifts
// ===================================================================================================
function fPine(world, v) {
  return pineTree(world, 'pine' + v, [
    { h: 7.2, tiers: 4, r: 1.75, col: 0x2c6e55, colTop: 0x4aa078, snow: true }, { h: 5.2, tiers: 4, r: 1.35, col: 0x2f7d5a, colTop: 0x55b07a, snow: true },
    { h: 3.2, tiers: 3, r: 0.95, col: 0x2c6e55, colTop: 0x4aa078, snow: true }, { h: 9.4, tiers: 5, r: 2.1, col: 0x2a6a50, colTop: 0x4aa078, snow: true },
  ][v % 4]);
}
function fCrystals(world, v) {
  return pf(world, 'crystal' + v, (K) => {
    const n = 7;
    K.lit.ico(0, 0.1, 0, 1.3, 0xe9f3ff, { top: 0xffffff, det: 1, flat: true, rough: 0.15, sy: 0.35, ao: 0.1 });
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + v, r = i ? 0.55 + (i % 3) * 0.25 : 0, h = i ? 1.0 + (i * 37 % 10) * 0.12 : 2.6 + v * 0.5, w = i ? 0.2 + (i % 2) * 0.08 : 0.38;
      const lean = i ? 0.28 : 0.04, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
      const c0 = i % 2 ? 0x8ad8ff : 0xa8e6ff;
      K.lit.cyl(Math.cos(a) * r, 0.1, Math.sin(a) * r, w, w * 0.9, h * 0.72, c0, { seg: 6, rz: -lx, rx: lz, top: 0xd8f6ff, g: [0.85, 1.12], ao: 0.1 });
      K.lit.cone(Math.cos(a) * r + lx * h * 0.7, 0.1 + h * 0.7, Math.sin(a) * r + lz * h * 0.7, w * 0.92, h * 0.34, 0xe8fbff, { seg: 6, rz: -lx, rx: lz, top: 0xffffff, ao: 0 });
      K.glow.cone(Math.cos(a) * r + lx * h * 0.3, 0.1 + h * 0.3, Math.sin(a) * r + lz * h * 0.3, w * 0.35, h * 0.3, 0x7fe0ff, { seg: 4, top: 0xd8f6ff });
    }
    K.halo_(0, 1.2, 0, 2.8, 0x8ad8ff, 0.3);
    K.shadow(0.1, 0, 1.9, 1.7, 0.35);
  });
}
function fIgloo(world) {
  return pf(world, 'igloo', (K) => {
    const R = 2.3;
    K.lit.dome(0, 0, 0, R, 0xf6fbff, { seg: 14, top: 0xffffff, g: [0.82, 1.06], ao: 0.3 });
    for (const [y, rr_] of [[0.55, 2.24], [1.15, 1.99], [1.7, 1.55]]) K.lit.cyl(0, y, 0, rr_ + 0.02, rr_ + 0.02, 0.045, 0xa9c4de, { seg: 14, ao: 0, g: [1, 1] });
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU, y = (i % 2) * 0.6 + 0.3; K.lit.box(Math.cos(a) * 2.2 - 0.02, y, Math.sin(a) * 2.2 - 0.02, 0.04, 0.55, 0.04, 0xa9c4de, { ao: 0, ry: -a, g: [1, 1] }); }
    K.lit.dome(0, 0, 2.0, 1.0, 0xf6fbff, { sx: 0.95, sy: 1.0, sz: 1.5, seg: 10, top: 0xffffff });
    K.lit.box(-0.5, 0, 3.35, 1.0, 0.95, 0.05, 0x1d2b44, { ao: 0 });
    K.glow.box(-0.4, 0.05, 3.33, 0.8, 0.8, 0.02, 0xffc46a);
    K.halo_(0, 0.5, 3.6, 1.8, 0xffb060, 0.35);
    K.shadow(0, 0.6, 3.2, 3.6, 0.38);
  });
}
function fCabin(world) {
  return pf(world, 'cabin', (K) => {
    const w = 6.2, d = 4.6, h = 2.7;
    K.lit.box(-w / 2 - 0.3, 0, -d / 2 - 0.3, w + 0.6, 0.35, d + 0.6, 0x7a7f88, { top: 0xa0a6b0 });
    K.lit.rbox(0, 0.3, 0, w, h, d, 0.06, 0x9a6540, { top: 0xb27a4c, g: [0.8, 1.05] });
    for (let i = 0; i < 8; i++) { const y = 0.5 + i * 0.32; K.lit.box(-w / 2 - 0.02, y, d / 2 - 0.0, w + 0.04, 0.05, 0.05, 0x6b4428, { ao: 0, g: [1, 1] }); K.lit.box(w / 2 - 0.0, y, -d / 2 - 0.02, 0.05, 0.05, d + 0.04, 0x6b4428, { ao: 0, g: [1, 1] }); }
    K.lit.prism(0, h + 0.2, 0, d + 1.2, 1.9, w + 1.2, 0x6b4428, { ry: PI / 2, top: 0x8a5a38 });
    K.lit.prism(0, h + 0.32, 0, d + 1.3, 1.85, w + 1.3, 0xffffff, { ry: PI / 2, top: 0xf2f8ff, g: [0.9, 1.05], ao: 0 });
    K.lit.box(1.5, h + 0.3, -1.0, 0.9, 2.2, 0.9, 0x8a8f98, { top: 0xa8adb6 });
    K.lit.box(1.45, h + 2.45, -1.05, 1.0, 0.2, 1.0, 0xffffff, { ao: 0 });
    for (let i = 0; i < 3; i++) K.lit.ico(1.95 + i * 0.35, h + 3.0 + i * 0.7, -0.55 - i * 0.2, 0.3 + i * 0.13, 0xe8eef6, { top: 0xffffff, det: 1, flat: true, rough: 0.2, ao: 0, g: [0.95, 1.05] });
    K.lit.box(-0.45, 0.3, d / 2 - 0.0, 0.9, 1.7, 0.08, 0x5a3a24, { top: 0x7a5232 });
    K.glow.sph(0.3, 1.4, d / 2 + 0.12, 0.09, 0xffc46a, { seg: 4 });
    for (const x of [-2.0, 1.9]) { K.lit.box(x - 0.55, 1.1, d / 2 - 0.02, 1.1, 0.95, 0.07, 0xffffff, { ao: 0 }); K.glow.box(x - 0.45, 1.18, d / 2 + 0.03, 0.9, 0.78, 0.01, 0xffc46a); K.lit.box(x - 0.02, 1.18, d / 2 + 0.04, 0.04, 0.78, 0.02, 0xffffff, { ao: 0, g: [1, 1] }); K.lit.box(x - 0.7, 1.05, d / 2 + 0.0, 0.2, 1.0, 0.06, 0xd84a4a, { ao: 0 }); K.lit.box(x + 0.5, 1.05, d / 2 + 0.0, 0.2, 1.0, 0.06, 0xd84a4a, { ao: 0 }); }
    K.halo_(-2.0, 1.5, d / 2 + 0.6, 1.8, 0xffb060, 0.3); K.halo_(1.9, 1.5, d / 2 + 0.6, 1.8, 0xffb060, 0.3);
    // wood pile
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) K.lit.cyl(-2.8 + i * 0.28 + r * 0.14, 0.4 + r * 0.26, d / 2 + 0.6, 0.13, 0.13, 1.1, 0xb27a4c, { seg: 6, rx: PI / 2, top: 0xd9a066, ao: 0.1 });
    K.lit.ico(0, 0.1, d / 2 + 0.9, 1.1, 0xffffff, { sx: 1.8, sy: 0.3, sz: 0.8, det: 1, ao: 0, g: [0.95, 1.05] });
    K.shadow(0.2, 0, 4.4, 3.4, 0.38);
  });
}
function fSnowman(world, v) {
  return pf(world, 'snowman' + v, (K) => {
    const s = [1, 0.8][v % 2], sc = [0xd84a4a, 0x2f80ed][v % 2];
    K.lit.sph(0, 0.55 * s, 0, 0.72 * s, 0xffffff, { seg: 9, top: 0xf2f8ff, g: [0.85, 1.05], ao: 0.3 });
    K.lit.sph(0, 1.45 * s, 0, 0.54 * s, 0xffffff, { seg: 9, top: 0xf2f8ff, g: [0.85, 1.05], ao: 0 });
    K.lit.sph(0, 2.15 * s, 0, 0.4 * s, 0xffffff, { seg: 9, top: 0xf2f8ff, g: [0.85, 1.05], ao: 0 });
    K.lit.cone(0, 2.12 * s, 0.36 * s, 0.07 * s, 0.4 * s, 0xff8a1f, { seg: 5, rx: PI / 2, ao: 0 });
    for (const sx of [-1, 1]) K.lit.sph(sx * 0.14 * s, 2.25 * s, 0.34 * s, 0.045 * s, 0x1b1b1b, { seg: 4, ao: 0 });
    for (let i = 0; i < 3; i++) K.lit.sph(0, (1.6 - i * 0.22) * s, 0.5 * s, 0.045 * s, 0x1b1b1b, { seg: 4, ao: 0 });
    K.lit.cyl(0, 1.84 * s, 0, 0.5 * s, 0.5 * s, 0.14 * s, sc, { seg: 10, ao: 0 });
    K.lit.box(0.12 * s, 1.18 * s, 0.38 * s, 0.18 * s, 0.55 * s, 0.07 * s, sc, { ao: 0 });
    K.lit.cyl(0, 2.45 * s, 0, 0.3 * s, 0.26 * s, 0.4 * s, 0x2b2d42, { seg: 8, ao: 0 }); K.lit.cyl(0, 2.42 * s, 0, 0.44 * s, 0.44 * s, 0.05 * s, 0x2b2d42, { seg: 8, ao: 0 });
    for (const sx of [-1, 1]) K.lit.cyl(sx * 0.5 * s, 1.5 * s, 0, 0.03, 0.02, 0.9 * s, 0x6b4428, { seg: 4, rz: -sx * 1.0, ao: 0, g: [1, 1] });
    K.shadow(0, 0, 0.9, 0.9, 0.35);
  });
}
function fPenguin(world, v) {
  return pf(world, 'penguin' + v, (K) => {
    const s = [1, 0.75][v % 2];
    K.lit.sph(0, 0.52 * s, 0, 0.42 * s, 0x2b3a55, { sy: 1.35, seg: 8, top: 0x3d4f70, ao: 0.2 });
    K.lit.sph(0, 0.5 * s, 0.14 * s, 0.34 * s, 0xffffff, { sy: 1.2, sz: 0.7, seg: 8, ao: 0 });
    K.lit.sph(0, 1.05 * s, 0.0, 0.24 * s, 0x2b3a55, { seg: 8, ao: 0 });
    K.lit.cone(0, 1.04 * s, 0.22 * s, 0.07 * s, 0.2 * s, 0xff9f1c, { seg: 4, rx: PI / 2, ao: 0 });
    for (const sx of [-1, 1]) { K.glow.sph(sx * 0.1 * s, 1.1 * s, 0.17 * s, 0.035 * s, 0xffffff, { seg: 4 }); K.lit.sph(sx * 0.44 * s, 0.55 * s, 0, 0.09 * s, 0x2b3a55, { sx: 0.5, sy: 2.0, seg: 5, rz: sx * 0.25, ao: 0 }); K.lit.box(sx * 0.16 * s - 0.1 * s, 0, 0.1 * s, 0.2 * s, 0.05, 0.3 * s, 0xff9f1c, { ao: 0 }); }
    K.shadow(0, 0, 0.55, 0.55, 0.35);
  });
}
function fSled(world) {
  return pf(world, 'sled', (K) => {
    for (const sx of [-0.4, 0.4]) { K.lit.box(sx - 0.04, 0.05, -0.9, 0.08, 0.12, 1.9, 0x8a5a38, { ao: 0 }); K.lit.box(sx - 0.04, 0.12, 0.9, 0.08, 0.12, 0.3, 0x8a5a38, { ao: 0, rx: 0.5 }); K.lit.cyl(sx, 0.05, -0.2, 0.03, 0.03, 0.3, 0x6b4428, { seg: 4, ao: 0 }); }
    for (let i = 0; i < 5; i++) K.lit.box(-0.5, 0.17, -0.8 + i * 0.35, 1.0, 0.05, 0.28, i % 2 ? 0xd84a4a : 0xc23c3c, { ao: 0 });
    K.shadow(0, 0, 0.8, 1.2, 0.3);
  });
}
function fDrift(world, v) {
  return pf(world, 'drift' + v, (K) => {
    K.lit.ico(0, 0.0, 0, 1.4, 0xffffff, { sx: 1.3, sy: 0.38, sz: 0.9, det: 1, top: 0xf2f8ff, rough: 0.1, ao: 0, g: [0.92, 1.05] });
    K.lit.ico(1.5, 0.0, 0.5, 0.9, 0xffffff, { sx: 1.1, sy: 0.4, sz: 0.9, det: 1, top: 0xf2f8ff, rough: 0.1, ao: 0, g: [0.92, 1.05] });
  });
}

function genFrost(world, side, len, rng) {
  const S = new Chunk(world, side, len, rng);
  const ri = (n) => Math.floor(rng() * n);
  const rock = rockPrefab(world, 'frock', 0x8fa3b8, 0xe8f2fc, 1.1);
  const T = [
    { w: 11, weight: 3, fn: (S, z) => {          // pine forest
      S.put(fPine(world, 3), 15.0, z - 2.8, { yaw: rng() * 6, tint: 0.05 });
      S.put(fPine(world, 0), 11.8, z + 2.0, { yaw: rng() * 6, tint: 0.05 });
      S.put(fPine(world, 1), 12.6, z - 3.2, { yaw: rng() * 6, tint: 0.05 });
      S.put(fPine(world, 2), 9.6, z + 3.8, { yaw: rng() * 6, tint: 0.05 });
      S.put(fPine(world, 1), 16.8, z + 3.0, { yaw: rng() * 6, tint: 0.05 });
      S.put(fDrift(world, 0), 9.4, z - 1.2, { yaw: rng() * 3 });
      S.put(rock, 10.4, z + 0.4, { yaw: rng() * 6, s: 0.9 });
    } },
    { w: 11, weight: 2.4, fn: (S, z) => {          // igloo camp
      S.put(fIgloo(world), 11.0, z, { face: true });
      S.put(fSnowman(world, 0), 9.0, z - 4.0, { face: true }); S.put(fSnowman(world, 1), 9.6, z + 4.2, { face: true });
      S.put(fSled(world), 9.2, z - 1.6, { yaw: 0.4 });
      S.put(fPenguin(world, 0), 9.0, z + 2.0, { face: true, yaw: 0.4 });
      S.put(fPine(world, 0), 15.0, z + 1.5, { yaw: rng() * 6 }); S.put(fPine(world, 2), 14.2, z - 3.6, { yaw: rng() * 6 });
    } },
    { w: 13, weight: 2.4, fn: (S, z) => {          // cabin with smoke
      S.put(fCabin(world), 13.0, z, { face: true });
      S.put(fPine(world, 3), 18.8, z - 1.5, { yaw: rng() * 6 }); S.put(fPine(world, 1), 17.2, z + 4.4, { yaw: rng() * 6 });
      S.put(fSnowman(world, 0), 9.2, z + 3.4, { face: true });
      S.put(fPine(world, 2), 9.5, z - 4.8, { yaw: rng() * 6 }); S.put(fDrift(world, 1), 9.6, z - 1.0, { yaw: 0.5 });
    } },
    { w: 9, weight: 2.0, fn: (S, z) => {          // ice crystals
      S.put(fCrystals(world, 0), 10.8, z - 1.6, { yaw: rng() * 6, s: 1.1 });
      S.put(fCrystals(world, 1), 15.5, z + 1.6, { yaw: rng() * 6, s: 1.9 });
      S.put(fCrystals(world, 2), 9.4, z + 3.0, { yaw: rng() * 6, s: 0.7 });
      S.put(rock, 12.4, z - 3.0, { yaw: rng() * 6, s: 1.1 }); S.put(fPine(world, 2), 13.0, z + 3.4, { yaw: rng() * 6 });
    } },
    { w: 8, weight: 1.9, fn: (S, z) => {          // penguin playground
      S.put(fPenguin(world, 0), 9.2, z - 2.4, { face: true, yaw: 0.2 }); S.put(fPenguin(world, 1), 9.8, z - 1.0, { face: true, yaw: -0.3 }); S.put(fPenguin(world, 1), 9.0, z + 0.4, { face: true, yaw: 0.5 });
      S.put(fSnowman(world, 1), 10.4, z + 2.8, { face: true });
      S.put(fDrift(world, 0), 10.0, z + 0.0, { yaw: 1 }); S.put(fPine(world, 1), 13.2, z + 1.8, { yaw: rng() * 6 }); S.put(fPine(world, 3), 15.2, z - 2.4, { yaw: rng() * 6 });
      S.put(fCrystals(world, 1), 12.0, z - 3.0, { yaw: 1, s: 0.9 });
    } },
  ];
  S.compose(T, (S) => {
    S.scatter([fDrift(world, 0), fDrift(world, 1)], 4, 8.8, 18, { tint: 0 });
    S.scatter([tuftPrefab(world, 'ftuft', [0xdce9f6, 0xffffff, 0xaec8e4], 0.34, 5)], 14, 8.6, 18);
  });
  // ice floes on the sea next to the cliff
  const fl = pf(world, 'floe', (K) => { K.lit.cyl(0, 0, 0, 1.4, 1.3, 0.26, 0xf4fbff, { seg: 9, top: 0xffffff, ao: 0, g: [0.8, 1.05] }); K.lit.cyl(1.9, 0, 0.7, 0.8, 0.7, 0.2, 0xdff2ff, { seg: 7, top: 0xf4fbff, ao: 0 }); K.shadow(0.5, 0.2, 2.6, 2.2, 0.35, 0, 0.27, 0xbfe3ff); });
  for (let i = 0; i < 3; i++) S.put(fl, 23.2 + rng() * 2, -rng() * len, { yAbs: SEA_Y - 0.12, yaw: rng() * 6, s: 0.8 + rng() * 0.6 });
  return S.group();
}

// ===================================================================================================
// GOLDEN DUNES: sandstone arches, domes, minarets, palms, market tents, obelisks, camels, oasis
// ===================================================================================================
const DU = { sand: 0xe6bf80, sandT: 0xf6dca6, sandD: 0xc99a5a, teal: 0x2a9d8f, gold: 0xe9c46a, rust: 0xe76f51 };

function duPalm(world, v) {
  return palmPrefab(world, 'dpalm' + v, [
    { h: 6.2, lean: 0.12, nf: 9, fl: 2.6, trunkA: 0xa8794a, trunkB: 0x956a3e, leafA: 0x4f8f3a, leafB: 0xa6c24a },
    { h: 4.8, lean: -0.16, nf: 8, fl: 2.3, trunkA: 0xa8794a, trunkB: 0x956a3e, leafA: 0x5a9a3a, leafB: 0xb2cc54 },
    { h: 7.4, lean: 0.08, nf: 10, fl: 2.9, trunkA: 0xb0824f, trunkB: 0x9c6f42, leafA: 0x4f8f3a, leafB: 0xa6c24a, r0: 0.28 },
  ][v % 3]);
}
function duArch(world) {
  return pf(world, 'arch', (K) => {
    const pw = 1.7, gap = 5.2;
    for (const sx of [-1, 1]) {
      K.lit.box(sx * (gap / 2 + pw / 2) - pw / 2, 0, -0.9, pw, 5.0, 1.8, DU.sand, { top: DU.sandT, g: [0.75, 1.05], ao: 0.4 });
      K.lit.box(sx * (gap / 2 + pw / 2) - pw / 2 - 0.1, 0, -1.0, pw + 0.2, 0.5, 2.0, DU.sandD, { top: DU.sand });
      K.lit.box(sx * (gap / 2 + pw / 2) - pw / 2 - 0.12, 4.3, -1.0, pw + 0.24, 0.3, 2.0, DU.sandT, { ao: 0 });
      K.glow.box(sx * (gap / 2 + pw / 2) - 0.45, 1.5, 0.91, 0.9, 0.08, 0.02, 0xffb347);
      K.glow.box(sx * (gap / 2 + pw / 2) - 0.45, 2.3, 0.91, 0.9, 0.08, 0.02, 0xffb347);
      K.glow.box(sx * (gap / 2 + pw / 2) - 0.45, 3.1, 0.91, 0.9, 0.08, 0.02, 0xffb347);
      K.lit.box(sx * (gap / 2 + pw / 2) - 0.2, 0.5, 0.91, 0.4, 3.4, 0.03, DU.teal, { ao: 0, g: [1, 1] });
      // torch
      K.lit.cyl(sx * (gap / 2 - 0.3), 2.1, 0.95, 0.05, 0.05, 0.8, 0x4a3320, { seg: 5 });
      K.glow.cone(sx * (gap / 2 - 0.3), 2.85, 0.95, 0.12, 0.35, 0xffa21a, { seg: 5, top: 0xffe27a });
      K.halo_(sx * (gap / 2 - 0.3), 3.0, 0.95, 1.2, 0xffa040, 0.45);
    }
    K.lit.arch(0, 5.0, 0, gap / 2 + 0.1, 1.8, DU.sand, { top: DU.sandT, g: [0.8, 1.05], ao: 0 });
    K.lit.box(-gap / 2 - pw - 0.2, 7.55, -1.0, gap + pw * 2 + 0.4, 0.55, 2.0, DU.sandT, { top: 0xfff0c8, ao: 0 });
    K.lit.arch(0, 5.0, 0.9, gap / 2 + 0.12, 0.1, DU.teal, { ao: 0, g: [1, 1] });
    for (let i = 0; i < 8; i++) K.lit.box(-gap / 2 - pw - 0.2 + i * ((gap + pw * 2 + 0.4 - 0.5) / 7), 8.1, -0.8, 0.5, 0.5, 1.6, DU.sand, { top: DU.sandT, ao: 0 });
    K.glow.sph(0, 7.0, 0.95, 0.12, 0xffb347, { seg: 5 });
    K.shadow(0, 0, gap / 2 + pw + 0.8, 2.2, 0.4);
  });
}
function duDomeBuilding(world, v) {
  const dome = v ? DU.gold : DU.teal, domeT = v ? 0xfff0a8 : 0x7fe0d0;
  return pf(world, 'domehall' + v, (K) => {
    K.lit.rbox(0, 0, 0, 6.0, 4.0, 5.2, 0.08, 0xf6e3c0, { top: 0xfff2d6, g: [0.8, 1.05] });
    K.lit.box(-3.1, 3.6, -2.7, 6.2, 0.4, 5.4, DU.sandT, { top: 0xfff0c8, ao: 0 });
    K.lit.box(-3.1, 1.3, 2.6, 6.2, 0.18, 0.05, dome, { ao: 0 });
    for (const x of [-1.8, 0, 1.8]) {
      K.lit.box(x - 0.45, 0.5, 2.58, 0.9, 1.9, 0.05, 0x2b2d42, { ao: 0, g: [1, 1] });
      K.lit.arch(x, 2.4, 2.6, 0.45, 0.05, 0x2b2d42, { ao: 0, g: [1, 1] });
      K.glow.box(x - 0.34, 0.6, 2.62, 0.68, 1.7, 0.01, 0xffc46a); K.glow.cone(x, 2.2, 2.62, 0.34, 0.3, 0xffc46a, { seg: 6 });
    }
    K.lit.cyl(0, 4.0, 0, 1.9, 1.9, 0.9, 0xf6e3c0, { seg: 12, top: 0xfff2d6, ao: 0 });
    K.lit.dome(0, 4.9, 0, 2.15, dome, { seg: 14, sy: 1.0, top: domeT, g: [0.78, 1.1], ao: 0 });
    K.lit.cyl(0, 7.0, 0, 0.1, 0.06, 0.7, DU.gold, { seg: 5 }); K.glow.sph(0, 7.8, 0, 0.14, 0xffe27a, { seg: 5 });
    for (const [x, z] of [[-2.7, -2.2], [2.7, -2.2], [-2.7, 2.2], [2.7, 2.2]]) { K.lit.cyl(x, 3.9, z, 0.5, 0.5, 0.5, 0xf6e3c0, { seg: 8, ao: 0 }); K.lit.dome(x, 4.4, z, 0.62, dome, { seg: 8, top: domeT, ao: 0 }); K.lit.cone(x, 5.0, z, 0.06, 0.4, DU.gold, { seg: 4, ao: 0 }); }
    K.halo_(0, 3.0, 3.2, 3.5, 0xffc46a, 0.2);
    K.shadow(0.2, 0, 4.2, 3.6, 0.4);
  });
}
function duMinaret(world, v) {
  const cap = v ? DU.gold : DU.teal;
  return pf(world, 'minaret' + v, (K) => {
    K.lit.box(-0.9, 0, -0.9, 1.8, 1.2, 1.8, 0xf6e3c0, { top: 0xfff2d6, g: [0.75, 1.05], ao: 0.4 });
    K.lit.cyl(0, 1.2, 0, 0.7, 0.52, 6.2, 0xf6e3c0, { seg: 10, top: 0xfff2d6, g: [0.78, 1.05], ao: 0 });
    for (const y of [3.4, 5.4]) K.lit.cyl(0, y, 0, 0.5, 0.5, 0.06, cap, { seg: 10, ao: 0 });
    K.lit.cyl(0, 7.4, 0, 0.95, 0.95, 0.22, 0xe9d3a8, { seg: 12, top: 0xfff2d6, ao: 0 });
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; K.lit.cyl(Math.cos(a) * 0.9, 7.6, Math.sin(a) * 0.9, 0.03, 0.03, 0.4, 0xe9d3a8, { seg: 3, ao: 0 }); }
    K.lit.cyl(0, 7.4, 0, 1.0, 1.0, 0.06, cap, { seg: 12, ao: 0 });
    K.lit.cyl(0, 7.6, 0, 0.45, 0.4, 2.0, 0xf6e3c0, { seg: 10, top: 0xfff2d6, ao: 0 });
    K.lit.cone(0, 9.6, 0, 0.6, 1.6, cap, { seg: 10, top: v ? 0xfff0a8 : 0x7fe0d0, ao: 0 });
    K.lit.sph(0, 11.25, 0, 0.1, DU.gold, { seg: 5 });
    K.glow.tor(0, 11.6, 0, 0.2, 0.04, 0xffe27a, { ry: 0.0 });
    for (const y of [2.4, 4.4]) { K.glow.box(-0.07, y, 0.6, 0.14, 0.45, 0.02, 0xffc46a); K.glow.box(0.6, y, -0.07, 0.02, 0.45, 0.14, 0xffc46a); }
    K.glow.box(-0.12, 8.3, 0.4, 0.24, 0.5, 0.02, 0xffc46a);
    K.halo_(0, 11.5, 0, 1.6, 0xffe27a, 0.3);
    K.shadow(0.3, 0, 2.0, 2.0, 0.4);
  });
}
function duTent(world, v) {
  const c0 = [DU.rust, DU.teal, 0xe9c46a][v % 3], c1 = [0xffffff, 0xfff0c8, 0xe76f51][v % 3];
  return pf(world, 'tent' + v, (K) => {
    for (const [x, z] of [[-1.9, -1.5], [1.9, -1.5], [-1.9, 1.5], [1.9, 1.5]]) K.lit.cyl(x, 0, z, 0.07, 0.07, 2.5, 0x8a5a2b, { seg: 5, top: 0xa97542 });
    canopy(K, 0, 2.4, 0, 2.9, 1.1, c0, c1, 12, 0.0);
    for (let i = 0; i < 12; i++) { const a0 = i / 12 * TAU, a1 = (i + 1) / 12 * TAU, c = i % 2 ? c1 : c0; K.lit2.quad4([Math.cos(a0) * 2.9, 2.4, Math.sin(a0) * 2.9], [Math.cos(a1) * 2.9, 2.4, Math.sin(a1) * 2.9], [Math.cos(a1) * 2.9, 2.1, Math.sin(a1) * 2.9], [Math.cos(a0) * 2.9, 2.1, Math.sin(a0) * 2.9], c, { ao: 0 }); }
    K.lit.sph(0, 3.55, 0, 0.1, DU.gold, { seg: 4 });
    K.lit.box(-1.5, 0, -1.0, 3.0, 0.9, 0.9, 0xb7824a, { top: 0xd9a566 }); K.lit.box(-1.6, 0.9, -1.1, 3.2, 0.08, 1.1, 0xe3b274, { ao: 0 });
    K.lit.box(-1.4, 0.01, 0.3, 2.8, 0.03, 1.3, c0, { ao: 0, g: [1, 1] }); K.lit.box(-1.2, 0.02, 0.4, 2.4, 0.03, 1.1, DU.gold, { ao: 0, g: [1, 1] });
    for (let i = 0; i < 4; i++) { K.lit.cyl(-1.1 + i * 0.7, 0.98, -0.95, 0.22, 0.2, 0.22, 0xc2603a, { seg: 6, ao: 0 }); K.lit.ico(-1.1 + i * 0.7, 1.28, -0.95, 0.15, [0xff8a3d, 0xe5533d, 0xffd23f, 0x7cd04a][i], { det: 0, ao: 0 }); }
    for (const x of [-1.2, 1.2]) { K.glow.cyl(x, 1.85, 0.7, 0.1, 0.13, 0.3, 0xffb347, { seg: 6 }); K.lit.tube([[x, 2.4, 0.7], [x, 2.15, 0.7]], 0.01, 0x3d3028, { segs: 2, rad: 3, ao: 0 }); K.halo_(x, 2.0, 0.7, 0.9, 0xffa840, 0.4); }
    K.shadow(0, 0, 3.3, 2.6, 0.4);
  });
}
function duObelisk(world) {
  return pf(world, 'obelisk', (K) => {
    K.lit.box(-1.6, 0, -1.6, 3.2, 0.35, 3.2, DU.sandD, { top: DU.sand }); K.lit.box(-1.25, 0.35, -1.25, 2.5, 0.35, 2.5, DU.sand, { top: DU.sandT });
    K.lit.cyl(0, 0.7, 0, 0.95, 0.62, 6.0, DU.sand, { seg: 4, ry: PI / 4, top: DU.sandT, g: [0.75, 1.05], ao: 0.2 });
    K.lit.cone(0, 6.7, 0, 0.44, 0.7, DU.gold, { seg: 4, ry: PI / 4, top: 0xfff0a8, ao: 0 });
    for (let i = 0; i < 5; i++) { const y = 1.4 + i * 1.0; K.glow.box(-0.07, y, 0.78 - i * 0.04, 0.14, 0.5, 0.02, 0xffb347); K.glow.box(-0.3, y + 0.2, 0.78 - i * 0.04, 0.6, 0.06, 0.02, 0xffb347); }
    K.halo_(0, 7.3, 0, 1.6, 0xffe27a, 0.35);
    K.shadow(0.3, 0, 2.2, 2.2, 0.4);
  });
}
function duCamel(world, v) {
  return pf(world, 'camel' + v, (K) => {
    const c = [0xd8a864, 0xc99a5a][v % 2], t = 0xf0cc90;
    K.lit.box(-1.6, 0, -0.9, 3.2, 0.3, 1.8, DU.sandD, { top: DU.sand });
    // body along local x, head towards +x
    K.lit.sph(0, 2.1, 0, 1.0, c, { sx: 1.25, sy: 0.62, sz: 0.55, top: t, seg: 10 });
    K.lit.sph(-0.15, 2.8, 0, 0.5, c, { sy: 0.9, sx: 0.8, sz: 0.7, top: t, seg: 8 });
    K.lit.cyl(1.0, 2.2, 0, 0.3, 0.2, 1.1, c, { seg: 8, rz: -0.75, top: t, ao: 0 });
    K.lit.sph(1.65, 3.4, 0, 0.3, c, { sx: 1.2, sy: 0.8, seg: 8, top: t, ao: 0 });
    K.lit.sph(1.95, 3.32, 0, 0.17, c, { seg: 6, top: t, ao: 0 });
    for (const sz of [-1, 1]) K.glow.sph(1.7, 3.5, sz * 0.2, 0.04, 0x2b2d42, { seg: 4 });
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.36, 0.36]) K.lit.cyl(sx, 0.3, sz, 0.12, 0.09, 1.7, c, { seg: 6, top: t, ao: 0.2 });
    K.lit.tube([[-1.2, 2.2, 0], [-1.5, 1.8, 0], [-1.5, 1.2, 0]], 0.05, 0x8a5a2b, { segs: 4, rad: 3, ao: 0 });
    K.lit.box(-0.7, 2.42, -0.6, 1.4, 0.07, 1.2, DU.teal, { ao: 0 }); K.lit.box(-0.7, 2.43, -0.2, 1.4, 0.07, 0.15, DU.gold, { ao: 0 });
    K.shadow(0, 0, 2.0, 1.2, 0.35);
  });
}
function duPillars(world) {
  return pf(world, 'pillars', (K) => {
    for (let i = 0; i < 3; i++) {
      const x = -2.6 + i * 2.6, h = [3.8, 3.0, 2.4][i];
      K.lit.box(x - 0.45, 0, -0.45, 0.9, 0.3, 0.9, DU.sandD, { top: DU.sand }); K.lit.cyl(x, 0.3, 0, 0.36, 0.32, h, DU.sand, { seg: 8, top: DU.sandT, g: [0.78, 1.05] });
      K.lit.box(x - 0.5, 0.3 + h, -0.5, 1.0, 0.3, 1.0, DU.sandT, { top: 0xfff0c8, ao: 0 });
    }
    K.lit.box(-3.2, 4.4, -0.5, 1.9, 0.4, 1.0, DU.sandT, { rz: 0.05, top: 0xfff0c8, ao: 0 });
    K.shadow(0, 0, 4.0, 1.4, 0.35);
  });
}
function duOasis(world) {
  return pf(world, 'oasis', (K) => {
    K.lit.cyl(0, 0, 0, 4.2, 4.2, 0.12, 0x6fa04a, { seg: 14, top: 0x8bc34a, ao: 0, g: [0.9, 1.0] });
    K.glow.cyl(0, 0.1, 0, 3.4, 3.4, 0.05, 0x2fd4c4, { seg: 14, top: 0x7ff0e0 });
    K.lit.cyl(0, 0.08, 0, 3.55, 3.45, 0.08, 0xe3c48a, { seg: 14, ao: 0, g: [1, 1] });
    for (let i = 0; i < 9; i++) { const a = i * 0.9, r = 3.5 + (i % 2) * 0.3; for (let k = 0; k < 3; k++) K.lit.cone(Math.cos(a) * r + k * 0.08, 0.1, Math.sin(a) * r, 0.06, 1.0 + k * 0.2, 0x5a9a3a, { seg: 3, rz: (k - 1) * 0.15, top: 0xa6c24a, ao: 0, g: [1, 1] }); }
    for (let i = 0; i < 6; i++) K.lit.ico(Math.cos(i * 1.4) * 3.9, 0.15, Math.sin(i * 1.4) * 3.9, 0.35 + (i % 3) * 0.1, 0x9a8a7a, { top: 0xc0b0a0, det: 1, flat: true, rough: 0.3, sy: 0.7 });
    K.shadow(0, 0, 4.6, 4.6, 0.2);
  });
}
function duBanner(world, v) {
  return pf(world, 'banner' + v, (K) => {
    K.lit.cyl(0, 0, 0, 0.1, 0.07, 5.2, 0x4a3320, { seg: 6 }); K.lit.sph(0, 5.25, 0, 0.12, DU.gold, { seg: 5 });
    const c = [DU.teal, DU.rust][v % 2], c2 = DU.gold;
    K.lit2.quad4([0, 4.9, 0], [0.9, 4.8, 0.1], [0.9, 3.3, 0.05], [0, 3.4, 0], c, { top: c2, tc: [0, 0, 1, 1] });
    K.lit2.tri([0, 3.4, 0], [0.9, 3.3, 0.05], [0.45, 2.95, 0.03], c2, { tc: [0, 0, 0] });
    K.shadow(0.2, 0, 0.5, 0.5, 0.3);
  });
}

function genDunes(world, side, len, rng) {
  const S = new Chunk(world, side, len, rng);
  const ri = (n) => Math.floor(rng() * n);
  const jar = jarPrefab(world), rock = rockPrefab(world, 'drock', 0xc99a5a, 0xe6bf80, 1.1);
  const T = [
    { w: 11, weight: 2.6, fn: (S, z) => {          // arch gate
      S.put(duArch(world), 12.4, z, { face: true });
      S.put(duPalm(world, ri(3)), 9.8, z - 4.4, { yaw: rng() * 6, tint: 0.05 }); S.put(duPalm(world, ri(3)), 10.0, z + 4.2, { yaw: rng() * 6, tint: 0.05 });
      S.put(jar, 9.0, z + 1.6, { yaw: rng() * 6 }); S.put(jar, 9.4, z - 1.2, { yaw: rng() * 6, s: 0.85 });
      S.put(duBanner(world, ri(2)), 9.2, z + 3.0, {});
    } },
    { w: 14, weight: 2.6, fn: (S, z) => {          // domed hall and minaret
      S.put(duDomeBuilding(world, ri(2)), 12.8, z + 1.4, { face: true });
      S.put(duMinaret(world, ri(2)), 16.0, z - 4.4, {});
      S.put(duPalm(world, ri(3)), 9.6, z - 4.6, { yaw: rng() * 6, tint: 0.05 });
      S.put(duPalm(world, ri(3)), 9.4, z + 5.4, { yaw: rng() * 6, tint: 0.05 });
      S.put(jar, 9.0, z + 0.6, { yaw: rng() * 6 });
    } },
    { w: 12, weight: 2.4, fn: (S, z) => {          // market
      S.put(duTent(world, ri(3)), 10.8, z - 3.6, { face: true }); S.put(duTent(world, ri(3)), 11.2, z + 2.6, { face: true });
      S.put(duCamel(world, ri(2)), 9.6, z + 0.0, { face: true, s: 0.9 });
      S.put(jar, 9.0, z - 5.2, { yaw: 1 }); S.put(jar, 9.2, z + 5.2, { yaw: 2, s: 0.9 });
      S.put(duPalm(world, ri(3)), 14.6, z + 1.0, { yaw: rng() * 6 });
      S.put(duBanner(world, ri(2)), 9.0, z - 3.0, {});
    } },
    { w: 10, weight: 2.0, fn: (S, z) => {          // obelisk plaza
      S.put(duObelisk(world), 11.6, z, { yaw: 0 });
      S.put(duCamel(world, 0), 9.4, z - 3.6, { face: true, s: 0.85 }); S.put(duCamel(world, 1), 9.4, z + 3.6, { face: true, s: 0.85, yaw: PI });
      S.put(duPillars(world), 15.2, z, { face: true });
      S.put(duPalm(world, ri(3)), 13.4, z + 4.4, { yaw: rng() * 6 });
    } },
    { w: 12, weight: 2.2, fn: (S, z) => {          // oasis
      S.put(duOasis(world), 12.0, z, {});
      S.put(duPalm(world, 0), 10.4, z - 2.6, { yaw: 1, tint: 0.05 }); S.put(duPalm(world, 2), 13.6, z + 1.8, { yaw: 2, tint: 0.05 }); S.put(duPalm(world, 1), 12.2, z - 4.4, { yaw: 3, tint: 0.05 }); S.put(duPalm(world, 1), 9.4, z + 3.4, { yaw: 4, tint: 0.05 });
      S.put(rock, 14.0, z - 2.6, { yaw: rng() * 6, s: 1.1 });
    } },
    { w: 10, weight: 1.8, fn: (S, z) => {          // far minarets on the dunes
      S.put(duMinaret(world, 1), 24.0, z - 2.0, { s: 1.5, y: -0.4 });
      S.put(duDomeBuilding(world, 0), 20.5, z + 2.5, { face: true, y: -0.3, s: 1.2 });
      S.put(duPalm(world, ri(3)), 10.8, z + 1.8, { yaw: rng() * 6 }); S.put(duBanner(world, ri(2)), 9.2, z - 2.4, {}); S.put(jar, 9.4, z + 3.6, { yaw: 1 });
      S.put(rock, 12.0, z - 3.4, { yaw: 1, s: 1.3 });
    } },
  ];
  S.compose(T, (S) => {
    S.scatter([tuftPrefab(world, 'dtuft', [0xb9a064, 0xd8c07c, 0x9a8450], 0.3, 5)], 12, 8.6, 20);
    S.scatter([rockPrefab(world, 'drock2', 0xc99a5a, 0xe6bf80, 0.5)], 6, 8.8, 20);
  });
  return S.group();
}

// ===================================================================================================
// public API
// ===================================================================================================
const GEN = {
  harbor: typeof genHarbor === 'function' ? genHarbor : null,
  neon: typeof genNeon === 'function' ? genNeon : null,
  coral: typeof genCoral === 'function' ? genCoral : null,
  jungle: typeof genJungle === 'function' ? genJungle : null,
  frost: typeof genFrost === 'function' ? genFrost : null,
  dunes: typeof genDunes === 'function' ? genDunes : null,
};

export function makeProps(world, side, len, rng) {
  GAIN = WGAIN[world.id] || 1;
  const gen = GEN[world.id] || GEN.harbor;
  return gen(world, side < 0 ? -1 : 1, len || TILE, rng || Math.random);
}
export { groundY as propsGroundHeight };
// debug helper (triangle count per cached prefab)
export function propsDebugStats() {
  const out = [];
  for (const [k, v] of PF) { let t = 0; for (const b of BUCKETS) if (v[b]) t += v[b].p.length / 9; out.push([k, Math.round(t)]); }
  return out.sort((a, b) => b[1] - a[1]);
}
