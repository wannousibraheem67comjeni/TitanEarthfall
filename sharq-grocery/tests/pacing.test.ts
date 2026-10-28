import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { averageProfit, decide, LADDER, makeBill, SAVINGS_RATE, STAGES } from '../src/game/economy';

/** Minutes a stage takes for a player who decides well, at three stars. */
function minutesPerStage(): number[] {
  const rng = new Rng(7);
  return STAGES.map((st, i) => {
    if (st.next === null) return 0;
    // Expected drawer gain per customer with good decisions across the mix of bills.
    let gain = 0;
    const n = 600;
    for (let k = 0; k < n; k++) {
      const b = makeBill(rng, i);
      const accept = b.kind === 'normal' || b.kind === 'big' || b.kind === 'kid' || (b.kind === 'discount' && b.pays >= b.cost) || (b.kind === 'short' && b.pays >= b.cost);
      gain += decide(b, accept, rng.next()).money;
    }
    const perMin = (gain / n) * (60 / st.spawn) + st.passive;
    // Savings grow too while they fill up (about half the target on average).
    return st.next / (perMin + (st.next / 2) * SAVINGS_RATE);
  });
}

describe('pacing', () => {
  it('keeps each stage a few minutes long', () => {
    const mins = minutesPerStage();
    console.log('minutes per stage', mins.map((m) => m.toFixed(1)).join(' | '), 'total', mins.reduce((a, b) => a + b, 0).toFixed(0));
    for (const m of mins.slice(0, -1)) {
      expect(m).toBeGreaterThan(1.5);
      expect(m).toBeLessThan(14);
    }
  });

  it('reaches the top of the ladder from the last stage in well under an hour', () => {
    const rng = new Rng(11);
    const last = STAGES.length - 1;
    let gain = 0;
    for (let k = 0; k < 600; k++) {
      const b = makeBill(rng, last);
      gain += decide(b, b.kind === 'normal' || b.kind === 'big', rng.next()).money;
    }
    const perMin = (gain / 600) * (60 / STAGES[last].spawn) + STAGES[last].passive;
    // Worth grows by income plus interest on savings: W' = I + rW.
    const top = LADDER[LADDER.length - 1].at;
    const minutes = Math.log((top + perMin / SAVINGS_RATE) / (perMin / SAVINGS_RATE)) / SAVINGS_RATE;
    console.log('last stage income/min', Math.round(perMin), 'minutes to the top', minutes.toFixed(0));
    expect(minutes).toBeLessThan(45);
  });

  it('every product sells above cost', () => {
    for (let s = 0; s < STAGES.length; s++) expect(averageProfit(s, new Rng(s + 1), 100)).toBeGreaterThan(0);
  });
});
