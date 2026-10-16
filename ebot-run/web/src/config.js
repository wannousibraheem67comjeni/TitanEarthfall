// Static game data: worlds, characters, power-ups, economy tables and store catalogue.
// Every tunable number of the game lives here so balancing never touches gameplay code.

export const GAME_VERSION = '1.0.0';

export const LANE_WIDTH = 2.4;
export const LANES = [-LANE_WIDTH, 0, LANE_WIDTH];

export const PHYS = {
  startSpeed: 13,
  maxSpeedGain: 17,
  speedRamp: 2600,     // metres to reach ~63% of the speed gain
  gravity: 36,
  jumpVelocity: 12.2,
  fastFall: -26,
  slideTime: 0.62,
  laneSpeed: 17,       // m/s lateral speed when switching lanes
  playerHalfWidth: 0.42,
  standHeight: 1.75,
  slideHeight: 0.72,
  jetHeight: 8.5,
};

// Score multiplier comes from built house stages (like the original genre formula).
export const SCORE = { perMetre: 1, perGold: 5 };

export const POWERUPS = {
  magnet: { base: 8, perLevel: 2, color: 0xff3d5a, radius: 7.5 },
  shield: { base: 10, perLevel: 2, color: 0x39c6ff },
  jet:    { base: 5, perLevel: 1, color: 0xffb020 },
  double: { base: 10, perLevel: 2, color: 0x9b5cff },
};
export const POWERUP_IDS = ['magnet', 'shield', 'jet', 'double'];
export const UPGRADE_COSTS = [500, 1200, 2500, 5000, 9000, 15000]; // gold per level
export const MAX_UPGRADE = UPGRADE_COSTS.length;

export const REVIVE_COSTS = [1, 2, 4, 6]; // batteries per revive within the same run
export const REVIVE_GEM_PER_BATTERY = 12;
export const HEADSTART_DISTANCE = 320;

