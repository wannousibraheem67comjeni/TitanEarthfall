// Hopinet backdrop: everything the player sees beyond the road and its roadside props (module "backdrop.js").
//
//  * makeBackdrop(world, { quality, lobby })  -> Group that follows the camera (x/z) and contains
//      - a gradient sky dome (sun disc + glow, horizon haze, per-world dusk/aurora tweaks),
//      - stars (night worlds), soft cartoon cumulus clouds that drift, optional aurora ribbons,
//      - an animated sea disc reaching the horizon at y = SEA_Y (waves, foam, sun glitter, sky reflection,
//        shore shallows) whose haze blends into world.fog,
//      - hand-built distant scenery rings per world (mountains/dunes/ice ranges, lighthouse, cranes,
//        villages, skyline + lit bridge, palm islets, karst towers, waterfalls, giant trees, glaciers,
//        icebergs, pyramids, minarets, oasis ...), all baked into a few vertex-coloured meshes,
//      - world-anchored seagulls and boats/ice floes that you actually run past.
//  * makeWaterTile(world, len)  -> the swimmable translucent water surface + lit sea floor with caustics
//      + lane buoy chains for one track tile.
//  * setWaterTime(t)  -> advances the shared time uniform of every sea / water material.
//  * makeBackdrop(...).userData = { update(t, camera), dispose(), quality } (dispose frees geometries/materials).
//
// Everything is procedural (no files).  Distant meshes are fog-immune (they carry their own baked haze);
// the sky and the sea use dedicated shaders.  Draw calls: ~16-22 (budget 40); water tile: 3 (budget 4).
// Composition note: the camera looks toward -Z with a 35-100 degree window, so every world keeps its hero landmark
// within +-45 degrees of straight ahead, and the whole 360 degree ring (also behind the player) is filled.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SEA_Y, WATER_Y, GROUND_HALF } from './config.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const TIME = { value: 0 };
export function setWaterTime(t) { TIME.value = t; }

// ------------------------------------------------------------------------------------------ utils
function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const C = (h) => new THREE.Color(h);
const mixC = (a, b, t) => C(a).lerp(C(b), t);
// Direction (unit vector) from azimuth (deg, 0 = straight ahead -Z, + = right) and elevation (deg).
function dirOf(azDeg, elDeg) {
  const a = azDeg * DEG, e = elDeg * DEG;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}
// Smooth periodic function of the azimuth theta (harmonics with integer wave numbers) in 0..1.
function ringFn(seed, kmin, kmax, n, falloff = 0.8) {
  const r = rngOf(seed);
  const ks = [], am = [], ph = [];
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(lerp(kmin, kmax, r()));
    ks.push(k); const a = 1 / Math.pow(k, falloff); am.push(a); ph.push(r() * TAU); norm += a;
  }
  return (th) => { let s = 0; for (let i = 0; i < n; i++) s += am[i] * Math.sin(ks[i] * th + ph[i]); return 0.5 + 0.5 * Math.tanh((s / norm) * 2.1); };
}
const mat4 = new THREE.Matrix4(), qtmp = new THREE.Quaternion(), etmp = new THREE.Euler(), vtmp = new THREE.Vector3(), stmp = new THREE.Vector3();
// Matrix from position, Y rotation (+ optional X/Z) and scale.
function T(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  etmp.set(rx, ry, rz, 'YXZ'); qtmp.setFromEuler(etmp);
  return new THREE.Matrix4().compose(vtmp.set(x, y, z), qtmp, stmp.set(sx, sy, sz));
}
// Place on the scenery ring: radius R, azimuth theta (radians, 0 = ahead, + = right), y, facing the centre.
function ringPos(R, th, y, ry = 0, sx = 1, sy = sx, sz = sx) {
  return T(Math.sin(th) * R, y, -Math.cos(th) * R, -th + ry, sx, sy, sz);
}

// ------------------------------------------------------------------------------------------ batches
// Geometry collected per bucket, vertex-coloured on the CPU (lighting + haze baked), merged to one mesh.
const SPECS = {
  solid: { uv: false, rgba: false, lit: true },
  glow: { uv: false, rgba: false, lit: false },
  halo: { uv: true, rgba: false, lit: false },
  win: { uv: true, rgba: false, lit: false },
  mist: { uv: false, rgba: true, lit: false },
};
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();

class Batch {
  constructor(ctx) { this.ctx = ctx; this.parts = {}; }
  // o: { color | fn(p, n, i) -> Color, R (ring radius for haze), haze, mist, mistH, amb, dif, alpha, k (colour scale) }
  add(bucket, geo, m, o = {}) {
    const spec = SPECS[bucket], ctx = this.ctx;
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) {
      if (k === 'position' || (k === 'normal' && spec.lit) || (k === 'uv' && spec.uv)) continue;
      g.deleteAttribute(k);
    }
    if (spec.lit && !g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal;
    const cnt = pos.count, comps = spec.rgba ? 4 : 3;
    const col = new Float32Array(cnt * comps);
    const base = o.color !== undefined ? (o.color.isColor ? o.color : C(o.color)) : null;
    const haze = o.haze !== undefined ? o.haze : ctx.hazeAt(o.R || 300);
    const amb = o.amb ?? ctx.amb, dif = o.dif ?? ctx.dif, L = ctx.L;
    for (let i = 0; i < cnt; i++) {
      _p.fromBufferAttribute(pos, i);
      if (nor) _n.fromBufferAttribute(nor, i);
      const c = o.fn ? o.fn(_p, nor ? _n : null, i) : base;
      _c.copy(c);
      if (spec.lit) {
        const l = amb + dif * Math.max(0, _n.dot(L)) + 0.10 * _n.y;
        _c.multiplyScalar(l * (o.k ?? 1));
      } else if (o.k) _c.multiplyScalar(o.k);
      if (spec.lit || o.hazeAll) {
        let hz = haze;
        if (o.mist) hz += o.mist * Math.exp(-Math.max(0, _p.y - SEA_Y) / (o.mistH || 40));
        _c.lerp(ctx.fogC, clamp(hz, 0, 1));
      }
      col[i * comps] = _c.r; col[i * comps + 1] = _c.g; col[i * comps + 2] = _c.b;
      if (spec.rgba) col[i * 4 + 3] = o.alphaFn ? o.alphaFn(_p, i) : (o.alpha ?? 1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, comps));
    (this.parts[bucket] || (this.parts[bucket] = [])).push(g);
  }
  merged(bucket) {
    const list = this.parts[bucket];
    if (!list || !list.length) return null;
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    return g;
  }
}

// ------------------------------------------------------------------------------------------ geometry kit
const kit = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  // box standing on y = 0
  bbox: (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0),
  cyl: (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s, 1).translate(0, h / 2, 0),
  cone: (r, h, s = 10) => new THREE.ConeGeometry(r, h, s, 1).translate(0, h / 2, 0),
  sph: (r, ws = 10, hs = 7) => new THREE.SphereGeometry(r, ws, hs),
  ico: (r, d = 1) => new THREE.IcosahedronGeometry(r, d),
  plane: (w, h) => new THREE.PlaneGeometry(w, h),
};

// ------------------------------------------------------------------------------------------ GLSL
const NOISE_GLSL = `
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm2(vec2 p){ return vnoise(p) * 0.6 + vnoise(p * 2.07 + 11.3) * 0.3 + vnoise(p * 4.1 + 3.7) * 0.1; }
`;

const SKY_GLSL = `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uFogCol; uniform vec3 uSunCol; uniform vec3 uSunCol2;
uniform vec3 uGlowCol; uniform vec3 uSunDir;
uniform vec4 uSunP;   // x disc radius (rad), y glow gain, z horizon glow gain, w stripes (neon sun)
uniform vec3 uSunQ;   // x halo ring gain, y sky gradient rate, z dusk darkening of the zenith
vec3 skyGrad(vec3 d) {
  float e = max(d.y, 0.0);
  float t = 1.0 - exp(-e * uSunQ.y);
  vec3 c = mix(uHorizon, uZenith, pow(t, 0.9));
  c = mix(uFogCol, c, smoothstep(0.0, 0.05, e));
  return c;
}
vec3 skyGlow(vec3 d) {
  float sd = max(dot(d, uSunDir), 0.0);
  float e = max(d.y, 0.0);
  vec3 g = uGlowCol * (pow(sd, 5.0) * 0.20 + pow(sd, 34.0) * 0.30 + pow(sd, 300.0) * 0.45) * uSunP.y;
  float az = max(dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz)), 0.0);
  g += uGlowCol * pow(az, 3.0) * exp(-e * 10.0) * 0.42 * uSunP.z;
  return g;
}
`;

// ------------------------------------------------------------------------------------------ per-world look
// Sun / sky character.  az: degrees from straight ahead (+ right), el: elevation.  rad: disc radius (deg).
const LOOK = {
  harbor: { az: -9, el: 15, rad: 2.6, sun: 0xfff3b0, sun2: 0xffe18c, glow: 0xffe2a0, glowK: 0.7, hglow: 0.35, rate: 4.0, cloud: [0xffffff, 0xbdd1ee], cloudN: 24, hazeK: 1.0, amb: 0.62, dif: 0.48 },
  neon: { az: 7, el: 5, rad: 7.5, sun: 0xffe27a, sun2: 0xff2f9e, glow: 0xff7ac0, glowK: 1.35, hglow: 1.25, rate: 3.2, stripes: 1, cloud: [0xffb89a, 0x6a3a96], cloudN: 20, hazeK: 1.0, amb: 0.50, dif: 0.55, stars: true },
  coral: { az: -8, el: 15, rad: 2.5, sun: 0xfff3b4, sun2: 0xffe392, glow: 0xffe6a8, glowK: 0.7, hglow: 0.4, rate: 4.2, cloud: [0xffffff, 0xbfdaf0], cloudN: 22, hazeK: 0.9, amb: 0.64, dif: 0.46 },
  jungle: { az: 11, el: 12, rad: 3.4, sun: 0xfff6c0, sun2: 0xffe9a0, glow: 0xfff0b0, glowK: 0.9, hglow: 0.55, rate: 3.6, cloud: [0xf8fff4, 0xa8ccb8], cloudN: 24, hazeK: 0.95, amb: 0.60, dif: 0.45 },
  frost: { az: -10, el: 9, rad: 2.3, sun: 0xfffdf0, sun2: 0xfff0d0, glow: 0xdff0ff, glowK: 0.8, hglow: 0.5, rate: 4.0, halo: 1, cloud: [0xffffff, 0xb4cdee], cloudN: 18, hazeK: 1.1, amb: 0.64, dif: 0.46, aurora: true },
  dunes: { az: 6, el: 8, rad: 4.0, sun: 0xfff3d2, sun2: 0xffe0a0, glow: 0xffc27a, glowK: 1.25, hglow: 0.95, rate: 3.6, cloud: [0xfff4e0, 0xd8a890], cloudN: 14, hazeK: 0.95, amb: 0.56, dif: 0.62 },
};

// ------------------------------------------------------------------------------------------ textures
let _cloudTex = null, _haloTex = null, _winTex = null;

function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const W = 512, H = 256, cw = 256, ch = 128, S = 0.5;     // atlas of 4 cells, drawn in a 512x256 design space
  const data = new Uint8Array(W * H * 4);
  const r = rngOf(4242);
  const A = document.createElement('canvas'); A.width = cw; A.height = ch;
  const Lc = document.createElement('canvas'); Lc.width = cw; Lc.height = ch;
  const a = A.getContext('2d', { willReadFrequently: true }), l = Lc.getContext('2d', { willReadFrequently: true });
  for (let cell = 0; cell < 4; cell++) {
    a.setTransform(1, 0, 0, 1, 0, 0); l.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'source-over'; a.clearRect(0, 0, cw, ch); l.clearRect(0, 0, cw, ch);
    a.setTransform(S, 0, 0, S, 0, 0); l.setTransform(S, 0, 0, S, 0, 0);
    const n = 15 + cell * 2, blobs = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), prof = Math.sin(t * Math.PI);
      const rad = 20 + prof * (24 + r() * 20) * (cell === 3 ? 0.85 : 1) + r() * 8;
      const x = 66 + t * 380 + (r() - 0.5) * 24;
      const y = 196 - rad * 0.45 - prof * (14 + r() * 26) * (cell === 2 ? 1.5 : 1);
      blobs.push({ x, y, rad });
    }
    const blobGrad = (g, x, y, rad, c0, c1) => {
      const gr = g.createRadialGradient(x, y, rad * 0.05, x, y, rad);
      gr.addColorStop(0, c0); gr.addColorStop(0.8, c0); gr.addColorStop(1, c1);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    };
    for (const b of blobs) blobGrad(a, b.x, b.y, b.rad, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    // flat-ish underside: fade the coverage below the base line
    a.globalCompositeOperation = 'destination-out';
    const fade = a.createLinearGradient(0, 190, 0, 222); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    a.fillStyle = fade; a.fillRect(0, 190, 512, 70);
    // light layer: smaller, shifted up blobs = the sunlit tops
    for (const b of blobs) blobGrad(l, b.x - 4, b.y - b.rad * 0.26, b.rad * 0.8, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    const ad = a.getImageData(0, 0, cw, ch).data, ld = l.getImageData(0, 0, cw, ch).data;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        const lit = clamp(ld[i + 3] / 255 + (1 - y / ch) * 0.25, 0, 1);
        const sh = 0.76 + 0.24 * lit;              // shaded base -> lit top (multiplies the vertex colour)
        const ox = (cell % 2) * cw + x, oy = H - 1 - ((cell >> 1) * ch + y);   // DataTexture rows start at the bottom
        const o = (oy * W + ox) * 4;
        data[o] = 255 * sh; data[o + 1] = 255 * sh; data[o + 2] = 255 * (0.92 + 0.08 * sh);
        data[o + 3] = ad[i + 3];
      }
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 2; t.needsUpdate = true;
  return (_cloudTex = t);
}

function haloTexture() {
  if (_haloTex) return _haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.12, '#c8c8c8'); gr.addColorStop(0.35, '#4a4a4a'); gr.addColorStop(0.7, '#0c0c0c'); gr.addColorStop(1, '#000000');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _haloTex = new THREE.CanvasTexture(c);
  _haloTex.colorSpace = THREE.NoColorSpace;
  return _haloTex;
}

function windowTexture() {
  if (_winTex) return _winTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
  const r = rngOf(909);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) {
    const on = r();
    if (on < 0.46) continue;
    const v = Math.floor(120 + 135 * r());
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x * 16 + 3, y * 8 + 2, 10, 4);
  }
  _winTex = new THREE.CanvasTexture(c);
  _winTex.colorSpace = THREE.NoColorSpace;
  _winTex.wrapS = _winTex.wrapT = THREE.RepeatWrapping;
  _winTex.anisotropy = 4;
  return _winTex;
}


// ------------------------------------------------------------------------------------------ shared sky uniforms
function makeSkyUniforms(world, look, sunDir) {
  const zen = C(world.sky[0]), hor = C(world.sky[1]);
  return {
    uZenith: { value: zen }, uHorizon: { value: hor }, uFogCol: { value: C(world.fog) },
    uSunCol: { value: C(look.sun) }, uSunCol2: { value: C(look.sun2) }, uGlowCol: { value: C(look.glow) },
    uSunDir: { value: sunDir.clone() },
    uSunP: { value: new THREE.Vector4(look.rad * DEG, look.glowK, look.hglow, look.stripes ? 1 : 0) },
    uSunQ: { value: new THREE.Vector3(look.halo ? 1 : 0, look.rate, 0) },
  };
}

