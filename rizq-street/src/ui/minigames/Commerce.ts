/** Buying things: the grocery shelves and wholesale packs, the electronics shop, the ATM. */
import { GROCERY_ITEMS, STALL_ITEMS, UPGRADES, type UpgradeId } from '../../game/catalog';
import { capacity } from '../../game/jobs/stall';
import { formatMoney, formatNumber } from '../../lang/arabic';
import { h } from '../dom';
import { Overlay, type MiniEnv } from './Overlay';

function upgradeTile(env: MiniEnv, id: UpgradeId, refresh: () => void): HTMLElement {
  const u = UPGRADES.find((x) => x.id === id)!;
  const owned = env.store.has(id);
  const afford = env.store.s.wallet >= u.price;
  return h(
    'div.tile',
    h('div.title', h('span.ico', u.icon), h('span.grow', u.name), h('b', formatMoney(u.price))),
    h('div.muted', u.effect),
    owned
      ? h('span.pill.done', 'عندك ✓')
      : h(
          'button.btn',
          {
            type: 'button',
            disabled: !afford,
            onclick: () => {
              if (env.store.buy(id) === 'ok') env.sfx.register();
              refresh();
            },
          },
          afford ? 'اشترِ نقداً' : `ينقصك ${formatMoney(u.price - env.store.s.wallet)}`,
        ),
  );
}

export class GroceryShop {
  readonly ov: Overlay;

  constructor(parent: HTMLElement, private readonly env: MiniEnv) {
    this.ov = new Overlay(parent, 'رفوف بقالة النور', 'رحيم: «تفضل، كل شي طازج»');
    this.render();
  }

  private render(): void {
    const env = this.env;
    const s = env.store.s;
    this.ov.stat.textContent = formatMoney(s.wallet);
    const errand = s.errand ? h('div.feedback', `قائمة أمك: ${s.errand.items.map((i) => GROCERY_ITEMS.find((g) => g.id === i)!.name).join('، ')}`) : null;
    const retail = h(
      'div.stat-grid',
      ...GROCERY_ITEMS.map((it) =>
        h(
          'div.tile',
          h('div.title', h('span.ico', it.icon), h('span.grow', it.name), h('b', formatMoney(it.price))),
          h('div.muted', `عندك: ${env.store.count(it.id)}`),
          h(
            'button.btn.secondary',
            {
              type: 'button',
              disabled: s.wallet < it.price,
              onclick: () => {
                if (env.store.spend(it.price, `شراء ${it.name}`)) {
                  env.store.addItem(it.id);
                  env.sfx.coin();
                }
                this.render();
              },
            },
            'اشترِ واحد',
          ),
        ),
      ),
    );
    const cap = capacity(env.store.has('cooler'));
    const wholesale = env.store.has('stall')
      ? h(
          'div',
          { style: 'display:grid;gap:10px' },
          h('h3', { style: 'margin:0;font:400 22px var(--display)' }, 'جملة للبسطة'),
          h('div.muted', `البسطة تشيل ${cap} حبة من كل صنف${env.store.has('cooler') ? ' (مع الثلاجة)' : ''}.`),
          ...STALL_ITEMS.map((it) => {
            const w = it.wholesale!;
            const have = s.stallStock[it.id] ?? 0;
            const room = have + w.units <= cap;
            return h(
              'div.tile',
              h('div.title', h('span.ico', it.icon), h('span.grow', `${it.name} — كرتون ${w.units} حبة`), h('b', formatMoney(w.price))),
              h('div.muted', `بالبسطة: ${have} · بيعها بحوالي ${formatMoney(w.sellHint)} للحبة`),
              h(
                'button.btn',
                {
                  type: 'button',
                  disabled: s.wallet < w.price || !room,
                  onclick: () => {
                    if (env.store.spend(w.price, `جملة ${it.name}`)) {
                      s.stallStock[it.id] = have + w.units;
                      env.sfx.register();
                    }
                    this.render();
                  },
                },
                room ? 'اشترِ الكرتون' : 'البسطة مليانة',
              ),
            );
          }),
        )
      : null;
    this.ov.body.replaceChildren(
      ...[errand, retail, h('h3', { style: 'margin:0;font:400 22px var(--display)' }, 'معدات البيع'), upgradeTile(env, 'stall', () => this.render()), upgradeTile(env, 'cooler', () => this.render()), wholesale].filter((x): x is HTMLElement => !!x),
    );
  }
}

export class UpgradeShop {
  readonly ov: Overlay;

  constructor(parent: HTMLElement, env: MiniEnv, title = 'عالم الجوال', ids: UpgradeId[] = ['sneakers', 'bike', 'phone', 'laptop', 'scooter', 'shop']) {
    this.ov = new Overlay(parent, title, 'مازن: «استثمر بأدوات تزيد دخلك»');
    const render = () => {
      this.ov.stat.textContent = formatMoney(env.store.s.wallet);
      this.ov.body.replaceChildren(h('div.muted', 'تدفع نقداً من محفظتك. إذا فلوسك بالبنك اسحبها من الصراف أول.'), ...ids.map((id) => upgradeTile(env, id, render)));
    };
    render();
  }
}

export class Atm {
  readonly ov: Overlay;

  constructor(parent: HTMLElement, private readonly env: MiniEnv) {
    this.ov = new Overlay(parent, 'الصراف الآلي', 'بنك الفريج الوطني');
    this.render();
  }

  private render(): void {
    const env = this.env;
    const s = env.store.s;
    const amounts = (list: number[], max: number, fn: (n: number) => void, label: string) =>
      h(
        'div.row',
        ...list
          .filter((n) => n <= max)
          .map((n) => h('button.btn.secondary', { type: 'button', onclick: () => (fn(n), this.render()) }, formatNumber(n))),
        max > 0 ? h('button.btn', { type: 'button', onclick: () => (fn(max), this.render()) }, `${label} الكل (${formatNumber(max)})`) : h('span.muted', 'ما في رصيد'),
      );
    this.ov.body.replaceChildren(
      h('div.stat-grid', h('div.tile', h('span.muted', 'رصيدك بالبنك'), h('b', formatMoney(s.bank))), h('div.tile', h('span.muted', 'بمحفظتك'), h('b', formatMoney(s.wallet)))),
      h('b', 'سحب نقدي'),
      amounts(
        [20, 50, 100, 200, 500, 1000],
        s.bank,
        (n) => {
          if (env.store.withdraw(n)) env.sfx.note();
        },
        'اسحب',
      ),
      h('b', 'إيداع'),
      amounts(
        [50, 100, 500],
        s.wallet,
        (n) => {
          if (env.store.deposit(n)) env.sfx.click();
        },
        'أودع',
      ),
      h('div.muted', 'الفلوس اللي بالبنك تزيد 1% كل يوم (لين 100 درهم باليوم). جدك يقول: القرش الأبيض ينفع في اليوم الأسود.'),
    );
  }
}
