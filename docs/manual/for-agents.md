<!-- manual
checked: 1.119.0
sources: skills.mjs, tasks.mjs, checkbacks.mjs, project-mode.mjs, choices.mjs, approvals.mjs, skills/, scripts/pocket-checkback.mjs, scripts/pocket-start.mjs, scripts/pocket-notify.mjs, scripts/pocket-mcp-proxy.mjs
-->
# For agents

This page is for an AI agent (Claude Code or Codex) working inside Pocket Code or on the same server. It explains how Pocket runs you, which instructions and skills it gives you, which commands you can use and how to find them, and the rules you must follow. People setting up a server can read it to see what their agents are told. Each feature has its own page; this one covers what they share.

## Answer "how do I…" questions about Pocket

When the user asks how a Pocket feature works, how to turn it on or why it misbehaves:

1. Read the manual index, `docs/manual/README.md` in the Pocket Code directory.
2. Open the feature's page and answer from it. Each page has a **For agents** section with the commands and the rules for that feature, and a **Troubleshooting** table.
3. Read the source only when the page does not cover the question. The comment at the top of each page names the release it was checked against; if the user's Pocket is much newer and the page looks wrong, say so and check the code.

The pages:

| Page | Covers |
|---|---|
| [Getting started](getting-started.md) | Install, sign in, the phone, Developer and Assistant mode |
| [Conversations](sessions.md) | Starting, finding, resuming and closing conversations; model, effort and permissions |
| [Working in a conversation](conversation.md) | The message box, attachments, reply buttons, steering and the queue, side chat, Branch |
| [Questions and approvals](approvals.md) | Review actions and Full access, approval cards, trusted rules |
| [Desktop and phone](desktop-and-phone.md) | Split view, the phone layout, keyboard shortcuts |
| [Settings](settings.md) | Every setting and where it is stored |
| [Projects](projects.md) | Project cards and `pocket-board` |
| [Files](files.md) | The Files library and `pocket-docs` |
| [Tasks](tasks.md) | To-dos and `pocket-tasks` |
| [Coordination](coordination.md) | Holds on shared things and `pocket-coord` |
| [Automation](automation.md) | Pause all, check-backs, and limits on unattended work |
| [Inbox Watch](inbox-watch.md) | Mail alerts and `pocket-inbox` |
| [Gmail, Calendar and Drive](google.md) | Google through each agent's connectors |
| [Vault](vault.md) | Credentials used by name, and `pocket-vault` |
| [Voice](voice.md) | Dictation and hands-free voice mode |

## How Pocket runs you

Pocket drives the `claude` and `codex` command-line tools installed on the server. Their own transcripts and session stores stay the record of each conversation. Each conversation gets one long-lived process that is kept between messages and closed after it has been idle (60 minutes by default, `POCKET_IDLE_CLOSE_MS`); the next message starts a new process that resumes the conversation.

### Claude Code

Pocket starts `claude` with:

```text
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
       --permission-mode <default | bypassPermissions> --permission-prompt-tool stdio
       [--model <model>] [--append-system-prompt "<Pocket's lines>"]
       --settings '{"permissions":{"ask":[…]},"effortLevel":"<effort>"}'
       (--session-id <id> | --resume <id> | --resume <parent> --fork-session --session-id <id>)
```

- **Review actions** runs with permission mode `default` and asks the user before `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `Agent`, `Task`, `WebFetch`, `WebSearch` and every MCP tool (`mcp__*`), each as an approval card in Pocket, unless a trusted rule in **Settings → Agents & instance → Actions that run without asking** allows it. **Full access** runs with `bypassPermissions`. `AskUserQuestion` always reaches the user as a question card. See [Questions and approvals](approvals.md). A request from one of your subagents reaches the user too, named after the agent, including a background subagent's request after your reply has ended (1.82): it waits for the user's answer like any other, so prefer agents that need no approvals when you run them in the background under Review actions.
- The process runs in the conversation's workspace with the daemon's environment, minus Pocket's own secrets (its sign-in password, cookie-signing key, push private key, Vault keys, mail server settings and router key) and minus inherited `CLAUDECODE` and `CLAUDE_CODE_*` variables. Your global Claude Code settings, hooks, MCP servers and skills still apply.

### Codex

Pocket starts one `codex app-server --listen stdio://` per thread and opens the thread with `thread/start`, `thread/resume` or `thread/fork`:

