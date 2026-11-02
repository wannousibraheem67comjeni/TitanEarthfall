import { beforeEach, describe, expect, it } from 'vitest';
import { STAGES } from '../src/game/economy';
import { newState, Store } from '../src/game/state';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('store', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
  });

  it('the pink button moves the till into savings', () => {
    const st = new Store(newState('سارة', 'f'));
    st.till(25);
    expect(st.save()).toBe(25);
    expect(st.s.drawer).toBe(0);
    expect(st.s.savings).toBe(25);
    expect(st.save()).toBe(0);
  });

  it('upgrades from savings only; the leftover stays saved', () => {
    const st = new Store(newState('علي', 'm'));
    const cost = STAGES[0].next!;
    const stages: number[] = [];
    st.on('stage', (e) => stages.push(e.stage));
    st.till(cost + 7);
    expect(st.canUpgrade).toBe(false);
    st.save();
    expect(st.canUpgrade).toBe(true);
    expect(st.upgrade()).toBe(true);
    expect(st.s.stage).toBe(1);
    expect(st.s.savings).toBe(7);
    expect(st.s.invested).toBe(cost);
    expect(stages).toEqual([1]);
  });

  it('saving in small amounts adds up: 5, then 5, then 5', () => {
    const st = new Store(newState('علي', 'm'));
    for (let i = 0; i < 4; i++) {
      st.till(5);
      expect(st.save()).toBe(5);
    }
    expect(st.s.savings).toBe(20);
    expect(st.s.drawer).toBe(0);
  });

  it('cannot go past the last stage', () => {
    const st = new Store({ ...newState('علي', 'm'), stage: STAGES.length - 1, savings: 1e9 });
    expect(st.canUpgrade).toBe(false);
    expect(st.upgrade()).toBe(false);
  });

  it('branches and contracts bring income every minute', () => {
    const big = new Store({ ...newState('علي', 'm'), stage: 6 });
    expect(big.advance(30)).toBeCloseTo(STAGES[6].passive / 2, 5);
    expect(big.s.drawer).toBeCloseTo(STAGES[6].passive / 2, 5);
    expect(new Store(newState('علي', 'm')).advance(60)).toBe(0);
  });

  it('announces each new title once, with the right form for her', () => {
    const st = new Store(newState('مريم', 'f'));
    const ranks: number[] = [];
    st.on('rank', (e) => ranks.push(e.rank));
    st.till(150);
    st.till(1);
    expect(ranks).toEqual([1]);
    expect(st.title).toBe('أشهر بقالة بالفريج');
  });

  it('keeps stars between zero and five', () => {
    const st = new Store(newState('علي', 'm'));
    st.stars(10);
    expect(st.s.rep).toBe(5);
    st.stars(-20);
    expect(st.s.rep).toBe(0);
  });

  it('saves, loads and repairs old saves', () => {
    const st = new Store(newState('سارة', 'f'));
    st.till(12);
    st.persist();
    const back = Store.load()!;
    expect(back.name).toBe('سارة');
    expect(back.drawer).toBe(12);
    localStorage.setItem('sharq-grocery.save', JSON.stringify({ name: 'قديم', stage: 99 }));
    const fixed = Store.load()!;
    expect(fixed.stage).toBe(STAGES.length - 1);
    expect(fixed.stats.customers).toBe(0);
    Store.clear();
    expect(Store.load()).toBeNull();
  });
});
