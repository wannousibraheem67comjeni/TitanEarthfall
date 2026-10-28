/**
 * «سند», the player's guide: understands what the player wants from the game as a
 * whole ("أبي شغل أونلاين يجيب 1000 درهم بالشهر", "ودني لأمي", "كم معي؟") and turns it
 * into a plan: a short spoken answer plus actions (walk somewhere and start a job,
 * set a savings goal, open the phone).
 */
import type { Rng } from '../core/rng';
import { fillTemplate, formatMoney, normalizeArabic } from '../lang/arabic';
import { analyze, Lexicon } from '../lang/intents';
import { COMPANY_RANKS, DEALS, job, JOBS, UPGRADES, type JobId, type NpcId, type UpgradeId } from '../game/catalog';
import { GIGS } from '../game/jobs/online';
import type { Store } from '../game/state';
import { PLACES, place, type PlaceId } from '../world/layout';
import { NPCS, npc } from './npcs';

export type GuideAction =
  | { type: 'goJob'; job: JobId }
  | { type: 'goPlace'; place: PlaceId }
  | { type: 'talkTo'; npc: NpcId }
  | { type: 'setGoal'; amount: number; days: number; job: JobId | null }
  | { type: 'openPhone'; tab: 'home' | 'jobs' | 'shop' | 'wallet' | 'awards' | 'settings' }
  | { type: 'buy'; upgrade: UpgradeId }
  | { type: 'move'; dir: MoveDir }
  | { type: 'openBoard' }
  | { type: 'invest' }
  | { type: 'sleep' }
  | { type: 'stop' };

export type MoveDir = 'forward' | 'back' | 'left' | 'right' | 'out' | 'in';
export const MOVE_DIRS: MoveDir[] = ['forward', 'back', 'left', 'right', 'out', 'in'];

export interface GuideReply {
  text: string;
  actions: GuideAction[];
  suggestions: string[];
}

export const GUIDE_NAME = 'سند';

type Category = JobId | 'family' | 'company' | 'work';

