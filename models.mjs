// 1.52: which Claude models the picker offers.
//
// The catalog is every Claude model Pocket knows. Three things narrow it to the models the
// picker offers:
//   1. the owner's choice in Settings → Agents & instance (saved in pocket-settings.json), or,
//      until one is saved, POCKET_CLAUDE_MODELS from the environment, or else every model;
//   2. this computer's Claude Code managed policy: `availableModels` and `deniedModels` in
//      managed-settings.json and managed-settings.d/*.json. A model the CLI would block is
//      never offered, whatever 1 says, because the CLI silently runs its default instead.
// The matching below follows the Claude Code documentation (settings reference, "Restrict model
// selection" and "Block specific models or versions" in the model configuration guide).
import fs from 'node:fs';
import path from 'node:path';

// Each id verified with `claude -p --model <id>`: Fable/Opus/Sonnet 5/Haiku 4.5 on CLI 2.1.281
// (2026-09-25); Sonnet 5.5 and Haiku 5.5 on CLI 2.1.293 (2026-10-15, modelUsage named the same id).
// Fable and Opus use their [1m] ids so picking one on a long resumed session can't overflow the
// 200k window; Sonnet 5 and later and Haiku 5.5 have the 1M window natively. `cost` orders the
// models from cheapest for helper calls (titles, summaries) that have to pick one.
export const CLAUDE_MODELS = [
  { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1', sub: 'Top tier · 1M context', alias: 'fable', cost: 6 },
  { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5', sub: 'Strong + cheaper than Fable · 1M', alias: 'opus', cost: 5 },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', sub: 'Fast, strong all-rounder · 1M', alias: 'sonnet', cost: 4 },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', sub: 'Fast, near-Opus on coding', alias: 'sonnet', cost: 3 },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', sub: 'Fastest current model · 1M', alias: 'haiku', cost: 2 },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', sub: 'Fastest, light tasks', alias: 'haiku', cost: 1 },
];
export const CATALOG_IDS = new Set(CLAUDE_MODELS.map(m => m.id));
const FAMILIES = new Set(['opus', 'sonnet', 'haiku', 'fable']);
export const POLICY_REASON = "Blocked by this computer's Claude Code policy";

// The system directory Claude Code reads managed-settings.json and managed-settings.d/ from.
// POCKET_CLAUDE_MANAGED_DIR overrides it (tests, or a CLI installed with a nonstandard path).
export function managedDir(env = process.env, platform = process.platform) {
  const o = (env.POCKET_CLAUDE_MANAGED_DIR || '').trim();
  if (o) return o;
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
}

// Reads the file-based managed policy the way Claude Code merges it: managed-settings.json first,
// then every non-hidden *.json in managed-settings.d/ in alphabetical order. Lists combine with
// duplicates removed; a single value from a later file replaces an earlier one.
// Returns { dir, files, availableModels: string[]|null, deniedModels: string[]|null,
// availableModelsMatch, model, enforceAvailableModels, error }.
export function readManagedPolicy(dir) {
  const out = { dir, files: [], availableModels: null, deniedModels: null, availableModelsMatch: 'prefix', model: null, enforceAvailableModels: false, maxEffortLevel: null, error: null };
  const docs = [];
  const base = path.join(dir, 'managed-settings.json');
  const read = file => {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') out.error = `${path.basename(file)} could not be read`; return; }
    try {
      const j = JSON.parse(raw);
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object');
      docs.push(j); out.files.push(file);
    } catch { out.error = `${path.basename(file)} is not valid JSON`; } // the CLI refuses to start on this
  };
  read(base);
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'managed-settings.d')).filter(n => n.endsWith('.json') && !n.startsWith('.')).sort(); } catch { }
  for (const n of names) read(path.join(dir, 'managed-settings.d', n));
  for (const d of docs) {
    if ('availableModels' in d) {
      // Present but not a list: the CLI enforces an empty allowlist until it is fixed.
      const list = Array.isArray(d.availableModels) ? d.availableModels.filter(x => typeof x === 'string') : [];
      out.availableModels = [...new Set([...(out.availableModels || []), ...list])];
    }
    if (Array.isArray(d.deniedModels)) out.deniedModels = [...new Set([...(out.deniedModels || []), ...d.deniedModels.filter(x => typeof x === 'string')])];
    // Anything but "prefix" reads as "exact" (an invalid value is treated as exact until fixed).
    if ('availableModelsMatch' in d) out.availableModelsMatch = d.availableModelsMatch === 'prefix' ? 'prefix' : 'exact';
    if (typeof d.model === 'string') out.model = d.model;
    if (typeof d.enforceAvailableModels === 'boolean') out.enforceAvailableModels = d.enforceAvailableModels;
    // 1.62: the highest reasoning effort this computer's policy allows; Pocket never asks for more.
    if (['low', 'medium', 'high', 'xhigh', 'max'].includes(d.maxEffortLevel)) out.maxEffortLevel = d.maxEffortLevel;
  }
  return out;
}

