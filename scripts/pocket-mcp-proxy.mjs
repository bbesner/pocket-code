#!/usr/bin/env node
// pocket-mcp-proxy (1.43): Typed by Pocket. Sits between an agent (Claude Code, Codex) and an MCP server such as the
// Playwright browser tools, speaking MCP over stdio on both sides:
//
//   node scripts/pocket-mcp-proxy.mjs [--name playwright] -- npx -y @playwright/mcp --headless --no-sandbox
//
// A tool call whose arguments name {{vault:name}} or {{vault:name.field}} gets the real values from the Pocket Code
// Vault (under the owner's Agent access setting, with the same approval flow as `pocket-vault run`), typed into the
// arguments on the way to the server. Every value released this way is then removed from everything the server sends
// back (results, snapshots, logs), replaced by its placeholder. The agent's tool call and the transcript only ever hold
// the placeholder. A call with no placeholder passes through untouched, so wrapping a server never changes its
// ordinary behaviour; if the Vault is off, locked or unreachable, only calls that name a placeholder fail, with a
// message the agent can act on.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { needlesFor, PLACEHOLDER_ALL } from '../vault.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = {};
try { for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && !m[1].startsWith('#')) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); } } catch { }
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon writes its address to <data dir>/cli-url at start (1.43.1). Read that first, then this checkout's .env, and only
// then an inherited PORT: an app the agent is working on may export PORT, and the CLI token must never go to it.
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();
const WAIT = Math.max(1, Number(process.env.POCKET_VAULT_FILL_WAIT) || 90);

const argv = process.argv.slice(2), dash = argv.indexOf('--');
const ours = dash === -1 ? [] : argv.slice(0, dash), child = dash === -1 ? argv : argv.slice(dash + 1);
const nameAt = ours.indexOf('--name'), serverName = nameAt !== -1 && ours[nameAt + 1] ? ours[nameAt + 1] : path.basename(String(child[child.length - 1] || 'mcp')).replace(/[^\w.-]/g, '').slice(0, 64) || 'mcp';
if (!child.length) { process.stderr.write('pocket-mcp-proxy: give the MCP server command after --\n'); process.exit(2); }
// Never pass a vault key or the daemon's own secrets on; the runner token stays (it ties a fill to its session).
const childEnv = { ...process.env }; for (const k of ['POCKET_VAULT_KEY', 'POCKET_PASSWORD', 'POCKET_SECRET', 'VAPID_PRIVATE']) delete childEnv[k];
const server = spawn(child[0], child.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });

// Everything released so far, longest first: every form of each value -> its placeholder.
let scrubTable = [];
function remember(ref, value) {
  const forms = needlesFor([value]); if (!forms.length) return;
  scrubTable = [...scrubTable.filter(e => e.ph !== `{{vault:${ref}}}`), { ph: `{{vault:${ref}}}`, forms }].sort((a, b) => b.forms[0].length - a.forms[0].length);
}
const scrubText = t => { for (const e of scrubTable) for (const f of e.forms) t = t.split(f).join(e.ph); return t; };
const deep = (v, fn) => typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map(x => deep(x, fn)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, fn)])) : v;
const refsIn = v => { const out = new Set(); deep(v, s => { for (const m of s.matchAll(PLACEHOLDER_ALL)) out.add(m[1]); return s; }); return [...out]; };

const toClient = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const toServer = msg => { try { server.stdin.write(JSON.stringify(msg) + '\n'); } catch { } };
const toolError = (id, text) => toClient({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } });

// The CLI token and runner token, as pocket-vault uses them.
function headers() {
  let token = ''; try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { }
  return { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(process.env.POCKET_RUNNER_TOKEN ? { 'x-pocket-runner': process.env.POCKET_RUNNER_TOKEN } : {}) };
}
const pendingByRefs = new Map(); // a call that named the same refs again continues the request the owner was asked about
async function release(refs, tool, retried = false) {
  const key = tool + '\u0000' + refs.join('\u0000'), request = pendingByRefs.get(key);
  let r, data, raw = '';
  try {
    // 1.73.3: bounded by the wait plus a margin; a daemon that never answers (it used to, when the Vault was locked mid-request) no longer hangs the tool call.
    r = await fetch(base + '/api/vault/release', { method: 'POST', headers: headers(), body: JSON.stringify(request ? { request, wait: WAIT } : { refs, server: serverName, tool, cwd: process.cwd(), wait: WAIT }), signal: AbortSignal.timeout((WAIT + 15) * 1000) });
    raw = await r.text(); try { data = JSON.parse(raw); } catch { data = null; }
  }
  catch (e) { return { error: `Pocket Code is not reachable, so the Vault could not fill ${refs.join(', ')}: ${e.cause?.code || e.message}` }; }
  // An answer that is not the Vault's JSON (seen once, right after a daemon restart): note its shape, never its body, and try once more.
  if (!data || typeof data !== 'object' || (r.ok && !('ok' in data) && !('pending' in data) && !('error' in data))) {
    process.stderr.write(`pocket-mcp-proxy: unexpected answer from ${base}/api/vault/release: ${r.status} ${r.headers.get('content-type') || '-'} ${raw.length} bytes${retried ? '' : '; retrying once'}\n`);
    if (!retried) { await new Promise(res => setTimeout(res, 1500)); return release(refs, tool, true); }
    data = data && typeof data === 'object' ? data : {};
  }
  if (r.status === 404 && request) { pendingByRefs.delete(key); return release(refs, tool); } // the request expired: ask again
  if (data.pending) { pendingByRefs.set(key, data.request); return { error: `The Vault is asking the owner to allow filling ${(data.items || refs).join(', ')} into ${tool} (request ${data.request}). Tell the owner, and call this tool again with the same arguments once they allow it.` }; }
  pendingByRefs.delete(key);
  if (!r.ok || !data.ok) return { error: data.code === 'vault_off' ? 'The Vault is off in this Pocket Code, so it cannot fill that value. Ask the owner.' : data.code === 'vault_locked' ? 'The Vault is locked. Ask the owner to unlock it in Pocket Code, then call the tool again.' : (data.error || `The Vault could not fill ${refs.join(', ')} (${r.status}).`) };
  return { values: data.values };
}

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let msg; try { msg = JSON.parse(line); } catch { try { server.stdin.write(line + '\n'); } catch { } return; }
  if (msg?.method !== 'tools/call' || !msg.params) return toServer(msg);
  const refs = refsIn(msg.params.arguments); if (!refs.length) return toServer(msg);
  const got = await release(refs, String(msg.params.name || 'tool'));
  if (got.error) return toolError(msg.id, got.error);
  for (const [ref, value] of Object.entries(got.values)) remember(ref, value);
  const filled = deep(msg.params.arguments, s => s.replace(PLACEHOLDER_ALL, (m, ref) => got.values[ref] ?? m));
  toServer({ ...msg, params: { ...msg.params, arguments: filled } });
}).on('close', () => { try { server.stdin.end(); } catch { } });

readline.createInterface({ input: server.stdout }).on('line', line => {
  if (!scrubTable.length) return process.stdout.write(line + '\n');
  let msg; try { msg = JSON.parse(line); } catch { return process.stdout.write(scrubText(line) + '\n'); }
  toClient(deep(msg, scrubText));
});
server.stderr.on('data', b => process.stderr.write(scrubTable.length ? scrubText(String(b)) : b));
server.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
server.on('error', e => { process.stderr.write(`pocket-mcp-proxy: could not start ${child[0]}: ${e.message}\n`); process.exit(1); });
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { try { server.kill(s); } catch { } });
