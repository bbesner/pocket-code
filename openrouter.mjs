// openrouter.mjs — the OpenRouter model catalog for the ACP engine's picker.
//
// The owner's requirement is "select from many models, including ones that don't exist yet."
// OpenRouter adds models to its catalog continuously, so the picker reads the live catalog
// (free, unauthenticated GET) rather than a hard-coded list. A model works the day OpenRouter
// adds it — no Pocket release. Tool-capable models (supported_parameters includes "tools") are
// the ones an agentic engine can drive; the rest are not offered. See
// docs/openrouter-acp-engine-spec.md §4. Pure + injectable fetch, so it is unit-testable.

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

// One catalog row reduced to what the picker needs. Returns null for a malformed entry.
export function normalizeModel(m) {
  if (!m || typeof m.id !== 'string') return null;
  const sp = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
  const price = m.pricing && typeof m.pricing === 'object' ? m.pricing : null;
  return {
    id: m.id,                              // OpenRouter id, e.g. 'deepseek/deepseek-v4.1-flash-1017'
    slug: 'openrouter/' + m.id,            // the engine model id Pocket stores/validates
    name: m.name || m.id,
    contextLength: Number.isFinite(m.context_length) ? m.context_length : null,
    tools: sp.includes('tools'),           // tool/function calling — required for an agentic engine
    pricing: price ? { prompt: price.prompt ?? null, completion: price.completion ?? null } : null,
  };
}

// Fetch + normalize the catalog. Throws on a non-OK response or network error (the caller
// decides how to degrade — the picker shows a "catalog unavailable" state, never a stale guess).
export async function fetchOpenRouterModels({ fetchImpl = globalThis.fetch, url = OPENROUTER_MODELS_URL, timeoutMs = 8000 } = {}) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error('OpenRouter catalog HTTP ' + r.status);
  const j = await r.json();
  return (Array.isArray(j?.data) ? j.data : []).map(normalizeModel).filter(Boolean);
}

export const toolCapable = models => models.filter(m => m.tools);

// Split models into a curated/tested tier and an experimental tier, preserving catalog order.
// `curated` holds ids or slugs Pocket has verified for agentic use (DeepSeek V4.1 Flash to start);
// everything else is offered as "experimental — unverified for tool use" (spec §4), so breadth
// never floods the project with "tools don't work on model X". Only tool-capable models are tiered.
export function tierModels(models, curated = []) {
  const set = new Set(curated);
  const curatedTier = [], experimental = [];
  for (const m of toolCapable(models)) (set.has(m.id) || set.has(m.slug) ? curatedTier : experimental).push(m);
  return { curated: curatedTier, experimental };
}

// The default curated set: the model the owner asked for and we have probed end-to-end.
export const DEFAULT_CURATED = ['deepseek/deepseek-v4.1-flash-1017'];
