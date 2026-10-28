/**
 * The in-game phone (Tab): savings goals, the job board, the shop, a receipt-style
 * wallet history, achievements, and settings for voice, Claude and graphics.
 */
import { JOBS, UPGRADES, xpForNext } from '../game/catalog';
import type { Store } from '../game/state';
import { ACHIEVEMENTS, type Settings } from '../game/progression';
import { formatMoney, formatNumber } from '../lang/arabic';
import { formatClock } from '../dialogue/brain';
import { API_MODELS } from '../dialogue/llm';
import { DIALECTS } from '../voice/speech';
import type { PlaceId } from '../world/layout';
import { h } from './dom';

export type PhoneTab = 'home' | 'jobs' | 'shop' | 'wallet' | 'awards' | 'settings';

export interface PhoneHandlers {
  mark(place: PlaceId): void;
  openOnline(): void;
  settingsChanged(s: Settings): void;
  reset(): void;
  testMic(): Promise<string>;
  testVoice(): void;
  close(): void;
  claudeStatus(): string;
  voiceInfo(): { engine: 'azure' | 'device' | 'none'; voice: string; natural: boolean; lastError: string };
}

const TABS: [PhoneTab, string, string][] = [
  ['home', '🏠', 'الرئيسية'],
  ['jobs', '💼', 'الشغل'],
  ['shop', '🛍️', 'المتجر'],
  ['wallet', '🧾', 'محفظتي'],
  ['awards', '🏆', 'إنجازات'],
  ['settings', '⚙️', 'الإعدادات'],
];

export class Phone {
  readonly root = h('div.overlay');
  private readonly app = h('div.app');
  private readonly tabs = h('div.tabs');
  private readonly status = h('div.status');
  private tab: PhoneTab = 'home';

