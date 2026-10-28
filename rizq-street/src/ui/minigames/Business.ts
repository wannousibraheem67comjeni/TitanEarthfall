/**
 * Business with Abu Rashid and the street's job board: a trading deal (bargain with
 * the supplier, choose how much to buy, sell to the shops, split the profit), his
 * partnerships that pay a share every morning, and «لوحة الوظائف», every way to earn
 * with what fits the player right now.
 */
import { COMPANY_RANKS, DEALS, JOBS, job, type JobId } from '../../game/catalog';
import { fittingJobs, roundPay } from '../../dialogue/guide';
import { fillTemplate, formatMoney } from '../../lang/arabic';
import { PLACE_BY_ID } from '../../world/layout';
import { h } from '../dom';
import { shiftResult } from './Choices';
import { Overlay, type MiniEnv } from './Overlay';

const GOODS = [
  { name: 'كرتون عصير', cost: 20, market: [26, 31] },
  { name: 'كيس رز ١٠ كيلو', cost: 35, market: [41, 48] },
  { name: 'كرتون مناديل', cost: 12, market: [15, 18] },
  { name: 'صندوق تمر', cost: 40, market: [49, 58] },
  { name: 'كرتون ماي', cost: 9, market: [11, 14] },
];

export class TradeGame {
  readonly ov: Overlay;
  private readonly screen = h('div.work');
  private share = 0;
  private readonly log: string[] = [];

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    onDone: () => void,
  ) {
    this.ov = new Overlay(parent, 'صفقة مع أبو راشد', 'أبو راشد: «اشترِ رخيص، وبِع بسعر السوق»');
    this.ov.onClose = onDone;
    this.ov.body.append(this.screen);
    this.round(this.env.rng.shuffle(GOODS).slice(0, 2), 0);
  }

  private say(who: string, line: string, voice?: { g: 'm' | 'f'; key: string; pitch: number }): HTMLElement {
    if (voice) this.env.speak(line, voice.g, voice.key, voice.pitch);
    return h('div.speech', h('span.from', who), line);
  }

  private round(goods: typeof GOODS, k: number): void {
    const env = this.env;
    if (k >= goods.length) return this.finish();
    const g = goods[k];
    this.ov.stat.textContent = `بضاعة ${k + 1}/${goods.length}`;
    const offers = [
      { label: `أقبل بـ${g.cost}`, cut: 0, chance: 1 },
      { label: 'أطلب خصم ١٠٪', cut: 0.1, chance: 0.85 },
      { label: 'أطلب خصم ٢٥٪', cut: 0.25, chance: 0.45 },
      { label: 'أطلب نص السعر', cut: 0.5, chance: 0 },
    ];
    const grid = h('div.choice-grid');
    for (const o of offers)
      grid.append(
        h('button', { type: 'button', onclick: () => {
          const ok = env.rng.chance(o.chance);
          const price = ok ? Math.round(g.cost * (1 - o.cut)) : g.cost;
          const line = o.cut === 0 ? 'تمام، اتفقنا.' : ok ? `ماشي، عشانك بـ${price}.` : o.cut >= 0.5 ? 'لا لا، هذا ظلم! خذها بسعرها أو اتركها.' : `ما أقدر، آخر سعر ${g.cost}.`;
          ok && o.cut ? env.sfx.success() : o.cut ? env.sfx.fail() : env.sfx.click();
          this.quantity(goods, k, price, line);
        } }, o.label),
      );
    this.screen.replaceChildren(this.say('المورد', `${g.name} عندي بـ${g.cost} درهم للحبة.`, { g: 'm', key: 'supplier', pitch: 0.92 }), h('div.muted', 'فاصل بذكاء: الخصم الزين يزيد الربح، بس الطمع يخرب الصفقة.'), grid);
  }

  private quantity(goods: typeof GOODS, k: number, price: number, line: string): void {
    const env = this.env;
    const g = goods[k];
    const grid = h('div.choice-grid');
    for (const q of [10, 20, 40])
      grid.append(
        h('button', { type: 'button', onclick: () => {
          const demand = env.rng.int(12, 32);
          const market = env.rng.int(g.market[0], g.market[1]);
          const sold = Math.min(q, demand);
          const left = q - sold;
          const profit = sold * market + Math.round(left * g.cost * 0.85) - q * price;
          const share = Math.round(profit / 2);
          this.share += share;
          this.log.push(`${g.name}: اشتريت ${q} بـ${price}، بعت ${sold} بـ${market}${left ? ` ورجعت ${left}` : ''}. ${profit >= 0 ? `الربح ${profit}، نصيبك ${share}` : `خسارة ${-profit}`}.`);
          profit > 0 ? env.sfx.register() : env.sfx.fail();
          const result = h('div.feedback', { class: profit >= 0 ? 'good' : 'bad' }, this.log[this.log.length - 1]);
          this.screen.replaceChildren(this.say('أبو راشد', profit > 0 ? 'ما شاء الله، صفقة زينة!' : 'التجارة ربح وخسارة، المهم نتعلم.', { g: 'm', key: 'partner', pitch: 0.88 }), result, h('div.row', h('button.btn', { type: 'button', onclick: () => this.round(goods, k + 1) }, k + 1 < goods.length ? 'البضاعة اللي بعدها' : 'نحسب')));
        } }, `${q} حبة (${formatMoney(q * price)})`),
      );
    this.screen.replaceChildren(this.say('المورد', line), h('div.muted', `السعر ${price}. المحلات بالفريج تشتري تقريباً ${g.market[0]}–${g.market[1]} للحبة، بس ما ندري كم يطلبون. اللي ما ينباع نرجعه بخسارة شوي.`), h('div.question', 'كم تشتري؟'), grid);
  }

  private finish(): void {
    const env = this.env;
    const pay = Math.max(0, this.share);
    env.store.finishJob('trade');
    env.store.gainXp('trade', 8 + Math.min(20, Math.round(pay / 5)));
    if (pay > 0) env.pay(pay, 'نصيبك من صفقة أبو راشد');
    this.ov.stat.textContent = 'الحساب';
    shiftResult(this.screen, `${this.log.join(' ')} المجموع لك: ${formatMoney(pay)}.`, pay > 0, () => this.ov.close());
  }
}