- **Review actions**: sandbox `read-only`, approval policy `untrusted`, approvals reviewed by the user in Pocket. The read-only sandbox cannot reach Pocket's server, so the `pocket-*` commands fail in this mode; tell the user the step needs Full access.
- **Full access**: sandbox `danger-full-access`, approval policy `never`.

Pocket's lines reach Codex as the thread's `developerInstructions`. If Codex's `config.toml` sets its own `developer_instructions`, Pocket sends none of its lines (Settings warns the user), and you depend on the installed skills alone.

### Environment variables Pocket sets for you

| Variable | Value |
|---|---|
| `POCKET_SESSION_ID` | This conversation's id. Codex ids carry a `cx:` prefix (`cx:<thread id>`); a brand-new Codex thread does not have it until its process is next started. |
| `POCKET_RUNNER_TOKEN` | A random token that ties your `pocket-vault` calls and browser fills to this conversation. Never print or pass it on. |

## The instructions Pocket appends

Pocket adds a set of plain-language lines to your instructions when it starts your process (`--append-system-prompt` for Claude Code, `developerInstructions` for Codex). They are fixed for the life of that process. Turning the Vault or check-backs on or off (or a check-back engine switch) closes idle processes so the next message picks up the change; the other switches take effect when a conversation's process next starts.

| Line | When | What it tells you |
|---|---|---|
| Suggested replies | Unless `POCKET_CHOICES=0` | When you end a reply by asking the user to choose between specific next steps, finish with a fenced block whose info string is `choices`, 2 to 4 options, one per line, each the short reply the user would send (under 60 characters). Put the block last. Mark at most one option with "(Recommended)", listed first. No block for open-ended questions or when nothing needs deciding. |
| Complete card | Unless `POCKET_CHOICES=0` | When a reply completes work the user asked for and nothing is left (everything requested is done and checked, nothing failed or was skipped, nothing is running or waiting, no next step to recommend, no question to ask), finish with a fenced block whose info string is `done`, holding one line under 100 characters that states the outcome. Pocket shows a Complete card the user taps to close the conversation. Never with a `choices` block, in a reply that asks or offers anything, or for a plain answer. |
| Projects | **Projects** is on | Track a project only when the user asks. Check `status --all` first and link this conversation to a matching project rather than duplicating it; otherwise `track --requested`. Ask at most one question. Set a reminder only when the user asks or agrees to a time. Keep a tracked project's card current at stopping points. |
| Conductor mode | The conversation is in a project's [Conductor mode](projects.md#conductor-mode) (started, handed off or linked there after the switch went on, and not started Solo); Claude Code and Codex. Ends at the next reply when the mode is switched off, the project is finished or the conversation is unlinked | You are the lead: plan, hand the work to subagents and judge what comes back. Before handing out work, record what done means and a pass/fail check per step on the card (`update --done-when`, `task add --check`), and ask every decision you need in one message. Pick each subagent's model and effort by the step; start one only for parallel work or work that would fill your context. Check every result yourself, have a fresh reviewer on your own model check the whole change, work freely only in the card's directory and **Works in** places, keep the card current, and end with a report for someone who did not watch. |
| Files | **Files** is on | "Files", "my files", "documents", "my documents" and "docs" mean Pocket's Files library. Keep deliverables for the user to read (HTML report, PDF, image, Markdown, CSV or spreadsheet) with `add`, linked to this conversation. Files are private; share only when asked. Sharing or publishing waits for the user's Allow: on `pending <id>`, say so and run `wait <id>`. Mention a file by its title, not its server path. |
| Tasks | **Tasks** is on | Create a task only when the user asks or accepts your offer. Before finishing each reply, check whether the work needs the user to come back later; if so and nothing covers it, offer a task once (as a suggested reply when those are on). Give `--due` only for a time the user named or agreed. |
| Check-backs | **Check-backs** is on in **Settings → Automation**, and its switch for this engine (Claude Code; Codex). Never in OpenRouter | This Pocket can check back. Set one only when the user asked in this conversation or accepted your offer; then run `add --at … --note …`, say when, and end the reply. When a later look would help and the user didn't ask, offer it once as a suggested reply that names when. A task is still right when the user has to act. In Codex: only under Full access. With check-backs on, the Tasks line also says to offer a check-back rather than a task when the follow-up is this conversation looking again. |
| Inbox Watch | **Inbox Watch** is on | `list`, `show` and `act`; record a decision (`act`) only when the user asks. In a conversation started from an alert, `merge` folds a same-story duplicate into it unasked (1.113). `split` makes the latest mail an entry of its own, only when the user says it is a separate subject (1.115). Which alerts push is the `push` setting, changed only when asked. |
| Vault | The Vault is on and its store loaded (a locked Vault counts) | Use secrets by name with `pocket-vault run`; never print, write or ask for a value; on `pending`, say so and offer Allow and Deny; on refusal, stop; store any secret you meet with `put`; ask someone outside for a credential with a one-time `request` link, never by email, chat or phone; `{{vault:name.field}}` in browser fill tools; a `{{vault:name}}` in a message is the user handing you a stored secret. |
| Google | Always | Use this agent's Gmail, Google Calendar and Google Drive connectors from **Settings → Agents & instance → Connectors**; check once whose account it is; write every email as a draft and show it first; send when the user says so and never refuse a send they ask for; ask before sending calendar invitations to other people. |
| Manual | Always | Where this manual's index is, and to answer questions about Pocket from it. |

