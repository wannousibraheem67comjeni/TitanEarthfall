// Hopinet audio engine: 100% procedural WebAudio (no audio files ship with the game).
//
// DESIGN
//  * Graph:  sources -> stems (drums/bass/harm/arp/lead/perc) -> track fader -> musicVol -> mixIn
//            sfx / engine loops -> sfxBus -> mixIn;  global echo + reverb returns -> mixIn
//            mixIn -> [soft distortion + helmet comb] -> 2x low-pass (HELMET MUFFLE) -> underwater
//            low-pass with wobbling LFO (UNDERWATER) -> compressor -> brick-wall limiter -> soft clipper
//            -> master -> AnalyserNode -> destination.  Both muffle and underwater therefore blur the
//            whole mix (music + sfx + engines) and all changes are glided with setTargetAtTime.
//  * Music: a 16-step/bar sequencer with 300 ms look-ahead (timer 30 ms).  An 8-bar cycle per world
//            (call-and-response lead phrases, chord progression, bass patterns, drum grooves, fills and
//            a riser + crash every 8 bars; every 4th cycle gets a 2-bar build + dropout + drop).
//            Kicks duck bass/chords/arps (side-chain feel).  Drum noise sounds and pitched plucks/bells
//            are baked once into AudioBuffers (Karplus-Strong / modal synthesis) so a note costs two
//            nodes; bass/pads/leads are live oscillators.  Tempo, swing, key, scale, instruments, grooves
//            are per world:
//              harbor C major pop 144 | neon A minor synthwave 140 | coral G mixolydian steel-pan 142 |
//              jungle D minor pentatonic tribal 146 | frost F lydian bells 140 | dunes D hijaz oud/darbuka 144
//  * Modes: lobby (~106, laid back), run (140-146), boss (160, dark riff), plane (~150, soaring), map,
//            water (= run).  Mode switches are quantised to the next bar line and announced by a riser.
//  * Intensity layers (smoothed): 0 kick+bass+hats, then chords, arp, lead, extra percussion; busier hat /
//            bass patterns above ~0.5.  A slow time ramp lets a fresh run build up even at low speed.
//  * Everything is allocation-light: shared noise/drum buffers, no per-frame work, ~2-5 nodes per note.
//
// API (see docs/CONTRACTS.md): Audio.unlock/suspend/resume/setSfx/setMusic/play/engine/jet/startMusic/
// setMode/setIntensity/setMuffle/setUnderwater/stopMusic, Audio.mode, Audio.ctx, Audio.analyser.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const noop = () => {};

const MUSIC_VOL = 0.62;   // calibrated so that music alone sits around -16 dBFS RMS at the master output
const SFX_VOL = 0.9;
const LOOK = 0.45;        // scheduler look-ahead (s): survives main-thread stalls of a few frames
const TICK_MS = 30;

// ============================================================ DSP baking (offline, in JS)
function rngf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RBJ biquad over a Float32Array: 'lp' | 'hp' | 'bp' (constant 0 dB peak)
function biq(d, type, f, q, sr) {
  const w = TAU * f / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  const a0 = 1 + al;
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  b0 /= a0; b1 /= a0; b2 /= a0;
  const a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
  const o = new Float32Array(d.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    o[i] = y;
  }
  return o;
}

function toBuf(c, d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
  const k = m > 0 ? peak / m : 1;
  const n = d.length, fade = Math.min(n >> 2, (0.006 * c.sampleRate) | 0);
  for (let i = 0; i < n; i++) {
    let v = d[i] * k;
    if (i > n - fade) v *= (n - i) / fade;
    d[i] = v;
  }
  const b = c.createBuffer(1, n, c.sampleRate);
  b.getChannelData(0).set(d);
  return b;
}

// Sum of decaying sine partials: parts = [ratio, amp, tauSeconds]
function bakeModal(sr, f0, dur, parts, click, seed) {
  const n = Math.max(16, (dur * sr) | 0), d = new Float32Array(n);
  for (let p = 0; p < parts.length; p++) {
    const f = f0 * parts[p][0];
    if (f > sr * 0.42) continue;
    const w = TAU * f / sr, dec = Math.exp(-1 / (parts[p][2] * sr));
    let amp = parts[p][1], ph = 0;
    for (let i = 0; i < n; i++) { d[i] += amp * Math.sin(ph); ph += w; amp *= dec; }
  }
  const at = Math.max(2, (0.0012 * sr) | 0);
  for (let i = 0; i < at; i++) d[i] *= i / at;
  if (click) {
    const r = rngf(seed || 5), cn = (0.004 * sr) | 0;
    for (let i = 0; i < cn; i++) d[i] += (r() * 2 - 1) * click * (1 - i / cn);
  }
  return d;
}

// Karplus-Strong plucked string.  Returns {d, rate}: play with playbackRate = rate for exact pitch.
function bakeKS(sr, f0, t60, bright, pick, lp, seed) {
  const N = Math.max(3, Math.round(sr / f0 + 0.5));
  const fa = sr / (N - 0.5);
  const rate = f0 / fa;
  const len = (t60 * sr) | 0;
  const buf = new Float32Array(len);
  const r = rngf(seed);
  let y = 0;
  const a = clamp(bright, 0.05, 1);
  for (let i = 0; i < N; i++) { y += ((r() * 2 - 1) - y) * a; buf[i] = y; }
  const pk = Math.max(1, Math.round(N * pick));
  for (let i = N - 1; i >= pk; i--) buf[i] -= buf[i - pk] * 0.85;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  for (let i = 0; i < N; i++) buf[i] -= mean;
  const decay = Math.pow(10, -3 / (fa * t60 * 0.8));
  for (let i = N; i < len; i++) buf[i] = decay * 0.5 * (buf[i - N] + buf[i - N + 1]);
  const out = lp ? biq(buf, 'lp', lp, 0.7, sr) : buf;
  return { d: out, rate };
}

function distCurve(k) {   // unity small-signal gain soft saturation
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / k; }
  return c;
}
function clipCurve() {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
    c[i] = ax <= 0.82 ? x : Math.sign(x) * (0.82 + 0.15 * Math.tanh((ax - 0.82) / 0.15));
  }
  return c;
}

function makeIR(c, sec) {
  const sr = c.sampleRate, n = (sec * sr) | 0, b = c.createBuffer(2, n, sr), r = rngf(777);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t / (sec * 0.2)) * Math.min(1, t / 0.01);
      const a = 0.8 * Math.exp(-t * 3.5) + 0.1;
      y += ((r() * 2 - 1) - y) * a;
      d[i] = y * env;
    }
  }
  return b;
}

// Drum / noise kit baked once per AudioContext.
function bakeKit(c) {
  const sr = c.sampleRate, rnd = rngf(90210);
  const N = (s) => Math.max(16, (s * sr) | 0);
  const white = (n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rnd() * 2 - 1; return a; };
  const metal = (n) => {
    const o = new Float32Array(n);
    [263, 400, 421, 474, 587, 845].forEach((f) => { const ph = f / sr; for (let i = 0; i < n; i++) o[i] += (i * ph) % 1 < 0.5 ? 1 : -1; });
    return o;
  };
  const K = {};
  { // closed hat
    const n = N(0.075), w = white(n), m = metal(n), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = (w[i] * 0.75 + m[i] * 0.1) * Math.exp(-i / (sr * 0.0125));
    K.hatC = toBuf(c, biq(d, 'hp', 6800, 0.7, sr), 0.9);
  }
  { // open hat
    const n = N(0.34), w = white(n), m = metal(n), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = (w[i] * 0.7 + m[i] * 0.1) * Math.exp(-i / (sr * 0.085));
    K.hatO = toBuf(c, biq(d, 'hp', 6000, 0.7, sr), 0.85);
  }
  { // shaker
    const n = N(0.1), w = white(n), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = w[i] * Math.min(1, t / 0.014) * Math.exp(-t / 0.032); }
    K.shaker = toBuf(c, biq(d, 'bp', 5600, 0.9, sr), 0.8);
  }
  { // snare noise body
    const n = N(0.26), w = white(n), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = w[i] * (0.8 * Math.exp(-t / 0.045) + 0.2 * Math.exp(-t / 0.11)); }
    K.snareN = toBuf(c, biq(biq(d, 'bp', 2300, 0.55, sr), 'hp', 700, 0.7, sr), 0.9);
  }
  { // gated snare (plateau then cut)
    const n = N(0.24), w = white(n), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = w[i] * (t < 0.16 ? 0.45 + 0.55 * Math.exp(-t / 0.03) : 0.45 * Math.max(0, 1 - (t - 0.16) / 0.012)); }
    K.snareG = toBuf(c, biq(biq(d, 'bp', 1900, 0.5, sr), 'hp', 500, 0.7, sr), 0.9);
  }
  { // hand clap
    const n = N(0.24), w = white(n), d = new Float32Array(n);
    const bursts = [0, 0.011, 0.023];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let e = 0.9 * Math.exp(-Math.max(0, t - 0.033) / 0.055) * (t >= 0.033 ? 1 : 0);
      for (let b = 0; b < bursts.length; b++) if (t >= bursts[b]) e += Math.exp(-(t - bursts[b]) / 0.006) * 0.8;
      d[i] = w[i] * e;
    }
    K.clap = toBuf(c, biq(d, 'bp', 1500, 1.1, sr), 0.9);
  }
  { // crash cymbal
    const n = N(1.8), w = white(n), m = metal(n), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (w[i] * 0.8 + m[i] * 0.06) * (Math.exp(-t / 0.55) * Math.min(1, t / 0.003)); }
    K.crash = toBuf(c, biq(d, 'hp', 3800, 0.7, sr), 0.85);
  }
  { // wood / rim click
    K.rim = toBuf(c, bakeModal(sr, 1750, 0.14, [[1, 1, 0.022], [2.41, 0.6, 0.014], [3.87, 0.3, 0.008]], 0.5, 11), 0.9);
  }
  { // darbuka tek
    K.tek = toBuf(c, bakeModal(sr, 1050, 0.16, [[1, 1, 0.035], [1.59, 0.55, 0.028], [2.3, 0.3, 0.02]], 0.7, 12), 0.9);
  }
  { // kick click
    const n = N(0.012), w = white(n), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = w[i] * Math.exp(-i / (sr * 0.0022));
    K.kclick = toBuf(c, biq(d, 'lp', 5200, 0.7, sr), 0.9);
  }
  { // sfx bell (f0 880)
    K.bell = toBuf(c, bakeModal(sr, 880, 1.6, [[1, 1, 0.8], [2, 0.38, 0.5], [2.76, 0.33, 0.34], [4.07, 0.2, 0.22], [5.4, 0.12, 0.14]], 0.12, 13), 0.9);
  }
  { // 2.5 s of white noise (one-shots + loops)
    const n = N(2.5);
    K.noise = toBuf(c, white(n), 0.95);
  }
  return K;
}

// ============================================================ music data
const SC = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  minPent: [0, 3, 5, 7, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],        // D E-flat F# G A B-flat C : phrygian dominant
  harmMinor: [0, 2, 3, 5, 7, 8, 11],
};
const QUAL = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10], 5: [0, 7, 12] };
const BASS_MAP = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, a: 10, b: 11, c: 12, d: 14, e: 15, f: 17, g: 19 };

// Pitched instruments baked on demand (modal synthesis or Karplus-Strong)
const INST = {
  uke: { ks: { t60: 0.55, br: 0.55, pick: 0.14, lp: 6500 }, vol: 0.9 },
  guitar: { ks: { t60: 0.3, br: 0.5, pick: 0.2, lp: 4200 }, vol: 0.9 },
  oud: { ks: { t60: 1.05, br: 0.8, pick: 0.17, lp: 4800 }, vol: 0.95 },
  harp: { ks: { t60: 1.5, br: 0.6, pick: 0.25, lp: 6000 }, vol: 0.9 },
  marimba: { modal: { parts: [[1, 1, 0.42], [3.97, 0.4, 0.1], [9.2, 0.1, 0.035]], dur: 0.8, click: 0.25 }, vol: 0.95 },
  steel: { modal: { parts: [[1, 1, 0.55], [2.005, 0.65, 0.38], [3.01, 0.32, 0.22], [4.1, 0.15, 0.12]], dur: 0.95, click: 0.12 }, vol: 0.95 },
  bell: { modal: { parts: [[1, 1, 0.9], [2, 0.35, 0.55], [2.76, 0.3, 0.38], [5.4, 0.14, 0.2]], dur: 1.6, click: 0.05 }, vol: 0.9 },
  glock: { modal: { parts: [[1, 1, 0.5], [2.76, 0.25, 0.22], [5.4, 0.12, 0.1]], dur: 0.8, click: 0.1 }, vol: 0.9 },
};

