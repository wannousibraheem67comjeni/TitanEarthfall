/**
 * The bill that pops up when a customer has put everything on the counter: who it
 * is and what they say, the goods with their prices, the total, what they hand over
 * (a banknote you can look at closely), and what accepting would earn or lose. Two
 * buttons decide; a bar shows how long they will wait.
 */
import { acceptGain, fmt, STAGES, stocked, type Bill } from '../game/economy';
import type { Persona } from '../game/customers';
import { h } from './dom';

const NOTE_COLORS: Record<number, string> = { 1: '#c9cdd2', 5: '#b07a3e', 10: '#3f9150', 20: '#3f86b8', 50: '#7a5aa6', 100: '#c2453c', 200: '#8c9a3a', 500: '#2c4f8a', 1000: '#4f7f73' };

/** A drawn banknote; fake ones lack the silver thread, look washed out and misspell "درهم". */
export function banknote(value: number, fake = false): HTMLElement {
  const color = NOTE_COLORS[value] ?? NOTE_COLORS[1000];
  return h(`span.banknote${fake ? '.fake' : ''}`, { style: { background: color } }, h('b', value.toLocaleString('en-US')), h('small', fake ? 'درهن' : 'درهم'), fake ? null : h('i.thread'));
}

let counter = 100;

export class InvoicePanel {
  readonly el = h('div.bill');
  private readonly patience = h('i');
  private decide: ((accept: boolean) => void) | null = null;
  onPrices: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el.hidden = true;
    parent.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden || !this.decide) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Enter' || e.code === 'KeyA') {
        e.preventDefault();
        this.choose(true);
      } else if (e.code === 'Backspace' || e.code === 'Delete' || e.code === 'KeyR') {
        e.preventDefault();
        this.choose(false);
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(p: Persona, bill: Bill, line: string, keeperName: string, stage: number, onDecide: (accept: boolean) => void): void {
    this.decide = onDecide;
    const rows = bill.lines.map((l) => {
      const claimed = bill.claim && bill.claim.product.id === l.product.id;
      return h(
        'tr',
        { class: claimed ? 'claim' : '' },
        h('td', h('span.ico', l.product.icon), ' ', l.product.name, claimed ? h('small.said', `يقول ${fmt(bill.claim!.said)}`) : null),
        h('td.n', `${l.qty} × ${fmt(l.product.price)}`),
        h('td.n', fmt(l.product.price * l.qty)),
      );
    });
    const gain = acceptGain(bill);
    const extra: (HTMLElement | null)[] = [];
    if (bill.claim) extra.push(h('div.warn', `⚠️ ${p.gender === 'f' ? 'الزبونة تقول' : 'الزبون يقول'} ${bill.claim.product.name} بـ${fmt(bill.claim.said)}، وسعره عندك ${fmt(bill.claim.product.price)}.`));
    if (bill.discount) extra.push(h('div.r-row', h('span', `خصم ${bill.discount}٪ يطلبه الزبون`), h('b', `−${fmt(bill.total - bill.pays)}`)));
    if (bill.coupon) extra.push(h('div.coupon', h('b', `🎟️ كوبون خصم ${bill.coupon.pct}٪`), h('span', `صالح لين: ${bill.coupon.expired}`)));
    if (bill.kind === 'credit') extra.push(h('div.r-row', h('span', 'سمعة الزبون بالدفع'), h('b.stars', '★'.repeat(Math.max(1, Math.round(p.trust * 5))) + '☆'.repeat(5 - Math.max(1, Math.round(p.trust * 5))))));
    const pays =
      bill.kind === 'credit'
        ? h('div.r-pay', h('span', 'يدفع'), h('b', 'دين — يسدد بعدين'))
        : bill.kind === 'repay'
          ? h('div.r-pay', h('span', 'يسدد دينه'), banknote(nearestNote(bill.debt ?? 0)), h('b', fmt(bill.debt ?? 0)))
          : h(
              'div.r-pay',
              h('span', 'يدفع'),
              // Say the amount whenever it is not the total, so the gap is plain to see.
              bill.pays !== bill.total ? h('b.less', fmt(bill.pays)) : null,
              banknote(bill.note, bill.kind === 'fake'),
              bill.note > bill.pays ? h('small', `الباقي ${fmt(bill.note - bill.pays)}`) : null,
            );
    const profit =
      bill.kind === 'repay'
        ? h('div.r-profit.good', `يرجع لك ${fmt(bill.debt ?? 0)}`)
        : bill.kind === 'credit'
          ? h('div.r-profit.bad', `الحين تخسر البضاعة (${fmt(bill.cost)})، ويرجع لك ${fmt(bill.total)} إذا سدّد`)
          : bill.kind === 'fake'
            ? h('div.r-profit.good', `إذا قبلت: ربحك ${fmt(bill.pays - bill.cost)}`)
            : h(`div.r-profit.${gain >= 0 ? 'good' : 'bad'}`, gain >= 0 ? `إذا قبلت: ربحك ${fmt(gain)}` : `إذا قبلت: تخسر ${fmt(-gain)}`);
    const accept = h('button.accept', { type: 'button', onclick: () => this.choose(true) }, bill.kind === 'repay' ? '✅ استلم' : '✅ قبول');
    const reject = h('button.reject', { type: 'button', onclick: () => this.choose(false) }, '❌ رفض');
    this.el.replaceChildren(
      h('div.bill-head', h('span.face', p.child ? '🧒' : p.gender === 'f' ? '🧕' : '👳'), h('b', p.name), h('span.muted', `فاتورة #${counter++}`), h('button.link', { type: 'button', title: 'قائمة الأسعار', onclick: () => this.onPrices?.() }, '📋 الأسعار')),
      h('div.bill-say', `«${line}»`),
      h(
        'div.receipt',
        h('div.r-title', STAGES[stage].sign, h('small', ` — المحاسب: ${keeperName}`)),
        bill.lines.length && bill.kind !== 'repay' ? h('table', ...rows) : null,
        bill.kind !== 'repay' ? h('div.r-row.total', h('span', 'المجموع'), h('b', fmt(bill.total))) : null,
        ...extra,
        pays,
        profit,
      ),
      h('div.patience', this.patience),
      h('div.bill-actions', accept, bill.kind === 'repay' ? null : reject),
    );
    this.el.hidden = false;
    this.el.classList.remove('leaving');
    this.setPatience(1);
  }

  setPatience(frac: number): void {
    this.patience.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.patience.classList.toggle('low', frac < 0.3);
  }

  private choose(accept: boolean): void {
    const d = this.decide;
    if (!d) return;
    this.decide = null;
    this.hide();
    d(accept);
  }

  /** The customer gave up waiting. */
  timeout(): void {
    this.decide = null;
    this.hide();
  }

  hide(): void {
    this.el.hidden = true;
  }
}

function nearestNote(amount: number): number {
  for (const n of [5, 10, 20, 50, 100, 200, 500, 1000]) if (n >= amount) return n;
  return 1000;
}

/** The price list for this stage: what each thing sells for, and what it costs you. */
export function priceList(stage: number): HTMLElement {
  return h(
    'div.prices',
    h('div.muted', 'السعر = اللي يدفعه الزبون. الجملة = اللي تدفعه أنت للمورد. الفرق ربحك.'),
    h(
      'table',
      h('tr', h('th', 'الغرض'), h('th', 'السعر'), h('th', 'الجملة')),
      ...stocked(stage).map((p) => h('tr', h('td', h('span.ico', p.icon), ' ', p.name), h('td.n', fmt(p.price)), h('td.n.muted', fmt(p.cost)))),
    ),
  );
}
