# Pocket Code

**Your Claude Code and Codex sessions on desktop, tablet and phone.**

Pocket Code is a self-hosted workspace for running and following Claude Code and Codex
sessions. Work in tabs and split view at your desk, pick up the same sessions on your
phone, and keep what comes out of them (projects, files and to-dos) beside the
conversations. The server runs every turn, so closing the browser or locking the screen
never stops the work.

This checkout documents **1.38.0 / build 84**. See the [changelog](CHANGELOG.md) for
release status and [GitHub Releases](https://github.com/bbesner/pocket-code/releases)
for published versions. An unreleased changelog entry is a candidate, not a release.

Screenshots use synthetic demo sessions, not private conversations.

## Highlights

### Every session, on every screen

Run Claude Code and Codex side by side: a searchable session rail, tabs, and up to four
conversations in split view at your desk. Install it on your phone and the same sessions
are there, with the draft you left.

![Desktop: the session rail grouped by Running, Activity elsewhere, Needs attention and Recent, beside two conversations in split view, each with its own composer](docs/images/desktop-split.png)

### Projects, files and tasks beside the work

Three optional libraries keep what comes out of a session from getting lost. **Projects**
hold where you left off, the next step, a checklist and reminders. **Files** keeps the
reports, dashboards and spreadsheets agents produce, rendered in place and shared only when
you ask. **Tasks** are to-dos with an optional date, linked to the session they came from;
**Start** opens a new session with the task already written in.

<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/projects-desktop.png" alt="A project card: where we left off, the next step, a two-step checklist with one done, a due reminder and the session working on it"></td>
<td width="50%" valign="top"><img src="docs/images/files-desktop.png" alt="The Files library: a CSV count sheet, an HTML ops dashboard and a Markdown weekly summary from a session, each marked Private, with search, project and kind filters"></td>
</tr>
<tr>
<td align="center"><b>Projects</b>: the next step, a checklist and reminders</td>
<td align="center"><b>Files</b>: what the work produced, private until shared</td>
</tr>
</table>

### On your phone, with agents that work with you

When a reply ends with a decision, the options appear as buttons: one tap answers. When the
work needs a later check, such as a report that needs weeks of data or a reply you're
waiting on, the agent offers a task as one of those buttons. Tap it and the task is filed
with the date and a short briefing on the session. Agents keep projects and files current
the same way, through commands and skills that ship with Pocket.

<table>
<tr>
<td width="33%" valign="top"><img src="docs/images/mobile-workspace.png" alt="Phone: a conversation showing an inventory report table, with the composer and message settings below"></td>
<td width="33%" valign="top"><img src="docs/images/tasks-mobile.png" alt="Tasks on a phone: three to-dos, the first due and carrying context from the session it came from, with finished tasks collapsed under Done"></td>
<td width="33%" valign="top"><img src="docs/images/task-offer-mobile.png" alt="A reply ending with three suggested-reply buttons; the recommended one reads Remind me Nov 7 to recheck the numbers"></td>
</tr>
<tr>
<td align="center">A session on the phone</td>
<td align="center">Tasks, due first</td>
<td align="center">An agent offers a task</td>
</tr>
</table>

- **Answer with a tap.** Suggested replies, native agent questions and action-approval
  cards appear in the conversation.
- **Steer or queue.** Redirect a running turn, or save a follow-up for after it.
- **Choose how it runs.** Model, reasoning effort, Review actions or Full access, and
  Codex's Plan first mode, per turn.
- **Know where things stand.** Confirmed server work versus activity elsewhere, a context
  ring with usage and plan limits, and push alerts when a turn finishes.
- **Choose your appearance.** Light, Dark or System, with orange, blue or purple
  highlights. Saved per browser and synchronized across its Pocket windows and split panes.
- **Talk to it (beta).** Speak through the mic beside Send and hear a short summary back,
  all processed on your own server.

## What you can do

### Sessions and the desktop workspace

- **Find any session.** Search titles at once and, after a short pause, inside
  conversations too; a result opens at its match. Filter by workspace, agent and state
  (Active, Attention, New, Pinned); pin, reorder pins, rename, hide or move work.
  Scheduled runs sit in their own Automated group.
- **Titles that keep up.** Untitled sessions get a generated title that follows the work as
  it moves on. Optionally sync names with code-server.
- **Tabs and split view.** Keep open sessions as tabs with status marks; open up to four
  conversations side by side, start a new session in a pane, swap panes and resize them.
  Results, Queue and read-only Git inspection can stay in a side panel.
- **Start faster.** Choose the agent, workspace, model and reasoning on New session; start
  from an installed skill; save a start as a **saved prompt** or repeat a **recent start**.
  Saved prompts live on the server, so the phone and desktop share them.
- **Read the output.** Streamed reports, tables, code, images and checklists, with tool
  calls folded behind a one-line summary. Find text in a conversation, copy messages or
  code, and open linked results. Message times and day dividers, text size and a highlight
  colour (Orange, Blue or Purple) are in Settings.

### On your phone

- **Install it as an app.** The PWA keeps drafts and attachments through reloads and keeps
  the composer, paperclip and Send in reach. Header and message settings collapse
  independently.
- **Catch up quickly.** Coming back to a session with unseen work opens at the end, with a
  **New since** line and, for anything longer than a short exchange, a **While you were
  away** summary of what was done and decided.
- **Know what needs you.** Attention collects questions, approvals, failed turns and
  replies you have not opened; **Mark as reviewed** clears one, on every device.
- **Get alerts.** Optional push notifications, an on-screen chime and per-session muting.
  Push needs HTTPS, server keys and browser permission.

### Appearance

Choose **Light**, **Dark** or **System** in **Settings → Appearance**. Orange, blue and
purple highlights adapt to each mode. Your choice stays on this browser, including its
split panes and other Pocket windows. New browsers follow the system; existing browsers
keep dark mode until you change it.

| Light | Dark |
|---|---|
| ![Light mode: warm paper surfaces, dark text and orange highlights in the conversation workspace](docs/images/appearance-light.png) | ![Dark mode: warm ink surfaces, light text and orange highlights in the same workspace](docs/images/appearance-dark.png) |

### Projects, files and tasks (optional)

Each library is off until Settings → Projects, files & tasks turns it on for the install.

- **Projects** keep a card for each piece of work: where you left off, the next step, a
  checklist, reminders (announced once when due) and the sessions that worked on it. A
  Scheduled view lists every reminder, due first. See [Projects](docs/workspace-guide.md#projects).
- **Files** keeps the reports, dashboards and spreadsheets that came out of the work, in a
  grid or a list. HTML renders sandboxed; PDFs, images, Markdown and CSV render in place.
  Files are private until you share one by link or publicly; removed files wait 30 days
  in the trash. Keep a file from a session's Results, upload one, or let agents keep
  deliverables. See [Files](docs/workspace-guide.md#files).
- **Tasks** are to-dos with an optional date and time, the session they came from and, if
  you want it, a short briefing on that session. **Start** opens a new session with the
  task written in, ready to send. See [Tasks](docs/workspace-guide.md#tasks).
- Projects, files and tasks open as a tab, beside a conversation, in a window of their own,
  or full-screen on the phone.

### Agents that know Pocket

- **Suggested replies.** When a reply ends by asking you to choose a next step, the options
  appear as buttons, the recommended one marked. A tap sends it; the X hides them so you can
  type your own answer.
- **Task offers (1.37).** When the work needs a later follow-up (waiting on time, a test,
  someone's reply, a step you put off), the agent offers a task once, as one of those
  buttons. Nothing is added unless you accept; an accepted offer is filed with the session,
  a briefing the agent writes and the agreed date.
- **Skills and commands.** While a library is on, Pocket installs the `pocket-projects`,
  `pocket-files` and `pocket-tasks` skills for Claude Code and Codex, so any agent on the
  server, in Pocket or a terminal, knows how to keep a project, what "my files" or "docs"
  mean, and how to add a to-do. They use the [agent commands](#agent-commands).

### Answer, approve and steer

- **Questions and approvals.** Native agent questions and action-approval cards appear in
  the conversation. Choose Review actions or Full access for later turns.
- **Steer or queue.** Redirect the running turn, or save a follow-up with After this turn;
  edit, cancel or run paused instructions from Queue. A failed turn offers Send again and
  Edit message, on any device.
- **Choose how it runs.** Model and reasoning effort per turn, and Codex's Plan first mode.
  New session names the agent, model and reasoning it will use.

### Status, limits and usage

- **Trust the status.** Confirmed server work is told apart from activity elsewhere, such as
  the same session open in code-server.
- **Watch the limits.** A context ring beside the composer fills as the session grows
  (hover for tokens; click for the session's usage and plan limits), and shows how long a
  Claude session's prompt cache stays warm. When a usage limit resets, an interrupted turn
  can continue on its own.
- **Accounts.** See this instance's accounts and switch its Claude Code login.

### Voice (beta, optional)

Tap the mic beside Send and speak; a short summary of the reply is read back, and
hands-free mode keeps listening. Speech is processed on your own server. See
[Voice mode](#voice-mode-beta).

### Subagent activity

When a session delegates work, a **Subagents** button shows how many agents are
working. Tap it, then expand an agent to read its task, status and latest activity.
Completed results remain available. **Session options → Subagents** opens the same
view, including when no agents have been recorded yet.

The view refreshes every five seconds while visible. It reads Claude and Codex
records without starting another agent. Background shell jobs are excluded.
Activity outside Pocket, interrupted connections and missing completion records
can show **Status unconfirmed**. Older providers may supply fewer details.

[Phone preview](docs/images/subagents-mobile.png) · [Desktop preview](docs/images/subagents-desktop.png) (synthetic demo data).

[Workspace guide](docs/workspace-guide.md) · [Operations and upgrades](docs/operations.md)
· [Action approvals](docs/action-approvals.md) · [Contributing and releases](CONTRIBUTING.md)

## Desktop and mobile

On desktop, the session rail, tabs, split panes and workspace panel provide separate
places for finding work, reading conversations and inspecting results. Panes that
no longer fit hide in place and return when the window widens. Their drafts and
server processes remain intact.

On phones, the same tools open as sheets. Common session filters remain visible;
additional filters collapse with an applied-filter summary. Scroll buttons expose
message settings that do not fit. The paperclip and Send remain beside the draft.

| Action | What happens to the server session? |
|---|---|
| Close a browser, tab, or existing-session side pane | Work keeps running. |
| A pane hides because the window is too narrow | Its frame, draft and session are retained. |
| Session options → Close session process | Releases an idle process. If work is active, choose Keep running or Stop. |
| Stop in the composer | Interrupts the active turn; pending follow-ups pause. |

Closing an unstarted **New session** side pane removes that pane's unsent draft,
attachments and saved start state. Closing any view does not delete conversation history.

## How sessions work

Pocket drives the installed `claude` and `codex` CLIs. Claude transcripts and Codex's
native session store remain the conversation record; Pocket does not maintain a
separate chat database. Pocket does keep its own settings, delivery receipts, queues,
usage snapshots and runner metadata.

Since 1.7, each Claude session keeps a CLI process between turns, and each Codex
thread keeps an app-server process. Working context, MCP connections and reported
background work can continue between messages. Replies stream to open browsers.
Claude background-job completion can start an agent follow-up without another message.

Idle processes normally close after 60 minutes; the next message resumes the saved
conversation. There is no fixed two-hour turn limit. A separate 30-minute stall
watchdog checks output, pending input and activity from programs started by the turn.
Reported Claude background jobs also prevent idle closure and stall termination.
Operators can change these timings. See [lifecycle and recovery](docs/operations.md).

**Codex's writer lock stays held while Pocket keeps a thread open.** Release its
session process in Pocket before continuing that thread in code-server. Avoid sending
to one conversation from two applications at the same time. Pocket also mirrors
external transcript activity, but recent writes alone cannot prove that work is still running.

Both providers can survive a Pocket daemon restart when started with the supplied
PM2 configuration. This is daemon restart recovery, not host-reboot survival. Pending
native questions and approvals are denied on adoption so the agent can ask again;
an input connection that cannot be recovered is shown as interrupted.

## Agent commands

Agents (and you, from a terminal on the server) keep projects, files and tasks with three
commands that talk to the running server over loopback, using the token it writes to
`<data dir>/cli-token`. Each works only while its library is on. The full usage is in the
header of each script in `scripts/`; the shipped skills explain when to use them.

| Command | Common use |
|---|---|
| `pocket-board` | `track --requested --name "…" --summary "…" --next "…"`, `update`, `task add\|done`, `remind --at "YYYY-MM-DDTHH:MM"`, `note`, `status [--all]`, `scheduled`, `link-session <id>` |
| `pocket-docs` | `add <path> [--title] [--project] [--session]`, `list`, `show <id>`, `share <id>`, `set <id> --visibility private\|link\|public`, `trash <id>` |
| `pocket-tasks` | `add "…" [--due] [--session <id>] [--summary "…"] [--dir]`, `list [--all]`, `show <id>`, `done <id>`, `edit <id>`, `remove <id>` |

Create a project or task only when the user asks for one; keep files private unless the
user asks to share. Times without an offset use `POCKET_TZ` (or the server's zone).

## Requirements

- Linux with Claude Code installed and signed in; Codex is optional.
- Node.js 20.11 or newer for the server; Node.js 22.12+ and Chrome/Chromium for tests.
- PM2 using the supplied `ecosystem.config.cjs`, or a supervisor configured to preserve
  child session processes during a daemon restart.
- HTTPS through a tunnel or reverse proxy for secure login, installation and push.
- The daemon plus capacity for CLI and MCP processes. One Pocket process does not mean
  the whole installation uses only one OS process.

## Quick start

```bash
git clone https://github.com/bbesner/pocket-code.git ~/pocket-code
cd ~/pocket-code
npm ci --omit=dev

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

Server configuration comes from the process environment or `.env` (see [`.env.example`](.env.example)). Existing environment values take precedence over that file. Browser preferences such as drafts, tabs, filters and text size stay on each device.

| Variable | Required | What it does |
|---|---|---|
| `POCKET_PASSWORD` | yes | Login password. Make it long and random. |
| `POCKET_SECRET` | yes | Secret used to sign the login cookie (`openssl rand -hex 32`). |
| `PORT` | no | Local port. Default `3610`. The server only listens on `127.0.0.1`. |
| `VAPID_PUBLIC`, `VAPID_PRIVATE` | for push | Web-push keys. Without them, push is off. |
| `VAPID_CONTACT` | for push | Your email or an https URL, given to push services as the operator contact. |
| `CLAUDE_BIN` | no | Path to `claude`, if it isn't found automatically. |
| `POCKET_CODEX` | no | Set to `0` to hide Codex sessions even when `codex` is installed. |
| `POCKET_CHOICES` | no | Set to `0` to stop asking agents for reply suggestions (the buttons under a closing question). |
| `POCKET_AUTO_TITLES` | no | Starting value for **Settings → Generate short titles** (on unless `0`). Titles are made for sessions named only by their first message, with the signed-in Claude CLI (Haiku, about 400 tokens each) or Codex (GPT-6-Luna, about 25k tokens each), on that CLI's own account: your subscription, or an API key if that is how the CLI is signed in. After the first change in Settings, the Settings value wins. |
| `POCKET_TITLE_CLAUDE_MODEL`, `POCKET_TITLE_CODEX_MODEL` | no | Models for generated titles. Defaults `haiku` (the Claude CLI's newest Haiku) and `gpt-6-luna`. |
| `POCKET_LIVE_TITLE_GAP_MS` | no | Minimum time between two title checks on one session (**Settings → Update titles as sessions progress**). Default ten minutes. |
| `POCKET_MEMSTEM_URL` | no | MemStem daemon for searching inside conversations. Default `http://127.0.0.1:7821`; without a healthy MemStem, Pocket searches recent conversations itself. `POCKET_MEMSTEM=0` turns MemStem search off. |
| `CODEX_BIN`, `CODEX_HOME` | no | Path to `codex` and its home directory, if not the defaults. |
| `POCKET_RETRY_BUFFER_MS` | no | Wait after a usage-limit reset before auto-continuing. Default 5 minutes. |
| `POCKET_CLAUDE_MODEL`, `POCKET_CLAUDE_EFFORT` | no | Pocket-only Claude default for turns left on Default, e.g. `claude-opus-5-5[1m]` and `high`. Model must be one of the picker ids. |
| `POCKET_CODEX_MODEL`, `POCKET_CODEX_EFFORT` | no | Pocket-only Codex default, e.g. `gpt-6-sol` and `medium`. |
| `POCKET_DEFAULT_CWD` | no | Workspace the New session screen preselects, e.g. your home directory. Default: wherever you last started a session. |
| `POCKET_IDLE_CLOSE_MS` | no | How long a session's process (Claude Code or Codex) stays up with no turn and no background job, in milliseconds. Default `3600000` (1 hour); `0` keeps processes until Pocket closes them for another reason. |
| `POCKET_STALL_MS` | no | A turn with no output, no background job, nothing waiting on you and no CPU use by programs it started for this long is stopped. Milliseconds; default `1800000` (30 minutes); `0` disables the watchdog. A value that is not a number is logged and ignored. |
| `POCKET_MAX_PROCESSES` | no | Soft target for live CLI processes (Claude Code and Codex together) kept at once. Starting one past the cap closes the longest-idle process that has no turn and no background job. Default `8`; `0` means no cap. Active work is never evicted to meet this target, so the count can exceed it. CLI and MCP processes add memory beyond the Pocket daemon. |
| `POCKET_APPROVAL_MODE` | no | Default permissions for new turns: `review` (default) or `full`. |
| `POCKET_ALLOW_FULL_ACCESS` | no | Set to `0` to reject Full access in both API and UI. |
| `POCKET_DATA_DIR` | no | Pocket state and runner files; defaults to the checkout. Move only after all session processes are closed. |
| `POCKET_SESSION_ROOT` | no | Override Claude transcript storage for isolated tests; does not relocate Codex. |
| `POCKET_REMINDER_HOOK` | no | A command run when a project reminder (Projects, 1.29) or a dated task (Tasks, 1.36) comes due, with it as JSON on its standard input. A reminder carries `project`, `projectName`, `reminder`, `label`, `dueAt`, `task`, `taskText`, `url`; a task carries `kind: "task"`, `task`, `text`, `dueAt`, `session`, `url`. It runs through the shell, with the same environment as agent turns: Pocket's own secrets are removed (1.37.1). Each one is announced once. Use it for email, chat or anything else; web push happens regardless. |
| `POCKET_DOCUMENTS_DIR` | no | Where Files (1.30; Documents before 1.34) keeps files. Default `<data dir>/documents`. Files placed there appear as private files; removed files wait in its `.trash` for 30 days. |
| `POCKET_SKILLS` | no | `0` stops Pocket installing its `pocket-projects`, `pocket-files` and `pocket-tasks` agent skills into `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills`) and `$CODEX_HOME/skills` (1.34, tasks 1.36). Only folders carrying Pocket's `.pocket-managed` marker are touched. On by default while the matching feature is on. |
| `POCKET_CHROME`, `POCKET_PDFTOPPM`, `POCKET_CONVERT` | no | The tools that make the library's preview pictures (1.32): a Chrome or Chromium binary for HTML reports (and images when ImageMagick is absent), `pdftoppm` from poppler for PDFs, ImageMagick's `convert` for images. Found automatically in the usual places and on `PATH`; set one to a path to choose it, or to an empty value to turn it off. Pictures are cached in `<documents dir>/.thumbs`. A kind without a tool shows its name on the card instead. |
| `POCKET_TZ` | no | Time zone for `pocket-board` reminder and `pocket-tasks --due` times given without an offset, e.g. `America/New_York`. Default: the server's zone. |
| `POCKET_URL` | no | Base address the `pocket-board`, `pocket-docs` and `pocket-tasks` commands use to reach the server. Default `http://127.0.0.1:$PORT`. |
| `POCKET_PUBLIC_URL` | no | Makes the share addresses `pocket-docs` prints absolute, e.g. `https://pocket.example.com`. |
| `POCKET_REMINDER_CHECK_MS` | no | How often due reminders and tasks are checked. Default 60000 (one minute); mainly for tests. |
| `POCKET_VOICE_COMMAND` | no | A JSON array that replaces the command starting the voice engine. For tests and custom engines. |
| `POCKET_FRAME_ANCESTORS` | no | Origins allowed to embed Pocket Code in a frame (for example Mission Control), space-separated. Default: only Pocket's own origin. |
| `POCKET_VOICE` | no | Set to `off` to disable voice mode even when it is installed. |
| `POCKET_VOICE_HOME` | no | Where `scripts/voice-setup.sh` installed the voice engine. Default `~/.local/share/pocket-code/voice`. |
| `POCKET_VOICE_IDLE_MS` | no | How long the voice engine stays loaded after its last use, in milliseconds. Default `900000` (15 minutes). |
| `POCKET_ENV_FILE` | no | Read settings from this file instead of `.env` next to the server; empty means read none (the test suite sets it). |

Turns use your global CLI settings (`~/.claude/settings.json`, Codex config), such as
the default model, effort and hooks, unless you override them per turn in the composer.
The `POCKET_*_MODEL`/`_EFFORT` variables change the default for Pocket turns only; your
terminal and editor sessions keep the CLI settings. Hooks and instructions still apply.

## Security and approvals

Pocket Code runs as your server's OS user. **Anyone who can sign in can authorize
commands with that user's access.** Review actions is the default, while an operator
can enable or disallow Full access. These modes are execution controls, not employee
accounts or an isolation boundary. Changing the mode affects subsequent turns;
steering does not change permissions on an already-running turn.

The app binds to loopback, uses a signed secure cookie and login rate limiting, and
sends a same-origin Content Security Policy. Allow embedding origins explicitly with
`POCKET_FRAME_ANCESTORS`. Keep `.env`, private state and transcripts out of version control.
Use an additional identity layer in front when appropriate for your installation.
Read the [security model](SECURITY.md) and [approval/recovery behavior](docs/action-approvals.md).

## Operating and upgrading

Use the ecosystem file when starting or restarting PM2. Its `treekill: false` setting
preserves detached session processes so the new daemon can reattach. The PM2 process
is still called `pocket-claude` for compatibility with existing installations.

Upgrade to a reviewed release, preserve configuration and runtime state, install the
lockfile's dependencies, restart from the ecosystem file, then verify the server and
browser build. Do not restore an old state snapshot over newer queues or receipts.
Before moving data, uninstalling, or downgrading below 1.7, close **all session processes**,
including idle Codex app-servers. The [operations guide](docs/operations.md) gives the
state inventory, health checks, upgrade steps and rollback requirements.

## Voice mode (beta)

Voice mode is optional and in beta: it works, and its behavior is still being tuned from real use.
It lets you speak to a session and hear its reply read aloud, as briefly or fully as you choose.
Speech-to-text ([faster-whisper](https://github.com/SYSTRAN/faster-whisper), `small.en`) and
text-to-speech ([Kokoro](https://github.com/thewh1teagle/kokoro-onnx)) run in a local process on
the Pocket server. No audio or text goes to a speech service, and there are no per-use fees.

```bash
bash scripts/voice-setup.sh   # Python 3 venv + models, about 1.3 GB; then restart Pocket Code
```

The engine starts the first time someone uses the mic (a few seconds) and stops after 15 idle
minutes. While loaded it uses about 1 GB of RAM and a few CPU cores per request; no GPU is needed.
On a 16-vCPU server a spoken command took about 1 second to transcribe, and the first sentence of
a reply was ready in under a second. Without the install, the mic button stays hidden.

- **Tap** the mic and speak; it sends when you pause. **Hold** it for push-to-talk. The mic sends one
  message and does not listen again.
- **Hands-free:** tap the headset beside the mic. Each reply is read aloud and the mic listens for your
  answer (up to 2 minutes by default) until you tap the headset again, tap Cancel or stay quiet. It is
  never on unless you start it, and it hides while you have a typed draft. Each instruction is read back
  and sent only after you say "send it" or tap Send.
- Short commands are answered without the agent: *what's it doing*, *stop*, *read it*,
  *read it all*, *what's waiting on me*, *be quiet*, and *mute* or *unmute* the voice. Anything else is
  sent as a normal message.
- Settings → Notifications & voice: speak replies, spoken reply length (Brief: one sentence; Normal: about two;
  Detailed: the whole reply without code, tables or links), review before sending, how long hands-free
  waits for your reply, voice and names to recognize. Approvals still need a tap.
- **Spoken alerts.** Settings → Notifications & voice → Announce sessions says when any session finishes ("The SCK
  inventory session finished", optionally with a one-line summary) or needs your approval or answer,
  in place of the chime, while Pocket is open. Muted sessions stay quiet; push covers a closed app.
  Announcements never turn the microphone on, even during a hands-free conversation.

Browsers allow the microphone only over HTTPS. An embedding page must grant the frame
`allow="microphone"`. Details: [workspace guide](docs/workspace-guide.md#voice-mode-beta) and
[operations](docs/operations.md#voice-engine).

## Optional MemStem integration

Agent turns use the CLI's configured instructions, skills, hooks and MCP servers.
If you already use [MemStem](https://github.com/Memstem/memstem), its shared memory is
available through those agents just as it is from the terminal or editor. Pocket Code
does not require MemStem and does not configure it for you.

## Development

```bash
npm ci
npm run check:release
npm test
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run test:browser
```

Tests use temporary stores, fake provider CLIs and synthetic browser sessions. They
require no model credentials. The browser suite covers responsive layouts, delivery
recovery, questions/approvals, split panes, keyboard behavior and axe accessibility
checks. Physical-device input, real screen readers and OS push delivery still need
manual validation.

[CONTRIBUTING.md](CONTRIBUTING.md) explains local development, CI, screenshot capture,
version consistency and release gates. Historical implementation plans are references;
the workspace and operations guides describe current behavior.

## Bugs and feature requests

Pocket Code is developed in the open. Report bugs and ask for features in
[GitHub Issues](https://github.com/bbesner/pocket-code/issues); the issue forms ask for
the details that make a report actionable. **Settings → Help & updates → Bugs & feature requests** in the
app opens the same forms with your version and build already filled in.

Security problems go through **Security → Report a vulnerability** on the repository, not
a public issue. See [SECURITY.md](SECURITY.md).

## License

Pocket Code is MIT licensed. See [LICENSE](LICENSE). It is an independent project,
unaffiliated with Anthropic or OpenAI. Claude and Claude Code are trademarks of
Anthropic; Codex is a trademark of OpenAI.
