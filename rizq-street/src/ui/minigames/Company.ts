/**
 * Work at «مجموعة الرزق»: the hiring interview, then reception (route calls to the
 * right department), sales (match the customer to the product) and accounting
 * (invoice totals with 5% VAT). Every shift counts toward promotion.
 */
import { COMPANY_RANKS, job, type JobId } from '../../game/catalog';
import type { Store } from '../../game/state';
import { formatMoney } from '../../lang/arabic';
import { h } from '../dom';
import { runChoices, shiftResult, type Step } from './Choices';
import { Overlay, type MiniEnv } from './Overlay';

const INTERVIEW: Step[] = [
  { who: 'نورة', line: 'ليش تبي{|ن} تشتغل{|ين} عندنا؟', options: ['أبي أتعلم وأتطور، وأخدم الشركة بأمانة.', 'أبي فلوس وبس.', 'ما أدري، قالوا لي تعال.'], right: 0, why: 'الشركات تبي أحد يبي يتعلم ويخدم، مب بس يقبض.' },
  { who: 'نورة', line: 'الدوام يبدأ الساعة ثمان. متى توصل{|ين}؟', options: ['قبل ثمان بعشر دقايق.', 'تسع ونص تقريباً.', 'على حسب مزاجي.'], right: 0, why: 'الالتزام بالوقت أول شي ينشاف.' },
  { who: 'نورة', line: 'عميل معصب يصارخ بالتلفون. شو تسوي{|ن}؟', options: ['أهديه وأسمعه وأحل مشكلته بأدب.', 'أسكّر الخط بوجهه.', 'أصارخ عليه أكثر منه.'], right: 0, why: 'الهدوء والاحترام يكسبون العميل.' },
  { who: 'نورة', line: 'غلطت{|ي} بشغلة. شو تسوي{|ن}؟', options: ['أعترف بالغلط وأصلحه وأتعلم منه.', 'أخبيه وأسكت.', 'ألوم زميلي.'], right: 0, why: 'الاعتراف بالغلط أمانة، والكل يغلط.' },
  { who: 'نورة', line: 'كم ١٥٪ من ٢٠٠ درهم؟', options: ['30 درهم', '15 درهم', '35 درهم'], right: 0, why: '10٪ من 200 = 20، و5٪ = 10، يعني 30.' },
  { who: 'نورة', line: 'لقيت{|ي} محفظة بمكتب الشركة. شو تسوي{|ن}؟', options: ['أسلمها للاستقبال عشان ترجع لصاحبها.', 'آخذها.', 'أتركها مكانها.'], right: 0, why: 'الأمانة قبل كل شي.' },
  { who: 'نورة', line: 'زميلك يحتاج مساعدة وأنت خلصت{|ي} شغلك. شو تسوي{|ن}؟', options: ['أساعده.', 'أروح البيت بدري.', 'أقول مب شغلي.'], right: 0, why: 'روح الفريق تخليك تترقى أسرع.' },
];

const DEPTS = ['المبيعات', 'المحاسبة', 'الدعم الفني', 'الموارد البشرية'];
const CALLS: [string, number][] = [
  ['أبي أطلب خمسين كرتون ماي لمحلي.', 0],
  ['عندي سؤال عن فاتورة الشهر الماضي، فيها غلط.', 1],
  ['الثلاجة اللي اشتريتها منكم ما تبرد.', 2],
  ['أبي أقدم على وظيفة عندكم.', 3],
  ['كم سعر الجملة للعصير؟', 0],
  ['متى تحولون لي المبلغ المسترجع؟', 1],
  ['التطبيق حقكم يعلق عندي.', 2],
  ['أبي أسأل عن الإجازة السنوية.', 3],
  ['عندكم عروض للمطاعم؟', 0],
  ['أبي إيصال الدفع حق طلبيتي.', 1],
  ['المكيف اللي ركبتوه يسرب ماي.', 2],
  ['عندي مقابلة بكرة، الساعة كم؟', 3],
];
const CALLERS = [
  { who: 'متصل', gender: 'm' as const, key: 'caller1', pitch: 0.95 },
  { who: 'متصلة', gender: 'f' as const, key: 'caller2', pitch: 1.15 },
];

