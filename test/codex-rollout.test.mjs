import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contextUsed, cachedTokens, scanRollout, findRolloutFile, rolloutState, TTL_CODEX } from '../codex-rollout.mjs';

const at = s => new Date(Date.parse('2026-10-14T12:00:00Z') + s * 1000).toISOString();
const started = (s, window) => JSON.stringify({ timestamp: at(s), type: 'event_msg', payload: { type: 'task_started', turn_id: 't' + s, model_context_window: window } });
const ctx = (s, model) => JSON.stringify({ timestamp: at(s), type: 'turn_context', payload: { turn_id: 't' + s, model } });
const count = (s, input, cached, window = 486_400, output = 500) => JSON.stringify({ timestamp: at(s), type: 'event_msg', payload: { type: 'token_count', info: {
  total_token_usage: { input_tokens: input * 3, cached_input_tokens: cached * 3, output_tokens: output * 3, total_tokens: input * 3 + output * 3 },
  last_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 100, total_tokens: input + output },
  model_context_window: window } } });

test('contextUsed: the context is the input alone; cached tokens are a subset of it, in either spelling', () => {
  // Damon's figures from Ramesh's session (2026-10-14): input 153,239 / cached 152,704 / window 258,400 was shown as 118%, real 59%
  const rollout = { input_tokens: 153_239, cached_input_tokens: 152_704 };
  const notification = { inputTokens: 153_239, cachedInputTokens: 152_704 };
  assert.equal(contextUsed(rollout), 153_239);
  assert.equal(contextUsed(notification), 153_239);
  assert.equal(cachedTokens(rollout), 152_704);
  assert.equal(cachedTokens(notification), 152_704);
  assert.ok(contextUsed(rollout) / 258_400 < 0.6 && contextUsed(rollout) / 258_400 > 0.59);
  assert.equal(cachedTokens({ input_tokens: 10, cached_input_tokens: 50 }), 10, 'cached can never exceed the input');
  assert.equal(contextUsed(null), 0);
});

test('scanRollout: last call sets the context and the cache clock; the first call of the last turn shows warm or cold', () => {
  const v = scanRollout([
    started(0, 486_400), ctx(0, 'gpt-6-astra'),
    count(5, 60_000, 0), count(9, 61_000, 60_000),
    started(9000), ctx(9000, 'gpt-6-astra'),               // back after two and a half hours: cold
    count(9010, 62_000, 1_000), count(9020, 63_000, 62_000),
    JSON.stringify({ timestamp: at(9021), type: 'event_msg', payload: { type: 'token_count', info: null } }), // rate-limit only
  ]);
  assert.equal(v.context.used, 63_000);
  assert.equal(v.context.window, 486_400);
  assert.equal(v.context.model, 'gpt-6-astra');
  assert.equal(v.context.at, Date.parse(at(9020)));
  assert.equal(v.cache.at, Date.parse(at(9020)));
  assert.equal(v.cache.ttlMs, TTL_CODEX);
  assert.equal(v.cache.ttlKnown, false);
  assert.equal(v.cache.cached, 63_000, 'a cold turn processes the whole prompt again');
  assert.equal(v.cache.lastTurn.at, Date.parse(at(9010)));
  assert.equal(v.cache.lastTurn.written, 61_000);
  assert.ok(v.cache.lastTurn.hit < 0.02, 'the turn started cold');
});

test('scanRollout: a warm resume, a window from task_started only, and no calls at all', () => {
  const warm = scanRollout([started(0, 258_400), count(1, 150_000, 149_000, null), started(600), count(601, 151_000, 150_000, null)]);
  assert.equal(warm.context.window, 258_400);
  assert.ok(warm.cache.lastTurn.hit > 0.99);
  assert.equal(scanRollout([started(0, 1000), ctx(0, 'gpt-6-sol')]), null);
  assert.equal(scanRollout(['not json', '']), null);
});

test('findRolloutFile and rolloutState: locate a thread by id under the dated folders and read the tail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-rollout-'));
  const id = '01a112c0-4ffc-73c3-a556-01e12a376d90';
  const day = path.join(dir, '2026', '10', '06'); fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-10-06T19-45-55-${id}.jsonl`);
  fs.writeFileSync(file, [started(0, 486_400), ctx(0, 'gpt-6-astra'), count(5, 332_555, 330_752)].join('\n') + '\n');
  assert.equal(await findRolloutFile(id, { dir }), file);
  assert.equal(await findRolloutFile(id.toUpperCase(), { dir }), file);
  assert.equal(await findRolloutFile('01a11111-0000-7000-8000-000000000000', { dir }), null);
  const v = await rolloutState(id, { dir });
  assert.equal(v.context.used, 332_555, 'the thread Pocket showed at 136% is at 68%');
  assert.equal(v.cache.cached, 332_555);
  // appended calls are seen on the next read (memo keyed on mtime and size)
  await new Promise(r => setTimeout(r, 20));
  fs.appendFileSync(file, count(9, 340_000, 332_000) + '\n');
  assert.equal((await rolloutState(id, { dir })).context.used, 340_000);
  // a tail shorter than the file still finds the last call
  assert.equal((await rolloutState(id, { dir, maxBytes: 600 })).context.used, 340_000);
  fs.rmSync(dir, { recursive: true, force: true });
});
