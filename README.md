# Pocket Code

**Your Claude Code and Codex sessions, from your phone.**

![Three Pocket Code screens on a phone: the session list, a turn in progress that has just checked MemStem for a past decision, and the finished result with passing tests](docs/images/hero.png)

Pocket Code is a small, self-hosted web app for coding with AI agents while you're away
from your desk. Open it on your phone, pick up any session you started in the terminal
or in VS Code / code-server, send the next instruction, and put the phone away. The work
runs on your server, not in your browser, so it keeps going when the screen goes dark.
When the turn finishes, you get a notification.

There's no new agent to learn, no sync service and no separate history. Pocket Code
drives the real `claude` and `codex` CLIs on your machine and reads the same session
files they write. A session you start on the phone is waiting in your terminal when you
sit back down, and the reverse.

- **One server, any screen.** Installable PWA for phone and tablet, with a two-pane
  layout on desktop.
- **Walk-away turns.** A daemon on the server runs every turn headlessly. Close the tab,
  lose signal, lock the phone: the turn still finishes.
- **The same sessions everywhere.** Claude Code transcripts in `~/.claude/projects` and
  Codex threads in `~/.codex` are the only source of truth.
- **Tiny footprint.** One Node process, no application build step, and no database.
  Marked and DOMPurify provide the Markdown parser and browser sanitizer.

## Works great with MemStem

Pocket Code turns go through your own CLI install, so they use everything that install
is set up with: your `CLAUDE.md` files, skills, hooks, slash commands and **MCP servers**.
That makes it a natural companion to [MemStem](https://github.com/Memstem/memstem), a
self-hosted memory system for AI agents:

- With MemStem connected as an MCP server, the agent answering you on the phone
  searches and updates **the same central memory** as your desktop sessions. Decisions,
  project state and past work follow you, and nothing is siloed on a mobile app.
- Phone turns are written to the normal Claude Code session store, so MemStem's
  session ingestion indexes them like any other session. What you worked out on the
  train is findable from your desk the next morning.

![Phone, terminal and VS Code all run the same Claude Code and Codex setup, which recalls from and saves to one MemStem memory and has every session indexed](docs/images/memstem.png)

You don't need MemStem to use Pocket Code, but the two work well together: one memory,
every surface.

## How it works

![Your phone connects over HTTPS to Pocket Code on your server, which runs claude and codex against the same session files your terminal and VS Code use, and sends a push notification when a turn finishes](docs/images/how-it-works.png)

Each Claude Code session runs as one detached CLI process on the server, started by your
first message and kept between turns, so its working directory, MCP connections and
background jobs carry over. Output streams to every open client over server-sent events
and lands in the normal transcript. When a background job finishes after a turn, the
agent's follow-up streams the same way. The process closes after an hour idle (never
while a background job runs), and the next message resumes the session from its
transcript. There is no time limit on a turn; one that stays completely silent for 30
minutes is stopped. Codex threads work the same way with one app-server per thread.
While Pocket has a Codex thread open it holds Codex's writer lock, so close the session
in Pocket (or let it idle out) before continuing that thread in code-server. Both kinds
of session process survive a Pocket restart, including a turn in the middle of its work.

A file watcher also mirrors sessions you're driving from somewhere else, so the phone
shows live progress for work started in the terminal or code-server. Pocket won't send
into a session another app is in the middle of, and it restarts its own process for a
session when another app has added turns since, so its process never carries a stale copy of the conversation.

## Features

![Pocket Code on a desktop browser: the session list in a side rail next to a finished conversation](docs/images/desktop.png)

**Sessions**
- Grouped sessions and filters for running work, recorded failures and new responses.
  Pocket-owned runs are confirmed; recent activity from terminal/editor sessions is
  labeled separately because transcript writes cannot prove a process is still running.
- A mobile session switcher and searchable desktop rail, with visible session menus.
- Desktop split view preserves hidden panes and drafts when the window narrows.
  Close session process is in Session options; closing a tab or side pane only closes its view.
- Search by title, or across full transcripts.
- Pin and rename sessions, with optional two-way name sync with Claude Code and
  code-server.
- Start a new Claude Code or Codex session in any project directory.

**Chat**
- Word-by-word streaming, with compact lines showing what each tool is doing.
- Per-turn cost and duration, inline images, and a checklist view of the agent's plan.
- **Steer mid-turn:** send a correction while the agent is still working. Messages sent
  while a turn is running are queued.
- A stop button, a changed-files view, find-in-conversation, copy buttons and drafts
  that survive a reload.
- File and photo attachments with thumbnails. Outgoing messages and attachment
  references survive reloads and failed sends; retry uses the same request identifier.