const CUSTOMERS: Step[] = [
  { who: 'زبون', line: 'عندي كافتيريا صغيرة وأبي شي يبرد المشروبات.', options: ['ثلاجة عرض صغيرة', 'مكيف مركزي', 'فرن كهربائي'], right: 0, why: 'اسمع الحاجة: يبي يبرد مشروبات، مب يبرد المحل.' },
  { who: 'زبونة', line: 'أبي هدية لأمي، تحب الريحة الحلوة.', options: ['طقم عطور وبخور', 'مثقاب كهربائي', 'إطارات سيارة'], right: 0 },
  { who: 'مدير شركة', line: 'شركتي تبي ماي للموظفين كل أسبوع.', options: ['اشتراك أسبوعي لكراتين الماي', 'كرتون واحد', 'ثلاجة كبيرة'], right: 0, why: 'الاشتراك يريحه ويخليه زبون دائم.' },
  { who: 'طالب', line: 'ميزانيتي قليلة وأبي جوال للدراسة.', options: ['جوال اقتصادي ببطارية قوية', 'أغلى جوال عندنا', 'ساعة ذكية'], right: 0, why: 'لا تبيع الزبون فوق ميزانيته، يرجع لك مرة ثانية.' },
  { who: 'صاحب مطعم', line: 'مطعمي يحتاج زيت طبخ بكميات كبيرة.', options: ['تنكات زيت بسعر الجملة', 'علبة زيت صغيرة', 'عصير برتقال'], right: 0 },
  { who: 'زبونة', line: 'أبي أبدأ بسطة آيس كريم بالحديقة.', options: ['ثلاجة متنقلة وكراتين آيس كريم بالجملة', 'ملابس رياضية', 'كتب'], right: 0 },
  { who: 'زبون', line: 'هذا المنتج أحسن شي بالسوق؟ (وأنت تعرف{|ين} إن عندكم أحسن منه بنفس السعر)', options: ['أقول له الصدق وأقترح الأحسن', 'أقول له إيه أحسن شي', 'أسكت'], right: 0, why: 'الصدق يبني ثقة، والثقة تجيب زباين.' },
];

/** Count a shift: pay, XP, and the promotion check. */
function closeShift(env: MiniEnv, id: JobId, score: number, label: string): { pay: number; promoted: string | null } {
  const store: Store = env.store;
  const before = store.companyRank;
  const pay = Math.round(store.payFor(id, job(id).pay) * (0.35 + 0.65 * score));
  store.finishJob(id);
  store.gainXp(id, Math.round(6 + score * 12));
  store.bump('companyShifts');
  if (pay > 0) env.pay(pay, label);
  const after = store.companyRank;
  return { pay, promoted: after > before ? COMPANY_RANKS[after].title : null };
}

function resultText(store: Store, right: number, total: number, pay: number, promoted: string | null): string {
  const r = COMPANY_RANKS[store.companyRank];
  const next = COMPANY_RANKS[store.companyRank + 1];
  const shifts = store.s.stats.companyShifts ?? 0;
  let t = `${right} من ${total} صح. أجر الوردية ${formatMoney(pay)}.`;
  if (promoted) t += ` 🎉 ترقية! صرت «${promoted}» والراتب زاد.`;
  else if (next) t += ` رتبتك «${r.title}»، باقي ${next.shifts - shifts} ورديات للترقية.`;
  return t;
}

export class InterviewGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    private readonly onHired: () => void,
  ) {
    this.ov = new Overlay(parent, 'مقابلة توظيف', 'مجموعة الرزق للأعمال — الأستاذة نورة');
    this.ov.body.append(this.screen);
    env.speak('أهلاً فيك. خمس أسئلة بسيطة، جاوب بصراحة.', 'f', 'hr', 1.1);
    this.start();
  }

  private start(): void {
    const env = this.env;
    const steps = env.rng.shuffle(INTERVIEW).slice(0, 5);
    runChoices(
      env,
      this.screen,
      steps,
      (right) => {
        const passed = right >= 4;
        if (passed) {
          env.store.s.flags.companyHired = true;
          env.speak('مبروك! انقبلت عندنا. تقدر تبدأ الحين بالاستقبال.', 'f', 'hr', 1.1);
        } else env.speak('شكراً لك. تقدر تعيد المقابلة.', 'f', 'hr', 1.1);
        this.ov.stat.textContent = passed ? 'مقبول ✓' : 'النتيجة';
        shiftResult(
          this.screen,
          passed ? `جاوبت ${right} من 5 وانقبلت! صرت «متدرب» بمجموعة الرزق. تبدأ بالاستقبال، وكل ما تشتغل تترقى: موظف ثم مشرف ثم مدير قسم.` : `جاوبت ${right} من 5. تحتاج 4 عشان تنقبل، جرّب مرة ثانية.`,
          passed,
          () => this.ov.close(),
          passed ? { label: 'ابدأ أول وردية', run: () => (this.ov.close(), this.onHired()) } : { label: 'أعد المقابلة', run: () => this.start() },
        );
      },
      (i) => (this.ov.stat.textContent = `سؤال ${i + 1}/5`),
    );
  }
}

