// What a Vault run executes (PC-02). An "Always allow" used to match the command's text alone, so an agent could rewrite
// the script it names (or put a program of the same name earlier on PATH) and run its own code with the secret, unasked.
// A run is pinned: the program found on the Vault's own PATH (never the caller's), the interpreter its #! line names, the
// program a known launcher (env, timeout, nice, sudo, …) starts, the script a known interpreter runs, and every argument
// that names an existing regular file, each by absolute path and SHA-256 of its content. A recipe matches only while all
// of that is unchanged.
//
// 1.117 (independent review, D-1 to D-4):
// - What was hashed is what runs, as far as Linux allows: every pinned file is opened once and hashed from that handle.
//   The program, when it is a native binary, is started from that very handle (/proc/self/fd/N); a shell script (the
//   script handed to sh, dash, bash, ash, ksh or mksh, or a program whose #! line names one) runs from a private copy of
//   the bytes that were hashed. Everything else (a node or python script, a #! interpreter, a program a launcher starts,
//   files a script reads itself) is checked again right before the start, after the Vault's bookkeeping, with nothing
//   slow in between, and a difference stops the run. What is left: the moment between the start and the moment such a
//   program opens the file by its path.
// - A regular file Pocket cannot hash (unreadable, or over the size limit) is recorded by its size and times; content is
//   not compared (D-2).
// - An approved recipe may mark an argument as data the command writes itself (an output, log or state file): its
//   content is then not compared (D-3).
// - Code given inline (sh -c, node -e, python -c, perl -e, …) is matched by its text; files it names plainly are pinned
//   too, and the request says the rest cannot be checked (D-4).
// Not covered, and said so in SECURITY.md: files a script reads or sources itself, modules an interpreter loads, programs a
// script starts by name, and a process of the same user that reads or changes a running command through /proc.
//
// Second review (its problems 4 and 5):
// - A script node, python or another interpreter opens by its path can be swapped at the moment of the start, and a helper
//   that watches /proc for the new process wins nearly every time. Running such a script from the checked bytes was tried
//   and is not done: node, handed /proc/self/fd/N, resolves the link and opens the script by its path again (no gain), and
//   with --preserve-symlinks-main it reads the checked bytes but import.meta.url, __dirname and relative imports then name
//   /proc/self/fd; python3 reads the checked bytes but __file__ and sys.argv[0] become /proc/self/fd/N, which breaks every
//   script that finds files next to itself. A loader or wrapper would change stack traces and execArgv and still leave the
//   modules the script imports unpinned. So the pin marks such a script `writable` when the user Pocket runs as (the
//   agents' user) can change it or a folder above it, and the request says what that means.
// - What Pocket cannot pin is no longer offered Always allow: an interpreter whose script it cannot resolve to a regular file
//   it hashed, and programs that are not launchers but decide what to run themselves (find -exec, parallel, ssh with a
//   command, npm run, npx, docker run, node --watch, …). The pin's `refuse` says why. Where the rule is simple it resolves
//   instead: `node job` is the file node loads (job, job.js, job.json, job.node), `python3 -m mod` the module file in the
//   working folder, `node -r ./x` the file it preloads, and `make` its makefile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export const PIN_VERSION = 2;
// fileBytes: the largest file hashed; small: files up to this size are read whole, compared byte for byte again just
// before the start, and may run from a private copy; tokens: words of inline code looked up as files.
export const PIN_LIMITS = { fileBytes: 512 * 1024 * 1024, cache: 1000, small: 256 * 1024, tokens: 200, depth: 4 };
const FD_RUN = process.platform === 'linux' && (() => { try { return fs.statSync('/proc/self/fd').isDirectory(); } catch { return false; } })();

