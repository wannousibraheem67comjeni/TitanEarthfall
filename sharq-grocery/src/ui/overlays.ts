/** Cards over the shop: the start screen, how to play, the price list, celebrations. */
import { fmt, STAGES } from '../game/economy';
import type { Gender } from '../game/state';
import { h } from './dom';
import type { DaySummary } from '../game/state';
import { priceList } from './receipt';

export class Card {
  readonly root = h('div.overlay');
  readonly body = h('div.card-body');
  onClose: (() => void) | null = null;
  private closed = false;

  constructor(parent: HTMLElement, title: string, opts: { closable?: boolean; cls?: string } = {}) {
    const head = h('div.card-head', h('h2', title));
    if (opts.closable !== false) head.append(h('button.x', { type: 'button', title: 'إغلاق', onclick: () => this.close() }, '✕'));
    this.root.append(h(`div.card${opts.cls ? '.' + opts.cls : ''}`, head, this.body));
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root && opts.closable !== false) this.close();
    });
    parent.append(this.root);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.root.remove();
    this.onClose?.();
  }
}

export interface IntroChoice {
  name: string;
  gender: Gender;
  continueSave: boolean;
}

export function showIntro(parent: HTMLElement, saved: { name: string; gender: Gender; stage: number; worth: number } | null, unlock: () => void): Promise<IntroChoice> {
  return new Promise((resolve) => {
    let gender: Gender = saved?.gender ?? 'm';
    const name = h('input.field', { type: 'text', id: 'player-name', maxlength: '16', placeholder: 'اكتب اسمك هنا', autocomplete: 'off' }) as HTMLInputElement;
    const boy = h('button', { type: 'button' }, h('span', '👨🏽'), 'ولد');
    const girl = h('button', { type: 'button' }, h('span', '👩🏽'), 'بنت');
    const pick = (g: Gender) => {
      gender = g;
      boy.classList.toggle('on', g === 'm');
      girl.classList.toggle('on', g === 'f');
    };
    pick(gender);
    boy.onclick = () => pick('m');
    girl.onclick = () => pick('f');
    const status = h('div.status');
    const done = (cont: boolean) => {
      const typed = name.value.trim();
      if (!cont && !typed) {
        name.focus();
        name.classList.add('shake');
        setTimeout(() => name.classList.remove('shake'), 500);
        status.textContent = 'اكتب اسمك أول 🙂';
        return;
      }
      unlock();
      wrap.remove();
      resolve({ name: cont && saved ? saved.name : typed, gender: cont && saved ? saved.gender : gender, continueSave: cont });
    };
    const form = h(
      'form.panel',
      h('div.awning'),
      h('h1', 'بقالة شرق الإمارات'),
      h('p.tag', 'أنت ورا مكتبك في بقالة صغيرة مرة، ما يجيها إلا كم زبون باليوم. الزبون يدخل، ياخذ أغراضه، يحطها على مكتبك ويقول لك فاتورته: «تقبل فاتورتي؟». تقبل، وتجمع، وتضغط الزر الوردي عشان تدّخر وتطوّر بقالتك… لين تصير أغنى شخص على الإطلاق!'),
      saved ? h('button.btn.warm', { type: 'button', onclick: () => done(true) }, `كمّل يا ${saved.name} (${STAGES[saved.stage].name}، ثروتك ${fmt(Math.floor(saved.worth))})`) : null,
      h('label', { for: 'player-name' }, saved ? 'أو افتح بقالة جديدة باسمك:' : 'شو اسمك يا صاحب البقالة؟'),
      name,
      h('div.gender', boy, girl),
      h('button.btn.start', { type: 'submit' }, '🏪 افتح البقالة'),
      status,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(false);
    });
    const wrap = h('div.intro', form);
    parent.append(wrap);
    if (!saved && matchMedia('(pointer: fine)').matches) setTimeout(() => name.focus(), 300);
  });
}

