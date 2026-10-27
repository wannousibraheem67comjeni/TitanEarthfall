import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { newState, Store } from '../src/game/state';
import { formatClock, newConversation, opening, respond, type Action } from '../src/dialogue/brain';
import { npc } from '../src/dialogue/npcs';
import { makePasserby } from '../src/dialogue/pedestrians';
import type { NpcId } from '../src/game/catalog';

function setup(id: NpcId, hour = 10, gender: 'm' | 'f' = 'm') {
  const store = new Store(newState(gender === 'm' ? 'سالم' : 'مريم', gender));
  store.s.minute = hour * 60;
  const w = { store, rng: new Rng(3) };
  const conv = newConversation({ kind: 'npc', def: npc(id) }, store);
  return { store, w, conv };
}

const kinds = (actions: Action[]) => actions.map((a) => a.type);

describe('offline brain', () => {
  it('answers salam properly and offers work on request', () => {
    const { w, conv } = setup('grocer');
    const r = respond(conv, 'السلام عليكم، عندك شغل؟', w);
    expect(r.text).toContain('وعليكم السلام');
    expect(conv.pending).toEqual({ kind: 'job', job: 'cashier' });
    const yes = respond(conv, 'إي أكيد', w);
    expect(yes.actions).toContainEqual(expect.objectContaining({ type: 'startJob', job: 'cashier' }));
  });

  it('can be told no', () => {
    const { w, conv } = setup('karak');
    respond(conv, 'بدي اشتغل', w);
    const no = respond(conv, 'لا، بعدين', w);
    expect(kinds(no.actions)).not.toContain('startJob');
    expect(conv.pending).toBeNull();
  });

  it('explains when a shop is closed and points elsewhere', () => {
    const { w, conv } = setup('shawarma', 9);
    const r = respond(conv, 'في شغل؟', w);
    expect(r.text).toContain('حداش');
    expect(kinds(r.actions)).toContain('mark');
  });

  it('sells grocery items with quantities', () => {
    const { store, w, conv } = setup('grocer');
    store.earn(50, 'test');
    const r = respond(conv, 'ابي ٢ خبز وحليب', w);
    const sell = r.actions.find((a) => a.type === 'sell');
    expect(sell).toEqual({ type: 'sell', lines: [{ id: 'bread', qty: 2 }, { id: 'milk', qty: 1 }], total: 10 });
  });

  it('refuses a sale the player cannot afford', () => {
    const { w, conv } = setup('grocer');
    const r = respond(conv, 'عطني رز', w);
    expect(kinds(r.actions)).not.toContain('sell');
    expect(r.text).toContain('ما معك');
  });

  it('gives directions with a map mark', () => {
    const { w, conv } = setup('hamad');
    const r = respond(conv, 'وين محل الكرك؟', w);
    expect(r.actions).toContainEqual({ type: 'mark', place: 'karak' });
  });

  it('grandpa gives a daily gift once', () => {
    const { w, conv } = setup('grandpa');
    const first = respond(conv, 'السلام عليكم يا جدي', w);
    expect(kinds(first.actions)).toContain('pay');
    const again = respond(conv, 'مرحبا', w);
    expect(kinds(again.actions)).not.toContain('pay');
  });

  it('mum runs the errand loop', () => {
    const { store, w, conv } = setup('mum');
    opening(conv, w); // tutorial offer for plants
    respond(conv, 'لا', w);
    const ask = respond(conv, 'عندك مقاضي؟', w);
    expect(conv.pending?.kind).toBe('job');
    const startAct = respond(conv, 'ابشري', w).actions.find((a) => a.type === 'startJob');
    expect(startAct).toBeTruthy();
    void ask;
    // Simulate the job starting and the items being bought.
    if (startAct?.type === 'startJob' && startAct.items) {
      store.s.errand = { items: startAct.items, cash: startAct.cash ?? 0 };
      for (const i of startAct.items) store.addItem(i);
    }
    const conv2 = newConversation({ kind: 'npc', def: npc('mum') }, store);
    const back = opening(conv2, w);
    expect(kinds(back.actions)).toContain('completeErrand');
  });

  it('upgrades are sold with confirmation', () => {
    const { store, w, conv } = setup('electro', 12);
    store.earn(500, 'savings');
    const r = respond(conv, 'بكم الدراجة؟', w);
    expect(conv.pending).toEqual({ kind: 'buy', upgrade: 'bike' });
    expect(r.text).toContain('450');
    const yes = respond(conv, 'اوكي بشتريها', w);
    expect(yes.actions).toContainEqual({ type: 'buyUpgrade', id: 'bike' });
  });

  it('uses the right gendered forms', () => {
    const { w, conv } = setup('umali', 16, 'f');
    const r = respond(conv, 'عندك شغل؟', w);
    expect(r.text).not.toMatch(/\{|\}/);
  });

  it('passers-by return wallets and give directions', () => {
    const { store, w } = setup('mum');
    store.addItem('wallet');
    const p = makePasserby(new Rng(9), 'p1');
    const conv = newConversation({ kind: 'passerby', p, ownsWallet: true }, store);
    const r = respond(conv, 'لقيت محفظتك', w);
    expect(kinds(r.actions)).toContain('returnWallet');
    const conv2 = newConversation({ kind: 'passerby', p, ownsWallet: false }, store);
    const d = respond(conv2, 'وين المغسلة؟', w);
    expect(d.actions).toContainEqual({ type: 'mark', place: 'carwash' });
  });

  it('never leaves template braces in any line', () => {
    for (const id of ['mum', 'dad', 'grandpa', 'grocer', 'karak', 'shawarma', 'carwash', 'umali', 'ali', 'hamad', 'electro', 'barber'] as NpcId[]) {
      for (const g of ['m', 'f'] as const) {
        const { w, conv } = setup(id, 16, g);
        for (const s of ['مرحبا', 'كيفك', 'شو اسمك', 'عندك شغل', 'كيف اجمع فلوس', 'سولف لي', 'شكرا', 'غبي', 'مع السلامة']) {
          const r = respond(conv, s, w);
          expect(r.text, `${id}/${g}/${s}: ${r.text}`).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it('formats clock times', () => {
    expect(formatClock(15 * 60 + 5)).toBe('3:05 العصر');
    expect(formatClock(0)).toBe('12:00 بعد نص الليل');
  });
});
