// Game engine: renderer, lobby scene, run simulation (player physics, collisions, power-ups,
// thief intro, boss fight), camera and effects.
import * as THREE from 'three';
import { LANES, PHYS, POWERUPS, POWERUP_IDS, BOSS, SCORE, HEADSTART_DISTANCE } from './config.js';
import {
  makeRobot, animateRobot, makeThief, makeBossVan, makeSky, makeHouse, setHouseStage, sparkTex,
  Basic, M, makeSceneryChunk, makeBomb,
} from './models.js';
import { Track } from './track.js';
import { Audio } from './audio.js';

const tmpV = new THREE.Vector3();

function lerp(a, b, t) { return a + (b - a) * t; }
function damp(a, b, k, dt) { return lerp(a, b, 1 - Math.exp(-k * dt)); }

class Particles {
  constructor(scene, n = 90) {
    this.items = [];
    this.scene = scene;
    const tex = sparkTex();
    this.mats = new Map();
    this.tex = tex;
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
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.scene = new THREE.Scene();
    this.lobby = new THREE.Scene();
    this.mode = 'lobby';
    this.view = 'home';
    this.time = 0;
    this.paused = false;
    this.timeScale = 1;
    this.shake = 0;
    this.lobbyRot = 0; this.lobbyRotV = 0;
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
    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5), Basic(0xff2020, { opacity: 0.45, blend: true }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    s.add(this.shieldBubble, this.magnetRing, this.marker);
    this.van = makeBossVan(); this.van.visible = false; s.add(this.van);
    this.thief = makeThief(); this.thief.visible = false; s.add(this.thief);
    this.projectiles = [];
  }

  _applyWorldLighting(scene, world, hemi, sun) {
    scene.fog = new THREE.Fog(world.fog, world.fogNear, world.fogFar);
    hemi.color.set(world.hemi[0]); hemi.groundColor.set(world.hemi[1]); hemi.intensity = world.hemi[2];
    sun.color.set(world.sun[0]); sun.intensity = world.sun[1];
  }

