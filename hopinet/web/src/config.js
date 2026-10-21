// Static game data for Hopinet: worlds, characters, vehicles, power-ups, stages, home items,
// economy tables and the Google Play product catalogue. Every tunable number lives here so
// balancing never touches gameplay code.

export const GAME_VERSION = '3.1.2.5.5.6';
export const BRAND = {
  id: 'hopinet',
  name: { ar: 'هوبينت', en: 'Hopinet' },
  tagline: { ar: 'اقفز. اسبح. حلّق!', en: 'Hop. Swim. Soar.' },
  developer: 'Elevo',
  packageName: 'com.elevo.hopinet',
};

export const TILE = 30;               // metres per ground tile
export const LANE_WIDTH = 2.4;
export const LANES = [-LANE_WIDTH, 0, LANE_WIDTH];
export const SEA_Y = -0.9;            // sea beside the road
export const WATER_Y = -0.12;         // swimmable surface inside water zones
// Half-width of the land on each side of the track (road centre to the sea / the horizon).
// Beyond it the animated sea (SEA_Y) shows. Props live between ROAD_EDGE and GROUND_HALF.
export const ROAD_EDGE = 5.7;
export const GROUND_HALF = { harbor: 16, neon: 16, coral: 12, jungle: 26, frost: 22, dunes: 46 };

export const PHYS = {
  startSpeed: 13.5,
  maxSpeedGain: 17,
  speedRamp: 2600,     // metres to reach ~63% of the speed gain
  gravity: 36,
  jumpVelocity: 12.4,
  fastFall: -26,
  slideTime: 0.62,
  laneSpeed: 17,       // m/s lateral speed when switching lanes
  playerHalfWidth: 0.42,
  standHeight: 1.75,
  slideHeight: 0.72,
  swimHeight: 1.0,     // body above the surface while swimming
  diveY: -1.05,        // depth while diving (swipe down in water)
  diveHeight: 0.6,
  diveTime: 0.95,
  jetHeight: 8.5,      // jet pack altitude
  planeLevels: [3.4, 6.4, 9.6],   // plane altitude layers (swipe up/down to change)
  gapLength: 6,        // length of a broken-bridge gap inside a gap tile (z from -12 to -18 of the tile)
  gapStart: 12,
};

// Score multiplier comes from built house stages and luxury items.
export const SCORE = { perMetre: 1, perCoin: 5 };

export const POWERUPS = {
  magnet:  { base: 8,  perLevel: 2,   color: 0xff3d5a, radius: 7.5 },
  shield:  { base: 10, perLevel: 2,   color: 0x39c6ff },
  jet:     { base: 5,  perLevel: 1,   color: 0xffb020 },
  double:  { base: 10, perLevel: 2,   color: 0x9b5cff },
  bombmag: { base: 8,  perLevel: 1.5, color: 0xff7a1f, radius: 12 },
};
export const POWERUP_IDS = ['magnet', 'shield', 'jet', 'double', 'bombmag'];
export const UPGRADE_IDS = [...POWERUP_IDS, 'vehicle'];
export const UPGRADE_COSTS = [500, 1200, 2500, 5000, 9000, 15000]; // gold per level
export const MAX_UPGRADE = UPGRADE_COSTS.length;

// Vehicles are ridden after running into them on the track.
//  zone: where they appear ('road' | 'water' | 'any'); smash: obstacle families they plough through.
//  Any other hit destroys the vehicle (it works like a shield) and the rider survives.
export const VEHICLES = {
  car:   { dur: 14, speedMul: 1.30, zone: 'road',  smash: ['low', 'cone', 'high', 'bomb'], color: 0xffc21a },
  boat:  { dur: 15, speedMul: 1.25, zone: 'water', smash: ['low', 'cone', 'high'],         color: 0x39c6ff },
  ship:  { dur: 12, speedMul: 1.20, zone: 'water', smash: ['low', 'cone', 'high', 'block', 'mover'], color: 0xff5a5a, wide: true },
  plane: { dur: 16, speedMul: 1.50, zone: 'any',   smash: [],                              color: 0xffffff },
};
export const VEHICLE_IDS = ['car', 'boat', 'ship', 'plane'];
export const VEHICLE_UPGRADE_SEC = 1.5; // +seconds of vehicle ride per upgrade level