function makeSkyDome(skyU) {
  const mat = new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float;
varying vec3 vDir;
${NOISE_GLSL}
${SKY_GLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyGrad(d) + skyGlow(d);
  float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  float below = smoothstep(-0.004, 0.006, d.y);
  float r = uSunP.x;
  float disc = 1.0 - smoothstep(r * 0.95, r, ang);
  float v = clamp((d.y - uSunDir.y) / r, -1.0, 1.0);
  vec3 sc = mix(uSunCol2, uSunCol, smoothstep(-0.9, 0.9, v));
  float mask = 1.0;
  if (uSunP.w > 0.5) {
    float k = 0.25 - v;
    float gap = clamp(k * 0.32, 0.0, 0.62);
    float s = fract(v * 5.5);
    mask = k > 0.0 ? smoothstep(gap - 0.02, gap + 0.04, s) : 1.0;
  }
  col += uSunCol * exp(-pow(ang / (r * 1.9), 2.0)) * 0.30 * below;
  col = mix(col, sc * 1.12, disc * below * mask);
  float ring = exp(-pow((ang - 0.215) / 0.02, 2.0)) * uSunQ.x;
  col += vec3(1.0, 0.97, 0.9) * ring * 0.16 * below;
  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 40, 24), mat);
  m.renderOrder = -100; m.frustumCulled = false;
  return m;
}

function makeStars(world, low, rnd) {
  const n = low ? 160 : 380;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const el = (4 + Math.pow(rnd(), 0.7) * 62) * DEG, az = rnd() * TAU;
    pos[i * 3] = Math.sin(az) * Math.cos(el) * 900; pos[i * 3 + 1] = Math.sin(el) * 900; pos[i * 3 + 2] = -Math.cos(az) * Math.cos(el) * 900;
    size[i] = 1.3 + rnd() * rnd() * 3.2; ph[i] = rnd() * TAU;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const px = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uPx: { value: Math.min(2, px) }, uTwinkle: { value: low ? 0 : 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uPx; uniform float uTwinkle; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float tw = 0.65 + 0.35 * sin(uTime * 2.3 + aPhase * 3.0) * uTwinkle + 0.35 * (1.0 - uTwinkle);
  float el = position.y / 900.0;
  vA = smoothstep(0.05, 0.22, el) * tw; gl_PointSize = aSize * uPx * (0.85 + 0.25 * tw); }`,
    fragmentShader: `varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(vec3(1.0, 0.92, 1.0) * a, a);
#include <colorspace_fragment>
}`,
  });
  const m = new THREE.Points(g, mat);
  m.renderOrder = -99; m.frustumCulled = false;
  return m;
}

function makeClouds(world, look, ctx, rnd, n) {
  const R = 720, geos = [];
  const lit = C(look.cloud[0]), shade = C(look.cloud[1]);
  const positions = [], uvs = [], colors = [], idx = [];
  for (let i = 0; i < n; i++) {
    const th = ((i + rnd() * 0.8) / n) * TAU - Math.PI;
    const el = lerp(3.5, 24, Math.pow(rnd(), 1.25)) * DEG;
    const w = lerp(190, 330, rnd()) * (1.1 - 0.5 * el / (24 * DEG)) * (world.id === 'jungle' ? 1.2 : 1);
    const h = w * lerp(0.42, 0.58, rnd());
    const cy = Math.tan(el) * R;
    const cx = Math.sin(th) * R, cz = -Math.cos(th) * R;
    const rx = Math.cos(th), rz = Math.sin(th);
    const cell = Math.floor(rnd() * 4), u0 = (cell % 2) * 0.5, v0 = 1 - ((cell >> 1) + 1) * 0.5;
    const flip = rnd() < 0.5 ? -1 : 1;
    // colours: sun-facing clouds are warmer, low ones sink into the haze
    const sunDot = Math.max(0, ctx.sunDir.x * Math.sin(th) - ctx.sunDir.z * Math.cos(th)) ;
    const warm = Math.pow(sunDot / Math.max(1e-3, Math.hypot(ctx.sunDir.x, ctx.sunDir.z)), 3);
    const hz = clamp(0.55 - (el / DEG - 3.5) * 0.05, 0.0, 0.55);
    const top = lit.clone().lerp(C(look.glow), warm * 0.45).lerp(ctx.fogC, hz);
    const bot = shade.clone().lerp(C(look.glow), warm * 0.25).lerp(ctx.fogC, hz);
    const base = positions.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of corners) {
      positions.push(cx + rx * sx * w / 2, cy + sy * h / 2, cz + rz * sx * w / 2);
      uvs.push(u0 + (flip * sx * 0.5 + 0.5) * 0.5, v0 + (sy * 0.5 + 0.5) * 0.5);
      const c = sy > 0 ? top : bot;
      colors.push(c.r, c.g, c.b);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: cloudTexture(), vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, opacity: 0.96 });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = -98; m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------------------------------ the sea
const SEA_WAVES = [ // direction (deg), wavelength (m), slope, speed factor
  [20, 24, 0.075, 0.55], [-38, 12.5, 0.10, 0.62], [78, 6.2, 0.11, 0.7], [-12, 3.4, 0.09, 0.8], [145, 1.8, 0.07, 0.95],
];
function waveGLSL(count) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const [a, L, sl, sp] = SEA_WAVES[i];
    const k = TAU / L, w = Math.sqrt(9.8 * k) * sp;
    s += `wv(p, vec2(${(Math.cos(a * DEG) * k).toFixed(4)}, ${(Math.sin(a * DEG) * k).toFixed(4)}), ${w.toFixed(4)}, ${sl.toFixed(4)}, ${k.toFixed(4)}, dist, g, hs);\n`;
  }
  return s;
}

function makeSea(world, ctx, skyU) {
  const low = ctx.low;
  const land = GROUND_HALF[world.id] ?? 16;
  const lagoon = world.id === 'coral' ? 1 : world.id === 'dunes' ? 0.6 : 0;
  const uniforms = Object.assign({
    uTime: TIME,
    uShallow: { value: C(world.sea.shallow) }, uDeep: { value: C(world.sea.deep) }, uFoam: { value: C(world.sea.foam) },
    uLandHalf: { value: ctx.lobby ? 15 : land }, uShoreMode: { value: ctx.lobby ? 1 : 0 },
    uFogNear: ctx.fogU.near, uFogFar: ctx.fogU.far, uHaze: { value: 0.95 },
    uLagoon: { value: lagoon },
  }, skyU);
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: false, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vW; varying float vDepth;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `precision highp float;
${low ? '#define LOW 1' : ''}
uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam;
uniform float uLandHalf; uniform float uShoreMode; uniform float uFogNear; uniform float uFogFar; uniform float uHaze; uniform float uLagoon;
varying vec3 vW; varying float vDepth;
${NOISE_GLSL}
${SKY_GLSL}
void wv(vec2 p, vec2 k, float w, float s, float kk, float dist, inout vec2 g, inout float hs) {
  float f = exp(-dist * kk * 0.012);
  float ph = dot(p, k) + uTime * w;
  g += (k / kk) * (s * f * cos(ph));
  hs += (s / kk) * f * sin(ph);
}
void main(){
  vec3 Vv = cameraPosition - vW;
  float dist = length(Vv);
  vec3 V = Vv / dist;
  vec2 p = vW.xz;
  vec2 g = vec2(0.0); float hs = 0.0;
  ${waveGLSL(low ? 3 : 5)}
  vec3 n = vec3(-g.x, 1.0, -g.y);
  #ifndef LOW
  float dn = 1.0 - smoothstep(25.0, 130.0, dist);
  vec2 q = p * 1.3 + vec2(uTime * 0.30, -uTime * 0.18);
  float e = 0.15;
  float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0.0)), nz = vnoise(q + vec2(0.0, e));
  n.xz -= vec2(nx - n0, nz - n0) / e * 0.10 * dn;
  #endif
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(120.0, 520.0, dist) * 0.85));

  float sd = uShoreMode > 0.5 ? length(p) - uLandHalf : abs(p.x) - uLandHalf;
  float deepF = smoothstep(-2.0, 46.0, sd);
  #ifndef LOW
  float lg = vnoise(p * 0.012 + 3.0) * 0.65 + vnoise(p * 0.03) * 0.35;
  deepF *= 1.0 - uLagoon * smoothstep(0.52, 0.72, lg) * 0.75;
  #endif
  vec3 body = mix(uShallow, uDeep, deepF);
  float crestH = clamp(hs * 3.2 + 0.5, 0.0, 1.0);
  body *= 0.82 + 0.36 * crestH;
  body = mix(body, uShallow * 1.08, smoothstep(0.55, 1.0, crestH) * 0.28 * (1.0 - smoothstep(30.0, 160.0, dist)));

  vec3 R = reflect(-V, n); R.y = abs(R.y);
  vec3 refl = skyGrad(R) + skyGlow(R);
  float fres = 0.03 + 0.62 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 col = mix(body, refl, fres);

  // foam: wind crests + shore wash
  float foam = 0.0;
  float near = 1.0 - smoothstep(30.0, 150.0, dist);
  #ifndef LOW
  float fn = vnoise(p * 0.8 + vec2(uTime * 0.10, uTime * 0.06));
  foam += smoothstep(0.55, 0.95, crestH) * smoothstep(0.50, 0.80, fn) * near * 0.85;
  #endif
  float shore = 1.0 - smoothstep(0.0, 16.0, sd);
  float lines = smoothstep(0.60, 0.97, sin(sd * 0.85 - uTime * 0.75 + vnoise(p * 0.12) * 5.0)) * (1.0 - smoothstep(60.0, 240.0, dist));
  float onSea = smoothstep(-0.3, 0.6, sd);
  foam += (shore * lines * 0.55 + (1.0 - smoothstep(0.0, 1.8, sd)) * 0.65) * onSea;
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.85);

  float fogF = smoothstep(uFogNear, uFogFar, vDepth) * uHaze;
  fogF = max(fogF, smoothstep(500.0, 1100.0, dist));
  col = mix(col, uFogCol, min(1.0, fogF));

  // sun glitter (added after the haze so the path of light survives to the horizon)
  float sdl = max(dot(R, uSunDir), 0.0);
  float lobe = pow(sdl, 160.0) + 0.30 * pow(sdl, 22.0);
  #ifndef LOW
  float sp = 0.45 + 1.1 * smoothstep(0.55, 0.9, vnoise(p * 2.6 + vec2(uTime * 0.6, uTime * 0.35)));
  lobe *= mix(0.9, sp, 1.0 - smoothstep(40.0, 240.0, dist));
  #endif
  col += uSunCol * lobe * (1.0 - fogF * 0.45) * 1.15 * uSunP.y;
  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  });
  const geo = new THREE.CircleGeometry(1150, 72).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = SEA_Y; m.renderOrder = -90; m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------------------------------ ranges & walls
// A mountain / hill / dune range wrapped around the camera as a polar height field.
//  o: R (radius of the crest line), W (half depth), amp, fn(theta)->0..1, p (profile power), crag (jaggedness),
//     N (columns), colorFn(p, n, hf, th), haze, mist, mistH, base
function addRange(B, o) {
  const N = Math.round((o.N || 200) * (B.ctx.low ? 0.62 : 1));
  const us = o.us || [-1, -0.74, -0.5, -0.28, -0.1, 0.1, 0.4, 0.8];
  const rows = us.length, base = o.base ?? SEA_Y - 1.2;
  const pos = new Float32Array(N * rows * 3);
  const cr = o.crag || 0, p = o.p || 1.3;
  for (let i = 0; i < N; i++) {
    const th = -Math.PI + (i / N) * TAU;
    const hgt = o.amp * (o.fn ? o.fn(th) : 1);
    for (let j = 0; j < rows; j++) {
      const u = us[j], shape = Math.pow(Math.max(0, 1 - Math.abs(u)), p);
      const jag = cr * o.amp * shape * (0.55 * Math.sin(th * 71 + u * 13) + 0.35 * Math.sin(th * 137 + 2 + u * 7) + 0.25 * Math.sin(th * 263 + u * 29));
      let y = base + (o.toe ?? 1.2) + hgt * shape + jag;
      if (j === 0) y = base;
      const r = o.R + o.W * u;
      const k = (i * rows + j) * 3;
      pos[k] = Math.sin(th) * r; pos[k + 1] = y; pos[k + 2] = -Math.cos(th) * r;
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j, b = i2 * rows + j, c = i * rows + j + 1, d = i2 * rows + j + 1;
      // winding so that the surface normal points up / toward the centre
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // verify the winding (normal.y of a top-ish vertex should be positive)
  const nrm = g.attributes.normal; let sy = 0;
  for (let i = 0; i < N * rows; i += rows) sy += nrm.getY(i + Math.floor(rows / 2));
  if (sy < 0) { const ia = g.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; } g.computeVertexNormals(); }
  const colFn = o.colorFn;
  const cc = new THREE.Color();
  B.add('solid', g, null, {
    R: o.R, haze: o.haze, mist: o.mist, mistH: o.mistH, amb: o.amb, dif: o.dif,
    fn: (pp, nn) => colFn(pp, nn, (pp.y - base) / Math.max(1, o.amp), Math.atan2(pp.x, -pp.z), cc),
  });
  // height of the surface at azimuth th and distance r from the centre
  return (th, r) => {
    const u = clamp((r - o.R) / o.W, -1, 1);
    const shape = Math.pow(Math.max(0, 1 - Math.abs(u)), p);
    return base + (o.toe ?? 1.2) + o.amp * (o.fn ? o.fn(th) : 1) * shape;
  };
}


// Composite item placed on the ring: item.add(bucket, geo, localMatrix, opts)
function Item(B, R, th, y, s = 1, ry = 0) {
  const M0 = ringPos(R, th, y, ry, s, s, s);
  return {
    add(bucket, geo, lm, o = {}) { B.add(bucket, geo, lm ? M0.clone().multiply(lm) : M0, { R, ...o }); },
    pos: new THREE.Vector3(Math.sin(th) * R, y, -Math.cos(th) * R),
  };
}
// Flat foam / shallows ring on the sea around a toe line (additive, haze baked)
function addFoamRing(B, R, w, o = {}) {
  const g = new THREE.RingGeometry(R - w, R + w * 0.25, 120, 1).rotateX(-Math.PI / 2).translate(0, SEA_Y + 0.06, 0);
  const rf = ringFn(o.seed || 21, 8, 40, 5, 0.3);
  const col = C(o.color ?? 0xffffff);
  B.add('glow', g, null, {
    R, k: o.k ?? 0.5,
    fn: (p) => { const r = Math.hypot(p.x, p.z), th = Math.atan2(p.x, -p.z); const t = clamp((r - (R - w)) / (w * 1.25), 0, 1); const prof = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.6)), 2); return col.clone().multiplyScalar(prof * (0.35 + 0.65 * rf(th))); },
    haze: o.haze ?? ctxHaze(B, R), hazeAll: true,
  });
}
const ctxHaze = (B, R) => B.ctx.hazeAt(R) * 0.7;

