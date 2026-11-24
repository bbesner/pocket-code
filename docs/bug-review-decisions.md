# Bug review decisions

Read by the `bug-review` skill's spec writer before every run (the skill lives outside this repository, in the
maintainers' agent skills). A settled finding is not raised again unless the code it cites has changed since its date.
Rows are added in the same pull request as the fixes from the run that produced them.

## Risky files

The files bug reviews target here: they hold secrets, write state, start or stop processes, or decide who may act.

- `cli-updates.mjs` and `cli-update-worker.mjs` (reviewed 2026-10-28)
- `vault.mjs` (reviewed 2026-10-27, 1.82.0)
- `approvals.mjs`, `access.mjs`, `trusted.mjs` (reviewed 2026-11-23, 1.124.3)
- `codex.mjs` (session lifecycle: start, adoption after a restart, stop, close, the log reader; reviewed 2026-11-23, 1.124.3)
- `scripts/pocket-mcp-proxy.mjs` (reviewed 2026-11-23, 1.124.3)
- `vault-pin.mjs` (reviewed 2026-11-23, 1.124.3)
- `job-keys.mjs` and `checkbacks.mjs`, with their routes in `server.mjs` (reviewed 2026-11-23, 1.124.3)
- `automation.mjs` (reviewed 2026-11-23, 1.124.3)
- `self-update.mjs` and `scripts/pocket-self-update.sh` (reviewed 2026-11-23, 1.124.3)
- Not yet reviewed this way: `acp.mjs`, the Claude runner and keeper in `server.mjs`, `store-file.mjs`, `inbox-watch`.

## Settled findings

Run 2026-10-27 on `vault.mjs` at 1.82.0. The five real faults (DIV-3, 7, 16, 20, 22) are fixed in 1.82.1.

