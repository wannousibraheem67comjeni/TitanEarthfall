/**
 * Terrain material: MeshStandardMaterial (so shadows, lights and tone mapping come
 * for free) patched with procedural surfacing:
 *   - albedo from per-vertex classification (fertility, urban, rock, sand, foreign),
 *     blended with the macro texture on coarse nodes
 *   - field parcels in farmland, dune streaks, rock strata, urban fabric
 *   - water: depth colour, animated wave normals, sky fresnel, shore foam, wet sand
 *   - night lights from urban density; aerial perspective; optional satellite imagery
 */
import { Color, MeshStandardMaterial, Texture, Vector4 } from 'three';
import { injectAtmosphere } from '../environment/atmosphere';
import { SLOPE_RANGE } from './reliefTextures';

export interface TerrainUniforms {
  uMacro: { value: Texture | null };
  /** west, north, lonSpan, latSpan of the macro texture. */
  uMacroRect: { value: Vector4 };
  /** Camera-centred imagery mosaics (fine near field, coarse far field). */
  uImgNear: { value: Texture | null };
  uImgFar: { value: Texture | null };
  /** west, north, lonSpan, latSpan of each mosaic (latSpan 0 = not loaded). */
  uImgNearRect: { value: Vector4 };
  uImgFarRect: { value: Vector4 };
  uImageryMix: { value: number };
  uSkyReflect: { value: Color };
  /** Relief textures (see reliefTextures.ts) and their lon/lat rects. */
  uNat: { value: Texture | null };
  uNatRect: { value: Vector4 };
  uCtx: { value: Texture | null };
  uCtxRect: { value: Vector4 };
}

const NOISE_GLSL = /* glsl */ `
float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}
float tFbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * tNoise(p); p *= 2.03; a *= 0.5; } return s; }
// Mosaics are small enough that latitude maps linearly onto their Mercator rows.
vec2 tMosaicUv(vec4 rect, vec2 lonLat) { return vec2((lonLat.x - rect.x) / rect.z, (rect.y - lonLat.y) / max(rect.w, 1e-9)); }
float tInside(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
`;

