// Session titles (1.19). A session whose only name is its opening request reads as a sentence in the
// list ("there was a previous session running doing chunk 7 code review…"). Pocket asks a small model
// for a short title once, keeps it in session-meta.json beside names and pins, and never writes it to
// a transcript. A rename always wins; clearing a rename falls back to this title.
//
// Scheduled runs that announce themselves ("[cron:<id> Job name] …") are labelled automated and use
// the job name as their title, so they can be grouped away from the sessions you started.
import { spawn } from 'node:child_process';

const CRON_RE = /^\s*\[cron:[^\s\]]+\s+([^\]]+)\]\s*/i;
// Other unattended agent runs that open with a fixed preamble instead of a request.
const PREAMBLE_RE = /^\s*OpenClaw runtime context\b/i;

// title: the displayed title before any generated one. Returns the automation label, if any.
export function automation(title) {
  const t = String(title || '');
  const cron = t.match(CRON_RE);
  if (cron) return { automated: true, title: cron[1].replace(/\s+/g, ' ').trim().slice(0, 120) };
  if (PREAMBLE_RE.test(t)) return { automated: true, title: null };
  return { automated: false, title: null };
}

// What a model reply must look like to be used as a title.
export function cleanTitle(raw) {
  let t = String(raw || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  t = t.replace(/^title\s*:\s*/i, '').replace(/^["'`*_]+|["'`*_]+$/g, '').replace(/[.!?:;,]+$/, '').replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > 80) return null;
  if (/^(not logged in|error|i (can't|cannot)|sorry)\b/i.test(t)) return null;
  return t;
}

const SYSTEM = 'You name coding-assistant sessions. Given the opening request, reply with a 3 to 7 word title in sentence case. Keep product and project names as written. Reply with the title only: no quotes, no trailing punctuation, no preamble.';

// One short model call: no tools, no MCP servers, no settings files, no saved session.
export function generateTitle(bin, text, { timeoutMs = 30_000, model = 'haiku', env = process.env } = {}) {
  return new Promise(resolve => {
    let out = '', done = false;
    const finish = v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let child;
    try {
      child = spawn(bin, ['-p', '--model', model, '--no-session-persistence', '--tools', '', '--strict-mcp-config',
        '--setting-sources', '', '--system-prompt', SYSTEM, '--settings', '{"alwaysThinkingEnabled":false}',
        '--output-format', 'json'], { stdio: ['pipe', 'pipe', 'ignore'], env, cwd: env.HOME || process.cwd() });
    } catch { return finish(null); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } finish(null); }, timeoutMs);
    child.on('error', () => finish(null));
    child.stdout.on('data', c => { out += c; if (out.length > 64_000) { try { child.kill(); } catch { } } });
    child.on('close', () => {
      try { const j = JSON.parse(out); finish(j.is_error ? null : cleanTitle(j.result)); } catch { finish(null); }
    });
    child.stdin.on('error', () => { });
    child.stdin.end('Request: ' + String(text).slice(0, 1500));
  });
}

// A small serial queue. request() is cheap and idempotent; at most one model call runs at a time.
export function createTitler({ bin, enabled = true, getMeta, setMeta, log = () => { }, generate = generateTitle,
  retryMs = 24 * 3600_000, maxQueue = 50 }) {
  const queue = new Map(); // id -> text, newest request last
  let running = false;
  const eligible = id => {
    const m = getMeta(id) || {};
    return !m.name && !m.autoTitle && !(m.autoTitleFailedAt && Date.now() - m.autoTitleFailedAt < retryMs);
  };
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.size) {
        const [id, text] = [...queue.entries()].at(-1); // newest first: what you just started matters most
        queue.delete(id);
        if (!eligible(id)) continue;
        const title = await generate(bin, text);
        if (title) { setMeta(id, { autoTitle: title, autoTitleFailedAt: null }); log(`session titled session=${id} title=${JSON.stringify(title)}`); }
        else setMeta(id, { autoTitleFailedAt: Date.now() });
      }
    } finally { running = false; }
  }
  return {
    enabled,
    request(id, text) {
      if (!enabled || !text || !eligible(id) || queue.has(id)) return;
      if (queue.size >= maxQueue) return; // the next list refresh asks again
      queue.set(id, text);
      drain();
    },
    get pending() { return queue.size + (running ? 1 : 0); },
  };
}
