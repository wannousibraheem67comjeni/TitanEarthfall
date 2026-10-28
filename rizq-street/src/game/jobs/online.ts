/**
 * Freelance gigs on the laptop. Each gig is a short task with a client brief; pay goes
 * to the bank (withdraw it as notes at the ATM). The old home laptop handles typing,
 * proofreading and ad copy; the new laptop adds translation and logo design.
 */
import type { Rng } from '../../core/rng';
import { normalizeArabic } from '../../lang/arabic';

export type GigKind = 'typing' | 'spelling' | 'arrange' | 'translate' | 'design';

export interface GigDef {
  kind: GigKind;
  title: string;
  client: string;
  base: number;
  needsLaptop: boolean;
  blurb: string;
}

export const GIGS: GigDef[] = [
  { kind: 'typing', title: 'إدخال بيانات', client: 'مخازن التمور الذهبية', base: 22, needsLaptop: false, blurb: 'اكتب أسماء المنتجات والعناوين بالضبط' },
  { kind: 'spelling', title: 'تدقيق إملائي', client: 'مجلة الفريج', base: 20, needsLaptop: false, blurb: 'اختر الكلمة المكتوبة صح' },
  { kind: 'arrange', title: 'كتابة إعلان', client: 'كافتيريا البحر', base: 24, needsLaptop: false, blurb: 'رتّب الكلمات عشان يطلع إعلان مفهوم' },
  { kind: 'translate', title: 'ترجمة', client: 'شركة شحن سريع', base: 38, needsLaptop: true, blurb: 'اختر الترجمة العربية الصحيحة' },
  { kind: 'design', title: 'تصميم شعار', client: 'محلات متنوعة', base: 48, needsLaptop: true, blurb: 'صمّم شعار حسب طلب الزبون' },
];

export const TYPING_LINES = [
  'تمر خلاص فاخر وزن كيلو',
  'شارع الشيخ زايد مبنى رقم 12',
  'طلبية رقم 2048 للتوصيل اليوم',
  'دهن عود كمبودي ثلاث تولات',
  'فاتورة كهرباء شهر رمضان',
  'قهوة عربية بالهيل والزعفران',
  'حي الرفاعة فيلا رقم 7',
  'كرتون ماء صغير 24 حبة',
  'موعد التسليم يوم الخميس',
  'خصم عشرين بالمية على الملابس',
  'عسل سدر جبلي أصلي',
  'سجادة صلاة مع بوصلة',
];

/** Right word first, then common misspellings. */
export const SPELLING: [string, string, string][] = [
  ['إن شاء الله', 'إنشاء الله', 'انشالله'],
  ['لكن', 'لاكن', 'لكين'],
  ['هذا', 'هاذا', 'هذى'],
  ['مسؤول', 'مسئوول', 'مسؤل'],
  ['شيء', 'شيئ', 'شئ'],
  ['ذلك', 'ذالك', 'ذلكا'],
  ['إلى', 'إلا', 'الي'],
  ['قرأ', 'قراء', 'قرئ'],
  ['مكتبة', 'مكتبت', 'مكتبه'],
  ['أصدقاء', 'أصدقائ', 'اصدقاا'],
  ['هؤلاء', 'هاؤلاء', 'هئولاء'],
  ['ضابط', 'ظابط', 'ضابظ'],
  ['ظهر', 'ضهر', 'زهر'],
  ['بالتوفيق', 'بلتوفيق', 'بالتفيق'],
];

export const ADS = [
  'تخفيضات كبيرة على كل العطور هذا الأسبوع',
  'كرك حار وطازج على مدار الساعة',
  'توصيل مجاني للطلبات فوق خمسين درهم',
  'افتتاح فرع جديد قريب من الحديقة',
  'غسيل سيارات احترافي بأسعار مناسبة',
  'دورات تعليم برمجة للأطفال في الصيف',
];

