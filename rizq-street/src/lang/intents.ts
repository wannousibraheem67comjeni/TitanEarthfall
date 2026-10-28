/**
 * Offline understanding of what the player says to a character. Phrases are written
 * as people actually say them (Gulf, Levantine, Egyptian and Standard Arabic, plus a
 * little English) and normalised once at load. Matching is per token, tolerant of
 * glued clitics ("والشغل" matches "شغل") and of suffixes on words marked with "*".
 */
import { normalizeArabic, parseNumbers, tokenize, tokenVariants } from './arabic';

export type Intent =
  | 'salam'
  | 'greet'
  | 'how_are_you'
  | 'fine'
  | 'ask_name'
  | 'ask_about'
  | 'ask_work'
  | 'accept'
  | 'decline'
  | 'thanks'
  | 'bye'
  | 'ask_price'
  | 'buy'
  | 'sell'
  | 'money_advice'
  | 'ask_location'
  | 'compliment'
  | 'insult'
  | 'apology'
  | 'please'
  | 'ask_time'
  | 'help'
  | 'story'
  | 'ask_pay'
  | 'negotiate'
  | 'weather'
  | 'family'
  | 'wallet_found';

interface IntentSpec {
  strong: string[];
  weak?: string[];
}

const SPECS: Record<Intent, IntentSpec> = {
  salam: { strong: ['السلام عليكم', 'سلام عليكم', 'السلام عليكم ورحمة الله', 'سلامو عليكم', 'السلام'], weak: ['سلام'] },
  greet: {
    strong: ['مرحبا', 'مرحبتين', 'مراحب', 'اهلا', 'اهلين', 'هلا', 'هلا والله', 'هلو', 'هاي', 'صباح الخير', 'صباح النور', 'مساء الخير', 'مساء النور', 'يا هلا', 'hi', 'hello', 'hey', 'هلا بك', 'حياك', 'اهلا وسهلا'],
  },
  how_are_you: {
    strong: ['كيفك', 'كيف حالك', 'كيف الحال', 'شلونك', 'شلونكم', 'شحالك', 'شحالكم', 'شخبارك', 'شو اخبارك', 'ايش اخبارك', 'كيف اخبارك', 'كيفكم', 'عساك بخير', 'شو الاخبار', 'كيف صحتك', 'how are you', 'ازيك', 'عامل ايه', 'كيف الصحه', 'شو الوضع', 'كيف الدنيا', 'كيف يومك'],
  },
  fine: { strong: ['الحمد لله', 'الحمدلله', 'بخير', 'منيح', 'كويس', 'ماشي الحال', 'تمام الحمد لله', 'زين الحمد لله', 'فل', 'good', 'fine', 'بخير والحمد لله', 'نحمد الله'], weak: ['تمام', 'زين', 'مبسوط'] },
  ask_name: { strong: ['شو اسمك', 'ايش اسمك', 'اسمك', 'منو انت', 'مين انت', 'من انت', 'عرفني عليك', 'what is your name', 'your name', 'مين حضرتك', 'منو حضرتك'] },
  ask_about: {
    strong: ['شو بتشتغل', 'شو شغلك', 'ايش تشتغل', 'شو تشتغل', 'شو هذا المحل', 'ايش تبيع', 'شو بتبيع', 'شو تبيع', 'شو عندك', 'ايش عندك', 'عن نفسك', 'قصتك', 'شو تسوي', 'ايش تسوي', 'شو بتعمل', 'شو تعمل', 'وش تسوي', 'وش عندك', 'شو هاد', 'ايش هذا', 'شو هذا'],
  },
  ask_work: {
    strong: [
      'شغل*', 'عمل', 'وظيف*', 'اشتغل', 'اشتغال', 'دوام', 'اعمل', 'ابي اشتغل', 'ابغى اشتغل', 'بدي اشتغل', 'اريد اعمل', 'عندك شغل', 'في شغل', 'فيه شغل', 'اقدر اساعدك', 'اساعدك', 'ساعدك', 'بساعدك',
      'احتاج شغل', 'تحتاج مساعده', 'تبي مساعده', 'بدك مساعده', 'ممكن اساعد', 'شي اسويه', 'شي اعمله', 'مهمه', 'مهام', 'job', 'work', 'تشغلني', 'شغلني', 'خليني اشتغل', 'خليني اساعدك', 'وظفني', 'عندكم شغل', 'محتاج عامل', 'تحتاجون حد',
    ],
    weak: ['فلوس', 'مصاري', 'بيزات', 'دراهم', 'اكسب', 'مساعده', 'ساعد'],
  },
  accept: {
    strong: [
      'نعم', 'اي', 'ايه', 'ايوه', 'ايوا', 'اكيد', 'موافق', 'موافقه', 'ماشي', 'اوكي', 'اوك', 'ok', 'okay', 'yes', 'يلا', 'يالله', 'حاضر', 'ان شاء الله', 'انشالله', 'ابشر', 'ابشري', 'من عيوني', 'على راسي', 'بكل سرور', 'طبعا', 'اوافق', 'يب', 'يس', 'اي والله', 'بلى',
      'مستعد', 'مستعده', 'جاهز', 'جاهزه', 'نبدا', 'ابدا', 'خلينا نبدا', 'يلا نبدا', 'اكيد ابي', 'ابي', 'ابغى', 'بدي', 'اريد', 'هيا', 'سم', 'ابشر طال عمرك', 'خلاص اوكي', 'تم', 'ليش لا', 'اوك يلا',
    ],
    weak: ['تمام', 'طيب', 'زين', 'خلاص', 'حلو'],
  },
  decline: {
    strong: ['لا', 'لاء', 'لا شكرا', 'مو الحين', 'مش هلا', 'مش هلق', 'مب الحين', 'بعدين', 'لاحقا', 'مره ثانيه', 'ما ابي', 'ما ابغى', 'ما بدي', 'مابدي', 'مابي', 'مابغى', 'مو حابب', 'مش حابب', 'no', 'ما اقدر', 'ما بقدر', 'مشغول', 'مشغوله', 'ارفض', 'مو لازم', 'مش لازم', 'nope', 'خليها بعدين', 'مو اليوم', 'لا مشكور', 'لا شكرا لك'],
  },
  thanks: {
    strong: ['شكرا', 'مشكور', 'مشكوره', 'يعطيك العافيه', 'الله يعطيك العافيه', 'تسلم', 'تسلمي', 'تسلم ايدك', 'جزاك الله خير', 'الله يجزاك خير', 'ممنون', 'thanks', 'thank you', 'يسلمو', 'يسلموا', 'مشكورين', 'thx', 'متشكر', 'شكرا جزيلا', 'الف شكر', 'كثر الله خيرك', 'ما قصرت', 'ما قصرتي', 'الله يسلمك'],
  },
  bye: {
    strong: ['مع السلامه', 'باي', 'باي باي', 'الله معك', 'في امان الله', 'فمان الله', 'الى اللقاء', 'اشوفك', 'نشوفك', 'يلا باي', 'تصبح على خير', 'تصبحين على خير', 'bye', 'goodbye', 'استاذن', 'بستاذن', 'اخليك', 'الله يحفظك', 'بشوفك بعدين', 'سلامات', 'see you'],
  },
  ask_price: { strong: ['كم سعر', 'بكم', 'بكام', 'قديش', 'بقديش', 'شقد', 'بشقد', 'السعر', 'سعره', 'سعرها', 'كم يكلف', 'شكثر', 'اديش', 'كم ثمن', 'كم حق', 'price', 'how much', 'كم الحساب', 'كم الفاتوره'], weak: ['كم'] },
  buy: {
    strong: ['اشتري', 'ابي اشتري', 'ابغى اشتري', 'بدي اشتري', 'اريد اشتري', 'شراء', 'عطني', 'اعطني', 'عطيني', 'اعطيني', 'جيب لي', 'حابب اخذ', 'خذ لي', 'بشتري', 'نشتري', 'buy', 'ممكن اخذ', 'ابي اخذ', 'بدي اخد'],
    weak: ['ابي', 'ابغى', 'بدي', 'اريد', 'ودي', 'اخذ', 'اخد'],
  },
  sell: { strong: ['ابيع', 'بيع', 'تشتري مني', 'اشتري مني', 'للبيع', 'sell', 'بدي بيع', 'ابي ابيع'] },
  money_advice: {
    strong: [
      'كيف اجمع', 'كيف اكسب', 'كيف احصل على فلوس', 'كيف اجيب فلوس', 'كيف اطلع مصاري', 'وين اشتغل', 'شو اشتغل', 'شو اسوي', 'ايش اسوي', 'وش اسوي', 'نصيحه', 'انصحني', 'شو تنصحني', 'فكره', 'افكار', 'كيف اصير غني', 'اغتني', 'كيف اوفر', 'توفير', 'ادخار', 'اوفر', 'اجمع فلوس', 'اجمع مصاري', 'اجمع دراهم', 'ابي فلوس', 'بدي مصاري', 'احتاج فلوس', 'محتاج فلوس', 'كيف اربح', 'ربح',
    ],
  },
  ask_location: { strong: ['وين', 'فين', 'وينه', 'وينها', 'مكان', 'كيف اروح', 'كيف اوصل', 'دلني', 'دليني', 'طريق', 'اين', 'where', 'وين القى', 'وين القي', 'ودني'] },
  compliment: {
    strong: ['انت طيب', 'انت حلو', 'انت رائع', 'الله يحفظك', 'ما شاء الله', 'ماشاء الله', 'انت احسن', 'الله يبارك فيك', 'رائع', 'ممتاز', 'شاطر', 'احبك', 'اسطوره', 'بطل', 'عظيم', 'كفو', 'يا حلو', 'انت كريم', 'كريم', 'طيب القلب', 'محترم', 'نعم الرجال', 'الله يخليك لنا'],
  },
  insult: { strong: ['غبي', 'حمار', 'تافه', 'اسكت', 'انقلع', 'كلب', 'حقير', 'خايس', 'ابله', 'سخيف', 'زفت', 'يلعن', 'shut up', 'stupid', 'idiot', 'اكرهك', 'وقح', 'بخيل'] },
  apology: { strong: ['اسف', 'اسفه', 'سامحني', 'سامحيني', 'معليش', 'المعذره', 'sorry', 'اعتذر', 'حقك علي', 'ما قصدت'] },
  please: { strong: ['لو سمحت', 'لو سمحتي', 'من فضلك', 'الله يخليك', 'بليز', 'please', 'اذا ممكن', 'لو تكرمت', 'تكرم', 'الله يرضى عليك', 'الله يعافيك'] },
  ask_time: { strong: ['كم الساعه', 'الساعه كم', 'شو الساعه', 'قديش الساعه', 'what time', 'الوقت كم', 'كم الوقت'] },
  help: { strong: ['ساعدني', 'كيف العب', 'شو لازم اعمل', 'شو لازم اسوي', 'ما فهمت', 'مش فاهم', 'مو فاهم', 'علمني', 'help', 'اشرح', 'اشرح لي', 'كيف يعني', 'شلون يعني'] },
  story: { strong: ['نكته', 'قول نكته', 'ضحكني', 'joke', 'سولف', 'سالفه', 'قصه', 'احكيلي', 'خبرني', 'حكايه', 'سولف لي', 'قول لي شي', 'زمان', 'ايام زمان', 'الغوص', 'اللولو'] },
  ask_pay: { strong: ['كم الراتب', 'كم الاجر', 'كم تدفع', 'كم بتعطيني', 'كم تعطيني', 'كم بطلع', 'كم الفلوس', 'الاجره', 'اجرتي', 'حسابي', 'ادفع لي', 'فلوسي', 'راتب', 'معاش', 'كم المعاش', 'كم تعطي', 'كم الدفع', 'كم اخذ'] },
  negotiate: { strong: ['زياده', 'زود', 'زيد', 'ارفع', 'ما يكفي', 'نزل', 'خصم', 'ارخص', 'غالي', 'غاليه', 'تخفيض', 'سعر خاص', 'خفض'], weak: ['اكثر', 'اقل', 'قليل'] },
  weather: { strong: ['الجو', 'حر', 'حار', 'شوب', 'رطوبه', 'برد', 'الطقس', 'weather', 'الشمس', 'غبار'] },
  family: { strong: ['امي', 'ابوي', 'جدي', 'اهلي', 'عائلتي', 'اخوي', 'اختي', 'ماما', 'بابا', 'يمه', 'يبه', 'امك', 'ابوك', 'ولدك', 'عيالك', 'بيتكم'] },
  wallet_found: { strong: ['محفظه', 'محفظتك', 'لقيت', 'لقيتها', 'ضايعه', 'ضاعت', 'وجدت', 'شنطه', 'جزدان', 'بوك'] },
};