// The Vault's PATH: POCKET_VAULT_PATH, or the daemon's own PATH at start, keeping absolute folders only (an empty entry or
// "." would search the agent's working directory).
export const runPath = raw => String(raw || '').split(':').filter(d => path.isAbsolute(d)).join(':') || '/usr/local/bin:/usr/bin:/bin';
const runnable = p => { try { const st = fs.statSync(p); if (!st.isFile()) return false; fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };
export function findProgram(name, cwd, PATH) {
  if (name.includes('/')) { const p = path.resolve(cwd, name); return runnable(p) ? p : null; }
  for (const d of runPath(PATH).split(':')) { const p = path.join(d, name); if (runnable(p)) return p; }
  return null;
}

// Folders on the Vault's PATH this user could put a program into: the folder is writable ('writable'), a folder above it is
// (it can be renamed and replaced: 'parent'; in a sticky folder such as /tmp only when this user owns what is below), or it
// does not exist and can be created ('missing'). A program an approved script starts by name is looked up there.
export function exposedFolders(PATH, uid = process.getuid?.()) {
  const out = [];
  for (const dir of new Set(runPath(PATH).split(':'))) {
    let p = dir, below = null, missing = false, why = null;
    for (;;) {
      let st = null; try { st = fs.statSync(p); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') break; }
      if (!st) missing = true;
      else if (!st.isDirectory()) break;
      else {
        let w = false; try { fs.accessSync(p, fs.constants.W_OK); w = true; } catch { }
        if (w && p === dir) { why = 'writable'; break; }
        if (w && missing) { why = 'missing'; break; }
        if (w && (!(st.mode & 0o1000) || below?.uid === uid)) { why = 'parent'; break; }
        below = st;
      }
      const up = path.dirname(p); if (up === p) break; p = up;
    }
    if (why) out.push({ dir, why });
  }
  return out;
}

// ---------- reading a file once ----------
// Large hashes are kept per path while the file's device, inode, size, modification and change times stay the same (a
// program such as node is large; the change time cannot be set back by its owner), and the file must not change while it
// is read.
const pinCache = new Map();
const statKey = st => [st.dev, st.ino, st.size, st.mtimeNs, st.ctimeNs].join(':');
const stampOf = st => ({ size: String(st.size), mtime: String(st.mtimeNs), ctime: String(st.ctimeNs) });
const kindOf = st => st.isDirectory() ? 'folder' : st.isFIFO() ? 'pipe' : st.isSocket() ? 'socket' : st.isCharacterDevice() || st.isBlockDevice() ? 'device' : 'other';
// O_NONBLOCK: a pipe swapped in for a file is opened without waiting for a writer, then refused as not a regular file.
const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOCTTY || 0);
const sha256 = b => createHash('sha256').update(b).digest('hex');
async function readInto(fh, buf, from = 0) { let off = 0; while (off < buf.length) { const { bytesRead } = await fh.read(buf, off, buf.length - off, from + off); if (!bytesRead) break; off += bytesRead; } return buf.subarray(0, off); }
function readIntoSync(fd, buf) { let off = 0; while (off < buf.length) { const n = fs.readSync(fd, buf, off, buf.length - off, off); if (!n) break; off += n; } return buf.subarray(0, off); }
async function hashHandle(fh, size) { const h = createHash('sha256'), buf = Buffer.allocUnsafe(1 << 20); for (let pos = 0; pos < size;) { const { bytesRead } = await fh.read(buf, 0, buf.length, pos); if (!bytesRead) break; h.update(buf.subarray(0, bytesRead)); pos += bytesRead; } return h.digest('hex'); }
// null (nothing there), { kind } (not a regular file), or a regular file: { st, stamp, why } when it cannot be read or is
// over the limit, otherwise { fh, st, key, sha256, head, bytes } (bytes only for a small file).
async function openFile(p) {
  let fh;
  try { fh = await fs.promises.open(p, READ_FLAGS); }
  catch {
    let st; try { st = await fs.promises.stat(p, { bigint: true }); } catch { return null; }
    return st.isFile() ? { st, stamp: stampOf(st), why: 'unreadable' } : { kind: kindOf(st) };
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile()) { await fh.close(); return { kind: kindOf(st) }; }
    const key = statKey(st), size = Number(st.size);
    if (st.size > BigInt(PIN_LIMITS.fileBytes)) return { fh, st, key, stamp: stampOf(st), why: 'large', head: await readInto(fh, Buffer.alloc(256)) };
    let sha, bytes = null;
    if (size <= PIN_LIMITS.small) { bytes = await readInto(fh, Buffer.alloc(size)); sha = sha256(bytes); }
    else { const hit = pinCache.get(p); sha = hit && hit.key === key ? hit.sha : await hashHandle(fh, size); }
    if (statKey(await fh.stat({ bigint: true })) !== key || (bytes && bytes.length !== size)) throw fail(`${p} changed while the Vault was checking it; try again.`, 409);
    if (!bytes) { if (pinCache.size >= PIN_LIMITS.cache) pinCache.clear(); pinCache.set(p, { key, sha }); }
    return { fh, st, key, sha256: sha, bytes, head: bytes ? bytes.subarray(0, 256) : await readInto(fh, Buffer.alloc(256)) };
  } catch (e) { await fh.close().catch(() => {}); throw e; }
}
const shebangOf = head => { const line = head ? head.toString('latin1').split('\n')[0] : ''; return line.startsWith('#!') ? line.slice(2).replace(/\r$/, '').trim() : null; };
const isElf = head => head && head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;

// ---------- reading the command ----------
// Launchers start another program named in their own arguments. Each entry says how to step over the launcher's options
// to reach that program: `flags` take no value, `valued` take one (attached or next), `optional` take one only attached,
// `long` maps a long option to whether it takes a value, `positional` counts operands before the program (timeout's
// duration), `stop` means no program follows, `unknown` means Pocket cannot tell which program runs. Anything not listed
// makes the program unknown too, so a new option never slips a program past the check.
const LAUNCHERS = {
  env: { flags: 'i0v', valued: 'uC', chdir: ['C', 'chdir'], dash: true, assignments: true, unknown: { S: 'env -S', 'split-string': 'env -S' },
    long: { 'ignore-environment': 0, null: 0, unset: 1, chdir: 1, debug: 0, 'list-signal-handling': 0, 'default-signal': 0, 'ignore-signal': 0, 'block-signal': 0 } },
  timeout: { flags: 'fv', valued: 'sk', positional: 1, long: { signal: 1, 'kill-after': 1, 'preserve-status': 0, foreground: 0, verbose: 0 } },
  nice: { valued: 'n', numeric: true, long: { adjustment: 1 } },
  nohup: {},
  stdbuf: { valued: 'ioe', long: { input: 1, output: 1, error: 1 } },
  ionice: { flags: 't', valued: 'cn', stop: 'pPu', long: { class: 1, classdata: 1, ignore: 0, pid: -1, pgid: -1, uid: -1 } },
  setsid: { flags: 'cfw', long: { ctty: 0, fork: 0, wait: 0 } },
  taskset: { flags: 'ac', stop: 'p', positional: 1, long: { 'all-tasks': 0, 'cpu-list': 0, pid: -1 } },
  chrt: { flags: 'abdfiormRv', valued: 'TPD', stop: 'p', positional: 1, long: { all: 0, batch: 0, deadline: 0, fifo: 0, idle: 0, other: 0, rr: 0, 'reset-on-fork': 0, max: -1, verbose: 0, sched_runtime: 1, sched_period: 1, sched_deadline: 1, pid: -1 } },
  time: { flags: 'apqvV', valued: 'fo', long: { format: 1, output: 1, append: 0, portability: 0, quiet: 0, verbose: 0 } },
  xargs: { flags: '0prtxo', valued: 'adEILnPs', optional: 'eil', fallback: 'echo', fdUnsafe: true,
    long: { null: 0, 'arg-file': 1, delimiter: 1, eof: 0, replace: 0, 'max-lines': 0, 'max-args': 1, 'max-procs': 1, interactive: 0, 'process-slot-var': 1, 'no-run-if-empty': 0, 'max-chars': 1, verbose: 0, 'show-limits': 0, exit: 0, 'open-tty': 0 } },
  // sudo closes inherited files and looks a bare name up on its own secure_path: the program is handed to it by full path.
  sudo: { flags: 'AbEHknPS', valued: 'ughprtCDTUR', stop: 'elvVK', chdir: ['D', 'chdir'], assignments: true, fdUnsafe: true, unknown: { i: 'sudo -i', s: 'sudo -s', login: 'sudo -i', shell: 'sudo -s' },
    long: { askpass: 0, background: 0, 'preserve-env': 0, 'set-home': 0, 'non-interactive': 0, 'preserve-groups': 0, stdin: 0, user: 1, group: 1, host: 1, prompt: 1, role: 1, type: 1, 'close-from': 1, chdir: 1, 'command-timeout': 1, 'other-user': 1, chroot: 1, edit: -1, list: -1, validate: -1, version: -1, 'remove-timestamp': -1 } },
  doas: { flags: 'n', valued: 'uC', stop: 'L', fdUnsafe: true, unknown: { s: 'doas -s' } },
  // flock takes a lock file (or a descriptor, with no command) and then the program; -c hands it a shell command line.
  flock: { flags: 'sxenuoFv', valued: 'wE', positional: 1, fdUnsafe: true, unknown: { c: 'flock -c', command: 'flock -c' },
    long: { shared: 0, exclusive: 0, nonblock: 0, unlock: 0, close: 0, 'no-fork': 0, verbose: 0, timeout: 1, wait: 1, 'conflict-exit-code': 1, help: -1, version: -1 } },
  sshpass: { flags: 'ev', valued: 'pfdP', stop: 'hV', fdUnsafe: true },
};
// Programs that are not launchers Pocket follows but start another program, or decide what to run as they run. A request
// whose program is one of these (in the form described) is never allowed always: `refuse` says why.
//   starts:  a program from its own arguments that Pocket does not follow (a tracer, a sandbox, a session or job runner)
//   finds:   programs or files it looks for as it runs (find -exec)
//   remote:  a command on another computer (ssh host command)
//   scripts: the project's own scripts (package.json, deno.json), with the project's programs first on PATH
//   package: a package by name, fetched or from the project (npx)
//   image:   a container image (docker run): a tag can be pointed at another image at any time
const STARTS = new Set(['parallel', 'sem', 'watch', 'entr', 'nodemon', 'pm2', 'strace', 'ltrace', 'gdb', 'lldb', 'valgrind', 'perf', 'chroot', 'unshare', 'nsenter',
  'runuser', 'su', 'script', 'systemd-run', 'firejail', 'bwrap', 'proxychains', 'proxychains4', 'torsocks', 'faketime', 'setpriv', 'prlimit', 'capsh', 'busybox',
  'expect', 'unbuffer', 'tmux', 'screen', 'dbus-run-session', 'xvfb-run', 'sg', 'at', 'batch', 'chpst', 'daemonize', 'start-stop-daemon', 'catchsegv', 'tini',
  'dumb-init', 'gosu', 'su-exec', 'fakeroot', 'env-cmd', 'dotenv', 'cross-env', 'concurrently']);
