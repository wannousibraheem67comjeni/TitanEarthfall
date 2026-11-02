/**
 * City materials: procedural facades (windows, floor slabs, brick infill, glass
 * curtain walls, stone coursing) evaluated per fragment from wall-space coordinates,
 * with time-of-day window lighting; road/park/plaza decals; palms; street lamps.
 */
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute,
  MeshStandardMaterial, PointsMaterial, DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { injectAtmosphere } from '../environment/atmosphere';

export const cityUniforms = {
  /** Fraction of windows lit (varies through the night). */
  uWindowLit: { value: 0.4 },
};

const HASH_GLSL = /* glsl */ `
float cHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float cHash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// Anti-aliased box mask of x in [a, b] (fades to coverage when sub-pixel).
float cBand(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
`;

/** @param instanced build the variant for InstancedMesh (ships, sphinx avenue). */
export function createBuildingMaterial(instanced = false): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    injectAtmosphere(shader, instanced);
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aColor;\nattribute vec3 aFacade;\nvarying vec4 vColor4;\nvarying vec3 vFacade;\nvarying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvColor4 = aColor; vFacade = aFacade; vUp = normal.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 vColor4;
varying vec3 vFacade;
varying float vUp;
uniform float uWindowLit;
${HASH_GLSL}
float bWin = 0.0;
float bLit = 0.0;
float bStyle = 0.0;
vec3 bLitColor = vec3(1.0, 0.75, 0.45);`,
      )
      .replace('#include <color_fragment>', FACADE_GLSL)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, bStyle == 2.0 ? 0.12 : 0.25, bWin);\nif (bStyle == 5.0) roughnessFactor = 0.05;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += bLitColor * bLit * uNight * 0.7;
if (bStyle == 5.0) totalEmissiveRadiance += vec3(0.05, 0.35, 0.45) * (0.15 + uNight * 0.8);`,
      );
  };
  m.customProgramCacheKey = () => (instanced ? 'egypt-building-inst-v1' : 'egypt-building-v1');
  return m;
}

const FACADE_GLSL = /* glsl */ `
{
  bStyle = floor(vColor4.a * 255.0 + 0.5);
  vec3 base = vColor4.rgb;
  float u = vFacade.x;
  float v = vFacade.y;
  float seed = vFacade.z;
  bool wall = v > -0.5 && abs(vUp) < 0.5 && bStyle < 4.5;
  if (bStyle == 5.0) {
    base = vec3(0.12, 0.6, 0.72);
  } else if (bStyle == 6.0) {
    // Dressed stone: ~1.1 m courses in world space (works on sloped pyramid faces too).
    float y = vApWorld.y;
    float aa = clamp(fwidth(y / 1.1) * 1.5, 0.002, 0.5);
    float course = cBand(fract(y / 1.1), 0.0, 0.92, aa);
    float blockId = cHash2(floor(vec2((vApWorld.x + vApWorld.z) / 1.7, y / 1.1)));
    base *= mix(0.9, 0.84 + 0.16 * course, 1.0 - smoothstep(0.2, 0.5, aa));
    base *= 0.93 + 0.12 * blockId;
  } else if (bStyle == 7.0) {
    base *= 0.94 + 0.1 * cHash2(floor(vApWorld.xz * 0.25 + vApWorld.y * 0.5));
  } else if (wall) {
    float floorH = bStyle == 2.0 ? 3.8 : 3.2;
    float bay = bStyle == 2.0 ? 1.8 : bStyle == 3.0 ? 2.8 : 3.4;
    float fl = floor(v / floorH);
    float fv = fract(v / floorH);
    float col = floor(u / bay);
    float fu = fract(u / bay);
    float aa = clamp(fwidth(u / bay) * 1.5, 0.002, 0.5);
    float aav = clamp(fwidth(v / floorH) * 1.5, 0.002, 0.5);
    float win;
    if (bStyle == 2.0) {
      // Curtain wall: glass with thin mullions and spandrels.
      win = cBand(fu, 0.05, 0.95, aa) * cBand(fv, 0.12, 0.96, aav);
      base = mix(base, vec3(0.62, 0.66, 0.7), 0.35);
    } else if (fl < 0.5 && bStyle != 4.0) {
      // Ground-floor shopfronts / doors.
      win = cBand(fu, 0.1, 0.9, aa) * cBand(fv, 0.05, 0.78, aav) * step(0.35, cHash(vec3(col, seed * 97.0, 3.0)));
    } else {
      win = cBand(fu, 0.28, 0.72, aa) * cBand(fv, 0.3, 0.8, aav);
    }
    if (bStyle == 0.0) {
      // Concrete frame (slabs + columns) with red-brick infill.
      float slab = 1.0 - cBand(fv, 0.09, 1.0, aav);
      float column = 1.0 - cBand(fu, 0.05, 0.95, aa);
      float frame = max(slab, column);
      float course = cBand(fract(v * 3.6 + step(0.5, fract(u * 0.9)) * 0.5), 0.0, 0.88, aav * 3.6);
      vec3 brick = base * (0.86 + 0.14 * course) * (0.92 + 0.16 * cHash(vec3(floor(u * 0.9), floor(v * 3.6), seed)));
      base = mix(brick, vec3(0.6, 0.58, 0.55), frame);
      win *= 1.0 - frame;
    } else if (bStyle == 3.0) {
      float course = cBand(fract(v / 0.6), 0.0, 0.92, aav * 5.0);
      base *= 0.9 + 0.1 * course;
    }
    // Weathering: darker toward the ground, streaks per bay.
    base *= 0.88 + 0.12 * smoothstep(0.0, 6.0, v);
    base *= 0.95 + 0.1 * cHash(vec3(col, 0.0, seed));
    vec3 glass = bStyle == 2.0 ? vec3(0.1, 0.16, 0.2) : vec3(0.05, 0.06, 0.07);
    base = mix(base, glass, win);
    bWin = win;
    float litShare = uWindowLit * (bStyle == 2.0 ? 1.3 : 1.0);
    float lit = step(cHash(vec3(col, fl, seed * 131.0)), litShare);
    // Once windows are sub-pixel, per-window hashing aliases into stripes: use the mean.
    bLit = win * mix(lit, litShare, smoothstep(0.08, 0.3, max(aa, aav)));
    bLitColor = cHash(vec3(fl, seed, col * 0.13)) > 0.7 ? vec3(0.8, 0.86, 1.0) : vec3(1.0, 0.72, 0.42);
  } else {
    // Roofs: concrete / parapet tone with grime.
    float g = cHash2(floor(vApWorld.xz * 0.5));
    base *= 0.9 + 0.12 * g;
  }
  diffuseColor.rgb = base;
}
`;