// ---- per-world definitions.  Strings are 16-step bars.  Digits/letters = scale degrees (lead/arp),
// 'A'..'G' = -1..-7; '.' rest, '-' hold.  Bass chars: 0 root, 7 fifth, c octave, 1 b2, 3 m3 ...
const DEFS = {
  harbor: {
    mix: { drums: 0.94, bass: 0.5, harm: 1.07, arp: 3.1, lead: 3.55, perc: 1 },
    key: 0, scale: 'major', bossScale: 'harmMinor', swing: 0.05, trim: 1.04,
    bpm: { run: 144, lobby: 108, boss: 160, plane: 150 },
    prog: [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M'], [0, 'M'], [7, 'M'], [5, 'M'], [7, 'M']],
    leadBase: 72,
    lead: ['4--24-576--45-4.', '8--64-568--64...', '5-4.2-4.5-7.6-5.', '7--53-5.7-8-5.7.',
           '4--24-579--87-5.', '8--64-568--98-6.', '7--53-5.7-9-8-7.', '8--64-6.8-b-a-8.'],
    kick: 'punch', snare: 'clap',
    drums: {
      kick: ['X...X...X...X...', 'X...X...X..xX...'],
      snare: ['....X.......X...'], clap: [],
      hat: ['x.o.x.o.x.o.x.o.'], hatB: ['xoxoxoxoxoxoxoxo'], ohat: ['..x...x...x...x.'],
    },
    perc: [],
    bass: { wave: 'sawtooth', cut: 700, env: 2.2, dec: 0.14, q: 3, vol: 0.5, sub: 0.6, A: '0--0--c-0--0--7-', B: '0-0-0-c-0-0-0-c-' },
    harm: { pad: { wave: 'triangle', det: 0, cut0: 1500, cut1: 2600, a: 0.05, r: 0.3, vol: 0.105 }, stab: { kind: 'saw', pat: '..x...x...x...x.', wave: 'sawtooth', cut: 900, env: 4, vol: 0.085 } },
    arp: { inst: 'uke', mode: 'chord', A: '0.1.2.3.4.3.2.1.', B: '0123432101234321', oct: 0, vol: 0.2 },
    leadP: { inst: 'pop', cut: 3600, vol: 0.075, dly: 0.28, rev: 0.16 },
    fx: { snrRev: 0.12, harmRev: 0.14, arpRev: 0.12, arpDly: 0.12 },
  },
  neon: {
    mix: { drums: 0.92, bass: 0.57, harm: 1.93, arp: 5.6, lead: 4.5, perc: 1 },
    key: 9, scale: 'minor', bossScale: 'harmMinor', swing: 0, trim: 1.01,
    bpm: { run: 140, lobby: 106, boss: 160, plane: 148 },
    prog: [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M'], [0, 'm'], [8, 'M'], [10, 'M'], [7, 'M']],
    leadBase: 69,
    lead: ['7--64-.47-9-8-7.', '5--79--75-7-9...', 'b--9a-9.6-7-9...', '8--ab-a.8-6-4...',
           '7--9b--97-9-b...', '9--75-7-9-b-a-9.', 'a--86-8-a-b-a-8.', '8--48-b-8-4-b---'],
    kick: 'punch', snare: 'gated',
    drums: {
      kick: ['X...X...X...X...', 'X...X...X..xX...'],
      snare: ['....X.......X...'], clap: ['....x.......x...'],
      hat: ['x.x.x.x.x.x.x.x.'], hatB: ['xoxoxoxoxoxoxoxo'], ohat: ['..o...o...o...o.'],
    },
    perc: [],
    bass: { wave: 'sawtooth', cut: 1000, env: 2.4, dec: 0.1, q: 6, vol: 0.5, sub: 0.5, A: '0-0-0-0-0-0-0-0-', B: '0-0c0-0c0-0c0-0c' },
    harm: { pad: { wave: 'sawtooth', det: 11, cut0: 700, cut1: 2800, a: 0.09, r: 0.35, vol: 0.05 }, stab: null },
    arp: { inst: 'sawpluck', mode: 'chord', A: '0123012301230123', B: '0123432101234321', oct: 12, vol: 0.075, cut: 3200 },
    leadP: { inst: 'saw', cut: 4600, vol: 0.075, dly: 0.45, rev: 0.28 },
    fx: { snrRev: 0.3, harmRev: 0.2, arpRev: 0.18, arpDly: 0.4 },
  },
  coral: {
    mix: { drums: 1.14, bass: 0.43, harm: 1.23, arp: 0.79, lead: 0.92, perc: 1.26 },
    key: 7, scale: 'mixo', bossScale: 'harmMinor', swing: 0.1, trim: 1.05,
    bpm: { run: 142, lobby: 108, boss: 160, plane: 148 },
    prog: [[0, '7'], [10, 'M'], [5, 'M'], [0, '7'], [0, '7'], [10, 'M'], [5, 'M'], [10, 'M']],
    leadBase: 67,
    lead: ['4.4.7--54-2-4---', '3.3.6--83-1-3---', '7.7.a--97-5-7---', '4.4.7--54-2-0---',
           '7.7.b--97-9-7-4-', '6.6.8--a8-6-8-3-', '7.7.a--ca-7-5-3-', '8.8.a--83-6-8---'],
    kick: 'soft', snare: 'clap',
    drums: {
      kick: ['X...X...X...X...', 'X...X...X..xX...'],
      snare: ['....X.......X...'], clap: [],
      hat: ['..o...o...o...o.'], hatB: ['oxoxoxoxoxoxoxox'], ohat: ['..x...x...x...x.'], shk: ['oxoxoxoxoxoxoxox'],
    },
    perc: [
      { v: 'congaLo', pat: 'X.....x.....x...', stem: 'perc', vol: 0.8 },
      { v: 'congaHi', pat: '...x......x.x...', stem: 'perc', vol: 0.8 },
    ],
    fill: 'conga',
    bass: { wave: 'sawtooth', cut: 520, env: 2.6, dec: 0.12, q: 2, vol: 0.5, sub: 0.8, A: '0--0--0-0--0-c--', B: '0--0--0-0-0-0-7c' },
    harm: { pad: { wave: 'triangle', det: 0, cut0: 1800, cut1: 2400, a: 0.06, r: 0.3, vol: 0.085 }, stab: { kind: 'ks', inst: 'guitar', pat: '..x...x...x...x.', vol: 0.55 } },
    arp: { inst: 'marimba', mode: 'chord', A: '0.1.2.1.0.1.2.3.', B: '0121012101210123', oct: 12, vol: 0.2 },
    leadP: { inst: 'steel', vol: 0.3, dly: 0.2, rev: 0.22 },
    fx: { snrRev: 0.1, harmRev: 0.16, arpRev: 0.18, arpDly: 0.1 },
  },
  jungle: {
    mix: { drums: 0.88, bass: 0.49, harm: 0.97, arp: 0.98, lead: 1.66, perc: 0.96 },
    key: 2, scale: 'minPent', bossScale: 'harmMinor', swing: 0.14, trim: 0.93,
    bpm: { run: 146, lobby: 108, boss: 160, plane: 150 },
    prog: [[0, '5'], [0, '5'], [3, '5'], [5, '5'], [0, '5'], [10, '5'], [5, '5'], [7, '5']],
    leadBase: 62,
    lead: ['5--67-8-7-6-5---', '8--9a-9-8-7-8...', '9--86-8-9-a-9---', 'a--98-7-8-9-7---',
           '5-5-6-7-8--a--9-', '9--8-7-6-7-8-9--', 'a--98-7-8-a-9---', '8--76-5-6-7-8...'],
    kick: 'taiko', snare: 'rim',
    drums: {
      kick: ['X.....x.X...x...', 'X.....x.X..xx...'],
      snare: ['....x.......x...'], clap: [],
      hat: [], hatB: ['xoxoxoxoxoxoxoxo'], ohat: [], shk: ['x.xox.xox.xox.xo'],
    },
    perc: [
      { v: 'tomHi', pat: '..x..x....x..x..', stem: 'drums', vol: 0.75 },
      { v: 'tomMid', pat: '.....o..x.....o.', stem: 'perc', vol: 0.8 },
      { v: 'tomLo', pat: '....x.......x..x', stem: 'perc', vol: 0.8 },
    ],
    fill: 'tom',
    bass: { logdrum: true, vol: 0.62, A: '0--0----0--0-7--', B: '0--0-0--0-0-0-7-' },
    harm: { pad: { wave: 'triangle', det: 0, cut0: 900, cut1: 1100, a: 0.12, r: 0.4, vol: 0.105 }, stab: null },
    arp: { inst: 'marimba', mode: 'scale', base: 62, A: '5..7..8.7..6..5.', B: '5.7.8.7.9.8.7.6.', oct: 0, vol: 0.22 },
    leadP: { inst: 'flute', vol: 0.11, dly: 0.3, rev: 0.3 },
    fx: { snrRev: 0.12, harmRev: 0.2, arpRev: 0.2, arpDly: 0.18 },
  },
  frost: {
    mix: { drums: 1.18, bass: 0.37, harm: 1.34, arp: 0.74, lead: 0.82, perc: 1 },
    key: 5, scale: 'lydian', bossScale: 'harmMinor', swing: 0, trim: 1.07,
    bpm: { run: 140, lobby: 106, boss: 160, plane: 148 },
    prog: [[0, 'M7'], [2, 'M'], [4, 'm7'], [2, 'M'], [0, 'M7'], [2, 'M'], [9, 'm7'], [7, 'M']],
    leadBase: 65,
    lead: ['b--97-9-b-d-c---', 'a--8a-c-d-c-a---', '9--bd--b9-b-d-f-', 'f--dc-a-8-a-c---',
           'e--bd-c-b-9-b---', 'd--ac-a-8-a-c-d-', 'c--9b-9-7-9-b-c-', 'd--b8-b-d-f-d---'],
    kick: 'soft', snare: 'snap',
    drums: {
      kick: ['X...X...X...X...', 'X...X...X..xX...'],
      snare: ['....X.......X...'], clap: [],
      hat: ['x.x.x.x.x.x.x.x.'], hatB: ['xoxoxoxoxoxoxoxo'], ohat: ['.o.o.o.o.o.o.o.o'],
    },
    perc: [],
    fill: 'bells',
    bass: { wave: 'triangle', cut: 650, env: 2.0, dec: 0.12, q: 1, vol: 0.55, sub: 0.7, A: '0--0--c-0--0--7-', B: '0-0-0-0-0-0-0-c-' },
    harm: { pad: { wave: 'triangle', det: 0, cut0: 2200, cut1: 3600, a: 0.22, r: 0.45, vol: 0.085, shimmer: 0.3 }, stab: null },
    arp: { inst: 'glock', mode: 'chord', A: '0.1.2.3.4.5.4.3.', B: '0123456765432101', oct: 0, vol: 0.16 },
    leadP: { inst: 'bell', vol: 0.22, dly: 0.5, rev: 0.45 },
    fx: { snrRev: 0.2, harmRev: 0.28, arpRev: 0.3, arpDly: 0.35 },
  },
  dunes: {
    mix: { drums: 1.34, bass: 0.43, harm: 1.38, arp: 2.7, lead: 1.8, perc: 3 },
    key: 2, scale: 'hijaz', bossScale: 'hijaz', swing: 0.04, trim: 1.16,
    bpm: { run: 144, lobby: 108, boss: 160, plane: 150 },
    prog: [[0, 'M'], [1, 'M'], [0, 'M'], [5, 'm'], [0, 'M'], [1, 'M'], [5, 'm'], [7, '5']],
    leadBase: 62,
    lead: ['7--89--ab-a98-7-', '8--ac--ba-8-8...', '9--be--dc-b-9-8-', 'a--ce--ca-9-a---',
           '7--89--be-d-b-9-', '8--ac--ed-c-a-8-', 'e--ca-c-e-d-c-a-', 'b--9a-9-b-9-8-7-'],
    kick: 'dum', snare: 'clap',
    drums: {
      kick: ['X.......X...x...', 'X.......X.......'],
      snare: [], clap: ['....x.......x...'],
      hat: [], hatB: ['xoxoxoxoxoxoxoxo'], ohat: [], shk: ['x.xox.xox.xox.xo'],
    },
    perc: [
      { v: 'tek', pat: '..X...X.....X...', stem: 'drums', vol: 0.8 },
      { v: 'ka', pat: '....o.....o...o.', stem: 'perc', vol: 0.8 },
      { v: 'tek', pat: '.o....o.o.....o.', stem: 'perc', vol: 0.5 },
    ],
    fill: 'darbuka',
    bass: { wave: 'sawtooth', cut: 600, env: 2.6, dec: 0.14, q: 3, vol: 0.5, sub: 0.7, A: '0----.0-0----.c-', B: '0-0-0-0-0-0-0-c-' },
    harm: { pad: { wave: 'sawtooth', det: 9, cut0: 900, cut1: 1700, a: 0.14, r: 0.4, vol: 0.045 }, stab: { kind: 'ks', inst: 'oud', pat: 'x.....x...x.....', vol: 0.6 } },
    arp: { inst: 'oud', mode: 'chord', A: '0.1.2.1.0.1.2.3.', B: '0.1.2.3.2.1.2.3.', oct: 0, vol: 0.2 },
    leadP: { inst: 'ney', vol: 0.1, dly: 0.28, rev: 0.28 },
    fx: { snrRev: 0.14, harmRev: 0.2, arpRev: 0.18, arpDly: 0.2 },
  },
};

// Generic boss material: power chords + dark riff in the world's key (harmonic minor, hijaz for dunes).
const BOSS = {
  prog: [[0, '5'], [0, '5'], [8, '5'], [7, '5'], [0, '5'], [5, '5'], [8, '5'], [7, '5']],
  lead: ['7-7-9-7-b-9-7-6.', '7-7-9-7-b-a-b-d-', 'c-c-e-c-9-c-b-9-', 'b-b-d-b-8-b-a-8-',
         '7-7-9-b-e-d-b-9-', 'a-a-c-a-7-a-9-7-', 'c-c-e-c-b-c-9-c-', 'b-b-d-b-d-e-d-b-'],
  bass: ['0-00-0c00-00-0c0', '0-00-0c00-1-0-7-'],
  stab: 'X..X..X.X..X.X..',
  drums: {
    kick: ['X...X...X.x.X..x', 'X...X..xX...X.x.'],
    snare: ['....X.......X.o.'], clap: [],
    hat: ['xoxoxoxoxoxoxoxo'], hatB: ['xxxxxxxxxxxxxxxx'], ohat: ['..x...x...x...x.'],
  },
};
const LOBBY = {
  bass: '0-------0-------',
  drums: { kick: ['X.......x.......'], snare: [], clap: [], hat: ['..o...o...o...o.'], hatB: ['..o...o...o...o.'], ohat: [] , shk: ['o.o.o.o.o.o.o.o.']},
};
const PLANE = {
  bass: '0-0-0-0-0-0-0-0-',
  drums: { kick: ['X...X...X...X...'], snare: [], clap: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'], hatB: ['xoxoxoxoxoxoxoxo'], ohat: ['..x...x...x...x.'] },
};

// ---- parsing helpers
function degOf(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 122) return c - 87;
  if (c >= 65 && c <= 90) return -(c - 64);
  return 0;
}
function parseSeq(str, conv) {
  const out = new Array(16).fill(null);
  for (let i = 0; i < 16; i++) {
    const ch = str[i];
    if (ch === undefined || ch === '.' || ch === '-') continue;
    let len = 1;
    while (i + len < 16 && str[i + len] === '-') len++;
    out[i] = { v: conv(ch), len };
  }
  return out;
}
const VEL = { X: 1, x: 0.72, o: 0.4 };
function parseVel(str) { const a = new Array(16).fill(0); for (let i = 0; i < 16; i++) a[i] = VEL[str[i]] || 0; return a; }
function parseDrums(D) {
  const P = (arr) => (arr && arr.length ? arr.map(parseVel) : null);
  return { kick: P(D.kick), snare: P(D.snare), clap: P(D.clap), hat: P(D.hat), hatB: P(D.hatB), ohat: P(D.ohat), shk: P(D.shk) };
}

// Close-position voice leading: choose the inversion nearest to the previous chord.
function voiceChord(rootPc, ivs, prev) {
  let best = null, bestCost = 1e9;
  const n = ivs.length;
  for (let rot = 0; rot < n; rot++) {
    for (let base = 52; base < 66; base++) {
      if ((((base - rootPc - ivs[rot]) % 12) + 12) % 12 !== 0) continue;
      const notes = [base];
      for (let k = 1; k < n; k++) {
        const pc = (rootPc + ivs[(rot + k) % n]) % 12;
        let m = notes[k - 1] + 1;
        while (m % 12 !== pc) m++;
        notes.push(m);
      }
      if (notes[n - 1] > 80) continue;
      let cost = 0;
      for (let k = 0; k < Math.min(n, prev.length); k++) cost += Math.abs(notes[k] - prev[k]);
      let avg = 0;
      for (let k = 0; k < n; k++) avg += notes[k];
      cost += Math.abs(avg / n - 64) * 0.6 + (notes[n - 1] - notes[0] > 14 ? 8 : 0);
      for (let k = 1; k < n; k++) { const iv = notes[k] - notes[k - 1]; if (iv === 1) cost += 12; else if (iv === 2) cost += 4; }
      if (cost < bestCost) { bestCost = cost; best = notes; }
    }
  }
  return best || prev;
}

function degMidi(scale, base, d) {
  const n = scale.length, oct = Math.floor(d / n);
  return base + 12 * oct + scale[d - oct * n];
}

function buildMat(keyPc, scaleArr, prog, leadStrs, leadBase) {
  const chords = [];
  let prev = [60, 64, 67];
  for (const [off, q] of prog) {
    const rootPc = (keyPc + off) % 12;
    const ivs = QUAL[q];
    const notes = voiceChord(rootPc, ivs, prev);
    prev = notes;
    chords.push({ root: 36 + rootPc, notes, n: ivs.length });
  }
  const lead = leadStrs.map((s) => parseSeq(s, degOf).map((e) => (e ? { midi: degMidi(scaleArr, leadBase, e.v), len: e.len } : null)));
  return { chords, lead, scale: scaleArr };
}

function prepWorld(W) {
  if (W._ready) return;
  W._ready = true;
  W._run = buildMat(W.key, SC[W.scale], W.prog, W.lead, W.leadBase);
  W._boss = buildMat(W.key, SC[W.bossScale], BOSS.prog, BOSS.lead, 60 + W.key);
  W._D = parseDrums(W.drums);
  W._Dboss = parseDrums(BOSS.drums);
  W._Dlobby = parseDrums(LOBBY.drums);
  W._Dplane = parseDrums(PLANE.drums);
  const bs = (str) => parseSeq(str, (ch) => BASS_MAP[ch] || 0);
  if (W.bass.A) { W._bA = bs(W.bass.A); W._bB = bs(W.bass.B); }
  W._bBoss = BOSS.bass.map(bs);
  W._bLobby = bs(LOBBY.bass);
  W._bPlane = bs(PLANE.bass);
  W._bossStab = parseVel(BOSS.stab);
  W._arpA = parseSeq(W.arp.A, degOf);
  W._arpB = parseSeq(W.arp.B, degOf);
  W._stab = W.harm.stab ? parseVel(W.harm.stab.pat) : null;
  W._perc = W.perc.map((p) => ({ ...p, vel: parseVel(p.pat) }));
}

// ============================================================ engine state
let ctx = null, G = null, kit = null, offline = false;
let sfxOn = true, musicOn = true;
let mode = null, pend = null, lastWorld = 'harbor';
let tr = null;                      // current track
let iT = 0.2, iC = 0.2;             // intensity target / smoothed
let muffleT = 0, uwT = false;
let engWant = null, eng = null, jetWant = false, jetNode = null;
let timer = 0, lastTick = 0, bubbleAt = 0, engAt = 0, coinStreak = 0, lastCoin = 0, warned = false;
const lastPlay = {};
let curBus = null, curWet = null;   // per-effect level buses (see SFX_TRIM)
const sxCache = {};
const noteCache = new Map();

// ============================================================ graph
function build(c, isOffline) {
  teardown();
  ctx = c; offline = !!isOffline;
  const g = (G = {});
  const mk = (v) => { const n = c.createGain(); n.gain.value = v; return n; };
  const bq = (type, f, q) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };

  g.mixIn = mk(1);
  g.pre = mk(1);
  g.mixIn.connect(g.pre);
  // helmet: soft distortion (parallel) + short resonant comb ("inside a helmet")
  g.shaper = c.createWaveShaper(); g.shaper.curve = distCurve(2.5);
  g.distWet = mk(0);
  g.mixIn.connect(g.shaper); g.shaper.connect(g.distWet); g.distWet.connect(g.pre);
  g.comb = c.createDelay(0.05); g.comb.delayTime.value = 0.0068;
  g.combFb = mk(0.32); g.combWet = mk(0);
  g.pre.connect(g.comb); g.comb.connect(g.combFb); g.combFb.connect(g.comb); g.comb.connect(g.combWet);
  g.lp1 = bq('lowpass', 19000, 0.7); g.lp2 = bq('lowpass', 19000, 0.7);
  g.pre.connect(g.lp1); g.combWet.connect(g.lp1); g.lp1.connect(g.lp2);
  g.muffGain = mk(1); g.lp2.connect(g.muffGain);
  // underwater: low-pass with two wobbling LFOs
  g.uwLP = bq('lowpass', 19000, 0.7); g.muffGain.connect(g.uwLP);
  g.uwL1 = c.createOscillator(); g.uwL1.frequency.value = 0.9; g.uwA1 = mk(0); g.uwL1.connect(g.uwA1); g.uwA1.connect(g.uwLP.detune); g.uwL1.start();
  g.uwL2 = c.createOscillator(); g.uwL2.frequency.value = 3.3; g.uwA2 = mk(0); g.uwL2.connect(g.uwA2); g.uwA2.connect(g.uwLP.detune); g.uwL2.start();
  g.uwGain = mk(1); g.uwLP.connect(g.uwGain);
  g.post = mk(1); g.uwGain.connect(g.post);
  // dynamics: glue compressor -> limiter -> soft clip
  g.comp = c.createDynamicsCompressor();
  g.comp.threshold.value = -9; g.comp.knee.value = 6; g.comp.ratio.value = 2.5; g.comp.attack.value = 0.005; g.comp.release.value = 0.15;
  g.lim = c.createDynamicsCompressor();
  g.lim.threshold.value = -3; g.lim.knee.value = 0; g.lim.ratio.value = 20; g.lim.attack.value = 0.001; g.lim.release.value = 0.06;
  g.out = mk(0.62);   // trims the compressor/limiter make-up gain (~ +3.4 dB) so quiet material is unity
  g.clip = c.createWaveShaper(); g.clip.curve = clipCurve();
  g.analyser = c.createAnalyser(); g.analyser.fftSize = 2048; g.analyser.smoothingTimeConstant = 0.4;
  g.post.connect(g.comp); g.comp.connect(g.lim); g.lim.connect(g.out); g.out.connect(g.clip); g.clip.connect(g.analyser); g.analyser.connect(c.destination);

  // shared effects returns
  g.revIn = mk(1); g.revHP = bq('highpass', 220, 0.7);
  g.rev = c.createConvolver(); g.rev.buffer = makeIR(c, 1.0);
  g.revOut = mk(0.55);
  g.revIn.connect(g.revHP); g.revHP.connect(g.rev); g.rev.connect(g.revOut); g.revOut.connect(g.mixIn);
  g.dlyIn = mk(1); g.dly = c.createDelay(1.5); g.dly.delayTime.value = 0.2;
  g.dlyLP = bq('lowpass', 3200, 0.5); g.dlyFb = mk(0.36); g.dlyOut = mk(0.7);
  g.dlyIn.connect(g.dly); g.dly.connect(g.dlyLP); g.dlyLP.connect(g.dlyFb); g.dlyFb.connect(g.dly); g.dlyLP.connect(g.dlyOut); g.dlyOut.connect(g.mixIn);

  // buses
  g.musicVol = mk(musicOn ? MUSIC_VOL : 0); g.musicVol.connect(g.mixIn);
  g.sfx = mk(sfxOn ? SFX_VOL : 0); g.sfx.connect(g.mixIn);
  g.sfxRev0 = mk(0.1); g.sfx.connect(g.sfxRev0); g.sfxRev0.connect(g.revIn);
  g.sfxWet = mk(1); g.sfxWet.connect(g.sfx);
  g.sfxRev1 = mk(0.4); g.sfxWet.connect(g.sfxRev1); g.sfxRev1.connect(g.revIn);
  g.dry = mk(1); g.dry.connect(g.post);   // post-filter tap (underwater bubbles)

  kit = bakeKit(c);
  noteCache.clear();
}

function teardown() {
  if (timer) { clearInterval(timer); timer = 0; }
  killLoops(true);
  tr = null;
  if (ctx && G && !offline) { try { ctx.close(); } catch (e) { /* ignore */ } }
  ctx = null; G = null; kit = null;
}

// ============================================================ voices (generic)
function hitBuf(bus, buf, t, vol, rate) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  if (rate && rate !== 1) s.playbackRate.value = rate;
  if (vol === undefined) { s.connect(bus); s.start(t); return; }   // level lives on a shared bus (saves a node per hit)
  const gn = ctx.createGain(); gn.gain.value = vol;
  s.connect(gn); gn.connect(bus); s.start(t);
}
function memb(bus, t, f0, f1, pt, dur, vol, type) {
  const o = ctx.createOscillator(), gn = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + pt);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(vol, t + 0.002); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn); gn.connect(bus); o.start(t); o.stop(t + dur + 0.02);
}
function getNote(inst, midi) {
  const key = inst + ':' + midi;
  let e = noteCache.get(key);
  if (e) return e;
  if (noteCache.size > 120) noteCache.clear();
  const sr = ctx.sampleRate, I = INST[inst], f0 = mtof(midi);
  if (I.ks) {
    const k = I.ks, r = bakeKS(sr, f0, k.t60, k.br, k.pick, k.lp, midi * 7 + 3);
    e = { b: toBuf(ctx, r.d, 0.9), r: r.rate };
  } else {
    e = { b: toBuf(ctx, bakeModal(sr, f0, I.modal.dur, I.modal.parts, I.modal.click, midi), 0.9), r: 1 };
  }
  noteCache.set(key, e);
  return e;
}
function sampleNote(bus, inst, t, midi, vol, rateMul) {
  const e = getNote(inst, midi), I = INST[inst];
  const s = ctx.createBufferSource();
  s.buffer = e.b; s.playbackRate.value = e.r * (rateMul || 1);
  const gn = ctx.createGain(); gn.gain.value = vol * I.vol;
  s.connect(gn); gn.connect(bus); s.start(t);
}
function vibCurve(dur, delay, cents, hz, base) {
  const n = Math.max(4, Math.ceil(dur * 40)), a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur;
    a[i] = base + (t > delay ? Math.sin((t - delay) * TAU * hz) * cents * Math.min(1, (t - delay) / 0.2) : 0);
  }
  return a;
}
function adsr(p, t, a, peak, hold, rel) {
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + a);
  const h = t + Math.max(a, hold);
  p.setValueAtTime(peak, h);
  p.exponentialRampToValueAtTime(0.0001, h + rel);
  return h + rel;
}

