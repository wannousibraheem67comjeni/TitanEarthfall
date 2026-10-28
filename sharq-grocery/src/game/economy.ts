/**
 * The whole economy of «بقالة شرق الإمارات»: what the shop sells at each stage and for
 * how much (with what it costs to buy in), what each stage costs and brings, how bills
 * come in (honest ones, and the ones that need a second look), what accepting or
 * refusing each one does, and the ladder of wealth to the top.
 */
import type { Rng } from '../core/rng';

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
  shape: 'box' | 'bottle' | 'can' | 'bag' | 'tray' | 'jar' | 'crate';
  color: string;
}

export const PRODUCTS: Product[] = [
  // 0 · كشك صغير
  { id: 'water', name: 'ماي', icon: '💧', price: 1, cost: 0.5, stage: 0, shape: 'bottle', color: '#7cc4f2' },
  { id: 'gum', name: 'علكة', icon: '🍬', price: 1, cost: 0.5, stage: 0, shape: 'box', color: '#e85aa0' },
  { id: 'bread', name: 'خبز', icon: '🍞', price: 2, cost: 1.5, stage: 0, shape: 'bag', color: '#e8c48a' },
  { id: 'chips', name: 'شيبس', icon: '🥔', price: 2, cost: 1.5, stage: 0, shape: 'bag', color: '#f2c230' },
  { id: 'biscuit', name: 'بسكويت', icon: '🍪', price: 2, cost: 1, stage: 0, shape: 'box', color: '#b5733a' },
  { id: 'laban', name: 'لبن', icon: '🥛', price: 3, cost: 2, stage: 0, shape: 'bottle', color: '#f4f4f0' },
  { id: 'juice', name: 'عصير', icon: '🧃', price: 3, cost: 2, stage: 0, shape: 'box', color: '#f28b30' },
  { id: 'milk', name: 'حليب', icon: '🥛', price: 6, cost: 4.5, stage: 0, shape: 'box', color: '#3f86b8' },
  // 1 · بقالة صغيرة
  { id: 'cola', name: 'مشروب غازي', icon: '🥤', price: 3, cost: 2, stage: 1, shape: 'can', color: '#c2302a' },
  { id: 'icecream', name: 'آيس كريم', icon: '🍦', price: 4, cost: 2.5, stage: 1, shape: 'box', color: '#f6d6e6' },
  { id: 'sugar', name: 'سكر', icon: '🧂', price: 6, cost: 4.5, stage: 1, shape: 'bag', color: '#ffffff' },
  { id: 'tuna', name: 'تونة', icon: '🐟', price: 7, cost: 5, stage: 1, shape: 'can', color: '#2f6fb0' },
  { id: 'tea', name: 'شاي', icon: '🍵', price: 9, cost: 6.5, stage: 1, shape: 'box', color: '#c23b2e' },
  { id: 'eggs', name: 'بيض (٣٠)', icon: '🥚', price: 14, cost: 10, stage: 1, shape: 'tray', color: '#f0dcc0' },
  // 2 · بقالة الحي
  { id: 'pasta', name: 'معكرونة', icon: '🍝', price: 4, cost: 2.5, stage: 2, shape: 'bag', color: '#e9b44c' },
  { id: 'cheese', name: 'جبن', icon: '🧀', price: 12, cost: 8.5, stage: 2, shape: 'box', color: '#f2d24a' },
  { id: 'oil', name: 'زيت طبخ', icon: '🫒', price: 15, cost: 11, stage: 2, shape: 'bottle', color: '#d9b030' },
  { id: 'dates', name: 'تمر', icon: '🌴', price: 20, cost: 14, stage: 2, shape: 'box', color: '#6b3d1e' },
  { id: 'chicken', name: 'دجاج مجمد', icon: '🍗', price: 22, cost: 16, stage: 2, shape: 'bag', color: '#e6d3b8' },
  { id: 'rice', name: 'رز ٥ كيلو', icon: '🍚', price: 32, cost: 25, stage: 2, shape: 'bag', color: '#f4efe4' },
  // 3 · ميني ماركت
  { id: 'tomato', name: 'طماط (كيلو)', icon: '🍅', price: 5, cost: 3, stage: 3, shape: 'crate', color: '#d8352b' },
  { id: 'apple', name: 'تفاح (كيلو)', icon: '🍎', price: 9, cost: 6, stage: 3, shape: 'crate', color: '#c8302c' },
  { id: 'soap', name: 'منظف', icon: '🧽', price: 14, cost: 9, stage: 3, shape: 'bottle', color: '#3fbf9f' },
  { id: 'shampoo', name: 'شامبو', icon: '🧴', price: 18, cost: 12, stage: 3, shape: 'bottle', color: '#7a5aa6' },
  { id: 'coffee', name: 'قهوة عربية', icon: '☕', price: 28, cost: 19, stage: 3, shape: 'jar', color: '#8a5a2b' },
  { id: 'card', name: 'بطاقة شحن', icon: '📱', price: 50, cost: 47, stage: 3, shape: 'box', color: '#1f6fd0' },
  // 4 · سوبرماركت
  { id: 'toy', name: 'لعبة أطفال', icon: '🧸', price: 30, cost: 18, stage: 4, shape: 'box', color: '#e0a526' },
  { id: 'fish', name: 'سمك طازج', icon: '🐠', price: 35, cost: 26, stage: 4, shape: 'tray', color: '#9fc3d6' },
  { id: 'meat', name: 'لحم', icon: '🥩', price: 45, cost: 34, stage: 4, shape: 'tray', color: '#b8433a' },
  { id: 'diapers', name: 'حفاضات', icon: '👶', price: 45, cost: 33, stage: 4, shape: 'bag', color: '#9fd0f0' },
  { id: 'honey', name: 'عسل سدر', icon: '🍯', price: 60, cost: 40, stage: 4, shape: 'jar', color: '#e0a526' },
  { id: 'perfume', name: 'عطر', icon: '🌸', price: 95, cost: 60, stage: 4, shape: 'bottle', color: '#c46aa8' },
  // 5 · هايبرماركت
  { id: 'charger', name: 'شاحن', icon: '🔌', price: 40, cost: 22, stage: 5, shape: 'box', color: '#f4f4f2' },
  { id: 'shirt', name: 'ملابس', icon: '👕', price: 70, cost: 40, stage: 5, shape: 'box', color: '#3f86b8' },
  { id: 'pots', name: 'طقم قدور', icon: '🍳', price: 85, cost: 55, stage: 5, shape: 'box', color: '#8d9297' },
  { id: 'headphones', name: 'سماعات', icon: '🎧', price: 120, cost: 80, stage: 5, shape: 'box', color: '#2b2d31' },
  { id: 'bike', name: 'دراجة أطفال', icon: '🚲', price: 350, cost: 240, stage: 5, shape: 'crate', color: '#d8352b' },
  { id: 'tv', name: 'تلفزيون', icon: '📺', price: 1200, cost: 950, stage: 5, shape: 'box', color: '#151515' },
  // 6 · سلسلة فروع (جملة)
  { id: 'watercase', name: 'كرتون ماي (٢٤)', icon: '📦', price: 18, cost: 11, stage: 6, shape: 'crate', color: '#7cc4f2' },
  { id: 'oilcase', name: 'كرتون زيت', icon: '📦', price: 160, cost: 120, stage: 6, shape: 'crate', color: '#d9b030' },
  { id: 'ricesack', name: 'كيس رز ٤٠ كيلو', icon: '🍚', price: 190, cost: 150, stage: 6, shape: 'bag', color: '#f4efe4' },
  { id: 'datesbox', name: 'صندوق تمر فاخر', icon: '🌴', price: 250, cost: 160, stage: 6, shape: 'crate', color: '#6b3d1e' },
  // 7 · مجموعة شرق الإمارات القابضة (عقود توريد)
  { id: 'school', name: 'توريد مقصف مدرسة', icon: '🏫', price: 12000, cost: 8500, stage: 7, shape: 'crate', color: '#3f9150' },
  { id: 'hotel', name: 'توريد فندق شهري', icon: '🏨', price: 25000, cost: 18000, stage: 7, shape: 'crate', color: '#c9a54a' },
  { id: 'airline', name: 'طلبية شركة طيران', icon: '✈️', price: 60000, cost: 44000, stage: 7, shape: 'crate', color: '#2c4f8a' },
];

