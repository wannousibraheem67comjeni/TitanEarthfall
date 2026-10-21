// Shared model helpers (cached geometry/material factories, canvas textures) plus the pickups
// (coins, gems, power-ups, bombs, finish gate) and the road obstacles. Characters, vehicles, water
// obstacles, scenery, backdrop and homes live in their own modules.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const geoCache = new Map();
const matCache = new Map();
const texCache = new Map();

export function G(key, fn) {
  let g = geoCache.get(key);
  if (!g) { g = fn(); geoCache.set(key, g); }
  return g;
}
// Cached Lambert material. opts: emissive, ei (emissive intensity), opacity, side, flat.
function optKey(opts) {
  return Object.keys(opts).map((k) => k + ':' + (opts[k] && opts[k].isTexture ? opts[k].uuid : opts[k])).join(',');
}
export function M(color, opts = {}) {
  const key = color + '|' + optKey(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    if (opts.emissive !== undefined) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei ?? 1; }
    if (opts.opacity !== undefined) { m.transparent = true; m.opacity = opts.opacity; m.depthWrite = opts.opacity > 0.9; }
    if (opts.side) m.side = THREE.DoubleSide;
    if (opts.flat) m.flatShading = true;
    if (opts.map) m.map = opts.map;
    if (opts.fog === false) m.fog = false;
    matCache.set(key, m);
  }
  return m;
}
export function Basic(color, opts = {}) {
  const key = 'B' + color + '|' + optKey(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1, depthWrite: opts.opacity === undefined });
    if (opts.side) m.side = THREE.DoubleSide;
    if (opts.blend) m.blending = THREE.AdditiveBlending;
    if (opts.map) m.map = opts.map;
    if (opts.fog === false) m.fog = false;
    matCache.set(key, m);
  }
  return m;
}
const glow = (c) => M(c, { emissive: c, ei: 1 });

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
const box = (w, h, d) => G(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const rbox = (w, h, d, r) => G(`rbox${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));
const cyl = (rt, rb, h, s = 12) => G(`cyl${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph = (r, ws = 14, hs = 10) => G(`sph${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const cone = (r, h, s = 12) => G(`cone${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const caps = (r, l) => G(`caps${r},${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
const tor = (r, t, rs = 8, ts = 20, arc = Math.PI * 2) => G(`tor${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const ico = (r, d = 0) => G(`ico${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
const dode = (r) => G(`dode${r}`, () => new THREE.DodecahedronGeometry(r, 0));
const plane = (w, h) => G(`pl${w},${h}`, () => new THREE.PlaneGeometry(w, h));

// ---------- canvas textures ----------
function canvasTex(key, w, h, draw, repeat) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  texCache.set(key, t);
  return t;
}
export function stripeTex(c1 = '#e8382f', c2 = '#ffffff') {
  return canvasTex('stripe' + c1 + c2, 128, 32, (g, w, h) => {
    g.fillStyle = c2; g.fillRect(0, 0, w, h);
    g.fillStyle = c1;
    for (let x = -h; x < w + h; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.fill(); }
  });
}
function carpetTex() {
  return canvasTex('carpet', 64, 64, (g, w, h) => {
    g.fillStyle = '#b5232f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd166'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#1d6f8c';
    g.beginPath(); g.moveTo(w / 2, 12); g.lineTo(w - 14, h / 2); g.lineTo(w / 2, h - 12); g.lineTo(14, h / 2); g.fill();
    g.fillStyle = '#ffd166'; g.beginPath(); g.arc(w / 2, h / 2, 6, 0, Math.PI * 2); g.fill();
  });
}
function textTex(text, bg, fg, w = 128, h = 128, font = 70) {
  return canvasTex('txt' + text + bg + fg, w, h, (g) => {
    if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = fg; g.font = `900 ${font}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}
export function blobShadowTex() {
  return canvasTex('blob', 64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
export function sparkTex() {
  return canvasTex('spark', 64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

// ---------- pickups ----------
// Collectible coin: a lathed disc with a raised rim and a star on both faces, facing -Z / +Z so it
// shows its face to the camera as it spins around the vertical axis.
export function coinGeometry() {
  return G('coin', () => {
    const prof = [[0, -0.05], [0.27, -0.05], [0.33, -0.035], [0.37, 0], [0.33, 0.035], [0.27, 0.05], [0, 0.05]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const disc = new THREE.LatheGeometry(prof, 22).toNonIndexed();
    const star = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 0.1 : 0.22;
      if (k === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    star.closePath();
    const front = new THREE.ExtrudeGeometry(star, { depth: 0.03, bevelEnabled: false });
    front.translate(0, 0, 0.05);
    const back = front.clone(); back.rotateY(Math.PI);
    disc.rotateX(Math.PI / 2);                 // axis along Z
    const geo = mergeGeometries([disc, front, back].map((g) => (g.index ? g.toNonIndexed() : g)));
    geo.computeVertexNormals();
    return geo;
  });
}
export function coinMaterial() { return M(0xffc21a, { emissive: 0x8a5200, ei: 0.7 }); }

export function makeGem() {
  const g = new THREE.Group();
  const m = mesh(G('gem', () => new THREE.OctahedronGeometry(0.4, 0)), M(0x38d9ff, { emissive: 0x0a5a8a, ei: 0.8, flat: true }), 0, 0, 0, g);
  m.scale.set(0.8, 1.15, 0.8);
  return g;
}

// Power-up capsule: a glass bubble with the item floating inside.
//  types: magnet | shield (helmet) | jet (jet pack) | double | bombmag | vault
export function makePowerup(type) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const bubble = mesh(sph(0.78, 18, 14), Basic(0xffffff, { opacity: 0.16 }), 0, 0, 0, g);
  bubble.renderOrder = 2;
  const ring = mesh(tor(0.82, 0.05, 6, 28), Basic(0xffffff, { opacity: 0.6 }), 0, 0, 0, g);
  ring.userData.ring = true;
  if (type === 'magnet') {
    const u = mesh(tor(0.3, 0.12, 8, 18, Math.PI), M(0xff3d5a), 0, 0.05, 0, inner); u.rotation.z = Math.PI;
    for (const x of [-0.3, 0.3]) mesh(box(0.25, 0.16, 0.25), M(0xdddddd), x, 0.1, 0, inner);
  } else if (type === 'shield') {
    // Safety helmet with a visor stripe.
    const helm = mesh(G('helm', () => new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), M(0x39c6ff), 0, -0.1, 0, inner);
    helm.scale.set(1, 1.1, 1.1);
    mesh(box(0.08, 0.3, 0.8), M(0xffffff), 0, 0.2, 0, inner);
    mesh(box(0.8, 0.06, 0.8), M(0x1f8fd0), 0, -0.1, 0, inner);
  } else if (type === 'jet') {
    // Jet pack: two tanks with flames.
    for (const x of [-0.17, 0.17]) {
      mesh(cyl(0.14, 0.14, 0.62, 12), M(0xffb020), x, 0.05, 0, inner);
      mesh(cone(0.14, 0.2, 12), M(0xff7a00), x, 0.43, 0, inner);
      const fl = mesh(cone(0.1, 0.4, 10), Basic(0xffd34d, { opacity: 0.9, blend: true }), x, -0.5, 0, inner);
      fl.rotation.x = Math.PI;
    }
    mesh(box(0.5, 0.1, 0.12), M(0xdddddd), 0, 0.1, 0.16, inner);
  } else if (type === 'double') {
    const d = mesh(cyl(0.42, 0.42, 0.12, 24), M(0x9b5cff), 0, 0, 0, inner); d.rotation.x = Math.PI / 2;
    const f = mesh(plane(0.7, 0.7), Basic(0xffffff, { map: textTex('x2', null, '#ffffff') }), 0, 0, -0.07, inner); f.rotation.y = Math.PI;
    mesh(plane(0.7, 0.7), Basic(0xffffff, { map: textTex('x2', null, '#ffffff') }), 0, 0, 0.07, inner);
  } else if (type === 'bombmag') {
    // Bomb held by a horseshoe magnet.
    mesh(sph(0.26, 14, 10), M(0x1c1c28), 0, -0.1, 0, inner);
    mesh(cyl(0.05, 0.05, 0.12, 8), M(0x444444), 0, 0.17, 0, inner);
    mesh(sph(0.06, 8, 6), Basic(0xffe14d, { blend: true, opacity: 1 }), 0, 0.27, 0, inner);
    const u = mesh(tor(0.38, 0.1, 8, 20, Math.PI), M(0xff7a1f), 0, 0.02, 0, inner);
    for (const x of [-0.38, 0.38]) mesh(box(0.2, 0.14, 0.2), M(0xe8e8e8), x, 0.02, 0, inner);
    u.rotation.z = 0;
  } else if (type === 'vault') {
    mesh(rbox(0.7, 0.62, 0.6, 0.06), M(0x9aa4b2), 0, 0, 0, inner);
    const dial = mesh(cyl(0.16, 0.16, 0.06, 16), M(0x4b5563), 0, 0, -0.32, inner); dial.rotation.x = Math.PI / 2;
    mesh(box(0.05, 0.2, 0.02), M(0xffc93c), 0, 0, -0.36, inner);
    bubble.visible = false;
  }
  g.userData.inner = inner;
  return g;
}

// Stage finish: a checkered arch over the whole road.
export function makeFinishGate() {
  const g = new THREE.Group();
  const check = canvasTex('check', 128, 32, (c, w, h) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * 16, y * 16, 16, 16); }
    void h; void w;
  }, [4, 1]);
  const post = M(0xffffff), glow = M(0xffd34d, { emissive: 0xffd34d, ei: 1 });
  for (const x of [-4.9, 4.9]) {
    mesh(cyl(0.28, 0.34, 5.4, 12), post, x, 2.7, 0, g);
    mesh(sph(0.42, 12, 10), glow, x, 5.5, 0, g);
  }
  mesh(box(10.2, 1.3, 0.35), M(0xffffff, { map: check }), 0, 5.0, 0, g);
  mesh(box(10.4, 0.12, 0.5), glow, 0, 4.3, 0, g);
  mesh(box(10.4, 0.12, 0.5), glow, 0, 5.7, 0, g);
  const ground = mesh(box(8.6, 0.04, 1.0), M(0xffffff, { map: check }), 0, 0.03, 0, g);
  ground.material = M(0xffffff, { map: check });
  return g;
}

export function makeBomb(kind) {
  const g = new THREE.Group();
  const col = kind === 'emp' ? 0x2fa8ff : 0xe02828;
  mesh(sph(0.5, 16, 12), M(col, { emissive: col, ei: 0.35 }), 0, 0.5, 0, g);
  mesh(cyl(0.12, 0.12, 0.2, 8), M(0x333333), 0, 1.05, 0, g);
  const spark = mesh(sph(0.1, 8, 6), Basic(kind === 'emp' ? 0x9cf5ff : 0xffe14d, { blend: true, opacity: 1 }), 0, 1.2, 0, g);
  g.userData.spark = spark;
  if (kind === 'emp') {
    const r = mesh(tor(0.62, 0.05, 6, 24), Basic(0x9cf5ff, { opacity: 0.8, blend: true }), 0, 0.5, 0, g);
    r.rotation.x = Math.PI / 2; g.userData.ring = r;
  }
  return g;
}

// ---------- obstacles ----------
function pick(arr, rng = Math.random) { return arr[Math.floor(rng() * arr.length)]; }
function wheels(g, xs, zs, r = 0.4, y = 0.4) {
  for (const x of xs) for (const z of zs) {
    const w = mesh(cyl(r, r, 0.32, 14), M(0x1b1b1b), x, y, z, g); w.rotation.z = Math.PI / 2;
  }
}

// family: low | high | block | truck | cone | mover. Returns Group (origin on road, centre of lane).
export function makeObstacle(kind, world, opts = {}) {
  const g = new THREE.Group();
  const P = world.palette;
  const night = world.night;
  switch (kind) {
    // ---- low (jump over) ----
    case 'barrier': {
      for (const x of [-0.85, 0.85]) mesh(box(0.12, 0.95, 0.12), M(0xdddddd), x, 0.47, 0, g);
      const b = mesh(box(2.0, 0.42, 0.12), M(0xffffff, { map: stripeTex() }), 0, 0.72, 0, g); b.castShadow = true;
      mesh(box(2.0, 0.08, 0.5), M(0x999999), 0, 0.04, 0, g);
      for (const x of [-0.85, 0.85]) mesh(sph(0.08, 8, 6), glow(0xffa000), x, 1.0, 0, g);
      break;
    }
    case 'neonBarrier': {
      mesh(box(2.0, 0.85, 0.3), M(0x1d1838), 0, 0.42, 0, g);
      mesh(box(2.04, 0.1, 0.32), glow(0x39f3ff), 0, 0.82, 0, g);
      mesh(box(2.04, 0.1, 0.32), glow(0xff3df2), 0, 0.15, 0, g);
      break;
    }
    case 'crate': {
      const c = mesh(box(1.9, 0.92, 0.95), M(0xc98b3c), 0, 0.46, 0, g); c.castShadow = true;
      for (const y of [0.1, 0.82]) mesh(box(1.94, 0.1, 0.99), M(0x8a5a2b), 0, y, 0, g);
      mesh(box(0.12, 0.92, 0.99), M(0x8a5a2b), 0, 0.46, 0, g);
      break;
    }
    case 'log': {
      const l = mesh(cyl(0.46, 0.46, 2.1, 14), M(0x7a4f2a), 0, 0.46, 0, g); l.rotation.z = Math.PI / 2; l.castShadow = true;
      for (const x of [-1.06, 1.06]) { const e = mesh(cyl(0.4, 0.4, 0.02, 14), M(0xd9b27c), x, 0.46, 0, g); e.rotation.z = Math.PI / 2; }
      mesh(sph(0.16, 8, 6), M(0x4caf50), 0.4, 0.9, 0, g);
      break;
    }
    case 'iceBlock': {
      const c = mesh(rbox(1.9, 0.92, 0.9, 0.1), M(0x9fdcff, { opacity: 0.85 }), 0, 0.46, 0, g); c.castShadow = true;
      mesh(box(1.6, 0.06, 0.6), M(0xffffff), 0, 0.95, 0, g);
      break;
    }
    case 'sandbags': {
      for (let i = 0; i < 3; i++) { const s = mesh(sph(0.42, 10, 8), M(0xd9b77a), -0.66 + i * 0.66, 0.3, 0, g); s.scale.set(1, 0.65, 0.9); }
      for (let i = 0; i < 2; i++) { const s = mesh(sph(0.42, 10, 8), M(0xcaa468), -0.33 + i * 0.66, 0.72, 0, g); s.scale.set(1, 0.6, 0.9); }
      break;
    }
    // ---- high (slide under) ----
    case 'gantry': {
      for (const x of [-1.05, 1.05]) mesh(box(0.14, 2.6, 0.14), M(0x555555), x, 1.3, 0, g);
      const b = mesh(box(2.2, 0.85, 0.15), M(0xffffff, { map: stripeTex('#1b1b1b', '#ffcc00') }), 0, 1.9, 0, g); b.castShadow = true;
      mesh(G('warn', () => new THREE.CircleGeometry(0.28, 3)), M(0xffffff), 0, 1.9, -0.09, g).rotation.set(0, Math.PI, Math.PI / 2 * 0);
      break;
    }
    case 'holoGate': {
      for (const x of [-1.05, 1.05]) mesh(box(0.16, 2.6, 0.16), M(0x2b2550), x, 1.3, 0, g);
      mesh(box(2.1, 0.9, 0.06), M(0xff3df2, { emissive: 0xff3df2, ei: 0.8, opacity: 0.75 }), 0, 1.9, 0, g);
      mesh(box(2.2, 0.08, 0.1), glow(0x39f3ff), 0, 1.42, 0, g);
      break;
    }
    case 'bambooBar': {
      for (const x of [-1.05, 1.05]) mesh(cyl(0.08, 0.08, 2.6, 8), M(0x9a7b3a), x, 1.3, 0, g);
      for (const y of [1.55, 1.8, 2.05]) { const b = mesh(cyl(0.1, 0.1, 2.2, 8), M(0xc8b45a), 0, y, 0, g); b.rotation.z = Math.PI / 2; }
      mesh(box(1.2, 0.5, 0.05), M(0xff6f61), 0, 2.45, 0, g);
      break;
    }
    case 'branch': {
      for (const x of [-1.15, 1.15]) mesh(dode(0.45), M(0x8d8d8d, { flat: true }), x, 0.4, 0, g);
      const l = mesh(cyl(0.3, 0.34, 2.8, 10), M(0x6d4c41), 0, 1.75, 0, g); l.rotation.z = Math.PI / 2;
      for (const x of [-0.8, 0.1, 0.9]) mesh(ico(0.42, 0), M(0x4caf50, { flat: true }), x, 2.15, 0, g);
      for (const x of [-1.15, 1.15]) mesh(cyl(0.18, 0.22, 1.4, 8), M(0x6d4c41), x, 1.1, 0, g);
      break;
    }
    case 'icicleArch': {
      for (const x of [-1.1, 1.1]) mesh(box(0.3, 2.6, 0.5), M(0xcfefff), x, 1.3, 0, g);
      mesh(box(2.5, 0.55, 0.6), M(0xcfefff, { opacity: 0.9 }), 0, 2.15, 0, g);
      for (let i = 0; i < 6; i++) { const c = mesh(cone(0.1, 0.5, 6), M(0xe8f8ff, { opacity: 0.9 }), -0.8 + i * 0.32, 1.65, 0, g); c.rotation.x = Math.PI; }
      break;
    }
    case 'carpetArch': {
      for (const x of [-1.05, 1.05]) mesh(cyl(0.09, 0.09, 2.7, 8), M(0x8c5a2b), x, 1.35, 0, g);
      mesh(cyl(0.06, 0.06, 2.3, 8), M(0x8c5a2b), 0, 2.6, 0, g).rotation.z = Math.PI / 2;
      mesh(plane(2.0, 1.15), M(0xffffff, { map: carpetTex(), side: true }), 0, 2.0, 0, g);
      for (const x of [-0.7, 0, 0.7]) mesh(sph(0.1, 8, 6), glow(0xffd166), x, 1.38, 0, g);
      break;
    }
    // ---- block (switch lane) ----
    case 'van': {
      const col = opts.color ?? pick(P);
      const b = mesh(rbox(2.0, 1.8, 3.8, 0.22), M(col), 0, 1.35, 0, g); b.castShadow = true;
      mesh(rbox(2.02, 0.7, 1.0, 0.15), M(0x223344), 0, 1.75, -1.55, g);
      mesh(box(2.04, 0.12, 3.84), M(0xffffff), 0, 0.85, 0, g);
      wheels(g, [-0.92, 0.92], [-1.25, 1.25]);
      for (const x of [-0.7, 0.7]) mesh(box(0.3, 0.16, 0.05), glow(0xfff6c0), x, 0.95, -1.92, g);
      break;
    }
    case 'hoverCar': {
      const col = opts.color ?? pick(P);
      const b = mesh(rbox(2.0, 1.4, 3.6, 0.4), M(0x2b2550), 0, 1.35, 0, g); b.castShadow = true;
      mesh(rbox(1.7, 0.6, 1.6, 0.25), M(0x39f3ff, { emissive: 0x0a4a55, ei: 1, opacity: 0.85 }), 0, 2.1, 0.1, g);
      mesh(box(2.1, 0.1, 3.7), glow(col), 0, 0.62, 0, g);
      mesh(box(1.8, 0.05, 3.4), Basic(col, { opacity: 0.5, blend: true }), 0, 0.1, 0, g);
      break;
    }
    case 'hut': {
      const b = mesh(box(1.9, 1.6, 2.2), M(0xe0b878), 0, 0.8, 0, g); b.castShadow = true;
      const r = mesh(cone(1.75, 1.1, 4), M(0xb08a3a, { flat: true }), 0, 2.15, 0, g); r.rotation.y = Math.PI / 4;
      mesh(box(1.0, 0.9, 0.05), M(0x2ec4b6), 0, 0.9, -1.12, g);
      break;
    }
    case 'boulder': {
      const b = mesh(dode(1.15), M(0x8a8f96, { flat: true }), 0, 1.05, 0, g); b.scale.set(0.95, 1.05, 1.3); b.castShadow = true;
      mesh(ico(0.3, 0), M(0x4caf50, { flat: true }), 0.5, 2.0, 0, g);
      break;
    }
    case 'snowman': {
      mesh(sph(0.85, 14, 10), M(0xffffff), 0, 0.8, 0, g).castShadow = true;
      mesh(sph(0.6, 14, 10), M(0xffffff), 0, 1.85, 0, g);
      mesh(sph(0.42, 12, 10), M(0xffffff), 0, 2.6, 0, g);
      const n = mesh(cone(0.08, 0.4, 8), M(0xff7a00), 0, 2.6, -0.5, g); n.rotation.x = -Math.PI / 2;
      mesh(cyl(0.3, 0.3, 0.35, 12), M(0x222222), 0, 3.0, 0, g);
      mesh(cyl(0.65, 0.65, 0.12, 12), M(0xd84a4a), 0, 2.2, 0, g);
      break;
    }
    case 'stall': {
      mesh(box(1.9, 1.1, 1.6), M(0x9c6b3f), 0, 0.55, 0, g).castShadow = true;
      for (const x of [-0.9, 0.9]) mesh(box(0.1, 2.4, 0.1), M(0x6d4c2f), x, 1.2, -0.75, g);
      const c = mesh(box(2.1, 0.12, 1.9), M(0xffffff, { map: stripeTex('#e76f51', '#fff1d0') }), 0, 2.4, 0, g); c.rotation.x = 0.15;
      for (let i = 0; i < 4; i++) mesh(sph(0.18, 8, 6), M(pick([0xff7a00, 0xe9c46a, 0x8bc34a, 0xd84a4a])), -0.6 + i * 0.4, 1.25, 0, g);
      break;
    }
    // ---- climbable truck: trailer with a ramp facing the player ----
    case 'truck': case 'neonTruck': case 'iceTruck': case 'logTruck': case 'plowTruck': case 'caravan': {
      const L = opts.len || 12, H = 2.6;
      const col = opts.color ?? pick(P);
      const trailerCol = kind === 'neonTruck' ? 0x2b2550 : kind === 'iceTruck' ? 0xffffff : kind === 'caravan' ? 0xf6e3c0 : kind === 'logTruck' ? 0x6d4c41 : col;
      const tr = mesh(box(2.2, H - 0.6, L - 2.6), M(trailerCol), 0, 0.6 + (H - 0.6) / 2, -(L - 2.6) / 2 - 0, g);
      tr.castShadow = true;
      // roof deck
      mesh(box(2.24, 0.08, L - 2.6), M(0x8a96a3), 0, H - 0.02, -(L - 2.6) / 2, g);
      if (kind === 'neonTruck') { mesh(box(2.26, 0.08, L - 2.6), glow(0x39f3ff), 0, 1.2, -(L - 2.6) / 2, g); mesh(box(2.26, 0.08, L - 2.6), glow(0xff3df2), 0, 2.2, -(L - 2.6) / 2, g); }
      if (kind === 'iceTruck') { mesh(box(2.26, 0.5, L - 3), M(0xff6f61), 0, 1.6, -(L - 2.6) / 2, g); }
      if (kind === 'logTruck') for (let i = 0; i < 3; i++) { const lg = mesh(cyl(0.3, 0.3, L - 3, 10), M(0x8a5a2b), -0.75 + i * 0.75, 1.0, -(L - 2.6) / 2, g); lg.rotation.x = Math.PI / 2; }
      if (kind === 'caravan') mesh(box(2.26, 0.3, L - 2.6), M(0x2a9d8f), 0, 1.4, -(L - 2.6) / 2, g);
      if (kind === 'plowTruck') mesh(box(2.26, 0.15, L - 2.6), M(0xffffff), 0, H + 0.05, -(L - 2.6) / 2, g);
      // cab at the far end
      const cab = mesh(rbox(2.2, 2.2, 2.4, 0.25), M(col), 0, 1.45, -(L - 1.2), g); cab.castShadow = true;
      mesh(box(2.0, 0.7, 0.05), M(0x223344), 0, 1.9, -(L - 2.42), g);
      wheels(g, [-1.0, 1.0], [-1.2, -(L - 4.5), -(L - 1.2)], 0.45, 0.45);
      if (kind === 'plowTruck') mesh(box(2.6, 0.9, 0.3), M(0xffc93c), 0, 0.6, -(L + 0.1), g);
      // ramp (from z=+rampLen at ground to z=0 at deck height)
      if (opts.ramp) {
        const rampLen = 4;
        const ramp = new THREE.Group(); g.add(ramp);
        const slope = Math.atan2(H, rampLen);
        const len = Math.hypot(H, rampLen);
        const r = mesh(box(2.1, 0.12, len), M(0xb0b8c0), 0, H / 2, rampLen / 2, ramp);
        r.rotation.x = slope;
        for (const x of [-1.02, 1.02]) { const s = mesh(box(0.08, 0.2, len), M(0xffcc00), x, H / 2 + 0.1, rampLen / 2, ramp); s.rotation.x = slope; }
        for (let i = 0; i < 4; i++) { const s = mesh(box(2.1, 0.03, 0.1), M(0x555555), 0, (i + 0.5) * H / 4 + 0.08, rampLen - (i + 0.5) * rampLen / 4, ramp); s.rotation.x = slope; }
      } else {
        mesh(box(2.0, 1.6, 0.06), M(0x666f7a), 0, 1.6, 0.03, g); // rear doors
        for (const x of [-0.85, 0.85]) mesh(box(0.25, 0.15, 0.05), glow(0xff2020), x, 0.85, 0.06, g);
      }
      break;
    }
    // ---- cones (small, jump) ----
    case 'cone': {
      mesh(cone(0.38, 0.85, 14), M(0xff6d00), 0, 0.45, 0, g).castShadow = true;
      mesh(cyl(0.24, 0.29, 0.14, 14), M(0xffffff), 0, 0.48, 0, g);
      mesh(box(0.8, 0.06, 0.8), M(0xff6d00), 0, 0.03, 0, g);
      break;
    }
    case 'neonCone': {
      mesh(cone(0.38, 0.85, 14), M(0x2b2550), 0, 0.45, 0, g);
      mesh(cyl(0.24, 0.29, 0.14, 14), glow(0x39f3ff), 0, 0.48, 0, g);
      break;
    }
    case 'sandcastle': {
      mesh(box(0.9, 0.5, 0.8), M(0xe8c47a), 0, 0.25, 0, g);
      for (const x of [-0.32, 0.32]) mesh(cyl(0.16, 0.18, 0.45, 8), M(0xe8c47a), x, 0.7, 0, g);
      mesh(cone(0.15, 0.3, 8), M(0xff6f61), 0.32, 1.05, 0, g);
      break;
    }
    case 'stump': {
      mesh(cyl(0.42, 0.5, 0.75, 12), M(0x7a4f2a), 0, 0.37, 0, g).castShadow = true;
      mesh(cyl(0.38, 0.38, 0.02, 12), M(0xd9b27c), 0, 0.76, 0, g);
      break;
    }
    case 'snowCone': {
      mesh(cone(0.5, 0.85, 10), M(0xffffff), 0, 0.42, 0, g);
      mesh(sph(0.12, 8, 6), M(0xd84a4a), 0, 0.9, 0, g);
      break;
    }
    case 'jar': {
      const j = mesh(sph(0.45, 12, 10), M(0xc4683b), 0, 0.45, 0, g); j.scale.y = 1.05;
      mesh(cyl(0.2, 0.25, 0.25, 10), M(0xa0522d), 0, 0.92, 0, g);
      mesh(cyl(0.46, 0.46, 0.08, 12), M(0x2a9d8f), 0, 0.5, 0, g);
      break;
    }
    // ---- moving vehicles (come toward the player) ----
    case 'car': case 'buggy': case 'cart': case 'sled': case 'camelCart': default: {
      const col = opts.color ?? pick(P);
      const b = mesh(rbox(1.9, 0.9, 3.4, 0.25), M(col), 0, 0.8, 0, g); b.castShadow = true;
      mesh(rbox(1.6, 0.65, 1.7, 0.2), M(kind === 'sled' ? 0xd84a4a : 0x223344), 0, 1.5, 0.2, g);
      if (kind !== 'sled') wheels(g, [-0.88, 0.88], [-1.1, 1.1], 0.36, 0.36);
      else for (const x of [-0.8, 0.8]) mesh(box(0.1, 0.1, 3.6), M(0x999999), x, 0.15, 0, g);
      for (const x of [-0.6, 0.6]) mesh(box(0.35, 0.18, 0.05), glow(0xfff6c0), x, 0.85, 1.72, g);
      mesh(box(1.92, 0.08, 0.1), M(0x222222), 0, 0.5, 1.7, g);
      break;
    }
  }
  return g;
}
