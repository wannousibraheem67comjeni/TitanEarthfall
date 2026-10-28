/**
 * Composition root: loads data, builds the world model, spins up workers, wires
 * every subsystem to the renderer and UI, and runs the frame loop.
 */
import {
  ACESFilmicToneMapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, PCFShadowMap, PerspectiveCamera,
  RGBAFormat, Scene, SRGBColorSpace, UnsignedByteType, Vector3, WebGLRenderer,
} from 'three';
import { CITY, DATA_URLS, LIVE_SOURCES, NAVIGATION, TERRAIN } from '../config';
import type { CityDistrict, GisData, Governorate, Landmark, RegionsData } from '../data/schema';
import { validateCities, validateGovernorates, validateLandmarks } from '../data/schema';
import governoratesJson from '../data/governorates.json';
import citiesJson from '../data/cities.json';
import landmarksJson from '../data/landmarks.json';
import regionsJson from '../data/regions.json';
import { loadDem } from '../gis/dem';
import { buildWorld, toTransfer, type World } from '../gis/world';
import { RingIndex } from '../core/spatialIndex';
import { clamp, DEG } from '../core/math';
import { WorkerPool } from '../workers/WorkerPool';
import { TerrainManager } from '../terrain/TerrainManager';
import { ImageryManager } from '../terrain/ImageryManager';
import { MACRO_DECIMATION, macroSize } from '../terrain/macro';
import { buildReliefTextures } from '../terrain/reliefTextures';
import { WaterRibbons } from '../terrain/WaterRibbons';
import { CityManager } from '../city/CityManager';
import { cityUniforms } from '../city/cityMaterials';
import { LandmarkManager } from '../landmarks/LandmarkManager';
import { MapOverlays } from '../landmarks/MapOverlays';
import { SuezTraffic } from '../landmarks/SuezTraffic';
import { Environment, type WeatherMode } from '../environment/Environment';
import { WEATHER } from '../environment/atmosphere';
import { SkyDome } from '../environment/SkyDome';
import { egyptLocalHours, egyptUtcOffset, fromEgyptLocal } from '../environment/solar';
import { GeoCameraController, type CameraPose } from '../navigation/GeoCameraController';
import { Hud, type LayerName } from '../ui/Hud';
import { Labels } from '../ui/Labels';
import { Minimap } from '../ui/Minimap';
import { TOURS, type Tour } from './tours';

export type Progress = (message: string, fraction: number) => void;

const REGION_LABELS: [string, string, number, number, number][] = [
  // text, arabic, lon, lat, max distance (m)
  ['Mediterranean Sea', 'البحر المتوسط', 28.6, 32.9, 4e6],
  ['Red Sea', 'البحر الأحمر', 36.2, 24.3, 4e6],
  ['Gulf of Suez', 'خليج السويس', 32.95, 28.75, 9e5],
  ['Gulf of Aqaba', 'خليج العقبة', 34.72, 28.6, 9e5],
  ['Sinai Peninsula', 'شبه جزيرة سيناء', 33.8, 29.6, 2.4e6],
  ['Western Desert', 'الصحراء الغربية', 27.8, 25.6, 3e6],
  ['Eastern Desert', 'الصحراء الشرقية', 33.2, 25.4, 2.4e6],
  ['Great Sand Sea', 'بحر الرمال الأعظم', 25.6, 26.9, 2e6],
  ['Nile Delta', 'دلتا النيل', 31.0, 30.95, 1.6e6],
  ['LIBYA', 'ليبيا', 22.2, 27.5, 4e6],
  ['SUDAN', 'السودان', 30.5, 19.0, 4e6],
  ['SAUDI ARABIA', 'السعودية', 39.2, 26.5, 4e6],
];

