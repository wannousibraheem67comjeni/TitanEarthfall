/**
 * The receipt on the desk: thermal paper from the till printer. The header prints at
 * once; each line prints as the customer names that item; the totals, the VAT note,
 * and how they pay (the banknote they put down, a card, the debt book, a coupon) print
 * when they get to it. Then the accept button below takes the payment.
 */
import { clockText, dayName } from '../game/clock';
import type { Persona } from '../game/customers';
import { fmt, PRODUCTS, STAGES, type Bill } from '../game/economy';
import { cashCanvas } from '../world/desk';
import { h } from './dom';

let counter = 1001;

export class Receipt {
  readonly el = h('div.receipt');
  private rows: HTMLElement[] = [];
  private foot: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.el.hidden = true;
    parent.append(this.el);
  }

  begin(bill: Bill, p: Persona, keeper: string, stage: number, day: number, minute: number): void {
    const head = h(
      'div.r-head',
      h('b', STAGES[stage].sign),
      h('small', 'فاتورة ضريبية مبسطة · TRN 100-245-873-900003'),
      h('div.r-meta', h('span', `رقم ${counter++}`), h('span', `${dayName(day)} ${clockText(minute)}`)),
      h('div.r-meta', h('span', `الكاشير: ${keeper}`), h('span', `الزبون: ${p.name}`)),
    );
    this.rows = bill.lines.map((l) => {
      const claimed = bill.claim && bill.claim.product.id === l.product.id;
      return h(
        'div.r-line',
        { hidden: true, class: claimed ? 'claim' : '' },
        h('span.nm', `${l.product.icon} ${l.product.name}`),
        h('span.q', `${l.qty} × ${l.product.price.toFixed(2)}`),
        h('span.v', (l.qty * l.product.price).toFixed(2)),
      );
    });
    this.foot = this.footer(bill);
    this.foot.hidden = true;
    this.el.replaceChildren(head, h('div.r-sep'), ...this.rows, this.foot, h('div.r-tear'));
    if (bill.kind === 'repay') this.rows = [];
    this.el.hidden = false;
    this.el.classList.remove('out');
  }

  private footer(b: Bill): HTMLElement {
    const vat = (b.total * 5) / 105;
    const parts: (HTMLElement | null)[] = [h('div.r-sep')];
    if (b.kind === 'repay') {
      parts.push(h('div.r-row.total', h('span', 'سداد دين'), h('b', (b.debt ?? 0).toFixed(2))), this.payment(b));
      return h('div.r-foot', ...parts);
    }
    parts.push(h('div.r-row.total', h('span', 'المجموع'), h('b', b.total.toFixed(2))), h('div.r-row.small', h('span', 'شامل ضريبة القيمة المضافة 5٪'), h('span', vat.toFixed(2))));
    if (b.discount) parts.push(h('div.r-row.warn', h('span', `يطلب خصم ${b.discount}٪`), h('span', `−${(b.total - b.pays).toFixed(2)}`)));
    if (b.coupon)
      parts.push(
        h(
          'div.coupon',
          h('b', `🎟️ كوبون خصم ${b.coupon.pct}٪`),
          h('span', `صالح لين: ${b.coupon.expired}`),
        ),
      );
    if (b.claim) parts.push(h('div.r-row.warn', h('span', `يقول ${b.claim.product.name} بـ${fmt(b.claim.said)}`), h('span', `السعر ${b.claim.product.price.toFixed(2)}`)));
    parts.push(this.payment(b));
    return h('div.r-foot', ...parts);
  }

  private payment(b: Bill): HTMLElement {
    if (b.kind === 'credit') return h('div.r-pay', h('span.how', '📒 على الحساب (دين)'), h('b.less', `0.00 من ${b.total.toFixed(2)}`));
    if (b.pay === 'card') return h('div.r-pay', h('span.how', '💳 بطاقة'), h('b', b.total.toFixed(2)));
    const note = h('canvas.note') as HTMLCanvasElement;
    const src = cashCanvas(b.note, b.kind === 'fake');
    note.width = src.width;
    note.height = src.height;
    note.getContext('2d')!.drawImage(src, 0, 0);
    const paid = b.kind === 'repay' ? b.debt ?? 0 : b.pays;
    const short = b.kind !== 'repay' && b.pays < b.total;
    return h(
      'div.r-pay',
      h('span.how', '💵 نقداً'),
      note,
      h('div.r-row', h('span', 'يدفع'), h(short ? 'b.less' : 'b', paid.toFixed(2))),
      b.note > paid ? h('div.r-row.small', h('span', `استلمت ${b.note.toFixed(2)}`), h('span', `الباقي ${(b.note - paid).toFixed(2)}`)) : null,
    );
  }

  /** Print line `i` (the customer just named it). */
  print(i: number): boolean {
    const r = this.rows[i];
    if (!r || !r.hidden) return false;
    r.hidden = false;
    r.classList.add('typing');
    this.el.scrollTop = this.el.scrollHeight;
    return true;
  }

  /** Print everything still missing, and the totals. */
  finish(): void {
    for (const r of this.rows) r.hidden = false;
    if (this.foot) this.foot.hidden = false;
    this.el.scrollTop = this.el.scrollHeight;
  }

  get printed(): number {
    return this.rows.filter((r) => !r.hidden).length;
  }

  hide(): void {
    this.el.classList.add('out');
    setTimeout(() => {
      if (this.el.classList.contains('out')) this.el.hidden = true;
    }, 450);
  }
}

/** The accept button, under the picture. */
export class DecisionBar {
  readonly el = h('div.decide');
  private readonly accept = h('button.accept', { type: 'button' }) as HTMLButtonElement;
  private readonly patience = h('i');
  private cb: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el.append(h('div.patience', this.patience), this.accept);
    this.el.hidden = true;
    parent.append(this.el);
    this.accept.onclick = () => this.choose();
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden || !this.cb || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Enter' || e.code === 'KeyA') {
        e.preventDefault();
        this.choose();
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(cb: () => void, label = '✅ قبول'): void {
    this.cb = cb;
    this.accept.textContent = label;
    this.el.hidden = false;
    this.setPatience(1);
  }

  setPatience(frac: number): void {
    this.patience.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.patience.classList.toggle('low', frac < 0.3);
  }

  private choose(): void {
    const cb = this.cb;
    if (!cb) return;
    this.cb = null;
    this.el.hidden = true;
    cb();
  }

  hide(): void {
    this.cb = null;
    this.el.hidden = true;
  }
}

/** The full price list, by stage, with the wholesale cost beside each price. */
export function priceList(stage: number): HTMLElement {
  const table = h('table', h('tr', h('th', 'الغرض'), h('th', 'السعر'), h('th', 'سعر الجملة')));
  for (const p of PRODUCTS.filter((x) => x.stage <= stage)) table.append(h('tr', h('td', `${p.icon} ${p.name}`), h('td.n', fmt(p.price)), h('td.n', fmt(p.cost))));
  return h('div.prices', h('p.muted', 'الأسعار شاملة الضريبة. ربحك = سعر البيع − سعر الجملة.'), table);
}
