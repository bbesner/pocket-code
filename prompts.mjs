// Saved prompts and recent starts for the New session screen (1.23). One JSON file in the data directory, so
// every device sees the same list. A saved prompt is your own wording plus how to start it: workspace, agent and,
// optionally, model, effort, permissions and Codex mode. Choosing one fills the form; it never starts work by itself.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export const LIMITS = { prompts: 50, recent: 5, name: 60, text: 8000, field: 120 };
const PROVIDERS = ['claude', 'codex'];
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// The fields a prompt may carry. Unknown keys are dropped; empty optional fields are left out.
export function cleanPrompt(input, { partial = false } = {}) {
  const out = {};
  if (!partial || 'name' in input) { out.name = str(input.name, LIMITS.name).replace(/\s+/g, ' '); if (!out.name) throw fail('Give the prompt a name.'); }
  if (!partial || 'text' in input) { out.text = str(input.text, LIMITS.text); if (!out.text) throw fail('The prompt has no text.'); }
  if (!partial || 'provider' in input) { out.provider = PROVIDERS.includes(input.provider) ? input.provider : 'claude'; }
  if (!partial || 'cwd' in input) {
    const cwd = str(input.cwd, 1024);
    if (cwd && !cwd.startsWith('/')) throw fail('The workspace must be a full path.');
    out.cwd = cwd || null;
  }
  for (const k of ['model', 'effort', 'approvalMode', 'executionMode']) {
    if (!partial || k in input) { const v = str(input[k], LIMITS.field); out[k] = v && v !== 'default' ? v : null; }
  }
  if (out.approvalMode && !['review', 'full'].includes(out.approvalMode)) out.approvalMode = null;
  if (out.executionMode && !['work', 'plan'].includes(out.executionMode)) out.executionMode = null;
  return out;
}

export class PromptStore {
  constructor(file, { write } = {}) {
    this.file = file;
    this.write = write || ((f, data) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    let d = {};
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
    this.prompts = Array.isArray(d.prompts) ? d.prompts.filter(p => p && p.id && p.text) : [];
    this.recent = Array.isArray(d.recent) ? d.recent.filter(r => r && r.text).slice(0, LIMITS.recent) : [];
  }
  save() { this.write(this.file, { prompts: this.prompts, recent: this.recent }); }
  list() { return { prompts: this.prompts, recent: this.recent }; }
  create(input) {
    if (this.prompts.length >= LIMITS.prompts) throw fail(`You can keep up to ${LIMITS.prompts} saved prompts. Delete one first.`, 409);
    const now = Date.now(), p = { id: randomUUID(), ...cleanPrompt(input), createdAt: now, updatedAt: now };
    for (const k of Object.keys(p)) if (p[k] == null) delete p[k];
    this.prompts.push(p); this.save(); return p;
  }
  update(id, input) {
    const p = this.prompts.find(x => x.id === id); if (!p) throw fail('That prompt no longer exists.', 404);
    Object.assign(p, cleanPrompt(input, { partial: true }), { updatedAt: Date.now() });
    for (const k of Object.keys(p)) if (p[k] == null) delete p[k];
    this.save(); return p;
  }
  remove(id) {
    const i = this.prompts.findIndex(x => x.id === id); if (i < 0) throw fail('That prompt no longer exists.', 404);
    this.prompts.splice(i, 1); this.save();
  }
  // ids in the new order; prompts not named keep their relative order after the named ones.
  order(ids) {
    if (!Array.isArray(ids) || ids.length > LIMITS.prompts) throw fail('Invalid order.');
    const rank = new Map(ids.map((id, i) => [id, i]));
    this.prompts = [...this.prompts].sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e6) - (rank.has(b.id) ? rank.get(b.id) : 1e6));
    this.save(); return this.prompts.map(p => p.id);
  }
  // The newest starts first, one entry per text (a repeat moves to the top with its latest workspace and agent).
  recordRecent({ text, cwd, provider }) {
    const t = str(text, LIMITS.text); if (!t) return;
    this.recent = [{ text: t, cwd: str(cwd, 1024) || null, provider: PROVIDERS.includes(provider) ? provider : 'claude', at: Date.now() },
      ...this.recent.filter(r => r.text !== t)].slice(0, LIMITS.recent);
    this.save();
  }
}
