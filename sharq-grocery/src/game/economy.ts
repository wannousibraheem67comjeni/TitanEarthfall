/**
 * The whole economy of «بقالة شرق الإمارات»: what the shop sells at each stage and for
 * how much (with what it costs to buy in), what each stage costs and brings, how bills
 * come in (honest ones, and the ones that need a second look), what accepting or
 * refusing each one does, and the ladder of wealth to the top.
 */
import type { Rng } from '../core/rng';

/** The packaging a product comes in, for the 3D goods on shelves and on the desk. */
export type Pack =
  | 'water'
  | 'bottle'
  | 'jug'
  | 'can'
  | 'tin'
  | 'carton'
  | 'box'
  | 'flatbox'
  | 'pillow'
  | 'bread'
  | 'sack'
  | 'eggs'
  | 'tray'
  | 'produce'
  | 'jar'
  | 'perfume'
  | 'card'
  | 'folded'
  | 'bigbox'
  | 'case'
  | 'folder'
  | 'chicken'
  | 'gum';

export interface Product {
  id: string;
  name: string;
  icon: string;
  /** Shelf price, dirhams. */
  price: number;
  /** What the shop pays the supplier for it. */
  cost: number;
  /** First stage (0-based) that stocks it. */
  stage: number;
  pack: Pack;
  color: string;
  /** How a customer says one, two, or several of it ("قنينة ماي", "قنينتين ماي", "قناني ماي"). */
  say: [string, string, string];
  /** The (made-up) brand printed on the pack. */
  brand: string;
}

type Row = [id: string, name: string, icon: string, price: number, cost: number, pack: Pack, color: string, say: [string, string, string], brand: string];