export function showHowTo(parent: HTMLElement, onClose: () => void): void {
  const c = new Card(parent, 'كيف تلعب؟ 🏪');
  c.body.append(
    h(
      'div.howto',
      h('div.step', h('span', '🕖'), h('div', 'البقالة تفتح الساعة 7 الصبح وتسكّر 11 بالليل. الصبح والعصر فيهم زحمة، والظهر هادي. انتظر، الزباين يجون على راحتهم.')),
      h('div.step', h('span', '🧺'), h('div', 'الزبون يدخل، ياخذ أغراضه من الرفوف، يحطها على مكتبك، ويقول لك شو اشترى وكيف بيدفع. الفاتورة تنطبع قدامك وهو يتكلم.')),
      h('div.step', h('span', '✅'), h('div', 'لما يخلّص كلامه يطلع لك زر «قبول» تحت. اضغطه وخذ حسابك. لا تخلّيه ينتظر كثير، الزبون يملّ ويطلع.')),
      h('div.step', h('span', '💗'), h('div', 'الفلوس تنجمع بالدرج. الزر الوردي «ادخار» ينقلها للادخار، والادخار يربح كل ليلة. لما يكفي، نفس الزر يصير «طوّر البقالة».')),
      h('div.step', h('span', '⌨️'), h('div', 'بالكيبورد: Enter للقبول، و Space للادخار. واسحب الشاشة عشان تتلفت حولك.')),
      h('button.btn.start', { type: 'button', onclick: () => c.close() }, 'يلا نفتح البقالة!'),
    ),
  );
  c.onClose = onClose;
}

/** Closing time: how the day went, then the next morning. */
export function showDaySummary(parent: HTMLElement, d: DaySummary, onNext: () => void): void {
  const c = new Card(parent, `🌙 سكّرنا — اليوم ${d.day}`, { closable: false });
  const row = (label: string, value: string, cls = '') => h(`div.sum-row${cls ? '.' + cls : ''}`, h('span', label), h('b', value));
  c.body.append(
    h(
      'div.summary',
      row('الزباين', String(d.customers)),
      row('المبيعات', fmt(Math.round(d.sales))),
      row('ربح اليوم', fmt(Math.round(d.profit * 10) / 10), 'good'),
      d.passive > 0 ? row('دخل الفروع والعقود', fmt(Math.round(d.passive)), 'good') : null,
      d.interest > 0 ? row('أرباح الادخار الليلة', fmt(Math.round(d.interest * 10) / 10), 'good') : null,
      h('button.btn.start', { type: 'button', onclick: () => c.close() }, '🌅 صباح جديد'),
    ),
  );
  c.onClose = onNext;
}

export function showPrices(parent: HTMLElement, stage: number): Card {
  const c = new Card(parent, `قائمة الأسعار — ${STAGES[stage].name}`);
  c.body.append(priceList(stage));
  return c;
}

export function showUpgrade(parent: HTMLElement, stage: number, onClose: () => void): void {
  const c = new Card(parent, '🎉 مبروك!', { cls: 'celebrate' });
  const st = STAGES[stage];
  c.body.append(
    h(
      'div.cele',
      h('div.big', st.name),
      h('p', `صارت بقالتك «${st.sign}».`),
      h('p.muted', st.adds),
      st.passive ? h('p.good', `دخل إضافي: ${fmt(st.passive)} كل ساعة 💸`) : null,
      h('button.btn.start', { type: 'button', onclick: () => c.close() }, 'يلا!'),
    ),
  );
  c.onClose = onClose;
  confetti(parent);
}

export function showRank(parent: HTMLElement, title: string, final: boolean, stats: string, onClose: () => void): void {
  const c = new Card(parent, final ? '👑 مبروك!' : '🏆 لقب جديد', { cls: 'celebrate' });
  c.body.append(h('div.cele', h('div.big', title), final ? h('p', 'صرت أغنى شخص على الإطلاق! من كشك صغير ما يجيه أحد، لين مجموعة قابضة. 👏') : null, h('p.muted', stats), h('button.btn.start', { type: 'button', onclick: () => c.close() }, final ? 'الحمد لله' : 'كمّل')));
  c.onClose = onClose;
  confetti(parent);
}

export function confetti(parent: HTMLElement): void {
  const conf = h('div.confetti');
  const colors = ['#e8508f', '#ffd166', '#3fbf9f', '#4f86f7', '#ff8fb8', '#c9a54a'];
  for (let i = 0; i < 70; i++) conf.append(h('i', { style: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDuration: `${2.4 + Math.random() * 2.6}s`, animationDelay: `${Math.random() * 1.2}s` } }));
  parent.append(conf);
  setTimeout(() => conf.remove(), 6500);
}
