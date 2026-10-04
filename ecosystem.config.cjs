// PM2 definition for Pocket Code. Start with: pm2 start ecosystem.config.cjs
// The process keeps its original name, pocket-claude, so existing installs upgrade in place.
// treekill:false preserves detached Claude runners and Codex app-servers across
// daemon restarts. Close session processes explicitly before uninstalling the service.
module.exports = {
  apps: [{
    name: 'pocket-claude',
    script: 'server.mjs',
    cwd: __dirname, // path-agnostic: works from wherever the repo is checked out
    treekill: false,
  }],
};
