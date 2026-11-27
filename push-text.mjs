// 1.125.3: the text of a push, and when a push may carry Allow. Kept apart from server.mjs so the rules can be tested on
// their own: a body cut by bytes is not reachable through a route today (the callers that offer Allow send short bodies).
//
// The rule: a notification offers Allow only when its command, title and text were sent uncut and in plain characters.
// The server knows what it sent, not what a phone draws: a phone can still fold a long notification until it is opened
// out, and the push never carries the folder or the variables (the request in Pocket shows those).

export const PUSH_TEXT_MAX = 3900; // 1.124.3: bytes of text in one push (pushRaw)
export const PUSH_TITLE_MAX = 70; // characters (UTF-16 units, as before) of a push title
export const VAULT_PUSH_COMMAND_MAX = 80; // characters of a Vault command in its push

// Control characters (line breaks, tabs), format characters (Unicode Cf: direction marks, zero-width characters) and the
// line and paragraph separators: they can hide or reorder what a notification shows.
const UNUSUAL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const UNUSUAL_ALL = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
export const hasUnusual = s => typeof s === 'string' && UNUSUAL.test(s);

// The longest start of s that is at most max bytes in UTF-8, cut at a character, with … in the last 3 bytes.
// 1.124.5: `size`, a character's bytes as they are counted (pushRaw: escaped in JSON)
export function cutBytes(s, max, size = ch => Buffer.byteLength(ch)) {
  let out = '', n = 0;
  for (const ch of s) { n += size(ch); if (n > max - 3) break; out += ch; }
  return out + '…';
}

// What a device gets for one push (without the badge), and why it may not carry Allow: null, 'title' or 'body' (cut to
// fit), or 'characters' (the title or the text as sent holds a character from UNUSUAL).
// 1.124.3: a push service refuses a message over 4,096 bytes once encrypted (about 100 more than the text), and the
// callers cap the body in characters: 2,000 CJK characters or emoji is 6 KB, and the phone got nothing. The body is cut
// by bytes, at a character, leaving room for the badge.
// 1.124.5: measured as the payload carries it, escaped: a body of quotes, backslashes or control characters was cut to "…"
// 1.125.3: when there is a reason, the `allow` action is dropped, for every caller (Vault run and fill, document share).
// Deny and every other action stay, a tap on the body still opens the request, and the text itself is not changed.
export function pushShape(title, body, fields = {}) {
  const base = { title: title.slice(0, PUSH_TITLE_MAX), body, ...fields };
  let why = title.length > PUSH_TITLE_MAX ? 'title' : null;
  const over = Buffer.byteLength(JSON.stringify(base)) + 32 - PUSH_TEXT_MAX, escaped = s => Buffer.byteLength(JSON.stringify(s)) - 2;
  if (over > 0 && typeof body === 'string') { base.body = cutBytes(body, escaped(body) - over, escaped); why = why || 'body'; }
  if (!why && (hasUnusual(base.title) || hasUnusual(base.body))) why = 'characters';
  if (why && Array.isArray(base.actions) && base.actions.some(a => a?.action === 'allow')) base.actions = base.actions.filter(a => a?.action !== 'allow');
  return { base, why };
}

// The command as a Vault push shows it. It is whole (and the push may offer Allow) only when it is at most
// VAULT_PUSH_COMMAND_MAX characters and every character is printable ASCII. Otherwise each control, format or separator
// character is shown as one space, the command is cut at the limit (with …), and a pointer to Pocket follows.
export function vaultPushCommand(argv) {
  const raw = argv.join(' ');
  const chars = Array.from(raw.replace(UNUSUAL_ALL, ' ')), long = chars.length > VAULT_PUSH_COMMAND_MAX;
  if (!long && PRINTABLE_ASCII.test(raw)) return { text: raw, why: null };
  const shown = chars.slice(0, VAULT_PUSH_COMMAND_MAX).join('');
  return long
    ? { text: shown + '… Open Pocket to read the whole command.', why: 'command' }
    : { text: shown + ' — Open Pocket to read the command exactly.', why: 'characters' };
}

// The log's words on a push that can carry Allow, or '' when no device got it. `kind` and `badge` are left out as
// pushRaw leaves them out, so the reason is judged on the same text. The words never include the command.
export function allowNote(devices, commandWhy, title, body, { kind, badge, ...fields }) {
  if (!devices) return '';
  const why = commandWhy || pushShape(title, body, fields).why;
  if (!why) return ' allow=yes';
  return ` allow=no (${why === 'command' ? 'command cut' : why === 'title' ? 'title cut' : why === 'body' ? 'text cut' : 'unusual characters'})`;
}
