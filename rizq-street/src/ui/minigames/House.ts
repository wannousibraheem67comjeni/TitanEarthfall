/**
 * Chores inside the house: scrub the dishes clean, sort the clean laundry into the
 * family's wardrobes, and serve Arabic coffee to dad's guests the proper way.
 */
import { job, type JobId } from '../../game/catalog';
import { formatMoney } from '../../lang/arabic';
import { h } from '../dom';
import { runChoices, shiftResult, type Step } from './Choices';
import { Countdown, Overlay, type MiniEnv } from './Overlay';

/** Pay a chore by how well it went (never below a third of the rate). */
function payChore(env: MiniEnv, id: JobId, score: number, label: string, xp: number): number {
  const pay = Math.round(env.store.payFor(id, job(id).pay) * (env.store.has('gift') ? 2 : 1) * (0.35 + 0.65 * score));
  env.store.finishJob(id);
  env.store.gainXp(id, xp);
  env.pay(pay, label);
  return pay;
}

const DISHES = ['plate', 'plate', 'bowl', 'pot', 'plate', 'cup'] as const;
const DISH_NAMES = { plate: 'صحن', bowl: 'زبدية', pot: 'قدر', cup: 'كوب' };

export class DishesGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');
  private done = 0;
  private timer: Countdown | null = null;
  private finished = false;

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    onDone: () => void,
  ) {
    this.ov = new Overlay(parent, 'غسيل المواعين', 'ماما: «امسح البقع زين، وحطها على الرف»');
    this.ov.onClose = () => {
      this.timer?.stop();
      onDone();
    };
    this.ov.body.append(this.screen);
    this.timer = new Countdown(
      55,
      (left) => (this.ov.stat.textContent = `${left}ث · ${this.done}/${DISHES.length}`),
      () => this.finish(),
    );
    this.next();
  }

  private next(): void {
    if (this.done >= DISHES.length) return this.finish();
    const kind = DISHES[this.done];
    const dish = h(`div.dish.${kind}`);
    const spots: HTMLElement[] = [];
    const n = this.env.rng.int(4, 6);
    for (let i = 0; i < n; i++) {
      const a = this.env.rng.range(0, Math.PI * 2);
      const r = this.env.rng.range(0, 34);
      const s = h('i.spot', { style: { left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%`, width: `${this.env.rng.int(26, 44)}px`, height: `${this.env.rng.int(22, 38)}px` } });
      spots.push(s);
      dish.append(s);
    }
    const scrub = (e: PointerEvent) => {
      if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
      for (const s of [...spots]) {
        const r = s.getBoundingClientRect();
        if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) > Math.max(r.width, 30)) continue;
        const o = Number(s.style.opacity || 1) - 0.22;
        s.style.opacity = String(o);
        if (Math.random() < 0.3) this.env.sfx.scrub();
        if (o <= 0.1) {
          s.remove();
          spots.splice(spots.indexOf(s), 1);
        }
      }
      if (!spots.length && !dish.classList.contains('clean')) {
        dish.classList.add('clean');
        this.env.sfx.pop();
        this.done++;
        this.ov.stat.textContent = `${this.timer?.left ?? 0}ث · ${this.done}/${DISHES.length}`;
        setTimeout(() => this.next(), 450);
      }
    };
    dish.addEventListener('pointerdown', (e) => {
      dish.setPointerCapture(e.pointerId);
      scrub(e);
    });
    dish.addEventListener('pointermove', scrub);
    const rack = h('div.rack', ...Array.from({ length: DISHES.length }, (_, i) => h('span', i < this.done ? '🍽️' : '·')));
    this.screen.replaceChildren(h('div.muted', `${DISH_NAMES[kind]} ${this.done + 1} من ${DISHES.length}: اسحب على البقع لين تختفي.`), h('div.sink', dish), rack);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.timer?.stop();
    const score = this.done / DISHES.length;
    const pay = payChore(this.env, 'dishes', score, 'غسيل المواعين', 6 + this.done * 2);
    this.env.speak(score >= 1 ? 'الله يعطيك العافية، المطبخ يلمع!' : 'تسلم إيدك، بس باقي شوي.', 'f', 'mum', 1.12);
    shiftResult(this.screen, `غسلت ${this.done} من ${DISHES.length}. ماما عطتك ${formatMoney(pay)}.`, score >= 0.5, () => this.ov.close());
  }
}

const CLOTHES: { name: string; icon: string; owner: number }[] = [
  { name: 'كندورة بيضا كبيرة', icon: '🥼', owner: 0 },
  { name: 'غترة وعقال', icon: '🧣', owner: 0 },
  { name: 'فانيلة رجالي كبيرة', icon: '🎽', owner: 0 },
  { name: 'عباية سودا', icon: '🧥', owner: 1 },
  { name: 'شيلة', icon: '🧕', owner: 1 },
  { name: 'جلابية ورد', icon: '👗', owner: 1 },
  { name: 'تيشيرت المدرسة', icon: '👕', owner: 2 },
  { name: 'بيجامة', icon: '🩳', owner: 2 },
  { name: 'جوارب صغيرة', icon: '🧦', owner: 2 },
];
const WARDROBES = ['دولاب أبوي', 'دولاب أمي', 'دولابي'];

export class LaundryGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');

  constructor(parent: HTMLElement, env: MiniEnv, onDone: () => void) {
    this.ov = new Overlay(parent, 'ترتيب الغسيل', 'ماما: «كل قطعة بدولاب صاحبها»');
    this.ov.onClose = onDone;
    this.ov.body.append(this.screen);
    const items = env.rng.shuffle(CLOTHES);
    let i = 0;
    let right = 0;
    const show = () => {
      if (i >= items.length) {
        const pay = payChore(env, 'laundry', right / items.length, 'ترتيب الغسيل', 5 + right);
        env.speak('تسلم يا عيني، الدواليب صارت مرتبة.', 'f', 'mum', 1.12);
        return shiftResult(this.screen, `${right} من ${items.length} بمكانها الصح. ماما عطتك ${formatMoney(pay)}.`, right >= 6, () => this.ov.close());
      }
      const it = items[i];
      this.ov.stat.textContent = `${i + 1}/${items.length}`;
      const row = h('div.wardrobes');
      WARDROBES.forEach((w, k) => {
        const b = h('button', { type: 'button' }, h('span', ['👨', '👩', '🙋'][k]), w);
        b.onclick = () => {
          if (row.classList.contains('done')) return;
          row.classList.add('done');
          const ok = k === it.owner;
          if (ok) right++;
          b.classList.add(ok ? 'right' : 'wrong');
          (row.children[it.owner] as HTMLElement).classList.add('right');
          ok ? env.sfx.success() : env.sfx.fail();
          setTimeout(() => {
            i++;
            show();
          }, 650);
        };
        row.append(b);
      });
      this.screen.replaceChildren(h('div.cloth', h('span', it.icon), h('b', it.name)), h('div.muted', 'لمين هالقطعة؟'), row);
    };
    show();
  }
}

const COFFEE_RULES: Step[] = [
  { who: 'بابا', line: 'وصلوا الضيوف. مين تصب{|ين} له أول؟', options: ['الحاج أبو محمد، كبير الضيوف', 'خالد ولد الجيران', 'أبو سعيد'], right: 0, why: 'الأصول: تبدأ بكبير القوم أو الضيف الأهم، وبعدها اللي على يمينه.' },
  { who: 'بابا', line: 'كيف تمسك{|ين} الدلة والفنجان؟', options: ['الدلة باليسار والفنجان باليمين', 'الاثنين بإيد وحدة', 'الفنجان باليسار'], right: 0, why: 'الفنجان ينقدم باليمين.' },
];
const COFFEE_AFTER: Step[] = [
  { who: 'بابا', line: 'الضيف هز الفنجان يمين ويسار. شو معناها؟', options: ['خلاص، ما يبي زيادة', 'يبي زيادة', 'القهوة حارة'], right: 0, why: 'هز الفنجان يعني كفاية، الله يعطيك العافية.' },
  { who: 'بابا', line: 'شو نقدم مع القهوة؟', options: ['تمر', 'شيبس', 'مشروب غازي'], right: 0, why: 'القهوة والتمر، ضيافة أهل الإمارات.' },
];

export class CoffeeGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');
  private right = 0;

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    onDone: () => void,
  ) {
    this.ov = new Overlay(parent, 'ضيافة القهوة بالمجلس', 'بابا: «القهوة لها أصول»');
    this.ov.onClose = onDone;
    this.ov.body.append(this.screen);
    env.speak('حياك الله. عندنا ضيوف، خلنا نشوف ضيافتك.', 'm', 'dad', 0.86);
    runChoices(env, this.screen, COFFEE_RULES, (r) => {
      this.right += r;
      this.pour(0, 0);
    });
  }

  /** Hold to pour; a proper Gulf cup is filled only a little (about a third). */
  private pour(n: number, good: number): void {
    const env = this.env;
    if (n >= 3) {
      this.right += good;
      return runChoices(env, this.screen, COFFEE_AFTER, (r) => {
        this.right += r;
        const total = COFFEE_RULES.length + 3 + COFFEE_AFTER.length;
        const pay = payChore(env, 'coffee', this.right / total, 'ضيافة القهوة', 6 + this.right * 2);
        env.speak(this.right >= total - 1 ? 'ما شاء الله، ضيافة ولا أحلى!' : 'زين، والأصول تتعلم مع الوقت.', 'm', 'dad', 0.86);
        shiftResult(this.screen, `${this.right} من ${total}. أبوك عطاك ${formatMoney(pay)}، والضيوف مدحوا ضيافتك.`, this.right >= total - 2, () => this.ov.close());
      });
    }
    const guests = ['الحاج أبو محمد', 'أبو سعيد', 'خالد'];
    this.ov.stat.textContent = `فنجان ${n + 1}/3`;
    const fill = h('i');
    const cup = h('div.finjan', fill, h('span.line'));
    const note = h('div.feedback');
    note.hidden = true;
    let level = 0;
    let raf = 0;
    let last = 0;
    let done = false;
    const btn = h('button.btn.warm.pour', { type: 'button' }, '☕ اضغط مطولاً وصب') as HTMLButtonElement;
    const tick = (t: number) => {
      level = Math.min(100, level + ((t - last) / 1000) * 55);
      last = t;
      fill.style.height = `${level}%`;
      raf = requestAnimationFrame(tick);
    };
    const start = (e: Event) => {
      e.preventDefault();
      if (done) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (done || !raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      if (level < 8) return;
      done = true;
      const ok = level >= 18 && level <= 45;
      note.hidden = false;
      note.className = `feedback ${ok ? 'good' : 'bad'}`;
      note.textContent = ok ? '✓ تمام، الفنجان قليل مثل الأصول.' : level > 45 ? '✗ واجد! الفنجان ما يتعبى، يكفي ثلثه.' : '✗ قليل مرة، زيده شوي.';
      ok ? env.sfx.success() : env.sfx.fail();
      setTimeout(() => this.pour(n + 1, good + (ok ? 1 : 0)), 1200);
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    this.screen.replaceChildren(h('div.speech', h('span.from', 'بابا'), `صب لـ${guests[n]}. شوي بس، لين الخط.`), h('div.pour-area', cup), btn, note);
  }
}
