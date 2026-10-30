// 1.63: one sign-in. When Pocket sits behind Cloudflare Access, the person has already signed in there (an emailed
// PIN or an identity provider), and every request that reaches Pocket through the tunnel carries Cloudflare's signed
// token in the Cf-Access-Jwt-Assertion header. Pocket can trust that instead of asking for its own password as well.
//
// Trust comes only from the signature: the token must be RS256, signed by a key Cloudflare publishes for this team
// (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs), issued by that team, meant for this application (aud),
// unexpired, and for an email on the owner's list. A header anyone could type is worthless without Cloudflare's key,
// so it doesn't matter whether the request came through the tunnel. Anything else gets the normal password page.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const b64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const parse = s => JSON.parse(b64url(s).toString('utf8'));

export class AccessVerifier {
  // team: the Zero Trust team name (<team>.cloudflareaccess.com); aud: the Access application's audience tag;
  // emails: who may sign in this way (required; an empty list turns the feature off).
  constructor({ team = '', aud = '', emails = [], certsUrl = null, fetchImpl = globalThis.fetch, now = () => Date.now(), refreshMs = 3600_000, log = () => { } } = {}) {
    this.team = String(team).trim().toLowerCase(); this.aud = String(aud).trim();
    this.emails = new Set((Array.isArray(emails) ? emails : String(emails).split(',')).map(e => String(e).trim().toLowerCase()).filter(Boolean));
    this.issuer = this.team ? `https://${this.team}.cloudflareaccess.com` : '';
    this.certsUrl = certsUrl || (this.issuer ? this.issuer + '/cdn-cgi/access/certs' : '');
    this.fetch = fetchImpl; this.now = now; this.refreshMs = refreshMs; this.log = log;
    this.keys = new Map(); this.fetchedAt = 0; this.loading = null; this.lastMissAt = 0; this.failedAt = 0;
  }
  get on() { return Boolean(/^[a-z0-9-]{1,63}$/.test(this.team) && this.aud && this.emails.size); }
  // Keys are refreshed hourly. If a refresh fails, the cached keys stay in use for up to a day (Cloudflare rotates
  // them every six weeks) and the next attempt waits a minute, so an outage at Cloudflare never locks everyone out
  // or turns every request into a fetch.
  async loadKeys(force = false) {
    const age = this.now() - this.fetchedAt, stale = age >= this.refreshMs;
    if (!force && this.keys.size && !stale) return;
    if (this.keys.size && this.now() - this.failedAt < 60_000) { if (age < 24 * 3600_000) return; throw new Error('signing keys too old'); }
    if (!this.keys.size && this.now() - this.failedAt < 60_000) throw new Error('signing keys unavailable');
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const r = await this.fetch(this.certsUrl, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('certs HTTP ' + r.status);
      const j = await r.json(), keys = new Map();
      for (const k of j?.keys || []) if (k?.kid && k.kty === 'RSA') { try { keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' })); } catch { } }
      if (!keys.size) throw new Error('no signing keys');
      this.keys = keys; this.fetchedAt = this.now(); this.failedAt = 0;
    })().catch(e => { this.failedAt = this.now(); if (this.keys.size && this.now() - this.fetchedAt < 24 * 3600_000) return; throw e; })
      .finally(() => { this.loading = null; });
    return this.loading;
  }
  // { email } when the token proves an allowed person signed in through this Access application, else { error }.
  async verify(token) {
    if (!this.on) return { error: 'off' };
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return { error: 'malformed' };
    let header, payload;
    try { header = parse(parts[0]); payload = parse(parts[1]); } catch { return { error: 'malformed' }; }
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return { error: 'malformed' };
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { error: 'algorithm' };
    try { await this.loadKeys(); } catch (e) { this.log(`access: signing keys unavailable: ${e.message}`); return { error: 'keys' }; }
    let key = this.keys.get(header.kid);
    if (!key && this.now() - this.lastMissAt > 60_000) { // a rotated key: look again, at most once a minute
      this.lastMissAt = this.now();
      try { await this.loadKeys(true); } catch { }
      key = this.keys.get(header.kid);
    }
    if (!key) return { error: 'unknown key' };
    if (!cryptoVerify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, b64url(parts[2]))) return { error: 'signature' };
    const t = Math.floor(this.now() / 1000), skew = 60;
    if (payload.iss !== this.issuer) return { error: 'issuer' };
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(this.aud)) return { error: 'audience' };
    if (!Number.isFinite(payload.exp) || payload.exp + skew < t) return { error: 'expired' };
    if (Number.isFinite(payload.nbf) && payload.nbf - skew > t) return { error: 'not yet valid' };
    // 1.89: from here the request provably came through this Access application (`through`), whoever the person is, so
    // the server may believe the cf-connecting-ip Cloudflare put on it (the login and Vault attempt limits count by it).
    // ASCII only, lower-cased the ASCII way, so no Unicode case folding can turn one address into another.
    if (typeof payload.email !== 'string' || !/^[\x21-\x7e]{3,254}$/.test(payload.email.trim())) return { error: 'email', through: true };
    const email = payload.email.trim().replace(/[A-Z]/g, c => c.toLowerCase());
    if (!this.emails.has(email)) return { error: 'email', through: true };
    return { email, exp: payload.exp, through: true };
  }
}
