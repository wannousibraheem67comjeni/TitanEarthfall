// house.js - Hopinet lobby "hero": the luxurious home plots of the six worlds.
//
// Contents
//   * Toolkit: a small batching kit (class B) that bakes every static primitive into per-material merged
//     meshes with vertex colours, procedural canvas textures (tiles, planks, stone, thatch, blueprints ...),
//     shader materials (animated pool/lagoon water, waterfalls, soft billboard glows and particles), a
//     foliage wind-sway patch, lofted bodies (supercar, yacht) and a handful of reusable details
//     (windows with lit interiors, doors, trees, palms, pines, flower beds, lamps, flags ...).
//   * Island: organic round island (radius ~12) with beach ring, animated lagoon + foam, shore decoration.
//   * Build stages 0..5 (all parts are built once and just shown/hidden): construction site with crane,
//     excavator, scaffolding, fence and style-specific blueprint board; raw structure; roof + facade;
//     glass, doors, interiors and lanterns; garden, paths, driveway, trees, dock; grand finale lighting,
//     flags, smoke and fireflies. One design per world style: villa, penthouse, bungalow, treehouse,
//     chalet, palace.
//   * The ten luxury items (lights, garden, fountain, pool, gazebo, solar, supercar, helipad, yacht,
//     statue), each at its own fixed spot so any subset looks right.
//   * Animation: water, spray, smoke, flags, rotors, crane, excavator, yacht bobbing, twinkles, snow ...
//
// Public API (see docs/CONTRACTS.md): makeHome, setHomeStage, setHomeItems, updateHome
// (+ optional disposeHome). Everything is static geometry merged per material, so a complete home with
// all items is roughly 120-150 draw calls (shadow pass included).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SEA_Y } from './config.js';
import { G } from './models.js';

const PI = Math.PI;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Seeded random (build time only; never used inside per-frame code).
function mkRng(s) {
  let a = s >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let RNG = mkRng(1);
const R = () => RNG();
const Rr = (a, b) => a + (b - a) * RNG();
const seedBuild = (s) => { RNG = mkRng(s); };

// ---------- colours ----------
const _col = new THREE.Color();
const _cc = new Map();
function rgb(hex) {
  let c = _cc.get(hex);
  if (!c) { _col.setHex(hex); c = [_col.r, _col.g, _col.b]; _cc.set(hex, c); }
  return c;
}
const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f).getHex();

// ---------- procedural canvas textures (grey-scale detail, tinted by vertex colours) ----------
const V = (v, a = 1) => { const n = Math.round(clamp(v, 0, 1) * 255); return `rgba(${n},${n},${n},${a})`; };
function rrPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr); g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr); g.arcTo(x, y, x + w, y, rr); g.closePath();
}
// draw a soft blob with wrap-around so the texture tiles seamlessly
function wrapBlob(g, w, h, x, y, r, style) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const cx = x + ox * w, cy = y + oy * h;
    if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
    g.fillStyle = style; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  }
}
function drawPlan(g, w, h, style) {
  g.fillStyle = '#1e5fb0'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
  for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
  const P = (pts, close) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); if (close) g.closePath(); g.stroke(); };
  const R_ = (x, y, ww, hh) => g.strokeRect(x, y, ww, hh);
  const C = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); };
  if (style === 'villa') {
    R_(70, 78, 130, 56); P([[62, 78], [135, 36], [208, 78]], true); R_(122, 104, 20, 30); R_(84, 92, 20, 16); R_(168, 92, 20, 16);
    R_(40, 50, 26, 84); P([[36, 50], [53, 26], [70, 50]], true);
  } else if (style === 'penthouse') {
    R_(48, 104, 160, 30); R_(70, 76, 120, 28); R_(48, 50, 90, 26); R_(86, 30, 54, 20); P([[110, 30], [110, 12]]); C(110, 10, 3);
    for (let i = 0; i < 6; i++) R_(58 + i * 24, 112, 14, 16);
  } else if (style === 'bungalow') {
    R_(70, 84, 120, 40); P([[56, 84], [130, 40], [204, 84]], true); P([[78, 124], [78, 142]]); P([[130, 124], [130, 142]]); P([[182, 124], [182, 142]]);
    P([[40, 124], [220, 124]]); R_(120, 96, 20, 28);
  } else if (style === 'treehouse') {
    C(128, 44, 34); P([[116, 78], [112, 134]]); P([[140, 78], [146, 134]]); R_(86, 92, 40, 26); P([[80, 92], [106, 72], [132, 92]], true);
    P([[60, 100], [86, 100]]); P([[60, 134], [196, 134]]);
  } else if (style === 'chalet') {
    P([[40, 134], [96, 52], [152, 134]], true); R_(152, 94, 66, 40); P([[146, 94], [185, 62], [224, 94]], true); R_(180, 108, 14, 26);
    P([[96, 70], [96, 120]]);
  } else {
    g.beginPath(); g.arc(128, 62, 28, Math.PI, 0); g.stroke(); P([[100, 62], [100, 96]]); P([[156, 62], [156, 96]]); R_(70, 96, 116, 38);
    R_(36, 50, 18, 84); R_(202, 50, 18, 84); P([[36, 50], [45, 30], [54, 50]], true); P([[202, 50], [211, 30], [220, 50]], true);
    g.beginPath(); g.arc(128, 134, 14, Math.PI, 0); g.stroke();
  }
  g.fillStyle = '#ffd23f'; g.fillRect(8, 8, 56, 8); g.fillRect(8, 20, 34, 5);
  g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.beginPath(); g.moveTo(40, 148); g.lineTo(216, 148); g.stroke();
}
const TEXDEF = {
  // terracotta barrel tiles / shingles
  tile: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.7); g.fillRect(0, 0, w, h);
    const rows = 4, cols = 4, th = h / rows, tw = w / cols;
    for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
      const x = i * tw + (j % 2) * tw / 2, y = j * th, v = 0.9 + r() * 0.1;
      const gr = g.createLinearGradient(0, y, 0, y + th);
      gr.addColorStop(0, V(v)); gr.addColorStop(0.7, V(v * 0.95)); gr.addColorStop(1, V(v * 0.62));
      g.fillStyle = gr; rrPath(g, x + 1.5, y + 1, tw - 3, th - 1, tw * 0.38); g.fill();
      g.fillStyle = V(1, 0.25); g.fillRect(x + tw * 0.3, y + 2, tw * 0.12, th * 0.55);
    }
  } },
  plank: { w: 128, draw(g, w, h, r) {
    const n = 4, ph = h / n;
    for (let j = 0; j < n; j++) {
      const v = 0.84 + r() * 0.16;
      g.fillStyle = V(v); g.fillRect(0, j * ph, w, ph);
      for (let k = 0; k < 14; k++) { g.fillStyle = V(0.55, 0.12 + r() * 0.1); g.fillRect(r() * w, j * ph + 2 + r() * (ph - 5), 14 + r() * 50, 1); }
      g.fillStyle = V(0.45); g.fillRect(0, j * ph + ph - 2.5, w, 2.5);
      g.fillStyle = V(0.55); g.fillRect(r() * w, j * ph, 1.5, ph);
    }
  } },
  log: { w: 128, draw(g, w, h, r) {
    const n = 4, ph = h / n;
    for (let j = 0; j < n; j++) {
      const gr = g.createLinearGradient(0, j * ph, 0, (j + 1) * ph);
      const v = 0.92 + r() * 0.08;
      gr.addColorStop(0, V(v * 0.5)); gr.addColorStop(0.18, V(v * 0.9)); gr.addColorStop(0.5, V(v)); gr.addColorStop(0.85, V(v * 0.85)); gr.addColorStop(1, V(v * 0.45));
      g.fillStyle = gr; g.fillRect(0, j * ph, w, ph);
      for (let k = 0; k < 10; k++) { g.fillStyle = V(0.5, 0.14); g.fillRect(r() * w, j * ph + 4 + r() * (ph - 8), 10 + r() * 40, 1); }
    }
  } },
  stone: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.6); g.fillRect(0, 0, w, h);
    const rows = 4, rh = h / rows;
    for (let j = 0; j < rows; j++) {
      let x = -r() * 20;
      while (x < w) {
        const bw = 28 + r() * 30, v = 0.82 + r() * 0.18;
        g.fillStyle = V(v); rrPath(g, x + 1.5, j * rh + 1.5, bw - 3, rh - 3, 4); g.fill();
        g.fillStyle = V(1, 0.14); g.fillRect(x + 3, j * rh + 3, bw - 8, 3);
        x += bw;
      }
    }
  } },
  brick: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.62); g.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows, bw = w / 4;
    for (let j = 0; j < rows; j++) for (let i = -1; i < 4; i++) {
      const x = i * bw + (j % 2) * bw / 2;
      g.fillStyle = V(0.86 + r() * 0.14); g.fillRect(x + 1.5, j * rh + 1.5, bw - 3, rh - 3);
    }
  } },
  stucco: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.95); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) wrapBlob(g, w, h, r() * w, r() * h, 2 + r() * 9, V(r() < 0.5 ? 0.86 : 1, 0.07));
  } },
  ground: { w: 256, draw(g, w, h, r) {
    g.fillStyle = V(0.93); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) wrapBlob(g, w, h, r() * w, r() * h, 10 + r() * 26, V(r() < 0.5 ? 0.82 : 1, 0.09));
    for (let i = 0; i < 1400; i++) { g.fillStyle = V(0.7 + r() * 0.3, 0.3); g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 2 + r() * 4); }
  } },
  sand: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.95); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { g.fillStyle = V(r() < 0.5 ? 0.78 : 1, 0.28); g.fillRect(r() * w, r() * h, 1.4, 1.4); }
    for (let j = 0; j < 4; j++) { g.strokeStyle = V(0.82, 0.35); g.lineWidth = 2; g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, j * 32 + 16 + Math.sin(x / w * TAU * 2 + j) * 4); g.stroke(); }
  } },
  thatch: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.8); g.fillRect(0, 0, w, h);
    const rows = 4, rh = h / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < 90; i++) {
        const x = r() * w, y = j * rh + r() * rh * 0.6;
        g.strokeStyle = V(0.55 + r() * 0.45, 0.7); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y + rh * (0.5 + r() * 0.6)); g.stroke();
      }
      const gr = g.createLinearGradient(0, j * rh + rh * 0.6, 0, (j + 1) * rh);
      gr.addColorStop(0, V(0, 0)); gr.addColorStop(1, V(0.1, 0.55));
      g.fillStyle = gr; g.fillRect(0, j * rh + rh * 0.6, w, rh * 0.4);
    }
  } },
  bark: { w: 64, h: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.82); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = V(r() < 0.6 ? 0.55 : 1, 0.22); g.fillRect(r() * w, r() * h, 2 + r() * 3, 14 + r() * 50); }
  } },
  paver: { w: 64, draw(g, w, h, r) {
    g.fillStyle = V(0.55); g.fillRect(0, 0, w, h);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      g.fillStyle = V(0.86 + r() * 0.14); rrPath(g, i * 32 + 2, j * 32 + 2, 28, 28, 4); g.fill();
    }
  } },
  concrete: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.9); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) wrapBlob(g, w, h, r() * w, r() * h, 3 + r() * 8, V(r() < 0.5 ? 0.75 : 1, 0.09));
    for (let i = 0; i < 300; i++) { g.fillStyle = V(0.6, 0.25); g.fillRect(r() * w, r() * h, 1, 1); }
  } },
  dirt: { w: 128, draw(g, w, h, r) {
    g.fillStyle = V(0.88); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) wrapBlob(g, w, h, r() * w, r() * h, 3 + r() * 12, V(r() < 0.5 ? 0.7 : 1, 0.15));
    for (let i = 0; i < 160; i++) wrapBlob(g, w, h, r() * w, r() * h, 1 + r() * 2.2, V(r() < 0.5 ? 0.45 : 1, 0.6));
  } },
  solar: { w: 128, draw(g, w, h) {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#2c4f99'); gr.addColorStop(0.5, '#142c63'); gr.addColorStop(1, '#223f86');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(190,210,255,0.85)'; g.lineWidth = 1.5;
    for (let i = 0; i <= 6; i++) { g.beginPath(); g.moveTo(i * w / 6, 0); g.lineTo(i * w / 6, h); g.stroke(); }
    for (let j = 0; j <= 10; j++) { g.beginPath(); g.moveTo(0, j * h / 10); g.lineTo(w, j * h / 10); g.stroke(); }
    g.strokeStyle = 'rgba(235,240,255,0.9)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  } },
  net: { w: 64, draw(g, w, h) {
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5;
    g.beginPath(); for (let i = -2; i <= 4; i++) { g.moveTo(i * 16, 0); g.lineTo(i * 16 + 64, 64); g.moveTo(i * 16 + 64, 0); g.lineTo(i * 16, 64); } g.stroke();
  } },
  plan: { w: 256, h: 160, draw: (g, w, h) => drawPlan(g, w, h, 'villa') },
  plan_villa: { w: 256, h: 160, draw: (g, w, h) => drawPlan(g, w, h, 'villa') },
  plan_penthouse: { w: 256, h: 160, draw: (g, w, h) => drawPlan(g, w, h, 'penthouse') },
  plan_bungalow: { w: 256, h: 160, draw: (g, w, h) => drawPlan(g, w, h, 'bungalow') },
  plan_treehouse: { w: 256, h: 160, draw: (g, w, h) => drawPlan(g, w, h, 'treehouse') },
  plan_chalet: { w: 256, h: 160, draw: (g, w, h) => drawPlan(g, w, h, 'chalet') },
  plan_palace: { w: 256, h: 160, draw: (g, w, h) => drawPlan(g, w, h, 'palace') },
  glow: { w: 64, draw(g, w, h) {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#ddd');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  } },
  foamring: { w: 128, draw(g, w, h) {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)'); gr.addColorStop(0.72, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  } },
};
const TEX = {};
function tex(name) {
  if (TEX[name]) return TEX[name];
  const d = TEXDEF[name];
  const c = document.createElement('canvas');
  c.width = d.w; c.height = d.h || d.w;
  const g = c.getContext('2d');
  d.draw(g, c.width, c.height, mkRng(name.length * 977 + name.charCodeAt(0) * 31 + 5));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (TEX[name] = t);
}

// ---------- shared uniforms, shaders, materials ----------
const U = { time: { value: 0 }, night: { value: 1 } };

const BB_VS = `
attribute vec2 corner; attribute vec4 aCol; attribute float aSize; attribute vec2 aFx;
uniform float uTime; uniform float uBoost;
varying vec2 vC; varying vec4 vCol;
void main(){
  float f = 1.0 - aFx.x * (0.5 + 0.5 * sin(uTime * (5.0 + aFx.y * 6.0) + aFx.y * 40.0)) * (0.6 + 0.4 * sin(uTime * 2.3 + aFx.y * 13.0));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xy += corner * aSize * (0.94 + 0.06 * f);
  gl_Position = projectionMatrix * mv;
  vC = corner; vCol = vec4(aCol.rgb, aCol.a * f * uBoost);
}`;
const BB_FS_ADD = `
varying vec2 vC; varying vec4 vCol;
void main(){
  float d = length(vC); if (d > 1.0) discard;
  float a = pow(1.0 - d, 2.2) + pow(max(0.0, 1.0 - d * 3.2), 2.0) * 0.9;
  gl_FragColor = vec4(vCol.rgb, a * vCol.a);
  #include <colorspace_fragment>
}`;
const BB_FS_NORM = `
varying vec2 vC; varying vec4 vCol;
void main(){
  float d = length(vC); if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.3, d);
  gl_FragColor = vec4(vCol.rgb, a * vCol.a);
  #include <colorspace_fragment>
}`;

const BEAM_FS = `
varying vec2 vUv; varying vec3 vCl;
void main(){
  float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3) * 0.42; gl_FragColor = vec4(vCl, a);
  #include <colorspace_fragment>
}`;
const BEAM_VS = `
varying vec2 vUv; varying vec3 vCl;
void main(){ vUv = uv; vCl = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WATER_VS = `
varying vec3 vW; varying vec3 vCl;
void main(){ vCl = color; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WATER_FS = `
uniform float uTime; varying vec3 vW; varying vec3 vCl;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cau(vec2 p, float t){
  float v = 0.0; vec2 q = p;
  for (int i = 0; i < 3; i++){
    q += vec2(sin(q.y * 1.3 + t * 0.7 + float(i)), cos(q.x * 1.1 - t * 0.6 + float(i) * 2.0)) * 0.55;
    v += sin(q.x * 2.2) * sin(q.y * 2.2); q *= 1.4;
  }
  return v / 3.0;
}
void main(){
  vec2 p = vW.xz;
  float c = cau(p * 1.15, uTime);
  float l = smoothstep(0.35, 0.95, 1.0 - abs(c) * 2.6);
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.5);
  vec3 col = vCl * (0.86 + 0.22 * c) + vec3(0.5, 0.95, 1.0) * l * 0.30;
  vec2 cell = floor(p * 6.0);
  float sp = step(0.982, h21(cell + floor(uTime * 2.0))) * (0.5 + 0.5 * sin(uTime * 9.0 + h21(cell) * 6.28));
  col += vec3(1.0) * sp * 0.7;
  col = mix(col, vec3(0.78, 0.92, 1.0), fr * 0.38);
  gl_FragColor = vec4(col, 0.9);
  #include <colorspace_fragment>
}`;
const FALL_FS = `
uniform float uTime; varying vec3 vW; varying vec3 vCl;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  float s = vW.x * 3.1 + vW.z * 3.1;
  float y = vW.y * 1.7 + uTime * 2.4 + sin(s * 2.0) * 0.5;
  float streak = 0.5 + 0.5 * sin(s * 5.0 + sin(y * 3.0) * 1.3);
  float band = smoothstep(0.35, 0.9, sin(y * 4.0 + s) * 0.5 + 0.5);
  vec3 col = mix(vCl, vec3(1.0), 0.35 * streak + 0.35 * band);
  gl_FragColor = vec4(col, 0.82);
  #include <colorspace_fragment>
}`;

function swayPatch(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = aSway;
        transformed.x += sin(uTime * 1.25 + position.x * 0.8 + position.y * 0.45) * 0.06 * sw;
        transformed.z += cos(uTime * 1.05 + position.z * 0.7 + position.y * 0.35) * 0.06 * sw;
        transformed.y += sin(uTime * 1.6 + position.x * 0.9 + position.z * 0.9) * 0.02 * sw;`);
  };
  mat.customProgramCacheKey = () => 'hopinet-sway';
  return mat;
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const D = THREE.DoubleSide;
  const lam = (map, o = {}) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true, map: map || null }, o));
  const m = {};
  m.solid = lam(); m.sheet = lam(null, { side: D });
  m.leaf = swayPatch(lam()); m.leaf2 = swayPatch(lam(null, { side: D }));
  for (const n of ['tile', 'plank', 'log', 'stone', 'brick', 'stucco', 'ground', 'sand', 'thatch', 'bark', 'paver', 'concrete', 'dirt']) m[n] = lam(tex(n));
  m.thatch.side = D;
  m.net = lam(tex('net'), { side: D, transparent: true, alphaTest: 0.45 });
  m.plan = lam(tex('plan'));
  for (const n of ['villa', 'penthouse', 'bungalow', 'treehouse', 'chalet', 'palace']) m['plan_' + n] = lam(tex('plan_' + n));
  m.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.glowD = new THREE.MeshBasicMaterial({ vertexColors: true, side: D });
  m.neon = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.glass = new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, opacity: 0.52, shininess: 120, specular: 0xaabbcc, depthWrite: false, side: D });
  m.gold = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0xffe7a0, emissive: 0x4a2a00 });
  m.metal = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x8899aa });
  m.paint = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x777777 });
  m.solarp = new THREE.MeshPhongMaterial({ vertexColors: true, map: tex('solar'), shininess: 110, specular: 0x8899dd });
  m.blob = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, map: blobTexture(), fog: false });
  m.water = new THREE.ShaderMaterial({ uniforms: { uTime: U.time }, vertexShader: WATER_VS, fragmentShader: WATER_FS, vertexColors: true, transparent: true, depthWrite: false, side: D });
  m.fall = new THREE.ShaderMaterial({ uniforms: { uTime: U.time }, vertexShader: WATER_VS, fragmentShader: FALL_FS, vertexColors: true, transparent: true, depthWrite: false, side: D });
  m.foam = new THREE.MeshBasicMaterial({ vertexColors: true, map: tex('foamring'), transparent: true, opacity: 0.85, depthWrite: false });
  m.beam = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.bbAdd = new THREE.ShaderMaterial({ uniforms: { uTime: U.time, uBoost: U.night }, vertexShader: BB_VS, fragmentShader: BB_FS_ADD, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.bbNorm = new THREE.ShaderMaterial({ uniforms: { uTime: U.time, uBoost: { value: 1 } }, vertexShader: BB_VS, fragmentShader: BB_FS_NORM, transparent: true, depthWrite: false });
  return (MATS = m);
}
let _blobTex = null;
function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _blobTex = new THREE.CanvasTexture(c); _blobTex.colorSpace = THREE.SRGBColorSpace;
  return _blobTex;
}

// kind -> material + flags. tex = metres per texture tile (projected UVs); ownUV = use geometry UVs.
const KINDS = {
  solid: { m: 'solid', cast: 1, recv: 1 },
  sheet: { m: 'sheet', recv: 1 },
  cloth: { m: 'sheet', cast: 1, recv: 1 },
  leaf: { m: 'leaf', cast: 1, recv: 1, sway: 1 },
  leaf2: { m: 'leaf2', cast: 1, recv: 1, sway: 1 },
  tile: { m: 'tile', cast: 1, recv: 1, tex: 1.15 },
  plank: { m: 'plank', cast: 1, recv: 1, tex: 1.0 },
  plankV: { m: 'plank', cast: 1, recv: 1, tex: 1.0, swap: 1 },
  log: { m: 'log', cast: 1, recv: 1, tex: 1.0 },
  stone: { m: 'stone', cast: 1, recv: 1, tex: 1.4 },
  brick: { m: 'brick', cast: 1, recv: 1, tex: 0.9 },
  stucco: { m: 'stucco', cast: 1, recv: 1, tex: 2.0 },
  ground: { m: 'ground', recv: 1, tex: 6.0 },
  sand: { m: 'sand', recv: 1, tex: 3.0 },
  thatch: { m: 'thatch', cast: 1, recv: 1, tex: 1.3 },
  bark: { m: 'bark', cast: 1, recv: 1, tex: 1.6 },
  paver: { m: 'paver', recv: 1, tex: 0.9 },
  concrete: { m: 'concrete', cast: 1, recv: 1, tex: 1.6 },
  dirt: { m: 'dirt', recv: 1, tex: 2.2 },
  net: { m: 'net', tex: 0.5 },
  plan: { m: 'plan', ownUV: 1, cast: 1 },
  plan_villa: { m: 'plan_villa', ownUV: 1, cast: 1 }, plan_penthouse: { m: 'plan_penthouse', ownUV: 1, cast: 1 }, plan_bungalow: { m: 'plan_bungalow', ownUV: 1, cast: 1 },
  plan_treehouse: { m: 'plan_treehouse', ownUV: 1, cast: 1 }, plan_chalet: { m: 'plan_chalet', ownUV: 1, cast: 1 }, plan_palace: { m: 'plan_palace', ownUV: 1, cast: 1 },
  glow: { m: 'glow' }, glowD: { m: 'glowD' }, neon: { m: 'neon' },
  glass: { m: 'glass', order: 3 },
  gold: { m: 'gold', cast: 1 }, metal: { m: 'metal', cast: 1, recv: 1 }, paint: { m: 'paint', cast: 1 },
  solarp: { m: 'solarp', ownUV: 1, cast: 1, recv: 1 },
  blob: { m: 'blob', rgba: 1, order: 1 },
  water: { m: 'water', order: 2 }, fall: { m: 'fall', order: 2 },
  beam: { m: 'beam', ownUV: 1, order: 5 },
  foam: { m: 'foam', ownUV: 1, order: 2 },
};

// ---------- cached unit geometries (non-indexed) ----------
function NG(key, fn) {
  return G('hs:' + key, () => { let g = fn(); if (g.index) g = g.toNonIndexed(); for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') g.deleteAttribute(a); g.clearGroups(); return g; });
}
const GEO = {
  box: () => NG('box', () => new THREE.BoxGeometry(1, 1, 1)),
  sph: (q = 1) => NG('sph' + q, () => (q < 0 ? new THREE.IcosahedronGeometry(1, 0) : q === 0 ? new THREE.SphereGeometry(1, 8, 6) : q === 1 ? new THREE.SphereGeometry(1, 14, 10) : new THREE.SphereGeometry(1, 26, 18))),
  cyl: (seg, rt) => NG(`cyl${seg}_${rt}`, () => new THREE.CylinderGeometry(rt, 1, 1, seg, 1)),
  cone: (seg) => NG('cone' + seg, () => new THREE.ConeGeometry(1, 1, seg, 1)),
  tor: (tube, seg = 24) => NG(`tor${tube}_${seg}`, () => new THREE.TorusGeometry(1, tube, 8, seg)),
  quad: () => NG('quad', () => new THREE.PlaneGeometry(1, 1)),
  circ: (seg = 28) => NG('circ' + seg, () => new THREE.CircleGeometry(1, seg)),
  prism: () => NG('prism', () => {
    const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g;
  }),
  pyr: () => NG('pyr', () => { const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); g.rotateY(PI / 4); return g; }),
  dome: (seg = 18) => NG('dome' + seg, () => new THREE.SphereGeometry(1, seg, 9, 0, TAU, 0, PI / 2)),
  rbox: (w, h, d, r) => NG(`rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r)),
  arch: (w, h) => NG(`arch${w},${h}`, () => {
    const s = new THREE.Shape(); const hw = w / 2;
    s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, h - hw); s.absarc(0, h - hw, hw, 0, PI, false); s.lineTo(-hw, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 }); g.translate(0, 0, -0.5); return g;
  }),
  pArch: (w, h) => NG(`pa${w},${h}`, () => {
    const hw = w / 2, hs = h - 0.866 * w, s = new THREE.Shape();
    s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, hs); s.absarc(-hw, hs, w, 0, PI / 3, false); s.absarc(hw, hs, w, 2 * PI / 3, PI, false); s.lineTo(-hw, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 8 }); g.translate(0, 0, -0.5); return g;
  }),
  pFrame: (w, h, t) => NG(`pf${w},${h},${t}`, () => {
    const W2 = w + 2 * t, hw = W2 / 2, hs = h + t - 0.866 * W2, s = new THREE.Shape();
    s.moveTo(-hw, -t); s.lineTo(hw, -t); s.lineTo(hw, hs); s.absarc(-hw, hs, W2, 0, PI / 3, false); s.absarc(hw, hs, W2, 2 * PI / 3, PI, false); s.lineTo(-hw, -t);
    const iw = w / 2, is = h - 0.866 * w, hole = new THREE.Path();
    hole.moveTo(-iw, 0); hole.lineTo(-iw, is); hole.absarc(iw, is, w, PI, 2 * PI / 3, true); hole.absarc(-iw, is, w, PI / 3, 0, true); hole.lineTo(iw, 0); hole.lineTo(-iw, 0);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 8 }); g.translate(0, 0, -0.5); return g;
  }),
  lathe: (key, pts, seg) => NG('lt' + key, () => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg || 20)),
};

// ---------- B: batch of primitives merged per kind ----------
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _n3 = new THREE.Matrix3();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), Y_AXIS = new THREE.Vector3(0, 1, 0);