/** Shelf prices are close to what a small UAE grocery charges; the cost is the wholesale price. */
const ROWS: Row[][] = [
  // 0 · كشك صغير
  [
    ['water', 'ماي ٥٠٠ مل', '💧', 1, 0.5, 'water', '#4fa8e0', ['قنينة ماي', 'قنينتين ماي', 'قناني ماي'], 'نبع الشرق'],
    ['gum', 'علكة', '🍬', 1, 0.5, 'gum', '#e85aa0', ['علكة', 'علكتين', 'علك'], 'نعناع'],
    ['bread', 'خبز عربي', '🫓', 2, 1.4, 'bread', '#e8c48a', ['ربطة خبز', 'ربطتين خبز', 'ربطات خبز'], 'مخبز الفريج'],
    ['chips', 'شيبس', '🥔', 2, 1.3, 'pillow', '#f2c230', ['كيس شيبس', 'كيسين شيبس', 'أكياس شيبس'], 'قرمش'],
    ['biscuit', 'بسكويت', '🍪', 2, 1.2, 'flatbox', '#b5733a', ['باكيت بسكويت', 'باكيتين بسكويت', 'باكيتات بسكويت'], 'الواحة'],
    ['laban', 'لبن', '🥛', 3, 2, 'jug', '#f4f4f0', ['علبة لبن', 'علبتين لبن', 'علب لبن'], 'مزارع الشرق'],
    ['juice', 'عصير', '🧃', 3, 2, 'carton', '#f28b30', ['عصير', 'عصيرين', 'عصيرات'], 'البستان'],
    ['milk', 'حليب طازج ١ لتر', '🥛', 6, 4.5, 'jug', '#3f86b8', ['علبة حليب', 'علبتين حليب', 'علب حليب'], 'مزارع الشرق'],
  ],
  // 1 · بقالة صغيرة
  [
    ['cola', 'مشروب غازي', '🥤', 3, 2, 'can', '#c2302a', ['علبة غازي', 'علبتين غازي', 'علب غازي'], 'فوّار'],
    ['icecream', 'آيس كريم', '🍦', 4, 2.5, 'flatbox', '#f6d6e6', ['آيس كريم', 'آيس كريمين', 'آيس كريمات'], 'ثلج'],
    ['sugar', 'سكر ١ كيلو', '🧂', 6, 4.5, 'pillow', '#ffffff', ['كيس سكر', 'كيسين سكر', 'أكياس سكر'], 'الصافي'],
    ['tuna', 'تونة', '🐟', 7, 5, 'tin', '#2f6fb0', ['علبة تونة', 'علبتين تونة', 'علب تونة'], 'بحر عمان'],
    ['tea', 'شاي ١٠٠ كيس', '🍵', 9, 6.5, 'box', '#c23b2e', ['علبة شاي', 'علبتين شاي', 'علب شاي'], 'كرك'],
    ['eggs', 'بيض ٣٠ حبة', '🥚', 14, 10, 'eggs', '#f0dcc0', ['طبق بيض', 'طبقين بيض', 'أطباق بيض'], 'مزرعة الذيد'],
  ],
  // 2 · بقالة الحي
  [
    ['pasta', 'معكرونة', '🍝', 4, 2.5, 'pillow', '#e9b44c', ['باكيت معكرونة', 'باكيتين معكرونة', 'باكيتات معكرونة'], 'الريف'],
    ['cheese', 'جبن مثلثات', '🧀', 12, 8.5, 'box', '#f2d24a', ['علبة جبن', 'علبتين جبن', 'علب جبن'], 'البقرة السعيدة'],
    ['oil', 'زيت طبخ ١.٨ لتر', '🫒', 15, 11, 'bottle', '#d9b030', ['قنينة زيت', 'قنينتين زيت', 'قناني زيت'], 'الذهبي'],
    ['dates', 'تمر خلاص', '🌴', 20, 14, 'box', '#6b3d1e', ['علبة تمر', 'علبتين تمر', 'علب تمر'], 'نخيل العين'],
    ['chicken', 'دجاج مجمد', '🍗', 22, 16, 'chicken', '#e6d3b8', ['دجاجة مجمدة', 'دجاجتين مجمدات', 'دجاجات مجمدة'], 'الدواجن الوطنية'],
    ['rice', 'رز بسمتي ٥ كيلو', '🍚', 32, 25, 'sack', '#f4efe4', ['كيس رز', 'كيسين رز', 'أكياس رز'], 'البسمتي الذهبي'],
  ],
  // 3 · ميني ماركت
  [
    ['tomato', 'طماط (كيلو)', '🍅', 5, 3, 'produce', '#d8352b', ['كيلو طماط', 'كيلوين طماط', 'كيلو طماط'], ''],
    ['apple', 'تفاح (كيلو)', '🍎', 9, 6, 'produce', '#c8302c', ['كيلو تفاح', 'كيلوين تفاح', 'كيلو تفاح'], ''],
    ['soap', 'منظف أرضيات', '🧽', 14, 9, 'bottle', '#3fbf9f', ['قنينة منظف', 'قنينتين منظف', 'قناني منظف'], 'لمعة'],
    ['shampoo', 'شامبو', '🧴', 18, 12, 'bottle', '#7a5aa6', ['قنينة شامبو', 'قنينتين شامبو', 'قناني شامبو'], 'حرير'],
    ['coffee', 'قهوة عربية', '☕', 28, 19, 'pillow', '#8a5a2b', ['باكيت قهوة', 'باكيتين قهوة', 'باكيتات قهوة'], 'دلّة'],
    ['card', 'بطاقة شحن ٥٠', '📱', 50, 47, 'card', '#1f6fd0', ['بطاقة شحن', 'بطاقتين شحن', 'بطاقات شحن'], 'شحن'],
  ],
  // 4 · سوبرماركت
  [
    ['toy', 'لعبة أطفال', '🧸', 30, 18, 'box', '#e0a526', ['لعبة أطفال', 'لعبتين أطفال', 'ألعاب أطفال'], 'فرحة'],
    ['fish', 'سمك طازج (كيلو)', '🐠', 35, 26, 'tray', '#9fc3d6', ['كيلو سمك', 'كيلوين سمك', 'كيلو سمك'], 'سوق خورفكان'],
    ['meat', 'لحم (كيلو)', '🥩', 45, 34, 'tray', '#b8433a', ['كيلو لحم', 'كيلوين لحم', 'كيلو لحم'], 'ملحمة الشرق'],
    ['diapers', 'حفاضات', '👶', 45, 33, 'sack', '#9fd0f0', ['باكيت حفاضات', 'باكيتين حفاضات', 'باكيتات حفاضات'], 'نونو'],
    ['honey', 'عسل سدر', '🍯', 60, 40, 'jar', '#e0a526', ['علبة عسل سدر', 'علبتين عسل سدر', 'علب عسل سدر'], 'جبال حتّا'],
    ['perfume', 'عطر', '🌸', 95, 60, 'perfume', '#c46aa8', ['عطر', 'عطرين', 'عطور'], 'دهن العود'],
  ],
  // 5 · هايبرماركت
  [
    ['charger', 'شاحن جوال', '🔌', 40, 22, 'flatbox', '#f4f4f2', ['شاحن', 'شاحنين', 'شواحن'], 'طاقة'],
    ['shirt', 'ملابس', '👕', 70, 40, 'folded', '#3f86b8', ['قطعة ملابس', 'قطعتين ملابس', 'قطع ملابس'], ''],
    ['pots', 'طقم قدور', '🍳', 85, 55, 'bigbox', '#8d9297', ['طقم قدور', 'طقمين قدور', 'أطقم قدور'], 'المطبخ'],
    ['headphones', 'سماعات', '🎧', 120, 80, 'box', '#2b2d31', ['سماعة', 'سماعتين', 'سماعات'], 'صدى'],
    ['bike', 'دراجة أطفال', '🚲', 350, 240, 'bigbox', '#d8352b', ['دراجة أطفال', 'دراجتين أطفال', 'دراجات أطفال'], 'سبيد'],
    ['tv', 'تلفزيون ٥٥ بوصة', '📺', 1200, 950, 'bigbox', '#151515', ['تلفزيون', 'تلفزيونين', 'تلفزيونات'], 'شاشة'],
  ],
  // 6 · سلسلة فروع (جملة)
  [
    ['watercase', 'كرتون ماي ٢٤', '📦', 18, 11, 'case', '#4fa8e0', ['كرتون ماي', 'كرتونين ماي', 'كراتين ماي'], 'نبع الشرق'],
    ['oilcase', 'كرتون زيت', '📦', 160, 120, 'bigbox', '#d9b030', ['كرتون زيت', 'كرتونين زيت', 'كراتين زيت'], 'الذهبي'],
    ['ricesack', 'كيس رز ٤٠ كيلو', '🍚', 190, 150, 'sack', '#f4efe4', ['كيس رز كبير', 'كيسين رز كبار', 'أكياس رز كبار'], 'البسمتي الذهبي'],
    ['datesbox', 'صندوق تمر فاخر', '🌴', 250, 160, 'bigbox', '#6b3d1e', ['صندوق تمر', 'صندوقين تمر', 'صناديق تمر'], 'نخيل العين'],
  ],
  // 7 · مجموعة شرق الإمارات القابضة (عقود توريد)
  [
    ['school', 'توريد مقصف مدرسة', '🏫', 12000, 8500, 'folder', '#3f9150', ['عقد توريد مقصف مدرسة', 'عقدين توريد مقاصف مدارس', 'عقود توريد مقاصف مدارس'], ''],
    ['hotel', 'توريد فندق شهري', '🏨', 25000, 18000, 'folder', '#c9a54a', ['عقد توريد فندق لشهر', 'عقدين توريد فنادق', 'عقود توريد فنادق'], ''],
    ['airline', 'طلبية شركة طيران', '✈️', 60000, 44000, 'folder', '#2c4f8a', ['طلبية شركة طيران', 'طلبيتين لشركات طيران', 'طلبيات لشركات طيران'], ''],
  ],
];

