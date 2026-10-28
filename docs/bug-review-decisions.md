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
| DIV-24: an AbortSignal already aborted at the start is ignored | Guarded | `server.mjs` checks `aborted` right before the spawn (rated the same as Casey's S2-B4-2 on 2026-10-21). |

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
