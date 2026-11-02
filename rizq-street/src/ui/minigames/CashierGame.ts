/**
 * Behind the till at Al Noor grocery: five customers. Ring up the total (keypad or
 * voice), take their note, and count the change back from the drawer.
 */
import { denomination, item, job } from '../../game/catalog';
import { customerPay, describeOrder, DRAWER, makeOrder, sumCounted, type CashierOrder } from '../../game/jobs/cashier';
import { formatMoney, formatNumber, parseNumbers } from '../../lang/arabic';
import { makePasserby, type Passerby } from '../../dialogue/pedestrians';
import { h } from '../dom';
import { Overlay, voiceButton, type MiniEnv } from './Overlay';

const CUSTOMERS = 5;

export class CashierGame {
  readonly ov: Overlay;
  private served = 0;
  private perfect = 0;
  private earned = 0;
  private order!: CashierOrder;
  private typed = '';
  private counted: number[] = [];
  private mistakes = 0;
  private started = 0;
  private readonly lcd = h('div.lcd');
  private readonly line = h('div.speech');
  private readonly receipt = h('div.receipt');
  private readonly feedback = h('div.feedback');
  private readonly right = h('div', { style: 'display:grid;gap:10px' });
  private customer!: Passerby;

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    private readonly onDone: (served: number, perfect: number) => void,
  ) {
    this.ov = new Overlay(parent, 'الكاشير — بقالة النور', 'رحيم: «احسب زين ورجّع الباقي صح، الزبون أمانة»');
    this.ov.onClose = () => this.onDone(this.served, this.perfect);
    this.ov.body.append(this.line, h('div.till', h('div', { style: 'display:grid;gap:10px' }, this.receipt, this.feedback), this.right));
    this.next();
  }

  private level(): number {
    return this.env.store.level('cashier');
  }

  private next(): void {
    if (this.served >= CUSTOMERS) return this.finish();
    this.order = makeOrder(this.env.rng, this.level());
    this.customer = makePasserby(this.env.rng, `cust${this.served}`);
    this.typed = '';
    this.counted = [];
    this.mistakes = 0;
    this.started = performance.now();
    this.ov.stat.textContent = `${this.served + 1}/${CUSTOMERS}`;
    const greet = this.customer.gender === 'm' ? 'السلام عليكم، ' : 'مرحبا، ';
    const text = `${greet}أبي ${describeOrder(this.order.lines)} لو سمحت.`;
    this.line.replaceChildren(h('span.from', `${this.customer.name} — زبون`), text);
    this.env.speak(text, this.customer.gender, this.customer.key, this.customer.voice.pitch);
    this.receipt.replaceChildren(
      h('b', 'الفاتورة'),
      ...this.order.lines.map((l) => h('div.r', h('span', `${item(l.item).icon} ${l.qty === 1 ? '' : `${l.qty} `}${item(l.item).name}`), h('span.muted', `${formatMoney(item(l.item).price)} للحبة`))),
      h('div.muted', 'الأسعار مكتوبة على الرف. اجمعها وأدخل المجموع.'),
    );
    this.feedback.className = 'feedback';
    this.feedback.textContent = 'كم الحساب؟';
    this.renderTotal();
  }

  private renderTotal(): void {
    this.lcd.textContent = this.typed || '0';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) =>
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            this.env.sfx.click();
            if (k === '⌫') this.typed = this.typed.slice(0, -1);
            else if (k === '✓') return this.checkTotal(Number(this.typed || 0));
            else if (this.typed.length < 5) this.typed += k;
            this.lcd.textContent = this.typed || '0';
          },
        },
        k,
      ),
    );
    const mic = voiceButton(
      this.env,
      (t) => {
        const n = parseNumbers(t);
        if (n.length) this.checkTotal(n[n.length - 1]);
        else this.say('ما فهمت الرقم، قوله مرة ثانية.', false);
      },
      (i) => (this.lcd.textContent = i),
    );
    this.right.replaceChildren(this.lcd, h('div.keypad', ...keys), h('div.row', mic, h('span.muted', 'أو قول المجموع بصوتك: «خمسة وعشرين»')));
  }

  private checkTotal(n: number): void {
    if (n === this.order.total) {
      this.env.sfx.register();
      const note = this.order.paidWith;
      const text = this.order.change === 0 ? `تفضل، ${formatMoney(note)} بالضبط.` : `تفضل، هذي ${formatMoney(note)}.`;
      this.say(`صح! الحساب ${formatMoney(this.order.total)}. ${text}`, true);
      this.env.speak(text, this.customer.gender, this.customer.key, this.customer.voice.pitch);
      if (this.order.change === 0) return this.settle(true);
      this.renderChange();
    } else {
      this.env.sfx.fail();
      this.mistakes++;
      this.typed = '';
      this.lcd.textContent = '0';
      if (this.mistakes >= 2) {
        this.say(`الزبون صحح لك: الحساب ${formatMoney(this.order.total)}. انتبه المرة الجاية.`, false);
          setTimeout(() => (this.order.change === 0 ? this.settle(false) : this.renderChange()), 1200);
      } else this.say('الحساب غلط، راجع الأسعار مرة ثانية.', false);
    }
  }

  private renderChange(): void {
    const countedEl = h('div.counted');
    const total = h('div.lcd');
    const refresh = () => {
      countedEl.replaceChildren(...this.counted.map((v) => h(`span.mini-note${v === 1 ? '.coin' : ''}`, { style: { background: denomination(v).color } }, v === 1 ? '' : String(v))));
      total.textContent = `${formatNumber(sumCounted(this.counted))} / ?`;
    };
    const drawer = h(
      'div.drawer',
      ...DRAWER.map((v) =>
        h(
          `button${v === 1 ? '.coin' : ''}`,
          {
            type: 'button',
            style: { background: denomination(v).color },
            onclick: () => {
              this.counted.push(v);
              v === 1 ? this.env.sfx.coin() : this.env.sfx.note();
              refresh();
            },
          },
          String(v),
        ),
      ),
    );
    const mic = voiceButton(this.env, (t) => {
      const n = parseNumbers(t);
      if (!n.length) return this.say('ما فهمت المبلغ.', false);
      // Speaking the amount counts it out automatically, largest notes first.
      let rest = Math.round(n[n.length - 1]);
      this.counted = [];
      for (const v of DRAWER) while (rest >= v) (this.counted.push(v), (rest -= v));
      refresh();
    });
    const done = h('button.btn', { type: 'button', onclick: () => this.settle(sumCounted(this.counted) === this.order.change) }, 'سلّم الباقي');
    const undo = h('button.btn.secondary', { type: 'button', onclick: () => (this.counted.pop(), refresh()) }, 'تراجع');
    this.right.replaceChildren(h('b', `الزبون دفع ${formatMoney(this.order.paidWith)}، رجّع له الباقي:`), drawer, total, countedEl, h('div.row', done, undo, mic));
    refresh();
  }

  private settle(correct: boolean): void {
    const seconds = (performance.now() - this.started) / 1000;
    const clean = correct && this.mistakes === 0;
    const base = Math.round(this.env.store.payFor('cashier', job('cashier').pay) / CUSTOMERS);
    const { wage, tip } = customerPay(base, correct, seconds, this.env.store.tipFactor());
    if (correct) {
      this.say(clean ? `ممتاز! أجرك ${formatMoney(wage)}${tip ? ` والبقشيش ${formatMoney(tip)}` : ''}.` : `الباقي صح. أجرك ${formatMoney(wage)}.`, true);
      if (wage + tip > 0) this.env.pay(wage + tip, tip ? 'كاشير + بقشيش' : 'كاشير');
      this.earned += wage + tip;
      this.env.store.gainXp('cashier', clean ? 14 : 8);
      if (clean) this.perfect++;
    } else {
      this.say(`الباقي غلط! كان المفروض ${formatMoney(this.order.change)}. رحيم ما بيحسب لك هالزبون.`, false);
      this.env.store.rep(-1);
      this.env.sfx.fail();
    }
    this.served++;
    this.env.store.bump('customersServed');
    this.right.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.next() }, this.served >= CUSTOMERS ? 'خلصت الوردية' : 'الزبون اللي بعده'));
  }

  private say(text: string, good: boolean): void {
    this.feedback.className = `feedback ${good ? 'good' : 'bad'}`;
    this.feedback.textContent = text;
  }

  private finish(): void {
    this.env.store.finishJob('cashier');
    this.line.replaceChildren(h('span.from', 'رحيم'), `يعطيك العافية! خدمت ${this.served} زباين، ${this.perfect} منهم بدون ولا غلطة. مجموع اللي طلعته ${formatMoney(this.earned)}.`);
    this.env.speak('يعطيك العافية، شغلك زين!', 'm', 'grocer');
    this.receipt.replaceChildren();
    this.feedback.textContent = '';
    this.right.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.ov.close() }, 'تمام'));
  }
}