// ---- drums
const KICKS = {
  punch: { f0: 170, f1: 46, pt: 0.075, dur: 0.32, vol: 1.0, click: 0.32 },
  soft: { f0: 125, f1: 48, pt: 0.06, dur: 0.24, vol: 0.92, click: 0.14 },
  taiko: { f0: 135, f1: 50, pt: 0.11, dur: 0.46, vol: 1.0, click: 0.2 },
  dum: { f0: 150, f1: 58, pt: 0.05, dur: 0.28, vol: 0.96, click: 0.22 },
};
function vKick(tb, t, v, style) {
  const K = KICKS[style] || KICKS.punch;
  memb(tb.st.drums, t, K.f0, K.f1, K.pt, K.dur, K.vol * v);
  hitBuf(tb.clickG, kit.kclick, t);
}
function vSnare(tb, t, v, style) {
  const b = tb.snr;
  switch (style) {
    case 'clap': hitBuf(b, kit.clap, t, 0.62 * v); hitBuf(b, kit.snareN, t, 0.2 * v); break;
    case 'gated': hitBuf(b, kit.snareG, t, 0.58 * v); memb(b, t, 200, 125, 0.05, 0.12, 0.26 * v, 'triangle'); break;
    case 'rim': hitBuf(b, kit.rim, t, 0.5 * v); memb(b, t, 420, 260, 0.03, 0.08, 0.2 * v, 'triangle'); break;
    case 'snap': hitBuf(b, kit.clap, t, 0.5 * v, 1.25); hitBuf(b, kit.snareN, t, 0.14 * v, 1.2); break;
    default: hitBuf(b, kit.snareN, t, 0.55 * v); memb(b, t, 205, 130, 0.05, 0.12, 0.28 * v, 'triangle');
  }
}
const PERC = {
  tomHi: (b, t, v) => { memb(b, t, 270, 175, 0.08, 0.28, 0.5 * v); hitBuf(b, kit.kclick, t, 0.12 * v); },
  tomMid: (b, t, v) => { memb(b, t, 195, 128, 0.09, 0.33, 0.55 * v); hitBuf(b, kit.kclick, t, 0.12 * v); },
  tomLo: (b, t, v) => { memb(b, t, 140, 84, 0.1, 0.42, 0.6 * v); hitBuf(b, kit.kclick, t, 0.14 * v); },
  congaHi: (b, t, v) => { memb(b, t, 430, 340, 0.045, 0.2, 0.42 * v); hitBuf(b, kit.rim, t, 0.1 * v, 0.7); },
  congaLo: (b, t, v) => { memb(b, t, 310, 235, 0.06, 0.28, 0.48 * v); hitBuf(b, kit.rim, t, 0.08 * v, 0.55); },
  tek: (b, t, v) => hitBuf(b, kit.tek, t, 0.55 * v),
  ka: (b, t, v) => hitBuf(b, kit.tek, t, 0.34 * v, 1.22),
};

