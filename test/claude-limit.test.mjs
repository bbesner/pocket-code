// A Claude reply that hits a usage limit (review of 1.123.1, findings turns-01 and turns-02). The CLI ends such a reply
// with a result line of subtype "success" and is_error true (recorded from real runs, the message in `result`), and any
// other API error the same way. It is a limit, not a finished reply: the conversation waits for the reset, a message
// queued behind it is held, and the retry carries the task on at the reset the message names. The conversation's process
// closes while it waits (Pocket's idle close) and the CLI writes its exit bookkeeping to the transcript then; that is
// not another app continuing the conversation, so the retry still runs.
// detectRateLimit is read out of server.mjs and run on a fixed clock; the rest runs the real server.mjs with the fake CLIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { killStrays } from './stray-runners.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The current CLI's words for a limit, as recorded (the separator before "resets" is a middle dot).
const realLimit = at => { const d = new Date(at), h = d.getUTCHours(); return `You've hit your Fable limit · resets ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${h % 12 || 12}${h < 12 ? 'am' : 'pm'} (UTC). Switch to another model, or manage usage credits at https://claude.ai/settings/usage`; };

// server.mjs's detectRateLimit (and the helpers it calls), on a clock that reads `now`.
const SERVER = fs.readFileSync(path.join(repo, 'server.mjs'), 'utf8');
const fnSource = name => SERVER.match(new RegExp(`\\nfunction ${name}\\([^]*?\\n}\\n`))?.[0] || '';
const constSource = name => SERVER.match(new RegExp(`\\nconst ${name} = [^\\n]*\\n`))?.[0] || '';
function detectAt(now) {
  class Clock extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  const src = ['LIMIT_MONTHS'].map(constSource).join('') + ['zoneClock', 'limitWallTime', 'detectRateLimit'].map(fnSource).join('');
  return new Function('Date', 'RETRY_BUFFER_MS', 'RETRY_MAX_DELAY_MS', src + '\nreturn detectRateLimit;')(Clock, 0, 12 * 3600_000);
}