class B {
  constructor() { this.k = {}; this.halos = []; this.M = new THREE.Matrix4(); this.st = []; }
  push(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    this.st.push(this.M.clone());
    _m1.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(1, 1, 1));
    this.M.multiply(_m1);
    return this;
  }
  pop() { this.M.copy(this.st.pop()); return this; }
  at(x, y, z, ry, fn) { this.push(x, y, z, ry); fn(this); this.pop(); return this; }
  bucket(kind) {
    const K = KINDS[kind];
    if (!K) throw new Error('house: unknown kind ' + kind);
    return this.k[kind] || (this.k[kind] = { n: 0, cap: 0, pos: null, nor: null, col: null, uv: null, sw: null, cs: K.rgba ? 4 : 3, hasUV: !!(K.tex || K.ownUV), hasSw: !!K.sway });
  }
  grow(bk, add) {
    const need = bk.n + add;
    if (need <= bk.cap) return;
    let cap = Math.max(512, bk.cap * 2); while (cap < need) cap *= 2;
    const g = (old, comp) => { const a = new Float32Array(cap * comp); if (old) a.set(old.subarray(0, bk.n * comp)); return a; };
    bk.pos = g(bk.pos, 3); bk.nor = g(bk.nor, 3); bk.col = g(bk.col, bk.cs);
    if (bk.hasUV) bk.uv = g(bk.uv, 2);
    if (bk.hasSw) bk.sw = g(bk.sw, 1);
    bk.cap = cap;
  }
  // low level: geometry + transform (x,y,z pos; rot = [rx,ry,rz] | Quaternion | null; s* scale)
  put(geo, kind, col, x, y, z, rot, sx, sy, sz, o) {
    o = o || {};
    const K = KINDS[kind], bk = this.bucket(kind);
    if (rot && rot.isQuaternion) _q.copy(rot); else _q.setFromEuler(_e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, 'YXZ'));
    _m1.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _m2.multiplyMatrices(this.M, _m1);
    const e = _m2.elements;
    _n3.getNormalMatrix(_m2); const ne = _n3.elements;
    const P = geo.attributes.position.array, N = geo.attributes.normal.array, UV = geo.attributes.uv ? geo.attributes.uv.array : null;
    const cnt = P.length / 3;
    this.grow(bk, cnt);
    const base = bk.n, pos = bk.pos, nor = bk.nor, uvs = bk.uv, sws = bk.sw;
    let ymin = 1e9, ymax = -1e9;
    const sw = o.sway === undefined ? 1 : o.sway, useGeoUV = K.ownUV || o.geoUV, ts = (o.texScale || 1) * (K.tex || 1), swap = K.swap;
    for (let i = 0; i < cnt; i++) {
      const i3 = i * 3, px = P[i3], py = P[i3 + 1], pz = P[i3 + 2], o3 = (base + i) * 3;
      const wy = e[1] * px + e[5] * py + e[9] * pz + e[13];
      pos[o3] = e[0] * px + e[4] * py + e[8] * pz + e[12]; pos[o3 + 1] = wy; pos[o3 + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
      const nx = N[i3], ny = N[i3 + 1], nz = N[i3 + 2];
      const tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const il = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
      nor[o3] = tx * il; nor[o3 + 1] = ty * il; nor[o3 + 2] = tz * il;
      if (uvs) {
        const o2 = (base + i) * 2;
        if (useGeoUV) { uvs[o2] = UV[i * 2]; uvs[o2 + 1] = UV[i * 2 + 1]; }
        else {
          const ax = nx < 0 ? -nx : nx, ay = ny < 0 ? -ny : ny, az = nz < 0 ? -nz : nz;
          const lx = px * sx, ly = py * sy, lz = pz * sz;
          let u, v;
          if (ay >= ax && ay >= az) { u = lx; v = lz; } else if (ax >= az) { u = lz; v = ly; } else { u = lx; v = ly; }
          if (swap) { const t = u; u = v; v = t; }
          uvs[o2] = u / ts; uvs[o2 + 1] = v / ts;
        }
      }
      if (sws) sws[base + i] = sw;
      if (wy < ymin) ymin = wy; if (wy > ymax) ymax = wy;
    }
    const c = rgb(col), j = o.jit ? 1 + (R() - 0.5) * 2 * o.jit : 1, dk = o.dark || 0, span = Math.max(ymax - ymin, 1e-4);
    const g2 = o.grad ? rgb(o.grad[1]) : null, ya = o.gy ? o.gy[0] : 0, yb = o.gy ? o.gy[1] : 1;
    const al = o.a === undefined ? 1 : o.a, cs = bk.cs, colA = bk.col;
    for (let i = 0; i < cnt; i++) {
      let f = j;
      const wy = pos[(base + i) * 3 + 1], o4 = (base + i) * cs;
      if (dk) f *= 1 - dk * (1 - (wy - ymin) / span);
      if (g2) {
        const t = clamp((wy - ya) / (yb - ya), 0, 1);
        colA[o4] = (c[0] + (g2[0] - c[0]) * t) * f; colA[o4 + 1] = (c[1] + (g2[1] - c[1]) * t) * f; colA[o4 + 2] = (c[2] + (g2[2] - c[2]) * t) * f;
      } else { colA[o4] = c[0] * f; colA[o4 + 1] = c[1] * f; colA[o4 + 2] = c[2] * f; }
      if (cs === 4) colA[o4 + 3] = al;
    }
    bk.n += cnt;
    return this;
  }
  // ---- shapes. (x,y,z) is the base centre unless noted ----
  box(x, y, z, w, h, d, col, o) { o = o || {}; return this.put(GEO.box(), o.kind || 'solid', col, x, y + h / 2, z, [o.rx || 0, o.ry || 0, o.rz || 0], w, h, d, o); }
  boxc(x, y, z, w, h, d, col, o) { o = o || {}; return this.put(GEO.box(), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], w, h, d, o); }
  rbox(x, y, z, w, h, d, r, col, o) { o = o || {}; return this.put(GEO.rbox(w, h, d, r), o.kind || 'solid', col, x, y + h / 2, z, [o.rx || 0, o.ry || 0, o.rz || 0], 1, 1, 1, o); }
  cyl(x, y, z, r, h, col, o) {
    o = o || {}; const rt = o.r2 === undefined ? r : o.r2;
    return this.put(GEO.cyl(o.seg || 12, +(rt / r).toFixed(3)), o.kind || 'solid', col, x, y + h / 2, z, [o.rx || 0, o.ry || 0, o.rz || 0], r, h, r, o);
  }
  cylc(x, y, z, r, h, col, o) {
    o = o || {}; const rt = o.r2 === undefined ? r : o.r2;
    return this.put(GEO.cyl(o.seg || 12, +(rt / r).toFixed(3)), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], r, h, r, o);
  }
  cone(x, y, z, r, h, col, o) { o = o || {}; return this.put(GEO.cone(o.seg || 12), o.kind || 'solid', col, x, y + h / 2, z, [o.rx || 0, o.ry || 0, o.rz || 0], r, h, r, o); }
  sph(x, y, z, r, col, o) { o = o || {}; return this.put(GEO.sph(o.q === undefined ? 1 : (r < 0.13 && o.q === 0 ? -1 : o.q)), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1), o); }
  dome(x, y, z, r, col, o) { o = o || {}; return this.put(GEO.dome(o.seg || 18), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1), o); }
  gable(x, y, z, w, h, d, col, o) { o = o || {}; return this.put(GEO.prism(), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], w, h, d, o); }
  hip(x, y, z, w, h, d, col, o) { o = o || {}; return this.put(GEO.pyr(), o.kind || 'solid', col, x, y + h / 2, z, [o.rx || 0, o.ry || 0, o.rz || 0], w, h, d, o); }
  tor(x, y, z, Rr_, r, col, o) { o = o || {}; return this.put(GEO.tor(+(r / Rr_).toFixed(3), o.seg || 24), o.kind || 'solid', col, x, y, z, [o.flat ? PI / 2 + (o.rx || 0) : (o.rx || 0), o.ry || 0, o.rz || 0], Rr_, Rr_, Rr_, o); }
  quad(x, y, z, w, h, col, o) { o = o || {}; return this.put(GEO.quad(), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], w, h, 1, o); }
  floor(x, y, z, w, d, col, o) { o = o || {}; return this.put(GEO.quad(), o.kind || 'solid', col, x, y, z, [-PI / 2, o.ry || 0, 0], w, d, 1, o); }
  disc(x, y, z, r, col, o) { o = o || {}; return this.put(GEO.circ(o.seg || 28), o.kind || 'solid', col, x, y, z, [-PI / 2, 0, 0], r * (o.sx || 1), r * (o.sz || 1), 1, o); }
  arch(x, y, z, w, h, dep, col, o) { o = o || {}; return this.put((o.pointed ? GEO.pArch : GEO.arch)(w, h), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], 1, 1, dep, o); }
  lathe(key, pts, x, y, z, col, o) { o = o || {}; const s = o.s || 1; return this.put(GEO.lathe(key, pts, o.seg), o.kind || 'solid', col, x, y, z, [o.rx || 0, o.ry || 0, o.rz || 0], s * (o.sx || 1), s * (o.sy || 1), s * (o.sz || 1), o); }
  // cylinder between two points (beams, ropes, railings ...)
  seg(x1, y1, z1, x2, y2, z2, r, col, o) {
    o = o || {};
    _v1.set(x2 - x1, y2 - y1, z2 - z1); const len = _v1.length(); if (len < 1e-5) return this;
    _v1.multiplyScalar(1 / len); const qq = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, _v1);
    return this.put(GEO.cyl(o.seg || 6, 1), o.kind || 'solid', col, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2, qq, r, len, r, o);
  }
  // square beam between two points
  beam(x1, y1, z1, x2, y2, z2, t, col, o) {
    o = o || {};
    _v1.set(x2 - x1, y2 - y1, z2 - z1); const len = _v1.length(); if (len < 1e-5) return this;
    _v1.multiplyScalar(1 / len); const qq = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, _v1);
    if (o.roll) qq.multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, o.roll));
    return this.put(GEO.box(), o.kind || 'solid', col, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2, qq, t, len, o.t2 || t, o);
  }
  // vertical extruded polygon from XZ points
  poly(pts, y, h, col, o) {
    o = o || {};
    const sh = new THREE.Shape(); pts.forEach((p, i) => (i ? sh.lineTo(p[0], -p[1]) : sh.moveTo(p[0], -p[1])));
    let g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); g.rotateX(-PI / 2);
    if (g.index) g = g.toNonIndexed();
    this.put(g, o.kind || 'solid', col, 0, y, 0, null, 1, 1, 1, o); g.dispose(); return this;
  }
  // flat strip following a polyline of [x,z] points, lying at height y (uv in metres / tile)
  ribbon(pts, width, y, col, o) {
    o = o || {}; const kind = o.kind || 'paver', K = KINDS[kind], ts = K.tex || 1;
    const n = pts.length, pos = [], uv = [], nor = [], lf = [], rt = [], acc = [0], wd = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const wv = typeof width === 'function' ? width(i / (n - 1)) : width;
      wd.push(wv);
      lf.push([pts[i][0] - dz * wv / 2, pts[i][1] + dx * wv / 2]); rt.push([pts[i][0] + dz * wv / 2, pts[i][1] - dx * wv / 2]);
      if (i) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const V = (pt, u, v) => { pos.push(pt[0], 0, pt[1]); nor.push(0, 1, 0); uv.push(u / ts, v / ts); };
    for (let i = 0; i < n - 1; i++) {
      V(lf[i], 0, acc[i]); V(lf[i + 1], 0, acc[i + 1]); V(rt[i], wd[i], acc[i]);
      V(rt[i], wd[i], acc[i]); V(lf[i + 1], 0, acc[i + 1]); V(rt[i + 1], wd[i + 1], acc[i + 1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.put(g, kind, col, 0, y, 0, null, 1, 1, 1, Object.assign({ geoUV: true }, o)); g.dispose(); return this;
  }
  // lofted body along +z: stations [{z, w, y0, y1}] (superellipse sections), exponent pw
  loft(st, col, o) {
    o = o || {}; const N = o.n || 18, pw = o.pw || 2.8, pos = [], idx = [];
    const sg = (v) => (v < 0 ? -1 : 1);
    st.forEach((s) => { const cy = (s.y0 + s.y1) / 2, hh = Math.max(0.001, (s.y1 - s.y0) / 2), hw = Math.max(0.001, s.w / 2); for (let j = 0; j < N; j++) { const a = (j / N) * TAU, c = Math.cos(a), sn = Math.sin(a); pos.push(hw * sg(c) * Math.pow(Math.abs(c), 2 / pw), cy + hh * sg(sn) * Math.pow(Math.abs(sn), 2 / pw), s.z); } });
    const ns = st.length;
    for (let i = 0; i < ns - 1; i++) for (let j = 0; j < N; j++) { const a0 = i * N + j, a1 = i * N + (j + 1) % N, b0 = (i + 1) * N + j, b1 = (i + 1) * N + (j + 1) % N; idx.push(a0, a1, b0, a1, b1, b0); }
    const c0 = pos.length / 3; pos.push(0, (st[0].y0 + st[0].y1) / 2, st[0].z); const c1 = c0 + 1; pos.push(0, (st[ns - 1].y0 + st[ns - 1].y1) / 2, st[ns - 1].z);
    for (let j = 0; j < N; j++) { idx.push(c0, (j + 1) % N, j); idx.push(c1, (ns - 1) * N + j, (ns - 1) * N + (j + 1) % N); }
    let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    g = g.toNonIndexed(); g.deleteAttribute('uv');
    this.put(g, o.kind || 'paint', col, o.x || 0, o.y || 0, o.z || 0, o.rot || null, 1, 1, 1, o); g.dispose(); return this;
  }
  // soft contact shadow on the ground
  blob(x, z, rx, rz, a, y, ry) { return this.put(GEO.quad(), 'blob', 0x000000, x, y === undefined ? 0.03 : y, z, [-PI / 2, ry || 0, 0], rx * 2, rz * 2, 1, { a: a === undefined ? 0.7 : a }); }
  halo(x, y, z, size, col, alpha, flick) {
    _v1.set(x, y, z).applyMatrix4(this.M);
    const c = rgb(col); this.halos.push([_v1.x, _v1.y, _v1.z, size, c[0], c[1], c[2], alpha === undefined ? 1 : alpha, flick || 0, R()]);
    return this;
  }
  build(parent) {
    const out = [];
    for (const kind in this.k) {
      const bk = this.k[kind], K = KINDS[kind];
      if (!bk.n) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(bk.pos.slice(0, bk.n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(bk.nor.slice(0, bk.n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(bk.col.slice(0, bk.n * bk.cs), bk.cs));
      if (bk.uv) g.setAttribute('uv', new THREE.BufferAttribute(bk.uv.slice(0, bk.n * 2), 2));
      if (bk.sw) g.setAttribute('aSway', new THREE.BufferAttribute(bk.sw.slice(0, bk.n), 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats()[K.m]);
      mesh.castShadow = !!K.cast; mesh.receiveShadow = !!K.recv; mesh.name = kind;
      if (K.order) mesh.renderOrder = K.order;
      parent.add(mesh); out.push(mesh);
    }
    if (this.halos.length) { const h = makeHalos(this.halos); parent.add(h); out.push(h); }
    this.k = {}; this.halos = [];
    return out;
  }
}

function makeHalos(list) {
  const n = list.length;
  const pos = new Float32Array(n * 12), cor = new Float32Array(n * 8), col = new Float32Array(n * 16), siz = new Float32Array(n * 4), fx = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  list.forEach((h, i) => {
    for (let k = 0; k < 4; k++) {
      pos.set([h[0], h[1], h[2]], i * 12 + k * 3); cor.set([C[k * 2], C[k * 2 + 1]], i * 8 + k * 2);
      col.set([h[4], h[5], h[6], h[7]], i * 16 + k * 4); siz[i * 4 + k] = h[3]; fx.set([h[8], h[9]], i * 8 + k * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('corner', new THREE.BufferAttribute(cor, 2));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1)); g.setAttribute('aFx', new THREE.BufferAttribute(fx, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere(); g.boundingSphere.radius += 4;
  const m = new THREE.Mesh(g, mats().bbAdd); m.renderOrder = 6; m.name = 'halos';
  return m;
}

// Dynamic billboard particles (smoke, spray, snow, sparkles); CPU-updated, one draw call.
class BB {
  constructor(n, additive) {
    this.n = n;
    this.pos = new Float32Array(n * 12); this.cor = new Float32Array(n * 8); this.col = new Float32Array(n * 16); this.siz = new Float32Array(n * 4);
    const idx = new Uint32Array(n * 6); const C = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) { for (let k = 0; k < 8; k++) this.cor[i * 8 + k] = C[k]; idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6); }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSiz = new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('corner', new THREE.BufferAttribute(this.cor, 2));
    g.setAttribute('aCol', this.aCol); g.setAttribute('aSize', this.aSiz);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, additive ? mats().bbAdd : mats().bbNorm);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    this.mesh.name = 'particles';
  }
  set(i, x, y, z, size, r, g, b, a) {
    for (let k = 0; k < 4; k++) {
      const p = i * 12 + k * 3; this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
      const c = i * 16 + k * 4; this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = a;
      this.siz[i * 4 + k] = size;
    }
  }
  hide(i) { for (let k = 0; k < 4; k++) this.col[i * 16 + k * 4 + 3] = 0; }
  commit() { this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSiz.needsUpdate = true; }
}

// ---------- build context ----------
// visibility ranges (built stages) for every part group
const PART_DEFS = [
  ['ground', 0, 99], ['dirt', 0, 3], ['siteA', 0, 2], ['siteB', 0, 1], ['siteC', 0, 0], ['scaf', 0, 2],
  ['struct', 1, 1], ['shell', 2, 99], ['win2', 2, 2], ['fin3', 3, 99], ['g4', 4, 99], ['f5', 5, 99],
];
const ITEM_BUILDERS = {};
const ITEM_IDS = ['lights', 'garden', 'fountain', 'pool', 'gazebo', 'solar', 'supercar', 'helipad', 'yacht', 'statue'];

// fixed spots of the items (x, z) on the plot (house footprint is x -4.3..4.3, z -5.6..0.3, door at z=0.3)
const SPOT = {
  pool: [7.0, -2.2], gazebo: [5.9, 5.3], fountain: [-4.3, 6.5], supercar: [-7.7, 1.6], helipad: [-6.9, -4.7],
  statue: [4.3, 3.7], yacht: [7.1, 15.4], solarG: [0.8, -9.3], pier: [4.3, 9.8],
};
// zones reserved by the luxury items: decorative vegetation keeps out of them
const ZONES = [[7.0, -2.2, 3.4], [5.9, 5.3, 2.3], [-4.3, 6.5, 1.9], [-7.7, 1.6, 2.8], [-6.9, -4.7, 2.5], [4.3, 3.7, 1.2], [0.8, -9.3, 3.2], [4.3, 12.8, 2.2]];
function blocked(x, z, r) { for (const [cx, cz, cr] of ZONES) if (Math.hypot(x - cx, z - cz) < cr + (r || 0.5) * 0.55) return true; return false; }
const isVis = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };

class Ctx {
  constructor(world) {
    this.world = world;
    this.style = world.house.style;
    this.h = world.house;
    this.P = {}; PART_DEFS.forEach(([n]) => { this.P[n] = new B(); });
    this.subs = []; this.bbs = []; this.anim = []; this.groups = {};
    this.items = {}; this.itemGroups = {};
    this.height = 8;
    this.foot = { cx: 0, cz: -2.8, w: 9.4, d: 6.4 };
    this.pathCol = 0xd9cdb8;
    this.night = !!world.night;
  }
  // animated sub-group of a part (pivot placed at x,y,z)
  sub(part, x, y, z, ry) {
    const g = new THREE.Group(); g.position.set(x, y, z); if (ry) g.rotation.y = ry;
    const b = new B(); this.subs.push({ part, g, b }); return { g, b };
  }
  bb(part, n, additive) { const s = new BB(n, additive); this.bbs.push({ part, s }); return s; }
  on(g, fn) { this.anim.push({ g, fn }); }
}

// ---------- noise ----------
function hash2(i, j) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
function coast(a) { return 1 + 0.030 * Math.sin(3 * a + 1.3) + 0.022 * Math.sin(5 * a + 0.4) + 0.012 * Math.sin(9 * a + 2.0); }

const GROUND = {
  villa:     { top: 0x7cc459, alt: 0x93d36a, rim: 0x62a645, sand: 0xf3e3bb, wet: 0xd0bc8f, deep: 0x79b7a6, path: 0xe2d6bf },
  penthouse: { top: 0x2f2a6b, alt: 0x3a3380, rim: 0x4a3b96, sand: 0x5b49a8, wet: 0x3d3478, deep: 0x2c3f8c, path: 0x3b3568 },
  bungalow:  { top: 0xf3d99a, alt: 0xf8e5b4, rim: 0xe6cb86, sand: 0xfdeec8, wet: 0xd9c38b, deep: 0x6fd0c5, path: 0xb98a55 },
  treehouse: { top: 0x4b9b40, alt: 0x5fb14f, rim: 0x3a7d31, sand: 0xa89466, wet: 0x7c6a45, deep: 0x4f8670, path: 0xa8956f },
  chalet:    { top: 0xf1f6ff, alt: 0xffffff, rim: 0xdae8f6, sand: 0xc6d9ec, wet: 0x9fc2de, deep: 0x77a9d2, path: 0xb9c6d4 },
  palace:    { top: 0xedc27c, alt: 0xf5d295, rim: 0xdfb165, sand: 0xf7deaa, wet: 0xd6b47c, deep: 0x7cc7b5, path: 0xe6cf9f },
};

function profileY(r) {
  const P = [[0, 0], [10.1, 0], [10.6, -0.04], [11.2, -0.2], [11.8, -0.46], [12.3, -0.78], [12.9, -1.1], [13.8, -1.55], [15.6, -2.3], [20, -3]];
  for (let i = 1; i < P.length; i++) if (r <= P[i][0]) { const t = (r - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return lerp(P[i - 1][1], P[i][1], t); }
  return -3;
}

function buildIsland(ctx, group) {
  const C = GROUND[ctx.style];
  const rings = [0, 1.8, 3.6, 5.4, 7.2, 8.6, 9.5, 10.1, 10.5, 10.9, 11.3, 11.7, 12.1, 12.5, 12.9, 13.5, 14.4, 15.6];
  const NS = 96, NR = rings.length;
  const pos = [], col = [], uv = [], idx = [];
  const cTop = new THREE.Color(C.top), cAlt = new THREE.Color(C.alt), cRim = new THREE.Color(C.rim), cSand = new THREE.Color(C.sand), cWet = new THREE.Color(C.wet), cDeep = new THREE.Color(C.deep);
  const tmp = new THREE.Color();
  for (let j = 0; j < NR; j++) {
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * TAU, r0 = rings[j];
      const rs = r0 * lerp(1, coast(a), sstep(5, 10, r0));
      const x = Math.sin(a) * rs, z = Math.cos(a) * rs, y = profileY(r0);
      pos.push(x, y, z);
      uv.push(x / 6, z / 6);
      const n1 = vnoise(x * 0.35 + 7, z * 0.35 + 3), n2 = vnoise(x * 1.3, z * 1.3);
      tmp.copy(cTop).lerp(cAlt, clamp(n1 * 1.3 - 0.2, 0, 1) * 0.8 + n2 * 0.12);
      const jr = r0 + (vnoise(a * 4 + 1, 2) - 0.5) * 0.7;
      tmp.lerp(cRim, sstep(9.2, 10.4, jr) * 0.9);
      tmp.lerp(cSand, sstep(10.55, 10.95, jr + (n2 - 0.5) * 0.4));
      tmp.lerp(cWet, sstep(-0.35, -0.6, y));
      tmp.lerp(cDeep, sstep(-0.8, -1.2, y));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let j = 0; j < NR - 1; j++) for (let i = 0; i < NS; i++) {
    const a = j * NS + i, b = j * NS + (i + 1) % NS, c = (j + 1) * NS + i, d = (j + 1) * NS + (i + 1) % NS;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mats().ground);
  m.receiveShadow = true; m.name = 'island'; group.add(m);

  // lagoon: animated shallow water + foam ring around the island
  const lg = new THREE.RingGeometry(9, 36, 96, 1); lg.rotateX(-PI / 2);
  const sea = ctx.world.sea;
  const lm = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uShallow: { value: new THREE.Color(sea.shallow) }, uDeep: { value: new THREE.Color(sea.deep) }, uFoam: { value: new THREE.Color(sea.foam) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam; varying vec3 vP;
      float coast(float a){ return 1.0 + 0.030*sin(3.0*a+1.3) + 0.022*sin(5.0*a+0.4) + 0.012*sin(9.0*a+2.0); }
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float r = length(vP.xz); float a = atan(vP.x, vP.z);
        float d = r - 12.33 * coast(a);
        vec3 col = mix(uShallow * 1.1, uDeep, smoothstep(0.0, 11.0, d));
        float al = (1.0 - smoothstep(5.0, 21.0, d)) * 0.92;
        float w = sin(d * 2.1 - uTime * 1.05 + sin(a * 9.0 + uTime * 0.3) * 1.3);
        float band = smoothstep(0.78, 1.0, w) * (1.0 - smoothstep(0.3, 6.0, d)) * 0.55;
        float sf = smoothstep(0.55, 0.0, abs(d - 0.12 - 0.22 * sin(uTime * 1.1 + a * 7.0)));
        float foam = clamp(max(sf, band), 0.0, 1.0);
        vec2 cell = floor(vP.xz * 1.6); vec2 f = fract(vP.xz * 1.6) - 0.5;
        float tw = smoothstep(0.2, 0.0, length(f)) * step(0.9, h21(cell + floor(uTime * 1.2))) * (1.0 - smoothstep(2.0, 14.0, d));
        col = mix(col, uFoam, foam) + vec3(tw) * 0.45;
        gl_FragColor = vec4(col, clamp(max(al, foam * 0.95), 0.0, 1.0) * smoothstep(-1.0, 0.25, d));
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const lag = new THREE.Mesh(lg, lm); lag.position.y = SEA_Y + 0.1; lag.renderOrder = 1; lag.name = 'lagoon'; group.add(lag);
}

// rounded rectangle outline (XZ points) for dirt patches, pads ...
function rrect(cx, cz, w, d, r, n = 5) {
  const pts = [], hw = w / 2, hd = d / 2;
  const corners = [[hw - r, hd - r, 0], [-hw + r, hd - r, PI / 2], [-hw + r, -hd + r, PI], [hw - r, -hd + r, PI * 1.5]];
  for (const [ox, oz, a0] of corners) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * PI / 2; pts.push([cx + ox + Math.cos(a) * r, cz + oz + Math.sin(a) * r]); }
  return pts.reverse();
}
const circPts = (cx, cz, r, n = 24, sq = 1) => { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r * sq]); } return p; };

// beach decoration: rocks, shells, crystals or ice chunks along the shore (always visible)
function beachDecor(ctx, b) {
  const st = ctx.style, rnd = mkRng(77 + st.length * 13);
  const rockCol = { villa: 0xb7b2a6, penthouse: 0x4a3f86, bungalow: 0xd8c7a3, treehouse: 0x7d8a7e, chalet: 0xcfe0ee, palace: 0xd9b77a }[st];
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU, r = (10.9 + rnd() * 0.9) * coast(a), x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (z > 7.5 && Math.abs(x) < 6) continue;                    // keep the front shore (paths, docks) clear
    if (blocked(x, z, 0.3) && z < 7) continue;
    const s = 0.18 + rnd() * 0.32, y = profileY(Math.hypot(x, z) / coast(a));
    if (st === 'penthouse') {
      const c = rnd() < 0.5 ? 0x39f3ff : 0xff3df2;
      b.cone(x, y, z, s * 0.5, s * 3.0, c, { kind: 'glow', seg: 5 }); b.cone(x + s * 0.4, y, z, s * 0.35, s * 2.0, shade(c, 0.8), { kind: 'glow', seg: 5 }); b.halo(x, y + s * 1.2, z, 1.6, c, 0.5, 0.3);
    } else if (st === 'chalet') {
      b.sph(x, y + s * 0.3, z, s * 1.2, rockCol, { q: 0, sy: 0.7, jit: 0.05 }); b.cone(x + s, y, z, s * 0.6, s * 2.0, 0xdff3ff, { seg: 5 });
    } else if (st === 'bungalow' && i % 3 === 0) {
      b.cylc(x, y + 0.1, z, 0.22, 0.04, 0xff8a7a, { seg: 5, sx: 1 }); b.sph(x + 0.3, y + 0.08, z, 0.1, 0xfff1d6, { q: 0, sy: 0.6 });
    } else b.sph(x, y + s * 0.25, z, s, rockCol, { q: 0, sy: 0.65, sx: 1.2, ry: rnd() * 3, jit: 0.08 });
  }
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU, r = (10.2 + rnd() * 0.5) * coast(a), x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (z > 7.5 && Math.abs(x) < 6) continue;
    const c = { villa: 0x5a9a3f, penthouse: 0x39d6ff, bungalow: 0x4f9a3a, treehouse: 0x3f8a35, chalet: 0xdfeaf5, palace: 0x9aa860 }[st];
    for (let k = 0; k < 5; k++) b.cone(x + (rnd() - 0.5) * 0.3, 0, z + (rnd() - 0.5) * 0.3, 0.05, 0.32 + rnd() * 0.25, c, { kind: st === 'penthouse' ? 'glow' : 'leaf', seg: 3, rz: (rnd() - 0.5) * 0.5 });
  }
}

// ---------- stage 0: construction site, stage 1: structure ----------
const YEL = 0xffc21a, YEL2 = 0xe39a00, STEEL = 0xaab3bd, DARKG = 0x30343b, CONC = 0xbdbdb5, ORG = 0xff7a1a;

function fencePanel(b, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
  b.at((x1 + x2) / 2, 0, (z1 + z2) / 2, Math.atan2(-dz, dx), () => {
    b.quad(0, 0.68, 0, L, 1.1, 0xff8a24, { kind: 'net' });
    b.box(0, 1.22, 0, L, 0.05, 0.05, STEEL, { kind: 'metal' });
    b.box(0, 0.1, 0, L, 0.05, 0.05, STEEL, { kind: 'metal' });
    for (const s of [-1, 1]) {
      b.cyl(s * L / 2, 0, 0, 0.04, 1.35, STEEL, { kind: 'metal', seg: 6 });
      b.box(s * L / 2, 0, 0, 0.3, 0.16, 0.7, CONC, { kind: 'concrete' });
    }
  });
}
function cone(b, x, z, s) {
  b.cyl(x, 0, z, 0.2 * s, 0.05 * s, 0x222222, { r2: 0.2 * s, seg: 8 });
  b.cone(x, 0.05 * s, z, 0.17 * s, 0.55 * s, ORG, { seg: 10 });
  b.cyl(x, 0.2 * s, z, 0.125 * s, 0.1 * s, 0xffffff, { r2: 0.105 * s, seg: 10 });
}
function barrel(b, x, z, col) {
  b.cyl(x, 0, z, 0.3, 0.85, col, { seg: 12, jit: 0.05 });
  b.tor(x, 0.28, z, 0.3, 0.025, shade(col, 0.7), { flat: true });
  b.tor(x, 0.57, z, 0.3, 0.025, shade(col, 0.7), { flat: true });
}

function buildSite(ctx) {
  const A = ctx.P.siteA, D = ctx.P.dirt, S = ctx.P.scaf, C = ctx.P.siteB;
  // --- dirt plot ---
  D.poly(rrect(0, -2.9, 10.8, 11.4, 2.2), 0.0, 0.04, 0x8d6c47, { kind: 'dirt', jit: 0.04 });
  D.poly(rrect(0, -2.7, 9.0, 6.4, 1.2), 0.04, 0.012, 0x6f5236, { kind: 'dirt' });
  for (let i = 0; i < 14; i++) { const a = R() * TAU, r = 4.3 + R() * 1.2; D.sph(Math.cos(a) * r * 1.05, 0.05, -2.9 + Math.sin(a) * r, 0.2 + R() * 0.22, 0x7a5b3b, { q: 0, sy: 0.45, jit: 0.1 }); }
  // --- fence ---
  const fx0 = -5.0, fx1 = 5.0, fz0 = -8.2, fz1 = 2.6;
  const seg = (x1, z1, x2, z2) => { const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / 2.2)); for (let i = 0; i < n; i++) fencePanel(A, lerp(x1, x2, i / n), lerp(z1, z2, i / n), lerp(x1, x2, (i + 1) / n), lerp(z1, z2, (i + 1) / n)); };
  seg(fx0, fz1, -1.5, fz1); seg(1.5, fz1, fx1, fz1); seg(fx0, fz0, fx0, fz1); seg(fx1, fz0, fx1, fz1); seg(fx0, fz0, fx1, fz0);
  for (const s of [-1, 1]) {   // gate leaves, swung open
    fencePanel(A, s * 1.5, fz1, s * 1.5 + s * 0.5, fz1 + 1.5);
    A.cyl(s * 1.5, 0, fz1, 0.07, 1.5, YEL, { seg: 8 }); A.cyl(s * 1.5, 1.5, fz1, 0.07, 0.04, 0x222222, { seg: 8 });
  }
  // hazard sign on the fence
  A.box(-2.2, 0.55, fz1 + 0.05, 0.62, 0.62, 0.04, YEL, { ry: 0, rz: PI / 4 });
  A.box(-2.2, 0.62, fz1 + 0.08, 0.1, 0.34, 0.02, 0x222222, { ry: 0 });
  // --- plan board ---
  A.at(3.2, 0, fz1 + 0.55, 0.12, () => {
    A.cyl(-1.0, 0, 0, 0.06, 2.1, STEEL, { kind: 'metal', seg: 6 }); A.cyl(1.0, 0, 0, 0.06, 2.1, STEEL, { kind: 'metal', seg: 6 });
    A.box(0, 0.75, -0.04, 2.5, 1.5, 0.08, 0xffffff);
    A.quad(0, 1.5, 0.02, 2.3, 1.3, 0xffffff, { kind: 'plan_' + ctx.style });
    A.dome(0.0, 2.25, 0, 0.3, YEL, { sy: 0.8 }); A.cyl(0, 2.22, 0, 0.36, 0.04, YEL, { seg: 14 });
  });
  // --- material piles ---
  A.cone(3.0, 0, 1.1, 1.3, 1.1, 0xe3c68d, { seg: 14, jit: 0.04 }); A.cone(3.7, 0, 1.55, 0.7, 0.6, 0xdcbd80, { seg: 10 });
  A.cone(1.8, 0, 1.45, 0.9, 0.75, 0x9c9c9a, { seg: 12, jit: 0.06 }); A.blob(3, 1.2, 1.8, 1.5, 0.5); A.blob(1.8, 1.45, 1.2, 1.2, 0.45);
  A.at(-2.0, 0, 1.3, 0.2, () => {
    for (let i = 0; i < 3; i++) A.box(0, i * 0.05, 0, 1.3, 0.05, 1.1, 0xb8895a, { kind: 'plank', jit: 0.05 });
    A.box(0, 0.15, 0, 1.15, 0.78, 0.95, 0xc7573a, { kind: 'brick' });
    A.box(0, 0.93, 0, 1.2, 0.025, 1.0, 0x2f80ed);
    A.box(0.2, 0.93, 0.1, 0.45, 0.34, 0.3, 0xc7573a, { kind: 'brick' });
  });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) A.box(-3.9 + c * 0.64, r * 0.17, 1.1 + r * 0.04, 0.6, 0.17, 0.38, 0xcfcfc8, { ry: R() * 0.3 - 0.15, jit: 0.05 });
  for (let i = 0; i < 5; i++) A.cylc(1.0, 0.1 + (i % 2) * 0.22, 2.0 - (i % 3) * 0.2, 0.1, 1.9, i % 2 ? ORG : 0x6c7280, { rz: PI / 2, seg: 8, ry: 0.1 });
  barrel(A, 4.3, -7.2, 0x2f80ed); barrel(A, 4.75, -7.5, 0x2f80ed); barrel(A, 4.2, -7.9, 0xd9473a);
  cone(A, -1.15, fz1 + 0.5, 1); cone(A, 1.15, fz1 + 0.5, 1); cone(A, -0.9, fz1 + 1.6, 1); cone(A, 0.9, fz1 + 1.6, 1);
  for (let i = 0; i < 6; i++) A.box(-3.5, 0.03 + i * 0.05, -0.7 + i * 0.01, 2.4, 0.05, 0.22, 0xc99a63, { kind: 'plank', ry: 0.05 + (i % 2) * 0.03 });
  // wheelbarrow
  A.at(2.4, 0, 0.3, -0.6, () => {
    A.box(0, 0.32, 0, 0.55, 0.28, 0.85, 0xd9473a);
    A.cylc(0, 0.19, -0.58, 0.19, 0.08, 0x222222, { rz: PI / 2, seg: 10 }); A.seg(-0.2, 0.3, 0.4, -0.25, 0.4, 1.1, 0.025, 0x555555); A.seg(0.2, 0.3, 0.4, 0.25, 0.4, 1.1, 0.025, 0x555555);
    A.sph(0, 0.5, 0, 0.3, 0xe3c68d, { sy: 0.35, q: 0 });
  });
  // --- porta-cabin ---
  A.at(-3.3, 0, -6.9, 0.15, () => {
    A.box(0, 0.25, 0, 3.0, 2.2, 2.2, 0xf1f1ee); A.box(0, 0.18, 0, 3.1, 0.12, 2.3, 0x5a5f68);
    A.box(0, 1.0, 1.12, 3.01, 0.32, 0.02, 0x2f80ed); A.box(0, 2.45, 0, 3.15, 0.1, 2.35, 0xdadad4);
    A.box(-0.75, 1.0, 1.12, 0.9, 0.7, 0.04, 0x5a6b7d); A.box(0.9, 0.35, 1.12, 0.7, 1.55, 0.05, 0x5a6b7d);
    A.box(1.7, 0.6, 1.4, 0.7, 0.18, 1.2, 0xc99a63, { kind: 'plank' }); A.box(1.7, 0.2, 2.0, 0.9, 0.4, 0.04, 0xc99a63, { kind: 'plank', ry: 0 });
    A.box(-0.9, 2.55, -0.3, 0.8, 0.35, 0.8, 0xc7ccd1, { kind: 'metal' });
  });
  A.blob(-3.3, -6.9, 2.2, 1.7, 0.6);
  // --- scaffolding: two bays in front of the house, three bays on the left side ---
  const scafRun = (ox, oz, nb, ry) => S.at(ox, 0, oz, ry, () => {
    for (let xi = 0; xi <= nb; xi++) for (const z of [0, 0.85]) S.cyl(xi * 2, 0, z, 0.045, 6.4, STEEL, { kind: 'metal', seg: 6 });
    for (let l = 1; l <= 3; l++) {
      const y = l * 1.8;
      for (const z of [0, 0.85]) { S.seg(0, y, z, nb * 2, y, z, 0.035, STEEL, { kind: 'metal', seg: 6 }); S.seg(0, y + 0.95, z, nb * 2, y + 0.95, z, 0.03, STEEL, { kind: 'metal', seg: 6 }); }
      for (let xi = 0; xi <= nb; xi++) S.seg(xi * 2, y, 0, xi * 2, y, 0.85, 0.035, STEEL, { kind: 'metal', seg: 6 });
      for (let k = 0; k < nb; k++) S.box(k * 2 + 1, y - 0.05, 0.425, 1.98, 0.05, 0.9, 0xc99a63, { kind: 'plank' });
      for (let k = 0; k < nb; k++) { const f = (k + l) % 2; S.seg(f ? k * 2 : k * 2 + 2, y - 1.8, 0.85, f ? k * 2 + 2 : k * 2, y, 0.85, 0.025, STEEL, { kind: 'metal', seg: 5 }); }
    }
  });
  scafRun(-4.0, 0.7, 2, 0);
  scafRun(-4.7, -5.5, 3, PI * 1.5);
  S.beam(-4.5, 0, 1.9, -4.5, 5.4, 1.9, 0.05, 0xc99a63); S.beam(-4.1, 0, 1.9, -4.1, 5.4, 1.9, 0.05, 0xc99a63);
  for (let i = 0; i < 12; i++) S.seg(-4.5, 0.25 + i * 0.45, 1.9, -4.1, 0.25 + i * 0.45, 1.9, 0.02, 0xc99a63);
  // --- crane tower (static part) ---
  const cx = 3.4, cz = -7.0, H = 11.0, hw = 0.46;
  C.box(cx, 0, cz, 2.4, 0.5, 2.4, CONC, { kind: 'concrete' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    C.box(cx + sx * 0.95, 0.5, cz + sz * 0.95, 0.5, 0.45, 0.5, 0x8a8a84, { kind: 'concrete' });
    C.beam(cx + sx * hw, 0.5, cz + sz * hw, cx + sx * hw, H, cz + sz * hw, 0.11, YEL);
  }
  for (let l = 0; l < 10; l++) {
    const y0 = 0.5 + l * (H - 0.5) / 10, y1 = y0 + (H - 0.5) / 10;
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      C.beam(cx + ax * hw, y1, cz + az * hw, cx + bx * hw, y1, cz + bz * hw, 0.05, YEL2);
      const f = (l + ax + az) % 2 ? 1 : -1;
      C.beam(cx + ax * hw, f > 0 ? y0 : y1, cz + az * hw, cx + bx * hw, f > 0 ? y1 : y0, cz + bz * hw, 0.04, YEL2);
    }
  }
  C.cyl(cx, H, cz, 0.62, 0.22, DARKG, { seg: 14 });
  C.blob(cx, cz, 2.2, 2.2, 0.55);
  // rotating crane head
  const hd = ctx.sub('siteB', cx, H + 0.22, cz), hb = hd.b;
  hb.cyl(0, 0, 0, 0.55, 0.3, 0x555b64, { seg: 14 });
  hb.box(0.2, 0.3, 0.55, 0.9, 0.9, 0.7, 0xf1f1ee); hb.quad(0.2, 0.75, 0.91, 0.62, 0.5, 0x6fd3ff, { kind: 'glass' });
  hb.box(0, 1.2, 0, 0.5, 1.5, 0.5, YEL); hb.cone(0, 2.7, 0, 0.35, 1.0, YEL2, { seg: 4, ry: PI / 4 });
  for (let i = 0; i < 6; i++) hb.beam(0.15 + i * 0.5, 0.3, 0, 0.15 + (i + 1) * 0.5, 0.3, 0, 0.05, 0xffffff);
  // jib (towards -x), counter-jib (+x)
  const JL = 10.0;
  hb.beam(0, 0.95, 0, -JL, 0.95, 0, 0.09, YEL); hb.beam(0, 0.0, -0.42, -JL, 0.0, -0.42, 0.07, YEL); hb.beam(0, 0.0, 0.42, -JL, 0.0, 0.42, 0.07, YEL);
  for (let i = 0; i < 11; i++) {
    const x0 = -i * 0.9, x1 = -(i + 1) * 0.9, up = i % 2;
    hb.beam(x0, up ? 0.95 : 0, 0, x1, up ? 0 : 0.95, up ? -0.42 : 0.42, 0.04, YEL2);
    hb.beam(x0, 0.0, up ? -0.42 : 0.42, x1, 0.0, up ? 0.42 : -0.42, 0.04, YEL2);
  }
  hb.beam(0.2, 0.95, 0, 3.4, 0.95, 0, 0.09, YEL); hb.beam(0.2, 0, -0.42, 3.4, 0, -0.42, 0.07, YEL); hb.beam(0.2, 0, 0.42, 3.4, 0, 0.42, 0.07, YEL);
  hb.box(2.8, -0.55, 0, 0.9, 0.55, 0.9, 0x8a8a84, { kind: 'concrete' }); hb.box(2.0, -0.55, 0, 0.9, 0.55, 0.9, 0x9a9a94, { kind: 'concrete' });
  hb.seg(0, 2.9, 0, -JL * 0.7, 0.95, 0, 0.02, STEEL); hb.seg(0, 2.9, 0, 3.4, 0.95, 0, 0.02, STEEL);
  hb.sph(-JL, 0.5, 0, 0.1, 0xff2a2a, { kind: 'glow', q: 0 }); hb.halo(-JL, 0.5, 0, 0.8, 0xff3030, 0.9, 0.8);
  // trolley + hook + load
  const tr = ctx.sub('siteB', 0, 0, 0); hd.g.add(tr.g);
  tr.b.box(0, -0.15, 0, 0.5, 0.2, 1.0, DARKG);
  tr.b.seg(0, -0.3, 0, 0, -5.2, 0, 0.018, 0x222222);
  const ld = ctx.sub('siteB', 0, -5.2, 0); tr.g.add(ld.g);
  ld.b.box(0, -0.1, 0, 0.3, 0.35, 0.3, YEL); ld.b.cyl(0, 0.25, 0, 0.05, 0.1, 0x222222);
  ld.b.seg(-0.5, -0.9, 0, 0, -0.1, 0, 0.012, 0x222222); ld.b.seg(0.5, -0.9, 0, 0, -0.1, 0, 0.012, 0x222222);
  for (let i = 0; i < 4; i++) ld.b.box(0, -1.2 - i * 0.12, 0, 1.5, 0.1, 0.18, i % 2 ? STEEL : 0x6c7280, { kind: 'metal', rz: 0 });
  ctx.on(hd.g, (t) => { hd.g.rotation.y = Math.sin(t * 0.12) * 0.9 + 0.4; tr.g.position.set(-5.2 + Math.sin(t * 0.23) * 2.4, 0.0, 0); ld.g.rotation.z = Math.sin(t * 1.3) * 0.045; ld.g.rotation.x = Math.sin(t * 1.1) * 0.03; });

  // --- excavator ---
  buildExcavator(ctx, -2.6, 0.6, 3.3);
  // --- cement mixer ---
  const mx = ctx.sub('siteA', 0.9, 0, -7.5, 0.3);
  mx.b.box(0, 0.25, 0, 0.9, 0.12, 1.3, ORG); mx.b.box(0, 0.37, 0.1, 0.12, 0.7, 0.12, 0x555b64);
  for (const s of [-1, 1]) mx.b.cylc(s * 0.5, 0.2, 0.5, 0.2, 0.1, 0x222222, { rz: PI / 2, seg: 10 });
  const dr = ctx.sub('siteA', 0, 1.0, 0.1); mx.g.add(dr.g); dr.g.rotation.x = -0.45;
  dr.b.cyl(0, -0.55, 0, 0.5, 0.55, 0xe9e9e4, { r2: 0.62, seg: 14 }); dr.b.cyl(0, 0, 0, 0.62, 0.45, 0xe9e9e4, { r2: 0.28, seg: 14 }); dr.b.cyl(0, 0.45, 0, 0.28, 0.06, 0x333333, { seg: 12 });
  dr.b.tor(0, 0.12, 0, 0.62, 0.04, ORG, { flat: true }); dr.b.tor(0, -0.45, 0, 0.5, 0.04, ORG, { flat: true });
  ctx.on(mx.g, (t) => { dr.g.rotation.y = t * 1.6; });
}

function buildExcavator(ctx, x, z, ry) {
  const ex = ctx.sub('siteC', x, 0, z, ry), b = ex.b;
  for (const s of [-1, 1]) {
    b.rbox(s * 0.78, 0.02, 0, 0.55, 0.62, 2.7, 0.2, 0x2a2d33);
    for (let i = 0; i < 5; i++) b.cylc(s * 0.78, 0.3, -1.0 + i * 0.5, 0.22, 0.6, 0x434850, { rz: PI / 2, seg: 10 });
  }
  b.box(0, 0.4, 0, 1.4, 0.3, 1.7, 0x3b3f47);
  const cab = ctx.sub('siteC', 0, 0.7, 0), cb = cab.b; ex.g.add(cab.g);
  cb.cyl(0, 0, 0, 0.8, 0.12, 0x2a2d33, { seg: 14 });
  cb.rbox(0, 0.1, 0.1, 1.9, 0.75, 2.3, 0.18, YEL);
  cb.rbox(0, 0.1, 1.2, 1.8, 0.85, 0.7, 0.2, YEL2);
  cb.rbox(-0.55, 0.85, -0.35, 0.95, 1.15, 1.1, 0.14, YEL);
  cb.quad(-0.55, 1.45, -0.915, 0.78, 0.82, 0x7fd8ff, { kind: 'glass' }); cb.quad(-1.03, 1.45, -0.35, 0.8, 0.82, 0x7fd8ff, { kind: 'glass', ry: -PI / 2 });
  cb.box(-0.55, 2.0, -0.35, 1.05, 0.08, 1.2, 0x2a2d33); cb.cyl(0.55, 0.85, 0.5, 0.06, 0.5, 0x2a2d33, { seg: 6 });
  const boom = ctx.sub('siteC', 0.4, 0.85, -0.8), bm = boom.b; cab.g.add(boom.g);
  bm.beam(0, 0, 0, 0, 1.5, -1.5, 0.3, YEL); bm.beam(0, 1.5, -1.5, 0, 1.35, -3.1, 0.26, YEL);
  bm.seg(0.22, 0.35, -0.3, 0.22, 1.6, -1.9, 0.045, STEEL, { kind: 'metal' });
  const stick = ctx.sub('siteC', 0, 1.35, -3.1), sk = stick.b; boom.g.add(stick.g);
  sk.beam(0, 0, 0, 0, -0.9, -1.4, 0.22, YEL); sk.seg(0.18, 0.2, 0.1, 0.18, -0.6, -1.0, 0.04, STEEL, { kind: 'metal' });
  const bucket = ctx.sub('siteC', 0, -0.9, -1.4), bk = bucket.b; stick.g.add(bucket.g);
  bk.rbox(0, -0.35, -0.15, 0.7, 0.45, 0.6, 0.12, 0x474c55);
  for (let i = -1; i <= 1; i++) bk.cone(i * 0.24, -0.7, -0.25, 0.06, 0.2, 0xcfd3d8, { seg: 5 });
  ctx.on(ex.g, (t) => {
    cab.g.rotation.y = Math.sin(t * 0.32) * 0.35;
    boom.g.rotation.x = 0.35 + Math.sin(t * 0.6) * 0.14;
    stick.g.rotation.x = 0.25 + Math.sin(t * 0.6 + 1.2) * 0.3;
    bucket.g.rotation.x = 0.3 + Math.sin(t * 0.6 + 2.4) * 0.45;
  });
}

