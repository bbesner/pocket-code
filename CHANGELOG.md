# Changelog

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
  server turn state every5seconds, show check age, distinguish pending input/completion
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
