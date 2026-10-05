# Changelog

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
