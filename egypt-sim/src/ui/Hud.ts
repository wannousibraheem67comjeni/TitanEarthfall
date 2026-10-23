/**
 * HUD: explorer panel (search, 27 governorates by region, cities, landmarks, tours),
 * environment panel (date/time, speed, weather, layers, live data sources), status
 * bar, performance stats and help. Pure DOM; talks to the app through HudActions.
 */
import type { CityDistrict, Governorate, Landmark } from '../data/schema';
import type { EnvironmentState, WeatherMode } from '../environment/Environment';
import { LIVE_SOURCES } from '../config';
import { escapeHtml } from './Labels';
import { TOURS } from '../app/tours';

export type LayerName = 'labels' | 'borders' | 'rivers' | 'cities' | 'landmarks' | 'ships' | 'liveDem' | 'liveOsm';

export interface HudActions {
  flyToGovernorate(g: Governorate): void;
  flyToCity(c: CityDistrict): void;
  flyToLandmark(l: Landmark): void;
  startTour(id: string): void;
  setLocalHours(h: number): void;
  setDate(isoDate: string): void;
  setSpeed(scale: number): void;
  setWeather(mode: WeatherMode): void;
  setLayer(layer: LayerName, on: boolean): void;
  setImagery(id: string | null): void;
  home(): void;
  streetLevel(): void;
}

