/**
 * What people say at the desk, in Gulf Arabic. The customer greets, says what they
 * bought, how they are paying, and asks «تقبل فاتورتي؟». The marks say
 * where in the sentence each item is named, so the receipt prints it as it is said.
 * Then the shopkeeper's short answer, and the customer's reply.
 */
import type { Rng } from '../core/rng';
import { timeGreeting } from './clock';
import type { Persona } from './customers';
import { fmt, type Bill, type Line } from './economy';
import type { Gender } from './state';

export interface Speech {
  text: string;
  /** Character offsets where each receipt line is named. */
  marks: { at: number; line: number }[];
}

const COUNT = ['', '', '', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع', 'عشر'];

/** "قنينة ماي", "قنينتين ماي", "ثلاث قناني ماي", "24 كرتون ماي". */
export function itemPhrase(l: Line): string {
  const [one, two, many] = l.product.say;
  if (l.qty === 1) return one;
  if (l.qty === 2) return two;
  if (l.qty <= 10) return `${COUNT[l.qty]} ${many}`;
  return `${l.qty} ${one}`;
}

/** Money the way it is said: "درهمين", "7 ونص درهم", "نص درهم", "24 درهم". */
export function sayMoney(n: number): string {
  if (n === 1) return 'درهم واحد';
  if (n === 2) return 'درهمين';
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  if (frac === 0.5) return whole ? `${whole} ونص درهم` : 'نص درهم';
  return fmt(n);
}

export function billSpeech(rng: Rng, b: Bill, p: Persona, keeper: Gender, minute: number): Speech {
  // Talking to the shopkeeper (Emirati «ج» for her), and the customer about themselves.
  const k = (m: string, f: string) => (keeper === 'f' ? f : m);
  const me = (m: string, f: string) => (p.gender === 'f' ? f : m);
  const marks: Speech['marks'] = [];
  let text = '';
  const add = (s: string) => {
    text += (text ? ' ' : '') + s;
  };

  if (p.child) add(`${k('عمو', 'خالة')}، السلام عليكم.`);
  else add(rng.pick(['السلام عليكم.', 'مرحبا، السلام عليكم.', `${timeGreeting(minute)}.`, 'هلا والله، السلام عليكم.', 'السلام عليكم ورحمة الله.']));

  if (b.kind === 'repay') {
    add(`جيت أسدد ديني، ${sayMoney(b.debt ?? 0)}. ${k('الله يجزاك خير، صبرت علي.', 'الله يجزاج خير، صبرتي علي.')}`);
    add(k('تفضل حقك.', 'تفضلي حقج.'));
    return { text, marks };
  }
  if (b.kind === 'big') add(rng.pick(['عندنا عزيمة الليلة.', 'جاينا ضيوف اليوم.', 'بعبي البيت لآخر الشهر.']));

  // The goods, each named as the receipt prints it.
  add(rng.pick(['اشتريت', 'أخذت', p.child ? 'أخذت' : 'اشتريت']));
  b.lines.forEach((l, i) => {
    const phrase = (i ? 'و' : '') + itemPhrase(l);
    text += (i ? '، ' : ' ');
    marks.push({ at: text.length, line: i });
    text += phrase;
  });
  text += '.';

  const exact = b.note === b.pays;
  switch (b.kind) {
    case 'normal':
    case 'big':
      if (b.pay === 'card') add(rng.pick([`بدفع بالبطاقة ${k('لو سمحت', 'لو سمحتي')}.`, 'بالبطاقة.', 'أدفع بالبطاقة.']));
      else add(exact ? `وهذي ${sayMoney(b.note)} بالضبط.` : rng.pick([`وهذي ${sayMoney(b.note)}.`, `${k('تفضل', 'تفضلي')} ${sayMoney(b.note)}.`]));
      break;
    case 'discount':
      add(`${k('سوّ لي', 'سوّي لي')} خصم ${b.discount}٪ ${k('الله يخليك', 'الله يخليج')}، أنا ${me('زبون', 'زبونة')} ${k('عندك', 'عندج')} على طول. يعني أدفع ${sayMoney(b.pays)}، وهذي ${sayMoney(b.note)}.`);
      break;
    case 'short':
      add(rng.pick([`والله ما معي إلا ${sayMoney(b.pays)}.`, `معي ${sayMoney(b.pays)} بس، ${k('اعذرني', 'اعذريني')}.`]));
      break;
    case 'kid':
      add(`ومعي ${sayMoney(b.pays)} بس.`);
      break;
    case 'trick':
      add(`${b.claim!.product.say[0]} بـ${sayMoney(b.claim!.said)} صح؟ ${rng.pick(['أمس اشتريته بهالسعر.', 'مكتوب جذي بالرف.'])} يعني الحساب ${sayMoney(b.pays)}، وهذي ${sayMoney(b.note)}.`);
      break;
    case 'coupon':
      add(`وعندي كوبون خصم ${b.coupon!.pct}٪، يعني أدفع ${sayMoney(b.pays)}. وهذي ${sayMoney(b.note)}.`);
      break;
    case 'fake':
      add(`${k('تفضل', 'تفضلي')} ${sayMoney(b.note)}، ${me('مستعجل', 'مستعجلة')} شوي.`);
      break;
    case 'credit':
      add(rng.pick([`${k('سجلها', 'سجليها')} علي دين، أسدد ${k('لك', 'لج')} آخر الشهر إن شاء الله.`, `الحين ما معي فلوس، ${k('سجلها', 'سجليها')} بالدفتر وأرجع ${k('لك', 'لج')}.`]));
      break;
  }
  if (p.child) add(`${k('تقبل', 'تقبلين')}؟`);
  else add(rng.chance(0.8) ? k('تقبل فاتورتي؟', 'تقبلين فاتورتي؟') : k('تفضل، تقبل فاتورتي؟', 'تفضلي، تقبلين فاتورتي؟'));
  return { text, marks };
}

/** The shopkeeper's answer, shown under the picture (the customer's voice is the one heard). */
export function keeperLine(rng: Rng, b: Bill, accept: boolean, customer: Persona, keeper: Gender): string {
  const to = (m: string, f: string) => (customer.gender === 'f' ? f : m);
  const self = (m: string, f: string) => (keeper === 'f' ? f : m);
  if (b.kind === 'repay') return to('الله يعطيك العافية، ما قصرت.', 'الله يعطيج العافية، ما قصرتي.');
  if (accept) {
    if (b.kind === 'credit') return 'سجلتها بالدفتر. لا تنسى.';
    if (b.kind === 'kid') return 'خذها حبيبي، ولا يهمك.';
    if (b.pay === 'card') return rng.pick(['حط البطاقة… تمت. مشكور.', 'تمت العملية. الله يعطيك العافية.']);
    return rng.pick([to('تفضل الباقي، الله يعطيك العافية.', 'تفضلي الباقي، الله يعطيج العافية.'), to('حياك الله، تعال مرة ثانية.', 'حياج الله، تعالي مرة ثانية.'), 'مشكور، بالعافية.']);
  }
  switch (b.kind) {
    case 'fake':
      return 'هذي الورقة مزورة! ما أقبلها.';
    case 'trick':
      return `لا، سعره ${sayMoney(b.claim!.product.price)} مو ${sayMoney(b.claim!.said)}.`;
    case 'coupon':
      return `الكوبون منتهي، ${self('آسف', 'آسفة')}.`;
    case 'discount':
      return 'ما أقدر أسوي خصم، الأسعار مضبوطة.';
    case 'short':
      return `المبلغ ما يكفي، ${self('آسف', 'آسفة')}.`;
    case 'kid':
      return 'ما يكفي حبيبي.';
    case 'credit':
      return `ما نسجل دين، ${self('آسف', 'آسفة')}.`;
    default:
      return `لا، ${self('آسف', 'آسفة')}.`;
  }
}
