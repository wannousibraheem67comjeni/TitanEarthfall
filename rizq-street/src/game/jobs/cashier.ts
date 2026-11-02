/**
 * Grocery till: a customer brings items, you ring up the total, they hand over a
 * note, and you count the change back from the drawer.
 */
import type { Rng } from '../../core/rng';
import { GROCERY_ITEMS, item, type ItemId } from '../catalog';

export interface CashierLine {
  item: ItemId;
  qty: number;
}

export interface CashierOrder {
  lines: CashierLine[];
  total: number;
  paidWith: number;
  change: number;
}

const NOTES = [5, 10, 20, 50, 100, 200];
/** What the drawer holds for making change. */
export const DRAWER = [100, 50, 20, 10, 5, 1];

/** Orders grow longer and pricier with skill level. */
export function makeOrder(rng: Rng, level: number): CashierOrder {
  const nLines = Math.min(1 + Math.floor(rng.next() * (1.6 + level * 0.45)), 5);
  const pool = rng.shuffle(GROCERY_ITEMS.filter((i) => level >= 3 || i.price <= 12));
  const lines: CashierLine[] = [];
  for (let i = 0; i < nLines && i < pool.length; i++) lines.push({ item: pool[i].id, qty: rng.int(1, level >= 2 ? 3 : 2) });
  const total = orderTotal(lines);
  // Customers pay with the smallest note that covers it, sometimes the next one up.
  let idx = NOTES.findIndex((n) => n >= total);
  if (idx < 0) idx = NOTES.length - 1;
  if (idx < NOTES.length - 1 && rng.chance(0.35)) idx++;
  let paidWith = NOTES[idx];
  while (paidWith < total) paidWith += 100;
  return { lines, total, paidWith, change: paidWith - total };
}

export function orderTotal(lines: CashierLine[]): number {
  return lines.reduce((sum, l) => sum + item(l.item).price * l.qty, 0);
}

/** "2 خبز، حليب، 3 ماء" */
export function describeOrder(lines: CashierLine[]): string {
  return lines.map((l) => (l.qty === 1 ? item(l.item).name : `${l.qty} ${item(l.item).name}`)).join('، ');
}

export function sumCounted(counted: number[]): number {
  return counted.reduce((a, b) => a + b, 0);
}

/** Pay for one customer: base wage for a correct sale, a tip when it was quick. */
export function customerPay(base: number, correct: boolean, seconds: number, tipFactor: number): { wage: number; tip: number } {
  if (!correct) return { wage: 0, tip: 0 };
  const quick = seconds < 20 ? 1 : seconds < 35 ? 0.5 : 0;
  return { wage: base, tip: Math.round(quick * 4 * tipFactor) };
}
