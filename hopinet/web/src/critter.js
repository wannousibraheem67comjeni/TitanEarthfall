// critter.js - the Hopinet courier animals and their villain.
//
// Contents
//   * makeCritter(species, skin, opts)   seven species (rabbit, fox, bear, cat, frog, owl, dino) built
//                                        procedurally with vertex-coloured, merged geometry (a handful of
//                                        draw calls per character): chibi body, big expressive head with blinking
//                                        eyes / brows / two mouth states, goggles on the forehead (lens = skin.lens),
//                                        a chunky scarf with a ribbon tail that flutters in the wind, a delivery
//                                        backpack with a gold coin emblem, optional jet-pack with flames.
//   * animateCritter(root, mode, phase, t, extra)
//                                        stateless pose function: run jump slide fly fall wave idle swim dive ride
//                                        plane cheer hurt. Every call resets all transforms first.
//   * makeVillain() / animateVillain()   Captain Krab, the pirate crab (red shell, tricorn hat, eye patch,
//                                        hook claw, loot sack).
//   * critterPortraitSVG(species, skin, size)  SVG string of the head for UI cards (unique gradient ids per call).
//   * critterBakeStats()                 extra: triangle count per cached part (debug only).
//
// Conventions: models face -Z, origin at the ground contact point. Left = -X, right = +X (character's view).
// extra.bank: positive banks the rider like `group.rotation.z = +bank` would.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { G, Basic, blobShadowTex, sparkTex } from './models.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const { clamp } = THREE.MathUtils;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ------------------------------------------------------------------------------------------------
// colour helpers (perceptual HSL adjustments, hex in / hex out)
// ------------------------------------------------------------------------------------------------
const _hsl = { h: 0, s: 0, l: 0 };
function adj(hex, dl = 0, ds = 0, dh = 0) {
  const c = new THREE.Color(hex);
  c.getHSL(_hsl, THREE.SRGBColorSpace);
  c.setHSL((_hsl.h + dh + 1) % 1, clamp(_hsl.s + ds, 0, 1), clamp(_hsl.l + dl, 0, 1), THREE.SRGBColorSpace);
  return c.getHex(THREE.SRGBColorSpace);
}
function mixc(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(THREE.SRGBColorSpace); }
function lum(hex) { new THREE.Color(hex).getHSL(_hsl, THREE.SRGBColorSpace); return _hsl.l; }

