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
//
// 1.73.5: values go into fill tools only (POCKET_VAULT_FILL_TOOLS names them), and once a value has been typed, images,
// audio and other binary content from the server are replaced by a note for the rest of the relay's life: a screenshot
// of a page showing the value cannot be scrubbed.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { needlesFor, makeScrubStream, PLACEHOLDER_ALL } from '../vault.mjs';
import { agentEnv } from '../environment.mjs';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = readEnvFile(envFile);
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon writes its address to <data dir>/cli-url at start (1.43.1). Read that first, then this checkout's .env, and only
// then an inherited PORT: an app the agent is working on may export PORT, and the CLI token must never go to it.
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();
const WAIT = Math.max(1, Number(process.env.POCKET_VAULT_FILL_WAIT) || 90);
// 1.73.5: the tools a value may be typed into. Playwright MCP's browser_type and browser_fill_form, or a server's plain type and
// fill; POCKET_VAULT_FILL_TOOLS (comma-separated) is the list for another server. A browser_evaluate or browser_navigate that
// names a placeholder is refused: a value typed into a field stays on that page, one handed to code or an address goes anywhere.
const FILL_TOOLS = [...new Set((process.env.POCKET_VAULT_FILL_TOOLS || 'browser_type,browser_fill_form,type,fill').split(',').map(s => s.trim()).filter(Boolean))];

const argv = process.argv.slice(2), dash = argv.indexOf('--');
const ours = dash === -1 ? [] : argv.slice(0, dash), child = dash === -1 ? argv : argv.slice(dash + 1);
const nameAt = ours.indexOf('--name'), serverName = nameAt !== -1 && ours[nameAt + 1] ? ours[nameAt + 1] : path.basename(String(child[child.length - 1] || 'mcp')).replace(/[^\w.-]/g, '').slice(0, 64) || 'mcp';
if (!child.length) { process.stderr.write('pocket-mcp-proxy: give the MCP server command after --\n'); process.exit(2); }
// Never pass a vault key or the daemon's own secrets on (1.73.5: the same list the daemon keeps from agents, environment.mjs);
// the runner token stays (it ties a fill to its session).
const childEnv = agentEnv(process.env);
const server = spawn(child[0], child.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });

// Everything released so far, longest first: every form of each value -> its placeholder. 1.73.5: a value released again under
// the same name (the owner changed it between two fills) joins the table beside the earlier one, which may still be on the page.
let scrubTable = [], filled = false, errStream = null;
function remember(ref, value) {
  const forms = needlesFor([value]); if (!forms.length) return;
  const ph = `{{vault:${ref}}}`, key = forms.join('\u0000');
  if (scrubTable.some(e => e.ph === ph && e.key === key)) return;
  scrubTable = [...scrubTable, { ph, key, forms }].sort((a, b) => b.forms[0].length - a.forms[0].length);
  // stderr is scrubbed as a stream (a value split across two chunks is still caught); the held tail moves to the new table.
  const tail = errStream ? errStream.end() : ''; errStream = makeScrubStream(scrubTable); const out = errStream.push(tail); if (out) process.stderr.write(out);
}
const scrubText = t => { for (const e of scrubTable) for (const f of e.forms) t = t.split(f).join(e.ph); return t; };
const deep = (v, fn) => typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map(x => deep(x, fn)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, fn)])) : v;
const refsIn = v => { const out = new Set(); deep(v, s => { for (const m of s.matchAll(PLACEHOLDER_ALL)) out.add(m[1]); return s; }); return [...out]; };
// 1.73.5: on the way out, object keys and numbers or booleans that spell a value are scrubbed too, not only strings.
const scrubDeep = v => typeof v === 'string' ? scrubText(v) : typeof v === 'number' || typeof v === 'boolean' ? (s => { const r = scrubText(s); return r === s ? v : r; })(String(v)) : Array.isArray(v) ? v.map(scrubDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrubText(k), scrubDeep(x)])) : v;
// 1.73.5: once a value has been typed, no picture or binary blob comes back: an image, audio or blob content item becomes a note.
const REMOVED = 'Removed by Pocket: a Vault value was typed into this browser session, so images, audio and other binary content are not returned from it (a value cannot be scrubbed out of a picture). Use text snapshots instead.';
const stripBinary = v => {
  if (Array.isArray(v)) return v.map(stripBinary);
  if (!v || typeof v !== 'object') return v;
  if (v.type === 'image' || v.type === 'audio') return { type: 'text', text: REMOVED };
  if (typeof v.blob === 'string') { const { blob, ...rest } = v; return { ...rest, mimeType: 'text/plain', text: REMOVED }; }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripBinary(x)]));
};

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
  // 1.73.5: the values must be one string per ref asked for, nothing else; any other shape is refused rather than typed.
  const values = data.values;
  if (!values || typeof values !== 'object' || Array.isArray(values) || refs.some(x => typeof values[x] !== 'string') || Object.keys(values).some(x => !refs.includes(x))) {
    process.stderr.write(`pocket-mcp-proxy: the answer from ${base}/api/vault/release did not carry one value per placeholder; nothing was typed\n`);
    return { error: `Pocket Code answered the fill of ${refs.join(', ')} in a form the relay does not understand; nothing was typed. Try again, and tell the owner if it repeats.` };
  }
  return { values };
}

