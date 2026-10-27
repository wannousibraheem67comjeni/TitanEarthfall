/**
 * The offline brain: turns what the player said into a character's reply and the game
 * actions it implies (start a job, sell something, point the way). It works without a
 * network, and it is the fallback whenever the language model is unavailable.
 */
import type { Rng } from '../core/rng';
import { fillTemplate, formatMoney, priceWith, toPlace, type Gender } from '../lang/arabic';
import { analyze, Lexicon, type Analysis } from '../lang/intents';
import { GROCERY_ITEMS, JOBS, UPGRADES, item, job, type ItemId, type JobId, type NpcId, type UpgradeId } from '../game/catalog';
import type { Store } from '../game/state';
import { PLACES, place, type PlaceId } from '../world/layout';
import { npc as npcDef, NPCS, type NpcDef, type NpcLines } from './npcs';
import { PASSERBY_LINES, type Passerby } from './pedestrians';

export type Action =
  | { type: 'startJob'; job: JobId; items?: ItemId[]; cash?: number }
  | { type: 'pay'; amount: number; label: string }
  | { type: 'sell'; lines: { id: ItemId; qty: number }[]; total: number }
  | { type: 'buyUpgrade'; id: UpgradeId }
  | { type: 'snack'; name: string; price: number }
  | { type: 'openShop'; shop: 'grocery' | 'electronics' }
  | { type: 'mark'; place: PlaceId }
  | { type: 'completeErrand' }
  | { type: 'returnWallet' }
  | { type: 'rep'; delta: number }
  | { type: 'end' };

export interface Reply {
  text: string;
  actions: Action[];
  suggestions: string[];
  mood: 'happy' | 'neutral' | 'sad' | 'angry';
}

export type Pending = { kind: 'job'; job: JobId; items?: ItemId[]; cash?: number } | { kind: 'buy'; upgrade: UpgradeId } | null;

/** Who the player is talking to: a named character or a passer-by. */
export type Speaker = { kind: 'npc'; def: NpcDef } | { kind: 'passerby'; p: Passerby; ownsWallet: boolean };

export interface Conversation {
  speaker: Speaker;
  turns: { who: 'player' | 'npc'; text: string }[];
  pending: Pending;
  politeCredited: boolean;
  salamCredited: boolean;
  /** The character already said hello in the opening line. */
  greeted: boolean;
  startedDay: number;
}

export interface BrainWorld {
  store: Store;
  rng: Rng;
}

export function speakerName(sp: Speaker): string {
  return sp.kind === 'npc' ? sp.def.name : sp.p.name;
}

export function speakerGender(sp: Speaker): Gender {
  return sp.kind === 'npc' ? sp.def.gender : sp.p.gender;
}

export function speakerId(sp: Speaker): string {
  return sp.kind === 'npc' ? sp.def.id : sp.p.key;
}