// npm, pnpm and yarn run the project's scripts (and dependencies' install scripts) for most commands, with
// node_modules/.bin first on PATH; these commands run none of them.
const PKG_SAFE = new Set(['whoami', 'view', 'info', 'show', 'v', 'search', 's', 'ping', 'token', 'access', 'owner', 'dist-tag', 'dist-tags', 'deprecate',
  'unpublish', 'outdated', 'ls', 'list', 'help', 'login', 'logout', 'adduser', 'profile', 'team', 'org', 'docs', 'bugs', 'repo']);
const PKG_RUNS = new Set(['exec', 'x', 'dlx']);
// docker and podman commands that start no container and build nothing.
const DOCKER_SAFE = new Set(['login', 'logout', 'pull', 'push', 'search', 'version', 'info', 'images', 'ps', 'inspect', 'tag']);
const firstWord = (args, valued = []) => { for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--') return args[i + 1] ?? null; if (a.startsWith('-')) { if (valued.includes(a)) i++; continue; } return a; } return null; };
const SSH_FLAGS = '46AaCfGgKkMNnqsTtVvXxYy', SSH_VALUED = 'BbcDEeFIiJLlmOoPpQRSWw';
function sshRefuse(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return i + 2 < args.length ? { why: 'remote', how: 'ssh' } : null;
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (SSH_VALUED.includes(ch)) { const v = a.slice(j + 1) || args[++i] || ''; if (ch === 'o' && /^\s*(ProxyCommand|LocalCommand|PermitLocalCommand|KnownHostsCommand)\b/i.test(v)) return { why: 'starts', how: 'ssh -o ' + v.trim().split(/[\s=]/)[0] }; break; }
        if (!SSH_FLAGS.includes(ch)) return { why: 'starts', how: `ssh -${ch}` }; // an option Pocket does not know
      }
      continue;
    }
    return i + 1 < args.length ? { why: 'remote', how: 'ssh' } : null; // the destination, then a command
  }
  return null;
}
// What a program that is not an interpreter will start, when Pocket cannot pin it: { why, how } or null.
function startsOther(name, args) {
  if (STARTS.has(name)) return { why: 'starts', how: name };
  if (name === 'find' && args.some(a => /^-(exec|execdir|ok|okdir)$/.test(a))) return { why: 'finds', how: 'find -exec' };
  if (name === 'ssh') return sshRefuse(args);
  if ((name === 'rsync' || name === 'scp') && args.some(a => /^(-e|--rsh(=.*)?|-S|--rsync-path(=.*)?)$/s.test(a) || /^-e./.test(a))) return { why: 'starts', how: `${name} ${name === 'scp' ? '-S' : '-e'}` };
  if (['npx', 'pnpx', 'bunx'].includes(name)) return { why: 'package', how: name };
  if (['npm', 'pnpm', 'yarn'].includes(name)) {
    const sub = firstWord(args, ['--prefix', '-C', '-w', '--workspace', '--registry', '--userconfig', '--cwd']);
    if (sub && PKG_RUNS.has(sub)) return { why: 'package', how: `${name} ${sub}` };
    if (!sub || !PKG_SAFE.has(sub)) return { why: 'scripts', how: sub ? `${name} ${sub}` : name };
    return null;
  }
  if (['docker', 'podman', 'nerdctl'].includes(name)) {
    const sub = firstWord(args, ['-H', '--host', '-c', '--context', '--config', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey']);
    return sub && DOCKER_SAFE.has(sub) ? null : { why: 'image', how: sub ? `${name} ${sub}` : name };
  }
  return null;
}
// make reads its makefile by path: the -f files, or the first of GNUmakefile, makefile and Makefile, in the folder -C names
// (every -C applies before any makefile is read). Files the makefile includes are not followed.
function makefiles(args, dir) {
  const named = []; let code = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    const m = /^--(directory|file|makefile|eval)(?:=(.*))?$/s.exec(a);
    if (m) { const v = m[2] ?? args[++i] ?? ''; if (m[1] === 'directory') dir = path.resolve(dir, v); else if (m[1] === 'eval') code = v; else named.push(v); continue; }
    if (a.startsWith('--') || !a.startsWith('-') || a.length < 2) continue;
    for (let j = 1; j < a.length; j++) {
      const ch = a[j], rest = a.slice(j + 1);
      if ('CfIoW'.includes(ch)) { const v = rest || args[++i] || ''; if (ch === 'C') dir = path.resolve(dir, v); if (ch === 'f') named.push(v); break; }
      if ('jlO'.includes(ch)) { if (!rest && /^\d+(\.\d+)?$/.test(args[i + 1] || '')) i++; break; }
    }
  }
  const files = named.length ? named.filter(f => f !== '-').map(f => path.resolve(dir, f)) : ['GNUmakefile', 'makefile', 'Makefile'].map(f => path.join(dir, f)).filter(isFile).slice(0, 1);
  return { files, code };
}
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// The file node loads for its main script or a -r preload: the path as given, then with .js, .json or .node added (node's
// own order, checked before a folder of that name). A folder (index.js, package.json "main") is not resolved: null.
const nodeFile = p => isFile(p) ? p : ['.js', '.json', '.node'].map(x => p + x).find(isFile) || null;
// python3 -m: the module, when the working folder (sys.path[0] for -m) has it. The plain rule only: a package is a folder
// with __init__.py (it wins over a .py of the same name), a module is name.py; anything else Python could load under that
// name there (a compiled or extension module, a namespace folder, another kind of __init__) makes it uncertain. A name the
// folder does not have comes from the interpreter's own library folders, a module like any other it loads: { lib }.
const IMPORTABLE = /\.(py|pyc|pyw|so|pyd)$/;
function pyModule(dir, mod) {
  if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(mod)) return { unsure: true };
  const parts = mod.split('.'), inits = [];
  let here = dir;
  for (let n = 0; n < parts.length; n++) {
    const part = parts[n], last = n === parts.length - 1;
    let names; try { names = fs.readdirSync(here); } catch { return n ? { unsure: true } : { lib: true }; }
    const clash = names.some(x => x.startsWith(part + '.') && x !== part + '.py' && IMPORTABLE.test(x));
    const asDir = names.includes(part) && isDir(path.join(here, part)), asFile = names.includes(part + '.py') && isFile(path.join(here, part + '.py'));
    if (!n && !asDir && !asFile && !clash) return { lib: true };
    if (clash) return { unsure: true };
    if (asDir) {
      const pkg = path.join(here, part); let inner; try { inner = fs.readdirSync(pkg); } catch { return { unsure: true }; }
      const plain = base => inner.includes(base + '.py') && isFile(path.join(pkg, base + '.py')) && !inner.some(x => x.startsWith(base + '.') && x !== base + '.py' && IMPORTABLE.test(x));
      if (!plain('__init__')) return { unsure: true };
      inits.push(path.join(pkg, '__init__.py'));
      if (last) return plain('__main__') ? { file: path.join(pkg, '__main__.py'), inits } : { unsure: true };
      here = pkg; continue;
    }
    return asFile && last ? { file: path.join(here, part + '.py'), inits } : { unsure: true };
  }
  return { unsure: true };
}
// Whether the user Pocket runs as (and so an agent) can change this file, or replace it by renaming a folder above it: the
// file is writable, or a folder on its path is (a sticky folder such as /tmp only when this user owns what is below).
export function replaceable(p, uid = process.getuid?.()) {
  try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { }
  let below; try { below = fs.statSync(p); } catch { return false; }
  for (let d = path.dirname(p); ; d = path.dirname(d)) {
    let st; try { st = fs.statSync(d); } catch { return false; }
    let w = false; try { fs.accessSync(d, fs.constants.W_OK); w = true; } catch { }
    if (w && (!(st.mode & 0o1000) || below.uid === uid)) return true;
    below = st;
    if (path.dirname(d) === d) return false;
  }
}
function stepOver(name, spec, args) {
  let i = 0, chdir = null;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { i++; break; }
    if (spec.dash && a === '-') continue;
    if (spec.numeric && /^-\d+$/.test(a)) continue;
    if (a.startsWith('--')) {
      const m = /^--([^=]+)(=(.*))?$/s.exec(a), n = m?.[1];
      if (!m) return { unknown: `${name} ${a}` };
      if (spec.unknown?.[n]) return { unknown: spec.unknown[n] };
      if (!(n in (spec.long || {}))) return { unknown: `${name} --${n}` };
      if (spec.long[n] === -1) return { none: true };
      let v = m[3]; if (spec.long[n] === 1 && m[2] === undefined) v = args[++i];
      if (spec.chdir?.[1] === n) chdir = v;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (spec.unknown?.[ch]) return { unknown: spec.unknown[ch] };
        if (spec.stop?.includes(ch)) return { none: true };
        if (spec.valued?.includes(ch)) { const v = a.slice(j + 1) || args[++i]; if (spec.chdir?.[0] === ch) chdir = v; break; }
        if (spec.optional?.includes(ch)) break;
        if (spec.flags?.includes(ch)) continue;
        return { unknown: `${name} -${ch}` };
      }
      continue;
    }
    break;
  }
  if (spec.assignments) for (; i < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[i]); i++) if (/^PATH=/.test(args[i])) return { unknown: `${name} PATH=` };
  i += spec.positional || 0;
  if (i >= args.length) return spec.fallback ? { fallback: spec.fallback } : { none: true };
  return { index: i, chdir };
}

