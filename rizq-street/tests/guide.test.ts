import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { newState, Store } from '../src/game/state';
import { guideRespond, periodDays, type GuideAction } from '../src/dialogue/guide';
import { actionKey, parseActionKey } from '../src/dialogue/GuideBrain';
import { autoOffer, newConversation } from '../src/dialogue/brain';
import { npc } from '../src/dialogue/npcs';
import { normalizeArabic } from '../src/lang/arabic';
import { Colliders } from '../src/world/collision';
import { NavGraph } from '../src/game/Nav';

function store(hour = 10) {
  const st = new Store(newState('سالم', 'm'));
  st.s.minute = hour * 60;
  return st;
}
const types = (a: GuideAction[]) => a.map((x) => x.type);

describe('guide', () => {
  it('turns a spoken online-work request with a monthly target into a goal and a trip', () => {
    const st = store();
    const r = guideRespond('أريد شغل أونلاين يكسبني حوالي 1000 درهم كل شهر', st, new Rng(1));
    expect(r.actions).toContainEqual({ type: 'setGoal', amount: 1000, days: 30, job: 'online' });
    expect(r.actions).toContainEqual({ type: 'goJob', job: 'online' });
    expect(r.text).toContain('اختبار');
    expect(r.text).not.toMatch(/[{}]/);
  });

  it('understands spoken numbers and other periods', () => {
    const r = guideRespond('بدي اجمع ميتين درهم بالأسبوع من التوصيل', store(13), new Rng(2));
    expect(r.actions).toContainEqual({ type: 'setGoal', amount: 200, days: 7, job: 'delivery' });
    expect(periodDays(normalizeArabic('كل يوم'))).toBe(1);
    expect(periodDays(normalizeArabic('في السنة'))).toBe(365);
  });

  it('falls back to an open job when the requested one is closed', () => {
    const r = guideRespond('ابي اشتغل توصيل', store(8), new Rng(3));
    expect(r.text).toContain('مسكّر');
    const go = r.actions.find((a) => a.type === 'goJob');
    expect(go && go.type === 'goJob' && go.job).not.toBe('delivery');
  });

  it('helps the family first when asked, starting with chores inside the house', () => {
    const r = guideRespond('ابي اساعد اهلي', store(9), new Rng(4));
    expect(r.actions).toContainEqual({ type: 'goJob', job: 'sweep' });
  });

  it('takes the player to people and places', () => {
    expect(guideRespond('ودني لامي', store(), new Rng(5)).actions).toContainEqual({ type: 'talkTo', npc: 'mum' });
    expect(guideRespond('وين البقالة؟', store(), new Rng(5)).actions).toContainEqual({ type: 'goPlace', place: 'grocery' });
    expect(guideRespond('ابي اكلم جدي', store(), new Rng(5)).actions).toContainEqual({ type: 'talkTo', npc: 'grandpa' });
  });

  it('answers status, help, buying and stop', () => {
    const st = store();
    st.earn(120, 't');
    expect(guideRespond('كم معي فلوس؟', st, new Rng(6)).text).toContain('120');
    expect(guideRespond('كيف العب؟', st, new Rng(6)).actions).toEqual([{ type: 'help' }]);
    expect(types(guideRespond('ابي اشتري دراجة', st, new Rng(6)).actions)).toContain('setGoal');
    st.earn(500, 't');
    expect(guideRespond('ابي اشتري دراجة', st, new Rng(6)).actions).toEqual([{ type: 'buy', upgrade: 'bike' }]);
    expect(guideRespond('وقف', st, new Rng(6)).actions).toEqual([{ type: 'stop' }]);
  });

  it('never leaves template braces, for either gender', () => {
    for (const g of ['m', 'f'] as const) {
      const st = new Store(newState(g === 'm' ? 'سالم' : 'مريم', g));
      st.s.minute = 20 * 60;
      for (const t of ['مرحبا', 'كيف العب', 'ابي شغل', 'ابي شغل اونلاين بالف درهم', 'نام', 'شي غريب', 'ابي اشتري سكوتر', 'كم معي']) {
        const r = guideRespond(t, st, new Rng(7));
        expect(r.text, `${g}/${t}: ${r.text}`).not.toMatch(/[{}]/);
      }
    }
  });
});