// ---------- stage 1: generic raw structure ----------
// mass: { x0, x1, z0, z1, h, floors, y0 (base height), wall (fraction of first floor already walled) }
function rawStructure(ctx, masses, o) {
  o = o || {};
  const b = ctx.P.struct, timber = o.timber;
  for (const m of masses) {
    const y0 = m.y0 || 0, w = m.x1 - m.x0, d = m.z1 - m.z0, cx = (m.x0 + m.x1) / 2, cz = (m.z0 + m.z1) / 2, fh = m.h / (m.floors || 1);
    if (!y0) b.box(cx, 0, cz, w + 0.5, 0.35, d + 0.5, timber ? 0xb99562 : 0xb0b0a8, { kind: timber ? 'plank' : 'concrete' });
    const nx = Math.max(2, Math.round(w / 2.4)), nz = Math.max(2, Math.round(d / 2.4));
    const colCol = timber ? 0x9b6a3c : 0xaeaea6, ck = timber ? 'plank' : 'concrete';
    const cols = [];
    for (let i = 0; i <= nx; i++) { cols.push([m.x0 + (w * i) / nx, m.z0]); cols.push([m.x0 + (w * i) / nx, m.z1]); }
    for (let k = 1; k < nz; k++) { cols.push([m.x0, m.z0 + (d * k) / nz]); cols.push([m.x1, m.z0 + (d * k) / nz]); }
    for (const [x, z] of cols) { b.box(x, y0 + 0.35, z, 0.3, m.h - 0.35, 0.3, colCol, { kind: ck, jit: 0.03 }); b.cyl(x, y0 + m.h, z, 0.025, 0.55, 0x8c4a2b, { seg: 5 }); b.cyl(x + 0.08, y0 + m.h, z + 0.05, 0.025, 0.4, 0x8c4a2b, { seg: 5 }); }
    for (let f = 1; f <= (m.floors || 1); f++) {
      const y = y0 + f * fh - 0.2;
      if (f < (m.floors || 1) || !o.openTop) b.box(cx, y, cz, w + 0.3, 0.22, d + 0.3, timber ? 0xa97c4c : 0xb6b6ae, { kind: timber ? 'plank' : 'concrete' });
    }
    const wf_ = m.wall === undefined ? 0.62 : m.wall;
    if (wf_ > 0) {
      const wk = timber ? 'plank' : 'brick', wc = timber ? 0xc4955a : 0xc86a4a, wh = fh * wf_;
      const wall = (x, z, ww, dd) => b.box(x, y0 + 0.35, z, ww, wh, dd, wc, { kind: wk, jit: 0.04 });
      wall(cx, m.z0, w, 0.26); wall(m.x0, cz, 0.26, d); wall(m.x1, cz, 0.26, d);
      wall(m.x0 + w * 0.2, m.z1, w * 0.4, 0.26); wall(m.x1 - w * 0.2, m.z1, w * 0.4, 0.26);
    }
  }
  b.box(-3.3, 0.0, 1.5, 2.2, 0.05, 0.25, 0xc99a63, { kind: 'plank', ry: 0.08 }); b.box(-3.3, 0.05, 1.5, 2.2, 0.05, 0.25, 0xc99a63, { kind: 'plank', ry: 0.1 });
}

// ---------- reusable building blocks: windows, doors, plants, small props ----------
GEO.archFrame = (w, h, t) => NG(`af${w},${h},${t}`, () => {
  const hw = w / 2, s = new THREE.Shape(), r = hw + t;
  s.moveTo(-r, -t); s.lineTo(r, -t); s.lineTo(r, h - hw); s.absarc(0, h - hw, r, 0, PI, false); s.lineTo(-r, -t);
  const hole = new THREE.Path(); hole.moveTo(-hw, 0); hole.lineTo(-hw, h - hw); hole.absarc(0, h - hw, hw, PI, 0, true); hole.lineTo(hw, 0); hole.lineTo(-hw, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 }); g.translate(0, 0, -0.5); return g;
});

GEO.pWall = (W, Hh, w, h) => NG(`pw${W},${Hh},${w},${h}`, () => {
  const s = new THREE.Shape(), iw = w / 2, is = h - 0.866 * w;
  s.moveTo(-W / 2, -0.05); s.lineTo(W / 2, -0.05); s.lineTo(W / 2, Hh); s.lineTo(-W / 2, Hh); s.lineTo(-W / 2, -0.05);
  const hole = new THREE.Path();
  hole.moveTo(-iw, 0); hole.lineTo(-iw, is); hole.absarc(iw, is, w, PI, 2 * PI / 3, true); hole.absarc(-iw, is, w, PI / 3, 0, true); hole.lineTo(iw, 0); hole.lineTo(-iw, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 8 }); g.translate(0, 0, -0.5); return g;
});
const WARM_TOP = 0xffe3a0, WARM_BOT = 0xff9d4d, DARKWIN = 0x25304a, FURN = 0x6a3d2c;

// Window on a wall surface (z = 0, facing +z of the current frame). x = centre, y = bottom.
// o: arch, trim, shutter (colour), flower (bool), cross (mullion cross), sill (default true), warm [top,bot],
//    v (interior variant 0..2), curtain (colour), neon (glow colour for edge)
function win(ctx, x, y, w, h, o) {
  o = o || {};
  const S = o.shell || ctx.P.shell, W = ctx.P.win2, F = ctx.P.fin3;
  const trim = o.trim === undefined ? 0xffffff : o.trim, t = o.t || 0.1;
  const arch = !!o.arch, cy = y + h / 2;
  if (arch) S.put((o.pointed ? GEO.pFrame : GEO.archFrame)(w, h, t), o.fk || 'solid', trim, x, y, 0.06, null, 1, 1, 0.12);
  else {
    S.box(x - w / 2 - t / 2, y - t, 0, t, h + 2 * t, 0.12, trim, { kind: o.fk }); S.box(x + w / 2 + t / 2, y - t, 0, t, h + 2 * t, 0.12, trim, { kind: o.fk });
    S.box(x, y + h, 0, w, t, 0.12, trim, { kind: o.fk }); S.box(x, y - t, 0, w, t, 0.12, trim, { kind: o.fk });
  }
  if (o.sill !== false) S.box(x, y - t - 0.06, 0, w + 0.34, 0.07, 0.26, o.sillCol || trim, { kind: o.fk });
  // stage 2: empty dark opening
  const dark = o.dark === undefined ? DARKWIN : o.dark;
  if (arch) W.arch(x, y, 0.05, w, h, 0.01, dark, { pointed: o.pointed }); else W.quad(x, cy, 0.05, w, h, dark);
  // stage 3: warm interior + furniture + glass
  const wt = o.warm ? o.warm[0] : WARM_TOP, wb = o.warm ? o.warm[1] : WARM_BOT;
  const gopt = { kind: 'glow', grad: [0, wb], gy: [y + h, y] };
  if (arch) F.arch(x, y, 0.045, w, h, 0.01, wt, Object.assign({ pointed: o.pointed }, gopt)); else F.quad(x, cy, 0.045, w, h, wt, gopt);
  const v = o.v === undefined ? Math.floor(Math.abs(x * 7.3 + y * 3.1 + w * 5)) % 3 : o.v;
  const fz = 0.062;
  if (v === 0) {
    F.box(x - w * 0.12, y, fz, w * 0.55, h * 0.3, 0.03, FURN); F.box(x - w * 0.12, y + h * 0.3, fz, w * 0.55, h * 0.08, 0.03, 0x8a5a40);
    F.cyl(x + w * 0.3, y, fz, 0.012, h * 0.62, 0x4a2c20, { seg: 4 }); F.sph(x + w * 0.3, y + h * 0.66, fz, Math.min(0.16, w * 0.16), 0xfff6d0, { kind: 'glow', q: 0, sy: 0.8 });
  } else if (v === 1) {
    F.cyl(x, y + h * 0.78, fz, 0.008, h * 0.22, 0x4a2c20, { seg: 4 }); F.sph(x, y + h * 0.72, fz, Math.min(0.15, w * 0.15), 0xfff3c0, { kind: 'glow', q: 0 });
    F.box(x - w * 0.3, y + h * 0.1, fz, w * 0.34, h * 0.62, 0.03, FURN);
    F.box(x - w * 0.36, y + h * 0.45, fz + 0.02, w * 0.06, h * 0.12, 0.01, 0xe0584a); F.box(x - w * 0.27, y + h * 0.28, fz + 0.02, w * 0.08, h * 0.12, 0.01, 0x4aa3df);
    F.box(x + w * 0.2, y, fz, w * 0.36, h * 0.22, 0.03, FURN);
  } else {
    F.cyl(x - w * 0.22, y, fz, w * 0.09, h * 0.14, 0xb5532f, { seg: 8 }); F.sph(x - w * 0.22, y + h * 0.28, fz, w * 0.16, 0x4f9d3d, { q: 0 });
    F.box(x + w * 0.1, y + h * 0.5, fz, w * 0.26, h * 0.2, 0.012, 0xfff0d0); F.box(x + w * 0.1, y + h * 0.55, fz + 0.01, w * 0.2, h * 0.1, 0.012, 0xe0584a);
    F.box(x + w * 0.22, y, fz, w * 0.4, h * 0.26, 0.03, FURN);
  }
  if (o.curtain !== undefined) { F.box(x - w / 2 + 0.07, y, 0.075, 0.13, h, 0.03, o.curtain); F.box(x + w / 2 - 0.07, y, 0.075, 0.13, h, 0.03, o.curtain); }
  const gcol = o.glass === undefined ? 0xaee6ff : o.glass;
  if (arch) F.arch(x, y, 0.09, w, h, 0.01, gcol, { kind: 'glass', pointed: o.pointed }); else F.quad(x, cy, 0.09, w, h, gcol, { kind: 'glass' });
  if (o.cross !== false) {
    F.box(x, y, 0.1, 0.035, h - (arch ? 0 : 0), 0.04, trim); F.box(x, y + h * 0.55, 0.1, w, 0.035, 0.04, trim);
  }
  if (o.shutter !== undefined) {
    for (const s of [-1, 1]) {
      const sx = x + s * (w / 2 + t + w * 0.26);
      S.box(sx, y - t * 0.5, 0.0, w * 0.5, h + t, 0.05, o.shutter, { jit: 0.02 });
      for (let k = 0; k < 5; k++) S.box(sx, y - t * 0.5 + 0.12 + k * ((h + t - 0.2) / 5), 0.05, w * 0.42, 0.03, 0.025, shade(o.shutter, 0.72));
    }
  }
  if (o.flower) flowerBox(S, x, y - t - 0.22, 0.14, w + 0.1, o.flower);
}
function flowerBox(S, x, y, z, w, cols) {
  S.box(x, y, z, w, 0.2, 0.24, 0x8b5a3a, { kind: 'plank' });
  S.sph(x, y + 0.2, z, 0.2, 0x3f8f35, { kind: 'leaf', sx: w * 2.2, sy: 0.7, sz: 1, q: 0 });
  const n = Math.round(w * 4);
  for (let i = 0; i < n; i++) S.sph(x - w / 2 + 0.08 + (i / Math.max(1, n - 1)) * (w - 0.16), y + 0.34 + (i % 2) * 0.05, z + (i % 2 ? 0.05 : -0.04), 0.09, cols[i % cols.length], { kind: 'leaf', q: 0 });
}

// A door (stage 2 frame + boards, stage 3 leaf). Facing +z at z = 0. o: arch, trim, leaf (colour), glassTop
function door(ctx, x, w, h, o) {
  o = o || {};
  const S = ctx.P.shell, W = ctx.P.win2, F = ctx.P.fin3, t = 0.12;
  const trim = o.trim === undefined ? 0xffffff : o.trim, leaf = o.leaf === undefined ? 0x2f80ed : o.leaf;
  if (o.arch) S.put((o.pointed ? GEO.pFrame : GEO.archFrame)(w, h, t), 'solid', trim, x, 0, 0.07, null, 1, 1, 0.14);
  else { S.box(x - w / 2 - t / 2, 0, 0, t, h + t, 0.14, trim); S.box(x + w / 2 + t / 2, 0, 0, t, h + t, 0.14, trim); S.box(x, h, 0, w + 2 * t, t, 0.14, trim); }
  if (o.arch) W.arch(x, 0, 0.05, w, h, 0.01, 0xb98e55, { kind: 'plank', pointed: o.pointed }); else W.quad(x, h / 2, 0.05, w, h, 0xb98e55, { kind: 'plank' });
  // stage 3: double leaf
  const lw = w / 2 - 0.02;
  for (const s of [-1, 1]) {
    const lx = x + s * (lw / 2 + 0.02);
    if (o.arch) {
      F.box(lx, 0, 0.05, lw, h - (o.pointed ? 0.866 * w : w / 2), 0.06, leaf);
      F.put((o.pointed ? GEO.pArch : GEO.arch)(w, h), 'solid', leaf, x, 0, 0.05, null, 1, 1, 0.06);   // arch slab behind (covers the curved top)
    } else F.box(lx, 0, 0.05, lw, h, 0.06, leaf);
    F.box(lx, 0.25, 0.085, lw * 0.7, h * 0.28, 0.02, shade(leaf, 0.82));
    F.box(lx, h * 0.5, 0.085, lw * 0.7, h * 0.3, 0.02, shade(leaf, 0.82));
    if (o.glassTop) { F.box(lx, h * 0.62, 0.095, lw * 0.6, h * 0.22, 0.012, 0xcfeeff, { kind: 'glass' }); }
    F.sph(x + s * 0.09, h * 0.45, 0.12, 0.04, 0xffd24a, { kind: 'gold', q: 0 });
  }
  if (o.arch) F.arch(x, 0, 0.03, w, h, 0.01, 0xffe0a0, { kind: 'glow', pointed: o.pointed });
}

// ---------- plants ----------
function bush(b, x, z, s, col, o) {
  if (blocked(x, z, s)) return;
  o = o || {};
  const n = o.n || 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R(), r = i ? s * 0.55 : 0;
    b.sph(x + Math.cos(a) * r, s * (0.5 + (i ? 0 : 0.12)), z + Math.sin(a) * r, s * (i ? 0.72 : 0.92), col, { kind: 'leaf', sy: 0.85, jit: 0.1, q: 0 });
  }
  if (o.blob !== false) b.blob(x, z, s * 1.4, s * 1.4, 0.45);
}
function flowerBed(b, x, z, w, d, cols, n, o) {
  if (blocked(x, z, Math.max(w, d) * 0.5)) return;
  o = o || {};
  b.box(x, 0, z, w, 0.14, d, o.soil || 0x5a3d28, { kind: 'dirt' });
  b.sph(x, 0.14, z, 0.5, o.leaf || 0x3f9a3a, { kind: 'leaf', sx: w * 0.95, sy: 0.5, sz: d * 0.95, jit: 0.05, q: 0 });
  for (let i = 0; i < n; i++) b.sph(x + (R() - 0.5) * (w - 0.2), 0.3 + R() * 0.12, z + (R() - 0.5) * (d - 0.2), 0.08 + R() * 0.05, cols[Math.floor(R() * cols.length)], { kind: 'leaf', q: 0 });
}
function treeRound(b, x, z, s, leaf, trunk) {
  if (blocked(x, z, s * 1.3)) return;
  b.cyl(x, 0, z, 0.2 * s, 1.5 * s, trunk || 0x7a5232, { r2: 0.13 * s, kind: 'bark', seg: 8 });
  const cy = 2.1 * s;
  b.sph(x, cy, z, 1.25 * s, leaf, { kind: 'leaf', sy: 0.85, jit: 0.06 });
  for (let i = 0; i < 4; i++) { const a = i * 1.6 + R(); b.sph(x + Math.cos(a) * 0.9 * s, cy + (R() - 0.4) * 0.6 * s, z + Math.sin(a) * 0.9 * s, 0.75 * s, shade(leaf, 0.92 + R() * 0.2), { kind: 'leaf', q: 0, jit: 0.05 }); }
  b.blob(x, z, 1.4 * s, 1.4 * s, 0.6);
}
function cypress(b, x, z, s, col) {
  if (blocked(x, z, s)) return;
  col = col || 0x2f6b3a;
  b.cyl(x, 0, z, 0.1 * s, 0.4 * s, 0x6a4a2e, { seg: 5 });
  b.sph(x, 1.3 * s, z, 0.55 * s, col, { kind: 'leaf', sy: 1.6, sx: 1, sz: 1, jit: 0.04 });
  b.sph(x, 2.2 * s, z, 0.42 * s, shade(col, 1.08), { kind: 'leaf', sy: 1.7, q: 0 });
  b.cone(x, 2.7 * s, z, 0.32 * s, 1.4 * s, shade(col, 1.05), { kind: 'leaf', seg: 8 });
  b.blob(x, z, 0.8 * s, 0.8 * s, 0.5);
}
function palm(b, x, z, s, lean, o) {
  if (blocked(x, z, s * 1.2)) return;
  o = o || {};
  const dir = Math.atan2(z + 2.0, x) + (((lean || 0) * 7.13) % 1 - 0.5) * 0.9, H = (o.h || 4.2) * s, n = 6;
  let px = x, pz = z, py = 0;
  const bend = 0.9 * s;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const nx = x + Math.cos(dir) * bend * t1 * t1, nz = z + Math.sin(dir) * bend * t1 * t1, ny = H * t1;
    b.seg(px, py, pz, nx, ny, nz, (0.17 - 0.07 * t0) * s, o.trunk || 0xb08a55, { kind: 'bark', seg: 7 });
    px = nx; pz = nz; py = ny;
  }
  const leaf = o.leaf || 0x3f9a46;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + R() * 0.3, ln = (1.6 + R() * 0.4) * s;
    const ex = Math.cos(a), ez = Math.sin(a);
    b.sph(px + ex * ln * 0.5, py + 0.28 * s, pz + ez * ln * 0.5, ln * 0.5, shade(leaf, 0.85 + R() * 0.3), { kind: 'leaf', sx: 1, sy: 0.07, sz: 0.44, ry: -a, rz: -0.12, q: 0, jit: 0.04 });
    b.sph(px + ex * ln * 1.15, py + 0.0 * s, pz + ez * ln * 1.15, ln * 0.42, shade(leaf, 0.8 + R() * 0.25), { kind: 'leaf', sx: 1, sy: 0.07, sz: 0.36, ry: -a, rz: -0.55, q: 0 });
  }
  for (let i = 0; i < 3; i++) b.sph(px + (R() - 0.5) * 0.3 * s, py - 0.18 * s, pz + (R() - 0.5) * 0.3 * s, 0.14 * s, 0x6a4a2a, { q: 0 });
  b.blob(x, z, 1.3 * s, 1.3 * s, 0.45);
}
function pine(b, x, z, s, snow, col) {
  if (blocked(x, z, s)) return;
  col = col || 0x2e6b46;
  b.cyl(x, 0, z, 0.16 * s, 0.7 * s, 0x6a4a2e, { seg: 6, kind: 'bark' });
  const tiers = [[1.15, 1.5, 0.5], [0.95, 1.4, 1.35], [0.75, 1.25, 2.15], [0.5, 1.1, 2.9]];
  tiers.forEach(([r, h, y], i) => {
    b.cone(x, y * s, z, r * s, h * s, shade(col, 0.9 + i * 0.06), { kind: 'leaf', seg: 9, jit: 0.04 });
    if (snow) b.cone(x, (y + h * 0.28) * s, z, r * s * 0.78, h * s * 0.78, 0xffffff, { seg: 9 });
  });
  b.blob(x, z, 1.2 * s, 1.2 * s, 0.5);
}
function rock(b, x, z, s, col) {
  if (blocked(x, z, s)) return;
  b.sph(x, s * 0.3, z, s, col || 0x8f959c, { q: 0, sy: 0.65, sx: 1.2, sz: 0.9, ry: R() * 3, jit: 0.1 });
  b.sph(x + s * 0.7, s * 0.2, z + s * 0.2, s * 0.55, shade(col || 0x8f959c, 1.1), { q: 0, sy: 0.7, jit: 0.1 });
}
function pot(b, x, y, z, s, potCol, plantCol, flowerCol) {
  b.cyl(x, y, z, 0.2 * s, 0.34 * s, potCol, { r2: 0.28 * s, seg: 10 });
  b.sph(x, y + 0.42 * s, z, 0.3 * s, plantCol, { kind: 'leaf', sy: 0.8, q: 0, jit: 0.06 });
  if (flowerCol !== undefined) for (let i = 0; i < 4; i++) b.sph(x + (R() - 0.5) * 0.35 * s, y + 0.5 * s + R() * 0.1, z + (R() - 0.5) * 0.35 * s, 0.07 * s, flowerCol, { kind: 'leaf', q: 0 });
}
function lantern(b, x, y, z, col, size) {
  size = size || 1;
  b.box(x, y, z, 0.12 * size, 0.2 * size, 0.12 * size, col === undefined ? 0xffd88a : col, { kind: 'glow' });
  b.cone(x, y + 0.2 * size, z, 0.12 * size, 0.1 * size, 0x2a2d33, { seg: 4, ry: PI / 4 });
  b.halo(x, y + 0.1 * size, z, 0.75 * size, 0xffc060, 0.55, 0.35);
}
function postLamp(b, x, z, h, col, headCol) {
  b.cyl(x, 0, z, 0.1, 0.25, 0x30343b, { r2: 0.07, seg: 8 }); b.cyl(x, 0.25, z, 0.045, h - 0.45, 0x30343b, { seg: 6, kind: 'metal' });
  b.sph(x, h - 0.1, z, 0.17, headCol || 0xfff0c0, { kind: 'glow', q: 0 }); b.cone(x, h + 0.02, z, 0.24, 0.16, 0x30343b, { seg: 8 });
  b.halo(x, h - 0.1, z, 1.1, col || 0xffc870, 0.6, 0.25);
}
// striped fabric canopy etc. helper: a flag (cloth) is created by makeFlag
function makeFlag(ctx, part, x, y, z, w, h, c1, c2, ry) {
  const seg = 8, sg = new THREE.PlaneGeometry(w, h, seg, 3);
  const cols = [];
  const pos = sg.attributes.position;
  const ca = new THREE.Color(c1), cb = new THREE.Color(c2);
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) + w / 2) / w, v = (pos.getY(i) + h / 2) / h;
    const c = c2 === undefined ? ca : (v > 0.5 ? ca : cb);
    cols.push(c.r, c.g, c.b);
  }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(sg, mats().sheet);
  mesh.position.set(x + w / 2, y, z); mesh.rotation.y = ry || 0;
  const holder = new THREE.Group(); holder.position.set(x, 0, z); holder.rotation.y = ry || 0; mesh.position.set(w / 2, y, 0); holder.add(mesh);
  mesh.castShadow = true;
  const base = pos.array.slice();
  ctx.flags = ctx.flags || [];
  const f = { part, holder, mesh, base, w };
  ctx.flags.push(f);
  return f;
}
function animFlags(ctx, t) {
  for (const f of ctx.flags || []) {
    if (!isVis(f.holder)) continue;
    const pos = f.mesh.geometry.attributes.position, a = f.base;
    for (let i = 0; i < pos.count; i++) {
      const x = a[i * 3], u = (x + f.w / 2) / f.w;
      pos.setZ(i, Math.sin(u * 5 - t * 5 + a[i * 3 + 1] * 1.5) * 0.12 * u * f.w * 0.9);
      pos.setY(i, a[i * 3 + 1] - u * u * 0.06);
    }
    pos.needsUpdate = true;
  }
}

// scattered wild-flower patches on the lawn (keeps big lawns from looking empty)
function lawnPatches(b, cols, n, seed) {
  const rnd = mkRng(seed || 5);
  for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
    const a = rnd() * TAU, r = 3.5 + rnd() * 6.0, x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (z > -6.5 && z < 2.2 && Math.abs(x) < 5.4) continue;      // not under the house
    if (blocked(x, z, 0.8) || Math.hypot(x, z) > 9.6) continue;
    if (z > 1.5 && Math.abs(x - 0.2) < 1.6) continue;            // keep the front path clear
    i++;
    b.sph(x, 0.08, z, 0.34, 0x3f9a3a, { kind: 'leaf', sy: 0.4, q: 0, jit: 0.08 });
    for (let k = 0; k < 7; k++) b.sph(x + (rnd() - 0.5) * 0.5, 0.17 + rnd() * 0.06, z + (rnd() - 0.5) * 0.5, 0.055 + rnd() * 0.03, cols[Math.floor(rnd() * cols.length)], { kind: 'leaf', q: 0 });
  }
}

// ---------- shared front-yard pieces ----------
GEO.tri = () => NG('tri', () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(1, 0); s.lineTo(0, 1); return new THREE.ShapeGeometry(s); });
function wf(ctx, x, y, z, ry, fn) {
  const L = [ctx.P.shell, ctx.P.win2, ctx.P.fin3];
  L.forEach((b) => b.push(x, y, z, ry)); fn(); L.forEach((b) => b.pop());
}
function quoins(b, x, z, sx, sz, h, col, y0) {
  for (let i = 0, y = y0 === undefined ? 0.45 : y0; y < h - 0.35; i++, y += 0.42) {
    const wx = i % 2 ? 0.6 : 0.38, wz = i % 2 ? 0.38 : 0.6;
    b.box(x - sx * (wx / 2 - 0.05), y, z - sz * (wz / 2 - 0.05), wx, 0.4, wz, col, { kind: 'stone', jit: 0.03 });
  }
}
function balustrade(b, x0, z0, x1, z1, y, h, col) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 0.28));
  for (let i = 0; i <= n; i++) b.cyl(lerp(x0, x1, i / n), y, lerp(z0, z1, i / n), 0.045, h, col, { seg: 6, r2: 0.035 });
  b.seg(x0, y + h, z0, x1, y + h, z1, 0.06, col); b.seg(x0, y + 0.06, z0, x1, y + 0.06, z1, 0.05, col);
}

// wooden pier running along +z from z0 to z1 at x (deck 0.35 above the water line of the lagoon)
function buildPier(ctx, b, x, z0, z1, wd, col) {
  col = col || 0xb8895a;
  const n = Math.round((z1 - z0) / 0.34);
  for (let i = 0; i < n; i++) b.box(x, 0.3, z0 + (i + 0.5) * ((z1 - z0) / n), wd, 0.07, (z1 - z0) / n - 0.03, shade(col, 0.9 + R() * 0.2), { kind: 'plank', texScale: 0.5 });
  b.box(x - wd / 2 + 0.07, 0.2, (z0 + z1) / 2, 0.12, 0.12, z1 - z0, shade(col, 0.75)); b.box(x + wd / 2 - 0.07, 0.2, (z0 + z1) / 2, 0.12, 0.12, z1 - z0, shade(col, 0.75));
  for (let z = z0 + 0.4; z <= z1; z += 1.6) for (const s of [-1, 1]) {
    b.cyl(x + s * (wd / 2 - 0.02), -1.2, z, 0.1, 1.9, shade(col, 0.7), { seg: 7, kind: 'bark' });
    b.cyl(x + s * (wd / 2 - 0.02), 0.62, z, 0.115, 0.07, 0x30343b, { seg: 7 });
  }
}

