/**
 * Arabic text utilities: normalisation for matching (spelling variants, diacritics,
 * dialect forms), tokenisation with clitic stripping, number words in Gulf, Levantine,
 * Egyptian and Modern Standard forms, and the small amount of grammar the game needs
 * when it talks back (dirham counts, gendered address).
 */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const PUNCT = /[.,!?؟،؛;:"'()\[\]{}«»…\-_/\\*+=<>|~`@#$%^&]+/g;

/** Map Arabic-Indic and Persian digits to ASCII. */
export function asciiDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalise text for matching: unify alef/hamza forms, taa marbuta, alef maqsura,
 * strip diacritics, tatweel and punctuation, lowercase Latin, collapse spaces.
 * The Arabic decimal separator (٫) becomes a dot so "١٢٫٥" stays one number.
 */
export function normalizeArabic(text: string): string {
  let s = asciiDigits(text.toLowerCase());
  s = s.replace(/٫/g, '.').replace(/٬/g, '');
  s = s.replace(DIACRITICS, '').replace(TATWEEL, '');
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '');
  s = s.replace(/گ/g, 'ك').replace(/ڤ/g, 'ف').replace(/چ/g, 'ج').replace(/پ/g, 'ب');
  // Keep decimal points between digits, drop every other punctuation mark.
  s = s.replace(/(\d)\.(\d)/g, '$1\u0001$2').replace(PUNCT, ' ').replace(/\u0001/g, '.');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokenize(text: string): string[] {
  const n = normalizeArabic(text);
  return n ? n.split(' ') : [];
}

const PREFIXES = ['وبال', 'وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ل', 'ك'];

/**
 * A token and the forms it takes once leading clitics (and, the, with, to) are
 * removed: "والشغل" → ["والشغل", "الشغل", "شغل"]. Remainders shorter than two
 * letters are not offered.
 */
export function tokenVariants(token: string): string[] {
  const out = [token];
  for (const p of PREFIXES) {
    if (token.startsWith(p) && token.length - p.length >= 2) {
      const rest = token.slice(p.length);
      if (!out.includes(rest)) out.push(rest);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

type NumKind = 'unit' | 'teen' | 'ten' | 'hundred' | 'thousand' | 'fraction';
interface NumWord {
  value: number;
  kind: NumKind;
}

const NUMBER_WORDS = new Map<string, NumWord>();
function defineNumbers(kind: NumKind, value: number, words: string): void {
  for (const w of words.split(' ')) NUMBER_WORDS.set(normalizeArabic(w), { value, kind });
}
defineNumbers('unit', 0, 'صفر');
defineNumbers('unit', 1, 'واحد واحدة وحدة احدى');
defineNumbers('unit', 2, 'اثنين اثنان اثنتين اثنتان ثنين ثنتين اتنين تنين اثنا اثني اثنتا اثنتي');
defineNumbers('unit', 3, 'ثلاث ثلاثة تلات تلاتة تلت');
defineNumbers('unit', 4, 'اربع اربعة');
defineNumbers('unit', 5, 'خمس خمسة');
defineNumbers('unit', 6, 'ست ستة');
defineNumbers('unit', 7, 'سبع سبعة');
defineNumbers('unit', 8, 'ثمان ثماني ثمانية ثمنية تمان تماني تمانية تمنية');
defineNumbers('unit', 9, 'تسع تسعة');
defineNumbers('unit', 10, 'عشر عشرة');
defineNumbers('teen', 11, 'احدعش حدعش حداش احداشر حداشر احدعشر');
defineNumbers('teen', 12, 'اثنعش اطنعش طنعش اتناشر اثناشر اثنعشر');
defineNumbers('teen', 13, 'ثلطعش تلتعش تلطعش ثلاثطعش تلتاشر ثلاثتعش');
defineNumbers('teen', 14, 'اربعطعش اربعتعش اربعتاشر ربعطعش');
defineNumbers('teen', 15, 'خمسطعش خمستعش خمستاشر خمسعش');
defineNumbers('teen', 16, 'سطعش ستعش ستاشر');
defineNumbers('teen', 17, 'سبعطعش سبعتعش سبعتاشر');
defineNumbers('teen', 18, 'ثمنطعش ثمانطعش تمنتعش تمنتاشر ثمنتعش');
defineNumbers('teen', 19, 'تسعطعش تسعتعش تسعتاشر');
defineNumbers('ten', 20, 'عشرين عشرون');
defineNumbers('ten', 30, 'ثلاثين ثلاثون تلاتين');
defineNumbers('ten', 40, 'اربعين اربعون');
defineNumbers('ten', 50, 'خمسين خمسون');
defineNumbers('ten', 60, 'ستين ستون');
defineNumbers('ten', 70, 'سبعين سبعون');
defineNumbers('ten', 80, 'ثمانين ثمانون تمانين');
defineNumbers('ten', 90, 'تسعين تسعون');
defineNumbers('hundred', 100, 'مية مئة مائة ميت مية');
defineNumbers('hundred', 200, 'ميتين مئتين مئتان مايتين ميتان');
defineNumbers('hundred', 300, 'ثلاثمية ثلاثمئة ثلاثمائة تلتمية تلاتمية');
defineNumbers('hundred', 400, 'اربعمية اربعمئة اربعمائة');
defineNumbers('hundred', 500, 'خمسمية خمسمئة خمسمائة');
defineNumbers('hundred', 600, 'ستمية ستمئة ستمائة');
defineNumbers('hundred', 700, 'سبعمية سبعمئة سبعمائة');
defineNumbers('hundred', 800, 'ثمانمية ثمنمية تمنمية ثمانمئة ثمانمائة');
defineNumbers('hundred', 900, 'تسعمية تسعمئة تسعمائة');
defineNumbers('thousand', 1000, 'الف الاف الوف تلاف آلاف');
defineNumbers('thousand', 2000, 'الفين الفان');
defineNumbers('fraction', 0.5, 'نص نصف');
defineNumbers('fraction', 0.25, 'ربع');

const DIRHAM_DUAL = new Set(['درهمين', 'درهمان']);
const DIRHAM_ONE = new Set(['درهم']);

function lookupNumber(token: string): { word: NumWord; joined: boolean } | null {
  const direct = NUMBER_WORDS.get(token);
  if (direct) return { word: direct, joined: false };
  // "وعشرين", "بخمسة", "والف", "بالف": a conjunction or preposition glued on.
  for (const p of ['وب', 'و', 'ب', 'بال', 'وال', 'ال']) {
    if (token.startsWith(p)) {
      const w = NUMBER_WORDS.get(token.slice(p.length));
      if (w) return { word: w, joined: p.startsWith('و') };
    }
  }
  return null;
}

/**
 * Every number in a sentence, in order. Understands digits ("45", "١٢٫٥") and
 * spoken forms: "خمسة وعشرين" = 25, "ميه وخمسين" = 150, "ثلاث مية" = 300,
 * "الفين وخمسمية" = 2500, "خمسطعش" = 15, "عشرة آلاف" = 10000, "درهم ونص" = 1.5,
 * "درهمين" = 2. Words that are not part of a number end the current one, so
 * "خمسة خبز وثلاث حليب" gives [5, 3].
 */
export function parseNumbers(text: string): number[] {
  const tokens = tokenize(text);
  const out: number[] = [];
  let total = 0; // thousands already closed
  let current = 0; // value below a thousand being built
  let lastUnit: number | null = null; // a bare unit just read (for "ثلاث مية", "خمس الاف", "خمسة عشر")
  let active = false;
  let looseJoin = false; // a free-standing "و" between two number words

  const flush = () => {
    if (active) out.push(total + current);
    total = 0;
    current = 0;
    lastUnit = null;
    active = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    if (tok === 'و') {
      looseJoin = active;
      continue;
    }
    if (tok === 'احد' && (tokens[i + 1] === 'عشر' || tokens[i + 1] === 'عشره')) tok = 'واحد';
    if (/^\d+(\.\d+)?$/.test(tok)) {
      flush();
      out.push(Number(tok));
      looseJoin = false;
      continue;
    }
    const bare = tok.startsWith('و') ? tok.slice(1) : tok;
    if (DIRHAM_DUAL.has(bare)) {
      if (active && (tok.startsWith('و') || looseJoin)) {
        current += 2;
        lastUnit = null;
      } else if (!active) {
        out.push(2);
      }
      looseJoin = false;
      continue;
    }
    const hit = lookupNumber(tok);
    if (!hit) {
      if (DIRHAM_ONE.has(tok.replace(/^(ب|ال|بال)/, ''))) {
        // "درهم" after a number is only the unit; on its own it means one dirham.
        if (!active) {
          const next = tokens[i + 1];
          const nextWord = next === undefined ? null : lookupNumber(next);
          const nextIsNumber = next !== undefined && (nextWord !== null || /^\d/.test(next));
          if (!nextIsNumber || nextWord?.word.kind === 'fraction') {
            current = 1;
            active = true;
          }
        }
        continue;
      }
      flush();
      looseJoin = false;
      continue;
    }
    const { word } = hit;
    const joined = hit.joined || looseJoin;
    looseJoin = false;
    // A new number starts unless this word is joined to the previous one with "و",
    // or multiplies/extends it (مية، الف، عشر after a unit).
    const isTeenTen = word.kind === 'unit' && word.value === 10 && lastUnit !== null && lastUnit < 10 && !joined;
    const isHundredOf = word.kind === 'hundred' && word.value === 100 && lastUnit !== null && lastUnit >= 1 && lastUnit <= 9 && !joined;
    const extendsPrev = active && (joined || isTeenTen || isHundredOf || word.kind === 'thousand');
    if (!extendsPrev) flush();
    active = true;
    switch (word.kind) {
      case 'unit':
        if (isTeenTen) {
          current += 10;
          lastUnit = null;
        } else {
          current += word.value;
          lastUnit = word.value;
        }
        break;
      case 'teen':
      case 'ten':
      case 'fraction':
        current += word.value;
        lastUnit = null;
        break;
      case 'hundred':
        current += isHundredOf ? lastUnit! * 100 - lastUnit! : word.value;
        lastUnit = null;
        break;
      case 'thousand':
        if (joined || current === 0) {
          total += word.value;
        } else {
          total += current * word.value;
          current = 0;
        }
        lastUnit = null;
        break;
    }
  }
  flush();
  return out;
}

export function firstNumber(text: string): number | null {
  const n = parseNumbers(text);
  return n.length ? n[0] : null;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
let useArabicDigits = false;

/** Western digits are what UAE shop signs and receipts use; Arabic-Indic is a setting. */
export function setArabicDigits(on: boolean): void {
  useArabicDigits = on;
}

export function formatNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, frac] = Math.abs(rounded).toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, useArabicDigits ? '٬' : ',');
  let s = (rounded < 0 ? '-' : '') + grouped + (frac ? (useArabicDigits ? '٫' : '.') + frac : '');
  if (useArabicDigits) s = s.replace(/\d/g, (d) => ARABIC_INDIC[Number(d)]);
  return s;
}

/** The counted noun after a number: 1 درهم، 2 درهمين، 3–10 دراهم، 11+ درهم. */
export function dirhamWord(n: number): string {
  const i = Math.abs(Math.round(n));
  if (n !== i) return 'درهم';
  if (i === 2) return 'درهمين';
  if (i >= 3 && i <= 10) return 'دراهم';
  return 'درهم';
}

/** "35 درهم", "2 درهمين" is awkward on screen, so two is written as a word. */
export function formatMoney(n: number): string {
  if (n === 1) return 'درهم واحد';
  if (n === 2) return 'درهمين';
  return `${formatNumber(n)} ${dirhamWord(n)}`;
}

/** "بدرهمين", "بـ15 درهم": a price after the preposition ب. */
export function priceWith(n: number): string {
  if (n === 1) return 'بدرهم';
  if (n === 2) return 'بدرهمين';
  return `بـ${formatMoney(n)}`;
}

/** "للمسجد", "لبقالة النور": the preposition ل joined to a place name. */
export function toPlace(name: string): string {
  return name.startsWith('ال') ? 'لل' + name.slice(2) : 'ل' + name;
}

export type Gender = 'm' | 'f';

/**
 * Fill a line written for both genders and with variables:
 * "يعطيك العافية يا {بطل|بطلة}، خذ {pay}" → picks the gendered form, then
 * substitutes {pay} from vars.
 */
export function fillTemplate(template: string, gender: Gender, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{([^{}|]*)\|([^{}]*)\}/g, (_, m: string, f: string) => (gender === 'f' ? f : m)).replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}
