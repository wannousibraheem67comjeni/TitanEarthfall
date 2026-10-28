/**
 * The guide's brain: the offline parser always runs and proposes a plan; when Claude
 * is available it words the answer and may choose different actions from the same
 * fixed list, each checked before the game acts on it.
 */
import type { Rng } from '../core/rng';
import { formatMoney } from '../lang/arabic';
import { JOB_BY_ID, UPGRADE_BY_ID, type JobId, type NpcId, type UpgradeId } from '../game/catalog';
import type { Store } from '../game/state';
import { PLACE_BY_ID, type PlaceId } from '../world/layout';
import { formatClock } from './brain';
import { guideCatalogue, guideRespond, MOVE_DIRS, type GuideAction, type GuideReply, type MoveDir } from './guide';
import type { LlmBackend, LlmTurn } from './llm';
import { NPC_BY_ID } from './npcs';

const TABS = ['home', 'jobs', 'shop', 'wallet', 'awards', 'settings'] as const;

/** Offline actions as the action keys the model reads and writes. */
export function actionKey(a: GuideAction): string {
  switch (a.type) {
    case 'goJob':
      return `go_job:${a.job}`;
    case 'goPlace':
      return `go_place:${a.place}`;
    case 'talkTo':
      return `talk:${a.npc}`;
    case 'setGoal':
      return `set_goal:${a.amount}:${a.days}${a.job ? `:${a.job}` : ''}`;
    case 'openPhone':
      return `open_phone:${a.tab}`;
    case 'buy':
      return `buy:${a.upgrade}`;
    case 'move':
      return `move:${a.dir}`;
    case 'openBoard':
      return 'open_board';
    default:
      return a.type;
  }
}

/** Parse and validate one action key from the model; null when not allowed. */
export function parseActionKey(key: string): GuideAction | null {
  const [kind, x, y, z] = key.trim().split(':');
  switch (kind) {
    case 'go_job':
      return JOB_BY_ID.has(x as JobId) ? { type: 'goJob', job: x as JobId } : null;
    case 'go_place':
      return PLACE_BY_ID.has(x as PlaceId) ? { type: 'goPlace', place: x as PlaceId } : null;
    case 'talk':
      return NPC_BY_ID.has(x as NpcId) ? { type: 'talkTo', npc: x as NpcId } : null;
    case 'set_goal': {
      const amount = Number(x);
      const days = Number(y);
      if (!(amount >= 1 && amount <= 1_000_000 && days >= 1 && days <= 3650)) return null;
      return { type: 'setGoal', amount, days, job: z && JOB_BY_ID.has(z as JobId) ? (z as JobId) : null };
    }
    case 'open_phone':
      return (TABS as readonly string[]).includes(x) ? { type: 'openPhone', tab: x as (typeof TABS)[number] } : null;
    case 'buy':
      return UPGRADE_BY_ID.has(x as UpgradeId) ? { type: 'buy', upgrade: x as UpgradeId } : null;
    case 'move':
      return (MOVE_DIRS as string[]).includes(x) ? { type: 'move', dir: x as MoveDir } : null;
    case 'open_board':
      return { type: 'openBoard' };
    case 'invest':
      return { type: 'invest' };
    case 'sleep':
      return { type: 'sleep' };
    case 'stop':
      return { type: 'stop' };
    default:
      return null;
  }
}

export class GuideBrain {
  backend: LlmBackend | null = null;
  private readonly history: LlmTurn[] = [];
  private ctl: AbortController | null = null;
  /** The job last suggested, so "شغل ثاني" means another one. */
  private lastJob: JobId | null = null;

  constructor(
    private readonly store: Store,
    private readonly rng: Rng,
  ) {}

