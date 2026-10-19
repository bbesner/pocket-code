# Changelog

Every version that reached a server is listed here, newest first, with its frontend asset
build. Each has a matching [GitHub release](https://github.com/bbesner/pocket-code/releases).

## [1.68.0] — 2026-10-19 · build 132

- **The Gmail, Calendar and Drive instructions reach the agent with every message.** 1.64 delivered `pocket-google` only as an installed skill, so a server running `POCKET_SKILLS=0` never saw it. Siri's and Ramesh's boxes run that way on purpose: their Codex home is shared with the UltraWeb chat container, where Pocket's installed skills would shadow the tenant's own. Each Claude turn (`--append-system-prompt`) and each Codex thread (`developerInstructions`) now carries one line, as Files, Projects, Tasks and the Vault already do: use this agent's connectors from Settings → Connectors, check whose Google account it is, draft every email and show it first, send when asked and never refuse, ask before sending invitations, and read `skills/pocket-google/SKILL.claude.md` or `SKILL.codex.md` in the checkout for the full procedure. The line needs no setting and does not depend on `POCKET_SKILLS`. A Codex `config.toml` with its own `developer_instructions` still keeps all of Pocket's lines out, as since 1.39 (Siri's and Ramesh's do not set one). Asked for by Brad.
- Migration: none. The installed skill stays as it was where skills are on.
- Tests: `test/skills.test.mjs` checks that each agent's line names its own file, that the file exists in the checkout, and the draft-first and never-refuse wording; the runner suite checks a Claude turn carries the line with and without `POCKET_CHOICES`; the Codex session suite checks a new thread's developer instructions carry it.

## [1.67.0] — 2026-10-19 · build 131

- **Automatic model choice is set in Settings.** **Settings → Agents & instance → Automatic model choice**: the switch, the decision model (TypeSafe Jev through OpenRouter, or OpenAI's Decisions API), the key, and the four levels (Quick, Standard, Careful, Deep), each with a model and an effort. A model list holds only the models this Pocket offers, strongest first; *Automatic* follows the newest offered model of the level's family, so a newer model is used as soon as it is offered, and the decision model never needs to know model names. Effort stops at the managed policy's ceiling. Each level shows what it runs now; the block shows the last choice or failure. A key is saved to `<data dir>/router-key` (0600) and is never shown or sent back; **Use the server's settings** clears everything saved here so `POCKET_ROUTER*` applies again. A saved choice wins over the environment.
- **One sign-in is set in Settings.** **Settings → Agents & instance → One sign-in**: team, audience tag and the emails that may sign in, validated; **Turn off**; **Use the server's values**; the status names who can sign in and the last sign-in. It applies at once, no restart.
- **The effort picker offers only what the policy allows.** With `maxEffortLevel` in Claude Code's managed settings, levels above it are no longer listed for Claude.
- **A locked Assistant mode explains itself.** With `POCKET_ASSISTANT_MODE=locked` the switch stays in Settings → Appearance, disabled, saying the server keeps it on.
- Migration: none. `router` and `access` may appear in `pocket-settings.json`; the router key is its own file.
- Tests: `test/settings-router-access.test.mjs` (key saved 0600 and never returned, a level that names a model not offered is refused, a level's effort capped, a typed request runs the level's choice with the saved key, reset removes the key; environment settings and Settings overriding them; Access settings validated, on, off and reset live, last sign-in reported). The browser suite opens both blocks at 390 and 1440 and runs axe.

## [1.66.0] — 2026-10-19 · build 130

- **Working in background.** A conversation whose reply had ended while a Bash command run in the background or a subagent was still going showed Response ready, then Recent, as if nothing were happening; the agent would wake later to report the job and the list gave no sign of it. Brad found three such conversations at once. The server has always had the CLI's background job list for each conversation (it already kept such processes from idle-closing and refused to release them); the status just never read it. A conversation with no turn and at least one background job now reads **Working in background · 1 job** (or **2 agents, 1 job**), confirmed, in its own group between Running and Activity elsewhere, with the ember in the dim ink and a slower breath in the row, the title bar and the open-conversation tabs, so it is told apart from a live turn: you can send, and the conversation will wake on its own. The row's detail line names the first job; the status tooltip lists them all. It counts in the summary line (`1 running · 2 in background`), the Active filter and the Sessions button, never ages out of the list and cannot be hidden. Response ready, the New marker and the spoken alert arrive when the agent's follow-up turn ends, and the **Done** push is held until then rather than sent while the work runs. Codex conversations are unchanged (no job list).
- **The page height follows the visible screen only on touch screens.** 1.64.3's iPhone fix made the page height follow the visual viewport everywhere; on a desktop that value updates a frame after a window resize, so the message box could briefly sit below the window. Desktops keep the browser's own height again.
- Merged as 1.66.0 (PR #113 was written as 1.64.0 on 1.58.0 and renumbered when it landed after 1.65.0; its wording follows 1.59: conversation, reply).
- Migration: none. New conversation state `background` (with `background: {count, summary, jobs: [{kind, description}]}`) in `GET /api/sessions` and `GET /api/session/:id`.
- Tests: `test/session-state.test.mjs` (background outranks a finished outcome and transcript activity, never a live turn or a usage wait; agent/job counting; the list keeps the conversation). `test/runner.test.mjs`: a fake-CLI reply that leaves a job running reads background with the job named, the push is held, and the agent's own turn ends in Response ready; the existing background tests follow the new state. The browser suite shows the row, group, summary, dim ember and title-bar state at 390px with an axe scan.

## [1.65.0] — 2026-10-19 · build 129

- **Alerts from agents and jobs.** `node scripts/pocket-notify.mjs --title "…" --body "…" [--url /#/start/<id>] [--tag <key>] [--email]` sends a push to every subscribed device (a new notification kind, *alerts*, that every device receives for now; urgent, like a due reminder) and, with `--email`, a message to the address in **Settings → Notifications & voice** when the server has `POCKET_SMTP_URL`. Over HTTP, `POST /api/notify` takes the owner's cookie or the loopback token (direct loopback only, as for the board and start links). The link must be a Pocket path or start with the public address; opening the notification goes there. Made for Ari's inbox monitor, which pairs it with a start link so an alert opens a briefed New session; any job on the server can use it. Nothing in the interface changes; the device toggle for the new kind comes with the notification settings rework. Issue #111.
- Merged as 1.65.0 (PR #114 was written as 1.58.1 on 1.58.0 and renumbered when it landed after 1.64.3).
- Migration: none. A device subscribed earlier receives alerts (no preference saved means everything, as before).
- Tests: `test/notify-api.test.mjs` (token and cookie accepted, tunnel and signed-out refused, a missing title and a foreign link refused, the public address trimmed to a path, the email written through the file transport and reported off when no address is saved, the CLI printing the result).

## [1.64.3] — 2026-10-19 · build 128

- **The message box stays on screen on iPhone.** The message field and its buttons are now one unit (`.composer-entry`): a percentage width on the field let iOS Safari push the row with the box below the screen, leaving only the chips. The page height also follows the visual viewport (`--app-height`), so the home indicator can't cover the box. This fix ran on brads-server from October 17 as an uncommitted change; it is now released.
- Migration: none.

## [1.64.2] — 2026-10-19 · build 127

- **A file the conversation kept in Files gets a card too.** 1.61's cards needed the reply to name the file's path; an agent that keeps a report with `pocket-docs add --session …` and then says "it's in your Files" left nothing to tap (Brad, on the Addison Reserve storm report). Every Files item linked to the conversation now shows as a card under the first reply after it was kept: the library's picture, its title and file name, **In Files** and **Download**. Tapping it opens the file in Files the way **Settings → Open files and links** says. A file already shown by a path card isn't repeated.
- Migration: none.

## [1.64.1] — 2026-10-19 · build 126

- **Try harder stays in view and uses Opus.** The button arrived after the finished reply had scrolled to the bottom, so it sat half under the message box; it now keeps the view at the bottom when you're there. It asks for Opus when Opus is offered (Fable stays a choice you make yourself), else the strongest offered model.
- Migration: none.

## [1.64.0] — 2026-10-19 · build 125

- **Claude and Codex know how to work in Gmail, Google Calendar and Google Drive.** A new agent skill, `pocket-google`, is written on every server next to `pocket-files` and the others, in two versions: Claude Code's (`~/.claude/skills`) names the claude.ai connectors (`mcp__claude_ai_Gmail__…`, `…Google_Calendar__…`, `…Google_Drive__…`, loaded with ToolSearch when deferred), and Codex's (`$CODEX_HOME/skills`) names the ChatGPT apps (`…gmail_…`, `…google_calendar_…`, `…google_drive_…`). Both are the connectors **Settings → Connectors** links (1.53). Each covers Gmail search syntax and reading whole threads before replying, an inbox report, free time before booking, and its own Drive tools: the Claude connector's `search_files` query syntax (`parentId = '…'` for a folder's contents, file types as `mimeType`), the Codex app's `list_folder` (a `url`) versus `get_file_metadata` (a `fileId`). Asked for by Brad.
- **Drafts first, sends when asked, never refuses.** Every email is written as a Gmail draft and shown in the chat, with "Send it, or change anything first?"; "send it" sends the saved draft (Claude: `send_message` with the `draftId`; Codex: `send_draft`), and "just send it" sends without the extra check. Claude's drafts include the person's Gmail signature (`includeSignature`). Calendar events with other attendees are shown before invitations go out, the same way. Drive deletes are confirmed by name first (Codex's are permanent; Claude's go to the Drive trash).
- **Whose account is it.** Before the first Google action in a conversation the agent finds the connected account (Codex: the app's `get_profile`; Claude, which has no profile tool: the primary calendar's id or the sender of the newest sent mail). When it is someone else's account, the agent says so and points to Settings → Connectors, and never asks the person to share their files with that other account. On Siri's server, Codex's Drive app turned out to be connected to Damon's Google account; the agent asked her to share her folder with his address, and then misread a forwarded email that began "Morning Damon" as proof that her own inbox was Damon's. The skill names both mistakes.
- `POCKET_SKILLS=0` still turns all of Pocket's skills off, and a user's own `pocket-google` folder is left alone.
- **Test servers no longer touch the real skill folders.** About twenty test files start a real daemon with the developer's own `HOME`; they relied on Projects, Files, Tasks and the Vault being off. With an always-on skill they would have written `pocket-google` into `~/.claude/skills` and `~/.codex/skills` on every run, so each now sets `POCKET_SKILLS=0`. Checked by running the whole suite with `POCKET_SKILLS` unset: nothing is written.
- Migration: none. Restart (or any settings save) installs the skill.
- Tests: `test/skills.test.mjs` checks that `pocket-google` installs whatever the features, that Claude Code gets the connector version and Codex the apps version (each naming only its own tools), that a second run rewrites nothing, that a user's own copy is skipped, and that `POCKET_SKILLS=0` writes nothing.

## [1.63.0] — 2026-10-19 · build 124

- **One sign-in behind Cloudflare Access.** When Pocket sits behind a Cloudflare Access application, it can trust that sign-in instead of asking for its own password as well. Set `POCKET_ACCESS_TEAM` (`<team>.cloudflareaccess.com`), `POCKET_ACCESS_AUD` (the application's audience tag) and `POCKET_ACCESS_EMAILS` (who may sign in this way); with any of them missing nothing changes. Pocket verifies the `Cf-Access-Jwt-Assertion` token itself: RS256 only, signed by a key Cloudflare publishes for that team (cached, refreshed hourly; a failed refresh keeps the cached keys for up to a day and retries after a minute), issued by that team, for that application, unexpired, and for an ASCII email on the list. A header without Cloudflare's signature is worthless, whether or not it came through the tunnel.
- **A day at most.** A browser signed in through Access gets Pocket's normal cookie for no longer than the Access token's own life and at most 24 hours, so someone removed from Access or from the list is out within a day; the next visit through Access signs in again without a prompt. Password sign-ins keep 90 days.
- **Same-site only.** A cross-site or foreign-origin POST cannot sign in through Access (Cloudflare's own cookie may be sent cross-site); Pocket's cookie stays `SameSite=Lax`. Sign-ins are logged once an hour per person; refusals once a minute per reason; tokens never.
- Security review (independent agent, 2026-10-19): no way to forge a sign-in found; its medium findings (cookie lifetime, cross-site requests) and low findings (refresh failure, malformed header, Unicode or non-string emails) are fixed in this release.
- Migration: none.
- Tests: `test/access.test.mjs` (a valid token; refused: another key, an unknown key, another issuer or application, expired, not yet valid, no expiry, another or missing email, a Unicode look-alike, an array email, `alg: none`, HS256, a tampered payload, a null header, garbage; off unless all three settings are set; no keys means refused; a failed refresh keeps cached keys a day with back-off; over HTTP: the cookie it sets works, lasts no longer than the token, a token alone works per request, no token or a bad one is signed out or 401, cross-site and foreign-origin POSTs are refused, the password still works, tokens never logged).

## [1.62.0] — 2026-10-19 · build 123

- **The model is chosen for you in Assistant mode.** A request typed from scratch is sent once to a small decision model, which answers which of four levels it needs: *quick* (a lookup or short answer: Sonnet, low effort), *standard* (an email, a summary, an explanation: Sonnet, medium), *careful* (several steps, figures that must reconcile: Sonnet, high) or *deep* (a proposal, deck, report or hard analysis: Opus, high). It only chooses among the models this Pocket offers (Settings and the managed policy) and falls back a level when one isn't offered. The conversation keeps that choice for later replies. A saved prompt that names a model and effort uses them, as before. Anything that goes wrong (no key, a timeout over 1.5 s, an error, a refusal, an answer under 35% confidence) runs the instance default, exactly as before.
- **Turning it on.** `POCKET_ROUTER=jev` (TypeSafe Jev through OpenRouter's decisions endpoint) or `openai` (OpenAI's Decisions API, `gpt-6-luna`), with `POCKET_ROUTER_KEY` or `POCKET_ROUTER_KEY_FILE`; `POCKET_ROUTER_TIMEOUT_MS` (default 1500). Off unless set. `/api/settings` reports the provider, the effort ceiling and the last decision or failure. A 20-request check through Jev on 2026-10-19 put every request in the expected level, p50 138 ms; a backtest on real first messages from the seats is still to do.
- **Try harder.** In Assistant mode the latest Claude reply has a **Try harder** button: it asks for another, more careful pass on the strongest offered model at high effort, and the conversation keeps that choice.
- **The policy's effort ceiling is honoured.** `maxEffortLevel` in Claude Code's managed settings now caps the effort Pocket asks for on every Claude turn, whatever the picker, a saved prompt or the router says.
- Migration: none. A routed or Try-harder choice is kept as `routed` in `session-meta.json`.
- Tests: `test/router.test.mjs` (levels onto offered models with fallback and the ceiling; Jev and OpenAI requests and answers; HTTP errors, refusals, unknown levels, low confidence and timeouts fail open; no key or an unknown provider is off; over HTTP with a fake decision endpoint: a deep request runs Opus capped to the policy's medium, later replies keep it, an explicit choice sticks, a light request runs Sonnet low, a dead router runs the default).

## [1.61.0] — 2026-10-19 · build 122

- **Files in the conversation.** A file a reply hands you (a link, a path in a code span or on its own line) now shows under that reply as a card: the first page of a PDF as a picture, or the file's type, its name, and **Keep in Files** (or **In Files**) and **Download**. Tapping the card opens it the way **Settings → Open files and links** says (a tab, beside the conversation, or a new window): a kept file opens in Files; a PDF, page or text file opens in Pocket's own viewer, still sandboxed; an Office file downloads. Images already show in the reply and get no card.
- **Keep files from replies.** **Settings → Projects, files, tasks & vault → Keep files from replies** (this Pocket, needs Files on) keeps every PDF, deck, sheet, document, page or image a reply hands over in Files, once, linked to its conversation. Always on in Assistant mode. A kept file remembers where it came from (`source` in `documents.json`), so a second reply naming it keeps nothing new.
- The artifact route takes `inline=1` (readable files shown in place, same sandbox policy) and `thumb=1` (the first page of a PDF or a scaled image, cached under `<data dir>/artifact-thumbs`; an agent-made HTML page is never rendered on the server).
- Migration: none.
- Tests: `test/file-cards.test.mjs` (a file named in a reply is marked, one only written by a tool is not; inline and picture rules; Office stays a download; another conversation's file is refused; auto-keep keeps once and stops when turned off). The fake CLI's `__FILE__ <path>` reply hands a file over.

## [1.60.0] — 2026-10-19 · build 121

- **Assistant mode.** A per-Pocket switch for people who don't write code. It opens on the message box ("What would you like done?") with the saved prompts, a short getting-started note, **Waiting for you** cards for a conversation that has a question, needs an OK or didn't finish, the five latest conversations and **See all conversations**, and buttons for Files, Tasks, Projects and the Vault when they're on. The message box is Attach, the mic and Send; the model, reasoning, permissions and Codex chips, the settings toggle, Choose a skill, Save as prompt, the cache ring, alerts and the Steer now / After this reply choice are hidden (a message sent while Claude works waits for the current reply). A conversation hides Results, Queue, Git, changed files, split view, the folder name, the idle state and the cost line, and steps show only their plain words. Settings shrinks to Appearance, Conversation, Accounts, Notifications & voice, and Help & updates. The app is called **Pocket Assistant** (header, window title, sign-in page and the installed app's name). Nothing is removed: turning it off brings every control back.
- **Turning it on.** **Settings → Appearance → Assistant mode** (this Pocket, every device), or `POCKET_ASSISTANT_MODE`: `on` sets the starting value, `locked` keeps it on and takes the switch out of Settings (for seats run for someone else), `off` or unset starts with the full workbench. `/api/me` reports `assistantMode` and `assistantLocked`; `/manifest.webmanifest` is served with the name that matches.
- **Notifications in Assistant mode** say "Ready" without the cost and time.
- Migration: none. `assistantMode` is added to `pocket-settings.json` on first start.
- Tests: `test/assistant-mode.test.mjs` (off by default, Settings on and off, saved; `on` and `locked` from the environment; locked refuses to turn off; the sign-in page sees the mode; the manifest name). The browser suite opens Assistant mode at 390 and 1440 (home, a conversation, Settings, See all) and runs axe on each.

## [1.59.0] — 2026-10-19 · build 120

- **Plain words.** Pocket says *conversation* instead of *session* and *reply* instead of *turn* everywhere you read it: the list, New conversation, the message box ("Reply…"), tabs, tips, notifications and spoken replies. Ids, routes, settings keys and the CLI commands are unchanged.
- **Steps in plain words.** Each tool call reads as a step a person can follow: "Saved Proposal.pdf", "Checked Gmail", "Searched the web for “HOA grants”", "Started a helper: …", with the raw call (the full path or command) beside it in the ledger font when it adds something. A run of steps folds to "3 steps · Saved Proposal.pdf". Connectors are named by service and verb (Gmail, Google Calendar, Drive, past conversations for MemStem, the browser). **Settings → Conversation → Describe steps in plain words** (this device, on by default) turns it off and shows the tool name and detail as before.
- **Clearer approval cards.** A request reads as a question ("Save Proposal.pdf?", "Run: Convert the deck to PDF?", "Make a Gmail draft?"), shows the whole command, path or address it acts on, and keeps the full request behind **Show details**. The buttons are **Don't allow** and **Allow**. The banner and the working label say "Waiting for your OK". Nothing about what is asked, auto-allowed or audited changed.
- **Notifications** say "Ready · $0.07 · 14s", "Something went wrong. Tap to see what happened", "Stopped" and "Usage limit reached. Picks up again at …".
- Migration: none.
- Tests: `test/phrases.test.mjs` (steps for files, commands, web, skills, helpers and connectors in Claude and Codex name forms; questions; the command under an approval is never clipped; odd input never throws). Browser and unit expectations updated for the new words.

## [1.58.0] — 2026-10-17 · build 119

- **New session has the conversation's message box.** Starting a session had a large text area, a row of chips and a Start button, with model, reasoning and permissions hidden inside Edit setup, and no mic or hands-free. It now uses the same composer as an open conversation, at the bottom of the screen: the model, reasoning, permissions (and Codex mode) chips above the box, scrolling sideways with the same arrows; Attach, the settings toggle, **Choose a skill** and **Save as prompt** beside it; the mic, the hands-free headset and the Send arrow on the right. Enter starts the session on a desktop, Shift+Enter adds a line, as in a conversation. The task heading, saved prompts, Recent and the Workspace · Agent · Permissions setup card stay above; Edit setup now holds the agent, the project and a custom path. A missing workspace or task, an unconfirmed start (with **Retry start** and **Discard retry**) and a linked project show where they did.
- **Voice in New session.** The mic dictates into the task, or starts the session with what was said, the same way it sends a message in a conversation (Review before sending and a typed draft still only add the words). The headset starts a hands-free conversation: Pocket reads the instruction back, starts the session after "send it" or a tap on Send, and the conversation, and its spoken reply, carry on in the new session. Nothing starts without a yes; if the session cannot start (no workspace, a message held as a secret), hands-free turns off and says so.
- Migration: none.
- Tests: the browser suite checks every composer control in New session at 390px (44px targets, in the composer, Start named), an axe scan of it, and a hands-free start that waits for a yes, starts the session and carries the conversation into it. Existing New session checks now read the Start button's name instead of its text.

## [1.57.0] — 2026-10-17 · build 118

- **Start links.** An agent or a job on the server can hand Pocket a briefing and get back a link. Opening it signed in lands on New session with the briefing already typed in, in the workspace and with the agent the link named, and nothing starts until Start is tapped. Made for alerts that arrive elsewhere: Ari's inbox monitor sends a Telegram message with an **Open in Pocket Code** button, so handling one is a tap and a sentence rather than a copy and paste. `node scripts/pocket-start.mjs add --file <briefing.md|-> [--dir <workspace>] [--provider claude|codex] [--title …] [--ttl-days N]` prints the URL; `show <id>` prints a stored briefing. Over HTTP, `POST /api/start` and `GET /api/start/<id>` take the owner's cookie or the loopback token (direct loopback only, as for the board); a briefing may quote private mail, so nothing else reads one. Links expire after 7 days (1 to 30), `<data dir>/starts.json` keeps at most 500, a briefing is at most 20,000 characters. The URL uses the address the owner last signed in from (`POCKET_PUBLIC_URL` overrides); without one the CLI prints the path.
- Migration: none. New file `starts.json` in the data directory on first use.
- Tests: `test/starts.test.mjs` (the store's limits, ids and expiry; over HTTP: token and cookie writes and reads, signed-out and through-the-tunnel requests refused, an unknown id, the CLI printing the URL and showing an entry).

## [1.56.1] — 2026-10-16 · build 117

- **A restart no longer takes the agents' PATH away.** PM2 gives a daemon restarted through `ecosystem.config.cjs` the environment of the shell that ran the restart, and every Claude Code or Codex session Pocket starts inherits that PATH. A deploy over ssh, or from an agent's own shell, is not a login shell: the user's bin directories dropped off, and an MCP server registered by bare name (`memstem`, installed by pipx into `~/.local/bin`) failed with `Executable not found in $PATH` while the daemon, its health page and the memory service all looked fine. On Damon's server every Pocket-started session ran without memory from October 5 to October 16 for this reason. The ecosystem file now appends `~/.local/bin`, `~/.npm-global/bin`, `~/bin` and the directory of the node running PM2 when they exist and are missing, keeping the current entries and their order first, so nothing is shadowed. Nothing to migrate: the next `pm2 restart ecosystem.config.cjs` applies it. [Operations: upgrade](docs/operations.md#upgrade-an-existing-installation) says what to do on an older checkout.
- Tests: `test/ecosystem.test.mjs` loads the file as PM2 does (only `apps` is visible), checks the pinned PATH keeps every current entry and adds the node directory without duplicates, and exercises the append, skip-missing and no-duplicate rules against a fake filesystem.

## [1.56.0] — 2026-10-16 · build 116

- **Read-only actions can run without asking.** In Review actions (the default) every Claude command, MCP tool call and web lookup showed an approval card, including harmless reads like a quote lookup or a memory search. **Settings → Agents & instance → Actions that run without asking** lists the read-only actions Pocket approves itself: when Claude asks to run one, Pocket answers Allow without a card; anything else shows the card as before. Rules are a subset of Claude Code's: `Bash(command:*)` (also written `Bash(command *)`), `Bash(exact command)`, `mcp__server__tool`, `mcp__server__*`, `WebSearch` and `WebFetch`. Edit, Write, NotebookEdit, Agent/Task, PowerShell and blanket rules (`Bash`, `Bash(*)`, `mcp__*`) are refused, with the reason under the field. Asked for by Brad, for employees who work in Review actions.
- **Strict matching.** A Bash command runs without asking only when it is one plain command whose first words are the listed ones, compared as written: any of ``; & | ` $ ( ) < > { } \``, a line break or other control character, an unquoted `*`, `?` or `[`, an unclosed quote, a leading `VAR=value`, a path or wrapper (`/tmp/techpro-lookup`, `sudo techpro-lookup`), a look-alike name (`techpro-lookupx`, `techpro-lookup-evil`) or an unexpected Bash option shows the card. Quoted arguments are fine. A server wildcard covers that server only (`mcp__memstem__*` does not match `mcp__memstemx__…`).
- **Same audit guarantees.** Each automatic approval is written to `approval-decisions.jsonl` before Pocket answers the CLI, as `"event":"auto-allowed"`, `"decision":"allow"`, `"source":"auto-trusted"` with the tool name and the rule, never the command or its arguments. If it cannot be recorded, Pocket falls back to the card. The blanket ask rules stay in place (they outrank allow rules in user and project settings). Full access and Codex turns are unaffected. A convenience, not a security boundary: a listed command runs with any arguments ([action approvals](docs/action-approvals.md#actions-that-run-without-asking)).
- **Where the list comes from:** a list saved in Settings (`trustedActions` in `pocket-settings.json`; an empty saved list means every action asks), else `POCKET_TRUSTED_ACTIONS` in `.env` (one rule per line or comma-separated; unusable rules are logged at start, shown in Settings and skipped), else none. Settings says which applies; **Use the server's list** forgets the saved one. A change applies to the next request, including in running turns.
- Migration: none. New optional settings key `trustedActions`; new optional env var `POCKET_TRUSTED_ACTIONS`. With neither set, behavior is unchanged.
- Tests: `test/trusted.test.mjs` (the matcher against injection, look-alikes, paths, env prefixes, globs, here-documents and MCP boundaries; rule validation and the env list) and `test/trusted-actions.test.mjs` (auto-allow bound to the live turn and audited first; over HTTP with the fake CLI: env default, a trusted Bash and MCP request answered without a card, untrusted ones still carded, Full access untouched, Settings validation and persistence, an empty saved list, an unwritable audit). The browser suite edits the list in Settings at 1440 and 390 with axe scans.
## [1.55.0] — 2026-10-16 · build 115

- **A Pocket can be locked to one workspace.** `POCKET_LOCK_CWD=1` beside `POCKET_DEFAULT_CWD` pins every session to that folder: the New session screen shows it under **Workspace** with *Every session starts here* and no picker or custom-path field, `GET /api/projects` answers with that one folder and `locked: true`, and a start that names another folder is moved there (logged, not refused), so a stale remembered workspace in a browser cannot escape it. Resuming a session keeps that session's own folder. Without a valid default folder the flag is ignored and logged. Made for the TechPro seats, whose users should never have to think about folders; the seat provisioning kit sets it.
- Tests: `test/defaults.test.mjs` starts a locked daemon (one folder listed, a start elsewhere lands in the folder, the flag without a default is ignored); the browser suite shows the locked New screen (no radios, no path field, the summary names the folder) and the picker's return when the lock is off.

## [1.54.1] — 2026-10-16 · build 114

- **Only links to this Pocket's own things follow the setting.** 1.54.0 sent every link in a conversation through **Open files and links**, including outside websites, which it tried to show inside a pane or tab; a site that forbids that got a note instead of the page. Brad, on meeting the note for an outside site: "I really only meant for links that are to our own internal documents." Now a link to a file, a project, a session, a share or public link to one of your own files, or an image or file served by this Pocket opens the way the setting says; a link to any outside website opens in your browser, as before 1.54.0. The link view (`#/link/<address>`) stays for Pocket's own images and files only.
- **Removed:** the framing check (`GET /api/link/frameable` and `links.mjs`), the app's `frame-src https:` policy (back to `'self'`), and the refused-frame note. Nothing to migrate; the check kept no state.
- Tests: the browser suite now clicks a link to a kept file beside (a pane showing the file, the conversation staying put) and as a tab (Back to the conversation), and checks that an outside link is left to the browser under every setting. The fixture's first conversation ends with a link to a kept file when Files is on.

## [1.54.0] — 2026-10-16 · build 113

- **A link in a conversation opens the way files do.** Every link in a conversation used to open a new browser tab, whatever **Settings → Open files** said. The setting is now **Open files and links**, and a plain click on a link in a message (or in the Results panel) follows it: *as a tab* shows the page in this column with a tab in the strip, named by the link's text; *beside the conversation* opens it in a split pane (from a pane, a new pane to its left, as files do since 1.53.3); *in a new browser window* leaves the browser to it, as before. A Pocket address (`#/documents/…`, `#/projects/…`, a session) opens that view, following the projects setting for a project; a share or public link to one of your own files opens the file itself; a download link stays a download. Modified clicks (middle, Ctrl, Shift) keep the browser's behaviour. Asked for by Brad.
- **The link view** (`#/link/<address>`) frames the page with **Open in browser** and **Copy link** above it, and opens in a window of its own like any view. A file from this Pocket is framed with the file viewer's sandbox; another site is its own origin, isolated from the app (the app's policy now allows `frame-src https:`). Many sites forbid showing inside another app (GitHub, Google Drive, most sign-in pages) and the browser gives no way to read that, so the daemon checks the page's `X-Frame-Options` and `frame-ancestors` once an hour per address (`GET /api/link/frameable`, public hosts only: loopback, private, link-local and cloud-metadata addresses are refused on every redirect hop) and the view replaces a refused frame with a note naming the site and an **Open in browser** button. On a phone an outside site opens in the browser, where it can be used; a file from this Pocket still opens in the app.
- Tests: `test/links.test.mjs` covers the address rules, the framing verdicts (deny, sameorigin, `frame-ancestors` with hosts, wildcards, schemes and `'none'`), redirects into private ranges, and the probe cache; the browser suite clicks a link in a conversation beside and as a tab, checks the pane, the tab's name, Back to the conversation and the refused-frame note, and that the window setting leaves the link to the browser.

## [1.53.5] — 2026-10-16 · build 112

- **Codex conversations open fast.** Opening a Codex session read the whole thread oldest-first on every open. A thread that had generated images inline (six `imageGeneration` items of 4.7 MB base64 each in a 51.6 MB rollout) took 26 seconds, and Pocket never shows those bytes. Three changes in the daemon: a thread is now read newest-first in pages of 40 items, only as far back as the view needs, with older pages fetched on demand when deep find, results or a summary ask for more; each item is reduced to its display message as soon as it is parsed, so image payloads are dropped at once and never held; and the result is kept per thread, in memory (30 threads) and on disk (`<data dir>/codex-transcripts/`, newest 300 files kept), so a later open fetches one newest page and merges it, refreshing items that changed (a command gaining its exit code). Items from turns Pocket runs are added to the cache as they complete, so a thread Pocket drives is never cold. Legacy-format threads, which the app-server cannot page, are reread at most every 15 seconds.
- The first open of a thread that already holds inline images is still paid once; that cost is Codex serialising the images, which no request shape avoids.
- Tests: the fake app-server pages `thread/items/list` with cursors in both directions and caps a page at 100 like the real one; a new Codex session test opens a 127-item thread with two 3 MB image items newest-first in 40s, reopens with one page, merges news, survives a restart from the disk cache, and checks no image bytes reach the response.
- No frontend change; the build number moves so the in-app release notes refresh.

## [1.53.4] — 2026-10-16 · build 111

- **Opening a tab no longer waits seconds behind the server.** With a long Codex session open, every tab took several seconds to show its conversation. Two causes, both in the daemon. The reader for the Codex app-server's output rejoined and re-split its whole pending text on every 64 KB chunk, so one large reply cost time quadratic in its size: a 17 MB page of a 50 MB thread's items held the server's only thread for 3.9 s, and every other request, including the tab being opened, waited behind it. The reader now scans only the new chunk and joins a long line once (`LineBuffer`, with unit tests). And the open conversation's agent-activity poll, every 5 s, read that whole thread each time (18 MB and 5.5 s of Codex time per poll); it now keeps the thread's agent items after one walk and merges only the newest page, walking again only when more items landed than a page holds. Legacy-format threads, which the app-server cannot page, are reread at most every 15 s.
- Tests: `test/codex-reader.test.mjs` frames lines across every chunk boundary and bounds a multi-megabyte line; the fake app-server pages `thread/items/list` like the real one and records each call, and the Codex session suite checks that a second agents poll fetches one newest-first page instead of the thread.
- No frontend change; the build number moves so the in-app release notes refresh.

## [1.53.3] — 2026-10-16 · build 110

- **A file opened from a split pane gets a pane of its own, to the left.** With **Settings → Open files** (or **Open projects**) set to *Beside the conversation*, choosing a file inside the file library open in a split pane used to load the file in that same pane, over the library. The pane now asks the window around it for a new pane, placed to the pane's left (between the conversation and the library), so the list stays in view and the next file opens the same way. The same goes for a project chosen in a pane, a session chosen from a project card in a pane, and **Open beside** in a pane's file and project option sheets, which now say *In a new pane to the left of this one*. From the main conversation nothing changes: a new pane still goes to the right. The window still decides whether there is room (up to four views, each at least 380px wide) and says so when there is not. Asked for by Brad.
- Panes are inserted without moving existing frames, so the library's scroll position, search and selection survive, as before.
- Tests: the browser suite opens the library beside a conversation, picks a file in it, and checks that the file's pane appears to the left while the library pane keeps its frame and route.

## [1.53.2] — 2026-10-16 · build 109

- **Connectors names the real problem when a read fails.** On Siri's and Ramesh's servers, where Codex is signed in with ChatGPT and Gmail, Calendar and Drive are already connected, the sheet said *Codex could not list its apps. Check that it is signed in with ChatGPT*. The real cause: chatgpt.com sometimes answers a cloud server's connector-directory request with a Cloudflare bot check (an HTML page) instead of the list. The sheet now says *chatgpt.com turned away this server's request with a bot check … try again in a minute*. Timeouts and other failures read as such instead of blaming the sign-in, and the same goes for Claude Code.
- **A failed read is not kept.** 1.53.0 kept every result for a minute, failures included, so Refresh showed the same error. Failures are now logged on the server (`connectors: codex read failed: …`, a short detail, never the HTML page) and the next open or Refresh tries again.
- Tests: `test/connectors.test.mjs` covers the bot-check page (named, never shown), timeouts, HTML stripped from other errors, and that a failed read no longer blames the sign-in.

## [1.53.1] — 2026-10-16 · build 108

- **A signed-out Claude Code reads as signed out.** `claude auth status --json` exits 1 when nobody is signed in, though it still prints its status; Pocket treated the exit as a failed check. Accounts & instance said *Could not verify* (with **Switch account**) instead of *Not signed in* (with **Sign in**), and the 1.53.0 Connectors sheet listed Gmail, Calendar and Drive as *Not connected* instead of asking for a Claude sign-in first. Pocket now reads the printed status whatever the exit code; output it cannot read still counts as unknown. Found on the four TechPro agent seats right after the 1.53.0 rollout.
- Tests: `test/environment.test.mjs` covers a CLI that exits 1 with a signed-out status, and one that exits 1 with unreadable output.

## [1.53.0] — 2026-10-16 · build 107

- **Connectors: Gmail, Google Calendar and Google Drive for each agent.** **Settings → Agents & instance → Connectors** shows, for Claude Code and for Codex, whether each Google service is connected, with **Connect** or **Reconnect** beside the ones that are not and **Refresh status** to check again (it also checks again when you come back to the window after connecting). Pocket reuses the connectors the CLIs already have: Claude Code's claude.ai connectors (read with `claude mcp list`) and Codex's ChatGPT apps (read with the app-server's `app/list` and `app/read`). Anthropic and OpenAI hold the Google authorization, so Pocket stores no Google token and needs no Google Cloud project, and it works the same for every install. Neither CLI can make a first connection, so Connect opens claude.ai's connector settings or the app's chatgpt.com page. Both sets of tools go well beyond drafts: Claude's Gmail, Calendar and Drive connectors search, read, send, reply, label, manage events and create, edit and share files; Codex's Gmail, Calendar and Drive apps list 21, 15 and 45 tools. Asked for by Brad for the TechPro agent seats.
- The sheet explains instead of offering a broken button when connectors cannot work: Claude connectors switched off by `disableClaudeAiConnectors` (user settings or managed policy) or `ENABLE_CLAUDEAI_MCP_SERVERS=false`, a Claude or Codex sign-in that uses an API key, a signed-out CLI, or Codex turned off (`POCKET_CODEX=0`) or not installed. Connect links only ever point at claude.ai or chatgpt.com.
- `/api/connectors` (authenticated; `?refresh=1` forces a fresh read) returns each provider's rows. Results are kept for a minute, since `claude mcp list` health-checks every MCP server and a forced Codex refetch reads the whole app catalog (about 16 seconds); Codex reads only the head of `app/list`, where connected apps come first, instead of the full catalog (about 40 MB). New module `connectors.mjs`; `codex.mjs` exposes app reads only.
- Tests: `test/connectors.test.mjs` covers the `claude mcp list` parser, every switched-off and sign-in case, Codex paging, refetch on Refresh, admin-disabled apps and link validation; the HTTP test checks authentication and the response against the fake CLI; the browser suite checks the sheet at 390 and 1440 (states, link targets, Refresh, axe).

## [1.52.0] — 2026-10-15 · build 106

- **Choose which Claude models the picker offers.** **Settings → Agents & instance → Claude models in the picker** lists every Claude model Pocket knows; tap a row to offer it or stop offering it in the model menu on every device (at least one stays on). The choice is kept for the install in `pocket-settings.json`, outside the checkout, so updates leave it alone. For provisioning, `POCKET_CLAUDE_MODELS` in `.env` sets the list (comma-separated ids, e.g. `claude-sonnet-5-5,claude-opus-5-5[1m]`); a list saved in Settings wins over it, and **Use the server's list** goes back. With neither, every model is offered, as before. Asked for by Brad for the TechPro agent seats.
- **Claude Code's managed policy is honoured.** When `managed-settings.json` or `managed-settings.d/*.json` (`/etc/claude-code` on Linux and WSL, `/Library/Application Support/ClaudeCode` on macOS) sets `availableModels` or `deniedModels`, Pocket never offers a model the CLI would block, whatever the list says. Such a model keeps its row in Settings, marked *Blocked by this computer's Claude Code policy*. Matching follows the CLI's documented rules: drop-ins merged in name order, family aliases, version prefixes (and `availableModelsMatch: "exact"`), a specific version switching off its family's alias, `deniedModels` winning, and `[1m]`, dated and provider-prefixed spellings counting as the same model. File changes show within seconds, without a restart. MDM and claude.ai console policies are not visible to Pocket; the CLI still enforces them.
- **A blocked pick no longer runs on the expensive default unseen.** Before, a model the policy blocked was passed to the CLI, which silently swapped in the account default (Opus 5.5 on Brad's seats), so picking Sonnet or Haiku to save usage could run Opus. The server now never passes a model the picker does not offer: the turn runs on Default and the response, a toast and a line in the conversation name both models. Default is `POCKET_CLAUDE_MODEL` only while it is offered, otherwise the CLI's own default; the Default row names a managed `model` ahead of `~/.claude/settings.json`. A saved Claude pick the picker no longer offers goes back to Default in the composer (a Codex model the menu does not list is still sent, as before).
- **Helper calls stay inside the policy.** Titles, *While you were away* summaries and task briefings use `POCKET_TITLE_CLAUDE_MODEL` (default `haiku`); when the policy blocks it, they use the cheapest offered model it allows instead of letting the CLI fall back to its default. Settings names the model in use.
- **Sonnet 5.5 and Haiku 5.5 join the catalog** (`claude-sonnet-5-5`, `claude-haiku-5-5`; both 1M natively), each verified with one `claude -p --model <id>` call on CLI 2.1.293.
- `/api/claude/models` lists only offered models (and `limited`); `/api/settings` reports `claudeModels` (catalog rows with `selected`, `blocked`, `reason`, `offered`; `source` settings/env/all; the policy directory, files and read errors; the Pocket default) and accepts `offeredClaudeModels` (a list of catalog ids, or `null`). `POCKET_CLAUDE_MANAGED_DIR` points Pocket at another managed-settings directory (tests). New module `models.mjs`.
- Settings draws the model rows from the client's catalog before the server answers, so the desktop dialog does not grow under the pointer; a cleanup browser check clicking **All settings** caught the shift.
- Tests: `test/models.test.mjs` covers the matching rules, drop-in merging, selection parsing, helper fallback, and, against a fake CLI with a temporary policy directory, the offered list from `.env`, Settings and the policy, every turn path (offered, blocked, unoffered, unknown, Default), the saved choice and its validation, a policy change without restart, and helper calls naming only allowed models. The browser suite checks the Settings block at 1440 and 390 (blocked row, toggle, the picker narrowing, the last model staying on, the server's list, axe) and that an unoffered saved pick is not sent.

## [1.51.0] — 2026-10-15 · build 105

- **Stop all Claude turns before switching accounts.** Accounts & instance shows the active Claude turn count beside the Claude sign-in control. **Stop all Claude turns** requires a second tap that states how many turns will stop and what happens to their subprocesses. It handles turns waiting on approval as well as turns still producing output. Saved conversations remain; Codex turns and idle Claude background jobs keep running. If more Claude turns start after the confirmation, Pocket asks for a fresh review instead of stopping unseen work.
- The authenticated, same-origin `/api/claude/stop-all` endpoint checks the confirmed count, stops only Pocket-owned Claude turns and reports progress; `/api/claude/activity` supplies the live count. Added HTTP coverage for approval waits, authentication, CSRF, stale counts and saved transcripts, plus phone and desktop browser checks for cancel, confirm and the completed state.
- Claude runner recovery markers are now written atomically. A concurrent reader could previously see partial JSON while a turn or background job changed state; that caused an intermittent sign-in test failure and could prevent adoption after a daemon restart.
- A reviewed marker changed during an in-flight save is now flushed after that save completes. This covers Undo while another marker request is pending; the browser check waits for the server record instead of assuming a fixed network delay.

## [1.50.2] — 2026-10-15 · build 104

- **Reminder pushes reach an idle phone.** A due task, a due reminder and a Vault request were sent at the push service's normal priority, which Android holds back while the phone is idle, so the 1.50.0 test reminders never showed on Brad's phone while the same pushes marked urgent arrived at once. Those three kinds are now sent with `Urgency: high`; a finished turn stays normal priority so a busy session does not keep waking the phone. Found with Brad.
- **The icon count can never cost a notification.** The service worker sets the app icon's count after the notification is shown, guarded, so a browser that refuses the badge still shows the notification.
- The browser suite's resizable-rail check waits for the shell after a viewport change that toggles touch emulation (Puppeteer reloads the page then); it was the suite's recurring flake on CI and locally.

## [1.50.1] — 2026-10-15 · build 103

- **Settings looks like settings.** The Settings button in the header and the rail drew a small circle with eight short rays, which reads as a sun (a brightness or light control), not a gear; Damon raised it more than once. It is now an eight-toothed gear in the same 1.8px stroke, which also marks tool calls without a more specific icon. The composer's **Hide/Show message settings** toggle and **Permissions for the next turn** in a session's options use a new sliders icon, since they adjust one turn rather than open the app's Settings. No other change. Reported by Damon, via Brad.

## [1.50.0] — 2026-10-15 · build 102

- **Tasks is the one due list.** With Projects on, every open project reminder appears in the Tasks list and the rail's Tasks list among the dated tasks, soonest first, so the due ones lead: the row names the reminder, its project and the step, opens the project card, and its hourglass (or options) offers Remind later and Dismiss. The Tasks badge on the rail switch, the phone's Tasks chip and the tab mark count due tasks and due reminders together, and the Projects segment stops counting while Tasks is on (a project's own card and tab still mark its due reminders). **Scheduled** (`#/projects/scheduled`) opens the Tasks list on such an install; the Projects list's chip reads **Reminders** and points there. Installs with Projects on and Tasks off keep Scheduled as it was. Asked for by Brad after Damon found tasks and project reminders hard to tell apart.
- **A count on the app icon.** The installed app's icon shows how many tasks and reminders are due, on browsers that support it (Android, iOS 16.4 and later, Windows, macOS), updated whenever Pocket repaints its badges and, when a due item is announced, by the push itself, so a phone that has not opened Pocket shows the right number. **Settings → Notifications & voice → Count on the app icon** turns it off for a device.
- **Notifications, by kind and by device.** Settings → Notifications & voice now reads **Push to this device** (it was *Turn notifications*, though it already carried reminders and Vault requests) with three choices under it: **Finished turns**, **Due tasks and reminders** and **Vault requests**. The choices live with the device's subscription on the server (`/api/push/prefs`), so a phone can take reminders only while a desktop takes everything; subscriptions from earlier builds get everything, as before.
- **Answer a due notification where it arrives.** A due task's notification offers **Tomorrow** and **Done**; a due project reminder's offers **Tomorrow**. Tomorrow moves it to 9 AM the next day in the device's zone (a project reminder is replaced, the way Remind later works); Done finishes the task. Both go through the ordinary routes with the signed-in cookie; if the answer cannot land, Pocket opens instead. In the app, a dated task's sheet gains **Remind later** with the same quick picks as a project reminder.
- **A notice a day before.** **Settings → Notifications & voice → Notice a day before** (instance-wide) sends a second announcement 24 hours ahead of a dated task or reminder, by push, the reminder hook (with `ahead: true`) and email. An item set less than a day ahead gets only the due announcement.
- **Email, built in.** With `POCKET_SMTP_URL` (and `POCKET_SMTP_FROM`) in `.env`, **Settings → Notifications & voice** takes the address to email due tasks and reminders to, with **Send a test**. One short message per announcement, with a link to the list or card when the server knows its public address (`POCKET_PUBLIC_URL`, or the address the owner last signed in from). Pocket's own email is for due items only; the reminder hook remains for anything else. New dependency: `nodemailer`.
- **The counts show on every view.** The rail's Projects, Tasks and Vault segments only showed their counts after the Sessions home had loaded them or the segment had been opened; in a conversation, the badges stayed hidden until you clicked. The counts are now painted whenever the rail is drawn, from the cached lists at once and then from fresh ones, and refreshed every 30 seconds while the rail switch is on screen. Reported by Brad.
- `/api/tasks` and `/api/board` report `email`; `/api/settings` reports `email` (configured, from, to, hook) and `remindAhead`.
- Tests: `test/notify.test.mjs` covers push preferences (subscribe with prefs, read, change, old subscriptions), the settings (the address is checked, the day-before switch), announcements through the hook and a file mail transport for a due task, a due reminder and both day-before notices, and the test message; `test/tasks.test.mjs` covers the store's day-before rule; the browser suite checks the combined list, the badge handoff, the Scheduled redirect, Remind later on a task and the Notifications settings.

## [1.49.0] — 2026-10-15 · build 101

- **Start a session from a project.** Projects get the same Start that Tasks have. **Start session** on a project card (and first in the project's options) opens a New session in the project's directory with a briefing as the first message, ready to edit and send: where you left off, the next step, what it is waiting for, the open steps with their ids (up to 20), the last three notes, open reminders, the link, the last three sessions that worked on the project, and the `pocket-board` lines that keep the card current. The new session is linked to the project when it starts: `/api/new` takes an optional `project` and links the session for Claude and Codex alike, and a missing, finished or switched-off project never blocks the start. The project's chip beside Choose a skill shows which project the session will join; tapping it removes the link. The agent defaults to the one that last worked on the project, and a project's directory is chosen even when the install has a default workspace or the directory is not in the recent list. A briefing is not kept as a recent start. Requested by Brad.
- Task Start clears a pending project link, so a task's session is never linked to a project by an earlier Start session.
- Tests: `test/projects.test.mjs` starts a session with a project (linked, not a recent start) and with an unknown one (starts, logged); the browser suite checks the briefing, the directory, the chip, the payload, the link on the card and removing the link.

## [1.48.1] — 2026-10-14 · build 100

- **A just-sent Codex message no longer vanishes.** Pocket reads a Codex thread's history through a separate reader process, and that process has the new user message only a few hundred milliseconds after `turn/start` returns (measured against codex-cli 0.156.1). The client re-renders the conversation the moment the send is acknowledged, so it landed in that gap and dropped the optimistic bubble; the live stream then resumed after the turn's own `user` event, so the message stayed missing until the session was reopened. Claude sessions have been covered since 1.11.2; `/api/session/:id` now applies the same pending-message rule to Codex sessions, and the match allows for the "[Attached files…]" note Codex stores after the text when files are attached, so a message with attachments is not shown twice. Reported by Brad.
- Tests: `test/codex-session.test.mjs` sends a message the fake app-server writes to history 900 ms late, with and without the attachment note: shown at once as pending, replaced by the history item, never twice, nothing pending after the turn (fails on 1.48.0).

## [1.48.0] — 2026-10-14 · build 99

- **Codex context meter corrected.** Codex reports cached input tokens as part of its input tokens, not beside them the way Claude reports cache reads, and Pocket was adding the two. On a long session the ring read nearly double and sat at 100% from about 55% real (Ramesh's session: 153k input, 152k cached, window 258k, shown as 118%). The context is the input alone now. Found, verified against every call in that session's rollout, and patched in place on Ramesh's and Siri's boxes by Damon; this release carries the fix into the repository.
- **The meter reads the rollout.** A Codex session's context now comes from the rollout file Codex writes (`~/.codex/sessions/…/rollout-…-<thread>.jsonl`), the way a Claude session's comes from its transcript, so sessions run in a terminal or code-server show a figure too, and figures saved by the double-counting builds correct themselves on the next look. The daemon's own figure from `thread/tokenUsage/updated` remains the fallback.
- **Prompt-cache warmth for Codex sessions.** The ring's companion label (minutes left, amber in the last stretch, `cold`), the hourglass and snowflake tab marks on large sessions, the Prompt cache block in Usage and the `98% cached` / `cold start` note under a finished turn now apply to Codex sessions as well. Codex publishes no cache lifetime; OpenAI's guidance says five to ten minutes. Measured over 45,660 consecutive calls in 2,234 rollouts on the owner's server, every return after 60 to 120 idle minutes still read from cache (21 of 21) and every return after 150 minutes or more started cold (12 of 15, the rest partial), so Pocket uses two hours and the Lifetime fact says "measured; not published". Requested by Brad.
- Tests: `test/codex-rollout.test.mjs` covers the input-only context figure in both spellings, the rollout scan (last call, window, model, the first call of the last turn, warm and cold) and locating a thread's rollout under the dated folders with a tail read.

## [1.47.0] — 2026-10-13 · build 98

- **Runs on macOS.** The two places that read Linux's `/proc` (the stall watchdog's CPU-of-descendants figure in `proctree.mjs`, and the pid-reuse guard's command-line check in `server.mjs`) ask `ps` instead on a system without `/proc`, in the same unit (hundredths of a second), so a quiet turn that is still working is not stopped and a reattached session is still recognised. `claude` is also looked for in `/opt/homebrew/bin`. `pocket-init` and `install.sh` accept macOS, and the Boot check looks for PM2's launch agent (`~/Library/LaunchAgents/pm2.<user>.plist`) instead of a systemd unit. README and [docs/install.md](docs/install.md) say Linux or macOS, with a macOS notes section (Homebrew, PM2 at login, sleep, previews, Tailscale). Closes the code half of [#87](https://github.com/bbesner/pocket-code/issues/87); the first report from a real Mac is still wanted there.
- **Quieter installer.** `pocket-init` runs `npm ci` and `npm install -g pm2` with `--no-fund --no-audit --loglevel=error`, so npm's own lines no longer land in the middle of the checklist.
- Tests: `test/proctree.test.mjs` checks the `ps` TIME parsing in every shape, the table-to-tree walk, `commandLine` through `ps`, and on Linux that the `ps` backend sees the same live child tree and command line as `/proc`.

## [1.46.0] — 2026-10-13 · build 97

- **One command installs Pocket Code.** `curl -fsSL …/install.sh | bash -s -- --yes --contact you@example.com` clones the newest release, installs dependencies and runs the new **`pocket-init`** (`scripts/pocket-init.mjs`, also `npm run init`). It checks the platform, Node.js, Claude Code and its sign-in, Codex, PM2 (offering to install it) and the port; writes the missing lines of `.env` (a generated password, cookie secret and push keys, mode `0600`) while keeping anything already there and replacing `.env.example` placeholders in place; starts the daemon from the ecosystem file, saves the PM2 list, waits for `/api/health`, and prints how to add HTTPS, naming the tunnel or proxy it found (`cloudflared`, Tailscale, Caddy, nginx) with the exact lines for this port. Safe to run again. `--dry-run` reports without writing; `--json` gives the report as data. ([#86](https://github.com/bbesner/pocket-code/issues/86))
- **The password stays out of transcripts.** On a terminal `pocket-init` shows the new password once. Run by an agent or with output piped, it does not print it and tells the owner to read the `POCKET_PASSWORD` line of `.env` themselves. `POCKET_PASSWORD` in the environment chooses the password instead of a generated one.
- **An install guide an agent can follow.** [docs/install.md](docs/install.md): what each check means and what to do when it fails, the password rule, how an agent verifies the result, and HTTPS through Tailscale Serve, Cloudflare Tunnel, Caddy or nginx. The README quick start is the one command plus a pointer; the by-hand steps moved to the guide. Requirements name WSL2 for Windows and link the macOS issue.
- The browser suite's recurring `#toast` color-contrast failure (a toast arriving while axe measured the `subagents-mobile` view; it failed three of main's last four CI runs) is closed: the toast is kept out of the measurement for the duration of each axe scan and restored afterward.
- Tests run the real `pocket-init` against a temporary `.env` with a fake `claude` and `pm2`: dry run, first run, re-run, placeholder replacement, busy port, mismatched `--port`, a daemon already running here or elsewhere, first start, JSON output and a signed-out CLI.

## [1.45.0] — 2026-10-13 · build 96

- **Select several files and remove them in one step.** **Select** beside Upload turns the Files library (list or grid) into checkboxes. Tick files, or **Select all** for what the search and filters show, and **Remove** moves them to the trash after one confirmation. A search or filter that hides a picked file drops it from the selection, so Remove never reaches a file out of sight. **Done** or Escape leaves select mode. Requested by Damon.
- **Delete forever and Empty trash.** Removed files waited 30 days in the trash with no way to free the space sooner. Each file in the Trash now has **Delete forever** in its options, and the Trash has **Empty trash**; both ask once, then delete the file and its preview from the server at once. Owner only: the routes need the Pocket login from Pocket's own page, so an agent's `pocket-docs` can still move one file to the trash and never delete one. Requested by Damon.
- **Previews go with their files.** Deleting a file (by hand or by the 30-day purge) left its preview pictures in `.thumbs/` for good. They are deleted with the file now, and each purge clears any picture whose file is gone, which also cleans up after earlier deletions. The purge also runs a minute after the server starts instead of waiting six hours.
- The Trash opens with a ▸/▾ beside its heading like the other collapsible sections, and stays open when the library refreshes.

## [1.44.2] — 2026-10-13 · build 95

- **Edit a saved value in place.** The Vault's Edit sheet started every field empty ("Unchanged"), and its **Show** only unmasked what you typed there, so on a saved field it showed nothing and a value could only be replaced blind, never seen and corrected. Now **Show** on a saved field loads its value into the box, one field per tap and recorded in the item's history as a view, the same as Show on the item's sheet. Change it and save; a value left as loaded is not sent, and one emptied is refused with a note instead of being kept silently (a custom field is dropped with **Remove**). A login's username loads the same way. A value with a line break opens in a box that keeps it. Adding and removing fields works as before. Reported by Brad, who had pasted extra text after an API secret and could neither see it nor trim it.
- **Line breaks show on the item.** A shown value keeps its line breaks, so text pasted on a second line is visible instead of running on.
- **The history names the fields an edit changed** ("Changed api_secret by you"). The audit row records the field names, never a value.
- Agents and terminals still cannot change or replace an item; correcting one is the owner's. Tests cover the store, the routes (owner, token, agent, cross-origin) and the browser at 390 and 1440px.

## [1.44.1] — 2026-10-13 · build 94

- **New projects, files and tasks show up without a reload.** Each list fetched its items once and then only on a 30-second poll while it was open, so something an agent added with `pocket-board`, `pocket-docs` or `pocket-tasks` could stay missing from the rail or a project card until the page was hard-refreshed. Now the lists refresh when the window comes back into view or focus, when a turn ends in any Pocket window on the device (a split pane, a window of its own or another tab, through a `BroadcastChannel`), and whenever the rail's Projects, Files or Tasks list is shown with data more than a few seconds old. Reported by Damon.
- **A project card's Files section stays current.** It used the library loaded the first time and was never refreshed; it now reloads with the card and on the open card's poll.

## [1.44.0] — 2026-10-13 · build 93

- **The Vault sets up its own key.** Switching the Vault on in Settings no longer needs anyone to generate a key and edit `.env` on the server: when there is no key and no store yet, Pocket creates the key, saves it to this install's `.env` (mode `0600`, the file backups already leave out), opens an empty Vault, and shows a one-time **Save your recovery key** sheet with Copy and Download. Requested by Brad, so Damon, Siri and Ramesh can turn it on themselves.
- **Download recovery key** in Settings → Vault gives the owner a copy at any time (recorded in the audit).
- **Rotate key saves the new key itself.** The new key is written to `.env` before the store is rewritten, with the old one kept beside it as `POCKET_VAULT_KEY_PREVIOUS` only until the rewrite finishes, so a crash in between still opens the Vault. No restart or manual edit.
- **Restore a missing key.** If a store exists but its key is gone (a lost `.env`, a rebuilt server), Pocket never creates a new key over it; Settings → Vault offers **Restore key**, which takes the recovery key (pasted, or the downloaded file), checks it opens the store, and saves it.
- An install with no `.env` file to write to (`POCKET_ENV_FILE` empty) still needs `POCKET_VAULT_KEY` set by hand. `POCKET_VAULT_KEY_PREVIOUS` is removed from every child's environment like the key itself.

## [1.43.1] — 2026-10-12 · build 92

- **Pocket's command-line tools can no longer be pointed at the wrong server by an inherited `PORT`.** `pocket-vault`, `pocket-board`, `pocket-docs`, `pocket-tasks` and the browser relay used to find the daemon from the `PORT` in their environment before Pocket's own `.env`. An agent working in a project that exports `PORT` (a dev server, say) would have sent Pocket's loopback access token to that app instead. The daemon now writes its address to `cli-url` in the data directory beside `cli-token` (mode `0600`), and the tools read it first, then this checkout's `.env`, and only then an inherited `PORT`. Found while testing Typed by Pocket live.
- **The browser relay retries once** if the answer to a fill is not the Vault's, and notes its status and type (never its body) on its own error output.
- `cli-token`, `cli-url`, `vault.enc` and `vault-audit.jsonl` are now in `.gitignore`, since the default data directory is the checkout.

## [1.43.0] — 2026-10-12 · build 91

- **Typed by Pocket: agents log into web pages without seeing the password.** `scripts/pocket-mcp-proxy.mjs` sits between an agent and a browser tool such as Playwright MCP. When a tool call names `{{vault:ovrc-brad.password}}` (or any `{{vault:name}}` / `{{vault:name.field}}`), the relay gets the value from the Vault under your Agent access setting, types it into the call on its way to the browser, and replaces it with the placeholder in everything the tool sends back: its reply, page snapshots and logs. The model's tool call and the transcript only ever hold the placeholder. A call with no placeholder passes through untouched. Requested by Brad.
- **Same rules as a run.** Free rein fills at once; *Ask once per command* and *Ask every time* raise a Vault request (shown as "Fill into the browser tool"), answered from the push, the Vault view or the conversation, and the agent calls the tool again once allowed. *Only you* items are never filled. Each fill is recorded in the item's history as "Filled into a browser"; the value never is.
- **Setting it up.** Point the agent's browser tool at the relay, for example `claude mcp add playwright -s user -- node <pocket>/scripts/pocket-mcp-proxy.mjs --name playwright -- npx -y @playwright/mcp --headless --no-sandbox`. See the operations guide. Why not a Claude Code hook: hook output is written into the session's transcript file, which would put the value in the record the Vault exists to keep clean.
- Placeholders may now name a field: `{{vault:name.field}}`.

## [1.42.0] — 2026-10-12 · build 90

- **Pocket catches a secret before it is sent.** Paste an API key, token, private key, card number or "password: …" into a message and Pocket holds it instead of putting it in the box: **Store in the Vault** saves it under a suggested name and puts `{{vault:name}}` in the message, so the agent uses it by name and the value never reaches the model, the transcript or MemStem; **Paste as is** and **Cancel** are there too. The pasted text is held in memory only, never in the draft. The same check runs when you send, so a key typed or dictated into a message is caught too, with **Store and send**, **Send as is** and **Edit**. Requested by Brad.
- **The server enforces it.** A message that reaches Pocket with something secret-shaped in it is refused before anything is dispatched or receipted (`422 secret_detected`), naming what was found and where but never the value, unless it is sent anyway. The daemon log records only the kinds found.
- **What counts.** Known formats (OpenAI, Anthropic, OpenRouter, GitHub, GitLab, AWS, Stripe, Slack, Google, Twilio, SendGrid, signed JWTs), private keys, a password inside a URL, card numbers that pass the checksum with a card issuer's prefix, and assignments like `api_key: …` whose value has a digit or symbol. A pasted lone token that looks random is also offered. Placeholders, commit hashes, UUIDs, URLs, paths and words like "required" are left alone. Detection is a backstop, not a guarantee; storing a secret in the Vault first is still the surest way.
- Settings → Vault → **Catch secrets in messages** (on by default) turns the check off for the install. It works whether or not the Vault itself is on; with the Vault off, the sheet warns and lets you paste or cancel.

## [1.41.0] — 2026-10-12 · build 89

- **Agent access: approval is a dial, not a rule.** The Vault's job is to keep credentials out of conversations, transcripts and memory while agents still use them; how often you approve that use is now your choice. Settings → Vault → **Agent access**: *Free rein* (agents use any secret by name without asking; every use is still recorded and values never enter the conversation), *Ask once per command* (the 1.39 behaviour, and the default for a new install), or *Ask every time*. Each item follows that setting unless you set it otherwise: *Free rein*, *Ask once per command*, *Ask every time* or *Only you*. Items that were *Agents ask* by default now follow the setting. Requested by Brad.
- **Approve from the notification.** A Vault request push now has **Allow** and **Deny** buttons, so a request can be answered without finding it in Pocket.
- **Approve in the conversation.** When a run is waiting, the agent says so and ends its reply with *Allow zoho-books for this command* and *Deny zoho-books* as suggested replies; tapping or typing one in that conversation answers the request (a bare "Allow" works when only one is waiting). Only your own messages count, and only for requests raised by that session.
- *Always allow* is not offered for an item that asks every time.

## [1.40.0] — 2026-10-12 · build 88

- **A passphrase for the Vault.** Settings → Vault → **Set a passphrase** re-encrypts the store under a key derived from a passphrase you choose (12 characters or more, scrypt), held only in the daemon's memory. After a restart, or after **Lock now**, or after the idle time you pick under **Lock after** (15 minutes to 24 hours, or never), the Vault is locked: nothing on the server can open it, agents get "The Vault is locked" (exit code 3) and you get one push, and the Vault view shows **Unlock**. Wrong passphrases are limited to ten an hour. **Change passphrase** and **Remove passphrase** (back to the server key in `.env`) are there too. There is no reset: a forgotten passphrase means the store cannot be opened, so keep it in your password manager and keep an export. Requested by Brad.
- **Export and import.** Settings → Vault → **Export** downloads every item, values included, as one `.pvault` file encrypted under a passphrase you type for it; **Import** reads such a file into this or another Pocket Code, adding items whose names are new and listing the ones that already exist. Both are owner-only and recorded. A removed item is not exported; last-used stamps are not carried over.
- The locked state, the passphrase, exports and imports are recorded in the audit log (`lock`, `unlock`, `unlock-failed`, `passphrase-set`, `passphrase-removed`, `export`, `import`). `Rotate key` applies to the server-key mode only. `vault.enc` now starts with a format byte of 2 in passphrase mode; 1.39 files keep working.

## [1.39.1] — 2026-10-12 · build 87

- **Custom fields in the Vault.** Any item can carry named fields beside its kind's fixed ones: **Add field** in the editor takes a name (lowercase letters, digits and underscores, up to 32 characters) and a value, encrypted like the rest, shown masked with Show and Copy on the item sheet, and bound by agents as `name.field`. A new **Credentials** kind has no fixed fields at all, for things like a client ID and a client secret named the way the service names them. `pocket-vault put` takes several fields at once from a JSON object on standard input or in a file; `show` lists every field. Up to 20 custom fields per item; removing one is an edit, fixed fields stay. Requested by Brad, for UPS and Authorize.net.

## [1.39.0] — 2026-10-12 · build 86

- **The Vault.** A fourth library beside Projects, Files and Tasks, for API keys, tokens, logins and secure notes that agents need to do real work. It is off until **Settings → Projects, files, tasks & vault → Vault** turns it on for the whole install, which needs `POCKET_VAULT_KEY` in `.env` (32 random bytes in base64: `openssl rand -base64 32`). The Settings category was *Projects, files & tasks*. Requested by Brad.
- **Encrypted in one file.** Items and their approved commands live in `<data dir>/vault.enc`, one AES-256-GCM blob with no plain-text names or other metadata on disk; an altered file or a wrong key fails closed. The daemon reads the key at start and removes it from its environment, so agent turns, helpers, hooks and every other process it starts never see it. **Rotate key** in Settings → Vault re-encrypts the store and shows the new key once; the old key keeps working until you put the new one in `.env` and restart. Back up `vault.enc` and `vault-audit.jsonl` with the data directory and keep the key somewhere else.
- **Agents use secrets without seeing them.** `pocket-vault run --env TOKEN=zoho-books -- <command>` asks Pocket's daemon to run the command with the value in its environment, never in its arguments, and returns the output with each value (and its base64 and URL-encoded forms) replaced by `{{vault:name}}`. Output is capped at 1 MB and a run stops after 10 minutes unless `--timeout` says otherwise. There is no command that returns a value. `list` and `show` give names, kinds, URLs, tags, policy, expiry and last use; `put` lets an agent store a secret it meets, create-only, with the value from an environment variable, a file or standard input; `history` shows the session's own uses. Exit code 3 means the Vault is off, 4 that a request is waiting.
- **You approve each new command.** Each item has a policy: *Ask* (the default) runs a command you saved with *Always allow* and otherwise sends a "Vault request" push to your devices, answered with *Allow once*, *Always allow* or *Deny* in the Vault view; *Auto* runs any command; *Owner* keeps agents out. The agent waits 90 seconds, then reports `pending` and picks up your answer with `pocket-vault wait`; a request expires after 15 minutes. A saved recipe is exact (program, arguments and folder), so a changed argument asks again.
- **Every use is recorded.** Runs, requests, answers, views of a value, additions, changes, removals, restores and rotations go to `vault-audit.jsonl` (mode `0600`, append-only) with the session and the command, never a value. Each item's sheet shows when it was last used and its history. Agent processes carry a runner token so the record names the right session; calls from a terminal or code-server are recorded as `terminal` and follow the same policy.
- **The Vault view.** Add, edit, remove and restore items (removed items wait 30 days), see a value one field at a time on tap with Copy, set the policy, manage recipes and answer requests. Vault responses are `no-store`, stay out of the service worker, refuse changes from another origin, and values are never stored in the browser. **Store in the Vault**, in the composer's attach sheet and a session's options, opens the add sheet so a secret never enters the message. Pasted secrets are not detected automatically in this release.
- **Agents are told.** While the Vault is on, every turn's instruction says to refer to secrets by name and use them with `pocket-vault run`, never to print, write or send a value, to store any secret met at once and say it was seen, to wait on a pending request and stop on a refusal, and that `{{vault:name}}` in a message is the owner handing over a stored secret. A `pocket-vault` skill is installed for Claude Code and Codex. Turning the Vault on restarts idle agent processes so the rules reach them; running sessions get them from their next turn. Settings warns when Codex's `config.toml` sets `developer_instructions`, which stops Pocket's line reaching Codex.
- **Limits, stated plainly.** Agents run as the same OS user and could read `.env` and the store; the Vault keeps secrets out of prompts, transcripts, memory, backups and the provider and makes use visible, but it is not process isolation. A command the daemon runs does so with the daemon's permissions, outside the agent's sandbox, so under Codex's Review mode `pocket-vault run` cannot reach the daemon and needs Full access. Scrubbing output cannot stop a command that writes or sends a value elsewhere. See [SECURITY.md](SECURITY.md#vault).

## [1.38.1] — 2026-10-12 · build 85

- **An open file stays put while you read it.** Files re-checks the library every 30 seconds so new files, shares and project changes show up without a reload. With a file open, that check rebuilt the whole viewer, including the frame that shows an HTML report or PDF, so the document reloaded and jumped back to the top, most noticeable when a long report sat in a split pane. The check now redraws only the toolbar and the title line; the document is reloaded only if the file itself changed. A browser test checks that a repaint keeps the same frame. Reported by Brad.

## [1.38.0] — 2026-10-11 · build 84

- **Light, Dark and System.** Settings → Appearance adds a per-browser colour mode. System follows the device's preference and updates while Pocket is open. Existing browsers with Pocket preferences keep dark mode; new browsers start with System. Explicit choices survive reloads, and windows and split panes update without rebuilding a conversation or losing its draft.
- **Paired palettes.** Warm paper joins the existing warm ink interface. Orange, blue and purple highlights, message text, button labels, status colours, diff tints, shadows and native controls adapt together. Dark blue and purple highlights and the error colour were adjusted for readable small text.
- **Startup and offline.** A small same-origin script resolves appearance before the stylesheet and app load; it is included in the service-worker shell. Browser chrome follows the selected mode. Document and media canvases keep their original appearance; Pocket-rendered Markdown and tables follow the app.

## [1.37.2] — 2026-10-10 · build 83

- **Files keeps its previews in split view.** A split pane is a frame of its own, usually 380 to 650px wide, and the library treated anything under 700px as a phone, so in a pane it fell back to the list and hid the List/Grid buttons. A pane now gets the grid at any width, with a 160px minimum card so the narrowest pane holds two columns, and the List/Grid buttons show there; the choice is still shared with the tab. Phones keep the list. Requested by Brad.

## [1.37.1] — 2026-10-10 · build 82

- **The reminder command no longer sees Pocket's secrets.** `POCKET_REMINDER_HOOK`, run when a project reminder or a dated task comes due, used to start with the daemon's whole environment, including the login password (`POCKET_PASSWORD`), the cookie-signing key (`POCKET_SECRET`) and the push private key (`VAPID_PRIVATE`). It now gets the same filtered environment as agent turns, so those three are removed; everything else (PATH, PORT and your own variables) is unchanged. Found by the 1.37 documentation audit. A test checks that the hook cannot see them.

## [1.37.0] — 2026-10-10 · build 81

- **Agents offer tasks.** While Tasks is on, an agent that reaches a point you will need to come back to (a report that needs weeks of data, a test still to run, someone else's reply, a step you chose to put off, a date you mentioned) offers once to add a task, as one of the suggested-reply buttons at the end of its turn, written as you would say it: *Remind me Nov 7 to recheck the numbers*. With suggested replies off it asks in one line. Nothing is added unless you tap it or say yes, an offer you pass on is not repeated, and there is no offer for work the agent is about to do or for trivial errands. Requested by Brad.
- **Accepted offers carry the context.** The agent files the task with the session, a two-to-four-sentence briefing it writes from the whole conversation (what is being worked on, where it stands, what finishing needs) and the date or time from the offer. Pocket's per-turn instruction and the `pocket-tasks` skill say so for Claude Code and Codex.
- **Tasks from agents know their session.** `pocket-tasks add --session` now gets that session's title and workspace filled in by the server, as the Add task button does, so the list says where the task came from and **Start** opens New session in the right folder. An explicit `--dir` or title still wins; without a session id, agents are told to pass `--dir`.

## [1.36.0] — 2026-10-10 · build 80

- **Tasks.** A third library beside Projects and Files, off until **Settings → Projects, files & tasks → Tasks** turns it on for the whole install. A task is one line of text with an optional date and time, the session it came from and, when you ask for it, a short briefing on that session. The list (`#/tasks`) opens like a session: a tab, a split pane, its own window, or full-screen on a phone; open tasks come first, due ones at the top, finished ones collapsed under Done. The rail switch reads Sessions | Projects | Files | Tasks with the count of due tasks; the phone's session home gets a Tasks chip. A dated task is announced once when it comes due, by push with a link to the list and to the server's reminder hook (`kind: "task"`); it stays due until it is done or re-dated. Requested by Brad.
- **Add task from a conversation.** An **Add task** chip in the message toolbar beside Add project (a check-box button in the working row while a turn runs) and **Add task** in a session's options open the editor with the session remembered. *Include a summary of this session*, on by default there, asks the titles helper (Haiku or Codex) for a two-to-four-line briefing on the whole session so far and keeps it with the task; if no helper is available or the session is too short the task is added without it and the editor says so.
- **Start a task.** From a task's sheet, **Start** opens New session in the task's workspace with the task text, its briefing and its id as the draft, editable, so one tap of Send begins the work; an agent finishing it marks the task done. **Open the session** goes back to the conversation the task came from.
- **Agents keep tasks.** `pocket-tasks add "…" [--due] [--session] [--summary]`, `list`, `show`, `done`, `reopen`, `edit`, `remove` over the same loopback token as `pocket-board`; a `pocket-tasks` skill ships with Pocket and is installed for Claude Code and Codex while Tasks is on; Pocket's per-turn instruction tells agents to create a task only when the user asks, typed or spoken, to give it a time only when one is named, and to write the summary themselves when the user wants the context.
- **Add project.** The conversation's project chip and the session option now say *Add project* (the sheet is *Project for this session*); it still tracks a new project around the session or links it to an existing one. Requested by Brad.

## [1.35.0] — 2026-10-10 · build 79

- **Files opens where the button says.** The sidebar's Files list has three buttons: **Upload**, **Split** (the library in a pane beside the current view, desktop only) and **Tab** (the library as a tab). They replace *All files*, whose behaviour depended on a setting. Screen readers and tooltips name them in full: Open the file library in split view / in a tab. Requested by Brad.
- **The Files button can open the library directly.** Settings → Projects & files → **Files button**: list files in the sidebar (default), open the library in a tab, or open it in split view. Arrowing across the sidebar switch only focuses a Files button set to open the library. **Open files** still decides how a single file opens. Requested by Brad.
- **New session names the model and reasoning level.** The collapsed setup summary reads, for example, *Agent Claude Code · Opus 5.5 · High reasoning* (or *default reasoning* when neither Pocket nor the session sets one), and follows the Model and Reasoning choices. Requested by Brad.
- **Add to project is a toolbar chip.** It moved from a full-width row under the conversation header to the message toolbar, after Alerts and Voice; a linked session shows the project's name in clay. While a turn runs, the working row carries it as a folder button. It stays usable while a message is being delivered. Requested by Brad.
- **One conversation header.** The title bar's subtitle now carries the project, the run status in short words and the check age (*purchasing · Idle · Checked just now*), at every width. Sessions, Results, Queue and Git sit in the same bar: on the title row when the header is wide, on a second line inside it when narrow. The separate run-status strip, the session-links strip and the duplicate state label are gone; on desktop the three rows (about 125px) become one (about 60px). Phones keep the check age in the status tooltip. Requested by Brad.

## [1.34.0] — 2026-10-10 · build 78

- **Documents is now Files.** The library, its rail switch, the session-home chip, Split view, Back links, sheets, empty states and toasts all say Files, and a single item is a file: File options, Rename file, Remove this file?, Keep in Files on a session's Results. The Settings category is Projects & files, with Files and Open files under Tools. `pocket-docs` messages use the same words. Requested by Brad.
- **Agents understand every name for it.** Files, my files, documents, my documents and docs all mean Pocket's Files library, not a folder on the server or another drive unless the user names one. Pocket's per-turn instruction says so.
- **Agent skills ship with Pocket Code.** `skills/pocket-projects` covers when to create a project (only when asked), the steps, asking at most one question (which project, what it tracks, or when to remind) and setting reminders only when the user asks or agrees to a time. `skills/pocket-files` covers the names above, what to keep, how, and sharing only on request. While Projects or Files is on, Pocket writes the matching skill into `~/.claude/skills` and, where Codex is installed, `$CODEX_HOME/skills`, with this server's command filled in, so terminal and code-server agents know it too; turning the feature off removes it. Only folders carrying Pocket's `.pocket-managed` marker are touched. `POCKET_SKILLS=0` turns installation off. Requested by Brad.
- **A light divider in the rail switch.** Sessions | Projects | Files are separated by a thin, low-contrast pipe centred in a slightly wider gap. It is decorative, so it takes no clicks and screen readers skip it. Requested by Brad.
- Nothing internal is renamed, so existing installs, links and scripts keep working: the `/api/documents` routes, `#/documents` links, `documents.json`, `POCKET_DOCUMENTS_DIR`, the `documents` setting and the `pocket-docs` command are unchanged.

## [1.33.1] — 2026-10-10 · build 77

- The sidebar header compresses as its column narrows, keeping New session, Settings and filters reachable. Mouse controls compress with the labels; touch controls retain 44px targets. At the minimum widths, actions wrap together.

## [1.33.0] — 2026-10-09 · build 76

- Settings has a six-category index, clear device/instance scope labels, reliable initial keyboard focus, and Back to Settings in subpages.
- New session shows a labeled workspace/agent/permissions summary. Edit setup reveals wrapping model and reasoning controls; attachments stay beside the task.
- Linked project names occupy a bounded context row instead of squeezing phone conversation navigation.
- Project and document detail Back restores the originating view, filters and scroll position; failed loads offer Retry and preserve labeled stale data.
- Split view groups and searches sessions, projects, documents and library destinations, including items beyond the recent list.
- Rail navigation uses button-group semantics and arrow/Home/End keys. Document filters, preview actions and chat mute controls have 44px touch areas.
- Wide report tables show a scrolling cue. Matching document project/session names are deduplicated.
- Leaving a page releases its event stream; returning through browser history reconnects without exhausting HTTP connections. Selected document counts retain readable contrast.
- Browser checks cover all cleanup findings. Regression summaries now include the Projects and Documents checks that previously ran after the summary was printed.

## [1.32.1] — 2026-10-09 · build 75

- **Split view names documents on a fresh page too.** 1.31.1 listed documents in the Split view chooser, but only once the library had been loaded in that page; a conversation opened straight from a link still saw just the library. The chooser now fetches the document list first. Found checking the live app after the 1.32.0 deploy.

## [1.32.0] — 2026-10-09 · build 74

- **The Documents library is a grid of previews on a wide screen.** Each card shows a picture of the document (an HTML report as rendered, a PDF's first page, an image), with the title, where it came from, the visibility badge and the date under it; Copy link and the options button sit on the picture and show on hover or focus. List and Grid buttons above the library switch between the rows and the grid, remembered per browser; the grid is the default from 700px up and phones keep the list. Suggested by Brad.
- **Pictures are made on the server, once.** `GET /api/documents/<id>/thumb` (login only) renders a 480×300 picture with tools already on the box and caches it in `<documents dir>/.thumbs`, keyed by the file's size and modification time so an edited file gets a new picture: headless Chrome for HTML (its own sandbox kept, a throwaway profile, a four-second time budget), `pdftoppm` for PDF, ImageMagick's `convert` for images (or Chrome when `convert` is absent). The library response says which kinds this install can picture, so a card asks only when there is something to get; a failed render is remembered for ten minutes rather than retried on every paint. `POCKET_CHROME`, `POCKET_PDFTOPPM` and `POCKET_CONVERT` choose or disable a tool. Markdown, text, CSV, JSON, Office and video cards show their kind.
- Unit tests for tool discovery, the cache key, one job per key, failure memory and Chrome's arguments; an HTTP test for the route; the browser suite checks the grid, the kind card and the remembered choice.

## [1.31.1] — 2026-10-09 · build 73

- **Split view offers documents by name.** The chooser behind the Split view button listed each active project but only the Documents library as a whole, so a single report could be opened beside a conversation only from its own options sheet. It now lists the documents open as tabs first, then the six most recent, then the library, each with its kind, project and visibility. Noticed by Brad.
- The documents HTTP test altered a share token by replacing its last character with `A`, which did nothing about one time in sixty-four when the token already ended in `A`, so the "wrong token is refused" assertion failed at random (seen once locally and once in CI). It now picks a character that differs.

## [1.31.0] — 2026-10-09 · build 72

- **Three ways to open a project or a document.** Every options sheet and every project or document header now offers **Open in a new window**: the view in a browser tab or app window of its own (`?solo=1`), with no session list, tab strip or pane controls, and the document's or project's name as the window title. The other two ways are unchanged: as a tab in the strip, or beside the conversation in a split pane. Settings → Tools → Open projects / Open documents gains *In a new browser window* as the default for a plain click. Requested by Brad.
- **The Documents library looks after a real library.** Filter chips for Private, Link and Public (with counts), a Kind filter (HTML reports, PDFs, images, Markdown and text, CSV and JSON, Office and video), a Clear chip when anything is narrowed, and a heading that says what is shown ("Anyone with the link · 5 of 423"). Search covers the title, file name, project, session, kind and visibility words. Each row carries a visibility badge, and a shared row has a **Copy link** button beside its options. The rail's Docs list gains a search box.
- **Sharing in fewer taps.** Document options groups into Open, Share and Organize; a shared document offers **Copy link** right there. The Share sheet always shows an address with Copy: the in-app address for a private document (it needs the sign-in), the unguessable address for a link, the fixed address when public. The document view's chip row gains Copy link and icons. The Copy button in the Share sheet used to also fire the app's code-block copy handler and could leave the clipboard empty; fixed.
- **Sheets are dialogs on the desktop.** From 900px up, an options, share, session or settings sheet opens in the middle of the window with a border and a shadow instead of rising from the bottom edge; phones keep the bottom sheet. Link rows in a sheet (Open in your viewer, Download) and link chips no longer render in the browser's default blue with an underline.

## [1.30.1] — 2026-10-09 · build 71

- **Titles follow the session.** A generated title used to be made once, from the opening request, so a session that moved on kept a title about where it started. Now, after a turn run from Pocket ends, a session that has grown enough since its last check (four more of your turns, or about 8k characters of conversation, and at least ten minutes since the last check) is shown to the helper model as a digest of the whole session together with its current title. The model answers KEEP, or writes a better 3 to 7 word title; when a session took up a second substantial topic it names both ("Pocket titles, then away summaries"). Requested by Brad.
- An updated title ranks ahead of Claude Code's own one-shot title, since it reflects what happened since, and behind a rename, which is never touched. The titles a session had before are kept in `session-meta.json` (`titleHistory`). The open conversation's header follows a title that changes on the server at the next list refresh, as does a rename made from another device.
- **Settings → Update titles as sessions progress** turns it off (on by default; it needs Generate short titles and uses the same model choice). The line under it names the last update. Checks use the away-summary digest, one at a time: about 2k to 4k tokens with Claude Haiku, about 25k with Codex. `POCKET_LIVE_TITLE_GAP_MS` changes the minimum gap between checks (tests set it to 1 ms). Turns run from a terminal or code-server do not trigger a check.

## [1.30.0] — 2026-10-09 · build 70

- **Documents.** A library of the files that came out of the work: HTML reports and dashboards, PDFs, images, Markdown, text, CSV, JSON, Office files and video. Off until Settings → Tools turns it on. Files live in a documents folder (`POCKET_DOCUMENTS_DIR`, default `<data dir>/documents`); a file placed there appears as a private document on the next listing. Requested by Brad, after a conversation with Damon.
- **Viewing.** HTML renders in a sandboxed frame: the response carries a sandbox policy and the frame denies the document any access to Pocket's cookies, storage or API, while a dashboard's own scripts still run. PDFs, images, Markdown, text, CSV/TSV and JSON render natively; Office files and video open in your device's own viewer. A document opens as a tab, beside a conversation, full-screen on the phone, **in your viewer**, or downloads.
- **Sharing.** Private (behind the Pocket login), **link** (an unguessable address, optional expiry, a new link revokes the old) or **public** (a fixed `/files/<name>` address), all served by Pocket on its own hostname with no-store, nosniff, noindex and frame-ancestors 'none'. Removing a document moves it to the trash for 30 days, where it can be restored; links stop working at once.
- **From a session and a project.** Results rows of document kind gain **Keep as document**, which copies the file in with the session and project links filled. A project card lists its documents; the library filters by project. Each document shows its project and session.
- **`pocket-docs` for agents.** `scripts/pocket-docs.mjs` (`npx pocket-docs`): `add`, `list`, `show`, `share`, `set`, `trash`, `restore`, `import`. Same loopback token as `pocket-board`, accepted only on the documents routes. With Documents on, agents started by Pocket are told to keep deliverables with it, linked to the session, and never to share unless asked. `pocket-docs import <metadata.json>` brings in a Mission Control documents library once (public stays public, staff becomes link, private stays private).

## [1.29.0] — 2026-10-09 · build 69

- **Projects.** Track the work that comes out of your sessions, inside Pocket Code. Each project is one card: where you left off, the next step, what it is waiting for, a checklist of remaining steps, reminders, notes, history, and the sessions that worked on it, with their live status. States are Active, Waiting and Done. Finishing a project stops its reminders; resuming does not bring them back. Projects are tracked only when you ask: Track a project, or Add to project from a session's options. Off until you turn it on in Settings → Tools. Requested by Brad, after a conversation with Damon.
- **Scheduled.** One list of every open reminder across your projects, due first. Only reminders Pocket Code itself keeps appear there, so the list is complete about what it shows. When a reminder comes due it is sent once to your devices by push, with a link to the card, and once to the server's reminder hook if `POCKET_REMINDER_HOOK` is set (the reminder arrives as JSON on the command's standard input, for email, chat or anything else).
- **From a conversation.** The row under the conversation header gains **Project**: the linked project's name, opening its card, or *Add to project* when there is none. When Projects is on, agents started by Pocket are told how to track the session as a project with `pocket-board`, and told to do so only when you ask; so "track this as a project" works in any session without editing your rules.
- **Open like a session.** On the desktop the rail head switches between Sessions and Projects, with a count of due reminders. A project opens as a tab in the same strip as sessions (pin, close, Alt [ / ] all work), or beside a conversation in a split pane. On the phone it opens full-screen. Settings → Tools chooses which happens when you pick a project from the rail.
- **`pocket-board` for agents.** A command in the repository (`scripts/pocket-board.mjs`, also `npx pocket-board`) lets Claude Code and Codex sessions keep a card current from the terminal: `track --requested`, `status`, `update`, `task add|done|reopen|edit`, `remind --at`, `dismiss`, `note`, `link-session`, `scheduled`, and `context --hook` for a Claude Code SessionStart hook that briefs the agent on the directory's tracked project. It uses a token Pocket writes to `<data dir>/cli-token` at start and accepts only on the board routes, only from a direct loopback connection; a request that arrived through a tunnel or proxy is refused. Times without an offset mean the server's time zone (`POCKET_TZ`, default the system zone). `pocket-board import <snapshot.json>` brings in a Mission Control board once.
- The repository's prompts test no longer races the fake CLI on cleanup (the intermittent `ENOTEMPTY` CI failure seen since 1.27.1).
- Projects live in `<data dir>/projects.json`, written atomically with a per-project revision; an edit made from a stale card is refused and the current card is shown. Nothing in Projects depends on a domain, a Google account or email.

## [1.28.1] — 2026-10-09 · build 68

- **A cold prompt cache turns the ring ice blue.** Once a session's prompt cache has expired, the context ring (its track and fill) and the `cold` label beside it turn a light ice blue, and Usage → Prompt cache shows "Cold" in the same colour. Blue takes over from the clay, amber or red context colour while the cache is cold, because the next turn's cost is what matters then; how far the ring is filled still shows how full the context is, and the tooltip still gives the figures. Warm and cooling are unchanged, and so are the tab marks. Requested by Brad.

## [1.28.0] — 2026-10-08 · build 67

- **Prompt cache warmth.** Claude keeps a session's context in a prompt cache for a while after each request: one hour on a normal plan, five minutes in some cases such as extra usage. A turn that starts while the cache is warm reads the context at a fraction of the cost; after it expires, the next turn writes the whole context again, which on a large session uses noticeably more of your plan. Pocket now shows it. Requested by Brad.
- **Beside the context ring:** minutes left while the cache is warm (`51m`), amber in the last stretch (the final ten minutes of an hour), and `cold` once it has expired. Hover or focus the ring for the expiry time; the screen-reader name says the same.
- **In Usage:** a Prompt cache section under This session with the status, when it expires or expired, how many tokens are cached, the lifetime, and how the last turn started (for example "The last turn, at 9:05 PM ET, started 99% from cache").
- **On each reply's turn line:** the share of the turn's first request that came from cache ("$0.42 · 35s · 97% cached"), or "cold start".
- **On open-session tabs:** an hourglass when a session with at least 100k cached tokens is about to expire, and a snowflake once it has. Warm and smaller sessions show nothing; the tooltip and screen-reader label explain the mark.
- These are estimates, from the last request in the transcript and the cache lifetime it used. Each request restarts the lifetime, and the provider can drop a cache sooner. Turns run in a terminal or code-server count too. Codex sessions show nothing. Checked against 150 recent transcripts on the owner's server: every resume after more than 65 idle minutes started cold (56 of 56), and 103 of 109 resumes under 55 minutes started warm.

## [1.27.2] — 2026-10-08 · build 66

- Switching between Claude Code and Codex clears incompatible model choices. Opening an affected session repairs its saved selection to Default. Other preferences and drafts stay intact.
- The model button no longer disguises an unrecognized selection as the default. The Codex menu includes every model advertised by the installed CLI.
- The server rejects cross-agent model requests before starting, steering or queuing a turn, including requests from older browser tabs. Open the model menu, select the intended model and send again.

## [1.27.1] — 2026-10-08 · build 65

- **Amber means waiting on you.** A session that needs your answer or approval now shows amber instead of clay on its tab, in the session list and in the conversation status bar. At tab size the still clay dot was hard to tell from the breathing ember of a running turn. Clay now always means Claude is working; amber means it is waiting on you. Requested by Brad.

## [1.27.0] — 2026-10-08 · build 64

- **Status on open-session tabs.** Each tab across the top carries the same status as its session-list row, as a small mark before the title: the breathing ember while a turn runs, a still clay dot when it needs your answer or approval, green for a reply you have not opened, red for a failed turn, and a ring for activity elsewhere or a paused queue. Quiet sessions show nothing, and no tab shows a status while the session list is unconfirmed. Hovering a tab adds the status in words; screen readers announce it with the title. Tabs for sessions older than the loaded list show no status. Requested by Brad.

## [1.26.1] — 2026-10-08 · build 63

- Account switching no longer waits forever on long-running background jobs such as health watchers. Current Claude turns still finish first; idle processes close, while background jobs and their Claude processes remain alive.
- Retained sessions refresh their login before the next requested turn after their jobs finish. While a retained job is running, start a new session to use the new account. This state survives Pocket restarts, and old processes cannot overwrite the new account’s displayed plan limits.
- The sign-in form explains that background jobs can keep the earlier login. Codes and authentication continue through the installed Claude CLI.

## [1.26.0] — 2026-10-08 · build 62

- **Switch Claude accounts.** Settings → Accounts & instance → Claude Code → Switch account opens a browser sign-in link and a field for Claude’s return code. The installed CLI handles authentication; Pocket never puts the code in a conversation or saves it in its data files.
- Sign-in waits for Pocket’s active Claude turns and background jobs to finish, closes idle Claude processes, and blocks new Claude turns until completion or cancellation. Codex can keep running. Return to the form after closing it to resume the pending sign-in. Links expire after ten minutes.
- A successful sign-in verifies the account and clears the previous account’s cached plan limits. It changes the server’s shared Claude login; other open Claude processes may need reopening. Configured API keys and cloud providers remain server-managed.

## [1.25.0] — 2026-10-08 · build 61

- **While you were away opens at the end.** Coming back to a session with work you have not seen now opens at the bottom of the conversation, not at the **New since** divider, so a long session needs no scrolling to reach the latest reply. The divider still marks the first new message. An **away card** under the latest message repeats the time ("New since 8:40 PM"), carries the short summary when the new part is more than a short exchange, and has **Read from there**, which jumps to the divider and holds the view there until you scroll, tap, type or send. When the latest reply ends in suggested replies, the card sits above them so the summary and the choices share the screen. When there is no summary and the divider is already on screen, the card is left out. Requested by Brad.
- Settings → **Summarize what you missed** describes the new placement. Off still marks where new work starts and still opens at the end.

## [1.24.1] — 2026-10-08 · build 60

- A message from another day shows its date with the time: "Yesterday 3:05 PM", "Oct 6, 3:05 PM", or "Oct 6, 2025, 3:05 PM" for an earlier year. Today's messages keep the time alone. In a conversation that runs across several days each bubble now says which day it belongs to, not only the day divider. Labels are set when the conversation is drawn, so a page left open past midnight shows yesterday's messages as today's until it is reopened. Requested by Damon Delcoro.

## [1.24.0] — 2026-10-08 · build 59

- **Message times.** Each message shows the time it was sent: under your own messages, inside the bubble, and above each reply, in the same small mono as the cost line. A divider marks the first message of each day (Today, Yesterday, Tue, Oct 6, or Oct 6, 2025 for an earlier year), including as a conversation crosses midnight while you watch. Times come from the transcript, so Claude and Codex sessions both have them; a message that is not in the transcript yet (just sent, or steered in) shows none. Requested by Damon Delcoro.
- Settings → **Show message times** turns the times and dividers off on this browser (on by default). The times are drawn by the stylesheet, so Copy message and Find in conversation never include them.

## [1.23.0] — 2026-10-08 · build 58

- **Saved prompts.** The New session screen has **Save as prompt** beside Choose a skill. It keeps the task's wording, workspace and agent, and, unless you switch it off in the save sheet, the model, effort, permissions and Codex mode. Saved prompts appear as a row of chips above the task box; tapping one fills the whole screen (the chip stays highlighted until you change the wording) and you still press Start, so a stray tap never starts work. The chip's tooltip lists what it will set. Requested by Brad.
- **Recent.** A Recent list under the chips holds your last five starts from any device (text, workspace, agent, when), newest first; a repeat moves to the top. Tapping one fills the screen the same way. It opens and closes on tap and remembers that on the browser.
- **Manage.** The Manage chip (or a long-press or right-click on a saved prompt) opens every saved prompt with Move earlier / later, Edit (rename, or replace with what is on screen) and Delete, which asks once more before deleting.
- Saved prompts and recent starts are kept on the server in `saved-prompts.json` beside pins and names, so the phone and desktop share them. Up to 50 saved prompts; names up to 60 characters, text up to 8,000. A start that fails is not added to Recent.

## [1.22.0] — 2026-10-08 · build 57

- **Search inside conversations.** Typing three or more characters in a session search box (home, desktop rail or the session switcher) still filters session titles at once, and after a short pause also searches inside conversations. An **In conversations** section lists up to 15 sessions with the matching passage, who wrote it (You, Claude or Codex) and the matched words marked; tap one to open the conversation with Find already on the match (the phrase, or its longest matching word). The section says how it searched, says so when nothing matched, and offers Try again when the search fails. Requested by Brad.
- **With MemStem** on the server (`POCKET_MEMSTEM_URL`, default `http://127.0.0.1:7821`; checked once a minute), search uses its keyword + semantic index of every Claude Code and Codex session, so it finds old conversations and related wording, not only exact phrases. Only transcripts in Pocket's own stores count (subagent transcripts and other Codex homes are left out). Snippets come from MemStem's plain-text copy of the conversation; a session that matched by meaning but contains none of the words is shown as **Related** with MemStem's own excerpt. If MemStem stops answering, Pocket falls back to its own search for that request.
- **Without MemStem** (or `POCKET_MEMSTEM=0`), Pocket searches the text of the 200 most recent conversations itself for the exact phrase, newest first, four at a time for up to six seconds, and says how many it covered.
- A search result opens at its match, not at the While you were away divider.

## [1.21.0] — 2026-10-08 · build 56

- **While you were away.** When you open a session (or come back to the app) and the agent did something you have not seen, a **New since 8:40 PM** line sits before the first new message and the conversation opens there instead of at the bottom. It stays there while the page settles, until you scroll, tap, type or send. Requested by Brad.
- Where "new" starts: the later of the reviewed marker your devices share and the moment you last had that conversation on screen in this browser (leaving it, switching away or hiding the app). Re-renders of a conversation you are watching (a turn ending, a resync, the rail toggle) never add the line, and nothing is marked when the only new messages are your own.
- When the new part is more than a short exchange (three or more tool calls, two agent messages, or a long reply), a **While you were away** card under the line summarizes it in two to four lines: what was done, what was decided, and anything waiting on you, with the model named ("Summary by Haiku 5.5. Read the messages for the details."). The server builds a compact digest of only the new messages (your messages, the agent's text clipped, tool calls grouped by name) and sends it to the same helper model as generated titles: Claude Haiku through the CLI (about 2 s), or Codex GPT-6-Luna (about 3 s, but about 25k tokens per call). Summaries are cached per session and starting point, nothing is written to a transcript, and a failed summary simply leaves the line.
- Settings → **Summarize what you missed** turns the card on or off (on by default). The model choice is now labelled **Model for titles and summaries** and stays available while either is on.
- Codex conversations get message times from their turn ids (UUIDv7), so the line works for Codex sessions too.

## [1.20.1] — 2026-10-08 · build 55

The remaining small findings (P3) from the 2026-10-08 UI/UX audit.

- Phone message settings no longer show a word cut off at the edge ("Full acces…"). The settings row fades out where it scrolls, at either end, and on phones the permission chip says **Full** or **Review** (its accessible name and tooltip keep the full wording).
- The context ring's track is dotted, so at low usage it reads as a gauge rather than an empty radio button.
- Sessions in your default workspace (the instance's default workspace, else your home folder) show only the agent in the list ("Claude"), instead of "~ · Claude" on nearly every row. Other workspaces are still named.
- The session summary says "1 needs attention" (and "2 need attention"). The login screen says "Your Claude Code and Codex sessions, from anywhere."
- The conversation hides **Git** when its workspace is not inside a Git repository (the server now reports it with the session), instead of offering a panel that can only say so. Opening Pocket signed out no longer logs a 401 error in the browser console: `/api/me` answers `{ ok: false }`.
- The copy button on each reply and the message-settings scroll arrows have 44px targets, like the rest of the app. What's new and Bugs & feature requests text sits 16px from the sheet edge.
- The X that dismisses suggested replies stays at the end of the first line; only the options wrap.

## [1.20.0] — 2026-10-08 · build 54

- Generated titles are a setting, not only an environment variable. Settings has **Generate short titles** directly under Sync names with code-server, and a **Title model** choice: Automatic (Claude first, then Codex), Claude · Haiku, or Codex · GPT-6-Luna. Both are server-wide, like name sync, and saved in `pocket-settings.json`. The line under the switch says whether titles are on and which provider is making them; a note gives the reason a provider is unavailable, which model made the last title, and, for Codex, that each Codex title sends about 25k tokens of your plan against about 400 for Claude. Requested by Brad.
- Turning titles off also stops showing the titles already made (they are kept and come back when you turn titles on), so with Sync names with code-server on, the list matches code-server.
- Each provider is checked before it is used: installed, signed in (`claude auth status`, Codex `account/read`) and, for Codex, offering GPT-6-Luna in its model list. A server with neither makes no title calls at all and Settings says why; before, a Codex-only server tried the missing `claude` once a day per session. A failure with one provider no longer blocks a retry with the other.
- Claude titles ask for the CLI's `haiku` alias, so they move to the newest Haiku when the Claude CLI is updated (Claude Code 2.1.293 maps it to Haiku 5.5; 2.1.281 to Haiku 4.5). Codex titles run `codex exec --ephemeral` read-only with GPT-6-Luna at low effort, without loading your config or rules, and save no session. `POCKET_TITLE_CLAUDE_MODEL` and `POCKET_TITLE_CODEX_MODEL` override the models.
- Title calls no longer receive Pocket's own secrets in their environment (they use the same environment as agent turns).
- `POCKET_AUTO_TITLES` now only sets the starting value; once changed in Settings, the Settings value is used.

## [1.19.1] — 2026-10-08 · build 53

- Generated titles are cleaner. On the first live run of 1.19.0 the model sometimes answered in Markdown ("# Planning Phase: …") or answered the request itself ("I don't have access to…") instead of naming it. The request is now framed as data with the instruction after it (8 of 8 good titles on the cases that went wrong, including the ones that failed), Markdown is stripped, and a multi-line or answer-like reply is rejected. Titles saved by 1.19.0 go through the same check: a bad one shows the request again until it is redone, and failures from the older prompt are retried once.
- Codex threads whose name is just their first message (Codex often stores the whole message as the name) count as untitled, so they get a short title as well. A name you gave the thread is kept.

## [1.19.0] — 2026-10-08 · build 52

From a full UI and UX audit of 1.18 on phone, tablet and desktop (2026-10-08). Requested by Brad.

- Replies keep a readable line length on wide screens. At 1440px a paragraph ran to about 127 characters per line (87 on a tablet), because the conversation is up to 1280px wide. Prose, lists, quotes and headings now stop at 68 characters' width (scaling with Chat text size) and your own messages at 60; tables, code blocks, tool folds and the message box still use the full width.
- Scheduled runs stay out of the way. A session whose first message announces a scheduled job (`[cron:<id> Job name] …`), or an OpenClaw runtime preamble, is marked automated, shows the job name as its title and sits in a collapsed Automated group at the end of All (the open/closed state is remembered on the browser). Searches, the other filters, pins, running work and anything needing attention show them as usual.
- Codex sessions in `/tmp/` workspaces (tests and scratch runs) are left out of the list, as Claude sessions in `/tmp/` already were, unless pinned or running.
- Generated titles. A session named only by its opening request (most Codex threads, and Claude sessions without Claude Code's own title) gets a short title from one small model call after it appears in the list: Claude CLI, Haiku, no tools, no MCP servers, no settings files and no saved session (about 1.5 s and a fraction of a cent each). It is kept in `session-meta.json` beside names and pins, never written to a transcript, and only requested for sessions active in the last 14 days, one call at a time. A rename always wins, and clearing a rename returns to the generated title. A failed call is not retried for a day. `POCKET_AUTO_TITLES=0` turns it off.
- With Sync names with code-server off, a Claude session now shows Claude Code's own generated title (ai-title) ahead of its opening request. Renames in Claude Code still only apply with sync on.
- More reading room on phones. Up to 600px wide, the run status ("No active run here", "Running on server", "Needs your answer") sits on the title bar's second line beside the project name, as it already did with the header collapsed, instead of its own strip. The conversation gains 28px.
- The check age moves in steps: "Checked just now", then 10-second and minute steps, so a healthy 5-second poll no longer changes the text every second. Session rows say "confirmed just now" the same way. An old check still counts up visibly.
- A failed turn is shown at the end of the conversation ("This turn ended with an error: …") with Send again and Edit message. It comes from the server's session state, so it is still there after a reload or on another device; before, only the 12px status strip said "Turn failed", and the streamed error line disappeared when the transcript reloaded. The server keeps the reason (up to 300 characters) with the session's outcome. Neither action overwrites a draft you are typing. Stopped turns are not shown as failures.
- The session list is checked with the previous response's ETag. An unchanged list answers 304 with the check time in an `X-Pocket-Checked-At` header, which still counts as a fresh server confirmation. Full responses for the list and a conversation are gzipped when the browser accepts it (the list was about 67 KB every 5 seconds per open tab).
- New session starts in your most recent workspace when there is no default and nothing remembered, so Start works straight away; the workspace is named above Start. A missing workspace or message is explained under Start instead of in a toast. A workspace whose path matches its name (the home folder) no longer shows it twice.
- Session options are grouped with hairlines: this conversation (Find, Changed files, Subagents, Plan usage), the session (Pin, Move, Rename, Hide, Permissions), the server process (Close session process), then display (Chat text size, Version & updates). Chat text size moved from the top to the display group.

## [1.18.0] — 2026-10-07 · build 51

- Pinned sessions are marked in the desktop tabs. A pinned session's tab shows the pin and its title in clay, the same marks as its row in the session list, so the sessions you are working on stand out from tabs you can close. Pinned tabs come first, in the pinned order, then the other tabs in the order you opened them; Alt [ / ] follow the same order. Requested by Damon Delcoro.
- Reorder pinned sessions. Pinned rows in the desktop list have a grip: drag it onto another pinned row to move the session, or focus it and press the up and down arrow keys. Session options also offers Move pin up and Move pin down on any device. The order is saved on the server beside pins and names (an order number in session-meta.json), so every device and the tabs follow it; a newly pinned session goes after the ordered pins by recency, and unpinning forgets its place. Older builds ignore the order number. Requested by Damon Delcoro.
- Mute voice in one tap. When voice is available, the composer has a Voice chip beside Alerts (an icon beside the bell while a turn runs) that mutes every spoken reply, announcement and approval or question prompt on this device, without changing Speak replies, Announce sessions or the other voice settings; tap it again to hear them. Muting stops anything being spoken and ends a hands-free conversation; starting hands-free, or saying "unmute", turns voice back on, and "mute" mutes it. While muted, quick commands show their answer in the voice strip instead of speaking it, the completion chime applies as configured, and Play a sample still plays. Settings → Voice shows the same switch. Requested by Damon Delcoro.

## [1.17.0] — 2026-10-06 · build 50

- Reply suggestions show the recommended option. When Claude or Codex has a clear recommendation among the choice buttons under a closing question, that button is filled clay with a small Recommended tag; the others keep their outlined look. The agent marks its pick by ending the option with "(Recommended)" in the choices block; Pocket strips the marker, so a tap still sends the plain option text and the reply reads cleanly in the transcript and in other clients. At most one option is marked, and an even choice stays unmarked. Older replies without a marker look as before. Requested by Brad.

## [1.16.0] — 2026-10-06 · build 49

- Subagent activity: a visible working count opens a list of delegated tasks. Expand an agent for its prompt, status, latest activity or result, and model/tool usage when reported. Available for Claude and Codex; Session options includes the view even before the first agent is recorded.
- Activity refreshes every five seconds, preserves expanded details, and survives browser reconnects through provider records. Unknown or stale states are labelled; background shell jobs do not inflate the agent count. Read-only inspection never resumes a child thread.

## [1.15.0] — 2026-10-06 · build 48

- Mark as reviewed. A session showing Response ready stayed in Attention until you opened it, even when you had already seen the reply elsewhere or did not need to. Long-press a session (or tap ⋯) and choose Mark as reviewed to clear it without opening it; failed turns can be cleared the same way. In Attention and New, a bar at the top shows how many are waiting and offers Mark all reviewed, with Undo for 10 seconds. Questions and approvals stay until they are answered.
- Reviewed is now shared by all your devices. Opening a session or marking it reviewed on the desktop clears Response ready (and a seen failed turn) on the phone too, and the reverse; before, each browser kept its own record, so the phone kept listing replies you had already read at your desk. The server keeps the markers in session-meta.json beside pins and names. Markers a browser saved before this release are sent up the first time it loads, so nothing already read comes back. Undo of Mark all reviewed restores the earlier state everywhere. The empty Attention list now says "Nothing needs your attention." Requested by Brad.

## [1.14.0] — 2026-10-06 · build 47

- Spoken reply length. Settings › Voice has Brief (one sentence, like the alert line), Normal (about two sentences, the default and the previous behavior) and Detailed (the whole reply, skipping code, tables and links, ending on a sentence after about three minutes with "The rest is on screen"). It applies to the reply spoken when a voice turn finishes and to "read it". "What's it doing" stays short at any length, and "read it all" always reads the whole reply. It only changes how much of the written reply is read aloud. It does not change what Claude or Codex writes. Requested by Brad.

## [1.13.2] — 2026-10-06 · build 46

- Session menu: the sheet opened from ⋯ (or a long-press on a session) is titled "Session options", with the conversation's name on its own line beneath. It used to show only the name as the heading, so a session called "Pocket Code version check" looked like a version feature with nothing in it. Reported by Brad.
- Version & updates in the session menu. Inside a conversation the ⋯ menu shows "Pocket Code 1.13.2 · build 46" and opens Settings with About & updates expanded and in view; before, the version was only reachable from the session list's gear, behind a collapsed section. The About & updates line in Settings now shows the version even when collapsed.

## [1.13.1] — 2026-10-06 · build 45

- The context window of a 1M session (Opus 5.5, Fable 5.1) no longer drops to 200k while a turn runs. The CLI reports the real window at the end of a turn under the name "claude-opus-5-5[1m]", but the next turn's streamed lines and transcript call the model "claude-opus-5-5". The transcript re-estimate then guessed 200k (anything under 200k used) and overwrote the reported window until the turn ended, so a session at 164k looked 82% full. A reported window is now kept while the session stays on that model, and when no window has been reported yet, the model Pocket launched the session with decides the estimate. Sessions started outside Pocket still show "estimated" until a turn reports the window. Reported by Brad.

## [1.13.0] — 2026-10-06 · build 44

- Context ring. A 22px gauge beside the composer's settings button (in the working row while a turn runs) fills as the session's context window fills, amber at 70% and red at 90%. Hover or focus it for the model, tokens used, the window and the percentage. Click it for a Usage panel: this session's context (window, used, free, as-of, estimate note) and the provider's plan windows. It replaces the text meter in the state bar. Unknown models get a readable name from their ID (claude-opus-5-5 → Opus 5.5).
- Hands-free confirmation. In a hands-free conversation an instruction is read back ("Ready to send: …. Say send it, or cancel.") and shown with Send, Edit and Cancel. Only a short yes (send it, yes, go ahead, do it) or a tap sends it. Cancel drops it, Edit moves it to the message box, and anything else replaces it and is read back again. Quick commands still answer at once; the plain mic still sends directly.

## [1.12.0] — 2026-10-05 · build 43

- The Attention filter and count include sessions marked Response ready until you open them, alongside questions, approvals and failed turns. The list summary counts them too. Session grouping and the voice "what's waiting on me" answer still mean a question, approval or failure.
- Phones and panes up to 600px wide give the message box its own full-width row, with settings, headset, mic and Send (and Steer now / After this turn while a turn runs) on the row beneath. Before, the box shrank to a few characters while steering. Contributed by Damon Delcoro.
- A message sent to an idle session no longer disappears until the turn ends. The CLI writes the user line to the transcript a moment after the turn starts, and the re-render right after the send landed in that gap. The session view now includes the running turn's own message, dimmed as pending, until the transcript has it. It matches on that message among lines written since the turn started, so a steered or queued message landing after it never brings it back twice. Reported, with a first patch, by Damon Delcoro.

## [1.11.1] — 2026-10-05 · build 42

- While a turn streams, consecutive tool calls stay in one fold even when an empty live placeholder sits between them, so you see one line whose summary shows the count and the latest call, updating as the turn runs. Contributed by Damon Delcoro.

## [1.11.0] — 2026-10-05 · build 41

- Reply suggestions. When a reply ends by asking you to choose between specific next steps, the options appear as buttons under the latest reply once the turn has finished. A tap sends the option as your next message. Typing in the message box hides them; the X dismisses them for that reply (remembered on this browser). They are excluded from Copy message and spoken replies.
- Pocket adds a short instruction to the turns it runs asking the agent to end such questions with a fenced `choices` block: Claude via `--append-system-prompt`, Codex via thread developer instructions. A Codex config with its own `developer_instructions` is never overridden (no suggestions there). The server turns a block at the very end of a reply into reply options, so the raw block never shows, even while streaming; an example mid-reply stays text. `POCKET_CHOICES=0` turns the instruction off.
- Session search includes the suggested options.

## [1.10.1] — 2026-10-05 · build 40

- With side conversations open (split view), the round + New session button is anchored to the main column instead of the window, so it no longer covers the Send button of the pane on the right. Reported by Brad from Mission Control.

## [1.10.0] — 2026-10-05 · build 39

- Hands-free has its own button. The headset beside the mic starts a hands-free conversation for the open session: each reply is read aloud and the mic listens for your answer, then repeats, until you tap the headset again, tap Cancel or Stop, leave the session or stay quiet past the wait. The mic sends one message and never reopens by itself. The Keep listening setting is removed, so hands-free is never on unless you start it; a saved Keep listening preference is ignored.
- Spoken announcements never turn the microphone on. Session alerts, approval and question prompts, and the spoken reply to a typed or single mic message are one-way, including while a hands-free conversation is on.
- The headset hides while the message box holds a typed draft (speech then only adds to the draft), which keeps the phone composer wide enough to type in. The placeholder stays on one line.
- Tool calls fold behind a one-line summary with the number of calls and the latest one ("12 tool calls · Edit app.js"); consecutive calls merge into one fold even across transcript messages. Settings → Collapse tool calls (on by default) opens them all.
- Settings → Highlight colour: Orange (default), Blue or Purple, saved on this browser. The search highlight follows it.
- A sent message appears immediately, dimmed until the server confirms it. If delivery fails it is removed, including its file chips, and the text returns to the box.
- An open window offers a reload when the server is running a newer build.
- Pinned sessions come first in each session group, in the highlight colour, with a rule before the rest.
- The tool-call folds, highlight colour, instant echo, reload banner and pinned-first list were contributed by Damon Delcoro.

## [1.9.0] — 2026-10-05 · build 38

- Spoken alerts (voice beta). Settings → Voice (beta) → Announce sessions: Off (default), Session name only, or Name and a one-line summary. While Pocket is open it says when any session finishes ("The SCK inventory session finished. 42 products are below their reorder level."), stops with an error, or needs your approval or answer, and replaces the completion chime.
- Alerts queue behind your speech, recordings and other replies; each event is said once across Pocket tabs; split panes stay quiet; per-session mute silences a session. A hidden tab keeps checking every 8 seconds while alerts are on.
- Browsers allow sound after one tap on the page. An alert that arrives earlier waits for that tap, with a note, instead of stalling the voice controls.
- The session list reports which sessions are muted.
- A reply that finishes while its conversation is on screen keeps the green Response ready and New label until you tap, click, type, scroll, switch back to the tab or open the session. Voice mode keeps the screen awake while you wait, which made those replies count as read immediately.

## [1.8.2] — 2026-10-05 · build 37

- Voice mode is labelled beta: Settings → Voice (beta), the mic button's name and tooltip, and the README, workspace guide and operations guide. It works and is still being tuned from real use. The app version is a normal release, not a pre-release.
- Settings → Voice (beta) points to Bugs & feature requests for voice problems.

## [1.8.1] — 2026-10-05 · build 36

- With Keep listening on, the mic now waits up to 2 minutes for your reply after a spoken summary (it stopped after 8 seconds), so you can read the rest of the response before answering. Settings → Voice → Wait for my reply offers 30 seconds to 5 minutes. A tap still listens for 10 seconds.
- While waiting, short background noise no longer ends listening, and Whisper's phantom "Thank you" on noise is ignored instead of being sent. A long wait keeps only recent silence in memory.
- A recording is limited to 60 seconds of speech, counted from when you start talking rather than from when the mic opened.

## [1.8.0] — 2026-10-05 · build 35

- Voice mode (optional). A mic button beside Send records what you say; tap to talk and it sends when you pause, or hold for push-to-talk. Speech-to-text (Whisper) and text-to-speech (Kokoro) run in a local process on the Pocket server that starts on first use and stops when idle. No audio or text goes to a speech service. Install with `scripts/voice-setup.sh`; without it the mic stays hidden.
- Short spoken commands are answered on the device without the agent: what's it doing, stop, read it, read it all and what's waiting on me. Anything else is sent as a normal message, steering a running turn or starting a new one.
- When a turn you started by voice finishes, a short summary of the reply is read aloud. Code, tables and links stay on screen. Approvals and agent questions are announced, and still need a tap.
- Settings → Voice: speak replies, review the text before sending, keep listening for hands-free back and forth, voice choice and names to recognize.
## [1.7.3] — 2026-10-05 · build 34

- A session's green Response ready label in the session list now lasts only until you open the session. After that it shows as Recent, like any other session. Unread replies keep the label and the New marker.
- Browser regression covers the label before and after a reply is opened.

## [1.7.2] — 2026-10-05 · build 33

- Settings has a Bugs & feature requests section that opens the GitHub issue forms with your version filled in. Security problems are pointed to private reporting.
- The repository gains bug-report and feature-request issue forms, and the README and contributing guide say where to report problems and ask for features.
- Keyboard focus stays inside Settings on current Chrome: links inside collapsed sections no longer count as the sheet's last tab stop.

## [1.7.1] — 2026-10-04 · build 32

- Split panes that no longer fit are hidden in place and return when the window widens, keeping their drafts and sessions.
- Settings opens even if notification support is unavailable. Failed update checks offer a retry instead of saying Up to date.
- Accounts, usage and notification settings come first; version details and release notes are in expandable sections.
- Keyboard fixes cover agent and workspace choices, skip links, dialog focus and accessible split resizing.
- The session list keeps common filters visible and remembers the expanded filter panel. Active filters stay visible when collapsed.
- Message settings have scroll buttons when they do not fit. Closing a session process is a labelled action in Session options; tab and pane X controls only close views.
- Browser regressions cover the UI audit failures, with axe checks for the repaired views.
- Refresh the desktop/mobile README and screenshots, consolidate workspace and persistent-session operations guides, and add CI plus release-metadata/document-link checks.

## [1.7.0] — 2026-10-04 · build 31

- Collapse the session header on any screen size, including its Mission Control wrapper. The slim header retains session navigation, title and live server status.
- Hide the message settings toolbar independently with the gear beside the input. Attachment access, attached files, Send, delivery problems and running-turn controls remain available.
- Remember both preferences per browser through reloads, folding and resizing. Collapse changes preserve the input, draft, reading position and open panels.
- Each Claude Code session now keeps one process running between turns instead of starting a new one per message. Its working directory, MCP connections and background jobs carry over, and turns start without the few seconds of startup.
- Turns the agent starts by itself, such as reporting a background job that finished after the turn ended, are streamed live and notify like any other turn.
- A session's process closes after 60 idle minutes (`POCKET_IDLE_CLOSE_MS`). It never closes while a background job is running; the next message resumes the session from its transcript.
- The 2-hour limit on a turn is gone. A stall watchdog stops a turn only after 30 minutes (`POCKET_STALL_MS`) with no output, no background job, no question or approval waiting on you and no CPU use by programs the turn started.
- Pocket replaces a session's process when the model, effort, workspace or permissions change, or when another app (code-server, a terminal) added turns since Pocket's last one, so its process never carries a stale copy of the conversation. Sending is refused while another app is in the middle of a turn on that session.
- Running processes survive a Pocket restart: input goes through a named pipe that the restarted server reattaches to.
- Codex threads get the same treatment: one app-server per thread, kept between turns so MCP connections, tools and questions stay up; same 60-minute idle close and 30-minute stall watchdog (interrupt first, then close). While Pocket has a thread open it holds Codex's writer lock, so close the session in Pocket (or let it idle out) before continuing it in code-server. A permissions change reopens the app-server.
- Codex sessions now survive a Pocket restart, including a turn in the middle of its work: the app-server reads a named pipe held open by a keeper process and writes to a log file the restarted server picks back up (`turnlogs-codex/`). Before, a restart ended any running Codex turn within a second.
- Context meter on every session: tokens used out of the model's window (for example `70k / 1M · 7%`), amber from 70% and red from 90%, marked `est.` when worked out from the transcript of a session Pocket didn't run. Phones show only the percentage.
- Plan usage panel (session options and Settings): 5-hour and weekly limits with reset times in Eastern, extra-usage status, and when the figures were last reported. They refresh whenever a turn runs. Codex sessions show Codex's own limits when its app-server reports them.
- Close the main session from its header on desktop (session options on phones). A pane beside it moves into its place, otherwise New session opens. Closing ends the session's process; if a turn or background job is still running it asks whether to keep it running or stop it. The session stays in your list.
- Review fixes (2026-10-04): a failed request (for example a transcript deleted while it was being read) now answers 503 instead of taking the daemon down with every open stream; pins, names, mutes, settings and push subscriptions are written atomically; the context meter uses the last call's context rather than the turn's cumulative token total (which read 100% on long sessions); a fresh stream connection no longer replays the running turn on top of the transcript (messages showed twice after a steer or phone unlock); a message that arrives as a turn is finishing starts the next turn instead of being written into the idle process as an unlabeled one; a background job and an interrupted approval are remembered across restarts; a Codex turn that fails to start releases the thread; the end-of-turn transcript restamp reads only the new bytes; empty or non-numeric `POCKET_APPROVAL_MODE`/`POCKET_STALL_MS` values fall back to defaults instead of breaking boot or stopping every turn; passwords with non-ASCII characters work; delivery receipts are pruned after seven days.
- Review fixes, second batch: a tool request or question that was waiting when Pocket restarted is denied on adoption so the turn carries on (it used to wait on an answer that could never come until the 30-minute stall); `POCKET_MAX_PROCESSES` (default 8) closes the longest-idle process before starting one past the cap; a transcript-mirror stream numbers events by transcript offset and the Codex watcher by item id, so a reconnect resumes instead of repeating or dropping lines; a daemon restart during a turn makes the client resync instead of replaying mismatched events; an unreachable server shows a retry view instead of a blank screen; the approval banner keeps the server's wording ("delivery uncertain", "connection interrupted") instead of inviting a second approval; a Review mode you chose yourself survives a change of the instance default; the usage panel dates older "as of" stamps and marks windows that reset since they were observed; the context meter follows terminal turns again and shows when it was observed; promoting a New-session pane to main keeps its draft.
- Security: a Content-Security-Policy on every response (same-origin scripts, styles, connections and images; framing only from `POCKET_FRAME_ANCESTORS`). Remote images in agent Markdown no longer load automatically. `POCKET_ENV_FILE` lets tests and alternate installs skip the checkout's `.env`.


Pocket Code uses [semantic versioning](https://semver.org/) from 1.0.0 onward. The app's
settings sheet also shows a **build number** (`v19`, …), which goes up with every
front-end release so browsers load fresh assets.

## [1.6.1] — 2026-10-04 · build 28

- Split view offers New session first. The pane opens the New session screen with
  its own draft, attachments, choices and retry state (`new-pane-<key>`, removed when
  the pane closes), and becomes that session once started. One waiting New pane at a time.
- Show a message steered into a running turn as soon as the server confirms it. The CLI
  records it in the transcript only at its next step, so the canonical re-render hid it
  until then; the local copy drops once the transcript has it.
- Test CLI defers steered transcript lines like the real CLI.

## [1.6.0] — 2026-10-04 · build 27

- Desktop split view: up to four sessions side by side. Open one from the Split view
  header button or Open beside in session options. Each pane is a full Pocket window
  (`/?pane=1`) with its own stream, composer, draft, questions and approvals.
- Pane header buttons swap a pane with the main conversation or close it (the session
  keeps running). Dividers resize by drag or arrow keys; double-click resets. Panes
  persist per browser and stay hidden below 900px.
- Tooltips on hover and keyboard focus explain icon-only and abbreviated controls
  (Results, Queue, Git, Find, Changed files, toolbar chips, rail actions). Touch is unchanged.
- Notification clicks open in the top-level window, never inside a split pane.
- Security: agent turns (Claude and Codex) no longer inherit `POCKET_PASSWORD`,
  `POCKET_SECRET` or `VAPID_PRIVATE` from the daemon environment. Test servers ignore
  a live instance's `POCKET_*`/`VAPID_*` settings.

## [1.5.0] — 2026-10-04 · build 26

- Add `POCKET_CLAUDE_MODEL`/`POCKET_CLAUDE_EFFORT` and `POCKET_CODEX_MODEL`/`POCKET_CODEX_EFFORT`:
  Pocket-only defaults for turns left on Default, including queued and retried turns.
  Terminal and editor sessions keep the CLI config. Invalid values are logged and ignored.
- Model and Effort chips show what Default will run. Max is now an explicit effort choice
  instead of the Default label.
- Add `POCKET_DEFAULT_CWD` to preselect one workspace on the New session screen.
- When the instance default is Full access, drop the Review choice each session recorded
  at creation (once per browser), so existing sessions follow the new default.

## [1.4.1] — 2026-10-04 · build 25

- Keep a run-confirmation strip visible even with headers collapsed. Poll authenticated
  server turn state every 5 seconds, show check age, distinguish pending input/completion
  from external estimates, and mark status unconfirmed after failed or stale checks.

- Keep existing chat composers within the visible viewport through Fold resizing,
  rotation and keyboard changes, without remounting conversations or losing drafts.
- Paste screenshots into chat/new-session text areas, or use Attach → Paste screenshot.
  Bind uploads to the initiating session and wait for uploads before sending.
- Make conversation-header collapse available on phones, keep turn controls on one
  scrollable row, and widen desktop conversations from720px to1280px.
- Publish frontend release metadata with the static bundle, so a UI-only upgrade
  can report its version accurately without restarting active server-side turns.

## [1.4.0] — 2026-10-04 · build 24

- Add native action approvals for Claude and Codex, with complete escaped command,
  file-change and tool previews, explicit decisions and Needs approval state.
- Default new turns to Review actions; allow an explicit Full access choice. Instance
  operators can set the default or disable Full access. Queues and retries retain
  their selected policy; steering does not change a running turn's permissions.
- Bind decisions to a pending native request, audit hashes/decisions before sending,
  reject stale/conflicting replies and prevent replay after uncertain delivery.
- Keep pending requests across browser reconnects and show explicit recovery when
  a server restart loses an approval connection. No employee isolation is implied.

## [1.3.1] — 2026-10-04 · build 23

- Adjust conversation text from 14 to 24px (17px default) in Session options and
  App Settings. Preview changes, reset the size, and remember it per browser.
  Scale report headings and tables with prose; keep toolbars and code at their
  existing sizes. Preserve the current reading anchor when changing size.
- Tighten desktop header, tab and session-list spacing while retaining readable
  conversation text and 44px control targets.
- Add independent conversation-header and session-filter collapse controls, saved
  per browser. Keep search, active-filter summaries, warnings and conversation tools
  accessible. Collapsing does not reload the conversation, draft or open tool panel.
- Preserve the existing phone layout when desktop collapse preferences are saved.

## [1.3.0] — 2026-10-04 · build 22

- Add persistent desktop session tabs, keyboard switching, resume-last navigation,
  and a docked Results / Queue / Git panel. Phone views remain focused sheets;
  narrowing a desktop window preserves the open panel as a dialog.
- Filter sessions by workspace, provider and pinned state. Hide/restore older
  sessions on this device; active work stays visible and new activity resurfaces it.
- Relay real Claude AskUserQuestion and Codex native question requests with
  choices, free text, multi-select where supported, explicit needs-answer state,
  notifications and duplicate-answer protection. Codex adds Plan first / Work
  normally for subsequent turns, including saved follow-ups.
- Inspect read-only repository status and staged/working diffs, scoped to the
  session workspace. Disable Git external diff/textconv/fsmonitor execution and
  refuse hidden/sensitive paths, symlink escapes and oversized previews.
- Show provider identity/plan metadata in Accounts & instance without exposing
  credentials or changing logins, permissions or memory configuration.
- Pause queued instructions while editing; retain edits on the device and the
  paused state on the server. Saving or canceling releases the edit reservation.
- Show explicit recovery if a daemon restart interrupts a Claude question.
  Browser reconnects keep the original question; stale replies never target a
  different turn. Codex prompts expire with their owning connection.
- Keep completed Pocket-owned transcript updates from being misreported as external
  activity or unnecessarily blocking a paused queue.
- Update compatible dependency patches; npm audit reports no known vulnerabilities.

## [1.2.0] — 2026-10-03 · build 21

- Render safe GitHub-flavored Markdown: tables, nested lists, checklists, quotes and
  proper headings. Wide tables scroll inside the conversation on small screens.
- Add per-session Results with search, shared links and session-bound report
  downloads. Local HTML and other active reports download instead of executing.
- Add explicit Steer now / After this turn controls and a persistent, editable
  follow-up queue. Stop/failure pauses automatic drain; ambiguous starts require
  review. Codex steering and turn starts await runtime acknowledgment.
- Put the task first on New Session, add searchable installed-skill discovery for
  Claude and Codex, and collapse workspace/agent setup below the main action.
- Preserve reading position when switching/reopening conversations, including phone
  sleep/resume. Honor reduced motion in sheets.
- Vendor pinned Marked and DOMPurify with licenses; expand API/browser coverage.

## [1.1.0] — 2026-10-03 · build 20

- Group sessions by confirmed runs, external activity, failures, waiting and recent
  history. Filter active work and unread results; search titles and workspaces.
- Keep Pocket-owned runs visible before their transcript is written. Distinguish
  external transcript activity from confirmed running status and label stale data.
- Add a mobile session switcher, shared desktop rail, visible session menus, dialog
  keyboard/focus behavior, more legible secondary text and larger toolbar targets.
- Preserve outgoing text and attachment references through connection failures and
  reloads. Durable request receipts prevent duplicate dispatch on retry; ambiguous
  interrupted requests require conversation review before sending again.
- Add isolated server-state configuration and fixture-based API/browser tests.
- Revalidate the app entry page and service worker so installed clients pick up releases.
- Settings show the semantic version alongside the browser asset build number.

## [1.0.1] — 2026-09-28 · build 19

- **The session list loads in well under a second again.** The Codex half of the list asked
  Codex to re-scan every saved rollout on each load, which took about 5 seconds on a busy
  server and kept growing. It now reads Codex's session database instead (same results, ~20 ms);
  the existing 15-second activity poll keeps that database repaired in the background.
- Codex sessions are ordered by last update, matching the rest of the list, so an old session
  picked back up today isn't pushed off the page.
- After a restart, the first list load reads session metadata eight files at a time instead
  of one by one.

## [1.0.0] — 2026-09-26 · build 19

First public release. Before this, the project ran privately as "Pocket Claude" through
thirteen internal releases (listed below).

- Published under the MIT license, with a new README, changelog, security policy and
  `.env.example`.
- Project paths shorten to `~` under any home directory, not only `/home/ubuntu`.
- The push-notification contact comes from `VAPID_CONTACT` (email or https URL) instead of
  a built-in address.
- `server.mjs` is plain text again (a literal NUL separator is now written as `\u0000`), so
  it displays and diffs normally.

## Internal releases (Pocket Claude)

### 2026-09-25 · build 18
- Model picker offers Fable 5.1 and Opus 5.5 (1M context), Sonnet 5 and Haiku 4.5. The
  Claude model list is defined server-side, and "Default" names the model your settings use.
- The Codex model list and version display refresh by themselves after a Codex CLI upgrade.

### 2026-09-09 · builds 16–17 — renamed Pocket Code
- Renamed from Pocket Claude when Codex sessions joined Claude Code.
- "What's new" panel in settings, plus a one-time toast after an update.
- Codex provider stays off when no `codex` binary is installed, and a failed spawn no longer
  crashes the server.
- Codex threads started in older extension builds (legacy history format) open correctly.

### V13 — 2026-09-06 · build 15 — Codex
- Codex threads, including ones started in the code-server / VS Code extension, are
  full sessions: list, read, stream, steer, stop, start new ones, and live mirroring.
- Codex's one-writer-per-thread lock is respected, with a clear message when another
  surface holds the thread.

### 2026-08-22
- Transcripts written by Claude Code CLI 2.1.239 no longer render as blank sessions.
- Sessions started from Pocket appear in code-server's session picker.

### V12 — 2026-08-17 · build 14
- Optional two-way session-name sync with Claude Code and code-server.

### V11 — 2026-08-17 · build 13
- Rows show the project folder name instead of the full path.
- Derived titles drop `Workdir: /path` boilerplate.
- The New screen preselects the last project you used.

### V10 — 2026-08-17 · build 12
- Pin and rename sessions (long-press or right-click a row, or tap the chat title).

### V9 — 2026-08-16
- Settings sheet with app and CLI versions, an update check, and chime and push toggles.

### V8 — 2026-08-16
- Mid-turn steering, upload thumbnails, per-session notification mute.

### V7 — 2026-08-16
- Changed-files view, auto-continue after usage-limit resets, session-list cleanup,
  full-transcript search.

### V6 — 2026-08-16
- Find-in-conversation, copy buttons, saved drafts, plan checklist, completion chime.

### 2026-08-14 to 2026-08-15 — V1 to V5
- **V1:** mobile PWA and a server-side turn daemon (`claude -p --resume`) against the
  shared session store.
- **V2:** attachments, per-turn model and effort, slash-command autocomplete, stop button,
  per-turn cost.
- **V3:** push notifications, session search, message queueing, word-by-word streaming,
  inline images.
- **V4:** live mirror of sessions driven from other surfaces, desktop two-pane layout.
- **V5:** resizable, collapsible session rail and quicker new-session buttons.
- Turns survive a service restart (detached turns, PM2 `treekill: false`, re-adoption).
- Fixed a composer that stayed on "Working" after a dropped connection.