export const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

export interface Stage {
  name: string;
  /** The sign over the door. */
  sign: string;
  /** Seconds between customers at three stars. */
  spawn: number;
  /** Different products in a basket, and how many of each. */
  items: [number, number];
  qty: [number, number];
  /** Savings needed to move up to the next stage (null at the top). */
  next: number | null;
  /** Income per minute from branches and contracts, beyond the counter. */
  passive: number;
  /** What the stage adds, in a line. */
  adds: string;
}

export const STAGES: Stage[] = [
  { name: 'كشك صغير', sign: 'بقالة شرق الإمارات', spawn: 8, items: [1, 2], qty: [1, 2], next: 40, passive: 0, adds: 'رف واحد وثمان أغراض. زبون كل فترة.' },
  { name: 'بقالة صغيرة', sign: 'بقالة شرق الإمارات', spawn: 7, items: [1, 3], qty: [1, 3], next: 180, passive: 0, adds: 'رفين وثلاجة مشروبات وآيس كريم.' },
  { name: 'بقالة الحي', sign: 'بقالة شرق الإمارات', spawn: 6.5, items: [2, 4], qty: [1, 3], next: 750, passive: 0, adds: 'رز وزيت وتمر ودجاج، وزباين أكثر.' },
  { name: 'ميني ماركت', sign: 'ميني ماركت شرق الإمارات', spawn: 6, items: [2, 5], qty: [1, 4], next: 2400, passive: 0, adds: 'خضار وفواكه ومنظفات وقهوة.' },
  { name: 'سوبرماركت', sign: 'سوبرماركت شرق الإمارات', spawn: 5.5, items: [2, 5], qty: [1, 3], next: 6000, passive: 0, adds: 'لحم وسمك وعسل وعطور وألعاب.' },
  { name: 'هايبرماركت', sign: 'هايبرماركت شرق الإمارات', spawn: 5, items: [2, 5], qty: [1, 2], next: 24000, passive: 0, adds: 'إلكترونيات وملابس وأدوات منزلية.' },
  { name: 'سلسلة فروع', sign: 'فروع شرق الإمارات', spawn: 5, items: [2, 4], qty: [5, 30], next: 160000, passive: 5000, adds: 'فروع بكلباء وخورفكان والفجيرة: دخل كل دقيقة، وطلبات جملة.' },
  { name: 'مجموعة قابضة', sign: 'مجموعة شرق الإمارات القابضة', spawn: 4, items: [1, 2], qty: [1, 3], next: null, passive: 150000, adds: 'عقود توريد للمدارس والفنادق وشركات الطيران.' },
];