| Finding | Ruling | Reason |
|---|---|---|
| DIV-1: a store whose plaintext is `0`, `false` or `""` opens empty | Not a fault | Producing that file needs the key; a holder of the key can write any store. |
| DIV-2: a NaN `limit` skips the 200-row cap in `auditRows` | Guarded | `server.mjs` passes `Number(req.query.limit) \|\| 50`. |
| DIV-4: `importBundle` keeps recipes and policy from the file | Not a fault | Only the owner imports, and the bundle is their own export under their passphrase; a malformed recipe matches no command. |
| DIV-5: a non-owner snapshot lists other sessions' pending requests | Not a fault | Agents share the owner's OS user, which the design concedes (SECURITY.md); the rows carry no values. |
| DIV-6: `answer('always')` is accepted when `allowAlways` is false | Not a fault | No recipe is saved for an *Ask every time* item, so it behaves as *once*. |
| DIV-8: a waiter on an expired request resolves `null`, not `expired` | Not a fault | The next call answers 404 "expired"; the agent re-requests. |
| DIV-9: `release()` trusts the items it is given | Guarded | Callers pass items from `claim()` or `resolveBindings()`, which read the live store. |
| DIV-10: `purge` writes no audit row | Deliberate | Purging trash after 30 days is housekeeping; the removal itself was audited. |
| DIV-11: a purge that deletes resets the idle-lock timer | Not a fault | Once per purge that deletes something; negligible. |
| DIV-12, 13, 15: passphrase set/remove and unlock write the audit row after the change | Deliberate | The audit records what happened, so it follows the commit; a failed audit write is logged by the server. |
| DIV-14: `removePassphrase` may move the store to the constructor's key | Guarded | Boot rolls `.env` back to the key that opened the store (`openedWith`, 1.76.3) and the passphrase path is guarded (#150). |
| DIV-17: `rotate()` writes no audit row itself | Deliberate | The server writes the rotation's row. |
| DIV-18: a store opened by an old key saves under the new one | Guarded | Boot adopts the key that opened the store (`server.mjs`, `openedWith`). |
| DIV-21: values under 4 characters are not scrubbed | Deliberate | A 1–3 character value would shred the output (comment in `needlesFor`). |
| DIV-23: a run resolves before its group's SIGKILL on timeout, abort or the cap | Deliberate | Decision 4 of 2026-10-21: the slot is freed and the KILL follows on its own timer. |
| DIV-24: an AbortSignal already aborted at the start is ignored | Guarded | `server.mjs` checks `aborted` right before the spawn (rated the same as the external review's S2-B4-2 on 2026-10-21). |

Open, for the owner to decide (not settled): DIV-19, any agent call resets the passphrase Vault's idle-lock timer, so an
agent that keeps using the Vault keeps it unlocked.


## CLI updater review — 2026-10-28

Blind spec: Codex GPT-6 Sol; blind contract tests and independent verification: Claude Opus.
The new failure-path checks found four issues, fixed before release: early promise settlement
before subprocess cleanup; suppressing a never-finished daily check after a crash; persisting
unrecognized request fields; and a detached installer starting before its PID was saved. The
worker now waits for authorization over IPC after identity persistence and dies with its owner.

| Finding | Ruling | Reason |
|---|---|---|
| DIV-4: if saving the failed job also fails, the UI error differs from the on-disk job | Deliberate | The UI reports the persistence failure instead of showing an installer that has already stopped. Selected binaries and completed results remain the last committed ones. Restart marks the durable running job interrupted and never replays it. The contract test now verifies these invariants rather than requiring display status to equal disk. |

The original installer remains the first restore target; another application may change it.
Restoration rechecks its version and protocol and refuses a changed target. Managed installations
are retained without pruning so running processes are never stripped of their package files.


## The external 1.88.1 batch — 2026-10-30

22 faults (`faults-1.88.1.md`) and a six-item private security report, checked by reading `dd93e6f`; each item was
tested against 1.88.1 before anything changed (`test/review-1881-*.test.mjs`). 24 real (fixed in 1.89.0), two already
fixed (F-5 in 1.82.0, F-14 in 1.83.0), and the two below left as they are.

| Finding | Ruling | Reason |
|---|---|---|
| F-13: the "Message delivered." note stays while the state is `background` | Not a fault | `background` means the reply is still working (1.64); the CLI's own turn ends finished, failed or stopped and clears it, and the next send clears the old note before showing its own (`public/app.js` `sendMessage`). |
| F-21: every sheet toggles `app.inert`, which recalculates style for the whole page | Deliberate | Measured on a 5,377-element page (headless Chrome, median of 5): 27 ms per open-and-close at normal speed, 123 ms at 4× CPU slowdown, 100 / 83 ms open / close at 4× with accessibility on (the reviewer measured 56, and 451 / 971 with accessibility on). A focus trap without `inert` is faster but lets find-in-page match text behind the sheet and leaves assistive technology relying on `aria-modal`. Kept; `test/review-1881-sheet-perf.mjs` (`POCKET_PERF=1`) re-measures it. |
| F-12: `closeCodexSession` resolved two seconds after SIGKILL by design (1.73.7) | Changed | The intent (never block forever) stands, but the close now reports the truth: it completes only on a confirmed exit and fails with 423 after five more seconds, so a replacement is not started beside a live process. |
| F-9 as described (ignore transcript growth while Pocket's CLI is alive) | Not adopted | It would break `test/runner.test.mjs:151`: a terminal turn written while Pocket's idle process is alive must still count as another app's. The fault itself (a turn the CLI ran while the daemon was down read as foreign after a restart) is fixed by replaying the runner output from the offset the marker records. |


## The whole-code review at 1.123.1 — 2026-11-23

Nine reviewer lanes read the code at `v1.123.1`; a second reviewer tried to refute each finding. 60 stood: 5 high
(fixed in 1.124.1), 21 confirmed and 2 plausible medium (1.124.2), 26 confirmed low (1.124.3). Each fix has a test that
failed before it. The rows below were ruled on by the second reviewer and changed nothing.

| Finding | Ruling | Reason |
|---|---|---|
| fe-core-02: a slow earlier `route()` renders the wrong conversation | Not a fault | `route()` reads `location.hash` only after its awaits, and a later call bumps the render version. |
| inbox-07: Inbox news on a story is steered into a running reply as a user message | Deliberate | The conversation started from that story is the place the owner asked to hear about it. |
| unattended-04: each refused job call with a valid key appends an audit line, and the file is not rotated | Deliberate | The audit is the record of refused calls; a caller needs a valid key to add to it. |
| unattended-05: a usage-limit retry of a check-back's reply is re-armed every tick while check-backs are off | Deliberate | It runs once check-backs are switched on again; nothing is sent meanwhile. |

Open: the second reviewer could not establish the trigger, and no test made them fail. Not settled.

- vault-04: `pocket-vault await <name> --wait 300` may answer after only a fraction of the wait.
- inbox-06: `POST /api/inbox` awaits the push and the email before it answers, so a send slower than the CLI's 30 s
  timeout may read as a failure to the watcher (the watcher now retries, 1.124.2; Pocket knows the alert by its key).
- engines-06: Pocket's ask tool for OpenCode retries every failure and ignores stdin EOF.
- engines-07: closing an ACP session sends one SIGTERM to the agent's pid only (no group, no SIGKILL follow-up).
- engines-09: Antigravity's model-menu probe makes a new `agy` session on every read.
- http-03: `POST /api/upload`, `/api/session/<id>/stop` and `/api/notify/test-email` take a cookie-only request with no
  body or a non-JSON one, so the CSRF defence there rests on SameSite alone.

Noticed while fixing and left, for the next bug review of the file named (list as of 1.124.4):

- `server.mjs`: `mutes.json` and `push-subs.json` (arrays) still load as empty when they do not parse; the OpenRouter
  start routes do not answer `not_started` (Codex does since 1.124.4); "overloaded" is read as a usage limit; store
  writes are not fsynced; `holdRetry`, `rearmRetry` and the retry's re-write still swallow a failed marker write.
- Job keys (`server.mjs`): a job run left `starting` after its `working` save failed is settled only by its reply's end
  or a restart; a crash between the engine's start and that save leaves a reply running while its run reads
  `not_started` after boot (Codex and OpenRouter, for as long as their start call takes); a key file still holding the
  stale key of an interrupted rotation stays when Rotate moves the key to another folder, or on Delete.
- `scripts/pocket-self-update.sh` and `self-update.mjs`: the lock follows the progress file's path, not the checkout;
  nothing puts the checkout back if the script is killed, or the server reboots, after the checkout moved; when the
  progress file cannot be written at all the job reads *preparing* until the 20-minute rule; a `complete` that could
  not be recorded reads as interrupted; the Settings row prefixes *The update did not finish.* to *The update did not
  start.*
- `vault-pin.mjs`: an option's value written as one word with the option (`ssh -Fcfg`, `scp -Fcfg`) is not pinned, the
  same class as `~/.ssh/config`; every `#!/usr/bin/env -S …` script now loses *Always allow*, also the common
  `-S node --flag` ones (accepted: Pocket cannot tell what `env -S` starts).
- `scripts/pocket-mcp-proxy.mjs`: a picture call sent before the first fill that the server never answers makes every
  later fill in that relay refuse after its wait, until the browser tool restarts; the refusals after a fill are proven
  against a stand-in server and, for stop and end-of-input, against the real Playwright MCP offline, not against each
  agent CLI.
- `store-file.mjs`: the kept copy's name has one-second resolution, so two damaged files of one name set aside in the
  same second share a copy.
- `inbox-watch`: `release_held` on a dry run marks held alerts `dry-run`; a dry run killed mid-way leaves `queued`
  alerts a real check would send; a burst past four pages of 50 threads is dropped without a word; Telegram and email
  have no duplicate check, so their failures are not retried; `InboxRunner.stop()` signals python alone.
- `acp.mjs`: the Stop grace is proven against stand-in agents only; whether Antigravity passes the runner token
  through to Vault calls is not established.
- Tests: the server test files use fixed ports and do not check that the port is free, so two full runs on one
  machine fail each other; a killed run leaves its stand-in CLIs running.


## The risky-files bug review at 1.124.3 — 2026-11-23

Seven blind runs after the whole-code review's fixes: `vault-pin.mjs`; `approvals.mjs`, `access.mjs` and `trusted.mjs`;
`automation.mjs`; `job-keys.mjs` and `checkbacks.mjs` with their routes; `scripts/pocket-mcp-proxy.mjs`;
`self-update.mjs` and `scripts/pocket-self-update.sh`; `codex.mjs` (session lifecycle). Blind specs: Codex GPT-6 Sol;
blind contract tests and independent verification: Claude Opus; mutation checks: Codex GPT-6 Sol, and Claude Opus for
`codex.mjs`. 654 tests written from the specs alone, 69 failed, 29 real faults (5 medium, 24 low, none high), fixed in
1.124.4 with the passing contract tests kept as `test/*-contract-blind.test.mjs`. The rows below changed no code, or
only the hardening named.

| Finding | Ruling | Reason |
|---|---|---|
| pin DIV-3: a recipe saved under an older pin version that agrees still matches | Deliberate | The comparison is by content: anything a newer pin version adds is a `new` row and fails the match, and `unpinnable` is checked against the current pin (`vault.mjs` `recipeFor`; `test/vault-pin.test.mjs` "a matching earlier pin runs"). |
| pin DIV-5: `close()` does not wait for its file handles | Not a fault | The handles are read-only and close-on-exec; the child is given only `plan.fds` and is spawned before `close()`. |
| pin: `python -m amb` with both `amb.py` and `amb/` is not refused as ambiguous | Test bug | The package wins, as in Python; the pin holds `amb/__main__.py` and `amb/__init__.py`, the files that run. |
| gate DIV-1: the same pending request handed in again at the 20-card cap is refused, not ignored | Not a fault | No caller hands one inbox the same pending id twice (each log line is read once; request ids are unique per connection; a restart starts an empty inbox). |
| gate DIV-2: an automatic Allow that could not be delivered is not retried or turned into a card | Deliberate | Every production write fails only when the pipe is gone, where a card's answer would go too; an Allow is never retried after a failed delivery. It is logged on all three engines since 1.124.4. |
| auto D4: the audit drops text keys at the top level only | Guarded | Every caller passes fixed metadata (counts, ids, field names); none nests text or passes `at` (`SECURITY.md`, the audit file). |
| auto: `noticeOnce` answers true when its save failed | Not a fault | A restart can send the same limit notice once more that day: an extra push, not a hidden one. |
| auto: a failed save at the day's rollover | Not a fault | A restart loads the old day and runs the same rollover again; nothing is lost. |
| jobs DIV-4: Delete removes the key file before the key, and a failed save leaves the key listed without its file | Not a fault | The owner asked for the removal, is told it failed, and a second Delete finishes it. |
| jobs DIV-8: a check-back whose `startedAt` could not be saved | Not a fault | The reply's end settles it; only after a second fault (a restart that also cuts the reply) does the wording differ, and nothing reruns. |
| jobs DIV-9: a job or check-back audit line that cannot be written stops nothing | Deliberate | The audit is best effort and must never stop a turn. Since 1.124.4 a lost line is logged, at most once a minute. |
| jobs DIV-10: `writeKeyFile` read any `lstat` error as "no file there" | Not a fault | Unreachable on POSIX (the write in the same folder fails first). Hardened anyway: only a missing file counts as not there. |
| jobs: an error thrown in an `async` route is never answered | Not a fault | Every route is wrapped right after `express()`; a rejection reaches the error handler and answers 503 (shown by the check-back route test). |
| relay DIV-2: a stop signal leaves a grandchild that has no link to its parent | Not a fault | The real browser tree exits on TERM, INT and HUP (checked against Playwright MCP offline); the relay forwards the signal as an unwrapped server would get it. |
| relay DIV-3: a server that ignores end-of-input is not stopped | Not a fault | The real server exits on end-of-input; the client follows with SIGTERM, which the relay forwards with its 5 s SIGKILL. |
| relay DIV-4: `server.stdin.write` throwing synchronously | Test bug | Node reports a child pipe's failure asynchronously. The real condition (a server that closes its input) was a fault and is fixed in 1.124.4. |
| relay DIV-5: a value with a newline in raw, non-JSON stdout split over two lines | Not a fault | An MCP stdio server writes only JSON messages to stdout, where the newline is escaped; stderr goes through the streaming scrubber. |
| update DIV-4: the failure write of a start that failed also fails | Not a fault | A double fault; the two-minute start rule (1.124.4) now reads it as not started. |
| update DIV-5: `on()` or `unref()` throwing after the spawn | Guarded | `server.mjs` passes no spawner, and a real `ChildProcess` does not throw from either. |
| update DIV-6: closing the log descriptor fails after the spawn | Not a fault | Not a credible failure for a local file; the close is guarded since 1.124.4. |
| update DIV-10: `chmod` on the backup's files fails | Not a fault | The folder is made `0700`, so the files' modes widen nothing. |
| update DIV-13: the script runs from the checkout it moves | Not a fault | git replaces a file by unlink and create, and bash keeps reading the old inode; pinned by the contract for `merge --ff-only`, `reset --hard` and `checkout --detach`. |
| update DIV-14: a second press replacing the progress of a live updater | Not a fault | Every writer writes whole and renames, and the second script stops at the lock before it touches the checkout. |
| update DIV-15: SIGTERM to the script leaves `npm ci` running | Not a fault | Nothing in the flow signals the script alone, and killing `npm ci` half-way would leave the packages worse off. |
| update DIV-16: a secret printed by a subprocess reaches the update log | Not a fault | The script gets only `PATH`, `HOME`, `LANG` and `PM2_HOME`; the log is `0600` beside `.env`, and no route serves it. |
| update DIV-17: two runs in one second share a backup folder | Not a fault | The lock serialises runs on one install, and each spends seconds in `git fetch` before the time is read. |
| codex: log lines from before the adoption point are replayed, not skipped | Test bug | The spec was wrong; the replay is how requests left over from before a restart are found and declined once. |
| codex DIV-7: a usage-limit retry is armed when its marker could not be written | Not a fault | A continuation that may not survive a restart is better than none; the failed write is logged since 1.124.4. |

Changed by ruling in 1.124.4, where the blind test asked for something no fix should meet:

- auto D1: a failed save of the day's counts keeps them in memory (rolling back would loosen the limits, a throw would
  break a reply that has started); it is flagged on the Automation page and logged, not thrown.
- jobs DIV-3: a rotation cut off before the key file was rewritten is repaired by the next Rotate (`fileHash`); the
  rotation itself is not made two-phase.
- update DIV-7: a job whose script never took its lock reads as not started after two minutes, not at once.

Answered by the owner on 2026-11-24 (1.124.8):

- Should unattended starts be held while the day's counts cannot be saved? **No, keep as built.** They run, with the
  warning: the counts are kept in memory, so the limits still hold until a restart, and holding would also stop
  check-backs the owner asked for. Losing the counts takes a failed save and a restart together.
- Should a restart go ahead when `/api/health` does not answer during an update? **Yes, keep as built** (three tries,
  then restart, logged). A daemon that cannot answer its own health check is not helped by waiting.
- Should the usage-limit push say when the automatic continuation will not survive a restart? **Yes, changed in
  1.124.8.** `limitPushText` adds that a restart before then cancels it, for a retry whose marker could not be written.
- Should a picture taken before any Vault value was typed be allowed to delay a fill, or should the fill be refused at
  once? **Keep the wait** (up to 30 seconds). A screenshot normally answers in a second or two, so the wait is rarely
  seen, and a refusal would only make the agent call again.

## The UI/UX test's questions at 1.124.5 — answered 2026-11-24

The three questions the UI/UX test (#298) left for the owner, answered in 1.124.8:

| Question | Answer |
|---|---|
| X on a New pane drops its unsent text. Keep it as a draft, ask, or leave? | Keep it. It moves to the main window's New conversation (`closePaneFromX` in `public/split.js`); when that holds a different draft, Pocket asks (keep the pane open, or discard). `closePane` itself still discards, for the programmatic closes. |
| Assistant mode's home list draws running green and ready clay. Swap? | Swap. Running is clay and ready green, as everywhere else. |
| `browser_storage_state` after a Vault fill: allow, or refuse like a screenshot? | Refuse, with the other cookie and storage reads (`STORAGE_TOOLS` in `scripts/pocket-mcp-proxy.mjs`). After a login they hold the session it opened. |
