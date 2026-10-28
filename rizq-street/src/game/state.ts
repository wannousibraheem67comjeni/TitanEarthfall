/**
 * The whole save game and every rule that changes money, items, skills and
 * reputation. UI and world code listen to the events it emits; nothing else writes
 * to the state directly.
 */
import { Emitter } from '../core/events';
import { clamp } from '../core/math';
import type { Gender } from '../lang/arabic';
import { isOpenAt, job, skillMultiplier, xpForNext, UPGRADE_BY_ID, type ItemId, type JobId, type NpcId, type UpgradeId } from './catalog';

export const SAVE_VERSION = 1;
const SAVE_KEY = 'rizq-street.save.v1';
export const START_MINUTE = 8 * 60;

export interface JobRecord {
  lastDay: number;
  today: number;
  total: number;
}

export interface SkillRecord {
  level: number;
  xp: number;
}

export interface NpcMemory {
  met: boolean;
  talks: number;
  lastTalkDay: number;
  giftDay: number;
  tipDay: number;
  greetedDay: number;
  /** −100…100: how this character feels about the player. */
  affinity: number;
}

export interface LedgerEntry {
  day: number;
  minute: number;
  amount: number;
  label: string;
  bank: boolean;
}

export interface GameState {
  version: number;
  player: { name: string; gender: Gender };
  wallet: number;
  bank: number;
  earnedTotal: number;
  spentTotal: number;
  day: number;
  minute: number;
  /** 0–100, the neighbourhood's opinion of the player. Raises tips. */
  reputation: number;
  skills: Partial<Record<JobId, SkillRecord>>;
  jobs: Partial<Record<JobId, JobRecord>>;
  upgrades: Partial<Record<UpgradeId, boolean>>;
  inventory: Partial<Record<ItemId, number>>;
  stallStock: Partial<Record<ItemId, number>>;
  npcs: Partial<Record<NpcId, NpcMemory>>;
  flags: Record<string, number | string | boolean>;
  achievements: Record<string, number>;
  stats: Record<string, number>;
  ledger: LedgerEntry[];
  /** Mum's shopping list while an errand is running. */
  errand: { items: ItemId[]; cash: number } | null;
  /** A savings goal the player set by asking the guide ("1000 درهم بالشهر"). */
  goal: { amount: number; days: number; startDay: number; startEarned: number; job: JobId | null } | null;
  pos: { x: number; z: number; heading: number } | null;
}

export interface StoreEvents {
  [key: string]: unknown;
  money: { delta: number; label: string; bank: boolean; wallet: number; balance: number };
  inventory: { id: ItemId; count: number; delta: number };
  toast: { text: string; kind: 'info' | 'good' | 'bad' | 'level' | 'achievement' };
  levelup: { job: JobId; level: number };
  reputation: { value: number; delta: number };
  upgrade: { id: UpgradeId };
  day: { day: number; interest: number; passive: number };
  stat: { key: string; value: number };
}

export function newState(name: string, gender: Gender): GameState {
  return {
    version: SAVE_VERSION,
    player: { name, gender },
    wallet: 0,
    bank: 0,
    earnedTotal: 0,
    spentTotal: 0,
    day: 1,
    minute: START_MINUTE,
    reputation: 20,
    skills: {},
    jobs: {},
    upgrades: {},
    inventory: {},
    stallStock: {},
    npcs: {},
    flags: {},
    achievements: {},
    stats: {},
    ledger: [],
    errand: null,
    goal: null,
    pos: null,
  };
}

/** Accept older or partial saves: fill in anything missing with defaults. */
export function migrate(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<GameState>;
  if (!r.player || typeof r.player.name !== 'string') return null;
  const base = newState(r.player.name, r.player.gender === 'f' ? 'f' : 'm');
  const merged = { ...base, ...r, version: SAVE_VERSION } as GameState;
  for (const k of ['wallet', 'bank', 'earnedTotal', 'spentTotal', 'day', 'minute', 'reputation'] as const) {
    if (typeof merged[k] !== 'number' || !Number.isFinite(merged[k])) merged[k] = base[k];
  }
  return merged;
}

export class Store extends Emitter<StoreEvents> {
  constructor(public s: GameState) {
    super();
  }

  // -- time ------------------------------------------------------------------