// 1.73.5: calls that need a release run one at a time, in order, and a client that closes its side waits for the last of them.
let chain = Promise.resolve();
async function fill(msg, refs, tool) {
  try {
    const got = await release(refs, tool);
    if (got.error) return toolError(msg.id, got.error);
    filled = true;
    for (const [ref, value] of Object.entries(got.values)) remember(ref, value);
    const typed = deep(msg.params.arguments, s => s.replace(PLACEHOLDER_ALL, (m, ref) => got.values[ref] ?? m));
    toServer({ ...msg, params: { ...msg.params, arguments: typed } });
  } catch (e) { toolError(msg.id, `The relay could not fill ${refs.join(', ')}: ${e.message}`); }
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  let msg; try { msg = JSON.parse(line); } catch { try { server.stdin.write(line + '\n'); } catch { } return; }
  if (msg?.method !== 'tools/call' || !msg.params) return toServer(msg);
  const refs = refsIn(msg.params.arguments); if (!refs.length) return toServer(msg);
  const tool = String(msg.params.name || 'tool');
  if (!FILL_TOOLS.includes(tool)) return toolError(msg.id, `Pocket types Vault values into ${FILL_TOOLS.join(', ')} only, not ${tool}: a value may be typed into a field, never handed to code or put in an address. Use a fill tool; the owner can set POCKET_VAULT_FILL_TOOLS for this relay if another tool should count.`);
  chain = chain.then(() => fill(msg, refs, tool));
}).on('close', () => chain.then(() => { try { server.stdin.end(); } catch { } }));

readline.createInterface({ input: server.stdout }).on('line', line => {
  if (!filled) return process.stdout.write(line + '\n');
  let msg; try { msg = JSON.parse(line); } catch { return process.stdout.write(scrubText(line) + '\n'); }
  toClient(scrubDeep(stripBinary(msg)));
});
// stderr is diagnostics: once a value has been released it goes through the streaming scrubber, which holds back the tail of
// each chunk until the next one (so a value split between two chunks is still caught); half a second of silence flushes it.
server.stderr.setEncoding('utf8');
let errFlush = null;
server.stderr.on('data', t => { if (!errStream) return process.stderr.write(t); process.stderr.write(errStream.push(t)); clearTimeout(errFlush); errFlush = setTimeout(() => process.stderr.write(errStream.end()), 500); errFlush.unref(); });
server.on('exit', (code, sig) => { if (errStream) process.stderr.write(errStream.end()); process.exit(code ?? (sig ? 1 : 0)); });
server.on('error', e => { process.stderr.write(`pocket-mcp-proxy: could not start ${child[0]}: ${e.message}\n`); process.exit(1); });
// A signal is passed to the server; one that does not stop it within five seconds is followed by SIGKILL (1.73.5).
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { try { server.kill(s); } catch { } setTimeout(() => { try { server.kill('SIGKILL'); } catch { } }, 5000).unref(); });
