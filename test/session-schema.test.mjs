// The versioned session-meta overlay shape (session-schema.mjs): migration is additive and
// behaviour-preserving for today's records, the reserved version key is never a session, and the
// engine-config slot validates. The ACP/OpenRouter engine (M1) writes engineConfig via this validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SMETA_SCHEMA, VERSION_KEY, migrateSmeta, overlayIds, validateEngineConfig, readEngineConfig, ENGINE_CONFIG_FIELDS} from '../session-schema.mjs';

const throws = fn => { try { fn(); return false; } catch { return true; } };

test('migrateSmeta stamps version, preserves existing records byte-for-byte', () => {
  const legacy = {
    '2ee47581-4c30-4c72-9e01-17639db22d71': { outcome: { kind: 'finished' }, seen: 123 },
    'cx:01a103cc-9457-79e3-b9be-a96480ea3802': { name: 'Codex session', pin: true, pinOrder: 2 },
  };
  const m = migrateSmeta(legacy);
  assert.equal(m[VERSION_KEY], SMETA_SCHEMA);
  for (const id of Object.keys(legacy)) assert.deepEqual(m[id], legacy[id], 'records unchanged');
  assert.notEqual(m, legacy, 'returns a copy, does not mutate input');
});

test('migrateSmeta is idempotent and handles missing/corrupt input', () => {
  const once = migrateSmeta({ 'a-b-c': { name: 'x' } });
  assert.deepEqual(migrateSmeta(once), once, 'idempotent');
  for (const bad of [null, undefined, 'str', 42, []]) assert.deepEqual(migrateSmeta(bad), { [VERSION_KEY]: SMETA_SCHEMA }, 'fresh store');
});

test('overlayIds excludes the reserved version key', () => {
  const m = migrateSmeta({ 'id-1': { name: 'a' }, 'cx:id-2': { pin: true } });
  assert.deepEqual(overlayIds(m).sort(), ['cx:id-2', 'id-1']);
  assert.ok(!overlayIds(m).includes(VERSION_KEY));
  assert.deepEqual(overlayIds(null), []);
  assert.deepEqual(overlayIds({}), []);
});

test('validateEngineConfig: known engine + optional strings, drops unknowns', () => {
  const cfg = validateEngineConfig({ engine: 'acp', inferenceProvider: 'openrouter', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', credentialRef: 'or-default', bogus: 'x' });
  assert.deepEqual(cfg, { engine: 'acp', inferenceProvider: 'openrouter', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', credentialRef: 'or-default' });
  assert.ok(!('bogus' in cfg), 'unknown field dropped');
  assert.deepEqual(validateEngineConfig({ engine: 'claude' }), { engine: 'claude' }, 'engine alone is valid');
  assert.ok(ENGINE_CONFIG_FIELDS.includes('model') && ENGINE_CONFIG_FIELDS.includes('credentialRef'));
});

test('validateEngineConfig: rejects bad input with status 400', () => {
  for (const bad of [null, undefined, 'x', [], { engine: 'nope' }, { engine: 'ACP' }, {}]) assert.ok(throws(() => validateEngineConfig(bad)), JSON.stringify(bad));
  assert.ok(throws(() => validateEngineConfig({ engine: 'acp', model: 42 })), 'non-string field');
  assert.ok(throws(() => validateEngineConfig({ engine: 'acp', model: 'x'.repeat(201) })), 'over-long field');
  try { validateEngineConfig({ engine: 'nope' }); assert.fail('should throw'); }
  catch (e) { assert.equal(e.status, 400); assert.equal(e.code, 400); assert.match(e.message, /unknown engine/); }
});

test('readEngineConfig returns config when present, null otherwise', () => {
  assert.deepEqual(readEngineConfig({ engineConfig: { engine: 'acp', model: 'm' } }), { engine: 'acp', model: 'm' });
  for (const r of [null, undefined, {}, { name: 'x' }, { engineConfig: {} }, { engineConfig: 'x' }, { engineConfig: { noEngine: 1 } }]) assert.equal(readEngineConfig(r), null, JSON.stringify(r));
});
