/** Maths homework for Ali: arithmetic and short word problems, answered by voice or keyboard. */
import type { Rng } from '../../core/rng';

export interface Question {
  text: string;
  answer: number;
}

/** Name and the possessive ending that goes with it (عنده / عندها). */
const NAMES: [string, string][] = [
  ['علي', 'ه'],
  ['سارة', 'ها'],
  ['حمدان', 'ه'],
  ['نورة', 'ها'],
  ['خليفة', 'ه'],
  ['مريم', 'ها'],
];
const THINGS: [string, string][] = [
  ['قلم', 'أقلام'],
  ['تمرة', 'تمرات'],
  ['كتاب', 'كتب'],
  ['كورة', 'كور'],
  ['برتقالة', 'برتقالات'],
];

export function makeQuestion(rng: Rng, round: number): Question {
  const kind = rng.int(0, round < 2 ? 1 : 4);
  switch (kind) {
    case 0: {
      const a = rng.int(5, 60);
      const b = rng.int(3, 40);
      return { text: `كم ${a} + ${b}؟`, answer: a + b };
    }
    case 1: {
      const a = rng.int(20, 90);
      const b = rng.int(3, a - 1);
      return { text: `كم ${a} − ${b}؟`, answer: a - b };
    }
    case 2: {
      const a = rng.int(2, 9);
      const b = rng.int(2, 9);
      return { text: `كم ${a} × ${b}؟`, answer: a * b };
    }
    case 3: {
      const b = rng.int(2, 9);
      const q = rng.int(2, 9);
      return { text: `كم ${b * q} ÷ ${b}؟`, answer: q };
    }
    default: {
      const [who, his] = rng.pick(NAMES);
      const [one, many] = rng.pick(THINGS);
      // 3–8 keeps the counted noun plural ("5 أقلام"), which is what Arabic wants there.
      const boxes = rng.int(3, 6);
      const each = rng.int(3, 8);
      return { text: `عند ${who} ${boxes} علب، بكل علبة ${each} ${many}. كم ${one} عند${his} كلهم؟`, answer: boxes * each };
    }
  }
}

export function lessonPay(base: number, correct: number, total: number): number {
  if (correct === 0) return 0;
  return Math.round((base * correct) / total + (correct === total ? 10 : 0));
}