// Six worlds. Completing a world's house unlocks the next world and a new character.
export const WORLDS = [
  {
    id: 'city', unlocks: 'nova', costFactor: 1,
    name: { ar: 'مدينة إيبوت', en: 'Ebot City' },
    desc: { ar: 'شوارع الضواحي المشمسة حيث بدأت السرقة', en: 'Sunny suburbs where the heist began' },
    sky: [0x5fc8ff, 0xd8f3ff], fog: 0xcdeeff, fogNear: 60, fogFar: 175, night: false,
    ground: 0x7ccf5a, road: 0x50555f, line: 0xffffff, side: 0xc9c3b8,
    hemi: [0xffffff, 0x88aa66, 1.05], sun: [0xfff3d6, 1.35],
    palette: [0xff7a59, 0xffc14d, 0x5cc8ff, 0xa0e070, 0xff9ecf, 0xb39dff, 0xffffff],
    obstacle: { low: 'barrier', high: 'gantry', block: 'van', truck: 'truck', cone: 'cone', mover: 'car' },
    props: 'city',
    house: { wall: 0xfff1d6, roof: 0xe9573f, trim: 0x2f80ed, style: 'classic' },
  },
  {
    id: 'neon', unlocks: 'bolt', costFactor: 1.6,
    name: { ar: 'جادة النيون', en: 'Neon Boulevard' },
    desc: { ar: 'ليل المدينة المضيء بالأضواء', en: 'The glowing city at night' },
    sky: [0x120a3a, 0x5a1e7a], fog: 0x2a1250, fogNear: 50, fogFar: 160, night: true,
    ground: 0x1d1838, road: 0x23233a, line: 0x39f3ff, side: 0x3b3566,
    hemi: [0x9c7bff, 0x220a44, 0.85], sun: [0xff8ee8, 0.65],
    palette: [0xff3df2, 0x39f3ff, 0xffe14d, 0x7b61ff, 0x3dff9a],
    obstacle: { low: 'neonBarrier', high: 'holoGate', block: 'hoverCar', truck: 'neonTruck', cone: 'neonCone', mover: 'hoverCar' },
    props: 'neon',
    house: { wall: 0x2b2550, roof: 0x7b61ff, trim: 0xff3df2, style: 'modern' },
  },
  {
    id: 'island', unlocks: 'zaytoon', costFactor: 2.4,
    name: { ar: 'جزيرة النخيل', en: 'Palm Island' },
    desc: { ar: 'شواطئ استوائية وأمواج زرقاء', en: 'Tropical beaches and blue waves' },
    sky: [0x2fb8ff, 0xfff0c2], fog: 0xd9f6ff, fogNear: 60, fogFar: 180, night: false,
    ground: 0xf2d48a, road: 0xd9b26a, line: 0xfff6dc, side: 0xe8c47a, water: 0x1ec8e0,
    hemi: [0xffffff, 0xd9b26a, 1.1], sun: [0xfff0c8, 1.4],
    palette: [0xff6f61, 0x2ec4b6, 0xffbf69, 0xcbf3f0, 0xff9f1c],
    obstacle: { low: 'crate', high: 'bambooBar', block: 'hut', truck: 'iceTruck', cone: 'sandcastle', mover: 'buggy' },
    props: 'island',
    house: { wall: 0xffe2b0, roof: 0xc98b3c, trim: 0x2ec4b6, style: 'beach' },
  },
  {
    id: 'forest', unlocks: 'frosty', costFactor: 3.4,
    name: { ar: 'غابة التروس', en: 'Gear Forest' },
    desc: { ar: 'أشجار عملاقة وتروس قديمة', en: 'Giant trees and ancient gears' },
    sky: [0x8fd6a8, 0xf1ffe0], fog: 0xcfeccf, fogNear: 45, fogFar: 150, night: false,
    ground: 0x4f9a46, road: 0x8a6a45, line: 0xb89464, side: 0x6a8f3e,
    hemi: [0xf4ffe8, 0x3e6b2c, 1.0], sun: [0xfff6d0, 1.2],
    palette: [0x2f7d32, 0x4caf50, 0x8bc34a, 0x6d4c41, 0xcddc39],
    obstacle: { low: 'log', high: 'branch', block: 'boulder', truck: 'logTruck', cone: 'stump', mover: 'cart' },
    props: 'forest',
    house: { wall: 0x9c6b3f, roof: 0x3e7d32, trim: 0xf4b400, style: 'cabin' },
  },
  {
    id: 'snow', unlocks: 'saqr', costFactor: 4.6,
    name: { ar: 'قمة الجليد', en: 'Ice Peak' },
    desc: { ar: 'طرق ثلجية زلقة وجبال بيضاء', en: 'Slippery snowy roads and white mountains' },
    sky: [0x9ad0ff, 0xf4fbff], fog: 0xe8f4ff, fogNear: 45, fogFar: 150, night: false, snow: true,
    ground: 0xf4f8ff, road: 0xc5d6ea, line: 0x7fb2e5, side: 0xe3edf8,
    hemi: [0xffffff, 0xb8cce6, 1.1], sun: [0xffffff, 1.2],
    palette: [0xd84a4a, 0x3b7dd8, 0x2a9d8f, 0xf4a261, 0xffffff],
    obstacle: { low: 'iceBlock', high: 'icicleArch', block: 'snowman', truck: 'plowTruck', cone: 'snowCone', mover: 'sled' },
    props: 'snow',
    house: { wall: 0x8a5a3b, roof: 0xffffff, trim: 0xd84a4a, style: 'chalet' },
  },
  {
    id: 'desert', unlocks: null, costFactor: 6,
    name: { ar: 'واحة الصقر', en: 'Falcon Oasis' },
    desc: { ar: 'كثبان ذهبية وفوانيس وقباب', en: 'Golden dunes, lanterns and domes' },
    sky: [0xffb35c, 0xfff1d0], fog: 0xffe5bf, fogNear: 55, fogFar: 170, night: false,
    ground: 0xf0c27a, road: 0xc9935a, line: 0xfff1d0, side: 0xe0ac6a,
    hemi: [0xfff4e0, 0xc9935a, 1.1], sun: [0xffe0b0, 1.45],
    palette: [0xe9c46a, 0x2a9d8f, 0xe76f51, 0xf4a261, 0xffffff],
    obstacle: { low: 'sandbags', high: 'carpetArch', block: 'stall', truck: 'caravan', cone: 'jar', mover: 'camelCart' },
    props: 'desert',
    house: { wall: 0xf6e3c0, roof: 0xd4a017, trim: 0x2a9d8f, style: 'arabian' },
  },
];

