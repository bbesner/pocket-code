# Bug review decisions

Read by the `bug-review` skill's spec writer before every run (the skill lives outside this repository, in the
maintainers' agent skills). A settled finding is not raised again unless the code it cites has changed since its date.
Rows are added in the same pull request as the fixes from the run that produced them.

## Risky files

The files bug reviews target here: they hold secrets, write state, start or stop processes, or decide who may act.

- `cli-updates.mjs` and `cli-update-worker.mjs` (reviewed 2026-10-28)
- `vault.mjs` (reviewed 2026-10-27, 1.82.0)
- `approvals.mjs`
- `access.mjs`
- `trusted.mjs`
- `codex.mjs` (session close and reader lifecycle)
- `scripts/pocket-mcp-proxy.mjs`

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

Noticed while fixing and left, for the next bug review of the file named:

- `codex.mjs`: its log reader decodes before it splits lines (the fault fixed for Claude in 1.124.3), and
  `codex-usage-state.json` grows without limit as `usage-state.json` did; a Codex job's "autonomous" mark is not kept
  across a restart.
- `server.mjs`: `mutes.json` and `push-subs.json` (arrays) still load as empty when they do not parse; the Codex and
  OpenRouter start routes do not answer `not_started`; "overloaded" is read as a usage limit; store writes are not
  fsynced.
- `scripts/pocket-self-update.sh`: the script runs from the checkout it moves.
- `inbox-watch`: `release_held` on a dry run marks held alerts `dry-run`; a dry run killed mid-way leaves `queued`
  alerts a real check would send; a burst past four pages of 50 threads is dropped without a word; Telegram and email
  have no duplicate check, so their failures are not retried; `InboxRunner.stop()` signals python alone.
- `acp.mjs` and `scripts/pocket-mcp-proxy.mjs`: the Stop grace and the relay's refusals after a fill are proven
  against stand-in agents only; whether Antigravity passes the runner token through to Vault calls is not established.
- Tests: the server test files use fixed ports and do not check that the port is free, so two full runs on one
  machine fail each other; a killed run leaves its stand-in CLIs running.
