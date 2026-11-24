<!-- manual
checked: 1.124.8
sources: checkbacks.mjs, job-keys.mjs, automation.mjs, cli-updates.mjs, cli-update-worker.mjs, self-update.mjs, scripts/pocket-self-update.sh, ecosystem.config.cjs, environment.mjs, pipes.mjs, codex.mjs, sidechat.mjs, skills.mjs, vault.mjs, scripts/pocket-mcp-proxy.mjs, scripts/pocket-run.mjs
-->
# Operations, upgrades and recovery

Pocket Code is one HTTP daemon plus separate persistent provider processes. This
guide is current for 1.79.2. Read [SECURITY.md](../SECURITY.md) before exposing an instance.

A new installation starts with [docs/install.md](install.md) (`pocket-init`, 1.46); this
guide covers what happens after that.

## Process lifecycle

A Claude session keeps a detached CLI process with stream input. A Codex thread keeps
an app-server. Pocket records runner metadata and output, and uses named input pipes
so a restarted daemon can reattach to surviving processes. The pipes live outside the
data directory, in `$TMPDIR/pocket-code-pipes-<uid>/<hash of the data directory>/` (or directly in
`POCKET_PIPE_DIR` when set, so give each daemon its own), so
a recursive search of the install can never open one and swallow what Pocket sends. Keep the daemon, CLI/MCP
processes and their data on the same host and OS account.

