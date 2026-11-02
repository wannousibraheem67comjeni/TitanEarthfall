/**
 * Street stall economics: a passer-by has a price they are willing to pay that
 * depends on the product, the heat of the day and whether it is cold. You name a
 * price; they buy, haggle once, or walk on.
 */
import type { Rng } from '../../core/rng';
import { item, type ItemId } from '../catalog';

/** Midday heat makes cold drinks worth more. */
export function heatFactor(hour: number): number {
  if (hour >= 11 && hour < 16) return 1.35;
  if (hour >= 9 && hour < 18) return 1.15;
  return 0.95;
}

export function willingness(rng: Rng, id: ItemId, hour: number, cooler: boolean): number {
  const hint = item(id).wholesale?.sellHint ?? item(id).price;
  const cold = cooler ? 1 : 0;
  return Math.max(1, (hint + cold) * heatFactor(hour) * rng.range(0.85, 1.35));
}

export type Reaction = { kind: 'buy'; price: number } | { kind: 'haggle'; offer: number } | { kind: 'leave' };

export function react(price: number, will: number): Reaction {
  if (price <= will) return { kind: 'buy', price };
  if (price <= will * 1.35) return { kind: 'haggle', offer: Math.max(1, Math.floor(will)) };
  return { kind: 'leave' };
}

/** Units the stall can carry per product. */
export function capacity(cooler: boolean): number {
  return cooler ? 24 : 12;
}
