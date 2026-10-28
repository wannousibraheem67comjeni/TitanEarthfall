/**
 * Voice: Arabic speech recognition (the browser's Web Speech API) so characters hear
 * the player, and Arabic text-to-speech so they answer out loud with a voice that
 * suits them.
 */

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

export type MicError = 'unsupported' | 'denied' | 'network' | 'no-speech' | 'other';

export const MIC_ERROR_TEXT: Record<MicError, string> = {
  unsupported: 'متصفحك ما يدعم التعرف على الصوت. جرّب كروم أو إيدج أو سفاري، أو اكتب كلامك.',
  denied: 'المايك مقفول هنا. اسمح للمايك من إعدادات المتصفح (رمز القفل جنب العنوان)، أو اكتب كلامك، وتقدر تستخدم مايك الكيبورد.',
  network: 'التعرف على الصوت يحتاج إنترنت. تأكد من الاتصال، أو اكتب كلامك.',
  'no-speech': 'ما سمعت شي. قرّب من المايك وتكلم بعد الصفارة.',
  other: 'صار خلل بالمايك. جرّب مرة ثانية أو اكتب كلامك.',
};

export class SpeechInput {
  private rec: Recognition | null = null;
  listening = false;
  lang = 'ar-AE';

  static supported(): boolean {
    return recognitionCtor() !== null;
  }

  /**
   * Listen for one utterance. Interim text streams to onInterim; the final text
   * resolves the promise ('' if nothing was heard). Rejects with a MicError.
   */
  listen(onInterim: (text: string) => void): Promise<string> {
    const Ctor = recognitionCtor();
    if (!Ctor) return Promise.reject<string>('unsupported' satisfies MicError);
    this.stop();
    return new Promise<string>((resolve, reject) => {
      const rec = new Ctor();
      this.rec = rec;
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      let settled = false;
      rec.onstart = () => (this.listening = true);
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        onInterim((finalText + ' ' + interim).trim());
      };
      rec.onerror = (e) => {
        if (settled) return;
        const code: MicError = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'network' ? 'network' : e.error === 'no-speech' ? 'no-speech' : e.error === 'aborted' ? 'other' : 'other';
        if (e.error === 'aborted') {
          settled = true;
          resolve(finalText.trim());
          return;
        }
        settled = true;
        this.listening = false;
        reject(code);
      };
      rec.onend = () => {
        this.listening = false;
        if (!settled) {
          settled = true;
          resolve(finalText.trim());
        }
      };
      try {
        rec.start();
      } catch {
        settled = true;
        reject('other' satisfies MicError);
      }
    });
  }

  /** Finish listening now; the pending listen() resolves with what was heard so far. */
  stop(): void {
    if (this.rec) {
      try {
        this.rec.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  abort(): void {
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

const FEMALE_HINTS = ['hoda', 'laila', 'layla', 'salma', 'zariyah', 'amina', 'fatima', 'mariam', 'maryam', 'female', 'woman', 'reem', 'sana', 'nour', 'dalia', 'mona', 'farah', 'amal', 'hala', 'shakira'];
const MALE_HINTS = ['naayf', 'maged', 'majed', 'tarik', 'tarek', 'hamed', 'shakir', 'male', 'man', 'omar', 'hamdan', 'fahed', 'bassel', 'saleh', 'moaz', 'zayd', 'hamid', 'rami', 'khalid'];

export interface VoiceProfile {
  gender: 'm' | 'f';
  pitch: number;
  rate: number;
  /** Stable key so one character always gets the same voice. */
  key: string;
}

export class SpeechOutput {
  enabled = true;
  rateScale = 1;
  volume = 1;
  private voices: SpeechSynthesisVoice[] = [];
  private speakingUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (!SpeechOutput.supported()) return;
    const load = () => (this.voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ar')));
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  static supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  get hasArabicVoice(): boolean {
    return this.voices.length > 0;
  }

  get voiceNames(): string[] {
    return this.voices.map((v) => `${v.name} (${v.lang})`);
  }

  /** Choose a voice matching the gender when names give it away; spread the rest. */
  private pickVoice(p: VoiceProfile): SpeechSynthesisVoice | null {
    if (!this.voices.length) return null;
    const by = (hints: string[]) => this.voices.filter((v) => hints.some((h) => v.name.toLowerCase().includes(h)));
    const pool = (p.gender === 'f' ? by(FEMALE_HINTS) : by(MALE_HINTS)).filter((v) => !(p.gender === 'f' ? by(MALE_HINTS) : by(FEMALE_HINTS)).includes(v));
    const list = pool.length ? pool : this.voices;
    // Prefer Gulf voices, then Saudi, for the setting.
    const gulf = list.filter((v) => /ar-(AE|SA|KW|QA|BH|OM)/i.test(v.lang));
    const final = gulf.length ? gulf : list;
    let h = 0;
    for (let i = 0; i < p.key.length; i++) h = (h * 31 + p.key.charCodeAt(i)) >>> 0;
    return final[h % final.length];
  }

  /**
   * Say a line. Resolves when finished (or immediately when muted). Without a
   * gender-matched voice the pitch carries the difference.
   */
  speak(text: string, p: VoiceProfile): Promise<void> {
    if (!this.enabled || !SpeechOutput.supported() || !text.trim()) return Promise.resolve();
    this.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text.replace(/[*_#]/g, ''));
      const v = this.pickVoice(p);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = 'ar-SA';
      const matched = v && (p.gender === 'f' ? FEMALE_HINTS : MALE_HINTS).some((h) => v.name.toLowerCase().includes(h));
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
      this.speakingUtterance = u;
      speechSynthesis.speak(u);
    });
  }

  get speaking(): boolean {
    return this.speakingUtterance !== null;
  }

  cancel(): void {
    if (SpeechOutput.supported()) speechSynthesis.cancel();
    this.speakingUtterance = null;
  }
}