export function createTerrainMaterial(): { material: MeshStandardMaterial; uniforms: TerrainUniforms } {
  const material = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const uniforms: TerrainUniforms = {
    uMacro: { value: null },
    uMacroRect: { value: new Vector4(0, 0, 1, 1) },
    uImgNear: { value: null },
    uImgFar: { value: null },
    uImgNearRect: { value: new Vector4(0, 0, 1, 0) },
    uImgFarRect: { value: new Vector4(0, 0, 1, 0) },
    uImageryMix: { value: 0 },
    uSkyReflect: { value: new Color(0.45, 0.6, 0.8) },
    uNat: { value: null },
    uNatRect: { value: new Vector4(0, 0, 1, 1) },
    uCtx: { value: null },
    uCtxRect: { value: new Vector4(0, 0, 1, 1) },
  };

  material.onBeforeCompile = (shader) => {
    injectAtmosphere(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aSurfA;
attribute vec4 aSurfB;
attribute vec4 aGeo;
varying vec4 vSurfA;
varying vec4 vSurfB;
varying vec4 vGeo;`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfA = aSurfA; vSurfB = aSurfB; vGeo = aGeo;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 vSurfA;
varying vec4 vSurfB;
varying vec4 vGeo;
uniform sampler2D uMacro;
uniform vec4 uMacroRect;
uniform sampler2D uImgNear;
uniform sampler2D uImgFar;
uniform vec4 uImgNearRect;
uniform vec4 uImgFarRect;
uniform float uImageryMix;
uniform vec3 uSkyReflect;
uniform sampler2D uNat;
uniform vec4 uNatRect;
uniform sampler2D uCtx;
uniform vec4 uCtxRect;
${NOISE_GLSL}
float tCoarse = 0.0;
vec3 tReliefNormal = vec3(0.0, 1.0, 0.0);
vec3 tBump = vec3(0.0);
float tWater = 0.0;
float tWaterDepth = 0.0;
float tShore = 0.0;
float tUrban = 0.0;
float tKind = 0.0;
vec3 tWaveNormal = vec3(0.0, 1.0, 0.0);`,
      )
      .replace('#include <color_fragment>', TERRAIN_ALBEDO)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.07, tWater);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize(mix(normal, normalize((viewMatrix * vec4(tReliefNormal, 0.0)).xyz), tCoarse * (1.0 - tWater)));
normal = normalize(normal + (viewMatrix * vec4(tBump, 0.0)).xyz);
normal = normalize(mix(normal, normalize((viewMatrix * vec4(tWaveNormal, 0.0)).xyz), tWater));`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + TERRAIN_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'egypt-terrain-v2';
  return { material, uniforms };
}

const TERRAIN_ALBEDO = /* glsl */ `
{
  vec2 wp = vApWorld.xz;
  float camDist = length(vApWorld - cameraPosition);
  float spacing = exp2(vSurfB.y * 255.0 / 16.0);
  // Coarse nodes (vertices ≥ ~1 km apart) take surface, water and relief from textures.
  tCoarse = smoothstep(700.0, 3500.0, spacing);
  vec2 muv = tMosaicUv(uMacroRect, vGeo.xy);
  float inMacro = tInside(muv);
  vec4 macro = texture2D(uMacro, muv);
  vec2 nuv = tMosaicUv(uNatRect, vGeo.xy);
  float inNat = tInside(nuv);
  vec4 nat = texture2D(uNat, nuv);
  vec4 ctx = texture2D(uCtx, tMosaicUv(uCtxRect, vGeo.xy));
  float macroW = tCoarse * inMacro;

  float fert = mix(vSurfA.x, macro.r, macroW);
  float urban = mix(vSurfA.y, macro.g, macroW);
  float rock = mix(vSurfA.z, macro.b, macroW);
  float sand = vSurfA.w;
  float foreign = mix(vSurfB.x, inNat > 0.5 ? 1.0 - nat.b : 1.0, tCoarse);
  vec2 slope = ((inNat > 0.5 ? nat.rg : ctx.rg) - 0.5) * 2.0 * ${SLOPE_RANGE.toFixed(2)};
  tReliefNormal = normalize(vec3(-slope.x * 2.2, 1.0, -slope.y * 2.2));
  tKind = floor(vSurfB.z * 255.0 / 85.0 + 0.5);
  tWaterDepth = mix(vGeo.z, 80.0, tCoarse);
  tShore = vGeo.w;
  float coverage = inMacro > 0.5 ? macro.a : ctx.b;
  // The signed shore distance interpolates linearly, so its zero crossing traces the true
  // shoreline between vertices (no sawtooth along triangle edges).
  float shoreAA = max(fwidth(tShore), 0.5);
  float vertexWater = smoothstep(shoreAA, -shoreAA, tShore);
  tWater = mix(vertexWater, smoothstep(0.35, 0.65, coverage), tCoarse);
  tUrban = urban;

  // Fade high-frequency detail by its screen footprint (metres per pixel, which grows
  // fast at grazing angles) so parcels and grain never alias into streaks.
  float pix = max(length(fwidth(wp)), camDist * 0.0008);
  float n1 = tFbm(wp * 0.00025);
  float n2 = tNoise(wp * 0.004);
  float n2f = mix(n2, 0.5, smoothstep(60.0, 250.0, pix));
  float n3 = mix(tNoise(wp * 0.05), 0.5, smoothstep(4.0, 16.0, pix));

  vec3 desert = mix(vec3(0.74, 0.6, 0.42), vec3(0.86, 0.74, 0.55), n1);
  desert = mix(desert, vec3(0.9, 0.68, 0.42), sand * (0.55 + 0.3 * n2f));
  desert *= 0.94 + 0.12 * n3;
  // Chalky plateaus read paler; high basement rock (Sinai, Red Sea Hills) darker and redder.
  vec3 rockC = mix(vec3(0.5, 0.41, 0.33), vec3(0.62, 0.52, 0.42), n2f);
  // Basement granite of Sinai and the Red Sea Hills is dark and reddish.
  rockC = mix(rockC, vec3(0.3, 0.22, 0.19), smoothstep(500.0, 1400.0, vApWorld.y));
  // Rugged micro-relief on rock, scaled to the pixel footprint so it reads at any range.
  {
    // Two octaves only, the finer one still ≥ ~3 px wide: more octaves alias into speckle.
    float bs = max(pix * 7.0, 25.0);
    vec2 bp = wp / bs;
    float b0 = tNoise(bp) + 0.45 * tNoise(bp * 2.1 + 7.3);
    float bx = tNoise(bp + vec2(0.08, 0.0)) + 0.45 * tNoise((bp + vec2(0.08, 0.0)) * 2.1 + 7.3);
    float bz = tNoise(bp + vec2(0.0, 0.08)) + 0.45 * tNoise((bp + vec2(0.0, 0.08)) * 2.1 + 7.3);
    tBump = vec3(-(bx - b0), 0.0, -(bz - b0)) * 4.0 * rock * (1.0 - tWater) * (1.0 - tCoarse);
  }
  rockC *= 0.9 + 0.2 * n3;

  // Farmland: rotated parcels with crop / fallow / orchard variety, averaged when sub-pixel.
  float ang = (tNoise(wp * 0.00015) - 0.5) * 1.6;
  mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 fp = R * wp;
  vec2 cell = floor(fp / vec2(90.0, 48.0));
  float h = tHash(cell);
  vec3 crop = h < 0.45 ? mix(vec3(0.16, 0.3, 0.09), vec3(0.24, 0.38, 0.12), tHash(cell + 7.1))
            : h < 0.7 ? vec3(0.34, 0.42, 0.16)
            : h < 0.85 ? vec3(0.48, 0.4, 0.26)
            : vec3(0.12, 0.22, 0.08);
  vec2 fe = abs(fract(fp / vec2(90.0, 48.0)) - 0.5);
  float ditch = smoothstep(0.47, 0.5, max(fe.x, fe.y));
  crop *= 1.0 - 0.25 * ditch;
  vec3 farmAvg = vec3(0.21, 0.32, 0.11);
  vec3 farm = mix(crop, farmAvg, smoothstep(6.0, 25.0, pix));

  vec3 urbanC = mix(vec3(0.55, 0.51, 0.46), vec3(0.66, 0.6, 0.52), n2f) * (0.9 + 0.2 * n3);

  vec3 albedo = mix(desert, rockC, rock);
  albedo = mix(albedo, farm, fert);
  albedo = mix(albedo, urbanC, urban * 0.85);

  // Wet sand / mud along shores.
  float wet = (1.0 - tWater) * smoothstep(25.0, 0.0, tShore) * step(-1.0, tShore);
  albedo *= 1.0 - 0.35 * wet;

  // Optional satellite imagery: near mosaic where available, else the far one.
  if (uImageryMix > 0.0) {
    vec2 nuv = tMosaicUv(uImgNearRect, vGeo.xy);
    vec2 fuv = tMosaicUv(uImgFarRect, vGeo.xy);
    float inN = tInside(nuv) * step(1e-9, uImgNearRect.w);
    float inF = tInside(fuv) * step(1e-9, uImgFarRect.w);
    vec3 img = mix(texture2D(uImgFar, vec2(fuv.x, 1.0 - fuv.y)).rgb, texture2D(uImgNear, vec2(nuv.x, 1.0 - nuv.y)).rgb, inN);
    albedo = mix(albedo, img * 1.1, uImageryMix * max(inN, inF) * (1.0 - tWater * 0.8));
  }

  // Neighbouring countries: desaturated and slightly darker so Egypt reads at a glance.
  float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
  albedo = mix(albedo, vec3(lum), foreign * 0.55) * (1.0 - 0.12 * foreign);

  // Water body colour by depth; rivers carry silt, reef shallows turn turquoise.
  vec3 deep = mix(vec3(0.015, 0.06, 0.13), vec3(0.02, 0.09, 0.16), foreign);
  vec3 shallow = tKind > 2.5 ? vec3(0.1, 0.24, 0.24) : tKind > 1.5 ? vec3(0.08, 0.28, 0.3) : vec3(0.07, 0.34, 0.4);
  vec3 waterC = mix(shallow, deep, smoothstep(1.0, tKind > 2.5 ? 12.0 : 45.0, tWaterDepth));

  // Animated wave normal (two scrolling octaves), flattened with distance.
  float t = uTime;
  vec2 q = wp * 0.08;
  float wa = tNoise(q + vec2(t * 0.35, t * 0.2));
  float wb = tNoise(q * 2.7 - vec2(t * 0.5, -t * 0.3));
  float wc = tNoise(q * 0.21 + vec2(t * 0.05, 0.0));
  float waveAmp = 0.22 * (1.0 - smoothstep(200.0, 4000.0, camDist)) + 0.03;
  tWaveNormal = normalize(vec3((wa - 0.5) + (wb - 0.5) * 0.6 + (wc - 0.5) * 0.8, 3.2 / waveAmp, (wb - 0.5) + (wa - 0.5) * 0.4));

  // Shore foam on sea and lakes.
  float foam = tKind < 2.5 ? smoothstep(-12.0, -2.0, tShore) * step(tShore, 0.5) * smoothstep(0.45, 0.8, tNoise(wp * 0.15 + t * 0.6)) : 0.0;
  waterC = mix(waterC, vec3(0.85), foam * 0.6);

  diffuseColor.rgb = mix(albedo, waterC, tWater);
}
`;

const TERRAIN_EMISSIVE = /* glsl */ `
{
  // Sky reflection on water (no environment map: fresnel-weighted sky colour).
  vec3 V = normalize(cameraPosition - vApWorld);
  float fres = pow(1.0 - max(dot(V, tWaveNormal), 0.0), 5.0) * 0.95 + 0.03;
  totalEmissiveRadiance += uSkyReflect * fres * tWater;

  // City and village lights: sparkle at close range, smooth glow from orbit.
  if (uNight > 0.01 && tUrban > 0.01) {
    vec2 wp = vApWorld.xz;
    float camDist = length(vApWorld - cameraPosition);
    float pixN = max(length(fwidth(wp)), camDist * 0.0008);
    // Street lights: one lamp at a random spot in ~55% of 25 m cells (points, not patches),
    // averaged to a faint wash at mid range and to an aggregate city glow from orbit.
    vec2 cell = floor(wp / 25.0);
    vec2 off = vec2(tHash(cell + 0.31), tHash(cell + 3.7)) - 0.5;
    float dLamp = length((fract(wp / 25.0) - 0.5 - off * 0.7) * 25.0);
    float lamp = step(0.45, tHash(cell + 1.3)) * smoothstep(3.5, 0.6, dLamp) * 2.5;
    float near = mix(lamp, 0.05, smoothstep(1.5, 6.0, pixN));
    float farAgg = 0.3 * (1.0 + 7.0 * smoothstep(8000.0, 400000.0, camDist));
    float sparkle = mix(near, farAgg, smoothstep(15000.0, 120000.0, camDist));
    float glow = pow(tUrban, 1.3) * sparkle;
    vec3 lightC = mix(vec3(1.0, 0.6, 0.26), vec3(0.95, 0.86, 0.72), tNoise(wp * 0.00012));
    totalEmissiveRadiance += lightC * glow * uNight * 0.22 * (1.0 - tWater);
  }
}
`;
