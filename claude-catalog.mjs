// 1.91: finding new Claude models without a Pocket update.
//
// Codex lists its models itself (model/list), so a new Codex model shows up on its own. Claude Code
// has no such call, so Pocket reads Anthropic's model list (GET /v1/models) once a day with the
// sign-in Claude Code already has on this computer: the OAuth token in ~/.claude/.credentials.json
// (or $CLAUDE_CONFIG_DIR), else ANTHROPIC_API_KEY. A model newer than every model of its family in
// the catalog (Opus 6 when the newest Opus is 5.5) joins the picker, and the older one is then
// replaced (models.mjs successorOf). Nothing is removed from the list Anthropic returns; a model it
// stops listing stays until a newer one replaces it. Pocket never sends the token anywhere else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.anthropic.com/v1/models?limit=100';
const ID_RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$/;
const FAMILY_LABEL = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };

// The credential Claude Code is signed in with, or null. A token past its expiry is skipped (the CLI
// refreshes it on its next run, and the next daily check picks the fresh one up).
export function readClaudeCredential(env = process.env, home = os.homedir(), now = Date.now()) {
  const dir = (env.CLAUDE_CONFIG_DIR || '').trim() || path.join(home, '.claude');
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'))?.claudeAiOauth;
    if (typeof o?.accessToken === 'string' && o.accessToken && !(Number(o.expiresAt) && Number(o.expiresAt) < now)) return { token: o.accessToken };
  } catch { }
  const key = (env.ANTHROPIC_API_KEY || '').trim();
  return key ? { apiKey: key } : null;
}

export async function fetchAnthropicModels(cred, { url = API, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const headers = { 'anthropic-version': '2023-06-01' };
  if (cred?.token) { headers.authorization = `Bearer ${cred.token}`; headers['anthropic-beta'] = 'oauth-2025-04-20'; }
  else if (cred?.apiKey) headers['x-api-key'] = cred.apiKey;
  else throw new Error('no Claude sign-in on this computer');
  const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Anthropic model list answered ${r.status}`);
  const j = await r.json();
  return (Array.isArray(j?.data) ? j.data : []).filter(m => typeof m?.id === 'string');
}

const ver = id => { const m = String(id).replace(/\[1m\]$/, '').match(ID_RE); return m ? { family: m[1], v: [Number(m[2]), m[3] == null ? 0 : Number(m[3])], dated: Boolean(m[4]) } : null; };
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];

// The entries to add: per family, Anthropic's newest model when it is newer than the catalog's newest.
// Its id copies the [1m] spelling of the family's newest catalog entry (Fable and Opus run with the 1M
// window), and a dated id is used only when the list has no undated one for that version.
export function newModelsFrom(apiModels, catalog, today = new Date().toISOString().slice(0, 10)) {
  const out = [];
  for (const family of Object.keys(FAMILY_LABEL)) {
    const mine = catalog.filter(m => ver(m.id)?.family === family).sort((a, b) => cmp(ver(b.id).v, ver(a.id).v));
    const theirs = apiModels.map(m => ({ m, p: ver(m.id) })).filter(x => x.p?.family === family)
      .sort((a, b) => cmp(b.p.v, a.p.v) || Number(a.p.dated) - Number(b.p.dated));
    const top = theirs[0];
    if (!top || (mine[0] && cmp(top.p.v, ver(mine[0].id).v) <= 0)) continue;
    const [major, minor] = top.p.v, number = minor ? `${major}.${minor}` : `${major}`;
    const label = (String(top.m.display_name || '').replace(/^Claude\s+/i, '').trim() || `${FAMILY_LABEL[family]} ${number}`).slice(0, 40);
    const wide = mine[0]?.id.endsWith('[1m]') ? '[1m]' : '';
    out.push({ id: top.m.id + wide, label, sub: `Newest ${FAMILY_LABEL[family]} · added by Pocket ${today}`, discovered: today });
  }
  return out;
}

// The saved file: { checkedAt, error, added: [entry…] }.
export function loadDiscovered(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { checkedAt: j.checkedAt || null, error: j.error || null, added: Array.isArray(j.added) ? j.added : [] }; }
  catch { return { checkedAt: null, error: null, added: [] }; }
}