function vCrash(tb, t, v) { hitBuf(tb.snr, kit.crash, t, v); }
function vRiser(tb, t, dur, v) {
  const c = ctx, s = c.createBufferSource();
  s.buffer = kit.noise; s.loop = true;
  const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 1.3;
  fl.frequency.setValueAtTime(350, t); fl.frequency.exponentialRampToValueAtTime(7500, t + dur);
  const gn = c.createGain();
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.5 * v, t + dur - 0.02);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.015);
  s.connect(fl); fl.connect(gn); gn.connect(tb.snr); s.start(t, 0.1); s.stop(t + dur + 0.03);
  // pitched sweep underneath
  const o = c.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(1500, t + dur);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.1 * v, t + dur - 0.02); g2.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.015);
  o.connect(lp); lp.connect(g2); g2.connect(tb.st.drums); o.start(t); o.stop(t + dur + 0.03);
}
function duck(tb, t, amt, depthB, depthH) {
  const b = tb.duckB.gain, h = tb.duckH.gain;
  // ~3 ms attack (no clicks on a sounding bass), then a pumping release that breathes back in
  b.setTargetAtTime(1 - depthB * amt, t - 0.003, 0.0022); b.setTargetAtTime(1, t + 0.02, 0.075);
  h.setTargetAtTime(1 - depthH * amt, t - 0.003, 0.0022); h.setTargetAtTime(1, t + 0.02, 0.08);
}

// ---- bass
const waveCache = {};
function getWave(kind, sub) {
  const key = kind + ':' + sub;
  if (waveCache[key] && waveCache[key].c === ctx) return waveCache[key].w;
  const n = 40, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    if (kind === 'sawtooth') im[k] = 1 / k;
    else if (kind === 'square') im[k] = k & 1 ? 1 / k : 0;
    else if (kind === 'triangle') im[k] = k & 1 ? ((k & 3) === 1 ? 1 : -1) / (k * k) : 0;
    else if (kind === 'pop') im[k] = (1 / k) * 0.5 + (k & 1 ? 0.5 / k : 0);
    else if (kind === 'siren') im[k] = (1 / k) * 0.6 + (k & 1 ? 0.4 / k : 0);
    else if (kind === 'flute') im[k] = k === 1 ? 1 : k === 2 ? 0.16 : k === 3 ? 0.05 : 0;
    else if (kind === 'ney') im[k] = k === 1 ? 1 : k === 2 ? 0.1 : k === 3 ? 0.32 : k === 5 ? 0.12 : 0;
  }
  im[1] += sub || 0;
  const w = ctx.createPeriodicWave(re, im);
  waveCache[key] = { c: ctx, w };
  return w;
}
function bassNote(bus, t, midi, dur, vel, P) {
  const c = ctx, f = mtof(midi), gn = c.createGain();
  const hold = Math.max(0.03, dur - 0.03);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(P.vol * vel, t + 0.006);
  gn.gain.setValueAtTime(P.vol * vel, t + hold); gn.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.05);
  const stopT = t + hold + 0.08;
  if (P.logdrum) {
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.7, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(f * 3.4, t); o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.05);
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.02, t + 0.18);
    o.connect(gn); o2.connect(g2); g2.connect(gn);
    o.start(t); o.stop(stopT); o2.start(t); o2.stop(stopT);
  } else {
    const o = c.createOscillator(); o.setPeriodicWave(getWave(P.wave, P.sub)); o.frequency.value = f;   // saw + boosted fundamental in ONE oscillator
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = P.q;
    fl.frequency.setValueAtTime(P.cut * P.env, t); fl.frequency.exponentialRampToValueAtTime(P.cut, t + P.dec);
    o.connect(fl); fl.connect(gn); o.start(t); o.stop(stopT);
  }
  gn.connect(bus);
}

// ---- harmony
function padVoice(bus, t, notes, dur, vel, P) {
  const c = ctx, fl = c.createBiquadFilter(), gn = c.createGain();
  fl.type = 'lowpass'; fl.Q.value = 0.8;
  fl.frequency.setValueAtTime(P.cut0, t); fl.frequency.linearRampToValueAtTime(P.cut1, t + dur * 0.85);
  const per = 1 / Math.sqrt(notes.length);
  const end = adsr(gn.gain, t, P.a, P.vol * vel * per * 1.6, dur - 0.05, P.r);
  for (let i = 0; i < notes.length; i++) {
    const f = mtof(notes[i]);
    const ds = P.det ? [-P.det, P.det] : [0];
    for (let k = 0; k < ds.length; k++) {
      const o = c.createOscillator(); o.type = P.wave; o.frequency.value = f; o.detune.value = ds[k];
      o.connect(fl); o.start(t); o.stop(end + 0.05);
    }
    if (P.shimmer) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * 2;
      const sg = c.createGain(); sg.gain.value = P.shimmer;
      o.connect(sg); sg.connect(fl); o.start(t); o.stop(end + 0.05);
    }
  }
  fl.connect(gn); gn.connect(bus);
}
function sawStab(bus, t, notes, dur, vel, P) {
  const c = ctx, fl = c.createBiquadFilter(), gn = c.createGain();
  fl.type = 'lowpass'; fl.Q.value = 1;
  fl.frequency.setValueAtTime(P.cut * P.env, t); fl.frequency.exponentialRampToValueAtTime(P.cut, t + 0.14);
  const per = P.vol * vel / Math.sqrt(notes.length);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(per * 1.5, t + 0.004); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (let i = 0; i < notes.length; i++) {
    const o = c.createOscillator(); o.type = P.wave; o.frequency.value = mtof(notes[i]);
    o.connect(fl); o.start(t); o.stop(t + dur + 0.03);
  }
  fl.connect(gn); gn.connect(bus);
}
function strum(bus, inst, t, notes, vel, vol) {
  for (let i = 0; i < notes.length; i++) sampleNote(bus, inst, t + i * 0.011, notes[i], vol * vel / Math.sqrt(notes.length) * 1.4);
}

// ---- lead / arp synth notes
function leadSynth(bus, inst, t, midi, dur, vel, P) {
  const c = ctx, f = mtof(midi), fl = c.createBiquadFilter(), gn = c.createGain();
  fl.type = 'lowpass'; fl.Q.value = 1;
  const vib = dur > 0.3;
  let a = 0.008, rel = 0.09, cut = P.cut || 3600, dets = [-7, 7], wave = 'pop';
  if (inst === 'saw') { wave = 'sawtooth'; dets = [-9, 9]; }
  else if (inst === 'siren') { wave = 'siren'; dets = [-8, 8]; }
  else if (inst === 'flute') { a = 0.045; rel = 0.12; wave = 'flute'; dets = [0]; cut = 3500; }
  else if (inst === 'ney') { a = 0.035; rel = 0.12; wave = 'ney'; dets = [0]; cut = 4200; }
  if (inst === 'saw') { fl.frequency.setValueAtTime(cut * 1.6, t); fl.frequency.exponentialRampToValueAtTime(cut, t + 0.12); }
  else fl.frequency.value = cut;
  const end = adsr(gn.gain, t, a, P.vol * vel * (dets.length > 1 ? 0.75 : 1), dur * 0.88, rel);
  const vcents = inst === 'flute' ? 22 : inst === 'ney' ? 30 : 16, vhz = inst === 'ney' ? 5.3 : 5.6;
  const w = getWave(wave, 0);
  for (let i = 0; i < dets.length; i++) {
    const o = c.createOscillator();
    if (wave === 'sawtooth') o.type = 'sawtooth'; else o.setPeriodicWave(w);
    o.frequency.value = f;
    if (vib) { const d = Math.min(end - t, 4); o.detune.setValueCurveAtTime(vibCurve(d, 0.14, vcents, vhz, dets[i]), t, d); }
    else o.detune.value = dets[i];
    o.connect(fl); o.start(t); o.stop(end + 0.04);
  }
  if (inst === 'flute' || inst === 'ney') { // breath noise
    const s = c.createBufferSource(); s.buffer = kit.noise; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, f * 3); bp.Q.value = 1.5;
    const ng = c.createGain(); adsr(ng.gain, t, a * 0.6, 0.05 * vel * (inst === 'ney' ? 1.4 : 1), dur * 0.7, rel);
    s.connect(bp); bp.connect(ng); ng.connect(gn); s.start(t, 0.3); s.stop(end + 0.04);
  }
  fl.connect(gn); gn.connect(bus);
}
function sawPluck(bus, t, midi, vel, P) {
  const c = ctx, o = c.createOscillator(), fl = c.createBiquadFilter(), gn = c.createGain();
  o.type = 'sawtooth'; o.frequency.value = mtof(midi);
  fl.type = 'lowpass'; fl.Q.value = 3;
  fl.frequency.setValueAtTime(P.cut * 1.8, t); fl.frequency.exponentialRampToValueAtTime(P.cut * 0.3, t + 0.14);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(P.vol * vel, t + 0.003); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(fl); fl.connect(gn); gn.connect(bus); o.start(t); o.stop(t + 0.23);
}