// ---------- villa (harbor): Mediterranean seaside villa ----------
function buildVilla(ctx) {
  const H = ctx.h, WALL = H.wall, ROOF = H.roof, TRIM = H.trim;
  const S = ctx.P.shell, F3 = ctx.P.fin3, G4 = ctx.P.g4, F5 = ctx.P.f5;
  const STONE = 0xd5c9b2, CREAM = 0xfff8e8, WOOD = 0x9a6a3e;
  ctx.foot = { cx: -0.1, cz: -2.9, w: 9.0, d: 5.4 };
  ctx.pathCol = 0xe2d6bf; ctx.height = 9.6;
  const A = { x0: -3.4, x1: 1.9, z0: -5.5, z1: -0.3, h: 5.4, floors: 2 };
  const Bm = { x0: 1.9, x1: 4.3, z0: -5.0, z1: -0.3, h: 3.2, floors: 1 };
  const T = { x0: -4.5, x1: -2.5, z0: -2.5, z1: -0.3, h: 7.6, floors: 2, wall: 0.5 };
  rawStructure(ctx, [A, Bm, T]);
  ctx.solar = [{ x: -0.75, y: 6.58, z: -1.45, w: 3.4, d: 2.4, tilt: 0.61 }];

  // --- volumes ---
  const mass = (m, col) => S.box((m.x0 + m.x1) / 2, 0, (m.z0 + m.z1) / 2, m.x1 - m.x0, m.h, m.z1 - m.z0, col, { kind: 'stucco', jit: 0.015, dark: 0.1 });
  mass(A, WALL); mass(Bm, WALL); mass(T, WALL);
  for (const m of [A, Bm, T]) S.box((m.x0 + m.x1) / 2, 0, (m.z0 + m.z1) / 2, m.x1 - m.x0 + 0.24, 0.5, m.z1 - m.z0 + 0.24, STONE, { kind: 'stone' });
  for (const [m, y] of [[A, 5.25], [T, 7.4]]) S.box((m.x0 + m.x1) / 2, y, (m.z0 + m.z1) / 2, m.x1 - m.x0 + 0.42, 0.22, m.z1 - m.z0 + 0.42, CREAM);
  // roofs
  S.box(-0.75, 5.38, -2.9, 6.5, 0.1, 6.0, shade(ROOF, 0.6));
  S.hip(-0.75, 5.45, -2.9, 6.5, 2.1, 6.0, ROOF, { kind: 'tile', jit: 0.02 });
  S.box(-3.5, 7.55, -1.4, 2.8, 0.1, 3.0, shade(ROOF, 0.6));
  S.hip(-3.5, 7.6, -1.4, 2.8, 2.3, 3.0, ROOF, { kind: 'tile' });
  S.sph(-3.5, 9.92, -1.4, 0.16, 0xffc21a, { kind: 'gold' }); S.cone(-3.5, 10.0, -1.4, 0.04, 0.55, 0xffc21a, { kind: 'gold', seg: 5 });
  S.sph(-0.75, 7.5, -2.9, 0.18, 0xffc21a, { kind: 'gold', q: 0 });
  // flat terrace roof of the wing
  S.box(3.1, 3.2, -2.65, 2.8, 0.2, 5.0, CREAM);
  S.box(3.1, 3.4, -2.65, 2.3, 0.05, 4.5, 0xb89a72, { kind: 'plank' });
  for (const [x0, z0, x1, z1] of [[1.8, -5.15, 4.4, -5.15], [4.4, -5.15, 4.4, -0.15], [1.8, -0.15, 4.4, -0.15]]) balustrade(S, x0, z0, x1, z1, 3.4, 0.62, CREAM);
  // chimney
  S.box(1.0, 5.4, -4.6, 0.7, 2.4, 0.7, 0xc9b79a, { kind: 'stone' }); S.box(1.0, 7.7, -4.6, 0.9, 0.15, 0.9, STONE); S.cyl(1.0, 7.85, -4.6, 0.16, 0.3, ROOF, { seg: 8 });
  // quoins
  quoins(S, 1.9, -0.3, 1, 1, 5.3, STONE); quoins(S, -4.5, -0.3, -1, 1, 7.4, STONE); quoins(S, -2.5, -0.3, 1, 1, 7.4, STONE); quoins(S, 4.3, -0.3, 1, 1, 3.1, STONE);
  quoins(S, -3.4, -5.5, -1, -1, 5.2, STONE); quoins(S, 1.9, -5.5, 1, -1, 5.2, STONE);
  // porch
  S.box(-0.4, 0, 0.35, 2.7, 0.18, 1.3, STONE, { kind: 'stone' }); S.box(-0.4, 0, 0.95, 3.0, 0.1, 0.7, shade(STONE, 0.95), { kind: 'stone' });
  // balcony above the door
  S.box(-0.4, 2.62, 0.4, 2.8, 0.2, 1.4, CREAM); balustrade(S, -1.75, 1.05, 0.95, 1.05, 2.82, 0.75, CREAM);
  balustrade(S, -1.75, 1.05, -1.75, -0.1, 2.82, 0.75, CREAM); balustrade(S, 0.95, 1.05, 0.95, -0.1, 2.82, 0.75, CREAM);
  for (const s of [-1, 1]) { S.box(-0.4 + s * 1.2, 1.2, 0.95, 0.26, 1.45, 0.26, CREAM); S.sph(-0.4 + s * 1.2, 2.7, 0.95, 0.18, STONE, { q: 0 }); }
  // --- windows & doors ---
  wf(ctx, 0, 0, -0.3, 0, () => {
    door(ctx, -0.4, 1.35, 2.45, { arch: true, leaf: TRIM, glassTop: false });
    win(ctx, -1.65, 0.95, 0.9, 1.55, { arch: true, shutter: TRIM, flower: [0xff6f91, 0xffd23f, 0xff8a3d] });
    win(ctx, 1.1, 0.95, 0.9, 1.55, { arch: true, shutter: TRIM, flower: [0xff6f91, 0xffffff, 0xffd23f] });
    win(ctx, -1.65, 3.2, 0.85, 1.5, { arch: true, shutter: TRIM });
    win(ctx, 1.1, 3.2, 0.85, 1.5, { arch: true, shutter: TRIM });
    win(ctx, -0.4, 3.0, 1.1, 1.95, { arch: true, sill: false, trim: CREAM, cross: true, v: 1, curtain: 0xffffff });
  });
  wf(ctx, 3.1, 0, -0.3, 0, () => { door(ctx, 0, 1.6, 2.5, { arch: true, leaf: TRIM, glassTop: true }); });
  wf(ctx, -3.5, 0, -0.3, 0, () => {
    win(ctx, 0, 1.0, 0.7, 1.4, { arch: true, shutter: TRIM, flower: [0xff6f91, 0xffd23f] });
    win(ctx, 0, 3.0, 0.7, 1.2, { arch: true, shutter: TRIM });
    // oculus
    S.tor(0, 4.75, 0.06, 0.38, 0.07, CREAM, { seg: 20 }); ctx.P.win2.disc(0, 4.75, 0.05, 0.38, DARKWIN); F3.disc(0, 4.75, 0.05, 0.38, 0xffe3a0, { kind: 'glow' }); F3.disc(0, 4.75, 0.08, 0.38, 0xaee6ff, { kind: 'glass' });
    for (const [i, a] of [[0, 0], [1, PI / 2]]) F3.box(0, 4.75, 0.09, i ? 0.76 : 0.03, i ? 0.03 : 0.76, 0.03, CREAM, { rz: 0 });
    // belfry arches (dark)
    S.arch(0, 6.2, 0.04, 0.78, 1.35, 0.06, 0x2a2430); S.put(GEO.archFrame(0.78, 1.35, 0.1), 'solid', CREAM, 0, 6.2, 0.07, null, 1, 1, 0.14);
  });
  for (const [x, z, ry] of [[-4.5, -1.4, -PI / 2], [-2.5, -1.4, PI / 2]]) wf(ctx, x, 0, z, ry, () => { if (x < -3) win(ctx, 0, 1.0, 0.7, 1.4, { arch: true, shutter: TRIM }); S.arch(0, 6.2, 0.04, 0.78, 1.35, 0.06, 0x2a2430); S.put(GEO.archFrame(0.78, 1.35, 0.1), 'solid', CREAM, 0, 6.2, 0.07, null, 1, 1, 0.14); });
  wf(ctx, -3.5, 0, -2.5, PI, () => { S.arch(0, 6.2, 0.04, 0.78, 1.35, 0.06, 0x2a2430); S.put(GEO.archFrame(0.78, 1.35, 0.1), 'solid', CREAM, 0, 6.2, 0.07, null, 1, 1, 0.14); });
  wf(ctx, 1.9, 0, -2.6, PI / 2, () => { win(ctx, 0, 3.65, 0.9, 1.5, { arch: true, shutter: TRIM }); win(ctx, -1.5, 3.65, 0.9, 1.5, { arch: true, shutter: TRIM }); });
  wf(ctx, 4.3, 0, -2.6, PI / 2, () => { win(ctx, 0, 1.0, 0.9, 1.5, { arch: true, shutter: TRIM, flower: [0xff6f91, 0xffffff] }); });
  wf(ctx, 0, 0, -5.5, PI, () => {
    win(ctx, -2.4, 1.0, 0.9, 1.5, { arch: true, shutter: TRIM }); win(ctx, 0.2, 1.0, 0.9, 1.5, { arch: true, shutter: TRIM }); win(ctx, 2.4, 1.0, 0.9, 1.5, { arch: true, shutter: TRIM });
    win(ctx, -2.4, 3.2, 0.9, 1.5, { arch: true, shutter: TRIM }); win(ctx, 0.2, 3.2, 0.9, 1.5, { arch: true, shutter: TRIM }); win(ctx, 2.4, 3.2, 0.9, 1.5, { arch: true, shutter: TRIM });
  });
  wf(ctx, -3.4, 0, -4.0, -PI / 2, () => { win(ctx, 0, 1.0, 0.9, 1.5, { arch: true, shutter: TRIM }); win(ctx, 0, 3.2, 0.9, 1.5, { arch: true, shutter: TRIM }); win(ctx, 1.3, 3.2, 0.9, 1.5, { arch: true, shutter: TRIM }); });
  // --- pergola with climbing flowers in front of the wing ---
  const px0 = 1.95, px1 = 4.25, pz0 = 0.05, pz1 = 2.5;
  S.box(3.1, 0, 1.3, 2.7, 0.12, 2.9, 0xcfc3ac, { kind: 'stone' });
  for (const x of [px0, px1]) for (const z of [pz0 + 0.1, pz1]) { S.box(x, 0.12, z, 0.24, 2.7, 0.24, CREAM); S.box(x, 2.8, z, 0.36, 0.1, 0.36, STONE); }
  for (const x of [px0, px1]) S.box(x, 2.9, (pz0 + pz1) / 2, 0.2, 0.2, pz1 - pz0 + 0.8, WOOD, { kind: 'plank' });
  for (let i = 0; i < 7; i++) S.box(3.1, 3.1, pz0 - 0.15 + i * 0.42, px1 - px0 + 0.7, 0.1, 0.12, WOOD, { kind: 'plank' });
  for (let i = 0; i < 14; i++) S.sph(px0 + R() * (px1 - px0), 3.2 + R() * 0.15, pz0 + R() * (pz1 - pz0) + 0.2, 0.28 + R() * 0.2, i % 3 ? 0x3f9a3a : 0xe0409a, { kind: 'leaf', sy: 0.55, q: 0, jit: 0.08 });
  for (let i = 0; i < 9; i++) S.sph(px0 + R() * (px1 - px0), 2.6 + R() * 0.3, pz1 + R() * 0.2, 0.14 + R() * 0.08, i % 2 ? 0xe0409a : 0xff6fb5, { kind: 'leaf', q: 0 });
  // table + chairs under the pergola
  S.cyl(3.1, 0.12, 1.3, 0.05, 0.62, 0x4a3a2c, { seg: 6 }); S.cyl(3.1, 0.74, 1.3, 0.55, 0.05, 0xffffff, { seg: 14 }); S.cyl(3.1, 0.7, 1.3, 0.4, 0.06, TRIM, { seg: 14 });
  for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; S.rbox(3.1 + Math.cos(a) * 0.85, 0.12, 1.3 + Math.sin(a) * 0.85, 0.42, 0.45, 0.42, 0.05, 0xd7b88a); S.box(3.1 + Math.cos(a) * 1.0, 0.5, 1.3 + Math.sin(a) * 1.0, 0.42, 0.45, 0.06, 0xd7b88a, { ry: -a + PI / 2 }); }
  // rooftop terrace: parasol, loungers, pots
  S.cyl(3.0, 3.45, -2.8, 0.03, 2.2, 0xdddddd, { seg: 6 }); S.cone(3.0, 5.0, -2.8, 1.35, 0.55, 0xffffff, { seg: 10 }); S.tor(3.0, 5.02, -2.8, 0.92, 0.05, TRIM, { flat: true });
  S.cone(3.0, 5.0, -2.8, 1.36, 0.1, TRIM, { seg: 10 });
  for (const z of [-1.4, -3.9]) { S.rbox(3.6, 3.45, z, 0.7, 0.2, 1.7, 0.08, 0xffffff); S.rbox(3.6, 3.62, z - 0.3, 0.64, 0.1, 1.0, 0.04, TRIM); }
  pot(S, 2.2, 3.45, -0.8, 1.1, 0xc9683a, 0x3f8f35, 0xff6f91); pot(S, 2.2, 3.45, -4.8, 1.1, 0xc9683a, 0x3f8f35, 0xffd23f);
  ctx.height = 10.2;

  // --- stage 3: lanterns beside the door, lit pergola lamps ---
  for (const s of [-1, 1]) lantern(F3, -0.4 + s * 1.25, 1.6, 0.2, 0xffd88a, 1.3);
  F3.halo(3.1, 2.55, 1.3, 1.6, 0xffc070, 0.55, 0.3);
  F3.sph(3.1, 2.65, 1.3, 0.12, 0xffe6a8, { kind: 'glow', q: 0 }); F3.seg(3.1, 2.65, 1.3, 3.1, 3.0, 1.3, 0.01, 0x30343b);
  F3.sph(1.1, 5.3, -5.45, 0.1, 0xffe6a8, { kind: 'glow', q: 0 });

  // --- stage 4: garden, paths, driveway, trees, dock ---
  const gp = [[-0.4, 1.0], [-0.3, 3.2], [0.4, 5.6], [0.2, 8.2], [0.0, 10.8]];
  G4.ribbon(gp, 1.7, 0.03, 0xe0d4bb, { kind: 'paver' });
  const dp = [[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]];
  G4.ribbon(dp, 3.1, 0.025, 0x9d958a, { kind: 'paver', texScale: 1.2 });
  G4.ribbon([[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]].map(([x, z]) => [x + 1.6, z]), 0.14, 0.04, 0xe0d4bb, {});
  G4.ribbon([[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]].map(([x, z]) => [x - 1.6, z]), 0.14, 0.04, 0xe0d4bb, {});
  G4.floor(-1.5, 0.04, 1.9, 5.8, 2.4, 0xd3c6ad, { kind: 'stone' });
  flowerBed(G4, -2.6, 0.55, 2.4, 0.7, [0xff6f91, 0xffd23f, 0xffffff, 0xff8a3d], 22); flowerBed(G4, 1.8, 0.55, 1.2, 0.7, [0xb785ff, 0xffffff, 0xff6f91], 12);
  flowerBed(G4, -3.9, 3.4, 0.8, 2.6, [0xffd23f, 0xff8a3d, 0xff6f91], 16);
  cypress(G4, -5.4, 1.3, 1.5); cypress(G4, -5.6, 3.2, 1.25); cypress(G4, 5.5, 8.2, 1.4);
  treeRound(G4, -9.0, 5.8, 1.1, 0x7d9a5a, 0x6b5238); treeRound(G4, 8.7, 6.4, 0.95, 0x86a65a, 0x6b5238);
  treeRound(G4, 5.1, -8.0, 1.2, 0x5fa14a); treeRound(G4, -4.3, -8.2, 1.15, 0x6fb04f); treeRound(G4, 9.0, 1.8, 0.9, 0x7bb057);
  bush(G4, -1.9, -6.1, 0.9, 0x4b9a3f); bush(G4, 3.0, -6.0, 0.85, 0x4b9a3f); bush(G4, -5.1, -1.5, 0.7, 0x4b9a3f);
  pot(G4, -1.9, 0.18, 1.1, 1.1, 0xc9683a, 0x3f8f35, 0xff4f5f); pot(G4, 1.1, 0.18, 1.1, 1.1, 0xc9683a, 0x3f8f35, 0xffd23f);
  pot(G4, -1.4, 0.0, 0.6, 1.3, 0xd9743f, 0x3f8f35); G4.sph(-1.4, 1.35, 0.6, 0.12, 0xffd23f, { q: 0 });
  for (const s of [-1, 1]) { G4.cyl(-0.4 + s * 1.7, 0, 1.0, 0.22, 0.5, 0xc9683a, { r2: 0.3, seg: 10 }); G4.sph(-0.4 + s * 1.7, 1.0, 1.0, 0.5, 0x3f8f35, { kind: 'leaf', q: 1 }); for (let i = 0; i < 5; i++) G4.sph(-0.4 + s * 1.7 + (R() - 0.5) * 0.7, 0.95 + R() * 0.5, 1.0 + (R() - 0.5) * 0.7, 0.09, 0xffd23f, { q: 0 }); }
  lawnPatches(G4, [0xff6f91, 0xffffff, 0xffd23f, 0xb785ff], 22, 11);
  rock(G4, -9.6, 1.2, 0.6, 0xaab0b6); rock(G4, 9.8, 4.2, 0.5, 0xaab0b6);
  // harbour dock + sailboat
  buildPier(ctx, G4, -2.2, 10.2, 16.4, 1.7);
  G4.cyl(-2.2, 0.36, 16.3, 0.12, 0.5, 0x30343b, { seg: 8 }); G4.sph(-2.2, 0.95, 16.3, 0.12, 0xffe6a8, { kind: 'glow', q: 0 }); G4.halo(-2.2, 0.95, 16.3, 1.0, 0xffc870, 0.6, 0.3);
  for (const z of [11.2, 13.4]) for (const s of [-1, 1]) { G4.cyl(-2.2 + s * 0.78, 0.37, z, 0.09, 0.28, 0xd9473a, { seg: 8, r2: 0.07 }); }
  G4.cylc(-2.2, 0.48, 12.3, 0.2, 0.12, 0xd8c7a3, { seg: 10 });
  const boat = ctx.sub('g4', -0.35, -0.55, 13.7), bb = boat.b;
  bb.sph(0, 0.2, 0, 1, 0xffffff, { sx: 0.62, sy: 0.42, sz: 1.75, q: 1 });
  bb.box(0, 0.58, 0, 0.9, 0.06, 2.5, 0xb8895a, { kind: 'plank', ry: 0 });
  bb.sph(0, 0.28, 0, 1.01, 0xd9473a, { sx: 0.63, sy: 0.12, sz: 1.76, q: 1 });
  bb.cyl(0, 0.6, -0.3, 0.04, 3.7, 0xdddddd, { seg: 6 });
  bb.put(GEO.tri(), 'cloth', 0xffffff, 0.0, 0.8, -0.3, [0, -PI / 2, 0], 1.0, 2.8, 1, {});
  bb.put(GEO.tri(), 'cloth', 0xfff0d0, 0.0, 0.7, -0.3, [0, PI / 2, 0], 1.0, 2.1, 1, {});
  bb.box(0, 0.62, 0.6, 0.5, 0.35, 0.55, 0xffffff); bb.quad(0, 0.9, 0.88, 0.4, 0.15, 0x6fd3ff, { kind: 'glass' });
  ctx.on(boat.g, (t) => { boat.g.position.y = -0.55 + Math.sin(t * 1.3) * 0.035; boat.g.rotation.z = Math.sin(t * 1.1) * 0.025; boat.g.rotation.x = Math.sin(t * 0.9 + 1) * 0.02; });

  // --- stage 5: grand finale ---
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6, z = 1.4 + t * 8.6, x = -0.35 + Math.sin(t * 3) * 0.3;
    for (const s of [-1, 1]) {
      F5.cyl(x + s * 1.05, 0, z, 0.06, 0.45, 0x30343b, { seg: 6 }); F5.sph(x + s * 1.05, 0.55, z, 0.09, 0xffe6a8, { kind: 'glow', q: 0 }); F5.halo(x + s * 1.05, 0.55, z, 0.75, 0xffc870, 0.6, 0.3);
    }
  }
  for (const x of [-3.0, -1.8, -0.2, 1.2]) { F5.sph(x, 0.08, 0.15, 0.09, 0xffd88a, { kind: 'glow', q: 0 }); F5.halo(x, 0.4, 0.2, 1.1, 0xffc070, 0.45, 0.2); }
  for (const [x, z] of [[-4.6, -0.1], [-2.4, -0.1]]) F5.halo(x, 0.5, z + 0.2, 1.3, 0xffc070, 0.45, 0.2);
  const f1 = makeFlag(ctx, 'f5', -3.5, 11.15, -1.4, 1.5, 0.9, TRIM, 0xffffff, 0);
  F5.cyl(-3.5, 9.9, -1.4, 0.03, 1.6, 0xdddddd, { seg: 5 });
  F5.cyl(3.9, 3.4, -4.7, 0.03, 4.2, 0xdddddd, { seg: 5 }); F5.sph(3.9, 7.62, -4.7, 0.07, 0xffc21a, { kind: 'gold', q: 0 });
  const f2 = makeFlag(ctx, 'f5', 3.9, 7.1, -4.7, 1.4, 0.85, 0xffffff, TRIM, 0);
  F5.seg(-4.0, 3.2, 1.0, 4.6, 3.2, 1.0, 0.012, 0x444444);
  for (let i = 0; i < 12; i++) { const t = i / 11, x = lerp(-4.0, 4.6, t); const y = 3.2 + Math.sin(t * PI) * -0.4; F5.put(GEO.tri(), 'cloth', i % 3 === 0 ? TRIM : i % 3 === 1 ? 0xffffff : ROOF, x, y - 0.3, 1.0, [0, 0, 0], 0.3, 0.3, 1, {}); }
  const smoke = ctx.bb('f5', 14, false);
  ctx.on('f5', (t) => {
    for (let i = 0; i < 14; i++) {
      const ph = ((t * 0.16 + i / 14) % 1), a = 1 - ph;
      smoke.set(i, 1.0 + Math.sin(ph * 6 + i) * 0.12 + ph * 0.8, 8.2 + ph * 3.2, -4.6 + Math.cos(ph * 5 + i) * 0.1, 0.18 + ph * 0.55, 0.92, 0.92, 0.94, a * a * 0.55 * Math.min(1, ph * 8));
    }
    smoke.commit();
  });
}

// ---------- penthouse (neon): glass-and-neon cyber tower house ----------
function neonEdge(b, x0, y, z0, x1, z1, col, t, halos) {
  t = t || 0.07;
  b.seg(x0, y, z0, x1, y, z1, t, col, { kind: 'neon', seg: 5 });
  if (halos) { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 2.4)); for (let i = 0; i <= n; i++) b.halo(lerp(x0, x1, i / n), y, lerp(z0, z1, i / n), 0.9, col, 0.4, 0.2); }
}
function neonPalm(b, x, z, s, c1, c2) {
  if (blocked(x, z, s)) return;
  const H = 3.6 * s;
  b.cyl(x, 0, z, 0.2 * s, H, 0x2a2252, { r2: 0.1 * s, seg: 8 });
  for (let i = 0; i < 5; i++) b.tor(x, 0.5 * s + i * 0.65 * s, z, (0.2 - i * 0.021) * s, 0.03 * s, c1, { flat: true, kind: 'neon', seg: 12 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU, ln = 1.7 * s;
    b.sph(x + Math.cos(a) * ln * 0.5, H + 0.12 * s, z + Math.sin(a) * ln * 0.5, ln * 0.5, i % 2 ? c1 : c2, { kind: 'glowD', sx: 1, sy: 0.07, sz: 0.3, ry: -a, rz: -0.3, q: 0 });
    b.sph(x + Math.cos(a) * ln * 1.15, H - 0.25 * s, z + Math.sin(a) * ln * 1.15, ln * 0.4, i % 2 ? c1 : c2, { kind: 'glowD', sx: 1, sy: 0.07, sz: 0.26, ry: -a, rz: -0.7, q: 0 });
  }
  b.sph(x, H + 0.1 * s, z, 0.16 * s, 0xffffff, { kind: 'glow', q: 0 });
  b.halo(x, H, z, 2.4 * s, c1, 0.4, 0.15);
  b.blob(x, z, 0.9 * s, 0.9 * s, 0.5);
}

function buildPenthouse(ctx) {
  const H = ctx.h, WALL = H.wall, ROOF = H.roof, NEO = H.trim;
  const S = ctx.P.shell, F3 = ctx.P.fin3, G4 = ctx.P.g4, F5 = ctx.P.f5;
  const CY = 0x39f3ff, MG = 0xff3df2, YL = 0xffe14d, GR = 0x3dff9a, DK = 0x15122e, PUR = 0x7b61ff, METAL = 0x4a4870;
  ctx.foot = { cx: 0, cz: -2.9, w: 9.0, d: 5.6 }; ctx.height = 13.2; ctx.pathCol = 0x38325f;
  const L0 = { x0: -4.3, x1: 4.3, z0: -5.6, z1: -0.3, h: 3.3, floors: 1, wall: 0.5 };
  const L1 = { x0: -3.0, x1: 4.3, z0: -5.2, z1: -1.0, y0: 3.3, h: 2.8, floors: 1, wall: 0.45 };
  const L2 = { x0: -4.3, x1: 1.9, z0: -5.0, z1: -1.6, y0: 6.1, h: 2.6, floors: 1, wall: 0.4 };
  const L3 = { x0: -1.2, x1: 1.9, z0: -4.6, z1: -2.2, y0: 8.7, h: 2.0, floors: 1, wall: 0 };
  rawStructure(ctx, [L0, L1, L2, L3]);
  ctx.solar = [{ x: 0.1, y: 10.82, z: -3.2, w: 2.6, d: 1.5, tilt: 0.3 }];

  const vol = (m, col) => S.box((m.x0 + m.x1) / 2, m.y0 || 0, (m.z0 + m.z1) / 2, m.x1 - m.x0, m.h, m.z1 - m.z0, col, { dark: 0.18, jit: 0.01 });
  // podium + slabs
  S.box(0, 0, -2.95, 9.0, 0.35, 5.9, 0x1d1a3c); neonEdge(S, -4.5, 0.36, 0.0, 4.5, 0.0, CY, 0.05); neonEdge(S, 4.5, 0.36, 0.0, 4.5, -5.9, CY, 0.05);
  vol(L0, WALL); vol(L1, shade(WALL, 1.1)); vol(L2, shade(WALL, 0.95));
  const slab = (m, y, col, edge) => {
    const cx = (m.x0 + m.x1) / 2, cz = (m.z0 + m.z1) / 2;
    S.box(cx, y, cz, m.x1 - m.x0 + 0.5, 0.22, m.z1 - m.z0 + 0.5, col);
    const x0 = m.x0 - 0.25, x1 = m.x1 + 0.25, z0 = m.z0 - 0.25, z1 = m.z1 + 0.25;
    neonEdge(S, x0, y + 0.11, z1, x1, z1, edge, 0.06, true); neonEdge(S, x1, y + 0.11, z1, x1, z0, edge, 0.06); neonEdge(S, x0, y + 0.11, z1, x0, z0, edge, 0.06);
  };
  slab(L0, 3.3, 0x201c45, CY); slab(L1, 6.1, 0x201c45, MG); slab(L2, 8.7, ROOF, CY);
  // L3 pavilion frame
  const px0 = L3.x0, px1 = L3.x1, pz0 = L3.z0, pz1 = L3.z1;
  for (const x of [px0, px1, (px0 + px1) / 2]) for (const z of [pz0, pz1]) S.box(x, 8.9, z, 0.16, 1.7, 0.16, DK, { kind: 'metal' });
  S.box((px0 + px1) / 2, 10.6, (pz0 + pz1) / 2, px1 - px0 + 0.9, 0.26, pz1 - pz0 + 0.9, ROOF);
  neonEdge(S, px0 - 0.45, 10.74, pz1 + 0.45, px1 + 0.45, pz1 + 0.45, MG, 0.07, true); neonEdge(S, px1 + 0.45, 10.74, pz1 + 0.45, px1 + 0.45, pz0 - 0.45, MG, 0.07); neonEdge(S, px0 - 0.45, 10.74, pz1 + 0.45, px0 - 0.45, pz0 - 0.45, MG, 0.07);
  // antenna + dish
  S.cyl(1.7, 10.7, -4.6, 0.12, 0.6, METAL, { kind: 'metal', seg: 8, r2: 0.1 }); S.cyl(1.7, 11.3, -4.6, 0.05, 2.0, METAL, { kind: 'metal', seg: 6, r2: 0.02 });
  for (const y of [11.7, 12.2, 12.7]) S.box(1.7, y, -4.6, 0.7 - (y - 11.7) * 0.4, 0.04, 0.04, CY, { kind: 'neon' });
  S.sph(1.7, 13.3, -4.6, 0.1, 0xff2a2a, { kind: 'glow', q: 0 }); S.halo(1.7, 13.3, -4.6, 1.0, 0xff3030, 0.9, 0.9);
  S.dome(-0.9, 10.86, -4.4, 0.4, 0xdfe6f5, { kind: 'metal', sy: 0.6, rx: -0.5 });
  // corner neon sign pillars + tower accent
  neonEdge(S, 4.45, 0.4, -0.45, 4.45, 3.3, MG, 0.07, true); neonEdge(S, 4.45, 3.4, -1.15, 4.45, 6.1, CY, 0.07, true); neonEdge(S, -4.45, 6.2, -1.75, -4.45, 8.7, MG, 0.07, true);
  neonEdge(S, -4.45, 0.4, -0.45, -4.45, 3.3, CY, 0.07, true);
  // canopy + entrance
  S.box(0, 3.0, 0.7, 3.4, 0.16, 2.0, 0x201c45); neonEdge(S, -1.7, 3.0, 1.7, 1.7, 1.7, MG, 0.05, true);
  for (const s of [-1, 1]) S.cyl(s * 1.55, 0.2, 1.55, 0.07, 2.8, 0xcfd6ff, { kind: 'metal', seg: 8 });
  S.box(0, 0.0, 0.9, 4.0, 0.14, 2.4, 0x2b2756, { kind: 'stone' });
  // terrace on L1 roof (x 1.9..4.3) with glass railings + loungers
  const ty = 6.22;
  S.box(3.1, ty, -3.1, 2.4, 0.05, 4.2, 0x3a3470, { kind: 'plank', texScale: 0.8 });
  for (const [x0, z0, x1, z1] of [[4.2, -5.1, 4.2, -1.1], [1.9, -1.1, 4.2, -1.1]]) { S.seg(x0, ty + 0.1, z0, x1, ty + 0.1, z1, 0.03, CY, { kind: 'neon', seg: 5 }); S.seg(x0, ty + 0.9, z0, x1, ty + 0.9, z1, 0.035, 0xdfe6ff, { kind: 'metal', seg: 5 }); }
  S.quad(4.2, ty + 0.5, -3.1, 4.0, 0.8, 0xbfe9ff, { kind: 'glass', ry: PI / 2 }); S.quad(3.05, ty + 0.5, -1.1, 2.3, 0.8, 0xbfe9ff, { kind: 'glass' });
  for (const z of [-2.2, -4.2]) { S.rbox(3.5, ty + 0.05, z, 0.9, 0.3, 1.5, 0.1, 0xf3eeff); S.rbox(3.5, ty + 0.34, z - 0.45, 0.85, 0.3, 0.5, 0.1, 0xffffff, {}); S.box(3.5, ty + 0.05, z, 0.95, 0.04, 1.55, PUR, { kind: 'neon' }); }
  S.cyl(2.5, ty + 0.05, -3.2, 0.32, 0.4, 0x201c45, { seg: 12 }); S.disc(2.5, ty + 0.46, -3.2, 0.26, 0xffb04a, { kind: 'glow' }); S.halo(2.5, ty + 0.6, -3.2, 1.4, 0xff9a3a, 0.6, 0.5);
  // hologram sign (rotating ring + gem)
  const hs = ctx.sub('shell', 3.3, ty + 1.9, -4.5);
  hs.b.tor(0, 0, 0, 0.65, 0.04, CY, { kind: 'neon', seg: 28 }); hs.b.tor(0, 0, 0, 0.5, 0.025, MG, { kind: 'neon', seg: 24, rx: PI / 2 });
  hs.b.sph(0, 0, 0, 0.22, 0xffffff, { kind: 'glow', q: 0 }); hs.b.halo(0, 0, 0, 1.6, CY, 0.55, 0.3);
  S.cyl(3.3, ty, -4.5, 0.1, 0.9, 0x201c45, { seg: 8 }); S.cyl(3.3, ty + 0.9, -4.5, 0.18, 0.05, CY, { kind: 'neon', seg: 12 });
  ctx.on('shell', (t) => { hs.g.rotation.y = t * 0.9; hs.g.position.y = ty + 1.9 + Math.sin(t * 1.6) * 0.07; });
  // drone pad
  S.cyl(-2.75, 8.92, -3.3, 1.3, 0.06, DK, { seg: 28 }); S.tor(-2.75, 8.99, -3.3, 1.18, 0.035, YL, { flat: true, kind: 'neon', seg: 28 });
  S.box(-3.05, 8.98, -3.3, 0.1, 0.02, 0.8, CY, { kind: 'neon' }); S.box(-2.45, 8.98, -3.3, 0.1, 0.02, 0.8, CY, { kind: 'neon' }); S.box(-2.75, 8.98, -3.3, 0.5, 0.02, 0.1, CY, { kind: 'neon' });
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; S.sph(-2.75 + Math.cos(a) * 1.18, 9.02, -3.3 + Math.sin(a) * 1.18, 0.06, 0xff3050, { kind: 'glow', q: 0 }); }
  S.halo(-2.75, 9.1, -3.3, 2.4, YL, 0.2, 0.3);
  const dr = ctx.sub('shell', -2.75, 9.5, -3.3), db = dr.b;
  db.rbox(0, -0.1, 0, 0.5, 0.2, 0.5, 0.08, 0xe8ecff); db.sph(0, -0.02, -0.25, 0.06, 0x39f3ff, { kind: 'glow', q: 0 }); db.sph(0, -0.18, 0, 0.1, 0x222222, { q: 0 });
  const rotors = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    db.seg(sx * 0.12, 0, sz * 0.12, sx * 0.42, 0.02, sz * 0.42, 0.025, 0x30343b); db.cyl(sx * 0.42, 0.0, sz * 0.42, 0.04, 0.06, 0x30343b, { seg: 6 });
    const r = ctx.sub('shell', sx * 0.42, 0.08, sz * 0.42); dr.g.add(r.g); r.b.disc(0, 0, 0, 0.3, 0xcfe9ff, { kind: 'glass' }); r.b.box(0, 0.005, 0, 0.6, 0.012, 0.04, 0x30343b); rotors.push(r);
  }
  ctx.on('shell', (t) => { dr.g.position.set(-2.75 + Math.sin(t * 0.5) * 0.35, 9.7 + Math.sin(t * 1.4) * 0.12, -3.3 + Math.cos(t * 0.5) * 0.3); dr.g.rotation.y = t * 0.3; dr.g.rotation.z = Math.sin(t * 0.7) * 0.06; rotors.forEach((r, i) => { r.g.rotation.y = t * 40 * (i % 2 ? 1 : -1); }); });
  // glass pavilion floor + furniture is in fin3
  S.box((px0 + px1) / 2, 8.9, (pz0 + pz1) / 2, px1 - px0, 0.06, pz1 - pz0, 0x6a4a9a, { kind: 'plank' });

  // --- windows: curtain wall panes (dark in stage 2, glowing interiors in stage 3) ---
  const FR = { trim: DK, cross: false, sill: false, t: 0.07, glass: 0xc9d8ff, fk: 'metal' };
  const warm = [[0xffd7f5, 0xff6ad8], [0xc9f8ff, 0x3ab8ff], [0xffe9b8, 0xff9a4a], [0xe2d4ff, 0x8a5cff], [0xc7ffe3, 0x3de0a0]];
  let k = 0;
  const pane = (x, y, w, h, o) => win(ctx, x, y, w, h, Object.assign({}, FR, { warm: warm[k++ % warm.length], dark: 0x1b1840 }, o));
  wf(ctx, 0, 0, -0.3, 0, () => {
    for (const s of [-1, 1]) for (const x of [1.5, 2.55, 3.6]) pane(s * x, 0.4, 0.9, 2.65);
    door(ctx, 0, 1.5, 2.55, { leaf: 0x1d1a3c, glassTop: true, trim: CY });
  });
  wf(ctx, 0, 0, -1.0, 0, () => { for (const x of [-2.25, -0.6, 1.05, 2.7]) pane(x, 3.6, 1.4, 2.1); });
  wf(ctx, 4.3, 0, -3.1, PI / 2, () => { for (const z of [1.5, 0, -1.5]) pane(z, 3.6, 1.15, 2.1); });
  wf(ctx, 0, 0, -1.6, 0, () => { pane(-2.9, 6.4, 2.4, 2.0); pane(-0.2, 6.4, 1.6, 2.0); });
  wf(ctx, -4.3, 0, -3.3, -PI / 2, () => { pane(0.9, 6.4, 1.4, 2.0); pane(-0.9, 6.4, 1.2, 2.0); });
  wf(ctx, 0, 0, -5.6, PI, () => { for (const x of [-3.0, -1.0, 1.0, 3.0]) pane(x, 0.5, 1.2, 2.4); });
  wf(ctx, 0, 0, -5.2, PI, () => { for (const x of [-3.2, -1.6, 0, 1.6]) pane(x, 3.6, 1.2, 2.1); });
  wf(ctx, -4.3, 0, -3.0, -PI / 2, () => { pane(-1.5, 0.5, 1.2, 2.4); pane(1.0, 0.5, 1.2, 2.4); });
  // real glass pavilion (see-through): panes + interior
  const gl = (x, y, z, w, h, ry) => F3.quad(x, y, z, w, h, 0xbfdcff, { kind: 'glass', ry });
  gl((px0 + px1) / 2, 9.7, pz1, px1 - px0, 1.8, 0); gl((px0 + px1) / 2, 9.7, pz0, px1 - px0, 1.8, PI); gl(px0, 9.7, (pz0 + pz1) / 2, pz1 - pz0, 1.8, -PI / 2); gl(px1, 9.7, (pz0 + pz1) / 2, pz1 - pz0, 1.8, PI / 2);
  F3.rbox(0.3, 8.96, -3.5, 1.9, 0.38, 0.7, 0.12, 0xff8ad8); F3.rbox(0.3, 9.3, -3.8, 1.9, 0.5, 0.2, 0.08, 0xff6ad8); F3.cyl(-0.2, 8.96, -2.8, 0.4, 0.4, 0x2a2252, { seg: 10 }); F3.cyl(1.2, 8.96, -2.8, 0.3, 0.38, 0x2a2252, { seg: 10 });
  F3.sph(0.35, 10.2, -3.4, 0.17, 0xfff0c0, { kind: 'glow', q: 0 }); F3.halo(0.35, 10.2, -3.4, 2.0, 0xffc0f0, 0.6, 0.25);
  F3.box(1.6, 8.96, -4.4, 0.2, 1.1, 0.5, 0x3a3470); F3.sph(1.6, 9.2, -4.3, 0.12, 0x3dff9a, { kind: 'glow', q: 0 }); F3.sph(1.7, 9.55, -4.3, 0.12, 0x39f3ff, { kind: 'glow', q: 0 });
  F3.sph(-0.8, 9.5, -2.4, 0.25, 0x3dd16a, { kind: 'leaf', q: 0 }); F3.cyl(-0.8, 8.96, -2.4, 0.14, 0.4, 0xffffff, { seg: 8 });
  F3.halo(0.3, 9.6, -3.4, 4.5, 0xff7ad8, 0.22, 0.1);
  F3.halo(0, 5.2, -4.0, 9.0, 0xff3df2, 0.13, 0.05);      // sunset-neon glow behind the tower

  // --- stage 4: neon garden ---
  G4.ribbon([[0, 1.4], [0.1, 4.0], [-0.1, 7.0], [0, 10.6]], 1.7, 0.03, 0x332d62, { kind: 'paver' });
  for (const s of [-1, 1]) G4.ribbon([[s * 0.86, 1.4], [s * 0.96, 4.0], [s * 0.76, 7.0], [s * 0.86, 10.6]], 0.07, 0.05, CY, { kind: 'neon' });
  const dp = [[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]];
  G4.ribbon(dp, 3.1, 0.025, 0x1c1a3a, { kind: 'paver', texScale: 1.4 });
  for (const s of [-1, 1]) G4.ribbon(dp.map(([x, z]) => [x + s * 1.5, z]), 0.08, 0.04, MG, { kind: 'neon' });
  G4.floor(0, 0.03, 1.1, 5.0, 1.6, 0x2f2a5c, { kind: 'paver' });
  neonPalm(G4, -4.9, 1.2, 1.0, CY, MG); neonPalm(G4, 5.0, 2.4, 1.1, MG, CY); neonPalm(G4, 5.3, 8.1, 1.2, CY, MG); neonPalm(G4, -9.0, 5.4, 1.1, MG, CY);
  neonPalm(G4, 8.8, -7.0, 1.2, CY, MG); neonPalm(G4, -4.6, -8.0, 1.2, MG, CY); neonPalm(G4, 9.4, 3.0, 1.0, CY, YL); neonPalm(G4, 1.5, -9.0, 1.1, YL, MG);
  for (const [x, z, c] of [[-2.3, 1.6, MG], [2.3, 1.6, CY], [-3.8, 2.8, CY], [3.9, 2.4, MG]]) { G4.box(x, 0, z, 0.9, 0.5, 0.9, 0x201c45); G4.box(x, 0.5, z, 0.8, 0.04, 0.8, c, { kind: 'neon' }); G4.sph(x, 0.8, z, 0.3, shade(c, 0.5), { kind: 'leaf', q: 0 }); G4.halo(x, 0.55, z, 1.2, c, 0.4, 0.2); }
  for (const [x, z, c] of [[-6.0, 8.0, CY], [7.5, 5.8, MG], [-9.4, -1.0, MG], [9.0, -4.4, CY]]) { rock(G4, x, z, 0.7, 0x4b3f80); G4.sph(x, 0.25, z, 0.25, c, { kind: 'glow', q: 0 }); G4.halo(x, 0.3, z, 1.3, c, 0.5, 0.2); }
  // holographic lamp posts along the path
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const z = 2.6 + i * 2.3; G4.cyl(s * 1.3, 0, z, 0.05, 0.9, 0x201c45, { seg: 6 }); G4.sph(s * 1.3, 1.0, z, 0.11, s > 0 ? MG : CY, { kind: 'glow', q: 0 }); G4.halo(s * 1.3, 1.0, z, 1.1, s > 0 ? MG : CY, 0.55, 0.25); }
  // --- stage 5: finale ---
  const cols = [CY, MG, YL, GR];
  for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; const r = 10.55 * coast(a); F5.sph(Math.sin(a) * r, 0.03, Math.cos(a) * r, 0.1, cols[i % 4], { kind: 'glow', q: 0 }); if (i % 3 === 0) F5.halo(Math.sin(a) * r, 0.12, Math.cos(a) * r, 1.2, cols[i % 4], 0.45, 0.3); }
  for (const [bx, bz, c] of [[-1.0, -3.4, MG], [1.2, -3.6, CY]]) {
    const bm = ctx.sub('f5', bx, 10.9, bz); bm.b.cyl(0, 0, 0, 0.12, 0.3, DK, { seg: 8 });
    const cone = ctx.sub('f5', 0, 0.3, 0); bm.g.add(cone.g); cone.b.cyl(0, 0, 0, 0.14, 6.5, c, { r2: 1.1, kind: 'beam', seg: 14 });
    ctx.on('f5', (t) => { bm.g.rotation.z = Math.sin(t * 0.5 + bx) * 0.35; bm.g.rotation.x = Math.cos(t * 0.4 + bx) * 0.3; });
  }
  makeFlag(ctx, 'f5', -4.0, 9.3, -4.9, 1.6, 0.7, MG, CY, 0); F5.cyl(-4.0, 8.9, -4.9, 0.03, 1.2, 0xdddddd, { seg: 5 });
  makeFlag(ctx, 'f5', 4.1, 7.6, -5.0, 1.4, 0.6, CY, PUR, 0); F5.cyl(4.1, 6.15, -5.0, 0.03, 1.8, 0xdddddd, { seg: 5 });
  const motes = ctx.bb('f5', 22, true), md = [];
  for (let i = 0; i < 22; i++) md.push([R() * TAU, 3 + R() * 6, R() * 13, 0.25 + R() * 0.35, R() * 6.28, i % 3]);
  const mc = [[0.22, 0.95, 1.0], [1.0, 0.24, 0.95], [1.0, 0.88, 0.3]];
  ctx.on('f5', (t) => { for (let i = 0; i < 22; i++) { const d = md[i], ph = ((d[2] + t * d[3]) % 13) / 13, a = d[0] + t * 0.06; motes.set(i, Math.cos(a) * d[1], ph * 13, Math.sin(a) * d[1] - 2, 0.1 + 0.06 * Math.sin(t * 2 + d[4]), mc[d[5]][0], mc[d[5]][1], mc[d[5]][2], Math.sin(ph * PI) * 0.7); } motes.commit(); });
  const steam = ctx.bb('f5', 12, true);
  ctx.on('f5', (t) => { for (let i = 0; i < 12; i++) { const ph = (t * 0.2 + i / 12) % 1; steam.set(i, 2.5 + Math.sin(ph * 5 + i) * 0.15, 6.7 + ph * 2.0, -3.2 + Math.cos(ph * 4 + i) * 0.15, 0.2 + ph * 0.4, 1.0, 0.6, 0.35, (1 - ph) * 0.18 * Math.min(1, ph * 6)); } steam.commit(); });
}

// ---------- bungalow (coral): thatched overwater-resort bungalow on stilts ----------
function surfboard(b, x, y, z, col, ry, lean) {
  b.sph(x, y, z, 1, col, { sx: 0.2, sy: 0.04, sz: 1.0, q: 1, ry, rx: lean, kind: 'paint' });
  b.sph(x, y, z, 1, 0xffffff, { sx: 0.045, sy: 0.05, sz: 1.01, q: 0, ry, rx: lean, kind: 'paint' });
}
function tikiTorch(b, ctx, x, z, h, lit) {
  b.cyl(x, 0, z, 0.05, h, 0x8a6a45, { seg: 6, kind: 'bark' }); b.cyl(x, h, z, 0.09, 0.2, 0x4a3a2c, { seg: 8, r2: 0.12 });
  if (lit) {
    b.cone(x, h + 0.18, z, 0.07, 0.3, 0xffa030, { kind: 'glow', seg: 6 }); b.cone(x, h + 0.2, z, 0.04, 0.22, 0xffe070, { kind: 'glow', seg: 6 });
    b.halo(x, h + 0.35, z, 1.2, 0xffa040, 0.7, 0.9);
  }
}
function umbrellaThatch(b, x, z, s) {
  b.cyl(x, 0, z, 0.04 * s, 2.5 * s, 0xd8c7a3, { seg: 6 }); b.cone(x, 2.0 * s, z, 1.5 * s, 0.7 * s, 0xc98b3c, { kind: 'thatch', seg: 10 });
  b.blob(x, z, 1.4 * s, 1.4 * s, 0.4);
}
function lounger(b, x, z, ry, col, cush) {
  b.at(x, 0, z, ry, () => {
    b.rbox(0, 0.14, 0, 0.7, 0.1, 1.9, 0.05, col); b.rbox(0, 0.3, -0.62, 0.66, 0.1, 0.8, 0.05, col, { rx: 0.5 });
    b.rbox(0, 0.2, 0.2, 0.62, 0.08, 1.1, 0.04, cush); b.rbox(0, 0.4, -0.7, 0.6, 0.08, 0.7, 0.04, cush, { rx: 0.5 });
    for (const s of [-1, 1]) for (const zz of [-0.8, 0.8]) b.cyl(s * 0.3, 0, zz, 0.04, 0.16, 0x6a4a2e, { seg: 5 });
    b.blob(0, 0, 0.7, 1.1, 0.45);
  });
}

