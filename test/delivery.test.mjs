import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryReceipts } from '../delivery.mjs';
import { sessionState, prioritizeSessions } from '../session-state.mjs';

function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-receipts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'receipts.json');
  return { file, receipts: new DeliveryReceipts(file) };
}
test('concurrent and post-restart retries dispatch an accepted message once', async t => {
  const { receipts, file } = store(t); let calls = 0;
  const action = async () => { calls++; await new Promise(r => setTimeout(r, 15)); return { status: 202, body: { ok: true } }; };
  const [a,b] = await Promise.all([receipts.run('session:message', {text:'Order'}, action), receipts.run('session:message', {text:'Order'}, action)]);
  assert.deepEqual(a,b); assert.equal(calls,1);
  assert.deepEqual(await new DeliveryReceipts(file).run('session:message', {text:'Order'}, action), a);
  assert.equal(calls,1);
});
test('reusing an ID for changed content cannot dispatch', async t => {
  const { receipts } = store(t);
  await receipts.run('key', {text:'First'}, async () => ({status:202,body:{ok:true}}));
  const r = await receipts.run('key', {text:'Different'}, () => assert.fail('must not run'));
  assert.equal(r.status,409); assert.equal(r.body.code,'message_conflict');
});
test('a crash between reservation and acknowledgment is explicit, never re-executed', async t => {
  const { receipts, file } = store(t);
  await receipts.run('key', {}, async () => { throw Error('simulated interruption after dispatch'); });
  const r = await new DeliveryReceipts(file).run('key', {}, () => assert.fail('must not rerun ambiguous work'));
  assert.equal(r.body.code,'delivery_uncertain');
});
test('a refusal is not kept, so a retry asks again and may change its options', async t => {
  const { receipts, file } = store(t); let calls = 0;
  const refuse = async () => { calls++; return { status: 409, body: { error: 'held', code: 'account_stale_jobs' } }; };
  assert.equal((await receipts.run('key', {text:'Go'}, refuse)).status, 409);
  assert.equal((await receipts.run('key', {text:'Go'}, refuse)).status, 409); assert.equal(calls, 2);
  assert.equal(new DeliveryReceipts(file).records.key, undefined);
  const r = await receipts.run('key', {text:'Go', replaceStaleLogin:true}, async () => ({status:202,body:{ok:true}}));
  assert.equal(r.status, 202);
  assert.deepEqual(await receipts.run('key', {text:'Go', replaceStaleLogin:true}, () => assert.fail('accepted once')), r);
});
test('a refusal kept before 1.89.1 is forgotten, so its retry runs', async t => {
  const { file } = store(t);
  fs.writeFileSync(file, JSON.stringify({ key: { hash: 'from-1.89.0', at: Date.now(), response: { status: 409, body: { error: 'held' } } }, ok: { hash: 'x', at: Date.now(), response: { status: 202, body: { ok: true } } } }));
  const receipts = new DeliveryReceipts(file); let calls = 0;
  const r = await receipts.run('key', {text:'Go'}, async () => { calls++; return {status:202,body:{ok:true}}; });
  assert.equal(r.status, 202); assert.equal(calls, 1);
  assert.deepEqual(await receipts.run('key', {text:'Go'}, () => assert.fail('accepted once')), r);
  assert.equal((await receipts.run('ok', {text:'Other'}, () => assert.fail('must not run'))).body.code, 'message_conflict');
});
test('receipt storage failure prevents dispatch', async t => {
  const { receipts } = store(t); receipts.save = () => { throw Error('disk unavailable'); };
  const r = await receipts.run('key', {}, () => assert.fail('no receipt, no action'));
  assert.equal(r.body.code,'receipt_unavailable');
});
test('corrupt receipt store fails closed instead of forgetting accepted messages', t => {
  const { file } = store(t); fs.writeFileSync(file, '{broken');
  assert.throws(() => new DeliveryReceipts(file));
});
test('confirmed runs, recent external writes and outcomes are distinct', () => {
  assert.equal(sessionState({turn:{startedAt:100,queue:[{}]},external:true}).kind,'running');
  assert.deepEqual(sessionState({external:true}),{kind:'observed',label:'Activity elsewhere',confirmed:false});
  assert.equal(sessionState({retryAt:1000}).kind,'waiting');
  const outcome={kind:'finished',label:'Response ready',at:100};
  assert.equal(sessionState({outcome,external:true,mtimeMs:101}).kind,'finished');
  assert.equal(sessionState({outcome,external:true,mtimeMs:10000}).kind,'observed');
  assert.equal(sessionState({outcome,mtimeMs:10000}).kind,'idle');
});
test('long-running sessions are not trimmed from a full recent list', () => {
  const rows=[{id:'recent',state:{kind:'idle'}},{id:'older-running',state:{kind:'running'}},{id:'pinned',pinned:true,state:{kind:'idle'}}];
  assert.deepEqual(prioritizeSessions(rows,1).map(s=>s.id),['older-running','pinned']);
});
