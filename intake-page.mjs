// 1.110: the intake page. One plain, unauthenticated page where someone outside (a customer's IT contact) types a credential
// that goes straight into the Vault. It carries the operator's name, accent and logo (POCKET_INTAKE_ORG, POCKET_INTAKE_ACCENT,
// POCKET_INTAKE_LOGO), never Pocket's own chrome, and never another item, name or value. Nothing the visitor typed is ever
// written back into a page: an error re-renders the form empty and names the field. Styles and the one script are separate
// same-origin files, so the page runs under a CSP with no inline code.
import fs from 'node:fs';
import path from 'node:path';
import { KINDS, INTAKE_LABEL, LIMITS } from './vault.mjs';

export const INTAKE_ASSET_V = '1';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- the operator's brand ----------
const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export function intakeBrand(env = process.env) {
  const org = String(env.POCKET_INTAKE_ORG || '').trim().slice(0, 80);
  const accent = hexRgb(env.POCKET_INTAKE_ACCENT) || [0x9a, 0x4a, 0x2c]; // a quiet clay when the operator names none
  // The button's ink is whichever of near-black and white reads better on the accent; the accent used as text on white is
  // darkened until it passes AA, so an orange brand still gives readable links and a visible focus ring.
  const dark = [0x1a, 0x17, 0x15], white = [255, 255, 255];
  const ink = contrast(accent, dark) >= contrast(accent, white) ? dark : white;
  let text = accent; for (let k = 0; k < 40 && contrast(text, white) < 4.6; k++) text = text.map(v => v * 0.92);
  let logo = null;
  const lp = String(env.POCKET_INTAKE_LOGO || '').trim();
  if (lp) {
    const type = LOGO_TYPES[path.extname(lp).slice(1).toLowerCase()];
    try { const st = fs.statSync(lp); if (type && st.isFile() && st.size <= 512 * 1024) logo = { path: lp, type }; } catch { }
  }
  return { org, name: org || 'the team that sent you this link', accent: rgbHex(accent), ink: rgbHex(ink), text: rgbHex(text), logo };
}
// Served as /intake/theme.css: the only per-install style, so the page itself carries no inline style.
export const intakeThemeCSS = b => `:root{--accent:${b.accent};--on-accent:${b.ink};--accent-text:${b.text}}\n`;

// ---------- the page ----------
const ICON = {
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>',
  once: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.7L16.2 9.6"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M8.5 12h7"/></svg>',
  wait: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12"/><path d="M12 15.8v.2"/></svg>',
};
const KIND_TITLE = { login: 'a login', api_key: 'an API key', token: 'a token', credentials: 'some credentials', note: 'a secure note' };
const SECRETISH = /pass|secret|key|token|pin|pwd|code/;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// The fields a link asks for, in order, with what the page calls them and whether the value is masked.
export function intakeFields(r) {
  return [...KINDS[r.kind], ...(r.fields || [])].map(f => ({
    name: f, label: cap(INTAKE_LABEL(f, r.kind)), required: KINDS[r.kind].includes(f),
    multiline: r.kind === 'note' && f === 'text', secret: r.kind === 'api_key' || r.kind === 'token' || (f !== 'username' && SECRETISH.test(f)),
    auto: f === 'username' ? 'username' : 'off',
  }));
}
function shell(b, { title, body, status = '' }) {
  const brand = b.logo ? `<img class="brand-logo" src="/intake/logo?v=${INTAKE_ASSET_V}" alt="${esc(b.org || 'Logo')}">` : b.org ? `<span class="brand-name">${esc(b.org)}</span>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<meta name="color-scheme" content="light">
<title>${esc(title)}${b.org ? ' · ' + esc(b.org) : ''}</title>
<link rel="stylesheet" href="/intake/intake.css?v=${INTAKE_ASSET_V}">
<link rel="stylesheet" href="/intake/theme.css?v=${INTAKE_ASSET_V}">
<script src="/intake/intake.js?v=${INTAKE_ASSET_V}" defer></script>
</head>
<body${status ? ` class="is-${status}"` : ''}>
<main class="intake">
${brand ? `<header class="brand">${brand}</header>` : ''}
<section class="card">
${body}
</section>
</main>
</body>
</html>
`;
}
const notice = (b, { icon, title, lines, status }) => shell(b, { title, status, body: `<div class="notice"><span class="notice-icon">${ICON[icon]}</span><h1>${esc(title)}</h1>${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>` });

