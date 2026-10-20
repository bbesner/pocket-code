# Pocket Code

**Run ten Claude Code and Codex sessions at once, and always know which one needs you.**

Pocket Code is a self-hosted workspace for people who use Claude Code or Codex for more
than one thing at a time. Sessions run on your server, so closing the browser, locking the
phone or restarting the app changes nothing. A session rail sorts what is running, what is
waiting on you and what just finished. Saved prompts start recurring work in a tap. Agents
answer with buttons, offer a to-do when work needs a later check, keep the reports they
produce in Files, and use credentials from an encrypted Vault without ever seeing them.
At your desk it is tabs and four-way split view. On your phone it is the same workspace,
installed as an app.

This checkout documents **1.72.0 / build 141**. See the [changelog](CHANGELOG.md) for
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

Four optional libraries keep what comes out of a session from getting lost. **Projects**
hold where you left off, the next step, a checklist and reminders; **Start session** opens a new
session briefed on where the project stands and linked to it. **Files** keeps the
reports, dashboards and spreadsheets agents produce, rendered in place and shared only when
you ask. **Tasks** are to-dos with an optional date, linked to the session they came from;
**Start** opens a new session with the task already written in, and a **start link** lets an agent or a job on the server hand Pocket a briefing that opens the same way. The **Vault** keeps API keys,
tokens and logins encrypted on the server; agents use them by name, in commands or typed into
a web page's login form, and never see the values. You decide how much they may do without
asking, and every use is recorded. Lists keep up on their own: something an agent adds
mid-turn shows up without a reload.

<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/projects-desktop.png" alt="A project card: where we left off, the next step, a two-step checklist with one done, a due reminder and the session working on it"></td>
<td width="50%" valign="top"><img src="docs/images/files-desktop.png" alt="The Files library: a CSV count sheet, an HTML ops dashboard and a Markdown weekly summary from a session, each marked Private, with search, project and kind filters"></td>
</tr>
<tr>
<td align="center"><b>Projects</b>: the next step, a checklist and reminders</td>
<td align="center"><b>Files</b>: what the work produced, private until shared</td>
</tr>
<tr>
<td colspan="2" valign="top"><img src="docs/images/vault-desktop.png" alt="The Vault: a waiting request from an agent to run a command with the zoho-books secret, with Deny, Always allow and Allow once, above five secrets showing their kind, site and how much agents may do with each"></td>
</tr>
<tr>
<td colspan="2" align="center"><b>Vault</b>: agents ask before they use a secret, and never see its value</td>
</tr>
</table>

### Developer mode or Assistant mode

Pocket has two faces on the same server, sessions, Files, Tasks and Vault.

- **Developer mode** is the workbench: the session rail, tabs and split view, the model,
  reasoning and permission chips on every message, Results, Queue, Git, changed files, the
  subagent panel, cost and timing. For people who run coding agents and want to see the
  machinery.
- **Assistant mode** is for people who never write code: an account manager drafting a
  proposal, a warehouse manager marking stock, anyone making a deck or a document. It opens on
  the message box ("What would you like done?"), shows what is waiting for you and your recent
  conversations, picks the model for you, keeps steps and approvals in plain words, and calls
  the app **Pocket Assistant**. Nothing is removed underneath: every conversation, file and task
  is the same one the developer view shows, and **Show details** still opens the raw step.

Switch in **Settings → Appearance → Mode** (this Pocket, every device). An
administrator can set it for an install with `POCKET_ASSISTANT_MODE=on` or lock it with
`locked`, which is how a seat for an employee is provisioned. **If you write code or run
coding agents, stay in Developer mode; if Pocket is your assistant for office work, use
Assistant mode.**

![Assistant mode at a desk: Pocket Assistant opens on "What would you like done?", with an Inbox Watch alert and an unfinished conversation waiting above it and the Files, Tasks, Projects, Vault and Inbox chips below](docs/images/assistant-home-desktop.png)

### Inbox Watch: your mailbox, read for you