export const PRODUCTS: Product[] = ROWS.flatMap((rows, stage) => rows.map(([id, name, icon, price, cost, pack, color, say, brand]) => ({ id, name, icon, price, cost, stage, pack, color, say, brand })));

export const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

export interface Stage {
  name: string;
  /** The sign over the door. */
  sign: string;
  /** How many customers are usually in the shop at once (a quiet spell has fewer, a rush more). */
  crowd: number;
  /** Extra cashiers at their own tills, beside the shopkeeper's desk. */
  lanes: number;
  /** Different products in a basket, and how many of each. */
  items: [number, number];
  qty: [number, number];
  /** Savings needed to move up to the next stage (null at the top). */
  next: number | null;
  /** Income every minute from branches and contracts, beyond the tills. */
  passive: number;
  /** What the stage adds, in a line. */
  adds: string;
}

export const STAGES: Stage[] = [
  { name: 'كشك صغير', sign: 'بقالة شرق الإمارات', crowd: 2, lanes: 0, items: [1, 3], qty: [1, 3], next: 140, passive: 0, adds: 'رف واحد وثلاجة صغيرة. زبون أو زبونين كل مرة.' },
  { name: 'بقالة صغيرة', sign: 'بقالة شرق الإمارات', crowd: 3, lanes: 0, items: [1, 3], qty: [1, 3], next: 450, passive: 0, adds: 'رفين وثلاجة مشروبات وآيس كريم وبيض. زبونين ثلاثة.' },
  { name: 'بقالة الحي', sign: 'بقالة شرق الإمارات', crowd: 4, lanes: 0, items: [2, 4], qty: [1, 3], next: 1600, passive: 0, adds: 'رز وزيت وتمر ودجاج، وزباين أكثر.' },
  { name: 'ميني ماركت', sign: 'ميني ماركت شرق الإمارات', crowd: 7, lanes: 1, items: [2, 5], qty: [1, 3], next: 7000, passive: 0, adds: 'خضار وفواكه ومنظفات وقهوة، وكاشير ثاني يساعدك.' },
  { name: 'سوبرماركت', sign: 'سوبرماركت شرق الإمارات', crowd: 14, lanes: 2, items: [2, 5], qty: [1, 3], next: 30000, passive: 0, adds: 'لحم وسمك وعسل وعطور وألعاب. عشرات الزباين وكاشيرين.' },
  { name: 'هايبرماركت', sign: 'هايبرماركت شرق الإمارات', crowd: 22, lanes: 3, items: [2, 5], qty: [1, 2], next: 180000, passive: 0, adds: 'إلكترونيات وملابس وأدوات منزلية، وثلاث كاشيرات.' },
  { name: 'سلسلة فروع', sign: 'فروع شرق الإمارات', crowd: 30, lanes: 4, items: [2, 4], qty: [5, 30], next: 1300000, passive: 8000, adds: 'فروع بكلباء وخورفكان والفجيرة تجيب دخل كل دقيقة، وطلبات جملة.' },
  { name: 'مجموعة قابضة', sign: 'مجموعة شرق الإمارات القابضة', crowd: 40, lanes: 5, items: [1, 2], qty: [1, 3], next: null, passive: 120000, adds: 'عقود توريد للمدارس والفنادق وشركات الطيران.' },
];