export class ReceptionGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');

  constructor(parent: HTMLElement, env: MiniEnv, onDone: () => void) {
    this.ov = new Overlay(parent, 'استقبال مجموعة الرزق', `${COMPANY_RANKS[env.store.companyRank].title} — حوّل كل مكالمة للقسم الصح`);
    this.ov.onClose = onDone;
    this.ov.body.append(this.screen);
    const calls = env.rng.shuffle(CALLS).slice(0, 6);
    const steps: Step[] = calls.map(([line, dept], k) => {
      const c = CALLERS[k % 2];
      return { who: `📞 ${c.who}`, line, options: DEPTS, right: dept, voice: { gender: c.gender, key: c.key, pitch: c.pitch } };
    });
    runChoices(
      env,
      this.screen,
      steps,
      (right) => {
        const r = closeShift(env, 'reception', right / steps.length, 'وردية الاستقبال');
        shiftResult(this.screen, resultText(env.store, right, steps.length, r.pay, r.promoted), right >= 3, () => this.ov.close());
      },
      (i) => (this.ov.stat.textContent = `مكالمة ${i + 1}/${steps.length}`),
    );
  }
}

export class SalesGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');

  constructor(parent: HTMLElement, env: MiniEnv, onDone: () => void) {
    this.ov = new Overlay(parent, 'قسم المبيعات', `${COMPANY_RANKS[env.store.companyRank].title} — اسمع الزبون واقترح الأنسب`);
    this.ov.onClose = onDone;
    this.ov.body.append(this.screen);
    const steps = env.rng.shuffle(CUSTOMERS).slice(0, 5);
    runChoices(
      env,
      this.screen,
      steps,
      (right) => {
        const r = closeShift(env, 'sales', right / steps.length, 'وردية المبيعات والعمولة');
        shiftResult(this.screen, resultText(env.store, right, steps.length, r.pay, r.promoted), right >= 3, () => this.ov.close());
      },
      (i) => (this.ov.stat.textContent = `زبون ${i + 1}/${steps.length}`),
    );
  }
}

export class AccountingGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');

  constructor(parent: HTMLElement, env: MiniEnv, onDone: () => void) {
    this.ov = new Overlay(parent, 'قسم المحاسبة', `${COMPANY_RANKS[env.store.companyRank].title} — المجموع مع ضريبة ٥٪`);
    this.ov.onClose = onDone;
    this.ov.body.append(this.screen);
    const goods = ['كرتون ماي', 'كرتون عصير', 'تنكة زيت', 'كيس رز', 'علبة شاي', 'صندوق تمر'];
    const steps: Step[] = Array.from({ length: 4 }, () => {
      const lines = env.rng.shuffle(goods).slice(0, 2).map((name) => ({ name, qty: env.rng.int(2, 9), price: env.rng.pick([10, 12, 15, 20, 25, 40]) }));
      const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
      const vat = Math.round(sub * 0.05);
      const table = h(
        'table.invoice',
        h('tr', h('th', 'الصنف'), h('th', 'الكمية'), h('th', 'السعر'), h('th', 'المجموع')),
        ...lines.map((l) => h('tr', h('td', l.name), h('td', String(l.qty)), h('td', String(l.price)), h('td', String(l.qty * l.price)))),
        h('tr.sum', h('td', { colspan: 3 }, 'المجموع قبل الضريبة'), h('td', String(sub))),
      );
      return { who: 'فاتورة', line: 'كم المجموع النهائي مع ضريبة القيمة المضافة ٥٪؟', extra: table, options: [`${sub + vat} درهم`, `${sub} درهم`, `${sub + vat * 2} درهم`], right: 0, why: `الضريبة ${vat} (٥٪ من ${sub})، والمجموع ${sub + vat}.` };
    });
    runChoices(
      env,
      this.screen,
      steps,
      (right) => {
        const r = closeShift(env, 'accounting', right / steps.length, 'وردية المحاسبة');
        shiftResult(this.screen, resultText(env.store, right, steps.length, r.pay, r.promoted), right >= 2, () => this.ov.close());
      },
      (i) => (this.ov.stat.textContent = `فاتورة ${i + 1}/${steps.length}`),
    );
  }
}
