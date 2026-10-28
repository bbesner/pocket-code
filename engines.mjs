// engines.mjs — the engine registry.
//
// An "engine" is the agent harness Pocket drives end to end: it owns the tool loop,
// approvals, questions, streaming, transcripts and usage. Today there are two — Claude
// Code and Codex — and the code branched on a `'claude' | 'codex'` string inline in many
// places (server.mjs validateModel, the `isCx(id) ? 'codex' : 'claude'` session-id rule,
// settings and routing). This module makes the engine a first-class, data-driven concept
// so a third engine is a registry entry plus its adapter, not scattered `=== 'codex'` edits.
//
// The engine (transport/harness) is distinct from the inference PROVIDER and the MODEL:
// one engine can front more than one provider. Splitting `provider` into
// {engine, inferenceProvider, model, credentialRef} is the next step — see
// docs/openrouter-acp-engine-spec.md (M0). This module is the first, behaviour-preserving
// slice: the registry + the generalized model-compatibility check server.mjs used to inline.
//
// Each entry:
//   id        — stable engine key (also the legacy `provider` value for claude/codex).
//   label     — human name used in the "choose a <label> model" error.
//   idPrefix  — session-id prefix marking this engine's sessions (null = the default/unprefixed).
//   routed    — true when server.mjs can actually run a turn on this engine today.
//   foreign   — model ids that clearly belong to ANOTHER engine, used to reject an obvious
//               mismatch early. The generalized form of the old validateModel regexes.
export const ENGINES = {
  claude: {
    id: 'claude', label: 'Claude', idPrefix: null, routed: true,
    foreign: /^(?:gpt-|codex(?:$|-)|o\d(?:$|-))/i,
  },
  codex: {
    id: 'codex', label: 'Codex', idPrefix: 'cx:', routed: true,
    foreign: /^(?:claude-|opus(?:$|\[)|sonnet(?:$|\[)|haiku(?:$|\[)|fable(?:$|\[))/i,
  },
  // Registered as the extension target, NOT routed yet — its adapter (acp.mjs) is M1 in
  // docs/openrouter-acp-engine-spec.md. Its models are provider-prefixed OpenRouter slugs
  // (e.g. openrouter/deepseek/deepseek-v4.1-flash-1017); a Claude- or bare GPT/Codex-looking
  // id is the obvious mismatch. Nothing dispatches engine 'acp' until M1 lands, so this entry
  // changes no runtime behaviour today — it only makes the seam real and testable.
  acp: {
    id: 'acp', label: 'OpenRouter', idPrefix: 'acp:', routed: false,
    foreign: /^(?:claude-|opus(?:$|\[)|sonnet(?:$|\[)|haiku(?:$|\[)|fable(?:$|\[)|gpt-|codex(?:$|-)|o\d(?:$|-))/i,
  },
};

export const ENGINE_IDS = Object.keys(ENGINES);
// Engines server.mjs can run a turn on right now (claude, codex). The picker/dispatch use this
// so a not-yet-routed registry entry (acp, today) is never offered or dispatched.
export const routedEngineIds = () => ENGINE_IDS.filter(id => ENGINES[id].routed);

// The engine that owns a session id, by its prefix. Unprefixed ids are Claude (the default) —
// identical to the long-standing `isCx(id) ? 'codex' : 'claude'` rule, generalized to the registry.
export function engineForSessionId(id) {
  if (typeof id === 'string') for (const e of ENGINE_IDS) {
    const p = ENGINES[e].idPrefix;
    if (p && id.startsWith(p)) return e;
  }
  return 'claude';
}

// Throws a 400 when `model` is obviously not one this engine can run (a pick from the wrong
// menu). `null`/`'default'` always pass. For 'claude'/'codex' this is byte-for-byte the old
// server.mjs validateModel behaviour; the generalization is that the rule is per-engine data.
export function validateModelForEngine(engine, model) {
  if (model == null || model === 'default') return;
  const e = ENGINES[engine];
  const bad = typeof model !== 'string' || Boolean(e && e.foreign.test(model));
  if (bad) {
    const err = new Error(`Choose a ${e ? e.label : 'valid'} model from the model menu, then send again.`);
    err.status = 400; err.code = 400;
    throw err;
  }
}