/** Savings grow by this fraction every minute. */
export const SAVINGS_RATE = 0.01;

export function stocked(stage: number): Product[] {
  return PRODUCTS.filter((p) => p.stage <= stage);
}

// ---------------------------------------------------------------------------
// Customers and their bills
// ---------------------------------------------------------------------------

export type Kind = 'normal' | 'big' | 'discount' | 'short' | 'kid' | 'trick' | 'coupon' | 'fake' | 'credit' | 'repay';

/** How often each kind of bill turns up at each stage. */
const MIX: Record<Kind, number[]> = {
  normal: [62, 52, 46, 42, 40, 40, 44, 50],
  big: [0, 4, 7, 8, 9, 10, 12, 14],
  discount: [8, 9, 9, 9, 8, 8, 8, 8],
  short: [10, 9, 8, 7, 6, 5, 4, 3],
  kid: [10, 9, 7, 6, 5, 4, 2, 0],
  trick: [6, 7, 8, 8, 8, 8, 8, 8],
  coupon: [0, 0, 0, 5, 6, 7, 6, 5],
  fake: [0, 5, 6, 6, 7, 7, 7, 6],
  credit: [4, 5, 6, 6, 6, 6, 5, 4],
  repay: [0, 0, 0, 0, 0, 0, 0, 0],
};

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
  /** The banknote(s) handed over, for change. */
  note: number;
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
  const bill: Bill = { kind, lines, total, cost, pays: total, note: noteFor(total) };
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
  return bill;
}