- Slash commands with autocomplete, picked up from your skills and commands.

**Models**
- Per-turn model and reasoning-effort pickers for Claude Code (Fable, Opus, Sonnet,
  Haiku). The Codex model list comes live from your installed CLI.
- When a Claude Code turn hits a usage limit, it continues on its own after the limit
  resets.

**Notifications**
- Push notification when a turn finishes and you're not watching (tested on Android and
  desktop Chrome). Optional chime, and mute per session.

**Housekeeping**
- A settings sheet showing app, CLI and Codex versions, "What's new" after each update,
  and a one-tap update check.

## Requirements

- A Linux server where the **Claude Code CLI** is installed and logged in. The
  **Codex CLI** is optional: Codex sessions appear automatically when `codex` is
  installed.
- **Node.js 20.11 or newer** (tested on Node 22).
- **PM2** or systemd to keep the service running.
- **HTTPS** to reach it. A Cloudflare Tunnel is the easiest option; any reverse proxy
  with TLS works. The PWA install, secure login cookie and push notifications all need
  HTTPS.

## Quick start

```bash
git clone https://github.com/bbesner/pocket-code.git ~/pocket-code
cd ~/pocket-code
npm install --omit=dev

# 1. Configure: password, cookie secret and push keys
PW=$(openssl rand -base64 18)
KEYS=$(npx web-push generate-vapid-keys --json)
cat > .env <<EOF
PORT=3610
POCKET_PASSWORD=$PW
POCKET_SECRET=$(openssl rand -hex 32)
VAPID_PUBLIC=$(echo "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0)).publicKey')
VAPID_PRIVATE=$(echo "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0)).privateKey')
VAPID_CONTACT=you@example.com
EOF
chmod 600 .env
echo "Your Pocket Code password: $PW"

# 2. Run it (always start from the ecosystem file; see "Operating notes")
pm2 start ecosystem.config.cjs
pm2 save

# 3. Check it's up
curl -s localhost:3610/api/health        # {"ok":true,...}
```

Next, give it an HTTPS address. With a Cloudflare Tunnel, add an ingress rule ahead of
the catch-all in `~/.cloudflared/config.yml`, route the DNS name to the tunnel and
restart `cloudflared`:

```yaml
- hostname: code.yourdomain.com
  service: http://localhost:3610
```

On your phone, open the address, sign in and choose **Add to Home screen**. Then tap
the bell icon to turn on notifications.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)).

| Variable | Required | What it does |
|---|---|---|
| `POCKET_PASSWORD` | yes | Login password. Make it long and random. |
| `POCKET_SECRET` | yes | Secret used to sign the login cookie (`openssl rand -hex 32`). |
| `PORT` | no | Local port. Default `3610`. The server only listens on `127.0.0.1`. |
| `VAPID_PUBLIC`, `VAPID_PRIVATE` | for push | Web-push keys. Without them, push is off. |
| `VAPID_CONTACT` | for push | Your email or an https URL, given to push services as the operator contact. |
| `CLAUDE_BIN` | no | Path to `claude`, if it isn't found automatically. |
| `POCKET_CODEX` | no | Set to `0` to hide Codex sessions even when `codex` is installed. |
| `CODEX_BIN`, `CODEX_HOME` | no | Path to `codex` and its home directory, if not the defaults. |
| `POCKET_RETRY_BUFFER_MS` | no | Wait after a usage-limit reset before auto-continuing. Default 5 minutes. |
| `POCKET_CLAUDE_MODEL`, `POCKET_CLAUDE_EFFORT` | no | Pocket-only Claude default for turns left on Default, e.g. `claude-opus-5-5[1m]` and `high`. Model must be one of the picker ids. |
| `POCKET_CODEX_MODEL`, `POCKET_CODEX_EFFORT` | no | Pocket-only Codex default, e.g. `gpt-6-sol` and `medium`. |
| `POCKET_DEFAULT_CWD` | no | Workspace the New session screen preselects, e.g. your home directory. Default: wherever you last started a session. |
| `POCKET_IDLE_CLOSE_MS` | no | How long a session's process (Claude Code or Codex) stays up with no turn and no background job, in milliseconds. Default `3600000` (1 hour); `0` keeps processes until Pocket closes them for another reason. |
| `POCKET_STALL_MS` | no | A turn with no output, no background job, nothing waiting on you and no CPU use by programs it started for this long is stopped. Milliseconds; default `1800000` (30 minutes); `0` disables the watchdog. A value that is not a number is logged and ignored. |
| `POCKET_MAX_PROCESSES` | no | Live CLI processes (Claude Code and Codex together) kept at once. Starting one past the cap closes the longest-idle process that has no turn and no background job. Default `8`; `0` means no cap. Each Claude Code process is roughly 100–300 MB plus its MCP servers. |
| `POCKET_FRAME_ANCESTORS` | no | Origins allowed to embed Pocket Code in a frame (for example Mission Control), space-separated. Default: only Pocket's own origin. |
| `POCKET_ENV_FILE` | no | Read settings from this file instead of `.env` next to the server; empty means read none (the test suite sets it). |

