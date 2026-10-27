import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { breakdown, isOpenAt, JOBS, skillMultiplier } from '../src/game/catalog';
import { migrate, newState, Store } from '../src/game/state';
import { describeOrder, makeOrder, orderTotal } from '../src/game/jobs/cashier';
import { DRINKS, cupPay, pickDrink, recipeErrors } from '../src/game/jobs/karak';
import { blendScore, makeRequest } from '../src/game/jobs/perfume';
import { makeQuestion } from '../src/game/jobs/tutor';
import { react, willingness } from '../src/game/jobs/stall';
import { editDistance, typingAccuracy, gigPay } from '../src/game/jobs/online';
import { deliveryPay } from '../src/game/jobs/delivery';
import { washPay } from '../src/game/jobs/carwash';
import { NPCS } from '../src/dialogue/npcs';
import { PLACE_BY_ID } from '../src/world/layout';

describe('money', () => {
  it('breaks amounts into notes and coins', () => {
    expect(breakdown(1287)).toEqual([
      { value: 1000, count: 1 },
      { value: 200, count: 1 },
      { value: 50, count: 1 },
      { value: 20, count: 1 },
      { value: 10, count: 1 },
      { value: 5, count: 1 },
      { value: 1, count: 2 },
    ]);
    expect(breakdown(0)).toEqual([]);
  });

  it('earns, spends and refuses overspending', () => {
    const st = new Store(newState('سالم', 'm'));
    const seen: number[] = [];
    st.on('money', (e) => seen.push(e.delta));
    st.earn(50, 'test');
    expect(st.spend(20, 'x')).toBe(true);
    expect(st.spend(100, 'y')).toBe(false);
    expect(st.s.wallet).toBe(30);
    expect(seen).toEqual([50, -20]);
    st.earn(100, 'gig', { bank: true });
    expect(st.withdraw(60)).toBe(true);
    expect(st.s.bank).toBe(40);
    expect(st.s.wallet).toBe(90);
    expect(st.s.ledger[0].label).toBe('سحب من الصراف');
  });

  it('pays interest and passive income at day rollover', () => {
    const st = new Store(newState('مريم', 'f'));
    st.s.bank = 500;
    st.s.upgrades.shop = true;
    const days: number[] = [];
    st.on('day', (e) => days.push(e.day));
    st.advance(24 * 60);
    expect(days).toEqual([2]);
    expect(st.s.bank).toBe(500 + 5 + 300);
  });

  it('sleeps until seven the next morning', () => {
    const st = new Store(newState('سالم', 'm'));
    st.s.minute = 22 * 60;
    st.sleep();
    expect(st.s.day).toBe(2);
    expect(st.s.minute).toBe(7 * 60);
  });
});

describe('jobs and skills', () => {
  it('respects opening hours, daily limits and requirements', () => {
    const st = new Store(newState('سالم', 'm'));
    expect(isOpenAt([7, 24], 23.5)).toBe(true);
    expect(isOpenAt([6, 25], 0.5)).toBe(true);
    expect(isOpenAt([6, 25], 3)).toBe(false);
    expect(isOpenAt([0, 24], 3)).toBe(true);
    st.s.minute = 8 * 60;
    expect(st.jobBlock('plants')).toBeNull();
    st.finishJob('plants');
    expect(st.jobBlock('plants')).toBe('done');
    expect(st.jobBlock('stall')).toBe('locked');
    st.s.minute = 3 * 60;
    expect(st.jobBlock('cashier')).toBe('closed');
    st.advance(24 * 60);
    st.s.minute = 9 * 60;
    expect(st.jobBlock('plants')).toBeNull();
  });

  it('levels up and raises pay', () => {
    const st = new Store(newState('سالم', 'm'));
    expect(st.payFor('karak', 50)).toBe(50);
    st.gainXp('karak', 500);
    expect(st.level('karak')).toBeGreaterThan(3);
    expect(st.payFor('karak', 50)).toBeGreaterThan(60);
    expect(skillMultiplier(1)).toBe(1);
  });

  it('every job points at a real place and employer', () => {
    const ids = new Set(NPCS.map((n) => n.id));
    for (const j of JOBS) {
      expect(PLACE_BY_ID.has(j.place), j.id).toBe(true);
      if (j.employer) expect(ids.has(j.employer), j.id).toBe(true);
      if (j.employer) expect(NPCS.find((n) => n.id === j.employer)!.jobs, j.id).toContain(j.id);
    }
  });

  it('migrates partial saves', () => {
    expect(migrate(null)).toBeNull();
    const m = migrate({ player: { name: 'سالم', gender: 'm' }, wallet: 'oops' });
    expect(m?.wallet).toBe(0);
    expect(m?.day).toBe(1);
  });
});