export const TRANSLATIONS: [string, string, string, string][] = [
  ['Receipt', 'إيصال', 'وصفة', 'استقبال'],
  ['Delivery', 'توصيل', 'تأخير', 'ولادة'],
  ['Discount', 'خصم', 'نقاش', 'اكتشاف'],
  ['Customer', 'زبون', 'جمارك', 'عادة'],
  ['Invoice', 'فاتورة', 'دعوة', 'صوت'],
  ['Warehouse', 'مستودع', 'بيت حرب', 'مصنع'],
  ['Refund', 'استرداد المبلغ', 'إعادة التمويل', 'صندوق'],
  ['Schedule', 'جدول', 'مدرسة', 'شهادة'],
  ['Shipping', 'شحن', 'سفن', 'تسوق'],
  ['Salary', 'راتب', 'سلطة', 'ملح'],
  ['Meeting', 'اجتماع', 'لحم', 'قياس'],
  ['Out of stock', 'نفدت الكمية', 'خارج المخزن', 'المخزون قديم'],
  ['Fragile', 'قابل للكسر', 'خفيف', 'هش وطري'],
  ['Opening hours', 'أوقات الدوام', 'ساعات مفتوحة', 'فتحة الساعة'],
];

export const LOGO_COLORS = [
  { id: 'red', name: 'أحمر', hex: '#c8352b' },
  { id: 'green', name: 'أخضر', hex: '#2f8a57' },
  { id: 'blue', name: 'أزرق', hex: '#2b67b3' },
  { id: 'gold', name: 'ذهبي', hex: '#d4a02c' },
  { id: 'pink', name: 'وردي', hex: '#e07aa0' },
  { id: 'black', name: 'أسود', hex: '#222222' },
];
export const LOGO_SHAPES = [
  { id: 'circle', name: 'دائرة' },
  { id: 'square', name: 'مربع' },
  { id: 'shield', name: 'درع' },
];
export const LOGO_ICONS = [
  { id: 'cup', name: 'فنجان', glyph: '☕' },
  { id: 'fish', name: 'سمكة', glyph: '🐟' },
  { id: 'flower', name: 'وردة', glyph: '🌹' },
  { id: 'car', name: 'سيارة', glyph: '🚗' },
  { id: 'book', name: 'كتاب', glyph: '📖' },
  { id: 'palm', name: 'نخلة', glyph: '🌴' },
];

export const LOGO_BRIEFS: { line: string; color: string; shape: string; icon: string }[] = [
  { line: 'شعار لمقهى قهوة عربية: ذهبي، دائري، وفيه فنجان', color: 'gold', shape: 'circle', icon: 'cup' },
  { line: 'محل سمك بالميناء: أزرق، مربع، وفيه سمكة', color: 'blue', shape: 'square', icon: 'fish' },
  { line: 'محل ورد: وردي، دائري، وفيه وردة', color: 'pink', shape: 'circle', icon: 'flower' },
  { line: 'مغسلة سيارات: أحمر، درع، وفيه سيارة', color: 'red', shape: 'shield', icon: 'car' },
  { line: 'مكتبة للأطفال: أخضر، مربع، وفيه كتاب', color: 'green', shape: 'square', icon: 'book' },
  { line: 'مزرعة تمور: أخضر، درع، وفيه نخلة', color: 'green', shape: 'shield', icon: 'palm' },
  { line: 'كافيه شبابي: أسود، مربع، وفيه فنجان', color: 'black', shape: 'square', icon: 'cup' },
];

/** Letters that differ after normalisation, capped by the longer string (Levenshtein). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

/** Typing accuracy 0–1, forgiving hamza/taa-marbuta differences via normalisation. */
export function typingAccuracy(typed: string, target: string): number {
  const a = normalizeArabic(typed);
  const b = normalizeArabic(target);
  if (!b.length) return 0;
  return Math.max(0, 1 - editDistance(a, b) / b.length);
}

export function pickGigTasks<T>(rng: Rng, pool: readonly T[], n: number): T[] {
  return rng.shuffle(pool).slice(0, n);
}

/** Final pay for a gig: base × quality, then skill and laptop multipliers applied by the caller. */
export function gigPay(base: number, quality: number): number {
  if (quality < 0.4) return 0;
  return Math.round(base * quality * (quality >= 0.999 ? 1.2 : 1));
}