  constructor(
    parent: HTMLElement,
    private readonly store: Store,
    private readonly settings: Settings,
    private readonly handlers: PhoneHandlers,
  ) {
    const phone = h('div.phone', h('div.screen', this.status, this.app, this.tabs));
    this.root.append(phone);
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.handlers.close();
    });
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(tab: PhoneTab = this.tab): void {
    this.tab = tab;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  render(): void {
    const s = this.store.s;
    this.status.replaceChildren(h('span', formatClock(s.minute)), h('b', 'شارع الرزق'), h('span', '📶 🔋'));
    this.tabs.replaceChildren(...TABS.map(([id, icon, name]) => h(`button${id === this.tab ? '.on' : ''}`, { type: 'button', onclick: () => ((this.tab = id), this.render()) }, h('span', icon), name)));
    const views: Record<PhoneTab, () => HTMLElement[]> = {
      home: () => this.home(),
      jobs: () => this.jobs(),
      shop: () => this.shop(),
      wallet: () => this.wallet(),
      awards: () => this.awards(),
      settings: () => this.settingsView(),
    };
    this.app.replaceChildren(...views[this.tab]());
    this.app.scrollTop = 0;
  }

  private home(): HTMLElement[] {
    const st = this.store;
    const s = st.s;
    const worth = st.netWorth;
    const today = s.ledger.filter((l) => l.day === s.day && l.amount > 0 && !l.label.startsWith('سحب')).reduce((a, l) => a + l.amount, 0);
    const goals = UPGRADES.filter((u) => !st.has(u.id)).slice(0, 3);
    const shop = UPGRADES.find((u) => u.id === 'shop')!;
    return [
      h('h3', `هلا ${s.player.name} 👋`),
      h('div.stat-grid', h('div.tile', h('span.muted', 'بالمحفظة'), h('b.num', formatNumber(s.wallet))), h('div.tile', h('span.muted', 'بالبنك'), h('b.num', formatNumber(s.bank))), h('div.tile', h('span.muted', 'كسبت اليوم'), h('b.num', formatNumber(today))), h('div.tile', h('span.muted', 'كسبت من البداية'), h('b.num', formatNumber(s.earnedTotal)))),
      h('div.tile', h('div.title', h('span.ico', '🏪'), h('span.grow', 'الحلم الكبير: محلك الخاص'), h('b', formatMoney(shop.price))), h('div.progress-line', h('i', { style: { width: `${Math.min(100, (worth / shop.price) * 100)}%` } })), h('div.muted', `معك ${formatMoney(worth)} من ${formatMoney(shop.price)} (محفظة + بنك)`)),
      h('b', 'أهدافك الجاية'),
      ...goals.map((u) => h('div.tile', h('div.title', h('span.ico', u.icon), h('span.grow', u.name), h('b', formatMoney(u.price))), h('div.progress-line', h('i', { style: { width: `${Math.min(100, (worth / u.price) * 100)}%` } })), h('div.muted', u.effect))),
      h('div.tile', h('div.title', h('span.ico', '💡'), 'نصيحة'), h('div.muted', tipOfTheDay(s.day, s.minute))),
    ];
  }

  private jobs(): HTMLElement[] {
    const st = this.store;
    return [
      h('h3', 'طرق كسب الفلوس'),
      h('div.muted', 'كلّم صاحب الشغل وقول «عندك شغل؟»، أو اضغط «دلّني» وأنا أحط لك علامة.'),
      ...JOBS.map((j) => {
        const block = st.jobBlock(j.id);
        const pill = block === null ? h('span.pill.open', 'متاح الآن') : block === 'closed' ? h('span.pill.closed', `يفتح ${hoursText(j.hours)}`) : block === 'done' ? h('span.pill.done', 'خلص اليوم') : h('span.pill.locked', j.company ? 'يحتاج ترقية' : 'يحتاج بسطة');
        const lvl = st.level(j.id);
        const xp = st.s.skills[j.id]?.xp ?? 0;
        const boss = j.employer ? (j.employer === 'mum' ? 'أمك' : j.employer === 'dad' ? 'أبوك' : j.employer === 'hr' ? 'مجموعة الرزق' : j.employer === 'partner' ? 'أبو راشد' : null) : null;
        const actions = h('div.row');
        if (j.id === 'online' && st.has('phone')) actions.append(h('button.btn', { type: 'button', onclick: () => this.handlers.openOnline() }, 'اشتغل من الجوال'));
        actions.append(h('button.btn.secondary', { type: 'button', onclick: () => this.handlers.mark(j.place) }, 'دلّني 📍'));
        return h(
          'div.tile',
          h('div.title', h('span.grow', j.title), pill),
          h('div.muted', `${j.summary}${boss ? ` — عند ${boss}` : ''}. الأجر حوالي ${formatMoney(st.payFor(j.id, j.pay))}${j.daily ? ` · ${j.daily === 1 ? 'مرة' : 'مرتين'} باليوم` : ''}.`),
          h('div.row', h('span.muted', `المستوى ${lvl}`), h('div.progress-line.grow', h('i', { style: { width: `${lvl >= 10 ? 100 : Math.min(100, (xp / xpForNext(lvl)) * 100)}%` } }))),
          actions,
        );
      }),
    ];
  }

  private shop(): HTMLElement[] {
    const st = this.store;
    return [
      h('h3', 'المتجر'),
      h('div.muted', 'تشتري أونلاين ويوصلك فوراً. الدفع نقداً من محفظتك؛ إذا فلوسك بالبنك اسحبها من الصراف.'),
      ...UPGRADES.map((u) => {
        const owned = st.has(u.id);
        const afford = st.s.wallet >= u.price;
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
                    st.buy(u.id);
                    this.render();
                  },
                },
                afford ? 'اشترِ' : `ينقصك ${formatMoney(u.price - st.s.wallet)}`,
              ),
        );
      }),
    ];
  }

  private wallet(): HTMLElement[] {
    const s = this.store.s;
    return [
      h('h3', 'محفظتي'),
      h(
        'div.ledger',
        h('div.r', h('b', 'البيان'), h('b', 'المبلغ')),
        ...(s.ledger.length
          ? s.ledger.slice(0, 50).map((l) => h('div.r', h('span', `${l.bank ? '🏦 ' : ''}${l.label} · يوم ${l.day} ${formatClock(l.minute)}`), h(`span.num.${l.amount > 0 ? 'plus' : 'minus'}`, `${l.amount > 0 ? '+' : '−'}${formatNumber(Math.abs(l.amount))}`)))
          : [h('div.muted', 'بعدك ما كسبت شي. روح كلّم أمك بالحوش!')]),
      ),
    ];
  }

  private awards(): HTMLElement[] {
    const got = this.store.s.achievements;
    const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
    return [
      h('h3', `الإنجازات ${n}/${ACHIEVEMENTS.length}`),
      ...ACHIEVEMENTS.map((a) => h(`div.tile.ach${got[a.id] ? '' : '.locked'}`, h('span.ico', a.icon), h('div', h('b', a.title), h('div.muted', got[a.id] ? `${a.desc} · يوم ${got[a.id]}` : a.desc)))),
    ];
  }

  private settingsView(): HTMLElement[] {
    const st = this.settings;
    const changed = () => this.handlers.settingsChanged(st);
    const select = (id: string, value: string, options: { v: string; t: string }[], set: (v: string) => void) => {
      const el = h('select.field', { id, onchange: () => (set(el.value), changed()) }, ...options.map((o) => h('option', { value: o.v }, o.t))) as HTMLSelectElement;
      el.value = value;
      return el;
    };
    const check = (id: string, label: string, value: boolean, set: (v: boolean) => void) => {
      const box = h('input', { type: 'checkbox', id, onchange: () => (set(box.checked), changed()) }) as HTMLInputElement;
      box.checked = value;
      return h('label.toggle', { for: id }, box, label);
    };
    const micResult = h('div.muted');
    const key = h('input.field', { type: 'password', id: 'api-key', placeholder: 'sk-ant-…', autocomplete: 'off', value: st.apiKey }) as HTMLInputElement;
    key.onchange = () => {
      st.apiKey = key.value.trim();
      changed();
      this.render();
    };
    const info = this.handlers.voiceInfo();
    const voiceNote =
      info.engine === 'azure'
        ? `✓ أصوات Azure العصبية: كل شخصية بلهجتها.${info.lastError ? ` (آخر خطأ: ${info.lastError}، رجعنا لصوت الجهاز)` : ''}`
        : info.engine === 'none'
          ? '⚠️ ما في صوت عربي بجهازك. افتح اللعبة بمتصفح Microsoft Edge (فيه أصوات عربية طبيعية مجانية)، أو بجوال أندرويد أو آيفون، أو حط مفتاح Azure تحت.'
          : info.natural
            ? `✓ صوت عربي طبيعي من جهازك: ${info.voice}`
            : `الصوت الحالي آلي شوي: ${info.voice}. للصوت العربي الطبيعي افتح اللعبة بمتصفح Microsoft Edge (أصوات إماراتية طبيعية مجانية)، أو حط مفتاح Azure تحت.`;
    const azKey = h('input.field', { type: 'password', id: 'azure-key', placeholder: 'مفتاح Azure Speech', autocomplete: 'off', value: st.azureKey }) as HTMLInputElement;
    const azRegion = h('input.field', { type: 'text', id: 'azure-region', placeholder: 'uaenorth', autocomplete: 'off', value: st.azureRegion, style: 'direction:ltr' }) as HTMLInputElement;
    azKey.onchange = azRegion.onchange = () => {
      st.azureKey = azKey.value.trim();
      st.azureRegion = azRegion.value.trim() || 'uaenorth';
      changed();
      this.render();
    };
    const confirmBox = h('div.row');
    const resetBtn = h(
      'button.btn.ghost',
      {
        type: 'button',
        onclick: () => {
          confirmBox.replaceChildren(h('span.muted', 'متأكد؟ بتضيع كل الفلوس والتقدم.'), h('button.btn.warm', { type: 'button', onclick: () => this.handlers.reset() }, 'إي، ابدأ من جديد'), h('button.btn.secondary', { type: 'button', onclick: () => confirmBox.replaceChildren(resetBtn) }, 'لا'));
        },
      },
      'ابدأ لعبة جديدة',
    );
    confirmBox.append(resetBtn);
    return [
      h('h3', 'الإعدادات'),
      h('div.setting', h('label', { for: 'dialect' }, '🎤 لهجة المايك (التعرف على كلامك)'), select('dialect', st.voiceLang, DIALECTS.map((d) => ({ v: d.code, t: `${d.name} (${d.code})` })), (v) => (st.voiceLang = v))),
      h(
        'div.row',
        h(
          'button.btn.secondary',
          {
            type: 'button',
            onclick: async () => {
              micResult.textContent = 'تكلم الحين…';
              try {
                const t = await this.handlers.testMic();
                micResult.textContent = t ? `سمعتك تقول: «${t}»` : 'ما سمعت شي.';
              } catch (e) {
                micResult.textContent = String(e);
              }
            },
          },
          'جرّب المايك',
        ),
        h('button.btn.secondary', { type: 'button', onclick: () => this.handlers.testVoice() }, 'جرّب صوت الشخصيات'),
      ),
      micResult,
      h('div.tile', h('div.title', h('span.ico', '🗣️'), 'الأصوات العربية'), h('div.muted', voiceNote)),
      h(
        'div.setting',
        h('label', { for: 'azure-key' }, 'أصوات Azure العصبية (اختياري)'),
        azKey,
        azRegion,
        h('div.muted', 'مفتاح Azure Speech يعطي كل شخصية صوت حقيقي بلهجتها (إماراتي، كويتي، شامي، مصري…)، ويحوّل كلامك لنص بأي متصفح. المفتاح يتخزن بمتصفحك بس، والخطة المجانية تكفي للعب.'),
      ),
      check('tts', 'الشخصيات تتكلم بصوت عالي', st.tts, (v) => (st.tts = v)),
      check('hands', 'محادثة صوتية مستمرة (المايك يفتح لحاله بعد كل رد)', st.handsFree, (v) => (st.handsFree = v)),
      h('div.setting', h('label', { for: 'rate' }, 'سرعة كلام الشخصيات'), select('rate', String(st.ttsRate), [{ v: '0.85', t: 'بطيء' }, { v: '1', t: 'عادي' }, { v: '1.15', t: 'سريع' }], (v) => (st.ttsRate = Number(v)))),
      h('div.tile', h('div.title', h('span.ico', '🧠'), 'ذكاء الشخصيات'), h('div.muted', this.handlers.claudeStatus()), select('brain', st.brain, [{ v: 'auto', t: 'Claude إذا متوفر، وإلا بدون إنترنت' }, { v: 'offline', t: 'بدون إنترنت دائماً (أسرع)' }], (v) => (st.brain = v as Settings['brain']))),
      h(
        'div.setting',
        h('label', { for: 'api-key' }, 'مفتاح Anthropic API (اختياري، لما تلعب خارج claude.ai)'),
        key,
        select('model', st.apiModel, API_MODELS.map((m) => ({ v: m.id, t: m.name })), (v) => (st.apiModel = v)),
        h('div.muted', 'المفتاح يتخزن بمتصفحك بس ويروح مباشرة لـ Anthropic. الأفضل تستخدم مفتاح بحد صرف صغير.'),
      ),
      h('div.setting', h('label', { for: 'quality' }, 'جودة الرسوم'), select('quality', st.quality, [{ v: 'high', t: 'عالية (ظلال كاملة)' }, { v: 'low', t: 'خفيفة (للجوالات)' }], (v) => (st.quality = v as Settings['quality']))),
      h('div.setting', h('label', { for: 'vol' }, 'صوت المؤثرات'), select('vol', String(st.volume), [{ v: '0', t: 'مكتوم' }, { v: '0.4', t: 'منخفض' }, { v: '0.8', t: 'عادي' }, { v: '1', t: 'عالي' }], (v) => (st.volume = Number(v)))),
      check('digits', 'أرقام عربية (١٢٣) بدل (123)', st.arabicDigits, (v) => (st.arabicDigits = v)),
      check('labels', 'أسماء الناس فوق رؤوسهم', st.labels, (v) => (st.labels = v)),
      h('div.tile', h('b', 'التحكم'), controlsHelp()),
      confirmBox,
    ];
  }
}