const NEGATIONS = new Set(['ما', 'مو', 'مش', 'مب', 'لا', 'مافي', 'ماكو', 'بدون']);

interface Pattern {
  intent: Intent;
  words: string[];
  weight: number;
}

/** Each phrase is normalised once; single generic words count less than phrases. */
function compile(): Pattern[] {
  const out: Pattern[] = [];
  for (const [intent, spec] of Object.entries(SPECS) as [Intent, IntentSpec][]) {
    for (const [list, base] of [
      [spec.strong, 1],
      [spec.weak ?? [], 0.45],
    ] as const) {
      for (const phrase of list) {
        const words = phrase.split(' ').map((w) => (w.endsWith('*') ? normalizeArabic(w.slice(0, -1)) + '*' : normalizeArabic(w)));
        out.push({ intent, words, weight: base * (1 + 0.6 * (words.length - 1)) });
      }
    }
  }
  return out;
}
const PATTERNS = compile();

function wordMatches(variants: string[], word: string): boolean {
  if (word.endsWith('*')) {
    const stem = word.slice(0, -1);
    return variants.some((v) => v.startsWith(stem) && v.length - stem.length <= 3);
  }
  return variants.includes(word);
}

/** Index of the first token where the phrase matches, or -1. */
function findPhrase(variants: string[][], words: string[]): number {
  outer: for (let i = 0; i + words.length <= variants.length; i++) {
    for (let j = 0; j < words.length; j++) if (!wordMatches(variants[i + j], words[j])) continue outer;
    return i;
  }
  return -1;
}

