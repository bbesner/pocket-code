<!-- manual
checked: 1.79.2
sources: tasks.mjs, public/tasks.js, scripts/pocket-tasks.mjs, scripts/owner-zone.mjs, skills/pocket-tasks/SKILL.md
-->
# Tasks

Tasks are your to-dos, kept beside your conversations. A task is one line of text with an optional date and time, the conversation it came from and, when you want it, a short briefing on that conversation. Pocket tells you once when a dated task comes due, and **Start** opens a new conversation with the task already written in. You add tasks yourself, or ask an agent, typed or spoken; agents also offer one when work will need you to come back to it.

## Turn it on

Tasks is off until you switch it on for the whole instance:

1. Open **Settings → Projects, files, tasks & vault**.
2. Turn on **Tasks**.

While Tasks is on, Pocket installs the `pocket-tasks` skill for Claude Code and Codex and tells the agents it runs when to create and offer tasks (see [For agents](#for-agents)). Turning it off hides Tasks, refuses `pocket-tasks` and stops due tasks from being announced; your tasks stay on disk.

In Assistant mode the **Projects, files, tasks & vault** group is not shown in Settings. Switch to **Developer mode** under **Settings → Appearance → Mode** to change it.

## Use it

### Open the list

- On a computer, use the **Tasks** segment in the rail. It shows **Add task**, **All**, up to 40 open items and a link to the finished ones.
- On a phone, use the **Tasks** chip on the conversation list.
- The full list is at `#/tasks`. It opens like a conversation: as a tab, beside a conversation, in a window of its own, or full screen on a phone.

**To do** lists open tasks: dated ones first, soonest first, then undated ones, newest first. Finished tasks collapse under **Done**, most recently finished first. The check button on each row marks a task done or reopens it.

With [Projects](projects.md) on as well, open project reminders appear in **To do** among the dated tasks, in time order. A reminder row names the reminder, its project and its step; it opens the project card, and its hourglass or **⋯** offers **Remind later** and **Dismiss**.

The **Tasks** segment, the phone chip and the tab show how many items are due, counting due tasks and due project reminders together. The installed app's icon shows the same count unless you turn off **Settings → Notifications & voice → Count on the app icon** on that device.

### Add a task yourself

- **Add task** on the list or in the rail.
- The **Add task** chip in the row above a conversation's message box.
- **Add task** in a conversation's options.

The form has:

- **Task**: what needs doing, up to 600 characters.
- **Date and time (optional)**, in this device's time zone. **No date** clears it.
- From a conversation only, **Include a summary of this conversation**, on by default.

With the summary on, Pocket asks the helper model chosen in **Settings → Conversation → Model for titles and summaries** for a few lines on what the conversation is doing, and keeps them with the task as its **Context**. If no helper is available or the conversation is too short, the task is added without context and a message says so.

A task added from a conversation remembers that conversation and its workspace, so **Start** opens in the right folder.

### Add a task by asking an agent

Tell the agent, typed or by voice: "create a task to call the supplier", "remind me Friday to check the report", "add a to-do to update the price list, with the context". The agent runs `pocket-tasks add`. It sets a date only when you name one, writes the context itself when you ask for it, and confirms the task and its time in one sentence.

### Accept an agent's offer

When the work reaches a point you will need to return to (waiting on time or data, a test still to run, someone's reply, a step you chose to put off, a date you mentioned), the agent offers a task once. Usually it is one of the suggested-reply buttons at the end of its reply, such as *Remind me Nov 7 to recheck the numbers*. Nothing is added unless you tap it or say yes; an offer you pass on is not repeated. An accepted offer is filed with the conversation, a briefing the agent writes and the date from the offer.

### Due times and time zones

- Times you pick in Pocket are in the device's time zone and saved as an exact moment, so they mean the same thing on every device.
- A time an agent passes without an offset is read in `POCKET_TZ`, or in the server's own zone when that is unset.
- Times the `pocket-tasks` command prints are in your time zone (the one your browser reports to Pocket, else `POCKET_TZ`, else the server's), with the zone named.

### When a task comes due

A dated task is announced once, when its time arrives:

- **Push** to every device that has **Settings → Notifications & voice → Push to this device** on with **Due tasks and reminders** selected. The notification reads "Task due" with the task's text and opens the list. **Tomorrow** moves the task to 9:00 the next day in that device's time zone; **Done** finishes it. Both work without opening Pocket.
- **Email**, when the server has email set up and **Email due tasks and reminders to** has an address.
- **The server's reminder hook**, when the operator set `POCKET_REMINDER_HOOK`. The hook gets the task as JSON with `kind: "task"`.

With **Notice a day before** on (same Settings group, for the whole instance), a second notice, "Task due tomorrow", goes out 24 hours ahead. A task whose time was set less than a day ahead gets only the due announcement.

A due task stays marked **Due** until you finish it or give it a new time. Giving it a new time, from **Remind later**, **Edit** or the notification's **Tomorrow**, means it is announced again at the new time.

### Open, start and finish a task

Click a task to open its sheet: the text, the date, the conversation it came from, its workspace, who added it, and its **Context**. The sheet offers:

| Option | What it does |
|---|---|
| **Start** | Opens a new conversation in the task's workspace, with the agent of the conversation it came from. The first message is already written: the task, its context, and a line asking the agent to mark the task done with `pocket-tasks done <id>` when it is finished. Edit it if you like, then send it. |
| **Open the conversation** | Goes back to the conversation the task came from. |
| **Mark done** / **Reopen** | Finishes the task or puts it back on the list. A finished task is not announced. |
| **Remind later** | For an open, dated task: **Tomorrow morning**, **In three days**, **Next Monday**, **In a week** (each at 9:00 on this device), or **Another time**. |
| **Edit** | Changes the text, date and context. |
| **Remove** | Deletes the task after one confirmation. |

## How it works

- **Data.** Tasks live in `tasks.json` in `POCKET_DATA_DIR`, which defaults to the Pocket Code directory. Pocket writes it atomically, mode `0600`, and keeps it in memory, so edit tasks only through Pocket or `pocket-tasks`.
- **One writer.** The UI and `pocket-tasks` both go through the server. A change from the UI carries the task's revision; if the task changed since you loaded it, the change is refused and the current task is shown.
- **Conversation facts.** When an agent adds a task with `--session`, the server fills in that conversation's title and workspace, as the **Add task** button does.
- **Due checks.** The server checks for due tasks every minute and a few seconds after it starts. Each task is marked as announced before it is sent, so a crash never announces it twice; a failed push, email or hook is logged and not retried.
- **Refreshing.** An open list refreshes when the window regains focus, when a reply ends in any Pocket window on the device, and every 30 seconds while it is open.

### Limits

| Limit | Value |
|---|---|
| Tasks, open and finished together | 500 |
| Task text | 600 characters |
| Context | 2,000 characters |

### Settings and environment

| Setting or variable | Effect |
|---|---|
| **Settings → Projects, files, tasks & vault → Tasks** | Turns Tasks on for the instance (`tasks` in `pocket-settings.json`). |
| **Settings → Notifications & voice → Notice a day before** | A second notice 24 hours before each dated task. |
| **Email due tasks and reminders to** (same group) | The address for due-task email. Needs `POCKET_SMTP_URL`. |
| **Settings → Conversation → Model for titles and summaries** | Which helper writes the summary for **Include a summary of this conversation**. |
| `POCKET_REMINDER_HOOK` | A shell command run for each due task, with the task as JSON on standard input. It runs without Pocket's own secrets in its environment. See [operations](../operations.md#optional-libraries-projects-files-tasks-inbox-and-the-vault) for the payload. |
| `POCKET_REMINDER_HOOK_TIMEOUT_MS` | How long one hook run may take before Pocket stops it and everything it started. Default 60000. |
| `POCKET_TZ` | The time zone for due times given to `pocket-tasks` without an offset. Default: the server's own zone. |
| `POCKET_CHOICES=0` | Agents offer a task in one plain line instead of as a suggested-reply button. |
| `POCKET_REMINDER_CHECK_MS` | How often due tasks are checked, in milliseconds. Default 60000. |

## For agents

### When to create a task, and when to offer one

Create a task **only when the user asks** (create a task, add a to-do, remind me, note something for later; typed or spoken) **or accepts your offer**. Never create one the user did not ask for or accept.

While Tasks is on, every conversation Pocket runs gets an instruction that says, in substance:

- Before finishing each reply, check whether the work now needs the user to come back later: waiting on time (propagation, data building up, a scheduled date), a test or measurement still to run, another person's reply or action, a step the user chose to put off, or a date they mentioned.
- If so, and no task or reminder already covers it, offer once. When suggested replies are on, make the offer one option in the `choices` block that ends the reply, worded as the user would say it and naming what and when ("Remind me Nov 7 to recheck the numbers"). If the reply would not otherwise end with choices, ask in one short line and list that option with one to decline. With `POCKET_CHOICES=0`, offer in one short line and wait.
- This applies even when the user only asked for a recap or a short answer. Do not offer for work about to be done in this conversation, for trivial errands, or again after the user passed.
- When the user asks or accepts, run `add "<text>" --session <id> --summary "…" [--due "YYYY-MM-DDTHH:MM"]`. The text is one clear sentence. Write the summary yourself (always for an accepted offer, and whenever the task depends on this conversation): two to four plain sentences on what is being worked on, where it stands and what finishing needs. Give `--due` only for a time the user named or agreed. Then confirm in one sentence with the task and its time.

When Pocket does not know the conversation's id, the instruction asks for `--dir "<working directory>"` instead of `--session`, so **Start** opens in the right place.

The [pocket-tasks skill](../../skills/pocket-tasks/SKILL.md) has the full procedure, including how to read "Friday" (09:00 that day) and "tomorrow afternoon" (14:00). While Tasks is on, Pocket installs it into `~/.claude/skills/pocket-tasks` and, when Codex is installed, `$CODEX_HOME/skills/pocket-tasks`, with the exact command for this server. It never overwrites a same-named folder it did not create.

A conversation opened with **Start** has the task id in its first message. Mark the task done when the work is finished.

### Running the command

Run `node scripts/pocket-tasks.mjs` from the Pocket Code directory; the installed skill names the full path. It talks to the running server over loopback with the token in `<data dir>/cli-token` and never opens `tasks.json`. It finds the server and data directory the same way as [`pocket-board`](projects.md#running-the-command).

A `--due` time without an offset is read in `POCKET_TZ`, or the server's zone. The command prints times in the user's zone, which can differ; when it does, pass an explicit offset (`2026-11-06T09:00-05:00`).

### Command reference

| Command | What it does |
|---|---|
| `add "text" [--due "YYYY-MM-DDTHH:MM"] [--session <id>] [--summary "…"] [--dir <path>]` | Adds a task. `--session` is a Claude session id, or `cx:<id>` for Codex; the server fills in its title and workspace. `--dir` must be a full path. `--due` also takes seconds and an offset. |
| `list [--all] [--json]` | Open tasks, due first, as `[ ] text (id) due …`. `--all` adds finished ones. |
| `show <id> [--json]` | One task with its conversation, workspace, context and who added it. |
| `done <id>` / `reopen <id>` | Finishes a task or reopens it. |
| `edit <id> [--text "…"] [--due "…" \| --clear-due] [--summary "…"]` | Changes the text, due time or context. At least one is required. A new due time is announced again. |
| `remove <id>` | Deletes the task. Only when the user asks. |
| `help` | The usage summary. |

Commands that change a task print it; add `--json` for JSON.

### Examples

Here `pocket-tasks` stands for `node scripts/pocket-tasks.mjs`.

```bash
pocket-tasks add "Call the supplier about the delayed order" --session 3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b
pocket-tasks add "Recheck the traffic numbers" --due "2026-11-07T09:00" \
  --session 3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b \
  --summary "Comparing ad traffic before and after the landing page change. The new page went live Oct 31. Recheck once a week of data is in; the report script is reports/traffic.py."
pocket-tasks list
pocket-tasks edit 1c2d3e4f5a6b --clear-due
pocket-tasks done 1c2d3e4f5a6b
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | Any other error; the message says what. |
| 3 | Tasks is off. Tell the user to turn it on under **Settings → Projects, files, tasks & vault → Tasks**; do not keep a to-do list anywhere else. |
| 4 | The token was refused. |
| 5 | No task has that id (`show`). |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A task comes due hours off | The agent gave a time without an offset, and `POCKET_TZ` (or the server's zone) is not the user's zone. | Pass an offset, or set `POCKET_TZ` to the user's zone. |
| No announcement on any channel | Tasks is off, or the task has no date. | Turn on **Settings → Projects, files, tasks & vault → Tasks**; give the task a date. |
| No push when a task comes due | Push is not set up on the server, the device is not subscribed, or **Due tasks and reminders** is off for that device. | Check **Settings → Notifications & voice** on the device. The list still shows the task as due. |
| No email | `POCKET_SMTP_URL` is not set, or no address is saved. | Set it up (see [Settings](settings.md#notifications--voice)) and use **Send a test** in **Settings → Notifications & voice**. |
| A push, email or hook run failed once and never came | Each due task is announced once; a failed send is logged, not retried. | Check the server log; the list still shows the task as **Due**. |
| "task added without context" | No helper model is available, or the conversation is too short to summarize. | Add the context with **Edit**, or check **Model for titles and summaries**. |
| **Start** opens in the wrong folder | The task has no workspace: it was added from the list, or by an agent without `--session` or `--dir`. | Choose the workspace in the new conversation, or have agents pass `--session` or `--dir`. |
| `You can keep up to 500 tasks.` | The limit counts finished tasks too. | Remove finished tasks you no longer need. |
| `The directory must be a full path.` | `--dir` was relative. | Pass an absolute path. |
| `No CLI token at …`, `not reachable`, exit 4 | The same causes as for `pocket-board`. | See [Projects troubleshooting](projects.md#troubleshooting). |