// state: form | received | inactive | unavailable | busy. For the form: the link (r), its token, the expiry in words, and an error.
export function renderIntake(state, { brand: b, r = null, token = '', expires = '', error = '', errorField = '', nothingSaved = false } = {}) {
  const who = b.org || 'the sender';
  if (state === 'received') return notice(b, { icon: 'check', status: 'received', title: 'Received. Thank you.', lines: [`What you sent is now stored, encrypted, for ${who}.`, 'This link no longer works, and nothing you typed is shown here. You can close this page.'] });
  if (state === 'inactive') return notice(b, { icon: 'off', status: 'inactive', title: 'This link is no longer active', lines: ['It has already been used, it was cancelled, or it has expired.', `If you still need to send something, ask ${who} for a new link.`] });
  if (state === 'unavailable') return notice(b, { icon: 'wait', status: 'unavailable', title: 'Temporarily unavailable', lines: [nothingSaved ? 'This page could not accept anything just now, so nothing you entered was saved.' : 'This page cannot accept anything just now.', 'Your link still works. Please try again later.'] });
  if (state === 'busy') return notice(b, { icon: 'wait', status: 'busy', title: 'Too many attempts', lines: ['Please wait a few minutes, then open the link again.'] });
  const fields = intakeFields(r), asker = r.from || b.org;
  const heading = r.note || `Send ${KIND_TITLE[r.kind] || 'a secret'}`;
  const lede = asker ? `${asker} asked ${r.for || 'you'} for this.` : r.for ? `This was requested from ${r.for}.` : '';
  const field = f => {
    const id = 'f-' + f.name, err = errorField === f.name, desc = err ? ` aria-invalid="true" aria-describedby="form-error"` : '';
    const common = `id="${id}" name="v_${esc(f.name)}" maxlength="${LIMITS.value}"${f.required ? ' required' : ''} autocomplete="${f.auto}" autocapitalize="none" autocorrect="off" spellcheck="false"${desc}`;
    const label = `<label for="${id}">${esc(f.label)}${f.required ? '' : ' <span class="opt">(optional)</span>'}</label>`;
    if (f.multiline) return `<div class="field">${label}<textarea ${common} rows="5"></textarea></div>`;
    if (f.secret) return `<div class="field">${label}<div class="secret"><input type="password" ${common}><button type="button" class="reveal" data-reveal="${id}" aria-pressed="false" aria-label="Show ${esc(f.label.toLowerCase())}" hidden>Show</button></div></div>`;
    return `<div class="field">${label}<input type="text" ${common}></div>`;
  };
  const body = `<h1>${esc(heading)}</h1>
${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
<ul class="assure">
<li>${ICON.lock}<span>It goes straight into ${esc(b.org ? b.org + '’s' : 'an')} encrypted vault, not into email or chat.</span></li>
<li>${ICON.once}<span>This link works once${expires ? ` and expires ${esc(expires)}` : ''}.</span></li>
</ul>
<form method="post" action="/intake/${esc(token)}" autocomplete="off" class="form" data-intake>
<input type="hidden" name="nonce" value="${esc(r.nonce)}">
${fields.map(field).join('\n')}
<div class="field"><label for="f-notes">Anything else we should know <span class="opt">(optional)</span></label><textarea id="f-notes" name="notes" rows="3" maxlength="${LIMITS.notes}" aria-describedby="notes-hint"${errorField === 'notes' ? ' aria-invalid="true"' : ''}></textarea><p class="hint" id="notes-hint">Please keep passwords in the fields above.</p></div>
${error ? `<p class="error" id="form-error" role="alert">${esc(error)} Nothing you typed was kept, so please enter it again.</p>` : ''}
<button type="submit" class="send">Send securely</button>
</form>
<p class="foot">Not expecting this? You can ignore it${b.org ? `, or contact ${esc(b.org)}` : ''}.</p>`;
  return shell(b, { title: heading, body, status: 'form' });
}
// The expiry in the owner's time zone, in words: "Thursday, November 19 at 3:00 PM EST".
export function intakeWhen(iso, timeZone) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const opt = z => ({ weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(z ? { timeZone: z } : {}) });
  let parts; try { parts = new Intl.DateTimeFormat('en-US', opt(timeZone)).formatToParts(d); } catch { parts = new Intl.DateTimeFormat('en-US', opt('')).formatToParts(d); }
  const v = t => parts.find(p => p.type === t)?.value || '';
  return `${v('weekday')}, ${v('month')} ${v('day')} at ${v('hour')}:${v('minute')} ${v('dayPeriod')} ${v('timeZoneName')}`.trim();
}
