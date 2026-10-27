/** Car wash pay: proportional to how clean the car got, with a tip for a spotless finish. */
export function washPay(base: number, cleaned: number, secondsLeft: number, tipFactor: number): { wage: number; tip: number } {
  if (cleaned < 0.5) return { wage: 0, tip: 0 };
  const wage = Math.round(base * Math.min(1, cleaned));
  const tip = cleaned >= 0.999 ? Math.round((4 + Math.min(8, secondsLeft / 4)) * tipFactor) : 0;
  return { wage, tip };
}
