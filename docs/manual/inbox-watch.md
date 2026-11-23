<!-- manual
checked: 1.118.0
sources: inbox.mjs, inbox-runner.mjs, public/inbox.js, scripts/pocket-inbox.mjs, skills/pocket-inbox/SKILL.md, inbox-watch/
-->
# Inbox Watch

Inbox Watch reads one Gmail mailbox on a schedule you set and keeps a list of the mail that is work for you. It follows
each situation as a story across threads and senders, keeps a memory of recent mail, and puts an **alert** on your list
when an email leaves something to do: a problem to look into, a person waiting on your answer, a bill that is now due, a
reply that never came. Your push settings decide, separately, which of those also reach your phone. A **morning digest**
covers the rest, and a **look-ahead** twice a day checks what is coming due.
Everything it sends lands in Pocket's **Inbox**, where you read it, start a conversation already briefed on the story,
and tell the watcher what you thought of it.

Inbox Watch has two parts. The **Inbox** is the list inside Pocket (`inbox.mjs`, `public/inbox.js`, the `pocket-inbox`
command). The **watcher** is a Python program shipped in the `inbox-watch/` folder of the Pocket Code directory; it
reads the mail, asks a model to judge it, and posts to the Inbox. Pocket runs the watcher for you unless you installed
one by hand.

## Requirements

- Python 3.11 or newer available as `python3` to the Pocket server. Reading through a connector needs nothing beyond
  the standard library.
