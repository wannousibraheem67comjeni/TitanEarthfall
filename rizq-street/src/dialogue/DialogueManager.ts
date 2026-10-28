/**
 * Runs one conversation at a time. The offline brain always runs first: it decides
 * the game facts of the turn (a sale, a gift, a job starting). When Claude is
 * available it then writes the character's actual words from those facts, and may
 * add a few safe actions (offer a job, point the way, end the chat), each validated.
 */
import type { Rng } from '../core/rng';
import { formatMoney } from '../lang/arabic';
import { job, JOB_BY_ID, type JobId } from '../game/catalog';
import type { Store } from '../game/state';
import { PLACE_BY_ID, PLACES, type PlaceId } from '../world/layout';
import { autoOffer, castSummary, formatClock, newConversation, opening, respond, speakerGender, type Action, type Conversation, type Reply, type Speaker } from './brain';
import type { LlmBackend, LlmTurn } from './llm';

export interface Turn extends Reply {
  source: 'offline' | 'claude';
}

const MANDATORY: Action['type'][] = ['startJob', 'pay', 'sell', 'buyUpgrade', 'completeErrand', 'returnWallet', 'snack', 'openShop', 'rep'];

export class DialogueManager {
  conv: Conversation | null = null;
  backend: LlmBackend | null = null;
  /** Last reason Claude was not used, for the settings screen. */
  lastError = '';
  private ctl: AbortController | null = null;

  constructor(
    private readonly store: Store,
    private readonly rng: Rng,
  ) {}

  open(speaker: Speaker): Turn {
    this.close();
    this.conv = newConversation(speaker, this.store);
    const r = opening(this.conv, { store: this.store, rng: this.rng });
    this.conv.turns.push({ who: 'npc', text: r.text });
    return { ...r, source: 'offline' };
  }

  /** Open a conversation in which the character offers `job` straight away. */
  openWithOffer(speaker: Speaker, jobId: JobId): Turn {
    this.close();
    this.conv = newConversation(speaker, this.store);
    const r = autoOffer(this.conv, { store: this.store, rng: this.rng }, jobId);
    this.conv.turns.push({ who: 'npc', text: r.text });
    return { ...r, source: 'offline' };
  }

  close(): void {
    this.ctl?.abort();
    this.ctl = null;
    this.conv = null;
  }

  get busy(): boolean {
    return this.ctl !== null;
  }

  async say(text: string): Promise<Turn> {
    const conv = this.conv;
    if (!conv) throw new Error('no conversation');
    const offline = respond(conv, text, { store: this.store, rng: this.rng });
    if (!this.backend) return { ...offline, source: 'offline' };
    const mandatory = offline.actions.filter((a) => MANDATORY.includes(a.type));
    const ctl = new AbortController();
    this.ctl?.abort();
    this.ctl = ctl;
    try {
      const system = this.systemPrompt(conv, offline, mandatory);
      // respond() already logged this exchange (player line, offline reply): send the
      // conversation before it, then the player's new line.
      const prior: LlmTurn[] = conv.turns.slice(0, -2).slice(-12).map((t) => ({ role: t.who === 'player' ? 'user' : 'assistant', content: t.text }));
      const turns: LlmTurn[] = [...prior, { role: 'user', content: text }];
      const decision = await this.backend.ask(system, turns, ctl.signal);
      if (ctl.signal.aborted || this.conv !== conv) throw new Error('cancelled');
      const actions = [...mandatory, ...this.validate(conv, decision.actions)];
      // Keep the non-mandatory offline actions (map marks) if Claude chose none of its own.
      if (!actions.some((a) => a.type === 'mark')) actions.push(...offline.actions.filter((a) => a.type === 'mark'));
      conv.turns[conv.turns.length - 1] = { who: 'npc', text: decision.reply };
      this.lastError = '';
      return { text: decision.reply, actions, suggestions: offline.suggestions, mood: decision.mood, source: 'claude' };
    } catch (e) {
      const code = (e as { code?: string; message?: string })?.code ?? (e as Error)?.message ?? String(e);
      if (code !== 'cancelled') this.lastError = code;
      return { ...offline, source: 'offline' };
    } finally {
      if (this.ctl === ctl) this.ctl = null;
    }
  }

  /** Turn Claude's action keys into game actions, dropping anything not allowed. */
  private validate(conv: Conversation, keys: string[]): Action[] {
    const out: Action[] = [];
    const sp = conv.speaker;
    const jobs = sp.kind === 'npc' ? sp.def.jobs : [];
    for (const key of keys) {
      const [kind, arg] = key.split(':');
      if (kind === 'offer_job' && arg && jobs.includes(arg as JobId) && arg !== 'errand' && this.store.jobBlock(arg as JobId) === null) {
        conv.pending = { kind: 'job', job: arg as JobId };
      } else if (kind === 'start_job' && arg && jobs.includes(arg as JobId) && this.store.jobBlock(arg as JobId) === null) {
        const p = conv.pending?.kind === 'job' && conv.pending.job === arg ? conv.pending : null;
        if (arg === 'errand' && !p) continue;
        out.push({ type: 'startJob', job: arg as JobId, items: p?.items, cash: p?.cash });
        conv.pending = null;
      } else if (kind === 'mark' && arg && PLACE_BY_ID.has(arg as PlaceId)) {
        out.push({ type: 'mark', place: arg as PlaceId });
      } else if (kind === 'end') {
        out.push({ type: 'end' });
      }
    }
    return out;
  }

