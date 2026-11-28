<!-- manual
checked: 1.126.0
sources: context-policy.mjs, automation.mjs, job-keys.mjs, approval-push.mjs, public/automation.js, public/sw.js, cli-updates.mjs, self-update.mjs, scripts/pocket-self-update.sh, public/cli-updates.js, public/app.js, public/workspace.js, public/theme.js, public/voice.js, server.mjs, router.mjs, access.mjs, push-text.mjs
-->
# Settings

Settings holds every preference Pocket Code offers. This page lists each page of Settings, every
control on it, what it does, its default and where it is stored.

Every page says whose setting it is. **This device only** settings are kept in this browser and do
not follow you to another device. **All your devices** settings are kept on the server and apply to
everyone signed in to this Pocket. Where a page has both, the **This device only** group comes
first. Both modes use the same names, order and headings.

## Open Settings

- **Desktop:** the gear (**App settings**) at the top of the conversation rail.
- **Phone, Developer mode:** the gear (**Settings and version**) at the top of the conversation
  list.
- **Assistant mode:** the gear (**Settings**) beside **Pocket Assistant** on the home screen.
- **Conversation options → Version & updates** opens Settings at **Help & updates**.

Settings opens on a list. At the top are a **Search settings** box and the **Layout** switch
(Developer mode or Assistant mode). Below them are the pages. Choose one to open it; the back button
at the top (**All settings**) returns to the list. A feature's own page, opened from **Features**,
has a back button named **Features**. Sub-pages such as **Claude and Codex accounts**,
**Connectors** and **Plan usage** have **Back to Settings**, which returns to the same page and
scroll position. Escape or Close leaves Settings.

### Search settings

Type a word or two and Pocket lists every setting on a page this mode shows whose name or
explanation matches, with the page it is on. Tap a result, or press Enter for the first, to open
that page with the setting in view, focused and outlined for a moment. At most 30 results show.
A search with no match says **No setting matches** and what you typed.

### The pages

