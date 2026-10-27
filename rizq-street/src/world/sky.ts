/**
 * Sky dome, sun, moon and stars, and the lighting that follows the clock: hot white
 * noon, golden hour, blue dusk and lamp-lit nights.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
} from 'three';
import { Rng } from '../core/rng';
import { clamp, lerp, smoothstep } from '../core/math';
import { nightGlow } from './materials';
import { glowTexture } from './textures';

interface Key {
  h: number;
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  fog: string;
}

/** Colour keys through the day (hour of day → look). */
const KEYS: Key[] = [
  { h: 0, zenith: '#050a1a', horizon: '#1a2238', sun: '#9fb2e6', sunI: 0.7, hemiSky: '#5a6ea8', hemiGround: '#4a3a2a', hemiI: 1.25, fog: '#141b2e' },
  { h: 5, zenith: '#0b1530', horizon: '#3a3550', sun: '#a6b0dc', sunI: 0.6, hemiSky: '#66729c', hemiGround: '#4a3a2a', hemiI: 1.2, fog: '#2b2e44' },
  { h: 6.2, zenith: '#3a5d94', horizon: '#f2a46b', sun: '#ffb070', sunI: 1.2, hemiSky: '#9bb4d8', hemiGround: '#a07a50', hemiI: 0.7, fog: '#d9a982' },
  { h: 8, zenith: '#3f7fc4', horizon: '#cfe0ea', sun: '#fff1d6', sunI: 2.6, hemiSky: '#bcd6ef', hemiGround: '#c9a878', hemiI: 0.95, fog: '#d8dfe0' },
  { h: 13, zenith: '#3a79c2', horizon: '#e8e4d8', sun: '#fffaf0', sunI: 3.3, hemiSky: '#cfe2f5', hemiGround: '#d8b98a', hemiI: 1.05, fog: '#e6e0d0' },
  { h: 16.5, zenith: '#4a7fbe', horizon: '#f0d6a8', sun: '#ffe2b0', sunI: 2.6, hemiSky: '#c4d6ea', hemiGround: '#d0a874', hemiI: 0.9, fog: '#e9d4b0' },
  { h: 18.2, zenith: '#2d4a80', horizon: '#ff9a5a', sun: '#ff8a4a', sunI: 1.3, hemiSky: '#8a8fb8', hemiGround: '#9a6a44', hemiI: 0.65, fog: '#d48a62' },
  { h: 19.3, zenith: '#101c3d', horizon: '#5a3d5e', sun: '#a99fd8', sunI: 0.7, hemiSky: '#6474a8', hemiGround: '#4a3a2a', hemiI: 1.3, fog: '#3a3048' },
  { h: 24, zenith: '#050a1a', horizon: '#1a2238', sun: '#9fb2e6', sunI: 0.7, hemiSky: '#5a6ea8', hemiGround: '#4a3a2a', hemiI: 1.25, fog: '#141b2e' },
];

const ca = new Color();
const cb = new Color();
function mix(a: string, b: string, t: number, out: Color): Color {
  return out.copy(ca.set(a)).lerp(cb.set(b), t);
}

export class Sky {
  readonly sun = new DirectionalLight('#ffffff', 3);
  readonly hemi = new HemisphereLight('#bcd6ef', '#c9a878', 1);
  readonly fog = new Fog('#e6e0d0', 70, 300);
  private readonly dome: Mesh;
  private readonly uniforms = {
    zenith: { value: new Color() },
    horizon: { value: new Color() },
    sunDir: { value: new Vector3(0, 1, 0) },
    sunColor: { value: new Color() },
    night: { value: 0 },
  };
  private readonly stars: Points;
  private readonly sunSprite: Sprite;
  private readonly moonSprite: Sprite;
  /** 0 at day, 1 at full night: drives lamps, windows and headlights. */
  night = 0;
  readonly sunDirection = new Vector3();

  constructor(scene: Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -48;
    cam.right = cam.top = 48;
    cam.near = 1;
    cam.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;

    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          float t = pow(clamp(h, 0.0, 1.0), 0.45);
          vec3 col = mix(horizon, zenith, t);
          col = mix(col, horizon * 0.75, smoothstep(0.0, -0.2, h));
          float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * (pow(sd, 600.0) * 2.5 + pow(sd, 12.0) * 0.25) * (1.0 - night * 0.8);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new Mesh(new SphereGeometry(900, 32, 16), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    const rng = new Rng(5);
    const pos: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const u = rng.next();
      const v = rng.range(0.05, 1);
      const th = u * Math.PI * 2;
      const r = Math.sqrt(1 - v * v);
      pos.push(Math.cos(th) * r * 850, v * 850, Math.sin(th) * r * 850);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.stars = new Points(sg, new PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.sunSprite = new Sprite(new SpriteMaterial({ map: glowTexture(), color: '#fff3d0', blending: AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
    this.sunSprite.scale.setScalar(90);
    this.moonSprite = new Sprite(new SpriteMaterial({ map: glowTexture(), color: '#dfe8ff', blending: AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
    this.moonSprite.scale.setScalar(40);
    scene.add(this.sunSprite, this.moonSprite);
  }

  /** Recolour everything for the given hour; `center` keeps the shadow box on the player. */
  update(hour: number, center: Vector3, cameraPos: Vector3): void {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= hour) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = clamp((hour - a.h) / (b.h - a.h), 0, 1);
    mix(a.zenith, b.zenith, t, this.uniforms.zenith.value);
    mix(a.horizon, b.horizon, t, this.uniforms.horizon.value);
    mix(a.sun, b.sun, t, this.sun.color);
    this.uniforms.sunColor.value.copy(this.sun.color);
    this.sun.intensity = lerp(a.sunI, b.sunI, t);
    mix(a.hemiSky, b.hemiSky, t, this.hemi.color);
    mix(a.hemiGround, b.hemiGround, t, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t);
    mix(a.fog, b.fog, t, this.fog.color);

    // Sun path: rises in the east (+x), sets in the west, tilted south (+z) a little.
    const dayT = (hour - 6) / 12.5;
    const ang = dayT * Math.PI;
    const up = Math.sin(ang);
    if (up > -0.05) this.sunDirection.set(Math.cos(ang), Math.max(up, 0.06), 0.35).normalize();
    else {
      // Moon light from the opposite side at night.
      const nightT = ((hour + 24 - 18.5) % 24) / 11.5;
      const na = nightT * Math.PI;
      this.sunDirection.set(-Math.cos(na) * 0.8, Math.max(Math.sin(na), 0.25), -0.3).normalize();
    }
    this.uniforms.sunDir.value.copy(this.sunDirection);
    this.night = 1 - smoothstep(-0.08, 0.18, up);
    this.uniforms.night.value = this.night;

    this.sun.position.copy(center).addScaledVector(this.sunDirection, 120);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();

    this.dome.position.copy(cameraPos);
    this.stars.position.copy(cameraPos);
    (this.stars.material as PointsMaterial).opacity = this.night * 0.9;
    const sunVisible = up > -0.05;
    this.sunSprite.visible = sunVisible;
    this.sunSprite.position.copy(cameraPos).addScaledVector(this.sunDirection, 700);
    this.moonSprite.visible = !sunVisible;
    this.moonSprite.position.copy(cameraPos).addScaledVector(this.sunDirection, 700);

    for (const g of nightGlow) {
      if ('emissiveIntensity' in g.material) g.material.emissiveIntensity = g.max * (0.08 + 0.92 * this.night);
    }
  }
}