  get hour(): number {
    return this.s.minute / 60;
  }

  /** Move the clock forward; rolls days over (interest, passive income). */
  advance(minutes: number): void {
    this.s.minute += minutes;
    while (this.s.minute >= 24 * 60) {
      this.s.minute -= 24 * 60;
      this.newDay();
    }
  }

  /** Sleep until the next morning at seven. */
  sleep(): void {
    const target = 7 * 60;
    const toMorning = this.s.minute < target ? target - this.s.minute : 24 * 60 - this.s.minute + target;
    this.advance(toMorning);
  }

  private newDay(): void {
    this.s.day++;
    // Savings grow: 1% a day on the bank balance, up to 100 dirhams.
    const interest = this.s.bank >= 20 ? Math.min(100, Math.floor(this.s.bank * 0.01)) : 0;
    if (interest > 0) this.earn(interest, 'أرباح التوفير', { bank: true, silent: true });
    const passive = this.s.upgrades.shop ? 300 : 0;
    if (passive > 0) this.earn(passive, 'دخل محلك', { bank: true, silent: true });
    this.emit('day', { day: this.s.day, interest, passive });
  }

  // -- money -----------------------------------------------------------------

  earn(amount: number, label: string, opts: { bank?: boolean; silent?: boolean } = {}): void {
    amount = Math.round(amount);
    if (amount <= 0) return;
    const bank = opts.bank ?? false;
    if (bank) this.s.bank += amount;
    else this.s.wallet += amount;
    this.s.earnedTotal += amount;
    this.log(amount, label, bank);
    this.emit('money', { delta: amount, label, bank, wallet: this.s.wallet, balance: this.s.bank });
  }

  /** Pay from the wallet; false (and nothing changes) when there is not enough cash. */
  spend(amount: number, label: string): boolean {
    amount = Math.round(amount);
    if (amount <= 0) return true;
    if (this.s.wallet < amount) return false;
    this.s.wallet -= amount;
    this.s.spentTotal += amount;
    this.log(-amount, label, false);
    this.emit('money', { delta: -amount, label, bank: false, wallet: this.s.wallet, balance: this.s.bank });
    return true;
  }

  /** Move cash between wallet and bank (positive: withdraw to wallet). */
  withdraw(amount: number): boolean {
    amount = Math.floor(amount);
    if (amount <= 0 || this.s.bank < amount) return false;
    this.s.bank -= amount;
    this.s.wallet += amount;
    this.log(amount, 'سحب من الصراف', false);
    this.emit('money', { delta: amount, label: 'سحب من الصراف', bank: false, wallet: this.s.wallet, balance: this.s.bank });
    return true;
  }

  deposit(amount: number): boolean {
    amount = Math.floor(amount);
    if (amount <= 0 || this.s.wallet < amount) return false;
    this.s.wallet -= amount;
    this.s.bank += amount;
    this.log(-amount, 'إيداع بالصراف', false);
    this.emit('money', { delta: -amount, label: 'إيداع بالصراف', bank: false, wallet: this.s.wallet, balance: this.s.bank });
    return true;
  }

  setGoal(amount: number, days: number, jobId: JobId | null): void {
    this.s.goal = { amount: Math.round(amount), days: Math.max(1, Math.round(days)), startDay: this.s.day, startEarned: this.s.earnedTotal, job: jobId };
  }

  /** Progress toward the goal: earned since it was set, and days left. */
  goalProgress(): { got: number; amount: number; daysLeft: number } | null {
    const g = this.s.goal;
    if (!g) return null;
    return { got: Math.max(0, this.s.earnedTotal - g.startEarned), amount: g.amount, daysLeft: Math.max(0, g.startDay + g.days - this.s.day) };
  }

  get netWorth(): number {
    return this.s.wallet + this.s.bank;
  }

  private log(amount: number, label: string, bank: boolean): void {
    this.s.ledger.unshift({ day: this.s.day, minute: Math.floor(this.s.minute), amount, label, bank });
    if (this.s.ledger.length > 80) this.s.ledger.length = 80;
  }

  // -- items -----------------------------------------------------------------

  count(id: ItemId): number {
    return this.s.inventory[id] ?? 0;
  }

  addItem(id: ItemId, n = 1): void {
    const count = (this.s.inventory[id] = this.count(id) + n);
    this.emit('inventory', { id, count, delta: n });
  }

