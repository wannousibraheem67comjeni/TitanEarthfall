import { describe, expect, it } from 'vitest';
import { dirhamWord, fillTemplate, firstNumber, formatMoney, formatNumber, normalizeArabic, parseNumbers, tokenVariants } from '../src/lang/arabic';
import { analyze } from '../src/lang/intents';

describe('normalisation', () => {
  it('unifies spelling variants and strips decoration', () => {
    expect(normalizeArabic('أهلاً وسهلاً!')).toBe('اهلا وسهلا');
    expect(normalizeArabic('مدرسة')).toBe('مدرسه');
    expect(normalizeArabic('مستشفى')).toBe('مستشفي');
    expect(normalizeArabic('شـــكراً')).toBe('شكرا');
    expect(normalizeArabic('مئة')).toBe('ميه');
    expect(normalizeArabic('١٢٫٥ درهم')).toBe('12.5 درهم');
    expect(normalizeArabic('كم السعر؟')).toBe('كم السعر');
  });

  it('offers clitic-free variants of a token', () => {
    expect(tokenVariants('والشغل')).toEqual(expect.arrayContaining(['والشغل', 'الشغل', 'شغل']));
    expect(tokenVariants('بالبيت')).toContain('بيت');
    expect(tokenVariants('ب')).toEqual(['ب']);
  });
});

describe('numbers', () => {
  const cases: [string, number[]][] = [
    ['خمسة وعشرين', [25]],
    ['ميه وخمسين', [150]],
    ['ثلاثمية', [300]],
    ['ثلاث مية', [300]],
    ['ألفين وخمسمية', [2500]],
    ['خمسة عشر', [15]],
    ['خمسطعش', [15]],
    ['اثنا عشر درهم', [12]],
    ['احد عشر', [11]],
    ['عشرة آلاف', [10000]],
    ['عشرين ألف', [20000]],
    ['الف وميتين', [1200]],
    ['مية وخمسة وعشرين', [125]],
    ['٤٥', [45]],
    ['12', [12]],
    ['12.5', [12.5]],
    ['درهمين', [2]],
    ['بدرهم', [1]],
    ['درهم ونص', [1.5]],
    ['درهم واحد', [1]],
    ['اعطني خمسه خبز وثلاث حليب', [5, 3]],
    ['الباقي سبعة دراهم', [7]],
    ['خمسة و عشرين', [25]],
    ['ثلاثة آلاف وخمسمية وخمسين', [3550]],
    ['كيف حالك', []],
  ];
  for (const [text, want] of cases) {
    it(`reads "${text}"`, () => expect(parseNumbers(text)).toEqual(want));
  }

  it('firstNumber picks the first value', () => {
    expect(firstNumber('بعشرين او ثلاثين')).toBe(20);
    expect(firstNumber('ما في رقم')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats money with the right counted noun', () => {
    expect(formatNumber(1250)).toBe('1,250');
    expect(formatMoney(1)).toBe('درهم واحد');
    expect(formatMoney(2)).toBe('درهمين');
    expect(formatMoney(5)).toBe('5 دراهم');
    expect(formatMoney(20)).toBe('20 درهم');
    expect(dirhamWord(11)).toBe('درهم');
  });

  it('fills gendered templates', () => {
    expect(fillTemplate('يعطيك العافية يا {بطل|بطلة}، خذ {pay}', 'm', { pay: '20 درهم' })).toBe('يعطيك العافية يا بطل، خذ 20 درهم');
    expect(fillTemplate('{تعال|تعالي} يا {name}', 'f', { name: 'مريم' })).toBe('تعالي يا مريم');
    expect(fillTemplate('{unknown}', 'm')).toBe('{unknown}');
  });
});

describe('intents', () => {
  const top = (s: string) => analyze(s).ranked[0];
  it('recognises greetings across dialects', () => {
    expect(analyze('السلام عليكم').has('salam')).toBe(true);
    expect(analyze('هلا والله شحالك').has('how_are_you')).toBe(true);
    expect(analyze('مرحبا كيفك').has('greet')).toBe(true);
    expect(analyze('ازيك يا باشا').has('how_are_you')).toBe(true);
  });

  it('recognises asking for work in many phrasings', () => {
    for (const s of ['عندك شغل؟', 'بدي اشتغل عندك', 'ابغى اشتغل', 'أريد عمل', 'في شي اسويه؟', 'تحتاج مساعدة؟', 'وظفني الله يخليك', 'بساعدك بالشغل']) {
      expect(analyze(s).has('ask_work'), s).toBe(true);
    }
  });

  it('turns a negated request into a refusal', () => {
    const a = analyze('لا ما ابي شغل الحين');
    expect(a.has('decline')).toBe(true);
    expect(a.has('ask_work')).toBe(false);
  });

  it('distinguishes yes from no', () => {
    expect(top('اكيد يلا')).toBe('accept');
    expect(top('ابشر')).toBe('accept');
    expect(top('لا شكرا')).toBe('decline');
    expect(top('بعدين')).toBe('decline');
  });

  it('finds thanks, goodbyes, prices and directions', () => {
    expect(top('مشكور ما قصرت')).toBe('thanks');
    expect(top('يلا مع السلامة')).toBe('bye');
    expect(analyze('بكم الماي؟').has('ask_price')).toBe(true);
    expect(analyze('وين البقالة؟').has('ask_location')).toBe(true);
    expect(analyze('كيف اجمع فلوس بسرعة').has('money_advice')).toBe(true);
  });

  it('extracts numbers alongside intents', () => {
    expect(analyze('الباقي خمسة وعشرين درهم').numbers).toEqual([25]);
  });
});