function addFoamAt(B, x, z, r, w, o = {}) {
  const g = new THREE.RingGeometry(r - w, r + w * 0.4, 28, 1).rotateX(-Math.PI / 2).translate(x, SEA_Y + 0.07, z);
  const col = C(o.color ?? 0xffffff), R = Math.hypot(x, z);
  B.add('glow', g, null, {
    R, k: o.k ?? 0.55, haze: B.ctx.hazeAt(R) * 0.6, hazeAll: true,
    fn: (p) => { const t = clamp((Math.hypot(p.x - x, p.z - z) - (r - w)) / (w * 1.4), 0, 1); return col.clone().multiplyScalar(Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 2)); },
  });
}
// Soft coloured disc on the sea (lagoon / glow), normal-blended with a radial alpha falloff
function addSeaDisc(B, x, z, r, color, a, hazeK = 0.7, y = SEA_Y + 0.05) {
  const g = new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2).translate(x, y, z);
  const R = Math.hypot(x, z);
  B.add('mist', g, null, { color, haze: B.ctx.hazeAt(R) * hazeK, hazeAll: true, alphaFn: (p) => a * Math.pow(1 - clamp(Math.hypot(p.x - x, p.z - z) / r, 0, 1), 0.8) });
}
// wobbly rock / islet blob
function rockGeo(r, h, seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const rn = rngOf(seed), pa = g.attributes.position;
  const jit = new Map();
  for (let i = 0; i < pa.count; i++) {
    const k = pa.getX(i).toFixed(3) + pa.getY(i).toFixed(3) + pa.getZ(i).toFixed(3);
    if (!jit.has(k)) jit.set(k, 0.78 + rn() * 0.44);
    const j = jit.get(k);
    pa.setXYZ(i, pa.getX(i) * r * j, Math.max(pa.getY(i), -0.15) * h * j, pa.getZ(i) * r * j);
  }
  g.computeVertexNormals();
  return g;
}
// Palm tree pieces in local coordinates (trunk + crown), height h
function addPalm(it, x, y, z, h, lean, color, o = {}) {
  const trunkC = o.trunk ?? 0x8a6a46, leafC = color ?? 0x2f9a4a;
  const lx = Math.sin(lean) * 0.18 * h, segs = 3;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const g = new THREE.CylinderGeometry(h * 0.028 * (1.2 - t1 * 0.5), h * 0.028 * (1.2 - t0 * 0.5), h / segs * 1.08, 5)
      .translate(0, h / segs / 2, 0);
    it.add('solid', g, T(x + lx * t0 * t0 * 2, y + h * t0, z, 0, 1, 1, 1, 0, -lean * 0.4), { color: trunkC });
  }
  const cx = x + lx, cy = y + h * 0.99;
  const nL = o.leaves ?? 7;
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * TAU + x * 3.1;
    const g = new THREE.ConeGeometry(h * 0.085, h * 0.5, 4).translate(0, h * 0.25, 0);
    // leaf: lean outward and droop
    const m = T(cx, cy, z, a, 1, 1, 0.55, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(-1.25 - (i % 2) * 0.25));
    it.add('solid', g, m, { color: i % 2 ? leafC : mixC(leafC, 0xb8e060, 0.25) });
  }
}

// Soft haze / mist wall around the ring (RGBA vertex colours, transparent).
function addMist(B, o) {
  const g = new THREE.CylinderGeometry(o.R, o.R, o.h, 96, 1, true).translate(0, (o.y0 ?? SEA_Y) + o.h / 2, 0);
  const rf = ringFn(o.seed || 5, 3, 14, 4);
  const y0 = o.y0 ?? SEA_Y;
  B.add('mist', g, null, {
    color: o.color,
    alphaFn: (p) => { const t = (p.y - y0) / o.h; const th = Math.atan2(p.x, -p.z); return o.a * Math.pow(1 - t, o.pw || 1.4) * (o.var === 0 ? 1 : (1 - (o.var ?? 0.5)) + (o.var ?? 0.5) * rf(th)); },
  });
}

// Camera-facing (towards the centre) glow quad for lights / sun glints in the 'halo' bucket.
function addHalo(B, R, th, y, size, color, k = 1) {
  const g = new THREE.PlaneGeometry(size, size);
  B.add('halo', g, ringPos(R, th, y), { color, k });
}


