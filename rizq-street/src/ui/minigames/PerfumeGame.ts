/**
 * Helping dad at the perfume shop: four customers describe what they want, plainly or
 * by mood. Pick the oils (up to three) using dad's notebook, and blend.
 */
import { job } from '../../game/catalog';
import { blendScore, makeRequest, NOTEBOOK, oilName, OILS, salePay, type Oil, type PerfumeRequest } from '../../game/jobs/perfume';
import { formatMoney, normalizeArabic } from '../../lang/arabic';
import { makePasserby } from '../../dialogue/pedestrians';
import { h } from '../dom';
import { Overlay, voiceButton, type MiniEnv } from './Overlay';

const CUSTOMERS = 4;

export class PerfumeGame {
  readonly ov: Overlay;
  private n = 0;
  private perfect = 0;
  private req!: PerfumeRequest;
  private picked: Oil[] = [];
  private readonly line = h('div.speech');
  private readonly grid = h('div.oils');
  private readonly feedback = h('div.feedback');
  private readonly actions = h('div.row');

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    private readonly onDone: (sales: number) => void,
  ) {
    this.ov = new Overlay(parent, 'عطور أبو سالم', 'أبوك: «اسمع الزبون زين، وعطه اللي يناسبه»');
    this.ov.onClose = () => this.onDone(this.n);
    const notebook = h('div.notebook', h('b', 'دفتر أبوي'), ...NOTEBOOK.map((n) => h('div', `${n.mood}: ${n.oils.map(oilName).join(' + ')}`)));
    this.ov.body.append(this.line, this.grid, this.actions, this.feedback, notebook);
    this.next();
  }

  private render(): void {
    this.grid.replaceChildren(
      ...OILS.map((o) =>
        h(
          `button${this.picked.includes(o.id) ? '.on' : ''}`,
          { type: 'button', onclick: () => this.toggle(o.id) },
          h('span.bottle', { style: { background: o.color } }),
          o.name,
        ),
      ),
    );
  }

  private toggle(id: Oil): void {
    if (this.picked.includes(id)) this.picked = this.picked.filter((x) => x !== id);
    else if (this.picked.length < 3) this.picked.push(id);
    this.env.sfx.click();
    this.render();
  }

  private next(): void {
    if (this.n >= CUSTOMERS) return this.finish();
    this.req = makeRequest(this.env.rng, this.env.store.level('perfume'));
    this.picked = [];
    const c = makePasserby(this.env.rng, `p${this.n}`);
    this.line.replaceChildren(h('span.from', `${c.name} — زبون ${this.n + 1} من ${CUSTOMERS}`), this.req.line);
    this.env.speak(this.req.line, c.gender, c.key, c.voice.pitch);
    this.ov.stat.textContent = `${this.n + 1}/${CUSTOMERS}`;
    this.feedback.className = 'feedback';
    this.feedback.textContent = this.req.mood ? 'الزبون ما سمّى الزيوت. شوف دفتر أبوك تحت.' : 'اختار الزيوت اللي طلبها.';
    const mic = voiceButton(this.env, (t) => {
      const norm = normalizeArabic(t);
      for (const o of OILS) if (norm.includes(normalizeArabic(o.name.split(' ')[0])) && !this.picked.includes(o.id) && this.picked.length < 3) this.picked.push(o.id);
      this.render();
    });
    this.actions.replaceChildren(h('button.btn.warm', { type: 'button', onclick: () => this.blend() }, 'اخلط وقدّم 🧴'), mic);
    this.render();
  }

  private blend(): void {
    if (!this.picked.length) {
      this.feedback.textContent = 'اختار زيت واحد على الأقل.';
      return;
    }
    const score = blendScore(this.picked, this.req.oils);
    const base = Math.round(this.env.store.payFor('perfume', job('perfume').pay) / CUSTOMERS) * (this.env.store.has('gift') ? 2 : 1);
    const { wage, tip } = salePay(base, score, this.env.store.tipFactor());
    const want = this.req.oils.map(oilName).join(' + ');
    if (score >= 1) {
      this.perfect++;
      this.env.sfx.success();
      this.feedback.className = 'feedback good';
      this.feedback.textContent = `الزبون شم وابتسم: «هذا اللي أبيه!» نصيبك ${formatMoney(wage)}${tip ? ` + بقشيش ${formatMoney(tip)}` : ''}`;
      this.env.store.gainXp('perfume', 14);
    } else if (score >= 0.5) {
      this.feedback.className = 'feedback';
      this.feedback.textContent = `اشتراه بس مب مقتنع. الخلطة الصح: ${want}. نصيبك ${formatMoney(wage)}`;
      this.env.store.gainXp('perfume', 5);
    } else {
      this.env.sfx.fail();
      this.feedback.className = 'feedback bad';
      this.feedback.textContent = `ما عجبه وطلع. كان يبي: ${want}`;
    }
    if (wage + tip > 0) this.env.pay(wage + tip, 'محل العطور');
    this.n++;
    this.env.store.bump('perfumeSales');
    this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.next() }, this.n >= CUSTOMERS ? 'خلصنا' : 'الزبون اللي بعده'));
  }

  private finish(): void {
    this.env.store.finishJob('perfume');
    this.line.replaceChildren(h('span.from', 'أبوك'), `ما شاء الله عليك! ${this.perfect} من ${this.n} زباين طلعوا مبسوطين. هذا شغل تاجر.`);
    this.env.speak('ما شاء الله عليك، صرت تاجر مثل أبوك!', 'm', 'dad', 0.86);
    this.grid.replaceChildren();
    this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.ov.close() }, 'الله يحفظك يبه'));
  }
}
