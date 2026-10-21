// obstacles.js - Hopinet water obstacles, sky obstacles, flight ring, dock ramps, broken-bridge edges and warning signs.
//
//  makeWaterObstacle(kind, world)  buoy | mine | sharkfin | rock | driftnet | speedboat. Origin = water line, so the
//                                  game places them at WATER_Y. The frost world swaps buoy -> ice floe and rock ->
//                                  iceberg; every other world tints rocks, buoys, nets, mines and boats to its palette.
//  makeSkyObstacle(kind)           balloon (hot-air) | drone (angry quadcopter) | storm (thundercloud) | kite
//                                  (userData.size = {w,h,d}, origin = centre of the hit volume).
//  makeRing(color)                 glowing flight hoop, outer radius 1.6, faces -Z (userData.radius). Spin it round z.
//  makeDock(world, kind)           'enter' (road ends in a wooden pier that slopes down into the water) | 'exit'
//                                  (pier ramps back up). 8.6 m wide, z from 0 to -6, deck top y = 0 at the road end.
//  makeGapEdge(world, kind)        'start' | 'end' broken-bridge edge (splintered planks, bent rails), 8.6 x 2.5 m.
//  makeWarningSign(kind)           'water' | 'gap' roadside warning sign (blue swimmer sign / yellow broken bridge) with
//                                  a flashing beacon. Faces +Z (toward the player), origin at the foot of the pole.
//
// Technique: every kind is built once per world theme from vertex-coloured geometry merged per material (so an
// obstacle costs 2-6 draw calls) and cached with G(); instances are cheap Group + Mesh wrappers. Things that move
// (bobbing buoys, wagging shark tail, spinning rotors, flashing lightning, drifting rain, blinking lamps) animate
// themselves: moving instances override updateMatrixWorld (so no hook is needed from the track) and shared materials use
// material.onBeforeRender, which also works on cloned docks / signs. Nothing uses Math.random() per frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, sparkTex } from './models.js';

// ====================================================================================================================
// helpers
// ====================================================================================================================
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(bb * t + ab * (1 - t));
}

const _c = new THREE.Color(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();

// Accumulates transformed, vertex-coloured copies of geometries and merges them into one BufferGeometry.
//  col: hex number or (x, y, z, nx, ny, nz) => hex (evaluated per triangle unless o.smooth).
//  o: p [x,y,z], r [rx,ry,rz], s number | [sx,sy,sz], q quaternion, flat (face normals), smooth (per-vertex colours)
class Acc {
  constructor(uv = false) { this.list = []; this.uv = uv; }
  add(geo, col, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'uv' && this.uv)) g.deleteAttribute(k);
    if (this.uv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const p = o.p || [0, 0, 0], r = o.r || [0, 0, 0];
    const s = typeof o.s === 'number' ? [o.s, o.s, o.s] : (o.s || [1, 1, 1]);
    if (o.q) _q.copy(o.q); else { _e.set(r[0], r[1], r[2], 'XYZ'); _q.setFromEuler(_e); }
    _m4.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    g.applyMatrix4(_m4);
    if (o.flat) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count, out = new Float32Array(n * 3);
    const put = (i, v) => { _c.setHex(v); out[i * 3] = _c.r; out[i * 3 + 1] = _c.g; out[i * 3 + 2] = _c.b; };
    if (typeof col === 'function') {
      if (o.smooth) {
        for (let i = 0; i < n; i++) put(i, col(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i)));
      } else {
        for (let i = 0; i < n; i += 3) {
          const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
          const nx = (nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2)) / 3, ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3, nz = (nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2)) / 3;
          const v = col(cx, cy, cz, nx, ny, nz);
          put(i, v); put(i + 1, v); put(i + 2, v);
        }
      }
    } else for (let i = 0; i < n; i++) put(i, col);
    g.setAttribute('color', new THREE.BufferAttribute(out, 3));
    this.list.push(g);
    return this;
  }
  // thin cylinder between two points
  line(a, b, r, col, seg = 6) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _d.length();
    if (len < 1e-5) return this;
    _q.setFromUnitVectors(_up, _d.normalize());
    return this.add(new THREE.CylinderGeometry(r, r, len, seg, 1), col, { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q: _q.clone() });
  }
  geo() {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    this.list.forEach((x) => x.dispose());
    this.list = [];
    return g;
  }
}

// Lofts closed cross-section rings (arrays of [x,y,z]) into an indexed mesh with outward normals.
function loft(rings, capEnds = true) {
  const N = rings[0].length, pts = [], idx = [];
  rings.forEach((r) => r.forEach((p) => pts.push(p[0], p[1], p[2])));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < N; k++) {
      const a = i * N + k, b = i * N + ((k + 1) % N), c = (i + 1) * N + k, d = (i + 1) * N + ((k + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  }
  if (capEnds) {
    for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
      const cen = [0, 0, 0];
      rings[ri].forEach((p) => { cen[0] += p[0] / N; cen[1] += p[1] / N; cen[2] += p[2] / N; });
      const ci = pts.length / 3;
      pts.push(cen[0], cen[1], cen[2]);
      for (let k = 0; k < N; k++) { const a = ri * N + k, b = ri * N + ((k + 1) % N); if (flip) idx.push(ci, a, b); else idx.push(ci, b, a); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point outwards
  const pos = g.attributes.position, nor = g.attributes.normal;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); }
  cx /= pos.count; cy /= pos.count; cz /= pos.count;
  let dot = 0;
  for (let i = 0; i < pos.count; i++) dot += (pos.getX(i) - cx) * nor.getX(i) + (pos.getY(i) - cy) * nor.getY(i) + (pos.getZ(i) - cz) * nor.getZ(i);
  if (dot < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

function tube(points, radius, seg = 12, rseg = 5, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed);
  return new THREE.TubeGeometry(curve, seg, radius, rseg, closed);
}
const latheOf = (prof, seg = 28) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const sphere = (r, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s, 1);
const cone = (r, h, s = 12) => new THREE.ConeGeometry(r, h, s, 1);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const torus = (R, r, rs = 10, ts = 32) => new THREE.TorusGeometry(R, r, rs, ts);

// ---------- materials ----------
const MAT = {};
const cached = (k, f) => MAT[k] || (MAT[k] = f());
const litMat = () => cached('lit', () => new THREE.MeshLambertMaterial({ vertexColors: true }));
const litDS = () => cached('litDS', () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
const glowMat = () => cached('glow', () => new THREE.MeshBasicMaterial({ vertexColors: true }));
const glowDS = () => cached('glowDS', () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
const iceMat = () => cached('ice', () => new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a7aa8, emissiveIntensity: 0.32 }));
const texLit = (key, map, extra = {}) => cached('tl:' + key, () => new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra }));

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
// Soft additive glow sprite (own material so it can pulse per instance).
function halo(color, size, opacity = 1, parent = null, x = 0, y = 0, z = 0) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1);
  s.position.set(x, y, z);
  s.renderOrder = 6;
  s.userData.fx = true;
  if (parent) parent.add(s);
  return s;
}
// Self animating group: fn(time, group) runs once per updateMatrixWorld (i.e. once per rendered frame).
function selfAnimate(root, fn) {
  const base = THREE.Object3D.prototype.updateMatrixWorld;
  const phase = Math.random() * 20;
  root.updateMatrixWorld = function (force) { fn(now() + phase, this); base.call(this, force); };
}

