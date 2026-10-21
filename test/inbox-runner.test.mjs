// 1.74: Pocket runs Inbox Watch's watcher (inbox-runner.mjs). The real watcher runs against a fake `claude` that answers
// the Gmail connector's calls in stream-json from a JSON mailbox; nothing reaches a mailbox, a model or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InboxRunner } from '../inbox-runner.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const FAKE = `#!/usr/bin/env python3
import json, os, sys
box = json.load(open(os.environ["FAKE_BOX"]))
prompt = sys.stdin.read()
calls = json.loads(prompt[prompt.index("["):])
def emit(e): print(json.dumps(e))
emit({"type": "system", "subtype": "init", "tools": [] if box.get("no_connector") else ["mcp__claude_ai_Gmail__search_threads", "mcp__claude_ai_Gmail__get_thread", "mcp__claude_ai_Gmail__get_message"]})
if box.get("no_connector"):
    emit({"type": "result", "subtype": "success", "result": "DONE", "total_cost_usd": 0, "usage": {}}); sys.exit()
for i, c in enumerate(calls):
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": f"u{i}", "name": c["tool"], "input": c["input"]}]}})
    if c["tool"].endswith("search_threads"):
        sent = "in:sent" in c["input"]["query"]
        res = {"threads": [{"id": "t1", "messageCount": 1, "messages": [{"id": "m1", "sender": "Alex Rivera <alex@example.com>" if sent else "Pat <pat@vendor.example>", "labelIds": ["SENT"] if sent else ["INBOX"], "date": "2026-10-21T12:00:00Z"}]}]}
    else:
        res = {"id": "t1", "messages": [{"id": "m1", "threadId": "t1", "internalDate": "1792584000000", "labelIds": ["INBOX"], "sender": "Pat <pat@vendor.example>", "subject": "Invoice", "plaintextBody": "Attached."}]}
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": f"u{i}", "content": [{"type": "text", "text": json.dumps(res)}]}]}})
emit({"type": "result", "subtype": "success", "result": "DONE", "total_cost_usd": 0.001, "duration_ms": 10, "usage": {"input_tokens": 10, "output_tokens": 1}})
`;

function rig({ sources = {}, tz = 'America/New_York', box = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-runner-'));
  const bin = path.join(dir, 'claude'), boxFile = path.join(dir, 'box.json');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  fs.writeFileSync(boxFile, JSON.stringify(box));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const settings = { inbox: true, ownerTimezone: tz }, logs = [], pushes = [];
  const runner = new InboxRunner({ dataDir: data, appDir: repo, claudeBin: bin, sessionDir: dir, settings: () => settings, store: { sources }, log: m => logs.push(m),
    notify: (t, b) => pushes.push([t, b]), env: () => ({ ...process.env, FAKE_BOX: boxFile, POCKET_DATA_DIR: data, HOME: dir }) });
  return { dir, data, runner, settings, logs, pushes, boxFile };
}

test('a hand-installed watcher is left alone', async () => {
  const r = rig({ sources: { 'inbox-monitor': { lastReportAt: new Date().toISOString() } } });
  assert.deepEqual(r.runner.status(), { managed: false, state: 'external' });
  await r.runner.step();
  assert.equal(fs.existsSync(path.join(r.data, 'inbox-watch', 'config.toml')), false);
});

test('off when Inbox Watch is off', async () => {
  const r = rig(); r.settings.inbox = false;
  assert.deepEqual(r.runner.status(), { managed: false, state: 'off' });
  await r.runner.step();
  assert.equal(fs.existsSync(path.join(r.data, 'inbox-watch')), false);
});

test('waits for the owner\'s time zone', async () => {
  const r = rig({ tz: '' });
  await r.runner.step();
  assert.equal(r.runner.status().state, 'waiting');
  assert.equal(fs.existsSync(path.join(r.data, 'inbox-watch', 'config.toml')), false);
});

test('sets up from the connector, starts from now, then ticks', async () => {
  const r = rig();
  await r.runner.step();
  const cfg = fs.readFileSync(path.join(r.data, 'inbox-watch', 'config.toml'), 'utf8');
  assert.match(cfg, /email = "alex@example.com"/);
  assert.match(cfg, /name = "Alex Rivera"/);
  assert.match(cfg, /timezone = "America\/New_York"/);
  assert.match(cfg, /provider = "connector"/);
  assert.match(cfg, /\[judge\]\nkind = "claude"/);
  assert.equal(r.runner.status().state, 'setting-up');
  assert.equal(r.runner.status().mailbox, 'alex@example.com');
  await r.runner.step(); // --baseline-only
  assert.equal(r.runner.status().state, 'running', JSON.stringify(r.runner.state));
  assert.equal(r.runner.state.baselined, true);
  assert.equal(r.runner.state.backfill, 'due');
});

test('no Gmail connector says what to connect', async () => {
  const r = rig({ box: { no_connector: true } });
  await r.runner.step();
  const s = r.runner.status();
  assert.equal(s.state, 'needs-connector');
  assert.match(s.message, /Connectors/);
});
