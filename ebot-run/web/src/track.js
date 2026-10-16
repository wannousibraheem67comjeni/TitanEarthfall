// Endless track: recycled ground tiles and scenery, pattern-based obstacle/gold generation,
// platform heights (truck roofs and ramps) and collision queries.
import * as THREE from 'three';
import { LANES, LANE_WIDTH } from './config.js';
import { makeGroundTile, makeSceneryChunk, makeObstacle, goldBarGeometry, goldMaterial, makeGem, makePowerup, makeBomb } from './models.js';

const TILE = 30;
const TILE_COUNT = 8;
const GOLD_MAX = 420;
const VIEW_AHEAD = 165;

// Collision sizes per obstacle family.
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

function rnd(a, b) { return a + Math.random() * (b - a); }
function ri(n) { return Math.floor(Math.random() * n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function weighted(entries) {
  const tot = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
  let r = Math.random() * tot;
  for (const e of entries) { r -= Math.max(0, e[1]); if (r <= 0) return e[0]; }
  return entries[0][0];
}

export class Track {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.tiles = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      const t = new THREE.Group();
      t.add(makeGroundTile(world, TILE));
      const left = makeSceneryChunk(world, -1, TILE), right = makeSceneryChunk(world, 1, TILE);
      t.add(left); t.add(right);
      t.userData.sides = [left, right];
      this.root.add(t);
      this.tiles.push(t);
    }
    // Gold bars are a single instanced mesh.
    this.goldMesh = new THREE.InstancedMesh(goldBarGeometry(), goldMaterial(), GOLD_MAX);
    this.goldMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.goldMesh.frustumCulled = false;
    this.goldMesh.castShadow = false;
    this.root.add(this.goldMesh);
    this.gold = [];
    this.goldFree = [];
    for (let i = 0; i < GOLD_MAX; i++) this.goldFree.push(i);
    this.pools = new Map();
    this.obstacles = [];
    this.pickups = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.reset();
  }

  dispose() {
    this.scene.remove(this.root);
  }

  reset() {
    for (const o of this.obstacles) this._release(o.mesh, o.poolKey);
    for (const p of this.pickups) this._release(p.mesh, p.poolKey);
    this.obstacles = []; this.pickups = [];
    for (const g of this.gold) this.goldFree.push(g.idx);
    this.gold = [];
    this._hideAllGold();
    this.tiles.forEach((t, i) => { t.position.z = -(i - 1) * TILE; });
    this.nextD = 34;
    this.spawnPaused = false;
    this.nextPowerD = rnd(160, 240);
    this.nextGemD = rnd(500, 800);
    this.nextVaultD = rnd(900, 1500);
    this.lastRow = null;
    this.tutorial = null;
    this.tutorialQueue = [];
  }

  _hideAllGold() {
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < GOLD_MAX; i++) this.goldMesh.setMatrixAt(i, this._m);
    this.goldMesh.instanceMatrix.needsUpdate = true;
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
  addObstacle(family, lane, d, opts = {}) {
    const w = this.world;
    const kind = opts.kind || w.obstacle[family === 'bomb' ? 'low' : family];
    const ramp = !!opts.ramp;
    const key = family === 'bomb' ? 'bomb:' + (opts.bombKind || 'red') : kind + (ramp ? ':r' : '') + (opts.len ? ':' + opts.len : '');
    const mesh = this._get(key, () => (family === 'bomb' ? makeBomb(opts.bombKind || 'red') : makeObstacle(kind, w, { ramp, len: opts.len })));
    const f = FAMILY[family];
    const x = LANES[lane];
    let d0, d1;
    if (family === 'truck') {
      const L = opts.len || 12;
      d0 = d; d1 = d + L;
      mesh.position.set(x, 0, -d);
    } else {
      const len = family === 'block' ? (BLOCK_LEN[kind] || f.len) : f.len;
      d0 = d - len / 2; d1 = d + len / 2;
      mesh.position.set(x, 0, -d);
    }
    mesh.rotation.set(0, 0, 0);
    const o = {
      family, kind, lane, x, d0, d1, y0: f.y0, y1: f.y1, hw: f.hw, mesh, poolKey: key,
      ramp, rampLen: ramp ? 4 : 0, mover: opts.mover || 0, active: true, boss: !!opts.boss,
    };
    this.obstacles.push(o);
    return o;
  }

  addGold(x, d, y = 0.9) {
    const idx = this.goldFree.pop();
    if (idx === undefined) return null;
    const g = { idx, x, d, y, magnet: false, t: Math.random() * 6 };
    this.gold.push(g);
    return g;
  }
  goldLine(lane, d, count, step = 2.1, y = 0.9) {
    for (let i = 0; i < count; i++) this.addGold(LANES[lane], d + i * step, y);
  }
  goldArc(lane, dCenter, height = 1.9, count = 7, span = 9) {
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      this.addGold(LANES[lane], dCenter - span / 2 + u * span, 0.9 + Math.sin(u * Math.PI) * height);
    }
  }

  addPickup(type, lane, d, y = 1.1) {
    const key = 'pu:' + type;
    let mesh;
    if (type === 'gem') mesh = this._get(key, () => makeGem());
    else if (type === 'emp') mesh = this._get(key, () => makeBomb('emp'));
    else mesh = this._get(key, () => makePowerup(type));
    const x = typeof lane === 'number' && lane >= 0 && lane <= 2 && Number.isInteger(lane) ? LANES[lane] : lane;
    mesh.position.set(x, y, -d);
    const p = { type, x, d, y, mesh, poolKey: key, active: true, t: 0 };
    this.pickups.push(p);
    return p;
  }

  // ---------- generation ----------
  laneFreeAt(lane, d0, d1) {
    return !this.obstacles.some((o) => o.lane === lane && o.d1 > d0 && o.d0 < d1);
  }

  // Queues the tutorial patterns for a first-time player.
  startTutorial() {
    this.tutorialQueue = ['jump', 'slide', 'lane'];
  }

  spawnRows(playerD, speed, difficulty, ctx) {
    while (this.nextD < playerD + VIEW_AHEAD) {
      const d = this.nextD;
      let len = 0;
      if (this.tutorialQueue.length) {
        len = this._tutorialRow(this.tutorialQueue.shift(), d);
      } else if (this.spawnPaused || ctx.jet) {
        // During the boss or the jet flight only gold is placed on the road.
        if (!ctx.jet) { if (Math.random() < 0.6) this.goldLine(ri(3), d, 6); }
        len = 0;
      } else {
        len = this._row(d, speed, difficulty, playerD);
      }
      const gap = Math.max(16, speed * (1.28 - 0.42 * difficulty));
      this.nextD = d + len + gap;
    }
  }

  _tutorialRow(kind, d) {
    const add = (f, l) => { this.addObstacle(f, l, d).tutorial = true; };
    if (kind === 'jump') { for (let l = 0; l < 3; l++) add('low', l); this.goldArc(1, d); }
    if (kind === 'slide') { for (let l = 0; l < 3; l++) add('high', l); this.goldLine(1, d - 2, 3, 2, 0.5); }
    if (kind === 'lane') { add('block', 0); add('block', 1); this.goldLine(2, d - 6, 7); }
    this.tutorial = this.tutorial || [];
    this.tutorial.push({ kind, d });
    return 6;
  }

  _row(d, speed, k, playerD) {
    const pattern = weighted([
      ['single', 3],
      ['double', 2 + 2 * k],
      ['wallLow', 0.8 + k],
      ['wallHigh', 0.8 + k],
      ['mixed', 0.4 + 1.6 * k],
      ['trucks', 1.6 + k],
      ['mover', d > 500 ? 0.6 + 1.6 * k : 0],
      ['coins', 1.1 - 0.5 * k],
    ]);
    let len = 0;
    const lanes = shuffle([0, 1, 2]);
    const lowOrCone = () => (Math.random() < 0.3 ? 'cone' : 'low');
    const anyFam = () => weighted([['low', 3], ['high', 2.5], ['block', 2 + 2 * k], ['cone', 1]]);
    let freeLane = lanes[2];
    switch (pattern) {
      case 'single': {
        const fam = anyFam();
        this.addObstacle(fam, lanes[0], d);
        if (fam === 'low' || fam === 'cone') this.goldArc(lanes[0], d);
        else if (fam === 'high') this.goldLine(lanes[0], d - 2, 3, 2, 0.5);
        this.goldLine(lanes[1], d - 8, 8);
        freeLane = lanes[1];
        break;
      }
      case 'double': {
        const f1 = Math.random() < 0.6 ? 'block' : anyFam();
        const f2 = Math.random() < 0.5 ? 'block' : anyFam();
        this.addObstacle(f1, lanes[0], d);
        this.addObstacle(f2, lanes[1], d);
        this.goldLine(lanes[2], d - 6, 7);
        break;
      }
      case 'wallLow': {
        for (const l of lanes) this.addObstacle(lowOrCone() === 'cone' && Math.random() < 0.3 ? 'cone' : 'low', l, d);
        this.goldArc(lanes[0], d);
        break;
      }
      case 'wallHigh': {
        for (const l of lanes) this.addObstacle('high', l, d);
        this.goldLine(lanes[0], d - 3, 4, 2, 0.5);
        break;
      }
      case 'mixed': {
        const fams = shuffle(['low', 'high', 'block']);
        lanes.forEach((l, i) => this.addObstacle(fams[i], l, d));
        const lowLane = lanes[fams.indexOf('low')];
        this.goldArc(lowLane, d);
        freeLane = lowLane;
        break;
      }
      case 'trucks': {
        const n = weighted([[1, 2], [2, 3], [3, 1.2 + k]]);
        const L = 12;
        const ramps = n === 3 ? [true, false, false] : [Math.random() < 0.65, false];
        shuffle(ramps);
        for (let i = 0; i < n; i++) {
          const lane = lanes[i];
          const ramp = ramps[i] || false;
          const off = n === 3 ? 0 : rnd(0, 3);
          this.addObstacle('truck', lane, d + off, { ramp, len: L });
          if (ramp) this.goldLine(lane, d + off - 3.5, 7, 2.2, 0.9), this.goldLine(lane, d + off + 3, 4, 2, 2.6 + 0.9);
        }
        if (n < 3) this.goldLine(lanes[2], d, 6);
        // Second truck in a row (convoy) on longer runs.
        if (n <= 2 && Math.random() < 0.3 + 0.3 * k) {
          this.addObstacle('truck', lanes[0], d + L + 1.5, { ramp: false, len: L });
          len = L * 2 + 1.5;
        } else len = L;
        freeLane = n < 3 ? lanes[2] : lanes[ramps.indexOf(true)];
        break;
      }
      case 'mover': {
        // Make sure the vehicle won't drive into the previous row.
        let lane = lanes.find((l) => this.laneFreeAt(l, d - 32, d + 2));
        if (lane === undefined) { this.goldLine(lanes[0], d, 8); break; }
        this.addObstacle('mover', lane, d, { mover: rnd(7, 10) + 6 * k });
        const others = lanes.filter((l) => l !== lane);
        if (Math.random() < 0.5 + 0.3 * k) this.addObstacle(Math.random() < 0.5 ? 'block' : 'low', others[0], d + 4);
        this.goldLine(others[1], d - 4, 7);
        freeLane = others[1];
        break;
      }
      case 'coins':
      default: {
        let lane = ri(3);
        for (let i = 0; i < 14; i++) {
          if (i % 5 === 4) lane = Math.max(0, Math.min(2, lane + (Math.random() < 0.5 ? -1 : 1)));
          this.addGold(LANES[lane], d + i * 2.1, 0.9);
        }
        len = 14;
        break;
      }
    }
    // Specials placed in the free lane a little before the row.
    if (d >= this.nextPowerD) {
      this.nextPowerD = d + rnd(260, 420);
      const type = weighted([['magnet', 3], ['double', 2.5], ['shield', 2], ['jet', 1.8]]);
      if (this.laneFreeAt(freeLane, d - 12, d - 8)) this.addPickup(type, freeLane, d - 10, 1.2);
    } else if (d >= this.nextGemD) {
      this.nextGemD = d + rnd(550, 900);
      if (this.laneFreeAt(freeLane, d - 12, d - 8)) this.addPickup('gem', freeLane, d - 10, 1.1);
    } else if (d >= this.nextVaultD) {
      this.nextVaultD = d + rnd(1100, 1800);
      if (Math.random() < 0.55 && this.laneFreeAt(freeLane, d - 12, d - 8)) this.addPickup('vault', freeLane, d - 10, 1.0);
    }
    this.lastRow = { d, pattern };
    return len;
  }

  // Sky gold path while flying with the jet.
  skyGold(d, y) {
    let lane = ri(3);
    for (let i = 0; i < 12; i++) {
      if (i % 6 === 5) lane = Math.max(0, Math.min(2, lane + (Math.random() < 0.5 ? -1 : 1)));
      this.addGold(LANES[lane], d + i * 2.4, y);
    }
    return 12 * 2.4;
  }

  // Removes obstacles in a stretch of road (used on revive, jet landing and boss arrival).
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

  // ---------- per-frame ----------
  update(dt, playerD, time) {
    // recycle ground tiles
    for (const t of this.tiles) {
      const tileStart = -t.position.z; // distance at tile start
      if (tileStart + TILE < playerD - 18) {
        let maxStart = -Infinity;
        for (const o of this.tiles) maxStart = Math.max(maxStart, -o.position.z);
        t.position.z = -(maxStart + TILE);
        // vary scenery a bit so repetition is less visible
        for (const s of t.userData.sides) {
          s.scale.z = Math.random() < 0.5 ? 1 : -1;
          s.position.z = s.scale.z < 0 ? -TILE : 0;
        }
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
        if (p.d < playerD - 10) { this._release(p.mesh, p.poolKey); return false; }
        return true;
      });
    }
    for (const p of this.pickups) {
      p.t += dt;
      if (p.type === 'emp') {
        if (p.mesh.userData.ring) p.mesh.userData.ring.rotation.z += dt * 4;
        continue;
      }
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.position.y = p.y + Math.sin(p.t * 3) * 0.15;
      const inner = p.mesh.userData.inner;
      if (inner) inner.rotation.y += dt;
    }
    // gold: animate and write instance matrices
    const m = this._m, q = this._q, e = this._e, s = this._s, pos = this._p;
    const keep = [];
    for (const g of this.gold) {
      if (g.dead || g.d < playerD - 1.5) { this._freeGold(g); continue; }
      g.t += dt;
      e.set(0, g.t * 3, 0); q.setFromEuler(e);
      s.set(1, 1, 1);
      pos.set(g.x, g.y + Math.sin(g.t * 4) * 0.08, -g.d);
      m.compose(pos, q, s);
      this.goldMesh.setMatrixAt(g.idx, m);
      keep.push(g);
    }
    this.gold = keep;
    this.goldMesh.instanceMatrix.needsUpdate = true;
  }

  _freeGold(g) {
    this._m.makeScale(0, 0, 0);
    this.goldMesh.setMatrixAt(g.idx, this._m);
    this.goldFree.push(g.idx);
  }

  // Height of the walkable surface (road, ramps, roofs) under the player.
  floorAt(x, d, maxTop, halfW) {
    let floor = 0;
    for (const o of this.obstacles) {
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

  laneWidth() { return LANE_WIDTH; }
}
