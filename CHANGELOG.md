# Changelog

Pocket Code uses [semantic versioning](https://semver.org/) from 1.0.0 onward. The app's
settings sheet also shows a **build number** (`v19`, …), which goes up with every
front-end release so browsers load fresh assets.

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
