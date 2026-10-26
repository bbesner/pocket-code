#!/usr/bin/env node
// pocket-init: take a checkout of Pocket Code to a running server in one command (1.46).
// Checks the prerequisites, writes the missing lines of .env (password, cookie secret, push keys),
// starts the daemon under PM2, waits for /api/health and prints how to give it an HTTPS address.
// Safe to run again: existing .env values are kept, a running daemon is left alone.
//
//   pocket-init [--port 3610] [--contact you@example.com] [--yes] [--no-start] [--dry-run] [--json] [--show-password]
//
//   --port        Port for a new install (default 3610). An existing .env keeps its PORT.
//   --contact     Operator contact given to push services: an email address or an https URL.
//   --yes         Install PM2 with npm if it is missing, without asking.
//   --no-start    Write .env but do not start or restart the daemon.
//   --dry-run     Report what would be done; write and start nothing.
//   --json        Print the report as JSON (never includes the password).
//   --show-password  Print a newly generated password even when not on a terminal.
// The password is printed once, only on a terminal: an agent running this never sees it. Set
// POCKET_PASSWORD in the environment to choose it instead of a generated one.
// Exit codes: 0 ready (or dry run clean), 1 a check failed, 2 bad arguments.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseEnv } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const opts = { port: null, contact: null, yes: false, start: true, dryRun: false, json: false, showPassword: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') opts.port = Number(argv[++i]);
  else if (a === '--contact') opts.contact = argv[++i] ?? '';
  else if (a === '--yes' || a === '-y') opts.yes = true;
  else if (a === '--no-start') opts.start = false;
  else if (a === '--dry-run') opts.dryRun = true;
  else if (a === '--json') opts.json = true;
  else if (a === '--show-password') opts.showPassword = true;
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 18).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  else { console.error(`Unknown argument: ${a} (try --help)`); process.exit(2); }
}
if (opts.port !== null && !(Number.isInteger(opts.port) && opts.port > 0 && opts.port < 65536)) { console.error('--port needs a number between 1 and 65535'); process.exit(2); }

const tty = process.stdout.isTTY && process.stdin.isTTY;
const steps = [];
let password = null, healthy = null; const https = [];
const note = (name, status, detail, extra = {}) => { steps.push({ name, status, detail, ...extra }); if (!opts.json) console.log(`${{ ok: '  ok  ', warn: ' warn ', fail: ' FAIL ', skip: ' skip ' }[status]} ${name}: ${detail}`); };
const failed = () => steps.some(s => s.status === 'fail');
const onPath = name => (process.env.PATH || '').split(path.delimiter).map(d => d && path.join(d, name)).find(f => f && fs.existsSync(f)) || null;
const run = (bin, args, extra = {}) => spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...extra });
const ask = async q => { if (!tty) return null; const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); try { return await new Promise(r => rl.question(q, r)); } finally { rl.close(); } };

if (!opts.json) console.log(`Pocket Code setup in ${root}${opts.dryRun ? ' (dry run: nothing is written or started)' : ''}\n`);

// 1. Platform and Node
if (process.platform === 'linux') note('Platform', 'ok', `Linux (${os.release()})`);
else if (process.platform === 'darwin') note('Platform', 'ok', `macOS (${os.release()}; supported since 1.47, PM2 starts at login through launchd)`);
else if (process.platform === 'win32') note('Platform', 'fail', 'Windows: run Pocket Code inside WSL2 (Ubuntu), where Claude Code usually lives too. Native Windows is not supported.');
else note('Platform', 'warn', `${process.platform}: untested`);
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 20 || (maj === 20 && min >= 11)) note('Node.js', 'ok', `v${process.versions.node}`);
  else note('Node.js', 'fail', `v${process.versions.node}; Pocket Code needs 20.11 or newer`);
}

// 2. Dependencies installed
if (fs.existsSync(path.join(root, 'node_modules', 'express')) && fs.existsSync(path.join(root, 'node_modules', 'web-push'))) note('Dependencies', 'ok', 'node_modules present');
else if (opts.dryRun) note('Dependencies', 'fail', `node_modules missing; run: cd ${root} && npm ci --omit=dev`);
else {
  const r = run('npm', ['ci', '--omit=dev', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: root, stdio: opts.json ? 'pipe' : 'inherit', timeout: 600000 });
  if (r.status === 0) note('Dependencies', 'ok', 'installed with npm ci --omit=dev');
  else note('Dependencies', 'fail', `npm ci failed (exit ${r.status}); run it by hand in ${root}`);
}

