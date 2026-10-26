// Keeps the manual (docs/manual) in step with the code. Every manual page, and any other doc that opts in, opens with
//   <!-- manual
//   checked: 1.79.2
//   sources: vault.mjs, public/vault.js, scripts/pocket-vault.mjs, skills/pocket-vault/SKILL.md
//   -->
// `checked` is the release the page was last verified against; `sources` are the files whose changes can make it wrong.
//
// Structure (no git needed; check:release runs it): every page has the block, its version is a released one no newer
// than the checkout, its sources exist, the index links it, and links into the manual point at headings that exist.
// Drift (git): a page is behind when one of its sources changed after the page last did.
//   node scripts/check-manual.mjs                     every page that is behind, with the commits since
//   node scripts/check-manual.mjs --base origin/main  only what this branch changed (the pull request check)
//   --strict exits 1 when a page is behind; --github prints the findings as Actions warnings.
// Fix a page that is behind by updating it, or by re-checking it and raising `checked`: any change to the page clears it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MANUAL = 'docs/manual';
export const INDEX = 'docs/manual/README.md';

export function parseMeta(text) {
  const m = text.match(/^<!-- manual\n([\s\S]*?)\n-->/);
  if (!m) return null;
  const field = name => m[1].match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1].trim() ?? '';
  return { checked: field('checked'), sources: field('sources').split(',').map(s => s.trim()).filter(Boolean) };
}

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered.
export const slug = heading => heading.replace(/<[^>]+>/g, '').toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
export function anchors(text) {
  const seen = new Map(), out = new Set();
  for (const [, h] of text.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(h), n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const cmp = (a, b) => { const x = a.split(/[.-]/).map(Number), y = b.split(/[.-]/).map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []) : [];

// Every doc under docs/ that carries the block; manual pages must carry it (the index excepted).
export function pages(root) {
  const out = [], problems = [];
  for (const file of walk(path.join(root, 'docs'))) {
    const rel = path.relative(root, file).split(path.sep).join('/'), meta = parseMeta(fs.readFileSync(file, 'utf8'));
    if (meta) out.push({ file: rel, ...meta });
    else if (rel.startsWith(MANUAL + '/') && rel !== INDEX) problems.push(`${rel}: no <!-- manual --> block`);
  }
  return { pages: out.sort((a, b) => a.file.localeCompare(b.file)), problems };
}

export function checkStructure(root) {
  const { pages: list, problems } = pages(root);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const released = [...fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').matchAll(/^## \[([^\]]+)\]/gm)].map(m => m[1]);
  const index = fs.existsSync(path.join(root, INDEX)) ? fs.readFileSync(path.join(root, INDEX), 'utf8') : null;
  if (list.some(p => p.file.startsWith(MANUAL + '/')) && index === null) problems.push(`${INDEX} is missing`);
  for (const p of list) {
    if (!/^\d+\.\d+\.\d+$/.test(p.checked)) problems.push(`${p.file}: checked "${p.checked}" is not a version`);
    else if (!released.includes(p.checked)) problems.push(`${p.file}: checked ${p.checked} is not in CHANGELOG.md`);
    else if (cmp(p.checked, version) > 0) problems.push(`${p.file}: checked ${p.checked} is newer than this checkout (${version})`);
    if (!p.sources.length) problems.push(`${p.file}: no sources`);
    for (const s of p.sources) if (!fs.existsSync(path.join(root, s))) problems.push(`${p.file}: source ${s} does not exist`);
    if (index !== null && p.file.startsWith(MANUAL + '/') && !index.includes(`](${path.posix.relative(MANUAL, p.file)}`)) problems.push(`${INDEX} does not link ${p.file}`);
  }
  // Anchors: any Markdown link in the repository that points into the manual must name a heading that exists.
  const docs = [...fs.readdirSync(root).filter(n => n.endsWith('.md')).map(n => path.join(root, n)), ...walk(path.join(root, 'docs')), ...walk(path.join(root, 'skills'))];
  for (const file of docs) {
    const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^[a-z][\w+.-]*:|^\/\//i.test(target)) continue;
      const [rel, hash] = target.split('#');
      const dest = rel ? path.resolve(path.dirname(file), decodeURIComponent(rel)) : file;
      if (hash === undefined || !path.relative(path.join(root, MANUAL), dest).match(/^[^.][^/]*\.md$/) || !fs.existsSync(dest)) continue;
      if (!anchors(fs.readFileSync(dest, 'utf8')).has(decodeURIComponent(hash))) problems.push(`${path.relative(root, file)}: link ${target} names no heading in ${path.relative(root, dest)}`);
    }
  }
  const behind = list.map(p => released.indexOf(p.checked)).filter(n => n >= 0);
  return { pages: list, problems, version, oldest: behind.length ? Math.max(...behind) : 0 };
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const under = (file, source) => source.endsWith('/') ? file.startsWith(source) : file === source;

// Pages whose sources moved on without them. base: compare this branch with its merge base instead of each page's last commit.
export function drift(root, list, { base } = {}) {
  try { git(root, 'rev-parse', '--is-inside-work-tree'); } catch { return { skipped: 'not a git checkout' }; }
  const out = [];
  if (base) {
    let mb;
    try { mb = git(root, 'merge-base', base, 'HEAD'); } catch { return { skipped: `no merge base with ${base} (a shallow clone needs fetch-depth: 0)` }; }
    const changed = git(root, 'diff', '--name-only', mb).split('\n').filter(Boolean);
    for (const p of list) {
      if (changed.includes(p.file)) continue;
      const hit = changed.filter(f => p.sources.some(s => under(f, s)));
      if (hit.length) out.push({ ...p, changed: hit, commits: [] });
    }
    return { behind: out };
  }
  for (const p of list) {
    if (git(root, 'status', '--porcelain', '--', p.file)) continue; // being edited now
    const since = git(root, 'log', '-1', '--format=%H', '--', p.file);
    if (!since) continue; // new, not committed yet
    const commits = git(root, 'log', '--no-merges', '--format=%h %s', `${since}..HEAD`, '--', ...p.sources).split('\n').filter(Boolean);
    const dirty = git(root, 'status', '--porcelain', '--', ...p.sources).split('\n').filter(Boolean).map(l => l.slice(3));
    const changed = [...new Set([...git(root, 'diff', '--name-only', since, '--', ...p.sources).split('\n').filter(Boolean), ...dirty])];
    if (changed.length) out.push({ ...p, changed, commits });
  }
  return { behind: out };
}

function main(argv) {
  const root = path.resolve(import.meta.dirname, '..');
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const github = argv.includes('--github'), strict = argv.includes('--strict');
  const s = checkStructure(root);
  if (s.problems.length) { for (const p of s.problems) console.error('Manual: ' + p); process.exitCode = 1; return; }
  console.log(`Manual: ${s.pages.length} pages; the oldest was checked ${s.oldest} release${s.oldest === 1 ? '' : 's'} before ${s.version}.`);
  const d = drift(root, s.pages, { base: opt('--base') });
  if (d.skipped) { console.log(`Manual drift not checked: ${d.skipped}.`); return; }
  for (const p of d.behind) {
    const why = `${p.changed.join(', ')} changed${p.commits.length ? ` in ${p.commits.length} commit${p.commits.length === 1 ? '' : 's'}` : ''} since this page (checked ${p.checked}). Update it, or re-check it and raise "checked".`;
    if (github) console.log(`::warning file=${p.file},line=1,title=Manual page may be out of date::${why}`);
    console.log(`Behind: ${p.file}\n  ${why}${p.commits.slice(0, 8).map(c => '\n    ' + c).join('')}${p.commits.length > 8 ? `\n    … ${p.commits.length - 8} more` : ''}`);
  }
  if (!d.behind.length) console.log('Manual drift: every page is current with its sources.');
  else if (strict) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
