import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { acceptGain, averageProfit, LADDER, makeBill, STAGES } from '../src/game/economy';

/** Seconds a customer spends in the shop: walking in, a few shelves, the line, the till. */
const STAY = 45;
/** Average size of the waves (quiet, ordinary, rush) relative to a stage's usual crowd. */
const WAVES = 0.3 * 0.4 + 0.42 * 1 + 0.28 * 1.8;
/** Customers a minute your desk can serve (goods down, the bill said, accepted), and another cashier. */
const DESK = 3.75;
const CASHIER = 7;

/** Average money in the till per customer (credit counted as repaid most of the time). */
function revenue(stage: number, rng: Rng): number {
  let sum = 0;
  const n = 800;
  for (let k = 0; k < n; k++) {
    const b = makeBill(rng, stage);
    sum += acceptGain(b) + (b.kind === 'credit' ? b.total * 0.75 : 0);
  }
  return sum / n;
}

/** Money a minute at a stage: customers served at all the tills, plus branch income. */
function perMinute(stage: number, rng: Rng): number {
  const st = STAGES[stage];
  const arrivals = (st.crowd * WAVES * 60) / STAY;
  const served = Math.min(arrivals, DESK + st.lanes * CASHIER);
  return served * revenue(stage, rng) + st.passive;
}

function minutesPerStage(): number[] {
  const rng = new Rng(7);
  return STAGES.map((st, i) => (st.next === null ? 0 : st.next / perMinute(i, rng)));
}

describe('pacing', () => {
  it('gives each stage a few minutes of saving', () => {
    const mins = minutesPerStage();
    console.log('minutes per stage', mins.map((m) => m.toFixed(1)).join(' | '), 'total', mins.reduce((a, b) => a + b, 0).toFixed(0));
    for (const m of mins.slice(0, -1)) {
      expect(m).toBeGreaterThan(3);
      expect(m).toBeLessThan(12);
    }
    expect(mins.reduce((a, b) => a + b, 0)).toBeLessThan(70);
  });

  it('reaches the top of the ladder from the last stage within the hour', () => {
    const last = STAGES.length - 1;
    const income = perMinute(last, new Rng(11));
    const minutes = LADDER[LADDER.length - 1].at / income;
    console.log('last stage income/min', Math.round(income), 'minutes to the top', minutes.toFixed(0));
    expect(minutes).toBeLessThan(60);
  });

  it('every stage sells above cost', () => {
    for (let s = 0; s < STAGES.length; s++) expect(averageProfit(s, new Rng(s + 1), 100)).toBeGreaterThan(0);
  });
});