export function createGroundMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (shader) => {
    injectAtmosphere(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aColor;\nattribute vec3 aFacade;\nvarying vec4 vColor4;\nvarying vec3 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvColor4 = aColor; vFacade = aFacade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vColor4;\nvarying vec3 vFacade;\n${HASH_GLSL}`)
      .replace('#include <color_fragment>', GROUND_GLSL);
  };
  m.customProgramCacheKey = () => 'egypt-ground-v1';
  return m;
}

const GROUND_GLSL = /* glsl */ `
{
  float style = floor(vColor4.a * 255.0 + 0.5);
  vec3 c = vColor4.rgb;
  if (style == 10.0 || style == 11.0) {
    float along = vFacade.x;
    float across = vFacade.y;
    float hw = vFacade.z * 0.5;
    float aa = clamp(fwidth(across) * 1.2, 0.02, 2.0);
    float grit = cHash2(floor(vApWorld.xz * 2.0));
    c = vec3(0.19, 0.19, 0.2) * (0.9 + 0.2 * grit);
    // Kerbs, edge lines and (on avenues) a dashed centre line.
    float kerb = 1.0 - cBand(abs(across), 0.0, hw - 0.4, aa);
    float edge = cBand(abs(across), hw - 1.0, hw - 0.85, aa);
    float dash = step(0.5, fract(along / 6.0));
    float centre = style == 11.0 ? cBand(abs(across), 0.0, 0.12, aa) * dash : 0.0;
    float fade = 1.0 - smoothstep(0.2, 1.5, aa);
    c = mix(c, vec3(0.62, 0.6, 0.56), kerb);
    c = mix(c, vec3(0.85, 0.84, 0.78), (edge * step(5.0, hw) + centre) * fade);
  } else if (style == 12.0) {
    float n = cHash2(floor(vApWorld.xz * 0.7));
    c = mix(vec3(0.22, 0.34, 0.14), vec3(0.3, 0.42, 0.18), n);
  } else if (style == 13.0) {
    vec2 tile = floor(vApWorld.xz / 1.2);
    c *= 0.9 + 0.15 * cHash2(tile);
  }
  diffuseColor.rgb = c;
}
`;

/** One palm: tapering trunk and drooping fronds, vertex-coloured, merged. */
export function createPalmGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.18, 0.28, 9, 6, 1, true).translate(0, 4.5, 0);
  paint(trunk, new Color(0.42, 0.32, 0.22));
  const parts: BufferGeometry[] = [trunk];
  for (let i = 0; i < 8; i++) {
    const frond = new ConeGeometry(0.55, 4.2, 3, 1, true);
    frond.scale(1, 1, 0.25);
    // Wide base at the crown, tip pointing outward and drooping below horizontal.
    frond.translate(0, 2.1, 0);
    frond.rotateZ(-(Math.PI / 2 + 0.3 + (i % 2) * 0.2));
    frond.rotateY((i / 8) * Math.PI * 2);
    frond.translate(0, 9, 0);
    paint(frond, new Color(0.2 + (i % 3) * 0.03, 0.36, 0.12));
    parts.push(frond);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

function paint(g: BufferGeometry, c: Color): void {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
}

export function createPalmMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide });
  m.onBeforeCompile = (shader) => injectAtmosphere(shader, true);
  m.customProgramCacheKey = () => 'egypt-palm-v1';
  return m;
}

/** Additive glow sprites for street lamps (opacity follows night). */
export function createLampMaterial(): PointsMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,240,210,1)');
  g.addColorStop(0.2, 'rgba(255,190,110,0.6)');
  g.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new PointsMaterial({
    size: 14, sizeAttenuation: true, map: new CanvasTexture(c), color: new Color(1, 0.8, 0.55),
    transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0,
  });
}
