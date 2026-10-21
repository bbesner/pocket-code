// 1.67: automatic model choice and one sign-in are set in Settings. A key is saved to a 0600 file and never returned;
// levels choose among offered models, capped by the policy; Settings wins over the environment until reset; Access
// settings are validated, turn sign-in on and off live, and report the last sign-in. Fake CLIs and a fake decision API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID,generateKeyPairSync,sign as cryptoSign} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');

async function server(t, port, env, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-settings-')); let logs = '';
  const secret = randomUUID(), exp = Date.now() + 3600000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true }); fs.mkdirSync(path.join(dir, 'managed'));
  fs.writeFileSync(path.join(dir, 'managed', 'managed-settings.json'), JSON.stringify({ availableModels: ['claude-opus-5-5', 'claude-sonnet-5-5'], maxEffortLevel: 'high' }));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, env: { ...cleanEnv(), PORT: String(port), POCKET_ENV_FILE: '', POCKET_SKILLS: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_TEST_CALLS: path.join(dir, 'calls'), POCKET_CLAUDE_MANAGED_DIR: path.join(dir, 'managed'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b });
  t.after(async () => { if (child.exitCode === null) { const e = new Promise(r => child.once('exit', r)); child.kill(); await e; } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) break; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } await sleep(30); }
  if (child.exitCode !== null) throw Error('Test server failed: ' + logs);
  const call = async (p, body, h = headers) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null), raw: r }; };
  return { dir, call, logs: () => logs, port };
}

test('automatic model choice from Settings: key never returned, levels among offered models, capped, reset to the server', async t => {
  const asked = [];
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { asked.push(req.headers.authorization); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { tier: { choice: 'deep', probabilities: { deep: 0.9 } } } })); }); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r)); t.after(() => fake.close());
  const s = await server(t, 18681, { POCKET_ASSISTANT_MODE: 'on', POCKET_ROUTER_URL: `http://127.0.0.1:${fake.address().port}/decisions` });
  let r = (await s.call('/settings')).body.router;
  assert.equal(r.enabled, false); assert.equal(r.keySource, 'none'); assert.equal(r.maxEffort, 'high');
  assert.deepEqual(r.levels.map(l => [l.key, l.auto.model, l.auto.effort]), [['quick', 'claude-sonnet-5-5', 'low'], ['standard', 'claude-sonnet-5-5', 'medium'], ['careful', 'claude-sonnet-5-5', 'high'], ['deep', 'claude-opus-5-5[1m]', 'high']]);
  assert.equal((await s.call('/settings', { router: { enabled: true } })).status, 400, 'no key: refused');
  const saved = await s.call('/settings', { router: { key: 'sk-or-test-key-123', enabled: true } });
  assert.equal(saved.status, 200); assert.equal(saved.body.router.keySource, 'settings'); assert.equal(saved.body.router.active, true);
  assert.doesNotMatch(JSON.stringify(saved.body), /sk-or-test-key-123/, 'the key is never sent back');
  const keyFile = path.join(s.dir, 'data', 'router-key');
  assert.equal(fs.readFileSync(keyFile, 'utf8'), 'sk-or-test-key-123'); assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(path.join(s.dir, 'data', 'pocket-settings.json'), 'utf8'), /sk-or-test/);
  // Levels: deep runs Sonnet at max → capped to high; a model that isn't offered is refused.
  assert.equal((await s.call('/settings', { router: { levels: { deep: { model: 'claude-fable-5-1[1m]', effort: 'high' } } } })).status, 400);
  r = (await s.call('/settings', { router: { levels: { deep: { model: 'claude-sonnet-5-5', effort: 'max' } } } })).body.router;
  assert.deepEqual(r.levels.find(l => l.key === 'deep').runs, { model: 'claude-sonnet-5-5', effort: 'high', tier: 'deep' });
  await s.call('/new', { cwd: repo, text: 'Make a proposal', provider: 'claude', clientMessageId: randomUUID() });
  for (let i = 0; i < 60 && !fs.existsSync(path.join(s.dir, 'calls')); i++) await sleep(50);
  await sleep(200);
  const call = JSON.parse(fs.readFileSync(path.join(s.dir, 'calls'), 'utf8').trim().split('\n')[0]);
  assert.equal(call.model, 'claude-sonnet-5-5'); assert.equal(call.effort, 'high'); assert.equal(asked[0], 'Bearer sk-or-test-key-123');
  r = (await s.call('/settings')).body.router; assert.ok(r.last.used, 'Settings shows the last choice');
  // Reset: back to the server's (here: off), and the key file is gone.
  r = (await s.call('/settings', { router: null })).body.router;
  assert.equal(r.enabled, false); assert.equal(r.keySource, 'none'); assert.equal(fs.existsSync(keyFile), false);
});

