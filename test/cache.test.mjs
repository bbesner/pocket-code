import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheFromUsage, hitShare, scanCache, cacheFromTranscript, turnCacheSummary, TTL_1H, TTL_5M } from '../cache.mjs';

const at = s => new Date(Date.parse('2026-10-09T12:00:00Z') + s * 1000).toISOString();
const asst = (s, usage, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: at(s), message: { id: extra.id || 'm' + s, model: extra.model || 'claude-opus-5-5', usage }, ...extra.line });
const user = (s, content, line = {}) => JSON.stringify({ type: 'user', timestamp: at(s), message: { role: 'user', content }, ...line });
const u = (read, written, ttl = '1h', input = 3) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: written,
  cache_creation: { ephemeral_1h_input_tokens: ttl === '1h' ? written : 0, ephemeral_5m_input_tokens: ttl === '5m' ? written : 0 } });

test('cacheFromUsage: reads the lifetime the writes used; mixed writes report the shorter one', () => {
  assert.equal(cacheFromUsage(u(100, 50, '1h')).ttlMs, TTL_1H);
  assert.equal(cacheFromUsage(u(100, 50, '5m')).ttlMs, TTL_5M);
  assert.equal(cacheFromUsage({ ...u(0, 0), cache_creation: { ephemeral_1h_input_tokens: 40, ephemeral_5m_input_tokens: 10 } }).ttlMs, TTL_5M);
  assert.equal(cacheFromUsage(u(100, 0)).ttlMs, null, 'a pure read says nothing about the lifetime');
  assert.equal(cacheFromUsage({ input_tokens: 5, cache_read_input_tokens: 9 }).split, false, 'an older CLI has no split');
  assert.equal(cacheFromUsage(null), null);
  assert.equal(hitShare({ read: 97, written: 2, input: 1 }), 0.97);
  assert.equal(hitShare({ read: 0, written: 0, input: 0 }), null);
});

test('scanCache: last request time and lifetime, cached size, and the first request of the last turn', () => {
  const v = scanCache([
    user(0, 'first task'), asst(5, u(0, 50_000)), asst(9, u(50_000, 2_000)),
    user(4000, 'come back after an hour'),                                   // idle past the lifetime
    asst(4010, u(0, 52_500)),                                                  // cold: everything written again
    user(4012, [{ type: 'tool_result', content: 'ok' }]),                     // tool result, not a new turn
    asst(4020, u(52_500, 700)), asst(4020, u(52_500, 700), { id: 'm4020' }),  // one request logged per block
    asst(4030, u(9_000, 10), { model: 'claude-haiku-4-5', line: { isSidechain: true } }),
  ]);
  assert.equal(v.at, Date.parse(at(4020)));
  assert.equal(v.ttlMs, TTL_1H);
  assert.equal(v.ttlKnown, true);
  assert.equal(v.cached, 53_200);
  assert.equal(v.lastTurn.at, Date.parse(at(4010)));
  assert.equal(v.lastTurn.written, 52_500);
  assert.ok(v.lastTurn.hit < 0.01, 'the turn started cold');
});

test('scanCache: a lifetime written earlier carries through pure reads; none at all assumes five minutes', () => {
  const carried = scanCache([user(0, 'go'), asst(1, u(0, 900, '5m')), asst(2, u(900, 0))]);
  assert.equal(carried.ttlMs, TTL_5M); assert.equal(carried.ttlKnown, true);
  const legacy = scanCache([user(0, 'go'), asst(1, { input_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 4 })]);
  assert.equal(legacy.ttlMs, TTL_5M); assert.equal(legacy.ttlKnown, false);
});

test('scanCache: meta lines, slash-command echoes and synthetic replies are not turns or requests', () => {
  const v = scanCache([
    user(0, 'real prompt'), asst(1, u(10, 100)),
    user(2, '<command-name>/usage</command-name>'), user(3, 'Caveat', { isMeta: true }),
    JSON.stringify({ type: 'assistant', timestamp: at(4), message: { model: '<synthetic>', usage: u(0, 0) } }),
  ]);
  assert.equal(v.at, Date.parse(at(1)));
  assert.equal(v.lastTurn.at, Date.parse(at(1)));
  assert.equal(scanCache([user(0, 'only a prompt')]), null);
});

test('scanCache: a turn that started before the scanned tail reports no last-turn figure', () => {
  const v = scanCache([asst(1, u(10, 100)), asst(2, u(110, 5))]);
  assert.equal(v.cached, 115);
  assert.equal(v.lastTurn, null);
});

test('cacheFromTranscript: reads a tail, skips the partial first line, and re-reads only when the file changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-cache-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, user(0, 'x'.repeat(5000)) + '\n' + user(10, 'go') + '\n' + asst(11, u(0, 400)) + '\n');
  const a = await cacheFromTranscript(file, { maxBytes: 1000 });
  assert.equal(a.cached, 400);
  assert.equal(a.lastTurn.at, Date.parse(at(11)));
  fs.appendFileSync(file, asst(20, u(400, 30)) + '\n');
  const b = await cacheFromTranscript(file, { maxBytes: 1000 });
  assert.equal(b.cached, 430);
  assert.equal(await cacheFromTranscript(path.join(dir, 'missing.jsonl')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('turnCacheSummary: the figure the result line carries', () => {
  assert.deepEqual(turnCacheSummary(u(970, 20, '1h', 10)), { hit: 0.97, read: 970, written: 20 });
  assert.equal(turnCacheSummary({ input_tokens: 0 }), null);
});
