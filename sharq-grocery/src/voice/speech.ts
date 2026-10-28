/**
 * Voice: the player talks through the device's real microphone (browser permission,
 * live level, speech recognition), and characters answer out loud with real Arabic
 * voices: the device's natural ones, or Azure neural voices.
 */
import { azureRecognize, azureSpeak, azureVoice, type AzureConfig } from './azure';
import { Mic, type MicPermission } from './mic';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const DIALECTS: { code: string; name: string }[] = [
  { code: 'ar-AE', name: 'الإمارات' },
  { code: 'ar-SA', name: 'السعودية' },
  { code: 'ar-KW', name: 'الكويت' },
  { code: 'ar-QA', name: 'قطر' },
  { code: 'ar-JO', name: 'الأردن / الشام' },
  { code: 'ar-LB', name: 'لبنان' },
  { code: 'ar-EG', name: 'مصر' },
  { code: 'ar-IQ', name: 'العراق' },
  { code: 'ar-MA', name: 'المغرب' },
];

export type MicError = 'unsupported' | 'denied' | 'nomic' | 'network' | 'no-speech' | 'other';

export const MIC_ERROR_TEXT: Record<MicError, string> = {
  unsupported: 'متصفحك ما يحوّل الكلام لنص. افتح اللعبة بكروم أو إيدج أو سفاري، أو حط مفتاح Azure بالإعدادات.',
  denied: 'المتصفح ما سمح بالمايك. اضغط رمز القفل 🔒 جنب العنوان، واسمح للمايك، وبعدين جرّب مرة ثانية.',
  nomic: 'ما لقيت مايك بجهازك. وصّل مايك أو سماعة فيها مايك وجرّب مرة ثانية.',
  network: 'تحويل الكلام لنص يحتاج إنترنت. تأكد من الاتصال وجرّب مرة ثانية.',
  'no-speech': 'ما سمعت شي. قرّب من المايك وتكلم بوضوح.',
  other: 'صار خلل بالمايك. جرّب مرة ثانية.',
};

/**
 * Listening through the device's real microphone. The browser's permission prompt
 * comes first (getUserMedia), a live level shows the mic hears the player, and the
 * words come from the browser's speech recognition, or from Azure when configured or
 * when the browser has none.
 */
export class SpeechInput {
  private rec: Recognition | null = null;
  private readonly mic = new Mic();
  listening = false;
  lang = 'ar-AE';
  azure: AzureConfig | null = null;
  /** Last known permission, so a refusal does not re-prompt every press. */
  permission: MicPermission = 'prompt';

  static supported(): boolean {
    return recognitionCtor() !== null || Mic.supported();
  }

  /** Can the words be recognised here (browser engine, or Azure with a key)? */
  canRecognize(): boolean {
    return recognitionCtor() !== null || (!!this.azure && Mic.supported());
  }

  /** Ask for the microphone (the browser's own prompt). */
  async requestPermission(): Promise<MicPermission> {
    this.permission = await Mic.request();
    return this.permission;
  }

  /**
   * Listen for one utterance. Interim text streams to onInterim and the input level
   * to onLevel; resolves with the final text ('' if nothing was heard). Rejects with
   * a MicError.
   */
  async listen(onInterim: (text: string) => void, onLevel: (level: number) => void = () => {}): Promise<string> {
    if (!Mic.supported() && !recognitionCtor()) throw 'unsupported' satisfies MicError;
    this.stop();
    this.listening = true;
    try {
      if (Mic.supported() && this.permission !== 'granted') {
        this.permission = await Mic.request();
        if (this.permission === 'denied') throw 'denied' satisfies MicError;
        if (this.permission === 'nomic') throw 'nomic' satisfies MicError;
      }
      if (!recognitionCtor()) {
        if (!this.azure) throw 'unsupported' satisfies MicError;
        return await this.listenCloud(onInterim, onLevel);
      }
      try {
        return await this.listenBrowser(onInterim, onLevel);
      } catch (e) {
        // Some browsers ship the API without a working service; Azure can stand in.
        if (this.azure && (e === 'network' || e === 'denied') && Mic.supported() && this.permission === 'granted') return await this.listenCloud(onInterim, onLevel);
        throw e;
      }
    } finally {
      this.listening = false;
      this.mic.close();
      onLevel(0);
    }
  }

  private async listenCloud(onInterim: (text: string) => void, onLevel: (level: number) => void): Promise<string> {
    const wav = await this.mic.record(onLevel);
    if (!wav) return '';
    onInterim('…');
    try {
      return await azureRecognize(this.azure!, wav, this.lang);
    } catch {
      throw 'network' satisfies MicError;
    }
  }

