// Versioned player profile persisted in localStorage, mirrored to native storage on Android.

const KEY = 'hopinet.profile';
const VERSION = 1;

export function defaultProfile() {
  return {
    v: VERSION,
    created: Date.now(),
    gold: 300, gems: 15, batteries: 2, headstart: 1,
    char: 'hopi', ownedChars: ['hopi'], skins: { hopi: 'snow' }, ownedSkins: ['hopi:snow'],
    upgrades: { magnet: 0, shield: 0, jet: 0, double: 0, bombmag: 0, vehicle: 0 },
    houses: { harbor: 0 }, world: 'harbor', unlockedWorlds: ['harbor'],
    homeItems: {},              // worldId -> [luxury item ids owned there]
    stages: {},                 // stageId -> stars earned (1..3)
    stage: null,                // stage selected on the map (null = free run)
    vaults: [],                 // [{type:'steel', id, unlockAt|null}]
    woodNext: 0,                // timestamp the free wooden vault becomes available
    wheelNext: 0, giftNext: 0,
    daily: { day: 0, last: '' },
    missions: [], missionTotals: {},
    best: 0, bestDist: 0, records: [],
    stats: { runs: 0, dist: 0, gold: 0, bosses: 0, jumps: 0, slides: 0, swim: 0, wins: 0 },
    iap: { tokens: [], starter: false, doubler: false, clubUntil: 0, clubClaim: '' },
    settings: { lang: null, sound: true, music: true, vibe: true, quality: null, gps: false },
    myPlace: null,              // { lat, lon } saved only on this device when "my location" is used
    tutorialDone: false,
  };
}

function migrate(p) {
  const d = defaultProfile();
  // Shallow-merge every top-level key so new fields get defaults.
  for (const k in d) if (p[k] === undefined) p[k] = d[k];
  for (const k of ['upgrades', 'stats', 'iap', 'settings', 'daily']) p[k] = Object.assign({}, d[k], p[k]);
  p.v = VERSION;
  return p;
}

function nativeBridge() {
  return typeof window !== 'undefined' && window.HopinetNative ? window.HopinetNative : null;
}

function parse(raw) {
  if (!raw) return null;
  try { const p = JSON.parse(raw); return p && typeof p === 'object' ? p : null; } catch (e) { return null; }
}

// Reads both copies (WebView localStorage and the native SharedPreferences mirror) and keeps
// the most recently saved one, so a write that only one of them committed is never lost.
export function loadProfile() {
  let local = null, mirror = null;
  try { local = parse(localStorage.getItem(KEY)); } catch (e) { /* storage blocked */ }
  const n = nativeBridge();
  try { if (n && n.loadData) mirror = parse(n.loadData()); } catch (e) { /* ignore */ }
  const pick = local && mirror ? ((mirror.savedAt || 0) > (local.savedAt || 0) ? mirror : local) : (local || mirror);
  return pick ? migrate(pick) : defaultProfile();
}

let pending = null;
export function saveProfile(p) {
  // Coalesce bursts of saves into one write per frame.
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    writeNow(p);
  }, 50);
}

export function writeNow(p) {
  p.savedAt = Date.now();
  const json = JSON.stringify(p);
  try { localStorage.setItem(KEY, json); } catch (e) { /* ignore */ }
  const n = nativeBridge();
  try { if (n && n.saveData) n.saveData(json); } catch (e) { /* ignore */ }
}

export function wipeProfile() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  const n = nativeBridge();
  try { if (n && n.saveData) n.saveData(''); } catch (e) { /* ignore */ }
}
