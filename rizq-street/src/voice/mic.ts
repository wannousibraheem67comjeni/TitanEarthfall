/**
 * The device's real microphone: asks the browser for permission (its own prompt),
 * reports a live input level so the player can see it hearing them, and records an
 * utterance as 16 kHz WAV (for cloud speech-to-text) with end-of-speech detection.
 */

export type MicPermission = 'granted' | 'denied' | 'prompt' | 'nomic' | 'unsupported';

const CONSTRAINTS: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

export class Mic {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly buf = new Float32Array(1024);
  private stopRecording: (() => void) | null = null;

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** The permission as the browser remembers it, without asking. */
  static async query(): Promise<MicPermission> {
    if (!Mic.supported()) return 'unsupported';
    try {
      const st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return st.state === 'granted' ? 'granted' : st.state === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'prompt';
    }
  }

  /** Ask for the real microphone: the browser shows its permission prompt. Releases it right after. */
  static async request(): Promise<MicPermission> {
    if (!Mic.supported()) return 'unsupported';
    try {
      const s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      for (const t of s.getTracks()) t.stop();
      return 'granted';
    } catch (e) {
      const name = (e as DOMException)?.name;
      return name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nomic' : 'denied';
    }
  }

  get open(): boolean {
    return this.stream !== null;
  }

  /** Start the microphone for level metering (and recording). */
  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    // A context made outside a tap starts suspended and would hear only silence.
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
  }

  /** Input loudness right now, 0–1. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 6);
  }

  close(): void {
    this.stopRecording?.();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    void this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
  }

  /** Finish a recording in progress now. */
  finish(): void {
    this.stopRecording?.();
  }

  /**
   * Record one utterance: stops after a pause once speech was heard, after `maxMs`,
   * or on finish(). Resolves with 16 kHz mono WAV, or null when nothing was said.
   */
  async record(onLevel: (l: number) => void, maxMs = 9000, silenceMs = 1100): Promise<Blob | null> {
    await this.start();
    const ctx = this.ctx!;
    const src = ctx.createMediaStreamSource(this.stream!);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    let heard = false;
    let quietFor = 0;
    const started = performance.now();
    return new Promise((resolve) => {
      const done = () => {
        if (!this.stopRecording) return;
        this.stopRecording = null;
        proc.disconnect();
        src.disconnect();
        resolve(heard ? encodeWav(chunks, ctx.sampleRate, 16000) : null);
      };
      this.stopRecording = done;
      proc.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
        onLevel(level);
        const ms = (data.length / ctx.sampleRate) * 1000;
        if (level > 0.12) {
          heard = true;
          quietFor = 0;
        } else if (heard) quietFor += ms;
        if ((heard && quietFor > silenceMs) || performance.now() - started > maxMs) done();
      };
      src.connect(proc);
      proc.connect(ctx.destination);
    });
  }
}

/** Float32 chunks at `rate` → 16-bit PCM WAV at `target` Hz. */
export function encodeWav(chunks: Float32Array[], rate: number, target: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const ratio = rate / target;
  const out = new Int16Array(Math.floor(total / ratio));
  let ci = 0;
  let off = 0;
  let pos = 0;
  for (let i = 0; i < out.length; i++) {
    // Average the source samples that fall into this output sample.
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let n = 0;
    while (pos < end && ci < chunks.length) {
      sum += chunks[ci][off];
      n++;
      pos++;
      if (++off >= chunks[ci].length) {
        off = 0;
        ci++;
      }
    }
    const v = Math.max(-1, Math.min(1, n ? sum / n : 0));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const header = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => [...s].forEach((ch, k) => header.setUint8(o + k, ch.charCodeAt(0)));
  str(0, 'RIFF');
  header.setUint32(4, 36 + out.byteLength, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, target, true);
  header.setUint32(28, target * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  str(36, 'data');
  header.setUint32(40, out.byteLength, true);
  return new Blob([header.buffer, out.buffer], { type: 'audio/wav' });
}