const CATEGORY = new Lexicon<Category>([
  { id: 'online', phrases: ['اونلاين', 'اون لاين', 'الاونلاين', 'انترنت', 'الانترنت', 'نت', 'كمبيوتر', 'الكمبيوتر', 'لابتوب', 'اللابتوب', 'حاسوب', 'من البيت', 'عن بعد', 'فريلانس', 'عمل حر', 'العمل الحر', 'مستقل', 'online', 'ترجمه', 'تصميم', 'ادخال بيانات', 'تدقيق', 'اختبار*', 'امتحان*'] },
  { id: 'delivery', phrases: ['توصيل', 'دليفري', 'ديليفري', 'مندوب', 'اوصل', 'طلبات', 'شاورما', 'المطعم', 'delivery'] },
  { id: 'cashier', phrases: ['كاشير', 'محاسب', 'بقاله', 'البقاله', 'سوبرماركت', 'الدكان', 'رحيم'] },
  { id: 'karak', phrases: ['كرك', 'الكرك', 'شاي', 'قهوه', 'كافيه', 'كافتيريا', 'مقهى'] },
  { id: 'perfume', phrases: ['عطور', 'العطور', 'عطر', 'محل ابوي', 'ابوي', 'بابا', 'دخون', 'بخور'] },
  { id: 'carwash', phrases: ['غسيل سيارات', 'مغسله', 'المغسله', 'اغسل سيارات', 'تغسيل'] },
  { id: 'hamadcar', phrases: ['العم حمد', 'عمي حمد', 'لاندكروزر', 'سياره حمد'] },
  { id: 'tutor', phrases: ['تدريس', 'دروس', 'ادرس', 'ادرّس', 'معلم', 'استاذ', 'رياضيات', 'واجب'] },
  { id: 'sweep', phrases: ['كنس', 'اكنس', 'كنس البيت', 'تنظيف البيت', 'انظف البيت', 'نظف البيت', 'انظف', 'المكنسه', 'غبار'] },
  { id: 'dishes', phrases: ['صحون', 'الصحون', 'مواعين', 'المواعين', 'جلي', 'اغسل الصحون'] },
  { id: 'tidy', phrases: ['رتب غرفتي', 'ارتب غرفتي', 'ترتيب الغرفه', 'غرفتي', 'العابي', 'اغراضي'] },
  { id: 'laundry', phrases: ['الغسيل', 'غسيل الملابس', 'ملابس', 'الملابس', 'هدوم', 'اطوي'] },
  { id: 'coffee', phrases: ['صب القهوه', 'اصب القهوه', 'ضيافه', 'الضيوف', 'دله', 'الدله', 'فناجين'] },
  { id: 'family', phrases: ['امي', 'ماما', 'اهلي', 'مساعده اهلي', 'اساعد اهلي', 'ساعد اهلي', 'الزرع', 'زباله', 'الزباله', 'مقاضي', 'شغل البيت', 'شغل بالبيت', 'طلبات البيت', 'اساعد بالبيت'] },
  { id: 'reception', phrases: ['استقبال', 'الاستقبال', 'مكالمات', 'سنترال'] },
  { id: 'sales', phrases: ['مبيعات', 'المبيعات', 'مندوب', 'مسوق', 'تسويق'] },
  { id: 'accounting', phrases: ['محاسب', 'محاسبه', 'المحاسبه', 'فواتير', 'حسابات'] },
  { id: 'company', phrases: ['شركه', 'شركات', 'الشركه', 'الشركات', 'وظيفه', 'وظايف', 'وظائف', 'موظف', 'مكتب', 'دوام', 'راتب'] },
  { id: 'trade', phrases: ['تجاره', 'صفقه', 'صفقات', 'تاجر', 'اشتغل مع', 'اشتغل معه', 'احد اشتغل معه', 'شخص اشتغل معه', 'بضاعه'] },
  { id: 'stall', phrases: ['بسطه', 'البسطه', 'ابيع', 'بيع', 'بزنس', 'مشروع'] },
  { id: 'recycle', phrases: ['تدوير', 'اعاده تدوير', 'علب', 'قناني', 'بلاستيك'] },
  { id: 'barber', phrases: ['حلاق', 'الحلاق', 'صالون', 'كنس الصالون', 'كنس الشعر'] },
  { id: 'work', phrases: ['شغل*', 'عمل', 'وظيف*', 'اشتغل', 'دوام', 'اكسب', 'يكسبني', 'يجيبلي', 'يجيب لي', 'فلوس', 'مصاري', 'بيزات', 'دراهم', 'درهم', 'رزق', 'دخل'] },
]);

const PLACE_WORDS = new Lexicon<PlaceId>(PLACES.map((p) => ({ id: p.id, phrases: p.phrases })));
const PEOPLE = new Lexicon<NpcId>([
  { id: 'mum', phrases: ['امي', 'ماما', 'يمه', 'الوالده'] },
  { id: 'dad', phrases: ['ابوي', 'بابا', 'يبه', 'الوالد', 'ابو سالم'] },
  { id: 'grandpa', phrases: ['جدي', 'جدو', 'الحاج'] },
  { id: 'grocer', phrases: ['رحيم'] },
  { id: 'karak', phrases: ['ابو خالد'] },
  { id: 'shawarma', phrases: ['ابو احمد'] },
  { id: 'carwash', phrases: ['حمدان'] },
  { id: 'umali', phrases: ['ام علي'] },
  { id: 'ali', phrases: ['علي'] },
  { id: 'hamad', phrases: ['العم حمد', 'حمد'] },
  { id: 'electro', phrases: ['مازن'] },
  { id: 'barber', phrases: ['ابو علاء'] },
  { id: 'hr', phrases: ['نوره', 'الاستاذه نوره', 'الموارد البشريه'] },
  { id: 'partner', phrases: ['ابو راشد', 'التاجر'] },
]);
const UPGRADE_WORDS = new Lexicon<UpgradeId>([
  { id: 'sneakers', phrases: ['حذاء', 'جوتي', 'جزمه', 'كوتشي', 'سنيكرز'] },
  { id: 'bike', phrases: ['دراجه', 'سيكل', 'بسكليت', 'عجله'] },
  { id: 'phone', phrases: ['جوال', 'تلفون', 'موبايل', 'هاتف'] },
  { id: 'laptop', phrases: ['لابتوب', 'كمبيوتر', 'حاسوب'] },
  { id: 'scooter', phrases: ['سكوتر'] },
  { id: 'stall', phrases: ['بسطه'] },
  { id: 'cooler', phrases: ['ثلاجه', 'كولر'] },
  { id: 'gift', phrases: ['هديه', 'عقد', 'ذهب'] },
  { id: 'shop', phrases: ['محل خاص', 'محلي', 'كشك', 'محل لي'] },
]);

