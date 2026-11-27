<!-- manual
checked: 1.126.0
sources: approvals.mjs, approval-push.mjs, checkbacks.mjs, job-keys.mjs, trusted.mjs, questions.mjs, subagents.mjs, public/approvals.js, public/automation.js, public/sw.js, public/workspace.js, push-text.mjs
-->
# Questions and approvals

While an agent works it can stop and wait for you in two ways: it asks a question, or it asks permission to run an action.
Pocket Code shows both in the conversation, sends a notification, and passes your answer back to Claude Code or Codex. The
permission mode you pick for each reply decides how often the agent has to ask. There is nothing to turn on, except
answering approvals from the notification, which is off until the owner turns it on.

## Use it

### Answer a question

When Claude uses its question tool (AskUserQuestion), or Codex asks a native question, the conversation shows a banner
such as **Claude has a question for you** or **Codex has 2 questions for you**, and the conversation list marks the
conversation **Needs your answer**.

When it is one question with up to four options (and not a multiple-choice or secret one), the banner asks it
directly: the question is the title and each option is a button. Tap one and the answer is sent. **Answer** opens the
form instead, for a typed answer or to read the options' descriptions.

Otherwise:

1. Choose **Answer** (or **Answer all**) on the banner. The **Agent questions** sheet opens.
2. For each question, pick an option (several when the question allows more than one), or type under **Or write an
   answer**. A typed answer replaces the options you ticked.
3. Choose **Send answers**. Every question needs an answer before it sends. The sheet closes itself once no question
   is left waiting.

A question from a subagent says so under the question: **From subagent: Review imports** (the name the agent was
started with).

A question Codex marks as secret takes its answer in a password field. Codex shows native questions mostly in **Plan
first** mode (the Codex mode chip above the message box). A non-blocking Codex question says "Codex keeps working while it
waits"; a blocking one says "The reply is paused until you answer."