// ------------------------------------------------------------------------------------------ materials of the batches
function bucketMesh(name, geo, order) {
  let mat;
  const common = { vertexColors: true, fog: false, side: THREE.DoubleSide };
  if (name === 'solid') mat = new THREE.MeshBasicMaterial(common);
  else if (name === 'mist') mat = new THREE.MeshBasicMaterial({ ...common, transparent: true, depthWrite: false });
  else {
    mat = new THREE.MeshBasicMaterial({ ...common, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    if (name === 'halo') mat.map = haloTexture();
    if (name === 'win') mat.map = windowTexture();
  }
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = order;
  return m;
}
const BUCKET_ORDER = { solid: -80, mist: -70, win: -69, glow: -68, halo: -67 };

const SCENERY = {};      // world id -> (ctx, B) filling the batches
const DYNAMICS = {};     // world id -> (ctx) -> array of { object, update(t, camPos) }


// ------------------------------------------------------------------------------------------ boats (shared by static scenery + instanced dynamics)
function hullGeo(plan, depth, bevel = 0.14) {
  const sh = new THREE.Shape();
  plan.forEach(([x, y, cx, cy], i) => {
    if (i === 0) sh.moveTo(x, y); else if (cx !== undefined) sh.quadraticCurveTo(cx, cy, x, y); else sh.lineTo(x, y);
  });
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);           // shape +y (bow) -> -z, extrusion -> up
  return g;
}
function triGeo(a, b, c, billow = 0) {
  const m = [(a[0] + b[0] + c[0]) / 3 + billow, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const v = [...a, ...b, ...m, ...b, ...c, ...m, ...c, ...a, ...m];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
// pieces: [geometry, matrix, colour]  (bow towards -Z, origin on the waterline)
function boatPieces(kind, pal = {}) {
  const P = [];
  const add = (g, m, c) => P.push({ g, m: m || new THREE.Matrix4(), c: C(c) });
  const hull = pal.hull ?? 0xe8eef6, sail = pal.sail ?? 0xffffff, trim = pal.trim ?? 0x2f80ed, cabin = pal.cabin ?? 0xf4f4f0;
  if (kind === 'sail') {
    add(hullGeo([[0, 4.8], [1.6, 2.2, 1.9, 3.6], [1.6, -1.8], [1.25, -4.3], [-1.25, -4.3], [-1.6, -1.8], [-1.6, 2.2], [0, 4.8, -1.9, 3.6]], 0.9, 0.16), T(0, -0.35, 0), hull);
    add(kit.bbox(2.6, 0.18, 8.2), T(0, 0.74, 0.1), 0xd9b98a);                         // deck
    add(kit.bbox(1.9, 0.95, 2.6), T(0, 0.8, 1.4), cabin);
    add(kit.bbox(2.1, 0.12, 2.8), T(0, 1.72, 1.4), trim);
    add(new THREE.BoxGeometry(3.3, 0.22, 9.0).translate(0, 0.45, 0.1), null, trim);   // coloured stripe (wider than the hull top)
    add(kit.cyl(0.09, 0.12, 13, 5), T(0, 0.8, -0.7), 0xd8d8d8);
    add(triGeo([0, 1.7, -0.9], [0.0, 1.7, 3.5], [0, 12.6, -0.9], 0.35), null, sail);
    add(triGeo([0, 1.1, -4.6], [0, 11.8, -1.0], [0, 1.5, -1.0], 0.28), null, mixC(sail, 0xdfe9f7, 0.5));
    add(kit.bbox(0.12, 0.12, 4.3), T(0, 1.7, 1.2), 0xb8b8b8);
  } else if (kind === 'dhow') {
    add(hullGeo([[0, 5.8], [1.0, 3.0, 1.2, 4.6], [1.35, -2.0], [1.1, -5.0], [-1.1, -5.0], [-1.35, -2.0], [-1.0, 3.0], [0, 5.8, -1.2, 4.6]], 1.1, 0.14), T(0, -0.4, 0), pal.hull ?? 0x8a5a36);
    add(kit.bbox(2.9, 0.22, 10.4), T(0, 0.82, -0.1), mixC(pal.hull ?? 0x8a5a36, 0xe8c48a, 0.4));
    add(kit.bbox(2.4, 1.5, 2.2), T(0, 0.9, -4.3), pal.trim ?? 0xd8a24a);         // raised stern cabin (stern at -z after flip in instance rotation)
    add(triGeo([0, 1.6, 5.9], [0, 2.4, -4.8], [0, 13.5, 0.6], 0.3), null, sail);
    add(kit.box(0.14, 0.14, 12.3), T(0, 7.95, -2.1).multiply(new THREE.Matrix4().makeRotationX(-1.12)), 0x6a4a2a);
    add(kit.cyl(0.1, 0.13, 3.2, 5), T(0, 0.9, 1.0), 0x6a4a2a);
  } else if (kind === 'longtail') {
    add(hullGeo([[0, 4.8], [0.7, 2.5, 0.8, 4.0], [0.8, -2.0], [0.55, -4.2], [-0.55, -4.2], [-0.8, -2.0], [-0.7, 2.5], [0, 4.8, -0.8, 4.0]], 0.6, 0.1), T(0, -0.25, 0), pal.hull ?? 0xe8672a);
    add(kit.cone(1.5, 1.4, 6), T(0, 1.3, 0.6, 0, 1.15, 1, 1.4), pal.sail ?? 0xd8b25a);     // thatch canopy
    for (const x of [-0.6, 0.6]) add(kit.cyl(0.06, 0.06, 1.4, 4), T(x, 0.3, 0.6), 0x6a4a2a);
    add(kit.cyl(0.07, 0.07, 3.6, 4), T(0, 0.4, -3.6).multiply(new THREE.Matrix4().makeRotationX(-1.1)), 0x555555);  // engine pole
    for (const [i, c] of [0xff4f6a, 0xffd23f, 0x39c6ff].entries()) add(kit.bbox(0.12, 0.7, 0.12), T((i - 1) * 0.16, 0.5, 4.5), c);
  } else if (kind === 'trawler') {
    add(hullGeo([[0, 5.2], [1.6, 2.4, 1.9, 4.0], [1.7, -2.2], [1.4, -4.6], [-1.4, -4.6], [-1.7, -2.2], [-1.6, 2.4], [0, 5.2, -1.9, 4.0]], 1.3, 0.14), T(0, -0.5, 0), pal.hull ?? 0xd84a4a);
    add(kit.bbox(3.2, 0.2, 9.6), T(0, 0.88, 0), 0xe8e8e0);
    add(kit.bbox(2.6, 2.0, 2.6), T(0, 1.0, 1.9), 0xf4f4f0);
    add(kit.bbox(2.0, 0.9, 1.5), T(0, 2.9, 1.9), 0x4a6a8a);
    add(kit.cyl(0.4, 0.4, 2.2, 6), T(0, 3.8, 2.6), pal.trim ?? 0xffc21a);
    add(kit.cyl(0.1, 0.1, 6.5, 5), T(0, 1.0, -1.8), 0xb8b8b8);
    add(kit.bbox(0.12, 0.12, 4.0), T(0, 5.6, -0.4).multiply(new THREE.Matrix4().makeRotationX(-0.5)), 0xb8b8b8);
  } else if (kind === 'yacht') {
    add(hullGeo([[0, 6.0], [1.5, 2.4, 1.7, 4.6], [1.7, -3.0], [1.5, -5.6], [-1.5, -5.6], [-1.7, -3.0], [-1.5, 2.4], [0, 6.0, -1.7, 4.6]], 1.0, 0.16), T(0, -0.4, 0), pal.hull ?? 0xf4f4ff);
    add(kit.bbox(3.5, 0.14, 11.8), T(0, 0.72, 0), pal.trim ?? 0xff3df2);
    add(kit.bbox(2.8, 1.2, 5.0), T(0, 0.9, 0.8), 0xffffff);
    add(kit.bbox(2.4, 0.7, 4.4), T(0, 2.1, 0.6), 0x2a2a40);
    add(kit.bbox(2.6, 0.14, 4.6), T(0, 2.8, 0.6), pal.trim ?? 0xff3df2);
    add(kit.cyl(0.07, 0.07, 3.0, 5), T(0, 2.9, 1.4), 0xcccccc);
  } else if (kind === 'floe') {
    const g = new THREE.CylinderGeometry(1, 1.1, 0.7, 11, 1);
    const pa = g.attributes.position, rn = rngOf(pal.seed ?? 3);
    const jit = new Map();
    for (let i = 0; i < pa.count; i++) {
      const k = Math.round(Math.atan2(pa.getZ(i), pa.getX(i)) * 9) + '' + (pa.getY(i) > 0);
      if (!jit.has(k)) jit.set(k, 0.82 + rn() * 0.36);
      const j = jit.get(k); pa.setX(i, pa.getX(i) * j * 5); pa.setZ(i, pa.getZ(i) * j * 5.5);
    }
    g.computeVertexNormals();
    add(g, T(0, -0.1, 0), pal.hull ?? 0xeef8ff);
    add(kit.cone(1.5, 0.9, 7), T(0.9, 0.3, -0.5, 0.5, 1, 1, 1), 0xd8efff);
  }
  return P;
}
function boatGeometry(kind, pal) {
  const geos = [];
  for (const p of boatPieces(kind, pal)) {
    let g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    g.applyMatrix4(p.m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = p.c.r; col[i * 3 + 1] = p.c.g; col[i * 3 + 2] = p.c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  return mergeGeometries(geos, false);
}
function addBoat(it, kind, pal, lm) {
  for (const p of boatPieces(kind, pal)) it.add('solid', p.g, lm ? lm.clone().multiply(p.m) : p.m, { color: p.c });
}

// ------------------------------------------------------------------------------------------ colour helpers for ranges
const hillPatch = (th, y, f) => 0.5 + 0.5 * Math.sin(th * f + y * 0.21) * Math.sin(th * f * 1.7 + 2.0 - y * 0.13);

// ------------------------------------------------------------------------------------------ HARBOR
function village(B, hAt, R, W, th0, spread, count, rnd, walls, roofs, size = 1) {
  const kit1 = kit.bbox(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const th = th0 + (rnd() - 0.5) * spread;
    const r = R + W * (-0.78 + rnd() * 0.7);
    const y = hAt(th, r) - 0.6;
    if (y < SEA_Y + 2.5) continue;
    const w = (6 + rnd() * 5) * size, h = (4.5 + rnd() * 3.5) * size, d = (6 + rnd() * 4) * size;
    const it = Item(B, r, th, y, 1, (rnd() - 0.5) * 0.6);
    const wall = walls[Math.floor(rnd() * walls.length)], roof = roofs[Math.floor(rnd() * roofs.length)];
    it.add('solid', kit1, T(0, 0, 0, 0, w, h, d), { color: wall });
    it.add('solid', new THREE.ConeGeometry(0.72, 1, 4).translate(0, 0.5, 0), T(0, h, 0, Math.PI / 4, w * 1.12, h * 0.55, d * 1.12), { color: roof });
    if (rnd() < 0.35) it.add('solid', kit1, T(w * 0.3, h, -d * 0.2, 0, 1.2 * size, 2.4 * size, 1.2 * size), { color: 0xc8a888 });
  }
}

SCENERY.harbor = (ctx, B) => {
  const rn = rngOf(101), rnd = ctx.rnd;
  const sand = C(0xe8d9a8), g1 = C(0x4f9a46), g2 = C(0x8fcf6a), g3 = C(0xb9d86a), tmp = new THREE.Color();
  const green = (p, n, hf, th) => {
    if (hf < 0.045) return tmp.copy(sand);
    const k = hillPatch(th, p.y, 41);
    tmp.copy(g1).lerp(g2, clamp(hf * 1.6 + (k - 0.5) * 0.5, 0, 1));
    if (k > 0.82 && hf < 0.5) tmp.lerp(g3, 0.6);
    return tmp;
  };
  const blue = C(0x5f9fa8), blue2 = C(0x9cc9b8);
  addRange(B, { R: 450, W: 90, amp: 110, fn: ringFn(11, 2, 11, 5), p: 1.5, crag: 0.012, haze: 0.5, colorFn: (p, n, hf) => tmp.copy(blue).lerp(blue2, clamp(hf, 0, 1)) });
  const hAt = addRange(B, { R: 345, W: 70, amp: 52, fn: ringFn(23, 3, 18, 6), p: 1.35, crag: 0.015, colorFn: green });
  addFoamRing(B, 345 - 70 * 0.96, 3.0);
  // little villages on the near hills
  const walls = [0xfff1d6, 0xf6e3c0, 0xffd9b0, 0xf8f6f0, 0xe3edff], roofs = [0xd9573f, 0xc94a35, 0xb5472f, 0xe27a3f, 0x3c7fb5];
  for (const [th, spread, n] of [[-24, 0.45, 26], [38, 0.5, 26], [148, 0.5, 20], [-120, 0.45, 18], [88, 0.4, 14]]) village(B, hAt, 345, 70, th * DEG, spread, n, rn, walls, roofs);

  // ---- lighthouse islet (hero) ----
  {
    const it = Item(B, 300, 12 * DEG, SEA_Y, 1.35);
    it.add('solid', new THREE.CylinderGeometry(33, 36, 1.8, 18).translate(0, 0.2, 0), null, { color: 0xe8d9a8 });
    it.add('solid', rockGeo(26, 9, 5), T(0, 0.2, 0), { color: 0x80786a });
    it.add('solid', rockGeo(13, 5, 9), T(-18, 0.2, 9), { color: 0x6f695d });
    it.add('solid', rockGeo(10, 4, 11), T(20, 0.2, -6), { color: 0x6f695d });
    it.add('solid', kit.sph(14, 12, 6), T(0, 5.2, 0, 0, 1, 0.32, 1), { color: 0x72b35a });
    for (let i = 0; i < 4; i++) {
      const rb = lerp(4.6, 3.1, i / 4), rt = lerp(4.6, 3.1, (i + 1) / 4);
      it.add('solid', kit.cyl(rt, rb, 8.2, 14), T(0, 7 + i * 8, 0), { color: i % 2 ? 0xfff8f0 : 0xe23d3d });
    }
    it.add('solid', kit.cyl(5.4, 5.0, 1.0, 14), T(0, 39, 0), { color: 0x2a2f3a });
    it.add('solid', kit.cyl(2.8, 2.8, 4.2, 12), T(0, 40, 0), { color: 0x9fd8ff });
    it.add('glow', kit.cyl(2.5, 2.5, 3.6, 12), T(0, 40.3, 0), { color: 0xffe9a0, k: 0.8, haze: 0.2, hazeAll: true });
    it.add('solid', kit.cone(3.7, 3.6, 12), T(0, 44.2, 0), { color: 0xc92f2f });
    it.add('solid', kit.sph(0.7, 6, 4), T(0, 48, 0), { color: 0xffd23f });
    it.add('solid', kit.bbox(1, 1, 1), T(11, 3.2, 8, 0.2, 9, 5, 7), { color: 0xfff8f0 });
    it.add('solid', new THREE.ConeGeometry(0.72, 1, 4).translate(0, 0.5, 0), T(11, 8.2, 8, Math.PI / 4 + 0.2, 10.5, 3, 8.2), { color: 0xc94a35 });
    addHalo(B, 300, 12 * DEG, SEA_Y + 57, 36, 0xfff0b8, 0.5);
  }
  // ---- port: quay, containers, gantry cranes, warehouses ----
  {
    const th0 = -33 * DEG, R = 292;
    const it = Item(B, R, th0, SEA_Y);
    it.add('solid', kit.bbox(1, 1, 1), T(0, 0, 0, 0, 150, 3.6, 30), { color: 0xb9b4a8 });
    const cc = [0xe8553d, 0x2f80ed, 0xf4b400, 0x2ea66b, 0xf2f2f2, 0x7b61ff, 0xd84a4a];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 17; i++) {
      const hgt = 1 + Math.floor(rn() * 3);
      for (let l = 0; l < hgt; l++) it.add('solid', kit.bbox(1, 1, 1), T(-66 + i * 7.8 + (rn() - 0.5) * 0.6, 3.6 + l * 2.7, -6 + row * 6.4, 0, 6.8, 2.6, 2.5), { color: cc[Math.floor(rn() * cc.length)] });
    }
    for (const wx of [-58, -20, 22]) it.add('solid', kit.bbox(1, 1, 1), T(wx, 3.6, -15, 0, 30, 9, 12), { color: 0xe4e0d4 }), it.add('solid', kit.bbox(1, 1, 1), T(wx, 12.6, -15, 0, 31, 1.6, 13), { color: 0x7e8794 });
    for (const [cx, hh] of [[-52, 38], [-8, 43], [38, 36]]) {
      const cr = 0xf08a3a, blue = 0x2f6fd0;
      for (const [lx, lz] of [[-7, -4], [7, -4], [-7, 5], [7, 5]]) it.add('solid', kit.bbox(1.5, 1, 1.5), T(cx + lx, 3.6, lz, 0, 1, hh * 0.78, 1), { color: blue });
      it.add('solid', kit.bbox(1, 1, 1), T(cx, 3.6 + hh * 0.78, 0.4, 0, 18, 3.0, 15), { color: cr });
      it.add('solid', kit.bbox(1, 1, 1), T(cx, 3.6 + hh * 0.78 + 1.0, 21, 0, 2.2, 2.2, 42).multiply(new THREE.Matrix4().makeRotationX(-0.07)), { color: 0xe8d4a8 });
      it.add('solid', kit.bbox(1, 1, 1), T(cx, 3.6 + hh * 0.78 + 1.2, -10, 0, 2.2, 2.2, 18), { color: cr });
      it.add('solid', kit.bbox(1, 1, 1), T(cx + 5, 3.6 + hh * 0.78 - 4.5, 6, 0, 4, 3, 4), { color: 0x3a3f4a });
    }
  }
  // ---- cargo ship on the horizon + sailboats ----
  {
    const it = Item(B, 396, -64 * DEG, SEA_Y);
    it.add('solid', hullGeo([[0, 44], [11, 20, 13, 36], [12, -36], [10, -46], [-10, -46], [-12, -36], [-11, 20], [0, 44, -13, 36]], 9, 0.6), T(0, -2, 0), { color: 0x2f3b4e });
    it.add('solid', kit.bbox(1, 1, 1), T(0, 7.2, 0, 0, 22.6, 1.4, 86), { color: 0xc92f2f });
    const cc = [0xe8553d, 0x2f80ed, 0xf4b400, 0x2ea66b, 0xf2f2f2];
    for (let i = 0; i < 9; i++) for (let l = 0; l < 3; l++) it.add('solid', kit.bbox(1, 1, 1), T((l % 2 ? 3.5 : -3.5), 8.6 + l * 0 + (i % 3) * 2.6 * 0, 24 - i * 7, 0, 7, 2.6 * (1 + (i + l) % 3), 6.4), { color: cc[(i * 3 + l) % cc.length] });
    it.add('solid', kit.bbox(1, 1, 1), T(0, 7.9, -36, 0, 16, 16, 11), { color: 0xf6f6f2 });
    it.add('solid', kit.cyl(2.2, 2.2, 6, 8), T(0, 23.9, -38), { color: 0xd84a4a });
  }
  for (const [R, th, s, sail, hull] of [[250, -2, 1.0, 0xffffff, 0xe9eef6], [262, -14, 0.9, 0xfff3d0, 0x2f80ed], [236, 22, 1.1, 0xffffff, 0xd84a4a], [270, 33, 0.85, 0xffffff, 0xf4f4f4], [255, -48, 1.0, 0xfff3d0, 0x2ea66b]]) {
    const it = Item(B, R, th * DEG, SEA_Y + 0.3, s, 0.6 + th * 0.02);
    addBoat(it, 'sail', { sail, hull, trim: hull });
  }

  // ---- the quiet side of the bay: chapel, windmill, pine islet, more sails ----
  {
    const th = 168 * DEG, r = 330, it = Item(B, r, th, hAt(th, r) - 1);
    it.add('solid', kit.bbox(1, 1, 1), T(0, 0, 0, 0, 12, 9, 18), { color: 0xf8f4ea });
    it.add('solid', new THREE.ConeGeometry(0.72, 1, 4).translate(0, 0.5, 0), T(0, 9, 0, Math.PI / 4, 14, 6, 21), { color: 0xc94a35 });
    it.add('solid', kit.bbox(1, 1, 1), T(0, 0, 11, 0, 6, 22, 6), { color: 0xf8f4ea });
    it.add('solid', kit.cone(4.6, 9, 4), T(0, 22, 11, Math.PI / 4), { color: 0xc94a35 });
    const th2 = -152 * DEG, r2 = 335, it2 = Item(B, r2, th2, hAt(th2, r2) - 1);
    it2.add('solid', kit.cyl(3.4, 5.2, 18, 10), T(0, 0, 0), { color: 0xf3ead8 });
    it2.add('solid', kit.cone(4.6, 5, 10), T(0, 18, 0), { color: 0xb5472f });
    for (let k = 0; k < 4; k++) it2.add('solid', kit.bbox(1, 1, 1), T(0, 17, 2.6, 0, 1.3, 15, 0.3).multiply(new THREE.Matrix4().makeRotationZ(k * Math.PI / 2 + 0.4)), { color: 0xf8f6f0 });
    const isl = Item(B, 262, -104 * DEG, SEA_Y);
    isl.add('solid', kit.cyl(26, 29, 1.6, 14), T(0, 0, 0), { color: 0xe8d9a8 });
    isl.add('solid', rockGeo(21, 7, 33), T(0, 0.2, 0), { color: 0x7e776a });
    isl.add('solid', kit.sph(14, 10, 6), T(0, 4.2, 0, 0, 1, 0.34, 1), { color: 0x6fae55 });
    for (let k = 0; k < 9; k++) { const a = k * 2.4, rr = 3 + (k % 4) * 3, hh = 9 + (k % 3) * 3; for (let l = 0; l < 3; l++) isl.add('solid', kit.cone(hh * (0.34 - l * 0.07), hh * 0.5, 6), T(Math.cos(a) * rr, 5 + hh * 0.16 + l * hh * 0.26, Math.sin(a) * rr), { color: l ? 0x2f7d46 : 0x24693a }); }
    addFoamAt(B, isl.pos.x, isl.pos.z, 32, 3.2);
    for (const [R, az, s0, sail, hull] of [[245, 170, 1.0, 0xffffff, 0x2f80ed], [262, -178, 0.9, 0xfff3d0, 0xd84a4a], [238, 140, 1.1, 0xffffff, 0xf4f4f4], [270, -128, 0.9, 0xffffff, 0x2ea66b], [250, 112, 1.0, 0xfff3d0, 0xe9eef6], [255, 200, 0.95, 0xffffff, 0xff8a3d]]) {
      const bi = Item(B, R, az * DEG, SEA_Y + 0.3, s0, 0.6 + az * 0.02);
      addBoat(bi, 'sail', { sail, hull, trim: hull });
    }
  }
  addMist(B, { R: 455, h: 55, a: 0.55, color: ctx.fogC, seed: 8, pw: 1.8 });
};

// ------------------------------------------------------------------------------------------ NEON
SCENERY.neon = (ctx, B) => {
  const rn = rngOf(202), low = ctx.low;
  const tmp = new THREE.Color();
  const p1 = C(0x4a2f8e), p2 = C(0x8a5acf);
  addRange(B, { R: 450, W: 100, amp: 120, fn: ringFn(31, 2, 9, 5), p: 1.6, crag: 0.02, haze: 0.62, colorFn: (p, n, hf) => tmp.copy(p1).lerp(p2, clamp(hf * 1.1, 0, 1)) });
  addMist(B, { R: 420, h: 70, a: 0.55, color: C(0xff7ac0), seed: 4, pw: 1.6 });
  // skyline across the bay
  const wins = [0xffd27a, 0x7ffcff, 0xff7ad9, 0xf2eaff, 0xffb347];
  const bodyC = [0x2b2566, 0x35307a, 0x241d58, 0x40308a, 0x2f2a6e, 0x3a2a70];
  const neons = [0xff3df2, 0x39f3ff, 0xff9a3d, 0x7b61ff];
  const winGeo = (w, h) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv, u0 = rn(), v0 = rn(), ru = Math.max(0.4, w / 25.6), rv = Math.max(0.3, h / 115);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * ru, v0 + uv.getY(i) * rv);
    return g;
  };
  let th = -Math.PI;
  const bridgeAt = -16 * DEG, bridgeHalf = 20 * DEG;
  const tower = (R, th, w, d, h, near) => {
    const it = Item(B, R, th, SEA_Y);
    const c = bodyC[Math.floor(rn() * bodyC.length)];
    const nc = neons[Math.floor(rn() * neons.length)], wc = wins[Math.floor(rn() * wins.length)];
    it.add('solid', kit.bbox(1, 1, 1), T(0, 0, 0, 0, w, h, d), { color: c, mist: 0.5, mistH: 25 });
    if (rn() < 0.7) it.add('solid', kit.bbox(1, 1, 1), T(0, h, 0, 0, w * 0.68, h * 0.14, d * 0.68), { color: c, mist: 0.5, mistH: 25 });
    const top = h + (rn() < 0.7 ? h * 0.14 : 0);
    if (rn() < 0.6) it.add('solid', kit.cyl(0.35, 0.5, h * 0.25 + 8, 4), T(0, top, 0), { color: 0x6a5aa8 });
    // windows on the face that looks at the camera
    it.add('win', winGeo(w * 0.94, h * 0.97), T(0, h * 0.5 + h * 0.005, d / 2 + 0.6), { color: wc, k: near ? 0.85 : 0.6, haze: 0.0 });
    // mirror image of the lit windows in the bay
    if (!low && rn() < 0.75) {
      const hr = Math.min(h * 0.75, 52), g2 = new THREE.PlaneGeometry(w * 0.94, hr), uv2 = g2.attributes.uv, u0 = rn(), v0 = rn(), ru = Math.max(0.4, w / 25.6), rv = hr / 115;
      for (let i = 0; i < uv2.count; i++) uv2.setXY(i, u0 + uv2.getX(i) * ru, v0 + (1 - uv2.getY(i)) * rv);
      const rc = C(wc);
      it.add('win', g2, T(0, -hr / 2, d / 2 + 0.6), { fn: (p) => rc.clone().multiplyScalar(0.5 * clamp(1 - (SEA_Y - p.y) / hr, 0, 1) ** 1.5), haze: 0 });
    }
    // neon roof outline + vertical accents
    it.add('glow', kit.bbox(1, 1, 1), T(0, top, d / 2 + 0.3, 0, w * 1.02, 1.1, 0.8), { color: nc, k: 0.9, haze: ctx.hazeAt(R) * 0.35, hazeAll: true });
    if (rn() < 0.5) it.add('glow', kit.bbox(1, 1, 1), T(w / 2 - 0.6, 0, d / 2 + 0.4, 0, 0.8, top, 0.6), { color: nc, k: 0.7, haze: ctx.hazeAt(R) * 0.35, hazeAll: true });
    if (h > 70 && rn() < 0.7) addHalo(B, R, th, top + h * 0.2 + 8, 26, 0xff3a5a, 0.7);
    else if (rn() < 0.5) addHalo(B, R, th, top + 1, 28 + rn() * 16, nc, 0.38);
    if (rn() < 0.22) it.add('glow', kit.bbox(1, 1, 1), T(0, h * (0.45 + rn() * 0.3), d / 2 + 0.5, 0, w * 0.7, h * 0.18, 0.5), { color: neons[Math.floor(rn() * 4)], k: 0.85, haze: ctx.hazeAt(R) * 0.3, hazeAll: true });
  };
  while (th < Math.PI) {
    const inFront = Math.cos(th) > 0.2;
    const R = 330 + rn() * 70, w = 14 + rn() * 20, d = 14 + rn() * 14;
    const downtown = Math.abs(Math.sin((th + 0.4) * 1.5)) > 0.35 || inFront;
    let h = (downtown ? 46 + Math.pow(rn(), 1.5) * 90 : 24 + rn() * 44) * (R > 380 ? 1.08 : 1);
    { const dz = Math.abs(th - 7 * DEG); if (dz < 13 * DEG) h *= 0.3 + 0.7 * sstep(5 * DEG, 13 * DEG, dz); }
    const onBridge = Math.abs(th - bridgeAt) < bridgeHalf;
    if (!(onBridge && R < 372) && rn() > 0.1) tower(R, th, w, d, h, R < 365);
    th += (w + 2 + rn() * 10) / R * (low ? 1.35 : 1);
  }
  // suspension bridge (lit)
  {
    const R = 308, it = Item(B, R, bridgeAt, SEA_Y, 1, 0.1);
    const span = 150, deckY = 20, topY = 88, tx = 70;
    const nc = 0xff4fd8, cy = 0x39f3ff;
    it.add('solid', kit.bbox(1, 1, 1), T(0, deckY, 0, 0, span * 2 + 60, 3.2, 12), { color: 0x2a2458 });
    it.add('glow', kit.bbox(1, 1, 1), T(0, deckY + 3.2, 5.7, 0, span * 2 + 60, 0.7, 0.5), { color: cy, k: 0.9, haze: 0.25, hazeAll: true });
    for (const sx of [-tx, tx]) {
      for (const lz of [-4.5, 4.5]) it.add('solid', kit.bbox(1, 1, 1), T(sx, 0, lz, 0, 4.2, topY, 4.2), { color: 0x3a2f7a });
      for (const yy of [38, 70, topY - 2]) it.add('solid', kit.bbox(1, 1, 1), T(sx, yy, 0, 0, 4.0, 3.6, 13.5), { color: 0x3a2f7a });
      it.add('glow', kit.bbox(1, 1, 1), T(sx, topY + 3, 0, 0, 5, 0.8, 14), { color: nc, k: 0.9, haze: 0.25, hazeAll: true });
      addHalo(B, R, bridgeAt + sx / R * 0.9, topY + 6, 34, nc, 0.7);
      it.add('solid', kit.bbox(1, 1, 1), T(sx, 0, 0, 0, 9, deckY, 14), { color: 0x2a2458 });
    }
    const cable = (x0, y0, x1, y1, sag, n) => {
      let px = x0, py = y0;
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = lerp(x0, x1, t), y = lerp(y0, y1, t) - sag * 4 * t * (1 - t);
        const dx = x - px, dy = y - py, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
        for (const lz of [-5.5, 5.5]) it.add('glow', kit.box(len, 0.7, 0.7), T((x + px) / 2, (y + py) / 2, lz, 0, 1, 1, 1, 0, ang), { color: nc, k: 0.8, haze: 0.25, hazeAll: true });
        if (i % 2 === 0 && Math.abs(y - deckY) > 4) it.add('glow', kit.bbox(1, 1, 1), T(x, deckY + 3, -5.5, 0, 0.3, y - deckY - 3, 0.3), { color: cy, k: 0.4, haze: 0.25, hazeAll: true });
        px = x; py = y;
      }
    };
    cable(-tx, topY, tx, topY, -(topY - deckY - 12) * 1.0, 28);
    cable(tx, topY, span + 30, deckY + 3, 4, 10);
    cable(-tx, topY, -(span + 30), deckY + 3, 4, 10);
    for (let x = -span - 25; x <= span + 25; x += 12) {
      const col = (x / 12) % 2 ? 0xffe9a0 : 0xff9ad8; addHalo(B, R, bridgeAt + x / R, deckY + 5, 9, col, 0.7);
      if (!low) { const cc = C(col); it.add('glow', new THREE.PlaneGeometry(1.6, 15), T(x, SEA_Y + 0.0 - 7.5 + 0.9, 6.5), { fn: (p) => cc.clone().multiplyScalar(0.5 * clamp(1 - (SEA_Y - p.y) / 15, 0, 1) ** 1.6), haze: 0, hazeAll: true }); }
    }
  }
  // harbour string lights along the far shore
  for (let i = 0; i < (low ? 40 : 90); i++) {
    const t2 = rn() * TAU - Math.PI, col = [0xffd27a, 0xff7ad9, 0x7ffcff][Math.floor(rn() * 3)];
    addHalo(B, 318 + rn() * 80, t2, SEA_Y + 3 + rn() * 7, 5 + rn() * 7, col, 0.7);
  }
};


// ------------------------------------------------------------------------------------------ CORAL
function karst(it, h, r, seed, topC = 0x4f9a46) {
  const g = new THREE.CylinderGeometry(r * 0.62, r * 1.05, h, 10, 7);
  const pa = g.attributes.position, rn = rngOf(seed);
  const jit = new Map();
  for (let i = 0; i < pa.count; i++) {
    const key = Math.round(Math.atan2(pa.getZ(i), pa.getX(i)) * 10) + ':' + Math.round(pa.getY(i));
    if (!jit.has(key)) jit.set(key, 0.82 + rn() * 0.36);
    const j = jit.get(key), yy = (pa.getY(i) + h / 2) / h;
    const bulge = 1 + 0.18 * Math.sin(yy * 5 + seed) + (yy > 0.8 ? -0.1 : 0);
    pa.setXYZ(i, pa.getX(i) * j * bulge, pa.getY(i) + h / 2, pa.getZ(i) * j * bulge);
  }
  g.computeVertexNormals();
  const cc = new THREE.Color();
  it.add('solid', g, null, { fn: (p, n) => { const yy = p.y / h; return yy < 0.07 ? cc.set(0x6f6a5c) : cc.set(0xd9d0be).lerp(C(0xb9ad98), clamp(Math.abs(n.x) * 0.5, 0, 0.5)); } });
  it.add('solid', kit.sph(r * 0.66, 9, 5), T(0, h * 1.0, 0, 0, 1, 0.45, 1), { color: topC });
  for (let i = 0; i < 5; i++) it.add('solid', kit.cone(r * 0.12, r * 0.45, 5), T((rn() - 0.5) * r * 0.9, h * 1.06, (rn() - 0.5) * r * 0.9), { color: 0x2f7d3a });
}
SCENERY.coral = (ctx, B) => {
  const rn = rngOf(303), tmp = new THREE.Color(), low = ctx.low;
  const t1 = C(0x2f9c8e), t2 = C(0x6fd0a0);
  addRange(B, { R: 455, W: 90, amp: 100, fn: ringFn(41, 2, 9, 5), p: 1.4, crag: 0.02, haze: 0.5, colorFn: (p, n, hf) => tmp.copy(t1).lerp(t2, clamp(hf, 0, 1)) });
  const sand = C(0xf3e2b0), gr = C(0x3f9a4a), gr2 = C(0x8ed05a);
  const hAt = addRange(B, { R: 365, W: 55, amp: 34, fn: (th) => 0.5 + 0.5 * Math.pow(Math.max(0, Math.sin(th * 2 + 0.8) * Math.sin(th * 3 - 0.4)), 0.8) * 1.2 - 0.5, p: 1.2, crag: 0.02,
    colorFn: (p, n, hf, th) => (hf < 0.07 ? tmp.copy(sand) : tmp.copy(gr).lerp(gr2, clamp(hf * 1.5 + (hillPatch(th, p.y, 37) - 0.5) * 0.5, 0, 1))) });
  addFoamRing(B, 365 - 55 * 0.95, 3.0);
  addMist(B, { R: 460, h: 45, a: 0.45, color: ctx.fogC, seed: 6, pw: 1.8 });
  // palm islets with lagoon halos
  const islets = [[-6, 236, 1.1], [14, 262, 1.5], [-26, 300, 1.7], [30, 320, 2.0], [-46, 250, 1.0], [52, 280, 1.3], [-80, 300, 1.4], [78, 318, 1.6], [112, 280, 1.2], [-118, 262, 1.1], [150, 300, 1.5], [-150, 320, 1.4], [3, 330, 2.3]];
  for (const [az, R, s] of islets) {
    const th = az * DEG, it = Item(B, R, th, SEA_Y, s);
    const r = 11;
    it.add('solid', kit.cyl(r * 1.3, r * 1.45, 1.4, 14), T(0, 0, 0), { color: 0xf6e7bc });
    it.add('solid', rockGeo(r * 0.78, 4, Math.floor(R + az), 1), T(0, 0.3, 0), { color: 0x5aa84a });
    const nP = low ? 3 : 4 + Math.floor(rn() * 3);
    for (let k = 0; k < nP; k++) addPalm(it, (rn() - 0.5) * r * 0.9, 2.5, (rn() - 0.5) * r * 0.9, 13 + rn() * 9, (rn() - 0.5) * 1.2, 0x2f9a4a);
    addSeaDisc(B, it.pos.x, it.pos.z, r * s * 3.2, 0x3ff0d0, 0.55);
    addFoamAt(B, it.pos.x, it.pos.z, r * s * 1.45, 3.2 * s);
  }
  // limestone karst towers
  for (const [az, R, h, r, sd] of [[-34, 310, 78, 13, 1], [-37, 322, 56, 10, 2], [-30, 330, 40, 8, 3], [38, 340, 92, 15, 4], [41, 328, 60, 10, 5], [-104, 330, 80, 13, 6], [128, 340, 70, 12, 7], [-160, 345, 88, 14, 8], [-14, 400, 70, 12, 9]]) {
    const it = Item(B, R, az * DEG, SEA_Y);
    karst(it, h, r, sd);
    addFoamAt(B, it.pos.x, it.pos.z, r * 1.5, 3.4);
    addSeaDisc(B, it.pos.x, it.pos.z, r * 3.6, 0x3ff0d0, 0.4);
  }
  // sand bars / reef patches
  for (let i = 0; i < 6; i++) { const a = (rn() - 0.5) * TAU, R = 170 + rn() * 90; addSeaDisc(B, Math.sin(a) * R, -Math.cos(a) * R, 40 + rn() * 40, 0x6ff7de, 0.4, 0.8); }
  // distant dhows
  for (const [R, az, s, sail] of [[270, 3, 1.0, 0xfff6e0], [290, -18, 0.9, 0xffe2b0], [255, 24, 1.1, 0xffffff], [300, 58, 1.0, 0xfff0d0]]) {
    const it = Item(B, R, az * DEG, SEA_Y + 0.35, s, 0.9 + az * 0.03);
    addBoat(it, 'dhow', { sail, hull: 0x8a5a36, trim: 0xd8a24a });
  }
};

// ------------------------------------------------------------------------------------------ JUNGLE
SCENERY.jungle = (ctx, B) => {
  const rn = rngOf(404), tmp = new THREE.Color(), low = ctx.low;
  const veg = (dark, mid, light, f = 29) => (p, n, hf, th) => {
    if (hf < 0.035) return tmp.set(0xd8c890);
    const k = hillPatch(th, p.y, f);
    tmp.copy(dark).lerp(mid, clamp(hf * 1.3 + (k - 0.5) * 0.7, 0, 1)).lerp(light, clamp((hf - 0.55) * 1.2 + (k - 0.7) * 0.5, 0, 0.7));
    return tmp;
  };
  addRange(B, { R: 455, W: 100, amp: 150, fn: ringFn(51, 2, 12, 6), p: 1.35, crag: 0.03, haze: 0.5, mist: 0.2, mistH: 90, colorFn: veg(C(0x2c6e62), C(0x4a9a78), C(0x7bc29a), 23) });
  addMist(B, { R: 430, h: 90, a: 0.42, color: C(0xdff3e0), seed: 3, pw: 1.3 });
  addRange(B, { R: 370, W: 80, amp: 96, fn: ringFn(53, 3, 16, 6), p: 1.3, crag: 0.03, haze: 0.38, mist: 0.25, mistH: 50, colorFn: veg(C(0x1f6b3a), C(0x3f9a48), C(0x86cf62), 31) });
  addMist(B, { R: 345, h: 55, a: 0.34, color: C(0xe4f6e4), seed: 9, pw: 1.5 });
  const hAt = addRange(B, { R: 290, W: 60, amp: 46, fn: ringFn(57, 4, 20, 6), p: 1.25, crag: 0.03, haze: 0.2, mist: 0.2, mistH: 25, colorFn: veg(C(0x1a6a34), C(0x3ea04a), C(0x8ad060), 37) });
  addFoamRing(B, 290 - 60 * 0.95, 3.0);
  // tabletop mountains with tall waterfalls
  const tepui = (R, az, r, h, seed) => {
    const th = az * DEG, it = Item(B, R, th, SEA_Y);
    const g = new THREE.CylinderGeometry(r * 0.8, r * 1.35, h, 16, 8);
    const pa = g.attributes.position, rr = rngOf(seed), jit = new Map();
    for (let i = 0; i < pa.count; i++) {
      const key = Math.round(Math.atan2(pa.getZ(i), pa.getX(i)) * 6) + ':' + Math.round(pa.getY(i) / 8);
      if (!jit.has(key)) jit.set(key, 0.9 + rr() * 0.2);
      pa.setXYZ(i, pa.getX(i) * jit.get(key), pa.getY(i) + h / 2, pa.getZ(i) * jit.get(key));
    }
    g.computeVertexNormals();
    it.add('solid', g, null, { fn: (p, n) => { const yy = p.y / h, a = Math.atan2(p.x, p.z); const st = 0.5 + 0.5 * Math.sin(a * 17 + yy * 3); return yy < 0.16 ? tmp.set(0x2f7a42) : tmp.set(0x9c7b58).lerp(C(0x6e5844), st * 0.5).lerp(C(0xb89a74), yy * 0.4); }, mist: 0.15, mistH: 60 });
    it.add('solid', kit.cyl(r * 0.84, r * 0.8, 3, 16), T(0, h - 0.5, 0), { color: 0x3f9a48 });
    for (let i = 0; i < 7; i++) it.add('solid', kit.sph(r * (0.18 + rr() * 0.14), 7, 5), T((rr() - 0.5) * r * 1.3, h + 2, (rr() - 0.5) * r * 1.3, 0, 1, 0.8, 1), { color: i % 2 ? 0x2f8a3e : 0x52a84e });
    it.add('solid', kit.cone(r * 1.5, h * 0.22, 12), T(0, 0, 0), { color: 0x2d7a40 });
    // waterfall on the face that looks at the camera
    const x0 = (rr() - 0.5) * r * 0.4;
    const top = h - 1, bot = h * 0.1, zt = r * 0.8 + 0.6, zb = r * 1.25 + 1.0;
    const quad = (w0, w1, c, k) => {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute([x0 - w0, top, zt, x0 + w0, top, zt, x0 + w1, bot, zb, x0 - w0, top, zt, x0 + w1, bot, zb, x0 - w1, bot, zb], 3));
      it.add('glow', gg, null, { color: c, k, haze: ctx.hazeAt(R) * 0.45, hazeAll: true });
    };
    quad(r * 0.1, r * 0.16, 0xcfeaff, 0.55);
    quad(r * 0.045, r * 0.07, 0xffffff, 0.6);
    addHalo(B, R, th, SEA_Y + bot + 2, r * 2.2, 0xffffff, 0.35);
    addSeaDisc(B, it.pos.x * 0.96, it.pos.z * 0.96, r * 1.9, 0xe9fff4, 0.5, 0.6, SEA_Y + 3);
  };
  for (const [az, R, r, h, sd] of [[-14, 412, 36, 170, 1], [26, 400, 30, 140, 2], [-58, 418, 40, 180, 3], [72, 410, 34, 150, 4], [-108, 410, 36, 160, 5], [140, 415, 38, 170, 6], [178, 400, 30, 130, 7]]) tepui(R, az, r, h, sd);
  // giant trees standing on the near ridge
  const tree = (az, R, hgt) => {
    const th = az * DEG, y = hAt(th, R) - 3, it = Item(B, R, th, y);
    it.add('solid', kit.cyl(2.6, 4.8, hgt, 8), null, { color: 0x6a4c36 });
    for (const [x, yy, z, rad] of [[0, hgt + 4, 0, 24], [-20, hgt - 2, 6, 16], [19, hgt - 4, -4, 17], [6, hgt + 14, 8, 15]]) {
      it.add('solid', kit.sph(rad, 9, 6), T(x, yy, z, 0, 1, 0.42, 1), { color: 0x1f7a3a });
      it.add('solid', kit.sph(rad * 0.8, 8, 5), T(x, yy + rad * 0.12, z, 0, 1, 0.34, 1), { color: 0x4cab4e });
    }
  };
  for (const [az, R, hgt] of [[-6, 292, 58], [17, 288, 70], [-22, 296, 52], [44, 290, 64], [-48, 288, 60], [-76, 294, 66], [96, 290, 56], [-130, 290, 62], [150, 292, 66], [172, 288, 56], [-170, 290, 60], [120, 294, 50]]) tree(az, R, hgt);
  // misty sunbeam bands
  if (!low) for (let i = 0; i < 4; i++) addHalo(B, 400, (5 + i * 9) * DEG, 40 + i * 6, 120, 0xfff3b0, 0.12);
};