function has(norm: string, words: string[]): boolean {
  const padded = ` ${norm} `;
  return words.some((w) => padded.includes(` ${normalizeArabic(w)} `) || padded.includes(` و${normalizeArabic(w)} `) || padded.includes(` ب${normalizeArabic(w)} `));
}

const GO_WORDS = ['ودني', 'وديني', 'خذني', 'خذيني', 'روح', 'اروح', 'نروح', 'وين', 'فين', 'دلني', 'دليني', 'كيف اوصل', 'اوصل', 'امشي', 'خليني اروح', 'go', 'take me'];
const BUY_WORDS = ['اشتري', 'بشتري', 'ابي اشتري', 'بدي اشتري', 'شراء', 'اشتريلي'];
const STATUS_WORDS = ['كم معي', 'كم عندي', 'فلوسي', 'رصيدي', 'حسابي', 'كم جمعت', 'وين وصلت', 'كم صار معي', 'محفظتي', 'هدفي'];
const HELP_WORDS = ['كيف العب', 'كيف ألعب', 'شو اسوي', 'ايش اسوي', 'وش اسوي', 'ما فهمت', 'مش فاهم', 'مو فاهم', 'ساعدني', 'شرح', 'اشرح', 'كيف امشي', 'شو اعمل', 'help'];
const STOP_WORDS = ['وقف', 'وقّف', 'خلاص', 'الغي', 'الغاء', 'استنى', 'ستوب', 'stop', 'كنسل'];
const SLEEP_WORDS = ['نام', 'انام', 'بنام', 'تعبت', 'نعسان', 'نعسانه', 'تصبح على خير'];
const BOARD_WORDS = ['على قدي', 'على قدك', 'تناسبني', 'يناسبني', 'لوحه الوظائف', 'لوحه الشغل', 'شو في شغل', 'ايش في شغل', 'وش في شغل', 'كل الوظائف', 'الوظائف المتاحه', 'شغلات'];
const RICH_WORDS = ['غني', 'اصير غني', 'اغتني', 'ثروه', 'مليونير', 'مليون', 'الغنى', 'اكون غني'];
const INVEST_WORDS = ['استثمر', 'استثمار', 'شراكه', 'شريك', 'اشارك', 'فلوسي تشتغل', 'دخل يومي'];
/** Spoken movement: "امشي لقدام", "ارجع", "لف يمين", "اطلع برا", "ادخل البيت". */
const MOVES: [string[], MoveDir][] = [
  [['ادخل البيت', 'ادخل للبيت', 'فوت البيت', 'فوت عالبيت', 'ادخل جوا', 'جوا البيت', 'داخل البيت', 'ادخل الدار'], 'in'],
  [['اطلع برا', 'اطلع من البيت', 'اطلع للشارع', 'الشارع', 'برا البيت', 'اطلع', 'اخرج'], 'out'],
  [['قدام', 'لقدام', 'للقدام', 'امشي', 'امش', 'كمل', 'تقدم', 'سير', 'روح قدام', 'للامام', 'الامام'], 'forward'],
  [['ورا', 'لورا', 'ارجع', 'رجع', 'الخلف', 'للخلف'], 'back'],
  [['يمين', 'لليمين', 'عاليمين', 'على اليمين'], 'right'],
  [['يسار', 'شمال', 'لليسار', 'عاليسار', 'عالشمال', 'على اليسار'], 'left'],
];
const PHONE_WORDS: [string[], GuideAction & { type: 'openPhone' }][] = [
  [['المتجر', 'متجر', 'المشتريات'], { type: 'openPhone', tab: 'shop' }],
  [['الانجازات', 'انجازاتي'], { type: 'openPhone', tab: 'awards' }],
  [['الاعدادات', 'اعدادات', 'الصوت', 'اللهجه'], { type: 'openPhone', tab: 'settings' }],
  [['قائمه الشغل', 'كل الشغل', 'الوظائف'], { type: 'openPhone', tab: 'jobs' }],
];

