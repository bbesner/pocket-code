// Search across conversations (1.22). Pure helpers; the HTTP route lives in server.mjs.
//
// With MemStem (https://github.com/Memstem/memstem) running beside Pocket, search uses its hybrid keyword +
// semantic index of every Claude Code and Codex session, so it finds old conversations and related wording,
// not only exact phrases. Without it, Pocket searches the text of recent conversations itself.
import path from 'node:path';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// A MemStem session record's provenance.ref is the transcript it came from. Only transcripts in the stores Pocket
// itself reads count: <projects>/<dir>/<uuid>.jsonl (Claude) and <codex home>/sessions/.../rollout-…-<uuid>.jsonl.
export function sessionIdFromRef(ref, { projectsRoot, codexSessionsRoot }) {
  const p = path.resolve(String(ref || ''));
  if (projectsRoot) {
    const rel = path.relative(path.resolve(projectsRoot), p);
    const m = !rel.startsWith('..') && rel.split(path.sep).length === 2 && new RegExp(`^(${UUID})\\.jsonl$`, 'i').exec(path.basename(rel));
    if (m) return m[1].toLowerCase();
  }
  if (codexSessionsRoot) {
    const rel = path.relative(path.resolve(codexSessionsRoot), p);
    const m = !rel.startsWith('..') && new RegExp(`rollout-[^/]*-(${UUID})\\.jsonl$`, 'i').exec(rel);
    if (m) return 'cx:' + m[1].toLowerCase();
  }
  return null;
}

export const queryTerms = q => [...new Set(String(q || '').toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter(t => t.length >= 2))].slice(0, 12);

// The passage of a condensed conversation (MemStem's session file: "**User:** …" / "**Assistant:** …" blocks)
// that matches the most query words, as a ~240-character snippet around the first hit. null when no word occurs,
// which means the session matched by meaning rather than wording.
export function bestSnippet(text, q, width = 240) {
  const terms = queryTerms(q);
  if (!terms.length) return null;
  const blocks = String(text || '').split(/\n(?=\*\*(?:User|Assistant):\*\*)/);
  let best = null;
  for (const block of blocks) {
    const role = /^\*\*User:\*\*/.test(block) ? 'user' : /^\*\*Assistant:\*\*/.test(block) ? 'assistant' : null;
    if (!role) continue;
    const body = block.replace(/^\*\*(?:User|Assistant):\*\*\s*/, '').replace(/\s+/g, ' ').trim();
    const lc = body.toLowerCase();
    const hits = terms.filter(t => lc.includes(t));
    if (!hits.length) continue;
    const score = hits.length * 10 + (lc.includes(String(q).toLowerCase().trim()) ? 25 : 0);
    if (best && score <= best.score) continue;
    const at = Math.min(...hits.map(t => lc.indexOf(t)));
    const s = Math.max(0, at - Math.round(width / 3)), e = Math.min(body.length, s + width);
    best = { score, role, text: (s ? '…' : '') + body.slice(s, e).trim() + (e < body.length ? '…' : '') };
  }
  return best && { role: best.role, text: best.text };
}

// MemStem's own result snippet ("**User:** text …"), cleaned for display when no words matched.
export function cleanMemstemSnippet(s) {
  const t = String(s || '').replace(/\*\*(User|Assistant):\*\*\s*/g, '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 240) + (t.length > 240 ? '…' : '') : '';
}