export const REVIVE_COSTS = [1, 2, 4, 6]; // batteries per revive within the same run
export const REVIVE_GEM_PER_BATTERY = 12;
export const HEADSTART_DISTANCE = 320;

// Six worlds. Completing a world's house unlocks the next world and a new character.
//  zones.water / zones.gaps: probability that the next stretch of track is a swimming section / a
//  broken bridge. sea: colours of the animated sea used by the backdrop and water zones.
export const WORLDS = [
  {
    id: 'harbor', unlocks: 'kiko', costFactor: 1,
    name: { ar: 'ميناء الشمس', en: 'Sunny Harbor' },
    desc: { ar: 'رصيف مشمس تتمايل فيه القوارب', en: 'A sunny quay where the boats sway' },
    sky: [0x2b8fe8, 0xcdeeff], fog: 0xcdeeff, fogNear: 80, fogFar: 230, night: false,
    sea: { shallow: 0x43d6dc, deep: 0x0a6fa8, foam: 0xffffff },
    ground: 0x86cf62, road: 0x4c5360, line: 0xffffff, side: 0xd9cfbf,
    hemi: [0xffffff, 0x88aa66, 1.05], sun: [0xfff3d6, 1.35], sunDir: [8, 18, 10],
    palette: [0xff7a59, 0xffc14d, 0x5cc8ff, 0xa0e070, 0xff9ecf, 0xb39dff, 0xffffff],
    obstacle: { low: 'barrier', high: 'gantry', block: 'van', truck: 'truck', cone: 'cone', mover: 'car' },
    props: 'harbor', zones: { water: 0.25, gaps: 0.10 },
    house: { style: 'villa', wall: 0xfff1d6, roof: 0xd9573f, trim: 0x2f80ed },
  },
  {
    id: 'neon', unlocks: 'bruno', costFactor: 1.6,
    name: { ar: 'خليج النيون', en: 'Neon Bay' },
    desc: { ar: 'مدينة الغروب المضيئة على الخليج', en: 'The glowing sunset city on the bay' },
    sky: [0x3a1f8a, 0xff8fb0], fog: 0x8a4a9a, fogNear: 60, fogFar: 200, night: true,
    sea: { shallow: 0x8a5cff, deep: 0x1c1060, foam: 0xffc0f0 },
    ground: 0x2a2150, road: 0x2a2a46, line: 0x39f3ff, side: 0x4b3f80,
    hemi: [0xb39bff, 0x331a66, 1.0], sun: [0xff9ad8, 0.85], sunDir: [-8, 12, 14],
    palette: [0xff3df2, 0x39f3ff, 0xffe14d, 0x7b61ff, 0x3dff9a],
    obstacle: { low: 'neonBarrier', high: 'holoGate', block: 'hoverCar', truck: 'neonTruck', cone: 'neonCone', mover: 'hoverCar' },
    props: 'neon', zones: { water: 0.20, gaps: 0.15 },
    house: { style: 'penthouse', wall: 0x2b2550, roof: 0x7b61ff, trim: 0xff3df2 },
  },
  {
    id: 'coral', unlocks: 'mimi', costFactor: 2.4,
    name: { ar: 'جزر المرجان', en: 'Coral Islands' },
    desc: { ar: 'لاجون فيروزي وشواطئ استوائية', en: 'Turquoise lagoons and tropical beaches' },
    sky: [0x1aa5ff, 0xfff0c2], fog: 0xd9f6ff, fogNear: 80, fogFar: 240, night: false,
    sea: { shallow: 0x3ff0d0, deep: 0x0077b6, foam: 0xffffff },
    ground: 0xf2d48a, road: 0xd9b26a, line: 0xfff6dc, side: 0xe8c47a,
    hemi: [0xffffff, 0xd9b26a, 1.1], sun: [0xfff0c8, 1.4], sunDir: [10, 20, 6],
    palette: [0xff6f61, 0x2ec4b6, 0xffbf69, 0xcbf3f0, 0xff9f1c],
    obstacle: { low: 'crate', high: 'bambooBar', block: 'hut', truck: 'iceTruck', cone: 'sandcastle', mover: 'buggy' },
    props: 'coral', zones: { water: 0.55, gaps: 0.10 },
    house: { style: 'bungalow', wall: 0xffe2b0, roof: 0xc98b3c, trim: 0x2ec4b6 },
  },
  {
    id: 'jungle', unlocks: 'ziggy', costFactor: 3.4,
    name: { ar: 'غابة الزمرد', en: 'Emerald Jungle' },
    desc: { ar: 'أشجار عملاقة وأنهار وشلالات', en: 'Giant trees, rivers and waterfalls' },
    sky: [0x4db38a, 0xf1ffe0], fog: 0xcfeccf, fogNear: 55, fogFar: 190, night: false,
    sea: { shallow: 0x58d6a0, deep: 0x0a6e58, foam: 0xeafff4 },
    ground: 0x4f9a46, road: 0x8a6a45, line: 0xb89464, side: 0x6a8f3e,
    hemi: [0xf4ffe8, 0x3e6b2c, 1.0], sun: [0xfff6d0, 1.2], sunDir: [6, 18, 8],
    palette: [0x2f7d32, 0x4caf50, 0x8bc34a, 0x6d4c41, 0xcddc39],
    obstacle: { low: 'log', high: 'branch', block: 'boulder', truck: 'logTruck', cone: 'stump', mover: 'cart' },
    props: 'jungle', zones: { water: 0.30, gaps: 0.20 },
    house: { style: 'treehouse', wall: 0x9c6b3f, roof: 0x3e7d32, trim: 0xf4b400 },
  },
  {
    id: 'frost', unlocks: 'olo', costFactor: 4.6,
    name: { ar: 'مضيق الصقيع', en: 'Frost Fjord' },
    desc: { ar: 'جبال جليدية وبحر متجمد وشفق', en: 'Ice mountains, a frozen sea and aurora' },
    sky: [0x6aa8ff, 0xeaf6ff], fog: 0xe3f1ff, fogNear: 60, fogFar: 200, night: false, snow: true,
    sea: { shallow: 0x9fe3ff, deep: 0x1d6fb0, foam: 0xffffff },
    ground: 0xf4f8ff, road: 0xb9ccdf, line: 0x7fb2e5, side: 0xe3edf8,
    hemi: [0xffffff, 0xb8cce6, 1.1], sun: [0xffffff, 1.2], sunDir: [-6, 16, 10],
    palette: [0xd84a4a, 0x3b7dd8, 0x2a9d8f, 0xf4a261, 0xffffff],
    obstacle: { low: 'iceBlock', high: 'icicleArch', block: 'snowman', truck: 'plowTruck', cone: 'snowCone', mover: 'sled' },
    props: 'frost', zones: { water: 0.25, gaps: 0.15 },
    house: { style: 'chalet', wall: 0x8a5a3b, roof: 0xffffff, trim: 0xd84a4a },
  },
  {
    id: 'dunes', unlocks: null, costFactor: 6,
    name: { ar: 'كثبان الذهب', en: 'Golden Dunes' },
    desc: { ar: 'كثبان ذهبية وواحات وقباب', en: 'Golden dunes, oases and domes' },
    sky: [0xff9a3c, 0xfff1d0], fog: 0xffe2b8, fogNear: 70, fogFar: 220, night: false,
    sea: { shallow: 0x42e0c0, deep: 0x0b7d8a, foam: 0xffffff },
    ground: 0xf0c27a, road: 0xc9935a, line: 0xfff1d0, side: 0xe0ac6a,
    hemi: [0xfff4e0, 0xc9935a, 1.1], sun: [0xffe0b0, 1.45], sunDir: [10, 14, -6],
    palette: [0xe9c46a, 0x2a9d8f, 0xe76f51, 0xf4a261, 0xffffff],
    obstacle: { low: 'sandbags', high: 'carpetArch', block: 'stall', truck: 'caravan', cone: 'jar', mover: 'camelCart' },
    props: 'dunes', zones: { water: 0.10, gaps: 0.20 },
    house: { style: 'palace', wall: 0xf6e3c0, roof: 0xd4a017, trim: 0x2a9d8f },
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
  { ar: 'الأساسات والهيكل', en: 'Foundation & structure' },
  { ar: 'السقف والواجهة', en: 'Roof & facade' },
  { ar: 'النوافذ والأبواب والإضاءة', en: 'Windows, doors & lighting' },
  { ar: 'الحديقة والمدخل', en: 'Garden & driveway' },
  { ar: 'اللمسات الفاخرة', en: 'The grand finale' },
];
export function houseStageCost(worldIndex, stage) {
  const f = WORLDS[worldIndex].costFactor;
  const s = HOUSE_STAGES[stage];
  return { gold: Math.round((s.gold * f) / 50) * 50, gems: Math.round(s.gems * f) };
}

// Luxury items placed around a completed house (one set per world). Each owned item adds +1.5%
// gold to every run. The 3D model of each item is shown at its own place around the house.
export const HOME_ITEMS = [
  { id: 'lights',   name: { ar: 'إضاءة الحديقة', en: 'Garden lights' },   cost: { gold: 1200 } },
  { id: 'garden',   name: { ar: 'حديقة فاخرة', en: 'Landscaped garden' }, cost: { gold: 2000 } },
  { id: 'fountain', name: { ar: 'نافورة', en: 'Fountain' },               cost: { gold: 2400 } },
  { id: 'pool',     name: { ar: 'مسبح لا متناهٍ', en: 'Infinity pool' },  cost: { gold: 3200 } },
  { id: 'gazebo',   name: { ar: 'جلسة خارجية', en: 'Lounge gazebo' },     cost: { gold: 3600 } },
  { id: 'solar',    name: { ar: 'ألواح شمسية', en: 'Solar panels' },      cost: { gold: 4200 } },
  { id: 'supercar', name: { ar: 'سيارة خارقة', en: 'Supercar' },          cost: { gold: 7000 } },
  { id: 'helipad',  name: { ar: 'مهبط مروحية', en: 'Helipad' },           cost: { gems: 60 } },
  { id: 'yacht',    name: { ar: 'يخت فاخر', en: 'Luxury yacht' },         cost: { gems: 90 } },
  { id: 'statue',   name: { ar: 'تمثال ذهبي', en: 'Golden statue' },      cost: { gems: 120 } },
];
export const HOME_ITEM_BONUS = 0.015;
export function homeItemCost(worldIndex, id) {
  const it = HOME_ITEMS.find((x) => x.id === id);
  const f = Math.max(1, WORLDS[worldIndex].costFactor * 0.8);
  const c = it.cost;
  return { gold: c.gold ? Math.round((c.gold * f) / 50) * 50 : 0, gems: c.gems ? Math.round(c.gems * Math.sqrt(f)) : 0 };
}

// Characters are little courier animals. Perks extend one power-up (or vehicle rides) for longer.
//  skin colours: fur, belly, accent (ears/inner), scarf, lens (goggle glass).
export const CHARACTERS = [
  {
    id: 'hopi', species: 'rabbit', name: { ar: 'هوبي', en: 'Hopi' },
    bio: { ar: 'أرنب ساعي بريد سريع، يعشق المغناطيس', en: 'A speedy courier rabbit who loves magnets' },
    perk: { magnet: 0.3 }, unlock: { type: 'start' },
    skins: [
      { id: 'snow', name: { ar: 'ثلجي', en: 'Snow' }, fur: 0xf6f8ff, belly: 0xffffff, accent: 0xffb3c7, scarf: 0xff5a5f, lens: 0x4dd8ff },
      { id: 'caramel', name: { ar: 'كراميل', en: 'Caramel' }, fur: 0xd9a066, belly: 0xf5dcb8, accent: 0xa8622a, scarf: 0x2f80ed, lens: 0xffe14d, cost: { gold: 15000 } },
      { id: 'galaxy', name: { ar: 'المجرة', en: 'Galaxy' }, fur: 0x3a2a8c, belly: 0x7b61ff, accent: 0xff4fa3, scarf: 0xffd23f, lens: 0x9cf5ff, cost: { gems: 180 } },
    ],
  },
  {
    id: 'kiko', species: 'fox', name: { ar: 'كيكو', en: 'Kiko' },
    bio: { ar: 'ثعلب ماكر، الذهب معه يتضاعف لوقت أطول', en: 'A cunning fox: double gold lasts longer' },
    perk: { double: 0.3 }, unlock: { type: 'house', world: 'harbor' },
    skins: [
      { id: 'ember', name: { ar: 'جمري', en: 'Ember' }, fur: 0xf07a2a, belly: 0xfff1de, accent: 0x3a2418, scarf: 0x2ec4b6, lens: 0xffe14d },
      { id: 'arctic', name: { ar: 'قطبي', en: 'Arctic' }, fur: 0xe8f2ff, belly: 0xffffff, accent: 0x7aa7d9, scarf: 0xff4fa3, lens: 0x7dffd4, cost: { gold: 18000 } },
      { id: 'shadow', name: { ar: 'ظل', en: 'Shadow' }, fur: 0x2b2d42, belly: 0x6c7a89, accent: 0x14151f, scarf: 0xffb703, lens: 0xff3d3d, cost: { gems: 200 } },
    ],
  },
  {
    id: 'bruno', species: 'bear', name: { ar: 'برونو', en: 'Bruno' },
    bio: { ar: 'دبّ قوي، خوذته تدوم أطول', en: 'A sturdy bear: the helmet lasts longer' },
    perk: { shield: 0.3 }, unlock: { type: 'house', world: 'neon' },
    skins: [
      { id: 'honey', name: { ar: 'عسلي', en: 'Honey' }, fur: 0x9c6b3f, belly: 0xe6c79c, accent: 0x5a3a1e, scarf: 0xffc21a, lens: 0x4dd8ff },
      { id: 'polar', name: { ar: 'قطبي', en: 'Polar' }, fur: 0xf2f6fb, belly: 0xffffff, accent: 0xb7c9dd, scarf: 0x2f80ed, lens: 0x7dffd4, cost: { gold: 22000 } },
      { id: 'panda', name: { ar: 'باندا', en: 'Panda' }, fur: 0xf7f7f7, belly: 0xffffff, accent: 0x1b1b1b, scarf: 0x3ddc84, lens: 0xffe14d, cost: { gems: 220 } },
    ],
  },
  {
    id: 'mimi', species: 'cat', name: { ar: 'ميمي', en: 'Mimi' },
    bio: { ar: 'قطة رشيقة، تحلّق بالجيت باك لوقت أطول', en: 'A graceful cat: the jet pack flies longer' },
    perk: { jet: 0.3 }, unlock: { type: 'house', world: 'coral' },
    skins: [
      { id: 'tabby', name: { ar: 'مخطط', en: 'Tabby' }, fur: 0xb8b8c8, belly: 0xf2f2fa, accent: 0xff9ec4, scarf: 0xff4fa3, lens: 0x4dfcff },
      { id: 'ginger', name: { ar: 'زنجبيلي', en: 'Ginger' }, fur: 0xf0a24a, belly: 0xffe7c4, accent: 0xc2661a, scarf: 0x2ec4b6, lens: 0xffffff, cost: { gold: 26000 } },
      { id: 'midnight', name: { ar: 'منتصف الليل', en: 'Midnight' }, fur: 0x1f2233, belly: 0x4a4f73, accent: 0x7b61ff, scarf: 0xffd700, lens: 0xfff7a8, cost: { gems: 240 } },
    ],
  },
  {
    id: 'ziggy', species: 'frog', name: { ar: 'زيغي', en: 'Ziggy' },
    bio: { ar: 'ضفدع سبّاح: مركباته تدوم أطول', en: 'A swimmer frog: vehicle rides last longer' },
    perk: { vehicle: 0.3, bombmag: 0.2 }, unlock: { type: 'house', world: 'jungle' },
    skins: [
      { id: 'lime', name: { ar: 'ليموني', en: 'Lime' }, fur: 0x7cd04a, belly: 0xe8f7b8, accent: 0x3f8f1f, scarf: 0xff7a1f, lens: 0xfff7a8 },
      { id: 'poison', name: { ar: 'سام', en: 'Poison' }, fur: 0x2a9df4, belly: 0xbfe6ff, accent: 0x0b4f8a, scarf: 0xffe14d, lens: 0xff4fa3, cost: { gold: 30000 } },
      { id: 'gold', name: { ar: 'ذهبي', en: 'Gilded' }, fur: 0xffc93c, belly: 0xfff3c4, accent: 0xb5761a, scarf: 0x2b2d42, lens: 0xffffff, cost: { gems: 260 } },
    ],
  },
  {
    id: 'olo', species: 'owl', name: { ar: 'أولو', en: 'Olo' },
    bio: { ar: 'بومة حكيمة: المغناطيس وجاذب القنابل أقوى', en: 'A wise owl: magnet and bomb magnet are stronger' },
    perk: { magnet: 0.2, bombmag: 0.3 }, unlock: { type: 'house', world: 'frost' },
    skins: [
      { id: 'brown', name: { ar: 'بنّي', en: 'Brown' }, fur: 0x8a6a4a, belly: 0xe9d6b8, accent: 0x4a3622, scarf: 0xd84a4a, lens: 0xffe14d },
      { id: 'snowy', name: { ar: 'ثلجية', en: 'Snowy' }, fur: 0xeef3f8, belly: 0xffffff, accent: 0x99a8bb, scarf: 0x3b7dd8, lens: 0x7dffd4, cost: { gold: 34000 } },
      { id: 'aurora', name: { ar: 'الشفق', en: 'Aurora' }, fur: 0x24405a, belly: 0x52ffb8, accent: 0xb388ff, scarf: 0xff7af5, lens: 0xffffff, cost: { gems: 280 } },
    ],
  },
  {
    id: 'rex', species: 'dino', name: { ar: 'ريكس', en: 'Rex' },
    bio: { ar: 'ديناصور أسطوري: كل شيء أطول ونقاط أكثر', en: 'A legendary dino: everything lasts longer, more score' },
    perk: { magnet: 0.15, shield: 0.15, jet: 0.15, double: 0.15, bombmag: 0.15, vehicle: 0.15, score: 0.1 }, unlock: { type: 'gems', gems: 1200 },
    skins: [
      { id: 'emerald', name: { ar: 'زمردي', en: 'Emerald' }, fur: 0x35b36a, belly: 0xe3f5a8, accent: 0xff7a1f, scarf: 0xffd23f, lens: 0xff3d3d },
      { id: 'magma', name: { ar: 'حممي', en: 'Magma' }, fur: 0x3a1a1a, belly: 0xff7a1f, accent: 0xffd23f, scarf: 0xff3d3d, lens: 0xffffff, cost: { gems: 350 } },
      { id: 'crystal', name: { ar: 'كريستالي', en: 'Crystal' }, fur: 0x9fe3ff, belly: 0xffffff, accent: 0xff7af5, scarf: 0x7b61ff, lens: 0xffffff, cost: { gems: 450 } },
    ],
  },
];

export function charById(id) { return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]; }
export function worldById(id) { return WORLDS.find((w) => w.id === id) || WORLDS[0]; }
export function worldIndex(id) { return Math.max(0, WORLDS.findIndex((w) => w.id === id)); }

