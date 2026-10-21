// Endless track: recycled ground tiles in three kinds (road, flooded road = swimming channel,
// broken bridge = gap), pattern-based obstacle/coin generation per zone, vehicle pickups, sky rows
// for plane flights, platform heights (truck roofs and ramps) and collision queries.
import * as THREE from 'three';
import { LANES, TILE, PHYS, WATER_Y, VEHICLES } from './config.js';
import { makeObstacle, coinGeometry, coinMaterial, makeGem, makePowerup, makeBomb, makeFinishGate } from './models.js';
import { makeGroundTile, makeProps } from './props.js';
import { makeWaterTile } from './backdrop.js';
import { makeWaterObstacle, makeSkyObstacle, makeRing, makeDock, makeWarningSign } from './obstacles.js';
import { makeVehiclePickup } from './vehicles.js';

const TILE_COUNT = 9;
const COIN_MAX = 460;
const VIEW_AHEAD = 175;
const PROP_VARIANTS = 5;

// Collision boxes per obstacle family on land (y values are absolute heights above the road).
const FAMILY = {
  low: { y0: 0, y1: 0.95, len: 0.7, hw: 1.0 },
  cone: { y0: 0, y1: 0.85, len: 0.7, hw: 0.45 },
  high: { y0: 1.15, y1: 2.7, len: 0.5, hw: 1.05 },
  block: { y0: 0, y1: 2.4, len: 3.2, hw: 1.0 },
  mover: { y0: 0, y1: 1.75, len: 3.4, hw: 0.95 },
  truck: { y0: 0, y1: 2.6, len: 12, hw: 1.1 },
  bomb: { y0: 0, y1: 1.0, len: 0.9, hw: 0.55 },
};
const BLOCK_LEN = { van: 3.8, hoverCar: 3.6, hut: 2.2, boulder: 2.8, snowman: 1.8, stall: 1.7 };
// The same families in the swimming channel (absolute heights; the surface is at WATER_Y).
const WFAMILY = {
  low: { kind: 'buoy', y0: -1.0, y1: WATER_Y + 0.9, len: 0.9, hw: 0.95 },
  cone: { kind: 'mine', y0: -1.0, y1: WATER_Y + 0.9, len: 0.8, hw: 0.45 },
  high: { kind: 'driftnet', y0: WATER_Y + 0.3, y1: WATER_Y + 1.8, len: 0.6, hw: 1.1 },
  fin: { kind: 'sharkfin', y0: -2, y1: WATER_Y + 1.1, len: 1.4, hw: 0.7 },
  rock: { kind: 'rock', y0: -2, y1: WATER_Y + 2.4, len: 2.2, hw: 1.1 },
  mover: { kind: 'speedboat', y0: -1.0, y1: WATER_Y + 1.2, len: 3.4, hw: 0.95 },
  bomb: { kind: null, y0: WATER_Y, y1: WATER_Y + 1.0, len: 0.9, hw: 0.55 },
};
// Sky obstacles (plane flights): half sizes used for collision.
const SKY = {
  balloon: { hw: 1.1, hh: 1.4 }, drone: { hw: 1.0, hh: 0.6 }, storm: { hw: 1.5, hh: 1.2 }, kite: { hw: 0.8, hh: 0.9 },
};