function playLead(tb, t, L, vel, spb, md) {
  const P = md === 'boss' ? BOSS_LEAD : tb.W.leadP, bus = tb.st.lead;
  const dur = L.len * spb;
  const inst = P.inst;
  if (inst === 'steel' || inst === 'bell') {
    sampleNote(bus, inst, t, L.midi, P.vol * vel);
    if (L.len >= 4 && inst === 'steel') sampleNote(bus, inst, t + spb * 2, L.midi, P.vol * vel * 0.55);  // pan roll
  } else if (inst === 'ney') {
    if (L.len <= 2) sampleNote(bus, 'oud', t, L.midi, 0.42 * vel);
    else { leadSynth(bus, 'ney', t, L.midi, dur, vel, P); sampleNote(bus, 'oud', t, L.midi, 0.26 * vel); }
  } else leadSynth(bus, inst, t, L.midi, dur, vel, P);
}
const BOSS_LEAD = { inst: 'siren', cut: 3200, vol: 0.075 };

function playArp(tb, t, ev, ch, spb, md, vel) {
  const W = tb.W, A = W.arp;
  let midi;
  if (md === 'boss' || A.mode === 'chord') {
    const tones = ch.notes.concat(ch.notes.map((m) => m + 12));
    midi = tones[ev.v % tones.length] + (md === 'boss' ? 12 : A.oct);
  } else midi = degMidi(SC[W.scale], A.base, ev.v);
  if (A.inst === 'sawpluck') sawPluck(tb.st.arp, t, midi, vel, A);
  else sampleNote(tb.st.arp, A.inst, t, midi, A.vol * vel);
}

// ============================================================ sequencer
function bpmFor(W, md) {
  switch (md) {
    case 'lobby': return W.bpm.lobby;
    case 'map': return W.bpm.lobby * 0.88;
    case 'boss': return W.bpm.boss;
    case 'plane': return W.bpm.plane;
    default: return W.bpm.run;
  }
}
const normMode = (m) => (m === 'water' ? 'run' : (m === 'run' || m === 'lobby' || m === 'boss' || m === 'plane' || m === 'map' ? m : 'run'));

function newTrack(wid, md0, startAt) {
  const c = ctx, W = DEFS[wid] || DEFS.harbor;
  prepWorld(W);
  const md = normMode(md0);
  const now = c.currentTime;
  const mk = (v) => { const n = c.createGain(); n.gain.value = v; return n; };
  const tb = {
    wid, W, mode: md, bar: 0, s: 0, cyc: 0, bpm: bpmFor(W, md), pend: null,
    t0: startAt, nextT: startAt, e: 0.3, lv: {}, rng: rngf(4242), nodes: [], age0: startAt, crashNext: true,
  };
  setMat(tb, md);
  tb.out = mk(0.0001);
  tb.out.gain.setValueAtTime(0.0001, now); tb.out.gain.linearRampToValueAtTime(W.trim, now + 0.25);
  tb.out.connect(G.musicVol);
  tb.st = {};
  tb.duckB = mk(1); tb.duckH = mk(1);
  tb.duckB.connect(tb.out); tb.duckH.connect(tb.out);
  for (const k of ['drums', 'bass', 'harm', 'arp', 'lead', 'perc']) { tb.st[k] = mk(0); tb.nodes.push(tb.st[k]); }
  tb.st.drums.connect(tb.out); tb.st.perc.connect(tb.out); tb.st.lead.connect(tb.out);
  tb.st.bass.connect(tb.duckB); tb.st.harm.connect(tb.duckH); tb.st.arp.connect(tb.duckH);
  tb.snr = mk(1); tb.snr.connect(tb.st.drums);
  // shared level buses for the high-rate hits (one node per hit instead of two)
  tb.hatG = [1, 0.72, 0.4].map((v) => { const n = mk(0.34 * v); n.connect(tb.st.drums); tb.nodes.push(n); return n; });
  tb.shkG = [1, 0.72, 0.4].map((v) => { const n = mk(0.3 * v); n.connect(tb.st.drums); tb.nodes.push(n); return n; });
  tb.ohG = mk(0.28); tb.ohG.connect(tb.st.drums); tb.nodes.push(tb.ohG);
  tb.clickG = mk((KICKS[W.kick] || KICKS.punch).click); tb.clickG.connect(tb.st.drums); tb.nodes.push(tb.clickG);
  const send = (src, dst, v) => { const s = mk(v); src.connect(s); s.connect(dst); tb.nodes.push(s); };
  send(tb.snr, G.revIn, W.fx.snrRev);
  send(tb.st.harm, G.revIn, W.fx.harmRev);
  send(tb.st.arp, G.revIn, W.fx.arpRev); send(tb.st.arp, G.dlyIn, W.fx.arpDly);
  send(tb.st.lead, G.revIn, W.leadP.rev); send(tb.st.lead, G.dlyIn, W.leadP.dly);
  tb.nodes.push(tb.out, tb.duckB, tb.duckH, tb.snr);
  G.dly.delayTime.setTargetAtTime(Math.min(1.4, 60 / tb.bpm * 0.75), now, 0.05);
  updateStems(tb, now, true);
  return tb;
}
function setMat(tb, md) {
  const W = tb.W;
  tb.mode = md;
  tb.M = md === 'boss' ? W._boss : W._run;
  tb.D = md === 'boss' ? W._Dboss : md === 'lobby' || md === 'map' ? W._Dlobby : md === 'plane' ? W._Dplane : W._D;
  tb.bpm = bpmFor(W, md);
}
function disposeTrack(tb, fade) {
  if (!tb || tb.dead) return;
  tb.dead = true;
  const now = ctx.currentTime;
  tb.out.gain.cancelScheduledValues(now);
  tb.out.gain.setValueAtTime(Math.max(0.0001, tb.out.gain.value), now);
  tb.out.gain.setTargetAtTime(0, now, fade / 4);
  const kill = () => { tb.nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* ignore */ } }); };
  if (offline) return;
  setTimeout(kill, fade * 1000 + 400);
}

// effective intensity per mode
function effIntensity(tb, now) {
  const age = Math.max(0, now - tb.age0);
  switch (tb.mode) {
    case 'boss': return clamp(0.62 + 0.38 * iC, 0, 1);
    case 'plane': return clamp(0.5 + 0.5 * iC, 0, 1);
    case 'lobby': case 'map': return 0.45;
    default: return clamp(iC * 0.9 + 0.3 * smooth(0, 50, age), 0, 1);
  }
}
function stemTargets(md, e) {
  switch (md) {
    case 'boss': return { drums: 1, bass: 1, harm: 1, arp: smooth(0.15, 0.3, e) * 0.9, lead: 1, perc: smooth(0.7, 0.85, e) };
    case 'plane': return { drums: 1, bass: 1, harm: 1, arp: 1, lead: smooth(0.3, 0.45, e), perc: smooth(0.62, 0.8, e) };
    case 'lobby': return { drums: 0.8, bass: 0.85, harm: 1, arp: 0.8, lead: 0.9, perc: 0 };
    case 'map': return { drums: 0, bass: 0.35, harm: 1, arp: 0.9, lead: 0.85, perc: 0 };
    default: return { drums: 1, bass: 1, harm: smooth(0.07, 0.2, e), arp: smooth(0.26, 0.4, e), lead: smooth(0.44, 0.58, e), perc: smooth(0.64, 0.78, e) };
  }
}
function updateStems(tb, now, init) {
  tb.e = effIntensity(tb, now);
  const T = stemTargets(tb.mode, tb.e);
  const mx = tb.W.mix;
  for (const k in T) {
    if (init) { tb.st[k].gain.value = T[k] * mx[k]; tb.lv[k] = T[k]; continue; }
    if (Math.abs(T[k] - (tb.lv[k] || 0)) > 0.004) { tb.lv[k] = T[k]; tb.st[k].gain.setTargetAtTime(T[k] * mx[k], now, 0.3); }
  }
}

function advance(tb, spb) {
  tb.nextT += spb;
  tb.s++;
  if (tb.s === 16) { tb.s = 0; tb.bar++; if (tb.bar === 8) { tb.bar = 0; tb.cyc++; } }
}

function pumpTrack(tb, until) {
  const now = ctx.currentTime;
  let guard = 0;
  while (tb.nextT < until && guard++ < 400) {
    if (tb.s === 0 && tb.pend) {
      setMat(tb, tb.pend); tb.pend = null; tb.bar = 0; tb.cyc = 0; tb.crashNext = true;
      tb.age0 = Math.min(tb.age0, tb.nextT);
      G.dly.delayTime.setTargetAtTime(Math.min(1.4, 60 / tb.bpm * 0.75), tb.nextT, 0.04);
    }
    const spb = 60 / tb.bpm / 4;
    if (tb.nextT < now - 0.02) { advance(tb, spb); continue; }   // fell behind (tab throttled): skip, keep grid
    stepEvents(tb, tb.nextT, spb);
    advance(tb, spb);
  }
}

