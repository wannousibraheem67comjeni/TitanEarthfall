/**
 * The player's shop as saved in the browser: the till drawer, the savings jar, the
 * stage, the stars, who owes what, and the running totals. Money only moves through
 * these methods, which emit events the interface listens to.
 */
import { Emitter } from '../core/events';
import { CLOSE, MINUTES_PER_SECOND, OPEN } from './clock';
import { DAILY_INTEREST, LADDER, rank, STAGES } from './economy';

import type { Look } from '../world/look';

export type Gender = 'm' | 'f';

export interface Debt {
  id: number;
  name: string;
  amount: number;
  /** 0–1: how likely they come back to pay. */
  trust: number;
  /** When they turn up (or don't), in game seconds. */
  due: number;
  gender: Gender;
  /** So the same person walks back in. */
  look?: Look;
}

export interface SaveState {
  version: 1;
  name: string;
  gender: Gender;
  stage: number;
  drawer: number;
  savings: number;
  /** What the upgrades cost so far: part of what the shop is worth. */
  invested: number;
  /** Stars, 0–5. */
  rep: number;
  debts: Debt[];
  /** Seconds played. */
  time: number;
  stats: { customers: number; accepted: number; refused: number; caught: number; fooled: number; profit: number; interest: number; passive: number; repaid: number; lostDebts: number };
  bestRank: number;
  /** Day number (1 = the first day) and the time of day in shop minutes. */
  day: number;
  minute: number;
  today: DayStats;
}

/** One working day, for the closing-time summary. */
export interface DayStats {
  customers: number;
  accepted: number;
  refused: number;
  caught: number;
  sales: number;
  profit: number;
  passive: number;
}

const freshDay = (): DayStats => ({ customers: 0, accepted: 0, refused: 0, caught: 0, sales: 0, profit: 0, passive: 0 });

export interface DaySummary extends DayStats {
  day: number;
  interest: number;
}

export interface StoreEvents {
  [key: string]: unknown;
  money: { drawer: number; savings: number; delta: number; where: 'drawer' | 'savings' };
  rep: { value: number; delta: number };
  stage: { stage: number };
  rank: { rank: number };
}

const KEY = 'sharq-grocery.save';

export function newState(name: string, gender: Gender): SaveState {
  return {
    version: 1,
    name,
    gender,
    stage: 0,
    drawer: 0,
    savings: 0,
    invested: 0,
    rep: 2.5,
    debts: [],
    time: 0,
    stats: { customers: 0, accepted: 0, refused: 0, caught: 0, fooled: 0, profit: 0, interest: 0, passive: 0, repaid: 0, lostDebts: 0 },
    bestRank: 0,
    day: 1,
    minute: OPEN,
    today: freshDay(),
  };
}

export class Store extends Emitter<StoreEvents> {
  constructor(public s: SaveState) {
    super();
  }

  /** Everything the player owns: the till, the savings and (most of) what the shop is worth. */
  get worth(): number {
    return this.s.drawer + this.s.savings + this.s.invested * 0.7;
  }

  get nextCost(): number | null {
    return STAGES[this.s.stage].next;
  }

  /** Enough saved (counting the till) to move up a stage. */
  get canUpgrade(): boolean {
    const n = this.nextCost;
    return n !== null && this.s.drawer + this.s.savings >= n;
  }

  /** Money into (or out of) the till. */
  till(delta: number): void {
    const before = this.s.drawer;
    this.s.drawer = Math.max(0, Math.round((this.s.drawer + delta) * 100) / 100);
    if (delta > 0) this.s.stats.profit += delta;
    this.emit('money', { drawer: this.s.drawer, savings: this.s.savings, delta: this.s.drawer - before, where: 'drawer' });
    this.checkRank();
  }

  /** The pink button: move the till into savings. Returns how much moved. */
  save(): number {
    const moved = this.s.drawer;
    if (moved <= 0) return 0;
    this.s.drawer = 0;
    this.s.savings = Math.round((this.s.savings + moved) * 100) / 100;
    this.emit('money', { drawer: 0, savings: this.s.savings, delta: moved, where: 'savings' });
    return moved;
  }

  /** Spend savings (and the till, if needed) on the next stage. */
  upgrade(): boolean {
    const cost = this.nextCost;
    if (cost === null || !this.canUpgrade) return false;
    this.save();
    this.s.savings = Math.round((this.s.savings - cost) * 100) / 100;
    this.s.invested += cost;
    this.s.stage++;
    this.emit('money', { drawer: this.s.drawer, savings: this.s.savings, delta: -cost, where: 'savings' });
    this.emit('stage', { stage: this.s.stage });
    this.checkRank();
    return true;
  }

  get open(): boolean {
    return this.s.minute >= OPEN && this.s.minute < CLOSE;
  }

  /** Shop time passes; branches and contracts bring their income by the hour. Returns that income. */
  advance(seconds: number): number {
    this.s.time += seconds;
    const minutes = seconds * MINUTES_PER_SECOND;
    this.s.minute = Math.min(CLOSE, this.s.minute + minutes);
    const passive = (STAGES[this.s.stage].passive / 60) * minutes;
    if (passive > 0) {
      this.s.drawer += passive;
      this.s.stats.passive += passive;
      this.s.today.passive += passive;
      this.checkRank();
    }
    return passive;
  }

  /** Closing time: the savings earn the day's interest. Returns the day's summary. */
  closeDay(): DaySummary {
    const interest = Math.round(this.s.savings * DAILY_INTEREST * 100) / 100;
    if (interest > 0) {
      this.s.savings += interest;
      this.s.stats.interest += interest;
      this.emit('money', { drawer: this.s.drawer, savings: this.s.savings, delta: interest, where: 'savings' });
      this.checkRank();
    }
    return { ...this.s.today, day: this.s.day, interest };
  }

  /** The next morning. */
  newDay(): void {
    this.s.day++;
    this.s.minute = OPEN;
    this.s.today = freshDay();
  }

  stars(delta: number): void {
    const before = this.s.rep;
    this.s.rep = Math.max(0, Math.min(5, this.s.rep + delta));
    if (this.s.rep !== before) this.emit('rep', { value: this.s.rep, delta: this.s.rep - before });
  }

  get rank(): number {
    return rank(this.worth);
  }

  get title(): string {
    return LADDER[this.rank].title[this.s.gender === 'm' ? 0 : 1];
  }

  private checkRank(): void {
    const r = this.rank;
    if (r > this.s.bestRank) {
      this.s.bestRank = r;
      this.emit('rank', { rank: r });
    }
  }

  persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* storage unavailable: this visit only */
    }
  }

  static load(): SaveState | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<SaveState>;
      if (!s || typeof s.name !== 'string' || typeof s.stage !== 'number') return null;
      const base = newState(s.name, s.gender === 'f' ? 'f' : 'm');
      const debts = (Array.isArray(s.debts) ? s.debts : []).map((d) => ({ ...d, gender: d.gender === 'f' ? 'f' : 'm', look: d.look && typeof d.look === 'object' ? d.look : undefined }) as Debt);
      const minute = typeof s.minute === 'number' && s.minute >= OPEN && s.minute < CLOSE ? s.minute : OPEN;
      return { ...base, ...s, debts, minute, today: { ...base.today, ...(s.today ?? {}) }, stats: { ...base.stats, ...(s.stats ?? {}) }, stage: Math.max(0, Math.min(STAGES.length - 1, s.stage)) } as SaveState;
    } catch {
      return null;
    }
  }

  static clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  }
}