// ---------- canvas textures ----------
const texCache = new Map();
function ctex(key, w, h, draw, repeat = false) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}
const foamRingTex = () => ctex('foamRing', 256, 256, (g, w, h) => {
  const r = rng(11);
  const gr = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.5);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.42, 'rgba(255,255,255,0.5)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0.26)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 340; i++) {
    const a = r() * TAU, rad = w * (0.27 + r() * 0.17), s = 1.0 + r() * 2.8;
    g.fillStyle = `rgba(255,255,255,${0.18 + r() * 0.5})`;
    g.beginPath(); g.arc(w / 2 + Math.cos(a) * rad, h / 2 + Math.sin(a) * rad, s, 0, TAU); g.fill();
  }
});
const wakeTex = () => ctex('wake', 128, 256, (g, w, h) => {
  const r = rng(5);
  for (let i = 0; i < 520; i++) {
    const y = Math.pow(r(), 0.8) * h, spread = (y / h) * (w * 0.46);
    const side = r() < 0.5 ? -1 : 1;
    const x = w / 2 + side * spread * (0.78 + r() * 0.3) + (r() - 0.5) * 6;
    const a = (1 - y / h) * (0.35 + r() * 0.65);
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath(); g.arc(x, y, 1.5 + r() * 4.5 * (1 - y / h * 0.5), 0, TAU); g.fill();
  }
  for (let i = 0; i < 220; i++) {
    const y = r() * h * 0.8, x = w / 2 + (r() - 0.5) * w * 0.28 * (0.4 + y / h);
    g.fillStyle = `rgba(255,255,255,${(1 - y / h) * (0.2 + r() * 0.5)})`;
    g.beginPath(); g.arc(x, y, 2 + r() * 5, 0, TAU); g.fill();
  }
  const fade = g.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.7, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
});
const foamStripTex = () => ctex('foamStrip', 256, 64, (g, w, h) => {
  const r = rng(9);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 150; i++) {
    g.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.6})`;
    g.beginPath(); g.arc(r() * w, h * (0.3 + r() * 0.4), 1.5 + r() * 4, 0, TAU); g.fill();
  }
}, true);
const netTex = () => ctex('net', 128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,244,214,1)'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.closePath();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,1)';
  for (const [x, y] of [[0, h / 2], [w, h / 2], [w / 2, 0], [w / 2, h]]) { g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); }
}, true);
const rainTex = () => ctex('rain', 128, 128, (g, w, h) => {
  const r = rng(21);
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, l = 14 + r() * 22;
    g.strokeStyle = `rgba(190,225,255,${0.45 + r() * 0.5})`; g.lineWidth = 2 + r() * 1.6; g.lineCap = 'round';
    for (const oy of [0, -h, h]) { g.beginPath(); g.moveTo(x, y + oy); g.lineTo(x - 3, y + l + oy); g.stroke(); }
  }
}, true);
const wickerTex = () => ctex('wicker', 128, 128, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(70,35,10,0.55)'; g.lineWidth = 3;
  for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(x + ((y / 16) % 2 ? 8 : 0), y); g.lineTo(x + ((y / 16) % 2 ? 8 : 0), y + 16); g.stroke(); }
  g.strokeStyle = 'rgba(255,240,200,0.35)'; g.lineWidth = 2;
  for (let y = 5; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
}, true);
const ringGlowTex = () => ctex('ringGlow', 256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  gr.addColorStop(0.66, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const grainTex = () => ctex('grain', 128, 64, (g, w, h) => {
  const r = rng(3);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 22; i++) {
    const y = r() * h;
    g.strokeStyle = r() < 0.6 ? `rgba(60,30,5,${0.08 + r() * 0.16})` : `rgba(255,255,255,${0.15 + r() * 0.2})`;
    g.lineWidth = 0.8 + r() * 1.8;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.07 + i) * 1.4);
    g.stroke();
  }
  g.fillStyle = 'rgba(60,30,5,0.22)';
  g.beginPath(); g.ellipse(w * 0.7, h * 0.4, 5, 3, 0, 0, TAU); g.fill();
}, true);

function foam(sx, sz, y, tex, opacity = 0.9, parent = null, x = 0, z = 0) {
  const geo = G(`ob:foam:${sx}:${sz}`, () => new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2));
  const mat = cached(`foam:${tex === 'ring' ? 'r' : tex === 'wake' ? 'w' : 's'}:${opacity}`, () => new THREE.MeshBasicMaterial({
    map: tex === 'ring' ? foamRingTex() : tex === 'wake' ? wakeTex() : foamStripTex(), transparent: true, opacity, depthWrite: false,
  }));
  const m = mesh(geo, mat, parent, x, y, z);
  m.renderOrder = 5;
  m.userData.fx = true;
  return m;
}

// ====================================================================================================================
// world themes
// ====================================================================================================================
const THEMES = {
  harbor: {
    id: 'harbor', buoyA: 0xff4a3d, buoyB: 0xfff6ee, lamp: 0xffb020, mineBody: 0x364256, mineHorn: 0xdfe5ee, mineLight: 0xff3b3b, mineBand: 0xffc21a,
    rock: { lo: 0x625e66, hi: 0xb5aa9c, top: 0xf0e8d8, wet: 0x2c3a44, cap: 0x6cc04a, foam: 1 },
    rope: 0xf6e8c8, floatA: 0xff7a2e, boat: [0xe53935, 0xfff4e0, 0x1d2a44],
    wood: [0xd29a5e, 0x9a6a3a], pile: 0x5d3d24, ropeD: 0xf0e2c0, accent: 0xe94b3c, lampD: 0xffd27a, gwood: [0xc88f55, 0x8b5d34],
  },
  neon: {
    id: 'neon', buoyA: 0x2a2352, buoyB: 0x39f3ff, lamp: 0xff3df2, mineBody: 0x4d3f9a, mineHorn: 0xd4c8ff, mineLight: 0xff3df2, mineBand: 0x39f3ff,
    rock: { lo: 0x231a4a, hi: 0x4d3f94, top: 0x8f80e8, wet: 0x120e30, crystals: [0xff3df2, 0x39f3ff] },
    rope: 0x39f3ff, floatA: 0xff3df2, boat: [0x7b2cff, 0x39f3ff, 0x14102e],
    wood: [0x45407e, 0x2a2656], pile: 0x1c1840, ropeD: 0x39f3ff, accent: 0xff3df2, lampD: 0xff3df2, glow: 0x39f3ff, gwood: [0x6b62c0, 0x3c3680],
  },
  coral: {
    id: 'coral', buoyA: 0xff8f1f, buoyB: 0xfffaf0, lamp: 0xffe14d, mineBody: 0x2f4a5a, mineHorn: 0xf2f6f6, mineLight: 0xff4a4a, mineBand: 0x2ec4b6,
    rock: { lo: 0xc89a78, hi: 0xeacfa6, top: 0xfff0d2, wet: 0x8d6a52, coral: [0xff6f61, 0xff9f1c, 0xff8fb8, 0x2ec4b6], foam: 1 },
    rope: 0xfff0d0, floatA: 0x2ec4b6, boat: [0xff7a2e, 0xfff6dc, 0x0e5d73],
    wood: [0xeed5a6, 0xb98f58], pile: 0x8a6a3a, ropeD: 0xfff6dc, accent: 0x2ec4b6, lampD: 0xffd27a, gwood: [0xe3c690, 0xb08850],
  },
  jungle: {
    id: 'jungle', buoyA: 0xffc21a, buoyB: 0x2f7d32, lamp: 0xe8ff6a, mineBody: 0x3a4a30, mineHorn: 0xc9d3b4, mineLight: 0xff5a3a, mineBand: 0xffc21a,
    rock: { lo: 0x62775a, hi: 0x9db388, top: 0x7bd05a, wet: 0x2f4630, moss: 1, vines: 1 },
    rope: 0xd2b27a, floatA: 0xffc21a, boat: [0x2f9d57, 0xf3e6b0, 0x23331e],
    wood: [0x8c6a42, 0x5b4128], pile: 0x4a3721, ropeD: 0xc9a870, accent: 0xf4b400, lampD: 0xe8ff6a, moss: 1, gwood: [0x7e6038, 0x523a22],
  },
  frost: {
    id: 'frost', frost: true, buoyA: 0xd84a4a, buoyB: 0xffffff, lamp: 0xffe9a8, mineBody: 0x3a5878, mineHorn: 0xe8f4ff, mineLight: 0xff4a4a, mineBand: 0x7fd8ff,
    rock: { lo: 0x7fd0ee, hi: 0xdff6ff, top: 0xffffff, wet: 0x4aa8e0 },
    rope: 0xe0f0ff, floatA: 0xd84a4a, boat: [0x2f7bd8, 0xffffff, 0x14304e],
    wood: [0xa9b4c4, 0x6f7f94], pile: 0x5b6677, ropeD: 0xdcecff, accent: 0xd84a4a, lampD: 0xffe9a8, snow: 1, gwood: [0xa0acbd, 0x6c7b90],
  },
  dunes: {
    id: 'dunes', buoyA: 0xff7a1f, buoyB: 0xfff1d0, lamp: 0xffc14d, mineBody: 0x4a3a30, mineHorn: 0xe8d6b0, mineLight: 0xff4a3a, mineBand: 0x2a9d8f,
    rock: { lo: 0xc9824a, hi: 0xf2cf8f, top: 0xffe6b0, wet: 0x7a4f33, strata: [0xd9a05a, 0xefc17c, 0xc5834a, 0xf6d9a0] },
    rope: 0xf6e3c0, floatA: 0x2a9d8f, boat: [0xd97706, 0xfff1d0, 0x6b2f10],
    wood: [0xe6c38a, 0xb48a52], pile: 0x7b5630, ropeD: 0xf6e3c0, accent: 0x2a9d8f, lampD: 0xffc14d, gwood: [0xdcb67c, 0xa97c45],
  },
};
const themeOf = (world) => THEMES[(world && world.id) || 'harbor'] || THEMES.harbor;

function group(kind, size) {
  const g = new THREE.Group();
  g.userData = { kind, size: size || null };
  return g;
}

// ====================================================================================================================
// WATER OBSTACLES
// ====================================================================================================================
// ---------- buoy (low, 1.8 wide, 0.9 tall) ----------
function buoy(th) {
  const parts = G('ob:buoy:' + th.id, () => {
    const A = new Acc(), E = new Acc();
    const seg = (x, y, z) => (Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 6)) % 2 ? th.buoyA : th.buoyB);
    A.add(torus(0.66, 0.24, 14, 48), seg, { r: [Math.PI / 2, 0, 0], p: [0, 0.04, 0] });
    const prof = [[0.001, -0.72], [0.14, -0.7], [0.3, -0.5], [0.42, -0.24], [0.5, -0.04], [0.54, 0.1], [0.53, 0.24], [0.47, 0.38], [0.36, 0.5], [0.24, 0.58], [0.2, 0.62], [0.001, 0.63]];
    A.add(latheOf(prof, 36), (x, y) => (y < -0.02 ? mix(th.buoyA, 0x0b2540, 0.6) : y < 0.2 ? th.buoyA : y < 0.38 ? th.buoyB : th.buoyA));
    // glossy top highlight ring
    A.add(torus(0.3, 0.035, 6, 24), 0xffffff, { r: [Math.PI / 2, 0, 0], p: [0, 0.55, 0] });
    A.add(cyl(0.07, 0.1, 0.12, 12), 0x3a404c, { p: [0, 0.66, 0] });
    A.add(cyl(0.12, 0.12, 0.02, 14), 0x3a404c, { p: [0, 0.72, 0] });
    A.add(cone(0.15, 0.1, 14), 0x3a404c, { p: [0, 0.89, 0] });
    for (const a of [0.7, 2.3, 3.9, 5.5]) A.add(cyl(0.012, 0.012, 0.16, 5), 0x3a404c, { p: [Math.cos(a) * 0.115, 0.8, Math.sin(a) * 0.115] });
    E.add(cyl(0.11, 0.11, 0.14, 14), th.lamp, { p: [0, 0.8, 0] });
    return { lit: A.geo(), glow: E.geo() };
  });
  const g = group('buoy', { w: 1.8, h: 0.9, d: 1.8 });
  const bob = new THREE.Group(); g.add(bob);
  mesh(parts.lit, litMat(), bob);
  mesh(parts.glow, glowMat(), bob);
  const lamp = halo(th.lamp, 1.05, 1, bob, 0, 0.8, 0);
  const f = foam(3.3, 3.3, 0.06, 'ring', 0.95, g);
  selfAnimate(g, (t) => {
    bob.position.y = Math.sin(t * 1.7) * 0.035;
    bob.rotation.set(Math.sin(t * 1.1 + 1) * 0.05, 0, Math.sin(t * 1.35) * 0.06);
    f.scale.setScalar(1 + Math.sin(t * 2) * 0.035);
    lamp.material.opacity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5.5));
  });
  return g;
}

// ---------- ice floe (frost world's low obstacle) ----------
function iceFloe(th) {
  const parts = G('ob:floe:' + th.id, () => {
    const A = new Acc();
    const r = rng(77);
    const slab = cyl(0.8, 0.9, 1.5, 8);
    const p = slab.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (Math.sin(Math.round(p.getX(i) * 40) * 12.9 + Math.round(p.getZ(i) * 40) * 7.7) * 0.5) * 0.12;
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k * 0.88);
    }
    const col = (x, y, z, nx, ny) => (y < 0 ? mix(0x2f90d0, 0x7fd0ee, sstep(-1, 0, y)) : ny > 0.5 ? 0xf6fcff : mix(0x6fc8ea, 0xcdefff, sstep(0, 0.5, y)));
    A.add(slab, col, { p: [0, -0.22, 0], flat: true });
    A.add(cyl(0.62, 0.72, 0.14, 8), 0xffffff, { p: [0.02, 0.52, 0], flat: true });
    // jagged ice shards on top
    const shards = [[-0.42, 0.45, 0.1, 0.24, 0.4, 0.2], [0.3, 0.5, -0.1, 0.28, 0.4, -0.25], [0.02, 0.5, 0.3, 0.2, 0.3, 0.3], [-0.1, 0.5, -0.3, 0.22, 0.34, -0.1]];
    for (const [x, y, z, rad, h, tilt] of shards) A.add(cone(rad, h, 5), (xx, yy, zz, nx, ny) => (yy > 0.7 ? 0xffffff : mix(0xb5e8ff, 0xffffff, ny * 0.5 + 0.3)), { p: [x, y + h / 2, z], r: [tilt * 0.3, 0, tilt * 0.5], flat: true });
    // little red flag so it reads as a hazard
    A.add(cyl(0.015, 0.015, 0.4, 5), 0x6b4a2a, { p: [-0.55, 0.7, -0.22] });
    A.add(new THREE.PlaneGeometry(0.26, 0.17), 0xe63946, { p: [-0.43, 0.82, -0.22] });
    return A.geo();
  });
  const g = group('buoy', { w: 1.8, h: 0.9, d: 1.8 });
  const bob = new THREE.Group(); g.add(bob);
  mesh(parts, iceMat(), bob);
  const f = foam(3.2, 3.2, 0.06, 'ring', 0.95, g);
  selfAnimate(g, (t) => {
    bob.position.y = Math.sin(t * 1.2) * 0.03;
    bob.rotation.set(Math.sin(t * 0.9) * 0.025, 0, Math.sin(t * 1.0 + 2) * 0.03);
    f.scale.setScalar(1 + Math.sin(t * 1.6) * 0.03);
  });
  return g;
}

// ---------- sea mine (cone, 0.8 wide, 0.9 tall) ----------
function mine(th) {
  const parts = G('ob:mine:' + th.id, () => {
    const A = new Acc(), E = new Acc(), C = new Acc();
    const cy = 0.16, R = 0.27;
    A.add(sphere(R, 22, 14), (x, y, z, nx, ny) => mix(th.mineBody, mix(th.mineBody, 0xffffff, 0.35), sstep(-0.2, 0.9, ny)), { p: [0, cy, 0], smooth: true });
    A.add(torus(R + 0.004, 0.034, 8, 36), th.mineBand, { r: [Math.PI / 2, 0, 0], p: [0, cy, 0] });
    A.add(torus(R * 0.86, 0.026, 8, 30), th.mineBand, { r: [Math.PI / 2, 0, 0], p: [0, cy + 0.15, 0] });
    // 12 horns around an icosahedron, one pointing straight up
    const t = (1 + Math.sqrt(5)) / 2, dirs = [];
    for (const a of [-1, 1]) for (const b of [-t, t]) { dirs.push([0, a, b], [a, b, 0], [b, 0, a]); }
    const top = new THREE.Vector3(0, 1, t).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(top, _up);
    for (const d of dirs) {
      const n = new THREE.Vector3(d[0], d[1], d[2]).normalize().applyQuaternion(rot);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, n);
      const base = n.clone().multiplyScalar(R - 0.0).add(new THREE.Vector3(0, cy, 0));
      const mid = n.clone().multiplyScalar(R + 0.07).add(new THREE.Vector3(0, cy, 0));
      A.add(cone(0.08, 0.24, 8), th.mineHorn, { p: [mid.x, mid.y, mid.z], q });
      A.add(cyl(0.095, 0.095, 0.05, 8), mix(th.mineHorn, 0x404860, 0.4), { p: [base.x, base.y, base.z], q });
      const tip = n.clone().multiplyScalar(R + 0.2).add(new THREE.Vector3(0, cy, 0));
      E.add(sphere(0.052, 8, 6), th.mineLight, { p: [tip.x, tip.y, tip.z] });
    }
    // antenna with a beacon
    A.add(cyl(0.012, 0.012, 0.22, 5), 0x2a2f3a, { p: [0, cy + R + 0.27, 0] });
    E.add(sphere(0.07, 12, 10), th.mineLight, { p: [0, cy + R + 0.4, 0] });
    // mooring chain down to the sea floor
    for (let i = 0; i < 7; i++) C.add(torus(0.05, 0.014, 5, 10), 0x6a7280, { p: [0, -0.12 - i * 0.13, 0], r: [0, i % 2 ? 0 : Math.PI / 2, 0] });
    C.add(box(0.28, 0.1, 0.28), 0x4a5160, { p: [0, -1.02, 0] });
    return { lit: A.geo(), glow: E.geo(), chain: C.geo() };
  });
  const g = group('mine', { w: 0.8, h: 0.9, d: 0.8 });
  const bob = new THREE.Group(); g.add(bob);
  const body = new THREE.Group(); bob.add(body);
  mesh(parts.lit, litMat(), body);
  mesh(parts.glow, glowMat(), body);
  mesh(parts.chain, litMat(), g);
  const beacon = halo(th.mineLight, 1.0, 1, body, 0, 0.16 + 0.27 + 0.4, 0);
  const f = foam(1.9, 1.9, 0.06, 'ring', 0.9, g);
  selfAnimate(g, (t) => {
    bob.position.y = Math.sin(t * 2.0) * 0.04;
    bob.rotation.set(Math.sin(t * 1.3) * 0.07, 0, Math.sin(t * 1.7 + 1) * 0.07);
    body.rotation.y = t * 0.7;
    beacon.material.opacity = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 6), 2);
    f.scale.setScalar(1 + Math.sin(t * 2.4) * 0.05);
  });
  return g;
}

// ---------- shark fin (block, 1.4 wide, 1.1 tall above the water) ----------
function finShape(h, base, sweep) {
  const s = new THREE.Shape();
  s.moveTo(-base * 0.55, 0);
  s.bezierCurveTo(-base * 0.4, h * 0.45, -base * 0.05 + sweep * 0.2, h * 0.88, sweep, h);
  s.bezierCurveTo(sweep - 0.02, h * 0.62, base * 0.2 + sweep * 0.5, h * 0.25, base * 0.45, 0);
  s.closePath();
  return s;
}
function sharkfin(th) {
  const parts = G('ob:shark:' + th.id, () => {
    const A = new Acc(), E = new Acc();
    const back = 0x5f84a8, belly = 0xe9f2f8;
    // body: lathe along x, nose at -x
    const prof = [[0.001, -0.78], [0.1, -0.74], [0.24, -0.6], [0.36, -0.38], [0.42, -0.12], [0.43, 0.12], [0.38, 0.38], [0.28, 0.58], [0.17, 0.74], [0.11, 0.86], [0.001, 0.9]];
    A.add(latheOf(prof, 24), (x, y, z, nx, ny) => mix(back, belly, sstep(0.05, -0.55, ny)), { r: [0, 0, Math.PI / 2], p: [-0.04, -0.05, 0], s: [1, 1, 0.82], smooth: true });
    // dorsal fin (big, curved, dark tip)
    const fin = new THREE.ExtrudeGeometry(finShape(1.13, 0.72, 0.28), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2, curveSegments: 14 });
    fin.translate(0, 0, -0.05);
    A.add(fin, (x, y, z, nx, ny, nz) => mix(mix(0x4f6e92, 0x7fa2c6, sstep(0.0, 0.8, y)), 0x273a52, sstep(0.82, 1.12, y)), { p: [0.04, 0.18, 0], smooth: true });
    // pectoral fin tips and gill slits
    A.add(cone(0.1, 0.32, 4), 0x4f6e92, { p: [-0.1, 0.02, 0.43], r: [Math.PI / 2 + 0.6, 0, 0.5], s: [1, 1, 0.4] });
    for (let i = 0; i < 3; i++) A.add(box(0.012, 0.15, 0.02), 0x2c405a, { p: [-0.32 + i * 0.07, 0.15, 0.405 - i * 0.012], r: [0, -0.3, 0.2] });
    // eye
    A.add(sphere(0.07, 12, 10), 0xffffff, { p: [-0.55, 0.13, 0.29] });
    A.add(sphere(0.045, 10, 8), 0x10131c, { p: [-0.575, 0.13, 0.345] });
    A.add(sphere(0.014, 6, 5), 0xffffff, { p: [-0.59, 0.15, 0.378] });
    // angry brow
    A.add(box(0.15, 0.03, 0.03), 0x2c405a, { p: [-0.55, 0.22, 0.31], r: [0, -0.3, -0.35] });
    // nose tip highlight
    A.add(sphere(0.05, 8, 6), 0xbfd4e8, { p: [-0.78, -0.02, 0.0] });
    const tail = new THREE.ExtrudeGeometry(finShape(0.5, 0.3, 0.2), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 10 });
    tail.translate(0, 0, -0.025);
    const T = new Acc();
    T.add(tail, (x, y) => mix(0x4f6e92, 0x273a52, sstep(0.1, 0.55, y)), { p: [0, 0, 0], smooth: true });
    return { lit: A.geo(), tail: T.geo(), glow: E.geo() };
  });
  const g = group('sharkfin', { w: 1.4, h: 1.1, d: 1.4 });
  const sw = new THREE.Group(); g.add(sw);
  sw.scale.setScalar(0.82);
  const bob = new THREE.Group(); sw.add(bob);
  mesh(parts.lit, litMat(), bob);
  const tailPivot = new THREE.Group(); tailPivot.position.set(0.6, 0.03, 0); bob.add(tailPivot);
  mesh(parts.tail, litDS(), tailPivot).rotation.y = 0;
  const f = foam(3.0, 2.2, 0.06, 'ring', 0.95, g);
  const wake = foam(2.0, 3.6, 0.055, 'wake', 0.9, g, 0, 0);
  wake.rotation.y = -Math.PI / 2; wake.position.x = 1.9;
  selfAnimate(g, (t) => {
    sw.rotation.y = Math.sin(t * 0.8) * 0.16;
    bob.position.y = Math.sin(t * 1.6) * 0.03;
    bob.rotation.z = Math.sin(t * 1.3) * 0.035;
    tailPivot.rotation.y = Math.sin(t * 3.4) * 0.5;
    f.scale.set(1 + Math.sin(t * 2.0) * 0.03, 1, 1 + Math.sin(t * 2.0) * 0.03);
  });
  return g;
}

// ---------- rocks ----------
function rockChunk(seed, detail, scale, amp, taper) {
  const r = rng(seed), a0 = r() * 6, a1 = r() * 6, a2 = r() * 6;
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(Math.round(v.x * 60) * 12.9898 + Math.round(v.y * 60) * 78.233 + Math.round(v.z * 60) * 37.719 + seed) * 43758.5453;
    const facet = (h - Math.floor(h) - 0.5) * 0.5;
    const d = 1 + amp * (Math.sin(v.x * 2.9 + a0) * Math.sin(v.y * 3.3 + a1) + Math.sin(v.z * 3.7 + a2) * Math.cos(v.x * 2.3 + a1) + facet);
    const k = 1 - taper * sstep(-0.3, 1, v.y);
    pos.setXYZ(i, v.x * d * k * scale[0], v.y * d * scale[1], v.z * d * k * scale[2]);
  }
  return geo;
}
function coralBush(A, x, y, z, s, colors, seed) {
  const r = rng(seed);
  for (let i = 0; i < 6; i++) {
    const col = colors[Math.floor(r() * colors.length)];
    const a = (i / 6) * TAU + r(), lean = 0.35 + r() * 0.45, len = (0.28 + r() * 0.2) * s;
    A.add(cyl(0.035 * s, 0.06 * s, len, 6), col, { p: [x + Math.cos(a) * len * 0.35, y + len * 0.45, z + Math.sin(a) * len * 0.35], r: [Math.sin(a) * lean, 0, -Math.cos(a) * lean] });
    A.add(sphere(0.07 * s, 8, 6), mix(col, 0xffffff, 0.3), { p: [x + Math.cos(a) * len * 0.72, y + len * 0.88, z + Math.sin(a) * len * 0.72] });
  }
}
function rock(th) {
  const R = th.rock;
  const parts = G('ob:rock:' + th.id, () => {
    const A = new Acc(), E = new Acc();
    const chunks = [
      [11, 1, [1.0, 1.6, 0.92], 0.15, 0.36, [-0.05, 0.72, 0]],
      [23, 1, [0.55, 1.0, 0.5], 0.14, 0.35, [0.6, 0.2, 0.22]],
      [37, 1, [0.5, 0.85, 0.46], 0.14, 0.35, [-0.64, 0.12, -0.12]],
      [41, 1, [0.46, 0.6, 0.42], 0.14, 0.2, [0.2, 0.02, 0.66]],
    ];
    const col = (x, y, z, nx, ny) => {
      let c;
      if (R.strata) c = R.strata[((Math.floor((y + 0.4) / 0.38) % 4) + 4) % 4];
      else c = mix(R.lo, R.hi, sstep(0, 2.2, y));
      if (!R.strata) c = mix(c, R.top, sstep(0.35, 0.95, ny) * 0.65);
      else c = mix(c, R.top, sstep(0.7, 1, ny) * 0.3);
      if (R.moss) c = mix(c, mix(0x3f8f3a, 0x78c850, sstep(0.3, 1, ny)), sstep(-0.1, 0.5, ny) * sstep(0.3, 0.9, y) * 0.85);
      if (R.cap && y > 1.75 && ny > 0.5) c = mix(c, R.cap, 0.9);
      c = mix(c, R.wet, (1 - sstep(0.0, 0.38, y)) * 0.8);
      if (y < 0.05) c = mix(c, R.wet, 0.6);
      const j = Math.sin(Math.round(x * 37) * 12.9898 + Math.round(y * 37) * 78.233 + Math.round(z * 37) * 37.719) * 43758.5453;
      const jj = (j - Math.floor(j)) * 2 - 1;
      return mix(c, jj > 0 ? 0xffffff : 0x000000, Math.abs(jj) * 0.16);
    };
    for (const [seed, det, sc, amp, tp, p] of chunks) A.add(rockChunk(seed, det, sc, amp, tp), col, { p, flat: true });
    // seaweed / barnacle fringe at the waterline
    if (!R.strata) for (let i = 0; i < 9; i++) {
      const a = i * 0.7 + 0.3, rr = 0.72 + (i % 3) * 0.12;
      A.add(sphere(0.1, 6, 5), mix(0x3f6b3a, 0x7ea54a, (i % 3) / 2), { p: [Math.cos(a) * rr, 0.06, Math.sin(a) * rr * 0.9], s: [1.3, 0.55, 1], flat: true });
    }
    if (R.cap) {
      // grass tufts on the peak
      for (let i = 0; i < 5; i++) A.add(cone(0.06, 0.28, 5), mix(0x6cc04a, 0x9be05a, (i % 2) * 0.6), { p: [-0.2 + Math.cos(i * 1.7) * 0.12, 2.34 + (i % 2) * 0.03, Math.sin(i * 1.7) * 0.12], r: [Math.sin(i) * 0.3, 0, Math.cos(i * 2) * 0.3] });
    }
    if (R.coral) {
      coralBush(A, 0.62, 0.85, 0.3, 1.7, R.coral, 5);
      coralBush(A, -0.6, 0.55, -0.1, 1.5, R.coral, 9);
      coralBush(A, 0.05, 1.7, 0.4, 1.2, R.coral, 13);
      coralBush(A, -0.1, 2.2, -0.05, 1.0, R.coral, 17);
    }
    if (R.moss) {
      for (let i = 0; i < 3; i++) {
        const x = -0.4 + i * 0.35, z = 0.58 + (i % 2) * 0.08;
        A.add(tube([[x, 1.5 - i * 0.2, z], [x + 0.04, 1.2 - i * 0.2, z + 0.06], [x - 0.02, 0.85 - i * 0.2, z + 0.08]], 0.018, 8, 4), 0x2f7d32);
      }
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3;
        A.add(cone(0.07, 0.5, 4), mix(0x2f8f3a, 0x6bc24a, (i % 3) / 2), { p: [-0.1 + Math.cos(a) * 0.15, 2.3 + 0.1, Math.sin(a) * 0.12], r: [Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6], s: [1, 1, 0.35] });
      }
    }
    if (R.crystals) {
      const cs = [[0.5, 0.75, 0.35, 0.12, 0.7, 0.4], [-0.5, 0.55, 0.3, 0.1, 0.6, -0.5], [0.05, 1.7, 0.4, 0.1, 0.55, 0.15], [0.7, 0.35, 0.5, 0.08, 0.4, 0.8]];
      cs.forEach(([x, y, z, rad, len, tilt], i) => {
        const c = R.crystals[i % 2];
        const body = cyl(rad, rad * 1.15, len, 6), tip = cone(rad, len * 0.35, 6);
        const gc = (xx, yy) => mix(mix(c, 0x000000, 0.45), mix(c, 0xffffff, 0.35), sstep(y - len / 2, y + len / 2 + 0.1, yy));
        E.add(body, gc, { p: [x, y + len / 2, z], r: [0, 0, tilt * 0.5], smooth: true });
        E.add(tip, mix(c, 0xffffff, 0.5), { p: [x - Math.sin(tilt * 0.5) * len * 0.67, y + len + len * 0.17, z], r: [0, 0, tilt * 0.5] });
      });
    }
    return { lit: A.geo(), glow: E.geo() };
  });
  const g = group('rock', { w: 2.2, h: 2.4, d: 2.2 });
  const body = new THREE.Group(); g.add(body);
  mesh(parts.lit, litMat(), body);
  if (parts.glow) {
    mesh(parts.glow, glowMat(), body);
    halo(R.crystals[0], 1.7, 0.55, body, 0.5, 1.0, 0.5);
    halo(R.crystals[1], 1.3, 0.5, body, -0.5, 0.8, 0.4);
  }
  const f = foam(4.6, 4.2, 0.06, 'ring', 1, g);
  selfAnimate(g, (t) => {
    body.position.y = Math.sin(t * 0.9) * 0.015;
    f.scale.set(1 + Math.sin(t * 1.4) * 0.025, 1, 1 + Math.sin(t * 1.4) * 0.025);
  });
  return g;
}

// ---------- iceberg (frost world's rock) ----------
function iceberg(th) {
  const parts = G('ob:berg:' + th.id, () => {
    const A = new Acc();
    const col = (x, y, z, nx, ny) => {
      if (y < 0) return mix(0x2f8fd0, 0x86d6f0, sstep(-1.3, 0, y));
      let c = mix(0x8fdcf5, 0xe8f9ff, sstep(0, 2.2, y));
      c = mix(c, 0xffffff, sstep(0.3, 0.9, ny) * 0.8);
      return mix(c, 0x58b9e8, (1 - sstep(0, 0.35, y)) * 0.6);
    };
    const chunks = [
      [3, 1, [0.78, 1.7, 0.72], 0.1, 0.7, [-0.05, 0.5, 0]],
      [17, 1, [0.5, 1.15, 0.46], 0.1, 0.65, [0.66, 0.1, 0.18]],
      [29, 1, [0.46, 0.9, 0.44], 0.1, 0.6, [-0.72, 0.05, -0.1]],
      [43, 1, [0.95, 0.9, 0.85], 0.08, 0.2, [0.05, -0.55, 0]],
    ];
    for (const [seed, det, sc, amp, tp, p] of chunks) A.add(rockChunk(seed, det, sc, amp, tp), col, { p, flat: true });
    // crisp pointed crystal spires
    A.add(cone(0.3, 0.7, 5), (x, y, z, nx, ny) => mix(0xcdf0ff, 0xffffff, sstep(0.2, 1, ny)), { p: [-0.05, 1.85, 0.05], r: [0.05, 0.4, -0.1], flat: true });
    A.add(cone(0.18, 0.55, 5), 0xf2fbff, { p: [0.7, 1.15, 0.2], r: [0.1, 0.2, -0.25], flat: true });
    return A.geo();
  });
  const g = group('rock', { w: 2.2, h: 2.4, d: 2.2 });
  const body = new THREE.Group(); g.add(body);
  mesh(parts, iceMat(), body);
  const f = foam(4.6, 4.2, 0.06, 'ring', 1, g);
  selfAnimate(g, (t) => {
    body.position.y = Math.sin(t * 0.8) * 0.02;
    body.rotation.z = Math.sin(t * 0.7) * 0.012;
    f.scale.set(1 + Math.sin(t * 1.3) * 0.025, 1, 1 + Math.sin(t * 1.3) * 0.025);
  });
  return g;
}

// ---------- drift net (high, 2.2 wide, solid 0.2 .. 1.8 above the water) ----------
function driftnet(th) {
  const parts = G('ob:net:' + th.id, () => {
    const A = new Acc(), E = new Acc();
    const stripe = (x, y, z) => (Math.floor((x + 3) / 0.22) % 2 ? 0xffc21a : 0x20242c);
    // floating barrels at the foot of each post
    for (const s of [-1, 1]) {
      const x = s * 0.93;
      A.add(cyl(0.19, 0.19, 0.52, 18), (xx, yy) => (yy > 0.1 ? th.floatA : yy > -0.05 ? 0xffffff : th.floatA), { p: [x, 0.0, 0] });
      A.add(torus(0.205, 0.018, 6, 18), 0x2a2f3a, { r: [Math.PI / 2, 0, 0], p: [x, 0.17, 0] });
      A.add(torus(0.205, 0.018, 6, 18), 0x2a2f3a, { r: [Math.PI / 2, 0, 0], p: [x, -0.1, 0] });
      A.add(cyl(0.19, 0.19, 0.03, 18), mix(th.floatA, 0xffffff, 0.2), { p: [x, 0.265, 0] });
      // post
      A.add(cyl(0.055, 0.065, 1.7, 8), 0x7a5230, { p: [x, 1.05, 0] });
      A.add(sphere(0.085, 10, 8), 0xffc21a, { p: [x, 1.95, 0] });
    }
    // striped top beam
    A.add(cyl(0.07, 0.07, 2.0, 12), stripe, { r: [0, 0, Math.PI / 2], p: [0, 1.82, 0] });
    // cork floats along the top rope
    for (let i = 0; i < 6; i++) A.add(sphere(0.095, 10, 8), th.floatA, { p: [-0.78 + i * 0.312, 1.67, 0.1] });
    // lead weights along the bottom
    for (let i = 0; i < 8; i++) A.add(sphere(0.055, 8, 6), 0x5a6270, { p: [-0.86 + i * 0.245, 0.22, 0.02], s: [1, 1.2, 1] });
    A.add(cyl(0.022, 0.022, 1.86, 6), th.rope, { r: [0, 0, Math.PI / 2], p: [0, 0.2, 0] });
    // trapped fish
    const fish = (x, y, c1, c2, rot) => {
      A.add(sphere(0.12, 12, 8), c1, { p: [x, y, 0.09], s: [1.5, 0.7, 0.55], r: [0, 0, rot] });
      A.add(cone(0.08, 0.17, 4), c2, { p: [x + Math.cos(rot) * -0.2, y + Math.sin(rot) * -0.2, 0.09], r: [0, 0, rot - Math.PI / 2], s: [1, 1, 0.3] });
      A.add(sphere(0.022, 6, 5), 0x10131c, { p: [x + Math.cos(rot) * 0.13 + Math.sin(rot) * 0.03, y + Math.sin(rot) * 0.13, 0.15] });
    };
    fish(-0.42, 0.95, 0x39b6ff, 0x1f7fd0, 0.25);
    fish(0.38, 0.6, 0xffa23a, 0xe0701a, -0.3);
    // rope handles
    return { lit: A.geo(), glow: E.geo() };
  });
  const g = group('driftnet', { w: 2.2, h: 1.6, d: 0.3 });
  const sway = new THREE.Group(); g.add(sway);
  mesh(parts.lit, litMat(), sway);
  // the net itself: translucent lattice with a slight belly
  const netGeo = G('ob:netPlane', () => {
    const p = new THREE.PlaneGeometry(1.86, 1.5, 14, 8);
    const pos = p.attributes.position, uv = p.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + 0.93) / 1.86, v = (pos.getY(i) + 0.75) / 1.5;
      pos.setZ(i, 0.07 * Math.sin(u * Math.PI) * (0.4 + 0.6 * v) + 0.03 * Math.sin(u * 9) * (1 - v));
      uv.setXY(i, u * 7.5, v * 5.5);
    }
    p.computeVertexNormals();
    return p;
  });
  const netMat = cached('netmat:' + th.id, () => new THREE.MeshBasicMaterial({ map: netTex(), color: th.rope, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  const net = mesh(netGeo, netMat, sway, 0, 0.97, 0.0); net.renderOrder = 4;
  const f = foam(3.4, 1.1, 0.06, 'strip', 0.9, g);
  foam(0.95, 0.95, 0.06, 'ring', 0.9, g, 0.93, 0);
  foam(0.95, 0.95, 0.06, 'ring', 0.9, g, -0.93, 0);
  selfAnimate(g, (t) => {
    sway.position.y = Math.sin(t * 1.5) * 0.025;
    sway.rotation.z = Math.sin(t * 1.1) * 0.012;
    net.position.z = Math.sin(t * 1.8) * 0.025;
    f.scale.x = 1 + Math.sin(t * 1.7) * 0.03;
  });
  return g;
}

// ---------- hostile speedboat (mover, 2.0 wide x 3.4 long x 1.2 tall; the bow points at the player, +Z) ----------
function speedboat(th) {
  const parts = G('ob:boat:' + th.id, () => {
    const [hullC, trimC, darkC] = th.boat;
    const A = new Acc(), E = new Acc(), W = new Acc();
    // hull loft, stern (z = -1.7) to bow (z = +1.7)
    const rings = [];
    const T = 20;
    for (let i = 0; i <= T; i++) {
      const t = i / T, z = -1.7 + 3.4 * t;
      const u = Math.max(0, (t - 0.3) / 0.7);
      const w = t < 0.3 ? 0.92 + 0.08 * Math.sin((t / 0.3) * Math.PI / 2) : Math.max(0.04, Math.pow(1 - Math.pow(u, 1.7), 0.7));
      const D = 0.46 + 0.3 * Math.pow(t, 2.3);
      const K = 0.34 * (1 - sstep(0.3, 1.0, t));
      const ring = [], U = 10;
      for (let k = 0; k <= U; k++) {
        const ph = (Math.PI * k) / U, s = Math.pow(Math.sin(ph), 0.72);
        ring.push([-w * Math.cos(ph) * (1 + 0.06 * Math.sin(ph)), D - (D + K) * s, z]);
      }
      ring.push([w * 0.6, D + 0.05, z], [0, D + 0.075, z], [-w * 0.6, D + 0.05, z]);
      rings.push(ring);
    }
    const hull = loft(rings);
    A.add(hull, (x, y, z, nx, ny) => (ny > 0.55 ? 0xfff0d6 : y < 0.03 ? darkC : ny < -0.3 ? mix(darkC, hullC, 0.3) : hullC), { smooth: false });
    // gunwale tube + side stripe
    const edgeL = [], edgeR = [];
    for (let i = 1; i <= T; i += 1) {
      const t = i / T, z = -1.7 + 3.4 * t, u = Math.max(0, (t - 0.3) / 0.7);
      const w = t < 0.3 ? 0.92 + 0.08 * Math.sin((t / 0.3) * Math.PI / 2) : Math.max(0.04, Math.pow(1 - Math.pow(u, 1.7), 0.7));
      const D = 0.46 + 0.3 * Math.pow(t, 2.3);
      edgeL.push([-w, D + 0.02, z]); edgeR.push([w, D + 0.02, z]);
    }
    A.add(tube(edgeL, 0.035, 20, 6), trimC);
    A.add(tube(edgeR, 0.035, 20, 6), trimC);
    // hull side accent stripes (thin tubes slightly below the gunwale)
    const stL = edgeL.map(([x, y, z]) => [x * 1.005, y - 0.13, z]), stR = edgeR.map(([x, y, z]) => [x * 1.005, y - 0.13, z]);
    A.add(tube(stL, 0.022, 20, 5), 0xffc21a);
    A.add(tube(stR, 0.022, 20, 5), 0xffc21a);
    // foredeck cabin + windshield frame
    A.add(box(1.5, 0.1, 0.78), mix(darkC, 0x777777, 0.3), { p: [0, 0.6, 0.15], s: [1, 1, 1] });
    A.add(cyl(0.025, 0.025, 0.46, 6), 0xdfe6ee, { p: [-0.62, 0.84, 0.46], r: [-0.45, 0, 0] });
    A.add(cyl(0.025, 0.025, 0.46, 6), 0xdfe6ee, { p: [0.62, 0.84, 0.46], r: [-0.45, 0, 0] });
    A.add(cyl(0.025, 0.025, 1.3, 6), 0xdfe6ee, { p: [0, 1.04, 0.56], r: [0, 0, Math.PI / 2] });
    // seat + steering console
    A.add(box(0.9, 0.2, 0.42), 0x20242c, { p: [0, 0.74, -0.45] });
    A.add(box(0.8, 0.3, 0.3), 0x2f3647, { p: [0, 0.72, 0.15] });
    // engine cover + outboards
    A.add(box(0.9, 0.3, 0.62), darkC, { p: [0, 0.7, -1.25] });
    A.add(box(0.94, 0.06, 0.66), 0xffc21a, { p: [0, 0.87, -1.25] });
    for (const x of [-0.34, 0.34]) { A.add(box(0.26, 0.5, 0.2), 0x2a2f3a, { p: [x, 0.46, -1.84] }); A.add(cyl(0.05, 0.05, 0.6, 8), 0x2a2f3a, { p: [x, 0.0, -1.86] }); }
    // bow cleat + stem
    A.add(sphere(0.07, 8, 6), 0xffd34d, { p: [0, 0.86, 1.35] });
    // flag mast
    A.add(cyl(0.02, 0.02, 0.56, 6), 0x2a2f3a, { p: [0.5, 0.96, -1.4] });
    // glow: bow lights + console lamp
    E.add(sphere(0.07, 10, 8), 0xfff3b0, { p: [-0.2, 0.78, 1.28] });
    E.add(sphere(0.07, 10, 8), 0xfff3b0, { p: [0.2, 0.78, 1.28] });
    E.add(box(0.5, 0.025, 0.04), th.glow || 0xffc21a, { p: [0, 0.57, 1.0] });
    // glass
    const glass = new THREE.PlaneGeometry(1.22, 0.5);
    W.add(glass, 0x9fe3ff, { p: [0, 0.84, 0.46], r: [-0.45, 0, 0] });
    return { lit: A.geo(), glow: E.geo(), glass: W.geo() };
  });
  const g = group('speedboat', { w: 2.0, h: 1.2, d: 3.4 });
  const wake = foam(2.9, 5.2, 0.055, 'wake', 0.95, g);
  wake.rotation.y = Math.PI; wake.position.z = -3.0;
  const ring = foam(3.1, 5.0, 0.06, 'ring', 0.8, g);
  const hullG = new THREE.Group(); g.add(hullG);
  mesh(parts.lit, litMat(), hullG);
  mesh(parts.glow, glowMat(), hullG);
  const glass = mesh(parts.glass, cached('glass', () => new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })), hullG);
  glass.renderOrder = 4;
  // pirate crab henchman at the wheel
  const crab = new THREE.Group(); crab.position.set(0, 0.8, -0.42); crab.scale.setScalar(0.74); hullG.add(crab);
  const cp = G('ob:crab', () => {
    const C = new Acc();
    const shell = (x, y, z, nx, ny) => mix(0xb3201f, 0xff5a43, sstep(-0.3, 0.9, ny));
    C.add(sphere(0.3, 18, 12), shell, { s: [1.2, 0.78, 0.9], p: [0, 0.2, 0], smooth: true });
    for (const s of [-1, 1]) {
      C.add(cyl(0.02, 0.02, 0.2, 5), 0xc23a2c, { p: [s * 0.14, 0.52, 0.14] });
      C.add(sphere(0.07, 10, 8), 0xffffff, { p: [s * 0.14, 0.64, 0.15] });
      C.add(sphere(0.04, 8, 6), 0x10131c, { p: [s * 0.14, 0.64, 0.205] });
    }
    // bandana
    C.add(cyl(0.255, 0.3, 0.1, 18), 0x20242c, { p: [0, 0.34, 0], s: [1.2, 1, 0.9] });
    C.add(box(0.1, 0.06, 0.02), 0xffffff, { p: [0, 0.34, 0.28] });
    // grin
    C.add(box(0.2, 0.025, 0.02), 0x3a0d0d, { p: [0, 0.12, 0.28] });
    return C.geo();
  });
  mesh(cp, litMat(), crab);
  const claws = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.34, 0.25, 0.02); crab.add(arm);
    const ca = G('ob:claw', () => {
      const C = new Acc();
      C.add(cyl(0.035, 0.045, 0.3, 8), 0xe23c2a, { p: [0, 0.15, 0] });
      C.add(sphere(0.12, 12, 10), 0xff4a34, { p: [0, 0.34, 0.02], s: [1, 0.8, 0.8] });
      C.add(cone(0.05, 0.14, 6), 0xff4a34, { p: [-0.06, 0.46, 0.02], r: [0, 0, 0.4] });
      C.add(cone(0.05, 0.14, 6), 0xff4a34, { p: [0.06, 0.46, 0.02], r: [0, 0, -0.4] });
      return C.geo();
    });
    mesh(ca, litMat(), arm);
    claws.push(arm);
  }
  // pirate flag
  const flag = new THREE.Group(); flag.position.set(0.5, 1.2, -1.4); hullG.add(flag);
  const fg = G('ob:flag', () => {
    const F = new Acc();
    F.add(new THREE.PlaneGeometry(0.5, 0.34), 0x14161d, { p: [-0.25, -0.17, 0] });
    F.add(sphere(0.06, 8, 6), 0xffffff, { p: [-0.25, -0.15, 0.01], s: [1, 1, 0.1] });
    F.add(box(0.2, 0.025, 0.01), 0xffffff, { p: [-0.25, -0.24, 0.012], r: [0, 0, 0.5] });
    F.add(box(0.2, 0.025, 0.01), 0xffffff, { p: [-0.25, -0.24, 0.012], r: [0, 0, -0.5] });
    return F.geo();
  });
  mesh(fg, litDS(), flag);
  selfAnimate(g, (t) => {
    hullG.position.y = Math.sin(t * 2.4) * 0.03;
    hullG.rotation.set(Math.sin(t * 1.9) * 0.03 - 0.01, 0, Math.sin(t * 1.5 + 0.5) * 0.045);
    flag.rotation.y = Math.sin(t * 7) * 0.35;
    claws[0].rotation.z = -0.5 + Math.sin(t * 4.5) * 0.35;
    claws[1].rotation.z = 0.5 - Math.sin(t * 4.5 + 1.5) * 0.35;
    crab.rotation.y = Math.sin(t * 2.0) * 0.12;
    ring.scale.setScalar(1 + Math.sin(t * 3) * 0.03);
  });
  return g;
}

export function makeWaterObstacle(kind, world) {
  const th = themeOf(world);
  switch (kind) {
    case 'buoy': return th.frost ? iceFloe(th) : buoy(th);
    case 'mine': return mine(th);
    case 'sharkfin': return sharkfin(th);
    case 'rock': return th.frost ? iceberg(th) : rock(th);
    case 'driftnet': return driftnet(th);
    case 'speedboat': return speedboat(th);
    default: return th.frost ? iceFloe(th) : buoy(th);
  }
}

// ====================================================================================================================
// SKY OBSTACLES
// ====================================================================================================================
function balloon() {
  const parts = G('ob:balloon', () => {
    const A = new Acc(), E = new Acc(), T = new Acc(true);
    // envelope profile (r, y), smoothed with a spline
    const key = [[0.34, -0.74], [0.5, -0.62], [0.82, -0.34], [1.04, 0.06], [1.1, 0.42], [1.0, 0.86], [0.72, 1.2], [0.36, 1.36], [0.001, 1.4]];
    const pts = new THREE.SplineCurve(key.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(40).map((p) => [Math.max(0.001, p.x), p.y]);
    const cols = [0xff3b3b, 0xffffff, 0xffc21a, 0xffffff];
    A.add(latheOf(pts, 36), (x, y, z) => {
      if (y > 0.0 && y < 0.2) return 0x2d6bd8;
      if (y < -0.5) return 0x2d3447;
      return cols[Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 12) % 4];
    });
    // thin seams
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const seam = pts.filter((p, k) => k % 2 === 0).map(([r, y]) => [Math.cos(a) * (r + 0.006), y, Math.sin(a) * (r + 0.006)]);
      A.add(tube(seam, 0.009, 16, 3), 0xffffff);
    }
    // skirt + burner frame
    A.add(cyl(0.3, 0.36, 0.16, 18), 0x2d3447, { p: [0, -0.82, 0] });
    A.add(torus(0.3, 0.018, 6, 18), 0xb0b8c6, { r: [Math.PI / 2, 0, 0], p: [0, -0.9, 0] });
    // ropes
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) A.line([sx * 0.27, -0.9, sz * 0.27], [sx * 0.2, -1.2, sz * 0.2], 0.013, 0x7a5a38);
    // pennant on top
    A.add(cyl(0.012, 0.012, 0.2, 5), 0xdfe6ee, { p: [0, 1.46, 0] });
    A.add(new THREE.PlaneGeometry(0.24, 0.13), 0xff4d4d, { p: [0.12, 1.52, 0], side: 2 });
    // basket
    T.add(new THREE.CylinderGeometry(0.31, 0.25, 0.36, 4, 1, false, Math.PI / 4), 0xd49a5a, { p: [0, -1.38, 0], s: [1, 1, 1], r: [0, 0, 0] });
    T.add(torus(0.3, 0.03, 6, 4), 0x8a5a2b, { r: [Math.PI / 2, 0, Math.PI / 4], p: [0, -1.2, 0], s: [1.0, 1.0, 1] });
    // parcel in the basket (courier game)
    A.add(box(0.22, 0.2, 0.22), 0xffc21a, { p: [0.05, -1.14, 0.0], r: [0, 0.5, 0] });
    A.add(box(0.24, 0.04, 0.05), 0xe63946, { p: [0.05, -1.04, 0.0], r: [0, 0.5, 0] });
    // flame
    E.add(cone(0.1, 0.34, 10), (x, y) => mix(0xff8a1f, 0xffe27a, sstep(-0.98, -0.7, y)), { p: [0, -0.86, 0], smooth: true });
    return { lit: A.geo(), tex: T.geo(), glow: E.geo() };
  });
  const g = group('balloon', null); g.userData.size = { w: 2.2, h: 2.8, d: 2.2 };
  const sway = new THREE.Group(); g.add(sway);
  sway.scale.setScalar(0.92);
  mesh(parts.lit, litDS(), sway);
  mesh(parts.tex, texLit('wicker', wickerTex()), sway);
  const flame = mesh(parts.glow, glowMat(), sway);
  const fl = halo(0xffa23a, 1.1, 0.7, sway, 0, -0.85, 0);
  selfAnimate(g, (t) => {
    sway.rotation.z = Math.sin(t * 1.1) * 0.05;
    sway.rotation.x = Math.sin(t * 0.8 + 1) * 0.035;
    const k = 0.9 + 0.2 * Math.sin(t * 13) * Math.sin(t * 7.3);
    flame.scale.set(1, k, 1);
    fl.material.opacity = 0.5 + 0.25 * k;
  });
  return g;
}

function drone() {
  const parts = G('ob:drone', () => {
    const A = new Acc(), E = new Acc(), P = new Acc();
    const body = (x, y, z, nx, ny) => mix(0x232a3b, 0x56617c, sstep(-0.2, 1, ny));
    A.add(sphere(1, 24, 16), body, { s: [0.5, 0.2, 0.5], p: [0, 0.02, 0], smooth: true });
    A.add(sphere(1, 16, 10), (x, y, z, nx, ny) => mix(0xe9eef5, 0xffffff, ny), { s: [0.3, 0.1, 0.3], p: [0, 0.2, -0.04], smooth: true });
    // angry camera eye
    A.add(torus(0.15, 0.04, 8, 24), 0x151922, { p: [0, 0.02, 0.43] });
    A.add(cyl(0.15, 0.15, 0.06, 20), 0x0d1017, { r: [Math.PI / 2, 0, 0], p: [0, 0.02, 0.42] });
    E.add(sphere(0.095, 16, 12), 0xff3b2e, { p: [0, 0.02, 0.45], s: [1, 1, 0.5] });
    E.add(sphere(0.03, 8, 6), 0xffffff, { p: [-0.03, 0.05, 0.485] });
    A.add(box(0.2, 0.04, 0.05), 0x10131b, { p: [-0.12, 0.17, 0.44], r: [0, 0, -0.45] });
    A.add(box(0.2, 0.04, 0.05), 0x10131b, { p: [0.12, 0.17, 0.44], r: [0, 0, 0.45] });
    // arms + motor pods
    const h = 0.62;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      A.line([sx * 0.2, 0.0, sz * 0.2], [sx * h, 0.06, sz * h], 0.045, 0x2f3750);
      A.add(cyl(0.1, 0.12, 0.14, 14), 0xff6a2e, { p: [sx * h, 0.07, sz * h] });
      A.add(cyl(0.03, 0.03, 0.08, 6), 0x1a1e29, { p: [sx * h, 0.17, sz * h] });
      E.add(sphere(0.03, 6, 5), sz > 0 ? 0xff3b2e : 0x35e08a, { p: [sx * (h + 0.1), 0.0, sz * (h + 0.1)] });
    }
    // skids
    for (const sx of [-1, 1]) {
      A.add(cyl(0.025, 0.025, 0.8, 6), 0x1a1e29, { r: [Math.PI / 2, 0, 0], p: [sx * 0.34, -0.36, 0] });
      A.line([sx * 0.3, -0.05, 0.28], [sx * 0.34, -0.36, 0.28], 0.022, 0x1a1e29);
      A.line([sx * 0.3, -0.05, -0.28], [sx * 0.34, -0.36, -0.28], 0.022, 0x1a1e29);
    }
    // little payload bomb so it reads as dangerous
    A.add(sphere(0.17, 14, 10), 0x1a1e29, { p: [0, -0.2, 0.0] });
    A.add(cyl(0.025, 0.025, 0.12, 6), 0xc0392b, { p: [0, -0.02, 0] });
    // rotors
    P.add(box(0.74, 0.012, 0.075), 0x10131b, { p: [0, 0, 0] });
    P.add(box(0.075, 0.012, 0.74), 0x10131b, { p: [0, 0, 0], s: 1 });
    const D = new Acc();
    D.add(new THREE.CircleGeometry(0.4, 28).rotateX(-Math.PI / 2), 0xbfe6ff, { p: [0, 0, 0] });
    return { lit: A.geo(), glow: E.geo(), blade: P.geo(), disc: D.geo() };
  });
  const g = group('drone', null); g.userData.size = { w: 2.0, h: 1.2, d: 2.0 };
  const hover = new THREE.Group(); g.add(hover);
  hover.scale.setScalar(0.85);
  mesh(parts.lit, litMat(), hover);
  const gl = mesh(parts.glow, glowMat(), hover);
  const discMat = cached('discMat', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  const rotors = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const r = new THREE.Group(); r.position.set(sx * 0.62, 0.22, sz * 0.62); hover.add(r);
    mesh(parts.blade, litMat(), r);
    const d = mesh(parts.disc, discMat, r); d.position.y = 0.0; d.renderOrder = 4;
    rotors.push(r);
  }
  const eyeHalo = halo(0xff3b2e, 0.75, 0.8, hover, 0, 0.02, 0.55);
  void gl;
  selfAnimate(g, (t) => {
    hover.position.y = Math.sin(t * 2.2) * 0.07;
    hover.rotation.set(0.06 + Math.sin(t * 1.4) * 0.05, Math.sin(t * 0.9) * 0.12, Math.sin(t * 1.7 + 1) * 0.08);
    rotors.forEach((r, i) => { r.rotation.y = t * 38 * (i % 3 === 0 ? 1 : -1) + i; });
    eyeHalo.material.opacity = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 5));
  });
  return g;
}

function storm() {
  const parts = G('ob:storm', () => {
    const A = new Acc(), E = new Acc(), F = new Acc();
    const puffs = [
      [-1.0, -0.42, -0.05, 0.56], [-0.42, -0.58, 0.1, 0.6], [0.28, -0.6, 0.05, 0.62], [0.95, -0.42, -0.05, 0.54],
      [-0.82, 0.12, -0.12, 0.7], [0.0, 0.16, 0.1, 0.84], [0.86, 0.1, -0.1, 0.72],
      [-0.4, 0.78, -0.05, 0.56], [0.42, 0.78, -0.02, 0.54], [-1.18, -0.05, -0.1, 0.4], [1.2, -0.02, -0.12, 0.38],
    ];
    const col = (x, y, z, nx, ny) => mix(mix(0x2a2d4c, 0x4a5078, sstep(-0.9, 0.2, y)), 0x9aa4d6, sstep(-0.1, 0.95, ny) * 0.7);
    for (const [x, y, z, r] of puffs) A.add(sphere(r, 18, 12), col, { p: [x, y, z], s: [1, 0.88, 1], smooth: true });
    // angry face on the front puff
    for (const s of [-1, 1]) {
      F.add(sphere(0.15, 14, 10), 0xfff6c8, { p: [s * 0.3, 0.2, 0.93], s: [1, 1.15, 0.45] });
      F.add(sphere(0.07, 10, 8), 0x1a1830, { p: [s * 0.3 - s * 0.02, 0.17, 1.0], s: [1, 1.1, 0.5] });
      F.add(box(0.36, 0.075, 0.06), 0x1a1830, { p: [s * 0.3, 0.45, 0.88], r: [0, -s * 0.12, s * 0.45] });
    }
    F.add(torus(0.17, 0.04, 6, 16, Math.PI), 0x1a1830, { p: [0, -0.15, 0.93], r: [0, 0, 0], s: [1.2, 0.8, 0.6] });
    // lightning bolt (extruded zig-zag)
    const s = new THREE.Shape();
    s.moveTo(0.1, 0.5); s.lineTo(-0.12, 0.0); s.lineTo(0.0, 0.0); s.lineTo(-0.2, -0.55); s.lineTo(0.2, 0.08); s.lineTo(0.06, 0.08); s.lineTo(0.22, 0.5); s.closePath();
    const bolt = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
    bolt.translate(0, 0, -0.02);
    E.add(bolt, (x, y) => mix(0xffd23f, 0xffffff, sstep(-0.5, 0.5, y)), { smooth: true });
    return { lit: A.geo(), face: F.geo(), bolt: E.geo() };
  });
  const g = group('storm', null); g.userData.size = { w: 3.0, h: 2.4, d: 1.8 };
  const drift = new THREE.Group(); g.add(drift);
  drift.scale.setScalar(0.95);
  mesh(parts.lit, litMat(), drift);
  mesh(parts.face, cached('face', () => new THREE.MeshBasicMaterial({ vertexColors: true })), drift);
  const boltM = new THREE.Mesh(parts.bolt, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  boltM.position.set(0.55, -0.82, 0.8); boltM.scale.setScalar(1.0); drift.add(boltM);
  const flash = halo(0xdfe8ff, 3.6, 0, drift, 0, 0.1, 0.9);
  const bolt2 = halo(0xffe27a, 1.6, 0, drift, 0.5, -0.8, 0.9);
  const rainMat = cached('rainmat', () => new THREE.MeshBasicMaterial({ map: rainTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 }));
  const rain = [];
  for (const [x, rot] of [[-0.35, 0], [0.15, 1.1]]) {
    const m = mesh(G('ob:rainPlane', () => new THREE.PlaneGeometry(1.7, 0.78)), rainMat, drift, x, -0.88, 0.1); m.rotation.y = rot; m.renderOrder = 4;
    rain.push(m);
  }
  rainTex().repeat.set(1.7 / 0.78 * 0.6, 0.6);
  selfAnimate(g, (t) => {
    drift.position.y = Math.sin(t * 1.2) * 0.07;
    drift.position.x = Math.sin(t * 0.7) * 0.05;
    const f = (t * 0.45) % 1;
    const on = (f < 0.07 || (f > 0.12 && f < 0.17)) ? 1 : 0;
    boltM.visible = on > 0;
    flash.material.opacity = on * 0.55;
    bolt2.material.opacity = on * 0.9;
    rainTex().offset.y = -((t * 1.1) % 1);
  });
  return g;
}

function kite() {
  const parts = G('ob:kite', () => {
    const A = new Acc(), T = new Acc();
    // four coloured panels folded along the spine
    const top = [0, 0.82, 0], bot = [0, -0.5, 0], left = [-0.8, 0.2, 0], right = [0.8, 0.2, 0], cen = [0, 0.2, 0.14];
    const tri = (a, b, c, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
      g.computeVertexNormals();
      A.add(g, color);
    };
    tri(top, left, cen, 0xff3d8b); tri(top, cen, right, 0xffd23a);
    tri(left, bot, cen, 0x23c9ff); tri(cen, bot, right, 0xff7a1f);
    // frame
    const sp = 0.016;
    A.line(top, bot, sp, 0xffffff); A.line(left, right, sp, 0xffffff);
    for (const [a, b] of [[top, left], [left, bot], [bot, right], [right, top]]) A.line(a, b, 0.02, 0xffffff);
    A.add(torus(0.07, 0.022, 6, 14), 0xffd34d, { p: [0, 0.2, 0.15] });
    // tail string
    const path = [];
    for (let i = 0; i <= 8; i++) path.push([Math.sin(i * 0.9) * 0.08, -0.5 - i * 0.07, 0]);
    A.add(tube(path, 0.012, 16, 4), 0xffffff);
    // bow template
    const bow = new Acc();
    bow.add(cone(0.1, 0.16, 3), 0xffffff, { r: [0, 0, Math.PI / 2], p: [0.1, 0, 0], s: [1, 1, 0.3] });
    bow.add(cone(0.1, 0.16, 3), 0xffffff, { r: [0, 0, -Math.PI / 2], p: [-0.1, 0, 0], s: [1, 1, 0.3] });
    return { lit: A.geo(), bow: bow.geo() };
  });
  const g = group('kite', null); g.userData.size = { w: 1.6, h: 1.8, d: 0.3 };
  const swing = new THREE.Group(); g.add(swing);
  swing.scale.setScalar(0.87);
  mesh(parts.lit, litDS(), swing);
  const bows = [];
  const bowCols = [0xff3d8b, 0xffd23a, 0x23c9ff, 0xff7a1f];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group(); b.position.set(Math.sin((i * 2 + 1) * 0.9) * 0.08, -0.62 - i * 0.14, 0); swing.add(b);
    const m = mesh(parts.bow, cached('bowm' + i, () => new THREE.MeshLambertMaterial({ color: bowCols[i], side: THREE.DoubleSide })), b);
    void m;
    bows.push(b);
  }
  selfAnimate(g, (t) => {
    swing.rotation.set(-0.12 + Math.sin(t * 1.3) * 0.06, Math.sin(t * 0.9) * 0.25, Math.sin(t * 1.6) * 0.14);
    bows.forEach((b, i) => { b.rotation.z = Math.sin(t * 4 + i * 0.9) * 0.5; b.rotation.y = Math.sin(t * 3 + i) * 0.6; });
  });
  return g;
}

export function makeSkyObstacle(kind) {
  switch (kind) {
    case 'balloon': return balloon();
    case 'drone': return drone();
    case 'storm': return storm();
    case 'kite': return kite();
    default: return balloon();
  }
}

// ====================================================================================================================
// FLIGHT RING
// ====================================================================================================================
export function makeRing(color = 0xffd34d) {
  const col = new THREE.Color(color);
  const key = 'ring:' + col.getHexString();
  const parts = G('ob:' + key, () => {
    const A = new Acc(), E = new Acc();
    const hi = mix(color, 0xffffff, 0.55);
    A.add(torus(1.46, 0.145, 14, 72), (x, y) => (Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI / 12)) % 2 ? color : hi), {});
    // inner bright core line
    E.add(torus(1.46, 0.055, 8, 72), 0xffffff, { p: [0, 0, 0.1] });
    // 8 arrow chevrons on the inner side pointing "forward" (-z)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      E.add(cone(0.09, 0.3, 4), hi, { p: [Math.cos(a) * 1.26, Math.sin(a) * 1.26, -0.02], r: [-Math.PI / 2, 0, 0], s: [1, 1, 0.5] });
    }
    return { lit: A.geo(), glow: E.geo() };
  });
  const g = group('ring', null);
  g.userData.radius = 1.6;
  const ringMat = cached(key, () => new THREE.MeshLambertMaterial({ vertexColors: true, emissive: color, emissiveIntensity: 0.55 }));
  mesh(parts.lit, ringMat, g);
  const e = mesh(parts.glow, glowMat(), g);
  e.rotation.set(0, 0, 0);
  const glowMatR = cached(key + 'g', () => new THREE.MeshBasicMaterial({ map: ringGlowTex(), color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const gp = mesh(G('ob:ringGlowPlane', () => new THREE.PlaneGeometry(4.5, 4.5)), glowMatR, g, 0, 0, 0);
  gp.renderOrder = 6;
  // speed tunnel: faint ghost rings trailing toward the player
  const ghostM = [0.32, 0.16].map((o, i) => cached(key + 'gh' + i, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending })));
  [0.45, 0.95].forEach((z, i) => {
    const m = mesh(G('ob:ghost' + i, () => torus(1.46 - i * 0.04, 0.05, 6, 56)), ghostM[i], g, 0, 0, z);
    m.renderOrder = 6;
  });
  return g;
}

// ====================================================================================================================
// DOCK (pier ramp) and GAP EDGE (broken bridge)
// ====================================================================================================================
function plankTex(th) {
  return ctex('plank:' + th.id, 512, 512, (g, w, h) => {
    const r = rng(7 + th.id.length * 31 + th.id.charCodeAt(0));
    const rows = 4, ph = h / rows;
    for (let i = 0; i < rows; i++) {
      const joint = (0.28 + r() * 0.44) * w;
      for (const [x0, x1] of [[0, joint], [joint, w]]) {
        g.fillStyle = hex(mix(th.wood[1], th.wood[0], 0.25 + r() * 0.75));
        g.fillRect(x0, i * ph, x1 - x0, ph);
        for (let k = 0; k < 13; k++) {
          const yy = i * ph + 8 + r() * (ph - 16);
          g.strokeStyle = r() < 0.6 ? `rgba(40,20,0,${0.06 + r() * 0.12})` : `rgba(255,240,210,${0.07 + r() * 0.1})`;
          g.lineWidth = 1 + r() * 1.6;
          g.beginPath(); g.moveTo(x0, yy);
          for (let x = x0; x <= x1; x += 24) g.lineTo(x, yy + Math.sin(x * 0.03 + k) * 1.6);
          g.stroke();
        }
        if (r() < 0.5) {
          const kx = x0 + 30 + r() * (x1 - x0 - 60), ky = i * ph + ph * (0.3 + r() * 0.4);
          g.fillStyle = 'rgba(40,20,0,0.35)'; g.beginPath(); g.ellipse(kx, ky, 7, 4, 0, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(40,20,0,0.2)'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(kx, ky, 12, 7, 0, 0, TAU); g.stroke();
        }
        // nails near both ends
        g.fillStyle = 'rgba(30,25,25,0.7)';
        for (const nx of [x0 + 14, x1 - 14]) for (const ny of [0.3, 0.7]) { g.beginPath(); g.arc(nx, i * ph + ph * ny, 2.4, 0, TAU); g.fill(); }
        g.fillStyle = 'rgba(25,12,0,0.6)'; g.fillRect(x0, i * ph, 3, ph);
      }
      g.fillStyle = 'rgba(25,12,0,0.62)'; g.fillRect(0, i * ph, w, 5);
      g.fillStyle = 'rgba(255,240,210,0.18)'; g.fillRect(0, i * ph + 5, w, 4);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, i * ph + ph - 6, w, 6);
    }
    if (th.snow) {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 8 + r() * 16, 3 + r() * 5, 0, 0, TAU); g.fill(); }
    }
    if (th.moss) {
      g.fillStyle = 'rgba(70,130,50,0.45)';
      for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 8 + r() * 18, 3 + r() * 6, 0, 0, TAU); g.fill(); }
    }
  }, true);
}

function dockBuild(th, kind) {
  const L = 6, W = 8.6, drop = 0.55, enter = kind === 'enter';
  const prof = (u) => Math.pow(u, 1.5);
  const yAt = (d) => (enter ? -drop * prof(d / L) : -drop * prof(1 - d / L));
  const slope = Math.atan2(drop, L) * (enter ? -1 : 1);
  const A = new Acc(), E = new Acc();
  // deck surface (textured strip)
  const segs = 12, pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const d = (L * i) / segs, y = yAt(d);
    pos.push(-W / 2, y, -d, W / 2, y, -d);
    uv.push(0, d / 1.2, 2, d / 1.2);
    if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  deck.setIndex(idx);
  deck.computeVertexNormals();
  const T = new Acc(true);
  T.add(deck, 0xffffff);
  const dark = mix(th.wood[1], 0x000000, 0.35);
  // side fascia + stringers under the deck (follow the slope)
  const beamLen = Math.hypot(L, drop);
  const midY = (yAt(0) + yAt(L)) / 2;
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) A.add(box(0.14, 0.34, beamLen), dark, { p: [x, midY - 0.18, -L / 2], r: [slope, 0, 0] });
  for (const x of [-2.9, -1.45, 0, 1.45, 2.9]) A.add(box(0.2, 0.26, beamLen), mix(dark, 0x000000, 0.2), { p: [x, midY - 0.2, -L / 2], r: [slope, 0, 0] });
  // thick cross beams hanging below the deck where it dives under the water
  for (let i = 0; i < 3; i++) { const d = 0.8 + i * 2.4; A.add(box(W - 0.2, 0.18, 0.22), mix(dark, 0x000000, 0.1), { p: [0, yAt(d) - 0.22, -d] }); }
  // pilings along both edges
  const postDs = [0.35, 2.9, 5.55];
  const waterY = -0.12;
  for (const sx of [-1, 1]) {
    postDs.forEach((d, pi) => {
      const x = sx * (W / 2 - 0.02), top = yAt(d) + (pi === 1 ? 0.95 : 1.15);
      const bottom = -1.3;
      A.add(cyl(0.15, 0.18, top - bottom, 12), (xx, yy) => (yy < waterY + 0.05 ? mix(th.pile, 0x1d3a2a, 0.5) : th.pile), { p: [x, (top + bottom) / 2, -d] });
      A.add(cyl(0.2, 0.2, 0.05, 12), mix(th.pile, 0x000000, 0.25), { p: [x, top - 0.04, -d] });
      A.add(sphere(0.17, 12, 8), th.snow ? 0xffffff : mix(th.pile, 0xffffff, 0.12), { p: [x, top + 0.03, -d], s: [1, th.snow ? 0.7 : 0.55, 1] });
      A.add(torus(0.17, 0.025, 6, 14), 0x30343c, { r: [Math.PI / 2, 0, 0], p: [x, yAt(d) + 0.3, -d] });
      if (pi !== 1) {
        // lantern
        A.add(cyl(0.025, 0.025, 0.2, 5), 0x30343c, { p: [x - sx * 0.02, top + 0.2, -d] });
        A.add(cyl(0.11, 0.14, 0.04, 8), 0x30343c, { p: [x, top + 0.32, -d] });
        A.add(cone(0.15, 0.12, 8), 0x30343c, { p: [x, top + 0.5, -d] });
        E.add(sphere(0.095, 12, 10), th.lampD, { p: [x, top + 0.4, -d], s: [1, 1.2, 1] });
      }
    });
    // ropes between posts
    for (let i = 0; i < postDs.length - 1; i++) {
      for (const [h, sag] of [[0.88, 0.1], [0.42, 0.06]]) {
        const pts = [];
        for (let k = 0; k <= 8; k++) {
          const u = k / 8, d = postDs[i] + (postDs[i + 1] - postDs[i]) * u;
          pts.push([sx * (W / 2 - 0.02), yAt(d) + h - sag * Math.sin(u * Math.PI), -d]);
        }
        A.add(tube(pts, 0.024, 14, 5), th.ropeD);
      }
    }
    // mooring bollard + crate pair on the deck near the start
    const bd = enter ? 1.2 : 4.7;
    A.add(cyl(0.11, 0.14, 0.3, 10), 0x2e333b, { p: [sx * (W / 2 - 0.45), yAt(bd) + 0.15, -bd] });
    A.add(sphere(0.14, 10, 6), 0x2e333b, { p: [sx * (W / 2 - 0.45), yAt(bd) + 0.31, -bd], s: [1, 0.6, 1] });
  }
  // lifebuoy on a post (left, inside face)
  {
    const d = postDs[1], cx = -W / 2 + 0.3, cy = yAt(d) + 0.62;
    A.add(torus(0.21, 0.075, 8, 24), (x, y, z) => (Math.floor((Math.atan2(y - cy, z + d) + Math.PI) / (Math.PI / 4)) % 2 ? 0xffffff : th.accent), { r: [0, Math.PI / 2, 0], p: [cx, cy, -d] });
  }
  // edge lights for neon
  if (th.glow) for (const sx of [-1, 1]) E.add(box(0.05, 0.05, beamLen), th.glow, { p: [sx * (W / 2 - 0.04), midY + 0.04, -L / 2], r: [slope, 0, 0] });
  // snow drifts along the edges
  if (th.snow) for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) {
    const d = 0.4 + i * 0.85;
    A.add(sphere(0.3, 8, 6), 0xffffff, { p: [sx * (W / 2 - 0.25), yAt(d) + 0.02, -d], s: [1, 0.3, 1.4 + (i % 3) * 0.3] });
  }
  if (th.moss) for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {
    const d = 0.5 + i * 1.0;
    A.add(sphere(0.22, 8, 6), mix(0x2f7d32, 0x6bc24a, (i % 3) / 2), { p: [sx * (W / 2 - 0.2), yAt(d) + 0.02, -d], s: [1, 0.3, 1.3] });
  }
  return { tex: T.geo(), lit: A.geo(), glow: E.geo(), yAt };
}

export function makeDock(world, kind = 'enter') {
  const th = themeOf(world);
  const k = kind === 'exit' ? 'exit' : 'enter';
  const parts = G(`ob:dock:${th.id}:${k}`, () => dockBuild(th, k));
  const g = new THREE.Group();
  g.userData = { kind: 'dock-' + k, length: 6, width: 8.6 };
  mesh(parts.tex, cached('dock:' + th.id, () => new THREE.MeshLambertMaterial({ map: plankTex(th), color: 0xffffff, vertexColors: true })), g);
  mesh(parts.lit, litMat(), g);
  if (parts.glow) mesh(parts.glow, glowMat(), g);
  // lantern glows
  for (const sx of [-1, 1]) for (const d of [0.35, 5.55]) {
    const top = parts.yAt(d) + 1.15;
    halo(th.lampD, 0.75, 0.42, g, sx * 4.28, top + 0.4, -d);
  }
  // foam: around the pilings where they meet the water + a wavy line where the deck dives under
  const wy = -0.12 + 0.02;
  for (const sx of [-1, 1]) for (const d of [0.35, 2.9, 5.55]) foam(1.4, 1.4, wy, 'ring', 0.9, g, sx * 4.28, -d);
  const dWater = k === 'enter' ? 0.2 * 6 : 6 - 0.2 * 6;
  foam(8.4, 0.9, wy, 'strip', 0.9, g, 0, -dWater);
  return g;
}

// ---------- broken bridge edge ----------
function gapBuild(th, seed) {
  const r = rng(seed);
  const W = 8.6, D = 2.5, THK = 0.13, pitch = 0.34, plankW = 0.3;
  const A = new Acc(), T = new Acc(true), E = new Acc();
  const dark = mix(th.gwood[1], 0x000000, 0.38);
  const fresh = 0xf0d4a0;
  const plankCol = () => mix(th.gwood[1], th.gwood[0], 0.2 + r() * 0.8);
  // One plank piece attached at xa, running to a splintered end at xb. `tilt` droops the free end.
  const piece = (row, xa, xb, tilt = 0, glow = false) => {
    const sC = row * pitch + pitch / 2, s0 = sC - plankW / 2, s1 = sC + plankW / 2, dir = Math.sign(xb - xa);
    const pts = [[xa, s0], [xb + dir * (r() - 0.5) * 0.12, s0]];
    const n = 4 + Math.floor(r() * 2);
    for (let j = 1; j < n; j++) {
      const out = j % 2 ? 0.22 + r() * 0.28 : -0.08 - r() * 0.2;
      pts.push([xb + dir * out, s0 + ((s1 - s0) * j) / n + (r() - 0.5) * 0.02]);
    }
    pts.push([xb + dir * (r() - 0.5) * 0.12, s1], [xa, s1]);
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0] - xa, pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0] - xa, pts[i][1]);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: THK, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    const u0 = r() * 3;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + xa) / 2.2 + u0, p.getZ(i) / 0.6);
    const col = plankCol(), tip = xb;
    T.add(g, (x, y, z, nx, ny) => (Math.abs(x - tip) < 0.3 && ny < 0.6 ? fresh : ny > 0.5 ? col : mix(col, 0x000000, 0.42)), { p: [xa, -THK + 0.0, 0], r: [0, 0, -dir * tilt] });
    if (glow) E.add(box(0.34, 0.03, 0.04), th.glow, { p: [xb + dir * 0.05, 0.02 - tilt * Math.abs(xb - xa) * 0.9, -sC], r: [0, 0, 0] });
  };
  const rows = Math.floor(D / pitch), solid = 3;
  for (let i = 0; i < solid; i++) {
    if (r() < 0.5) { const brk = -W / 2 + 2.6 + r() * 3.4; piece(i, -W / 2, brk - 0.015, 0); piece(i, W / 2, brk + 0.015, 0); } else piece(i, -W / 2, W / 2, 0);
  }
  for (let i = solid; i < rows; i++) {
    const k = i - solid, kk = rows - solid;
    const Ll = (W * (0.64 - 0.13 * k) + (r() - 0.5) * 1.8), Rl = Math.max(0.0, Math.min(W - Ll - 0.5, W * (0.2 + 0.5 * r()) * (1 - 0.15 * k) + (r() - 0.5) * 1.0));
    const tl = k >= 1 ? r() * 0.2 : r() * 0.05, tr = k >= 1 ? r() * 0.2 : r() * 0.05;
    if (!(k === kk - 1 && r() < 0.3) && Ll > 0.5) piece(i, -W / 2, -W / 2 + Ll, tl, !!th.glow);
    if (Rl > 0.7) piece(i, W / 2, W / 2 - Rl, tr, !!th.glow);
  }
  // side stringers and interior beams (splintered ends); the edge beams show from the high camera
  const beam = (x, len, hang = 0) => {
    A.add(box(0.3, 0.34, len), dark, { p: [x, -0.31, -len / 2], r: [hang * 0.2, 0, 0] });
    A.add(cone(0.2, 0.55, 4), mix(dark, 0xd9b27a, 0.5), { p: [x, -0.31, -len - 0.2], r: [-Math.PI / 2, Math.PI / 4, 0] });
  };
  beam(-4.0, 2.25); beam(4.0, 2.1); beam(-1.4, 1.5 + r() * 0.3); beam(1.5, 1.9 + r() * 0.3);
  // one beam snapped and hanging down into the gap
  A.add(box(0.28, 0.3, 1.1), dark, { p: [0.05, -0.62, -1.78], r: [0.62, 0, 0.03] });
  A.add(cone(0.18, 0.5, 4), mix(dark, 0xd9b27a, 0.5), { p: [0.05, -1.02, -2.2], r: [-Math.PI / 2 + 0.62, Math.PI / 4, 0] });
  // cross beams under the solid part
  for (const d of [0.4, 1.2]) A.add(box(W - 0.2, 0.2, 0.26), mix(dark, 0x000000, 0.2), { p: [0, -0.42, -d] });
  // falling debris
  for (let i = 0; i < 4; i++) A.add(box(0.34, 0.07, 0.12), plankCol(), { p: [-2.6 + i * 1.7 + r() * 0.5, -0.5 - r() * 0.5, -2.3 - r() * 0.2], r: [r() * 2, r() * 3, r() * 2] });
  // rails: posts on both sides, the last one snapped and bent outward; the rail itself broken and drooping
  const postZ = [-0.35, -1.45, -2.25];
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.12);
    postZ.forEach((z, pi) => {
      const bent = pi === 2, h = bent ? 0.72 : 1.0, tilt = bent ? sx * 0.5 : 0;
      A.add(cyl(0.08, 0.1, h, 8), mix(th.gwood[1], 0x000000, 0.1), { p: [x + Math.sin(tilt) * h * 0.5, (h / 2) * Math.cos(tilt) - 0.02, z], r: [0, 0, -tilt] });
      if (!bent) A.add(sphere(0.105, 10, 8), th.snow ? 0xffffff : mix(th.gwood[1], 0xffffff, 0.15), { p: [x, h - 0.01, z], s: [1, 0.6, 1] });
      else A.add(cone(0.08, 0.2, 5), fresh, { p: [x + Math.sin(tilt) * (h + 0.08), (h + 0.08) * Math.cos(tilt) - 0.02, z], r: [0, 0, -tilt] });
    });
    const railCol = th.glow ? mix(th.gwood[0], th.glow, 0.5) : th.gwood[0];
    A.add(cyl(0.055, 0.055, 1.1, 8), railCol, { p: [x, 0.9, (postZ[0] + postZ[1]) / 2], r: [Math.PI / 2, 0, 0] });
    A.add(cyl(0.055, 0.055, 1.0, 8), railCol, { p: [x + sx * 0.22, 0.62, -1.98], r: [Math.PI / 2 + 0.6, 0, sx * 0.3] });
    A.add(cone(0.055, 0.16, 5), fresh, { p: [x + sx * 0.27, 0.2, -2.38], r: [Math.PI / 2 + 0.6 + Math.PI, 0, sx * 0.3] });
    A.add(cyl(0.04, 0.04, 1.1, 6), mix(th.gwood[0], 0x000000, 0.2), { p: [x, 0.5, (postZ[0] + postZ[1]) / 2], r: [Math.PI / 2, 0, 0] });
  }
  // warning cones near the edge for readability
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.95), z = -0.6;
    A.add(cone(0.2, 0.55, 14), 0xff6d00, { p: [x, 0.27, z] });
    A.add(cyl(0.12, 0.15, 0.1, 14), 0xffffff, { p: [x, 0.3, z] });
    A.add(box(0.46, 0.04, 0.46), 0x222222, { p: [x, 0.02, z] });
  }
  // theme extras
  if (th.glow) {
    for (const x of [-4.0, 4.0, -1.4, 1.5]) E.add(box(0.06, 0.06, 1.4), th.glow, { p: [x, -0.12, -0.9] });
    for (let i = 0; i < 8; i++) E.add(sphere(0.045, 6, 5), i % 2 ? th.glow : th.accent, { p: [-3.4 + i * 0.95, 0.12 + r() * 0.4, -2.0 - r() * 0.5] });
  }
  if (th.snow) {
    for (let i = 0; i < 9; i++) A.add(sphere(0.3, 8, 6), 0xffffff, { p: [-3.8 + i * 0.95, 0.0, -(0.2 + r() * 1.3)], s: [1.2, 0.2, 0.8] });
    for (const x of [-3.3, -2.2, -0.4, 1.6, 2.6, 3.5]) A.add(cone(0.06, 0.45 + r() * 0.3, 6), 0xdff4ff, { p: [x, -0.35, -2.35], r: [Math.PI, 0, 0] });
  }
  if (th.moss) {
    for (const sx of [-1, 1]) A.add(tube([[sx * 4.1, 0.9, -1.0], [sx * 4.15, 0.5, -1.0], [sx * 4.05, 0.05, -1.0]], 0.022, 6, 4), 0x2f7d32);
    for (let i = 0; i < 8; i++) A.add(sphere(0.25, 8, 6), mix(0x2f7d32, 0x6bc24a, r()), { p: [-3.8 + r() * 7.6, 0.0, -r() * 1.6], s: [1, 0.2, 1] });
  }
  return { tex: T.geo(), lit: A.geo(), glow: E.geo() };
}

export function makeGapEdge(world, kind = 'start') {
  const th = themeOf(world);
  const k = kind === 'end' ? 'end' : 'start';
  const parts = G(`ob:gap:${th.id}:${k}`, () => gapBuild(th, k === 'end' ? 4242 : 1717));
  const g = new THREE.Group();
  g.userData = { kind: 'gap-' + k, depth: 2.5, width: 8.6 };
  const inner = new THREE.Group(); g.add(inner);
  mesh(parts.tex, cached('gapT:' + th.id, () => new THREE.MeshLambertMaterial({ map: grainTex(), vertexColors: true })), inner);
  mesh(parts.lit, litMat(), inner);
  if (parts.glow) mesh(parts.glow, glowMat(), inner);
  if (k === 'end') { inner.scale.z = -1; inner.position.z = -2.5; }
  return g;
}

// ====================================================================================================================
// WARNING SIGNS
// ====================================================================================================================
function diamondShape(D, c) {
  const P = [[0, D], [D, 0], [0, -D], [-D, 0]];
  const s = new THREE.Shape();
  const len = D * Math.SQRT2;
  for (let i = 0; i < 4; i++) {
    const p = P[i], pn = P[(i + 1) % 4], pp = P[(i + 3) % 4];
    const a = [p[0] + (pp[0] - p[0]) * (c / len), p[1] + (pp[1] - p[1]) * (c / len)];
    const b = [p[0] + (pn[0] - p[0]) * (c / len), p[1] + (pn[1] - p[1]) * (c / len)];
    if (i === 0) s.moveTo(a[0], a[1]); else s.lineTo(a[0], a[1]);
    s.quadraticCurveTo(p[0], p[1], b[0], b[1]);
  }
  s.closePath();
  return s;
}
function signTex(kind) {
  return ctex('sign:' + kind, 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (kind === 'water') {
      // swimmer over waves
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(98, 100, 17, 0, TAU); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 17;
      g.beginPath(); g.moveTo(110, 122); g.quadraticCurveTo(150, 112, 176, 82); g.stroke();
      g.lineWidth = 15; g.beginPath(); g.moveTo(104, 122); g.quadraticCurveTo(84, 140, 52, 138); g.stroke();
      g.lineWidth = 14;
      for (const y of [160, 194]) {
        g.beginPath();
        for (let x = 38; x <= 218; x += 4) { const yy = y + Math.sin(((x - 38) / 180) * TAU * 1.5) * 9; if (x === 38) g.moveTo(x, yy); else g.lineTo(x, yy); }
        g.stroke();
      }
    } else {
      // broken bridge: two deck halves with a gap, falling arrow, water below
      g.fillStyle = '#16181f';
      g.beginPath(); g.moveTo(20, 122); g.lineTo(106, 122); g.lineTo(96, 136); g.lineTo(108, 150); g.lineTo(98, 160); g.lineTo(20, 160); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(236, 122); g.lineTo(150, 122); g.lineTo(160, 138); g.lineTo(148, 150); g.lineTo(158, 160); g.lineTo(236, 160); g.closePath(); g.fill();
      g.fillRect(38, 160, 20, 30); g.fillRect(198, 160, 20, 30);
      g.strokeStyle = '#d7263d'; g.lineWidth = 20;
      g.beginPath(); g.moveTo(128, 40); g.lineTo(128, 96); g.stroke();
      g.fillStyle = '#d7263d';
      g.beginPath(); g.moveTo(98, 90); g.lineTo(158, 90); g.lineTo(128, 130); g.closePath(); g.fill();
      g.strokeStyle = '#1670e8'; g.lineWidth = 11;
      g.beginPath();
      for (let x = 62; x <= 194; x += 4) { const yy = 204 + Math.sin(((x - 62) / 132) * TAU * 1.5) * 6; if (x === 62) g.moveTo(x, yy); else g.lineTo(x, yy); }
      g.stroke();
    }
  });
}
export function makeWarningSign(kind = 'water') {
  const gap = kind === 'gap';
  const parts = G('ob:sign:' + kind, () => {
    const A = new Acc(), E = new Acc(), P = new Acc();
    const poleCol = gap ? (x, y) => (Math.floor(y / 0.28) % 2 ? 0xe63946 : 0xffffff) : 0xcfd6e0;
    A.add(cyl(0.3, 0.36, 0.1, 16), 0x3a3f4a, { p: [0, 0.05, 0] });
    A.add(cyl(0.065, 0.065, 2.5, 10), poleCol, { p: [0, 1.3, -0.02] });
    A.add(cyl(0.12, 0.12, 0.05, 12), 0x2d323c, { p: [0, 0.12, -0.02] });
    // board: outer border + inner coloured panel (rounded diamond)
    const D = 0.76, cy = 1.98;
    const border = new THREE.ExtrudeGeometry(diamondShape(D, 0.17), { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 6 });
    A.add(border, gap ? 0x15171e : 0xffffff, { p: [0, cy, -0.02] });
    const inner = new THREE.ExtrudeGeometry(diamondShape(D - 0.1, 0.12), { depth: 0.02, bevelEnabled: false, curveSegments: 6 });
    P.add(inner, gap ? (x, y) => mix(0xffb800, 0xffe04a, sstep(cy - 0.6, cy + 0.6, y)) : (x, y) => mix(0x0a5fe8, 0x2a9cff, sstep(cy - 0.6, cy + 0.6, y)), { p: [0, cy, 0.075], smooth: true });
    // beacon housing
    A.add(cyl(0.09, 0.11, 0.1, 12), 0x2d323c, { p: [0, 2.66, -0.02] });
    A.add(cone(0.1, 0.07, 12), 0x2d323c, { p: [0, 2.86, -0.02] });
    E.add(sphere(0.095, 14, 10), 0xffa21a, { p: [0, 2.76, -0.02], s: [1, 1.1, 1] });
    return { lit: A.geo(), glow: E.geo(), panel: P.geo() };
  });
  const root = new THREE.Group();
  root.userData = { kind: 'sign-' + kind };
  const g = new THREE.Group(); g.scale.setScalar(1.3); root.add(g); // oversized so it reads from the gameplay camera
  mesh(parts.lit, cached('signLit', () => new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x222222 })), g);
  mesh(parts.panel, glowMat(), g);
  // blinking beacon (shared material -> animates every clone)
  const beacon = cached('beacon', () => {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true });
    m.onBeforeRender = () => { const k = 0.5 + 0.5 * Math.sin(now() * 7); m.color.setScalar(0.45 + 0.55 * k); };
    return m;
  });
  mesh(parts.glow, beacon, g);
  const sym = mesh(G('ob:signPlane', () => new THREE.PlaneGeometry(1.0, 1.0)), cached('signmat:' + kind, () => {
    const tex = signTex(kind);
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }), g, 0, 1.98, 0.105);
  sym.renderOrder = 3;
  const bh = halo(0xffa21a, 0.9, 0.9, g, 0, 2.76, 0.0);
  const bm = bh.material;
  bm.onBeforeRender = () => { bm.opacity = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(now() * 7)); };
  return root;
}