/** "شهر" → 30, "اسبوع" → 7, "يوم" → 1; null when no period is named. */
export function periodDays(norm: string): number | null {
  if (/(بالسنه|سنويا|كل سنه|في السنه|السنه)/.test(norm)) return 365;
  if (/(بالشهر|شهريا|كل شهر|في الشهر|الشهر|شهر)/.test(norm)) return 30;
  if (/(بالاسبوع|اسبوعيا|كل اسبوع|في الاسبوع|الاسبوع|اسبوع|جمعه)/.test(norm)) return 7;
  if (/(باليوم|يوميا|كل يوم|في اليوم|اليوم)/.test(norm)) return 1;
  return null;
}

/** Typical pay for one round of a job, as the player would earn it now. */
export function roundPay(store: Store, id: JobId): number {
  if (id === 'online') {
    const usable = GIGS.filter((g) => !g.needsLaptop || store.has('laptop'));
    const avg = usable.reduce((s, g) => s + g.base, 0) / usable.length;
    return Math.round(store.payFor('online', avg) * (store.has('laptop') ? 1.6 : 1));
  }
  if (id === 'recycle') return 8;
  return store.payFor(id, job(id).pay);
}

/** Best job to suggest now: open, not done today, highest pay. */
export function bestJob(store: Store, prefer: JobId[] = [], avoid: JobId[] = []): JobId | null {
  const open = JOBS.filter((j) => j.id !== 'recycle' && !avoid.includes(j.id) && store.jobBlock(j.id) === null);
  const preferred = open.filter((j) => prefer.includes(j.id));
  const list = preferred.length ? preferred : open;
  if (!list.length) return null;
  return list.sort((a, b) => roundPay(store, b.id) - roundPay(store, a.id))[0].id;
}

function familyJob(store: Store): JobId | null {
  return (['sweep', 'dishes', 'tidy', 'laundry', 'coffee', 'plants', 'trash', 'errand'] as JobId[]).find((j) => store.jobBlock(j) === null) ?? null;
}

/** The company job that fits the player now (highest rank they hold, open now). */
function companyJob(store: Store): JobId | null {
  return (['accounting', 'sales', 'reception'] as JobId[]).find((j) => store.jobBlock(j) === null) ?? null;
}

/** Open jobs that fit right now, best paid first. */
export function fittingJobs(store: Store): JobId[] {
  return JOBS.filter((j) => j.id !== 'recycle' && store.jobBlock(j.id) === null)
    .sort((a, b) => roundPay(store, b.id) - roundPay(store, a.id))
    .map((j) => j.id);
}

function blockText(store: Store, id: JobId): string {
  const b = store.jobBlock(id);
  const def = job(id);
  if (b === 'closed') {
    const [from] = def.hours;
    const h12 = from % 12 === 0 ? 12 : from % 12;
    return `${def.title} مسكّر الحين، يفتح الساعة ${h12}${from < 12 ? ' الصبح' : from < 17 ? ' الظهر' : ' المسا'}.`;
  }
  if (b === 'done') return `${def.title} خلصته اليوم، بكرة تقدر{|ين} تسويه مرة ثانية.`;
  if (b === 'locked') return store.lockText(id);
  return '';
}

