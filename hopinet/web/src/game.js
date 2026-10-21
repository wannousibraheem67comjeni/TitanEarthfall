// Game engine: renderer, lobby scene (a luxurious home on its own island), run simulation
// (running, swimming, diving, jumping over gaps, vehicles, plane flights, power-ups, stages,
// the pirate-airship boss), camera and effects.
import * as THREE from 'three';
import {
  LANES, PHYS, POWERUPS, POWERUP_IDS, BOSS, SCORE, HEADSTART_DISTANCE, WATER_Y, VEHICLES, TILE,
} from './config.js';
import { Basic, sparkTex, makeBomb } from './models.js';
import { makeCritter, animateCritter, makeVillain, animateVillain } from './critter.js';
import { makeVehicle, animateVehicle, makeBossAirship, animateBossAirship } from './vehicles.js';
import { makeBackdrop, setWaterTime } from './backdrop.js';
import { makeHome, setHomeStage, setHomeItems, updateHome } from './house.js';
import { Track } from './track.js';
import { Audio } from './audio.js';

const tmpV = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Particles {
  constructor(scene, n = 140) {
    this.items = [];
    this.tex = sparkTex();
    this.mats = new Map();
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.mat(0xffffff));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, life: 0, max: 1, v: new THREE.Vector3(), g: 0, size: 1 });
    }
    this.i = 0;
  }
  mat(color) {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.SpriteMaterial({ map: this.tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }); this.mats.set(color, m); }
    return m;
  }
  burst(pos, color, count = 8, speed = 4, size = 0.5, life = 0.5, gravity = 4) {
    for (let k = 0; k < count; k++) {
      const p = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
      p.s.material = this.mat(color);
      p.s.position.copy(pos);
      p.v.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed);
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.g = gravity; p.size = size * (0.6 + Math.random() * 0.8);
      p.s.visible = true;
    }
  }
  splash(pos, n = 14) { this.burst(pos, 0xbfeaff, n, 6, 0.55, 0.7, 14); this.burst(pos, 0xffffff, Math.ceil(n / 2), 3, 0.4, 0.5, 8); }
  bubbles(pos, n = 3) {
    for (let k = 0; k < n; k++) {
      const p = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
      p.s.material = this.mat(0xd8f6ff);
      p.s.position.set(pos.x + (Math.random() - 0.5) * 0.8, pos.y, pos.z + (Math.random() - 0.5) * 0.5);
      p.v.set((Math.random() - 0.5) * 0.4, 1.6 + Math.random(), 0);
      p.life = p.max = 0.9; p.g = -0.5; p.size = 0.25 + Math.random() * 0.25; p.s.visible = true;
    }
  }
  confetti(pos, n = 30) {
    const cols = [0xffd34d, 0xff5a5f, 0x4dd8ff, 0x7dff8a, 0xff7af5];
    for (let k = 0; k < n; k++) this.burst(pos, cols[k % cols.length], 1, 9, 0.5, 1.4, 6);
  }
  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.v.y -= p.g * dt;
      p.s.position.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      p.s.scale.setScalar(p.size * (0.4 + k * 0.6));
      p.s.material.opacity = k;
    }
  }
  clear() { for (const p of this.items) { p.life = 0; p.s.visible = false; } }
}