Turns use your global CLI settings (`~/.claude/settings.json`, Codex config), such as
the default model, effort and hooks, unless you override them per turn in the composer.
The `POCKET_*_MODEL`/`_EFFORT` variables change the default for Pocket turns only; your
terminal and editor sessions keep the CLI settings. Hooks and instructions still apply.

## Security

> **Pocket Code gives whoever has the password the same power as a shell on your server.**

New turns default to **Review actions**. Claude asks before commands, edits, delegated
tasks and external tools. Codex starts with a read-only sandbox and untrusted-command
approval policy; safe reads and existing provider tool allow-rules can still run
without prompting. Native pending actions appear in an authenticated approval sheet.
**Full access** retains unattended execution and skips routine tool permission prompts.
The owner can change the next-turn mode in the composer or Session options.

Set `POCKET_APPROVAL_MODE=review|full` for the instance default and
`POCKET_ALLOW_FULL_ACCESS=0` to reject Full access through its API and UI. These controls
are operator conveniences, not an employee security boundary: the agent still runs as
the server's OS user, with its credentials and installed tools. An approved shell command
or delegated task can have multiple effects. Employee identity/resource isolation and
fine-grained Google action policies require a separate restricted connection service.
See [approval behavior and recovery](docs/action-approvals.md).

The built-in protections:

- The API listens on `127.0.0.1` only and is reached only through your HTTPS front end.
- Constant-time password check, and a limit of 20 login attempts per hour per IP.
- HMAC-signed, `HttpOnly`, `Secure` session cookie (90 days).
- A Content-Security-Policy that keeps scripts, styles, connections and images
  same-origin and allows framing only from `POCKET_FRAME_ANCESTORS`.

Recommended on top: a long random password, a hostname you don't publish, and an
identity layer such as [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
in front for a second factor. Run it on a machine where that trade-off is acceptable.
See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Operating notes

- **Start and restart from `ecosystem.config.cjs`.** It sets PM2's `treekill: false`, so
  session processes survive a restart of the service. A restarted server reattaches to
  every running Claude Code and Codex process, including a turn in the middle of its
  work. A question or approval that was waiting at the moment of the restart is answered
  with a deny so the turn carries on (the agent asks again if it still needs it); only a
  process whose input pipe cannot be reopened is left marked as interrupted.
- **One live writer per session.** Watching a session from several places is always
  fine. Don't send to the same session from two places at the same moment. Hand off
  instead: finish on one, continue on the other. Codex enforces this. If a thread is
  open for writing in code-server, Pocket Code tells you to close it there first.
- **Data:** transcripts stay where the CLIs keep them. Uploads go to `~/pocket-uploads/`.
  Pocket's own state lives in `POCKET_DATA_DIR` (default: next to the server, ignored by
  git): push subscriptions, pins and mutes, settings, delivery receipts, the follow-up
  queue, the approval audit, usage snapshots (`usage-state.json`,
  `codex-usage-state.json`), the fork-guard marker (`owned-transcripts.json`) and the
  per-process logs and pipes under `turnlogs/` and `turnlogs-codex/`. Keep all of it
  across upgrades. If you move the directory, do it while no process is running
  (`/api/health` shows `processes` and `codexProcesses`), since the running processes
  write to the old location.
- **Updating:** `git pull && pm2 restart ecosystem.config.cjs`. Browsers pick up the new
  version automatically, and the settings sheet shows what changed.