Questions the agent asks in its final reply, with suggested buttons, are a different thing: see
[suggested replies](conversation.md#pick-a-suggested-reply).

### Type instead of answering

You do not have to use the form. While a blocking question waits, the message box reads **Answer above, or type here to
skip the questions…**. A message sent with **Steer now** goes to the running reply, and every waiting blocking question is
answered "skipped": the agent reads your message instead and may ask again later. The delivery note says **Questions
skipped. Your message went to the running reply.** A message sent with **After this reply** is queued and leaves the
question waiting.

### Choose Review actions or Full access

Each reply runs in one of two permission modes:

- **Review actions**: the agent asks before running commands, editing files, starting subagents or using external tools,
  and Pocket shows each request as an approval card. Ordinary file reads run without asking. Codex runs in a read-only
  sandbox and asks for anything outside it; safe reads and actions its own configuration already allows run without
  asking.
- **Full access**: the agent runs its tools without routine prompts, with the full access of the server account Pocket runs
  as.

Pick the mode for the next reply with the permissions chip above the message box (**Review actions** or **Full access**;
**Review** or **Full** on a narrow screen), or **Conversation options → Permissions for the next reply**. The sheet is
titled **Permissions for the next reply**. The New conversation screen has the same chip.

How the choice applies:

- It applies to the next reply that starts. A reply already running keeps the mode it started with; steering it does not
  change its permissions.
- A message queued with **After this reply** captures the mode selected when you queued it. The Queue panel shows it on
  each row.
- A Branch uses the conversation's next-reply mode.
- When a conversation's process is kept between replies, changing the mode restarts that process for the next reply.
- The choice is remembered per conversation on this browser. A conversation you never set uses the install default.

The install default is **Review actions**. The operator can change it, or remove Full access entirely, with environment
variables (see [Settings](#settings)). When Full access is turned off, the chip offers only Review actions and the server
refuses any request for Full access.

In Assistant mode the permissions chip is hidden; replies use the conversation's remembered mode or the install default.

### Review an action

In Review actions, when the agent asks to run something, the Working row reads **Waiting for your OK** and the
conversation list shows **Needs approval**.

When one request waits, the banner under the conversation header is the card: it asks in plain words what the agent
wants to do ("Run: Run the import checks?", "Save report.csv?"), shows the command or the file under it, names the
subagent when one asked (**From subagent: Review imports**), and carries **Don't allow** and **Allow**. One tap decides
it. **Details** opens the sheet with the full request. A request Pocket cannot show in full offers only **Don't allow**
and **Details**.

When several requests wait, the banner reads **N requests waiting for your OK** with **Review**:

1. Choose **Review**. The **Waiting for your OK** sheet lists each pending request as a card.
2. Each card asks in plain words what the agent wants to do ("Run this command?", "Apply these file changes?") and shows
   the command, or the files it would change. **Show details** has the full request.
3. Choose **Allow** or **Don't allow**. The sheet closes itself once nothing is left waiting; with more requests left,
   it shows them.

The allow button names its scope:

| Button | Covers |
|---|---|
| **Allow** | This one command, file change or tool call. |
| **Allow network access** | A Codex network request. It can release several pending requests to the destination shown. |
| **Allow for this reply** | A Codex request for more access. It grants the listed access until the reply ends. |

For the two broader grants the card states the scope above the details. After **Allow**, the card says "Allow decision
sent. Check the conversation for the result": an approval is not proof the action succeeded. After **Don't allow**, the
agent may try a different approach; Claude is also told not to run the denied action through another tool.

A card can also say "A complete, supported action preview is unavailable". Pocket never approves an action it cannot show
in full, so only **Don't allow** works there; ask the agent for a different action. **Refresh** reloads the live requests.

Closing the sheet, locking the phone or losing the connection never approves anything. The request keeps waiting.

### Let read-only actions run without asking

Under Review actions every Bash command, MCP tool call and web lookup shows a card, including harmless reads. The owner can
list read-only actions that Claude may run without a card in **Settings → Agents → Actions that run without
asking**:

1. Type a rule under **Add an action**, for example `Bash(git status)`, `Bash(acme-report:*)` or `mcp__memory__*`.
2. Choose **Add**. A rule Pocket will not accept is refused with the reason under the field.
3. **Remove** takes a rule off. **Use the server's list** goes back to the list in `POCKET_TRUSTED_ACTIONS`.

This covers replies in Review actions: Claude Code for every kind of rule, and Codex (since 1.87), OpenRouter (1.87) and
Antigravity (1.120) for command rules. Full access already runs everything without asking. A listed command runs with any
arguments the agent gives it, so list only commands that cannot change anything. The rule syntax, what counts as a match
and the audit record are in [Action approvals](../action-approvals.md#actions-that-run-without-asking).

### Get notified on your phone

A new question or approval sends a push notification to every device with **Settings → Notifications → Push to
this device** and **Finished replies** on: **Claude has a question** or **Codex has a question** ("Open Pocket Code to
answer it."), or **Waiting for your OK** ("Open Pocket Code to review the pending action."); from a subagent, **A
subagent has a question** or **A subagent is waiting for your OK**. The notification carries no command or argument details. Tapping it
opens the conversation; answer or approve there.

That is how every install starts. The owner can turn on **Answer approvals from notifications**: action approvals then
get notifications of their own, which show the action and carry **Don't allow**, and **Allow** on a device you tested.
See [Answer from the notification](#answer-from-the-notification). Questions always notify as above.
(Vault requests are different: those notifications carry Allow and Deny buttons, Allow only when the command, title and text were sent uncut and in plain characters; see
[Vault](vault.md#answer-a-request).)

A conversation muted with its **Alerts** chip sends no notifications, including questions and approvals.

### Answer from the notification

Off by default. With it on, you can answer an agent's action approval from its notification without opening Pocket.
**Allow** covers that one request only, shows only for a short action Pocket can show whole, and is never Always allow.
**Don't allow** shows on every approval notification.

> **Not yet verified on real devices.** Whether a phone or computer shows the buttons, shows the whole action line, and
> lets you tap a button while it is locked depends on the device. Nothing here has been checked on real phones yet. The
> test notification below is how you find out for your own device.

**Turn it on**

1. Open **Settings → Features** and turn on **Answer approvals from notifications**. Its **›** opens the page **Answers
   from notifications**, where every setting is ([Settings](settings.md#answers-from-notifications-page)).
2. On each device that should answer, open **Settings → Notifications**. Under **This device only**, check that **Push
   to this device** and **Action approvals** are on. While the feature is on, a device with **Action approvals** off gets
   no approval notification at all, not even the old **Waiting for your OK**.
3. Under **Allow button on this device**, choose **Send a test notification**.
4. Look at the test notification in every way this device shows notifications: collapsed, expanded and on the lock
   screen. Its first line starts "Runs:" and its second "In:". Each ends in a two-character code.
5. Back in Pocket, type the code at the end of the "Runs:" line and the code at the end of the "In:" line, then choose
   **Turn on Allow button**. The codes work for 10 minutes. The test's own buttons only open Settings at these fields.

If you can't see the end of both lines in a view where the buttons show, don't turn it on: that device would show Allow
beside an action you can't read. Leave its Allow button off, and its approval notifications offer **Don't allow** only.

The status line then reads "On. Tested at 80 characters on …". **Turn off** turns it off again. Five wrong tries end a
test; send a new one.

**What turns a device's Allow button off.** Turning **Push to this device** off and on again, or a browser that changes
its push address, makes it a new device to Pocket: it needs the test again. Raising **Longest action with an Allow
button** turns the Allow button off on every device; each says **Needs a new test**. Lowering it keeps them on.

**What a notification looks like**

Each waiting request gets its own notification, sent at once. The lines are always in this order: the action, the folder,
the conversation, then who started the reply and which subagent asked, when that applies. Every word is Pocket's; the
agent's own description of the command never appears.

Your own reply, Claude Code, a short command, on a tested phone:

```
Allow this command?
Runs: wp cache flush --url=shop.example.com
Conversation folder: ~/projects/shop
Conversation: Shop price pages
[Don't allow]  [Allow]
```

A job's reply, Codex, a command too long to show:

```
Job: Allow this command?
Runs: (412 characters, too long to show here; open Pocket to review it)
In: ~/projects/alert-pager
Conversation: Camera outage at the warehouse
Started by job alert-pager
[Don't allow]
```

- The title is "Allow this command?", "Allow this web page?", "Allow this web search?", "Allow this edit?" or "Allow this
  action?". A check-back's reply puts "Check-back: " in front, a job's "Job: ".
- The action line is "Runs: …", "Opens: …" or "Searches: …"; for a request that never gets Allow it is, for example,
  "Edits: <file>", "Starts a helper", "Uses: <tool>" or "Network access: <host>".
- The folder line is "In: <folder>" where the command runs (Codex, OpenRouter, Antigravity), or "Conversation folder:
  <folder>" for Claude Code, whose shell may have moved with a `cd`. Your home folder is written `~`.
- The conversation title is cut to 60 characters and a subagent's name to 40. The origin line is "Started by job
  <name>", "Started by a check-back" or "A job has run in this conversation".
- A tap on the notification itself opens the conversation at the request's card. It never answers.

With **What approval notifications show** set to **Only that an action waits**, every approval notification reads
"Pocket Code" and "An action waits for your OK.", with **Don't allow** only: no conversation, no action.

More than **Notifications with buttons per conversation** (3) waiting at once: the rest wait behind one notification,
"2 more actions wait in Shop price pages". When one is answered, the next gets its own notification.

**When Allow is missing, and why**

Allow shows only when all of these hold. Otherwise the notification has **Don't allow** only, and you answer in Pocket.

| What | Why |
|---|---|
| This device's **Allow button on this device** is on | Pocket can't see what a device displays. |
| The request is a Claude Code command, web page or web search, a Codex command, or an OpenRouter or Antigravity command | File edits, helpers, connector tools, network access and more access for the reply do more than one line can show. |
| The action and the folder are plain characters (letters, digits, spaces and ordinary punctuation) | Line breaks, invisible characters and look-alike letters can hide what runs. |
| The action line and the folder line, labels included, fit in **Longest action with an Allow button** (80 characters) | A cut command could hide its end. With a usual folder that leaves room for a command of roughly 30 characters. The line then says "(412 characters, too long to show here; open Pocket to review it)". You can raise the limit, then test each device again. |
| The folder has no `..` part | `~/projects/shop/../../..` reads as the shop folder and is somewhere else. |
| Nothing in the action or the folder looks like a password or key | Push text passes through the browser's push service. The line then says "(looks like it contains a password or key; open Pocket to review it)". |
| The reply was not started by a job, and no job has run in this conversation | Unless **Allow on a job's actions** is on (off by default). |
| A check-back's reply: **Allow on a check-back's actions** is on | On by default. |
| The agent is switched on under **Engines** | All four are on by default. |
| A Codex command names its own folder | Without one, Pocket can't say where it runs. |
| The notification goes out whole | A push cut to fit never carries Allow. |

**After you answer**

- Your notification closes. Pocket checks the answer again: the request must still be waiting, Pocket must still offer
  Allow for it on this device with today's settings, and the notification must be no older than **Allow works for** (30
  minutes). If it all holds, nothing opens.
- The notification on your other devices is replaced, silently and with no buttons: "Allowed on another device at 2:14
  PM", "Allowed in Pocket at 2:14 PM", "Not allowed at 2:14 PM", or "No longer waiting: the reply ended" (or "the reply
  was stopped", "Pocket was paused", "the agent withdrew it"). **Update other devices after an answer** turns this off.
  After a restart no replacement is sent.
- If the answer doesn't go through, a second notification says so ("Your Allow didn't go through: … Open Pocket.") and
  Pocket opens the conversation at the request. A line above its card says what happened:

| The line above the card | What happened |
|---|---|
| This device was signed out of Pocket. | The answer was refused as not signed in (401 or 403), or met a redirect to a sign-in page. |
| Answering from notifications is turned off. | **Answer approvals from notifications** was off when the answer arrived. |
| It was no longer waiting. | It was answered on another device or in Pocket, the reply ended or was stopped, or Pocket was paused. When Pocket knows, the line says when and from where it was answered. |
| Pocket couldn't match it to what the notification showed, or a setting changed. Review it here. | The action no longer matches the notification, or a setting changed since it was sent so that it would no longer offer Allow. |
| The notification was too old. Review it here. | The notification was older than **Allow works for**. |
| Delivery of this decision is uncertain. Stop the reply and review the conversation; do not approve it again. | Pocket answered 503. |
| This device was offline. | The answer could not reach Pocket. |
| Pocket couldn't take the answer. Review it here. | Any other refusal. |

The line starts with "Your Allow didn't go through." or "Your Don't allow didn't go through.". Answer on the card below
it. An answer applies only to the request its notification named; Pocket never picks "the newest" one.

**A lost or borrowed phone.** By default the notification shows the action on the lock screen. If your phone lets you tap
Allow while it is locked, anyone holding it can read the action and allow it for up to 30 minutes after the
notification. Pocket can't prevent that; the phone decides. You can turn on the phone's own setting to hide notification
content on the lock screen (its effect on the buttons is not verified), choose **Only that an action waits**, leave that
device's Allow button off, or, for a lost phone, use **Sign out everywhere**, which stops notifications on every device
at once. See [SECURITY.md](../../SECURITY.md#answering-action-approvals-away-from-the-app).

Until you answer them, waiting questions and approvals also show under the conversation list's **Attention** filter (see
[Find a conversation](sessions.md#find-a-conversation)) and, in Assistant mode, as **Waiting for you** cards on the home
screen.

## How it works

### What happens if you don't answer

Nothing is decided for you. The reply waits until you answer:

- Questions and approvals do not expire, and a reply waiting on one is never stopped for being quiet (the stall watchdog
  skips it).
- **Stop** ends the reply and withdraws its questions and cards.
- A request from a subagent outlives the reply that started it. When a reply ends while a background subagent's request
  is still waiting, or a background subagent asks after the reply has ended, Pocket opens a stand-in turn for it: the
  conversation reads **Needs approval** or **Needs your answer** and the card is shown as usual, named after the agent.
  The stand-in ends the moment nothing is waiting and the conversation goes back to **Working in background**; it records
  no reply of its own. A message you type meanwhile goes to the agent and does not skip a subagent's question.
- If Pocket restarts while a request waits, the request cannot be answered any more. The restarted server reattaches to
  the agent process and answers each request sent before the restart with a deny (Codex: the matching decline), so the
  reply carries on and the agent can ask again. If Pocket cannot reach the process's input any more, the conversation
  shows **Approval connection interrupted** or **Question interrupted**; use **Stop interrupted reply**, review what finished, and send a new
  message.

### Replies you did not start

A reply Pocket starts without you (a queued message, a usage-limit retry, a conversation woken from [Coordination](coordination.md), a [check-back](automation.md#check-backs), a reply a [job key](automation.md#job-keys) started) asks for approval exactly as one you started does. It runs with the permissions the work was set up with: a queued message with the mode it was queued with, a coordination wake with the mode it asked with, a check-back with the mode of the reply that set it (**Always Review actions** in **Settings → Features → Check-backs** lowers it to Review actions; a server with Full access turned off does the same; it is never raised), and a job key's reply with the key's access: **Ask first** is Review actions, and **Full access** is Full access, only where the server allows it (a server with Full access turned off runs the key under Review actions). A new key is **Full access** by default where the server allows it, since 1.125.2 ([Job settings](automation.md#job-settings)). Nothing the script sends changes the access. A usage-limit retry carries on with the mode of the reply it continues. When Full access has since been turned off for the install, a queued message that needed it does not start (see Troubleshooting).

Nobody may be looking when such a reply asks, and it waits for you like any other: it does not expire. (On a check-back's or a job's reply, the time it waits for you doesn't count toward **Longest unattended reply** unless you switch that on.) The conversation reads **Needs approval**, and the push goes out as usual. With [answers from notifications](#answer-from-the-notification) on, a check-back's notification offers **Allow** by default (**Allow on a check-back's actions**). A job's notification offers **Don't allow** only by default (**Allow on a job's actions**), and so does every later reply in a conversation a job has run in, your own included, and any branch of it: a job's data may have shaped the command. The two switches are on the **Answers from notifications** page ([Automation](automation.md#what-waits-for-you-in-a-job-reply)).

**Ask first when nobody is watching.** A job key set to **Ask first** is Review actions with nobody at the screen, so every action that isn't on your list of read-only actions ([above](#let-read-only-actions-run-without-asking)) waits for you, however long it takes. The script that called is told the run **needs you** (`pocket-run` exits 3) and can look again later. Until you answer, the run counts as working: with **Runs at once** at 1, every later call to that key is refused as busy ([Automation](automation.md#what-a-runs-status-means)). Where you want a job to run on its own, keep its instruction to what your list allows, or keep **Full access** for the key (the default for a new key where the server allows it), in a folder where a mistake is cheap. A request to share or publish a file, or to use a secret that asks, also waits for you, under either access.

**Pause all** ([Automation](automation.md#pause-all)) stops every running reply, so a card waiting for you is withdrawn, the way **Stop** withdraws it. While Pocket is paused none of these replies starts, so none can ask. Your own messages still run, and ask as usual, unless you chose **Blocked until you resume**.

### Provider details

| | Claude Code | Codex |
|---|---|---|
| Review actions | Permission mode `default`, with ask rules for Bash, PowerShell, Edit, Write, NotebookEdit, Agent, Task, WebFetch, WebSearch and every MCP tool. | Read-only sandbox, `untrusted` approval policy, the user as reviewer. |
| Full access | `bypassPermissions` | `danger-full-access` sandbox, approval policy `never` |
| Request kinds | One kind: a tool call, shown in plain words. | Command, file change, network access, additional permissions. |
| From subagents | Shown with the agent's name, read from the agent's own transcript (`<project>/<session>/subagents/`). | Re-homed on the reply with the agent's name; a subagent's file change cannot be previewed, so it offers only Don't allow. |
| Questions | AskUserQuestion, always shown as a question. | Native questions, mostly in Plan first. |
| Actions that run without asking | Supported. | Command rules only (`Bash(…)`), since 1.87. |
| Requests Pocket cannot show | Denied with "This interactive request is not supported in Pocket Code." | Declined (MCP elicitation requests are cancelled). |

Deny rules and organization policies in the agent's own settings still apply in both modes. A Codex file change that asks
for write access to a whole folder, or whose changes Pocket cannot preview, cannot be allowed.

### Records

Every request and decision is written to `approval-decisions.jsonl` in `POCKET_DATA_DIR` (which defaults to the Pocket Code
directory) before Pocket answers the agent: identifiers, the request kind, a hash of the request, the decision, and
(since 1.126.0) where the answer said it came from: `source` is `app` or `notification`, and a notification answer adds
the device (a short hash of its push address), the push service and the kind of action. An answer from a notification
that Pocket refused is written as a `refused` line with its reason. The file never contains commands, arguments or file
contents. If the record cannot be written, nothing is approved. Questions and answers are not recorded there.

**Settings → Usage → Answered away from the app** lists the last 7 days of answers from notifications and the ones Pocket
refused: the time, the conversation, the kind of action, **Allowed**, **Not allowed** or **Refused** with the reason, and
where, which is the push service the device uses (for example **Chrome or Android**, **Apple** or **Firefox**). Pocket
keeps no device names.

A decision is tied to one conversation, one live reply and one request. Repeating the same decision is harmless;
answering a request differently from a second device is refused; a decision for a reply that has ended is refused. At
most 20 requests (and 20 question sets) can wait per reply.

### Settings

| Setting or variable | Effect |
|---|---|
| `POCKET_APPROVAL_MODE` | The install default: `review` (default) or `full`. |
| `POCKET_ALLOW_FULL_ACCESS=0` | Removes Full access from the picker and refuses it at the server. |
| `POCKET_TRUSTED_ACTIONS` | The server's list of actions that run without asking: one rule per line, or several separated by commas outside parentheses. Used until a list is saved in Settings. |
| **Settings → Agents → Actions that run without asking** | The owner's list, saved for the whole install (`trustedActions` in `pocket-settings.json`). Up to 50 rules. |
| **Settings → Notifications → Finished replies** | Per device: also controls question notifications, and approval notifications while answers from notifications are off. |
| **Settings → Features → Answers from notifications** | The switch **Answer approvals from notifications** (off) and its settings, for the whole install. Every setting, default and range: [Settings](settings.md#answers-from-notifications-page). |
| **Settings → Notifications → Action approvals** | Per device, while answers from notifications are on: whether this device gets approval notifications at all (on when push is on). |
| **Settings → Notifications → Allow button on this device** | Per device: off until you test the device ([above](#answer-from-the-notification)). |
| `POCKET_APPROVAL_PUSH_<NAME>` | Presets for **Answers from notifications**, for example `POCKET_APPROVAL_PUSH_ANSWERS=1`. A value saved in Settings wins. |

Variables go in the Pocket Code directory's `.env`; restart Pocket after changing them.

## For agents

- **Ask with your native question tool** when you need a decision while you work. Pocket shows it as a form and notifies the
  user. Give 2 to 4 clear options with short descriptions; the user can always type their own answer.
- **Expect to be skipped.** If the tool result says the user skipped the questions and sent a message instead, respond to
  that message; ask again only if you still need the answer.
- **A denial is final for that action.** When a tool call is denied ("The user denied this action. Do not run it through
  another tool."), do not reach the same result another way. Explain what you needed and let the user decide.
- **A restart denial is different.** "Pocket Code restarted while this request was waiting. Request it again if it is
  still needed." means nobody answered; request it again.
- **Keep commands plain under Review actions.** A command on the owner's list runs without a card only when it is one
  simple command, written exactly as listed: no `cd somewhere &&`, pipes, redirection, `$( )`, environment-variable
  prefixes or full paths. Run it on its own to avoid an unnecessary card.
- **Do not change the permission mode or the trusted list yourself.** They are the owner's choice. If Review actions makes
  a task impractical, say so and suggest Full access or a specific rule; the owner sets it in the app.
- **Explaining modes to a user:** Review actions asks before anything that runs or changes; Full access runs with the
  server account's access. Neither is an isolation boundary between people who share a Pocket sign-in. See
  [the security model](../../SECURITY.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| New replies default to Review actions although `POCKET_APPROVAL_MODE=full`; the log says "POCKET_APPROVAL_MODE=full conflicts with POCKET_ALLOW_FULL_ACCESS=0" | Full access is turned off, so Pocket starts in Review actions. | Remove one of them and restart Pocket. |
| The log says "POCKET_APPROVAL_MODE=… is not review or full" | `POCKET_APPROVAL_MODE` is set to something other than `review` or `full`; Pocket starts in Review actions. | Fix the value and restart Pocket. |
| Full access is missing from the permissions sheet | `POCKET_ALLOW_FULL_ACCESS=0`, or the browser could not load the instance policy. | Check `.env`; reload. |
| A queued message shows **Needs review** with "Full access is turned off on this server; send it again with Review actions." | It was queued with Full access, which the server has since turned off. It did not start. | Remove it and send it again with Review actions. |
| "This action is no longer waiting. Refresh the approvals." | The reply ended, was stopped, or the request was withdrawn. | Read the conversation; send a new message if needed. |
| "This action was already answered differently." | Another device answered first. | Refresh; the first answer stands. |
| "Could not record this decision. Nothing was approved; try again." | `approval-decisions.jsonl` could not be written (disk full, permissions). | Fix the data directory, then try again. |
| **Approval delivery uncertain** / "Delivery of this decision is uncertain…" | The decision was recorded but could not be confirmed as delivered to the agent. | Stop the reply and review the conversation. Do not approve again. |
| **Approval connection interrupted** or **Question interrupted** | Pocket restarted and cannot reach the agent process's input. | **Stop interrupted reply**, review, send a new message. |
| "This question was already answered differently." | Another device answered first. | Refresh the conversation. |
| A listed action still shows a card | The command was chained, piped, redirected, prefixed with `VAR=value`, called by path, or Codex is running; or the reply is in Full access (no cards at all). | See the matching rules in [Action approvals](../action-approvals.md#actions-that-run-without-asking). |
| No notification for a question or approval | The conversation is muted, **Finished replies** is off on that device (or, for an approval while answers from notifications are on, **Action approvals**), push is not set up, or that device was signed out (**Sign out** and **Sign out everywhere** turn push off). | Check the **Alerts** chip and **Settings → Notifications**, and turn **Push to this device** on again after signing in. |
| An approval notification has **Don't allow** only | One of the conditions in [When Allow is missing](#answer-from-the-notification) does not hold: most often the device's Allow button is off or needs a new test, or the action and folder are longer than the limit. | Answer in Pocket. Test the device in **Settings → Notifications**, or raise **Longest action with an Allow button** and test each device again. |
| **Allow button on this device** says **Needs a new test** | The longest action was raised after this device was tested. | **Send a test notification** and type its codes. |
| The test notification didn't come | Notifications for Pocket are blocked or silenced on the device, or the push service refused it. | Allow notifications for Pocket on the device, then send another test. |
| "Those codes don't match." | A code was mistyped, or it came from an older test. | Type the two characters at the end of the "Runs:" line, then the two at the end of the "In:" line. After five wrong tries, send a new test. |
| Missed: "This device was signed out of Pocket." | The device's sign-in ended (**Sign out everywhere**, a new password, or a Cloudflare Access session that ran out). | Sign in again on the device; answer on the card. |
| Missed: "Answering from notifications is turned off." | **Answer approvals from notifications** was turned off after the notification was sent. | Answer on the card, or turn it on again in **Settings → Features**. |
| Missed: "It was no longer waiting." | Someone answered it first, or the reply ended, was stopped or was paused. | Read the conversation; send a new message if needed. |
| Missed: "Pocket couldn't match it to what the notification showed, or a setting changed." | A setting changed after the notification was sent (a lower limit, **Only that an action waits**, the agent switched off under **Engines**, the job or check-back switch, the device's Allow button off), or the request changed. | Review the card and answer there. |
| Missed: "The notification was too old." | It was older than **Allow works for** (30 minutes by default). | Review the card and answer there. **Don't allow** has no time limit. |
| Missed: "Delivery of this decision is uncertain…" | Pocket answered 503: the decision could not be recorded, or its delivery to the agent could not be confirmed. | Stop the reply and review the conversation. Do not approve it again. |
| Missed: "This device was offline." | The answer could not reach Pocket. | Answer on the card once the device is online. |
| Missed: "Pocket couldn't take the answer." | Pocket refused it for another reason. | Answer on the card. |

Deeper reference, including restart handling and rollback: [Action approvals](../action-approvals.md) and
[Operations](../operations.md#restarted-questions-and-approvals).
