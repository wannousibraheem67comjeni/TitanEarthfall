// Versioned player profile persisted in localStorage, mirrored to native storage on Android.

const KEY = 'ebot.goldchase.profile';
const VERSION = 2;

export function defaultProfile() {
  return {
    v: VERSION,
    created: Date.now(),
    gold: 250, gems: 10, batteries: 2, headstart: 1,
    char: 'ebot', ownedChars: ['ebot'], skins: { ebot: 'classic' }, ownedSkins: ['ebot:classic'],
    upgrades: { magnet: 0, shield: 0, jet: 0, double: 0 },
    houses: { city: 0 }, world: 'city', unlockedWorlds: ['city'],
    vaults: [],                 // [{type:'steel', id, unlockAt|null}]
    woodNext: 0,                // timestamp the free wooden vault becomes available
    wheelNext: 0, giftNext: 0,
    daily: { day: 0, last: '' },
    missions: [], missionTotals: {},
    best: 0, bestDist: 0, records: [],
    stats: { runs: 0, dist: 0, gold: 0, bosses: 0, jumps: 0, slides: 0 },
    iap: { tokens: [], starter: false, doubler: false, clubUntil: 0, clubClaim: '' },
    settings: { lang: null, sound: true, music: true, vibe: true, quality: null },
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
  return typeof window !== 'undefined' && window.EbotNative ? window.EbotNative : null;
}

export function loadProfile() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  if (!raw) {
    const n = nativeBridge();
    try { if (n && n.loadData) raw = n.loadData(); } catch (e) { /* ignore */ }
  }
  if (raw) {
    try { return migrate(JSON.parse(raw)); } catch (e) { /* corrupt, fall through */ }
  }
  return defaultProfile();
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
