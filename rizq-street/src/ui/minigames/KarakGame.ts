/**
 * The karak counter: six orders in a row. Build each cup from the recipe card by
 * tapping ingredients (or saying them: «حليب، سكر زيادة»), then serve it hot.
 */
import { job } from '../../game/catalog';
import { cupPay, DRINKS, INGREDIENTS, pickDrink, recipeErrors, recipeText, type Drink, type Ingredient, type Recipe } from '../../game/jobs/karak';
import { formatMoney, normalizeArabic } from '../../lang/arabic';
import { makePasserby } from '../../dialogue/pedestrians';
import { h } from '../dom';
import { Overlay, voiceButton, type MiniEnv } from './Overlay';

const ORDERS = 6;

export class KarakGame {
  readonly ov: Overlay;
  private n = 0;
  private perfect = 0;
  private drink!: Drink;
  private made: Recipe = {};
  private started = 0;
  private readonly line = h('div.speech');
  private readonly cup = h('div.cup');
  private readonly feedback = h('div.feedback');
  private readonly buttons = h('div.ingredients');
  private readonly book = h('div.notebook');
  private readonly actions = h('div.row');

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    private readonly onDone: (cups: number) => void,
  ) {
    this.ov = new Overlay(parent, 'كرك الفريج', 'أبو خالد: «السر بالهيل… والصبر»');
    this.ov.onClose = () => this.onDone(this.n);
    const level = env.store.level('karak');
    this.book.append(
      h('b', 'دفتر الوصفات'),
      ...DRINKS.filter((d) => d.minLevel <= level + 1).map((d) => h('div', `${d.name}: ${recipeText(d.recipe)}`)),
    );
    this.ov.body.append(this.line, h('div.cup-area', this.cup, h('div', { style: 'display:grid;gap:10px' }, this.buttons, this.actions)), this.feedback, this.book);
    this.renderButtons();
    this.next();
  }

  private renderButtons(): void {
    this.buttons.replaceChildren(
      ...INGREDIENTS.map((ing) =>
        h(
          'button',
          { type: 'button', onclick: () => this.add(ing.id) },
          h('span.dot', { style: { background: ing.color } }),
          ing.name,
          h('span.n', this.made[ing.id] ? `×${this.made[ing.id]}` : ''),
        ),
      ),
    );
    this.cup.replaceChildren(
      ...INGREDIENTS.filter((i) => this.made[i.id]).flatMap((i) => Array.from({ length: this.made[i.id]! }, () => h('i', { style: { background: i.color, height: `${i.id === 'water' || i.id === 'milk' ? 34 : 16}px` } }))),
    );
  }

  private add(id: Ingredient, n = 1): void {
    this.made[id] = Math.min(3, (this.made[id] ?? 0) + n);
    this.env.sfx.pop();
    this.renderButtons();
  }

  private next(): void {
    if (this.n >= ORDERS) return this.finish();
    const level = this.env.store.level('karak');
    this.drink = pickDrink(this.env.rng, level);
    this.made = {};
    this.started = performance.now();
    const c = makePasserby(this.env.rng, `k${this.n}`);
    const text = this.env.rng.pick([`واحد ${this.drink.name} لو سمحت.`, `عطني ${this.drink.name} الله يخليك.`, `${this.drink.name} واحد، بسرعة إذا ممكن.`]);
    this.line.replaceChildren(h('span.from', `${c.name} — طلب ${this.n + 1} من ${ORDERS}`), text);
    this.env.speak(text, c.gender, c.key, c.voice.pitch);
    this.ov.stat.textContent = `${this.n + 1}/${ORDERS}`;
    this.feedback.className = 'feedback';
    this.feedback.textContent = 'حضّر الطلب من الدفتر، وبعدين قدّمه.';
    const mic = voiceButton(this.env, (t) => this.fromVoice(t));
    this.actions.replaceChildren(
      h('button.btn.warm', { type: 'button', onclick: () => this.serve() }, 'قدّم الكوب ☕'),
      h('button.btn.secondary', { type: 'button', onclick: () => ((this.made = {}), this.renderButtons()) }, 'كبّ وابدأ من جديد'),
      mic,
    );
    this.renderButtons();
  }

  /** «حليب وسكر زيادة وهيل» → milk + sugar×2 + cardamom. */
  private fromVoice(text: string): void {
    const norm = ' ' + normalizeArabic(text) + ' ';
    let any = false;
    for (const ing of INGREDIENTS) {
      for (const p of ing.phrases) {
        const k = normalizeArabic(p);
        const re = new RegExp(`[ و]${k}( زياده| مرتين)?(?= )`);
        const m = norm.match(re);
        if (m) {
          this.add(ing.id, m[1] ? 2 : 1);
          any = true;
          break;
        }
      }
    }
    if (/قدم|جاهز|خلص|تفضل/.test(norm)) return this.serve();
    if (!any) this.feedback.textContent = 'ما فهمت أي مكوّن. قول مثلاً: «شاي، حليب، سكر».';
  }

  private serve(): void {
    const errors = recipeErrors(this.made, this.drink.recipe);
    const seconds = (performance.now() - this.started) / 1000;
    const base = Math.round(this.env.store.payFor('karak', job('karak').pay) / ORDERS);
    const r = cupPay(base, errors, seconds, this.env.store.tipFactor());
    if (r.verdict === 'perfect') {
      this.perfect++;
      this.env.sfx.success();
      this.feedback.className = 'feedback good';
      this.feedback.textContent = `الله الله! كرك مضبوط. ${formatMoney(r.wage)}${r.tip ? ` + بقشيش ${formatMoney(r.tip)}` : ''}`;
      this.env.store.gainXp('karak', 10);
    } else if (r.verdict === 'ok') {
      this.feedback.className = 'feedback';
      this.feedback.textContent = `قريب، بس مب مثل ما طلب. الصح: ${recipeText(this.drink.recipe)}. نص الأجر: ${formatMoney(r.wage)}`;
      this.env.store.gainXp('karak', 4);
    } else {
      this.env.sfx.fail();
      this.feedback.className = 'feedback bad';
      this.feedback.textContent = `الزبون رجّع الكوب! الصح: ${recipeText(this.drink.recipe)}`;
    }
    if (r.wage + r.tip > 0) this.env.pay(r.wage + r.tip, 'كرك الفريج');
    this.n++;
    this.env.store.bump('cupsMade');
    this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.next() }, this.n >= ORDERS ? 'خلصت الوردية' : 'الطلب اللي بعده'));
  }

  private finish(): void {
    this.env.store.finishJob('karak');
    this.line.replaceChildren(h('span.from', 'أبو خالد'), `يعطيك العافية! سويت ${this.n} أكواب، ${this.perfect} منها مضبوطة مية بالمية.`);
    this.env.speak('يعطيك العافية، صرت كركجي محترف!', 'm', 'karak');
    this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.ov.close() }, 'تمام'));
  }
}
