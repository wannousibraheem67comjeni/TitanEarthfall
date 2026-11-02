/**
 * Selling at your own stall by the park: set prices, then passers-by ask, haggle or
 * buy. Midday heat makes cold drinks sell for more; the cooler helps too.
 */
import { item, STALL_ITEMS, type ItemId } from '../../game/catalog';
import { heatFactor, react, willingness } from '../../game/jobs/stall';
import { formatMoney, normalizeArabic, parseNumbers, priceWith } from '../../lang/arabic';
import { analyze } from '../../lang/intents';
import { makePasserby, type Passerby } from '../../dialogue/pedestrians';
import { h } from '../dom';
import { Overlay, voiceButton, type MiniEnv } from './Overlay';

export class StallGame {
  readonly ov: Overlay;
  private readonly prices = new Map<ItemId, number>();
  private timer = 0;
  private selling = false;
  private sold = 0;
  private revenue = 0;
  private waiting: { c: Passerby; id: ItemId; offer: number; will: number } | null = null;
  private readonly log = h('div', { style: 'display:grid;gap:8px' });
  private readonly items = h('div.stall-items');
  private readonly actions = h('div.row');
  private readonly status = h('div.feedback');

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    private readonly onDone: (sold: number, revenue: number) => void,
  ) {
    this.ov = new Overlay(parent, 'بسطتك عند الحديقة', 'اشترِ بالجملة من بقالة النور، وبِع هني بالمفرد');
    this.ov.onClose = () => {
      clearTimeout(this.timer);
      if (this.sold) {
        this.env.store.finishJob('stall');
        this.env.store.gainXp('stall', 6 + this.sold * 2);
      }
      this.onDone(this.sold, this.revenue);
    };
    const cooler = env.store.has('cooler');
    for (const it of STALL_ITEMS) this.prices.set(it.id, it.wholesale!.sellHint + (cooler ? 1 : 0));
    this.ov.body.append(this.status, this.items, this.actions, this.log);
    this.renderItems();
    this.renderIdle();
  }

  private stock(id: ItemId): number {
    return this.env.store.s.stallStock[id] ?? 0;
  }

  private renderItems(): void {
    this.items.replaceChildren(
      ...STALL_ITEMS.map((it) => {
        const price = this.prices.get(it.id)!;
        const step = (d: number) => () => {
          this.prices.set(it.id, Math.max(1, Math.min(30, price + d)));
          this.env.sfx.click();
          this.renderItems();
        };
        return h(
          'div.stall-item',
          h('span', { style: 'font-size:28px' }, it.icon),
          h('div', h('b', it.name), h('div.muted', `عندك ${this.stock(it.id)} حبة · كلفتها ${Math.round((it.wholesale!.price / it.wholesale!.units) * 10) / 10} درهم`)),
          h('div.stepper', h('button', { type: 'button', onclick: step(-1) }, '−'), h('b', formatMoney(price)), h('button', { type: 'button', onclick: step(1) }, '+')),
        );
      }),
    );
  }

  private renderIdle(): void {
    const total = STALL_ITEMS.reduce((s, it) => s + this.stock(it.id), 0);
    const h24 = this.env.store.hour;
    this.status.className = 'feedback';
    this.status.textContent =
      total === 0
        ? 'البسطة فاضية! روح لرحيم بالبقالة واشترِ كرتون ماي أو علبة آيس كريم بالجملة.'
        : heatFactor(h24) > 1.2
          ? 'الشمس حارة: الناس عطشانين والماي البارد ينباع أغلى.'
          : 'حط أسعارك وابدأ البيع. السعر الغالي يطفّش الزباين.';
    this.actions.replaceChildren(h('button.btn.warm', { type: 'button', disabled: total === 0, onclick: () => this.start() }, 'ابدأ البيع'));
  }

  private start(): void {
    this.selling = true;
    this.actions.replaceChildren(h('button.btn.secondary', { type: 'button', onclick: () => this.stop() }, 'سكّر البسطة'));
    this.schedule(800);
  }

  private stop(): void {
    this.selling = false;
    clearTimeout(this.timer);
    this.waiting = null;
    this.status.className = 'feedback good';
    this.status.textContent = `بعت ${this.sold} حبة ودخلك ${formatMoney(this.revenue)}.`;
    this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.ov.close() }, 'تمام'));
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.customer(), ms);
  }

  private say(who: string, text: string, mine = false): void {
    this.log.prepend(h('div.speech', { style: mine ? 'background:#eef7f1' : '' }, h('span.from', who), text));
    while (this.log.children.length > 6) this.log.lastElementChild!.remove();
  }

  private customer(): void {
    if (!this.selling || this.ov.isClosed) return;
    const avail = STALL_ITEMS.filter((it) => this.stock(it.id) > 0);
    if (!avail.length) {
      this.say('البسطة', 'خلصت البضاعة! ارجع لرحيم واشترِ جملة جديدة.');
      return this.stop();
    }
    const hot = heatFactor(this.env.store.hour) > 1.2;
    const it = this.env.rng.weighted(avail, avail.map((x) => (hot && (x.id === 'water' || x.id === 'icecream') ? 3 : 1)));
    const c = makePasserby(this.env.rng, `s${Date.now()}`);
    const will = willingness(this.env.rng, it.id, this.env.store.hour, this.env.store.has('cooler'));
    const price = this.prices.get(it.id)!;
    const ask = `بكم ${it.name}؟`;
    this.say(c.name, ask);
    this.env.speak(ask, c.gender, c.key, c.voice.pitch);
    setTimeout(() => {
      if (!this.selling) return;
      this.say('أنت', `${priceWith(price)}.`, true);
      const r = react(price, will);
      if (r.kind === 'buy') return this.sell(c, it.id, price, this.env.rng.pick(['تمام، عطني واحد.', 'زين، خذ.', 'حلو، الله يبارك لك.']));
      if (r.kind === 'leave') {
        const t = this.env.rng.pick(['لا والله غالي، مع السلامة.', 'أوه! بالبقالة أرخص.', 'لا شكراً.']);
        this.say(c.name, t);
        this.env.speak(t, c.gender, c.key, c.voice.pitch);
        return this.schedule(this.env.rng.range(2500, 4500));
      }
      // Haggling: answer with the buttons or by voice ("اوكي" / "لا" / a new price).
      this.waiting = { c, id: it.id, offer: r.offer, will };
      const t = `غالي شوي… خلها ${priceWith(r.offer)}؟`;
      this.say(c.name, t);
      this.env.speak(t, c.gender, c.key, c.voice.pitch);
      this.actions.replaceChildren(
        h('button.btn', { type: 'button', onclick: () => this.answer(true) }, `موافق ${priceWith(r.offer)}`),
        h('button.btn.secondary', { type: 'button', onclick: () => this.answer(false) }, 'لا، سعري ثابت'),
        voiceButton(this.env, (text) => this.answerVoice(text)),
        h('button.btn.ghost', { type: 'button', onclick: () => this.stop() }, 'سكّر'),
      );
    }, 900);
  }

  private answerVoice(text: string): void {
    const a = analyze(text);
    const n = parseNumbers(text);
    if (n.length && this.waiting) {
      // A counter-offer: they accept anything at or under what they'd pay.
      const p = Math.round(n[n.length - 1]);
      const w = this.waiting;
      this.waiting = null;
      this.restoreActions();
      if (p <= w.will * 1.1) return this.sell(w.c, w.id, p, `ماشي، ${priceWith(p)}.`);
      this.say(w.c.name, 'لا، كثير. مع السلامة.');
      return this.schedule(3000);
    }
    if (a.has('decline') || normalizeArabic(text).includes('ثابت')) this.answer(false);
    else if (a.has('accept') || a.has('fine')) this.answer(true);
  }

  private answer(yes: boolean): void {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    this.restoreActions();
    this.say('أنت', yes ? `ماشي، ${priceWith(w.offer)}.` : 'السعر ثابت والله.', true);
    if (yes) return this.sell(w.c, w.id, w.offer, 'تسلم!');
    if (this.prices.get(w.id)! <= w.will * 1.15 && this.env.rng.chance(0.5)) return this.sell(w.c, w.id, this.prices.get(w.id)!, 'زين، بشتري.');
    this.say(w.c.name, 'خلاص، مع السلامة.');
    this.schedule(3000);
  }

  private restoreActions(): void {
    this.actions.replaceChildren(h('button.btn.secondary', { type: 'button', onclick: () => this.stop() }, 'سكّر البسطة'));
  }

  private sell(c: Passerby, id: ItemId, price: number, line: string): void {
    this.say(c.name, line);
    this.env.speak(line, c.gender, c.key, c.voice.pitch);
    this.env.store.s.stallStock[id] = this.stock(id) - 1;
    this.sold++;
    this.revenue += price;
    this.env.pay(price, `بيع ${item(id).name}`);
    this.env.store.bump('stallSales');
    this.renderItems();
    this.schedule(this.env.rng.range(2500, 5000));
  }
}
