/**
 * Shop time. The grocery opens at seven in the morning and closes at eleven at night;
 * one real second is one shop minute, so a working day lasts about sixteen minutes.
 * People come in waves: the breakfast rush, a quiet afternoon, a busy evening.
 */

export const OPEN = 7 * 60;
export const CLOSE = 23 * 60;
/** No one new comes in this close to closing time. */
export const LAST_IN = CLOSE - 15;
/** Shop minutes per real second. */
export const MINUTES_PER_SECOND = 1;

/** How busy each hour of the day is (1 = an ordinary hour). */
const RUSH = [0, 0, 0, 0, 0, 0, 0.6, 1.5, 1.6, 1.1, 0.9, 0.9, 1.1, 1.1, 0.6, 0.6, 0.8, 1.1, 1.4, 1.6, 1.6, 1.4, 1.0, 0.7];

export function rush(minute: number): number {
  return RUSH[Math.floor(minute / 60) % 24];
}

/** Average busyness over opening hours, for pacing. */
export const RUSH_AVERAGE = RUSH.slice(OPEN / 60, CLOSE / 60).reduce((a, b) => a + b, 0) / ((CLOSE - OPEN) / 60);

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export function dayName(day: number): string {
  return DAYS[(day - 1) % 7];
}

/** "7:05 ص", "9:40 م". */
export function clockText(minute: number): string {
  const m = Math.floor(minute) % 1440;
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'ص' : 'م'}`;
}

export type DayPart = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'sunset' | 'night';

export function dayPart(minute: number): DayPart {
  const h = minute / 60;
  if (h < 6.5) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 15) return 'noon';
  if (h < 17.5) return 'afternoon';
  if (h < 19) return 'sunset';
  return 'night';
}

/** A greeting that fits the time: «صباح الخير» before noon, «مساء الخير» after. */
export function timeGreeting(minute: number): string {
  return minute < 12 * 60 ? 'صباح الخير' : 'مساء الخير';
}
