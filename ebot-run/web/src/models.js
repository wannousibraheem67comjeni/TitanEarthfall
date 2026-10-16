// Procedural low-poly models: robots, thief, boss van, pickups, obstacles, scenery and houses.
// Everything is built from primitives so the game ships without external art assets.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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
export function roadTex(road, line, night) {
  return canvasTex('road' + road + line, 256, 256, (g, w, h) => {
    g.fillStyle = '#' + road.toString(16).padStart(6, '0'); g.fillRect(0, 0, w, h);
    // subtle asphalt noise
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    const lc = '#' + line.toString(16).padStart(6, '0');
    g.fillStyle = lc;
    if (night) { g.shadowColor = lc; g.shadowBlur = 8; }
    const lane = w / 3;
    for (const x of [lane, lane * 2]) for (let y = 0; y < h; y += 128) g.fillRect(x - 3, y + 16, 6, 70);
    g.fillRect(4, 0, 5, h); g.fillRect(w - 9, 0, 5, h);
  }, [1, 1]);
}
function windowsTex(night) {
  return canvasTex('win' + night, 64, 128, (g, w, h) => {
    g.fillStyle = night ? '#1c1638' : '#d8e6f5'; g.fillRect(0, 0, w, h);
    for (let y = 6; y < h - 6; y += 16) for (let x = 6; x < w - 6; x += 14) {
      const lit = Math.random() < (night ? 0.55 : 0.3);
      g.fillStyle = night ? (lit ? ['#ffe14d', '#39f3ff', '#ff3df2'][Math.floor(Math.random() * 3)] : '#2c2550') : (lit ? '#9fd4ff' : '#5a7da8');
      g.fillRect(x, y, 8, 10);
    }
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

// ---------- robots ----------
// Returns a rig with named pivots. The robot faces -Z (running direction).
export function makeRobot(skin, opts = {}) {
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const body = M(skin.body), acc = M(skin.accent), vis = M(skin.visor), eye = glow(skin.eye);

  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.22, 0.78, 0); legR.position.set(0.22, 0.78, 0);
  for (const lg of [legL, legR]) {
    mesh(caps(0.13, 0.36), acc, 0, -0.3, 0, lg);
    const foot = mesh(rbox(0.3, 0.18, 0.44, 0.07), body, 0, -0.66, -0.06, lg);
    foot.castShadow = true;
    rig.add(lg);
  }
  const torso = mesh(caps(0.4, 0.32), body, 0, 1.18, 0, rig);
  torso.scale.set(1, 1, 0.86); torso.castShadow = true;
  mesh(rbox(0.5, 0.36, 0.12, 0.05), acc, 0, 1.22, -0.32, rig);
  mesh(sph(0.075, 10, 8), glow(skin.eye), 0, 1.24, -0.39, rig);
  mesh(cyl(0.4, 0.4, 0.1, 18), acc, 0, 0.86, 0, rig);
  // back panel (seen by the camera while running)
  mesh(rbox(0.46, 0.5, 0.14, 0.06), acc, 0, 1.2, 0.33, rig);
  for (const x of [-0.11, 0.11]) mesh(sph(0.05, 8, 6), glow(skin.eye), x, 1.32, 0.41, rig);
  mesh(box(0.28, 0.05, 0.03), glow(skin.eye), 0, 1.12, 0.41, rig);

  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.53, 1.45, 0); armR.position.set(0.53, 1.45, 0);
  for (const a of [armL, armR]) {
    mesh(caps(0.11, 0.3), body, 0, -0.24, 0, a);
    mesh(sph(0.14, 12, 10), acc, 0, -0.52, 0, a);
    rig.add(a);
  }

  const head = new THREE.Group(); head.position.set(0, 2.0, 0); rig.add(head);
  const h = mesh(rbox(0.98, 0.8, 0.84, 0.24), body, 0, 0, 0, head); h.castShadow = true;
  mesh(rbox(0.8, 0.46, 0.1, 0.08), vis, 0, 0.02, -0.39, head);
  mesh(rbox(0.6, 0.3, 0.08, 0.06), acc, 0, 0.05, 0.4, head);
  const eyes = [];
  for (const x of [-0.18, 0.18]) eyes.push(mesh(rbox(0.15, 0.2, 0.05, 0.05), eye, x, 0.05, -0.45, head));
  mesh(box(0.2, 0.04, 0.03), eye, 0, -0.12, -0.45, head);
  if (opts.ears === 'pointy') {
    for (const x of [-0.34, 0.34]) { const e = mesh(cone(0.16, 0.36, 4), acc, x, 0.5, 0, head); e.rotation.z = x > 0 ? -0.35 : 0.35; }
  } else {
    for (const x of [-0.51, 0.51]) { const e = mesh(cyl(0.14, 0.14, 0.1, 14), acc, x, 0, 0, head); e.rotation.z = Math.PI / 2; }
    mesh(cyl(0.03, 0.03, 0.3, 6), acc, 0, 0.52, 0, head);
    mesh(sph(0.085, 10, 8), glow(skin.accent), 0, 0.7, 0, head);
  }
  if (opts.mask) mesh(box(1.0, 0.2, 0.06), M(0x111111), 0, 0.06, -0.47, head);

  // Jetpack (visible while flying).
  const jet = new THREE.Group(); jet.position.set(0, 1.25, 0.42); rig.add(jet);
  for (const x of [-0.17, 0.17]) {
    mesh(cyl(0.13, 0.13, 0.5, 12), acc, x, 0, 0, jet);
    const fl = mesh(cone(0.11, 0.5, 10), Basic(0xffa21f, { opacity: 0.9, blend: true }), x, -0.5, 0, jet);
    fl.rotation.x = Math.PI;
    fl.userData.flame = true;
  }
  jet.visible = !!opts.jet;

  if (opts.sack) {
    const sack = mesh(sph(0.48, 12, 10), M(0x9c6b3f), 0.1, 1.45, 0.55, rig);
    sack.scale.set(1, 1.1, 0.9);
    mesh(cyl(0.12, 0.2, 0.18, 8), M(0x6d4c2f), 0.1, 1.98, 0.55, rig);
    for (let i = 0; i < 3; i++) mesh(box(0.22, 0.08, 0.12), M(0xffc93c, { emissive: 0x664400, ei: 0.6 }), -0.05 + i * 0.12, 2.05 + i * 0.03, 0.5, rig);
  }
  if (opts.tail) {
    const tail = new THREE.Group(); tail.position.set(0, 0.95, 0.38); rig.add(tail);
    for (let i = 0; i < 4; i++) mesh(sph(0.13 - i * 0.012, 8, 6), i % 2 ? M(0x222222) : acc, 0, i * 0.12, 0.12 + i * 0.12, tail);
    tail.rotation.x = 0.6;
    root.userData.tail = tail;
  }

  const shadow = new THREE.Mesh(plane(1.4, 1.4), Basic(0xffffff, { map: blobShadowTex(), opacity: 1 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
  root.add(shadow);

  root.userData = { ...root.userData, rig, legL, legR, armL, armR, head, jet, eyes, shadow, torso };
  return root;
}

export const THIEF_SKIN = { body: 0x6b4fa0, accent: 0x3a2a5c, visor: 0x0b0814, eye: 0xff3d5a };
export function makeThief() {
  return makeRobot(THIEF_SKIN, { ears: 'pointy', mask: true, sack: true, tail: true });
}

// Animates a robot rig. phase advances with distance, mode: run|jump|slide|fly|idle|fall|wave
export function animateRobot(r, mode, phase, t) {
  const u = r.userData;
  const s = Math.sin(phase), c = Math.cos(phase);
  u.rig.rotation.set(0, 0, 0); u.rig.position.set(0, 0, 0);
  u.head.rotation.set(0, 0, 0);
  if (mode === 'run') {
    u.legL.rotation.x = s * 0.9; u.legR.rotation.x = -s * 0.9;
    u.armL.rotation.x = -s * 0.8; u.armR.rotation.x = s * 0.8;
    u.armL.rotation.z = -0.15; u.armR.rotation.z = 0.15;
    u.rig.position.y = Math.abs(c) * 0.12;
    u.rig.rotation.x = -0.12;
    u.head.rotation.z = s * 0.04;
  } else if (mode === 'jump') {
    u.legL.rotation.x = 0.9; u.legR.rotation.x = -0.3;
    u.armL.rotation.x = -2.4; u.armR.rotation.x = -2.4;
    u.armL.rotation.z = -0.3; u.armR.rotation.z = 0.3;
    u.rig.rotation.x = -0.2;
  } else if (mode === 'slide') {
    u.rig.rotation.x = 1.15; u.rig.position.y = 0.32; u.rig.position.z = 0.4;
    u.legL.rotation.x = -0.3; u.legR.rotation.x = -0.5;
    u.armL.rotation.x = -2.8; u.armR.rotation.x = -2.8;
  } else if (mode === 'fly') {
    u.rig.rotation.x = -0.35;
    u.legL.rotation.x = 0.4 + s * 0.15; u.legR.rotation.x = 0.4 - s * 0.15;
    u.armL.rotation.z = -1.2; u.armR.rotation.z = 1.2;
    u.rig.position.y = Math.sin(t * 4) * 0.1;
  } else if (mode === 'fall') {
    u.rig.rotation.x = 1.4; u.rig.position.y = 0.25; u.rig.position.z = 0.9;
    u.armL.rotation.z = -1.4; u.armR.rotation.z = 1.4;
    u.legL.rotation.x = -0.4; u.legR.rotation.x = 0.3;
  } else if (mode === 'wave') {
    u.armR.rotation.z = 2.6 + Math.sin(t * 8) * 0.35;
    u.armL.rotation.z = -0.15;
    u.legL.rotation.x = 0; u.legR.rotation.x = 0;
    u.rig.position.y = Math.abs(Math.sin(t * 4)) * 0.05;
    u.head.rotation.z = Math.sin(t * 2) * 0.08;
  } else { // idle
    u.legL.rotation.x = 0; u.legR.rotation.x = 0;
    u.armL.rotation.x = Math.sin(t * 2) * 0.08; u.armR.rotation.x = -Math.sin(t * 2) * 0.08;
    u.armL.rotation.z = -0.12; u.armR.rotation.z = 0.12;
    u.rig.position.y = Math.sin(t * 2.2) * 0.03;
    u.head.rotation.y = Math.sin(t * 0.9) * 0.25;
  }
  // flicker jet flames
  if (u.jet.visible) u.jet.children.forEach((ch) => { if (ch.userData.flame) ch.scale.y = 0.8 + Math.random() * 0.6; });
  // blink
  const blink = (t % 3.7) < 0.12 ? 0.15 : 1;
  u.eyes.forEach((e) => { e.scale.y = blink; });
  if (r.userData.tail) r.userData.tail.rotation.y = Math.sin(t * 6) * 0.4;
}

// ---------- boss van ----------
export function makeBossVan() {
  const g = new THREE.Group();
  const purple = M(0x5b3c99), dark = M(0x2a1d47);
  const bodyM = mesh(rbox(2.3, 2.1, 4.6, 0.3), purple, 0, 1.55, 0, g); bodyM.castShadow = true;
  mesh(rbox(2.32, 0.9, 1.6, 0.2), M(0x1a1030), 0, 2.0, -1.6, g); // windshield band (facing player = +z? van faces away)
  mesh(box(2.34, 0.25, 4.62), M(0xffc93c), 0, 1.0, 0, g);
  for (const [x, z] of [[-1.05, -1.5], [1.05, -1.5], [-1.05, 1.5], [1.05, 1.5]]) {
    const w = mesh(cyl(0.48, 0.48, 0.4, 14), M(0x111111), x, 0.5, z, g); w.rotation.z = Math.PI / 2;
    const hub = mesh(cyl(0.22, 0.22, 0.42, 10), M(0xbbbbbb), x, 0.5, z, g); hub.rotation.z = Math.PI / 2;
  }
  // rear doors facing the player (+z side, player is behind)
  mesh(box(2.0, 1.6, 0.06), dark, 0, 1.6, 2.32, g);
  const logo = mesh(plane(1.1, 1.1), Basic(0xffffff, { map: textTex('G', '#ff3d5a', '#ffffff') }), 0, 1.7, 2.37, g);
  logo.userData.logo = true;
  const light = mesh(sph(0.22, 12, 8), glow(0xff2020), 0, 2.75, 1.4, g);
  g.userData.light = light;
  const thief = makeThief(); thief.position.set(0, 2.62, 0.6); thief.rotation.y = Math.PI; thief.scale.setScalar(0.9);
  g.add(thief); g.userData.thief = thief;
  // arm with crane/hatch
  mesh(box(1.4, 0.15, 1.4), dark, 0, 2.62, 0.6, g);
  return g;
}

// ---------- pickups ----------
export function goldBarGeometry() {
  return G('goldbar', () => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.3, 0); shape.lineTo(0.3, 0); shape.lineTo(0.22, 0.24); shape.lineTo(-0.22, 0.24); shape.lineTo(-0.3, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    geo.translate(0, -0.12, -0.17);
    return geo;
  });
}
export function goldMaterial() { return M(0xffc21a, { emissive: 0x7a4b00, ei: 0.55 }); }

export function makeGem() {
  const g = new THREE.Group();
  const m = mesh(G('gem', () => new THREE.OctahedronGeometry(0.4, 0)), M(0x38d9ff, { emissive: 0x0a5a8a, ei: 0.8, flat: true }), 0, 0, 0, g);
  m.scale.set(0.8, 1.15, 0.8);
  return g;
}

export function makePowerup(type) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const bubble = mesh(sph(0.75, 18, 14), Basic(0xffffff, { opacity: 0.18 }), 0, 0, 0, g);
  bubble.renderOrder = 2;
  const ring = mesh(tor(0.78, 0.05, 6, 28), Basic(0xffffff, { opacity: 0.6 }), 0, 0, 0, g);
  ring.userData.ring = true;
  if (type === 'magnet') {
    const u = mesh(tor(0.3, 0.12, 8, 18, Math.PI), M(0xff3d5a), 0, 0.05, 0, inner); u.rotation.z = Math.PI;
    for (const x of [-0.3, 0.3]) mesh(box(0.25, 0.16, 0.25), M(0xdddddd), x, 0.1, 0, inner);
  } else if (type === 'shield') {
    const helm = mesh(G('helm', () => new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), M(0x39c6ff), 0, -0.1, 0, inner);
    helm.scale.set(1, 1.1, 1.1);
    mesh(box(0.06, 0.3, 0.8), M(0xffffff), 0, 0.2, 0, inner);
    mesh(box(0.6, 0.14, 0.1), M(0x14213d), 0, -0.05, -0.36, inner);
  } else if (type === 'jet') {
    mesh(caps(0.14, 0.6), M(0xffb020), 0, 0, 0, inner).rotation.x = Math.PI / 2;
    mesh(box(1.0, 0.05, 0.25), M(0xff7a00), 0, 0, 0.02, inner);
    mesh(box(0.4, 0.05, 0.15), M(0xff7a00), 0, 0, 0.36, inner);
    mesh(box(0.05, 0.22, 0.15), M(0xff7a00), 0, 0.1, 0.36, inner);
    mesh(sph(0.1, 8, 6), M(0x39c6ff), 0, 0.08, -0.22, inner);
    inner.rotation.y = 0.6;
  } else if (type === 'double') {
    const d = mesh(cyl(0.42, 0.42, 0.12, 24), M(0x9b5cff), 0, 0, 0, inner); d.rotation.x = Math.PI / 2;
    const f = mesh(plane(0.7, 0.7), Basic(0xffffff, { map: textTex('x2', null, '#ffffff') }), 0, 0, -0.07, inner); f.rotation.y = Math.PI;
    mesh(plane(0.7, 0.7), Basic(0xffffff, { map: textTex('x2', null, '#ffffff') }), 0, 0, 0.07, inner);
  } else if (type === 'vault') {
    mesh(rbox(0.7, 0.62, 0.6, 0.06), M(0x9aa4b2), 0, 0, 0, inner);
    const dial = mesh(cyl(0.16, 0.16, 0.06, 16), M(0x4b5563), 0, 0, -0.32, inner); dial.rotation.x = Math.PI / 2;
    mesh(box(0.05, 0.2, 0.02), M(0xffc93c), 0, 0, -0.36, inner);
    bubble.visible = false;
  }
  g.userData.inner = inner;
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

// ---------- scenery ----------
function tree(g, x, z, s, leaf = 0x4caf50, trunk = 0x7a4f2a) {
  mesh(cyl(0.18 * s, 0.25 * s, 1.6 * s, 7), M(trunk), x, 0.8 * s, z, g);
  const a = mesh(ico(1.1 * s, 0), M(leaf, { flat: true }), x, 2.2 * s, z, g); a.castShadow = true;
  mesh(ico(0.75 * s, 0), M(leaf, { flat: true }), x + 0.4 * s, 2.9 * s, z + 0.2, g);
}
function pine(g, x, z, s, snow) {
  mesh(cyl(0.18 * s, 0.22 * s, 1 * s, 6), M(0x6d4c41), x, 0.5 * s, z, g);
  for (let i = 0; i < 3; i++) {
    const c = mesh(cone((1.3 - i * 0.32) * s, 1.4 * s, 8), M(snow && i === 2 ? 0xffffff : 0x2f7d4a, { flat: true }), x, (1.3 + i * 0.85) * s, z, g);
    c.castShadow = i === 0;
    if (snow && i < 2) mesh(cone((1.0 - i * 0.3) * s, 0.35 * s, 8), M(0xffffff), x, (1.85 + i * 0.85) * s, z, g);
  }
}
function palm(g, x, z, s) {
  let px = x, py = 0;
  for (let i = 0; i < 6; i++) {
    const seg = mesh(cyl(0.16 * s, 0.2 * s, 0.7 * s, 7), M(i % 2 ? 0x9a7b4f : 0x8a6b3f), px, py + 0.35 * s, z, g);
    seg.rotation.z = -0.08 * i;
    px += 0.08 * i * s; py += 0.66 * s;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const l = mesh(box(0.3 * s, 0.06 * s, 1.9 * s), M(0x3fae49, { flat: true }), px + Math.cos(a) * 0.8 * s, py + 0.1 * s, z + Math.sin(a) * 0.8 * s, g);
    l.rotation.y = -a + Math.PI / 2; l.rotation.x = 0.35;
  }
  for (let i = 0; i < 3; i++) mesh(sph(0.15 * s, 6, 5), M(0x6d4c2f), px + (i - 1) * 0.15 * s, py - 0.1 * s, z, g);
}
function lamp(g, x, z, color = 0xfff3b0, side = 1) {
  mesh(cyl(0.07, 0.09, 4, 6), M(0x555c66), x, 2, z, g);
  mesh(box(0.9, 0.08, 0.08), M(0x555c66), x - 0.45 * side, 4, z, g);
  mesh(box(0.35, 0.12, 0.25), glow(color), x - 0.85 * side, 3.92, z, g);
}
function houseProp(g, x, z, w, h, d, wall, roof, night) {
  const b = mesh(box(w, h, d), M(wall), x, h / 2, z, g); b.castShadow = true;
  const r = mesh(cone(Math.max(w, d) * 0.78, h * 0.6, 4), M(roof, { flat: true }), x, h + h * 0.3, z, g);
  r.rotation.y = Math.PI / 4;
  const winM = night ? glow(0xffe14d) : M(0x9fd4ff);
  const sx = x > 0 ? -1 : 1;
  for (const dz of [-d * 0.25, d * 0.25]) mesh(box(0.05, 0.7, 0.7), winM, x + sx * (w / 2 + 0.03), h * 0.6, z + dz, g);
  mesh(box(0.05, 1.3, 0.8), M(0x8a5a2b), x + sx * (w / 2 + 0.03), 0.65, z, g);
}
function tower(g, x, z, w, h, d, night, col) {
  const t = windowsTex(night);
  const mat = night ? M(0xffffff, { map: t, emissive: 0xffffff, ei: 0.0 }) : M(0xffffff, { map: t });
  if (night) { mat.emissiveMap = t; mat.emissiveIntensity = 0.9; mat.emissive = new THREE.Color(0xffffff); }
  const b = mesh(box(w, h, d), mat, x, h / 2, z, g);
  b.material = mat;
  if (col !== undefined) mesh(box(w + 0.1, 0.3, d + 0.1), night ? glow(col) : M(col), x, h, z, g);
}
function rock(g, x, z, s, col = 0x8a8f96) { const r = mesh(dode(s), M(col, { flat: true }), x, s * 0.6, z, g); r.rotation.set(x, z, 0); }

// Builds one roadside decoration chunk for a given side (-1 left, 1 right).
export function makeSceneryChunk(world, side, len, rng = Math.random) {
  const g = new THREE.Group();
  const P = world.palette;
  const near = 6.4;
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const z = -((i + 0.5) / n) * len + (rng() - 0.5) * 4;
    const x = side * (near + 1.5 + rng() * 5);
    const r = rng();
    switch (world.props) {
      case 'city':
        if (r < 0.5) houseProp(g, side * (near + 3.5 + rng() * 3), z, 3.5 + rng() * 2, 2.6 + rng() * 1.5, 3.5 + rng() * 2, pick(P, rng), pick([0xe9573f, 0x7d4e9e, 0x3a6ea5, 0x4f7942], rng), false);
        else if (r < 0.8) tree(g, x, z, 0.9 + rng() * 0.5);
        else { mesh(box(0.8, 0.8, 4), M(0x3f8f3a), side * (near + 0.6), 0.4, z, g); }
        break;
      case 'neon':
        if (r < 0.65) tower(g, side * (near + 4 + rng() * 4), z, 4 + rng() * 3, 8 + rng() * 16, 4 + rng() * 3, true, pick(P, rng));
        else { const c = pick(P, rng); mesh(box(0.2, 3, 0.2), M(0x2b2550), x, 1.5, z, g); mesh(box(2.4, 1.2, 0.12), glow(c), x, 3.4, z, g).rotation.y = side * 0.6; }
        break;
      case 'island':
        if (r < 0.55) palm(g, x, z, 0.9 + rng() * 0.4);
        else if (r < 0.75) { mesh(cyl(0.05, 0.05, 2.4, 5), M(0xffffff), x, 1.2, z, g); const u = mesh(cone(1.3, 0.6, 8), M(pick([0xff6f61, 0x2ec4b6, 0xffbf69], rng)), x, 2.4, z, g); u.castShadow = true; }
        else rock(g, x, z, 0.6 + rng() * 0.6, 0xc9b28a);
        break;
      case 'forest':
        if (r < 0.6) tree(g, x, z, 1.2 + rng() * 0.8, pick([0x2f7d32, 0x4caf50, 0x388e3c], rng), 0x5d4037);
        else if (r < 0.8) { const gr = mesh(tor(1.1, 0.25, 6, 16), M(0x9e8f6a, { flat: true }), x, 1.4, z, g); gr.rotation.y = Math.PI / 2; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; mesh(box(0.3, 0.4, 0.4), M(0x9e8f6a), x, 1.4 + Math.sin(a) * 1.4, z + Math.cos(a) * 1.4, g); } }
        else { mesh(cyl(0.12, 0.15, 0.6, 6), M(0xfff1d6), x, 0.3, z, g); mesh(sph(0.45, 10, 6), M(0xe53935), x, 0.65, z, g).scale.y = 0.6; }
        break;
      case 'snow':
        if (r < 0.65) pine(g, x, z, 1 + rng() * 0.6, true);
        else if (r < 0.85) { const s = mesh(sph(1.4, 10, 8), M(0xffffff), x, 0, z, g); s.scale.y = 0.5; }
        else houseProp(g, side * (near + 4), z, 3.5, 2.6, 3.5, 0x8a5a3b, 0xffffff, false);
        break;
      case 'desert':
      default:
        if (r < 0.35) palm(g, x, z, 0.9 + rng() * 0.4);
        else if (r < 0.65) {
          const hx = side * (near + 3.5 + rng() * 2);
          mesh(box(3.2, 2.6, 3.2), M(0xf6e3c0), hx, 1.3, z, g).castShadow = true;
          mesh(G('dome', () => new THREE.SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), M(pick([0xd4a017, 0x2a9d8f, 0xffffff], rng)), hx, 2.6, z, g);
          mesh(box(0.06, 1.2, 0.8), M(0x2a9d8f), hx - side * 1.62, 0.6, z, g);
        } else if (r < 0.85) { const d = mesh(sph(2.5, 12, 8), M(0xe9b872), x + side * 2, -0.6, z, g); d.scale.set(1.4, 0.55, 1); }
        else { mesh(cyl(0.06, 0.06, 2.8, 5), M(0x3b2a1a), x, 1.4, z, g); mesh(G('lant', () => new THREE.OctahedronGeometry(0.28, 0)), glow(0xffb347), x, 2.95, z, g); }
        break;
    }
  }
  // lamps along the road
  if (world.props === 'city' || world.props === 'neon' || world.props === 'snow') lamp(g, side * (near - 0.3), -len * 0.5, world.night ? 0xff3df2 : 0xfff3b0, side);
  if (world.props === 'desert' && rng() < 0.6) { mesh(cyl(0.05, 0.05, 2.4, 5), M(0x3b2a1a), side * (near - 0.2), 1.2, -len * 0.5, g); mesh(G('lant', () => new THREE.OctahedronGeometry(0.28, 0)), glow(0xffb347), side * (near - 0.2), 2.55, -len * 0.5, g); }
  return g;
}

// Ground tile: road + sidewalks + terrain, length `len` along -Z starting at z=0.
export function makeGroundTile(world, len) {
  const g = new THREE.Group();
  const roadW = 8.6;
  const road = mesh(plane(roadW, len), M(0xffffff, { map: roadTex(world.road, world.line, world.night) }), 0, 0, -len / 2, g);
  road.rotation.x = -Math.PI / 2; road.receiveShadow = true;
  for (const s of [-1, 1]) {
    const curb = mesh(box(1.4, 0.18, len), M(world.side), s * (roadW / 2 + 0.7), 0.09, -len / 2, g); curb.receiveShadow = true;
    const ground = mesh(plane(70, len), M(world.ground), s * (roadW / 2 + 1.4 + 35), -0.01, -len / 2, g);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    if (world.water) {
      const w = mesh(plane(60, len), M(world.water, { emissive: 0x0a4a55, ei: 0.3 }), s * (roadW / 2 + 14 + 30), 0.02, -len / 2, g);
      w.rotation.x = -Math.PI / 2;
    }
    if (world.night) mesh(box(0.08, 0.06, len), glow(s < 0 ? 0xff3df2 : 0x39f3ff), s * (roadW / 2 + 0.02), 0.2, -len / 2, g);
  }
  return g;
}

// ---------- sky ----------
export function makeSky(world) {
  const geo = new THREE.SphereGeometry(450, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(world.sky[0]) }, bottom: { value: new THREE.Color(world.sky[1]) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(vp.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
  });
  const sky = new THREE.Mesh(geo, mat);
  const g = new THREE.Group(); g.add(sky);
  if (world.night) {
    const pts = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 + 0.1, r = 420;
      pts[i * 3] = Math.cos(a) * Math.cos(e) * r; pts[i * 3 + 1] = Math.sin(e) * r; pts[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    g.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false })));
    const moon = mesh(sph(14, 16, 12), Basic(0xfff6d8, { fog: false }), -120, 160, -330, g);
    moon.material.fog = false;
  } else {
    const sun = mesh(sph(18, 16, 12), Basic(0xfff6d0, { fog: false }), 140, 170, -360, g);
    sun.material.fog = false;
    const cloudM = Basic(0xffffff, { opacity: 0.92, fog: false });
    for (let i = 0; i < 12; i++) {
      const c = new THREE.Group();
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      c.position.set(Math.cos(a) * 330, 70 + Math.random() * 80, Math.sin(a) * 330);
      for (let k = 0; k < 4; k++) mesh(sph(10 + Math.random() * 8, 10, 8), cloudM, k * 12 - 18, Math.random() * 6, Math.random() * 6, c);
      c.lookAt(0, c.position.y, 0);
      g.add(c);
    }
  }
  return g;
}