// ------------------------------------------------------------------------------------------------
// geometry baking: primitives are transformed on the CPU, painted with vertex colours and merged per
// layer (body = lit, glow = unlit, glass = unlit translucent). Results are cached per (species,part,skin).
// ------------------------------------------------------------------------------------------------
const MAT = {
  body: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x12121a }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  glass: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false }),
  glass2: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false }),
  scarf: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x12121a }),
};
const SPH = () => G('cr_sph', () => new THREE.SphereGeometry(1, 20, 14));
const SPH_LO = () => G('cr_sphlo', () => new THREE.SphereGeometry(1, 10, 7));
const CYL = (seg = 18) => G('cr_cyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1));
const CYLT = (top, seg = 18) => G(`cr_cylt${top}_${seg}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1));
const CON = (seg = 20, hseg = 1) => G(`cr_con${seg}_${hseg}`, () => new THREE.ConeGeometry(1, 1, seg, hseg));
const TOR = (ratio, seg = 8, arc = TAU, rseg = 24) => G(`cr_tor${ratio}_${seg}_${arc}_${rseg}`, () => new THREE.TorusGeometry(1, ratio, seg, rseg, arc));
const RBX = (w, h, d, r) => G(`cr_rbx${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, Math.min(w, h, d) < 0.1 ? 1 : 2, r));
const CAPS = (r, len) => G(`cr_cap${r.toFixed(3)}_${len.toFixed(3)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 12));

const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _E = new THREE.Euler(), _P = new THREE.Vector3(), _S = new THREE.Vector3();
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _D = new THREE.Vector3();
function mk(o) {
  const p = o.p || [0, 0, 0], r = o.r || [0, 0, 0];
  let s = o.s || [1, 1, 1];
  if (typeof s === 'number') s = [s, s, s];
  _P.set(p[0], p[1], p[2]);
  _E.set(r[0], r[1], r[2], 'XYZ'); _Q.setFromEuler(_E);
  _S.set(s[0], s[1], s[2]);
  const m = new THREE.Matrix4().compose(_P, _Q, _S);
  if (o.base) m.premultiply(o.base);
  return m;
}

class Bake {
  constructor() { this.L = { body: [], glow: [], glass: [], glass2: [] }; }
  _add(geo, hex, o) {
    const layer = o.layer || 'body';
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(hex), ct = o.tip ? new THREE.Color(o.tip[0]) : null, t0 = o.tip ? o.tip[1] : 2;
    const ao = o.ao ?? 0.12, hi = o.hi ?? 0, gain = layer === 'body' ? GAIN : 1;
    const y0 = bb.min.y, ih = 1 / Math.max(1e-6, bb.max.y - bb.min.y);
    for (let i = 0; i < n; i++) {
      const t = (pos.getY(i) - y0) * ih;
      const k = 1 - ao * Math.pow(1 - t, 1.5) + hi * t * t;
      const cc = t >= t0 ? ct : c;
      col[i * 3] = cc.r * k * gain; col[i * 3 + 1] = cc.g * k * gain; col[i * 3 + 2] = cc.b * k * gain;
    }
    g.applyMatrix4(mk(o));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.L[layer].push(g);
    return this;
  }
  sph(c, p, s, o = {}) {
    const m = typeof s === 'number' ? s : Math.max(s[0], s[1], s[2]);
    return this._add(o.lo || m < 0.11 ? SPH_LO() : SPH(), c, { ...o, p, s });
  }
  cyl(c, p, rad, h, o = {}) { return this._add(o.top !== undefined ? CYLT(o.top, o.seg) : CYL(o.seg), c, { ...o, p, s: [rad, h, rad] }); }
  con(c, p, rad, h, o = {}) { return this._add(CON(o.seg, o.hseg), c, { ...o, p, s: [rad, h, rad] }); }
  // elliptic cone: s = [rx, h, rz] (tip +Y)
  conE(c, p, s, o = {}) { return this._add(CON(o.seg, o.hseg || 8), c, { ...o, p, s }); }
  box(c, p, d, rr, o = {}) { return this._add(RBX(d[0], d[1], d[2], rr), c, { ...o, p }); }
  tor(c, p, R, t, o = {}) {
    const s = o.s || [R, R, R];
    return this._add(TOR(+(t / R).toFixed(4), o.tseg || 6, o.arc || TAU, o.rseg || 24), c, { ...o, p, s });
  }
  geo(g, c, p, s, o = {}) { return this._add(g, c, { ...o, p, s }); }
  // smooth tube through points (CatmullRom); o.flat flattens it in local Z of the curve frame is not supported: use r small
  tube(c, pts, r, o = {}) {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
    const g = new THREE.TubeGeometry(curve, o.segs || 10, r, o.rad || 6, false);
    return this._add(g, c, { ...o, p: [0, 0, 0], s: [1, 1, 1] });
  }
  // capsule between two points (round ends); o.flat flattens the local Z, o.wid scales the local X
  cap(c, a, b, r, o = {}) {
    _A.set(a[0], a[1], a[2]); _B.set(b[0], b[1], b[2]);
    if (_A.y > _B.y) { _C.copy(_A); _A.copy(_B); _B.copy(_C); }
    _D.subVectors(_B, _A);
    const len = _D.length();
    _C.addVectors(_A, _B).multiplyScalar(0.5);
    _Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _D.normalize());
    const q = _Q.clone();
    const sc = [o.wid ?? 1, 1, o.flat ?? 1];
    const base = new THREE.Matrix4().compose(_C.clone(), q, new THREE.Vector3(1, 1, 1));
    return this._add(CAPS(r, len - 2 * r), c, { ...o, p: [0, 0, 0], s: sc, base: o.base ? base.premultiply(o.base) : base });
  }
  // tapered stick between two points: radius r0 at a, r1 at b, with round ends
  taper(c, a, b, r0, r1, o = {}) {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
    const d = new THREE.Vector3().subVectors(Bv, A), len = d.length();
    const mid = A.clone().add(Bv).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    // CYLT top radius ratio r1/r0 (top = +Y = towards b); scaled by r0
    const base = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    if (o.base) base.premultiply(o.base);
    const sc = [r0 * (o.wid ?? 1), len, r0 * (o.flat ?? 1)];
    this._add(CYLT(+(r1 / r0).toFixed(3), o.seg || 14), c, { ...o, p: [0, 0, 0], s: sc, base });
    this.sph(c, [...a], [r0 * (o.wid ?? 1), r0, r0 * (o.flat ?? 1)], { ...o, lo: true, base: o.base });
    this.sph(c, [...b], [r1 * (o.wid ?? 1), r1, r1 * (o.flat ?? 1)], { ...o, lo: true, base: o.base });
    return this;
  }
  finish() {
    const out = {};
    for (const k of ['body', 'glow', 'glass', 'glass2']) out[k] = this.L[k].length ? mergeGeometries(this.L[k], false) : null;
    this.L = null;
    return out;
  }
}
const GAIN = 1.16; // vertex colours are lit by hemisphere+sun (~0.8 of albedo): compensate so whites stay white
const BAKED = new Map();
// debug helper: triangle count of every baked part (extra export, not used by the game)
export function critterBakeStats() {
  const out = {};
  for (const [k, v] of BAKED) { let t = 0; for (const g of Object.values(v)) if (g) t += g.attributes.position.count / 3; out[k] = t; }
  return out;
}
// Bakes (once per key) and attaches the merged meshes to `parent`.
function put(parent, key, build, o = {}) {
  let r = BAKED.get(key);
  if (!r) { const B = new Bake(); build(B); r = B.finish(); BAKED.set(key, r); }
  const out = [];
  for (const L of ['body', 'glow', 'glass', 'glass2']) {
    if (!r[L]) continue;
    const m = new THREE.Mesh(r[L], MAT[L]);
    if (L === 'body' && o.cast) m.castShadow = true;
    if (L === 'glass' || L === 'glass2') m.renderOrder = 3;
    parent.add(m); out.push(m);
  }
  return out;
}
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

// ------------------------------------------------------------------------------------------------
// surface frames on the head ellipsoid: local +Z points out of the surface, +Y is up
// ------------------------------------------------------------------------------------------------
const _o3 = new THREE.Object3D();
function frame(H, latDeg, lonDeg, push = 0, roll = 0) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const p = new THREE.Vector3(H.rx * cl * so, H.cy + H.ry * sl, -H.rz * cl * co);
  const n = new THREE.Vector3(p.x / (H.rx * H.rx), (p.y - H.cy) / (H.ry * H.ry), p.z / (H.rz * H.rz)).normalize();
  p.addScaledVector(n, push);
  _o3.position.copy(p); _o3.quaternion.identity(); _o3.rotation.set(0, 0, 0); _o3.up.set(0, 1, 0);
  _o3.lookAt(p.clone().add(n));
  if (roll) _o3.rotateZ(roll * DEG);
  _o3.updateMatrix();
  return _o3.matrix.clone();
}
function headPoint(H, latDeg, lonDeg, push = 0) {
  const m = frame(H, latDeg, lonDeg, push);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

// matrix whose local +Z points to world -Z (the direction the character faces) positioned at (x,y,z); pitch tilts it up
function faceAt(x, y, z, pitch = 0) {
  _o3.position.set(x, y, z); _o3.rotation.set(pitch, Math.PI, 0); _o3.scale.set(1, 1, 1); _o3.updateMatrix();
  return _o3.matrix.clone();
}
const skinKey = (s) => [s.fur, s.belly, s.accent, s.scarf, s.lens].map((v) => (v >>> 0).toString(16)).join('.');

// ------------------------------------------------------------------------------------------------
// species table
// ------------------------------------------------------------------------------------------------
const STYLE = {
  rabbit: { hipX: 0.2, shX: 0.4, torso: [0.35, 0.36, 0.32], H: { rx: 0.5, ry: 0.44, rz: 0.47, cy: 0.35 }, iris: 0x3b2540 },
  fox:    { hipX: 0.2, shX: 0.4, torso: [0.34, 0.35, 0.31], H: { rx: 0.52, ry: 0.43, rz: 0.46, cy: 0.35 }, iris: 0xf2a21a },
  bear:   { hipX: 0.23, shX: 0.43, torso: [0.4, 0.37, 0.35], H: { rx: 0.54, ry: 0.47, rz: 0.5, cy: 0.36 }, iris: 0x2a1a12 },
  cat:    { hipX: 0.19, shX: 0.38, torso: [0.32, 0.35, 0.29], H: { rx: 0.53, ry: 0.44, rz: 0.47, cy: 0.36 }, iris: 0x7be05a },
  frog:   { hipX: 0.22, shX: 0.4, torso: [0.36, 0.34, 0.32], H: { rx: 0.6, ry: 0.38, rz: 0.5, cy: 0.3 }, iris: 0xffd23f },
  owl:    { hipX: 0.18, shX: 0.4, torso: [0.4, 0.38, 0.35], H: { rx: 0.54, ry: 0.48, rz: 0.5, cy: 0.38 }, iris: 0xffb41a },
  dino:   { hipX: 0.22, shX: 0.38, torso: [0.36, 0.37, 0.33], H: { rx: 0.46, ry: 0.44, rz: 0.5, cy: 0.36 }, iris: 0xffd23f },
};
const HIP_Y = 0.58, NECK_Y = 0.44, SH_Y = 0.36, THIGH = 0.2, UPPER = 0.2;

function createKit(sp, skin, opts) {
  const S = STYLE[sp];
  const root = new THREE.Group(); root.name = 'critter_' + sp;
  const rig = grp(root);
  const k = { sp, skin, opts, S, H: S.H, ks: skinKey(skin), root, rig, key: (part) => `${sp}.${part}.${skinKey(skin)}` };
  k.legs = [-1, 1].map((sx) => { const hip = grp(rig, sx * S.hipX, HIP_Y, 0); return { sx, hip, shin: grp(hip, 0, -THIGH, 0) }; });
  k.torso = grp(rig, 0, HIP_Y, 0);
  k.head = grp(k.torso, 0, NECK_Y, 0);
  k.arms = [-1, 1].map((sx) => { const sh = grp(k.torso, sx * S.shX, SH_Y, 0); return { sx, sh, fore: grp(sh, 0, -UPPER, 0) }; });
  k.tail = grp(k.torso, 0, 0.02, 0.3);
  k.tailSegs = [];
  k.ears = []; k.earTips = []; k.eyes = []; k.brows = [];
  k.shadow = new THREE.Mesh(G('cr_shadowplane', () => new THREE.PlaneGeometry(1.7, 1.7)), Basic(0xffffff, { map: blobShadowTex(), opacity: 1 }));
  k.shadow.rotation.x = -Math.PI / 2; k.shadow.position.y = 0.02; k.shadow.renderOrder = 1;
  root.add(k.shadow);
  return k;
}

// ------------------------------------------------------------------------------------------------
// shared pieces: torso, limbs, eyes, brows, mouths, goggles, scarf, backpack, jet pack
// ------------------------------------------------------------------------------------------------
// o: fur belly foot(colour) hand(colour) pad(colour) footS legR armR handR cuff(bool) thigh(colour)
function bodyStd(k, o) {
  const S = k.S, [tx, ty, tz] = S.torso;
  const fur = o.fur, belly = o.belly;
  put(k.torso, k.key('torso') + (o.tag || ''), (B) => {
    B.sph(fur, [0, 0.2, 0], [tx, ty, tz], { ao: 0.32 });
    if (!o.noBelly) B.sph(belly, [0, 0.14, -tz * 0.5], [tx * 0.76, ty * 0.8, tz * 0.62], { ao: 0.18 });
    if (o.torsoExtra) o.torsoExtra(B);
  }, { cast: true });
  // legs
  const legR = o.legR ?? 0.145, shinR = o.shinR ?? 0.125, fs = o.footS ?? [0.15, 0.078, 0.235];
  for (const L of k.legs) {
    put(L.hip, k.key('thigh') + (o.tag || ''), (B) => {
      B.taper(o.thigh ?? fur, [0, 0.04, 0], [0, -THIGH - 0.02, 0], legR, legR * 0.93, { ao: 0.0 });
    });
    put(L.shin, k.key('shin' + L.sx) + (o.tag || ''), (B) => {
      B.taper(o.shin ?? o.foot ?? fur, [0, 0.0, 0], [0, -0.27, 0], shinR * 1.03, shinR * 0.86, { ao: 0.0 });
      const fz = -0.09 - (fs[2] - 0.235) * 0.5;
      B.sph(o.foot ?? fur, [0, -0.305, fz], fs, { ao: 0.3, hi: 0.1 });
      if (o.pad !== undefined) B.sph(o.pad, [0, -0.376, fz + 0.02], [fs[0] * 0.66, 0.012, fs[2] * 0.62], { ao: 0 });
      if (o.footExtra) o.footExtra(B, L.sx, fs, fz);
    });
  }
  // arms
  const armR = o.armR ?? 0.1, handR = o.handR ?? 0.125;
  for (const A of k.arms) {
    put(A.sh, k.key('uarm' + A.sx) + (o.tag || ''), (B) => {
      B.sph(o.sleeve ?? fur, [0, 0, 0], armR * 1.04, { ao: 0.0, lo: true });
      B.taper(o.sleeve ?? fur, [0, 0.0, 0], [0, -UPPER, 0], armR * 1.03, armR * 0.93, { ao: 0.0 });
    });
    put(A.fore, k.key('farm' + A.sx) + (o.tag || ''), (B) => {
      B.taper(o.forearm ?? o.hand ?? fur, [0, 0, 0], [0, -0.2, 0], armR * 0.93, armR * 0.84, { ao: 0.0 });
      if (o.cuff !== false) B.tor(adj(k.skin.scarf, -0.12), [0, -0.15, 0], armR * 0.98, 0.03, { r: [Math.PI / 2, 0, 0], ao: 0.15 });
      B.sph(o.hand ?? fur, [0, -0.255, -0.02], [handR, handR * 0.95, handR], { ao: 0.1, hi: 0.0 });
      if (o.handExtra) o.handExtra(B, A.sx, handR);
    });
  }
}

// Big glossy cartoon eye in a head-surface frame. o: r, rh, iris, pupil, slit, tilt, ir
function eyeBake(B, o) {
  const r = o.r, rh = o.rh ?? 1.12;
  B.sph(o.sclera ?? 0xffffff, [0, 0, -r * 0.3], [r, r * rh, r * 0.62], { ao: 0.1 });
  const ir = r * (o.ir ?? 0.82), ix = o.ix ?? 0, iy = o.iy ?? -r * 0.04;
  B.sph(o.iris, [ix, iy, r * 0.1], [ir, ir * rh, ir * 0.5], { ao: 0.1, hi: 0.15 });
  const pr = ir * (o.pr ?? 0.56);
  if (o.slit) B.sph(o.pupil ?? 0x14101c, [ix, iy, r * 0.22], [pr * 0.4, pr * 1.45 * rh, pr * 0.5], { ao: 0 });
  else B.sph(o.pupil ?? 0x14101c, [ix, iy, r * 0.22], [pr, pr * rh, pr * 0.5], { ao: 0 });
  B.sph(0xffffff, [ix - ir * 0.34, iy + ir * 0.36 * rh, r * 0.36], [ir * 0.27, ir * 0.27, ir * 0.14], { layer: 'glow', ao: 0, lo: true });
  B.sph(0xffffff, [ix + ir * 0.36, iy - ir * 0.34 * rh, r * 0.34], [ir * 0.12, ir * 0.12, ir * 0.1], { layer: 'glow', ao: 0, lo: true });
}
// Adds both eyes (+ brows) at lat/lon on the head. Returns nothing; fills k.eyes/k.brows.
function eyesStd(k, o) {
  const H = k.H;
  for (const sx of [-1, 1]) {
    const g = grp(k.head);
    g.matrixAutoUpdate = true;
    const m = o.frames ? o.frames[sx < 0 ? 0 : 1] : frame(H, o.lat ?? 4, sx * (o.lon ?? 27), o.push ?? -0.015, sx * (o.roll ?? 0));
    m.decompose(g.position, g.quaternion, g.scale);
    put(g, k.key('eye') + `${o.r}.${o.lat}.${o.lon}.${o.iris}${o.slit ? 's' : ''}${o.rh ?? ''}${o.tag || ''}`, (B) => eyeBake(B, { ...o, iris: o.iris ?? k.S.iris }));
    k.eyes.push(g);
    if (o.brow !== false) {
      const bg = grp(k.head);
      const bm = o.browFrames ? o.browFrames[sx < 0 ? 0 : 1] : frame(H, (o.lat ?? 4) + (o.browLat ?? 21), sx * (o.browLon ?? (o.lon ?? 27) + 2), 0.0);
      bm.decompose(bg.position, bg.quaternion, bg.scale);
      const inner = grp(bg);
      put(inner, k.key('brow') + (o.browTag || ''), (B) => {
        B.cap(o.browColor ?? (lum(k.skin.fur) > 0.5 ? mixc(k.skin.fur, 0x3a2a30, 0.8) : adj(k.skin.fur, 0.14)), [-0.075, 0, 0], [0.075, 0, 0], o.browR ?? 0.022, { ao: 0.05, flat: 0.8 });
      });
      inner.userData.sx = sx;
      k.brows.push(inner);
    }
  }
}

// Smile (shut) + open mouth variants placed with a frame matrix. w = half-width.
function mouthStd(k, o) {
  const shutG = grp(k.head), openG = grp(k.head);
  for (const g of [shutG, openG]) { o.base.clone().decompose(g.position, g.quaternion, g.scale); }
  const dark = o.dark ?? 0x3b1f2a;
  put(shutG, k.key('mshut') + (o.tag || ''), (B) => {
    // little "w"/smile made of two arcs
    const w = o.w, t = o.t ?? 0.016;
    B.tor(dark, [-w * 0.5, 0, 0], w * 0.5, t, { r: [0, 0, Math.PI], arc: Math.PI, tseg: 5, rseg: 14, ao: 0, s: [w * 0.5, w * 0.42, w * 0.5] });
    B.tor(dark, [w * 0.5, 0, 0], w * 0.5, t, { r: [0, 0, Math.PI], arc: Math.PI, tseg: 5, rseg: 14, ao: 0, s: [w * 0.5, w * 0.42, w * 0.5] });
    if (o.shutExtra) o.shutExtra(B);
  });
  put(openG, k.key('mopen') + (o.tag || ''), (B) => {
    const w = o.w;
    B.sph(o.inside ?? 0x4a1020, [0, -w * 0.25, -0.005], [w * 0.95, w * 0.78, w * 0.3], { ao: 0.0, hi: 0.0 });
    B.sph(0xff7a8c, [0, -w * 0.62, 0.012], [w * 0.55, w * 0.32, w * 0.2], { ao: 0.1 });
    if (o.openExtra) o.openExtra(B);
  });
  openG.visible = false;
  k.mouthShut = shutG; k.mouthOpen = openG;
}

// Goggles pushed up on the forehead: strap around the head, two lens cups with glass in skin.lens.
function gogglesStd(k, o = {}) {
  const H = k.H, lens = k.skin.lens;
  const strapC = adj(k.skin.scarf, lum(k.skin.scarf) > 0.55 ? -0.32 : -0.2, -0.05);
  const lat = o.lat ?? 52, lon = o.lon ?? 30, lr = o.r ?? 0.13;
  const sLat = o.strapLat ?? (lat - 4);
  const sl = Math.sin(sLat * DEG), cl = Math.cos(sLat * DEG);
  put(k.head, k.key('goggles') + `${lat}.${lon}.${lr}.${sLat}${o.over ? 'o' : ''}${o.tag || ''}`, (B) => {
    // strap
    const sy = H.cy + H.ry * sl;
    const stLon = (o.over ? 27 : lon) * DEG;
    B.tor(strapC, [0, sy, 0], 1, 0.075, { r: [Math.PI / 2, 0, -(Math.PI / 2 - stLon)], arc: TAU - 2 * stLon, s: [H.rx * cl + 0.012, H.rz * cl + 0.012, 0.5 * (H.rx + H.rz) * cl], tseg: 6, rseg: 40, ao: 0.1 });
    // buckle at the back
    B.box(0xe8c25a, [0, sy, H.rz * cl + 0.02], [0.14, 0.09, 0.04], 0.015, { ao: 0.1 });
    if (o.over) for (const ov of o.over) {
      const m = ov.m, r = ov.r;
      B.tor(0xdfe6f2, [0, 0, 0.0], r, 0.03, { base: m, ao: 0.2, tseg: 5, rseg: 24 });
      B.tor(0x8c95aa, [0, 0, -0.02], r + 0.014, 0.024, { base: m, ao: 0.2, tseg: 4, rseg: 24 });
      B.sph(lens, [0, 0, 0.005], [r * 0.99, r * 0.99, r * 0.5], { layer: 'glass2', base: m, ao: 0 });
      B.sph(0xffffff, [-r * 0.45, r * 0.5, r * 0.46], [r * 0.2, r * 0.1, 0.012], { layer: 'glow', base: m, ao: 0, lo: true, r: [0, 0, 0.7] });
    }
    for (const sx of o.over ? [] : [-1, 1]) {
      const m = frame(H, lat, sx * lon, 0.0);
      // foam cup
      B.cyl(0x20222c, [0, 0, 0.0], lr + 0.012, 0.13, { r: [Math.PI / 2, 0, 0], base: m, ao: 0.1 });
      // metal rim
      B.tor(0xdfe6f2, [0, 0, 0.068], lr, 0.026, { base: m, ao: 0.2, tseg: 5, rseg: 20 });
      B.tor(0xaab3c6, [0, 0, 0.052], lr + 0.01, 0.02, { base: m, ao: 0.2, tseg: 4, rseg: 20 });
      // glass dome (translucent, unlit) + deep inner disc so it reads as a glowing lens
      B.sph(lens, [0, 0, 0.045], [lr * 0.98, lr * 0.98, 0.05], { layer: 'glass', base: m, ao: 0, hi: 0.35 });
      B.sph(adj(lens, -0.1), [0, 0, 0.01], [lr * 0.95, lr * 0.95, 0.04], { layer: 'glow', base: m, ao: 0.1, hi: 0.4 });
      B.sph(0xffffff, [-lr * 0.35, lr * 0.38, 0.082], [lr * 0.2, lr * 0.11, 0.012], { layer: 'glow', base: m, ao: 0, lo: true, r: [0, 0, 0.7] });
    }
    // bridge
    if (!o.over) { const pb = headPoint(H, lat + 3, 0, 0.0); B.box(0xaab3c6, [pb.x, pb.y, pb.z - 0.01], [0.13, 0.05, 0.05], 0.02, { ao: 0.1 }); }
  }, { cast: false });
}

// scarf ring + knot + stub, backpack (+ straps, coin), jet pack, ribbon tail
function outfitStd(k, o = {}) {
  const sc = k.skin.scarf, S = k.S, [tx, ty, tz] = S.torso;
  const scD = adj(sc, -0.14), scL = adj(sc, 0.12);
  const bagC = adj(sc, lum(sc) > 0.55 ? -0.3 : -0.18, -0.02), bagF = adj(sc, lum(sc) > 0.7 ? -0.12 : 0.0);
  const strap = adj(sc, -0.32, -0.1);
  const bz = tz + 0.06; // bag centre z
  put(k.torso, k.key('outfit') + (o.tag || ''), (B) => {
    // scarf ring around the neck
    B.tor(sc, [0, 0.42, 0.0], 1, 0.3, { r: [Math.PI / 2 - 0.1, 0, 0], s: [0.3, 0.29, 0.29], tseg: 12, rseg: 36, ao: 0.2, hi: 0.1 });
    B.tor(scL, [0, 0.455, -0.01], 1, 0.12, { r: [Math.PI / 2 - 0.1, 0, 0], s: [0.285, 0.275, 0.275], tseg: 8, rseg: 36, ao: 0, hi: 0.15 });
    // knot + short stub
    B.sph(scD, [0.17, 0.4, 0.23], [0.1, 0.095, 0.09], { ao: 0.2 });
    B.cap(sc, [0.17, 0.38, 0.27], [0.2, 0.2, 0.34], 0.06, { flat: 0.45, ao: 0.2 });
  }, { cast: true });
  if (k.opts.backpack === false) return;
  put(k.torso, k.key('pack') + (o.tag || ''), (B) => {
    // backpack body
    B.box(bagC, [0, 0.2, bz], [0.58, 0.58, 0.28], 0.1, { ao: 0.3, hi: 0.12 });
    B.box(bagF, [0, 0.4, bz + 0.012], [0.6, 0.24, 0.3], 0.085, { ao: 0.2, hi: 0.15 });           // flap
    B.box(adj(bagC, -0.06), [-0.3, 0.1, bz - 0.01], [0.1, 0.22, 0.2], 0.04, { ao: 0.2 });         // side pockets
    B.box(adj(bagC, -0.06), [0.3, 0.1, bz - 0.01], [0.1, 0.22, 0.2], 0.04, { ao: 0.2 });
    B.box(0xe9d7b0, [0, 0.04, bz + 0.16], [0.56, 0.11, 0.1], 0.04, { ao: 0.12 });                // pocket strip
    // buckle straps over the flap
    for (const sx of [-1, 1]) B.box(strap, [sx * 0.19, 0.28, bz + 0.15], [0.065, 0.46, 0.03], 0.012, { ao: 0.1 });
    B.box(0xf0c648, [-0.19, 0.44, bz + 0.17], [0.09, 0.07, 0.03], 0.012, { layer: 'body', ao: 0 });
    B.box(0xf0c648, [0.19, 0.44, bz + 0.17], [0.09, 0.07, 0.03], 0.012, { layer: 'body', ao: 0 });
    // gold coin emblem
    B.cyl(0xf2b51d, [0, 0.19, bz + 0.15], 0.15, 0.04, { r: [Math.PI / 2, 0, 0], layer: 'glow', ao: 0.2, hi: 0.1 });
    B.tor(0xffe07a, [0, 0.19, bz + 0.172], 0.14, 0.014, { layer: 'glow', ao: 0, tseg: 5, rseg: 28 });
    B.geo(starGeo(), 0xffe9a0, [0, 0.19, bz + 0.175], [0.085, 0.085, 1], { layer: 'glow', ao: 0, hi: 0 });
    // shoulder straps on the chest
    for (const sx of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const y = 0.42 - i * 0.1, x = sx * (0.17 + i * 0.012);
        const q = 1 - (x / tx) ** 2 - ((y - 0.2) / ty) ** 2;
        pts.push([x, y, -tz * Math.sqrt(Math.max(0.02, q)) - 0.012]);
      }
      B.tube(strap, pts, 0.032, { ao: 0.0, segs: 12 });
      B.box(0xf0c648, [pts[4][0], pts[4][1], pts[4][2] - 0.008], [0.07, 0.05, 0.03], 0.01, { ao: 0 });
    }
    // bedroll / parcel tube under the bag
    B.cyl(0xf3e4c0, [0, -0.1, bz + 0.03], 0.085, 0.64, { r: [0, 0, Math.PI / 2], ao: 0.25 });
    for (const sx of [-1, 1]) {
      B.cyl(adj(0xf3e4c0, -0.1), [sx * 0.325, -0.1, bz + 0.03], 0.074, 0.03, { r: [0, 0, Math.PI / 2], ao: 0.1 });
      B.cyl(strap, [sx * 0.2, -0.1, bz + 0.03], 0.092, 0.05, { r: [0, 0, Math.PI / 2], ao: 0.1 });
    }
  }, { cast: true });
}
function starGeo() {
  return G('cr_star', () => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + Math.PI / 2, r = i % 2 ? 0.45 : 1;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return new THREE.ShapeGeometry(s);
  });
}

let _flameGlow = null;
const flameGlowMat = () => _flameGlow || (_flameGlow = new THREE.SpriteMaterial({ map: sparkTex(), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
function jetStd(k) {
  const jet = grp(k.torso, 0, 0, 0);
  const S = k.S, bz = S.torso[2] + 0.06;
  put(jet, 'cr.jet.' + k.sp, (B) => {
    for (const sx of [-1, 1]) {
      const x = sx * 0.37, z = bz + 0.12;
      B.cyl(0xd9dee8, [x, 0.12, z], 0.1, 0.52, { ao: 0.3, hi: 0.2 });
      B.cyl(0xff4a3d, [x, 0.34, z], 0.104, 0.1, { ao: 0.1 });
      B.cyl(0x3a3f4d, [x, -0.18, z], 0.12, 0.1, { top: 0.78, ao: 0.1 });
      B.con(0x2a2d38, [x, -0.2, z], 0.115, 0.14, { r: [Math.PI, 0, 0], ao: 0 });
      B.sph(0xff4a3d, [x, 0.42, z], [0.1, 0.06, 0.1], { ao: 0.1 });
      B.box(0x3a3f4d, [sx * 0.31, 0.12, bz + 0.03], [0.1, 0.12, 0.1], 0.02, { ao: 0 });
    }
  });
  const flames = [];
  for (const sx of [-1, 1]) {
    const f = grp(jet, sx * 0.37, -0.25, bz + 0.12);
    const outer = new THREE.Mesh(G('cr_flame', () => { const g = new THREE.ConeGeometry(0.115, 0.7, 14, 1, true); g.rotateX(Math.PI); g.translate(0, -0.35, 0); return g; }), Basic(0xff8a1f, { opacity: 0.8, blend: true, side: true }));
    const inner = new THREE.Mesh(G('cr_flame2', () => { const g = new THREE.ConeGeometry(0.06, 0.46, 12, 1, true); g.rotateX(Math.PI); g.translate(0, -0.23, 0); return g; }), Basic(0xffe9a0, { opacity: 0.95, blend: true, side: true }));
    f.add(outer, inner);
    const glow = new THREE.Sprite(flameGlowMat());
    glow.scale.set(0.5, 0.5, 0.5); glow.position.y = -0.18;
    f.add(glow);
    flames.push(f);
  }
  jet.visible = !!k.opts.jet;
  jet.userData.flames = flames;
  k.jet = jet;
}

// Ribbon tail of the scarf (dynamic vertices, updated in animateCritter)
function scarfRibbon(k) {
  const g = grp(k.torso, 0.16, 0.44, 0.22);
  const sc = k.skin.scarf, light = adj(sc, 0.3, -0.1), dark = adj(sc, -0.1);
  const rows = [[0, sc], [0.14, sc], [0.3, sc], [0.46, sc], [0.58, sc], [0.58, light], [0.66, light], [0.66, sc], [0.74, sc], [0.74, light], [0.82, light], [0.82, sc], [0.92, sc], [1, dark]];
  const N = rows.length;
  const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3);
  const idx = [];
  const c = new THREE.Color();
  rows.forEach(([s, hex], i) => {
    c.set(hex);
    for (let j = 0; j < 2; j++) { const b = (i * 2 + j) * 3; col[b] = c.r * GAIN; col[b + 1] = c.g * GAIN; col[b + 2] = c.b * GAIN; }
    if (i < N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, MAT.scarf);
  mesh.frustumCulled = false;
  g.add(mesh);
  g.userData.rows = rows.map((r) => r[0]);
  g.userData.geo = geo;
  k.scarfTail = g;
}

// ------------------------------------------------------------------------------------------------
// SPECIES BUILDERS
// ------------------------------------------------------------------------------------------------
const BUILD = {};

BUILD.rabbit = (k) => {
  const { fur, belly, accent } = k.skin, H = k.H;
  const pink = accent, pinkD = adj(accent, -0.14);
  bodyStd(k, {
    fur, belly, foot: fur, hand: fur, pad: pinkD, footS: [0.15, 0.08, 0.27], legR: 0.15,
    footExtra: (B, sx, fs, fz) => { for (const t of [-1, 0, 1]) B.sph(adj(fur, -0.05), [t * 0.062, -0.3, fz - fs[2] * 0.84], [0.048, 0.05, 0.05], { lo: true, ao: 0.1 }); },
  });
  // head
  put(k.head, k.key('head'), (B) => {
    B.sph(fur, [0, H.cy, 0], [H.rx, H.ry, H.rz], { ao: 0.2, hi: 0.05 });
    for (const sx of [-1, 1]) {
      B.sph(fur, [sx * 0.24, H.cy - 0.15, -0.26], [0.2, 0.16, 0.18], { ao: 0.15 });
      B.sph(mixc(fur, accent, 0.55), [sx * 0.34, H.cy - 0.08, -0.27], [0.07, 0.045, 0.03], { ao: 0, lo: true, r: [0.1, -0.7 * sx, 0] }); // blush
    }
    B.sph(belly, [0, H.cy - 0.12, -0.41], [0.2, 0.15, 0.12], { ao: 0.15 });
    B.sph(pinkD, [0, H.cy - 0.05, -0.515], [0.062, 0.045, 0.04], { ao: 0.1, hi: 0.2, lo: true });
    B.cap(adj(fur, -0.4), [0, H.cy - 0.09, -0.51], [0, H.cy - 0.145, -0.495], 0.008, { ao: 0 });
    for (const sx of [-1, 1]) B.box(0xfffaf0, [sx * 0.032, H.cy - 0.2, -0.495], [0.056, 0.095, 0.03], 0.014, { ao: 0.15 });
  }, { cast: true });
  eyesStd(k, { r: 0.135, lat: 5, lon: 28, iris: 0x3b2540, ir: 0.86, pr: 0.5, browLat: 23 });
  mouthStd(k, { base: faceAt(0, H.cy - 0.185, -0.505), w: 0.07, tag: 'r' });
  gogglesStd(k, { lat: 53, lon: 26, r: 0.125 });
  for (const sx of [-1, 1]) {
    const mount = grp(k.head, sx * 0.19, H.cy + 0.37, 0.07);
    mount.rotation.z = -sx * 0.2; mount.rotation.x = 0.06;
    const ear = grp(mount);
    const tip = grp(ear, 0, 0.36, 0);
    put(ear, k.key('ear' + sx), (B) => {
      B.taper(fur, [0, 0, 0], [0, 0.36, 0], 0.125, 0.118, { ao: 0.1, flat: 0.5 });
      B.taper(pink, [0, 0.03, -0.045], [0, 0.34, -0.045], 0.08, 0.078, { ao: 0.08, flat: 0.32 });
    });
    put(tip, k.key('eartip' + sx), (B) => {
      B.taper(fur, [0, 0, 0], [0, 0.34, 0], 0.118, 0.075, { ao: 0.05, hi: 0.04, flat: 0.5 });
      B.taper(pink, [0, 0.0, -0.045], [0, 0.3, -0.045], 0.078, 0.045, { ao: 0.05, flat: 0.32 });
    });
    k.ears.push(ear); k.earTips.push(tip);
  }
  put(k.tail, k.key('tail'), (B) => {
    B.sph(belly, [0, 0, 0.0], 0.19, { ao: 0.2 });
    const d = [[0.12, 0.1, 0.02], [-0.13, 0.08, 0.02], [0.0, 0.15, 0.06], [0.11, -0.1, 0.04], [-0.1, -0.1, 0.06], [0, 0.0, 0.16]];
    for (const [x, y, z] of d) B.sph(belly, [x, y, z], 0.1, { ao: 0.15, lo: true });
  });
  k.tail.position.set(0, -0.1, 0.5);
  k.tailSegs = [k.tail];
};

// nested tail segments extending along +Z. segs: [{L, r0, r1, c, bend:[rx,ry,rz], extra(B)}]
function chainTail(k, segs, o = {}) {
  let parent = k.tail; k.tailSegs = [];
  segs.forEach((sg, i) => {
    const g = i === 0 ? k.tail : grp(parent, 0, 0, segs[i - 1].L);
    g.rotation.set(sg.bend[0], sg.bend[1] || 0, sg.bend[2] || 0);
    k.tailSegs.push(g);
    put(g, k.key('tail' + i) + (o.tag || ''), (B) => {
      B.taper(sg.c, [0, 0, 0], [0, 0, sg.L], sg.r0, sg.r1, { ao: 0.12, hi: 0.05, ...(sg.o || {}) });
      if (sg.extra) sg.extra(B);
    });
    parent = g;
  });
}
const mouthDark = (k) => (lum(k.skin.fur) < 0.25 ? 0x0e0a10 : 0x3b1f2a);

BUILD.fox = (k) => {
  const { fur, belly, accent } = k.skin, H = k.H;
  const dark = accent, nose = lum(accent) < 0.35 ? accent : 0x2a1a1a;
  bodyStd(k, {
    fur, belly, foot: dark, shin: dark, hand: dark, forearm: dark, pad: adj(dark, 0.1), footS: [0.14, 0.075, 0.25], legR: 0.14, armR: 0.095,
  });
  put(k.head, k.key('head'), (B) => {
    B.sph(fur, [0, H.cy, 0], [H.rx, H.ry, H.rz], { ao: 0.2, hi: 0.05 });
    for (const sx of [-1, 1]) {
      // fluffy cheek tufts sweeping back
      B.conE(belly, [sx * 0.43, H.cy - 0.14, -0.1], [0.17, 0.3, 0.1], { r: [0, -sx * 0.6, -sx * (Math.PI / 2 + 0.3)], ao: 0.1 });
      B.sph(belly, [sx * 0.2, H.cy - 0.03, -0.33], [0.13, 0.08, 0.12], { ao: 0.05, r: [0, 0, sx * 0.4] });
    }
    B.sph(belly, [0, H.cy - 0.115, -0.41], [0.17, 0.11, 0.26], { ao: 0.15 });
    B.sph(fur, [0, H.cy - 0.04, -0.44], [0.14, 0.1, 0.26], { ao: 0.1 });
    B.sph(nose, [0, H.cy - 0.05, -0.675], [0.066, 0.05, 0.05], { lo: true, ao: 0.1, hi: 0.3 });
  }, { cast: true });
  eyesStd(k, { r: 0.12, rh: 1.1, lat: 9, lon: 30, iris: 0xf2a21a, ir: 0.86, pr: 0.5, roll: 12, browLat: 22 });
  mouthStd(k, { base: faceAt(0, H.cy - 0.17, -0.62), w: 0.06, tag: 'f' });
  gogglesStd(k, { lat: 54, lon: 25, r: 0.122 });
  for (const sx of [-1, 1]) {
    const mount = grp(k.head, sx * 0.27, H.cy + 0.28, 0.0);
    mount.rotation.z = -sx * 0.3; mount.rotation.x = 0.0;
    const ear = grp(mount);
    put(ear, k.key('ear' + sx), (B) => {
      B.conE(fur, [0, 0.2, 0], [0.16, 0.42, 0.085], { ao: 0.12, tip: [dark, 0.7] });
      B.conE(belly, [0, 0.16, -0.05], [0.1, 0.3, 0.05], { ao: 0.08 });
      B.conE(0x2a1a1a, [0, 0.14, -0.06], [0.06, 0.2, 0.03], { ao: 0.0, tip: [0x2a1a1a, 2] });
    });
    k.ears.push(ear);
  }
  k.tail.position.set(0, -0.12, 0.42);
  chainTail(k, [
    { L: 0.3, r0: 0.13, r1: 0.22, c: fur, bend: [-0.12, 0, 0] },
    { L: 0.3, r0: 0.22, r1: 0.27, c: fur, bend: [-0.16, 0, 0] },
    { L: 0.28, r0: 0.265, r1: 0.2, c: fur, bend: [-0.2, 0, 0] },
    { L: 0.22, r0: 0.19, r1: 0.06, c: belly, bend: [-0.2, 0, 0] },
  ]);
};

BUILD.bear = (k) => {
  const { fur, belly, accent } = k.skin, H = k.H;
  const noseC = lum(fur) < 0.2 ? 0x07070a : 0x2a1a16;
  // panda: very light fur + very dark accent -> black ears, eye patches and limbs
  const panda = lum(fur) > 0.8 && lum(accent) < 0.2;
  const pc = panda ? accent : fur;
  bodyStd(k, { fur, belly, foot: pc, hand: pc, thigh: pc, shin: pc, sleeve: pc, forearm: pc, pad: adj(accent, 0.02), footS: [0.17, 0.085, 0.25], legR: 0.165, shinR: 0.14, armR: 0.118, handR: 0.15, tag: panda ? 'p' : '' });
  const innerC = lum(accent) < 0.3 ? adj(accent, 0.12) : accent;
  put(k.head, k.key('head'), (B) => {
    B.sph(fur, [0, H.cy, 0], [H.rx, H.ry, H.rz], { ao: 0.2, hi: 0.05 });
    B.sph(belly, [0, H.cy - 0.11, -0.4], [0.22, 0.17, 0.14], { ao: 0.12 });
    B.sph(noseC, [0, H.cy - 0.035, -0.53], [0.085, 0.06, 0.05], { lo: true, ao: 0.1, hi: 0.35 });
    B.cap(noseC, [0, H.cy - 0.08, -0.52], [0, H.cy - 0.14, -0.51], 0.009, { ao: 0 });
    for (const sx of [-1, 1]) B.sph(mixc(fur, 0xff8aa0, 0.35), [sx * 0.34, H.cy - 0.1, -0.31], [0.07, 0.045, 0.03], { ao: 0, lo: true, r: [0.1, -0.7 * sx, 0] });
    if (panda) for (const sx of [-1, 1]) B.sph(accent, [0, 0, 0], [0.145, 0.185, 0.07], { base: frame(H, 6, sx * 30, -0.035, -sx * 18), ao: 0.05 });
  }, { cast: true });
  eyesStd(k, { r: 0.1, rh: 1.1, lat: 7, lon: 29, iris: 0x2a1a12, ir: 0.9, pr: 0.55, browLat: 20, tag: panda ? 'p' : '', browColor: panda ? 0x555560 : undefined });
  mouthStd(k, { base: faceAt(0, H.cy - 0.17, -0.53), w: 0.075, tag: 'b' });
  gogglesStd(k, { lat: 56, lon: 22, r: 0.118 });
  for (const sx of [-1, 1]) {
    const mount = grp(k.head);
    frame(H, 40, sx * 62, -0.02, 0).decompose(mount.position, mount.quaternion, mount.scale);
    mount.rotateX(-0.2);
    const ear = grp(mount);
    put(ear, k.key('ear' + sx), (B) => {
      B.sph(pc, [0, 0, 0.03], [0.185, 0.185, 0.12], { ao: 0.15 });
      B.sph(panda ? adj(accent, 0.08) : innerC, [0, 0, 0.1], [0.11, 0.11, 0.05], { ao: 0.2 });
    });
    k.ears.push(ear);
  }
  k.tail.position.set(0, -0.1, 0.46);
  put(k.tail, k.key('tail'), (B) => { B.sph(fur, [0, 0, 0.06], 0.15, { ao: 0.2 }); });
  k.tailSegs = [k.tail];
};

BUILD.cat = (k) => {
  const { fur, belly, accent } = k.skin, H = k.H;
  const stripe = adj(fur, lum(fur) > 0.4 ? -0.28 : 0.1);
  const pinkNose = lum(fur) < 0.2 ? 0xff7aa0 : 0xff8ca6;
  bodyStd(k, {
    fur, belly, foot: fur, hand: fur, pad: accent, footS: [0.135, 0.075, 0.22], legR: 0.13, shinR: 0.11, armR: 0.09, handR: 0.115,
    torsoExtra: (B) => { },
  });
  put(k.head, k.key('head'), (B) => {
    B.sph(fur, [0, H.cy, 0], [H.rx, H.ry, H.rz], { ao: 0.2, hi: 0.05 });
    for (const sx of [-1, 1]) {
      // cheek fluff
      B.conE(fur, [sx * 0.46, H.cy - 0.12, -0.06], [0.11, 0.2, 0.09], { r: [0, -sx * 0.5, -sx * (Math.PI / 2 + 0.3)], ao: 0.1 });
      B.conE(fur, [sx * 0.44, H.cy - 0.2, -0.02], [0.09, 0.17, 0.08], { r: [0, -sx * 0.7, -sx * (Math.PI / 2 + 0.8)], ao: 0.1 });
      // whiskers
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.22;
        B.cyl(0xf6f6ff, [sx * (0.3 + 0.17), H.cy - 0.1 - a * 0.25, -0.34 + 0.0], 0.007, 0.36, { r: [0, sx * (0.1 - a * 0.9), -sx * (Math.PI / 2 - a * 0.7)], ao: 0, seg: 5 });
      }
    }
    B.sph(belly, [0, H.cy - 0.11, -0.39], [0.17, 0.12, 0.11], { ao: 0.12 });
    B.sph(pinkNose, [0, H.cy - 0.06, -0.495], [0.05, 0.036, 0.03], { lo: true, ao: 0.1, hi: 0.3 });
    // tabby stripes on forehead
    for (const [x, len] of [[0, 0.16], [-0.1, 0.12], [0.1, 0.12]]) {
      const f = frame(H, 52, x * 120, 0.003);
      B.cap(stripe, [0, -len * 0.5, 0], [0, len * 0.5, 0], 0.014, { base: f, ao: 0, flat: 0.5 });
    }
  }, { cast: true });
  eyesStd(k, { r: 0.125, rh: 1.12, lat: 6, lon: 29, iris: 0x7be05a, ir: 0.9, pr: 0.5, slit: true, roll: 10, browLat: 22 });
  mouthStd(k, { base: faceAt(0, H.cy - 0.155, -0.495), w: 0.06, tag: 'c' });
  gogglesStd(k, { lat: 54, lon: 25, r: 0.12 });
  for (const sx of [-1, 1]) {
    const mount = grp(k.head, sx * 0.3, H.cy + 0.28, -0.04);
    mount.rotation.z = -sx * 0.4; mount.rotation.x = -0.1;
    const ear = grp(mount);
    put(ear, k.key('ear' + sx), (B) => {
      B.conE(fur, [0, 0.19, 0], [0.17, 0.42, 0.085], { ao: 0.12 });
      B.conE(accent, [0, 0.15, -0.045], [0.1, 0.3, 0.05], { ao: 0.06 });
    });
    k.ears.push(ear);
  }
  k.tail.position.set(0, -0.12, 0.45);
  chainTail(k, [
    { L: 0.26, r0: 0.085, r1: 0.082, c: fur, bend: [-0.85, 0, 0] },
    { L: 0.26, r0: 0.082, r1: 0.08, c: fur, bend: [0.05, 0, 0] },
    { L: 0.26, r0: 0.08, r1: 0.078, c: fur, bend: [0.28, 0, 0] },
    { L: 0.24, r0: 0.078, r1: 0.07, c: fur, bend: [0.45, 0, 0] },
    { L: 0.2, r0: 0.07, r1: 0.055, c: lum(fur) > 0.5 ? adj(fur, -0.25) : belly, bend: [0.4, 0, 0] },
  ]);
};

BUILD.frog = (k) => {
  const { fur, belly, accent } = k.skin, H = k.H;
  const spot = accent;
  const webC = adj(fur, 0.04);
  bodyStd(k, {
    fur, belly, foot: fur, hand: fur, pad: undefined, footS: [0.17, 0.05, 0.22], legR: 0.17, shinR: 0.125, armR: 0.085, handR: 0.1, cuff: true,
    torsoExtra: (B) => {
      for (const [x, y, z, r] of [[-0.18, 0.4, 0.23, 0.06], [0.14, 0.32, 0.27, 0.05], [0.02, 0.45, 0.2, 0.045], [-0.08, 0.12, 0.32, 0.05]]) B.sph(spot, [x, y, z], [r, r, r * 0.5], { ao: 0, lo: true });
    },
    footExtra: (B, sx, fs, fz) => {
      // webbed toes: three round-tipped toes fanning forward
      for (const t of [-1, 0, 1]) {
        const x = t * 0.1, z = fz - fs[2] * 0.95 - Math.abs(t) * -0.01;
        B.cap(fur, [x * 0.5, -0.33, fz - 0.1], [x * 1.15, -0.335, z], 0.036, { ao: 0.05 });
        B.sph(belly, [x * 1.15, -0.335, z - 0.005], [0.058, 0.035, 0.058], { ao: 0.05, lo: true });
      }
    },
    handExtra: (B, sx, r) => { for (const t of [-1, 0, 1]) B.sph(belly, [t * 0.07, -0.265, -0.1], [0.035, 0.028, 0.035], { lo: true, ao: 0 }); },
  });
  const ex = 0.3, ey = H.cy + 0.27, ez = -0.2, er = 0.2;
  const eyeF = [-1, 1].map((sx) => faceAt(sx * ex, ey + 0.045, ez - er * 0.92, 0.28));
  put(k.head, k.key('head'), (B) => {
    B.sph(fur, [0, H.cy, 0], [H.rx, H.ry, H.rz], { ao: 0.2, hi: 0.05 });
    B.sph(belly, [0, H.cy - 0.1, -0.2], [0.44, 0.22, 0.34], { ao: 0.1 });
    for (const sx of [-1, 1]) {
      B.sph(fur, [sx * ex, ey, ez], er, { ao: 0.15, hi: 0.06 });                      // eye bulge
      B.sph(mixc(fur, 0xff7a8c, 0.4), [sx * 0.43, H.cy - 0.06, -0.3], [0.08, 0.05, 0.03], { ao: 0, lo: true, r: [0.1, -0.9 * sx, 0] });
      B.sph(0x14301a, [sx * 0.05, H.cy + 0.02, -0.49], [0.016, 0.013, 0.012], { lo: true, ao: 0 });   // nostrils
    }
    for (const [x, z, r] of [[-0.2, 0.15, 0.06], [0.12, 0.2, 0.05], [0.0, 0.05, 0.045], [-0.05, 0.3, 0.04]]) B.sph(spot, [x, H.cy + H.ry * 0.9, z], [r, r * 0.4, r], { ao: 0, lo: true });
  }, { cast: true });
  eyesStd(k, { r: 0.125, rh: 1.0, iris: 0xffd23f, ir: 0.9, pr: 0.5, frames: eyeF, browFrames: eyeF.map((m) => m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.15, -0.02))), tag: 'fr', brow: false, lat: 0, lon: 0 });
  const dk = mouthDark(k);
  mouthStd(k, {
    base: faceAt(0, H.cy - 0.1, -0.54, 0), w: 0.06, tag: 'fr', dark: dk,
    shutExtra: (B) => { B.tor(dk, [0, 0.2, 0], 1, 0.015, { r: [0, 0, -2.57], arc: 2.0, s: [0.34, 0.22, 0.34], tseg: 5, rseg: 24, ao: 0 }); },
    openExtra: (B) => { B.sph(0x4a1020, [0, -0.03, -0.012], [0.22, 0.095, 0.04], { ao: 0 }); B.sph(0xff7a8c, [0, -0.085, 0.0], [0.11, 0.04, 0.03], { ao: 0.1 }); },
  });
  // goggles worn over the eye bulges
  gogglesStd(k, { strapLat: 20, over: eyeF.map((m) => ({ m: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.03)), r: 0.18 })) });
  k.tail.position.set(0, -0.1, 0.4);
  k.tailSegs = [k.tail];
};

BUILD.owl = (k) => {
  const { fur, belly, accent } = k.skin, H = k.H;
  const beak = 0xffa31a, legC = 0xffb02e;
  const wingC = lum(accent) < 0.12 ? adj(accent, 0.12) : accent;
  const [tx, ty, tz] = k.S.torso;
  bodyStd(k, {
    fur, belly, foot: legC, shin: legC, hand: wingC, thigh: fur, pad: undefined, footS: [0.1, 0.05, 0.19], legR: 0.1, shinR: 0.055, armR: 0.08, handR: 0.0, cuff: false, sleeve: wingC, forearm: wingC,
    torsoExtra: (B) => {
      // scalloped feather rows on the belly
      const sc = adj(belly, lum(belly) > 0.6 ? -0.13 : 0.12);
      const rows = [[0.31, 3], [0.2, 4], [0.09, 3], [-0.02, 4]];
      rows.forEach(([y, n], ri) => {
        for (let i = 0; i < n; i++) {
          const x = (i - (n - 1) / 2) * 0.15 * (ri % 2 ? 1 : 1.0);
          const q = 1 - (x / (tx * 0.76)) ** 2 - ((y - 0.14) / (ty * 0.8)) ** 2;
          const z = -tz * 0.5 - tz * 0.62 * Math.sqrt(Math.max(0.05, q));
          B.tor(sc, [x, y, z - 0.004], 0.055, 0.012, { arc: Math.PI, r: [0, 0, Math.PI], ao: 0, tseg: 5, rseg: 12 });
        }
      });
    },
    footExtra: (B, sx, fs, fz) => {
      for (const t of [-1, 0, 1]) {
        B.cap(legC, [t * 0.03, -0.34, fz + 0.02], [t * 0.085, -0.345, fz - 0.17], 0.032, { ao: 0.05 });
        B.con(0x4a3a2a, [t * 0.09, -0.345, fz - 0.215], 0.024, 0.06, { r: [-Math.PI / 2, 0, 0], ao: 0, seg: 6 });
      }
    },
  });
  // wings replace the hands: feather fans at the wrist
  for (const A of k.arms) {
    put(A.fore, k.key('wing' + A.sx), (B) => {
      B.sph(wingC, [0, -0.17, 0], [0.095, 0.26, 0.05], { ao: 0.12 });
      for (const [dx, a] of [[-0.05, 0.12], [0, 0], [0.05, -0.12]]) B.sph(adj(wingC, -0.08), [dx * A.sx, -0.37, 0], [0.04, 0.15, 0.03], { ao: 0.08, r: [0, 0, a] });
      B.sph(belly, [0, -0.14, -0.025], [0.06, 0.15, 0.03], { ao: 0.05 });
    });
  }
  const discR = 0.27;
  const eyeFr = [-1, 1].map((sx) => frame(H, 3, sx * 27, 0.02));
  put(k.head, k.key('head'), (B) => {
    B.sph(fur, [0, H.cy, 0], [H.rx, H.ry, H.rz], { ao: 0.2, hi: 0.05 });
    // facial discs
    for (const sx of [-1, 1]) {
      B.sph(belly, [sx * 0.23, H.cy + 0.02, -0.36], [discR, discR * 1.02, 0.17], { ao: 0.05, hi: 0.06 });
      B.tor(adj(fur, -0.12), [sx * 0.23, H.cy + 0.02, -0.5], discR * 0.99, 0.014, { s: [discR, discR * 1.02, discR], ao: 0, tseg: 5, rseg: 36 });
    }
    // beak
    B.con(beak, [0, H.cy - 0.1, -0.545], 0.06, 0.16, { r: [-Math.PI / 2 - 0.35, 0, 0], ao: 0.1, seg: 14 });
    B.con(adj(beak, -0.12), [0, H.cy - 0.135, -0.52], 0.05, 0.1, { r: [-Math.PI / 2 + 0.25, 0, 0], ao: 0, seg: 12 });
  }, { cast: true });
  eyesStd(k, { r: 0.17, rh: 1.0, lat: 3, lon: 27, push: 0.04, iris: 0xffb41a, ir: 0.82, pr: 0.48, brow: false, tag: 'ow' });
  mouthStd(k, { base: faceAt(0, H.cy - 0.2, -0.5, 0), w: 0.03, tag: 'ow', t: 0.012 });
  k.noMouth = true;
  gogglesStd(k, { strapLat: 6, over: [-1, 1].map((sx) => ({ m: frame(H, 3, sx * 27, 0.12), r: 0.205 })) });
  // ear tufts
  for (const sx of [-1, 1]) {
    const mount = grp(k.head, sx * 0.3, H.cy + 0.4, -0.03);
    mount.rotation.z = -sx * 0.5; mount.rotation.x = -0.1;
    const ear = grp(mount);
    put(ear, k.key('ear' + sx), (B) => {
      B.conE(fur, [0, 0.12, 0], [0.12, 0.3, 0.1], { ao: 0.12, tip: [wingC, 0.7] });
    });
    k.ears.push(ear);
  }
  // tail feathers
  k.tail.position.set(0, -0.13, 0.46);
  put(k.tail, k.key('tail'), (B) => {
    for (const a of [-0.42, 0, 0.42]) B.sph(wingC, [Math.sin(a) * 0.15, -0.0, 0.2], [0.07, 0.03, 0.22], { ao: 0.1, r: [0.3, a, 0] });
  });
  k.tailSegs = [k.tail];
};

BUILD.dino = (k) => {
  const { fur, belly, accent } = k.skin, H = k.H;
  const claw = 0xfff4dc;
  const [tx, ty, tz] = k.S.torso;
  bodyStd(k, {
    fur, belly, foot: fur, hand: fur, pad: undefined, footS: [0.15, 0.08, 0.24], legR: 0.16, shinR: 0.13, armR: 0.09, handR: 0.11,
    torsoExtra: (B) => {
      for (const y of [0.32, 0.22, 0.12, 0.02]) {
        const q = Math.sqrt(Math.max(0.02, 1 - ((y - 0.2) / ty) ** 2));
        B.tor(adj(belly, -0.1), [0, y, 0], 1, 0.016, { r: [Math.PI / 2, 0, 0], s: [tx * q * 0.99, tz * q * 0.99, 1], tseg: 5, rseg: 32, ao: 0, arc: TAU });
      }
    },
    footExtra: (B, sx, fs, fz) => {
      for (const t of [-1, 0, 1]) {
        B.sph(fur, [t * 0.075, -0.33, fz - 0.2], [0.055, 0.05, 0.07], { ao: 0.1, lo: true });
        B.con(claw, [t * 0.08, -0.335, fz - 0.285], 0.03, 0.075, { r: [-Math.PI / 2, 0, 0], ao: 0, seg: 8 });
      }
    },
    handExtra: (B, sx, r) => { for (const t of [-1, 1]) B.con(claw, [t * 0.045, -0.31, -0.1], 0.022, 0.07, { r: [-Math.PI / 2 - 0.4, 0, 0], ao: 0, seg: 8 }); },
  });
  put(k.head, k.key('head'), (B) => {
    B.sph(fur, [0, H.cy, 0], [H.rx, H.ry, H.rz], { ao: 0.2, hi: 0.05 });
    // snout
    B.sph(fur, [0, H.cy - 0.1, -0.45], [0.27, 0.19, 0.25], { ao: 0.15, hi: 0.05 });
    B.sph(belly, [0, H.cy - 0.19, -0.44], [0.24, 0.1, 0.24], { ao: 0.1 });
    for (const sx of [-1, 1]) {
      B.sph(adj(fur, -0.3), [sx * 0.09, H.cy - 0.06, -0.675], [0.025, 0.02, 0.02], { lo: true, ao: 0 });   // nostrils
      B.sph(adj(fur, -0.07), [sx * 0.2, H.cy + 0.16, -0.3], [0.13, 0.06, 0.15], { ao: 0.1, lo: true, r: [0.2, 0, sx * 0.35] });   // brow ridge
      // cheek blush
      B.sph(mixc(fur, accent, 0.5), [sx * 0.29, H.cy - 0.12, -0.38], [0.065, 0.04, 0.03], { ao: 0, lo: true, r: [0.1, -0.7 * sx, 0] });
    }
    // little teeth along the upper lip
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
      const x = sx * (0.045 + i * 0.05), z = -0.62 + i * 0.085;
      B.con(claw, [x, H.cy - 0.215 + 0.015 * i, z], 0.016, 0.045, { r: [Math.PI, 0, 0], ao: 0, seg: 6 });
    }
    // crest plates over the head
    [[62, 0.17], [80, 0.2], [100, 0.18]].forEach(([lat, h]) => {
      const m = frame(H, lat - 0, 0, -0.02);
      const f = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      // plate: thin in X, rising along the head normal
      B.conE(accent, [0, h * 0.4, 0], [0.028, h, 0.1], { base: m.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), ao: 0.15, hseg: 3, seg: 4 });
    });
  }, { cast: true });
  eyesStd(k, { r: 0.115, rh: 1.1, lat: 12, lon: 34, iris: 0xffd23f, ir: 0.85, pr: 0.5, browLat: 18, browLon: 36 });
  mouthStd(k, { base: faceAt(0, H.cy - 0.205, -0.68, 0), w: 0.08, tag: 'd', t: 0.014 });
  gogglesStd(k, { lat: 55, lon: 28, r: 0.12 });
  // small horns
  for (const sx of [-1, 1]) {
    const mount = grp(k.head, sx * 0.3, H.cy + 0.35, -0.12);
    mount.rotation.z = -sx * 0.35; mount.rotation.x = -0.35;
    const ear = grp(mount);
    put(ear, k.key('ear' + sx), (B) => { B.con(accent, [0, 0.08, 0], 0.055, 0.18, { ao: 0.12, seg: 10 }); });
    k.ears.push(ear);
  }
  k.tail.position.set(0, -0.1, 0.38);
  const plates = (n, r, L) => (B) => {
    for (let i = 0; i < n; i++) B.conE(accent, [0, r + 0.0, L * (0.25 + i / n * 0.6)], [0.03, 0.12, 0.09], { ao: 0.12, hseg: 3, seg: 4 });
  };
  chainTail(k, [
    { L: 0.3, r0: 0.2, r1: 0.18, c: fur, bend: [-0.08, 0, 0], extra: plates(2, 0.19, 0.3) },
    { L: 0.3, r0: 0.18, r1: 0.14, c: fur, bend: [-0.1, 0, 0], extra: plates(2, 0.15, 0.3) },
    { L: 0.28, r0: 0.14, r1: 0.1, c: fur, bend: [-0.1, 0, 0], extra: plates(2, 0.11, 0.28) },
    { L: 0.26, r0: 0.1, r1: 0.04, c: fur, bend: [-0.1, 0, 0] },
  ]);
};

// ------------------------------------------------------------------------------------------------
// assemble
// ------------------------------------------------------------------------------------------------
export function makeCritter(species, skin, opts = {}) {
  if (!BUILD[species]) species = 'rabbit';
  skin = { fur: 0xf6f8ff, belly: 0xffffff, accent: 0xffb3c7, scarf: 0xff5a5f, lens: 0x4dd8ff, ...(skin || {}) };
  const k = createKit(species, skin, opts);
  BUILD[species](k);
  outfitStd(k);
  jetStd(k);
  scarfRibbon(k);
  const root = k.root;
  const u = {
    species, rig: k.rig, torso: k.torso, head: k.head,
    legL: k.legs[0].hip, legR: k.legs[1].hip, shinL: k.legs[0].shin, shinR: k.legs[1].shin,
    armL: k.arms[0].sh, armR: k.arms[1].sh, foreL: k.arms[0].fore, foreR: k.arms[1].fore,
    jet: k.jet, shadow: k.shadow, tail: k.tail, tailSegs: k.tailSegs, ears: k.ears, earTips: k.earTips,
    scarfTail: k.scarfTail, eyes: k.eyes, brows: k.brows, mouthShut: k.mouthShut, mouthOpen: k.mouthOpen,
    extras: k.extras || {}, rest: [], noMouth: !!k.noMouth,
  };
  const reg = [u.rig, u.torso, u.head, u.legL, u.legR, u.shinL, u.shinR, u.armL, u.armR, u.foreL, u.foreR, u.tail, ...u.tailSegs, ...u.ears, ...u.earTips, ...u.eyes, ...u.brows];
  for (const g of new Set(reg)) u.rest.push({ g, x: g.position.x, y: g.position.y, z: g.position.z, qx: g.quaternion.x, qy: g.quaternion.y, qz: g.quaternion.z, qw: g.quaternion.w });
  root.userData = u;
  root.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });
  animateCritter(root, 'idle', 0, 0);
  return root;
}

// ------------------------------------------------------------------------------------------------
// ANIMATION
// ------------------------------------------------------------------------------------------------
const PIV_Y = 0.85; // rotation pivot of the rig (body centre)
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

function resetPose(u) {
  for (const r of u.rest) {
    r.g.position.set(r.x, r.y, r.z);
    r.g.quaternion.set(r.qx, r.qy, r.qz, r.qw);
    r.g.scale.set(1, 1, 1);
  }
  u.mouthShut.visible = true; u.mouthOpen.visible = false;
}
// Rotates the rig about its centre and moves the centre by (dx,dy,dz).
function setRig(u, rx, ry, rz, dx = 0, dy = 0, dz = 0) {
  const rig = u.rig;
  rig.rotation.set(rx, ry, rz, 'XYZ');
  _v1.set(0, PIV_Y, 0).applyQuaternion(rig.quaternion);
  rig.position.set(dx, PIV_Y + dy - _v1.y, dz - _v1.z).setX(dx - _v1.x);
}
const rot = (g, x = 0, y = 0, z = 0) => { g.rotation.set(x, y, z); };

export function animateCritter(root, mode, phase = 0, t = 0, extra) {
  const u = root.userData;
  if (!u || !u.rig) return;
  extra = extra || {};
  resetPose(u);
  const wind = clamp(((extra.speed ?? 18) - 8) / 22, 0, 1);
  const POSE = POSES[mode] || POSES.idle;
  const F = { eye: 1, open: false, brow: 0, browY: 0, scarf: null };
  POSE(u, phase, t, extra, wind, F);
  // face
  const blink = (t % 3.7) < 0.12 ? 0.12 : 1;
  const es = F.eye * (F.noBlink ? 1 : blink);
  for (const e of u.eyes) e.scale.y = Math.max(0.06, es);
  for (const b of u.brows) { b.rotation.z = b.userData.sx * F.brow; b.position.y = F.browY; }
  u.mouthShut.visible = !F.open && !u.noMouth; u.mouthOpen.visible = !!F.open && !u.noMouth;
  animateScarf(u, t, wind, F.scarf);
  // jet flames
  if (u.jet.visible) {
    u.jet.userData.flames.forEach((f, i) => {
      const fl = 1 + 0.28 * Math.sin(t * 41 + i * 2) + 0.16 * Math.sin(t * 67 + i);
      f.scale.set(1, fl, 1);
    });
  }
}

function animateScarf(u, t, wind, S) {
  S = S || { dir: [0, 0.1, 1], len: 0.8 + 0.5 * wind, amp: 0.05 + 0.13 * wind, droop: 0.5 * (1 - wind), sp: 9 + 10 * wind };
  const g = u.scarfTail, geo = g.userData.geo, rows = g.userData.rows;
  const pos = geo.attributes.position;
  _q1.copy(u.rig.quaternion).multiply(u.torso.quaternion).invert();
  const d = _v1.set(S.dir[0], S.dir[1], S.dir[2]).normalize().applyQuaternion(_q1).clone();
  const gr = _v2.set(0, -1, 0).applyQuaternion(_q1).clone();
  const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(_q1);
  ax.addScaledVector(d, -ax.dot(d));
  if (ax.lengthSq() < 1e-4) ax.set(0, 0, 1).addScaledVector(d, -d.z);
  ax.normalize();
  const up = new THREE.Vector3().crossVectors(d, ax).normalize();
  const P = new THREE.Vector3(), A = new THREE.Vector3();
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const ph = t * S.sp - s * 5.5, s12 = Math.pow(s, 1.2);
    P.copy(d).multiplyScalar(s * S.len);
    P.addScaledVector(up, S.amp * s12 * Math.sin(ph));
    P.addScaledVector(ax, S.amp * 0.55 * s12 * Math.sin(ph * 0.8 + 1.3));
    P.addScaledVector(gr, S.droop * s * s);
    const th = 0.7 * s * Math.sin(ph + 0.7);
    A.copy(ax).multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th));
    const w = (0.1 + 0.05 * s);
    pos.setXYZ(i * 2, P.x - A.x * w, P.y - A.y * w, P.z - A.z * w);
    pos.setXYZ(i * 2 + 1, P.x + A.x * w, P.y + A.y * w, P.z + A.z * w);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// ---- poses -------------------------------------------------------------------------------------
const POSES = {};
const EAR_K = { rabbit: 1, fox: 0.22, bear: 0.06, cat: 0.2, frog: 0, owl: 0.25, dino: 0.08 };
const TAIL_K = { rabbit: 0.7, fox: 0.55, bear: 0.6, cat: 0.6, frog: 0, owl: 0.5, dino: 0.4 };
const LOOK_K = { rabbit: 1, fox: 1, bear: 0.8, cat: 1.1, frog: 1, owl: 2.3, dino: 0.9 };

function limbs(u, o) {
  rot(u.legL, o.lx ?? 0, 0, o.lz ?? 0); rot(u.legR, o.rx ?? 0, 0, -(o.lz ?? 0));
  rot(u.shinL, o.lsx ?? 0); rot(u.shinR, o.rsx ?? 0);
}
function arms(u, o) {
  rot(u.armL, o.lx ?? 0, 0, o.lz ?? 0); rot(u.armR, o.rx ?? 0, 0, o.rz ?? -(o.lz ?? 0));
  rot(u.foreL, o.lfx ?? 0, 0, o.lfz ?? 0); rot(u.foreR, o.rfx ?? 0, 0, o.rfz ?? 0);
}
// ears: drag = rotation towards the back, fl = flutter amplitude, ph = flutter phase
function ears(u, drag, fl, ph, spread = 0) {
  const kE = EAR_K[u.species] || 0;
  if (!kE) return;
  for (let i = 0; i < u.ears.length; i++) {
    const sg = i === 0 ? -1 : 1;
    u.ears[i].rotation.x = kE * (drag + fl * Math.sin(ph - 0.6 + i * 0.5));
    u.ears[i].rotation.z = sg * kE * spread;
    if (u.earTips[i]) u.earTips[i].rotation.x = kE * (drag * 0.8 + fl * 1.3 * Math.sin(ph - 1.5 + i * 0.5));
  }
}
// tail chain: wag = sideways swing amplitude, lift = extra upward curl (rad total), ph = phase
function tail(u, wag, lift, ph) {
  const kT = TAIL_K[u.species] || 0, n = u.tailSegs.length;
  if (!kT) return;
  u.tailSegs.forEach((g, i) => {
    g.rotateY(wag * kT * Math.sin(ph - i * 0.85) * (0.45 + 0.18 * i));
    g.rotateX(-lift / n + 0.12 * kT * Math.sin(ph * 0.7 - i * 1.1));
  });
}
const look = (u) => LOOK_K[u.species] || 1;

POSES.idle = (u, p, t, e, w, F) => {
  const br = Math.sin(t * 2.2);
  setRig(u, 0, 0, Math.sin(t * 0.8) * 0.02, 0, br * 0.012, 0);
  u.torso.scale.set(1 + br * 0.012, 1 + br * 0.018, 1 + br * 0.012);
  const lk = look(u);
  rot(u.head, Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.9) * 0.3 * lk, Math.sin(t * 1.3) * 0.05);
  limbs(u, {});
  arms(u, { lx: Math.sin(t * 2) * 0.06, rx: -Math.sin(t * 2) * 0.06, lz: -0.14, lfx: 0.12, rfx: 0.12 });
  F.scarf = { dir: [0.3, -0.5, 1], len: 0.7, amp: 0.05, droop: 0.5, sp: 3.4 };
  ears(u, 0.03, 0.06, t * 2);
  if (u.species === 'rabbit' && (t % 5.3) < 0.35) u.ears[1].rotation.z = Math.sin((t % 5.3) / 0.35 * Math.PI * 4) * 0.2;
  tail(u, 0.9, 0, t * 2.2);
};
POSES.wave = (u, p, t, e, w, F) => {
  setRig(u, 0, 0, 0, 0, Math.abs(Math.sin(t * 4)) * 0.05, 0);
  rot(u.head, 0.05, Math.sin(t * 1.6) * 0.18, Math.sin(t * 2) * 0.1);
  arms(u, { lx: 0.05, lz: -0.14, rx: 0.1, rz: 2.55 + Math.sin(t * 9) * 0.12, rfz: Math.sin(t * 9 + 0.5) * 0.55 });
  limbs(u, {});
  F.open = true; F.eye = 0.92; F.brow = -0.1; F.browY = 0.012;
  F.scarf = { dir: [0.3, -0.45, 1], len: 0.85, amp: 0.06, droop: 0.5, sp: 4.5 };
  ears(u, 0.0, 0.18, t * 7);
  tail(u, 1.4, 0, t * 6);
};
POSES.run = (u, p, t, e, w, F) => {
  const s = Math.sin(p), c = Math.cos(p);
  setRig(u, -0.17 - 0.05 * w, 0, 0, 0, 0.05 + 0.05 * Math.cos(2 * p), 0);
  limbs(u, { lx: s * 0.95, rx: -s * 0.95, lsx: -(0.2 + 1.0 * Math.max(0, c)), rsx: -(0.2 + 1.0 * Math.max(0, -c)) });
  arms(u, { lx: -s * 0.95, rx: s * 0.95, lz: -0.2, lfx: 1.05 + 0.4 * s, rfx: 1.05 - 0.4 * s });
  rot(u.torso, -0.03, s * 0.14, c * 0.03);
  rot(u.head, 0.15, -s * 0.07, s * 0.04);
  F.open = true; F.brow = 0.22;
  F.scarf = { dir: [0.85, 0.5, 1], len: 1.05 + 0.5 * w, amp: 0.07 + 0.13 * w, droop: 0.2 * (1 - w), sp: 9 + 10 * w };
  ears(u, 0.15 + 0.3 * w, 0.28, 2 * p);
  tail(u, Math.sin(p) * 0.9 + 0.0, 0.1, p * 2 - 0.4);
};
POSES.jump = (u, p, t, e, w, F) => {
  const up = clamp((e.vy ?? 4) / 12, -1, 1), r = 0.5 + 0.5 * up;            // r: 1 rising ... 0 falling
  const fl = clamp(e.flip ?? 0, 0, 1), tk = fl > 0 && fl < 1 ? Math.sin(Math.PI * fl) ** 0.6 : 0;
  setRig(u, -0.12 - TAU * ease(fl), 0, 0, 0, 0.02, 0);
  limbs(u, {
    lx: lerp(lerp(0.55, 1.0, r), 1.55, tk), rx: lerp(lerp(0.3, -0.4, r), 1.55, tk),
    lsx: lerp(lerp(-0.3, -1.3, r), -1.9, tk), rsx: lerp(lerp(-0.2, -0.9, r), -1.9, tk), lz: lerp(0.0, 0.0, tk),
  });
  arms(u, {
    lx: lerp(lerp(0.15, 2.7, r), 1.35, tk), rx: lerp(lerp(0.15, 2.7, r), 1.35, tk),
    lz: lerp(lerp(-1.15, -0.25, r), -0.2, tk), rz: lerp(lerp(1.15, 0.25, r), 0.2, tk),
    lfx: lerp(0.3, 1.7, tk), rfx: lerp(0.3, 1.7, tk),
  });
  rot(u.torso, -0.5 * tk, 0, 0);
  rot(u.head, 0.1 - 0.45 * tk, 0, 0);
  F.open = true; F.brow = -0.12; F.browY = 0.01;
  F.scarf = { dir: [0.35, lerp(0.9, -0.6, r), 1], len: 1.1, amp: 0.1, droop: 0.0, sp: 16 };
  ears(u, lerp(-0.15, 0.95, r), 0.2, t * 11);
  tail(u, 0.5, lerp(-0.2, 0.3, r), t * 9);
};
POSES.slide = (u, p, t, e, w, F) => {
  setRig(u, 1.2, 0, 0, 0, -0.43, 0.2);
  limbs(u, { lx: -0.15, rx: 0.4, lsx: -0.1, rsx: -1.2 });
  arms(u, { lx: 1.7, lz: -0.35, lfx: 0.4, rx: -1.35, rz: 0.3, rfx: 0.1 });
  rot(u.torso, -0.1, 0, 0);
  rot(u.head, -1.0, Math.sin(t * 5) * 0.05, 0);
  F.open = true; F.brow = 0.3; F.eye = 0.85;
  F.scarf = { dir: [0.4, 0.55, 1], len: 1.1, amp: 0.09, droop: 0, sp: 14 };
  ears(u, 0.8, 0.15, t * 10);
  tail(u, 0.4, 1.0, t * 8);
};
POSES.fly = (u, p, t, e, w, F) => {
  const bob = Math.sin(t * 3.2) * 0.06;
  setRig(u, -1.2, -(e.bank ?? 0) * 0.9, 0, 0, bob, 0);
  limbs(u, { lx: -0.22 + Math.sin(t * 9) * 0.1, rx: -0.12 - Math.sin(t * 9) * 0.1, lsx: -0.25, rsx: -0.3 });
  arms(u, { lx: 2.95, rx: 2.95, lz: 0.12, rz: -0.12, lfx: 0.1, rfx: 0.1 });
  rot(u.torso, 0.2, 0, 0);
  rot(u.head, 0.9, 0, 0);
  F.open = true; F.brow = 0.25; F.eye = 0.9;
  F.scarf = { dir: [0.4, 0.3, 1], len: 1.4, amp: 0.2, droop: 0, sp: 22 };
  ears(u, 1.15, 0.25, t * 15);
  tail(u, 0.5, -1.15, t * 10);
};
POSES.fall = (u, p, t, e, w, F) => {
  const fl = clamp(e.flip ?? 0, 0, 1);
  setRig(u, 1.0 + 0.2 * Math.sin(t * 5) - TAU * ease(fl), 0, Math.sin(t * 4) * 0.35, 0, -0.15, 0.1);
  limbs(u, { lx: 0.9 + Math.sin(t * 11) * 0.5, rx: 0.5 + Math.sin(t * 11 + 2) * 0.5, lsx: -0.6, rsx: -0.9, lz: 0.2 });
  arms(u, { lx: 2.2 + Math.sin(t * 13) * 0.8, rx: 2.0 + Math.sin(t * 13 + 1.5) * 0.8, lz: -1.3, rz: 1.3, lfx: 0.5, rfx: 0.6 });
  rot(u.head, -0.3 + Math.sin(t * 9) * 0.25, Math.sin(t * 7) * 0.3, 0);
  F.open = true; F.eye = 0.55; F.noBlink = true; F.brow = -0.35; F.browY = 0.02;
  F.scarf = { dir: [0.3, 1, 0.6], len: 1.1, amp: 0.15, droop: 0, sp: 18 };
  ears(u, 0.2, 0.7, t * 12);
  tail(u, 1.2, 0, t * 12);
};
POSES.swim = (u, p, t, e, w, F) => {
  const s = Math.sin(p), s2 = Math.sin(2 * p);
  setRig(u, -1.3, -s * 0.32 - (e.bank ?? 0) * 0.3, 0, 0, -0.9 + s2 * 0.025, 0);
  limbs(u, { lx: s2 * 0.38, rx: -s2 * 0.38, lsx: -(0.25 + 0.2 * Math.sin(2 * p + 1)), rsx: -(0.25 - 0.2 * Math.sin(2 * p + 1)) });
  arms(u, { lx: -p, rx: -(p + Math.PI), lz: -0.1, rz: 0.1, lfx: 0.35 + 0.35 * Math.sin(p), rfx: 0.35 - 0.35 * Math.sin(p) });
  rot(u.torso, 0, s * 0.18, 0);
  rot(u.head, 1.2 + 0.08 * s2, s * 0.14, 0);
  F.open = (p % TAU) > 4.2 && (p % TAU) < 5.4; F.brow = 0.12; F.eye = 0.95;
  F.scarf = { dir: [0.35, 0.18, 1], len: 1.0 + 0.2 * w, amp: 0.1, droop: 0, sp: 12 };
  ears(u, 0.55, 0.2, t * 9);
  tail(u, 0.8, -1.2, t * 9);
};
POSES.dive = (u, p, t, e, w, F) => {
  setRig(u, -1.72, -(e.bank ?? 0) * 0.8, 0, 0, -0.55 + Math.sin(t * 2.5) * 0.02, 0);
  limbs(u, { lx: -0.1 + Math.sin(t * 6) * 0.16, rx: -0.1 - Math.sin(t * 6) * 0.16, lsx: -0.2, rsx: -0.25 });
  arms(u, { lx: 3.0, rx: 3.0, lz: 0.12, rz: -0.12, lfx: 0.05, rfx: 0.05 });
  rot(u.torso, 0.1, 0, 0);
  rot(u.head, 0.25, 0, 0);
  F.eye = 0.8; F.brow = 0.2; F.open = false;
  F.scarf = { dir: [0.3, 0.2, 1], len: 1.25, amp: 0.13, droop: 0, sp: 9 };
  ears(u, 1.0, 0.18, t * 8);
  tail(u, 0.7, -1.6, t * 7);
};
POSES.ride = (u, p, t, e, w, F) => {
  setRig(u, -0.05, 0, -(e.bank ?? 0) * 0.15, 0, -0.12 + Math.sin(t * 31) * 0.008, 0);
  limbs(u, { lx: 1.45, rx: 1.45, lsx: -1.45, rsx: -1.45, lz: 0.05 });
  arms(u, { lx: 1.3, rx: 1.3, lz: -0.14, rz: 0.14, lfx: 0.45, rfx: 0.45 });
  rot(u.torso, -0.1, 0, (e.bank ?? 0) * 0.2);
  rot(u.head, 0.1, 0, (e.bank ?? 0) * 0.1);
  F.open = true; F.eye = 0.8; F.brow = 0.2;
  F.scarf = { dir: [0.35, 0.2, 1], len: 1.35, amp: 0.2, droop: 0, sp: 24 };
  ears(u, 1.1, 0.25, t * 16);
  tail(u, 0.8, -0.2, t * 12);
};
POSES.plane = (u, p, t, e, w, F) => {
  const b = e.bank ?? 0;
  setRig(u, -0.08, 0, b * 0.12, 0, -0.12 + Math.sin(t * 27) * 0.008, 0);
  limbs(u, { lx: 1.4, rx: 1.4, lsx: -1.4, rsx: -1.4, lz: 0.05 });
  arms(u, { lx: 1.1 + b * 0.2, rx: 1.0 - b * 0.2, lz: -0.2, rz: 0.2, lfx: 0.5, rfx: 0.5 });
  rot(u.torso, -0.1, 0, b * 0.4);
  rot(u.head, 0.08, b * 0.12, b * 0.3);
  F.open = true; F.eye = 0.85; F.brow = 0.2;
  F.scarf = { dir: [0.4 + b * 0.2, 0.2, 1], len: 1.5, amp: 0.22, droop: 0, sp: 26 };
  ears(u, 1.15, 0.28, t * 17);
  tail(u, 0.8, -0.2, t * 12);
};
POSES.cheer = (u, p, t, e, w, F) => {
  const sn = Math.sin(t * 7);
  setRig(u, 0, 0, sn * 0.05, 0, Math.abs(sn) * 0.3, 0);
  limbs(u, { lx: sn * 0.3 + 0.1, rx: -sn * 0.3 + 0.1, lsx: -0.3 - Math.max(0, sn) * 0.5, rsx: -0.3 - Math.max(0, -sn) * 0.5 });
  arms(u, { lx: 0.3, rx: 0.3, lz: -2.7 + sn * 0.1, rz: 2.7 - sn * 0.1, lfx: 0.3, rfx: 0.3 });
  rot(u.torso, 0, 0, sn * 0.05);
  rot(u.head, -0.1, Math.sin(t * 3.5) * 0.15, -sn * 0.08);
  F.open = true; F.eye = 0.38; F.noBlink = true; F.browY = 0.03;
  F.scarf = { dir: [0.3, 0.8, 0.6], len: 0.95, amp: 0.12, droop: 0, sp: 14 };
  ears(u, 0.05, 0.4, t * 12);
  tail(u, 1.6, 0, t * 14);
};
POSES.hurt = (u, p, t, e, w, F) => {
  const sh = Math.sin(t * 30);
  setRig(u, 0.35, 0, sh * 0.05, sh * 0.02, -0.08, 0.1);
  limbs(u, { lx: 0.3, rx: -0.2, lsx: -0.5, rsx: -0.9 });
  arms(u, { lx: 2.2, rx: 2.0, lz: -0.5, rz: 0.5, lfx: 1.5, rfx: 1.5 });
  rot(u.head, 0.3, Math.sin(t * 25) * 0.15, sh * 0.06);
  F.open = true; F.eye = 0.28; F.noBlink = true; F.brow = -0.4; F.browY = 0.02;
  F.scarf = { dir: [0.3, 0.1, 1], len: 0.9, amp: 0.12, droop: 0.4, sp: 20 };
  ears(u, 0.5, 0.1, t * 20, 0.35);
  tail(u, 0.4, -0.5, t * 8);
};

// ------------------------------------------------------------------------------------------------
// CAPTAIN KRAB - pirate crab villain
// ------------------------------------------------------------------------------------------------
export function makeVillain() {
  const root = new THREE.Group(); root.name = 'captain_krab';
  const rig = grp(root);
  const body = grp(rig, 0, 0.7, 0);
  const RED = 0xe0362b, RED_D = 0xa8241d, RED_L = 0xff6a4d, CREAM = 0xffe3b8, GOLD = 0xf2b51d;
  const u = { rig, body, legs: [], rest: [] };

  // --- shell ---
  put(body, 'krab.shell', (B) => {
    B.sph(RED, [0, 0.04, 0], [0.92, 0.62, 0.72], { ao: 0.28, hi: 0.1 });
    B.sph(RED_D, [0, -0.22, 0], [0.84, 0.24, 0.66], { ao: 0.1 });                         // under-belly
    B.sph(RED_L, [0, 0.4, -0.05], [0.55, 0.2, 0.4], { ao: 0, hi: 0.3 });                // highlight bump
    for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) {
      const a = -0.55 + (i / 8) * 1.1 + Math.PI / 2;
      const cx = Math.cos(a - Math.PI / 2) * 0.99, cz = Math.sin(a - Math.PI / 2) * 0.72;
      if (Math.abs(i - 4) < 0 ) continue;
      B.con(RED_D, [sx * Math.abs(cx) * 0.97, 0.02, cz], 0.07, 0.22, { r: [0, 0, -sx * (Math.PI / 2 - 0.15) + 0], ao: 0.1, seg: 8 });
    }
    // shell spots
    for (const [x, y, z, r] of [[-0.45, 0.42, 0.25, 0.09], [0.5, 0.4, 0.3, 0.11], [-0.7, 0.2, -0.05, 0.08], [0.72, 0.18, -0.1, 0.07], [0.15, 0.5, 0.42, 0.07], [-0.2, 0.47, 0.5, 0.06]])
      B.sph(RED_L, [x, y, z], [r, r * 0.4, r], { ao: 0, lo: true });
  }, { cast: true });
  // --- feet-stompers: legs (3 per side), each thigh -> shin ---
  const legZ = [-0.28, 0.08, 0.42];
  [-1, 1].forEach((sx) => legZ.forEach((z, i) => {
    const up = grp(body, sx * 0.78, -0.02, z);
    const low = grp(up, sx * 0.46, 0.2, 0);
    put(up, 'krab.legup' + sx, (B) => { B.taper(RED_D, [0, 0, 0], [sx * 0.46, 0.2, 0], 0.115, 0.095, { ao: 0.1 }); });
    put(low, 'krab.leglow' + sx, (B) => { B.taper(RED, [0, 0, 0], [sx * 0.1, -0.6, 0], 0.095, 0.05, { ao: 0.05 }); B.sph(0xffd7b0, [sx * 0.1, -0.61, 0], 0.055, { lo: true, ao: 0 }); });
    u.legs.push({ up, low, sx, i });
  }));
  // --- eyes on stalks ---
  u.eyes = [];
  for (const sx of [-1, 1]) {
    const st = grp(body, sx * 0.3, 0.3, -0.5);
    put(st, 'krab.stalk', (B) => { B.taper(RED_D, [0, 0, 0], [0, 0.32, -0.04], 0.07, 0.06, { ao: 0.1 }); });
    const ball = grp(st, 0, 0.42, -0.04);
    put(ball, 'krab.eye' + sx, (B) => {
      B.sph(0xffffff, [0, 0, 0], 0.19, { ao: 0.1 });
      B.sph(0x1a1220, [0, 0.0, -0.13], [0.1, 0.11, 0.07], { ao: 0 });
      B.sph(0xffffff, [-0.035, 0.04, -0.185], [0.035, 0.035, 0.02], { layer: 'glow', ao: 0, lo: true });
      B.sph(RED_D, [0, 0.15, -0.04], [0.17, 0.06, 0.16], { ao: 0, r: [0.1, 0, 0] });      // heavy brow (angry)
    });
    if (sx === -1) {      // eye patch over the left eye with strap
      put(ball, 'krab.patch', (B) => {
        B.sph(0x14101a, [0, 0, -0.12], [0.19, 0.2, 0.09], { ao: 0.1, hi: 0.1 });
        B.tor(0x14101a, [0, 0.01, 0], 1, 0.02, { r: [Math.PI / 2, 0, 0], s: [0.2, 0.2, 0.2], ao: 0, tseg: 5, rseg: 24 });
        B.sph(0x3a3446, [0.03, 0.04, -0.2], [0.04, 0.025, 0.012], { ao: 0, lo: true });
      });
    }
    u.eyes.push(ball); u.rest.push(ball);
  }
  // --- beard & moustache ---
  const beard = grp(body, 0, 0.04, -0.62); beard.scale.setScalar(0.72);
  put(beard, 'krab.beard', (B) => {
    const K = 0x14101a;
    B.sph(K, [0, -0.1, 0], [0.3, 0.2, 0.14], { ao: 0.15, hi: 0.1 });
    B.sph(K, [-0.14, -0.2, 0.02], [0.14, 0.14, 0.1], { ao: 0.1, lo: true });
    B.sph(K, [0.14, -0.2, 0.02], [0.14, 0.14, 0.1], { ao: 0.1, lo: true });
    B.sph(K, [0, -0.3, 0.02], [0.12, 0.14, 0.09], { ao: 0.1, lo: true });
    for (const sx of [-1, 1]) {
      B.tor(K, [sx * 0.22, 0.04, -0.02], 0.13, 0.04, { arc: Math.PI * 1.3, r: [0, 0, sx < 0 ? Math.PI * 0.35 : -Math.PI * 0.95 + Math.PI * 0.35], ao: 0, tseg: 6, rseg: 16 });
    }
    B.sph(0xfff0f0, [0, -0.02, -0.1], [0.09, 0.05, 0.03], { ao: 0, lo: true });      // gold tooth grin
    B.sph(GOLD, [0.05, -0.02, -0.12], [0.03, 0.04, 0.02], { ao: 0, lo: true });
  });
  u.beard = beard;
  // --- claws: left big pincer, right hook ---
  const mkArm = (sx) => {
    const sh = grp(body, sx * 0.85, 0.08, -0.4);
    const el = grp(sh, sx * 0.34, 0.1, -0.32);
    put(sh, 'krab.uarm', (B) => { B.taper(RED, [0, 0, 0], [sx * 0.34, 0.1, -0.32], 0.12, 0.1, { ao: 0.1 }); });
    return { sh, el };
  };
  const L = mkArm(-1), R = mkArm(1);
  // pincer (left)
  const pinch = grp(L.el, -0.12, 0.02, -0.28);
  put(L.el, 'krab.farmL', (B) => { B.taper(RED, [0, 0, 0], [-0.12, 0.02, -0.28], 0.1, 0.12, { ao: 0.1 }); });
  put(pinch, 'krab.palm', (B) => { B.sph(RED, [0, 0, -0.08], [0.3, 0.26, 0.3], { ao: 0.2, hi: 0.1 }); B.sph(RED_L, [0, 0.1, -0.08], [0.14, 0.06, 0.16], { ao: 0, hi: 0.3, lo: true }); });
  const jawU = grp(pinch, 0, 0.07, -0.26), jawL = grp(pinch, 0, -0.08, -0.26);
  put(jawU, 'krab.jawU', (B) => { B.conE(RED, [0, 0.0, -0.2], [0.23, 0.5, 0.16], { r: [-Math.PI / 2, 0, 0], tip: [CREAM, 0.82], ao: 0.1 }); });
  put(jawL, 'krab.jawL', (B) => { B.conE(RED_D, [0, 0.0, -0.18], [0.2, 0.44, 0.13], { r: [-Math.PI / 2, 0, 0], tip: [CREAM, 0.82], ao: 0.1 }); });
  // hook (right)
  const hook = grp(R.el, 0.1, 0.0, -0.3);
  put(R.el, 'krab.farmR', (B) => { B.taper(RED, [0, 0, 0], [0.1, 0.0, -0.3], 0.1, 0.085, { ao: 0.1 }); });
  put(hook, 'krab.hook', (B) => {
    B.cyl(GOLD, [0, 0, -0.03], 0.115, 0.12, { r: [Math.PI / 2, 0, 0], ao: 0.15, layer: 'body' });        // brass cuff
    B.cyl(0x8e97a8, [0, 0, -0.14], 0.06, 0.18, { r: [Math.PI / 2, 0, 0], ao: 0.1 });
    B.tor(0xe2e8f2, [0, 0.14, -0.3], 0.18, 0.05, { arc: Math.PI * 1.45, r: [0, 0, Math.PI * 1.25], ao: 0.1, tseg: 8, rseg: 24, hi: 0.2 });
    B.con(0xe2e8f2, [-0.13, 0.0, -0.3], 0.052, 0.14, { r: [0, 0, Math.PI * 0.65], ao: 0, seg: 8 });
  });
  Object.assign(u, { armL: L.sh, elbowL: L.el, pinch, jawU, jawL, armR: R.sh, elbowR: R.el, hook });
  // --- tricorn hat with skull, plume ---
  const hat = grp(body, 0, 0.58, 0.02); hat.scale.setScalar(1.35); hat.rotation.x = 0;
  put(hat, 'krab.hat', (B) => {
    const BLK = 0x1c1a26, TRIM = GOLD;
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3, sx = Math.sin(a), cz = -Math.cos(a);     // lobe 0 points to -Z
      const base = new THREE.Matrix4().makeRotationY(-a);
      B.sph(TRIM, [0, 0.0, -0.36], [0.27, 0.05, 0.4], { base, ao: 0 });
      B.sph(BLK, [0, 0.05, -0.36], [0.27, 0.06, 0.4], { base, ao: 0.15, hi: 0.15, r: [-0.4, 0, 0] });
    }
    B.sph(BLK, [0, 0.04, 0], [0.34, 0.07, 0.34], { ao: 0.1 });
    B.cyl(BLK, [0, 0.19, 0], 0.27, 0.3, { top: 0.86, ao: 0.2, hi: 0.2 });
    B.sph(BLK, [0, 0.34, 0], [0.23, 0.05, 0.23], { ao: 0, hi: 0.2 });
    B.cyl(TRIM, [0, 0.09, 0], 0.31, 0.06, { top: 0.9, ao: 0.1 });
    // skull emblem on the front lobe
    B.sph(0xfff6e8, [0, 0.24, -0.265], [0.09, 0.085, 0.03], { ao: 0.1 });
    B.sph(0xfff6e8, [0, 0.17, -0.262], [0.06, 0.04, 0.03], { ao: 0.1, lo: true });
    B.sph(0x14101a, [-0.035, 0.25, -0.292], [0.024, 0.028, 0.012], { ao: 0, lo: true });
    B.sph(0x14101a, [0.035, 0.25, -0.292], [0.024, 0.028, 0.012], { ao: 0, lo: true });
    B.cap(0xfff6e8, [-0.12, 0.12, -0.27], [0.12, 0.22, -0.27], 0.018, { ao: 0 });
    B.cap(0xfff6e8, [-0.12, 0.22, -0.27], [0.12, 0.12, -0.27], 0.018, { ao: 0 });
    // plume
    B.tube(0xe8f4ff, [[0.2, 0.3, 0.12], [0.34, 0.5, 0.2], [0.34, 0.66, 0.34], [0.24, 0.62, 0.52]], 0.045, { ao: 0, segs: 14 });
    B.tube(0xff4a5a, [[0.2, 0.3, 0.1], [0.3, 0.46, 0.14], [0.3, 0.58, 0.26], [0.2, 0.56, 0.4]], 0.03, { ao: 0, segs: 12 });
  }, { cast: true });
  u.hat = hat;
  // --- loot sack on his back ---
  const sack = grp(body, 0, 0.06, 0.92); sack.scale.setScalar(0.62);
  put(sack, 'krab.sack', (B) => {
    const TAN = 0xc89a5e, TAN_D = 0x9a6f3e;
    B.sph(TAN, [0, 0, 0], [0.52, 0.5, 0.42], { ao: 0.3, hi: 0.1 });
    B.sph(TAN_D, [0, 0.46, 0], [0.2, 0.18, 0.18], { ao: 0.1 });
    B.tor(0x6a4526, [0, 0.4, 0], 0.17, 0.04, { r: [Math.PI / 2, 0, 0], ao: 0, tseg: 6, rseg: 16 });
    B.con(TAN, [-0.1, 0.62, 0], 0.12, 0.2, { r: [0, 0, 0.35], ao: 0.1, seg: 10 });
    B.con(TAN, [0.1, 0.62, 0], 0.12, 0.2, { r: [0, 0, -0.35], ao: 0.1, seg: 10 });
    // gold patch with star
    B.cyl(GOLD, [0, -0.02, 0.4], 0.17, 0.05, { r: [Math.PI / 2, 0, 0], layer: 'glow', ao: 0.15 });
    B.geo(starGeo(), 0xfff0a8, [0, -0.02, 0.43], [0.1, 0.1, 1], { layer: 'glow', ao: 0 });
    // stitches
    for (let i = 0; i < 6; i++) B.cap(TAN_D, [-0.3 + i * 0.12, 0.2, 0.37], [-0.27 + i * 0.12, 0.28, 0.35], 0.014, { ao: 0 });
    // coins spilling out of the top
    for (const [x, y, z, rz] of [[-0.18, 0.7, 0.04, 0.5], [0.2, 0.72, -0.05, -0.6], [0.02, 0.76, 0.1, 0.2], [0.32, 0.5, 0.3, -1.1], [-0.34, 0.46, 0.28, 1.0]])
      B.cyl(GOLD, [x, y, z], 0.1, 0.03, { r: [Math.PI / 2 - 0.5, 0.3, rz], layer: 'glow', ao: 0.2 });
    B.sph(0x39e6ff, [0.06, 0.74, -0.1], [0.07, 0.09, 0.07], { layer: 'glow', ao: 0.2, lo: true, r: [0.3, 0.4, 0.3] });
    B.sph(0xff4fa3, [-0.22, 0.62, 0.15], [0.06, 0.08, 0.06], { layer: 'glow', ao: 0.2, lo: true, r: [0.3, 0.4, 0.3] });
  }, { cast: true });
  u.sack = sack;
  const shadow = new THREE.Mesh(G('cr_shadowplane2', () => new THREE.PlaneGeometry(2.8, 2.8)), Basic(0xffffff, { map: blobShadowTex(), opacity: 1 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; shadow.renderOrder = 1;
  root.add(shadow);
  u.shadow = shadow;
  // rest transforms
  const reg = [rig, body, ...u.eyes, beard, u.armL, u.elbowL, u.pinch, u.jawU, u.jawL, u.armR, u.elbowR, u.hook, u.hat, u.sack];
  u.legs.forEach((l) => reg.push(l.up, l.low));
  u.restList = reg.map((g) => ({ g, x: g.position.x, y: g.position.y, z: g.position.z, q: g.quaternion.clone() }));
  root.userData = u;
  animateVillain(root, 'idle', 0, 0);
  return root;
}

export function animateVillain(v, mode, phase = 0, t = 0) {
  const u = v.userData;
  if (!u || !u.legs) return;
  for (const r of u.restList) { r.g.position.set(r.x, r.y, r.z); r.g.quaternion.copy(r.q); r.g.scale.set(1, 1, 1); }
  const rg = u.rig, body = u.body;
  const sn = Math.sin, cs = Math.cos;
  rg.position.set(0, 0, 0); rg.rotation.set(0, 0, 0);
  u.jawU.rotation.x = 0; u.jawL.rotation.x = 0;
  const snap = (f) => Math.max(0, sn(t * f)) ** 3;
  const setLegs = (fn) => u.legs.forEach((l, i) => { const side = l.sx, k = i % 3; const r = fn(side, k, i); l.up.rotation.z = side * r[0]; l.low.rotation.z = side * r[1]; l.up.rotation.y = side * (r[2] || 0); });
  const eyeLook = (a, b) => { u.eyes[0].rotation.y = a; u.eyes[1].rotation.y = b; };
  u.hat.rotation.set(0, 0, 0); u.sack.rotation.set(0, 0, 0);
  if (mode === 'run') {
    // sideways scuttle: tripod gait, body yaws left/right
    const s = sn(phase), c = cs(phase);
    rg.rotation.y = s * 0.28; rg.position.y = Math.abs(c) * 0.1;
    rg.rotation.z = s * 0.05;
    setLegs((side, k) => { const ph = phase * 2 + (k % 2 ? Math.PI : 0) + (side > 0 ? Math.PI : 0); return [0.3 * sn(ph), 0.35 * Math.max(0, sn(ph + 1.5)) * -1 + 0.1, 0.2 * cs(ph)]; });
    u.armL.rotation.x = -0.5 + sn(phase * 2) * 0.3; u.armR.rotation.x = -0.5 - sn(phase * 2) * 0.3;
    u.elbowL.rotation.x = 0.3 * sn(phase * 2 + 1); u.elbowR.rotation.x = 0.3 * sn(phase * 2 + 2);
    u.jawU.rotation.x = -0.3 - 0.3 * sn(phase * 4); u.jawL.rotation.x = 0.3 + 0.3 * sn(phase * 4);
    eyeLook(Math.PI * 0.88 + sn(t * 3) * 0.15, Math.PI * 0.88 - sn(t * 3) * 0.15);
    u.sack.rotation.set(sn(phase * 2) * 0.12, 0, sn(phase) * 0.1); u.sack.position.y = 0.06 + Math.abs(c) * 0.04;
    u.hat.rotation.set(sn(phase * 2 + 1) * 0.06, 0, sn(phase) * 0.1);
  } else if (mode === 'wave') {
    rg.position.y = Math.abs(sn(t * 3)) * 0.05;
    setLegs((side, k) => [0.05 * sn(t * 2 + k), 0, 0]);
    u.armL.rotation.set(-0.3, 0, 0); u.elbowL.rotation.set(0, 0, -0.1);
    u.armR.rotation.set(-1.1, 0, 1.0 + sn(t * 8) * 0.25); u.elbowR.rotation.set(-0.4, 0, sn(t * 8 + 1) * 0.3);
    const sn1 = snap(7); u.jawU.rotation.x = -0.1 - 0.5 * sn1; u.jawL.rotation.x = 0.1 + 0.5 * sn1;
    eyeLook(0.2, -0.1);
    rg.rotation.y = sn(t * 1.2) * 0.12;
  } else if (mode === 'taunt') {
    rg.position.y = Math.abs(sn(t * 6)) * 0.14; rg.rotation.z = sn(t * 6) * 0.1; rg.rotation.y = sn(t * 3) * 0.2;
    setLegs((side, k) => [0.12 * sn(t * 12 + k + (side > 0 ? 2 : 0)), -0.15 * Math.max(0, sn(t * 12 + k)), 0]);
    u.armL.rotation.set(-1.0, 0, -0.9 + sn(t * 9) * 0.25); u.armR.rotation.set(-1.0, 0, 0.9 - sn(t * 9 + 1) * 0.25);
    u.elbowL.rotation.set(-0.5, 0, 0); u.elbowR.rotation.set(-0.5, 0, 0);
    const sn1 = snap(10); u.jawU.rotation.x = -0.1 - 0.6 * sn1; u.jawL.rotation.x = 0.1 + 0.6 * sn1;
    eyeLook(sn(t * 6) * 0.3, -sn(t * 6) * 0.3);
    u.hat.rotation.set(0, 0, sn(t * 6) * 0.12); u.sack.rotation.z = sn(t * 6 + 1) * 0.12;
  } else if (mode === 'fly') {
    rg.position.y = 0.2 + sn(t * 4) * 0.06; rg.rotation.set(-0.35 + sn(t * 3) * 0.1, 0, sn(t * 2.2) * 0.15);
    setLegs((side, k) => [-0.5 + 0.35 * sn(t * 12 + k * 1.3), 0.4 * sn(t * 12 + k), 0]);
    u.armL.rotation.set(-0.6, 0, -0.8 + sn(t * 11) * 0.3); u.armR.rotation.set(-0.6, 0, 0.8 - sn(t * 11 + 1) * 0.3);
    u.jawU.rotation.x = -0.6; u.jawL.rotation.x = 0.6;
    eyeLook(0, 0); u.eyes.forEach((e) => e.scale.setScalar(1.25));
    u.hat.position.y = 0.58 + 0.12 + sn(t * 9) * 0.04; u.hat.rotation.z = 0.3 + sn(t * 7) * 0.2;
    u.sack.rotation.set(0.2 + sn(t * 8) * 0.1, 0, sn(t * 6) * 0.2);
  } else if (mode === 'fall') {
    rg.rotation.z = Math.PI * 0.9 + sn(t * 4) * 0.08; rg.position.y = 1.1;
    setLegs((side, k) => [0.5 + 0.4 * sn(t * 10 + k * 1.1 + (side > 0 ? 1 : 0)), 0.3 * sn(t * 10 + k), 0]);
    u.armL.rotation.set(0.2, 0, -0.5 + sn(t * 9) * 0.3); u.armR.rotation.set(0.2, 0, 0.5 - sn(t * 9) * 0.3);
    u.jawU.rotation.x = -0.5; u.jawL.rotation.x = 0.5;
    eyeLook(sn(t * 8) * 1.2, -sn(t * 8) * 1.2);
    u.hat.position.set(0.2, 0.58 + 0.3, 0.02); u.hat.rotation.z = 0.8;
    u.sack.rotation.z = 0.3;
  } else { // idle
    const br = sn(t * 2.4);
    rg.position.y = br * 0.015; body.scale.set(1 + br * 0.01, 1 + br * 0.02, 1 + br * 0.01);
    setLegs((side, k) => [0.02 * sn(t * 1.5 + k), 0, 0]);
    u.armL.rotation.set(-0.35, 0, -0.1 + sn(t * 1.3) * 0.05); u.armR.rotation.set(-0.35, 0, 0.1 - sn(t * 1.3) * 0.05);
    const sn1 = snap(2.3); u.jawU.rotation.x = -0.15 - 0.5 * sn1; u.jawL.rotation.x = 0.15 + 0.5 * sn1;
    eyeLook(sn(t * 0.8) * 0.5, sn(t * 0.8 + 0.5) * 0.5);
    u.hat.rotation.z = sn(t * 1.1) * 0.03;
  }
  if (mode !== 'idle') body.scale.set(1, 1, 1);
  // blink the visible eye
  const bl = (t % 4.1) < 0.1 ? 0.15 : 1;
  u.eyes[1].children.forEach((c) => { if (c.isMesh) c.scale.y = 1; });
  u.eyes[1].scale.y = (mode === 'fly' ? 1.25 : 1) * bl;
}

// ------------------------------------------------------------------------------------------------
// SVG portraits (head shots for character cards)
// ------------------------------------------------------------------------------------------------
let _svgN = 0;
const hx = (n) => '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');
function svgEye(cx, cy, rx, ry, iris, o = {}) {
  const ir = o.ir ?? 0.8, pr = o.pr ?? 0.52;
  const lid = o.angle ? `<path d="M${cx - rx - 2} ${cy - ry * 0.55} Q${cx} ${cy - ry * 1.25} ${cx + rx + 2} ${cy - ry * 0.55 + (o.angle || 0)}" stroke="none" fill="none"/>` : '';
  return `<g>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.sclera || '#fff'}" stroke="${o.stroke || 'rgba(40,20,40,.25)'}" stroke-width="1.5"/>
    <ellipse cx="${cx}" cy="${cy + ry * 0.04}" rx="${rx * ir}" ry="${ry * ir}" fill="${iris}"/>
    <ellipse cx="${cx}" cy="${cy + ry * 0.04}" rx="${o.slit ? rx * 0.2 : rx * ir * pr}" ry="${o.slit ? ry * ir * 0.95 : ry * ir * pr}" fill="#17111f"/>
    <ellipse cx="${cx - rx * 0.32}" cy="${cy - ry * 0.34}" rx="${rx * 0.27}" ry="${rx * 0.27}" fill="#fff"/>
    <circle cx="${cx + rx * 0.34}" cy="${cy + ry * 0.36}" r="${rx * 0.12}" fill="#fff" opacity=".9"/>${lid}
  </g>`;
}
function svgGoggle(cx, cy, r, c, id, o = {}) {
  const alpha = o.alpha ?? 0.92;
  return `<g>
    ${o.cup === false ? '' : `<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="#20222c"/>`}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}l)" opacity="${alpha}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e3e9f4" stroke-width="5"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 2.6}" fill="none" stroke="#98a2b8" stroke-width="1.6"/>
    <ellipse cx="${cx - r * 0.38}" cy="${cy - r * 0.42}" rx="${r * 0.28}" ry="${r * 0.15}" transform="rotate(-35 ${cx - r * 0.38} ${cy - r * 0.42})" fill="#fff" opacity=".9"/>
  </g>`;
}
const SVG_SP = {
  rabbit: (c, id, sk) => {
    const ear = (sx) => { const m = (x) => 100 + sx * (x - 100); return `<path d="M${m(68)} 80 C${m(40)} 28 ${m(52)} 0 ${m(72)} 6 C${m(92)} 12 ${m(92)} 54 ${m(88)} 84Z" fill="url(#${id}f)"/><path d="M${m(72)} 76 C${m(54)} 36 ${m(60)} 16 ${m(72)} 18 C${m(84)} 22 ${m(84)} 52 ${m(82)} 78Z" fill="${c.accent}"/>`; };
    return `${ear(-1)}${ear(1)}
    <ellipse cx="100" cy="120" rx="71" ry="60" fill="url(#${id}f)"/>
    <circle cx="64" cy="142" r="25" fill="url(#${id}f)"/><circle cx="136" cy="142" r="25" fill="url(#${id}f)"/>
    <ellipse cx="58" cy="146" rx="9" ry="6" fill="${c.accent}" opacity=".45"/><ellipse cx="142" cy="146" rx="9" ry="6" fill="${c.accent}" opacity=".45"/>
    <ellipse cx="100" cy="146" rx="27" ry="20" fill="url(#${id}b)"/>
    <ellipse cx="100" cy="132" rx="8" ry="5.5" fill="${c.accentD}"/>
    <path d="M100 137 V146 M100 146 Q92 154 85 148 M100 146 Q108 154 115 148" stroke="#3a2230" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <rect x="93" y="150" width="7" height="12" rx="2.5" fill="#fffaf0" stroke="#c9b9a8" stroke-width="1"/><rect x="100" y="150" width="7" height="12" rx="2.5" fill="#fffaf0" stroke="#c9b9a8" stroke-width="1"/>
    ${svgEye(72, 114, 13, 15, '#3b2540', { ir: 0.86, pr: 0.5 })}${svgEye(128, 114, 13, 15, '#3b2540', { ir: 0.86, pr: 0.5 })}`;
  },
  fox: (c, id, sk) => {
    const ear = (sx) => { const m = (x) => 100 + sx * (x - 100); return `<path d="M${m(44)} 92 L${m(38)} 14 L${m(94)} 62Z" fill="url(#${id}f)"/><path d="M${m(54)} 82 L${m(50)} 38 L${m(80)} 64Z" fill="${c.belly}"/><path d="M${m(38)} 14 L${m(43)} 48 L${m(62)} 40Z" fill="${c.accent}"/>`; };
    return `${ear(-1)}${ear(1)}
    <path d="M26 106 Q30 66 100 58 Q170 66 174 106 Q180 138 150 162 Q100 192 50 162 Q20 138 26 106Z" fill="url(#${id}f)"/>
    <path d="M24 120 L58 122 L44 138 L62 144 L48 162 Q36 150 24 120Z" fill="${c.belly}"/><path d="M176 120 L142 122 L156 138 L138 144 L152 162 Q164 150 176 120Z" fill="${c.belly}"/>
    <path d="M52 128 Q76 112 100 130 Q124 112 148 128 Q140 164 100 184 Q60 164 52 128Z" fill="url(#${id}b)"/>
    <ellipse cx="100" cy="132" rx="20" ry="26" fill="${c.fur}" opacity=".0"/>
    <path d="M80 126 Q100 118 120 126 Q112 142 100 152 Q88 142 80 126Z" fill="url(#${id}f)"/>
    <ellipse cx="100" cy="150" rx="9" ry="7" fill="${lumHex(sk.accent) < 0.4 ? c.accent : '#2a1a1a'}"/>
    <path d="M100 157 V164 M100 164 Q92 171 86 165 M100 164 Q108 171 114 165" stroke="#3a2230" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <g transform="rotate(10 72 114)">${svgEye(72, 114, 12, 14, '#f2a21a', { ir: 0.88, pr: 0.5 })}</g><g transform="rotate(-10 128 114)">${svgEye(128, 114, 12, 14, '#f2a21a', { ir: 0.88, pr: 0.5 })}</g>`;
  },
  bear: (c, id, sk) => { const pd = lum(sk.fur) > 0.8 && lum(sk.accent) < 0.2; const ec = pd ? c.accent : `url(#${id}f)`; return `
    <circle cx="44" cy="74" r="25" fill="${ec}"/><circle cx="44" cy="74" r="13" fill="${pd ? '#3a3a44' : c.accent2}"/>
    <circle cx="156" cy="74" r="25" fill="${ec}"/><circle cx="156" cy="74" r="13" fill="${pd ? '#3a3a44' : c.accent2}"/>
    <ellipse cx="100" cy="120" rx="72" ry="64" fill="url(#${id}f)"/>${pd ? `<ellipse cx="72" cy="116" rx="17" ry="21" fill="${c.accent}" transform="rotate(-18 72 116)"/><ellipse cx="128" cy="116" rx="17" ry="21" fill="${c.accent}" transform="rotate(18 128 116)"/>` : ''}
    <ellipse cx="100" cy="148" rx="33" ry="26" fill="url(#${id}b)"/>
    <ellipse cx="100" cy="134" rx="12" ry="8" fill="#2a1a16"/><ellipse cx="96" cy="131.5" rx="4" ry="2" fill="#fff" opacity=".5"/>
    <path d="M100 141 V150 M100 150 Q91 158 84 152 M100 150 Q109 158 116 152" stroke="#2a1a16" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="58" cy="146" rx="9" ry="6" fill="#ff8aa0" opacity=".35"/><ellipse cx="142" cy="146" rx="9" ry="6" fill="#ff8aa0" opacity=".35"/>
    ${svgEye(74, 116, 10, 11, '#2a1a12', { ir: 0.92, pr: 0.55 })}${svgEye(126, 116, 10, 11, '#2a1a12', { ir: 0.92, pr: 0.55 })}`; },
  cat: (c, id, sk) => {
    const ear = (sx) => { const m = (x) => 100 + sx * (x - 100); return `<path d="M${m(36)} 100 L${m(32)} 24 L${m(92)} 66Z" fill="url(#${id}f)"/><path d="M${m(46)} 90 L${m(44)} 46 L${m(78)} 68Z" fill="${c.accent}"/>`; };
    const wh = (sx) => `<path d="M${100 + sx * 36} 146 L${100 + sx * 92} 134 M${100 + sx * 36} 152 L${100 + sx * 96} 152 M${100 + sx * 36} 158 L${100 + sx * 90} 170" stroke="#f6f6ff" stroke-width="1.8" stroke-linecap="round" opacity=".95"/>`;
    return `${ear(-1)}${ear(1)}
    <ellipse cx="100" cy="122" rx="72" ry="58" fill="url(#${id}f)"/>
    <path d="M30 128 L12 134 L32 144Z" fill="${c.fur}"/><path d="M170 128 L188 134 L168 144Z" fill="${c.fur}"/>
    <path d="M88 76 V92 M100 72 V92 M112 76 V92" stroke="${c.furD}" stroke-width="4" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="100" cy="148" rx="24" ry="18" fill="url(#${id}b)"/>
    <path d="M94 136 L106 136 L100 144Z" fill="#ff8ca6"/>
    <path d="M100 144 V150 M100 150 Q92 158 85 152 M100 150 Q108 158 115 152" stroke="#3a2230" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    ${wh(-1)}${wh(1)}
    <g transform="rotate(8 72 116)">${svgEye(72, 116, 14, 16, '#7be05a', { ir: 0.92, slit: true })}</g><g transform="rotate(-8 128 116)">${svgEye(128, 116, 14, 16, '#7be05a', { ir: 0.92, slit: true })}</g>`;
  },
  frog: (c, id, sk) => `
    <ellipse cx="100" cy="132" rx="80" ry="52" fill="url(#${id}f)"/>
    <ellipse cx="100" cy="150" rx="56" ry="26" fill="url(#${id}b)"/>
    <circle cx="56" cy="82" r="32" fill="url(#${id}f)"/><circle cx="144" cy="82" r="32" fill="url(#${id}f)"/>
    <circle cx="86" cy="100" r="3" fill="${c.accent}"/><circle cx="114" cy="100" r="3" fill="${c.accent}"/>
    <ellipse cx="96" cy="124" rx="2.6" ry="2" fill="#14301a"/><ellipse cx="104" cy="124" rx="2.6" ry="2" fill="#14301a"/>
    <path d="M38 142 Q100 192 162 142" stroke="#2b1f26" stroke-width="3.6" fill="none" stroke-linecap="round"/>
    <circle cx="40" cy="152" r="9" fill="#ff7a8c" opacity=".4"/><circle cx="160" cy="152" r="9" fill="#ff7a8c" opacity=".4"/>
    ${svgEye(56, 84, 19, 20, '#ffd23f', { ir: 0.9, pr: 0.5 })}${svgEye(144, 84, 19, 20, '#ffd23f', { ir: 0.9, pr: 0.5 })}
    <path d="M24 100 Q100 70 176 100" stroke="${c.strap}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".0"/>
    ${svgGoggle(56, 84, 25, c, id, { alpha: 0.55, cup: false })}${svgGoggle(144, 84, 25, c, id, { alpha: 0.55, cup: false })}`,
  owl: (c, id, sk) => `
    <path d="M40 92 L30 26 L84 62Z" fill="${c.accent}"/><path d="M160 92 L170 26 L116 62Z" fill="${c.accent}"/>
    <ellipse cx="100" cy="118" rx="74" ry="64" fill="url(#${id}f)"/>
    <circle cx="68" cy="112" r="35" fill="url(#${id}b)" stroke="${c.furD}" stroke-width="2"/><circle cx="132" cy="112" r="35" fill="url(#${id}b)" stroke="${c.furD}" stroke-width="2"/>
    ${svgEye(68, 112, 23, 23, '#ffb41a', { ir: 0.84, pr: 0.5 })}${svgEye(132, 112, 23, 23, '#ffb41a', { ir: 0.84, pr: 0.5 })}
    <path d="M91 126 L109 126 Q100 156 91 126Z" fill="#ffa31a" stroke="#d98200" stroke-width="1.5" stroke-linejoin="round"/>
    ${svgGoggle(68, 112, 30, c, id, { alpha: 0.4, cup: false })}${svgGoggle(132, 112, 30, c, id, { alpha: 0.4, cup: false })}`,
  dino: (c, id, sk) => `
    <path d="M70 70 L78 36 L90 62Z" fill="${c.accent}"/><path d="M92 62 L100 26 L108 62Z" fill="${c.accent}"/><path d="M110 62 L122 36 L130 70Z" fill="${c.accent}"/>
    <ellipse cx="100" cy="118" rx="68" ry="60" fill="url(#${id}f)"/>
    <ellipse cx="100" cy="150" rx="46" ry="30" fill="url(#${id}f)"/>
    <ellipse cx="100" cy="166" rx="40" ry="14" fill="url(#${id}b)"/>
    <ellipse cx="84" cy="138" rx="4" ry="3" fill="${c.furD}"/><ellipse cx="116" cy="138" rx="4" ry="3" fill="${c.furD}"/>
    <path d="M60 158 Q100 172 140 158" stroke="#2b1f26" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${[66, 76, 86, 96, 106, 116, 126, 134].map((x, i) => `<path d="M${x} ${158 + Math.sin((x - 60) / 80 * Math.PI) * 6.5 - 1} l3 8 l3 -8z" fill="#fff4dc"/>`).join('')}
    <ellipse cx="46" cy="146" rx="9" ry="6" fill="${c.accent}" opacity=".4"/><ellipse cx="154" cy="146" rx="9" ry="6" fill="${c.accent}" opacity=".4"/>
    <path d="M60 94 Q76 88 90 96" stroke="${c.furD}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M140 94 Q124 88 110 96" stroke="${c.furD}" stroke-width="6" fill="none" stroke-linecap="round"/>
    ${svgEye(72, 114, 12, 14, '#ffd23f', { ir: 0.88, pr: 0.5 })}${svgEye(128, 114, 12, 14, '#ffd23f', { ir: 0.88, pr: 0.5 })}`,
};
const lumHex = (n) => lum(n);
export function critterPortraitSVG(species, skin, size = 128) {
  if (!SVG_SP[species]) species = 'rabbit';
  skin = { fur: 0xf6f8ff, belly: 0xffffff, accent: 0xffb3c7, scarf: 0xff5a5f, lens: 0x4dd8ff, ...(skin || {}) };
  const id = `cp${++_svgN}`;
  const c = {
    fur: hx(skin.fur), furL: hx(adj(skin.fur, 0.1)), furD: hx(adj(skin.fur, -0.17)),
    belly: hx(skin.belly), bellyD: hx(adj(skin.belly, -0.1)), accent: hx(skin.accent), accentD: hx(adj(skin.accent, -0.14)),
    accent2: hx(lum(skin.accent) < 0.3 ? adj(skin.accent, 0.1) : skin.accent),
    scarf: hx(skin.scarf), scarfD: hx(adj(skin.scarf, -0.16)), scarfL: hx(adj(skin.scarf, 0.2, -0.1)),
    lens: hx(skin.lens), lensL: hx(adj(skin.lens, 0.22)), lensD: hx(adj(skin.lens, -0.2)),
    strap: hx(adj(skin.scarf, lum(skin.scarf) > 0.55 ? -0.32 : -0.2, -0.05)),
  };
  const overEyes = species === 'frog' || species === 'owl';
  const gp = { rabbit: [70, 74, 19], fox: [71, 74, 19], bear: [72, 70, 18], cat: [71, 72, 18], dino: [70, 68, 18] }[species];
  const goggles = overEyes ? '' : `
    <path d="M${100 - 72} ${gp[1] + 18} Q100 ${gp[1] - 38} ${100 + 72} ${gp[1] + 18}" stroke="${c.strap}" stroke-width="9" fill="none" stroke-linecap="round"/>
    ${svgGoggle(gp[0], gp[1], gp[2], c, id)}${svgGoggle(200 - gp[0], gp[1], gp[2], c, id)}
    <rect x="${100 - 7}" y="${gp[1] - 5}" width="14" height="8" rx="3" fill="#aab3c6"/>`;
  const strapOver = overEyes ? `<path d="M${species === 'frog' ? '20 96 Q100 60 180 96' : '22 112 Q100 82 178 112'}" stroke="${c.strap}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0"/>` : '';
  const body = SVG_SP[species](c, id, skin);
  const defs = `<defs>
    <radialGradient id="${id}f" cx="0.38" cy="0.28" r="0.85"><stop offset="0" stop-color="${c.furL}"/><stop offset="0.55" stop-color="${c.fur}"/><stop offset="1" stop-color="${c.furD}"/></radialGradient>
    <radialGradient id="${id}b" cx="0.4" cy="0.3" r="0.85"><stop offset="0" stop-color="${hx(adj(skin.belly, 0.06))}"/><stop offset="1" stop-color="${c.bellyD}"/></radialGradient>
    <radialGradient id="${id}l" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="${c.lensL}"/><stop offset="0.6" stop-color="${c.lens}"/><stop offset="1" stop-color="${c.lensD}"/></radialGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.scarfL}"/><stop offset="1" stop-color="${c.scarfD}"/></linearGradient>
  </defs>`;
  const scarf = `<path d="M26 164 Q100 214 174 164 Q186 184 160 198 Q100 218 40 198 Q14 184 26 164Z" fill="url(#${id}s)"/><path d="M150 186 q14 -2 20 14 q-12 8 -26 2z" fill="${c.scarfD}"/><circle cx="150" cy="188" r="9" fill="${c.scarf}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 215" role="img" aria-label="${species}">${defs}${scarf}${body}${strapOver}${goggles}</svg>`;
}