test('the environment still works and Settings overrides it; the effort picker list knows the ceiling', async t => {
  const s = await server(t, 18682, { POCKET_ROUTER: 'jev', POCKET_ROUTER_KEY: 'env-key' });
  let r = (await s.call('/settings')).body.router;
  assert.equal(r.enabled, true); assert.equal(r.enabledSource, 'env'); assert.equal(r.keySource, 'env');
  r = (await s.call('/settings', { router: { enabled: false } })).body.router;
  assert.equal(r.enabled, false); assert.equal(r.enabledSource, 'settings');
  assert.equal((await s.call('/claude/models')).body.maxEffort, 'high');
  assert.equal((await s.call('/settings', { router: { provider: 'gemini' } })).status, 400);
});

test('one sign-in from Settings: validated, on and off live, last sign-in reported, reset to the server', async t => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certs = http.createServer((q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] })); });
  await new Promise(r => certs.listen(0, '127.0.0.1', r)); t.after(() => certs.close());
  const s = await server(t, 18683, { POCKET_ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs` });
  const tok = (email, team = 'myteam', aud = 'a'.repeat(32)) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }) + '.' + b64({ iss: `https://${team}.cloudflareaccess.com`, aud: [aud], email, exp: now + 600 }); return h + '.' + cryptoSign('RSA-SHA256', Buffer.from(h), privateKey).toString('base64url'); };
  const me = async t2 => (await s.call('/me', null, { 'cf-access-jwt-assertion': t2 })).body.ok;
  let a = (await s.call('/settings')).body.access;
  assert.equal(a.on, false); assert.equal(a.source, 'none');
  assert.equal(await me(tok('owner@example.test')), false, 'off: an Access token does nothing');
  for (const bad of [{ team: 'Bad Team!', aud: 'a'.repeat(32), emails: 'x@y.co' }, { team: 'myteam', aud: 'short', emails: 'x@y.co' }, { team: 'myteam', aud: 'a'.repeat(32), emails: '' }, { team: 'myteam', aud: 'a'.repeat(32), emails: 'not-an-email' }])
    assert.equal((await s.call('/settings', { access: bad })).status, 400, JSON.stringify(bad));
  a = (await s.call('/settings', { access: { team: 'MyTeam', aud: 'a'.repeat(32), emails: 'Owner@Example.test, second@example.test' } })).body.access;
  assert.equal(a.on, true); assert.equal(a.team, 'myteam'); assert.deepEqual(a.emails, ['owner@example.test', 'second@example.test']);
  assert.equal(await me(tok('owner@example.test')), true, 'on: signed in without the password');
  assert.equal(await me(tok('stranger@example.test')), false);
  assert.equal((await s.call('/settings')).body.access.last.email, 'owner@example.test');
  a = (await s.call('/settings', { access: { enabled: false } })).body.access;
  assert.equal(a.on, false); assert.equal(a.off, true);
  assert.equal(await me(tok('owner@example.test')), false, 'turned off: no sign-in by token');
  a = (await s.call('/settings', { access: null })).body.access; assert.equal(a.source, 'none');
});

// 1.73.6: a patch is checked whole before any of it applies; a 400 on a later field leaves the earlier ones untouched.
test('a settings patch is checked whole before any of it applies', async t => {
  const { call } = await server(t, 18684, {});
  const before = (await call('/settings')).body;
  let r = await call('/settings', { projects: !before.projects, tasks: !before.tasks, vaultAccess: before.vaultAccess === 'free' ? 'once' : 'free', notifyEmail: 'not-an-address' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'bad_email');
  let after = (await call('/settings')).body;
  assert.equal(after.projects, before.projects, 'the toggle before the bad field did not apply'); assert.equal(after.tasks, before.tasks); assert.equal(after.vaultAccess, before.vaultAccess);
  r = await call('/settings', { router: { enabled: false, provider: 'openai' }, access: { enabled: false }, trustedActions: [{ nonsense: true }] });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'bad_trusted_action');
  after = (await call('/settings')).body;
  assert.deepEqual(after.router, before.router, 'the router was neither changed nor rebuilt'); assert.deepEqual(after.access, before.access);
  r = await call('/settings', { projects: !before.projects, notifyEmail: 'owner@example.test' }); assert.equal(r.status, 200);
  assert.equal(r.body.projects, !before.projects, 'a patch that passes applies whole'); assert.equal(r.body.notifyEmail, 'owner@example.test');
});