// House build stages. Each stage adds +1 to the score multiplier.
export const HOUSE_STAGES = [
  { gold: 300, gems: 0 },
  { gold: 800, gems: 0 },
  { gold: 1600, gems: 0 },
  { gold: 2800, gems: 10 },
  { gold: 4500, gems: 25 },
];
export const HOUSE_STAGE_NAMES = [
  { ar: 'الأساسات والجدران', en: 'Foundation & walls' },
  { ar: 'السقف', en: 'Roof' },
  { ar: 'الأبواب والنوافذ', en: 'Doors & windows' },
  { ar: 'الحديقة', en: 'Garden' },
  { ar: 'الزينة والأضواء', en: 'Decorations & lights' },
];
export function houseStageCost(worldIndex, stage) {
  const f = WORLDS[worldIndex].costFactor;
  const s = HOUSE_STAGES[stage];
  return { gold: Math.round((s.gold * f) / 50) * 50, gems: Math.round(s.gems * f) };
}

// Characters: perks extend one power-up's duration. Skins recolour the robot.
export const CHARACTERS = [
  {
    id: 'ebot', name: { ar: 'إيبوت', en: 'Ebot' },
    bio: { ar: 'الروبوت البطل الذي سُرق ذهبه', en: 'The hero robot whose gold was stolen' },
    perk: { magnet: 0.3 }, unlock: { type: 'start' },
    skins: [
      { id: 'classic', name: { ar: 'كلاسيك', en: 'Classic' }, body: 0xf5f8ff, accent: 0x18b7ff, visor: 0x14213d, eye: 0x4dfcff },
      { id: 'racer', name: { ar: 'المتسابق', en: 'Racer' }, body: 0xff4b3e, accent: 0x1b1b1b, visor: 0x101010, eye: 0xffe14d, cost: { gold: 15000 } },
      { id: 'golden', name: { ar: 'الذهبي', en: 'Golden' }, body: 0xffd34d, accent: 0xff9f1c, visor: 0x3b2500, eye: 0xffffff, cost: { gems: 180 } },
    ],
  },
  {
    id: 'nova', name: { ar: 'نوفا', en: 'Nova' },
    bio: { ar: 'سريعة وذكية، تضاعف الذهب لوقت أطول', en: 'Fast and smart, doubles gold for longer' },
    perk: { double: 0.3 }, unlock: { type: 'house', world: 'city' },
    skins: [
      { id: 'pink', name: { ar: 'وردي', en: 'Blossom' }, body: 0xfff0f7, accent: 0xff4fa3, visor: 0x2b1030, eye: 0xff9cf0 },
      { id: 'mint', name: { ar: 'نعناع', en: 'Mint' }, body: 0xe6fff5, accent: 0x18c99a, visor: 0x0e2b24, eye: 0x7dffd4, cost: { gold: 18000 } },
      { id: 'galaxy', name: { ar: 'المجرة', en: 'Galaxy' }, body: 0x3a2a8c, accent: 0xff4fa3, visor: 0x090520, eye: 0x9cf5ff, cost: { gems: 200 } },
    ],
  },
  {
    id: 'bolt', name: { ar: 'بولت', en: 'Bolt' },
    bio: { ar: 'مهووس بالطيران والنفاثات', en: 'Obsessed with jets and flying' },
    perk: { jet: 0.3 }, unlock: { type: 'house', world: 'neon' },
    skins: [
      { id: 'volt', name: { ar: 'فولت', en: 'Volt' }, body: 0xffd23f, accent: 0x222222, visor: 0x111111, eye: 0x3df2ff },
      { id: 'storm', name: { ar: 'العاصفة', en: 'Storm' }, body: 0x6c7a89, accent: 0x3df2ff, visor: 0x0b0f14, eye: 0xffffff, cost: { gold: 22000 } },
      { id: 'plasma', name: { ar: 'بلازما', en: 'Plasma' }, body: 0x7b2ff7, accent: 0xf107a3, visor: 0x12002a, eye: 0xfffb00, cost: { gems: 220 } },
    ],
  },
  {
    id: 'zaytoon', name: { ar: 'زيتون', en: 'Zaytoon' },
    bio: { ar: 'درعه الأخضر لا يُكسر بسهولة', en: 'His green shield rarely breaks' },
    perk: { shield: 0.3 }, unlock: { type: 'house', world: 'island' },
    skins: [
      { id: 'olive', name: { ar: 'زيتوني', en: 'Olive' }, body: 0x8fbf4a, accent: 0x3f6b1f, visor: 0x18240c, eye: 0xd8ff6a },
      { id: 'coral', name: { ar: 'مرجاني', en: 'Coral' }, body: 0xff8a65, accent: 0x00897b, visor: 0x1a1a1a, eye: 0xffffff, cost: { gold: 26000 } },
      { id: 'jade', name: { ar: 'اليشم', en: 'Jade' }, body: 0x00a86b, accent: 0xffd700, visor: 0x002b1b, eye: 0xfff7a8, cost: { gems: 240 } },
    ],
  },
  {
    id: 'frosty', name: { ar: 'فروستي', en: 'Frosty' },
    bio: { ar: 'روبوت جليدي يحب المغناطيس والطيران', en: 'An icy bot who loves magnets and jets' },
    perk: { magnet: 0.2, jet: 0.2 }, unlock: { type: 'house', world: 'forest' },
    skins: [
      { id: 'ice', name: { ar: 'جليد', en: 'Ice' }, body: 0xe3f6ff, accent: 0x4aa8ff, visor: 0x0b2a4a, eye: 0xbff4ff },
      { id: 'aurora', name: { ar: 'الشفق', en: 'Aurora' }, body: 0x1d3557, accent: 0x52ffb8, visor: 0x050d18, eye: 0xb388ff, cost: { gold: 30000 } },
      { id: 'crystal', name: { ar: 'كريستال', en: 'Crystal' }, body: 0xc8f0ff, accent: 0xff7af5, visor: 0x2a0b3a, eye: 0xffffff, cost: { gems: 260 } },
    ],
  },
  {
    id: 'saqr', name: { ar: 'صقر', en: 'Saqr' },
    bio: { ar: 'حارس الواحة، سريع كالصقر', en: 'Guardian of the oasis, swift as a falcon' },
    perk: { double: 0.2, shield: 0.2 }, unlock: { type: 'house', world: 'snow' },
    skins: [
      { id: 'sand', name: { ar: 'رملي', en: 'Sand' }, body: 0xe9c46a, accent: 0x8c5a2b, visor: 0x2b1a0a, eye: 0x6affd8 },
      { id: 'night', name: { ar: 'ليلي', en: 'Night' }, body: 0x264653, accent: 0xe9c46a, visor: 0x05090b, eye: 0xffd166, cost: { gold: 35000 } },
      { id: 'royal', name: { ar: 'ملكي', en: 'Royal' }, body: 0xffffff, accent: 0xd4a017, visor: 0x1b1b1b, eye: 0x00e5ff, cost: { gems: 300 } },
    ],
  },
  {
    id: 'titan', name: { ar: 'تايتن', en: 'Titan' },
    bio: { ar: 'روبوت أسطوري: كل القدرات أطول ونقاط أكثر', en: 'Legendary bot: every power-up lasts longer, more score' },
    perk: { magnet: 0.15, shield: 0.15, jet: 0.15, double: 0.15, score: 0.1 }, unlock: { type: 'gems', gems: 1200 },
    skins: [
      { id: 'titan', name: { ar: 'تايتن', en: 'Titan' }, body: 0x2b2d42, accent: 0xffb703, visor: 0x000000, eye: 0xff3d3d },
      { id: 'obsidian', name: { ar: 'سبج', en: 'Obsidian' }, body: 0x111111, accent: 0x9b5cff, visor: 0x000000, eye: 0x9cf5ff, cost: { gems: 350 } },
      { id: 'sun', name: { ar: 'الشمس', en: 'Sun' }, body: 0xfff3c4, accent: 0xff6d00, visor: 0x3a1500, eye: 0xffea00, cost: { gems: 450 } },
    ],
  },
];

