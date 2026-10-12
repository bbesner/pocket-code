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

## Claude account switching

Settings → Accounts & instance runs the installed `claude auth login --claudeai`
with piped input/output. The CLI owns its OAuth flow and credential storage. Pocket
keeps only one pending login in memory for ten minutes, validates the authorization
URL’s provider and path, and accepts the code through an authenticated JSON endpoint.
It never writes login output or codes to turn logs, conversations, or Pocket state.
Restarting the daemon cancels pending login; the browser can reopen the form after
a disconnect. API-key and cloud-provider environment overrides block this flow.

Start is refused while a Pocket Claude turn is active. Idle Claude runners close;
runners with background jobs stay alive and persist an `accountStale` marker. New
turns are blocked while sign-in is pending. After sign-in, a retained session refuses
new requested turns until its jobs finish, then reopens with the current login on its
next requested turn. Autonomous background completion can use the earlier login.
Rate-limit events from retained processes do not replace the new account’s cached
plan limits. Rate-limit retries wait during sign-in; Codex is unaffected.
Other applications sharing the Claude configuration
are outside this gate and may need their Claude processes reopened. On success,
Pocket verifies identity and clears the old account’s cached plan limits, preserving
session usage history. Cancellation does not restore or revoke credentials; check
Accounts after cancelling while authorization was finishing.

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

