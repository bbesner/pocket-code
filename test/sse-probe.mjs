// Tests only (1.124.3, test/review-fixes.test.mjs): loaded into server.mjs with NODE_OPTIONS=--import, so a test can see the
// stream keepalives the daemon holds and hold watch mode in its awaits. Every 50 ms it writes the number of live 25 s
// intervals (the event streams' keepalives) to SSE_PROBE_FILE. While <SSE_PROBE_FILE>.slow exists, each readdir waits
// 400 ms first (findSessionFile, before the stream knows its transcript); while <SSE_PROBE_FILE>.statfail exists, a stat
// of a transcript fails as if it had just been moved away. Any other process (a fake CLI inheriting NODE_OPTIONS) is left alone.
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const probe = process.env.SSE_PROBE_FILE;
if (probe && /(^|\/)server\.mjs$/.test(process.argv[1] || '')) {
  const live = new Set(), every = globalThis.setInterval, clear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms, ...a) => { const h = every(fn, ms, ...a); if (ms === 25000) live.add(h); return h; };
  globalThis.clearInterval = h => { live.delete(h); return clear(h); };
  const readdir = fsp.readdir, stat = fsp.stat;
  fsp.readdir = async (...a) => { if (fs.existsSync(probe + '.slow')) await new Promise(r => setTimeout(r, 400)); return readdir.apply(fsp, a); };
  fsp.stat = async (p, ...a) => {
    if (String(p).endsWith('.jsonl') && fs.existsSync(probe + '.statfail')) throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${p}'`), { code: 'ENOENT' });
    return stat.call(fsp, p, ...a);
  };
  every(() => { try { fs.writeFileSync(probe, String(live.size)); } catch { } }, 50).unref();
}