export function charById(id) { return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]; }
export function worldById(id) { return WORLDS.find((w) => w.id === id) || WORLDS[0]; }
export function worldIndex(id) { return Math.max(0, WORLDS.findIndex((w) => w.id === id)); }

// Reward item kinds used by vaults, wheel, daily calendar and missions.
// { k: 'gold'|'gems'|'batteries'|'headstart'|'vault', n: amount, v?: vault type }

export const VAULTS = {
  wood: {
    name: { ar: 'خزنة خشبية', en: 'Wooden vault' }, rolls: 3, freeEveryH: 6,
    table: [
      { k: 'gold', min: 150, max: 450, w: 40 },
      { k: 'gems', min: 2, max: 5, w: 20 },
      { k: 'batteries', min: 1, max: 1, w: 20 },
      { k: 'headstart', min: 1, max: 1, w: 20 },
    ],
  },
  steel: {
    name: { ar: 'خزنة فولاذية', en: 'Steel vault' }, rolls: 3, unlockH: 2, goldPrice: 1500,
    table: [
      { k: 'gold', min: 500, max: 1400, w: 38 },
      { k: 'gems', min: 5, max: 12, w: 24 },
      { k: 'batteries', min: 1, max: 3, w: 22 },
      { k: 'headstart', min: 1, max: 2, w: 16 },
    ],
  },
  diamond: {
    name: { ar: 'خزنة ماسية', en: 'Diamond vault' }, rolls: 5, batteryPrice: 6, gemPrice: 60, guaranteeGems: true,
    table: [
      { k: 'gold', min: 1500, max: 4000, w: 30 },
      { k: 'gems', min: 15, max: 40, w: 30 },
      { k: 'batteries', min: 2, max: 5, w: 24 },
      { k: 'headstart', min: 2, max: 3, w: 16 },
    ],
  },
};
export const MAX_VAULT_SLOTS = 4;