describe('guide extras', () => {
  it('says the number of rounds in words, not "2 مرتين"', () => {
    const r = guideRespond('أريد شغل أونلاين يكسبني حوالي 1000 درهم كل شهر', store(), new Rng(1));
    expect(r.text).toContain('مرتين');
    expect(r.text).not.toMatch(/\d مرتين/);
  });

  it('suggests a different job for "شغل ثاني"', () => {
    const st = store(13);
    const first = guideRespond('وين أحسن شغل الحين؟', st, new Rng(4));
    const go = first.actions.find((a) => a.type === 'goJob');
    expect(go?.type).toBe('goJob');
    const job = go?.type === 'goJob' ? go.job : null;
    const second = guideRespond('لا، أبي شغل ثاني', st, new Rng(4), job);
    const next = second.actions.find((a) => a.type === 'goJob');
    expect(next?.type === 'goJob' && next.job).not.toBe(job);
  });

  it('round-trips action keys and rejects anything off the list', () => {
    const actions: GuideAction[] = [
      { type: 'goJob', job: 'online' },
      { type: 'talkTo', npc: 'grandpa' },
      { type: 'goPlace', place: 'atm' },
      { type: 'setGoal', amount: 1000, days: 30, job: 'online' },
      { type: 'setGoal', amount: 500, days: 7, job: null },
      { type: 'openPhone', tab: 'jobs' },
      { type: 'buy', upgrade: 'bike' },
      { type: 'sleep' },
      { type: 'stop' },
    ];
    for (const a of actions) expect(parseActionKey(actionKey(a))).toEqual(a);
    for (const bad of ['go_job:robbery', 'talk:nobody', 'set_goal:-5:30', 'set_goal:1000:0', 'set_goal:99999999:30', 'open_phone:camera', 'buy:yacht', 'delete_save', ''])
      expect(parseActionKey(bad), bad).toBeNull();
  });

  it('an employer the guide brings the player to offers the job and starts it', () => {
    const st = store(10);
    const conv = newConversation({ kind: 'npc', def: npc('mum') }, st);
    const r = autoOffer(conv, { store: st, rng: new Rng(5) }, 'errand');
    const start = r.actions.find((a) => a.type === 'startJob');
    expect(start?.type === 'startJob' && start.job).toBe('errand');
    expect(start?.type === 'startJob' && start.items?.length).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/[{}]/);
    const closed = store(3);
    const c2 = newConversation({ kind: 'npc', def: npc('grocer') }, closed);
    const r2 = autoOffer(c2, { store: closed, rng: new Rng(5) }, 'cashier');
    expect(r2.actions.some((a) => a.type === 'startJob')).toBe(false);
  });
});

describe('guide: house, company, partner, moving', () => {
  it('understands spoken movement', () => {
    const st = store();
    for (const [t, dir] of [
      ['امشي لقدام', 'forward'],
      ['ارجع لورا', 'back'],
      ['لف يمين', 'right'],
      ['يسار', 'left'],
      ['اطلع برا', 'out'],
      ['ادخل البيت', 'in'],
    ] as const)
      expect(guideRespond(t, st, new Rng(1)).actions, t).toContainEqual({ type: 'move', dir });
  });

  it('sends house chores, company work and the partner to the right people', () => {
    const st = store(10);
    expect(guideRespond('أبي أساعد أهلي بالبيت', st, new Rng(1)).actions).toContainEqual({ type: 'goJob', job: 'sweep' });
    expect(guideRespond('أبي أغسل الصحون', st, new Rng(1)).actions).toContainEqual({ type: 'goJob', job: 'dishes' });
    const company = guideRespond('أبي شغل بشركة', st, new Rng(1));
    expect(company.actions).toContainEqual({ type: 'goJob', job: 'reception' });
    expect(company.text).toContain('مقابلة');
    expect(guideRespond('أبي أشتغل مع تاجر', st, new Rng(1)).actions).toContainEqual({ type: 'goJob', job: 'trade' });
    st.earn(500, 'test');
    expect(guideRespond('أبي أستثمر فلوسي', st, new Rng(1)).actions).toContainEqual({ type: 'invest' });
    expect(guideRespond('شو في شغل على قدي؟', st, new Rng(1)).actions).toContainEqual({ type: 'openBoard' });
    expect(guideRespond('أبي أصير غني', st, new Rng(1)).text).toContain('أبو راشد');
  });

  it('locks sales until promotion and promotes with shifts', () => {
    const st = store(10);
    expect(st.jobBlock('sales')).toBe('locked');
    expect(st.lockText('sales')).toContain('موظف');
    st.bump('companyShifts', 4);
    expect(st.companyRank).toBe(1);
    expect(st.jobBlock('sales')).toBeNull();
    expect(st.payFor('reception', 45)).toBeGreaterThan(45);
  });

  it('pays partnerships into the bank every morning until they end', () => {
    const st = store(10);
    st.earn(300, 'test');
    expect(st.invest('karakcart')).toBe('ok');
    expect(st.s.wallet).toBe(0);
    st.sleep();
    expect(st.s.bank).toBeGreaterThanOrEqual(30);
    expect(st.s.investments[0].daysLeft).toBe(14);
    for (let d = 0; d < 14; d++) st.sleep();
    expect(st.s.investments.length).toBe(0);
  });
});

describe('navigation', () => {
  it('routes around a wall', () => {
    const c = new Colliders({ minX: -50, maxX: 50, minZ: -50, maxZ: 50 });
    c.addBox(-1, -20, 1, 9, 3); // a wall across the road at x=0, open at the south edge
    const nav = new NavGraph(c);
    expect(nav.nodes.length).toBeGreaterThan(20);
    const path = nav.route({ x: -10, z: 0 }, { x: 10, z: 0 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 10, z: 0 });
    // Every leg of the route is a clear straight walk.
    let at = { x: -10, z: 0 };
    for (const p of path!) {
      expect(nav.clear(at, p, 0.3)).toBe(true);
      at = p;
    }
  });
});