// ---------- houses (lobby) ----------
// Builds the full house; parts are tagged with the stage that reveals them (0 = scaffolding).
export function makeHouse(world) {
  const g = new THREE.Group();
  const H = world.house;
  const parts = [[], [], [], [], [], []];
  const add = (stage, m) => { parts[stage].push(m); return m; };
  const wall = M(H.wall), roof = M(H.roof, { flat: true }), trim = M(H.trim);
  const winM = world.night ? glow(0xffe58a) : M(0xa8dcff, { emissive: 0x2a5a80, ei: 0.25 });
  const plot = mesh(cyl(7.5, 7.8, 0.4, 32), M(world.side), 0, -0.2, 0, g); plot.receiveShadow = true;
  const grassTop = mesh(cyl(7.3, 7.3, 0.05, 32), M(world.ground), 0, 0.01, 0, g); grassTop.receiveShadow = true;

  // stage 0: construction site
  const scaffold = new THREE.Group(); g.add(scaffold); add(0, scaffold);
  for (const [x, z] of [[-2.3, -1.8], [2.3, -1.8], [-2.3, 1.8], [2.3, 1.8]]) mesh(box(0.12, 4.2, 0.12), M(0xffb020), x, 2.1, z, scaffold);
  for (const y of [1.4, 2.8, 4.1]) { mesh(box(4.7, 0.1, 0.1), M(0xffb020), 0, y, 1.8, scaffold); mesh(box(4.7, 0.1, 0.1), M(0xffb020), 0, y, -1.8, scaffold); }
  const sign = mesh(box(1.6, 1.0, 0.08), M(0xffffff, { map: stripeTex('#1b1b1b', '#ffcc00') }), 3.4, 1.2, 2.4, scaffold);
  sign.rotation.y = -0.4;
  mesh(box(0.08, 1.2, 0.08), M(0x555555), 3.4, 0.6, 2.4, scaffold);
  for (const x of [-3.6, -2.9]) mesh(cone(0.3, 0.7, 10), M(0xff6d00), x, 0.35, 3, scaffold);

  const style = H.style;
  if (style === 'classic' || style === 'chalet' || style === 'cabin') {
    add(1, mesh(box(4.4, 0.3, 3.6), M(0x9e9e9e), 0, 0.15, 0, g));
    const w = add(1, mesh(box(4.2, 2.8, 3.4), wall, 0, 1.7, 0, g)); w.castShadow = true;
    if (style === 'cabin') for (let y = 0.5; y < 3; y += 0.45) add(1, mesh(box(4.25, 0.06, 3.45), M(0x6d4c2f), 0, y, 0, g));
    // gable roof
    const roofGeo = G('gable' + style, () => {
      const s = new THREE.Shape(); s.moveTo(-2.6, 0); s.lineTo(2.6, 0); s.lineTo(0, style === 'cabin' ? 2.4 : 1.8); s.lineTo(-2.6, 0);
      const e = new THREE.ExtrudeGeometry(s, { depth: 4.0, bevelEnabled: false }); e.translate(0, 0, -2.0); return e;
    });
    const r = add(2, mesh(roofGeo, roof, 0, 3.1, 0, g)); r.castShadow = true;
    add(2, mesh(box(0.6, 1.2, 0.6), M(0x8a5a3b), 1.3, 4.0, -0.6, g));
    // door & windows (front faces +z toward the camera)
    add(3, mesh(box(0.9, 1.6, 0.08), M(0x7a4f2a), 0, 1.1, 1.72, g));
    add(3, mesh(sph(0.06, 6, 4), M(0xffc93c), 0.3, 1.1, 1.78, g));
    for (const x of [-1.4, 1.4]) { add(3, mesh(box(0.9, 0.8, 0.06), winM, x, 2.0, 1.72, g)); add(3, mesh(box(1.06, 0.1, 0.1), trim, x, 1.55, 1.75, g)); }
    add(3, mesh(box(0.9, 0.7, 0.06), winM, 0, 3.6, 2.0, g));
    if (style === 'chalet') for (let i = 0; i < 8; i++) { const c = mesh(cone(0.07, 0.35, 5), M(0xdff6ff), -2.3 + i * 0.66, 2.95, 2.05, g); c.rotation.x = Math.PI; add(3, c); }
  } else if (style === 'modern') {
    const a = add(1, mesh(box(4.6, 2.4, 3.6), wall, 0, 1.2, 0, g)); a.castShadow = true;
    const b = add(2, mesh(box(3.4, 2.0, 3.0), wall, 0.6, 3.4, -0.2, g)); b.castShadow = true;
    add(2, mesh(box(3.6, 0.15, 3.2), trim, 0.6, 4.45, -0.2, g));
    add(3, mesh(box(2.6, 1.4, 0.06), winM, -0.6, 1.3, 1.82, g));
    add(3, mesh(box(2.2, 1.0, 0.06), winM, 0.6, 3.4, 1.32, g));
    add(3, mesh(box(0.8, 1.8, 0.06), M(0x111111), 1.5, 0.9, 1.82, g));
    add(5, mesh(box(4.7, 0.08, 0.08), glow(H.trim), 0, 2.4, 1.82, g));
    add(5, mesh(box(0.08, 2.4, 0.08), glow(0x39f3ff), -2.3, 1.2, 1.82, g));
  } else if (style === 'beach') {
    for (const [x, z] of [[-1.8, -1.4], [1.8, -1.4], [-1.8, 1.4], [1.8, 1.4]]) add(1, mesh(cyl(0.15, 0.15, 1.4, 8), M(0x8a6b3f), x, 0.7, z, g));
    add(1, mesh(box(4.4, 0.25, 3.8), M(0xc98b3c), 0, 1.45, 0, g));
    const w = add(1, mesh(box(3.6, 2.2, 3.0), wall, 0, 2.65, 0, g)); w.castShadow = true;
    const r = add(2, mesh(cone(3.4, 2.2, 4), roof, 0, 4.85, 0, g)); r.rotation.y = Math.PI / 4; r.castShadow = true;
    add(3, mesh(box(0.9, 1.5, 0.06), M(0x2ec4b6), 0, 2.4, 1.52, g));
    for (const x of [-1.15, 1.15]) add(3, mesh(box(0.7, 0.6, 0.06), winM, x, 2.9, 1.52, g));
    for (let i = 0; i < 5; i++) add(3, mesh(box(1.0, 0.08, 0.3), M(0x8a6b3f), 0, 0.2 + i * 0.27, 2.0 + i * 0.05 - 0.0 + (4 - i) * 0.3, g));
  } else if (style === 'arabian') {
    const w = add(1, mesh(box(4.6, 3.0, 3.8), wall, 0, 1.5, 0, g)); w.castShadow = true;
    add(1, mesh(box(4.8, 0.25, 4.0), M(0xe0c9a0), 0, 3.05, 0, g));
    const d = add(2, mesh(G('bigdome', () => new THREE.SphereGeometry(1.7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), roof, 0, 3.15, 0, g)); d.castShadow = true;
    add(2, mesh(cyl(0.05, 0.05, 0.8, 6), M(0xd4a017), 0, 5.1, 0, g));
    add(2, mesh(sph(0.15, 8, 6), M(0xd4a017), 0, 5.5, 0, g));
    for (const x of [-2.6, 2.6]) { add(2, mesh(cyl(0.35, 0.4, 4.6, 10), wall, x, 2.3, -1.6, g)); add(2, mesh(G('smalldome', () => new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), roof, x, 4.6, -1.6, g)); }
    const arch = G('arch', () => { const s = new THREE.Shape(); s.moveTo(-0.55, 0); s.lineTo(0.55, 0); s.lineTo(0.55, 1.3); s.absarc(0, 1.3, 0.55, 0, Math.PI, false); s.lineTo(-0.55, 0); return new THREE.ShapeGeometry(s); });
    add(3, mesh(arch, M(H.trim), 0, 0, 1.92, g));
    for (const x of [-1.5, 1.5]) add(3, mesh(arch, winM, x, 1.2, 1.92, g)).scale.set(0.6, 0.6, 1);
  }

  // stage 4: garden
  const fenceM = M(style === 'modern' ? 0x2b2550 : 0xffffff);
  for (let i = -6; i <= 6; i++) {
    if (Math.abs(i) <= 1) continue;
    add(4, mesh(box(0.12, 0.8, 0.12), fenceM, i * 0.5, 0.4, 4.6, g));
  }
  for (const x of [-2, 2]) add(4, mesh(box(2.1, 0.08, 0.06), fenceM, x, 0.6, 4.6, g)); // rails
  add(4, mesh(box(1.4, 0.03, 3.0), M(0xd9d0c0), 0, 0.04, 3.2, g));
  const leaf = style === 'chalet' ? null : (style === 'arabian' || style === 'beach') ? 'palm' : 'tree';
  for (const [x, z] of [[-5, 1], [5, -0.5], [-4.3, -3.6]]) {
    const tg = new THREE.Group(); g.add(tg); add(4, tg);
    if (leaf === 'palm') palm(tg, x, z, 1.0);
    else if (style === 'chalet') pine(tg, x, z, 1.1, true);
    else tree(tg, x, z, 1.1, style === 'modern' ? 0x7b61ff : 0x4caf50);
  }
  for (let i = 0; i < 10; i++) {
    const fx = -3.2 + (i % 5) * 0.35 + (i >= 5 ? 4.9 : 0), fz = 2.3 + ((i * 37) % 7) * 0.12;
    add(4, mesh(sph(0.13, 6, 5), M([0xff4fa3, 0xffe14d, 0xff7a59, 0xffffff][i % 4]), fx, 0.2, fz, g));
  }
  add(4, mesh(box(0.35, 0.3, 0.45), M(H.trim), 2.6, 1.0, 4.4, g));
  add(4, mesh(box(0.08, 0.9, 0.08), M(0x555555), 2.6, 0.45, 4.4, g));

  // stage 5: decorations
  for (let i = 0; i < 9; i++) add(5, mesh(sph(0.09, 6, 4), glow([0xff3d5a, 0xffe14d, 0x39f3ff][i % 3]), -2.0 + i * 0.5, 3.0 + Math.sin(i / 8 * Math.PI) * -0.25, 1.95, g));
  add(5, mesh(cyl(0.04, 0.04, 2.2, 6), M(0xcccccc), -2.6, 4.3, -1.2, g));
  const flag = add(5, mesh(plane(0.9, 0.55), M(H.trim, { side: true }), -2.15, 5.1, -1.2, g)); flag.userData.flag = true;
  const dish = add(5, mesh(G('dish', () => new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3)), M(0xdddddd, { side: true }), 1.9, 3.7, -1.3, g));
  dish.rotation.x = -0.9;
  const statue = new THREE.Group(); statue.position.set(4.6, 0.4, 3.4); statue.scale.setScalar(0.45); statue.rotation.y = -0.6; g.add(statue); add(5, statue);
  mesh(cyl(0.9, 1.0, 0.8, 12), M(0xdddddd), 0, -0.4, 0, statue);
  const gold = makeRobot({ body: 0xffd34d, accent: 0xff9f1c, visor: 0x3b2500, eye: 0xffffff });
  gold.userData.shadow.visible = false; gold.rotation.y = Math.PI; statue.add(gold);

  g.userData.parts = parts;
  return g;
}

export function setHouseStage(house, stage) {
  const parts = house.userData.parts;
  for (let s = 0; s < parts.length; s++) {
    const vis = s === 0 ? stage < 3 : s <= stage;
    for (const p of parts[s]) p.visible = vis;
  }
}