The command-line tools (`pocket-board`, `pocket-docs`, `pocket-tasks`, `pocket-coord`, `pocket-start`, `pocket-inbox`, `pocket-notify`)
give up after 30 seconds without an answer from the daemon (1.73.8; before, undici's five-minute
header timeout was the only bound, so a hung daemon held an agent's session start that long).

The supplied [PM2 ecosystem file](../ecosystem.config.cjs) sets `treekill: false`.
Always start/restart from that file. Another supervisor needs equivalent child-process
preservation. This supports a Pocket daemon restart; it does not keep programs alive
through a host reboot or machine failure.

The default idle close is 60 minutes (`POCKET_IDLE_CLOSE_MS`, milliseconds; `0` turns it off). It
closes the process, not the transcript; the next message resumes the saved session. Claude's reported background jobs prevent
idle closure. A separate default 30-minute stall watchdog (`POCKET_STALL_MS`; `0` turns it off) replaces the old
two-hour wall-clock cap. It considers stream activity, pending questions/approvals and CPU
activity from programs started by the turn; reported Claude background jobs are exempt.
Codex is interrupted first and its process is closed if the interruption is unanswered.
**Stop** on a Codex reply closes its process too when the reply has not ended 20 seconds after the interrupt, whether or
not the interrupt was answered (1.124.4; before, an answered interrupt with no end left the reply running until the stall
watchdog); the reply ends as stopped by you.
Closing a Codex session sends SIGTERM to the app-server's process group and, since 1.73.7,
SIGKILL five seconds later if it is still running, so a hung app-server no longer keeps the
thread's writer lock. Since 1.89 the close completes only when the process has really exited: if it
is still running five seconds after the SIGKILL (stuck in the kernel, for example on a hung network
filesystem), a message that needs a new process for that thread (after a permissions or folder
change) is refused with "The previous Codex process … has not exited yet" instead of starting a
second process beside it, and the log says `codex session still running after SIGKILL`. A session record (`turnlogs-codex/*.session.json`) carries the boot id
and the start times of the app-server and its keeper (1.73.7); after a restart Pocket adopts or
signals a recorded process only when both match, so a record left from before a reboot is
removed without signalling whatever process now has that pid. Records written before 1.73.7
count as this boot's only when the file is newer than the boot. macOS has no boot id: there the
start times come from `ps -o lstart=` and decide alone, and the boot time comes from
`sysctl kern.boottime` (1.81).

Closing a Claude session process ends its input (EOF). An ordinary close (idle, the process limit,
an account sign-in, Release) leaves it 30 seconds to finish (SessionEnd hooks, MCP servers shutting
down); if it is still running then, its process group gets SIGTERM, and since 1.89 SIGKILL three
seconds after that (the log says `session process still running after …; sending …`). It used to get
the SIGTERM alone. When a message needs a new process (another model, effort, folder or permission
mode, or the conversation continued in another app), the steps are short: SIGTERM three seconds after
EOF, SIGKILL three seconds later. The new process starts only once the old one has exited, so two CLIs
never work on one conversation; the reply waits at most those two steps plus three seconds, then
starts anyway and logs `session process still running after SIGKILL`. The waiting message is also
kept in the conversation's queue (not shown there), so if Pocket restarts during that wait the
message starts once Pocket is back, instead of being lost. A Claude runner marker
(`turnlogs/*.runner.json`) records the CLI's boot id and start time (1.89): a restart adopts a process
only when its pid, command line and start time still match, adopts only the newest live process of a
conversation and stops any other (SIGTERM, then SIGKILL), and stops one that was being closed. The
marker also records how far the process's output has been read, so a restart reads on from there: a
reply the CLI ran by itself while Pocket was down (a background job finishing) is finished and
counted as Pocket's own, not as another app's. The marker is written before the first prompt; when
it cannot be written (a full disk), the process is killed and the reply fails with "Pocket Code could
not record the Claude process on disk", rather than running where a restart could neither find nor stop it.

`POCKET_MAX_PROCESSES` defaults to 8 (`0` means no cap) and reclaims the longest-idle eligible process
before starting another. It is a **soft target**: active work is not evicted, and a
new process is not rejected when no idle candidate is available. A session process
and its MCP servers use memory in addition to the Pocket daemon.

**Branch** starts a new conversation from a copy of the current one; its process is an ordinary
session process, counted and closed like any other.

A side chat is a separate, short-lived process beside a conversation: for Claude,
`claude -p --resume <id> --fork-session --no-session-persistence` with read-only tools, no MCP
servers and no hooks (WebSearch only when the conversation is in Full access or `WebSearch` is a
trusted action); for Codex, its own `codex app-server` on an ephemeral, read-only fork, with every
server `codex mcp list --json` reports switched off (a side chat is refused when that command fails).
Since 1.89 each side chat process leads its own process group: closing it ends stdin (Claude) or
sends SIGTERM (Codex), signals the group with SIGTERM (after three seconds for Claude) and with
SIGKILL three seconds later if anything in it is left, whether or not the leader has already
exited; when the daemon exits the groups get SIGTERM at once. Side chats keep their turns in memory
only and are never reattached. One ends when it is closed, after `POCKET_SIDE_CHAT_IDLE_MS`
(default 30 minutes) without a question, when the daemon stops or restarts, when a Codex side chat
does not answer Stop within 20 seconds, and (Claude only) when the Claude sign-in changes. At most `POCKET_SIDE_CHAT_MAX` (default
4) are open at once: opening another closes the longest-quiet one, and is refused while every one is
answering. A Claude side chat stops at `POCKET_SIDE_CHAT_BUDGET_USD` (default 5; `0` removes the
cap). The cap, the cost each answer shows and the `cost=` of the close log line count only the side
chat's own spend, not what the conversation had spent before it (1.122.2). Side chats are not counted in `POCKET_MAX_PROCESSES` or in health. `POCKET_SIDE_CHAT=0`
turns them off.

With Inbox Watch on, the daemon also starts the watcher (`python3`, the `inbox-watch/` code) once a
minute; a run still going after 30 minutes is killed. `POCKET_INBOX_RUNNER=0` stops Pocket from
running it, for an install whose watcher runs on its own timer.

Only one surface should write to a conversation at a time. Codex's native writer lock
lasts while Pocket's app-server holds the thread, including between turns. Use **Conversation
options → Close conversation process**, or wait for idle close, before continuing in an editor.
Claude ownership checks use transcript activity and replace stale Pocket processes
after another surface writes new turns. External transcript activity is an estimate,
not proof that an external process is still working.

## CLI release checks and upgrades

The daemon's CLI updater checks once per local date at or after 04:00. It uses the owner's
saved browser time zone, then `POCKET_TZ`, then the server's time zone. It checks every minute
whether the daily check is due; only the daily check contacts npm. A restart after 04:00
catches up if that date has not been attempted. A failed check is visible in the review and
can be retried with **Check now**. Discovery follows each official npm package's `latest`
regular release, excluding prereleases; it does not install automatically.

The same daily check asks `https://github.com/bbesner/pocket-code/releases/latest` (one `HEAD`
request; GitHub redirects it to the latest published release, never a draft or prerelease, and it
is not subject to the API's 60-an-hour per-IP limit) and compares that tag with the running
daemon's `package.json` version. The first check waits two minutes after the daemon starts. A newer one puts a notice in the
browser with links to the release notes and to [Upgrade an existing installation](#upgrade-an-existing-installation);
nothing is downloaded or installed (unless the owner allows it, see [Updating from Pocket](#updating-from-pocket)). `POCKET_UPDATE_CHECK=0` turns that check off, and
`POCKET_RELEASES_REPO=owner/repo` points it at a fork's releases. It runs even when
`POCKET_CLI_UPDATES=0`.

`POCKET_CLI_UPDATES=0` disables scheduled CLI discovery and upgrades. `CLAUDE_BIN` and `CODEX_BIN`
overrides stay externally managed and cannot be upgraded from Pocket. Installs without a
provider do not gain it through this feature. Managed upgrades support Linux and macOS on
x64/arm64 and need npm on the daemon's PATH.

`$POCKET_DATA_DIR/cli-runtimes/state.json` is the atomic activation record. Each candidate has a
unique installation directory beside it; never remove a directory an existing process still
uses. npm runs against the official registry with an exact version, lifecycle scripts disabled,
and an environment without daemon credentials. Claude's own package installer is run explicitly
if present. Isolated probes check `--version` and Claude's stream initialization or Codex's
app-server initialization and model listing. They do not inherit live agent configuration or
credentials, and make no model calls. Managed Claude processes have self-updates disabled so a
release cannot bypass Pocket's explicit selection and checks.

Only browser-authenticated, same-origin JSON requests can start an upgrade. An accepted job
runs independently of the browser, one job at a time. The original global install is left in
place as the first restore target; subsequent managed installs retain their predecessor. A restore
rechecks the target version and protocol, so an externally modified original is not silently
accepted. The record is saved before runtime consumers switch. A failed job reports which
providers completed; it never silently undoes a successful first provider.

An IPC worker starts commands only after its identity has been saved, and kills its group if the daemon disconnects. Daemon shutdown also kills updater subprocess groups. On restart an interrupted job is marked interrupted,
and a still-running recorded subprocess is killed only if its boot and start time match. A saved
activation remains selected; an unfinished candidate cannot activate itself. The updater never
replays an interrupted job. An unreadable state record or missing selected installation stops startup
with an explicit error: restore the record/installation rather than silently selecting another CLI.
Keep `cli-runtimes/` with runtime backups. Old directories are retained, not automatically pruned.

The provider binary path is recorded with each persistent process. Updates leave running replies
and approvals alone. The next requested turn reopens an idle process when its binary path differs;
Claude also waits for its background jobs. Reader/model-list connections refresh on binary change.
This does not restart Pocket or update other applications' global CLIs.
The update API lists old Claude and Codex processes by conversation after activation. The owner
can release an idle one from the review, or explicitly stop a working turn so its next turn starts
the selected CLI. A restart of Pocket alone preserves old CLI processes; it is not a switch action.

## Claude account switching

**Settings → Agents & instance → Accounts & instance** (**Settings → Accounts** in Assistant mode)
runs the installed `claude auth login --claudeai`
with piped input/output. The CLI owns its OAuth flow and credential storage. Pocket
keeps only one pending login in memory for ten minutes, validates the authorization
URL’s provider and path, and accepts the code through an authenticated JSON endpoint.
It never writes login output or codes to turn logs, conversations, or Pocket state.
Restarting the daemon cancels pending login; the browser can reopen the form after
a disconnect. API-key and cloud-provider environment overrides block this flow.

Start is refused while a Claude turn in Pocket is active. Claude side chats close; idle Claude runners close;
runners with background jobs stay alive and persist an `accountStale` marker. New
turns are blocked while sign-in is pending. After sign-in, a message sent to a retained
session waits in its follow-up queue (`afterJobs`; the response is 202 with `queued`,
`afterJobs`, the jobs and the item id) and starts on the current login once the jobs have
finished or the process has exited: from the end of the CLI's own job-report reply, or
`POCKET_AFTER_JOBS_GRACE_MS` (default 5 s) after the jobs end when no reply starts. A held
message whose process ended while Pocket was down starts at the next startup. The queue
does not drain while the jobs run; a queue start without `replaceStaleLogin: true` is refused
(409, naming the jobs) and leaves the item pending. With the flag (the
app's **Stop background jobs and send now**, on `queue/start` or `message`) the retained process
is closed instead, which ends its jobs, and the reply starts on the current login once it has
exited. Autonomous background completion can use the earlier login. A refused (4xx)
message keeps no delivery receipt (one kept by an earlier release is forgotten at its retry), so a
retry with the same `clientMessageId` is checked again.
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

Use the authenticated session list for run state and **Settings → Help & updates → About & updates** for
frontend/server builds and CLI versions. During a static update, the frontend can be
newer than the still-running daemon. That state is reported separately from an update
check failure. Do not treat a cached UI or a successful health request as release verification.

## State and backups

Existing process environment values take precedence over `.env`. `POCKET_ENV_FILE`
selects another file; an empty value skips file loading. Keep one daemon per data
directory. `POCKET_DATA_DIR` defaults to the checkout, and the repository's `.gitignore` covers every
file and folder the daemon writes there, and local `.env.bak*` copies of `.env` (1.122.2); `POCKET_SESSION_ROOT` changes
Claude transcript storage only, while `CODEX_HOME` selects Codex's native store.

Starting the daemon also has side effects beyond its own state. It writes a fresh
loopback CLI token to `cli-token` and its own address to `cli-url` in the data directory
(both mode `0600`, 1.43.1), overwriting the previous ones. It installs agent skills into the
Claude Code and Codex skill folders: `pocket-google` always, and each library's skill while that
library is on. If `POCKET_REMINDER_HOOK` is set, it runs that
command when a reminder comes due. If `POCKET_VAULT_KEY` is set, it reads the key and removes
it from its own environment, so no process it starts inherits it; it does the same with
`POCKET_SMTP_URL`, `POCKET_SMTP_FROM` and `POCKET_ROUTER_KEY`. See
[Optional libraries](#optional-libraries-projects-files-tasks-inbox-and-the-vault).

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
- `projects.json`, `documents.json`, `tasks.json` and `inbox.json`, the records behind Projects,
  Files, Tasks and Inbox. Back up each one you use, including a library you have since switched off;
- `inbox-watch-data/`, the watcher Pocket runs for Inbox Watch: its `config.toml`,
  `preferences.md` (your rules, written from Pocket), `state/` (the watcher's databases and log)
  and `status.json`;
- `starts.json`, briefings handed to Pocket with `pocket-start`;
- `router-key` (mode `0600`), the key saved in **Settings → Agents & instance → Automatic model
  choice**. It is a secret: back it up privately, like `.env`;
- `vault.enc`, the Vault's encrypted store (items and their approved commands), and
  `vault-audit.jsonl` (mode `0600`), its append-only record of use. Back up both together;
  neither holds a readable value, and `vault.enc` is useless without its key;
- the documents folder (`POCKET_DOCUMENTS_DIR`, default `documents/`), holding the stored
  files, a `.trash/` folder of removed files, and a `.thumbs/` cache of preview pictures;
- `auth-state.json` (mode `0600`, since 1.118), the sign-in generation and a keyed hash of the
  password (never the password). Sign out everywhere writes a new generation here. Restoring an
  older copy brings back the cookies of that generation, and deleting it signs every browser out
  at the next start; after a restore, use **Sign out everywhere**;
- `automation-state.json` and `automation-audit.jsonl`, the day's counts and limit notices behind
  [Automation](manual/automation.md), and its append-only record (created with mode `0600`) of pauses, resumes, settings
  changes, check-back events and unattended replies. The audit never holds message text. Whether Pocket is paused, and the saved Automation settings, are in
  `pocket-settings.json`;
- `checkbacks.json` (1.119, mode `0600`, written by tmp file and rename), the check-backs: waiting and running ones
  until they finish, finished ones for 30 days (at most 300). It is created when the first check-back is set and holds
  each one's note, so treat it like `tasks.json`. Back it up with the data directory;
- `job-keys.json` (1.122.0, mode `0600`, written by tmp file and rename), the job keys, their runs and the requests
  conversations have made for a key (`proposals`). A key is
  stored as a SHA-256 hash and its settings, never the key itself, so a restored copy keeps every key working and
  nobody can read a key back from it. Each run keeps its status, its times, the id of its conversation and the first
  line of its reply. Finished runs are kept for **Ignore a repeated call for** (at least a day), at most
  5000, and a run still working is always kept. A request keeps the whole instruction the agent wrote, until it is
  answered or expires (24 hours); an answered or expired one stays for 7 days, with its settings and the key file's
  path but never the key, and is then dropped on the next write. The file is created when the first key is made. It is not private
  content like a transcript, but it is the list of what can start work, so back it up with the data directory and
  keep it out of repositories. The key files the owner chose to save (`~/.config/pocket/jobs/` by default) are
  outside the data directory and hold the keys themselves, so keep them out of backups that leave the server and out of
  the folders agents work in. A key file is a file the server's user can read, and agents run as that user, so an agent
  with Full access could read one and start its job: a job key is no stronger a boundary than that user account
  ([SECURITY.md](../SECURITY.md#job-keys));
- `cli-token` and `cli-url`, the loopback CLI token and address. They are rewritten at every
  start, so do not back them up or copy them to another instance.

`codex-transcripts/` and `artifact-thumbs/` are caches Pocket rebuilds on demand; leave them out of
backups if size matters.

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

   A restart through the ecosystem file gives the daemon the environment of the shell that
   ran it (PM2 applies `--update-env` to ecosystem restarts), and every Claude Code or Codex
   session Pocket starts inherits that PATH. Since 1.56.1 the file appends the user's own bin
   directories (`~/.local/bin`, `~/.npm-global/bin`, `~/bin` and the node directory) when they
   exist and are missing, so a restart over ssh or from an agent's shell no longer loses MCP
   servers or CLIs installed there. On an older checkout run the restart from a login shell
   (`bash -lc 'cd … && pm2 restart ecosystem.config.cjs'`) or put those directories on PATH first.

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

### Updating from Pocket

Since 1.123 the owner of an install can let Pocket install its own releases: set `POCKET_SELF_UPDATE=1`
in `.env` and restart. The **Pocket Code** row in **Updates** then has an **Update to …** button. It is
for an install whose owner runs the server; on a managed install leave it unset, so only the operator updates.

The button starts `scripts/pocket-self-update.sh`, detached from the daemon (through `setsid -f` on Linux)
so it outlives the restart it causes, with only `PATH`, `HOME`, `LANG` and `PM2_HOME` in its environment.
It follows the steps above: the origin must be `github.com/<POCKET_RELEASES_REPO or bbesner/pocket-code>`,
the checkout on `main` (fast-forwarded) or on a detached release, tracked files unchanged and `HEAD` what it
was when the button was pressed; the tag `v<version>` must be on `origin/main`; at least 5 GB must be free.
It backs up the git-ignored private files to `~/backups/pocket-code-<version>-update-<time>/`
(`private-state.tar.gz`, `prev-head.txt`, `prev-branch.txt`); a backup `tar` could not finish, or one that does
not list back, is removed and the update stops with nothing changed (1.124.2), as it does when the private files cannot be
listed or the archive holds none of the files listed (1.124.4). It then runs `npm ci` and `check:release --released`,
then waits until no reply is running (`busy` from `/api/health`; a reply can start after the button was pressed) for up to
10 minutes, putting the previous version back if replies keep running (1.124.3); it asks once more right before the
restart and goes back to waiting if a reply started meanwhile (1.124.4). When `/api/health` does not answer after three
tries a second apart, the number is unknown: the restart goes ahead and the log says so (1.124.4). Then `pm2 restart <its pm_id>` (the stored PM2 environment is kept; Pocket reads `.env` itself) and waits up
to 90 seconds for a new process that serves the release and answers `/api/health`, and is still the same
process 10 seconds later. Then `pm2 save`. If any step after the checkout moves fails, the checkout and
packages go back to the previous commit; if the new version does not come up, the previous version is
restarted too. If the previous packages cannot be installed again either, the job says so (1.124.2): the running
daemon carries on, but run `npm ci` in the checkout before it next restarts. When the new version did not start and the previous one cannot be put back, the job says so and does not restart (1.124.3): check out the commit in the backup's `prev-head.txt`, run `npm ci` and restart with PM2. The daemon refuses to start it while a reply or a CLI upgrade is running.

Progress is in `pocket-self-update.json` in the data folder (the script touches `pocket-self-update.json.lock`
every minute while it runs; a job with neither for 20 minutes died with its server and shows as interrupted, 1.124.3,
and one that had reached installing, restarting or going back says the checkout may have moved and to run `npm ci` in it
before Pocket restarts, 1.124.5;
a job still queued two minutes after the press, with no lock file newer than the press, never started and shows as failed,
1.124.4) and the script's output in `pocket-self-update.log`; both are git-ignored. Requirements: PM2
(the daemon must run under it), a git checkout, `git`, `npm`, `pm2`, GNU `tar` and `flock` on the daemon's
PATH (on macOS, Homebrew's `gnu-tar`, used as `gtar`, and `flock`; the job names what is missing, and since 1.124.5
the Update button is not offered without `flock` and GNU tar: the row says what to install). From the moment the script
says `restarting`, the version being replaced refuses the owner's new messages, branches and side chats with
`409 restarting` for up to 90 seconds, so the restart does not cut a reply short (1.124.5). Running an operator update on such an install works as before; an operator script that expects a
particular `HEAD` will find the owner may already have moved it.

## Restarted questions and approvals

A browser reload does not end a provider-owned pending request. A daemon restart is
different: the adopted process's pre-restart requests are denied or declined, rather
than replayed as approvals, so the agent can continue or ask again. Codex requests
already recorded as resolved are skipped. An input pipe that cannot be recovered
produces an interrupted state; stop that turn, review completed work and start again.
Never attach an old decision to a new process. [Action approvals](action-approvals.md)
describes scope and audit behavior.

## A paused install

**Pause all** (1.117, [Automation](manual/automation.md#pause-all)) is saved in `pocket-settings.json`, so a restart does not
lift it: the install comes back paused, with its queues still and any usage-limit retry still held (its `.retry.json`
marker carries `held: true`). Background jobs Pause all stopped stay stopped. The owner resumes from the banner or
**Settings → Automation**. Do not edit the file to resume while Pocket runs.

**Job keys** (1.122.0, [Automation](manual/automation.md#job-keys)) are off until the owner turns them on in
**Settings → Automation → Job keys**. While they are off every call with a key is refused (a caller on this server gets
*Job keys are switched off on this Pocket.*; anyone else gets the plain 404 they got before the feature existed), and
the keys and the settings are kept. A job calls Pocket on its own port, `127.0.0.1` directly, with
`node <Pocket Code directory>/scripts/pocket-run.mjs --key-file <path> --data-file <file>` (the `pocket-run` command
the package installs as a binary, 1.122.0); a call through the tunnel, a proxy or the public address is refused with
403, because the daemon accepts a job key only on a direct loopback connection with no `cf-connecting-ip`,
`x-forwarded-for`, `forwarded` or `x-real-ip` header ([docs/install.md](install.md) has the proxy side). A crontab
line looks like this, with full paths because cron runs with almost no environment, and with `%` written `\%`:

```
0 * * * * /usr/bin/node /opt/pocket/scripts/pocket-run.mjs --key-file ~/.config/pocket/jobs/disk-check.key --data-file /var/tmp/disk-report.txt --id disk-$(date +\%Y\%m\%d\%H) >> ~/disk-check.log 2>&1
```

The run id names the occasion, here the hour, so it must change as often as the line runs: this line runs once an hour
and its id changes once an hour. (A line that ran every 30 minutes with this id would start nothing on every second
call, because the second call repeats the hour's id; put the minute in the id, `\%Y\%m\%d\%H\%M`, to run every 30 minutes.)

Its exit code says what happened: 0 done, 3 needs the owner, 4 still working (the call didn't use `--wait`, or the wait
ran out), 5 refused, 1 anything else. A pause, a plan ceiling or the daily limit refuses a job call and queues nothing,
so the script has to try again later or the owner has to resume. `--wait` may be any number of seconds: Pocket holds one
call at most 240 seconds (`POCKET_JOB_HOLD_MAX_MS`, for tests), and `pocket-run` and `pocket-jobkey` ask again in slices
of at most 240 seconds (`POCKET_RUN_SLICE_S`, `POCKET_JOBKEY_SLICE_S`, for tests) until the wait is used.

A run always ends. A restart settles a run that was working when Pocket stopped: unless a reply or a usage-limit retry
still carries it, about 15 seconds after the start (`POCKET_JOB_SETTLE_BOOT_MS`, for tests) it is recorded as failed
with the outcome `interrupted`, and the owner gets *Something went wrong*. A reply that survived the restart is adopted
again and its run ends with it. Any other run that nothing carries on (a usage-limit retry that was dropped, skipped or
not re-armed, or a reply that is gone) is ended once Pocket has seen it so twice, 3 seconds or more apart, by the
automation pass (each minute), the key's next call, or a read of the run, the key list or Recent runs: in practice
within one to two minutes. It ends `limit` (the reply had stopped at a usage limit), `jobs_off`, `stopped` (a message from
the owner replaced the retry) or `interrupted`, with the words in the run's `error` field
([Automation](manual/automation.md#what-a-runs-status-means)). A run that waits for the owner's answer to an approval
is not ended: the key stays busy until the owner answers. The reply text a script waits for is kept in memory for the
last 200 runs; after a restart a run keeps only the first line of its reply, and the answer then carries
`replyPartial: true`. Run ids (`--id`) are remembered for **Ignore a repeated call for**, so a script that retries after
a restart gets the first run back, unless that run could not start (outcome `not_started`), which doesn't keep its id.

A conversation can ask for a key itself. While job keys are on, Pocket installs the `pocket-jobs` skill (with its
`.pocket-managed` marker) in `~/.claude/skills/` and, where Codex is installed, `$CODEX_HOME/skills/`, and removes it
when job keys are turned off; the agent's command is `pocket-jobkey` (`node <Pocket Code directory>/scripts/pocket-jobkey.mjs`,
or `npx pocket-jobkey` from that directory). It sends the CLI token and the conversation's runner token to
`/api/jobs/agent/propose`, so it works only from a Pocket conversation, never from a terminal or code-server. The
owner gets the push *Allow a job key?* (kind `vault`, so it follows each device's **Vault requests** switch; it has no
action buttons) and answers in **Settings → Automation → Job keys**. On Allow, Pocket writes the key file to the
folder in **Where Pocket offers to save new keys**, mode `0600`, and the agent gets only the path. At most one request
waits for each conversation and five for the install, and one expires after 24 hours; Pocket looks for expired ones
with the check-back pass (every `POCKET_CHECKBACK_TICK_MS`, whatever the check-backs switch says) and on every read.
`POCKET_JOB_REQUEST_TTL_MS` shortens the 24 hours, in milliseconds. It is for tests; leave it unset. The audit file
records `proposed`, `proposal_allowed`, `proposal_denied`, `proposal_expired` and `proposal_refused` lines, which name
fields and never give values.

Presets for an install are `POCKET_AUTOMATION_JOBS` and its siblings, for example `POCKET_AUTOMATION_JOBS=1` to start
with the feature on and `POCKET_AUTOMATION_JOB_PER_HOUR=12`; the full list is in
[Automation](manual/automation.md#presets-for-an-install). A value saved in Settings wins. `pocket-run` finds the daemon
the way the other commands do (`POCKET_URL`, else `cli-url`, else `PORT` from the `.env` beside it) and reads the key
from `--key-file` or `POCKET_JOB_KEY`.

Rolling back to 1.121 stops job keys and loses nothing. 1.121 does not read `job-keys.json` or the **Job keys**
settings; it keeps them in `pocket-settings.json` and the file, so upgrading again finds the keys, their settings and
their runs. Every call a script makes while rolled back fails, because 1.121 has no job routes and no `pocket-run`: the
cron lines keep running and keep failing until the upgrade. A request still waiting stays in `job-keys.json`; after the
upgrade, one past 24 hours is marked expired. Delete the `pocket-jobs` folders this version installed under
`~/.claude/skills/` and `$CODEX_HOME/skills/`, because 1.121 does not remove them and the `pocket-jobkey` command
they name is gone. A conversation a job started stays an ordinary conversation
under 1.121, which already shows its *Started by job …* label.

**Check-backs** (1.119, [Automation](manual/automation.md#check-backs)) are off until the owner turns them on in
**Settings → Automation → Check-backs**. A pause holds every waiting check-back, and Resume lets them go or marks the
overdue ones missed (**On Resume, run overdue check-backs**). A restart settles a check-back that was running: one whose
reply had begun is recorded as cut off by the restart; one that had not begun is marked missed, and the owner gets one
push. Nothing runs twice, because a check-back is saved as running before anything starts. After the daemon was down,
waiting check-backs that are within the catch-up window (12 hours by default) run once, late, 15 seconds apart.

Presets for an install are `POCKET_AUTOMATION_CHECKBACKS` and its siblings, for example
`POCKET_AUTOMATION_CHECKBACKS=1` to start with the feature on and `POCKET_AUTOMATION_CHAIN_LIMIT=2`; the full list is in
[Automation](manual/automation.md#presets-for-an-install). A value saved in Settings wins. `POCKET_CHECKBACK_TICK_MS`
(default 60000, minimum 100) sets how often Pocket looks for check-backs that are due. The tests also use
`POCKET_TEST_CHECKBACK_CLOCK` and `POCKET_TEST_CHECKBACK_GAP`; leave both unset.

Rolling back to 1.118 (or 1.117) stops check-backs and loses nothing. 1.118 does not read `checkbacks.json`, the **Check-backs**
settings or **On Resume, run overdue check-backs**; it keeps them in `pocket-settings.json` and the file, so upgrading
again finds them, and a waiting check-back is then run or marked missed by the catch-up window. Delete the
`pocket-checkback` folders 1.119 installed under `~/.claude/skills/` and `$CODEX_HOME/skills/` (1.118 does not remove
them, and their command no longer exists). 1.118 ignores the device choice **Check-backs and job results** and sends the
limit notice with **Inbox alerts** again.

Rolling back to 1.116 ignores the pause and arms held retries again at start. 1.116 keeps `paused` in
`pocket-settings.json` without reading it, so a later upgrade to 1.117 comes back paused: resume before rolling back, or
resume after the upgrade. If Pause all had paused Inbox Watch, it stays paused under 1.116 until it is resumed in Inbox
Watch's settings. `POCKET_AUTOMATION_<NAME>` variables in
`.env` preset the Automation defaults for an install; a value the owner saved wins.

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

## Optional libraries: Projects, Files, Tasks, Inbox and the Vault

Projects (1.29), Files (1.30; called Documents before 1.34), Tasks (1.36), the Vault
(1.39) and Inbox (1.69) are off by default. **Settings → Projects, files, tasks & vault** switches each one for
the whole instance. The choices are stored as the `projects`, `documents`, `tasks` and `vault`
booleans in `pocket-settings.json` (and `inbox` for Inbox). While one is off, its API answers 404, and for Files that
includes the public and link addresses. Switching off does not delete the records or files.
Switching the Vault on creates its key when there is none (1.44); see [The Vault](#the-vault).

Their data is in `projects.json`, `documents.json`, `tasks.json`, `inbox.json` (entries, and
since 1.70 each watcher's settings and last reported profile), `vault.enc` with
`vault-audit.jsonl`, and the documents folder
(`POCKET_DOCUMENTS_DIR`, default `<data dir>/documents`); see
[State and backups](#state-and-backups). Back these up with the rest of the data
directory, and keep them across upgrades.

**Reminders and due tasks.** A project reminder or a dated task is announced once when it
comes due: by web push to the devices that chose *Due tasks and reminders* (every device,
for subscriptions saved before 1.50), by `POCKET_REMINDER_HOOK` if set, and by email when
`POCKET_SMTP_URL` is set and Settings names an address. Pocket marks the item as
announced before sending, so a crash mid-send does not announce it twice, and a failed
hook or mail is logged but not retried. Since 1.73.7 one check runs at a time (a slow push
or mail server no longer lets the next check announce the same items again), an item done,
removed or given a new time while an earlier one was being sent is skipped, and each hook
run is ended with everything it started after `POCKET_REMINDER_HOOK_TIMEOUT_MS` (default
60000) or when the daemon exits; the log keeps the last 4 KB of its stderr. With **Notice a day before** on in Settings
(`remindAhead: 24` in `pocket-settings.json`), a second announcement goes out 24 hours
ahead, marked `ahead: true` for the hook, for items that were set at least a day ahead.
Due items are checked every `POCKET_REMINDER_CHECK_MS` (default 60000, minimum 250), with
a first check a few seconds after start. A task stays due until it is done or re-dated.

**Push priority.** Due tasks, reminders, Vault requests (the *Allow a job key?* push is one, 1.122.0) and alerts (Inbox Watch, `pocket-notify`) go out with `Urgency: high`
(1.50.2), so Android delivers them while the phone is idle; a finished turn, and a check-back's result or missed notice, a job's result (titled with the job's name, 1.122.0) and the **Unattended work held** notice (kind `automation`, 1.119), go at normal
priority and may wait until the phone wakes.

**Push preferences.** Each device's choices (which kinds, the icon count) are kept with its
subscription in `push-subs.json` and changed through `/api/push/prefs`. A reminder push
carries the count of due items (`badge`) only to devices that show it. The notification's
**Tomorrow** and **Done** actions post to `/api/tasks/act` and `/api/board/act` from the
service worker with the signed-in cookie.

**Email.** `POCKET_SMTP_URL` is an `smtp://` or `smtps://` address (nodemailer's URL form);
`POCKET_SMTP_FROM` is the sender, defaulting to the URL's user when it is an address. Links
in the mail use `POCKET_PUBLIC_URL`, or the address the owner last signed in from
(`publicUrl` in `pocket-settings.json`). `POCKET_SMTP_URL=file:/path` appends each message
as a JSON line instead of sending; the tests use it. `/api/notify/test-email` sends a test
message to the saved address. The daemon reads `POCKET_SMTP_URL` and `POCKET_SMTP_FROM` at start and
removes them from its environment (1.73.3), as it does the Vault key, so no agent turn, hook, keeper or
Vault run inherits the mail password; `POCKET_ROUTER_KEY` is handled the same way.

The hook is a shell command line, started with the same environment as agent turns (Pocket's own secrets removed, 1.37.1), that reads
one JSON object on standard input. A project reminder carries `project`, `projectName`,
`reminder`, `label`, `dueAt`, `task`, `taskText` and `url`. A task carries `kind: "task"`,
`task`, `text`, `dueAt`, `session` and `url`. `url` is an in-app path such as
`/#/tasks`, not a full address. A non-zero exit and its stderr are written to the daemon
log. Test the command with sample JSON before relying on it.

**Preview pictures.** The Files grid shows server-made thumbnails, cached in
`<documents dir>/.thumbs` and keyed by file size and modification time. They use tools
already on the host: Chrome or Chromium for HTML, `pdftoppm` for PDFs, ImageMagick's
`convert` (or `magick`) for images, or Chrome when ImageMagick is missing. `POCKET_CHROME`, `POCKET_PDFTOPPM` and `POCKET_CONVERT` choose a
binary, or turn one off with an empty value. Without a tool, that kind of file shows its
name on the card instead. Since 1.89 the tool reads a private copy taken from the file as
Pocket opened and checked it (in a temporary folder that is removed afterwards), and an image's
format is read from the file's first bytes and must be PNG, JPEG, GIF or WebP, whatever its
extension; any other file (a `.png` holding PostScript, say) gets no picture, and the daemon
log says `thumbnail failed … not a PNG, JPEG, GIF or WebP picture`.

**Login and Vault attempt limits (1.89).** The login counts wrong passwords, 20 an hour per address; a
correct one does not count. `cf-connecting-ip` is used
as the address only when the request carries a verified Cloudflare Access token or
`POCKET_TRUSTED_PROXY=1` is set (the port is reachable only through a proxy that sets the
header); otherwise it is the connection's address, which behind a tunnel is `127.0.0.1` for
everyone. The Vault's wrong passphrases and recovery keys count per signed-in session (a hash
of its cookie), whatever the address: ten an hour per session, and 50 an hour across all
sessions together, after which every unlock and key restore waits out the hour and the log says
`vault: 50 wrong passphrases or keys within the hour across all sessions`. See `docs/install.md`
and `SECURITY.md`.

Since 1.118 an IPv6 caller counts by its /64, and the login also keeps one budget across all
addresses: past 30 wrong passwords in an hour, sign-ins are checked one at a time with a pause that
starts at 1 second and grows to 10, and a try that would wait more than 20 seconds is told to try
again in a minute (`busy`). A browser that signed in before carries a known-device cookie
(`pc_device`) and skips that queue. Vault intake links count per address only for an address Pocket
can place, and past 300 unknown links an hour across the install each further one is answered after
1.5 seconds.

**Trash.** Removing a file moves it to `.trash/` in the documents folder. The daemon
purges files trashed more than 30 days ago, checking a minute after start and then every six
hours. Restore a file before then from the Files library, or free the space now with
**Delete forever** or **Empty trash** there (1.45; owner only, the CLI token is refused).
Deleting a file, by hand or by the purge, also removes its `.thumbs/` pictures, and each
purge removes any picture whose file is gone.

**Agent skills.** While a library is on, Pocket installs its matching skill
(`pocket-projects`, `pocket-files`, `pocket-tasks`, `pocket-inbox`, `pocket-vault`, `pocket-coord`), and
`pocket-google` always, into `~/.claude/skills`, or
`$CLAUDE_CONFIG_DIR/skills` if that is set, and into `$CODEX_HOME/skills` when the Codex
home exists. Terminal and code-server agents on the host see them too. Pocket rewrites
these skills at start and removes them when the library is switched off. It only touches
a folder that carries its `.pocket-managed` marker; a skill of the same name that you
wrote is left alone and the daemon logs that. `POCKET_SKILLS=0` turns installation off.
Set it for any test or second daemon so it does not write into the real skill folders.

**CLI token.** `pocket-board`, `pocket-docs`, `pocket-tasks`, `pocket-coord`, `pocket-inbox`, `pocket-start`,
`pocket-notify`, `pocket-vault` and the browser relay find the daemon at `POCKET_URL` when set,
else the address in `cli-url`, then `PORT` from this checkout's `.env`, and only then an inherited
`PORT`. They read `cli-token` from the data directory and send it as a bearer
token. The daemon accepts it
only on the Projects, Files, Tasks, Inbox and Vault routes and the start-link and notify routes, and only on a direct loopback
connection with no `cf-connecting-ip`, `x-forwarded-for`, `forwarded` or `x-real-ip` header; a request that came
through the tunnel or a proxy is refused. The job routes (`/api/jobs/run` and `/api/jobs/runs/…`, 1.122.0) take a job key instead, under the same loopback rule, and refuse the CLI token. The job key request routes (`/api/jobs/agent/propose` and `/api/jobs/agent/requests/…`) take the CLI token together with a conversation's runner token, as the check-back agent routes do. On the Vault routes it allows only what agents
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

**The key (1.44).** Switching the Vault on with no key and no store makes Pocket create one (32 random bytes,
base64), save it as `POCKET_VAULT_KEY` in this install's `.env` (rewritten atomically, mode `0600`, other lines kept)
and write an empty store; the owner is shown the key once to save. You can still set `POCKET_VAULT_KEY` yourself
(`openssl rand -base64 32`), and must when `POCKET_ENV_FILE` is empty. The daemon reads the key at start and deletes it
from its own environment, so agent turns, helper models, the reminder hook and every other process it starts never
see it. If a store exists but its key is missing, Pocket never creates a new one over it: **Restore key** in
Settings → Projects, files, tasks & vault → Vault takes the recovery key, checks it opens the store and saves it. A provisioning script that rewrites
its own block of `.env` must leave the `POCKET_VAULT_KEY` line alone.

**Rotation.** Settings → Projects, files, tasks & vault → Vault → **Rotate key** writes the new key to `.env` (with the old one beside it as
`POCKET_VAULT_KEY_PREVIOUS`), rewrites the store under the new key, then drops the old line, so a crash in between
still opens the store at the next start. No restart is needed. Backups taken before the rotation still need the old
key, so keep the old recovery key with them. A rotation whose store write fails changes nothing (1.73.6): the store, `.env`
and the recovery key all stay with the old key. A key set in the daemon's process environment (a PM2 ecosystem or systemd
unit) rather than `.env` cannot be rotated from Settings, since the rotation could only ever write `.env`: the route answers
409 `vault_key_preset`; move the key into `.env`, remove it from the environment, restart, then rotate. Since 1.76.3 a rotation
that stopped between its two `.env` saves is rolled back at the next start: the store remembers which key opened it, `.env` goes
back to that key and the log says *an unfinished key rotation was rolled back*, so the recovery key the owner has is always the
key the store is under. (With the key in the process environment the store stays under `POCKET_VAULT_KEY_PREVIOUS` and the log says so.)

**Writes (1.73.6).** Every store (the Vault, projects, files, tasks, start links, settings) checks a change whole and writes it
before installing it in memory, so a refused field or a failed write (disk full, permissions) leaves the record, the file and
the Files folder as they were; the next save cannot carry a half-applied change. `vault.enc` is also synced to disk (file and
directory) around its rename, since it is the one file whose loss is every secret at once; the other stores keep the plain
temp-file-and-rename convention.

**Passphrase mode (1.40).** When the owner sets a passphrase in Settings → Projects, files, tasks & vault → Vault, the store is
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

**Runs.** `pocket-vault run` asks the daemon to start the command. The daemon finds the program on
`POCKET_VAULT_PATH` (default: its own `PATH` at start; absolute folders only), records the SHA-256 of
the program, its `#!` interpreter, the program a known launcher (`env`, `timeout`, `sudo` and others)
starts, the script a known interpreter runs and every file named in the arguments, and starts what it
checked with the filtered agent environment (that `PATH`) plus the bound values, no terminal, output
piped back through a filter that replaces each value (and its base64, URL-encoded, hex and reversed
forms) with `{{vault:name}}`. On Linux a native program is started from the file it hashed
(`/proc/self/fd`) and a shell script from a private copy of what was hashed; anything else is hashed
again just before the start (since 1.118). An *Always allow* recipe matches only while those hashes are
unchanged; a recipe saved before they were recorded asks once more. At start, with the Vault on, the
log warns about each folder on that `PATH` this user can write to, create or replace. Output is capped at 1 MB and a run is stopped after 10 minutes by default.
Since 1.73.7 the command leads its own process group, and its exit, the timeout, the cap or a
stop ends everything still in it (TERM, then KILL after five seconds); the run finishes within
about two seconds of the command's exit. A command that starts a background service expecting
it to outlive the run will see that service stopped: a Vault run cannot leave a daemon behind.
The command runs with the daemon's permissions, outside any sandbox the agent's CLI applies.
Under Codex's Review mode the read-only sandbox cannot reach the daemon, so `pocket-vault
run` works only under Full access there.

**Requests.** A command that needs the owner's approval is pushed to the owner's devices (with
web push configured) as "Allow <name>?" with the asking conversation and the command, and waits
in the Vault view. Since 1.93 the notification's body opens `#/vault/request/<id>` and never
answers; only its **Allow** or **Deny** action does. When the service worker's answer is refused
(401/403 signed out, 423 locked, 404/409 gone, or offline) it opens that request with
`?missed=<why>` so the card says the answer did not go through, and the daemon logs
`vault answer request=<id> refused <status>`. The owner's snapshot also lists answered requests
(id, names, decision, time) for their 15 minutes, so an opened notification can say what happened. A request is answered
once and expires after 15 minutes. A pending request lives in the daemon's memory only (a restart drops it; the agent is told the request no longer exists); the recipes an answer of *Always allow* saves are kept inside `vault.enc`. A request records what it is for (`action`: `run` or `fill`) and who raised it (1.73.4); a continuation (`POST /api/vault/wait`, or `/api/vault/release` with `request`) is refused with 409 `request_mismatch` for the other kind of use, 403 `request_mismatch` from another session, 409 `request_used` once it has been used, and 409 `request_stale` when an item or a policy changed since the answer, or the program or a file the command names changed since the request. Recipes carry the action; older ones are read from their command.

**Typed by Pocket (1.43).** `scripts/pocket-mcp-proxy.mjs [--name <server>] -- <MCP server command…>` is a
stdio MCP relay. Wrap a browser tool with it so agents can fill `{{vault:name.field}}` into web forms:

```bash
claude mcp remove playwright -s user
claude mcp add playwright -s user -- node /path/to/pocket-code/scripts/pocket-mcp-proxy.mjs --name playwright \
  -- npx -y @playwright/mcp --headless --no-sandbox
```

For each tool call that names a placeholder, the relay asks `POST /api/vault/release` (CLI token, plus the runner token
from its environment, so the fill is tied to the session) under the Agent access policy, with the command recorded as
`pocket-fill <server> <tool>`; it types the values into the call and scrubs every value it has released (all forms,
in strings, object keys and numbers; values the owner has since changed stay on the list) from the server's replies,
notifications and stderr for the rest of its life. Values go into fill tools only (1.73.5): `browser_type`,
`browser_fill_form`, `type` and `fill` by default, or the comma-separated list in `POCKET_VAULT_FILL_TOOLS` for another
server; a `browser_evaluate` or `browser_navigate` that names a placeholder is refused and never reaches the server.
Once a value has been typed, image, audio and blob content from the server is replaced by a note for the rest of the
relay's life, since a screenshot of a page showing the value cannot be scrubbed; text snapshots still work. Calls that
make a picture (`browser_take_screenshot`, `browser_pdf_save`, `screenshot`, and any tool in the comma-separated
`POCKET_VAULT_PICTURE_TOOLS`) are refused from then on and never reach the server (1.124.2), because Playwright MCP saves
each picture to a file and names it in its reply. So are the tools that capture the page another way (1.124.5):
`browser_run_code_unsafe`, `browser_start_video`, `browser_stop_video`, `browser_start_tracing`, `browser_stop_tracing`
and `browser_annotate`. So are the reads of cookies and site storage (1.124.8): `browser_storage_state`, the
`browser_cookie_list`/`_get`, `browser_localstorage_list`/`_get` and `browser_sessionstorage_list`/`_get` tools, and any
tool in `POCKET_VAULT_STORAGE_TOOLS`, since after a login they hold its session. `browser_evaluate` and text snapshots still run. A picture or `filename` call sent while a fill waits is held until
the fill settles, and a fill waits up to `POCKET_VAULT_PICTURE_WAIT` seconds (default 30) for one sent before it to
answer, then is refused with nothing typed (1.124.4). A server that closes its input is stopped (SIGTERM, then SIGKILL
after five seconds) and the relay exits non-zero (1.124.4).
`POCKET_VAULT_FILL_WAIT` (seconds, default 90) is how long a fill waits for an approval before telling the agent to
call again; the relay gives the daemon that long plus 15 seconds to answer (1.73.3), refuses an answer that is not one
string per placeholder, and starts the server without any of the daemon's own secrets (the same list `agentEnv` keeps
from agent turns). A signal sent to the relay is passed to the server and followed by SIGKILL five seconds later. If the owner locks the Vault while a request is waiting, the run is told so
(`pocket-vault` exits 3) and the fill is answered `423 vault_locked`; neither can be continued afterwards. The values pass through
the relay and the browser tool, which run as the same OS user as the agent; in normal use the model and the
transcript hold only the placeholder, but the agent drives the page and can read a filled value back. A Claude Code PreToolUse hook could rewrite the call too, but Claude Code records hook output in the transcript
file, so the relay is the only clean path.

**Intake links (1.110).** `/intake/<token>` is served without a login, like `/share/`, so an identity proxy in front of Pocket must let it through for an outside person to reach it; test it from outside in a private window before you send a link. The links live inside `vault.enc`, so a locked Vault answers every link with *Temporarily unavailable* and the link stays open. Branding comes from `POCKET_INTAKE_ORG`, `POCKET_INTAKE_ACCENT` and `POCKET_INTAKE_LOGO` (read at start). The daemon log names a filled link's item and field names, never a value or a token.

**Secret guard (1.42).** `public/secret-detect.js` is one detector for the composer and the daemon. With
`secretGuard` (default true in `pocket-settings.json`) the daemon answers `POST /api/session/:id/message`,
`POST /api/new`, a side chat question and a branch with `422 secret_detected` (kinds and character offsets, never the value) before a delivery receipt
is recorded, unless the body has `allowSecrets: true`. The log line names only the kinds.

**Agent access (1.41).** `vaultAccess` in `pocket-settings.json` is `free`, `once` (default) or
`every`; an item's `policy` is `default` (follow it), `auto`, `ask`, `every` or `owner`. The
store schema is 2: a 1.39/1.40 store's `ask` items were the old default and load as `default`.
A request push carries `actions` (Allow, Deny) and `vaultRequest`; the service worker answers
with `POST /api/vault/act` under the owner's cookie. An owner message in a session with a
pending request that reads "Allow <name> for this command", "Always allow <name> …" or
"Deny <name>" answers it before the message is delivered.

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

1. Close each session process from **Conversation options → Close conversation process**. Decide explicitly whether active
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
  A value that is not a positive number means the default (1.73.7). A stop sends SIGTERM, then
  SIGKILL after five seconds, and reaches an engine that is still starting. A malformed
  `POCKET_VOICE_COMMAND` turns voice off with the reason in `/api/voice/status` instead of stopping
  the daemon from starting.
  The engine exits on its own if Pocket stops. Loading takes a few seconds; the first request after
  idle waits for it.
- **Resources.** About 1 GB of RAM while loaded; each request uses up to 4 CPU threads for
  transcription and 4 for speech. Audio and text are processed in memory and not stored.
- **Health.** `GET /api/voice/status` (signed in) reports whether voice is installed, running and
  the last start error. Engine start and idle stops are logged by the Pocket daemon.
- **Disable or remove.** Set `POCKET_VOICE=off`, or delete `POCKET_VOICE_HOME`. Nothing else
  depends on it.
- **Upgrades.** Rerun the setup script after a release that changes `voice/requirements.txt`.
