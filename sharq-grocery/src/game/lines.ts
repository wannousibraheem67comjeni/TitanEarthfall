/** What customers say at the counter, by kind of bill, in Gulf Arabic. */
import type { Rng } from '../core/rng';
import { fmt, type Bill } from './economy';
import type { Persona } from './customers';
import type { Gender } from './state';

export function customerLine(rng: Rng, b: Bill, p: Persona, keeper: Gender): string {
  // Addressing the shopkeeper (Emirati: «ج» for her), and the customer speaking of themselves.
  const k = (m: string, f: string) => (keeper === 'f' ? f : m);
  const me = (m: string, f: string) => (p.gender === 'f' ? f : m);
  const uncle = k('عمو', 'خالة');
  const hi = p.gender === 'f' ? 'السلام عليكم' : rng.pick(['السلام عليكم', 'مرحبا', 'هلا والله']);
  switch (b.kind) {
    case 'normal':
      return rng.pick([`${hi}، هذي أغراضي.`, `${hi}، كم الحساب؟`, k('حاسبني الله يعطيك العافية.', 'حاسبيني الله يعطيج العافية.'), `${hi}، ${k('الله يبارك لك', 'الله يبارك لج')}، كم صار؟`]);
    case 'big':
      return rng.pick(['عندنا عزيمة الليلة، أبي هالأغراض كلها!', `طلبية كبيرة اليوم، ${k('حاسبني', 'حاسبيني')} على الكل.`, `أبي أعبي البيت، ${k('حاسبني', 'حاسبيني')}.`]);
    case 'discount':
      return rng.pick([`${k('سوّ لي', 'سوّي لي')} خصم ${b.discount}٪ ${k('الله يخليك', 'الله يخليج')}، أنا ${me('زبون', 'زبونة')} ${k('عندك', 'عندج')} على طول.`, `ما في خصم ${b.discount}٪؟ بشتري ${k('منك', 'منج')} على طول والله.`]);
    case 'short':
      return rng.pick([`والله ما معي إلا ${fmt(b.pays)}، ${k('تمشيها؟', 'تمشينها؟')}`, `معي ${fmt(b.pays)} بس، ${k('اعذرني… تمشيها لي؟', 'اعذريني… تمشينها لي؟')}`]);
    case 'kid':
      return `${uncle}، معي ${fmt(b.pays)} بس… ${k('تكفى؟', 'تكفين؟')}`;
    case 'trick':
      return rng.pick([`${b.claim!.product.name} مكتوب عليه بالرف ${fmt(b.claim!.said)} بس!`, `${b.claim!.product.name} بـ${fmt(b.claim!.said)} صح؟ أمس اشتريته بهالسعر.`]);
    case 'coupon':
      return `عندي كوبون خصم ${b.coupon!.pct}٪، ${k('تفضل', 'تفضلي')}.`;
    case 'fake':
      return rng.pick([`${k('تفضل', 'تفضلي')}، ${fmt(b.note)}، بسرعة ${k('الله يخليك', 'الله يخليج')}.`, `${k('خذ', 'خذي')} ${fmt(b.note)}، ${me('مستعجل', 'مستعجلة')} شوي.`]);
    case 'credit':
      return rng.pick([`${k('سجلها', 'سجليها')} علي دين، أسدد ${k('لك', 'لج')} آخر الشهر إن شاء الله.`, `الحين ما معي فلوس، ${k('سجلها', 'سجليها')} بالدفتر وأرجع ${k('لك', 'لج')}.`]);
    case 'repay':
      return `جيت أسدد ديني، ${fmt(b.debt ?? 0)}. ${k('الله يجزاك خير', 'الله يجزاج خير')}.`;
  }
}
