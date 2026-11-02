/**
 * Optional Claude-powered conversation. Two ways in:
 *  - inside a claude.ai artifact, the page's `sample` capability (the viewer's own
 *    Claude account, no key needed);
 *  - anywhere else, the player's own Anthropic API key, called from the browser.
 * Both return the same small JSON decision; the game validates every action.
 */

export interface LlmTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmDecision {
  reply: string;
  actions: string[];
  mood: 'happy' | 'neutral' | 'sad' | 'angry';
}

export interface LlmBackend {
  readonly label: string;
  ask(system: string, turns: LlmTurn[], signal: AbortSignal): Promise<LlmDecision>;
}

export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'What the character says, in their Arabic dialect, one or two short sentences.' },
    actions: { type: 'array', items: { type: 'string' }, description: 'Zero or more action keys from the allowed list.' },
    mood: { type: 'string', enum: ['happy', 'neutral', 'sad', 'angry'] },
  },
  required: ['reply', 'actions', 'mood'],
  additionalProperties: false,
} as const;

function coerce(raw: unknown): LlmDecision {
  const o = (raw ?? {}) as Partial<LlmDecision>;
  const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
  if (!reply) throw new Error('empty reply');
  const actions = Array.isArray(o.actions) ? o.actions.filter((a): a is string => typeof a === 'string').slice(0, 4) : [];
  const mood = o.mood === 'happy' || o.mood === 'sad' || o.mood === 'angry' ? o.mood : 'neutral';
  return { reply, actions, mood };
}

/** Merge consecutive same-role turns so the history always alternates. */
function alternate(turns: LlmTurn[]): LlmTurn[] {
  const out: LlmTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += '\n' + t.content;
    else out.push({ ...t });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// ---------------------------------------------------------------------------
// claude.ai artifact: the `sample` capability
// ---------------------------------------------------------------------------

type SampleFn = ((input: string | LlmTurn[], opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: <T>(input: string | LlmTurn[], opts?: Record<string, unknown>) => Promise<T>;
};

interface ClaudeWindow {
  claude?: { use?: (name: string) => Promise<unknown> };
}

export class ArtifactBackend implements LlmBackend {
  readonly label = 'Claude (حسابك على claude.ai)';
  /** Set when the viewer declines or Claude is unavailable: stop asking for this session. */
  disabled = false;

  private constructor(private readonly sample: SampleFn) {}

  /** Resolves the backend inside a claude.ai artifact viewer, or null anywhere else. */
  static async detect(): Promise<ArtifactBackend | null> {
    const w = window as unknown as ClaudeWindow;
    if (!w.claude?.use) return null;
    try {
      const sample = (await w.claude.use('sample')) as SampleFn | null;
      return sample ? new ArtifactBackend(sample) : null;
    } catch {
      return null;
    }
  }

  async ask(system: string, turns: LlmTurn[], signal: AbortSignal): Promise<LlmDecision> {
    if (this.disabled) throw new Error('disabled');
    // No system role here: standing instructions travel as a leading user turn.
    const input = alternate([{ role: 'user', content: system }, ...turns]);
    try {
      const raw = await this.sample.json<unknown>(input, { modelTier: 'quick', cache: false, signal });
      return coerce(raw);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') this.disabled = true;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Anthropic API with the player's own key
// ---------------------------------------------------------------------------

export const API_MODELS: { id: string; name: string }[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (الأذكى)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (متوازن)' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (الأسرع)' },
];

export class ApiBackend implements LlmBackend {
  readonly label: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.label = `Claude API (${model})`;
  }

  async ask(system: string, turns: LlmTurn[], signal: AbortSignal): Promise<LlmDecision> {
    // Loaded only when a key is set, so players without one never download the SDK.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    // Opus and Sonnet get server-side fallback when a safety classifier declines.
    const fallback = this.model === 'claude-opus-5-5' || this.model === 'claude-sonnet-5-5';
    const params = {
      model: this.model,
      max_tokens: 1024,
      system,
      messages: alternate(turns),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: DECISION_SCHEMA } },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    try {
      const msg = await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0], { signal });
      const m = msg as unknown as { stop_reason: string; content: { type: string; text?: string }[] };
      if (m.stop_reason === 'refusal') throw new Error('refusal');
      const text = m.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      return coerce(JSON.parse(text));
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('auth');
      if (e instanceof Anthropic.RateLimitError) throw new Error('rate');
      throw e;
    }
  }
}
