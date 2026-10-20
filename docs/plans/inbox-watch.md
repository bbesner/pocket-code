# Inbox Watch in Pocket: plan

**Prepared:** October 19, 2026 · **Status:** shipped: the Inbox library in 1.69.0 (October 19) and its schedule, models, first pass and cost settings in 1.70.0 (October 20); inbox-monitor 0.2 and 0.3 on Brad's instance · **Built against:** Pocket Code 1.68.1 (build 133) and inbox-monitor 0.1.0

## What it is

Inbox Watch already reaches Pocket: a push on the phone whose tap opens a briefed conversation, and
digests and look-aheads kept in Files. What is missing is a place in Pocket where those alerts
*live*, so you can see what it sent, act on one later, and tell it when it was wrong.

This plan adds **Inbox** as the fifth optional library beside Projects, Files, Tasks and the
Vault, built the way Tasks was: a small store on the server, a few routes, a view, a command for
agents and jobs, and a Settings switch. The worker stays outside Pocket on its timer; Pocket is
where the owner reads and answers.

**The test it has to pass:** Brad opens Inbox on his phone, sees this morning's Pradera alert and
the 8 a.m. look-ahead in one list, taps X on a notice he never wants again, and the next morning's
digest does not mention that kind of notice. On a seat, an account manager sees the same list with
no file path, model name or dollar figure anywhere.

## What goes where

| | Developer Pocket | Assistant mode |
|---|---|---|
| Rail entry | **Inbox** beside Chats · Projects · Files · Tasks · Vault, with an unread count | Library chip on home; new alerts also appear as **Waiting for you** cards |
| The list | Rows: time, title, first sentence, story, kind (alert / digest / look-ahead); Open · Gmail · X | Same rows, same actions, plain words only |
| Row menu | Open the conversation, Open in Gmail, Open in Files (digest / look-ahead), Resolved, Not useful, Dismiss, Restore | Same |
| Settings | **Projects, files, tasks & vault → Inbox Watch** on/off; **Notifications → Inbox alerts** push kind (finishes the 1.65 "alerts" kind) | Both, in the same places |
| Who writes to it | The worker (`inbox-monitor`) and any job, through `pocket-inbox` or `POST /api/inbox` | Same |

## Design brief (pinned for the build)

> *Reading this as: an Operate surface for one person checking what their inbox watcher sent, on a
> phone first; calm, dense enough to scan a day in one screen, every row answerable with one tap.*

- **Developer Pocket: VARIANCE 2 · MOTION 1 · DENSITY 5.** The Tasks list is the model: rows, not
  cards; the accent only on the unread dot and the pressed filter.
- **Assistant mode: VARIANCE 3 · MOTION 2 · DENSITY 3.** The Waiting-for-you card from 1.60,
  reused as-is for a new alert.
- **Existing tokens, no new colour.** Priority is a word in the row ("critical"), never a red
  bar. Icons are drawn (the `IC` set), in the rail's stroke and weight.
- **No kicker, no eyebrow, no card grid.** Build flow: this brief, then `impeccable` with it
  pinned; rendered checks at 390 and 1440, axe clean, detector run on the rendered pages.

## Release 1.69: the Inbox library

**Store.** `inbox.mjs` / `<data dir>/inbox.json`, like `tasks.mjs`: entries `{ id, at, kind:
alert|digest|lookahead, priority, title, text, story, source, url, gmail, doc, state:
new|opened|dismissed|resolved|not_useful, seenAt, actedAt, actor }`. Limits: 500 entries, text
2,000 characters, pruned after 60 days (dismissed after 30). Atomic writes, mode 0600, same
`write`/`now` injection for tests.

**Routes** (owner cookie or loopback token, direct loopback only, as for Tasks and start links):

- `POST /api/inbox` adds an entry **and** sends the push (kind `alerts`, urgent; the tap opens
  `url`, the start link, or the entry itself) and, when asked, the email. One call replaces the
  worker's `pocket-notify` call; `pocket-notify` stays for other jobs.
- `GET /api/inbox?state=new|all&since=` lists.
- `POST /api/inbox/act` `{ action: open|dismiss|resolve|not_useful|restore, id, note? }` records
  what the owner did; `open` marks seen.
- `GET /api/inbox/feedback?since=` returns the owner's actions a worker has not applied;
  `POST /api/inbox/ack` marks them applied. This is the loop that makes the X mean something.
- `/api/me` → `features.inbox`; `/api/settings` → `inbox` on/off. `dueTotal()` is unchanged; the
  app-icon count stays tasks and reminders. The unread Inbox count is its own badge in the rail.

**Command.** `scripts/pocket-inbox.mjs add --title … (--text … | --file -) --kind alert
[--priority …] [--story …] [--url …] [--gmail …] [--doc …] [--email]`, `list [--state new]`,
`act <id> <action>`, `feedback [--since …]`, `ack <ids…>`. Same loopback/token pattern as the
other four commands. A `pocket-inbox` skill is written while the feature is on, so an agent
asked "what did Inbox Watch send today" or "mark the Circa alert resolved" can do it.

