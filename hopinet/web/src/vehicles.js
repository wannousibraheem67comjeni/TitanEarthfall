// vehicles.js - Hopinet rideable vehicles and the flying pirate airship boss (all procedural).
//
//  makeVehicle(kind, world)         car (open sports buggy) | boat (speedboat) | ship (toy cruise/pirate galleon) | plane (biplane)
//  animateVehicle(v, t, speed, ex)  wheels roll, props spin, hulls rock, flags flutter, smoke rises, wake streams
//  makeVehiclePickup(kind, world)   the vehicle parked on the track with a glowing ring, light beam and "get in" chevrons
//  makeBossAirship()                Captain Krab's flying pirate airship (seen from behind, stern toward +Z)
//  animateBossAirship(g, t, state)  idle sway, propellers, sails, cannon recoil/flash (firing), hit flash, defeat crash
//  prewarmVehicles(world)           optional: pre-build everything for a world (loading screen)
//
// Notes for the game code: the rider is attached to the vehicle root at userData.seat (feet position). The animated
// rig pivots about the seat point, so bank/pitch never shear the rider. Extra userData: kind, rig, inner, flags,
// accent (palette colour used), zFront/zRear (ship), deckNode (boss: attach Captain Krab here), pickup (bool).
//
// Static geometry is merged per material (vertex-coloured, with baked ambient-occlusion style shading) and cached per
// kind + world, so building a vehicle again costs only a handful of Mesh objects. Everything that animates (wheels,
// propellers, flags, smoke, wake) is a separate small mesh. Models face -Z, origin at the ground / water-line centre.
// The animated "rig" pivots around the rider's seat point, so a rider attached to the root group never drifts away.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { VEHICLES, WORLDS } from './config.js';
import { G, M, Basic, blobShadowTex, sparkTex } from './models.js';

// ====================================================================================================================
// small helpers
// ====================================================================================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const Z3 = [0, 0, 0];

