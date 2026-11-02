import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { acceptGain, decide, fmt, type Kind, LADDER, makeBill, noteFor, pickKind, PRODUCTS, rank, STAGES, stocked } from '../src/game/economy';
import { billSpeech, itemPhrase, sayMoney } from '../src/game/lines';

const KINDS: Kind[] = ['normal', 'big', 'discount', 'short', 'kid', 'trick', 'coupon', 'fake', 'credit'];

describe('prices', () => {
  it('every product sells above what it costs', () => {
    for (const p of PRODUCTS) expect(p.price, p.name).toBeGreaterThan(p.cost);
  });

  it('every stage brings new goods onto the shelves', () => {
    STAGES.forEach((_, i) => expect(PRODUCTS.some((p) => p.stage === i), `stage ${i}`).toBe(true));
    expect(stocked(0).every((p) => p.stage === 0)).toBe(true);
    expect(stocked(STAGES.length - 1)).toHaveLength(PRODUCTS.length);
  });

  it('upgrades get dearer stage after stage', () => {
    const costs = STAGES.map((s) => s.next).filter((n): n is number => n !== null);
    costs.forEach((c, i) => i && expect(c).toBeGreaterThan(costs[i - 1]));
    expect(STAGES[STAGES.length - 1].next).toBeNull();
  });
});

describe('bills', () => {
  it('add up, and the banknote covers what is paid', () => {
    const rng = new Rng(11);
    for (let stage = 0; stage < STAGES.length; stage++)
      for (const kind of KINDS)
        for (let i = 0; i < 30; i++) {
          const b = makeBill(rng, stage, kind);
          expect(b.lines.length).toBeGreaterThan(0);
          expect(b.total).toBeCloseTo(b.lines.reduce((a, l) => a + l.product.price * l.qty, 0), 2);
          expect(b.cost).toBeLessThan(b.total);
          if (kind !== 'credit' && b.pay === 'cash') expect(b.note).toBeGreaterThanOrEqual(b.pays);
          for (const l of b.lines) expect(l.product.stage).toBeLessThanOrEqual(stage);
        }
  });

  it('carry the clue for each trick', () => {
    const rng = new Rng(3);
    const trick = makeBill(rng, 2, 'trick');
    expect(trick.claim!.said).toBeLessThan(trick.claim!.product.price);
    expect(trick.pays).toBeLessThan(trick.total);
    expect(makeBill(rng, 2, 'coupon').coupon!.expired).toMatch(/الماضي$/);
    expect(makeBill(rng, 2, 'discount').discount).toBeGreaterThan(0);
    const kid = makeBill(rng, 0, 'kid');
    expect(kid.pays).toBe(kid.total - 1);
    expect(makeBill(rng, 1, 'credit').pays).toBe(0);
  });

  it('card payments come only with honest bills, more often in bigger shops', () => {
    const rng = new Rng(9);
    const share = (stage: number) => {
      let card = 0;
      for (let i = 0; i < 400; i++) {
        const b = makeBill(rng, stage, 'normal');
        if (b.pay === 'card') card++;
      }
      return card / 400;
    };
    expect(share(0)).toBeLessThan(share(5));
    for (const kind of ['fake', 'trick', 'coupon', 'credit', 'kid'] as Kind[]) expect(makeBill(rng, 5, kind).pay).toBe('cash');
  });

  it('use the smallest banknote that covers the amount', () => {
    expect(noteFor(3)).toBe(5);
    expect(noteFor(20)).toBe(20);
    expect(noteFor(171)).toBe(200);
    expect(noteFor(2500)).toBe(3000);
  });
});

