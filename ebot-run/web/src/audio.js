// Fully synthesized audio (WebAudio): sound effects and a step-sequenced soundtrack.
// No audio files are shipped, so the game stays small and license-free.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.mode = null;
    this.coinStreak = 0;
    this.lastCoin = 0;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.jetNode = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.sfxOn ? 0.8 : 0; this.sfxBus.connect(this.comp);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.musicOn ? 0.33 : 0; this.musicBus.connect(this.comp);
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.mode) this.startMusic(this.mode, true);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setSfx(on) { this.sfxOn = on; if (this.sfxBus) this.sfxBus.gain.value = on ? 0.8 : 0; if (!on) this.jet(false); }
  setMusic(on) { this.musicOn = on; if (this.musicBus) this.musicBus.gain.value = on ? 0.33 : 0; }

  // ---------- primitives ----------
  tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, slide = 0, attack = 0.005, bus } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noiseHit(dur, { vol = 0.3, when = 0, freq = 1200, q = 1, type = 'bandpass', sweep = 0, bus } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // ---------- effects ----------
  play(name) {
    if (!this.ctx || !this.sfxOn) return;
    const T = this;
    switch (name) {
      case 'coin': {
        const now = performance.now();
        T.coinStreak = now - T.lastCoin < 260 ? Math.min(T.coinStreak + 1, 12) : 0;
        T.lastCoin = now;
        const f = 1046 * Math.pow(2, (T.coinStreak % 8) / 24);
        T.tone(f, 0.09, { type: 'square', vol: 0.07 });
        T.tone(f * 1.5, 0.14, { type: 'sine', vol: 0.12, when: 0.045 });
        break;
      }
      case 'gem': T.tone(1568, 0.12, { vol: 0.15 }); T.tone(2093, 0.18, { vol: 0.12, when: 0.07 }); T.tone(2637, 0.3, { vol: 0.1, when: 0.14 }); break;
      case 'jump': T.tone(320, 0.22, { type: 'triangle', vol: 0.2, slide: 2.6 }); T.noiseHit(0.15, { vol: 0.06, freq: 2500, sweep: 2 }); break;
      case 'slide': T.noiseHit(0.35, { vol: 0.16, freq: 900, sweep: 0.4, type: 'lowpass' }); break;
      case 'land': T.tone(110, 0.08, { type: 'sine', vol: 0.18, slide: 0.6 }); break;
      case 'lane': T.noiseHit(0.12, { vol: 0.07, freq: 1800, sweep: 1.8, q: 2 }); break;
      case 'stumble': T.tone(180, 0.18, { type: 'sawtooth', vol: 0.12, slide: 0.5 }); T.noiseHit(0.12, { vol: 0.16, freq: 600 }); break;
      case 'crash':
        T.noiseHit(0.6, { vol: 0.5, freq: 700, sweep: 0.2, type: 'lowpass' });
        T.tone(140, 0.5, { type: 'sawtooth', vol: 0.25, slide: 0.25 });
        T.tone(520, 0.12, { type: 'square', vol: 0.08, when: 0.05, slide: 0.5 });
        break;
      case 'powerup': [523, 659, 784, 1046].forEach((f, i) => T.tone(f, 0.16, { type: 'square', vol: 0.07, when: i * 0.06 })); break;
      case 'shieldBreak': T.noiseHit(0.4, { vol: 0.3, freq: 3000, sweep: 0.3, q: 3 }); T.tone(880, 0.3, { type: 'triangle', vol: 0.12, slide: 0.4 }); break;
      case 'kick': T.tone(200, 0.12, { type: 'square', vol: 0.15, slide: 3 }); T.noiseHit(0.08, { vol: 0.2, freq: 2000 }); break;
      case 'explode': T.noiseHit(1.0, { vol: 0.6, freq: 1200, sweep: 0.08, type: 'lowpass' }); T.tone(80, 0.8, { type: 'sine', vol: 0.35, slide: 0.4 }); break;
      case 'alarm': for (let i = 0; i < 3; i++) { T.tone(880, 0.16, { type: 'square', vol: 0.08, when: i * 0.36 }); T.tone(660, 0.16, { type: 'square', vol: 0.08, when: i * 0.36 + 0.18 }); } break;
      case 'drop': T.tone(600, 0.25, { type: 'triangle', vol: 0.12, slide: 0.3 }); break;
      case 'laugh': [740, 698, 740, 698, 622].forEach((f, i) => T.tone(f, 0.08, { type: 'square', vol: 0.06, when: i * 0.09, slide: 0.8 })); break;
      case 'click': T.tone(1200, 0.05, { type: 'triangle', vol: 0.12 }); break;
      case 'buy': T.tone(784, 0.1, { vol: 0.15 }); T.tone(1175, 0.2, { vol: 0.15, when: 0.08 }); break;
      case 'build': T.noiseHit(0.08, { vol: 0.25, freq: 2000, q: 4 }); T.noiseHit(0.08, { vol: 0.25, freq: 1800, q: 4, when: 0.15 }); T.tone(523, 0.2, { vol: 0.12, when: 0.3 }); T.tone(784, 0.3, { vol: 0.12, when: 0.4 }); break;
      case 'reward': [784, 988, 1175, 1568].forEach((f, i) => T.tone(f, 0.22, { type: 'triangle', vol: 0.12, when: i * 0.08 })); break;
      case 'fanfare': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => T.tone(f, 0.25, { type: 'square', vol: 0.06, when: i * 0.11 })); break;
      case 'tick': T.tone(2200, 0.03, { type: 'square', vol: 0.05 }); break;
      case 'error': T.tone(200, 0.18, { type: 'square', vol: 0.08 }); T.tone(150, 0.25, { type: 'square', vol: 0.08, when: 0.12 }); break;
      case 'whoosh': T.noiseHit(0.5, { vol: 0.2, freq: 400, sweep: 6, q: 1.5 }); break;
      default: break;
    }
  }

  // Looping jet engine rumble while the jet power-up is active.
  jet(on) {
    if (!this.ctx) return;
    if (on && !this.jetNode && this.sfxOn) {
      const c = this.ctx;
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = c.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.3);
      s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start();
      this.jetNode = { s, g };
    } else if (!on && this.jetNode) {
      const { s, g } = this.jetNode; const c = this.ctx;
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.3);
      s.stop(c.currentTime + 0.35);
      this.jetNode = null;
    }
  }

  // ---------- music ----------
  startMusic(mode, force) {
    if (this.mode === mode && !force && this.timer) return;
    this.mode = mode;
    if (!this.ctx) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stopMusic() { if (this.timer) clearInterval(this.timer); this.timer = null; this.mode = null; }

  schedule() {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const bpm = this.mode === 'run' ? 132 : 100;
    const spb = 60 / bpm / 4; // 16th note
    while (this.nextTime < c.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const c = this.ctx, bus = this.musicBus;
    const s16 = step % 16, bar = Math.floor(step / 16);
    // I - V - vi - IV progression in C major.
    const roots = [48, 43, 45, 41];
    const chords = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]];
    const root = roots[bar];
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const osc = (f, dur, type, vol, when = 0, cutoff = 0) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + when);
      g.gain.exponentialRampToValueAtTime(vol, t + when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + when + dur);
      if (cutoff) {
        const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff;
        o.connect(fl); fl.connect(g);
      } else o.connect(g);
      g.connect(bus); o.start(t + when); o.stop(t + when + dur + 0.02);
    };
    const nz = (dur, vol, freq, type = 'highpass') => {
      const s = c.createBufferSource(); s.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    };
    if (this.mode === 'run') {
      if (s16 % 4 === 0) { // kick
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.2);
      }
      if (s16 === 4 || s16 === 12) nz(0.14, 0.35, 1500, 'bandpass');
      if (s16 % 2 === 1) nz(0.04, 0.12, 7000);
      const bassPat = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 7, 12];
      if (s16 % 2 === 0 || s16 === 7 || s16 === 15) osc(midi(root + bassPat[s16]), 0.16, 'sawtooth', 0.22, 0, 700);
      const ch = chords[bar];
      const arp = [0, 1, 2, 1];
      if (s16 % 2 === 0) osc(midi(ch[arp[(s16 / 2) % 4]] + 12), 0.12, 'square', 0.05, 0, 2600);
      if (s16 === 0) ch.forEach((m) => osc(midi(m), 1.6, 'triangle', 0.05));
      const melody = [[72, -1, 76, -1, 79, -1, 76, 74], [74, -1, 71, -1, 74, 76, 74, -1], [72, -1, 69, -1, 72, 76, 79, -1], [77, 76, 74, -1, 72, -1, 71, -1]];
      if (step >= 0 && s16 % 2 === 0) {
        const n = melody[bar][s16 / 2];
        if (n > 0 && (Math.floor(step / 64) % 2 === 0 || true)) osc(midi(n), 0.22, 'triangle', 0.09);
      }
    } else {
      if (s16 % 8 === 0) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.16);
      }
      if (s16 % 4 === 2) nz(0.05, 0.06, 8000);
      if (s16 === 0) chords[bar].forEach((m) => osc(midi(m), 2.3, 'triangle', 0.06));
      if (s16 % 4 === 0) osc(midi(root), 0.5, 'sine', 0.2);
      const mel = [79, 76, 72, 76, 77, 74, 71, 74, 76, 72, 69, 72, 77, 72, 69, 71];
      if (s16 % 4 === 0) osc(midi(mel[bar * 4 + s16 / 4]), 0.4, 'sine', 0.07);
      if (s16 % 4 === 2) osc(midi(mel[bar * 4 + (s16 - 2) / 4] + 12), 0.15, 'sine', 0.025);
    }
  }
}

export const Audio = new AudioEngine();