export function sum(xs: number[]): number {
  return Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
}

function roundHalf(x: number): number {
  return Math.max(0.5, Math.round(x * 2) / 2);
}

/** What accepting the bill adds to (or takes from) the drawer right now. */
export function acceptGain(b: Bill): number {
  if (b.kind === 'repay') return b.debt ?? 0;
  if (b.kind === 'fake' || b.kind === 'credit') return -b.cost;
  return Math.round((b.pays - b.cost) * 100) / 100;
}

export interface Outcome {
  /** Drawer change. */
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

/**
 * Resolve a decision. `trust` (0–1) is how likely this customer is to pay a debt back;
 * `roll` (0–1) settles the bluffs that fold when refused.
 */
/** Who is at the counter, for the right word endings. */
export interface Who {
  /** The customer is a woman. */
  she?: boolean;
  /** The shopkeeper is a woman. */
  keeperShe?: boolean;
}

export function decide(b: Bill, accept: boolean, roll: number, who: Who = {}): Outcome {
  const gain = acceptGain(b);
  const profit = (m: number) => (m >= 0 ? `ربحك ${fmt(m)}` : `خسرت ${fmt(-m)}`);
  // x(): about the customer; k(): the customer talking to the shopkeeper (Emirati «ج» for her).
  const x = (m: string, f: string) => (who.she ? f : m);
  const k = (m: string, f: string) => (who.keeperShe ? f : m);
  if (b.kind === 'repay') return { money: b.debt ?? 0, rep: 0.1, text: `${x('سدّد دينه', 'سدّدت دينها')}: +${fmt(b.debt ?? 0)} 🤝`, good: true, says: k('الله يجزاك خير، ما قصرت معي.', 'الله يجزاج خير، ما قصرتي معي.') };
  if (accept) {
    switch (b.kind) {
      case 'normal':
      case 'big':
        return { money: gain, rep: 0.05, text: `✓ ${profit(gain)}`, good: gain >= 0, says: k('مشكور، الله يبارك لك.', 'مشكورة، الله يبارك لج.') };
      case 'discount':
        return { money: gain, rep: 0.15, text: `خصم ${b.discount}٪ — ${profit(gain)}`, good: gain >= 0, says: k('الله يخليك، أنا من زباينك على طول!', 'الله يخليج، أنا من زباينج على طول!') };
      case 'short':
        return { money: gain, rep: 0.1, text: `بعت بأقل — ${profit(gain)}`, good: gain >= 0, says: k('جزاك الله خير، ما ننساها لك.', 'جزاج الله خير، ما ننساها لج.') };
      case 'kid':
        return { money: gain, rep: 0.3, text: `فرّحت الياهل 😊 — ${profit(gain)}`, good: true, says: `شكراً ${k('عمو', 'خالة')}! 😄` };
      case 'trick':
        return { money: gain, rep: 0, text: `${x('صدّقته', 'صدّقتها')}، والسعر الصح ${fmt(b.claim!.product.price)} — ${profit(gain)}`, good: false, says: k('هههه مشكور!', 'هههه مشكورة!') };
      case 'coupon':
        return { money: gain, rep: 0, text: `الكوبون كان منتهي! — ${profit(gain)}`, good: false, says: 'شكراً!' };
      case 'fake':
        return { money: gain, rep: 0, text: `⚠️ الورقة طلعت مزورة! خسرت البضاعة (${fmt(b.cost)})`, good: false, says: '…' };
      case 'credit':
        return { money: gain, rep: 0.1, text: `سجلت ${x('عليه', 'عليها')} دين: ${fmt(b.total)} — إذا ${x('سدّد', 'سدّدت')} بيرجع لك`, good: true, says: k('الله يخليك، أسدد لك قريب إن شاء الله.', 'الله يخليج، أسدد لج قريب إن شاء الله.'), debt: b.total };
    }
  }
  // Refused.
  const full = Math.round((b.total - b.cost) * 100) / 100;
  switch (b.kind) {
    case 'normal':
    case 'big':
      return { money: 0, rep: -0.4, text: x('رفضت فاتورة سليمة! الزبون زعل وطلع.', 'رفضت فاتورة سليمة! الزبونة زعلت وطلعت.'), good: false, says: k('ليش؟! خلاص، بروح لغيرك.', 'ليش؟! خلاص، بروح لغيرج.') };
    case 'discount':
      if (roll < 0.5) return { money: full, rep: 0, text: `ما في خصم؟ ${x('دفع', 'دفعت')} كامل — ربحك ${fmt(full)}`, good: true, says: k('طيب طيب، خذ حسابك كامل.', 'طيب طيب، خذي حسابج كامل.') };
      return { money: 0, rep: -0.05, text: x('ما رضي بدون خصم وطلع.', 'ما رضيت بدون خصم وطلعت.'), good: false, says: 'خلاص، مرة ثانية.' };
    case 'short':
      return { money: 0, rep: -0.1, text: x('ما كانت فلوسه تكفي، وطلع.', 'ما كانت فلوسها تكفي، وطلعت.'), good: false, says: k('معذور، الله يرزقك.', 'معذورة، الله يرزقج.') };
    case 'kid':
      return { money: 0, rep: -0.3, text: 'الياهل طلع زعلان 😢', good: false, says: '😢' };
    case 'trick':
      if (roll < 0.6) return { money: full, rep: 0, text: `${x('كشفته! دفع', 'كشفتها! دفعت')} السعر الصح — ربحك ${fmt(full)} 👏`, good: true, says: k('هه… طيب، خذ السعر الصح.', 'هه… طيب، خذي السعر الصح.') };
      return { money: 0, rep: 0, text: `كشفت الحيلة، ${x('وطلع بدون ما يشتري', 'وطلعت بدون ما تشتري')}. قرار صح 👏`, good: true, says: 'خلاص خلاص.' };
    case 'coupon':
      if (roll < 0.7) return { money: full, rep: 0, text: `الكوبون منتهي، ${x('فدفع', 'فدفعت')} كامل — ربحك ${fmt(full)} 👏`, good: true, says: x('آسف، ما انتبهت للتاريخ.', 'آسفة، ما انتبهت للتاريخ.') };
      return { money: 0, rep: 0, text: `الكوبون منتهي، ${x('وطلع', 'وطلعت')}. قرار صح 👏`, good: true, says: 'أوكي.' };
    case 'fake':
      return { money: 0, rep: 0.1, text: 'صح! الورقة كانت مزورة. عينك صقر 🦅', good: true, says: '…' };
    case 'credit':
      return { money: 0, rep: -0.1, text: `ما سجلت ${x('عليه دين، وطلع', 'عليها دين، وطلعت')}.`, good: true, says: k('ولا يهمك.', 'ولا يهمج.') };
  }
}

// ---------------------------------------------------------------------------
// Wealth
// ---------------------------------------------------------------------------

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
