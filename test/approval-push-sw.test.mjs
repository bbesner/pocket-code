// 1.126: the service worker half of answering an action approval from its notification (docs/plans/notification-approvals.md,
// Part 3 "What the notification carries" and "What the owner sees", Testing 22-25). public/sw.js runs in a vm with stand-ins
// for the registration, clients and fetch, as in test/review-1881-secA.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
// every regex metacharacter, the backslash included, so a value matches only as itself
const reEscape = v => String(v).replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&');
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repo = path.resolve(import.meta.dirname, '..');
const origin = 'https://pocket.example.test';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-one';

function worker({ respond = async () => ({ ok: true, status: 200, type: 'basic', json: async () => ({ ok: true }) }), endpoint = ENDPOINT } = {}) {
  const opened = [], fetched = [], shown = [], handlers = {};
  const client = { frameType: 'top-level', url: origin + '/', focus: async () => client, navigate: async u => { opened.push(String(u)); return client; } };
  const ctx = {
    location: new URL(origin + '/sw.js'), URL, navigator: {},
    registration: { scope: origin + '/', showNotification: async (title, opts) => { shown.push({ title, ...opts }); }, pushManager: { getSubscription: async () => endpoint ? { endpoint } : null } },
    fetch: async (url, init = {}) => { fetched.push({ url: String(url), ...init, body: init.body ? JSON.parse(init.body) : undefined }); return respond(String(url), init); },
    caches: { open: async () => ({ addAll: async () => { }, put: async () => { } }), keys: async () => [], match: async () => null },
    clients: { matchAll: async () => [client], openWindow: async u => { opened.push(String(u)); return null; }, claim: async () => { } },
    addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: () => { },
  };
  ctx.self = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(repo, 'public/sw.js'), 'utf8'), ctx);
  const click = async (data, action = '') => { let p; let closed = false; handlers.notificationclick({ action, notification: { data, close() { closed = true; } }, waitUntil: x => { p = x; } }); await p; return closed; };
  const push = async payload => { let p; handlers.push({ data: { json: () => payload }, waitUntil: x => { p = x; } }); await p; return shown.at(-1); };
  return { opened, fetched, shown, click, push };
}
const APPROVAL = { session: 'cx:0f6a1c2e-1111-4222-8333-944455556666', request: '7d1e0c3a-aaaa-4bbb-8ccc-dddddddddddd', shown: 'a'.repeat(64) };
const data = (over = {}) => ({ url: `/#/chat/${APPROVAL.session}?approval=${APPROVAL.request}`, approval: { ...APPROVAL, ...over } });

test('T22: Allow posts to the address built from the notification\'s own session and request, with its shown and its own endpoint, and never reads the approvals list', async () => {
  const w = worker();
  const closed = await w.click(data(), 'allow');
  assert.equal(closed, true);
  assert.equal(w.fetched.length, 1, 'one request, no lookup of what is waiting');
  const f = w.fetched[0];
  assert.equal(f.url, `/api/session/${encodeURIComponent(APPROVAL.session)}/approvals/${encodeURIComponent(APPROVAL.request)}/decision`);
  assert.equal(f.method, 'POST'); assert.equal(f.redirect, 'manual'); assert.equal(f.credentials, 'same-origin');
  assert.deepEqual(f.body, { decision: 'allow', via: 'notification', shown: APPROVAL.shown, endpoint: ENDPOINT });
  assert.ok(!w.fetched.some(x => /\/approvals(\?|$)/.test(x.url)), 'the approvals list is never read');
  assert.deepEqual(w.opened, [], 'on success nothing opens'); assert.deepEqual(w.shown, [], 'and nothing new shows');
  // Don't allow: the same address, decision deny
  const d = worker(); await d.click(data(), 'deny');
  assert.equal(d.fetched.length, 1); assert.equal(d.fetched[0].body.decision, 'deny'); assert.equal(d.fetched[0].body.via, 'notification');
  // A second notification of another request answers that request, whatever else is waiting
  const other = worker(); await other.click(data({ request: '00000000-1111-4222-8333-444444444444', session: 'acp:other' }), 'allow');
  assert.equal(other.fetched[0].url, '/api/session/acp%3Aother/approvals/00000000-1111-4222-8333-444444444444/decision');
  // A malformed id posts nothing
  const bad = worker(); await bad.click(data({ session: '../../api/vault' }), 'allow');
  assert.equal(bad.fetched.length, 0);
});

