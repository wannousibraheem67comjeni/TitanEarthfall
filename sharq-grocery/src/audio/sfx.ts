/**
 * Sound effects synthesised with WebAudio: the door bell, the till, coins, paper notes,
 * the savings jar, a soft shop ambience. No audio files needed.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: { stop: () => void } | null = null;
  volume = 0.8;
  muted = false;

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.2, delay = 0, slide = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, gain: number, filter: number, delay = 0, q = 1): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filter;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** The bell over the door when someone comes in. */
  bell(): void {
    this.tone(1318, 0.5, 'sine', 0.12);
    this.tone(1046, 0.7, 'sine', 0.1, 0.16);
  }

  /** Coins dropping into the savings jar. */
  save(): void {
    for (let i = 0; i < 5; i++) this.tone(1500 + Math.random() * 900, 0.12, 'triangle', 0.08, i * 0.06);
    this.tone(523, 0.25, 'sine', 0.08, 0.32);
    this.tone(784, 0.35, 'sine', 0.08, 0.42);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  /** Paper note: a quick rustle. */
  note(): void {
    this.noise(0.12, 0.35, 3200, 0, 0.8);
    this.noise(0.08, 0.25, 5200, 0.05, 1.2);
  }

  coin(): void {
    this.tone(2400, 0.25, 'triangle', 0.08);
    this.tone(3600, 0.2, 'sine', 0.05, 0.03);
  }

  /** Cash register "ka-ching" for a payment. */
  register(): void {
    this.noise(0.05, 0.4, 1800, 0, 2);
    this.tone(1318, 0.5, 'triangle', 0.12, 0.06);
    this.tone(1760, 0.6, 'triangle', 0.1, 0.12);
  }

  success(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, i * 0.09));
  }

  fail(): void {
    this.tone(330, 0.25, 'sawtooth', 0.06);
    this.tone(247, 0.35, 'sawtooth', 0.06, 0.18);
  }

  click(): void {
    this.tone(880, 0.05, 'square', 0.03);
  }

  pop(): void {
    this.tone(600, 0.08, 'sine', 0.1, 0, 500);
  }

  level(): void {
    [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.09, i * 0.08));
  }

  step(soft: boolean): void {
    this.noise(0.05, soft ? 0.05 : 0.08, soft ? 700 : 1200, 0, 0.7);
  }

  horn(): void {
    this.tone(420, 0.35, 'square', 0.05);
    this.tone(520, 0.35, 'square', 0.04);
  }

  splash(): void {
    this.noise(0.4, 0.2, 900, 0, 0.5);
  }

  scrub(): void {
    this.noise(0.15, 0.12, 2500, 0, 3);
  }

  micOn(): void {
    this.tone(880, 0.08, 'sine', 0.08);
    this.tone(1320, 0.1, 'sine', 0.08, 0.08);
  }

  micOff(): void {
    this.tone(1320, 0.08, 'sine', 0.06);
    this.tone(880, 0.1, 'sine', 0.06, 0.08);
  }

  /** The door sensor's two-tone chime. */
  doorChime(): void {
    this.tone(784, 0.55, 'sine', 0.09);
    this.tone(622, 0.8, 'sine', 0.08, 0.32);
  }

  /** The scanner's beep as an item is rung up. */
  beep(): void {
    this.tone(2350, 0.07, 'square', 0.035);
  }

  /** The receipt printer chattering for `secs`. */
  printer(secs = 0.8): void {
    if (!this.ctx || !this.master) return;
    for (let t = 0; t < secs; t += 0.045) this.noise(0.03, 0.08, 2600 + Math.random() * 600, t, 3);
  }

  /** Cash drawer sliding out, coins shifting. */
  drawer(): void {
    this.noise(0.18, 0.25, 900, 0, 0.8);
    this.tone(180, 0.12, 'triangle', 0.08, 0.02);
    for (let i = 0; i < 3; i++) this.tone(2600 + Math.random() * 1200, 0.1, 'triangle', 0.04, 0.12 + i * 0.05);
  }

  /** The card machine approving a payment. */
  cardBeep(): void {
    this.tone(1760, 0.09, 'sine', 0.07);
    this.tone(2093, 0.16, 'sine', 0.07, 0.11);
  }

  /** A car going past outside, quieter the further away it is. */
  whoosh(distance: number): void {
    if (!this.ctx || !this.master) return;
    const g = Math.max(0.02, 0.22 - distance * 0.012);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 2.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.linearRampToValueAtTime(900, t + 1.0);
    f.frequency.linearRampToValueAtTime(250, t + 2.2);
    const v = ctx.createGain();
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(g, t + 1.0);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    src.connect(f).connect(v).connect(this.master);
    src.start(t);
  }

  private street: GainNode | null = null;
  private night: GainNode | null = null;

  /** Inside: the air conditioner's hush and the fridges' hum. Outside: the street, and crickets at night. */
  startAmbience(): void {
    if (!this.ctx || !this.master || this.ambience) return;
    const ctx = this.ctx;
    const loop = (seconds: number, fill: (d: Float32Array, rate: number) => void) => {
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      fill(buf.getChannelData(0), ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      return src;
    };
    const brown = (d: Float32Array) => {
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = last * 0.985 + (Math.random() * 2 - 1) * 0.015;
        d[i] = last * 3.5;
      }
    };
    // AC: soft broadband hush.
    const ac = loop(4, brown);
    const acF = ctx.createBiquadFilter();
    acF.type = 'lowpass';
    acF.frequency.value = 700;
    const acG = ctx.createGain();
    acG.gain.value = 0.09;
    ac.connect(acF).connect(acG).connect(this.master);
    // Fridge compressors: a low hum.
    const hum = ctx.createOscillator();
    hum.frequency.value = 98;
    const humG = ctx.createGain();
    humG.gain.value = 0.012;
    hum.connect(humG).connect(this.master);
    // The street through the glass.
    const st = loop(5, brown);
    const stF = ctx.createBiquadFilter();
    stF.type = 'bandpass';
    stF.frequency.value = 380;
    stF.Q.value = 0.5;
    this.street = ctx.createGain();
    this.street.gain.value = 0.05;
    st.connect(stF).connect(this.street).connect(this.master);
    // Crickets at night.
    const cr = loop(2, (d, rate) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / rate;
        const chirp = Math.floor(t * 5) % 4 === 0 ? 1 : 0;
        d[i] = Math.sin(t * Math.PI * 2 * 4200) * chirp * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 30));
      }
    });
    this.night = ctx.createGain();
    this.night.gain.value = 0;
    cr.connect(this.night).connect(this.master);
    ac.start();
    hum.start();
    st.start();
    cr.start();
    const birds = setInterval(() => {
      if (Math.random() < 0.3 && (this.night?.gain.value ?? 0) < 0.002) {
        const base = 2600 + Math.random() * 1400;
        for (let i = 0; i < 3; i++) this.tone(base + i * 140, 0.07, 'sine', 0.012, i * 0.1, 300);
      }
    }, 5000);
    this.ambience = {
      stop: () => {
        ac.stop();
        hum.stop();
        st.stop();
        cr.stop();
        clearInterval(birds);
      },
    };
  }

  /** How loud the street is (0–1) and how dark it is (0–1). */
  setOutside(busy: number, night: number): void {
    if (this.street) this.street.gain.value = 0.02 + busy * 0.05;
    if (this.night) this.night.gain.value = night * 0.006;
  }
}