Starting the daemon also has three side effects beyond its own state. It writes a fresh
loopback CLI token to `cli-token` in the data directory (mode `0600`), overwriting the
previous one. While Projects, Files, Tasks or the Vault is on, it installs agent skills into the
Claude Code and Codex skill folders. If `POCKET_REMINDER_HOOK` is set, it runs that
command when a reminder comes due. If `POCKET_VAULT_KEY` is set, it reads the key and removes
it from its own environment, so no process it starts inherits it. See
[Optional libraries](#optional-libraries-projects-files-tasks-and-the-vault).

Back up these locations privately, preserving ownership and permissions:

| Location | Contents |
|---|---|
| `.env` or the configured environment file | Password, cookie secret, push keys and instance configuration |
| `POCKET_VAULT_KEY` (in `.env`) | The Vault's key. Keep a copy somewhere other than the data backups, such as a password manager, and keep each retired key with the backups it opens |
| `~/.claude/projects/` or `POCKET_SESSION_ROOT` | Claude transcripts |
| `~/.codex/` or `CODEX_HOME` | Native Codex thread store and configuration |
| `~/pocket-uploads/` | Uploaded files |
| `POCKET_DOCUMENTS_DIR` (default `<data dir>/documents`) | The Files library's stored files, with its `.trash` folder. Pair it with `documents.json` |
| `POCKET_DATA_DIR` | Pocket state described below |

Pocket-owned persistent state includes:

- `pocket-settings.json`, `session-meta.json`, `mutes.json`, `push-subs.json`;
- `saved-prompts.json`, the saved prompts and recent starts on the New session screen;
- `delivery-receipts.json`, `followup-queue.json`, `approval-decisions.jsonl`;
- `usage-state.json`, `codex-usage-state.json`, `owned-transcripts.json`;
- `turnlogs/` and `turnlogs-codex/`, including output, runner metadata and any
  `.retry.json` markers (a rate-limited turn waiting to resume automatically);
- `projects.json`, `documents.json` and `tasks.json`, the records behind Projects, Files
  and Tasks. Back up each one you use, including a library you have since switched off;
- `vault.enc`, the Vault's encrypted store (items and their approved commands), and
  `vault-audit.jsonl` (mode `0600`), its append-only record of use. Back up both together;
  neither holds a readable value, and `vault.enc` is useless without its key;
- the documents folder (`POCKET_DOCUMENTS_DIR`, default `documents/`), holding the stored
  files, a `.trash/` folder of removed files, and a `.thumbs/` cache of preview pictures;
- `cli-token`, the loopback CLI token. It is regenerated at every start, so do not back it
  up or copy it to another instance.

Turn logs, queues, uploads, projects, tasks and kept files may contain private task content. Do not commit them,
upload them as CI artifacts or put backups in a public web directory. A backup of
runner metadata does not recreate a terminated OS process or make an old FIFO usable.
For a consistent movable backup, close all session processes before copying state.

`.thumbs/` is only a cache and is rebuilt on demand; leave it out of backups if size matters.
Restore `documents.json` and the documents folder together. A file named in the records
but missing on disk is flagged as missing rather than dropped, and a supported file placed
in the folder without a record appears as a private file on the next listing.

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

## Optional libraries: Projects, Files, Tasks and the Vault

Projects (1.29), Files (1.30; called Documents before 1.34), Tasks (1.36) and the Vault
(1.39) are off by default. **Settings → Projects, files, tasks & vault** switches each one for
the whole instance. The choices are stored as the `projects`, `documents`, `tasks` and `vault`
booleans in `pocket-settings.json`. While one is off, its API answers 404, and for Files that
includes the public and link addresses. Switching off does not delete the records or files.
The Vault can only be switched on while `POCKET_VAULT_KEY` is set; see [The Vault](#the-vault).

Their data is in `projects.json`, `documents.json`, `tasks.json`, `vault.enc` with
`vault-audit.jsonl`, and the documents folder
(`POCKET_DOCUMENTS_DIR`, default `<data dir>/documents`); see
[State and backups](#state-and-backups). Back these up with the rest of the data
directory, and keep them across upgrades.

**Reminders and due tasks.** A project reminder or a dated task is announced once when it
comes due: by web push, and by `POCKET_REMINDER_HOOK` if set. Pocket marks the item as
announced before sending, so a crash mid-send does not announce it twice, and a failed
hook is logged but not retried. Due items are checked every `POCKET_REMINDER_CHECK_MS`
(default 60000, minimum 250), with a first check a few seconds after start. A task stays
due until it is done or re-dated.

The hook is a shell command line, started with the daemon's own environment, that reads
one JSON object on standard input. A project reminder carries `project`, `projectName`,
`reminder`, `label`, `dueAt`, `task`, `taskText` and `url`. A task carries `kind: "task"`,
`task`, `text`, `dueAt`, `session` and `url`. `url` is an in-app path such as
`/#/tasks`, not a full address. A non-zero exit and its stderr are written to the daemon
log. Test the command with sample JSON before relying on it.

**Preview pictures.** The Files grid shows server-made thumbnails, cached in
`<documents dir>/.thumbs` and keyed by file size and modification time. They use tools
already on the host: Chrome or Chromium for HTML, `pdftoppm` for PDFs, ImageMagick's
`convert` for images. `POCKET_CHROME`, `POCKET_PDFTOPPM` and `POCKET_CONVERT` choose a
binary, or turn one off with an empty value. Without a tool, that kind of file shows its
name on the card instead.

**Trash.** Removing a file moves it to `.trash/` in the documents folder. The daemon
purges files trashed more than 30 days ago, checking every six hours. Restore a file
before then from the Files library.

**Agent skills.** While a library is on, Pocket installs its matching skill
(`pocket-projects`, `pocket-files`, `pocket-tasks`, `pocket-vault`) into `~/.claude/skills`, or
`$CLAUDE_CONFIG_DIR/skills` if that is set, and into `$CODEX_HOME/skills` when the Codex
home exists. Terminal and code-server agents on the host see them too. Pocket rewrites
these skills at start and removes them when the library is switched off. It only touches
a folder that carries its `.pocket-managed` marker; a skill of the same name that you
wrote is left alone and the daemon logs that. `POCKET_SKILLS=0` turns installation off.
Set it for any test or second daemon so it does not write into the real skill folders.

**CLI token.** `pocket-board`, `pocket-docs`, `pocket-tasks` and `pocket-vault` read
`cli-token` from the data directory and send it as a bearer token. The daemon accepts it
only on the Projects, Files, Tasks and Vault routes, and only on a direct loopback
connection with no `cf-connecting-ip` or `x-forwarded-for` header; a request that came
through the tunnel or a proxy is refused. On the Vault routes it allows only what agents
may do: list, show, run, create an item and read the calling session's history; it never
returns a value. A new token is generated at every start, so the CLIs must run on the
same host as the daemon and read the data directory of the daemon that is running. Two
daemons sharing one data directory overwrite each other's token.

Each agent process Pocket starts also gets `POCKET_SESSION_ID` and a runner token of its own
in its environment. `pocket-vault` sends them, and the daemon uses the runner token, not the
session id, to record which session and turn used the Vault. A call without one, from a
terminal or code-server session on the host, is recorded as `terminal` and is allowed under
the same policy.

### The Vault

The Vault keeps credentials in one file, `<data dir>/vault.enc`, encrypted with AES-256-GCM
as a single blob: items and their approved commands, with no plain-text
names or other metadata on disk. A file that fails its integrity check or does not open with
the key is not served; the Vault reports that it cannot be opened.

**The key.** Set `POCKET_VAULT_KEY` in `.env` to 32 random bytes in base64, then restart:

```bash
openssl rand -base64 32
```

The daemon reads the key at start and deletes it from its own environment, so agent turns,
helper models, the reminder hook and every other process it starts never see it. Settings →
Vault says when the key is missing. Without the key the Vault cannot be switched on, and an
existing store cannot be opened.

**Rotation.** Settings → Vault → **Rotate key** re-encrypts the store under a new key and
shows the new key once, in the browser. Put it in `.env` as `POCKET_VAULT_KEY` and restart;
until then the old key keeps working. Backups taken before the rotation still need the old
key, so keep it with them.

**Passphrase mode (1.40).** When the owner sets a passphrase in Settings → Vault, the store is
rewritten in format 2: a salt in the header and a key derived from the passphrase with scrypt
(N 2^15, r 8, p 1). The daemon opens such a file without `POCKET_VAULT_KEY` and starts
**locked**; it holds the derived key in memory only, from unlock until a lock (the owner's
Lock now, the idle time in `vaultAutoLockMinutes` in `pocket-settings.json`, or a restart).
While locked every Vault route but the snapshot and unlock answers 423 `vault_locked`, an
agent's call sends the owner one push per ten minutes, and the idle check runs every minute
(`POCKET_VAULT_IDLE_CHECK_MS` for tests). Removing the passphrase needs `POCKET_VAULT_KEY`
to be set, since the store goes back to format 1 under it. There is no recovery for a
forgotten passphrase; an export (below) is the owner's own backup.

**Export and import (1.40).** An export is a format-2 file of its own (`.pvault`), under a
passphrase typed for it, holding every live item with its values; an import adds items whose
names are new and skips the rest. Both are owner-only, cookie routes, and recorded.

**Runs.** `pocket-vault run` asks the daemon to start the command. The daemon starts it with
the filtered agent environment plus the bound values, no terminal, output piped back through
a filter that replaces each value (and its base64 and URL-encoded forms) with
`{{vault:name}}`. Output is capped at 1 MB and a run is stopped after 10 minutes by default.
The command runs with the daemon's permissions, outside any sandbox the agent's CLI applies.
Under Codex's Review mode the read-only sandbox cannot reach the daemon, so `pocket-vault
run` works only under Full access there.

**Requests.** A command that needs the owner's approval is pushed to the owner's devices as a
"Vault request" (with web push configured) and waits in the Vault view. A request is answered
once and expires after 15 minutes. A pending request lives in the daemon's memory only (a restart drops it; the agent is told the request no longer exists); the recipes an answer of *Always allow* saves are kept inside `vault.enc`.

**Audit.** `<data dir>/vault-audit.jsonl` (mode `0600`) gets one line for every run, request,
answer, owner view of a value, addition, change, removal, restore and rotation: the time, the
item, the action, the session (or `terminal`), and the command and folder for a run.
It never holds a value. If the line cannot be written, the action fails. The Vault view shows
it per item.

**Backups.** Back up `vault.enc` and `vault-audit.jsonl` with the rest of the data
directory, and keep `POCKET_VAULT_KEY` somewhere else. A backup restored without its key
yields nothing, which is the point. A backup script that copies an allowlist of files must
add both. Removed items wait in the store's trash for 30 days, then are purged.

**Switching it on** restarts idle agent processes so the Vault's per-turn instruction and
skill reach them; running sessions get the instruction from their next turn. When Codex's
`config.toml` sets `developer_instructions`, Pocket's per-turn line is not delivered to Codex
sessions, and Settings shows a warning.

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

## Voice engine

Voice mode is optional and in beta. `scripts/voice-setup.sh` creates a Python virtual environment and downloads
the Whisper `small.en` and Kokoro models into `POCKET_VOICE_HOME` (default
`~/.local/share/pocket-code/voice`, about 1.3 GB). Restart Pocket Code afterwards.

- **Lifecycle.** Pocket starts `voice/voice_server.py` on the first voice request, bound to
  `127.0.0.1` on a random port, and stops it after `POCKET_VOICE_IDLE_MS` (15 minutes) without use.
  The engine exits on its own if Pocket stops. Loading takes a few seconds; the first request after
  idle waits for it.
- **Resources.** About 1 GB of RAM while loaded; each request uses up to 4 CPU threads for
  transcription and 4 for speech. Audio and text are processed in memory and not stored.
- **Health.** `GET /api/voice/status` (signed in) reports whether voice is installed, running and
  the last start error. Engine start and idle stops are logged by the Pocket daemon.
- **Disable or remove.** Set `POCKET_VOICE=off`, or delete `POCKET_VOICE_HOME`. Nothing else
  depends on it.
- **Upgrades.** Rerun the setup script after a release that changes `voice/requirements.txt`.