test('T23: every answer that does not land maps to its missed reason, shows the approval-missed notification and opens the page at the request', async () => {
  const cases = [
    [{ status: 401 }, 'signin'], [{ status: 0, type: 'opaqueredirect' }, 'signin'], [{ status: 302 }, 'signin'],
    [{ status: 403 }, 'refused'], // F7: Pocket's same-origin check, not a sign-in
    [{ status: 404, code: 'answers_off' }, 'off'],
    [{ status: 409 }, 'gone'], [{ status: 409, code: 'gone' }, 'gone'], [{ status: 409, code: 'answered' }, 'gone'],
    [{ status: 409, code: 'answered_in_app' }, 'answered'],
    [{ status: 409, code: 'changed' }, 'changed'], [{ status: 409, code: 'not_offered' }, 'changed'],
    [{ status: 409, code: 'too_old' }, 'old'],
    [{ status: 503 }, 'uncertain'],
    ['offline', 'offline'],
    [{ status: 500 }, 'error'],
  ];
  for (const [answer, why] of cases) for (const tap of ['allow', 'deny']) {
    const w = worker({ respond: async () => { if (answer === 'offline') throw new TypeError('Failed to fetch'); return { ok: false, status: answer.status, type: answer.type || 'basic', json: async () => (answer.code ? { code: answer.code } : {}) }; } });
    await w.click(data(), tap);
    const want = `/#/chat/${APPROVAL.session}?approval=${APPROVAL.request}&missed=${why}&tap=${tap}`;
    assert.equal(w.opened.at(-1), origin + want, `${JSON.stringify(answer)} ${tap}`);
    assert.equal(w.shown.length, 1, `${JSON.stringify(answer)}: a notification says it did not go through`);
    assert.equal(w.shown[0].tag, 'approval-missed:' + APPROVAL.request);
    assert.match(w.shown[0].body, new RegExp(`^Your ${reEscape(tap === 'allow' ? 'Allow' : "Don't allow")} didn't go through: .+\\. Open Pocket\\.$`));
    assert.equal(w.shown[0].data.url, want);
    assert.ok(!w.shown[0].actions?.length, 'the missed notification has no buttons');
    if (why === 'refused') assert.ok(!/signed out/.test(w.shown[0].body) && /Pocket refused the answer from this address/.test(w.shown[0].body), 'a 403 does not say signed out');
    if (why === 'answered') assert.match(w.shown[0].body, /it was answered in Pocket/);
  }
});

test('T24: a body tap opens and posts nothing; a replacement shows silently with the same tag and no actions; the test notification\'s buttons post nothing', async () => {
  const w = worker();
  await w.click(data(), '');
  assert.equal(w.fetched.length, 0, 'opening a notification is not a decision');
  assert.equal(w.opened.at(-1), origin + `/#/chat/${APPROVAL.session}?approval=${APPROVAL.request}`);
  // The approval push itself: the actions ride along, and the request it names
  const n = await w.push({ title: 'Allow this command?', body: 'Runs: ls', tag: 'approval:' + APPROVAL.request, url: '/#/chat/x', approval: APPROVAL, actions: [{ action: 'deny', title: "Don't allow" }, { action: 'allow', title: 'Allow' }] });
  assert.deepEqual(n.actions.map(a => a.action), ['deny', 'allow']); assert.deepEqual({ ...n.data.approval }, APPROVAL); assert.equal(n.silent, undefined);
  // A replacement: silent, no buttons, no approval to answer, even if the server sent actions
  const r = await w.push({ title: 'Pocket Code', body: 'Allowed on another device at 2:14 PM', tag: 'approval:' + APPROVAL.request, url: '/#/chat/x', silent: true, approval: APPROVAL, actions: [{ action: 'allow', title: 'Allow' }] });
  assert.equal(r.tag, 'approval:' + APPROVAL.request); assert.equal(r.silent, true); assert.equal(r.actions, undefined); assert.equal(r.data.approval, undefined);
  await w.click(r.data, 'allow');
  assert.equal(w.fetched.length, 0, 'a replacement answers nothing');
  // The device test: both buttons only open Settings
  const t = await w.push({ title: 'Test: Allow this command?', body: 'Runs: echo AB\nIn: ~/x/CD', tag: 'approval-test', url: '/#/settings/notifications?approvalTest=1', approvalTest: true, actions: [{ action: 'deny', title: "Don't allow" }, { action: 'allow', title: 'Allow' }] });
  assert.equal(t.data.approvalTest, true);
  for (const b of ['allow', 'deny', '']) { await w.click(t.data, b); assert.equal(w.opened.at(-1), origin + '/#/settings/notifications?approvalTest=1'); }
  assert.equal(w.fetched.length, 0, 'the test notification posts nothing');
});

test('T25: the Vault, document and due-task buttons still work', async () => {
  const w = worker();
  await w.click({ url: '/#/vault/request/vr-1', vaultRequest: 'vr-1' }, 'allow');
  assert.equal(w.fetched.at(-1).url, '/api/vault/act'); assert.deepEqual(w.fetched.at(-1).body, { action: 'answer', request: 'vr-1', decision: 'once' });
  await w.click({ url: '/#/vault/request/vr-1', vaultRequest: 'vr-1' }, 'deny');
  assert.deepEqual(w.fetched.at(-1).body, { action: 'answer', request: 'vr-1', decision: 'deny' });
  await w.click({ url: '/#/documents', docRequest: 'dr-1' }, 'allow');
  assert.equal(w.fetched.at(-1).url, '/api/documents/requests/dr-1/answer'); assert.deepEqual(w.fetched.at(-1).body, { decision: 'allow' });
  await w.click({ url: '/#/tasks', snooze: { task: 't-1' } }, 'done');
  assert.equal(w.fetched.at(-1).url, '/api/tasks/act'); assert.deepEqual(w.fetched.at(-1).body, { action: 'update', task: 't-1', done: true });
  await w.click({ url: '/#/tasks', snooze: { project: 'p-1', reminder: 'r-1', label: 'Call' } }, 'later');
  assert.equal(w.fetched.at(-1).url, '/api/board/act'); assert.equal(w.fetched.at(-1).body.action, 'remind');
  assert.equal(w.fetched.length, 5);
  // A Vault Allow that does not land still opens the request with its reason, as before
  const v = worker({ respond: async () => ({ ok: false, status: 423 }) });
  await v.click({ url: '/', vaultRequest: 'vr-2' }, 'allow');
  assert.equal(v.opened.at(-1), origin + '/#/vault/request/vr-2?missed=locked&tap=allow');
});