Each line names the exact command path on this server (for example `node <Pocket Code directory>/scripts/pocket-board.mjs`), this conversation's id where a command needs it, and the path of the matching skill file.

## The skills Pocket installs

Pocket ships agent skills in the `skills/` folder of the Pocket Code directory and installs each one while its feature is on, so every agent on the server knows them: those in Pocket, in a terminal and in code-server.

| Skill | Installed while | Command | Manual page |
|---|---|---|---|
| `pocket-projects` | **Projects** is on | `pocket-board` | [Projects](projects.md) |
| `pocket-files` | **Files** is on | `pocket-docs` | [Files](files.md) |
| `pocket-tasks` | **Tasks** is on | `pocket-tasks` | [Tasks](tasks.md) |
| `pocket-coord` | **Coordination** is on and Assistant mode is off | `pocket-coord` | [Coordination](coordination.md) |
| `pocket-inbox` | **Inbox Watch** is on | `pocket-inbox` | [Inbox Watch](inbox-watch.md) |
| `pocket-checkback` | **Check-backs** is on in **Settings → Automation** | `pocket-checkback` | [Automation](automation.md) |
| `pocket-vault` | The Vault is on and its store loaded (a locked Vault counts) | `pocket-vault` | [Vault](vault.md) |
| `pocket-google` | Always (`SKILL.claude.md` for Claude Code, `SKILL.codex.md` for Codex) | none | [Gmail, Calendar and Drive](google.md) |

- **Where:** `~/.claude/skills/<name>/` (or `$CLAUDE_CONFIG_DIR/skills/`), and `$CODEX_HOME/skills/<name>/` (default `~/.codex/skills/`) when that Codex folder exists.
- **When:** at every daemon start, and whenever one of those switches changes in **Settings → Projects, files, tasks & vault** (for `pocket-checkback`, the Check-backs group in **Settings → Automation**). Turning a feature off removes its skill.
- **The marker:** Pocket writes a `.pocket-managed` file in each folder it installs, and only writes or removes folders carrying it. A skill of your own with the same name is left alone (and logged).
- **The installed copy** says how to run its command on this server ("On this server, run `pocket-board` as `node …`") and where its manual page is. Edit the copy in the Pocket Code directory, not the installed one; Pocket rewrites it.
- **`POCKET_SKILLS=0`** turns installation (and removal) off entirely. The appended lines still reach Pocket's own conversations, and they name each skill file in the Pocket Code directory.

## The commands

All of these talk to the running Pocket daemon over loopback. Each reads the daemon's address from `<data dir>/cli-url` and a token from `<data dir>/cli-token` (both written by the daemon at every start, mode `0600`), so they work only on the same machine, as a user who can read those files, while Pocket is running.

