/**
 * Day/night cycle and weather. Owns the simulation clock, places the sun from real
 * astronomy at the camera's location, derives sunlight colour from atmospheric
 * transmittance, blends weather (coastal humidity ↔ desert dust, or a forced preset
 * such as a khamaseen), and drives lights, exposure, city lights and shadows.
 */
import { Color, DirectionalLight, HemisphereLight, Vector3, type WebGLRenderer } from 'three';
import { clamp, lerp, saturate, smoothstep } from '../core/math';
import { BETA_R, RAYLEIGH_HEIGHT, SUN_E, WEATHER, airMass, atmosphereUniforms, type WeatherPreset } from './atmosphere';
import { egyptLocalHours, sunPosition, sunVector } from './solar';

export type WeatherMode = 'auto' | keyof typeof WEATHER;

export interface EnvironmentState {
  date: Date;
  localHours: number;
  sunElevationDeg: number;
  night: number;
  weather: string;
}

export class Environment {
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly moon = new DirectionalLight(0x9fb4ff, 0);
  readonly hemi = new HemisphereLight(0xbcd4ff, 0x8a7458, 0.6);
  /** Simulation time (UTC ms) and speed (sim seconds per real second). */
  time: number;
  timeScale = 60;
  paused = false;
  weatherMode: WeatherMode = 'auto';
  private current: WeatherPreset = { ...WEATHER.clear };
  private readonly sunDir = new Vector3(0, 1, 0);
  state: EnvironmentState;
  /** Simulation seconds advanced during the last update (for animated systems). */
  lastSimDt = 0;

  constructor(start: Date) {
    this.time = start.getTime();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.moon.position.set(-0.4, 0.8, 0.3);
    this.state = { date: start, localHours: 12, sunElevationDeg: 45, night: 0, weather: 'clear' };
  }

  setTime(date: Date): void {
    this.time = date.getTime();
  }

  /**
   * @param coastDist distance (m) from the camera target to the sea (humidity proxy)
   * @param focus     world position the shadow frustum should cover
   * @param range     camera distance — sizes the shadow frustum and toggles shadows
   */
  update(dt: number, lon: number, lat: number, coastDist: number, focus: Vector3, range: number, renderer: WebGLRenderer): void {
    this.lastSimDt = this.paused ? 0 : dt * this.timeScale;
    this.time += this.lastSimDt * 1000;
    const date = new Date(this.time);
    const pos = sunPosition(date, lat, lon);
    const [sx, sy, sz] = sunVector(pos);
    this.sunDir.set(sx, sy, sz);

    // Weather: blend marine haze near the coast with desert dust inland.
    const inland = smoothstep(8000, 70000, coastDist);
    const target = this.weatherMode === 'auto' ? blendWeather(WEATHER.coastal, WEATHER.desert, inland) : WEATHER[this.weatherMode];
    this.current = blendWeather(this.current, target, saturate(dt * 1.5));
    const w = this.current;

    const u = atmosphereUniforms;
    u.uSunDirection.value.copy(this.sunDir);
    u.uBetaMs.value.set(w.mie * w.scatterTint[0], w.mie * w.scatterTint[1], w.mie * w.scatterTint[2]);
    u.uBetaMe.value.set(w.mie * 1.11 * w.extinctionTint[0], w.mie * 1.11 * w.extinctionTint[1], w.mie * 1.11 * w.extinctionTint[2]);
    u.uMieG.value = w.mieG;
    u.uMieMulti.value = Math.min(1, w.mie / 300e-6) * 0.6;
    u.uHM.value = w.mieHeight;
    u.uTime.value = (performance.now() / 1000) % 10000;

    // Sun transmittance through the air mass → sunlight colour (reddens at dawn/dusk).
    const zenith = Math.PI / 2 - pos.elevation;
    const m = airMass(zenith);
    const horizon = smoothstep(-0.035, 0.02, pos.elevation);
    const t = [0, 1, 2].map((i) => {
      const bR = BETA_R.getComponent(i) * RAYLEIGH_HEIGHT;
      const bM = u.uBetaMe.value.getComponent(i) * w.mieHeight;
      return Math.exp(-(bR + bM) * m) * horizon;
    });
    u.uSunIlluminance.value.setScalar(SUN_E);
    u.uSunGround.value.set(SUN_E * t[0], SUN_E * t[1], SUN_E * t[2]);

    const night = saturate(smoothstep(0.07, -0.12, pos.elevation));
    u.uNight.value = night;
    const day = 1 - night;
    const peak = Math.max(t[0], t[1], t[2], 1e-4);
    this.sun.color.setRGB(t[0] / peak, t[1] / peak, t[2] / peak);
    this.sun.intensity = 2.9 * peak;
    this.sun.visible = peak > 0.002;

    // Sky ambient: bluish by day, warmer and dimmer at twilight, near-black at night; dust tints it.
    const dust = saturate(w.mie / 100e-6);
    const skyC = new Color(0.36, 0.5, 0.75).lerp(new Color(0.62, 0.52, 0.42), dust);
    const ambient = 0.08 + 0.75 * smoothstep(-0.1, 0.35, pos.elevation);
    this.hemi.color.copy(skyC).multiplyScalar(1);
    this.hemi.groundColor.setRGB(0.55, 0.45, 0.33);
    this.hemi.intensity = ambient * day + 0.06 * night;
    u.uAmbientSky.value.set(skyC.r, skyC.g, skyC.b).multiplyScalar(0.06 * ambient * day + 0.004);
    this.moon.intensity = 0.12 * night;

    // Shadows follow the focus point and only exist where they read (street → district scale).
    const shadows = range < 6000 && peak > 0.02;
    this.sun.castShadow = shadows;
    const extent = clamp(range * 0.9, 150, 3000);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -extent;
    cam.right = cam.top = extent;
    cam.near = 1;
    cam.far = extent * 6;
    cam.updateProjectionMatrix();
    this.sun.position.copy(focus).addScaledVector(this.sunDir, extent * 3);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();

    renderer.toneMappingExposure = lerp(1.0, 2.2, night);

    this.state = {
      date,
      localHours: egyptLocalHours(date),
      sunElevationDeg: (pos.elevation * 180) / Math.PI,
      night,
      weather: this.weatherMode === 'auto' ? `Auto (${inland > 0.5 ? 'desert dust' : 'coastal haze'})` : WEATHER[this.weatherMode].label,
    };
  }

  /** Fraction of windows lit: evening peak, tapering after midnight. */
  windowsLit(): number {
    const h = this.state.localHours;
    if (h >= 17 || h < 1) return 0.42;
    if (h < 5) return lerp(0.3, 0.1, (h - 1) / 4);
    if (h < 7) return 0.18;
    return 0.25;
  }
}

function blendWeather(a: WeatherPreset, b: WeatherPreset, t: number): WeatherPreset {
  const mix3 = (p: [number, number, number], q: [number, number, number]): [number, number, number] =>
    [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
  return {
    id: t < 0.5 ? a.id : b.id,
    label: t < 0.5 ? a.label : b.label,
    mie: Math.exp(lerp(Math.log(a.mie), Math.log(b.mie), t)),
    scatterTint: mix3(a.scatterTint, b.scatterTint),
    extinctionTint: mix3(a.extinctionTint, b.extinctionTint),
    mieHeight: lerp(a.mieHeight, b.mieHeight, t),
    mieG: lerp(a.mieG, b.mieG, t),
  };
}
