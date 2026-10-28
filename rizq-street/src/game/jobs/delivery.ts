/** Shawarma delivery: a time limit from the route length, pay with a speed tip. */
export function timeLimit(distance: number, speed: number): number {
  return Math.round(distance / speed + 12);
}

export function deliveryPay(base: number, secondsLeft: number, limit: number, tipFactor: number, phone: boolean): { wage: number; tip: number } {
  if (secondsLeft <= 0) return { wage: Math.round(base * 0.5), tip: 0 };
  const speedShare = Math.min(1, secondsLeft / limit);
  const tip = Math.round(12 * speedShare * tipFactor * (phone ? 1.25 : 1));
  return { wage: base, tip };
}