- Claude Code signed in with a Claude subscription and the **Gmail** connector connected, or Codex signed in with
  ChatGPT and the **Gmail** app connected. Either is enough; with both on the same mailbox, each stands in for the other.
  See [Gmail, Calendar and Drive for agents](google.md#connect-for-claude-code).
- Optional: an OpenRouter key for the first pass (see [First pass](#first-pass)).
- Optional: [Files](files.md) turned on, so digests and look-aheads are also kept as documents, and push notifications on
  your devices for alerts.

## Set it up

1. Connect Gmail for Claude Code or Codex: **Settings → Agents & instance → Connectors** (in Assistant mode,
   **Settings → Accounts → Connectors**).
2. Turn on **Settings → Projects, files, tasks & vault → Inbox Watch** (in Assistant mode, **Settings → Features → Inbox Watch**). The toast says
   *Inbox Watch is on*, and **Inbox** appears in the sidebar switch and as a chip on the home screen.
3. Open Pocket once on your phone or computer, if you have not since turning it on. The watcher uses the time zone
   your browser reports for quiet hours, the digest and the look-ahead.

Nothing else is needed. Within a minute Pocket:

1. Finds your mailbox. It asks Claude Code's Gmail connector first, then Codex's Gmail app, whose account they read.
   Through Claude Code the address is taken from the newest message in your Sent mail; through Codex, from the app's
   profile.
2. Writes the watcher's config to `POCKET_DATA_DIR/inbox-watch-data/config.toml` and an empty rules file beside it.
3. Starts from now: mail already in the mailbox is not news, so nothing old is alerted on.
4. Loads the last 14 days of mail as the watcher's memory.
5. Runs the watcher's `tick` every minute. A tick checks mail only when your schedule says a check is due.

While this happens the Inbox shows a status line: *Setting up Inbox Watch for alex@example.com*, then
*Watching alex@example.com. Nothing needs you yet* until the first alert arrives.

### What Pocket's setup chooses

| Setting | Value written | Change it in |
|---|---|---|
| Mail source | Claude Code's Gmail connector (reads made by Haiku), else Codex's Gmail app (the newest GPT Luna this Codex lists, low reasoning); the other one as fallback when both reach the same mailbox | `config.toml`, `[mail]` |
| Judge | Claude Code with Sonnet, medium reasoning, when Claude Code runs on the server; otherwise Codex with the newest GPT Sol this Codex lists (GPT-6.1 Sol today), medium. Both are written when the watcher is set up; an existing `config.toml` keeps its models | Schedule sheet, **Models** |
| Schedule | every 5 minutes, quiet hours 10 PM to 8 AM, digest at 8 AM, look-aheads at 8 AM and 5 PM | Schedule sheet |
| First pass | on, Jev, skip at 80% sure (works only once a key is present) | Schedule sheet, **First pass** |
| Tidy | on, every 2 hours | Schedule sheet, **Keep the Inbox tidy** |
| Gmail label | on, named *Pocket Inbox* | Schedule sheet, **Your list in Gmail** |
| Briefed conversations | start in your home directory, with Claude Code (or Codex when only Codex is signed in) | `config.toml`, `[pocket]` |

Each time Pocket starts, it asks the connector whose mailbox it reads. If you have reconnected Gmail to a different
account, Pocket writes the new address into `[owner]` (the watcher tells your own mail from other mail by it), drops a
fallback agent that is still on the old account, and the Inbox says *Gmail is now connected as … (it was …)* for a few
days. The mail already kept from the old account stays in the watcher's memory. Sending from an alias of the same account
is not a change: the configured address only has to be among those that sent your latest sent mail. Only a config Pocket
wrote is changed.

The settings in Pocket win over the file. Edit `config.toml` only for what Pocket has no setting for, such as the
optional [memory integration](#memory-integration-optional) or emailing alerts (`email = true` under `[[delivery]]`).

### A watcher you install yourself

To watch another mailbox, read Gmail through Google's API (an OAuth client or a Workspace service account), use a
different judge (OpenClaw, the Claude API) or deliver to Telegram or email as well, install the watcher by hand. The
steps, every config key and the systemd timer are in [`inbox-watch/README.md`](../../inbox-watch/README.md) and
`inbox-watch/examples/config.example.toml`. With an OAuth client, the token file `gmail-auth` writes is mode `0600` from the start, and stays so when the watcher renews it. The `inbox-watch/bin/inbox-monitor` command uses the first `python3` on `PATH` that is 3.11 or newer, or the one named
in `INBOX_MONITOR_PYTHON`. Turn on Inbox Watch in Pocket so its Inbox receives what that watcher sends.

Pocket never manages a mailbox someone else set up. If a watcher is already reporting to this Pocket (it sends its
profile with `pocket-inbox seen`, as every `inbox-monitor` does) and Pocket has no config of its own, Pocket leaves the
Inbox to it, does not start its own, and the Inbox says so. A job that only posts with `pocket-inbox add` is not a
watcher and does not stop Pocket. `POCKET_INBOX_RUNNER=0` in Pocket's environment turns Pocket's own watcher off entirely.

## Use it

### What it sends

| Kind | When | What it holds |
|---|---|---|
| **Alert** | at a check, when a thread belongs on your list (see [What goes on the list](#what-goes-on-the-list)) | A title, a short text citing the emails it rests on, the story it belongs to, a priority, **Start a conversation** and **Open in Gmail** |
| **Digest** | once a day at the digest hour, outside quiet hours, when there is something to say | Alerts held overnight, ones that resolved overnight, *Worth knowing* lines, entries the tidy pass took off, and how many threads were ignored. Each line is an item of its own in Pocket, with its own choices (see [A digest's items](#a-digests-items)) |
| **Look-ahead** | once in each look-ahead window (from the hour you set, for 4 hours), outside quiet hours | What is due or at risk in the next few days, from open stories and dated mail. Sent only when something needs you |

#### What goes on the list

The list is a work queue, not a set of interruptions: an alert is there for you to go through later, often by starting
a conversation from it. The judge asks whether the email leaves something for you, or an assistant working for you, to
do. Since 1.109 that means:

- **Something is failing, or looks like it**: a website, server, scheduled job, backup, device, integration, licence,
  subscription, payment or account that failed, expired, was declined or went offline, from an automated notice as much
  as from a person, and also when it is someone else's to fix and nothing shows they have. A problem that cleared itself
  stays off unless it keeps coming back.
- **A person is waiting on you**: mail written to you that needs your reply, decision or action. The watcher tells the
  judge whether your address was in To or only in Cc; a copy counts when the matter has fallen to you or nobody is on it.
- **Mail like what you worked on before**: you started a conversation from an alert on that story or on the same kind of mail,
  or labelled such mail by hand (see [Learning from your choices](#learning-from-your-choices)).
- **Pieces that connect** (a repeat after a repair, a contradiction, a promise now due, a missing reply) and anything
  critical or time-sensitive, as before.

A story gets one alert. A problem that has only been followed quietly, even for weeks, is listed once when it meets the
test, with how long it has gone on (a line in a morning digest does not count as having been listed); after that more of the same mail updates the story without a new alert, whether or not
you have dealt with the entry, until something about it changes what someone must do. Newsletters, receipts, routine
reports that show nothing wrong and anything someone is visibly handling stay off. Your rules override all of this.

**One entry per story (1.113).** When an alert does go out on a story that already has an open entry (new or seen), it
updates that entry instead of adding a second one. The new text comes first, and what the entry said before follows under
*Earlier on this entry*. The entry is unread again and moves to the top, keeping its conversations. A finished entry
(resolved, dismissed, not useful) is never reopened this way: the next alert on its story is a new entry. This applies to
mail you or a Gmail filter labelled too, so a burst of labelled messages on one story is one entry.

**A conversation started from an alert opens with a short check (1.113).** Before you say what you want, the agent looks
for other mail on the story that the alert does not cover. It also looks for another open entry on the same story, often
under a different title, and merges each one it finds into the entry the conversation came from. The merged entry leaves
the list with a note naming the one it went into, and its Gmail thread loses the label. **Restore** on it undoes the
merge. An entry that asks for something different stays, and the agent mentions it.

**The opening reply leads with the email (1.113.2).** The check feeds the reply; it does not replace it. The agent's
first reply says what the email says (who wrote, what they ask or tell you, the key lines quoted), then in a few lines
what the check added (other mail, merged entries, or that it found nothing new), then where things stand and the
suggested next step.

**A conversation you already started catches up (1.113, reworked in 1.115).** When more mail arrives on a story whose
entry you already started a conversation from, that conversation is behind, and Pocket says so wherever you would meet
it:

- If a reply is running in it, the new mail goes straight in, the way a message you type mid-reply does, and the agent
  takes it into account at its next step.
- If it is idle, a **news card** sits under the latest reply: *New mail on this story*, when it came, and the mail's
  first sentence. It takes the place of the [Complete card](conversation.md#close-a-finished-conversation-the-complete-card),
  so a conversation with unread mail never offers **Close conversation**. The card has three controls:
  - **Bring it in** sends the new mail (each update's title, summary, Gmail link and time) as your next message and
    asks the agent what it changes.
  - **New conversation** opens the two ways to take the mail somewhere else (below).
  - **Not now** puts the card away on this device, and the Complete card comes back, until more mail arrives.
- In the conversation list, on its tab and in its header the conversation reads **New mail** instead of Complete, and
  the list's one-tap close tick is hidden while it does.
- When the conversation is large, the card says how large (*This conversation is at 412K tokens*), which is the usual
  reason to start a new one.
- The same happens when another entry is merged into this one, and a conversation that was started from the merged
  entry is offered this entry's story. The conversation that did the merge already has it.

Nothing starts a reply on its own.

**Three ways to take new mail (1.115).** Open an entry whose conversation is behind and the sheet gives the choice
first, before you land anywhere:

| Choice | What happens | Use it when |
|---|---|---|
| **Continue the conversation** | Opens the conversation and brings the new mail in. The line under it says when the conversation started and how large it is. | The mail belongs with the work already there. |
| **New conversation, hand-off from the last one** | The earlier conversation writes a briefing for a new one, with the new mail as the first thing to deal with, and shows the handoff card with **Start**. Once you start it, the entry points at the new conversation, and later mail on the story goes there. | The mail belongs with that work, but the conversation has grown too large to keep going. |
| **New conversation, separate subject** | The new mail leaves the entry and becomes an Inbox entry of its own, with a briefing on that mail only plus a line naming the earlier conversation as background. The first entry goes back to what it said before. The watcher is told, so later mail on that thread goes to the new entry and the two are not merged again. | The mail is about something else that happened to arrive on the same story. |

The news card's **New conversation** button offers the last two from inside the conversation. A hand-off costs one
reply in the earlier conversation (it writes the briefing); a separate subject costs none.

When the conversation is not behind, the sheet offers **Open the conversation**, the hand-off, and **Start another
conversation**, which is briefed with the entry only. The chat icon on a list row still opens the conversation without
sending anything.

Limits worth knowing: only the latest update, or the latest entry merged in, can be split off, and an update only
from an entry that has a conversation (an entry nobody opened keeps no record of its separate updates). A split entry
that had no conversation gets an ordinary briefing; nothing runs until you press **Start**. A split is not undone
with a tap: merging a split pair back together is refused, on purpose. **Not now** is remembered per device.

An agent can do the split when you ask for it in a conversation: `pocket-inbox split --session <conversation id>`
(or `split <entry id>`). It never does so on its own.

Priorities are critical, high, normal and low. **Critical** is kept for live outages you are the escalation for,
security incidents and money leaving an account unexpectedly. During quiet hours only critical alerts go out; the
rest are held. At the digest hour up to five held high or critical alerts go out on their own, marked *Held
overnight.*, and the rest fold into the digest. A held alert whose story was resolved overnight is not sent.

An alert can also push to devices that have **Settings → Notifications & voice → Inbox alerts** on. Which alerts push
is your choice (see [Push notifications](#push-notifications)); by default every one does. The push shows the title and
the first sentence; tapping it opens the briefed conversation, or the entry when there is none. An open entry says
whether it pushed and why (*Pushed: the site has been dark since 7:10 p.m.*, *On your list without a push*).

#### Push notifications

Since 1.105 the list and the interruption are separate. Every alert goes on your list; **Push notifications** in the
schedule sheet decides which of them also push:

- **Every alert** pushes them all (the behaviour before 1.105, and the default).
- **Only what can't wait** pushes a critical alert and one the judge put in a kind of urgency you switched on. The
  judge names the urgency for every alert by asking whether waiting a few hours would make it worse:
  **Emergencies** (a dispatch request, an alarm, a safety problem), **Outages you're the escalation for** (down, nobody
  on it), **Money at risk** (past due or about to cost a fee or a shutoff, a failed payment, an unexpected charge),
  **Security incidents**, **Someone waiting on you** (blocked until you answer, today) and **Deadlines today or
  tomorrow** (the look-ahead counts here). A bug report, a phone call that went badly, a quote to prepare or an outage
  someone is already on is worth a place on the list but not an interruption.
  **At most** caps pushes per day (3 to 20, or no limit); past it, alerts arrive silently. **Same story again**:
  *Only when it gets worse* pushes a story again within a day only when its priority rose; *With each new fact*
  pushes every alert on it. A critical alert ignores the cap and the repeat rule.
- **Nothing, list only** pushes nothing, the digest included.

Your rules can steer it ("Always push: emergency dispatch requests", "Never push: marketplace job offers"); they win, as
everywhere. Quiet hours still hold everything but critical alerts.
Digests and look-aheads are also saved to **Files** when Files is on.

### Read the Inbox

Open **Inbox** from the sidebar switch (the envelope, with a count of unread entries), the **Inbox** chip on the home
screen, or `#/inbox`. It opens like a conversation: as a tab, beside a conversation or in its own window. In Assistant
mode up to three open alerts also wait on the home screen as **Waiting for you** cards.

- The chips filter the list. **Open** (the default) is everything still on your list, read or not. **Unread** is
  only the new ones. **Done** holds what is resolved, not useful or dismissed, each row showing why.
- **Search titles and stories** narrows the list by title, story or text.
- Each row shows the title, the first sentence, the time, the story and the kind. The **dot** beside the title is
  filled while unread; tap it to mark the entry read or unread. A **speech bubble** under it opens the conversation
  you started from that entry.
- Tap the row, or **…**, to open the entry's sheet. Opening it marks it read.

The entry's sheet shows the whole text, with each citation a link to that email in Gmail, and these choices:

- **Open the conversation**: the conversation started from this entry (the latest, when there are several).
- **Start a conversation** (or **Start another conversation**): a new conversation already briefed with the story,
  the evidence and the Gmail links. Nothing starts until you press Start. The briefing link lasts 7 days.
- **Open in Files**: a digest's full text.
- **Open in Gmail**: the thread.
- **Resolved**, **Not useful**, **Dismiss**, or **Restore** on a finished entry (see below).

The **X** on a row dismisses it directly.

### A digest's items

A digest's sheet shows one card per story, under the headings the digest has (*Held overnight*, *Came up overnight and
already resolved*, *Worth knowing*, *Taken off your Inbox*). Lines on the same story or thread share a card, newest first.
Each card has its title, its text (citations are Gmail links), its story and these choices:

- **Start a conversation**: a new conversation already briefed with that one story and its evidence, as an alert's is.
  Nothing is sent and the watcher learns nothing from it; it is for dealing with this one line now. Once a conversation
  has started, **Open the conversation** goes back to it and **Start another** begins a new one.
- **Add to Inbox**: this line should have been an alert. The watcher sends that story as an alert of its own at its next
  check (within a minute or two, whatever quiet hours say, since you are up and asking), so it sits on your Inbox to work
  later, and learns from it the way it learns from a Gmail label: a rule under *Learned from your choices* saying to alert
  on that kind of mail.
- **Resolved** and **Not useful**: the same as on an alert, but for that story alone rather than the whole digest.
- **Dismiss**: takes the line off your hands. The story is unchanged and the watcher learns nothing from it.
- **Undo**: takes any of these back. An alert the watcher has already sent cannot be unsent, so that card has no Undo.
- **Gmail**: the thread.

**Each story has one status, so nothing is worked twice.** A line whose story already has an open alert on your list is not
a new card: it sits under **Already on your list** as one line that opens that entry, and your decision belongs on the
entry. The line shows what you decide there. An alert that arrives after the digest does the same to a card still open, and
any conversation started from the card moves to the alert. A story on two digests is decided once: what you press on one
card shows on the other. A line that resolved overnight or that the tidy pass took off is history and has only the Gmail
link.

The card says *Adding to Inbox* until the watcher has sent the alert, then *Added to Inbox*, or *Resolved*, *Not useful* or
*Dismissed* once you have decided, and the digest itself stays
open until you dismiss it. Pocket keeps up to 200 cards on a digest; past that the digest says how many lines did not fit,
and the full digest in Files has every line. A digest from before 1.95 has no items and shows its text alone.

### A look-ahead's items

A look-ahead opens with its lead line, then a card for each item under **Coming up**, most pressing first. Each card has the
item's full text and the same choices as a digest card, with three differences:

- **Add to Inbox** sends the item as an alert but teaches the watcher nothing: a look-ahead item is something it found, not
  a kind of mail it underrated. **Not useful** does teach it.
- A card on a story already on your list keeps its text, since what the look-ahead found is news, and **Open in Inbox** goes
  to that entry. Your decision belongs there, and the card shows it.
- An item that is about no story the watcher follows is still a card. **Resolved** has nothing to close on it, and **Gmail**
  appears when the item cites an email.

An item that covers two stories is one card on the first of them, so **Resolved** closes only that one. A story on a digest
and a look-ahead is decided once: what you press on one card shows on the other. A look-ahead from before 1.95 shows its
text alone.

### Tell the watcher what you decided

| Choice | In Pocket | What the watcher does at its next check |
|---|---|---|
| **Resolved** | moves to Done | Closes the story: it stops following it and no longer treats it as open |
| **Not useful** | moves to Done | Keeps that story off your list from then on: later mail on it only updates the story, whatever the judge thinks of it, unless it turns critical. It also learns from it (see [Learning from your choices](#learning-from-your-choices)): a rule under *Learned from your choices* for that kind of mail, with your note taken into account, and later mail of the same kind (the same sender with a similar subject) is shown to the judge with your choice |
| **Dismiss** (the X on a row, or in the entry's sheet) | moves to Done | Takes the Gmail label off (below); the story is unchanged and the watcher learns nothing |
| **Restore** | back to Open | Reopens a story that Resolved had closed, and lets a story marked Not useful be listed again (a learned rule stays until you delete its line) |
| **Add to Inbox** (a digest item) | the card says *Adding to Inbox*, then *Added to Inbox* | Sends that story as an alert now, lifts a low story to normal and learns a rule to alert on that kind of mail |
| **Add to Inbox** (a look-ahead item) | the same | Sends it as an alert now and lifts a low story to normal; no rule |
| **Resolved** / **Not useful** (a digest or look-ahead item) | the card says so | As above, for that story alone |
| **Dismiss** (a digest or look-ahead item) | the card says *Dismissed* | Nothing; the story is unchanged |

With the Gmail label on, finishing an entry in any of the three ways also takes the label off its thread and archives
it, unless you starred it or new mail came in (see [Your list in Gmail](#your-list-in-gmail)). The X on a row is the same Dismiss as the sheet's; with the label on, its
tip and the confirmation say the label comes off in Gmail at the next check.

Pocket records each decision with the entry; the watcher asks for the ones it has not applied
(`pocket-inbox feedback`), applies them and acknowledges them (`pocket-inbox ack`), so none is applied twice. Each
acknowledgement names the decision the watcher read, so one you change while a check applies it is applied at the next.

### Check now

**Check now** sits beside the search box in the Inbox and beside **All** in the sidebar list. It asks the watcher
to check at once, whatever the schedule, paused included. The chip shows *Checking…* until the watcher reports back,
then the list reloads and a note says how many new items it found. A check you ask for skips quiet hours: its alerts
go out at once, together with every alert quiet hours were holding.

### Change the schedule, rules and models

**Schedule** in the Inbox, or **Settings → Projects, files, tasks & vault → Schedule, models and cost** (shown under
the Inbox Watch switch while it is on; in Assistant mode **Settings → Features → Inbox Watch schedule**), opens the Inbox Watch sheet. Its first line says what is in force, for example
*Checking every 5 minutes now (Work hours). Last check 9:14 AM, next about 9:19 AM.* **Save** sends the whole sheet;
the watcher picks it up within a minute, and the line says *Your last change reaches the watcher within a minute*
until it has. **Use the config file's settings** hands control back to `config.toml`.

- **Pause Inbox Watch**: no checks, digests or look-aheads until you turn it off. **Pause all** ([Automation](automation.md#pause-all)) pauses Inbox Watch the same way, so its model calls stop too, unless you turned off **Pause all also pauses Inbox Watch**. **Resume** turns it back on only if Pause all paused it and you have not changed these settings since; a pause you set yourself stays. **Check now** still asks for a check at once.
- **What it reads** (1.100): which mail the watcher looks at. **Everything** is every thread but spam, trash and drafts, so mail
  your Gmail filters archive or file away is judged too (the behaviour before 1.100). **Inbox only** reads what is in your Gmail
  inbox. **Inbox and these labels** adds the Gmail labels you pick from the chips (your labels appear once the watcher has read
  them; **Add** takes a name it has not listed). Mail outside the scope is never fetched or judged, for alerts or the digest; an
  email you label Pocket Inbox always joins the check, your replies count wherever the thread sits, so the watcher sees that you
  answered, and the research the judge does on a story is not bounded. A new email you start yourself is not read.
- **Your rules**: your own words about what you always or never want to hear about ("Tell me when a customer asks for
  a quote", "Never alert me about newsletters"). The watcher follows them in every decision, the first pass, the
  look-ahead and the tidy pass, and they win over its own judgment, even for something it would call critical. The
  box shows the watcher's rules file, including the rules it learned (*Learned from your choices*, at the end). Saving
  replaces the file; the watcher keeps the previous version. Up to 12,000 characters (8,000 before 1.109), of which
  the watcher's *Learned from your choices* section may take up to 5,000.
- **Your list in Gmail**: the *Pocket Inbox* label (below).
- **Schedule**: an interval for *the rest of the time* (from *Every minute* to *Every 4 hours*, or *Don't check*),
  and up to 12 periods, each with a name, days, *From*, *Until* and its own interval. An *Until* earlier than *From*
  runs past midnight. When periods overlap, the first listed wins. With *Don't check* and no periods, the watcher
  checks only on demand and with the digest and look-aheads.
- **Quiet hours and summaries**: *Quiet from* and *Until*, and the **Morning digest**, **Morning look-ahead** and
  **Evening look-ahead** hours (or *Off*). With the morning digest off, alerts held overnight arrive one by one when quiet
  hours end, and there are no digest-only lines: mail that is work goes on the list, the rest only updates its story. Times are the watcher's time zone; the sheet
  names it when your device is in another.
- **Push notifications** (1.105, both modes, under the rules): *Every alert*, *Only what can't wait* with its six
  kinds, *At most* and *Same story again*, or *Nothing, list only* (see [Push notifications](#push-notifications)).
- **Keep the Inbox tidy**: *Take finished items off my list* and **How often** (every 1, 2, 4, 8, 12 or 24 hours).
- **Models** (Developer mode): model and reasoning for **Decisions** and for the **Look-ahead**. A Claude Code judge
  offers Haiku, Sonnet, Opus and Fable; a Codex judge offers the model its config names. *Model default* leaves the
  reasoning to the model.
- **First pass** (Developer mode): *Skip routine mail first*, the **Classifier** and **Skip when at least** (70, 80,
  90 or 95% sure).
- **Cost, last 7 days** (Developer mode): checks, skipped mail, model calls, tokens and dollars per day.

In Assistant mode the sheet opens only from **Schedule** in the Inbox and shows no models, first pass or costs.

### Keep the Inbox tidy

With tidy on, every few hours outside quiet hours the watcher reviews the open alerts at least 30 minutes old and
takes off what no longer needs you. An older entry on a story with a newer one, and an entry whose story is closed, go
without a model call. For the rest, one judge call reads each entry with its story, the timeline and the later mail in
its threads (your own replies marked) and answers:

- **Resolved**: over. The entry is marked resolved and the watcher stops following the story.
- **Handled**: someone acted and it now waits on someone else. The entry is dismissed; the watcher keeps following it
  and alerts again if it changes.
- **Open**: still needs you. It is not looked at again until its story or threads change.

Every change must cite the email that proves it; money, security and legal items need explicit proof, and a request
with several parts stays open until every part is done, and so does one whose latest email asks you or your assistant
for something nobody has done yet. The reason becomes the entry's note, shown in Done, and the
next morning digest lists what was taken off. **Restore** brings any of them back, and what you do with a restored
entry afterwards (Not useful, Resolved, a merge) reaches the watcher like a decision on any other entry.

### Your list in Gmail

With **Keep a Pocket Inbox label in Gmail** on (the default), the open entries in your Inbox and one Gmail label stay
in step, both ways, at every check:

- An alert's thread gets the *Pocket Inbox* label (created when missing) and stays in your Gmail inbox.
- Give a thread that label in Gmail and the next check judges it and puts it on your list as an alert with a summary,
  even in quiet hours, and moves it back to your Gmail inbox if it had been moved out. The watcher also learns from it
  (below).
- A Gmail filter can add the label too (to put a kind of mail on your list as it arrives). The watcher tells the two
  apart: mail that arrives already carrying the label was labelled by a filter, so its alert says *Your Gmail filter put
  this on your list*, not *You added this*, and it teaches the watcher nothing. A label you add to mail already in your
  mailbox is yours. This needs the Gmail API (the service account or your own sign-in); through a connector the
  watcher cannot see when a label went on, so every label counts as yours.
- Mail in Gmail's Promotions tab (1.113.1): a label you put on it yourself still puts it on your list. A filter's label on
  promotional mail (or on spam or trash) comes off at the next check, and the thread stays where it is; the watcher does
  not read that mail, so it never goes on your list. A labelled thread that was never judged (the check that brought it
  in lost it) is judged again after 30 minutes.
- Take the label off in Gmail and the entry is dismissed in Pocket.
- Finish an entry in Pocket (resolved, not useful, dismissed, or tidied) and the label comes off and the thread is
  archived. A thread that got new mail after the label went on keeps its place in the inbox, so a reply you have not
  seen never disappears. So does a thread you starred (1.110.2): the star means you are keeping it in view, so only the
  label comes off. When the watcher cannot tell whether a thread is starred, it leaves the thread in the inbox.
- Restore puts the label back; the thread stays where it is.
- One thread per entry carries the label (1.113). When an entry takes in another thread, through a later alert on its
  story or a duplicate merged into it, that thread loses the label and stays in your inbox. Label it again yourself and
  it is judged like any other.
- Label two threads about the same thing (your copy of a reply and the copy sent to the assistant only, say) and the check may
  put both on your list as one entry. The second thread keeps its label while that entry is open and loses it when you
  finish it, like the first.
- An entry the tidy pass took off and you restored stays on your list until you finish it; the tidy leaves it alone.

The first sync only adds labels; threads you labelled before it began are left alone. Only that label, and a thread's
place in the inbox, are ever changed. This needs Gmail write access. Through Claude Code's connector, the connector
must have been granted more than reading; through the Gmail API, the `gmail.modify` scope. When the watcher can only
read, the sheet says *Inbox Watch can only read this mailbox, so it can't add the label yet* with the reason, and it
asks again every 30 minutes. With both connectors, Codex's Gmail app makes the change when Claude's may only read.

Two config keys under `[gmail_label]` have no Pocket setting: `archive = false` keeps finished threads in the inbox
(only the label comes off), and `inbox = true` also puts a thread into the inbox, once, when it gets the label (for
filters that file whole kinds of mail past the inbox). `name` changes the label's name.

### Learning from your choices

Four things you do teach the watcher what you want:

- **You label an email Pocket Inbox in Gmail** that is not on your list. The watcher records what it had done with it:
  ignored it, kept it for the digest, filed it as a quiet update, skipped it as routine, or not looked at it yet.
- **You press Add to Inbox on a line of the morning digest**: the watcher had kept it for the digest when you wanted an alert.
- **You mark an alert, a digest line or a look-ahead item Not useful**, with or without a note.
- **You start a conversation from an alert** (1.109). That is the list doing its job, so it writes no rule. The watcher
  asks Pocket about every half hour which alerts you started from, and from then on the judge is shown, with any new mail
  on the same story or of the same kind, that you worked on such mail and how often. It is shown your hand labels and
  Not useful marks the same way, for 180 days. The match is made by code: the same thread, the same story, or the same
  sender address with a similar subject. The sender alone is not a match, because one address can send every kind of mail.

At the same check, one judge turn turns the new examples into rules, as narrow as they allow: one email teaches it
about that sender and topic ("Alert on website-content requests from Acme Paving"), several of a kind from different
senders teach it the kind. It merges a new example into a rule it sharpens, rewrites or drops a rule a newer example
contradicts, and notes in the log when an example conflicts with a rule you wrote (it then writes only the narrow
exception). The rules go at the end of your rules file under *Learned from your choices*, one line each with the
evidence in brackets (`(you added 2, Oct 31)`), at most 20 lines and about 3,300 characters (less when your own rules
are long: the whole file has to fit the rules box); the judge and the first pass read them with the rest. A rule that
would run long is split in two, and when the rules do not fit the judge is asked once more; anything still cut is
named in the watcher's log. `python3 -m inbox_monitor learn --rebuild` folds every example in again, for an install
where an earlier version dropped rules (add `--dry-run` to see the result first).
You see and edit them in the rules box; a line you delete stays deleted unless a new example supports it again.
Labels a Gmail filter put on and alerts you resolved or dismissed teach it nothing. Labelling a thread by hand also lifts
an earlier Not useful on its story: your own hand wins.

## How it works

### A check

1. The watcher applies the decisions you made in Pocket (Resolved, Not useful, Restore), notes which alerts you started a
   conversation from, and learns from new examples.
2. The watcher finds threads with new messages since the last check (through a connector, by searching by date from
   the day before the last check and skipping the messages it has already seen) and syncs the Gmail label. Mail counts
   as seen only once its thread is in the backlog, so a check that stops part-way leaves it to the next one. Through a
   connector a check reads at most 3 days back: after a longer gap, `monitor.log` says which days were not checked.
3. The [first pass](#first-pass), when on, sets aside clearly routine mail.
4. The judge reads the rest in batches. With each thread it gets related mail from the archive, the open stories with
   their timelines, the alerts already sent (the newest few, and others from the last day that share a word with the
   batch), the same order, invoice or account numbers seen before, what you did with earlier alerts like it, your rules
   and, optionally, [memory](#memory-integration-optional). It may ask for up to three Gmail searches. It answers per
   thread: **notify** (on your list), **digest** (a line in the morning digest), **update** (the story changed, no
   message) or **ignore**. With the morning digest off the judge is told there is none, so nothing is written for a
   digest that will not be sent: such mail goes on the list if it is work, and otherwise updates its story. For a notify it also names the kind of urgency, if any, and in one sentence what gets worse if it
   waits; your push settings decide from that whether it pushes.
5. Alerts go out together once every batch is judged, so a later batch can fold a new fact into an alert that has not
   left yet. The same fact is never alerted twice. An alert a stopped check never sent goes out at the start of the
   next one (held until morning in quiet hours, dropped if its story was resolved since); Pocket knows it by its key,
   so one that had already reached the Inbox is not listed or pushed again. An alert that could not be delivered
   (Pocket not answering, as while it restarts, or answering too late) is tried again the same way at the next checks,
   up to five times in all and within the day; after that it is only in `monitor.sqlite` and `monitor.log` says so.
   One that Telegram or email took while Pocket did not is tried again the same way, to Pocket alone.
6. Due items run: the digest, a look-ahead, the tidy pass. Then the watcher reports to Pocket with its settings, status
   and costs (the heartbeat).

A check judges up to 20 threads; a burst waits in a backlog and is spread over the next checks. If a judge call
fails, the batch stays in the backlog and is judged afresh next time. Pocket stops a run of its own watcher that takes more
than 30 minutes, with any judge or mail read it started. A check still running when Pocket restarts (an update) finishes on its own, logging to `monitor.log`;
the next check waits for it.

### Where data lives

| Path | What |
|---|---|
| `POCKET_DATA_DIR/inbox.json` | The Inbox entries, the time each watcher last reported, its last report (profile), your settings and Check now requests |
| `POCKET_DATA_DIR/starts.json` | The briefings behind **Start a conversation** |
| `POCKET_DATA_DIR/inbox-watch-data/config.toml` | Pocket's watcher config |
| `POCKET_DATA_DIR/inbox-watch-data/preferences.md` | Your rules |
| `POCKET_DATA_DIR/inbox-watch-data/status.json` | What Pocket's runner is doing (shown in the Inbox) |
| `POCKET_DATA_DIR/inbox-watch-data/state/` | `mail.sqlite` (the mail archive), `monitor.sqlite` (stories, decisions, alerts, model calls, tidy log), `monitor.log`, earlier rules files in `preferences-backups/` |
| `POCKET_DATA_DIR/inbox-watch-data/files/` | Digests and look-aheads saved for Files (`~/inbox-watch-files` when the data directory is outside your home directory or in a hidden folder) |

`POCKET_DATA_DIR` defaults to the Pocket Code directory. `inbox.json` and `starts.json` quote your mail; keep them out
of anything you share.

Inbox entries are kept 60 days, dismissed ones 30 days after dismissal, and at most 500 (the oldest read ones go
first). The mail archive keeps messages for 120 days. A file named `STOP` in `inbox-watch-data/` stops every run
until you remove it.

### Costs and models

The cost table in the sheet counts every model call: decisions, look-aheads, tidy passes, and the connector's read
calls. On a Claude or ChatGPT plan nothing is billed per call; the calls draw on the plan's usage limits, and the
dollars shown are what the same tokens would cost at API list prices. The sheet says which applies. With `ANTHROPIC_API_KEY`
set in the server's environment, a Claude Code judge is shown as billed per token.

What moves the cost: the model, and the interval. A longer interval batches more threads into each call. Most of a
decision call is the same background each time (instructions, open stories, recent alerts), not the new email; since
1.104 it carries only the related alerts and fewer related threads, about a fifth fewer tokens a call. A Codex
read call carries about 30,000 tokens of Codex's own instructions, so reading through Codex uses more of a ChatGPT
plan than reading through Claude Code uses of a Claude plan.

### First pass

Before the judge, a decision model can read each changed thread and say whether it is routine (receipts, shipping,
newsletters, marketing, verification codes). Mail at or above the confidence you set is skipped; its one-line headline
still reaches the judge, which may use it to close a story (a payment received, a system back up) but never to alert.
Code never lets it skip a thread you wrote in, one already judged worth more than ignore, one linked to a story, or one
sharing three distinctive words with a story touched this week. Any error means the judge reads the thread. It costs
fractions of a cent per email.

It runs through OpenRouter's decisions endpoint with **Jev (TypeSafe)**, the **OpenAI decision model**, or **Both
must agree**. It needs an OpenRouter key: a file at `~/.config/openrouter/keys/inbox-monitor.key`, or
`OPENROUTER_API_KEY` in the environment Pocket runs with. Without one the sheet says *The watcher has no classifier
key, so everything is read until one is set*.

### Memory integration (optional)

The watcher can use a long-term memory index of your past sessions and notes, configured in a `[memory]` table in
`config.toml` (the supported kind today is `memstem`; see the `[memory]` section of
`inbox-watch/examples/config.example.toml`). Pocket's setup does not add it.

- **Writing**: everything that reached you is remembered, one record per story you were told about (kept current),
  plus each digest and look-ahead. Mail that was ignored is not written.
- **Reading back** (`search = true`): before each decision the watcher searches memory for the thread (subject,
  sender's name and company, order or ticket numbers), and in the tidy pass for each open entry. Up to three items
  each, kept only when they share the email's names, numbers or subject words, and marked when written after the
  email. A later item that shows the work done (a fix released in a session, a call made) makes the judge record an
  update instead of an alert, and lets the tidy pass take an entry off. A failing search turns memory off for that
  check and never fails it.

### Privacy

- **Reading mail.** Through Claude Code's connector, each read is a short `claude -p` call that may use only the
  Gmail read tools (search, get thread, get message); every Gmail write tool and other connector is blocked and a hook
  refuses anything else. Through Codex, reads run in a Codex home of the watcher's own with every app but Gmail off,
  only the read tools on, no shell and a read-only sandbox. Label changes run separately, allowed only the label tools,
  and each call is checked against the label and threads the watcher asked for. The mail passes through Anthropic or OpenAI as part of
  those calls.
- **Judging.** The thread text, related mail, story history, your rules and any memory items go to the judge's
  provider (Anthropic for Claude Code, OpenAI for Codex). The judge runs isolated: no built-in tools, no shell, files or
  web, none of your Claude Code settings, hooks or CLAUDE.md, and no saved transcript. A Codex judge runs in its own
  Codex home with every app off.
- **First pass.** When on and keyed, the newest message of each eligible thread (sender, recipients, subject, labels
  and the first 3,000 characters of the body) and your rules go to OpenRouter and the chosen classifier.
- **On the server.** The archive, the stories and the log stay in `inbox-watch-data/`. Pushes carry the title and
  first sentence. With `email = true` under `[[delivery]]`, entries are also mailed to your notification
  address.
- Email content is treated as data, never as instructions to the judge.

## For agents

Use the **pocket-inbox** skill ([`skills/pocket-inbox/SKILL.md`](../../skills/pocket-inbox/SKILL.md)). While Inbox
Watch is on, Pocket installs it into Claude Code's and Codex's skill folders and adds a line naming the exact command
to the instructions of every conversation it runs. Run `pocket-inbox` from the Pocket Code directory as `node scripts/pocket-inbox.mjs`.

```bash
pocket-inbox list                          # unread entries, newest first
pocket-inbox list --state all              # everything but dismissed (also: dismissed)
pocket-inbox list --since 2026-10-19T00:00:00Z [--json]
pocket-inbox show <id> [--json]            # one entry in full: text, story, links, note
pocket-inbox act <id> resolve|not_useful|dismiss|restore [--note "…"]
pocket-inbox act <id> alert|resolve|not_useful|restore --item <ref>   # one item of a digest (show lists each item's ref)
pocket-inbox act <id> open|unread          # read state only; the watcher is not told
pocket-inbox merge <id> --session <this conversation id>   # 1.113: fold a same-story duplicate into the entry this conversation started from (or --into <entry id>)
pocket-inbox split --session <this conversation id>        # 1.115: the latest mail on this conversation's entry becomes an entry of its own (or split <entry id>); only when the user asks
pocket-inbox watch [--json]                # schedule in force, next check, models, rules, 7 days of cost
pocket-inbox watch set --every 10          # or --pause, --resume, --file <path|-> (the whole settings object as JSON)
pocket-inbox watch reset                   # back to the watcher's config file
pocket-inbox check                         # Check now
```

- **Answer from the entries** when the user asks what Inbox Watch sent, about an alert, the digest or the look-ahead:
  title, what the text says, the story, when it came. Keep citation labels.
- **Record a decision only when the user names it** ("mark the Acme alert resolved", "that wasn't useful"). Never
  resolve, dismiss or mark not useful on your own judgment. Pass the user's reason as `--note`. If several entries
  could match, list them and ask. Confirm in one sentence afterwards.
- **One exception: merging (1.113).** In a conversation started from an alert, begin with the opening check the briefing
  asks for: other mail on the story, and other open entries on the **same** story. Merge those with
  `pocket-inbox merge <id> --session <this conversation id>` and say which you merged. Never merge an entry that asks for
  something different; mention it instead. The opening reply leads with what the email says, then what the check added,
  then where it stands (1.113.2).
- **Catching up (1.113).** A message that starts *New on this Inbox story since this conversation started* (or *The Inbox
  entry this conversation started from was merged into …*) is Pocket bringing later mail on your story into this
  conversation. Read the mail it cites, say in a few lines what it changes for the work in hand, and carry on.
  `pocket-inbox show <id>` lists the entry's conversations and which have not had the latest mail.
- **Hand-off and separate subjects (1.115).** When that message ends *Do not work on this here. Hand this off…*, the
  user chose a new conversation: write the handoff briefing with the new mail as the first thing to deal with, give the
  handoff card, and do nothing else. When the user says the latest mail is a different subject, run
  `pocket-inbox split --session <this conversation id>` and give them the briefing link it prints. A briefing that says
  the owner split its entry off another one means exactly that: never merge the two, and ask before relying on the
  earlier conversation it names.
- **Change settings only when asked.** To edit the rules ("stop telling me about shipping notices"), read
  `pocket-inbox watch --json` (`profile.rules.text`), add or edit the line, and save the whole settings object,
  `rules` included, with `pocket-inbox watch set --file -`. Confirm the line you added. While Pocket is paused, a change
  that would set Inbox Watch running again (`--resume`, `reset`, or settings without `"paused": true`) is refused with
  409 `paused`: tell the user Pocket is paused and only they can resume it (1.124.2).
- **Posting** is for jobs on the server, not conversations, unless the user asks for such a job:
  `pocket-inbox add --title "…" --text "…" | --file <path|-> [--kind alert|digest|lookahead]
  [--priority critical|high|normal|low] [--story "…"] [--source "…"] [--url /#/start/<id>] [--gmail <https://mail.google.com/…>]
  [--doc <Files id>] [--dedupe <key>] [--email] [--no-push] [--why "…"]`. It pushes to the user's devices unless `--no-push`;
  `--why` is one line shown on the entry about why it pushed or not;
  `--email` also mails the notification address. A `--dedupe` key used in the last 24 hours adds nothing and prints
  `duplicate`. An alert with a `--story` that already has an open alert entry from the same source updates that entry
  and prints `updated` (1.113). A job posting regularly should send `pocket-inbox seen` when it has nothing to post.
- Exit code 1 with *Inbox Watch is off for this Pocket Code* means the feature is off: tell the user it is under
  **Settings → Projects, files, tasks & vault → Inbox Watch**. Exit code 2 means Pocket is not running here (or
  refused the token).

The CLI talks to the running server over loopback with the token in `POCKET_DATA_DIR/cli-token`. It reads
`POCKET_DATA_DIR` and `PORT` from the environment or Pocket's `.env`; `POCKET_URL` overrides the address. Times print
in the owner's time zone.

To look at Pocket's own watcher from a shell, point the watcher at its config:

```bash
inbox-watch/bin/inbox-monitor --config "$POCKET_DATA_DIR/inbox-watch-data/config.toml" settings   # what is in force, next check
inbox-watch/bin/inbox-monitor --config … usage          # calls, tokens and cost per day
inbox-watch/bin/inbox-monitor --config … check          # whose mailbox the connector reads; sends nothing
inbox-watch/bin/inbox-monitor --config … tidy --dry-run # what the tidy pass would take off
```

## Troubleshooting

**The Inbox says to open Pocket so it knows your time zone.** The watcher waits for the time zone your browser
reports. Open Pocket Code on your phone or computer once.

**"Inbox Watch can't read your mail yet. Connect Gmail in Settings → Connectors."** Neither Claude Code nor Codex has
Gmail connected on this server. Connect it in **Settings → Agents & instance → Connectors** with the account that agent
is signed in with. Inbox Watch starts by itself within a minute.

**Setup stops with "no sent mail found to tell whose mailbox this is."** Through Claude Code's connector the mailbox is
recognized from your Sent mail. Send one email from that account, or connect Codex's Gmail app as well.

**"Inbox Watch couldn't check your mail for … It tries again every minute."** The last run failed with the reason
shown. After three failures in a row one push says *Inbox Watch can't check your mail*; the next good run clears it.
A chatgpt.com bot check on a Codex read is temporary; with both agents connected the other one reads instead.

**"Inbox Watch couldn't check your mail for …: the mail search is blind: after:… found nothing in 3 checks while
newer_than:1d finds … thread(s)."** Through a connector, three checks in a row found no mail at all in a window of a day
or more while a search for the last day's mail found some, so the connector is answering the watcher's search with
nothing (as the claude.ai Gmail connector did for searches bounded in seconds from 2026-10-27 until 1.83.1). Update
Pocket Code; if it is current, report it with the line from `state/monitor.log`. The watcher keeps checking every
minute and catches up the missed mail once a search works again.

**`monitor.log` says "the last check was … days ago and a check reads at most 3 days back".** Through a connector, a
check after more than 3 days without one (Pocket or the connector was down) reads only the last 3 days. Mail that arrived
in the days the line names was not checked: look through it in Gmail.

**"Inbox Watch hasn't reported since …"** The watcher has been silent for a day. For Pocket's own watcher, check
that `POCKET_INBOX_RUNNER` is not `0` and that there is no `STOP` file in `inbox-watch-data/`; `inbox-watch-data/status.json` and
`state/monitor.log` say what happened last. For a hand-installed watcher, check its timer.

**Every Inbox entry is gone after a restart, and the server log says `inbox.json could not be read`.** `inbox.json`
did not hold valid JSON when Pocket started (a hand edit, or a file damaged by a power cut). Since 1.124.3 Pocket keeps
it beside the original as `inbox.json.corrupt-<time>` and starts with an empty Inbox. To get the old one back, stop
Pocket, fix the kept copy (or take `inbox.json` from your backup), move it back to `inbox.json`, then start Pocket.
Entries added since then are replaced by the old file.

**The Inbox says "A watcher installed separately is reporting here; Pocket is not running its own."** A hand-installed
watcher reported its profile to this Pocket while Pocket had no config of its own, so Pocket leaves the mail to it. If
that watcher is not meant to be there, stop its timer: once it has been silent for a week Pocket sets itself up. Two
watchers on one mailbox send everything twice, so Pocket does not start its own while another is reporting.

**Check now says "Inbox Watch hasn't reported yet, so nothing is reading your mail."** No watcher has ever reported
to this Pocket. See the two entries above.

**The sheet keeps saying "Your last change reaches the watcher within a minute."** The watcher has not run since you
saved. Check the entries above. *Inbox Watch hasn't reported its settings yet* means a watcher too old to read
settings from Pocket.

**The Gmail label is unavailable.** The connector was granted read-only access. Disconnect and reconnect Gmail on
claude.ai and allow everything it asks for; for the Gmail API, run `gmail-auth` again or add `gmail.modify` to the
service account's delegation. Through a connector, label changes are made at most every 10 minutes; **Check now**
forces one.

**First pass says there is no classifier key.** Add an OpenRouter key as described in [First pass](#first-pass). The
next tick picks it up.

**Alerts in Telegram or email have no "Open in Pocket Code" button.** Outside Pocket the link needs Pocket's public
address. Open Pocket once through the address you normally use, or set `POCKET_PUBLIC_URL`. Entries in the Inbox itself
always have **Start a conversation**: they use a path inside Pocket and need no address.

**Digests show no Open in Files.** Files is off. Turn it on in **Settings → Projects, files, tasks & vault → Files**;
the text is in the entry either way.