/** A named thing the player may mention: a place, a product, a job. */
export interface LexiconEntry<T extends string> {
  id: T;
  phrases: string[];
}

export class Lexicon<T extends string> {
  private readonly entries: { id: T; words: string[][] }[];

  constructor(entries: LexiconEntry<T>[]) {
    this.entries = entries.map((e) => ({
      id: e.id,
      words: e.phrases.map((p) => p.split(' ').map((w) => (w.endsWith('*') ? normalizeArabic(w.slice(0, -1)) + '*' : normalizeArabic(w)))),
    }));
  }

  /** Ids mentioned in the text, in order of first mention, each once. */
  find(variants: string[][]): T[] {
    const hits: { id: T; at: number; len: number }[] = [];
    for (const e of this.entries) {
      let best = -1;
      let len = 0;
      for (const w of e.words) {
        const at = findPhrase(variants, w);
        if (at >= 0 && (best < 0 || at < best || (at === best && w.length > len))) {
          best = at;
          len = w.length;
        }
      }
      if (best >= 0) hits.push({ id: e.id, at: best, len });
    }
    hits.sort((a, b) => a.at - b.at || b.len - a.len);
    return hits.map((h) => h.id);
  }
}

export interface Analysis {
  raw: string;
  norm: string;
  tokens: string[];
  scores: Map<Intent, number>;
  numbers: number[];
  /** Intents ordered by score. */
  ranked: Intent[];
  has(intent: Intent, min?: number): boolean;
  score(intent: Intent): number;
  variants: string[][];
}