function stepEvents(tb, t0, spb) {
  const W = tb.W, md = tb.mode, M = tb.M, D = tb.D, bar = tb.bar, s = tb.s, cyc = tb.cyc, lv = tb.lv, e = tb.e;
  const isBoss = md === 'boss', isPlane = md === 'plane', isLobby = md === 'lobby', isMap = md === 'map';
  const calm = isLobby || isMap;
  const t = t0 + ((s & 1) ? W.swing * spb : 0);
  const ch = M.chords[bar];
  const fillBar = bar === 7, build = (cyc & 3) === 3 && bar >= 6;
  const gap = fillBar && !calm && ((cyc & 1) === 1 || build) && s >= 12;
  const dB = calm ? 0.25 : 0.55, dH = calm ? 0.1 : 0.3;
  const r = tb.rng;

  // ---------------- transitions and section markers
  if (s === 0) {
    if (tb.crashNext || (bar === 0 && cyc > 0)) {
      const big = tb.crashNext || (cyc & 3) === 0;
      if (!isMap) vCrash(tb, t0, calm ? 0.22 : big ? 0.5 : 0.36);
      if (!calm && (tb.crashNext || (cyc & 3) === 0)) memb(tb.st.drums, t0, 95, 30, 0.22, 0.8, 0.5);   // impact
      tb.crashNext = false;
    }
    if (!calm && fillBar && !(build)) vRiser(tb, t0, 16 * spb, (cyc & 1) ? 0.8 : 0.5);
    if (!calm && build && bar === 6) vRiser(tb, t0, 32 * spb, 1.0);
  }

  // ---------------- drums
  if (lv.drums > 0.03) {
    const noKick = gap || (build && bar === 7);
    const ki = (bar & 1) < D.kick.length ? bar & 1 : 0;
    const kv = D.kick && D.kick[ki][s];
    if (kv && !noKick) { vKick(tb, t0, kv * (calm ? 0.7 : 1), W.kick); duck(tb, t0, kv, dB, dH); }
    // snare / clap (backbeat) – replaced by the roll in fill bars
    const rollFrom = build && bar === 7 ? 4 : 8;
    const inRoll = fillBar && !calm && s >= rollFrom;
    const sv = D.snare && D.snare[0][s];
    const sStyle = isBoss ? (W.snare === 'rim' ? 'rim' : W.snare === 'clap' ? 'clap' : 'snare') : isPlane ? 'clap' : W.snare;
    if (!inRoll) {
      if (sv) vSnare(tb, t0, sv, sStyle);
      const cv = D.clap && D.clap[0][s];
      if (cv) hitBuf(tb.snr, kit.clap, t0, 0.5 * cv * (isLobby ? 0.6 : 1));
    } else {
      const ev8 = (s & 1) === 0;
      if (s >= 12 || ev8) {
        const v = 0.28 + 0.72 * (s - rollFrom) / (15 - rollFrom);
        fillHit(tb, t, v, W.fill || 'snare', s, sStyle);
      }
    }
    // mini fill at the end of every 4th bar
    if (!calm && bar === 3 && s >= 14) fillHit(tb, t, s === 14 ? 0.55 : 0.8, W.fill === 'tom' || W.fill === 'conga' ? W.fill : 'snare', s, sStyle);
    // hats
    const dense = isBoss || isPlane || e > 0.55;
    const hp = (dense && D.hatB ? D.hatB : D.hat);
    const hv = hp && hp[0][s];
    if (hv && !(gap && s >= 14)) hitBuf(tb.hatG[hv > 0.9 ? 0 : hv > 0.6 ? 1 : 2], kit.hatC, t, undefined, calm ? 0.96 : 1);
    const ov = D.ohat && D.ohat[0][s];
    if (ov && !calm) hitBuf(tb.ohG, kit.hatO, t);
    const sk = D.shk && D.shk[0][s];
    if (sk) hitBuf(tb.shkG[sk > 0.9 ? 0 : sk > 0.6 ? 1 : 2], kit.shaker, t);
    // the world's own shaker lane also drives the flight arrangement
    if (isPlane && W._D.shk) { const k2 = W._D.shk[0][s]; if (k2) hitBuf(tb.shkG[k2 > 0.9 ? 0 : k2 > 0.6 ? 1 : 2], kit.shaker, t); }
  }
  // world percussion
  if (!isMap) {
    for (let i = 0; i < W._perc.length; i++) {
      const p = W._perc[i], v = p.vel[s];
      if (!v) continue;
      if ((p.stem === 'drums' ? lv.drums : lv.perc) < 0.03) continue;
      if (calm && p.stem !== 'drums') continue;
      if (isBoss && p.stem === 'drums' && lv.drums < 0.03) continue;
      PERC[p.v](p.stem === 'drums' ? tb.st.drums : tb.st.perc, t, v * p.vol * (isLobby ? 0.5 : 1));
    }
  }

  // ---------------- bass
  if (lv.bass > 0.03 && !gap && !(build && bar === 7 && s >= 8)) {
    let pat;
    if (isBoss) pat = W._bBoss[bar & 1];
    else if (isLobby || isMap) pat = W._bLobby;
    else if (isPlane) pat = W._bPlane;
    else pat = e > 0.45 ? W._bB : W._bA;
    const ev = pat[s];
    if (ev) {
      const P = isBoss ? BASS_BOSS : isPlane ? BASS_PLANE : (isLobby || isMap) ? BASS_LOBBY : W.bass;
      bassNote(tb.st.bass, t0, ch.root + ev.v, ev.len * spb * 0.93, 1, P);
    }
  }

  // ---------------- harmony (pad + stabs)
  if (lv.harm > 0.03) {
    if (s === 0) {
      const P = W.harm.pad;
      const pv = (calm ? 1.35 : isPlane ? 1.2 : isBoss ? 0.0 : 1);
      if (pv > 0) padVoice(tb.st.harm, t0, ch.notes, 16 * spb * 0.97, pv, P);
    }
    if (isBoss) {
      const v = W._bossStab[s];
      if (v) sawStab(tb.st.harm, t0, ch.notes, spb * 2.2, v, { wave: 'sawtooth', cut: 1500, env: 4, vol: 0.1 });
    } else if (!calm && W._stab) {
      const v = W._stab[s];
      const S = W.harm.stab;
      if (v && !isPlane) {
        if (S.kind === 'saw') sawStab(tb.st.harm, t0, ch.notes, spb * 2.4, v, S);
        else strum(tb.st.harm, S.inst, t0, ch.notes, v, S.vol);
      }
    }
  }

  // ---------------- arp
  if (lv.arp > 0.03) {
    const dense = isBoss || isPlane || e > 0.62;
    const ev = (dense ? W._arpB : W._arpA)[s];
    if (ev && !gap) playArp(tb, t, ev, ch, spb, md, (isLobby || isMap ? 0.7 : 1) * (0.85 + 0.3 * (s % 4 === 0 ? 1 : 0.4)));
  }

  // ---------------- lead
  if (lv.lead > 0.03) {
    let L = M.lead[bar][s];
    if (L && !(gap && s >= 14)) {
      if ((cyc & 1) === 1 && bar >= 4 && L.midi + 12 <= 96 && !isBoss) L = { midi: L.midi + 12, len: L.len };
      playLead(tb, t, L, calm ? 0.8 : 1, spb, md);
    }
  }
}
const BASS_BOSS = { wave: 'sawtooth', cut: 520, env: 2.8, dec: 0.1, q: 5, vol: 0.5, sub: 0.7 };
const BASS_LOBBY = { wave: 'triangle', cut: 500, env: 1.5, dec: 0.1, q: 1, vol: 0.45, sub: 0.7 };
const BASS_PLANE = { wave: 'triangle', cut: 560, env: 1.6, dec: 0.1, q: 1, vol: 0.5, sub: 0.7 };
function fillHit(tb, t, v, kind, s, sStyle) {
  const W = tb.W, bus = tb.st.drums;
  if (kind === 'tom') {
    const names = ['tomHi', 'tomHi', 'tomMid', 'tomMid', 'tomMid', 'tomLo', 'tomLo', 'tomLo'];
    PERC[names[clamp(s - 8, 0, 7)]](bus, t, 0.9 * v);
    vSnare(tb, t, v * 0.3, sStyle);
  } else if (kind === 'conga') {
    PERC[s & 1 ? 'congaHi' : 'congaLo'](bus, t, v);
    vSnare(tb, t, v * 0.45, sStyle);
  } else if (kind === 'darbuka') {
    PERC[s & 1 ? 'ka' : 'tek'](bus, t, v * 1.2);
    if (s >= 12) vSnare(tb, t, v * 0.4, sStyle);
  } else if (kind === 'bells') {
    vSnare(tb, t, v * 0.8, sStyle);
    sampleNote(tb.st.lead, 'bell', t, degMidi(SC[W.scale], W.leadBase, 5 + clamp(s - 8, 0, 7)), 0.12 * v);
  } else vSnare(tb, t, v, sStyle);
}

// ============================================================ main tick
function tick() {
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    if (ctx.state !== 'running') { lastTick = now; return; }
    const dt = clamp(now - lastTick, 0, 0.3);
    lastTick = now;
    iC += (iT - iC) * (1 - Math.exp(-dt / (iT > iC ? 1.2 : 0.7)));
    if (tr) {
      if (musicOn) { updateStems(tr, now); pumpTrack(tr, now + LOOK); }
    }
    if (eng && now > engAt) { eng.upd(iC); engAt = now + 0.1; }
    if (uwT && now > bubbleAt) { ambientBubble(now); bubbleAt = now + 0.35 + Math.random() * 0.8; }
  } catch (err) {
    if (!warned) { warned = true; if (typeof console !== 'undefined') console.warn('[audio]', err); }
  }
}

// ============================================================ sound effects
function nz(dur, o) {
  o = o || {};
  const c = ctx, t = c.currentTime + 0.004 + (o.when || 0);
  const s = c.createBufferSource(); s.buffer = kit.noise; s.loop = dur > 2;
  const fl = c.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.Q.value = o.q === undefined ? 1 : o.q;
  fl.frequency.setValueAtTime(o.f || 1000, t);
  if (o.to) fl.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t + dur);
  const gn = c.createGain(), v = o.vol === undefined ? 0.2 : o.vol, a = o.a || 0.004;
  gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(v, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(gn); gn.connect(o.bus || curBus);
  s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.03);
}
function tn(f, dur, o) {
  o = o || {};
  const c = ctx, t = c.currentTime + 0.004 + (o.when || 0);
  const os = c.createOscillator(); os.type = o.type || 'sine';
  os.frequency.setValueAtTime(f, t);
  if (o.to) os.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.slideT || dur));
  const gn = c.createGain(), v = o.vol === undefined ? 0.2 : o.vol, a = o.a || 0.004;
  gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(v, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let last = os;
  if (o.lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; last.connect(fl); last = fl; }
  if (o.bp) { const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = o.bp; fl.Q.value = 3; last.connect(fl); last = fl; }
  last.connect(gn); gn.connect(o.bus || curBus);
  os.start(t); os.stop(t + dur + 0.03);
}
function chime(f, o) {
  o = o || {};
  const c = ctx, t = c.currentTime + 0.004 + (o.when || 0), dur = o.dur || 0.7;
  const s = c.createBufferSource(); s.buffer = kit.bell; s.playbackRate.value = f / 880;
  const gn = c.createGain(), v = o.vol === undefined ? 0.3 : o.vol;
  gn.gain.setValueAtTime(v, t); gn.gain.setValueAtTime(v, t + dur * 0.5); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(gn); gn.connect(o.bus || curBus); s.start(t); s.stop(t + dur + 0.03);
}
function brass(f, dur, vol, when, bus) {
  tn(f, dur, { type: 'sawtooth', vol, when, a: 0.025, lp: 2400, bus });
  tn(f * 1.005, dur, { type: 'square', vol: vol * 0.5, when, a: 0.03, lp: 1800, bus });
}
function bubbles(n, when, vol, bus) {
  for (let i = 0; i < n; i++) {
    const f = 380 + Math.random() * 600;
    tn(f, 0.08 + Math.random() * 0.05, { to: f * (1.5 + Math.random() * 0.6), vol: vol * (0.6 + Math.random() * 0.6), when: when + i * (0.05 + Math.random() * 0.08), bus });
  }
}
function ambientBubble(now) {
  const c = ctx, f = 500 + Math.random() * 800, t = now + 0.01;
  const os = c.createOscillator(), gn = c.createGain();
  os.frequency.setValueAtTime(f, t); os.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.09);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.05, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  os.connect(gn); gn.connect(G.dry); os.start(t); os.stop(t + 0.12);
}