// Reward wheel: one free spin every 8 hours, extra spins cost gems.
export const WHEEL = {
  freeEveryH: 8, spinGemCost: 10,
  segments: [
    { k: 'gold', n: 250, w: 24, color: '#ffcf3f' },
    { k: 'gems', n: 5, w: 16, color: '#4dd7ff' },
    { k: 'batteries', n: 1, w: 12, color: '#7dff8a' },
    { k: 'gold', n: 600, w: 14, color: '#ffb020' },
    { k: 'headstart', n: 1, w: 13, color: '#ff7a59' },
    { k: 'gems', n: 15, w: 9, color: '#39a0ff' },
    { k: 'batteries', n: 3, w: 10.9, color: '#3ddc84' },
    { k: 'gems', n: 150, w: 1.1, color: '#b06bff', jackpot: true },
  ],
};

export const FREE_GIFT = { everyH: 8, gold: 200 };

export const DAILY_REWARDS = [
  [{ k: 'gold', n: 200 }],
  [{ k: 'gems', n: 5 }],
  [{ k: 'batteries', n: 1 }],
  [{ k: 'gold', n: 600 }],
  [{ k: 'gems', n: 10 }],
  [{ k: 'headstart', n: 1 }, { k: 'batteries', n: 1 }],
  [{ k: 'gems', n: 25 }, { k: 'vault', n: 1, v: 'steel' }],
];

// Mission templates: "run" scope resets every run, "total" accumulates across runs.
export const MISSION_POOL = [
  { id: 'gold_run_s', stat: 'gold', scope: 'run', n: 120, reward: { k: 'gems', n: 5 } },
  { id: 'gold_run_m', stat: 'gold', scope: 'run', n: 300, reward: { k: 'gems', n: 10 } },
  { id: 'gold_run_l', stat: 'gold', scope: 'run', n: 600, reward: { k: 'gems', n: 20 } },
  { id: 'gold_total', stat: 'gold', scope: 'total', n: 2000, reward: { k: 'gems', n: 15 } },
  { id: 'dist_run_s', stat: 'dist', scope: 'run', n: 600, reward: { k: 'gold', n: 300 } },
  { id: 'dist_run_m', stat: 'dist', scope: 'run', n: 1500, reward: { k: 'gems', n: 10 } },
  { id: 'dist_run_l', stat: 'dist', scope: 'run', n: 3000, reward: { k: 'gems', n: 25 } },
  { id: 'jumps', stat: 'jumps', scope: 'total', n: 40, reward: { k: 'gold', n: 400 } },
  { id: 'slides', stat: 'slides', scope: 'total', n: 30, reward: { k: 'gold', n: 400 } },
  { id: 'magnets', stat: 'pu_magnet', scope: 'total', n: 3, reward: { k: 'gems', n: 6 } },
  { id: 'jets', stat: 'pu_jet', scope: 'total', n: 3, reward: { k: 'gems', n: 6 } },
  { id: 'shields', stat: 'pu_shield', scope: 'total', n: 3, reward: { k: 'gems', n: 6 } },
  { id: 'doubles', stat: 'pu_double', scope: 'total', n: 3, reward: { k: 'gems', n: 6 } },
  { id: 'boss1', stat: 'bosses', scope: 'total', n: 1, reward: { k: 'batteries', n: 2 } },
  { id: 'boss3', stat: 'bosses', scope: 'total', n: 3, reward: { k: 'gems', n: 30 } },
  { id: 'emps', stat: 'emps', scope: 'total', n: 6, reward: { k: 'gems', n: 10 } },
  { id: 'trucks', stat: 'roofs', scope: 'total', n: 12, reward: { k: 'gold', n: 500 } },
  { id: 'runs', stat: 'runs', scope: 'total', n: 5, reward: { k: 'headstart', n: 1 } },
  { id: 'gems_run', stat: 'gemsPicked', scope: 'total', n: 3, reward: { k: 'gold', n: 600 } },
  { id: 'lanes', stat: 'lanes', scope: 'total', n: 150, reward: { k: 'gold', n: 350 } },
];