  async ask(text: string): Promise<GuideReply & { source: 'offline' | 'claude' }> {
    const offline = guideRespond(text, this.store, this.rng, this.lastJob);
    const go = offline.actions.find((a) => a.type === 'goJob');
    if (go?.type === 'goJob') this.lastJob = go.job;
    const remember = (reply: string) => {
      this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      if (this.history.length > 12) this.history.splice(0, this.history.length - 12);
    };
    if (!this.backend) {
      remember(offline.text);
      return { ...offline, source: 'offline' };
    }
    this.ctl?.abort();
    const ctl = (this.ctl = new AbortController());
    try {
      const d = await this.backend.ask(this.system(offline), [...this.history, { role: 'user', content: text }], ctl.signal);
      const actions = d.actions.map(parseActionKey).filter((a): a is GuideAction => a !== null);
      remember(d.reply);
      return { text: d.reply, actions, suggestions: offline.suggestions, source: 'claude' };
    } catch {
      remember(offline.text);
      return { ...offline, source: 'offline' };
    } finally {
      if (this.ctl === ctl) this.ctl = null;
    }
  }

  private system(offline: GuideReply): string {
    const s = this.store.s;
    const goal = this.store.goalProgress();
    return [
      'أنت «سند»، مساعد اللاعب في لعبة عربية ثلاثية الأبعاد اسمها «شارع الرزق»: فريج في الإمارات يجمع فيه اللاعب الدراهم بالشغل الحلال. اللاعب يكلمك بصوته أو بالكتابة ويطلب منك أشياء، وأنت توديه للمكان المناسب وتبدأ له الشغل.',
      `اللاعب: ${s.player.name} (${s.player.gender === 'm' ? 'ولد' : 'بنت'})، معه ${formatMoney(s.wallet)} نقداً و${formatMoney(s.bank)} بالبنك، اليوم ${s.day} الساعة ${formatClock(s.minute)}.${goal ? ` هدفه ${formatMoney(goal.amount)}، جمع منه ${formatMoney(goal.got)}، باقي ${goal.daysLeft} يوم.` : ''}`,
      'يوم اللعبة = 24 دقيقة حقيقية، والشهر باللعبة = 30 يوم لعبة.',
      guideCatalogue(this.store),
      `اقتراح النظام (أرقامه صحيحة): «${offline.text}» — الإجراءات المقترحة: ${offline.actions.map(actionKey).join('، ') || 'لا شيء'}`,
      'الإجراءات المسموحة (اكتب مفاتيحها في actions):',
      '- go_job:<jobId> توديه للشغل وتبدأه (اختر شغل متاح الآن، وإذا طلب شغل مسكّر اشرح ووده لأقرب شغل متاح)',
      '- go_place:<placeId> توديه لمكان؛ talk:<npcId> توديه لشخص ويكلمه',
      '- set_goal:<amount>:<days>[:<jobId>] لما يذكر مبلغ يبي يجمعه (الشهر 30 يوم، الأسبوع 7، اليوم 1)',
      '- open_phone:<home|jobs|shop|wallet|awards|settings>؛ buy:<upgradeId> لما يبي يشتري وفلوسه تكفي؛ sleep لما يبي ينام بالليل؛ stop لما يقول وقف',
      '- move:<forward|back|left|right|out|in> لما يقول امشي لقدام/ارجع/يمين/يسار/اطلع برا/ادخل البيت؛ open_board لما يسأل عن شغل على قده (يوديه للوحة الوظائف)؛ invest لما يبي يستثمر (يوديه لأبو راشد)',
      'القواعد: رد بلهجة خليجية بسيطة وودودة، جملتين أو ثلاث قصيرة تنقرأ بصوت، بدون إيموجي. اشرح بالأرقام كيف يوصل لهدفه لما يذكر مبلغ. لا تعد بفلوس غير اللي بالشغل. إذا ما فهمت اسأله سؤال قصير واقترح أمثلة.',
      'أجب بكائن JSON فقط: {"reply": "...", "actions": ["go_job:online"], "mood": "happy"}',
    ].join('\n');
  }
}
