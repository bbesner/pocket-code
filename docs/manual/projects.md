<!-- manual
checked: 1.106.1
sources: projects.mjs, project-mode.mjs, public/projects.js, scripts/pocket-board.mjs, scripts/owner-zone.mjs, skills/pocket-projects/SKILL.md
-->
# Projects

Projects keep a card for each piece of work you want to come back to: where you left off, the next step, what it is waiting for, a checklist of remaining steps, reminders, notes and the conversations that worked on it. You track a project when you decide to, from Pocket Code or by asking an agent; nothing becomes a project on its own. Agents keep the card current with the `pocket-board` command.

## Turn it on

Projects is off until you switch it on for the whole instance:

1. Open **Settings → Projects, files, tasks & vault**.
2. Turn on **Projects**.

The switch applies to every device and to agent conversations. While it is on, Pocket installs the `pocket-projects` skill for Claude Code and Codex and tells the agents it runs how to track a project (see [For agents](#for-agents)). Turning it off hides Projects, refuses the `pocket-board` command and stops reminders from being announced; the cards stay on disk and come back when you turn it on again.

In Assistant mode the switch is under **Settings → Features** instead. When Assistant mode is locked, ask the person who runs the install.

**Open projects** in the same Settings group (this device only) chooses how a project opens when you click it: **As a tab, like a conversation**, **Beside the conversation**, or **In a new browser window**.

## Use it

### Find your projects

- On a computer, the rail's switch has a **Projects** segment. It lists the active and waiting projects, with **Track**, **All**, and a **Scheduled** chip (or **Reminders** when Tasks is on).
- On a phone, the conversation list has a **Projects** chip.
- The Projects list groups cards into **Active**, **Waiting** and **Done** (Done is collapsed). Within a group, projects with due reminders come first, then the most recently updated.

Each row shows the next step (or the summary, or what it is waiting for), how many reminders are due or when the next one is, the number of open steps, and the live state mark of each linked conversation, as on its tab.

### Track a project

From the Projects list, click **Track a project**. From a conversation, click the **Add project** chip in the row above the message box, or choose **Add project** in the conversation's options. The **Project for this conversation** sheet offers:

- **Track a new project**: a card around this conversation. Its workspace becomes the project's directory, and the conversation is linked to the card.
- Any open project the conversation is not linked to yet: links the conversation to it.

The **Track a project** form has **Name** (required), **Where we left off**, **Next step**, **Directory** and **Link**. The directory must be a full path; agents working in that directory, or any folder inside it, find this card automatically. The link must be a full `http` or `https` address, for a plan or document kept elsewhere.

Once a conversation is linked, its chip shows the project's name and opens the card.

### What a card holds

| Part | What it is |
|---|---|
| Status | **Active**, **Waiting** or **Done**. |
| Updated · Verified | When the card last changed, and when its content (name, summary, next step, status, steps) last changed. Notes, reminders and linked conversations change Updated but not Verified. |
| Where we left off | The summary, up to 600 characters. |
| Next | The single next step, up to 600 characters. |
| Waiting for | Who or what the project waits on. Shown when set or when the project is Waiting. |
| Directory, Link | The project's folder on the server and an outside link. |
| Conductor mode | A switch. While it is on, conversations started in, handed off within or linked to the project run with the top model as the lead. See [Conductor mode](#conductor-mode). |
| Done when | What finished looks like for the project, as something that can be checked. Shown when set, or as **Not set** while Conductor mode is on. |
| Works in | Folders and web addresses the lead may change without asking. Shown when set, or as **Not set** while Conductor mode is on. |
| Steps | The checklist of remaining steps, with "n of m done". A step with a check shows it under the step as **Passes when: …**. |
| Reminders | Open reminders for the project or for one step. |
| Conversations | The conversations linked to the project, each with its live state. |
| Files | Files linked to the project, when [Files](files.md) is on (up to eight, then **All n files**). |
| Note | A field to add a note: a decision or reference worth keeping. |
| History | Every change, newest first, marked as made by you, an agent or an import. |

The buttons at the bottom are **Start conversation**, **Edit**, **Remind me** and **Finish project**, or **Resume project** on a finished one. The **⋯** button in the card's header opens **Project options**, which also has **Mark waiting** or **Mark active**, **Open beside**, **Open in a new window** and, in Developer mode, **Turn on Conductor mode** or **Turn off Conductor mode**.

### Keep the steps current

- Type in **Add a remaining step** and press **Add**. A step holds up to 300 characters; a project holds up to 200 steps.
- Tick a step to mark it done; untick it to reopen it. Finishing a step stops its reminder.
- The **⋯** on a step offers **Remind me about this step** and **Edit the text**. **Edit the text** also has **Passes when**: a check that shows the step is done, such as "the test suite passes" (optional, up to 300 characters). Steps cannot be deleted; they stay in the card and its history.

### Waiting and finished projects

- **Mark waiting** sets the status to Waiting. Say who or what it waits for with **Edit** → **Waiting for**. **Mark active** sets it back.
- **Finish project** asks once, then moves the card to Done and cancels its open reminders. Unchecked steps stay on the card.
- **Resume project** brings a finished card back to Active. Its old reminders do not come back; set new ones if you need them.

A finished project accepts edits, notes and conversation links, but not new steps, step changes or reminders until you resume it.

### Set a reminder

Click **Remind me** on the card (or in its options), or **Remind me about this step** on a step. Pick one of:

- **Tomorrow morning**, **In three days**, **Next Monday** or **In a week**, each at 9:00 in this device's time zone.
- **Another time**: any date and time. A time more than a minute in the past is refused.

**Says** is the reminder's text. It defaults to "Revisit *project name*", or to the step's text for a step reminder.

A project has at most one open reminder of its own, and each step at most one. Setting a new one replaces the open one; that is how **Remind later** works. A due reminder stays on the card, marked **Due**, until you **Dismiss** it or set a new time. On a Waiting project, a due reminder also offers **Resume project**.

### How reminders reach you

When a reminder comes due, Pocket announces it once:

- **Push** to every device that has **Settings → Notifications & voice → Push to this device** on with **Due tasks and reminders** selected. The notification reads "Reminder: *project name*" with the reminder's text. Tapping it opens the card; its **Tomorrow** button moves the reminder to 9:00 the next day in that device's time zone without opening Pocket.
- **Email**, when the server has email set up and **Email due tasks and reminders to** has an address (same Settings group).
- **The server's reminder hook**, when the operator set `POCKET_REMINDER_HOOK`.

With **Notice a day before** on (same Settings group, for the whole instance), a second notice, "Reminder tomorrow: *project name*", goes out 24 hours ahead. A reminder set less than a day ahead gets only the due announcement.

The due count shows on the Projects segment and chip, on the card's tab, and on the installed app's icon. When [Tasks](tasks.md) is on, Tasks carries the count instead, and open reminders are listed among your tasks.

Pocket keeps reminders itself. It does not create calendar events or cron jobs.

### The Scheduled view

**Scheduled** lists every open reminder across your projects, earliest first, with the due ones marked. Open it with the **Scheduled** chip on the Projects list or in the rail, or at `#/projects/scheduled`. When Tasks is on, the chip reads **Reminders** and opens the Tasks list, which shows the same reminders among your tasks; `#/projects/scheduled` still opens Scheduled.

A reminder's **⋯** offers **Open project**, **Remind later** and **Dismiss**.

### Start a conversation from a project

**Start conversation** on the card (or **Start a conversation** in its options) opens a new conversation:

- in the project's directory, when it has one;
- with the agent (Claude, Codex or OpenRouter) that last worked on the project;
- with a briefing already written as the first message: where you left off, the next step, what it is waiting for, Done when and Works in, up to 20 open steps with their ids and checks, the last three notes, open reminders, the link, the last three linked conversations, and the `pocket-board` commands to keep the card current.

Edit the briefing if you like, then send it. The conversation is linked to the project as it starts. The project's chip above the message shows which project it will join; click it and choose **Remove the link** to start without the project.

### Conductor mode

Conductor mode is for a big piece of work you want an agent to carry a long way on its own. Turn on the **Conductor mode** switch on the card (or **Turn on Conductor mode** in the card's **⋯** options). A conversation in Conductor mode runs the newest top model on this server (Fable on Claude Code, GPT Astra on Codex) as the **lead**, at high effort. The lead plans the work, hands each piece to a cheaper model, checks what comes back against the steps' checks, and stops only for a decision from you.

Which conversations the switch affects:

- **Switching it on** applies to conversations started in the project, handed off within it, or linked to it from then on. Conversations that were already linked stay as they are.
- **Linking a running conversation** to a Conductor project (its **Add project** chip, or `pocket-board link-session`) puts it in Conductor mode at its next reply.
- **Switching it off, finishing the project or unlinking a conversation** ends the mode for that conversation at its next reply. Its model goes back to the usual default, which restarts the agent's process. If the conversation has a background job running, the change waits until the job ends.

If this server offers neither top model, the switch cannot be turned on and says **Needs a top model (Fable or GPT Astra) offered on this server.**

Conductor mode is part of Developer mode. In Assistant mode the card shows no **Conductor mode** switch and no **Works in**, **Start conversation** offers no Conductor or Solo choice, and Pocket never runs a conversation as Conductor, even for a project whose mode was switched on in Developer mode. **Done when** and each step's **Passes when** check still show. Switching back to Developer mode brings the switch back as it was.

Before a long run, use **Edit** to fill in:

- **Done when**: what finished looks like, written so it can be checked ("every page loads in under a second and the tests pass").
- **Works in**: one folder or web address per line, for the places the lead may change without asking. The project's directory is always included. In this version the list informs the lead only; what Pocket approves still follows the conversation's permission setting.

and give each step a **Passes when** check. The lead also writes them on the card itself when they are missing.

**Start conversation** on a Conductor project starts as Conductor, from the card or from **Start a conversation** in its **⋯** options (which then reads **Conductor: *lead* leads**). New conversation shows it before you send: a **Conductor** chip beside the project chip, and the model and effort chips name what will run, for example **Fable 5.1** and **High**. Tap the **Conductor** chip to pick the other start; the same choice is under **Edit setup** as **Start**, and the setup summary reads **Start Conductor · *lead* leads**:

- **Conductor** (the default): the lead named for the chosen agent, at high effort, handing out the work.
- **Solo**: one cheaper model does the work itself, with no lead. Use it for a fix or a single contained change; a lead costs more on small work because it re-reads everything it checks.

With Solo picked, the chip reads **Solo** and the model chip names Solo's model (Opus on Claude Code, GPT Sol on Codex). While the choice shows, the model and effort chips start on **Default** (the lead or Solo model, at **High**), so a model you left picked on an earlier start does not replace the lead; a model or effort you choose on this screen is still used. An agent without a top model on this server, and OpenRouter, starts as usual; the setup says so instead of offering the choice. Removing the project link (the project chip, **Remove the link**) removes the choice too.

In the conversation, a **Conductor** or **Solo** chip sits beside the project chip; tap it to see which model leads. Changing the model mid-conversation restarts the lead without its reasoning, so the model picker suggests a [handoff](conversation.md#hand-off-to-a-fresh-conversation) instead. A Conductor conversation offers a handoff sooner (at 150K tokens, or the server's own size when that is lower), and a handoff keeps the project and the start. See [Working in a conversation](conversation.md#project-mode-chip).

### Linked conversations

The **⋯** on a linked conversation offers **Open conversation**, **Open beside** and **Unlink from this project**. Unlinking leaves the conversation and its history untouched. A project links up to 50 conversations.

## How it works

- **Data.** Every project lives in `projects.json` in `POCKET_DATA_DIR`, which defaults to the Pocket Code directory. Pocket writes it atomically, mode `0600`. Edit cards only through Pocket or `pocket-board`; Pocket keeps the file in memory and overwrites hand edits.
- **One writer.** The UI and `pocket-board` both go through the server. A change from the UI carries the card's revision; if the card changed since you loaded it, the change is refused and the current card is shown.
- **Project ids** come from the name: lowercase letters and digits joined by hyphens, up to 60 characters, with `-2`, `-3` added when the id is taken. Step and reminder ids are 12-character hex strings.
- **Directory matching.** `pocket-board` finds "this directory's project" by looking for the project whose directory is the current directory or contains it. The deepest match wins. Finished projects never match.
- **Refreshing.** An open list or card refreshes when the window regains focus, when a reply ends in any Pocket window on the device, and every 30 seconds while it is open, so a card an agent changes updates on its own.
- **Reminder checks.** The server checks for due reminders every minute and a few seconds after it starts. Each reminder is marked as announced before it is sent, so a crash mid-send never announces it twice; a failed push, email or hook is logged and not retried.

### Limits

| Limit | Value |
|---|---|
| Projects | 200 |
| Name | 120 characters |
| Summary, next step, waiting for, done when, note, reminder text | 600 characters |
| Step | 300 characters; 200 steps per project |
| Passes when (a step's check) | 300 characters |
| Works in | 10 places, each a full path or an `http`/`https` address of up to 1,024 characters |
| Linked conversations | 50 per project |
| Reminders kept | Every open one; past 50 in total, only the last 10 settled ones are kept |
| History | The last 200 entries |
| Directory, link | 1,024 characters |

### Settings and environment

| Setting or variable | Effect |
|---|---|
| **Settings → Projects, files, tasks & vault → Projects** | Turns the feature on for the instance (`projects` in `pocket-settings.json`). |
| **Open projects** (same group, this device) | Tab, beside the conversation, or a new window. |
| **Settings → Notifications & voice → Notice a day before** | A second notice 24 hours before each reminder. |
| **Email due tasks and reminders to** (same group) | The address for reminder email. Needs `POCKET_SMTP_URL`. |
| `POCKET_REMINDER_HOOK` | A shell command run for each due reminder, with the reminder as JSON on standard input. It runs without Pocket's own secrets in its environment. See [operations](../operations.md#optional-libraries-projects-files-tasks-inbox-and-the-vault) for the payload. |
| `POCKET_REMINDER_HOOK_TIMEOUT_MS` | How long one hook run may take before Pocket stops it and everything it started. Default 60000. |
| `POCKET_TZ` | The user's time zone until their browser reports one, for reminder times shown and given to `pocket-board` without an offset. Default: the server's own zone. |
| `POCKET_REMINDER_CHECK_MS` | How often due reminders are checked, in milliseconds. Default 60000. |
| `POCKET_SKILLS=0` | Stops Pocket installing its skills into the agents' skill folders. |

## For agents

### When to track a project

Create a project **only when the user asks**: "track this", "make this a project", "add this to my projects", "keep track of this work", or the **Track a project** / **Add project** buttons. Never track a project because a session started, work is unfinished or a blocker came up. At a natural stopping point you may offer once and wait for the answer.

While Projects is on, every conversation Pocket runs gets this instruction, with the install's real command path and the conversation's id filled in:

> This Pocket Code tracks projects. Only when the user asks to track this work, make it a project, or add it to one, use the pocket-board command; the pocket-projects skill has the full procedure, which questions to ask and when to set reminders. Check `status --all` first and link this session to a matching project (`link-session <this session id> -p <project-id>`) rather than duplicating it; otherwise run `track --requested --name "<name>" --session <id> --summary … --next …` from the working directory. Ask at most one question, and set a reminder (`remind --at`) only when the user asks or agrees to a time. When a tracked project's work reaches a stopping point, keep its card current with `update --summary … --next …`, `task add|done` and `note`. Never track a project the user did not ask for.

The full procedure, including which single question to ask and how to word names, summaries and steps, is in the [pocket-projects skill](../../skills/pocket-projects/SKILL.md). While Projects is on, Pocket installs it into `~/.claude/skills/pocket-projects` and, when Codex is installed, `$CODEX_HOME/skills/pocket-projects` (default `~/.codex`), with the exact command for this server. It never overwrites a folder of the same name that it did not create, and removes its own copy when Projects is turned off.

A conversation started with **Start conversation** is already linked; its first message names the project id and the open step ids. Pick up from the next step and do not link or track again.

Finishing a project is not approval to deploy, spend money or contact anyone.

### Running the command

Run `node scripts/pocket-board.mjs` from the Pocket Code directory (the installed skill names the full path). It talks to the running server over loopback with the token the server writes to `<data dir>/cli-token` at every start; it never opens `projects.json`. It reads `POCKET_DATA_DIR`, `PORT`, `POCKET_URL` and `POCKET_TZ` from the environment or from the `.env` in the Pocket Code directory (`POCKET_ENV_FILE` names another). The server's address comes from `POCKET_URL`, else `<data dir>/cli-url`, else `PORT`, else `http://127.0.0.1:3610`.

Most commands act on the project whose directory contains the current directory. Add `-p <id>` (or `--project <id>`) to name another.

Times are printed in the user's time zone (the one their browser reports to Pocket, else `POCKET_TZ`, else the server's), with the zone named. A time you pass without an offset is read in the same zone, so a printed time can be passed back as it reads; an explicit offset (`2026-11-06T09:00-05:00`) is also accepted.

### Command reference

| Command | What it does |
|---|---|
| `track --requested --name "…" [--summary "…"] [--next "…"] [--dir <path>] [--link <url>] [--session <id>]` | Creates a card. `--requested` says the user asked and is required. The directory defaults to the current directory; a relative `--dir` is taken from the current directory. `--session` links the conversation (a Claude session id, or `cx:<id>` for Codex). |
| `status` | The current directory's card. With no match, lists every project and says none contains this directory. |
| `status --all` | One line per project: status, id, name, due reminders, open steps. |
| `status -p <id>` | That project's card. |
| `update [--name "…"] [--summary "…"] [--next "…"] [--waiting-for "…"] [--link <url>] [--dir <path>] [--status active\|waiting\|done]` | Changes the named fields. At least one is required. `--status done` finishes the project and cancels its reminders. |
| `update --mode conductor\|off` | Turns [Conductor mode](#conductor-mode) on or off. Only when the user asks. |
| `update --done-when "…"` | Sets what finished looks like, as something that can be checked. |
| `update --works-in "/path,https://…"` | Sets the places the lead may change without asking, separated by commas. A relative path is taken from the current directory. An empty value clears the list. |
| `task add "text" [--check "…"]` | Adds a step, with its pass/fail check when given. |
| `task done <step-id>` / `task reopen <step-id>` | Ticks or unticks a step. Done stops the step's reminder. |
| `task edit <step-id> [--text "…"] [--check "…"]` | Rewrites a step, its check, or both. |
| `remind --at "YYYY-MM-DDTHH:MM" [--task <step-id>] [--text "…"]` | Sets the project's reminder, or a step's with `--task`, replacing the open one. Seconds and an offset (`Z`, `+02:00`) are accepted. A time in the past is accepted and comes due at the next check. |
| `dismiss <reminder-id>` | Cancels an open reminder. |
| `note "text"` | Adds a note to the history. |
| `link-session <id>` / `unlink-session <id>` | Links or unlinks a conversation. |
| `scheduled` | Every open reminder across projects, earliest first, due ones marked `DUE`. |
| `context [--hook]` | A short briefing on the current directory's unfinished project, for a session start. Prints nothing and exits 0 when there is no project, Projects is off or Pocket is down. `--hook` prints it as Claude Code SessionStart hook JSON. |
| `import <snapshot.json>` | One-time import of a board snapshot (version 2 JSON) from the older Mission Control board. Projects whose ids already exist are skipped. |
| `help` | The usage summary. |

Add `--json` to `status`, `scheduled` and any command that changes a card to get JSON instead of text.

To brief Claude Code sessions on the directory's project at start, add a SessionStart hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node ~/pocket-code/scripts/pocket-board.mjs context --hook" } ] }
    ]
  }
}
```

Replace `~/pocket-code` with the Pocket Code directory.

### Examples

Here `pocket-board` stands for `node scripts/pocket-board.mjs`.

```bash
pocket-board status --all
pocket-board track --requested --name "Acme HOA camera upgrade" \
  --summary "Quote approved; parts ordered." --next "Schedule the install with the board" \
  --session 3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b
pocket-board task add "Confirm the pole mounts fit" --check "Every mount in the photo log is marked as fitting"
pocket-board update --done-when "All 24 cameras record and the board has the handover notes"
pocket-board update --status waiting --waiting-for "Parts delivery"
pocket-board remind --at "2026-11-06T09:00" --text "Check the parts delivery"
pocket-board update -p acme-hoa-camera-upgrade --summary "Installed and tested." --next "Send the handover notes"
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | Any other error; the message says what. |
| 2 | The project is finished; resume it first. The current card is printed. |
| 3 | Projects is off. Tell the user to turn it on under **Settings → Projects, files, tasks & vault → Projects**; do not keep the project anywhere else. |
| 4 | The token was refused. |
| 5 | No tracked project contains the current directory, or no project has that id. |
| 6 | `track` was run without `--requested`. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `No CLI token at …` | Pocket is not running, or the command is reading a different data directory. | Start Pocket. Run the command from the same Pocket Code directory, or set `POCKET_DATA_DIR` to the server's. |
| `Pocket Code is not reachable at …` | The server is down or not answering (the command waits 30 seconds). | Check that Pocket is running; set `POCKET_URL` if it listens elsewhere. |
| Exit 4, `unauthorized` | The token belongs to another install, or the request did not come straight over loopback (through a proxy or tunnel). | Run the command on the server itself, against the Pocket whose data directory holds the token. |
| `No tracked project contains …` | The current directory is outside every active project's directory. | Pass `-p <id>` (ids are in `status --all`), or set the project's directory with `update --dir`. |
| `The directory must be a full path.` | A relative directory reached the server from the form or the API (the command resolves `--dir` against the current directory). | Pass an absolute path. |
| `This project is finished. Resume it first.` | Steps and reminders cannot change on a Done project. | `update --status active`, or **Resume project** on the card. |
| `Each place must be a full path or a web address.` | A **Works in** line is a relative path or an address that is not `http`/`https`. | Write each place as a full path (`/srv/site`) or a full address (`https://staging.example.com`). |
| The **Conductor mode** switch is greyed out | This server offers neither top model (Fable for Claude Code, GPT Astra for Codex). | Make Fable available to Claude Code on this server (**Settings → Agents & instance → Claude models in the picker**, and the computer's Claude Code policy), or update Codex to a version that offers GPT Astra. |
| No **Conductor mode** switch on the card | Pocket is in Assistant mode, where Conductor mode does not run. | Switch to Developer mode in **Settings → Appearance → Mode**, if the install allows it. |
| **Started, but not linked to *project*:** after Start conversation | The conversation started, but the server could not link it, for example because the project already has 50 conversations. It runs without the project and its mode. | Unlink an old conversation from the card, then link this one with its **Add project** chip. |
| No **Conductor** chip on New conversation, and the model chip shows your usual model | The project's Conductor mode is off, the chosen agent has no top model here, or it is OpenRouter. | Turn the mode on (the card's switch, or **Turn on Conductor mode** in its **⋯** options), or pick Claude Code or Codex. |
| A reminder arrives hours off | The time was given without an offset before the user's browser reported a zone, and `POCKET_TZ` (or the system zone) is not the user's. | Open Pocket in the user's browser once, set `POCKET_TZ` to the user's zone, or pass an offset. |
| No reminder on any channel | Projects is off; reminders are announced only while it is on. | Turn on **Settings → Projects, files, tasks & vault → Projects**. |
| No push for a due reminder | Push is not set up on the server, the device is not subscribed, or **Due tasks and reminders** is off for that device. | Check **Settings → Notifications & voice** on the device. The card still shows the reminder as due. |
| No reminder email | `POCKET_SMTP_URL` is not set, or no address is saved. | Set it up (see [Settings](settings.md#notifications--voice)) and use **Send a test** in **Settings → Notifications & voice**. |
| A push, email or hook run failed once and never came | Each reminder is announced once; a failed send is logged, not retried. | Check the server log; the card still shows the reminder as **Due**. |
| "This project changed since you loaded it" | The card changed on another device or by an agent. | Review the current card, which is now shown, and make the change again. |