describe('mini-game rules', () => {
  const rng = new Rng(7);

  it('cashier orders add up and change is consistent', () => {
    for (let i = 0; i < 200; i++) {
      const o = makeOrder(rng, 1 + (i % 6));
      expect(o.total).toBe(orderTotal(o.lines));
      expect(o.paidWith).toBeGreaterThanOrEqual(o.total);
      expect(o.change).toBe(o.paidWith - o.total);
      expect(describeOrder(o.lines).length).toBeGreaterThan(0);
    }
  });

  it('karak recipes are graded by ingredient errors', () => {
    const karak = DRINKS[0];
    expect(recipeErrors({ ...karak.recipe }, karak.recipe)).toBe(0);
    expect(recipeErrors({ ...karak.recipe, sugar: 2 }, karak.recipe)).toBe(1);
    expect(cupPay(8, 0, 5, 1).verdict).toBe('perfect');
    expect(cupPay(8, 3, 5, 1).wage).toBe(0);
    for (let i = 0; i < 50; i++) expect(pickDrink(rng, 1).minLevel).toBe(1);
  });

  it('perfume blends score by overlap', () => {
    expect(blendScore(['oud', 'amber'], ['amber', 'oud'])).toBe(1);
    expect(blendScore(['oud'], ['oud', 'amber'])).toBe(0.5);
    expect(blendScore([], ['oud'])).toBe(0);
    for (let i = 0; i < 50; i++) {
      const r = makeRequest(rng, 4);
      expect(r.oils.length).toBeGreaterThanOrEqual(2);
      expect(r.line.length).toBeGreaterThan(5);
    }
  });

  it('tutor questions have integer answers', () => {
    for (let i = 0; i < 100; i++) {
      const q = makeQuestion(rng, i % 6);
      expect(Number.isInteger(q.answer)).toBe(true);
      expect(q.answer).toBeGreaterThan(0);
    }
  });

  it('stall customers buy, haggle or leave by price', () => {
    const will = willingness(new Rng(1), 'water', 13, true);
    expect(react(1, will).kind).toBe('buy');
    expect(react(will * 1.2, will).kind).toBe('haggle');
    expect(react(will * 3, will).kind).toBe('leave');
  });

  it('online gig grading is forgiving on spelling variants', () => {
    expect(editDistance('كرك', 'كرك')).toBe(0);
    expect(typingAccuracy('مدرسه', 'مدرسة')).toBe(1);
    expect(typingAccuracy('', 'abc')).toBe(0);
    expect(gigPay(20, 1)).toBe(24);
    expect(gigPay(20, 0.2)).toBe(0);
  });

  it('delivery and car wash pay reward speed and care', () => {
    expect(deliveryPay(25, 0, 40, 1, false)).toEqual({ wage: 13, tip: 0 });
    expect(deliveryPay(25, 40, 40, 1, false).tip).toBe(12);
    expect(washPay(30, 0.3, 10, 1).wage).toBe(0);
    expect(washPay(30, 1, 20, 1).tip).toBeGreaterThan(0);
  });
});
