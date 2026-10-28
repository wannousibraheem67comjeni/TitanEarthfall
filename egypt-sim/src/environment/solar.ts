/**
 * Astronomical sun position (NOAA / Meeus low-precision algorithm, < 0.1° error for
 * 1950–2050) and Egyptian civil time (UTC+2, with the daylight-saving rule
 * reinstated in 2023: last Friday of April → last Thursday of October, UTC+3).
 */
import { DEG } from '../core/math';

export interface SunPosition {
  /** Radians clockwise from north. */
  azimuth: number;
  /** Radians above the horizon. */
  elevation: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = mod(357.528 + 0.9856003 * n, 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = mod(18.697374558 + 24.06570982441908 * n, 24);
  const lst = (gmst * 15 + lon) * DEG;
  const H = lst - ra;
  const phi = lat * DEG;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = mod(Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)), Math.PI * 2);
  return { azimuth, elevation };
}

/** World-space unit vector toward the sun (x east, y up, z south). */
export function sunVector(p: SunPosition): [number, number, number] {
  const c = Math.cos(p.elevation);
  return [c * Math.sin(p.azimuth), Math.sin(p.elevation), -c * Math.cos(p.azimuth)];
}

const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Last given weekday (0 = Sunday) of a month, as a UTC date at 00:00. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - mod(d.getUTCDay() - weekday, 7));
  return d;
}

/** Egypt's UTC offset in hours at a given instant. */
export function egyptUtcOffset(date: Date): number {
  const y = date.getUTCFullYear();
  if (y < 2023) return 2;
  const start = lastWeekday(y, 3, 5).getTime() - 2 * 3600e3 + 0; // Friday 00:00 local
  const end = lastWeekday(y, 9, 4).getTime() + 24 * 3600e3 - 3 * 3600e3; // end of Thursday local
  const t = date.getTime();
  return t >= start && t < end ? 3 : 2;
}

/** Local wall-clock hours (0–24) in Egypt. */
export function egyptLocalHours(date: Date): number {
  const ms = date.getTime() + egyptUtcOffset(date) * 3600e3;
  return mod(ms / 3600e3, 24);
}

/** UTC instant for a local Egyptian date/time. */
export function fromEgyptLocal(year: number, month: number, day: number, hours: number): Date {
  const guess = new Date(Date.UTC(year, month, day) + hours * 3600e3 - 2 * 3600e3);
  return new Date(guess.getTime() - (egyptUtcOffset(guess) - 2) * 3600e3);
}