export function stocked(stage: number): Product[] {
  return PRODUCTS.filter((p) => p.stage <= stage);
}

// ---------------------------------------------------------------------------
// Customers and their bills
// ---------------------------------------------------------------------------

export type Kind = 'normal' | 'big' | 'discount' | 'short' | 'kid' | 'trick' | 'coupon' | 'fake' | 'credit' | 'repay';

/**
 * How often each kind of bill turns up at each stage. There is no refusing in the
 * shop, so only honest bills come in: everyday shopping, big shops, children a dirham
 * short, and the odd neighbour who asks to go in the debt book.
 */
const MIX: Record<Kind, number[]> = {
  normal: [86, 80, 76, 72, 70, 68, 70, 76],
  big: [0, 6, 9, 12, 14, 16, 18, 20],
  discount: [0, 0, 0, 0, 0, 0, 0, 0],
  short: [0, 0, 0, 0, 0, 0, 0, 0],
  kid: [10, 9, 9, 9, 9, 9, 7, 2],
  trick: [0, 0, 0, 0, 0, 0, 0, 0],
  coupon: [0, 0, 0, 0, 0, 0, 0, 0],
  fake: [0, 0, 0, 0, 0, 0, 0, 0],
  credit: [4, 5, 6, 7, 7, 7, 5, 2],
  repay: [0, 0, 0, 0, 0, 0, 0, 0],
};

/** The share of honest customers who pay by card, by stage (a kiosk is mostly cash). */
const CARD = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.6, 0.8];

export interface Line {
  product: Product;
  qty: number;
  /** Price on this bill (lower than the shelf price only when the customer claims so). */
  price: number;
}

export interface Bill {
  kind: Kind;
  lines: Line[];
  /** At shelf prices. */
  total: number;
  cost: number;
  /** What the customer actually hands over if the bill is accepted (0 on credit). */
  pays: number;
  /** The banknote(s) handed over, for change (0 when paying by card or on credit). */
  note: number;
  pay: 'cash' | 'card';
  discount?: number;
  /** Price trick: the line the customer lies about. */
  claim?: { product: Product; said: number };
  coupon?: { pct: number; expired: string };
  /** For a debt being repaid. */
  debt?: number;
}