| Page | What it holds | Developer mode | Assistant mode |
|---|---|---|---|
| [Display](#display) | How Pocket looks on this device | Everything | Everything |
| [Conversations](#conversations) | How conversations read and how they get their names | Reading, names and summaries | **Collapse steps** and **Show message times** |
| [Notifications](#notifications) | What reaches this device, and reminders by email | Everything | Everything |
| [Voice (beta)](#voice-beta) | Spoken replies and dictation on this device | Everything | Everything |
| [Accounts & sign-in](#accounts--sign-in) | Claude and Codex accounts, Gmail, Calendar and Drive, signing in and out | Everything | **Claude and Codex accounts**, **Connectors** and **Sign out** |
| [Agents](#agents-developer-mode) | Models offered, long conversations and helpers, actions that run without asking | Everything | Not shown |
| [Features](#features) | Turn parts of Pocket on or off; each opens its own page | Everything | The same switches, fewer settings behind them |
| [Unattended work](#unattended-work) | Pause all, and limits on work that runs while you are away | Everything | Everything |
| [Usage](#usage) | Plan usage, what ran without you, and limits reached. Read only | Everything | Without the Inbox Watch cost |
| [Help & updates](#help--updates) | Shortcuts, version and updates, what's new, feedback | Everything | Version and what's new |

A setting hidden in Assistant mode keeps its value and still applies. To change one Assistant mode
does not show, switch to Developer mode with **Layout** at the top of Settings, change it, and
switch back.

Settings that live on the server load when Settings opens; their switches stay disabled with a
**Loading…** note until they arrive. If loading fails, the notes say **Could not load this
setting.** and **Retry name-sync setting** loads them again.

### Where things moved in 1.124.9

| Before | Now |
|---|---|
| Appearance | [Display](#display). **Mode** moved to **Layout** at the top of Settings |
| Conversation | [Conversations](#conversations) |
| Agents & instance (Accounts in Assistant mode) | [Accounts & sign-in](#accounts--sign-in) and [Agents](#agents-developer-mode). **Plan usage** moved to [Usage](#usage). **Automatic model choice** moved to [Features](#automatic-model-choice-page) |
| Projects, files, tasks & vault (Features in Assistant mode) | [Features](#features), with a page for each feature |
| Automation | [Unattended work](#unattended-work). **Check-backs** and **Job keys** moved to [Features](#check-backs-page). The unattended replies table and **Limits reached today** moved to [Usage](#usage) |
| Notifications & voice | [Notifications](#notifications) and [Voice (beta)](#voice-beta) |

No setting was removed and no default changed. Saved values, environment presets and storage keys
are the same as before.

## Layout

At the top of the list, for all your devices.

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Developer mode** / **Assistant mode** | Developer mode shows every tool and setting. Assistant mode opens on the message box and hides the developer tools. The help under the buttons says it changes every device signed in to this Pocket. The current one is pressed. See [Getting started](getting-started.md#developer-mode-or-assistant-mode). Changes every device signed in to this Pocket | **Developer mode**, unless `POCKET_ASSISTANT_MODE` is `on`, `1`, `true` or `locked` | Server |

With `POCKET_ASSISTANT_MODE=locked`, both options are disabled and the note says Assistant mode is
kept on by the server.

## Display

This device only.

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Colour mode** | Light or dark. **System** follows your phone or computer; **Light** and **Dark** fix it. Applies at once to every Pocket window and split pane of this browser | **System**; a browser that already had Pocket preferences before colour modes existed keeps **Dark** | This browser |
| **Chat text size** | The size of conversation text on this device. **Smaller** and **Larger** step from 14 to 24 px; **Reset** returns to 17 px. Prose, headings and tables scale; controls and tool logs keep their size. A sample sentence shows the size. Also in **Conversation options** | 17 px | This browser |
| **Highlight colour** | **Orange**, **Blue** or **Purple**: the colour of the send button, links, your own messages and anything selected | **Orange** | This browser |

## Conversations

**This device only**

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Collapse steps** | Folds the steps an agent takes, like reading files or running commands, behind one summary line so the reply comes first. Tap the line to see them | On | This browser |
| **Describe steps in plain words** (Developer mode) | Writes each step as a sentence, like "Saved Proposal.pdf", with the command or path beside it. Off shows the raw tool name and detail | On | This browser |
| **Show message times** | Puts the time on each message and a date line between days | On | This browser |

**All your devices** (Developer mode)

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Short titles** | A model reads the start of each new conversation and gives it a short name. Off: a conversation is named after its first message. A name you set yourself always wins. Its status line says what is used, for example *On, using Claude · Haiku* | On, unless `POCKET_AUTO_TITLES=0` | Server |
| **Keep titles up to date** | When a conversation moves on to something new, its name is rewritten to match. Names you set yourself are never changed. Needs **Short titles** | On | Server |
| **Catch-up summary** | When you come back to a conversation that kept working, it opens at the end with a New since card: a short summary of what happened while you were away. A divider marks where the new work starts. Off keeps the **New since** marker without the summary | On | Server |
| **Model for titles and summaries** | Which model writes names and catch-up summaries: **Automatic: Claude, or Codex if Claude isn't signed in**, **Claude · Haiku** or **Codex · GPT-6-Luna**. Codex uses far more of your plan per title, about 25,000 tokens. A choice that is not signed in on the server shows **(unavailable)** | **Automatic** | Server |
| **Sync names with code-server** | Keeps conversation names the same here and in Claude Code on code-server, so a rename in either place shows in both. A rename in Pocket is written to the transcript so code-server and `claude --resume` show it too. Off: each keeps its own names, and the note says so | Off | Server |
| **Mark all reviewed button** | Adds a button to **Attention** and **New** that clears every waiting and failed reply in one tap. Off hides it on every device; **Mark as reviewed** on a single conversation works either way | On | Server |

Titles and summaries run on the signed-in CLI's own account. When Codex is the helper, the note
under the model says what that costs: about 25k tokens of your plan for each Codex call, against
about 400 for a Claude title and a few thousand for a Claude summary. When this computer's Claude
Code policy blocks the title model, Pocket uses the cheapest offered model the policy allows.

## Notifications

**This device only**

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Completion chime** | A short two-note sound when a reply finishes while Pocket is open on screen. Spoken announcements replace it when **Announce conversations** is on in Voice | On | This browser |
| **Push to this device** | Sends notifications to this phone or computer even when Pocket is closed. Turn it on separately on each device, then choose the kinds below. Off, its note names all five kinds. The bell on the conversation list does the same. **Sign out** turns it off on this browser, **Sign out everywhere** on every device | Off until you turn it on | Server, per device (`push-subs.json`) |
| **Finished replies** | A conversation finished a reply. Muted conversations never push, and neither does one open in a browser or one you stopped. Also covers question notifications, and approval notifications while **Answer approvals from notifications** is off | On when push is turned on | Server, per device |
| **Due tasks and reminders** | A task or reminder came due. **Done** and **Tomorrow** on the notification answer it without opening Pocket | On when push is turned on | Server, per device |
| **Vault requests** | An agent is waiting for you to allow a stored password or key, or to share or publish a file, with **Allow** and **Deny** (only **Deny** when the command, title or text was cut or holds unusual characters; tap it to read the request in Pocket). The *Allow a job key?* push, when a conversation asks for a [job key](automation.md#let-a-conversation-set-one-up), follows this switch too, but it has no buttons: it opens the request in Settings, where you read the whole instruction first | On when push is turned on | Server, per device |
| **Inbox alerts** | Inbox Watch, or another program on this server, flagged something that needs you. Which emails count is set in **Features › Inbox Watch** ([Push notifications](inbox-watch.md#push-notifications)) | On when push is turned on | Server, per device |
| **Check-backs and job results** | A [check-back](automation.md#check-backs) ran (*Checked back · …*) or was missed, a [job](automation.md#job-pushes) finished (titled with the job's name, with the first line of the reply), or a limit held back unattended work (the **Unattended work held** notice). Muting and per-job choices are in **Features › Check-backs** and **Features › Job keys**. Shown whether check-backs and job keys are on or off, because of that notice | On when push is turned on | Server, per device |
| **Action approvals** | An agent is waiting for you to allow a command or other action. Sent at once, only while **Answer approvals from notifications** is on in Features; otherwise these come with **Finished replies**. While it is on, a device with this off gets no approval notification at all | On when push is turned on | Server, per device |
| **Allow button on this device** | Whether this device's approval notifications may show **Allow**. Turned on only by **Send a test notification** and the two codes it shows, typed back within 10 minutes; **Turn off** turns it off. The status line says when it was tested and at what limit, or **Needs a new test** after the limit was raised. Turning **Push to this device** off and on again turns it off. Steps: [Answer from the notification](approvals.md#answer-from-the-notification) | Off | Server, per device (`push-subs.json`) |
| **Count on the app icon** | Shows how many tasks and reminders are due on the installed app's icon. Only on browsers that support it; disabled elsewhere | On | This browser, and with its push subscription |

**All your devices**

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Notice a day before** | A second notice 24 hours before a dated task or reminder comes due, sent the same way as the due one | Off | Server |
| **Email due tasks and reminders to** | Also emails each due task and reminder to this address. **Save**, then **Send a test**, which sends one test email now. Needs `POCKET_SMTP_URL` on the server; without it the field is disabled and the note says what to set | Empty | Server |

The six push kinds are disabled until **Push to this device** is on. Push needs HTTPS, the
server's `VAPID_PUBLIC` and `VAPID_PRIVATE`, and the browser's permission. Due reminders, Vault
requests, Inbox alerts and action approvals (while answers from notifications are on) are sent as urgent, which asks a
phone to show them at once (how a phone treats them while idle is up to the phone, and is unverified for action
approvals); finished replies and check-back results are sent at normal priority. Links in reminder emails use `POCKET_PUBLIC_URL`, or the address you
last signed in from.

`POCKET_SMTP_URL` is an SMTP address with its login, for example
`smtps://user:pass@smtp.example.com:465`, or `smtp://…` for a server that uses STARTTLS.
`POCKET_SMTP_FROM` is the sender; without it Pocket uses the URL's user name when that is an email
address. Pocket sends one short message per due item and nothing else.

## Voice (beta)

This device only. Active only when the voice engine is installed on the server; the status line at
the top says whether it is available, and without it every row is off. Details: [Voice](voice.md).

| Control | What it does | Default |
|---|---|---|
| **Mute voice on this device** | Nothing is spoken here: no replies, announcements or approval questions. Your choices below are kept. You can also say "mute" or tap the speaker in the message box | Off |
| **Speak replies** | When you ask something by voice, the reply is read aloud | On |
| **Spoken reply length** | How much of a reply is read aloud: **Brief** (one sentence), **Normal** (about two) or **Detailed** (all of it). The full reply is always on screen | **Normal** |
| **Review before sending** | What you say goes into the message box for you to check, instead of being sent straight away | Off |
| **Announce conversations** | Speaks up when another conversation finishes or needs you: **Off**, **Conversation name only** or **Name and a one-line summary**. Replaces the chime while Pocket is open. Muted conversations stay quiet | **Off** |
| **Hands-free: wait for my reply** | In hands-free mode, how long Pocket keeps listening for your answer before it stops: 30 seconds, 1 minute, 2 minutes or 5 minutes | 2 minutes |
| **Voice** | The voice that reads replies aloud | American female |
| **Names and terms to recognize** | Names, products and jargon the speech recognizer should expect, like customer names, separated by commas. Up to 300 characters | Empty |
| **Play a sample** | Speaks a short line in the chosen voice | |

All of these are stored in this browser (`pc-voice`).

## Accounts & sign-in

| Control | What it does |
|---|---|
| **Claude and Codex accounts** | Which Claude and Codex accounts this Pocket uses. Opens a page with the accounts, plan and sign-in method. Under Claude Code, **Switch account** (or **Sign in**) changes the server's Claude login through a sign-in link and a pasted code. Idle conversations move to the new login at once; one with a background job still running keeps the earlier login until the job ends. A message sent there waits and sends by itself on the new account when the job finishes; **Stop background jobs and send now** ends the job and sends it at once. **Stop all Claude replies** stops every running Claude reply after a second tap on **Stop replies**; the page shows how many are active. To stop every engine and hold everything automatic, use [Pause all](automation.md#pause-all). Codex sign-in is managed on the server |
| **Connectors** | Whether each agent can reach your Gmail, Calendar and Drive through its own account (claude.ai connectors for Claude Code, ChatGPT apps for Codex), with **Connect**, **Reconnect**, **Manage on claude.ai** or **chatgpt.com**, and **Refresh status** |
| **Sign in with Cloudflare Access** (Developer mode) | If Pocket sits behind Cloudflare Access, your Access login can sign you in to Pocket too, so you do not type Pocket's password as well. Pocket checks Cloudflare's signature, the application and your email. The sign-in lasts a day at most. See below |
| **Sign out** | Signs this browser out and stops its notifications. See below |

The accounts, connectors and Access settings are the server's, for the whole install. **Sign out**
acts on browsers.

**Sign in with Cloudflare Access** controls: **Team name** (the part before
`.cloudflareaccess.com`), **Application audience (AUD) tag** (the tag that identifies Pocket's
Access application, shown on its page in Cloudflare Zero Trust) and **Who may sign in this way**
(email addresses, separated by commas, up to 50; anyone else still uses Pocket's password), then
**Save**. **Turn off** goes back to Pocket's password; browsers already signed in stay signed in for
up to a day. **Use the server's values** appears when `POCKET_ACCESS_TEAM`, `POCKET_ACCESS_AUD` or
`POCKET_ACCESS_EMAILS` are set and a choice is saved here. The status line shows who can sign in and
the last Access sign-in.

**Sign out** (1.118). **Sign out** signs this browser out and turns off its notifications. **Sign
out everywhere** asks first, then signs out every browser and phone, this one included, and turns
off notifications on all of them; use it for a lost phone or a shared computer. Turn **Push to this
device** on again on the ones you keep. Conversations and replies in progress carry on. Changing
`POCKET_PASSWORD` and restarting signs every browser out too. With **Sign in with Cloudflare
Access** on, a signed-out browser is let back in by Cloudflare Access, so revoke Access sessions in
Cloudflare as well. If the sign-in runs out while a sheet is open (another device signed out
everywhere, or the password changed), **Sign in again** covers the sheet; after **Unlock** the sheet
is still there with what you typed, and you save again.

## Agents (Developer mode)

Not shown in Assistant mode. Everything here is for all your devices.

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Models offered in the picker** | Which Claude models people can pick when starting a conversation. Tap a model to offer it or stop offering it, on every device. At least one stays on. A model blocked by this computer's Claude Code managed settings is marked and cannot be turned on. **Use the server's list** goes back to the list set on the server | Every Claude model, or the list in `POCKET_CLAUDE_MODELS` | Server |
| **Long conversations and helpers** | Every reply re-reads the whole conversation, so long conversations use the most of your plan. A token is about three quarters of a word. Four controls, below | See below | Server |
| **Actions that run without asking** | In **Review actions**, an agent asks before each action. The actions listed here run without asking. See below | None, unless `POCKET_TRUSTED_ACTIONS` lists some | Server |

**Long conversations and helpers** (1.92) applies to Claude Code and Codex conversations from their
next reply: idle ones restart when you save, and one running a background job keeps its earlier
setting until it is replaced. OpenRouter conversations keep their own behavior for now.

- **Compact conversations:** when the older part of a conversation is replaced by a summary to save
  room. *When the agent decides* (the default) leaves it to the agent; *Before 150K* to *600K tokens* makes it
  happen at that size.
- **Offer a handoff:** *Off* or *After 150K* to *400K tokens* (200K unless you change it). Past that
  size Pocket suggests [handing off](conversation.md#hand-off-to-a-fresh-conversation) under the
  latest finished reply, with a short briefing, and the context ring turns amber. Off: never
  offered. When **Compact conversations** is set at or below that size, the offer comes at three
  quarters of the compaction size instead, so it shows before the summary.
- **Helper model:** helpers (subagents) are extra agents a conversation starts for side jobs like
  searching. *The agent's own choice* (the default), or *One tier below the conversation's model* (Fable or Mythos
  conversations run Opus helpers, Opus runs Sonnet, GPT Astra runs the newest GPT Sol; other models
  keep the agent's choice, and a conversation can still name a model for one helper).
- **Helper effort:** how much thinking helpers do before answering: the agent's own, or low, medium
  or high (default: the agent's own). Higher is more thorough and uses more of your plan.

A conversation in a project's [Conductor mode](projects.md#conductor-mode) runs its helpers one tier
down and is offered a handoff at 150K tokens (or sooner, when the offer here is lower), whatever is
set here. How each agent receives it: [the spec](../context-policy-spec.md).

**Actions that run without asking.** Claude Code, Codex, OpenRouter and Antigravity run read-only
actions without an approval card in **Review actions** (Codex and OpenRouter since 1.87,
Antigravity since 1.120, for commands). A listed command runs with any arguments, so list only
commands that cannot change anything. Edits and file writes always ask. **Add an action** takes a
rule, then **Add**; **Remove** takes one off:

- `Bash(git status:*)` for a command with any arguments
- `Bash(exact command)` for one exact command
- `mcp__server__tool` or `mcp__server__*` for a connector's tools
- `WebSearch`

Claude Code uses every rule. Codex, OpenRouter and Antigravity use the command rules. **Use the
server's list** goes back to `POCKET_TRUSTED_ACTIONS`. A list saved in Settings wins over the
environment variable until you choose **Use the server's list**. Rule syntax and matching:
[action approvals](../action-approvals.md#actions-that-run-without-asking).

## Features

For all your devices. Turn parts of Pocket on or off. Each feature has its switch in this list, and
a **›** beside it that opens the feature's own page. The switches apply to the whole install.

| Feature | What it is | Its page (**›**) |
|---|---|---|
| **Projects** | Tracked [projects](projects.md) with a summary, next steps, a checklist and reminders, kept current by your agent conversations | [Projects page](#projects-page) |
| **Files** | A library of the reports, PDFs, sheets and pages your agents make. Private unless you share them. See [Files](files.md) | [Files page](#files-page) |
| **Tasks** | A [to-do list](tasks.md) you and your agents add to, with due dates and reminders | [Tasks page](#tasks-page) |
| **Inbox Watch** | Watches your email, alerts you to what needs you, and sends a morning digest and look-aheads. See [Inbox Watch](inbox-watch.md) | The Inbox Watch sheet, [below](#inbox-watch-sheet) |
| **Vault** | Keeps passwords, API keys and logins encrypted. Agents use them by name without seeing them. See the [Vault](vault.md) | [Vault page](#vault-page) |
| **Check-backs** | A conversation can check back later: it takes one more turn at the time you asked for and tells you the result | [Check-backs page](#check-backs-page) |
| **Job keys** | Lets a script or program on this server start a conversation. You make a key with a fixed instruction, folder and model; the program sends the data to work on | [Job keys page](#job-keys-page) |
| **Answer approvals from notifications** | Answer an agent's action approval from its notification, without opening Pocket. **Allow** appears only on a device you tested, only for a short action in plain characters, once per request, and never as Always allow. See [Answer from the notification](approvals.md#answer-from-the-notification) | [Answers from notifications page](#answers-from-notifications-page) |
| **Coordination** (Developer mode) | Lets your conversations message each other and claim shared things, like a staging site, so two agents do not work on the same thing at once. See [Coordination](coordination.md) | A switch only |
| **Automatic model choice** | A small, fast model reads each new request you type and picks the lightest of four levels that will do it well, so quick questions do not use your strongest model. Works in Assistant mode only | [Automatic model choice page](#automatic-model-choice-page) |

All switches are Off by default and are stored on the server. **›** shows only while the feature has
something to open: the Inbox Watch **›** appears while Inbox Watch is on, and a page that shows
nothing in this mode (the Vault in Assistant mode, until its key needs restoring) has none. A
switch that is on in Assistant mode shows what it is for: *Switch on what you want to use. Each one
adds its own place beside your conversations.*

Turning Projects, Files, Tasks, Coordination, Inbox Watch, Check-backs, Job keys or the Vault on or
off also installs or removes the matching agent skill for Claude Code and Codex (unless
`POCKET_SKILLS=0`). Turning the Vault on or off restarts idle conversation processes so they get
the Vault's rules. In Assistant mode, turning a feature on or off closes Settings, because the rail
and the home screen redraw; open **Features** again for the next one.

When Assistant mode is locked (`POCKET_ASSISTANT_MODE=locked`), the switches the server keeps are
replaced by one line and no switches, for example *Projects and Tasks are on. Files, Inbox Watch and
Vault are off. To change them, ask the person who runs this install.* They change it by switching
the install to Developer mode, which means removing `locked` from `.env` and restarting.
**Check-backs**, **Job keys** and **Answer approvals from notifications** keep their switches and pages, as the first two did in Automation. A library
that is off shows *Files is off. Ask the person who runs this install to turn it on.* in place of
the pointer to Settings, with no **Open Settings** button.

### Projects page

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Open projects** (Developer mode, this device only) | Where a project opens on this device: **As a tab, like a conversation**, **Beside the conversation** or **In a new browser window** | As a tab | This browser |

### Files page

Developer mode only.

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Keep files from replies** (all your devices) | When a reply hands you a file, such as a PDF, deck, sheet or page, it is saved to Files once and linked to its conversation. Needs Files; always on in Assistant mode | Off | Server |
| **Files button** (this device only) | What the Files button in the side bar does on this device: **Lists files in the sidebar**, **Opens the library in a tab** or **Opens the library in split view** | Lists files in the sidebar | This browser |
| **Open files and links** (this device only) | Where a link to one of your files, projects or conversations opens on this device: the same three choices as **Open projects**. Links to outside websites always open in your browser | As a tab | This browser |

### Tasks page

All your devices. The two **Show** rows are about what Tasks lists from other features, and each
applies only while its feature is on.

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Default order** | The order Tasks opens in: **Due first**, **Newest added**, **Oldest added**, **A–Z** or **Workspace**. Picking an order in the list changes this too. See [Sort and search](tasks.md#sort-and-search) | **Due first** | Server (`tasksOrder`) |
| **Show check-backs in Tasks** | Lists waiting check-backs in Tasks, where you can see and cancel them | On | Server (`automation`) |
| **Show job keys in Tasks** | Adds a **Jobs** group to Tasks: each key, whether it is on, its last run and any requests waiting for you | On | Server (`automation`) |

### Inbox Watch sheet

The **›** beside **Inbox Watch** opens its existing settings sheet: the schedule, quiet hours, the
models, your rules, the digest and look-ahead. It shows while Inbox Watch is on. **Schedule** beside
the Inbox's search box opens the same sheet, as does **Inbox Watch cost** on [Usage](#usage). Three rows have new names: **Skip routine mail first**
(was First pass), **Who decides it's routine** (was Classifier) and **Skip only when at least** (was
Skip when at least). Every setting is explained in [Inbox Watch](inbox-watch.md#change-the-schedule-rules-and-models).
Pocket's own description of each row is on the sheet.

### Vault page

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Restore key…** (only when the key is missing) | The Vault's key is missing on this server. Restore it from your recovery key or file | | |
| **Default order** (Vault on) | The order the Vault's secrets open in: **Newest first**, **A–Z**, **Who can use it**, **Recently used**, **Kind** or **Expiring soonest**. Picking an order in the list changes this too. See [Find a secret](vault.md#find-a-secret) | **Newest first** | Server (`vaultOrder`) |
| **Agent access** (Developer mode, Vault on) | What happens when an agent wants a stored secret: **Free rein** uses it, **Ask once per command** has you allow each new command once, **Ask every time** has you allow every use. Each item can override this | **Ask once per command** | Server |
| **Passphrase** (Developer mode, Vault on) | Adds a passphrase you type to unlock the Vault after a restart or a lock. Without one, the Vault opens with its key alone. **Set a passphrase**, **Change passphrase**, **Remove passphrase**, **Lock now**, **Unlock…**, **Download recovery key** and **Rotate key** are here | Server key | Server |
| **Lock after** (with a passphrase) | Locks the Vault after this long without anyone using it: **Never**, 15 minutes, 1 hour, 8 hours or 24 hours. It always locks after a restart | **Never** | Server |
| **Export and import** (Developer mode, Vault on) | **Export…** and **Import…** move the whole Vault to or from one file, locked with a passphrase you choose | | |
| **Catch secrets in messages** (Developer mode) | If you paste or type a key or password into a message, Pocket holds the message and offers to store the secret in the Vault first, so it does not go to the agent. Works even while the Vault is off | On | Server |

**Download recovery key** saves the key that decrypts the Vault. Keep it somewhere safe and off this
server: if the server's key is lost, it is the only way back in. **Rotate key** re-encrypts
everything under a new key; use it if the key may have been seen, then download the new recovery
key.

### Check-backs page

Off by default; the switch is in the Features list. While it is off, the page's settings can still
be changed and read *These apply when Check-backs is on.* Under them, *N waiting* and **Cancel
all** show while the switch is on and any are waiting. Every setting, with its range, is in
[Automation](automation.md#settings); the controls are:

- **Permissions for a check-back**, **In Claude Code conversations**, **In Codex conversations** and
  **Push the result even when the conversation is muted**.
- Under **Advanced** (the defaults suit almost everyone): **Waiting per conversation**, **Waiting in
  total**, **Check-backs one can set in a row**, **Furthest ahead**, **Soonest**, **Longest note**,
  **Catch-up window after Pocket was down**, **Wait for a busy conversation** and **Spacing between
  late check-backs**.

All are stored on the server (`automation`). **Show check-backs in Tasks** is on the
[Tasks page](#tasks-page).

### Job keys page

Off by default; the switch is in the Features list. While it is off, the page shows nothing but a
note, and every call from a program is refused. While it is on it shows **Waiting for you** (the
requests conversations have made for a job key, each with **Allow**, **Edit first** and **Deny**,
only while one waits), your list of keys with **New job key**, and these settings. Every setting,
with its range, is in [Automation](automation.md#job-settings):

- What a new key starts with (each key can change its own): **Access** (**Full access** where the
  server allows it, otherwise Ask me for every action), **Job may add its own instructions**, **Runs per hour**, **Runs per day**, **Runs at once** and **Push when a job
  finishes**.
- Under **Advanced** (the defaults suit almost everyone): **Job pushes respect the conversation's
  mute**, **Most data per run**, **Longest wait a job may ask for**, **Ignore a repeated call for**
  and **Where new keys are saved**.

All are stored on the server (`automation` in `pocket-settings.json`; the keys in `job-keys.json`).
**Show job keys in Tasks** is on the [Tasks page](#tasks-page).

### Answers from notifications page

Off by default; the switch is in the Features list and again at the top of this page. While it is off, every approval
notification is as before, with no buttons, and the other settings can still be changed and read *These apply when
Answer approvals from notifications is on.* How it works, the device test and what a notification shows:
[Answer from the notification](approvals.md#answer-from-the-notification). Each device's **Allow button on this device**
is in [Notifications](#notifications), under **This device only**.

| Setting | What it does | Default | Range or choices |
|---|---|---|---|
| **Answer approvals from notifications** | Off: approval notifications are as before, with no buttons, and an answer from a notification is refused. Turning it off replaces the approval notifications already out, silently, with ones that have no buttons | Off | On or off |
| **What approval notifications show** | **The action** shows the action, its folder and the conversation. **Only that an action waits** shows no conversation and no action, and offers **Don't allow** only | The action | The action, Only that an action waits |
| **Allow works for** | An Allow from a notification older than this many minutes is refused; review the request in Pocket instead | 30 min | 5 to 240 min |
| **Allow on a check-back's actions** | Off: a check-back's notifications offer **Don't allow** only | On | On or off |
| **Allow on a job's actions** | Covers every reply in a conversation a job has run in, yours included, in a branch of one, and in a conversation handed off from one. Off: they offer **Don't allow** only | Off | On or off |

Under **Advanced**:

| Setting | What it does | Default | Range or choices |
|---|---|---|---|
| **Longest action with an Allow button** | The action line and the folder line together, labels included. With a usual folder, 80 leaves room for a command of roughly 30 characters. Raising it turns the Allow button off on every device until each is tested again; the page says so as you type a higher number, and after saving says on how many devices | 80 characters | 40 to 240 |
| **Notifications with buttons per conversation** | More requests than this wait behind one summary notification | 3 | 1 to 10 |
| **Update other devices after an answer** | Replaces the notification on your other devices once the request is answered or withdrawn | On | On or off |
| **Engines**: **Claude Code**, **Codex**, **OpenRouter**, **Antigravity** | Allow on notifications for that agent's replies. Off: its notifications offer **Don't allow** only | All on | On or off, each |

The limits have no Off. A number setting takes a number only, and a saved value Pocket can't use (outside its range, or
not a number) counts as the default. **Reset to defaults** puts every setting back. All are stored on the server (`approvalPush` in
`pocket-settings.json`). `POCKET_APPROVAL_PUSH_<NAME>` presets each one ([below](#settings-and-environment-variables)).
If push isn't set up on the server, the page says so: no approval notification is sent until `VAPID_PUBLIC` and
`VAPID_PRIVATE` are set.

### Automatic model choice page

Developer mode only. Assistant mode shows its switch in the Features list, and nothing behind it, so
no model name is shown there. **Automatic model choice** works in Assistant mode only: someone in
Developer mode can turn it on and nothing changes until the install is in Assistant mode, and the
switch's note says so.

- **Choose the model for me** (the switch in the Features list): on or off. Off unless
  `POCKET_ROUTER` is `jev` or `openai`. It cannot be turned on without a key.
- **Decision model**: the small model that reads each request and picks its level. **TypeSafe Jev,
  through OpenRouter** (an OpenRouter key) or **OpenAI Decisions API (GPT-6 Luna)** (an OpenAI API
  key).
- **Key**: paste and **Save key**. The key is saved to `router-key` in the data directory (mode
  `0600`), never shown again, and replaces `POCKET_ROUTER_KEY` or `POCKET_ROUTER_KEY_FILE`.
  **Remove** deletes it.
- Four levels, **Quick**, **Standard**, **Careful** and **Deep**, each with a **Model** and an
  **Effort**. **Automatic** follows the newest offered model of the level's family; the line under
  each level says what it runs now. Effort is how much the model thinks before answering: higher is
  slower, more thorough and uses more of your plan, and Automatic leaves it to the model.
- **Use the server's settings** clears everything saved here.

It acts only in Assistant mode and only on requests typed from scratch; saved prompts keep their
own model. If the decision model fails, is unsure or takes longer than `POCKET_ROUTER_TIMEOUT_MS`
(default 1500 ms), the default model runs, and the note says so. The decision model is told only that the
request was typed into an AI work assistant; to tell it what routine work looks like on this install, describe the
business in `POCKET_ROUTER_CONTEXT` (a sentence or two, up to 1,000 characters, read at start). In Assistant mode
the other model control is **Try harder** under a Claude reply (see [Working in a conversation](conversation.md#try-harder-assistant-mode)).

## Unattended work

For all your devices. Work that runs while you are not watching, like check-backs, job runs, queued
messages and retries. **Pause all** stops it; the limits keep it from using up your plan. It is the
same in both modes. [Automation](automation.md) explains each setting; the Check-backs and Job keys
settings are on their [Features pages](#check-backs-page), and what ran and which limits were hit
is on [Usage](#usage).

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Pause all** / **Resume** | The first row. Stops every running reply (side chats included) and Claude's background jobs, and holds everything automatic; reads **Resume** while Pocket is paused. It is also in the **More** (**⋯**) menu beside the conversation list and in **Switch conversation** (Ctrl/⌘ K). It cannot be hidden or turned off | Running normally | Server (`paused`) |
| **Your own messages while paused** | Whether a message you send yourself still runs while paused, with a banner reminding you, or waits until you resume | **Run, with a banner** | Server (`automation`) |
| **Also pause Inbox Watch** | Pause all also stops Inbox Watch's email checks, digests and look-aheads | On | Server (`automation`) |
| **Also stop background commands** | Pause all also stops commands that agents left running in the background. Off: they keep running, but if one starts a reply, Pocket stops it | On | Server (`automation`) |
| **On Resume, restart held retries** | When a reply hits your plan's usage limit, Pocket retries it once the limit resets. On: those retries start again when you resume. Off: they wait until you start them | On | Server (`automation`) |
| **On Resume, run late check-backs** | A check-back that came due while paused runs when you resume, if it is within the catch-up window. Off: it is marked missed | On | Server (`automation`) |
| **Ask before pausing** | Shows what will stop and asks you to confirm. Off: one tap pauses | On | Server (`automation`) |

**Limits.** A **No limit** button sits beside each number.

| Control | What it does | Default |
|---|---|---|
| **Unattended replies per day** | The most replies that can run without you in a day, counted in your time zone. Check-backs and job runs always count | 40 |
| **Longest unattended reply** | A check-back or job reply still running after this many minutes is stopped. This is the only limit that stops a reply already running | 60 min |
| **OpenRouter spend per day** | The most unattended work can spend on OpenRouter in a day, in dollars | $5 |
| **Claude plan, weekly: stop unattended work at** | Once your Claude plan's weekly usage passes this percentage, check-backs and jobs wait, so the rest is kept for you. Messages you send are never held | 80% |
| **Claude plan, 5-hour: stop unattended work at** | The same, for the 5-hour window | 90% |
| **Codex plan, weekly: stop unattended work at** and **Codex plan, 5-hour: stop unattended work at** | The same, for Codex | 80% and 90% |
| **Tell me when a limit is reached** | When a limit holds work back, tell you by push and on the Usage page (once per reason a day), or only on the Usage page | Push and Usage page |

Under **Advanced** (the defaults suit almost everyone):

| Control | What it does | Default |
|---|---|---|
| **Count my queued messages and retries toward the daily limits** | Off: work you started yourself does not use up the daily reply count or OpenRouter spend. That covers messages you queued, usage-limit retries, and a conversation woken by another conversation | Off |
| **Plan limits also hold my queued messages and retries** | Off: the plan percentages hold back only check-backs and jobs | Off |
| **Count time waiting for me toward the longest reply** | Off: time a reply spends waiting for your approval or answer does not count toward **Longest unattended reply** | Off |
| **Treat a plan reading older than this as stale** | Pocket learns your plan usage from each reply. A reading older than this many hours does not hold work back; the next reply refreshes it | 6 h |

Each group keeps its **Reset to defaults** button. A value is checked when it is saved: out of
range, it is refused with a message that names the range. While any limit is set to No limit, a
warning shows at the top of the page; one also shows while today's counts cannot be saved ([The
usage table](automation.md#the-usage-table)). A change applies to the next start, never to a reply
already running.

## Usage

Read only. It reports; nothing here can be changed.

| Item | What it shows |
|---|---|
| **Plan usage** | Your Claude and Codex 5-hour and weekly usage, and extra-usage status. Codex shows only when it is installed. It updates when a reply runs, not live. Also in **Conversation options** |
| **Unattended replies** | What ran without you: **Today**, and **Last 7 days** with replies, tokens and cost. Stored on the server (`automation-state.json`) |
| **Limits reached today** | Which limits held work back today, and when |
| **Answered away from the app** | Answers to action approvals from a notification, and answers Pocket refused, in the last 7 days, newest first: the time, the conversation, the kind of action, **Allowed**, **Not allowed** or **Refused** with the reason, and where (the push service the device uses, such as **Chrome or Android**, **Apple** or **Firefox**). Never the command. Read from `approval-decisions.jsonl`, up to its last 4 MB; when the record is longer and all of that is recent, a line says older answers from the 7 days are not listed. Shown in both modes, whether or not answers from notifications are on |
| **Inbox Watch cost** (Developer mode, Inbox Watch on) | What Inbox Watch spent each day for the last 7 days. Opens the cost table in its settings, where it also stays |

## Help & updates

No scope heading: the version rows describe this browser and the server, and the rest is reading.

- **Keyboard shortcuts** (Developer mode): every shortcut, and what your tabs and filters remember on this device.
- **About & updates**: the app version and build in this browser, the server's build and commit,
  the Claude and Codex CLI versions, and the host and its uptime. The status says **Up to date**,
  **An update is available.**, **This browser is newer than the server. Server update pending.**
  or **Could not check for updates. Try again.** **Check again** checks once more. When the
  server has a newer build, **Update available: refresh to build N** clears this browser's cached
  app and reloads.
- **What's new**: the release notes for this build.
- **Bugs & feature requests** (Developer mode): **Report a bug** and **Request a feature** open the
  project's GitHub issue forms with your version and build filled in. Security problems go through
  **Report it privately**, not a public issue.

After an update, the first load shows a toast pointing to **What's new**.

**Updates** inside **About & updates** shows Pocket Code itself and manages Claude Code and Codex.
Pocket checks once a day at 4 a.m. in the owner's time zone, including daylight saving changes.
A notice appears at the top when any of them has a newer release, for example *Pocket Code update
available. Review*.

The **Pocket Code** row shows the version this server is running and the latest published release
(GitHub's latest release, never a prerelease or draft), with links to its release notes and to the
upgrade steps in the operations guide. Normally Pocket Code is not installed from here: whoever manages the
server upgrades it, and the notice goes away once the server runs that release. Before then, a
server restart is what moves a checked-out new version into use, so the row reports the running
version, not the files on disk.

**Update from Pocket** (1.123). When the person who owns the server lets Pocket install its own
releases (`POCKET_SELF_UPDATE=1` in `.env`, then a restart), the row has an **Update to …** button
instead of the link to the upgrade steps. Pocket asks you to confirm, then does what an operator does:
it checks that the Pocket Code folder is unchanged and on `main` (or on a release), that the release is
on `main`, and that no reply is running; backs up its private data to `~/backups`; installs the release
and its packages; waits for any reply that started meanwhile to finish (up to 10 minutes; if replies keep
running it goes back and changes nothing); and restarts. The sheet shows each step. From the moment it begins the
restart until the new version runs, a message you send is not sent: it says *Pocket is restarting for its update; your
message is kept* and stays in the box for you to send again (1.124.5), so the restart cannot cut its reply short. If the restart has not happened within 90 seconds, messages send again. While Pocket restarts the page loses
contact for a moment and reconnects by itself; open conversations reconnect too. If the new version
does not start, Pocket goes back to the one it was running and says so in the row, and you can try
again; if it cannot go back either, the row says so and what to run on the server. If the update could not start at all,
the row says so within two minutes, nothing was changed, and you can try again. If the backup cannot be written (the server ran out of room, say), Pocket removes it and
changes nothing. If the new packages fail to install and the old ones cannot be put back either, the row
says so: Pocket keeps running, but run `npm ci` in its folder on the server before it next restarts. If the update
itself was stopped (the server restarted under it) after it began installing, the row says so 20 minutes later, and that
Pocket's files may have moved and its packages may be missing: run `npm ci` in its folder on the server before Pocket
restarts (1.124.5). The button is not offered when Pocket cannot restart itself (it is not running under PM2, the folder
is not a git checkout, or `flock` or GNU tar is missing from the server); the row then says why. While a reply or a side
chat is answering, or a Claude Code or Codex update check or upgrade runs, the button is still shown, but after you
confirm nothing changes and the sheet says why, for example *Replies are running. Update when they finish, so the
restart does not cut them short.* It needs at least 5 GB free on the server for the backup, and `flock` and GNU tar on the server (on a Mac, from Homebrew); the row says which is missing.

For Claude Code and Codex, the review shows installed and available versions and links to the
publisher's release notes. Choose either CLI or both, then **Upgrade selected**.
**Later** closes the review; the notice remains. **Check now** checks immediately.

Upgrades continue on the server when you close the browser. Pocket downloads the exact selected
release into a separate installation and tests its version and startup protocol before selecting it.
These checks send no model prompts and do not test every connector or conversation. Active work
keeps its current process. Existing conversations switch on their next turn once no work is pending;
Claude background jobs prevent the switch. The review and notice show how many conversations
still use an earlier installation, separately for Claude Code and Codex. The review names each
conversation and says whether it is idle or working. **Switch now** releases an idle old process;
its next turn starts on the selected CLI. **Stop work & switch** interrupts a working conversation,
so its current reply can be incomplete; Pocket asks before stopping it. The next turn opens the
selected CLI. A Pocket service restart keeps existing CLI processes and is not needed for this.
Side chats keep their process until closed; new side chats use the selected CLI.

The result shows success, failure, or interruption. If one CLI succeeds and the other fails, it lists
the completed upgrade. Failed candidates are not selected. **Restore [version]** tests and selects
the previous installation; it does not undo conversation history. A server restart during installation
stops the job and offers a retry instead of automatically continuing. If activation had already been
saved, the selected version stays selected and the interrupted result says to check it before retrying.

An explicit server binary override remains managed outside Pocket. The server can turn off the CLI
part with `POCKET_CLI_UPDATES=0` and the Pocket Code release check with `POCKET_UPDATE_CHECK=0`.
No overnight push notification is sent.


## Where preferences live

**This browser** keeps its choices in the browser's local storage, shared by every Pocket tab,
window and split pane of that browser and not by other devices. Clearing the site's data resets
them.

| Preference | Local storage key |
|---|---|
| Colour mode, highlight colour | `pc-theme`, `pc-accent` |
| Chat text size | `pc-chat-text-size` |
| Collapse steps, plain-word steps, message times | `pc-tools-collapsed`, `pc-plain-steps`, `pc-times` |
| Completion chime, icon count | `pc-chime`, `pc-icon-badge` |
| Open projects, Files button, Open files and links | `pc-projects-open`, `pc-files-button`, `pc-documents-open` |
| Voice preferences and mute | `pc-voice` |
| Each agent's last model and effort, and the **Recent** list in the [model panel](sessions.md#choose-agent-model-effort-permissions-and-mode) | `pc-engine-pick-<agent>`, `pc-recent-picks` |

Drafts, open tabs, split layout, filters, hidden conversations and per-conversation composer
choices are also kept per browser.

**The server** keeps instance-wide settings in the data directory, `POCKET_DATA_DIR`, which
defaults to the Pocket Code directory:

| File | What it holds |
|---|---|
| `pocket-settings.json` | Every setting marked **Server** above, including whether Pocket is paused and the values you saved under Unattended work, Check-backs, Job keys and Answers from notifications, plus two values Pocket learns: your browser's time zone and the public address you sign in through |
| `automation-state.json`, `automation-audit.jsonl` | The day's counts and limit notices, and a line for each pause, resume, settings change, check-back event, job event and unattended reply (never message text) |
| `checkbacks.json` | The check-backs: each one's conversation, note, time and state, for the cards, the list and Tasks |
| `job-keys.json` | The job keys (a hash of each key, never the key), their recent runs and the requests from conversations, with their whole instruction. Mode `0600` |
| `push-subs.json` | One entry per device with push on, with its choice of kinds and icon count, and, once the device passed the test, the limit it was tested at and when (**Allow button on this device**). A subscription the push service reports as gone is removed |
| `approval-decisions.jsonl` | Every approval request and decision, and since 1.126.0 where each answer said it came from; **Answered away from the app** reads it. Never a command ([Questions and approvals](approvals.md#records)) |
| `router-key` | The key saved under **Automatic model choice** (mode `0600`) |
| `auth-state.json` | The sign-in generation that **Sign out everywhere** moves on, and a keyed hash of the password (mode `0600`, 1.118). Never the password itself |
| `mutes.json`, `session-meta.json` | Per-conversation mutes, and pins and names (not part of Settings, the same on every device) |

The Vault's key is saved in `.env` in the Pocket Code directory, not in the data directory.
Settings and its files survive an upgrade. The full state inventory and backup notes are in
[operations](../operations.md#state-and-backups).

## Settings and environment variables

Several settings have an environment variable in `.env` that provisions an install before anyone
opens Settings. The rule for each pair:

| Setting | Variable | Which wins |
|---|---|---|
| **Layout** | `POCKET_ASSISTANT_MODE` | `on` sets the starting value; Settings wins after. `locked` always wins |
| **Short titles** | `POCKET_AUTO_TITLES` | Starting value only |
| **Model for titles and summaries** | `POCKET_TITLE_CLAUDE_MODEL`, `POCKET_TITLE_CODEX_MODEL` | The variables choose which model each option runs |
| **Keep titles up to date** | `POCKET_LIVE_TITLE_GAP_MS` | The variable sets the minimum time between checks |
| **Models offered in the picker** | `POCKET_CLAUDE_MODELS` | Settings, once a list is saved |
| **Actions that run without asking** | `POCKET_TRUSTED_ACTIONS` | Settings, once a list is saved (even an empty one) |
| **Automatic model choice** | `POCKET_ROUTER`, `POCKET_ROUTER_KEY`, `POCKET_ROUTER_KEY_FILE`, `POCKET_ROUTER_TIMEOUT_MS`, `POCKET_ROUTER_CONTEXT` | Settings, for each part saved there; the timeout and the business description are set only by the variables |
| **Sign in with Cloudflare Access** | `POCKET_ACCESS_TEAM`, `POCKET_ACCESS_AUD`, `POCKET_ACCESS_EMAILS` | Settings, until **Use the server's values** |
| **Push to this device** | `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_CONTACT` | Push is off without the keys |
| **Email due tasks and reminders to** | `POCKET_SMTP_URL`, `POCKET_SMTP_FROM`, `POCKET_PUBLIC_URL` | The field is disabled without `POCKET_SMTP_URL` |
| **Vault** | `POCKET_VAULT_KEY` | Created by the switch; set by hand only when there is no `.env` |
| **Voice (beta)** | `POCKET_VOICE=off` | Turns voice off on the server |
| **Unattended work**, **Check-backs** and **Job keys** | `POCKET_AUTOMATION_<NAME>`, for example `POCKET_AUTOMATION_WEEKLY_CEILING=60` | Settings, for each value saved there; the variable presets the default for the install. The names are in [Automation](automation.md#presets-for-an-install) |
| **Answers from notifications** | `POCKET_APPROVAL_PUSH_ANSWERS`, `_SHOW` (`action` or `waits`), `_ALLOW_FOR`, `_CHECKBACKS`, `_JOBS`, `_ENGINE_CLAUDE`, `_ENGINE_CODEX`, `_ENGINE_OPENROUTER`, `_ENGINE_ANTIGRAVITY`, `_LONGEST_ACTION`, `_PER_CONVERSATION`, `_UPDATE_OTHERS`, each after `POCKET_APPROVAL_PUSH` | Settings, for each value saved there. A bad value is ignored and named on the page. The device rows have no variable |

A change to `.env` takes effect after a restart from the Pocket Code directory
(`pm2 restart ecosystem.config.cjs`). The other variables are in the README's
[Configuration](../../README.md#configuration) table.

## For agents

- Settings are the owner's. `GET` and `POST /api/settings` need the owner's browser sign-in
  (password or the Cloudflare Access sign-in); the loopback token the agent commands use is not accepted there. Tell the user the exact path to
  change, for example **Settings → Notifications → Notice a day before**, rather than
  trying to change it.
- Pause, Resume and the **Unattended work** settings, check-backs and job keys included, are the owner's too, and no agent can use them: the
  routes take only the owner's sign-in. Don't try to raise a limit, lift a pause or make a job key. Tell the user to open
  **Settings → Unattended work** (or **Settings → Features → Check-backs** or **Job keys**). The one thing an agent may do there is ask for a job key with `pocket-jobkey`; only the
  owner's Allow makes it ([For agents](for-agents.md#propose-a-job-key)).
- **Answers from notifications** and the device test are the owner's too: the routes take only the owner's sign-in from
  Pocket's own page, and a device's Allow button turns on only from that device's test notification. No agent can
  answer an approval, its own included.
- Do not edit `pocket-settings.json` while Pocket runs. The daemon reads it at start and rewrites
  the whole file on the next save, so a hand edit is lost.
- When a feature command answers that the feature is off, pass on the message, which names
  **Settings → Features**. When the mode is locked the user has to ask the person who runs the
  install.
- To provision an install before first use (models, trusted actions, Assistant mode, Cloudflare Access sign-in),
  add the variables above to `.env` only when the user asks, then restart.
- Per-browser preferences cannot be set from the server.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server switches stay disabled with **Loading…**, or **Could not load this setting.** | The settings request failed or timed out | **Retry name-sync setting**, or reopen Settings; check the daemon is running |
| **Short titles** says it is on but no signed-in Claude Code or Codex can make titles | Neither CLI is installed and signed in on the server | Sign in under **Accounts & sign-in → Claude and Codex accounts**, or choose the other model |
| **Push not configured on server** | `VAPID_PUBLIC` and `VAPID_PRIVATE` are not set | Add them (re-running `pocket-init` adds missing keys) and restart |
| **Notifications blocked. Allow notifications in this site's browser settings.** | The browser's permission is off | Allow notifications for the site, then turn **Push to this device** on |
| **Count on the app icon** is disabled | The browser has no app-badge support | Use the installed app on a platform that shows icon counts |
| The email field is disabled | `POCKET_SMTP_URL` is not set, or the note shows **Email cannot be set up:** with the reason | Set `POCKET_SMTP_URL` (and `POCKET_SMTP_FROM`) in `.env` and restart |
| **Pocket could not save the change, so nothing changed.** | Pocket could not write `pocket-settings.json` (a full disk, or a data folder it can't write). Since 1.124.2 the change is not kept; before, it showed until the next restart and was then lost. The time zone and the public address Pocket learns are not kept either, and are tried again on the next page load. Since 1.124.3 neither is a key saved under **Automatic model choice** with the change | Free space or fix the data folder's permissions, then change it again |
| Every **Server** setting is back to its default after a restart, and the server log says `pocket-settings.json could not be read` | `pocket-settings.json` did not hold valid JSON when Pocket started (a hand edit, or a file damaged by a power cut). Since 1.124.3 Pocket keeps it beside the original as `pocket-settings.json.corrupt-<time>`, says so in the log, and starts with the defaults | Stop Pocket, fix the kept copy (or take the file from your backup), move it back to `pocket-settings.json`, then start Pocket. Settings changed since then are replaced by the old file |
| **Add a key first: automatic model choice needs one.** | **Choose the model for me** was turned on with no key saved or in the environment | Save a key, then turn it on |
| **Keep at least one model on** | You tried to stop offering the last offered model | Offer another model first |
| A rule is refused under **Add an action** | The rule changes files, covers everything, or is not valid syntax; the reason shows under the field | Fix the rule; see [action approvals](../action-approvals.md#actions-that-run-without-asking) |
| The **Vault** switch is disabled with **This Vault's key is missing on this server** | `vault.enc` exists but its key is not in `.env` | **Restore key…** with your recovery key |
| The **Layout** options are disabled | `POCKET_ASSISTANT_MODE=locked` | Change it in `.env` and restart |
| **Features** shows a line in place of most switches | `POCKET_ASSISTANT_MODE=locked` | Ask the person who runs the install, or remove `locked` in `.env` and restart |
| A setting changed on one device does not show on another | It is a **This device only** setting | Set it on each device |
| **Allow button on this device** reads **Needs a new test** on every device | **Longest action with an Allow button** was raised | Send a test notification on each device and type its codes |
| **Send a test notification** is disabled | **Push to this device** is off | Turn push on first |
| **Automatic model choice** is on and nothing changes | It works in Assistant mode only | Switch **Layout** to Assistant mode |
| A setting is not where this page used to say | Settings was reorganized in 1.124.9 | Use **Search settings**, or see [Where things moved](#where-things-moved-in-11249) |