export class DealsBoard {
  readonly ov: Overlay;

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
  ) {
    this.ov = new Overlay(parent, 'شراكات أبو راشد', 'تحط فلوس، وكل صباح ينزل نصيبك بالبنك');
    this.render();
  }

  private render(): void {
    const s = this.env.store.s;
    this.ov.stat.textContent = formatMoney(s.wallet);
    const active = s.investments;
    this.ov.body.replaceChildren(
      h('div.muted', 'تنبيه: بالحياة الحقيقية كل استثمار فيه مخاطرة. لا تحط فلوس تحتاجها، ونوّع ولا تحط كل شي بمكان واحد.'),
      ...DEALS.map((d) => {
        const on = active.find((a) => a.id === d.id);
        return h(
          'div.deal',
          h('span.icon', d.icon),
          h('div.grow', h('b', d.name), h('div.muted', d.pitch), h('div', `تحط ${formatMoney(d.cost)} ← ترجع لك ${formatMoney(d.perDay * d.days)} (ربح ${formatMoney(d.perDay * d.days - d.cost)})`)),
          on ? h('span.chip-ok', `شغالة · باقي ${on.daysLeft} يوم`) : h('button.btn', { type: 'button', onclick: () => this.invest(d.id) }, 'استثمر'),
        );
      }),
    );
  }

  private invest(id: string): void {
    const env = this.env;
    const d = DEALS.find((x) => x.id === id)!;
    const r = env.store.invest(id);
    if (r === 'ok') {
      env.sfx.register();
      env.toast(`🤝 صرت شريك بـ${d.name}! كل صباح ينزل لك ${formatMoney(d.perDay)} بالبنك.`, 'good');
      env.speak('مبروك يا شريك! بكرة الصبح أول أرباحك.', 'm', 'partner', 0.88);
    } else if (r === 'poor') {
      env.sfx.fail();
      const s = env.store.s;
      env.toast(s.wallet + s.bank >= d.cost ? 'فلوسك بالبنك. اسحبها من الصراف أول وتعال.' : `باقي لك ${formatMoney(d.cost - s.wallet - s.bank)}. اشتغل شوي وارجع.`, 'bad');
    }
    this.render();
  }
}