// The villain: Captain Krab, a pirate crab. He steals your treasure at the start of a run and
// later attacks from a flying pirate airship.
export const VILLAIN = { id: 'krab', name: { ar: 'الكابتن كراب', en: 'Captain Krab' } };

// ---------- campaign stages (36: six per world) ----------
// goal types: dist (reach N metres), coins (collect N coins in the run), vehicle (ride N vehicles),
//             swim (swim N metres), boss (beat the pirate airship)
//  stars: 1 = finish, 2 = collect `coinsStar` coins, 3 = finish without using a revive.
function makeStages() {
  const out = [];
  WORLDS.forEach((w, wi) => {
    const goals = [
      { type: 'dist', n: 450 + wi * 120 },
      { type: 'coins', n: 70 + wi * 25 },
      { type: 'vehicle', n: 2 },
      { type: 'dist', n: 800 + wi * 200 },
      { type: 'swim', n: 140 + wi * 40 },
      { type: 'boss', n: 1 },
    ];
    goals.forEach((goal, si) => {
      const index = wi * 6 + si;
      out.push({
        id: `${w.id}-${si + 1}`, index, world: w.id, worldIndex: wi, n: si + 1, goal,
        difficulty: Math.min(0.85, 0.05 + wi * 0.1 + si * 0.04),
        coinsStar: Math.round((goal.type === 'dist' ? goal.n / 7 : 60 + wi * 20) / 5) * 5,
        reward: { gold: 150 + index * 40, gems: si === 5 ? 15 + wi * 3 : 2 + Math.floor(si / 2) },
        starGems: [0, 2, 3],
      });
    });
  });
  return out;
}
export const STAGES = makeStages();
export function stageById(id) { return STAGES.find((s) => s.id === id) || null; }

