// 1.62: choose the Claude model and reasoning effort for a request typed from scratch, so nobody in Assistant mode has
// to pick between models. One call to a decision model (TypeSafe Jev through OpenRouter's decisions endpoint, or
// OpenAI's Decisions API) answers which of a few tiers the request needs; the tier maps onto the models this Pocket
// offers. It only ever chooses among offered models, and it fails open: no key, a timeout, an error, a refusal or a
// low-confidence answer gives null and the instance default runs, as it always has.

// Tiers from lightest to heaviest. `want` is [model family, effort] in order of preference; the first offered model
// in that family is used, else the next tier down that can be served.
export const TIERS = [
  { key: 'quick', want: ['sonnet', 'low'], about: 'A quick question, a lookup, a list or a status check with a short answer.' },
  { key: 'standard', want: ['sonnet', 'medium'], about: 'An ordinary task: draft or reply to an email, summarize something, look up a customer or quote and explain it.' },
  { key: 'careful', want: ['sonnet', 'high'], about: 'A longer task with several steps or tools, or one where the details matter: reconcile figures, compare options, fix a problem.' },
  { key: 'deep', want: ['opus', 'high'], about: 'A finished deliverable that has to be right and look right: a proposal, presentation, report, customer-facing document or a hard analysis that needs judgment.' },
];
const INSTRUCTIONS = 'Which level of effort does this request need from an AI assistant at a small security-systems company? '
  + 'Pick the lightest level that will still do the job well.';
const CONTEXT = 'The request was typed by an office employee (account manager, warehouse manager) into their work assistant. '
  + 'The assistant can read and draft email, look up quotes and customers, and make documents, decks and spreadsheets.';
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

// The (model, effort) for a tier among `offered` (catalog entries with `alias` and `id`, strongest first), capped at
// maxEffort. Null when nothing fits (the default runs).
export function tierChoice(key, offered, maxEffort = null) {
  const start = TIERS.findIndex(t => t.key === key); if (start < 0) return null;
  for (let i = start; i >= 0; i--) {
    const [family, effort] = TIERS[i].want;
    const m = offered.find(x => x.alias === family); if (!m) continue;
    return { model: m.id, effort: capEffort(effort, maxEffort), tier: TIERS[i].key };
  }
  // Only a family no tier names (say Haiku): use the strongest offered model at the tier's effort.
  return offered[0] ? { model: offered[0].id, effort: capEffort(TIERS[start].want[1], maxEffort), tier: key } : null;
}
export function capEffort(effort, max) {
  if (!max || !EFFORT_ORDER.includes(max) || !EFFORT_ORDER.includes(effort)) return effort;
  return EFFORT_ORDER.indexOf(effort) > EFFORT_ORDER.indexOf(max) ? max : effort;
}

// The request and answer for each provider. Both return { tier, confidence } or throw.
const PROVIDERS = {
  jev: {
    url: 'https://openrouter.ai/api/alpha/decisions',
    body: text => ({ model: '~typesafe/jev-latest', state: { context: CONTEXT, first_message: text.slice(0, 4000) },
      questions: { tier: { type: 'choice', instructions: INSTRUCTIONS, criteria: Object.fromEntries(TIERS.map(t => [t.key, t.about])) } } }),
    read: j => { const a = j?.answers?.tier; const p = a?.probabilities || {}; return { tier: a?.choice, confidence: Number(p[a?.choice] ?? NaN) }; },
  },
  openai: {
    url: 'https://api.openai.com/v1/decisions',
    body: text => ({ model: 'gpt-6-luna', input: [{ role: 'user', content: [{ type: 'input_text', text: CONTEXT + '\n\nRequest:\n' + text.slice(0, 4000) }] }],
      questions: [{ type: 'choice', name: 'tier', instructions: INSTRUCTIONS, choices: TIERS.map(t => ({ value: t.key, description: t.about })) }] }),
    read: j => { const a = (j?.answers || []).find(x => x?.name === 'tier'); if (!a || a.type === 'refusal') throw new Error('refused'); return { tier: a.choice, confidence: Number(a.confidence ?? a.probabilities?.find?.(p => p.value === a.choice)?.probability ?? NaN) }; },
  },
};

export class ModelRouter {
  // provider: 'jev' | 'openai' | 'off'; key: the API key; fetchImpl for tests; minConfidence below which the default runs.
  constructor({ provider = 'off', key = '', timeoutMs = 1500, minConfidence = 0.35, fetchImpl = globalThis.fetch, url = null, log = () => { } } = {}) {
    this.provider = PROVIDERS[provider] && key ? provider : 'off';
    this.key = key; this.timeoutMs = timeoutMs; this.minConfidence = minConfidence; this.fetch = fetchImpl; this.url = url; this.log = log;
    this.last = null;
  }
  get on() { return this.provider !== 'off'; }
  // { model, effort, tier, confidence, ms } or null (use the default).
  async pick(text, { offered, maxEffort = null } = {}) {
    if (!this.on || !String(text || '').trim() || !offered?.length) return null;
    const p = PROVIDERS[this.provider], t0 = Date.now();
    try {
      const r = await this.fetch(this.url || p.url, { method: 'POST', headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/json' },
        body: JSON.stringify(p.body(String(text))), signal: AbortSignal.timeout(this.timeoutMs) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { tier, confidence } = p.read(await r.json());
      if (!TIERS.some(x => x.key === tier)) throw new Error('no tier');
      const ms = Date.now() - t0;
      if (Number.isFinite(confidence) && confidence < this.minConfidence) { this.last = { at: Date.now(), tier, confidence, ms, used: null }; this.log(`router: ${tier} at ${confidence.toFixed(2)} is below ${this.minConfidence}; default`); return null; }
      const choice = tierChoice(tier, offered, maxEffort); if (!choice) return null;
      this.last = { at: Date.now(), tier, confidence, ms, used: choice };
      return { ...choice, confidence: Number.isFinite(confidence) ? confidence : null, ms };
    } catch (e) {
      this.last = { at: Date.now(), error: e.name === 'TimeoutError' ? 'timeout' : String(e.message).slice(0, 120), ms: Date.now() - t0, used: null };
      this.log(`router (${this.provider}) failed open: ${this.last.error}`);
      return null;
    }
  }
}
