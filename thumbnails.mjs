// Document thumbnails (1.32): a small picture of an HTML report, a PDF's first page or an image, for the
// library's grid. Made once with tools already on the box (headless Chrome for HTML, pdftoppm for PDF,
// ImageMagick's convert or Chrome for images), cached in <documents dir>/.thumbs, keyed by the file's size
// and modification time so an edited file gets a new picture. Without the tool for a kind there is no
// thumbnail and the card shows the kind instead; nothing else changes. Chrome keeps its own sandbox (no
// --no-sandbox), gets a throwaway profile, and a time budget; the documents folder is never written by it.
// 1.89: a renderer never opens the file by its name. The caller opens it once and checks it (openChecked), the job
// copies it from that descriptor into its private work folder, and the renderer reads the copy. An image is decoded
// only as the format its first bytes show, and only when that is PNG, JPEG, GIF or WebP.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { agentEnv } from './environment.mjs';
import { signalGroup } from './proctree.mjs';

export const THUMB = { width: 480, height: 300 };
// 1.89 (S-4): open a file once and check it as opened. The last step is never a link (O_NOFOLLOW), a FIFO cannot hold the
// open (O_NONBLOCK) and is refused with anything else that is not a regular file, and `allow` judges the path the
// descriptor really names, read back from /proc/self/fd, so a parent folder swapped for a link is caught as well. What
// follows reads the descriptor, or `path` (/proc/self/fd/<n>, which reopens the same file and never the name). Without
// /proc (macOS) the real path is realpath of the opened name and `path` is that real path: a swap of a parent folder
// can still race the check there. The caller closes the handle (close() is safe to call twice).
const PROC_FD = (() => { try { return fs.statSync('/proc/self/fd').isDirectory(); } catch { return false; } })();
export function openChecked(file, allow) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTFILE' });
    const real = PROC_FD ? fs.readlinkSync(`/proc/self/fd/${fd}`) : fs.realpathSync(file);
    if (!allow(real)) throw Object.assign(new Error('outside the allowed folder'), { code: 'EOUTSIDE' });
    let open = true;
    return { fd, stat, real, path: PROC_FD ? `/proc/self/fd/${fd}` : real, close() { if (open) { open = false; try { fs.closeSync(fd); } catch { } } } };
  } catch (e) { fs.closeSync(fd); throw e; }
}
// 1.89 (S-5): the coder is read from the file's first bytes and must be one of these four; anything else gets no picture.
// ImageMagick otherwise picks the coder from the content, so a .png holding PostScript or SVG went to Ghostscript or the
// SVG reader, which can pull other local files into the picture. The extension is not asked: a WebP or JPEG saved as .png
// (CDN downloads, clipboard pastes before 1.89) is decoded as what it is.
const MAGIC = { png: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: b => /^GIF8[79]a$/.test(b.toString('latin1', 0, 6)), webp: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' };
async function imageCoder(file) {
  const fh = await fsp.open(file, 'r'); const b = Buffer.alloc(12);
  try { await fh.read(b, 0, 12, 0); } finally { await fh.close(); }
  return Object.keys(MAGIC).find(c => MAGIC[c](b)) || null;
}
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
// 1.73.7: each renderer leads its own process group. The time budget kills the group, and the renderer's exit sweeps
// whatever it left behind (Chrome's helpers), so a wedged renderer cannot hold the work folder or a job slot.
const run = (bin, args, { timeout, cwd }) => new Promise((resolve, reject) => {
  let stderr = '', timedOut = false, child;
  try { child = spawn(bin, args, { cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: agentEnv(process.env) }); }
  catch (e) { return reject(e); }
  const timer = setTimeout(() => { timedOut = true; signalGroup(child.pid, 'SIGKILL'); }, timeout);
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
  child.on('error', e => { clearTimeout(timer); reject(Object.assign(e, { stderr })); });
  child.on('exit', (code, sig) => {
    clearTimeout(timer); signalGroup(child.pid, 'SIGKILL');
    if (code === 0) resolve(); else reject(Object.assign(new Error(timedOut ? `timed out after ${timeout} ms` : `exited ${code ?? sig}`), { stderr }));
  });
});

export class Thumbnailer {
  // 1.89: `allow` judges the real path of a file get() opens itself; by default a file inside the documents folder.
  constructor(docs, { tools = findTools(), concurrency = 2, timeoutMs = 20000, retryAfterMs = 10 * 60 * 1000, log = () => { }, allow = null } = {}) {
    this.docs = docs; this.dir = path.join(docs.dir, '.thumbs'); this.tools = tools;
    this.concurrency = concurrency; this.timeoutMs = timeoutMs; this.retryAfterMs = retryAfterMs; this.log = log;
    this.allow = allow || (real => { try { return real.startsWith(fs.realpathSync(docs.dir) + path.sep); } catch { return false; } });
    this.pending = new Map(); this.queue = []; this.running = 0; this.failed = new Map();
  }
  // Which kinds this install can picture, for the client to know before it asks.
  capabilities() { return { html: Boolean(this.tools.chrome), pdf: Boolean(this.tools.pdftoppm), image: Boolean(this.tools.convert || this.tools.chrome) }; }
  can(r) { return Boolean(this.capabilities()[r.kind]); }
  // 1.89 (S-4): `opened` is the file as the caller already opened and checked it (openChecked); from here the Thumbnailer
  // owns it and closes it. Without one, get() opens the document's file itself under `allow`. A new job keeps the handle
  // until it has copied the file; a request for a key already queued or cached closes its own.
  async get(r, opened = null) {
    let h = opened;
    try {
      if (!this.can(r) || r.trashedAt) return null;
      if (!h) try { h = openChecked(this.docs.filePath(r), this.allow); } catch { return null; }
      const key = `${r.id}-${h.stat.size}-${Math.floor(h.stat.mtimeMs)}`;
      const cached = this.cached(key); if (cached) return cached;
      const failedAt = this.failed.get(key); if (failedAt && Date.now() - failedAt < this.retryAfterMs) return null;
      if (!this.pending.has(key)) {
        const file = h; h = null;
        const job = new Promise(resolve => this.queue.push({ key, r, file, resolve }));
        this.pending.set(key, job); this.pump();
      }
      return this.pending.get(key);
    } finally { h?.close(); }
  }
  cached(key) {
    for (const ext of ['jpg', 'png']) { const p = path.join(this.dir, `${key}.${ext}`); if (fs.existsSync(p)) return { path: p, type: ext === 'png' ? 'image/png' : 'image/jpeg', key }; }
    return null;
  }
  pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift(); this.running++;
      this.make(job).then(result => job.resolve(result), () => job.resolve(null)).finally(() => { job.file.close(); this.running--; this.pending.delete(job.key); this.pump(); });
    }
  }
  async make({ key, r, file }) {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pocket-thumb-'));
    try {
      // 1.89 (S-4): the renderers read a private copy taken from the checked descriptor (work is mode 0700), never the
      // name, so a file swapped for a link while the job waited is not what gets pictured. The copy keeps a tidy base name.
      const src = path.join(work, 'in', path.basename(this.docs.filePath(r)).replace(/[^\w.\-]+/g, '_'));
      await fsp.mkdir(path.dirname(src), { mode: 0o700 });
      await pipeline(fs.createReadStream(null, { fd: file.fd, autoClose: false, start: 0 }), fs.createWriteStream(src, { mode: 0o600 }));
      file.close();
      let out = null;
      if (r.kind === 'html') out = await this.withChrome(work, 'file://' + src);
      else if (r.kind === 'pdf') out = await this.withPdftoppm(work, src);
      else if (r.kind === 'image') {
        const coder = await imageCoder(src); if (!coder) throw new Error('the file is not a PNG, JPEG, GIF or WebP picture');
        out = this.tools.convert ? await this.withConvert(work, src, coder) : await this.withChrome(work, await this.imagePage(work, src));
      }
      if (!out) throw new Error('no renderer');
      const ext = out.endsWith('.png') ? 'png' : 'jpg', final = path.join(this.dir, `${key}.${ext}`);
      for (const old of await fsp.readdir(this.dir).catch(() => [])) if (old.startsWith(r.id + '-')) await fsp.rm(path.join(this.dir, old), { force: true }); // an edited file's old picture
      await fsp.copyFile(out, final); await fsp.chmod(final, 0o600);
      this.failed.delete(key);
      return { path: final, type: ext === 'png' ? 'image/png' : 'image/jpeg', key };
    } catch (e) {
      this.failed.set(key, Date.now()); this.log(`thumbnail failed for ${r.id} ${r.file}: ${e.message}${e.stderr ? ' ' + e.stderr.split('\n').slice(-1)[0] : ''}`);
      return null;
    } finally { file.close(); await fsp.rm(work, { recursive: true, force: true }); }
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
  async withConvert(work, file, coder) {
    const out = path.join(work, 'thumb.jpg');
    await run(this.tools.convert, [coder + ':' + file + '[0]', '-auto-orient', '-thumbnail', `${THUMB.width}x${THUMB.height}^`, '-gravity', 'north', '-extent', `${THUMB.width}x${THUMB.height}`, '-quality', '80', out], { timeout: this.timeoutMs, cwd: work });
    return fs.existsSync(out) ? out : null;
  }
  // Without ImageMagick, Chrome pictures the image through a one-line page (file pages may show file images).
  async imagePage(work, file) {
    const page = path.join(work, 'image.html');
    await fsp.writeFile(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#1D1A18}img{width:100%;height:100%;object-fit:cover;object-position:top}</style><img src="file://${encodeURI(file)}">`);
    return 'file://' + page;
  }
}
