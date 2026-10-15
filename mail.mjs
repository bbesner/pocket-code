// Email for due reminders and tasks (1.50). Optional: POCKET_SMTP_URL names an SMTP server
// (smtps://user:pass@smtp.example.com:465, or smtp://… with STARTTLS) and Settings → Notifications
// names the address to send to. Pocket sends one short message per announcement, nothing else:
// no turn-finished mail, no digests. The reminder hook remains for anything beyond email.
// For tests, `file:<path>` appends each message as one JSON line instead of sending it.
import fs from 'node:fs';

export function createMailer(url, { from = '', log = () => {} } = {}) {
  const spec = String(url || '').trim();
  if (!spec) return { configured: false, from: '', describe: () => 'Email is not set up on this server.', send: async () => { throw new Error('Email is not set up on this server.'); } };
  if (spec.startsWith('file:')) {
    const file = spec.slice(5);
    return { configured: true, from: from || 'pocket@localhost', describe: () => `Writes to ${file}`,
      async send(message) { fs.appendFileSync(file, JSON.stringify({ ...message, from: from || 'pocket@localhost', at: new Date().toISOString() }) + '\n'); return { ok: true }; } };
  }
  let parsed;
  try { parsed = new URL(spec); } catch { throw new Error('POCKET_SMTP_URL is not a URL (expected smtps://user:pass@host:port).'); }
  if (!/^smtps?:$/.test(parsed.protocol)) throw new Error('POCKET_SMTP_URL must start with smtp:// or smtps://.');
  const sender = from || (parsed.username ? decodeURIComponent(parsed.username) : '');
  if (!sender || !sender.includes('@')) throw new Error('POCKET_SMTP_FROM is needed: the address Pocket sends from.');
  let transport = null;
  const getTransport = async () => {
    if (transport) return transport;
    const { default: nodemailer } = await import('nodemailer');
    transport = nodemailer.createTransport(spec);
    return transport;
  };
  return { configured: true, from: sender, describe: () => `${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}, from ${sender}`,
    async send({ to, subject, text, html }) {
      const t = await getTransport();
      const info = await t.sendMail({ from: sender, to, subject, text, html });
      log(`mail sent to=${to} id=${info.messageId || '?'}`);
      return { ok: true, id: info.messageId || null };
    } };
}

// A plausible address: one @, no spaces, something either side. Pocket is not a mail validator; the
// test message in Settings is the real check.
export const looksLikeEmail = s => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 200;

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const whenText = (iso, tz) => { try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz || undefined }); } catch { return iso; } };

// The message for one announcement. `item` is the hook payload (a task carries kind:"task", text; a reminder carries
// projectName, label, taskText); `ahead` means the day-before notice. `base` is the public address, when known.
export function dueMessage(item, { ahead = false, base = '', tz = '' } = {}) {
  const task = item.kind === 'task';
  const title = task ? item.text : item.label;
  const when = whenText(item.dueAt, tz);
  const subject = task
    ? (ahead ? `[Pocket Code] Task due tomorrow: ${title}` : `[Pocket Code] Task due: ${title}`)
    : (ahead ? `[Pocket Code] Reminder tomorrow: ${item.projectName} — ${title}` : `[Pocket Code] Reminder: ${item.projectName} — ${title}`);
  const lines = [title, task ? `Due: ${when}` : `Project: ${item.projectName}`, task ? '' : `Due: ${when}`];
  if (!task && item.taskText && item.taskText !== title) lines.push(`Step: ${item.taskText}`);
  const link = base ? base.replace(/\/$/, '') + (item.url || (task ? '/#/tasks' : '/#/projects')) : '';
  if (link) lines.push('', link);
  lines.push('', task ? 'The task stays due until it is marked done or given a new time.' : 'Dismiss or reschedule it on the project card.', 'Sent once by Pocket Code.');
  const text = lines.filter(l => l !== undefined).join('\n');
  const html = `<p><strong>${escapeHtml(title)}</strong></p><p>${task ? '' : 'Project: ' + escapeHtml(item.projectName) + '<br>'}Due: ${escapeHtml(when)}</p>`
    + (!task && item.taskText && item.taskText !== title ? `<p>Step: ${escapeHtml(item.taskText)}</p>` : '')
    + (link ? `<p><a href="${escapeHtml(link)}">${task ? 'Open Tasks' : 'Open the project card'}</a></p>` : '')
    + `<p style="color:#777;font-size:12px">${task ? 'The task stays due until it is marked done or given a new time.' : 'Dismiss or reschedule it on the project card.'} Sent once by Pocket Code.</p>`;
  return { subject, text, html };
}