describe('the shop takes every bill', () => {
  it('only honest bills come in, at every stage', () => {
    const rng = new Rng(17);
    for (let stage = 0; stage < STAGES.length; stage++)
      for (let i = 0; i < 300; i++) expect(['normal', 'big', 'kid', 'credit']).toContain(pickKind(rng, stage));
  });

  it('everything a customer pays goes in the till', () => {
    const rng = new Rng(19);
    for (let stage = 0; stage < STAGES.length; stage++)
      for (const kind of ['normal', 'big'] as Kind[]) {
        const b = makeBill(rng, stage, kind);
        expect(decide(b).money).toBeCloseTo(b.total, 2);
        expect(acceptGain(b)).toBeCloseTo(b.total, 2);
      }
  });

  it('a child a dirham short: the coins go in the till, and a star for kindness', () => {
    const b = makeBill(new Rng(5), 0, 'kid');
    const out = decide(b);
    expect(out.money).toBe(b.total - 1);
    expect(out.rep).toBeGreaterThan(0.2);
  });

  it('credit is written in the debt book and paid back later in full', () => {
    const b = makeBill(new Rng(6), 2, 'credit');
    const out = decide(b);
    expect(out.money).toBe(0);
    expect(out.debt).toBe(b.total);
    expect(decide({ ...b, kind: 'repay', debt: b.total }).money).toBe(b.total);
  });

  it('talks to her as her', () => {
    const b = makeBill(new Rng(8), 2, 'credit');
    expect(decide(b, { she: true }).text).toContain('عليها');
    expect(decide(b, { keeperShe: true }).says).toContain('لج');
  });
});

describe('stages', () => {
  it('a small shop gets one to three customers, a big one dozens, with more cashiers', () => {
    expect(STAGES[0].crowd).toBeLessThanOrEqual(3);
    expect(STAGES[0].lanes).toBe(0);
    expect(STAGES[STAGES.length - 1].crowd).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].crowd).toBeGreaterThanOrEqual(STAGES[i - 1].crowd);
      expect(STAGES[i].lanes).toBeGreaterThanOrEqual(STAGES[i - 1].lanes);
    }
  });
});

describe('ladder and money words', () => {
  it('ranks by worth, up to the richest of all', () => {
    expect(rank(0)).toBe(0);
    expect(rank(999)).toBe(1);
    expect(rank(1000)).toBe(2);
    expect(LADDER[rank(1e9)].title[0]).toContain('أغنى شخص على الإطلاق');
  });

  it('formats dirhams the way people say them', () => {
    expect(fmt(1)).toBe('1 درهم');
    expect(fmt(5)).toBe('5 دراهم');
    expect(fmt(11)).toBe('11 درهم');
    expect(fmt(2.5)).toBe('2.5 درهم');
    expect(fmt(24000)).toBe('24,000 درهم');
  });
});

describe('what customers say', () => {
  const persona = (gender: 'm' | 'f', child = false) => ({ name: 'سالم', look: {} as never, gender, pitch: 1, key: 'x', trust: 0.8, child });

  it('names each item, how they pay, and asks to accept or refuse', () => {
    const rng = new Rng(21);
    for (let i = 0; i < 40; i++) {
      const b = makeBill(rng, 3, 'normal');
      const s = billSpeech(rng, b, persona('m'), 'm');
      expect(s.marks).toHaveLength(b.lines.length);
      b.lines.forEach((l, j) => expect(s.text.slice(s.marks[j].at)).toMatch(new RegExp(`^و?${itemPhrase(l)}`)));
      expect(s.text).toContain('تقبل فاتورتي؟');
      expect(s.text).not.toContain('ترفض');
      expect(s.text).toMatch(b.pay === 'card' ? /بالبطاقة/ : /وهذي|تفضل/);
    }
  });

  it('talks to her as her', () => {
    const rng = new Rng(4);
    const s = billSpeech(rng, makeBill(rng, 1, 'credit'), persona('f'), 'f');
    expect(s.text).toContain('سجليها');
    expect(s.text).toContain('تقبلين فاتورتي؟');
  });

  it('says quantities the way people do', () => {
    const p = PRODUCTS.find((x) => x.id === 'water')!;
    expect(itemPhrase({ product: p, qty: 1, price: 1 })).toBe('قنينة ماي');
    expect(itemPhrase({ product: p, qty: 2, price: 1 })).toBe('قنينتين ماي');
    expect(itemPhrase({ product: p, qty: 3, price: 1 })).toBe('ثلاث قناني ماي');
    expect(itemPhrase({ product: p, qty: 24, price: 1 })).toBe('24 قنينة ماي');
    expect(sayMoney(7.5)).toBe('7 ونص درهم');
    expect(sayMoney(2)).toBe('درهمين');
  });

  it('a child asks the shopkeeper as uncle or auntie', () => {
    const rng = new Rng(2);
    expect(billSpeech(rng, makeBill(rng, 0, 'kid'), persona('m', true), 'f').text).toMatch(/^خالة/);
  });
});
