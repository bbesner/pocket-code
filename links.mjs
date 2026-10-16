/* 1.54: links in a conversation open the way files do (a tab, a pane, a window). A page shown inside Pocket's own
   frame must allow it: X-Frame-Options and a CSP frame-ancestors directive decide, and the browser gives no way to
   read them, so the daemon fetches the page's headers once and tells the app. The probe only ever reaches public
   hosts: loopback, private, link-local and the cloud metadata ranges are refused, on every redirect hop. */
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_HOPS = 5, TIMEOUT_MS = 6000, CACHE_TTL_MS = 3600000, CACHE_MAX = 500;

// A public unicast address: anything a browser on another network could also reach.
export function isPublicAddress(ip) {
  const kind = net.isIP(ip);
  if (!kind) return false;
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;        // carrier-grade NAT
    if (a === 169 && b === 254) return false;                  // link-local and cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;                    // 192.0.0.0/24, 192.0.2.0/24 documentation
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPublicAddress(v6.slice(7));
  if (v6 === '::' || v6 === '::1') return false;
  if (/^f[cd]/.test(v6)) return false;                        // unique local
  if (/^fe[89ab]/.test(v6)) return false;                     // link-local
  if (v6.startsWith('2001:db8')) return false;                 // documentation
  if (v6.startsWith('64:ff9b:')) return false;                 // NAT64 (maps IPv4, which we cannot inspect here)
  return true;
}

// Does a CSP source expression admit our origin as a frame ancestor?
function ancestorMatches(source, origin) {
  const s = source.toLowerCase().replace(/^'|'$/g, '');
  if (s === '*' ) return true;
  if (s === 'none' || s === 'self') return false;             // 'self' means the page's own origin, never ours
  let ours; try { ours = new URL(origin); } catch { return false; }
  if (s === 'https:' || s === 'http:') return ours.protocol === s;
  if (s === 'https://*' || s === 'http://*') return ours.protocol === s.slice(0, -3);
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return false;           // another scheme
  // host-source: [scheme://]host[:port][/path]; a leading *. matches any subdomain
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\*|\d+))?(?:\/.*)?$/.exec(s);
  if (!m) return false;
  const [, scheme, wild, host, port] = m;
  if (scheme && scheme + ':' !== ours.protocol) return false;
  const ourHost = ours.hostname.toLowerCase();
  if (wild ? !(ourHost.endsWith('.' + host)) : ourHost !== host) return false;
  if (port && port !== '*') { const ourPort = ours.port || (ours.protocol === 'https:' ? '443' : '80'); if (port !== ourPort) return false; }
  return true;
}

// true: the page may be framed by `origin`; false: the page forbids it; null: nothing says (most pages).
// pageOrigin is the origin of the response (after redirects), which X-Frame-Options: SAMEORIGIN refers to.
export function judgeFrameable(headers, origin, pageOrigin = '') {
  const get = k => { const v = typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]; return v == null ? '' : String(v); };
  const xfo = get('x-frame-options').trim().toLowerCase();
  const csp = get('content-security-policy');
  const directive = csp.split(';').map(d => d.trim()).find(d => /^frame-ancestors(\s|$)/i.test(d));
  if (directive) {                                               // a frame-ancestors directive overrides X-Frame-Options
    const sources = directive.split(/\s+/).slice(1);
    return sources.length > 0 && sources.some(src => ancestorMatches(src, origin));
  }
  let ours = ''; try { ours = new URL(origin).origin; } catch {}
  if (xfo.split(',')[0].trim() === 'deny') return false;
  if (xfo.split(',')[0].trim() === 'sameorigin') return Boolean(ours) && ours === pageOrigin;
  return null;
}

// Validate an address a user clicked: http(s), with a host name, nothing that needs credentials.
export function probeTarget(value) {
  let u; try { u = new URL(String(value || '')); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname) return null;
  return u;
}

// lookup(hostname) -> [{address}] (dns.lookup with all:true); fetchImpl(url, init) -> Response.
export async function probeFrameable(target, { origin, fetchImpl = fetch, lookup = h => dns.lookup(h, { all: true }), timeoutMs = TIMEOUT_MS } = {}) {
  let u = probeTarget(target);
  if (!u) return { frameable: null, reason: 'unsupported' };
  const started = Date.now();
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return { frameable: null, reason: 'private' };
    let addresses;
    try { addresses = net.isIP(host) ? [{ address: host }] : await lookup(host); } catch { return { frameable: null, reason: 'unresolved' }; }
    if (!addresses?.length || !addresses.every(a => isPublicAddress(a.address))) return { frameable: null, reason: 'private' };
    const left = timeoutMs - (Date.now() - started); if (left <= 0) return { frameable: null, reason: 'timeout' };
    let r;
    try {
      r = await fetchImpl(u.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(left),
        headers: { accept: 'text/html,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (compatible; PocketCode link check)' } });
    } catch (e) { return { frameable: null, reason: e?.name === 'TimeoutError' ? 'timeout' : 'unreachable' }; }
    try { r.body?.cancel?.(); } catch {}
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      let next; try { next = new URL(r.headers.get('location'), u.href); } catch { return { frameable: null, reason: 'redirect' }; }
      if (!['http:', 'https:'].includes(next.protocol)) return { frameable: null, reason: 'redirect' };
      u = next; continue;
    }
    return { frameable: judgeFrameable(r.headers, origin, u.origin), reason: null, url: u.href, status: r.status };
  }
  return { frameable: null, reason: 'redirect' };
}

// One answer per address for an hour; the app asks on every open of a link view.
export function createFrameProbe(options = {}) {
  const cache = new Map();
  return async (target, extra = {}) => {
    const key = String(target || '') + '\n' + String(extra.origin || options.origin || '');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await probeFrameable(String(target || ''), { ...options, ...extra });
    if (value.reason !== 'timeout' && value.reason !== 'unreachable') {
      cache.set(key, { at: Date.now(), value });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return value;
  };
}