  private listenBrowser(onInterim: (text: string) => void, onLevel: (level: number) => void): Promise<string> {
    const Ctor = recognitionCtor()!;
    // A level meter from the same microphone; phones keep the mic for recognition only.
    const meter = !matchMedia('(pointer: coarse)').matches && Mic.supported();
    let raf = 0;
    if (meter)
      void this.mic
        .start()
        .then(() => {
          const tick = () => {
            if (!this.mic.open) return;
            onLevel(this.mic.level());
            raf = requestAnimationFrame(tick);
          };
          tick();
        })
        .catch(() => {});
    return new Promise<string>((resolve, reject) => {
      const rec = new Ctor();
      this.rec = rec;
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      let settled = false;
      // Never listen forever if the recognition service goes quiet.
      const cap = setTimeout(() => {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }, 15000);
      const end = () => {
        cancelAnimationFrame(raf);
        clearTimeout(cap);
      };
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (!meter) onLevel(0.6);
        onInterim((finalText + ' ' + interim).trim());
      };
      rec.onerror = (e) => {
        if (settled) return;
        settled = true;
        end();
        if (e.error === 'aborted') return resolve(finalText.trim());
        const code: MicError = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'audio-capture' ? 'nomic' : e.error === 'network' ? 'network' : e.error === 'no-speech' ? 'no-speech' : 'other';
        reject(code);
      };
      rec.onend = () => {
        end();
        if (!settled) {
          settled = true;
          resolve(finalText.trim());
        }
      };
      try {
        rec.start();
      } catch {
        settled = true;
        end();
        reject('other' satisfies MicError);
      }
    });
  }

  /** Finish listening now; the pending listen() resolves with what was heard so far. */
  stop(): void {
    this.mic.finish();
    if (this.rec) {
      try {
        this.rec.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  abort(): void {
    this.mic.close();
    if (this.rec) {
      try {
        this.rec.abort();
      } catch {
        /* already stopped */
      }
      this.rec = null;
    }
    this.listening = false;
  }
}

// ---------------------------------------------------------------------------
// Speech output
// ---------------------------------------------------------------------------

const FEMALE_HINTS = ['fatima', 'zariyah', 'noura', 'amal', 'laila', 'layla', 'aysha', 'salma', 'sana', 'amany', 'rana', 'iman', 'mouna', 'reem', 'hoda', 'amina', 'mariam', 'maryam', 'mona', 'farah', 'hala', 'dalia', 'nour', 'yasmin', 'female', 'woman'];
const MALE_HINTS = ['hamdan', 'hamed', 'fahed', 'moaz', 'abdullah', 'saleh', 'taim', 'laith', 'rami', 'shakir', 'bassel', 'hedi', 'jamal', 'ismael', 'omar', 'naayf', 'maged', 'majed', 'tarik', 'tarek', 'zayd', 'hamid', 'khalid', 'male', 'man'];
const isFemale = (v: SpeechSynthesisVoice) => FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h));
const isMale = (v: SpeechSynthesisVoice) => !isFemale(v) && MALE_HINTS.some((h) => new RegExp(`\\b${h}\\b`).test(v.name.toLowerCase()));
/** Neural / natural voices sound like people; old system voices sound like machines. */
export const isNatural = (v: SpeechSynthesisVoice) => /natural|neural|online|premium|enhanced|wavenet/i.test(v.name) || /google/i.test(v.name);
/** Characters whose own dialect voice fits better than a Gulf one. */
const DIALECT: Record<string, string> = { electro: 'LB', shawarma: 'SY', barber: 'EG' };

export interface VoiceProfile {
  gender: 'm' | 'f';
  pitch: number;
  rate: number;
  /** Stable key so one character always gets the same voice. */
  key: string;
}

/** A short silent WAV, played once inside a tap so later audio may play (iOS, Safari). */
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/**
 * Speaking out loud in Arabic: the most natural Arabic voice the device has (Edge,
 * Android and Apple ship neural Arabic voices, Gulf ones where available), matched to
 * each character's gender and dialect; or Azure neural voices when a key is set.
 */
export class SpeechOutput {
  enabled = true;
  rateScale = 1;
  volume = 1;
  azure: AzureConfig | null = null;
  lastError = '';
  private voices: SpeechSynthesisVoice[] = [];
  private speakingUtterance: SpeechSynthesisUtterance | null = null;
  private readonly audio: HTMLAudioElement | null = typeof Audio !== 'undefined' ? new Audio() : null;
  private readonly cache = new Map<string, string>();
  private playing: (() => void) | null = null;
  private ctl: AbortController | null = null;

