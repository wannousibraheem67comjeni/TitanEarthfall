/** Achievements and settings: what the game remembers about how you play. */
import { JOBS } from './catalog';
import type { Store } from './state';

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  check(st: Store): boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', title: 'أول درهم', desc: 'اكسب أول فلوس من تعبك', icon: '🪙', check: (s) => s.s.earnedTotal >= 1 },
  { id: 'hundred', title: 'أول مية', desc: 'اجمع 100 درهم', icon: '💵', check: (s) => s.s.earnedTotal >= 100 },
  { id: 'thousand', title: 'ألف درهم', desc: 'اجمع 1,000 درهم', icon: '💰', check: (s) => s.s.earnedTotal >= 1000 },
  { id: 'fivek', title: 'تاجر صغير', desc: 'اجمع 5,000 درهم', icon: '🏦', check: (s) => s.s.earnedTotal >= 5000 },
  { id: 'saver', title: 'موفّر', desc: 'خلّ 500 درهم بالبنك', icon: '🐖', check: (s) => s.s.bank >= 500 },
  { id: 'honest', title: 'الأمين', desc: 'رجّع محفظة ضايعة لصاحبها', icon: '🤝', check: (s) => s.stat('walletsReturned') >= 1 },
  { id: 'family', title: 'بار بأهله', desc: 'ساعد أهلك 10 مرات', icon: '🏠', check: (s) => ['plants', 'trash', 'errand', 'perfume'].reduce((n, j) => n + (s.s.jobs[j as 'plants']?.total ?? 0), 0) >= 10 },
  { id: 'karak', title: 'معلم الكرك', desc: 'حضّر 30 كوب كرك', icon: '☕', check: (s) => s.stat('cupsMade') >= 30 },
  { id: 'cashier', title: 'حسّيب', desc: 'احسب لـ 25 زبون بالبقالة', icon: '🧾', check: (s) => s.stat('customersServed') >= 25 },
  { id: 'speedy', title: 'سريع كالبرق', desc: 'وصّل طلب وباقي أكثر من نص الوقت', icon: '⚡', check: (s) => s.stat('fastDeliveries') >= 1 },
  { id: 'voice', title: 'صوتك مسموع', desc: 'كلّم أهل الفريج بالمايك 10 مرات', icon: '🎤', check: (s) => s.stat('voiceTurns') >= 10 },
  { id: 'recycler', title: 'صديق البيئة', desc: 'دوّر 50 علبة', icon: '♻️', check: (s) => s.stat('cansRecycled') >= 50 },
  { id: 'freelancer', title: 'مستقل', desc: 'خلّص 10 شغلات أونلاين', icon: '💻', check: (s) => s.stat('gigs') >= 10 },
  { id: 'teacher', title: 'الأستاذ', desc: 'علي جاوب كل الأسئلة صح', icon: '📚', check: (s) => s.stat('perfectLessons') >= 1 },
  { id: 'salam', title: 'صاحب السلام', desc: 'سلّم على 10 أشخاص بـ«السلام عليكم»', icon: '🤲', check: (s) => s.stat('salams') >= 10 },
  { id: 'allround', title: 'يد ذهبية', desc: 'جرّب كل أنواع الشغل', icon: '🌟', check: (s) => JOBS.filter((j) => j.id !== 'recycle').every((j) => (s.s.jobs[j.id]?.total ?? 0) > 0) },
  { id: 'gift', title: 'هدية الغالية', desc: 'اشترِ هدية لأمك', icon: '🎁', check: (s) => s.has('gift') },
  { id: 'owner', title: 'صاحب المحل', desc: 'افتح محلك الخاص', icon: '🏪', check: (s) => s.has('shop') },
];

/** Unlock anything newly earned; returns what was unlocked now. */
export function checkAchievements(st: Store): Achievement[] {
  const out: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (st.s.achievements[a.id]) continue;
    if (a.check(st)) {
      st.s.achievements[a.id] = st.s.day;
      out.push(a);
    }
  }
  return out;
}

export interface Settings {
  voiceLang: string;
  tts: boolean;
  ttsRate: number;
  handsFree: boolean;
  brain: 'auto' | 'offline';
  apiKey: string;
  apiModel: string;
  volume: number;
  arabicDigits: boolean;
  quality: 'high' | 'low';
  labels: boolean;
}

const SETTINGS_KEY = 'rizq-street.settings';

export function defaultSettings(): Settings {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return { voiceLang: 'ar-AE', tts: true, ttsRate: 1, handsFree: false, brain: 'auto', apiKey: '', apiModel: 'claude-opus-5-5', volume: 0.8, arabicDigits: false, quality: coarse ? 'low' : 'high', labels: true };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}