export class App {
  private renderer!: WebGLRenderer;
  readonly scene = new Scene();
  /** Sky dome and stars, drawn first in their own pass (never over the terrain). */
  private readonly background = new Scene();
  private camera!: PerspectiveCamera;
  private world!: World;
  private pool!: WorkerPool;
  private terrain!: TerrainManager;
  private imagery!: ImageryManager;
  private cities!: CityManager;
  private landmarks!: LandmarkManager;
  private overlays!: MapOverlays;
  private suez!: SuezTraffic;
  private env!: Environment;
  private sky!: SkyDome;
  private controller!: GeoCameraController;
  private hud!: Hud;
  private labels!: Labels;
  private minimap!: Minimap;
  private governorates: Governorate[] = [];
  private govIndex: { g: Governorate; index: RingIndex }[] = [];
  private last = performance.now();
  private fps = 60;
  private frameTimes: number[] = [];
  private pixelRatio = 1;
  private maxPixelRatio = 1;
  private uiTimer = 0;
  private hashTimer = 0;
  private pickTimer = 0;
  private cursor: { x: number; y: number } | null = null;
  private cursorInfo = '';
  private tour: { tour: Tour; index: number; timer: number } | null = null;
  private imageryOn = false;
  private osmOn = false;

  constructor(private readonly root: HTMLElement) {}

  async start(progress: Progress): Promise<void> {
    progress('Loading national DEM and GIS vectors…', 0.05);
    const base = new URL(document.baseURI);
    const [gis, dem, contextDem] = await Promise.all([
      fetch(new URL(DATA_URLS.gis, base)).then((r) => {
        if (!r.ok) throw new Error(`${DATA_URLS.gis}: HTTP ${r.status}`);
        return r.json() as Promise<GisData>;
      }),
      loadDem(new URL(DATA_URLS.dem, base).href),
      loadDem(new URL(DATA_URLS.contextDem, base).href),
    ]);
    this.governorates = governoratesJson as Governorate[];
    const datasets = { gis, cities: citiesJson as CityDistrict[], landmarks: landmarksJson as Landmark[], regions: regionsJson as RegionsData };
    if (import.meta.env.DEV) {
      const isos = new Set(this.governorates.map((g) => g.iso));
      const errors = [
        ...validateGovernorates(this.governorates, gis.meta.bbox),
        ...validateCities(datasets.cities, isos, gis.meta.bbox),
        ...validateLandmarks(datasets.landmarks, isos, gis.meta.bbox),
      ];
      if (errors.length) console.warn('Dataset validation:', errors);
    }

    progress('Rasterising coastlines, rivers and land use…', 0.2);
    await nextFrame();
    this.world = buildWorld(datasets, dem, contextDem);
    this.govIndex = gis.governorates.map((g) => ({ g: this.governorates.find((x) => x.iso === g.iso)!, index: new RingIndex(g.rings, 0.05) }));

    progress('Starting geo workers…', 0.35);
    const workers = clamp((navigator.hardwareConcurrency || 4) - 1, 2, 4);
    this.pool = new WorkerPool(workers);
    await this.pool.broadcast(() => {
      const { payload, transfer } = toTransfer(this.world);
      return {
        job: { type: 'init', world: payload, liveDem: { url: LIVE_SOURCES.dem.url, encoding: LIVE_SOURCES.dem.encoding, maxZoom: LIVE_SOURCES.dem.maxZoom } },
        transfer,
      };
    });

    progress('Computing land-use macro texture…', 0.5);
    const macro = await this.buildMacro((f) => progress('Computing land-use macro texture…', 0.5 + f * 0.3));

    progress('Building scene…', 0.85);
    this.initRenderer();
    this.initScene(macro);
    this.initUi(macro);
    this.restoreFromHash();
    // Hand-edited or shared URLs (and back/forward) jump straight to that view.
    window.addEventListener('hashchange', () => this.restoreFromHash());
    this.renderer.setAnimationLoop(() => this.frame());
    progress('Streaming terrain…', 0.95);
    await this.waitFor(() => this.terrain.rootReady, 20000);
    progress('Ready', 1);
  }