const SPEEDS: [string, number][] = [['⏸', 0], ['1×', 1], ['1 min/s', 60], ['10 min/s', 600], ['1 h/s', 3600]];
const CATEGORY_LABEL: Record<string, string> = {
  ancient: 'Ancient Egypt', medieval: 'Medieval & Islamic', modern: 'Modern', infrastructure: 'Infrastructure', natural: 'Natural wonders',
};

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};

  constructor(
    root: HTMLElement,
    private readonly data: { governorates: Governorate[]; cities: CityDistrict[]; landmarks: Landmark[] },
    private readonly actions: HudActions,
  ) {
    root.insertAdjacentHTML('beforeend', TEMPLATE);
    for (const node of root.querySelectorAll<HTMLElement>('[data-ref]')) this.el[node.dataset.ref!] = node;
    this.renderLists('');
    this.bind();
  }

  private renderLists(query: string): void {
    const q = query.trim().toLowerCase();
    const match = (...s: (string | undefined)[]) => !q || s.some((x) => x?.toLowerCase().includes(q));
    const byRegion = new Map<string, Governorate[]>();
    for (const g of this.data.governorates) {
      if (!match(g.name, g.nameAr, g.capital, g.capitalAr, g.iso)) continue;
      byRegion.set(g.region, [...(byRegion.get(g.region) ?? []), g]);
    }
    this.el.govList.innerHTML = [...byRegion.entries()].map(([region, list]) => `
      <h4>${escapeHtml(region)}</h4>
      ${list.map((g) => `<button class="item" data-gov="${g.iso}">
        <span class="name">${escapeHtml(g.name)} <span class="ar" lang="ar">${escapeHtml(g.nameAr)}</span></span>
        <span class="meta">${escapeHtml(g.capital)} · ${g.populationM.toFixed(1)} M · ${g.iso}</span>
      </button>`).join('')}`).join('') || '<p class="empty">No governorate matches.</p>';

    const cities = this.data.cities.filter((c) => match(c.name, c.nameAr, c.profile));
    this.el.cityList.innerHTML = cities.map((c) => `<button class="item" data-city="${c.id}">
        <span class="name">${escapeHtml(c.name)} <span class="ar" lang="ar">${escapeHtml(c.nameAr)}</span></span>
        <span class="meta">${escapeHtml(PROFILE_LABEL[c.profile] ?? c.profile)}${c.approx ? ' · approx.' : ''}</span>
      </button>`).join('') || '<p class="empty">No city matches.</p>';

    const byCat = new Map<string, Landmark[]>();
    for (const l of this.data.landmarks) {
      if (!match(l.name, l.nameAr, l.description)) continue;
      byCat.set(l.category, [...(byCat.get(l.category) ?? []), l]);
    }
    this.el.landmarkList.innerHTML = [...byCat.entries()].map(([cat, list]) => `
      <h4>${escapeHtml(CATEGORY_LABEL[cat] ?? cat)}</h4>
      ${list.map((l) => `<button class="item" data-landmark="${l.id}" title="${escapeHtml(l.description)}">
        <span class="name"><i class="dot cat-${l.category}"></i>${escapeHtml(l.name)} <span class="ar" lang="ar">${escapeHtml(l.nameAr)}</span></span>
        <span class="meta">${escapeHtml(l.description)}</span>
      </button>`).join('')}`).join('') || '<p class="empty">No landmark matches.</p>';

    this.el.tourList.innerHTML = TOURS.map((t) => `<button class="item" data-tour="${t.id}">
        <span class="name">${escapeHtml(t.name)}</span><span class="meta">${escapeHtml(t.description)}</span>
      </button>`).join('');
  }

  private bind(): void {
    const e = this.el;
    e.search.addEventListener('input', () => this.renderLists((e.search as HTMLInputElement).value));
    e.explorer.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.tab) {
        for (const b of e.explorer.querySelectorAll('[data-tab]')) b.classList.toggle('active', b === t);
        for (const p of e.explorer.querySelectorAll<HTMLElement>('[data-pane]')) p.hidden = p.dataset.pane !== t.dataset.tab;
      } else if (t.dataset.gov) {
        this.actions.flyToGovernorate(this.data.governorates.find((g) => g.iso === t.dataset.gov)!);
      } else if (t.dataset.city) {
        this.actions.flyToCity(this.data.cities.find((c) => c.id === t.dataset.city)!);
      } else if (t.dataset.landmark) {
        this.actions.flyToLandmark(this.data.landmarks.find((l) => l.id === t.dataset.landmark)!);
      } else if (t.dataset.tour) {
        this.actions.startTour(t.dataset.tour);
      }
    });
    e.time.addEventListener('input', () => this.actions.setLocalHours(parseFloat((e.time as HTMLInputElement).value)));
    e.date.addEventListener('change', () => this.actions.setDate((e.date as HTMLInputElement).value));
    e.speeds.innerHTML = SPEEDS.map(([label, s]) => `<button data-speed="${s}"${s === 60 ? ' class="active"' : ''}>${label}</button>`).join('');
    e.speeds.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-speed]');
      if (!b) return;
      for (const x of e.speeds.children) x.classList.toggle('active', x === b);
      this.actions.setSpeed(parseFloat(b.dataset.speed!));
    });
    e.presets.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-hour]');
      if (b) this.actions.setLocalHours(parseFloat(b.dataset.hour!));
    });
    e.weather.addEventListener('change', () => this.actions.setWeather((e.weather as HTMLSelectElement).value as WeatherMode));
    e.imagery.innerHTML = `<option value="">Procedural surface</option>` + LIVE_SOURCES.imagery.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    e.imagery.addEventListener('change', () => this.actions.setImagery((e.imagery as HTMLSelectElement).value || null));
    e.layers.addEventListener('change', (ev) => {
      const input = ev.target as HTMLInputElement;
      if (input.dataset.layer) this.actions.setLayer(input.dataset.layer as LayerName, input.checked);
    });
    e.home.addEventListener('click', () => this.actions.home());
    e.street.addEventListener('click', () => this.actions.streetLevel());
    e.helpBtn.addEventListener('click', () => e.help.toggleAttribute('hidden'));
    e.help.addEventListener('click', () => e.help.setAttribute('hidden', ''));
    e.statsBtn.addEventListener('click', () => e.stats.toggleAttribute('hidden'));
    for (const btn of document.querySelectorAll<HTMLElement>('[data-collapse]')) {
      btn.addEventListener('click', () => document.querySelector(btn.dataset.collapse!)?.classList.toggle('collapsed'));
    }
    window.addEventListener('keydown', (ev) => {
      if ((ev.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (ev.key === '?' || ev.key === 'h') e.help.toggleAttribute('hidden');
      if (ev.key === '`') e.stats.toggleAttribute('hidden');
      if (ev.key === 'Home') this.actions.home();
    });
  }

  setEnvironment(s: EnvironmentState, speed: number): void {
    const h = s.localHours;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    this.el.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const t = this.el.time as HTMLInputElement;
    if (document.activeElement !== t) t.value = h.toFixed(2);
    const d = this.el.date as HTMLInputElement;
    const iso = s.date.toISOString().slice(0, 10);
    if (document.activeElement !== d && d.value !== iso) d.value = iso;
    this.el.sunInfo.textContent = `Sun ${s.sunElevationDeg >= 0 ? '+' : ''}${s.sunElevationDeg.toFixed(1)}° · ${s.weather}${speed === 0 ? ' · paused' : ''}`;
  }

  setWeather(mode: string): void {
    (this.el.weather as HTMLSelectElement).value = mode;
  }

  setStatus(text: string): void {
    this.el.status.textContent = text;
  }

  setStats(html: string): void {
    if (!this.el.stats.hidden) this.el.stats.innerHTML = html;
  }

  setAttribution(parts: string[]): void {
    this.el.attribution.textContent = parts.join(' · ');
  }

  setCaption(text: string | null): void {
    this.el.caption.textContent = text ?? '';
    this.el.caption.hidden = !text;
  }

  get minimapHost(): HTMLElement {
    return this.el.minimap;
  }

  get labelHost(): HTMLElement {
    return this.el.labels;
  }

  setLayerChecked(layer: LayerName, on: boolean): void {
    const input = this.el.layers.querySelector<HTMLInputElement>(`[data-layer="${layer}"]`);
    if (input) input.checked = on;
  }
}

const PROFILE_LABEL: Record<string, string> = {
  megacity: 'Dense metropolis', historic: 'Historic medina', modern: 'Planned new city', cbd: 'Business district',
  coastal: 'Mediterranean port', resort: 'Red Sea resort', provincial: 'Nile Valley town',
};

