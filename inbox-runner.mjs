// 1.74: Pocket runs Inbox Watch's watcher itself. Turning Inbox Watch on is the whole setup: when no other watcher reports
// to this Pocket, the runner writes a config for the owner's mailbox under <data dir>/inbox-watch/, reads mail through
// the Gmail connector the owner already linked to Claude Code (inbox-watch's mail_connector.py: no Google client, token
// or service account), starts from now, and then runs the watcher's `tick` every minute, which checks mail only when
// the schedule set in Settings → Inbox Watch says a check is due. A watcher installed by hand (its own config and
// timer, reporting under its own source) is left alone: the runner never manages a mailbox someone else set up.
//
// States (status() → the Inbox shows them): off · external (a hand-installed watcher reports here) · waiting (needs the
// owner's time zone: open Pocket once) · setting-up · needs-connector (Claude Code has no Gmail connector) · error ·
// running. Three failed runs in a row send one push; the next good run clears it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MINUTE = 60_000;
const RUN_LIMIT_MS = 30 * MINUTE;
const BACKFILL_DAYS = 14; // the connector reads a thread per call slot; two weeks gives the judge context without a long first night
const toml = v => JSON.stringify(String(v)); // TOML basic strings take JSON's escapes

export class InboxRunner {
  constructor({ dataDir, appDir, claudeBin, sessionDir, env, settings, store, log, notify, python = 'python3', now = () => Date.now() }) {
    Object.assign(this, { appDir, claudeBin, sessionDir, env, settings, store, log, notify, python, now });
    this.dir = path.join(dataDir, 'inbox-watch');
    this.config = path.join(this.dir, 'config.toml');
    this.statusFile = path.join(this.dir, 'status.json');
    this.watchDir = path.join(appDir, 'inbox-watch');
    this.busy = null; // { proc, startedAt, what }
    this.state = this.readStatus();
  }

