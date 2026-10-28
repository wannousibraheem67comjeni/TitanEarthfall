/**
 * Shared atmosphere state: Rayleigh + Mie single-scattering coefficients, weather
 * presets, and the aerial-perspective GLSL injected into every lit material.
 *
 * Uniform objects are shared by reference across all materials, so the Environment
 * controller updates them once per frame for the whole scene.
 */
import { Vector3 } from 'three';

export interface WeatherPreset {
  id: string;
  label: string;
  /** Mie scattering coefficient at sea level (1/m). */
  mie: number;
  /** Spectral tints of Mie scattering (warm for dust) and extinction (stronger in blue for dust). */
  scatterTint: [number, number, number];
  extinctionTint: [number, number, number];
  /** Mie scale height (m): dust is lofted higher than marine haze. */
  mieHeight: number;
  mieG: number;
}

export const WEATHER: Record<string, WeatherPreset> = {
  clear: { id: 'clear', label: 'Clear', mie: 3e-6, scatterTint: [1, 1, 1], extinctionTint: [1, 1, 1], mieHeight: 1200, mieG: 0.8 },
  coastal: { id: 'coastal', label: 'Coastal haze', mie: 11e-6, scatterTint: [1, 1, 1], extinctionTint: [1, 1, 1.03], mieHeight: 900, mieG: 0.78 },
  desert: { id: 'desert', label: 'Desert dust', mie: 14e-6, scatterTint: [1, 0.86, 0.66], extinctionTint: [1, 1.1, 1.28], mieHeight: 2200, mieG: 0.74 },
  khamaseen: { id: 'khamaseen', label: 'Khamaseen sandstorm', mie: 900e-6, scatterTint: [1, 0.6, 0.3], extinctionTint: [1, 1.2, 1.55], mieHeight: 1500, mieG: 0.65 },
};

/** Rayleigh scattering at sea level for λ = 680/550/440 nm (1/m). */
export const BETA_R = new Vector3(5.8e-6, 13.5e-6, 33.1e-6);
export const RAYLEIGH_HEIGHT = 8000;
/** Solar illuminance scale (scene units) for the sky integral. */
export const SUN_E = 22;

export const atmosphereUniforms = {
  uSunDirection: { value: new Vector3(0, 1, 0) },
  /** Top-of-atmosphere sun illuminance (white × SUN_E). */
  uSunIlluminance: { value: new Vector3(SUN_E, SUN_E, SUN_E) },
  /** Sun illuminance after transmittance to the ground (used for in-scatter along short paths). */
  uSunGround: { value: new Vector3(SUN_E, SUN_E, SUN_E) },
  uBetaR: { value: BETA_R.clone() },
  uBetaMs: { value: new Vector3(5e-6, 5e-6, 5e-6) },
  uBetaMe: { value: new Vector3(5.5e-6, 5.5e-6, 5.5e-6) },
  uMieG: { value: 0.8 },
  /** 0..1 blend of the Mie phase toward isotropic: multiple scattering in thick dust. */
  uMieMulti: { value: 0 },
  uHR: { value: RAYLEIGH_HEIGHT },
  uHM: { value: 1200 },
  /** Multiple-scattering / sky-ambient approximation added to in-scatter. */
  uAmbientSky: { value: new Vector3(0.05, 0.07, 0.1) },
  /** 0 = day … 1 = full night (drives city lights). */
  uNight: { value: 0 },
  uTime: { value: 0 },
};

export type AtmosphereUniforms = typeof atmosphereUniforms;

/** Declarations + aerial perspective for an exponential flat atmosphere. */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uSunDirection;
uniform vec3 uSunGround;
uniform vec3 uBetaR;
uniform vec3 uBetaMs;
uniform vec3 uBetaMe;
uniform float uMieG;
uniform float uMieMulti;
uniform float uHR;
uniform float uHM;
uniform vec3 uAmbientSky;
uniform float uNight;
uniform float uTime;

// ∫ exp(−h(s)/H) ds along a straight path whose height varies linearly h0 → h1.
float apOpticalDepth(float h0, float h1, float d, float H) {
  float dh = h1 - h0;
  float e0 = exp(-h0 / H);
  if (abs(dh) < 1.0) return d * e0;
  return d * H * (e0 - exp(-h1 / H)) / dh;
}

vec3 applyAerialPerspective(vec3 color, vec3 worldPos) {
  vec3 ray = worldPos - cameraPosition;
  float d = length(ray);
  if (d < 1.0) return color;
  vec3 dir = ray / d;
  float h0 = max(cameraPosition.y, 0.0);
  float h1 = max(worldPos.y, 0.0);
  float odR = apOpticalDepth(h0, h1, d, uHR);
  float odM = apOpticalDepth(h0, h1, d, uHM);
  vec3 tauR = uBetaR * odR;
  vec3 tauMs = uBetaMs * odM;
  vec3 tau = tauR + uBetaMe * odM;
  vec3 T = exp(-tau);
  float mu = dot(dir, uSunDirection);
  float pR = 0.0596831 * (1.0 + mu * mu);
  float g = uMieG;
  float pM = 0.1193662 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  // Multiple scattering in thick dust diffuses light toward isotropic: blend the phase.
  pM = mix(pM, 0.0795775, uMieMulti);
  vec3 inscatter = (tauR * pR + tauMs * pM) / max(tau, vec3(1e-6)) * (1.0 - T) * uSunGround;
  // uSunGround is calibrated for the sky dome, which overstates path radiance on
  // short / steep paths ~2.5× (orbit views, the first few km of haze). Scale it by
  // path opacity so optically thick paths still converge exactly on the horizon sky.
  float opacity = 1.0 - dot(T, vec3(0.3, 0.4, 0.3));
  inscatter *= mix(0.3, 1.0, smoothstep(0.35, 0.95, opacity));
  inscatter += uAmbientSky * (1.0 - T);
  return color * T + inscatter;
}
`;

/** World position varying for materials patched with aerial perspective. */
export const AP_VERTEX_PARS = /* glsl */ `varying vec3 vApWorld;\n`;
export const AP_VERTEX = /* glsl */ `vApWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n`;
export const AP_INSTANCED_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  vApWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vApWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

/**
 * Patches a built-in material's shader with aerial perspective applied to linear HDR
 * radiance (before tone mapping), and wires the shared uniforms.
 */
export function injectAtmosphere(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, instanced = false): void {
  Object.assign(shader.uniforms, atmosphereUniforms);
  shader.vertexShader = AP_VERTEX_PARS + shader.vertexShader.replace(
    '#include <project_vertex>',
    `#include <project_vertex>\n${instanced ? AP_INSTANCED_VERTEX : AP_VERTEX}`,
  );
  shader.fragmentShader = `varying vec3 vApWorld;\n${ATMOSPHERE_GLSL}\n` + shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    '#include <opaque_fragment>\ngl_FragColor.rgb = applyAerialPerspective(gl_FragColor.rgb, vApWorld);',
  );
}

/** Kasten–Young relative air mass for a zenith angle (radians), finite below the horizon. */
export function airMass(zenith: number): number {
  const deg = Math.min(zenith * (180 / Math.PI), 93);
  return 1 / (Math.cos(Math.min(zenith, Math.PI / 2 + 0.05)) + 0.50572 * Math.pow(96.07995 - deg, -1.6364));
}
