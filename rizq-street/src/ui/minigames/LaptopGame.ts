/**
 * The laptop on the desk at home: a freelance board ("شغلني") with gigs from clients.
 * Pay goes to the bank; take it out as notes at the street ATM.
 */
import { skillMultiplier } from '../../game/catalog';
import {
  ADS,
  GIGS,
  LOGO_BRIEFS,
  LOGO_COLORS,
  LOGO_ICONS,
  LOGO_SHAPES,
  SPELLING,
  TRANSLATIONS,
  TYPING_LINES,
  gigPay,
  pickGigTasks,
  typingAccuracy,
  type GigDef,
} from '../../game/jobs/online';
import { formatMoney } from '../../lang/arabic';
import { h } from '../dom';
import { Overlay, type MiniEnv } from './Overlay';

export class LaptopGame {
  readonly ov: Overlay;
  private readonly screen = h('div.inner');
  private readonly bankEl = h('b');
  private gigsDone = 0;

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    private readonly onDone: (gigs: number) => void,
  ) {
    this.ov = new Overlay(parent, 'شغلني — منصة العمل الحر', env.store.has('laptop') ? 'لابتوبك الجديد 💻' : 'لابتوب البيت القديم', { wide: true });
    this.ov.onClose = () => this.onDone(this.gigsDone);
    const s = env.store.s;
    this.bankEl.textContent = formatMoney(s.bank);
    this.ov.body.append(h('div.laptop', h('div.bar', h('span', `مرحباً ${s.player.name}`), h('span', 'رصيدك بالبنك: ', this.bankEl)), this.screen));
    if (s.flags.onlineVerified) this.board();
    else this.admissionIntro();
  }

  /** First visit: the platform asks for a short admission test before any gig. */
  private admissionIntro(): void {
    const goal = this.env.store.goalProgress();
    this.ov.stat.textContent = 'اختبار القبول';
    this.screen.replaceChildren(
      h('b', 'أهلاً بك في «شغلني» 👋'),
      h('div.speech', h('span.from', 'المنصة'), 'قبل ما نعطيك طلبات من العملاء، نسوي لك اختبار قبول قصير: أربع أسئلة عن الإملاء والحساب والكتابة والتعامل مع العميل. تحتاج ثلاث إجابات صح عشان تنقبل.'),
      ...(goal ? [h('div.muted', `هدفك: ${formatMoney(goal.amount)} — جمعت منه ${formatMoney(goal.got)}.`)] : []),
      h('div.row', h('button.btn', { type: 'button', id: 'admission-start', onclick: () => this.admission() }, 'ابدأ الاختبار')),
    );
    this.env.speak('أهلاً بك في منصة شغلني. قبل الطلبات نسوي لك اختبار قبول قصير، أربع أسئلة.', 'f', 'platform', 1.1);
  }

  private admission(): void {
    const rng = this.env.rng;
    const [word, bad1, bad2] = rng.pick(SPELLING);
    const qty = rng.int(2, 5);
    const price = rng.pick([6, 8, 12, 15]);
    const total = qty * price;
    const line = rng.pick(TYPING_LINES.filter((l) => l.length < 26));
    const qs: { prompt: string; options?: string[]; right?: string; typing?: string }[] = [
      { prompt: 'أي كلمة مكتوبة صح؟', right: word, options: rng.shuffle([word, bad1, bad2]) },
      { prompt: `عميل طلب ${qty} كراتين، سعر الكرتون ${price} درهم. كم المجموع؟`, right: `${total} درهم`, options: rng.shuffle([`${total} درهم`, `${total + price} درهم`, `${total - qty} درهم`]) },
      { prompt: 'اكتب هالسطر بالضبط:', typing: line },
      {
        prompt: 'عميل كتب لك: «الشغل تأخر!». شو أحسن رد؟',
        right: 'أعتذر منك، بسلّمه لك اليوم إن شاء الله.',
        options: rng.shuffle(['أعتذر منك، بسلّمه لك اليوم إن شاء الله.', 'مو مشكلتي.', 'ما أرد على العملاء.']),
      },
    ];
    let i = 0;
    let right = 0;
    const next = (ok: boolean) => {
      if (ok) right++;
      ok ? this.env.sfx.success() : this.env.sfx.fail();
      setTimeout(() => {
        i++;
        if (i >= qs.length) this.admissionResult(right, qs.length);
        else show();
      }, 650);
    };
    const show = () => {
      const q = qs[i];
      this.ov.stat.textContent = `سؤال ${i + 1} من ${qs.length}`;
      const head = [h('b', 'اختبار القبول'), h('div.muted', `سؤال ${i + 1} من ${qs.length}`), h('div.question', q.prompt)];
      if (q.typing) {
        const input = h('input.field', { type: 'text', id: 'admission-input', autocomplete: 'off', placeholder: 'اكتب هنا ثم Enter' }) as HTMLInputElement;
        const form = h('form.row', input, h('button.btn', { type: 'submit' }, 'التالي'));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          next(typingAccuracy(input.value, q.typing!) >= 0.8);
        });
        this.screen.replaceChildren(...head, h('div.question', { style: 'font-size:24px;background:#fff8e6' }, q.typing), form);
        input.focus();
        return;
      }
      const grid = h('div.choice-grid');
      for (const o of q.options!) {
        const b = h('button', { type: 'button' }, o);
        b.onclick = () => {
          if (grid.classList.contains('done')) return;
          grid.classList.add('done');
          const ok = o === q.right;
          b.classList.add(ok ? 'right' : 'wrong');
          for (const other of Array.from(grid.children)) if (other.textContent === q.right) other.classList.add('right');
          next(ok);
        };
        grid.append(b);
      }
      this.screen.replaceChildren(...head, grid);
    };
    show();
  }

  private admissionResult(right: number, total: number): void {
    const passed = right >= total - 1;
    if (passed) {
      this.env.store.s.flags.onlineVerified = true;
      this.env.pay(10, 'مكافأة التسجيل بمنصة شغلني', { bank: true });
      this.bankEl.textContent = formatMoney(this.env.store.s.bank);
      this.env.speak('مبروك! انقبلت بالمنصة. اختر أول طلب.', 'f', 'platform', 1.1);
    } else this.env.speak('ما عديت هالمرة، جرب مرة ثانية.', 'f', 'platform', 1.1);
    this.ov.stat.textContent = passed ? 'مقبول ✓' : 'النتيجة';
    this.screen.replaceChildren(
      h('div.feedback', { class: passed ? 'good' : 'bad' }, passed ? `مبروك! جاوبت ${right} من ${total} وانقبلت بالمنصة 🎉 نزلت لك مكافأة تسجيل ${formatMoney(10)} بالبنك.` : `جاوبت ${right} من ${total}. تحتاج ${total - 1} عشان تنقبل، جرّب مرة ثانية.`),
      h('div.row', passed ? h('button.btn', { type: 'button', id: 'admission-board', onclick: () => this.board() }, 'شوف الطلبات') : h('button.btn', { type: 'button', onclick: () => this.admission() }, 'أعد الاختبار')),
    );
  }

  private mult(): number {
    return skillMultiplier(this.env.store.level('online')) * (this.env.store.has('laptop') ? 1.6 : 1);
  }

  private board(): void {
    const has = this.env.store.has('laptop');
    this.ov.stat.textContent = '';
    const goal = this.env.store.goalProgress();
    this.screen.replaceChildren(
      h('b', 'الطلبات المتاحة الآن'),
      ...(goal ? [h('div.muted', `هدفك ${formatMoney(goal.amount)}: جمعت ${formatMoney(goal.got)}، باقي ${goal.daysLeft} يوم.`)] : []),
      ...GIGS.map((g) => {
        const locked = g.needsLaptop && !has;
        const pay = Math.round(g.base * this.mult());
        return h(
          'div.gig',
          h('div.grow', h('b', g.title), h('div.muted', `${g.client} — ${g.blurb}`), locked ? h('div.muted', '🔒 يحتاج اللابتوب الجديد (من عالم الجوال)') : null),
          h('div.pay', `حتى ${formatMoney(pay + Math.round(pay * 0.2))}`),
          h('button.btn', { type: 'button', disabled: locked, onclick: () => this.start(g) }, 'ابدأ'),
        );
      }),
      h('div.muted', 'الأجر ينزل بحسابك بالبنك. اسحبه دراهم من الصراف اللي جنب البقالة.'),
    );
  }

  private start(g: GigDef): void {
    this.env.sfx.click();
    switch (g.kind) {
      case 'typing':
        return this.typing(g);
      case 'spelling':
        return this.choices(g, pickGigTasks(this.env.rng, SPELLING, 5).map(([right, a, b]) => ({ prompt: 'أي كلمة مكتوبة صح؟', right, options: this.env.rng.shuffle([right, a, b]) })));
      case 'translate':
        return this.choices(g, pickGigTasks(this.env.rng, TRANSLATIONS, 6).map(([en, right, a, b]) => ({ prompt: en, right, options: this.env.rng.shuffle([right, a, b]) })));
      case 'arrange':
        return this.arrange(g);
      case 'design':
        return this.design(g);
    }
  }

  private complete(g: GigDef, quality: number): void {
    const pay = gigPay(Math.round(g.base * this.mult()), quality);
    this.gigsDone++;
    this.env.store.bump('gigs');
    this.env.store.gainXp('online', Math.round(6 + quality * 10));
    this.env.store.finishJob('online');
    const pct = Math.round(quality * 100);
    if (pay > 0) {
      this.env.pay(pay, `شغل أونلاين: ${g.title}`, { bank: true });
      this.bankEl.textContent = formatMoney(this.env.store.s.bank);
      this.env.sfx.register();
    } else this.env.sfx.fail();
    this.screen.replaceChildren(
      h('div.feedback', { class: pay > 0 ? 'good' : 'bad' }, pay > 0 ? `${g.client} استلم الشغل. الجودة ${pct}%، وتحوّل لحسابك ${formatMoney(pay)}.` : `الجودة ${pct}% بس، العميل رفض الشغل. جرّب مرة ثانية بتركيز.`),
      h('div.row', h('button.btn', { type: 'button', onclick: () => this.board() }, 'طلب ثاني'), h('button.btn.secondary', { type: 'button', onclick: () => this.ov.close() }, 'سكّر اللابتوب')),
    );
  }

  private typing(g: GigDef): void {
    const lines = pickGigTasks(this.env.rng, TYPING_LINES, 4);
    let i = 0;
    let acc = 0;
    const started = performance.now();
    const target = h('div.question', { style: 'font-size:24px' });
    const input = h('input.field', { type: 'text', id: 'typing-input', autocomplete: 'off', placeholder: 'اكتب السطر هنا ثم Enter' }) as HTMLInputElement;
    const progress = h('div.muted');
    const show = () => {
      target.textContent = lines[i];
      progress.textContent = `السطر ${i + 1} من ${lines.length}`;
      input.value = '';
      input.focus();
    };
    const form = h('form.row', input, h('button.btn', { type: 'submit' }, 'التالي'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      acc += typingAccuracy(input.value, lines[i]);
      i++;
      this.env.sfx.click();
      if (i >= lines.length) {
        const seconds = (performance.now() - started) / 1000;
        const speed = seconds < 50 ? 1 : seconds < 90 ? 0.9 : 0.75;
        this.complete(g, (acc / lines.length) * speed);
      } else show();
    });
    this.screen.replaceChildren(h('b', `${g.title} — ${g.client}`), h('div.muted', 'اكتب كل سطر مثل ما هو بالضبط. السرعة تفرق.'), target, form, progress);
    show();
  }

  private choices(g: GigDef, qs: { prompt: string; right: string; options: string[] }[]): void {
    let i = 0;
    let right = 0;
    const show = () => {
      const q = qs[i];
      const grid = h('div.choice-grid');
      for (const o of q.options) {
        const b = h('button', { type: 'button' }, o);
        b.onclick = () => {
          const ok = o === q.right;
          if (ok) right++;
          b.classList.add(ok ? 'right' : 'wrong');
          for (const other of Array.from(grid.children)) if (other.textContent === q.right) other.classList.add('right');
          ok ? this.env.sfx.success() : this.env.sfx.fail();
          setTimeout(() => {
            i++;
            if (i >= qs.length) this.complete(g, right / qs.length);
            else show();
          }, 650);
        };
        grid.append(b);
      }
      this.screen.replaceChildren(h('b', `${g.title} — ${g.client}`), h('div.muted', `${i + 1} من ${qs.length}`), h('div.question', { style: 'direction:auto' }, q.prompt), grid);
    };
    show();
  }

  private arrange(g: GigDef): void {
    const ads = pickGigTasks(this.env.rng, ADS, 2);
    let i = 0;
    let score = 0;
    const show = () => {
      const words = ads[i].split(' ');
      const pool = this.env.rng.shuffle(words);
      const chosen: string[] = [];
      const built = h('div.words');
      const bank = h('div.words');
      const render = () => {
        built.replaceChildren(...chosen.map((w, k) => h('button', { type: 'button', onclick: () => (pool.push(...chosen.splice(k, 1)), render()) }, w)));
        bank.replaceChildren(...pool.map((w, k) => h('button', { type: 'button', onclick: () => (chosen.push(...pool.splice(k, 1)), this.env.sfx.click(), render()) }, w)));
      };
      const submit = h(
        'button.btn',
        {
          type: 'button',
          onclick: () => {
            let ok = 0;
            words.forEach((w, k) => (ok += chosen[k] === w ? 1 : 0));
            score += ok / words.length;
            i++;
            if (i >= ads.length) this.complete(g, score / ads.length);
            else show();
          },
        },
        'سلّم الإعلان',
      );
      this.screen.replaceChildren(h('b', `${g.title} — ${g.client}`), h('div.muted', 'رتّب الكلمات عشان تطلع جملة إعلان مفهومة.'), built, bank, h('div.row', submit));
      render();
    };
    show();
  }

  private design(g: GigDef): void {
    const brief = this.env.rng.pick(LOGO_BRIEFS);
    let color = LOGO_COLORS[0].id;
    let shape = LOGO_SHAPES[0].id;
    let icon = LOGO_ICONS[0].id;
    const preview = h('div.logo-preview');
    const render = () => {
      const c = LOGO_COLORS.find((x) => x.id === color)!;
      preview.style.background = c.hex;
      preview.style.borderRadius = shape === 'circle' ? '50%' : shape === 'square' ? '18px' : '18px 18px 60px 60px';
      preview.textContent = LOGO_ICONS.find((x) => x.id === icon)!.glyph;
    };
    const group = <T extends { id: string; name: string }>(items: T[], get: () => string, set: (v: string) => void) => {
      const grid = h('div.choice-grid');
      const paint = () => {
        grid.replaceChildren(...items.map((it) => h(`button${get() === it.id ? '.on' : ''}`, { type: 'button', onclick: () => (set(it.id), paint(), render()) }, it.name)));
      };
      paint();
      return grid;
    };
    const submit = h(
      'button.btn',
      {
        type: 'button',
        onclick: () => {
          const q = ((color === brief.color ? 1 : 0) + (shape === brief.shape ? 1 : 0) + (icon === brief.icon ? 1 : 0)) / 3;
          this.complete(g, q);
        },
      },
      'سلّم التصميم',
    );
    this.screen.replaceChildren(
      h('b', `${g.title}`),
      h('div.speech', h('span.from', 'طلب العميل'), brief.line),
      preview,
      h('div.muted', 'اللون'),
      group(LOGO_COLORS, () => color, (v) => (color = v)),
      h('div.muted', 'الشكل'),
      group(LOGO_SHAPES, () => shape, (v) => (shape = v)),
      h('div.muted', 'الرمز'),
      group(LOGO_ICONS, () => icon, (v) => (icon = v)),
      h('div.row', submit),
    );
    render();
  }
}
