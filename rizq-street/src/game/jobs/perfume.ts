/**
 * Dad's perfume shop: customers describe a scent, plainly or by mood, and you blend
 * the oils that match. Dad's notebook lists which oils suit which mood.
 */
import type { Rng } from '../../core/rng';

export type Oil = 'oud' | 'rose' | 'musk' | 'amber' | 'sandal' | 'jasmine' | 'saffron' | 'vanilla' | 'citrus';

export const OILS: { id: Oil; name: string; color: string }[] = [
  { id: 'oud', name: 'عود', color: '#4a2a17' },
  { id: 'rose', name: 'ورد طائفي', color: '#d0587e' },
  { id: 'musk', name: 'مسك أبيض', color: '#f1ece2' },
  { id: 'amber', name: 'عنبر', color: '#c98a2b' },
  { id: 'sandal', name: 'صندل', color: '#a8774a' },
  { id: 'jasmine', name: 'ياسمين', color: '#f4f0c8' },
  { id: 'saffron', name: 'زعفران', color: '#e0601f' },
  { id: 'vanilla', name: 'فانيلا', color: '#ead9a8' },
  { id: 'citrus', name: 'حمضيات', color: '#f2c230' },
];

export interface PerfumeRequest {
  /** What the customer says. */
  line: string;
  oils: Oil[];
  /** Mood requests need the notebook; plain ones name the oils. */
  mood: boolean;
}

/** Dad's notebook: mood → oils. Shown in the shop UI. */
export const NOTEBOOK: { mood: string; oils: Oil[]; lines: string[] }[] = [
  { mood: 'خفيف وفريش للصيف', oils: ['jasmine', 'citrus'], lines: ['أبي شي خفيف وفريش، للدوام بالصيف', 'عطر منعش للصبح لو سمحت'] },
  { mood: 'ثقيل للمناسبات والأعراس', oils: ['oud', 'amber'], lines: ['عندي عرس الأسبوع الياي، أبي شي ثقيل وفخم', 'أبي عطر للمناسبات، ريحته تثبت'] },
  { mood: 'هدية ناعمة للأم', oils: ['rose', 'musk'], lines: ['أبي هدية لأمي، شي ناعم وهادي', 'عطر نسائي ناعم كهدية'] },
  { mood: 'دافي للشتاء', oils: ['sandal', 'vanilla'], lines: ['الشتا ياي، أبي ريحة دافية', 'أبي عطر دافي ومريح للشتا'] },
  { mood: 'شيوخي فخم', oils: ['oud', 'saffron', 'musk'], lines: ['أبي عطر شيوخي، من الأخير', 'أبي أفخم خلطة عندكم'] },
  { mood: 'حلو للبنات', oils: ['vanilla', 'rose'], lines: ['أبي شي حلو لبنتي، تحب الريحة الحلوة', 'عطر حلو وبناتي'] },
  { mood: 'هادي للصلاة والمجلس', oils: ['musk', 'sandal'], lines: ['أبي ريحة هادية للمجلس', 'شي هادي ونظيف للصلاة'] },
];

export function oilName(id: Oil): string {
  return OILS.find((o) => o.id === id)!.name;
}

export function makeRequest(rng: Rng, level: number): PerfumeRequest {
  if (level < 2 || rng.chance(0.35)) {
    const count = level >= 3 && rng.chance(0.4) ? 3 : 2;
    const oils = rng.shuffle(OILS.map((o) => o.id)).slice(0, count);
    const names = oils.map(oilName);
    const joined = names.length === 2 ? `${names[0]} و${names[1]}` : `${names[0]} و${names[1]} و${names[2]}`;
    return { line: rng.pick([`أبي خلطة فيها ${joined} لو سمحت`, `عطني ${joined}، مخلوطين`, `أبغى عطر ${joined}`]), oils, mood: false };
  }
  const entry = rng.pick(NOTEBOOK.filter((n) => level >= 3 || n.oils.length === 2));
  return { line: rng.pick(entry.lines), oils: entry.oils.slice(), mood: true };
}

/** 1 for an exact blend, partial credit by overlap, 0 for nothing right. */
export function blendScore(made: Oil[], want: Oil[]): number {
  const a = new Set(made);
  const b = new Set(want);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function salePay(base: number, score: number, tipFactor: number): { wage: number; tip: number } {
  if (score >= 1) return { wage: base, tip: Math.round(6 * tipFactor) };
  if (score >= 0.5) return { wage: Math.round(base * 0.5), tip: 0 };
  return { wage: 0, tip: 0 };
}