A watcher beside Pocket reads your Gmail on the schedule you set and interrupts you only when
an email tells you something the email itself does not: the third outage this week at the same
site, a reminder that contradicts what the customer asked for, a bill that is now due. Each
alert lands in **Inbox** with **Start a conversation**, which opens one already briefed with
the story and the Gmail links. A morning digest and a look-ahead cover the rest.
**Schedule, models and cost** (1.70) sets when it checks (periods with their own days, hours
and interval), quiet hours, the digest and look-ahead times, the models, and a **first pass**
that skips clearly routine mail before the model reads it, and shows what each day cost. With
**Keep the Inbox tidy** (1.71) it also takes off your list what has since been resolved or handled,
saying why, so the Inbox holds only what still needs you.
[More below](#inbox-watch-your-mailbox-read-for-you-165).

<table>
<tr>
<td width="33%" valign="top"><img src="docs/images/inbox-mobile.png" alt="Inbox on a phone: an unread alert that a site's gate camera is offline for the third time this week, a morning digest and a look-ahead, each with dismiss and options buttons"></td>
<td width="33%" valign="top"><img src="docs/images/inbox-watch-schedule-mobile.png" alt="The Inbox Watch sheet: checking every 5 minutes now in Work hours with the next check time, Pause, an interval for the rest of the time and a Work hours period with weekday buttons, from and until times and its own interval"></td>
<td width="33%" valign="top"><img src="docs/images/inbox-watch-models-mobile.png" alt="Further down the sheet: the first pass switched on with Jev at 80 percent, then seven days of checks, skipped mail, model calls, tokens and cost with a total, and Save"></td>
</tr>
<tr>
<td align="center">What it sent</td>
<td align="center">When it checks</td>
<td align="center">First pass and cost</td>
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
<td width="33%" valign="top"><img src="docs/images/tasks-mobile.png" alt="Tasks on a phone: three to-dos and two project reminders in one list, soonest first, the first two due; a reminder row shows an hourglass and names its project, and finished tasks are collapsed under Done"></td>
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

## Who it's for

- **One person running many agents.** Pocket Code has a single login and is built around one
  operator keeping several sessions moving without losing track of any of them.
- **Developers, and anyone technical who uses coding agents for other work too.** The author
  runs inventory reports, email, accounting and server operations through it, not just code.
- **People who already run Claude Code or Codex on a Linux machine** and want to run more of
  it, from more places, with less babysitting.
- **Office staff who never write code**, through Assistant mode: one Pocket per person on
  their own small server, opening on a message box, with the developer controls out of sight.

It is not a hosted service, not a terminal or editor replacement, and not a multi-user team
product. Projects, Files, Tasks and the Vault are off by default; a session works the same
without them.

## Why it exists

I built Pocket Code because one Claude Code session at a time was the bottleneck. With it I
run ten, see at a glance which ones are waiting on me, start the routine ones from saved
prompts, and let the agents file the to-dos, keep the files and use the credentials. It
roughly doubled what I get done with AI in a day, and it did that without adding clutter.

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
- **Get alerts.** Optional push notifications, chosen by kind per device (finished turns, due
  tasks and reminders, Vault requests, Inbox alerts), a count of due items on the app icon, an on-screen chime
  and per-session muting. Push needs HTTPS, server keys and browser permission. Due tasks and
  reminders can also go by email when the server has an SMTP address.

### Appearance

Choose **Light**, **Dark** or **System** in **Settings → Appearance**. Orange, blue and
purple highlights adapt to each mode. Your choice stays on this browser, including its
split panes and other Pocket windows. New browsers follow the system; existing browsers
keep dark mode until you change it.

**Mode** lives in the same place: **Settings → Appearance → Mode** offers **Developer mode** and
**Assistant mode**, the one you are in pressed, for this Pocket on every device (see [Developer mode or
Assistant mode](#developer-mode-or-assistant-mode)). When an administrator locked Assistant mode for
the install, both options show disabled with the reason.

| Light | Dark |
|---|---|
| ![Light mode: warm paper surfaces, dark text and orange highlights in the conversation workspace](docs/images/appearance-light.png) | ![Dark mode: warm ink surfaces, light text and orange highlights in the same workspace](docs/images/appearance-dark.png) |

### Projects, files, tasks, Inbox and the Vault (optional)

Each is off until **Settings → Projects, files, tasks & vault** turns it on for the install. On
the desktop the rail head switches between Chats, Projects, Files, Tasks, Vault and Inbox, an icon
for each; with five or more, only the pressed one shows its name (1.69). Open lists
refresh when the window comes back into focus, when a turn ends in any Pocket window on the
device, and when you open them, so an item an agent adds shows up without a reload.

- **Projects** keep a card for each piece of work: where you left off, the next step, a
  checklist, reminders (announced once when due) and the sessions that worked on it.
  **Start session** opens a new session in the project's directory, briefed on the card and
  linked to it. With Tasks on, open reminders are listed with the tasks, due first; without it,
  a Scheduled view lists them. See [Projects](docs/workspace-guide.md#projects).
- **Files** keeps the reports, dashboards and spreadsheets that came out of the work, in a
  grid or a list. HTML renders sandboxed; PDFs, images, Markdown and CSV render in place.
  Files are private until you share one by link or publicly; removed files wait 30 days
  in the trash, and **Select** removes several at once; **Delete forever** and **Empty trash**
  free the space now. Keep a file from a session's Results, upload one, or let agents keep
  deliverables. See [Files](docs/workspace-guide.md#files).
- **Tasks** are to-dos with an optional date and time, the session they came from and, if
  you want it, a short briefing on that session. **Start** opens a new session with the
  task written in, ready to send. See [Tasks](docs/workspace-guide.md#tasks).
- **Inbox** (1.69) is what [Inbox Watch](#inbox-watch-your-mailbox-read-for-you-165) sent: alerts,
  digests and look-aheads in one list, newest first. A row opens its sheet: the whole text with Gmail links, **Start a conversation**
  (a new conversation briefed with the story; nothing starts until you press Start) or **Open in Files**,
  **Open in Gmail**, **Resolved**, **Not useful** and **Dismiss**; **X** on the row dismisses. Resolved and Not
  useful reach the watcher on its next run. See [Inbox](docs/workspace-guide.md#inbox).
- **Vault** (1.39) keeps API keys, tokens, logins and notes encrypted in one file on the
  server. See [Vault](docs/workspace-guide.md#vault).
  - **Set up in one switch.** Turning it on creates the key, saves it to the install's
    `.env` and shows a **recovery key** to save once (1.44). Settings can download the
    recovery key again, rotate the key, or restore a lost one from the recovery key.
  - **Used by name, never seen.** An agent runs `pocket-vault run --env TOKEN=zoho-books --
    <command>`: the command gets the value in its environment and the agent gets the output
    with the value replaced. Values never appear in arguments, transcripts or MemStem.
  - **You set how much agents may do.** **Agent access** is Free rein, Ask once per command
    (the default) or Ask every time; any item can be *Only you*. A request is answered from the
    push notification's Allow and Deny buttons, the Vault view, or a reply in the conversation,
    and every use is in the item's history.
  - **Typed by Pocket (1.43).** Agents log into web pages without seeing the password: a
    browser-tool call names `{{vault:name.field}}`, and Pocket's relay
    (`scripts/pocket-mcp-proxy.mjs`) types the value in on the way to the browser and removes
    it from everything that comes back.
  - **Secrets caught before they are sent (1.42).** A key or password pasted or typed into a
    message is held, with **Store in the Vault** putting `{{vault:name}}` in its place. The
    server refuses a secret-shaped message unless you choose to send it anyway (**Catch
    secrets in messages**).
  - Optional passphrase with **Lock now** and **Lock after**, custom fields, a **Credentials**
    kind, and encrypted export and import between installs.
- Projects, files, tasks and the Vault open as a tab, beside a conversation, in a window of
  their own, or full-screen on the phone. Chosen inside a split pane (the file library open
  beside, say), a file or project set to open beside gets a new pane to that pane's left, so
  the list it came from stays in view.

### Agents that know Pocket

- **Suggested replies.** When a reply ends by asking you to choose a next step, the options
  appear as buttons, the recommended one marked. A tap sends it; the X hides them so you can
  type your own answer.
- **Task offers (1.37).** When the work needs a later follow-up (waiting on time, a test,
  someone's reply, a step you put off), the agent offers a task once, as one of those
  buttons. Nothing is added unless you accept; an accepted offer is filed with the session,
  a briefing the agent writes and the agreed date.
- **Skills and commands.** While a feature is on, Pocket installs its skill
  (`pocket-projects`, `pocket-files`, `pocket-tasks`, `pocket-vault`) for Claude Code and
  Codex, so any agent on the server, in Pocket or a terminal, knows how to keep a project,
  what "my files" or "docs" mean, how to add a to-do, and how to use a credential by name
  (and store one it meets). They use the [agent commands](#agent-commands).

### Inbox Watch: your mailbox, read for you (1.65)

Inbox Watch is a small worker that runs beside Pocket on the same server, on a schedule you set
(every five minutes unless you change it), and reads one Gmail mailbox the way a chief of staff would. It keeps a 90-day memory of the
mail, follows each situation as a story across threads and senders (a camera outage, a
customer's service visit, a bill with a deadline), notices when the same device, invoice or
account turns up again, and hands all of that to a model (Claude Code or Codex headless, or an
OpenClaw agent) to decide what deserves you. What it sends:

- **An alert** only when an email tells you something the email itself does not: a repeat
  failure after a repair, a reminder that contradicts what the customer asked for, something
  from an earlier email now due, a reply that never came, the same problem across threads.
  It arrives as a push on your devices and a row in Inbox; the row shows the whole text, and
  **Start a conversation** opens one already briefed with the story, the evidence and the Gmail
  links, so handling it is a sentence, not a copy and paste.
- **A morning digest** of the rest, and a **look-ahead** at 8 a.m. and 5 p.m. of what is due
  or at risk in the next few days, kept in Files with a push that links there.

Quiet hours hold ordinary alerts until morning; only something critical gets through. Your
standing preferences live in a text file the judge reads every turn, so "don't repeat my
email" or "ignore these notices" sticks. With the **Inbox** library on (1.69), everything it sent
is one list in Pocket: tap **X** to dismiss, or choose **Resolved** or **Not useful** from a row, and
the watcher applies it on its next run, closing the story or adding a line to your preferences.
Pocket's part is the Inbox (`pocket-inbox`), the push, the briefed conversation (a start link) and
Files; the watcher itself ships in this repository, in [`inbox-watch/`](inbox-watch/README.md) (1.72), a
Python program with a config file per mailbox (owner, mailbox, judge, delivery) that runs beside Pocket on
its own timer. That folder's README has the setup.
**Schedule, models and cost** (1.70, Settings → Inbox Watch or **Schedule** in the Inbox) sets when it checks
(periods with their own days, hours and interval), quiet hours, the digest and look-ahead times, a pause, and in
Developer mode the model and reasoning for each job, with what each day cost. Mail access is the owner's own Gmail consent, or a Workspace service account for
mailboxes an administrator controls.

### Answer, approve and steer

- **Questions and approvals.** Native agent questions and action-approval cards appear in
  the conversation. Choose Review actions or Full access for later turns. In Review actions,
  read-only actions the owner lists in Settings (a lookup command, a memory search) run
  without a card.
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

Agents (and you, from a terminal on the server) keep projects, files and tasks, and use the
Vault, with five commands that talk to the running server over loopback. The daemon writes its
address to `<data dir>/cli-url` and a token to `<data dir>/cli-token` (both mode `0600`) at
every start, and the commands read those first, so an inherited `PORT` cannot point them at
another program (1.43.1). Each works only while its feature is on. Run them as
`node scripts/<name>.mjs` or `npx <name>` from the Pocket directory. The full usage is in the
header of each script in `scripts/`; the shipped skills explain when to use them.

| Command | Common use |
|---|---|
| `pocket-board` | `track --requested --name "…" --summary "…" --next "…"`, `update`, `edit`, `task add\|done`, `remind --at "YYYY-MM-DDTHH:MM"`, `dismiss`, `note`, `status [--all]`, `scheduled`, `link-session <id>`, `unlink-session <id>`, `reopen` |
| `pocket-docs` | `add <path> [--title] [--project] [--session] [--visibility]`, `list [--q]`, `show <id>`, `share <id> [--expires 7d\|30d\|none]`, `set <id> --visibility private\|link\|public`, `trash <id>`, `restore <id>` |
| `pocket-tasks` | `add "…" [--due] [--session <id>] [--summary "…"] [--dir]`, `list [--all]`, `show <id>`, `done <id>`, `reopen <id>`, `edit <id> [--clear-due]`, `remove <id>` |
| `pocket-notify` | `--title "…" --body "…" [--url /#/start/<id> or another Pocket path] [--tag <key>] [--email]` (1.65.0): a push to every device that wants alerts, and an email to the notification address with `--email`; pair it with `pocket-start` so the alert opens a briefed New session |
| `pocket-inbox` | `add --title "…" (--text "…" \| --file -) [--kind alert\|digest\|lookahead] [--priority] [--story] [--url] [--gmail] [--doc] [--dedupe] [--email]` (1.69): an Inbox entry plus the push; `list [--state new\|all\|dismissed]`, `act <id> open\|dismiss\|resolve\|not_useful\|restore`, `feedback`, `ack <ids>`, `seen [--profile -]` for a watcher applying what the owner decided; `watch`, `watch set (--every\|--pause\|--resume\|--file -)`, `watch reset` (1.70) for its schedule and models |
| `pocket-vault` | `run --env VAR=name[.field] [--cwd] [--timeout] -- <command…>`, `wait <request id>`, `put <name> --kind api_key\|token\|login\|credentials\|note (--from-env VAR\|--from-file path\|--stdin)`, `list`, `show <name>`, `history`. Never prints a value; exits 4 while a request waits for you and 5 when it is refused |

For browser logins, `scripts/pocket-mcp-proxy.mjs` (**Typed by Pocket**, 1.43) sits between an
agent and a browser tool such as Playwright MCP and fills `{{vault:name.field}}` placeholders
under the same Agent access rules, for example
`claude mcp add playwright -s user -- node <pocket>/scripts/pocket-mcp-proxy.mjs --name playwright -- npx -y @playwright/mcp --headless --no-sandbox`.
See the [operations guide](docs/operations.md).

Create a project or task only when the user asks for one; keep files private unless the
user asks to share. Times without an offset use `POCKET_TZ` (or the server's zone).

## Requirements

- Linux or macOS (macOS since 1.47) with Claude Code installed and signed in; Codex is optional.
  On Windows, run it inside WSL2.
- Node.js 20.11 or newer for the server; Node.js 22.12+ and Chrome/Chromium for tests.
- PM2 using the supplied `ecosystem.config.cjs`, or a supervisor configured to preserve
  child session processes during a daemon restart.
- HTTPS through a tunnel or reverse proxy for secure login, installation and push.
- The daemon plus capacity for CLI and MCP processes. One Pocket process does not mean
  the whole installation uses only one OS process.

## Quick start

One command on a Linux or macOS machine that has Node.js 20.11+, git and Claude Code signed in:

```bash
curl -fsSL https://raw.githubusercontent.com/bbesner/pocket-code/main/install.sh | bash -s -- --yes --contact you@example.com
```

It clones the newest release into `~/pocket-code` (`POCKET_DIR` chooses another place), installs
dependencies and runs **pocket-init**, which checks the prerequisites, writes `.env` with a
generated password, cookie secret and push keys, starts the daemon under PM2, waits for
`/api/health` and says how to put HTTPS in front of it, naming the tunnel or proxy it found on
the machine. On a terminal it shows the password once; run by an agent, it leaves the password
in `.env` for the owner to read. Run it again any time: it keeps what is there.

From a checkout you already have: `npm ci --omit=dev && node scripts/pocket-init.mjs`.
The step-by-step version, written so a Claude Code or Codex session can follow it for you, is
[docs/install.md](docs/install.md); it also covers Tailscale Serve, Cloudflare Tunnel and
Caddy for the HTTPS address.

On your phone, open the address, sign in and choose **Add to Home screen**. Then tap
the bell icon to turn on notifications; **Settings → Notifications & voice** chooses which
kinds this device gets and whether the icon shows the count of due tasks and reminders.

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
| `POCKET_CLAUDE_MODEL`, `POCKET_CLAUDE_EFFORT` | no | Pocket-only Claude default for turns left on Default, e.g. `claude-opus-5-5[1m]` and `high`. The model must be one the picker offers; otherwise Default is the CLI's own default. |
| `POCKET_CLAUDE_MODELS` | no | Claude models the picker offers until one is chosen in **Settings → Agents & instance → Claude models in the picker** (the Settings choice wins once saved). Comma-separated catalog ids, e.g. `claude-sonnet-5-5,claude-opus-5-5[1m]`. Default: every model. Models blocked by Claude Code's managed settings (`availableModels`/`deniedModels`) are never offered either way; see the [workspace guide](docs/workspace-guide.md#claude-models-in-the-picker). |
| `POCKET_CLAUDE_MANAGED_DIR` | no | Where to read Claude Code's managed settings from, if not the system directory (`/etc/claude-code`, or `/Library/Application Support/ClaudeCode` on macOS). Used by the tests. |
| `POCKET_CODEX_MODEL`, `POCKET_CODEX_EFFORT` | no | Pocket-only Codex default, e.g. `gpt-6-sol` and `medium`. |
| `POCKET_DEFAULT_CWD` | no | Workspace the New session screen preselects, e.g. your home directory. Default: wherever you last started a session. |
| `POCKET_LOCK_CWD` | no | `1` pins every session to `POCKET_DEFAULT_CWD`: the New session screen shows that folder with nothing to choose, and a start naming another folder is moved there. For installs whose users should never meet a folder. Ignored without a valid `POCKET_DEFAULT_CWD`. |
| `POCKET_IDLE_CLOSE_MS` | no | How long a session's process (Claude Code or Codex) stays up with no turn and no background job, in milliseconds. Default `3600000` (1 hour); `0` keeps processes until Pocket closes them for another reason. |
| `POCKET_STALL_MS` | no | A turn with no output, no background job, nothing waiting on you and no CPU use by programs it started for this long is stopped. Milliseconds; default `1800000` (30 minutes); `0` disables the watchdog. A value that is not a number is logged and ignored. |
| `POCKET_MAX_PROCESSES` | no | Soft target for live CLI processes (Claude Code and Codex together) kept at once. Starting one past the cap closes the longest-idle process that has no turn and no background job. Default `8`; `0` means no cap. Active work is never evicted to meet this target, so the count can exceed it. CLI and MCP processes add memory beyond the Pocket daemon. |
| `POCKET_APPROVAL_MODE` | no | Default permissions for new turns: `review` (default) or `full`. |
| `POCKET_TRUSTED_ACTIONS` | no | Read-only actions Claude runs without an approval card in Review actions, until a list is saved in **Settings → Agents & instance → Actions that run without asking** (the Settings list wins once saved, even when empty). One rule per line, or comma-separated: `Bash(command:*)`, `Bash(exact command)`, `mcp__server__tool`, `mcp__server__*`, `WebSearch`, `WebFetch`, e.g. `Bash(techpro-lookup:*),mcp__memstem__*`. Edit/Write/NotebookEdit cannot be listed; a rule Pocket cannot use is logged and skipped. Default: none, every action asks. Claude only; a convenience, not a security boundary. See [action approvals](docs/action-approvals.md#actions-that-run-without-asking). |
| `POCKET_ALLOW_FULL_ACCESS` | no | Set to `0` to reject Full access in both API and UI. |
| `POCKET_DATA_DIR` | no | Pocket state and runner files; defaults to the checkout. Move only after all session processes are closed. |
| `POCKET_SESSION_ROOT` | no | Override Claude transcript storage for isolated tests; does not relocate Codex. |
| `POCKET_REMINDER_HOOK` | no | A command run when a project reminder (Projects, 1.29) or a dated task (Tasks, 1.36) comes due, with it as JSON on its standard input. A reminder carries `project`, `projectName`, `reminder`, `label`, `dueAt`, `task`, `taskText`, `url`; a task carries `kind: "task"`, `task`, `text`, `dueAt`, `session`, `url`; the day-before notice (1.50, when Settings turns it on) carries the same with `ahead: true`. It runs through the shell, with the same environment as agent turns: Pocket's own secrets are removed (1.37.1). Each one is announced once. Use it for chat or anything else; web push and email happen regardless. |
| `POCKET_SMTP_URL`, `POCKET_SMTP_FROM` | no | Email for due tasks and reminders (1.50): an SMTP address such as `smtps://user:app-password@smtp.gmail.com:465` (or `smtp://…:587` with STARTTLS) and the address to send from (defaults to the URL's user when it is an address). The address to send *to* is set in **Settings → Notifications & voice**, with a test button. Nothing else is emailed. |
| `POCKET_PUBLIC_URL` | no | Pocket's public address (`https://pocket.example.com`), used for links in reminder emails. Without it, Pocket uses the address the owner last signed in from through the tunnel or proxy. |
| `POCKET_DOCUMENTS_DIR` | no | Where Files (1.30; Documents before 1.34) keeps files. Default `<data dir>/documents`. Files placed there appear as private files; removed files wait in its `.trash` for 30 days. |
| `POCKET_SKILLS` | no | `0` stops Pocket installing its `pocket-projects`, `pocket-files`, `pocket-tasks` and `pocket-vault` agent skills into `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills`) and `$CODEX_HOME/skills` (1.34, tasks 1.36, vault 1.39), and its `pocket-google` skill into both (1.64, always on; Claude Code gets the claude.ai-connector version, Codex the ChatGPT-apps version). Only folders carrying Pocket's `.pocket-managed` marker are touched. On by default while the matching feature is on. |
| `POCKET_VAULT_KEY` | no | The Vault's encryption key (1.39). Since 1.44 you don't set it: switching the Vault on creates it, saves it to this install's `.env` (mode `0600`) and shows a recovery key to keep; **Rotate key** and **Restore key** in Settings write it there too. Set it by hand (`openssl rand -base64 32`) only when there is no `.env` to write (`POCKET_ENV_FILE` empty). Pocket reads it at start and removes it, and `POCKET_VAULT_KEY_PREVIOUS` (present only for the moment of a rotation), from its environment, so no agent or other process it starts sees them. Keep the recovery key apart from your data backups: without it `vault.enc` cannot be opened. |
| `POCKET_CHROME`, `POCKET_PDFTOPPM`, `POCKET_CONVERT` | no | The tools that make the library's preview pictures (1.32): a Chrome or Chromium binary for HTML reports (and images when ImageMagick is absent), `pdftoppm` from poppler for PDFs, ImageMagick's `convert` for images. Found automatically in the usual places and on `PATH`; set one to a path to choose it, or to an empty value to turn it off. Pictures are cached in `<documents dir>/.thumbs`. A kind without a tool shows its name on the card instead. |
| `POCKET_TZ` | no | Time zone for `pocket-board` reminder and `pocket-tasks --due` times given without an offset, e.g. `America/New_York`. Default: the server's zone. |
| `POCKET_URL` | no | Base address the `pocket-board`, `pocket-docs`, `pocket-tasks` and `pocket-vault` commands and the browser relay use to reach the server. Default: the address the daemon writes to `<data dir>/cli-url`, then `PORT` from this checkout's `.env`. |
| `POCKET_VAULT_FILL_WAIT` | no | Seconds the browser relay (`scripts/pocket-mcp-proxy.mjs`) waits for your answer to a fill request before telling the agent to try again. Default `90`. |
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
python3 inbox-watch/tests/test_schedule.py   # Inbox Watch's watcher (no mailbox or model needed)
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