function buildBungalow(ctx) {
  const H = ctx.h, WALL = H.wall, ROOF = H.roof, TRIM = H.trim;
  const S = ctx.P.shell, F3 = ctx.P.fin3, G4 = ctx.P.g4, F5 = ctx.P.f5, ST = ctx.P.struct;
  const WOOD = 0xb58656, DWOOD = 0x7a5a38, BAMB = 0xe3c88f;
  const CORAL = 0xff6f61, YEL = 0xffbf69, PALE = 0xcbf3f0, ORNG = 0xff9f1c;
  ctx.foot = { cx: 0, cz: -2.0, w: 9.0, d: 7.4 }; ctx.height = 10.2; ctx.pathCol = 0xb98a55;
  const DY = 1.0;                                    // deck height
  const dx0 = -4.4, dx1 = 4.2, dz0 = -5.3, dz1 = 1.7;
  const Hm = { x0: -1.6, x1: 3.0, z0: -4.8, z1: -1.2 }, Hs = { x0: -4.0, x1: -2.2, z0: -4.4, z1: -1.8 };
  ctx.solar = [{ x: 0.7, y: 4.92, z: -1.3, w: 3.2, d: 1.7, tilt: 0.87 }];
  // stage 1: stilts + frame
  for (let x = dx0 + 0.3; x <= dx1; x += 1.7) for (let z = dz0 + 0.3; z <= dz1; z += 1.5) {
    ST.cyl(x, -0.4, z, 0.13, DY + 0.4, 0x8d6a42, { seg: 7, kind: 'bark' });
  }
  for (let z = dz0 + 0.3; z <= dz1; z += 1.5) ST.box((dx0 + dx1) / 2, DY - 0.2, z, dx1 - dx0, 0.14, 0.14, 0x9a7048);
  for (let x = dx0 + 0.3; x <= dx1; x += 0.85) ST.box(x, DY - 0.06, (dz0 + dz1) / 2, 0.1, 0.08, dz1 - dz0, 0xb58656);
  rawStructure(ctx, [{ x0: Hm.x0, x1: Hm.x1, z0: Hm.z0, z1: Hm.z1, y0: DY, h: 2.4, floors: 1, wall: 0.5 }, { x0: Hs.x0, x1: Hs.x1, z0: Hs.z0, z1: Hs.z1, y0: DY, h: 2.1, floors: 1, wall: 0.5 }], { timber: true });

  // deck, stilts, rails
  const deck = (x0, x1, z0, z1, y) => S.box((x0 + x1) / 2, y - 0.1, (z0 + z1) / 2, x1 - x0, 0.12, z1 - z0, 0xc29a62, { kind: 'plank', texScale: 0.8 });
  deck(dx0, dx1, dz0, dz1, DY + 0.1);
  S.box((dx0 + dx1) / 2, DY - 0.25, (dz0 + dz1) / 2, dx1 - dx0 + 0.1, 0.18, dz1 - dz0 + 0.1, DWOOD, { kind: 'plank' });
  for (let x = dx0 + 0.3; x <= dx1; x += 1.7) for (let z = dz0 + 0.3; z <= dz1; z += 1.5) S.cyl(x, -0.4, z, 0.13, DY + 0.2, 0x8d6a42, { seg: 7, kind: 'bark' });
  S.blob(0, -1.6, 5.4, 4.6, 0.5, 0.04);
  for (let i = 0; i <= 3; i++) S.box(0.4, DY - 0.25 - i * 0.25, dz1 + 0.15 + i * 0.32, 1.9, 0.12, 0.34, 0xc29a62, { kind: 'plank', texScale: 0.6 });
  const rail = (x0, z0, x1, z1) => { S.seg(x0, DY + 0.95, z0, x1, DY + 0.95, z1, 0.05, BAMB, { seg: 6 }); S.seg(x0, DY + 0.5, z0, x1, DY + 0.5, z1, 0.035, BAMB, { seg: 6 }); const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.3)); for (let i = 0; i <= n; i++) S.cyl(lerp(x0, x1, i / n), DY, lerp(z0, z1, i / n), 0.055, 0.95, 0xcaa56c, { seg: 6 }); };
  rail(dx0 + 0.1, dz1 - 0.1, -0.7, dz1 - 0.1); rail(1.5, dz1 - 0.1, dx1 - 0.1, dz1 - 0.1); rail(dx0 + 0.1, dz1 - 0.1, dx0 + 0.1, dz0 + 0.1); rail(dx1 - 0.1, dz1 - 0.1, dx1 - 0.1, dz0 + 0.1);

  // main hut
  const hut = (m, h, col) => S.box((m.x0 + m.x1) / 2, DY, (m.z0 + m.z1) / 2, m.x1 - m.x0, h, m.z1 - m.z0, col, { kind: 'plankV', texScale: 1.3, jit: 0.02, dark: 0.1 });
  hut(Hm, 2.4, WALL); hut(Hs, 2.1, shade(WALL, 0.96));
  for (const m of [Hm, Hs]) { const h2 = m === Hm ? 2.4 : 2.1; S.box((m.x0 + m.x1) / 2, DY + 0.9, (m.z0 + m.z1) / 2, m.x1 - m.x0 + 0.04, 0.12, m.z1 - m.z0 + 0.04, TRIM); S.box((m.x0 + m.x1) / 2, DY + h2 - 0.14, (m.z0 + m.z1) / 2, m.x1 - m.x0 + 0.1, 0.2, m.z1 - m.z0 + 0.1, DWOOD, { kind: 'plank' }); }
  // thatched roofs (layered)
  S.box(0.7, DY + 2.4, -3.0, 6.8, 0.08, 5.7, 0x6a4a2e);
  S.hip(0.7, DY + 2.45, -3.0, 6.8, 3.5, 5.7, ROOF, { kind: 'thatch', jit: 0.03 });
  S.hip(0.7, DY + 2.45, -3.0, 6.95, 1.0, 5.85, shade(ROOF, 0.82), { kind: 'thatch' });
  S.cone(0.7, DY + 5.8, -3.0, 0.14, 1.0, 0xe9c68a, { seg: 6 }); S.sph(0.7, DY + 6.85, -3.0, 0.13, 0xffc21a, { kind: 'gold', q: 0 });
  S.box(-3.1, DY + 2.1, -3.1, 3.7, 0.08, 4.2, 0x6a4a2e);
  S.hip(-3.1, DY + 2.15, -3.1, 3.7, 2.3, 4.2, shade(ROOF, 1.04), { kind: 'thatch', jit: 0.03 });
  S.hip(-3.1, DY + 2.15, -3.1, 3.85, 0.8, 4.35, shade(ROOF, 0.82), { kind: 'thatch' });
  S.cone(-3.1, DY + 4.35, -3.1, 0.1, 0.7, 0xe9c68a, { seg: 6 });
  // door, windows
  wf(ctx, 0, DY, -1.2, 0, () => {
    door(ctx, 0.9, 1.1, 2.0, { leaf: 0xa8723f, trim: TRIM });
    win(ctx, -0.5, 0.75, 1.1, 1.1, { trim: TRIM, shutter: CORAL });
    win(ctx, 2.15, 0.75, 1.1, 1.1, { trim: TRIM, shutter: YEL, flower: [0xff6f61, 0xffbf69] });
  });
  wf(ctx, 3.0, DY, -3.0, PI / 2, () => { win(ctx, 0, 0.75, 1.2, 1.1, { trim: TRIM, shutter: CORAL }); });
  wf(ctx, -1.6, DY, -3.0, -PI / 2, () => { win(ctx, 0, 0.75, 1.0, 1.1, { trim: TRIM, shutter: YEL }); });
  wf(ctx, 0.7, DY, -4.8, PI, () => { win(ctx, -1.2, 0.75, 1.1, 1.1, { trim: TRIM, shutter: CORAL }); win(ctx, 1.2, 0.75, 1.1, 1.1, { trim: TRIM, shutter: YEL }); });
  wf(ctx, -3.1, DY, -1.8, 0, () => { door(ctx, 0, 0.9, 1.8, { leaf: 0xa8723f, trim: TRIM }); });
  wf(ctx, -4.0, DY, -3.1, -PI / 2, () => { win(ctx, 0, 0.7, 1.0, 1.0, { trim: TRIM, shutter: CORAL }); });
  // tribal frieze + turquoise posts on the veranda
  for (let i = 0; i < 9; i++) S.box(-1.3 + i * 0.5, DY + 2.05, -1.18, 0.22, 0.22, 0.04, i % 2 ? CORAL : TRIM, { rz: PI / 4 });
  for (const x of [-1.6, 3.0]) { S.cyl(x, DY, -1.0, 0.12, 2.5, DWOOD, { seg: 7, kind: 'bark' }); S.sph(x, DY + 2.55, -1.0, 0.16, TRIM, { q: 0 }); }
  // loungers, cushions, surfboards, hammock
  S.rbox(2.0, DY + 0.1, -0.2, 1.7, 0.3, 0.7, 0.1, 0xfff4e0); S.rbox(2.0, DY + 0.35, -0.5, 1.7, 0.4, 0.2, 0.08, 0xfff4e0);
  S.rbox(1.5, DY + 0.5, -0.45, 0.4, 0.3, 0.12, 0.05, CORAL); S.rbox(2.2, DY + 0.5, -0.45, 0.4, 0.3, 0.12, 0.05, TRIM); S.rbox(2.7, DY + 0.5, -0.45, 0.4, 0.3, 0.12, 0.05, YEL);
  S.cyl(-3.2, DY + 0.0, 0.7, 0.45, 0.4, 0x7a5a38, { seg: 10, kind: 'plank' }); S.cyl(-3.2, DY + 0.4, 0.7, 0.45, 0.05, 0xfff4e0, { seg: 10 }); for (const [x, z] of [[-3.9, 0.7], [-2.5, 0.7]]) S.sph(x, DY + 0.25, z, 0.3, CORAL, { sy: 0.8, q: 0 });
  surfboard(S, 4.0, DY + 1.1, -0.2, TRIM, 0.3, 0.12); surfboard(S, 3.75, DY + 1.05, -0.25, CORAL, 0.2, 0.1); surfboard(S, 3.5, DY + 1.05, -0.3, YEL, 0.1, 0.08);
  S.cyl(-4.2, DY, -0.9, 0.06, 2.0, DWOOD, { seg: 6, kind: 'bark' }); S.cyl(-1.9, DY, 1.5, 0.06, 2.0, DWOOD, { seg: 6, kind: 'bark' });
  const hm = ctx.sub('shell', -3.1, DY + 1.65, 0.4);
  hm.b.sph(0, -0.2, 0, 1, 0xfff4e0, { sx: 0.32, sy: 0.07, sz: 0.95, q: 1 }); hm.b.sph(0, -0.17, 0, 1, CORAL, { sx: 0.33, sy: 0.02, sz: 0.5, q: 0 });
  hm.b.seg(0, -0.2, -0.9, 0, 0.3, -1.2, 0.015, 0xd8c7a3); hm.b.seg(0, -0.2, 0.9, 0, 0.3, 1.2, 0.015, 0xd8c7a3);
  ctx.on('shell', (t) => { hm.g.rotation.x = Math.sin(t * 0.9) * 0.05; });
  pot(S, -4.0, DY, 1.2, 1.4, 0xc9683a, 0x3f9a3a, 0xff4f5f); pot(S, 3.9, DY, 1.3, 1.4, 0xc9683a, 0x3f9a3a, 0xffbf69);

  // stage 3 lights
  for (const x of [-0.5, 2.15]) F3.halo(x, DY + 2.1, -0.9, 1.4, 0xffc070, 0.35, 0.3);
  for (let i = 0; i < 3; i++) { const x = -0.8 + i * 1.7; F3.sph(x, DY + 2.2, -0.5, 0.16, [CORAL, YEL, TRIM][i], { kind: 'glow', q: 0, sy: 1.2 }); F3.seg(x, DY + 2.35, -0.5, x, DY + 2.5, -0.5, 0.008, 0x4a3a2c); F3.halo(x, DY + 2.2, -0.5, 0.9, [CORAL, YEL, TRIM][i], 0.5, 0.4); }

  // --- stage 4: boardwalk, palms, overwater bungalows, beach life ---
  G4.ribbon([[0.4, 3.0], [0.1, 6.0], [0.3, 8.6], [0.0, 10.8]], 1.5, 0.05, 0xc29a62, { kind: 'plank', texScale: 0.8 });
  for (const s of [-1, 1]) G4.ribbon([[0.4 + s * 0.8, 3.0], [0.1 + s * 0.8, 6.0], [0.3 + s * 0.8, 8.6], [0.0 + s * 0.8, 10.8]], 0.1, 0.06, DWOOD, {});
  const dp = [[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]];
  G4.ribbon(dp, 3.1, 0.025, 0xe9dcc0, { kind: 'sand' });
  for (const s of [-1, 1]) G4.ribbon(dp.map(([x, z]) => [x + s * 1.65, z]), 0.2, 0.04, 0xc9a971, {});
  palm(G4, -5.2, 2.6, 1.2, 0.6); palm(G4, 5.2, 8.4, 1.3, 2.4); palm(G4, 8.8, 0.8, 1.15, 3.0); palm(G4, -9.0, 5.2, 1.3, 0.3); palm(G4, 4.6, -8.2, 1.25, 2.0); palm(G4, -5.8, -8.0, 1.2, 0.8);
  palm(G4, 8.9, -6.0, 1.1, 2.6); palm(G4, -2.4, 9.0, 1.0, 1.2); palm(G4, 1.8, -9.2, 1.1, 3.6);
  for (const [x, z] of [[-2.4, 2.6], [2.6, 2.4], [-4.9, 5.2], [3.6, 6.8], [-3.0, -6.2], [4.5, -5.8]]) { bush(G4, x, z, 0.8, 0x3f9a3a); for (let i = 0; i < 5; i++) G4.sph(x + (R() - 0.5) * 1.1, 0.7 + R() * 0.4, z + (R() - 0.5) * 1.1, 0.12, [0xff4f5f, 0xff9f1c, 0xffffff][i % 3], { kind: 'leaf', q: 0 }); }
  flowerBed(G4, -1.0, 2.4, 1.6, 0.8, [CORAL, YEL, 0xffffff, 0xff9ec4], 14, { soil: 0x8a6a45 }); flowerBed(G4, 2.4, 2.9, 1.2, 0.8, [YEL, ORNG, CORAL], 10, { soil: 0x8a6a45 });
  lawnPatches(G4, [0xff6f61, 0xffbf69, 0xffffff], 10, 23);
  umbrellaThatch(G4, 7.4, 7.6, 1.1); lounger(G4, 6.5, 8.4, -0.2, 0xffffff, TRIM); lounger(G4, 8.3, 8.4, 0.2, 0xffffff, CORAL);
  G4.sph(-2.9, 0.18, 10.5, 1, 0xe05a4a, { sx: 0.45, sy: 0.22, sz: 1.5, q: 1, ry: 0.5 }); G4.sph(-2.9, 0.3, 10.5, 1, 0xfff0d0, { sx: 0.3, sy: 0.06, sz: 1.25, q: 0, ry: 0.5 });
  surfboard(G4, 3.2, 0.9, 10.2, CORAL, -0.4, 0.25); surfboard(G4, 3.6, 0.9, 10.3, TRIM, -0.5, 0.25);
  // overwater boardwalk + two bungalows
  const owx = 0.9;
  for (let z = -5.8; z > -13.5; z -= 0.34) G4.box(owx, z > -9.6 ? 0.04 : 0.35, z, 1.35, z > -9.6 ? 0.06 : 0.07, 0.31, shade(0xc29a62, 0.88 + R() * 0.2), { kind: 'plank', texScale: 0.5 });
  for (let z = -10.4; z > -13.5; z -= 1.6) for (const s of [-1, 1]) G4.cyl(owx + s * 0.62, -1.3, z, 0.09, 1.7, 0x7a5a38, { seg: 6, kind: 'bark' });
  const owb = (cx, cz, ry) => {
    G4.at(cx, 0, cz, ry, () => {
      G4.box(0, 0.25, 0, 3.4, 0.1, 3.4, 0xc29a62, { kind: 'plank', texScale: 0.8 }); G4.box(0, 0.12, 0, 3.5, 0.18, 3.5, DWOOD, { kind: 'plank' });
      for (const x of [-1.5, 0, 1.5]) for (const z of [-1.5, 0, 1.5]) G4.cyl(x, -1.4, z, 0.12, 1.7, 0x7a5a38, { seg: 6, kind: 'bark' });
      G4.box(0, 0.35, 0.2, 2.5, 2.0, 2.4, WALL, { kind: 'plankV', texScale: 1.3 }); G4.box(0, 0.35, -0.5, 2.6, 0.1, 2.6, TRIM);
      G4.box(0, 2.35, 0.2, 2.9, 0.08, 2.9, 0x6a4a2e); G4.hip(0, 2.4, 0.2, 3.1, 1.9, 3.1, ROOF, { kind: 'thatch' }); G4.hip(0, 2.4, 0.2, 3.25, 0.7, 3.25, shade(ROOF, 0.82), { kind: 'thatch' });
      G4.cone(0, 4.2, 0.2, 0.09, 0.6, 0xe9c68a, { seg: 5 });
      G4.box(0, 0.36, 1.43, 0.9, 1.7, 0.06, 0xa8723f); G4.box(-0.85, 1.0, 1.43, 0.8, 0.8, 0.06, 0xaee6ff, { kind: 'glass' });
      G4.box(0.7, 0.36, 1.43, 0.7, 0.7, 0.06, 0xaee6ff, { kind: 'glass' });
      G4.box(0, 0.31, 2.0, 1.2, 0.04, 0.8, 0x4fe8d8, { kind: 'glow' });            // glass floor panel
      G4.rbox(-1.0, 0.35, 2.15, 0.7, 0.3, 1.4, 0.1, 0xfff4e0, {}); G4.rbox(1.0, 0.35, 2.15, 0.7, 0.3, 1.4, 0.1, 0xfff4e0, {});
      for (const s of [-1, 1]) for (const z of [1.55, 2.45]) { G4.cyl(s * 1.6, 0.35, z, 0.05, 0.9, BAMB, { seg: 5 }); }
      G4.seg(-1.6, 1.25, 1.55, -1.6, 1.25, 2.45, 0.04, BAMB); G4.seg(1.6, 1.25, 1.55, 1.6, 1.25, 2.45, 0.04, BAMB); G4.seg(-1.6, 1.25, 2.45, 1.6, 1.25, 2.45, 0.04, BAMB);
      G4.seg(-1.5, 0.35, -1.7, -1.5, -0.9, -2.1, 0.03, 0xd8c7a3); G4.box(-1.5, -0.95, -2.2, 0.3, 0.05, 0.3, 0xc29a62);
      G4.halo(0, 1.4, 2.0, 1.4, 0x4fe8d8, 0.3, 0.2);
    });
  };
  owb(-2.4, -15.6, 0.15); owb(4.6, -14.2, -0.25);
  G4.ribbon([[owx, -13.5], [owx - 1.2, -14.2], [-2.4, -14.0]], 1.2, 0.35, 0xc29a62, { kind: 'plank', texScale: 0.5 }); G4.ribbon([[owx, -13.5], [owx + 1.6, -13.7], [4.6, -13.0]], 1.2, 0.35, 0xc29a62, { kind: 'plank', texScale: 0.5 });
  rock(G4, 9.6, 3.6, 0.5, 0xd8c7a3); rock(G4, -9.9, 0.4, 0.6, 0xd8c7a3);
  for (const [x, z] of [[-5.0, 4.4], [-3.8, 7.4]]) { G4.cone(x, 0, z, 0.35, 0.5, 0xc9683a, { seg: 8 }); }

  // --- stage 5: torches, festoon lights, lanterns, flags ---
  for (const [x, z] of [[-0.8, 5.0], [1.5, 5.0], [-0.8, 8.0], [1.5, 8.2], [-4.4, 1.9], [4.1, 1.9]]) tikiTorch(F5, ctx, x, z, 1.5, true);
  const bulbs = [CORAL, YEL, TRIM, 0xffffff, ORNG];
  for (const [x0, z0, x1, z1] of [[dx0 + 0.1, dz1 - 0.1, -0.7, dz1 - 0.1], [1.5, dz1 - 0.1, dx1 - 0.1, dz1 - 0.1]]) {
    const n = 9; F5.seg(x0, DY + 2.4, z0, x1, DY + 2.4, z1, 0.012, 0x3a3228);
    for (let i = 0; i <= n; i++) { const t = i / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), y = DY + 2.4 - Math.sin(t * PI) * 0.35; F5.sph(x, y - 0.06, z, 0.07, bulbs[i % 5], { kind: 'glow', q: 0 }); if (i % 2 === 0) F5.halo(x, y - 0.06, z, 0.6, bulbs[i % 5], 0.55, 0.35); }
  }
  for (const [x, y, z, c] of [[-1.0, DY + 3.6, -0.7, CORAL], [3.0, DY + 3.0, -0.4, YEL], [-3.6, DY + 3.0, -1.7, TRIM]]) { F5.sph(x, y, z, 0.25, c, { kind: 'glow', q: 0, sy: 1.2 }); F5.halo(x, y, z, 1.3, c, 0.5, 0.4); }
  makeFlag(ctx, 'f5', 0.7, DY + 8.0, -3.0, 1.4, 0.75, CORAL, YEL, 0); F5.cyl(0.7, DY + 6.7, -3.0, 0.03, 1.6, 0xdddddd, { seg: 5 });
  for (let i = 0; i < 11; i++) { const t = i / 10, x = lerp(-4.4, 4.2, t); F5.put(GEO.tri(), 'cloth', [CORAL, YEL, TRIM, 0xffffff][i % 4], x, DY + 2.6 - Math.sin(t * PI) * 0.5 - 0.3, dz1 - 0.1, [0, 0, 0], 0.32, 0.32, 1, {}); }
  const sm = ctx.bb('f5', 10, false);
  ctx.on('f5', (t) => { for (let i = 0; i < 10; i++) { const ph = (t * 0.2 + i / 10) % 1; sm.set(i, 3.3 + Math.sin(ph * 5 + i) * 0.1 + ph * 0.4, DY + 0.8 + ph * 2.4, 0.5 + Math.cos(ph * 4 + i) * 0.1, 0.12 + ph * 0.4, 0.95, 0.95, 0.95, (1 - ph) * 0.35 * Math.min(1, ph * 8)); } sm.commit(); });
  F5.cyl(3.3, DY, 0.5, 0.35, 0.5, 0x3a3228, { seg: 10, r2: 0.28 }); F5.disc(3.3, DY + 0.51, 0.5, 0.25, 0xff7a2a, { kind: 'glow' }); F5.halo(3.3, DY + 0.7, 0.5, 1.4, 0xff8a3a, 0.6, 0.9);
}

// ---------- treehouse (jungle): giant tree lodge with rope bridge, lanterns and waterfall ----------
function paperLantern(b, x, y, z, col, s) {
  s = s || 1;
  b.sph(x, y, z, 0.17 * s, col, { kind: 'glow', sy: 1.25, q: 0 }); b.cyl(x, y + 0.2 * s, z, 0.07 * s, 0.05 * s, 0x3a2a1c, { seg: 6 }); b.cyl(x, y - 0.24 * s, z, 0.05 * s, 0.05 * s, 0x3a2a1c, { seg: 6 });
  b.halo(x, y, z, 1.0 * s, col, 0.55, 0.45);
}
function fern(b, x, z, s, col) {
  if (blocked(x, z, s)) return;
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + R() * 0.3; b.sph(x + Math.cos(a) * 0.45 * s, 0.35 * s, z + Math.sin(a) * 0.45 * s, 0.6 * s, shade(col, 0.85 + R() * 0.3), { kind: 'leaf2', sx: 1, sy: 0.07, sz: 0.28, ry: -a, rz: -0.55, q: 0 }); }
}
function mushroom(b, x, z, s, cap, glow) {
  if (blocked(x, z, 0.5)) return;
  b.cyl(x, 0, z, 0.06 * s, 0.25 * s, 0xf3ead6, { seg: 6 });
  b.dome(x, 0.22 * s, z, 0.2 * s, cap, { kind: glow ? 'glow' : 'solid', sy: 0.7, seg: 10 });
  if (glow) b.halo(x, 0.3 * s, z, 0.9 * s, cap, 0.45, 0.3);
  else for (let i = 0; i < 3; i++) b.sph(x + Math.cos(i * 2.1) * 0.1 * s, 0.34 * s, z + Math.sin(i * 2.1) * 0.1 * s, 0.035 * s, 0xffffff, { q: 0 });
}

function buildTreehouse(ctx) {
  const H = ctx.h, WALL = H.wall, ROOF = H.roof, TRIM = H.trim;
  const S = ctx.P.shell, F3 = ctx.P.fin3, G4 = ctx.P.g4, F5 = ctx.P.f5, ST = ctx.P.struct, GR = ctx.P.ground;
  const WOOD = 0xa87848, DWOOD = 0x6a4a2e, LEAF1 = 0x3f9a3a, LEAF2 = 0x2f7d32, LEAF3 = 0x6cbf4a, LEAF4 = 0x4caf50;
  const TX = 1.9, TZ = -3.4, PY = 3.8;                       // trunk position, platform height
  ctx.foot = { cx: -0.4, cz: -3.0, w: 9.2, d: 6.8 }; ctx.height = 14.5; ctx.pathCol = 0xb3a07a;
  ctx.solar = [{ x: -1.0, y: 7.55, z: -2.2, w: 1.9, d: 1.3, tilt: 0.755 }];

  // --- the giant tree is part of the island (always visible) ---
  const T = ctx.P.ground;
  T.lathe('trunk', [[2.1, -0.2], [1.6, 0.5], [1.25, 1.5], [1.12, 3], [1.05, 6], [0.95, 9], [0.78, 11.5], [0.5, 13.2]], TX, 0, TZ, 0x8a6a45, { kind: 'bark', seg: 18 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; T.seg(TX + Math.cos(a) * 0.9, 1.6, TZ + Math.sin(a) * 0.9, TX + Math.cos(a) * 3.1, -0.1, TZ + Math.sin(a) * 3.1, 0.34, 0x866543, { kind: 'bark', seg: 7 }); T.seg(TX + Math.cos(a) * 0.95, 2.3, TZ + Math.sin(a) * 0.95, TX + Math.cos(a) * 2.0, 0.3, TZ + Math.sin(a) * 2.0, 0.3, 0x866543, { kind: 'bark', seg: 7 }); }
  T.blob(TX, TZ, 3.8, 3.8, 0.6);
  // branches + canopy
  const cy = 11.4;
  for (const [a, h, l] of [[0.6, 9.4, 3.2], [2.2, 10.2, 3.6], [3.7, 9.0, 3.0], [5.1, 10.5, 3.4], [1.4, 11.4, 2.8]]) T.seg(TX, h - 1.0, TZ, TX + Math.cos(a) * l, h + 0.8, TZ + Math.sin(a) * l, 0.34, 0x7d5d3c, { kind: 'bark', seg: 7 });
  T.sph(TX, cy, TZ, 3.7, LEAF1, { kind: 'leaf', sy: 0.72, jit: 0.05 });
  const cl = [LEAF1, LEAF2, LEAF3, LEAF4];
  for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU + 0.4, r = 3.3 + (i % 3) * 0.7, hh = cy - 0.8 + (i % 4) * 0.7 - (i % 2) * 0.9; T.sph(TX + Math.cos(a) * r, hh, TZ + Math.sin(a) * r, 2.0 + (i % 3) * 0.4, cl[i % 4], { kind: 'leaf', sy: 0.8, jit: 0.07 }); }
  for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.2; T.sph(TX + Math.cos(a) * 1.8, cy + 1.9 + (i % 2) * 0.4, TZ + Math.sin(a) * 1.8, 1.9, cl[(i + 1) % 4], { kind: 'leaf', jit: 0.06 }); }
  for (let i = 0; i < 16; i++) { const a = R() * TAU, r = 2.8 + R() * 3.2; T.sph(TX + Math.cos(a) * r, cy + (R() - 0.5) * 2.6, TZ + Math.sin(a) * r, 0.18, [0xff6fa5, 0xffd23f, 0xffffff][i % 3], { kind: 'leaf', q: 0 }); }
  for (let i = 0; i < 8; i++) { const a = i * 0.8 + 0.5, r = 3.2 + (i % 3); const vx = TX + Math.cos(a) * r, vz = TZ + Math.sin(a) * r; T.seg(vx, cy - 1.0, vz, vx + 0.1, cy - 1.0 - (3.0 + (i % 3)), vz, 0.03, 0x3f8f35, { seg: 4 }); T.sph(vx + 0.1, cy - 1.0 - (3.0 + (i % 3)), vz, 0.09, 0x4caf50, { q: 0 }); }

  // --- stage 1: structure ---
  const px0 = -3.9, px1 = 3.6, pz0 = -5.7, pz1 = -1.0;
  const posts = [[-3.5, -1.3], [-3.5, -5.3], [-0.6, -1.3], [-0.6, -5.3], [3.2, -1.3], [3.2, -5.3]];
  for (const [x, z] of posts) { ST.cyl(x, -0.3, z, 0.22, PY + 0.4, 0x8d6a42, { seg: 7, kind: 'bark' }); ST.blob(x, z, 0.8, 0.8, 0.5); }
  for (let z = pz0; z <= pz1; z += 1.0) ST.box((px0 + px1) / 2, PY - 0.25, z, px1 - px0, 0.14, 0.14, WOOD, { kind: 'plank' });
  for (let x = px0; x <= px1; x += 0.8) ST.box(x, PY - 0.12, (pz0 + pz1) / 2, 0.1, 0.09, pz1 - pz0, WOOD, { kind: 'plank' });
  ST.beam(-3.5, 0, -1.3, -2.6, PY - 0.2, -1.3, 0.11, DWOOD); ST.beam(3.2, 0, -1.3, 2.4, PY - 0.2, -1.3, 0.11, DWOOD);
  rawStructure(ctx, [{ x0: -3.4, x1: 0.4, z0: -5.0, z1: -1.8, y0: PY, h: 2.5, floors: 1, wall: 0.45 }, { x0: -1.6, x1: 0.8, z0: -4.5, z1: -2.2, y0: 7.2, h: 2.2, floors: 1, wall: 0.3 }], { timber: true });
  rawStructure(ctx, [{ x0: -3.0, x1: -0.4, z0: -4.8, z1: -2.0, h: 2.6, floors: 1, wall: 0.6 }], {});

  // --- platform, stairs, cabins ---
  S.box((px0 + px1) / 2, PY - 0.12, (pz0 + pz1) / 2, px1 - px0, 0.14, pz1 - pz0, 0xc2955c, { kind: 'plank', texScale: 0.8 });
  S.box((px0 + px1) / 2, PY - 0.35, (pz0 + pz1) / 2, px1 - px0 + 0.1, 0.22, pz1 - pz0 + 0.1, DWOOD, { kind: 'plank' });
  for (const [x, z] of posts) S.cyl(x, -0.3, z, 0.22, PY + 0.2, 0x8d6a42, { seg: 7, kind: 'bark' });
  for (const [x, z] of [[-3.5, -3.3], [3.2, -3.3]]) S.cyl(x, -0.3, z, 0.2, PY + 0.2, 0x8d6a42, { seg: 7, kind: 'bark' });
  // ground floor stone-and-wood base room
  S.box(-1.7, 0, -3.4, 2.6, 2.7, 2.8, 0x8a8f86, { kind: 'stone', dark: 0.12 }); S.box(-1.7, 2.6, -3.4, 2.8, 0.14, 3.0, DWOOD, { kind: 'plank' });
  // main cabin
  const cab = { x0: -3.4, x1: 0.4, z0: -5.0, z1: -1.8 };
  S.box((cab.x0 + cab.x1) / 2, PY, (cab.z0 + cab.z1) / 2, 3.8, 2.5, 3.2, WALL, { kind: 'log', texScale: 0.9, jit: 0.02, dark: 0.1 });
  S.box((cab.x0 + cab.x1) / 2, PY + 2.35, (cab.z0 + cab.z1) / 2, 4.2, 0.2, 3.6, DWOOD, { kind: 'plank' });
  S.box((cab.x0 + cab.x1) / 2, PY + 2.5, (cab.z0 + cab.z1) / 2, 4.6, 0.08, 4.0, 0x4a3320);
  S.gable((cab.x0 + cab.x1) / 2, PY + 2.55, (cab.z0 + cab.z1) / 2, 4.9, 2.3, 4.3, shade(ROOF, 1.25), { kind: 'leaf', ry: PI / 2, jit: 0.05 });
  S.gable((cab.x0 + cab.x1) / 2, PY + 2.65, (cab.z0 + cab.z1) / 2, 5.0, 2.2, 4.4, shade(ROOF, 1.7), { kind: 'leaf', ry: PI / 2, jit: 0.05 });
  for (const z of [-3.4 + 2.5, -3.4 - 2.5]) S.box((cab.x0 + cab.x1) / 2, PY + 2.5, z, 4.5, 0.12, 0.14, TRIM);
  for (let i = 0; i < 7; i++) S.sph(-1.5 + (i - 3) * 0.7, PY + 4.35 + (i % 2) * 0.12, -3.4, 0.38, shade(ROOF, 0.9 + (i % 3) * 0.1), { kind: 'leaf', q: 0, sy: 0.8, sz: 1.5 });
  // second (crow's nest) cabin high on the trunk
  S.box(-0.4, 7.2, -3.35, 2.4, 2.2, 2.3, shade(WALL, 1.05), { kind: 'log', texScale: 0.9, dark: 0.1 });
  S.cyl(-0.4, 7.0, -3.35, 1.7, 0.2, DWOOD, { seg: 12, kind: 'plank' });
  S.box(-0.4, 9.3, -3.35, 3.0, 0.14, 3.0, 0x4a3320); S.cone(-0.4, 9.4, -3.35, 2.1, 2.4, shade(ROOF, 1.3), { kind: 'leaf', seg: 10, jit: 0.05 }); S.cone(-0.4, 9.6, -3.35, 2.15, 1.6, shade(ROOF, 1.7), { kind: 'leaf', seg: 10 }); S.tor(-0.4, 9.45, -3.35, 2.0, 0.07, TRIM, { flat: true, seg: 20 });
  S.cyl(-0.4, 11.7, -3.35, 0.05, 0.8, 0xdddddd, { seg: 5 }); S.sph(-0.4, 12.55, -3.35, 0.12, 0xffc21a, { kind: 'gold', q: 0 });
  // spiral stairs around the trunk
  for (let i = 0; i < 14; i++) {
    const a = 3.1 + i * 0.56, y = PY + 0.2 + i * 0.25, r = 1.65;
    S.box(TX + Math.cos(a) * r, y, TZ + Math.sin(a) * r, 0.9, 0.1, 0.5, 0xc2955c, { kind: 'plank', ry: -a + PI / 2 + PI / 2 - PI / 2, texScale: 0.5 });
    S.cyl(TX + Math.cos(a) * (r + 0.42), y, TZ + Math.sin(a) * (r + 0.42), 0.03, 0.8, DWOOD, { seg: 4 });
    if (i) S.seg(TX + Math.cos(a - 0.56) * (r + 0.42), y - 0.25 + 0.8, TZ + Math.sin(a - 0.56) * (r + 0.42), TX + Math.cos(a) * (r + 0.42), y + 0.8, TZ + Math.sin(a) * (r + 0.42), 0.025, 0xd8c7a3, { seg: 4 });
  }
  // front straight stairs from the ground to the platform
  const sx = -3.0;
  for (let i = 0; i < 12; i++) S.box(sx, 0.0 + i * 0.32, 4.0 - i * 0.43, 1.0, 0.12 + i * 0.32, 0.43, 0xc2955c, { kind: 'plank', texScale: 0.6 });
  for (const s of [-1, 1]) { S.beam(sx + s * 0.55, 0, 4.3, sx + s * 0.55, PY - 0.1, -1.0, 0.08, DWOOD); S.seg(sx + s * 0.55, 0.9, 4.2, sx + s * 0.55, PY + 0.95, -1.0, 0.03, 0xd8c7a3); for (let i = 0; i < 5; i++) { const t = i / 4; S.cyl(sx + s * 0.55, lerp(0.0, PY - 0.1, t), lerp(4.2, -0.9, t), 0.035, 0.95, DWOOD, { seg: 5 }); } }
  S.box(sx, PY - 0.1, -0.4, 1.3, 0.12, 1.3, 0xc2955c, { kind: 'plank' });
  // platform railing
  const rail = (x0, z0, x1, z1) => { S.seg(x0, PY + 0.95, z0, x1, PY + 0.95, z1, 0.05, WOOD, { seg: 6 }); S.seg(x0, PY + 0.5, z0, x1, PY + 0.5, z1, 0.02, 0xd8c7a3, { seg: 4 }); const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.2)); for (let i = 0; i <= n; i++) S.cyl(lerp(x0, x1, i / n), PY, lerp(z0, z1, i / n), 0.05, 0.95, WOOD, { seg: 5 }); };
  rail(-3.7, -0.9, -3.7, -5.5); rail(-3.7, -5.5, 3.4, -5.5); rail(3.4, -5.5, 3.4, -0.9); rail(3.4, -0.9, 0.9, -0.9); rail(-2.2, -0.9, -3.7, -0.9);
  // table, stools, barrels
  S.cyl(2.2, PY, -1.9, 0.5, 0.05, 0xc2955c, { seg: 10, kind: 'plank' }); S.cyl(2.2, PY, -1.9, 0.07, 0.7, DWOOD, { seg: 6 }); S.cyl(2.2, PY + 0.7, -1.9, 0.5, 0.05, 0xd2a56c, { seg: 10, kind: 'plank' });
  for (let i = 0; i < 3; i++) S.cyl(2.2 + Math.cos(i * 2.1) * 0.85, PY, -1.9 + Math.sin(i * 2.1) * 0.85, 0.18, 0.42, DWOOD, { seg: 8, kind: 'bark' });
  S.cyl(3.0, PY, -4.7, 0.3, 0.7, 0x8a5a33, { seg: 10, kind: 'plank' }); S.cyl(2.5, PY, -4.9, 0.28, 0.6, 0x8a5a33, { seg: 10, kind: 'plank' });
  pot(S, 3.0, PY, -1.3, 1.2, 0xc9683a, 0x3f9a3a, 0xff6fa5); pot(S, 1.4, PY, -1.2, 1.1, 0xc9683a, 0x3f9a3a, 0xffd23f);
  // windows & doors
  wf(ctx, 0, PY, -1.8, 0, () => {
    door(ctx, -1.5, 0.95, 1.9, { leaf: 0xa8723f, trim: TRIM });
    win(ctx, -2.8, 0.9, 0.7, 0.8, { arch: true, trim: TRIM, sill: false }); win(ctx, -0.2, 0.9, 0.7, 0.8, { arch: true, trim: TRIM, sill: false });
  });
  wf(ctx, 0.4, PY, -3.4, PI / 2, () => { win(ctx, 0, 0.9, 0.9, 0.8, { trim: TRIM, shutter: LEAF2, sill: false }); });
  wf(ctx, -3.4, PY, -3.4, -PI / 2, () => { win(ctx, 0, 0.9, 0.9, 0.8, { arch: true, trim: TRIM, sill: false }); });
  wf(ctx, -0.4, 7.2, -2.2, 0, () => { win(ctx, 0, 0.7, 1.0, 1.0, { arch: true, trim: TRIM, sill: false }); });
  wf(ctx, 0.8, 7.2, -3.35, PI / 2, () => { win(ctx, 0, 0.7, 0.8, 0.9, { trim: TRIM, sill: false }); });
  wf(ctx, -0.4, 0, -2.0, 0, () => { door(ctx, 0.0, 1.0, 1.9, { leaf: 0xa8723f, trim: TRIM }); });
  // brass bell + hanging lanterns (stage 3)
  paperLantern(F3, -1.5, PY + 2.2, -1.5, 0xffc060, 1.1); paperLantern(F3, 0.5, PY + 2.2, -1.5, 0xff9a4a, 1.1);
  F3.halo(-0.4, 7.9, -2.2, 1.6, 0xffc070, 0.45, 0.3);

  // --- stage 4: rope bridge, outpost tree, waterfall, jungle garden ---
  const t2 = { x: -8.4, z: -2.0 };
  G4.lathe('trunk2', [[0.9, -0.2], [0.6, 0.6], [0.5, 2], [0.4, 5.5]], t2.x, 0, t2.z, 0x8a6a45, { kind: 'bark', seg: 12 });
  G4.sph(t2.x, 7.0, t2.z, 2.6, LEAF2, { kind: 'leaf', sy: 0.8, jit: 0.05 }); G4.sph(t2.x - 1.4, 6.4, t2.z + 1.0, 1.7, LEAF1, { kind: 'leaf' }); G4.sph(t2.x + 1.2, 6.5, t2.z - 1.0, 1.8, LEAF3, { kind: 'leaf' });
  G4.cyl(t2.x, 3.2, t2.z, 1.5, 0.16, 0xc2955c, { seg: 14, kind: 'plank' }); G4.cyl(t2.x, 3.0, t2.z, 1.6, 0.2, DWOOD, { seg: 14, kind: 'plank' });
  G4.cyl(t2.x + 1.0, 3.35, t2.z + 0.0, 0.04, 0.9, WOOD, { seg: 5 }); G4.cyl(t2.x, 3.35, t2.z + 1.45, 0.04, 0.9, WOOD, { seg: 5 }); G4.cyl(t2.x, 3.35, t2.z - 1.45, 0.04, 0.9, WOOD, { seg: 5 }); G4.cyl(t2.x - 1.45, 3.35, t2.z, 0.04, 0.9, WOOD, { seg: 5 });
  G4.cyl(t2.x - 0.4, 3.35, t2.z + 0.6, 1.0, 1.6, WALL, { seg: 10, kind: 'log', r2: 0.95 }); G4.cone(t2.x - 0.4, 4.9, t2.z + 0.6, 1.3, 1.1, ROOF, { kind: 'leaf', seg: 10 });
  paperLantern(G4, t2.x + 0.9, 4.2, t2.z - 0.8, 0xffc060, 1.0);
  const bx0 = -3.7, by0 = PY + 0.05, bz0 = -3.4, bx1 = t2.x + 1.4, by1 = 3.5, bz1 = t2.z - 0.2, nb = 14;
  const bridgePt = (t, side) => { const sag = Math.sin(t * PI) * -0.45; const x = lerp(bx0, bx1, t), z = lerp(bz0, bz1, t) + (side || 0) * 0.55; return [x, lerp(by0, by1, t) + sag, z]; };
  for (let i = 0; i < nb; i++) { const a = bridgePt((i + 0.15) / nb), b2 = bridgePt((i + 0.85) / nb); G4.beam(a[0], a[1], a[2] - 0.55, b2[0], b2[1], b2[2] - 0.55, 0.12, 0xc2955c, { kind: 'plank', t2: 0.9 }); }
  for (const side of [-1, 1]) for (const dy of [0.95]) {
    let prev = null;
    for (let i = 0; i <= nb; i++) { const p = bridgePt(i / nb, side); const q = [p[0], p[1] + dy, p[2] - 0.55]; if (prev) G4.seg(prev[0], prev[1], prev[2], q[0], q[1], q[2], 0.03, 0xd8c7a3, { seg: 4 }); prev = q; if (i % 2 === 0) G4.seg(p[0], p[1], p[2] - 0.55, q[0], q[1], q[2], 0.02, 0x8a6a45, { seg: 4 }); }
    prev = null;
    for (let i = 0; i <= nb; i += 1) { const p = bridgePt(i / nb, side); const q = [p[0], p[1] + 0.1, p[2] - 0.55]; if (prev) G4.seg(prev[0], prev[1], prev[2], q[0], q[1], q[2], 0.025, 0xd8c7a3, { seg: 4 }); prev = q; }
  }
  for (const t of [0.25, 0.5, 0.75]) { const p = bridgePt(t, 0); paperLantern(G4, p[0], p[1] + 1.4, p[2] - 0.55, [0xffc060, 0xff9a4a, 0xffe070][Math.round(t * 4) % 3], 0.9); }
  // waterfall + pond (back right)
  const wx = -3.7, wz = -9.0;
  for (const [dx, dy, dz, r] of [[0, 0.8, 0, 1.6], [-1.6, 0.6, 0.4, 1.2], [1.8, 0.7, 0.3, 1.3], [-0.6, 2.2, -0.4, 1.4], [0.9, 2.5, -0.3, 1.2], [0, 3.8, -0.4, 1.1], [-1.0, 3.9, -0.5, 0.8], [0.6, 1.5, -1.0, 1.4], [-2.4, 0.4, 0.1, 0.9]]) G4.sph(wx + dx, dy, wz + dz, r, 0x7d8a7e, { q: 0, sy: 0.85, jit: 0.1, sx: 1.1 });
  for (const [dx, dy, dz, r] of [[-1.2, 1.3, 0.8, 0.6], [1.3, 1.4, 0.7, 0.55], [0.2, 2.2, 0.55, 0.6], [-0.8, 3.0, 0.2, 0.5]]) G4.sph(wx + dx, dy, wz + dz, r, 0x4f8f45, { kind: 'leaf', sy: 0.6, q: 0 });
  G4.quad(wx, 2.2, wz + 0.95, 1.0, 4.3, 0x9fe0ff, { kind: 'fall' }); G4.quad(wx, 2.2, wz + 0.96, 1.0, 4.3, 0x9fe0ff, { kind: 'fall', ry: PI });
  G4.disc(wx, 0.08, wz + 2.3, 1.45, 0x34c8d8, { kind: 'water', sx: 1, sz: 1.1 });
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; G4.sph(wx + Math.cos(a) * 1.6, 0.15, wz + 2.3 + Math.sin(a) * 1.7, 0.25 + (i % 3) * 0.08, 0x7d8a7e, { q: 0, sy: 0.7 }); }
  G4.halo(wx, 0.5, wz + 1.2, 2.6, 0xdff8ff, 0.4, 0.3);
  const mist = ctx.bb('g4', 10, false);
  ctx.on('g4', (t) => { for (let i = 0; i < 10; i++) { const ph = (t * 0.25 + i / 10) % 1; mist.set(i, wx + Math.sin(i * 2.3) * 0.7, 0.4 + ph * 1.8, wz + 1.1 + Math.cos(i * 1.7) * 0.4, 0.4 + ph * 0.7, 1, 1, 1, (1 - ph) * 0.22); } mist.commit(); });
  // stepping stones, ferns, mushrooms
  for (let i = 0; i < 8; i++) G4.cyl(0.6 + Math.sin(i * 0.9) * 0.4, 0, 4.8 + i * 0.75, 0.42, 0.07, 0xa3a392, { seg: 9, kind: 'stone', jit: 0.05 });
  for (const [x, z, s] of [[-5.4, 1.5, 1.2], [4.9, 1.8, 1.1], [-4.6, -7.0, 1.3], [-1.0, -7.8, 1.2], [8.6, 2.4, 1.1], [-2.0, 3.5, 0.9], [2.4, 4.0, 1.0], [6.2, -8.0, 1.2], [-9.0, 3.0, 1.2]]) fern(G4, x, z, s, 0x3f9a3a);
  lawnPatches(G4, [0xff6fa5, 0xffd23f, 0xffffff, 0xff8a3d], 24, 17);
  mushroom(G4, -4.8, 3.6, 1.6, 0xd9473a, false); mushroom(G4, -4.4, 3.2, 1.1, 0xd9473a, false); mushroom(G4, 4.2, -7.6, 1.5, 0x39f3ff, true); mushroom(G4, 4.8, -7.2, 1.0, 0x9b5cff, true); mushroom(G4, -6.3, -7.2, 1.4, 0x39f3ff, true); mushroom(G4, -0.2, -8.2, 1.2, 0xff7af5, true);
  for (const [x, z, s] of [[-6.0, 5.6, 1.1], [7.8, 7.2, 1.2], [-8.4, -6.4, 1.2], [8.9, -3.0, 1.0]]) treeRound(G4, x, z, s, [LEAF1, LEAF2, LEAF3][Math.round(x) & 1 ? 0 : 1]);
  for (const [x, z] of [[-2.4, 2.4], [2.6, 2.0], [-7.0, 4.4]]) { bush(G4, x, z, 0.8, 0x3f9a3a); for (let i = 0; i < 5; i++) G4.sph(x + (R() - 0.5) * 1.1, 0.7 + R() * 0.4, z + (R() - 0.5) * 1.1, 0.11, [0xff6fa5, 0xffd23f, 0xff8a3d][i % 3], { kind: 'leaf', q: 0 }); }
  G4.cyl(4.2, 0, 4.6, 0.3, 0.9, 0x7a5a38, { seg: 10, kind: 'bark' }); G4.cylc(-6.4, 0.26, 6.2, 0.26, 1.0, 0x7a5a38, { seg: 10, kind: 'bark', rz: PI / 2, ry: 0.4 });
  const dp = [[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]];
  G4.ribbon(dp, 3.1, 0.025, 0x9a7d55, { kind: 'dirt' });
  for (const s of [-1, 1]) for (let i = 0; i < 10; i++) { const q = dp[Math.min(3, Math.floor(i / 2.5))]; G4.cyl(q[0] + s * 1.65 + (R() - 0.5) * 0.2, 0, lerp(10.0, -0.4, i / 9), 0.14, 0.28, 0x7a5a38, { seg: 7, kind: 'bark' }); }

  // --- stage 5: lanterns, flags, fireflies, smoke ---
  for (const [x, y, z, c] of [[-3.5, PY + 1.0, -1.0, 0xffc060], [-3.5, PY + 1.0, -5.4, 0xff9a4a], [3.3, PY + 1.0, -5.4, 0xffe070], [3.3, PY + 1.0, -1.0, 0xff9a4a], [-0.4, 8.2, -1.9, 0xffc060], [-1.6, 8.2, -4.7, 0xffe070]]) paperLantern(F5, x, y, z, c, 1.0);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; paperLantern(F5, TX + Math.cos(a) * 3.0, 6.6 + (i % 2) * 1.3, TZ + Math.sin(a) * 3.0, [0xffc060, 0xff9a4a, 0xffe070][i % 3], 1.1); }
  for (const [x, z] of [[-1.3, 4.6], [1.5, 4.8], [-1.0, 8.4], [1.6, 8.0]]) { F5.cyl(x, 0, z, 0.05, 1.0, DWOOD, { seg: 5, kind: 'bark' }); F5.sph(x, 1.08, z, 0.12, 0xffd88a, { kind: 'glow', q: 0 }); F5.halo(x, 1.08, z, 0.9, 0xffc060, 0.55, 0.35); }
  makeFlag(ctx, 'f5', -0.4, 13.4, -3.35, 1.5, 0.8, TRIM, LEAF2, 0);
  F5.cyl(-0.4, 12.6, -3.35, 0.03, 1.3, 0xdddddd, { seg: 5 });
  F5.cyl(-3.0, PY + 2.6, -5.0, 0.06, 1.4, DWOOD, { seg: 5 }); F5.cyl(-3.0, PY + 3.5, -5.0, 0.2, 0.5, 0x8a6a45, { seg: 7 });
  const ff = ctx.bb('f5', 34, true);
  const fseed = []; for (let i = 0; i < 34; i++) fseed.push([R() * TAU, 2 + R() * 8.5, 0.3 + R() * 2.8 + (i % 3) * 1.8, 0.2 + R() * 0.6, R() * 6]);
  ctx.on('f5', (t) => { for (let i = 0; i < 34; i++) { const s = fseed[i], a = s[0] + t * 0.12 * s[3], tw = 0.5 + 0.5 * Math.sin(t * (1.5 + s[3] * 2) + s[4]); ff.set(i, Math.cos(a) * s[1] + Math.sin(t * 0.7 + s[4]) * 0.5, s[2] + Math.sin(t * 0.9 + s[4]) * 0.4, Math.sin(a) * s[1] - 2 + Math.cos(t * 0.6 + s[4]) * 0.5, 0.28, 0.85, 1.0, 0.3, tw * 0.9); } ff.commit(); });
  const sm = ctx.bb('f5', 10, false);
  ctx.on('f5', (t) => { for (let i = 0; i < 10; i++) { const ph = (t * 0.17 + i / 10) % 1; sm.set(i, -2.4 + Math.sin(ph * 6 + i) * 0.12 + ph * 0.7, PY + 5.3 + ph * 2.8, -2.8 + Math.cos(ph * 5 + i) * 0.1, 0.16 + ph * 0.5, 0.92, 0.95, 0.92, (1 - ph) * (1 - ph) * 0.5 * Math.min(1, ph * 8)); } sm.commit(); });
  S.cyl(-2.4, PY + 4.2, -2.8, 0.2, 1.1, 0x9a6a4a, { seg: 8, r2: 0.18 });
}