// ---------- map: where the worlds are on Earth (used by the world map screen) ----------
export const PLACES = {
  harbor: { lat: 38.7, lon: -9.1,  ar: 'لشبونة', en: 'Lisbon' },
  neon:   { lat: 35.6, lon: 139.8, ar: 'خليج طوكيو', en: 'Tokyo Bay' },
  coral:  { lat: 3.2,  lon: 73.2,  ar: 'المالديف', en: 'Maldives' },
  jungle: { lat: -3.1, lon: -60.0, ar: 'الأمازون', en: 'Amazon' },
  frost:  { lat: 60.4, lon: 5.3,   ar: 'مضايق النرويج', en: 'Norwegian fjords' },
  dunes:  { lat: 24.9, lon: 55.4,  ar: 'صحراء دبي', en: 'Dubai desert' },
};

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
  { id: 'bombmags', stat: 'pu_bombmag', scope: 'total', n: 3, reward: { k: 'gems', n: 6 } },
  { id: 'boss1', stat: 'bosses', scope: 'total', n: 1, reward: { k: 'batteries', n: 2 } },
  { id: 'boss3', stat: 'bosses', scope: 'total', n: 3, reward: { k: 'gems', n: 30 } },
  { id: 'emps', stat: 'emps', scope: 'total', n: 6, reward: { k: 'gems', n: 10 } },
  { id: 'roofs', stat: 'roofs', scope: 'total', n: 12, reward: { k: 'gold', n: 500 } },
  { id: 'runs', stat: 'runs', scope: 'total', n: 5, reward: { k: 'headstart', n: 1 } },
  { id: 'gems_run', stat: 'gemsPicked', scope: 'total', n: 3, reward: { k: 'gold', n: 600 } },
  { id: 'lanes', stat: 'lanes', scope: 'total', n: 150, reward: { k: 'gold', n: 350 } },
  { id: 'swim', stat: 'swim', scope: 'total', n: 600, reward: { k: 'gold', n: 500 } },
  { id: 'dives', stat: 'dives', scope: 'total', n: 15, reward: { k: 'gold', n: 400 } },
  { id: 'vehicles', stat: 'vehicles', scope: 'total', n: 6, reward: { k: 'gems', n: 8 } },
  { id: 'planes', stat: 'planes', scope: 'total', n: 3, reward: { k: 'gems', n: 8 } },
  { id: 'blasts', stat: 'blasts', scope: 'total', n: 20, reward: { k: 'gold', n: 600 } },
  { id: 'rings', stat: 'rings', scope: 'total', n: 15, reward: { k: 'gold', n: 500 } },
  { id: 'gaps', stat: 'gaps', scope: 'total', n: 10, reward: { k: 'gold', n: 450 } },
];

// Google Play in-app products. IDs must match the products created in Play Console.
// type: 'inapp' consumable/non-consumable, 'subs' subscription. `price` is only the suggested
// price to enter in Play Console (see README); the game never displays it. The game shows only
// the price Google Play returns, and nothing is sold where Google Play is not available.
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
  { id: 'hopinet_club', type: 'subs', consumable: false, price: '$3.99', tag: 'club', grant: [], entitlement: 'club' },
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

// The pirate airship boss.
export const BOSS = {
  firstAt: 900, every: 1700, hits: 3, maxTime: 42, gap: 30,
  rewardGold: 250, rewardGems: 6,
};