const placeLexicon = new Lexicon<PlaceId>(PLACES.map((p) => ({ id: p.id, phrases: p.phrases })));
const itemLexicon = new Lexicon<ItemId>(GROCERY_ITEMS.map((i) => ({ id: i.id, phrases: i.phrases })));
const jobLexicon = new Lexicon<JobId>(JOBS.map((j) => ({ id: j.id, phrases: j.phrases })));
const upgradeLexicon = new Lexicon<UpgradeId>([
  { id: 'sneakers', phrases: ['حذاء', 'جوتي', 'جزمه', 'كوتشي', 'سنيكرز', 'حذاء رياضي'] },
  { id: 'bike', phrases: ['دراجه', 'سيكل', 'بسكليت', 'عجله', 'bike'] },
  { id: 'phone', phrases: ['جوال', 'تلفون', 'موبايل', 'هاتف', 'phone'] },
  { id: 'laptop', phrases: ['لابتوب', 'كمبيوتر', 'حاسوب', 'laptop'] },
  { id: 'scooter', phrases: ['سكوتر', 'scooter'] },
  { id: 'stall', phrases: ['بسطه', 'عربيه بيع', 'stall'] },
  { id: 'cooler', phrases: ['ثلاجه', 'كولر', 'برادة', 'cooler'] },
  { id: 'gift', phrases: ['هديه', 'هدية لامي', 'عقد', 'ذهب'] },
  { id: 'shop', phrases: ['محل خاص', 'كشك', 'محلي الخاص', 'محل لي'] },
]);
const MUM_MENTION = new Lexicon<'mum'>([{ id: 'mum', phrases: ['امي', 'ماما', 'اغراض امي', 'مقاضي', 'المقاضي', 'اغراض البيت', 'يمه', 'لامي'] }]);
const SNACK_WORDS = {
  karak: new Lexicon<'karak'>([{ id: 'karak', phrases: ['كرك', 'كوب', 'شاي', 'استكانه', 'قهوه'] }]),
  shawarma: new Lexicon<'shawarma'>([{ id: 'shawarma', phrases: ['شاورما', 'سندويش*', 'ساندويش*', 'لفه', 'عشا', 'غدا', 'اكل'] }]),
};

const SELLERS: Partial<Record<NpcId, UpgradeId[]>> = {
  electro: ['sneakers', 'bike', 'phone', 'laptop', 'scooter', 'shop'],
  grocer: ['stall', 'cooler'],
  dad: ['gift'],
};

function pick(rng: Rng, lines: string[] | undefined, fallback = ''): string {
  return lines && lines.length ? rng.pick(lines) : fallback;
}

/** Fill a line for this conversation: player gender and name, speaker gender, vars. */
export function render(conv: Conversation, store: Store, template: string, vars: Record<string, string | number> = {}): string {
  const g = speakerGender(conv.speaker);
  const withSpeaker = template.replace(/\{p:([^{}]*)\}/g, (_, f: string) => (g === 'f' ? f : ''));
  return fillTemplate(withSpeaker, store.s.player.gender, { name: store.s.player.name, pname: speakerName(conv.speaker), ...vars });
}

export function newConversation(speaker: Speaker, store: Store): Conversation {
  return { speaker, turns: [], pending: null, politeCredited: false, salamCredited: false, greeted: false, startedDay: store.s.day };
}