// ------------------------------------------------------------------------------------------ FROST
SCENERY.frost = (ctx, B) => {
  const rn = rngOf(505), tmp = new THREE.Color(), low = ctx.low;
  const snow = C(0xffffff), snowSh = C(0x7fa2e6), ice = C(0xbfe8ff), L = ctx.L;
  const peak = (rockC) => (p, n, hf, th) => {
    const d = clamp(n.dot(L) * 0.55 + 0.45, 0, 1);
    const steep = 1 - clamp(n.y, 0, 1);
    const snowAmt = clamp((hf - 0.14) * 4 - steep * 1.6 + (hillPatch(th, p.y, 47) - 0.5) * 0.5, 0, 1);
    tmp.copy(rockC).multiplyScalar(0.55 + 0.6 * d);
    const sc = snowSh.clone().lerp(snow, Math.pow(d, 0.8));
    return tmp.lerp(sc, snowAmt);
  };
  addRange(B, { R: 455, W: 85, amp: 170, fn: (th) => { const f = ringFn(61, 2, 12, 6)(th); return Math.pow(f, 1.25); }, p: 1.05, crag: 0.07, haze: 0.42, amb: 0.95, dif: 0.1, N: 260, colorFn: peak(C(0x5f7cae)) });
  addMist(B, { R: 440, h: 60, a: 0.5, color: ctx.fogC, seed: 12, pw: 1.7 });
  addRange(B, { R: 365, W: 70, amp: 105, fn: (th) => Math.pow(ringFn(63, 3, 16, 6)(th), 1.3), p: 1.1, crag: 0.06, haze: 0.24, amb: 0.95, dif: 0.1, N: 240, colorFn: peak(C(0x5a78ab)) });
  // frozen coast: ice shelf cliffs
  const shelf = ringFn(65, 6, 40, 6, 0.5);
  addRange(B, { R: 292, W: 7, amp: 15, fn: (th) => 0.25 + 0.75 * shelf(th), p: 0.35, crag: 0.08, haze: 0.2, amb: 0.9, dif: 0.15, N: 260, us: [-1, -0.9, -0.6, -0.2, 0.2, 1], toe: 6, colorFn: (p, n, hf) => (hf > 0.8 && n.y > 0.6 ? tmp.copy(snow) : tmp.copy(ice).lerp(C(0x7fd0f5), clamp(1 - hf, 0, 1) * 0.5)) });
  addRange(B, { R: 305, W: 40, amp: 30, fn: ringFn(67, 3, 14, 5), p: 1.3, crag: 0.04, haze: 0.22, amb: 0.9, dif: 0.15, toe: 9, colorFn: peak(C(0x8aa0c4)) });
  addFoamRing(B, 292 - 7 * 0.95, 3.2, { k: 0.5 });
  // snowy pines on the shelf
  for (let i = 0; i < (low ? 60 : 150); i++) {
    const th = rn() * TAU - Math.PI, R = 296 + rn() * 28, h = 8 + rn() * 9;
    const it = Item(B, R, th, SEA_Y + 13 + rn() * 4);
    for (let l = 0; l < 3; l++) it.add('solid', kit.cone(h * (0.34 - l * 0.07), h * 0.5, 6), T(0, h * 0.16 + l * h * 0.26, 0), { color: l ? 0x3d7a8a : 0x2f6a7a });
    it.add('solid', kit.cone(h * 0.2, h * 0.28, 6), T(0, h * 0.7, 0), { color: 0xf4faff });
  }
  if (low) {   // static aurora ribbons (vertex colours, no shader work)
    const ar = ringFn(81, 3, 14, 5), cg = new THREE.CylinderGeometry(640, 640, 300, 96, 6, true).translate(0, 100 + 150, 0);
    B.add('mist', cg, null, {
      fn: (p) => { const v = (p.y - 100) / 300; return (v < 0.5 ? C(0x33ffa0).lerp(C(0x22ccff), v * 2) : C(0x22ccff).lerp(C(0xcc55ff), (v - 0.5) * 1.6)); },
      alphaFn: (p) => { const v = (p.y - 100) / 300, th = Math.atan2(p.x, -p.z); return 0.75 * Math.pow(Math.max(0, 1 - v), 1.5) * sstep(0.45, 0.8, ar(th)) * sstep(0.0, 0.08, v); },
    });
  }
  // icebergs
  const berg = (R, az, s, sd) => {
    const it = Item(B, R, az * DEG, SEA_Y, s);
    it.add('solid', rockGeo(14, 22, sd, 1), T(0, -2, 0, sd), { fn: (p) => (p.y < SEA_Y + 1.6 * 1 ? C(0x7fe0ff) : tmp.set(0xf4fbff).lerp(C(0xcfe9ff), clamp(1 - (p.y - SEA_Y) / 20, 0, 1))), amb: 0.8, dif: 0.3 });
    it.add('solid', rockGeo(8, 12, sd + 3, 1), T(11, -1, 5, sd), { color: 0xeaf6ff });
    addSeaDisc(B, it.pos.x, it.pos.z, 36 * s, 0x6fe0ff, 0.5);
    addFoamAt(B, it.pos.x, it.pos.z, 16 * s, 3);
  };
  const bergs = [[205, -6, 1.4], [235, 16, 1.7], [250, -24, 1.3], [262, 34, 1.9], [225, -45, 1.2], [270, 62, 1.5], [245, 95, 1.4], [260, -85, 1.5], [240, 130, 1.6], [265, -130, 1.5], [250, 165, 1.3], [230, -165, 1.2]];
  bergs.forEach(([R, az, s], i) => berg(R, az, s, 7 + i * 5));
  for (const [R, az, s, sail, hull] of [[270, 4, 0.9, 0xffffff, 0xd84a4a]]) { const it = Item(B, R, az * DEG, SEA_Y + 0.35, s, 0.7); addBoat(it, 'trawler', { hull }); }
};


