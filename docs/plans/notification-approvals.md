# Allow and Don't allow on action approvals, from the notification and by voice

Status: **agreed by the owner; Parts 1-5 and 7 built in 1.126.0, off by default; Part 6 (voice) not started**
(2026-11-27, revised after review; the four open questions were answered the same day, see
[Decided by the owner](#decided-by-the-owner-2026-11-27)). Where the code differs from this text, see
[As built in 1.126.0](#as-built-in-11260). "Later phase 4" of
[Unattended work](unattended-work.md#later-phases-agreed-to-be-specced-after-job-keys). Line references are to Pocket
Code 1.125.0 and will drift.

## Why

- Under Review actions, an agent's command, edit or web request waits for the owner. Check-backs (1.119) and job keys
  (1.122) start replies while the owner is away. With **Permissions for a check-back: Always Review actions**, or a job
  key set to **Ask first**, such a reply stops at its first action and waits. Under Full access a reply stops only on
  the few commands Claude Code's own safety check still asks about (Part 5).
- The push for that wait says only "Waiting for your OK · Open Pocket Code to review the pending action."
  (server.mjs:2007). The owner has to open Pocket, find the conversation and tap Allow there.
- Vault and document share requests already carry **Allow** and **Deny** on the push. The owner's direction
  (unattended-work.md:653) is the same for action approvals, and by voice.
- An Allow here runs a command with the server user's power, more than a Vault Allow releases. So most of this spec is
  about when Pocket does **not** offer Allow.

## Scope

1. **Don't allow** and **Allow** on the push for one waiting action approval, for Claude Code, Codex, OpenRouter and
   Antigravity replies under Review actions, on devices the owner has tested and switched on.
2. A server check that ties every answer to the exact request and text the server built for that device.
3. Updating the notification on the owner's other devices once the request is answered or withdrawn.
4. A record of where each answer came from, and a list the owner can read.
5. Voice: answering the one approval Pocket has just read aloud, in the open app (second release).

Not in scope: questions; Always allow or a new rule for **Actions that run without asking** from a notification or by
voice; connector (`mcp__*`) actions, which get Don't allow only in release one (later: a readable form for their
arguments); phone calls, Telegram or watch apps; quiet hours; changes to the Vault's own notifications beyond the patch
in Releases. The feature is **off by default**; an install that leaves it off sends exactly today's pushes. The buttons
are named "Allow" and "Don't allow", as on the card in the app (public/approvals.js:56-57); "Don't allow" sends `deny`.

## What exists today

### Action approvals, per engine

| Engine | How a request arrives | What the card offers |
|---|---|---|
| Claude Code | Review actions runs Claude with `permissionMode: default` and ask rules for AskUserQuestion, Bash, PowerShell, Edit, Write, NotebookEdit, Agent, Task, WebFetch, WebSearch and `mcp__*` (approvals.mjs:12). Each ask is a `control_request` `can_use_tool` (server.mjs:2029). AskUserQuestion goes to the question inbox (2033). A trusted rule is answered Allow with no card (2043). Anything else becomes a card titled "Allow <tool>?" with `details: {tool, cwd: turn.cwd, input}` (2044). A request Pocket can't place is denied (2047). A `control_cancel_request` withdraws it (2049). | Don't allow, Allow. |
| Codex | Review actions is a read-only sandbox with the `untrusted` policy (approvals.mjs:15). Questions go first (codex.mjs:1105). `codexApproval` (approvals.mjs:91-100) makes `command` with `command`, the agent's `cwd` and `additionalPermissions` (94), or `network` when there is a network context; `fileChange`, Allow refused with no preview or a `grantRoot` (97); and `permissions` (99). Trusted commands run with no card (codex.mjs:1109-1112). The command arrives as one string such as `/bin/bash -lc 'echo CX_OK'` (test/fake-codex.mjs:122); Pocket's own matcher strips that wrapper (codex.mjs:1110). | Don't allow, plus Allow, **Allow network access** or **Allow for this reply** (public/approvals.js:63). |
| OpenRouter and Antigravity (ACP) | `session/request_permission` (acp.mjs:529); Full access allows at once (533). `approvalCard` makes `fileChange` for kinds edit, delete and move and **`command` for every other kind** (acp.mjs:252-255), its text from `rawInput.command` (OpenCode), else `rawInput.CommandLine` (Antigravity, acp.mjs:235), else the call's **title**. `permissionOutcomes` picks `allow_once`, else `allow_always`, else the first option (acp.mjs:197). Questions come through Pocket's ask tool or an elicitation form (acp.mjs:549). | Don't allow, Allow. |

Shared by all engines (`ApprovalInbox`, approvals.mjs), in memory only:
- **Raising:** at most 20 waiting per reply (39); a preview over 200,000 characters is refused, "Never approve a truncated
  preview" (41). Each request gets a random id (45) and a fingerprint; a changed resend is refused (42-44). A subagent's
  name is kept up to 240 characters (45; subagents.mjs:88, 97 take it from the Task description).
- **Deciding** (`decide`, 68): `allow` or `deny` only (69). The same answer twice is harmless, a different one is refused
  (71), an older reply's request is refused (73), Allow is refused where `canAllow` is false (75). The decision is written
  to `approval-decisions.jsonl` before the engine is told (78); a failed send is marked uncertain and never retried
  (81-82). `resolve` (87) and `clear` (88) drop rows and tell nobody but the app.
- **Route:** `POST /api/session/:id/approvals/:request/decision` (server.mjs:3445), behind `requireAuth`: the owner's
  cookie or a Cloudflare Access sign-in, no bearer token (1225-1229). An ended or stopped reply gets 409 (3449). Unlike
  the Vault and document answer routes, it has no `sameOrigin` check.
- **Waiting:** an approval never expires. It waits until answered or the reply is stopped: Stop, Pause all, or **Longest
  unattended reply**, which by default doesn't count waiting (automation.mjs:72). After a restart Pocket denies it
  (docs/action-approvals.md:137-143).

**The push today** (server.mjs:2007 Claude, 3892 Codex, 3946 ACP): one push for the newest request in a conversation,
"Waiting for your OK" (Claude alone says "A subagent is waiting for your OK" when one asked), body "Open Pocket Code to
review the pending action." It goes through `pushNotify` (995-999): nothing for a muted conversation; tag = the
conversation id; kind `turns`, so it follows **Finished replies** at normal priority (1019). No command, no buttons
(docs/manual/approvals.md:137). unattended-work.md:293-294 promised check-back approvals "at high priority"; the code
never did that.

### Vault and document requests from the notification

- **The push:** "Allow <names>?" over "<conversation> wants to use it for: <command>" (server.mjs:5584-5587), the command
  cut at 80 characters (5672). `vaultPushOpts` (5588) adds tag `vault:<id>`, kind `vault` (urgent), the request id and
  Allow and Deny. A document share request does the same with `docRequest` (5957).
- **The service worker** copies the request id and actions into the notification (public/sw.js:31, 35). On a button
  (76-83) it closes the notification, then posts `/api/vault/act`, `decision: 'once'` for Allow (53-59), with the cookie.
  "never Always allow from a lock screen" (50). A tap on the body only opens the page (82).
- **The server check:** the cookie (`requireBoardAuth`, 652-657), same origin (5504-5510), 423 while the Vault is locked
  (606-609), 404 unknown or expired (vault.mjs:687), 409 already answered (688). Requests expire after 15 minutes (34).
- **When it doesn't land:** a status maps to `signin`, `locked`, `gone` or `error` (sw.js:52), a failed fetch to
  `offline` (58), and the worker opens the request with `?missed=<why>` (54). On a locked phone that window waits for
  the unlock, and the notification is already closed.
- **Other devices:** nothing updates their copy. **The record:** `by: 'owner'`, with no source (vault.mjs:711).

### Voice today

- Voice works only in the open app (voice.mjs, a local sidecar). Short phrases are matched on the device
  (public/voice-text.js:80-90); none answers an approval. For an approval, voice says "It needs your approval. Review it
  on screen." (public/voice.js:526), and approval prompts never reopen the microphone (voice.js:8-9).
- A dictated phrase that isn't a quick command is sent as an owner message (voice.js:300-318), and that route answers a
  Vault request for "Allow <name>…", "Deny <name>", or a bare "Allow" or "Deny" with one waiting (server.mjs:4177,
  5490-5502), with no read-back of the command.

## Part 1: Which approvals get Allow

**The rule:** Allow only when the whole effect of the request is one short line of plain ASCII that the server can state
exactly, and the owner has shown that this device displays a line that long in full. **Don't allow** on every action
approval while the feature is on: denying can't run anything, and the agent can ask again.

| Engine | Request | Allow | The action line, or why not |
|---|---|---|---|
| Claude Code | Bash | Yes | "Runs: " + `input.command`. Only when `input` has no field but `command`, `description`, `timeout`, `run_in_background`. |
| | PowerShell | Yes | "Runs: " + `input.command`, same field rule. |
| | WebFetch | Yes | "Opens: " + `input.url`, never shortened (data can leave in an address). Fields: `url`, `prompt`. |
| | WebSearch | Yes | "Searches: " + `input.query`. No Allow when `allowed_domains` or `blocked_domains` is set: they change the search and aren't shown. |
| | `mcp__*`, Edit, MultiEdit, Write, NotebookEdit, Agent, Task, Skill, ExitPlanMode, any other | No | The effect doesn't fit one line, or is unknown. The body names the file, helper or tool. |
| Codex | `command` | Yes, with conditions | See "Codex commands" below. Never when `additionalPermissions` is present and not empty: it grants more than the line shows. |
| | `network`, `permissions`, `fileChange` | No | They release several requests (public/approvals.js:55), widen access for the reply, or change files. |
| OpenRouter, Antigravity | `command` | Yes, with conditions | The call's kind is `execute`; the text came from `rawInput.command` or `rawInput.CommandLine`, never the title; an `allow_once` option is offered; `rawInput` has no key outside `command`, `cwd` (OpenCode, acp.mjs:220), `CommandLine`, `WaitMsBeforeAsync`, `toolSummary` (Antigravity, test/fake-agy.mjs:141, 185); a `rawInput.cwd` equals the folder shown. |
| | `fileChange` | No | As above. |

The Claude field lists come from Claude Code's tool schemas and the ACP list from the stand-ins; both are checked
against a live capture before release, and a field not on the list removes Allow. A card whose Allow is refused in the
app (`canAllow: false`) never gets Allow. An action allowed by a trusted rule sends no push.

**Codex commands.** The shown line is built so it can't mislead:
- The exact form `/bin/bash -lc '<script>'` or `/bin/sh -c '<script>'`, with no `'` inside the script: "Runs: <script>".
  Between single quotes the shell takes every character as written, so the script is exactly what runs. Pocket's
  trusted-rule matcher (codex.mjs:1110) reads a wider form (double quotes, `/bin/sh -lc`); its pattern must not be
  reused here.
- Any other string: "Runs: " + the whole string, unchanged. Codex builds it; Pocket trusts it as the card does today.
- A list of arguments: no Allow. No current Codex sends one (the stand-in and both Pocket readers expect a string), and
  joining a list with spaces loses where each argument ends (public/approvals.js:40).

**No buttons; the push stays as today:** questions (AskUserQuestion, Codex's `requestUserInput`, OpenCode's `ask_user`,
Antigravity's elicitation forms); Codex's **Plan first**, whose plan is the reply (codex.mjs:346); Vault, document and job
key requests (*Allow a job key?* keeps no buttons, SECURITY.md:305).

## Part 2: What the notification shows

One server function, `approvalPush(row, turn, device)`, returns the title, the body lines, whether Allow is offered, and
`shown` (Part 3). Pocket writes every word. The agent's own description of a command, which the in-app title uses
(public/phrases.js:119), never appears: it is the agent's claim, not the action.

- **Title** (fixed words, never cut): "Allow this command?", "Allow this web page?", "Allow this web search?", "Allow this
  edit?" or "Allow this action?", with "Check-back: " in front for a check-back's reply ("Check-back: Allow this
  command?") and "Job: " for a job's ("Job: Allow this command?").
- **Body, in this order, one labelled line each:**
  1. The action: "Runs: …", "Opens: …" or "Searches: …"; for a request without Allow, "Edits: <file>", "Starts a
     helper", "Uses: <tool>" or "Network access: <host>".
  2. The folder. Codex and ACP: "In: <folder>", where the command runs. Claude: "Conversation folder: <folder>", because
     `turn.cwd` is where the conversation started, not where the shell is after a `cd`. Home is written `~`.
  3. "Conversation: <title>", cut to 60 characters.
  4. The origin when it isn't the owner: "Started by job alert-pager" (automation.mjs:20-24), or "A job has run in this
     conversation" for the owner's later replies there (Part 5).
  5. "Subagent: <name>", cut to 40 characters.
- **Every line is one line.** Line breaks, tabs, control, zero-width and direction-changing characters are removed from
  every line before it is labelled. The subagent's name and the conversation title are text the agent or outside data controls (a Task
  description, an auto-title from a job's email), so they always come after the action, under their own label, and are
  cut. Cutting a context line is allowed; cutting the action line never is.

**Allow is offered only when all of these hold:**
- The device has **Allow button on this device** on, tested at a limit at least today's (Part 4).
- The action and the folder are printable ASCII only (0x20 to 0x7E). That one rule shuts out line breaks, tabs,
  zero-width and direction-changing characters, and look-alikes such as a Cyrillic "а" in `curl`.
- The action and folder together fit in **Longest action with an Allow button** (80 characters by default).
- The folder has no `..` part. A folder such as `~/projects/shop/../../..` reads as the shop folder at a glance and is
  somewhere else.
- The secret detector finds nothing in the action or folder (public/secret-detect.js, `mode: 'message'`, as the message
  route uses it, server.mjs:4167). If it does, the action line reads "Runs: (looks like it contains a password or key;
  open Pocket to review it)".
- The whole payload, every line counted, fits `PUSH_TEXT_MAX` and the title fits 70 characters, so `pushRaw` cuts
  nothing (server.mjs:1012-1018). If it would, Allow is dropped.

Otherwise the action line says why ("Runs: (412 characters, too long to show here; open Pocket to review it)") and the
only button is **Don't allow**. A tap on the body opens the conversation at the card.

**Example 1: the owner's own reply, Claude Code, a short command, a tested phone.**
```
Allow this command?
Runs: wp cache flush --url=shop.example.com
Conversation folder: ~/projects/shop
Conversation: Shop price pages
[Don't allow]  [Allow]
```

**Example 2: a job's reply, Codex, a command too long to show.**
```
Job: Allow this command?
Runs: (412 characters, too long to show here; open Pocket to review it)
In: ~/projects/alert-pager
Conversation: Camera outage at the Oaks
Started by job alert-pager
[Don't allow]
```

**Lock screen.** A web page can't choose what a locked phone shows; that is the phone's setting. **What approval
notifications show** offers **The action** (default) or **Only that an action waits**: title "Pocket Code", body "An
action waits for your OK.", no conversation title, no action, no Allow, only Don't allow. **Always allow is never
offered**, as for the Vault (sw.js:50).

**Several approvals at once.**
- Each request gets its own notification, tag `approval:<request id>`, so a newer one never replaces an older one, and
  the old per-conversation push is not also sent.
- At most **Notifications with buttons per conversation** (3) at once. Beyond that, one summary without buttons, tag
  `approval-more:<conversation id>`: "2 more actions wait in Shop price pages".
- When one of the three is answered or withdrawn, the oldest request not yet shown gets its own notification and the
  summary is replaced with the new count, or silently replaced by "Nothing more waits in Shop price pages" at zero.
- Each answer names its request, so order doesn't matter for safety. The engines' cap of 20 per reply still applies.

**After an answer or a withdrawal.** When a request is answered or withdrawn (the reply ended or was stopped, Pause all,
or Claude's `control_cancel_request`, server.mjs:2049 → `resolve`, approvals.mjs:87), Pocket sends a replacement with the
same tag, no buttons and `silent: true` ("Allowed on another device at 2:14 PM", "Not allowed at 2:14 PM", "No longer
waiting: the reply ended"). It goes only to devices that received the original, and not to the device that answered,
whose notification is already closed. It has to be a push: the server can't close a notification, and a service worker
must show something for every push. `resolve` and `clear` gain a hook for this. After a restart the rows are gone, so no
replacement goes; a later tap gets 409 and says so. **Update other devices after an answer** turns replacements off.

**Kind and priority.** With the feature on, approval pushes move to a new per-device kind, **Action approvals**, sent
urgent so an idle phone shows them at once. This does what unattended-work.md:293-294 already promised for check-back
approvals. With the feature off they stay in **Finished replies** at normal priority. A muted conversation still sends
no approval push.

## Part 3: How the server checks an answer

**What is stored.** Each row in the inbox gains `push: { devices: { <device>: { allow, shown, at } } }`, where `<device>`
is the first 12 hex digits of the SHA-256 of the subscription endpoint. An entry is written only when the push service
accepted that device's push (`webpush.sendNotification` resolved), so a push that reached no device offers nothing. Rows
live in memory, as today; a restart withdraws them anyway.

**What the notification carries.** `approval: { session, request, shown }`. On a button the service worker posts to the
existing route, `POST /api/session/<session>/approvals/<request>/decision`, with `{ decision, via: 'notification', shown,
endpoint }` (its own subscription's endpoint) and the cookie, `redirect: 'manual'`.

**The checks, in order:**
1. **Who:** `requireAuth`, the owner's cookie or Access sign-in. The CLI token, runner tokens and job keys are refused, so
   an agent can't answer its own request.
2. **Same origin:** the route gains `sameOrigin` (server.mjs:5504) for every caller, the app included, as the Vault and
   document routes have.
3. **Switched on:** only when `via` is `notification` or `voice`. With the feature off, 404 `answers_off`.
4. **Still waiting:** the existing checks, a live reply (3449) and a pending row from it (approvals.mjs:73).
5. **For Allow, only when `via` is `notification` or `voice`:**
   a. The server re-runs `approvalPush(row, turn, device)` with today's settings (for voice, Part 6's rules). Allow must
      still be offered; otherwise 409 `not_offered`. So a setting changed after the push (the check-back or job switch,
      a lower limit, **Only that an action waits**, an engine switched off, the device's Allow button off) refuses an
      old Allow.
   b. For a notification, `push.devices[device]` must exist with `allow: true` (else 409 `not_offered`) and be no older
      than **Allow works for**, 30 minutes by default (else 409 `too_old`). Voice has no push behind it; 5b doesn't apply.
   c. `shown` must equal the hash recomputed in 5a (else 409 `changed`).
6. **Record, then send:** the decision is written with its source (Part 7) before the engine is told (78-79).

An answer from the app (`via` absent or `app`) runs steps 1, 2, 4 and 6 exactly as today: the app shows the full card.

**What `shown` proves.** It is the SHA-256 of the request id, the kind, the action line and the folder line as built for
that device. The conversation title is left out, because titles change while a request waits. It proves that the Allow
names text the server itself built from this row and would still offer today. It does **not** prove what the screen
displayed, that the owner read it, or that the answer came from a notification at all: `via`, `endpoint` and the audit
`source` are what the client claims. Seeing the whole line is what the device test in Part 4 is for.

**What the owner sees.** On success nothing opens. Otherwise the worker shows a new notification, tag
`approval-missed:<request>`, "Your Allow didn't go through: <reason>. Open Pocket.", and opens
`/#/chat/<session>?approval=<request>&missed=<why>&tap=allow|deny`, where a line above the card says what happened. The
new notification matters on a locked phone: the window waits for the unlock, and without it a failure looks like success.

| Answer | `missed` | The line above the card |
|---|---|---|
| 401, 403, or a redirect (`opaqueredirect`, an Access login) | `signin` | This device was signed out of Pocket. |
| 404 `answers_off` | `off` | Answering from notifications is turned off. |
| 409: answered elsewhere, ended, stopped, paused | `gone` | It was no longer waiting: (the reason, and where and when it was answered). |
| 409 `changed`, `not_offered` | `changed` | Pocket couldn't match it to what the notification showed, or a setting changed. Review it here. |
| 409 `too_old` | `old` | The notification was more than 30 minutes old. Review it here. |
| 503 | `uncertain` | "Delivery of this decision is uncertain. Stop the reply and review the conversation; do not approve it again." (approvals.mjs:82) |
| No connection | `offline` | This device was offline. |

The answer applies only to the request in the address; Pocket never looks up "the newest waiting approval". The same
answer twice is accepted once (approvals.mjs:71).

## Part 4: Devices and platforms

- **Pocket can't detect what a device displays.** A phone may show one to three body lines, collapsed, bundled with
  other notifications or on the lock screen, while Allow is still reachable. Nothing in a push says how much was shown.
  That is why Allow is a per-device choice the owner proves, not something Pocket infers from the browser or the push
  service.
- **Allow button on this device** (default Off) is stored with that device's push subscription (`push-subs.json`, beside
  its kinds, server.mjs:6093-6096). It can be turned on only from that device: **Send a test notification** pushes a
  sample in the real layout at its worst case: a "Runs: …" line and an "In: …" line that together are exactly at
  today's limit, each ending in a two-character code, then the longest context lines (a 60-character conversation
  title, an origin line and a 40-character subagent name), with both buttons (which only open Settings). The owner looks
  at it in every way the device shows notifications, then types both codes to confirm they read the end of the action
  line and the end of the folder line where the buttons are. The route takes the caller's own endpoint and the codes,
  which expire in 10 minutes. Pocket stores the limit the device was tested at. The switch can't be set any other way:
  the device preferences and subscribe routes (`cleanPushPrefs`, server.mjs:414; `/api/push/subscribe`) never accept it.
- **Subscribing again turns the switch off.** `/api/push/subscribe` rebuilds the device's record from what the browser
  sends (server.mjs:6093-6094), so turning push off and on, or a browser that changes its endpoint, is a new device to
  Pocket and needs the test again. This is the safe direction; the manual says so.
- **One payload per device.** Today `pushRaw` builds one payload and sends it to every device (server.mjs:1012,
  1023-1026). Approval pushes need a payload per device, because Allow depends on the device. That change, and adding
  `approvals` to `PUSH_KINDS` (server.mjs:412), are part of the first release.
- **Raising the limit turns the switch off on every device** until each is tested again: a device proved it shows an
  action of the old length, not of the new one. Lowering it keeps the switch on.
- **What the repo says:** nothing about which browsers show notification buttons. Web push on iPhone works only from the
  installed app (docs/manual/getting-started.md:77); urgent pushes show at once on an idle Android phone
  (docs/manual/desktop-and-phone.md:250).
- **Unverified, to check on real devices before release (tests 30-32):** whether each platform shows buttons; whether a
  button works on a locked Android phone without unlocking (the owner accepts it if so, decision 4); whether `silent`
  stops sound everywhere.
- **Where buttons don't show,** a tap opens the conversation at the card, one more tap to answer.
- **Sign out** removes the device's subscription; **Sign out everywhere** removes all (server.mjs:3001, 3017).

## Part 5: Unattended replies

Every turn records its origin and root origin (automation.mjs:14-15). The root decides:

| Reply | Allow on the notification |
|---|---|
| The owner's own, in a conversation no job has run in (a queued row, a retry, or a coordination wake of an owner's reply) | As in Parts 1 and 2. |
| A check-back's (root `checkback`) | While **Allow on a check-back's actions** is on (default on, decision 2). |
| A job's (root `job`), **and every later reply in a conversation a job has run in**, the owner's own included | Only with **Allow on a job's actions** on (default off); otherwise Don't allow only. |

- **A coordination wake carries the root of the reply that was waiting** (server.mjs:5397, 5441): an owner's wait wakes
  as the owner's, a job's as the job's.
- **Why a job is different.** A job's data (an emailed alert, a pager message) can steer the agent into proposing a
  command made to look harmless, and that text stays in the conversation for every later reply. Pocket already marks
  such conversations for good (`jobRanIn`, server.mjs:7531, used to refuse job key proposals at 7603). By default the
  owner reviews these in the app, where the job's envelope sits above the card.
- **A branch of a job's conversation is a job's conversation.** `jobRanIn` doesn't follow branches today: a branch
  records only `branchOf`, yet it holds the job's data. For this rule the check follows the `branchOf` chain to the
  first conversation.
- **The job rule wins.** A check-back set in a conversation a job has run in follows the job row, not the check-back row.
- **Outside text reaches owner replies too.** A web page, an email or a file an agent reads can shape a command in the
  owner's own reply. The full-text rule in Part 2 is the main protection everywhere; the origin rule is a second one.
- **Checked twice:** when the push is built and again when the answer arrives (Part 3, 5a).
- **Pause all** stops every reply and so withdraws every waiting approval, with replacements. **The unattended gate**
  isn't involved: an answer starts nothing new. **Longest unattended reply** is unchanged.
- **Always Review actions** and a job key's **Ask first** are unchanged. A job run waiting on an approval reads
  `needs_you` (server.mjs:7080-7084) and returns to `working` once answered.
- **Full access** replies run without asking, with one exception. Claude Code's own safety check still asks under Full
  access for a few commands it judges dangerous (for example a delete on a wildcard path): Pocket makes an approvals
  inbox for every Claude reply whatever its mode (server.mjs:1999), and such a request becomes a card like any other.
  Trusted rules don't cover these (they apply in Review actions only, server.mjs:2042). These rare cards are the
  questions an unattended reply under Full access can still stop on, and they follow Parts 1 to 3 like any other card.
  `POCKET_ALLOW_FULL_ACCESS` is untouched.
- **The owner's direction (2026-11-27):** work the owner asked to run unattended, and a check-back, should run freely by
  default. A question is the exception, for an action that is likely to do real harm. This feature doesn't add questions.
  It makes the ones that remain quick to answer.

## Part 6: By voice (second release)

- **Where:** only in the open app, in the conversation on screen, with both **Answer approvals from notifications** (the
  install's switch) and **Answer approvals by voice** (this device) on, and voice not muted. Never from a lock screen.
- **When:** an approval arrives in the conversation on screen (`onAttention`, voice.js:519-527); it is the only thing
  waiting there (no other approval, question, Vault or document request); Part 1, Part 2's character rules and Part 5
  would offer Allow; the action and folder fit **Longest action read aloud** (120 characters); and they hold only
  letters, digits, spaces and these symbols, each read by name: `-` dash, `.` dot, `/` slash, `_` underscore, `=`
  equals, `:` colon, `,` comma, `@` at, `+` plus, `~` home. Anything else (`$`, `|`, `;`, `>`, `&`, quotes, `*`) means
  no voice Allow: these change what runs and are easy to mishear. Otherwise voice says today's line.
- **The read-back:** "It wants to run a command in home slash projects slash shop: wp cache flush, dash dash url equals
  shop dot example dot com. Say yes allow, or no." The folder is read in full. The prompt ends on "no" so the
  microphone can't take the prompt's own last word for an Allow. The card is on screen at the same time.
- **This changes the rule at voice.js:8-9** that approval prompts never reopen the microphone: after this read-back, and
  only this one, it listens once.
- **What counts, by whole words:** Allow is exactly "yes allow". A bare "allow" is not enough, because "don't allow" with
  "don't" lost becomes "allow". Don't allow is "no", "don't allow", "do not allow" or "deny". An answer with "not",
  "don't", "no", "deny", "stop" or "cancel" anywhere never allows. Anything else: "Nothing was answered. It's on
  screen." Nothing is ever sent as a message, so a spoken answer here can't also answer a Vault request.
- **The right request:** the approvals list gives each row the server's spoken text and its `shown` hash; the read-back
  fixes the id and hash, and the answer posts `via: 'voice'` with Part 3's checks (5a and 5c). If the request has gone,
  voice says "It was no longer waiting." The server can't see the device's voice switch; it is a guard on the device.
- **What is left:** speech recognition can still mishear. The two-word Allow, the negation rule, the one-request rule and
  the switches narrow this; they don't remove it.

## Part 7: Audit

- **What is written:** each `decision` row in `approval-decisions.jsonl` gains `source` (`app`, `notification` or
  `voice`), taken from `via`. A notification answer also gets `device` (the endpoint hash, `unknown` when it isn't in
  `push-subs.json`) and `pushService`, the endpoint's host. A refused notification or voice answer writes a `refused` row
  with its reason code. As today, no command, argument or file content (docs/action-approvals.md:130-135). `source` and
  `device` are what the client claimed; the record says where an answer said it came from.
- **No device names:** a subscription holds its endpoint, keys and choices only (server.mjs:6093-6096); the push
  service's host is the label ("Chrome or Android", "Apple", "Firefox").
- **Where the owner reads it:** **Answered away from the app**, a read-only item on the Usage page (see Settings). Last 7
  days: time, conversation, kind of action, Allowed, Not allowed or Refused, and where. The server log gets one line each.

## Weaknesses in the Vault notification flow that this feature would inherit (stated, not fixed here)

1. **A cut-off command next to Allow.** The Vault push cuts the command at 80 characters with no mark (server.mjs:5672),
   and `pushRaw` can cut the title and body (1012-1018), yet Allow stays. This is a security bug; Releases puts its fix
   first. Part 2 must not copy this code.
   *Fixed in 1.125.3 (2026-11-27):* a command over 80 characters or outside printable ASCII is sent marked, with a
   pointer to Pocket and Deny only, and `pushShape` (`push-text.mjs`, used by `pushRaw`) drops the `allow` action from
   any push whose title or body it cut or that holds a control, format or separator character; Deny stays.
2. **No source in the record.** A Vault answer is `by: 'owner'` wherever it came from (vault.mjs:711).
3. **Stale buttons on other devices.** The 409 keeps it safe, but the owner meets a live-looking Allow that can't work.
4. **A failure on a locked phone looks like success.** The worker closes the notification first (sw.js:77) and the
   window it opens waits for the unlock.
5. **No recent sign-in.** Any device with the 90-day cookie and a subscription can answer. The 1.39 red team asked for
   recent authentication for sensitive actions (docs/plans/review/1.39.0-vault-redteam.md:75).
6. **Behind Cloudflare Access (unverified):** after the Access session ends, the worker's fetch follows a redirect to the
   Access login and reports `offline`, not `signin`.

## Changes to Pocket's principles and docs

- **PRODUCT.md** (line 104): action approvals can be answered from a tested device's notification and by voice when the
  owner turns it on, once per request, never Always allow.
- **SECURITY.md:** a new section, "Answering action approvals away from the app": who can answer; the ASCII, length and
  device-test rules; what `shown` proves and doesn't; the job rule; that text from the web, email or a job can shape a
  command in an owner's reply too, which is why the full-text rule is the main protection; the voice limits; the
  inherited Vault weaknesses.
- **docs/action-approvals.md:** line 21 ("Push notifications contain no command or argument details") and the audit
  section (130-135).
- **Manual:** `approvals.md` (131-145, 167-175, 192-201, troubleshooting rows for each `missed` reason);
  `desktop-and-phone.md` (245-250); `settings.md` (Notifications, Voice, Features, Usage); `features.md` (440-455);
  `voice.md` (a new **Answer an approval by voice**, and the mute line); `automation.md` (593-601, **Job pushes**).

## Testing

Route tests use the existing pattern: a real `server.mjs`, a temporary data folder, the stand-in engines
(`test/fake-claude.mjs` `__APPROVAL__`, `test/fake-codex.mjs` `__CMDAPPROVAL__`, `test/fake-acp.mjs` and
`test/fake-agy.mjs` `session/request_permission`) and the push service stand-in that decrypts each payload
(test/checkback-routes.test.mjs:82). Service worker tests use the vm harness (test/review-1881-secA.test.mjs:139).

**Server**
1. Feature off: every approval push is exactly today's; a notification answer gets 404 `answers_off`.
2. On, a tested device: Claude Bash, PowerShell, WebFetch and WebSearch, a Codex command, an OpenRouter and an
   Antigravity command each push tag `approval:<id>`, kind `approvals`, urgent, the lines in Part 2's order, both buttons.
3. ACP, Don't allow only: only `allow_always` offered; text only from the title; kind not `execute`; a `rawInput` key off
   the list; a `rawInput.cwd` unlike the folder shown.
4. Codex: `additionalPermissions` not empty, a list command, `network`, `permissions`, `fileChange`: Don't allow only.
   `/bin/bash -lc 'ls -la'` shows "Runs: ls -la"; a script holding `'` shows the whole string.
5. Claude, Don't allow only: Write, Edit, Agent, Skill, ExitPlanMode, `mcp__*`; WebSearch with `allowed_domains`; Bash
   with a field off the list. Questions push as today.
6. Action and folder of exactly 80 characters get Allow; 81 don't, and the line gives the length.
7. No Allow for a line break, tab, U+202E, U+200B, a Cyrillic "а" in `curl`, an "é" in the folder, a planted API key, or
   a folder with a `..` part, or a payload `pushRaw` would cut. No push ever carries both Allow and cut or non-ASCII
   action text. The planted key's text appears nowhere in the payload.
8. A subagent name holding line breaks and "Runs: rm -rf ~", and a 200-character title with a line break, each appear on
   one labelled line after the action, cut to 40 and 60. A Codex `cwd` holding a line break: no Allow.
9. A notification Allow with the right `shown` from a device that got Allow: 200, the engine receives allow once, the
   audit row has `source: notification`, a device hash and the push host, never the command text.
10. A wrong `shown`: 409 `changed`, nothing sent, a `refused` row.
11. 409 `not_offered`: a row never pushed; a push that reached no device; a device that got Don't allow only.
12. Changed after the push, the old Allow gets 409 `not_offered`: the check-back switch, a lower limit, **Only that an
    action waits**, the engine switched off, the device's Allow button off, a job run in the conversation.
13. Past **Allow works for** (shortened by an env var): 409 `too_old`; Don't allow still works.
14. Feature on, app answers as today: Allow on a Codex `fileChange`, on a muted conversation's Bash request, and on a row
    never pushed, each 200.
15. Stop, Pause all and `control_cancel_request` each send a silent replacement, same tag, only to devices that got the
    original and not to the one that answered. App first, then the same answer from the notification: 200 `duplicate`.
16. The CLI token gets 401, another site's Origin 403, a job key 401.
17. A job's reply, and the owner's later reply in that conversation, get Don't allow only; with the setting on, Allow. A
    wake of an owner's wait is the owner's; of a job's, the job's. A check-back's title starts "Check-back: ". A branch
    of a job's conversation, and a check-back set in one, follow the job rule.
18. Four approvals: three with buttons and a summary; answering one shows the fourth and updates the summary. A muted
    conversation, and a trusted-rule allow, send none. A `canAllow: false` row never gets Allow.
19. A device with **Action approvals** off gets no approval push; with **Allow button** off, Don't allow only. Turning it
    on needs both codes from a test push to that endpoint (one code alone is refused); raising the limit turns it off
    everywhere; lowering doesn't. `/api/push/prefs` and `/api/push/subscribe` can't turn it on, and subscribing again
    turns it off. The test push holds an action line and a folder line that together are exactly at the limit.
20. **Only that an action waits** sends no conversation title, no action and no Allow.
21. Every setting saves, refuses out-of-range values, resets, takes an env preset a saved value overrides; the CLI token
    is refused on the settings route.

**Service worker**
22. Allow posts to the address built from the notification's own `session` and `request`, with its `shown` and its own
    endpoint, and never reads the approvals list.
23. Each status in Part 3's table, and an `opaqueredirect`, maps to the right `missed`; every failure shows the
    `approval-missed` notification as well as opening the page.
24. A body tap opens and posts nothing; a replacement shows silently, same tag, no actions; the test notification's
    buttons post nothing.
25. The Vault, document and due-task buttons still work.

**Browser**
26. The `missed` link shows its line above the card and moves focus to it.
27. The Features page, the test-notification and code flow, and **Answered away from the app** work.

**Voice** (second release, `test/fake-voice.mjs`)
28. One eligible approval is read back with the folder in full, ending "Say yes allow, or no."; "yes allow" posts
    `via: voice` for that id; "allow", "yes allowed" and "not yes allow" answer nothing; "no" denies.
29. Nothing is offered with two things waiting, a Vault request waiting, the install switch off, or a `$` or `|` in the
    action. A spoken answer is never sent as a message. A request withdrawn mid-read gets "It was no longer waiting".

**On real devices** (before release; results in the ledger, only verified facts in the manual). Each records whether the
whole action line and the whole folder line at the limit are visible in every view where Allow can be tapped (collapsed,
expanded, lock screen, bundled), and whether Allow works while locked.
30. Android, the installed app in Chrome. 31. iPhone, the installed app. 32. Chrome and Firefox on a computer.

**Mutation checks** (each planted bug must make the named test fail)
- M1. Remove the `shown` comparison: test 10. M2. Cut a long command and keep Allow: tests 6 and 7.
- M3. Make the worker answer the newest waiting request: test 22. M4. Accept the `allow_always` fallback: test 3.
- M5. Drop `source` from the audit row: test 9. M6. Reverse the Allow-window comparison: test 13.
- M7. Skip the re-run of `approvalPush` at answer time: test 12. M8. Apply steps 3 and 5 to app answers: test 14.
- M9. Let non-ASCII through: test 7. M10. Accept a bare "allow" by voice: test 28.
- M11. Accept the Allow switch in `cleanPushPrefs`: test 19. M12. Stop following `branchOf` for the job rule: test 17.

## Releases and rollout

1. **A patch release first:** the Vault push offers Allow only when the command fits uncut, with a mark when cut
   (Weakness 1). It is a security bug today, independent of this feature. *Done in 1.125.3 (2026-11-27).*
2. **The next minor:** Parts 1-5 and 7, `sameOrigin` on the decision route, the manual and SECURITY.md.
   *Built in 1.126.0 (2026-11-27), off by default on every install.* Server tests 1-21 and service worker tests 22-25
   are in `test/approval-push*.test.mjs`, browser tests 26-27 in `test/approval-push-live-browser.mjs`. Left: tests 30-32
   on real devices (the owner runs them on his own server after the release), and Part 6, voice.
3. **The minor after it:** Part 6, voice.

Process: CONTRIBUTING.md (branch, PR, release check, tests, browser suite, a new asset number) and a ledger entry. The
code reaches every install switched off. The owner turns it on on his own server and runs tests 30-32 on his own devices
first. Other installs (tenants, staff seats, colleagues' servers) stay off until their owners agree.

## Settings

**Where they go in 1.125.0.** Settings already has a Features list whose switches open their own pages, Notifications
and Voice pages with a **This device only** group, and a read-only Usage page (docs/manual/settings.md:37-50, 121-135,
253). The install-wide settings go on a new Features page, **Answers from notifications**; the device ones under
Notifications and Voice; the record on Usage. If settings-proposal-2026-11-24.md is approved (it isn't on this branch),
the same rows move with those pages; nothing here depends on it. A saved value wins over an env preset
(`POCKET_APPROVAL_PUSH_<KEY>`, install-wide ones only). The CLI token and job keys can't change them.

| Name as shown | Default | Range or choices | Where |
|---|---|---|---|
| Answer approvals from notifications | Off | On · Off | Features (switch and page) |
| What approval notifications show | The action | The action · Only that an action waits | That page |
| Allow works for | 30 min after the notification | 5–240 min | That page |
| Allow on a check-back's actions | On | On · Off | That page |
| Allow on a job's actions | Off | On · Off | That page; covers every reply in a conversation a job has run in |
| Engines | Claude Code, Codex, OpenRouter, Antigravity all on | Each on or off | That page, Advanced |
| Longest action with an Allow button | 80 characters | 40–240 | That page, Advanced; raising it turns every device's Allow button off |
| Notifications with buttons per conversation | 3 | 1–10 | That page, Advanced |
| Update other devices after an answer | On | On · Off | That page, Advanced |
| Action approvals | On when push is on | On · Off | Notifications → This device only |
| Allow button on this device | Off | On (after a test) · Off | Notifications → This device only |
| Answer approvals by voice | Off | On · Off | Voice → This device only |
| Longest action read aloud | 120 characters | 40–240 | Voice → This device only |

The three limits have no Off: "no limit" would allow an action of any length or age, which the rules below forbid.

## Fixed on purpose (not settings)

- **Never Always allow, and never a trusted rule, from a notification or by voice.** One tap on a lock screen must not
  grant future actions.
- **Allow only on the whole action, in printable ASCII,** never on a cut, hidden or summarised one, nor on the agent's
  description. This is the reason Allow is safe to show; as a setting it could be switched off.
- **No Allow on broad grants:** network, permissions, file changes, helpers, connectors, Codex extra permissions, ACP
  requests without an allow-once option. Each grants more than the line shows.
- **Allow needs a device the owner tested.** Pocket can't see what a screen shows.
- **One answer, one named request,** re-checked against today's settings. The server never picks the request, so a
  stale or misrouted tap can't land on another.
- **Only the owner answers,** from Pocket's own origin. Agents' tokens and job keys can't, so an agent can't approve
  itself.
- **Record before send, never retry an uncertain send** (existing): a retried Allow could run twice.
- **A body tap never answers:** opening a notification isn't a decision.
- **Don't allow is always offered** while the feature is on: denying can't run anything.
- **Nothing that looks like a secret goes into a push or is spoken:** pushes pass through outside push services.
- **Voice allows only on "yes allow", never on a negation, never with more than one thing waiting, never as a
  message:** a lost word must not turn a refusal into an Allow.
- **Muted conversations stay silent; Review actions, Full access and `POCKET_ALLOW_FULL_ACCESS` are unchanged:** this
  feature changes how the owner answers, not what needs an answer.

## Decided by the owner (2026-11-27)

The owner answered the four open questions on 2026-11-27, each as recommended. Every one is a default: the setting stays
available, so an install can choose the other way.

1. **Allow on a job's actions is off by default.** A job's notification offers Don't allow only. A job's data is outside
   text that can shape the command, and it stays in the conversation; the app, with the job's envelope above the card,
   is the safer place to review it.
2. **Allow on a check-back's actions is on by default.** The owner wrote the check-back's instruction in that
   conversation, it is the commonest unattended case, and a conversation a job has run in falls under the job rule
   anyway. The case against, which the owner accepted: a check-back reads current state (email, a web page) as freely as
   a job does, and the owner isn't watching. The full-text rule and the device test apply either way.
3. **The notification shows the action on the lock screen by default** (**The action**). Without it there is no Allow,
   and the Vault push already shows commands there.
4. **Allow from a locked phone is accepted on a device where the owner turned Allow button on,** if the device test
   shows the phone permits it. The manual must name the risk: anyone holding the phone, borrowed or stolen, can read the
   action and tap Allow without unlocking, for up to 30 minutes after a push. Pocket can't prevent it; the phone
   decides. Remedies: turn on the phone's own setting to hide notification content when locked (effect on buttons
   unverified), choose **Only that an action waits**, or, for a lost phone, **Sign out everywhere**, which removes every
   subscription at once.

Decided by the lead without asking: the button word ("Don't allow", as in the app); approval pushes as the urgent
**Action approvals** kind; the Vault cut-off fix as a patch first; connectors Don't allow only; an 80-character default;
the 30-minute window; three notifications per conversation; voice in a second release, behind both switches.

## As built in 1.126.0

Added 2026-11-27. The places where the code chose the safer reading of this spec, or says more than it does. The manual
and SECURITY.md describe the code.

- **The limit counts both labelled lines.** **Longest action with an Allow button** is compared with the length of the
  whole action line plus the whole folder line, labels included ("Runs: " and "In: " or "Conversation folder: "). With
  the default 80 and a usual folder, a command of roughly 30 characters fits. Claude's longer folder label leaves less
  room than Codex's or ACP's.
- **Only `app` and `notification` are accepted as `via`.** Anything else, `voice` included (Part 6 is not built), is
  refused with 400 `unknown_via` and a `refused` row with `source: unknown`.
- **A Codex command without its own folder gets no Allow.** When Codex sends no `cwd`, the folder line is
  "Conversation folder: <the conversation's folder>" and only Don't allow is offered.
- **An engine switched off under Engines gives Don't allow only,** not the old push.
- **The folder must be a full path that needs no cleaning** (from the security review, 2026-11-28). No Allow when the
  folder is empty, does not start with `/` (an engine's literal `~/` counts as relative; only Pocket's own shortening of
  the home folder writes `~/`), or would change when the line is cleaned (a leading, trailing or doubled space). The
  action follows the same "unchanged by cleaning" rule.
- **Each ACP engine is read from its own field only:** `command` for OpenRouter (OpenCode), `CommandLine` for
  Antigravity, with no field outside a short list for each. A request with both fields gets the fixed line "Runs: (two
  commands given; open Pocket to review it)" and no Allow; the app's card shows both under Show details. OpenCode 1.19's
  bash permission request carries `command` only (read from its binary; it was not run live), so its folder line is
  "Conversation folder:"; "In:" is used only when the request names its `cwd`.
- **Summaries and replacements are titled "Pocket Code".** The first summary sounds; later updates of it are silent.
  The summary goes to every device with **Action approvals** on.
- **Replacement wording.** "Allowed on another device at <time>" only when the Allow came from a notification; an Allow
  from the app gives "Allowed in Pocket at <time>"; Don't allow gives "Not allowed at <time>". A withdrawal gives "No
  longer waiting: the agent withdrew it"; an ended reply gives "No longer waiting: " and "Pocket was paused", "the reply
  was stopped" or "the reply ended". Each request is replaced at most once.
- **A check-back's reply has an origin line too:** "Started by a check-back". In a conversation a job has run in, the line
  is "A job has run in this conversation" whatever started the reply; the title prefix still follows the reply's own root
  ("Check-back: " or "Job: ").
- **Context lines with a secret are hidden, not left out.** A conversation title that looks like a key reads
  "Conversation: (hidden: it looks like it contains a password or key)", a subagent name "Subagent: (hidden)", and the
  summary drops the title. A folder that looks like a key gets the same note as the action and no Allow. The origin line
  is cut to 64 characters, the folder text to 240. Every line the push builds (action, folder, conversation, job name,
  subagent, summary and replacement) is checked for a key both as written and as cleaned, so an invisible character can't
  split a key that the cleaning joins. In context lines, blank-looking characters (wide spaces, the braille blank, the
  Hangul and Khmer fillers) become one space.
- **An action in characters outside printable ASCII that fits the limit** is shown with line breaks and invisible
  characters removed, with no note saying why, and Don't allow only. The length note is used only for length.
- **Fixed lines for requests that never get Allow:** "Runs: (a list of arguments; open Pocket to review it)" (a Codex
  list), "Runs: (no command given; open Pocket to review it)" (an ACP command whose text came from the title), "Uses: more
  access for this reply" (Codex `permissions`), "Uses: Read", "Uses: Search", "Uses: Web" or "Uses: Thinking" (other ACP
  kinds), "Edits: <first file> and N more".
- **A notification answer to a reply that has ended** is refused with 409 `gone` and recorded as a `refused` row. An app
  answer keeps today's 409 and writes nothing. The same holds for a refusal inside the inbox: a request no longer
  waiting or being sent (`gone`), or already answered differently (`answered`, or `answered_in_app` when the app answered
  it). A refused row that can't be written is tried once; a decision that couldn't be recorded (503) writes no refused
  row.
- **The job rule follows handoffs as well as branches:** a conversation is a job's when a job ran in it or in any
  conversation it was branched from (`branchOf`) or handed off from (`continuedFrom`), followed at most 100 steps and
  stopping at a loop.
- **Turning answers off, or muting a conversation, settles what is out.** The approval notifications already sent are
  replaced once, silently and with no buttons ("Answering from notifications was turned off. Open Pocket to review it."
  or "Notifications for this conversation were muted. …"), and a summary is replaced the same way; then nothing more is
  sent for them.
- **A malformed request id is 400 `bad_request`** before anything else, with no record.
- **Allow is checked against the device that posts.** The answer's `endpoint` must name a subscription in
  `push-subs.json`; an unknown one is `not_offered`. The audit then records `device: unknown`.
- **The device test.** Each code is two characters from 23 letters and digits that are hard to confuse. Five wrong tries
  end a test (400 `wrong_codes`, then a new test is needed). A confirm after the limit changed is refused (409
  `limit_changed`), an expired one 410 `test_expired`, a test the push service refused 502 `not_delivered`, and one on a
  server without push 409 `push_off`. The test can be sent while the feature is off. Its title is "Test: Allow this
  command?" and its buttons open **Settings → Notifications** at the code fields.
- **Raising the limit also cancels device tests in progress.** A limit raised by an env preset instead of a save leaves
  the record in place, but a device tested below today's limit offers Don't allow only and reads **Needs a new test**.
- **What the service worker reports.** 401 and a redirect are `signin`; 403 is `refused` ("Pocket refused the answer from
  the address the notification used"), since Pocket's same-origin check is what sends it and a proxy that doesn't pass
  on the public `Host` is the usual cause; 409 `answered_in_app` is `answered`. Any 404 is `off`, any 503 is
  `uncertain`, and any other status it doesn't know (400, 500) is `error` ("Pocket couldn't take the answer. Review it
  here."). The line above the card for `gone` names when and from where the request was answered when **Answered away
  from the app** has the answer. A `missed` link is acted on only within a minute of opening; a sign-in on Pocket's own
  screen restarts that minute (a Cloudflare Access sign-in starts a new page, and the line is lost). The line is read
  out once: it takes focus, has no alert role and is `aria-live="off"` inside the list's status region, and it keeps
  its place and focus when the list reloads. An unknown `missed` reason (an own-key lookup) reads as `error`.
- **The audit adds `action`** (command, page, search, edit or action) to notification decisions and refused rows. App
  decisions carry `source: app` and nothing more. **Answered away from the app** reads the last 4 MB of
  `approval-decisions.jsonl` and leaves out app answers and trusted-rule allows. The read is kept until the file's size
  or time changes. When the file is longer than that and the oldest row read is still within the 7 days, the answer
  carries `olderNotListed: true` and the page says older answers are not listed.
- **Settings are own-key lookups.** An unknown key in a save is 400; a number setting takes a JSON number only; a saved
  value that is not a number in range counts as the default.
- **The settings route** (`POST /api/approval-push/settings`) needs a JSON body from Pocket's own page, and a save writes a
  `settings` line to `automation-audit.jsonl` with the keys changed and, after a raised limit, how many devices lost
  their Allow button.