// 3. The .env file: read what exists
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
if (!envFile) { note('.env', 'fail', 'POCKET_ENV_FILE is empty, so there is no file to write settings to'); finish(); }

let envLines = [];
try { envLines = fs.readFileSync(envFile, 'utf8').split('\n'); } catch { }
const fileEnv = parseEnv(envLines.join('\n'));
const envExists = envLines.length > 0;
const placeholder = v => v === undefined || v === '' || v === 'change-me' || v === 'you@example.com';
const envPort = Number(fileEnv.PORT) || null;
if (opts.port !== null && envPort && envPort !== opts.port) note('.env', 'fail', `${envFile} already sets PORT=${envPort}; it is not changed by --port. Edit the file and restart if you mean to move the port.`);
const port = envPort || opts.port || 3610;

// 4. Claude Code and Codex
let claudeBin = process.env.CLAUDE_BIN || fileEnv.CLAUDE_BIN || onPath('claude') || [path.join(os.homedir(), '.npm-global', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'].find(f => fs.existsSync(f)) || null;
if (!claudeBin) note('Claude Code', 'fail', 'claude not found. Install it (npm install -g @anthropic-ai/claude-code), or set CLAUDE_BIN in .env to its path.');
else {
  const v = run(claudeBin, ['--version'], { timeout: 15000 });
  const st = run(claudeBin, ['auth', 'status', '--json'], { timeout: 15000 });
  let id = null; try { id = JSON.parse(st.stdout); } catch { }
  const ver = (v.stdout || '').trim().split('\n')[0] || 'version unknown';
  if (id?.loggedIn === true) note('Claude Code', 'ok', `${ver}, signed in${id.email ? ` as ${id.email}` : ''}`);
  else if (id?.loggedIn === false) note('Claude Code', 'warn', `${ver}, not signed in. Run \`claude\` in a terminal and sign in, or use Settings → Accounts in Pocket after it starts.`);
  else note('Claude Code', 'warn', `${ver}, sign-in status unknown (claude auth status gave no answer)`);
}
{
  const codexBin = process.env.CODEX_BIN || fileEnv.CODEX_BIN || onPath('codex');
  if (fileEnv.POCKET_CODEX === '0') note('Codex', 'skip', 'hidden by POCKET_CODEX=0');
  else if (codexBin) note('Codex', 'ok', `found at ${codexBin} (optional)`);
  else note('Codex', 'skip', 'not installed (optional; Pocket shows Codex sessions when the codex CLI is present)');
}

// 5. PM2
let pm2 = onPath('pm2');
if (pm2) note('PM2', 'ok', pm2);
else if (opts.dryRun) note('PM2', 'fail', 'pm2 not found; install it: npm install -g pm2');
else {
  let go = opts.yes;
  if (!go && tty) go = /^y/i.test((await ask('PM2 is not installed. Install it with npm install -g pm2? [y/N] ')) || '');
  if (!go) note('PM2', 'fail', 'pm2 not found. Install it (npm install -g pm2) or run again with --yes.');
  else {
    const r = run('npm', ['install', '-g', 'pm2', '--no-fund', '--no-audit', '--loglevel=error'], { stdio: opts.json ? 'pipe' : 'inherit', timeout: 600000 });
    pm2 = r.status === 0 ? onPath('pm2') : null;
    if (pm2) note('PM2', 'ok', `installed at ${pm2}`); else note('PM2', 'fail', 'npm install -g pm2 failed; install it by hand (it may need a prefix you can write to, or sudo)');
  }
}
let running = null; // the pocket-claude PM2 app, if there is one
if (pm2) {
  try { const list = JSON.parse(run(pm2, ['jlist'], { timeout: 30000 }).stdout || '[]'); running = list.find(p => p.name === 'pocket-claude') || null; } catch { }
  if (running && path.resolve(running.pm2_env?.pm_cwd || '') !== root) note('PM2 app', 'fail', `a pocket-claude process already runs from ${running.pm2_env?.pm_cwd}, not this checkout. One daemon per data directory: stop that one first or install there.`);
  else if (running) note('PM2 app', 'ok', `pocket-claude is ${running.pm2_env?.status || 'listed'} from this checkout`);
}

// 6. Port free (only when nothing of ours is running yet)
if (!running) {
  const free = await new Promise(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(port, '127.0.0.1', () => s.close(() => r(true))); });
  if (free) note('Port', 'ok', `127.0.0.1:${port} is free`);
  else note('Port', 'fail', `127.0.0.1:${port} is in use. Choose another with --port, or if that is an older Pocket Code started outside PM2, stop it first.`);
}

// 7. Write the missing .env lines
const add = {};
if (placeholder(fileEnv.PORT)) add.PORT = String(port);
if (placeholder(fileEnv.POCKET_PASSWORD)) { password = process.env.POCKET_PASSWORD || crypto.randomBytes(18).toString('base64'); add.POCKET_PASSWORD = password; }
if (placeholder(fileEnv.POCKET_SECRET)) add.POCKET_SECRET = crypto.randomBytes(32).toString('hex');
if (placeholder(fileEnv.VAPID_PUBLIC) || placeholder(fileEnv.VAPID_PRIVATE)) {
  try { const wp = createRequire(path.join(root, 'package.json'))('web-push'); const k = wp.generateVAPIDKeys(); add.VAPID_PUBLIC = k.publicKey; add.VAPID_PRIVATE = k.privateKey; }
  catch (e) { note('Push keys', 'warn', `could not generate VAPID keys (${e.message}); push notifications stay off until VAPID_PUBLIC/VAPID_PRIVATE are set`); }
}
if (placeholder(fileEnv.VAPID_CONTACT)) {
  let c = opts.contact; if (!c && tty) c = (await ask('Contact for push services (your email, or an https URL): ')) || '';
  if (c) add.VAPID_CONTACT = c; else note('Push contact', 'warn', 'VAPID_CONTACT not set; give one with --contact so push services can reach the operator');
}
const keys = Object.keys(add);
if (!keys.length) note('.env', 'ok', `${envFile} already has every required setting`);
else if (opts.dryRun) note('.env', 'ok', `would ${envExists ? 'add' : 'create it with'}: ${keys.join(', ')}`);
else if (!failed()) {
  const out = [...envLines]; if (out.length && out.at(-1) !== '') out.push('');
  for (const [k, v] of Object.entries(add)) { const i = out.findIndex(l => new RegExp(`^\\s*${k}\\s*=`).test(l)); if (i >= 0) out[i] = `${k}=${v}`; else out.push(`${k}=${v}`); }
  if (!envExists) out.unshift(`# Pocket Code settings, written by pocket-init on ${new Date().toISOString().slice(0, 10)}. See .env.example for everything else.`);
  const tmp = envFile + '.tmp'; fs.writeFileSync(tmp, out.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 }); fs.renameSync(tmp, envFile); fs.chmodSync(envFile, 0o600);
  note('.env', 'ok', `${envExists ? 'added' : 'created with'} ${keys.join(', ')} (mode 0600)`, { added: keys });
} else note('.env', 'skip', 'not written because a check failed');
if (envExists && !opts.dryRun && (fs.statSync(envFile).mode & 0o077)) { fs.chmodSync(envFile, 0o600); note('.env mode', 'ok', 'tightened to 0600'); }

