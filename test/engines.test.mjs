// The engine registry (engines.mjs): session-id -> engine, and the per-engine model
// compatibility check that server.mjs used to inline. Includes a parity table proving the
// new validateModelForEngine matches the OLD server.mjs validateModel byte-for-byte for
// claude/codex, so this refactor changes no behaviour for the two shipped engines.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ENGINES, ENGINE_IDS, routedEngineIds, engineForSessionId, validateModelForEngine} from '../engines.mjs';

// A faithful copy of the pre-refactor server.mjs validateModel, as the parity oracle.
function oldValidateModel(provider, model) {
  if (model == null || model === 'default') return;
  const incompatible = typeof model !== 'string' || (provider === 'codex'
    ? /^(?:claude-|opus(?:$|\[)|sonnet(?:$|\[)|haiku(?:$|\[)|fable(?:$|\[))/i.test(model)
    : /^(?:gpt-|codex(?:$|-)|o\d(?:$|-))/i.test(model));
  if (incompatible) throw Object.assign(new Error(`Choose a ${provider === 'codex' ? 'Codex' : 'Claude'} model from the model menu, then send again.`), { status: 400, code: 400 });
}
const throws = fn => { try { fn(); return false; } catch { return true; } };

test('registry shape', () => {
  assert.deepEqual(ENGINE_IDS, ['claude', 'codex', 'acp']);
  assert.equal(ENGINES.claude.routed, true);
  assert.equal(ENGINES.codex.routed, true);
  assert.equal(ENGINES.acp.routed, false, 'acp is registered but not yet routed');
  assert.deepEqual(routedEngineIds(), ['claude', 'codex'], 'acp is not offered/dispatched yet');
});

test('engineForSessionId maps by prefix; unprefixed = claude', () => {
  assert.equal(engineForSessionId('cx:abc-123'), 'codex');
  assert.equal(engineForSessionId('acp:xyz-9'), 'acp');
  assert.equal(engineForSessionId('019283-plain-uuid'), 'claude');
  for (const bad of [null, undefined, 42, {}, '']) assert.equal(engineForSessionId(bad), 'claude');
});

test('validateModelForEngine: null/default always pass', () => {
  for (const e of ENGINE_IDS) { validateModelForEngine(e, null); validateModelForEngine(e, undefined); validateModelForEngine(e, 'default'); }
});

test('claude rejects codex/gpt-looking ids, allows claude ids', () => {
  for (const m of ['gpt-6-astra', 'codex', 'codex-mini', 'o3', 'o4-mini']) assert.ok(throws(() => validateModelForEngine('claude', m)), m);
  for (const m of ['claude-opus-5-5[1m]', 'claude-sonnet-5-5', 'opus', 'haiku', 'fable']) validateModelForEngine('claude', m);
});

test('codex rejects claude-looking ids, allows gpt/codex/other', () => {
  for (const m of ['claude-opus-5-5', 'opus', 'sonnet', 'haiku', 'fable']) assert.ok(throws(() => validateModelForEngine('codex', m)), m);
  for (const m of ['gpt-6-astra', 'gpt-5.6-sol', 'codex', 'o3-mini']) validateModelForEngine('codex', m);
});

test('acp (extension target) allows OpenRouter slugs, rejects claude/gpt/codex ids', () => {
  for (const m of ['openrouter/deepseek/deepseek-v4.1-flash-1017', 'deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3']) validateModelForEngine('acp', m);
  for (const m of ['claude-opus-5-5', 'opus', 'gpt-6-astra', 'codex', 'o3']) assert.ok(throws(() => validateModelForEngine('acp', m)), m);
});

test('error carries status/code 400 and the engine label', () => {
  try { validateModelForEngine('codex', 'claude-opus-5-5'); assert.fail('should throw'); }
  catch (e) { assert.equal(e.status, 400); assert.equal(e.code, 400); assert.match(e.message, /Codex/); }
  try { validateModelForEngine('claude', 'gpt-6-astra'); assert.fail('should throw'); }
  catch (e) { assert.match(e.message, /Claude/); }
});

test('PARITY: new validation == old server.mjs validateModel for claude & codex', () => {
  const models = [null, undefined, 'default', 'gpt-6-astra', 'gpt-5.6-sol', 'codex', 'codex-mini', 'o3', 'o4-mini',
    'claude-opus-5-5', 'claude-opus-5-5[1m]', 'claude-sonnet-5-5', 'opus', 'sonnet', 'haiku', 'fable',
    'deepseek/deepseek-v4.1-flash-1017', 'z-ai/glm-5.3', 'openrouter/x', 42, {}, ''];
  for (const provider of ['claude', 'codex']) for (const m of models) {
    const oldThrew = throws(() => oldValidateModel(provider, m));
    const newThrew = throws(() => validateModelForEngine(provider, m));
    assert.equal(newThrew, oldThrew, `mismatch for provider=${provider} model=${JSON.stringify(m)} (old threw=${oldThrew}, new threw=${newThrew})`);
  }
});
