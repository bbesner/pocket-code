<!-- manual
checked: 1.125.3
sources: server.mjs, public/app.js, public/workspace.js, public/sw.js, public/manifest.webmanifest, router.mjs, access.mjs, engines.mjs, codex.mjs, acp.mjs, automation.mjs, checkbacks.mjs, job-keys.mjs, vault.mjs, inbox.mjs, inbox-runner.mjs, projects.mjs, project-mode.mjs, documents.mjs, tasks.mjs, coordination.mjs, skills.mjs, approvals.mjs, trusted.mjs, sidechat.mjs, voice.mjs, usage.mjs, self-update.mjs, cli-updates.mjs, scripts/pocket-init.mjs
-->
# Feature reference

Pocket Code is a self-hosted web app, installable on a phone, that runs Claude Code, Codex, OpenRouter (through OpenCode) and Antigravity conversations on your own server. This page is the catalogue of everything it does, written so a person or an AI reviewing Pocket Code can learn each feature, how it works and where it is controlled in one read. Each feature has a short section here; the link at the end of each section goes to the full manual page.

Read "How Pocket Code works" first, then the table, then only the sections you need. The Settings map, the environment variable table and the glossary are at the end.

## How Pocket Code works

**The server.** One Node.js process, `server.mjs`, serves the app and its API. It listens on `127.0.0.1` (port 3610 unless `PORT` says otherwise), so an HTTPS address in front of it is required: Tailscale Serve, a Cloudflare Tunnel or a reverse proxy such as Caddy. It normally runs under PM2 as `pocket-claude`, started from `ecosystem.config.cjs`, whose `treekill: false` lets conversation processes survive a daemon restart. `install.sh` and `scripts/pocket-init.mjs` set it up and write `.env`. See [Install Pocket Code](../install.md) and [Operations](../operations.md).

**The agents.** Pocket drives the command-line tools already installed and signed in on the server. It does not call a model API itself, except for the small helper calls named below.

| Agent | How Pocket drives it | Available |
|---|---|---|
| Claude Code | One long-lived `claude` process per conversation, in stream-json mode, with `--permission-prompt-tool stdio` and `--append-system-prompt` | Always |
| Codex | One `codex app-server` per thread | When the `codex` CLI is installed (`POCKET_CODEX=0` hides it) |
| OpenRouter | `opencode acp`, with your own OpenRouter key | Only when `POCKET_ACP_ENABLE=1` and `OPENROUTER_API_KEY` are set |
| Antigravity | `agy acp`, signed in with your Google account | Only when `POCKET_AGY_ENABLE=1` |