- **Uninstalling:** close every session first (Close session in the app, or
  `POST /api/session/<id>/release` for each one `/api/health` counts), then
  `pm2 delete pocket-claude` and remove the tunnel or proxy route. Processes left running
  would otherwise keep going (and a Codex app-server keeps its thread's writer lock)
  because the idle timers live in the daemon. Your sessions are untouched.
- **Rolling back below 1.7:** close every session the same way before switching the
  code, so no runner is orphaned; an older server does not know the `*.runner.json`
  markers or `turnlogs-codex/`. The newer state files are harmless to older code.

The PM2 process is named `pocket-claude`, from before the project was renamed. The name
was kept so existing installs upgrade in place.

## Changelog and license

Release history is in [CHANGELOG.md](CHANGELOG.md). Pocket Code is MIT licensed. See
[LICENSE](LICENSE).

Pocket Code is an independent project and is not affiliated with Anthropic or OpenAI.
Claude and Claude Code are trademarks of Anthropic; Codex is a trademark of OpenAI.

Screenshots in this README show demo projects and sessions.

## Development and releases

See [the session workspace preview](docs/session-workspace.md) and
[the implementation plan](IMPLEMENTATION-PLAN.md) for the staged mobile/desktop
workspace improvements. Version 1.2.0 adds reports, session results, saved follow-ups and skill discovery. Each
release updates `package.json`, `package-lock.json`, the changelog and in-app notes.
Frontend releases also increment the asset number in `public/index.html` and
`public/sw.js`. Create the matching Git tag and GitHub release after validation and
merge; do not tag an unfinished branch.

Development browser tests require Node.js 22.12 or newer and Chrome/Chromium.

```bash
npm ci
npm test
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run test:browser
```

Tests use temporary session stores, a fake CLI and synthetic browser fixtures. They
do not call a model or require production credentials. Browser checks cover 360,
390, 768 and 1440px widths, session filters, keyboard dialogs, saved drafts and
attachments, response-loss retries and stale status. They do not replace physical
phone keyboard, screen-reader or live-provider testing.

`POCKET_DATA_DIR` optionally relocates Pocket-owned settings, turn logs and delivery
receipts. It defaults to the application directory. Stop the daemon and copy its
existing state files before changing this path on an existing installation. Keep one
daemon per data directory. `POCKET_SESSION_ROOT` overrides the Claude transcript
root for isolated test installations; it does not move Codex's store.

Delivery receipts contain request hashes and response metadata, not message text.
Keep `delivery-receipts.json` with the instance's persistent data, including across
upgrades and rollbacks. Receipts are kept for seven days (at most 2,000), long enough
for any retry of the same message. A process interruption between dispatch and saving acknowledgment is
reported as uncertain and is never automatically dispatched again. These receipts
prevent duplicate dispatch; they do not guarantee that a tool action completes.
Keep `followup-queue.json` as well: it contains pending instructions. The existing single-user trust model remains unchanged.

## Reports, Results and follow-ups (1.2)

- Reports render tables, quotes, nested lists, checklists and headings. Tables scroll
  horizontally inside the message on a phone. Agent-supplied HTML is escaped and
  parsed Markdown is sanitized with [DOMPurify](https://github.com/cure53/DOMPurify),
  following [Marked's security guidance](https://marked.js.org/using_advanced).
- **Results** collects assistant-shared links and report paths from up to the latest
  4,000 normalized messages, keeping the latest 200 unique references. Some Codex
  threads have runtime paging limits. A result is a reference, not a guarantee that
  a remote document exists or that a local file was successfully generated.
- Supported local reports must be referenced by that session and resolve inside
  the operator's home directory, outside hidden folders. Downloads require login
  and use attachment disposition, a sandbox policy and no-store headers. Existing
  external document links retain their own sharing and authentication rules.
- **Steer now** sends to the active turn. **After this turn** saves a separate
  follow-up. Open **Queue** to edit/remove pending text or run a paused queue.
  Stopping or failing a turn pauses automatic drain. A later successful turn can
  resume the backlog; after a server restart, unowned queues wait for an explicit
  new turn or **Run next instruction**. An uncertain dispatch blocks later entries
  until you review the conversation and remove the uncertain entry.
- The queue stores text and options in `followup-queue.json` (private runtime data).
  Keep it across upgrades and rollbacks, with one daemon per data directory.
  Edits use revisions to reject stale writes; dispatched items cannot be edited.
- **Choose a skill** searches skills installed for the selected agent/workspace.
  Claude scans its skill/command folders; Codex uses its installed runtime's
  `skills/list`. Choosing a skill inserts an editable instruction; it does not run
  anything until you press Start. Discovery is not an employee permissions system.
- Drafts and reading position stay on the current browser/device. This release
  supports native agent questions and, from 1.4, action approval cards. Employee roles
  and identity isolation remain future work.

Browser libraries are pinned in package-lock.json and vendored with their licenses.
After updating either package deliberately, run `npm run vendor`, review the diff,
then run the Markdown security and browser tests before releasing.

### Daily desktop workspace (1.3)

Open-session tabs, workspace/agent/pinned filters, keyboard navigation and an
optional Results / Queue / Git panel make Pocket Code usable at the desk. The
phone keeps its focused conversation and sheets. Native Claude questions and
Codex Plan-first questions can be answered directly; Accounts & instance shows
the provider identities used by this server. Editing a queued instruction pauses
it until saved or canceled. See [daily workspace details](docs/daily-workspace.md)
for behavior, keyboard shortcuts, Git limits and restart recovery.
