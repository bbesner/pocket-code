// 1.63 one sign-in: a Cloudflare Access token for an allowed email signs in without Pocket's password; every other
// token (forged, another key, wrong issuer or audience, expired, not yet valid, another email, another algorithm,
// malformed) leaves the password page. Keys and tokens are minted here; a local server plays Cloudflare's certs URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {generateKeyPairSync, sign as cryptoSign, randomUUID, createHmac} from 'node:crypto';
import {AccessVerifier} from '../access.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const good = pair(), other = pair(), KID = 'kid-1', TEAM = 'pocket-test', AUD = 'aud-123', ISS = `https://${TEAM}.cloudflareaccess.com`;
const jwk = (k, kid) => ({ ...k.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
function token(claims = {}, { key = good.privateKey, kid = KID, alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: ISS, aud: [AUD], email: 'owner@example.test', exp: now + 600, iat: now, nbf: now, sub: 'x', ...claims };
  const head = b64({ alg, kid, typ: 'JWT' }) + '.' + b64(body);
  return head + '.' + cryptoSign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
}
async function certsServer(t) {
  let hits = 0;
  const srv = http.createServer((req, res) => { hits++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk(good, KID)], public_cert: {}, public_certs: [] })); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); t.after(() => srv.close());
  return { url: `http://127.0.0.1:${srv.address().port}/cdn-cgi/access/certs`, hits: () => hits };
}

test('verifier: accepts only a correctly signed, current token for this team, application and an allowed email', async t => {
  const certs = await certsServer(t);
  const v = new AccessVerifier({ team: TEAM, aud: AUD, emails: 'Owner@Example.test, second@example.test', certsUrl: certs.url });
  assert.equal(v.on, true);
  assert.equal((await v.verify(token())).email, 'owner@example.test');
  assert.equal((await v.verify(token({ email: 'second@example.test', aud: AUD }))).email, 'second@example.test', 'aud may be a string');
  const now = Math.floor(Date.now() / 1000);
  const refused = {
    'signed with another key': token({}, { key: other.privateKey }),
    'an unknown key id': token({}, { kid: 'kid-unknown' }),
    'another issuer': token({ iss: 'https://evil.cloudflareaccess.com' }),
    'another application': token({ aud: ['aud-other'] }),
    'expired': token({ exp: now - 3600 }),
    'not yet valid': token({ nbf: now + 3600 }),
    'no expiry': token({ exp: undefined }),
    'another email': token({ email: 'stranger@example.test' }),
    'no email': token({ email: '' }),
    'alg none': (() => { const h = b64({ alg: 'none', kid: KID }) + '.' + b64({ iss: ISS, aud: [AUD], email: 'owner@example.test', exp: now + 600 }); return h + '.'; })(),
    'HS256': token({}, { alg: 'HS256' }),
    'tampered payload': (() => { const [h, , s] = token().split('.'); return h + '.' + b64({ iss: ISS, aud: [AUD], email: 'owner@example.test', exp: now + 99999 }) + '.' + s; })(),
    'garbage': 'not.a.token!', 'empty': '',
  };
  for (const [why, tok] of Object.entries(refused)) assert.ok((await v.verify(tok)).error, why + ' is refused');
  assert.ok(certs.hits() <= 3, 'keys are cached; an unknown key id refetches at most once a minute');
  for (const cfg of [{ team: '', aud: AUD, emails: 'a@b.c' }, { team: TEAM, aud: '', emails: 'a@b.c' }, { team: TEAM, aud: AUD, emails: '' }, { team: 'bad team!', aud: AUD, emails: 'a@b.c' }])
    assert.equal(new AccessVerifier(cfg).on, false, 'off unless team, audience and emails are all set: ' + JSON.stringify(cfg));
  const down = new AccessVerifier({ team: TEAM, aud: AUD, emails: 'owner@example.test', certsUrl: 'http://127.0.0.1:9/certs' });
  assert.equal((await down.verify(token())).error, 'keys', 'no keys: refused, never trusted');
  // Review fixes: a null header, a non-ASCII or non-string email.
  const now2 = Math.floor(Date.now() / 1000);
  assert.equal((await v.verify(b64('null') + '.' + b64({}) + '.' + 'AAAA')).error, 'malformed');
  assert.equal((await v.verify(token({ email: '\u212Aim@example.test' }))).error, 'email', 'Kelvin sign is not K');
  assert.equal((await v.verify(token({ email: ['owner@example.test'] }))).error, 'email', 'an array is not an email');
  assert.ok(now2 > 0);
});

