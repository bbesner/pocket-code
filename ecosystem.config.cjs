// PM2 definition for Pocket Code. Start with: pm2 start ecosystem.config.cjs
// The process keeps its original name, pocket-claude, so existing installs upgrade in place.
// treekill:false is REQUIRED — turns are detached `claude -p` children that must
// survive a server restart (a turn that restarts this service would otherwise kill itself).
module.exports = {
  apps: [{
    name: 'pocket-claude',
    script: 'server.mjs',
    cwd: __dirname, // path-agnostic: works from wherever the repo is checked out
    treekill: false,
  }],
};