const NOTES = [5, 10, 20, 50, 100, 200, 500, 1000];

/** The smallest banknote (or two) that covers the amount. */
export function noteFor(amount: number): number {
  for (const n of NOTES) if (n >= amount) return n;
  return Math.ceil(amount / 1000) * 1000;
}

export function pickKind(rng: Rng, stage: number): Kind {
  const kinds = Object.keys(MIX) as Kind[];
  return rng.weighted(
    kinds,
    kinds.map((k) => MIX[k][stage] ?? 0),
  );
}

/** A basket for this stage: newer products more often, so each upgrade shows up on the counter. */
export function basket(rng: Rng, stage: number, big = false): Line[] {
  const st = STAGES[stage];
  const pool = stocked(stage);
  const n = Math.min(pool.length, rng.int(st.items[0], st.items[1]) + (big ? 2 : 0));
  const weights = pool.map((p) => 1 + (p.stage === stage ? 2.2 : p.stage >= stage - 1 ? 1 : 0));
  const chosen: Product[] = [];
  while (chosen.length < n) {
    const p = rng.weighted(pool, weights);
    if (!chosen.includes(p)) chosen.push(p);
  }
  return chosen.map((product) => {
    // Wholesale lots come by the dozen; contracts one at a time.
    const lo = product.stage >= 6 && product.stage === stage ? st.qty[0] : 1;
    const hi = product.stage >= 6 && product.stage === stage ? st.qty[1] : Math.min(4, st.qty[1] > 4 ? 3 : st.qty[1]);
    const q = rng.int(lo, Math.max(lo, hi)) * (big ? 3 : 1);
    return { product, qty: q, price: product.price };
  });
}

export function makeBill(rng: Rng, stage: number, kind: Kind = pickKind(rng, stage)): Bill {
  let lines = basket(rng, stage, kind === 'big');
  if (kind === 'kid') {
    // A child with a coin or two, short by a dirham.
    const sweets = stocked(0).filter((p) => p.price <= 2);
    lines = [{ product: rng.pick(sweets), qty: rng.int(2, 3), price: 0 }];
    lines[0].price = lines[0].product.price;
  }
  const total = sum(lines.map((l) => l.product.price * l.qty));
  const cost = sum(lines.map((l) => l.product.cost * l.qty));
  const bill: Bill = { kind, lines, total, cost, pays: total, note: noteFor(total), pay: 'cash' };
  switch (kind) {
    case 'discount':
      bill.discount = rng.pick([5, 10, 15, 20, 30]);
      bill.pays = Math.round(total * (1 - bill.discount / 100));
      bill.note = noteFor(bill.pays);
      break;
    case 'short':
      bill.pays = Math.max(1, Math.floor(total * rng.range(0.6, 0.92)));
      bill.note = bill.pays;
      break;
    case 'kid':
      bill.pays = total - 1;
      bill.note = bill.pays;
      break;
    case 'trick': {
      const l = lines.reduce((a, b) => (b.product.price * b.qty > a.product.price * a.qty ? b : a));
      const said = Math.max(0.5, roundHalf(l.product.price * rng.range(0.45, 0.75)));
      bill.claim = { product: l.product, said };
      l.price = said;
      bill.pays = sum(lines.map((x) => x.price * x.qty));
      bill.note = noteFor(bill.pays);
      break;
    }
    case 'coupon': {
      const pct = rng.pick([20, 25, 30, 50]);
      const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'];
      bill.coupon = { pct, expired: `${rng.int(1, 28)} ${rng.pick(months)} الماضي` };
      bill.pays = Math.round(total * (1 - pct / 100));
      bill.note = noteFor(bill.pays);
      break;
    }
    case 'credit':
      bill.pays = 0;
      bill.note = 0;
      break;
  }
  if ((kind === 'normal' || kind === 'big') && rng.chance(CARD[stage])) {
    bill.pay = 'card';
    bill.note = 0;
  }
  return bill;
}

export function sum(xs: number[]): number {
  return Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
}

function roundHalf(x: number): number {
  return Math.max(0.5, Math.round(x * 2) / 2);
}

