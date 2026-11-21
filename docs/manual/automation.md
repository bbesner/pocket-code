<!-- manual
checked: 1.121.0
sources: automation.mjs, checkbacks.mjs, public/automation.js, scripts/pocket-checkback.mjs, skills/pocket-checkback/SKILL.md, server.mjs, queue.mjs, codex.mjs, acp.mjs, sidechat.mjs, coordination.mjs, usage.mjs, inbox-runner.mjs, public/voice-text.js
-->
# Automation: Pause all, check-backs and limits on unattended work

Some replies start without you: a queued message that runs when the last reply ends, a usage-limit retry, a conversation woken by a hold, and, if you turn them on, a check-back you asked for. **Pause all** is one switch that stops every reply and holds everything automatic. **Check-backs** let a conversation look again later, at a time you asked for. **Limits on unattended work** keep that work from using up your plan. All three are in **Settings → Automation**.

Pause all is always available. Check-backs are off until you turn them on. Nothing else changes until you set it: with the defaults, 1.119 behaves as 1.118.

## Pause all

### What it does

- **Stops** every running reply, on Claude Code, Codex, OpenRouter and Antigravity, side chats included. It stops them the way **Stop** does ([Stop a reply](conversation.md#stop-a-reply)): work already done stays done.
- **Stops background jobs** in Claude conversations that show **Working in background** (a build or a watcher the agent left running), the way **Stop background jobs** does. The reply the agent would start when a job finishes never comes. If you turn off **Pause all also stops background jobs**, the jobs keep running until one of them starts a reply. Pocket stops that reply, which ends that conversation's process and any other jobs in it. A job started by a reply that is still running ends with that reply, as with **Stop**, whichever way the switch is set; the count includes it.
- **Stops a reply the agent starts by itself** while paused (Claude after a background job, Codex after a background terminal) as soon as it begins, with no notification. Pocket doesn't stop Codex's background terminals themselves; it doesn't track them.
- **Holds** every pending usage-limit retry. The retry is kept, not cancelled. A reply that hits a usage limit while paused has its retry held at once, and its notification says *The retry is held until you resume* (or *send a message to carry on* when **On Resume, re-arm held usage-limit retries** is off).
- **Holds every waiting check-back.** A check-back is kept, not cancelled, and does not run while Pocket is paused. One a conversation sets while Pocket is paused starts out held. See [Check-backs](#check-backs).
- **Pauses Inbox Watch** (its checks, digests and look-aheads), unless you turned that off in the settings below.
- **Keeps the follow-up queue still.** Queued messages stay in their queue and show **Queue paused**.
- **Lets a coordination wake add its message** to the waiting conversation's queue without starting it.
- **Does not stop your own messages.** A banner says so. Your own messages are the ones you send, a side chat, **Run next instruction**, and a message Pocket held for background jobs still on the earlier Claude login after you switched accounts (it starts when those jobs end). You can change this to **Blocked until you resume** in the settings below; then all of these wait.

Pausing again while paused changes nothing. Pause all can't be hidden or turned off: it is the emergency stop.

### Where the control is

- **More** (the **⋯** button), at the top of the conversation list on a phone and in the rail beside **Filters**, **Settings** and **New** on a computer. The first row is **Pause all**. The next is **Automation settings**.
- **Switch conversation** (Ctrl/⌘ K), the first row.
- **Settings → Automation**, the first row.
- By voice: "pause everything" opens the same confirmation. So do "pause it all", "pause all", "pause all replies", "pause all work", "pause all agents", "pause all conversations" (each of the last four also with "the", as in "pause all the work"), "pause pocket" and "stop everything". The microphone stays off afterwards: you answer by tapping the sheet. See [Voice](voice.md).

While Pocket is paused every one of these reads **Resume**.

### Confirm what will stop

**Pause all** opens a sheet that says what the pause will stop and what it will hold, for example *This stops 3 replies running (2 Claude, 1 Codex), 2 background jobs, Inbox Watch. It holds 1 usage-limit retry, 3 check-backs.* Retries and check-backs are held, not stopped: they wait for Resume. When only held things are waiting it reads *This holds 1 check-back.* The toast after you pause says it the same way: *Paused. Stopped 3 replies running (2 Claude, 1 Codex), 2 background jobs. Held 1 usage-limit retry, 3 check-backs.* The sheet also says whether your own messages still run. **Pause all** confirms and **Keep running** closes the sheet. When nothing is running or waiting it says so and still offers the pause, which then holds anything automatic that comes up.

If you turn off **Show what will stop before pausing**, one tap pauses.

### The banner

While Pocket is paused a banner runs across the top of every screen: *Pocket is paused. Your own messages still run.* When held retries or held check-backs are waiting it adds how many, for example *1 usage-limit retry and 3 check-backs are held.* Held check-backs are counted there only while check-backs are on. **Resume** is in the banner. Another device you are signed in on shows the banner within a few seconds.

When your own messages are **Blocked**, the banner reads *Your own messages wait until you resume.* A message you send is refused with *Not sent: Pocket is paused, and your own messages wait until you resume. Your message is kept here.* The draft stays in the message box, and **Resume** is in the banner. A side chat message is refused the same way. You can still add a message to a conversation's queue, because that starts nothing.

### Resume

**Resume** lifts the pause.

- **Held usage-limit retries** are armed again, at least 5 seconds out. None is dropped. If **On Resume, re-arm held usage-limit retries** is off, they stay held (also across a restart) until your next message in that conversation.
- **Held check-backs** go back to waiting. One whose time came while Pocket was paused is overdue. With **On Resume, run overdue check-backs** on, it runs at once if it is within the catch-up window (12 hours by default); one later than that is marked missed. With the setting off, every overdue check-back is marked missed, with no push. A check-back whose time has not come keeps waiting either way. The toast after **Resume** says how many overdue check-backs run now and how many were marked missed, for example *Resumed. 1 held retry runs again. 2 overdue check-backs run now. 1 check-back was marked missed.* The count that runs is the number let go: one that turns out to be past the catch-up window is still marked missed.
- **Inbox Watch** resumes only if Pause all paused it and you have not changed it since. If you changed it while paused, Resume leaves it as you set it, and when that is still paused it says so: *Inbox Watch was changed while paused and is still paused.* If you paused Inbox Watch yourself, Resume leaves it paused.
- **Background jobs** Pause all stopped don't start again.
- **Queued messages** stay paused until you start them with **Run next instruction**, as after **Stop**.
- **A message held for background jobs** on the earlier Claude login, kept while your own messages were **Blocked**, starts if its jobs have ended.
- **Replies that were stopped** don't start again. Send a message to carry on.

### A restart keeps the pause

The pause is saved. After Pocket restarts it is still paused, and a retry that was waiting is still held.

### Pause all settings

**Settings → Automation → Pause all**. All apply to the whole install.

| Setting | Default | Choices |
|---|---|---|
| **Your own messages while paused** | **Run, with a banner** | **Run, with a banner** or **Blocked until you resume** |
| **Pause all also pauses Inbox Watch** | On | On or Off |
| **Pause all also stops background jobs** | On | On, or Off (jobs whose reply has ended keep running until one of them starts a reply; Pocket stops that reply, which ends the conversation's process and any other jobs in it) |
| **On Resume, re-arm held usage-limit retries** | On | On, or Off (they stay held until your next message) |
| **On Resume, run overdue check-backs** | On | On (a check-back that fell due while paused runs if it is within the catch-up window), or Off (it is marked missed) |
| **Show what will stop before pausing** | On | On, or Off (pause on one tap) |

**Reset to defaults** in the group puts these back.

**Stop all Claude replies** in **Settings → Agents & instance → Accounts & instance** stays. It stops Claude replies only, and is meant for switching Claude accounts.

## Who started a reply

A conversation says so when its newest reply was started by something other than you. The words are the same everywhere:

| Label | Started by |
|---|---|
| **Queued message** | A queued message, when the reply before it ended |
| **Continued after a usage limit** | An automatic continue after a usage-limit reset |
| **Woken by a hold** | A conversation woken when [Coordination](coordination.md) freed what it was waiting for |
| **Started by a check-back** | A reply that started because a [check-back](#check-backs) came due |

The label shows under the agent on the conversation's row, and under the conversation's header. A reply you start, including one you start with **Run next instruction**, has no label, and your next message clears it. When a labelled reply finishes, its push leads with the label: *Queued message · …*. A check-back's result has its own push, *Checked back · …* (see [Check-backs](#check-backs)).

## Limits on unattended work

**Settings → Automation → Limits on unattended work** sets how much work Pocket will start for you without you there. A limit never cuts off a reply that is running. Only the longest-reply limit stops one, and only a check-back's reply.

### What a limit applies to

Pocket judges a reply by who asked for the work in the first place. Work that came from a check-back (or, in a later release, a job key) is always held by the limits. Work **you** asked for yourself (a queued message, a usage-limit retry, a coordination wake) is held only when you switch it on:

- **Count queue drains, retries and coordination wakes toward the daily limit**
- **Plan ceilings also hold queued messages, retries and coordination wakes**

Antigravity needs no limit here: nothing starts one of its replies but a message you send
([Antigravity](sessions.md#antigravity-google-models-on-your-google-plan)).

Both are off by default. So with nothing switched on, the limits hold only check-backs. The first also decides whether that work counts toward **OpenRouter spend per day**.

### The settings

| Setting | Default | Range |
|---|---|---|
| **Plan ceiling, weekly (Claude Code)** and **(Codex)** | 80% | 10 to 100%, or No limit |
| **Plan ceiling, 5-hour (Claude Code)** and **(Codex)** | 90% | 10 to 100%, or No limit |
| **Unattended replies per day** | 40 | 1 to 1,000, or No limit |
| **Count queue drains, retries and coordination wakes toward the daily limit** | Off | On or Off |
| **Plan ceilings also hold queued messages, retries and coordination wakes** | Off | On or Off |
| **OpenRouter spend per day (unattended)** | $5 | $0.50 to $500, or No limit |
| **Longest unattended reply** | 60 min | 5 to 480 min, or No limit |
| **Count time waiting on an approval or question toward the longest reply** | Off | On or Off |
| **Notice when a limit is reached** | **Push and Settings, once per reason per day** | That, or **Settings only** |
| **Treat a plan reading older than this as stale** (under **Advanced**) | 6 h | 1 to 24 h |

- **Plan ceilings** hold work on an engine whose weekly or 5-hour window is at or over the ceiling. Held work goes ahead after the reset: a retry is tried again then, or at the next minute, whichever is later, and the conversation shows that time.
- **The daily count** is in your time zone. **OpenRouter spend** is real money; unattended OpenRouter replies stop starting at the limit. With **Count queue drains, retries and coordination wakes toward the daily limit** off, the work you asked for yourself neither counts toward nor is held by the spend limit.
- **The longest-reply limit** stops a running reply, and applies only to check-back replies (and, later, job replies). A stopped check-back reply shows *Checked back … · stopped* on its card, with no *Checked back* push. The ordinary notice that the reply was stopped goes out instead. Time spent waiting on an approval or question doesn't count unless you switch that on.
- A value you enter outside its range is refused with a message that names the range, and the old value stays. A change applies to the next start, never to a reply already running.
- **Reset to defaults** in the group puts every value back. Your saved values are kept when a feature is off.

### No limit

Every limit except the stale-reading age has a **No limit** button beside it. A limit set to No limit shows a warning at the top of the page, for example *Unattended replies per day has no limit.*, for as long as it stays off.

### Stale readings

Pocket learns a Claude plan's usage only when a Claude reply runs, so the reading can be old. A reading older than the stale setting (6 hours) doesn't hold work back: the reply that runs refreshes it. If that reply then shows the window over its ceiling, it finishes and nothing further starts. For Codex, Pocket asks for the live figure.

### One notice per reason per day

When a limit holds work, Pocket tells you once per reason per day, not once per held start: in **Limits reached today** in this page, and by push unless you chose **Settings only**. The push is titled **Unattended work held** and goes with your **Check-backs and job results** switch ([Notifications](settings.md#notifications--voice)). Before 1.119 it went with **Inbox alerts**. Pause is never a notice, because you did it.

### The usage table

**Unattended replies** at the bottom of the page shows **Today** (replies, cost and tokens) and a **Last 7 days** table of **Day**, **Replies**, **Tokens** and **Cost**, newest day first. It counts every finished reply Pocket started without you. Claude reports a cost per reply, which on a plan is what the same tokens would cost, not a charge. Codex reports tokens.

## Check-backs

A check-back is one more reply, later, in the conversation that set it. You say "check the page in 15 minutes and tell me", the agent sets a check-back, and at that time Pocket starts the conversation's next reply by itself. The agent does the check, replies, and Pocket sends you a push with the result. It is for a conversation looking again at a page, a deploy or a job's result. When *you* have to do something later, a [task](tasks.md) is still the right thing.

### Turn it on

Check-backs are **off** until you turn them on. Open **Settings → Automation → Check-backs** and turn on **Check-backs**. Until then no agent is told it can check back, no check-back is set or run, and none of the screens below shows. The one exception is the push switch **Check-backs and job results**: it is always in **Settings → Notifications & voice**, because it also carries the limit notice ([One notice per reason per day](#one-notice-per-reason-per-day)).

While the switch is on, Pocket tells each Claude Code and Codex conversation it starts that it can check back, and installs the `pocket-checkback` skill for them. The agents already running pick this up at their next message. Turning check-backs off removes both. Check-backs that are still waiting are kept, not run.

### What you see

- **A card in the conversation**, under the reply that set it. One quiet line, which changes in place as the check-back moves on:

| The card says | When |
|---|---|
| *Will check back at 2:30 PM* with **Cancel** | It is waiting. Another day reads *Will check back Nov 22, 9:00 AM*. |
| *Will check back at 2:30 PM · held while Pocket is paused* | [Pause all](#pause-all) is on. **Cancel** stays. |
| *Will check back at 2:30 PM · waiting for the conversation to finish* | The conversation has a reply running. |
| *Will check back at 2:30 PM · waiting for a usage limit to reset* | The conversation's last reply hit a usage limit and waits to pick up again. |
| *Will check back at 2:30 PM · held by a plan ceiling* or *· held by the daily limit* | A [limit](#limits-on-unattended-work) holds it until the reset. |
| *Checking back now* | Its reply is running. |
| *Checked back 2:30 PM* | The reply finished. |
| *Checked back 2:30 PM · the reply didn't finish*, *· stopped*, *· hit a usage limit* or *· cut off by a restart* | The reply failed, was stopped, hit a usage limit, or was cut off when Pocket restarted. |
| *Missed: …*, with the reason | It never ran. See [Missed](#when-pocket-cant-run-it-on-time). |
| *Cancelled* | You or the agent cancelled it. |

Times are in your device's time zone; hover for the full date and time and the note (what the agent will check), which a screen reader also reads with the card. The card updates without a reload. **Cancel** says *Check-back cancelled.* and the card turns to *Cancelled*.

- **A small clock on the conversation's row** in the conversation list while a check-back is waiting or running, at the end of the row's state line. Hover it, or use a screen reader, for its label: *Check-back at 2:30 PM*, *2 check-backs, next at 2:30 PM*, *2 check-backs, one running now, next at 2:30 PM*, or *Checking back now*.
- **A Check-backs group in [Tasks](tasks.md#check-backs-in-the-list)** (when Tasks is on and **Show check-backs in the Tasks list** is on), between your to-dos and **Done**. Each row shows the note, and under it the time, the conversation and, when something holds it or it is running, what (*Held while Pocket is paused*, *Checking back now*). Tap the row to open the conversation. **Cancel** is on the row unless it is running. You can't edit or complete one there.
- **A push** when the reply finishes: *Checked back · <conversation>*, with the first line of the reply. If the reply failed it says *Something went wrong. Tap to see what happened*. It goes to every device with **Check-backs and job results** on ([Notifications](settings.md#notifications--voice); the switch is there whether check-backs are on or off), and it opens the conversation. A push goes even while a browser has the conversation open, because you asked to be told. When the conversation is muted it goes unless you turned off **Push the result when the conversation is muted**. A check-back that is stopped, or hits a usage limit, sends no *Checked back* push (the usage-limit notice goes as for any reply).
- **A line in Settings** under the Check-backs group: *N waiting* and **Cancel all**, shown only while check-backs are on and some are waiting. **Cancel all** asks first: *Cancel 3 check-backs?*, *They won't run. One that is running now finishes.*, with **Cancel all** and **Keep it as it is**. **Cancel all** cancels every waiting and held check-back and says *Cancelled 3 check-backs.* (*Nothing was waiting.* when none was left). One that is running is left alone. Either answer goes back to **Settings → Automation**.

### How an agent sets one

You ask in the conversation: "check back in 15 minutes", "look again after the deploy", "let me know when it is live". Or the agent offers one as a suggested reply ("Check back in 15 minutes") and you tap it. The agent then runs `pocket-checkback add --at … --note …`, tells you when it will check back, and ends its reply. See [For agents](for-agents.md#check-back-later) for the command.

**Who may set one is Pocket's rule, not only the agent's instructions.** The reply that sets it must be:

- **a reply you started**: a message you sent, or **Run next instruction**; or
- **a check-back's own reply**, while the chain is under the **Chain limit** (5 by default). It may set **one** follow-up: a second is refused with *This check-back reply already set its one follow-up (at 2:45 PM). Cancel it first to change the time.* The first check-back is 1 of 6, and each follow-up counts one more, so a chain is at most 6 replies. The message the agent gets says whether it may set another. A reply you started has no such limit, only the pending limits below.

A reply that started any other way is refused: from the queue, a usage-limit retry, a coordination wake, or the agent itself after a background job. So is a command run outside a Pocket conversation (a terminal, code-server), and a side chat. The reason is that something you did not write can reach an agent: an emailed alert, a web page it read, a file. Only a reply you started may carry your request, so none of those can set one from that reply. The rule is judged when the command runs, by the reply running at that moment: a command a refused reply left running in the background is refused then, but accepted if it tries again while a later reply you started is running ([Security](../../SECURITY.md#check-backs-1119)). The agent is told to offer a reply button instead, and your tap starts a reply that may set it.

**Time.** `+15m`, `+2h` or `+1d` (also `+15 min`, `+2 hours`), or a date and time such as `2026-11-22 09:00` in your time zone, or a time with an offset. Day names ("Friday 9am") are not read: the agent turns them into a date. A check-back can be set from **Soonest** (1 minute) to **Furthest ahead** (90 days) away; outside that range it is refused with a message naming the range.

**The note.** `--note` is all the later reply is told, so the agent writes what to check and what done looks like. It can be up to **Note length** (1,000 characters). The note is kept in `checkbacks.json` and shown in Tasks; it is never written to the audit file.

**Engines.**

| Engine | Check-backs |
|---|---|
| Claude Code | Every permission mode. |
| Codex | **Full access** only. Under **Review actions** Codex's sandbox can't reach Pocket, so `pocket-checkback` fails and the agent offers a task instead. |
| OpenRouter | Not supported. The command is refused, and the agent offers a task. |

**Limits.** **Pending check-backs per conversation** (10), **Pending check-backs on this install** (50) and the **Chain limit** (5). Past a limit the command is refused with the count, and the agent tells you.

### What the check-back run can do

The reply runs with the **permissions of the reply that set it**: the same permission mode (Review actions or Full access), model, effort and plan or work mode, taken when it was set. Two things lower that to Review actions: the setting **Permissions for a check-back** set to **Always Review actions**, and a server where Full access is turned off. A check-back is never given more than the reply that set it had.

It asks for approval as any reply does. Nobody may be looking, and it waits for you, with the usual push ([Questions and approvals](approvals.md#replies-you-did-not-start)). Time spent waiting on you doesn't count toward **Longest unattended reply** unless you switch that on.

### When it runs

A pass every minute starts each check-back that is due, oldest first. For each, Pocket checks in this order:

1. **Is Pocket paused?** Then it is held until **Resume** (above).
2. **Is a reply running in the conversation, or is it waiting for a usage limit to reset?** Then it waits and tries again each minute, so it never cancels the reply's pick-up after the reset. Time spent waiting doesn't count as late. After **Wait for a busy conversation before marking missed** (60 minutes) it is marked missed.
3. **Is it too late?** A check-back that is later than **Catch-up window after Pocket was down** (12 hours) is marked missed. With the window at 0 none runs late (Pocket still allows about two minutes for its own timing).
4. **Do the limits allow it?** A plan ceiling or the daily count holds it until the reset, with one notice per reason per day ([above](#one-notice-per-reason-per-day)). Pocket doesn't look at it again before then, unless you resume or save a setting in **Settings → Automation**. Check-back replies always count toward **Unattended replies per day**.
5. **Start it.** The check-back is marked running and saved *before* anything starts, so a crash never runs it twice. Several overdue ones start **Spacing between overdue check-backs** (15 seconds) apart.

The reply begins with a message like this:

```text
[Pocket check-back · set at 2:14 PM at your request · 1 of 6]
What to check: <the note>
It is now 2:30 PM. Do the check and reply briefly with the result. If it isn't settled yet you may set one more check-back; say when.
```

A check-back set by an earlier check-back says *by an earlier check-back*. One that runs late adds *This check-back was due at … and runs 40 minutes late.* The last one in a chain says *This is the last check-back this chain may set. If it isn't settled, say what is still open so the owner can decide.*

The agent's first line is what the push shows, so it leads with the result. If the check isn't settled, it may set one more (only one), and tells you.

### When Pocket can't run it on time

- **Pocket was down.** A check-back that fell due while Pocket was stopped runs once, late, when Pocket is back, if it is within the catch-up window, and its message says how late. Later than that it is marked missed: *Missed: Pocket was down until 4:10 PM*.
- **The conversation stayed busy.** After the wait: *Missed: the conversation was busy*, or *Missed: the conversation was waiting for a usage reset* when its reply was waiting to pick up after a usage limit.
- **Paused.** With **On Resume, run overdue check-backs** off: *Missed: Pocket was paused when it fell due*, with no push.
- **Held by a limit past the window.** *Missed: it was 3 h late (a plan ceiling held it), past the catch-up window*. On **Resume**, one held by the pause past the window is marked missed the same way (*it was … late (Pocket was paused), past the catch-up window*), with the usual push, and the Resume toast counts it as missed.
- **Restarted while starting.** *Missed: Pocket restarted while it was starting*. A check-back whose reply had already begun when Pocket restarted shows *Checked back … · cut off by a restart*, with no push.
- **The conversation is gone** or **it couldn't start**: *Missed: the conversation is gone* or *Missed: it couldn't start: …*.
- **Its result couldn't be saved.** If Pocket can't write `checkbacks.json` when the reply ends (a full disk, say), the reply still ends normally and you get the ordinary push for a finished reply in place of *Checked back*. The card keeps *Checking back now* until a pass can save it, then shows the reply's result. A check-back left running with no reply for it is settled the same way, as *Checked back … · the reply didn't finish*, or *Missed: Pocket lost track of its reply* if its reply never began.

Pocket sends one push for everything a pass marks missed: *Check-back missed · <conversation>*, or *3 check-backs missed* with a line for each. It follows **Check-backs and job results**, and the muted-conversation setting. A missed check-back is never run later.

### Settings

**Settings → Automation → Check-backs**. All apply to the whole install. **Reset to defaults** in the group puts these back. **Check-backs** is Off by default, so when it was on the reset turns it off and says so: *Back to the defaults. Check-backs are off.* The waiting ones are kept and don't run until you turn it on again. With **Check-backs** off, the rest of the group is dimmed, under the note *These apply when Check-backs is on.* It keeps its values and can still be changed. A value outside its range is refused with a message that names the range, and the old value stays. Check-backs have no **No limit** buttons.

| Setting | Default | Range |
|---|---|---|
| **Check-backs** | Off | On or Off. Off: none is set or run; waiting ones are kept |
| **Permissions for a check-back** | **Same as the reply that set it** | That, or **Always Review actions**. Where Full access is turned off for the server, a check-back runs under Review actions whatever this says |
| **Check-backs in Claude Code conversations** | On | On or Off |
| **Check-backs in Codex conversations** | On | On or Off. Codex can set one only under Full access |
| **Push the result when the conversation is muted** | On | On or Off |
| **Show check-backs in the Tasks list** | On | On or Off |
| **Pending check-backs per conversation** | 10 | 1 to 50 |
| **Pending check-backs on this install** | 50 | 1 to 500 |
| **Chain limit (check-backs set by check-backs)** | 5 | 0 to 20. 0: a check-back can't set another |
| **Furthest ahead** | 2,160 h (90 days) | 1 to 8,760 h (365 days) |
| **Soonest** | 1 min | 1 to 60 min |
| **Note length** | 1,000 characters | 200 to 4,000 characters |
| **Catch-up window after Pocket was down** | 12 h | 0 to 72 h. A check-back this late or less runs once, late, and says how late; one later than this is marked missed. 0: never run late |
| **Wait for a busy conversation before marking missed** (under **Advanced**) | 60 min | 5 to 480 min |
| **Spacing between overdue check-backs** (under **Advanced**) | 15 s | 0 to 300 s |

A change applies to the next check-back, never to one already waiting or running, except the switches: turning **Check-backs** or an engine off stops waiting check-backs from running, and turning it on again lets Pocket decide each by the catch-up window. Turning a switch on or off also closes idle agent processes, so the next message carries the change (an agent already in the middle of a reply keeps what it was told until its next message). On **On Resume, run overdue check-backs** see [Resume](#resume).

### What is kept

Waiting and running check-backs are kept until they finish. A finished one stays for 30 days, up to 300, so its card shows in the conversation. A check-back is stored in `checkbacks.json` in `POCKET_DATA_DIR`.

## The audit file

`automation-audit.jsonl` in `POCKET_DATA_DIR` records, one line each, every pause (what it stopped and held) and resume (what it re-armed, and whether Inbox Watch resumed), every change to these settings, every limit notice and every finished unattended reply (its origin, engine, model, duration, cost or tokens and how it ended). It never holds message text. It is yours to read or rotate; Pocket only appends to it.

Check-backs add lines with `"action":"checkback"` and an `event`:

| Event | Extra fields | When |
|---|---|---|
| `set` | `dueAt`, and `held` when set while paused | An agent set one |
| `cancelled` | `by` (`owner` or `agent`) | It was cancelled |
| `held` | `reason` (`paused`, `busy`, `usage_reset`, `plan_ceiling` or `daily_limit`) | Something held it. Once per reason per check-back |
| `started` | `approvalMode`, `lateMs` | Its reply began |
| `finished` | `outcome` (`ok`, `failed`, `stopped`, `limit` or `interrupted`) | Its reply ended |
| `missed` | `reason` (`restarted`, `late`, `busy`, `paused`, `gone` or `failed`) | It was marked missed |

Each also carries `id` (like `cb-1a2b3c4d`), `sessionId`, `engine` and `chainDepth`. Never the note or the reply. The reply itself has its usual `reply` line, with `origin` and `rootOrigin` set to `checkback` and `originRef` set to the check-back's id. The `pause` and `resume` lines count check-backs held, run and missed.

## Presets for an install

An install can preset the defaults in `.env`, for example one that starts more cautious. A value saved in **Settings → Automation** always wins over the preset, and the page notes **Preset on this server.** under a value that comes from one.

```text
POCKET_AUTOMATION_WEEKLY_CEILING=60
POCKET_AUTOMATION_DAILY_REPLIES=off
```

Restart Pocket after changing `.env`. A bad value is ignored and named in the page's warnings.

| Variable (after `POCKET_AUTOMATION_`) | Sets |
|---|---|
| `OWN_MESSAGES` | `run` or `blocked` |
| `INBOX_WATCH`, `BACKGROUND_JOBS`, `REARM_RETRIES`, `RUN_OVERDUE`, `CONFIRM`, `COUNT_OWNER_WORK`, `CEILINGS_HOLD_OWNER_WORK`, `COUNT_WAITING`, `CHECKBACKS`, `CHECKBACK_CLAUDE`, `CHECKBACK_CODEX`, `PUSH_WHEN_MUTED`, `SHOW_IN_TASKS` | On or off (`1`/`0`, `yes`/`no`, `on`/`off`, `true`/`false`) |
| `CLAUDE_WEEKLY`, `CLAUDE_FIVE_HOUR`, `CODEX_WEEKLY`, `CODEX_FIVE_HOUR` | A percentage, or `off`. `CLAUDE_WEEKLY_CEILING` also works |
| `WEEKLY_CEILING`, `FIVE_HOUR_CEILING` | Both engines at once; an engine's own name wins |
| `DAILY_REPLIES`, `OPENROUTER_DAILY` (dollars), `LONGEST_REPLY` (minutes) | A number, or `off` |
| `STALE_HOURS` | A number of hours, 1 to 24 |
| `NOTICE` | `push` or `settings` |
| `CHECKBACK_ACCESS` | `same` or `review` |
| `PER_CONVERSATION`, `PER_INSTALL`, `CHAIN_LIMIT`, `FURTHEST_HOURS`, `SOONEST_MIN`, `NOTE_MAX`, `CATCH_UP_HOURS`, `BUSY_WAIT_MIN`, `SPACING_SEC` | A whole number in the range of the check-back setting of that name (hours, minutes, seconds or characters as the table says). No `off` |
| `POCKET_CHECKBACK_TICK_MS` (no `AUTOMATION_` in the name) | How often Pocket looks for check-backs that are due, in milliseconds. Default 60000, minimum 100. Not a setting |
| `TICK_MS` | How often Pocket checks the longest-reply limit, in milliseconds. Default 60000. Not a setting |

## Coming next

One more feature that starts work for you is planned for a later release, off until you turn it on: **job keys** (a script on this server starts a conversation with an instruction you wrote). Pause all and these limits already cover it. It is not in 1.119.

## For agents

- **Pocket can be paused.** If a message you were waiting on, a retry or a queued follow-up doesn't run, the owner may have paused Pocket. Don't try to get round it. The banner and **Settings → Automation** say.
- **Background work stops too.** Pause all stops your background jobs on Claude, and a reply you start by yourself while paused (when a background job or terminal finishes) is stopped as it begins. Say what was left unfinished when the owner next writes.
- **A queued follow-up or a wake may wait.** When Pocket is paused, or a limit holds work, it starts later or when the owner resumes it. Don't re-send it.
- **Check-backs only when asked.** Set one only when the owner asked for it in this conversation or accepted your offer, from a reply the owner started. Pocket refuses it from any other reply. See [Check-backs](#check-backs) and [For agents](for-agents.md#check-back-later). When a check-back starts your reply, do the check and lead your reply with the result: its first line is the push.
- **You can't pause, resume or change these settings.** They need the owner's own sign-in; the command token is refused, so no agent can raise its own limits or lift a pause. Tell the user the path: **Settings → Automation**.
- **The owner's messages still reach you while paused**, unless they chose **Blocked**. Then their send is refused with *Pocket is paused. Resume to send.* and waits in their message box.

See [For agents](for-agents.md).

## Reference

- **Data.** The pause and the saved settings are in `pocket-settings.json` (`paused` and `automation`). The day's counts and notices are in `automation-state.json`; the audit is `automation-audit.jsonl`. A `.retry.json` marker for a held retry gains `held: true`. Check-backs are in `checkbacks.json` (written atomically, mode `0600`; created when the first one is set). Older versions ignore the new keys and the file.
- **Routes.** `GET` and `POST /api/pause`, `POST /api/resume`, `GET /api/automation` and `POST /api/automation/settings` take the owner's sign-in only. See [SECURITY.md](../../SECURITY.md). For check-backs, `GET /api/checkbacks`, `POST /api/checkbacks/cancel` and `POST /api/checkbacks/cancel-all` are the owner's, with the sign-in only; `POST /api/checkbacks/agent/add`, `GET /api/checkbacks/agent` and `POST /api/checkbacks/agent/cancel` take the command token with the conversation's runner token, and refuse the owner's sign-in. All of them answer 404 *Check-backs are switched off on this Pocket.* while the feature is off. While it is on, a row in `GET /api/sessions` with waiting or running check-backs carries `checkback: { pending, running, nextAt }`: `pending` counts the waiting and held ones, `running` is `true` or `false` (a conversation runs one reply at a time), and `nextAt` is the earliest time among the waiting and held ones.
- **Upgrade.** Nothing to migrate. Check-backs stay off until you turn them on.
- **Rolling back to 1.118 (or 1.117).** Check-backs stop: 1.118 ignores `checkbacks.json`, the **Check-backs** settings and **On Resume, run overdue check-backs**, and keeps them in their files, so upgrading again finds them. Nothing runs and nothing is lost: a check-back still waiting is judged by the catch-up window when 1.119 is back. Remove the `pocket-checkback` skill folders 1.119 installed (`~/.claude/skills/pocket-checkback`, and the Codex one), because 1.118 does not remove them and their command is gone. A conversation process started under 1.119 keeps its check-back instruction until it restarts, but the command it names is gone. The device choice **Check-backs and job results** is ignored, and the limit notice goes back to **Inbox alerts**.
- **Rolling back to 1.116.** The extra keys are ignored, so the install runs as if unpaused, and a held retry is armed again at start (held retries run). 1.116 keeps the saved pause in `pocket-settings.json` without reading it, so upgrading to 1.117 again comes back paused: resume before rolling back, or press **Resume** after upgrading again. If Pause all had paused Inbox Watch, it stays paused under 1.116 until you resume it in [Inbox Watch](inbox-watch.md#change-the-schedule-rules-and-models).

## Troubleshooting

**It said Missed.** The card gives the reason. *Pocket was down until …*: Pocket was stopped when it was due and the catch-up window had passed when it came back, so it didn't run. Raise **Catch-up window after Pocket was down** (up to 72 hours) to let later ones run late. *The conversation was busy*: a reply ran for longer than **Wait for a busy conversation before marking missed**. *Pocket was paused when it fell due*: **On Resume, run overdue check-backs** is off. *It was … late (a plan ceiling held it) …*: a limit held it past the window. A missed check-back never runs later; ask the agent to set another.

**The agent says it cannot set one.** The refusal names the reason. Check-backs are off, or off for that engine (**Settings → Automation → Check-backs**). The reply that is asking was not started by you, for example a queued message or a reply the agent began after a background job; send the request as a message. The chain limit is reached. Codex is under **Review actions**: choose Full access for that conversation. The conversation is in OpenRouter, which is not supported. A limit is reached (10 waiting in the conversation, 50 on the install), or the time is less than a minute or more than 90 days away. The command is run from a terminal and not from a Pocket conversation.

**A check-back didn't run at its time.** Look at the card. Held: Pocket is paused (the banner says), the conversation has a reply running or is waiting for a usage limit to reset, or a plan ceiling or the daily limit is reached (**Limits reached today** in this page). Check-backs run when the next minute's pass finds them due, so one can start up to a minute late with no note.

**No push arrived.** The reply may not have finished: a stopped one, or one that hit a usage limit, sends no *Checked back* push. Check that the device has **Push to this device** and **Check-backs and job results** on in **Settings → Notifications & voice**. If the conversation is muted, check **Push the result when the conversation is muted**. A check-back that was missed sends its own push, under the same switches.

**I turned check-backs off. What happens to the waiting ones?** They are kept and don't run, and nothing shows them: no card, clock, Tasks group or *N waiting*. Turn the switch back on and each runs or is marked missed by the catch-up window. Turning it on looks for due ones at once, so one whose time has passed runs (or is marked missed) straight away; **Cancel all** then drops the ones still waiting.

**A queued message didn't start.** Check for the banner. While paused the queue doesn't drain. After **Resume** it stays paused until you start it with **Run next instruction**. A plan ceiling can also hold it if you switched on **Plan ceilings also hold queued messages, retries and coordination wakes**.

**A conversation says *Retry held* after you resumed.** Pause all held a usage-limit retry, and **On Resume, re-arm held usage-limit retries** is off. Send a message to carry on.

**A limit is blocking work I want to run.** Raise it, or choose **No limit**, in **Settings → Automation**, or start the work yourself: your own messages and **Run next instruction** are not held.

**The page says *This server does not offer automation settings yet.*** The server is on an older version.

**A build or watcher stopped when I paused.** Pause all stops background jobs. Turn off **Pause all also stops background jobs** to leave them running until one of them starts a reply. Pocket still stops that reply while paused, which ends the conversation's process and any other jobs in it. A job whose reply was still running ends with the reply either way.

**My own message was refused.** **Your own messages while paused** is **Blocked until you resume**. Tap **Resume**, then send again, or change the setting.