// ---------- chalet (frost): alpine timber chalet with glass A-frame, hot tub, snow and aurora ----------
function snowman(b, x, z, s) {
  if (blocked(x, z, s)) return;
  b.sph(x, 0.5 * s, z, 0.55 * s, 0xffffff, { q: 1 }); b.sph(x, 1.28 * s, z, 0.42 * s, 0xffffff, { q: 1 }); b.sph(x, 1.9 * s, z, 0.3 * s, 0xffffff, { q: 1 });
  b.cone(x, 1.86 * s, z + 0.28 * s, 0.05 * s, 0.35 * s, 0xff7a1f, { seg: 6, rx: PI / 2 });
  b.cyl(x, 2.14 * s, z, 0.22 * s, 0.22 * s, 0x222222, { seg: 10 }); b.cyl(x, 2.12 * s, z, 0.32 * s, 0.03 * s, 0x222222, { seg: 10 });
  b.tor(x, 1.62 * s, z, 0.3 * s, 0.06 * s, 0xd84a4a, { flat: true, seg: 12 });
  for (const sg of [-1, 1]) { b.sph(x + sg * 0.1 * s, 1.96 * s, z + 0.26 * s, 0.035 * s, 0x111111, { q: 0 }); b.seg(x + sg * 0.4 * s, 1.35 * s, z, x + sg * 0.95 * s, 1.7 * s, z, 0.025 * s, 0x6a4a2e, { seg: 4 }); }
  for (let i = 0; i < 3; i++) b.sph(x, (1.25 - i * 0.2) * s, z + 0.4 * s, 0.04 * s, 0x111111, { q: 0 });
  b.blob(x, z, 0.8 * s, 0.8 * s, 0.4);
}
function icicles(b, x0, z0, x1, z1, y, n) {
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, h = 0.2 + ((i * 7) % 5) * 0.07; b.cone(lerp(x0, x1, t), y - h, lerp(z0, z1, t), 0.045, h, 0xdff3ff, { seg: 5, rx: PI }); }
}

function buildChalet(ctx) {
  const H = ctx.h, WALL = H.wall, SNOW = 0xffffff, TRIM = H.trim;
  const S = ctx.P.shell, F3 = ctx.P.fin3, G4 = ctx.P.g4, F5 = ctx.P.f5, GR = ctx.P.ground;
  const LOG = WALL, DLOG = 0x6a4228, STONE = 0x8d96a0, BLUESH = 0xd7e6f5;
  ctx.foot = { cx: 0, cz: -3.0, w: 9.0, d: 5.6 }; ctx.height = 9.2; ctx.pathCol = 0xc3cfdc;
  const Lg = { x0: -4.3, x1: 0.2, z0: -5.4, z1: -1.2, h: 3.0 };       // log lodge
  const An = { x0: 0.2, x1: 4.3, z0: -5.0, z1: -0.4 };                 // glass A-frame annex
  rawStructure(ctx, [{ x0: Lg.x0, x1: Lg.x1, z0: Lg.z0, z1: Lg.z1, h: 3.0, floors: 1, wall: 0.55 }, { x0: An.x0, x1: An.x1, z0: An.z0, z1: An.z1, h: 2.6, floors: 1, wall: 0.1 }], { timber: true });
  ctx.solar = [{ x: -3.35, y: 5.0, z: -3.3, w: 3.0, d: 1.5, tilt: 0.82, ry: -PI / 2 }];
  ctx.P.struct.gable(-2.05, 3.1, -3.3, 4.5, 2.3, 4.2, 0xc4955a, { kind: 'plankV' });

  const lcx = (Lg.x0 + Lg.x1) / 2, lcz = (Lg.z0 + Lg.z1) / 2, lw = Lg.x1 - Lg.x0, ld = Lg.z1 - Lg.z0;
  // lodge: stone base + log walls + gable
  S.box(lcx, 0, lcz, lw + 0.2, 0.55, ld + 0.2, STONE, { kind: 'stone' });
  S.box(lcx, 0.5, lcz, lw, Lg.h - 0.5, ld, LOG, { kind: 'log', jit: 0.02, dark: 0.1 });
  for (const [x, z] of [[Lg.x0, Lg.z1], [Lg.x1, Lg.z1], [Lg.x0, Lg.z0], [Lg.x1, Lg.z0]]) S.cyl(x, 0.3, z, 0.17, Lg.h - 0.1, DLOG, { seg: 8, kind: 'bark' });
  const rise = 2.4, halfW = lw / 2 + 0.0;
  S.gable(lcx, Lg.h, lcz, lw, rise, ld, 0xc4955a, { kind: 'plankV', texScale: 1.2 });
  const th = Math.atan2(rise, halfW), ov = 0.9, run = halfW + ov, len = run / Math.cos(th), ovz = 0.8;
  const slopeY = (d) => Lg.h + rise - (rise * d) / halfW;
  for (const s of [-1, 1]) {
    const cxm = lcx + s * run / 2, cym = slopeY(run / 2);
    const n = [s * Math.sin(th), Math.cos(th)];
    S.boxc(cxm + n[0] * 0.12, cym + n[1] * 0.12, lcz, len, 0.18, ld + ovz * 2, shade(DLOG, 1.1), { rz: -s * th, kind: 'plank' });
    S.boxc(cxm + n[0] * 0.38, cym + n[1] * 0.38, lcz, len + 0.05, 0.34, ld + ovz * 2 + 0.1, SNOW, { rz: -s * th });
  }
  S.cylc(lcx, Lg.h + rise + 0.18, lcz, 0.26, ld + ovz * 2 + 0.1, SNOW, { rx: PI / 2, seg: 10 });
  // red barge boards on both gables
  for (const s of [-1, 1]) for (const z of [Lg.z1 + ovz, Lg.z0 - ovz]) {
    const cxm = lcx + s * run / 2, cym = slopeY(run / 2);
    S.boxc(cxm + s * Math.sin(th) * 0.0, cym + Math.cos(th) * 0.03, z, len + 0.2, 0.26, 0.1, TRIM, { rz: -s * th });
  }
  for (const s of [-1, 1]) icicles(S, lcx + s * (run - 0.08), Lg.z0 - ovz + 0.1, lcx + s * (run - 0.08), Lg.z1 + ovz - 0.1, slopeY(run) - 0.12, 22);
  // stone chimney
  S.box(Lg.x0 - 0.3, 0, -3.6, 0.9, 6.9, 0.9, STONE, { kind: 'stone', dark: 0.08 }); S.box(Lg.x0 - 0.3, 6.9, -3.6, 1.15, 0.2, 1.15, 0x6b7480); S.box(Lg.x0 - 0.3, 7.1, -3.6, 1.0, 0.3, 1.0, SNOW);
  // veranda deck + posts + roof
  S.box(0.0, 0.0, 0.2, 8.8, 0.3, 2.8, 0xb08455, { kind: 'plank', texScale: 0.8 });
  S.box(0.0, 0.0, 0.2, 8.9, 0.18, 2.9, DLOG, { kind: 'plank' });
  for (let i = 0; i < 3; i++) S.box(0.2, 0 - i * 0.18, 2.05 + i * 0.34, 2.2, 0.18, 0.4, 0xb08455, { kind: 'plank', texScale: 0.6 });
  for (const x of [-4.1, -2.05, 0.0]) { S.cyl(x, 0.3, 1.2, 0.13, 2.4, LOG, { seg: 8, kind: 'bark' }); }
  S.box(-2.05, 2.65, 1.2, 4.7, 0.18, 0.2, DLOG, { kind: 'plank' });
  S.boxc(-2.05, 2.95, -0.1, 4.7, 0.16, 2.6, 0x9a6a3e, { rx: 0.2, kind: 'plank' }); S.boxc(-2.05, 3.17, -0.1, 4.8, 0.26, 2.7, SNOW, { rx: 0.2 });
  balustrade(S, -4.15, 1.45, -2.9, 1.45, 0.3, 0.8, TRIM); balustrade(S, -1.2, 1.45, 0.1, 1.45, 0.3, 0.8, TRIM); balustrade(S, 0.9, 1.5, 4.3, 1.5, 0.3, 0.8, TRIM); balustrade(S, -4.15, 1.45, -4.15, -0.9, 0.3, 0.8, TRIM);
  balustrade(S, 4.3, 1.5, 4.3, -0.3, 0.3, 0.8, TRIM);
  // hot tub
  S.cyl(-3.3, 0.3, 0.2, 1.0, 0.62, 0xa8794a, { seg: 20, kind: 'plankV', texScale: 0.6 }); S.tor(-3.3, 0.92, 0.2, 1.0, 0.07, 0xd9b78a, { flat: true, seg: 24 });
  S.disc(-3.3, 0.84, 0.2, 0.93, 0x5fd6f0, { kind: 'water' }); S.cyl(-3.3, 0.3, 0.2, 1.05, 0.08, 0x3a3a40, { seg: 20 });
  S.box(-2.15, 0.3, 0.5, 0.5, 0.2, 0.4, 0xd9b78a, { kind: 'plank' }); S.box(-2.15, 0.5, 0.5, 0.5, 0.05, 0.4, 0xffffff);
  // firewood, sled, skis, snow piles
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5 - r; c++) S.cylc(-4.7 + r * 0.0, 0.43 + r * 0.26, -2.0 + c * 0.3 + r * 0.15, 0.13, 0.5, c % 2 ? 0xb58656 : 0x9a6a3e, { rz: PI / 2, seg: 8, kind: 'bark' });
  S.box(-4.62, 1.15, -1.5, 0.7, 0.06, 1.5, 0x9a6a3e, { kind: 'plank' }); S.box(-4.62, 1.18, -1.5, 0.74, 0.04, 1.54, SNOW);
  S.boxc(-3.7, 1.5, 1.35, 0.1, 1.7, 0.04, TRIM, { rz: 0.15, rx: 0.1 }); S.boxc(-3.5, 1.5, 1.35, 0.1, 1.7, 0.04, 0x39a0ff, { rz: 0.17, rx: 0.1 });
  // A-frame annex
  const ax = (An.x0 + An.x1) / 2, aw = An.x1 - An.x0, ad = An.z1 - An.z0, acz = (An.z0 + An.z1) / 2, arise = 5.5, ahw = aw / 2, ath = Math.atan2(arise, ahw);
  for (const s of [-1, 1]) {
    const slen = Math.hypot(ahw, arise) + 0.5, d = ahw * 0.5 + 0.05, cxm = ax + s * d, cym = arise * (1 - d / ahw);
    const n = [s * Math.sin(ath), Math.cos(ath)];
    S.boxc(cxm + n[0] * 0.12, cym + n[1] * 0.12, acz, slen, 0.22, ad + 0.7, 0x7a4a2c, { rz: -s * ath, kind: 'plank' });
    S.boxc(cxm + n[0] * 0.4, cym + n[1] * 0.4, acz, slen, 0.3, ad + 0.8, SNOW, { rz: -s * ath });
    S.box(ax + s * (ahw + 0.12), 0, acz, 0.14, 0.9, ad + 0.7, 0x6b7480, { kind: 'stone' });
  }
  S.cylc(ax, arise + 0.22, acz, 0.2, ad + 0.8, SNOW, { rx: PI / 2, seg: 10 });
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    const d = ahw * (0.12 + k * 0.24), z = An.z0 + 0.25 + k * (ad - 0.3) / 3, cyb = arise * (1 - d / ahw);
    S.boxc(ax + s * d + s * Math.sin(ath) * 0.62, cyb + Math.cos(ath) * 0.62, z, 0.14, 0.1, 0.1, TRIM, { rz: -s * ath });
  }
  S.boxc(ax + 1.5, 3.3, acz - 0.4, 0.04, 0.9, 1.2, 0xbfe4ff, { kind: 'glass', rz: -ath + 0.0 });
  // timber frame on the glazed front + back wall
  const fz = An.z1;
  const ftri = (zz) => {
    S.box(ax, 0.05, zz, aw + 0.4, 0.28, 0.2, DLOG, { kind: 'plank' });
    for (const s of [-1, 1]) S.boxc(ax + s * ahw / 2, arise / 2, zz, Math.hypot(ahw, arise) + 0.1, 0.22, 0.2, TRIM, { rz: -s * ath });
    for (const y of [1.4, 2.8, 4.2]) { const w = aw * (1 - y / arise); S.box(ax, y, zz, w, 0.1, 0.16, DLOG, { kind: 'plank' }); }
    for (const k of [-0.5, 0.5]) S.box(ax + k * aw * 0.4, 0.2, zz, 0.1, 3.8 - Math.abs(k) * 2.4, 0.16, DLOG, { kind: 'plank' });
    S.box(ax, 0.2, zz, 0.12, arise - 0.5, 0.16, DLOG, { kind: 'plank' });
  };
  ftri(fz);
  S.gable(ax, 0.0, An.z0, aw - 0.1, arise - 0.1, 0.12, 0xc4955a, { kind: 'plankV' });
  // windows / doors on the lodge
  wf(ctx, 0, 0, Lg.z1, 0, () => {
    door(ctx, -2.05, 1.05, 2.1, { leaf: 0x7a4a2c, trim: TRIM }); S.tor(-2.05, 1.55, 0.2, 0.28, 0.06, 0x2e7d32, { seg: 14 }); S.sph(-2.05, 1.3, 0.2, 0.09, TRIM, { q: 0 }); S.sph(-2.05, 1.2, 0.2, 0.06, 0xffffff, { q: 0 });
    win(ctx, -3.5, 1.0, 0.9, 1.2, { trim: TRIM, shutter: TRIM }); win(ctx, -0.6, 1.0, 0.9, 1.2, { trim: TRIM, shutter: TRIM });
  });
  wf(ctx, lcx, Lg.h + 0.6, Lg.z1 + 0.02, 0, () => { win(ctx, 0, 0.3, 0.9, 1.0, { arch: true, trim: TRIM, sill: false }); });
  wf(ctx, Lg.x0, 0, -2.2, -PI / 2, () => { win(ctx, 0, 1.0, 0.9, 1.1, { trim: TRIM, shutter: TRIM }); win(ctx, -2.2, 1.0, 0.9, 1.1, { trim: TRIM }); });
  wf(ctx, 0, 0, Lg.z0, PI, () => { win(ctx, 1.2, 1.0, 1.0, 1.1, { trim: TRIM }); win(ctx, -1.2, 1.0, 1.0, 1.1, { trim: TRIM }); win(ctx, -3.0, 1.0, 1.0, 1.1, { trim: TRIM }); });
  wf(ctx, An.x1, 0, acz, PI / 2, () => { win(ctx, 0, 1.3, 0.8, 1.0, { trim: TRIM }); });
  // glass of the A-frame (stage 3) + real interior
  const gz = fz + 0.02;
  F3.put(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-ahw, 0), new THREE.Vector2(ahw, 0), new THREE.Vector2(0, arise)])).toNonIndexed(), 'glass', 0xbfe4ff, ax, 0.12, gz, null, 1, 1, 1, {});
  F3.put(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-ahw + 0.1, 0.1), new THREE.Vector2(ahw - 0.1, 0.1), new THREE.Vector2(0, arise - 0.4)])).toNonIndexed(), 'glow', 0xffe0a8, ax, 0.12, An.z0 + 0.3, null, 1, 1, 1, { grad: [0, 0xff9a4a], gy: [arise, 0] });
  F3.box(ax, 0.3, acz, aw - 0.8, 0.06, ad - 0.2, 0xb08455, { kind: 'plank' });
  F3.box(ax, 2.4, An.z0 + 1.0, aw * 0.5, 0.14, 2.0, 0xb08455, { kind: 'plank' }); balustrade(F3, ax - aw * 0.25, An.z1 - 2.1 + 1.0 + 0.0 + 0.1, ax + aw * 0.25, An.z1 - 2.1 + 1.1, 2.54, 0.7, DLOG);
  F3.rbox(ax + 0.2, 0.35, acz + 0.3, 1.9, 0.5, 0.8, 0.12, 0xd84a4a); F3.rbox(ax + 0.2, 0.7, acz - 0.02, 1.9, 0.6, 0.2, 0.1, 0xb63a3a); F3.rbox(ax - 1.4, 0.35, acz + 0.6, 0.7, 0.45, 0.7, 0.1, 0x3b7dd8);
  F3.box(ax + 0.2, 0.35, acz + 1.1, 1.1, 0.04, 0.5, 0xf4efe6, {}); F3.cyl(ax + 0.2, 0.3, acz + 1.1, 0.4, 0.08, 0x8a5a3b, { seg: 12 });
  F3.cyl(ax + 1.5, 0.3, An.z0 + 0.8, 0.35, 1.5, 0x30343b, { seg: 10 }); F3.box(ax + 1.5, 0.9, An.z0 + 1.15, 0.4, 0.3, 0.03, 0xff7a2a, { kind: 'glow' }); F3.halo(ax + 1.5, 1.0, An.z0 + 1.3, 1.6, 0xff8a3a, 0.7, 0.9);
  F3.sph(ax, 4.0, acz + 0.3, 0.18, 0xfff0c0, { kind: 'glow', q: 0 }); F3.seg(ax, 4.0, acz + 0.3, ax, 5.0, acz + 0.3, 0.01, 0x30343b); F3.halo(ax, 4.0, acz + 0.3, 2.0, 0xffd090, 0.6, 0.2);
  F3.sph(ax - 1.0, 2.9, An.z0 + 0.9, 0.3, 0x3dd16a, { kind: 'leaf', q: 0 }); F3.halo(ax, 1.8, acz, 4.2, 0xffb060, 0.22, 0.1);

  // --- stage 4: snow garden ---
  const gp = [[0.2, 2.2], [0.1, 4.6], [0.5, 7.4], [0.0, 10.6]];
  G4.ribbon(gp, 1.6, 0.04, 0xb8c6d6, { kind: 'paver' }); for (const s of [-1, 1]) G4.ribbon(gp.map(([x, z]) => [x + s * 0.95, z]), 0.3, 0.06, SNOW, {});
  const dp = [[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]];
  G4.ribbon(dp, 3.1, 0.03, 0xc4cfdb, { kind: 'paver', texScale: 1.3 });
  for (const s of [-1, 1]) G4.ribbon(dp.map(([x, z]) => [x + s * 1.7, z]), 0.5, 0.05, SNOW, {});
  for (const [x, z, s] of [[-5.5, -7.5, 1.4], [-2.2, -8.6, 1.2], [3.0, -8.9, 1.5], [6.6, -8.0, 1.3], [-9.2, 4.6, 1.2], [9.1, 5.8, 1.3], [-9.3, -0.5, 1.0], [9.6, 1.2, 1.1], [5.4, 9.0, 1.2], [-7.0, 8.0, 0.9], [8.8, -6.2, 1.1]]) pine(G4, x, z, s, true);
  for (const [x, z, s] of [[-5.2, 3.4, 1.0], [4.6, 7.0, 0.7]]) snowman(G4, x, z, s);
  for (const [x, z, s] of [[-4.6, 1.6, 0.8], [4.4, 2.2, 0.9], [-1.2, -6.1, 1.1], [2.6, -6.0, 1.0]]) { G4.sph(x, 0.25 * s, z, 1.2 * s, SNOW, { sy: 0.45, sx: 1.3, q: 1 }); }
  for (const [x, z, s] of [[-9.0, 2.3, 0.8], [9.6, -2.6, 0.7], [-3.1, 9.2, 0.7]]) { rock(G4, x, z, s, 0x7f8a96); G4.sph(x, s * 0.58, z, s * 0.85, SNOW, { sy: 0.35, q: 1 }); }
  for (const [x, z, h] of [[-1.5, 3.4, 1.1], [1.9, 3.6, 1.1], [-1.1, 8.6, 1.1], [1.5, 8.4, 1.1]]) { G4.cyl(x, 0, z, 0.05, h, 0x30343b, { seg: 6, kind: 'metal' }); G4.box(x, h, z, 0.22, 0.28, 0.22, 0x30343b); G4.box(x, h + 0.02, z, 0.16, 0.22, 0.16, 0xcfeaff, {}); }
  G4.cyl(4.5, 0, 6.0, 0.18, 0.35, 0x6b4a2e, { seg: 8, kind: 'bark' }); G4.sph(4.5, 0.38, 6.0, 0.28, SNOW, { sy: 0.5, q: 0 });

  // gentle snowfall over the whole island
  const snow = ctx.bb('ground', 90, false), sd = [];
  for (let i = 0; i < 90; i++) sd.push([R() * TAU, Math.sqrt(R()) * 13, R() * 14, 0.5 + R() * 0.6, R() * 6.28, 0.07 + R() * 0.07]);
  ctx.on('ground', (t) => { for (let i = 0; i < 90; i++) { const d = sd[i], y = 14 - ((d[2] + t * d[3]) % 14), a = d[0] + Math.sin(t * 0.3 + d[4]) * 0.15; snow.set(i, Math.cos(a) * d[1] + Math.sin(t * 0.7 + d[4]) * 0.35, y, Math.sin(a) * d[1] + Math.cos(t * 0.5 + d[4]) * 0.35, d[5], 1, 1, 1, 0.85 * Math.min(1, y / 1.0)); } snow.commit(); });
  // --- stage 5: christmas lights, glowing windows, smoke, aurora, snow ---
  const cc = [0xff3d3d, 0x39d353, 0xffd23f, 0x39a0ff];
  const eave = (x0, z0, x1, z1, y, n) => { for (let i = 0; i <= n; i++) { const t = i / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), yy = y - Math.sin(t * PI * 2) * 0.0 - (i % 2) * 0.08; F5.sph(x, yy, z, 0.07, cc[i % 4], { kind: 'glow', q: 0 }); if (i % 2 === 0) F5.halo(x, yy, z, 0.55, cc[i % 4], 0.6, 0.4); } F5.seg(x0, y + 0.02, z0, x1, y + 0.02, z1, 0.01, 0x222222); };
  eave(-4.2, 1.6, 4.3, 1.6, 2.1, 22);
  const tx = -5.4, tz = 2.4;
  pine(F5, tx, tz, 1.25, true, 0x2e6b46);
  for (let i = 0; i < 26; i++) { const t = i / 25, a = t * 15, y = 0.8 + t * 3.0, r = (1 - t) * 1.1 * 1.25 + 0.1; F5.sph(tx + Math.cos(a) * r, y, tz + Math.sin(a) * r, 0.07, cc[i % 4], { kind: 'glow', q: 0 }); if (i % 3 === 0) F5.halo(tx + Math.cos(a) * r, y, tz + Math.sin(a) * r, 0.6, cc[i % 4], 0.6, 0.5); }
  F5.sph(tx, 4.2, tz, 0.2, 0xffe070, { kind: 'glow', q: 0 }); F5.halo(tx, 4.2, tz, 1.5, 0xffe070, 0.8, 0.3);
  makeFlag(ctx, 'f5', 0.6, 9.6, -1.0, 1.1, 0.7, TRIM, 0xffffff, 0);
  F5.cyl(0.6, 8.2, -1.0, 0.03, 1.6, 0xdddddd, { seg: 5 });
  const sm = ctx.bb('f5', 16, false);
  ctx.on('f5', (t) => { for (let i = 0; i < 16; i++) { const ph = (t * 0.15 + i / 16) % 1, w = Math.sin(ph * 4 + i) * 0.1 + ph * 0.9; sm.set(i, Lg.x0 - 0.3 + w, 7.3 + ph * 3.6, -3.6 + Math.cos(ph * 4 + i) * 0.12, 0.2 + ph * 0.6, 0.95, 0.96, 1.0, (1 - ph) * (1 - ph) * 0.6 * Math.min(1, ph * 8)); } sm.commit(); });
  const hs = ctx.bb('f5', 8, false);
  ctx.on('f5', (t) => { for (let i = 0; i < 8; i++) { const ph = (t * 0.3 + i / 8) % 1; hs.set(i, -3.3 + Math.sin(i * 2.4 + t) * 0.45, 1.0 + ph * 1.1, 0.2 + Math.cos(i * 1.9 + t) * 0.45, 0.25 + ph * 0.45, 1, 1, 1, (1 - ph) * 0.35 * Math.min(1, ph * 6)); } hs.commit(); });
  // soft aurora glow high above the plot
  F5.halo(0, 12.5, -9, 9, 0x58ffb0, 0.16, 0.12); F5.halo(-4, 13.5, -11, 7, 0x7ad8ff, 0.13, 0.1); F5.halo(5, 12, -10, 6, 0xb388ff, 0.11, 0.1);
}

