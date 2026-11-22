// 1.123: Pocket Code installs its own release, when the owner of the install opts in (POCKET_SELF_UPDATE=1).
// Off by default: on a managed install the operator updates Pocket and the Updates sheet only says a release is out.
// The work is scripts/pocket-self-update.sh, the same guarded steps an operator runs over ssh (clean checkout on main or a
// detached release, release tag on main, private-state backup, npm ci, release check, PM2 restart, served-version check),
// started detached so it outlives the restart it causes, and rolled back if the new version does not come up.
// Its progress is one small JSON file in the data folder; the daemon that starts after the restart reads it from there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const SELF_UPDATE_FILE = 'pocket-self-update.json';
export const SELF_UPDATE_LOG = 'pocket-self-update.log';
const RUNNING = new Set(['queued', 'checking', 'backing-up', 'installing', 'restarting', 'rolling-back']);
const STALE_MS = 20 * 60 * 1000; // a job that has said nothing for this long died with its server (reboot, OOM)
const version = v => typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) ? v : null;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

export class SelfUpdate {
  constructor({ checkout, dataDir, env = process.env, port, repo = 'bbesner/pocket-code', now = () => Date.now(), spawner = spawn, node = process.execPath, script, setsid }) {
    Object.assign(this, { checkout, env, port, repo, now, spawner, node });
    this.script = script || path.join(checkout, 'scripts', 'pocket-self-update.sh');
    this.file = path.join(dataDir, SELF_UPDATE_FILE);
    this.log = path.join(dataDir, SELF_UPDATE_LOG);
    this.enabled = env.POCKET_SELF_UPDATE === '1';
    this.setsid = setsid ?? (process.platform === 'linux' && ['/usr/bin/setsid', '/bin/setsid'].some(p => fs.existsSync(p)));
  }
  // Why an opted-in install still cannot update itself; null when it can.
  reason() {
    if (!this.enabled) return null;
    if (this.env.pm_id === undefined) return 'Pocket is not running under PM2 here, so it cannot restart itself. Update it from the server.';
    if (!fs.existsSync(path.join(this.checkout, '.git'))) return 'This install is not a git checkout. Update it from the server.';
    if (!['linux', 'darwin'].includes(process.platform)) return 'Updating from Pocket works on Linux and macOS servers only.';
    return null;
  }
  job() {
    let j;
    try { j = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const out = { id: j.id, from: j.from, to: j.to, phase: j.phase, running: RUNNING.has(j.phase), startedAt: j.startedAt, updatedAt: j.updatedAt, finishedAt: j.finishedAt || null, error: j.error || null, backup: j.backup || null };
    if (out.running && this.now() - (j.updatedAt || j.startedAt || 0) > STALE_MS) Object.assign(out, { running: false, phase: 'interrupted', error: 'The update stopped without finishing, probably because the server restarted. Check the version shown here before you try again.' });
    return out;
  }
  // The checked-out commit, read from .git without running git (a route must not start a process per request).
  // Anything unexpected gives '' and begin() refuses; the script checks HEAD again with git before changing anything.
  head() {
    try {
      const git = path.join(this.checkout, '.git');
      const ref = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
      if (/^[0-9a-f]{40}$/.test(ref)) return ref;
      const name = /^ref: (refs\/heads\/[\w./-]+)$/.exec(ref)?.[1];
      if (!name || name.includes('..')) return '';
      try { const loose = fs.readFileSync(path.join(git, name), 'utf8').trim(); if (/^[0-9a-f]{40}$/.test(loose)) return loose; } catch {}
      const packed = fs.readFileSync(path.join(git, 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(' ' + name));
      return /^[0-9a-f]{40}/.exec(packed || '')?.[0] || '';
    } catch { return ''; }
  }
  snapshot() { return { enabled: this.enabled, available: this.enabled && !this.reason(), reason: this.reason(), job: this.job() }; }
  // from/to come from the release check; busy is whatever would make a restart cut work short.
  begin({ from, to, head = this.head(), busy = 0, otherJob = false }) {
    if (!this.enabled) throw fail('Pocket Code updates are installed by whoever manages this server.');
    const why = this.reason(); if (why) throw fail(why);
    if (!version(from) || !version(to)) throw fail('No newer Pocket Code release was found. Check again.');
    if (!/^[0-9a-f]{40}$/.test(head || '')) throw fail('Could not read the installed checkout. Update it from the server.');
    if (this.job()?.running) throw fail('A Pocket Code update is already running.');
    if (otherJob) throw fail('A CLI update check or upgrade is running. Try again when it finishes.');
    if (busy > 0) throw fail('Replies are running. Update when they finish, so the restart does not cut them short.');
    const job = { id: randomUUID(), from, to, phase: 'queued', startedAt: this.now(), updatedAt: this.now() };
    write(this.file, job);
    // No Pocket secrets reach the script: the daemon's environment includes everything from .env.
    const env = { PATH: this.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: this.env.HOME || os.homedir(), LANG: 'C.UTF-8' };
    if (this.env.PM2_HOME) env.PM2_HOME = this.env.PM2_HOME;
    const out = fs.openSync(this.log, 'a', 0o600);
    try {
      fs.writeSync(out, `\n=== ${new Date(this.now()).toISOString()} update ${from} -> ${to} (job ${job.id})\n`);
      // setsid -f forks once more, so the script is not the daemon's child: PM2 with treekill on would otherwise stop it
      // with the daemon it is restarting. (Pocket's ecosystem file turns treekill off; an install started another way may not.)
      const [bin, pre] = this.setsid ? ['setsid', ['-f', 'bash']] : ['bash', []];
      const child = this.spawner(bin, [...pre, this.script, this.checkout, to, head, String(this.env.pm_id), String(this.port), this.file, this.node, this.repo, from],
        { cwd: this.checkout, env, detached: true, stdio: ['ignore', out, out] });
      child.on?.('error', () => { try { write(this.file, { ...job, phase: 'failed', updatedAt: this.now(), finishedAt: this.now(), error: 'Could not start the update. Nothing was changed.' }); } catch {} });
      child.unref?.();
    } finally { fs.closeSync(out); }
    return this.snapshot();
  }
}

function write(file, data) {
  const tmp = file + '.tmp'; const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