| Command | Script | Works while | Details |
|---|---|---|---|
| `pocket-board` | `scripts/pocket-board.mjs` | **Projects** is on | [Projects](projects.md) |
| `pocket-docs` | `scripts/pocket-docs.mjs` | **Files** is on | [Files](files.md) |
| `pocket-tasks` | `scripts/pocket-tasks.mjs` | **Tasks** is on | [Tasks](tasks.md) |
| `pocket-coord` | `scripts/pocket-coord.mjs` | **Coordination** is on and Assistant mode is off | [Coordination](coordination.md) |
| `pocket-inbox` | `scripts/pocket-inbox.mjs` | **Inbox Watch** is on | [Inbox Watch](inbox-watch.md) |
| `pocket-checkback` | `scripts/pocket-checkback.mjs` | **Check-backs** is on, inside a Pocket conversation | [Check back later](#check-back-later) |
| `pocket-vault` | `scripts/pocket-vault.mjs` | The Vault is on | [Vault](vault.md#for-agents) |
| `pocket-start` | `scripts/pocket-start.mjs` | Always | [Start links](#hand-the-user-a-briefing-with-a-start-link) |
| `pocket-notify` | `scripts/pocket-notify.mjs` | Always | [Notifications](#send-the-user-a-notification) |

### Find the command's path

- **Inside a Pocket conversation:** use the exact `node …/scripts/pocket-*.mjs` path your instructions name.
- **With an installed skill:** its commands block names the path on this server.
- **From a terminal in the Pocket Code directory:** `node scripts/pocket-board.mjs …`. The first five, and `pocket-checkback`, also run as `npx pocket-board` (and so on) from that directory; `pocket-start` and `pocket-notify` run only as `node scripts/…`.
- `<command> help` (or `--help`) prints the usage.

### How a command finds the daemon

1. `POCKET_URL`, if set.
2. `<data dir>/cli-url`.
3. `PORT` from the `.env` in the Pocket Code directory, then an inherited `PORT`, then `3610`.

The data directory is `POCKET_DATA_DIR` from the environment or that `.env`, and defaults to the Pocket Code directory. `POCKET_ENV_FILE` names a different `.env` (empty reads none). Reading `cli-url` first means a `PORT` exported by an app you are working on cannot send Pocket's token to that app.

Times the commands print use the owner's time zone (the zone their browser reports, then `POCKET_TZ`, then the server's) and name it. A time you give without an offset is read in that same zone, so a printed time can be passed back as it reads.

### Hand the user a briefing with a start link

`pocket-start` stores a briefing and prints a link that opens **New conversation** with it typed in, in the workspace and with the agent you name. Nothing starts until the user taps Start.

```text
pocket-start add --text "…" | --file <path|->  [--handoff] [--dir <workspace>] [--provider claude|codex|acp] [--title "…"] [--ttl-days N] [--json]
pocket-start show <id> [--json]
```

- `--dir` must be a full path. `--ttl-days` is 1 to 30 (default 7). The briefing can be up to 20,000 characters, the title 160.
- It prints the full URL when Pocket knows its public address (`POCKET_PUBLIC_URL`, or the address the owner last signed in from), otherwise the path `/#/start/<id>`.
- Links live in `POCKET_DATA_DIR/starts.json`, at most 500, oldest dropped first.

Use it for jobs that alert the user somewhere else, so acting on an alert is a tap: pair it with `pocket-notify --url` or `pocket-inbox add --url`.

### Hand work to a fresh conversation

When the user asks to hand off, or a conversation has grown long and the next step stands alone, write a briefing and run `pocket-start add --handoff --file <path> --title "…"`. Put the link alone on its own line in your reply: Pocket shows it as a card with Start and Review first.

- The briefing is all the new conversation knows. Say what was decided, what is left, which files matter and what not to redo.
- `--dir` defaults to the folder you run the command in, so run it from the folder the work belongs in.
- Pocket works out which conversation you are from your runner token. You cannot name a parent or choose permissions; a handoff never gets more permission than your conversation has. OpenRouter conversations have no runner token, so their handoffs have no parent and get Review actions.
- Never put a secret in a briefing: it is refused. Name the Vault entry instead.

### Send the user a notification

`pocket-notify` sends a push to every device that has **Inbox alerts** on in **Settings → Notifications & voice**, and with `--email` also mails the address saved there.

```text
pocket-notify --title "…" (--body "…" | --file <path|->) [--url </#/start/<id> or another Pocket path>] [--tag <key>] [--email] [--json]
```

- The title is cut to 70 characters and the body to 2,000. `--url` must be a Pocket path (`/#/…`) or start with Pocket's public address, and must stay on Pocket's own site: a link that leads to another site (such as `//host/…`) is refused. A notification with the same `--tag` replaces the earlier one on a device.
- It prints `push=<devices|off> mail=<yes|no|off|failed>`. `mail=off` means email is not set up (`POCKET_SMTP_URL` and an address in Settings). Exit code 2 means Pocket is not running here or refused the token.
- Send one only when the user or the job you are running asks for it.

### Check back later

With **Check-backs** on in **Settings → Automation**, a conversation can take one more turn later, at a time the user asked for. Pocket starts it, and tells the user the result with a push.

```text
pocket-checkback add --at "+15m" --note "what to check and what done looks like"
pocket-checkback list [--all] [--json]
pocket-checkback cancel <id>
```

- **Who may set one** is Pocket's rule, not only the instructions': the reply running now must be one the user started, or a check-back's own reply while its chain is under the limit (**Settings → Automation → Check-backs**, 5 by default; 0 means a check-back can't set another). A check-back's reply may set **one** follow-up: a second is refused (`one_more`, *This check-back reply already set its one follow-up (at 2:45 PM). Cancel it first to change the time.*); cancel the first to set it at another time. A reply started by the queue, a retry, a coordination wake, or by you after a background job is refused; so is a terminal or code-server (no runner token), a side chat and an OpenRouter conversation. In Codex it works only under Full access (Codex's Review sandbox can't reach Pocket). Offer it as a suggested reply instead; the user's reply can set it.
- **`--at`** takes `+15m`, `+2h`, `+1d` (also `+15 min`, `+2 hours`), or a date and time such as `2026-11-22 09:00` in the owner's time zone, or an ISO time with an offset. It must be between the soonest and furthest the owner allows (1 minute and 90 days by default). Day names aren't read: give the date. A time outside that range, or a note that is empty or too long, is refused with the range.
- **`--note`** is all the later turn is told, so make it complete. It may be up to 1,000 characters by default.
- **Limits** (settings): 10 waiting per conversation and 50 per Pocket by default; the note is up to 1,000 characters. `list` shows this conversation's waiting check-backs (`--all` adds finished ones) and `cancel <id>` cancels one that has not started. The owner can cancel any of them in Pocket. How it all works for the owner is in [Automation](automation.md#check-backs).
- **When it runs,** the reply starts with `[Pocket check-back · set at <time> at your request · 1 of 6]`, then `What to check:` and the note, and the time now (and how late, if Pocket was down or held). It runs with the permissions of the reply that set it, lowered to Review actions when the owner chose that or Full access is not allowed on the server. Pause all, a plan ceiling and the daily limit in **Settings → Automation** hold it; a conversation with a reply running, or waiting for a usage limit to reset, makes it wait. Lead your reply with the result: its first line is what the push shows.
- Exit codes: 0 done, 1 refused or failed, 2 a limit or no reply running (HTTP 409), 4 the token was refused, 5 check-backs are off.

### Use the browser with stored logins

`scripts/pocket-mcp-proxy.mjs` is a relay that sits between you and an MCP server such as the Playwright browser tools. It passes every call through untouched, except that a fill tool call naming `{{vault:name.field}}` gets the real value from the Vault on the way to the browser, and the value is replaced by the placeholder in everything that comes back.

```text
node <Pocket Code directory>/scripts/pocket-mcp-proxy.mjs [--name <server>] -- <MCP server command…>
```

The owner registers the browser tool through it once, for example `claude mcp add playwright -s user -- node <Pocket Code directory>/scripts/pocket-mcp-proxy.mjs --name playwright -- npx -y @playwright/mcp --headless --no-sandbox`. Values go only into `browser_type`, `browser_fill_form`, `type` and `fill` (or `POCKET_VAULT_FILL_TOOLS`), and once one has been typed, screenshots from that browser are withheld for the rest of the relay's life. See [Vault: Browser logins](vault.md#browser-logins).

## Rules

These come from Pocket's instructions and skills. Follow them in Pocket and outside it.

- **Projects only on request.** Create or track a project only when the user says so ("track this", "make it a project", "add this to my projects"). Never infer it from work being unfinished. See [Projects](projects.md).
- **Check-backs only on request or acceptance.** Offer one once when this conversation will need to look again later; set it only when the user asks or accepts. Pocket refuses one from a reply the user didn't start.
- **Tasks only on request or acceptance.** Offer a task once when the work needs a later follow-up; create it only when the user asks or accepts. See [Tasks](tasks.md).
- **Files stay private.** Keep deliverables in Files; share or publish only when the user asks, and expect the user to be asked to allow it (`pending <id>`, then `wait <id>`). Pocket shows a share link's address only once, in the answer that made it. See [Files](files.md).
- **Never look at or print a secret.** Use credentials by name through `pocket-vault`. Never print, echo, log, decode or write a value, never put one in arguments, never ask the user to paste one into the chat, and never look for another way to a value after a refusal. Store a secret you meet at once and tell the user it was seen. Keep an approved command, and the files it names, unchanged: Pocket checks their content, and a change asks the user again. Pocket finds the program on the Vault's own `PATH`, so give a full path for one outside it. See [Vault](vault.md#for-agents).
- **Drafts first for email.** Write every email as a draft and show it first; send when the user says so, and do not refuse a send they ask for. Ask before sending calendar invitations to other people. See [Gmail, Calendar and Drive](google.md).
- **Inbox decisions on request.** Record `resolve`, `not_useful` or `dismiss` on an Inbox entry only when the user asks. The one exception is merging a same-story duplicate into the entry the conversation started from (1.113). Split an entry (`pocket-inbox split`) only when the user says the new mail is a separate subject, and never merge a split entry back (1.115). See [Inbox Watch](inbox-watch.md).
- **Suggested replies, not questions in disguise.** Use the `choices` block only for a real choice between specific next steps, as the last thing in the reply. Put a sources list above the question, not after the block.
- **Done means done.** End with the `done` block only when nothing is left for the user or for you: no failure, no skipped step, no open question, no follow-up worth offering. The user closes the conversation on your word, often without reading the reply. When unsure, leave it out. See [the Complete card](conversation.md#the-complete-card).
- **Pocket can be paused, and a follow-up may wait (1.117).** The owner has one switch, Pause all, that stops every reply and holds what runs without them: a queued follow-up, a usage-limit retry, a coordination wake. A limit they set can hold the same work. A message you queued, or a conversation woken for a hold you waited on, may therefore start later, or only when the owner resumes. Don't re-send it, don't look for another way to run it, and say so if the owner asks why nothing happened. See [Automation](automation.md).
- **You can't pause, resume or change Automation settings.** Those routes take only the owner's own sign-in; the command token is refused. If a limit is in the way, tell the owner the path, **Settings → Automation**; never try to raise it yourself.
- **Answer about Pocket from the manual.** Read the index and the feature page before the source.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A command says "No CLI token at …" or "Pocket Code is not running here" | The daemon is not running, or the command reads a different data directory | Start Pocket, or run the command from the Pocket Code directory so it reads the same `.env`. |
| "Pocket Code is not reachable at http://127.0.0.1:…" | Wrong address, or a Codex Review-mode sandbox blocking loopback | Check `cli-url` and `POCKET_URL`; under Codex Review actions, the step needs Full access. |
| `401` / "unauthorized" | The token in `cli-token` changed (Pocket restarted) or the call came through a proxy instead of loopback | Run the command again on the server itself. |
| "Projects is off" (or Files, Tasks, Inbox Watch, the Vault) | The feature is switched off | Tell the user it is turned on in **Settings → Projects, files, tasks & vault** (in Assistant mode, **Settings → Features**; when Assistant mode is locked, by the person who runs the install). |
| Your instructions do not mention a feature the user just turned on | The lines are fixed when your process starts | The next conversation, or this one after its process restarts, gets them. |
| Codex conversations get none of Pocket's lines | Codex's `config.toml` sets `developer_instructions` | Tell the user; the installed skills still apply. |
| An installed skill is not Pocket's version | A folder of the same name without `.pocket-managed` exists | Pocket leaves it alone. The user can remove it, and Pocket installs its own at the next start. |
| `npx pocket-start` or `npx pocket-notify` fails | They are not package commands | Run `node scripts/pocket-start.mjs` or `node scripts/pocket-notify.mjs`. |