const SFX = {
  coin() {
    const now = performance.now();
    coinStreak = now - lastCoin < 420 ? Math.min(coinStreak + 1, 9) : 0; lastCoin = now;
    const f = 987.77 * Math.pow(2, [0, 2, 4, 5, 7, 9, 11, 12, 12, 14][coinStreak] / 12);
    chime(f, { vol: 0.2, dur: 0.35 });
    chime(f * 1.3348, { vol: 0.24, when: 0.06, dur: 0.5 });
    tn(f * 2, 0.1, { vol: 0.04, when: 0.06 });
  },
  gem() {
    [1318.5, 1661.2, 1975.5, 2637].forEach((f, i) => chime(f, { vol: 0.2, when: i * 0.055, dur: 0.6 }));
    nz(0.3, { type: 'highpass', f: 7000, q: 0.7, vol: 0.05, when: 0.1 });
  },
  jump() { tn(340, 0.2, { type: 'triangle', to: 820, vol: 0.15 }); nz(0.12, { f: 1800, to: 4200, q: 1.2, vol: 0.05 }); },
  slide() { nz(0.38, { type: 'lowpass', f: 1500, to: 280, q: 0.8, vol: 0.16, a: 0.02 }); nz(0.3, { f: 700, to: 300, q: 1, vol: 0.05 }); },
  land() { tn(130, 0.12, { to: 48, vol: 0.24 }); nz(0.08, { type: 'lowpass', f: 700, to: 250, vol: 0.08 }); },
  lane() { nz(0.11, { f: 900, to: 2700, q: 2, vol: 0.075 }); },
  stumble() {
    tn(210, 0.2, { type: 'sawtooth', to: 105, vol: 0.12, lp: 900 });
    nz(0.13, { f: 500, q: 0.8, vol: 0.18 });
    tn(430, 0.1, { type: 'square', to: 300, vol: 0.045, when: 0.02 });
  },
  crash() {
    nz(0.9, { type: 'lowpass', f: 1000, to: 90, q: 0.7, vol: 0.5 });
    tn(125, 0.7, { to: 38, vol: 0.4 });
    tn(270, 0.5, { type: 'sawtooth', to: 62, vol: 0.14, lp: 1200 });
    nz(0.28, { type: 'highpass', f: 3500, q: 0.7, vol: 0.16 });
    nz(0.2, { f: 1800, q: 2, vol: 0.12, when: 0.12 });
  },
  powerup() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      tn(f, 0.16, { type: 'triangle', vol: 0.11, when: i * 0.055 });
      tn(f * 2, 0.1, { type: 'sine', vol: 0.04, when: i * 0.055 });
    });
    chime(2093, { vol: 0.16, when: 0.28, dur: 0.6 });
    nz(0.3, { f: 600, to: 5000, q: 1, vol: 0.06, a: 0.1 });
  },
  shieldBreak() {
    nz(0.4, { type: 'highpass', f: 2800, q: 0.8, vol: 0.24 });
    [2093, 1568, 1046.5].forEach((f, i) => chime(f, { vol: 0.2, when: i * 0.04, dur: 0.5 }));
    tn(880, 0.3, { type: 'sawtooth', to: 180, vol: 0.06, lp: 2000 });
  },
  kick() { tn(190, 0.15, { to: 58, vol: 0.32 }); nz(0.06, { f: 1500, q: 1, vol: 0.15 }); tn(420, 0.06, { type: 'square', to: 160, vol: 0.04 }); },
  explode() {
    nz(1.15, { type: 'lowpass', f: 2400, to: 70, q: 0.7, vol: 0.55 });
    tn(92, 0.95, { to: 30, vol: 0.45 });
    nz(0.5, { type: 'highpass', f: 2200, q: 0.7, vol: 0.14, when: 0.05 });
    tn(210, 0.6, { type: 'sawtooth', to: 40, vol: 0.12, lp: 900 });
    nz(0.15, { f: 3000, q: 2, vol: 0.1, when: 0.2 }); nz(0.15, { f: 2500, q: 2, vol: 0.08, when: 0.32 });
  },
  alarm() {
    for (let i = 0; i < 3; i++) {
      tn(880, 0.16, { type: 'square', vol: 0.07, when: i * 0.36, lp: 2600 });
      tn(660, 0.16, { type: 'square', vol: 0.07, when: i * 0.36 + 0.18, lp: 2600 });
    }
  },
  drop() { tn(700, 0.3, { to: 150, vol: 0.16 }); tn(1400, 0.15, { type: 'triangle', to: 300, vol: 0.05 }); },
  laugh() {
    for (let i = 0; i < 6; i++) {
      const f = 380 * Math.pow(0.93, i);
      tn(f, 0.09, { type: 'sawtooth', to: f * 0.88, vol: 0.1, when: i * 0.11 + (i > 2 ? 0.04 : 0), bp: 900, a: 0.01 });
      tn(f * 1.5, 0.07, { type: 'square', vol: 0.025, when: i * 0.11 + (i > 2 ? 0.04 : 0), bp: 1500 });
    }
  },
  click() { tn(1500, 0.045, { type: 'triangle', to: 1100, vol: 0.12 }); nz(0.015, { type: 'highpass', f: 5000, vol: 0.05 }); },
  buy() {
    nz(0.06, { f: 6500, q: 1.5, vol: 0.07 });
    chime(1568, { vol: 0.22, when: 0.05, dur: 0.5 });
    chime(2093, { vol: 0.26, when: 0.12, dur: 0.8 });
  },
  build() {
    [0, 0.16].forEach((w) => { nz(0.07, { f: 1800, q: 4, vol: 0.24, when: w }); tn(230, 0.09, { to: 120, vol: 0.2, when: w }); });
    [523.25, 783.99, 1046.5].forEach((f, i) => chime(f, { vol: 0.22, when: 0.32 + i * 0.1, dur: 0.7, bus: curWet }));
  },
  reward() {
    [784, 987.8, 1174.7, 1568].forEach((f, i) => chime(f, { vol: 0.24, when: i * 0.075, dur: 0.8, bus: curWet }));
    nz(0.5, { type: 'highpass', f: 7000, q: 0.7, vol: 0.04, when: 0.1 });
  },
  fanfare() {
    const b = curWet;
    brass(392, 0.16, 0.07, 0, b); brass(523.25, 0.16, 0.07, 0.14, b); brass(659.25, 0.16, 0.07, 0.28, b);
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => brass(f, 0.9, 0.055, 0.44, b));
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => chime(f, { vol: 0.14, when: 0.44 + i * 0.06, dur: 1, bus: b }));
  },
  tick() { tn(1900, 0.03, { type: 'triangle', vol: 0.09 }); nz(0.012, { type: 'highpass', f: 4000, vol: 0.05 }); },
  error() { tn(196, 0.17, { type: 'square', vol: 0.08, lp: 900 }); tn(147, 0.26, { type: 'square', vol: 0.08, when: 0.13, lp: 800 }); },
  whoosh() { nz(0.5, { f: 300, to: 3200, q: 1.2, vol: 0.2, a: 0.17 }); },
  splash() {
    nz(0.5, { type: 'lowpass', f: 4200, to: 500, q: 0.8, vol: 0.3, a: 0.01 });
    nz(0.25, { type: 'highpass', f: 3000, q: 0.7, vol: 0.1 });
    tn(300, 0.18, { to: 90, vol: 0.16 });
    bubbles(4, 0.1, 0.05);
  },
  dive() {
    nz(0.55, { type: 'lowpass', f: 2600, to: 200, q: 0.8, vol: 0.26, a: 0.02 });
    tn(600, 0.38, { to: 110, vol: 0.16 });
    bubbles(5, 0.12, 0.06);
  },
  swim() { nz(0.18, { f: 1000, to: 1800, q: 1.5, vol: 0.09, a: 0.03 }); nz(0.13, { f: 700, to: 1200, q: 1.5, vol: 0.07, when: 0.17, a: 0.02 }); },
  bubble() { bubbles(4, 0, 0.1); },
  mount() {
    tn(92, 0.15, { to: 55, vol: 0.32 }); nz(0.05, { f: 2500, q: 1.5, vol: 0.2 });
    tn(60, 0.42, { type: 'sawtooth', to: 190, vol: 0.12, lp: 600, when: 0.1 });
    chime(987.8, { vol: 0.14, when: 0.22, dur: 0.5 });
  },
  horn() {
    [0, 0.4].forEach((w) => { tn(349.2, 0.3, { type: 'square', vol: 0.09, when: w, lp: 1700, a: 0.01 }); tn(440, 0.3, { type: 'square', vol: 0.09, when: w, lp: 1700, a: 0.01 }); });
  },
  cannon() {
    nz(0.9, { type: 'lowpass', f: 1800, to: 60, q: 0.7, vol: 0.55 });
    tn(112, 0.65, { to: 32, vol: 0.5 });
    nz(0.09, { f: 4000, q: 1, vol: 0.2 });
    tn(900, 0.18, { type: 'sawtooth', to: 220, vol: 0.05, lp: 2000 });
    chime(220, { vol: 0.07, when: 0.05, dur: 0.6 });
  },
  wave() { nz(1.7, { f: 280, to: 1500, q: 0.6, vol: 0.22, a: 0.8 }); nz(1.5, { type: 'highpass', f: 2500, q: 0.7, vol: 0.05, a: 0.8, when: 0.1 }); },
  finish() {
    const b = curWet;
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => chime(f, { vol: 0.2, when: i * 0.09, dur: 1, bus: b }));
    brass(523.25, 0.12, 0.06, 0.1, b); brass(659.25, 0.12, 0.06, 0.24, b);
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => brass(f, 1.0, 0.05, 0.4, b));
    nz(1.0, { f: 1800, q: 0.5, vol: 0.09, a: 0.12 });
  },
  star() {
    [1046.5, 1568, 2093].forEach((f, i) => chime(f, { vol: 0.22, when: i * 0.06, dur: 0.8, bus: curWet }));
    tn(1046, 0.22, { to: 3000, vol: 0.05 });
    nz(0.3, { type: 'highpass', f: 7500, q: 0.7, vol: 0.04, when: 0.1 });
  },
  vacuum() { nz(0.4, { f: 400, to: 3600, q: 1.5, vol: 0.18, a: 0.15 }); tn(200, 0.34, { to: 950, vol: 0.1, a: 0.1 }); },
  pop() { tn(900, 0.09, { to: 170, vol: 0.22 }); nz(0.05, { type: 'highpass', f: 2200, vol: 0.18 }); },
  ring() {
    chime(1318.5, { vol: 0.22, dur: 0.5 }); chime(1975.5, { vol: 0.22, when: 0.07, dur: 0.7 });
    nz(0.16, { f: 2000, to: 5200, q: 1, vol: 0.07, a: 0.05 });
  },
  hit() { tn(200, 0.13, { to: 68, vol: 0.32 }); nz(0.08, { f: 1400, q: 1, vol: 0.22 }); tn(800, 0.06, { type: 'square', to: 300, vol: 0.05 }); },
};
// Per-effect level trims (measured so that key effects peak around -5 dBFS, ambient ones around -14 dBFS)
const SFX_TRIM = { coin: 1.95, gem: 1.48, jump: 4.3, slide: 6.02, land: 3.16, lane: 18.58, stumble: 4.08, crash: 1.32, powerup: 3.76, shieldBreak: 1.78, kick: 2.13, explode: 1.4, alarm: 5.37, drop: 2.72, laugh: 11.46, click: 2.37, buy: 1.72, build: 1.45, reward: 1.41, fanfare: 2.14, tick: 2.63, error: 5.36, whoosh: 6.23, splash: 2.02, dive: 2.24, swim: 11.46, bubble: 2.85, mount: 1.46, horn: 2.19, cannon: 1.38, wave: 3.09, finish: 1.78, star: 1.58, vacuum: 4.46, pop: 2.07, ring: 1.7, hit: 1.98 };
const SFX_GAP = { coin: 0.02, tick: 0.03, click: 0.03, lane: 0.05, swim: 0.1, bubble: 0.1 };