  takeItem(id: ItemId, n = 1): boolean {
    if (this.count(id) < n) return false;
    const count = (this.s.inventory[id] = this.count(id) - n);
    if (count === 0) delete this.s.inventory[id];
    this.emit('inventory', { id, count, delta: -n });
    return true;
  }

  // -- jobs and skills -------------------------------------------------------

  level(id: JobId): number {
    return this.s.skills[id]?.level ?? 1;
  }

  /** Pay for a round of work: base × skill multiplier, rounded to whole dirhams. */
  payFor(id: JobId, base: number): number {
    return Math.round(base * skillMultiplier(this.level(id)));
  }

  /** Tips scale with reputation: 0.5× at 0, 1× at 50, 1.5× at 100. */
  tipFactor(): number {
    return 0.5 + this.s.reputation / 100;
  }

  gainXp(id: JobId, xp: number): boolean {
    const rec = (this.s.skills[id] ??= { level: 1, xp: 0 });
    rec.xp += xp;
    let up = false;
    while (rec.level < 10 && rec.xp >= xpForNext(rec.level)) {
      rec.xp -= xpForNext(rec.level);
      rec.level++;
      up = true;
    }
    if (up) {
      this.emit('levelup', { job: id, level: rec.level });
      this.emit('toast', { text: `ترقية! ${job(id).title}: المستوى ${rec.level}، والأجر صار أعلى`, kind: 'level' });
    }
    return up;
  }

  timesToday(id: JobId): number {
    const r = this.s.jobs[id];
    return r && r.lastDay === this.s.day ? r.today : 0;
  }

  /** Record one finished round of a job. */
  finishJob(id: JobId): void {
    const r = (this.s.jobs[id] ??= { lastDay: this.s.day, today: 0, total: 0 });
    if (r.lastDay !== this.s.day) {
      r.lastDay = this.s.day;
      r.today = 0;
    }
    r.today++;
    r.total++;
    this.bump('jobs');
  }

  /** Why a job cannot start right now, or null when it can. */
  jobBlock(id: JobId): 'closed' | 'done' | 'locked' | null {
    const def = job(id);
    if (def.requires && !this.s.upgrades[def.requires]) return 'locked';
    if (def.daily !== undefined && this.timesToday(id) >= def.daily) return 'done';
    return isOpenAt(def.hours, this.hour) ? null : 'closed';
  }

  // -- reputation, people ----------------------------------------------------

  rep(delta: number): void {
    const before = this.s.reputation;
    this.s.reputation = clamp(before + delta, 0, 100);
    if (this.s.reputation !== before) this.emit('reputation', { value: this.s.reputation, delta: this.s.reputation - before });
  }

  npc(id: NpcId): NpcMemory {
    return (this.s.npcs[id] ??= { met: false, talks: 0, lastTalkDay: 0, giftDay: 0, tipDay: 0, greetedDay: 0, affinity: 0 });
  }

  // -- upgrades --------------------------------------------------------------

  has(id: UpgradeId): boolean {
    return !!this.s.upgrades[id];
  }

  buy(id: UpgradeId): 'ok' | 'owned' | 'poor' {
    if (this.has(id)) return 'owned';
    const u = UPGRADE_BY_ID.get(id)!;
    if (!this.spend(u.price, u.name)) return 'poor';
    this.s.upgrades[id] = true;
    this.emit('upgrade', { id });
    this.emit('toast', { text: `${u.icon} صار عندك ${u.name}! ${u.effect}`, kind: 'good' });
    return 'ok';
  }

  // -- stats -----------------------------------------------------------------

  bump(key: string, by = 1): number {
    const value = (this.s.stats[key] = (this.s.stats[key] ?? 0) + by);
    this.emit('stat', { key, value });
    return value;
  }

  stat(key: string): number {
    return this.s.stats[key] ?? 0;
  }

  toast(text: string, kind: StoreEvents['toast']['kind'] = 'info'): void {
    this.emit('toast', { text, kind });
  }

  // -- persistence -----------------------------------------------------------

  save(): boolean {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.s));
      return true;
    } catch {
      return false;
    }
  }

  static load(): GameState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  static clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* storage unavailable: nothing to clear */
    }
  }
}