**View** (`public/inbox.js`, rail view `inbox`):

- Rows newest first, grouped by day. A row: unread dot, time, **title**, first sentence of the
  text with citations rendered as Gmail links, then a quiet line "Pradera service-call story ·
  alert" (or "digest", "look-ahead"). Actions on the row: **Open** (the briefed conversation
  for an alert, the Files document for a digest or look-ahead), **Gmail**, **X** (dismiss).
- The row's **…** menu: Resolved ("this situation is over"), Not useful ("don't alert me about
  this kind of thing"), Restore (for dismissed). Each posts to `/api/inbox/act`.
- Filters as chips: **New**, **All**, **Dismissed**. Search by title.
- Empty states: "Nothing from Inbox Watch yet. It sends an alert only when an email tells you
  something the email itself doesn't." and, with the feature on but no worker reporting in 24
  hours, "Inbox Watch hasn't reported since Monday 8:05 a.m." (the store records the last
  `POST`).
- Lists keep up on their own, as Tasks does (the existing poll).

**Rail.** Six entries do not fit the phone rail as text. Change the rail switch to **icon plus
label on wide screens, icon only below 480px**, the pressed entry keeping its label, each with
`aria-label`, 44px targets and the existing badge. One change for all five libraries, shipped in
this release whether or not Inbox is on, so the rail is one component, not two.

**Assistant mode.** A `new` alert adds a **Waiting for you** card on home ("Inbox Watch: Pradera
needs dispatch attention before 9 a.m." · Open); the card clears when the row is opened or
dismissed. Digests and look-aheads do not make cards; they wait in Inbox and Files.

**Settings.** Projects, files, tasks & vault → **Inbox Watch** ("Alerts, digests and look-aheads
from your inbox watcher, in one list"); Notifications & voice → **Inbox alerts** as a push kind
with its own device toggle (`PUSH_KINDS` gains `alerts`; the 1.65 note said this would come with
the notification settings).

**Tests.** `test/inbox.test.mjs`: the store (limits, prune, states, feedback window), the routes
(token and cookie, tunnel refused, add sends a push and email, act and feedback/ack round trip),
the CLI. Browser suite: the list at 390 and 1440 in both modes, the row actions, the rail with six
entries at 360/390/768/1440, the Waiting-for-you card, axe clean.

**Done when:** the Pradera alert sent by the worker appears in Inbox within a run, opens the
briefed conversation from the row, X hides it, Not useful shows up in `/api/inbox/feedback`,
the rail reads at 360px with six entries and 44px targets, and the browser suite is green.

## inbox-monitor 0.2: the loop closes

- The `pocket` delivery posts each alert, digest and look-ahead to `POST /api/inbox` (one call
  gives the entry, the push and the optional email) instead of calling `pocket-notify`. The entry
  carries the story key, priority, start link, Gmail thread, and the Files id for a digest.
- At the start of every run the worker reads `/api/inbox/feedback`, applies it, and acks:
  - **Resolved** → the story is marked resolved with a timeline event "Brad marked this resolved
    in Pocket"; the judge sees it and stops following.
  - **Not useful** → one line appended to `preferences.md` ("Do not alert on: *title* — marked
    not useful on Oct 20"), which the judge reads every turn, and the story's priority drops to
    low. This is the part that trains it without a prompt change.
  - **Dismiss** → nothing; the row is hidden in Pocket only.
- The worker also posts a heartbeat (`POST /api/inbox/seen`, or a `source` timestamp on the next
  add) so Pocket can say when it last reported.
- A replay (`inbox-monitor replay`) never posts; `--dry-run` posts nothing either.

## What stays the same

The timer, the archive, the stories and the judge stay outside Pocket. `pocket-notify` and start
links stay for other jobs. Push, Files and Tasks are unchanged except the new push kind and its
toggle. Nothing in a conversation changes.

## Rollout

Pocket 1.69 follows CONTRIBUTING.md: branch, unit and browser suites, PR, merge, deploy here,
then tenants and seats with the guarded scripts, ledger entry. inbox-monitor 0.2 follows on
Brad's instance first (his delivery is already `pocket`), then the first seat: Guy's, two
working days, then the other three, logged in `AGENT-SEATS.md`. Each seat needs its own
`config.toml` (service-account mail access, judge Sonnet/Opus, delivery `pocket`), a timer, and a
`preferences.md` seeded with the role's standing preferences.

## Decisions (Brad, October 19): the recommendations, all five

1. **The rail name.** "Inbox" (recommended: one word like the others) or "Inbox Watch".
2. **The rail at phone width.** Icons only below 480px with the pressed entry labelled
   (recommended), or a More menu for the fifth and sixth entries.
3. **Not useful writes to preferences automatically** (recommended) or only shows up in feedback
   for a person to apply.
4. **Dismissed rows** go to a 30-day Dismissed filter (recommended) or disappear.
5. **First seat** for Inbox Watch: Guy's (recommended, the account manager with the most
   customer mail) or Bryan's.