  readStatus() { try { return JSON.parse(fs.readFileSync(this.statusFile, 'utf8')); } catch { return { state: 'off', failures: 0 }; } }
  setStatus(patch) {
    this.state = { ...this.state, ...patch, at: new Date(this.now()).toISOString() };
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.statusFile, JSON.stringify(this.state, null, 1)); } catch (e) { this.log(`inbox runner: status not saved: ${e.message}`); }
  }

  // Another watcher (installed by hand, with its own timer) has reported to this Pocket and the runner has no config of its own.
  external() { return !fs.existsSync(this.config) && Object.keys(this.store.sources || {}).length > 0; }

  status() {
    const s = this.settings();
    if (!s.inbox) return { managed: false, state: 'off' };
    if (this.external()) return { managed: false, state: 'external' };
    const { state = 'waiting', message = null, mailbox = null, at = null, lastOkAt = null, failures = 0 } = this.state;
    return { managed: true, state, message, mailbox, at, lastOkAt, failures, running: this.busy?.what || null };
  }

  start() { this.timer = setInterval(() => this.step().catch(e => this.log(`inbox runner: ${e.message}`)), MINUTE); this.timer.unref?.(); setTimeout(() => this.step().catch(() => {}), 5000).unref?.(); }
  stop() { clearInterval(this.timer); this.busy?.proc.kill('SIGTERM'); }

  async step() {
    const s = this.settings();
    if (!s.inbox || this.external()) return;
    if (this.busy) {
      if (this.now() - this.busy.startedAt > RUN_LIMIT_MS) { this.log(`inbox runner: ${this.busy.what} ran over 30 min; stopped`); this.busy.proc.kill('SIGKILL'); }
      return;
    }
    if (!fs.existsSync(this.config)) return this.setup();
    if (!this.state.baselined) return this.baseline();
    if (this.state.backfill === 'due') return this.backfill();
    const r = await this.run('tick', ['tick']);
    if (r.code === 0) {
      if (this.state.state !== 'running' || this.state.failures) this.setStatus({ state: 'running', message: null, failures: 0, alerted: false });
      this.setStatus({ lastOkAt: new Date(this.now()).toISOString() });
      return;
    }
    const failures = (this.state.failures || 0) + 1, message = errLine(r) || `the watcher exited ${r.code}`;
    const connector = /Gmail connector|Connectors/.test(r.err);
    this.setStatus({ state: connector ? 'needs-connector' : 'error', message, failures });
    if (failures >= 3 && !this.state.alerted) {
      this.setStatus({ alerted: true });
      this.notify?.('Inbox Watch can’t check your mail', connector ? 'Connect Gmail in Settings → Connectors, then it starts again by itself.' : message);
    }
  }

  // python3 with the watcher on its path, isolated (-I) so nothing in the working directory can shadow a module.
  run(what, args, { module = 'inbox_monitor.engine', config = true } = {}) {
    const code = `import sys; sys.path.insert(0, ${JSON.stringify(this.watchDir)}); from ${module} import main; sys.exit(main(sys.argv[1:]))`;
    const argv = ['-I', '-c', code, ...(config ? ['--config', this.config] : []), ...args];
    const env = { ...this.env(), PATH: [path.dirname(process.execPath), this.env().PATH || ''].join(path.delimiter) };
    return new Promise(resolve => {
      let out = '', err = '';
      const proc = spawn(this.python, argv, { cwd: this.dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      this.busy = { proc, startedAt: this.now(), what };
      proc.stdout.on('data', d => { out = (out + d).slice(-20000); });
      proc.stderr.on('data', d => { err = (err + d).slice(-20000); });
      const done = code => { if (this.busy?.proc === proc) this.busy = null; resolve({ code, out, err }); };
      proc.on('error', e => { err += e.message; done(127); });
      proc.on('close', code => done(code ?? 1));
    });
  }

  async setup() {
    const s = this.settings(), tz = s.ownerTimezone;
    if (!tz) { if (this.state.state !== 'waiting') this.setStatus({ state: 'waiting', message: 'Open Pocket Code once on your phone or computer so Inbox Watch knows your time zone.' }); return; }
    fs.mkdirSync(path.join(this.dir, 'state'), { recursive: true });
    this.setStatus({ state: 'setting-up', message: 'Finding your mailbox through the Gmail connector…' });
    const r = await this.run('setup', ['whoami', '--state', path.join(this.dir, 'state'), '--bin', this.claudeBin], { module: 'inbox_monitor.mail_connector', config: false });
    let who = {};
    try { who = JSON.parse(lastLine(r.out) || '{}'); } catch { }
    if (!who.ok) {
      const msg = who.error || errLine(r) || 'The Gmail connector did not answer.';
      return this.setStatus({ state: who.status === 401 ? 'needs-connector' : 'error', message: msg });
    }
    const key = [path.join(process.env.HOME || '', '.config', 'openrouter', 'keys', 'inbox-monitor.key')].find(f => fs.existsSync(f));
    const name = who.name || who.email.split('@')[0];
    const lines = [
      `# Inbox Watch for ${who.email}, written by Pocket Code on ${new Date(this.now()).toISOString().slice(0, 10)}.`,
      '# Pocket runs this watcher every minute while Inbox Watch is on. Schedule, models, rules and tidy are set in Pocket',
      '# (Settings → Inbox Watch) and win over this file; edit it only for what Pocket has no setting for.',
      '[owner]', `name = ${toml(name)}`, `email = ${toml(who.email)}`, `timezone = ${toml(tz)}`, '',
      '[assistant]', 'name = "Pocket Assistant"', '',
      '[schedule]', 'every = 5', 'quiet_hours = [22, 8]', 'digest_hour = 8', 'lookahead = { morning = [8, 12], evening = [17, 22] }', '',
      '[mail]', 'provider = "connector"            # the Gmail connector linked to Claude Code (Settings → Connectors)', 'agent = "claude"',
      `bin = ${toml(this.claudeBin)}`, 'model = "haiku"                    # only fetches; the judge below reads', '',
      '[judge]', 'kind = "claude"', `bin = ${toml(this.claudeBin)}`, 'model = "sonnet"', 'reasoning = "medium"', 'timeout = 300', '',
      '[firstpass]                          # skips routine mail before the judge; needs an OpenRouter key',
      'enabled = true', 'provider = "jev"', 'threshold = 0.8', 'timeout = 20',
      `key_file = ${toml(key || '~/.config/openrouter/keys/inbox-monitor.key')}`, 'key_env = "OPENROUTER_API_KEY"', '',
      '[tidy]', 'enabled = true', 'every_hours = 2', '',
      '[pocket]', `root = ${toml(this.appDir)}`, `session_dir = ${toml(this.sessionDir)}`, 'provider = "claude"', '',
      '[[delivery]]', 'kind = "pocket"', `root = ${toml(this.appDir)}`, 'email = false', '',
    ];
    const prefs = path.join(this.dir, 'preferences.md');
    if (!fs.existsSync(prefs)) fs.writeFileSync(prefs, '');
    fs.writeFileSync(this.config + '.tmp', lines.join('\n'));
    fs.renameSync(this.config + '.tmp', this.config);
    this.log(`inbox runner: set up for ${who.email} (${tz})`);
    this.setStatus({ state: 'setting-up', mailbox: who.email, message: 'Starting from now…', baselined: false });
  }

  // Start from now: what is already in the mailbox is not news. Then two weeks of mail as the judge's memory, in the background of the next steps.
  async baseline() {
    const r = await this.run('baseline', ['--baseline-only']);
    if (r.code !== 0) return this.setStatus({ state: /Connectors/.test(r.err) ? 'needs-connector' : 'error', message: errLine(r) || 'The first check failed.' });
    this.setStatus({ baselined: true, backfill: 'due', state: 'running', message: null, lastOkAt: new Date(this.now()).toISOString() });
  }

  async backfill() {
    this.setStatus({ backfill: 'running' });
    const r = await this.run('backfill', ['backfill', '--days', String(BACKFILL_DAYS)]);
    this.setStatus({ backfill: r.code === 0 ? 'done' : 'failed' });
    if (r.code !== 0) this.log(`inbox runner: backfill failed: ${errLine(r)}`);
  }
}

// The traceback's last line without the exception's module path, or the last thing the watcher printed.
function errLine(r) { return (lastLine(r.err) || lastLine(r.out)).replace(/^[\w.]+(Error|Exception): /, ''); }
function lastLine(text) { return String(text || '').trim().split('\n').filter(Boolean).pop()?.slice(0, 300) || ''; }