export function analyze(text: string): Analysis {
  const tokens = tokenize(text);
  const variants = tokens.map(tokenVariants);
  const scores = new Map<Intent, number>();
  const negated = new Set<Intent>();
  for (const p of PATTERNS) {
    const at = findPhrase(variants, p.words);
    if (at < 0) continue;
    // "ما ابي شغل": a negation just before a request flips it into a refusal.
    const neg = (at > 0 && NEGATIONS.has(tokens[at - 1])) || (at > 1 && NEGATIONS.has(tokens[at - 2]) && p.intent !== 'decline');
    if (neg && (p.intent === 'ask_work' || p.intent === 'accept' || p.intent === 'buy')) {
      negated.add(p.intent);
      continue;
    }
    scores.set(p.intent, (scores.get(p.intent) ?? 0) + p.weight);
  }
  if (negated.size) scores.set('decline', (scores.get('decline') ?? 0) + 1);
  // A bare "سلام" or "لا" inside a longer sentence says less than on its own.
  if (tokens.length > 4) {
    for (const k of ['accept', 'decline'] as Intent[]) {
      const v = scores.get(k);
      if (v !== undefined && v < 1.5) scores.set(k, v * 0.6);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return {
    raw: text,
    norm: tokens.join(' '),
    tokens,
    variants,
    scores,
    numbers: parseNumbers(text),
    ranked,
    has: (intent, min = 0.4) => (scores.get(intent) ?? 0) >= min,
    score: (intent) => scores.get(intent) ?? 0,
  };
}