/** What taking the bill puts in the till: everything the customer pays (nothing yet on credit). */
export function acceptGain(b: Bill): number {
  if (b.kind === 'repay') return b.debt ?? 0;
  if (b.kind === 'credit') return 0;
  return Math.round((b.pay === 'card' ? b.total : b.pays) * 100) / 100;
}

export interface Outcome {
  /** Till change. */
  money: number;
  /** Stars change (reputation 0–5). */
  rep: number;
  /** What happened, for the toast. */
  text: string;
  good: boolean;
  /** The customer's parting line. */
  says: string;
  /** Credit given: the customer owes this much. */
  debt?: number;
}

/** Who is at the counter, for the right word endings. */
export interface Who {
  /** The customer is a woman. */
  she?: boolean;
  /** The shopkeeper is a woman. */
  keeperShe?: boolean;
}

/** Taking a bill: the money goes in the till, the customer goes home happy. */
export function decide(b: Bill, who: Who = {}): Outcome {
  const money = acceptGain(b);
  const x = (m: string, f: string) => (who.she ? f : m);
  const k = (m: string, f: string) => (who.keeperShe ? f : m);
  switch (b.kind) {
    case 'repay':
      return { money, rep: 0.1, text: `${x('سدّد دينه', 'سدّدت دينها')}: +${fmt(money)} بالدرج 🤝`, good: true, says: k('الله يجزاك خير، ما قصرت معي.', 'الله يجزاج خير، ما قصرتي معي.') };
    case 'kid':
      return { money, rep: 0.3, text: `فرّحت الياهل 😊 — +${fmt(money)} بالدرج`, good: true, says: `شكراً ${k('عمو', 'خالة')}! 😄` };
    case 'credit':
      return { money: 0, rep: 0.1, text: `سجلت ${x('عليه', 'عليها')} دين: ${fmt(b.total)} — إذا ${x('سدّد', 'سدّدت')} تنزل بالدرج`, good: true, says: k('الله يخليك، أسدد لك قريب إن شاء الله.', 'الله يخليج، أسدد لج قريب إن شاء الله.'), debt: b.total };
    default:
      return { money, rep: 0.05, text: `✓ +${fmt(money)} بالدرج`, good: true, says: k('مشكور، الله يبارك لك.', 'مشكورة، الله يبارك لج.') };
  }
}

export const LADDER: { at: number; title: [string, string] }[] = [
  { at: 0, title: ['بقال مبتدئ', 'بقالة مبتدئة'] },
  { at: 100, title: ['أشهر بقال بالفريج', 'أشهر بقالة بالفريج'] },
  { at: 1000, title: ['أغنى واحد بكلباء', 'أغنى وحدة بكلباء'] },
  { at: 10000, title: ['أغنى واحد بخورفكان', 'أغنى وحدة بخورفكان'] },
  { at: 50000, title: ['أغنى واحد بالفجيرة', 'أغنى وحدة بالفجيرة'] },
  { at: 250000, title: ['أغنى تاجر بشرق الإمارات', 'أغنى تاجرة بشرق الإمارات'] },
  { at: 1000000, title: ['مليونير الإمارات', 'مليونيرة الإمارات'] },
  { at: 4000000, title: ['أغنى رجل أعمال بالخليج', 'أغنى سيدة أعمال بالخليج'] },
  { at: 10000000, title: ['أغنى شخص على الإطلاق 👑', 'أغنى شخص على الإطلاق 👑'] },
];

export function rank(worth: number): number {
  let r = 0;
  LADDER.forEach((l, i) => worth >= l.at && (r = i));
  return r;
}

/** Spoken-friendly dirhams: "1,250 درهم", "2.5 درهم". */
export function fmt(n: number): string {
  const v = Math.round(n * 100) / 100;
  const s = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const abs = Math.abs(v);
  return `${s} ${abs >= 3 && abs <= 10 && Number.isInteger(abs) ? 'دراهم' : 'درهم'}`;
}

// ---------------------------------------------------------------------------
// Pacing (used by the tests to keep each stage a few minutes long)
// ---------------------------------------------------------------------------

/** Average profit of one honest customer at a stage. */
export function averageProfit(stage: number, rng: Rng, samples = 400): number {
  let p = 0;
  for (let i = 0; i < samples; i++) {
    const b = makeBill(rng, stage, 'normal');
    p += b.total - b.cost;
  }
  return p / samples;
}