test('detectRateLimit reads the real CLI limit wordings and their reset times', () => {
  const at = (now, text) => detectAt(now)(text)?.resetAt ?? null;
  const NOW = Date.UTC(2026, 10, 24, 8, 0); // Nov 24 2026, 08:00 UTC
  // today's wording: a date, an hour with am/pm and no minutes, the zone in brackets
  assert.equal(at(NOW, realLimit(Date.UTC(2026, 10, 24, 14))), Date.UTC(2026, 10, 24, 14), 'the current wording, recorded');
  assert.equal(at(NOW, 'You\'ve hit your limit · resets Nov 24, 10:30am (America/New_York)'), Date.UTC(2026, 10, 24, 15, 30), 'with minutes and a named zone');
  assert.equal(at(NOW, 'You\'ve hit your limit · resets 2:30pm (America/New_York)'), Date.UTC(2026, 10, 24, 19, 30), 'the same day, no date');
  assert.equal(at(Date.UTC(2026, 10, 24, 20), 'You\'ve hit your limit · resets 2am (UTC)'), Date.UTC(2026, 10, 25, 2), 'an hour already past today is tomorrow\'s');
  assert.equal(at(Date.UTC(2026, 11, 31, 22), 'You\'ve hit your Fable limit · resets Jan 1, 4am (UTC)'), Date.UTC(2027, 0, 1, 4), 'a December limit that resets in January is next year\'s');
  assert.equal(at(Date.UTC(2026, 6, 1, 6), 'You\'ve hit your limit · resets Jul 1, 10am (Europe/Berlin)'), Date.UTC(2026, 6, 1, 8), 'summer time in the named zone (10am CEST is 08:00 UTC)');
  // older wordings still read; with no zone named the hour is this box's (a reset is never more than 12 hours off)
  const cap = x => Math.min(x, NOW + 12 * 3600_000);
  const today = (h, m) => { const d = new Date(NOW); d.setHours(h, m, 0, 0); if (d.getTime() <= NOW) d.setDate(d.getDate() + 1); return cap(d.getTime()); };
  assert.equal(at(NOW, 'Claude AI usage limit reached|' + (NOW / 1000 + 7200)), NOW + 7200_000, 'the epoch form');
  assert.equal(at(NOW, '5-hour limit reached ∙ resets 3pm'), today(15, 0), 'no zone: this box\'s');
  assert.equal(at(NOW, 'Claude usage limit reached. Your limit will reset at 3:45pm'), today(15, 45), 'reset at, with minutes');
  assert.equal(at(NOW, 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}} retry-after: 90'), NOW + 90_000, 'retry-after');
  // a limit with no time it can read waits the default hour; a zone Intl doesn't know reads as this box's
  assert.equal(at(NOW, 'You\'ve hit your limit'), NOW + 3600_000, 'no reset time: an hour');
  const box = new Date(2026, 10, 24, 14, 0, 0, 0).getTime();
  assert.equal(at(NOW, 'You\'ve hit your limit · resets Nov 24, 2pm (Mars/Base)'), box >= NOW ? cap(box) : NOW + 3600_000, 'an unknown zone');
  // not a limit
  assert.equal(at(NOW, 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}'), null);
  assert.equal(at(NOW, 'Invalid API key · Please run /login'), null);
});

async function boot(t, port, env = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudelimit-')));
  const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), data]) fs.mkdirSync(d, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const secret = 'claudelimit-' + port, exp = Date.now() + 3600_000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'), POCKET_RETRY_BUFFER_MS: '0', ...env,
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(r => child.once('exit', r));
  t.after(async () => { try { child.kill('SIGKILL'); } catch { } await exited; killStrays(data); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
  const raw = async (method, p, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
  };
  const call = (p, body) => raw(body !== undefined ? 'POST' : 'GET', '/api' + p, body, { cookie });
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-2500)}`); await sleep(60); } };
  const calls = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const start = async text => { const r = await call('/new', { provider: 'claude', cwd, text, approvalMode: 'full' }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
  const session = id => call('/session/' + e(id)).then(r => r.body);
  const idle = id => until(async () => { const b = await session(id); return b && !b.active && b.state?.kind !== 'running' ? b : null; }, 15000, `${id} to end`);
  const queue = (id, text) => call(`/session/${e(id)}/message`, { text, mode: 'queue', approvalMode: 'full' });
  const job = (key, body) => raw('POST', '/api/jobs/run', body, { authorization: 'Bearer ' + key });
  return { dir, data, cwd, call, e, until, calls, start, session, idle, queue, job, logs: () => logs };
}

test('A Claude reply that ends on an API error is not a finished reply: a usage limit waits for the reset and holds the queue, another error is a failed reply', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19131);
  const retried = id => s.calls().some(c => c.id === id && /interrupted by an API rate limit/.test(c.text));

  // a limit (subtype success, is_error) with a message queued behind it: the message is not started into the limit
  const a = await s.start('first task __LIMIT__ __SLOW__');
  await s.until(async () => (await s.session(a))?.active, 8000, 'the reply to start');
  const q = await s.queue(a, 'queued follow-up');
  assert.equal(q.status, 202, JSON.stringify(q.body)); assert.equal(q.body.queued, true);
  const ended = await s.idle(a);
  await sleep(2500); // past the limit's reset
  assert.notEqual(ended.state?.label, 'Response ready', 'a usage limit is not a finished reply');
  assert.equal(ended.state?.kind, 'failed', JSON.stringify(ended.state));
  assert.match(String(ended.state?.error), /usage limit reached/);
  assert.ok(!s.calls().some(c => c.id === a && c.text === 'queued follow-up'), 'the queued message did not start into the limit');
  assert.equal((await s.call(`/session/${s.e(a)}/queue`)).body.items[0]?.status, 'pending', 'it waits in the queue');

  // a limit with nothing queued: Waiting for usage reset, then the retry carries the task on
  const b = await s.start('second task __LIMIT__');
  const w = await s.until(async () => { const x = await s.session(b); return x?.state?.label === 'Waiting for usage reset' ? x : null; }, 10000, 'the retry to be armed');
  assert.ok(w.state.retryAt > Date.now() - 60_000, JSON.stringify(w.state));
  assert.ok(s.logs().includes(`rate limited session=${b}`));
  await s.until(() => retried(b), 15000, 'the retry to run');
  assert.equal((await s.idle(b)).state?.label, 'Response ready', 'the retry\'s reply finished');

  // the same limit on an error subtype (its words in `errors`, no `result`) is read as a limit too
  const c = await s.start('third task __LIMITERR__');
  await s.until(() => s.logs().includes(`rate limited session=${c}`), 10000, 'the error-subtype limit to be seen');
  await s.until(() => retried(c), 15000, 'its retry to run');

  // another API error: a failed reply with the CLI's words, no retry, and the queue held
  const d = await s.start('fourth task __APIERR__ __SLOW__');
  await s.until(async () => (await s.session(d))?.active, 8000, 'the reply to start');
  assert.equal((await s.queue(d, 'after the error')).status, 202);
  const failed = await s.idle(d);
  assert.equal(failed.state?.kind, 'failed', JSON.stringify(failed.state));
  assert.equal(failed.state?.label, 'Didn\'t finish');
  assert.match(String(failed.state?.error), /API Error: 500/);
  await sleep(2500);
  assert.ok(!s.logs().includes(`rate limited session=${d}`), 'not a limit, so no retry');
  assert.ok(!retried(d) && !s.calls().some(c => c.id === d && c.text === 'after the error'), 'nothing started after it');

  // a job's reply that ends on that error ends its run failed, not done
  assert.equal((await s.call('/automation/settings', { group: 'jobs', values: { jobs: true } })).status, 200);
  const k = await s.call('/jobs/keys', { name: 'api-error-job', workspace: s.cwd, engine: 'claude', model: 'default', instruction: 'Look at the disk.' });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const run = await s.job(k.body.secret, { data: 'go __APIERR__', wait: 20 });
  assert.equal(run.body.status, 'failed', JSON.stringify(run.body)); assert.equal(run.body.outcome, 'error');
});

test('End to end: the real limit result waits for the reset it names, the queue holds, Pocket closes the idle process meanwhile, and the retry still carries the conversation on', { timeout: 120_000 }, async t => {
  // The reset is the next whole hour (UTC), as the CLI words it; a negative buffer brings the retry to 30 s from now, so
  // the process's idle close (17 s after the reply, past the old 15 s grace) and its exit bookkeeping come first.
  const now = Date.now(), reset = Math.ceil((now + 120_000) / 3600_000) * 3600_000, buffer = now + 30_000 - reset;
  const s = await boot(t, 19132, { FAKE_CLAUDE_LIMIT_TEXT: realLimit(reset), POCKET_RETRY_BUFFER_MS: String(buffer), POCKET_IDLE_CLOSE_MS: '17000' });
  const id = await s.start('long task __LIMIT__');
  const w = await s.until(async () => { const x = await s.session(id); return x?.state?.label === 'Waiting for usage reset' ? x : null; }, 10000, 'the limit to be seen');
  assert.notEqual(w.state.kind, 'finished');
  assert.equal(w.state.retryAt - buffer, reset, 'the retry is set for the reset the message names');
  // a message queued while it waits is held: nothing starts before the retry
  assert.equal((await s.queue(id, 'then tidy up')).status, 202);
  await sleep(1500);
  assert.equal(s.calls().filter(c => c.id === id).length, 1, 'only the first reply ran');
  // Pocket closes the idle process; the CLI writes its exit bookkeeping to the transcript
  await s.until(() => new RegExp(`session process closing session=${id} pid=\\d+ reason=idle`).test(s.logs()), 25000, 'the idle close');
  const file = path.join(s.dir, 'sessions', 'test-workspace', id + '.jsonl');
  await s.until(() => fs.readFileSync(file, 'utf8').includes('"type":"cost-state"'), 5000, 'the exit bookkeeping');
  // the retry still runs, the conversation carries on, and the queued message follows it
  await s.until(() => s.logs().includes(`auto-resume after rate limit session=${id}`) || s.logs().includes(`retry skipped (session continued elsewhere) session=${id}`), 30000, 'the retry to come due');
  assert.ok(!s.logs().includes(`retry skipped (session continued elsewhere) session=${id}`), 'Pocket\'s own idle close is not another app continuing the conversation');
  await s.until(() => s.calls().some(c => c.id === id && /interrupted by an API rate limit/.test(c.text)), 10000, 'the retry\'s reply');
  await s.until(() => s.calls().some(c => c.id === id && c.text === 'then tidy up'), 15000, 'the queued message after the retry');
  const done = await s.idle(id);
  assert.equal(done.state?.label, 'Response ready');
});