test('verifier: a failed hourly refresh keeps the cached keys for a day and backs off', async () => {
  let up = true, hits = 0, clock = Date.now();
  const fetchImpl = async () => { hits++; if (!up) throw new Error('down'); return { ok: true, json: async () => ({ keys: [jwk(good, KID)] }) }; };
  const v = new AccessVerifier({ team: TEAM, aud: AUD, emails: 'owner@example.test', certsUrl: 'http://certs.invalid/', fetchImpl, now: () => clock });
  assert.equal((await v.verify(token())).email, 'owner@example.test'); assert.equal(hits, 1);
  up = false; clock += 2 * 3600_000; // the hourly refresh is due and Cloudflare is down
  // Tokens are minted with the real clock; the verifier's clock moved, so give them a long life.
  const long = () => token({ exp: Math.floor(clock / 1000) + 600, nbf: Math.floor(clock / 1000) - 10 });
  for (let i = 0; i < 5; i++) assert.equal((await v.verify(long())).email, 'owner@example.test', 'cached keys still verify');
  assert.equal(hits, 2, 'one failed attempt, then a minute of back-off');
  clock += 23 * 3600_000; assert.equal((await v.verify(long())).error, 'keys', 'past a day the cache is too old to trust');
});

test('server: an Access token signs in without the password, sets the normal cookie; anything else is still refused', async t => {
  const certs = await certsServer(t), port = 18680;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-access-')); let logs = '';
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, env: { ...cleanEnv(), PORT: String(port), POCKET_ENV_FILE: '', POCKET_PASSWORD: 'test-only', POCKET_SECRET: randomUUID(),
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'),
    POCKET_ACCESS_TEAM: TEAM, POCKET_ACCESS_AUD: AUD, POCKET_ACCESS_EMAILS: 'owner@example.test', POCKET_ACCESS_CERTS_URL: certs.url }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b });
  t.after(async () => { if (child.exitCode === null) { const e = new Promise(r => child.once('exit', r)); child.kill(); await e; } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) break; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } await sleep(30); }
  const get = (p, tok) => fetch(`http://127.0.0.1:${port}/api${p}`, { headers: tok == null ? {} : { 'cf-access-jwt-assertion': tok } });

  const me = await get('/me', token()); const body = await me.json();
  assert.equal(body.ok, true, 'signed in by the Access token');
  const cookie = me.headers.get('set-cookie'); assert.match(cookie, /^pc_auth=\d+\.[0-9a-f]+; HttpOnly; Secure; SameSite=Lax/);
  const withCookie = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(withCookie.status, 200, 'the cookie it set works like a password sign-in');
  assert.equal((await get('/sessions', token())).status, 200, 'an API call with only the token also works');

  assert.equal((await (await get('/me')).json()).ok, false, 'no token, no cookie: signed out');
  assert.equal((await (await get('/me', token({}, { key: other.privateKey }))).json()).ok, false, 'forged token');
  assert.equal((await (await get('/me', token({ email: 'stranger@example.test' }))).json()).ok, false, 'not on the list');
  assert.equal((await get('/sessions', token({ aud: ['aud-other'] }))).status, 401, 'another application');
  assert.equal((await get('/sessions', token({ exp: Math.floor(Date.now() / 1000) - 3600 }))).status, 401, 'expired');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-only' }) })).status, 200, 'the password still works');
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)[1]); assert.ok(maxAge <= 600 && maxAge > 0, 'an Access sign-in lasts no longer than its token (here 10 minutes), at most a day: ' + maxAge);
  const cross = await fetch(`http://127.0.0.1:${port}/api/upload`, { method: 'POST', headers: { 'cf-access-jwt-assertion': token(), 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(cross.status, 401, 'a cross-site POST cannot sign in through Access');
  const foreign = await fetch(`http://127.0.0.1:${port}/api/upload`, { method: 'POST', headers: { 'cf-access-jwt-assertion': token(), origin: 'https://evil.example', 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(foreign.status, 401, 'nor a POST from another origin');
  assert.match(logs, /signed in through Cloudflare Access: owner@example\.test/);
  assert.equal((logs.match(/signed in through Cloudflare Access/g) || []).length, 1, 'logged once an hour per person, not per request');
  assert.doesNotMatch(logs, /eyJ/, 'tokens are never logged');
});