export function controlsHelp(): HTMLElement {
  const row = (k: string, t: string) => [h('span.key', k), h('span', t)];
  return h('div.controls-help', ...row('W A S D', 'المشي (أو الأسهم)'), ...row('Shift', 'الركض'), ...row('Space', 'القفز'), ...row('E', 'تفاعل / تكلم / اشتغل'), ...row('T', 'كلّم أقرب شخص'), ...row('V', 'اضغط مطولاً وتكلم بالمايك'), ...row('Tab', 'الجوال'), ...row('M', 'الخريطة'), ...row('B', 'اركب الدراجة/السكوتر'), ...row('سحب الماوس', 'تدوير الكاميرا'), ...row('Esc', 'إغلاق'));
}

function hoursText(hours: [number, number]): string {
  const f = (x: number) => {
    const h24 = x % 24;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}${h24 < 12 ? 'ص' : 'م'}`;
  };
  return `${f(hours[0])}–${f(hours[1])}`;
}

const TIPS = [
  'سلّم على جدك كل يوم بـ«السلام عليكم» تلقى عيدية.',
  'اللي بالبنك يزيد 1% كل يوم. وفّر شوي من كل شغلة.',
  'الظهر حر: الماي البارد ينباع غالي على البسطة.',
  'لو لقيت محفظة ضايعة رجّعها لصاحبها، الأمانة ترفع سمعتك.',
  'العلب الفاضية بالشارع = درهم لكل علبة بآلة التدوير.',
  'التوصيل يدفع أكثر إذا وصلت بسرعة. الدراجة تفرق!',
  'كلّم الناس بالمايك: اضغط 🎤 وقول «عندك شغل؟».',
  'أم علي تبي أحد يدرّس علي العصر.',
  'كل ما تشتغل أكثر بنفس الشغلة، مستواك يرتفع وأجرك يزيد.',
];

function tipOfTheDay(day: number, minute: number): string {
  return TIPS[(day * 7 + Math.floor(minute / 180)) % TIPS.length];
}
