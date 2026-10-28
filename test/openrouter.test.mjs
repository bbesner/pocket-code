// The OpenRouter catalog (openrouter.mjs): normalize, tool-capable filter, curated/experimental
// tiering, fetch error handling — all with an injected fetch (no network). One optional live
// sanity check against the FREE unauthenticated catalog, skipped if the network is unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, fetchOpenRouterModels, toolCapable, tierModels, DEFAULT_CURATED, OPENROUTER_MODELS_URL } from '../openrouter.mjs';

const FIXTURE = {
  data: [
    { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017', context_length: 1048576, supported_parameters: ['tools', 'tool_choice'], pricing: { prompt: '0.0000003', completion: '0.0000012' } },
    { id: 'z-ai/glm-5.3', name: 'GLM 5.3', context_length: 200000, supported_parameters: ['tools'] },
    { id: 'some/chat-only-model', name: 'Chat Only', context_length: 8192, supported_parameters: ['temperature'] }, // not tool-capable
    { id: 42 }, // malformed
    null,
  ],
};
const fakeFetch = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('normalizeModel: slug prefix, tools flag, drops malformed', () => {
  const m = normalizeModel(FIXTURE.data[0]);
  assert.equal(m.slug, 'openrouter/deepseek/deepseek-v4.1-flash-1017');
  assert.equal(m.tools, true);
  assert.equal(m.contextLength, 1048576);
  assert.equal(m.pricing.prompt, '0.0000003');
  assert.equal(normalizeModel({ id: 42 }), null);
  assert.equal(normalizeModel(null), null);
  assert.equal(normalizeModel({ id: 'x/y' }).tools, false, 'no supported_parameters => not tool-capable');
});

test('fetchOpenRouterModels: maps data, drops malformed rows', async () => {
  const models = await fetchOpenRouterModels({ fetchImpl: fakeFetch(FIXTURE) });
  assert.equal(models.length, 3, 'two malformed rows dropped');
  assert.deepEqual(models.map(m => m.id), ['deepseek/deepseek-v4.1-flash-1017', 'z-ai/glm-5.3', 'some/chat-only-model']);
});

test('fetchOpenRouterModels: throws on non-OK', async () => {
  await assert.rejects(fetchOpenRouterModels({ fetchImpl: fakeFetch({}, false, 503) }), /HTTP 503/);
});

test('toolCapable + tierModels: only tool-capable, split by curated set', async () => {
  const models = await fetchOpenRouterModels({ fetchImpl: fakeFetch(FIXTURE) });
  assert.deepEqual(toolCapable(models).map(m => m.id), ['deepseek/deepseek-v4.1-flash-1017', 'z-ai/glm-5.3']);
  const { curated, experimental } = tierModels(models, DEFAULT_CURATED);
  assert.deepEqual(curated.map(m => m.id), ['deepseek/deepseek-v4.1-flash-1017'], 'curated = the probed model');
  assert.deepEqual(experimental.map(m => m.id), ['z-ai/glm-5.3'], 'other tool-capable models are experimental');
  assert.ok(!curated.concat(experimental).some(m => m.id === 'some/chat-only-model'), 'chat-only model never offered');
});

test('tierModels accepts curated by slug too', async () => {
  const models = await fetchOpenRouterModels({ fetchImpl: fakeFetch(FIXTURE) });
  const { curated } = tierModels(models, ['openrouter/z-ai/glm-5.3']);
  assert.deepEqual(curated.map(m => m.id), ['z-ai/glm-5.3']);
});

// Optional: the real catalog is free + unauthenticated. Confirms our parser matches reality and
// that the owner's model is present + tool-capable. Skipped (not failed) if the network is down.
test('LIVE (free): deepseek-v4.1-flash-1017 is present and tool-capable', async () => {
  let models;
  try { models = await fetchOpenRouterModels({ timeoutMs: 8000 }); }
  catch { return; } // offline / blocked — skip, don't fail the suite
  if (!models.length) return;
  const ds = models.find(m => m.id === 'deepseek/deepseek-v4.1-flash-1017');
  assert.ok(ds, 'DeepSeek V4.1 Flash 1017 present in the live catalog');
  assert.equal(ds.tools, true, 'advertises tool calling');
  assert.ok(ds.contextLength >= 1_000_000);
});
