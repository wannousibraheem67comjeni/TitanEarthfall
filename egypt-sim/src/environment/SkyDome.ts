/**
 * Physically based sky: single Rayleigh + Mie scattering ray-marched through a
 * spherical atmosphere (Nishita), with the same coefficients as aerial perspective
 * so the horizon haze and the terrain fade agree. Includes the sun disc, a dim
 * night sky, and a starfield that fades in with darkness.
 */
import {
  AdditiveBlending, BackSide, BufferGeometry, Float32BufferAttribute, Mesh, Points, ShaderMaterial, SphereGeometry,
  type Camera,
} from 'three';
import { atmosphereUniforms } from './atmosphere';
import { Rng } from '../core/rng';

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDirection;
uniform vec3 uSunIlluminance;
uniform vec3 uBetaR;
uniform vec3 uBetaMs;
uniform vec3 uBetaMe;
uniform float uMieG;
uniform float uMieMulti;
uniform float uHR;
uniform float uHM;
uniform float uNight;
uniform float uCameraHeight;
varying vec3 vDir;

const float RE = 6371e3;
const float RA = 6471e3;

vec2 raySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e12, -1e12);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 o = vec3(0.0, RE + max(uCameraHeight, 2.0), 0.0);
  vec2 ta = raySphere(o, dir, RA);
  vec3 col = vec3(0.0);
  if (ta.y > 0.0) {
    float t0 = max(ta.x, 0.0);
    float t1 = ta.y;
    vec2 tg = raySphere(o, dir, RE);
    // raySphere() reports a miss as (1e12, −1e12): require a real hit in front of us.
    bool ground = tg.x > 0.0 && tg.y > 0.0;
    if (ground) t1 = tg.x;
    // Quadratic sample spacing (dense near the camera) and midpoint optical depth:
    // grazing rays span ~1,000 km, and uniform steps would over-attenuate the first
    // segment and paint a dark band along the horizon.
    const int N = 24;
    const int M = 8;
    float span = t1 - t0;
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float odR = 0.0;
    float odM = 0.0;
    for (int i = 0; i < N; i++) {
      float a = float(i) / float(N);
      float b = float(i + 1) / float(N);
      float ds = span * (b * b - a * a);
      vec3 p = o + dir * (t0 + span * (0.5 * (a * a + b * b)));
      float h = max(length(p) - RE, 0.0);
      float dR = exp(-h / uHR) * ds;
      float dM = exp(-h / uHM) * ds;
      vec2 tl = raySphere(p, uSunDirection, RA);
      float lR = 0.0;
      float lM = 0.0;
      bool shadow = false;
      for (int j = 0; j < M; j++) {
        float la = float(j) / float(M);
        float lb = float(j + 1) / float(M);
        float dsl = tl.y * (lb * lb - la * la);
        vec3 q = p + uSunDirection * (tl.y * 0.5 * (la * la + lb * lb));
        float hq = length(q) - RE;
        if (hq < 0.0) { shadow = true; break; }
        lR += exp(-hq / uHR) * dsl;
        lM += exp(-hq / uHM) * dsl;
      }
      if (!shadow) {
        vec3 att = exp(-(uBetaR * (odR + 0.5 * dR + lR) + uBetaMe * (odM + 0.5 * dM + lM)));
        sumR += att * dR;
        sumM += att * dM;
      }
      odR += dR;
      odM += dM;
    }
    float mu = dot(dir, uSunDirection);
    float pR = 0.0596831 * (1.0 + mu * mu);
    float g = uMieG;
    float pM = 0.1193662 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
    pM = mix(pM, 0.0795775, uMieMulti); // multiple-scattering approximation (see atmosphere.ts)
    col = uSunIlluminance * (sumR * uBetaR * pR + sumM * uBetaMs * pM);
    vec3 T = exp(-(uBetaR * odR + uBetaMe * odM));
    if (ground) {
      // Beyond the simulated terrain: a hazy desert/sea ground lit by the sun.
      vec3 n = normalize(o + dir * t1);
      col += vec3(0.32, 0.27, 0.2) * T * uSunIlluminance * max(dot(n, uSunDirection), 0.0) * 0.012;
    } else {
      float sun = smoothstep(0.99996, 0.999985, mu);
      col += uSunIlluminance * T * sun * 40.0;
    }
  }
  col += vec3(0.0015, 0.0025, 0.006) * uNight;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SkyDome {
  readonly mesh: Mesh;
  readonly stars: Points;
  private readonly uniforms: Record<string, { value: unknown }>;

  constructor() {
    this.uniforms = { ...atmosphereUniforms, uCameraHeight: { value: 2 } };
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';

    const rng = new Rng(4242);
    const pos: number[] = [];
    const mag: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const u = rng.next() * 2 - 1;
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.push(Math.cos(a) * r * 900, u * 900, Math.sin(a) * r * 900);
      mag.push(Math.pow(rng.next(), 6));
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aMag', new Float32BufferAttribute(mag, 1));
    this.stars = new Points(g, new ShaderMaterial({
      uniforms: { uNight: atmosphereUniforms.uNight },
      vertexShader: /* glsl */ `attribute float aMag; varying float vMag; void main() { vMag = aMag; gl_PointSize = 1.0 + aMag * 2.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uNight; varying float vMag; void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(vec3(0.8, 0.85, 1.0) * (0.25 + vMag), a * uNight); }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
  }

  update(camera: Camera, cameraHeight: number): void {
    this.mesh.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.uniforms.uCameraHeight.value = cameraHeight;
    // Stars hide above the horizon line only; they are drawn behind everything.
    this.stars.visible = (atmosphereUniforms.uNight.value as number) > 0.02;
  }
}