Details and the per-agent differences are in [Claude Code, Codex, OpenRouter and Antigravity in Pocket](sessions.md#claude-code-codex-openrouter-and-antigravity-in-pocket).

**Conversations.** A conversation is one agent session (the app says conversation and reply where the CLIs say session and turn). Pocket keeps no chat database: the record is each agent's own transcript or thread store, which is why a session started in a terminal or code-server shows in the list and a conversation started in Pocket can be continued there. A process is kept between replies and closed after an hour idle (`POCKET_IDLE_CLOSE_MS`), at most 8 live at once (`POCKET_MAX_PROCESSES`), and a reply silent for 30 minutes with nothing waiting on you is stopped (`POCKET_STALL_MS`). Closing the browser or a tab never stops work. See [Sessions, transcripts and the list](sessions.md#sessions-transcripts-and-the-list) and [Processes and limits](sessions.md#processes-and-limits).

**The data directory.** Pocket's own state is a set of files in `POCKET_DATA_DIR`, which defaults to the Pocket Code checkout. They include `pocket-settings.json` (every setting marked Server), `projects.json`, `documents.json`, `tasks.json`, `coordination.json`, `checkbacks.json`, `job-keys.json`, `inbox.json`, `vault.enc`, `session-meta.json`, `saved-prompts.json`, `starts.json`, `push-subs.json`, `approval-decisions.jsonl`, `automation-audit.jsonl` and `cli-token`. The files are written atomically, and the daemon holds them in memory, so edit them only with Pocket stopped. The library files themselves live in `POCKET_DOCUMENTS_DIR`. The full inventory and what to back up are in [State and backups](../operations.md#state-and-backups).

**The browser app and the service worker.** The app is a PWA (`public/manifest.webmanifest`). Its service worker (`public/sw.js`) caches the app's own screens only, never conversations or files, so offline it opens and says **You're offline.** with **Try again**, and keeps your drafts. Drafts, tabs, split layout, filters and per-device preferences are kept in the browser (local storage), not on the server. See [Put it on your phone](getting-started.md#put-it-on-your-phone) and [Where preferences live](settings.md#where-preferences-live).

**Sign-in.** There is one owner password, `POCKET_PASSWORD`, checked at **Unlock**. A signed-in browser stays signed in for 90 days (an HMAC-signed `Secure` cookie signed with `POCKET_SECRET`). Login attempts are rate limited (20 wrong tries per address per hour). **Sign out everywhere** and a changed password end every browser's sign-in. Behind Cloudflare Access, Pocket can accept the Access sign-in instead (for at most a day). Anyone who can sign in can run commands on the server as the user Pocket runs as, so read the [security model](../../SECURITY.md#security-model) before sharing access. See [Sign in](getting-started.md#sign-in).

**Developer mode and Assistant mode.** Two faces over the same conversations, files, tasks and vault. Developer mode (the default) shows every tool and setting. Assistant mode, set with **Layout** at the top of Settings, opens on a message box ("What would you like done?"), hides the model chips, the workbench, the Agents page and Conductor mode, uses [Automatic model choice](#automatic-model-choice) and **Try harder**, and calls the installed app **Pocket Assistant**. `POCKET_ASSISTANT_MODE` sets the starting mode (`on`, `1` or `true`), or keeps Assistant mode on and out of Settings (`locked`). A setting hidden in Assistant mode keeps its value and still applies. See [Developer mode or Assistant mode](getting-started.md#developer-mode-or-assistant-mode).

**What agents are told.** When Pocket starts an agent it appends plain-language lines to the agent's instructions (suggested replies, the Complete card, and one line for each feature that is on, plus a pointer to this manual). It also installs agent skills (`pocket-projects`, `pocket-files`, `pocket-tasks`, `pocket-coord`, `pocket-inbox`, `pocket-checkback`, `pocket-jobs`, `pocket-vault` and `pocket-google`) while the matching feature is on, and the agents run `pocket-*` commands that call the daemon over loopback with a token in `cli-token`. Pocket's own secrets are removed from the agent's environment. See [The instructions Pocket appends](for-agents.md#the-instructions-pocket-appends), [The skills Pocket installs](for-agents.md#the-skills-pocket-installs) and [The commands](for-agents.md#the-commands).

**Optional features.** Projects, Files, Tasks, Inbox Watch, Vault, Check-backs, Job keys, Coordination and Automatic model choice are all off on a new install and are switched on in **Settings → Features** for the whole install. Voice is installed on the server instead of switched on.

## Features at a glance

"Both" in the Modes column means Developer and Assistant mode. "Settings location" gives the 1.124.9 Settings path.

| Feature | What it does | Default | Modes | Settings location | Details |
|---|---|---|---|---|---|
| [Starting conversations](#starting-conversations) | New conversation with workspace, saved prompts, Recent and start links | On | Both | None | [sessions.md](sessions.md#start-a-conversation) |
| [Agent, model and effort chip](#agent-model-and-effort-chip) | One chip and panel for the agent, model and effort; `/model` and `/effort` | On | Developer | **Agents** (models offered) | [sessions.md](sessions.md#choose-agent-model-effort-permissions-and-mode) |
| [Finding and organizing conversations](#finding-and-organizing-conversations) | Search, filters, pins, renames, titles, catch-up summary | On | Both | **Conversations** | [sessions.md](sessions.md#find-a-conversation) |
| [The message box](#the-message-box) | Drafts, attachments, slash commands, suggested replies, secret check | On | Both | None | [conversation.md](conversation.md#send-a-message) |
| [Results, changed files and Git](#results-changed-files-and-git) | What a reply produced and what the agent changed | On | Developer | None | [conversation.md](conversation.md#open-results-and-files-from-a-reply) |
| [Steering and the queue](#steering-and-the-queue) | Steer a running reply, or queue follow-ups | On | Both | None | [conversation.md](conversation.md#steer-a-running-reply-or-queue-a-follow-up) |
| [Side chat, Branch and Handoff](#side-chat-branch-and-handoff) | Ask aside, copy a conversation, or continue with a briefing | On | Developer | **Agents** (handoff size) | [conversation.md](conversation.md#ask-a-side-question-side-chat) |
| [Subagents and worktrees](#subagents-and-worktrees) | See helper agents and background jobs; remove stale worktrees | On | Developer | **Agents** (helper model) | [conversation.md](conversation.md#watch-subagents) |
| [Questions and approvals](#questions-and-approvals) | Answer questions, allow or deny actions, Review actions or Full access | On | Both | **Agents** (trusted actions) | [approvals.md](approvals.md) |
| [Desktop workspace and phone layout](#desktop-workspace-and-phone-layout) | Rail, tabs, split view, panel, phone sheets, shortcuts | On | Developer (workbench) | **Help & updates** (shortcuts) | [desktop-and-phone.md](desktop-and-phone.md) |
| [Projects and Conductor mode](#projects-and-conductor-mode) | Tracked project cards, reminders, top-model-led work | Off | Both (Conductor: Developer) | **Features → Projects** | [projects.md](projects.md) |
| [Files](#files) | Library of reports and documents, with sharing | Off | Both | **Features → Files** | [files.md](files.md) |
| [Tasks](#tasks) | To-dos with due times and a Start button | Off | Both | **Features → Tasks** | [tasks.md](tasks.md) |
| [Coordination](#coordination) | Holds on shared things such as staging | Off | Developer | **Features → Coordination** | [coordination.md](coordination.md) |
| [Pause all and unattended-work limits](#pause-all-and-unattended-work-limits) | Emergency stop, and caps on automatic work | Always available; limits preset | Both | **Unattended work** | [automation.md](automation.md#pause-all) |
| [Check-backs](#check-backs) | A conversation looks again later and reports | Off | Both | **Features → Check-backs** | [automation.md](automation.md#check-backs) |
| [Job keys](#job-keys) | A script on the server starts a conversation | Off | Both | **Features → Job keys** | [automation.md](automation.md#job-keys) |
| [Inbox Watch](#inbox-watch) | Watches a Gmail mailbox, keeps a list, digests and look-aheads | Off | Both | **Features → Inbox Watch** | [inbox-watch.md](inbox-watch.md) |
| [Gmail, Calendar and Drive](#gmail-calendar-and-drive) | Agents use Google through their own connectors | Available once connected | Both | **Accounts & sign-in → Connectors** | [google.md](google.md) |
| [Vault](#vault) | Encrypted credentials agents use by name | Off | Both (fewer settings in Assistant) | **Features → Vault** | [vault.md](vault.md) |
| [Voice](#voice) | Dictation, hands-free conversation, spoken replies (beta) | Off until installed | Both | **Voice (beta)** | [voice.md](voice.md) |
| [Automatic model choice](#automatic-model-choice) | A small model picks the level of model per request | Off | Assistant only | **Features → Automatic model choice** | [settings.md](settings.md#automatic-model-choice-page) |
| [Notifications](#notifications-push-email-and-reminders) | Push, chime, icon count, email and hook for reminders | Push off until turned on | Both | **Notifications** | [settings.md](settings.md#notifications) |
| [Usage](#usage) | Plan usage, what ran without you, limits reached | On | Both | **Usage** | [settings.md](settings.md#usage) |
| [Updates and self-update](#updates-and-self-update) | Release notice, Claude Code and Codex upgrades, Update from Pocket | Notice on; self-update off | Both | **Help & updates** | [settings.md](settings.md#help--updates) |
| [Sign-in and Cloudflare Access](#sign-in-and-cloudflare-access) | Owner password, sign out everywhere, Access sign-in | On | Both | **Accounts & sign-in** | [getting-started.md](getting-started.md#sign-in) |
| [Accounts](#claude-and-codex-accounts) | Which Claude and Codex accounts Pocket uses | On | Both | **Accounts & sign-in** | [settings.md](settings.md#accounts--sign-in) |
| [Display and per-device preferences](#display-and-per-device-preferences) | Colour mode, text size, highlight colour | On | Both | **Display** | [settings.md](settings.md#display) |
| [OpenRouter and Antigravity](#openrouter-and-antigravity) | Two more agents, off until the server turns them on | Off | Both | Environment variables | [sessions.md](sessions.md#openrouter-models) |

## Conversations and the composer

### Starting conversations

**What it is.** The **New conversation** screen: a message box under "What would you like done?", a setup card that names the **Workspace**, and the chips that set the first reply.

**How it works.** You pick a workspace (one of the ten most recently used folders, or any existing full path on the server), write the task and start. Saved prompts keep a task with its workspace, agent and, optionally, its model, effort and permissions (up to 50). **Recent** lists your last five starts from any device. The server remembers the saved prompts (`saved-prompts.json`). A start link (`#/start/<id>`, kept in `starts.json`, 7 days by default) opens an unsent conversation with a briefing in the box; Inbox alerts, tasks, projects and handoffs use it. `POCKET_DEFAULT_CWD` preselects a workspace and `POCKET_LOCK_CWD=1` pins every conversation to it.

**Where to control it.** No Settings page. `POCKET_DEFAULT_CWD`, `POCKET_LOCK_CWD`. The mic, the paperclip and the skill spark sit beside the box.

**Agents' interface.** `pocket-start` (hands the user a briefing as a start link). See [Hand the user a briefing with a start link](for-agents.md#hand-the-user-a-briefing-with-a-start-link).

**Limits and gotchas.** A phone path does not work: the workspace must exist on the server. A start request that was sent but not confirmed shows **Retry start** and **Discard start**. Closing the New conversation pane in split view keeps what you typed (1.124.8).

**More.** [Start a conversation](sessions.md#start-a-conversation), [Use saved prompts and Recent](sessions.md#use-saved-prompts-and-recent), [Start links](sessions.md#start-links).

### Agent, model and effort chip

**What it is.** From 1.124.9, one chip above the message box shows what the next reply will use: *Agent · Model · Effort* on New conversation (for example *Codex · GPT-6 Sol · High*) and *Model · Effort* inside a conversation. Permissions have their own chip beside it.

**How it works.** Tapping the chip opens one panel, **Agent, model and effort** on New conversation and **Model and effort** in a conversation. Every pick applies at once; **Done** closes it. The panel has up to four sections.

| Section | What it holds |
|---|---|
| **Recent** | Up to three recent agent, model and effort combinations; one tap applies it (kept in this browser as `pc-recent-picks`) |
| **Agent** | New conversation only: Claude Code, Codex and, when the server has them on, OpenRouter and Antigravity |
| **Effort** | Default, Max, X-High, High, Medium, Low (Codex adds Ultra for models that offer it; OpenRouter and Antigravity offer only the levels the model has) |
| **Model** | Default, then the models the picker offers; a **Search models** box appears above 12 models |

`/model` and `/effort` open the same panel (`/effort` focuses the effort choices). Each agent remembers its own last model and effort (`pc-engine-pick-<agent>` in the browser). Choices are saved per conversation on this browser. Only the newest version of each model family is offered, and new models appear without a Pocket update: Codex's list is read from the CLI each time the panel opens, and Pocket reads Anthropic's list once a day (`POCKET_CLAUDE_DISCOVERY=0` turns that off). A Pocket-only default can be set with `POCKET_CLAUDE_MODEL`, `POCKET_CLAUDE_EFFORT`, `POCKET_CODEX_MODEL` and `POCKET_CODEX_EFFORT`.

**Where to control it.** The chip itself. **Settings → Agents → Models offered in the picker** chooses which Claude models are offered (Developer mode only); `POCKET_CLAUDE_MODELS` presets it, and Claude Code's managed settings (`availableModels`, `deniedModels`) apply on top.

**Limits and gotchas.** Assistant mode has no chip: Automatic model choice picks the model there. On a Claude conversation, changing the model, effort or permissions between replies closes its process; the next reply starts a new one that resumes. A model the picker stopped offering runs on Default, and a toast says so.

**More.** [Choose agent, model, effort, permissions and mode](sessions.md#choose-agent-model-effort-permissions-and-mode), [Models in the picker](sessions.md#models-in-the-picker).

### Finding and organizing conversations

**What it is.** The conversation list (the home screen on a phone, the rail on a desktop) and everything that keeps it usable.

**How it works.** **Search conversations** filters by title and workspace; with three or more characters an **In conversations** section also searches inside conversations, through MemStem when it runs beside Pocket (`POCKET_MEMSTEM_URL`; `POCKET_MEMSTEM=0` turns that off), otherwise Pocket searches recent conversations itself for the exact phrase. **All**, **Active** and **Attention** are always visible; **Filters** holds Workspace, Agent, New, Pinned and Hidden. The list groups by state (**Running**, **Working in background**, **Activity elsewhere**, **Needs attention**, **Waiting**, **Recent**). Pins (with their order), your renames and generated titles are server-side and the same on every device; hiding a conversation is per browser. A reply that ends in a **Complete** card shows as Complete in the list. Titles come from a small model: **Short titles** names a conversation after its first message, **Keep titles up to date** rewrites a name when the work moves on, and **Catch-up summary** writes a "While you were away" card. Nothing in Pocket deletes a conversation.

**Where to control it.** **Settings → Conversations** (Short titles, Keep titles up to date, Catch-up summary, Model for titles and summaries, Sync names with code-server, Mark all reviewed button in Developer mode; Collapse steps, Describe steps in plain words and Show message times on this device). `POCKET_AUTO_TITLES`, `POCKET_TITLE_CLAUDE_MODEL`, `POCKET_TITLE_CODEX_MODEL` and `POCKET_LIVE_TITLE_GAP_MS` preset these.

**Limits and gotchas.** The list holds the 200 most recently updated conversations plus every pinned, running, waiting or queued one. A Codex title costs about 25,000 plan tokens against about 400 for a Claude title. Ctrl/⌘ K opens **Switch conversation** from anywhere.

**More.** [Find a conversation](sessions.md#find-a-conversation), [Pin, rename, hide and mark reviewed](sessions.md#pin-rename-hide-and-mark-reviewed), [Titles](sessions.md#titles), [How search works](sessions.md#how-search-works).

### The message box

**What it is.** The box at the bottom of a conversation and of New conversation.

**How it works.** Enter sends on a window 900 px wide or more, and Shift+Enter adds a line; on a phone only the Send button sends. Drafts are saved per conversation in the browser. Attachments (up to 10 files, 30 MB each) are uploaded to `~/pocket-uploads/<year-month>/` and the agent receives their paths. Typing `/` opens a list of commands: the CLI's own (Claude `/compact`, `/context`, `/recap`, `/init`, `/code-review`, `/security-review`, `/simplify`, `/mcp`; Codex `/compact`, `/review`, `/recap`, `/context`), Pocket's (`/btw`, `/branch`, `/handoff`, `/new`, `/model`, `/effort`, `/usage`) and installed skills. When a reply ends by asking you to choose, the options appear as buttons, with a **Recommended** tag. When an agent has finished everything, a green **Complete** card offers to close the conversation. Before a message leaves, Pocket checks it for text that looks like a credential and offers to move it into the Vault. In Assistant mode a **Try harder** button under the latest Claude reply asks for a more careful pass on a stronger model.

**Where to control it.** Per message in the box. `POCKET_CHOICES=0` stops the suggested-reply and Complete-card instructions. The secret check is **Settings → Features → Vault → Catch secrets in messages** (on by default, Developer mode).

**Agents' interface.** The suggested-replies line tells agents to end a reply with a fenced `choices` block, and the Complete card line a fenced `done` block. See [The instructions Pocket appends](for-agents.md#the-instructions-pocket-appends).

**Limits and gotchas.** Attachments go with a new message only, not with a steered or queued one. Complete is the agent's own statement; Pocket drops it when the reply also offers choices or asks a question but cannot check the work.

**More.** [Send a message](conversation.md#send-a-message), [Attach files and screenshots](conversation.md#attach-files-and-screenshots), [Use slash commands and skills](conversation.md#use-slash-commands-and-skills), [Pick a suggested reply](conversation.md#pick-a-suggested-reply), [Close a finished conversation](conversation.md#close-a-finished-conversation-the-complete-card), [The secret check on sending](conversation.md#the-secret-check-on-sending), [Try harder](conversation.md#try-harder-assistant-mode).

## Working in a conversation

### Results, changed files and Git

**What it is.** Three views of what a conversation produced.

**How it works.** **Results** lists the links and report files mentioned in the replies (latest 4,000 messages scanned, latest 200 references kept), searchable, each with **Copy link** and, with Files on, **Keep in Files**. Files a reply hands over also appear as **file cards** under it. **Changed files** lists every file the conversation edited, with before and after. **Git** shows the working tree of the repository the conversation is working in: branch, changed files (the first 250) and read-only diffs, plus a **Worktrees** section. A replies' line shows cost and time (Claude), or time and cache (Codex).

**Where to control it.** Header buttons (**Results**, **Git**, **Changed files** in Conversation options). **Settings → Features → Files → Keep files from replies** keeps files automatically (always on in Assistant mode). **Settings → Features → Files → Open files and links** chooses where links open.

**Limits and gotchas.** Files must be under the server user's home folder, outside hidden folders, and of a listed type. A mention does not prove the file was created. Git is read-only and hidden until the conversation has worked in a repository under home. Assistant mode hides these views.

**More.** [Open results and files from a reply](conversation.md#open-results-and-files-from-a-reply), [See what the agent changed](conversation.md#see-what-the-agent-changed), [See and remove worktrees](conversation.md#see-and-remove-worktrees).

### Steering and the queue

**What it is.** Two ways to talk to an agent that is already working.

**How it works.** While a reply runs, **Steer now** sends your message into the running reply (the agent sees it at its next step; a blocking question is skipped), and **After this reply** saves it in the conversation's queue (up to 10 messages, each run as its own reply, in order, with the model and permissions chosen when you queued it). **Queue** in the header manages it: edit, remove, **Run next instruction**. **Stop** ends the reply and pauses the queue. A usage-limit failure on Claude (and Codex and OpenRouter rate limits) schedules an automatic continue after the reset, plus `POCKET_RETRY_BUFFER_MS` (five minutes).

**Where to control it.** The two buttons beside the box. Steer now is the default in Developer mode; After this reply is the default in Assistant mode.

**Limits and gotchas.** OpenRouter conversations cannot be steered, and Antigravity conversations have no queue. Pause all holds every queue.

**More.** [Steer a running reply or queue a follow-up](conversation.md#steer-a-running-reply-or-queue-a-follow-up), [Manage the queue](conversation.md#manage-the-queue), [Stop a reply](conversation.md#stop-a-reply).

### Side chat, Branch and Handoff

**What it is.** Three ways to branch off a conversation without disturbing it.

**How it works.**
- **Side chat** (`/btw`, Ctrl/⌘ ;, the chip or **Conversation options → Side chat**) asks a quick question about the conversation from a copy of it; nothing is added to the conversation. It can read and search but not edit or run commands, and one side chat exists per conversation. A Claude side chat has a spend cap of $5 (`POCKET_SIDE_CHAT_BUDGET_USD`); it closes after 30 quiet minutes (`POCKET_SIDE_CHAT_IDLE_MS`); at most four are open at once (`POCKET_SIDE_CHAT_MAX`). `POCKET_SIDE_CHAT=0` turns it off.
- **Branch** starts a new saved conversation that carries on from this one with everything said so far; the original stays as it is.
- **Handoff** asks the agent to write a briefing and starts a new conversation that knows only that briefing. Past 200K tokens (150K in a Conductor conversation) Pocket suggests it under the latest reply; Pocket never hands off by itself. A handoff never has more permission than the conversation that wrote it.

**Where to control it.** The chip row above the box, **Conversation options**, or the slash commands. **Settings → Agents → Long conversations and helpers → Offer a handoff** sets the size; **Compact conversations** sets when old context is summarized.

**Limits and gotchas.** Side chat and Branch are not available on OpenRouter or Antigravity. The first side chat question reads the whole conversation, so it costs most.

**More.** [Ask a side question](conversation.md#ask-a-side-question-side-chat), [Branch into a new conversation](conversation.md#branch-into-a-new-conversation), [Hand off to a fresh conversation](conversation.md#hand-off-to-a-fresh-conversation).

### Subagents and worktrees

**What it is.** A **Subagents** button names the helper agents a conversation has started and the background jobs it left running, with each one's task, state, model and (for Claude) its own activity, refreshed every five seconds. A worktree list under the Git panel shows every worktree of the repository.

**How it works.** Worktrees are grouped **In use**, **Has work** and **Ready to remove**. **Remove folder** appears only on Ready to remove, deletes the folder and keeps the branch, and only the signed-in person can use it; each removal is logged to `worktrees-removed.jsonl`. A subagent's permission request reaches you like any other, named after the agent.

**Where to control it.** Conversation options. **Settings → Agents → Long conversations and helpers** sets the **Helper model** (the agent's own choice, or one tier below the conversation's model) and **Helper effort**.

**Limits and gotchas.** Up to 100 agents are listed. Background shell jobs are not agents. Assistant mode does not show worktrees.

**More.** [Watch subagents](conversation.md#watch-subagents), [See and remove worktrees](conversation.md#see-and-remove-worktrees).

## Questions and approvals

### Questions and approvals

**What it is.** How an agent stops and waits for you: it asks a question, or asks permission to act.

**How it works.** A question appears as a banner (**Claude has a question for you**) with the options, and the conversation reads **Needs your answer**. An approval appears as a card (**Waiting for your OK**, **Allow**, **Don't allow**, **Details**) and the conversation reads **Needs approval**. Each reply runs in one of two permission modes:
- **Review actions** (the default): the agent asks before running commands, editing files, starting subagents or using external tools. Ordinary reads run without asking. Claude runs in permission mode `default`; Codex runs in a read-only sandbox with the `untrusted` approval policy.
- **Full access**: tools run without routine prompts, with the access of the server account (`bypassPermissions` for Claude; `danger-full-access` for Codex).

Nothing is decided for you: questions and approvals do not expire and a reply waiting on one is never stopped for being quiet. If Pocket restarts, pending requests are denied and the agent can ask again. Every request and decision is written to `approval-decisions.jsonl` (identifiers, kind, a hash of the request and the decision, never commands or contents); if the record cannot be written, nothing is approved.

**Trusted actions.** The owner can list read-only actions that run without a card in Review actions: `Bash(command:*)`, `Bash(exact command)`, `mcp__server__tool`, `mcp__server__*`, `WebSearch`, `WebFetch`. Edits and file writes can never be listed. Claude uses every rule; Codex, OpenRouter and Antigravity use the command rules (see [Agents](settings.md#agents-developer-mode)). A listed command runs with any arguments, so it is a convenience, not a security boundary.

**Where to control it.** The permissions chip above the box (hidden in Assistant mode), or **Conversation options → Permissions for the next reply**. **Settings → Agents → Actions that run without asking** (Developer mode); `POCKET_TRUSTED_ACTIONS` presets the list until one is saved there. `POCKET_APPROVAL_MODE` sets the install default (`review` or `full`) and `POCKET_ALLOW_FULL_ACCESS=0` removes Full access from the API and the UI.

**Limits and gotchas.** The permission mode applies to the next reply that starts; steering does not change a running reply. A reply Pocket starts without you (a queued message, a retry, a check-back, a job) asks the same way and waits for you. At most 20 requests can wait per reply. Pocket never approves an action it cannot show in full.

**More.** [Answer a question](approvals.md#answer-a-question), [Choose Review actions or Full access](approvals.md#choose-review-actions-or-full-access), [Review an action](approvals.md#review-an-action), [Let read-only actions run without asking](approvals.md#let-read-only-actions-run-without-asking), [What happens if you don't answer](approvals.md#what-happens-if-you-dont-answer), [Replies you did not start](approvals.md#replies-you-did-not-start).

## Desktop and phone

### Desktop workspace and phone layout

**What it is.** One app that lays itself out for the screen it is on.

**How it works.**

| Width | Layout |
|---|---|
| Under 900 px | One column; panels open as sheets |
| 900 px and wider | The rail, tabs for open conversations (12 kept per browser) and split view (up to four conversations side by side, each a complete Pocket window) |
| 1280 px and wider | Results, Queue, Git and Side chat open in a panel at the right (the dock) instead of a sheet |

The rail's head switches between **Chats** and whichever of **Projects**, **Files**, **Tasks**, **Vault** and **Inbox** are on, shows counts, and holds **Filters**, **More** (Pause all and Unattended work settings), settings and **New conversation**. A tab's mark shows the state (running, working in background, needs you, unread reply, failed). On a phone, **Home** is the conversation list (in Assistant mode, the message box), with chips to each library that is on; a conversation's header, **Results**, **Queue** and **Git** open as sheets. Collapse controls (the header chevron and **Hide message settings**) give more room. Keyboard shortcuts include Ctrl/⌘ K (switch conversation), Ctrl/⌘ Shift L (new conversation), Alt [ and Alt ] (tabs), Ctrl/⌘ F (find in conversation) and Ctrl/⌘ ; (side chat).

**Where to control it.** The browser stores the arrangement (tabs, split, rail width, panel, collapsed header, filters, text size, drafts), so each device keeps its own. **Settings → Display → Chat text size**; **Settings → Help & updates → Keyboard shortcuts** (Developer mode). **Settings → Features → Projects** and **Files** choose whether a project or file opens as a tab, beside the conversation or in a new window.

**Limits and gotchas.** Each pane needs 380 px; panes that do not fit hide in place without losing a draft or stopping work. Assistant mode hides split view, tabs, Results, Queue and Git.

**More.** [The rail](desktop-and-phone.md#the-rail), [Tabs](desktop-and-phone.md#tabs), [Split view](desktop-and-phone.md#split-view), [The panel](desktop-and-phone.md#the-panel-results-queue-git-and-side-chat), [Use it on a phone](desktop-and-phone.md#use-it-on-a-phone), [Keyboard shortcuts](desktop-and-phone.md#keyboard-shortcuts).

## Optional features

### Projects and Conductor mode

**What it is.** A card for each piece of work you decide to track: where you left off, the next step, what it is waiting for, a checklist of remaining steps, reminders, notes and the conversations that worked on it. Nothing becomes a project on its own.

**How it works.** Cards live in `projects.json` (up to 200 projects, 50 linked conversations each). You track a project from the Projects list, a conversation's **Add project** chip, or **Start a project** on New conversation. A card has status Active, Waiting or Done, a summary and next step (600 characters each), steps with optional **Passes when** checks, and at most one open reminder per project and per step. **Start conversation** on a card opens a new conversation in the project's directory with a briefing already written. Due reminders are announced once by push, email and the server's hook (see [Notifications](#notifications-push-email-and-reminders)).

**Conductor mode** (Developer mode) is a switch on a card. Conversations started in, handed off within or linked to the project run with the newest top model (Fable on Claude Code, GPT Astra on Codex) as the lead at high effort, handing work to cheaper models and checking it against the card's **Done when** and step checks. **Solo** has one cheaper model do the work itself, for a small task. The lead is offered a handoff at 150K tokens and its helpers run one tier down.

**Where to control it.** **Settings → Features → Projects** (switch) and its **›** page (**Open projects**, this device only). **Settings → Notifications → Notice a day before** and **Email due tasks and reminders to**.

**Agents' interface.** `pocket-board` (skill `pocket-projects`); `track --requested` is only for an actual user request. See [Projects](projects.md#for-agents).

**Limits and gotchas.** Turning Projects off hides it, refuses `pocket-board` and stops reminders; the cards stay on disk. Conductor mode needs a top model offered on the server. Assistant mode never runs Conductor mode.

**More.** [Track a project](projects.md#track-a-project), [What a card holds](projects.md#what-a-card-holds), [Set a reminder](projects.md#set-a-reminder), [The Scheduled view](projects.md#the-scheduled-view), [Conductor mode](projects.md#conductor-mode).

### Files

**What it is.** A library of the reports, PDFs, images, spreadsheets, Markdown and HTML pages your agents make, private unless you share them. (Named Documents before 1.34; the internal names still say documents.)

**How it works.** Files are stored in `POCKET_DOCUMENTS_DIR` (default `<data dir>/documents`, mode `0600`), with records in `documents.json`. Agents add files with `pocket-docs add`; replies can also be kept automatically. Every file starts **Private**. **Share** makes an unguessable `/share/<token>` link or a public `/files/<file name>` address; only a hash of the link and the link sealed with a key from `POCKET_SECRET` are kept, so you (signed in, never an agent) can **Copy link** again later. An agent cannot share or publish: it asks, and an **Allow** or **Deny** card appears at the top of Files (an unanswered request ends after 15 minutes). **Remove** moves a file to a 30-day trash; only you can delete for good. HTML renders sandboxed with scripts off, and previews are made with Chrome, `pdftoppm` or ImageMagick when present (`POCKET_CHROME`, `POCKET_PDFTOPPM`, `POCKET_CONVERT`).

**Where to control it.** **Settings → Features → Files** and its **›** page: **Keep files from replies** (all devices), **Files button** and **Open files and links** (this device).

**Agents' interface.** `pocket-docs` (`add`, `list`, `show`, `share`, `set`, `wait`, `trash`, `restore`; no delete); skill `pocket-files`. Run from the working directory; the file must be under the server user's home.

**Limits and gotchas.** 5,000 files, 30 MB each. When Files is off nothing is served, including public and share links. Share links made before 1.124.10 keep working but cannot be shown again; neither can links made before `POCKET_SECRET` changed.

**More.** [Share a file](files.md#share-a-file), [When an agent asks to share](files.md#when-an-agent-asks-to-share), [Rename, remove and restore](files.md#rename-remove-and-restore), [Where files live](files.md#where-files-live).

### Tasks

**What it is.** To-dos kept beside your conversations: one line of text, an optional due time, the conversation it came from and an optional briefing.

**How it works.** Tasks live in `tasks.json`. You add one with **Add task**, from a conversation (with an optional summary written by the helper model), or by asking an agent. A dated task is announced once when it comes due, by push (with **Tomorrow** and **Done** actions), email and the reminder hook. **Start** opens a new conversation in the task's workspace with the task and its context already written. Times you pick are saved as exact moments in your device's zone; an agent's time without an offset is read in the owner's zone (browser, then `POCKET_TZ`, then the server).

The list can be searched and sorted (due first, newest or oldest added, A–Z, workspace), in the rail and on the full page; the order is kept for every device.

**Where to control it.** **Settings → Features → Tasks** and its **›** page (**Default order**, **Show check-backs in Tasks**, **Show job keys in Tasks**). **Settings → Notifications** for the due notices.

**Agents' interface.** `pocket-tasks` (`add`, `list`, `show`, `done`, `reopen`, `edit`, `remove`); skill `pocket-tasks`. Agents create a task only when asked or when you accept an offer.

**Limits and gotchas.** A task is up to 600 characters. When check-backs or job keys are on, read-only **Check-backs** and **Jobs** groups appear in the list.

**More.** [Add a task yourself](tasks.md#add-a-task-yourself), [When a task comes due](tasks.md#when-a-task-comes-due), [Open, start and finish a task](tasks.md#open-start-and-finish-a-task), [Due times and time zones](tasks.md#due-times-and-time-zones).

### Coordination

**What it is.** A list of holds: named claims such as `shop-staging` that say which conversation is using a shared thing, who is waiting, and what ended lately. **A hold is advice**: agents check it because their instructions say to, and nothing in Pocket enforces it.

**How it works.** Holds live in `coordination.json`. A hold lasts 60 minutes unless the agent sets a time (1 minute to 8 hours) and renews while its conversation runs. A second agent that wants the same name gets an error naming the holder, and may ask to wait; the first in line is woken once, with a labelled message, when the name is free, and has 10 minutes to claim it. A sweep every 30 seconds (`POCKET_COORD_SWEEP_MS`) renews, expires and wakes. **Release** is one tap, and the holder is told when it next runs.

**Where to control it.** **Settings → Features → Coordination** (a switch only). Developer mode only: Assistant mode hides it and `pocket-coord` answers that it is off.

**Agents' interface.** `pocket-coord` (`hold`, `wait`, `release`, `list`); skill `pocket-coord`. Pocket proves a conversation's identity from its runner token, not from what the agent says.

**Limits and gotchas.** Up to 20 waiters per name; Recent keeps 30 holds for 7 days. A terminal session can hold but cannot be woken.

**More.** [See what is held](coordination.md#see-what-is-held), [Release a hold](coordination.md#release-a-hold), [Expiry](coordination.md#expiry).

## Unattended work

### Pause all and unattended-work limits

**What it is.** Pause all is the emergency stop for everything that runs without you. The limits keep unattended work from using up your plan. Together they are **Settings → Unattended work**.

**How it works.** **Pause all** (the first row in Unattended work, the **⋯** More menu, **Switch conversation** and a voice command) stops every running reply on every agent, side chats included, and Claude's background jobs; holds usage-limit retries, check-backs and job calls; pauses Inbox Watch; and keeps queues still. Your own messages still run (with a banner) unless you chose **Blocked until you resume**. A restart keeps the pause. **Resume** re-arms held work. **Ask before pausing** shows what will stop first. It cannot be hidden or turned off.

The limits decide how much work Pocket will start unattended. A limit never cuts off a reply that is running; only **Longest unattended reply** stops one, and only a check-back's or a job's.

| Limit | Default |
|---|---|
| Unattended replies per day | 40 |
| Longest unattended reply | 60 min |
| OpenRouter spend per day | $5 |
| Claude plan, weekly / 5-hour: stop unattended work at | 80% / 90% |
| Codex plan, weekly / 5-hour: stop unattended work at | 80% / 90% |
| Stale plan reading | 6 hours |

Work that came from a check-back or a job key is always held by the limits. Work you asked for yourself (queued messages, retries, coordination wakes) is held only if you switch on **Count my queued messages and retries toward the daily limits** or **Plan limits also hold my queued messages and retries**, both off by default. A conversation says who started its newest reply (**Queued message**, **Continued after a usage limit**, **Woken by a hold**, **Started by a check-back**, **Started by job …**). Every pause, resume, settings change and unattended reply is a line in `automation-audit.jsonl` (never message text); the day's counts are in `automation-state.json`.

**Where to control it.** **Settings → Unattended work**. Preset an install with `POCKET_AUTOMATION_<NAME>` variables (for example `POCKET_AUTOMATION_WEEKLY_CEILING=60`); a value saved in Settings wins. See [Presets for an install](automation.md#presets-for-an-install).

**Agents' interface.** None: Pause, Resume and these settings take only the owner's browser sign-in, so no agent can lift a pause or raise a limit. Agents are told to say so and to give the Settings path.

**Limits and gotchas.** Antigravity needs no limit because only a message you send starts one of its replies. A bad `POCKET_AUTOMATION_*` value is ignored and named on the page.

**More.** [Pause all](automation.md#pause-all), [Limits on unattended work](automation.md#limits-on-unattended-work), [Who started a reply](automation.md#who-started-a-reply), [The audit file](automation.md#the-audit-file).

### Check-backs

**What it is.** One more reply, later, in the conversation that set it. You say "check the page in 15 minutes and tell me"; at that time Pocket starts the conversation's next reply by itself, and a push reports the result.

**How it works.** The agent runs `pocket-checkback add --at … --note …`. A pass every minute starts each due check-back, oldest first, after checking in order: is Pocket paused, is a reply running, is it too late (catch-up window, 12 hours), do the limits allow it. It is marked running and saved before anything starts, so it never runs twice. The reply runs with the permissions of the reply that set it (or **Always Review actions**), and asks for approval like any reply. A card under the setting reply shows its progress; a clock marks the conversation's row. Check-backs are stored in `checkbacks.json` (finished ones for 30 days).

**Who may set one is Pocket's rule**: only a reply you started, or a check-back's own reply (one follow-up, within **Check-backs one can set in a row**, 5 by default). A queued message, a retry, a coordination wake, a job's reply, a terminal and a side chat are refused.

**Where to control it.** **Settings → Features → Check-backs** (switch) and its **›** page (permissions, per-agent switches, push when muted, and under Advanced the limits: 10 waiting per conversation, 50 in total, 90 days ahead, 1 minute soonest, 1,000-character note, 12-hour catch-up). The push switch **Settings → Notifications → Check-backs and job results**. `POCKET_AUTOMATION_CHECKBACKS=1` and its siblings preset it; `POCKET_CHECKBACK_TICK_MS` changes the pass interval.

**Agents' interface.** `pocket-checkback` (skill `pocket-checkback`), inside a Pocket conversation only. See [Check back later](for-agents.md#check-back-later).

**Limits and gotchas.** Claude Code, any mode; Codex only under Full access; OpenRouter and Antigravity not supported. Turning a check-back switch on or off closes idle agent processes. A missed check-back is never run later.

**More.** [Check-backs](automation.md#check-backs), [How an agent sets one](automation.md#how-an-agent-sets-one), [When it runs](automation.md#when-it-runs), [Settings](automation.md#settings).

### Job keys

**What it is.** A way for a script on this server (cron, a monitor) to start a reply in a conversation you can watch. You write the instruction, folder, agent, model and access once, when you make the key; the script supplies data, never orders.

**How it works.** A key is `pjk_` plus 43 characters, shown once and stored only as a hash in `job-keys.json` (mode `0600`). The script calls `pocket-run --key-file <file> [--data-file <path> | --data -]` or the HTTP route `/api/jobs/run`. The conversation is titled with the job's name and sits under **Automated** in the list. A job reply may not set a check-back or ask for a job key, cannot change settings, and asks for approval like any reply (**Ask first** is Review actions with nobody watching, so `pocket-run` exits 3 when it needs you). A new key is **Full access** by default where the server allows it, and **Ask first** where it doesn't; the default is a setting. Each key has its own **Runs per hour** (6), **Runs per day** (24) and **Runs at once** (1); the install-wide limits and Pause all hold job work too.

A conversation can **ask** for a key (`pocket-jobkey propose`): the request waits for your **Allow**, **Edit first** or **Deny** in **Settings → Features → Job keys**, and expires after 24 hours. An agent can never make a key.

**Where to control it.** **Settings → Features → Job keys** (switch) and its **›** page (**Waiting for you**, the key list, defaults, Advanced). `POCKET_AUTOMATION_JOBS=1` and its siblings preset it. The push for a run's end follows **Settings → Notifications → Check-backs and job results**.

**Agents' interface.** `pocket-jobkey propose` (skill `pocket-jobs`); `pocket-run` is for scripts, not agents. A job's reply starts with `[cron:job-<name> …]`: the instruction is the owner's, everything in the fences is data.

**Limits and gotchas.** Claude Code, Codex and OpenRouter keys; Antigravity is not offered. When Pocket is paused a call is refused with `paused`.

**More.** [Job keys](automation.md#job-keys), [Let a conversation set one up](automation.md#let-a-conversation-set-one-up), [Call it with pocket-run](automation.md#call-it-with-pocket-run), [Job settings](automation.md#job-settings).

## Connected services

### Inbox Watch

**What it is.** A watcher that reads one Gmail mailbox on a schedule and keeps a list of the mail that is work for you, grouped into stories across threads. It sends **alerts**, a **morning digest** and twice-daily **look-aheads** into Pocket's **Inbox**, where you start a briefed conversation from an item and tell the watcher what you decided.

**How it works.** A Python program in `inbox-watch/` (Python 3.11 or newer) that Pocket runs once a minute (`inbox-runner.mjs`; `POCKET_INBOX_RUNNER=0` stops that if you run it yourself). It reads mail through the Gmail connector of Claude Code or Codex, asks a model to judge it, and posts to `inbox.json`. Setup chooses a schedule (a check every 5 minutes, quiet hours 10 PM to 8 AM, digest at 8 AM, look-aheads at 8 AM and 5 PM), a judge model, and an optional first pass that skips routine mail. Which alerts also push to your phone is set separately.

**Where to control it.** **Settings → Features → Inbox Watch** (switch) and its **›**, which opens the Inbox Watch settings sheet (schedule, quiet hours, models, rules, digest, look-ahead). **Settings → Notifications → Inbox alerts** for the push. **Settings → Unattended work → Also pause Inbox Watch**.

**Agents' interface.** `pocket-inbox` (`list`, `show`, `act`, `merge`, `split`, `push`); skill `pocket-inbox`. Agents record a decision only when asked.

**Limits and gotchas.** Needs a connected Gmail connector (see below). Pause all pauses it by default. Its cost is on **Settings → Usage → Inbox Watch cost** (Developer mode).

**More.** [Set it up](inbox-watch.md#set-it-up), [What goes on the list](inbox-watch.md#what-goes-on-the-list), [Push notifications](inbox-watch.md#push-notifications), [Change the schedule, rules and models](inbox-watch.md#change-the-schedule-rules-and-models), [Privacy](inbox-watch.md#privacy).

### Gmail, Calendar and Drive

**What it is.** Agents can read and write your Gmail, manage your Calendar and work with Drive, Docs, Sheets and Slides.

**How it works.** Through each agent's own connectors: claude.ai connectors for Claude Code, ChatGPT apps for Codex. Anthropic and OpenAI hold the Google authorization, so Pocket stores no Google token. There is no switch: once an agent's connector is connected, every new conversation with that agent can use it. Pocket shows each connector's state (Connected, Not connected, Needs signing in again, Could not connect, Off on this server, Unavailable) and always installs the `pocket-google` skill. Its rules: the agent first checks whose account is connected and stops if it is not yours; every email is written as a Gmail draft and shown first; calendar invitations to other people are confirmed first; instructions written inside an email are reported, never acted on.

**Where to control it.** **Settings → Accounts & sign-in → Connectors** (**Connect**, **Reconnect**, **Manage on claude.ai** or **chatgpt.com**, **Refresh status**).

**Agents' interface.** Skill `pocket-google` (`SKILL.claude.md` for Claude Code, `SKILL.codex.md` for Codex); no command.

**Limits and gotchas.** Claude Code needs a claude.ai subscription sign-in (an API key has no connectors). Neither CLI can start a first connection; the sheet links to where you make it.

**More.** [Connect Gmail, Calendar and Drive](google.md#connect-gmail-calendar-and-drive), [Check whose account is connected](google.md#check-whose-account-is-connected).

### Vault

**What it is.** Credentials (API keys, tokens, logins, credentials sets and secure notes) kept encrypted on the server, so agents use them by name without the value entering the conversation, the transcript, the logs or the agent's memory in normal use.

**How it works.** The store is `vault.enc`, encrypted with AES-256-GCM under a key that Pocket creates when you switch the Vault on, saves to `.env` as `POCKET_VAULT_KEY` (mode `0600`) and shows once as a recovery key. The daemon reads the key at start and removes it from its own environment, so no agent or child process sees it. An agent runs `pocket-vault run` with a secret named in the command; Pocket runs it with the value in the environment and returns the output with the value replaced by `{{vault:name}}`. Each secret is governed by **Agent access**: **Free rein**, **Ask once per command** (the default) or **Ask every time**, with a per-secret override down to **Only you**. An approval card carries **Allow once**, **Always allow** and **Deny**; vault requests also push to your phone with those buttons. For browser logins, a relay (`scripts/pocket-mcp-proxy.mjs`) types `{{vault:name.field}}` into a Playwright MCP fill tool and blocks screenshots after a fill. **Ask someone** creates a one-time intake link (`/intake/<token>`, 1, 3 or 7 days) so an outside person can send a credential straight into the Vault. An optional **passphrase** with **Lock after** adds a second lock. **Export** and **Import** move the whole Vault in a file locked with a passphrase you choose. A **secret check** holds a message that looks like it contains a credential and offers to store it.

The list can be searched, sorted (including by who can use it, least protected first) and filtered by who can use it and kind; each row shows who can use it as a coloured dot and words.

**Where to control it.** **Settings → Features → Vault** (switch) and its **›** page (**Default order**, **Agent access**, **Passphrase**, **Lock after**, **Export and import**, **Rotate key**, **Download recovery key**, **Restore key…**, **Catch secrets in messages**). Turning the Vault on or off closes idle agent processes. Intake pages are branded with `POCKET_INTAKE_ORG`, `POCKET_INTAKE_ACCENT` and `POCKET_INTAKE_LOGO`.

**Agents' interface.** `pocket-vault` (`run`, `put`, `request`, and others); skill `pocket-vault`; `{{vault:name.field}}` in browser fill tools.

**Limits and gotchas.** The Vault is not process isolation. A value filled into a browser can be read back by the agent that drives the page, a command you approve receives the real value, and agents run as the same OS user as Pocket. Keep the recovery key apart from backups: without it `vault.enc` cannot be opened. In Assistant mode the Vault page shows only **Restore key…**, when the key is missing.

**More.** [Turn it on](vault.md#turn-it-on), [Choose how freely agents use secrets](vault.md#choose-how-freely-agents-use-secrets), [Answer a request](vault.md#answer-a-request), [Browser logins](vault.md#browser-logins), [Ask someone outside for a secret](vault.md#ask-someone-outside-for-a-secret), [Security model and limits](vault.md#security-model-and-limits).

### Voice

**What it is.** Speak to a conversation and hear its reply read aloud (beta). The mic sends one spoken message; the headset starts a hands-free conversation that reads each reply and listens for your answer, and nothing reaches the agent without a spoken or tapped yes.

**How it works.** The browser records the microphone, detects when you stop speaking and sends the audio to Pocket, which passes it to a local engine (`voice/voice_server.py`: faster-whisper `small.en` for speech to text, Kokoro for text to speech) listening on `127.0.0.1` on a random port. Audio and text are processed in memory and not stored, and no speech service is used. The engine starts on the first request and stops after 15 minutes idle (`POCKET_VOICE_IDLE_MS`). Quick commands ("what's it doing", "stop", "read it", "pause everything", "mute") are answered on your device. **Announce conversations** can speak when other conversations finish or need you.

**Where to control it.** Install on the server with `bash scripts/voice-setup.sh` (about 1.5 GB, needs `python3`), then restart Pocket. **Settings → Voice (beta)** (this device only): Mute, Speak replies, Spoken reply length, Review before sending, Announce conversations, Hands-free wait, Voice, Names and terms to recognize, Play a sample. `POCKET_VOICE=off` turns it off on the server; `POCKET_VOICE_HOME` is where the engine is installed.

**Agents' interface.** None. A spoken message reaches an agent as an ordinary transcribed message.

**Limits and gotchas.** English only; one message is at most 60 seconds. Browsers allow the microphone only over HTTPS. Until the engine is installed the mic and headset buttons stay hidden.

**More.** [Set it up](voice.md#set-it-up), [Have a hands-free conversation](voice.md#have-a-hands-free-conversation), [Quick commands](voice.md#quick-commands), [Announce other conversations](voice.md#announce-other-conversations), [Mute voice on this device](voice.md#mute-voice-on-this-device).

### Automatic model choice

**What it is.** A small, fast model reads each new request you type and picks the lightest of four levels that will do it well (**Quick**, **Standard**, **Careful**, **Deep**), so quick questions do not use your strongest model.

**How it works.** A decision model, **TypeSafe Jev through OpenRouter** (`POCKET_ROUTER=jev`) or the **OpenAI Decisions API (GPT-6 Luna)** (`POCKET_ROUTER=openai`), classifies the request (`router.mjs`). Each level maps to a model and effort you can set, or leave on **Automatic**, which follows the newest offered model of that family. If the decision model fails, is unsure or takes longer than 1,500 ms (`POCKET_ROUTER_TIMEOUT_MS`), the default model runs. The decision model is told only that the request was typed into an AI work assistant; `POCKET_ROUTER_CONTEXT` (up to 1,000 characters) describes what routine work looks like on this install. The key is saved to `router-key` (mode `0600`) or read from `POCKET_ROUTER_KEY` or `POCKET_ROUTER_KEY_FILE`.

**Where to control it.** **Settings → Features → Automatic model choice** (**Choose the model for me**; it cannot be turned on without a key) and its page (Developer mode: decision model, key, the four levels, **Use the server's settings**).

**Limits and gotchas.** It acts only in Assistant mode, only for Claude Code, and only on requests typed from scratch; saved prompts keep their own model. In Assistant mode the other model control is **Try harder**.

**More.** [Automatic model choice page](settings.md#automatic-model-choice-page), [Try harder](conversation.md#try-harder-assistant-mode).

### OpenRouter and Antigravity

**What it is.** Two further agents beside Claude Code and Codex. **OpenRouter** runs models you pay for by the token through your own key (DeepSeek V4.1 Flash is the default). **Antigravity** runs Google's Antigravity CLI on your Google AI plan, with Gemini models.

**How it works.** OpenRouter needs OpenCode installed, `POCKET_ACP_ENABLE=1` and `OPENROUTER_API_KEY`; its model list is OpenRouter's live catalog of models that can use tools, split into Default, Tested and Experimental. Antigravity needs the `agy` CLI (1.5 or newer) signed in once with `agy acp --login` and `POCKET_AGY_ENABLE=1`; its models are whatever your plan lists. Each has one process per conversation, closed after 20 minutes idle (`POCKET_ACP_IDLE_MS`). Questions, approvals, trusted command rules, attachments, search, titles, Results and file cards work for both. They differ on steering, side chat, Branch, subagents, queues and unattended work (the table in [Claude Code, Codex, OpenRouter and Antigravity in Pocket](sessions.md#claude-code-codex-openrouter-and-antigravity-in-pocket)).

**Where to control it.** The server's environment (above). In the app they appear in the **Agent** section of the chip's panel.

**Limits and gotchas.** Google's documentation says wrapping `agy` in a third-party app is not supported under consumer plans; Pocket drives it for you alone, on your server, and the choice to turn it on is yours. An OpenRouter key that was revoked fails every reply with `User not found`. Use a dedicated, credit-limited key.

**More.** [OpenRouter models](sessions.md#openrouter-models), [Antigravity](sessions.md#antigravity-google-models-on-your-google-plan).

## Notifications, usage and updates

### Notifications: push, email and reminders

**What it is.** Everything that reaches you when Pocket is not on screen, and what it plays when it is.

**How it works.** Web push (VAPID keys, `VAPID_PUBLIC` and `VAPID_PRIVATE`, written by `pocket-init`) needs HTTPS and the browser's permission, and is turned on separately for each device. Subscriptions are in `push-subs.json`. There are five kinds: **Finished replies** (also covers questions and approvals), **Due tasks and reminders** (with **Tomorrow** and **Done** actions), **Vault requests** (with **Allow** and **Deny**, or only **Deny** when the command, title or text was cut or holds unusual characters; also the job-key request), **Inbox alerts**, and **Check-backs and job results**. A **Completion chime** plays when a reply finishes while Pocket is open, and **Count on the app icon** shows due tasks and reminders. Muting a conversation (its **Alerts** chip) stops its notifications, including questions and approvals. For due tasks and project reminders, **Notice a day before** adds a 24-hour notice, **Email due tasks and reminders to** adds email (through `POCKET_SMTP_URL`), and `POCKET_REMINDER_HOOK` runs a command with the reminder as JSON on standard input; each is announced once, checked every minute.

**Where to control it.** **Settings → Notifications**; the bell on the conversation list. `POCKET_PUBLIC_URL` sets the address used in email links.

**Limits and gotchas.** On iPhone and iPad web push works only from the installed app. The notification for a question or approval carries no command details. The reminder hook runs without Pocket's own secrets.

**More.** [Notifications](settings.md#notifications), [How reminders reach you](projects.md#how-reminders-reach-you), [Get notified on your phone](approvals.md#get-notified-on-your-phone).

### Usage

**What it is.** A read-only page of what your plan and unattended work have used.

**How it works.** **Plan usage** shows Claude Code's 5-hour and weekly windows and Codex's windows, learned from each reply (not live). **Unattended replies** shows today and the last seven days. **Limits reached today** says which limits held work back. **Inbox Watch cost** (Developer mode) shows its daily cost. A ring beside the message box shows a conversation's context use (amber at 70%, red at 90%), with a prompt-cache countdown for Claude.

**Where to control it.** **Settings → Usage** reports and changes nothing; the limits are in **Settings → Unattended work**.

**More.** [Usage](settings.md#usage), [Read usage and limits](sessions.md#read-usage-and-limits).

### Updates and self-update

**What it is.** How Pocket Code and the two CLIs stay current.

**How it works.** Pocket checks once a day at 4 a.m. in the owner's time zone: it asks GitHub for the latest published release of Pocket Code, and npm for the latest Claude Code and Codex. A notice appears at the top when any has a newer release. Normally the person who runs the server upgrades Pocket Code by hand. If the owner sets `POCKET_SELF_UPDATE=1` and restarts, an **Update to …** button installs the release itself: it checks the checkout, backs up private files to `~/backups`, installs, waits for running replies to finish, restarts under PM2 and goes back if the new version does not start. For Claude Code and Codex, **Upgrade selected** downloads the exact release into a separate install, tests it and selects it; existing conversations switch on their next turn, and a failed candidate is never selected. **Restore** reselects the previous install.

**Where to control it.** **Settings → Help & updates → About & updates → Updates**. `POCKET_UPDATE_CHECK=0` turns off the Pocket Code release check, `POCKET_CLI_UPDATES=0` the CLI discovery and upgrades, and `POCKET_RELEASES_REPO` points the check at a fork.

**Limits and gotchas.** Update from Pocket needs PM2, a git checkout, `git`, `npm`, `pm2`, GNU `tar` and `flock`, and at least 5 GB free; while it restarts, new messages are held in the box.

**More.** [Help & updates](settings.md#help--updates), [Updating from Pocket](../operations.md#updating-from-pocket).

## Sign-in and accounts

### Sign-in and Cloudflare Access

**What it is.** How Pocket lets you in.

**How it works.** The owner password (`POCKET_PASSWORD`) and a signed cookie (`POCKET_SECRET`) keep a browser signed in for 90 days. After 20 wrong attempts from one address in an hour, further attempts wait. **Sign out** ends this browser's sign-in and turns off its push; **Sign out everywhere** asks first and moves the install to a new sign-in generation (`auth-state.json`), ending every browser's. Behind Cloudflare Access, Pocket can accept the Access sign-in (`Cf-Access-Jwt-Assertion`) instead of asking for its password, after checking Cloudflare's signature, the team, the audience tag, the expiry and your email; the browser stays signed in for at most a day. The `cli-token` file is for the `pocket-*` commands on the server itself, and is not a browser login.

**Where to control it.** **Settings → Accounts & sign-in → Sign in with Cloudflare Access** (Developer mode: Team name, Application audience (AUD) tag, Who may sign in this way, **Turn off**, **Use the server's values**) and **Sign out**. `POCKET_ACCESS_TEAM`, `POCKET_ACCESS_AUD` and `POCKET_ACCESS_EMAILS` preset the Access values. `POCKET_TRUSTED_PROXY=1` tells Pocket that a proxy sets `X-Forwarded-For`.

**Limits and gotchas.** A proxy in front must send `X-Forwarded-For`, or every caller looks local. With Access sign-in on, a signed-out browser is let back in by Access, so revoke Access sessions in Cloudflare too. Over plain HTTP the `Secure` cookie is dropped and sign-in fails.

**More.** [Sign in](getting-started.md#sign-in), [Accounts & sign-in](settings.md#accounts--sign-in), [Security model](../../SECURITY.md#security-model).

### Claude and Codex accounts

**What it is.** The accounts Pocket's agents run under.

**How it works.** **Settings → Accounts & sign-in → Claude and Codex accounts** shows the accounts, plan and sign-in method. **Switch account** (or **Sign in**) under Claude Code changes the server's Claude login through a sign-in link and a pasted code; idle conversations move at once and one with a background job keeps the earlier login until the job ends. **Stop all Claude replies** stops every running Claude reply. Codex sign-in is managed on the server.

**Where to control it.** **Settings → Accounts & sign-in**.

**More.** [Accounts & sign-in](settings.md#accounts--sign-in).

### Display and per-device preferences

**What it is.** How Pocket looks on this device.

**How it works.** **Colour mode** (System, Light or Dark), **Chat text size** (14 to 24 px, default 17) and **Highlight colour** (Orange, Blue or Purple). They are kept in this browser's local storage (`pc-theme`, `pc-accent`, `pc-chat-text-size`) and apply to every Pocket window of the browser. Other per-device settings are on **Conversations** (Collapse steps, plain-word steps, message times), **Notifications** and **Voice (beta)**.

**Where to control it.** **Settings → Display**.

**More.** [Display](settings.md#display), [Where preferences live](settings.md#where-preferences-live).

## Settings map

Settings opens on a list. At the top are **Search settings** (it finds any row on a page this mode shows, up to 30 results) and the **Layout** switch (Developer mode or Assistant mode, for all your devices). Below are ten pages; a feature's own page opens from the **›** beside its switch in **Features** and has a back button named **Features**. The same names, order and headings are used in both modes; Assistant mode leaves out the rows marked Developer mode. [Settings](settings.md) has the full table of controls with defaults and where each is stored; this map does not repeat it.

| Page | Rows (Developer mode unless noted) |
|---|---|
| **Layout** | Developer mode or Assistant mode |
| **Display** | Colour mode, Chat text size, Highlight colour |
| **Conversations** | Collapse steps, Describe steps in plain words, Show message times (this device; Assistant mode keeps Collapse steps and Show message times); Short titles, Keep titles up to date, Catch-up summary, Model for titles and summaries, Sync names with code-server, Mark all reviewed button (all devices) |
| **Notifications** | Completion chime, Push to this device, the five push kinds, Count on the app icon (this device); Notice a day before, Email due tasks and reminders to (all devices) |
| **Voice (beta)** | Mute voice on this device, Speak replies, Spoken reply length, Review before sending, Announce conversations, Hands-free: wait for my reply, Voice, Names and terms to recognize, Play a sample |
| **Accounts & sign-in** | Claude and Codex accounts, Connectors, Sign in with Cloudflare Access (Developer mode), Sign out |
| **Agents** (Developer mode) | Models offered in the picker, Long conversations and helpers (Compact conversations, Offer a handoff, Helper model, Helper effort), Actions that run without asking |
| **Features** | A switch for Projects, Files, Tasks, Inbox Watch, Vault, Check-backs, Job keys, Coordination (Developer mode) and Automatic model choice, each with a **›** |
| **Features → Projects** | Open projects (this device) |
| **Features → Files** | Keep files from replies, Files button, Open files and links |
| **Features → Tasks** | Show check-backs in Tasks, Show job keys in Tasks |
| **Features → Inbox Watch** | Opens the Inbox Watch settings sheet |
| **Features → Vault** | Restore key (when missing); Agent access, Passphrase, Lock after, Export and import, Catch secrets in messages (Developer mode) |
| **Features → Check-backs** | Permissions for a check-back, per-agent switches, Push the result even when muted, Advanced limits |
| **Features → Job keys** | Waiting for you, the key list, New job key, defaults and Advanced limits |
| **Features → Automatic model choice** | Decision model, Key, the four levels, Use the server's settings (Developer mode) |
| **Unattended work** | Pause all, Your own messages while paused, Also pause Inbox Watch, Also stop background commands, On Resume options, Ask before pausing, the Limits and their Advanced settings |
| **Usage** | Plan usage, Unattended replies, Limits reached today, Inbox Watch cost (Developer mode) |
| **Help & updates** | Keyboard shortcuts (Developer mode), About & updates, What's new, Bugs & feature requests (Developer mode) |

Before 1.124.9 these pages were named differently (formerly Appearance, Conversation, "Agents & instance", "Projects, files, tasks & vault", Automation, and "Notifications & voice"). No setting was removed and no default changed; see [Where things moved in 1.124.9](settings.md#where-things-moved-in-11249).

## Environment variables

Set these in `.env` in the Pocket Code directory or in the process environment (the environment wins), then restart from the Pocket Code directory (`pm2 restart ecosystem.config.cjs`). The daemon and every `pocket-*` command read `.env` the same way. Rows marked **Preset** give a starting value for a Settings control; the table in [Settings and environment variables](settings.md#settings-and-environment-variables) says which side wins. The README's [Configuration](../../README.md#configuration) table is the longer list, with the long tail of tuning variables.

| Variable | What it does | Link |
|---|---|---|
| `POCKET_PASSWORD`, `POCKET_SECRET` | Required: the owner password and the cookie-signing secret | [Sign in](getting-started.md#sign-in) |
| `PORT` | Local port, default 3610 (listens on `127.0.0.1` only) | [Install](../install.md) |
| `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_CONTACT` | Web push keys; without them push is off | [Notifications](settings.md#notifications) |
| `POCKET_ASSISTANT_MODE` | **Preset** for Layout: `on`, `1` or `true` start in Assistant mode; `locked` keeps it on and out of Settings | [Layout](settings.md#layout) |
| `POCKET_AUTO_TITLES` | **Preset** for Short titles (on unless `0`) | [Conversations](settings.md#conversations) |
| `POCKET_TITLE_CLAUDE_MODEL`, `POCKET_TITLE_CODEX_MODEL` | Models for generated titles (defaults `haiku`, `gpt-6-luna`) | [Titles](sessions.md#titles) |
| `POCKET_LIVE_TITLE_GAP_MS` | Minimum time between title checks (ten minutes) | [Titles](sessions.md#titles) |
| `POCKET_CLAUDE_MODELS` | **Preset** for Models offered in the picker | [Models in the picker](sessions.md#models-in-the-picker) |
| `POCKET_CLAUDE_MODEL`, `POCKET_CLAUDE_EFFORT`, `POCKET_CODEX_MODEL`, `POCKET_CODEX_EFFORT` | Pocket-only default model and effort per agent | [Settings and environment](sessions.md#settings-and-environment) |
| `POCKET_CLAUDE_DISCOVERY` | `0` stops the daily check of Anthropic's model list | [Models in the picker](sessions.md#models-in-the-picker) |
| `POCKET_CLAUDE_MANAGED_DIR` | Where to read Claude Code's managed settings | [Models in the picker](sessions.md#models-in-the-picker) |
| `CLAUDE_BIN`, `CODEX_BIN`, `CODEX_HOME` | Paths to the CLIs and Codex's home | [Settings and environment](sessions.md#settings-and-environment) |
| `POCKET_CODEX` | `0` hides Codex | [Settings and environment](sessions.md#settings-and-environment) |
| `POCKET_ACP_ENABLE`, `OPENROUTER_API_KEY` | Turn on the OpenRouter agent and give it a key | [OpenRouter models](sessions.md#openrouter-models) |
| `POCKET_ACP_CMD`, `POCKET_ACP_ARGS`, `POCKET_ACP_MODEL`, `POCKET_ACP_MODELS`, `POCKET_ACP_IDLE_MS` | OpenRouter command, default model, extra tested models, idle close (20 minutes) | [OpenRouter models](sessions.md#openrouter-models) |
| `POCKET_AGY_ENABLE`, `POCKET_AGY_CMD`, `POCKET_AGY_ARGS`, `POCKET_AGY_MODEL`, `POCKET_AGY_MCP_CONFIG` | Turn on and configure the Antigravity agent | [Antigravity](sessions.md#antigravity-google-models-on-your-google-plan) |
| `POCKET_DEFAULT_CWD`, `POCKET_LOCK_CWD` | Preselected workspace; `1` pins every conversation to it | [Start a conversation](sessions.md#start-a-conversation) |
| `POCKET_IDLE_CLOSE_MS`, `POCKET_MAX_PROCESSES`, `POCKET_STALL_MS` | Idle close (1 hour), live process target (8), stall watchdog (30 minutes) | [Processes and limits](sessions.md#processes-and-limits) |
| `POCKET_RETRY_BUFFER_MS` | Wait after a usage-limit reset before continuing (5 minutes) | [Read usage and limits](sessions.md#read-usage-and-limits) |
| `POCKET_CHOICES` | `0` stops the suggested-reply and Complete-card instructions | [The instructions Pocket appends](for-agents.md#the-instructions-pocket-appends) |
| `POCKET_SIDE_CHAT`, `POCKET_SIDE_CHAT_BUDGET_USD`, `POCKET_SIDE_CHAT_IDLE_MS`, `POCKET_SIDE_CHAT_MAX` | Side chat on or off, spend cap ($5), idle time (30 minutes), concurrent chats (4) | [Side chat](conversation.md#ask-a-side-question-side-chat) |
| `POCKET_APPROVAL_MODE`, `POCKET_ALLOW_FULL_ACCESS` | Default permissions (`review` or `full`); `0` removes Full access | [Choose Review actions or Full access](approvals.md#choose-review-actions-or-full-access) |
| `POCKET_TRUSTED_ACTIONS` | **Preset** for Actions that run without asking | [Let read-only actions run without asking](approvals.md#let-read-only-actions-run-without-asking) |
| `POCKET_DATA_DIR`, `POCKET_SESSION_ROOT`, `POCKET_PIPE_DIR`, `POCKET_ENV_FILE` | Where state, Claude transcripts, input pipes and `.env` live | [State and backups](../operations.md#state-and-backups) |
| `POCKET_DOCUMENTS_DIR`, `POCKET_CHROME`, `POCKET_PDFTOPPM`, `POCKET_CONVERT` | Files storage folder and the preview tools | [Where files live](files.md#where-files-live) |
| `POCKET_SKILLS` | `0` stops Pocket installing its agent skills | [The skills Pocket installs](for-agents.md#the-skills-pocket-installs) |
| `POCKET_AUTOMATION_<NAME>` | **Preset** for Unattended work, Check-backs and Job keys values | [Presets for an install](automation.md#presets-for-an-install) |
| `POCKET_CHECKBACK_TICK_MS` | How often due check-backs are looked for (60 seconds) | [Presets for an install](automation.md#presets-for-an-install) |
| `POCKET_JOB_KEY` | The job key `pocket-run` reads when no `--key-file` is given | [Call it with pocket-run](automation.md#call-it-with-pocket-run) |
| `POCKET_COORD_SWEEP_MS` | How often Coordination renews, expires and wakes (30 seconds) | [Coordination](coordination.md#settings-and-environment) |
| `POCKET_INBOX_RUNNER` | `0` stops Pocket running the Inbox Watch watcher | [Inbox Watch](inbox-watch.md#set-it-up) |
| `POCKET_ROUTER`, `POCKET_ROUTER_KEY`, `POCKET_ROUTER_KEY_FILE`, `POCKET_ROUTER_TIMEOUT_MS`, `POCKET_ROUTER_CONTEXT` | **Preset** for Automatic model choice (timeout 1,500 ms; context up to 1,000 characters) | [Automatic model choice page](settings.md#automatic-model-choice-page) |
| `POCKET_ACCESS_TEAM`, `POCKET_ACCESS_AUD`, `POCKET_ACCESS_EMAILS` | **Preset** for Sign in with Cloudflare Access | [Accounts & sign-in](settings.md#accounts--sign-in) |
| `POCKET_TRUSTED_PROXY` | `1` says a proxy in front sets `X-Forwarded-For` | [Install](../install.md) |
| `POCKET_FRAME_ANCESTORS` | Origins allowed to embed Pocket in a frame | [Collapse controls for more room](desktop-and-phone.md#collapse-controls-for-more-room) |
| `POCKET_PUBLIC_URL` | Pocket's public address, for links in emails, alerts and share addresses | [Notifications](settings.md#notifications) |
| `POCKET_SMTP_URL`, `POCKET_SMTP_FROM` | Email for due tasks and reminders (enables the address field in Settings) | [Notifications](settings.md#notifications) |
| `POCKET_REMINDER_HOOK`, `POCKET_REMINDER_CHECK_MS` | A command run for each due reminder or task; how often they are checked (60 seconds) | [How reminders reach you](projects.md#how-reminders-reach-you) |
| `POCKET_TZ` | The owner's time zone until their browser reports one | [Due times and time zones](tasks.md#due-times-and-time-zones) |
| `POCKET_URL` | Base address the `pocket-*` commands use to reach the server | [How a command finds the daemon](for-agents.md#how-a-command-finds-the-daemon) |
| `POCKET_VAULT_KEY` | The Vault's key; created by the Vault switch, set by hand only without a `.env` | [Turn it on](vault.md#turn-it-on) |
| `POCKET_VAULT_FILL_WAIT`, `POCKET_VAULT_FILL_TOOLS`, `POCKET_VAULT_PICTURE_TOOLS`, `POCKET_VAULT_PICTURE_WAIT` | Browser relay timing and tool lists | [Browser logins](vault.md#browser-logins) |
| `POCKET_INTAKE_ORG`, `POCKET_INTAKE_ACCENT`, `POCKET_INTAKE_LOGO` | Branding of the Vault intake page | [Ask someone outside for a secret](vault.md#ask-someone-outside-for-a-secret) |
| `POCKET_VOICE`, `POCKET_VOICE_HOME`, `POCKET_VOICE_IDLE_MS`, `POCKET_VOICE_COMMAND` | Voice engine on or off, install folder, idle unload (15 minutes), custom command | [Server settings](voice.md#server-settings) |
| `POCKET_MEMSTEM_URL`, `POCKET_MEMSTEM` | MemStem address for searching inside conversations; `0` turns it off | [How search works](sessions.md#how-search-works) |
| `POCKET_SELF_UPDATE` | `1` lets the owner install Pocket releases from Settings | [Updating from Pocket](../operations.md#updating-from-pocket) |
| `POCKET_UPDATE_CHECK`, `POCKET_CLI_UPDATES`, `POCKET_RELEASES_REPO` | Turn off the release check or the CLI upgrades; point the check at a fork | [Help & updates](settings.md#help--updates) |

Pocket sets two variables for the agents it starts: `POCKET_SESSION_ID` (the conversation's id; Codex ids start `cx:`) and `POCKET_RUNNER_TOKEN` (ties Vault calls to the conversation; never print it). See [Environment variables Pocket sets for you](for-agents.md#environment-variables-pocket-sets-for-you). A few more variables exist for tests and internal tuning and are not part of the supported configuration.

## Glossary

**Agent.** The tool that does the work in a conversation: Claude Code, Codex, OpenRouter (through OpenCode) or Antigravity. Also used for the AI itself.

**Assistant mode.** The plain-words layout, switched in **Settings → Layout** (or fixed with `POCKET_ASSISTANT_MODE=locked`). It opens on a message box and hides the developer controls. See [Developer mode or Assistant mode](getting-started.md#developer-mode-or-assistant-mode).

**Attention.** The filter and list group that collects questions, approvals, failed replies and finished replies you have not opened.

**Branch.** A new saved conversation that carries on from another with everything said so far.

**Check-back.** One more reply, later, in the conversation that set it, started by Pocket at the time you asked for. See [Check-backs](#check-backs).

**Conductor mode.** A project switch under which the top model leads the project's conversations and hands work to cheaper models. **Solo** is the other start: one cheaper model does the work itself. See [Projects and Conductor mode](#projects-and-conductor-mode).

**Conversation.** One agent session run by Pocket. The app says conversation and reply where the CLIs say session and turn.

**Data directory.** The folder (`POCKET_DATA_DIR`, default the Pocket Code checkout) where Pocket's own state files live.

**Developer mode.** The default layout, with every tool and setting.

**Dock.** The panel at the right of a conversation, on a window 1280 px wide or more, that holds Results, Queue, Git and Side chat. Below that width these open as sheets.

**Effort.** How much the model thinks before it answers. Higher is slower, more thorough and uses more of your plan. Set in the model and effort panel.

**Full access.** The permission mode in which the agent runs its tools without routine prompts, with the access of the server account. The other mode is **Review actions**.

**Handoff.** A new conversation that starts from a briefing the agent wrote, not from the whole history.

**Hold.** A named claim in Coordination, such as `shop-staging`, that is advice rather than a lock.

**Job key.** A `pjk_` key that lets one script on the server start a reply with an instruction you wrote. See [Job keys](#job-keys).

**Layout.** The switch at the top of Settings between Developer mode and Assistant mode.

**Pause all.** The emergency stop that halts every running reply and holds everything automatic. See [Pause all and unattended-work limits](#pause-all-and-unattended-work-limits).

**Reply.** One agent response to a message.

**Review actions.** The default permission mode: the agent asks before commands, edits and external tools.

**Side chat.** A private question about a conversation that adds nothing to it.

**Start link.** A briefing an agent or a job hands to Pocket, opened at `#/start/<id>` as an unsent conversation.

**Steer.** To send a message into a reply that is running (**Steer now**), as opposed to queueing it (**After this reply**).

**Trusted action.** A read-only action on the owner's list that runs without an approval card in Review actions.

**Unattended work.** Replies that start without you: check-backs, job runs, queued messages, retries and coordination wakes. Controlled by **Settings → Unattended work**.

**Vault.** The encrypted store of credentials that agents use by name.
