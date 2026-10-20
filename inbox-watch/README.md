# Inbox Watch: the watcher (`inbox-monitor`)

This folder is the program behind Pocket Code's **Inbox Watch**: it reads one Gmail mailbox on a schedule and posts
what deserves attention to Pocket's Inbox. It ships with Pocket Code and runs beside it on the same server, on its own
timer; Pocket is where the owner reads, answers and sets it up (Settings → Inbox Watch). See the Pocket
[README](../README.md#inbox-watch-your-mailbox-read-for-you) for what it looks like from the Pocket side.

An inbox watcher with a model as the judge. On the schedule you set (every five minutes by default) it syncs one Gmail mailbox, hands the changed threads to
a judge together with everything it already knows (a 90-day mail archive, the open stories with their timelines, the
alerts already sent, repeat sightings of the same cameras, invoices and account numbers), and delivers only what
deserves attention, with a briefed Pocket Code session one tap away. Twice a day it looks ahead at what is due.

Built from the author's own inbox monitor (October 2026) and generalized so it runs for anyone: the owner, the
mailbox, the judge and the delivery are a TOML file. The engine is the same for everyone.

## The shape

```
Gmail history ──► backlog ──► bundles (+ related mail, stories, seen_before) ──► judge ──► decisions
                                                                                          │
                            stories + timelines + alerts (sqlite) ◄───────────────────────┘
                                                                                          │
                            quiet hours · dedupe · morning digest · look-ahead ──► deliveries (Telegram, Pocket, email)
```

Code owns state and delivery; the judge owns judgment and wording. The judge never needs to remember an earlier call:
memory is the archive and the story ledger, so a fresh process per call works as well as a long-lived agent.

## Judges

| `judge.kind` | What runs | Notes |
|---|---|---|
| `openclaw` | `openclaw agent --agent … --model …` | The owner's own assistant, with its memory and tools. Sessions rotate every 6 calls. |
| `claude` | `claude -p --output-format json` | Claude Code headless, one process per call; the Max plan covers it. Isolated by default: no built-in tools, no user settings, hooks or CLAUDE.md, no saved transcript. `mcp_config` + `allowed_tools` give it memory. |
| `codex` | `codex exec --json --ephemeral` | Codex CLI headless, one process per call. |
| `anthropic` | the Claude API (official SDK) | `claude-opus-5-5` by default, adaptive thinking, explicit effort, server-side refusal fallback. |

## Deliveries

| `delivery.kind` | Alerts | Digest and look-ahead |
|---|---|---|
| `pocket` | a push whose tap opens the briefed session (Pocket Code 1.58.1+) | kept in Files, the push links there |
| `telegram` | a bot DM with Open in Pocket Code / Open in Gmail buttons | one message |
| `email` | HTML mail with the same links | HTML mail |

With an OpenClaw judge and its own Telegram bot, replying to an alert is talking to the assistant. With Pocket, the
briefed session is the reply.

## Memory

With a `[memory]` table (MemStem today), everything that reached the owner is also remembered: one record per story they
were told about (its state, every alert and digest line they got, the dated timeline with Gmail links), kept current as
the story changes or they mark it resolved, plus each look-ahead, each digest and each alert another job sent through
`notify`. Records have stable ids, so a story is one record however often it changes. Mail that was ignored is not
written. `remember --all` writes the backlog at once; every run does the rest.

## Set up an instance

```bash
W=~/pocket-code/inbox-watch                                          # this folder, in your Pocket Code checkout
pip install -r $W/requirements.txt
mkdir ~/my-inbox && cp $W/examples/config.example.toml ~/my-inbox/config.toml   # edit it
touch ~/my-inbox/preferences.md                                      # standing preferences, read every turn
$W/bin/inbox-monitor --config ~/my-inbox/config.toml gmail-auth    # oauth only, once
$W/bin/inbox-monitor --config ~/my-inbox/config.toml check         # loads everything, sends nothing
$W/bin/inbox-monitor --config ~/my-inbox/config.toml backfill --days 90
$W/bin/inbox-monitor --config ~/my-inbox/config.toml --baseline-only   # start from now
```

Turn on **Settings → Projects, files, tasks & vault → Inbox Watch** in Pocket so its Inbox receives what the watcher
sends. Then a timer **every minute** that runs `tick` (systemd, with a failure email). `tick` checks mail only when a check is
due under the schedule, so the timer never sets the pace:

```
[Service]
ExecStart=/home/me/pocket-code/inbox-watch/bin/inbox-monitor --config /home/me/my-inbox/config.toml tick
```

Running it without `tick` checks now, whatever the schedule says (a manual run).

## Schedule, models and cost

When it checks and which models judge are settings: `[schedule]` and `[judge]` in the config are the defaults, and the
owner can change them in Pocket Code (**Settings → Inbox Watch → Schedule, models and cost**, Pocket 1.70+), which the
watcher reads every minute and caches for when Pocket does not answer. *Use the config file's settings* in Pocket hands
control back to the file.

- `every` minutes between checks, and any number of `[[schedule.period]]` tables (`name`, `days` = `"daily"`,
  `"weekdays"`, `"weekends"` or a list, `from`/`to` as `"HH:MM"`, `every`), each with its own interval; `every = 0`
  means no checks then. A period past midnight belongs to the day it starts. The first period that covers the moment wins.
- `paused = true` stops everything. The morning digest and the look-aheads still run at their hour even in a period
  with no checks (a check runs with them).
- The model and reasoning level for the decisions and for the look-ahead (`reasoning = "default"` leaves it to the model).
  For a Claude Code judge Pocket offers Haiku, Sonnet, Opus and Fable.

Every judge call is recorded in `judge_calls` (tokens in and out, cache, reasoning tokens, the list-price cost Claude
Code reports, milliseconds); `inbox-monitor usage` prints a daily summary, `settings` prints what is in force and the
next check, and the heartbeat sends both to Pocket. On a Claude or ChatGPT plan nothing is billed per call; the dollar
figure is what the same tokens would cost through the API.

**First pass (optional, `[firstpass]`).** Before the judge, a decision model (TypeSafe Jev, OpenAI's decision model, or
both agreeing, through OpenRouter's decisions endpoint, ~$0.00004 and ~0.15 s an email) reads each changed thread code
allows it to skip and says whether it is routine. Code never lets it skip a thread the owner wrote in, one already judged
worth more than ignore, one linked to a story, or one sharing three distinctive words with a story touched this week. A
skipped thread is recorded as an ignore decision (`issue_key = routine-first-pass`), and its headline rides in the next
decision turn as `skimmed_routine`, where the judge may only `update` a story from it (a payment received, a link back
up). Any error means the judge reads it. Settings: on/off, the classifier and the confidence threshold (Pocket or the
TOML). Every check is in `firstpass_log`; `usage` shows how many were skipped per day. Backtest (996 decisions): no alert
skipped at 0.8–0.9 with the rules; at 5-minute checks, ~18% (0.9) to ~22% (0.8) lower cost.

**Tidy (optional, `[tidy]`).** Every few hours outside quiet hours (`every_hours`, default 2; also a Pocket setting) the
watcher takes off the owner's Inbox what no longer needs them. Code first: an older entry on a story with a newer one is
superseded, an entry whose story the judge already closed is resolved. Then one judge turn (`prompts/tidy.md`) gets each
remaining entry with its story, the story's recent timeline and the recent mail in its threads (the owner's own messages
marked) and answers `resolved` (over; the watcher stops following), `handled` (someone acted, it waits on someone else; off
the list, still followed) or `open`, citing the message that proves it; no proof, no change. Money, security and legal items
need explicit proof; a monitor that went silent after a failure is not a recovery. The entry's note says why, Restore in
Pocket undoes it, `tidy_log` keeps every verdict, the morning digest lists what was taken off, and an entry judged open is not
sent again until its story or threads change. `inbox-monitor tidy [--dry-run]` runs it now. Backtest on 46 entries
(2026-10-20): it cleared 24, never one a human review had left open, and caught a "recovered" outage whose last notice was
a failure; ~$0.20 for the first full pass, pennies after.

**What a call costs, and what moved it (measured 2026-10-20 on Brad's mailbox, Sonnet 5.5).** A decision call carried
~45–65k tokens, almost all of it the same background every time (instructions, the open stories, the alerts already
sent, related mail), not the new email. Claude Code also wrote every prompt to its one-hour cache at about twice the
input price and never read it back, since no two bundles are alike. With the cache off (`prompt_cache = false`, now the
default), the other-story and recent-alert lists clipped, alerts already shown in a story not repeated and the bundle
JSON compact, a call went from ~$0.20 to ~$0.10 with the same decisions (agreement with the old prompt inside the
model's own run-to-run variation). Reasoning level made no measurable difference: Sonnet reasoned 0–500 tokens at low,
medium and high alike. A longer interval batches more threads per call: replaying one day, 10 minutes needed 24% fewer
calls than 5, 15 minutes 31% fewer, 30 minutes 44% fewer, for the same mail.

Reusing a Google sign-in another app already holds (an assistant connected to the same Gmail) works too: write an
`authorized_user` token file (`client_id`, `client_secret`, `refresh_token`, `token_uri`, and the `scopes` it was granted)
and point `oauth_token_file` at it. The watcher renews it with those scopes and only ever reads.

`touch STOP` beside the config pauses everything. `--dry-run` evaluates without sending. `notify --subject … --text …`
sends one alert through the same channel from any other job.

## Replay before tuning

```bash
inbox-monitor --config … replay --start 2026-10-19T08:00 --end 2026-10-19T09:00 --tick 5 --fresh
python3 inbox_monitor/replay_report.py state/replay.sqlite
```

Simulated clock, separate ledger, nothing sent; the judge sees only mail that existed at each moment.

## Layout

- `inbox_monitor/engine.py` — sync, archive, stories, research, batching, decisions, dedupe, quiet hours, digest, look-ahead, replay.
- `inbox_monitor/schedule.py` — the settings shape, periods, the interval in force and the next check.
- `inbox_monitor/judges.py`, `delivery.py`, `memory_sink.py`, `mail_gmail.py`, `config.py` — the adapters and the TOML loader.
- `tests/test_schedule.py` — the schedule rules (`python3 tests/test_schedule.py`).
- `inbox_monitor/prompts/decide.md`, `lookahead.md` — the judge's instructions, with `{owner}`, `{assistant}`, `{owner_email}`, `{memory_note}` filled from the config.
- `examples/config.example.toml` — every key.