  constructor() {
    if (!SpeechOutput.supported()) return;
    const load = () => (this.voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ar')));
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  static supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** Call inside a click/tap: lets speech and audio play later without one. */
  unlock(): void {
    if (SpeechOutput.supported()) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    if (this.audio) {
      this.audio.src = SILENCE;
      void this.audio.play().catch(() => {});
    }
  }

  get hasArabicVoice(): boolean {
    return this.voices.length > 0;
  }

  get voiceNames(): string[] {
    return this.voices.map((v) => `${v.name} (${v.lang})`);
  }

  /** What the player hears: the engine, the voice, and whether it sounds natural. */
  describe(): { engine: 'azure' | 'device' | 'none'; voice: string; natural: boolean } {
    if (this.azure) return { engine: 'azure', voice: 'Azure (أصوات خليجية وشامية ومصرية)', natural: true };
    const v = this.pickVoice({ gender: 'm', pitch: 1, rate: 1, key: 'sanad' });
    if (!v) return { engine: 'none', voice: '', natural: false };
    return { engine: 'device', voice: `${v.name} (${v.lang})`, natural: isNatural(v) };
  }

  /** Best voice for a character: natural first, then gender, Gulf (or the character's dialect), then spread. */
  private pickVoice(p: VoiceProfile): SpeechSynthesisVoice | null {
    if (!this.voices.length) return null;
    const dialect = DIALECT[p.key];
    const score = (v: SpeechSynthesisVoice) =>
      (isNatural(v) ? 100 : 0) +
      ((p.gender === 'f' ? isFemale(v) : isMale(v)) ? 60 : (p.gender === 'f' ? isMale(v) : isFemale(v)) ? -60 : 0) +
      (dialect && v.lang.toUpperCase().endsWith(dialect) ? 30 : /ar-(AE|SA|KW|QA|BH|OM)/i.test(v.lang) ? 20 : 0) +
      (/compact/i.test(v.name) ? -40 : 0);
    const best = Math.max(...this.voices.map(score));
    const top = this.voices.filter((v) => score(v) >= best - 15);
    let h = 0;
    for (let i = 0; i < p.key.length; i++) h = (h * 31 + p.key.charCodeAt(i)) >>> 0;
    return top[h % top.length];
  }

  /** Say a line. Resolves when finished (or immediately when muted). */
  speak(text: string, p: VoiceProfile, onBoundary?: (charIndex: number) => void): Promise<void> {
    const clean = text.replace(/[*_#]/g, '').replace(/\p{Extended_Pictographic}/gu, '').trim();
    if (!this.enabled || !clean) return Promise.resolve();
    this.cancel();
    if (this.azure && this.audio) return this.speakAzure(clean, p).catch((e) => {
      this.lastError = String((e as Error)?.message ?? e);
      return this.speakDevice(clean, p, onBoundary);
    });
    return this.speakDevice(clean, p, onBoundary);
  }

  private async speakAzure(text: string, p: VoiceProfile): Promise<void> {
    const v = azureVoice(p.key, p.gender);
    v.rate += (p.rate * this.rateScale - 1) * 100;
    const key = `${v.name}|${v.pitch}|${Math.round(v.rate)}|${text}`;
    let url = this.cache.get(key);
    if (!url) {
      const ctl = (this.ctl = new AbortController());
      const blob = await azureSpeak(this.azure!, text, v, ctl.signal);
      if (ctl.signal.aborted) return;
      url = URL.createObjectURL(blob);
      this.cache.set(key, url);
      if (this.cache.size > 60) {
        const [k, old] = this.cache.entries().next().value as [string, string];
        URL.revokeObjectURL(old);
        this.cache.delete(k);
      }
    }
    const audio = this.audio!;
    audio.src = url;
    audio.volume = this.volume;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        audio.onended = audio.onerror = null;
        if (this.playing === finish) this.playing = null;
        resolve();
      };
      this.playing = finish;
      audio.onended = finish;
      audio.onerror = () => reject(new Error('audio'));
      audio.play().catch(reject);
    });
  }

  private speakDevice(text: string, p: VoiceProfile, onBoundary?: (charIndex: number) => void): Promise<void> {
    if (!SpeechOutput.supported()) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pickVoice(p);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = 'ar-AE';
      // Without a voice of the right gender, the pitch carries the difference.
      const matched = v && (p.gender === 'f' ? isFemale(v) : isMale(v));
      u.pitch = Math.max(0.1, Math.min(2, p.pitch * (matched ? 1 : p.gender === 'f' ? 1.25 : 0.85)));
      u.rate = Math.max(0.5, Math.min(1.6, p.rate * this.rateScale));
      u.volume = this.volume;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        if (this.speakingUtterance === u) this.speakingUtterance = null;
        resolve();
      };
      // Some engines never fire onend; never wait longer than the line could take.
      const guard = setTimeout(finish, 1500 + text.length * 110);
      u.onend = finish;
      u.onerror = finish;
      if (onBoundary) u.onboundary = (e) => onBoundary(e.charIndex);
      this.speakingUtterance = u;
      speechSynthesis.speak(u);
    });
  }

  get speaking(): boolean {
    return this.speakingUtterance !== null || this.playing !== null;
  }

  cancel(): void {
    if (SpeechOutput.supported()) speechSynthesis.cancel();
    this.speakingUtterance = null;
    this.ctl?.abort();
    this.ctl = null;
    if (this.audio && this.playing) {
      this.audio.pause();
      const f = this.playing;
      this.playing = null;
      f();
    }
  }
}