export class Game {
  constructor(canvas, hooks, quality = 'high') {
    this.hooks = hooks;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x87ceeb);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    this.scene = new THREE.Scene();
    this.lobby = new THREE.Scene();
    this.mode = 'lobby';
    this.view = 'home';
    this.time = 0;
    this.paused = false;
    this.renderOn = true;
    this.timeScale = 1;
    this.shake = 0;
    this.orbit = 0; this.orbitV = 0;
    this.world = null;
    this.lobbyWorld = null;
    this.setQuality(quality);
    this._setupRunScene();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
    this.last = performance.now();
    this._frame = (t) => this.frame(t);
    requestAnimationFrame(this._frame);
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : 1));
    this.renderer.shadowMap.enabled = q === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.sun) this.sun.castShadow = q === 'high';
    if (this.lobbySun) this.lobbySun.castShadow = q === 'high';
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- scenes ----------------
  _setupRunScene() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.0);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.3);
    this.sun.castShadow = this.quality === 'high';
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0008;
    s.add(this.sun); s.add(this.sun.target);
    this.particles = new Particles(s);
    // effects around the player
    this.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.25, 20, 14), Basic(0x39c6ff, { opacity: 0.25, blend: true }));
    this.shieldBubble.visible = false;
    this.magnetRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 6, 30), Basic(0xff3d5a, { opacity: 0.8, blend: true }));
    this.magnetRing.rotation.x = Math.PI / 2; this.magnetRing.visible = false;
    this.bombRing = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 6, 30), Basic(0xff7a1f, { opacity: 0.8, blend: true }));
    this.bombRing.rotation.x = Math.PI / 2; this.bombRing.visible = false;
    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5), Basic(0xff2020, { opacity: 0.45, blend: true }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    this.wake = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.1, 24), Basic(0xffffff, { opacity: 0.55, blend: true, side: true }));
    this.wake.rotation.x = -Math.PI / 2; this.wake.visible = false;
    s.add(this.shieldBubble, this.magnetRing, this.bombRing, this.marker, this.wake);
    this.airship = makeBossAirship(); this.airship.visible = false; s.add(this.airship);
    this.villain = makeVillain(); this.villain.visible = false; s.add(this.villain);
    this.projectiles = [];
  }

  _applyWorldLighting(scene, world, hemi, sun) {
    scene.fog = new THREE.Fog(world.fog, world.fogNear, world.fogFar);
    hemi.color.set(world.hemi[0]); hemi.groundColor.set(world.hemi[1]); hemi.intensity = world.hemi[2];
    sun.color.set(world.sun[0]); sun.intensity = world.sun[1];
    this.renderer.setClearColor(world.fog);
  }

  setRunWorld(world) {
    if (this.world === world) return;
    this.world = world;
    if (this.track) this.track.dispose();
    this.track = new Track(this.scene, world, { quality: this.quality });
    if (this.backdrop) this.scene.remove(this.backdrop);
    this.backdrop = makeBackdrop(world, { quality: this.quality });
    this.scene.add(this.backdrop);
    this._applyWorldLighting(this.scene, world, this.hemi, this.sun);
    if (this.snow) { this.scene.remove(this.snow); this.snow = null; }
    if (world.snow) {
      const n = 700, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = Math.random() * 20; pos[i * 3 + 2] = -Math.random() * 60; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.9 }));
      this.scene.add(this.snow);
    }
  }

  setPlayer(species, skin) {
    this._detachRider();
    if (this.player) this.scene.remove(this.player);
    this.player = makeCritter(species, skin, { jet: false, backpack: true });
    this.scene.add(this.player);
    this.player.add(this.shieldBubble);
    this.shieldBubble.position.set(0, 1.1, 0);
    this.player.add(this.magnetRing);
    this.magnetRing.position.set(0, 0.15, 0);
    this.player.add(this.bombRing);
    this.bombRing.position.set(0, 0.2, 0);
  }

  // Lobby: the home of the current world on its island, the selected courier standing in front of it.
  setLobby(world, stage, items, species, skin) {
    const L = this.lobby;
    if (this.lobbyWorld !== world) {
      this.lobbyWorld = world;
      while (L.children.length) L.remove(L.children[0]);
      this.lobbyHemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1);
      this.lobbySun = new THREE.DirectionalLight(0xffffff, 1.3);
      this.lobbySun.position.set(world.sunDir[0], world.sunDir[1], world.sunDir[2]);
      this.lobbySun.castShadow = this.quality === 'high';
      this.lobbySun.shadow.mapSize.set(1024, 1024);
      const sc = this.lobbySun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.far = 80;
      this.lobbySun.shadow.bias = -0.0006;
      L.add(this.lobbyHemi, this.lobbySun);
      this._applyWorldLighting(L, world, this.lobbyHemi, this.lobbySun);
      L.fog = new THREE.Fog(world.fog, 60, 260);
      this.lobbyBackdrop = makeBackdrop(world, { quality: this.quality, lobby: true });
      L.add(this.lobbyBackdrop);
      this.home = makeHome(world, stage, items);
      L.add(this.home);
      this.lobbyChar = null; this.lobbySpecies = null; this.lobbySkin = null;
    }
    setHomeStage(this.home, stage);
    setHomeItems(this.home, items);
    if (species && (this.lobbySkin !== skin || this.lobbySpecies !== species)) {
      this.lobbySkin = skin; this.lobbySpecies = species;
      if (this.lobbyChar) this.lobby.remove(this.lobbyChar);
      this.lobbyChar = makeCritter(species, skin, { jet: false, backpack: true });
      this.lobbyChar.position.set(0, 0, 0);
      this.lobby.add(this.lobbyChar);
      this.waveT = 1.4;
    }
  }
  celebrateLobby() { this.waveT = 1.8; }
  setView(v) { this.view = v; }
  dragLobby(dx) { this.orbitV += dx * 0.004; }
  buildPulse() { this.buildFx = 1.2; }
  showLobby() {
    this.mode = 'lobby';
    this.renderOn = true;
    Audio.jet(false); Audio.engine(null); Audio.setUnderwater(false); Audio.setMuffle(0);
  }

  // ---------------- run lifecycle ----------------
  startRun(opts) {
    // opts: { world, species, skin, durations, vehicleExtra, vehicleBonus, mult, doubler, scoreBonus, goldBonus, tutorial, headstarts, stage }
    if (this.run && this.run.vehicle) { this._detachRider(); this.scene.remove(this.run.vehicle.mesh); this.run.vehicle = null; }
    this.setRunWorld(opts.world);
    this.setPlayer(opts.species, opts.skin);
    this.opts = opts;
    const st = opts.stage || null;
    this.stage = st;
    const zoneOpts = { zoneWater: 1, zoneGaps: 1, safeTiles: 6, vehicleEvery: 420, vehicleFirst: 170 };
    if (st) {
      if (st.goal.type === 'swim') { zoneOpts.zoneWater = 3.2; zoneOpts.safeTiles = 3; }
      if (st.goal.type === 'vehicle') { zoneOpts.vehicleEvery = 200; zoneOpts.vehicleFirst = 90; }
    }
    this.track.reset(zoneOpts);
    this.particles.clear();
    this.projectiles.forEach((p) => this.scene.remove(p.mesh));
    this.projectiles = [];
    if (opts.tutorial) this.track.startTutorial();
    if (st && st.goal.type === 'dist') this.track.addFinish(st.goal.n);
    this.track.coinLine(1, 10, 10, 2.0);
    this.track.nextD = 46;
    this.run = {
      d: 0, prevD: 0, speed: PHYS.startSpeed, x: 0, lane: 1, targetLane: 1, prevLane: 1, y: 0, vy: 0, grounded: true, coyote: 0,
      slideT: 0, underwater: false, diveT: 0, airT: 0, flip: false, state: 'intro', introT: 1.4, invuln: 0, stumbleT: 0,
      score: 0, gold: 0, gems: 0, time: 0, mult: opts.mult, pu: { magnet: 0, shield: 0, jet: 0, double: 0, bombmag: 0 },
      puMax: { ...opts.durations }, flight: null, flying: false, landing: false, planeLevel: 1, bank: 0, rocketTo: 0,
      vehicle: null, revives: 0, bossNext: st ? (st.goal.type === 'boss' ? 380 : 1e9) : BOSS.firstAt, crashT: 0, crashCause: 'hit',
      phase: 0, onRoof: false, headstartWindow: opts.headstarts > 0 && !opts.tutorial ? 4.5 : 0, vaults: 0, zone: 'road',
      goalDone: false, finishAt: 0, wonT: 0, lastGapTile: -1,
      stats: { gold: 0, dist: 0, jumps: 0, slides: 0, pu_magnet: 0, pu_jet: 0, pu_shield: 0, pu_double: 0, pu_bombmag: 0, bosses: 0, emps: 0, roofs: 0, gemsPicked: 0, lanes: 0, swim: 0, dives: 0, vehicles: 0, planes: 0, blasts: 0, rings: 0, gaps: 0 },
    };
    this.boss = null;
    this.airship.visible = false;
    this.marker.visible = false;
    this.scene.add(this.villain);
    this.villain.visible = true;
    this.villain.position.set(0, 0, -7);
    this.villain.rotation.set(0, 0, 0);
    this.villainT = 0;
    this.villainEscapedMsg = false;
    this.player.position.set(0, 0, 0);
    this.player.rotation.set(0, 0, 0);
    this.player.userData.jet.visible = false;
    this.mode = 'run';
    this.renderOn = true;
    this.paused = false;
    this.timeScale = 1;
    this.camera.clearViewOffset();
    this.viewOff = { x: 0, y: 0 };
    this.camPos = new THREE.Vector3(0, 6, 12);
    this.camLook = new THREE.Vector3(0, 1.5, -8);
    this.hooks.event('villain', { key: 'villainTaunt' });
    Audio.play('laugh');
    Audio.setMuffle(0); Audio.setUnderwater(false); Audio.engine(null);
    if (this.run.headstartWindow) this.hooks.event('headstartOffer', { show: true });
    if (st) this.hooks.event('stage', { stage: st });
  }

  useHeadstart() {
    const r = this.run;
    if (!r || r.state === 'crashed' || r.rocketTo || r.flight || r.vehicle) return false;
    r.rocketTo = r.d + HEADSTART_DISTANCE;
    r.headstartWindow = 0;
    r.state = 'running';
    this._startFlight('jet');
    this.hooks.event('headstartOffer', { show: false });
    this.hooks.event('toast', { key: 'useHeadstart', kind: 'gold' });
    Audio.play('whoosh');
    return true;
  }

  pause() { if (this.mode === 'run' && !this.paused) { this.paused = true; Audio.jet(false); Audio.engine(null); } }
  resume() {
    if (this.mode === 'run' && this.paused) {
      this.paused = false;
      this.last = performance.now();
      if (this.run.flight === 'jet') Audio.jet(true);
      if (this.run.vehicle) Audio.engine(this.run.vehicle.kind);
    }
  }

  revive() {
    const r = this.run;
    r.revives++;
    r.state = 'running';
    r.invuln = 3;
    r.vy = 0;
    r.underwater = false;
    if (r.crashCause === 'fall') {
      // Fell off a broken bridge: put the rider back on solid ground beyond the gap.
      const gi = Math.floor(r.d / TILE);
      if (this.track.zoneAt(r.d) === 'gap') r.d = Math.max(r.d, gi * TILE + PHYS.gapStart + PHYS.gapLength + 1);
      r.prevD = r.d;
    }
    this.track.clearRange(r.d - 4, r.d + 45);
    r.y = Math.max(this.track.zoneAt(r.d) === 'water' ? WATER_Y : 0, this.track.floorAt(r.x, r.d, 3, PHYS.playerHalfWidth, false));
    r.grounded = true;
    r.stumbleT = 0;
    this.player.rotation.set(0, 0, 0);
    this.paused = false;
    this.last = performance.now();
    Audio.play('powerup');
  }

  finishRun() {
    const r = this.run;
    if (r.state === 'over') return null; // already finished: never pay a run out twice
    const won = r.state === 'won';
    r.state = 'over';
    this.timeScale = 1;
    Audio.jet(false); Audio.engine(null); Audio.setMuffle(0); Audio.setUnderwater(false);
    r.stats.dist = Math.floor(r.d);
    return { score: Math.floor(r.score), dist: Math.floor(r.d), gold: r.gold, gems: r.gems, stats: r.stats, revives: r.revives, vaults: r.vaults, won, stage: this.stage };
  }

  // ---------------- input ----------------
  input(action) {
    const r = this.run;
    if (this.mode !== 'run' || this.paused || !r || r.state === 'crashed' || r.state === 'over' || r.state === 'won') return;
    if (r.state === 'intro') { r.state = 'running'; }
    if (action === 'left' || action === 'right') {
      const dir = action === 'left' ? -1 : 1;
      const nl = clamp(r.targetLane + dir, 0, 2);
      if (nl !== r.targetLane) {
        r.prevLane = r.targetLane;
        r.targetLane = nl;
        r.stats.lanes++;
        Audio.play('lane');
      }
      return;
    }
    if (r.flight === 'plane') {
      if (action === 'up' || action === 'down') {
        const nl = clamp(r.planeLevel + (action === 'up' ? 1 : -1), 0, 2);
        if (nl !== r.planeLevel) { r.planeLevel = nl; Audio.play('whoosh'); }
      }
      return;
    }
    if (r.flying) return;
    const inWater = r.zone === 'water' && !r.vehicle;
    if (action === 'up') {
      if (r.underwater) { r.underwater = false; r.diveT = 0; r.vy = PHYS.jumpVelocity * 0.8; r.grounded = false; Audio.setUnderwater(false); Audio.play('splash'); return; }
      if (r.grounded || r.coyote > 0) {
        r.vy = PHYS.jumpVelocity * (inWater ? 0.9 : 1);
        r.grounded = false; r.coyote = 0;
        r.slideT = 0; r.airT = 0; r.flip = Math.random() < 0.65;
        r.stats.jumps++;
        Audio.play(inWater ? 'splash' : 'jump');
        if (inWater) this.particles.splash(tmpV.set(r.x, WATER_Y + 0.1, -r.d), 10);
      }
    } else if (action === 'down') {
      if (inWater && r.grounded && !r.underwater) {
        r.underwater = true; r.diveT = PHYS.diveTime; r.stats.dives++;
        Audio.play('dive'); Audio.setUnderwater(true);
        this.particles.splash(tmpV.set(r.x, WATER_Y + 0.1, -r.d), 10);
        return;
      }
      if (!r.grounded) r.vy = Math.min(r.vy, PHYS.fastFall);
      if (!inWater) { r.slideT = PHYS.slideTime; r.stats.slides++; Audio.play('slide'); }
    }
  }

  // ---------------- main loop ----------------
  frame(now) {
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    this.time += dt;
    if (!this.renderOn) return;
    setWaterTime(this.time);
    if (this.mode === 'run') {
      if (!this.paused) this.updateRun(dt * this.timeScale, dt);
      this.backdrop.userData.update(this.time, this.camera);
      this.renderer.render(this.scene, this.camera);
    } else {
      this.updateLobby(dt);
      this.renderer.render(this.lobby, this.camera);
    }
  }

  updateLobby(dt) {
    const t = this.time;
    const portrait = this.camera.aspect < 1;
    const fit = (w) => {
      const vfov = THREE.MathUtils.degToRad(this.camera.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      return (w / 2) / Math.tan(hfov / 2);
    };
    const R = this.home && this.home.userData.bounds ? this.home.userData.bounds.radius : 12;
    // The character stands in front of the house; the camera orbits the plot.
    const charAt = new THREE.Vector3(2.6, 0, R * 0.62);
    let dist, height, look, center;
    if (this.view === 'char') {
      dist = Math.max(5.2, fit(3.8)); height = 2.0;
      look = new THREE.Vector3(charAt.x, 1.15, charAt.z); center = charAt;
    } else if (this.view === 'house') {
      dist = Math.max(R * 1.25, fit(R * 1.9)); height = R * 0.5;
      look = new THREE.Vector3(0, 2.4, 0); center = new THREE.Vector3(0, 0, 0);
    } else {
      dist = Math.max(R * 1.15, fit(R * 1.55)); height = R * 0.42;
      look = new THREE.Vector3(0, portrait ? 1.9 : 2.6, 0); center = new THREE.Vector3(0, 0, 0);
    }
    const sheet = this.view === 'char' || this.view === 'house';
    const W = window.innerWidth, H = window.innerHeight;
    const want = sheet ? (portrait ? { x: 0, y: 0.27 * H } : { x: (document.documentElement.dir === 'rtl' ? -0.24 : 0.24) * W, y: 0 }) : { x: 0, y: portrait ? 0 : 0.14 * H };
    this.viewOff = this.viewOff || { x: 0, y: 0 };
    this.viewOff.x = damp(this.viewOff.x, want.x, 6, dt);
    this.viewOff.y = damp(this.viewOff.y, want.y, 6, dt);
    if (Math.abs(this.viewOff.x) + Math.abs(this.viewOff.y) > 0.5) this.camera.setViewOffset(W, H, this.viewOff.x, this.viewOff.y, W, H);
    else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
    // slow auto-orbit with inertia from dragging
    this.orbitV *= Math.pow(0.05, dt);
    this.orbit += this.orbitV + dt * (this.view === 'home' ? 0.045 : 0.0);
    const ang = (this.view === 'char' ? 0.35 : 0) + this.orbit;
    const want3 = new THREE.Vector3(center.x + Math.sin(ang) * dist, height, center.z + Math.cos(ang) * dist);
    if (!this.lobbyCamPos) { this.lobbyCamPos = want3.clone(); this.lobbyCamLook = look.clone(); }
    this.lobbyCamPos.lerp(want3, 1 - Math.exp(-3 * dt));
    this.lobbyCamLook.lerp(look, 1 - Math.exp(-4 * dt));
    this.camera.position.copy(this.lobbyCamPos);
    this.camera.lookAt(this.lobbyCamLook);
    if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
    if (this.lobbyChar) {
      this.lobbyChar.position.copy(charAt);
      this.lobbyChar.rotation.y = Math.atan2(this.lobbyCamPos.x - charAt.x, this.lobbyCamPos.z - charAt.z);
      if (this.waveT > 0) { this.waveT -= dt; animateCritter(this.lobbyChar, 'wave', 0, t, {}); } else animateCritter(this.lobbyChar, (t % 9) < 1.6 ? 'cheer' : 'idle', 0, t, {});
    }
    if (this.home) {
      updateHome(this.home, t, dt);
      if (this.buildFx > 0) { this.buildFx -= dt; this.home.scale.setScalar(1 + Math.sin(this.buildFx * 14) * 0.012 * this.buildFx); } else this.home.scale.setScalar(1);
    }
    if (this.lobbyBackdrop) this.lobbyBackdrop.userData.update(t, this.camera);
  }

  // ---------------- run update ----------------
  updateRun(dt, realDt) {
    const r = this.run;
    const P = this.player;
    if (r.state === 'over') { this._updateCamera(realDt, true); return; }
    r.time += dt;
    this.particles.update(dt);

    if (r.state === 'crashed') {
      r.crashT += realDt;
      if (r.crashCause === 'fall') {
        r.vy -= PHYS.gravity * dt; r.y += r.vy * dt;
        P.position.set(r.x, r.y, -r.d);
        animateCritter(P, 'fall', r.crashT * 8, this.time, {});
      } else animateCritter(P, 'fall', r.crashT * 8, this.time, {});
      this.track.update(0, r.d, this.time);
      this._updateCamera(realDt, true);
      if (r.crashT > 0.9 && !r.crashNotified) {
        r.crashNotified = true;
        this.hooks.onCrash({ revives: r.revives, cause: r.crashCause });
      }
      return;
    }
    if (r.state === 'won') { this._updateWon(dt, realDt); return; }

    if (r.headstartWindow > 0) {
      r.headstartWindow -= realDt;
      if (r.headstartWindow <= 0) this.hooks.event('headstartOffer', { show: false });
    }

    const zone = this.track.zoneAt(r.d);
    const inWater = zone === 'water';
    if (zone !== r.zone) this._zoneChanged(r, zone);

    // ----- speed -----
    const base = PHYS.startSpeed + PHYS.maxSpeedGain * (1 - Math.exp(-r.d / PHYS.speedRamp));
    let target = r.state === 'intro' ? base * 0.75 : base;
    if (r.rocketTo) target = base * 2.3;
    else if (r.vehicle) target = base * VEHICLES[r.vehicle.kind].speedMul;
    r.speed = damp(r.speed, target, 3, dt);
    const dd = r.speed * dt;
    r.prevD = r.d;
    r.d += dd;
    r.phase += dd * (inWater && !r.vehicle ? 0.55 : 0.95);
    if (r.state === 'intro') { r.introT -= dt; if (r.introT <= 0) r.state = 'running'; }
    r.score += dd * SCORE.perMetre * r.mult * (1 + (this.opts.scoreBonus || 0));
    if (inWater && !r.flying && !r.vehicle) r.stats.swim += dd;

    // ----- lateral movement -----
    const tx = LANES[r.targetLane];
    const step = PHYS.laneSpeed * dt;
    const prevX = r.x;
    if (Math.abs(tx - r.x) <= step) r.x = tx; else r.x += Math.sign(tx - r.x) * step;
    if (Math.abs(r.x - tx) < 0.01) r.lane = r.targetLane;

    // ----- timers: power-ups, vehicle, invulnerability -----
    for (const id of POWERUP_IDS) {
      if (r.pu[id] > 0) {
        r.pu[id] -= dt;
        if (r.pu[id] <= 0) {
          r.pu[id] = 0;
          if (id === 'jet' && !r.rocketTo && r.flight === 'jet') this._beginLanding();
          if (id === 'shield') Audio.setMuffle(0);
        }
      }
    }
    if (r.rocketTo && r.d >= r.rocketTo) { r.rocketTo = 0; if (r.pu.jet <= 0 && r.flight === 'jet') this._beginLanding(); }
    if (r.vehicle) {
      r.vehicle.t -= dt;
      if (r.vehicle.t <= 0) this._dismount('time');
    }
    if (r.invuln > 0) r.invuln -= dt;
    if (r.stumbleT > 0) r.stumbleT -= dt;

    // ----- vertical movement -----
    const prevY = r.y;
    if (r.flying) this._updateFlight(r, dt, tx);
    else this._updateGround(r, dt, zone, inWater, prevY);
    if (r.state === 'crashed') return;

    // gap statistics: crossed a broken bridge without falling
    const ti = Math.floor(r.d / TILE);
    if (this.track.tileType(ti) === 'gap' && r.d - ti * TILE > PHYS.gapStart + PHYS.gapLength + 0.5 && r.lastGapTile !== ti && r.y > -1) { r.lastGapTile = ti; r.stats.gaps++; }

    // tutorial slow-motion gates
    this._tutorial(r);

    // ----- collisions -----
    if (r.flight === 'plane' && !r.landing) this._collideSky(r);
    else if (!r.flying) this._collide(r, prevX);
    if (r.state === 'crashed') return;

    this._pickups(r, dt);
    this._bombMagnet(r, dt);

    // ----- spawn ahead -----
    const difficulty = Math.min(1, (this.stage ? this.stage.difficulty : 0) + r.d / 4200);
    this.track.spawnRows(r.d, r.speed, difficulty, { flight: r.flight });
    this.track.update(dt, r.d, this.time);

    // ----- boss, villain, stage goal -----
    if (!this.boss && r.d >= r.bossNext && !r.flying && !r.vehicle) this._startBoss();
    if (this.boss) this._updateBoss(dt);
    this._updateProjectiles(dt);
    this._updateVillain(dt);
    this._checkStageGoal(r);
    if (r.state === 'won') return;

    // ----- player transform & animation -----
    this._poseRider(r, dt, tx);
    this._updateEffects(r, dt);

    // world helpers follow the player
    this.sun.position.set(r.x + 6, 18, -r.d + 10);
    this.sun.target.position.set(r.x, 0, -r.d - 6);
    if (this.snow) this._updateSnow(dt, r);

    this._updateCamera(realDt, false);
    this._updateAudioState(r);

    r.stats.dist = Math.floor(r.d);
    this.hooks.onTick(r);
  }

  // Ground physics: running, swimming, diving, jumping, falling into gaps.
  _updateGround(r, dt, zone, inWater, prevY) {
    if (r.slideT > 0) r.slideT -= dt;
    const bridge = r.vehicle && r.vehicle.kind === 'car';
    if (r.underwater) {
      // Diving: glide under the surface, then pop back up during the last moments.
      r.diveT -= dt;
      const tgt = r.diveT > 0.2 ? PHYS.diveY : WATER_Y;
      r.y = damp(r.y, tgt, 14, dt);
      r.vy = 0; r.grounded = true;
      if (r.diveT <= 0 || !inWater) { r.underwater = false; r.diveT = 0; r.y = inWater ? WATER_Y : r.y; Audio.setUnderwater(false); }
      return;
    }
    r.vy -= PHYS.gravity * dt;
    r.y += r.vy * dt;
    const maxTop = r.grounded ? prevY + 0.35 : (r.vy <= 0 ? prevY + 0.35 : prevY + 0.05);
    const floor = this.track.floorAt(r.x, r.d, maxTop, PHYS.playerHalfWidth, bridge);
    if (r.y <= floor && r.vy > 0.01) {
      r.y = floor; // pushed up by a ramp while still rising
    } else if (r.y <= floor) {
      if (!r.grounded && r.vy < -6) {
        if (inWater && !r.vehicle) { Audio.play('splash'); this.particles.splash(tmpV.set(r.x, WATER_Y + 0.1, -r.d), 12); }
        else { Audio.play('land'); this.particles.burst(tmpV.set(r.x, floor + 0.1, -r.d), 0xffffff, 5, 3, 0.5, 0.35, 2); }
      }
      if (floor > 2 && !r.onRoof) r.stats.roofs++;
      r.y = floor; r.vy = 0; r.grounded = true; r.coyote = 0.1;
      r.onRoof = floor > 2;
    } else if (r.y > floor + 0.02) {
      if (r.grounded) r.coyote = 0.1;
      r.grounded = false;
    }
    if (!r.grounded) r.airT += dt;
    if (r.coyote > 0 && !r.grounded) r.coyote -= dt;
    if (r.grounded && floor < 0.01) r.onRoof = false;
    // fell through a broken bridge
    if (r.y < -2.4 && floor < -10) this._crash(r, null, 'fall');
  }

  // Jet pack / plane: fixed or selectable altitude, soft landing when it ends.
  _updateFlight(r, dt, tx) {
    r.grounded = false; r.vy = 0; r.slideT = 0; r.underwater = false;
    const ground = this.track.zoneAt(r.d) === 'water' ? WATER_Y : 0;
    if (r.landing) {
      // Descend gently, but never land on a broken bridge.
      const overGap = this.track.zoneAt(r.d) === 'gap' || this.track.zoneAt(r.d + 10) === 'gap';
      const tgt = overGap ? 2.5 : ground;
      r.y = damp(r.y, tgt, overGap ? 3 : 2.4, dt);
      r.bank = damp(r.bank, 0, 6, dt);
      if (!overGap && r.y - ground < 0.4) this._endFlight();
      return;
    }
    if (r.flight === 'plane') {
      r.y = damp(r.y, PHYS.planeLevels[r.planeLevel], 4.5, dt);
      r.bank = damp(r.bank, clamp((tx - r.x) * 0.45, -0.75, 0.75), 8, dt);
    } else {
      r.y = damp(r.y, PHYS.jetHeight, 3, dt);
      r.bank = damp(r.bank, 0, 6, dt);
    }
  }

  _startFlight(kind) {
    const r = this.run;
    r.flight = kind; r.flying = true; r.landing = false;
    r.slideT = 0; r.underwater = false; r.diveT = 0;
    r.planeLevel = 1;
    this.track.skyPath = null;
    this.track.nextSkyD = r.d + 18;
    if (kind === 'jet') { this.player.userData.jet.visible = true; Audio.jet(true); }
    Audio.setMode(kind === 'plane' ? 'plane' : 'run');
  }
  _beginLanding() {
    const r = this.run;
    if (!r.flying || r.landing) return;
    r.landing = true;
    Audio.jet(false);
  }
  _endFlight() {
    const r = this.run;
    if (!r.flying) return;
    r.flight = null; r.flying = false; r.landing = false;
    r.vy = -2; r.rocketTo = 0;
    r.invuln = Math.max(r.invuln, 1.6);
    this.player.userData.jet.visible = false;
    this.track.endFlight(r.d);
    Audio.jet(false);
    Audio.setMode(this.boss ? 'boss' : 'run');
    this.particles.burst(tmpV.set(r.x, r.y + 0.5, -r.d), 0xffffff, 8, 4, 0.7, 0.5, 2);
  }

  _zoneChanged(r, zone) {
    const prev = r.zone;
    r.zone = zone;
    if (r.flying) return;
    if (zone === 'water') {
      if (r.vehicle && r.vehicle.kind === 'car') this._dismount('water');
      this.particles.splash(tmpV.set(r.x, WATER_Y + 0.1, -r.d), 18);
      Audio.play('splash');
      this.hooks.event('zone', { type: 'water' });
    } else if (prev === 'water') {
      if (r.vehicle && (r.vehicle.kind === 'boat' || r.vehicle.kind === 'ship')) this._dismount('land');
      r.underwater = false; Audio.setUnderwater(false);
      this.particles.splash(tmpV.set(r.x, 0.1, -r.d), 10);
      Audio.play('splash');
    }
  }

  // ---------------- vehicles ----------------
  _mount(kind) {
    const r = this.run;
    const def = VEHICLES[kind];
    const dur = (def.dur + (this.opts.vehicleExtra || 0)) * (1 + (this.opts.vehicleBonus || 0));
    const mesh = makeVehicle(kind, this.world);
    this.scene.add(mesh);
    r.vehicle = { kind, t: dur, max: dur, wide: !!def.wide, mesh };
    this._attachRider(mesh);
    r.stats.vehicles++;
    if (kind === 'plane') r.stats.planes++;
    r.invuln = Math.max(r.invuln, 0.8);
    r.slideT = 0; r.underwater = false; r.diveT = 0; Audio.setUnderwater(false);
    Audio.play('mount'); Audio.engine(kind);
    this.particles.burst(tmpV.set(r.x, r.y + 1, -r.d), def.color, 14, 6, 0.8, 0.6, 3);
    this.hooks.event('vehicle', { kind, show: true });
    this.hooks.event('toast', { key: 'veh_' + kind, kind: 'power', icon: 'veh_' + kind, center: true });
    if (kind === 'plane') {
      r.y = Math.max(r.y, 0.5);
      this._startFlight('plane');
    }
  }
  _attachRider(vmesh) {
    const P = this.player;
    const seat = vmesh.userData.seat || { x: 0, y: 0.6, z: 0 };
    this.scene.remove(P);
    vmesh.add(P);
    P.position.set(seat.x, seat.y, seat.z);
    P.rotation.set(0, 0, 0);
    this._rider = vmesh;
  }
  _detachRider() {
    if (this._rider && this.player && this.player.parent === this._rider) {
      this._rider.remove(this.player);
      this.scene.add(this.player);
    }
    this._rider = null;
  }
  _removeVehicleMesh() {
    const r = this.run;
    this._detachRider();
    if (r.vehicle && r.vehicle.mesh) this.scene.remove(r.vehicle.mesh);
  }
  // Vehicle ends (time, zone change, wreck).
  _dismount(why) {
    const r = this.run;
    const v = r.vehicle;
    if (!v) return;
    Audio.engine(null);
    this.hooks.event('vehicle', { kind: v.kind, show: false });
    if (why === 'wreck') this._explodeVehicle();
    this._removeVehicleMesh();
    r.vehicle = null;
    r.invuln = Math.max(r.invuln, why === 'wreck' ? 2 : 1.6);
    if (v.kind === 'plane') {
      // The rider glides down softly.
      this._beginLanding();
      return;
    }
    r.vy = why === 'time' ? 6 : 3; r.grounded = false;
    this.particles.burst(tmpV.set(r.x, r.y + 0.8, -r.d), 0xffffff, 10, 5, 0.7, 0.5, 4);
  }
  _explodeVehicle() {
    const r = this.run;
    this.particles.burst(tmpV.set(r.x, r.y + 1, -r.d), 0xff7a1f, 26, 9, 1.1, 0.8, 6);
    this.particles.burst(tmpV.set(r.x, r.y + 1, -r.d), 0xffd34d, 14, 6, 0.8, 0.6, 3);
    this.shake = 0.7;
    Audio.play('explode');
    this.hooks.vibrate(120);
  }

  // ---------------- tutorial ----------------
  // First-run tutorial: the hint shows early, time slows right before the obstacle until the
  // player performs the requested move. Tutorial obstacles never end the run.
  _tutorial(r) {
    const tut = this.track.tutorial;
    if (!tut || !tut.length) { if (this.timeScale !== 1) this.timeScale = 1; return; }
    const item = tut[0];
    const ahead = item.d - r.d;
    let ok = r.flying;
    if (item.kind === 'jump') ok = ok || (!r.grounded && r.y > 0.2);
    if (item.kind === 'slide') ok = ok || r.slideT > 0;
    if (item.kind === 'lane') ok = ok || r.targetLane === 2;
    const gate = Math.max(3.5, r.speed * 0.36 + 1.2);
    if (!item.done) {
      if ((ok && ahead < gate + 2) || ahead <= 0) {
        item.done = true;
        this.timeScale = 1;
        this.hooks.event('tutorial', { kind: null });
      } else if (ahead < 16) {
        this.hooks.event('tutorial', { kind: item.kind });
        this.timeScale = ahead < gate ? 0.1 : 1;
      }
    }
    if (ahead < -3) {
      tut.shift();
      this.timeScale = 1;
      this.hooks.event('tutorial', { kind: null });
      if (!tut.length) this.hooks.event('tutorialDone', {});
    }
  }

  // ---------------- collisions ----------------
  _bodyHeight(r) {
    const inWaterBody = r.zone === 'water' && !r.vehicle && !r.flying;
    return r.underwater ? PHYS.diveHeight : r.vehicle ? 1.5 : inWaterBody ? PHYS.swimHeight : r.slideT > 0 ? PHYS.slideHeight : PHYS.standHeight;
  }

  _collide(r, prevX) {
    const T = this.track;
    const wide = r.vehicle && r.vehicle.wide;
    const hw = wide ? 3.7 : PHYS.playerHalfWidth;
    const h = this._bodyHeight(r);
    const pad = 0.3;
    for (const o of [...T.obstacles]) {
      if (o.pulled) continue;
      if (o.d0 - r.d > 2 || r.d - o.d1 > 2) continue;
      if (Math.abs(r.x - o.x) >= o.hw + hw) continue;
      if (!(r.d + pad > o.d0 && Math.min(r.prevD, r.d) - pad < o.d1)) continue;
      if (r.y >= o.y1 - 0.3) continue; // above / standing on top
      if (r.y + h <= o.y0) continue;   // passing under
      if (r.invuln > 0) continue;
      if (r.vehicle) { this._vehicleHit(r, o); if (r.state === 'crashed') return; continue; }
      // Moving sideways into something we were already alongside is a stumble, not a crash.
      const wasAlongside = r.prevD + pad > o.d0 && r.prevD - pad < o.d1;
      const wasOverlapX = Math.abs(prevX - o.x) < o.hw + hw;
      if (wasAlongside && !wasOverlapX && o.family !== 'bomb') { this._stumble(r, o, prevX); continue; }
      this._hit(r, o);
      if (r.state === 'crashed') return;
    }
  }

  _vehicleHit(r, o) {
    const def = VEHICLES[r.vehicle.kind];
    const pos = tmpV.set(o.x, r.y + 0.8, -Math.max(o.d0, r.d));
    if (def.smash.includes(o.family)) {
      // Plough straight through.
      this.particles.burst(pos, 0xffd34d, 12, 8, 0.8, 0.6, 5);
      this.particles.burst(pos, 0xffffff, 8, 6, 0.6, 0.5, 4);
      this.track.removeObstacle(o);
      Audio.play('pop');
      r.gold += 3; r.stats.gold += 3; r.score += 20 * r.mult;
      this.shake = Math.max(this.shake, 0.25);
      this.hooks.vibrate(25);
      return;
    }
    // Too big: the vehicle takes the hit instead of the rider.
    this.track.removeObstacle(o);
    this._dismount('wreck');
    this.hooks.event('toast', { key: 'vehicleLost', kind: 'warn' });
  }

  _collideSky(r) {
    for (const o of [...this.track.sky]) {
      if (o.d0 - r.d > 2 || r.d - o.d1 > 2) continue;
      if (!(r.d + 0.5 > o.d0 && Math.min(r.prevD, r.d) - 0.5 < o.d1)) continue;
      if (o.ring) {
        if (o.used) continue;
        if (Math.abs(r.x - o.x) < o.hw && Math.abs(r.y - o.y) < o.hh) {
          o.used = true;
          r.stats.rings++;
          const v = 15 * (r.pu.double > 0 ? 2 : 1);
          r.gold += v; r.stats.gold += v; r.score += 60 * r.mult;
          Audio.play('ring');
          this.particles.burst(tmpV.set(o.x, o.y, -r.d), 0xffd34d, 12, 6, 0.8, 0.6, 2);
          this.hooks.event('toast', { text: `+${v}`, icon: 'gold', kind: 'gold' });
        }
        continue;
      }
      if (Math.abs(r.x - o.x) < o.hw + 0.8 && Math.abs(r.y - o.y) < o.hh + 0.8 && r.invuln <= 0) {
        this.track.removeSky(o);
        if (r.pu.shield > 0) {
          r.pu.shield = 0; Audio.setMuffle(0); r.invuln = 1.2;
          this.particles.burst(tmpV.set(o.x, o.y, -r.d), 0x39c6ff, 16, 7, 0.8, 0.6);
          Audio.play('shieldBreak');
          this.hooks.event('toast', { key: 'shieldBroken', kind: 'info' });
        } else {
          this._dismount('wreck');
          this.hooks.event('toast', { key: 'vehicleLost', kind: 'warn' });
        }
        return;
      }
    }
  }

  _stumble(r, o, prevX) {
    if (r.stumbleT > 0 && r.invuln <= 0) {
      this._hit(r, o, true);
      return;
    }
    const away = Math.sign(prevX - o.x) || (r.lane < o.lane ? -1 : 1);
    r.targetLane = clamp(o.lane + away, 0, 2);
    r.prevLane = r.targetLane;
    r.stumbleT = 3.5;
    r.invuln = 0.35;
    this.shake = 0.35;
    Audio.play('stumble');
    this.hooks.event('toast', { key: 'stumble', kind: 'warn' });
    this.hooks.vibrate(40);
  }

  _hit(r, o, force = false) {
    if (o.tutorial) {
      this.track.removeObstacle(o);
      this.shake = 0.3;
      Audio.play('stumble');
      return;
    }
    if (r.pu.shield > 0 && !force) {
      r.pu.shield = 0;
      Audio.setMuffle(0);
      r.invuln = 1.2;
      this.particles.burst(tmpV.set(o.x, 1.2, -(o.d0 + 0.5)), 0x39c6ff, 16, 7, 0.8, 0.6);
      this.track.removeObstacle(o);
      this.shake = 0.5;
      Audio.play('shieldBreak');
      this.hooks.event('toast', { key: 'shieldBroken', kind: 'info' });
      this.hooks.vibrate(60);
      return;
    }
    if (o.family === 'bomb') {
      this.particles.burst(tmpV.set(o.x, 1, -o.d0), 0xff7a00, 22, 8, 1.2, 0.7);
      Audio.play('explode');
    }
    this._crash(r, o, 'hit');
  }

  _crash(r, o, cause) {
    if (r.state === 'crashed') return;
    r.state = 'crashed';
    r.crashT = 0;
    r.crashNotified = false;
    r.crashCause = cause;
    this.shake = 0.8;
    if (cause === 'fall') { r.vy = -2; Audio.play('splash'); this.particles.splash(tmpV.set(r.x, -0.3, -r.d), 20); }
    else Audio.play('crash');
    Audio.jet(false); Audio.engine(null); Audio.setUnderwater(false);
    this.hooks.vibrate(200);
    this.hooks.event('crash', { cause });
    this.particles.burst(tmpV.set(r.x, r.y + 1, -r.d), 0xffffff, 14, 6, 0.7, 0.5);
    void o;
  }

  // ---------------- pickups ----------------
  _pickups(r, dt) {
    const T = this.track;
    const h = this._bodyHeight(r);
    const magnet = r.pu.magnet > 0;
    const rad = POWERUPS.magnet.radius;
    const value = (r.pu.double > 0 ? 2 : 1) * (this.opts.doubler ? 2 : 1);
    const bonus = 1 + (this.opts.goldBonus || 0);
    const py = r.y + (r.flight ? 0.2 : 0.9);
    for (const g of T.coins) {
      if (g.dead) continue;
      const dz = g.d - r.d;
      if (dz > 14 || dz < -3) continue;
      const canPull = !g.under || r.underwater;
      if (magnet && canPull && !g.magnet && Math.abs(dz) < rad * 1.4 && Math.hypot(g.x - r.x, g.y - py, dz) < rad * 1.3) g.magnet = true;
      if (g.magnet) {
        const k = 1 - Math.exp(-14 * dt);
        g.x = lerp(g.x, r.x, k); g.y = lerp(g.y, py, k); g.d = lerp(g.d, r.d + 0.3, k) + r.speed * dt;
      }
      if (g.under && !r.underwater && !g.magnet) continue;
      const wide = r.vehicle && r.vehicle.wide ? 3.2 : 0.85;
      if (Math.abs(g.x - r.x) < wide && g.d < r.d + 0.95 && g.d > Math.min(r.prevD, r.d) - 0.95 && g.y > r.y - 0.4 && g.y < r.y + h + 0.5 + (r.flight === 'plane' ? 0.8 : 0)) {
        g.dead = true;
        const v = Math.max(1, Math.round(value * bonus));
        r.gold += v;
        r.stats.gold += v;
        r.score += SCORE.perCoin * r.mult * value;
        Audio.play('coin');
        if (Math.random() < 0.5) this.particles.burst(tmpV.set(g.x, g.y, -g.d), g.under ? 0xbfeaff : 0xffd34d, 3, 3, 0.45, 0.35, 2);
      }
    }
    for (const p of [...T.pickups]) {
      const dz = p.d - r.d;
      if (p.vehicle) {
        if (r.vehicle || r.flying) continue;
        if (Math.abs(dz) > p.hl / 2 + 0.8 || Math.abs(p.x - r.x) > p.hw || Math.abs(r.y - p.y) > 3) continue;
        T.removePickup(p);
        this._mount(p.kind);
        continue;
      }
      if (Math.abs(dz) > 1.2) continue;
      if (Math.abs(p.x - r.x) > 1.0 + (r.vehicle && r.vehicle.wide ? 2.4 : 0)) continue;
      const py0 = p.type === 'emp' ? p.y : p.y - 0.6;
      if (py0 > r.y + h + 0.3 || py0 + 1.2 < r.y) continue;
      T.removePickup(p);
      this._collect(r, p);
    }
  }

  _collect(r, p) {
    const pos = tmpV.set(p.x, p.y, -p.d);
    if (p.type === 'gem') {
      r.gems += 1; r.stats.gemsPicked++;
      Audio.play('gem');
      this.particles.burst(pos, 0x38d9ff, 10, 4, 0.6, 0.5);
      this.hooks.event('toast', { text: '+1', icon: 'gems', kind: 'gem' });
      return;
    }
    if (p.type === 'vault') {
      const ok = this.hooks.foundVault();
      Audio.play(ok ? 'reward' : 'error');
      this.particles.burst(pos, 0xcfd8e3, 12, 5, 0.6, 0.6);
      if (ok) r.vaults++;
      this.hooks.event('toast', { key: ok ? 'vaultFound' : 'slotsFull', kind: ok ? 'gold' : 'warn' });
      return;
    }
    if (p.type === 'emp') { this._kickEmp(r); return; }
    // power-up
    r.pu[p.type] = r.puMax[p.type];
    r.stats['pu_' + p.type]++;
    Audio.play('powerup');
    this.particles.burst(pos, POWERUPS[p.type].color, 14, 5, 0.7, 0.6);
    this.hooks.event('powerup', { type: p.type });
    if (p.type === 'shield') Audio.setMuffle(0.6); // the helmet muffles the world a little
    if (p.type === 'jet' && !r.flight && !r.vehicle) this._startFlight('jet');
  }

  // Bomb magnet: small hazards ahead fly into the rider and blow up for coins.
  _bombMagnet(r, dt) {
    if (r.pu.bombmag <= 0) return;
    const rad = POWERUPS.bombmag.radius;
    for (const o of [...this.track.obstacles]) {
      if (o.pulled) {
        const len = o.d1 - o.d0;
        const cx = (o.d0 + o.d1) / 2;
        const k = 1 - Math.exp(-9 * dt);
        o.x = lerp(o.x, r.x, k);
        const nc = lerp(cx, r.d + 0.5, k);
        o.d0 = nc - len / 2; o.d1 = nc + len / 2;
        o.mesh.position.x = o.x; o.mesh.position.z = -nc;
        o.mesh.position.y = lerp(o.mesh.position.y, r.y + 1.0, k);
        o.mesh.rotation.y += dt * 9;
        if (Math.abs(o.x - r.x) < 0.9 && Math.abs(nc - r.d) < 1.2) {
          this.particles.burst(tmpV.set(o.x, r.y + 1, -r.d), 0xff7a1f, 16, 8, 1, 0.6, 4);
          this.particles.burst(tmpV.set(o.x, r.y + 1, -r.d), 0xffd34d, 8, 5, 0.7, 0.5, 2);
          this.track.removeObstacle(o);
          Audio.play('explode');
          r.stats.blasts++;
          const v = 4 * (r.pu.double > 0 ? 2 : 1);
          r.gold += v; r.stats.gold += v; r.score += 25 * r.mult;
          this.shake = Math.max(this.shake, 0.18);
        }
        continue;
      }
      if (!['low', 'cone', 'bomb'].includes(o.family)) continue;
      const dz = o.d0 - r.d;
      if (dz > 0 && dz < rad && !o.tutorial) { o.pulled = true; Audio.play('vacuum'); }
    }
  }

  _kickEmp(r) {
    if (!this.boss || this.boss.state !== 'fight') return;
    r.stats.emps++;
    Audio.play('kick');
    const mesh = makeBomb('emp');
    mesh.position.set(r.x, 0.5, -r.d);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, t: 0, from: new THREE.Vector3(r.x, 0.6, -r.d) });
  }

  // ---------------- villain (Captain Krab) ----------------
  _updateVillain(dt) {
    const th = this.villain;
    if (!th.visible || this.boss) return;
    const r = this.run;
    this.villainT += dt;
    const tt = this.villainT;
    const zoneV = this.track.zoneAt(r.d + 12) === 'water' ? WATER_Y : 0;
    if (tt < 1.2) {
      th.position.set(0, zoneV, -(r.d + 7 + tt * 2));
      th.rotation.y = 0;
      animateVillain(th, 'taunt', 0, this.time);
    } else if (tt < 6.5) {
      th.rotation.y = 0;
      const ahead = 9 + (tt - 1.2) * 3.2;
      th.position.set(Math.sin(tt * 1.3) * 1.6, zoneV, -(r.d + ahead));
      animateVillain(th, 'run', tt * 16, this.time);
    } else if (tt < 8.5) {
      th.position.y += dt * 9;
      th.position.z -= dt * (r.speed + 18);
      animateVillain(th, 'fly', tt * 10, this.time);
      if (!this.villainEscapedMsg) { this.villainEscapedMsg = true; this.hooks.event('villain', { key: 'villainEscape' }); Audio.play('laugh'); }
    } else {
      th.visible = false;
      this.villainEscapedMsg = false;
    }
  }

  // ---------------- boss: the pirate airship ----------------
  _startBoss() {
    const r = this.run;
    this.boss = { state: 'enter', t: 0, hits: 0, ahead: 95, x: 0, lane: 1, laneT: 2.4, throwT: 2.6, throws: 0, tele: null, hitFlash: 0, defeat: 0, fireT: 0 };
    this.track.spawnPaused = true;
    this.track.clearRange(r.d + 25, r.d + 400, true);
    this.track.coins.forEach((g) => { if (g.d > r.d + 25) g.dead = true; });
    this.airship.visible = true;
    this.airship.rotation.set(0, 0, 0);
    this.villain.visible = true; this.villainT = 100;
    this.airship.add(this.villain);
    const deck = this.airship.userData.deck || { x: 0, y: 2, z: 0 };
    this.villain.position.set(deck.x, deck.y, deck.z);
    this.villain.rotation.set(0, 0, 0);
    this.hooks.event('boss', { phase: 'start', hits: 0, max: BOSS.hits });
    this.hooks.event('toast', { key: 'bossIncoming', kind: 'warn', big: true });
    Audio.play('alarm');
    Audio.setMode('boss');
  }

  _updateBoss(dt) {
    const b = this.boss, r = this.run, ship = this.airship;
    b.t += dt;
    const hover = this.track.zoneAt(r.d + b.ahead) === 'water' ? 5.2 : 4.4;
    if (b.state === 'enter') {
      b.ahead = damp(b.ahead, BOSS.gap, 1.4, dt);
      if (b.ahead < BOSS.gap + 1.5) { b.state = 'fight'; b.t = 0; this.hooks.event('toast', { key: 'bossHint', kind: 'info' }); }
    } else if (b.state === 'fight') {
      b.ahead = BOSS.gap + Math.sin(b.t * 0.8) * 2;
      b.laneT -= dt;
      if (b.laneT <= 0) { b.lane = Math.floor(Math.random() * 3); b.laneT = 1.8 + Math.random() * 1.4; }
      b.throwT -= dt;
      if (b.throwT <= 0.7 && !b.tele) {
        const lane = Math.random() < 0.55 ? r.targetLane : Math.floor(Math.random() * 3);
        b.tele = { lane };
      }
      if (b.tele) {
        this.marker.visible = Math.floor(this.time * 10) % 2 === 0;
        this.marker.position.set(LANES[b.tele.lane], this.track.zoneAt(r.d + b.ahead - 6) === 'water' ? WATER_Y + 0.06 : 0.06, -(r.d + b.ahead - 6));
      }
      if (b.throwT <= 0 && b.tele) {
        const d = r.d + b.ahead - 3;
        const lane = b.tele.lane;
        const kind = b.throws % 3 === 2 ? 'emp' : (Math.random() < 0.5 ? 'bomb' : 'low');
        if (kind === 'emp') {
          const p = this.track.addPickup('emp', lane, d, 0);
          p.y = this.track.zoneAt(d) === 'water' ? WATER_Y : 0; p.mesh.position.y = p.y;
        } else if (kind === 'bomb') this.track.addObstacle('bomb', lane, d, { bombKind: 'red', boss: true });
        else this.track.addObstacle('low', lane, d, { boss: true });
        if (kind !== 'emp' && Math.random() < 0.35) {
          const other = (lane + 1 + Math.floor(Math.random() * 2)) % 3;
          this.track.addObstacle('low', other, d + 1, { boss: true });
        }
        b.throws++;
        b.throwT = Math.max(1.05, 1.75 - b.throws * 0.04);
        b.tele = null;
        this.marker.visible = false;
        b.fireT = 0.4;
        Audio.play('cannon');
      }
      if (b.t > BOSS.maxTime) {
        b.state = 'escape'; b.t = 0; this.marker.visible = false;
        this.hooks.event('toast', { key: 'bossEscaped', kind: 'info' });
        this.hooks.event('boss', { phase: 'end' });
      }
    } else if (b.state === 'escape') {
      b.ahead += dt * (8 + b.t * 30);
      if (b.ahead > 160) this._endBoss();
    } else if (b.state === 'defeat') {
      b.defeat = Math.min(1, b.t / 2.2);
      b.ahead += dt * 4;
      if (Math.random() < 0.5) this.particles.burst(tmpV.set(b.x + (Math.random() - 0.5) * 3, hover + Math.random() * 2, -(r.d + b.ahead)), Math.random() < 0.5 ? 0xff7a00 : 0xffd34d, 3, 6, 1.2, 0.6);
      if (b.t > 2.2) this._endBoss();
    }
    if (!this.boss) return;
    b.x = damp(b.x, LANES[b.lane], 2.2, dt);
    const fall = b.state === 'defeat' ? b.defeat * b.defeat * 7 : 0;
    ship.position.set(b.x, hover - fall, -(r.d + b.ahead));
    ship.rotation.y = (LANES[b.lane] - b.x) * 0.05;
    ship.rotation.z = b.state === 'defeat' ? b.defeat * 0.6 : (LANES[b.lane] - b.x) * -0.05;
    if (b.fireT > 0) b.fireT -= dt;
    animateBossAirship(ship, this.time, { firing: b.fireT > 0 ? b.fireT / 0.4 : 0, hit: Math.max(0, b.hitFlash), defeat: b.defeat });
    animateVillain(this.villain, b.state === 'defeat' ? 'fall' : (b.tele ? 'taunt' : 'idle'), 0, this.time);
    if (b.hitFlash > 0) b.hitFlash -= dt;
  }

  _updateProjectiles(dt) {
    const b = this.boss;
    for (const pr of [...this.projectiles]) {
      pr.t += dt / 0.5;
      const target = b ? new THREE.Vector3(b.x, 4.4, -(this.run.d + b.ahead)) : pr.from;
      const u = Math.min(1, pr.t);
      pr.mesh.position.lerpVectors(pr.from, target, u);
      pr.mesh.position.y += Math.sin(u * Math.PI) * 3;
      pr.from.z -= this.run.speed * dt;
      pr.mesh.rotation.x += dt * 12;
      if (u >= 1) {
        this.scene.remove(pr.mesh);
        this.projectiles.splice(this.projectiles.indexOf(pr), 1);
        if (b && b.state === 'fight') {
          b.hits++;
          b.hitFlash = 0.4;
          this.shake = 0.4;
          Audio.play('explode');
          this.particles.burst(target, 0x2fa8ff, 20, 8, 1.1, 0.7);
          this.hooks.event('boss', { phase: 'hit', hits: b.hits, max: BOSS.hits });
          this.hooks.vibrate(50);
          if (b.hits >= BOSS.hits) this._defeatBoss();
        }
      }
    }
  }

  _defeatBoss() {
    const b = this.boss, r = this.run;
    b.state = 'defeat'; b.t = 0;
    this.marker.visible = false;
    r.stats.bosses++;
    r.gold += BOSS.rewardGold;
    r.gems += BOSS.rewardGems;
    r.score += 1000 * r.mult;
    this.track.clearRange(r.d, r.d + 200, true);
    Audio.play('fanfare');
    this.hooks.event('boss', { phase: 'defeat', gold: BOSS.rewardGold, gems: BOSS.rewardGems });
    this.hooks.event('toast', { key: 'bossDefeated', kind: 'gold', big: true });
  }

  _endBoss() {
    const r = this.run;
    this.airship.remove(this.villain);
    this.scene.add(this.villain);
    this.villain.visible = false;
    this.airship.visible = false;
    this.marker.visible = false;
    this.boss = null;
    this.track.spawnPaused = false;
    this.track.nextD = Math.max(this.track.nextD, r.d + 45);
    r.bossNext = this.stage ? 1e9 : r.d + BOSS.every;
    this.hooks.event('boss', { phase: 'end' });
    Audio.setMode(r.flight === 'plane' ? 'plane' : 'run');
  }

  // ---------------- stages ----------------
  _goalProgress(r) {
    const g = this.stage.goal;
    switch (g.type) {
      case 'dist': return r.d;
      case 'coins': return r.stats.gold;
      case 'vehicle': return r.stats.vehicles;
      case 'swim': return r.stats.swim;
      case 'boss': return r.stats.bosses;
      default: return 0;
    }
  }
  _checkStageGoal(r) {
    if (!this.stage || r.state === 'won') return;
    const g = this.stage.goal;
    if (!r.goalDone && this._goalProgress(r) >= g.n) {
      r.goalDone = true;
      if (g.type === 'dist') r.finishAt = g.n;
      else { r.finishAt = r.d + 70; this.track.addFinish(r.finishAt); }
      this.hooks.event('toast', { key: 'goalDone', kind: 'gold', big: true });
      Audio.play('star');
    }
    if (r.goalDone && r.d >= r.finishAt) {
      r.state = 'won'; r.wonT = 0;
      r.invuln = 99;
      this.timeScale = 1;
      Audio.play('finish');
      this.particles.confetti(tmpV.set(r.x, 3, -r.d - 3), 40);
      this.hooks.vibrate(120);
    }
  }
  _updateWon(dt, realDt) {
    const r = this.run, P = this.player;
    r.wonT += realDt;
    r.speed = damp(r.speed, 0, 2.2, realDt);
    r.d += r.speed * realDt;
    if (r.vehicle) { this._removeVehicleMesh(); r.vehicle = null; Audio.engine(null); }
    if (r.flying) { r.flying = false; r.flight = null; r.landing = false; Audio.jet(false); }
    r.y = damp(r.y, this.track.zoneAt(r.d) === 'water' ? WATER_Y : 0, 6, realDt);
    P.visible = true;
    P.position.set(r.x, r.y, -r.d);
    P.rotation.set(0, Math.min(Math.PI, r.wonT * 3), 0);
    animateCritter(P, 'cheer', 0, this.time, {});
    this.particles.update(realDt);
    if (Math.random() < 0.25) this.particles.confetti(tmpV.set(r.x + (Math.random() - 0.5) * 4, 4, -r.d - 2), 3);
    this.track.update(realDt, r.d, this.time);
    this._updateCamera(realDt, true);
    if (r.wonT > 2.2 && !r.winNotified) { r.winNotified = true; this.hooks.onWin(); }
  }

  // ---------------- posing, effects, camera ----------------
  _poseRider(r, dt, tx) {
    const P = this.player;
    const v = r.vehicle;
    const t = this.time;
    const bank = clamp((tx - r.x) * -0.08, -0.3, 0.3);
    if (v) {
      const vm = v.mesh;
      vm.position.set(r.x, r.flight === 'plane' ? r.y : (r.zone === 'water' ? WATER_Y : r.y), -r.d);
      vm.rotation.set(0, 0, 0);
      if (v.kind === 'plane') {
        const pitch = clamp((PHYS.planeLevels[r.planeLevel] - r.y) * -0.05, -0.25, 0.25);
        vm.rotation.z = -r.bank; vm.rotation.x = pitch;
        animateVehicle(vm, t, r.speed, { bank: r.bank, pitch });
        animateCritter(P, 'plane', r.phase, t, { bank: r.bank });
      } else {
        vm.rotation.z = bank;
        animateVehicle(vm, t, r.speed, { steer: bank });
        animateCritter(P, 'ride', r.phase, t, { speed: r.speed });
      }
      const seat = vm.userData.seat || { x: 0, y: 0.6, z: 0 };
      P.position.set(seat.x, seat.y, seat.z);
      P.rotation.set(0, 0, 0);
      P.visible = true;
      P.userData.shadow.visible = false;
      this.shieldBubble.visible = r.pu.shield > 0;
      return;
    }
    const inWaterBody = r.zone === 'water' && !r.flying;
    P.position.set(r.x, r.y, -r.d);
    P.rotation.set(0, 0, bank);
    let mode = 'run';
    const extra = { speed: r.speed, vy: r.vy, bank: 0, flip: 0 };
    if (r.flying) mode = 'fly';
    else if (r.underwater) mode = 'dive';
    else if (r.slideT > 0) mode = 'slide';
    else if (!r.grounded) { mode = 'jump'; extra.flip = r.flip ? clamp(r.airT / 0.69, 0, 1) : 0; }
    else if (inWaterBody) mode = 'swim';
    animateCritter(P, mode, r.phase, t, extra);
    P.userData.jet.visible = r.flight === 'jet';
    P.userData.shadow.position.y = r.grounded ? 0.02 : this.track.floorAt(r.x, r.d, r.y, 0.3, false) - r.y + 0.02;
    P.userData.shadow.visible = !r.flying && !inWaterBody && r.y > -1;
    P.visible = r.invuln > 0 && r.invuln < 50 && !r.flying ? Math.floor(this.time * 14) % 2 === 0 : true;
    this.shieldBubble.visible = r.pu.shield > 0;
  }

  _updateEffects(r, dt) {
    const P = this.player;
    this.magnetRing.visible = r.pu.magnet > 0;
    this.magnetRing.rotation.z += dt * 5;
    this.magnetRing.scale.setScalar(1 + Math.sin(this.time * 8) * 0.15);
    this.bombRing.visible = r.pu.bombmag > 0;
    this.bombRing.rotation.z -= dt * 6;
    this.bombRing.scale.setScalar(1 + Math.sin(this.time * 6) * 0.12);
    this.shieldBubble.scale.setScalar(1 + Math.sin(this.time * 6) * 0.04);
    if (r.pu.double > 0 && Math.random() < 0.3) this.particles.burst(tmpV.set(r.x, r.y + 1.2, -r.d), 0xb388ff, 1, 1.5, 0.35, 0.4, -1);
    // swimming wake and bubbles
    const swimming = r.zone === 'water' && !r.flying;
    this.wake.visible = swimming && (!!r.vehicle || r.grounded || r.underwater);
    if (this.wake.visible) {
      this.wake.position.set(r.x, WATER_Y + 0.03, -r.d);
      const s = (r.vehicle ? 1.8 : 1) * (1 + 0.25 * Math.sin(this.time * 7));
      this.wake.scale.set(s * (r.vehicle && r.vehicle.wide ? 3.5 : 1), s * 1.6, 1);
      this.wake.material.opacity = r.underwater ? 0.2 : 0.55;
    }
    if (r.underwater && Math.random() < 0.5) this.particles.bubbles(tmpV.set(r.x, r.y + 0.3, -r.d), 1);
    if (swimming && !r.vehicle && !r.underwater && r.grounded && Math.random() < 0.2) this.particles.burst(tmpV.set(r.x, WATER_Y + 0.15, -r.d + 0.5), 0xffffff, 1, 2, 0.4, 0.4, 3);
    if (r.vehicle && r.vehicle.kind === 'car' && Math.random() < 0.3) this.particles.burst(tmpV.set(r.x, 0.2, -r.d + 2), 0xd8d0c0, 1, 2, 0.7, 0.5, -0.5);
    void P;
  }

  _updateAudioState(r) {
    const k = Math.min(1, (this.stage ? this.stage.difficulty : 0) + r.d / 4200);
    Audio.setIntensity(clamp(0.18 + k * 0.62 + (r.vehicle || r.flight ? 0.18 : 0), 0, 1));
  }

  _updateCamera(dt, crashed) {
    const r = this.run;
    const portrait = this.camera.aspect < 0.8;
    const wideVeh = r.vehicle && r.vehicle.wide;
    const plane = r.flight === 'plane';
    const back = (portrait ? 8.6 : 7.4) + (wideVeh ? 4 : 0) + (plane ? 2.2 : 0) + (r.vehicle ? 0.8 : 0);
    const up = (portrait ? 4.9 : 4.0) + (wideVeh ? 1.6 : 0);
    const inWater = r.zone === 'water' && !r.flying && !r.vehicle;
    const flyUp = r.flying ? (plane ? 1.4 : 2.5) : 0;
    const yFollow = plane ? 0.55 : 0.62;
    const want = new THREE.Vector3(r.x * 0.55, up + (inWater ? -0.5 : 0) + Math.max(r.y, -0.2) * yFollow + flyUp, -r.d + back);
    const look = new THREE.Vector3(r.x * 0.4, 1.0 + Math.max(r.y, 0) * 0.7 + (inWater ? -0.3 : 0), -r.d - 10);
    if (crashed) {
      if (r.state === 'won') { want.set(r.x * 0.6 - 2.8, 2.6, -r.d + 7); look.set(r.x, 1.4, -r.d); }
      else { want.set(r.x * 0.6 + 2.5, 4.5 + Math.max(r.y, -0.5), -r.d + 6.5); look.set(r.x, Math.max(r.y, -0.8) + 0.6, -r.d); }
    }
    this.camPos.lerp(want, 1 - Math.exp(-(crashed ? 2 : 9) * dt));
    this.camLook.lerp(look, 1 - Math.exp(-10 * dt));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camLook);
    const fov = (portrait ? 66 : 58) + Math.min(8, (r.speed - PHYS.startSpeed) * 0.35) + (r.rocketTo ? 8 : 0) + (plane ? 4 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = damp(this.camera.fov, fov, 3, dt); this.camera.updateProjectionMatrix(); }
  }

  _updateSnow(dt, r) {
    const pos = this.snow.geometry.attributes.position;
    const a = pos.array;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] -= dt * (2 + (i % 7) * 0.3);
      a[i] += Math.sin(this.time + i) * dt * 0.3;
      if (a[i + 1] < 0 || a[i + 2] > -r.d + 10) { a[i + 1] = 14 + Math.random() * 6; a[i + 2] = -r.d - Math.random() * 60; a[i] = r.x + (Math.random() - 0.5) * 40; }
    }
    pos.needsUpdate = true;
  }
}
