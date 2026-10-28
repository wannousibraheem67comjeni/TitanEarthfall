import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { acceptGain, decide, fmt, type Kind, LADDER, makeBill, noteFor, PRODUCTS, rank, STAGES, stocked } from '../src/game/economy';

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
          if (kind !== 'credit') expect(b.note).toBeGreaterThanOrEqual(b.pays);
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

  it('use the smallest banknote that covers the amount', () => {
    expect(noteFor(3)).toBe(5);
    expect(noteFor(20)).toBe(20);
    expect(noteFor(171)).toBe(200);
    expect(noteFor(2500)).toBe(3000);
  });
});

describe('decisions', () => {
  const rng = new Rng(5);

  it('accepting an honest bill earns the margin; refusing it costs stars', () => {
    const b = makeBill(rng, 1, 'normal');
    const yes = decide(b, true, 0.5);
    expect(yes.money).toBeCloseTo(b.total - b.cost, 2);
    expect(yes.good).toBe(true);
    const no = decide(b, false, 0.5);
    expect(no.money).toBe(0);
    expect(no.rep).toBeLessThan(0);
  });

  it('a fake note loses the goods when accepted and is praised when refused', () => {
    const b = makeBill(rng, 2, 'fake');
    expect(acceptGain(b)).toBe(-b.cost);
    expect(decide(b, true, 0).good).toBe(false);
    const no = decide(b, false, 0);
    expect(no.good).toBe(true);
    expect(no.rep).toBeGreaterThan(0);
  });

  it('calling out a price trick usually gets the right price', () => {
    const b = makeBill(rng, 3, 'trick');
    expect(decide(b, false, 0.1).money).toBeCloseTo(b.total - b.cost, 2);
    expect(decide(b, false, 0.9).money).toBe(0);
    expect(decide(b, true, 0).money).toBeLessThan(b.total - b.cost);
  });

  it('an expired coupon: refuse and they usually pay in full', () => {
    const b = makeBill(rng, 3, 'coupon');
    expect(decide(b, false, 0.2).money).toBeCloseTo(b.total - b.cost, 2);
    expect(decide(b, true, 0).good).toBe(false);
  });

  it('credit is recorded as a debt and a repayment brings it back', () => {
    const b = makeBill(rng, 2, 'credit');
    const out = decide(b, true, 0);
    expect(out.money).toBe(-b.cost);
    expect(out.debt).toBe(b.total);
    const repay = decide({ ...b, kind: 'repay', debt: b.total }, true, 0);
    expect(repay.money).toBe(b.total);
  });

  it('a kind word to a child is worth more stars than the dirham', () => {
    const b = makeBill(rng, 0, 'kid');
    expect(decide(b, true, 0).rep).toBeGreaterThan(0);
    expect(decide(b, false, 0).rep).toBeLessThan(0);
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