function where(id: JobId): string {
  const def = job(id);
  if (id === 'online') return 'اللابتوب اللي بحوش بيتكم';
  if (def.employer === 'mum') return 'أمك بالبيت';
  if (def.employer === 'dad') return def.place === 'home' ? 'أبوك بالمجلس بالبيت' : 'أبوك بمحل العطور';
  if (def.employer === 'partner') return 'أبو راشد التاجر عند الكرك';
  return def.employer ? `${npc(def.employer).name} في ${place(def.place).name}` : place(def.place).name;
}

const SUGGEST = ['أبي شغل أونلاين', 'شو في شغل على قدي؟', 'ادخل البيت', 'ودني الشركة', 'أبي أصير غني'];

/** Understand a request to the guide. */
export function guideRespond(text: string, store: Store, rng: Rng, last: JobId | null = null): GuideReply {
  const g = store.s.player.gender;
  const say = (t: string, vars: Record<string, string | number> = {}) => fillTemplate(t, g, { name: store.s.player.name, ...vars });
  const a = analyze(text);
  const norm = a.norm;
  const tokens = a.tokens;
  const cats = CATEGORY.find(a.variants);
  const specific = cats.filter((c) => c !== 'work');
  const workish = cats.length > 0 || a.has('ask_work') || a.has('money_advice');
  const amount = a.numbers.filter((n) => n >= 20).sort((x, y) => y - x)[0] ?? null;
  const days = periodDays(norm);
  const people = PEOPLE.find(a.variants);
  const places = PLACE_WORDS.find(a.variants);
  const navigate = (): GuideReply => {
    const people = PEOPLE.find(a.variants);
    const places = PLACE_WORDS.find(a.variants);
    // A person mentioned before a place wins ("ودني لأمي بالبيت").
    if (people.length) {
      const id = people[0];
      const who = id === 'mum' ? 'أمك' : id === 'dad' ? 'أبوك' : id === 'grandpa' ? 'جدك' : npc(id).name;
      return { text: say('يلا أوديك عند {who}.', { who }), actions: [{ type: 'talkTo', npc: id }], suggestions: ['وقف', 'وصّلني الحين'] };
    }
    const p = place(places[0]);
    return { text: say('{place} {hint}. يلا أوديك.', { place: p.name, hint: p.hint }), actions: [{ type: 'goPlace', place: p.id }], suggestions: ['وقف', 'وصّلني الحين'] };
  };

  if (tokens.length <= 3 && has(norm, STOP_WORDS)) return { text: say('تمام، وقفنا.'), actions: [{ type: 'stop' }], suggestions: SUGGEST };

  if (has(norm, HELP_WORDS) && !specific.length) {
    return {
      text: say('بسيطة يا {name}: قول لي شو تبي{|ن} وأنا أوديك. مثلاً «أبي شغل أونلاين» أو «ودني لأمي» أو «أبي أشتغل توصيل». وإذا تبي{|ن} تمشي بنفسك، اضغط على أي مكان بالشاشة أو استخدم الأسهم.'),
      actions: [],
      suggestions: SUGGEST,
    };
  }

  if (has(norm, STATUS_WORDS) && !specific.length && !a.has('ask_work', 1) && !has(norm, INVEST_WORDS) && !has(norm, RICH_WORDS)) {
    const s = store.s;
    let t = say('معك {w} بالمحفظة و{b} بالبنك.', { w: formatMoney(s.wallet), b: formatMoney(s.bank) });
    if (s.goal) {
      const got = Math.max(0, s.earnedTotal - s.goal.startEarned);
      const left = Math.max(0, s.goal.startDay + s.goal.days - s.day);
      t += say(' هدفك {amount}، جمعت منه {got} وباقي {left} يوم.', { amount: formatMoney(s.goal.amount), got: formatMoney(got), left });
    }
    return { text: t, actions: [], suggestions: ['وين أحسن شغل الحين؟', 'أبي شغل أونلاين', 'ودني الصراف'] };
  }

  // Moving by voice: short commands like "امشي لقدام" or "ادخل البيت".
  if (tokens.length <= 5 && !specific.length && amount === null) {
    for (const [words, dir] of MOVES) {
      if (!has(norm, words)) continue;
      if (dir === 'forward' && (people.length || places.length)) break;
      const line = { forward: 'يلا لقدام!', back: 'نرجع لورا.', left: 'نلف يسار ونمشي.', right: 'نلف يمين ونمشي.', out: 'يلا نطلع للشارع.', in: 'يلا ندخل البيت.' }[dir];
      return { text: say(line), actions: [{ type: 'move', dir }], suggestions: ['قدام', 'يمين', 'يسار', 'وقف'] };
    }
  }

  if (has(norm, RICH_WORDS)) {
    return {
      text: say(
        'الغنى خطوات يا {name}: أول شي اشتغل{|ي} كل يوم، شغل البيت وبرا. ثاني شي وفّر{|ي} بالبنك وهو يزيد كل يوم. ثالث شي ادخل{|ي} الشركة وترقى{|ن}، الراتب يكبر مع كل رتبة. ورابع شي استثمر{|ي} مع أبو راشد التاجر، شراكة تعطيك دخل كل يوم. من وين نبدأ؟',
      ),
      actions: [],
      suggestions: ['ودني الشركة', 'أبي أستثمر', 'شو في شغل على قدي؟', 'أبي أجمع 5000 درهم بالشهر'],
    };
  }

  if (has(norm, INVEST_WORDS) && !specific.filter((c) => c !== 'trade').length) {
    const cheapest = DEALS[0];
    if (store.netWorth < cheapest.cost)
      return {
        text: say('الاستثمار عند أبو راشد يبدأ من {cost}، ومعك {worth}. نجمع الباقي أول؟ حطيت لك هدف.', { cost: formatMoney(cheapest.cost), worth: formatMoney(store.netWorth) }),
        actions: [{ type: 'setGoal', amount: cheapest.cost - store.netWorth, days: 7, job: null }],
        suggestions: ['شو في شغل على قدي؟', 'أبي شغل أونلاين'],
      };
    return { text: say('أبو راشد التاجر عند الكرك عنده شراكات تعطيك دخل كل يوم. يلا أوديك عنده.'), actions: [{ type: 'invest' }], suggestions: ['وقف', 'وصّلني الحين'] };
  }

  if (has(norm, BOARD_WORDS) && !specific.length) {
    const fit = fittingJobs(store).slice(0, 3);
    const list = fit.map((id) => `${job(id).title} (${formatMoney(roundPay(store, id))})`).join('، ');
    return {
      text: fit.length ? say('الحين على قدك: {list}. وكل الشغل مكتوب بلوحة الوظائف قدام الشركة، يلا أوديك.', { list }) : say('الحين أغلب الشغل مسكّر. الشغل الأونلاين مفتوح دايماً. شوف{|ي} لوحة الوظائف.'),
      actions: [{ type: 'openBoard' }],
      suggestions: fit.length ? [`أبي ${job(fit[0]).title}`, 'وقف'] : ['أبي شغل أونلاين'],
    };
  }

  if (has(norm, SLEEP_WORDS) && !workish) {
    if (store.hour >= 17 || store.hour < 5) return { text: say('يلا على البيت، تصبح{|ين} على خير.'), actions: [{ type: 'sleep' }], suggestions: [] };
    return { text: say('الحين نهار يا {name}! النوم بعد المغرب. خلنا نشتغل شوي.'), actions: [], suggestions: SUGGEST };
  }

  for (const [words, action] of PHONE_WORDS) if (has(norm, words)) return { text: say('تفضل{|ي}.'), actions: [action], suggestions: [] };

  // Buying something.
  const ups = UPGRADE_WORDS.find(a.variants);
  if (ups.length && (has(norm, BUY_WORDS) || a.has('buy') || a.has('ask_price'))) {
    const u = UPGRADES.find((x) => x.id === ups[0])!;
    if (store.has(u.id)) return { text: say('{thing} عندك من قبل!', { thing: u.name }), actions: [], suggestions: SUGGEST };
    const worth = store.netWorth;
    if (worth < u.price)
      return {
        text: say('{thing} سعره {price} ومعك {worth}. باقي لك {left}. تبي{|ن} أحطه هدف وأوديك لشغل؟', { thing: u.name, price: formatMoney(u.price), worth: formatMoney(worth), left: formatMoney(u.price - worth) }),
        actions: [{ type: 'setGoal', amount: u.price - worth, days: 7, job: null }],
        suggestions: ['وين أحسن شغل الحين؟', 'أبي شغل أونلاين'],
      };
    return { text: say('يلا نشتري {thing}، أوديك للمحل.', { thing: u.name }), actions: [{ type: 'buy', upgrade: u.id }], suggestions: [] };
  }

  // Explicitly going somewhere or to someone ("ودني لأمي", "أبي أكلم جدي").
  const talkWords = has(norm, ['اكلم', 'كلم', 'احكي مع', 'اشوف', 'سلم على', 'اسلم على']);
  const explicitGo = has(norm, GO_WORDS) || a.has('ask_location') || talkWords;
  const workWords = cats.includes('work') || a.has('ask_work', 1);
  if (explicitGo && !workWords && (people.length || places.length)) return navigate();

  // Work, with or without an amount and a period.
  if (workish || amount !== null) {
    let target: JobId | null = null;
    let why = '';
    const cat = specific[0];
    if (cat === 'family') {
      target = familyJob(store);
      if (!target) why = say('أهلك اليوم ما عندهم شي ثاني، ساعدتهم بكل شي. ');
    } else if (cat === 'company') {
      target = companyJob(store);
      if (!target) why = say('الشركة مسكّرة الحين، الدوام من الساعة ثمان الصبح. ');
    } else if (cat) {
      target = cat;
      if (store.jobBlock(target) !== null) {
        // Say why, then fall back to the best job that is open right now.
        why = say(blockText(store, target)) + ' ';
        target = null;
      }
    }
    // "شغل ثاني" / "غيره": something other than what was just suggested.
    const other = !cat && last && has(norm, ['ثاني', 'ثانيه', 'غير', 'غيره', 'غيرها', 'اخر', 'شي ثاني']);
    if (!target) target = bestJob(store, [], other && last ? [last] : []) ?? bestJob(store);
    if (!target) return { text: why + say('الوقت متأخر والمحلات مسكرة. الشغل الأونلاين مفتوح دايماً، أوديك للابتوب؟'), actions: [], suggestions: ['أبي شغل أونلاين', 'أبي أنام'] };
    const per = roundPay(store, target);
    const actions: GuideAction[] = [];
    let plan = '';
    if (amount !== null && amount >= 20) {
      const d = days ?? 30;
      const daily = Math.max(1, Math.round(amount / d));
      const rounds = Math.max(1, Math.ceil(daily / Math.max(1, per)));
      actions.push({ type: 'setGoal', amount, days: d, job: target });
      plan =
        d === 1
          ? say('{amount} باليوم؟ {job} يجيب حوالي {per} للمرة، يعني تحتاج{|ين} تقريباً {times}. ', { amount: formatMoney(amount), job: job(target).title, per: formatMoney(per), times: rounds === 1 ? 'مرة وحدة' : rounds === 2 ? 'مرتين' : `${rounds} مرات` })
          : say('{amount} {period} يعني حوالي {daily} باليوم. {job} يجيب حوالي {per} للمرة، يعني {times} باليوم تكفي. وحطيت لك الهدف تحت المحفظة. ', {
              amount: formatMoney(amount),
              period: d === 30 ? 'بالشهر' : d === 7 ? 'بالأسبوع' : d === 365 ? 'بالسنة' : `خلال ${d} يوم`,
              daily: formatMoney(daily),
              job: job(target).title,
              per: formatMoney(per),
              times: rounds === 1 ? 'مرة وحدة' : rounds === 2 ? 'مرتين' : `${rounds} مرات`,
            });
    }
    actions.push({ type: 'goJob', job: target });
    const def = job(target);
    const intro =
      target === 'online'
        ? say('الشغل الأونلاين على {where}. أول مرة يسوون لك اختبار قبول قصير، وبعدها تختار{|ين} المهمة. ', { where: where(target) })
        : def.company && !store.s.flags.companyHired
          ? say('{job} في مجموعة الرزق، الراتب حوالي {per} للوردية. أول مرة الأستاذة نورة تسوي لك مقابلة قصيرة. ', { job: def.title, per: formatMoney(per) })
          : say('{job} عند {where}، الأجر حوالي {per}. ', { job: def.title, where: where(target), per: formatMoney(per) });
    return { text: why + plan + intro + say(rng.pick(['يلا أوديك!', 'تعال{|ي} معي، أوديك.', 'يلا نمشي.'])), actions, suggestions: ['وقف', 'وصّلني الحين', 'لا، أبي شغل ثاني'] };
  }

  // A bare name ("جدي", "البقالة") also means: take me there.
  if ((people.length || places.length) && tokens.length <= 3) return navigate();

  if (a.has('salam')) return { text: say('وعليكم السلام ورحمة الله يا {name}! شو تبي{|ن} نسوي اليوم؟'), actions: [], suggestions: SUGGEST };
  if (a.has('greet') || a.has('how_are_you')) return { text: say('هلا والله يا {name}! أنا سند. قول لي شو تبي{|ن} وأنا أوديك.'), actions: [], suggestions: SUGGEST };
  if (a.has('thanks')) return { text: say('العفو! أي شي ثاني؟'), actions: [], suggestions: SUGGEST };

  return {
    text: say('ما فهمت عليك تماماً. جرّب{|ي} تقول{|ين}: «أبي شغل أونلاين» أو «ودني البقالة» أو «كم معي فلوس؟».'),
    actions: [],
    suggestions: SUGGEST,
  };
}

