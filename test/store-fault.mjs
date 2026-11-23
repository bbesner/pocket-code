// Tests only (1.124.4: test/job-routes.test.mjs, test/job-propose.test.mjs, test/checkback-routes.test.mjs): loaded into
// server.mjs with NODE_OPTIONS=--import, so a test can make a store's save fail at the step a route reaches it. While the
// file STORE_FAULT_FILE holds a rule { "store": "job-keys.json", "nth": 2, "times": 1, "action": "enospc" }, the nth rename
// of <data>/<store>.tmp counted from when the rule was written, and the `times` - 1 after it (0: every one from there),
// fails with ENOSPC as a full disk would. "kill" lets that rename finish and then kills the server (SIGKILL), as a power
// cut just after the save would. A rule with different text starts a new count (put a time or a counter in it); no file,
// no faults. Any other process (a fake CLI inheriting NODE_OPTIONS) is left alone.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const ctl = process.env.STORE_FAULT_FILE;
if (ctl && /(^|\/)server\.mjs$/.test(process.argv[1] || '')) {
  const rename = fs.renameSync;
  let raw = null, rule = null, seen = 0;
  fs.renameSync = function renameSync(from, to) {
    let text = null; try { text = fs.readFileSync(ctl, 'utf8'); } catch { }
    if (text !== raw) { raw = text; seen = 0; try { rule = text ? JSON.parse(text) : null; } catch { rule = null; } }
    if (rule && String(from).endsWith('/' + rule.store + '.tmp')) {
      seen += 1;
      if (seen >= rule.nth && (!rule.times || seen < rule.nth + rule.times)) {
        if (rule.action === 'kill') { rename.call(fs, from, to); process.kill(process.pid, 'SIGKILL'); }
        throw Object.assign(new Error(`ENOSPC: no space left on device, rename '${from}' -> '${to}'`), { code: 'ENOSPC', errno: -28, syscall: 'rename' });
      }
    }
    return rename.call(fs, from, to);
  };
  syncBuiltinESMExports();
}
