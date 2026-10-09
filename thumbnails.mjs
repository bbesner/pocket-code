// Document thumbnails (1.32): a small picture of an HTML report, a PDF's first page or an image, for the
// library's grid. Made once with tools already on the box (headless Chrome for HTML, pdftoppm for PDF,
// ImageMagick's convert or Chrome for images), cached in <documents dir>/.thumbs, keyed by the file's size
// and modification time so an edited file gets a new picture. Without the tool for a kind there is no
// thumbnail and the card shows the kind instead; nothing else changes. Chrome keeps its own sandbox (no
// --no-sandbox), gets a throwaway profile, and a time budget; the documents folder is never written by it.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const THUMB = { width: 480, height: 300 };
const CHROME_PATHS = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const onPath = name => { for (const dir of String(process.env.PATH || '').split(path.delimiter)) { const p = path.join(dir, name); try { if (fs.statSync(p).isFile()) return p; } catch { } } return null; };
const usable = p => { try { return Boolean(p) && fs.statSync(p).isFile() ? p : null; } catch { return null; } };
// Env overrides first (POCKET_CHROME, POCKET_PDFTOPPM, POCKET_CONVERT; an empty value turns a tool off), then the usual places.
export function findTools(env = process.env) {
  const pick = (key, candidates) => key in env ? usable(env[key]) : candidates.map(usable).find(Boolean) || null;
  return {
    chrome: pick('POCKET_CHROME', CHROME_PATHS.concat(onPath('google-chrome') || [], onPath('chromium') || [])),
    pdftoppm: pick('POCKET_PDFTOPPM', [onPath('pdftoppm')]),
    convert: pick('POCKET_CONVERT', [onPath('convert'), onPath('magick')]),
  };
}
const run = (bin, args, { timeout, cwd }) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, cwd, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr: String(stderr).slice(-2000) })) : resolve());
});

export class Thumbnailer {
  constructor(docs, { tools = findTools(), concurrency = 2, timeoutMs = 20000, retryAfterMs = 10 * 60 * 1000, log = () => { } } = {}) {
    this.docs = docs; this.dir = path.join(docs.dir, '.thumbs'); this.tools = tools;
    this.concurrency = concurrency; this.timeoutMs = timeoutMs; this.retryAfterMs = retryAfterMs; this.log = log;
    this.pending = new Map(); this.queue = []; this.running = 0; this.failed = new Map();
  }
  // Which kinds this install can picture, for the client to know before it asks.
  capabilities() { return { html: Boolean(this.tools.chrome), pdf: Boolean(this.tools.pdftoppm), image: Boolean(this.tools.convert || this.tools.chrome) }; }
  can(r) { return Boolean(this.capabilities()[r.kind]); }
  async get(r) {
    if (!this.can(r) || r.trashedAt) return null;
    const file = this.docs.filePath(r);
    let st; try { st = await fsp.stat(file); } catch { return null; }
    const key = `${r.id}-${st.size}-${Math.floor(st.mtimeMs)}`;
    const cached = this.cached(key); if (cached) return cached;
    const failedAt = this.failed.get(key); if (failedAt && Date.now() - failedAt < this.retryAfterMs) return null;
    if (!this.pending.has(key)) {
      const job = new Promise(resolve => this.queue.push({ key, r, file, resolve }));
      this.pending.set(key, job); this.pump();
    }
    return this.pending.get(key);
  }
  cached(key) {
    for (const ext of ['jpg', 'png']) { const p = path.join(this.dir, `${key}.${ext}`); if (fs.existsSync(p)) return { path: p, type: ext === 'png' ? 'image/png' : 'image/jpeg', key }; }
    return null;
  }
  pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift(); this.running++;
      this.make(job).then(result => job.resolve(result), () => job.resolve(null)).finally(() => { this.running--; this.pending.delete(job.key); this.pump(); });
    }
  }
  async make({ key, r, file }) {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pocket-thumb-'));
    try {
      let out = null;
      if (r.kind === 'html') out = await this.withChrome(work, 'file://' + file);
      else if (r.kind === 'pdf') out = await this.withPdftoppm(work, file);
      else if (r.kind === 'image') out = this.tools.convert ? await this.withConvert(work, file) : await this.withChrome(work, await this.imagePage(work, file));
      if (!out) throw new Error('no renderer');
      const ext = out.endsWith('.png') ? 'png' : 'jpg', final = path.join(this.dir, `${key}.${ext}`);
      for (const old of await fsp.readdir(this.dir).catch(() => [])) if (old.startsWith(r.id + '-')) await fsp.rm(path.join(this.dir, old), { force: true }); // an edited file's old picture
      await fsp.copyFile(out, final); await fsp.chmod(final, 0o600);
      this.failed.delete(key);
      return { path: final, type: ext === 'png' ? 'image/png' : 'image/jpeg', key };
    } catch (e) {
      this.failed.set(key, Date.now()); this.log(`thumbnail failed for ${r.id} ${r.file}: ${e.message}${e.stderr ? ' ' + e.stderr.split('\n').slice(-1)[0] : ''}`);
      return null;
    } finally { await fsp.rm(work, { recursive: true, force: true }); }
  }
  async withChrome(work, url) {
    const out = path.join(work, 'shot.png'), profile = path.join(work, 'profile');
    await run(this.tools.chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--mute-audio', '--user-data-dir=' + profile,
      `--window-size=${THUMB.width * 2},${THUMB.height * 2}`, '--force-device-scale-factor=0.5', '--virtual-time-budget=4000', '--screenshot=' + out, url], { timeout: this.timeoutMs, cwd: work });
    return fs.existsSync(out) ? out : null;
  }
  async withPdftoppm(work, file) {
    const prefix = path.join(work, 'page');
    await run(this.tools.pdftoppm, ['-singlefile', '-f', '1', '-l', '1', '-jpeg', '-r', '50', '-scale-to', String(THUMB.width), file, prefix], { timeout: this.timeoutMs, cwd: work });
    return fs.existsSync(prefix + '.jpg') ? prefix + '.jpg' : null;
  }
  async withConvert(work, file) {
    const out = path.join(work, 'thumb.jpg');
    await run(this.tools.convert, [file + '[0]', '-auto-orient', '-thumbnail', `${THUMB.width}x${THUMB.height}^`, '-gravity', 'north', '-extent', `${THUMB.width}x${THUMB.height}`, '-quality', '80', out], { timeout: this.timeoutMs, cwd: work });
    return fs.existsSync(out) ? out : null;
  }
  // Without ImageMagick, Chrome pictures the image through a one-line page (file pages may show file images).
  async imagePage(work, file) {
    const page = path.join(work, 'image.html');
    await fsp.writeFile(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#1D1A18}img{width:100%;height:100%;object-fit:cover;object-position:top}</style><img src="file://${encodeURI(file)}">`);
    return 'file://' + page;
  }
}