// A model name reduced to what the policy compares: lower case, no [1m] window suffix (the same model
// in another spelling), no provider prefix or version tag (us.anthropic.…-v1:0, …@20250929).
function norm(s) {
  return String(s).trim().toLowerCase().replace(/\[1m\]$/, '')
    .replace(/^(?:[a-z]{2,}\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '').replace(/@\d{8}$/, '');
}
// claude-<family>-<major>[-<minor>][-<yyyymmdd>] → parts; anything else (an alias, an older
// claude-3-5-sonnet style id, a typo) → null.
function parse(s) {
  const m = norm(s).match(/^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$/);
  return m ? { family: m[1], major: Number(m[2]), minor: m[3] == null ? null : Number(m[3]), dated: Boolean(m[4]) } : null;
}
const ignored = e => ['default', 'best', 'opusplan'].includes(norm(e));

// Whether an id entry names the model. `prefix`: an entry without a minor version (claude-opus-5)
// also covers the versions that extend it (Opus 5.5); `exact` covers only the version it names
// (claude-opus-5 = Opus 5.0). An entry with a minor version or a date names that version only.
function entryCovers(entry, model, mode) {
  if (!entry || !model || entry.family !== model.family || entry.major !== model.major) return false;
  const mm = model.minor ?? 0;
  if (entry.minor == null) return mode === 'prefix' ? true : mm === 0;
  return entry.minor === mm;
}

// Whether the managed policy lets the CLI run `id` (a catalog id, a full id or a family alias).
// policy: the result of readManagedPolicy, or null for no policy.
export function policyAllows(id, policy) {
  if (!policy) return true;
  const n = norm(id);
  const isAlias = FAMILIES.has(n);
  // An alias resolves to its newest permitted version, so it is allowed when any version of the family
  // is (the CLI substitutes within the family; it never leaves it for the alias).
  if (isAlias) return CLAUDE_MODELS.some(m => m.alias === n && policyAllows(m.id, policy));
  const model = parse(id);
  if (policy.deniedModels?.length) {
    for (const e of policy.deniedModels) {
      if (ignored(e)) continue;
      const ne = norm(e);
      if (FAMILIES.has(ne)) { if (model ? model.family === ne : n.includes(ne)) return false; continue; }
      const pe = parse(e);
      if (pe ? entryCovers(pe, model, 'prefix') : ne === n) return false;
    }
  }
  if (!Array.isArray(policy.availableModels)) return true;
  const mode = policy.availableModelsMatch === 'exact' ? 'exact' : 'prefix';
  const entries = policy.availableModels.filter(e => !ignored(e));
  // An entry naming a specific version disables its family's wildcard ("sonnet" + "claude-sonnet-4-5"
  // allows only Sonnet 4.5).
  const specific = new Set(entries.map(parse).filter(Boolean).map(p => p.family));
  for (const e of entries) {
    const ne = norm(e);
    if (FAMILIES.has(ne)) { if (model && model.family === ne && !specific.has(ne)) return true; continue; }
    const pe = parse(e);
    if (pe ? entryCovers(pe, model, mode) : ne === n) return true;
  }
  return false;
}

// The owner's selection as catalog ids. Accepts catalog ids, ids without [1m] and family aliases
// (all of the family). Returns { ids, unknown }.
export function parseSelection(list) {
  const ids = [], unknown = [];
  for (const raw of Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)) {
    const s = String(raw || '').trim(); if (!s) continue;
    const n = s.toLowerCase();
    const hits = CATALOG_IDS.has(s) ? [s] : FAMILIES.has(n) ? CLAUDE_MODELS.filter(m => m.alias === n).map(m => m.id)
      : CLAUDE_MODELS.filter(m => m.id.replace(/\[1m\]$/, '') === n.replace(/\[1m\]$/, '')).map(m => m.id);
    if (hits.length) for (const h of hits) { if (!ids.includes(h)) ids.push(h); } else unknown.push(s);
  }
  return { ids, unknown };
}