// seeded random for texture generation only (never used per frame)
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
function mulHex(c, f) {
  const r = clamp(Math.round(((c >> 16) & 255) * f), 0, 255), g = clamp(Math.round(((c >> 8) & 255) * f), 0, 255), b = clamp(Math.round((c & 255) * f), 0, 255);
  return (r << 16) | (g << 8) | b;
}
function mixHex(a, b, t) {
  const ch = (s) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
function cdist(c1, c2) {
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255, r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
const satOf = (c) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return Math.max(r, g, b) - Math.min(r, g, b); };
// pick palette colours that contrast with `base` (saturated, distinct from each other)
function accents(world, base, n = 3) {
  const pal = (world && world.palette) || [0xff7a59, 0x5cc8ff, 0xffc14d];
  const ranked = pal.map((c) => ({ c, s: cdist(c, base) + satOf(c) * 0.9 })).sort((a, b) => b.s - a.s);
  const out = [];
  for (const r of ranked) { if (out.every((o) => cdist(o, r.c) > 70)) out.push(r.c); if (out.length >= n) break; }
  for (const r of ranked) { if (out.length >= n) break; if (!out.includes(r.c)) out.push(r.c); }
  while (out.length < n) out.push(out[0]);
  return out;
}

// ---------- cached primitive geometries (keys prefixed so they never clash with other modules) ----------
const bx = (w, h, d) => G(`vh:b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const rb = (w, h, d, r = 0.08, seg = 2) => G(`vh:rb${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r));
const cy = (rt, rbt, h, s = 14) => G(`vh:cy${rt},${rbt},${h},${s}`, () => new THREE.CylinderGeometry(rt, rbt, h, s));
const sp = (r, ws = 16, hs = 12) => G(`vh:sp${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const co = (r, h, s = 14) => G(`vh:co${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const tr = (r, t, rs = 8, ts = 24, arc = TAU) => G(`vh:tr${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const ca = (r, l, cs = 4, rs = 10) => G(`vh:ca${r},${l},${cs},${rs}`, () => new THREE.CapsuleGeometry(r, l, cs, rs));
const pl = (w, h, ws = 1, hs = 1) => G(`vh:pl${w},${h},${ws},${hs}`, () => new THREE.PlaneGeometry(w, h, ws, hs));

// ---------- canvas textures (own cache; models.js keeps its own) ----------
const texCache = new Map();
function ctex(key, w, h, draw) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

// ====================================================================================================================
// Bld: collects transformed geometry per material and merges it. Plain hex colours become vertex colours (with a
// baked "ambient occlusion" gradient so flat colours still look rounded and premium); a THREE.Material argument
// goes into its own bucket (emissive lights, glass, textured plates).
// ====================================================================================================================
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

let _vcMat = null;
function vcMat() {
  if (!_vcMat) _vcMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 26, specular: 0x242424 });
  return _vcMat;
}
let _vcMatte = null;
function vcMatte() {
  if (!_vcMatte) _vcMatte = new THREE.MeshLambertMaterial({ vertexColors: true });
  return _vcMatte;
}

const _nm = new THREE.Matrix3();
class Bld {
  constructor(ao, gain = 1) { this.ao = ao || { y0: 0, y1: 1.2, k: 0.7 }; this.gain = gain; this.buckets = new Map(); }
  // col: hex number (vertex colour) | THREE.Material.  p: [x,y,z]  r: [rx,ry,rz] | Quaternion  s: number | [sx,sy,sz]
  add(geo, col, p = Z3, r = Z3, s = 1, o = null) {
    if (r && r.isQuaternion) _q.copy(r); else _q.setFromEuler(_e.set(r[0], r[1], r[2], 'XYZ'));
    if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    _m4.compose(_p.set(p[0], p[1], p[2]), _q, _s);
    _nm.getNormalMatrix(_m4);
    const m = _m4.elements, nm = _nm.elements;
    const pa = geo.attributes.position.array, na = geo.attributes.normal.array;
    const n = geo.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const vc = typeof col === 'number';
    const mat = vc ? ((o && o.matte) ? vcMatte() : vcMat()) : col;
    const cols = vc ? new Float32Array(n * 3) : null;
    const uvs = (!vc && col.map && geo.attributes.uv) ? geo.attributes.uv.array.slice() : null;
    let cr = 1, cg = 1, cb = 1, a0 = 0, ai = 1, ak = 1, useAo = false;
    if (vc) {
      _c.setHex(col); cr = _c.r * this.gain; cg = _c.g * this.gain; cb = _c.b * this.gain;
      useAo = !(o && o.ao === false);
      const a = this.ao; a0 = a.y0; ai = 1 / (a.y1 - a.y0); ak = (o && o.k !== undefined) ? o.k : a.k;
    }
    for (let i = 0; i < n; i++) {
      const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
      const py = m[1] * x + m[5] * y + m[9] * z + m[13];
      pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      pos[i * 3 + 1] = py;
      pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const nx = na[i * 3], ny = na[i * 3 + 1], nz = na[i * 3 + 2];
      let ox = nm[0] * nx + nm[3] * ny + nm[6] * nz, oy = nm[1] * nx + nm[4] * ny + nm[7] * nz, oz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
      const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      ox /= l; oy /= l; oz /= l;
      nor[i * 3] = ox; nor[i * 3 + 1] = oy; nor[i * 3 + 2] = oz;
      if (vc) {
        let f = 1;
        if (useAo) {
          let t = (py - a0) * ai; t = t < 0 ? 0 : t > 1 ? 1 : t;
          f = ak + (1 - ak) * (t * t * (3 - 2 * t));
          f *= 1 + 0.07 * oy - (oy < -0.5 ? 0.18 : 0);
        }
        cols[i * 3] = cr * f; cols[i * 3 + 1] = cg * f; cols[i * 3 + 2] = cb * f;
      }
    }
    const key = vc ? ((o && o.matte) ? 'vcm' : 'vc') : col.uuid;
    let b = this.buckets.get(key);
    if (!b) { b = { mat, items: [] }; this.buckets.set(key, b); }
    b.items.push({ pos, nor, cols, uvs, idx: geo.index ? geo.index.array : null, n });
    return this;
  }
  // the same part mirrored across x = 0 (symmetric geometry only)
  mir(geo, col, p = Z3, r = Z3, s = 1, o = null) {
    this.add(geo, col, p, r, s, o);
    const r2 = r.isQuaternion ? r : [r[0], -r[1], -r[2]];
    return this.add(geo, col, [-p[0], p[1], p[2]], r2, s, o);
  }
  // tube between two points (optionally with round joints)
  tube(a, b, rad, col, seg = 8, joints = true, o = null) {
    _v1.set(a[0], a[1], a[2]); _v2.set(b[0], b[1], b[2]);
    const len = _v1.distanceTo(_v2);
    if (len < 1e-4) return this;
    _v3.subVectors(_v2, _v1).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, _v3);
    this.add(cy(rad, rad, 1, seg), col, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q, [1, len, 1], o);
    if (joints) { this.add(sp(rad, seg, 6), col, a, Z3, 1, o); this.add(sp(rad, seg, 6), col, b, Z3, 1, o); }
    return this;
  }
  build() {
    const out = [];
    for (const b of this.buckets.values()) {
      let nv = 0, ni = 0;
      for (const it of b.items) { nv += it.n; ni += it.idx ? it.idx.length : it.n; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
      const hasC = !!b.items[0].cols, hasUv = !!b.items[0].uvs;
      const cols = hasC ? new Float32Array(nv * 3) : null, uvs = hasUv ? new Float32Array(nv * 2) : null;
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const it of b.items) {
        pos.set(it.pos, vo * 3); nor.set(it.nor, vo * 3);
        if (hasC) cols.set(it.cols, vo * 3);
        if (hasUv && it.uvs) uvs.set(it.uvs, vo * 2);
        if (it.idx) for (let k = 0; k < it.idx.length; k++) idx[io++] = it.idx[k] + vo;
        else for (let k = 0; k < it.n; k++) idx[io++] = vo + k;
        vo += it.n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (hasC) geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      if (hasUv) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      out.push({ geo, mat: b.mat });
    }
    return out;
  }
}

const SK = new Map(); // static-build cache: key -> { parts, ... }
function addParts(parent, parts, castShadow = false) {
  const meshes = [];
  for (const { geo, mat } of parts) {
    const m = new THREE.Mesh(geo, mat);
    if (castShadow && mat.vertexColors) m.castShadow = true;
    parent.add(m); meshes.push(m);
  }
  return meshes;
}

// ---------- shared materials ----------
const glassMat = () => M(0xbfeaff, { opacity: 0.38, side: true });
const glassDark = () => M(0x16324a, { opacity: 0.62, side: true });
const lampWhite = () => Basic(0xfff6c8);
const lampRed = () => Basic(0xff3030);
const lampAmber = () => Basic(0xffb347);

// colour constants
const DK = 0x262b36, DK2 = 0x1a1d25, TIRE = 0x1c1f27, CHROME = 0xe3e8f0, STEEL = 0x8f9bad, CREAM = 0xfff3dc, WOOD = 0xb9854f, WOODD = 0x8a5a33, NAVY = 0x14304a;

// a flag: small subdivided plane whose far end flutters (per-instance geometry because vertices animate)
function makeFlag(w, h, color, segs = 6) {
  const geo = new THREE.PlaneGeometry(w, h, segs, 2);
  geo.translate(w / 2, 0, 0); // hoist edge at x = 0, flows toward +x (local), caller orients
  const m = new THREE.Mesh(geo, M(color, { side: true }));
  m.userData.flag = { w, h, segs, base: geo.attributes.position.array.slice() };
  return m;
}
function flutterFlag(m, t, amp = 0.12, speed = 9) {
  const f = m.userData.flag; if (!f) return;
  const pa = m.geometry.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = f.base[i * 3], y = f.base[i * 3 + 1];
    const k = x / f.w;
    pa.setZ(i, Math.sin(x * 5 - t * speed + y * 2) * amp * k * (0.4 + k));
    pa.setY(i, y + Math.sin(x * 3 - t * speed * 0.8) * amp * 0.25 * k);
  }
  pa.needsUpdate = true;
}

// extruded arch (mudguard) over a wheel: axis along X, spans the upper half of a circle in the YZ plane
function archGeo(rOut, rIn, width, arc = Math.PI) {
  return G(`vh:arch${rOut},${rIn},${width},${arc}`, () => {
    const s = new THREE.Shape();
    const a0 = (Math.PI - arc) / 2;
    s.absarc(0, 0, rOut, a0, a0 + arc, false);
    s.absarc(0, 0, rIn, a0 + arc, a0, true);
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 14 });
    g.translate(0, 0, -width / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });
}

// ====================================================================================================================
// rig plumbing: root -> rig (pivot at the seat) -> inner (offset back by -seat) -> model.
// ====================================================================================================================
function newVehicleRoot(kind, seat) {
  const root = new THREE.Group();
  root.name = 'vehicle-' + kind;
  const rig = new THREE.Group();
  rig.position.set(seat.x, seat.y, seat.z);
  const inner = new THREE.Group();
  inner.position.set(-seat.x, -seat.y, -seat.z);
  rig.add(inner); root.add(rig);
  root.userData = { kind, seat: { x: seat.x, y: seat.y, z: seat.z }, rig, inner, wheels: [], prop: null, flags: [], seatPivot: seat };
  return root;
}

// ====================================================================================================================
// Hull lofting (boat, ship, airship): a smooth hull from a few key stations [z, halfBeam, keelY, gunwaleY].
// The cross section is a rounded V (exponent p), bands are cut at absolute heights so stripes stay horizontal.
// ====================================================================================================================
function mkProfile(keys) {
  const n = keys.length;
  const m = keys.map((k, i) => {
    const a = keys[Math.max(0, i - 1)], c = keys[Math.min(n - 1, i + 1)];
    const dz = c[0] - a[0] || 1;
    return [(c[1] - a[1]) / dz, (c[2] - a[2]) / dz, (c[3] - a[3]) / dz];
  });
  const zmin = keys[0][0], zmax = keys[n - 1][0];
  const f = (z) => {
    z = clamp(z, zmin, zmax);
    let i = 0; while (i < n - 2 && z > keys[i + 1][0]) i++;
    const k0 = keys[i], k1 = keys[i + 1], h = k1[0] - k0[0], t = h > 0 ? (z - k0[0]) / h : 0;
    const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const o = [];
    for (let c = 1; c <= 3; c++) o.push(h00 * k0[c] + h10 * h * m[i][c - 1] + h01 * k1[c] + h11 * h * m[i + 1][c - 1]);
    return { z, hw: Math.max(0, o[0]), yk: Math.min(o[1], o[2] - 0.01), yd: o[2] };
  };
  f.zmin = zmin; f.zmax = zmax;
  return f;
}
const secX = (P, phi) => P.hw * Math.sin(phi);
const secY = (P, phi, p) => P.yk + (P.yd - P.yk) * (1 - Math.pow(Math.max(Math.cos(phi), 0), p));
function phiAtY(P, y, p) {
  const H = P.yd - P.yk;
  const h = clamp((y - P.yk) / H, 0, 1);
  return Math.acos(clamp(Math.pow(1 - h, 1 / p), 0, 1));
}
const linz = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
function gridGeo(rows, cols, pt, flip = false) {
  // pt(i, j) -> [x, y, z]; triangles (a,b,c),(b,d,c) with i = row (z), j = col
  const pos = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const q = pt(i, j); pos.set(q, (i * cols + j) * 3); }
  const idx = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// hull skin between two absolute heights (y0 null = through the keel); zs ascending
function hullBand(P, zs, y0, y1, p, seg = 5, flip = false) {
  const Ps = zs.map(P);
  const through = y0 === null;
  const cols = through ? seg * 2 + 1 : seg * 2 + 2;
  // left strip then right strip (if not through): columns 0..seg (left, bottom->top... order ascending phi)
  return gridGeo(zs.length, cols, (i, j) => {
    const q = Ps[i];
    const phi1 = phiAtY(q, y1, p);
    let phi;
    if (through) phi = lerp(-phi1, phi1, j / (cols - 1));
    else {
      const phi0 = phiAtY(q, y0, p);
      phi = j <= seg ? lerp(-phi1, -phi0, j / seg) : lerp(phi0, phi1, (j - seg - 1) / seg);
    }
    return [secX(q, phi), secY(q, phi, p), q.z];
  }, flip);
}
// the flat stern: fan from the centre, faces +z (covers the section from the keel up to y1)
function hullCap(P, z, p, y1, seg = 8) {
  const q = P(z);
  const phi1 = phiAtY(q, y1, p);
  const pos = [0, (q.yk + Math.min(y1, q.yd)) / 2, z], idx = [];
  for (let j = 0; j <= seg * 2; j++) { const phi = lerp(-phi1, phi1, j / (seg * 2)); pos.push(secX(q, phi), secY(q, phi, p), z); }
  for (let j = 0; j < seg * 2; j++) idx.push(0, j + 1, j + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// flat transom disc between two heights as a quad strip with straight edges (stern "mirror"), faces +z
function transomPanel(P, z, p, yA, yB, inset = 0, seg = 4) {
  const q = P(z);
  const rows = 2;
  const xa = secX(q, phiAtY(q, yA, p)) - inset, xb = secX(q, phiAtY(q, yB, p)) - inset;
  return gridGeo(rows, seg + 1, (i, j) => {
    const u = j / seg, y = i === 0 ? yA : yB, x = lerp(-1, 1, u) * (i === 0 ? xa : xb);
    return [x, y, z];
  }, true);
}
// deck surface (faces up) between z range
function deckStrip(P, zs, drop, inset, p, y = null) {
  return gridGeo(zs.length, 2, (i, j) => {
    const q = P(zs[i]);
    const yy = y === null ? q.yd - drop : y;
    const x = secX(q, phiAtY(q, yy, p)) - inset;
    return [j === 0 ? -x : x, yy, q.z];
  }, true);
}
// vertical inner bulwark wall facing the centre
function wallStrip(P, zs, side, drop, inset, p, y0 = null, hExtra = 0) {
  return gridGeo(zs.length, 2, (i, j) => {
    const q = P(zs[i]);
    const yb = y0 === null ? q.yd - drop : y0;
    const x = secX(q, phiAtY(q, yb, p)) - inset;
    return [side * x, j === 0 ? yb : q.yd + hExtra, q.z];
  }, side > 0);
}
// gunwale top cap (faces up)
function capStrip(P, zs, side, thick, p, rise = 0) {
  return gridGeo(zs.length, 2, (i, j) => {
    const q = P(zs[i]);
    const x = j === 0 ? q.hw - thick : q.hw;
    return [side * Math.max(0, x), q.yd + rise, q.z];
  }, side > 0);
}

// ====================================================================================================================
// CAR - open sports buggy
// ====================================================================================================================
function wheelGeo(kind, r, w, hubCol) {
  return G(`vh:wheel${kind},${r},${w},${hubCol}`, () => {
    const b = new Bld({ y0: -2, y1: 2, k: 1 });
    const nb = 14;
    // tyre body (axis along X)
    b.add(cy(r, r, w, 22), TIRE, Z3, [0, 0, Math.PI / 2], 1, { ao: false });
    // side bulge rounding
    for (const sx of [-1, 1]) b.add(tr(r - w * 0.12, w * 0.16, 8, 24), TIRE, [sx * w * 0.36, 0, 0], [0, Math.PI / 2, 0], 1, { ao: false });
    // chunky tread blocks
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * TAU;
      b.add(bx(w * 0.94, r * 0.16, r * 0.24), 0x12141a, [0, Math.cos(a) * (r + r * 0.03), Math.sin(a) * (r + r * 0.03)], [a, 0, 0], 1, { ao: false });
    }
    // rim + hub on both faces
    for (const sx of [-1, 1]) {
      b.add(cy(r * 0.66, r * 0.66, w * 0.12, 20), 0xcfd5df, [sx * w * 0.46, 0, 0], [0, 0, Math.PI / 2], 1, { ao: false });
      b.add(cy(r * 0.42, r * 0.5, w * 0.1, 18), hubCol, [sx * w * 0.5, 0, 0], [0, 0, Math.PI / 2], 1, { ao: false });
      b.add(cy(r * 0.16, r * 0.16, w * 0.16, 10), CHROME, [sx * w * 0.54, 0, 0], [0, 0, Math.PI / 2], 1, { ao: false });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.3;
        b.add(sp(r * 0.055, 6, 5), 0x6b7482, [sx * w * 0.53, Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3], Z3, 1, { ao: false });
      }
    }
    const parts = b.build();
    // single mesh geometry (all vertex coloured)
    return parts.length === 1 ? parts[0].geo : mergeGeometries(parts.map((p) => p.geo), false);
  });
}

function carStatic(world) {
  const key = 'car|' + world.id;
  let st = SK.get(key);
  if (st) return st;
  const B = VEHICLES.car.color;
  const [a1, a2, a3] = accents(world, B);
  const b = new Bld({ y0: 0.25, y1: 1.15, k: 0.6 }, world.night ? 1.45 : 1);
  const night = !!world.night;

  // ---- chassis & underbody
  b.add(rb(1.1, 0.16, 3.3, 0.07, 1), DK2, [0, 0.4, -0.05]);
  b.add(rb(1.0, 0.1, 1.0, 0.05, 1), STEEL, [0, 0.33, -1.45]);               // front skid plate
  for (const [x, z] of [[-0.8, -1.15], [0.8, -1.15], [-0.8, 1.1], [0.8, 1.1]]) b.add(cy(0.07, 0.07, 0.5, 8), STEEL, [x * 0.55, 0.5, z], [0, 0, Math.PI / 2]); // axle stubs
  // ---- tub (the main yellow shell)
  b.add(rb(1.26, 0.56, 2.45, 0.2), B, [0, 0.74, 0.1]);
  b.add(rb(1.22, 0.4, 1.3, 0.19), B, [0, 0.69, -1.26], [-0.1, 0, 0]);          // nose, sloping down
  b.add(rb(1.2, 0.2, 0.34, 0.09, 1), mulHex(B, 0.78), [0, 0.5, -1.86], [-0.05, 0, 0]);  // lower nose lip
  // hood scoop + vents
  b.add(rb(0.5, 0.12, 0.5, 0.05, 1), DK, [0, 0.95, -1.0], [-0.1, 0, 0]);
  b.add(rb(0.34, 0.04, 0.32, 0.02, 1), DK2, [0, 1.02, -1.0], [-0.1, 0, 0]);
  // racing stripe down the nose, cowl and engine cover
  b.add(rb(0.34, 0.03, 1.15, 0.015, 1), a1, [0, 0.905, -1.27], [-0.1, 0, 0], 1, { ao: false });
  // ---- cockpit (open tub): side walls, cowl, rear bulkhead, floor
  b.add(rb(0.62, 0.1, 1.5, 0.04, 1), DK2, [0, 0.58, 0.3]);                      // floor
  for (const sx of [-1, 1]) {
    b.add(rb(0.24, 0.62, 1.78, 0.11), B, [sx * 0.57, 0.8, 0.28]);               // side wall / door
    b.add(rb(0.12, 0.08, 1.6, 0.04, 1), a1, [sx * 0.5, 1.14, 0.28], Z3, 1, { ao: false }); // door top trim
    b.add(cy(0.17, 0.17, 0.04, 20), 0xffffff, [sx * 0.695, 0.82, 0.3], [0, 0, Math.PI / 2], 1, { ao: false }); // number disc
    b.add(cy(0.12, 0.12, 0.05, 20), a1, [sx * 0.7, 0.82, 0.3], [0, 0, Math.PI / 2], 1, { ao: false });
  }
  b.add(rb(1.24, 0.66, 0.5, 0.17), B, [0, 0.82, -0.72]);                         // cowl / dash
  b.add(rb(1.0, 0.06, 0.3, 0.025, 1), DK, [0, 1.17, -0.62], [0.2, 0, 0]);        // dash pad
  // steering wheel + column
  b.add(tr(0.2, 0.034, 8, 22), DK2, [0, 1.2, -0.28], [-0.9, 0, 0], 1, { ao: false });
  b.add(cy(0.032, 0.032, 0.4, 8), STEEL, [0, 1.06, -0.45], [-0.9, 0, 0]);
  b.add(cy(0.05, 0.05, 0.04, 10), a1, [0, 1.2, -0.28], [-0.9 + Math.PI / 2 * 0, 0, 0], 1, { ao: false });
  // bucket seat (cushion + low back + head pad) in contrasting navy with accent piping
  b.add(rb(0.7, 0.34, 0.66, 0.12), 0x2b3350, [0, 0.74, 0.5]);
  b.add(rb(0.7, 0.62, 0.15, 0.07), 0x2b3350, [0, 1.06, 0.88], [0.12, 0, 0]);
  b.add(rb(0.34, 0.2, 0.14, 0.06, 1), a2, [0, 1.46, 0.96], [0.12, 0, 0], 1, { ao: false });
  for (const sx of [-1, 1]) b.add(rb(0.05, 0.62, 0.16, 0.02, 1), a1, [sx * 0.3, 1.06, 0.86], [0.12, 0, 0], 1, { ao: false });
  // ---- engine deck & tail
  b.add(rb(1.26, 0.62, 0.95, 0.2), B, [0, 0.9, 1.32]);
  b.add(rb(0.34, 0.03, 1.0, 0.015, 1), a1, [0, 1.215, 1.32], Z3, 1, { ao: false });
  for (let i = 0; i < 4; i++) b.add(rb(0.62, 0.035, 0.07, 0.015, 1), DK2, [0, 1.225, 1.1 + i * 0.16], Z3, 1, { ao: false });
  b.add(rb(1.28, 0.2, 0.2, 0.08, 1), DK, [0, 0.58, 1.78]);                       // rear bumper
  b.add(rb(0.56, 0.2, 0.05, 0.025, 1), 0xf4f6fa, [0, 0.82, 1.82], Z3, 1, { ao: false }); // number plate
  b.add(rb(0.44, 0.06, 0.06, 0.02, 1), a1, [0, 0.82, 1.84], Z3, 1, { ao: false });
  for (const sx of [-1, 1]) {
    b.add(cy(0.095, 0.095, 0.4, 10), CHROME, [sx * 0.36, 0.56, 1.9], [Math.PI / 2, 0, 0]);          // exhaust tips
    b.add(cy(0.06, 0.06, 0.05, 10), DK2, [sx * 0.36, 0.56, 2.1], [Math.PI / 2, 0, 0], 1, { ao: false });
  }
  // ---- spoiler
  for (const sx of [-1, 1]) {
    b.add(rb(0.07, 0.3, 0.12, 0.03, 1), DK, [sx * 0.46, 1.3, 1.6]);
    b.add(rb(0.05, 0.24, 0.46, 0.03, 1), a1, [sx * 0.9, 1.48, 1.62], Z3, 1, { ao: false });                // end plates
  }
  b.add(rb(1.8, 0.055, 0.42, 0.025, 1), a1, [0, 1.44, 1.62], [0.08, 0, 0], 1, { ao: false });
  b.add(rb(1.8, 0.035, 0.1, 0.015, 1), 0xffffff, [0, 1.452, 1.45], [0.08, 0, 0], 1, { ao: false });
  // ---- front end
  b.add(rb(1.1, 0.12, 0.14, 0.05, 1), DK, [0, 0.52, -1.98]);                      // bumper
  b.add(rb(0.56, 0.26, 0.05, 0.04, 1), DK2, [0, 0.72, -1.9], [-0.1, 0, 0], 1, { ao: false }); // grille
  for (let i = 0; i < 3; i++) b.add(rb(0.5, 0.025, 0.04, 0.01, 1), STEEL, [0, 0.66 + i * 0.07, -1.93], [-0.1, 0, 0], 1, { ao: false });
  for (const sx of [-1, 1]) {
    b.add(tr(0.155, 0.03, 6, 18), CHROME, [sx * 0.43, 0.78, -1.86], [-0.1, 0, 0], 1, { ao: false });
    b.add(cy(0.14, 0.14, 0.05, 16), STEEL, [sx * 0.43, 0.78, -1.84], [Math.PI / 2 - 0.1, 0, 0], 1, { ao: false });
  }
  for (const sx of [-1, 1]) b.add(rb(0.1, 0.14, 2.0, 0.05, 1), DK, [sx * 0.64, 0.5, 0.15]);   // side skirts
  // ---- mudguards over the wheels (body colour), wheels sit inside
  const fw = [0.8, 0.5, -1.15, 0.5, 0.40], rw = [0.8, 0.56, 1.1, 0.56, 0.44];
  for (const [x, y, z, r, w] of [fw, rw]) {
    for (const sx of [-1, 1]) {
      b.add(archGeo(r + 0.15, r + 0.06, w + 0.1, Math.PI * 1.02), B, [sx * x, y, z]);
      
    }
  }
  // ---- roll cage (accent colour) with a rally light bar
  const cageR = 0.045;
  const tubeCol = a1;
  b.tube([-0.58, 1.1, 1.02], [-0.58, 2.0, 1.02], cageR, tubeCol, 8, true, { ao: false });
  b.tube([0.58, 1.1, 1.02], [0.58, 2.0, 1.02], cageR, tubeCol, 8, true, { ao: false });
  b.tube([-0.58, 2.0, 1.02], [0.58, 2.0, 1.02], cageR, tubeCol, 8, true, { ao: false });
  for (const sx of [-1, 1]) {
    b.tube([sx * 0.58, 2.0, 1.02], [sx * 0.58, 1.5, -0.5], cageR, tubeCol, 8, true, { ao: false });          // roof side bars
    b.tube([sx * 0.58, 1.95, 1.02], [sx * 0.5, 1.2, 1.7], cageR * 0.9, tubeCol, 8, true, { ao: false });        // rear stays
    b.tube([sx * 0.58, 1.5, -0.5], [sx * 0.58, 1.1, -0.5], cageR, tubeCol, 8, true, { ao: false });            // A pillar
    b.tube([sx * 0.58, 1.78, 0.28], [sx * 0.58, 1.1, 0.28], cageR * 0.85, tubeCol, 8, true, { ao: false });    // mid brace
  }
  b.tube([-0.58, 1.5, -0.5], [0.58, 1.5, -0.5], cageR, tubeCol, 8, true, { ao: false });
  b.add(rb(1.0, 0.13, 0.1, 0.04, 1), DK2, [0, 1.62, -0.56]);
  // windshield (low, tinted)
  const glass = glassMat();
  b.add(rb(1.1, 0.34, 0.03, 0.01, 1), glass, [0, 1.32, -0.5], [-0.5, 0, 0], 1);
  // lights (unlit emissive bucket)
  const lw = lampWhite(), lr = lampRed(), la = lampAmber();
  for (const sx of [-1, 1]) {
    b.add(cy(0.12, 0.12, 0.04, 16), lw, [sx * 0.43, 0.78, -1.86], [Math.PI / 2 - 0.1, 0, 0]);
    b.add(rb(0.34, 0.12, 0.06, 0.04, 1), lr, [sx * 0.5, 0.98, 1.74]);                // tail lights
    b.add(rb(0.12, 0.06, 0.05, 0.02, 1), la, [sx * 0.2, 0.98, 1.74]);                // indicator
  }
  for (let i = 0; i < 4; i++) b.add(cy(0.045, 0.045, 0.03, 10), lw, [-0.33 + i * 0.22, 1.62, -0.63], [Math.PI / 2, 0, 0]);
  if (night) {
    // neon underglow
    const ng = Basic(a1, { opacity: 0.9 });
    b.add(rb(1.1, 0.05, 2.9, 0.02, 1), ng, [0, 0.31, 0]);
    for (const sx of [-1, 1]) b.add(rb(0.04, 0.04, 2.4, 0.015, 1), Basic(a2), [sx * 0.64, 0.46, 0.1]);
  }
  st = { parts: b.build(), a1, a2, a3, B };
  SK.set(key, st);
  return st;
}

function buildCar(world) {
  const seat = { x: 0, y: 0.6, z: 0.5 };
  const g = newVehicleRoot('car', seat);
  const st = carStatic(world);
  const inner = g.userData.inner;
  addParts(inner, st.parts, true);
  // wheels (dynamic: separate meshes so they can roll / steer)
  const wheels = [];
  const defs = [[0.8, 0.5, -1.15, 0.5, 0.40, 'f'], [-0.8, 0.5, -1.15, 0.5, 0.40, 'f'], [0.8, 0.56, 1.1, 0.56, 0.44, 'r'], [-0.8, 0.56, 1.1, 0.56, 0.44, 'r']];
  for (const [x, y, z, r, w, k] of defs) {
    const m = new THREE.Mesh(wheelGeo('car', r, w, st.a2), vcMat());
    m.position.set(x, y, z); m.rotation.order = 'YXZ';
    m.userData = { r, front: k === 'f', side: Math.sign(x) };
    inner.add(m); wheels.push(m);
  }
  g.userData.wheels = wheels;
  // antenna with a pennant at the rear (flutters)
  const ant = new THREE.Mesh(G('vh:ant', () => new THREE.CylinderGeometry(0.012, 0.016, 1.2, 6)), M(0x20242c));
  ant.position.set(0.52, 1.98, 1.68); ant.rotation.z = -0.05; inner.add(ant);
  const flag = makeFlag(0.42, 0.22, st.a2);
  flag.position.set(0.53, 2.45, 1.69); // flows outward (+x), face-on to the follow camera
  inner.add(flag); g.userData.flags.push(flag);
  // blob shadow
  const sh = new THREE.Mesh(pl(2.5, 4.4), Basic(0x000000, { map: blobShadowTex(), opacity: 0.55 }));
  sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.02, 0); sh.renderOrder = -1;
  g.add(sh); g.userData.shadow = sh;
  if (world.night) {
    const glow = new THREE.Mesh(pl(3.2, 5.2), Basic(st.a1, { map: sparkTex(), opacity: 0.55, blend: true }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04; glow.renderOrder = -1; g.add(glow);
  }
  Object.assign(g.userData, { width: 2.0, length: 3.6, height: 2.1, hitHalfWidth: 0.95, hitLength: 3.6, accent: st.a1 });
  return g;
}

// ====================================================================================================================
// foam / wake ribbons (water vehicles)
// ====================================================================================================================
function foamTex() {
  const t = ctex('foam', 128, 256, (g, w, h) => {
    const r = rng32(11);
    for (let i = 0; i < 300; i++) {
      const x = r() * w, y = r() * h, rad = 3 + r() * 13, a = 0.2 + r() * 0.6;
      for (const oy of [-h, 0, h]) {
        const gr = g.createRadialGradient(x, y + oy, 0, x, y + oy, rad);
        gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y + oy, rad, 0, TAU); g.fill();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function foamMaterial(dir = 1, tint = 0xffffff) {
  const t = foamTex().clone();
  t.needsUpdate = true;
  t.userData = { dir };
  const m = new THREE.MeshBasicMaterial({ map: t, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: tint });
  m.userData.foam = t;
  return m;
}
// ribbon along a polyline in the XZ plane: pts [{x, z, w, a}] (half width, centre alpha); soft edges
function ribbonGeo(pts, y = 0.03, vScale = 0.22) {
  const n = pts.length;
  const pos = new Float32Array(n * 9), uv = new Float32Array(n * 6), col = new Float32Array(n * 12), idx = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const px = -dz, pz = dx;
    if (i > 0) v += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) * vScale;
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * p.w, o3 = (i * 3 + k) * 3;
      pos[o3] = p.x + px * off; pos[o3 + 1] = y; pos[o3 + 2] = p.z + pz * off;
      uv[(i * 3 + k) * 2] = k * 0.5; uv[(i * 3 + k) * 2 + 1] = v;
      const c4 = (i * 3 + k) * 4; col[c4] = col[c4 + 1] = col[c4 + 2] = 1; col[c4 + 3] = k === 1 ? p.a : 0;
    }
    if (i < n - 1) for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = a + 1, c = a + 3, d = c + 1; idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}
const stations = (z0, z1, n, bias = 1) => Array.from({ length: n + 1 }, (_, i) => z0 + (z1 - z0) * Math.pow(i / n, bias));

// ====================================================================================================================
// BOAT - speedboat
// ====================================================================================================================
let _boatP = null;
const boatP = () => _boatP || (_boatP = mkProfile([
  [-2.05, 0.0, 0.58, 0.74],
  [-1.85, 0.2, 0.32, 0.78],
  [-1.45, 0.52, 0.0, 0.76],
  [-0.9, 0.84, -0.2, 0.72],
  [-0.1, 0.98, -0.29, 0.68],
  [0.9, 1.0, -0.3, 0.68],
  [1.7, 0.95, -0.26, 0.72],
]));
const BOAT_PE = 0.9;

function boatStatic(world) {
  const key = 'boat|' + world.id;
  let st = SK.get(key);
  if (st) return st;
  const B = VEHICLES.boat.color;
  const [a1, a2, a3] = accents(world, B);
  const P = boatP(), pe = BOAT_PE;
  const Pin = (z) => { const q = P(z); return { z: q.z, hw: Math.max(0, q.hw - 0.07), yk: q.yk, yd: q.yd }; };
  const b = new Bld({ y0: -0.3, y1: 0.85, k: 0.62 }, world.night ? 1.45 : 1);
  const WH = 0xf6f8fc;
  const zs = stations(-2.05, 1.7, 34, 1.5);
  // ---- hull skin in horizontal bands
  b.add(hullBand(P, zs, null, -0.02, pe), 0x1b3d5e);
  b.add(hullBand(P, zs, -0.02, 0.09, pe), WH);
  b.add(hullBand(P, zs, 0.09, 0.34, pe), B);
  b.add(hullBand(P, zs, 0.34, 0.6, pe), a1, Z3, Z3, 1, { ao: false });
  b.add(hullBand(P, zs, 0.6, 9, pe), WH);
  b.add(hullCap(P, 1.7, pe, 9), B);
  // ---- decks, interior, gunwale
  const zsF = stations(-2.05, -0.74, 14, 1.4), zsC = linz(-0.74, 1.12, 10), zsR = linz(1.12, 1.7, 4), zsAll = stations(-2.05, 1.7, 30, 1.4);
  b.add(deckStrip(Pin, zsF, 0.05, 0, pe), 0xf1f4fa);                         // foredeck
  b.add(deckStrip(Pin, zsC, 0, 0, pe, 0.12), 0xc99a62);                      // cockpit floor (teak)
  for (let i = 0; i < 6; i++) b.add(bx(1.5, 0.004, 0.02), 0xa7774a, [0, 0.125, -0.5 + i * 0.28], Z3, 1, { ao: false }); // planks
  b.add(hullBand(Pin, zsC, 0.12, 9, pe, 5, true), mixHex(B, 0xffffff, 0.62));  // cockpit walls
  b.add(deckStrip(Pin, zsR, 0, 0, pe, 0.46), 0xe8ecf3);                        // rear sun deck
  b.add(hullBand(Pin, zsR, 0.46, 9, pe, 5, true), mixHex(B, 0xffffff, 0.62));
  b.add(rb(1.7, 0.36, 0.1, 0.03, 1), mixHex(B, 0xffffff, 0.5), [0, 0.3, 1.12]);
  for (const sd of [-1, 1]) b.add(capStrip(P, zsAll, sd, 0.075, pe), WH, Z3, Z3, 1, { ao: false });
  // ---- foredeck details
  b.add(rb(0.3, 0.05, 0.1, 0.02, 1), CHROME, [0, 0.76, -1.55]);               // bow cleat
  b.add(rb(0.22, 0.012, 1.0, 0.005, 1), a1, [0, 0.737, -1.35], [0.03, 0, 0], 1, { ao: false });  // deck stripe
  // ---- console, wheel, windshield
  b.add(rb(1.5, 0.42, 0.34, 0.12), mixHex(B, 0x223344, 0.35), [0, 0.52, -0.5]);
  b.add(rb(1.32, 0.05, 0.22, 0.02, 1), DK, [0, 0.74, -0.46], [0.15, 0, 0]);
  b.add(tr(0.19, 0.032, 8, 22), DK2, [0, 0.93, -0.28], [-1.0, 0, 0], 1, { ao: false });
  b.add(cy(0.03, 0.03, 0.34, 8), STEEL, [0, 0.82, -0.4], [-1.0, 0, 0]);
  b.add(cy(0.05, 0.05, 0.04, 10), a1, [0, 0.93, -0.28], [-1.0, 0, 0], 1, { ao: false });
  const gl = glassMat();
  b.add(rb(1.56, 0.54, 0.025, 0.01, 1), gl, [0, 0.99, -0.62], [0.46, 0, 0]);
  const wsT = [[-0.8, 0.7, -0.74], [0.8, 0.7, -0.74]], wsU = [[-0.78, 1.25, -0.5], [0.78, 1.25, -0.5]];
  for (let i = 0; i < 2; i++) b.tube(wsT[i], wsU[i], 0.03, CHROME, 8, true, { ao: false });
  b.tube(wsU[0], wsU[1], 0.032, CHROME, 8, true, { ao: false });
  b.tube([0, 0.7, -0.74], [0, 1.25, -0.5], 0.02, CHROME, 6, false, { ao: false });
  // ---- seats
  const SEAT = 0x2b3a5c;
  b.add(rb(1.08, 0.3, 0.7, 0.13), SEAT, [0, 0.27, 0.5]);
  b.add(rb(1.08, 0.5, 0.17, 0.08), SEAT, [0, 0.66, 0.88], [0.1, 0, 0]);
  b.add(rb(0.07, 0.5, 0.19, 0.03, 1), a1, [-0.3, 0.66, 0.87], [0.1, 0, 0], 1, { ao: false });
  b.add(rb(0.07, 0.5, 0.19, 0.03, 1), a1, [0.3, 0.66, 0.87], [0.1, 0, 0], 1, { ao: false });
  b.add(rb(1.4, 0.12, 0.5, 0.06, 1), CREAM, [0, 0.55, 1.4]);                 // sun pad cushion
  b.add(rb(1.4, 0.03, 0.08, 0.015, 1), a2, [0, 0.616, 1.4], Z3, 1, { ao: false });
  // ---- tow arch (chrome) with a lamp
  b.tube([-0.86, 0.66, 1.0], [-0.7, 1.62, 1.0], 0.04, CHROME, 8, true, { ao: false });
  b.tube([0.86, 0.66, 1.0], [0.7, 1.62, 1.0], 0.04, CHROME, 8, true, { ao: false });
  b.tube([-0.7, 1.62, 1.0], [0.7, 1.62, 1.0], 0.04, CHROME, 8, true, { ao: false });
  b.add(rb(0.2, 0.09, 0.1, 0.04, 1), a1, [0, 1.62, 0.96], Z3, 1, { ao: false });
  b.add(cy(0.07, 0.07, 0.05, 12), lampWhite(), [0, 1.62, 0.9], [Math.PI / 2, 0, 0]);
  // ---- outboard motor (dark cowl so it does not steal attention from the rider)
  const MOT = 0x66758f;
  b.add(rb(0.6, 0.14, 0.22, 0.05, 1), DK, [0, 0.69, 1.8]);
  b.add(rb(0.5, 0.52, 0.66, 0.2), MOT, [0, 0.86, 2.0]);
  b.add(rb(0.52, 0.1, 0.68, 0.045, 1), a1, [0, 0.8, 2.0], Z3, 1, { ao: false });
  b.add(rb(0.3, 0.07, 0.05, 0.02, 1), STEEL, [0, 0.96, 1.66], Z3, 1, { ao: false });
  b.add(rb(0.18, 1.0, 0.36, 0.07, 1), mulHex(STEEL, 1.1), [0, 0.1, 2.0]);
  b.add(sp(0.14, 10, 8), STEEL, [0, -0.36, 2.02], Z3, [0.8, 0.8, 1.9]);
  b.add(rb(0.04, 0.3, 0.34, 0.015, 1), STEEL, [0, -0.52, 2.05]);
  // ---- stern flagpole & bow nav lights
  b.tube([0.82, 0.7, 1.56], [0.82, 1.55, 1.56], 0.018, DK2, 6, false, { ao: false });
  b.add(sp(0.05, 8, 6), Basic(0xff3a3a), [-0.55, 0.74, -1.25]);
  b.add(sp(0.05, 8, 6), Basic(0x35ff7a), [0.55, 0.74, -1.25]);
  if (world.night) b.add(rb(1.2, 0.04, 3.3, 0.02, 1), Basic(a1, { opacity: 0.8 }), [0, 0.02, -0.1]);
  st = { parts: b.build(), a1, a2, a3, B };
  SK.set(key, st);
  return st;
}

function propGeo(r, blades = 3, col = 0x5a6270, hubCol = CHROME, tip = null) {
  return G(`vh:prop${r},${blades},${col},${hubCol},${tip}`, () => {
    const b = new Bld({ y0: -2, y1: 2, k: 1 });
    b.add(sp(r * 0.2, 10, 8), hubCol, [0, 0, 0.0], Z3, [1, 1, 1.5], { ao: false });
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * TAU;
      b.add(rb(r * 0.2, r * 0.9, r * 0.05, 0.015, 1), col, [Math.sin(a) * r * 0.5, Math.cos(a) * r * 0.5, 0], [0, 0, -a], 1, { ao: false });
      b.add(bx(r * 0.2, r * 0.18, r * 0.05), tip === null ? col : tip, [Math.sin(a) * r * 0.9, Math.cos(a) * r * 0.9, 0], [0, 0, -a], 1, { ao: false });
    }
    const parts = b.build();
    return parts.length === 1 ? parts[0].geo : mergeGeometries(parts.map((p) => p.geo), false);
  });
}

function hullWake(P, pe, o) {
  // returns { group, mats[] }: hull-hugging foam ring, V wake and propeller churn
  const g = new THREE.Group();
  g.position.y = 0.03;
  const mats = [];
  const { zBow, zStern, beam, ws = 1, len = 11 } = o;
  const ringMat = foamMaterial(1); mats.push(ringMat);
  for (const sd of [-1, 1]) {
    const pts = [];
    for (const z of stations(zStern, zBow + 0.2, 28, 1)) {
      const q = P(Math.max(z, zBow));
      const x0 = secX(q, phiAtY(q, 0.0, pe));
      const k = clamp((zStern - z) / (zStern - zBow), 0, 1);
      pts.push({ x: sd * (x0 + 0.08 * ws), z, w: (0.1 + 0.2 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) + (k > 0.7 ? 0.18 * (k - 0.7) / 0.3 : 0)) * ws, a: k > 0.985 ? 0 : 0.95 });
    }
    const m = new THREE.Mesh(ribbonGeo(pts, 0, 0.55 / ws), ringMat); m.renderOrder = 3; g.add(m);
  }
  const wakeMat = foamMaterial(-1); mats.push(wakeMat);
  for (const sd of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) { const k = i / 14; pts.push({ x: sd * (beam + k * 3.4 * ws), z: zStern + 0.05 + k * len, w: (0.35 + k * 1.1) * ws, a: 0.9 * (1 - k) * (1 - k * 0.3) }); }
    const m = new THREE.Mesh(ribbonGeo(pts, 0, 0.2 / ws), wakeMat); m.renderOrder = 3; g.add(m);
  }
  const churn = [];
  for (let i = 0; i <= 14; i++) { const k = i / 14; churn.push({ x: 0, z: zStern + 0.5 + k * len * 0.8, w: (0.55 + k * 0.9) * ws * (beam > 2 ? 2.2 : 1), a: 1.0 * (1 - k) }); }
  const cm = new THREE.Mesh(ribbonGeo(churn, 0.005, 0.22 / ws), wakeMat); cm.renderOrder = 3; g.add(cm);
  return { group: g, mats };
}

function buildBoat(world) {
  const seat = { x: 0, y: 0.14, z: 0.4 };
  const g = newVehicleRoot('boat', seat);
  const st = boatStatic(world);
  const inner = g.userData.inner;
  addParts(inner, st.parts, true);
  const prop = new THREE.Mesh(propGeo(0.34, 3, 0x6a7586, CHROME, st.a1), vcMat());
  prop.position.set(0, -0.38, 2.3);
  inner.add(prop);
  const prop2 = new THREE.Mesh(new THREE.CircleGeometry(0.4, 18), Basic(0xffffff, { opacity: 0.25 }));
  prop2.position.set(0, -0.38, 2.32); inner.add(prop2); g.userData.propBlur = prop2;
  const wk = hullWake(boatP(), BOAT_PE, { zBow: -2.05, zStern: 1.7, beam: 0.95 });
  g.add(wk.group);
  g.userData.foam = wk.mats.map((m) => m.userData.foam);
  g.userData.wake = wk.group;
  const flag = makeFlag(0.55, 0.28, st.a2);
  flag.position.set(0.82, 1.45, 1.56);
  inner.add(flag); g.userData.flags.push(flag);
  g.userData.prop = prop;
  Object.assign(g.userData, { width: 2.0, length: 4.2, height: 1.7, hitHalfWidth: 0.95, hitLength: 4.2, accent: st.a1 });
  return g;
}

// ====================================================================================================================
// SHIP - toy cruise ship / pirate galleon hybrid (7 m wide, 14 m long)
// ====================================================================================================================
let _shipP = null;
const shipP = () => _shipP || (_shipP = mkProfile([
  [-8.5, 0.0, 1.3, 2.35],
  [-8.0, 0.6, 0.6, 2.3],
  [-7.0, 1.6, -0.1, 1.95],
  [-5.5, 2.6, -0.65, 1.6],
  [-3.5, 3.25, -0.88, 1.34],
  [-1.0, 3.45, -0.92, 1.3],
  [1.5, 3.4, -0.92, 1.34],
  [3.8, 3.15, -0.85, 1.65],
  [5.5, 2.75, -0.7, 2.1],
]));
const SHIP_PE = 0.78;
const SHIP_DECK = 1.02;

function flagTex(c1, c2) {
  return ctex('flag' + c1 + c2, 128, 80, (g, w, h) => {
    g.fillStyle = hex(c1); g.fillRect(0, 0, w, h);
    g.fillStyle = hex(c2); g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.lineTo(w, h * 0.45); g.lineTo(w * 0.35, h); g.closePath(); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 9 : 20; g.lineTo(w * 0.3 + Math.cos(a) * r, h * 0.4 + Math.sin(a) * r); }
    g.closePath(); g.fill();
  });
}
function namePlateTex(text) {
  return ctex('name' + text, 512, 96, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a3f66'); gr.addColorStop(1, '#16243d');
    g.fillStyle = gr; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 22); g.fill();
    g.lineWidth = 7; g.strokeStyle = '#ffc83d'; g.stroke();
    g.fillStyle = '#ffd35a'; g.font = '900 62px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 4; g.shadowOffsetY = 3;
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

function shipStatic(world) {
  const key = 'ship|' + world.id;
  let st = SK.get(key);
  if (st) return st;
  const B = VEHICLES.ship.color;
  const [a1, a2, a3] = accents(world, B);
  const P = shipP(), pe = SHIP_PE, DY = SHIP_DECK;
  const Pin = (z) => { const q = P(z); return { z: q.z, hw: Math.max(0, q.hw - 0.12), yk: q.yk, yd: q.yd }; };
  const b = new Bld({ y0: -0.9, y1: 3.6, k: 0.74 }, world.night ? 1.4 : 1);
  const GOLD = 0xffc83d, WH = 0xffffff;
  const zs = stations(-8.5, 5.5, 44, 1.25);
  // ---- hull
  b.add(hullBand(P, zs, null, -0.05, pe, 6), mulHex(B, 0.42));
  b.add(hullBand(P, zs, -0.05, 0.3, pe, 6), WH);
  b.add(hullBand(P, zs, 0.3, 1.0, pe, 6), B);
  b.add(hullBand(P, zs, 1.0, 1.12, pe, 4), GOLD, Z3, Z3, 1, { ao: false });
  b.add(hullBand(P, zs, 1.12, 9, pe, 6), WH);
  // strake (dark rub rail) and a1 band lower
  b.add(hullBand(P, zs, 0.52, 0.62, pe, 3), a1, Z3, Z3, 1, { ao: false });
  b.add(hullCap(P, 5.5, pe, 9, 10), mixHex(WOODD, 0x000000, 0.2));
  // ---- deck, bulwark, gunwale
  const zsD = stations(-7.95, 5.5, 30, 1.2);
  const NP = 9;
  for (let k = 0; k < NP; k++) {
    b.add(gridGeo(zsD.length, 2, (i, j) => {
      const q = Pin(zsD[i]);
      const x = secX(q, phiAtY(q, DY, pe)) - 0.03;
      return [lerp(-x, x, (k + j) / NP), DY, q.z];
    }, true), k % 2 ? 0xbf8c57 : 0xcc9a62);
  }
  b.add(hullBand(Pin, zsD, DY, 9, pe, 4, true), 0xa8744a);
  for (const sd of [-1, 1]) b.add(capStrip(P, zs, sd, 0.14, pe, 0.01), GOLD, Z3, Z3, 1, { ao: false });
  // stern closure cap on deck level: aft wall inner face is the transom itself (cap above)
  // ---- rails (white) with posts
  const zr = stations(-7.0, 5.3, 24, 1);
  for (const sd of [-1, 1]) {
    let prev = null, prev2 = null;
    zr.forEach((z, i) => {
      const q = P(z), x = sd * (q.hw - 0.1);
      const top = [x, q.yd + 0.72, z], mid = [x, q.yd + 0.38, z];
      if (prev) { b.tube(prev[0], top, 0.042, WH, 6, true, { ao: false }); b.tube(prev[1], mid, 0.03, WH, 6, false, { ao: false }); }
      if (i % 2 === 0) b.tube([x, q.yd, z], top, 0.04, WH, 6, true, { ao: false });
      prev = [top, mid];
    });
  }
  // stern rail across (single thin rail, kept low so the follow camera sees the rider)
  {
    const q = P(5.4);
    b.tube([-q.hw + 0.1, q.yd + 0.5, 5.4], [q.hw - 0.1, q.yd + 0.5, 5.4], 0.035, WH, 6, true, { ao: false });
    for (let i = -3; i <= 3; i++) { const x = i * (q.hw - 0.1) / 3; b.tube([x, q.yd, 5.4], [x, q.yd + 0.5, 5.4], 0.03, WH, 6, false, { ao: false }); }
  }
  // ---- stern transom decoration (faces +z)
  const sz = 5.53;
  b.add(rb(5.0, 1.5, 0.08, 0.03, 1), 0x5a3520, [0, 1.2, sz]);                                  // wooden panel
  b.add(rb(5.14, 0.1, 0.1, 0.03, 1), GOLD, [0, 1.98, sz + 0.01], Z3, 1, { ao: false });
  b.add(rb(5.14, 0.1, 0.1, 0.03, 1), GOLD, [0, 0.45, sz + 0.01], Z3, 1, { ao: false });
  for (const sx of [-1, 1]) b.add(rb(0.1, 1.64, 0.1, 0.03, 1), GOLD, [sx * 2.55, 1.22, sz + 0.01], Z3, 1, { ao: false });
  const winM = Basic(0xffd98a);
  for (let i = 0; i < 4; i++) {
    const x = -1.65 + i * 1.1;
    b.add(rb(0.84, 0.74, 0.07, 0.05, 1), GOLD, [x, 1.4, sz + 0.03], Z3, 1, { ao: false });
    b.add(rb(0.68, 0.58, 0.07, 0.05, 1), winM, [x, 1.4, sz + 0.06]);
    b.add(rb(0.05, 0.58, 0.075, 0.01, 1), 0x5a3520, [x, 1.4, sz + 0.07], Z3, 1, { ao: false });
    b.add(rb(0.68, 0.05, 0.075, 0.01, 1), 0x5a3520, [x, 1.4, sz + 0.07], Z3, 1, { ao: false });
  }
  b.add(pl(3.4, 0.64), Basic(0xffffff, { map: namePlateTex('HOPINET') }), [0, 0.8, sz + 0.06]);
  // rudder
  b.add(rb(0.12, 1.6, 0.9, 0.04, 1), 0x2b2f3a, [0, -0.1, 5.9]);
  // lanterns at the stern corners
  for (const sx of [-1, 1]) {
    b.tube([sx * 2.45, 2.0, 5.15], [sx * 2.45, 3.05, 5.15], 0.05, DK, 6, true, { ao: false });
    b.add(cy(0.2, 0.26, 0.42, 8), Basic(0xffd27a), [sx * 2.45, 3.27, 5.15]);
    b.add(co(0.3, 0.26, 8), GOLD, [sx * 2.45, 3.6, 5.15], Z3, 1, { ao: false });
  }
  // ---- helm: dais, pedestal, chair
  b.add(cy(1.05, 1.15, 0.28, 10), 0x9c6a3d, [0, DY + 0.14, 1.5]);
  b.add(cy(0.95, 0.95, 0.03, 10), 0xc99863, [0, DY + 0.29, 1.5], Z3, 1, { ao: false });
  b.add(rb(0.42, 1.0, 0.36, 0.1), 0x7a4a2a, [0, DY + 0.78, 0.55]);
  b.add(rb(0.5, 0.12, 0.44, 0.05, 1), GOLD, [0, DY + 1.34, 0.55], Z3, 1, { ao: false });
  b.add(cy(0.07, 0.07, 0.3, 8), GOLD, [0, DY + 1.0, 0.7], [Math.PI / 2, 0, 0], 1, { ao: false });
  // captain's chair
  b.add(rb(0.78, 0.34, 0.7, 0.12), 0x6f3f22, [0, DY + 0.46, 1.62]);
  b.add(rb(0.7, 0.14, 0.62, 0.07, 1), a1, [0, DY + 0.68, 1.6], Z3, 1, { ao: false });
  b.add(rb(0.78, 0.7, 0.14, 0.07), 0x6f3f22, [0, DY + 0.95, 2.0], [0.1, 0, 0]);
  b.add(rb(0.62, 0.5, 0.06, 0.05, 1), a1, [0, DY + 0.95, 1.93], [0.1, 0, 0], 1, { ao: false });
  // ---- cabin block with portholes / windows
  const cz = -3.1, cb = DY, ch = 1.5;
  b.add(rb(4.7, ch, 3.1, 0.34), CREAM, [0, cb + ch / 2, cz]);
  b.add(rb(4.76, 0.2, 3.16, 0.08, 1), a1, [0, cb + 0.5, cz], Z3, 1, { ao: false });
  b.add(rb(4.9, 0.16, 3.3, 0.08, 1), mulHex(CREAM, 0.86), [0, cb + ch + 0.05, cz]);
  const dk = Basic(0x1d3556);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const zz = cz - 1.0 + i * 1.0;
    b.add(rb(0.07, 0.5, 0.62, 0.04, 1), dk, [sx * 2.36, cb + 0.98, zz]);
    b.add(rb(0.05, 0.5, 0.1, 0.02, 1), Basic(0xfff3c8), [sx * 2.38, cb + 0.98, zz - 0.15]);
  }
  for (let i = 0; i < 3; i++) b.add(rb(0.9, 0.5, 0.07, 0.04, 1), dk, [-1.35 + i * 1.35, cb + 0.98, cz + 1.58]);   // rear windows toward the rider
  // bridge on top
  const bz = cz - 0.45;
  b.add(rb(3.3, 0.95, 1.7, 0.26), 0xf4ecd8, [0, cb + ch + 0.6, bz]);
  b.add(rb(3.0, 0.42, 0.06, 0.04, 1), dk, [0, cb + ch + 0.72, bz + 0.86]);
  b.add(rb(3.0, 0.42, 0.06, 0.04, 1), dk, [0, cb + ch + 0.72, bz - 0.86]);
  for (const sx of [-1, 1]) b.add(rb(0.06, 0.42, 1.2, 0.04, 1), dk, [sx * 1.66, cb + ch + 0.72, bz]);
  b.add(rb(3.6, 0.12, 2.0, 0.06, 1), a1, [0, cb + ch + 1.14, bz], Z3, 1, { ao: false });
  b.add(rb(3.4, 0.07, 1.8, 0.03, 1), mulHex(a1, 0.8), [0, cb + ch + 1.08, bz], Z3, 1, { ao: false });
  // funnel (raked) with bands and a black top
  const fz = cz + 0.85, fy = cb + ch + 0.15;
  b.add(cy(0.58, 0.68, 1.5, 16), a1, [0, fy + 0.75, fz], [-0.1, 0, 0], [1.0, 1, 1.15]);
  b.add(cy(0.6, 0.62, 0.22, 16), WH, [0, fy + 0.95, fz - 0.07], [-0.1, 0, 0], [1.0, 1, 1.15], { ao: false });
  b.add(cy(0.55, 0.58, 0.32, 16), DK2, [0, fy + 1.62, fz - 0.17], [-0.1, 0, 0], [1.0, 1, 1.15], { ao: false });
  b.add(cy(0.44, 0.44, 0.04, 16), 0x07080b, [0, fy + 1.8, fz - 0.2], [-0.1, 0, 0], [1.0, 1, 1.15], { ao: false });
  // lifeboats on davits (orange)
  for (const sd of [-1, 1]) for (const zz of [-3.9, -2.3]) {
    b.add(ca(0.38, 1.0, 4, 10), 0xff8a1f, [sd * 2.88, DY + 1.18, zz], [Math.PI / 2, 0, 0], [1, 1, 0.62]);
    b.add(rb(0.72, 0.07, 1.9, 0.03, 1), WH, [sd * 2.88, DY + 1.34, zz], Z3, 1, { ao: false });
    for (const dz of [-0.55, 0.55]) {
      b.tube([sd * 3.2, DY + 0.3, zz + dz], [sd * 3.2, DY + 1.95, zz + dz], 0.045, DK, 6, true, { ao: false });
      b.tube([sd * 3.2, DY + 1.95, zz + dz], [sd * 2.9, DY + 1.78, zz + dz], 0.04, DK, 6, true, { ao: false });
    }
  }
  // life rings
  for (const sd of [-1, 1]) for (const zz of [-0.4, 2.8]) {
    const q = P(zz);
    b.add(tr(0.27, 0.075, 8, 18), 0xff4a3a, [sd * (q.hw - 0.17), q.yd + 0.42, zz], [0, Math.PI / 2, 0], 1, { ao: false });
    b.add(tr(0.27, 0.078, 8, 18, 0.7), WH, [sd * (q.hw - 0.17), q.yd + 0.42, zz], [0, Math.PI / 2, 0.4], 1, { ao: false });
  }
  // cannons on the side decks
  for (const sd of [-1, 1]) for (const zz of [-0.45, 3.0]) {
    b.add(rb(0.62, 0.26, 0.9, 0.08, 1), 0x7a4a2a, [sd * 2.8, DY + 0.2, zz]);
    b.add(cy(0.15, 0.2, 1.05, 12), 0x2a2e38, [sd * 2.9, DY + 0.5, zz], [0, 0, Math.PI / 2]);
    b.add(cy(0.22, 0.22, 0.12, 12), 0x161820, [sd * 3.4, DY + 0.5, zz], [0, 0, Math.PI / 2]);
    for (const dz of [-0.28, 0.28]) b.add(cy(0.17, 0.17, 0.12, 10), 0x4a2f1a, [sd * 2.8, DY + 0.18, zz + dz], [0, 0, Math.PI / 2]);
  }
  // barrels / crates on the aft deck corners (centre stays clear for the rider's view)
  for (const [x, z, r] of [[-2.35, 4.5, 0.4], [-1.7, 4.85, 0.33], [2.35, 4.5, 0.4], [1.75, 4.8, 0.34]]) {
    b.add(cy(r, r * 0.92, r * 2, 12), 0x9a5b2c, [x, DY + r, z]);
    for (const hy of [0.45, 1.55]) b.add(cy(r * 1.02, r * 1.02, 0.07, 12), 0x3a3f4a, [x, DY + r * hy, z], Z3, 1, { ao: false });
  }
  b.add(rb(0.7, 0.7, 0.7, 0.05, 1), 0xc2874b, [-2.2, DY + 0.35, 3.7]);
  b.add(rb(0.6, 0.6, 0.6, 0.05, 1), 0xb5783d, [2.2, DY + 0.3, 3.65], [0, 0.4, 0]);
  b.add(tr(0.34, 0.09, 6, 16), 0xd8c9a0, [0.0, DY + 0.09, 4.7], [Math.PI / 2, 0, 0]);
  // mast with crow's nest and pennant pole
  const mz = -6.2;
  b.tube([0, DY, mz], [0, DY + 5.0, mz], 0.14, 0x7a4a2a, 8, true, { ao: false });
  b.add(cy(0.55, 0.42, 0.4, 12), 0x8a5a33, [0, DY + 4.0, mz]);
  b.add(tr(0.52, 0.05, 6, 14), GOLD, [0, DY + 4.22, mz], [Math.PI / 2, 0, 0], 1, { ao: false });
  b.tube([-1.1, DY + 3.3, mz], [1.1, DY + 3.3, mz], 0.06, 0x7a4a2a, 6, true, { ao: false });
  b.add(sp(0.17, 10, 8), GOLD, [0, DY + 5.15, mz], Z3, 1, { ao: false });
  // bow ornaments
  b.add(cy(0.07, 0.07, 1.2, 6), DK, [0, 3.2, -8.1], [0.18, 0, 0]);
  b.add(sp(0.22, 10, 8), GOLD, [0, 2.7, -8.45], Z3, 1, { ao: false });
  for (const sd of [-1, 1]) {
    b.add(sp(0.26, 8, 6), 0x2b2f3a, [sd * 1.42, 1.1, -7.15]);                      // hawse pipes / anchors
    b.add(tr(0.2, 0.05, 6, 12), STEEL, [sd * 1.5, 0.8, -7.15], [0, Math.PI / 2, 0]);
    b.add(sp(0.09, 8, 6), Basic(sd < 0 ? 0xff3a3a : 0x35ff7a), [sd * 1.8, 2.15, -6.6]);
  }
  // rider-side lamps (warm light spill is faked with emissive bits)
  for (const sd of [-1, 1]) for (const zz of [-4.2, -2.0]) b.add(sp(0.1, 8, 6), Basic(0xfff1b8), [sd * 2.1, DY + 1.55, zz]);
  st = { parts: b.build(), a1, a2, a3, B };
  SK.set(key, st);
  return st;
}

function buildShip(world) {
  const seat = { x: 0, y: SHIP_DECK + 0.3, z: 1.5 };
  const g = newVehicleRoot('ship', seat);
  const st = shipStatic(world);
  const inner = g.userData.inner;
  addParts(inner, st.parts, true);
  const u = g.userData;
  // ship's wheel (turns with steering)
  const wheel = new THREE.Group();
  wheel.position.set(0, SHIP_DECK + 1.5, 0.84);
  const wb = new Bld({ y0: -2, y1: 2, k: 1 });
  wb.add(tr(0.42, 0.05, 8, 24), 0x8a5632, Z3, Z3, 1, { ao: false });
  wb.add(sp(0.1, 8, 6), 0xffc83d, Z3, Z3, 1, { ao: false });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    wb.tube([0, 0, 0], [Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0], 0.03, 0x8a5632, 6, false, { ao: false });
    wb.add(sp(0.045, 6, 5), 0xffc83d, [Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0], Z3, 1, { ao: false });
  }
  const wp = wb.build();
  wheel.add(new THREE.Mesh(wp.length === 1 ? wp[0].geo : mergeGeometries(wp.map((p) => p.geo), false), vcMat()));
  inner.add(wheel); u.helm = wheel;
  // smoke puffs from the funnel
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(sp(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: world.night ? 0xc9b8ff : 0xf2f4f8, transparent: true, opacity: 0.5, depthWrite: false }));
    m.userData.i = i; m.renderOrder = 4; inner.add(m); puffs.push(m);
  }
  u.puffs = puffs; u.funnelTop = new THREE.Vector3(0, SHIP_DECK + 1.5 + 0.15 + 1.85, -3.1 + 0.85 - 0.2);
  // flags: two stern poles (outside the rider's line of sight) + mast pennant + bow jack
  for (const sd of [-1, 1]) {
    const pole = new THREE.Mesh(G('vh:pole1', () => new THREE.CylinderGeometry(0.03, 0.04, 2.0, 6)), M(0x4a2f1a));
    pole.position.set(sd * 1.55, 3.15, 5.2); inner.add(pole);
    const f1 = makeFlag(1.1, 0.7, 0xffffff); f1.material = new THREE.MeshLambertMaterial({ map: flagTex(sd < 0 ? st.a2 : st.a1, sd < 0 ? st.a1 : st.a2), side: THREE.DoubleSide });
    f1.position.set(sd * 1.55 + (sd < 0 ? 0 : 0), 3.75, 5.2); if (sd < 0) { f1.scale.x = -1; }
    inner.add(f1); u.flags.push(f1);
  }
  const f2 = makeFlag(1.1, 0.55, st.a1);
  f2.position.set(0.02, SHIP_DECK + 4.85, -6.2); inner.add(f2); u.flags.push(f2);
  const f3 = makeFlag(0.7, 0.32, st.a2);
  f3.position.set(0.02, 3.2, -8.1); f3.rotation.y = Math.PI; inner.add(f3); u.flags.push(f3);
  // wake
  const wk = hullWake(shipP(), SHIP_PE, { zBow: -8.5, zStern: 5.5, beam: 2.7, ws: 1.8, len: 24 });
  g.add(wk.group);
  u.foam = wk.mats.map((m) => m.userData.foam); u.wake = wk.group;
  Object.assign(u, { width: 7.0, length: 14, height: 5.2, hitHalfWidth: 3.3, hitLength: 14, zFront: -8.5, zRear: 5.5, accent: st.a1 });
  return g;
}

// ====================================================================================================================
// PLANE - propeller biplane with an open cockpit (7 m wingspan, 5.5 m long); origin = wheel contact point
// ====================================================================================================================
function wingGeo(span, chord, thick, tipR) {
  return G(`vh:wing${span},${chord},${thick},${tipR}`, () => {
    const hs = span / 2, c = chord / 2, r = tipR;
    const sh = new THREE.Shape();
    sh.moveTo(-hs + r, -c); sh.lineTo(hs - r, -c); sh.quadraticCurveTo(hs, -c, hs, -c + r); sh.lineTo(hs, c - r);
    sh.quadraticCurveTo(hs, c, hs - r, c); sh.lineTo(-hs + r, c); sh.quadraticCurveTo(-hs, c, -hs, c - r); sh.lineTo(-hs, -c + r);
    sh.quadraticCurveTo(-hs, -c, -hs + r, -c);
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.4, bevelSegments: 2, curveSegments: 8 });
    g.translate(0, 0, -thick / 2);
    g.rotateX(-Math.PI / 2);     // shape +y (leading edge) -> -z, extrusion -> +y
    return g;
  });
}
// body of revolution along z (profile points [z, radius] nose first), scaled to an oval section
function revGeo(key, pts, seg = 20) {
  return G('vh:rev' + key, () => {
    const lp = pts.slice().reverse().map(([z, r]) => new THREE.Vector2(r, -z));   // tail ... nose, y = -z
    const g = new THREE.LatheGeometry(lp, seg);
    g.rotateX(-Math.PI / 2);
    return g;
  });
}
function finGeo() {
  return G('vh:fin', () => {
    const sh = new THREE.Shape();
    sh.moveTo(1.55, 0); sh.lineTo(2.1, 0.86); sh.lineTo(2.46, 0.86); sh.lineTo(2.46, 0); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -0.035); g.rotateY(-Math.PI / 2);   // shape x -> world z, shape y -> up
    return g;
  });
}
function rudderGeo() {
  return G('vh:rudder', () => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(0, 0.86); sh.lineTo(0.26, 0.86); sh.quadraticCurveTo(0.46, 0.8, 0.44, 0.5); sh.lineTo(0.36, 0); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -0.03); g.rotateY(-Math.PI / 2);
    return g;
  });
}

const PLANE_Y = 1.3; // fuselage axis height
function planeStatic(world) {
  const key = 'plane|' + world.id;
  let st = SK.get(key);
  if (st) return st;
  const W = 0xf7f9fd;
  const [a1, a2, a3] = accents(world, W);
  const b = new Bld({ y0: 0.2, y1: 3.0, k: 0.68 }, world.night ? 1.4 : 1);
  const FY = PLANE_Y;
  // ---- fuselage: cowl (accent) + body (white) + tail cone
  const cowl = revGeo('cowl', [[-2.52, 0.0], [-2.5, 0.28], [-2.4, 0.5], [-2.2, 0.6], [-1.9, 0.62], [-1.45, 0.6]], 22);
  const body = revGeo('body', [[-1.45, 0.6], [-1.1, 0.58], [-0.3, 0.52], [0.6, 0.47], [1.4, 0.36], [2.1, 0.22], [2.55, 0.12], [2.7, 0.0]], 22);
  b.add(cowl, a1, [0, FY, 0], Z3, [0.95, 1.05, 1]);
  b.add(body, W, [0, FY, 0], Z3, [0.9, 1.08, 1]);
  b.add(tr(0.6, 0.05, 6, 20), CHROME, [0, FY, -1.47], Z3, [0.95, 1.05, 1], { ao: false });
  b.add(tr(0.55, 0.06, 8, 22), CHROME, [0, FY, -2.46], Z3, [0.95, 1.05, 1], { ao: false });
  b.add(cy(0.5, 0.5, 0.04, 20), DK2, [0, FY, -2.5], [Math.PI / 2, 0, 0], [0.95, 1, 1.05], { ao: false });
  // fuselage racing stripe
  b.add(tr(0.54, 0.035, 6, 20), a2, [0, FY, -0.7], Z3, [0.9, 1.08, 1], { ao: false });
  b.add(tr(0.505, 0.035, 6, 20), a2, [0, FY, -0.45], Z3, [0.9, 1.08, 1], { ao: false });
  // exhaust stubs and cooling louvres
  for (const sx of [-1, 1]) {
    b.add(cy(0.07, 0.07, 0.5, 8), CHROME, [sx * 0.5, FY - 0.25, -1.55], [Math.PI / 2, 0, 0.0]);
    b.add(cy(0.05, 0.05, 0.05, 8), DK2, [sx * 0.5, FY - 0.25, -1.3], [Math.PI / 2, 0, 0], 1, { ao: false });
    for (let i = 0; i < 3; i++) b.add(rb(0.02, 0.2, 0.3, 0.008, 1), DK2, [sx * 0.585, FY + 0.02, -2.0 + i * 0.16], [0, 0, sx * 0.1], 1, { ao: false });
  }
  // ---- cockpit
  const CZ = 0.6;
  b.add(cy(0.3, 0.3, 0.03, 20), 0x2b1e19, [0, FY + 0.49, CZ], Z3, [1, 1, 1.85], { ao: false });
  b.add(tr(0.31, 0.05, 6, 22), a2, [0, FY + 0.5, CZ], [Math.PI / 2, 0, 0], [1, 1.85, 1], { ao: false });
  b.add(rb(0.5, 0.26, 0.55, 0.12), 0x7a4b2c, [0, FY + 0.36, CZ + 0.05], Z3, 1);   // leather seat
  b.add(sp(0.5, 14, 10), W, [0, FY + 0.38, 1.3], Z3, [0.62, 0.34, 1.5]);          // turtle-deck fairing behind the pilot
  b.add(rb(0.62, 0.3, 0.025, 0.01, 1), glassMat(), [0, FY + 0.72, CZ - 0.5], [-0.55, 0, 0]);
  b.tube([-0.31, FY + 0.5, CZ - 0.42], [-0.3, FY + 0.82, CZ - 0.58], 0.018, CHROME, 6, true, { ao: false });
  b.tube([0.31, FY + 0.5, CZ - 0.42], [0.3, FY + 0.82, CZ - 0.58], 0.018, CHROME, 6, true, { ao: false });
  b.tube([-0.3, FY + 0.82, CZ - 0.58], [0.3, FY + 0.82, CZ - 0.58], 0.02, CHROME, 6, true, { ao: false });
  // ---- wings (upper: white with accent tips, lower: accent)
  const UY = 2.75, LY = 1.12, UZ = -0.85, LZ = -0.65;
  b.add(wingGeo(7.0, 1.3, 0.12, 0.62), W, [0, UY, UZ]);
  b.add(wingGeo(6.3, 1.12, 0.12, 0.54), a1, [0, LY, LZ]);
  for (const sx of [-1, 1]) {
    b.add(rb(0.62, 0.012, 1.0, 0.005, 1), a1, [sx * 3.0, UY + 0.13, UZ], Z3, 1, { ao: false });   // upper wing tip bands
    b.add(rb(0.62, 0.012, 1.0, 0.005, 1), W, [sx * 2.9, LY + 0.13, LZ], Z3, 1, { ao: false });
    b.add(cy(0.4, 0.4, 0.012, 22), a1, [sx * 1.9, UY + 0.13, UZ], Z3, 1, { ao: false });          // roundels
    b.add(cy(0.28, 0.28, 0.014, 22), W, [sx * 1.9, UY + 0.132, UZ], Z3, 1, { ao: false });
    b.add(cy(0.15, 0.15, 0.016, 22), a2, [sx * 1.9, UY + 0.134, UZ], Z3, 1, { ao: false });
  }
  b.add(rb(0.9, 0.012, 1.0, 0.005, 1), a2, [0, UY + 0.13, UZ], Z3, 1, { ao: false });             // centre section
  // ---- struts and wires
  const strut = 0x7c5a3a;
  for (const sx of [-1, 1]) {
    for (const [x, z] of [[2.5, UZ - 0.3], [2.5, UZ + 0.35]]) {
      b.tube([sx * x, LY + 0.06, z + 0.2], [sx * (x + 0.05), UY - 0.06, z], 0.045, strut, 8, true, { ao: false });
    }
    b.tube([sx * 1.1, LY + 0.05, LZ - 0.28], [sx * 1.1, UY - 0.06, UZ - 0.28], 0.04, strut, 8, true, { ao: false });
    b.tube([sx * 0.32, FY + 0.45, UZ - 0.3], [sx * 0.85, UY - 0.06, UZ - 0.3], 0.04, strut, 8, true, { ao: false });
    b.tube([sx * 0.32, FY + 0.45, UZ + 0.35], [sx * 0.85, UY - 0.06, UZ + 0.3], 0.04, strut, 8, true, { ao: false });
    // bracing wires
    b.tube([sx * 1.1, LY + 0.05, LZ - 0.28], [sx * 2.5, UY - 0.06, UZ - 0.3], 0.012, DK, 4, false, { ao: false });
    b.tube([sx * 2.5, LY + 0.06, LZ + 0.1], [sx * 0.85, UY - 0.06, UZ + 0.3], 0.012, DK, 4, false, { ao: false });
    // wing root fairing on the fuselage
    b.add(rb(0.5, 0.14, 1.1, 0.06, 1), a1, [sx * 0.55, LY + 0.04, LZ], Z3, 1, { ao: false });
  }
  // ---- tail
  b.add(finGeo(), a1, [0, FY, 0]);
  b.add(wingGeo(2.7, 0.72, 0.07, 0.32), W, [0, FY + 0.05, 2.18]);
  // ---- landing gear: V struts, axle and wheel pants
  const GZ = -1.0, GX = 0.95, WR = 0.4;
  for (const sx of [-1, 1]) {
    b.tube([sx * 0.38, FY - 0.35, GZ - 0.35], [sx * GX, WR, GZ], 0.05, DK, 8, true, { ao: false });
    b.tube([sx * 0.38, FY - 0.35, GZ + 0.45], [sx * GX, WR, GZ], 0.05, DK, 8, true, { ao: false });
  }
  b.tube([-GX, WR, GZ], [GX, WR, GZ], 0.035, DK, 6, false, { ao: false });
  b.tube([0, FY - 0.18, 2.1], [0, 0.2, 2.4], 0.03, DK, 6, true, { ao: false });
  // pitot + small details
  b.tube([2.3, LY + 0.2, LZ - 0.4], [2.3, LY + 0.2, LZ - 0.9], 0.015, DK, 4, false, { ao: false });
  for (const sx of [-1, 1]) {
    b.add(sp(0.05, 8, 6), Basic(sx < 0 ? 0xff3a3a : 0x35ff7a), [sx * 3.46, UY, UZ - 0.0]);        // wing-tip lamps
  }
  if (world.night) for (const sx of [-1, 1]) b.add(rb(0.04, 0.04, 1.1, 0.015, 1), Basic(a1), [sx * 3.4, LY, LZ]);
  st = { parts: b.build(), a1, a2, a3, W, UY, UZ, LY, LZ, WR, GX, GZ };
  SK.set(key, st);
  return st;
}

function buildPlane(world) {
  const seat = { x: 0, y: PLANE_Y, z: 0.6 };
  const g = newVehicleRoot('plane', seat);
  const st = planeStatic(world);
  const inner = g.userData.inner, u = g.userData;
  addParts(inner, st.parts, true);
  // wheels
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo('plane', st.WR, 0.26, st.a2), vcMat());
    w.position.set(sx * (st.GX + 0.1), st.WR, st.GZ); w.rotation.order = 'YXZ';
    w.userData = { r: st.WR, front: false, plane: true };
    inner.add(w); u.wheels.push(w);
  }
  const tw = new THREE.Mesh(wheelGeo('planeT', 0.17, 0.12, st.a2), vcMat());
  tw.position.set(0, 0.17, 2.4); tw.userData = { r: 0.17, front: false, plane: true }; inner.add(tw); u.wheels.push(tw);
  // propeller + blur disc
  const prop = new THREE.Mesh(propGeo(1.0, 2, 0x4b3a2a, st.a1, st.a2), vcMat());
  prop.position.set(0, PLANE_Y, -2.64);
  inner.add(prop); u.prop = prop;
  const spin = new THREE.Mesh(co(0.2, 0.42, 14), M(st.a1)); spin.rotation.x = -Math.PI / 2; spin.position.set(0, PLANE_Y, -2.86); inner.add(spin);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(1.02, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
  blur.position.set(0, PLANE_Y, -2.66); blur.renderOrder = 4; inner.add(blur); u.propBlur = blur;
  // control surfaces (animated): rudder, elevators, ailerons
  const rud = new THREE.Mesh(rudderGeo(), vcMat());
  rud.position.set(0, PLANE_Y, 2.46);
  // rudder geometry is authored with hinge at z=0 local, so shift the fin's mesh frame: rebuild coloured version
  rud.geometry = G(`vh:rudderC${st.a2}`, () => { const bb = new Bld({ y0: 0.2, y1: 3.0, k: 0.8 }); bb.add(rudderGeo(), st.a2, Z3, Z3, 1, { ao: false }); return bb.build()[0].geo; });
  inner.add(rud); u.rudder = rud;
  const elev = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(G(`vh:elev${st.a2}`, () => { const bb = new Bld({ y0: 0.2, y1: 3.0, k: 0.8 }); bb.add(rb(1.2, 0.05, 0.3, 0.02, 1), st.a2, [0, 0, 0.16], Z3, 1, { ao: false }); return bb.build()[0].geo; }), vcMat());
    e.position.set(sx * 0.7, PLANE_Y + 0.05, 2.5); inner.add(e); elev.push(e);
  }
  u.elevators = elev;
  const ail = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(G(`vh:ail${st.a2}`, () => { const bb = new Bld({ y0: 0.2, y1: 3.0, k: 0.8 }); bb.add(rb(1.25, 0.075, 0.36, 0.025, 1), st.a2, [0, 0.0, 0.17], Z3, 1, { ao: false }); return bb.build()[0].geo; }), vcMat());
    e.position.set(sx * 2.55, st.UY + 0.0, st.UZ + 0.36); inner.add(e); ail.push(e);
  }
  u.ailerons = ail;
  Object.assign(u, { width: 7.0, length: 5.5, height: 3.0, hitHalfWidth: 1.5, hitLength: 5.5, accent: st.a1 });
  return g;
}

// ====================================================================================================================
// PICKUPS - the vehicle parked on the track with a glowing ring, a light beam and bobbing "get in" chevrons
// ====================================================================================================================
const BEACON = { car: 0xffc21a, boat: 0x39c6ff, ship: 0xff5a5a, plane: 0x9fe0ff };
const PICK_DIM = {
  //        ring half-axes (x, z), ring centre z, chevron scale, beam radius, vehicle top
  car:   { rx: 2.2, rz: 3.0, cz: 0.1, cs: 1.2, br: 0.9, top: 2.15 },
  boat:  { rx: 2.0, rz: 3.0, cz: 0.0, cs: 1.2, br: 0.9, top: 1.75 },
  ship:  { rx: 4.6, rz: 9.6, cz: -1.5, cs: 1.9, br: 2.2, top: 4.8 },
  plane: { rx: 4.2, rz: 3.6, cz: 0.0, cs: 1.45, br: 1.1, top: 3.0 },
};
function beamTex() {
  return ctex('beam', 32, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0.55)'); gx.addColorStop(0.3, 'rgba(0,0,0,0)'); gx.addColorStop(0.7, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
  });
}
function chevronGeo(depth, grow = 0) {
  return G(`vh:chev${depth},${grow}`, () => {
    const q = grow;
    const sh = new THREE.Shape();
    sh.moveTo(-1.05 - q, 0.5 + q); sh.lineTo(0, -0.42 - q * 1.6); sh.lineTo(1.05 + q, 0.5 + q); sh.lineTo(1.05 + q, 1.0 + q);
    sh.lineTo(0, 0.1 - q * 0.4); sh.lineTo(-1.05 - q, 1.0 + q); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2 });
    g.translate(0, -0.3, -depth / 2);
    return g;
  });
}

export function makeVehiclePickup(kind, world) {
  world = world || WORLDS[0];
  const dim = PICK_DIM[kind] || PICK_DIM.car;
  const col = BEACON[kind] || 0xffffff;
  const g = new THREE.Group();
  g.name = 'pickup-' + kind;
  const v = makeVehicle(kind, world);
  g.add(v);
  const vu = v.userData;
  // a parked vehicle: no wake streaming, no prop blur
  if (vu.wake) vu.wake.children.forEach((c, i) => { if (i >= 2) c.visible = false; });
  if (vu.propBlur) vu.propBlur.visible = false;
  // ---- ground ring + glow
  const ringGeo = G('vh:pring', () => new THREE.RingGeometry(0.94, 1.0, 72, 1));
  const ring = new THREE.Mesh(ringGeo, Basic(col, { opacity: 0.95, blend: true }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.06, dim.cz); ring.scale.set(dim.rx, dim.rz, 1); ring.renderOrder = 5;
  g.add(ring);
  const ringB = new THREE.Mesh(G('vh:pring2', () => new THREE.RingGeometry(0.9, 1.0, 72, 1)), Basic(col, { opacity: 0.6, blend: true }));
  ringB.rotation.x = -Math.PI / 2; ringB.position.set(0, 0.07, dim.cz); ringB.renderOrder = 5; g.add(ringB);
  const glow = new THREE.Mesh(G('vh:pglow', () => new THREE.CircleGeometry(1, 40)), Basic(col, { map: sparkTex(), opacity: 0.5, blend: true }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.05, dim.cz); glow.scale.set(dim.rx * 1.25, dim.rz * 1.25, 1); glow.renderOrder = 4; g.add(glow);
  // ---- light beam
  const beamH = dim.top + 9;
  const beam = new THREE.Mesh(G(`vh:beam${dim.br},${beamH}`, () => new THREE.CylinderGeometry(dim.br, dim.br * 1.25, beamH, 18, 1, true)), Basic(col, { map: beamTex(), opacity: 0.55, blend: true, side: true }));
  beam.position.set(0, beamH / 2, dim.cz); beam.renderOrder = 4; g.add(beam);
  // ---- chevrons (three, cascade)
  const chev = [];
  const baseY = dim.top + 1.15 * dim.cs;
  for (let i = 0; i < 3; i++) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: col });
    const front = new THREE.Mesh(chevronGeo(0.3), mat);
    const back = new THREE.Mesh(chevronGeo(0.36, 0.13), Basic(0x14213d));
    back.position.z = -0.08;
    grp.add(back, front);
    grp.scale.setScalar(dim.cs * 0.9);
    grp.position.set(0, baseY + i * 1.3 * dim.cs, dim.cz);
    g.add(grp); chev.push({ grp, mat, i });
  }
  const colObj = new THREE.Color(col), white = new THREE.Color(0xffffff);
  const u = g.userData;
  Object.assign(u, {
    pickup: true, kind: 'pickup:' + kind, vehicle: v, hitHalfWidth: kind === 'ship' ? vu.hitHalfWidth : Math.max(vu.hitHalfWidth, 1.15), hitLength: vu.length,
    width: vu.width, length: vu.length, height: dim.top + 4, ring, ringB, beam, chev, glow, anchorY: 0,
    seat: vu.seat, beaconColor: col,
  });
  u.pickupUpdate = (t) => {
    const k = (n) => (t * 1.1 + n) % 1;
    ring.scale.set(dim.rx * (1 + 0.025 * Math.sin(t * 3)), dim.rz * (1 + 0.025 * Math.sin(t * 3)), 1);
    const p = (t * 0.7) % 1;
    ringB.scale.set(dim.rx * (0.9 + p * 0.5), dim.rz * (0.9 + p * 0.5), 1);
    ringB.material.opacity = 0.6;   // shared material: fade via scale only, keeps the look consistent per frame
    beam.rotation.y = t * 0.6;
    for (const c of chev) {
      const ph = (t * 1.25 - c.i * 0.2) % 1;
      const pulse = Math.max(0, 1 - ph * 2.2);
      c.grp.position.y = baseY + c.i * dim.cs * 1.3 + 0.3 * dim.cs * Math.sin(t * 3.2 - c.i * 0.9);
      c.mat.color.copy(colObj).lerp(white, pulse * 0.85);
      c.grp.rotation.y = Math.sin(t * 1.3 + c.i) * 0.18;
    }
    // gentle bobbing of the parked vehicle (about the seat pivot so nothing shears)
    const rig = vu.rig;
    rig.position.y = vu.seat.y + 0.06 + 0.05 * Math.sin(t * 1.9);
    rig.rotation.z = Math.sin(t * 1.3) * 0.02;
    rig.rotation.x = Math.sin(t * 1.1 + 0.8) * 0.012;
    if (vu.prop) vu.prop.rotation.z -= 0.02;
    if (vu.foam) for (const tx of vu.foam) tx.offset.y += tx.userData.dir * 0.002;
    for (const f of vu.flags) flutterFlag(f, t, 0.12, 8);
    if (vu.puffs) animateSmoke(vu, t, 0);
    u.lastDrive = t;
  };
  // self-driving fallback so the pickup still bobs/glows if the game never animates it
  let lastWall = 0;
  ring.onBeforeRender = () => {
    const now = performance.now() / 1000;
    if (u.driven && now - u.drivenAt < 0.4) return;
    if (now - lastWall < 0.02) return;
    lastWall = now;
    u.pickupUpdate(now);
  };
  u.pickupUpdate(0.5);
  return g;
}

function animateSmoke(u, t, speed) {
  for (const p of u.puffs) {
    const ph = ((t * 0.55 + p.userData.i / u.puffs.length) % 1);
    p.position.set(u.funnelTop.x + Math.sin(ph * 5 + p.userData.i) * 0.15, u.funnelTop.y + ph * 3.2, u.funnelTop.z + ph * (1.2 + speed * 0.12));
    p.scale.setScalar(0.35 + ph * 1.25);
    p.material.opacity = 0.55 * (1 - ph) * Math.min(1, ph * 6);
  }
}

// ====================================================================================================================
// BOSS AIRSHIP - Captain Krab's flying pirate galleon. Stern faces +Z (toward the player).
// Local frame: y = 0 is the main deck; keel at about y = -2.8, balloon top at about y = 11.7.
// ====================================================================================================================
function drawSkull(g, cx, cy, k, bones = true) {
  g.save(); g.translate(cx, cy); g.scale(k, k);
  if (bones) {
    g.fillStyle = '#f4ead0'; g.strokeStyle = '#17203a'; g.lineWidth = 7;
    for (const a of [0.62, -0.62]) {
      g.save(); g.translate(0, 34); g.rotate(a);
      g.beginPath(); g.roundRect(-118, -11, 236, 22, 11); g.fill(); g.stroke();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) { g.beginPath(); g.arc(sx * 118, sy * 12, 15, 0, TAU); g.fill(); g.stroke(); }
      g.restore();
    }
  }
  g.fillStyle = '#ffffff'; g.strokeStyle = '#17203a'; g.lineWidth = 7;
  g.beginPath(); g.ellipse(0, -14, 60, 54, 0, 0, TAU); g.fill(); g.stroke();
  g.beginPath(); g.roundRect(-34, 22, 68, 40, 12); g.fill(); g.stroke();
  g.fillStyle = '#17203a';
  g.beginPath(); g.ellipse(-24, -16, 15, 18, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(24, -16, 15, 18, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(0, 2); g.lineTo(-8, 18); g.lineTo(8, 18); g.closePath(); g.fill();
  g.lineWidth = 5; g.strokeStyle = '#17203a';
  for (const x of [-16, -5, 5, 16]) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x, 58); g.stroke(); }
  g.restore();
}
function emblemTex() {
  return ctex('emblem', 512, 384, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const gr = g.createRadialGradient(cx, cy, 20, cx, cy, w * 0.5); gr.addColorStop(0, '#2a3b6b'); gr.addColorStop(1, '#101828');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, w * 0.48, h * 0.47, 0, 0, TAU); g.fill();
    g.lineWidth = 14; g.strokeStyle = '#ffc83d'; g.stroke();
    // crab claws (open pincers) on both sides
    for (const sd of [-1, 1]) {
      g.save(); g.translate(cx + sd * w * 0.3, cy - h * 0.02); g.scale(sd, 1); g.rotate(-0.55);
      g.fillStyle = '#e0352b'; g.strokeStyle = '#6b0f0f'; g.lineWidth = 9;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 70, 0.42, TAU - 0.42); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff6a55'; g.beginPath(); g.ellipse(-18, -20, 16, 10, -0.6, 0, TAU); g.fill();
      g.restore();
    }
    drawSkull(g, cx, cy - 6, 1.0, true);
  });
}
function jollyTex() {
  return ctex('jolly', 128, 96, (g, w, h) => {
    g.fillStyle = '#14172a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc83d'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    drawSkull(g, w / 2, h / 2 - 2, 0.2, true);
    g.fillStyle = '#e0352b'; g.beginPath(); g.arc(18, h / 2, 9, 0.4, TAU - 0.4); g.lineTo(18, h / 2); g.fill();
    g.beginPath(); g.arc(w - 18, h / 2, 9, Math.PI + 0.4, Math.PI - 0.4 + TAU * 0); g.lineTo(w - 18, h / 2); g.fill();
  });
}
function sailTex() {
  return ctex('sail', 128, 128, (g, w, h) => {
    g.fillStyle = '#f3e4bb'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,90,50,0.35)'; g.lineWidth = 2;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, i * h / 6); g.lineTo(w, i * h / 6 - 8); g.stroke(); }
    g.fillStyle = '#d23a32'; g.fillRect(0, h - 22, w, 22);
    g.fillStyle = '#c9a368'; g.fillRect(w * 0.46, h * 0.32, 34, 28);
    g.strokeStyle = 'rgba(90,60,30,0.6)'; g.setLineDash([4, 3]); g.strokeRect(w * 0.46, h * 0.32, 34, 28);
  });
}

function sailGeo(len, height, nx = 8, ny = 8) {
  // right-triangle sail in the local xy plane: mast edge at x = 0 (height `height`), boom along the bottom (length `len`)
  const geo = new THREE.PlaneGeometry(1, 1, nx, ny);
  const pa = geo.attributes.position, U = new Float32Array(pa.count), V = new Float32Array(pa.count);
  for (let i = 0; i < pa.count; i++) {
    const u = pa.getX(i) + 0.5, v = pa.getY(i) + 0.5;
    U[i] = u; V[i] = v;
    pa.setXYZ(i, u * len * (1 - v * 0.96), v * height, 0);
  }
  geo.userData = { U, V };
  return geo;
}

let _bossStatic = null;
function bossStatic() {
  if (_bossStatic) return _bossStatic;
  const b = new Bld({ y0: -2.8, y1: 2.2, k: 0.62 });
  const P = mkProfile([
    [-6.5, 0.0, -0.4, 1.45],
    [-5.8, 0.55, -1.3, 1.25],
    [-4.5, 1.5, -2.0, 0.85],
    [-2.5, 2.3, -2.6, 0.58],
    [0.0, 2.55, -2.8, 0.5],
    [2.5, 2.4, -2.6, 0.6],
    [4.5, 2.2, -2.0, 1.2],
    [6.0, 1.95, -1.4, 1.8],
  ]);
  const pe = 1.0;
  const Pin = (z) => { const q = P(z); return { z: q.z, hw: Math.max(0, q.hw - 0.14), yk: q.yk, yd: q.yd }; };
  const GOLD = 0xffc83d, WOOD = 0x93603a, WOODD = 0x5a3520, RED = 0xa42b2b;
  const zs = stations(-6.5, 6.0, 40, 1.3);
  b.add(hullBand(P, zs, null, -1.9, pe, 6), 0x3a2416);
  b.add(hullBand(P, zs, -1.9, -0.3, pe, 6), WOOD);
  b.add(hullBand(P, zs, -0.3, -0.12, pe, 3), GOLD, Z3, Z3, 1, { ao: false });
  b.add(hullBand(P, zs, -0.12, 9, pe, 5), RED);
  b.add(hullBand(P, zs, -1.25, -1.17, pe, 3), mulHex(GOLD, 0.8), Z3, Z3, 1, { ao: false });
  b.add(hullCap(P, 6.0, pe, 9, 10), WOODD);
  // decks
  const zm = stations(-6.1, 2.8, 20, 1.2), zc = linz(2.8, 6.0, 8);
  const NPL = 7;
  for (let k = 0; k < NPL; k++) b.add(gridGeo(zm.length, 2, (i, j) => {
    const q = Pin(zm[i]); const x = secX(q, phiAtY(q, 0, pe)) - 0.02;
    return [lerp(-x, x, (k + j) / NPL), 0, q.z];
  }, true), k % 2 ? 0xb98550 : 0xc8955c);
  for (let k = 0; k < NPL; k++) b.add(gridGeo(zc.length, 2, (i, j) => {
    const q = Pin(zc[i]); const x = secX(q, phiAtY(q, 0.9, pe)) - 0.02;
    return [lerp(-x, x, (k + j) / NPL), 0.9, q.z];
  }, true), k % 2 ? 0xb98550 : 0xc8955c);
  b.add(hullBand(Pin, zm, 0, 9, pe, 4, true), 0x7a4a2a);
  b.add(hullBand(Pin, zc, 0.9, 9, pe, 4, true), 0x7a4a2a);
  for (const sd of [-1, 1]) b.add(capStrip(P, zs, sd, 0.16, pe, 0.01), GOLD, Z3, Z3, 1, { ao: false });
  b.add(rb(3.9, 0.9, 0.2, 0.05, 1), 0x6e4328, [0, 0.45, 2.75]);       // stern-castle riser
  b.add(rb(3.9, 0.12, 0.26, 0.05, 1), GOLD, [0, 0.92, 2.75], Z3, 1, { ao: false });
  b.add(rb(1.2, 0.9, 0.5, 0.05, 1), 0x6e4328, [0, 0.45, 2.4]);          // steps
  // rails on the stern castle and along the sides
  const zr = stations(-5.4, 5.9, 20, 1);
  for (const sd of [-1, 1]) {
    let prev = null;
    zr.forEach((z, i) => {
      const q = P(z), x = sd * (q.hw - 0.12), top = [x, q.yd + 0.62, z];
      if (prev) b.tube(prev, top, 0.04, WOODD, 6, true, { ao: false });
      if (i % 2 === 0) b.tube([x, q.yd, z], top, 0.038, WOODD, 6, true, { ao: false });
      prev = top;
    });
  }
  // transom: windows, gun ports, trim
  const sz = 6.02;
  b.add(rb(3.6, 1.0, 0.07, 0.03, 1), 0x3d2314, [0, 0.95, sz]);
  b.add(rb(3.72, 0.09, 0.09, 0.03, 1), GOLD, [0, 1.48, sz + 0.01], Z3, 1, { ao: false });
  b.add(rb(3.72, 0.09, 0.09, 0.03, 1), GOLD, [0, 0.42, sz + 0.01], Z3, 1, { ao: false });
  const winM = Basic(0xffcf70);
  for (let i = 0; i < 4; i++) {
    const x = -1.35 + i * 0.9;
    b.add(rb(0.66, 0.6, 0.07, 0.04, 1), GOLD, [x, 0.95, sz + 0.03], Z3, 1, { ao: false });
    b.add(rb(0.52, 0.46, 0.07, 0.04, 1), winM, [x, 0.95, sz + 0.06]);
    b.add(rb(0.04, 0.46, 0.075, 0.01, 1), 0x3d2314, [x, 0.95, sz + 0.07], Z3, 1, { ao: false });
  }
  for (const x of [-0.85, 0, 0.85]) {
    b.add(rb(0.78, 0.7, 0.08, 0.05, 1), GOLD, [x, -0.62, sz + 0.0], Z3, 1, { ao: false });
    b.add(rb(0.64, 0.56, 0.09, 0.04, 1), 0x0e0a08, [x, -0.62, sz + 0.02], Z3, 1, { ao: false });
  }
  b.add(rb(0.1, 0.5, 1.0, 0.03, 1), 0x2a1a10, [0, -0.7, 6.5]);          // rudder
  // lanterns and stern posts
  for (const sx of [-1, 1]) {
    b.tube([sx * 1.55, 1.7, 5.75], [sx * 1.55, 3.0, 5.75], 0.06, WOODD, 6, true, { ao: false });
    b.add(cy(0.2, 0.26, 0.42, 8), Basic(0xffd27a), [sx * 1.55, 3.22, 5.75]);
    b.add(co(0.3, 0.26, 8), GOLD, [sx * 1.55, 3.55, 5.75], Z3, 1, { ao: false });
  }
  // loot props on the stern deck (kept to the sides so the villain stays visible)
  b.add(rb(0.9, 0.5, 0.6, 0.06, 1), 0x7a4a2a, [1.3, 1.15, 3.7]);
  b.add(rb(0.94, 0.12, 0.64, 0.05, 1), GOLD, [1.3, 1.46, 3.7], Z3, 1, { ao: false });
  b.add(sp(0.42, 10, 6), GOLD, [1.3, 1.5, 3.7], Z3, [1, 0.5, 0.7], { ao: false });
  for (const [x, z] of [[-1.4, 3.5], [-1.2, 4.2]]) { b.add(cy(0.3, 0.27, 0.6, 12), 0x9a5b2c, [x, 1.2, z]); b.add(cy(0.31, 0.31, 0.06, 12), 0x3a3f4a, [x, 1.2, z], Z3, 1, { ao: false }); }
  // main deck: cabin hatch, barrels, mast base
  b.add(rb(1.5, 0.5, 1.2, 0.08, 1), 0x6e4328, [0, 0.25, 0.6]);
  b.add(rb(1.6, 0.08, 1.3, 0.04, 1), GOLD, [0, 0.52, 0.6], Z3, 1, { ao: false });
  // outrigger masts with booms for the two wing sails (sails themselves are dynamic)
  for (const sx of [-1, 1]) {
    b.tube([sx * 2.4, 0.4, 1.0], [sx * 2.4, 5.1, 1.0], 0.1, WOODD, 8, true, { ao: false });
    b.tube([sx * 2.4, 0.8, 1.0], [sx * 6.8, 1.1, 1.0], 0.085, WOODD, 8, true, { ao: false });
    b.tube([sx * 2.4, 5.1, 1.0], [sx * 6.8, 1.1, 1.0], 0.035, 0x2a1a10, 6, false, { ao: false });
    b.add(sp(0.16, 8, 6), GOLD, [sx * 2.4, 5.2, 1.0], Z3, 1, { ao: false });
    b.add(sp(0.12, 8, 6), GOLD, [sx * 6.85, 1.1, 1.0], Z3, 1, { ao: false });
  }
  // pod struts for the propellers
  for (const sx of [-1, 1]) {
    b.tube([sx * 2.2, 0.2, 2.8], [sx * 3.5, -0.5, 3.0], 0.12, 0x2a2e38, 8, true, { ao: false });
    b.tube([sx * 2.3, -1.0, 3.6], [sx * 3.5, -0.8, 3.4], 0.1, 0x2a2e38, 8, true, { ao: false });
    b.add(ca(0.55, 1.4, 4, 12), 0x5a6270, [sx * 3.6, -0.6, 3.2], [Math.PI / 2, 0, 0]);
    b.add(tr(0.57, 0.07, 6, 14), GOLD, [sx * 3.6, -0.6, 3.75], Z3, 1, { ao: false });
    b.add(sp(0.2, 8, 6), Basic(sx < 0 ? 0xff3a3a : 0x35ff7a), [sx * 3.6, -0.1, 2.7]);
  }
  // stacks (smoke comes out of them)
  for (const sx of [-1, 1]) {
    b.add(cy(0.3, 0.36, 1.8, 10), 0x2e323d, [sx * 1.5, 0.9, -1.2]);
    b.add(cy(0.38, 0.38, 0.14, 10), GOLD, [sx * 1.5, 1.85, -1.2], Z3, 1, { ao: false });
    b.add(cy(0.28, 0.28, 0.05, 10), 0x07080b, [sx * 1.5, 1.9, -1.2], Z3, 1, { ao: false });
  }
  // bowsprit
  b.tube([0, 1.1, -6.2], [0, 2.1, -8.6], 0.14, WOODD, 8, true, { ao: false });
  b.add(sp(0.22, 10, 8), GOLD, [0, 2.1, -8.6], Z3, 1, { ao: false });
  _bossStatic = b.build();
  return _bossStatic;
}

function bossBalloonGeo() {
  return G('vh:bossBalloon', () => {
    const g = new THREE.SphereGeometry(1, 36, 22);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const cA = new THREE.Color(0xc72f38), cB = new THREE.Color(0xf6e6c4), cD = new THREE.Color(0x7a1c24);
    const tmp = new THREE.Color();
    const N = 14;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const lon = Math.atan2(x, z);
      const gore = Math.floor(((lon + Math.PI) / TAU) * N);
      tmp.copy(gore % 2 ? cB : cA);
      const seam = Math.abs(((lon + Math.PI) / TAU) * N - Math.round(((lon + Math.PI) / TAU) * N));
      if (seam < 0.05) tmp.copy(cD);
      const low = smooth((-y - 0.35) / 0.6);
      tmp.lerp(cD, low * 0.7);
      const top = smooth((y - 0.88) / 0.12);
      tmp.lerp(new THREE.Color(0xffd35a), top);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
}

export function makeBossAirship() {
  const g = new THREE.Group();
  g.name = 'boss-airship';
  const rig = new THREE.Group(); g.add(rig);
  const flashMats = [];
  // hull + static parts (own material instances so they can flash on hit)
  for (const { geo, mat } of bossStatic()) {
    let m = mat;
    if (mat.vertexColors) { m = mat.clone(); flashMats.push(m); }
    const mesh = new THREE.Mesh(geo, m); mesh.castShadow = false; rig.add(mesh);
  }
  // balloon (dynamic: breathes, deflates on defeat)
  const BX = 4.4, BY = 3.5, BZ = 7.0, BCY = 8.2, BCZ = -0.3;
  const balloonMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  flashMats.push(balloonMat);
  const balloon = new THREE.Mesh(bossBalloonGeo(), balloonMat);
  balloon.position.set(0, BCY, BCZ); balloon.scale.set(BX, BY, BZ);
  rig.add(balloon);
  // emblem decal (spherical patch) on the stern side of the balloon
  const patch = new THREE.SphereGeometry(1.006, 24, 18, Math.PI / 2 - 0.66, 1.32, Math.PI / 2 - 0.62, 1.24);
  const emblem = new THREE.Mesh(patch, new THREE.MeshLambertMaterial({ map: emblemTex(), transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  flashMats.push(emblem.material);
  balloon.add(emblem);
  // gold band around the balloon
  const band = new THREE.Mesh(G('vh:bossBand', () => new THREE.TorusGeometry(1.0, 0.012, 6, 56)), Basic(0xffc83d));
  band.rotation.x = Math.PI / 2; band.position.y = -0.52; band.scale.set(0.855, 0.855, 1); balloon.add(band);
  // flag on top of the balloon
  const pole = new THREE.Mesh(G('vh:bossPole', () => new THREE.CylinderGeometry(0.05, 0.07, 2.2, 6)), M(0x3a2416));
  pole.position.set(0, BCY + BY + 0.9, BCZ); rig.add(pole);
  const jolly = makeFlag(2.2, 1.35, 0xffffff); jolly.material = new THREE.MeshLambertMaterial({ map: jollyTex(), side: THREE.DoubleSide });
  jolly.position.set(0.05, BCY + BY + 1.6, BCZ); rig.add(jolly);
  // rigging ropes balloon -> hull
  const ropeMat = M(0x4a3020);
  const ropeGeo = G('vh:rope', () => new THREE.CylinderGeometry(0.045, 0.045, 1, 5));
  const ropes = new THREE.Group(); rig.add(ropes);
  const Pb = mkProfile([[-6.5, 0, -0.4, 1.45], [-5.8, 0.55, -1.3, 1.25], [-4.5, 1.5, -2.0, 0.85], [-2.5, 2.3, -2.6, 0.58], [0, 2.55, -2.8, 0.5], [2.5, 2.4, -2.6, 0.6], [4.5, 2.2, -2.0, 1.2], [6, 1.95, -1.4, 1.8]]);
  for (const sd of [-1, 1]) for (const z of [-4.6, -3.0, -1.4, 0.2, 1.8, 3.4, 4.8]) {
    const sdz = clamp((z - BCZ) / BZ, -0.97, 0.97), sc = Math.sqrt(1 - sdz * sdz);
    const a = new THREE.Vector3(sd * BX * sc * 0.8, BCY - BY * sc * 0.6, z);
    const q = Pb(z); const bpt = new THREE.Vector3(sd * (q.hw - 0.12), q.yd + 0.62, z);
    const mid = a.clone().add(bpt).multiplyScalar(0.5), dir = bpt.clone().sub(a), len = dir.length();
    const rp = new THREE.Mesh(ropeGeo, ropeMat);
    rp.position.copy(mid); rp.scale.set(1, len, 1); rp.quaternion.setFromUnitVectors(UP, dir.normalize()); ropes.add(rp);
  }
  // ---- side wing sails on spars
  const sails = [];
  const sailMat = new THREE.MeshLambertMaterial({ map: sailTex(), side: THREE.DoubleSide });
  flashMats.push(sailMat);
  for (const sd of [-1, 1]) {
    const grp = new THREE.Group();
    grp.position.set(sd * 2.4, 0.82, 1.0);
    const geo = sailGeo(4.3, 4.2, 8, 8);
    const sailMesh = new THREE.Mesh(geo, sailMat);
    sailMesh.scale.x = sd;
    grp.add(sailMesh);
    rig.add(grp);
    sails.push({ grp, mesh: sailMesh, sd });
  }
  // ---- propellers on side pods (face +z)
  const props = [];
  for (const sd of [-1, 1]) {
    const pr = new THREE.Mesh(propGeo(1.25, 3, 0xe0b95c, 0xe0b95c, 0xe0352b), vcMat());
    pr.position.set(sd * 3.6, -0.6, 4.05); rig.add(pr); props.push(pr);
    const blur = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24), new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.16, depthWrite: false }));
    blur.position.set(sd * 3.6, -0.6, 4.08); blur.renderOrder = 4; rig.add(blur);
  }
  // ---- cannons through the stern ports (mount origin = muzzle, barrel extends toward -z)
  const cannons = [];
  const barrelGeo = G('vh:bossBarrel', () => { const bb = new Bld({ y0: -2, y1: 2, k: 1 }); bb.add(cy(0.2, 0.26, 1.5, 14), 0x5a6274, [0, 0, -0.75], [Math.PI / 2, 0, 0], 1, { ao: false }); bb.add(cy(0.3, 0.3, 0.22, 14), 0x2b2f3a, [0, 0, -0.08], [Math.PI / 2, 0, 0], 1, { ao: false }); bb.add(tr(0.24, 0.06, 6, 14), 0xffc83d, [0, 0, -0.4], Z3, 1, { ao: false }); return bb.build()[0].geo; });
  const flashCore = G('vh:flashCore', () => new THREE.SphereGeometry(0.6, 10, 8));
  const flashCone = G('vh:flashCone', () => new THREE.ConeGeometry(0.5, 1.6, 10, 1, true));
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x4a4a52, transparent: true, opacity: 0.7, depthWrite: false });
  for (const x of [-0.85, 0, 0.85]) {
    const mount = new THREE.Group();
    mount.position.set(x, -0.62, 6.5);
    const barrel = new THREE.Mesh(barrelGeo, vcMat()); mount.add(barrel);
    const flash = new THREE.Group(); flash.visible = false;
    const core = new THREE.Mesh(flashCore, Basic(0xfff1a8, { blend: true, opacity: 0.95 }));
    const cone = new THREE.Mesh(flashCone, Basic(0xff8a1f, { blend: true, opacity: 0.8, side: true })); cone.rotation.x = Math.PI / 2; cone.position.z = 0.8;
    const smoke = new THREE.Mesh(sp(0.5, 8, 6), smokeMat); smoke.position.z = 0.5;
    flash.add(core, cone, smoke); flash.position.z = 0.2; mount.add(flash);
    mount.userData = { barrel, flash, core, cone, smoke, muzzle: mount };
    rig.add(mount); cannons.push(mount);
  }
  // ---- smoke from the stacks, fire for the defeat animation
  const puffs = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(sp(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3c3f4a, transparent: true, opacity: 0.5, depthWrite: false }));
    m.userData = { i, side: i % 2 ? 1 : -1 }; m.renderOrder = 4; rig.add(m); puffs.push(m);
  }
  const flames = [];
  const flamePos = [[1.6, 1.2, 2.0], [-1.8, 1.0, -1.5], [0.5, 5.2, 3.5], [-2.2, 7.5, 2.0], [2.4, 8.0, -1.0], [0.0, 1.4, -3.5]];
  flamePos.forEach((p, i) => {
    const f = new THREE.Mesh(G('vh:flame', () => new THREE.ConeGeometry(0.6, 1.8, 8)), Basic(i % 2 ? 0xff7a1f : 0xffc21a, { blend: true, opacity: 0.9 }));
    f.position.set(p[0], p[1], p[2]); f.visible = false; f.userData = { i, y0: p[1] }; rig.add(f); flames.push(f);
  });
  const deckNode = new THREE.Object3D(); deckNode.position.set(0, 0.9, 4.3); rig.add(deckNode);
  g.userData = {
    rig, balloon, balloonBase: new THREE.Vector3(BX, BY, BZ), balloonY: BCY, flashMats, cannons, props, sails, puffs, flames, jolly, deckNode,
    deck: { x: 0, y: 0.9, z: 4.3 },
    flags: [jolly], width: 12.4, length: 14.5, height: 14, kind: 'boss',
  };
  animateBossAirship(g, 0, { firing: 0, hit: 0, defeat: 0 });
  return g;
}

export function animateBossAirship(g, t, state) {
  const u = g.userData;
  const st = state || {};
  const f = clamp(st.firing || 0, 0, 1), h = clamp(st.hit || 0, 0, 1), d = clamp(st.defeat || 0, 0, 1);
  const a = u.anim || (u.anim = { last: t });
  let dt = t - a.last; a.last = t; if (!(dt > 0)) dt = 0; else if (dt > 0.25) dt = 0.016;
  const rig = u.rig;
  // idle sway + hit shake + defeat crash
  const sx = (Math.sin(t * 73) + Math.sin(t * 51 + 1)) * 0.11 * h;
  const sy = Math.sin(t * 61 + 2) * 0.08 * h;
  rig.position.set(sx + d * d * 1.4, Math.sin(t * 1.15) * 0.32 * (1 - d) + sy - d * d * 13, d * d * 1.0);
  rig.rotation.z = Math.sin(t * 0.8) * 0.032 * (1 - d) + d * 0.7 + Math.sin(t * 43) * 0.012 * h;
  rig.rotation.x = Math.sin(t * 0.95 + 1) * 0.02 * (1 - d) - d * 0.38 + (-0.03 * h);
  rig.rotation.y = d * 0.25;
  // balloon: breathes; deflates and darkens when defeated
  const br = 1 + Math.sin(t * 1.9) * 0.008 * (1 - d);
  u.balloon.scale.set(u.balloonBase.x * br * (1 + d * 0.1), u.balloonBase.y * br * (1 - d * 0.55), u.balloonBase.z * br * (1 - d * 0.1));
  u.balloon.position.y = u.balloonY - d * 1.6;
  u.balloon.rotation.z = d * 0.1;
  // hit flash on every body material
  const er = h * 0.9, eg = h * 0.38, eb = h * 0.3;
  for (const m of u.flashMats) {
    if (m.emissive) m.emissive.setRGB(er, eg, eb);
  }
  const dark = 1 - 0.5 * d;
  u.balloon.material.color.setScalar(dark);
  // propellers
  for (const p of u.props) p.rotation.z -= dt * 24 * (1 - d * 0.85);
  // sails (billow + flutter)
  for (const s of u.sails) {
    const geo = s.mesh.geometry, { U, V } = geo.userData, pa = geo.attributes.position;
    const amp = 0.7 * (1 - d * 0.7);
    for (let i = 0; i < pa.count; i++) {
      const uu = U[i], vv = V[i];
      const bil = Math.sin(Math.min(1, uu) * Math.PI * 0.85) * Math.sin(Math.min(1, vv) * Math.PI * 0.8);
      pa.setZ(i, bil * amp + Math.sin(t * 2.6 + uu * 6 - vv * 4 + s.sd) * 0.14 * (uu * 0.7 + vv * 0.3));
    }
    pa.needsUpdate = true;
    geo.computeVertexNormals();
  }
  // flags
  flutterFlag(u.jolly, t, 0.22, 9);
  // cannons: recoil + muzzle flash while firing
  for (let i = 0; i < u.cannons.length; i++) {
    const c = u.cannons[i], cu = c.userData;
    cu.barrel.position.z = -0.55 * f;
    cu.flash.visible = f > 0.12;
    if (cu.flash.visible) {
      const k = f * (0.85 + 0.15 * Math.sin(t * 90 + i * 2));
      cu.flash.scale.setScalar(0.5 + k * 1.6);
      cu.core.scale.setScalar(0.8 + 0.3 * Math.sin(t * 70 + i));
      cu.smoke.scale.setScalar(0.6 + (1 - f) * 1.4);
    }
  }
  // smoke from the stacks (and from the hull while defeated)
  for (const p of u.puffs) {
    const ph = ((t * 0.5 + p.userData.i / u.puffs.length) % 1);
    const sd = p.userData.side;
    p.position.set(sd * 1.5 + Math.sin(ph * 6 + p.userData.i) * 0.2 + sd * d * ph * 1.5, 1.95 + ph * 3.8, -1.2 + ph * 3.4);
    p.scale.setScalar(0.4 + ph * 1.4 + d * 0.5);
    p.material.opacity = (0.5 + d * 0.3) * (1 - ph) * Math.min(1, ph * 5);
  }
  // fire
  for (const fl of u.flames) {
    fl.visible = d > 0.02 + fl.userData.i * 0.04;
    if (fl.visible) {
      const fk = 0.7 + 0.5 * Math.sin(t * 17 + fl.userData.i * 2.1) * Math.sin(t * 11 + fl.userData.i);
      fl.scale.set(0.8 + d * 0.8, 0.6 + fk * (0.6 + d), 0.8 + d * 0.8);
      fl.position.y = fl.userData.y0 + 0.5 * fl.scale.y;
    }
  }
}

// ====================================================================================================================
// public API (filled in below as the models are added)
// ====================================================================================================================
// Optional: build every static mesh/texture for a world during a loading screen so the first pickup does not hitch.
export function prewarmVehicles(world) {
  world = world || WORLDS[0];
  for (const k of ['car', 'boat', 'ship', 'plane']) makeVehicle(k, world);
  beamTex(); foamTex(); emblemTex(); jollyTex(); sailTex();
}

export function makeVehicle(kind, world) {
  world = world || WORLDS[0];
  switch (kind) {
    case 'car': return buildCar(world);
    case 'boat': return buildBoat(world);
    case 'ship': return buildShip(world);
    case 'plane': return buildPlane(world);
    default: throw new Error('unknown vehicle ' + kind);
  }
}

export function animateVehicle(v, t, speed = 0, extra = {}) {
  const u = v.userData;
  if (u.pickup) { u.driven = true; u.drivenAt = performance.now() / 1000; u.pickupUpdate(t); return; }
  const a = u.anim || (u.anim = { last: t });
  let dt = t - a.last; a.last = t;
  if (!(dt > 0)) dt = 0; else if (dt > 0.25) dt = 0.016;
  const bank = clamp(extra.bank || 0, -0.6, 0.6), pitch = clamp(extra.pitch || 0, -0.6, 0.6), steer = clamp(extra.steer || 0, -1, 1);
  const rig = u.rig;
  const kind = u.kind;
  for (const w of u.wheels) {
    if (w.userData.plane) continue;
    w.rotation.x -= (speed * dt) / w.userData.r;
    if (w.userData.front) w.rotation.y = -steer * 0.42;
  }
  if (kind === 'car') {
    rig.rotation.z = -bank * 0.6 + Math.sin(t * 2.3) * 0.004;
    rig.rotation.x = pitch + Math.sin(t * 17 + 1) * 0.003 * Math.min(1, speed / 15);
  } else if (kind === 'boat') {
    const k = Math.min(1, speed / 14);
    rig.rotation.z = -bank * 0.8 + Math.sin(t * 2.1) * 0.03 * (1 - k * 0.5) - steer * 0.05;
    rig.rotation.x = pitch + 0.03 + Math.sin(t * 1.7 + 0.6) * 0.02 + Math.sin(t * 9.0) * 0.004 * k;
    if (u.prop) u.prop.rotation.z -= dt * (25 + speed * 2.5);
    if (u.foam) for (const tx of u.foam) tx.offset.y += tx.userData.dir * dt * (0.3 + speed * 0.05);
  }
  else if (kind === 'plane') {
    rig.rotation.z = -bank + Math.sin(t * 1.9) * 0.02;
    rig.rotation.x = pitch + Math.sin(t * 1.3 + 1.0) * 0.012 + Math.sin(t * 31) * 0.003;
    rig.position.y = u.seat.y + Math.sin(t * 1.6) * 0.015;
    u.prop.rotation.z -= dt * (45 + speed * 2.2);
    u.propBlur.material.opacity = 0.1 + 0.16 * Math.min(1, speed / 25);
    u.rudder.rotation.y = steer * 0.5;
    u.elevators.forEach((e) => { e.rotation.x = -pitch * 0.9; });
    u.ailerons[0].rotation.x = -bank * 0.9; u.ailerons[1].rotation.x = bank * 0.9;
    for (const w of u.wheels) w.rotation.x -= dt * 6;
  }
  else if (kind === 'ship') {
    const k = Math.min(1, speed / 14);
    rig.rotation.z = -bank * 0.5 + Math.sin(t * 0.9) * 0.022 - steer * 0.03;
    rig.rotation.x = pitch + 0.012 + Math.sin(t * 0.75 + 0.6) * 0.016;
    if (u.helm) u.helm.rotation.z = -steer * 1.2 + Math.sin(t * 0.7) * 0.05;
    if (u.foam) for (const tx of u.foam) tx.offset.y += tx.userData.dir * dt * (0.2 + speed * 0.03);
    animateSmoke(u, t, speed);
  }
  for (const f of u.flags) flutterFlag(f, t, 0.1 + Math.min(0.1, speed * 0.004), 11 + speed * 0.2);
}
