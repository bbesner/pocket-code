// PM2 definition for Pocket Code. Start with: pm2 start ecosystem.config.cjs
// The process keeps its original name, pocket-claude, so existing installs upgrade in place.
// treekill:false preserves detached Claude runners and Codex app-servers across
// daemon restarts. Close session processes explicitly before uninstalling the service.
//
// PATH: a restart through this file gives the daemon the environment of the shell that ran
// it (PM2 applies --update-env to ecosystem restarts), and every Claude Code or Codex session
// Pocket starts inherits that PATH. A deploy over ssh, or from an agent's own shell, is not a
// login shell: the user's bin directories drop off, and an MCP server registered by bare name
// (memstem, installed by pipx into ~/.local/bin) fails with ENOENT while the daemon looks
// healthy (Damon's server, 2026-10-05 → 2026-10-16). userPath() appends the standard user bin
// directories that exist, and the directory of the node running PM2, so the agents' PATH no
// longer depends on who restarted the daemon. Current entries keep their order; nothing is shadowed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function userPath(current = process.env.PATH || '', { home = os.homedir(), execPath = process.execPath, exists = fs.existsSync } = {}) {
  const have = current.split(path.delimiter).filter(Boolean);
  const want = [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, 'bin'), path.dirname(execPath)];
  const add = want.filter((d, i) => want.indexOf(d) === i && !have.includes(d) && exists(d));
  return [...have, ...add].join(path.delimiter);
}

module.exports = {
  apps: [{
    name: 'pocket-claude',
    script: 'server.mjs',
    cwd: __dirname, // path-agnostic: works from wherever the repo is checked out
    treekill: false,
    env: { PATH: userPath() },
  }],
};
// For the tests only; PM2 enumerates module.exports and must see nothing but apps.
Object.defineProperty(module.exports, 'userPath', { value: userPath, enumerable: false });
