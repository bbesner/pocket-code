<!-- manual
checked: 1.118.0
sources: automation.mjs, public/automation.js, server.mjs, queue.mjs, codex.mjs, acp.mjs, sidechat.mjs, coordination.mjs, usage.mjs, inbox-runner.mjs, public/voice-text.js
-->
# Automation: Pause all and limits on unattended work

Some replies start without you: a queued message that runs when the last reply ends, a usage-limit retry, a conversation woken by a hold. **Pause all** is one switch that stops every reply and holds everything automatic. **Limits on unattended work** keep that work from using up your plan. Both are in **Settings → Automation**.

Pause all is always available. Nothing else changes until you set it: with the defaults, 1.117 behaves as 1.116 plus Pause all.

## Pause all

### What it does

- **Stops** every running reply, on Claude Code, Codex and OpenRouter, side chats included. It stops them the way **Stop** does ([Stop a reply](conversation.md#stop-a-reply)): work already done stays done.
- **Stops background jobs** in Claude conversations that show **Working in background** (a build or a watcher the agent left running), the way **Stop background jobs** does. The reply the agent would start when a job finishes never comes. If you turn off **Pause all also stops background jobs**, the jobs keep running until one of them starts a reply. Pocket stops that reply, which ends that conversation's process and any other jobs in it. A job started by a reply that is still running ends with that reply, as with **Stop**, whichever way the switch is set; the count includes it.
- **Stops a reply the agent starts by itself** while paused (Claude after a background job, Codex after a background terminal) as soon as it begins, with no notification. Pocket doesn't stop Codex's background terminals themselves; it doesn't track them.
- **Holds** every pending usage-limit retry. The retry is kept, not cancelled. A reply that hits a usage limit while paused has its retry held at once, and its notification says *The retry is held until you resume* (or *send a message to carry on* when **On Resume, re-arm held usage-limit retries** is off).
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

**Pause all** opens a sheet that lists what the pause will stop, for example *This stops 3 replies running (2 Claude, 1 Codex), 2 background jobs, 1 usage-limit retry, Inbox Watch.* It also says whether your own messages still run. **Pause all** confirms and **Keep running** closes the sheet. When nothing is running or waiting it says so and still offers the pause, which then holds anything automatic that comes up.

If you turn off **Show what will stop before pausing**, one tap pauses.

### The banner

While Pocket is paused a banner runs across the top of every screen: *Pocket is paused. Your own messages still run.* When held retries are waiting it adds how many. **Resume** is in the banner. Another device you are signed in on shows the banner within a few seconds.

When your own messages are **Blocked**, the banner reads *Your own messages wait until you resume.* A message you send is refused with *Not sent: Pocket is paused, and your own messages wait until you resume. Your message is kept here.* The draft stays in the message box, and **Resume** is in the banner. A side chat message is refused the same way. You can still add a message to a conversation's queue, because that starts nothing.

### Resume

**Resume** lifts the pause.

- **Held usage-limit retries** are armed again, at least 5 seconds out. None is dropped. If **On Resume, re-arm held usage-limit retries** is off, they stay held (also across a restart) until your next message in that conversation.
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

The label shows under the agent on the conversation's row, and under the conversation's header. A reply you start, including one you start with **Run next instruction**, has no label, and your next message clears it. When a labelled reply finishes, its push leads with the label: *Queued message · …*.

## Limits on unattended work

**Settings → Automation → Limits on unattended work** sets how much work Pocket will start for you without you there. A limit never cuts off a reply that is running. Only the longest-reply limit stops one, and only for work that arrives in later releases.

### What a limit applies to

Pocket judges a reply by who asked for the work in the first place. Work that came from a check-back or a job key is always held by the limits (those arrive in later releases). Work **you** asked for yourself (a queued message, a usage-limit retry, a coordination wake) is held only when you switch it on:

- **Count queue drains, retries and coordination wakes toward the daily limit**
- **Plan ceilings also hold queued messages, retries and coordination wakes**

Both are off by default. So today, with nothing switched on, the limits hold nothing. The settings are saved and ready. The first also decides whether that work counts toward **OpenRouter spend per day**.

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
- **The longest-reply limit** stops a running reply, and applies only to check-back and job replies. Time spent waiting on an approval or question doesn't count unless you switch that on.
- A value you enter outside its range is refused with a message that names the range, and the old value stays. A change applies to the next start, never to a reply already running.
- **Reset to defaults** in the group puts every value back. Your saved values are kept when a feature is off.

### No limit

Every limit except the stale-reading age has a **No limit** button beside it. A limit set to No limit shows a warning at the top of the page, for example *Unattended replies per day has no limit.*, for as long as it stays off.

### Stale readings

Pocket learns a Claude plan's usage only when a Claude reply runs, so the reading can be old. A reading older than the stale setting (6 hours) doesn't hold work back: the reply that runs refreshes it. If that reply then shows the window over its ceiling, it finishes and nothing further starts. For Codex, Pocket asks for the live figure.

### One notice per reason per day

When a limit holds work, Pocket tells you once per reason per day, not once per held start: in **Limits reached today** in this page, and by push unless you chose **Settings only**. The push is titled **Unattended work held** and goes with your **Inbox alerts** ([Notifications](settings.md#notifications--voice)). Pause is never a notice, because you did it.

### The usage table

**Unattended replies** at the bottom of the page shows **Today** (replies, cost and tokens) and a **Last 7 days** table of **Day**, **Replies**, **Tokens** and **Cost**, newest day first. It counts every finished reply Pocket started without you. Claude reports a cost per reply, which on a plan is what the same tokens would cost, not a charge. Codex reports tokens.

## The audit file

`automation-audit.jsonl` in `POCKET_DATA_DIR` records, one line each, every pause (what it stopped and held) and resume (what it re-armed, and whether Inbox Watch resumed), every change to these settings, every limit notice and every finished unattended reply (its origin, engine, model, duration, cost or tokens and how it ended). It never holds message text. It is yours to read or rotate; Pocket only appends to it.

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
| `INBOX_WATCH`, `BACKGROUND_JOBS`, `REARM_RETRIES`, `CONFIRM`, `COUNT_OWNER_WORK`, `CEILINGS_HOLD_OWNER_WORK`, `COUNT_WAITING` | On or off (`1`/`0`, `yes`/`no`, `on`/`off`, `true`/`false`) |
| `CLAUDE_WEEKLY`, `CLAUDE_FIVE_HOUR`, `CODEX_WEEKLY`, `CODEX_FIVE_HOUR` | A percentage, or `off`. `CLAUDE_WEEKLY_CEILING` also works |
| `WEEKLY_CEILING`, `FIVE_HOUR_CEILING` | Both engines at once; an engine's own name wins |
| `DAILY_REPLIES`, `OPENROUTER_DAILY` (dollars), `LONGEST_REPLY` (minutes) | A number, or `off` |
| `STALE_HOURS` | A number of hours, 1 to 24 |
| `NOTICE` | `push` or `settings` |
| `TICK_MS` | How often Pocket checks the longest-reply limit, in milliseconds. Default 60000. Not a setting |

## Coming next

Two features that start work for you are planned for later releases, each off until you turn it on: **check-backs** (a conversation takes one more turn at a time you asked for) and **job keys** (a script on this server starts a conversation with an instruction you wrote). Pause all and these limits already cover them. Neither is in 1.117.

## For agents

- **Pocket can be paused.** If a message you were waiting on, a retry or a queued follow-up doesn't run, the owner may have paused Pocket. Don't try to get round it. The banner and **Settings → Automation** say.
- **Background work stops too.** Pause all stops your background jobs on Claude, and a reply you start by yourself while paused (when a background job or terminal finishes) is stopped as it begins. Say what was left unfinished when the owner next writes.
- **A queued follow-up or a wake may wait.** When Pocket is paused, or a limit holds work, it starts later or when the owner resumes it. Don't re-send it.
- **You can't pause, resume or change these settings.** They need the owner's own sign-in; the command token is refused, so no agent can raise its own limits or lift a pause. Tell the user the path: **Settings → Automation**.
- **The owner's messages still reach you while paused**, unless they chose **Blocked**. Then their send is refused with *Pocket is paused. Resume to send.* and waits in their message box.

See [For agents](for-agents.md).

## Reference

- **Data.** The pause and the saved settings are in `pocket-settings.json` (`paused` and `automation`). The day's counts and notices are in `automation-state.json`; the audit is `automation-audit.jsonl`. A `.retry.json` marker for a held retry gains `held: true`. Older versions ignore the new keys.
- **Routes.** `GET` and `POST /api/pause`, `POST /api/resume`, `GET /api/automation` and `POST /api/automation/settings` take the owner's sign-in only. See [SECURITY.md](../../SECURITY.md).
- **Upgrade.** Nothing to migrate.
- **Rolling back to 1.116.** The extra keys are ignored, so the install runs as if unpaused, and a held retry is armed again at start (held retries run). 1.116 keeps the saved pause in `pocket-settings.json` without reading it, so upgrading to 1.117 again comes back paused: resume before rolling back, or press **Resume** after upgrading again. If Pause all had paused Inbox Watch, it stays paused under 1.116 until you resume it in [Inbox Watch](inbox-watch.md#change-the-schedule-rules-and-models).

## Troubleshooting

**A queued message didn't start.** Check for the banner. While paused the queue doesn't drain. After **Resume** it stays paused until you start it with **Run next instruction**. A plan ceiling can also hold it if you switched on **Plan ceilings also hold queued messages, retries and coordination wakes**.

**A conversation says *Retry held* after you resumed.** Pause all held a usage-limit retry, and **On Resume, re-arm held usage-limit retries** is off. Send a message to carry on.

**A limit is blocking work I want to run.** Raise it, or choose **No limit**, in **Settings → Automation**, or start the work yourself: your own messages and **Run next instruction** are not held.

**The page says *This server does not offer automation settings yet.*** The server is on an older version.

**A build or watcher stopped when I paused.** Pause all stops background jobs. Turn off **Pause all also stops background jobs** to leave them running until one of them starts a reply. Pocket still stops that reply while paused, which ends the conversation's process and any other jobs in it. A job whose reply was still running ends with the reply either way.

**My own message was refused.** **Your own messages while paused** is **Blocked until you resume**. Tap **Resume**, then send again, or change the setting.
