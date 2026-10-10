---
name: pocket-projects
description: Track work as a Pocket Code project. Use when the user asks to track this, make it a project, start a project, add this to a project or to their projects, check on a project, set or change a project reminder, or mark a project done. A project is one card in Pocket Code with where the work left off, the next step, a checklist, reminders and the sessions that worked on it.
---

# Pocket Code projects

Pocket Code keeps projects on its own server. Each project is **one card**: where the work
left off, the next step, what it is waiting for, a short checklist of remaining steps,
reminders, notes, and the sessions that worked on it. States are **active**, **waiting**
and **done**. You manage cards with the `pocket-board` command; the user sees them under
Projects in Pocket Code.

<!-- pocket:commands -->
Run `pocket-board` from the Pocket Code directory (`node scripts/pocket-board.mjs`, or
`npx pocket-board`). The session instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->

## When to create a project

Create one **only when the user asks**. Phrases that count: "track this", "make this a
project", "start a project for …", "add this to my projects", "put this on the board",
"keep track of this work". The Track button and *Add to project* in Pocket Code also count.

Do not create a project because a session started, work is unfinished, you hit a blocker,
or the work looks big. At a natural stopping point you may offer once ("Want me to track
this as a project?") and then wait for the answer.

## Ask as little as possible

Fill everything you can from the conversation. Ask **at most one short question**, and only
for one of these:

- **Which project.** Two existing projects could both match "add this to the project".
- **What it tracks.** The user asked in a fresh session with nothing to go on.
- **When to remind.** The user wants a reminder but gave no time, or the work is waiting
  on something time-bound (a test running until Friday, a reply from a vendor) and the
  timing matters. Offer: "Want a reminder? When should I check back?"

Never ask the user to confirm a name, a summary or a next step you can write yourself.
If you need two of the answers above, ask them in the same message.

## Steps to create a project

1. **Check for an existing one.** `pocket-board status --all`. If a project already covers
   this work, link the session to it instead of creating a duplicate:
   `pocket-board link-session <session-id> -p <project-id>`.
2. **Create the card** from the working directory, which becomes the project's directory:
   ```bash
   pocket-board track --requested --name "Warehouse stock report" \
     --summary "Where the work stands now" --next "The single next step" --session <session-id>
   ```
   - Name: 2 to 5 plain words about the work, not the directory.
   - Summary: one or two sentences, facts only (verified or said by the user).
   - Next: one concrete action, not a list.
   - `--requested` records that the user asked. Never pass it otherwise.
   - Leave out `--session` if you do not know the session id.
3. **Add the remaining steps** as tasks, only real ones, usually three to seven:
   `pocket-board task add "Review the false alarms"`. Put a long plan behind
   `update --link <url>` instead of copying it into tasks.
4. **If it is waiting** on someone or something:
   `pocket-board update --status waiting --waiting-for "Three days of test results"`.
5. **Reminder, only by the rules below.**
6. **Tell the user** in one or two sentences: the project's name, the next step, and the
   reminder time if you set one.

## Reminders

Set a reminder only when:

- the user asks ("remind me", "check back Friday", "ping me next week"), or
- the project is waiting on something time-bound and the user gave or agreed to a time.

Never add a reminder by default and never invent a deadline. If timing matters and no
time was given, ask once (see above); if the user declines, set none.

```bash
pocket-board remind --at "2026-10-17T09:00" --text "Review the test results"
pocket-board remind --task <task-id> --at "2026-10-17T09:00"
pocket-board dismiss <reminder-id>
pocket-board scheduled          # every open reminder, due first
```

- A time without an offset is in the server's time zone (`POCKET_TZ`).
- One open reminder per project, and one per step: a new one replaces the old.
- Pocket announces a due reminder once, by push to the user's devices and the server's
  reminder hook if one is set. Do not create cron jobs, calendar events or extra messages.
- Finishing a step or the project stops its reminders. Resuming does not bring them back.

## Keeping a card current

When a tracked project's work reaches a stopping point, update it before you finish:

```bash
pocket-board update --summary "Where we left off" --next "Next step"
pocket-board task done <task-id>
pocket-board update --status done      # finished; stops its reminders
pocket-board note "A decision or reference worth keeping"
```

Notes are for decisions and references, not routine session logs. Finishing a project is
not approval to deploy, spend money or contact anyone; those still need the user.

Name a project with `-p <id>` (from `status --all`) when you are not in its directory.

## If Projects is off

`pocket-board` exits with code 3 and says so. Tell the user that Projects is turned off and
can be turned on in Pocket Code under **Settings → Projects & files → Projects**. Do not
keep a project anywhere else instead.