  private systemPrompt(conv: Conversation, offline: Reply, mandatory: Action[]): string {
    const s = this.store.s;
    const sp = conv.speaker;
    const g = s.player.gender === 'm' ? 'ولد' : 'بنت';
    const who =
      sp.kind === 'npc'
        ? `${sp.def.name} (${sp.def.title}). ${sp.def.persona}`
        : `${sp.p.name}، ${speakerGender(sp) === 'f' ? 'جارة' : 'جار'} من أهل الفريج ماشي بالشارع. ودود ومختصر، يتكلم باللهجة الإماراتية.${sp.ownsWallet ? ' ضاعت محفظته اليوم.' : ''}`;
    const jobs =
      sp.kind === 'npc' && sp.def.jobs.length
        ? sp.def.jobs
            .map((id) => {
              const b = this.store.jobBlock(id);
              const st = b === null ? 'متاح الآن' : b === 'closed' ? 'مسكّر الحين' : b === 'done' ? 'خلص اليوم' : 'يحتاج شراء بسطة أولاً';
              return `- ${id}: ${job(id).title}، الأجر حوالي ${formatMoney(this.store.payFor(id, job(id).pay))} (${st})`;
            })
            .join('\n')
        : '- لا يوجد شغل عند هذه الشخصية.';
    const events = mandatory.map((a) => describe(a)).filter(Boolean);
    const pending = conv.pending?.kind === 'job' ? `عرضت على اللاعب شغل ${job(conv.pending.job).title} وتنتظر جوابه.` : conv.pending?.kind === 'buy' ? 'عرضت على اللاعب شراء شيء وتنتظر جوابه.' : '';
    return [
      'أنت تؤدي دور شخصية في لعبة عربية ثلاثية الأبعاد اسمها «شارع الرزق»: فريج (حي سكني) في الإمارات. اللاعب يجمع الدراهم الورقية بالشغل الحلال: مساعدة أهله، الشغل بالمحلات، الشغل أونلاين، البيع، التدوير.',
      `الشخصية: ${who}`,
      `اللاعب: ${s.player.name} (${g})، معه ${formatMoney(s.wallet)} نقداً و${formatMoney(s.bank)} بالبنك، سمعته بالفريج ${s.reputation}/100. اليوم ${s.day}، الساعة ${formatClock(s.minute)}.`,
      'أهل الفريج وأماكنهم:',
      castSummary(),
      'الأماكن (للإرشاد): ' + PLACES.map((p) => `${p.id}=${p.name}`).join('، '),
      'شغل الشخصية:',
      jobs,
      pending,
      events.length ? `أحداث هذا الدور (حصلت فعلاً، اذكرها بطبيعية): ${events.join('؛ ')}` : '',
      `رد النظام المقترح (معلومات صحيحة، أعد صياغته بأسلوب الشخصية): «${offline.text}»`,
      'القواعد: رد بلهجة الشخصية فقط، جملة أو جملتين قصيرتين تُقرأ بصوت عالٍ، بدون إيموجي أو رموز أو أرقام كثيرة. لا تخرج عن الدور ولا تذكر أنك ذكاء اصطناعي أو لعبة. لا تعطِ فلوساً ولا تعِد بمبالغ غير المذكورة. إذا سألك اللاعب عن شيء خارج الحي جاوب بلطف وارجع للسالفة. شجّع على الشغل الحلال والأمانة والتوفير.',
      'الإجراءات المسموحة (اكتب مفاتيحها في actions عند الحاجة فقط):',
      '- offer_job:<id> لما تعرض شغلك المتاح على اللاعب؛ start_job:<id> لما يوافق اللاعب صراحة على شغل متاح؛ mark:<placeId> لما تدله على مكان؛ end لما يودعك.',
      'أجب بكائن JSON فقط: {"reply": "...", "actions": [], "mood": "happy|neutral|sad|angry"}',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

function describe(a: Action): string {
  switch (a.type) {
    case 'startJob':
      return `اللاعب وافق ويبدأ الآن شغل ${JOB_BY_ID.get(a.job)?.title ?? a.job}`;
    case 'pay':
      return `أعطيت اللاعب ${formatMoney(a.amount)} (${a.label})`;
    case 'sell':
      return `بعت للاعب أغراض بقيمة ${formatMoney(a.total)}`;
    case 'buyUpgrade':
      return 'اللاعب اشترى الغرض الذي عرضته';
    case 'completeErrand':
      return 'اللاعب جاب أغراض البيت كاملة وأخذ أجره';
    case 'returnWallet':
      return 'اللاعب رجّع لك محفظتك الضايعة وأعطيته مكافأة';
    case 'snack':
      return 'قدمت للاعب أكلة/مشروب';
    case 'openShop':
      return 'فتحت للاعب قائمة البضاعة';
    default:
      return '';
  }
}