// ------------------------------------------------------------------------------------------ DUNES
function camel(it, x, y, z, ry, s, color) {
  const m = (lx, ly, lz, sx, sy, sz, rx = 0, rz = 0) => T(x, y, z, ry, s, s, s).multiply(T(lx, ly, lz, 0, sx, sy, sz, rx, rz));
  it.add('solid', kit.sph(1, 7, 5), m(0, 2.5, 0, 2.1, 1.0, 0.8), { color });
  it.add('solid', kit.sph(1, 6, 4), m(-0.1, 3.5, 0.0, 0.7, 0.8, 0.6), { color });
  it.add('solid', kit.cyl(0.28, 0.4, 2.2, 5), m(1.9, 2.6, 0, 1, 1, 1, 0, -0.5), { color });
  it.add('solid', kit.bbox(1, 1, 1), m(2.9, 4.5, 0, 1.2, 0.55, 0.55), { color });
  for (const [lx, lz] of [[-1.3, -0.4], [-1.3, 0.4], [1.3, -0.4], [1.3, 0.4]]) it.add('solid', kit.cyl(0.14, 0.18, 2.4, 4), m(lx, 0, lz, 1, 1, 1), { color });
  it.add('solid', kit.bbox(1, 1, 1), m(-0.2, 3.2, 0, 1.2, 0.6, 0.9), { color: 0xc9453a });
}
SCENERY.dunes = (ctx, B) => {
  const rn = rngOf(606), tmp = new THREE.Color(), low = ctx.low, L = ctx.L;
  const litC = C(0xf9cf84), shC = C(0xc4693a), farLit = C(0xfbd9a0), farSh = C(0xd98f5a);
  const dune = (lit, sh, f = 61) => (p, n, hf, th) => {
    const d = clamp(n.dot(L) * 0.5 + 0.5, 0, 1);
    tmp.copy(sh).lerp(lit, Math.pow(d, 1.3));
    const rip = 0.97 + 0.03 * Math.sin(th * 400 + p.y * 3);
    if (hf < 0.05) tmp.lerp(C(0xf3e3b8), 0.7);
    return tmp.multiplyScalar(rip);
  };
  // sea gaps: sectors where the dune ring dips so the sea shows beyond
  const gap = (th) => 0.12 + 0.88 * sstep(0.1, 0.7, Math.abs(Math.sin((th - 0.5) * 1.5)) * 0.8 + 0.25 * (0.5 + 0.5 * Math.sin(th * 3 + 1)));
  const mk = (R, W, amp, seed, lit, sh, haze, k0, k1) => { const f = ringFn(seed, k0, k1, 6); return addRange(B, { R, W, amp, fn: (th) => Math.pow(f(th), 1.1) * gap(th + seed), p: 1.0, crag: 0.012, haze, amb: 1.0, dif: 0.0, N: 260, colorFn: dune(lit, sh) }); };
  mk(455, 90, 90, 71, farLit, farSh, 0.55, 2, 9);
  addMist(B, { R: 450, h: 55, a: 0.5, color: ctx.fogC, seed: 15, pw: 1.7 });
  mk(385, 70, 64, 73, farLit, farSh, 0.4, 2, 12);
  const hAt = mk(325, 60, 42, 75, litC, shC, 0.28, 3, 14);
  mk(272, 45, 24, 77, litC, shC, 0.16, 3, 16);
  addFoamRing(B, 272 - 45 * 0.95, 3);
  // pyramids
  const pyr = (R, az, s, sd) => {
    const it = Item(B, R, az * DEG, SEA_Y, s);
    it.add('solid', new THREE.ConeGeometry(76, 96, 4).translate(0, 48, 0), T(0, 0, 0, Math.PI / 4 + sd * 0.05), { color: 0xf2c67c, mist: 0.12, mistH: 30 });
    it.add('solid', kit.cyl(98, 104, 3, 4), T(0, 0, 0, Math.PI / 4 + sd * 0.05), { color: 0xd9b074 });
  };
  pyr(405, 14, 1.0, 1); pyr(392, 31, 0.72, 2); pyr(380, 2, 0.52, 3); pyr(415, -112, 0.9, 4); pyr(400, 150, 0.8, 5);
  // sand-stone city with domes and minarets
  const city = (R, th0, n, spread, seed) => {
    const rr = rngOf(seed);
    for (let i = 0; i < n; i++) {
      const th = th0 + (i / n - 0.5) * spread + (rr() - 0.5) * 0.01, r = R + rr() * 26;
      const it = Item(B, r, th, SEA_Y);
      const w = 12 + rr() * 16, h = 10 + rr() * 22, d = 12 + rr() * 12;
      const wall = [0xf3e4c4, 0xeed9b0, 0xf8ecd2, 0xe6c895][Math.floor(rr() * 4)];
      it.add('solid', kit.bbox(1, 1, 1), T(0, 0, 0, 0, w, h, d), { color: wall });
      const kind = rr();
      if (kind < 0.35) {
        it.add('solid', kit.cyl(w * 0.34, w * 0.36, 4, 12), T(0, h, 0), { color: wall });
        it.add('solid', new THREE.SphereGeometry(w * 0.36, 12, 7, 0, TAU, 0, Math.PI / 2), T(0, h + 4, 0), { color: rr() < 0.5 ? 0x2a9d8f : 0xe0b84a });
        it.add('solid', kit.cone(0.6, 5, 4), T(0, h + 4 + w * 0.36, 0), { color: 0xe0b84a });
      } else if (kind < 0.6) {
        const mh = 36 + rr() * 22;
        it.add('solid', kit.cyl(2.2, 2.6, mh, 8), T(w * 0.5 + 3, 0, 0), { color: 0xf6e8c8 });
        it.add('solid', kit.cyl(3.6, 3.4, 1.2, 8), T(w * 0.5 + 3, mh * 0.82, 0), { color: 0xd8b878 });
        it.add('solid', kit.cone(3.0, 11, 8), T(w * 0.5 + 3, mh, 0), { color: 0x2a9d8f });
        it.add('solid', kit.sph(0.8, 6, 4), T(w * 0.5 + 3, mh + 11, 0), { color: 0xe0b84a });
      } else it.add('solid', kit.bbox(1, 1, 1), T(w * 0.15, h, 0, 0, w * 0.5, 4, d * 0.6), { color: wall });
    }
  };
  city(318, -34 * DEG, low ? 14 : 22, 0.34, 1); city(330, 44 * DEG, low ? 12 : 18, 0.3, 2); city(322, 160 * DEG, 12, 0.3, 3); city(326, -128 * DEG, 12, 0.3, 4);
  // needle tower
  {
    const it = Item(B, 372, -12 * DEG, SEA_Y, 0.9);
    const rad = [11, 9, 7.2, 5.6, 4, 2.6], hs = [34, 30, 26, 22, 18, 14];
    let y = 0;
    for (let i = 0; i < rad.length; i++) { it.add('solid', kit.cyl(rad[i] * 0.8, rad[i], hs[i], 8), T(0, y, 0, i * 0.5), { color: i % 2 ? 0xd4e6f2 : 0xe9f2f8 }); y += hs[i] - 3; }
    it.add('solid', kit.cone(1.4, 38, 6), T(0, y, 0), { color: 0xc8d8e6 });
  }
  // camel caravan on the near dune
  {
    const th0 = -19 * DEG, R = 300;
    for (let i = 0; i < 7; i++) {
      const th = th0 + i * 0.0105, y = hAt(th, R);
      const it = Item(B, R, th, y - 0.6, 1.0, Math.PI / 2 + (i % 2) * 0.05);
      camel(it, 0, 0, 0, 0, 1.0, 0x6a4a30);
    }
  }
  // oasis
  {
    const R = 238, th = 27 * DEG, it = Item(B, R, th, SEA_Y);
    it.add('solid', kit.cyl(20, 22, 1.4, 14), T(0, 0, 0), { color: 0xf0d090 });
    it.add('solid', rockGeo(14, 3.5, 77, 1), T(0, 0.3, 0), { color: 0x5aa84a });
    for (let k = 0; k < 9; k++) addPalm(it, (rn() - 0.5) * 20, 2, (rn() - 0.5) * 20, 14 + rn() * 9, (rn() - 0.5) * 1.1, 0x3a9a4a);
    addSeaDisc(B, it.pos.x, it.pos.z, 60, 0x42e0c0, 0.5);
    addFoamAt(B, it.pos.x, it.pos.z, 24, 3);
  }
  for (const [R, az, s, sail] of [[255, -4, 1.0, 0xfff1d0], [275, -26, 0.9, 0xffffff], [245, 44, 1.05, 0xffe8c0]]) {
    const it = Item(B, R, az * DEG, SEA_Y + 0.35, s, 0.9 + az * 0.03);
    addBoat(it, 'dhow', { sail, hull: 0x7a4a2a, trim: 0xe0b84a });
  }
};

