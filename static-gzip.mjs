// The app's own text files (scripts, styles, the page, release notes), gzipped for a browser that accepts it.
//
// Why: the first load of a release is about 1.35 MB of text in 26 files, and express.static sends it as it is. A
// proxy that compresses (Cloudflare) hides that; an install reached over a LAN, a VPN or a plain reverse proxy does
// not, and on a slow phone connection the difference is several seconds. Gzipped it is about 410 KB.
//
// How: each file is compressed once, on its first request, and kept in memory until its size or modified time
// changes (an update replaces the files, so the next request compresses the new ones). Everything this does not
// handle (a browser that does not accept gzip, a range request, an image, a file that is not there, a dotfile) falls
// through to express.static, which answers as before.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
export const GZIP_TYPES = Object.keys(TYPES);

export function staticGzip(root, { maxAge = 300, noCache = ['index.html', 'sw.js'], minBytes = 1024 } = {}) {
  const base = path.resolve(root), kept = new Map(); // file -> { mtimeMs, size, body, etag }
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.headers.range || !/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return next();
    let rel; try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.includes('\0')) return next();
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel.split('/').some(part => part.startsWith('.'))) return next(); // express.static decides about dotfiles
    const type = TYPES[path.extname(rel).toLowerCase()]; if (!type) return next();
    const file = path.join(base, rel); if (!file.startsWith(base + path.sep)) return next();
    let st; try { st = fs.statSync(file); } catch { return next(); }
    if (!st.isFile() || st.size < minBytes) return next();
    let hit = kept.get(file);
    if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
      let raw; try { raw = fs.readFileSync(file); } catch { return next(); }
      hit = { mtimeMs: st.mtimeMs, size: st.size, body: zlib.gzipSync(raw, { level: 9 }), etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-gz"` };
      kept.set(file, hit);
    }
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', hit.etag);
    res.setHeader('Last-Modified', new Date(st.mtimeMs).toUTCString());
    res.setHeader('Cache-Control', noCache.includes(path.basename(file)) ? 'no-cache' : `public, max-age=${maxAge}`);
    if (String(req.headers['if-none-match'] || '').split(',').map(s => s.trim()).includes(hit.etag)) { res.statusCode = 304; return res.end(); }
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', hit.body.length);
    res.statusCode = 200;
    return res.end(req.method === 'HEAD' ? undefined : hit.body);
  };
}