// ---------- palace (dunes): sandstone desert palace with domes, minarets, arches, courtyard and oasis ----------
function crenel(b, x0, z0, x1, z1, y, col, step) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / (step || 0.55))), ry = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; b.box(lerp(x0, x1, t), y, lerp(z0, z1, t), L / n * 0.55, 0.42, 0.2, col, { ry, kind: 'stone' }); }
  b.seg(x0, y, z0, x1, y, z1, 0.08, col, { seg: 5 });
}
function onionDome(b, x, y, z, r, h, col, o) {
  const P = [[0.001, 0], [r * 0.98, 0.05 * h], [r * 1.12, 0.22 * h], [r * 1.02, 0.4 * h], [r * 0.72, 0.58 * h], [r * 0.42, 0.74 * h], [r * 0.2, 0.88 * h], [r * 0.06, 0.97 * h], [0.001, h]];
  b.lathe('onion' + r + '_' + h, P, x, y, z, col, Object.assign({ kind: 'gold', seg: 20 }, o || {}));
}
function minaret(b, x, z, h, ctx, ring, gold) {
  const bw = 0.5;
  b.cyl(x, 0, z, bw + 0.15, 0.5, 0xe6d3a8, { seg: 12, kind: 'stone' });
  b.cyl(x, 0.5, z, bw, h * 0.74, 0xf1dcae, { r2: bw * 0.84, seg: 14, kind: 'stone', dark: 0.1 });
  for (const f of [0.3, 0.55]) b.cyl(x, h * f, z, bw * (1 - f * 0.18) + 0.05, 0.28, ring, { seg: 14 });
  const by = h * 0.74 + 0.5;
  b.cyl(x, by, z, 0.85, 0.16, 0xe6d3a8, { seg: 14, kind: 'stone' });
  b.tor(x, by + 0.58, z, 0.8, 0.05, gold, { flat: true, seg: 18, kind: 'gold' });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; b.cyl(x + Math.cos(a) * 0.8, by + 0.16, z + Math.sin(a) * 0.8, 0.035, 0.45, gold, { seg: 4, kind: 'gold' }); }
  b.cyl(x, by + 0.16, z, bw * 0.7, 1.3, 0xf1dcae, { seg: 12, kind: 'stone', r2: bw * 0.65 });
  b.cyl(x, by + 1.46, z, bw * 0.9, 0.12, ring, { seg: 12 });
  b.cone(x, by + 1.58, z, bw * 0.78, 1.3, gold, { kind: 'gold', seg: 12 });
  b.sph(x, by + 2.95, z, 0.1, gold, { kind: 'gold', q: 0 }); b.cyl(x, by + 2.95, z, 0.02, 0.55, gold, { kind: 'gold', seg: 4 });
  b.tor(x, by + 3.1, z, 0.12, 0.025, gold, { kind: 'gold', seg: 10, arc: 0 });
  for (const a of [0, PI / 2, PI, PI * 1.5]) b.box(x + Math.cos(a) * (bw * 0.68), by + 0.4, z + Math.sin(a) * (bw * 0.68), 0.12, 0.62, 0.12, 0x2a2430, { ry: -a });
  b.blob(x, z, 1.2, 1.2, 0.55);
}

function buildPalace(ctx) {
  const H = ctx.h, WALL = H.wall, GOLD = H.roof, TRIM = H.trim;
  const S = ctx.P.shell, F3 = ctx.P.fin3, G4 = ctx.P.g4, F5 = ctx.P.f5;
  const SAND = shade(WALL, 1.0), STONE = 0xe6d3a8, TURQ = TRIM, RED = 0xb8352f;
  ctx.foot = { cx: 0, cz: -2.9, w: 9.0, d: 5.6 }; ctx.height = 12.6; ctx.pathCol = 0xe6cf9f;
  const Hl = { x0: -2.2, x1: 2.2, z0: -5.4, z1: -0.3, h: 4.4 }, Wl = { x0: -4.3, x1: -2.2, z0: -5.0, z1: -0.9, h: 3.3 }, Wr = { x0: 2.2, x1: 4.3, z0: -5.0, z1: -0.9, h: 3.3 };
  rawStructure(ctx, [{ x0: -2.2, x1: 2.2, z0: -5.4, z1: -0.3, h: 4.4, floors: 2, wall: 0.55 }, { x0: -4.3, x1: -2.2, z0: -5.0, z1: -0.9, h: 3.3, floors: 1, wall: 0.55 }, { x0: 2.2, x1: 4.3, z0: -5.0, z1: -0.9, h: 3.3, floors: 1, wall: 0.55 }]);
  ctx.solar = [{ x: -3.25, y: 3.5, z: -4.2, w: 1.6, d: 1.0, tilt: 0.3 }, { x: 3.25, y: 3.5, z: -4.2, w: 1.6, d: 1.0, tilt: 0.3 }];

  const blk = (m, col, o) => S.box((m.x0 + m.x1) / 2, 0, (m.z0 + m.z1) / 2, m.x1 - m.x0, m.h, m.z1 - m.z0, col, Object.assign({ kind: 'stone', jit: 0.02, dark: 0.1 }, o || {}));
  blk(Hl, WALL); blk(Wl, shade(WALL, 0.97)); blk(Wr, shade(WALL, 0.97));
  for (const m of [Hl, Wl, Wr]) { S.box((m.x0 + m.x1) / 2, 0, (m.z0 + m.z1) / 2, m.x1 - m.x0 + 0.2, 0.5, m.z1 - m.z0 + 0.2, STONE, { kind: 'stone' }); S.box((m.x0 + m.x1) / 2, m.h - 0.1, (m.z0 + m.z1) / 2, m.x1 - m.x0 + 0.34, 0.2, m.z1 - m.z0 + 0.34, STONE, { kind: 'stone' }); }
  // turquoise tile bands + diamonds on the hall
  for (const y of [3.6]) S.box(0, y, Hl.z1 + 0.01, 4.5, 0.3, 0.06, TURQ, { kind: 'paint' });
  for (let i = 0; i < 9; i++) S.box(-2.0 + i * 0.5, 3.6, Hl.z1 + 0.05, 0.2, 0.2, 0.04, i % 2 ? GOLD : 0xffffff, { rz: PI / 4 });
  // parapets + merlons
  for (const [m, y] of [[Hl, 4.4], [Wl, 3.3], [Wr, 3.3]]) {
    const o = 0.17;
    crenel(S, m.x0 - o, m.z1 + o, m.x1 + o, m.z1 + o, y + 0.1, STONE); crenel(S, m.x0 - o, m.z0 - o, m.x1 + o, m.z0 - o, y + 0.1, STONE);
    crenel(S, m.x0 - o, m.z0 - o, m.x0 - o, m.z1 + o, y + 0.1, STONE); crenel(S, m.x1 + o, m.z0 - o, m.x1 + o, m.z1 + o, y + 0.1, STONE);
  }
  S.box(0, 4.45, -2.85, 4.2, 0.1, 5.0, 0xc9b58a, { kind: 'stone' });
  // main dome on a drum
  S.cyl(0, 4.45, -2.85, 1.75, 1.3, 0xf1dcae, { seg: 20, kind: 'stone' }); S.cyl(0, 5.7, -2.85, 1.9, 0.18, STONE, { seg: 20 }); S.tor(0, 5.9, -2.85, 1.78, 0.07, TURQ, { flat: true, seg: 28 });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + PI / 8; const wx = Math.sin(a) * 1.75, wz = Math.cos(a) * 1.75; S.arch(wx, 4.85, -2.85 + wz, 0.5, 0.8, 0.05, 0x2a2430, { ry: a, pointed: true }); S.put(GEO.pFrame(0.5, 0.8, 0.07), 'solid', TURQ, wx, 4.85, -2.85 + wz, [0, a, 0], 1, 1, 0.08); }
  onionDome(S, 0, 5.85, -2.85, 1.7, 2.8, GOLD);
  S.cyl(0, 8.6, -2.85, 0.05, 0.9, GOLD, { kind: 'gold', seg: 5 }); S.sph(0, 8.62, -2.85, 0.14, GOLD, { kind: 'gold', q: 0 }); S.tor(0, 9.35, -2.85, 0.26, 0.04, GOLD, { kind: 'gold', seg: 14 }); S.sph(0.12, 9.35, -2.85, 0.09, GOLD, { kind: 'gold', q: 0 });
  // wing domes
  for (const sx of [-1, 1]) {
    S.cyl(sx * 3.25, 3.4, -2.95, 0.95, 0.5, 0xf1dcae, { seg: 14, kind: 'stone' }); S.tor(sx * 3.25, 3.95, -2.95, 0.95, 0.05, TURQ, { flat: true, seg: 20 });
    S.dome(sx * 3.25, 3.95, -2.95, 0.98, TURQ, { kind: 'paint', sy: 1.05 }); S.cone(sx * 3.25, 4.95, -2.95, 0.05, 0.6, GOLD, { kind: 'gold', seg: 5 }); S.sph(sx * 3.25, 5.5, -2.95, 0.08, GOLD, { kind: 'gold', q: 0 });
  }
  // portal (iwan): a thick wall with a pointed-arch recess, the door sits on the hall wall behind it
  S.put(GEO.pWall(3.5, 5.0, 1.9, 3.5), 'stone', 0xf3e0b6, 0, 0, 0.25, null, 1, 1, 0.9, { dark: 0.08 }); S.box(0, 5.0, 0.25, 3.7, 0.22, 1.05, STONE, { kind: 'stone' });
  crenel(S, -1.85, 0.7, 1.85, 0.7, 5.15, STONE);
  S.put(GEO.pFrame(1.9, 3.5, 0.28), 'solid', TURQ, 0, 0, 0.72, null, 1, 1, 0.1); S.put(GEO.pFrame(2.52, 3.86, 0.1), 'solid', GOLD, 0, 0, 0.7, null, 1, 1, 0.1);
  for (const y of [3.95, 4.5]) S.box(0, y, 0.72, 3.5, 0.3, 0.06, TURQ, { kind: 'paint' });
  for (let i = 0; i < 7; i++) S.box(-1.5 + i * 0.5, 4.25, 0.76, 0.2, 0.2, 0.04, i % 2 ? GOLD : 0xffffff, { rz: PI / 4 });
  S.box(0, 0, 1.25, 2.9, 0.2, 1.0, STONE, { kind: 'stone' }); S.box(0, 0, 1.9, 3.3, 0.12, 0.6, shade(STONE, 0.96), { kind: 'stone' });
  for (const s of [-1, 1]) { S.cyl(s * 1.85, 0, 1.35, 0.22, 3.6, 0xf3e0b6, { seg: 12, kind: 'stone' }); S.cyl(s * 1.85, 3.6, 1.35, 0.3, 0.15, STONE, { seg: 12 }); S.sph(s * 1.85, 3.9, 1.35, 0.2, GOLD, { kind: 'gold', q: 0 }); }
  // minarets
  for (const sx of [-1, 1]) { minaret(S, sx * 4.0, -0.7, 9.2, ctx, TURQ, GOLD); minaret(S, sx * 4.0, -5.0, 7.2, ctx, TURQ, GOLD); }
  // windows (pointed arches with turquoise frames)
  const PW = { arch: true, pointed: true, trim: TURQ, sill: false, cross: true, t: 0.1, glass: 0xaeeeff, warm: [0xffe9b0, 0xff9d4d] };
  wf(ctx, 0, 0, Hl.z1, 0, () => {
    door(ctx, 0, 1.6, 3.2, { arch: true, pointed: true, leaf: 0x7a4a2c, trim: GOLD });
  });
  wf(ctx, -3.25, 0, Wl.z1, 0, () => { win(ctx, 0, 0.5, 0.9, 1.8, Object.assign({}, PW, { sill: true })); win(ctx, 0, 2.4, 0.5, 0.7, PW); });
  wf(ctx, 3.25, 0, Wr.z1, 0, () => { win(ctx, 0, 0.5, 0.9, 1.8, Object.assign({}, PW, { sill: true })); win(ctx, 0, 2.4, 0.5, 0.7, PW); });
  for (const sx of [-1, 1]) wf(ctx, sx * 4.3, 0, -2.95, sx * PI / 2, () => { win(ctx, 0, 0.7, 0.9, 1.6, PW); win(ctx, 1.1, 0.7, 0.9, 1.6, PW); win(ctx, -1.1, 0.7, 0.9, 1.6, PW); });
  wf(ctx, 0, 0, Hl.z0, PI, () => { for (const x of [-1.2, 0, 1.2]) { win(ctx, x, 0.8, 0.8, 1.6, PW); win(ctx, x, 2.8, 0.7, 1.1, PW); } });
  wf(ctx, 0, 0, Wl.z0, PI, () => { for (const x of [-3.2, 3.2]) win(ctx, x, 0.8, 0.8, 1.6, PW); });
  // courtyard: reflecting pool, flagstones, planters
  S.box(0, 0, 3.4, 3.2, 0.1, 5.3, 0xd9c28f, { kind: 'stone' });
  S.box(0, 0.1, 3.4, 1.9, 0.08, 4.4, 0xf0dcaa, { kind: 'stone' });
  S.box(0, 0.1, 3.4, 1.4, 0.1, 3.9, 0x30c8c0, { kind: 'water' });
  for (let i = 0; i < 4; i++) { S.cyl(0, 0.1, 1.6 + i * 1.15, 0.055, 0.18, 0xe6d3a8, { seg: 6 }); S.sph(0, 0.3, 1.6 + i * 1.15, 0.06, GOLD, { kind: 'gold', q: 0 }); }

  // --- stage 3: lanterns ---
  const fanous = (b, x, y, z, col, s) => { s = s || 1; b.cyl(x, y, z, 0.06 * s, 0.32 * s, 0xffe0a0, { seg: 6, kind: 'glow', r2: 0.1 * s }); b.cone(x, y + 0.32 * s, z, 0.1 * s, 0.14 * s, GOLD, { kind: 'gold', seg: 6 }); b.cone(x, y - 0.1 * s, z, 0.06 * s, 0.1 * s, GOLD, { kind: 'gold', seg: 6, rx: PI }); b.halo(x, y + 0.15 * s, z, 1.0 * s, col || 0xffc060, 0.6, 0.4); };
  for (const sx of [-1, 1]) fanous(F3, sx * 1.35, 2.6, 0.78, 0xffc060, 1.3);
  F3.halo(0, 1.6, 0.4, 2.8, 0xffb050, 0.35, 0.2);

  // --- stage 4: palms, oasis, planters ---
  G4.floor(0, 0.025, 7.0, 3.4, 5.0, 0xe0c99a, { kind: 'paver' });
  const gp = [[0, 6.0], [0.1, 8.2], [0, 10.7]];
  G4.ribbon(gp, 1.8, 0.04, 0xe6cf9f, { kind: 'paver' });
  const dp = [[-5.3, 10.3], [-6.5, 7.4], [-7.5, 4.4], [-7.7, 1.8], [-7.7, -0.6]];
  G4.ribbon(dp, 3.1, 0.03, 0xcdb27e, { kind: 'paver', texScale: 1.2 }); for (const s of [-1, 1]) G4.ribbon(dp.map(([x, z]) => [x + s * 1.6, z]), 0.16, 0.05, STONE, {});
  for (const [x, z, s, a] of [[-5.3, 2.8, 1.1, 0.2], [5.7, 8.2, 1.2, 2.0], [-9.0, 5.8, 1.2, 0.7], [9.2, 2.2, 1.1, 3.0], [-6.4, 9.0, 1.0, 5.0], [8.4, 5.6, 1.1, 1.1], [-8.0, -2.4, 1.1, 2.2]]) palm(G4, x, z, s, a, { leaf: 0x3f9a46 });
  for (const sx of [-1, 1]) { G4.box(sx * 1.35, 0, 2.2, 0.8, 0.45, 0.8, 0xd9c28f, { kind: 'stone' }); G4.sph(sx * 1.35, 0.8, 2.2, 0.32, 0x3f9a3a, { kind: 'leaf', q: 0 }); }
  for (const [x, z] of [[-3.4, 4.0], [3.5, 4.2]]) { G4.cyl(x, 0, z, 0.32, 0.5, 0xc9683a, { seg: 10, r2: 0.4 }); G4.sph(x, 0.9, z, 0.45, 0x3f9a3a, { kind: 'leaf', q: 1 }); for (let i = 0; i < 5; i++) G4.sph(x + (R() - 0.5) * 0.7, 0.85 + R() * 0.45, z + (R() - 0.5) * 0.7, 0.1, [0xe9407a, 0xffd23f][i % 2], { kind: 'leaf', q: 0 }); }
  flowerBed(G4, -2.9, 1.9, 1.5, 0.7, [0xe9407a, 0xffd23f, 0xffffff], 12, { soil: 0x9a6a3e }); flowerBed(G4, 2.9, 1.9, 1.5, 0.7, [0xe9407a, 0xffd23f, 0xffffff], 12, { soil: 0x9a6a3e });
  // oasis pond (back left)
  const ox = -3.8, oz = -8.1;
  G4.disc(ox, 0.04, oz, 2.1, 0xcdb27e, { kind: 'sand', sz: 0.85 }); G4.disc(ox, 0.07, oz, 1.8, 0x35c8c0, { kind: 'water', sz: 0.8 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; rock(G4, ox + Math.cos(a) * 2.0, oz + Math.sin(a) * 1.7, 0.2 + (i % 3) * 0.06, 0xc9b58a); }
  palm(G4, ox - 1.7, oz - 0.4, 1.3, 0.3); palm(G4, ox + 1.5, oz - 0.9, 1.2, 2.4); palm(G4, ox + 0.2, oz + 1.9, 1.0, 4.4);
  for (let i = 0; i < 9; i++) { const a = i * 0.8; G4.sph(ox + Math.cos(a) * 1.7, 0.4, oz + Math.sin(a) * 1.4, 0.25, 0x4f9a3a, { kind: 'leaf2', sy: 1.4, sx: 0.4, sz: 0.4, q: 0 }); }
  rock(G4, 9.2, -3.8, 0.9, 0xd9b77a); rock(G4, -9.6, -0.8, 0.8, 0xd9b77a);
  // camel statue-ish sand dunes near edge
  for (const [x, z, r] of [[8.4, -7.4, 1.8], [-8.0, -7.0, 1.6], [9.4, 6.4, 1.2]]) G4.sph(x, 0, z, r, 0xf0cd8a, { sy: 0.32, q: 1, sx: 1.4 });

  // --- stage 5: lanterns, banners, braziers, sparkles ---
  for (const [x, y, z] of [[-3.0, 3.0, -0.5], [3.0, 3.0, -0.5], [-1.1, 3.4, 1.1], [1.1, 3.4, 1.1]]) fanous(F5, x, y, z, 0xffb050, 1.2);
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { const z = 2.6 + i * 1.7; F5.cyl(sx * 1.95, 0, z, 0.05, 1.0, 0x6a4a2e, { seg: 5 }); fanous(F5, sx * 1.95, 1.05, z, 0xffb050, 1.0); }
  for (const sx of [-1, 1]) {
    const bx = sx * 4.0, bz = -0.7 + 0.8;
    F5.cyl(bx, 6.9, bz - 0.8, 0.02, 0.1, 0x222222, { seg: 4 });
    makeFlag(ctx, 'f5', bx - 0.0, 7.8, -0.7 + 0.82, 0.55, 1.6, RED, GOLD, 0);
  }
  for (const [x, z] of [[-1.7, 8.8], [1.7, 8.8]]) { F5.cyl(x, 0, z, 0.2, 0.9, 0xcdb27e, { seg: 8, r2: 0.28, kind: 'stone' }); F5.disc(x, 0.9, z, 0.27, 0xff7a2a, { kind: 'glow' }); F5.halo(x, 1.1, z, 1.8, 0xff9a3a, 0.7, 0.9); }
  const fl = ctx.bb('f5', 12, true), sp = ctx.bb('f5', 18, true), sm = ctx.bb('f5', 10, false);
  ctx.on('f5', (t) => {
    for (let k = 0; k < 2; k++) for (let i = 0; i < 6; i++) { const ph = (t * 0.8 + i / 6 + k * 0.5) % 1, x = (k ? 1.7 : -1.7); fl.set(k * 6 + i, x + Math.sin(i * 3 + t * 3) * 0.08, 1.0 + ph * 0.7, 8.8 + Math.cos(i * 2 + t * 2) * 0.08, 0.17 * (1 - ph) + 0.04, 1.0, 0.55, 0.15, (1 - ph) * 0.9); }
    fl.commit();
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU, tw = Math.pow(0.5 + 0.5 * Math.sin(t * (1.6 + (i % 4) * 0.4) + i * 2.1), 3); sp.set(i, Math.cos(a) * (2.4 + (i % 3) * 0.4), 6.2 + Math.sin(a * 2 + i) * 1.2 + (i % 5) * 0.4, -2.85 + Math.sin(a) * (2.4 + (i % 3) * 0.4), 0.3 + tw * 0.3, 1.0, 0.88, 0.4, tw); }
    sp.commit();
    for (let i = 0; i < 10; i++) { const ph = (t * 0.2 + i / 10) % 1; sm.set(i, (i % 2 ? 1.7 : -1.7) + Math.sin(ph * 5 + i) * 0.15, 1.5 + ph * 1.8, 8.8, 0.15 + ph * 0.4, 0.8, 0.75, 0.7, (1 - ph) * 0.3 * Math.min(1, ph * 8)); }
    sm.commit();
  });
}

// ---------- the ten luxury items ----------
const ISTYLE = {
  villa:     { stone: 0xd9cdb8, deckK: 'stone', roofK: 'tile', car: 0xe53935, tile: 0x2fd6d0, canopy: 0xffffff },
  penthouse: { stone: 0x2b2756, deckK: 'paver', roofK: 'solid', car: 0x00d4ff, tile: 0x39f3ff, canopy: 0x2b2756 },
  bungalow:  { stone: 0xc29a62, deckK: 'plank', roofK: 'thatch', car: 0xffc21a, tile: 0x4fe8d8, canopy: 0xfff4e0 },
  treehouse: { stone: 0xa89a74, deckK: 'plank', roofK: 'leaf', car: 0x9be21a, tile: 0x35c8b8, canopy: 0xf0e6c8 },
  chalet:    { stone: 0xb9c6d4, deckK: 'plank', roofK: 'solid', car: 0x3b7dd8, tile: 0x5fd6f0, canopy: 0xffffff },
  palace:    { stone: 0xe6cf9f, deckK: 'stone', roofK: 'paint', car: 0xe9c46a, tile: 0x35d0c0, canopy: 0xfff0d0 },
};

function stringLights(b, x0, y0, z0, x1, y1, z1, sag, cols, step, halos) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / (step || 0.5)));
  let px = x0, py = y0, pz = z0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), y = lerp(y0, y1, t) - Math.sin(t * PI) * sag;
    b.seg(px, py, pz, x, y, z, 0.012, 0x222222, { seg: 4 });
    if (i < n) { b.sph(x, y - 0.07, z, 0.065, cols[i % cols.length], { kind: 'glow', q: 0 }); if (halos && i % 2 === 0) b.halo(x, y - 0.07, z, 0.55, cols[i % cols.length], 0.5, 0.4); }
    px = x; py = y; pz = z;
  }
}

ITEM_BUILDERS.lights = (ctx, b) => {
  const st = ctx.style, neon = st === 'penthouse', icy = st === 'chalet';
  const post = neon ? 0x2b2756 : st === 'palace' ? 0x6a4a2e : 0x30343b, glowC = neon ? 0x9bfaff : icy ? 0xdff3ff : 0xffe2a0, hal = neon ? 0x39f3ff : icy ? 0xaee4ff : 0xffbf60;
  const cols = neon ? [0x39f3ff, 0xff3df2, 0xffe14d] : icy ? [0xff3d3d, 0x39d353, 0xffd23f, 0x39a0ff] : [0xffe2a0, 0xffc870, 0xfff0c0];
  const P = [];
  for (const sx of [-1, 1]) for (const z of [2.4, 5.4, 8.4]) P.push([sx * 1.65 + 0.2, z]);
  for (const [x, z] of P) {
    b.cyl(x, 0, z, 0.17, 0.35, post, { r2: 0.11, seg: 8 }); b.cyl(x, 0.35, z, 0.05, 2.35, post, { seg: 6, kind: 'metal' }); b.cyl(x, 1.9, z, 0.09, 0.07, post, { seg: 8 });
    b.cyl(x, 2.7, z, 0.19, 0.1, post, { seg: 8, r2: 0.12 }); b.sph(x, 2.9, z, 0.2, glowC, { kind: 'glow', q: 1 }); b.cone(x, 3.05, z, 0.26, 0.2, post, { seg: 8 }); b.sph(x, 3.28, z, 0.05, post, { q: 0 });
    b.halo(x, 2.9, z, 2.0, hal, 0.65, 0.2); b.blob(x, z, 0.6, 0.6, 0.4);
    if (neon) b.tor(x, 2.5, z, 0.12, 0.02, 0xff3df2, { flat: true, kind: 'neon', seg: 12 });
  }
  for (const sx of [0, 3]) for (let i = 0; i < 2; i++) { const a = P[sx + i], c = P[sx + i + 1]; stringLights(b, a[0], 2.75, a[1], c[0], 2.75, c[1], 0.35, cols, 0.5, true); }
  for (let i = 0; i < 3; i++) stringLights(b, P[i][0], 2.7, P[i][1], P[i + 3][0], 2.7, P[i + 3][1], 0.5, cols, 0.45, true);
  // low bollards around the plot
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + 0.12, r = 9.7 * coast(a), x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (blocked(x, z, 0.3) || (z < 0 && Math.abs(x) < 5.5)) continue;
    b.cyl(x, 0, z, 0.07, 0.5, post, { seg: 6 }); b.sph(x, 0.58, z, 0.1, glowC, { kind: 'glow', q: 0 }); b.halo(x, 0.58, z, 0.9, hal, 0.5, 0.3);
  }
};

ITEM_BUILDERS.garden = (ctx, b) => {
  const st = ctx.style, pal = ctx.world.palette;
  const hedge = st === 'penthouse' ? 0x2a9a78 : st === 'chalet' ? 0x2f6b46 : st === 'palace' ? 0x4f8f3a : 0x2f8a3c;
  const fl = st === 'penthouse' ? [0xff3df2, 0x39f3ff, 0xffe14d] : st === 'chalet' ? [0xd84a4a, 0xffffff, 0xff9ec4] : pal.slice(0, 4).concat([0xffffff]);
  const bed = (cx, cz) => {
    const w = 1.9, d = 3.2;
    b.box(cx, 0, cz, w, 0.12, d, 0x5a3d28, { kind: 'dirt' });
    for (const [x, z, ww, dd] of [[cx, cz - d / 2, w, 0.3], [cx, cz + d / 2, w, 0.3], [cx - w / 2, cz, 0.3, d], [cx + w / 2, cz, 0.3, d]]) b.rbox(x, 0, z, ww, 0.62, dd, 0.12, shade(hedge, 0.95 + R() * 0.1), { kind: 'leaf', sway: 0.4 });
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) { const x = cx - 0.5 + c * 0.5, z = cz - d / 2 + 0.55 + r * 0.42; if (c === 1 && r > 1 && r < 4) continue; b.sph(x, 0.28, z, 0.13, fl[(r + c) % fl.length], { kind: 'leaf', q: 0 }); b.sph(x, 0.16, z, 0.17, 0x3f9a3a, { kind: 'leaf', q: 0, sy: 0.6 }); }
    for (let i = 0; i < 4; i++) { const r = 0.5 - i * 0.1; b.cone(cx, 0.1 + i * 0.32, cz, r, 0.5, shade(hedge, 0.9 + i * 0.06), { kind: 'leaf', seg: 9 }); }
    b.sph(cx, 1.5, cz, 0.12, 0xffd23f, { kind: 'gold', q: 0 });
    for (const [x, z] of [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx - w / 2, cz + d / 2], [cx + w / 2, cz + d / 2]]) { b.cyl(x, 0.5, z, 0.05, 0.35, 0x6a4a2e, { seg: 5 }); b.sph(x, 1.0, z, 0.26, hedge, { kind: 'leaf', jit: 0.05 }); }
    b.blob(cx, cz, 1.3, 2.0, 0.3);
  };
  bed(-2.1, 3.9); bed(2.5, 3.9);
  // rose arch over the path
  const ax = 0.2, az = 6.2, white = st === 'penthouse' ? 0x39f3ff : 0xfaf5ec;
  let prev = null;
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * PI, x = ax + Math.cos(a) * 1.1, y = 1.9 + Math.sin(a) * 1.1; if (prev) b.seg(prev[0], prev[1], az, x, y, az, 0.045, white, { seg: 5, kind: st === 'penthouse' ? 'neon' : 'solid' }); prev = [x, y]; if (i % 2 === 0) b.sph(x, y, az, 0.15, shade(hedge, 1.0), { kind: 'leaf', q: 0 }); if (i % 3 === 1) b.sph(x, y + 0.08, az + 0.1, 0.1, fl[i % fl.length], { kind: 'leaf', q: 0 }); }
  for (const s of [-1, 1]) { b.cyl(ax + s * 1.1, 0, az, 0.05, 1.95, white, { seg: 5, kind: st === 'penthouse' ? 'neon' : 'solid' }); for (let i = 0; i < 6; i++) b.sph(ax + s * 1.1 + (R() - 0.5) * 0.2, 0.3 + i * 0.3, az + (R() - 0.5) * 0.2, 0.13, i % 2 ? fl[0] : hedge, { kind: 'leaf', q: 0 }); }
  b.sph(ax, 3.0, az, 0.13, 0xff6fa5, { kind: 'leaf', q: 0 });
  // bench + topiary balls by the path
  b.box(-2.0, 0.4, 7.6, 0.45, 0.06, 1.4, 0x9a6a3e, { kind: 'plank' }); b.box(-2.0, 0.0, 6.95, 0.35, 0.4, 0.12, 0x30343b); b.box(-2.0, 0.0, 8.25, 0.35, 0.4, 0.12, 0x30343b); b.box(-2.2, 0.5, 7.6, 0.06, 0.45, 1.4, 0x9a6a3e, { kind: 'plank' });
  for (const [x, z] of [[-1.6, 9.4], [2.0, 9.6]]) { b.cyl(x, 0, z, 0.1, 0.55, 0x6a4a2e, { seg: 5 }); b.sph(x, 0.95, z, 0.4, hedge, { kind: 'leaf', jit: 0.05 }); b.sph(x, 1.5, z, 0.25, hedge, { kind: 'leaf', q: 0 }); }
};

ITEM_BUILDERS.fountain = (ctx, b) => {
  const S_ = ISTYLE[ctx.style], st = ctx.style, [fx, fz] = SPOT.fountain;
  const stone = st === 'penthouse' ? 0x35305f : st === 'chalet' ? 0xe6eef7 : S_.stone, rimc = st === 'penthouse' ? 0xff3df2 : 0xffffff;
  b.push(fx, 0, fz, 0);
  b.cyl(0, 0, 0, 1.72, 0.12, shade(stone, 0.85), { seg: 28, kind: 'stone' });
  b.lathe('basin', [[1.4, 0.1], [1.58, 0.14], [1.62, 0.55], [1.5, 0.6], [1.38, 0.52], [1.36, 0.14]], 0, 0, 0, stone, { seg: 28, kind: 'stone' });
  b.disc(0, 0.43, 0, 1.4, 0x38d0e0, { kind: 'water', seg: 28 });
  if (st === 'penthouse') b.tor(0, 0.58, 0, 1.52, 0.03, rimc, { flat: true, kind: 'neon', seg: 36 });
  b.cyl(0, 0.1, 0, 0.3, 0.9, stone, { seg: 12, r2: 0.2, kind: 'stone' });
  b.lathe('bowl1', [[0.05, 0], [0.5, 0.12], [0.85, 0.3], [0.9, 0.38], [0.8, 0.36], [0.5, 0.2], [0.05, 0.12]], 0, 0.95, 0, stone, { seg: 24, kind: 'stone' });
  b.disc(0, 1.3, 0, 0.8, 0x4fdcec, { kind: 'water', seg: 24 });
  b.cyl(0, 1.0, 0, 0.16, 0.85, stone, { seg: 10, r2: 0.12, kind: 'stone' });
  b.lathe('bowl2', [[0.04, 0], [0.3, 0.1], [0.5, 0.26], [0.52, 0.32], [0.44, 0.3], [0.28, 0.16], [0.04, 0.1]], 0, 1.75, 0, stone, { seg: 20, kind: 'stone' });
  b.disc(0, 2.04, 0, 0.45, 0x6fe6f2, { kind: 'water', seg: 20 });
  b.cyl(0, 1.8, 0, 0.08, 0.5, stone, { seg: 8, r2: 0.05 }); b.sph(0, 2.4, 0, 0.1, 0xffc21a, { kind: 'gold', q: 0 });
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; b.cyl(Math.cos(a) * 1.75, 0, Math.sin(a) * 1.75, 0.13, 0.75, stone, { seg: 8, kind: 'stone' }); b.sph(Math.cos(a) * 1.75, 0.82, Math.sin(a) * 1.75, 0.13, 0xffc21a, { kind: 'gold', q: 0 }); }
  b.blob(0, 0, 2.2, 2.2, 0.35);
  b.halo(0, 1.4, 0, 3.0, 0xbdf4ff, 0.18, 0.2);
  b.pop();
  const sp = ctx.bb('item_fountain', 84, false);
  // pre-computed jets
  const jets = [];
  for (let i = 0; i < 14; i++) jets.push({ t: 'c', k: i });
  for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) jets.push({ t: 'm', a: (j / 6) * TAU, k: i });
  for (let j = 0; j < 8; j++) for (let i = 0; i < 5; i++) jets.push({ t: 'r', a: (j / 8) * TAU + 0.2, k: i });
  ctx.on('item_fountain', (t) => {
    for (let i = 0; i < jets.length; i++) {
      const J = jets[i], ph = (t * 0.9 + J.k * (J.t === 'c' ? 0.07 : J.t === 'm' ? 0.167 : 0.2) + (J.a || 0) * 0.13) % 1;
      let x = 0, y = 0, z = 0, a = 0.5;
      if (J.t === 'c') { y = 2.45 + ph * 1.4 - ph * ph * 1.55; a = 0.6; }
      else if (J.t === 'm') { const r = 0.95 * ph; x = Math.cos(J.a) * r; z = Math.sin(J.a) * r; y = 2.05 + 0.9 * ph - 2.3 * ph * ph + 0.35; a = 0.55; }
      else { const r = 1.5 - 1.3 * ph; x = Math.cos(J.a) * r; z = Math.sin(J.a) * r; y = 0.62 + 1.5 * ph - 2.3 * ph * ph; a = 0.5; if (y < 0.45) a = 0; }
      sp.set(i, fx + x, y, fz + z, 0.07 + (1 - ph) * 0.03, 0.88, 0.97, 1.0, a * Math.min(1, ph * 6));
    }
    sp.commit();
  });
  const rp = ctx.sub('item_fountain', fx, 0.45, fz);
  for (let i = 0; i < 2; i++) rp.b.disc(0, 0.01 * i, 0, 1.45, 0xffffff, { kind: 'foam', seg: 28 });
  const rings = rp.g;
  ctx.on('item_fountain', (t) => { /* ripples are cosmetic: breathe the whole sub group */ rings.scale.setScalar(0.55 + 0.45 * ((t * 0.45) % 1)); });
};

ITEM_BUILDERS.pool = (ctx, b) => {
  const S_ = ISTYLE[ctx.style], st = ctx.style, [px, pz] = SPOT.pool;
  const x0 = 5.1, x1 = 8.9, z0 = -5.4, z1 = 1.0, H = 0.46;
  const tileC = S_.tile, coping = st === 'penthouse' ? 0x3a3470 : st === 'chalet' ? 0xeaf2fa : 0xf2ead8;
  // apron deck
  b.box(7.0, 0, 2.2, 4.7, 0.1, 2.5, S_.stone, { kind: S_.deckK === 'plank' ? 'plank' : S_.deckK === 'paver' ? 'paver' : 'stone', texScale: 0.8 });
  b.box(7.0, 0, -2.2, 4.1, 0.05, 7.0, shade(S_.stone, 0.92), { kind: 'stone' });
  b.box((x0 + x1) / 2, 0.0, (z0 + z1) / 2, x1 - x0, H - 0.08, z1 - z0, tileC, { kind: 'stone' });
  for (const [x, z, w, d] of [[(x0 + x1) / 2, z0 + 0.12, x1 - x0, 0.26], [(x0 + x1) / 2, z1 - 0.12, x1 - x0, 0.26], [x0 + 0.12, (z0 + z1) / 2, 0.26, z1 - z0]]) b.box(x, H, z, w, 0.07, d, coping, { kind: 'stone' });
  b.floor((x0 + 0.25 + x1) / 2, H - 0.04, (z0 + z1) / 2, x1 - x0 - 0.25, z1 - z0 - 0.5, tileC, { kind: 'water' });
  // infinity edge: thin water sheet falling to the lower catch basin
  b.quad(x1 + 0.02, (H - 0.04) / 2, (z0 + z1) / 2, z1 - z0 - 0.5, H - 0.04, 0x8fe8f0, { kind: 'fall', ry: PI / 2 }); b.quad(x1 + 0.03, (H - 0.04) / 2, (z0 + z1) / 2, z1 - z0 - 0.5, H - 0.04, 0x8fe8f0, { kind: 'fall', ry: -PI / 2 });
  b.floor(x1 + 0.4, 0.03, (z0 + z1) / 2, 0.8, z1 - z0 - 0.5, 0x6fe0e8, { kind: 'water' });
  b.box(x1 + 0.25, 0.0, (z0 + z1) / 2, 0.14, 0.2, z1 - z0 - 0.4, coping, { kind: 'stone' });
  // steps + ladder + lights
  for (let i = 0; i < 3; i++) b.box(6.4, 0.0, z1 + 0.15 + i * 0.3, 1.8, 0.4 - i * 0.12, 0.3, coping, { kind: 'stone' });
  for (const s of [-1, 1]) { b.seg(7.9 + s * 0.12, H + 0.1, z1 - 0.15, 7.9 + s * 0.12, H + 0.75, z1 - 0.15, 0.025, 0xdfe6ee, { kind: 'metal', seg: 5 }); b.seg(7.9 + s * 0.12, H + 0.75, z1 - 0.15, 7.9 + s * 0.12, H + 0.75, z1 - 0.5, 0.025, 0xdfe6ee, { kind: 'metal', seg: 5 }); }
  for (const [x, z] of [[5.6, -4.6], [5.6, -2.0], [5.6, 0.4]]) { b.sph(x, H - 0.02, z, 0.08, 0xaffcff, { kind: 'glow', q: 0 }); b.halo(x, H + 0.1, z, 1.3, 0x4fe8f0, 0.4, 0.3); }
  b.halo(7.0, H + 0.1, -2.2, 4.5, 0x5fe8f0, 0.1, 0.1);
  // loungers + parasol + towels
  const lounger2 = (x, z, ry, cush) => b.at(x, 0.1, z, ry, () => {
    b.rbox(0, 0.15, 0, 0.72, 0.1, 1.9, 0.05, 0xffffff); b.rbox(0, 0.28, -0.7, 0.68, 0.1, 0.8, 0.05, 0xffffff, { rx: 0.55 });
    b.rbox(0, 0.23, 0.15, 0.62, 0.07, 1.15, 0.04, cush); b.rbox(0, 0.42, -0.72, 0.6, 0.07, 0.7, 0.04, cush, { rx: 0.55 });
    for (const s of [-1, 1]) for (const zz of [-0.8, 0.8]) b.cyl(s * 0.3, 0, zz, 0.035, 0.16, 0xaab3bd, { seg: 5 });
    b.blob(0, 0, 0.7, 1.1, 0.4, -0.05);
  });
  lounger2(5.95, 2.3, PI, ctx.h.trim); lounger2(7.9, 2.3, PI, 0xffffff);
  b.cyl(6.95, 0.1, 2.4, 0.03, 2.5, 0xdddddd, { seg: 6 }); b.cone(6.95, 2.1, 2.4, 1.4, 0.55, 0xffffff, { seg: 10 }); b.cone(6.95, 2.12, 2.4, 1.41, 0.12, ctx.h.trim, { seg: 10 }); b.sph(6.95, 2.68, 2.4, 0.06, 0xdddddd, { q: 0 });
  b.cyl(6.95, 0.1, 2.4, 0.24, 0.05, 0x30343b, { seg: 8 });
  const bub = ctx.bb('item_pool', 8, true);
  ctx.on('item_pool', (t) => { for (let i = 0; i < 8; i++) { const ph = (t * 0.4 + i / 8) % 1; bub.set(i, 6.4 + (i % 4) * 0.7, H + 0.05, -4.6 + Math.floor(i / 4) * 2.4 + Math.sin(t + i) * 0.2, 0.12 + 0.1 * Math.sin(ph * PI), 1, 1, 1, Math.sin(ph * PI) * 0.35); } bub.commit(); });
};