// 8. Start (or restart after new settings) and wait for health
if (!opts.start) note('Daemon', 'skip', 'not started (--no-start)');
else if (opts.dryRun) note('Daemon', 'skip', running ? 'already running; nothing to do' : `would run: pm2 start ecosystem.config.cjs && pm2 save`);
else if (failed()) note('Daemon', 'skip', 'not started because a check failed');
else if (pm2) {
  const action = !running ? 'start' : keys.length ? 'restart' : null;
  if (action) {
    const r = run(pm2, [action, 'ecosystem.config.cjs'], { cwd: root, timeout: 60000 });
    if (r.status !== 0) note('Daemon', 'fail', `pm2 ${action} failed: ${(r.stderr || r.stdout || '').trim().split('\n').at(-1)}`);
    else { run(pm2, ['save'], { timeout: 60000 }); note('Daemon', 'ok', `pm2 ${action} ecosystem.config.cjs; pm2 save`); }
  }
  if (!failed()) {
    const url = `http://127.0.0.1:${port}/api/health`; const until = Date.now() + 30000;
    while (Date.now() < until && healthy === null) {
      try { const res = await fetch(url, { signal: AbortSignal.timeout(2000) }); const j = await res.json(); if (j.ok) healthy = j; else throw new Error(); } catch { await new Promise(r => setTimeout(r, 1000)); }
    }
    if (healthy) note('Health', 'ok', `${url} answers ok (${healthy.processes ?? 0} session processes)`);
    else note('Health', 'fail', `${url} did not answer within 30 s; see: pm2 logs pocket-claude --lines 50`);
  }
}

