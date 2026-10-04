# Operations, upgrades and recovery

Pocket Code is one HTTP daemon plus separate persistent provider processes. This
guide follows 1.7+ behavior. Read [SECURITY.md](../SECURITY.md) before exposing an instance.

## Process lifecycle

A Claude session keeps a detached CLI process with stream input. A Codex thread keeps
an app-server. Pocket records runner metadata and output, and uses named input pipes
so a restarted daemon can reattach to surviving processes. Keep the daemon, CLI/MCP
processes and their data on the same host and OS account.

The supplied [PM2 ecosystem file](../ecosystem.config.cjs) sets `treekill: false`.
Always start/restart from that file. Another supervisor needs equivalent child-process
preservation. This supports a Pocket daemon restart; it does not keep programs alive
through a host reboot or machine failure.

The default idle close is 60 minutes. It closes the process, not the transcript; the
next message resumes the saved session. Claude's reported background jobs prevent
idle closure. A separate default 30-minute stall watchdog replaces the old two-hour
wall-clock cap. It considers stream activity, pending questions/approvals and CPU
activity from programs started by the turn; reported Claude background jobs are exempt.
Codex is interrupted first and its process is closed if the interruption is unanswered.

`POCKET_MAX_PROCESSES` defaults to 8 and reclaims the longest-idle eligible process
before starting another. It is a **soft target**: active work is not evicted, and a
new process is not rejected when no idle candidate is available. A session process
and its MCP servers use memory in addition to the Pocket daemon.

Only one surface should write to a conversation at a time. Codex's native writer lock
lasts while Pocket's app-server holds the thread, including between turns. Use Session
options → Close session process, or wait for idle close, before continuing in an editor.
Claude ownership checks use transcript activity and replace stale Pocket processes
after another surface writes new turns. External transcript activity is an estimate,
not proof that an external process is still working.

## Health and status

```bash
curl --fail http://127.0.0.1:3610/api/health
pm2 status pocket-claude
```

Health returns `ok`, `active`, `codexActive`, `processes`, `codexProcesses` and uptime.
`active` includes both providers; `processes` counts Claude runners and
`codexProcesses` counts Codex app-servers. Zero active turns does not mean all session
processes are closed. Health does not enumerate their IDs or prove end-to-end provider access.

Use the authenticated session list for run state and Settings → About & updates for
frontend/server builds and CLI versions. During a static update, the frontend can be
newer than the still-running daemon. That state is reported separately from an update
check failure. Do not treat a cached UI or a successful health request as release verification.

## State and backups

Existing process environment values take precedence over `.env`. `POCKET_ENV_FILE`
selects another file; an empty value skips file loading. Keep one daemon per data
directory. `POCKET_DATA_DIR` defaults to the checkout; `POCKET_SESSION_ROOT` changes
Claude transcript storage only, while `CODEX_HOME` selects Codex's native store.

Back up these locations privately, preserving ownership and permissions:

| Location | Contents |
|---|---|
| `.env` or the configured environment file | Password, cookie secret, push keys and instance configuration |
| `~/.claude/projects/` or `POCKET_SESSION_ROOT` | Claude transcripts |
| `~/.codex/` or `CODEX_HOME` | Native Codex thread store and configuration |
| `~/pocket-uploads/` | Uploaded files |
| `POCKET_DATA_DIR` | Pocket state described below |

Pocket-owned persistent state includes:

- `pocket-settings.json`, `session-meta.json`, `mutes.json`, `push-subs.json`;
- `delivery-receipts.json`, `followup-queue.json`, `approval-decisions.jsonl`;
- `usage-state.json`, `codex-usage-state.json`, `owned-transcripts.json`;
- `turnlogs/` and `turnlogs-codex/`, including output and runner metadata.

Turn logs, queues and uploads may contain private task content. Do not commit them,
upload them as CI artifacts or put backups in a public web directory. A backup of
runner metadata does not recreate a terminated OS process or make an old FIFO usable.
For a consistent movable backup, close all session processes before copying state.

Do not restore an older runtime-data snapshot over new instructions, receipts or
transcripts. Preserve the current state when reverting application code. Browser-only
drafts and preferences need browser storage; they are not included in a server backup.

## Upgrade an existing installation

1. Choose a published, reviewed release and read its migration/rollback notes. Check
   that the checkout has no uncommitted source changes. Coordinate with other operators.
2. Back up configuration and persistent state. Prefer an idle window with no pending
   native questions or approvals, even though 1.7 can reattach to surviving processes.
3. Fetch the release, check out its tag, and install locked production dependencies:

   ```bash
   # Replace vX.Y.Z with the published release you reviewed.
   POCKET_RELEASE=vX.Y.Z
   git fetch origin --tags
   git checkout --detach "$POCKET_RELEASE"
   npm ci --omit=dev
   pm2 restart ecosystem.config.cjs
   ```

4. Check health and PM2, then open the app over its HTTPS URL. Verify the app version,
   server build and expected release notes. Use the browser refresh/update control if
   the old shell remains open. Verify an existing conversation, a saved draft and any
   adopted run. If a test turn is needed, use a dedicated test session.
5. Record the deployed commit, previous commit, state-backup location and verification
   in the installation's maintenance log. Merge/tag/publish and updating a live checkout
   are separate operations; one does not prove that the other happened.

Do not copy another instance's `.env`, restore stale state, or downgrade the frontend
asset number. If code changes require rollback after browsers cached a release, ship
a reverted patch with a fresh asset number so those clients load it reliably.

## Restarted questions and approvals

A browser reload does not end a provider-owned pending request. A daemon restart is
different: the adopted process's pre-restart requests are denied or declined, rather
than replayed as approvals, so the agent can continue or ask again. Codex requests
already recorded as resolved are skipped. An input pipe that cannot be recovered
produces an interrupted state; stop that turn, review completed work and start again.
Never attach an old decision to a new process. [Action approvals](action-approvals.md)
describes scope and audit behavior.

## Delivery and queue recovery

Outgoing requests carry an identifier; a matching retry checks the same receipt.
Receipts are retained for seven days, up to 2,000 entries. Preserve them across upgrades.
An interruption between dispatch and acknowledgment can leave delivery uncertain;
Pocket does not automatically dispatch that work again. A receipt confirms dispatch,
not completion of a tool action.

Pending instructions and their options live in `followup-queue.json`. Editing pauses
an entry until saved or canceled; revisions reject stale concurrent edits. Keep this
file across upgrades. After a restart, an unowned queue waits for a new turn or Run
next instruction. Review and remove an uncertain entry before later entries can run.

## Move data, downgrade, or uninstall

Before moving `POCKET_DATA_DIR`, downgrading below 1.7, or uninstalling:

1. Close each session process from Session options. Decide explicitly whether active
   work should finish first or be stopped. Closing a tab or pane is not sufficient.
2. Confirm `active`, `processes` and `codexProcesses` are all zero in health. Idle
   Codex app-servers can still hold writer locks when `active` is zero.
3. Stop the daemon, then copy/move data or switch to the reviewed older application.
   Preserve the existing transcripts, receipts, queue and approval audit.

For uninstalling, remove the PM2 entry and tunnel/proxy route after all session
processes have closed. The PM2 name is `pocket-claude`. Detached work left behind can
continue without the daemon's idle timers.

A pre-1.7 server cannot adopt 1.7's persistent process markers and Codex pipes. Close
those processes first; do not assume checking out old code will stop them. Downgrading
earlier than 1.3 also needs queue compatibility review: `editing` and Plan-mode entries
must not be handed to older code as runnable instructions. Use the historical release
notes for that boundary; do not automatically replay or rewrite live queues.