ITEM_BUILDERS.gazebo = (ctx, b) => {
  const S_ = ISTYLE[ctx.style], st = ctx.style, [gx, gz] = SPOT.gazebo, acc = ctx.h.trim;
  const roofCol = st === 'villa' ? ctx.h.roof : st === 'penthouse' ? ctx.h.roof : st === 'bungalow' ? ctx.h.roof : st === 'treehouse' ? ctx.h.roof : st === 'chalet' ? 0xffffff : ctx.h.roof;
  const rk = S_.roofK, postC = st === 'penthouse' ? 0x20204a : st === 'palace' ? 0xf1dcae : st === 'chalet' ? 0x8a5a3b : st === 'villa' ? 0xfff8e8 : 0xb58656;
  b.push(gx, 0, gz, 0.3);
  b.cyl(0, 0, 0, 2.05, 0.2, S_.deckK === 'plank' ? 0xc29a62 : S_.stone, { seg: 6, kind: S_.deckK === 'paver' ? 'paver' : S_.deckK === 'plank' ? 'plank' : 'stone', ry: PI / 6 });
  b.cyl(0, 0.0, 0, 2.2, 0.1, shade(S_.stone, 0.85), { seg: 6, kind: 'stone', ry: PI / 6 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, x = Math.cos(a) * 1.8, z = Math.sin(a) * 1.8;
    b.cyl(x, 0.2, z, 0.1, 2.6, postC, { seg: 8, kind: st === 'chalet' || st === 'bungalow' || st === 'treehouse' ? 'bark' : 'solid' }); b.cyl(x, 0.2, z, 0.17, 0.2, shade(postC, 0.85), { seg: 8 }); b.sph(x, 2.88, z, 0.13, st === 'palace' ? 0xffc21a : postC, { kind: st === 'palace' ? 'gold' : 'solid', q: 0 });
    const a2 = ((i + 1) / 6) * TAU; b.seg(x, 2.78, z, Math.cos(a2) * 1.8, 2.78, Math.sin(a2) * 1.8, 0.07, shade(postC, 0.9), { seg: 5 });
    b.seg(x, 2.0, z, Math.cos(a2) * 1.8, 2.0, Math.sin(a2) * 1.8, 0.03, shade(postC, 0.9), { seg: 4 });
  }
  b.cone(0, 2.8, 0, 2.5, 1.4, roofCol, { seg: 6, kind: rk === 'thatch' ? 'thatch' : rk === 'tile' ? 'tile' : rk === 'leaf' ? 'leaf' : rk === 'paint' ? 'gold' : 'solid', ry: PI / 6, jit: 0.03 });
  if (st === 'chalet') b.cone(0, 2.8, 0, 2.52, 1.42, 0xffffff, { seg: 6, ry: PI / 6 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + PI / 12; b.cone(Math.cos(a) * 2.08, 2.62, Math.sin(a) * 2.08, 0.26, 0.28, i % 2 ? S_.canopy : acc, { seg: 4, rx: PI, ry: a }); }
  b.cyl(0, 4.15, 0, 0.04, 0.5, 0xffc21a, { seg: 5, kind: 'gold' }); b.sph(0, 4.7, 0, 0.1, 0xffc21a, { kind: 'gold', q: 0 });
  if (st === 'penthouse') b.tor(0, 2.8, 0, 2.2, 0.04, 0xff3df2, { flat: true, kind: 'neon', seg: 36 });
  // seating
  for (let i = 0; i < 6; i++) { const a = PI * 0.35 + i * 0.52, r = 1.2, x = Math.cos(a) * r, z = Math.sin(a) * r; b.rbox(x, 0.2, z, 0.8, 0.34, 0.55, 0.1, i % 2 ? acc : 0xfff4e0, { ry: -a + PI / 2 }); b.rbox(Math.cos(a) * 1.5, 0.42, Math.sin(a) * 1.5, 0.82, 0.5, 0.22, 0.09, i % 2 ? shade(acc, 0.85) : 0xf0e6d0, { ry: -a + PI / 2 }); }
  b.cyl(-0.2, 0.2, -0.1, 0.5, 0.35, 0x6a4a2e, { seg: 14, kind: 'plank' }); b.cyl(-0.2, 0.55, -0.1, 0.55, 0.05, 0xf2ead8, { seg: 14 });
  b.cyl(-0.2, 0.6, -0.1, 0.1, 0.18, 0x30343b, { seg: 6 }); b.sph(-0.2, 0.85, -0.1, 0.1, 0xffe2a0, { kind: 'glow', q: 0 }); b.halo(-0.2, 0.85, -0.1, 1.1, 0xffbf60, 0.5, 0.4);
  b.disc(-0.2, 0.22, -0.1, 1.15, shade(acc, 0.9), { seg: 24 });
  b.sph(0, 2.3, 0, 0.14, 0xfff0c0, { kind: 'glow', q: 0 }); b.seg(0, 2.3, 0, 0, 2.8, 0, 0.01, 0x30343b); b.halo(0, 2.3, 0, 1.8, 0xffc870, 0.5, 0.3);
  // drapes
  for (const i of [0, 2, 4]) { const a = (i / 6) * TAU, x = Math.cos(a) * 1.82, z = Math.sin(a) * 1.82; for (const o of [-0.25, 0.25]) b.box(x, 0.4, z, 0.5, 2.3, 0.04, S_.canopy, { kind: 'cloth', ry: -a + PI / 2, rz: o * 0.2, a: 1 }); }
  b.blob(0, 0, 2.6, 2.6, 0.45);
  b.pop();
};

ITEM_BUILDERS.solar = (ctx, b) => {
  const rb = ctx.P.item_solarRoof;                       // roof panels live in their own group (visible from stage 2 on)
  const panel = (bb, w, d) => { bb.box(0, 0.0, 0, w + 0.08, 0.06, d + 0.08, 0xc8d0da, { kind: 'metal' }); bb.floor(0, 0.07, 0, w, d, 0xffffff, { kind: 'solarp' }); };
  for (const r of ctx.solar || []) {
    const nx = Math.max(1, Math.floor(r.w / 1.05)), nz = Math.max(1, Math.floor(r.d / 1.25)), pw = Math.min(1.0, r.w / nx - 0.05), pd = Math.min(1.2, r.d / nz - 0.05);
    rb.push(r.x, r.y, r.z, r.ry || 0, r.tilt || 0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { rb.push(-r.w / 2 + (i + 0.5) * (r.w / nx), 0.04, -r.d / 2 + (j + 0.5) * (r.d / nz), 0); panel(rb, pw, pd); rb.pop(); }
    rb.pop();
  }
  // ground array with racks
  const [gx, gz] = SPOT.solarG;
  for (let i = 0; i < 5; i++) {
    const x = gx - 2.56 + i * 1.28, z = gz;
    b.cyl(x - 0.45, 0, z - 0.35, 0.03, 0.8, 0xaab3bd, { seg: 4 }); b.cyl(x + 0.45, 0, z - 0.35, 0.03, 0.8, 0xaab3bd, { seg: 4 });
    b.cyl(x - 0.45, 0, z + 0.45, 0.03, 0.3, 0xaab3bd, { seg: 4 }); b.cyl(x + 0.45, 0, z + 0.45, 0.03, 0.3, 0xaab3bd, { seg: 4 });
    b.push(x, 0.55, z + 0.05, 0, 0.55); panel(b, 1.15, 1.2); b.pop();
  }
  b.box(gx - 3.5, 0, gz, 0.5, 0.7, 0.3, 0xe9eef3, { kind: 'metal' }); b.sph(gx - 3.5, 0.55, gz + 0.17, 0.04, 0x3dff7a, { kind: 'glow', q: 0 }); b.halo(gx - 3.5, 0.55, gz + 0.2, 0.5, 0x3dff7a, 0.6, 0.8);
  b.blob(gx, gz, 3.4, 1.0, 0.25);
};

// ---- supercar (lofted body) ----
ITEM_BUILDERS.supercar = (ctx, b) => {
  const S_ = ISTYLE[ctx.style], col = S_.car, st = ctx.style, [cx, cz] = SPOT.supercar;
  b.push(cx, 0.05, cz, -0.35);
  const body = [{ z: -2.2, w: 1.5, y0: 0.3, y1: 0.86 }, { z: -1.95, w: 1.85, y0: 0.24, y1: 0.98 }, { z: -1.3, w: 1.98, y0: 0.2, y1: 1.06 }, { z: -0.4, w: 1.98, y0: 0.2, y1: 0.98 }, { z: 0.6, w: 1.96, y0: 0.2, y1: 0.8 }, { z: 1.5, w: 1.9, y0: 0.2, y1: 0.64 }, { z: 2.1, w: 1.7, y0: 0.22, y1: 0.5 }, { z: 2.32, w: 1.3, y0: 0.26, y1: 0.42 }];
  b.loft(body, col, { pw: 3.0, kind: 'paint', n: 20 });
  const cab = [{ z: -1.5, w: 1.15, y0: 0.92, y1: 1.02 }, { z: -1.1, w: 1.5, y0: 0.9, y1: 1.34 }, { z: -0.2, w: 1.5, y0: 0.9, y1: 1.4 }, { z: 0.5, w: 1.34, y0: 0.78, y1: 1.1 }, { z: 0.95, w: 1.1, y0: 0.74, y1: 0.84 }];
  b.loft(cab, 0x14202f, { pw: 2.6, kind: 'paint', n: 18 });
  b.box(0, 1.37, -0.3, 0.9, 0.02, 1.0, shade(col, 0.9), { kind: 'paint' });
  // wheels
  const wheel = (x, z, r, w) => {
    b.cylc(x, r, z, r, w, 0x15151a, { rz: PI / 2, seg: 20 });
    b.cylc(x + Math.sign(x) * w * 0.52, r, z, r * 0.7, 0.04, 0xd7dde5, { rz: PI / 2, seg: 14, kind: 'metal' });
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; b.boxc(x + Math.sign(x) * w * 0.55, r + Math.sin(a) * r * 0.36, z + Math.cos(a) * r * 0.36, 0.03, 0.07, r * 0.55, 0x8a929c, { rx: -a, kind: 'metal' }); }
    b.cylc(x + Math.sign(x) * w * 0.56, r, z, r * 0.14, 0.04, 0xffc21a, { rz: PI / 2, seg: 8, kind: 'gold' });
    b.cylc(x - Math.sign(x) * 0.0, r, z, r * 0.74, w - 0.04, 0x2a2a30, { rz: PI / 2, seg: 14 });
  };
  wheel(0.93, 1.35, 0.36, 0.3); wheel(-0.93, 1.35, 0.36, 0.3); wheel(0.95, -1.3, 0.4, 0.36); wheel(-0.95, -1.3, 0.4, 0.36);
  for (const [x, z, r] of [[1.0, 1.35, 0.42], [-1.0, 1.35, 0.42], [1.0, -1.3, 0.45], [-1.0, -1.3, 0.45]]) b.cylc(x * 0.98, 0.4, z, r, 0.04, 0x0e0e12, { rz: PI / 2, seg: 16 });
  // lights, vents, wing, exhaust, plates
  for (const s of [-1, 1]) {
    b.boxc(s * 0.62, 0.56, 2.15, 0.5, 0.07, 0.14, 0xeaf6ff, { kind: 'glow', ry: s * -0.3 }); b.halo(s * 0.62, 0.56, 2.3, 0.9, 0xcfeaff, 0.55, 0.1);
    b.boxc(s * 0.66, 0.46, 2.1, 0.34, 0.03, 0.1, 0x39f3ff, { kind: 'glow' });
    b.boxc(s * 0.97, 0.52, -0.8, 0.06, 0.2, 0.5, 0x101018, {});
    b.boxc(s * 0.5, 0.88, 1.2, 0.3, 0.02, 0.5, 0x101018, {});
    b.boxc(s * 1.0, 0.98, 0.45, 0.14, 0.1, 0.18, shade(col, 0.85), { kind: 'paint' }); b.seg(s * 0.96, 0.92, 0.5, s * 0.82, 0.95, 0.6, 0.015, 0x101018);
    b.cyl(s * 0.45, 0.4, -2.28, 0.075, 0.2, 0xdfe6ee, { rx: PI / 2, seg: 10, kind: 'metal' });
    b.cylc(s * 0.82, 0.92, -2.05, 0.03, 0.34, 0x101018, { seg: 5 });
  }
  b.boxc(0, 0.84, -2.18, 1.3, 0.07, 0.08, 0xff2a2a, { kind: 'glow' }); b.halo(0, 0.84, -2.3, 1.2, 0xff3030, 0.55, 0.1);
  b.boxc(0, 1.12, -2.05, 1.8, 0.05, 0.42, 0x15151a, { kind: 'paint', rx: -0.08 }); b.boxc(0, 1.1, -2.05, 1.84, 0.015, 0.45, col, { kind: 'paint', rx: -0.08 });
  b.boxc(0, 0.98, -2.06, 0.06, 0.2, 0.06, 0x15151a, {}); for (const s of [-1, 1]) b.boxc(s * 0.62, 1.0, -2.06, 0.06, 0.2, 0.08, 0x15151a, {});
  b.boxc(0, 0.2, 2.2, 1.9, 0.05, 0.34, 0x101018, {}); b.boxc(0, 0.22, -2.2, 1.5, 0.05, 0.3, 0x101018, {});
  b.boxc(0, 0.5, -2.31, 0.38, 0.12, 0.02, 0xffffff, {});
  b.boxc(0, 0.69, 1.72, 0.04, 0.02, 1.3, 0xffffff, { kind: 'paint' }); b.boxc(0, 1.42, -0.4, 0.04, 0.02, 1.0, 0xffffff, { kind: 'paint' });
  if (st === 'penthouse') { b.halo(0, 0.2, 0, 4.2, 0xff3df2, 0.5, 0.2); b.floor(0, 0.03, 0, 2.3, 4.7, 0xff3df2, { kind: 'glow' }); }
  b.blob(0, 0, 1.5, 2.7, 0.7, 0.02);
  b.pop();
};

ITEM_BUILDERS.helipad = (ctx, b) => {
  const [hx, hz] = SPOT.helipad, acc = ctx.h.trim, st = ctx.style;
  b.cyl(hx, 0, hz, 2.15, 0.22, st === 'penthouse' ? 0x20204a : 0x3d424a, { seg: 36, kind: 'concrete' });
  b.cyl(hx, 0.2, hz, 2.0, 0.04, 0x30343b, { seg: 36 });
  b.tor(hx, 0.245, hz, 1.85, 0.05, 0xffc21a, { flat: true, seg: 36 });
  b.tor(hx, 0.245, hz, 1.5, 0.025, 0xffffff, { flat: true, seg: 36 });
  for (const [x, z, w, d] of [[-0.45, 0, 0.18, 1.1], [0.45, 0, 0.18, 1.1], [0, 0, 0.9, 0.18]]) b.box(hx + x, 0.235, hz + z, w, 0.02, d, 0xffffff, { rz: 0 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; b.sph(hx + Math.cos(a) * 2.1, 0.26, hz + Math.sin(a) * 2.1, 0.07, i % 2 ? 0xff5030 : 0xffe070, { kind: 'glow', q: 0 }); if (i % 3 === 0) b.halo(hx + Math.cos(a) * 2.1, 0.3, hz + Math.sin(a) * 2.1, 0.7, 0xffc060, 0.5, 0.8); }
  b.blob(hx, hz, 2.6, 2.6, 0.3, 0.0);
  // wind sock
  b.cyl(hx - 2.0, 0.2, hz + 1.2, 0.04, 1.8, 0xdddddd, { seg: 5 });
  const sock = ctx.sub('item_helipad', hx - 2.0, 2.0, hz + 1.2);
  sock.b.cone(0.35, 0, 0, 0.18, 0.7, 0xff7a1f, { seg: 8, rz: -PI / 2 }); sock.b.cone(0.5, 0, 0, 0.17, 0.2, 0xffffff, { seg: 8, rz: -PI / 2 });
  ctx.on('item_helipad', (t) => { sock.g.rotation.y = Math.sin(t * 0.6) * 0.5 - 0.6; sock.g.rotation.z = Math.sin(t * 2) * 0.06 - 0.1; });
  // helicopter
  const hb = ctx.sub('item_helipad', hx, 0.24, hz, 0.7), h = hb.b;
  const body = 0xffffff, dark = 0x2a2f38;
  h.sph(0, 0.95, 0, 1, body, { sx: 0.62, sy: 0.62, sz: 1.25, kind: 'paint' });
  h.sph(0, 0.95, 0.6, 1, 0x1b2a3c, { sx: 0.5, sy: 0.48, sz: 0.7, kind: 'paint' });
  h.sph(0, 0.85, 0.0, 1, acc, { sx: 0.635, sy: 0.12, sz: 1.27, kind: 'paint' });
  h.box(0, 1.5, -0.2, 0.6, 0.28, 0.9, body, { kind: 'paint' });
  h.cyl(0, 1.75, -0.2, 0.06, 0.22, dark, { seg: 6 });
  h.seg(0, 0.95, -1.0, 0, 1.15, -3.0, 0.2, 0xe9edf2, { kind: 'paint', seg: 8 }); h.seg(0, 1.15, -2.7, 0, 1.15, -3.15, 0.1, acc, { kind: 'paint', seg: 8 });
  h.box(0, 1.1, -3.2, 0.05, 0.75, 0.45, acc, { kind: 'paint', rx: 0.25 });
  for (const s of [-1, 1]) {
    h.seg(s * 0.62, 0.12, 1.1, s * 0.62, 0.12, -1.0, 0.045, dark, { seg: 6 }); h.seg(s * 0.62, 0.12, 1.1, s * 0.62, 0.3, 1.25, 0.04, dark, { seg: 5 });
    h.seg(s * 0.5, 0.2, 0.5, s * 0.62, 0.12, 0.5, 0.04, dark, { seg: 5 }); h.seg(s * 0.5, 0.45, 0.5, s * 0.62, 0.12, 0.5, 0.035, dark, { seg: 5 });
    h.seg(s * 0.5, 0.45, -0.5, s * 0.62, 0.12, -0.5, 0.035, dark, { seg: 5 });
  }
  h.sph(0.0, 0.98, 1.2, 0.07, 0xffffc8, { kind: 'glow', q: 0 });
  const rotor = ctx.sub('item_helipad', 0, 1.97, -0.2); hb.g.add(rotor.g);
  rotor.b.cyl(0, -0.05, 0, 0.1, 0.1, dark, { seg: 8 });
  for (let k = 0; k < 4; k++) rotor.b.box(Math.cos(k * PI / 2) * 1.05, 0.0, Math.sin(k * PI / 2) * 1.05, k % 2 ? 0.16 : 2.1, 0.03, k % 2 ? 2.1 : 0.16, 0x23262c, { kind: 'solid' });
  rotor.b.disc(0, 0.0, 0, 2.15, 0xffffff, { kind: 'glass', seg: 28 });
  const tail = ctx.sub('item_helipad', 0.1, 1.2, -3.2); hb.g.add(tail.g);
  tail.b.box(0, -0.02, 0, 0.03, 0.8, 0.12, dark, { rz: 0 }); tail.b.box(0, -0.02, 0, 0.03, 0.12, 0.8, dark); tail.b.disc(0, 0, 0, 0.45, 0xffffff, { kind: 'glass', seg: 16 });
  tail.g.rotation.z = PI / 2;
  h.blob(0, 0, 1.0, 1.9, 0.0, 0.0);
  ctx.on('item_helipad', (t) => { rotor.g.rotation.y = t * 38; tail.g.children.forEach((c) => { c.rotation.z = 0; }); tail.g.rotation.x = t * 30; });
};

// ---- luxury yacht moored at its own pier ----
ITEM_BUILDERS.yacht = (ctx, b) => {
  const acc = ctx.h.trim, [yx, yz] = SPOT.yacht, [px, pz0] = SPOT.pier;
  const hull = 0xffffff, navy = 0x1b2a45, teak = 0xc29a62;
  buildPier(ctx, b, px, pz0, 16.2, 1.6, 0xb8895a);
  for (const z of [11.0, 13.4, 15.8]) for (const s of [-1]) { b.cyl(px + s * 0.7 - 0.0, 0.37, z, 0.09, 0.28, 0xd9473a, { seg: 8, r2: 0.07 }); }
  b.cyl(px + 0.7, 0.36, 16.1, 0.07, 1.4, 0x30343b, { seg: 6 }); b.sph(px + 0.7, 1.82, 16.1, 0.13, 0xffe6a8, { kind: 'glow', q: 0 }); b.halo(px + 0.7, 1.82, 16.1, 1.3, 0xffc870, 0.6, 0.3);
  const YS = 0.85;
  const yt = ctx.sub('item_yacht', yx, 0, yz, 0.0), y = yt.b; yt.g.scale.setScalar(YS);
  const st = [{ z: -4.6, w: 2.6, y0: -0.8, y1: 0.4 }, { z: -3.6, w: 2.85, y0: -1.1, y1: 0.42 }, { z: -2.0, w: 2.95, y0: -1.2, y1: 0.45 }, { z: 0.0, w: 2.95, y0: -1.2, y1: 0.48 }, { z: 1.8, w: 2.7, y0: -1.05, y1: 0.56 }, { z: 3.2, w: 2.0, y0: -0.8, y1: 0.66 }, { z: 4.2, w: 1.0, y0: -0.5, y1: 0.74 }, { z: 4.75, w: 0.18, y0: -0.25, y1: 0.8 }];
  y.loft(st, hull, { pw: 3.6, kind: 'paint', n: 20 });
  y.loft(st.map((s) => ({ z: s.z, w: s.w + 0.03, y0: s.y0 * 0.0 - 0.1, y1: 0.06 + (s.y1 - 0.4) * 0.5 })), acc, { pw: 3.6, kind: 'paint', n: 20 });
  y.loft(st.map((s) => ({ z: s.z, w: s.w - 0.0, y0: -1.2, y1: -0.9 + (s.y1 - 0.4) * 0.0 })), 0xc23a3a, { pw: 3.6, kind: 'paint', n: 20, y: -0.0 });
  // deck
  y.poly([[-1.3, -4.7], [1.3, -4.7], [1.45, -3.6], [1.45, 0.0], [1.3, 1.8], [1.0, 3.2], [0.5, 4.2], [0.0, 4.7], [-0.5, 4.2], [-1.0, 3.2], [-1.3, 1.8], [-1.45, 0.0], [-1.45, -3.6]].map(([x, z]) => [x * 0.96, z]), 0.43, 0.04, teak, { kind: 'plank' });
  // saloon + flybridge
  y.rbox(0, 0.47, -0.9, 2.5, 1.1, 3.4, 0.28, 0xffffff, { kind: 'paint' });
  for (const s of [-1, 1]) y.rbox(s * 1.255, 0.85, -0.9, 0.03, 0.5, 3.0, 0.02, navy, { kind: 'paint' });
  y.rbox(0, 0.85, 0.82, 2.0, 0.5, 0.03, 0.02, navy, { kind: 'paint' });
  y.rbox(0, 1.57, -1.1, 2.2, 0.8, 2.4, 0.25, 0xffffff, { kind: 'paint' });
  for (const s of [-1, 1]) y.rbox(s * 1.105, 1.8, -1.1, 0.03, 0.36, 2.0, 0.02, navy, { kind: 'paint' });
  y.rbox(0, 1.8, 0.1, 1.8, 0.36, 0.03, 0.02, navy, { kind: 'paint' });
  y.rbox(0, 2.37, -1.2, 2.5, 0.1, 2.8, 0.05, acc, { kind: 'paint' });
  y.cyl(0, 2.47, -1.5, 0.04, 1.1, 0xdddddd, { seg: 6, kind: 'metal' });
  const radar = ctx.sub('item_yacht', 0, 3.7, -1.5); yt.g.add(radar.g);
  radar.b.box(0, 0, 0, 0.9, 0.06, 0.12, 0xdfe6ee, { kind: 'metal' }); radar.b.cyl(0, -0.08, 0, 0.07, 0.1, 0x30343b, { seg: 6 });
  y.sph(0.3, 3.2, -1.5, 0.07, 0xff2a2a, { kind: 'glow', q: 0 }); y.halo(0.3, 3.2, -1.5, 0.7, 0xff3030, 0.8, 0.8);
  y.seg(0, 3.5, -1.5, 0, 2.45, 0.8, 0.012, 0xdddddd); y.seg(0, 3.5, -1.5, 0, 2.45, -3.0, 0.012, 0xdddddd);
  // bow sun deck, aft jacuzzi, loungers
  y.rbox(0, 0.47, 2.7, 1.5, 0.22, 1.2, 0.1, 0xfff4e0); y.rbox(0, 0.6, 3.05, 1.3, 0.2, 0.5, 0.08, acc);
  y.cyl(0, 0.47, -3.6, 0.7, 0.35, 0xffffff, { seg: 16, kind: 'paint' }); y.disc(0, 0.82, -3.6, 0.58, 0x4fe8f0, { kind: 'water', seg: 16 });
  for (const s of [-1, 1]) y.rbox(s * 0.78, 0.47, -2.5, 0.55, 0.2, 1.1, 0.06, 0xfff4e0);
  y.box(0, 0.0, -4.85, 2.2, 0.12, 0.55, teak, { kind: 'plank' });
  for (const sx of [-1, 1]) { y.seg(sx * 1.3, 0.47, -4.2, sx * 1.3, 1.1, -4.2, 0.02, 0xdfe6ee); y.seg(sx * 1.38, 0.47, 0.0, sx * 1.38, 1.05, 0.0, 0.02, 0xdfe6ee); }
  y.seg(-1.32, 1.05, -4.2, -1.42, 1.05, 1.9, 0.02, 0xdfe6ee); y.seg(1.32, 1.05, -4.2, 1.42, 1.05, 1.9, 0.02, 0xdfe6ee);
  y.seg(-1.42, 1.05, 1.9, 0, 1.05, 4.4, 0.02, 0xdfe6ee); y.seg(1.42, 1.05, 1.9, 0, 1.05, 4.4, 0.02, 0xdfe6ee); y.seg(-1.32, 1.05, -4.2, 1.32, 1.05, -4.2, 0.02, 0xdfe6ee);
  for (const s of [-1, 1]) y.tor(s * 1.5, 0.75, 0.9, 0.2, 0.06, 0xff7a1f, { seg: 12, ry: PI / 2 });
  y.cyl(0, 0.47, 4.2, 0.03, 0.9, 0xdddddd, { seg: 5 });
  y.sph(0, 0.2, 4.55, 0.1, 0x555b64, { q: 0 });
  y.blob(0, 0, 1.8, 5.2, 0.0, -0.85);
  const wake = ctx.sub('item_yacht', yx, -0.82, yz); const wk = wake.b;
  wk.disc(0, 0, 0, 1, 0xffffff, { kind: 'foam', sx: 2.5, sz: 5.9, seg: 32 });
  ctx.on('item_yacht', (t) => { yt.g.position.y = Math.sin(t * 1.1) * 0.045; yt.g.rotation.z = Math.sin(t * 0.9) * 0.018; yt.g.rotation.x = Math.sin(t * 0.7 + 1) * 0.012; radar.g.rotation.y = t * 2.2; wake.g.scale.set(YS * (1 + Math.sin(t * 0.8) * 0.03), 1, YS * (1 + Math.sin(t * 0.8) * 0.03)); });
};

// ---- golden courier statue ----
ITEM_BUILDERS.statue = (ctx, b) => {
  const [sx, sz] = SPOT.statue, mar = ctx.style === 'penthouse' ? 0x4a4480 : 0xf3efe6, gold = 0xffc21a;
  b.box(sx, 0, sz, 1.7, 0.16, 1.7, shade(mar, 0.92), { kind: 'stone' }); b.box(sx, 0.16, sz, 1.35, 0.2, 1.35, mar, { kind: 'stone' });
  b.box(sx, 0.36, sz, 0.92, 1.0, 0.92, mar, { kind: 'stone', dark: 0.06 }); b.box(sx, 1.36, sz, 1.12, 0.14, 1.12, shade(mar, 1.0), { kind: 'stone' }); b.box(sx, 1.1, sz, 0.98, 0.1, 0.98, gold, { kind: 'gold' });
  b.box(sx, 0.7, sz + 0.47, 0.5, 0.26, 0.03, ctx.h.trim, { kind: 'paint' }); b.blob(sx, sz, 1.4, 1.4, 0.45);
  if (ctx.style === 'penthouse') { b.tor(sx, 0.02, sz, 1.0, 0.03, 0xff3df2, { flat: true, kind: 'neon' }); }
  const sg = ctx.sub('item_statue', sx, 1.5, sz), s = sg.b;
  const G_ = { kind: 'gold' };
  s.sph(0, 0.55, 0, 0.42, gold, Object.assign({ sy: 1.25, sx: 0.95, sz: 0.85 }, G_));                         // body
  s.sph(0, 0.58, 0.18, 0.3, 0xffe49a, Object.assign({ sy: 1.1, sz: 0.5 }, G_));                              // belly
  s.sph(-0.19, 0.08, 0.12, 0.2, gold, Object.assign({ sx: 0.8, sz: 1.5, sy: 0.55 }, G_)); s.sph(0.19, 0.08, 0.12, 0.2, gold, Object.assign({ sx: 0.8, sz: 1.5, sy: 0.55 }, G_));
  s.sph(0, 1.38, 0.02, 0.4, gold, Object.assign({ sy: 0.92 }, G_));                                          // head
  for (const k of [-1, 1]) { s.sph(k * 0.14, 2.0, -0.02, 0.15, gold, Object.assign({ sx: 0.55, sy: 2.1, sz: 0.4, rz: -k * 0.22 }, G_)); s.sph(k * 0.14, 2.0, 0.02, 0.1, 0xffe49a, Object.assign({ sx: 0.5, sy: 1.8, sz: 0.3, rz: -k * 0.22 }, G_)); }
  s.sph(0, 1.34, 0.4, 0.07, 0xb5761a, G_); for (const k of [-1, 1]) { s.sph(k * 0.17, 1.46, 0.35, 0.065, 0x3a2a12, Object.assign({ q: 0 }, G_)); s.sph(k * 0.2, 1.33, 0.36, 0.08, 0xffe49a, Object.assign({ q: 0 }, G_)); }
  s.box(0, 1.15, 0.38, 0.09, 0.1, 0.03, 0xffffff, {});
  for (const k of [-1, 1]) s.tor(k * 0.17, 1.66, 0.22, 0.11, 0.035, 0xdfe6ee, { kind: 'metal', seg: 14 });
  s.tor(0, 1.0, 0.0, 0.3, 0.09, 0xd84a4a, { flat: true, seg: 16 }); s.box(-0.3, 0.55, -0.22, 0.16, 0.7, 0.04, 0xd84a4a, { rz: -0.15, rx: -0.2 });
  s.rbox(0, 0.28, -0.4, 0.5, 0.6, 0.22, 0.08, 0xe0a812, G_); s.sph(0, 0.5, -0.52, 0.1, 0xffe49a, Object.assign({ sz: 0.4 }, G_));
  s.sph(0.0, 0.18, -0.52, 0.2, 0xffe49a, G_);                                                                // fluffy tail
  s.seg(0.34, 0.85, 0.05, 0.6, 1.55, 0.3, 0.07, gold, G_); s.sph(0.62, 1.58, 0.3, 0.09, gold, G_);          // raised arm
  s.cylc(0.62, 2.05, 0.3, 0.38, 0.06, gold, Object.assign({ rx: PI / 2, seg: 22 }, G_)); s.cylc(0.62, 2.05, 0.3, 0.27, 0.075, 0xb5761a, Object.assign({ rx: PI / 2, seg: 22 }, G_));
  s.tor(0.62, 2.05, 0.34, 0.2, 0.03, gold, Object.assign({ seg: 5 }, G_));
  s.seg(-0.34, 0.8, 0.05, -0.3, 0.5, 0.45, 0.07, gold, G_); s.sph(-0.3, 0.48, 0.5, 0.09, gold, G_); s.box(-0.3, 0.38, 0.5, 0.26, 0.04, 0.2, 0xffffff, {});
  ctx.on('item_statue', (t) => { sg.g.rotation.y = Math.sin(t * 0.45) * 0.55; });
  b.halo(sx, 2.6, sz, 3.2, 0xffd060, 0.22, 0.15);
  const sp = ctx.bb('item_statue', 9, true);
  ctx.on('item_statue', (t) => { for (let i = 0; i < 9; i++) { const a = i * 2.4 + t * 0.2, tw = Math.pow(0.5 + 0.5 * Math.sin(t * (2 + i * 0.37) + i), 4); sp.set(i, sx + Math.cos(a) * (0.5 + (i % 3) * 0.25), 1.8 + ((i * 0.37) % 1) * 1.8, sz + Math.sin(a) * (0.5 + (i % 3) * 0.25), 0.12 + tw * 0.25, 1, 0.9, 0.45, tw); } sp.commit(); });
};

// ---------- assembly ----------
const STYLE_BUILDERS = {
  villa: () => buildVilla, penthouse: () => (typeof buildPenthouse !== 'undefined' ? buildPenthouse : null), bungalow: () => (typeof buildBungalow !== 'undefined' ? buildBungalow : null),
  treehouse: () => (typeof buildTreehouse !== 'undefined' ? buildTreehouse : null), chalet: () => (typeof buildChalet !== 'undefined' ? buildChalet : null), palace: () => (typeof buildPalace !== 'undefined' ? buildPalace : null),
};

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function makeHome(world, stage, items) {
  seedBuild(hashStr(world.id) + 12345);
  const ctx = new Ctx(world);
  const home = new THREE.Group();
  home.name = 'home-' + world.id;
  // item batches
  for (const id of ITEM_IDS) ctx.P['item_' + id] = new B();
  ctx.P.item_solarRoof = new B();
  const gGround = new THREE.Group(); gGround.name = 'ground';
  buildIsland(ctx, gGround);
  beachDecor(ctx, ctx.P.ground);
  buildSite(ctx);
  const sb = STYLE_BUILDERS[ctx.style] && STYLE_BUILDERS[ctx.style]();
  if (sb) sb(ctx);
  const f = ctx.foot;
  ctx.P.shell.blob(f.cx, f.cz, f.w * 0.62, f.d * 0.66, 0.45, 0.022); ctx.P.struct.blob(f.cx, f.cz, f.w * 0.6, f.d * 0.62, 0.4, 0.022);
  for (const id of ITEM_IDS) if (ITEM_BUILDERS[id]) { seedBuild(hashStr(world.id + id)); ITEM_BUILDERS[id](ctx, ctx.P['item_' + id]); }

  const parts = [];
  for (const [name, min, max] of PART_DEFS) {
    const g = name === 'ground' ? gGround : new THREE.Group();
    g.name = name; ctx.P[name].build(g); ctx.groups[name] = g; home.add(g); parts.push({ g, min, max });
  }
  const itemGroups = {};
  for (const id of ITEM_IDS) { const g = new THREE.Group(); g.name = 'item_' + id; ctx.P['item_' + id].build(g); g.visible = false; ctx.groups['item_' + id] = g; itemGroups[id] = g; home.add(g); }
  const roofSolar = new THREE.Group(); roofSolar.name = 'item_solarRoof'; ctx.P.item_solarRoof.build(roofSolar); roofSolar.visible = false; ctx.groups.item_solarRoof = roofSolar; home.add(roofSolar);
  for (const s of ctx.subs) { s.b.build(s.g); if (!s.g.parent) ctx.groups[s.part].add(s.g); }
  for (const { part, s } of ctx.bbs) ctx.groups[part].add(s.mesh);
  for (const f of ctx.flags || []) ctx.groups[f.part].add(f.holder);
  for (const a of ctx.anim) if (typeof a.g === 'string') a.g = ctx.groups[a.g];
  home.userData = {
    bounds: { radius: 12, height: ctx.height },
    ctx, parts, itemGroups, roofSolar, anim: ctx.anim, stage: -1, items: [], solarOwned: false,
    setNight(on) { U.night.value = on ? 1.0 : 0.55; home.userData.night = !!on; },
  };
  home.userData.setNight(ctx.night);
  setHomeStage(home, stage);
  setHomeItems(home, items);
  return home;
}

export function setHomeStage(home, stage) {
  const u = home.userData; if (!u || !u.parts) return;
  const s = clamp(Math.round(stage || 0), 0, 5);
  if (u.stage === s) return;
  u.stage = s;
  for (const p of u.parts) p.g.visible = s >= p.min && s <= p.max;
  u.roofSolar.visible = u.solarOwned && s >= 2;
}

export function setHomeItems(home, ids) {
  const u = home.userData; if (!u || !u.itemGroups) return;
  const list = Array.isArray(ids) ? ids : [];
  for (const id of ITEM_IDS) u.itemGroups[id].visible = list.includes(id);
  u.solarOwned = list.includes('solar');
  u.roofSolar.visible = u.solarOwned && u.stage >= 2;
}

export function updateHome(home, t, dt) {
  const u = home.userData; if (!u || !u.anim) return;
  U.time.value = t;
  mats().neon.color.setScalar(0.88 + 0.12 * Math.sin(t * 2.4) + 0.04 * Math.sin(t * 7.1));
  for (const a of u.anim) if (isVis(a.g)) a.fn(t, dt || 0.016);
  animFlags(u.ctx, t);
}

// Optional: frees the GPU buffers of a home that is no longer used (materials and textures are shared).
export function disposeHome(home) {
  home.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
  if (home.parent) home.parent.remove(home);
}