/** "3:20 العصر" */
export function formatClock(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = Math.floor(minute % 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 < 4 ? 'بعد نص الليل' : h24 < 6 ? 'الفجر' : h24 < 12 ? 'الصبح' : h24 < 14 ? 'الظهر' : h24 < 17 ? 'العصر' : h24 < 19 ? 'المغرب' : 'الليل';
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function listText(items: ItemId[]): string {
  const names = items.map((i) => item(i).name);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(' و') + ' و' + names[names.length - 1];
}

/** Jobs someone else on the street can give right now, for recommendations. */
export function openJobsElsewhere(store: Store, except: NpcId | null): JobId[] {
  return JOBS.filter((j) => j.employer && j.employer !== except && j.id !== 'trash' && store.jobBlock(j.id) === null).map((j) => j.id);
}

function recommend(conv: Conversation, w: BrainWorld, except: NpcId | null): { text: string; actions: Action[] } {
  const open = openJobsElsewhere(w.store, except);
  if (!open.length) {
    return { text: render(conv, w.store, 'الوقت متأخر والمحلات بتسكر. اشتغل{|ي} أونلاين من اللابتوب بالبيت، أو اجمع{|ي} العلب للتدوير.'), actions: [{ type: 'mark', place: 'home' }] };
  }
  const first = job(w.rng.pick(open));
  const boss = first.employer === 'dad' ? 'أبوك' : first.employer === 'mum' ? 'أمك' : npcDef(first.employer!).name;
  const where = place(first.place);
  return {
    text: render(conv, w.store, `${boss} يبي أحد ${first.need}. روح{|ي} ${toPlace(where.name)}، حطيت لك علامة.`),
    actions: [{ type: 'mark', place: first.place }],
  };
}

function suggestionsFor(conv: Conversation, w: BrainWorld): string[] {
  if (conv.pending?.kind === 'job') return ['إي، يلا!', 'كم بتعطيني؟', 'لا، بعدين'];
  if (conv.pending?.kind === 'buy') return ['إي، بشتريه', 'غالي شوي', 'لا شكراً'];
  const out = ['عندك شغل؟', 'كيف أجمع فلوس؟'];
  const sp = conv.speaker;
  if (sp.kind === 'npc') {
    switch (sp.def.id) {
      case 'grocer':
        out.unshift('أبي أشتري أغراض');
        if (w.store.s.errand) out.unshift('أبي أغراض أمي');
        break;
      case 'electro':
        out.unshift('شو عندك للبيع؟');
        break;
      case 'grandpa':
        out.unshift('سولف لي عن زمان');
        break;
      case 'karak':
        out.unshift('عطني كرك');
        break;
      case 'shawarma':
        out.unshift('أبي شاورما');
        break;
      case 'mum':
        if (w.store.s.errand) out.unshift('جبت الأغراض');
        break;
      case 'ali':
        out.unshift('قول لي نكتة');
        break;
    }
  } else if (sp.ownsWallet && w.store.count('wallet') > 0) {
    out.unshift('لقيت هالمحفظة، هي لك؟');
  }
  out.push('وين البقالة؟', 'مع السلامة');
  return out.slice(0, 5);
}

/** What a character says when the player walks up and opens the conversation. */
export function opening(conv: Conversation, w: BrainWorld): Reply {
  const { store, rng } = w;
  const sp = conv.speaker;
  const actions: Action[] = [];
  let text: string;
  if (sp.kind === 'passerby') {
    conv.greeted = true;
    text = render(conv, store, pick(rng, PASSERBY_LINES.greet));
    return { text, actions, suggestions: suggestionsFor(conv, w), mood: 'neutral' };
  }
  const def = sp.def;
  const mem = store.npc(def.id);
  const first = !mem.met;
  mem.met = true;
  mem.talks++;
  mem.lastTalkDay = store.s.day;
  conv.greeted = true;
  text = render(conv, store, pick(rng, def.lines.greet));

  // First conversation with mum doubles as the tutorial.
  if (def.id === 'mum' && first) {
    const offer = offerJob(conv, w, 'plants');
    text = render(conv, store, 'صباح الخير يا {name}! قلت لي أمس تبي{|ن} تجمع{|ين} فلوس؟ الدراهم ما تيي إلا بالتعب. ') + offer.text;
    return { text, actions, suggestions: suggestionsFor(conv, w), mood: 'happy' };
  }
  if (def.id === 'mum' && store.s.errand && hasErrandItems(store)) {
    return finishErrand(conv, w);
  }
  if (def.id === 'grandpa' && mem.giftDay !== store.s.day) {
    // The daily gift comes after a proper greeting; nudge toward one.
    text += render(conv, store, ' سلم{|ي} على جدك أول!');
  } else {
    const avail = def.jobs.find((j) => store.jobBlock(j) === null);
    if (avail && first) text += render(conv, store, ' وعندي شغل لك إذا حاب{|ة}.');
  }
  return { text, actions, suggestions: suggestionsFor(conv, w), mood: 'happy' };
}

function hasErrandItems(store: Store): boolean {
  const e = store.s.errand;
  if (!e) return false;
  const need = new Map<ItemId, number>();
  for (const i of e.items) need.set(i, (need.get(i) ?? 0) + 1);
  for (const [id, n] of need) if (store.count(id) < n) return false;
  return true;
}

function finishErrand(conv: Conversation, w: BrainWorld): Reply {
  const pay = w.store.payFor('errand', job('errand').pay) * (w.store.has('gift') ? 2 : 1);
  return {
    text: render(conv, w.store, 'جبت{|ي} كل الأغراض! تسلم{|ين} يا عيني، هذي {pay} لك.', { pay: formatMoney(pay) }),
    actions: [{ type: 'completeErrand' }],
    suggestions: ['العفو يا ماما', 'عندك شغل ثاني؟', 'مع السلامة'],
    mood: 'happy',
  };
}

function offerJob(conv: Conversation, w: BrainWorld, id: JobId): { text: string; ok: boolean } {
  const { store, rng } = w;
  const def = conv.speaker.kind === 'npc' ? conv.speaker.def : null;
  if (!def) return { text: '', ok: false };
  const block = store.jobBlock(id);
  if (block === 'closed') return { text: render(conv, store, pick(rng, def.lines.closed)), ok: false };
  if (block === 'done') return { text: render(conv, store, pick(rng, def.lines.doneToday)), ok: false };
  if (block === 'locked') return { text: render(conv, store, 'تحتاج{|ين} أول شي تشتري{|ن} بسطة. رحيم بالبقالة يبيعها.'), ok: false };
  const base = job(id).pay;
  const pay = formatMoney(store.payFor(id, base) * (id !== 'errand' && job(id).family && store.has('gift') ? 2 : 1));
  if (id === 'errand') {
    const items = rng.shuffle(GROCERY_ITEMS.filter((i) => i.price <= 12)).slice(0, rng.int(2, 3)).map((i) => i.id);
    const cost = items.reduce((s, i) => s + item(i).price, 0);
    const cash = Math.ceil((cost + 1) / 5) * 5;
    conv.pending = { kind: 'job', job: id, items, cash };
    return { text: render(conv, store, pick(rng, def.lines.pitch[id]), { pay, list: listText(items), cash: formatMoney(cash) }), ok: true };
  }
  conv.pending = { kind: 'job', job: id };
  return { text: render(conv, store, pick(rng, def.lines.pitch[id], 'عندي شغل لك، تبي{|ن}؟'), { pay }), ok: true };
}

/** Main entry: the player said `text` in conversation `conv`. */
export function respond(conv: Conversation, text: string, w: BrainWorld): Reply {
  const a = analyze(text);
  conv.turns.push({ who: 'player', text });
  const reply = conv.speaker.kind === 'npc' ? respondNpc(conv, a, w, conv.speaker.def) : respondPasserby(conv, a, w, conv.speaker);
  conv.turns.push({ who: 'npc', text: reply.text });
  return reply;
}

function courtesy(conv: Conversation, a: Analysis, w: BrainWorld, lines: { salam?: string[]; greet: string[] }, parts: string[], actions: Action[]): void {
  const { store, rng } = w;
  if (a.has('salam')) {
    parts.push(render(conv, store, pick(rng, lines.salam, 'وعليكم السلام ورحمة الله.')));
    if (!conv.salamCredited) {
      conv.salamCredited = true;
      actions.push({ type: 'rep', delta: 1 });
    }
  } else if (a.has('greet') && !a.has('how_are_you')) {
    parts.push(render(conv, store, conv.greeted ? pick(rng, ['هلا فيك.', 'هلا والله.', 'أهلين.', 'مرحبتين.']) : pick(rng, lines.greet)));
    conv.greeted = true;
  }
  if (a.has('please') && !conv.politeCredited) {
    conv.politeCredited = true;
    actions.push({ type: 'rep', delta: 1 });
  }
}

function respondNpc(conv: Conversation, a: Analysis, w: BrainWorld, def: NpcDef): Reply {
  const { store, rng } = w;
  const L: NpcLines = def.lines;
  const parts: string[] = [];
  const actions: Action[] = [];
  let mood: Reply['mood'] = 'neutral';
  const mem = store.npc(def.id);
  const say = (line: string, vars: Record<string, string | number> = {}) => parts.push(render(conv, store, line, vars));
  const done = (): Reply => {
    if (!parts.length) say(pick(rng, L.fallback));
    else if (conv.pending && !actions.length && pendingBefore === conv.pending) say(conv.pending.kind === 'job' ? 'ها، شو قلت{|ي}؟ تبي{|ن}؟' : 'ها، تاخذه؟');
    return { text: parts.join(' '), actions, suggestions: suggestionsFor(conv, w), mood };
  };
  const pendingBefore = conv.pending;

  if (a.has('insult', 0.9)) {
    say(pick(rng, L.insulted));
    mem.affinity -= 10;
    actions.push({ type: 'rep', delta: -3 });
    conv.pending = null;
    mood = 'angry';
    return done();
  }

  courtesy(conv, a, w, L, parts, actions);

  // Grandpa's daily gift, earned by greeting him properly.
  if (def.id === 'grandpa' && mem.giftDay !== store.s.day && (a.has('salam') || a.has('greet') || a.has('how_are_you'))) {
    mem.giftDay = store.s.day;
    const gift = 10 + Math.round(store.s.reputation / 10) + (a.has('salam') ? 5 : 0);
    say('خذ{|ي} هذي {gift} عيدية من جدك. والله يرضى عليك، بس لا تصرفها كلها!', { gift: formatMoney(gift) });
    actions.push({ type: 'pay', amount: gift, label: 'عيدية من جدي' });
    mood = 'happy';
  }

  // Answering an open offer comes first.
  if (conv.pending) {
    const p = conv.pending;
    if (a.has('ask_pay') && p.kind === 'job') {
      say('الأجر حوالي {pay}، ويزيد كل ما صرت{|ي} أشطر.', { pay: formatMoney(store.payFor(p.job, job(p.job).pay)) });
      return done();
    }
    if (a.has('negotiate')) {
      say(p.kind === 'job' ? 'الأجر على قد الشغل يا {name}. اشتغل{|ي} زين ويزيد البقشيش.' : 'السعر ثابت يا {name}، بس والله يستاهل. فكر{|ي} فيها.');
      return done();
    }
    if (a.has('decline') && a.score('decline') >= a.score('accept')) {
      say(pick(rng, p.kind === 'job' ? L.declined : ['ولا يهمك، فكر{|ي} فيها.']));
      conv.pending = null;
      return done();
    }
    if (a.has('accept') || a.has('fine') || a.has('ask_work')) {
      conv.pending = null;
      if (p.kind === 'job') {
        say(pick(rng, L.accepted));
        actions.push({ type: 'startJob', job: p.job, items: p.items, cash: p.cash });
        mood = 'happy';
      } else {
        const u = UPGRADES.find((x) => x.id === p.upgrade)!;
        if (store.s.wallet >= u.price) {
          say('مبروك! {thing} صار لك.', { thing: u.name });
          actions.push({ type: 'buyUpgrade', id: u.id });
          mood = 'happy';
        } else {
          say('سعره {price} وما معك إلا {wallet}. اجمع{|ي} وتعال{|ي}، وإذا فلوسك بالبنك اسحبها من الصراف.', { price: formatMoney(u.price), wallet: formatMoney(store.s.wallet) });
        }
      }
      return done();
    }
  }

  // Character-specific business.
  const special = businessReply(conv, a, w, def, say, actions);
  if (special === 'handled') {
    if (actions.some((x) => x.type === 'sell' || x.type === 'buyUpgrade' || x.type === 'completeErrand')) mood = 'happy';
    return done();
  }

  // Naming one of this character's jobs ("عندك مقاضي؟", "أبي أوصل طلبات") counts as asking for it.
  const named = jobLexicon.find(a.variants).filter((j) => def.jobs.includes(j));
  if (a.has('ask_work') || a.has('ask_pay') || (named.length > 0 && !a.has('decline'))) {
    const order = named.length ? named : def.jobs;
    let offered = false;
    let lastBlockLine = '';
    for (const id of order) {
      const res = offerJob(conv, w, id);
      if (res.ok) {
        say(res.text);
        offered = true;
        break;
      }
      lastBlockLine = res.text;
    }
    if (!offered) {
      if (def.jobs.length === 0) say(pick(rng, L.noWork, 'ما عندي شغل لك الحين.'));
      else if (lastBlockLine) parts.push(lastBlockLine);
      const rec = recommend(conv, w, def.id);
      parts.push(rec.text);
      actions.push(...rec.actions);
    }
    return done();
  }

  if (a.has('money_advice')) {
    say(pick(rng, L.advice));
    if (def.jobs.some((j) => store.jobBlock(j) === null)) say('وأنا عندي شغل لك إذا تبي{|ن}، قول{|ي} بس.');
    else {
      const rec = recommend(conv, w, def.id);
      parts.push(rec.text);
      actions.push(...rec.actions);
    }
    return done();
  }

  if (a.has('ask_location')) {
    const places = placeLexicon.find(a.variants).filter((p) => p !== def.place || def.id === 'mum');
    if (places.length) {
      const p = place(places[0]);
      say(`${p.name} ${p.hint}. حطيت لك علامة.`);
      actions.push({ type: 'mark', place: p.id });
    } else {
      say('وين تبي{|ن} تروح{|ين}؟ البقالة، الكرك، المطعم، محل العطور، المغسلة، الحديقة؟');
    }
    return done();
  }

  if (a.has('wallet_found') && store.count('wallet') > 0) {
    say('هذي مب محفظتي. دور{|ي} على صاحبها، شوف{|ي} العلامة على الخريطة.');
    return done();
  }

  const ranked = a.ranked;
  for (const intent of ranked) {
    switch (intent) {
      case 'how_are_you':
        say(pick(rng, L.howAreYou));
        break;
      case 'fine':
        if (!parts.length) say('الحمد لله، دوم يا رب.');
        break;
      case 'ask_name':
      case 'ask_about':
        say(pick(rng, L.about));
        break;
      case 'thanks':
        say(pick(rng, L.thanks));
        mood = 'happy';
        break;
      case 'bye':
        say(pick(rng, L.bye));
        actions.push({ type: 'end' });
        break;
      case 'ask_time':
        say('الساعة الحين {time}.', { time: formatClock(store.s.minute) });
        break;
      case 'weather':
        say(store.hour > 10 && store.hour < 17 ? 'الجو حر اليوم، اشرب{|ي} ماي وخلك بالظل.' : 'الجو الحين حلو، أحسن وقت للمشي.');
        break;
      case 'story':
        say(pick(rng, L.story));
        mood = 'happy';
        break;
      case 'compliment':
        say(pick(rng, L.compliment));
        mem.affinity += 2;
        mood = 'happy';
        break;
      case 'apology':
        say('خلاص، ما صار شي. الله يسامحنا كلنا.');
        mem.affinity += 3;
        break;
      case 'help':
        say('تقدر{|ين} تشتغل{|ين} عند أهل الفريج: اسألهم "عندك شغل؟". وجوالك (زر Tab) فيه قائمة الشغل والأهداف والمتجر.');
        break;
      case 'family':
        if (parts.length) continue;
        say(def.id === 'mum' || def.id === 'dad' || def.id === 'grandpa' ? 'الأهل نعمة يا {name}، بر الوالدين بركة.' : 'سلم{|ي} على أهلك، ناس طيبين.');
        break;
      case 'ask_price':
        say(def.jobs.length ? 'الشغل عندي أجره حوالي {pay}.' : 'شوف{|ي} الأسعار مكتوبة.', { pay: formatMoney(def.jobs.length ? store.payFor(def.jobs[0], job(def.jobs[0]).pay) : 0) });
        break;
      default:
        continue;
    }
    if (parts.length >= 2) break;
  }
  return done();
}

/**
 * Selling, errands and shop talk specific to each character. Returns 'handled' when
 * the reply is complete.
 */
function businessReply(conv: Conversation, a: Analysis, w: BrainWorld, def: NpcDef, say: (line: string, vars?: Record<string, string | number>) => void, actions: Action[]): 'handled' | null {
  const { store } = w;
  const buying = a.has('buy', 0.4) || a.has('accept') || a.has('ask_price');

  if (def.id === 'mum' && store.s.errand) {
    if (hasErrandItems(store)) {
      const r = finishErrand(conv, w);
      say(r.text);
      actions.push(...r.actions);
      return 'handled';
    }
    if (MUM_MENTION.find(a.variants).length || a.has('wallet_found') || a.has('ask_work')) {
      say('بعدك ما جبت{|ي} الأغراض! أبي {list} من بقالة النور.', { list: listText(store.s.errand.items) });
      actions.push({ type: 'mark', place: 'grocery' });
      return 'handled';
    }
  }

  if (def.id === 'grocer') {
    if (store.s.errand && MUM_MENTION.find(a.variants).length) {
      return sell(w, store.s.errand.items.map((id) => ({ id, qty: 1 })), say, actions);
    }
    const items = itemLexicon.find(a.variants);
    if (items.length && (buying || a.numbers.length || a.ranked.length === 0)) {
      // Pair quantities with items in the order they were said: "2 خبز وحليب".
      const lines = items.map((id, i) => ({ id, qty: Math.max(1, Math.min(10, Math.round(a.numbers[i] ?? 1))) }));
      if (a.has('ask_price') && !a.has('buy', 0.9)) {
        say(lines.map((l) => `${item(l.id).name} ${priceWith(item(l.id).price)}`).join('، ') + '. تبي{|ن}؟');
        return 'handled';
      }
      return sell(w, lines, say, actions);
    }
    if (a.has('buy', 0.9) || a.has('ask_about')) {
      say('تفضل{|ي}، هذي الرفوف قدامك. قول{|ي} لي شو تبي{|ن}: خبز، حليب، ماي، عصير…');
      actions.push({ type: 'openShop', shop: 'grocery' });
      return 'handled';
    }
  }

  if (def.id === 'karak' && SNACK_WORDS.karak.find(a.variants).length && (buying || a.ranked.length <= 1) && !a.has('ask_work')) {
    return snack(w, 'كوب كرك', 2, say, actions);
  }
  if (def.id === 'shawarma' && SNACK_WORDS.shawarma.find(a.variants).length && (buying || a.ranked.length <= 1) && !a.has('ask_work')) {
    return snack(w, 'سندويشة شاورما', 7, say, actions);
  }

  const sells = SELLERS[def.id];
  if (sells) {
    const wanted = upgradeLexicon.find(a.variants).filter((u) => sells.includes(u));
    if (wanted.length && (buying || a.ranked.length <= 1)) {
      const u = UPGRADES.find((x) => x.id === wanted[0])!;
      if (store.has(u.id)) {
        say('{thing} عندك من قبل!', { thing: u.name });
        return 'handled';
      }
      conv.pending = { kind: 'buy', upgrade: u.id };
      say('{thing} {price}. {effect}. تبي{|ن}ه؟', { thing: u.name, price: priceWith(u.price), effect: u.effect });
      return 'handled';
    }
    if (def.id === 'electro' && (a.has('ask_about') || a.has('buy', 0.9) || a.has('ask_price'))) {
      say('تفضل{|ي} شوف{|ي}: أحذية رياضية، دراجات، جوالات، لابتوبات وسكوترات. كل شي بسعر حلو.');
      actions.push({ type: 'openShop', shop: 'electronics' });
      return 'handled';
    }
  }
  return null;
}

function sell(w: BrainWorld, lines: { id: ItemId; qty: number }[], say: (line: string, vars?: Record<string, string | number>) => void, actions: Action[]): 'handled' {
  const total = lines.reduce((s, l) => s + item(l.id).price * l.qty, 0);
  const text = lines.map((l) => (l.qty > 1 ? `${l.qty} ${item(l.id).name}` : item(l.id).name)).join(' و');
  if (w.store.s.wallet < total) {
    say('{list} حسابها {total}، وما معك يكفي يا {name}.', { list: text, total: formatMoney(total) });
    return 'handled';
  }
  say('تفضل{|ي}، {list}. الحساب {total}.', { list: text, total: formatMoney(total) });
  actions.push({ type: 'sell', lines, total });
  return 'handled';
}

function snack(w: BrainWorld, name: string, price: number, say: (line: string, vars?: Record<string, string | number>) => void, actions: Action[]): 'handled' {
  if (w.store.s.wallet < price) {
    say('{thing} {price}، بس ما معك فلوس. خلها علي هالمرة!', { thing: name, price: priceWith(price) });
    actions.push({ type: 'snack', name, price: 0 });
    return 'handled';
  }
  say('تفضل{|ي} {thing}، بالعافية! يعطيك طاقة للشغل.', { thing: name });
  actions.push({ type: 'snack', name, price });
  return 'handled';
}

function respondPasserby(conv: Conversation, a: Analysis, w: BrainWorld, sp: { p: Passerby; ownsWallet: boolean }): Reply {
  const { store, rng } = w;
  const L = PASSERBY_LINES;
  const parts: string[] = [];
  const actions: Action[] = [];
  let mood: Reply['mood'] = 'neutral';
  const say = (line: string, vars: Record<string, string | number> = {}) => parts.push(render(conv, store, line, vars));

  if (a.has('insult', 0.9)) {
    say(pick(rng, L.insulted));
    actions.push({ type: 'rep', delta: -2 });
    return { text: parts.join(' '), actions, suggestions: suggestionsFor(conv, w), mood: 'angry' };
  }
  courtesy(conv, a, w, L, parts, actions);

  if (sp.ownsWallet && store.count('wallet') > 0 && (a.has('wallet_found') || a.has('accept') || a.has('salam') || a.has('greet') || conv.turns.length <= 2)) {
    say(pick(rng, L.walletOwner));
    actions.push({ type: 'returnWallet' });
    return { text: parts.join(' '), actions, suggestions: ['العفو، هذا واجبي', 'مع السلامة'], mood: 'happy' };
  }

  if (a.has('ask_location')) {
    const places = placeLexicon.find(a.variants);
    if (places.length) {
      const p = place(places[0]);
      say(`${p.name}؟ ${p.hint}.`);
      actions.push({ type: 'mark', place: p.id });
    } else say('وين تبي{|ن}؟ قول{|ي} اسم المكان.');
  } else if (a.has('ask_work') || a.has('money_advice')) {
    say(pick(rng, L.noWork));
    const rec = recommend(conv, w, null);
    parts.push(rec.text);
    actions.push(...rec.actions);
  } else {
    for (const intent of a.ranked) {
      if (intent === 'how_are_you') say(pick(rng, L.howAreYou));
      else if (intent === 'ask_name' || intent === 'ask_about') say(pick(rng, L.about));
      else if (intent === 'thanks') say(pick(rng, L.thanks));
      else if (intent === 'bye') {
        say(pick(rng, L.bye));
        actions.push({ type: 'end' });
      } else if (intent === 'compliment') {
        say(pick(rng, L.compliment));
        mood = 'happy';
      } else if (intent === 'story') say(pick(rng, L.story));
      else if (intent === 'ask_time') say('الساعة {time}.', { time: formatClock(store.s.minute) });
      else continue;
      if (parts.length >= 2) break;
    }
  }
  if (!parts.length) say(pick(rng, L.fallback));
  return { text: parts.join(' '), actions, suggestions: suggestionsFor(conv, w), mood };
}

/** Every named character, for the language-model prompt's cast list. */
export function castSummary(): string {
  return NPCS.map((n) => `- ${n.name} (${n.title}) في ${place(n.place).name}${n.jobs.length ? `، يعطي شغل: ${n.jobs.map((j) => job(j).title).join('، ')}` : ''}`).join('\n');
}

