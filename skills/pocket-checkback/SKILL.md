---
name: pocket-checkback
description: Have this Pocket Code conversation look again later, when the user asked for it. Use when the user says "check back in 15 minutes", "look again after the deploy", "let me know when it is live", or accepts your offer to check back; when a check-back's message starts your reply; or when the user asks what check-backs are set or to cancel one.
---

# Pocket Code check-backs

A check-back is one more turn of this conversation, later, at a time the user asked for. Pocket starts it with a labeled
message, you do the check, and Pocket tells the user the result with a push ("Checked back · <conversation>"). It is for
this conversation looking again itself: a page, a deploy, a job's result. When the user has to do something themselves,
a task (pocket-tasks) is still right.

<!-- pocket:commands -->
Run `pocket-checkback` from the Pocket Code directory (`node scripts/pocket-checkback.mjs`, or
`npx pocket-checkback`). The session instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->
<!-- pocket:manual -->
How this feature works, how it is set up and its limits: `docs/manual/automation.md` in the Pocket Code directory.
<!-- /pocket:manual -->

## Only when the user asked

Set one only when the user asked for it in this conversation, or accepted your offer of one. When the work will need a
later look and the user didn't ask, offer it once as a suggested reply that names when ("Check back in 15 minutes"). Never
set one nobody asked for.

Pocket enforces this too. A check-back can be set only from a reply the user started, or from a check-back's own reply up
to the chain limit. From a reply started by the queue, a retry, a coordination wake, or by you after a background job, it
is refused: offer it as a reply button instead, and if the user taps it, their reply can set it.

## Set one

```text
pocket-checkback add --at "+15m" --note "Check https://example.com/status shows 1.4.2; done when it does"
```

- `--at` takes `+15m`, `+2h`, `+1d`, or a date and time such as `2026-11-22 09:00` in the user's time zone. Turn a day
  name ("Friday at 9") into its date first.
- `--note` says what to check and what done looks like. It is the only thing the later turn is told, so make it complete:
  the URL, the command, the number you expect.
- The command answers with the time it is set for. Tell the user when you'll check back, then end your reply. Don't wait
  or poll in this turn.

Refusals come back as one plain sentence (outside the allowed range, too many waiting, the feature or this engine switched
off, Codex not under Full access). Tell the user what it said and offer a task instead.

## When a check-back starts your reply

The message starts with `[Pocket check-back · …]`, then `What to check:` and the time now. Do the check and reply briefly
with the result: the first line of your last message is what the push shows, so lead with the answer ("Live: the page
shows 1.4.2"). If the message says it ran late, take that into account.

If it isn't settled yet, the message says whether you may set one more. Set it only if another look is likely to settle it,
and say when. This reply may set one, not several: a second is refused (`one_more`); to change the time, cancel the
first and set it again. If it says this is the last one, say what is still open so the user can decide.

## See or cancel

```text
pocket-checkback list [--all]
pocket-checkback cancel <id>
```

`list` shows this conversation's check-backs (`--all` adds finished ones). Cancel one the user no longer wants, or one the
work made unnecessary. The user can also cancel any of them in Pocket.

## Codex

In Codex a check-back works only under Full access. Under Review actions the command can't reach Pocket, so say so and
offer a task instead.