// 1.91: only the newest version of each family is shown. A model is replaced when the catalog has a newer
// version of its family (Sonnet 5.5 replaces Sonnet 5) that this computer's policy allows; a replaced model
// is never offered, and a saved pick, Default or POCKET_CLAUDE_MODEL that names it runs its successor.
// When the policy blocks the newer version, the older one stays.
const versionOf = id => { const p = parse(id); return p ? { family: p.family, v: [p.major, p.minor ?? 0] } : null; };
const newer = (a, b) => a[0] - b[0] || a[1] - b[1];
export function successorOf(id, policy) {
  const me = versionOf(id); if (!me) return null;
  let best = null, bv = me.v;
  for (const m of CLAUDE_MODELS) {
    const o = versionOf(m.id);
    if (o?.family === me.family && newer(o.v, bv) > 0 && policyAllows(m.id, policy)) { best = m.id; bv = o.v; }
  }
  return best;
}
// { replaced id: the id that runs instead } for every catalog model with a newer allowed version, plus
// the same ids without [1m] (a saved pick or a policy may spell them either way).
export function replacedModels(policy) {
  const out = {};
  for (const m of CLAUDE_MODELS) { const s = successorOf(m.id, policy); if (s) { out[m.id] = s; out[m.id.replace(/\[1m\]$/, '')] = s; } }
  return out;
}
export const currentModels = policy => CLAUDE_MODELS.filter(m => !successorOf(m.id, policy));

// 1.91: models Pocket found in Anthropic's model list that are newer than any of their family in the
// catalog (claude-catalog.mjs). They join the catalog for this run; the server saves them in its data dir.
export function addDiscovered(entries) {
  const added = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.id !== 'string' || !parse(e.id) || CATALOG_IDS.has(e.id) || typeof e.label !== 'string') continue;
    const fam = parse(e.id).family;
    const peers = CLAUDE_MODELS.filter(m => m.alias === fam);
    const entry = { id: e.id, label: e.label.slice(0, 40), sub: String(e.sub || '').slice(0, 80), alias: fam,
      cost: Number.isFinite(e.cost) ? e.cost : Math.max(0, ...peers.map(m => m.cost)), discovered: e.discovered || null };
    // Newest first within its family, so the catalog keeps reading top tier to cheapest.
    const at = CLAUDE_MODELS.findIndex(m => m.alias === fam);
    CLAUDE_MODELS.splice(at < 0 ? CLAUDE_MODELS.length : at, 0, entry);
    CATALOG_IDS.add(e.id); added.push(entry);
  }
  return added;
}

// The whole picture for one request: which ids are selected and where that came from, which the
// policy blocks, and the offered list in catalog order. Replaced models are left out (1.91); a
// selection that names an older version of a family selects the newest one in its place.
export function resolveOffer({ saved, envList, policy }) {
  const source = Array.isArray(saved) ? 'settings' : envList?.length ? 'env' : 'all';
  const selected = new Set(source === 'settings' ? saved.filter(id => CATALOG_IDS.has(id)) : source === 'env' ? envList : [...CATALOG_IDS]);
  const families = new Set([...selected].map(id => versionOf(id)?.family).filter(Boolean));
  const models = currentModels(policy).map(m => {
    const blocked = !policyAllows(m.id, policy);
    const on = selected.has(m.id) || families.has(versionOf(m.id)?.family);
    return { id: m.id, label: m.label, sub: m.sub, selected: on, blocked, reason: blocked ? POLICY_REASON : null, offered: on && !blocked };
  });
  return { source, models, offered: models.filter(m => m.offered).map(m => m.id) };
}

// The model a helper call (titles, summaries) should name: the configured one when the policy
// allows it, else the cheapest offered model it allows, else the cheapest current model it
// allows, else the configured one (nothing is allowed, and the CLI picks its default).
export function helperModel(configured, { policy, offered }) {
  if (policyAllows(configured, policy)) return configured;
  const byCost = currentModels(policy).sort((a, b) => a.cost - b.cost).filter(m => policyAllows(m.id, policy));
  return (byCost.find(m => offered.includes(m.id)) || byCost[0])?.id || configured;
}
