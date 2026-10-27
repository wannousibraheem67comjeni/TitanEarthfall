export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach: move `a` toward `b` at `rate` per second. */
export const damp = (a: number, b: number, rate: number, dt: number): number => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Shortest signed difference between two angles, in (−π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export const dampAngle = (a: number, b: number, rate: number, dt: number): number => a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));