function rnd(a, b) { return a + Math.random() * (b - a); }
function ri(n) { return Math.floor(Math.random() * n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function weighted(entries) {
  const tot = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
  let r = Math.random() * tot;
  for (const e of entries) { r -= Math.max(0, e[1]); if (r <= 0) return e[0]; }
  return entries[0][0];
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Track {
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.quality = opts.quality || 'high';
    this.root = new THREE.Group();
    scene.add(this.root);

    // Templates are built once and cloned per tile (clones share geometry and materials).
    this.tpl = {
      road: makeGroundTile(world, TILE, 'road'),
      gap: makeGroundTile(world, TILE, 'gap'),
      water: makeGroundTile(world, TILE, 'water'),
      waterSurface: makeWaterTile(world, TILE),
      dockIn: makeDock(world, 'enter'),
      dockOut: makeDock(world, 'exit'),
      signWater: makeWarningSign('water'),
      signGap: makeWarningSign('gap'),
    };
    this.propTpl = { '-1': [], '1': [] };
    for (const side of [-1, 1]) {
      for (let i = 0; i < PROP_VARIANTS; i++) this.propTpl[side].push(makeProps(world, side, TILE, mulberry(1000 * (side + 2) + i * 77 + 5)));
    }

    this.tiles = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      const t = new THREE.Group();
      const v = {
        road: this.tpl.road.clone(), gap: this.tpl.gap.clone(), water: this.tpl.water.clone(), surface: this.tpl.waterSurface.clone(),
      };
      for (const k of Object.keys(v)) t.add(v[k]);
      const dockIn = this.tpl.dockIn.clone(), dockOut = this.tpl.dockOut.clone();
      dockOut.position.z = -(TILE - 6);
      const signW = [this.tpl.signWater.clone(), this.tpl.signWater.clone()], signG = [this.tpl.signGap.clone(), this.tpl.signGap.clone()];
      [signW[0], signG[0]].forEach((s) => s.position.set(-5.3, 0, -TILE + 8));
      [signW[1], signG[1]].forEach((s) => { s.position.set(5.3, 0, -TILE + 8); });
      for (const o of [dockIn, dockOut, ...signW, ...signG]) t.add(o);
      t.userData = { index: 0, type: 'road', v, dockIn, dockOut, signW, signG, chunks: [null, null] };
      this.root.add(t);
      this.tiles.push(t);
    }

    // Coins are a single instanced mesh.
    this.coinMesh = new THREE.InstancedMesh(coinGeometry(), coinMaterial(), COIN_MAX);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.frustumCulled = false;
    this.root.add(this.coinMesh);
    this.coins = [];
    this.coinFree = [];
    for (let i = 0; i < COIN_MAX; i++) this.coinFree.push(i);
    this.pools = new Map();
    this.obstacles = [];
    this.pickups = [];
    this.sky = [];          // sky obstacles and rings (plane flights)
    this.finish = null;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.reset();
  }

  dispose() {
    this.scene.remove(this.root);
  }

  // opts: { zoneWater:1, zoneGaps:1, safeTiles:6, vehicleEvery:420, vehicleFirst:170 }
  reset(opts = {}) {
    for (const o of this.obstacles) this._release(o.mesh, o.poolKey);
    for (const p of this.pickups) this._release(p.mesh, p.poolKey);
    for (const s of this.sky) this._release(s.mesh, s.poolKey);
    if (this.finish) { this.root.remove(this.finish.mesh); this.finish = null; }
    this.obstacles = []; this.pickups = []; this.sky = [];
    for (const g of this.coins) this.coinFree.push(g.idx);
    this.coins = [];
    this._hideAllCoins();
    this.opts = { zoneWater: 1, zoneGaps: 1, safeTiles: 6, vehicleEvery: 420, vehicleFirst: 170, ...opts };
    this.zonePlan = [];
    this.waterLeft = 0;
    this.roadRun = 0;
    this.tiles.forEach((t, i) => this._assignTile(t, i - 1));
    this.nextD = 34;
    this.nextSkyD = 0;
    this.spawnPaused = false;
    this.nextPowerD = rnd(160, 240);
    this.nextGemD = rnd(500, 800);
    this.nextVaultD = rnd(900, 1500);
    this.nextVehicleD = this.opts.vehicleFirst;
    this.vehiclesMade = 0;
    this.lastRow = null;
    this.tutorial = null;
    this.tutorialQueue = [];
  }

  _hideAllCoins() {
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < COIN_MAX; i++) this.coinMesh.setMatrixAt(i, this._m);
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- zones ----------
  _planTo(i) { while (this.zonePlan.length <= i) this._planNext(); }
  _planNext() {
    const idx = this.zonePlan.length, w = this.world.zones, o = this.opts;
    const push = (t) => { this.zonePlan.push(t); this.roadRun = t === 'road' ? this.roadRun + 1 : 0; };
    if (this.waterLeft > 0) { this.waterLeft--; push('water'); return; }
    if (idx < o.safeTiles || this.roadRun < 3) { push('road'); return; }
    const r = Math.random();
    const pw = Math.min(0.6, w.water * 0.5 * o.zoneWater), pg = Math.min(0.5, w.gaps * 0.5 * o.zoneGaps);
    if (r < pw) { this.waterLeft = 2 + ri(3); push('water'); }
    else if (r < pw + pg) push('gap');
    else push('road');
  }
  tileType(i) {
    if (i < 0) return 'road';
    this._planTo(i);
    return this.zonePlan[i];
  }
  // 'road' | 'water' | 'gap' (a gap tile is mostly road; use inGap for the missing part).
  zoneAt(d) { return this.tileType(Math.floor(d / TILE)); }
  inGap(d) {
    const i = Math.floor(d / TILE);
    if (this.tileType(i) !== 'gap') return false;
    const local = d - i * TILE;
    return local > PHYS.gapStart + 0.3 && local < PHYS.gapStart + PHYS.gapLength - 0.3;
  }
  // True when every point in [d0, d1] lies in the given zone kind.
  zoneFits(zone, d0, d1) {
    for (let d = d0; d <= d1 + TILE; d += TILE) {
      if (this.zoneAt(Math.min(d, d1)) !== zone) return false;
    }
    return this.zoneAt(d1) === zone;
  }
  // Water-zone extents ahead of d: metres of swimming left (0 when not in water).
  waterAhead(d) {
    let n = 0;
    for (let i = Math.floor(d / TILE); this.tileType(i) === 'water' && n < 20; i++) n++;
    return n ? (Math.floor(d / TILE) + n) * TILE - d : 0;
  }

  _assignTile(t, index) {
    const u = t.userData;
    u.index = index;
    t.position.z = -index * TILE;
    const type = this.tileType(index);
    u.type = type;
    u.v.road.visible = type === 'road';
    u.v.gap.visible = type === 'gap';
    u.v.water.visible = u.v.surface.visible = type === 'water';
    u.dockIn.visible = type === 'water' && this.tileType(index - 1) !== 'water';
    u.dockOut.visible = type === 'water' && this.tileType(index + 1) !== 'water';
    const next = this.tileType(index + 1);
    u.signW.forEach((s) => { s.visible = type === 'road' && next === 'water'; });
    u.signG.forEach((s) => { s.visible = type === 'road' && next === 'gap'; });
    // Roadside decoration: a fresh clone of a random variant per side (mirrored along z half the time).
    [-1, 1].forEach((side, k) => {
      if (u.chunks[k]) t.remove(u.chunks[k]);
      const tplList = this.propTpl[side];
      const c = tplList[ri(tplList.length)].clone();
      if (Math.random() < 0.5) { c.scale.z = -1; c.position.z = -TILE; } else { c.scale.z = 1; c.position.z = 0; }
      u.chunks[k] = c;
      t.add(c);
    });
  }

  // ---------- pools ----------
  _get(key, factory) {
    let list = this.pools.get(key);
    if (!list) { list = []; this.pools.set(key, list); }
    const m = list.pop() || factory();
    m.visible = true;
    this.root.add(m);
    return m;
  }
  _release(m, key) {
    if (!m) return;
    m.visible = false;
    this.root.remove(m);
    let list = this.pools.get(key);
    if (!list) { list = []; this.pools.set(key, list); }
    list.push(m);
  }

  // ---------- spawning primitives ----------
  // family: low | cone | high | block | mover | truck | bomb. Obstacles pick their land or water
  // version from the zone at distance d (trucks only exist on land).
  addObstacle(family, lane, d, opts = {}) {
    const w = this.world;
    const zone = opts.zone || this.zoneAt(d);
    const water = zone === 'water' && family !== 'truck';
    let key, f, kind, mesh;
    if (water) {
      let fam = family;
      if (family === 'block') fam = opts.kind === 'rock' || (!opts.kind && Math.random() < 0.4) ? 'rock' : 'fin';
      f = WFAMILY[fam];
      kind = f.kind;
      if (family === 'bomb') {
        key = 'bomb:' + (opts.bombKind || 'red');
        mesh = this._get(key, () => makeBomb(opts.bombKind || 'red'));
      } else {
        key = 'w:' + kind;
        mesh = this._get(key, () => makeWaterObstacle(kind, w));
      }
      mesh.position.set(LANES[lane], WATER_Y, -d);
    } else {
      kind = opts.kind || w.obstacle[family === 'bomb' ? 'low' : family];
      const ramp = !!opts.ramp;
      key = family === 'bomb' ? 'bomb:' + (opts.bombKind || 'red') : kind + (ramp ? ':r' : '') + (opts.len ? ':' + opts.len : '');
      mesh = this._get(key, () => (family === 'bomb' ? makeBomb(opts.bombKind || 'red') : makeObstacle(kind, w, { ramp, len: opts.len })));
      f = FAMILY[family];
      mesh.position.set(LANES[lane], 0, -d);
    }
    const x = LANES[lane];
    let d0, d1;
    if (family === 'truck') {
      const L = opts.len || 12;
      d0 = d; d1 = d + L;
    } else {
      const len = !water && family === 'block' ? (BLOCK_LEN[kind] || f.len) : f.len;
      d0 = d - len / 2; d1 = d + len / 2;
    }
    mesh.rotation.set(0, 0, 0);
    const ramp = !water && !!opts.ramp;
    const o = {
      family, kind, lane, x, d0, d1, y0: f.y0, y1: f.y1, hw: f.hw, mesh, poolKey: key, water,
      ramp, rampLen: ramp ? 4 : 0, mover: opts.mover || 0, active: true, boss: !!opts.boss,
    };
    this.obstacles.push(o);
    return o;
  }

  addCoin(x, d, y, under = false) {
    const idx = this.coinFree.pop();
    if (idx === undefined) return null;
    const g = { idx, x, d, y, magnet: false, under, t: Math.random() * 6 };
    this.coins.push(g);
    return g;
  }
  // Base height of coins for the zone at d (surface coins float about 0.9 above the ground/water).
  coinY(d) { return this.zoneAt(d) === 'water' ? WATER_Y + 0.9 : 0.9; }
  coinLine(lane, d, count, step = 2.1, y) {
    for (let i = 0; i < count; i++) this.addCoin(LANES[lane], d + i * step, y === undefined ? this.coinY(d + i * step) : y);
  }
  coinArc(lane, dCenter, height = 1.9, count = 7, span = 9) {
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1), dd = dCenter - span / 2 + u * span;
      this.addCoin(LANES[lane], dd, this.coinY(dd) + Math.sin(u * Math.PI) * height);
    }
  }
  // Pearls under the surface: only a diver can pick them up.
  pearlLine(lane, d, count, step = 2.1) {
    for (let i = 0; i < count; i++) this.addCoin(LANES[lane], d + i * step, -0.62, true);
  }

  addPickup(type, lane, d, y = 1.1) {
    const key = 'pu:' + type;
    let mesh;
    if (type === 'gem') mesh = this._get(key, () => makeGem());
    else if (type === 'emp') mesh = this._get(key, () => makeBomb('emp'));
    else mesh = this._get(key, () => makePowerup(type));
    const x = typeof lane === 'number' && lane >= 0 && lane <= 2 && Number.isInteger(lane) ? LANES[lane] : lane;
    const base = this.zoneAt(d) === 'water' ? WATER_Y : 0;
    mesh.position.set(x, base + y, -d);
    const p = { type, x, d, y: base + y, mesh, poolKey: key, active: true, t: 0 };
    this.pickups.push(p);
    return p;
  }
  addVehiclePickup(kind, lane, d) {
    const key = 'veh:' + kind;
    const mesh = this._get(key, () => makeVehiclePickup(kind, this.world));
    const base = this.zoneAt(d) === 'water' ? WATER_Y : 0;
    mesh.position.set(LANES[lane], base, -d);
    mesh.rotation.set(0, 0, 0);
    const u = mesh.userData;
    const p = {
      type: 'veh_' + kind, kind, vehicle: true, x: LANES[lane], d, y: base, mesh, poolKey: key, active: true, t: 0,
      hw: (u.hitHalfWidth || 1.2) + (VEHICLES[kind].wide ? 2.4 : 0), hl: u.hitLength || 3.2,
    };
    this.pickups.push(p);
    return p;
  }
  addFinish(d) {
    if (this.finish) this.root.remove(this.finish.mesh);
    const mesh = makeFinishGate();
    mesh.position.set(0, this.zoneAt(d) === 'water' ? WATER_Y : 0, -d);
    this.root.add(mesh);
    this.finish = { d, mesh };
  }

  // ---------- generation ----------
  laneFreeAt(lane, d0, d1) {
    return !this.obstacles.some((o) => o.lane === lane && o.d1 > d0 && o.d0 < d1);
  }

  // Queues the tutorial patterns for a first-time player.
  startTutorial() {
    this.tutorialQueue = ['jump', 'slide', 'lane'];
  }

  // ctx: { flight: null|'jet'|'plane', difficulty }
  spawnRows(playerD, speed, difficulty, ctx = {}) {
    if (ctx.flight) { this._skyRows(playerD, speed, difficulty, ctx.flight); return; }
    while (this.nextD < playerD + VIEW_AHEAD) {
      const d = this.nextD;
      let len = 0;
      if (this.tutorialQueue.length) {
        len = this._tutorialRow(this.tutorialQueue.shift(), d);
      } else if (this.spawnPaused) {
        // During the boss fight only coins are placed on the track.
        if (Math.random() < 0.6) this.coinLine(ri(3), d, 6);
      } else if (this.zoneAt(d) === 'gap') {
        len = this._gapRow(d);
      } else {
        len = this._row(d, speed, difficulty, playerD);
      }
      const gap = Math.max(16, speed * (1.28 - 0.42 * difficulty));
      this.nextD = d + len + gap;
    }
  }

  _tutorialRow(kind, d) {
    const add = (f, l) => { this.addObstacle(f, l, d, { zone: 'road' }).tutorial = true; };
    if (kind === 'jump') { for (let l = 0; l < 3; l++) add('low', l); this.coinArc(1, d); }
    if (kind === 'slide') { for (let l = 0; l < 3; l++) add('high', l); this.coinLine(1, d - 2, 3, 2, 0.5); }
    if (kind === 'lane') { add('block', 0); add('block', 1); this.coinLine(2, d - 6, 7); }
    this.tutorial = this.tutorial || [];
    this.tutorial.push({ kind, d });
    return 6;
  }

  // A broken bridge: coins arc over the gap so the jump is rewarded.
  _gapRow(d) {
    const i = Math.floor(d / TILE);
    const gd = i * TILE + PHYS.gapStart + PHYS.gapLength / 2;
    if (d < gd - 14) {
      const lane = ri(3);
      this.coinLine(lane, d, 2, 2.4);
      for (let l = 0; l < 3; l++) if (l !== lane && Math.random() < 0.5) this.coinArc(l, gd, 2.4, 9, PHYS.gapLength + 6);
      this.coinArc(lane, gd, 2.4, 9, PHYS.gapLength + 6);
      return gd + 12 - d;
    }
    return 4;
  }

  _row(d, speed, k, playerD) {
    const zone = this.zoneAt(d);
    const water = zone === 'water';
    const gy = this.coinY(d);
    const pattern = weighted([
      ['single', 3],
      ['double', 2 + 2 * k],
      ['wallLow', 0.8 + k],
      ['wallHigh', 0.8 + k],
      ['mixed', 0.4 + 1.6 * k],
      ['trucks', water ? 0 : 1.6 + k],
      ['mover', d > 450 ? 0.6 + 1.6 * k : 0],
      ['pearls', water ? 1.4 : 0],
      ['coins', 1.1 - 0.5 * k],
    ]);
    // Keep obstacles away from zone boundaries (docks, shorelines, broken bridges).
    const nearEdge = this.zoneAt(d - 14) !== zone || this.zoneAt(d + 20) !== zone;
    let len = 0;
    const lanes = shuffle([0, 1, 2]);
    const anyFam = () => weighted([['low', 3], ['high', 2.5], ['block', 2 + 2 * k], ['cone', 1]]);
    let freeLane = lanes[2];
    if (nearEdge && pattern !== 'coins' && pattern !== 'pearls') {
      this.coinLine(lanes[0], d - 4, 8);
      this.lastRow = { d, pattern: 'coins' };
      return 8;
    }
    switch (pattern) {
      case 'single': {
        const fam = anyFam();
        this.addObstacle(fam, lanes[0], d);
        if (fam === 'low' || fam === 'cone') this.coinArc(lanes[0], d);
        else if (fam === 'high') { if (water) this.pearlLine(lanes[0], d - 3, 4, 2); else this.coinLine(lanes[0], d - 2, 3, 2, 0.5); }
        this.coinLine(lanes[1], d - 8, 8);
        freeLane = lanes[1];
        break;
      }
      case 'double': {
        const f1 = Math.random() < 0.6 ? 'block' : anyFam();
        const f2 = Math.random() < 0.5 ? 'block' : anyFam();
        this.addObstacle(f1, lanes[0], d);
        this.addObstacle(f2, lanes[1], d);
        this.coinLine(lanes[2], d - 6, 7);
        break;
      }
      case 'wallLow': {
        for (const l of lanes) this.addObstacle(Math.random() < 0.3 ? 'cone' : 'low', l, d);
        this.coinArc(lanes[0], d);
        break;
      }
      case 'wallHigh': {
        for (const l of lanes) this.addObstacle('high', l, d);
        if (water) this.pearlLine(lanes[0], d - 3, 5, 2); else this.coinLine(lanes[0], d - 3, 4, 2, 0.5);
        break;
      }
      case 'mixed': {
        const fams = shuffle(['low', 'high', 'block']);
        lanes.forEach((l, i) => this.addObstacle(fams[i], l, d));
        const lowLane = lanes[fams.indexOf('low')];
        this.coinArc(lowLane, d);
        freeLane = lowLane;
        break;
      }
      case 'trucks': {
        if (!this.zoneFits('road', d - 4, d + 30)) { this.coinLine(lanes[0], d - 4, 8); len = 8; break; }
        const n = weighted([[1, 2], [2, 3], [3, 1.2 + k]]);
        const L = 12;
        const ramps = n === 3 ? [true, false, false] : [Math.random() < 0.65, false];
        shuffle(ramps);
        const offs = [];
        for (let i = 0; i < n; i++) {
          const lane = lanes[i];
          const ramp = ramps[i] || false;
          const off = n === 3 ? 0 : rnd(0, 3);
          offs.push(off);
          const t = this.addObstacle('truck', lane, d + off, { ramp, len: L });
          if (ramp) {
            // Coins follow the ramp up and continue along the roof.
            for (let j = 0; j < 9; j++) {
              const gd = t.d0 - 3.5 + j * 2.2;
              const h = gd <= t.d0 ? t.y1 * Math.max(0, 1 - (t.d0 - gd) / t.rampLen) : t.y1;
              this.addCoin(LANES[lane], gd, h + 0.9);
            }
          }
        }
        if (n < 3) this.coinLine(lanes[2], d, 6);
        // Second truck right behind the first one (convoy): roofs are flush, so they can be crossed.
        if (n <= 2 && Math.random() < 0.3 + 0.3 * k && this.zoneFits('road', d, d + offs[0] + 2 * L + 4)) {
          this.addObstacle('truck', lanes[0], d + offs[0] + L, { ramp: false, len: L });
          len = offs[0] + L * 2;
        } else len = L + 3;
        freeLane = n < 3 ? lanes[2] : lanes[ramps.indexOf(true)];
        break;
      }
      case 'mover': {
        // Make sure the vehicle won't drive into the previous row.
        const lane = lanes.find((l) => this.laneFreeAt(l, d - 32, d + 2));
        if (lane === undefined) { this.coinLine(lanes[0], d, 8); break; }
        this.addObstacle('mover', lane, d, { mover: rnd(7, 10) + 6 * k });
        const others = lanes.filter((l) => l !== lane);
        if (Math.random() < 0.5 + 0.3 * k) this.addObstacle(Math.random() < 0.5 ? 'block' : 'low', others[0], d + 4);
        this.coinLine(others[1], d - 4, 7);
        freeLane = others[1];
        break;
      }
      case 'pearls': {
        // A trail of pearls under the surface that zig-zags across the lanes (dive to collect).
        let lane = ri(3);
        for (let i = 0; i < 12; i++) {
          if (i % 4 === 3) lane = Math.max(0, Math.min(2, lane + (Math.random() < 0.5 ? -1 : 1)));
          this.addCoin(LANES[lane], d + i * 2.1, -0.62, true);
        }
        this.coinLine(ri(3), d, 5, 2.6);
        len = 14;
        break;
      }
      case 'coins':
      default: {
        let lane = ri(3);
        for (let i = 0; i < 14; i++) {
          if (i % 5 === 4) lane = Math.max(0, Math.min(2, lane + (Math.random() < 0.5 ? -1 : 1)));
          this.addCoin(LANES[lane], d + i * 2.1, gy);
        }
        len = 14;
        break;
      }
    }
    this._specials(d, freeLane, zone);
    this.lastRow = { d, pattern };
    return len;
  }

  // Power-ups, gems, vaults and rideable vehicles placed in the free lane a little before the row.
  _specials(d, freeLane, zone) {
    const clear = () => this.laneFreeAt(freeLane, d - 16, d - 6) && this.zoneAt(d - 12) === zone && this.zoneAt(d - 4) === zone;
    if (d >= this.nextVehicleD) {
      const wl = zone === 'water' ? this.waterAhead(d) : 0;
      // The first vehicle of every run is the plane, so it is always easy to get into the sky.
      const kind = this.vehiclesMade === 0 ? 'plane' : weighted(zone === 'water'
        ? [['boat', 3], ['ship', wl > 90 ? 1.6 : 0], ['plane', 3]]
        : [['car', 3], ['plane', 4]]);
      if (clear()) {
        this.vehiclesMade++;
        this.addVehiclePickup(kind, freeLane, d - 11);
        this.nextVehicleD = d + rnd(this.opts.vehicleEvery * 0.8, this.opts.vehicleEvery * 1.3);
      }
    } else if (d >= this.nextPowerD) {
      this.nextPowerD = d + rnd(240, 400);
      const type = weighted([['magnet', 3], ['double', 2.5], ['shield', 2], ['jet', 1.6], ['bombmag', 2]]);
      if (clear()) this.addPickup(type, freeLane, d - 10, 1.2);
    } else if (d >= this.nextGemD) {
      this.nextGemD = d + rnd(550, 900);
      if (clear()) this.addPickup('gem', freeLane, d - 10, 1.1);
    } else if (d >= this.nextVaultD) {
      this.nextVaultD = d + rnd(1100, 1800);
      if (Math.random() < 0.55 && clear()) this.addPickup('vault', freeLane, d - 10, 1.0);
    }
  }

  // ---------- sky (jet pack / plane flights) ----------
  // Plane: rows every ~30 m with obstacles on a 3 x 3 grid (lane x altitude layer) around a guaranteed
  // safe path, a ring on the safe cell and coins between rows. Jet pack: coins only.
  _skyRows(playerD, speed, k, flight) {
    if (this.nextSkyD < playerD + 20) this.nextSkyD = playerD + 20;
    const levels = PHYS.planeLevels;
    while (this.nextSkyD < playerD + 130) {
      const d = this.nextSkyD;
      if (flight === 'jet') {
        const lane = ri(3);
        for (let i = 0; i < 12; i++) this.addCoin(LANES[Math.max(0, Math.min(2, lane + (i % 6 === 5 ? (Math.random() < 0.5 ? -1 : 1) : 0)))], d + i * 2.4, PHYS.jetHeight + 0.6);
        this.nextSkyD = d + 12 * 2.4 + 5;
        continue;
      }
      this.skyPath = this.skyPath || { lane: 1, level: 1 };
      const sp = this.skyPath;
      sp.lane = Math.max(0, Math.min(2, sp.lane + ri(3) - 1));
      sp.level = Math.max(0, Math.min(2, sp.level + (Math.random() < 0.4 ? ri(3) - 1 : 0)));
      const cells = [];
      for (let l = 0; l < 3; l++) for (let v = 0; v < 3; v++) if (!(l === sp.lane && v === sp.level)) cells.push([l, v]);
      shuffle(cells);
      const count = Math.min(cells.length, 2 + Math.floor(k * 3));
      for (let i = 0; i < count; i++) {
        const [l, v] = cells[i];
        const kind = weighted([['balloon', 3], ['drone', 2], ['storm', 1.4 + k], ['kite', 1.5]]);
        this.addSkyObstacle(kind, l, v, d);
      }
      this.addRing(sp.lane, sp.level, d);
      const y = levels[sp.level];
      for (let j = -3; j <= 3; j++) if (j !== 0) this.addCoin(LANES[sp.lane], d + j * 2.0, y);
      this.nextSkyD = d + 30;
    }
  }
  addSkyObstacle(kind, lane, level, d) {
    const key = 'sky:' + kind;
    const mesh = this._get(key, () => makeSkyObstacle(kind));
    const y = PHYS.planeLevels[level];
    mesh.position.set(LANES[lane], y, -d);
    const s = SKY[kind];
    const o = { kind, sky: true, ring: false, x: LANES[lane], y, d0: d - 1, d1: d + 1, hw: s.hw, hh: s.hh, mesh, poolKey: key, t: Math.random() * 6 };
    this.sky.push(o);
    return o;
  }
  addRing(lane, level, d) {
    const key = 'ring';
    const mesh = this._get(key, () => makeRing(0xffd34d));
    const y = PHYS.planeLevels[level];
    mesh.position.set(LANES[lane], y, -d);
    const o = { kind: 'ring', sky: true, ring: true, x: LANES[lane], y, d0: d - 0.6, d1: d + 0.6, hw: 1.5, hh: 1.5, mesh, poolKey: key, used: false, t: 0 };
    this.sky.push(o);
    return o;
  }

  // Removes everything ahead of a landing and restarts ground generation after it.
  endFlight(playerD) {
    for (const s of this.sky) this._release(s.mesh, s.poolKey);
    this.sky = [];
    this.skyPath = null;
    this.clearRange(playerD - 2, playerD + 48);
    this.nextD = Math.max(this.nextD, playerD + 52);
    this.nextSkyD = 0;
  }

  // Removes obstacles in a stretch of track (used on revive, landings and boss arrival).
  clearRange(d0, d1, includeBoss = true) {
    this.obstacles = this.obstacles.filter((o) => {
      if (o.d1 > d0 && o.d0 < d1 && (includeBoss || !o.boss)) { this._release(o.mesh, o.poolKey); return false; }
      return true;
    });
  }
  removeObstacle(o) {
    const i = this.obstacles.indexOf(o);
    if (i >= 0) this.obstacles.splice(i, 1);
    this._release(o.mesh, o.poolKey);
  }
  removePickup(p) {
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
    this._release(p.mesh, p.poolKey);
  }
  removeSky(o) {
    const i = this.sky.indexOf(o);
    if (i >= 0) this.sky.splice(i, 1);
    this._release(o.mesh, o.poolKey);
  }

  // ---------- per-frame ----------
  update(dt, playerD, time) {
    // recycle ground tiles
    for (const t of this.tiles) {
      const idx = t.userData.index;
      if (idx * TILE + TILE < playerD - 18) {
        let maxIdx = -Infinity;
        for (const o of this.tiles) maxIdx = Math.max(maxIdx, o.userData.index);
        this._assignTile(t, maxIdx + 1);
      }
    }
    // moving vehicles drive toward the player once close
    for (const o of this.obstacles) {
      if (o.mover && o.d0 - playerD < 48) {
        const dd = o.mover * dt;
        o.d0 -= dd; o.d1 -= dd;
        o.mesh.position.z = -(o.d0 + o.d1) / 2;
      }
    }
    // despawn behind
    if (this.obstacles.length) {
      this.obstacles = this.obstacles.filter((o) => {
        if (o.d1 < playerD - 14) { this._release(o.mesh, o.poolKey); return false; }
        return true;
      });
    }
    if (this.pickups.length) {
      this.pickups = this.pickups.filter((p) => {
        if (p.d < playerD - 12) { this._release(p.mesh, p.poolKey); return false; }
        return true;
      });
    }
    if (this.sky.length) {
      this.sky = this.sky.filter((o) => {
        if (o.d1 < playerD - 14) { this._release(o.mesh, o.poolKey); return false; }
        return true;
      });
    }
    for (const p of this.pickups) {
      p.t += dt;
      if (p.vehicle) {
        p.mesh.position.y = p.y + Math.sin(p.t * 2.2) * 0.12;
        const u = p.mesh.userData;
        if (u.beacon) u.beacon.rotation.y += dt * 1.6;
        if (u.update) u.update(p.t, dt);
        continue;
      }
      if (p.type === 'emp') {
        if (p.mesh.userData.ring) p.mesh.userData.ring.rotation.z += dt * 4;
        continue;
      }
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.position.y = p.y + Math.sin(p.t * 3) * 0.15;
      const inner = p.mesh.userData.inner;
      if (inner) inner.rotation.y += dt;
    }
    for (const o of this.sky) {
      o.t += dt;
      if (o.ring) { o.mesh.rotation.z += dt * 0.8; o.mesh.scale.setScalar(o.used ? Math.max(0.01, o.mesh.scale.x - dt * 3) : 1); }
      else { o.mesh.position.y = o.y + Math.sin(o.t * 1.7) * 0.25; if (o.mesh.userData.update) o.mesh.userData.update(o.t, dt); }
    }
    // coins: animate and write instance matrices
    const m = this._m, q = this._q, e = this._e, s = this._s, pos = this._p;
    const keep = [];
    for (const g of this.coins) {
      if (g.dead || g.d < playerD - 1.5) { this._freeCoin(g); continue; }
      g.t += dt;
      e.set(0, g.t * 3.2, 0); q.setFromEuler(e);
      s.set(1, 1, 1);
      pos.set(g.x, g.y + Math.sin(g.t * 4) * 0.08, -g.d);
      m.compose(pos, q, s);
      this.coinMesh.setMatrixAt(g.idx, m);
      keep.push(g);
    }
    this.coins = keep;
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  _freeCoin(g) {
    this._m.makeScale(0, 0, 0);
    this.coinMesh.setMatrixAt(g.idx, this._m);
    this.coinFree.push(g.idx);
  }

  // Height of the walkable surface (road, water surface, ramps, roofs) under the player.
  // `bridge`: a vehicle that crosses gaps (the car) ignores them.
  floorAt(x, d, maxTop, halfW, bridge = false) {
    const zone = this.zoneAt(d);
    let floor = 0;
    if (zone === 'water') floor = WATER_Y;
    else if (zone === 'gap' && !bridge && this.inGap(d)) floor = -50;
    for (const o of this.obstacles) {
      if (o.water) continue;
      if (Math.abs(x - o.x) > o.hw + halfW - 0.25) continue;
      if (o.ramp && d > o.d0 - o.rampLen && d <= o.d0) {
        // Ramps are solid wedges: anything over them is pushed onto the surface.
        if (Math.abs(x - o.x) < 0.95) floor = Math.max(floor, o.y1 * (1 - (o.d0 - d) / o.rampLen));
        continue;
      }
      if (o.family === 'high' || o.family === 'bomb') continue;
      if (d >= o.d0 - 0.2 && d <= o.d1 + 0.2 && o.y1 <= maxTop) floor = Math.max(floor, o.y1);
    }
    return floor;
  }
}