// 9. Boot persistence and HTTPS
const user = os.userInfo().username;
if (pm2 && !opts.dryRun && (process.platform === 'linux' || process.platform === 'darwin')) {
  const mac = process.platform === 'darwin';
  const unit = mac ? fs.existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', `pm2.${user}.plist`)) : fs.existsSync(`/etc/systemd/system/pm2-${user}.service`);
  if (unit) note('Boot', 'ok', mac ? `launchd agent pm2.${user}.plist exists; saved processes return after you log in` : `pm2-${user}.service exists; saved processes return after a reboot`);
  else note('Boot', 'warn', mac ? `PM2 is not set to start at login. Run: pm2 startup   (then the command it prints), then: pm2 save` : `PM2 is not set to start at boot. Run: pm2 startup   (then the sudo command it prints), then: pm2 save`);
}
const cf = onPath('cloudflared'); const cfConf = path.join(os.homedir(), '.cloudflared', 'config.yml');
if (cf) https.push({ tool: 'Cloudflare Tunnel', text: `cloudflared is installed. Add this ingress rule ahead of the catch-all in ${fs.existsSync(cfConf) ? cfConf : '~/.cloudflared/config.yml'}, route the DNS name to the tunnel (cloudflared tunnel route dns <tunnel> code.yourdomain.com) and restart cloudflared:\n      - hostname: code.yourdomain.com\n        service: http://localhost:${port}` });
const ts = onPath('tailscale');
if (ts) https.push({ tool: 'Tailscale Serve', text: `tailscale is installed. One command gives an HTTPS address on your tailnet:\n      tailscale serve --bg ${port}\n    then open the https://<machine>.<tailnet>.ts.net address it prints (devices must be on the tailnet).` });
const caddy = onPath('caddy');
if (caddy) https.push({ tool: 'Caddy', text: `caddy is installed. A Caddyfile site block with automatic certificates:\n      code.yourdomain.com {\n        reverse_proxy 127.0.0.1:${port}\n      }` });
if (onPath('nginx') && !caddy) https.push({ tool: 'nginx', text: `nginx is installed. Proxy a TLS server block to http://127.0.0.1:${port} with proxy_http_version 1.1 and the Upgrade/Connection headers for streaming.` });
if (!https.length) https.push({ tool: 'none found', text: `No tunnel or proxy found. The simplest is Tailscale (https://tailscale.com/download, then: tailscale serve --bg ${port}); a public hostname needs a Cloudflare Tunnel or a reverse proxy such as Caddy. Details: docs/install.md.` });

finish();

function finish() {
  const ok = !failed();
  const report = { ok, dryRun: opts.dryRun, root, envFile, port, url: `http://127.0.0.1:${port}`, passwordGenerated: Boolean(password), passwordFile: password ? envFile : null, https, steps };
  if (opts.json) { console.log(JSON.stringify(report, null, 1)); process.exit(ok ? 0 : 1); }
  console.log('');
  if (!ok) { console.log('Not finished: fix the FAIL lines above and run pocket-init again. Nothing it already wrote needs undoing.'); process.exit(1); }
  if (opts.dryRun) { console.log('Dry run complete. Run without --dry-run to apply. HTTPS options found on this machine:'); for (const h of https) console.log(`  • ${h.tool}: ${h.text}`); process.exit(0); }
  console.log(`Pocket Code is ${healthy ? 'running' : opts.start ? 'configured' : 'configured (not started)'} at http://127.0.0.1:${port} (loopback only).`);
  if (password) {
    if (tty || opts.showPassword) console.log(`\nYour Pocket Code password (shown once; it is the POCKET_PASSWORD line in ${envFile}):\n\n    ${password}\n`);
    else console.log(`\nA password was generated and saved as POCKET_PASSWORD in ${envFile}. It is not printed here because this is not a terminal.\nThe owner reads it with:   grep '^POCKET_PASSWORD=' ${envFile}\n`);
  } else console.log(`Password: unchanged, the POCKET_PASSWORD line in ${envFile}.`);
  console.log('Next: give it an HTTPS address so phones can install it and receive push.');
  for (const h of https) console.log(`  • ${h.tool}: ${h.text}`);
  console.log(`\nThen open the address, sign in, and on a phone choose Add to Home screen and tap the bell for notifications.\nUpgrades and recovery: docs/operations.md`);
  process.exit(0);
}
