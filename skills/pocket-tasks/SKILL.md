---
name: pocket-tasks
description: Keep the user's to-dos in Pocket Code's Tasks. Use when the user asks to create a task or accepts your offer of one, add a to-do, make a note of something to do later, set something for a date or time, list their tasks, or mark a task done, whether typed or spoken. A task is one line of text with an optional due time and, when the user wants it, a short briefing on the session it came from.
---

# Pocket Code tasks

Pocket Code keeps **Tasks** on its own server: to-dos the user wants to come back to. Each task
is one line of text, an optional due date and time, the session it was created in and, when
the user wants the context, a short briefing on that session. The user sees them under Tasks
in Pocket Code on every device (with Projects on, project reminders are listed there too), can
start a new session from one, and is told once when a dated task comes due (push, email when
set up, the server's reminder hook). You manage tasks with the `pocket-tasks` command.

<!-- pocket:commands -->
Run `pocket-tasks` from the Pocket Code directory (`node scripts/pocket-tasks.mjs`, or
`npx pocket-tasks`). The session instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->

## When to create a task

Create one **only when the user asks**, typed or by voice, **or accepts your offer of one**.
Phrases that count as asking: "create a task", "add a task", "make a to-do", "remind me to …",
"put that on my list", "I need to … later, note it", "task: …". Treat a dictated sentence the
same as a typed one.

## Offering one

When the work reaches a point the user will need to come back to later, and nothing already
tracks it, offer **once**. Good moments: waiting on time (a report that needs weeks of data, a
setting that takes effect tomorrow), a test or measurement still to run, someone else's
reply or action, a step the user chose to put off, or a date they mentioned.

- **As a suggested reply.** When Pocket shows suggested-reply buttons, make the offer one
  option in the `choices` block that ends your reply, written as the user would say it and
  naming what and when: `Remind me Nov 7 to recheck the numbers`, `Add a task to test the fix`.
  If the reply would not otherwise end with choices, ask in one short line ("Want a reminder
  to recheck on Nov 7?") and list that option with one to decline (`No reminder`).
- **Without buttons**, ask in one short line and wait.
- **Don't offer** for work you are about to do in this session, for trivial errands, or a
  second time after the user passed. Never add the task before the user says yes.

An accepted offer is filed with the full context (below): the session, a summary you write,
and the date or time from the offer.

## How to write it

```bash
pocket-tasks add "Call ENS about the aisle 4 count" --session <session-id>
pocket-tasks add "Review the NVR report" --due "2026-10-14T09:00" --session <session-id>
pocket-tasks add "Finish the storefront header" --session <session-id> \
  --summary "Rebuilding the SCK header in the Astro site. The logo and nav are done; the cart badge still overlaps on phones. Next is the 390px layout in header.astro."
```

- **Text:** the user's words, tidied into one clear sentence. Keep names, numbers and dates.
- **`--session`:** the id of the session you are in, when you know it, so the task opens back
  into this conversation. Pocket fills in that session's title and workspace, so **Start** opens
  the task in the right folder. Without a session id, pass `--dir <working directory>` instead.
- **`--due`:** only when the user names a date or time. "Friday" means this coming Friday at
  09:00 unless they say otherwise; "tomorrow afternoon" is 14:00. A time without an offset is
  the server's time zone. Never invent a time; a task without one is a plain to-do.
- **`--summary`:** write it yourself **for every accepted offer**, when the user wants the task
  to carry the context of this session ("with the context", "include where we are", "so I know
  what this is about"), or when the task clearly depends on this session's state. Two to four
  plain sentences: what is being worked on, where it stands, and what finishing the task needs
  (a file, a decision, a blocker). No Markdown, no headings. Leave it out for a self-explanatory
  errand the user asked for directly.

After adding, tell the user in one sentence: the task text and the due time if any.

## Listing and finishing

```bash
pocket-tasks list             # open tasks, due first
pocket-tasks list --all       # finished ones too
pocket-tasks show <id>
pocket-tasks done <id>        # when the user says it is done, or you finished it for them
pocket-tasks edit <id> --due "2026-10-15T14:00"
pocket-tasks edit <id> --clear-due
pocket-tasks remove <id>      # only when the user asks to delete it
```

A session started from a task's **Start** button opens with the task in its first message.
When that work is finished, mark the task done.

## If Tasks is off

`pocket-tasks` exits with code 3 and says so. Tell the user that Tasks is turned off and can
be turned on in Pocket Code under **Settings → Projects, files, tasks & vault → Tasks**. Do not keep a
to-do list anywhere else instead.