  private async buildMacro(onProgress: (f: number) => void): Promise<Uint8Array> {
    const { width, height } = macroSize(this.world);
    const out = new Uint8Array(width * height * 4);
    const chunk = 24;
    const jobs: Promise<void>[] = [];
    let done = 0;
    for (let r0 = 0; r0 < height; r0 += chunk) {
      const r1 = Math.min(height, r0 + chunk);
      jobs.push(this.pool.run({ type: 'macro', r0, r1 }).then((res) => {
        if (res.type === 'macro') out.set(res.data, res.r0 * width * 4);
        onProgress(++done / Math.ceil(height / chunk));
      }));
    }
    await Promise.all(jobs);
    return out;
  }

  private initRenderer(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'viewport';
    this.root.prepend(canvas);
    this.renderer = new WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.autoClear = false;
    this.camera = new PerspectiveCamera(NAVIGATION.fovDeg, window.innerWidth / window.innerHeight, 1, 4_000_000);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private initScene(macro: Uint8Array): void {
    const w = this.world;
    this.terrain = new TerrainManager(w, this.pool);
    const { width, height } = macroSize(w);
    const tex = new DataTexture(macro, width, height, RGBAFormat, UnsignedByteType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    const sLon = w.dem.stepLon * MACRO_DECIMATION;
    const sLat = w.dem.stepLat * MACRO_DECIMATION;
    // Texel centres sit on the decimated lattice: shift the rect by half a texel.
    this.terrain.uniforms.uMacro.value = tex;
    this.terrain.uniforms.uMacroRect.value.set(w.dem.west - sLon / 2, w.dem.north + sLat / 2, sLon * width, sLat * height);
    const relief = buildReliefTextures(w);
    this.terrain.uniforms.uNat.value = relief.national;
    this.terrain.uniforms.uNatRect.value.copy(relief.nationalRect);
    this.terrain.uniforms.uCtx.value = relief.context;
    this.terrain.uniforms.uCtxRect.value.copy(relief.contextRect);
    this.imagery = new ImageryManager(this.terrain.uniforms);
    const rivers = new WaterRibbons(w, this.terrain.uniforms.uSkyReflect);
    this.cities = new CityManager(w, this.pool);
    this.landmarks = new LandmarkManager(w);
    this.overlays = new MapOverlays(w);
    this.suez = new SuezTraffic(w);
    this.sky = new SkyDome();
    const now = new Date();
    this.env = new Environment(fromEgyptLocal(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15.5));
    this.background.add(this.sky.mesh, this.sky.stars);
    this.scene.add(rivers.group, this.terrain.group, this.cities.group, this.landmarks.group, this.suez.group, this.overlays.group);
    this.scene.add(this.env.sun, this.env.sun.target, this.env.hemi, this.env.moon);

    this.controller = new GeoCameraController(
      this.camera,
      this.renderer.domElement,
      (x, z) => this.terrain.heightAt(x, z),
      (nx, ny) => this.pickNdc(nx, ny),
    );
    const [hx, hz] = w.proj.forward(NAVIGATION.home.lon, NAVIGATION.home.lat);
    this.controller.jumpTo({ x: hx, z: hz, distance: NAVIGATION.home.distance, heading: NAVIGATION.home.headingDeg * DEG, pitch: NAVIGATION.home.pitchDeg * DEG });
    this.controller.onUserInput = () => this.endTour();
  }

  private initUi(macro: Uint8Array): void {
    const w = this.world;
    this.hud = new Hud(this.root, { governorates: this.governorates, cities: w.cities, landmarks: w.landmarks }, {
      flyToGovernorate: (g) => this.flyToGovernorate(g),
      flyToCity: (c) => this.flyToCity(c),
      flyToLandmark: (l) => this.flyToLandmark(l),
      startTour: (id) => this.startTour(id),
      setLocalHours: (h) => this.setLocalHours(h),
      setDate: (iso) => this.setDate(iso),
      setSpeed: (s) => {
        this.env.paused = s === 0;
        if (s > 0) this.env.timeScale = s;
      },
      setWeather: (m: WeatherMode) => (this.env.weatherMode = m),
      setLayer: (layer, on) => this.setLayer(layer, on),
      setImagery: (id) => {
        this.imageryOn = !!id;
        this.imagery.setSource(LIVE_SOURCES.imagery.find((s) => s.id === id) ?? null);
        this.updateAttribution();
      },
      home: () => this.flyHome(),
      streetLevel: () => {
        const t = this.controller.target;
        this.controller.flyTo({ x: t.x, z: t.z, distance: 40, pitch: 4 * DEG });
      },
    });
    this.labels = new Labels(this.hud.labelHost);
    this.populateLabels();
    this.minimap = new Minimap(w, macro);
    this.minimap.onPick = (lon, lat) => {
      const [x, z] = w.proj.forward(lon, lat);
      this.controller.flyTo({ x, z, distance: Math.min(this.controller.distance, 120000) });
    };
    this.hud.minimapHost.appendChild(this.minimap.canvas);
    this.updateAttribution();
    this.renderer.domElement.addEventListener('pointermove', (e) => (this.cursor = { x: e.clientX, y: e.clientY }));
    this.renderer.domElement.addEventListener('pointerleave', () => (this.cursor = null));
  }

  private populateLabels(): void {
    const w = this.world;
    const at = (lon: number, lat: number, lift = 0) => {
      const [x, z] = w.proj.forward(lon, lat);
      return { x, z, y: Math.max(0, w.terrain.height(x, z)) + lift };
    };
    for (const [text, sub, lon, lat, maxDist] of REGION_LABELS) {
      const p = at(lon, lat, 2000);
      const isSea = /Sea$|Gulf/.test(text) && !text.includes('Sand');
      this.labels.add({ id: `region-${text}`, text, sub, kind: isSea ? 'water' : 'region', ...p, priority: 10, minDist: 0, maxDist, minAltitude: isSea && maxDist < 2e6 ? 25000 : 60000 });
    }
    for (const g of this.governorates) {
      const p = at(g.lon, g.lat, 50);
      this.labels.add({ id: `gov-${g.iso}`, text: g.name, sub: g.nameAr, kind: 'capital', ...p, priority: g.iso === 'EG-C' ? 9.5 : 8, minDist: 2500, maxDist: 2.6e6, onClick: () => this.flyToGovernorate(g) });
    }
    const capitals = new Set(this.governorates.map((g) => g.capital));
    for (const c of w.cities) {
      if (!c.label || capitals.has(c.name)) continue;
      const p = at(c.lon, c.lat, 40);
      this.labels.add({ id: `city-${c.id}`, text: c.name, sub: c.nameAr, kind: 'city', ...p, priority: 5, minDist: 1500, maxDist: 350000, onClick: () => this.flyToCity(c) });
    }
    for (const l of this.landmarks.placed) {
      const big = l.def.model.type === 'marker';
      const p = { x: l.x, y: l.y + l.height + 15, z: l.z };
      this.labels.add({
        id: `lm-${l.def.id}`, text: l.def.name, sub: l.def.nameAr, kind: 'landmark', category: l.def.category, ...p,
        priority: big ? 6.5 : 6, minDist: 60, maxDist: big ? 900000 : Math.max(25000, l.radius * 120), onClick: () => this.flyToLandmark(l.def),
      });
    }
    for (const lake of w.gis.lakes) {
      const egyptLake = ['nasser', 'qarun', 'great-bitter', 'manzala', 'burullus', 'bardawil', 'timsah', 'mariout', 'idku'].includes(lake.id);
      if (!egyptLake) continue;
      const r = lake.rings[0];
      let sx = 0, sy = 0;
      for (let i = 0; i < r.length; i += 2) { sx += r[i]; sy += r[i + 1]; }
      const lon = (sx / r.length) * 2;
      const lat = (sy / r.length) * 2;
      this.labels.add({ id: `lake-${lake.id}`, text: lake.name, sub: lake.nameAr, kind: 'water', ...at(lon, lat, 100), priority: lake.id === 'nasser' ? 7 : 4, minDist: 5000, maxDist: lake.id === 'nasser' ? 2e6 : 300000 });
    }
  }

  // ───────────────────────── navigation actions ─────────────────────────

  private flyToGovernorate(g: Governorate): void {
    this.endTour();
    this.overlays.highlight(g.iso);
    const rings = this.world.gis.governorates.find((x) => x.iso === g.iso)?.rings ?? [];
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) { w = Math.min(w, r[i]); e = Math.max(e, r[i]); s = Math.min(s, r[i + 1]); n = Math.max(n, r[i + 1]); }
    const span = Math.max((e - w) * 99000, (n - s) * 111000);
    const [x, z] = this.world.proj.forward(g.lon, g.lat);
    this.controller.flyTo({ x, z, distance: clamp(span * 1.15, 25000, 1_400_000), heading: 0, pitch: span > 300000 ? 80 * DEG : 55 * DEG });
    this.hud.setCaption(`${g.name} Governorate · ${g.nameAr} — capital ${g.capital} · ≈${g.populationM.toFixed(1)} M people`);
  }

  private flyToCity(c: CityDistrict): void {
    this.endTour();
    const [x, z] = this.world.proj.forward(c.lon, c.lat);
    this.controller.flyTo({ x, z, distance: clamp(c.radius * 1.6, 2500, 60000), heading: c.gridDeg * DEG, pitch: 38 * DEG });
    this.hud.setCaption(`${c.name} · ${c.nameAr}`);
  }

  private flyToLandmark(l: Landmark): void {
    this.endTour();
    const p = this.landmarks.byId(l.id);
    const [x, z] = this.world.proj.forward(l.lon, l.lat);
    const cam = l.camera ?? { distance: Math.max(350, (p?.radius ?? 100) * 4.5), pitchDeg: 22, headingDeg: (l.headingDeg + 180) % 360 };
    this.controller.flyTo({ x, z, distance: cam.distance, heading: cam.headingDeg * DEG, pitch: cam.pitchDeg * DEG });
    this.hud.setCaption(`${l.name} · ${l.nameAr} — ${l.description}`);
  }

  private flyHome(): void {
    this.endTour();
    this.overlays.highlight(null);
    this.hud.setCaption(null);
    const [x, z] = this.world.proj.forward(NAVIGATION.home.lon, NAVIGATION.home.lat);
    this.controller.flyTo({ x, z, distance: NAVIGATION.home.distance, heading: 0, pitch: NAVIGATION.home.pitchDeg * DEG });
  }

  private startTour(id: string): void {
    const tour = TOURS.find((t) => t.id === id);
    if (!tour) return;
    this.overlays.highlight(null);
    this.tour = { tour, index: -1, timer: 0 };
    this.nextStop();
  }

  private nextStop(): void {
    const t = this.tour;
    if (!t) return;
    t.index++;
    if (t.index >= t.tour.stops.length) {
      this.endTour();
      return;
    }
    const s = t.tour.stops[t.index];
    const [x, z] = this.world.proj.forward(s.lon, s.lat);
    this.hud.setCaption(`${t.tour.name} · ${t.index + 1}/${t.tour.stops.length} — ${s.caption}`);
    this.controller.flyTo({ x, z, distance: s.distance, heading: s.headingDeg * DEG, pitch: s.pitchDeg * DEG }, () => {
      if (this.tour === t) t.timer = s.dwell ?? 3.5;
    });
  }

  private endTour(): void {
    if (this.tour) this.hud?.setCaption(null);
    this.tour = null;
  }

  private setLocalHours(h: number): void {
    const local = new Date(this.env.time + egyptUtcOffset(new Date(this.env.time)) * 3600e3);
    this.env.setTime(fromEgyptLocal(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h));
  }

  private setDate(iso: string): void {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return;
    this.env.setTime(fromEgyptLocal(y, m - 1, d, egyptLocalHours(new Date(this.env.time))));
  }

  private setLayer(layer: LayerName, on: boolean): void {
    switch (layer) {
      case 'labels': this.labels.enabled = on; break;
      case 'borders': this.overlays.bordersEnabled = on; break;
      case 'rivers': this.overlays.riversEnabled = on; break;
      case 'cities': this.cities.group.visible = on; break;
      case 'landmarks': this.landmarks.group.visible = on; break;
      case 'ships': this.suez.group.visible = on; break;
      case 'liveDem': this.terrain.setLiveDem(on); break;
      case 'liveOsm': this.osmOn = on; this.cities.setOsmMode(on ? 'live' : 'off'); break;
    }
    this.updateAttribution();
  }

  private updateAttribution(): void {
    const parts = ['Elevation: SRTM & GMTED2010 (USGS/NASA), ETOPO1 (NOAA)', 'Vectors: Natural Earth'];
    if (this.imageryOn && this.imagery.attribution) parts.push(this.imagery.attribution);
    if (this.osmOn) parts.push(LIVE_SOURCES.osmAttribution);
    this.hud.setAttribution(parts);
  }

  private pickNdc(nx: number, ny: number): Vector3 | null {
    const origin = this.camera.position.clone();
    const dir = new Vector3(nx, ny, 0.5).unproject(this.camera).sub(origin).normalize();
    return this.terrain.raycast(origin, dir);
  }

  // ───────────────────────── frame loop ─────────────────────────

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.trackPerformance(dt);

    this.controller.update(dt);
    if (this.tour && !this.controller.flying && this.tour.timer > 0) {
      this.tour.timer -= dt;
      if (this.tour.timer <= 0) this.nextStop();
    }

    const t = this.controller.target;
    const [lon, lat] = this.world.proj.inverse(t.x, t.z);
    const coast = this.world.rasters.coastDistance(lon, lat);
    this.env.update(dt, lon, lat, coast, t, this.controller.distance, this.renderer);
    this.sky.update(this.camera, this.camera.position.y);
    this.terrain.uniforms.uSkyReflect.value.copy(this.env.hemi.color).multiplyScalar(0.3 * this.env.hemi.intensity + 0.02);

    const groundUnderCam = this.terrain.heightAt(this.camera.position.x, this.camera.position.z);
    const alt = this.camera.position.y - groundUnderCam;
    // Share workers: terrain first, but always leave room for city tiles near the ground.
    this.terrain.update(this.camera, alt < 12000 ? this.pool.capacity - 3 : this.pool.capacity);
    if (this.cities.group.visible) this.cities.update(this.camera, groundUnderCam);
    this.cities.lampMat.opacity = Math.min(1, this.env.state.night * 1.2);
    cityUniforms.uWindowLit.value = this.env.windowsLit();
    this.landmarks.update(this.camera);
    this.suez.update(this.env.lastSimDt, this.camera);
    this.overlays.update(window.innerWidth, window.innerHeight, alt, 1 - 0.45 * this.env.state.night);
    this.imagery.update(lon, lat, this.controller.distance);

    this.renderer.clear();
    this.renderer.render(this.background, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.labels.update(this.camera, window.innerWidth, window.innerHeight, alt);

    this.uiTimer += dt;
    if (this.uiTimer > 0.2) {
      this.uiTimer = 0;
      this.updateHud(alt);
      this.minimap.update(this.camera, t);
    }
    this.pickTimer += dt;
    if (this.pickTimer > 0.12 && this.cursor) {
      this.pickTimer = 0;
      this.updateCursorInfo();
    }
    this.hashTimer += dt;
    if (this.hashTimer > 1) {
      this.hashTimer = 0;
      this.saveHash();
    }
  }

  private trackPerformance(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    this.fps = 1 / avg;
    // Dynamic resolution: trade pixels for frame rate before dropping below ~40 fps.
    const next = this.fps < 40 ? this.pixelRatio * 0.85 : this.fps > 57 ? this.pixelRatio * 1.08 : this.pixelRatio;
    const clamped = clamp(next, 0.6, this.maxPixelRatio);
    if (Math.abs(clamped - this.pixelRatio) > 0.02) {
      this.pixelRatio = clamped;
      this.renderer.setPixelRatio(clamped);
    }
  }

  private updateHud(alt: number): void {
    const t = this.controller.target;
    const [lon, lat] = this.world.proj.inverse(t.x, t.z);
    this.hud.setEnvironment(this.env.state, this.env.paused ? 0 : this.env.timeScale);
    const altText = alt > 10000 ? `${(alt / 1000).toFixed(alt > 100000 ? 0 : 1)} km` : `${alt.toFixed(0)} m`;
    this.hud.setStatus(`${this.cursorInfo || `${fmtLat(lat)} ${fmtLon(lon)}`} · camera ${altText}`);
    const r = this.renderer.info.render;
    const ts = this.terrain.stats;
    const cs = this.cities.stats;
    this.hud.setStats([
      `FPS            ${this.fps.toFixed(0)}  (pixel ratio ${this.pixelRatio.toFixed(2)})`,
      `Draw calls     ${r.calls}`,
      `Triangles      ${(r.triangles / 1e6).toFixed(2)} M`,
      `Terrain nodes  ${ts.rendered} drawn / ${ts.cached} cached / ${ts.pending} building (max depth ${TERRAIN.maxDepth})`,
      `City tiles     ${cs.detail} detail + ${cs.massing} massing, ${cs.pending} building (${CITY.tileSize} m)`,
      `Buildings      ${cs.buildings.toLocaleString()}  · OSM ${cs.osm}`,
      `Workers        ${this.pool.size} · ${this.pool.inFlight} jobs in flight`,
      `Live DEM       ${this.terrain.liveDemEnabled ? 'on' : 'off'} · imagery ${this.imageryOn ? (this.imagery.busy ? 'loading' : 'on') : 'off'}`,
    ].join('\n'));
  }

  private updateCursorInfo(): void {
    const c = this.cursor!;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = this.pickNdc(((c.x - rect.left) / rect.width) * 2 - 1, -((c.y - rect.top) / rect.height) * 2 + 1);
    if (!p) {
      this.cursorInfo = '';
      return;
    }
    const [lon, lat] = this.world.proj.inverse(p.x, p.z);
    const gov = this.govIndex.find((g) => g.index.contains(lon, lat))?.g;
    const s = this.world.terrain.sample(p.x, p.z, 1);
    const surface = s.kind === 1 ? 'sea' : s.kind === 2 ? 'lake' : s.kind === 3 ? 'river' : `elev ${s.ground.toFixed(0)} m`;
    this.cursorInfo = `${fmtLat(lat)} ${fmtLon(lon)} · ${surface}${gov ? ` · ${gov.name} (${gov.nameAr})` : ''}`;
  }

  // ───────────────────────── URL state ─────────────────────────

  private saveHash(): void {
    const t = this.controller.target;
    const [lon, lat] = this.world.proj.inverse(t.x, t.z);
    const c = this.controller;
    const v = [lat.toFixed(5), lon.toFixed(5), Math.round(c.distance), Math.round(c.heading / DEG) % 360, Math.round(c.pitch / DEG)].join(',');
    const params = new URLSearchParams({ v, t: new Date(this.env.time).toISOString().slice(0, 16) });
    history.replaceState(null, '', `#${params.toString()}`);
  }

  private restoreFromHash(): void {
    const params = new URLSearchParams(location.hash.slice(1));
    const v = params.get('v')?.split(',').map(Number);
    if (v && v.length === 5 && v.every(Number.isFinite)) {
      const [lat, lon, distance, heading, pitch] = v;
      const [x, z] = this.world.proj.forward(lon, lat);
      const pose: CameraPose = { x, z, distance, heading: heading * DEG, pitch: pitch * DEG };
      this.controller.jumpTo(pose);
    }
    const t = params.get('t');
    if (t && !Number.isNaN(Date.parse(`${t}Z`))) this.env.setTime(new Date(`${t}Z`));
    const weather = params.get('weather');
    if (weather && (weather === 'auto' || weather in WEATHER)) {
      this.env.weatherMode = weather as WeatherMode;
      this.hud?.setWeather(weather);
    }
  }

  private waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const tick = () => (cond() || performance.now() - t0 > timeoutMs ? resolve() : setTimeout(tick, 50));
      tick();
    });
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
