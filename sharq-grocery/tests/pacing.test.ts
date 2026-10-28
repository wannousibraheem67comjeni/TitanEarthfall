import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { CLOSE, OPEN } from '../src/game/clock';
import { averageProfit, DAILY_INTEREST, decide, LADDER, makeBill, STAGES } from '../src/game/economy';

/** Real minutes of a working day (one shop minute a second). */
const DAY_MINUTES = (CLOSE - OPEN) / 60;

/** Average till gain per customer (every bill is accepted; debts count when repaid on average). */
function gainPerCustomer(stage: number, rng: Rng): number {
  let gain = 0;
  const n = 800;
  for (let k = 0; k < n; k++) {
    const b = makeBill(rng, stage);
    gain += decide(b, true, rng.next()).money;
    if (b.kind === 'credit') gain += b.total * 0.75;
  }
  return gain / n;
}

/** Income per real minute at a stage: customers (one every `spawn` seconds) plus branch income. */
function perMinute(stage: number, rng: Rng): number {
  const st = STAGES[stage];
  return gainPerCustomer(stage, rng) * (60 / st.spawn) + st.passive;
}

function minutesPerStage(): number[] {
  const rng = new Rng(7);
  return STAGES.map((st, i) => {
    if (st.next === null) return 0;
    // Savings grow a little each night too (about half the target saved on average).
    return st.next / (perMinute(i, rng) + ((st.next / 2) * DAILY_INTEREST) / DAY_MINUTES);
  });
}

describe('pacing', () => {
  it('gives each stage several unhurried minutes', () => {
    const mins = minutesPerStage();
    console.log('minutes per stage', mins.map((m) => m.toFixed(1)).join(' | '), 'total', mins.reduce((a, b) => a + b, 0).toFixed(0));
    for (const m of mins.slice(0, -1)) {
      expect(m).toBeGreaterThan(4);
      expect(m).toBeLessThan(18);
    }
    expect(mins.reduce((a, b) => a + b, 0)).toBeLessThan(100);
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
