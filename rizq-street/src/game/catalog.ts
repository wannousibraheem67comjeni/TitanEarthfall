/**
 * What exists in the economy: banknotes, shop products, upgrades you can save up for,
 * and every way of earning money with its employer, hours and pay.
 */
import type { PlaceId } from '../world/layout';

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface Denomination {
  value: number;
  /** Paper notes are what the game is about; the one-dirham coin makes change. */
  paper: boolean;
  color: string;
  ink: string;
}

/** Stylised game notes: each denomination keeps its familiar colour family. */
export const DENOMINATIONS: Denomination[] = [
  { value: 1000, paper: true, color: '#4f7f73', ink: '#1f3b35' },
  { value: 500, paper: true, color: '#2c4f8a', ink: '#14264a' },
  { value: 200, paper: true, color: '#8c9a3a', ink: '#3c4512' },
  { value: 100, paper: true, color: '#c2453c', ink: '#5e1611' },
  { value: 50, paper: true, color: '#7a5aa6', ink: '#33204f' },
  { value: 20, paper: true, color: '#3f86b8', ink: '#123a57' },
  { value: 10, paper: true, color: '#3f9150', ink: '#123d1b' },
  { value: 5, paper: true, color: '#b07a3e', ink: '#4a2b0b' },
  { value: 1, paper: false, color: '#c9cdd2', ink: '#4a4f55' },
];

/** Greedy split into notes and coins; fractions of a dirham are dropped. */
export function breakdown(amount: number): { value: number; count: number }[] {
  let rest = Math.floor(Math.max(0, amount));
  const out: { value: number; count: number }[] = [];
  for (const d of DENOMINATIONS) {
    const count = Math.floor(rest / d.value);
    if (count > 0) {
      out.push({ value: d.value, count });
      rest -= count * d.value;
    }
  }
  return out;
}

export function denomination(value: number): Denomination {
  return DENOMINATIONS.find((d) => d.value === value) ?? DENOMINATIONS[DENOMINATIONS.length - 1];
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type ItemId =
  | 'bread'
  | 'milk'
  | 'water'
  | 'juice'
  | 'eggs'
  | 'rice'
  | 'tea'
  | 'sugar'
  | 'biscuits'
  | 'icecream'
  | 'dates'
  | 'cheese'
  | 'laban'
  | 'chips'
  | 'cans'
  | 'wallet'
  | 'trash'
  | 'food_order';

export interface Item {
  id: ItemId;
  name: string;
  /** Shelf price at the grocery, in dirhams. 0 for things you cannot buy. */
  price: number;
  /** Words customers and the player use for it. */
  phrases: string[];
  icon: string;
  /** Wholesale pack for the street stall: units per pack and pack price. */
  wholesale?: { units: number; price: number; sellHint: number };
}

export const ITEMS: Item[] = [
  { id: 'bread', name: 'خبز', price: 2, phrases: ['خبز', 'خبزه', 'صمون', 'رغيف', 'عيش ابيض'], icon: '🍞' },
  { id: 'milk', name: 'حليب', price: 6, phrases: ['حليب', 'لبن حليب', 'milk'], icon: '🥛' },
  { id: 'water', name: 'ماء', price: 1, phrases: ['ماء', 'ماي', 'مي', 'مويه', 'مياه', 'قنينة ماي', 'water'], icon: '💧', wholesale: { units: 12, price: 9, sellHint: 2 } },
  { id: 'juice', name: 'عصير', price: 3, phrases: ['عصير', 'عصيرات', 'juice'], icon: '🧃', wholesale: { units: 10, price: 18, sellHint: 4 } },
  { id: 'eggs', name: 'بيض', price: 12, phrases: ['بيض', 'كرتون بيض'], icon: '🥚' },
  { id: 'rice', name: 'رز', price: 25, phrases: ['رز', 'عيش', 'ارز', 'كيس رز'], icon: '🍚' },
  { id: 'tea', name: 'شاي', price: 9, phrases: ['شاي', 'علبة شاي', 'شاهي'], icon: '🍵' },
  { id: 'sugar', name: 'سكر', price: 5, phrases: ['سكر', 'كيس سكر'], icon: '🧂' },
  { id: 'biscuits', name: 'بسكويت', price: 2, phrases: ['بسكويت', 'بسكوت'], icon: '🍪' },
  { id: 'icecream', name: 'آيس كريم', price: 4, phrases: ['ايس كريم', 'ايسكريم', 'بوظه', 'ايس كريم', 'جيلاتي', 'ice cream'], icon: '🍦', wholesale: { units: 8, price: 20, sellHint: 5 } },
  { id: 'dates', name: 'تمر', price: 15, phrases: ['تمر', 'تمور', 'رطب'], icon: '🌴' },
  { id: 'cheese', name: 'جبن', price: 11, phrases: ['جبن', 'جبنه', 'جبنة'], icon: '🧀' },
  { id: 'laban', name: 'لبن', price: 3, phrases: ['لبن', 'روب', 'زبادي'], icon: '🥣' },
  { id: 'chips', name: 'شيبس', price: 2, phrases: ['شيبس', 'شبس', 'بطاطس', 'chips'], icon: '🥔' },
  { id: 'cans', name: 'علب فارغة', price: 0, phrases: ['علب', 'علبه', 'قناني', 'قنينه', 'علب فاضيه'], icon: '🥫' },
  { id: 'wallet', name: 'محفظة ضائعة', price: 0, phrases: ['محفظه', 'محفظة', 'جزدان', 'بوك'], icon: '👛' },
  { id: 'trash', name: 'كيس زبالة', price: 0, phrases: ['زباله', 'كيس زباله', 'قمامه'], icon: '🗑️' },
  { id: 'food_order', name: 'طلب شاورما', price: 0, phrases: ['طلب', 'شاورما'], icon: '🥡' },
];

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const GROCERY_ITEMS = ITEMS.filter((i) => i.price > 0);
export const STALL_ITEMS = ITEMS.filter((i) => i.wholesale);

export function item(id: ItemId): Item {
  return ITEM_BY_ID.get(id)!;
}

// ---------------------------------------------------------------------------
// Upgrades: what the money is for
// ---------------------------------------------------------------------------

export type UpgradeId = 'sneakers' | 'stall' | 'bike' | 'cooler' | 'phone' | 'laptop' | 'scooter' | 'gift' | 'shop';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  price: number;
  icon: string;
  effect: string;
  /** Sold by this place's keeper (also always available in the phone shop). */
  seller: PlaceId;
}