// @@PART6@@

// @@PART4@@


// ------------------------------------------------------------------------------------------ dynamics: boats, birds, lanterns, aurora
const wrapTo = (v, P) => ((((v + P / 2) % P) + P) % P) - P / 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// Instanced boats that live in world space (you run past them). spec: { kind, n, pal, tints, scale:[a,b], speed:[a,b] }
function makeFleet(ctx, spec) {
  if (ctx.low && spec.opt) return null;
  const world = ctx.world, land = ctx.lobby ? 14 : (GROUND_HALF[world.id] ?? 16);
  const n = ctx.low ? Math.max(1, Math.round(spec.n * 0.5)) : spec.n;
  const geo = boatGeometry(spec.kind, spec.pal);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.42;'); };
  mat.customProgramCacheKey = () => 'hopinet-boat';
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  const rr = rngOf(hashStr(world.id + spec.kind));
  const st = [];
  const floe = spec.kind === 'floe';
  const Pz = 480;
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const sc = lerp(spec.scale[0], spec.scale[1], rr());
    const sp = lerp(spec.speed[0], spec.speed[1], rr()) * (rr() < 0.5 ? -1 : 1);
    st.push({
      side, sc, sp, ph: rr() * TAU, z0: ((i + rr() * 0.7) / n) * Pz,
      xo: land + 18 + rr() * 78 + (spec.far ?? 0), lat: (rr() - 0.5) * 0.5,
      rho: 34 + rr() * 110, phi: rr() * TAU, om: (rr() < 0.5 ? -1 : 1) * (0.012 + rr() * 0.02),
    });
    const tint = spec.tints ? spec.tints[i % spec.tints.length] : 0xffffff;
    mesh.setColorAt(i, C(tint));
  }
  mesh.instanceColor.needsUpdate = true;
  return {
    object: mesh,
    update(t, cp) {
      for (let i = 0; i < n; i++) {
        const b = st[i];
        let x, z, vx, vz;
        if (ctx.lobby) {
          const a = b.phi + b.om * t * 4;
          x = Math.cos(a) * b.rho - cp.x; z = Math.sin(a) * b.rho - cp.z;
          vx = -Math.sin(a) * Math.sign(b.om); vz = Math.cos(a) * Math.sign(b.om);
        } else {
          const wz = b.z0 + b.sp * t;
          z = wrapTo(wz - cp.z, Pz);
          const wx = b.side * (b.xo + 6 * Math.sin(t * 0.06 + b.ph));
          x = wx - cp.x;
          vx = b.side * 6 * 0.06 * Math.cos(t * 0.06 + b.ph); vz = b.sp;
        }
        const yaw = Math.atan2(-vx, -vz);
        const bob = floe ? 0.05 : 0.14;
        const roll = floe ? 0.01 * Math.sin(t * 0.5 + b.ph) : 0.045 * Math.sin(t * 1.1 + b.ph), pitch = floe ? 0 : 0.03 * Math.sin(t * 0.8 + b.ph * 1.7);
        _e.set(pitch, yaw, roll, 'YXZ'); _q.setFromEuler(_e);
        _v.set(x, SEA_Y + (floe ? -0.05 : 0.12) + Math.sin(t * 1.3 + b.ph) * bob * 0.6, z);
        _s.setScalar(b.sc);
        _m.compose(_v, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function birdGeometry() {
  const P = [], Cc = [];
  const tri = (a, b, c, ca, cb, cc) => { P.push(...a, ...b, ...c); Cc.push(...ca, ...cb, ...cc); };
  const W = [1, 1, 1], G = [0.9, 0.92, 0.95], D = [0.25, 0.27, 0.32];
  const N = [0, 0, -0.75], Tl = [0, 0.0, 0.7], B1 = [0, 0.13, -0.1], B2 = [0, -0.1, -0.1], S1 = [-0.11, 0, -0.1], S2 = [0.11, 0, -0.1];
  tri(N, S1, B1, W, W, W); tri(N, B1, S2, W, W, W); tri(N, B2, S1, G, G, G); tri(N, S2, B2, G, G, G);
  tri(Tl, B1, S1, W, W, G); tri(Tl, S2, B1, W, G, W); tri(Tl, S1, B2, G, G, G); tri(Tl, B2, S2, G, G, G);
  for (const sx of [-1, 1]) {
    const RF = [sx * 0.08, 0.02, -0.35], RB = [sx * 0.08, 0.02, 0.25], MF = [sx * 0.6, 0.04, -0.34], MB = [sx * 0.55, 0.0, 0.3], TP = [sx * 1.15, 0.02, 0.18];
    tri(RF, MF, RB, W, W, W); tri(MF, MB, RB, W, W, W); tri(MF, TP, MB, W, D, W);
    tri(RF, RB, MF, G, G, G); tri(MF, RB, MB, G, G, G); tri(MF, MB, TP, G, G, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(Cc, 3));
  return g;
}
function makeBirds(ctx, spec) {
  const n = ctx.low ? Math.ceil(spec.n * 0.5) : spec.n;
  const geo = birdGeometry();
  const phase = new Float32Array(n), tint = new Float32Array(n * 3);
  const rr = rngOf(hashStr(ctx.world.id + 'birds'));
  const st = [];
  const flocks = Math.max(1, Math.ceil(n / 3));
  const Sx = 340, Sz = 420;
  for (let f = 0; f < flocks; f++) st.push({ cx: (rr() - 0.5) * Sx, cz: (rr() - 0.5) * Sz, r: 26 + rr() * 50, om: (rr() < 0.5 ? -1 : 1) * (0.1 + rr() * 0.12), ph: rr() * TAU, y: spec.y[0] + rr() * (spec.y[1] - spec.y[0]) });
  const bird = [];
  for (let i = 0; i < n; i++) {
    const f = i % flocks, k = Math.floor(i / flocks);
    bird.push({ f, dx: (k % 2 ? 1 : -1) * (3 + k * 2.2) * (0.6 + rr() * 0.8), dz: 2 + k * 3.5 + rr() * 2, dy: (rr() - 0.5) * 3, s: lerp(spec.scale[0], spec.scale[1], rr()) });
    phase[i] = rr() * TAU;
    const tc = C(spec.tints[Math.floor(rr() * spec.tints.length)]);
    tint.set([tc.r, tc.g, tc.b], i * 3);
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), { uTime: TIME, uFlap: { value: spec.flap ?? 8 } }),
    fog: true, side: THREE.DoubleSide,
    vertexShader: `#include <common>
#include <fog_pars_vertex>
attribute vec3 aCol; attribute float aPhase; attribute vec3 aTint; uniform float uTime; uniform float uFlap; varying vec3 vCol;
void main(){
  vec3 p = position;
  float fl = sin(uTime * uFlap + aPhase);
  p.y += (fl * 0.55 - 0.10) * abs(p.x);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vCol = aCol * aTint;
  #include <fog_vertex>
}`,
    fragmentShader: `#include <common>
#include <fog_pars_fragment>
varying vec3 vCol;
void main(){ gl_FragColor = vec4(vCol, 1.0);
#include <colorspace_fragment>
#include <fog_fragment>
}`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  return {
    object: mesh,
    update(t, cp) {
      for (let i = 0; i < n; i++) {
        const b = bird[i], f = st[b.f];
        const a = f.om * t + f.ph;
        const sgn = Math.sign(f.om);
        const fx = f.cx + Math.cos(a) * f.r, fz = f.cz + Math.sin(a) * f.r;
        const vx = -Math.sin(a) * sgn, vz = Math.cos(a) * sgn;
        const yaw = Math.atan2(-vx, -vz);
        // formation offsets rotate with the heading
        const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
        const ox = b.dx * cs - b.dz * sn, oz = b.dx * sn + b.dz * cs;
        const x = wrapTo(fx + ox - cp.x, Sx), z = wrapTo(fz + oz - cp.z, Sz);
        const y = f.y + b.dy + Math.sin(t * 0.6 + f.ph + i) * 1.6;
        _e.set(0.06 * Math.sin(t * 0.9 + i), yaw, -sgn * 0.38, 'YXZ'); _q.setFromEuler(_e);
        _m.compose(_v.set(x, y, z), _q, _s.setScalar(b.s));
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// Camera-facing glowing sprites that drift upwards in world space (lanterns, fireflies, spores)
function makeDrifters(ctx, spec) {
  if (ctx.low) return null;                       // low quality: no animated sprites
  const n = spec.n;
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const data = new Float32Array(n * 4), col = new Float32Array(n * 3);
  const rr = rngOf(hashStr(ctx.world.id + 'drift'));
  for (let i = 0; i < n; i++) {
    data.set([(rr() - 0.5) * 300, rr() * spec.h, (rr() - 0.5) * 360, rr() * TAU], i * 4);
    const c = C(spec.colors[Math.floor(rr() * spec.colors.length)]); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
  g.instanceCount = n;
  const U = { uTime: TIME, uCam: { value: new THREE.Vector2() }, uMap: { value: haloTexture() }, uSize: { value: spec.size }, uH: { value: spec.h }, uRise: { value: spec.rise }, uY0: { value: spec.y0 ?? SEA_Y + 3 }, uGain: { value: spec.gain ?? 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute vec4 aData; attribute vec3 aColor; uniform float uTime; uniform vec2 uCam; uniform float uSize; uniform float uH; uniform float uRise; uniform float uY0; varying vec2 vUv; varying vec3 vC; varying float vA;
void main(){
  float y = mod(aData.y + uTime * uRise, uH);
  vec3 c = vec3(mod(aData.x - uCam.x + 150.0, 300.0) - 150.0 + sin(uTime * 0.4 + aData.w) * 3.0, uY0 + y, mod(aData.z - uCam.y + 180.0, 360.0) - 180.0);
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * uSize * (0.8 + 0.3 * sin(uTime * 3.0 + aData.w * 5.0));
  gl_Position = projectionMatrix * mv;
  vUv = uv; vC = aColor;
  vA = smoothstep(0.0, 0.08, y / uH) * (1.0 - smoothstep(0.7, 1.0, y / uH)) * (1.0 - smoothstep(60.0, 200.0, -mv.z));
}`,
    fragmentShader: `uniform sampler2D uMap; uniform float uGain; varying vec2 vUv; varying vec3 vC; varying float vA;
void main(){ float t = texture2D(uMap, vUv).r; gl_FragColor = vec4(vC * t * vA * uGain, 1.0);
#include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.renderOrder = -66;
  return { object: mesh, update(t, cp) { U.uCam.value.set(cp.x, cp.z); } };
}

// Aurora ribbons (animated curtains)
function makeAurora(ctx) {
  if (ctx.low) return null;
  const R = 640, rows = 10;
  const geo = new THREE.CylinderGeometry(R, R, 340, 160, rows, true).translate(0, 95 + 170, 0);
  const uv = geo.attributes.uv;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uAnim: { value: ctx.low ? 0 : 1 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float;
uniform float uTime; uniform float uAnim; varying vec2 vUv; varying vec3 vP;
${NOISE_GLSL}
void main(){
  float u = vUv.x, v = vUv.y;
  float az = atan(vP.x, -vP.z);
  float t = uTime * uAnim;
  float wob = 0.06 * sin(u * 80.0 + t * 0.6) + 0.04 * sin(u * 31.0 - t * 0.4);
  float vv = clamp(v + wob, 0.0, 1.0);
  float body = smoothstep(0.30, 0.62, vnoise(vec2(u * 38.0 + t * 0.10, 3.0 + t * 0.03)));
  float body2 = smoothstep(0.34, 0.66, vnoise(vec2(u * 17.0 - t * 0.07, 9.0)));
  float rays = 0.55 + 0.45 * vnoise(vec2(u * 520.0, vv * 2.0 + t * 0.2));
  float prof = pow(1.0 - vv, 1.5) * smoothstep(0.0, 0.07, vv);
  float sector = smoothstep(-2.4, -1.0, az) * (1.0 - smoothstep(1.2, 2.4, az)) * 0.45 + 0.55 * (0.5 + 0.5 * sin(az * 2.0 + 0.6));
  float a = max(body, body2 * 0.7) * rays * prof * sector * 0.85;
  vec3 c1 = vec3(0.15, 1.0, 0.55), c2 = vec3(0.1, 0.8, 1.0), c3 = vec3(0.85, 0.3, 1.0);
  vec3 c = mix(c1, c2, smoothstep(0.1, 0.5, vv)); c = mix(c, c3, smoothstep(0.55, 0.95, vv));
  // fade toward the horizon and above the visible band
  a *= smoothstep(0.0, 0.1, v);
  gl_FragColor = vec4(c * 1.05, a * 1.0);
  #include <colorspace_fragment>
}`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = -97;
  return { object: m };
}

DYNAMICS.harbor = (ctx) => [
  makeFleet(ctx, { kind: 'sail', n: 8, pal: { sail: 0xffffff, hull: 0xe9eef6, trim: 0x2f80ed }, tints: [0xffffff, 0xffe8c8, 0xd8ecff, 0xffd8d8, 0xffffff], scale: [0.9, 1.3], speed: [1.2, 3.0] }),
  makeFleet(ctx, { kind: 'trawler', n: 3, pal: { hull: 0xd84a4a }, tints: [0xffffff, 0xd8ecff, 0xfff0c0], scale: [1.0, 1.3], speed: [1.5, 2.6], far: 20, opt: true }),
  makeBirds(ctx, { n: 12, y: [16, 38], scale: [1.1, 1.6], tints: [0xffffff], flap: 7 }),
];
DYNAMICS.neon = (ctx) => [
  makeFleet(ctx, { kind: 'yacht', n: 8, pal: { hull: 0xf4f4ff, trim: 0xff3df2 }, tints: [0xffffff, 0xffc8f4, 0xc8f4ff, 0xe8d8ff], scale: [1.0, 1.5], speed: [1.5, 3.5] }),
  makeBirds(ctx, { n: 8, y: [18, 40], scale: [1.1, 1.5], tints: [0x7a5aa8, 0x5a3a88], flap: 8 }),
  makeDrifters(ctx, { n: 46, h: 70, rise: 1.6, size: 2.4, colors: [0xff9a3d, 0xffd27a, 0xff7ad9], y0: SEA_Y + 4, gain: 1.15 }),
];
DYNAMICS.coral = (ctx) => [
  makeFleet(ctx, { kind: 'dhow', n: 5, pal: { sail: 0xfff6e0, hull: 0x8a5a36, trim: 0xd8a24a }, tints: [0xffffff, 0xffe4b8, 0xffd0d0, 0xe0f4ff], scale: [0.9, 1.3], speed: [1.2, 2.6] }),
  makeFleet(ctx, { kind: 'sail', n: 4, pal: { sail: 0xffffff, hull: 0xffffff, trim: 0xff6f61 }, tints: [0xffffff, 0xfff0c0, 0xd0f4ff], scale: [0.9, 1.2], speed: [1.5, 3.0] }),
  makeFleet(ctx, { kind: 'longtail', n: 4, pal: { hull: 0xe8672a }, tints: [0xffffff, 0xffe0a0, 0xa8f0ff, 0xffb0c0], scale: [1.0, 1.4], speed: [1.0, 2.2], far: 8, opt: true }),
  makeBirds(ctx, { n: 12, y: [16, 36], scale: [1.0, 1.5], tints: [0xffffff], flap: 8 }),
];
DYNAMICS.jungle = (ctx) => [
  makeFleet(ctx, { kind: 'longtail', n: 6, pal: { hull: 0xb07a3a, sail: 0xc8a050 }, tints: [0xffffff, 0xffd0b0, 0xb0d8ff, 0xffe080], scale: [1.0, 1.5], speed: [1.0, 2.2] }),
  makeBirds(ctx, { n: 12, y: [14, 34], scale: [0.9, 1.3], tints: [0xff3a2a, 0x2a6aff, 0xffc21a, 0xff3a2a, 0x2ad08a], flap: 10 }),
  makeDrifters(ctx, { n: 50, h: 40, rise: 0.8, size: 0.9, colors: [0xd8ff80, 0xfff0a0, 0xb8ffd0], y0: SEA_Y + 2, gain: 0.9 }),
];
DYNAMICS.frost = (ctx) => [
  makeFleet(ctx, { kind: 'floe', n: 12, pal: { hull: 0xeef8ff }, tints: [0xffffff, 0xe8f6ff, 0xd8f0ff], scale: [0.8, 1.7], speed: [0.2, 0.6], far: 6 }),
  makeFleet(ctx, { kind: 'trawler', n: 2, pal: { hull: 0xd84a4a }, tints: [0xffffff, 0xd8ecff], scale: [1.0, 1.3], speed: [1.5, 2.4], far: 40, opt: true }),
  makeBirds(ctx, { n: 8, y: [16, 36], scale: [1.1, 1.5], tints: [0xf4f8ff, 0xd8e4f4], flap: 7 }),
  makeAurora(ctx),
];
DYNAMICS.dunes = (ctx) => [
  makeFleet(ctx, { kind: 'dhow', n: 6, pal: { sail: 0xfff1d0, hull: 0x7a4a2a, trim: 0xe0b84a }, tints: [0xffffff, 0xffe8c0, 0xffd8b0, 0xfff8e8], scale: [0.9, 1.4], speed: [1.0, 2.6], far: 14 }),
  makeFleet(ctx, { kind: 'sail', n: 2, pal: { sail: 0xffffff, hull: 0xffffff, trim: 0x2a9d8f }, tints: [0xffffff], scale: [0.9, 1.2], speed: [1.5, 2.6], far: 20, opt: true }),
  makeBirds(ctx, { n: 6, y: [20, 44], scale: [1.2, 1.7], tints: [0xd8b88a, 0xb88a5a], flap: 5 }),
];

// @@PART7@@

// ------------------------------------------------------------------------------------------ public: backdrop
export function makeBackdrop(world, opts = {}) {
  const quality = opts.quality === 'low' ? 'low' : 'high';
  const low = quality === 'low', lobby = !!opts.lobby;
  const look = LOOK[world.id] || LOOK.harbor;
  const fogC = C(world.fog);
  const sunDir = dirOf(look.az, look.el);
  const rnd = rngOf(hashStr('backdrop-' + world.id));
  const ctx = {
    world, look, low, lobby, quality, fogC, sunDir, rnd,
    L: sunDir.clone(), amb: look.amb, dif: look.dif,
    hazeAt: (R) => clamp((0.26 + 0.40 * clamp((R - 230) / 230, 0, 1)) * look.hazeK, 0, 0.92),
    fogU: { near: { value: world.fogNear }, far: { value: world.fogFar } },
  };
  const skyU = makeSkyUniforms(world, look, sunDir);
  ctx.skyU = skyU;

  const group = new THREE.Group();
  group.name = 'backdrop';
  const skyRig = new THREE.Group();            // follows the eye height so the horizon stays at eye level
  group.add(skyRig);
  skyRig.add(makeSkyDome(skyU));
  if (look.stars) skyRig.add(makeStars(world, low, rnd));
  const clouds = makeClouds(world, look, ctx, rnd, low ? Math.round(look.cloudN * 0.55) : look.cloudN);
  skyRig.add(clouds);
  group.add(makeSea(world, ctx, skyU));

  const B = new Batch(ctx);
  const build = SCENERY[world.id] || SCENERY.harbor;
  build(ctx, B);
  for (const name of Object.keys(B.parts)) {
    const geo = B.merged(name);
    if (geo) group.add(bucketMesh(name, geo, BUCKET_ORDER[name]));
  }
  const dyn = [];
  const dfn = DYNAMICS[world.id];
  if (dfn) for (const d of dfn(ctx)) { if (!d) continue; if (d.update) dyn.push(d); group.add(d.object); }

  group.userData.update = (t, camera) => {
    const cp = camera.position;
    group.position.set(cp.x, 0, cp.z);
    skyRig.position.y = cp.y;
    clouds.rotation.y = t * 0.0035;
    const f = group.parent && group.parent.fog;
    if (f && f.isFog) { ctx.fogU.near.value = f.near; ctx.fogU.far.value = f.far; }
    for (let i = 0; i < dyn.length; i++) dyn[i].update(t, cp, group.position);
  };
  group.userData.quality = quality;
  group.userData.dispose = () => {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.dispose();
    });
  };
  return group;
}



// ------------------------------------------------------------------------------------------ water tile
const _waterCache = new Map();
function buildWaterAssets(world, len) {
  const look = LOOK[world.id] || LOOK.harbor;
  const sunDir = dirOf(look.az, look.el);
  const fogUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  const common = {
    uTime: TIME, uShallow: { value: C(world.sea.shallow) }, uDeep: { value: C(world.sea.deep) }, uFoam: { value: C(world.sea.foam) },
    uSkyH: { value: C(world.sky[1]).lerp(C(world.fog), 0.5) }, uSkyZ: { value: C(world.sky[0]) }, uSunDir: { value: sunDir }, uSunCol: { value: C(look.sun) },
  };
  const noise = NOISE_GLSL;
  // ---- translucent surface
  const surfGeo = new THREE.PlaneGeometry(14.6, len, 20, Math.max(2, Math.round(len / 0.6))).rotateX(-Math.PI / 2).translate(0, WATER_Y, -len / 2);
  const surfMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, fogUniforms, common), fog: true, transparent: true, depthWrite: false,
    vertexShader: `#include <common>
#include <fog_pars_vertex>
uniform float uTime; varying vec3 vW;
float waveH(vec2 p, float t){ return 0.030 * sin(dot(p, vec2(0.9, 0.5)) * 1.1 + t * 1.6) + 0.022 * sin(dot(p, vec2(-0.4, 1.0)) * 1.9 + t * 2.1) + 0.010 * sin(dot(p, vec2(1.3, -0.8)) * 3.1 + t * 2.8); }
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y += waveH(w.xz, uTime) * (1.0 - smoothstep(5.5, 7.3, abs(w.x)) * 0.7);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `precision highp float;
#include <common>
#include <fog_pars_fragment>
uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam; uniform vec3 uSkyH; uniform vec3 uSkyZ; uniform vec3 uSunDir; uniform vec3 uSunCol;
varying vec3 vW;
${noise}
void main(){
  vec2 p = vW.xz; float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(0.9, 0.5) * (0.060 * cos(dot(p, vec2(0.9, 0.5)) * 1.1 + t * 1.6));
  g += vec2(-0.4, 1.0) * (0.050 * cos(dot(p, vec2(-0.4, 1.0)) * 1.9 + t * 2.1));
  g += vec2(1.3, -0.8) * (0.030 * cos(dot(p, vec2(1.3, -0.8)) * 3.1 + t * 2.8));
  vec2 q = p * vec2(2.3, 1.7) + vec2(t * 0.45, -t * 0.3);
  float e = 0.1, n0 = vnoise(q);
  g += vec2(vnoise(q + vec2(e, 0.0)) - n0, vnoise(q + vec2(0.0, e)) - n0) / e * 0.10;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.05 + 0.62 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
  float ax = abs(vW.x) / 7.3;
  vec3 body = mix(uDeep * 1.15, uShallow, 0.15 + 0.75 * smoothstep(0.25, 1.0, ax));
  body *= 0.88 + 0.28 * clamp(n0 * 1.6 - 0.1 + g.x * 2.0, 0.0, 1.0);
  vec3 R = reflect(-V, n); R.y = abs(R.y);
  vec3 refl = mix(uSkyH, uSkyZ, clamp(R.y * 2.0, 0.0, 1.0));
  vec3 col = mix(body, refl, fres);
  float sd = max(dot(R, uSunDir), 0.0);
  float sp = smoothstep(0.62, 0.92, vnoise(p * 3.6 + vec2(t * 0.8, t * 0.5)));
  col += uSunCol * (pow(sd, 90.0) * (0.35 + 0.9 * sp) + pow(sd, 14.0) * 0.12);
  // twinkling sparkles
  float tw = smoothstep(0.93, 1.0, vnoise(p * 9.0 + vec2(0.0, t * 1.5))) * smoothstep(0.55, 1.0, vnoise(p * 1.3 - t * 0.2));
  col += vec3(1.0) * tw * 0.55;
  // foam: both banks + soft wind streaks
  float edge = smoothstep(5.4, 7.15, abs(vW.x));
  float fn = vnoise(p * vec2(1.3, 0.9) + vec2(0.0, t * 0.35));
  float foam = edge * smoothstep(0.30, 0.75, fn + edge * 0.35);
  foam += smoothstep(6.9, 7.3, abs(vW.x)) * 0.55;
  float streak = smoothstep(0.72, 0.95, vnoise(p * vec2(0.55, 0.16) + vec2(t * 0.05, -t * 0.4))) * 0.35;
  foam = clamp(foam + streak, 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.85);
  float alpha = clamp(0.62 + fres * 0.30 + foam * 0.35, 0.0, 0.96);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  // ---- sea floor with caustics (opaque, darker, seen through the water)
  const floorGeo = new THREE.PlaneGeometry(15.8, len, 1, 1).rotateX(-Math.PI / 2).translate(0, -1.7, -len / 2);
  const floorMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), common), fog: true,
    vertexShader: `#include <common>
#include <fog_pars_vertex>
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `precision highp float;
#include <common>
#include <fog_pars_fragment>
uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep;
varying vec3 vW;
${noise}
float caus(vec2 p, float t){
  vec2 q = p * 0.85;
  float a = sin(q.x * 3.1 + t * 1.1 + sin(q.y * 2.6 + t * 0.8));
  float b = sin(q.y * 3.4 - t * 0.9 + sin(q.x * 2.2 - t * 0.6));
  float c = 1.0 - abs(a * b);
  return pow(c, 7.0);
}
void main(){
  vec2 p = vW.xz; float t = uTime;
  float ax = abs(vW.x) / 7.3;
  vec3 base = mix(uDeep * 0.42, uShallow * 0.55, smoothstep(0.35, 1.0, ax) * 0.8);
  base *= 0.85 + 0.3 * vnoise(p * 0.7);
  float c = caus(p, t) * 0.8 + caus(p * 1.7 + 4.0, t * 1.3) * 0.5;
  vec3 col = base + uShallow * c * 0.22;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  // ---- buoy chains (merged, vertex coloured, bobbing in the vertex shader)
  const parts = [];
  const mk = (g, x, y, z, c) => {
    g = g.index ? g.toNonIndexed() : g;
    g.translate(x, y, z);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = C(c);
    for (let i = 0; i < n; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  };
  const step = 2.5, count = Math.floor(len / step);
  for (const x of [-1.2, 1.2]) {
    for (let i = 0; i < count; i++) {
      const z = -(i + 0.5) * step, red = i % 2 === 0;
      mk(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.9, 1), x, WATER_Y + 0.02, z, red ? 0xff4d2e : 0xffffff);
      mk(new THREE.ConeGeometry(0.11, 0.26, 6), x, WATER_Y + 0.31, z, red ? 0xffffff : 0xff4d2e);
      mk(new THREE.SphereGeometry(0.05, 5, 4), x, WATER_Y + 0.47, z, 0xffe14d);
      mk(new THREE.BoxGeometry(0.035, 0.03, step - 0.4), x, WATER_Y - 0.02, z - step / 2, 0x3a3f4a);
    }
  }
  const buoyGeo = mergeGeometries(parts, false);
  const buoyMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a2a2a });
  buoyMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 wp = modelMatrix * vec4(transformed, 1.0); transformed.y += sin(uTime * 1.9 + wp.z * 0.8 + wp.x * 1.7) * 0.05 + sin(uTime * 3.1 + wp.z * 1.7) * 0.015; }`);
  };
  buoyMat.customProgramCacheKey = () => 'hopinet-buoy';
  return { surfGeo, surfMat, floorGeo, floorMat, buoyGeo, buoyMat };
}

export function makeWaterTile(world, len = 30) {
  const key = world.id + ':' + len;
  let a = _waterCache.get(key);
  if (!a) { a = buildWaterAssets(world, len); _waterCache.set(key, a); }
  const g = new THREE.Group();
  g.name = 'waterTile';
  const floor = new THREE.Mesh(a.floorGeo, a.floorMat); floor.renderOrder = -5;
  const surf = new THREE.Mesh(a.surfGeo, a.surfMat); surf.renderOrder = 2;
  const buoys = new THREE.Mesh(a.buoyGeo, a.buoyMat);
  floor.frustumCulled = surf.frustumCulled = buoys.frustumCulled = false;
  g.add(floor, surf, buoys);
  return g;
}