/** Everything a language model needs to choose actions, as plain text. */
export function guideCatalogue(store: Store): string {
  const jobs = JOBS.map((j) => {
    const b = store.jobBlock(j.id);
    const st = b === null ? 'متاح' : b === 'closed' ? 'مسكّر الحين' : b === 'done' ? 'خلص اليوم' : 'يحتاج بسطة';
    return `- ${j.id}: ${j.title} عند ${where(j.id)}، حوالي ${formatMoney(roundPay(store, j.id))} للمرة (${st})`;
  }).join('\n');
  const people = NPCS.map((n) => `${n.id}=${n.name}`).join('، ');
  const places = PLACES.map((p) => `${p.id}=${p.name}`).join('، ');
  const ups = UPGRADES.map((u) => `${u.id}=${u.name} (${formatMoney(u.price)})`).join('، ');
  const rank = store.s.flags.companyHired ? `رتبته بالشركة: ${COMPANY_RANKS[store.companyRank].title}` : 'ما سوى مقابلة الشركة بعد (أول شغل بالشركة يبدأ بمقابلة)';
  const deals = DEALS.map((d) => `${d.name} بـ${formatMoney(d.cost)} يعطي ${formatMoney(d.perDay)} يومياً ${d.days} يوم`).join('، ');
  return `الشغل:\n${jobs}\n${rank}\nشراكات أبو راشد: ${deals}\nالناس: ${people}\nالأماكن: ${places}\nالمشتريات: ${ups}`;
}