export const UPGRADES: Upgrade[] = [
  { id: 'sneakers', name: 'حذاء رياضي', price: 150, icon: '👟', effect: 'تمشي أسرع ونَفَسك أطول بالركض', seller: 'electronics' },
  { id: 'stall', name: 'بسطة متنقلة', price: 200, icon: '🧺', effect: 'تبيع ماي وعصير وآيس كريم عند مدخل الحديقة', seller: 'grocery' },
  { id: 'bike', name: 'دراجة هوائية', price: 450, icon: '🚲', effect: 'أسرع بمرتين تقريباً، والتوصيل يصير أسهل (زر B)', seller: 'electronics' },
  { id: 'cooler', name: 'ثلاجة متنقلة', price: 350, icon: '🧊', effect: 'البسطة تشيل ضعف البضاعة، والبارد ينباع أغلى', seller: 'grocery' },
  { id: 'phone', name: 'جوال ذكي', price: 900, icon: '📱', effect: 'تشتغل أونلاين من أي مكان، وبقشيش التوصيل يزيد', seller: 'electronics' },
  { id: 'laptop', name: 'لابتوب جديد', price: 1800, icon: '💻', effect: 'شغل أونلاين أكبر: ترجمة وتصميم، وأجر أعلى', seller: 'electronics' },
  { id: 'scooter', name: 'سكوتر كهربائي', price: 2500, icon: '🛴', effect: 'أسرع شي بالفريج', seller: 'electronics' },
  { id: 'gift', name: 'هدية لأمي', price: 3000, icon: '🎁', effect: 'عقد ذهب لأمك. مصروفها اليومي يتضاعف', seller: 'perfume' },
  { id: 'shop', name: 'محلك الخاص', price: 10000, icon: '🏪', effect: 'تفتح كشكك الخاص ويجيك دخل كل يوم', seller: 'electronics' },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

// ---------------------------------------------------------------------------
// Ways to earn
// ---------------------------------------------------------------------------

export type JobId =
  | 'plants'
  | 'trash'
  | 'errand'
  | 'cashier'
  | 'karak'
  | 'delivery'
  | 'perfume'
  | 'carwash'
  | 'tutor'
  | 'hamadcar'
  | 'barber'
  | 'online'
  | 'stall'
  | 'recycle'
  | 'sweep'
  | 'dishes'
  | 'tidy'
  | 'laundry'
  | 'coffee'
  | 'reception'
  | 'sales'
  | 'accounting'
  | 'trade';

export type NpcId = 'mum' | 'dad' | 'grandpa' | 'grocer' | 'karak' | 'shawarma' | 'carwash' | 'umali' | 'ali' | 'hamad' | 'electro' | 'barber' | 'hr' | 'partner';

export interface JobDef {
  id: JobId;
  title: string;
  employer: NpcId | null;
  place: PlaceId;
  /** Opening hours [from, to) in 24h clock; to may exceed 24 for after midnight. */
  hours: [number, number];
  /** Times per game day; omitted for unlimited shifts. */
  daily?: number;
  /** Typical pay for one round, used in conversation ("بعطيك حوالي 60 درهم"). */
  pay: number;
  /** Needs this upgrade first. */
  requires?: UpgradeId;
  /** One line for the phone's job board. */
  summary: string;
  /** First-person phrasing the employer uses in offers ("تساعدني …"). */
  task: string;
  /** Third-person phrasing for recommendations ("يبي أحد …"). */
  need: string;
  phrases: string[];
  family?: boolean;
  /** A job at the company: needs the interview, and `rank` once promoted. */
  company?: boolean;
  rank?: number;
}

export const JOBS: JobDef[] = [
  { id: 'plants', title: 'سقاية الزرع', employer: 'mum', place: 'home', hours: [6, 21], daily: 1, pay: 20, summary: 'اسقِ الستة أصص في حوش البيت', task: 'تسقي الزرع اللي بالحوش', need: 'يسقي الزرع', phrases: ['الزرع', 'سقي', 'اسقي', 'النباتات', 'الورد'], family: true },
  { id: 'trash', title: 'طلّع الزبالة', employer: 'mum', place: 'home', hours: [6, 23], daily: 1, pay: 15, summary: 'شيل كيسين الزبالة للحاوية برا', task: 'تطلع أكياس الزبالة للحاوية', need: 'يطلع الزبالة', phrases: ['الزباله', 'زباله', 'القمامه'], family: true },
  { id: 'errand', title: 'مقاضي البيت', employer: 'mum', place: 'grocery', hours: [7, 22], daily: 1, pay: 20, summary: 'اشترِ أغراض البيت من البقالة وارجع', task: 'تجيب أغراض من البقالة', need: 'يجيب أغراض البيت من البقالة', phrases: ['مقاضي', 'اغراض', 'المقاضي', 'تسوق', 'مشوار'], family: true },
  { id: 'cashier', title: 'كاشير بالبقالة', employer: 'grocer', place: 'grocery', hours: [7, 24], pay: 60, summary: 'احسب حساب الزباين ورجّع الباقي صح', task: 'توقف على الكاشير وتحاسب الزباين', need: 'يوقف على الكاشير', phrases: ['كاشير', 'الكاشير', 'حساب', 'تحاسب', 'الزباين'] },
  { id: 'karak', title: 'تحضير الكرك', employer: 'karak', place: 'karak', hours: [6, 25], pay: 50, summary: 'حضّر طلبات الكرك والشاي حسب الطلب', task: 'تحضر كرك للزباين', need: 'يساعده بتحضير الكرك', phrases: ['كرك', 'شاي', 'تحضير', 'اكواب', 'قهوه'] },
  { id: 'delivery', title: 'توصيل طلبات', employer: 'shawarma', place: 'shawarma', hours: [11, 25], pay: 25, summary: 'وصّل الطلبات للبيوت قبل ما تبرد', task: 'توصل الطلبات للبيوت', need: 'يوصل الطلبات للبيوت', phrases: ['توصيل', 'وصل', 'دليفري', 'طلبات', 'delivery'] },
  { id: 'perfume', title: 'مساعدة أبوي بالعطور', employer: 'dad', place: 'perfume', hours: [15, 24], pay: 70, summary: 'اخلط العطر اللي يطلبه الزبون', task: 'تساعدني مع الزباين وتخلط لهم العطور', need: 'يساعده مع زباين العطور', phrases: ['عطر', 'عطور', 'المحل', 'تخلط', 'دهن عود'], family: true },
  { id: 'carwash', title: 'غسيل سيارات', employer: 'carwash', place: 'carwash', hours: [7, 22], pay: 30, summary: 'نظّف كل البقع عن السيارة قبل ما يخلص الوقت', task: 'تغسل سيارات الزباين', need: 'يغسل سيارات الزباين', phrases: ['غسيل', 'سيارات', 'تغسل', 'سياره', 'تلميع'] },
  { id: 'tutor', title: 'تدريس علي', employer: 'umali', place: 'umali', hours: [15, 21], daily: 1, pay: 35, summary: 'ساعد علي بواجب الرياضيات', task: 'تدرس علي رياضيات شوي', need: 'يدرّس علي رياضيات', phrases: ['تدريس', 'درس', 'واجب', 'رياضيات', 'تدرس', 'علي'] },
  { id: 'hamadcar', title: 'غسيل سيارة العم حمد', employer: 'hamad', place: 'hamad', hours: [7, 19], daily: 1, pay: 40, summary: 'اغسل اللاندكروزر البيضا قدام بيته', task: 'تغسل سيارتي', need: 'يغسل سيارته', phrases: ['سيارتك', 'السياره', 'غسيل', 'اللاندكروزر', 'تغسل'] },
  { id: 'barber', title: 'ترتيب الصالون', employer: 'barber', place: 'barber', hours: [10, 23], daily: 2, pay: 15, summary: 'كنّس الشعر من أرضية الصالون', task: 'تكنس الأرضية وترتب الصالون', need: 'يكنس الصالون', phrases: ['تكنس', 'تنظيف', 'ترتيب', 'الصالون', 'كنس'] },
  { id: 'online', title: 'شغل أونلاين', employer: null, place: 'home', hours: [0, 24], pay: 30, summary: 'من اللابتوب: إدخال بيانات، تدقيق، ترجمة، تصميم', task: 'تشتغل أونلاين', need: 'يشتغل أونلاين', phrases: ['اونلاين', 'انترنت', 'لابتوب', 'كمبيوتر', 'فريلانس', 'online'] },
  { id: 'stall', title: 'البيع على البسطة', employer: null, place: 'stall', hours: [8, 23], pay: 40, requires: 'stall', summary: 'اشترِ بالجملة من البقالة وبِع بالمفرد', task: 'تبيع على البسطة', need: 'يبيع على البسطة', phrases: ['بسطه', 'ابيع', 'بيع', 'البسطه'] },
  { id: 'recycle', title: 'إعادة التدوير', employer: null, place: 'recycle', hours: [0, 24], pay: 1, summary: 'اجمع العلب الفاضية من الشارع وحطها بالآلة', task: 'تجمع العلب', need: 'يجمع العلب', phrases: ['تدوير', 'علب', 'قناني'] },
  // Inside the house.
  { id: 'sweep', title: 'كنس البيت', employer: 'mum', place: 'home', hours: [6, 22], daily: 1, pay: 20, summary: 'كنّس الغبار من الصالة والغرف', task: 'تكنس البيت', need: 'يكنس البيت', phrases: ['كنس', 'اكنس', 'تكنس', 'تنظيف البيت', 'نظف البيت', 'انظف البيت', 'المكنسه', 'غبار'], family: true },
  { id: 'dishes', title: 'غسيل المواعين', employer: 'mum', place: 'home', hours: [7, 23], daily: 2, pay: 18, summary: 'اغسل الصحون والقدور بالمطبخ', task: 'تغسل المواعين', need: 'يغسل المواعين', phrases: ['صحون', 'الصحون', 'مواعين', 'المواعين', 'اغسل الصحون', 'جلي', 'المطبخ'], family: true },
  { id: 'tidy', title: 'ترتيب غرفتك', employer: 'mum', place: 'home', hours: [6, 22], daily: 1, pay: 15, summary: 'رجّع الأغراض المرمية بغرفتك لمكانها', task: 'ترتب غرفتك', need: 'يرتب غرفته', phrases: ['رتب', 'ترتيب', 'ارتب', 'غرفتي', 'الغرفه', 'غرفتك', 'العابي', 'اغراضي'], family: true },
  { id: 'laundry', title: 'ترتيب الغسيل', employer: 'mum', place: 'home', hours: [7, 21], daily: 1, pay: 15, summary: 'وزّع الملابس النظيفة على دواليب العيلة', task: 'تطوي الغسيل وترتبه بالدواليب', need: 'يرتب الغسيل', phrases: ['غسيل', 'الغسيل', 'ملابس', 'الملابس', 'هدوم', 'تطوي', 'اطوي'], family: true },
  { id: 'coffee', title: 'ضيافة القهوة بالمجلس', employer: 'dad', place: 'home', hours: [6, 15], daily: 1, pay: 25, summary: 'صب القهوة العربية للضيوف بالترتيب الصح', task: 'تصب القهوة للضيوف بالمجلس', need: 'يصب القهوة للضيوف', phrases: ['ضيافه', 'صب القهوه', 'اصب القهوه', 'الضيوف', 'دله', 'الدله', 'فناجين', 'المجلس'], family: true },
  // The company tower.
  { id: 'reception', title: 'موظف استقبال', employer: 'hr', place: 'company', hours: [8, 18], pay: 45, company: true, summary: 'رد على المكالمات وحوّلها للقسم الصح', task: 'ترد على مكالمات الشركة وتحولها للقسم الصح', need: 'يرد على مكالمات الشركة', phrases: ['استقبال', 'الاستقبال', 'مكالمات', 'سنترال', 'رد على التلفون'] },
  { id: 'sales', title: 'مندوب مبيعات', employer: 'hr', place: 'company', hours: [9, 21], pay: 65, company: true, rank: 1, summary: 'اسمع الزبون واقترح له المنتج اللي يناسبه', task: 'تبيع منتجات الشركة للزباين', need: 'يبيع منتجات الشركة', phrases: ['مبيعات', 'المبيعات', 'مندوب', 'مسوق', 'تسويق', 'اسوق'] },
  { id: 'accounting', title: 'محاسب', employer: 'hr', place: 'company', hours: [8, 18], pay: 95, company: true, rank: 2, summary: 'احسب الفواتير مع الضريبة بدقة', task: 'تراجع فواتير الشركة وتحسب الضريبة', need: 'يراجع الفواتير', phrases: ['محاسب', 'محاسبه', 'المحاسبه', 'فواتير', 'حسابات', 'الضريبه'] },
  { id: 'trade', title: 'صفقة مع أبو راشد', employer: 'partner', place: 'karak', hours: [9, 22], daily: 2, pay: 80, summary: 'اشترِ بضاعة بسعر زين وبيعها للمحلات، والربح بالنص', task: 'تشتغل معي بصفقة تجارة والربح بيننا بالنص', need: 'يشتغل معه بالتجارة', phrases: ['تجاره', 'صفقه', 'صفقات', 'شريك', 'شراكه', 'اشتغل معك', 'تاجر', 'بضاعه'] },
];

/** Ranks at the company: shifts needed and pay multiplier. */
export const COMPANY_RANKS = [
  { title: 'متدرب', shifts: 0, pay: 1 },
  { title: 'موظف', shifts: 4, pay: 1.3 },
  { title: 'مشرف', shifts: 12, pay: 1.7 },
  { title: 'مدير قسم', shifts: 25, pay: 2.2 },
];

export function companyRank(shifts: number): number {
  let r = 0;
  COMPANY_RANKS.forEach((k, i) => shifts >= k.shifts && (r = i));
  return r;
}

/** Partnerships with Abu Rashid: put money in, get a share every morning. */
export interface Deal {
  id: string;
  name: string;
  icon: string;
  cost: number;
  perDay: number;
  days: number;
  pitch: string;
}

export const DEALS: Deal[] = [
  { id: 'karakcart', name: 'عربة كرك متنقلة', icon: '☕', cost: 300, perDay: 30, days: 15, pitch: 'عربة كرك عند المدارس والدوائر. تحط 300 وتاخذ 30 كل يوم لمدة 15 يوم.' },
  { id: 'eshop', name: 'متجر عطور أونلاين', icon: '🛍️', cost: 1000, perDay: 95, days: 15, pitch: 'نبيع عطور أبوك أونلاين وأنا أتكفل بالتوصيل. تحط 1000 وتاخذ 95 كل يوم لمدة 15 يوم.' },
  { id: 'truck', name: 'شاحنة توزيع', icon: '🚚', cost: 3000, perDay: 270, days: 15, pitch: 'شاحنة توزع مي وعصير على البقالات. تحط 3000 وتاخذ 270 كل يوم لمدة 15 يوم.' },
];

export const JOB_BY_ID = new Map(JOBS.map((j) => [j.id, j]));

export function job(id: JobId): JobDef {
  return JOB_BY_ID.get(id)!;
}

/** Hour of day h (0–24, fractional) falls inside [from, to), which may wrap past midnight. */
export function isOpenAt(hours: [number, number], h: number): boolean {
  const [from, to] = hours;
  if (to - from >= 24) return true;
  if (to <= 24) return h >= from && h < to;
  return h >= from || h < to - 24;
}

/** Pay multiplier for a skill level: +12% per level above the first. */
export function skillMultiplier(level: number): number {
  return 1 + 0.12 * (Math.max(1, level) - 1);
}

/** XP needed to go from `level` to the next. */
export function xpForNext(level: number): number {
  return 40 + 30 * level;
}

export const FINAL_GOAL: UpgradeId = 'shop';
