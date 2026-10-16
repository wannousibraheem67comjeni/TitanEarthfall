// Economy and meta-progression rules operating on the player profile.
import {
  WORLDS, CHARACTERS, POWERUPS, UPGRADE_COSTS, MAX_UPGRADE, HOUSE_STAGES, houseStageCost,
  VAULTS, MAX_VAULT_SLOTS, WHEEL, FREE_GIFT, DAILY_REWARDS, MISSION_POOL, CLUB_DAILY,
  charById, worldIndex,
} from './config.js';
import { saveProfile } from './save.js';

const HOUR = 3600 * 1000;
let P = null;
const listeners = new Set();

export function initProgress(profile) {
  P = profile;
  ensureMissions();
  if (!P.woodNext) P.woodNext = Date.now(); // first wooden vault is free immediately
}
export function profile() { return P; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function changed() {
  saveProfile(P);
  listeners.forEach((fn) => { try { fn(P); } catch (e) { console.error(e); } });
}
export function replaceProfile(np) { P = np; ensureMissions(); changed(); }

// ---------- currencies ----------
export function canAfford(cost) {
  if (!cost) return true;
  return (P.gold >= (cost.gold || 0)) && (P.gems >= (cost.gems || 0)) && (P.batteries >= (cost.batteries || 0));
}
export function spend(cost) {
  if (!canAfford(cost)) return false;
  P.gold -= cost.gold || 0;
  P.gems -= cost.gems || 0;
  P.batteries -= cost.batteries || 0;
  changed();
  return true;
}
// Adds rewards to the profile and returns the list for display.
export function grant(items, { silent = false } = {}) {
  const out = [];
  for (const it of items || []) {
    const n = Math.max(0, Math.floor(it.n || 0));
    switch (it.k) {
      case 'gold': P.gold += n; break;
      case 'gems': P.gems += n; break;
      case 'batteries': P.batteries += n; break;
      case 'headstart': P.headstart += n; break;
      case 'vault': for (let i = 0; i < n; i++) addVault(it.v || 'steel', true); break;
      default: continue;
    }
    out.push({ k: it.k, n, v: it.v });
  }
  if (!silent) changed();
  return out;
}

// ---------- score multiplier & power-ups ----------
export function totalStagesBuilt() {
  let s = 0;
  for (const w of WORLDS) s += P.houses[w.id] || 0;
  return s;
}
export function multiplier() { return 1 + totalStagesBuilt(); }

export function perkFor(charId, key) { return (charById(charId).perk || {})[key] || 0; }

export function powerupDuration(id, charId = P.char) {
  const def = POWERUPS[id];
  const base = def.base + def.perLevel * (P.upgrades[id] || 0);
  return base * (1 + perkFor(charId, id));
}
export function upgradeCost(id) {
  const lvl = P.upgrades[id] || 0;
  return lvl >= MAX_UPGRADE ? null : UPGRADE_COSTS[lvl];
}
export function upgradePowerup(id) {
  const c = upgradeCost(id);
  if (c == null || !spend({ gold: c })) return false;
  P.upgrades[id] = (P.upgrades[id] || 0) + 1;
  changed();
  return true;
}

// ---------- houses & worlds ----------
export function houseStage(worldId) { return P.houses[worldId] || 0; }
export function houseComplete(worldId) { return houseStage(worldId) >= HOUSE_STAGES.length; }
export function nextStageCost(worldId) {
  const s = houseStage(worldId);
  if (s >= HOUSE_STAGES.length) return null;
  return houseStageCost(worldIndex(worldId), s);
}
export function isWorldUnlocked(id) { return P.unlockedWorlds.includes(id); }

// Builds the next stage of a world's house. Returns details about what got unlocked.
export function buildNextStage(worldId) {
  const cost = nextStageCost(worldId);
  if (!cost || !isWorldUnlocked(worldId) || !spend(cost)) return { ok: false };
  P.houses[worldId] = houseStage(worldId) + 1;
  const res = { ok: true, stage: P.houses[worldId], completed: false };
  if (houseComplete(worldId)) {
    res.completed = true;
    const wi = worldIndex(worldId);
    const w = WORLDS[wi];
    if (w.unlocks && !P.ownedChars.includes(w.unlocks)) {
      P.ownedChars.push(w.unlocks);
      const c = charById(w.unlocks);
      P.skins[c.id] = c.skins[0].id;
      P.ownedSkins.push(c.id + ':' + c.skins[0].id);
      res.unlockedChar = c.id;
    }
    const nw = WORLDS[wi + 1];
    if (nw && !P.unlockedWorlds.includes(nw.id)) {
      P.unlockedWorlds.push(nw.id);
      P.houses[nw.id] = P.houses[nw.id] || 0;
      res.unlockedWorld = nw.id;
    }
    if (!nw) res.rewards = grant([{ k: 'gems', n: 500 }, { k: 'vault', n: 2, v: 'diamond' }], { silent: true });
  }
  changed();
  return res;
}
export function setWorld(id) {
  if (!isWorldUnlocked(id)) return false;
  P.world = id;
  changed();
  return true;
}

// ---------- characters & skins ----------
export function charOwned(id) { return P.ownedChars.includes(id); }
export function unlockCharWithGems(id) {
  const c = charById(id);
  if (charOwned(id) || c.unlock.type !== 'gems') return false;
  if (!spend({ gems: c.unlock.gems })) return false;
  P.ownedChars.push(id);
  P.skins[id] = c.skins[0].id;
  P.ownedSkins.push(id + ':' + c.skins[0].id);
  changed();
  return true;
}
export function selectChar(id) {
  if (!charOwned(id)) return false;
  P.char = id;
  changed();
  return true;
}
export function skinOwned(charId, skinId) {
  const c = charById(charId);
  return c.skins[0].id === skinId || P.ownedSkins.includes(charId + ':' + skinId);
}
export function buySkin(charId, skinId) {
  const s = charById(charId).skins.find((x) => x.id === skinId);
  if (!s || skinOwned(charId, skinId) || !charOwned(charId)) return false;
  if (!spend(s.cost)) return false;
  P.ownedSkins.push(charId + ':' + skinId);
  P.skins[charId] = skinId;
  changed();
  return true;
}
export function equipSkin(charId, skinId) {
  if (!skinOwned(charId, skinId)) return false;
  P.skins[charId] = skinId;
  changed();
  return true;
}
export function currentSkin(charId = P.char) {
  const c = charById(charId);
  return c.skins.find((s) => s.id === P.skins[charId]) || c.skins[0];
}

// ---------- vaults ----------
function rid() { return Math.random().toString(36).slice(2, 10); }
export function addVault(type, silent = false) {
  if (P.vaults.length >= MAX_VAULT_SLOTS) return false;
  P.vaults.push({ id: rid(), type, unlockAt: null });
  if (!silent) changed();
  return true;
}
export function vaultSlotsFree() { return MAX_VAULT_SLOTS - P.vaults.length; }
export function startVaultUnlock(id) {
  const v = P.vaults.find((x) => x.id === id);
  if (!v || v.unlockAt) return false;
  if (P.vaults.some((x) => x.unlockAt && x.unlockAt > Date.now())) return false; // one at a time
  v.unlockAt = Date.now() + VAULTS[v.type].unlockH * HOUR;
  changed();
  return true;
}
export function vaultReady(v) { return v.type !== 'steel' || (v.unlockAt && v.unlockAt <= Date.now()); }
export function vaultInstantCost(v) {
  if (vaultReady(v)) return 0;
  const remain = v.unlockAt ? v.unlockAt - Date.now() : VAULTS.steel.unlockH * HOUR;
  return Math.max(1, Math.ceil(remain / (30 * 60 * 1000)));
}
export function openVault(id, payNow = false) {
  const i = P.vaults.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const v = P.vaults[i];
  if (!vaultReady(v)) {
    if (!payNow || !spend({ batteries: vaultInstantCost(v) })) return null;
  }
  P.vaults.splice(i, 1);
  const items = rollVault(v.type);
  return { type: v.type, items: grant(items) };
}
export function woodReady() { return Date.now() >= P.woodNext; }
export function openWoodVault() {
  if (!woodReady()) return null;
  P.woodNext = Date.now() + VAULTS.wood.freeEveryH * HOUR;
  return { type: 'wood', items: grant(rollVault('wood')) };
}
export function buySteelVault() {
  if (vaultSlotsFree() <= 0 || !spend({ gold: VAULTS.steel.goldPrice })) return false;
  return addVault('steel');
}
export function buyDiamondVault(useGems) {
  const cost = useGems ? { gems: VAULTS.diamond.gemPrice } : { batteries: VAULTS.diamond.batteryPrice };
  if (!spend(cost)) return null;
  return { type: 'diamond', items: grant(rollVault('diamond')) };
}
function pickWeighted(table) {
  const tot = table.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * tot;
  for (const e of table) { r -= e.w; if (r <= 0) return e; }
  return table[table.length - 1];
}
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
export function rollVault(type) {
  const def = VAULTS[type];
  const merged = {};
  for (let i = 0; i < def.rolls; i++) {
    const e = (def.guaranteeGems && i === 0) ? def.table.find((x) => x.k === 'gems') : pickWeighted(def.table);
    merged[e.k] = (merged[e.k] || 0) + randInt(e.min, e.max);
  }
  return Object.keys(merged).map((k) => ({ k, n: merged[k] }));
}
// Percent chance per roll, for drop-rate disclosure in the UI.
export function vaultOdds(type) {
  const t = VAULTS[type].table;
  const tot = t.reduce((a, e) => a + e.w, 0);
  return t.map((e) => ({ k: e.k, min: e.min, max: e.max, pct: (e.w / tot) * 100 }));
}

// ---------- reward wheel ----------
export function wheelFreeReady() { return Date.now() >= P.wheelNext; }
export function spinWheel(paid) {
  if (!paid) {
    if (!wheelFreeReady()) return null;
    P.wheelNext = Date.now() + WHEEL.freeEveryH * HOUR;
  } else if (!spend({ gems: WHEEL.spinGemCost })) return null;
  const idx = WHEEL.segments.indexOf(pickWeighted(WHEEL.segments));
  const seg = WHEEL.segments[idx];
  const items = grant([{ k: seg.k, n: seg.n }]);
  return { index: idx, items };
}
export function wheelOdds() {
  const tot = WHEEL.segments.reduce((a, e) => a + e.w, 0);
  return WHEEL.segments.map((s) => ({ ...s, pct: (s.w / tot) * 100 }));
}

// ---------- free gift ----------
export function giftReady() { return Date.now() >= P.giftNext; }
export function claimGift() {
  if (!giftReady()) return null;
  P.giftNext = Date.now() + FREE_GIFT.everyH * HOUR;
  return grant([{ k: 'gold', n: FREE_GIFT.gold }]);
}

// ---------- daily calendar ----------
function dayKey(d = new Date()) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
export function dailyAvailable() { return P.daily.last !== dayKey(); }
export function dailyIndex() {
  if (!dailyAvailable()) return (P.daily.day + 6) % 7; // index already claimed today
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (P.daily.last && P.daily.last !== dayKey(y)) return 0; // streak broken
  return P.daily.day % 7;
}
export function claimDaily() {
  if (!dailyAvailable()) return null;
  const idx = dailyIndex();
  P.daily.day = (idx + 1) % 7;
  P.daily.last = dayKey();
  return grant(DAILY_REWARDS[idx]);
}

// ---------- missions ----------
function newMission(exclude) {
  const pool = MISSION_POOL.filter((m) => !exclude.includes(m.id));
  const m = pool[Math.floor(Math.random() * pool.length)];
  return { id: m.id, base: P.missionTotals[m.stat] || 0, best: 0, done: false };
}
export function ensureMissions() {
  P.missions = (P.missions || []).filter((m) => MISSION_POOL.some((x) => x.id === m.id));
  while (P.missions.length < 3) P.missions.push(newMission(P.missions.map((m) => m.id)));
}
export function missionDef(id) { return MISSION_POOL.find((m) => m.id === id); }
// Progress of a mission, optionally including the stats of the ongoing run.
export function missionProgress(m, run) {
  const d = missionDef(m.id);
  if (m.done) return d.n;
  const cur = run ? (run[d.stat] || 0) : 0;
  if (d.scope === 'run') return Math.min(d.n, Math.max(m.best, cur));
  return Math.min(d.n, (P.missionTotals[d.stat] || 0) - m.base + cur);
}
// Returns missions that became complete thanks to the ongoing run (for in-run toasts).
export function liveMissionCheck(run) {
  const out = [];
  for (const m of P.missions) {
    if (m.done || m.notified) continue;
    if (missionProgress(m, run) >= missionDef(m.id).n) { m.notified = true; out.push(m); }
  }
  return out;
}
export function commitRunStats(run) {
  for (const m of P.missions) {
    const d = missionDef(m.id);
    if (d.scope === 'run') m.best = Math.max(m.best, run[d.stat] || 0);
  }
  for (const k in run) P.missionTotals[k] = (P.missionTotals[k] || 0) + run[k];
  for (const m of P.missions) {
    if (!m.done && missionProgress(m, null) >= missionDef(m.id).n) m.done = true;
    delete m.notified;
  }
  changed();
}
export function claimMission(i) {
  const m = P.missions[i];
  if (!m || !m.done) return null;
  const items = grant([missionDef(m.id).reward], { silent: true });
  P.missions[i] = newMission(P.missions.map((x) => x.id));
  changed();
  return items;
}
export function missionsClaimable() { return P.missions.filter((m) => m.done).length; }

// ---------- club subscription ----------
export function clubActive() { return P.iap.clubUntil > Date.now(); }
export function clubClaimAvailable() { return clubActive() && P.iap.clubClaim !== dayKey(); }
export function claimClub() {
  if (!clubClaimAvailable()) return null;
  P.iap.clubClaim = dayKey();
  return grant(CLUB_DAILY);
}

// ---------- run results ----------
export function recordRun({ score, dist, gold }) {
  const P_ = P;
  P_.stats.runs++;
  P_.stats.dist += Math.floor(dist);
  P_.stats.gold += gold;
  const isBest = score > P_.best;
  P_.best = Math.max(P_.best, Math.floor(score));
  P_.bestDist = Math.max(P_.bestDist, Math.floor(dist));
  P_.records.push({ score: Math.floor(score), dist: Math.floor(dist), char: P_.char, world: P_.world, at: Date.now() });
  P_.records.sort((a, b) => b.score - a.score);
  P_.records = P_.records.slice(0, 10);
  changed();
  return isBest;
}

// Badge counters for the lobby buttons.
export function badges() {
  return {
    daily: dailyAvailable(),
    missions: missionsClaimable(),
    wheel: wheelFreeReady(),
    gift: giftReady(),
    vaults: woodReady() || P.vaults.some((v) => v.type !== 'steel' || vaultReady(v)) || (P.vaults.some((v) => v.type === 'steel' && !v.unlockAt) && !P.vaults.some((v) => v.unlockAt && v.unlockAt > Date.now())),
    club: clubClaimAvailable(),
    build: !!nextStageCost(P.world) && canAfford(nextStageCost(P.world)),
  };
}
