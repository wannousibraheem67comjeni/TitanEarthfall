/**
 * Optimal smooth zoom-and-pan (van Wijk & Nuij, "Smooth and efficient zooming and
 * panning", InfoVis 2003). The camera's visible ground width w(s) rises and falls
 * along a hyperbolic path so that perceived velocity stays constant — the natural way
 * to travel from a 1,500 km national view to a 50 m street view and back.
 */
export interface ViewWindow {
  x: number;
  z: number;
  /** Visible ground width (m). */
  w: number;
}

export interface ZoomPanPath {
  /** Path length in the paper's units (≈ number of "screen widths" travelled). */
  S: number;
  at(s: number): ViewWindow;
}

export function zoomPanPath(a: ViewWindow, b: ViewWindow, rho = 1.42): ZoomPanPath {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const u1 = Math.hypot(dx, dz);
  const w0 = a.w;
  const w1 = b.w;
  if (u1 < 1e-6 * Math.max(w0, w1)) {
    const k = w1 < w0 ? -1 : 1;
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    return {
      S,
      at: (s) => {
        const f = S > 0 ? s / S : 1;
        return { x: a.x + dx * f, z: a.z + dz * f, w: w0 * Math.exp(k * rho * s) };
      },
    };
  }
  const rho2 = rho * rho;
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1);
  const r0 = Math.log(-b0 + Math.sqrt(b0 * b0 + 1));
  const r1 = Math.log(-b1 + Math.sqrt(b1 * b1 + 1));
  const S = (r1 - r0) / rho;
  return {
    S,
    at: (s) => {
      const u = (w0 / rho2) * Math.cosh(r0) * Math.tanh(rho * s + r0) - (w0 / rho2) * Math.sinh(r0);
      const w = (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0);
      return { x: a.x + (dx * u) / u1, z: a.z + (dz * u) / u1, w };
    },
  };
}

/** Flight duration (s) for a path: long hops take longer, but never drag. */
export const flightDuration = (S: number): number => Math.min(9, Math.max(1.2, 0.8 + S * 0.65));
