/* Secret detection (1.42): one detector for the browser (paste and send in the composer) and the server (a message
   that reaches /api/session/:id/message or /api/new). It finds text that looks like a credential and says where it is,
   what it probably is, and a Vault name and kind to suggest. It never stores, logs or sends anything itself.

   PocketSecrets.scan(text, { mode }) -> [{ kind, label, name, vaultKind, start, end }], sorted, non-overlapping.
   mode 'message' (default): known key formats, private keys, card numbers, and "password: …"-style assignments.
   mode 'paste': the same, plus a lone high-entropy token (a pasted key with no recognisable prefix).
   Loaded as a classic script in the browser (window.PocketSecrets) and imported for its side effect by the server. */
(function (root) {
  'use strict';
  // [kind, label, suggested Vault name, Vault kind, pattern]. The whole match is the secret unless the pattern has a
  // group named v, in which case only that group is.
  const PATTERNS = [
    ['private-key', 'a private key', 'private-key', 'note', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]{40,}/g],
    ['anthropic', 'an Anthropic API key', 'anthropic-api-key', 'api_key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
    ['openai', 'an OpenAI API key', 'openai-api-key', 'api_key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g],
    ['openrouter', 'an OpenRouter API key', 'openrouter-api-key', 'api_key', /\bsk-or-v1-[a-f0-9]{48,}/g],
    ['github', 'a GitHub token', 'github-token', 'token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
    ['gitlab', 'a GitLab token', 'gitlab-token', 'token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
    ['aws', 'an AWS access key ID', 'aws-access-key', 'api_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
    ['stripe', 'a Stripe key', 'stripe-key', 'api_key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|\bwhsec_[A-Za-z0-9]{24,}/g],
    ['slack', 'a Slack token', 'slack-token', 'token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
    ['google', 'a Google API key', 'google-api-key', 'api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['twilio', 'a Twilio API key', 'twilio-api-key', 'api_key', /\bSK[0-9a-f]{32}\b/g],
    ['sendgrid', 'a SendGrid API key', 'sendgrid-api-key', 'api_key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g],
    ['jwt', 'a signed token (JWT)', 'jwt-token', 'token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
    ['url-credentials', 'a password inside a URL', 'url-credentials', 'note', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:(?<v>[^\s@/]{4,})@/gi],
    // "password: hunter2!", "my api key is 4f9…", 'client_secret="…"'. The value must have a digit or a symbol (so
    // "the password is required" is left alone) and must not already be a Vault placeholder.
    ['assignment', 'a password or secret', 'secret', 'api_key', /\b(?:password|passwd|pass|pwd|passcode|pin|secret|client[_ -]?secret|api[_ -]?key|apikey|access[_ -]?key|secret[_ -]?key|private[_ -]?key|auth[_ -]?token|token|transaction[_ -]?key|signature[_ -]?key)\b["']?\s*(?:is|=|:|=>)\s*["'`]?(?<v>[^\s"'`,;]{6,})/gi],
  ];
  const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;

  function luhn(digits) { let sum = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let d = digits.charCodeAt(i) - 48; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; } return sum % 10 === 0; }
  // Issuer prefixes for Visa, Mastercard, Amex, Discover, so an order number that happens to pass Luhn is not flagged.
  function cardIssuer(d) { return /^4\d{12}(?:\d{3}){0,2}$/.test(d) || /^(?:5[1-5]\d{2}|2(?:2[2-9]\d|[3-6]\d{2}|7[01]\d|720))\d{12}$/.test(d) || /^3[47]\d{13}$/.test(d) || /^6(?:011|5\d{2})\d{12}$/.test(d); }
  function entropy(s) { const f = {}; for (const c of s) f[c] = (f[c] || 0) + 1; let h = 0; for (const k in f) { const p = f[k] / s.length; h -= p * Math.log2(p); } return h; }
  // A pasted single token with no known prefix: long, mixed, random-looking, and not an obvious non-secret.
  function looksRandom(t) {
    if (t.length < 20 || t.length > 512 || /\s/.test(t)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[~./]/.test(t) || /^[\w.-]+@[\w.-]+$/.test(t)) return false; // URLs, paths, addresses
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return false; // a UUID
    if (/^[0-9a-f]{40}$/i.test(t)) return false; // a git commit
    if (/^\{\{vault:[a-z0-9-]+(?:\.[a-z][a-z0-9_]*)?\}\}$/.test(t)) return false;
    if (/^[A-Za-z]+$/.test(t) || /^\d+$/.test(t)) return false; // a word, a number
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(t)).length;
    if (/^[0-9a-f]+$/i.test(t)) return t.length >= 32 && entropy(t) >= 3.3; // a hex key (32+ characters)
    return classes >= 3 && entropy(t) >= 3.6;
  }

  function scan(text, opts) {
    const mode = (opts && opts.mode) || 'message';
    const s = String(text || ''); if (!s) return [];
    const hits = [];
    for (const [kind, label, name, vaultKind, re] of PATTERNS) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(s))) {
        let start = m.index, end = m.index + m[0].length;
        if (m.groups && m.groups.v != null) { const off = m[0].lastIndexOf(m.groups.v); start = m.index + off; end = start + m.groups.v.length; }
        const value = s.slice(start, end);
        if (kind === 'assignment' && (!/[\d\W_]/.test(value) || /^\{\{vault:/.test(value) || /^(?:true|false|null|undefined|none|required|optional|redacted|\*+|x+)$/i.test(value) || /^\$[A-Z_{]/.test(value) || /^<.*>$/.test(value))) continue;
        hits.push({ kind, label, name, vaultKind, start, end });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
    CARD.lastIndex = 0; let c;
    while ((c = CARD.exec(s))) { const digits = c[0].replace(/[ -]/g, ''); if (digits.length >= 13 && digits.length <= 19 && luhn(digits) && cardIssuer(digits)) hits.push({ kind: 'card', label: 'a card number', name: 'card', vaultKind: 'note', start: c.index, end: c.index + c[0].length }); }
    if (mode === 'paste' && !hits.length) {
      const lead = s.length - s.trimStart().length, t = s.trim();
      if (looksRandom(t)) hits.push({ kind: 'random', label: 'a key or token', name: 'api-key', vaultKind: 'api_key', start: lead, end: lead + t.length });
    }
    // Keep the earliest, then the longest, of any overlapping hits.
    hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const out = []; for (const h of hits) { const last = out[out.length - 1]; if (!last || h.start >= last.end) out.push(h); }
    return out;
  }
  // A Vault name not already taken: openai-api-key, openai-api-key-2, …
  function uniqueName(base, taken) { const set = new Set(taken || []); let n = base, i = 2; while (set.has(n)) n = `${base}-${i++}`; return n; }
  // Replace each hit's span with the given placeholder for it (names[i] for hits[i]), from the end so offsets hold.
  function replaceSpans(text, hits, names) { let s = String(text); for (let i = hits.length - 1; i >= 0; i--) s = s.slice(0, hits[i].start) + `{{vault:${names[i]}}}` + s.slice(hits[i].end); return s; }

  root.PocketSecrets = { scan, uniqueName, replaceSpans, luhn };
})(typeof globalThis !== 'undefined' ? globalThis : this);
