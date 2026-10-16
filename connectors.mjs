// 1.53: Gmail, Google Calendar and Google Drive through the connectors each agent CLI already has.
// Claude Code loads the claude.ai connectors of the signed-in subscription; Codex loads the ChatGPT
// apps of its ChatGPT sign-in. Anthropic and OpenAI hold the Google authorization, so Pocket stores
// no Google token and needs no Google Cloud project. A first connection is made on claude.ai or
// chatgpt.com (neither CLI can start one); Pocket reads the status and links to the right page.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);

export const CLAUDE_MANAGE_URL = 'https://claude.ai/customize/connectors';
export const CODEX_MANAGE_URL = 'https://chatgpt.com/apps';
// Codex ids are the ChatGPT catalog's connector ids (DEFAULT_OAI_CATALOG), checked 2026-10-16.
export const GOOGLE_CONNECTORS = [
  { key: 'gmail', label: 'Gmail', claude: 'claude.ai Gmail', codex: 'connector_2128aebfecb84f64a069897515042a44' },
  { key: 'calendar', label: 'Google Calendar', claude: 'claude.ai Google Calendar', codex: 'connector_947e0d954944416db111db556030eea6' },
  { key: 'drive', label: 'Google Drive', claude: 'claude.ai Google Drive', codex: 'connector_5f3c8c41a1e54ad7a76272c89e2554fa' },
];

// `claude mcp list` prints "<name>: <url or command> - <status>". The statuses come from the CLI:
// "✔ Connected", "! Needs authentication", "- Not configured", "✘ Failed to connect", "✘ Connection error".
export function parseClaudeMcpList(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(claude\.ai [^:]+): .* - (.+)$/);
    if (!m) continue;
    const s = m[2].trim();
    out.set(m[1].trim(), /Connected$/.test(s) && !/^✘/.test(s) ? 'connected' : /Needs authentication/i.test(s) ? 'needs-auth' : /Not configured/i.test(s) ? 'not-connected' : 'failed');
  }
  return out;
}

// Claude Code skips claude.ai connectors when any settings source sets disableClaudeAiConnectors,
// or ENABLE_CLAUDEAI_MCP_SERVERS is false. Returns where it was switched off, or null.
export function claudeConnectorsOff({ home, managedDir, env = process.env }) {
  if (/^(0|false|no|off)$/i.test(String(env.ENABLE_CLAUDEAI_MCP_SERVERS || '').trim())) return 'ENABLE_CLAUDEAI_MCP_SERVERS';
  const files = [path.join(home, '.claude', 'settings.json'), path.join(managedDir, 'managed-settings.json')];
  try { for (const f of fs.readdirSync(path.join(managedDir, 'managed-settings.d')).sort()) if (f.endsWith('.json') && !f.startsWith('.')) files.push(path.join(managedDir, 'managed-settings.d', f)); } catch { }
  for (const file of files) {
    try { if (JSON.parse(fs.readFileSync(file, 'utf8'))?.disableClaudeAiConnectors === true) return file; } catch { }
  }
  return null;
}

// status: connected | needs-auth | not-connected | failed | off | unavailable
export async function claudeConnectors({ bin, env, cwd, identity, home, managedDir, run = exec }) {
  const base = { provider: 'claude', manageUrl: CLAUDE_MANAGE_URL };
  const rows = status => GOOGLE_CONNECTORS.map(c => ({ key: c.key, label: c.label, status: typeof status === 'function' ? status(c) : status }));
  const off = claudeConnectorsOff({ home, managedDir, env });
  if (off) return { ...base, available: false, reason: `Turned off on this server (disableClaudeAiConnectors in ${off.startsWith('/') ? off.replace(home, '~') : off}).`, items: rows('off') };
  if (identity?.signedIn === false) return { ...base, available: false, reason: 'Sign in to Claude Code first.', items: rows('unavailable') };
  if (identity?.signedIn && identity.method !== 'claude.ai') return { ...base, available: false, reason: 'Connectors need a Claude subscription sign-in. This server uses API or cloud-provider credentials.', items: rows('unavailable') };
  let found;
  try { found = parseClaudeMcpList((await run(bin, ['mcp', 'list'], { env, cwd, timeout: 90_000, maxBuffer: 1 << 20 })).stdout); }
  catch (e) { return { ...base, available: false, reason: e.killed ? 'Claude Code took too long to report its connectors. Try again.' : 'Claude Code could not list its connectors.', items: rows('unavailable') }; }
  return { ...base, available: true, items: rows(c => found.get(c.claude) || 'not-connected') };
}

// apps: app/read entries for the Google ids; accessible: ids the ChatGPT account has connected.
export function codexConnectorRows({ apps = [], accessible = [], disabled = [] }) {
  const byId = new Map(apps.map(a => [a.id, a])), on = new Set(accessible), off = new Set(disabled);
  return GOOGLE_CONNECTORS.map(c => {
    const app = byId.get(c.codex);
    let url = null;
    try { const u = new URL(app?.installUrl); if (u.protocol === 'https:' && u.hostname === 'chatgpt.com') url = u.href; } catch { }
    const tools = Array.isArray(app?.toolSummaries) ? app.toolSummaries : [];
    return { key: c.key, label: c.label, connectUrl: url || CODEX_MANAGE_URL, tools: tools.length, writeTools: tools.filter(t => t && t.isReadOnly === false).length,
      status: !app ? 'unavailable' : off.has(c.codex) ? 'off' : on.has(c.codex) ? 'connected' : 'not-connected' };
  });
}

// Pages through app/list while the entries are connected ones (the app-server lists those first)
// rather than reading the whole catalog: thousands of apps, about 40 MB.
export async function codexConnectors({ rpc, account, refresh = false }) {
  const base = { provider: 'codex', manageUrl: CODEX_MANAGE_URL };
  const rows = status => GOOGLE_CONNECTORS.map(c => ({ key: c.key, label: c.label, status, connectUrl: CODEX_MANAGE_URL }));
  if (account && account.signedIn === false) return { ...base, available: false, reason: 'Sign in to Codex first.', items: rows('unavailable') };
  if (account?.signedIn && account.method && !/chatgpt/i.test(account.method)) return { ...base, available: false, reason: 'Apps need a ChatGPT sign-in. This Codex uses an API key.', items: rows('unavailable') };
  try {
    const accessible = [], disabled = [];
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const r = await rpc('app/list', { limit: 100, ...(cursor ? { cursor } : {}), ...(refresh && page === 0 ? { forceRefetch: true } : {}) }, refresh ? 60_000 : 30_000);
      const data = Array.isArray(r?.data) ? r.data : [];
      let more = data.length > 0;
      for (const a of data) {
        if (!a?.isAccessible) { more = false; continue; }
        accessible.push(a.id);
        if (a.isEnabled === false) disabled.push(a.id);
      }
      cursor = r?.nextCursor || null;
      if (!more || !cursor) break;
    }
    const read = await rpc('app/read', { appIds: GOOGLE_CONNECTORS.map(c => c.codex), includeTools: true }, 30_000);
    return { ...base, available: true, items: codexConnectorRows({ apps: read?.apps || [], accessible, disabled }) };
  } catch { return { ...base, available: false, reason: 'Codex could not list its apps. Check that it is signed in with ChatGPT, then try again.', items: rows('unavailable') }; }
}
