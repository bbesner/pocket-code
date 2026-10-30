#!/usr/bin/env node
// Casey 1.88.1 procB fixture: fake-claude.mjs as a CLI that hangs when its input closes, the way a CLI stuck in a
// tool or a shutdown hook does. CASEY_STUBBORN=hang keeps running after EOF but honours SIGTERM;
// CASEY_STUBBORN=hang-ignore-term also ignores SIGTERM (only SIGKILL ends it). fake-claude's own check still exits
// it once the test directory is gone.
if (process.env.CASEY_STUBBORN && !process.argv.includes('--no-session-persistence') && !['--version','auth','mcp'].some(a => process.argv.includes(a))) {
  setInterval(() => { }, 1000); // never exit on EOF
  if (process.env.CASEY_STUBBORN === 'hang-ignore-term') process.on('SIGTERM', () => { });
}
await import('./fake-claude.mjs');