// Interpreters: where the script is in their arguments, and whether the code is given inline instead.
const SHELLS = /^(sh|dash|bash|ash|ksh|ksh93|mksh|zsh|yash|fish)$/;
const COPY_SHELLS = /^(sh|dash|bash|ash|ksh|ksh93|mksh)$/; // run from a private copy; $0 names the copy, so a script that reads $0 runs from its path
const SELF_REF = /\$\{?0|BASH_SOURCE|BASH_ARGV0/;
const familyOf = name => {
  const n = String(name || '').toLowerCase();
  if (SHELLS.test(n)) return 'shell';
  if (/^(python|pypy)(\d+(\.\d+)*)?$/.test(n)) return 'python';
  if (/^(node|nodejs|bun)$/.test(n)) return 'node';
  if (/^perl(\d+(\.\d+)*)?$/.test(n)) return 'perl';
  if (/^ruby(\d+(\.\d+)*)?$/.test(n)) return 'ruby';
  if (/^php(\d+(\.\d+)*)?(-cli)?$/.test(n)) return 'php';
  if (/^(awk|gawk|mawk|nawk)$/.test(n)) return 'awk';
  if (/^(pwsh|powershell)$/.test(n)) return 'pwsh';
  if (n === 'deno') return 'deno';
  if (/^(lua(\d+(\.\d+)*)?|luajit|osascript|rscript)$/.test(n)) return 'eflag';
  return null;
};
const NODE_VALUED = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type', '--env-file', '--env-file-if-exists', '--inspect-port', '--debug-port', '--title', '--redirect-warnings', '--openssl-config', '--icu-data-dir', '--disable-warning', '--watch-path', '--test-name-pattern', '--test-reporter', '--test-reporter-destination', '--experimental-config-file']);
// → { script } (an index into args), { code, how } (inline code), { module, safe } (python3 -m), { refuse } (a form Pocket
// cannot pin), or {} (no script: the interpreter reads standard input, which is empty in the Vault, or what a launcher such
// as xargs appends). Node's `preload` lists the -r/--import values: { k } (an index into args) or { v }, and `cjs`.
function interpreterArgs(fam, name, args) {
  const preload = [], withPre = r => fam === 'node' ? { ...r, preload } : r;
  let safe = false, sub = null;
  const live = a => /^--(watch|watch-path|watch-preserve-output|watch-hmr|hot|inspect|inspect-brk|inspect-wait)(=|$)/.test(a);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (fam === 'shell') {
      if (a === '--' || a === '-') return i + 1 < args.length ? { script: i + 1 } : {};
      if (a.startsWith('--')) { if (a === '--rcfile' || a === '--init-file') i++; continue; }
      if (/^[-+]./.test(a)) {
        const cl = a.slice(1);
        if (a[0] === '-' && cl.includes('c')) { const at = args.slice(i + 1).findIndex(x => !/^[-+]./.test(x) || x === '--'); const k = at < 0 ? -1 : i + 1 + at + (args[i + 1 + at] === '--' ? 1 : 0); return k >= 0 && k < args.length ? { code: args[k], how: `${name} -c` } : {}; }
        if (a[0] === '-' && cl.includes('s')) return {};
        if (/[oO]/.test(cl)) i++;
        continue;
      }
      return { script: i };
    }
    if (fam === 'python') {
      if (a === '-') return {};
      if (a === '--') return i + 1 < args.length ? { script: i + 1 } : {};
      if (a.startsWith('--')) { if (a === '--check-hash-based-pycs') i++; continue; }
      if (a.startsWith('-') && a.length > 1) {
        for (let j = 1; j < a.length; j++) {
          const ch = a[j], rest = a.slice(j + 1);
          if (ch === 'c') return { code: rest || args[i + 1] || '', how: `${name} -c` };
          if (ch === 'I' || ch === 'P') safe = true; // the working folder is not searched for modules
          if (ch === 'm') return { module: rest || args[i + 1] || '', safe };
          if (ch === 'W' || ch === 'X') { if (!rest) i++; break; }
        }
        continue;
      }
      return { script: i };
    }
    if (fam === 'node') {
      if (live(a)) return { refuse: { why: 'live', how: `${name} ${a.split('=')[0]}` } };
      if (name === 'bun') {
        // bun run <file>, bun <file>; any other word is a package.json script, a package's program or a bun command.
        if (!sub && a === 'run') { sub = a; continue; }
        if (!sub && a === 'test') return { refuse: { why: 'finds', how: 'bun test' } };
        if (!sub && a === 'x') return { refuse: { why: 'package', how: 'bun x' } };
        if (a === '--cwd' || a.startsWith('--cwd=')) return { refuse: { why: 'script', how: 'bun --cwd' } };
      }
      if (a === '-') return withPre({});
      if (a === '--') return withPre(i + 1 < args.length ? { script: i + 1 } : {});
      if (/^(-e|--eval|-p|--print|-pe|-ep)$/.test(a)) return withPre({ code: args[i + 1] || '', how: `${name} ${a}` });
      const m = /^--(eval|print)=(.*)$/s.exec(a); if (m) return withPre({ code: m[2], how: `${name} --${m[1]}` });
      if (a === '--test' || a.startsWith('--test=')) return { refuse: { why: 'finds', how: `${name} --test` } };
      if (a === '--run' || a.startsWith('--run=')) return { refuse: { why: 'scripts', how: `${name} --run` } };
      if (/^(-r|--require|--import|--loader|--experimental-loader|--preload)$/.test(a)) { preload.push({ k: i + 1, cjs: (a === '-r' || a === '--require') && name !== 'bun', flag: a }); i++; continue; }
      const pm = /^--(require|import|loader|experimental-loader|preload)=(.*)$/s.exec(a); if (pm) { preload.push({ v: pm[2], cjs: pm[1] === 'require' && name !== 'bun', flag: `--${pm[1]}` }); continue; }
      if (a.startsWith('-')) { if (NODE_VALUED.has(a)) i++; continue; }
      return withPre({ script: i });
    }
    if (fam === 'perl') {
      if (a === '--') return i + 1 < args.length ? { script: i + 1 } : {};
      if (a === '-') return {};
      if (a.startsWith('-') && a.length > 1) {
        for (let j = 1; j < a.length; j++) {
          const ch = a[j];
          if (ch === 'e' || ch === 'E') return { code: a.slice(j + 1) || args[i + 1] || '', how: `${name} -${ch}` };
          if ('IMmxidDC0lV'.includes(ch)) break; // the rest of the cluster is this switch's value
        }
        continue;
      }
      return { script: i };
    }
    if (fam === 'ruby') {
      if (a === '--') return i + 1 < args.length ? { script: i + 1 } : {};
      if (a === '-e' || (a.startsWith('-e') && a.length > 2)) return { code: a.length > 2 ? a.slice(2) : args[i + 1] || '', how: `${name} -e` };
      if (a.startsWith('-')) { if (['-I', '-r', '-C', '-E'].includes(a)) i++; continue; }
      return { script: i };
    }
    if (fam === 'php') {
      if (['-r', '-B', '-R', '-F', '-E'].includes(a)) return { code: args[i + 1] || '', how: `${name} ${a}` };
      if (a === '-f') return i + 1 < args.length ? { script: i + 1 } : {};
      if (a.startsWith('-')) { if (['-c', '-d', '-z', '-t'].includes(a)) i++; continue; }
      return { script: i };
    }
    if (fam === 'awk') {
      if (a === '-f' || a === '--file' || a === '-E' || a === '--exec') return i + 1 < args.length ? { script: i + 1 } : {};
      if (/^--(file|exec)=/.test(a) || /^-f./.test(a)) return {};
      if (a === '--') return i + 1 < args.length ? { code: args[i + 1], how: `${name} program` } : {};
      if (a.startsWith('-')) { if (['-F', '-v', '-i', '-l', '--field-separator', '--assign', '--include', '--load'].includes(a)) i++; continue; }
      return { code: a, how: `${name} program` };
    }
    if (fam === 'pwsh') {
      const l = a.toLowerCase();
      if (['-c', '-command', '-e', '-ec', '-encodedcommand'].includes(l)) return { code: args[i + 1] || '', how: `${name} ${a}` };
      if (l === '-f' || l === '-file') return i + 1 < args.length ? { script: i + 1 } : {};
      if (a.startsWith('-')) continue;
      return { script: i };
    }
    if (fam === 'deno') {
      // deno run|serve [options] <script>, deno <script>, deno eval <code>; other commands run tasks, tests or packages.
      if (live(a)) return { refuse: { why: 'live', how: `deno ${a.split('=')[0]}` } };
      if (a.startsWith('-')) { if (sub && ['-c', '--config', '--import-map', '--cert', '--location', '--seed', '--ext', '-L', '--log-level'].includes(a)) i++; continue; }
      if (sub) return { script: i };
      if (a === 'eval') return { code: args[i + 1] || '', how: 'deno eval' };
      if (a === 'run' || a === 'serve') { sub = a; continue; }
      if (a === 'task') return { refuse: { why: 'scripts', how: 'deno task' } };
      if (a === 'x') return { refuse: { why: 'package', how: 'deno x' } };
      if (a === 'test' || a === 'bench') return { refuse: { why: 'finds', how: `deno ${a}` } };
      return /[./]/.test(a) ? { script: i } : { refuse: { why: 'script', how: `deno ${a}` } };
    }
    if (fam === 'eflag') { if (a === '-e') return { code: args[i + 1] || '', how: `${name} -e` }; if (a.startsWith('-')) continue; return { script: i }; }
  }
  return withPre({});
}
// Words of inline code that might name a file in the working folder (`sh deploy.sh` inside `sh -c`).
const codeWords = code => String(code).split(/[\s;|&()<>`"'{}$=,]+/).filter(t => t && !t.startsWith('-') && t.length <= 4096).slice(0, PIN_LIMITS.tokens);

// ---------- the pin ----------
// prepareRun opens and hashes everything the command runs and returns { pin, verify(), close() }; with { forRun: true }
// it also says how to start it: { file, args, argv0, fds }. pinCommand is the pin alone, every handle closed.
export async function prepareRun({ argv, cwd }, { PATH, forRun = false, tmpDir = os.tmpdir() } = {}) {
  const opened = [], fds = []; // fds: { fd, copy } handed to the child as fd 3, 4, …; a copy's fd is ours to close
  const plan = { pin: null, file: null, args: argv.slice(1), argv0: argv[0], fds: [],
    verify: () => verifyOpened(opened), close: () => { for (const o of opened) if (o.fh) { o.fh.close().catch(() => {}); o.fh = null; } for (const fd of fds.splice(0)) if (fd.copy) try { fs.closeSync(fd.fd); } catch { } } };
  try {
    const files = [], seen = new Map(), skip = new Set();
    let inline = null, unknown = null, fdSafe = true;
    // One file into the pin (once per path; a later role never replaces an earlier one).
    const add = async (role, p, { nonRegular = false } = {}) => {
      if (seen.has(p)) return seen.get(p);
      const o = await openFile(p);
      if (!o) return null;
      if (o.kind) { if (nonRegular) { const e = { role, path: p, kind: o.kind }; files.push(e); seen.set(p, { entry: e }); } return null; }
      const entry = o.sha256 ? { role, path: p, sha256: o.sha256 } : { role, path: p, why: o.why, stamp: o.stamp };
      files.push(entry); const rec = { entry, ...o, path: p }; opened.push(rec); seen.set(p, rec); return rec;
    };
    const resolveIn = (dir, name) => name.includes('/') ? (runnable(path.resolve(dir, name)) ? path.resolve(dir, name) : null) : findProgram(name, dir, PATH);
    const program = findProgram(argv[0], cwd, PATH);
    if (!program) throw fail(`${argv[0]} was not found${argv[0].includes('/') ? '' : ' on the Vault\'s PATH'}, or is not executable.`, 400, { code: 'not_found' });
    const top = await add('program', program);
    // The program's #! line: the interpreter, and for `#!/usr/bin/env x` the x that PATH finds.
    const bang = async (rec, dir) => {
      const line = shebangOf(rec?.head); if (!line) return null;
      const t = line.split(/\s+/).filter(Boolean); if (!t[0] || !path.isAbsolute(t[0])) return null;
      await add('interpreter', t[0]);
      let name = path.basename(t[0]);
      if (name === 'env') { name = t.slice(1).find(x => !x.startsWith('-') && !x.includes('=')) || ''; const found = name && findProgram(name, dir, PATH); if (found) await add('interpreter', found); }
      const sp = line.search(/\s/);
      return { interp: t[0], arg: sp < 0 ? null : line.slice(sp).trim() || null, name };
    };
    // Launchers, outermost first: each step finds the program it starts and pins it.
    let at = 0, dir = cwd, cur = program, rec = top;
    const rewrite = new Map(); // argv index → the full path the launcher is handed
    for (let depth = 0; ; depth++) {
      const spec = LAUNCHERS[path.basename(cur)];
      if (!spec) break;
      await bang(rec, dir); // a launcher that is itself a script: its interpreter too
      if (depth >= PIN_LIMITS.depth) { unknown = 'launchers inside launchers'; break; }
      if (spec.fdUnsafe) fdSafe = false;
      const s = stepOver(path.basename(cur), spec, argv.slice(at + 1));
      if (s.unknown) { unknown = s.unknown; break; }
      if (s.none) { at = argv.length; break; }
      if (s.chdir) dir = path.resolve(dir, s.chdir);
      if (s.fallback) { const f = findProgram(s.fallback, dir, PATH); if (f) await add('launched', f); at = argv.length; cur = null; break; }
      const k = at + 1 + s.index, found = resolveIn(dir, argv[k]);
      if (!found) throw fail(`${argv[k]} (started by ${path.basename(cur)}) was not found${argv[k].includes('/') ? '' : ' on the Vault\'s PATH'}, or is not executable.`, 400, { code: 'not_found' });
      if (!argv[k].includes('/') || spec === LAUNCHERS.sudo || spec === LAUNCHERS.doas) rewrite.set(k, found);
      skip.add(k); rec = await add('launched', found); at = k; cur = found;
    }
    // The program that finally runs: a #! script, or an interpreter with a script, a module or inline code. What Pocket
    // cannot pin becomes `refuse`: such a command is never allowed always, and the request says why.
    let script = null, scriptFam = null, scriptBang = null, refuse = null;
    const makes = [];
    if (cur && !unknown && at < argv.length) {
      const name = path.basename(cur), args = argv.slice(at + 1);
      const b = await bang(rec, dir);
      if (b) { script = { index: at, rec }; scriptFam = familyOf(b.name); scriptBang = b; }
      refuse = startsOther(name, args);
      const fam = familyOf(name);
      const r = refuse || b || !fam ? {} : interpreterArgs(fam, name, args);
      if (r.refuse) refuse = r.refuse;
      else if (r.code !== undefined) {
        inline = r.how;
        for (const w of codeWords(r.code)) { const p = path.resolve(dir, w); if (!seen.has(p)) await add('argument', p); }
      } else if (r.module !== undefined) {
        // python3 -m: the module file from the working folder; one from the interpreter's library is not pinned.
        const m = r.safe ? { lib: true } : pyModule(dir, r.module);
        if (m.unsure) refuse = { why: 'script', how: `${name} -m ${r.module}`.trim() };
        else if (m.file) { script = { index: -1, rec: await add('script', m.file) }; scriptFam = fam; for (const f of m.inits) await add('module', f); }
      } else if (r.script !== undefined) {
        const k = at + 1 + r.script, given = argv[k];
        let p = path.resolve(dir, given);
        if (fam === 'node' && name !== 'bun') p = nodeFile(p) || p; // `node job` loads job.js when there is no file named job
        skip.add(k);
        if (/^[a-z][a-z0-9+.-]+:/i.test(given)) refuse = { why: 'web', how: name }; // a web address, npm:, jsr:, data:
        else {
          script = { index: k, rec: await add('script', p, { nonRegular: true }) }; scriptFam = fam;
          if (!script.rec && !seen.has(p)) refuse = name === 'bun' ? { why: 'scripts', how: `bun ${given}` } : { why: 'script', how: name };
        }
      } else if (fam && !b && !refuse) refuse = { why: 'script', how: name }; // no script it names: it would read one Pocket cannot see
      // Node's -r/--import (bun's --preload): a file given by path is pinned (a -r path as node resolves it); a package by name
      // is a module node loads, like an import inside the script.
      for (const pre of r.preload || []) {
        const v = pre.v ?? argv[at + 1 + pre.k] ?? '';
        if (pre.k !== undefined) skip.add(at + 1 + pre.k);
        if (!/^(\.{0,2}\/|file:)/.test(v)) continue;
        const p = v.startsWith('file:') ? (() => { try { return fileURLToPath(v); } catch { return ''; } })() : path.resolve(dir, v);
        const f = p && (pre.cjs ? nodeFile(p) : isFile(p) ? p : null);
        if (f) await add('module', f); else refuse = refuse || { why: 'script', how: `${name} ${pre.flag}` };
      }
      if (!refuse && (name === 'make' || name === 'gmake')) {
        const mk = makefiles(args, dir);
        if (mk.code !== null) inline = `${name} --eval`;
        for (const f of mk.files) { const rec2 = await add('script', f, { nonRegular: true }); if (rec2?.entry) makes.push(rec2.entry); }
      }
    }
    // Every other argument that names an existing regular file, wherever it is, and the value of a --flag=file or a
    // NAME=file argument (make SHELL=./x, git -c core.sshCommand=./x).
    for (let k = 1; k < argv.length; k++) {
      if (skip.has(k)) continue;
      for (const x of [argv[k], /^--?[\w-]+=(.+)$/s.exec(argv[k])?.[1], /^[A-Za-z_][\w.-]*=(.+)$/s.exec(argv[k])?.[1]]) if (x && !x.startsWith('-')) await add('argument', path.resolve(k > at ? dir : cwd, x));
    }
    // A shell script runs from a private copy of the checked bytes (below). Any other script, and a makefile, is opened by
    // its path as the command starts: the card says so when an agent could change it or a folder above it.
    const copied = Boolean(FD_RUN && fdSafe && script?.rec?.bytes && COPY_SHELLS.test(scriptBang ? scriptBang.name : path.basename(cur || '')) && !SELF_REF.test(script.rec.bytes.toString('latin1')));
    for (const e of [...(script?.rec?.entry && !copied ? [script.rec.entry] : []), ...makes]) if (!e.kind && replaceable(e.path)) e.writable = true;
    plan.pin = { v: PIN_VERSION, program, files, ...(inline ? { inline } : {}), ...(unknown ? { unknown } : {}), ...(refuse ? { refuse } : {}) };
    if (!forRun) return plan;
    // How to start it. Linux only; elsewhere every file is checked again just before the start instead.
    const out = [...argv];
    for (const [k, p] of rewrite) out[k] = p;
    let file = program, argv0 = argv[0];
    const fdPath = fd => `/proc/self/fd/${3 + fds.indexOf(fd)}`;
    const copyOf = bytes => {
      const d = fs.mkdtempSync(path.join(tmpDir, 'pocket-vault-')), f = path.join(d, 's');
      try { fs.writeFileSync(f, bytes, { mode: 0o400, flag: 'wx' }); const fd = { fd: fs.openSync(f, 'r'), copy: true }; fds.push(fd); return fdPath(fd); }
      finally { fs.rmSync(f, { force: true }); fs.rmSync(d, { recursive: true, force: true }); }
    };
    if (copied) {
      if (scriptBang) {
        // The program is a shell script: start its interpreter as the kernel would, with the copy as the script.
        const copy = copyOf(script.rec.bytes), parts = [scriptBang.interp, ...(scriptBang.arg ? [scriptBang.arg] : []), copy];
        out.splice(script.index, 1, ...parts);
        if (script.index === 0) { file = scriptBang.interp; argv0 = scriptBang.interp; }
      } else out[script.index] = copyOf(script.rec.bytes);
    }
    // A native program (not set-user-ID) starts from the handle that was hashed.
    if (FD_RUN && file === program && top?.fh && isElf(top.head) && !(Number(top.st.mode) & 0o6000)) { const fd = { fd: top.fh.fd, copy: false }; fds.push(fd); file = fdPath(fd); }
    Object.assign(plan, { file, args: out.slice(1), argv0, fds: fds.map(f => f.fd) });
    return plan;
  } catch (e) { plan.close(); throw e; }
}
export async function pinCommand(cmd, opts = {}) { const p = await prepareRun(cmd, { ...opts, forRun: false }); p.close(); return p.pin; }