  setRunWorld(world) {
    if (this.world === world) return;
    this.world = world;
    if (this.track) this.track.dispose();
    this.track = new Track(this.scene, world);
    if (this.sky) this.scene.remove(this.sky);
    this.sky = makeSky(world);
    this.scene.add(this.sky);
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

  setPlayer(skin) {
    if (this.player) this.scene.remove(this.player);
    this.player = makeRobot(skin, { jet: false });
    this.scene.add(this.player);
    this.player.add(this.shieldBubble);
    this.shieldBubble.position.set(0, 1.1, 0);
    this.player.add(this.magnetRing);
    this.magnetRing.position.set(0, 0.15, 0);
  }

  // Lobby: house of the current world, selected character on a pedestal.
  setLobby(world, stage, skin) {
    const L = this.lobby;
    if (this.lobbyWorld !== world) {
      this.lobbyWorld = world;
      while (L.children.length) L.remove(L.children[0]);
      this.lobbyHemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1);
      this.lobbySun = new THREE.DirectionalLight(0xffffff, 1.3);
      this.lobbySun.position.set(8, 16, 12);
      this.lobbySun.castShadow = this.quality === 'high';
      this.lobbySun.shadow.mapSize.set(1024, 1024);
      const sc = this.lobbySun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12;
      L.add(this.lobbyHemi, this.lobbySun);
      this._applyWorldLighting(L, world, this.lobbyHemi, this.lobbySun);
      L.fog = new THREE.Fog(world.fog, 40, 140);
      L.add(makeSky(world));
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M(world.ground));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.4; ground.receiveShadow = true;
      L.add(ground);
      for (let i = 0; i < 3; i++) {
        for (const side of [-1, 1]) {
          const c = makeSceneryChunk(world, side, 30);
          c.position.set(side * 6, -0.4, -6 - i * 26);
          L.add(c);
        }
      }
      this.house = makeHouse(world);
      L.add(this.house);
      const ped = new THREE.Group();
      ped.position.set(0, 0, 6.4);
      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.35, 0.35, 28), M(0xffffff));
      p1.position.y = 0.17; p1.receiveShadow = true;
      const p2 = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.06, 6, 40), M(0x18b7ff, { emissive: 0x18b7ff, ei: 1 }));
      p2.rotation.x = Math.PI / 2; p2.position.y = 0.34;
      ped.add(p1, p2);
      L.add(ped);
      this.pedestal = ped;
      this.lobbyThief = makeThief();
      this.lobbyThief.position.set(-5.2, 0, 2.5);
      this.lobbyThief.rotation.y = Math.PI * 0.75;
      this.lobbyThief.scale.setScalar(0.85);
      L.add(this.lobbyThief);
      this.lobbyChar = null;
      this.lobbySkin = null;
    }
    setHouseStage(this.house, stage);
    this.lobbyStage = stage;
    if (skin && this.lobbySkin !== skin) {
      this.lobbySkin = skin;
      if (this.lobbyChar) this.pedestal.remove(this.lobbyChar);
      this.lobbyChar = makeRobot(skin);
      this.lobbyChar.position.y = 0.35;
      this.pedestal.add(this.lobbyChar);
      this.waveT = 1.2;
    }
  }
  // Re-creates the lobby character even if the skin object is the same (after selection).
  celebrateLobby() { this.waveT = 1.6; }
  setView(v) { this.view = v; }
  dragLobby(dx) { this.lobbyRotV += dx * 0.012; }
  buildPulse() {
    this.buildFx = 1.2;
  }

  showLobby() {
    this.mode = 'lobby';
    Audio.jet(false);
  }

  // ---------------- run lifecycle ----------------
  startRun(opts) {
    // opts: { world, skin, charId, durations, mult, doubler, scoreBonus, tutorial, headstarts }
    this.setRunWorld(opts.world);
    this.setPlayer(opts.skin);
    this.opts = opts;
    this.track.reset();
    this.particles.clear();
    this.projectiles.forEach((p) => this.scene.remove(p.mesh));
    this.projectiles = [];
    if (opts.tutorial) this.track.startTutorial();
    // Thief intro: a short gold trail behind Glitch in the centre lane.
    this.track.goldLine(1, 10, 10, 2.0);
    this.track.nextD = 46;
    this.run = {
      d: 0, speed: PHYS.startSpeed, x: 0, lane: 1, targetLane: 1, prevLane: 1, y: 0, vy: 0, grounded: true,
      slideT: 0, state: 'intro', introT: 1.4, invuln: 0, stumbleT: 0, score: 0, gold: 0, gems: 0, time: 0,
      mult: opts.mult, pu: { magnet: 0, shield: 0, jet: 0, double: 0 }, puMax: { ...opts.durations },
      jetY: 0, flying: false, rocketTo: 0, revives: 0, bossNext: BOSS.firstAt, nextSkyD: 0, crashT: 0,
      phase: 0, onRoof: false, headstartWindow: opts.headstarts > 0 ? 4.5 : 0, vaults: 0,
      stats: { gold: 0, dist: 0, jumps: 0, slides: 0, pu_magnet: 0, pu_jet: 0, pu_shield: 0, pu_double: 0, bosses: 0, emps: 0, roofs: 0, gemsPicked: 0, lanes: 0 },
    };
    this.boss = null;
    this.van.visible = false;
    this.marker.visible = false;
    this.thief.visible = true;
    this.thief.position.set(0, 0, -7);
    this.thief.rotation.y = Math.PI;
    this.thiefT = 0;
    this.player.position.set(0, 0, 0);
    this.player.rotation.set(0, 0, 0);
    this.mode = 'run';
    this.paused = false;
    this.timeScale = 1;
    this.camera.clearViewOffset();
    this.viewOff = { x: 0, y: 0 };
    this.camPos = new THREE.Vector3(0, 6, 12);
    this.camLook = new THREE.Vector3(0, 1.5, -8);
    this.hooks.event('thief', { key: 'thiefTaunt' });
    Audio.play('laugh');
    if (this.run.headstartWindow) this.hooks.event('headstartOffer', { show: true });
  }

  useHeadstart() {
    const r = this.run;
    if (!r || r.state === 'crashed' || r.rocketTo) return false;
    r.rocketTo = r.d + HEADSTART_DISTANCE;
    r.flying = true;
    r.headstartWindow = 0;
    r.state = 'running';
    this.hooks.event('headstartOffer', { show: false });
    this.hooks.event('toast', { key: 'useHeadstart', kind: 'gold' });
    Audio.play('whoosh');
    Audio.jet(true);
    this.player.userData.jet.visible = true;
    r.nextSkyD = r.d + 12;
    return true;
  }

  pause() { if (this.mode === 'run' && !this.paused) { this.paused = true; Audio.jet(false); } }
  resume() {
    if (this.mode === 'run' && this.paused) {
      this.paused = false;
      this.last = performance.now();
      if (this.run.flying) Audio.jet(true);
    }
  }

  revive() {
    const r = this.run;
    r.revives++;
    r.state = 'running';
    r.invuln = 3;
    r.vy = 0;
    r.y = Math.max(0, this.track.floorAt(r.x, r.d, 3, PHYS.playerHalfWidth));
    r.grounded = true;
    r.stumbleT = 0;
    this.track.clearRange(r.d - 4, r.d + 45);
    this.player.rotation.set(0, 0, 0);
    this.paused = false;
    this.last = performance.now();
    Audio.play('powerup');
  }

  finishRun() {
    const r = this.run;
    r.state = 'over';
    Audio.jet(false);
    r.stats.dist = Math.floor(r.d);
    return { score: Math.floor(r.score), dist: Math.floor(r.d), gold: r.gold, gems: r.gems, stats: r.stats, revives: r.revives, vaults: r.vaults };
  }

  // ---------------- input ----------------
  input(action) {
    const r = this.run;
    if (this.mode !== 'run' || this.paused || !r || r.state === 'crashed' || r.state === 'over') return;
    if (r.state === 'intro') { r.state = 'running'; }
    if (action === 'left' || action === 'right') {
      const dir = action === 'left' ? -1 : 1;
      const nl = Math.max(0, Math.min(2, r.targetLane + dir));
      if (nl !== r.targetLane) {
        r.prevLane = r.targetLane;
        r.targetLane = nl;
        r.stats.lanes++;
        Audio.play('lane');
      }
    } else if (action === 'up') {
      if (r.flying) return;
      if (r.grounded) {
        r.vy = PHYS.jumpVelocity;
        r.grounded = false;
        r.slideT = 0;
        r.stats.jumps++;
        Audio.play('jump');
      }
    } else if (action === 'down') {
      if (r.flying) return;
      if (!r.grounded) r.vy = Math.min(r.vy, PHYS.fastFall);
      r.slideT = PHYS.slideTime;
      r.stats.slides++;
      Audio.play('slide');
    }
  }

  // ---------------- main loop ----------------
  frame(now) {
    requestAnimationFrame(this._frame);
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    this.time += dt;
    if (this.mode === 'run') {
      if (!this.paused) this.updateRun(dt * this.timeScale, dt);
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
    let pos, look;
    if (this.view === 'char') {
      const dist = Math.max(5.5, fit(3.6));
      pos = new THREE.Vector3(0, 2.2, 6.4 + dist); look = new THREE.Vector3(0, 1.25, 6.4);
    } else if (this.view === 'house') {
      const dist = Math.max(12, fit(14));
      pos = new THREE.Vector3(2.5, 6.0, dist); look = new THREE.Vector3(0, 2.2, 0);
    } else {
      const dist = Math.max(9, fit(8.2));
      pos = new THREE.Vector3(0, 3.2, 6.4 + dist * 0.8); look = new THREE.Vector3(0, portrait ? 1.9 : 2.0, 3.2);
    }
    // While a bottom/side sheet covers part of the screen, shift the projection so the
    // focused object is centred in the visible area.
    const sheet = this.view === 'char' || this.view === 'house';
    const W = window.innerWidth, H = window.innerHeight;
    const want = sheet ? (portrait ? { x: 0, y: 0.27 * H } : { x: (document.documentElement.dir === 'rtl' ? -0.24 : 0.24) * W, y: 0 }) : { x: 0, y: portrait ? 0 : 0.16 * H };
    this.viewOff = this.viewOff || { x: 0, y: 0 };
    this.viewOff.x = damp(this.viewOff.x, want.x, 6, dt);
    this.viewOff.y = damp(this.viewOff.y, want.y, 6, dt);
    if (Math.abs(this.viewOff.x) + Math.abs(this.viewOff.y) > 0.5) this.camera.setViewOffset(W, H, this.viewOff.x, this.viewOff.y, W, H);
    else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
    if (!this.lobbyCamPos) { this.lobbyCamPos = pos.clone(); this.lobbyCamLook = look.clone(); }
    this.lobbyCamPos.lerp(pos, 1 - Math.exp(-4 * dt));
    this.lobbyCamLook.lerp(look, 1 - Math.exp(-4 * dt));
    this.camera.position.copy(this.lobbyCamPos);
    this.camera.position.x += Math.sin(t * 0.3) * 0.25;
    this.camera.lookAt(this.lobbyCamLook);
    this.camera.fov = 55; this.camera.updateProjectionMatrix();
    // character spin with inertia, returning to face the camera
    this.lobbyRot += this.lobbyRotV;
    this.lobbyRotV *= Math.pow(0.04, dt);
    if (Math.abs(this.lobbyRotV) < 0.002) this.lobbyRot = damp(this.lobbyRot, 0, 1.5, dt);
    if (this.lobbyChar) {
      this.lobbyChar.rotation.y = Math.PI + this.lobbyRot;
      if (this.waveT > 0) { this.waveT -= dt; animateRobot(this.lobbyChar, 'wave', 0, t); } else animateRobot(this.lobbyChar, 'idle', 0, t);
    }
    if (this.lobbyThief) {
      animateRobot(this.lobbyThief, (t % 7) < 1.2 ? 'wave' : 'idle', 0, t);
      this.lobbyThief.position.x = -5.2 + Math.sin(t * 0.5) * 0.3;
    }
    if (this.buildFx > 0) {
      this.buildFx -= dt;
      this.house.scale.setScalar(1 + Math.sin(this.buildFx * 14) * 0.03 * this.buildFx);
    } else if (this.house) this.house.scale.setScalar(1);
    if (this.house) this.house.traverse((o) => { if (o.userData.flag) o.rotation.y = Math.sin(t * 3) * 0.3; });
  }

  // ---------------- run update ----------------
  updateRun(dt, realDt) {
    const r = this.run;
    const P = this.player;
    r.time += dt;
    this.particles.update(dt);

    if (r.state === 'crashed') {
      r.crashT += realDt;
      animateRobot(P, 'fall', 0, this.time);
      this._updateCamera(realDt, true);
      if (r.crashT > 0.9 && !r.crashNotified) {
        r.crashNotified = true;
        this.hooks.onCrash({ revives: r.revives });
      }
      return;
    }

    if (r.headstartWindow > 0) {
      r.headstartWindow -= realDt;
      if (r.headstartWindow <= 0) this.hooks.event('headstartOffer', { show: false });
    }

    // speed
    const base = PHYS.startSpeed + PHYS.maxSpeedGain * (1 - Math.exp(-r.d / PHYS.speedRamp));
    let target = r.state === 'intro' ? base * 0.75 : base;
    if (r.rocketTo) target = base * 2.3;
    r.speed = damp(r.speed, target, 3, dt);
    const dd = r.speed * dt;
    r.prevD = r.d;
    r.d += dd;
    r.phase += dd * 0.95;
    if (r.state === 'intro') { r.introT -= dt; if (r.introT <= 0) r.state = 'running'; }
    r.score += dd * SCORE.perMetre * r.mult * (1 + (this.opts.scoreBonus || 0));

    // lateral movement
    const tx = LANES[r.targetLane];
    const step = PHYS.laneSpeed * dt;
    const prevX = r.x;
    if (Math.abs(tx - r.x) <= step) r.x = tx; else r.x += Math.sign(tx - r.x) * step;
    if (Math.abs(r.x - tx) < 0.01) r.lane = r.targetLane;

    // power-up timers
    for (const id of POWERUP_IDS) {
      if (r.pu[id] > 0) {
        r.pu[id] -= dt;
        if (r.pu[id] <= 0) {
          r.pu[id] = 0;
          if (id === 'jet' && !r.rocketTo) this._endFlight();
        }
      }
    }
    if (r.rocketTo && r.d >= r.rocketTo) { r.rocketTo = 0; if (r.pu.jet <= 0) this._endFlight(); }
    if (r.invuln > 0) r.invuln -= dt;
    if (r.stumbleT > 0) r.stumbleT -= dt;

    // vertical movement
    const prevY = r.y;
    if (r.flying) {
      r.y = damp(r.y, PHYS.jetHeight, 3, dt);
      r.vy = 0; r.grounded = false;
      if (r.nextSkyD < r.d + 110) r.nextSkyD += this.track.skyGold(r.nextSkyD, PHYS.jetHeight + 0.6) + 5;
    } else {
      if (r.slideT > 0) r.slideT -= dt;
      r.vy -= PHYS.gravity * dt;
      r.y += r.vy * dt;
      const maxTop = r.grounded ? prevY + 0.35 : prevY + 0.05;
      const floor = this.track.floorAt(r.x, r.d, maxTop, PHYS.playerHalfWidth);
      if (r.y <= floor && r.vy > 0.01) {
        r.y = floor; // pushed up by a ramp while still rising
      } else if (r.y <= floor) {
        if (!r.grounded && r.vy < -6) {
          Audio.play('land');
          this.particles.burst(tmpV.set(r.x, floor + 0.1, -r.d), 0xffffff, 5, 3, 0.5, 0.35, 2);
        }
        if (floor > 2 && !r.onRoof) r.stats.roofs++;
        r.y = floor; r.vy = 0; r.grounded = true;
        r.onRoof = floor > 2;
      } else if (r.y > floor + 0.02) {
        r.grounded = false;
      }
      if (r.grounded && floor < 0.01) r.onRoof = false;
    }

    // tutorial slow-motion gates
    this._tutorial(r);

    // collisions
    if (!r.flying) this._collide(r, prevX);
    if (r.state === 'crashed') return;

    this._pickups(r, dt);

    // spawn ahead
    const difficulty = Math.min(1, r.d / 4200);
    this.track.spawnRows(r.d, r.speed, difficulty, { jet: r.flying });
    this.track.update(dt, r.d, this.time);

    // boss
    if (!this.boss && r.d >= r.bossNext && !r.flying) this._startBoss();
    if (this.boss) this._updateBoss(dt);
    this._updateProjectiles(dt);

    // thief intro
    this._updateThief(dt);

    // player transform & animation
    P.position.set(r.x, r.y, -r.d);
    const bank = (tx - r.x) * -0.08;
    P.rotation.set(0, 0, bank);
    let mode = 'run';
    if (r.flying) mode = 'fly';
    else if (r.slideT > 0) mode = 'slide';
    else if (!r.grounded) mode = 'jump';
    animateRobot(P, mode, r.phase, this.time);
    P.userData.jet.visible = r.flying;
    P.userData.shadow.position.y = (r.grounded ? 0.02 : this.track.floorAt(r.x, r.d, r.y, 0.3) - r.y + 0.02);
    P.userData.shadow.visible = !r.flying;
    P.visible = r.invuln > 0 && !r.flying ? Math.floor(this.time * 14) % 2 === 0 : true;
    this.shieldBubble.visible = r.pu.shield > 0;
    this.shieldBubble.scale.setScalar(1 + Math.sin(this.time * 6) * 0.04);
    this.magnetRing.visible = r.pu.magnet > 0;
    this.magnetRing.rotation.z += dt * 5;
    this.magnetRing.scale.setScalar(1 + Math.sin(this.time * 8) * 0.15);
    if (r.pu.double > 0 && Math.random() < 0.3) this.particles.burst(tmpV.set(r.x, r.y + 1.2, -r.d), 0xb388ff, 1, 1.5, 0.35, 0.4, -1);

    // world helpers follow the player
    this.sun.position.set(r.x + 6, 18, -r.d + 10);
    this.sun.target.position.set(r.x, 0, -r.d - 6);
    if (this.sky) this.sky.position.set(0, 0, -r.d);
    if (this.snow) this._updateSnow(dt, r);

    this._updateCamera(realDt, false);

    // mission/hud updates
    r.stats.dist = Math.floor(r.d);
    this.hooks.onTick(r);
  }

  _endFlight() {
    const r = this.run;
    if (!r.flying) return;
    r.flying = false;
    r.vy = -2;
    r.invuln = Math.max(r.invuln, 1.4);
    this.track.clearRange(r.d - 2, r.d + 38);
    this.track.nextD = Math.max(this.track.nextD, r.d + 40);
    Audio.jet(false);
  }

  // First-run tutorial: the hint shows early, time slows right before the obstacle until the
  // player performs the requested move. Tutorial obstacles never end the run.
  _tutorial(r) {
    const tut = this.track.tutorial;
    if (!tut || !tut.length) { if (this.timeScale !== 1) this.timeScale = 1; return; }
    const item = tut[0];
    const ahead = item.d - r.d;
    let ok = false;
    if (item.kind === 'jump') ok = !r.grounded && r.y > 0.2;
    if (item.kind === 'slide') ok = r.slideT > 0;
    if (item.kind === 'lane') ok = r.targetLane === 2;
    const gate = Math.max(3.5, r.speed * 0.36 + 1.2);
    if (!item.done) {
      if (ok && ahead < gate + 2) { item.done = true; this.timeScale = 1; this.hooks.event('tutorial', { kind: null }); }
      else if (ahead < 16 && ahead > -1) {
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

  _collide(r, prevX) {
    const T = this.track;
    const hw = PHYS.playerHalfWidth;
    const h = r.slideT > 0 ? PHYS.slideHeight : PHYS.standHeight;
    const pad = 0.3;
    for (const o of T.obstacles) {
      if (o.d0 - r.d > 2 || r.d - o.d1 > 2) continue;
      if (Math.abs(r.x - o.x) >= o.hw + hw) continue;
      if (!(r.d + pad > o.d0 && r.d - pad < o.d1)) continue;
      if (r.y >= o.y1 - 0.3) continue; // above / standing on top
      if (r.y + h <= o.y0) continue;   // passing under
      if (r.invuln > 0) continue;
      // Moving sideways into something we were already alongside is a stumble, not a crash.
      const wasAlongside = r.prevD + pad > o.d0 && r.prevD - pad < o.d1;
      const wasOverlapX = Math.abs(prevX - o.x) < o.hw + hw;
      if (wasAlongside && !wasOverlapX && o.family !== 'bomb') {
        this._stumble(r, o);
        continue;
      }
      this._hit(r, o);
      if (r.state === 'crashed') return;
    }
  }

  _stumble(r, o) {
    if (r.stumbleT > 0 && r.invuln <= 0) {
      this._hit(r, o, true);
      return;
    }
    r.targetLane = r.prevLane !== r.targetLane ? r.prevLane : r.lane;
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
    r.state = 'crashed';
    r.crashT = 0;
    r.crashNotified = false;
    this.shake = 0.8;
    Audio.play('crash');
    Audio.jet(false);
    this.hooks.vibrate(200);
    this.hooks.event('crash', {});
    this.particles.burst(tmpV.set(r.x, r.y + 1, -r.d), 0xffffff, 14, 6, 0.7, 0.5);
  }

  _pickups(r, dt) {
    const T = this.track;
    const h = r.slideT > 0 ? PHYS.slideHeight : PHYS.standHeight;
    const magnet = r.pu.magnet > 0;
    const rad = POWERUPS.magnet.radius;
    const value = (r.pu.double > 0 ? 2 : 1) * (this.opts.doubler ? 2 : 1);
    const py = r.y + 0.9;
    for (const g of T.gold) {
      if (g.dead) continue;
      const dz = g.d - r.d;
      if (dz > 14 || dz < -3) continue;
      if (magnet && !g.magnet && Math.abs(dz) < rad * 1.4 && Math.hypot(g.x - r.x, g.y - py, dz) < rad * 1.3) g.magnet = true;
      if (g.magnet) {
        const k = 1 - Math.exp(-14 * dt);
        g.x = lerp(g.x, r.x, k); g.y = lerp(g.y, py, k); g.d = lerp(g.d, r.d + 0.3, k) + r.speed * dt;
      }
      if (Math.abs(g.x - r.x) < 0.85 && Math.abs(dz) < 0.95 && g.y > r.y - 0.4 && g.y < r.y + h + 0.5) {
        g.dead = true;
        r.gold += value;
        r.stats.gold += value;
        r.score += SCORE.perGold * r.mult * value;
        Audio.play('coin');
        if (Math.random() < 0.5) this.particles.burst(tmpV.set(g.x, g.y, -g.d), 0xffd34d, 3, 3, 0.45, 0.35, 2);
      }
    }
    for (const p of [...T.pickups]) {
      const dz = p.d - r.d;
      if (Math.abs(dz) > 1.2) continue;
      if (Math.abs(p.x - r.x) > 1.0) continue;
      const py0 = p.type === 'emp' ? 0 : p.y - 0.6;
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
    if (p.type === 'emp') { this._kickEmp(r, p); return; }
    // power-up
    const dur = r.puMax[p.type];
    r.pu[p.type] = dur;
    r.stats['pu_' + p.type]++;
    Audio.play('powerup');
    this.particles.burst(pos, POWERUPS[p.type].color, 14, 5, 0.7, 0.6);
    this.hooks.event('powerup', { type: p.type });
    if (p.type === 'jet' && !r.flying) {
      r.flying = true;
      r.nextSkyD = r.d + 10;
      Audio.jet(true);
    }
  }

  // ---------------- thief ----------------
  _updateThief(dt) {
    const th = this.thief;
    if (!th.visible) return;
    const r = this.run;
    this.thiefT += dt;
    const tt = this.thiefT;
    if (tt < 1.2) {
      th.position.set(0, 0, -(r.d + 7 + tt * 2));
      th.rotation.y = 0;
      animateRobot(th, 'wave', 0, this.time);
      th.rotation.y = Math.PI * (tt < 0.6 ? 1 : 1 - (tt - 0.6) / 0.6);
    } else if (tt < 6.5) {
      th.rotation.y = 0;
      const ahead = 9 + (tt - 1.2) * 3.2;
      th.position.set(Math.sin(tt * 1.3) * 1.6, 0, -(r.d + ahead));
      animateRobot(th, 'run', tt * 16, this.time);
    } else if (tt < 8.5) {
      th.userData.jet.visible = true;
      th.position.y += dt * 9;
      th.position.z -= dt * (r.speed + 18);
      animateRobot(th, 'fly', tt * 10, this.time);
      if (!this.thiefEscapedMsg) { this.thiefEscapedMsg = true; this.hooks.event('thief', { key: 'thiefEscape' }); Audio.play('laugh'); }
    } else {
      th.visible = false;
      th.userData.jet.visible = false;
      this.thiefEscapedMsg = false;
    }
  }

  // ---------------- boss ----------------
  _startBoss() {
    const r = this.run;
    this.boss = { state: 'enter', t: 0, hits: 0, ahead: 95, x: 0, lane: 1, laneT: 2.4, throwT: 2.6, throws: 0, tele: null, hitFlash: 0 };
    this.track.spawnPaused = true;
    this.track.clearRange(r.d + 25, r.d + 400, true);
    this.track.gold.forEach((g) => { if (g.d > r.d + 25) g.dead = true; });
    this.van.visible = true;
    this.van.rotation.set(0, 0, 0);
    this.van.userData.thief.position.set(0, 2.62, 0.6);
    this.hooks.event('boss', { phase: 'start', hits: 0, max: BOSS.hits });
    this.hooks.event('toast', { key: 'bossIncoming', kind: 'warn', big: true });
    Audio.play('alarm');
  }

  _updateBoss(dt) {
    const b = this.boss, r = this.run, van = this.van;
    b.t += dt;
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
        this.marker.position.set(LANES[b.tele.lane], 0.06, -(r.d + b.ahead - 6));
      }
      if (b.throwT <= 0 && b.tele) {
        const d = r.d + b.ahead - 3;
        const lane = b.tele.lane;
        const kind = b.throws % 3 === 2 ? 'emp' : (Math.random() < 0.5 ? 'bomb' : 'low');
        if (kind === 'emp') { const p = this.track.addPickup('emp', lane, d, 0); p.mesh.position.y = 0; }
        else if (kind === 'bomb') this.track.addObstacle('bomb', lane, d, { bombKind: 'red', boss: true });
        else this.track.addObstacle('low', lane, d, { boss: true });
        if (kind !== 'emp' && Math.random() < 0.35) {
          const other = (lane + 1 + Math.floor(Math.random() * 2)) % 3;
          this.track.addObstacle('low', other, d + 1, { boss: true });
        }
        b.throws++;
        b.throwT = Math.max(1.05, 1.75 - b.throws * 0.04);
        b.tele = null;
        this.marker.visible = false;
        Audio.play('drop');
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
      b.ahead += dt * 4;
      van.rotation.z = Math.min(0.5, b.t * 0.6);
      const th = van.userData.thief;
      th.position.y += dt * 8; th.position.z += dt * 3;
      animateRobot(th, 'fall', 0, this.time);
      if (Math.random() < 0.5) this.particles.burst(tmpV.set(b.x + (Math.random() - 0.5) * 2, 2 + Math.random() * 2, -(r.d + b.ahead)), Math.random() < 0.5 ? 0xff7a00 : 0xffd34d, 3, 6, 1.2, 0.6);
      if (b.t > 2.2) this._endBoss();
    }
    b.x = damp(b.x, LANES[b.lane], 2.2, dt);
    van.position.set(b.x, 0, -(r.d + b.ahead));
    van.rotation.y = (LANES[b.lane] - b.x) * 0.06;
    if (b.state !== 'defeat') animateRobot(van.userData.thief, b.tele ? 'wave' : 'idle', 0, this.time);
    const light = van.userData.light;
    light.visible = Math.floor(this.time * (b.tele ? 12 : 4)) % 2 === 0;
    if (b.hitFlash > 0) { b.hitFlash -= dt; van.scale.setScalar(1 + b.hitFlash * 0.25); } else van.scale.setScalar(1);
  }

  _kickEmp(r, p) {
    if (!this.boss || this.boss.state !== 'fight') return;
    r.stats.emps++;
    Audio.play('kick');
    const mesh = makeBomb('emp');
    mesh.position.set(r.x, 0.5, -r.d);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, t: 0, from: new THREE.Vector3(r.x, 0.6, -r.d) });
  }

  _updateProjectiles(dt) {
    const b = this.boss;
    for (const pr of [...this.projectiles]) {
      pr.t += dt / 0.5;
      const target = b ? new THREE.Vector3(b.x, 1.8, -(this.run.d + b.ahead)) : pr.from;
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
    this.van.visible = false;
    this.marker.visible = false;
    this.boss = null;
    this.track.spawnPaused = false;
    this.track.nextD = Math.max(this.track.nextD, r.d + 45);
    r.bossNext = r.d + BOSS.every;
    this.hooks.event('boss', { phase: 'end' });
  }

  // ---------------- camera & ambience ----------------
  _updateCamera(dt, crashed) {
    const r = this.run;
    const portrait = this.camera.aspect < 0.8;
    const back = portrait ? 8.6 : 7.4;
    const up = portrait ? 4.9 : 4.0;
    const flyUp = r.flying ? 2.5 : 0;
    const want = new THREE.Vector3(r.x * 0.55, up + r.y * 0.62 + flyUp, -r.d + back);
    const look = new THREE.Vector3(r.x * 0.4, 1.0 + r.y * 0.7, -r.d - 10);
    if (crashed) { want.set(r.x * 0.6 + 2.5, 4.5 + r.y, -r.d + 6.5); look.set(r.x, r.y + 0.6, -r.d); }
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
    const fov = (portrait ? 66 : 58) + Math.min(8, (r.speed - PHYS.startSpeed) * 0.35) + (r.rocketTo ? 8 : 0);
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