// Google Play in-app products. IDs must match the products created in Play Console.
// type: 'inapp' consumable/non-consumable, 'subs' subscription. Prices are display fallbacks
// only; on Android the localised price from Google Play is always shown.
export const PRODUCTS = [
  { id: 'gems_80', type: 'inapp', consumable: true, grant: [{ k: 'gems', n: 80 }], price: '$0.99', tag: null },
  { id: 'gems_450', type: 'inapp', consumable: true, grant: [{ k: 'gems', n: 450 }], price: '$4.99', tag: 'popular' },
  { id: 'gems_1000', type: 'inapp', consumable: true, grant: [{ k: 'gems', n: 1000 }], price: '$9.99', tag: null },
  { id: 'gems_2200', type: 'inapp', consumable: true, grant: [{ k: 'gems', n: 2200 }], price: '$19.99', tag: 'value' },
  { id: 'gems_6000', type: 'inapp', consumable: true, grant: [{ k: 'gems', n: 6000 }], price: '$49.99', tag: null },
  { id: 'gems_13000', type: 'inapp', consumable: true, grant: [{ k: 'gems', n: 13000 }], price: '$99.99', tag: 'best' },
  { id: 'gold_10k', type: 'inapp', consumable: true, grant: [{ k: 'gold', n: 10000 }], price: '$1.99', tag: null },
  { id: 'gold_60k', type: 'inapp', consumable: true, grant: [{ k: 'gold', n: 60000 }], price: '$9.99', tag: 'value' },
  {
    id: 'starter_pack', type: 'inapp', consumable: false, oneTime: true, price: '$2.99', tag: 'starter',
    grant: [{ k: 'gems', n: 300 }, { k: 'gold', n: 8000 }, { k: 'batteries', n: 5 }, { k: 'headstart', n: 3 }],
  },
  { id: 'gold_doubler', type: 'inapp', consumable: false, oneTime: true, price: '$5.99', tag: 'forever', grant: [], entitlement: 'doubler' },
  { id: 'ebot_club', type: 'subs', consumable: false, price: '$3.99', tag: 'club', grant: [], entitlement: 'club' },
];
export const CLUB_DAILY = [{ k: 'gems', n: 60 }, { k: 'batteries', n: 2 }];

// In-game exchanges paid with gems.
export const GEM_OFFERS = [
  { id: 'bat1', give: { k: 'batteries', n: 1 }, gems: 8 },
  { id: 'bat5', give: { k: 'batteries', n: 5 }, gems: 35 },
  { id: 'bat12', give: { k: 'batteries', n: 12 }, gems: 75 },
  { id: 'hs1', give: { k: 'headstart', n: 1 }, gems: 15 },
  { id: 'hs5', give: { k: 'headstart', n: 5 }, gems: 60 },
  { id: 'gold1', give: { k: 'gold', n: 1000 }, gems: 20 },
  { id: 'gold6', give: { k: 'gold', n: 6000 }, gems: 100 },
  { id: 'gold15', give: { k: 'gold', n: 15000 }, gems: 220 },
];

export const BOSS = {
  firstAt: 900, every: 1700, hits: 3, maxTime: 42, gap: 30,
  rewardGold: 250, rewardGems: 6,
};