// ============================================================ loops: vehicle engines and jet
function nzLoop() {
  const s = ctx.createBufferSource(); s.buffer = kit.noise; s.loop = true;
  return s;
}
function makeEngine(kind) {
  const c = ctx, out = c.createGain();
  out.gain.value = 0.0001; out.connect(G.sfx);
  const srcs = [];
  const osc = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; srcs.push(o); return o; };
  const fl = (type, f, q) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  const gain = (v) => { const n = c.createGain(); n.gain.value = v; return n; };
  const nzs = () => { const s = nzLoop(); srcs.push(s); return s; };
  const pitch = [];
  let level = 0.17, upd;
  if (kind === 'car') {
    // buzzy four-stroke: detuned saws + octave "rasp" through a mid band, cylinder pulsing, road hiss
    const a = osc('sawtooth', 64), b = osc('sawtooth', 64.6), r = osc('sawtooth', 128), sub = osc('sine', 32);
    const lp = fl('lowpass', 1100, 2), amp = gain(0.8), lfo = osc('sine', 20), lg = gain(0.3);
    const rb = fl('bandpass', 760, 1.1), rg = gain(0.55);
    a.connect(lp); b.connect(lp); lp.connect(amp); r.connect(rb); rb.connect(rg); rg.connect(amp);
    sub.connect(gain(0.25)).connect(amp);
    lfo.connect(lg); lg.connect(amp.gain); amp.connect(out);
    const rd = nzs(), rbp = fl('bandpass', 1000, 0.7), rgn = gain(0.07); rd.connect(rbp); rbp.connect(rgn); rgn.connect(out);
    pitch.push([a, 64], [b, 64.6], [r, 128], [sub, 32]);
    upd = (i) => { const k = 1 + 0.9 * i, now = c.currentTime; pitch.forEach(([o, f]) => o.frequency.setTargetAtTime(f * k, now, 0.12)); lfo.frequency.setTargetAtTime(20 * k, now, 0.12); lp.frequency.setTargetAtTime(1000 + 1500 * i, now, 0.15); rb.frequency.setTargetAtTime(700 + 600 * i, now, 0.15); };
  } else if (kind === 'boat') {
    // outboard: raspy mid saw, burbling exhaust, churning water
    level = 0.17;
    const a = osc('sawtooth', 52), h = osc('sawtooth', 104), sub = osc('sine', 52);
    const lp = fl('lowpass', 650, 3), hb = fl('bandpass', 620, 1.3), hg = gain(0.95);
    const amp = gain(0.75), lfo = osc('sine', 11), lg = gain(0.32);
    a.connect(lp); lp.connect(amp); h.connect(hb); hb.connect(hg); hg.connect(amp); sub.connect(gain(0.3)).connect(amp);
    lfo.connect(lg); lg.connect(amp.gain); amp.connect(out);
    const w = nzs(), wl = fl('lowpass', 1500, 0.5), wg = gain(0.13), lf2 = osc('sine', 0.45), lg2 = gain(0.04);
    w.connect(wl); wl.connect(wg); wg.connect(out); lf2.connect(lg2); lg2.connect(wg.gain);
    const bw = nzs(), bb = fl('bandpass', 900, 1.5), bg = gain(0.07); bw.connect(bb); bb.connect(bg); bg.connect(out);
    pitch.push([a, 52], [h, 104], [sub, 52]);
    upd = (i) => { const k = 1 + 0.7 * i, now = c.currentTime; pitch.forEach(([o, f]) => o.frequency.setTargetAtTime(f * k, now, 0.12)); lfo.frequency.setTargetAtTime(11 * k, now, 0.12); wl.frequency.setTargetAtTime(1200 + 1800 * i, now, 0.2); };
  } else if (kind === 'ship') {
    // big diesel: slow thump with a mid growl and a wide wash
    level = 0.17;
    const a = osc('sawtooth', 40), h = osc('sawtooth', 80), sub = osc('sine', 40);
    const lp = fl('lowpass', 520, 2), hb = fl('bandpass', 460, 1), hg = gain(1.05);
    const amp = gain(0.75), lfo = osc('sine', 3.4), lg = gain(0.38);
    a.connect(lp); lp.connect(amp); h.connect(hb); hb.connect(hg); hg.connect(amp); sub.connect(gain(0.4)).connect(amp); lfo.connect(lg); lg.connect(amp.gain); amp.connect(out);
    const w = nzs(), wl = fl('lowpass', 1100, 0.5), wg = gain(0.12), lf2 = osc('sine', 0.3), lg2 = gain(0.05);
    w.connect(wl); wl.connect(wg); wg.connect(out); lf2.connect(lg2); lg2.connect(wg.gain);
    pitch.push([a, 40], [h, 80], [sub, 40]);
    upd = (i) => { const k = 1 + 0.5 * i, now = c.currentTime; pitch.forEach(([o, f]) => o.frequency.setTargetAtTime(f * k, now, 0.2)); lfo.frequency.setTargetAtTime(3.4 * k, now, 0.2); };
  } else { // plane: twin-blade prop buzz with harmonics + wind
    level = 0.17;
    const a = osc('sawtooth', 92), b = osc('sawtooth', 93.8), c3 = osc('square', 184), lp = fl('lowpass', 2000, 1.5), amp = gain(0.7), lfo = osc('sine', 28), lg = gain(0.45);
    const c3g = gain(0.25);
    a.connect(lp); b.connect(lp); c3.connect(c3g); c3g.connect(lp); lp.connect(amp); lfo.connect(lg); lg.connect(amp.gain); amp.connect(out);
    const w = nzs(), wb = fl('bandpass', 1100, 0.6), wg = gain(0.12), lf2 = osc('sine', 0.3), lg2 = gain(0.04);
    w.connect(wb); wb.connect(wg); wg.connect(out); lf2.connect(lg2); lg2.connect(wg.gain);
    pitch.push([a, 92], [b, 93.8], [c3, 184]);
    upd = (i) => { const k = 1 + 0.45 * i, now = c.currentTime; pitch.forEach(([o, f]) => o.frequency.setTargetAtTime(f * k, now, 0.15)); lfo.frequency.setTargetAtTime(28 * k, now, 0.15); wb.frequency.setTargetAtTime(1000 + 1000 * i, now, 0.2); };
  }
  const t = c.currentTime;
  srcs.forEach((s) => { if (s.buffer) s.start(t, Math.random() * 1.5); else s.start(t); });
  out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(level, t + 0.3);
  upd(iC);
  return {
    kind, upd,
    stop() {
      const n = c.currentTime;
      out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), n); out.gain.exponentialRampToValueAtTime(0.0001, n + 0.28);
      const kill = () => { srcs.forEach((s) => { try { s.stop(); } catch (e) { /* ignore */ } }); try { out.disconnect(); } catch (e) { /* ignore */ } };
      if (offline) kill(); else setTimeout(kill, 420);
    },
  };
}
function makeJet() {
  const c = ctx, out = c.createGain(), t = c.currentTime;
  out.gain.value = 0.0001; out.connect(G.sfx);
  const srcs = [];
  const n1 = nzLoop(), n2 = nzLoop(), n3 = nzLoop(); srcs.push(n1, n2, n3);
  const roar = c.createBiquadFilter(); roar.type = 'bandpass'; roar.frequency.value = 1300; roar.Q.value = 0.6;
  const rum = c.createBiquadFilter(); rum.type = 'lowpass'; rum.frequency.value = 420; rum.Q.value = 0.7;
  const siz = c.createBiquadFilter(); siz.type = 'highpass'; siz.frequency.value = 3200;
  const g1 = c.createGain(); g1.gain.value = 1.3; const g2 = c.createGain(); g2.gain.value = 1.4; const g3 = c.createGain(); g3.gain.value = 0.18;
  n1.connect(roar); roar.connect(g1); g1.connect(out);
  n2.connect(rum); rum.connect(g2); g2.connect(out);
  n3.connect(siz); siz.connect(g3); g3.connect(out);
  const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 31; srcs.push(lfo);
  const lg = c.createGain(); lg.gain.value = 0.35; lfo.connect(lg); lg.connect(g2.gain);
  const lf2 = c.createOscillator(); lf2.frequency.value = 0.6; srcs.push(lf2);
  const lg2 = c.createGain(); lg2.gain.value = 500; lf2.connect(lg2); lg2.connect(roar.frequency);
  srcs.forEach((s) => { if (s.buffer) s.start(t, Math.random() * 1.5); else s.start(t); });
  out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.3, t + 0.3);
  return {
    stop() {
      const n = c.currentTime;
      out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), n); out.gain.exponentialRampToValueAtTime(0.0001, n + 0.28);
      const kill = () => { srcs.forEach((s) => { try { s.stop(); } catch (e) { /* ignore */ } }); try { out.disconnect(); } catch (e) { /* ignore */ } };
      if (offline) kill(); else setTimeout(kill, 420);
    },
  };
}
function syncLoops() {
  if (!ctx) return;
  const wantEng = sfxOn ? engWant : null;
  if ((eng && eng.kind) !== wantEng) {
    if (eng) { eng.stop(); eng = null; }
    if (wantEng) eng = makeEngine(wantEng);
  }
  const wantJet = sfxOn && jetWant;
  if (wantJet && !jetNode) jetNode = makeJet();
  else if (!wantJet && jetNode) { jetNode.stop(); jetNode = null; }
}
function killLoops(hard) {
  if (eng) { try { eng.stop(); } catch (e) { /* ignore */ } eng = null; }
  if (jetNode) { try { jetNode.stop(); } catch (e) { /* ignore */ } jetNode = null; }
  if (hard) { engWant = null; jetWant = false; }
}

// ============================================================ filters (helmet muffle, underwater)
function muffleFreq(x) { return 19000 * Math.pow(650 / 19000, Math.pow(clamp(x, 0, 1), 0.62)); }
function applyMuffle() {
  if (!ctx || !G) return;
  const now = ctx.currentTime, x = muffleT, tc = 0.09;
  const det = -1200 * Math.log2(19000 / muffleFreq(x));
  G.lp1.detune.setTargetAtTime(det, now, tc); G.lp2.detune.setTargetAtTime(det, now, tc);
  G.lp1.Q.setTargetAtTime(0.7 + 0.25 * x, now, tc); G.lp2.Q.setTargetAtTime(0.7 + 0.1 * x, now, tc);
  G.muffGain.gain.setTargetAtTime(1 - 0.42 * x, now, tc + 0.02);   // volume dip
  G.distWet.gain.setTargetAtTime(0.3 * x * x, now, tc + 0.02);     // slight distortion
  G.combWet.gain.setTargetAtTime(0.22 * x * x, now, tc + 0.02);    // hollow "inside a helmet" resonance
}
function applyUnderwater() {
  if (!ctx || !G) return;
  const now = ctx.currentTime, on = uwT;
  G.uwLP.detune.setTargetAtTime(on ? -1200 * Math.log2(19000 / 950) : 0, now, on ? 0.1 : 0.22);
  G.uwLP.Q.setTargetAtTime(on ? 3.2 : 0.7, now, 0.15);
  G.uwA1.gain.setTargetAtTime(on ? 420 : 0, now, 0.2);
  G.uwA2.gain.setTargetAtTime(on ? 90 : 0, now, 0.2);
  G.uwGain.gain.setTargetAtTime(on ? 0.88 : 1, now, 0.15);
}

// ============================================================ public API
function startTimer() { if (!timer && !offline) timer = setInterval(tick, TICK_MS); }

function unlock() {
  if (ctx) {
    if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(noop); }
    return;
  }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  let c;
  try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { try { c = new AC(); } catch (e2) { return; } }
  build(c, false);
  try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) { /* ignore */ }
  if (c.state !== 'running') { const p = c.resume(); if (p && p.catch) p.catch(noop); }
  lastTick = c.currentTime;
  applyMuffle(); applyUnderwater();
  startTimer();
  syncLoops();
  if (pend) { const p = pend; pend = null; startMusic(p.mode, { world: p.world }); }
}
function suspend() { if (ctx && ctx.state === 'running') { const p = ctx.suspend(); if (p && p.catch) p.catch(noop); } }
function resume() { if (ctx && ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(noop); } }
function setSfx(on) {
  sfxOn = !!on;
  if (G) G.sfx.gain.setTargetAtTime(sfxOn ? SFX_VOL : 0, ctx.currentTime, 0.03);
  syncLoops();
}
function setMusic(on) {
  musicOn = !!on;
  if (G) G.musicVol.gain.setTargetAtTime(musicOn ? MUSIC_VOL : 0, ctx.currentTime, 0.05);
}
function useSx(name) {
  const tr0 = SFX_TRIM[name] || 1;
  let sx = sxCache[name];
  if (!sx || sx.c !== ctx) {
    const a = ctx.createGain(); a.gain.value = tr0; a.connect(G.sfx);
    const b = ctx.createGain(); b.gain.value = tr0; b.connect(G.sfxWet);
    sx = sxCache[name] = { c: ctx, a, b };
  }
  curBus = sx.a; curWet = sx.b;
}
function play(name) {
  if (!ctx || !sfxOn || ctx.state !== 'running') return;
  const f = SFX[name];
  if (!f) return;
  const now = performance.now(), gap = (SFX_GAP[name] || 0.012) * 1000;
  if (lastPlay[name] && now - lastPlay[name] < gap) return;
  lastPlay[name] = now;
  useSx(name);
  try { f(); } catch (e) { if (!warned) { warned = true; if (typeof console !== 'undefined') console.warn('[audio] sfx', name, e); } }
}
function engine(kind) {
  engWant = kind || null;
  syncLoops();
}
function jet(on) {
  jetWant = !!on;
  syncLoops();
}
function startMusic(m, opts) {
  const wid = (opts && opts.world && DEFS[opts.world]) ? opts.world : lastWorld;
  lastWorld = wid;
  mode = m;
  if (!ctx) { pend = { mode: m, world: wid }; return; }
  const md = normMode(m);
  if (tr && !tr.dead && tr.wid === wid) {
    if (tr.mode === md) { tr.pend = null; return; }
    if (tr.pend === md) return;
  }
  // different world or arrangement: crossfade into a fresh track (immediate, with a crash on the first beat)
  const now = ctx.currentTime;
  if (tr) disposeTrack(tr, 0.35);
  if (!tr || tr.wid !== wid) noteCache.clear();   // keep memory bounded: only the current world's samples stay baked
  if (md === 'run') iT = iC = Math.min(iT, 0.25);   // a fresh run always builds up from the bottom layers
  tr = newTrack(wid, m, now + 0.12);
  lastTick = now;
}
function setMode(m) {
  if (!ctx) { mode = m; pend = { mode: m, world: lastWorld }; return; }
  if (!tr || tr.dead) return;
  mode = m;
  const md = normMode(m);
  if (md === tr.mode) { tr.pend = null; return; }
  if (tr.pend === md) return;
  tr.pend = md;
  // announce with a riser that lands on the next bar line, where the new arrangement starts
  if (md !== 'lobby' && md !== 'map' && ctx.state === 'running') {
    const spb = 60 / tr.bpm / 4;
    const boundary = tr.s === 0 ? tr.nextT : tr.nextT + (16 - tr.s) * spb;
    const now = ctx.currentTime;
    const d = boundary - now - 0.02;
    if (d > 0.35) { try { vRiser(tr, now + 0.02, Math.min(d, 2.2), md === 'boss' ? 0.9 : 0.6); } catch (e) { /* ignore */ } }
  }
}
function setIntensity(x) { iT = clamp(+x || 0, 0, 1); }
function setMuffle(x) { muffleT = clamp(+x || 0, 0, 1); applyMuffle(); }
function setUnderwater(b) {
  const on = !!b;
  if (on === uwT) return;
  uwT = on;
  if (on) bubbleAt = 0;
  applyUnderwater();
}
function stopMusic() {
  mode = null; pend = null;
  if (tr && ctx) disposeTrack(tr, 0.35);
  tr = null;
}

export const Audio = {
  unlock, suspend, resume, setSfx, setMusic, play, engine, jet, startMusic, setMode, setIntensity, setMuffle, setUnderwater, stopMusic,
  get mode() { return mode; },
  get ctx() { return ctx; },
  get analyser() { return G ? G.analyser : null; },
};

// Hidden hooks for the offline test harness (not part of the public API).
Object.defineProperty(Audio, '_internal', {
  enumerable: false,
  value: {
    DEFS, BOSS, SC, build, startMusic, setMode, play, SFX, SFX_TRIM, playRaw(n) { useSx(n); SFX[n](); }, getTrack: () => tr, G: () => G, kit: () => kit,
    attach(c) { muffleT = 0; uwT = false; iT = iC = 0.2; engWant = null; jetWant = false; pend = null; build(c, true); applyMuffle(); applyUnderwater(); },
    // schedule music up to `sec` of context time in one go (offline rendering)
    pump(sec) { if (!tr) return; pumpTrack(tr, sec); },
    setNow(i, age) { iT = iC = i; if (tr) { tr.age0 = -(age || 0); updateStems(tr, 0, true); } },
    voiceChord, degMidi, parseSeq, degOf, mtof, getNote, INST,  makeEngine: (k) => makeEngine(k), makeJet: () => makeJet(),
    sfxState: () => ({ sfxOn }),
    nodes: () => ({ eng: !!eng, jet: !!jetNode }),
  },
});