type Group = { title: string; ids: JobId[] };

export class JobBoard {
  readonly ov: Overlay;

  constructor(
    parent: HTMLElement,
    env: MiniEnv,
    private readonly go: (id: JobId) => void,
    private readonly invest: () => void,
  ) {
    const st = env.store;
    const rank = st.s.flags.companyHired ? `رتبتك بالشركة: ${COMPANY_RANKS[st.companyRank].title}` : 'الشركة: تبدأ بمقابلة';
    this.ov = new Overlay(parent, 'لوحة الوظائف 📋', `كل الشغل بالفريج، واللي على قدك الحين فوق · ${rank}`, { wide: true });
    const groups: Group[] = [
      { title: '⭐ أحسن شغل لك الحين', ids: fittingJobs(st).slice(0, 3) },
      { title: '🏠 بالبيت (أمك وأبوك)', ids: JOBS.filter((j) => j.family).map((j) => j.id) },
      { title: '🏪 بالشارع والمحلات', ids: JOBS.filter((j) => !j.family && !j.company && j.id !== 'online' && j.id !== 'trade').map((j) => j.id) },
      { title: '🏢 الشركة', ids: JOBS.filter((j) => j.company).map((j) => j.id) },
      { title: '💻 أونلاين وتجارة', ids: ['online', 'trade'] },
    ];
    const fill = (t: string) => fillTemplate(t, st.s.player.gender, { name: st.s.player.name });
    const row = (id: JobId) => {
      const def = job(id);
      const b = st.jobBlock(id);
      const where = PLACE_BY_ID.get(def.place)?.name ?? '';
      const chip = b === null ? (def.company && !st.s.flags.companyHired ? h('span.tag.wait', '📝 مقابلة أول') : h('span.tag.ok', '✓ على قدك الحين')) : b === 'closed' ? h('span.tag.wait', `🕗 يفتح الساعة ${def.hours[0] % 12 || 12}`) : b === 'done' ? h('span.tag.done', '✔ خلصته اليوم') : h('span.tag.lock', '🔒 ' + fill(st.lockText(id)));
      return h('div.gig', h('div.grow', h('b', def.title), h('div.muted', `${where} — ${def.summary}`), chip), h('div.pay', `~${formatMoney(roundPay(st, id))}`), h('button.btn', { type: 'button', disabled: b === 'done' || b === 'locked', onclick: () => (this.ov.close(), this.go(id)) }, 'ودّني'));
    };
    const rank0 = (id: JobId) => (st.jobBlock(id) === null ? 0 : st.jobBlock(id) === 'closed' ? 1 : 2);
    this.ov.body.append(
      ...groups.flatMap((g) => [h('h3.board-head', g.title), ...[...g.ids].sort((a, b) => rank0(a) - rank0(b) || roundPay(st, b) - roundPay(st, a)).map(row)]),
      h('h3.board-head', '🤝 استثمار'),
      h('div.gig', h('div.grow', h('b', 'شراكات أبو راشد'), h('div.muted', 'عربة كرك، متجر أونلاين، شاحنة توزيع: دخل كل يوم')), h('button.btn', { type: 'button', onclick: () => (this.ov.close(), this.invest()) }, 'ودّني')),
    );
  }
}