const TEMPLATE = /* html */ `
<div class="labels" data-ref="labels"></div>
<aside class="panel explorer" id="explorer" data-ref="explorer">
  <header>
    <div class="brand"><svg class="logo" viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><path d="M32 6 60 56H4z" fill="#e9b65b"/><path d="M32 6 60 56H32z" fill="#b8823a"/></svg><div><h1>Egypt 3D</h1><p>27 governorates · real terrain · live sky</p></div></div>
    <button class="icon" data-collapse="#explorer" title="Collapse">⟨</button>
  </header>
  <input type="search" placeholder="Search governorates, cities, landmarks…" data-ref="search" aria-label="Search" />
  <nav class="tabs">
    <button data-tab="gov" class="active">Governorates</button><button data-tab="city">Cities</button><button data-tab="landmark">Landmarks</button><button data-tab="tour">Tours</button>
  </nav>
  <div class="list" data-pane="gov" data-ref="govList"></div>
  <div class="list" data-pane="city" data-ref="cityList" hidden></div>
  <div class="list" data-pane="landmark" data-ref="landmarkList" hidden></div>
  <div class="list" data-pane="tour" data-ref="tourList" hidden></div>
</aside>
<aside class="panel controls" id="controls">
  <header>
    <div><span class="clock" data-ref="clock">--:--</span><span class="tz">Cairo time</span></div>
    <button class="icon" data-collapse="#controls" title="Collapse">⟩</button>
  </header>
  <div class="sun" data-ref="sunInfo"></div>
  <label class="row">Time of day<input type="range" min="0" max="24" step="0.05" data-ref="time" /></label>
  <div class="chips" data-ref="presets">
    <button data-hour="5.8">Dawn</button><button data-hour="12">Noon</button><button data-hour="17.6">Sunset</button><button data-hour="21.5">Night</button>
  </div>
  <label class="row">Date<input type="date" data-ref="date" /></label>
  <div class="chips speed" data-ref="speeds"></div>
  <label class="row">Atmosphere
    <select data-ref="weather">
      <option value="auto">Auto (coastal ↔ desert)</option><option value="clear">Clear</option><option value="coastal">Coastal haze</option>
      <option value="desert">Desert dust</option><option value="khamaseen">Khamaseen sandstorm</option>
    </select>
  </label>
  <h3>Layers</h3>
  <div class="layers" data-ref="layers">
    <label><input type="checkbox" data-layer="labels" checked />Labels</label>
    <label><input type="checkbox" data-layer="borders" checked />Borders</label>
    <label><input type="checkbox" data-layer="rivers" checked />Nile overlay</label>
    <label><input type="checkbox" data-layer="cities" checked />Cities</label>
    <label><input type="checkbox" data-layer="landmarks" checked />Landmarks</label>
    <label><input type="checkbox" data-layer="ships" checked />Suez ships</label>
  </div>
  <h3>Live data</h3>
  <label class="row">Surface<select data-ref="imagery"></select></label>
  <div class="layers">
    <label title="Stream ≈30 m SRTM tiles for close-range terrain"><input type="checkbox" data-layer="liveDem" />High-res DEM</label>
    <label title="Replace procedural buildings with OpenStreetMap footprints (Overpass API)"><input type="checkbox" data-layer="liveOsm" />OSM buildings</label>
  </div>
  <div class="chips nav">
    <button data-ref="home" title="Whole country (Home)">⌂ Egypt</button>
    <button data-ref="street" title="Drop to street level at the view centre">⬇ Street level</button>
    <button data-ref="helpBtn" title="Controls (?)">?</button>
    <button data-ref="statsBtn" title="Performance (\`)">⚙</button>
  </div>
</aside>
<div class="minimap-host" data-ref="minimap"></div>
<div class="caption" data-ref="caption" hidden></div>
<pre class="stats" data-ref="stats" hidden></pre>
<footer class="statusbar"><span data-ref="status"></span><span class="attribution" data-ref="attribution"></span></footer>
<div class="help" data-ref="help" hidden>
  <div class="card">
    <h2>Controls</h2>
    <table>
      <tr><td>Drag</td><td>Pan (grab the ground)</td></tr>
      <tr><td>Right-drag / Ctrl-drag</td><td>Rotate &amp; tilt</td></tr>
      <tr><td>Wheel / pinch</td><td>Zoom toward cursor</td></tr>
      <tr><td>Double-click</td><td>Fly closer</td></tr>
      <tr><td>W A S D / arrows</td><td>Move</td></tr>
      <tr><td>Q / E · R / F</td><td>Rotate · tilt</td></tr>
      <tr><td>+ / −</td><td>Zoom</td></tr>
      <tr><td>Home</td><td>Back to the whole country</td></tr>
      <tr><td>\` (backtick)</td><td>Performance stats</td></tr>
    </table>
    <p>Click any label, list entry or the minimap to fly there. The view is saved in the URL.</p>
  </div>
</div>`;
