---
name: pocket-inbox
description: Read and answer Inbox Watch in Pocket Code. Use when the user asks what Inbox Watch (their inbox watcher, the inbox monitor) sent, about today's alerts, digest or look-ahead, about an alert on a customer or a story, or asks to mark one resolved, not useful or dismissed, or to bring one back. Also use when a job on this server needs to post an alert, digest or look-ahead to the user's Inbox.
---

# Pocket Code Inbox Watch

Pocket Code keeps **Inbox** on its own server: what the user's inbox watcher sent them. There
are three kinds of entry: an **alert** (one email thread that needs the user, with a briefed
conversation to open), a **digest** (a summary of a stretch of mail, kept in Files) and a
**look-ahead** (what is coming up today). Each entry has a title, a short text whose
`[label](msg:<id>)` citations point at the emails it came from, the story it belongs to (for
example "Acme HOA service-call story"), a priority, and links to open it in Pocket, in Gmail or
in Files. The user sees the list under Inbox in Pocket Code on every device and answers each
entry there. You read and answer it with the `pocket-inbox` command.

<!-- pocket:commands -->
Run `pocket-inbox` from the Pocket Code directory (`node scripts/pocket-inbox.mjs`). The session
instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->
<!-- pocket:manual -->
How this feature works, how it is set up and its limits: `docs/manual/inbox-watch.md` in the Pocket Code directory.
<!-- /pocket:manual -->

## Reading it

```bash
pocket-inbox list                     # the new (unread) entries, newest first
pocket-inbox list --state all         # everything except dismissed
pocket-inbox list --state dismissed   # dismissed entries (kept 30 days); Pocket's Done filter also shows resolved and not useful
pocket-inbox list --since 2026-10-19T00:00:00Z
pocket-inbox show <id>                # one entry in full: text, story, links, note
```

Use these when the user asks "what did Inbox Watch send today", "anything urgent from the
inbox", "what was the Acme HOA alert about". Answer from the entries: the title, what the text
says, the story and when it came in. Keep the citations' labels; the links are the user's to
open in Pocket or Gmail.

## Answering an entry

What the user decides about an entry goes back to the watcher, which changes what it sends
next time:

- **Resolved** (`resolve`): the situation is over. The watcher stops following that story.
- **Not useful** (`not_useful`): the user does not want alerts about this kind of thing. The
  watcher keeps that story off the list from then on (unless it turns critical) and adds the
  kind of mail to the user's preferences.
- **Dismiss** (`dismiss`): hide it in Pocket. Nothing else changes.
- **Restore** (`restore`): undo any of those three.

```bash
pocket-inbox act <id> resolve
pocket-inbox act <id> not_useful --note "Vendor newsletters are never urgent"
pocket-inbox act <id> dismiss
pocket-inbox act <id> restore
```

A digest's lines and a look-ahead's bullets are items with a `ref` each (`show` prints them, as `[a317]` or `[c3043.2]`). A decision can land on one item instead of
the whole entry: **Add to Inbox** (`alert`) has the watcher send that story as an alert of its own now and, from a digest,
learn to alert on that kind of mail; `resolve` and `not_useful` act on that story alone; `dismiss` takes the line off the user's hands and
changes nothing else; `restore` takes any of them back. A line under *Already on your list* cannot be decided here: act on the
alert entry it links to, and the line follows.

```bash
pocket-inbox act <id> alert --item a317
pocket-inbox act <id> not_useful --item a296 --note "Taylor texts me anyway"
```

**Act only when the user asks**, in words that name the decision: "mark the Northside alert
resolved", "that one wasn't useful", "dismiss the look-ahead", "bring back the Acme HOA alert".
Never resolve, dismiss or mark anything not useful on your own judgment, even when the
situation looks finished; tell the user what you see and let them decide. A `--note` carries
the user's reason, in their words, when they gave one. If more than one entry could match what
the user said, list them and ask which. (Merging a same-story duplicate into the entry a
conversation started from is the one exception; see below.)

After acting, confirm in one sentence: the entry's title and what you recorded.

## One entry per story (1.113)

The list holds one open alert per story. When the watcher sends an alert on a story that already has an open entry, that
entry is updated in place: the new text comes first, what it said before follows under *Earlier on this entry*, it is
unread again and moves to the top, and it keeps its conversations. `show` says how often it was updated and which threads
it took in.

**A conversation started from an entry** begins with a short check before the user says what they want (the briefing
asks for it):

1. Look for other mail on the same story that the briefing does not already cover: the same customer, site, ticket,
   invoice or sender in the last few weeks. Read what matters and say in a few lines what it adds.
2. Look at the open entries (`pocket-inbox list --state all`) for another one on the **same story**: the same incident,
   request or account, often under a slightly different title or story key.
3. Fold each such duplicate into this conversation's entry, then say which you merged:

```bash
pocket-inbox merge <other id> --session <this conversation id>   # or --into <entry id>
```

The other entry leaves the list with a note naming this one. Its Gmail thread loses the Pocket Inbox label, so only this
entry's thread carries it. The thread stays in the inbox, and **Restore** on the merged entry undoes the merge. Merge only
same-story duplicates. An entry that asks for something different, even from the same customer, stays as it is: mention
it instead. This is the one change an agent makes to the list without being asked.

**The check feeds the opening reply; it does not replace it (1.113.2).** Write the first reply in this order:

1. **What the email says**, first and in the most space: who wrote, what they ask for or tell the user, the key lines
   quoted, and what it means. Read the newest message in full; the briefing's excerpts are cut.
2. **What the check added**, in a few lines: other mail and what it changes, entries merged, an entry left because it
   asks for something different. One line when it found nothing new.
3. **Where it stands** and the suggested next step, using what the check found.

**Catching up (1.113.1).** When the entry a conversation started from gets more mail, or takes in a merged duplicate,
Pocket brings the news to that conversation rather than a new one: steered into a reply that is running, or, when idle,
sent as the user's next message once they tap **Bring it in**. It starts *New on this Inbox story since this conversation
started* (or, for a conversation whose entry was merged away, *The Inbox entry this conversation started from was merged
into …*). Read the new mail it cites, say in a few lines what it changes for the work in hand, and carry on; if the work
was already sent or done, say whether anything needs redoing. `pocket-inbox show <id>` lists the entry's conversations and
which have not had the latest mail.

**Hand-off instead (1.115).** The user can choose **New conversation, hand-off from the last one** for that mail. The
message then carries the same news and ends *Do not work on this here. Hand this off…*. Do what it says: write the
handoff briefing (`pocket-start add --handoff`, as for any handoff) with the new mail as the first thing the new
conversation deals with, give the handoff card, and stop. Do not start on the mail yourself. Once the user starts the
new conversation, the entry points at it and later mail goes there, not to you.

**A separate subject (1.115).** The user can also decide the new mail is not part of this story. In Pocket that is
**New conversation, separate subject**; in a conversation, when they say so ("that's a different thing, split it off"):

```bash
pocket-inbox split --session <this conversation id>   # or: pocket-inbox split <entry id>
```

The latest mail leaves the entry as an Inbox entry of its own, the first entry goes back to what it said before, and
the command prints the new entry's briefing link: give it to the user. The watcher is told, so later mail on that
thread goes to the new entry. Split only when the user asks; never on your own reading of the mail. A conversation
started from a split entry is told so in its briefing ("The owner split this off the Inbox entry …"): work it on its
own, **never merge it back** into the entry it came from (the merge is refused), and ask before relying on anything
from the earlier conversation the briefing names.

## When it checks, which models judge, what it costs

```bash
pocket-inbox watch                    # the schedule in force, the next check, the models, the last 7 days' calls and cost
pocket-inbox watch set --every 10     # change one thing, only when the user asks ("check every 10 minutes")
pocket-inbox watch set --pause        # or --resume
pocket-inbox watch set --file -       # the whole settings object as JSON (periods, quiet hours, digest, look-ahead, models)
pocket-inbox watch reset              # back to the watcher's own config file
pocket-inbox check                    # check mail now, whatever the schedule (when the user asks: "check my email now")
```

**Your rules** (the **Schedule, models and cost** sheet, or **Schedule** in the Inbox → Your rules) are the owner's own words about what they always or never want
to hear about; the watcher follows them on every check and they win over its judgment. When the user asks you to
change them ("stop telling me about shipping notices"), read them with `pocket-inbox watch --json` (`profile.rules.text`),
add or edit a line, and save the whole settings object with `pocket-inbox watch set --file -` including `rules`. Confirm
the line you added.

**Push notifications** (1.105, the same sheet): every alert goes on the list; `push` in the settings decides which also
push to the user's devices: `{mode: "all" | "urgent" | "none", kinds: [emergency, outage, money, security, waiting,
deadline], perDay: 3|5|8|12|20|0, repeat: "worse" | "every"}`. "Stop buzzing me about bug reports" is usually a
`push` change or a rule line ("Never push: …"), not a reason to drop the alert from the list. Change it only when asked,
the same way as the rules, and say what will push from now on.

Inbox Watch can also keep the list tidy on its own (the same sheet → Keep the Inbox tidy): every few
hours it takes off entries that have been resolved or handled, with the reason in the entry's note, and they show
under **Done**. An agent asked to "clean up my Inbox" now can still go through `list` and `act` by hand.

The same settings are in Pocket under **Settings → Features → Inbox Watch
→ Schedule, models and cost**; the watcher picks a change up within a minute. Dollar figures are
what the tokens would cost at API list prices; on a Claude or ChatGPT plan nothing is billed per
call, the plan's usage limits are what it draws on. Change settings only when the user asks.

## Posting to it (jobs on this server)

The inbox watcher and other jobs post entries; an agent in a conversation does not, unless the
user asks for that job to be set up.

```bash
pocket-inbox add --title "Acme HOA needs dispatch attention before 9 a.m." --file - \
  --kind alert --priority high --story "Acme HOA service-call story" \
  --url "/#/start/<id>" --gmail "https://mail.google.com/mail/u/0/#all/<thread>" --dedupe "vendor:<thread>"
pocket-inbox feedback          # the user's decisions the job has not applied yet
pocket-inbox ack <id@at…>      # after applying them: each id with the `at` feedback gave, so a newer decision stays
pocket-inbox seen              # a heartbeat when a run posts nothing
```

`add` sends a push to the user's devices (`--no-push` to skip it) and, with `--email`, an
email to the address saved in Settings. A `--dedupe` key already used in the last 24 hours
adds nothing and says `duplicate`.

## If Inbox Watch is off

`pocket-inbox` says so and exits with code 1. Tell the user that Inbox Watch is turned off and
can be turned on in Pocket Code under **Settings → Features → Inbox Watch**.
Exit code 2 means Pocket Code is not running on this server.