// Just before the start, synchronously: every pinned file still has the content that was hashed. The open handle must be
// unchanged (size and times; a small file byte for byte), and its path must still lead to that same file; a file that
// could not be hashed must still have its size and times. Throws, naming the file, when anything differs.
function verifyOpened(opened) {
  for (const o of opened) {
    const changed = () => fail(`${o.path} changed just before the command started; nothing ran. Run it again.`, 409, { code: 'request_stale', changedPath: o.path });
    let ps; try { ps = fs.statSync(o.path, { bigint: true }); } catch { throw changed(); }
    if (!o.fh) { if (!ps.isFile() || JSON.stringify(stampOf(ps)) !== JSON.stringify(o.stamp)) throw changed(); continue; }
    const st = fs.fstatSync(o.fh.fd, { bigint: true });
    if (statKey(st) !== o.key || ps.dev !== st.dev || ps.ino !== st.ino) throw changed();
    if (o.bytes && !readIntoSync(o.fh.fd, Buffer.alloc(o.bytes.length + 1)).equals(o.bytes)) throw changed();
  }
}

// ---------- comparing pins ----------
// What differs between a saved pin (a recipe's, or a request's) and the pin of the command now: [] when they agree, else
// [{ path, how }] with how 'program' (another program is found), 'changed', 'new' (a file the command names exists now)
// or 'gone'. An argument the recipe marks as data is not compared. A file that could not be hashed compares by its size
// and times; a script that is not a regular file compares by its kind.
const sameFile = (f, g) => f.sha256 ? f.sha256 === g.sha256 : f.stamp ? !g.sha256 && Boolean(g.stamp) && f.stamp.size === g.stamp.size && f.stamp.mtime === g.stamp.mtime && f.stamp.ctime === g.stamp.ctime : f.kind ? f.kind === g.kind : false;
export function pinDiff(saved, now) {
  if (!saved || !now || !Array.isArray(saved.files) || !Array.isArray(now.files)) return saved || now ? [{ path: '', how: 'unpinned' }] : [];
  const out = [], data = new Set(saved.files.filter(f => f?.data).map(f => f.path));
  if (saved.program !== now.program) out.push({ path: now.program, how: 'program', was: saved.program });
  const a = new Map(saved.files.filter(f => f && !data.has(f.path)).map(f => [f.path, f])), b = new Map(now.files.filter(f => f && !data.has(f.path)).map(f => [f.path, f]));
  const programs = new Set([saved.program, now.program]);
  for (const [p, f] of a) { const g = b.get(p); if (!g) { if (!programs.has(p) || !out.length) out.push({ path: p, how: 'gone' }); } else if (!sameFile(f, g)) out.push({ path: p, how: 'changed' }); }
  for (const p of b.keys()) if (!a.has(p) && !(programs.has(p) && out[0]?.how === 'program')) out.push({ path: p, how: 'new' });
  return out;
}
// The pin as one comparable string (kept for callers that compare pins as text); null when there is none.
export function pinKey(pin) {
  if (!pin || !Array.isArray(pin.files) || !pin.files.length) return null;
  return JSON.stringify([pin.program, pin.files.filter(f => !f.data).map(f => [f.path, f.sha256 || f.stamp || f.kind || null])]);
}
// A recipe's pin with these argument paths marked as data (their content is not compared).
export function withData(pin, paths) {
  const want = new Set(paths); if (!pin || !want.size) return pin;
  const files = pin.files.map(f => want.has(f.path) && f.role === 'argument' ? { role: f.role, path: f.path, data: true } : f);
  for (const p of want) if (!files.some(f => f.path === p)) files.push({ role: 'argument', path: p, data: true });
  return { ...pin, files };
}
// What the owner's card needs about a pin: the files checked (no hashes), what cannot be checked, the program a launcher
// starts, why Always allow is not offered, and which script an agent could swap as the command starts.
export function pinView(pin) {
  if (!pin || !Array.isArray(pin.files)) return {};
  const files = pin.files.map(f => ({ path: f.path, role: f.role, ...(f.why ? { why: f.why } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.data ? { data: true } : {}), ...(f.writable ? { writable: true } : {}) }));
  const launched = pin.files.filter(f => f.role === 'launched').map(f => f.path);
  return { files, ...(launched.length ? { runs: launched.at(-1) } : {}), ...(pin.inline ? { inline: pin.inline } : {}), ...(pin.unknown ? { unknown: pin.unknown } : {}), ...(pin.refuse ? { refuse: { why: pin.refuse.why, how: pin.refuse.how } } : {}) };
}
