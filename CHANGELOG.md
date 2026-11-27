# Changelog

Every version that reached a server is listed here, newest first, with its frontend asset
build. Each has a matching [GitHub release](https://github.com/bbesner/pocket-code/releases).

## [1.126.0] — 2026-11-27 · build 237

**Answer action approvals from the notification.** Off by default. Spec: `docs/plans/notification-approvals.md`
(Parts 1-5 and 7; Part 6, voice, is not built). The rules and what they do not cover are in SECURITY.md, "Answering
action approvals away from the app"; the steps are in the manual, Questions and approvals, "Answer from the notification".

### Added

- **Settings → Features → Answer approvals from notifications** (`approvalPush.answers`, default off). While it is on,
  each action approval gets its own notification, sent at once, that shows the action (`Runs:`, `Opens:`, `Searches:`,
  `Edits:` or `Uses:`), the folder and the conversation, with **Don't allow** and, on a device the owner has tested,
  **Allow**. Allow answers that one request only, never Always allow, and never Allow network access or Allow for this
  reply. It appears only for an action Pocket can show whole: short enough (**Longest action with an Allow button**, 80
  characters by default, counting the action and folder lines), in plain ASCII, with no `..` in the folder and nothing
  that looks like a password or key. Otherwise the notification says why the action is not shown and offers Don't allow
  only. A tap opens the request in Pocket.
- **Its own page, Settings → Features → Answers from notifications** (`approval-push.mjs`): **What approval notifications
  show** (the action, or only that an action waits, with Don't allow only), **Allow works for** (30 minutes, 5-240),
  **Allow on a check-back's actions** (on), **Allow on a job's actions** (off), and under Advanced: Allow per engine
  (Claude, Codex, OpenRouter, Antigravity; all on), **Longest action with an Allow button** (80, 40-240), **Notifications
  with buttons per conversation** (3, 1-10; the rest are counted in one summary notification) and **Update other devices
  after an answer** (on). Each can be preset with `POCKET_APPROVAL_PUSH_<NAME>`; a saved value wins.
- **Settings → Notifications → Action approvals** (a push kind, on by default for each device) and **Allow button on this
  device**: **Send a test notification**, then type the two codes it shows. A device offers Allow only after it passed the
  test at the current limit and while its Action approvals kind is on. Raising the limit turns the Allow button off on
  every device until each is tested again. **Turn off** removes it from one device.
- **After an answer.** The other devices' notifications for that request are replaced by a silent one that says what
  happened (allowed or not, from where and when, or that it is no longer waiting). An Allow that does not go through is
  never retried: the phone shows "Your Allow didn't go through: <reason>. Open Pocket." and the request's page says why
  above its card.
- **Settings → Usage → Answered away from the app**: answers from notifications, and answers Pocket refused, in the last 7
  days, with the kind of action and the push service, never the command.

### Security

- **The answer route now checks the origin for every caller.** `POST /api/session/:id/approvals/:request/decision` gained
  `sameOrigin`: a request whose `Origin` names another host gets 403. Pocket's own page and its service worker pass.
- **An Allow from a notification is checked again when it arrives.** Pocket re-runs the rules with today's settings, checks
  that the posting device was offered Allow for that request, that the notification is younger than **Allow works for**,
  and that the action, folder and kind still match what the notification showed (`shown`, a SHA-256 the notification
  carries back, compared with the same hash built now). Any failure refuses the answer with 409 and leaves the request waiting. `via` other than `app` or `notification`
  gets 400 `unknown_via`; with the feature off a notification answer gets 404 `answers_off`.
- **The approval record says where each answer came from.** Every `decision` line in `approval-decisions.jsonl` has
  `source` (`app` or `notification`); a notification answer adds `device`, `pushService` and `action`, and a refused one
  writes a `refused` line with its `reason`. Still no command or arguments.
- **What this does not cover** is listed in SECURITY.md: a stolen or borrowed phone that still shows notifications, the
  Vault's record (no source yet), stale buttons after a restart, a locked phone that can't send, no recent sign-in check,
  and untested behaviour behind Cloudflare Access.

### Changed

Visible with the feature off:

- Settings → Notifications has the **Action approvals** row and the **Allow button on this device** group; the push kinds
  are now six. With the feature off, approval notifications still come with **Finished replies**, as before, with no
  command details.
- Settings → Features lists **Answer approvals from notifications** and its page; Settings → Usage has **Answered away
  from the app**.
- A link of the form `/#/settings/<page>` opens Settings at that page.
- Every decision written by the app now carries `source: "app"`.

### Migration

None. The new settings are stored under `approvalPush` in `pocket-settings.json`; a device's test result is kept with its
subscription in `push-subs.json` (`approvalAllow`). **Rolling back to 1.125.3:** both are kept and ignored, and a device
that subscribes again loses its test result. 1.125.3 rebuilds a device's kinds from its own five, so a device that turned
Action approvals off gets it back on the first kind it changes there.

### Tests

- `test/approval-push.test.mjs` (the rules: what each engine's request shows, when Allow is dropped, titles, the summary),
  `test/approval-push-routes.test.mjs` (the settings, device test, push and answer routes against a running server with
  the fake Claude and Codex), `test/approval-push-sw.test.mjs` (the service worker's answer and the missed reasons) and
  `test/approval-push-live-browser.mjs` (the settings pages, the device test, Usage and the line above a request's card,
  in a real browser; added to `npm run test:browser`).
- The fake Claude can ask several approvals at once and withdraw one (`__REQS__`); the fake Codex can ask any kind of
  approval (`__CXREQ__`). Existing tests now expect the sixth push kind, `source: "app"` and the new Settings group.
- Not tested yet: the notifications on real phones (spec tests 30-32).

## [1.125.3] — 2026-11-27 · build 236

**A notification offers Allow only when its command, title and text were sent uncut and in plain characters.** A
security fix, first in the plan for answering approvals from the notification (`docs/plans/notification-approvals.md`,
Weakness 1).

### Security

- **A cut command no longer comes with Allow.** The Vault's request notification showed the command cut at 80 characters
  with no mark, and still offered **Allow**: the owner could allow, from the lock screen, a command whose end the
  notification never carried. Now a command over 80 characters (`VAULT_PUSH_COMMAND_MAX`) shows its first 80 characters
  followed by *… Open Pocket to read the whole command.*, and the notification has only **Deny**. A tap on it opens the
  request in Pocket, as before.
- **Nor does a short command that can hide its end.** A command of 80 characters or fewer is whole only when every
  character is printable ASCII. One with line breaks, tabs, a direction mark or any other character is shown with a space
  in place of each control, format or separator character, followed by *— Open Pocket to read the command exactly.*, with
  **Deny** only. Before, `sh -c "true` + 40 line breaks + `curl …|sh"` kept Allow and showed `sh -c true`.
- **Nor does a cut or unusual title or text.** The push cuts a title over 70 characters, and a body that would not fit a
  push message. When it does, or when the title or the text holds a control character, a format character (direction
  marks, zero-width characters) or a line or paragraph separator, it now drops **Allow** from that notification, for every
  request that carries it: Vault runs and fills (many or long item names, a conversation title with line breaks) and file
  share or publish requests (a long file title, or one with a line break). **Deny** and any other button stay, so a due
  task or reminder keeps its own buttons. Ordinary letters such as accents keep Allow in a title. A push without Allow is
  sent exactly as before.
- **What this does not cover.** The server knows what it sent, not what a phone draws: a phone can fold a long
  notification until it is opened out, and the notification never carries the folder or the variables (the request in
  Pocket shows them).

### Fixed

- The log line for a Vault run, Vault fill or file request push now ends with `allow=yes`, or `allow=no (command cut)`,
  `(title cut)`, `(text cut)` or `(unusual characters)`, only when at least one device got the push. These words do not
  include the command.
- Nothing is stored differently: the request itself, the card in Pocket, the answer route and the service worker's answer
  code are unchanged. New asset number so phones load the new release notes.
- **Code.** The rules live in a new module, `push-text.mjs` (`pushShape`, `vaultPushCommand`, `allowNote`, and `cutBytes`
  moved from `server.mjs`), which `pushRaw` uses.
- **Tests.** `test/push-whole.test.mjs` reads what a device receives from a push service on the test machine: 80 printable
  characters whole with Allow and Deny, 81 marked with Deny only; line breaks, U+202E and tabs in a short command get Deny
  only; a command cut at an emoji leaves no half character; Deny still answers a cut request; long item names on a run or a
  fill, a long file title and a file title with a line break lose Allow, while a short or accented title keeps both; a cut
  reminder title keeps Tomorrow; with push off the log has no `allow=` word. `test/push-text.test.mjs` checks the helpers
  directly, including the body cut by bytes, which no route that offers Allow reaches today, and the title at 70 against 71.

## [1.125.2] — 2026-11-27 · build 235

**New job keys default to Full access**, the owner's decision of 2026-11-27: work he asked to run unattended should run
without stopping for approvals unless he chose otherwise.

- **The default.** The **Access** setting for new keys (`jobAccess`, `automation.mjs`) now defaults to `full`. On a server
  that allows Full access, a key made on the **New job key** sheet starts at **Full access**, and so does a key a
  conversation proposes without `--access` (`pocket-jobkey`, `/api/jobs/agent/propose`); the access is fixed on the request
  when it is proposed, and the Allow/Deny card shows it. Where the server turns Full access off (`POCKET_ALLOW_FULL_ACCESS=0`),
  a new key is still `ask`, as before (`jobDefaults()` and `jobKeyFields()` in `server.mjs`, unchanged).
- **No migration.** Existing keys keep their access. An install where `ask` was saved keeps it; one with no saved value gets
  the new default. **Reset to defaults** returns to Full access. `POCKET_AUTOMATION_JOB_ACCESS` still presets it, and a saved
  value still wins. Job keys stay off by default.
- **Words.** The setting's help text, the `pocket-jobs` skill (leave `--access` out so the key follows the owner's default and
  say which access it will have; `--access ask` when the owner wants every action approved, or for a read-and-report job the
  owner prefers to approve), the `pocket-jobkey` help, the manual (Automation, For agents, Questions and approvals, Feature
  reference) and SECURITY.md, which now states the risk: under Full access, text in a job's data could steer the agent into a
  command with nothing stopping to ask, and recommends Ask first for a key whose data comes from people outside the owner's
  control and whose job doesn't need to change anything.
- **Tests.** New: a key with no access is `full` and `defaults.access` is `full`; a saved `ask` wins; reset returns `full`;
  the env preset and a save over it; a proposal with no access follows the default (`full`, then `ask` once saved; `ask`
  where Full access is off). Tests that meant Ask first now say `access: 'ask'`.

## [1.125.1] — 2026-11-27 · build 234

Claude Code account switching works with the shorter sign-in link introduced in Claude Code 2.1.330. Get sign-in link now shows Open Claude sign-in and Copy link. Earlier Claude Code versions still work.

## [1.125.0] — 2026-11-25 · build 233

**Sort and search for Tasks and the Vault**, requested by Damon. Design doc: `docs/plans/tasks-vault-sort-search.html`.

- **One order per list, kept on the server.** New settings `tasksOrder` (`due`, `new`, `old`, `name`, `workspace`;
  default `due`) and `vaultOrder` (`new`, `name`, `who`, `used`, `kind`, `expiry`; default `new`). `POST /api/settings`
  refuses any other value with 400 `bad_order`. `GET /api/tasks` returns `order`; `GET /api/vault` returns `order` and
  `orderChosen`. Picking an order in a list saves it, so the list opens that way on every device, and **Settings →
  Features → Tasks › / Vault › → Default order** shows and changes the same value.
- **Migration.** The Vault's per-device A–Z (`pc-vault-order` in localStorage, 1.93) is handed to the server once, only
  when no order was chosen yet, then removed.
- **Tasks.** Search and Sort above the full list; a search box and sort button in the rail. Orders: Due first (1.50's
  one timeline of tasks and project reminders), Newest added, Oldest added, A–Z, Workspace (headed groups, No workspace
  last). In the other orders, project reminders gather in a Project reminders group. Search matches text, conversation
  title, workspace and briefing; matches are marked; Done opens when a finished task matches; Check-backs and Jobs hide
  while searching.
- **Vault.** Orders: Newest first, A–Z, Who can use it (Free rein → Asks once → Asks every time → Only you, headed),
  Recently used, Kind (headed), Expiring soonest. Search adds the words for who can use it. A **Filter** sheet narrows by
  who can use it and kind, with a summary line and Clear. Every row now shows who can use it first in its facts line, as a
  coloured dot and words (amber, blue, purple, green square), from existing tokens.
- **Rail.** The **Filters** toggle now shows on Tasks and Vault too, folding their search row.
- **Code.** New `public/listtools.js` (search box, sort select and button, marking, focus keeping, saving the order),
  shared by `tasks.js` and `vault.js`.
- **Docs.** `docs/manual/tasks.md` (new **Sort and search**), `vault.md` (**Find a secret**), `settings.md`,
  `features.md`, `desktop-and-phone.md`; DESIGN.md section 1.125.
- **Tests.** `test/notify.test.mjs` (the task order, refusals, `order` in the list), `test/vault-key.test.mjs` (`order`
  and `orderChosen`), and the browser check *Sort and search (1.125)*: every Tasks order, search with marks and focus,
  the rail row and sort sheet, the migration, who-can-use-it groups and dot colours, the Filter sheet, Settings, and the
  phone layout, with accessibility scans.

## [1.124.10] — 2026-11-25 · build 232

One change, contributed in #296: **Copy link for a file already shared by link.** Before this, a link's address was shown once,
when it was made, so sending it to a second person meant making a new link, which cut off the first.

- **What changed.** Pocket now keeps a link's token in two forms: a hash, as since 1.118, and the token itself sealed with
  AES-256-GCM. The key is derived from `POCKET_SECRET` (`linkKeyFrom` in `documents.mjs`, an HMAC with its own label), and
  the seal is bound to the record's id. A file shared by link has **Copy link** on its row, card, toolbar and in File options,
  and its Share sheet shows the address again.
- **Who can read it.** Only the signed-in owner, from Pocket's own page: the new `POST /api/documents/:id/link` (cookie and
  same origin, answered `no-store`). The CLI token cannot, so an agent still gets a link's address only in the answer that
  made it. The sealed token is never in a listing or a record's view, and moving a file to the trash or making it private
  drops it.
- **What this gives up.** This partly reverses 1.118's PC-05, under which only a hash was stored. Someone who has both
  `documents.json` and `.env` can now recover the addresses of open links. The owner chose it on 2026-11-24. `SECURITY.md`
  says so.
- **Older links.** Links made before this release, or before `POCKET_SECRET` changed, keep working, but Pocket has only
  their hash: they show no **Copy link**, and their Share sheet says so. Making a new link gives one that can be copied.
- **Merged with 1.124.2–1.124.9.** The store now takes both `log` (1.124.2) and `linkKey`. `shareSheet` takes
  `{again, focus, asked}`: the 1.124.5 focus return, plus `asked` from #296 so a kept link is fetched once. The "Link made"
  toast no longer says the address is shown once.
- **Docs.** `docs/manual/files.md` (from #296), `docs/manual/features.md`, `README.md` and `SECURITY.md`.
- **Tests.** `test/documents.test.mjs` checks the following:
  - The token is sealed and opens again.
  - It is not in the view.
  - A store with another key cannot open it.
  - Trash and Private drop it.
  - A link made without a key reports `link_not_kept`.
  - In the browser (`test/ui-regressions.mjs`, Documents 1.30), the Share sheet shows a kept link's same address again.
  - **Copy link** is in the toolbar and copies that address, or opens the sheet with it.
  - **Make a new link** gives a different address.
  - The browser fixture now keeps links, as the server does.
- **Migration:** none; existing records are read as before. **Rollback to 1.124.9:** links made on 1.124.10 keep working
  (their hash is unchanged); 1.124.9 ignores the sealed field and shows them as it did before.

## [1.124.9] — 2026-11-24 · build 231

Settings, reorganized, and one place to choose the agent, model and effort. People found Settings hard to follow:
220 controls, 41 of them without an explanation, two sections of six and seven phone screens, a feature's settings
spread across several sections, and section names that changed between modes. This release moves things and rewrites
their text. Nothing is removed, no default changes, and every saved value, env preset and storage key stays as it was.
The owner approved the plan, which was built from a full inventory of the controls, before the build.

- **Ten pages, the same in both modes.** The pages are Display, Conversations, Notifications, Voice (beta), Accounts & sign-in, Agents
  (Developer mode only), Features, Unattended work, Usage, and Help & updates. Assistant mode shows fewer rows. It drops a page only
  when every row on it is hidden, and it no longer renames pages ("Accounts" and "Features" were Assistant-only names).
  `organizeSettings` in `public/workspace.js` builds them from one list. Old category names still open the page that took
  over their rows (`appearance`, `conversation`, `libraries`, `automation`), so links and `settingsSheet({category})`
  calls keep working.
- **Layout heads the index.** The Developer or Assistant mode switch moved out of Appearance because it decides which
  settings appear at all. **Search settings** sits above it: typing lists matching settings from every page, and picking
  one opens its page, scrolls to the setting and outlines it for a moment.
- **Every switch is in Features, with › to the feature's own page.** The switches are Projects, Files, Tasks, Inbox Watch, Vault,
  Check-backs, Job keys, Coordination (Developer mode) and Automatic model choice. Each feature's own page holds its settings, for example
  the Check-backs limits, the Job keys list and requests, the Vault's Agent access and protection, Files' keep and open choices,
  and the "show in Tasks" switches on Tasks. Inbox Watch's › opens its existing sheet. A › whose page has nothing to show in
  the current mode is hidden. A locked Assistant Pocket lists only Check-backs and Job keys under its line saying what is
  on.
- **Automation is now Unattended work.** It holds Pause all and the limits. The reply history and *Limits reached today* moved to
  **Usage**, beside plan usage and a link to Inbox Watch's cost. Check-backs and Job keys moved to their Features pages.
  The More menu reads **Unattended work settings**.
- **The scope is said one way everywhere.** **This device only** or **All your devices**. A page with both shows the device group first.
- **Every setting says what it is for.** Most labels and explanations were rewritten: labels that name the thing (*Short titles*,
  *Catch-up summary*, *Models offered in the picker*, *Long conversations and helpers*, *Sign in with Cloudflare Access*,
  *Application audience (AUD) tag*), a sentence for each of the 41 that had none, units written out, and the
  jargon explained (plan ceiling, re-arm, chain limit, audience tag).
- **Four wrong or missing explanations fixed.**
  1. *Actions that run without asking* said Codex was not covered. Codex, OpenRouter and Antigravity have used the command rules since 1.87.
  2. *Push to this device* named three of its five kinds.
  3. *Sync names with code-server* described the sync even while it was off.
  4. *Automatic model choice* did not say it works only in Assistant mode.
- **Agent, model and effort: one chip, one panel.** The message box had a model chip and an effort chip, and New conversation
  had a separate agent list. Now one chip shows the choice (for example *Claude Code · Opus 5.5 · High*), and tapping it opens
  one panel:
  - **Recent** shows your last three combinations, and one tap applies one.
  - **Agent** appears on New conversation only. A conversation that has started says which agent it runs on.
  - **Effort** offers the levels the chosen model supports, or says that model has none.
  - **Model** lists the models offered.
  - `/model` and `/effort` open the same panel, and `/effort` focuses the effort row.
  - Switching agents restores that agent's last model and effort. An agent you have never used keeps the current effort.
  - The panel is `modelPanel` in `public/app.js`, and the picks it remembers are `rememberPick`.
- **Accessibility.**
  - The Check-backs and Job keys pages no longer have two regions with the same name.
  - Number fields under Unattended work are 44 px tall.
  - The Features list's › buttons are 48 px and named for their feature (*Check-backs settings*).
- **Docs.**
  - Every manual page that names a Settings path is updated. `docs/manual/settings.md` is rewritten page by page and has a *Where things moved in 1.124.9* table.
  - The new `docs/manual/features.md` is a feature reference: every feature, how it works, where it is controlled, the env vars and a glossary.
  - The off-state messages from the server, the `pocket-*` commands and the skills now say *Settings → Features*.
- **Tests.**
  - The browser suites open a Settings page the way a person does, with the new helpers `openSettingsPage` and `showSetting` in `test/ui-controls.mjs`.
  - `test/ui-regressions.mjs` has a `POCKET_KEEP_GOING=1` mode that logs a failing check and runs the rest.
  - *1.19 Reading measure* now waits for the prose as well as the table. The history can be drawn twice, and the check sometimes measured the empty first draw. This also failed on 1.124.8.
- **Design checks.**
  - The design detector ran on the rendered Settings pages. It found nothing new: its six findings are older styles that apply to the whole app (the ember, the dark-page glow, 1.23 line height on small text, the number field's box from 1.117).
  - The layout sweep ran on all 93 Settings surfaces at phone and desktop sizes, in light and dark.
- **Migration:** none. **Rollback to 1.124.8:** nothing to undo. Settings are stored under the same keys.

## [1.124.8] — 2026-11-24 · build 230

The owner's answers to the seven questions the bug review (1.124.4) and the UI/UX test (1.124.5) left open. Four change
something; three keep the behaviour as built, with the reasons recorded in `docs/bug-review-decisions.md`.

- **X on a New pane keeps what you typed.** Closing an unstarted New conversation pane in split view threw away its
  draft, attachments and choices without asking. Now X moves them to New conversation in the main window and the toast's
  **Open** shows them (`closePaneFromX` in `public/split.js`). If New conversation already holds a different draft, one
  would overwrite the other, so Pocket asks: **Keep the pane open** or **Discard it and close**. A pane with nothing
  typed closes as before. `closePane`, used by the programmatic closes, still discards, and now also drops the pane's
  briefing key, which it used to leave behind.
- **Assistant mode's home list uses the app's status colours.** A running conversation's dot was green and a ready one
  clay, the reverse of the list row, the tab mark and the header. Running is clay and ready green now.
- **After a Vault fill, the browser's cookies and storage are not read.** The relay refuses `browser_storage_state`,
  `browser_cookie_list`, `browser_cookie_get`, `browser_localstorage_list`, `browser_localstorage_get`,
  `browser_sessionstorage_list` and `browser_sessionstorage_get` once a value has been typed, plus any tool named in
  the new `POCKET_VAULT_STORAGE_TOOLS`. They never held the typed value, which the relay scrubs, but after a login they
  hold the session it opened, and a session cookie signs anyone in until it expires. Setting or clearing storage still
  works.
- **The usage-limit notification says when a restart would cancel the continuation.** When the retry's marker could not
  be written (1.124.4 only logged it), the push now ends *Pocket could not save this, so a restart before then cancels
  it; send a message to carry on*, for an armed retry and for a held one that Resume would re-arm.
- **Kept as built, by the owner's answer:** unattended starts still run, with the warning, when the day's counts cannot
  be saved; an update still restarts when `/api/health` does not answer three tries; a fill still waits up to 30 s for
  a picture sent before it.
- **Tests:** `test/ui-regressions.mjs` *New beside (1.124.8)* (X moves the draft and Open shows it; X asks when New
  holds another draft, Keep loses neither, Discard drops the pane's keys); `test/ui-test-fixes-browser.mjs` *Assistant
  home* (the dot colours); `test/mcp-proxy.test.mjs` (the seven reads refused after a fill);
  `test/claude-limit.test.mjs` (the push wording, saved and unsaved, armed and held).
- **Migration:** none. **Rollback to 1.124.7:** nothing to undo.

## [1.124.7] — 2026-11-23 · build 229

One fix, found by a test that failed once in CI, and a longer wait in one browser test.

- **The vault's file check closes its files before it returns.** `pinCommand` (the check of what a vault command will
  run, made before a run is claimed) started closing the files it had opened and returned without waiting. A file
  handle closes on Node's thread pool, so when the pool was busy, as on a loaded CI runner, the check came back while
  its files were still open. Measured: 1 run in 2,000 on an idle machine, every run with the thread pool busy. The
  files were read-only and closed a moment later, so nothing was exposed; the fault was that the check did not keep
  its own promise. A run plan now also has `closed()`, which settles when every close it started is done;
  `pinCommand` waits for it. `close()` itself is unchanged and still returns at once, so the server's run path is as
  before.
- **Tests:** the contract test `pinCommand does not resolve while its file handles are still open` now keeps the
  thread pool busy while it checks five runs, so it fails every time on 1.124.6 instead of once in a while.
  CI on this release also hit an unrelated intermittent failure in the Inbox news browser test: "Continue the
  conversation" sends the news once the conversation is open and its news has loaded (the app allows 20 s), and the
  test waited only 4 s; on a slow runner it gave up just before. That step now waits up to 15 s. Test change only.
- **Migration:** none. **Rollback to 1.124.6:** nothing to undo.

## [1.124.6] — 2026-11-23 · build 228

One fix, contributed in #293.

- **A shared video plays when opened by its own address.** A video opened on a share link (`/share/<token>`), a public
  address (`/files/<name>`) or **Open in your viewer** showed a grey player that never loaded. A browser shows such a file
  in a media document whose player loads the same address again as media, and the policy Pocket sends with every file
  that is not HTML (`default-src 'none'`) blocked that load. A response whose type is `video/*` or `audio/*` now also
  carries `media-src 'self'`; `.mp4` is the only such type Files accepts today. Every other kind of file gets exactly
  the policy it had, and the video's own policy allows nothing else: no script, no image, no frame, no other origin.
- **Tests:** `test/documents.test.mjs` checks the policy on the signed-in address, a public address and a share link for
  a video, and that a file that is not media has no `media-src`; it fails on 1.124.5. Checked by hand in headless Chrome:
  with the old policy the player stays at `readyState` 0 with a policy violation, with the new one it reaches 4.
- **Migration:** none. **Rollback to 1.124.5:** nothing to undo.

## [1.124.5] — 2026-11-23 · build 227

The UI/UX test, run on the code as the bug review left it (1.124.4). Two passes. A **layout sweep** opened 242 screens
and states at six sizes (344, 390, 690 and 820 px touch, 1440 desktop, a 480 px split pane) in light and dark, and measured
each for sideways scroll, controls off the screen, touch targets under 44 px, cut text, covered controls, sheet insets
and WCAG 2.2 AA. Then **56 fragile flows**, chosen from the two reviews before it, were driven against a real server
with stand-in agents: two devices on one conversation, restarts mid-reply, Pause all, usage limits, updates, Vault
fills, voice, split view, a sign-in that runs out. **74 findings: 3 high, 22 medium, 49 low.** 70 are fixed, each with
a check that failed before it; what was left, and why, is at the end. The design was held to `DESIGN.md` as written:
no redesign, no new tokens.

**Conversation**
- **A message the server did not start says so** (high). A 503 `not_started` (a full disk, a missing folder) read
  *Delivery not confirmed* in a chat and *Start request not yet confirmed* on New, and the server's reason was
  dropped. Both read **Not sent:** with the reason. **Discard retry** is **Discard message**, which is what it does.
- **The sign-in box is drawn like the app** (high): it had no styling and no label. A wrong password is announced on
  the field.
- **A sign-in that runs out under an open sheet covers the sheet** (medium). The sign-in was drawn into the inert page
  under the sheet, where it could not be reached, and closing the sheet lost the edit. It now covers the sheet
  (**Sign in again**) and gives it back, with what was typed, after Unlock. No bare *login* toast.
- **A reply started somewhere else shows on a page that has the conversation open** (medium): Working, Stop and its
  question appear within a few seconds, on every agent. The question banner said *0 questions*.
- **Words typed while a message is sending are kept** (medium), and survive a failed send. The box was locked and the
  keys were dropped.
- **One conversation in two windows has one draft.** Each window overwrote the other's text when it was drawn again,
  and a send on its way from the other window read *Delivery was not confirmed* with Retry. The box follows the shared
  draft, and the other window says **Sending from another window…**.
- **A reply with choices never shows a Complete card as well**, whichever part of the text each is in; a done block
  above a question is dropped instead of shown as code.
- **Report tables keep their columns on a phone** (medium): the last column was squeezed to a character per line.
- **A code block keeps its first line clear of Copy**, and a reply that opens with code keeps its two copy buttons
  apart.
- **On a 344 px phone** the header keeps the state word whole and the counts readable, and New keeps Start on the icon
  row. **Running is clay in the header**, as everywhere else. Open tabs shorten with an ellipsis, a narrow main column
  in split view gets the two-row composer, and a dock tab never breaks inside its pill.

**Usage limits, Pause all and the queue**
- **A usage-limit wait with messages queued reads Waiting for usage reset** (medium), with its time, not *Queue
  paused*. The queue sheet says the queue follows the retry, and **Run next instruction** is not offered (or
  accepted) into the limit.
- **Pause all leaves a background agent that is waiting for permission alone** when *stop background jobs* is off
  (medium). Its waiting request was counted as a reply and killed. With the switch on it is a background job, and the
  conversation reads Stopped.
- **Resume starts a reply a restart left held in the queue** (a check-back's among them), through the same gate as
  at start-up. A check-back whose reply the owner starts by hand is settled by that reply, not as *Pocket lost track
  of its reply*.
- The toast after Pause all names Inbox Watch when it paused it, as the confirmation did. Resume resumes Inbox Watch
  when the only change while paused was an agent's.
- **Pushes.** A Claude reply's push is titled as the list titles the conversation (a job's name, not its opening
  `[cron:…]` line). A push body heavy in quotes, backslashes or control characters is cut to what fits, not to *…*.
- The mirror of a conversation in a folder made after Pocket started shows its writes at once; it missed those of
  its first minute.

**Voice**
- **Mute closes a hands-free microphone** (medium), in this tab and in every other Pocket tab. A mute from another tab
  did not reach a tab that was speaking, which then opened its microphone while muted.
- **A tap on the mic finishes a recording** (medium). *Tap the mic when you're done* worked only from the keyboard.
- Cancel in the voice strip returns the focus.

**The conversation list**
- **Undo after Mark all reviewed** keeps the keyboard focus, and a list the server answered before the Undo that
  arrives after it no longer hides the rows again.
- The bell says whether notifications are on. The All filter and the waiting banner's buttons are full-size targets
  on touch.

**Projects, Tasks, Files, Vault and Coordination**
- **Edit project and Edit task: a second Save no longer undoes the other side's change** (high, medium). After *This
  project changed*, the sheet stays open, takes the new values for fields the owner had not touched, keeps the owner's
  edits, and says which is which, in the sheet and not also in a toast. A refused value is named in the sheet and its
  field marked.
- **A second step entered before the first is saved is added**, not refused as a change from elsewhere.
- **A list that could not be read says so.** A `documents.json`, `projects.json`, `tasks.json` or `coordination.json`
  that does not parse is kept aside and the list starts empty (1.124.2); only the log said so. Its screen now names
  what was reset and the kept copy, until Dismiss. Nothing is restored automatically.
- **Coordination: a wake that cannot start does not keep the name.** A waiter woken while Pocket was paused held the
  name from the next in line for 10 minutes, with nothing on screen. The next waiter is offered it, and a free name
  that has a line or a recent offer is shown (`pocket-coord list` too).
- **Vault: Links sent says who made a link** (an agent, in which conversation, or a terminal) and which link it is
  when it was replaced; the push for a filled link says who asked. The Vault request push and the Ready push for an
  OpenRouter or Antigravity conversation use the conversation's title, not *An agent* and *OpenRouter conversation*.
- **Files: Allow on a share request already answered elsewhere** says what that answer did, not an error.
- Focus stays where the owner was after a change in the Share sheet and after Release. Reminder quick picks never
  offer the same time twice. Coordination's empty line is inset, a due step's reminder is amber, one rule before a
  folded group, text links are full-size targets, and Vault hints name the real Settings page.

**Browser relay** (`scripts/pocket-mcp-proxy.mjs`)
- **After a Vault fill, the tools that capture the page another way are refused too** (medium):
  `browser_run_code_unsafe`, video, tracing and `browser_annotate`, as screenshots and PDFs are. `browser_evaluate` and
  text snapshots still run.

**Settings, Updates and Inbox**
- **Update: a message sent while Pocket restarts is refused and kept**, for up to 90 seconds from the moment the
  restart is announced, so the restart cannot cut its reply short. **A side chat that is
  answering counts as a running reply**, so Update waits for it instead of cutting it.
- **An update that stopped after it began installing says what to run** (`npm ci` in the checkout) before the next
  restart. **No Update button without `flock` or GNU tar** on Pocket's PATH (a stock Mac), with what to install.
- A failed update no longer puts *The update did not finish.* in front of the server's own reason. A hidden chip is
  hidden (*Retry name-sync setting* showed all the time). Settings in a split pane says where Automation is.
- **Inbox:** focus goes to the next entry after Dismiss, Resolved or Not useful; a conversation opened while another
  one's news is loading asks for its own at once (it waited up to 30 s); times read PM; item buttons are 44 px on
  touch. A decision changed again in the same second is stamped after
  the one it replaces, so the watcher's acknowledgement of the first cannot settle the second. A finished **Check now**
  whose report was lost to a restart is reported again within a minute, not left showing *Checking*.
- Sheet help lines, scope labels and the Accounts body start at the heading's edge. The notification email box names
  a wrong address under the field. Resume on the home list keeps the focus; Assistant mode's chat header no longer
  starts with a stray separator.

**Loading**
- **The app's scripts, styles and page are sent gzipped**: 413 KB on the wire instead of 1.35 MB, and the first screen
  in 0.9 s instead of 1.7 s on a throttled phone profile, where no proxy compresses for it.

**Tests and tools**
- **The layout sweep is in the repository**: `POCKET_SWEEP=<area|all> node test/browser.mjs` opens every surface in
  `test/sweep/` at each layout and theme, takes a picture and reports what it measured.
- Tests that picked a random port in the suite's fixed range take a free one from the system.
- The fix checks run against the fixture as it starts, also in the full browser run. Older checks that pinned something
  a fix changed on purpose now check what the fix does: the reminder picks on a Monday, the refused-Save note, the
  Inbox news time, and the check-back card after the page reads the conversation again.
- `DESIGN.md` has a section on what this pass settled.

**Left as built**
- The / picker does not take `role="combobox"`: ARIA does not allow it on a multi-line text box.
- On a 344 px phone the side-chat icon stays in the header, and on a desktop the rail's Hidden filter still wraps.
- A pane closed with X drops its unsent New text without asking, and Assistant mode's home list draws a running
  conversation green and a ready one clay, the reverse of the rest of the app. Both are the owner's to choose.
- Corner radii and font sizes have drifted between the tokens across the app. They are listed in `DESIGN.md`.

## [1.124.4] — 2026-11-23 · build 226

The bug review of the risky files, run on the code as the whole-code review left it (1.124.3). Seven blind runs: one
agent wrote a behaviour spec from the source without seeing its tests, an agent from another lab wrote tests from the
spec without seeing the source, every step that writes state or starts a process was failed in turn, and a verifier
with the source ruled on each failing test. 654 tests, 69 failures, **29 real faults: 5 medium, 24 low, none high**.
Each fix has a test that failed before it. The passing contracts are kept as `test/*-contract-blind.test.mjs`; the
rulings that changed nothing are in `docs/bug-review-decisions.md`, with four questions left for the owner.

**Vault: what Always allow trusts** (`vault-pin.mjs`)
- **A `#!/usr/bin/env -S …` line is not offered Always allow** (medium). Linux hands `env` the rest of the line as one
  word and `-S` splits it, `PATH=` and all, so the program it started was found on a `PATH` the script chose and was
  not in the pin. `--split-string` and its prefixes count too, and **an interpreter that is itself a script has its
  own `#!` line pinned**.
- **`scp`, `sftp` and `rsync` with a local helper are refused in every spelling** (medium): `scp -S./h`, `-qS./h`,
  `-D`, a `ProxyCommand`-style `-o`, `sftp -b` (a batch file runs local commands) and `rsync -ave./h`. Only the
  separate-word `-S` and `-e` were refused.
- **The private copy of a script is removed in two steps**, so a failed removal of the file still removes its folder,
  and a failure on only the empty folder no longer fails the run.

**Browser relay** (`scripts/pocket-mcp-proxy.mjs`)
- **A picture cannot be taken across a fill.** A screenshot, a PDF or a call that names a `filename`, sent while a
  fill waits, is held until the fill settles (then refused if a value was typed); a fill waits up to 30 seconds
  (`POCKET_VAULT_PICTURE_WAIT`) for one sent before it to answer, and is refused with nothing typed if it still runs.
  The browser tool runs calls side by side, so the saved picture could hold the value.
- **A server that closes its input is stopped and the relay exits non-zero**, with a tool error for the fill being
  written. The write failed with no listener: the relay crashed and left the browser tool running.

**Approvals** (`approvals.mjs`)
- **A record the disk cut short is not a record.** A full disk makes the write return a short count, not an error;
  the Allow was sent with half a line in the audit. The file goes back to its size, the owner gets the existing 503
  *Nothing was approved*, and a trusted action shows a card instead.
- **A trusted action's Allow that could not be delivered is logged on Codex and OpenRouter too**, as on Claude.
- **Claude's session marker is written whole when a card appears or is answered** (temporary file, then rename). It was
  rewritten in place, so a restart in that instant met an empty marker; the combined test run caught a reader doing so.

**Automation** (`automation.mjs`)
- **Counts that cannot be saved are flagged.** The day's unattended replies and OpenRouter spend stayed in memory
  only, silently, so a restart forgot them and the daily limits could be passed. Settings → Automation now warns, and
  the log has one line when saving fails and one when it works again.
- **A damaged `automation-state.json` is kept aside** (`.corrupt-<UTC time>`) and logged, not reset and overwritten.
- **A torn audit line no longer swallows the next one**, and **an audit line that cannot be written is logged**, at
  most once a minute, never with its contents (job and check-back audit lines included).

**Job keys and check-backs** (`job-keys.mjs`, `checkbacks.mjs`, their routes)
- **A `job-keys.json` that does not parse is kept aside and logged** (medium). It was read as no keys, and the next
  save replaced the only copy.
- **A key whose file's path could not be saved is undone with its file**, and the answer says what is left if the
  rollback fails too; **an Allow whose key or request could not be saved is undone** and can be pressed again.
- **A Rotate cut off before the key file was rewritten is repaired by the next Rotate** (the key remembers what it
  last wrote there, `fileHash`); the file was left holding a dead key for good.
- **A job run whose reply started is answered as started when saving it fails**, so a retry with the same
  idempotency key is a repeat, not a second reply.
- **An agent's check-back is saved with its title in one save**; a failed second save answered 503 for a check-back
  that was set, and the agent set another.

**Self-update** (`self-update.mjs`, `scripts/pocket-self-update.sh`)
- **An update that could not start says so**: at once when the log or the script cannot be opened, and within two
  minutes when the script died before its first step. It read *preparing* and refused every press for 20 minutes.
- **A progress write that fails stops the update before the checkout moves**, puts the running version back after
  it, and a result that cannot be recorded is tried twice and then logged with a non-zero exit.
- **A listing of the private files that fails stops the backup**; it gave an empty archive that passed for one.
- **One more check for running replies right before the restart**, and the health probe is tried three times before
  the count is taken as unknown (then the restart goes ahead, with a line in the log).

**Codex sessions** (`codex.mjs`)
- **A keeper process that cannot start no longer takes the daemon down** (medium; the same for Claude's keeper), and a
  start that fails half-way leaves no app-server and no open pipe.
- **A session or a reply Pocket could not record on disk is not started** (medium). The process outlived a restart
  unmanaged and held the thread, so every later message was refused as open elsewhere. The message routes answer
  503 `not_started`, so *Retry same message* sends it once the cause is gone.
- **A stopped reply whose interrupt was answered but never ended is closed after 20 seconds**
  (`POCKET_CODEX_STOP_GRACE_MS`); it stayed busy until the 30-minute stall check.
- **A character cut by a read arrives whole**, **`codex-usage-state.json` drops a thread's record after 30 days**, and
  **a reply the agent started keeps that mark, and its origin, across a restart**.
- A usage-limit retry whose marker could not be written is said in the log.

- Manual: Automation, Settings, Vault, For agents; `SECURITY.md`; the operations guide; the README's settings table.
- Tested: the seven contracts (`test/vault-pin-contract-blind.test.mjs`, `approvals-contract-blind`,
  `automation-contract-blind`, `jobs-contract-blind`, `mcp-proxy-contract-blind`, `self-update-contract-blind`,
  `codex-contract-blind`, with `test/bugreview-faults.mjs`), and `test/vault-pin.test.mjs`,
  `test/vault-pin-followups.test.mjs`, `test/vault.test.mjs`, `test/approvals.test.mjs`, `test/automation.test.mjs`,
  `test/pause-routes.test.mjs`, `test/job-keys.test.mjs`, `test/job-routes.test.mjs`, `test/job-propose.test.mjs`,
  `test/checkback-routes.test.mjs` (with `test/store-fault.mjs`), `test/mcp-proxy.test.mjs`,
  `test/self-update.test.mjs`, `test/codex-reader.test.mjs`, `test/codex-session.test.mjs`,
  `test/claude-limit.test.mjs`. Mutation checks (ten planted bugs per run): 10/10 on three runs; of the 16 misses on
  the other four, 13 got a test, two were already caught by an older test file and one no test can see. The Vault test files remove the temporary folders
  they make (one test had left a `pocket-vault-*` folder in `/tmp` on every run).

## [1.124.3] — 2026-11-23 · build 225

The third and last batch from the whole-code review at 1.123.1: the 26 findings graded low, plus 11 faults of the same
kind found next to them. Each has a test that failed before the fix. Six low findings whose trigger the second
reviewer could not establish stay open, listed in `docs/bug-review-decisions.md` with what the fixers noticed and left.

**Replies, queue and streams**
- **A character cut by a read in mid-write arrives whole.** The runner log, the live mirror and the older turn log are
  split on the newline byte before they are decoded, and the partial last line is kept as bytes. A long line caught
  mid-write used to turn one accented, CJK or emoji character into `U+FFFD` and shift the reconnect offsets.
- **A message sent just after the CLI wrote its result starts the next reply as yours.** The log is read before the
  steer decision (it is otherwise read every 300 ms); the message used to be written to a CLI whose turn had ended and
  ran as a reply the agent started, stopped at once while paused.
- **A queued start refused as busy, or during a Claude sign-in, goes back to pending** and runs after the reply. It read
  *Start was not confirmed* and held the queue, though nothing had been sent; the queue's Start now answers 409.
- **A start that never reached the CLI keeps no delivery receipt** (503 `not_started`: the output files, the pipe or the
  marker could not be made), so *Retry same message* sends it once the cause is gone, not the kept failure for a week.
- **The live mirror of a conversation driven elsewhere no longer drops a write that lands while it is reading.**
- **`owned-transcripts.json` is written whole (temporary file, then rename)**, so a crash mid-write no longer loses
  every conversation's fork-guard offset.
- **An OpenRouter or Antigravity reply that fails at once is not left marked as running** across a restart.
- **Watch-mode streams leak nothing when the client leaves during set-up**, or when the transcript is gone by then.
- **A Codex reconnect that carries a turn's event number after the reply ended is told the turn is over** (it was read
  as an item id, and the browser kept waiting).
- **Side chats: an error result that arrives as a task notification ends the answer as an error.**
- **`usage-state.json` drops a conversation's record 30 days after its last reply** and writes a reply's per-line
  updates together (2 s), not once per line; the file had grown with every conversation ever run.

**Unattended work and notifications**
- **A check-back that is starting holds its place in the day's count**, so a job call arriving in between is refused at
  the daily limit instead of passing it.
- **A push is cut to fit.** The body is shortened by bytes at a character (ending `…`) when the payload would pass the
  push services' 4 KB; 2,000 CJK characters or emoji were sent whole and the device got nothing. Only pushes the
  service accepted are counted, and any other failure than a dead subscription is logged.

**Stores and settings**
- **`inbox.json`, `starts.json`, `checkbacks.json`, `pocket-settings.json` and `session-meta.json` that do not parse are
  kept aside** as `<name>.corrupt-<UTC time>` and logged (`store-file.mjs`, as the four stores in 1.124.2), not read as
  empty and overwritten. `mutes.json` and `push-subs.json` (arrays) are not covered yet.
- **A new automatic-model key sent with a settings change that cannot be saved is not kept either**; it was written, or
  the old one removed, before the save.

**Vault**
- **Opening or posting to an intake address is not Vault use.** Anyone can request `/intake/<anything>`, and each
  request pushed back a passphrase Vault's idle lock.
- **The CLI can replace or cancel only links it made, and an agent only its own conversation's.** A new link hands its
  token to the caller, so an agent could relink the owner's link and fill the reserved name itself (403 `owner_only`).
- **After a fill, the browser relay refuses any tool call that names a `filename`** (a snapshot, console messages,
  network requests saved to disk), as it refuses pictures since 1.124.2.

**Self-update**
- **The restart waits for running replies**, up to 10 minutes (`/api/health` now carries `busy`); if they keep running,
  the version that is running is put back and the job says so. The check used to be made only at the button press.
- **A long quiet step no longer reads as interrupted.** The script touches its lock file every minute and the daemon
  counts that, so a second press during a long backup or `npm ci` is refused instead of starting a second update.
- **macOS:** the tools are checked before the lock (no `flock` used to read *Another Pocket Code update is running*),
  and the backup uses `gtar` when it is there and otherwise says GNU tar is needed.
- **When the new version does not start and putting the old one back fails too, the job says Pocket may not be
  running** and how to recover, not *Pocket went back*.

**Inbox Watch**
- **An ack names the decision it applied (`<id>@<at>`)**, so a decision the owner changes while a check applies
  feedback stays for the next check. A plain id still acks whatever is current.
- **`merge --session` goes into the open entry the conversation is on**, not a newer closed one that it then refused.
- **The runner's 30-minute limit stops the check's whole process group**, so a judge or connector read it started
  does not run on unwatched.
- **After more than 3 days without a check, `monitor.log` says which days of mail were not checked.**
- **A dry run leaves an unsent alert for the next real check** (it marked it `dry-run`, and no check sent it).
- **An alert Pocket refused while Telegram or email took it is tried again to Pocket alone** (new `alerts.missed`),
  within the same five tries and 20 hours; **a look-ahead Pocket could not take is tried again** too.

**App**
- **A New pane has its own start**, so a project started in the main window is not shown or used beside, and
  **closing the main conversation never overwrites the main window's unsent New**: when both hold something
  different, main shows its own and the pane stays beside.
- **A job key's Recent runs stays the newest 20 while the sheet is open, and a run becomes a link once its conversation
  is recorded.**
- **Updates sheet: Update and the older conversations stay on screen after Check now or Upgrade.**
- **Projects: a reminder or a step edit refused after a change elsewhere stays in its sheet** with what was typed.

- Manual: Automation, Conversations, Desktop and phone, Inbox Watch, Vault, Settings, For agents; `SECURITY.md`; the
  operations guide; the `pocket-inbox` and `pocket-vault` skills.
- Tested: `test/review-fixes.test.mjs` (with `test/sse-probe.mjs`), `test/delivery.test.mjs`,
  `test/pause-routes.test.mjs`, `test/acp-http.test.mjs`, `test/sidechat.test.mjs`, `test/codex-session.test.mjs`,
  `test/notify-api.test.mjs`, `test/usage.test.mjs`, `test/checkback-routes.test.mjs`, `test/checkbacks.test.mjs`,
  `test/starts.test.mjs`, `test/settings-router-access.test.mjs`, `test/inbox.test.mjs`, `test/inbox-runner.test.mjs`,
  `test/vault-intake.test.mjs`, `test/mcp-proxy.test.mjs`, `test/self-update.test.mjs`, `test/hardening.test.mjs`,
  `inbox-watch/tests/test_connector.py`, `test_delivery.py`, `test_process.py`; in the browser,
  `test/ui-regressions.mjs`, `test/jobkeys-browser.mjs`, `test/cli-updates-browser.mjs`. Test fixes:
  `test/job-routes.test.mjs` read a field that does not exist (its limit was always 1), the CLI-updates fixture
  answered every POST with the GET's shape, and the self-update tests left their stand-in Pocket running.
  The macOS paths are tested with stand-in tools on Linux; no Mac was used.

## [1.124.2] — 2026-11-23 · build 224

The second batch from the whole-code review at 1.123.1: the findings graded medium (1.124.1 took the highs), plus
faults of the same kind found next to them while fixing. Each has a test that failed before the fix.

**OpenRouter and Antigravity sessions** (`acp.mjs`; what Codex already did)
- **Stop always ends the reply.** Stop, Pause all, the stall watchdog and the longest-reply limit send the cancel,
  answer every waiting approval with ACP's `cancelled` outcome, and close the process if the agent has not ended the
  reply in 20 s (`POCKET_ACP_STOP_GRACE_MS`). An agent that ignored the cancel used to run on to its one-hour timeout.
- **A process that dies between replies is dropped**, and the next message opens a new one. It stayed registered, and
  every later message failed with *acp client closed*.
- **`AcpClient.close()` rejects its waiting requests**, so Stop-and-close ends the reply at once, as stopped.
- **Two starts arriving together open one process.** The second waits for the first's process and is then told the
  conversation is busy; before, both ran a prompt on one session and the first could not be stopped.
- **Antigravity: an approval or a question after a background command waits for you**, past the settle timers.

**Unattended work**
- **A reply the agent starts by itself after a job's or a check-back's reply is that work carried on.** The
  conversation keeps the root of its last start (`lastRoot`) until any other start, your own message first; a reply
  the CLI begins by itself there carries it, counts toward the day, has the longest-reply limit, and is stopped as it
  begins when the gate would have refused it. A coordination wait set with no reply running wakes as that work, in
  its mode. Such a reply never settles the job's run or the check-back's card.
- **Paused: the CLI token can't set a paused Inbox Watch running again** (`POST /api/inbox/watch` answers 409
  `paused`); a change that keeps it paused, and any change of yours, goes through.
- **Paused: your message steered into a background agent's stand-in turn is your reply**, not stopped as the agent's.
- **A conversation record that can't be saved no longer strands a reply.** The start goes on and the CLI's result is
  still read; one bad line no longer drops the rest of a batch of the CLI's lines.
- **Settings, the time zone and the public address roll back when they can't be saved**, and Settings and the time
  zone say so (503, plain words) instead of keeping the change in memory until the next restart loses it.
- **Side chats show a usage limit or an API error as an error**, in the CLI's words (the 1.124.1 fix, for side chats).

**Replies and streams**
- **A `choices` example mid-reply stays text** when the reply ends with another fenced block.
- **A reconnect is not replayed from the wrong place.** Watch-mode stream ids are now `w:<offset>`, apart from a
  turn's event numbers; a reconnect that carries the other kind re-reads the conversation instead of showing
  messages twice.

**Vault**
- **A request from an OpenRouter or Antigravity conversation names the conversation**, so *Allow … for this command*
  typed there answers it. It was raised as a terminal's.
- **After a fill, the browser relay refuses calls that make a picture** (`browser_take_screenshot`,
  `browser_pdf_save`, `screenshot`, and any named in `POCKET_VAULT_PICTURE_TOOLS`). Playwright MCP saves each picture
  to a file and returns its path, so withholding the inline image left the picture readable.

**Inbox Watch**
- **Your decisions on an entry the tidy pass took off are applied** (Restore, Not useful, a merge, Resolved again).
  Every later decision on such an entry was acknowledged as the tidy's own and dropped.
- **An alert Pocket could not take is tried again** at the next checks, up to five times and within 20 hours, never
  listed twice (Pocket knows it by its key).

**Stores and self-update**
- **A `projects.json`, `tasks.json`, `documents.json` or `coordination.json` that does not parse is kept aside** as
  `<name>.corrupt-<UTC time>` and logged with both paths (new `store-file.mjs`); if it can't be set aside, Pocket
  refuses to start rather than overwrite it. It used to load as empty, and the next change replaced the only copy.
- **Self-update: a backup tar gave up on is not a backup.** Exit 2 is refused, the archive must list back, and a
  failed backup is removed. When `npm ci` and putting the old packages back both fail, the job says Pocket will not
  start again until `npm ci` is run, not *Pocket stays on*.
- **Worktrees on macOS**: with no `/proc`, working folders come from `lsof`; when neither answers, the worktree stays
  in **Has work** (*Running programs could not be checked*).

**App**
- **Projects: a step or note typed while the card changed elsewhere is kept** and goes in with the current revision.
- **Edit project and Edit task: after one refused Save, the next Save goes through** (it resent the stale revision).
- **Vault: focus stays on the same control when a request card arrives or leaves**, never moving onto an answer button.
- **Voice: a second tap while the microphone is starting opens no second microphone.**
- **A first load where a script file arrives late no longer leaves a half-wired conversation.** The first view was
  drawn as soon as the server answered, which could be before the files after `app.js` (`split.js`, `voice.js`,
  `sidechat.js`, `cli-updates.js`, `tips.js`) were in; the conversation view then threw at *chooseBeside is not
  defined* and its Back button, conversation switcher and message box did nothing until a reload. Nothing is drawn now
  until the page's scripts are all in; the first request to the server is not held back. Not a review finding: it
  showed as one failed run of this release's browser suite and was then reproduced with a late `split.js`.

- Manual: Automation, Conversations, Conversation view, Inbox Watch, Vault, Coordination, Projects, Tasks, Files,
  Settings, For agents; `SECURITY.md`; operations and install guides.
- Tested: `test/acp.test.mjs`, `test/antigravity.test.mjs` (with new stand-in behaviours in `test/fake-agy.mjs`),
  `test/job-routes.test.mjs`, `test/pause-routes.test.mjs`, `test/runner.test.mjs`,
  `test/settings-router-access.test.mjs`, `test/hardening.test.mjs`, `test/sidechat.test.mjs`,
  `test/choices.test.mjs`, `test/review-fixes.test.mjs`, `test/vault.test.mjs`, `test/mcp-proxy.test.mjs`,
  `test/projects.test.mjs`, `test/tasks.test.mjs`, `test/documents.test.mjs`, `test/coordination.test.mjs`,
  `test/worktrees.test.mjs`, `test/self-update.test.mjs`, `test/ui-regressions.mjs` (browser),
  `inbox-watch/tests/test_process.py`. `test/jobrequest-live-browser.mjs` gave its expired request 8 s, not 6: the
  server's first periodic pass (5 s after it starts) could expire the request and take its card off the page just
  before the test clicked it, about one run in forty. `POCKET_UI_ONLY=1` runs the checks in
  `test/ui-regressions.mjs` alone. The Stop grace and the relay's picture refusal are proven against the
  stand-ins only; how the real agents behave after a cancel was not observed.

## [1.124.1] — 2026-11-23 · build 223

The first batch from a whole-code review at 1.123.1 (the last one was at 1.7): the five faults it graded high, and the
one medium that opens two of them. Each was reproduced by a test before it was fixed. One was also in the owner's turn
recordings: two usage limits, both announced as **Response ready**, neither picked up again.

- **A Claude usage limit is no longer read as a finished reply.** The CLI reports a limit (and any other API error) as
  a result with `subtype: success` and `is_error: true`; Pocket read only the subtype. It now reads both, so a limit
  shows **Waiting for usage reset** and the task carries on after the reset, and another API error shows **Didn't
  finish** with the error's words, starts nothing from the queue and ends a job's run as failed. The limit wording the
  CLI uses now (*You've hit your … limit · resets Nov 24, 2pm (UTC)*) is read, with its date and time zone.
- **The retry survives Pocket closing the idle process.** A retry was skipped as "continued elsewhere" whenever the
  transcript's file time moved, which the CLI's own exit bookkeeping does when Pocket closes an idle process (ten
  minutes by default, well inside any wait for a reset). It is now skipped only when another app added a user or
  assistant turn, the same test the external-activity watcher uses, and the retry's marker carries the size to compare.
- **A limit with a message queued arms the retry too**, as on Codex and OpenRouter. The queue holds through the wait
  and follows the retry's reply. Claude armed none then, which left the limit as a failed reply and the queue waiting.
  A message sent while background jobs held the earlier login is the exception, as before: it starts on the new login.
- **Pause all holds when the settings can't be saved.** With a full disk or a read-only data folder, the save threw
  after the paused flag was set and before anything was stopped: nothing was stopped, and a second press answered
  *already paused*. Pause all now stops and holds everything regardless, each step guarded on its own,
  and says *Pocket could not save this pause, so a restart of Pocket would end it* in the toast and the banner; the
  next save that works saves the pause. **Resume** saves before it lets anything go: if a saved pause can't be dropped
  it answers 503, stays paused and says so. A change in Settings → Automation that can't be saved is rolled back.
- **Inbox Watch: an alert a killed check never sent goes out at the start of the next check**, once, and later alerts
  on that story are no longer swallowed by the unsent one. Each alert's delivery is committed as it is sent.
- **Inbox Watch: connector mail counts as seen only once its thread is in the backlog**, so a check killed between
  fetching and judging leaves the mail for the next check instead of skipping it for good.
- **Inbox Watch: a check running when Pocket restarts finishes.** Its output pipe closes with the old daemon, and the
  next log line killed the run (the common way into the two faults above). The watcher now turns its output away from
  the dead pipe and keeps logging to `monitor.log`.
- Manual: Automation › Pause all (if the pause or Resume can't be saved) and the `limit` outcome; Conversations
  (usage-limit retry and the queue); Inbox Watch (seen mail, unsent alerts, a check across a restart).
- Tested: new `test/claude-limit.test.mjs` (the real result shapes and wordings; a limit with and without a queue; a
  500; a job's run; end to end across the idle close); `test/job-settle.test.mjs` (the skip test now adds a real turn
  from another app; a job's retry across the idle close); `test/pause-routes.test.mjs` (`1.124.1:` pause, resume and
  settings saves that fail); `inbox-watch/tests/test_process.py`, `test_connector.py`, `test_delivery.py`.
  `test/fake-claude.mjs` now models the limit as the CLI sends it; the old fixture used a shape the CLI never produces.

## [1.124.0] — 2026-11-23 · build 222

Asked for by the owner: one place to see and manage the work that runs without them. Check-backs already had a read-only
group in Tasks (1.119); job keys were only in **Settings → Automation → Job keys**.

- **Tasks has a read-only Jobs group**, after Check-backs, while **Job keys** and the new setting **Show job keys in the
  Tasks list** (On by default, under Settings → Automation → Job keys) are on. Requests a conversation made for a key
  lead, marked *Waiting for you*; then each key with its state (**On**, **Off**, **Running**, or **Needs you** while its
  newest run waits on an approval or a question), its last run and how that run ended, and its folder. A key's row opens
  its own sheet (the Settings one); a request's row opens its card in Settings; **Open** on a key that needs you opens
  that run's conversation. Nothing in the group changes a key.
- **Server**: `GET /api/tasks` carries `jobs: { keys, requests }` for the app only (the CLI token's answer has none, as
  agents can't list keys), never the key, its hash, its key file or its instruction. A key's newest run reads
  `needs_you` as Recent runs does. New setting `jobsInTasks` in the `jobs` group (`POCKET_AUTOMATION_JOBS_IN_TASKS`).
- Manual: Tasks › Jobs in the list; Automation › Job keys and Job settings.
- Tested: `test/job-routes.test.mjs` (`1.124:`, on the real server: off, no keys, a run that needs you, a finished run, a
  key turned off, nothing secret in the answer, the CLI token, the setting) and `test/jobkeys-browser.mjs` (the group's
  rows, order after Check-backs, Open, the key sheet and request card it opens, the setting, axe).

## [1.123.1] — 2026-11-22 · build 221

Seen on the owner's install with Antigravity (agy 1.5.14, Gemini 4 Neon). A reply rendered videos with a command that
ran about four minutes, so agy moved it to the background and Pocket kept the reply open, as 1.120.0 intended. When the
render ended, the model's next step was to copy the results into a claim folder and add them to Files. Pocket marked the
reply **Response ready** nine seconds into that step; the step's command then asked for approval on a finished reply,
Pocket refused it (nobody is there to ask once a reply is over), and agy stopped. The conversation showed a reply that
said it was still working, with nothing running.

- **Why** (`acp.mjs` `armSettle`, the `usage_update` branch). After a background command, the reply ended at the first
  `usage_update` with no tool running, on the reading that it closes every model step. agy sends a step's
  `usage_update` when the model's answer is in and **before** that step's tool calls: measured live with a throwaway
  conversation on 1.5.14, `usage_update` came 2 ms before each step's `tool_call` (and after the last step's text). So a
  step that went on to run a command looked finished.
- **Now** a `usage_update` in that state starts a short grace (`POCKET_ACP_SETTLE_STEP_MS`, 5 seconds) instead of ending
  the reply. Anything else the agent sends in the grace (a tool call, text, thinking, an approval or a question) cancels
  it, and the waits from 1.120.0 apply again: two minutes of quiet with every tool finished, ten minutes of silence while
  one runs. A step with nothing after it ends the reply when the grace runs out, so a reply that waited for a background
  command shows **Response ready** about five seconds after its last words instead of at once. Replies that never ran a
  background command are unchanged, and so is OpenRouter (OpenCode does not move commands to the background).
- Tested: `test/antigravity.test.mjs`, the two `1.123.1:` cases, against a new stand-in scenario (`test/fake-agy.mjs`
  `__BGMORE__`: after the background command, the step's `usage_update`, then 30 ms later a command that asks for
  approval). Both fail on 1.123.0: the follow-up approval was refused and the last step ended at once.

## [1.123.0] — 2026-11-22 · build 220

Asked for by the owner of an install that runs its own server: the Updates sheet announced a new Pocket Code release and, when opened, offered no way to install it ("Whoever manages this server installs its updates"), while its **Upgrade selected** button, which only covers Claude Code and Codex, sat greyed out below. **An install's owner can now let Pocket install its own releases: with `POCKET_SELF_UPDATE=1` the Pocket Code row has an Update button.** Off by default, so a managed install is unchanged and only its operator updates it.

- **What the button does** (`self-update.mjs`, `scripts/pocket-self-update.sh`). The same guarded steps an operator runs over ssh: origin `github.com/<releases repo>`, checkout on `main` (fast-forwarded) or on a detached release, tracked files unchanged and `HEAD` as it was when the button was pressed, tag `v<version>` on `origin/main`, at least 5 GB free; backup of the git-ignored private files to `~/backups/pocket-code-<version>-update-<time>/`; `npm ci`; `check:release --released`; `pm2 restart <pm_id>`; then a new process must serve the release and answer `/api/health`, and still be the same healthy process 10 seconds later; `pm2 save`. A failure after the checkout moves puts the previous commit and packages back, and a version that does not come up is replaced by the previous one, restarted. The script runs detached from the daemon (`setsid -f` on Linux, so PM2 with `treekill` on does not stop it with the daemon) with only `PATH`, `HOME`, `LANG` and `PM2_HOME`: the daemon's environment holds everything from `.env`. Its lock is closed for the `pm2` calls, so a PM2 daemon the command starts cannot hold it.
- **Server** (`server.mjs`). `POST /api/cli-updates/pocket` with the announced version, behind the same sign-in and same-origin checks as the CLI routes; refused unless opted in, under PM2 and in a git checkout, while a reply (Claude, Codex or OpenRouter) or a CLI check or upgrade runs, or when the version is not the announced newer one. A CLI upgrade is refused while Pocket updates itself. `GET /api/cli-updates` adds `pocket.self` (`enabled`, `available`, `reason`, `job`). Progress is `pocket-self-update.json` in the data folder (a job silent for 20 minutes reads as interrupted), output `pocket-self-update.log`; both git-ignored.
- **Sheet** (`public/cli-updates.js`). With the setting, the row says the owner installs updates here, shows **Update to …** in place of **How to update**, confirms, then shows each step; a failed poll while Pocket restarts is not shown as an error. The reason is shown when an opted-in install cannot update itself.
- Tested: `test/self-update.test.mjs` (off by default and the reasons; refusals; the script's arguments, detachment and environment without secrets; a quiet job reads as interrupted; the script end to end against a real git origin with release tags, a stand-in PM2 and a stand-in Pocket: an update with its backup, a release that does not start rolled back, a hand-edited checkout, a moved `HEAD` and another origin refused before anything changes). `test/cli-updates-browser.mjs`: the button, the confirm, the post, restarting, done, a failure with retry, the unavailable reason, axe at 390 px. `test/data-ignored.test.mjs` lists the new files.
- Manual: *Settings* (Update from Pocket); *Operations, upgrades and recovery* (Updating from Pocket).
## [1.122.3] — 2026-11-22 · build 219

Found by a failing browser test on main. Under **Recent runs** in a Job key's sheet, two runs of one key that started in the same second were listed in a random order, so the older one could come first; the test for "newest first" failed when a run finished in under a second and the next one started in the same second. **Job keys: runs started in the same second now show newest first, in the order they started.**

- **The order** (`job-keys.mjs` `runsFor`). Start times have whole seconds, so two such runs tie, and the tie was broken by the run's random id. It is now broken by the order the runs were started, later first. The same tie-break applies when the oldest finished runs are pruned, so the run that started last is the one kept.
- Tested: `test/job-keys.test.mjs`, the `1.122.3:` case (three runs reserved in one second list newest first, also after they finish, after the store is read again from its file, and after pruning; repeated on 20 fresh stores, because run ids are random).

## [1.122.2] — 2026-11-22 · build 218

Seen on the owner's install with 1.122.0 and Claude CLI 2.1.328. A side chat opened on a long conversation that was working showed **$306 so far** after a 20-cent answer, and its first answer's note read $306.22. About 100 ms after the question, before any text, a result came in that ended the side chat's turn: the panel left *Answering…* while the answer still streamed, and a second question was taken mid-answer. **Each side chat answer now shows its own cost, the total is what the side chat spent, and the side chat stays busy until its answer's own result.** The same carried total reached the conversation itself: in about one in five conversation logs checked there, the first reply of a process reported the conversation's earlier spend with its own, hundreds of dollars for a reply of a few dollars. **The first reply of a new process on a conversation now shows its own cost too, and so does what it adds to the unattended figures.**

- **Where the figures came from**, measured with the real CLI on throwaway conversations. A fork starts its cost count at the parent transcript's last `cost-state` line (what the conversation had spent when one of its processes last exited), so `total_cost_usd` includes the conversation's spend, whether the conversation is working or idle. When the copied transcript shows a background task running, the fork reports that task stopped and, soon after it starts (in one recording before any question was sent), ends the notification's own turn: a result with `origin.kind` `task-notification`, `num_turns` 0, an empty text and the carried total, then a second `system` `init` and the answer. A fork of a conversation with no running background task has no such result. `--max-budget-usd` counts only the fork's own spend, so an expensive conversation does not use up the side chat's cap.
- **The answer's own cost** (`sidechat.mjs` `resultCost`). Each result's cost is the sum of `model_usage_since_last_result`, which the CLI reports per result (`usage.mjs` `sinceCost`, shared with the conversation). A CLI without it falls back to the difference from the last running total, with the empty result's total as the starting point; there, a carried total with no empty result before the answer is still counted in the first answer.
- **The empty result does not end the turn** (`notOurTurn`). Only that exact shape, a successful result with `origin.kind` `task-notification`, `num_turns` 0 and no text, leaves the side chat busy and sends nothing to the panel, so a panel from an earlier build shows no wrong figure either; whatever it spent is added to the answer. Any error result ends the turn, whatever its origin, so a side chat never stays on *Answering…*; so does a notification result that did work or says something (should a CLI ever answer a stale notification with text first, the panel stops waiting early, and the real answer still arrives with its own result). The close log line's `cost=` is the side chat's own spend.
- **A conversation's reply** (`server.mjs` `turnCost`). A new Claude process on an existing conversation (after an idle close or a model change, for example) resumes the transcript, and the CLI starts its running total at the last `cost-state`, as the fork does. Since 1.78.1 a reply's cost was the difference from the last total its process reported, and a new process had none, so its first reply showed the whole conversation's cost; for a reply Pocket started without the owner (a job run or a check-back) that figure also went into **Today**'s cost under *Unattended replies*, the job run's cost and the `finished` audit line. No limit holds work on a Claude reply's dollar figure (the dollar limit is OpenRouter's, which reports its own way), so nothing was held because of it. The reply's cost is now the result's `model_usage_since_last_result`; the running total is still kept in the runner marker, so a CLI without the figure gets the 1.78.1 difference as before, and a process adopted from before 1.78.1 still shows no cost when the CLI does not send the figure. Each result line goes to exactly one turn (the turn ends on its result). Not changed: if a new process resumes a transcript that shows a background task still running, the CLI's empty task-notification result can end the owner's turn early in the conversation too, and the answer then runs as a turn the agent started (for a job run or a check-back, the run then ends with no reply and the answer's cost is not in the unattended figures); skipping that result there needs more than these lines and is left for a later release. Other readers of `total_cost_usd` are one-shot `--no-session-persistence` calls with nothing to carry, and `usage.mjs` reads `modelUsage` only for the context window.
- **Git ignores the newer stores** (`.gitignore`). The default data folder is the checkout, and `automation-state.json`, `automation-audit.jsonl` (1.117), `checkbacks.json` (1.119) and `job-keys.json` (1.122) were not ignored, nor were local backups of the environment file (`.env.bak*`). A guard test lists every `path.join(DATA_DIR, …)` name in `server.mjs` and `codex.mjs`, plus the few written elsewhere, and checks `git check-ignore` takes each one.
- Tested: `test/sidechat.test.mjs`, the six `1.122.2:` cases (the fifth: only the stale task's empty result is skipped; the sixth: it can come before any question, and a skipped result's spend goes with the next answer) (a working conversation: its own cost and total, busy until the answer, a second question refused, the budget stop with no text ends the turn, the close line; an idle conversation's carried total, and an older CLI without the per-result figure; an error result from the stale task's turn ends the answer; the real CLI's lines through the parser). The stand-in CLI now starts from the parent's `cost-state` and sends the empty result when the parent shows a running background task. `test/data-ignored.test.mjs` is new. `test/runner.test.mjs`: the first reply of a new process on a conversation that carries a cost shows its own, a later one in the same process too, an older CLI as before. `test/job-routes.test.mjs`: job runs in a new process on their conversation count their own cost on the run, in Today's cost and in the audit. The stand-in CLI now starts a resumed process at the transcript's `cost-state` and sends the per-result figure (`__OLDCLI__` leaves it out).
- Manual: *Working in a conversation* (side chat cost); *Operations, upgrades and recovery* (the side chat's cap and cost figures, and the ignored data files).

## [1.122.1] — 2026-11-22 · build 217

Found rolling out 1.122.0. On the owner's install another program makes empty OpenCode sessions in one folder (two every six hours, never used; 268 of them). The per-folder read of 1.122.0 asks that folder, OpenCode answers with the newest 100, and Pocket listed each as *(untitled conversation)* and spent a title call on each, which came back as junk titles (*Untitled session with no request content*). **OpenRouter: sessions that were never used and that Pocket did not start are no longer listed.**

- **A session nobody used is left out** (`acp.mjs` `unusedSession`, `UNUSED_MS` 5 ms; `readAcpList`). OpenCode names a session *New session - <iso time>* until it titles it, and never updates an empty one. Measured read-only on a real store (523 sessions): all 469 empty ones were last updated within 1 ms of the time in their title; the 13 used sessions that kept the default title were updated at least 88 ms after it, usually seconds. A session with the default title and a last update no more than 5 ms from its time (the first message of a used session came as early as 15 ms) is dropped where the hidden folders are, so such sessions never use up Pocket's limit, and a row of the last read cannot bring one back (those rows are kept in memory only). OpenCode's own answer of 100 per folder still counts them, so an older conversation in such a folder that Pocket does not know may not be reached, as in 1.122.0. A conversation Pocket started (recorded since 1.122.0) is listed as before. A missing or unparsable time, or one without milliseconds, lists the session (fail open), and Antigravity, which has no default title, is unchanged.
- **No title call without a message** (`server.mjs` `finishTitle`). A row whose only title is the placeholder *(untitled conversation)* (an OpenRouter or Antigravity conversation the program never titled) is no longer sent to the title model; it keeps the placeholder, and a title stored from such a call is no longer shown.
- Tested: `test/acp-list.test.mjs`, the five `1.122.1:` cases (a never-used session is not listed; listed when Pocket started it; a used one with the default title is listed, at 88 ms and at seconds; 100 never-used sessions plus a real one with a limit of 60 list only the real one, also with 1.122.0's rows as the last read; a missing or unparsable time is listed) and *a listed conversation with no message to title costs no title call*. The stand-in (`test/fake-acp.mjs`) can send a session's time as given. `test/acp.test.mjs` names the effort probe's session as known, since a probe session is never prompted. Read-only against the real OpenCode: the folder of empty sessions lists none, the real conversation beside it is still listed.
- Manual: *Conversations* (the OpenRouter list, and **Generate short titles**).

## [1.122.0] — 2026-11-22 · build 216

Asked for by the owner (2026-11-22). Part 3 of three (`docs/plans/unattended-work.md`), on 1.117 (Pause all and the limits) and 1.119 (check-backs). **A script on the owner's server can start a conversation: a cron job, a pager or a monitor calls Pocket with a key and some data.** The owner makes the key with a fixed instruction, folder, agent, model and access; the script sends only data; Pocket starts a reply that follows the owner's instruction and reads the data as information, never as orders, in a conversation the owner can watch, and sends a push with the result. It is **off until the owner turns it on** in **Settings → Automation → Job keys**, and nothing changes for an install that doesn't.

- **A job key** (`job-keys.mjs`; `JobKeyStore`, the key and run formats, the message envelope and the key files). The key is `pjk_` and 43 characters from 256 random bits, shown once. Pocket keeps only its SHA-256 hash, with the key's settings and its runs, in `job-keys.json` (mode `0600`, written by tmp file and rename). A key holds a name (1 to 48 of `a` to `z`, `0` to `9`, `-` and `_`, like `disk-check`), a folder, an agent (Claude Code, Codex or OpenRouter; Antigravity is refused, because a person sends each message there), a model and effort, an access (**Ask first** or **Full access**, Full access only where the server allows it), the instruction (required), **The job may add its own instructions**, its own limits (runs per hour, per day and at once) and **Push when a job finishes**. The folder and the agent are fixed after the key's first run (409 `fixed_after_run`). A Claude key needs a model from the catalogue. Pocket can save the key to `<folder>/<name>.key` (mode `0600`, folders it creates `0700`, inside the home folder, never through a link that leads out, never over a file that isn't a job key file; rotate rewrites the file and delete removes it only while it holds that key).
- **Calling it** (`POST /api/jobs/run`, `GET /api/jobs/runs/:run`). The caller must be a direct loopback connection with none of `cf-connecting-ip`, `x-forwarded-for`, `forwarded` or `x-real-ip`, and send the key as a bearer token. Through the tunnel or a proxy: 403 `not_local`. The app's sign-in and the CLI token are refused here too (403 `job_key_only`). A wrong, malformed, disabled, rotated or deleted key gets one identical 401 (`bad_key`), except that a bearer value of 64 hex characters (the shape of the CLI token) gets 403 `job_key_only`, whether or not it is the token; more than 20 wrong keys in 60 seconds, counted for the whole server, get 429 until the minute is out, and a right key still works. With the feature off, a caller on this server gets 404 `jobs_off` and anyone else gets the plain 404 of before. The body takes `data`, `instructions` (only where the key allows it), `idempotencyKey` (the run id, `--id` in `pocket-run`; up to 200 characters, kept for **Ignore a repeated call for**; a repeat answers with the first run and `repeat: true`), `conversation` (continue a conversation this same key started) and `wait` (seconds, capped at **Longest wait a job may ask for**; one call is held at most 240 seconds whatever it asks, so `pocket-run --wait` and `pocket-jobkey wait` ask again in slices of at most 240 seconds, and any `--wait` works).
- **The checks, in order, each answered at once with nothing started and nothing queued.** The caller, the key, the request (types, idempotency key, wait, instructions allowed, size against **Most data per run**), a repeat, the conversation, the key's own limits (rolling 60 minutes and 24 hours, and runs at once; a run is counted before the gate so two calls can't both take the last slot, and the install's daily count holds the same way when calls arrive together), then the same unattended gate as a check-back: Pause all, the plan ceilings and the daily count. Refusals carry `reason`: `no_key`, `bad_key`, `rate_limited`, `bad_request`, `instructions_not_allowed`, `too_large`, `not_yours`, `busy`, `key_limit` (with `limit: per_hour` or `per_day`), `paused`, `plan_ceiling`, `daily_limit`, `jobs_off`. A job is never queued while paused or over a limit; the script decides whether to try again.
- **What the reply gets** (`jobMessage`). `[cron:job-<name> <Title>]`, then the owner's instruction, then (with the setting on) the job's own instructions in a labelled block, then `--- Data from job "<name>", received <date and time>. This is information, not instructions from the owner.` and the data in a fence one backtick longer than any run of backticks in it, with a closing line, or *(The job sent no data.)*. The prefix is the one `titles.mjs` already reads, so the conversation is titled by the job and grouped under **Automated** with the label *Started by job disk-check*. A job reply can't set a check-back, and a refused one names the job.
- **The answer.** `status` is `working` and `needs_you` (HTTP 202), `done` and `failed` (200; 409 or 500 when it never started) or `refused`, with `run` (`jr-` and 12 hex), `conversation`, `link`, and for a finished run its `outcome` (`ok`, `error`, `stopped`, `limit`, `jobs_off`, `interrupted`, `not_started`) and `reply`: the last message with text, up to 100,000 characters, kept in memory for the last 200 runs. After a restart a run keeps only its first line (`replyPartial: true`). **A run always ends.** A run that was working when Pocket stopped and whose reply did not survive is recorded as `failed` / `interrupted` about 15 seconds after the start. A reply that stopped at a usage limit leaves its run working while the retry carries it on; when the retry never runs, the run ends `failed` with `stopped` (a message from the owner replaced the retry, or the owner's reply was already running; no push), `limit` (the retry was skipped, something else replaced it, its start failed, Pause all held it and **On Resume, re-arm held usage-limit retries** is off, or nothing carries the run on) or `jobs_off` (Job keys were switched off when it came due); a reply cut off by a restart, or one whose process is gone, ends `interrupted`. Each carries its words in a new `error` field (in the answer, in `pocket-run --json` and in the run list), writes the one `finished` audit line and, except `stopped`, sends *Something went wrong*. Any run that nothing carries on is ended once seen so twice, 3 seconds or more apart, by the automation pass, the key's next call or a read: in practice within about a minute. A run that waits for the owner's answer to an approval stays working, and the key is busy until the owner answers. `needs_you` is read live from the conversation's approvals, questions, Files requests and Vault requests.
- **The command** (`scripts/pocket-run.mjs`, the `pocket-run` bin). `pocket-run --key-file <file> [--data-file <path> | --data -] [--id <idempotency key>] [--instructions-file <path>] [--conversation <id>] [--wait <s>] [--json]`, and `--run <id>` to ask about a run. `--wait` may be any number of seconds: the command asks again in slices of at most 240 seconds until the wait is used. There is no `--key` flag, because other programs can read a command line; the key comes from `--key-file` or `POCKET_JOB_KEY`. It finds Pocket from `POCKET_URL`, else `cli-url`, and works from cron's bare environment. Exit codes: 0 done (the reply on stdout), 3 needs the owner, 4 still working, 5 refused (a 401 and `jobs_off` count), 1 anything else. It never prints the key.
- **The result.** A push of the existing kind `automation`, titled with the job's name, with the reply's first line. There is none when the run was stopped, when the key's push is off, or when the conversation is muted and **Job pushes respect the conversation's mute** is on. The reply runs with the key's access; under **Ask first** each action is an approval card and the run waits, so `pocket-run` returns 3.
- **Pause all and the limits.** Pause all counts running job replies in its sheet and toast (*1 started by a job*), stops them, and holds any new call. Job replies count toward the unattended replies per day and are held by the plan ceilings.
- **Settings → Automation → Job keys** (`automation.mjs`, a new `jobs` group and a new `folder` setting type). **Job keys** (off), **Access for new keys** (Ask me for every action), **Job may add its own instructions (new keys)** (off), **Runs per hour, per key (new keys)** (6, 1 to 120 or No limit), **Runs per day, per key (new keys)** (24, 1 to 1,000 or No limit), **Runs at once, per key (new keys)** (1, 1 to 5), **Most data per run** (20,000 characters, 1,000 to 100,000), **Longest wait a job may ask for** (300 s, 30 to 900), **Ignore a repeated call for** (7 days, 1 to 30), **Push when a job finishes (new keys)** (on), **Job pushes respect the conversation's mute** (on), **Where Pocket offers to save new keys** (`~/.config/pocket/jobs/`, a folder in the home folder). Presets are `POCKET_AUTOMATION_JOBS` and its siblings (`POCKET_AUTOMATION_JOB_PER_HOUR` and so on).
- **In the app** (`public/jobs.js`, new; `public/automation.js`, `public/app.css`). Under the switch, while the feature is on, a list of keys (name, folder, agent and model, access, **On**, **Off** or **Running**, last run) and **New job key**; the New job key sheet; the key shown once in a read-only field with **Copy**, where it was saved and a ready-to-copy `pocket-run` line, emptied when the sheet closes and never kept in the page, the stores or the URL; a key's sheet with **Turn off** or **Turn on**, **Rotate key** and **Delete** (each asks first) and **Recent runs**, each opening its conversation. The lists write nothing when nothing changed.
- **The audit** (`automation-audit.jsonl`): `job` lines for `created`, `updated` (the names of the fields, never their values), `enabled`, `disabled`, `rotated`, `deleted`, `refused` and `finished` (key, run, conversation, engine, times, outcome, cost or tokens), and `job_auth` lines for a wrong or disabled key and for the rate limit. Never a key, a hash, an instruction or any data.
- **Docs.** The manual: a **Job keys** section in `docs/manual/automation.md`, and changes in Settings, For agents (what a job's message looks like and how to answer it), Approvals, Conversations, Sessions, Vault and Files. `SECURITY.md` gains **Job keys**, with the plain warnings (any program that can read a key file can start that job; text in the data can still mislead an agent); `PRODUCT.md`, `DESIGN.md` and `docs/operations.md` (the data file, the key folder, a cron line, rollback) are updated.
- **Rolling back to 1.121** stops job keys and loses nothing: 1.121 does not read `job-keys.json` or the **Job keys** settings and keeps both, so upgrading again finds them. Calls fail while rolled back, because 1.121 has no job routes and no `pocket-run`.
- **A renamed key keeps its old key file name, and nothing takes the file over.** Creating a key with a key file, **Rotate key** and **Allow** refuse a file another key records as its own (409 `file_taken`, *… is the key file of the job key "…", so Pocket won't write another key there. Choose another folder or name.*) and make nothing.
- **A run that failed to start doesn't keep its run id** (`not_started`); a run that started and then failed does, for the repeat window.
- **Tests:** `test/job-keys.test.mjs` (the store, the key and file rules, the envelope), `test/job-routes.test.mjs` (every check and refusal in order, the identical 401, the rate limit, repeats, limits, the answer for each status, Pause all, the push rules, the audit never holding a key), `test/job-settle.test.mjs` (a run always ends: a dropped or skipped retry, a restart with the runners gone or adopted again, Job keys switched off while a retry waits, the `finished` line's fields), `test/job-guards.test.mjs` (the owner's routes refuse the CLI token, the daily count under calls that arrive together, a call held at most 240 seconds and both commands waiting in slices, who may propose, a key deleted while the gate awaits), `test/job-propose.test.mjs`, `test/jobkeys-live-browser.mjs` (the real server: make a key, see it once, a real call, Turn off, Rotate, Delete, Pause all), `test/jobrequest-live-browser.mjs` (the request card: the whole instruction, Enter in each sheet, the 5-second refresh), and the existing shape checks for the new group.
- **A conversation asks for a job key; only your Allow makes it** (`job-keys.mjs` `PROPOSAL`, `server.mjs` "a conversation proposes a job key", `scripts/pocket-jobkey.mjs`, `skills/pocket-jobs/SKILL.md`). Ask a Claude Code or Codex conversation for something that runs by itself, and the agent writes the script and the instruction and runs `pocket-jobkey propose`. You get a push, *Allow a job key?*, with no buttons on it: a notification can't show the whole instruction, and an allowed key starts work without asking from then on. Under **Waiting for you** in **Settings → Automation → Job keys** a card shows everything the key would be, the whole instruction included, with **Deny**, **Edit first** (the New job key sheet, titled *Edit before you allow*) and **Allow**, in that order, after the last line of the instruction: the whole instruction shows (the block grows with it and has no scroll of its own), and Enter never allows, on the card or in a field of **Edit before you allow** (only a click or tap on **Allow with these changes** does). On Allow, Pocket makes the key and writes it to a key file in the key folder (mode `0600`); the conversation is given the file's path, never the key, and is told which fields you changed. Pocket never gives an agent a key, and its routes refuse an agent that tries to make, change, rotate, delete, list or use one or to answer a request, its own included; but a key file is a file the server's user can read, so an agent with Full access could read it and start that job (`SECURITY.md` says what follows: keep key folders out of the folders agents work in, and a job key is no stronger a boundary than the user account). An agent can't ask from a reply you didn't start (a job's reply, a check-back's, a queued message, a retry, a coordination wake), and can't ask from a conversation a job has ever run in (403 `job_conversation`). The token belongs to the conversation's process, not to one reply, so in a conversation no job ever ran in, a process an earlier reply you did not start left behind can still propose while your next reply runs; your Allow, after you read the whole instruction, is still required. Only the sign-in cookie answers, from Pocket's own page: the command token and a job key are refused. One request waits per conversation and five per install, and one expires after 24 hours. There is no setting that allows a request by itself. The push follows each device's **Vault requests** switch. OpenRouter and Antigravity conversations can't ask. A request that fails to write its key file makes nothing and stays waiting, with the reason. The audit file gains `proposed`, `proposal_allowed`, `proposal_denied`, `proposal_expired` and `proposal_refused` lines (field names only). `job-keys.json` gains `proposals`. The `pocket-jobs` skill is installed while job keys are on. `POCKET_JOB_REQUEST_TTL_MS` (tests only) shortens the 24 hours.
- **Job keys, a new layout.** **Settings → Automation → Job keys** now reads, top to bottom: the switch, **Waiting for you** (only when a request waits), your keys with **New job key**, then **Advanced**, closed, with the other eleven settings. With the switch off, only the switch shows. A count shows on the Automation entry and the group heading while a request waits, and a conversation that has asked shows *Waiting for you: job key …*. **Repeat window for an idempotency key** is now **Ignore a repeated call for**, and the manual says "run id (`--id`)" where it spoke of an idempotency key (the HTTP field is still `idempotencyKey`).
- **Fixed: OpenRouter conversations are listed again in every folder** (`acp.mjs`, `server.mjs`). OpenCode answers a list of all conversations with only the newest 100 of the folder's project, and the 100 sessions Pocket's own effort probe had left behind filled it, so no OpenRouter conversation showed in the list. Pocket now asks for each folder it knows on its own, follows the answer's pages, and lists a conversation it started from its own record if the program doesn't return it, unless the program no longer has it: a conversation OpenCode no longer has is dropped from the list when its folder answered in full (or the answer reaches back past it) or the folder is gone, and kept while its folder was not read this time. The read is bounded. The conversation list waits for it at most 2 seconds (the read goes on, and a later poll shows it); a read ends after 25 seconds, with each question limited to 10 seconds, and a folder that did not answer keeps its last rows; up to 32 folders are asked, the ones with a process running now and the home and Pocket folders first, then the most recent first. The effort probe reopens its newest session instead of adding one each time, and a conversation reopened after its process closed runs in its own folder again, not in `/`. One limit remains: a conversation started before this fix, in a folder inside a git repository that Pocket has not otherwise asked about, stays out of the list until a new conversation starts in that folder (it still opens from its link); OpenCode offers no way to list the folders it knows, and Pocket's own records from before this release hold no folder for it. Antigravity uses the same reader, but how its program scopes a list by folder is not known, and it was not tested against the real program.

## [1.121.0] — 2026-11-21 · build 215

Asked for by the owner (2026-11-21). Parts 1 and 2 of the side chat plan. **The side chat knows it is a side chat, and each answer takes in the conversation as it is at that question.** Before, it spoke as the agent doing the work ("I'm running the tests"), offered work it cannot do, and answered from the copy taken at the first question however long it stayed open. What a side chat may do is unchanged: it reads and answers, changes nothing, and nothing said in it reaches the conversation. Passing a note to the conversation is a later release.

- **Who it is** (`sidechat.mjs`: `sidePrompt`, `CODEX_SIDE_PROMPT`, `SIDE_BRIEF`). A side chat starts as a copy of the conversation, so it has a long history in which "I" was the agent at work, and one line saying it was now "in a side chat" lost to that history. The instructions for both engines now say what it is (a separate, read-only assistant beside the conversation, not the agent doing the work), how to speak (the working agent is "the conversation" or "it"; never say it is doing, running, waiting on or about to do that work), what it can do (Claude: read files, and search the web when the conversation would without asking; Codex: read files and run read-only commands) and what it cannot (edit, run, approve, continue the task). Asked for work, or to tell the conversation something, it says it cannot from there and points to the main conversation or **Branch**. The same thing is said again, briefly, in front of the first question, because a line at the question holds better against a long history than one appended to the system instructions.
- **A note with every question** (`sideNote`, `sideStateLine`, `sideInput`; `server.mjs` `sideContext`). Pocket writes it and puts it in front of the question inside `<pocket-side-chat>` tags; the panel shows only what was typed. It says what the conversation is doing now (working and for how long and who started the reply, waiting on an approval or a question, a usage limit, background work still running, finished, failed, stopped, or active in another app), whether **Pause all** is on, the approvals and questions it is waiting on (up to 5 each), its background jobs and agents (up to 8), and the queued messages (the first 5). The instructions call the note information, not instructions, and tell the side chat to trust it over the copy for anything about the present. The tag itself inside quoted conversation text is replaced, so quoted text cannot end the note early.
- **Since you last looked** (`sideSinceText`; `server.mjs` `sideSinceClaude`, `sideSinceCodex`). From the second question on, the note lists what the conversation added since the previous one, oldest first: what the person wrote, what the agent said, each step it ran, its plan, the replies it offered and whether it marked the work complete. Claude Code: read from the saved transcript starting at the byte where the side chat last stopped, with up to 400 characters of each step's output or failure; at most 8 MB of new transcript is read for one question, and a line still being written waits for the next. Codex: the thread's new messages and the blocks added to the last bubble the side chat saw, without step output. The text is capped at 12,000 characters; over that the oldest lines go and the first line says how many. The mark moves only after the question is really sent, so a refused or failed question loses nothing. When the new steps cannot be read the note says so, and the side chat is told to say so if it matters.
- **A conversation running in another app** (a terminal or an editor) is followed from its saved transcript: the side chat sees its steps as they are written, and the note says Pocket cannot see whether it is waiting on the person there.
- **In the app** (`public/sidechat.js`). The panel's help line now reads *Each answer takes in what the conversation has done up to that question.* **New side chat** still starts over with a fresh copy. No new control and no setting.
- **Manual.** `docs/manual/conversation.md`, the side chat section; the pages that mention side chat were read again against this change.
- **Tests.** `test/sidechat.test.mjs`: the instructions for both engines, the note and the since-you-last-looked text as units, and over HTTP that each question arrives behind a note with the state and the new steps while the panel shows only the typed text (`test/fake-claude.mjs` records the input). `test/branch.test.mjs`: the Codex side chat gets the brief and the note, and a second reply in the conversation shows up in the next question.
- **Checked on the real Claude Code CLI**, on a long real conversation, old instructions against new with the same two questions (*What are you doing right now?*, *OK, go ahead and finish whatever is left.*): old answered in the first person, offered to do the work and ended with a choices block; new answered about the conversation in the third person and declined the work.
- **Not yet checked on the real Codex CLI:** the instructions and the note are tested against the stand-in only.
- **Limits.** The side chat still cannot send anything to the conversation. A Codex side chat gets messages and steps but not step output. The first question's copy is the whole conversation; later questions add only what is new, trimmed to the most recent part when there is a lot.

**After you upgrade:** nothing to do. No setting, no stored data and no environment variable changes. A side chat that is open when Pocket restarts ends, as before.
## [1.120.0] — 2026-11-21 · build 214

**Antigravity, a fourth agent (opt-in).** Google's Antigravity CLI (`agy`) beside Claude Code, Codex and OpenRouter, signed in with the owner's own Google account, so replies use the Gemini models and the usage a Google AI plan includes. Off unless the server sets `POCKET_AGY_ENABLE=1` and `agy` is installed; with it off nothing changes. Asked for by the owner (2026-11-21).

**Read before turning it on.** Google's Antigravity documentation says any ACP client can launch the CLI; its plan FAQ says wrapping `agy` in a third-party app is not supported under consumer plans. Pocket is built to stay on the personal-use side of that: one person, their own server, their own account, every message sent by a person. The manual says the same, and the choice to turn it on is the owner's.

- **How it runs** (`acp.mjs`, `RUNTIMES`). Antigravity is a second runtime of the ACP engine: Pocket starts `agy acp` and speaks the Agent Client Protocol to it, the same client code that drives OpenCode. Conversation ids are `agy:` plus the CLI's session id. It shows as its own engine (`engines.mjs`, `antigravity`), so every per-engine rule applies to it by name.
- **Five rules the build keeps.** (1) ACP only: never the CLI's print mode, and Pocket never reads, copies or stores the sign-in. (2) One person, one account: no account switching. (3) Attended only (below). (4) No API billing: `GEMINI_API_KEY`, `GOOGLE_API_KEY` and `GOOGLE_GENAI_USE_VERTEXAI` are removed from the CLI's environment. (5) Off by default. `POCKET_AGY_ARGS` passes extra arguments, except `--override_user_agent_name` and `--dangerously-skip-permissions`, which are dropped and logged.
- **Attended only** (`features.unattended: false`, `takesUnattended`, `unattendedGate` reason `attended_only`). A person sends each message. Queue adds are refused (409, *Antigravity has no queue: a person sends each message.*), there is no usage-limit retry, a start from anything but the owner is refused, a coordination wake skips the conversation and a non-blocking coordination wait from one is refused (409 `attended_only`). The other engines are unchanged and now declare `unattended: true`.
- **Check-backs (1.119) are not for it.** A check-back is a reply nobody sent, so an Antigravity conversation cannot set one: `pocket-checkback` is refused there by name (400 `engine_unsupported`, *a person sends each message there*), its instructions never offer one, and the runner that starts due check-backs only knows Claude Code and Codex. The parity checklist now asks all four engines.
- **Steering.** A message sent during a reply goes into it (a second prompt, which the CLI folds into the running one); a question waiting for an answer gives way to it, as on Codex. The app shows no **Steer now / After this reply** choice and no **Queue** on these conversations.
- **Models and thinking levels** (`GET /api/antigravity/models`, `agyMenu`). The menu is what the signed-in plan lists, each model with its own levels and the level it starts on; read at start-up and every six hours, `?fresh=1` reads it again. **Default** is `POCKET_AGY_MODEL` when the plan lists it, else the CLI's own. Pocket sets the model, then the level, before each reply and checks the CLI confirmed them; a model the plan does not list ends the reply with that reason.
- **Signed out.** The route answers `signedIn: false` with the command to run on the server (`agy acp --login`). New conversation shows it under the agents with **Check again**; the model menu says **Not signed in**; a reply that finds the sign-in gone ends with the same instruction (409 `code: signin` on a send).
- **Approvals, questions, plan mode.** The CLI's permission requests are approval cards (**Review actions**) or answered at once (**Full access**), and trusted read-only commands in Settings apply. Its questions (ACP elicitation forms) are question cards, with your own answer and Skip. **Plan first** is the CLI's plan mode.
- **MCP servers.** `agy acp` does not load the CLI's own MCP settings, so Pocket passes the local servers listed in `~/.gemini/config/mcp_config.json` (or `POCKET_AGY_MCP_CONFIG`) to each conversation.
- **Background commands.** When the CLI returns while a command it started keeps running, the reply stays open until the command reports or the stream goes quiet (`POCKET_ACP_SETTLE_QUIET_MS`, `POCKET_ACP_SETTLE_MAX_MS`), and Stop ends it.
- **Pause all** counts and stops Antigravity replies (`replies.antigravity`, only where the engine is on).
- **In the app** (`public/app.js` and friends). The agent row, model and level menus, the sign-in note (`.agent-note`), labels in the list, search, filters, handoff cards and the question banner. A hidden agent row no longer shows: `.projlist .row[hidden]` was overridden by the row's `display: flex`, so the OpenRouter row showed on servers that had it off.
- **Also fixed.** `starts.mjs` cut the agent name to 10 characters. The model-mismatch message reads *Choose an Antigravity model…*.
- **Two races fixed, on OpenRouter too** (found by running the browser test under load). (1) A reply that ended while its conversation was being read came back as still running with the history cut before it; the stream then said idle and the app showed neither the reply nor that it was over. Steering made it likely, since the app reads the conversation again right after a message goes into a reply. `GET /api/session/:id` now reads again when the reply changed during the read, a history read across a reply's end is not kept (`acpRepliesEnded`), and the app reads the conversation again when the stream says idle while it still showed a reply running. (2) A list read already on its way when a conversation began or a reply ended was kept as the current list for 15 seconds, without the new conversation; such a read is no longer kept as current and the next one asks again (`staleAcpList`).
- **What it lacks**, as OpenRouter does: Side chat, Branch, While you were away, Subagents, connectors, Conductor starts, and picking up a reply that was running when Pocket restarted. Google reports no plan usage, so the usage panel has no Antigravity meter.
- **Tests:** `test/fake-agy.mjs` (a stand-in for `agy acp`), `test/antigravity.test.mjs` (the adapter: menu, a reply, approvals, model and level, questions, steering, background commands, Stop, history), `test/antigravity-http.test.mjs` (the routes: off by default, the menu and sign-in, how the CLI is started, Pause all, and the two races above, each failing without its fix), `test/antigravity-browser.mjs` (the app at phone size), and the four-engine parity checklist (`test/engine-parity.test.mjs`) with the attended-only cases.
- **Not yet checked on the real CLI:** whether a model switch resets the thinking level the way the stand-in does, and whether the CLI's shell commands inherit `POCKET_RUNNER_TOKEN`. Both are checked when the engine is first turned on.
## [1.119.0] — 2026-11-21 · build 213

Asked for by the owner (2026-11-21). Part 2 of three (`docs/plans/unattended-work.md`), on the foundation of 1.117 (1.118 was the security release). **A conversation, asked by the owner, can look again later: "check the page in 15 minutes and tell me".** The agent sets one check-back in its own conversation, a card shows it with **Cancel**, and at the time Pocket starts the conversation's next reply by itself and sends a push with the result. It is **off until the owner turns it on** in **Settings → Automation → Check-backs**. Job keys (a script on the server starts a conversation) follow in a later release.

- **A check-back** (`checkbacks.mjs`; `CheckbackStore`, the pure time and message helpers; the check-back section of `server.mjs`). One later reply in the same conversation. An entry holds the conversation, the engine, a note (what to check and what done looks like), the time, the chain depth, a snapshot of the setting reply's permission mode, model, effort and plan or work mode, and a state: `pending`, `held`, `running`, `done`, `missed` or `cancelled`. It is stored in `checkbacks.json` (atomic write, mode `0600`, created when the first one is set); finished ones are kept for 30 days, at most 300.
- **How an agent sets one** (`scripts/pocket-checkback.mjs`, the `pocket-checkback` command and skill, installed while the feature is on and removed when it is off; `package.json` gains the bin). `add --at "+15m" --note "…"` (also `+2h`, `+1d`, `+15 min`, or `2026-11-22 09:00` in the owner's zone, or a time with an offset; day names are not read, the agent turns them into a date), `list [--all]`, `cancel <id>`. The note is kept on one line (line breaks become spaces). The agent is told one line in its instructions while the feature and the engine's switch are on, and the **Tasks** line learns to offer a check-back instead of a task when the follow-up is the conversation looking again itself. It sets one only when the owner asked or accepted an offer; otherwise it offers one as a suggested reply.
- **Who may set one is the server's rule** (`checkbackSetter`, not only the instructions). The reply that is running must be one the **owner started**, or a check-back's own reply with its chain under the **Chain limit**. A check-back's reply sets **one** follow-up: a second, while the first is not cancelled, is refused (409 `one_more`, *This check-back reply already set its one follow-up (at 2:45 PM). Cancel it first to change the time.*); a reply the owner started is not limited this way. A reply started by the queue, a usage-limit retry, a coordination wake or a job, or by the agent itself after a background job, or a permission stand-in, is refused with the reason, so an emailed alert or a pager message can't schedule itself. The command needs the conversation's runner token: the conversation always comes from the token, so a terminal, code-server or a side chat is refused, and an agent can't act on another conversation's check-backs. OpenRouter is not supported; Codex works under Full access only. The owner's routes take the sign-in only, the agent routes only the command and runner tokens.
- **Running one.** A pass every minute (`POCKET_CHECKBACK_TICK_MS`, default 60000) takes each due check-back, oldest first, and: holds it while Pocket is paused; waits while the conversation has a reply running or is waiting for a usage limit to reset, so it never cancels that retry (held as *waiting for a usage limit to reset*; marked missed after **Wait for a busy conversation before marking missed**, 60 min); marks it missed when it is later than the **Catch-up window after Pocket was down** (12 h); lets the 1.117 gate hold it for a plan ceiling or the daily count, and leaves it alone until that reset (Resume, a settings save in **Settings → Automation** and Cancel still act on it); and starts the reply with origin and root origin `checkback`. It is marked running and saved **before** anything starts, so a crash never runs it twice. Several overdue ones start **Spacing between overdue check-backs** (15 s) apart. The reply starts `[Pocket check-back · set at 2:14 PM at your request · 1 of 6]`, then `What to check:` and the note, and the time now (and how late). The count is the position in the chain out of the chain limit plus one. It runs with the setting reply's permissions, lowered to Review actions by **Always Review actions** or a server with Full access off, never raised.
- **The result.** When the reply ends the check-back is done (`ok`, `failed`, `stopped`, `limit` or `interrupted`) and the owner gets *Checked back · <conversation>* with the reply's first line, even when the conversation is muted (unless **Push the result when the conversation is muted** is off) and even with a browser open; the ordinary finished-reply push is not sent as well. A check-back that is missed (Pocket down past the window, a busy conversation, paused with the overdue setting off, a conversation that is gone, a failed start) sends one push for everything a pass marks missed. After a restart a check-back that was running is settled once: left to finish if its reply was adopted, recorded as cut off if it had begun, missed if it had not. If its result can't be saved when the reply ends (`checkbacks.json` can't be written), the failure is logged, the reply ends normally and the ordinary push goes out; the next pass saves it. A check-back left running with no reply running or queued for it is settled by the pass (after two sightings), from its reply's result when known. A check-back reply left in the queue keeps its `checkback` origin when the queue drains it (not when the owner taps Start, which makes it the owner's reply). The missed reasons read after *Missed:* (*the conversation was busy*, *it was 3 h late, past the catch-up window*); the missed push starts with a capital. The *Checked back* push replaces the ordinary one only when it is really sent, or muted on purpose.
- **Pause all and Resume.** Pause all holds every waiting check-back (counted in the confirmation sheet, the toast and the banner), and one set while paused starts out held. **On Resume, run overdue check-backs** (new, in the **Pause all** group, on by default): on, an overdue check-back runs if it is within the catch-up window; off, it is marked missed with no push. One overdue past the catch-up window is marked missed on Resume (with the usual missed push) and counted as missed, not run. `POST /api/pause` answers `stopped.checkbacks`, `GET /api/pause` `would.checkbacks` and `held.checkbacks`, `POST /api/resume` `checkbacks: { run, missed }`, and the audit lines carry the same numbers.
- **Where the owner sees them** (`public/checkbacks.js`, new; `public/app.js`, `public/automation.js`, `public/tasks.js`, `public/app.css`). A **card** under the reply that set it (one line, two on a narrow phone; 52px on touch, 44px with a fine pointer), updating in place with no reload: *Will check back at 2:30 PM* (another day *Will check back Nov 22, 9:00 AM*) with **Cancel**; held, the same with *· held while Pocket is paused*, *· waiting for the conversation to finish*, *· held by a plan ceiling*, *· held by the daily limit* or *· waiting for a usage limit to reset*; *Checking back now*; *Checked back 2:30 PM*, with *· the reply didn't finish*, *· stopped*, *· hit a usage limit* or *· cut off by a restart* when it didn't finish; *Missed: <reason>*; *Cancelled*. Its tooltip and accessible description carry the note (*What to check: …*), with no visible change. A small **clock** at the end of the conversation row's state line while one waits or runs, labelled *Check-back at 2:30 PM*, *2 check-backs, next at 2:30 PM* or *Checking back now*. A read-only **Check-backs** group in **Tasks**, between the to-dos and **Done**: the note, then the time · the conversation · what holds it, and **Cancel** unless it is running. In **Settings → Automation**, a **Check-backs** group led by its switch (the rest dimmed while off, under *These apply when Check-backs is on.*), and while on, *N waiting* with **Cancel all**, which asks *Cancel N check-backs?* (**Cancel all** / **Keep it as it is**). The Pause all sheet says what it stops and what it holds, as the toast does: *This stops 2 replies running (2 Claude). It holds 1 usage-limit retry, 3 check-backs.*, or *This holds 1 check-back.* when only held things wait; the toast says *Held … 3 check-backs*, the banner *3 check-backs are held.*, and the Resume toast *2 overdue check-backs run now. 1 check-back was marked missed.* The **Settings → Automation** category line reads *Pause all, check-backs, and limits on …*. A per-device push switch **Check-backs and job results**, shown whether check-backs are on or off because it also carries the limit notice. A list refresh that changes nothing no longer repaints the conversation list or Tasks. The server adds `held: { reason }` to a Tasks entry so the group can say what holds it.
- **Settings → Automation → Check-backs** (`automation.mjs`). **Check-backs** (off), **Permissions for a check-back** (same as the reply that set it, or always Review actions), **Check-backs in Claude Code conversations** and **in Codex conversations** (on), **Push the result when the conversation is muted** (on), **Show check-backs in the Tasks list** (on), **Pending check-backs per conversation** 10 (1 to 50), **Pending check-backs on this install** 50 (1 to 500), **Chain limit** 5 (0 to 20), **Furthest ahead** 2,160 h = 90 days (1 to 8,760 h), **Soonest** 1 min (1 to 60), **Note length** 1,000 characters (200 to 4,000), **Catch-up window** 12 h (0 to 72), and under **Advanced** the busy wait 60 min (5 to 480) and the spacing 15 s (0 to 300). Checked on the server, all or nothing, with a message that names the range; none has **No limit**. Saving the group re-syncs the skill and starts a pass at once; a switch that changed closes idle agent processes so the next message carries the change. Presets: `POCKET_AUTOMATION_CHECKBACKS`, `…_CHAIN_LIMIT` and the rest (names in the manual).
- **A new push kind, `automation`** (**Check-backs and job results**, per device, on by default, normal priority). The 1.117 *Unattended work held* notice moved from **Inbox alerts** (`alerts`) to it, as 1.117 said it would. A device that turned **Inbox alerts** off keeps getting the notice until it makes its choice for the new kind.
- **The audit** (`automation-audit.jsonl`): `checkback` lines for `set`, `cancelled`, `held` (once per reason per check-back), `started`, `finished` and `missed`, each with the id, conversation, engine and chain depth, never the note or the reply. The finished-reply line carries origin `checkback` and the check-back's id.
- **Routes** (all answer 404 *Check-backs are switched off on this Pocket.* while the feature is off, with `Cache-Control: private, no-store`). Agent: `POST /api/checkbacks/agent/add`, `GET /api/checkbacks/agent`, `POST /api/checkbacks/agent/cancel`. Owner: `GET /api/checkbacks`, `POST /api/checkbacks/cancel`, `POST /api/checkbacks/cancel-all`. `/api/me` gains `features.checkbacks`; `/api/sessions` rows carry `checkback: { pending, running, nextAt }` (`pending` counts waiting and held ones, `running` is `true` or `false`, `nextAt` is the earliest due time of the waiting and held ones); `/api/session/:id` carries `checkbacks`; `/api/tasks` carries a `checkbacks` group for the app only; `/api/automation` carries `checkbacks: { on, pending, running }`.
- **Tests:**
  - `test/checkbacks.test.mjs` (new): times and range, the message, the push line, the store, instructions, the skill.
  - `test/checkback-routes.test.mjs` (new): off by default; who may set, and refusals from the queue, a retry, a wake and an agent-started reply; the chain and limit 0; a run with the setting reply's permissions and one push; muted; a crash and a restart; catch-up and spacing; busy; Pause and Resume; plan ceiling and daily count (left alone while held until the reset); Codex and OpenRouter; the Tasks entry's `held` reason; a store that can't be written when the reply ends; a usage-limit retry counted as busy (Claude and Codex); one follow-up per check-back reply; an engine switch turned off with one waiting; Full access off on the server; the feature off with one overdue; Resume past the catch-up window; a queued check-back reply keeping its origin, and not started once check-backs are off; the CLI token and a cross-site post refused on the owner's cancel routes; a retry held by Pause all, and a retry that is starting, counted as busy; a note kept on one line; a closing process's runner token refused. Its teardown now stops the fake Claude and Codex processes its servers started.
  - `test/checkback-browser.mjs` (new, inside `test/browser.mjs` or alone with `POCKET_CHECKBACK_ONLY=1`): the card in every state and its placement, Cancel in place, a run turning it to *Checking back now* and *Checked back*, the row clock, the Tasks group, the Settings group (switch, inactive while off, save, range error, Reset, Cancel all), Pause all counting check-backs, the push switch shown with check-backs on and off, the feature off, and an unchanged refresh writing nothing.
  - `test/checkback-live-browser.mjs` (new, in `npm run test:browser`): the same flows against the real server and the fake Claude CLI, so a field the app reads that the server does not send fails. Its teardown now stops the fake CLI processes the server started.
  - Test teardowns in `test/handoff.test.mjs` (a flaky cleanup: it now waits for the server to exit, stops its runners, and retries the folder removal), `test/engine-parity.test.mjs`, `test/pause-routes.test.mjs`, `test/server.test.mjs`, `test/sidechat.test.mjs`, the `test/review-1881-*` files and the vault test files now stop the fake CLI processes and keepers their servers started.
  - `test/automation.test.mjs`, `test/pause-routes.test.mjs`, `test/notify.test.mjs`, `test/automation-browser.mjs`, `test/ui-regressions.mjs` (five push kinds, the new one shown with check-backs off) and others follow the new shapes.
- **Manual:** *Automation* (a new **Check-backs** section, Pause all, the audit lines, presets, troubleshooting), *Tasks*, *Settings*, *For agents*, *Questions and approvals*, *Working in a conversation*, *Conversations*, *Desktop and phone*; *Operations* (the new file, presets, rollback). `PRODUCT.md` ("Nothing starts a reply on its own unless the owner set it up"), `SECURITY.md` (the origin rule, the runner token and how long it lasts, what an injected instruction could and could not do) and `DESIGN.md` follow.
- **Migration:** none. Check-backs are off until turned on. **Rollback to 1.118 (or 1.117):** 1.118 ignores `checkbacks.json`, the **Check-backs** settings, **On Resume, run overdue check-backs** and the new push kind, and keeps them in their files, so check-backs stop and nothing is lost; upgrading again finds them, and each waiting one runs or is marked missed by the catch-up window. Remove the `pocket-checkback` folders under `~/.claude/skills/` and `$CODEX_HOME/skills/` after rolling back (1.118 doesn't remove them).
- **Not in this release:** job keys, `/api/jobs/run` and `pocket-run` (a later release); check-backs in OpenRouter conversations; day names such as "Friday 9am" in `--at`.

## [1.118.0] — 2026-11-21 · build 212

A security release, from a review of the public repository. It hardens sign-in, keeps share links
and agent sharing under the owner's control, pins a Vault *Always allow* to what a command really
runs, confines HTML preview pictures, and stops the health check from describing the server to
strangers. Docs, tests and examples use placeholders instead of private details.

**Sign-in**

- **Sign out and Sign out everywhere** (`POST /api/logout`, `POST /api/logout/everywhere`; Settings → Agents & instance, or **Accounts** in Assistant mode, `#s-signout`). **Sign out** ends this browser's sign-in and turns off its notifications. **Sign out everywhere** asks first, then ends every browser's and phone's sign-in, this one included, and removes every push subscription; conversations and replies in progress carry on. Both accept only Pocket's own page (same origin, JSON).
- **A sign-in generation** (`auth-state.json` in the data folder, mode `0600`, holding the generation and a keyed hash of the password, never the password). Sign out everywhere moves to a new generation and every older cookie stops working. A changed `POCKET_PASSWORD` is noticed at the next start and signs everyone out too. A start in a data folder Pocket has used before that finds no usable `auth-state.json` (the first start after this upgrade, or a deleted or unreadable file) begins a new generation, so **every browser signs in once after upgrading**, and deleting the file signs everyone out instead of reviving old cookies. A restored older copy brings back that generation's cookies: choose Sign out everywhere after a restore.
- **A sign-in queue across addresses.** The 20-an-hour limit per address stays, and an IPv6 address now counts by its /64. Past 30 wrong passwords in an hour across all addresses, sign-ins are checked one at a time with a pause that starts at 1 second and grows to 10; a try that would wait more than 20 seconds gets **Too many sign-in attempts right now. Try again in a minute.** without being checked.
- **Known devices skip the queue.** Each sign-in sets a signed `pc_device` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, sent only to `/api/login`, one year), bound to the server secret, the generation and the password. It signs nothing in by itself and still counts against its address's 20 tries; after five wrong passwords in an hour it stops skipping. So the owner can still sign in during a flood on any browser used before.
- **Notifications stop on sign-out.** A browser whose subscription the server no longer has (after Sign out everywhere) is unsubscribed the next time the page checks, so the bell and Settings show Off.

**What strangers can learn**

- **`/api/health`** answers a caller that is neither signed in nor a direct request on the box itself with `{"ok":true}` only; the running counts and uptime are for the owner and the box.
- **`Strict-Transport-Security`** (one year) on responses to requests that reached the proxy over HTTPS (`X-Forwarded-Proto` or Cloudflare's `CF-Visitor`).
- **A reverse proxy must send `X-Forwarded-For`.** Pocket tells a request made on the box from one that came through a proxy by the proxy's headers; `Forwarded` and `X-Real-IP` now count as well as `X-Forwarded-For` and `CF-Connecting-IP`. nginx's `proxy_pass` sends none of them on its own, so behind it every caller looked local. `docs/install.md` gives the two `proxy_set_header` lines; Cloudflare Tunnel, Caddy and Tailscale Serve already send the header.
- **The browser's time zone** is stored with `POST /api/timezone` from Pocket's own page, no longer by `GET /api/me?tz=`, which a link on another site could trigger.
- The public address used in email links (learned from a signed-in request) still cannot be set by a stranger; a test now covers it.

**Files**

- **Share links are stored only as a hash.** A link's address is shown once, when it is made: in the share sheet (with **Copy** and a note to copy it now), in `pocket-docs share`, and in the API answer that made it. Afterwards the sheet says a link is open and when it expires, with **Make a new link** (the old address stops working) and **Revoke link** (the file becomes private). **Copy link** in the toolbar, options and rows is offered for public files only. On the first start, `documents.json` loses the stored addresses and keeps their hashes, so links already handed out keep working; Pocket cannot show those addresses again. Copies of the old file in backups still hold them.
- **An agent's share or publish waits for the owner.** With the CLI token an agent can still keep files, change their title, project and conversation, make a file private and shorten a link's life. Anything that exposes a file more (a link, a public address, a new link, a later or no expiry, including `pocket-docs add --visibility` and `pocket-docs import`) becomes a request: a **Requests** card at the top of Files and in the side panel's Files list, naming the conversation, the file, the exact change, where the file came from, its kind and size, with **Allow** and **Deny**, and a push with the same buttons (under **Vault requests**). **Allow** checks that the file's content (SHA-256), name and sharing are what the card showed, then makes exactly that change, once; otherwise nothing changes and Pocket says why. **Deny**, or no answer within 15 minutes, changes nothing. There is no "always allow". `pocket-docs` waits up to `--wait` seconds (default 90), then prints `pending <id>` and exits 6; `pocket-docs wait <id>` continues; exit 7 means denied, expired or changed. The pocket-files skill and the agent instructions say so.
- **HTML preview pictures are confined.** An HTML file is pictured in a sandboxed frame with scripts off, from a folder holding nothing else, with Chrome unable to resolve any host or reach the network. A report's text, inline styles and `data:` images appear; remote images, web fonts and charts drawn by script are left out of the picture (opening the file shows everything).
- An HTML file's title decodes `&amp;` last, so `&amp;lt;` reads as the text `&lt;`.

**Vault**

- **Always allow is pinned to what runs.** A recipe now records, by SHA-256, the program found on the Vault's own `PATH` (`POCKET_VAULT_PATH`, or the daemon's `PATH` at start; absolute folders only, never the caller's), its `#!` interpreter, the program a known launcher starts (`env`, `timeout`, `nice`, `nohup`, `stdbuf`, `ionice`, `setsid`, `taskset`, `chrt`, `time`, `xargs`, `sudo`, `doas`, `flock`, `sshpass`), the script a known interpreter runs, found the way the interpreter finds it (`node job` records `job.js`; `python3 -m tool` records the module file in the working folder), a file given by path to `node -r` or `--import`, the makefile `make` reads, and every file named in the arguments. A run matches only while all of that is unchanged; otherwise the request says what changed and nothing runs. A file Pocket cannot read, or one over 512 MB, is recorded by size and dates.
- **Always allow is pinned to its variables.** A recipe records which variable gets which secret (and which field). The same command with a secret under another name, another secret for a name, or an extra variable asks again, and the request card shows each variable with the secret it gets, and what was allowed before. Names a program acts on by itself (it runs or loads the value, reads it as options, creates a file or folder named after it, or sends it on) cannot be bound: `PATH`, `HOME`, `POCKET_*`, `LD_*`, `DYLD_*`, `NODE_*` (not `NODE_AUTH_TOKEN`), `NPM_CONFIG_*`, `PYTHON*`, `PERL*`, `RUBY*`, the JVM's option variables, the shell's (`BASH_ENV`, `ENV`, `IFS`, `PS0`–`PS9`, `PROMPT_COMMAND`, `SHELLOPTS`, `BASHOPTS`, `ZDOTDIR`, `SHELL`), `GIT_*` (not `GIT_TOKEN`, `GIT_PASSWORD`, `GIT_USERNAME`, `GIT_CREDENTIALS`, `GIT_AUTH_TOKEN`), `PAGER`, `MANPAGER`, `EDITOR`, `VISUAL`, `BROWSER`, `LESS*`, `SSH_ASKPASS`, `SUDO_ASKPASS`, `MAKEFLAGS`, `MFLAGS`, `MAKEFILES`, `TMPDIR`, `TMP`, `TEMP`, `TEMPDIR`, `XDG_*`, `SSLKEYLOGFILE`, `HISTFILE`, `GNUPGHOME`, `DOCKER_CONFIG`, `LANG`, `LANGUAGE`, `LC_*` and `TZ`. Ordinary names such as `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN` and `PGPASSWORD` are unaffected.
- **No Always allow where Pocket cannot see what runs.** For a command whose real work is decided after the start, elsewhere, or by something Pocket does not read, the request says why in one sentence and offers only **Allow once** and **Deny**: an interpreter with no script Pocket can find (`xargs -a list.txt sh`), `find -exec` and `node --test`, programs that start other commands (`parallel`, `watch`, `nodemon`, `pm2`, `strace`, `su`, `tmux`, `cross-env`, …, or a launcher option Pocket does not know), `ssh` with a command, `rsync -e`, project scripts (`npm run`, `npm test`, `npm install` and other npm, pnpm and yarn commands that can run them, `node --run`, `bun run`, `deno task`), `npx` and `npm exec`, `docker run` and other container commands, code from an address, and `node --watch` or `--inspect`.
- **What runs is what was checked.** On Linux a native program starts from the very file Pocket hashed, and a shell script runs from a private copy of the hashed bytes; anything else is hashed again just before the start, and a difference stops the run (**Run stopped** in the history). A script that `node`, `python3` or another interpreter then opens by its path can still be swapped at that moment by an agent that can write it or its folder, and such a swap will usually succeed: the card says when that is possible, and what protects a credential there is a script in a folder the agent's user cannot write, or **Allow once**. `SECURITY.md` lists what Always allow still does not check (sourced files, loaded modules, a preload named by package, `__pycache__`, inline code beyond its text, a program's own configuration and hooks, what a command installs and runs).
- **The request card** has a **Runs** line with the program's full path, a **Variables** line with each variable and the secret it gets, short notes when Pocket cannot check everything (code given inline, a file checked only by size and dates, a script that is not a plain file, a script an agent can change, and why **Always allow** is not offered), a notice when a command allowed always has changed, has other variables, or was allowed before this check existed, and, when **Always allow** is offered, **Files that Always allow checks** as tick boxes: untick a file the command writes itself (an output or a log) so it does not ask on every run.
- **A start-up warning** for each folder on the Vault's `PATH` this user can write to, create or replace.
- The output filter also replaces a value's hex and reversed forms.
- **Plainer wording about limits.** The Vault keeps values out of the conversation, transcript and logs in normal use; it is not a wall against an agent that sets out to get one. *Free rein* now says any agent on the server can obtain such a value. A browser-fill request says the agent will be able to read what is filled. `SECURITY.md` has **What the Vault does not stop**.
- **Intake links** count per address only for an address Pocket can place, so a stranger's wrong links through a tunnel no longer close the page for the person a link was sent to. Past 300 unknown links an hour across the install, each further one is answered after 1.5 seconds; nothing is refused for it.

**Other**

- **Coordination starts with one known name, `pocket-main`.** Other names are learned the first time each is held and stay known; an existing install keeps every name it has used. `pocket-coord list` says so.
- **Uploads** are written `0600` in folders that are `0700`, whatever the umask, including folders an earlier version made.
- **Inbox Watch** creates its Gmail token file `0600` from the start.
- **Dependencies**: body-parser, DOMPurify 3.4.18, nodemailer 10.6.1, proxy-addr and qs; `npm audit --omit=dev` reports none.
- The upload routes refuse a JSON body (400 instead of 503); `GET /api/session/:id` checks the id; CLI versions are read without a shell; two patterns check length before a slow match.
- Placeholders instead of private details in docs, tests, examples and the demo data; a gitleaks configuration and Dependabot.

**After you upgrade**

1. Everyone signs in once: the first start begins a new sign-in generation.
2. Turn notifications on again on any device you signed out, or on all of them after Sign out everywhere.
3. Every command you allowed always in the Vault asks once more, because Pocket did not record which variable gets which secret; the card says so and shows the variables. Check them and choose **Always allow** again to record them. Commands Pocket now cannot check (`npm run`, `npx`, `docker run`, `find -exec`, `ssh host command`, …) ask every time and no longer offer **Always allow**; have agents call the script directly where you want to allow it once.
4. Programs a Vault run starts must be on the Vault's `PATH` (`POCKET_VAULT_PATH`, or the `PATH` Pocket started with). Give a full path for one outside it, and set `POCKET_VAULT_PATH` to folders the service user cannot write if the log warns.
5. An agent's share or publish now waits for your **Allow** in Files or on the notification.
6. Share links you already sent keep working, but Pocket can no longer show their addresses. Use the address you sent, or **Make a new link**.
7. `/api/health` gives detail only to a signed-in browser or a request on the box itself; an uptime monitor through the tunnel gets `{"ok":true}`.
8. A reverse proxy must send `X-Forwarded-For` (and `X-Forwarded-Proto`). nginx needs the two `proxy_set_header` lines in `docs/install.md`.
9. Coordination knows only `pocket-main` from the start; other names are learned when first held, and names your install already used stay known.
10. A Vault run that gives a secret to a variable a program acts on by itself (`NODE_OPTIONS`, `PYTHONPATH`, `GIT_SSH_COMMAND`, `TMPDIR`, `LANG`, …) is refused with "… cannot be bound."; the agent must use another name. If the card notes that an agent can change a script, move that script to a folder the service's user cannot write, or answer **Allow once**.

- **Numbering:** written while the next number looked like 1.117, so comments and docs on the branch said 1.117; main released a different 1.117.0 (Pause all) first, and this ships as 1.118.0 / build 212 on top of it. The check-backs that the 1.117.0 entry and `docs/plans/unattended-work.md` place in 1.118 come in a later release.

Tests: `test/hardening.test.mjs`, `test/auth-followups.test.mjs`, `test/share-publish.test.mjs`, `test/vault-pin.test.mjs`, `test/vault-pin-followups.test.mjs`, `test/thumbnails.test.mjs`, `test/coordination*.test.mjs`, the browser suite (request cards, share sheet, sign-out controls) and `inbox-watch/tests/test_connector.py`. Manual: *Getting started*, *Settings*, *Files*, *Vault*, *Coordination*, *Desktop and phone*, *For agents*; `SECURITY.md`, `docs/install.md`, `docs/operations.md`.

## [1.117.0] — 2026-11-21 · build 211

Asked for by the owner (2026-11-21), after a review of how another assistant handles work that runs while the owner is away. Part 1 of three (`docs/plans/unattended-work.md`): the foundation that anything which starts a reply for the owner must stand on. **One switch stops everything, every reply records who started it, and limits keep unattended work from using up a plan.** Check-backs (a conversation looks again at a time you asked for) follow in 1.119 and job keys (a script on the server starts a conversation) in a later release. **Neither is in this release**, and nothing in 1.117 starts a reply that 1.116 would not. With the defaults an install behaves as 1.116 plus Pause all.

- **Pause all** (`POST /api/pause`, `POST /api/resume`, `GET /api/pause`; `pauseAll`, `resumeAll` in `server.mjs`). One persisted, install-wide pause (`paused` in `pocket-settings.json`; it survives a restart). Pausing stops every running reply on Claude Code, Codex and OpenRouter by the engine's own Stop path, holds every pending usage-limit retry (its `.retry.json` marker stays and gains `held: true`; Stop never cancelled a retry before), keeps every follow-up queue from draining, lets a coordination wake add its message without starting the conversation, and pauses Inbox Watch's checks by the same flag **Pause Inbox Watch** sets, recorded as set by Pause all so **Resume** clears only what Pause all set (and leaves it alone when the owner changed Inbox Watch's settings meanwhile). Busy side chats are stopped too, counted with their engine's replies. Claude conversations **Working in background** have their background jobs stopped by the **Stop background jobs** path (counted as `background`), so the reply the CLI would start when a job ends never comes; with **Pause all also stops background jobs** off the jobs keep running until one of them starts a reply, and stopping that reply ends that conversation's process and any other jobs in it. A job whose reply is still running ends with that reply (the stop ends the process group, as **Stop** does) whichever way the switch is set, and is counted once in `background` too. A reply an agent starts by itself while paused (Claude after a background job, Codex after a background terminal) is stopped as it begins, with no push, and clears the conversation's `lastOrigin`. Pausing again while paused changes nothing and writes no second audit line. **The owner's own messages run normally**, with a banner across the top: *Pocket is paused. Your own messages still run.* and **Resume**. Own messages include a side chat and a message held for background jobs on the earlier Claude login (an `afterJobs` row the owner wrote), which starts when its jobs end, paused or not; with own messages **Blocked**, all of these wait.
- **Where the control is** (`public/automation.js`, `Automation`). **Pause all** is the first row of the new **More** (**⋯**) menu beside the conversation list (a button in the list header on a phone and in the rail on a computer), the first row of **Switch conversation** (Ctrl/⌘ K) and the first row of **Settings → Automation**; each reads **Resume** while paused. A confirmation sheet lists what will stop (*This stops 3 replies running (2 Claude, 1 Codex), 2 background jobs, 1 usage-limit retry, Inbox Watch.*). By voice, "pause everything" opens the same sheet (`public/voice-text.js`, `public/voice.js`). A second device shows the banner within a few seconds: `/api/sessions` carries `pause` (the banner's state), so the regular list refresh brings it without a request of its own; `GET /api/pause` stays for the confirmation and the return to the tab. **Stop all Claude replies** stays in Accounts & instance for switching Claude accounts.
- **Resume.** Held retries are armed again (5 s at the soonest, none dropped); queued messages stay paused until the owner starts them, as after Stop; stopped replies don't restart. With **On Resume, re-arm held usage-limit retries** off, a held retry stays held, across a restart too, until the owner's next message in that conversation. A message the owner sent while background jobs held the earlier Claude login, kept while own messages were **Blocked**, starts on Resume once its jobs have ended. `POST /api/resume` answers `inboxWatch`: `resumed`, `left_paused` (the owner changed Inbox Watch while paused and it is still paused; it is left as set) or `null` (including when the owner's change resumed it); for `left_paused` the toast adds *Inbox Watch was changed while paused and is still paused.*
- **Who started a reply** (`origin`, `rootOrigin`, `originRef` through `startTurn`, `startCodexFromApi`, `startAcpFromApi`, queue rows, retry markers and the turn). Every turn carries the origin of whoever started it (owner, queue, retry or coordination wake) and the root of who asked for the work in the first place (a retry keeps the root of the reply it retries, a queue row the origin of whoever wrote it). The server sets them; a request body can't. The newest non-owner origin is kept on the conversation (`lastOrigin`, `lastOriginRef` on `/api/sessions` and `/api/session/:id`) and shown as a dim line under the agent on its row and under the conversation header: **Queued message**, **Continued after a usage limit**, **Woken by a hold**. A finished-reply push for such a reply leads with the label. A conversation whose usage-limit retry a pause held reads **Retry held** (short enough for a phone's header), while paused and after a Resume with re-arming off.
- **The unattended gate** (`unattendedGate`, `gateUnattended`). Every start that isn't the owner's (a retry, a queue drain, a coordination wake) asks it first, in this order: paused, plan ceiling, daily limit. An owner send never does, and neither does **Run next instruction**. A refused retry stays held and is tried again at the reset or the next minute (the conversation shows that time); a refused queue row stays in its queue, and the reply before it still gets its push, on all three engines. Pause is checked once more where the turn comes into existence (`refuseIfPaused`; for Codex and OpenRouter after the conversation is reopened, through `mayStart` in `codex.mjs` and `acp.mjs`), so a pause that lands between the gate and the start starts nothing: the retry is held again and the queue row goes back to pending (`keepPending` in `queue.mjs`). While paused, the usage-limit push says the retry is held (*The retry is held until you resume*, or *send a message to carry on* with re-arming off) instead of a time.
- **Limits on unattended work** (**Settings → Automation → Limits on unattended work**, `automation.mjs`). Plan ceilings, weekly 80% and 5-hour 90%, set separately for Claude Code and Codex (10 to 100% or No limit); **Unattended replies per day** 40 (1 to 1,000 or No limit, in the owner's time zone); **OpenRouter spend per day (unattended)** $5 ($0.50 to $500 or No limit); **Longest unattended reply** 60 min (5 to 480 or No limit; the one limit that stops a running reply, and it applies only to the check-back and job replies that arrive later; waiting on an approval or question doesn't count unless switched on); **Notice when a limit is reached** (push and Settings, or Settings only); and under **Advanced** the age at which a Claude plan reading counts as stale (6 h, 1 to 24 h: a stale reading passes the ceiling, because the reply that runs refreshes it; Codex is read live). A ceiling or the daily count never cuts a reply off mid-way.
- **Two switches decide whether the limits reach the owner's own work.** **Count queue drains, retries and coordination wakes toward the daily limit** and **Plan ceilings also hold queued messages, retries and coordination wakes** (the second is new in this release, beside the one the plan names). Both are **off by default**, so work the owner asked for is held by the limits only when they say so. The first also decides whether that work counts toward **OpenRouter spend per day**. The day only moves forward: a time zone moved west, or a clock stepped back, keeps today's count. Work that arrives with 1.119 and with job keys is always held.
- **One notice per reason per day.** A limit that holds work tells the owner once per reason per day (not once per refused start), in **Limits reached today** on the page and by a push titled **Unattended work held** (on the existing `alerts` push kind, so it follows the device's **Inbox alerts** switch; the `automation` push kind comes with 1.119). Pause itself never produces a notice.
- **Settings → Automation** (`GET /api/automation`, `POST /api/automation/settings`; `public/automation.js`; a category in both modes, `public/workspace.js`). The **Pause all** row, a **Pause all** group (**Your own messages while paused**: run with a banner or blocked until the owner resumes; **Pause all also pauses Inbox Watch**; **Pause all also stops background jobs**; **On Resume, re-arm held usage-limit retries**; **Show what will stop before pausing**), the limits group, and **Unattended replies** with **Today**, a **Last 7 days** table of replies, tokens and cost, and **Limits reached today**. Each group has **Reset to defaults**; a number has a **No limit** button, and while any limit is off a warning shows at the top of the page. Values are checked on the server, all or nothing, and an out-of-range value is refused with a message naming the range. A change applies to the next start, never to a reply already running. With own messages set to **Blocked until you resume**, an owner send while paused answers 409 *Pocket is paused. Resume to send.*; the draft stays in the box and the banner offers **Resume** (adding to a queue still works, it starts nothing).
- **Presets for an install** (`POCKET_AUTOMATION_<NAME>`). A value in `.env` sets the default for the install; a value saved in Settings wins. Names: `OWN_MESSAGES`, `INBOX_WATCH`, `BACKGROUND_JOBS`, `REARM_RETRIES`, `CONFIRM`, `DAILY_REPLIES`, `COUNT_OWNER_WORK`, `CEILINGS_HOLD_OWNER_WORK`, `OPENROUTER_DAILY`, `LONGEST_REPLY`, `COUNT_WAITING`, `NOTICE`, `STALE_HOURS`, `CLAUDE_WEEKLY` (or `CLAUDE_WEEKLY_CEILING`), `CLAUDE_FIVE_HOUR`, `CODEX_WEEKLY`, `CODEX_FIVE_HOUR`, and `WEEKLY_CEILING` and `FIVE_HOUR_CEILING` for both engines (an engine's own name wins). A value can be `off` where the setting has No limit; a bad one is ignored and named in the page's warnings. `POCKET_AUTOMATION_TICK_MS` (default 60000) sets how often the longest-reply check runs.
- **Owner only** (`SECURITY.md`). The pause and settings routes take the owner's sign-in; the CLI token is refused, so no agent can lift a pause or raise its own limits. The two `POST` pause routes also need a JSON body and refuse a cross-site request. `/api/me` gains `paused` and `features.automation`.
- **New data files.** `automation-state.json` (the day's counts and notices) and `automation-audit.jsonl` (created `0600`, append-only: pauses (with what they stopped, background jobs included), resumes (with what became of Inbox Watch), settings changes, limit notices, and one line per finished unattended reply with its origin, engine, model (for Claude the model the reply ran on), duration, cost or tokens and outcome; **never message text**). `pocket-settings.json` gains `paused` and `automation` (only values the owner saved). `.retry.json` markers gain `rootOrigin`, `originRef` and `held`; queue rows and conversation records gain the origin fields.
- **Tests:** `test/automation.test.mjs` (origins and labels, defaults and ranges, saving, No limit, presets, a saved value or preset for an unknown key ignored, the gate's order, the daily limit, one notice a day, the longest reply, the audit file holding no text), `test/pause-routes.test.mjs` (Pause all on every engine, a held retry, the queue staying still, a restart, Resume re-arming, blocked own messages, a coordination wake while paused, the settings route, the CLI token refused, and a valid cookie refused on a form post or a cross-site request; background jobs and replies the agent starts on Claude and Codex; a pause that lands while a queued message or retry reopens its Codex conversation; the reply before a held queue row still pushed on all three engines; Codex and OpenRouter while paused, with the held-retry push wording; plan ceilings holding owner work with one notice and the re-armed time; side chats; a message held for background jobs while paused and while Blocked), `test/engine-parity.test.mjs` (origin carried from the start call to the turn and to `lastOrigin` on all three engines), `test/automation-browser.mjs` (the banner and Resume, a blocked send keeping its draft, Settings → Automation: saving, a refused value, No limit, Reset to defaults, the usage table newest day first, 44 px controls, accessibility checks; a pause check with nothing changed leaves the list, the banner, the header and the Pause all controls untouched and asks for nothing but `/api/pause`; the real list refresh makes no `/api/pause` request, and a second device's pause and resume arrive with the list; the background-job count and the Inbox Watch toast), and `test/ui-regressions.mjs` and `test/cleanup-ui.mjs` (seven categories in the Settings index).
- **Manual:** new page *Automation*; *Settings* (the Automation category), *Questions and approvals* (replies you did not start), *Conversations* (retry held while paused, the origin line), *Working in a conversation* (the queue while paused), *Inbox Watch* (Pause all), *Voice* (the quick command), *Desktop and phone* (the menu, Ctrl/⌘ K), *For agents*, *Getting started*; *Operations* (new files, a paused install). `PRODUCT.md` and `SECURITY.md` follow.
- **Migration:** none. **Rollback to 1.116:** the extra keys are ignored, so a paused install runs as if unpaused, and a held retry is armed again at start (held retries run). 1.116 keeps `paused` in `pocket-settings.json` without reading it, so upgrading to 1.117 again comes back paused (resume then, or resume before rolling back). If Pause all had paused Inbox Watch it stays paused under 1.116 until the owner resumes it in Inbox Watch's settings. `automation-state.json` and `automation-audit.jsonl` can stay or go.
- **Not in this release:** check-backs, `pocket-checkback` and the **On Resume, run overdue check-backs** setting (1.119), job keys, `/api/jobs/run` and `pocket-run` (a later release), the `automation` push kind, and any change to what starts a reply. The gate, the counting and the longest-reply check for those are built and unit-tested here and answer "feature off" until then.

## [1.116.0] — 2026-11-20 · build 210

Asked for by the owner (2026-11-20). He noticed the **Mark all reviewed** bar in Attention, did not remember asking for it (it came with 1.15.0's *Mark as reviewed*, added beside the per-conversation option he had asked for) and judged that clearing the whole list in one tap is unwise for him. Other people on other installs may rely on it, so it becomes a choice instead of going away.

- **Settings → Conversation → Mark all reviewed bar** (`public/app.js` `#s-review-all`, `reviewAllOn`, `reviewBarHTML`; listed under *This instance · all devices* in `public/workspace.js`). On by default, so nothing changes until someone switches it off. Off hides the "N not reviewed yet" bar in **Attention** and **New**. The reason to hide it: one tap clears every listed finished reply and failed turn on every device, it does not tell a wrap-up from a reply that ends with a question or reply buttons, and after the ten-second Undo nothing shows what was cleared.
- **A server setting** (`markAllReviewed` in `pocket-settings.json`, default `true`; `POST /api/settings` takes a boolean; `/api/me` tells the browser in `features.markAllReviewed`). One switch covers every device signed in to the install. The device that flips it repaints at once; another device follows the next time it loads Pocket.
- **Unchanged:** *Mark as reviewed* in Conversation options (long-press or ⋯), the Complete card and its Undo, opening a conversation, `/api/seen`.
- Tests: `test/secret-detect.test.mjs` (default on, a boolean changes it, `/api/me` follows), `test/ui-regressions.mjs` (the switch hides the bar and brings it back; the row stays in Attention with its options), `test/documents.test.mjs` (the features list).
- Manual: *Conversations* (Find a conversation), *Settings* (Conversation). Migration: none; an install with no saved value shows the bar.
- Numbering: built as 1.114.0 / build 208 from 1.113.2; 1.115.0 was released first, so this was rebased onto it and released as 1.116.0 / build 210. No 1.114.0 was released.

## [1.115.0] — 2026-11-20 · build 209

Asked for by the owner (2026-11-20), the first time he met 1.113's merge on real mail: a new email had folded into an entry that already had a conversation, he opened the entry, landed in that conversation, and could hardly see the one-line *Bring it in* offer because the big green Complete card sat right under it offering **Close conversation**. He also wanted the choice 1.113 never gave: carry on in the conversation, start a new one because the old one has used enough context, or start a new one because the mail is really a separate subject, with context carried over in both new-conversation cases. The middle option is named in his words: *New conversation, hand-off from the last one*.

- **The entry sheet is the choice point** (`public/inbox.js` `inboxSheet`). When the entry's conversation has not had the latest mail, the sheet offers **Continue the conversation** (opens it and brings the mail in; the sub-line gives when it started and how large it is), **New conversation, hand-off from the last one** and **New conversation, separate subject**. When it is not behind: **Open the conversation**, the hand-off, **Start another conversation**. A handed-off conversation no longer counts as the entry's conversation (`inboxSession`).
- **A news card replaces the Complete card** (`InboxNews` in `public/inbox.js`, `paintDone` in `public/app.js`, `.inbox-news` in `public/app.css`). Under the latest reply of a conversation that is behind: title, time and the mail's first sentence (`GET /api/inbox/news` now sends `latest.line`), a filled clay **Bring it in**, a **New conversation** chip that opens the two new-conversation choices, and a quiet **Not now** that puts the Complete card back until more mail comes. The card says how large the conversation is when that is worth knowing. Clay means a tap sends a message; green means finished; the two are never shown together. The Handoff offer waits behind the card (`Handoff.eligible` in `public/sidechat.js`).
- **Behind reads the same everywhere** (`listState`, `sessionRowHTML`, `homeRowHTML` in `public/app.js`; `tabState` in `public/workspace.js`). The list row, the Home row, the tab and the header say **New mail** instead of Complete, and the list's one-tap close tick is hidden while they do.
- **Hand-off** (`catchUpText(…, {handoff})` and `linkHandoff` in `inbox.mjs`; `linkStartLink` in `server.mjs`; `Handoff.send(id, {ask})`). The old conversation is sent the new mail with the instruction to write a handoff briefing that leads with it, instead of working on it. When the handoff starts, the old conversation is marked `handed` on the entry and the new one takes its place, already counted as having the mail, so later mail goes to the new conversation and the old one stops reading New mail.
- **Separate subject** (`split`, `splitStory`, `splitOn`, `relink` in `inbox.mjs`; `POST /api/inbox/split` and `splitBriefing` in `server.mjs`). The latest update leaves the entry as an entry of its own with a story of its own, and the first entry goes back to the title, text, priority and Gmail thread it had before (`update` now keeps them in the news item as `was`). When the latest news is a merged-in entry, that entry is restored instead. The new entry gets a start link: the mail's own briefing, plus a line that the owner split it off, and the earlier conversation's title and outcome as background to ask about before relying on it. Merging a split pair back is refused. Later mail on the same Gmail thread goes to the split entry (`add`).
- **The watcher learns the split** (`split_story` and `apply_feedback` in `inbox-watch/inbox_monitor/engine.py`; `feedback`/`ack` in `inbox.mjs` carry a `:split` item). The thread is moved to a story of its own in the ledger, so the judge stops folding its mail into the first story.
- **CLI and skill**: `pocket-inbox split [<id>] [--session <conversation id>]` (`scripts/pocket-inbox.mjs`), for when the user says in a conversation that the latest mail is a different subject. The pocket-inbox skill covers the hand-off message, the split, and never merging a split entry back.
- Limits: only the latest update or merged-in entry can be split off, and an update only from an entry that has a conversation (an entry nobody opened keeps no record of its separate updates). A hand-off costs one reply in the old conversation. **Not now** is per device.
- Tested: `test/inbox.test.mjs` (hand-off link, split of an update, split of a merged entry, the route, the CLI, merge refused, watcher feedback), `test/handoff.test.mjs` (entry → conversation → handoff → update → split, end to end), `test/inbox-news-browser.mjs` (the card replaces Complete, list/header/tab read New mail, Not now, Bring it in, the sheet's three choices, hand-off, split, phone width, draft kept; axe clean in dark and light), `inbox-watch/tests/test_label.py` `test_a_split_entry_gets_a_story_of_its_own`.
- Manual: *Inbox Watch* (What goes on the list: the news card and the three choices; For agents), *Working in a conversation* (Complete card), *Conversations*, *Desktop and phone*. `DESIGN.md`: *Inbox news card and the three choices (1.115)*.

## [1.113.2] — 2026-11-20 · build 207

Asked for by the owner (2026-11-20), the day after 1.113's opening check went live: in a conversation started from an alert (a customer reply asking for a reference list), the agent's first reply was all about the check (earlier mail on the story, no duplicate entries) and gave the email itself one line at the bottom. The owner's first question was "what did the email say?". The briefing's check was its last instruction and the only one that said what the first reply should hold, so the agent reported the check and treated the email as background. Watcher, manual and skill only; no change to the web app or its build.

- **The opening reply leads with the email** (`inbox-watch/inbox_monitor/engine.py` `briefing_for`). The check still runs first, but the briefing now says what the reply is made of, in order: (a) what the email says, first and in the most space (who wrote, what they ask or tell, the key lines quoted, what it means; the newest message read in full because the excerpts are cut); (b) what the check added, in a few lines, or one line when it found nothing; (c) where it stands and the next step.
- **The pocket-inbox skill** (*One entry per story*) and the manual (*Inbox Watch*: What goes on the list, For agents) say the same.
- Tested: `inbox-watch/tests/test_label.py` `test_the_briefing_asks_for_the_opening_check` also checks the order (email, then the check, then where it stands).

## [1.113.1] — 2026-11-19 · build 207

Asked for by the owner (2026-11-19): he saw *Pocket Inbox* labels in Gmail on mail that was not on his list. An audit of the live mailbox found the sync otherwise in step: 14 labelled threads, 13 of them open entries, and no open entry without the label. The odd one out was a Gemini marketing email from 2026-10-29. The owner's Gmail filter labels mail sent only to the assistant, and the watcher drops mail in the Promotions tab before the judge. So the thread was brought in, never judged, never listed, and its label stayed for three weeks. Two more promotional threads (a cable supplier's and a software vendor's) had taken the same path. Watcher only; no change to the web app or its build.

- **A hand label outranks Promotions** (`inbox-watch/inbox_monitor/engine.py` `process`, `thread_bundle`). A thread the owner labelled by hand (`incoming`) is judged even when Gmail put it in Promotions. Spam, trash, drafts and chat are still never read.
- **A filter's label on mail the watcher does not read comes off** (`label_sync`, state `dropped`). A filter-labelled thread (`incoming-filter`) in Promotions, spam or trash, or a hand-labelled one in spam or trash, loses the label at the next sync. The thread is never archived for it. The sync log counts these as *never on the list*.
- **An unjudged label is tried again** (`label_sync`, `LABEL_RETRY_S` 30 min). A thread brought in by its label that has left the backlog without a decision and is still unlisted after 30 minutes joins the next check again. A thread Gmail no longer finds (404/403) drops its `incoming` record instead of waiting for ever.
- Tested: `inbox-watch/tests/test_label.py` `test_promotional_mail_labelled_in_gmail` (the hand label is judged, the filter's label comes off and the thread stays in the inbox), `test_unjudged_hand_label_is_tried_again` (not while fresh, not while in the backlog, then brought in). All 117 watcher tests pass.
- Manual: *Inbox Watch* (Your list in Gmail).

## [1.113.0] — 2026-11-19 · build 207

Asked for by the owner (2026-11-19), after the three-day review of 1.109: 56 of 272 stories had more than one entry on the list (94 extra entries, 26% of it), 36 of them while the earlier entry was still open. The watcher merged a new alert only into one that had not gone out yet, so once an entry was on the list nothing but the judge's prose stopped a second one. Learned "Notify: replies from …" rules made the judge write an *Update on …* entry per reply, and each message a Gmail filter labelled became its own entry (7 Indeed applicant entries in four hours). The owner also asked that a conversation started from an alert first gather the rest of the story and leave only one thread labelled.

- **One entry per story** (`inbox.mjs` `openOnStory`, `update`). An alert whose story already has an open alert entry (new or seen) from the same source updates that entry: new text first, the previous text under *Earlier on this entry* (one level, cut to fit), title, links and push from the new alert, the higher of the two priorities, unread again and on top, same id, conversations kept. A different Gmail thread or start link goes into the entry's `merged` list, so an old start link still finds it. `POST /api/inbox` answers `updated: true`, and `pocket-inbox add` prints `updated`. A finished entry is never reopened this way, a used dedupe key is still a duplicate, and `merge: false` keeps separate entries for a job that wants them. Digests and look-aheads are unchanged (their lines already link to open alerts).
- **Merge** (`InboxStore.merge`, `POST /api/inbox/merge`, `pocket-inbox merge <id> --into <entry> | --session <conversation>`). Merge folds another open alert into an entry. With `--session`, the target is the entry the conversation was started from. The merged entry is dismissed with the note *Merged into "…"* and `mergedInto`, and its thread, title, start link and conversations join the target. Feedback carries `mergedInto` and `intoStory`. Restore takes it back out.
- **The watcher** (`engine.py`). `label_sync` reads each open entry's `merged` threads. One the watcher labelled loses the label and is never archived; one the owner labels again by hand is judged as before. `merge_story` links a merged entry's threads to the target story and closes its own story with a note. `briefing_for` asks every alert conversation for the opening check: other mail on the story, then other open entries on the same story, merged with `--session`, and leave an entry that asks for something different. `delivery.py` logs an update in place.
- **Agents** (`inboxInstructions`, the pocket-inbox skill). The instructions line names `merge <other id> --session <this conversation>`. The skill's *One entry per story* section has the opening check. Merging a same-story duplicate is the one change an agent makes to the list unasked.
- **The conversation catches up** (the owner, the same day: "what happens if we've already started a session on an inbox item?"). An entry updated after a conversation started from it, or one that takes in a merged duplicate, keeps the news (`news`, `newsN`, the last 6), and each of its conversations records how much it has had (`sessions[].seen`; `story` for a conversation that came with a merged entry and has not had this entry's story, or was started from an older start link the entry took in). A reply running in that conversation gets the news steered in at once (`inboxSteer`, the same path as a typed message mid-reply). An idle one shows one line under the latest reply, *New mail on this story since you started: …*, with **Bring it in** and **Not now** (`InboxNews` in `public/inbox.js`, the Handoff offer's pattern and classes). Bring it in sends the news (each update's title, text, Gmail link and time, never the earlier text again) as your next message and asks what it changes; nothing starts a reply on its own. `GET /api/inbox/news?session=` and `POST /api/inbox/caught-up` (marks up to the news the message carried, so mail that arrives in between still shows). The conversation that did a merge is not behind on it. A conversation from before this build has had none of the news, which only began with it. The entry's sheet says when its conversation has not had the latest mail, and *Start another conversation* says the one above can catch up instead. `pocket-inbox show` lists the conversations and which are behind.
- Manual: *Inbox Watch* (What goes on the list, Your list in Gmail, For agents).
- Tests: `test/inbox.test.mjs` *1.113.1* (news only once a conversation exists, the catch-up text, caught up to `upTo` with later news still showing, a merge from a conversation, the merged entry's conversation getting the story, a finished entry, the news cap, reload, a conversation from before, an older start link) and the two routes in the HTTP test; *1.113* (update in place, earlier text, priority, threads taken in, dedupe, `merge:false`, finished entries, old start link, merge by session, refusals, Restore, reload, the instructions line) and the CLI in the HTTP test; `test_label.py` (a taken-in thread loses the label and stays in the inbox, a hand label is judged, a merged story joins its target, the briefing asks for the check).

## [1.112.0] — 2026-11-19 · build 206

Asked for by the owner (2026-11-19): he wanted to drag the session tabs into his own order, reported that a new Codex conversation's tab showed no name until he switched to another tab and back, asked that a conversation started from the Inbox but not yet sent keep its own tab instead of being replaced by the next one, and found the Complete card too easy to miss.

- **Drag a tab to move it** (`public/workspace.js` `bindTabDrag`, `moveTab`). With a mouse or pen, a press that moves 6 px picks the tab up; a still press is still a click. On touch a swipe keeps scrolling the strip, and a 350 ms hold picks the tab up. The held tab dims and a 2 px clay bar marks the side it lands on, as the pinned rows in the list do. The strip scrolls when the pointer nears either end. The browser's own link drag is off (`draggable="false"`), and the click that ends a drag is dropped, so a drop never opens the tab. A list refresh during the drag waits until the drop.
- **Groups stay together.** Pinned tabs stay ahead of the others. Moving a pinned tab reorders the pins through the existing `/api/pins/order` (`placePin`), so the list and every device follow; the other tabs keep their order in `pc-open-sessions` on this browser.
- **Keyboard:** Alt Shift [ / Alt Shift ] move the focused tab (or the open conversation's) one place, keep focus on it and announce *Tab n of m*. Listed in Keyboard shortcuts.
- **The 13th tab closes the least recently opened**, not the leftmost (`rememberTab`, shared with the project, file, task, Vault and Inbox views). Tabs saved before 1.112 carry no time and go first.
- **Fix: a tab follows its conversation's name** (`followTabTitles`). A tab saved the title once, when the conversation opened. A new Codex thread is named after its first turn, so its tab kept *New conversation* while the header (which follows the list since 1.29.1) showed the name; leaving and coming back re-saved it. Tabs now take the list's title on every list refresh and save it.
- **A start link opens its own unsent conversation** (`public/app.js` `openStartLink`, `renderNew({slot})`, route `#/new/<start id>`). Asked for by the owner the same day: a conversation started from the Inbox and not yet sent was lost when he started another, because every start link wrote its briefing into New conversation's one draft. Now each link has its own draft, start record (`pc-new-start-new-s-<id>`), briefing, settings (copied from New's when it opens) and attachments, and a tab (`new/<id>`, named after the link's title or the briefing's first line). `NEW_KEY` switches to the draft's key while it shows; the rest of New keeps `NEW_BASE`, and `renderNew` reads its keys once (`NK`, `SK`, `BK`) so a start still being delivered never writes into another draft. Sending it, or a handoff already started elsewhere, clears the draft and closes its tab (`forgetNewSlot`). The plus, a project's or task's **Start** and their briefing rules (1.69.3, 1.107.1) use plain New only, so they never clear a draft. Opening the same link again brings its draft back as you left it; the briefing goes in only while the draft is empty.
- **The Complete card is unmistakable** (`public/app.css`). The owner found the 1.111 card too easy to miss: on the reply's own surface with a hairline it read as one more line of the reply. It now wears the finished green (`--ok`) the tab dot and list row already use: a green wash and edge, a filled green tick badge, **Complete** in green, the outcome in full-contrast text, and **Close conversation** as a filled green button (full width under the outcome on a phone). Same markup and behaviour; no motion.
- Manual: *Desktop and phone* (Tabs, shortcuts), *Conversations* (Start links), *Working in a conversation* (the card). DESIGN.md *Tab reorder (1.112)*, *Complete card*.
- Tests: `test/ui-regressions.mjs` *1.112 Tabs* (drag with the drop mark, a refresh mid-drag, no navigation on drop, a following click still opens, Alt Shift [ ], focus and announcement, least-recently-opened eviction, a Codex tab taking its new name); *1.112 Start links* (two links, two drafts and tabs, edits kept across tabs, the plus and a second link leave drafts alone, reopening a link restores its draft, sending carries the link and closes the draft's tab); the 1.81 start-link test follows the new route; `complete-browser.mjs` checks the card's wash, badge, title and filled button at 1440 and 390.

## [1.111.0] — 2026-11-18 · build 205

Asked for by the owner (2026-11-18): reply buttons cover the turns that end in a decision, but a turn that ends with everything finished looked like any other reply, so he had to read it to learn whether anything was left. An agent can now say so, and one tap closes the conversation.

- **The done block** (`choices.mjs`). The instructions every engine already gets for suggested replies gain a second ending: when the work asked for is finished, checked, and nothing is left to recommend, the agent ends its reply with a fenced `done` block holding one line that states the outcome. `textBlocks` turns it into `{t:'done', text}` and strips it from the text. Pocket checks the claim: reply buttons win over it (whichever came last), a closing paragraph with a question drops it, and only a block at the very end counts (a sources list may follow, as with choices). `POCKET_CHOICES=0` turns both off.
- **The Complete card** (`public/app.js`, `public/app.css`). Under the latest reply, where the reply buttons would be: a tick, **Complete**, the outcome line (or *Nothing left to do*) and **Close conversation**. The whole card is one button. It hides while a reply runs, background jobs run, a question waits or the message box has text, and never shows under an earlier reply.
- **A tap closes the conversation** (`closeCompleted`). Three existing actions: reviewed on every device (so it leaves Attention), `POST /api/session/:id/release` (its process ends now instead of at the idle close), and its tab or pane closes (a beside pane becomes the main view, else New opens; a phone returns to the list). It sends nothing to the agent and deletes nothing. A 409 from the release (work started again) leaves it open with a message. **Undo** in the toast for ten seconds reopens it.
- **The list, the tab and the push say Complete** (`server.mjs` `recordOutcome`, `session-state.mjs` `replyDone`). The outcome is recorded as `{kind:'finished', label:'Complete', done:true, summary}` only when the done block is the last thing the agent did in the turn and no background job is running. The row shows **Complete** and the outcome line until it is read, with a tick button that closes it without opening it (Undo restores the unread state); the push reads *Complete · outcome*. An ordinary reply is still **Response ready**.
- **Toast actions** (`toast(msg, {action, onAction})`). A toast may carry one button; it then stays ten seconds, sits above the message box and takes clicks.
- Also: the side chat drops done blocks as it drops choices; conversation search and the title summariser read the outcome line; `closeMainPane` shares `promoteFirstPane` with the card and opens a promoted view pane by its own address.
- Design: DESIGN.md *Complete card (1.111)*. Manual: *Working in a conversation* (Close a finished conversation), *Conversations*, *Desktop and phone*, *For agents*.
- Tests: `choices.test.mjs` (the block, the refusals, choices winning), `session-state.test.mjs` (`replyDone`), `engine-parity.test.mjs` (Claude, Codex and OpenRouter each record Complete, then Response ready on the next reply), `test/complete-browser.mjs` (the card at 1440 and 390, dark and light, axe, the tap, Undo, the row, a pane, and the cases with no card).

## [1.110.2] — 2026-11-18 · build 204

Asked for by the owner (2026-11-18): a Tailspin Supply email he starred disappeared from his starred mail. He dismissed its alert in Pocket, and the label sync archived the thread with the star still on it. His Gmail Multiple Inboxes section for starred mail searches `in:inbox is:starred`, so the email dropped out of it. 41 starred threads from the last 60 days were outside the inbox. Watcher only; no change to the web app or its build.

- **A starred thread is not archived** (`inbox-watch/inbox_monitor/engine.py` `thread_starred`, `label_sync`). When an entry is finished (Resolved, Not useful, Dismiss, or the tidy pass), the label still comes off. The thread is archived only when no message in it carries `STARRED`. The star is read only for threads that would otherwise be archived, after the new-mail check. When a mail source cannot read labels, or the read fails, the thread stays in the inbox. The sync log reports how many starred threads were kept.
- **Reading a thread's labels** (`mail_gmail.py` `thread_label_ids`: `threads.get` with `format=minimal` under the read-only scope; `mail_connector.py` `thread_label_ids`: from the connector's thread read, cached for the run).
- Tested: `inbox-watch/tests/test_label.py` `test_finished_starred_thread_stays_in_the_inbox`: starred is kept, unstarred is archived, and a source with no label read or a failing read keeps the thread. The test fails with the check disabled. A read-only probe on the live mailbox found the star on the Tailspin thread and none on an unstarred one.
- Manual: *Inbox Watch* (Your list in Gmail; finishing an entry).

## [1.110.1] — 2026-11-16 · build 204

Asked for by the owner (2026-11-16): he looked for Ask someone in the sidebar's Vault panel and it was only on the full Vault page.

- **Ask someone in the sidebar** (`public/vault.js` `railVaultHTML`, `paintRailVault`). The rail's Vault panel shows **Ask someone**, **+ Add** (was *Add secret*; still its name for screen readers and its tooltip, shortened so the three chips fit one row in the sidebar) and **All**. Ask someone is the same chip and icon as the page header and and opens the same sheet (`vaultAskSheet`, which unlocks first when the Vault is locked).
- Tested: `test/ui-regressions.mjs` (the rail's Vault actions read Ask someone, Add, All on one row; Add is named Add secret; Ask someone opens its sheet).
- Manual: *Vault* (Ask someone outside for a secret: where to find it).

## [1.110.0] — 2026-11-16 · build 203

Asked for by the owner (2026-11-16): customers' IT contacts (a QuickBooks review login from a client's accountant, for one) need a safe way to hand over a login without email, phone or chat. A one-time link they type it into, straight into the Vault.

- **Intake links** (`vault.mjs` `createIntake`, `relinkIntake`, `cancelIntake`, `resolveIntake`, `submitIntake`; `intakes` inside `vault.enc`). A link names the item it will fill, its kind and any extra fields, who it is for, what it is, and when it expires (1 to 168 hours, 72 by default). The token is 32 random bytes (`base64url`); only its SHA-256 is stored, inside the encrypted store, and a lookup compares against every link with `timingSafeEqual`. Each link has its own form nonce. Up to 50 wait at once; a link that ended is listed for a week and dropped after 30 days. The name is reserved while a link waits: add, rename, restore and import refuse it (`intake_reserved`). Filling it in stores a new item (`by: intake`, the default policy, `addedIn` from the conversation that asked) and marks the link used in the same write; the audit row names the item, the link and the field names.
- **The page** (`intake-page.mjs`, `public/intake/`; `GET`/`POST /intake/:token`, `/intake/done`, `/intake/theme.css`, `/intake/logo`). Rendered on the server with no inline code under `default-src 'none'` plus same-origin script, style and form action; `no-store`, `noindex`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`. It shows the request's heading, who asked whom, where the secret goes and when the link expires, the fields (masked ones with Show), an optional note and **Send securely**. A post is checked for the link's nonce and for `Origin`/`Sec-Fetch-Site`; an error re-renders the form empty and names the field; success redirects to *Received. Thank you.* and echoes nothing. Opening a link never uses it. A used, cancelled, expired or unknown link shows *This link is no longer active*; a Vault that is off or locked answers 503 *Temporarily unavailable*, keeps nothing and leaves the link open (and sends the owner the usual locked push, throttled). Per address: 60 loads and 15 posts per 10 minutes, 20 unknown tokens an hour; 300 unknown tokens an hour per install. Paths with a token are redacted in error logs. Branding from `POCKET_INTAKE_ORG`, `POCKET_INTAKE_ACCENT` (button ink chosen for contrast, text use darkened to AA) and `POCKET_INTAKE_LOGO` (PNG, JPEG or WebP up to 512 KB).
- **Owner** (`public/vault.js`, `public/app.css`; `POST /api/vault/intake`). **Ask someone** before **Add secret** opens a sheet (name, kind, extra fields, who it is for, what it is, 1/3/7 days) and shows the link once with **Copy**. **Links sent** above the secrets lists waiting links with **New link** and **Cancel**, and ended ones (filled with **Open**). A filled link pushes *<who> filled in <name>* (kind vault) to the item.
- **Agents** (`scripts/pocket-vault.mjs`; `GET /api/vault/intake/wait`). `request <name> --kind --for --note [--from] [--fields] [--expires 72h|3d]` prints the link; `requests`, `relink <name>`, `cancel <name>`; `await <name> [--wait s]` exits 0 filled, 4 waiting, 5 cancelled or expired; `show` on a reserved name prints the waiting link and exits 4. The per-conversation instructions and the `pocket-vault` skill say to send a link instead of asking anyone outside for a credential by email, chat or phone.
- `/intake/` is network-only in the service worker, like `/share/`.
- Tested: `test/vault-intake.test.mjs` (store rules, reservation, relink and expiry; page escaping, no inline code, AA contrast for the brand colours; routes, headers, nonce, cross-site and `Origin: null` posts, no echo, one use, the CLI, the miss limit; a locked Vault answering 503 and the link working after unlock). Rendered at 390 and 1440 wide (form, credentials, error, received, inactive, the Vault view and the sheet) and scanned with impeccable's detector on desktop and mobile: no findings. The preview found that `Referrer-Policy: no-referrer` makes Chrome send `Origin: null` on the form's post, which the origin check refused; the page now uses `same-origin`, and a `null` origin falls to `Sec-Fetch-Site`.
- Manual: *Vault* (Ask someone outside for a secret, branding, the agent commands). SECURITY.md: Intake links. DESIGN.md: Vault intake page (1.110).

## [1.109.0] — 2026-11-16 · build 202

Asked for by the owner (2026-11-16): pushes are now right, but the list still misses mail. An email belongs on the list when it needs action or investigation an agent could help with: a failure or problem, mail like what he investigated with an agent before (unless he marked it Not useful, which should keep it off for good), and mail addressed to him that needs his reply or action. Watcher only; no change to the web app or its build.

- **The list is a work queue** (`inbox-watch/inbox_monitor/prompts/decide.md`). The decision prompt's two questions are now the list, then the interruption. The list test: something is failing or looks like it (also when it is someone else's to fix and nothing shows they have), a person is waiting on the owner, mail like what the owner worked on before, pieces that connect, or anything critical. The line that sent a never-alerted story to `update` is gone. The interruption test is unchanged and says a problem that has run for days is not an interruption unless something changed today.
- **A story that was never on the list says so** (`engine.py` `Store.story_dict`, `Store.ever_listed`). `alerts_sent_to_owner` showed digest lines and list entries alike, so a story that had only ever had digest lines read as already alerted and its failure was followed as `update` for weeks (a backup missed every night for three weeks, a UPS alarming nightly for a month). Each item is now marked `list entry` or `digest line` (an alert held overnight and sent inside the digest is a digest line), and a story with no entry carries `on_list: never`; the prompt lists such a story once, with how long it has gone on. One entry per story still holds afterwards.
- **Not useful is final for a story** (`engine.py` `_process_batch`, `apply_feedback`, `apply_item_feedback`, `restore_story`; `issues.not_useful_at`). It was one learned line the judge could outweigh and a later merge could drop. Now a `notify` or `digest` on a story the owner marked Not useful is recorded as `update` (the decision keeps `blocked`), unless it is `critical`. **Restore** in Pocket lifts it, and so does labelling the mail by hand in Gmail.
- **What the owner did with earlier alerts** (`engine.py` `owner_history`, `sync_worked`; `delivery.py` `inbox_worked`). Every 30 minutes the watcher asks Pocket which alerts the owner started a conversation from (14 days back, whatever became of the entry) and keeps each as a `lessons` row of kind `worked`, a signal `learn()` never reads and that writes no rule. Each thread then goes to the judge with what the owner did with matching mail in the last 180 days: `worked`, `added` (a hand label or Add to Inbox) or `not_useful`, matched by code on the same thread, the same story, or the same kind (the same sender address with a similar subject). The sender alone is not a match: on the mailbox this was tested on, one assistant address had 78 such rows of every kind.
- **To or Cc** (`engine.py` `addressed`, `parse_message`, `thread_bundle`; archive column `mail.addressed`, added to an existing archive on first open). Each message from someone else carries `owner_in`: `to`, `cc` or `none`. Mail archived before 1.109 has none.
- **Digest off means no digest** (`engine.py` `fill`, `decide`). With the morning digest off the judge is told there is no `digest` in the turn; a `digest` answer that arrives anyway is recorded as `update`. Before, such a line was queued and thrown away, so mail the judge thought worth a line reached nobody.
- **Rules box 8,000 → 12,000 characters** (`inbox.mjs` `WATCH.rules`, `schedule.py` `RULES_MAX`, `firstpass.py` `RULES_CHARS`; the learned section `LEARN_MAX_CHARS` 3,400 → 5,000 and `LEARN_MAX_RULES` 20 → 30). The owner asked (2026-11-16) once his own rules reached about 5,200 characters: the learned section's room is 8,000 less the owner's rules, so it had 80 characters left to grow and the next lesson would have made the watcher squeeze existing learned rules. The rules ride along with each decision turn and first-pass call, so a full box costs about 1,000 more input tokens per decision turn (roughly 3% of one) than a full 8,000-character box.
- Tested: `test/inbox.test.mjs`, `test_schedule.py` and `test_label.py` take the new limits. `inbox-watch/tests/test_list.py` (7: Not useful blocks the story and critical passes; Restore and a hand label lift it; started conversations become signals, not lessons; history matches by story and by kind, never by sender alone; digest off; a story says whether it was ever on the list; To or Cc and the archive migration), run in CI with the watcher's other nine test files, which pass unchanged. On the owner's live mailbox, 55 past checks (161 threads, Nov 13 to 16) were rebuilt on a ledger rewound to each check's time and judged again with this code and the owner's rules: of the threads from checks picked for suspected misses, 21 are listed where 1.108 listed 4 (among them automated failure and expiry notices); a random weekend sample went from 2 to 3 and a full Friday from 8 to 10; 1 of the 34 listed was judged worth a push, so the list grew and the interruptions did not; no judge errors in 55 calls. In a second pass over 28 of those checks with the first alerts recorded as sent, no story was listed twice.
- Manual: *Inbox Watch* (What goes on the list, Not useful and Restore, the fourth learning signal, digest off). `inbox-watch/README.md`: The list (1.109). `skills/pocket-inbox`: Not useful.

## [1.108.0] — 2026-11-15 · build 202

Asked for by the owner (2026-11-15): installs are told when Claude Code or Codex has an update; do the same when an install is behind the latest Pocket Code.

- **Pocket Code update notice** (`cli-updates.mjs`, `public/cli-updates.js`, `server.mjs`). The daily 4 a.m. check (and **Check now**) also asks `github.com/bbesner/pocket-code/releases/latest` which release is latest (one `HEAD` request answered by a redirect to the tag; drafts and prereleases never count, only a plain `vX.Y.Z` tag is accepted, and unlike `api.github.com` it has no 60-an-hour per-IP limit, which the maintainer's server was already over) and compares it with the running daemon's `package.json` version. When the server is behind, the top notice names Pocket Code alongside any CLI update (*Pocket Code, Claude Code and Codex updates available. Review*), and the review, now called **Updates**, has a Pocket Code row: installed and available versions, release notes, and **How to update** (the operations guide). Nothing is downloaded or installed; the notice goes once the server runs the release. A failed check keeps the last good result and says so. The check runs even with `POCKET_CLI_UPDATES=0`; `POCKET_UPDATE_CHECK=0` turns it off and `POCKET_RELEASES_REPO=owner/repo` follows a fork.
- **About & updates** button renamed from CLI updates to **Updates**.
- Tested: `test/cli-updates.test.mjs` (announced when newer, the request's URL, method and user agent, no CLI commands or installs, runs with CLI checks off, prerelease and odd tags, other sites and missing redirects keep the last good release, same or older version is not an update, switched off makes no request, the first check waits two minutes after startup), `test/cli-contract-blind.test.mjs` unchanged with the Pocket check off, `test/acp-browser.mjs` (its long-running server has the check off), `test/cli-updates-browser.mjs` (notice wording, the Pocket row with no install control, a Pocket-only notice that clears once the server runs the release; axe at 390 and 1440).
- Manual: *Settings*. Operations guide and `.env.example`: the two new settings.

## [1.107.1] — 2026-11-15 · build 201

Reported by the owner (2026-11-15): Start a conversation in a Conductor project's ⋯ options opened a plain New conversation on Opus 5.5, with nothing saying which project it was in.

- **Fixed: a Start from the sidebar while New was open did nothing visible** (`public/app.js`, `public/projects.js`, `public/tasks.js`). The sidebar's Projects list (and its ⋯ options) is there on New conversation too. Start a conversation saved the project's start and briefing and then set the address to `#/new`, which New already had, so no `hashchange` fired, nothing re-rendered, and the screen stayed a plain New: no project chip, no Conductor chip, an empty box and the saved model. Sending from it would have started an unlinked conversation. The new `showNew()` re-renders New when it is already open; project and task starts use it.
- Tested: `test/project-mode-browser.mjs` opens New with the sidebar on Projects, starts from the ⋯ options there, and checks the project and Conductor chips, the briefing and the lead model. It fails on 1.107.0.

## [1.107.0] — 2026-11-15 · build 200

Asked for by the owner (2026-11-15): offer Conductor mode where a piece of work starts, let a handoff choose it, and explain it wherever it can be chosen.

- **Start a project on New conversation** (`public/app.js`, `public/projects.js`). With Projects on, a **Start a project** chip sits above the setup card. Its window asks for a name (offered from the first line of the message), Conductor mode (Developer mode only, off until switched on, greyed out with the reason when the server has no top model) and, optionally, Done when. **Create project** tracks the card with the chosen workspace as its directory and returns to New: the message is still in the box, the project chip (and the Conductor chip) show, and Send starts the conversation linked to the card. The first message gets the card's closing line (`projectNote`, shared with a card's briefing) so the agent knows which project it is in. Removing the link there leaves the card in Projects.
- **A handoff chooses its start** (`public/app.js`, `server.mjs`). A handoff card from a Conductor or Solo conversation reads **Continues in *project*** with the start as a **Conductor** / **Solo** chip; tapping it offers the other. Start sends the choice as `projectStart`, and `newProjectStart` now lets a `projectStart` that names one replace the handoff's own (the handoff's project still wins over the body). **Review first** carries the project and the chosen start to New, where the project chip says the handoff continues there instead of offering to remove the link.
- **Conductor mode explained in place** (`public/projects.js`, `public/tips.js`, `public/app.css`). An info button sits beside every control that chooses Conductor: the card's switch, **Turn on Conductor mode** in the ⋯ options, Start a project, the Conductor chip's sheet and **Start** in New's setup, and the handoff card's choice. Mouse hover or keyboard focus shows the text as a tooltip (a long tip is wider and keeps its paragraphs); a tap or click opens the same text under the control, so it works on a phone. One text everywhere: what the lead does, what to use it for, what to skip it for.
- **Fixed: Review first opened the link viewer** (`public/links.js`). A click on a start link inside a conversation (a handoff card's Review first, live since 1.96) was treated as a web page and shown in the link view. It now opens New conversation with the briefing.
- Tested: `test/project-mode.test.mjs` (a handoff's `projectStart` override on Claude and Codex, both directions; anything else leaves the handoff's own start), `test/project-mode-browser.mjs` (the info button in each place, closed, open, as a tooltip, and never flipping the control beside it; Start a project with and without Conductor, with no top model, in Assistant mode, with Projects off and at 390px; the first message's project line; the handoff chip, its sheet, Start and Review first).
- Manual: *Projects*, *Working in a conversation*, *Conversations*.

## [1.106.1] — 2026-11-15 · build 199

Asked for by the owner (2026-11-15): a start from a Conductor project looked like an ordinary one, and Conductor mode belongs to Developer mode.

- **New shows the Conductor start** (`public/app.js`, `public/projects.js`, `server.mjs`). The owner started a conversation from a Conductor project and saw his usual model (Opus 5.5) on the model chip with the start choice folded inside the setup, so it read as an ordinary start (the server would have run the lead). Now a **Conductor** or **Solo** chip sits beside the project chip and opens the choice; on New the model and effort chips' **Default** name what the start runs (the lead or Solo's model, at High), and the effort chip says High in Conductor and Solo conversations too. `GET /api/board` adds `conductorStart` (Solo's model per engine and the effort) for that. The project's **⋯** options say **Conductor: *lead* leads** on Start a conversation and add **Turn on/off Conductor mode** (Developer mode).
- **Assistant mode hides Conductor mode** (`public/projects.js`, `public/app.js`, `server.mjs`). The server never ran it in Assistant mode (`projectModeOn()`), but the card and New still offered it there. Now the card shows no Conductor mode switch and no Works in (display, Edit and the Start conversation briefing); saving Edit no longer sends `worksIn` when the field is hidden, so a list saved in Developer mode is kept. New offers no Conductor or Solo choice. `GET /api/board` returns `conductor: null` in Assistant mode. Done when and a step's Passes when check still show.
- Tested: `test/project-mode.test.mjs` (the board names no lead in Assistant mode and names it again after; `conductorStart`), `test/project-mode-browser.mjs` (the New chip and its sheet; Default model and effort for Conductor, Solo and Codex; the options sheet both ways and its Start; in Assistant mode no switch, no Works in, Edit keeps the hidden list, no Start choice, chip or sheet option).
- Manual: *Projects*, *Working in a conversation*.

## [1.106.0] — 2026-11-15 · build 198

Asked for by the owner (2026-11-15): a project should be able to run with the top model as a lead that plans, hands the work to cheaper models and checks what comes back, and the setting should follow the project through every new conversation and handoff. Plan: `docs/plans/project-mode.md`. The lead's instructions follow Anthropic's published guidance for Fable 5.2 (start on Opus for most work, lead at high effort, say what a subagent costs, finish the whole task, report for a reader who did not watch).

- **Conductor mode on a project card** (`projects.mjs`, `public/projects.js`). A card gains a *Conductor mode* switch (off unless switched on), *Done when* (what finished looks like, as something that can be checked) and *Works in* (folders and web addresses the lead may change without asking). A step can carry a pass/fail check, shown as *Passes when*. `pocket-board`: `update --mode conductor|off --done-when "…" --works-in "a,b"`, `task add "…" --check "…"`, `task edit <id> --check "…"`; `status` and `context` print them.
- **A conversation takes its mode from the project it is linked to** (`server.mjs`, `project-mode.mjs`). In a Conductor project, a reply left on Default runs the newest top model offered (Claude: the Fable family; Codex: the newest GPT Astra) at high effort, never above the policy's `maxEffortLevel`; subagents default to one tier down for that conversation whatever the server-wide setting says; the handoff offer comes at 150K tokens, or sooner when the server's own offer is lower; and the lead's playbook joins Pocket's instructions. A conversation is in the mode when it was started in the project, handed off within it, or linked to it through the board (the conversation's project chip, `pocket-board link-session`, `track --session`) while the mode is on; the project is recorded in the conversation's session meta. Switching the mode on leaves conversations that were already linked as they are, so an old conversation does not restart under the top model and re-read its history uncached. The mode is read at every process start, so unlinking a conversation, finishing the project or switching the mode off ends it at the next reply (after a running background job). A model or effort picked for a reply still wins; on New, saved model and effort picks are set aside while the Start control applies, so they do not override the start without being chosen there. Card text is stored on one line (it reaches the lead's instructions). A start whose project link cannot be made (the project is gone, or it already links 50 sessions) starts unlinked with no mode, and `POST /api/new` returns `projectLinkError`, shown as a notice. The first process of a new conversation already has the mode (the link is made before it starts; a new Codex thread is told before it has an id).
- **Solo.** *Start conversation* on a Conductor project offers *Conductor* (preselected) and *Solo*: one model (Claude: the Opus family; Codex: the newest GPT Sol) at high effort doing the work itself, with no playbook. For a small task, where a lead costs more than it saves.
- **Handoffs keep the project and the mode** (`starts.mjs`). A handoff written by a conversation in Project mode links the new conversation to the same project and starts it the same way; the card says so.
- **In the conversation.** A *Conductor* or *Solo* chip beside the project chip; the model menu's Default names the project's lead; picking another model in a Conductor conversation shows a line recommending a handoff, because a model change restarts the lead without its reasoning.
- **Where it does not apply.** OpenRouter conversations (`features.projectMode` is false in `engines.mjs`), Assistant mode, and an install where no top model is offered: the switch is disabled there and conversations start as before. *Works in* informs the lead only; approvals still follow the conversation's permission setting.
- Tested: `test/project-mode.test.mjs` (store, playbook, the first Claude process, Solo, explicit picks, linking later, switching on and off, a link that cannot be made, Codex, no top model, the CLI), `test/project-mode-browser.mjs`, the engine parity and engines tests.
- Manual: *Projects* (Conductor mode, the card, limits, the command reference), *Sessions*, *Conversation*, *For agents*.

## [1.105.1] — Unreleased · build 197

Reported by the owner (2026-11-14): choices showed as a plain code box instead of buttons. The reply had looked something up on the web, and the web-search tool tells the agent to end with a "Sources:" list, which the agent put after the ```choices block. Only a block at the very end counted, so Pocket left it as text.

- **A sources list may follow the block** (`choices.mjs`). When the block is not last, the last ```choices block still counts if everything after it is a Sources/References heading (plain, bold or `#`) and list items that each carry a link. That list stays in the reply text, after the text that came before the block, so it shows above the buttons. Any other trailing text (prose, a heading with no list, an item without a link, a different heading) still keeps the block as text, so an example of the format shown mid-reply stays text as before. Claude, Codex and OpenRouter conversations all go through `textBlocks`, so all three are covered.
- **The instruction says where sources go.** `CHOICE_INSTRUCTIONS`: "put any sources list above the question".
- Tested: `test/choices.test.mjs` (the reply that failed, heading styles, numbered items and bare URLs, and five tails that must stay text).
- Manual: *Conversation* (Suggested replies, For agents).

## [1.105.0] — Unreleased · build 197

Asked for by the owner (2026-11-14): the Inbox finds the right things, but every alert pushed, about 100 a day (491 alerts Nov 9–14, every one a push; 19% led to a conversation). A tenant's bug report or a phone call that went badly belongs on the list; an emergency dispatch or a bill that is past due should interrupt. The list and the interruption are now separate, and the owner chooses the interruption in the sheet.

- **The judge names the urgency.** `inbox-watch/inbox_monitor/prompts/decide.md`: every notify carries `interrupt` (emergency, outage, money, security, waiting, deadline or null) and a `why_now` sentence, from one question: would waiting a few hours make it worse? `validate_story_fields` keeps only those six kinds. Stored on the alert (`push_kind`, `why_now`, `pushed`; added to existing ledgers on start), carried through a merge into a waiting alert.
- **The owner's policy decides.** `engine.push_decision()` at delivery: `push.mode` `all` (default, the old behaviour), `none`, or `urgent`: a critical alert, or one whose kind the owner switched on, at most `perDay` a day and, with `repeat: "worse"`, not again on a story within 24 hours unless its priority rose. Critical ignores the cap and the repeat rule; a look-ahead counts as a deadline. Held alerts released in the morning go through the same decision. `notify` from other jobs takes `--urgency` and `--why-now`.
- **Delivery.** Pocket gets `--no-push` and a new `--why` (stored on the entry as `pushed` and `why`); Telegram sends without a sound; email is unchanged. A channel written before 1.105 gets neither keyword (`takes()`), so custom deliveries keep working.
- **The sheet.** *Push notifications*, under *Your rules* in both modes: *Push* (Every alert, Only what can't wait, Nothing, list only), the six kinds as switches, *At most* and *Same story again*. Settings validated in `inbox.mjs` (`checkWatch`), normalized in `schedule.py` (TOML `[push]`). An open entry says whether it pushed and why.
- Tested: `inbox-watch/tests/test_push.py` (defaults, TOML, each mode, kinds, repeat, cap, critical, look-ahead, old channels, merge); `test/inbox.test.mjs` (settings validation, entry fields); `test/ui-regressions.mjs` (the sheet at 390 and 1440, saving).
- Manual: *Inbox Watch* (Push notifications, the sheet, a check, posting). Skill: *pocket-inbox*.

## [1.104.0] — Unreleased · build 196

Asked for by the owner (2026-11-13): what drives the watcher's usage. Rebuilt from 40 recent decision calls, the new emails were 6% of each call; the rest was background sent with every call: matched stories in full 26%, related mail 18%, the decide prompt 15%, every alert of the last day 15% (about 38 of them), other open stories 9%, the owner's rules 6%, memory 5%. Usage follows the number of calls, not of emails.

- **Only the related alerts.** `inbox-watch/inbox_monitor/engine.py`: `relevant_alerts()` keeps the newest `RECENT_ALERTS_ALWAYS` (5) alerts of the last day and any other whose story key or title shares a distinctive word with the batch's subjects and senders, so mail about something the owner already heard of under another key is still caught. `story_context()` now also returns the batch's words and the too-common ones it computed.
- **Fewer related threads.** `RELATED_THREADS` 6 → 3 (the same-sender threads, up to 3 more, unchanged).
- **Story matching unchanged.** Matching at 2 shared words and at most 4 stories was tested and left out: it dropped the story for an invoice named only in the email body and missed an alert the owner's learned rules asked for. The thresholds are now named constants (`STORY_MATCH_MIN` 1, `STORY_MATCH_MAX` 8).
- **Tested** on 30 past decision calls (103 threads, 22 alerted live), each rebuilt against a copy of the ledger rewound to that moment, run through the live judge settings (Sonnet, medium) in a clean environment: input tokens per call 50,938 → 41,279 (−19%). Same action as the old context 89–92% of threads; two runs of the old context agree 92%. Notify-or-not differed on 4 threads (2 between the two old runs): one more alert that matched what the live watcher sent, one borderline follow-up kept as an update, and a virtual-card payment notice raised from digest to notify (fewer earlier threads showed the earlier cards being processed). `tests/test_process.py` covers the alert filter.
- Manual: *Inbox Watch* (How a check works, cost).

## [1.103.3] — Unreleased · build 196

Asked for by the owner (2026-11-13), the same evening as 1.103.2: the rebuilt learned rules on his install took 2,280 of the new 2,400 characters on the first day, and after he trimmed his own rules (5,460 to 4,092 characters) about 3,700 characters of the 8,000-character rules box were free.

- **`LEARN_MAX_CHARS` 2400 → 3400** (`inbox-watch/inbox_monitor/engine.py`). The room is still `min(3400, 8000 − the owner's rules − 200)`, and the judge is asked for 200 less; an owner whose own rules are long gets less, as before. Up to 20 rules, 300 characters each, unchanged. Roughly 250 more tokens on every email check at the full room.
- Tested: `tests/test_label.py` checks the prompt asks for 3,200 characters when the owner's rules are short.
- Manual: *Inbox Watch* (Learning from your choices).

## [1.103.2] — Unreleased · build 196

Reported by the owner (2026-11-13): the watcher's learn turn said several learned rules reached it cut off mid-sentence. Two losses, both silent: `learn()` clipped every rule at 320 characters, so a merged "Notify: …" rule lost the senders at its end and its evidence; and once the learned section passed 1,800 characters it popped whole rules off the end of the list, which is where new rules go. On a long-used install most of the senders and topics the owner had taught it were no longer in the rules. The judge's full answers were never stored, so the cut text itself could not be recovered; the lessons it came from were.

- **A rule that does not fit goes back to the judge once.** `inbox-watch/inbox_monitor/engine.py`: the answer is measured before anything is cut (`learn_overruns`: a rule over 360 characters, more than 20 rules, more than the room). Any overrun sends the whole answer back with what does not fit and asks for it again, splitting a long rule rather than dropping what it covers. Only if the second answer still does not fit is it cut, and the log now names every rule cut or dropped (`learn: still too long after a second turn; …`).
- **More room, asked for honestly.** The learned section may take up to 2,400 characters (was 1,800) and 20 rules (was 15), still within what is left of Pocket's 8,000-character rules box after the owner's own rules. `prompts/learn.md` now states the limits the code enforces (300 characters a rule, the rule count, the room less a 200-character margin) instead of a fixed 1,600, says to split a rule rather than let a list of senders grow, and to write out whole again any current rule that ends in "…".
- **`learn --rebuild`.** A new `learn` command folds new lessons in now; `--rebuild` folds in every lesson so far (oldest first, with a note saying why) to recover rules an earlier version dropped, and `--dry-run` prints the section it would write. It takes the run lock, keeps the old rules file under `state/preferences-backups/`, and a bad answer leaves the rules untouched rather than setting the lessons aside.
- Tested: `tests/test_label.py` covers the retry, the logged backstop and the rebuild. On a scratch copy of a long-used install the rebuild turned its stored lessons into a few whole rules (longest 213 characters) and brought back most of the lost names; the rest are covered by kind of mail or did not fit.
- Manual: *Inbox Watch* (Learning from your choices).

## [1.103.1] — 2026-11-13 · build 196

Reported by the owner (2026-11-13): an account manager answered the assistant's questions at 1:30 PM and asked it to send the current sheets so he could mark up the numbering. Forty minutes later the tidy pass took the entry off the Inbox as handled ("will send back his numbering after getting the current sheets"), though nobody had sent them. The owner only found it again by labelling the email in Gmail.

- **A request to the assistant keeps an entry open.** `inbox-watch/inbox_monitor/prompts/tidy.md`: the rule *A request to {owner} keeps it open* now covers a request to `{assistant}`, who works for the owner, and says the assistant's earlier reply does not cover a request made after it. *Send me X and I'll do Y* waits on the owner's side until X is sent, so it is `open`, not `handled`. The `open` definition names the assistant too. Requests to other staff are unchanged: a staff member who takes something still makes it `handled`. No code change.
- Checked against the live install (read-only, scratch copies of the ledger, memory left out): the reported entry, rebuilt as the 2:08 PM pass saw it, came out `handled` 3 of 3 times with the old prompt and `open` 3 of 3 with the new one. The last 20 entries the pass took off as handled, each rebuilt as it stood then: 18 unchanged; one moved to `open` because a partner's request to meet had no answer from the owner (right under the existing rule); one differed between the two old runs alone.
- Manual: *Inbox Watch* (Keep the Inbox tidy).

## [1.103.0] — 2026-11-11 · build 196

Requested by the owner (2026-11-11): closing the tab he was on opened the neighbouring tab, which counted as seeing that conversation and took it out of Attention before he had looked at it. And the Inbox's Dismiss read *Hide it here; nothing else changes*, though with the Pocket Inbox label on it already takes the label off in Gmail.

- **Closing the current tab opens New.** The tab X (`[data-close-session]` in `public/workspace.js`) now calls `openFreshNew` with the plus button's route (`#/new`, or `#/` in assistant mode) when the closed tab is the one you are on, instead of moving to the tab before it. Closing any other tab still only repaints the strip. Applies to conversation and view tabs (Projects, Inbox, Tasks and the rest).
- **Dismiss says what it does in Gmail.** The inbox snapshot (`GET /api/inbox`, `pocket-inbox list`) gains `gmailLabel`: `{name}` when the watcher offers the label, can change it and it is on (the owner's setting, else the watcher's default), otherwise `null`. With it set, the row X's tip reads *Dismiss: off your list and out of Pocket Inbox in Gmail*, the sheet's Dismiss line *Off your list and out of Pocket Inbox in Gmail; the watcher learns nothing*, and both confirm *Dismissed. The Pocket Inbox label comes off in Gmail at the next check*. Without it they say *Off your list; the watcher learns nothing*. The watcher's behaviour is unchanged: the row X was already Dismiss, and the label sync already removed the label and archived the thread at the next check.
- Manual: *Desktop and phone* (tabs), *Inbox Watch* (the decision table and the X).
- Tests: `inbox.test.mjs` (`gmailLabel` on by default, off by the owner, unavailable when the watcher can only read, absent without the option); `ui-regressions.mjs` (closing the current project tab lands on `#/new`; the X tip, the sheet line and the X's confirmation with the label on).

## [1.102.0] — 2026-11-08 · build 195

Requested by the owner (2026-11-08): 1.96 added the handoff card, but it only appeared when he asked for a handoff, so long conversations never prompted one. Pocket now offers it, and never hands off by itself.

- **A Handoff button.** `#handoff-open` sits in the toolbar beside Branch on a computer (icon-only when the row is narrow), as an icon in the Working row while a reply runs, and as `#so-handoff` under Branch in Conversation options; `/handoff` uses the same path (`Handoff.send` in `public/sidechat.js`). It sends one fixed request for the briefing and card. While the agent is working the request is queued and runs after the current reply. Text in the box, attachments or an outbox stop it with a toast instead of sending over them. It shows on every engine, OpenRouter included, since handoff instructions go to all three.
- **The size-based offer.** Once the conversation's context reaches the threshold, one line under the latest finished reply (after Try harder) says how large it is, with **Hand off** and **Not now**. It shows only when nothing is running, waiting for an answer or approval, or typed, and not in a conversation already continued in another. Not now is kept per browser (`pc-handoff-dismissed`) by step (`floor(used/at)`), so the line comes back at the next multiple. Past the threshold the context ring takes the existing amber level, and its tip adds "Large enough to hand off".
- **Hand off first, with reply choices.** When the latest reply ends with suggested replies, the line is not shown; a `.choice-handoff` button joins the end of the replies instead (the owner: decide once, not twice). Picking a reply answers the offer for this size. Hand off first, the Handoff button and `/handoff` all add the open replies to the request (`I have not picked one of these options yet: …`, the recommended one marked), so the briefing carries them as the first decision and the new conversation offers them.
- **The setting.** `handoffOffer` in settings: `null` (default 200K), `0` (off), or 150K/200K/300K/400K; anything else is a 400 `bad_handoff_offer`. `handoffOfferAt` in `context-policy.mjs` drops the offer to three quarters of a compaction limit at or below it, so the offer comes before the summary. The effective value is on `/api/me` features (`handoffAt`) and `contextPolicy.handoff`. Changing it restarts no runner. Settings → Context and subagents → **Offer a handoff**.
- Design: DESIGN.md *Handoff offer (1.102)*. Manual: *Hand off to a fresh conversation*, Settings → Context and subagents.
- Tests: `context-policy.test.mjs` (the threshold rule, the setting through the API, no restart); `test/handoff-browser.mjs` (off by default, the offer at 1440 with the amber ring and axe, typing hides it, Not now survives a reload, a continued conversation gets none, the phone sheet at 390 with 44px targets, Hand off sends the request exactly once); `ui-regressions.mjs` (Conversation options order).

## [1.101.0] — 2026-11-08 · build 194

Reported by the owner (2026-11-08): tapping **Mark resolved**, a reminder or a similar closing reply under a finished reply started one more turn, and its one-line confirmation put the conversation back in Attention as Response ready. Closing the tab first did not help, and with the conversation still open it stayed New until a tap or scroll (the engagement rule added for voice mode).

- **A wrap-up reply is reviewed as it finishes.** `recordOutcome` (every engine's turn end) sets the session's reviewed marker (`seen`) to the outcome time when the turn finished, was started by the owner (not autonomous, not a control turn), its request passes `wrapUpRequest` and its reply passes `replyAsksNothing`. The marker is the one `/api/seen` keeps, so every device's list agrees on the next poll and no client change is needed. The finished-reply push is skipped for it on Claude Code, Codex and OpenRouter.
- **`wrapUpRequest(text)`** (`session-state.mjs`): at most 80 characters, no question mark or new line, and either wholly a closing phrase or one that leads with the step and says when or what. Closing phrases: mark/resolve/dismiss/close it or the alert, story, item, task (*Mark the alert resolved*, *Yes, resolve the alert*), not useful, no thanks, no reminder/task needed, skip it, that's all, all set, done, nothing else; a leading *ok*, *yes*, *just*, *no action*, *leave it* and a short reason after a comma (*Mark it resolved, Sam has it*) are allowed. Leading steps: *remind me to/on/at/<day>/<month>/<digit>…*, *set (me) a reminder*, *add/create a task/to-do/reminder to/for…*. A second step (*and*, *then*, *also*, *but*, *after*, *before*, *first*, *next*, *now*) makes it a real request, as do *Remind me what we decided* and *Add a task system to the app*. Checked against two weeks of the owner's own short replies: every closing one counts, and the misses are real requests (*Send it and remind me Monday*, *Commit the fix and resolve the alert*).
- **`replyAsksNothing(msgs)`**: the turn's own assistant messages have text, no reply buttons, no `?` in the closing paragraph, and 1,500 characters or less in all. Any doubt keeps the conversation in Attention.
- Manual: *Sessions* → the Attention bullet.
- Tests: `session-state.test.mjs` (phrases that count and ones that only start like one; replies with a question, buttons or a report); `engine-parity.test.mjs` (Mark resolved is reviewed and an ordinary request after it is not, on all three engines); `server.test.mjs` (the list's `seenAt` covers the wrap-up reply).

## [1.100.0] — 2026-11-07 · build 193

Requested by a colleague and the owner (2026-11-07): the watcher fetched every thread but spam, trash and drafts, so mail Gmail filters archive or file away was judged too (on one test mailbox, about half of a week's judged threads never carried INBOX). Built by a colleague on #226 and rebased here after 1.95.0 shipped.

- **What it reads: a setting.** `scope` `{mode: all | inbox | inbox_labels, labels}` in the Inbox Watch settings (`checkWatch`, `WATCH.scope`; TOML `[mail] scope`, `scope_labels`; `schedule.scope_query`). The default is `all`, so nothing changes until the owner chooses: the searches and the history read are the same as before. The bound applies to the per-check fetch, the first-run baseline, the rebaseline and the blind-mailbox probe; research and archive searches, and a thread the owner labels Pocket Inbox, are not bounded.
- **The owner's replies stay in a narrowed scope.** A reply carries neither INBOX nor the thread's filter label, so a scope alone would hide the way the watcher learns a story was answered. The read of new mail adds `in:sent` (`scope_query(..., sent=True)`); on the Gmail API path a sent message is kept when its thread has more than one message (`Gmail.is_reply`), and on the Claude connector when the search says so (`new_outbound`). A new email the owner starts stays out. Codex's search lists single emails and does not give a thread's length, so there a sent email is read.
- **The label picker.** The watcher lists the owner's Gmail labels once a day (`label_names`, `options.labels` on the heartbeat), from the Gmail API or the Claude transport; a failure keeps the last list and never fails a check. Codex's Gmail app cannot list labels, so there **Add** takes a typed name.
- **A setting group your saved settings predate shows in the sheet.** `inboxWatchSheet` fills `scope`, `tidy`, `firstPass` and `gmailLabel` from the watcher's defaults when saved settings have none. Label chips wrap and size to their names.
- Manual: *What it reads* under Inbox Watch; `inbox-watch/README.md`, `examples/config.example.toml`.
- Tests: `inbox.test.mjs` (the scope setting checked); `test_schedule.py` (defaults, Pocket and TOML forms, `scope_query`); `test_connector.py` (the scope reaches the window search, the baseline and the probe, not the archive search; replies kept and a new email dropped on both paths; a 404 on one thread is not an expired cursor; Everything asks nothing extra).

## [1.99.0] — 2026-11-07 · build 192

### Added
- **Coordination.** A new optional feature, off by default and never in Assistant mode. `#/coordination` lists what is held now (name, conversation, reason, age, who is waiting) and what ended lately; **Release** is one tap, and the holder is told when it next runs. While something is held, one line shows above the conversation list. Holds are advice: nothing stops a deploy, and a real lock keeps doing the enforcing.
- **`pocket-coord` command and skill.** `hold`, `wait [--block --timeout]`, `release [--note]` and `list`. A clash exits 2 and names the holder, reason and age. A name close to an existing one is refused unless `--new` is passed. Holds last 60 minutes by default, 8 hours at most, and renew while their conversation is running.
- **Waking.** On release or expiry Pocket wakes the first conversation that asked to wait, once, through its own queue and in the approval mode it asked with. The sweep runs every 30 seconds (`POCKET_COORD_SWEEP_MS`).
- **Conversation identity on OpenRouter, for Coordination only.** Each OpenRouter process now carries a runner token, so a hold names its conversation on all three agents. The Vault still treats those conversations as terminal sessions.
- New `coordination.mjs`, `scripts/pocket-coord.mjs`, `skills/pocket-coord`, `public/coordination.js`, `docs/manual/coordination.md`; `GET /api/coordination`, `POST /api/coordination/hold|wait|wait/cancel|release|owner-release`.

## [1.98.0] — 2026-11-07 · build 191

### Added
- **Worktrees in the Git panel.** New `worktrees.mjs` lists every worktree of the repository in three groups: In use, Has work and Ready to remove, each row saying why. Ready needs proof: the branch is in the default branch, on a remote, or its pull request merged at exactly this commit. Anything unconfirmed stays under Has work. The list opens first and the groups fill in as folders are checked.
- **Safe removal.** Remove appears only on a Ready row. Its sheet names ignored files that go with the folder and any conversation that started there. Pocket rechecks at confirm, refuses if anything changed, runs `git worktree remove` without `--force`, keeps the branch, and logs to `worktrees-removed.jsonl`. Owner sign-in only: the CLI token gets 401.
- `GET /api/session/:id/worktrees`, `/worktrees/status`, `/worktrees/removal`; `POST /api/worktrees/remove`.

### Fixed
- **A conversation whose folder is gone carries on from home on every agent**, and says so once. Tested against the real CLIs: Claude Code resumes from another folder with history; Codex 0.166.0 kept the deleted folder and every command failed with `No such file or directory`, so Pocket now tells it to resume in home; OpenCode 1.19.4 loads in home. Kept-alive Codex and OpenRouter processes are moved out too. Side chat and Branch fall back the same way.

## [1.97.0] — 2026-11-07 · build 190

### Added
- **The Git panel follows the work.** New `folders.mjs` reads which folders a conversation worked in from its transcript: the folder on each Claude line and the files it edits, the working folder and patch paths in each Codex command. Reads are incremental. The panel opens on the repository of the last edit, then the last folder in a repository, then the starting folder, and its title reads `Working in <folder> · <branch>`.
- **Repository picker** when a conversation touched more than one, up to six, newest first.
- **Also working here** names other running conversations in the same repository, with a link.
- `GET /api/session/:id/folders`. `/workspace` and `/workspace/diff` take `?folder=`, limited to folders the server computed for that conversation.

### Changed
- **Git shows for a conversation that started outside a repository** once it has moved into one.
- **Branch starts in the active folder** and its sheet names it. Checked against real Claude Code and Codex: both fork into a different folder and keep the history.

## [1.96.0] — 2026-11-07 · build 189

Requested by the owner (2026-11-07, Release A of `docs/plans/coordination-worktrees-handoff.md`): a long conversation re-reads everything on each reply, and Branch carries all of it. A handoff carries only a briefing.

- **`pocket-start add --handoff`.** Stores a start link with `kind: 'handoff'`. `--dir` defaults to the folder the command runs in. The command sends `POCKET_RUNNER_TOKEN` as `x-pocket-runner`, and the server works out the parent from that token through `vaultCaller`; a parent named in the body is ignored. `StartStore.add` takes the handoff fields only from the server's own argument.
- **The handoff card.** A reply line holding only one of this Pocket's handoff links becomes a card, a sibling of the file cards, with the title, folder, agent, permissions, the start of the briefing, **Start** and **Review first**. The link stays in the reply, hidden, so copying the reply keeps it. An expired link says so, a link in a sentence stays a link, and a plain start link is untouched. Assistant mode leaves out the folder, agent and permissions.
- **One conversation per handoff.** `handoffOnce` wraps `/api/new`: a claim in memory while it starts (409 `start_starting`), `startedSession` kept in `starts.json` after (409 `start_used` with the id, which the card follows). The claim is released on any failure, so a refused start can be tried again.
- **No wider permission.** The mode is Full access only when the parent and the default are both Full access, otherwise Review actions, and `/api/new` forces Review actions for a handoff that says so, whatever the request asks. A handoff with no proven parent gets Review actions. OpenRouter has no runner token, so its handoffs have no parent and get Review actions.
- **The secret check.** A handoff briefing holding a secret is refused with 422 `secret_detected`; agents are told to name Vault secrets instead.
- **Lineage.** `continuedFrom` is stored on the new conversation; `continuedIn` is worked out from its children. The header line reads **Continued from** and **Continued in**, beside Branch of.
- **`/handoff`** in the Pocket group of the `/` list asks the agent for a handoff. Pocket's appended instructions tell every agent how.
- Tests: `test/handoff.test.mjs` (a forged parent, a bad token, two starts at once, a third, a child that asks for more, a missing folder, the secret check, the CLI); `engine-parity` runs a handoff on all three agents; browser, the card, Start, a second device, a missing folder, an expired link, a link in a sentence, 390 and 1440 with axe.

## [1.95.0] — 2026-11-07 · build 188

Requested by a colleague (2026-11-07): a text from a client through the phone system was judged a digest line, so it never appeared in his Pocket Inbox on its own; when he opened the morning digest it read as one paragraph, and there was nothing he could press on any line to say "this should have been an alert".

- **The digest reads as items.** `inboxText` (public/inbox.js) renders headings, bullets and paragraphs as blocks (`.inbox-h`, `ul`/`li`, `p`) with room between them instead of `<br>`-joined lines; `.inbox-body` is no longer `pre-wrap`. A digest's text may now run to 12,000 characters (`LIMITS.digestText`); alerts keep 2,000, so yesterday's digest is no longer cut off mid-item.
- **Each line has its own choices.** The watcher's `send_digest` (engine.py) sends the digest's lines as `items` beside the text: `{ref, section, title, text, story, gmail, priority}`, `ref` `a<alert id>` (or `t<tidy id>` for a tidied line), `section` held · resolved · worth · tidied. `PocketPush._add` passes them with `--items <file>`; `pocket-inbox add --items <path|->`. `InboxStore` checks and keeps them (`checkItems`, at most 200, each text ≤ 1,200), `act({item})` records an item's decision (`alert`, `resolve`, `not_useful`, `restore`), and `feedback()` lists item decisions as kind `digest-item` with id `<entry>/<ref>` (`ack` takes those ids). The sheet shows the items as cards under their section headings with **Add to Inbox**, **Resolved**, **Not useful**, **Gmail** and **Undo**; `pocket-inbox show` prints each item's ref and `act <id> <action> --item <ref>` decides one.
- **Start a conversation on one line.** `send_digest` mints a briefed start link per open line (`start_link`, `briefing_for`, as `deliver` does for an alert) and sends it as the item's `url`; `checkItem` keeps it (`checkUrl`), and the card's **Start a conversation** opens it the way an entry's does. It sends nothing and is not a lesson: for dealing with that one line now, without a rule (colleague request).
- **Nothing already on the list comes back as a card** (owner request). A line whose story, or Gmail thread, has an open alert entry goes under *Already on your list* as one line linking to that entry (`/#/inbox/<id>`), no buttons; `InboxStore.foldListed` applies it to every digest Pocket stores (section `listed`, `act` refuses a decision on it with `item_history`), and the watcher's `send_digest` composes its text and items the same way from `inbox_open()`.
- **One card per story, one status per story** (owner request). `send_digest` merges lines on the same story or thread into one card, newest first; the digest's text keeps every line. `InboxStore.foldCards` moves an open card to *Already on your list* when an alert on its story arrives after the digest, and carries the card's conversations to the alert; `mirrorToCards` shows the alert's Resolved, Not useful, Dismiss or Restore on the line (acked, so the watcher hears once). `actItem` copies a decision to the same story's card on another digest. So no story is worked in the digest and again in the Inbox.
- **A card has an Inbox entry's choices** (owner request). `dismiss` joins the item actions; the card keeps the conversations started from it (`item.sessions`) and offers **Open the conversation** and **Start another**. A digest may carry 200 cards (`LIMITS.items`, was 40; digests run about 100 lines). Past that, the digest's first line says how many did not fit, and the file in Files has them all. `starts.mjs` keeps 1,600 start links (was 500), so a card's link lasts its 7 days at about 220 links a day.
- **A digest can't fail on its cards.** A failed start link ends link-making for that digest instead of each card waiting out its own timeout; a card Pocket refuses sends the digest without cards; a line with no subject takes its title from its text.
- **A failed Add to Inbox is kept.** `apply_item_feedback` reports whether the alert reached anyone. If it did not, nothing is learned, the decision stays unacked and the next run sends the same alert, once.
- **The morning digest can be off** (owner request). `digestHour: null`, *Off* in Settings → Inbox Watch → Quiet hours and summaries. No digest is sent; alerts held overnight go out one by one when quiet hours end (`release_held(everything=True)`), and worth-knowing lines close as `skipped` (`skip_digest`) so they don't pile up. Look-aheads and the archive's morning prune are unchanged. The Settings note says so when Off is chosen.
- **Add to Inbox promotes the line** (owner request; it was Alert me until this release's look-ahead cards, and the action stays `alert`). `apply_item_feedback` (engine.py) queues a `notify` copy of the digested alert (dedupe `escalate:<id>:<at>`) and delivers it at once, whatever quiet hours say; lifts a low story to normal; and records an `escalated` lesson, which `learn` (prompts/learn.md) treats like a hand-added Gmail label: a rule to alert on that kind of mail. `resolve` closes the story, `not_useful` is the lesson an alert's is, `restore` reopens; a tidied line (no alert behind it) is acked and sends nothing. `apply_feedback(store, dry_run)` now takes `dry_run` so a `tick --dry-run` never sends.
- **A look-ahead reads as cards too** (owner request). `lookahead_cards` (engine.py) makes one card per bullet of the message, so nothing it says is lost: `ref` `c<alert id>.<bullet>`, `section` `ahead`, in the look-ahead's order (`listedLast` keeps it), under the lead line. The prompt (`lookahead.md`) gains one output field, `bullet`, naming the bullet each story is about; reading, research and the schedule are unchanged. Matching on citations alone missed 14 of 71 bullets on 14 real look-aheads, so citations are only the fallback, and a bullet with no story is still a card (Add to Inbox, Not useful, Dismiss; Resolved has nothing to close). A bullet covering two stories is one card on the first. `send_lookahead` takes `items` with the digest's refused-card fallback; card building is guarded, so it cannot cost the look-ahead. A card on a story with an open alert keeps its text and opens that entry (**Open in Inbox**); `cards()` now spans digests and look-aheads, so one story has one status across them. Add to Inbox here teaches nothing (`lookahead_item_alert`; a look-ahead item is a finding, not a kind of mail); the alert is built from `text`, `gmail` and `priority`, which `feedback()` now reports for an item.
- **A look-ahead keeps its whole text.** `textMax` gave only a digest the 12,000 characters, so an Inbox look-ahead was cut at 2,000 (2,863 on 2026-11-07).
- Manual: *A digest's items* under Inbox Watch, the decisions table, *Learning from your choices*; skill `pocket-inbox` (`act --item`).
- Tests: `inbox.test.mjs` (items checked on add, kept on reload, decided one at a time, digest-item feedback and ack, the 12,000-character digest text); `inbox-watch/tests/test_digest_items.py` (the digest carries its items; Add to Inbox sends now, lifts the story and is an `escalated` lesson, and does not send twice; resolve, not useful and restore on an item; a tidied line sends nothing); one card per story, a failed link, the card limit, a failed Add to Inbox, the digest off); `test_delivery.py` (a refused card, an outage); `test_schedule.py` (null is Off); `ui-regressions.mjs` (a card's choices, a story on the list, the Off choice). `test_digest_items.py`'s `__main__` block moved to the end, so its last test now runs.

## [1.94.0] — 2026-11-04 · build 187

Requested by a colleague (email, 2026-11-04, built at the owner's direction): he pins and unpins conversations often, and Pin sat near the bottom of the ⋯ menu.

- **A pin on every row.** `sessionRowHTML` adds a `.pin-toggle` button (`data-pin-toggle`, `aria-pressed`, "Pin …" / "Unpin …") between the row and the ⋯ button, and before the pinned row's grip. Unpinned it is the outline pin in `--faint` at 55% opacity (full on hover or focus); pinned it is the filled pin in `--clay`. 44px square on touch, 36×44 with a fine pointer. It replaces the small pin mark that sat before the project name in the row's meta line; the tab strip keeps its mark.
- **Pin first in Conversation options.** **Pin conversation** / **Unpin conversation** is now the first choice, above *Mark as reviewed* and the groups; **Move pin up/down** stay under Organize. The row button and the menu share `togglePin`.
- Tests: browser, the row pin pins and unpins (state and label) without opening the conversation, and Pin is the first option in the sheet.

## [1.93.0] — 2026-11-03 · build 186

Requested by a colleague (feedback on 2026-11-03, built at the owner's direction): a secret an agent had just stored was hard to find in the Vault, and the approval step was easy to miss. The notification's Allow looked like it worked, and the Vault's own *Allow once* was a quiet chip under a line of names. The owner's call: tapping the notification body opens that request and never approves it; only the notification's Allow does.

- **Finding a secret.** The list is **Newest first** by default, with an **Order** select (A–Z, kept per device, `pc-vault-order`) and **Search secrets**, which matches the name, kind, tags, website and the conversation that stored it (every word must match; "n of m" and a no-match line). A secret under a day old has a **New** mark and "Added … in <conversation>". `vault.mjs` records `addedIn` (session and title) when an agent stores a secret; an owner add or an import has none.
- **Links to a secret.** `#/vault/item/<name>` opens the Vault with that secret's sheet open and its row marked (`.vault-flash`). These links work in replies (links.js routes them to the Vault the way Files links are routed), and a conversation that stored a secret shows a card for it under the next reply (`vaultCardHTML`). The card shows only the name and kind. The pocket-vault skill asks agents to write the name as a Markdown link to `/#/vault/item/<name>`.
- **The request card.** One sentence, *The agent in "…" wants to use **name** for this command* (or *fill … into a web page*), then the command, the folder and when it asked. **Allow once** is a brand-orange button and **Deny** an outlined one of the same size; *Always allow* stays a chip.
- **Notifications.** The push reads "Allow *name*?" with the conversation and the command. The body opens `#/vault/request/<id>`, which scrolls to that request and focuses it; only the **Allow** or **Deny** action answers. When the service worker's answer is refused (signed out, locked, offline, or the request had ended), it opens the request with `?missed=<why>&tap=<allow|deny>`, and the card says the answer did not go through and why. The daemon logs `vault answer request=<id> refused <status>`. An opened request that was already answered, expired or ended when the Vault locked says so, from the owner's new `answered` list in the snapshot (kept for the request's 15 minutes; no values).
- Tests: `vault.test.mjs` (addedIn on agent adds only, dropped on import; the answered list, owner-only, gone after the TTL). Browser: newest-first and A–Z order, search by tag and by several words with the no-match line, the request sentence with an orange 44px Allow, a `?missed=signin` deep link, the already-allowed notice, an item deep link opening the sheet, and the conversation card opening the secret, with no value on the page. The fixture's items are now added an hour apart.

## [1.92.0] — 2026-11-02 · build 185

Requested by the owner: a measurement of four weeks of his Claude Code use found that long conversations, not the models' own writing, used most of his plan (65% of the cost came from requests made after a conversation passed 200K tokens), and that subagents ran on the same model as the conversation that started them. He asked for a context limit and a subagent policy in Pocket itself, for every agent, with a choice of how and when to compact. This release is phase 1 of [the spec](docs/context-policy-spec.md).

- **Policy.** `context-policy.mjs` checks and reads `contextPolicy` (`compaction.mode` `agent` | `limit`, `compaction.limit` 50K–1M; `workers.model` `default` | `tier-down`; `workers.effort`) and turns it into each engine's launch options. The default changes nothing, and saving the default stores `null`.
- **Claude Code.** `spawnRunner` adds `env` to `--settings`: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_CODE_SUBAGENT_MODEL` (`opus` under Fable or Mythos, `sonnet` under Opus) and `CLAUDE_CODE_SUBAGENT_EFFORT`. `--settings` outranks `~/.claude/settings.json` `env`; this was verified on 2.1.316 (a 150K window in `/context`, and a subagent on Sonnet 5.5 at low effort while settings.json said `opus`). The leader is the turn's model, then Pocket's default, then the CLI's. Runner markers record `policyKey`, and a reused process whose policy changed is replaced (`context policy changed`) unless it is running background jobs.
- **Codex.** `thread/start`, `thread/resume` and `thread/fork` carry `config`: `model_auto_compact_token_limit` (85% of the limit), `agents.default_subagent_model` (the newest GPT Sol under GPT Astra, `codexNewestSol`) and `agents.default_subagent_reasoning_effort`. The leader is the turn's model, else `config.toml`'s `model` (`codexDefaultModel`). A session opened with another policy is reopened. This was verified on 0.166.0: a sub-agent with no model ran `gpt-6.1-sol` at `low`.
- **Engines.** The `contextPolicy` feature is true for Claude and Codex and false for OpenRouter: OpenCode's compaction has no token limit, so that comes in phase 2.
- **Settings.** Agents & instance → Context and subagents: Compact conversations, Subagent model, Subagent effort, and a note saying which agents it applies to. Saving restarts idle processes.
- Tests: `context-policy.test.mjs` (defaults, tiers, launch options, validation; over HTTP, the settings round trip, the Claude `--settings` env before and after a change, a Fable leader, a Codex default leader from `config.toml`, and clearing). `fake-claude` records `settingsEnv`, and `fake-codex` records each thread's `config` and `model`.

## [1.91.1] — 2026-10-31 · build 184

Requested by the owner: move Pocket's remaining GPT-6 Sol default, the Inbox Watch Codex judge, to GPT-6.1 Sol.

- **Inbox Watch setup.** `InboxRunner` takes `codexModel` (the server passes `codex.codexSuccessor`, from 1.91.0), and the Codex judge (`gpt-6-sol`) and Codex mail reader (`gpt-6-luna`) it writes into `config.toml` are mapped through it: the newest version of each family that the installed Codex's `model/list` reports. A hard-coded `gpt-6.1-sol` would fail on an older Codex: on 2026-10-31 OpenAI refused GPT-6.1 Sol to codex-cli 0.156.1 (*not supported when using Codex with a ChatGPT account*) while Pocket's managed 0.166.0 ran it. Existing watcher configs are not rewritten.
- Tests: `inbox-runner.test.mjs` (a Codex setup writes the mapped judge and reader models).

## [1.91.0] — 2026-10-31 · build 184

Requested by the owner: the Codex model menu showed GPT-6 Sol as the default (`POCKET_CODEX_MODEL=gpt-6-sol`) and listed it beside GPT-6.1 Sol, GPT-5.6 Sol, Terra and Luna; he wants the newest version of each model only, kept current without a Pocket update, and the same for Claude, where Sonnet 5 and Haiku 4.5 sat beside Sonnet 5.5 and Haiku 5.5.

- **Codex.** `latestCodexModels` (codex.mjs) keeps the newest version of each family from Codex's `model/list`, reading ids as `<maker>-<version>[-<family>]` (`gpt-6.1-sol`, `gpt-5.1-codex-max`); ids without a version (`o3`, `codex-mini-latest`) stay. `/api/codex/models` returns the kept list and `replaced` (old id → successor), and `defaultModel` is the successor of `POCKET_CODEX_MODEL`. A turn naming a replaced id runs its successor (`codexSuccessor`, from the last non-empty list; the list is read 5 s after startup). On this server's Codex 0.166 list: GPT-6.1 Sol, GPT-6 Astra, GPT-6.1 Terra, GPT-6 Luna.
- **Claude.** `successorOf` / `replacedModels` / `currentModels` (models.mjs): a catalog model with a newer version of its family that the managed policy allows is replaced. Replaced models are left out of the picker and of Settings, a saved or `POCKET_CLAUDE_MODELS` list that names one selects its family's newest, `POCKET_CLAUDE_MODEL` follows its family forward, and a turn naming one runs the successor without a fallback notice. Helper calls never pick a replaced model. When the policy blocks the newer version the older one stays.
- **New Claude models.** `claude-catalog.mjs` reads `GET /v1/models` with the Claude Code OAuth token (`~/.claude/.credentials.json` or `$CLAUDE_CONFIG_DIR`, skipped when expired) or `ANTHROPIC_API_KEY`, 2 minutes after startup and then daily. A model newer than every catalog model of its family is added (`addDiscovered`) with the family's `[1m]` spelling and a label from `display_name`, and is kept in `<data dir>/claude-models.json` with `checkedAt` and the last error (also under `claudeModels.found` in `/api/settings`). Only Fable, Opus, Sonnet and Haiku are recognised; a new family still needs a release. `POCKET_CLAUDE_DISCOVERY=0` turns it off; `POCKET_ANTHROPIC_MODELS_URL` and `POCKET_CLAUDE_DISCOVERY_DELAY_MS` are for tests. Checked on this server: the list answers with the subscription token (14 models, newest Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.1), so nothing is added today.
- **App.** A saved pick of a replaced id moves to its successor (`LEGACY_MODELS` is extended with the servers' `replaced` maps); the offline Claude fallback list drops Sonnet 5 and Haiku 4.5.
- Tests: `newest-models.test.mjs` (Codex families, Claude successors and policy, discovery parsing and credentials, HTTP: GPT-6 Sol default and pick run GPT-6.1 Sol; a stand-in model list adds Opus 6 and Sonnet 5.7, moves Default to Opus 6 and survives a restart). `models.test.mjs`, `defaults.test.mjs`, `review-1881-procB.test.mjs` and the Settings browser check are updated for the replaced models.

## [1.90.0] — 2026-10-31 · build 183

Reported by the owner: an email from a customer that only went to the assistant came into his Inbox as *You added this one*, though he had not opened it yet. One of his Gmail filters adds the Pocket Inbox label to mail sent to the assistant alone, and the watcher took every label it had not put on itself for his. He also wants the watcher to learn from what he labels, the way Not useful was meant to teach it what he doesn't want, and to find the pattern rather than remember one email.

- **Filter or hand.** Gmail's history records a label a filter puts on as part of the new message (`messagesAdded` with the label), and one added later as `labelsAdded`. `Gmail.changed_threads` keeps the labels new mail arrived with (`arrived_labels`); the engine stores the threads with a user label (`label_filed`, kept 14 days) and `label_sync` brings a labelled thread in as `incoming-filter` when its mail arrived with the label, `incoming` otherwise. The bundle carries `added_by` (`filter` or `owner`); `decide.md` tells the judge never to say the owner added a filter's thread, and the fallback text reads *Your Gmail filter put this on your list*. Both still notify. Through a connector the watcher cannot tell, so every label counts as the owner's, as before. Checked on a live mailbox: a message that arrived with the label is a filter's; reports labelled by hand afterwards are `labelsAdded`.
- **Learning.** A thread the owner labels by hand and an alert marked Not useful become `lessons` (with what the watcher had done before: its last decision, a first-pass skip, an earlier alert, or nothing yet). `learn()` runs after the feedback and again after the mail is judged when there are new lessons: one judge turn (`prompts/learn.md`, purpose `learn`) rewrites the *Learned from {owner}'s choices* section of the rules file from the current section, the new lessons and the last 30 learned ones, as narrowly as the examples allow, merging and retiring rules and naming conflicts with the owner's own rules in its change log. At most 15 rules and 1,800 characters, and never so many that the file outgrows Pocket's 8,000-character rules box; the old file goes to `preferences-backups/`. A reply with no rules never empties the section (those lessons are set aside as `failed`); an error leaves them for the next check. Not useful no longer appends its own line; the old *From Inbox in Pocket* lines are folded into the learned section at the first learn.
- **First pass.** It reads up to 8,000 characters of the rules (was 6,000), so learned rules at the end of a long file reach it.
- Tests: `test_label.py` (`test_filter_label_is_not_the_owners`, `test_hand_label_after_a_judgement_says_what_the_watcher_missed`, `test_learn_rewrites_the_learned_section`, `test_not_useful_becomes_a_lesson`). A trial on a copy of the owner's state: 105 labelled threads since Oct 21, 22 by the filter and 83 by hand, learned in five calls ($0.42) into 13 rules.

## [1.89.2] — 2026-10-30 · build 183

Reported by the owner: after switching Claude accounts he sent "please continue" to a conversation ("Ask the sales tool, then production deploy") whose agent had left a job waiting for a staging build. Pocket refused it (*Not sent: … background jobs keeping its earlier Claude login*), so the conversation sat for about 50 minutes until the build finished, and the only advice it gave was to start a new conversation. 1.89.1 added a way to stop the jobs; this release no longer asks you to choose.

- **Held, then sent.** A message sent to a conversation whose background jobs hold the earlier login is no longer refused. It goes into the conversation's queue, marked `afterJobs` (202 with `queued`, `afterJobs`, the jobs and the queue item's id), and starts on the current login once the jobs have finished or their process has exited. The CLI usually reports a finished job in a reply of its own; that reply's end starts the message, even when it failed (it ran on the earlier login), and otherwise Pocket starts it after a short wait (`POCKET_AFTER_JOBS_GRACE_MS`, default 5 s). A restart keeps it: a held message whose process ended while Pocket was down starts at startup.
- **Stop background jobs and send now.** The app shows the held message's notice with this button. It starts the queued message with `replaceStaleLogin: true` (`POST /api/session/:id/queue/start`), which closes the retained process as 1.89.1's flag does. In the Queue the item reads *After the background jobs*, the sheet names them, and its button is **Stop background jobs and run it**. A plain queue start while the jobs run is refused (409) and leaves the message queued; it used to mark it *Needs review*.
- **Queue drain.** A reply that ends while the jobs still run no longer tries to start the queued message (that start was refused and the row was left *Needs review*). The 1.89.1 Not sent card's button is gone, since the message route no longer returns that refusal; the route still accepts `replaceStaleLogin: true`.
- **Refusals kept before 1.89.1.** 1.89.1 stopped keeping a refused (4xx) message as its delivery receipt, but receipts saved before it still replayed the refusal on **Retry same message** for up to 7 days (the two conversations this was reported on had five between them). Such a receipt is now forgotten when its message is retried, so the retry runs, with changed options too; accepted, uncertain and conflicting ids behave as before.
- Tests: `delivery.test.mjs` (a stored 409 from before 1.89.1 lets its retry run, once), `claude-login.test.mjs` (held with its jobs and the process kept, a refused queue start leaving it queued, Stop and send on a new process, a finished job starting the held message by itself on a new process), `browser.mjs` (the notice, a free composer, the button's queue start). The new checks fail on 1.89.1.

## [1.89.1] — 2026-10-30 · build 182

Reported by the owner: after a 5-hour limit he switched Claude accounts, and one conversation ("Go port bug batch") would not continue while the others did. At the sign-in it had one background job left, a `tail -f` watcher on a test run that had already finished. Pocket keeps such a process on the earlier login so the job is not cut off, and refused every message until the job ended, which a watcher never does. Retrying did not help either: the delivery receipt replayed the first refusal.

- **Conversations held on the earlier login.** The refusal is a 409 with `code: account_stale_jobs`, names the jobs (up to three, then a count) and says how to go on. A message sent with `replaceStaleLogin: true` closes the retained process (EOF, then SIGTERM and SIGKILL to its process group 3 s apart), which ends its jobs; the reply waits for it to exit and starts on the current login, as any replaced process does since 1.89.0. The app's Not sent card shows **Stop background jobs and send** for this refusal.
- **Retry same message.** A refused (4xx) message keeps no delivery receipt, since nothing was dispatched, so a retry with the same `clientMessageId` is checked again (and may carry changed options). It used to replay the first refusal for a week, even after its reason had gone. Accepted messages, uncertain deliveries and changed content under a used id behave as before.
- Tests: `claude-login.test.mjs` (the refusal's code and jobs, a retry re-checked, the replaced process on the new login, the old one gone), `delivery.test.mjs` (a refusal not kept), `browser.mjs` (the button, the flag and the shared message id). The new checks fail on 1.89.0. `slash-browser.mjs` types its description-search check in one step (`typeUntil`), as the checks around it do; it raced the closing usage sheet on CI.

## [1.89.0] — 2026-10-30 · build 181

The reviewer re-checked his list against 1.88.1 (`dd93e6f`) by reading the code and sent 22 faults plus a private six-item security report, found while bringing Pocket's newer features into his Go port. Each item was tested against 1.88.1 before anything changed: 24 are real (F-9 and F-17 narrower than described), two were already fixed (F-5 in 1.82.0, F-14 in 1.83.0), one is not a fault (F-13) and one is a measured trade-off left as it is (F-21). Every real fault has a test that fails on 1.88.1 (`test/review-1881-*.test.mjs`; the reviewer's ids in brackets). The six security items are GitHub advisories GHSA-7x69-vwp4-vmqq, GHSA-m899-2j2c-4m7f, GHSA-rwg5-2r2c-c2mh, GHSA-pcmm-3r32-jg6p, GHSA-vvfj-fq67-gmr3 and GHSA-j8pf-7jw9-g68r.

- **Security.**
  - A Codex side chat asks Codex which MCP servers it has (`codex mcp list --json`, same binary, `CODEX_HOME` and folder) and switches every one off in the nested override; the regex over `config.toml` missed dotted keys, inline tables under `[mcp_servers]`, single-quoted names, spaces in the brackets, trailing comments and quoted names with dots, so those servers ran in a side chat with approvals off. When the list cannot be read the side chat refuses to start (502, with the reason). [S-1]
  - A Claude side chat pre-approves `WebSearch` only when the conversation is in Full access or `WebSearch` is a trusted action; in Review actions it was pre-approved although the parent asks. `public/sidechat.js` sends the conversation's next-reply mode with the request; the server's own check is the fallback. [S-2]
  - `/api/notify` strips the public address first, then accepts only a single-slash Pocket path with no control characters that resolves to Pocket's own origin (400 `bad_url` otherwise); `//host`, `/\host`, a tab inside and `<public address>//host` passed and opened another site when the notification was tapped. `public/sw.js` opens only same-origin links, whatever the push carried. [S-3]
  - The artifact route, `storedDocument` and `/api/documents/:id/thumb` open the file once (`O_NOFOLLOW|O_NONBLOCK`, `thumbnails.mjs` `openChecked`), judge the descriptor's real path (`/proc/self/fd`) and send, download and render from that descriptor (thumbnails from a private copy); the check was on the name and every later step reopened the path, so a file swapped for a symlink in between was served (reproduced every run for thumbnails, 139 of 3,000 for sends). The documents thumbnail route had no check at all. A file card that is itself a symlink is refused. [S-4]
  - Thumbnails read the format from the file's first bytes, decode only PNG, JPEG, GIF and WebP (the coder is named on the `convert` command, `png:` and so on) and refuse anything else, so a JPEG saved as `.png` still gets a picture while a `.png` holding SVG or PostScript gets none; ImageMagick chose the coder from the content, so those reached the SVG and PostScript coders, and with Ubuntu's default `policy.xml` an SVG pulled another local file into the picture. [S-5]
  - `cf-connecting-ip` counts as the login's address only when the request carries a Cloudflare Access token that verifies or `POCKET_TRUSTED_PROXY=1` is set (new); otherwise the socket address counts, so a direct loopback caller no longer gets a fresh count by naming a new address each try. Vault unlock and restore-key count per signed-in session (a hash of its cookie), with 50 wrong tries an hour across the instance as a backstop for sessions minted without the login's limit (a replayed Access token). `access.mjs` `verify` returns `through` once the token itself checks out. The login counts only wrong passwords (20 an hour; a correct login neither uses nor resets a try), and a session cookie must be exactly `<expiry>.<signature>`: a copy with a suffix was accepted as signed in and would have counted as a new session for the Vault limit. [S-6]
- **Side chats.** Event ids come from a counter that keeps increasing past the 2,000-event prune, and a reconnect older than the kept window replays from the oldest kept event; after the prune every id was 1999, so a reconnect replayed nothing [F-1]. A Codex side chat's Stop has a 20 s timeout and closes the side chat when the interrupt fails or times out; a hung side chat stayed busy and was never idle-closed [F-2]. Both side chat processes lead their own process group, and closing signals the group with SIGTERM then SIGKILL 3 s later whether or not the leader has exited; a child the CLI started outlived the side chat [F-4]. When the daemon exits the groups get SIGTERM at once.
- **Processes.** A Claude process being closed to make way for a replacement gets SIGTERM 3 s after EOF and SIGKILL 3 s later, and the replacement starts only once it has exited, so two CLIs never work on one conversation; an ordinary close (idle, process cap, sign-in change) keeps its 30 s grace before SIGTERM and now gets SIGKILL 3 s after that (it got one SIGTERM and nothing more). The message waiting for the replacement is saved in the follow-up queue, so a restart during the wait runs it instead of dropping it (messages steered in during those seconds are still memory-only) [F-8]. The runner marker records how far the output log was read; a restart reads on from there, so a turn the CLI ran while Pocket was down is finalized as Pocket's own rather than as another app's, and a stale background-job list clears with it [F-9]. The marker records the boot id and start time; adoption checks pid, command line, boot and start time, adopts the newest live process per conversation and stops the others (SIGTERM, then SIGKILL), and never adopts one that was being closed [F-10]. The marker is written before the first prompt, and a failed write kills the CLI and refuses the start ("Pocket Code could not record the Claude process on disk") [F-11]. `closeCodexSession` completes only on a confirmed exit and fails with 423 ("The previous Codex process … has not exited yet") if the process is still alive 5 s after SIGKILL, so no replacement starts beside it [F-12]. A Codex branch records its parent as soon as `thread/fork` returns (`onForked`), not after `turn/start` [F-3].
- **Requests and turns.** A background agent's request still waiting when a reply ends with an After-this-reply message moves into the reply the queued message starts (`handleTurnLine` on the new turn, `carryRequests` as the fallback); `finalizeTurn` returned before carrying it, so the request vanished and the agent waited [F-16]. Subagent output (`parent_tool_use_id`) no longer opens an agent-started reply or clears `controlOnly`, so a conversation whose only work is a background agent reads Working in background and a typed message does not steer past the agent's question [F-19].
- **Reading the transcript.** A plain user line whose `origin.kind` is `task-notification` (or whose text starts with `<task-notification>`) and a compaction summary (`isCompactSummary`) are dropped by the reader instead of showing as the owner's messages [F-6, F-15]; `cache.mjs` `isPrompt` skips the notification too. A steered message with an attachment reads back as its text with file chips (`splitAttachments`, now used by the `queued_command` branch as well), and the page's echo matches the row with the block stripped, so the message shows once [F-17].
- **Lists, pickers, pasting.** List titles are capped at 300 characters (Claude and Codex; the title generator still sees 1,500 and the conversation keeps the full prompt), the duplicate check hashes the whole prompt when the title is cut, and the list route serialises once per poll and caches the JSON and ETag; ten 200 KB first prompts made a 2.0 MB list [F-22]. `readSkillDesc` reads `description: |`, `>`, `>-` and `|-` scalars, only inside the front matter, capped at 90 characters [F-20]. `workspace.mjs` `gitAvailable` applies `rootFor`'s home rule to the session detail's `repo`, so the Git control is hidden for a repository outside home instead of failing with "outside this instance's home directory" [F-18]. `clipboardFile` keeps a pasted image's own extension (heic, tif, bmp, avif, svg, …) and falls back to png only when the browser reports no type [F-7].
- Reviewed before release: an independent read of the whole change found six issues, all fixed here (the cookie-suffix bypass of the per-session Vault count, thumbnails refusing a JPEG named `.png`, an uncaught throw in the replacement start that would have stuck the conversation, the 3 s close steps applying to idle closes, the login limit counting correct logins, and the waiting message lost on a restart); `docs/bug-review-decisions.md` has the batch's rulings.
- Not changed, with the reasons in `docs/bug-review-decisions.md`: F-13 (the "Message delivered." note during `background`) and F-21 (the `inert` toggle on sheets: 27 ms per open-and-close on a 5,377-element page at normal speed, 123 ms at 4× slowdown, against the reviewer's 56 and 451–971 ms; kept for find-in-page and assistive-technology isolation).
- Migration: new optional `POCKET_TRUSTED_PROXY=1` (`.env.example`, `docs/install.md`, `SECURITY.md`); set it only when the port is reachable solely through a proxy that sets `cf-connecting-ip` itself. Behind Cloudflare Access nothing changes; behind a tunnel with neither, login callers share one count. A Cloudflare Tunnel install without Access should set it (the login limit otherwise shares one count across the tunnel). Side chats and thumbnails need no setup. Frontend assets bump to build 181 (`app.js`, `sidechat.js`, `sw.js`).
- Tests: `test/review-1881-{secA,secB,procA,procB,reader,misc}.test.mjs` (38 tests: one per item, plus the side chat refusal, the `<public address>//host` bypass, the Vault cap, the suffixed cookie, a JPEG named `.png`, correct logins not counting, the 30 s idle grace and the saved waiting message; F-13's passes and F-21's measures with `POCKET_PERF=1`), fixtures `test/review-1881-stubborn-claude.mjs` (a CLI that hangs on EOF or ignores SIGTERM), `test/review-1881-slow-codex.mjs` (holds back one `turn/start`) and `test/review-1881-sheet-perf.mjs`. `test/fake-codex.mjs` answers `mcp list --json` (`FAKE_CODEX_MCP_LIST=fail` fails it); `test/branch.test.mjs` expects the nested override; `test/vault-key.test.mjs` uses a second session instead of a header; `test/title-settings.test.mjs` moves off port 18661, which `test/codex-session.test.mjs` also used (the one flaky failure in two full runs).

## [1.88.1] — 2026-10-29 · build 180

Reported by the owner: sessions with reply cards waiting (the "Phone agents tunnel probe failures" and a customer's Inbox Watch alerts) were not in the Attention tab.

- **Response ready survives the CLI's exit write.** When its process exits, the Claude CLI appends untimestamped bookkeeping lines (`cost-state`, `last-prompt`, sometimes `ai-title`, `atis-latch`, `mode`) to the transcript. Pocket closes a process after `POCKET_IDLE_CLOSE_MS` (one hour) or, under `POCKET_MAX_PROCESSES` (8), as soon as another conversation starts: at 15:29 a burst of Inbox Watch alerts closed `df09b314` 11 s and `e7774d1f` 25 s after their replies. `sessionState` dropped any outcome older than the transcript's mtime by more than 5 s, and the watcher flagged the write as Activity elsewhere, so an unopened reply became Recent and left Attention. Every message line carries a `timestamp`; bookkeeping lines carry none. `quietSinceOwned` now asks `foreignTurns` (the check runner reuse already trusts) whether any user or assistant line follows our last turn's recorded size, cached per mtime; if none, the outcome stands and the watcher ignores the write. A turn from a terminal or code-server still replaces it.
- Migration: none. Outcomes in `session-meta.json` that were hidden this way come back: on this install 492 rows return to Response ready, 11 of them unread and in the list (Oct 24 onward), which show in Attention once; Mark all reviewed clears them.
- Tests: `test/fake-claude.mjs` appends `cost-state`/`last-prompt` when its input closes, like the CLI. `test/review-fixes.test.mjs` closes a finished session through the process cap, moves its mtime a minute on, and expects Response ready in the list and the conversation (not Activity elsewhere), then a terminal user line ends it; fails on 1.88.0 with `observed`. `test/session-state.test.mjs` covers `quietSince`.

## [1.88.0] — 2026-10-29 · build 180

Requested by the owner: "there are so many models in OpenRouter, we need a search feature built into the model search."

- **Find box in the OpenRouter model menu.** `sheet()` takes `{ search: 'models' }`; the model chip passes it when the menu has more than 12 rows (OpenRouter's live catalog offers about 390 tool-capable models; Claude's and Codex's menus stay as they are). Every word typed must appear in the row's name, line or id, so "kimi 3.1" finds Kimi K3.1 Pro and "moonshotai" finds the maker's models; rows keep their order, so Default and Tested stay first. A status line (`role="status"`) says "10 of 392 models" or "No models match “…”". Enter picks the first match, Down and Up move through the matches and back to the box, the first Escape clears the box and the next closes the menu. The box sticks to the top while the list scrolls and the current pick is scrolled into view. On a touch screen the box is not focused on open, so the keyboard does not cover Default and Tested.
- Migration: none. Frontend assets bump to build 180.
- Tests: `test/acp-browser.mjs` adds 12 catalog rows and checks the box: no keyboard on open at phone size, two-word match with its count, the empty state, Escape clears without closing, Enter picks the first match. Rendered at 390 px and 1280 px against the live OpenRouter catalog (392 models); the impeccable detector found nothing on the sheet (its three findings are app-wide and predate this change).

## [1.87.0] — 2026-10-28 · build 179

Requested by the owner: compare Codex with Claude Code the way OpenRouter was compared (audit in Files, "Codex feature parity audit (Oct 28)"), and keep parity from now on.

- **Changed files with diffs.** Codex's `fileChange` items carry `{path, kind, diff}`; Pocket kept only a label of the last two path segments ("dir/file +2 more"), so Changes listed files with empty bodies (the `diffless` flag was never read). Edit lines now keep full paths (`paths`) and each file's diff (`changes`, 40 KB per file), which `/changes` returns as unified diffs and the view draws; the diffs never travel with the conversation (`forClient`). Results, file cards and auto-keep read every path. OpenRouter edits carry ACP's `diff` content (old/new text) the same way.
- **Usage-limit auto-resume for Codex.** A `usageLimitExceeded`/`rateLimitExceeded` error (`TurnError.codexErrorInfo`) schedules the resume for the full plan window's `resetsAt` (read fresh with `account/rateLimits/read`), shows "Waiting for usage reset", pushes when it stops and when it picks up, and resumes through the shared retry marker (it survives restarts) on the conversation's own engine, at most three times; a message you send cancels it. `stateFor` shows the wait for every engine. OpenRouter's 429s ("retry after") take the same path.
- **Commands.** `/compact` (`thread/compact/start`), `/review [base branch | commit <sha>]` (`review/start`, inline; the review's findings are the reply), `/recap` and `/context` in Codex conversations, under a "Codex" group in the / list.
- **Plan checklist** from `turn/plan/updated` (kept in the transcript cache per turn), Plan first's `plan` items as text, attachment chips on Codex messages, a Codex subagent's activity (its own thread, once confirmed to be the conversation's), trusted read-only actions for Codex and OpenRouter commands in Review actions (audited, as Claude's), the reply's tokens under it and in the push, a note on `model/rerouted`, "5-hour" / "Weekly" windows and the cache block in the Usage sheet, Codex command lines without the shell's quotes, and the trusted-actions text naming all three agents.
- Not changed: Codex 0.156 offers its model no plan tool (`update_plan` "isn't available", verified on gpt-6-astra), so the checklist shows only when Codex sends plans; Plan first's plan arrives as reply text. "Working in background" stays Claude-only. Stop all replies remains Claude's account-switch control.
- Migration: none. Frontend assets bump to build 179.
- Tests: `test/engine-parity.test.mjs` adds five checks on all three agents (plan checklist, Changes with what changed and no diff on the phone, usage limit → waiting → resumed, trusted command without a card, cost or tokens under the reply and `/compact` reaching the agent); 40 checks, one of them fails with Codex's plan handling removed. Fakes: Claude `__PLAN__`/`__EDIT__`/`__LIMIT__`; Codex `__PLAN__`/`__EDIT__`/`__LIMIT__`/`__CMDAPPROVAL__`, token usage, `account/rateLimits/read`, compact and review turns; OpenRouter `__PLAN__`/`__EDIT__`/`__LIMIT__`. `test/slash-browser.mjs` expects the Codex group; `test/acp-browser.mjs` checks a unified diff draws as removed and added lines. Verified on the real Codex CLI 0.156.1 (the owner's ChatGPT sign-in): Changes showed `+hello` and `-hello / +hello world` for notes.txt with full paths, tokens under the reply, `/compact` ran as Codex's compaction, Plan first's plan showed as text.

## [1.86.1] — 2026-10-28 · build 178

- CLI upgrade status now flags every Claude Code and Codex conversation still using an older process, with its title, old version and working/idle state. Idle processes can be released immediately; stopping active work requires an explicit confirmation and the next turn uses the selected CLI. Pocket does not restart the service to switch versions.
- The update notice remains visible until older processes have switched.
- Migration: none. Frontend assets bump to build 178.

## [1.86.0] — 2026-10-28 · build 177

Requested by the owner after comparing OpenRouter conversations with Claude Code and Codex: his message was hidden until the reply, there were no question cards or reply buttons, "and any time we add features, they should always apply to all sessions, not just one model's sessions."

- **One engine layer.** Features reached the agent through `isCx(id) ? codex : claude` branches, so a third agent fell into the Claude path (a message queued with After this reply ran on Claude) or was skipped. `server.mjs` `ENGINE_OPS` / `engineOf(id)` gives each agent's turn, folder, transcript, existence check and queued start; the queue, Results, Search, changes, the Git panel, questions and the conversation checks go through it. `engines.mjs` lists per agent the features it lacks (`features`: steer, sideChat, branch, planMode, autoModel, awaySummary, subagents, connectors), served at `/api/engines`, and the app hides those. `pocketInstructions(engine, id)` is the one source of Pocket's instructions for all three.
- **OpenRouter parity.** Your message shows while its reply runs (`withPendingUser`, history read up to the live reply). Pocket's instructions reach it: each OpenCode process is started with Pocket's config merged over the user's (`OPENCODE_CONFIG_CONTENT`, verified merged live): an instruction file rewritten before every request (OpenCode reads it per request, verified), ask-first permissions, the OpenRouter key from the environment, and Pocket's question tool. Questions: `acp-ask-mcp.mjs`, an MCP `ask_user` tool in Claude's AskUserQuestion shape, posts to the daemon on loopback under a key only that process holds and polls for the answer; the question lands in the same question inbox as Claude's and Codex's (OpenCode's own question tool, `OPENCODE_ENABLE_QUESTION_TOOL`, waits on an answer ACP cannot carry, verified). Reply buttons (`textBlocks` on OpenRouter text), checklists from OpenCode plans, attachments (paths in the prompt, images as ACP image blocks), Plan first (OpenCode's plan mode), Stop as a stop (the queue waits, no "Ready" push), approval cards showing the command or files, the context meter (`usage_update` used/size), the `/` list with OpenCode's commands, a stall watchdog, idle OpenCode processes closed (`POCKET_ACP_IDLE_MS`, 20 min) and counted in the process limit, Release, and a reply running at a restart recorded as stopped. Split panes, open tabs, in-app links and the agent filter keep OpenRouter conversations; project and task resume, the question banner and the permissions sheet name OpenRouter.
- **Claude:** a message queued in the first moment of a new conversation, before its transcript is written, is no longer refused.
- Migration: none. Frontend assets bump to build 177. `~/.config/opencode/opencode.json` permission settings are no longer needed (Pocket supplies them; your own config is kept).
- Tests: `test/engine-parity.test.mjs` (new): the real server with all three agents' fakes, the same eight checks on each (your message while the reply runs, instructions, reply buttons, a queued message on the same agent, Stop and the queue, a question card answered, attachments, Git/Results/Search); the old two-agent queue dispatch fails it. The Codex fake gains reply buttons, a question and its thread folder; the OpenRouter fake gains __SLOW__/__HANG__/__CHOICES__/__QUESTION__ (calling Pocket's real ask tool) and records its instructions and attachments. `test/acp-browser.mjs` adds your message at once and after a reload, reply buttons, a question card answered from its buttons, Plan first, and Side chat, Branch and Steer hidden. Verified on real OpenCode 1.19.4 with DeepSeek through OpenRouter: the model used Pocket's question tool (a card with Red and Blue, answered, "You picked blue.") and ended a choice with reply buttons (Deploy now / Wait until tomorrow).

## [1.85.1] — 2026-10-28 · build 176

- **Inbox Watch: a labelled email folded into another's entry follows that entry.** The owner labelled both copies of a contact's reply (his and the one sent to the assistant only); the judge folded the second into the first's alert (`merge_alert`), the Pocket entry linked only the first thread, and when the tidy pass finished it, the first lost its label while the second kept it as `judged` in `label_sync` for good, never on the list again. A thread folded this way is now recorded as `with:<alert id>`: in step while that alert's entry is open, its label comes off when the entry is finished, and if the alert never reaches the list (failed, dry run) it is judged afresh. An owner-added alert's dedupe key also carries the run, so labelling a thread again after its entry was finished brings it back even when its newest message was already alerted on.
- **Inbox Watch: the tidy pass leaves a restored entry alone.** An entry the tidy took off and the owner restored went back to the tidy judge, which would take it off again; such entries (an acted, non-open verdict in `tidy_log`) are now skipped.
- **The Inbox opens as a tab.** `renderInbox` never called `rememberOpenView` and `currentView()` did not know `inboxView`, so on a computer the Inbox list had no tab, no close button and no Back, and its sidebar button did nothing (`#railtog` unbound). It is now a tab like Tasks and the Vault. The rail's "N more in All" link counted finished entries but opened the Open list; it now reads "N finished" and opens Done.
- Tests: `inbox-watch/tests/test_label.py` (`test_folded_thread_follows_its_entry`), `inbox-watch/tests/test_process.py` (`test_two_labelled_copies_share_one_entry`, `test_tidy_leaves_a_restored_entry_alone`). The manual's Inbox Watch page covers both behaviours.

## [1.85.0] — 2026-10-28 · build 175

- Codex child-thread events no longer end the parent conversation or overwrite its turn ID. This fixes a conversation appearing finished while its agent is still working, reported during this build.

- Daily CLI release checks at 4 a.m. in the owner's time zone, with daylight saving support and one catch-up check after downtime. A notice opens release notes and explicit selection of Claude Code, Codex, or both.
- Upgrades install exact approved releases in separate directories and check their version and headless startup protocol before selecting them. The browser may close while the job runs. Previous installations remain available for tested restoration.
- Running conversations retain their process; an idle conversation reopens on the selected CLI on its next turn. Claude background jobs prevent reopening. Recorded binary paths survive daemon restarts.
- Interrupted upgrades do not retry or activate themselves. Failed checks retain prior discovery; partial upgrade results name which CLI completed. Custom binary overrides remain externally managed.

## [1.84.2] — 2026-10-28 · build 174

Reported by the owner after testing 1.84.1: Full access still asked permission for everything, and no reply showed its cost. He asked for the session to be checked for anything else; it showed the agent's work was invisible while it ran.

- **Full access.** `startAcpFromApi` never passed the reply's permission mode, and OpenCode is configured to ask (`permission: ask`), so every command and file read under Full access waited for Allow. The turn now carries `approvalMode`; with `full`, `session/request_permission` is answered allow at once (as Claude's `bypassPermissions` and Codex's `approvalPolicy: never` run). Review actions is unchanged.
- **The cost line.** OpenCode sends `usage_update` with the session's running cost (`cost.amount`, USD) after each model step, and nothing on `session/load` (both verified live). The reply's `result` now carries `cost` (the change across the turn, rounded to OpenCode's nine decimals), `duration_ms` and `cache.hit` (`cachedReadTokens` share of input). The running total is kept per conversation (`acpCost` in session meta), so a reopened session's next reply is right; with no known starting total (a conversation from before this version) there is no cost line rather than a wrong one. The app shows costs under a cent to four decimals (`$0.0013`, not `$0.00`).
- **What the reply is doing.** OpenCode's `tool_call` and `agent_thought_chunk` updates were dropped by the app. Each tool call is now an assistant ledger line once its command or path is known (live, OpenCode announces a call with only its folder and sends the command a moment later, so a call's updates are merged by id) (`Bash`/`Read`/`Edit`/`Search`/`Web`, with the command or path, the same `{t:'tool'}` blocks Codex uses), thinking becomes a `Thinking` line, and the text before a tool line is shown as its own message, so a turn reads in order. `messagesFromEvents` builds the same blocks from the `session/load` replay, so they are there on reopen.
- Migration: none. Frontend assets bump to build 174.
- Tests: the fake ACP agent thinks, titles its tool call with the command, keeps a running cost with the session and reports usage, and can take a while (`FAKE_ACP_DELAY_MS`). `test/acp.test.mjs` (Full access vs Review, live thinking/tool/text order with cost, time and cache, cost across turns, a reopen with and without a known total; the history test now expects tool and thinking blocks), `test/acp-http.test.mjs` (Full access over HTTP with per-reply cost and the saved total), `test/acp-browser.mjs` (the ledger lines live and after reload, the `$0.0021` cost line, a Full access reply with no banner). Each new check fails with its fix removed.

## [1.84.1] — 2026-10-28 · build 173

Reported by the owner on the first real use of the OpenRouter engine: the conversation said idle with Stop showing and nothing happened, and there was no way to set the effort.

- **The reply runs on the model you picked.** The model rode on `session/prompt`, which OpenCode ignores, so every OpenRouter reply since 1.84.0 ran on OpenCode's own default (`opencode/big-pickle`, its free hosted model) while Pocket showed DeepSeek. OpenCode takes the model and its effort as session config options; `acp.mjs` `applyAcpConfig` now sets both with `session/set_config_option` before every prompt and **fails closed**: a model OpenCode does not offer, or does not confirm, stops the reply with the reason before any prompt is sent. It is set on every turn because OpenCode reopens a session on its default model.
- **Approvals show.** `stateFor` looked for a turn only among Claude and Codex turns, so a waiting OpenRouter conversation reported `idle / Recent`; the approval event painted the banner and the list refresh that followed hid it again. It now reports `Needs approval` (and Running) like the other engines.
- **Effort for OpenRouter.** The effort chip lists the levels OpenCode offers for the chosen model (None, Minimal, Low, Medium, High, X-High, Max as the model has them; `probeAcpEfforts` reads all ~360 models in well under a second, at start-up and every 6 hours, in `data/acp-probe`, which the conversation list hides). No chip for a model without an effort setting; a level the model lacks goes back to Default, in the app and on the server. `/api/acp/models` carries `efforts` per model and `defaultEfforts`.
- Migration: none. Frontend assets bump to build 173. An install that turned the engine on should check its `OPENROUTER_API_KEY` is live (see the manual's OpenRouter section).
- Tests: `test/fake-acp.mjs` now keeps model and effort as per-process session config options, the way OpenCode 1.19 does (probed live), and records what each prompt ran on. `test/acp.test.mjs` (the model and effort reach the runtime, Default and missing levels, a reopened session, three fail-closed cases, the effort probe, the hidden probe folder), `test/acp-http.test.mjs` (Needs approval in the chat and the list, effort over HTTP), and the new browser test `test/acp-browser.mjs` against the real server (effort chip per model, the banner staying up through the list refresh, Allow, the reply, reopen). Each new check fails against the 1.84.0 code. Verified once against real OpenCode 1.19.4 and DeepSeek through OpenRouter: OpenCode recorded `openrouter/deepseek/deepseek-v4.1-flash-1017`, variant `high`, $0.0034.

## [1.84.0] — 2026-10-28 · build 172

- **OpenRouter engine (opt-in).** A third agent beside Claude Code and Codex for OpenRouter models paid by the token with your own key (DeepSeek V4.1 Flash and others). Off unless the server has OpenCode installed, an `OPENROUTER_API_KEY` and `POCKET_ACP_ENABLE=1`; OpenCode's permissions must be set to ask. In the app it is an **Agent** choice on New conversation with a tested/experimental model menu from OpenRouter's live catalogue; replies, approvals, the list, reopening and continuing all work. Questions come as text, no reasoning-effort chip, no Plan first, no Google connectors. Built across engine registry, session-engine-config, the ACP adapter (`acp.mjs`), the OpenRouter catalogue, server dispatch and the picker UI. Server files: `engines.mjs`, `session-schema.mjs`, `acp.mjs`, `openrouter.mjs`, `server.mjs`, `public/app.js`, `public/workspace.js`. New env: `POCKET_ACP_ENABLE`, `POCKET_ACP_CMD`, `POCKET_ACP_ARGS`, `POCKET_ACP_MODELS`, `POCKET_ACP_MODEL`, `POCKET_ACP_TURN_TIMEOUT_MS`.
- Flaky-test hardening: the background-subagent approval test, the subagents agent-detail re-render, the `/usage` slash picker, and the subagents Retry click no longer race async state.
- Migration: none. Frontend assets bump to build 172, so open browsers refresh to the new UI. The engine is off by default; installs without it enabled are unchanged.

## [1.83.1] — 2026-10-28 · build 171

Reported by a colleague: Inbox Watch through the claude.ai Gmail connector had seen no new mail since Monday Oct 27 about 2 PM EDT, with status healthy; about 58 threads were missed, one of them an urgent client thread.

- **The connector reads new mail again.** Since 2026-10-27 the claude.ai Gmail connector's `search_threads` answers a bound in Unix seconds (`after:1793178247`) with no threads and no error, while `after:2026/10/27` and `newer_than:1d` still work. `ConnectorMail` now sends every time bound in the date form (`date_form` in `mail_connector.py`): `after:` a day early, `before:` two days late, so the window is wide in any mailbox time zone; `connector_seen` skips the mail already seen, and a judge's lookup (`before:<until>` from `run_lookups`) is clipped to its time bound by the archive as before. `changed_threads` reads pages newest first and stops at the first page with nothing unseen, so a quiet check is still one call. The first check after the update catches up the mail missed since the day before the last cursor (up to 200 threads, spread over the following checks by the backlog). A watcher on the Gmail API (`mail.provider = "gmail"`), which takes both forms, was not affected.
- **A blind search is a failure, not a quiet day.** A check that finds no threads at all while `newer_than:1d` finds some counts as blind; the third in a row fails the check with `the mail search is blind: after:… found nothing in 3 checks while newer_than:1d finds N thread(s)`, which the Inbox shows as *Inbox Watch couldn't check your mail*, and the third failed run sends the usual push. A check that finds mail, or a probe that finds none, resets the count. The probe runs only when the window search came back empty.
- Migration: none. No frontend change: open browsers keep build 171. `mail.sqlite` gains `connector_meta` (the blind count) on the first check.
- Tests: `inbox-watch/tests/test_connector.py` (the fake connector now answers the seconds form with nothing, as the real one does, and pages; date bounds and their margins, paging that stops at seen mail, the blind check and its reset, a quiet mailbox is not blind).

## [1.83.0] — 2026-10-28 · build 171

Requested by the owner: typing `/` should open a searchable list of the commands, like the terminal, with the most useful ones in it.

- **The / picker.** Typing `/` at the start of the message box opens a grouped list in a conversation and on New conversation (it was a conversation-only list of the first eight skills, alphabetical, with no keyboard). **Claude Code**: the built-ins that work through Pocket, curated in `SLASH_CLAUDE` (`/compact [focus]`, `/context`, `/recap`, `/init`, `/code-review [level]`, `/security-review`, `/simplify`, `/mcp`), shown only when the CLI lists them. **Pocket**: actions that run in Pocket and send nothing (`SLASH_POCKET`: `/btw`, `/branch`, `/new` in this folder, `/model` and `/effort` open the chips' choices, `/usage` opens Plan usage). **Skills**: the installed skills, as before, plus plugin skills (`plugin:skill`). Names are matched first (whole name, start, a word in it, anywhere); descriptions only when no name matches. The best match is selected; ↑/↓ move, Enter or Tab pick, Escape closes; a tap picks on a phone. A command that needs nothing more is sent when picked in a conversation; the rest are typed in with a space. While a reply runs only the Pocket actions that make sense then (`/btw`, `/branch`, `/new`, `/usage`) are offered. On New conversation only what works without a conversation is offered, and picking types it in. Codex: Pocket actions and skills (a skill is typed as its skill line). Listbox semantics: `role=listbox` with groups and options, `aria-activedescendant` on the message box. The developer placeholder reads **Reply, or / for commands**; Assistant mode keeps **Reply…**.
- **The CLI's own list.** The daemon keeps the `slash_commands` the Claude CLI reports on its `init` line (`cliSlash`, newest wins, internal `_` names dropped); `GET /api/commands` returns it as `available` (null until a reply has started since the daemon did) and adds plugin skills that are not on disk. Probed against the real CLI headless: `/context`, `/usage`, `/compact`, `/recap`, `/model <name>`, `/effort <level>`, `/rename`, `/mcp` answer with no model call; `/fast` is unavailable in the SDK, `/config` and `/clear` are not offered.
- **Commands read back after a reload.** A built-in's answer arrives live as a synthetic assistant message but is saved as a `system`/`local_command` line, which the transcript reader dropped, so `/context` read back as nothing. `normalizeLine` now shows it as the reply, and a command saved as `<command-name>` tags reads back as typed (`/hello there`). `isMeta` user lines (a skill's own instructions, image placeholders) are no longer shown as the user's message; a message from another session and a safety stop notice still are.
- Migration: none. Open browsers load build 171 at their next reload.
- Tests: `test/runner.test.mjs` (the CLI's list in `/api/commands`, a plugin skill, a command, its output, a skill's arguments and a meta line read back). Browser: `test/slash-browser.mjs` (groups, the CLI filter, matching and narrowing, arrow keys with wrap, Escape, Tab and Enter, a command sent at once, a Pocket action, no match, a 44px full-width tap target at 390, `/effort` by tap, Codex, New conversation; axe at 1440 and 390); `test/ui-regressions.mjs` (Assistant placeholder).

## [1.82.1] — 2026-10-27 · build 170

Fixes from the first blind bug review of `vault.mjs` (the `bug-review` skill, after an outside reviewer's method): one agent wrote a behaviour spec from the source without seeing the tests, a second wrote tests from the spec alone without seeing the source, and every step that writes state or runs a process was failed in turn. 82 tests, 24 flags, 5 real faults; the 18 dismissed flags are recorded in `docs/bug-review-decisions.md`.

- **A Vault run cannot leave a TERM-ignoring process behind** (DIV-22). After the command exits its group gets SIGTERM, and SIGKILL a second later on its own timer; the KILL used to share the pipe-drain timer, so when the pipes closed at once settling cancelled it and a group member that ignored TERM outlived the run with the values in its environment. The run still resolves within about two seconds of the exit.
- **The scrubber catches values inside longer base64** (DIV-20). `needlesFor` adds, for each of the three byte alignments, the base64 characters that depend on the value alone (standard and URL-safe, at least 7 characters), so `Authorization: Basic base64(user:password)`, tokens and config blobs are scrubbed; and unpadded standard base64. Every value of 6 characters or more is caught at any offset (property-checked over 288,000 blobs); a 4–5 character value only when it is encoded on its own.
- **An answered request lives 15 minutes from its answer** (DIV-7). `expireRequests` deleted an answered row at the request's own expiry, so the answer-time clause never ran and an approval given in the last minute was gone a minute later (the agent's `wait` got 404).
- **A wrong passphrase answers 401 even when the audit row cannot be written** (DIV-16). The failed audit is logged; before, its error replaced the 401, the server answered 500, and the try did not count toward the hourly limit.
- **The agent line's SKILL.md path** is built from the CLI's own path and quoted on its own (DIV-3); built from the quoted CLI path it carried a stray quote when the install path had a space (1.73.8 regression).
- Not changed, for the owner to decide: agent calls reset the passphrase Vault's idle-lock timer (DIV-19), so an agent that keeps using the Vault keeps it unlocked.
- Migration: none. Open browsers load build 170 at their next reload.
- Tests: `test/vault-spec.test.mjs` (new, 63 tests: the review's behaviour contract for `vault.mjs`, including fail-every-step and restart checks; the five fixes' tests fail on 1.82.0).

## [1.82.0] — 2026-10-27 · build 169

Two requests from the owner after talking with an outside reviewer: fewer steps to answer the agent, and subagents you can see, whose questions reach you.

- **Answer from the banner.** The question and approval banners under the conversation header are groups now, not one button. When exactly one action waits (`refreshApprovals`), the banner shows the request in plain words (the 1.59 phrasing), the command or file it acts on in the ledger mono (two lines), the asking subagent when there is one, and **Don't allow** / **Allow** (or **Allow for this reply**, **Allow network access**); a request Pocket cannot preview offers only **Don't allow**. **Details** opens the sheet as before. When exactly one question with one to four options waits (not multiple-choice, not secret), the banner asks it directly with the options as buttons and **Answer** for the form. Several requests or questions keep **Review** / **Answer all**. The approvals sheet and the question form close themselves once nothing is left waiting, with a toast saying what was sent; with more requests left the sheet shows them. `paintWaitBanner` takes `actions`, `agent` and `mono`; `waitBannerBusy` quiets the buttons while a decision travels. Clicking the banner outside its buttons still opens the sheet.
- **Subagent requests reach you.** A `can_use_tool` request or question arriving while no reply runs comes from a background subagent; the daemon dropped it, so the agent waited forever and the conversation read "Working in background" with nothing to see. It now opens a **control-only turn** (`beginTurn` `controlOnly`), a stand-in that holds the card and ends as soon as nothing is waiting, with no outcome, title, queue or notification of its own; output turns it into an ordinary reply. A request still waiting when a reply ends with a live process is **carried** to such a turn (`carryRequests`, replaying the original control request) instead of being withdrawn; Stop, a stall or an exit withdraw as before. A message typed during a stand-in turn does not skip the agent's question. Each request is labelled with the agent that asked (`agent` on approval and question rows, in the cards, the banner and the push notification: **A subagent is waiting for your OK**, **A subagent has a question**). The agent is found through its own transcript: Claude Code writes `<project>/<session>/subagents/agent-<id>.jsonl` and `.meta.json`, and only there is the request's `tool_use_id` recorded (`SubagentIndex` in `subagents.mjs`, read incrementally and synchronously). Codex: a request from one of the reply's subagent threads was refused by the inboxes and declined by the connection; `rehomeAgentRequest` moves it onto the parent reply with the agent's name (`agentThreadName` from the streamed collaboration items). A file change from a Codex subagent cannot be previewed, so it offers only Don't allow.
- **Subagents in view.** `GET /api/session/:id/agents` merges the agents' own transcripts (`AgentActivity.files`): name, kind, model, whether it runs in the background, the last step or sentence, counts of tool calls and messages. The `agent_progress` events the 1.16 view relied on are not emitted by the current CLI, so until now a running agent showed no activity. New `GET /api/session/:id/agents/:agent/activity` returns the agent's transcript in the conversation's message shape (`normalizeLine` with `sidechain`, last 300). In the Subagents sheet each agent with a transcript has **Show activity**: its steps unfolded and its prose, in a scrolling box that follows a working agent every 5 seconds. The row under the conversation controls now also reports background jobs (**Working in background · 1 job · View**, or **2 subagents working · 1 background job**), and the sheet names them; before, a background job showed only in the status bar's tooltip. Conversation options reads **What each one is doing, and work in the background**.
- Migration: none. Open browsers load build 169 at their next reload.
- Tests: `test/runner.test.mjs` (a background subagent asking after the reply ended: the named card, the agents view and its transcript, a typed message that does not skip it, the allow reaching the CLI, back to background, then finished; a request pending when the reply ends is carried over and answered). `test/subagents.test.mjs` (`SubagentIndex`: incremental and partial lines, the agent for a tool call, metadata, rewrite; the merge into `AgentActivity`). `test/approvals.test.mjs` and `test/questions.test.mjs` (the agent label; `agentThreadName` and `rehomeAgentRequest`). Browser: `test/browser.mjs` (the question banner with option buttons, an option answering without the form, a multiple-choice question going to the form, the form closing itself; the approval banner with the command, the subagent and Allow / Don't allow at 390 and 1440, a decision from it, two requests keeping Review, a request without a preview, the sheet closing itself), `test/ui-regressions.mjs` (Show activity, escaped text, background jobs in the row and the sheet, the row with no agents).

## [1.81.0] — 2026-10-26 · build 168

Fixes for the problems found while writing the manual (#171–#187), the desktop New conversation plus (#137), and Assistant mode's Features section.

- **Assistant mode: Settings → Features** (#175). The five switches (Projects, Files, Tasks, Inbox Watch with its schedule, Vault) and the **Choose the model for me** switch, reusing the Developer controls; the decision model, key and levels stay in **Agents & instance**, so no model name reaches a seat. With `POCKET_ASSISTANT_MODE=locked` the category is one line saying what is on and to ask the person who runs the install. A library's "is off" message points to Features, or says who to ask when locked (no Open Settings button).
- **Conversations.** A message queued with **After this reply** carries the chips' model, effort and Codex mode (#173). A start link selects its folder in New conversation, or fills it in as a custom path, ahead of `POCKET_DEFAULT_CWD` (#176). **Steer now** is sent as `auto`: when the reply cannot take it, the server queues it after the reply instead of answering 409 (#183). The plus pressed on New conversation itself clears the draft, attachments, briefing and project link (#137).
- **Approvals** (#183). Conflicting or invalid `POCKET_APPROVAL_MODE` / `POCKET_ALLOW_FULL_ACCESS` log one line and fall back to `review` instead of stopping the daemon at startup. A queued Full access item after Full access was turned off fails with that reason, not "Start was not confirmed". The approval error names **Allow** and **Don't allow**.
- **Codex finished-reply push** follows the Claude rules: none while a browser has the conversation open or after Stop; a failed reply says "Something went wrong" (#184).
- **macOS: Codex sessions reattach after a daemon restart** (#171). Without `/proc`, a process's start time comes from `ps -o lstart=` (UTC, C locale) and the boot time from `sysctl kern.boottime`; a record with a start time is proved by the live process. Linux is unchanged.
- **One `.env` parser** (`env-file.mjs`) for the daemon, every `pocket-*` command and `pocket-init`: names `[A-Z0-9_]+`, leading spaces ignored, optional quotes stripped, spaces around a value trimmed (quote a value to keep them) (#185).
- **Automatic model choice prompt names no business** (#174). `POCKET_ROUTER_CONTEXT` adds an install's own description (up to 1,000 characters).
- **Vault** (#177). Only wrong passphrases or recovery keys count toward ten an hour, and a right one clears the count. Notes are 2,000 characters on both sides, refused rather than cut. The switch says conversations get it from their next conversation process.
- **`pocket-board` / `pocket-tasks`** read times without an offset in the zone they print in (owner zone: browser, then `POCKET_TZ`, then the server's), so printed times round-trip (#178), and resolve a relative `--dir`.
- **`pocket-docs`** (#179). `show` and `set` print the existing share link; `share` on a shared file says the previous link stops working; `--expires` takes any number of days or `none`; an unknown `--project` is refused; `list` no longer sends `?all=1`.
- **Inbox Watch.** Only a watcher sending its profile with `seen` (newer than Pocket's own last run, within seven days) stands Pocket's runner down, and the Inbox says so; a job posting with `pocket-inbox add` no longer does (#172). Inbox entries keep relative `/#/start/…` links; Telegram and email still need an absolute one (#180). At each Pocket start the runner checks whose mailbox the connector reads, updates a config Pocket wrote when the account changed (an alias the owner sends from is not a change) and says so in the Inbox for three days; `bin/inbox-monitor` finds Python 3.11+ on PATH (`INBOX_MONITOR_PYTHON` overrides) and lists only real subcommands (#181). `pocket-inbox` help lists `act <id> unread`.
- **Settings** (#182). **Schedule, models and cost** sits under the Inbox Watch switch in **Projects, files, tasks & vault**, and is hidden with the switch off.
- **Cleanups** (#186). "turn" labels read "reply"; the Keyboard shortcuts sheet lists Ctrl/⌘ ; and the Enter rules; the Codex effort picker offers **Ultra** when the model lists it; dead code removed; `.split-pane` min-width matches `split.js` (380px).
- **Neutral names** (#187). The watcher's archive column that marks the owner's own mail is `from_owner` (renamed in place when an archive opens; the old name is in the migration in `inbox-watch/inbox_monitor/engine.py`), `THREADS_PER_JUDGE_CALL`, `JudgeError`; customer and staff names are out of the watcher, its docs, the plans, the test fixtures and earlier changelog examples.
- Migration: the watcher's mail archive column is renamed automatically at its next run. Rolling the watcher back below 1.81 needs that column renamed back to its old name on its `mail.sqlite` first. `.env` values with spaces around them are now trimmed.
- Tests: new `test/env-file.test.mjs`, `test/inbox-wrapper.test.mjs`, `inbox-watch/tests/test_archive.py`, `inbox-watch/tests/test_delivery.py`; additions in the proctree, router, vault, projects/tasks, documents, inbox runner, codex session, review-fixes, approvals, model selection and UI regression suites.

## [1.80.0] — 2026-10-26 · build 167

- **A manual for people and agents.** `docs/manual/` replaces the workspace guide (last current at 1.37) with one page per feature: Getting started, Sessions, Working in a conversation, Questions and approvals, Desktop and phone, Settings, Projects, Files, Tasks, Inbox Watch, Gmail/Calendar/Drive, the Vault, Voice and For agents, plus an index. Each page says what the feature does, how to turn it on, how to use it, how it works (data files, env vars, limits), what an agent may do with it (commands, flags, when to act and when to ask) and what to do when it fails. Every page was written from the 1.79.2 code, not from the old guide or this changelog. `docs/install.md`, `docs/operations.md` and `docs/action-approvals.md` were checked against the same code and corrected (menu paths, side chat and Inbox Watch processes in the lifecycle, data files that must survive an upgrade, the CLI address order, approval button names). `docs/workspace-guide.md` now maps its old sections to the manual pages. Requested by the owner.
- **Agents are pointed at it.** Every Claude Code and Codex process Pocket starts gets one more instruction line naming the manual's index (`manualInstructions` in `skills.mjs`), and each Pocket skill carries a `pocket:manual` block that the installed copy fills with this checkout's path to the feature's page (`renderManual`). An agent asked how something in Pocket works or how to set it up reads the page instead of the source.
- **Drift check.** Each manual page (and any other doc that opts in) opens with a `<!-- manual -->` block naming the release it was checked against and the source files it describes. `npm run check:manual` lists pages whose sources changed after the page last did, with the commits; `--base origin/main` lists only what the branch changed without touching the page, and CI posts that list as warnings on pull requests (checkout now fetches full history). `check:release` fails on a page without the block, a `checked` release missing from this changelog or newer than the checkout, a source that no longer exists, a page the index does not link, or a link to a manual heading that is gone. CONTRIBUTING and the pull request template say how to clear a listed page.
- README: links go to the manual; the configuration table gains `POCKET_INBOX_RUNNER` and `POCKET_PIPE_DIR`, loses its duplicate `POCKET_PUBLIC_URL`, and corrects `POCKET_URL` and `POCKET_SKILLS`; current labels (**Start conversation**, **After this reply**, **Conversation options**, **Announce conversations**); side chat on Codex; `npx` does not cover `pocket-start` and `pocket-notify`. Skills: current menu paths for Inbox Watch's rules and tidy settings, **Start conversation**, the Vault's default policy for new items. Examples in the README, docs, skills and `ecosystem.config.cjs` no longer name real customers, people or servers.
- Migration: none. The skills are rewritten at the next daemon start; running agent processes get the manual line when they next start.
- Tests: `test/check-manual.test.mjs` (metadata parsing, GitHub heading anchors, every structure failure, drift by commit and by branch in a throwaway repository, the repository's own manual passes). `test/skills.test.mjs` (each skill names an existing manual page in its repository copy and this checkout's path in the installed copy; the instruction line names an existing index).

## [1.79.2] — 2026-10-26 · build 167

- **Inbox Watch: memory read-back keeps only items about the email.** MemStem ranks every hit against the others, so `memory_items` always filled its three slots, related or not (an email about one customer's billing came with a session about another's; a certificate request from one organization with the session for a different one). `memory_relevant` now keeps an item only when it carries one of the query's identifiers, or shares two of its distinctive words (three when the query has more than five), counted in the title and the first 1500 and last 900 characters of the text (a long session's middle matches anything). The owner's and the assistant's names, the owner's domains, freemail domains and month names don't count; the owner's own name is no longer put in the query for mail they sent. At most `MEMORY_EXAMINE` (10) hits are read per search. Checked against the live corpus: all 26 memory items the tidy pass cited between Oct 22 and Oct 26 still pass (one more was found because unrelated hits no longer fill the slots); on 50 recent emails, items fell from 150 to 93 (characters 143k → 90k), 14 emails got none, no added time. Requested by the owner after the 1.76 review.
- **Inbox Watch tidy: every part of the request.** New rule in `prompts/tidy.md`: when an alert asks for more than one thing, `handled` needs every part done or taken by someone named, otherwise the entry stays `open` and the reason names the open part. Found in the review: an entry asking for footage to be exported and a resident's phone access to be set up was cleared while only the footage was being worked on.
- Migration: none.
- Tests: `inbox-watch/tests/test_memory.py` (`test_unrelated_memory_left_out`; the tidy test now shows the portal session with the portal entry only). Fails on 1.79.1.

## [1.79.1] — 2026-10-25 · build 167

- **`/btw` is suggested in Codex conversations too.** 1.79 brought side chat to Codex, and a typed `/btw …` already went to it, but the slash suggestions still listed `/btw` for Claude only (1.78 code). The entry is now first in both lists and carries `invocation: '/btw'`, so picking it on Codex types `/btw ` instead of the skill line Codex entries insert ("Use the $btw skill."). Found while checking the 1.79 announcement.
- Migration: none.
- Tests: `test/sidechat-browser.mjs` (Codex: `/bt` shows `/btw`, picking it types `/btw `, sending asks that conversation's side chat).

## [1.79.0] — 2026-10-25 · build 166

- **Branch: a new saved conversation that carries on from another.** Claude and Codex. The **Branch** chip (beside Side chat under the message box on a computer, an icon in the Working row) and **Branch** in Conversation options open a sheet that asks what the branch should do and starts it with the conversation's next-reply model, effort and permissions. `POST /api/session/:id/branch` (`{text, clientMessageId, model, effort, approvalMode}`; secret guard and delivery receipts apply, so a double tap is one branch): Claude runs the first turn with `--resume <parent> --fork-session --session-id <new>` (`spawnRunner` `fork`; a usage-limit retry before the transcript exists forks again); Codex forks with `thread/fork` (not ephemeral, `excludeTurns`, the conversation's sandbox and approval settings) in the new conversation's own app-server, which then holds its writer lock as a resume would. The parent is only read. `smeta` records `branchOf`, `branchOfTitle`, `branchNote`, `branchedAt`; `GET /api/session/:id` returns `branchOf` and `branches`, the list marks branch rows, and a branch is titled from its instruction (`Branch: …` until the generated title arrives) because it starts with its parent's first message and, on Codex, maybe its name. The list's duplicate folding no longer folds a branch into its parent (same first message and folder). Requested by the owner.
- **Side chat on Codex.** Each Codex side chat runs its own `codex app-server` and forks the thread with `ephemeral: true`, sandbox `read-only`, `approvalPolicy: never`, its own developer instructions, and every MCP server in `config.toml` plus app connectors switched off (`sideChatConfig`). Stop sends `turn/interrupt`. Codex answers show their time, not a cost. The header icon, chip, options row and shortcut now appear on Codex conversations.
- **Telling them apart.** One sentence each, used for both chips' hover text, the Conversation options sub-lines, the side chat panel and the Branch sheet: Side chat "Ask a quick question about this conversation. Nothing is saved and nothing changes."; Branch "Start a new saved conversation that carries on from here and can do work. This one stays as it is." The side chat's help line ends with **Need work done? Branch instead**; the Branch sheet ends with **Use side chat instead**; either moves your text across without sending it. A branch shows **Branch of …** under its header; its parent lists its branches.
- Verified against the real CLIs (Claude Code 2.1.293, codex-cli 0.156.1) on an isolated daemon: a Claude branch forked the parent and answered; a Codex branch carried the parent's history and answered; a Codex side chat answered from the thread, ran a read-only `ls`, could not create a file, and started no MCP server; both parents byte-identical afterwards. The test branches were deleted.
- Migration: none.
- Tests: `test/branch.test.mjs` (Claude: refusals, secret guard, one fork per delivery receipt, the parent untouched, lineage both ways, both rows in the list, later turns continue the branch; Codex: a saved fork and the first turn on the new thread, lineage, an ephemeral read-only side chat in its own app-server with MCP servers and apps off, Stop, close). `test/sidechat-browser.mjs` (hover text for both chips, the Branch sheet with axe, both cross-links moving text without sending, Start branch and **Branch of …** both ways, Conversation options sub-lines on a phone, both controls on Codex). Fakes: `fake-claude.mjs` forks on `--fork-session --session-id`; `fake-codex.mjs` answers `thread/fork`.

## [1.78.2] — 2026-10-25 · build 165

- **Side chat sits with Add project and Add task on a computer.** At 900px and wider the opener is a **Side chat** chip leading the conversation chips under the message box (Side chat, Project, Add task), and an icon in the Working row while Claude works; it reads pressed (`set`, `aria-pressed`) while that conversation's side chat is open and toggles it like Ctrl/Cmd ;. The header's speech-bubble icon is now phone-only, where the chip row scrolls sideways and would hide it. `SideChat.paintButton` repaints on every toolbar or composer render, when the panel goes away (a `MutationObserver` on its removal) and when the window crosses 900px. Codex conversations show neither. Suggested by the owner.
- Migration: none.
- Tests: `test/sidechat-browser.mjs` (desktop: no header icon, the chip reads Side chat and is pressed while open and released after Ctrl+; closes it; phone: header icon, no chip; Codex: no chip). Browser suite passes, including the 44px Working-row target check.

## [1.78.1] — 2026-10-25 · build 164

- **Each reply shows its own cost.** A Claude conversation keeps one CLI process across replies (since 1.7), and the CLI's `total_cost_usd` on each `result` is that process's running total, not the turn's. Pocket showed it as the reply's cost (`handleTurnLine` → the `$` line under a reply, and the **Ready · $…** push), so every later reply in a long conversation also counted all the earlier ones. Verified against Claude Code 2.1.293: three turns in one process reported $0.0068, $0.0072, $0.0076 while the second turn read 34,675 cached tokens. `turnCost` now reports the difference from the last total the same process reported; the baseline lives on the runner and in its marker (`spent`), so a restarted daemon that adopts the process keeps counting. A process adopted from before 1.78.1 has no baseline, so its next reply shows no cost instead of a wrong one. Pre-1.7 one-process-per-turn turns are unchanged. Found while building side chat (1.78), which already reports differences.
- Migration: none.
- Tests: `test/runner.test.mjs` (`a reused process reports each turn's own cost, also after a daemon restart`: three turns at a running total of 0.40/0.80/1.20 each report 0.40, the third after a restart; fails on 1.78.0 with 0.80). `test/fake-claude.mjs` reports a running total for `__COST__` turns.

## [1.78.0] — 2026-10-25 · build 164

- **Side chat: ask about a conversation without adding to it.** A Claude conversation's header has a speech-bubble button (also **Side chat** in Conversation options, Ctrl/Cmd ; and any message starting with `/btw`) that opens a side chat: the dock's fourth panel beside Results, Queue and Git on a window at least 1280px wide, a sheet elsewhere. The server (`sidechat.mjs`) starts one Claude Code process per side chat with `--resume <conversation> --fork-session --no-session-persistence`, so it has the conversation as context, never writes to its transcript and saves no session; it remembers its own turns in memory. It can only read and search: `--tools Read,Grep,Glob,WebSearch`, `--strict-mcp-config` with no servers, `disableAllHooks` (so the directory picker, turn capture and other user hooks do not fire for an aside) and `--permission-mode default` with no permission tool. It uses the conversation's model, `--max-budget-usd` caps it (`POCKET_SIDE_CHAT_BUDGET_USD`, default 5), it closes after 30 quiet minutes (`POCKET_SIDE_CHAT_IDLE_MS`), at most four run at once (`POCKET_SIDE_CHAT_MAX`; the quietest idle one makes room), and it ends on a Claude sign-in change or a daemon restart (its stdin closes). Stop interrupts an answer (`control_request` interrupt) and keeps the side chat. The server keeps each side chat's events, so the panel replays it after a reload or on another device. Each answer shows its own cost: the CLI's `total_cost_usd` is the process's running total, so the side chat reports the difference. Codex conversations do not offer it yet. `POCKET_SIDE_CHAT=0` turns it off. Requested by the owner.
- API: `POST /api/session/:id/side` `{text, side?}` (starts or continues the conversation's side chat; secret guard applies; 409 before the conversation has a transcript, 400 for Codex), `GET /api/session/:id/side`, `GET /api/side/:side/events` (SSE, replays from `from` or `Last-Event-ID`), `POST /api/side/:side/stop`, `DELETE /api/side/:side`.
- Migration: none. New frontend file `public/sidechat.js`.
- Tests: `test/sidechat.test.mjs` (arguments; HTTP: Codex and empty refusals, no transcript yet, secret guard, streaming, one process across follow-ups, 409 while answering, Stop keeps it, replay from an event number, spending cap message, the transcript byte-identical and no new session file, replace and close). `test/sidechat-browser.mjs` (dock at 1440 with axe, shortcut closes and reopens with history, reload replays, New side chat, full-height sheet at 390 from Conversation options with axe, `/btw` from the composer, none on Codex). `ui-regressions.mjs` 1.19 options list includes Side chat. Checked by hand against the real CLI (Claude Code 2.1.293) on an isolated daemon: answer from the conversation, Stop, `/btw`, reload, dock to sheet on resize.

## [1.77.10] — 2026-10-25 · build 163

- **Inbox Watch: resolving an entry in Pocket closes its story.** `pocket-inbox feedback` reports each decision as the entry's state (`resolved`, `not_useful`, `dismissed`) or `restore` (`inbox.mjs` `feedback()`, since 1.69), and `apply_feedback` closed a story only on `resolve`. So every resolve the owner made in Pocket was logged (`feedback resolved: …`) and acknowledged, but the story stayed open: none of the owner's 58 resolves since 2026-10-19 closed one, and the judge kept seeing those stories as open. Only stories the tidy pass closed itself were marked resolved. `apply_feedback` now maps the state names to its actions (`FEEDBACK_ACTIONS`). Not useful already matched; dismiss changes nothing, as before. Found on 2026-10-25 when a resolved card charge stayed open. Reported by the owner.
- Migration: none in code. Decisions already acknowledged are not replayed; the owner's open stories that he had resolved in Pocket were closed by a one-off pass (see the monitor's maintenance ledger).
- Tests: `inbox-watch/tests/test_process.py` (`test_resolving_in_pocket_closes_the_story`: feedback in the shape Pocket returns closes the resolved stories, leaves the dismissed one open, records the event, acknowledges all three; a later restore reopens). Fails on 1.77.9.

## [1.77.9] — 2026-10-24 · build 163

- **Inbox Watch: finishing an entry archives its email.** With the Pocket Inbox label on (1.75), resolving, dismissing or marking an entry not useful only took the label off at the next sync (`label_sync` removed the label and nothing else), so the thread stayed in, or for anyone whose Gmail view hides labelled mail from the main inbox reappeared in, the owner's Gmail inbox, still unread. The same sync now also takes the thread out of INBOX. A thread that got mail after its label went on (found by this check, waiting in the backlog, or judged or first-passed since) keeps its place in the inbox and only loses the label, so a reply the owner has not seen never disappears. `archive = false` under `[gmail_label]` restores the label-only behaviour. Works through all three writers (Gmail API, Claude Code's connector, Codex's Gmail app), which already handled INBOX for threads the owner labels. The Settings line for the label says so. Suggested by a colleague.
- Migration: none. On by default; threads finished before this release are not touched.
- Tests: `inbox-watch/tests/test_label.py` (`test_finished_entry_archives_its_thread`: of three dismissed entries the one with no newer mail is archived, one with a reply judged after labelling and one with a reply this check found keep INBOX; `test_archive_can_be_turned_off`). The first fails on 1.77.8.

## [1.77.8] — 2026-10-24 · build 162

- **Inbox Watch: `notify --dry-run` keeps nothing.** `notify_cli` queued the alert row and then let `deliver` mark it `dry-run`, so the dry run used up the `--key`, and the real send that followed with the same key logged `duplicate key … nothing sent`. Found on 2026-10-24 while re-posting a backups alert. A dry run now logs what it would do (send, hold for the digest, or duplicate), rolls back and returns; nothing is written. The tick's `--dry-run` is unchanged (it still advances the cursor and ledger, as documented). Reported by the owner.
- Migration: none. A key used up by an earlier dry run stays used (its row has status `dry-run`).
- Tests: `inbox-watch/tests/test_process.py` (`test_notify_dry_run_keeps_nothing`: a dry run leaves no alert row and sends nothing; the real send with the same key goes out; a second dry run and send after it send nothing more). Fails on 1.77.7.

## [1.77.7] — 2026-10-24 · build 162

- **Times show in the reader's own time zone, with the zone named.** The usage panel's reset and as-of times and the prompt-cache times (`fmtResetET`/`fmtAsOfET`, now `fmtReset`/`fmtAsOf`) were fixed to America/New_York with an "ET" label for every viewer; they use the browser's zone and name it ("6:00 AM EST"). The server's usage-limit push and log line (`fmtET`, now `fmtOwnerTime`) and reminder emails use the owner's zone (`ownerZone()`: the zone the signed-in browser reports, else `POCKET_TZ`, else the box's) and name it. `pocket-tasks`, `pocket-board`, `pocket-docs`, `pocket-vault` and `pocket-inbox` print times the same way (`scripts/owner-zone.mjs`, which reads `ownerTimezone` from `pocket-settings.json` read only); they printed the box's zone (UTC on a cloud server) with no label, so an agent relayed a 6:00 AM Eastern reminder as 11:00 AM. Requested by the owner.
- Unchanged: a time typed without an offset (`--due`, `--at`) is still read in `POCKET_TZ`, else the box's zone.
- Migration: none.
- Tests: the notify test asserts the zone in the reminder email ("9:00 AM EDT"); the usage-panel browser checks accept any named zone instead of "ET".

## [1.77.6] — 2026-10-24 · build 161

- **Inbox Watch asks its judge again when a reply does not parse.** On 2026-10-23 at 11 PM a complete Sonnet reply (1,305 output tokens) failed `extract_json`, so `call_judge` raised, the check exited 1, OnFailure mailed the owner, and the three threads waited in the backlog until the 11:30 check judged them without trouble. `call_judge` now asks the same judge once more with the same message when a reply holds no parseable JSON; both calls are recorded in `judge_calls`. The first failure logs the reply's length and its last 300 characters, so the next one shows where it went wrong (the reply itself is not kept). Timeouts and failed judge commands are still not retried in live runs; they go back to the backlog as before. Reported by the owner.
- Migration: none.
- Tests: `inbox-watch/tests/test_process.py` (`test_a_reply_that_does_not_parse_is_asked_again`: a good reply is asked for once; a reply with an unescaped quote or cut off part-way is asked again and the second reply is used; two bad replies still fail the check). Fails on 1.77.5.

## [1.77.5] — 2026-10-23 · build 161

- **Sending a message no longer dims the conversation for a moment.** 1.77.4 replaced only the message list after a send and at a turn's end, but every message is drawn with `.enter` (the 0.18 s `rise` fade-in from opacity 0), so the whole visible conversation replayed it at once: a brief blink the owner could still just see on his phone. `resyncChat` now removes `.enter` from the refreshed list; those messages were already on screen. Opening a conversation and messages streaming in keep the animation. Reported by the owner.
- Migration: none.
- Tests: the 1.77.4 browser check also asserts no message in the list carries `.enter` after a send and after a turn's end. Fails on 1.77.4.

## [1.77.4] — 2026-10-23 · build 160

- **Sending a message no longer blinks the whole screen.** When the server acknowledged a message, `submitPending` called `renderChat`, which replaces the whole page (`app.innerHTML`: rail, header, composer) and leaves `#msgs` empty until `/api/session/:id` answers; the stream's `done` at the end of every turn did the same. The re-read itself is kept (it is what drops an unsent ghost bubble and keeps a replayed receipt from showing twice, since 1.1), but the new `resyncChat` reads the transcript first and then replaces only the message list through `paintTranscript`, the list painting `renderChat` now shares. The composer is rebuilt only when it changes between Reply and Working (and the box keeps focus if it had it); otherwise only its toolbar is repainted, so a sent file's chip goes. The reading position is kept unless you were at the end. A failed read, or a view that is not that conversation, still takes the full render as before. Reported by the owner.
- Migration: none.
- Tests: the browser suite's new 1.77.4 check, at 1440 and 390, slows the transcript read (`sessionDelay`), sends from the composer and then ends a turn on the stream (`streamDone`), and asserts the rail, header, composer, box and list are the same elements afterwards, the list never went without a message, and the sent message shows once. Fails on 1.77.3 (all five rebuilt).

## [1.77.3] — 2026-10-23 · build 159

- **Projects in the rail switch shows after Tasks, Vault or Inbox.** The Tasks, Vault and Inbox rail lists carry the class `rail-projects` for their styling, and `paintRail` and `paintRailProjects` used that same class to tell whether the project list was already painted. So once Projects had been shown, switching to it from any of those three found the other list, judged nothing had changed (the 1.50 "same HTML" guard), and left it there; only Chats (whose panel has a different class) cleared the way. The project list now carries its own `rail-board` class and both checks use it. The other five entries were checked: each tests a class only its own list has, or repaints without a test. Reported by the owner.
- Migration: none.
- Tests: the browser suite's 1.69 Inbox check now switches the rail through every entry in every order the owner could take (Projects after Tasks, Vault, Inbox, Files and Chats, and the others after each other) and asserts the rail holds that entry's list alone. Fails on 1.77.2 at Tasks → Projects.

## [1.77.2] — 2026-10-23 · build 158

- **Inbox Watch: the Pocket Inbox label can bring a thread back into the inbox.** An owner whose Gmail filters skip the inbox for whole kinds of mail (alarm tickets, monitoring reports filed straight into their own labels) never saw an alert's thread in Gmail's inbox: the watcher added the label and left the thread archived. New `[gmail_label] inbox = true` adds INBOX together with the label when the label goes on, once; archiving the thread afterwards is left alone. Off by default, so other watchers keep today's behavior. Asked for by the owner.
- Migration: none.
- Tests: `inbox-watch/tests/test_label.py` (`test_label_brings_into_inbox_when_asked`: label only by default; with the option the label and INBOX go on together, and a later archive is not undone).

## [1.77.1] — 2026-10-23 · build 158

- **Inbox Watch no longer stops overnight.** 1.75.3 added Check now's `awake` to the quiet-hours test in `_process_batch` without passing it in, so every non-critical notify during quiet hours raised `NameError` and ended the run. Daytime checks and threads labelled in Gmail never reached that name, so only the overnight checks failed (six overnight runs on one install). `process()` now passes `awake` through.
- **A check that fails part-way leaves nothing behind.** The failed runs had already written the judge's decision and its story event for the thread they stopped on; the next run read them, decided it had already alerted, and four alerts never went out. A batch that raises now rolls back its decisions, story changes and alerts (the judge's cost record is kept) and its threads stay in the backlog, so the next run judges them afresh. Alerts from earlier batches of the same run still go out, and the error still ends the run, so systemd's `OnFailure` reports it.
- Migration: none.
- Tests: `inbox-watch/tests/test_process.py` drives the real `process()` with a fake judge: a quiet-hours notify is held, Check now sends it, and a batch that fails part-way keeps no decision, story or event, stays in the backlog and is alerted on the next run. All three fail on 1.77.0. Added to CI.

## [1.77.0] — 2026-10-22 · build 158

- **Inbox: the read mark is a dot, and it does something.** The eye beside each entry looked the same read or unread unless you knew the shade, and tapping it only opened the entry, as the row does. It is now a dot level with the title: filled clay while unread, a dim ring once read. Tapping it marks the entry read or unread (new action `unread`: opened → new; a finished entry stays finished) and opens nothing. Suggested by a colleague.
- **Inbox: the conversation you started from an alert.** Starting a conversation from an entry's briefing used to leave no trace on the entry, so a second tap started a duplicate. New now carries the start link's id to `/api/new` (`start`), and every Inbox entry that opens that link remembers the session (`sessions`, at most five, newest last; an unread entry becomes read). The row shows a speech bubble under the dot that opens the latest one, and the entry's options lead with **Open the conversation** (when it started; "the latest of N" when there are several) and offer **Start another conversation**. Conversations started before 1.77 are not linked. Suggested by a colleague.
- Migration: none. Older `inbox.json` entries read as having no conversations.
- Tests: `test/inbox.test.mjs` (unread, the start-link session record, its limits and a hand-edited file; `/api/new` with `start` over HTTP); the browser suite marks an alert unread and read with the dot, starts a conversation from its briefing, checks the start id reaches `/api/new`, then the bubble, its 44px target and the sheet's two options.

## [1.76.4] — 2026-10-22 · build 157

- **Projects is a flag.** In the rail switch, Projects' three-column board was still a box beside the Files page and the Inbox envelope. It is now a pole with a pennant (a colleague's glyph, `IC.railProjects`): a goal with a next step, and a silhouette no other entry shares. The same colleague also proposed a paper clip for Files; not taken, because the paper clip already means Attach in the composer and attachment lines in a conversation. Suggested by a colleague.
- Migration: none.
- Tests: none new (a glyph change); the rail checks from 1.76.2 cover the switch.

## [1.76.3] — 2026-10-22 · build 156

- **Four faults from the external re-check of 1.73.2, each with his test.** The reviewer re-checked the security and data-loss rows of his list against 1.73.2 and sent tests for the ones still there; 1.73.3 to 1.73.8 had closed all but these four, which are fixed here, with his tests adapted into the suite.
  - *A public or share link followed a symlink.* `/files/:name`, `/share/:token` and the signed-in raw route sent the stored copy with `sendFile`, which follows links. A stored file replaced by a symlink (anything running as the daemon's user can do it, an agent included) served the link's target to anyone holding the link. The stored copy is now sent only when it is a regular file inside the library reached through no link; otherwise 404.
  - *A half-finished key rotation could move the Vault to a key the owner never saw.* Rotation saves `.env` twice (the new key with the previous one beside it, then the new key alone once the store is rewritten). If the daemon stopped between the two, `.env` kept both and the store stayed under the previous one; setting a passphrase in that state and removing it after a restart re-encrypted the store under the new key, which the owner was never shown. The store now remembers which key opened it, and at start the daemon rolls `.env` back to that key (logged as *an unfinished key rotation was rolled back*), so the recovery key the owner saved, the passphrase paths and the next rotation all use the key the owner has. With the key set in the process environment the store stays under the previous key and the log says so.
  - *A Codex command stayed shown as running.* The transcript cache is refreshed from the newest pages and updated when a page's reply arrives. A turn's completed item noted while that page was on its way was put back to the page's older state, and once newer items covered the page no later refresh reread it. Items noted during a refresh are now applied after its pages, so the completed copy wins.
  - *A torn Vault audit row hid the next one.* An append that failed part-way (a full disk, an I/O error) left a row with no newline; the next row, for example a release that succeeded, was glued to it, the line no longer parsed and the audit silently dropped it. The next row now starts on a line of its own, so only the torn row is lost.
  - Left as is, on purpose: `atomicWrite` (push subscriptions, settings) keeps tmp+rename without fsync (decision of 2026-10-21: only `vault.enc` is synced).
- Migration: none. An install with an unfinished rotation in `.env` is repaired at the next start.
- Tests: `test/documents.test.mjs` (a stored copy replaced by a symlink answers 404 on the public link and the signed-in viewer, and the real file is served again); `test/vault-key.test.mjs` (an unfinished rotation is rolled back at start, the recovery key is the one the owner has, a passphrase set and removed leaves the store under it and the undisclosed key opens nothing); `test/codex-reader.test.mjs` (a completed item noted while a page is held is not undone by that page, nor by a later refresh); `test/vault.test.mjs` (a torn audit append, then the retried release is in the audit).

## [1.76.2] — 2026-10-22 · build 156

- **The sidebar switch names every entry.** With five or more of Chats, Projects, Files, Tasks, Vault and Inbox on, the switch showed icons only, named just the pressed one, and four of the icons (a folder, a page, a checkbox, a tray) were the same small box in the same grey; a colleague could not tell them apart. Each entry now has its own silhouette (a speech bubble with lines, a three-column board, a page with a folded corner and lines, a round check, the lock, an envelope; the folder stays the workspace glyph) at 20px, and at a rail of 300px or more each icon sits over its 11px name, so the switch takes the head's first row and Filters, Settings and New sit on the second. Below 300px it falls back to icons with only the pressed entry named. The threshold keeps names on a 320px rail beside a Windows scrollbar (305px inside); at 300px the closest names are 6.5px apart. Counts sit on the icon's corner at 11px (they were 10.5px).
- **What the main area shows is marked.** The pressed entry is the rail's own list, so with Settings → Files button set to open the library in a tab, clicking Files opened the tab and left Chats lit. The entry for the main area's view (a conversation or the list is Chats; `#/projects`, `#/documents`, `#/tasks`, `#/vault`, `#/inbox` their own) now carries `aria-current="page"` and, when it is not also the pressed one, a 16×2px clay bar under it. Reported by a colleague.
- Migration: none.
- Tests: `test/ui-regressions.mjs` 1.69 Inbox check (six entries named at the default width, the switch on its own row above the actions, Chats pressed and Inbox current with the bar at `#/inbox`, a 260px rail naming only the pressed entry without overflow) and the Documents check (Files opened in a tab is current while Chats stays pressed).

## [1.76.1] — 2026-10-22 · build 155

- **A message no longer waits behind an unanswered question.** A message sent while a turn waited on a question was steered into the turn, and Claude Code holds steered input until the pending AskUserQuestion is answered, so the person saw *Sent to the running reply* and then nothing. On one install a session sat 33 minutes that way (2026-10-22). Now, once the message is written, each blocking question gets its no-answer reply: Claude's is a deny whose message says the user skipped the questions and sent a message instead, and Claude reads that and the message together in the same turn (checked against the real CLI, back to back and 300 ms apart: one reply, answering the message). Codex gets its no-answer reply (`answers: {}`). Non-blocking Codex questions stay. The delivery note reads *Questions skipped. Your message went to the running reply.*, the log line names the skipped count, and while a blocking question waits the message box reads *Answer above, or type here to skip the questions…* (not in After this reply mode, which still waits for the turn to end).
- Migration: none.
- Tests: `test/questions.test.mjs` (`skipBlocking` answers only blocking requests, with the note); `test/server.test.mjs` (a message typed during `__QUESTION__` is steered, the question is denied, the questions list empties and the turn finishes).

## [1.76.0] — 2026-10-22 · build 154

- **Inbox Watch reads the owner's memory** (`[memory] search = true`, off by default; `inbox_monitor/memory_search.py`). The worker searches memory itself instead of leaving it to the judge: before each decision, per thread (subject, the sender's name and company, identifiers), and in the tidy pass, per open entry (title and alert text, work from six hours before the alert on). Up to three items each (`memory` in the bundle), dated, marked `after: true` when written after the email or the alert; a session shows its end, where the outcome is. The decision prompt treats a later item that shows the work done as "already handled" (`update`, not `notify`) and never as evidence; the tidy prompt accepts an item's `mem:<id>` as proof for `resolved` or `handled`, and a new session since the last look sends an entry judged open back to the judge. Left out: the watcher's own records, skills, `search_exclude` paths and `search_exclude_titles` (standing background files). A session and its distillation count once. A replay never sees an item written after its simulated moment. A failing search turns memory off for that check and never fails it. Story records in memory show `mem:` refs as text, not as Gmail links. Asked for by the owner: "often there is work that I might have done since the email came in that didn't require an email response from me".
- **What the judge looked up.** The `claude` judge now reads Claude Code's `stream-json` output, so each call's turns and tool calls (the memory searches it chose to make, with their queries) are kept in `judge_calls` (`turns`, `tool_calls`, `tools`), beside `memory_items`, the items the worker put in front of it. Other judges record no tool calls.
- Migration: `judge_calls` gains four columns on first open. Memory search stays off until `search = true` is added to an instance's `[memory]` table.
- Tests: `inbox-watch/tests/test_memory.py` (items marked after, nothing from the future in a replay, a session's end; the query names a person or company, not an address or a no-reply system; the watcher's own records, skills, excluded paths and titles left out; a session folded into its distillation unless it went on after it; a failing search off for the check; tidy accepting a shown `mem:` ref and refusing one it was not shown; tool calls parsed from the stream and kept in the ledger).

## [1.75.4] — 2026-10-22 · build 154

- **A question looks like something to answer.** When Claude or Codex asked a question, the banner above the conversation used the clay-deep fill and clay hairline of your own messages and read "Claude has a question · Answer", so it passed for a notice. One user read past it, typed into the composer instead, and the session sat waiting on the unanswered card for over twenty minutes. The banner now uses `--warn`, Pocket's colour for waiting on you (the same amber as the tab mark and the *Needs your answer* status): a tinted fill and amber border, a drawn question mark, the count ("Claude has 3 questions for you"), a line saying whether the reply is paused ("The reply is paused until you answer.", or that the agent keeps working for a non-blocking Codex question) and an amber **Answer** (**Answer all** for several) button with a chevron. The whole banner still opens the question sheet. Approvals use the same banner with an info mark and **Review**. Green was considered and not used: in Pocket green (`--ok`) means working or done, the opposite of "this needs you". Below 420px the mark is dropped so the text keeps its width. Reported by a colleague, via the owner.
- Migration: none.
- Tests: `test/browser.mjs` checks the question banner's title, note and Answer button before opening the sheet and runs an axe scan on it (`question-banner-mobile`).

## [1.75.3] — 2026-10-22 · build 153

- **Check now skips quiet hours.** A check the owner asks for in the Inbox no longer holds its alerts for the morning: the check's own decisions go out at once whatever the hour (`process(..., awake=True)`), and every alert quiet hours were holding goes out with it, whatever its priority (`release_held(..., everything=True)`; one whose story resolved since is dropped as before). Scheduled checks keep quiet hours as they were. Asked for by the owner ("if someone hits refresh then they obviously want the alerts at that point").
- Migration: none.
- Tests: `inbox-watch/tests/test_label.py` (`test_check_now_skips_quiet_hours`: a Check now run passes `awake` and delivers held high, normal and low alerts, leaving none waiting).

## [1.75.2] — 2026-10-21 · build 153

- **The Inbox's read mark is an eye.** Each entry showed a clay dot while unread, then a bell (an alert) or a page (a digest or look-ahead) once read, which read as two different controls that did the same thing. It is now one eye: clay while unread, the row's `--dim` once the entry has been opened. The mark and the row both open the entry, as before; its label says Unread or Read. Asked for by the owner.
- **Opening is reading, at once.** The entry turns read the moment its sheet opens, not when the server answers, and a list fetched before the server took the read up can no longer bring the unread mark back (`inboxReadHere` in `public/inbox.js`).
- Migration: none.

## [1.75.1] — 2026-10-21 · build 152

- **The Pocket Inbox label through Claude Code's Gmail connector.** `mail_connector.py`: `ClaudeConnector.label_id` (finds the label with `list_labels`, makes it with `create_label` when missing, remembers the id in `state/connector/label-ids.json`) and `change_threads` (`label_thread` / `unlabel_thread` for whole threads in one run). Each label run allows those four tools only, blocks every other Gmail and connector tool, and a PreToolUse hook passes a call only with the label name, label ids and thread ids the program asked for. Tested live on a second mailbox: lookups and the lockdown work; that connector had been granted read-only by Google ("insufficient scope"), which is now reported as such.
- **A read-only grant says so.** "Insufficient scope" from the connector becomes a 403 with what to do (reconnect Gmail in claude.ai and allow everything it asks for); the engine records it (`label_refused`), Settings shows the label as unavailable with that reason, and the sync asks again after 30 minutes. With Codex as the other transport, the change goes through Codex's Gmail app instead, by name.
- **Set up with the label on.** A config Pocket's runner writes now carries `[gmail_label] enabled = true` (it was already the default).
- Migration: none.
- Tests: `test_connector.py` (Claude label lookups made once, the run's allowed and blocked tools, the hook refusing another thread, another label or another tool, a read-only grant raising with what to do, the Codex fallback by name); `test_label.py` (a refusal reaching Settings); `test/inbox-runner.test.mjs` (the label line in a new config).

## [1.75.0] — 2026-10-21 · build 152

- **Check now.** The Inbox has a Check now chip beside All (in the side list) and beside Schedule (in the Inbox view). Pocket records the request (`POST /api/inbox/check`, `pocket-inbox check`) and hands it to the watcher with its settings; the watcher runs a check on its next one-minute tick whatever the schedule says, paused included, and reports it done in its heartbeat (`status.checkRequestDone`). Pocket's own runner (1.74) runs the tick at once. The chip stays busy until the watcher reports, then the list reloads and says how many new items the check found. A second press while one is on its way changes nothing; a request never taken up is replaced after ten minutes. With the schedule set to Don’t check, Inbox Watch now checks only on demand (plus the morning digest and any look-ahead left on), and Settings says so.
- **Your list in Gmail** (`gmailLabel`, on by default; Settings → Inbox Watch → Your list in Gmail, TOML `[gmail_label] enabled, name`). The owner's open Inbox entries carry a "Pocket Inbox" label in Gmail (created when missing), kept in step at every check, both ways: an alert's thread gets the label and stays in the Gmail inbox; a thread the owner labels in Gmail (Label as or Move to) is judged at that check, marked `added_in_gmail`, and always becomes an alert (not held for quiet hours, never skipped by the first pass, at least normal priority), and goes back to INBOX if it was moved out; taking the label off in Gmail dismisses the entry; resolving, dismissing, marking not useful or tidying it in Pocket takes the label off; Restore puts it back. `label_sync` (monitor.sqlite) remembers which threads were in step, so a label the owner removed is told apart from one never added; the first sync only adds labels and leaves anything labelled before it alone. Writes need `gmail.modify` (`mail_gmail.py`: `LABEL_SCOPES`; `gmail-auth` asks for it when the label is on); nothing but that label, and INBOX for an owner-labelled thread, is changed. Through the connector source (1.74) the label goes through Codex's Gmail app (`mail_connector.py`: `apply_labels_to_emails` in a second locked Codex home with that one tool, a prompt of message ids and the label name only, every call checked against what was asked; on the newest message to add, every known message to remove); Claude Code's Gmail connector cannot change labels yet, and Settings says so. Verified live on the author's mailbox through Codex: label created, added, found by `label:pocket-inbox`, removed. With Pocket's Inbox off, no sync runs (an empty list never reads as "everything finished").
- **Neutral instructions.** The judge's prompts (`decide.md`, `lookahead.md`, `tidy.md`) and the first pass's criteria no longer assume a business: the camera, technician, site-outage and alarm examples, the camera-monitoring line, the $500 threshold and the AI-service-report line are gone, replaced by examples from no particular industry (an order, an invoice, a lease). The decide prompt says so and points to the owner's rules for everything specific. Times follow the watcher's time zone, not Eastern. Owners who relied on that guidance carry it in their own rules.
- **Your rules explain themselves.** The rules box in Settings → Inbox Watch shows, in italics, what to write (who you are, what matters, what doesn’t, your own rules) with examples from no particular business; the old example lines were about security cameras.
- Migration: an owner whose watcher leaned on the old camera or service guidance moves it into their rules (the author's was moved when this shipped). An OAuth sign-in granted read-only needs `gmail-auth` again for the label; a service account needs `gmail.modify` in its domain-wide delegation. A watcher older than this Pocket ignores Check now and the label setting; a Pocket older than this watcher sends neither, and the label stays on from the watcher’s config.
- Tests: `inbox-watch/tests/test_label.py` (the first sync, a label added in Gmail brought in once and kept in INBOX, an alert labelled, a finished entry unlabelled, a label taken off dismissing the entry, Restore, dry run, off and on again, a read-only sign-in, the connector, Pocket's Inbox off; `test_connector.py`: Codex label changes in their own home, newest message to add, all to remove, a changed argument refused, Claude's connector unavailable; Check now runs once even when paused); `test/inbox.test.mjs` (the `gmailLabel` setting, one request until done or ten minutes, the route, the CLI and the watcher’s view of the request).

## [1.74.0] — 2026-10-21 · build 151

- **Inbox Watch sets itself up.** Turning Inbox Watch on used to switch on only the Inbox list: the watcher that fills it needed a config file, a Google sign-in (an OAuth client or a Workspace service account) and a timer on each server, done by hand, and an install without them showed an empty Inbox with no word of why (one install's, from the 1.69 switch until now). Now Pocket does all of it when no hand-installed watcher reports to it: it finds the owner's mailbox through the Gmail connector already linked to Claude Code (**Settings → Connectors**), writes the watcher's config under `<data dir>/inbox-watch-data/` with the owner's time zone from their browser, starts from now, loads two weeks of mail as the watcher's memory, and runs the watcher every minute (`inbox-runner.mjs`); the watcher checks mail only when the schedule in **Settings → Inbox Watch** says one is due. The Inbox says what it is doing (setting up, waiting for the time zone, Gmail not connected, a failed check and why); three failed runs in a row send one push. A watcher installed by hand, with its own config and timer, is left alone. Asked for by the owner ("when someone turns on Inbox Watch, it has everything they need").
- **Claude Code or Codex.** The connector source reads through either agent (`mail.agent`): Claude Code's Gmail connector, or the Gmail app connected to Codex's ChatGPT sign-in (chatgpt.com/apps), each locked to Gmail's read tools. Codex runs in a CODEX_HOME of the watcher's own with every app but Gmail off and only the seven read tools on (verified on an account that allowed all 21 Gmail tools, send and delete included). Pocket's setup tries Claude first, then Codex; with both on the same mailbox the other becomes `fallback_agent` and reads whenever the first fails (chatgpt.com sometimes answers cloud servers with a bot check). A server with only Codex judges with Codex (`gpt-6-sol`). Asked for by the owner ("this should be working with Codex as well").
- **The Codex judge is isolated by default** (`judges.py`): without an explicit `codex_home` it runs in `state/judge-codex-home` with every app off and no shell, since the owner's Gmail app may allow sending and the judge reads untrusted mail. A judge with its own `codex_home` is unchanged.
- **The watcher reads Gmail through the connector** (`inbox-watch/inbox_monitor/mail_connector.py`, `mail.provider = "connector"`). No Google client, token or Google Python libraries: each batch of reads is one short `claude -p` (Haiku by default) that may use only the connector's `search_threads`, `get_thread` and `get_message`, and the watcher takes each tool's JSON from the stream, so the model never retypes a message. Changes are found by time (`after:` the last check, with a 15-minute overlap) and a ledger of the messages already seen; threads are read eight to a call. The call has to load the user's Claude Code settings for the connector to appear, and those can allow every Gmail tool, send included, so it gets no built-in tools, `--disallowedTools` for every Gmail write tool and the other connectors, and a PreToolUse hook that refuses anything but the three reads (verified against a config with `bypassPermissions` and all of Gmail allowed). Fetch calls are kept in the cost ledger as `fetch` and counted in each day's cost (about one Haiku call per check, a cent or two at list price, nothing billed on a plan). The Gmail API source is unchanged, and its Google libraries are now imported only when it is used.
- `.gitignore` gains `inbox.json`, `starts.json` (both quote private mail; with the default data directory they sat untracked in the checkout since 1.57 and 1.69) and the runner's `inbox-watch-data/`.
- `GET /api/inbox` adds `runner` (`managed`, `state`, `message`, `mailbox`, `lastOkAt`, `failures`); `/api/me` takes `?tz=` and keeps the signed-in browser's time zone as the setting `ownerTimezone`. `POCKET_INBOX_RUNNER=0` turns the runner off.
- Not yet: the first pass needs an OpenRouter key on the server as before (without one every changed thread goes to the judge, and Settings says so).
- Migration: none. An install whose Inbox already receives a watcher's reports keeps it; one that never had a watcher sets itself up the next time the owner opens Pocket, if Inbox Watch is on.
- Tests: `inbox-watch/tests/test_connector.py` (a fake `claude` that answers in stream-json: changed threads seen once, promotions and spam skipped, Gmail-shaped messages the engine parses, batching and retry, the read-only lockdown and its hook, the missing-connector error, whose mailbox; Codex reads, its locked CODEX_HOME, a bot check as a 503 with Claude taking over); `test/inbox-runner.test.mjs` (setup from the connector, external watchers left alone, the status states, Codex-only, both with a fallback, neither connected).

## [1.73.8] — 2026-10-21 · build 150

- **The Low batch.** The last batch from the 2026-10-21 triage of the external review: the Low rows that PRs 1.73.3 to 1.73.7 left open, each a small change.
  - **Trusted actions** (`trusted.mjs`): a word starting with an unquoted `#` (Bash ignores the rest of the line) and a `VAR+=value` first word are no longer one plain command, so they show the card, and a rule written that way is refused; `mcp__server__*` covers tool names without `__`, so it cannot reach a server named `server__other`. [S2-D3-1, S2-D3-2, S2-D3-3]
  - **Vault** (`vault.mjs`, `scripts/pocket-vault.mjs`, `server.mjs`): an audit row is written whole even when the disk takes it in pieces; a value with a lone surrogate is also scrubbed in the U+FFFD spelling a command sees; the streaming scrubber's cut moves back to the start of a value that straddles it, so a value that overlaps itself is scrubbed as it would be in the whole text; the CLI decodes a run's stream across chunk boundaries; switching the Vault on answers with the new key even when its audit row could not be written. [S2-B3r2-2, S2-B4r2-5, S2-B4r-1, S2-B7-1, S2-B5R3-CREATE]
  - **Connectors and MemStem** (`connectors.mjs`, `server.mjs`): a ChatGPT install link with a user name, password or port is not offered; two status reads at once share one `claude mcp list`; a failed read logs Pocket's own reason, not the CLI's error text; MemStem's answers are read up to a limit (64 KB health, 8 MB search); a snippet file must resolve inside MemStem's vault with links followed and be a regular file (a link out of the vault was read, a FIFO stopped the search). [S2-E1-1, S2-E2-COALESCE, S2-E2-LOG, S2-M1-2, S2-M1-3]
  - **Codex** (`codex.mjs`): a request whose write fails is rejected at once; closing a connection rejects the requests still waiting; the reader waits for its output to end (up to half a second) before treating an exit as final, so a reply written just before exit still counts; Stop clears the turn's question and approval cards; two reads of one thread (opens, agents polls) share or queue their work instead of paging into one cache at once, and items noted during a cache reset are kept; a hand-corrupted transcript cache row or usage file reads as empty instead of failing. [S2-F2-2, S2-F2-3, S2-F2-7, S2-F7-2, S2-F3-1, S2-F4-1, S2-F4-3, S2-F5-3]
  - **Skills and commands** (`skills.mjs` and the agent lines): the skill folder's marker is written before the skill, and a marked folder missing its skill is repaired; an install path with a space or a quote is shell-quoted in skills and in the per-turn lines; `pocket-board`, `pocket-docs`, `pocket-tasks`, `pocket-start`, `pocket-inbox` and `pocket-notify` stop waiting for the daemon after 30 seconds. [S2-C4-2, S2-C4-3, S2-C1-3]
  Operators: a saved trusted rule with a bare `#` word or a `VAR+=` first word is now refused (logged and skipped). See docs/action-approvals.md and docs/operations.md.
- Migration: none.

## [1.73.7] — 2026-10-21 · build 149

- **Child processes and lifecycles.** The fifth batch from the 2026-10-21 triage of the external review (SUMMARY items 7, 12, 13, 14 and the high lane's groups 7, 10, 11). Pocket managed the programs it starts one pid at a time; now it manages them as groups and proves a recorded pid is its own before signalling it:
  - **Vault runs** (`vault.mjs`): the command leads its own process group. A timeout, an abort or the output cap signals the whole group (TERM, then KILL after five seconds), and so does the command's own exit, so a grandchild holding the output pipe no longer keeps the run (and one of the eight run slots) open and a run cannot leave a daemon behind with the values in its environment. A run finishes within about two seconds of the command's exit. [S2-B4-1, S2-B4r-2, S2-B4r3-1]
  - **Thumbnail renderers** (`thumbnails.mjs`): each renderer leads its own group; the time budget kills the group, and the renderer's exit sweeps any helper it left. [S2-A5-2]
  - **Codex** (`codex.mjs`): closing a session escalates to SIGKILL after five seconds, so a hung app-server no longer holds the thread's writer lock; a reader whose initialize fails is closed, and of two reads that meet one exited reader only the failed instance is retired; a session record carries the boot id and the start times of the app-server and its keeper, and adoption signals or adopts a recorded process only when they match (a pre-1.73.7 record counts only when it was written after this boot); the record is written to a temporary file and renamed; the keeper gets the agent environment, not the daemon's; a session log is drained at most 1 MiB per pass. [S2-F6-7, S2-F2-4, S2-F2-5, S2-F6-1, S2-F6-3, S2-F6-4, S2-F6-6]
  - **Reminders** (`server.mjs`): one check runs at a time, and each item is checked against the store again right before it is marked, so a slow push or mail server no longer announces items twice and an item rescheduled mid-run keeps its new notice; a hook run leads its own group, keeps the last 4 KB of stderr, is ended after `POCKET_REMINDER_HOOK_TIMEOUT_MS` (default 60000) and when the daemon exits. [S2-A7b-1, S2-A7b-2, S2-A7b-3, S2-A7b-4]
  - **Voice** (`voice.mjs`): a malformed `POCKET_VOICE_COMMAND` turns voice off with a reason instead of stopping the daemon from starting; an idle time that is not a positive number means the default; a stop reaches an engine still starting and follows SIGTERM with SIGKILL; a late exit of an earlier start no longer clears a newer one. [S2-V1-5, S2-V1-6, S2-V1-1, S2-V1-4, S2-V1-2]
  Operators: a Vault run that starts a background service expecting it to outlive the run will now see it stopped; a reminder hook that runs longer than a minute needs `POCKET_REMINDER_HOOK_TIMEOUT_MS`. See docs/operations.md "Process lifecycle", "Runs", "Reminders and due tasks" and "Voice engine", and SECURITY.md.
- Migration: none. Codex session records written by 1.73.6 are adopted as before when they were written after the current boot.

## [1.73.6] — 2026-10-21 · build 148

- **Validate, write, then install.** The fourth batch from the 2026-10-21 triage of the external review (SUMMARY items 6, 8, 10, 11). Every store applied a change field by field on the live record and saved last, so a check that failed on a later field left the earlier ones applied in memory for the next save to persist, and a failed write (disk full, permissions) left memory ahead of disk. Now each store computes the next state on a copy, writes it, and installs it only once the file holds it:
  - **Vault** (`vault.mjs`): adds, edits, removals, restores, recipe removals, releases, purges and imports; a passphrase change or a key rotation takes up the new salt or key only after the write, so a failed passphrase change no longer leaves a salt neither passphrase opens until restart, and a failed rotation no longer lets the next ordinary save rewrite the store under a key the owner was told had failed; `unlock` reads the salt from the file it opens; an *Always* answer writes its recipes before the request is marked answered and its waiters woken; an import is checked whole (values held to the same rules as an add; null rows skipped). `vault.enc` is synced to disk, file and directory, around its rename; the other stores keep temp-file-and-rename. [S2-B2-1, S2-B2-2, S2-B3-9, S2-B3r3-1, S2-B3r4-1, S2-B3r5-1, S2-B5-ROTATE, S2-B5R2-KEY, S2-B2-3, S2-B3r5-2]
  - **The key routes** (`server.mjs`): the recovery key is the key the store is written under (`vault.envKey`), not the daemon's copy of `.env`; a rotation whose store write fails puts `.env` back to the old key; a `POCKET_VAULT_KEY` set in the daemon's process environment rather than `.env` makes rotate (and a switch-on that would create a key) answer 409 `vault_key_preset` instead of writing a key the next start will not read. [S2-B5R-ENV]
  - **Settings** (`POST /api/settings`): every field is checked into a next object first; nothing is assigned, rebuilt (router, Access) or written until all of them pass. [S2-S1-2]
  - **Projects, files, tasks, start links**: the same copy-write-install shape in `projects.mjs`, `tasks.mjs`, `documents.mjs` and `starts.mjs`; `pocket-docs add` checks the session id, visibility and the library limit before copying the file in (a refused add no longer leaves a stray file for the next listing to adopt), and a copy whose record cannot be written is removed; a project's open reminders are no longer cut to 50 on reload; a board import skips null rows instead of crashing. [S2-A1-1, S2-A6-1, S2-A6-2, S2-A3-1, S2-C5-1, S2-A1-2]
  Operators: `DocumentStore.record()` no longer pushes into the list (callers commit it); `decide()` reads an item's policy as it is in the store now. See docs/operations.md "Writes" and SECURITY.md "At rest".
- Migration: none. Files on disk keep their formats.

## [1.73.5] — 2026-10-21 · build 147

- **The browser relay fills less and scrubs more.** The third batch from the 2026-10-21 triage of the external review (SUMMARY item 4), all in `scripts/pocket-mcp-proxy.mjs`:
  - **Pictures are withheld once a value has been typed.** Image, audio and blob content passed the relay untouched, so a screenshot taken after a fill showed the typed value to the model whenever the page rendered it. From the first fill on, such content is replaced by a note for the rest of the relay's life; text snapshots still work. [S2-B8-2]
  - **Values go into fill tools only.** Any tool call naming a placeholder was filled, `browser_evaluate` and `browser_navigate` included. Now only `browser_type`, `browser_fill_form`, `type` and `fill` are filled, or the list in `POCKET_VAULT_FILL_TOOLS`; another tool that names a placeholder is refused and never reaches the server. [S2-B8-4]
  - **Scrubbing covers object keys, numbers and booleans** that spell a value, not only strings; a value the owner changes between two fills stays on the scrub list under its earlier spelling; and the server's stderr goes through the streaming scrubber (decoded as UTF-8, a value split across two chunks is still caught; half a second of silence flushes the held tail). [S2-B8-1, S2-B4r2-3, S2-B8-6, S2-B4r2-4]
  - **Hygiene.** The server starts without any of the daemon's own secrets (the same list `agentEnv` keeps from agent turns, `POCKET_VAULT_KEY_PREVIOUS`, the mail address and the router key included); an answer from the daemon that is not one string per placeholder types nothing; calls that need a release run one at a time and a client that closes while one waits still gets its answer; a signal passed to the server is followed by SIGKILL after five seconds. [S2-B8-5, S2-B8-7, S2-B8-8, S2-B8-3]
  Operators: a relay in front of a server whose fill tools have other names needs `POCKET_VAULT_FILL_TOOLS`; agents are told (skill and instructions) that screenshots are unavailable after a fill. `DAEMON_SECRETS` is now exported from `environment.mjs`.
- Migration: none.

## [1.73.4] — 2026-10-21 · build 146

- **A Vault request is bound to what it is for and to who raised it.** The second batch from the 2026-10-21 triage of the external review (SUMMARY item 2). A pending request was looked up by its id alone when continued (`pocket-vault wait`, or the browser relay calling again after the owner allowed), so a run the owner allowed could be continued through the fill route and come back in plaintext, any holder of the CLI token who learned the id could continue someone else's request, two continuations of one answer both released, nothing re-checked an item's policy after the approval, a full run table used the approval up without a run, and an *Always allow* on a browser fill also covered a run of the literal command (and the reverse). Now:
  - a request records its kind of use (`action`: run or fill), every binding by item id, and its caller (actor, session, and the SHA-256 of the runner token when there is one); views never show the caller;
  - a continuation must be the same kind of use, by the same caller, and not yet used; that is checked before waiting on the answer and again, in one synchronous step, after it: the bindings are resolved again by item id against the store as it is now, the policy decision is re-run (an item made owner-only since refuses; a removed item or field, or an item that now needs an approval the answer did not cover, sends the agent back to ask; a renamed item still releases), and the row is marked used;
  - the run table's capacity check comes before the approval is used, so a full table leaves it for the next try;
  - recipes record the kind of use; a recipe saved before this version is read from its command (`pocket-fill …` is a fill);
  - answers and waits sweep expired requests first, and a new request never lands on an existing id.
  Operators: a terminal or code-server call (CLI token, no runner token) keeps working and shares the one identity `terminal`; see SECURITY.md. [S2-B3r-1, S2-B3-1, S2-B3-3, S2-B3-2, S2-B3r2-1, S2-B5-CAP, S2-B3-5, S2-B3-8]
- Migration: none. Pending requests live in memory only; recipes saved earlier keep working.

## [1.73.3] — 2026-10-21 · build 145

- **Secrets, crashes and scrub forms.** The first batch of fixes from the 2026-10-21 triage of the external review of 1.58.0 against 1.73.2 (his row ids in brackets):
  - **The mail password and the router key stay with the daemon.** `.env` was copied into the process environment and only the login, cookie, push and Vault keys were removed again, so `POCKET_SMTP_URL` (its URL carries the SMTP password), `POCKET_SMTP_FROM` and `POCKET_ROUTER_KEY` reached every agent turn, hook, keeper and `pocket-vault run` child. They are now read once at start and removed, as the Vault key already was. Operators: a hook or agent that read them from its environment no longer can; nothing else changes. [S2-S1-1]
  - **A bare `null` from a Codex app-server no longer stops the daemon.** A stdout line that parses as JSON but is not an object threw inside the reader's timer and the process exited with every open stream. Such lines are skipped, and the timer catches whatever else a frame throws. [S2-F2-1]
  - **Scrubbing knows the other JSON spellings.** PHP's `json_encode` writes `/` as `\/`, Python's `json.dumps` writes non-ASCII as `\uXXXX`, and a JSON string inside a JSON string is escaped twice; a run's output in any of those forms passed unscrubbed. All three are now forms of every value, in the streams and in the browser relay. [S2-B4r4-1, S2-B4r3-2]
  - **Locking the Vault while agents wait.** A lock woke waiting requests with no answer: the run showed the agent a TypeError and the fill route never answered, so the browser relay's tool call hung for minutes. Waiting requests are now answered *locked* (the run reports it and `pocket-vault` exits 3; the fill answers `423 vault_locked`), the fill route answers 500 instead of hanging on anything unexpected, and the relay's request to the daemon times out after the wait plus 15 seconds. [S2-B3-4]
  - **Signed out, `/api/me` says only which mode the install is in** (the name the sign-in page shows); which modules are on is told after sign-in. [S2-G3-1]
  - **Runner tokens are compared in constant time** on their digests, as the CLI token is. [S2-B5a-1]
- Migration: none.

## [1.73.2] — 2026-10-20 · build 144

- **A search can no longer stall a session.** Each session's input pipe (the named pipe Pocket writes approvals, messages and Stop into) sat in `turnlogs/` beside the logs. An agent searching that folder for a session id opened a running session's pipe and kept reading it, so from then on the session's approval, a message sent to it and every Stop went to the search; the session waited on an approval it never received. Pipes now live in a private folder outside the data directory, `$TMPDIR/pocket-code-pipes-<uid>/<install>/{claude,codex}` (mode `0700`, one per install so two daemons never sweep each other's pipes), or under `POCKET_PIPE_DIR` when set. Found on 2026-10-20 when a quote session sat for 15 minutes after its approval was allowed.
- Migration: none. A session process started by an older version keeps its pipe in `turnlogs/` and is adopted from there after the restart; new processes use the new folder.

## [1.73.1] — 2026-10-20 · build 143

- **Inbox Watch reuses an existing Google sign-in.** With `mail.auth = "oauth"`, the watcher renewed the token for `gmail.readonly` only, so a sign-in granted to another app for broader Gmail access (`gmail.modify`) failed with `invalid_scope`. It now renews with the scopes recorded in the token file and still only reads. Found setting up Inbox Watch for a second mailbox whose assistant already had Gmail access.
- Migration: none.

## [1.73.0] — 2026-10-20 · build 142

- **Your rules for Inbox Watch.** Settings → Inbox Watch opens on **Your rules** (both modes): a box for your own words about what you always or never want to hear about. It shows the watcher's preferences file, including the lines **Not useful** added; Save replaces the file (the watcher keeps the previous one) and applies from the next check. Asked for by the owner ("I want to know about every sale", "never tell me about cameras that go down").
- **The rules win, everywhere.** The watcher now puts the rules at the end of every decision, look-ahead and tidy turn, after the material, with an instruction that they override its own judgment, including what counts as critical; the first pass gets them too, so mail a rule asks to hear about is never skipped. Tested on real past mail: with "never tell me about cameras that go offline" four camera notices went from alert or digest to ignore (two runs each, including one the default sent as an alert); with "tell me about every sale" a merchant receipt went from skipped (0.80) to reviewed (0.01) while a shipping notice stayed skipped. (Placed before a long bundle, as the preferences were until now, a "never" rule lost to the built-in guidance.)
- `checkWatch` accepts `rules` (text, up to 8,000 characters); `pocket-inbox watch` summarizes them; the skill explains changing them when asked.
- Migration: none. An existing preferences file appears in the box as it is.

## [1.72.0] — 2026-10-20 · build 141

- **Inbox Watch's watcher is part of Pocket Code.** The program that reads the mailbox, judges it and fills the Inbox (`inbox-monitor` 0.3: the schedule and its periods, model and reasoning choices, the first pass, the tidy pass, cost per call, replay) now lives in [`inbox-watch/`](inbox-watch/README.md) and is versioned and released with Pocket. It still runs beside Pocket on its own timer, with a config file per mailbox. Asked for by the owner ("I meant for this to be all a part of Pocket Code").
- Imported without its earlier private history. Its prompts and examples use invented names; an owner's own subject boilerplate (a company name, a shared mailbox's prefix) is now the `[owner] noise_words` config key instead of being built in.
- CI also runs the watcher's tests (`python3 inbox-watch/tests/test_schedule.py`).
- Migration: none for Pocket. An existing watcher can keep its install or point its launcher at `inbox-watch/` in the Pocket checkout.

## [1.71.0] — 2026-10-20 · build 140

- **The Inbox keeps itself tidy.** Settings → Inbox Watch gains **Keep the Inbox tidy**: *Take finished items off my list* and how often (every 1, 2, 4, 8, 12 or 24 hours; both modes). With it on, inbox-monitor 0.3's tidy pass checks each open entry against the mail since and takes it off as **Resolved** (the situation is over; the watcher stops following) or dismisses it as **Handled** (someone acted and it waits on someone else; the watcher keeps following), with the reason as the entry's note. It must cite the email that proves it; anything without proof stays. Asked for by the owner after a by-hand cleanup of 46 entries.
- **Open, Unread, Done.** The list opens on **Open** (unread and read, nothing finished); **Done** gathers resolved, not useful and dismissed entries, newest first, each row showing why it was finished (the note) instead of the alert's first sentence. The All and Dismissed chips are gone; `/api/inbox?state=all|dismissed` are unchanged.
- `checkWatch` accepts `tidy: {enabled, every}`; `pocket-inbox watch` prints it.
- Migration: none.
- Tests: the Inbox UI check walks Open → Unread → Open, resolves into Done, dismisses there and restores; the Inbox Watch check covers the tidy section in both modes and its save; `test/inbox.test.mjs` covers the tidy validation.

## [1.70.1] — 2026-10-20 · build 139

- **Digests read cleanly in Inbox.** A morning digest's text uses `## ` headings and `- ` bullet lines; the sheet showed them as raw marks and the row's preview began "## Worth knowing - …". The sheet now shows the heading in bold and the lines as bullets, and the row shows the first real sentence.
- **Docs:** the README features Developer mode or Assistant mode (with a picture of Assistant mode) and Inbox Watch (the list, the schedule sheet, the first pass and cost) near the top; the README screenshots were retaken from this build, with invented Inbox entries; the Inbox Watch plan is marked shipped.
- Migration: none.

## [1.70.0] — 2026-10-20 · build 138

- **Inbox Watch has a schedule you set.** **Settings → Projects, files, tasks & vault → Inbox Watch → Schedule, models and cost** (or **Schedule** beside the Inbox search box) opens one sheet: **Pause**; how often it checks mail the rest of the time; any number of **periods** (up to 12), each with its own days, hours and interval, including *Don't check* and hours past midnight; quiet hours; the morning digest; the morning and evening look-ahead (or off). Asked for by the owner.
- **Models and reasoning are settings too** (Developer mode): the model and reasoning level for the decisions every check makes, and for the twice-daily look-ahead, from the choices the watcher reports (Haiku, Sonnet, Opus and Fable for a Claude Code judge; *Model default* leaves the reasoning to the model).
- **First pass** (Developer mode): a fast classifier (TypeSafe Jev, OpenAI's decision model, or both agreeing) skips mail that is clearly routine before the model reads it, with its confidence threshold as a setting. Threads you wrote in, threads that mattered before and anything close to a story it follows are always read, and a skipped email's headline still reaches the model so a payment received or a camera back online can close a story. The cost table gains a **Skipped** column. Needs inbox-monitor 0.3's `[firstpass]` and an OpenRouter key on the watcher's side.
- **What it cost** (Developer mode): checks, model calls, tokens and dollars per day for the last 7 days, with a total. On a Claude or ChatGPT plan nothing is billed per call; the dollars are what the same tokens cost at API list prices, and the sheet says which applies.
- **How it works.** The watcher's heartbeat now carries a profile (its defaults from its config file, the choices it offers, what is in force, the next check, usage per day); Pocket keeps it per source. The owner's settings are kept per source with a revision; the watcher (inbox-monitor 0.3+) reads them every minute and reports which revision it applied. `GET/POST /api/inbox/watch` (owner cookie or loopback token, direct loopback only); `pocket-inbox watch`, `watch set (--every|--pause|--resume|--file)`, `watch reset`, and `seen --profile`. *Use the config file's settings* hands control back to the watcher's file. A paused watcher is no longer called silent in the list.
- Migration: none. `inbox.json` gains `profiles` and `watch`; an older watcher keeps its own timer and ignores both.
- Tests: `test/inbox.test.mjs` adds the settings validation, the profile and revisions, the routes and the CLI round trip.

## [1.69.3] — 2026-10-19 · build 137

- **The + button opens a clean conversation.** Opening an Inbox alert's *Start a conversation* (or a start link, or a task's or project's **Start**) put its briefing in the New-conversation draft, and leaving without starting kept it there, so every later tap of **+** on the phone opened that old briefing and the only way out was to delete it by hand. The briefing now lasts for that visit: **+** (and the rail's **+**, and Ctrl/Cmd+Shift+L) clears it unless you edited it. A draft you typed yourself is still kept. Reported by the owner.
- Migration: none. A briefing already stuck in a phone's draft from an earlier version is not marked as one; delete it once and the fix applies from then on.

## [1.69.2] — 2026-10-19 · build 136

- **Reading is not acting.** Opening an entry's sheet marked it read, and the list opened on the New filter, so a row vanished as soon as its sheet closed. The list now opens on **All** (everything but dismissed), the chips read **All · Unread · Dismissed**, the dot marks what is unread, and a row, the rail list and the Assistant-mode **Waiting for you** card stay until you dismiss the entry, mark it resolved or not useful. Asked for by the owner.
- Migration: none.

## [1.69.1] — 2026-10-19 · build 135

- **Read first, then decide.** A tap on an Inbox row opened the briefed conversation straight away. It now opens the entry's sheet: the whole text with Gmail links, then **Start a conversation** (a new conversation briefed with the story and the evidence; nothing starts until you press Start) or **Open in Files**, **Open in Gmail**, **Resolved**, **Not useful**, **Dismiss**. The Assistant-mode **Waiting for you** card opens the entry the same way. Asked for by the owner after the first tap on a live alert.
- Migration: none.
- Tests: the Inbox browser check taps a row and expects the sheet with *Start a conversation*; the home card's link is the entry.

## [1.69.0] — 2026-10-19 · build 134

- **Inbox.** A fifth optional library for what Inbox Watch sends. **Settings → Projects, files, tasks & vault → Inbox Watch** turns it on; `#/inbox` lists alerts, digests and look-aheads newest first by day, with **New**, **All** and **Dismissed** chips and a search box. A row opens the briefed conversation (the start link) or the Files document; **X** dismisses; the **…** menu shows the whole text with every citation a Gmail link, and records **Resolved** or **Not useful**, which a watcher reads back (`GET /api/inbox/feedback`, `POST /api/inbox/ack`) and applies on its next run: a story closed, a line added to the owner's preferences. **Restore** undoes any of those. Dismissed entries keep 30 days, the rest 60; the list says when the watcher has not reported in a day.
- **One call for a watcher.** `POST /api/inbox` (owner cookie or loopback token, direct loopback only, as for Tasks and start links) adds the entry **and** sends the push (the new kind *alerts*, urgent, opening the entry's link) and, when asked, the email. `scripts/pocket-inbox.mjs add|list|show|act|feedback|ack|seen` is the command; a `pocket-inbox` skill is written while the feature is on, so an agent asked "what did Inbox Watch send today" or "mark the Birchwood alert resolved" can do it. `pocket-notify` stays for other jobs.
- **The rail fits six.** The rail head's switch shows an icon for each library (Chats, Projects, Files, Tasks, Vault, Inbox); with five or more entries only the pressed one shows its name, the icon, `aria-label` and title carrying it for the rest. The phone's home gets an **Inbox** chip with the new count.
- **Assistant mode:** a new alert is a **Waiting for you** card on home, opening the briefed conversation.
- **Inbox alerts** are a push kind of their own in **Settings → Notifications & voice**, per device (finishing what 1.65 left for later; every device gets them until it turns them off).
- Migration: none. New optional settings key `inbox`; new file `inbox.json` in the data directory on first use. `/api/me` gains `features.inbox`.
- Tests: `test/inbox.test.mjs` (the store: states, dedupe, feedback and ack, prune, the cap; the routes: token and cookie, tunnel refused, feature off, add with push and email, act, feedback, seen; the CLI). The browser suite checks the six-entry rail at 1440, the list and its actions at 390 and 1440, the Settings switch and push kind, and the Assistant-mode card, with axe.

## [1.68.1] — 2026-10-19 · build 133

- **Mode is a choice you can read.** **Settings → Appearance → Mode** shows **Developer mode** and **Assistant mode** side by side, the one you are in pressed, in the same row style as Highlight colour. 1.60's single *Assistant mode* switch read as on or off, and off said nothing about what you were in; now the alternative is named and visible. Tapping the other option switches this Pocket on every device, as before. With `POCKET_ASSISTANT_MODE=locked` both options show disabled and the help line says where to change it. Asked for by the owner.
- Migration: none. Settings, `/api/settings` and `/api/me` are unchanged; only the control changed.
- Tests: the browser suite checks the Mode row in both modes (the pressed option, the two names, 44px targets) at 390 and 1440.

## [1.68.0] — 2026-10-19 · build 132

- **The Gmail, Calendar and Drive instructions reach the agent with every message.** 1.64 delivered `pocket-google` only as an installed skill, so a server running `POCKET_SKILLS=0` never saw it. Some servers run that way on purpose: their Codex home is shared with a chat container, where Pocket's installed skills would shadow the tenant's own. Each Claude turn (`--append-system-prompt`) and each Codex thread (`developerInstructions`) now carries one line, as Files, Projects, Tasks and the Vault already do: use this agent's connectors from Settings → Connectors, check whose Google account it is, draft every email and show it first, send when asked and never refuse, ask before sending invitations, and read `skills/pocket-google/SKILL.claude.md` or `SKILL.codex.md` in the checkout for the full procedure. The line needs no setting and does not depend on `POCKET_SKILLS`. A Codex `config.toml` with its own `developer_instructions` still keeps all of Pocket's lines out, as since 1.39 (those servers do not set one). Asked for by the owner.
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

- **Working in background.** A conversation whose reply had ended while a Bash command run in the background or a subagent was still going showed Response ready, then Recent, as if nothing were happening; the agent would wake later to report the job and the list gave no sign of it. The owner found three such conversations at once. The server has always had the CLI's background job list for each conversation (it already kept such processes from idle-closing and refused to release them); the status just never read it. A conversation with no turn and at least one background job now reads **Working in background · 1 job** (or **2 agents, 1 job**), confirmed, in its own group between Running and Activity elsewhere, with the ember in the dim ink and a slower breath in the row, the title bar and the open-conversation tabs, so it is told apart from a live turn: you can send, and the conversation will wake on its own. The row's detail line names the first job; the status tooltip lists them all. It counts in the summary line (`1 running · 2 in background`), the Active filter and the Sessions button, never ages out of the list and cannot be hidden. Response ready, the New marker and the spoken alert arrive when the agent's follow-up turn ends, and the **Done** push is held until then rather than sent while the work runs. Codex conversations are unchanged (no job list).
- **The page height follows the visible screen only on touch screens.** 1.64.3's iPhone fix made the page height follow the visual viewport everywhere; on a desktop that value updates a frame after a window resize, so the message box could briefly sit below the window. Desktops keep the browser's own height again.
- Merged as 1.66.0 (PR #113 was written as 1.64.0 on 1.58.0 and renumbered when it landed after 1.65.0; its wording follows 1.59: conversation, reply).
- Migration: none. New conversation state `background` (with `background: {count, summary, jobs: [{kind, description}]}`) in `GET /api/sessions` and `GET /api/session/:id`.
- Tests: `test/session-state.test.mjs` (background outranks a finished outcome and transcript activity, never a live turn or a usage wait; agent/job counting; the list keeps the conversation). `test/runner.test.mjs`: a fake-CLI reply that leaves a job running reads background with the job named, the push is held, and the agent's own turn ends in Response ready; the existing background tests follow the new state. The browser suite shows the row, group, summary, dim ember and title-bar state at 390px with an axe scan.

## [1.65.0] — 2026-10-19 · build 129

- **Alerts from agents and jobs.** `node scripts/pocket-notify.mjs --title "…" --body "…" [--url /#/start/<id>] [--tag <key>] [--email]` sends a push to every subscribed device (a new notification kind, *alerts*, that every device receives for now; urgent, like a due reminder) and, with `--email`, a message to the address in **Settings → Notifications & voice** when the server has `POCKET_SMTP_URL`. Over HTTP, `POST /api/notify` takes the owner's cookie or the loopback token (direct loopback only, as for the board and start links). The link must be a Pocket path or start with the public address; opening the notification goes there. Made for the owner's inbox monitor, which pairs it with a start link so an alert opens a briefed New session; any job on the server can use it. Nothing in the interface changes; the device toggle for the new kind comes with the notification settings rework. Issue #111.
- Merged as 1.65.0 (PR #114 was written as 1.58.1 on 1.58.0 and renumbered when it landed after 1.64.3).
- Migration: none. A device subscribed earlier receives alerts (no preference saved means everything, as before).
- Tests: `test/notify-api.test.mjs` (token and cookie accepted, tunnel and signed-out refused, a missing title and a foreign link refused, the public address trimmed to a path, the email written through the file transport and reported off when no address is saved, the CLI printing the result).

## [1.64.3] — 2026-10-19 · build 128

- **The message box stays on screen on iPhone.** The message field and its buttons are now one unit (`.composer-entry`): a percentage width on the field let iOS Safari push the row with the box below the screen, leaving only the chips. The page height also follows the visual viewport (`--app-height`), so the home indicator can't cover the box. This fix ran on the maintainer's server from October 17 as an uncommitted change; it is now released.
- Migration: none.

## [1.64.2] — 2026-10-19 · build 127

- **A file the conversation kept in Files gets a card too.** 1.61's cards needed the reply to name the file's path; an agent that keeps a report with `pocket-docs add --session …` and then says "it's in your Files" left nothing to tap (the owner, on a storm report). Every Files item linked to the conversation now shows as a card under the first reply after it was kept: the library's picture, its title and file name, **In Files** and **Download**. Tapping it opens the file in Files the way **Settings → Open files and links** says. A file already shown by a path card isn't repeated.
- Migration: none.

## [1.64.1] — 2026-10-19 · build 126

- **Try harder stays in view and uses Opus.** The button arrived after the finished reply had scrolled to the bottom, so it sat half under the message box; it now keeps the view at the bottom when you're there. It asks for Opus when Opus is offered (Fable stays a choice you make yourself), else the strongest offered model.
- Migration: none.

## [1.64.0] — 2026-10-19 · build 125

- **Claude and Codex know how to work in Gmail, Google Calendar and Google Drive.** A new agent skill, `pocket-google`, is written on every server next to `pocket-files` and the others, in two versions: Claude Code's (`~/.claude/skills`) names the claude.ai connectors (`mcp__claude_ai_Gmail__…`, `…Google_Calendar__…`, `…Google_Drive__…`, loaded with ToolSearch when deferred), and Codex's (`$CODEX_HOME/skills`) names the ChatGPT apps (`…gmail_…`, `…google_calendar_…`, `…google_drive_…`). Both are the connectors **Settings → Connectors** links (1.53). Each covers Gmail search syntax and reading whole threads before replying, an inbox report, free time before booking, and its own Drive tools: the Claude connector's `search_files` query syntax (`parentId = '…'` for a folder's contents, file types as `mimeType`), the Codex app's `list_folder` (a `url`) versus `get_file_metadata` (a `fileId`). Asked for by the owner.
- **Drafts first, sends when asked, never refuses.** Every email is written as a Gmail draft and shown in the chat, with "Send it, or change anything first?"; "send it" sends the saved draft (Claude: `send_message` with the `draftId`; Codex: `send_draft`), and "just send it" sends without the extra check. Claude's drafts include the person's Gmail signature (`includeSignature`). Calendar events with other attendees are shown before invitations go out, the same way. Drive deletes are confirmed by name first (Codex's are permanent; Claude's go to the Drive trash).
- **Whose account is it.** Before the first Google action in a conversation the agent finds the connected account (Codex: the app's `get_profile`; Claude, which has no profile tool: the primary calendar's id or the sender of the newest sent mail). When it is someone else's account, the agent says so and points to Settings → Connectors, and never asks the person to share their files with that other account. On one server, Codex's Drive app turned out to be connected to a colleague's Google account; the agent asked the person to share her folder with his address, and then misread a forwarded email that began with his first name as proof that her own inbox was his. The skill names both mistakes.
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

- **Start links.** An agent or a job on the server can hand Pocket a briefing and get back a link. Opening it signed in lands on New session with the briefing already typed in, in the workspace and with the agent the link named, and nothing starts until Start is tapped. Made for alerts that arrive elsewhere: the owner's inbox monitor sends a Telegram message with an **Open in Pocket Code** button, so handling one is a tap and a sentence rather than a copy and paste. `node scripts/pocket-start.mjs add --file <briefing.md|-> [--dir <workspace>] [--provider claude|codex] [--title …] [--ttl-days N]` prints the URL; `show <id>` prints a stored briefing. Over HTTP, `POST /api/start` and `GET /api/start/<id>` take the owner's cookie or the loopback token (direct loopback only, as for the board); a briefing may quote private mail, so nothing else reads one. Links expire after 7 days (1 to 30), `<data dir>/starts.json` keeps at most 500, a briefing is at most 20,000 characters. The URL uses the address the owner last signed in from (`POCKET_PUBLIC_URL` overrides); without one the CLI prints the path.
- Migration: none. New file `starts.json` in the data directory on first use.
- Tests: `test/starts.test.mjs` (the store's limits, ids and expiry; over HTTP: token and cookie writes and reads, signed-out and through-the-tunnel requests refused, an unknown id, the CLI printing the URL and showing an entry).

## [1.56.1] — 2026-10-16 · build 117

- **A restart no longer takes the agents' PATH away.** PM2 gives a daemon restarted through `ecosystem.config.cjs` the environment of the shell that ran the restart, and every Claude Code or Codex session Pocket starts inherits that PATH. A deploy over ssh, or from an agent's own shell, is not a login shell: the user's bin directories dropped off, and an MCP server registered by bare name (`memstem`, installed by pipx into `~/.local/bin`) failed with `Executable not found in $PATH` while the daemon, its health page and the memory service all looked fine. On one server every Pocket-started session ran without memory from October 5 to October 16 for this reason. The ecosystem file now appends `~/.local/bin`, `~/.npm-global/bin`, `~/bin` and the directory of the node running PM2 when they exist and are missing, keeping the current entries and their order first, so nothing is shadowed. Nothing to migrate: the next `pm2 restart ecosystem.config.cjs` applies it. [Operations: upgrade](docs/operations.md#upgrade-an-existing-installation) says what to do on an older checkout.
- Tests: `test/ecosystem.test.mjs` loads the file as PM2 does (only `apps` is visible), checks the pinned PATH keeps every current entry and adds the node directory without duplicates, and exercises the append, skip-missing and no-duplicate rules against a fake filesystem.

## [1.56.0] — 2026-10-16 · build 116

- **Read-only actions can run without asking.** In Review actions (the default) every Claude command, MCP tool call and web lookup showed an approval card, including harmless reads like a quote lookup or a memory search. **Settings → Agents & instance → Actions that run without asking** lists the read-only actions Pocket approves itself: when Claude asks to run one, Pocket answers Allow without a card; anything else shows the card as before. Rules are a subset of Claude Code's: `Bash(command:*)` (also written `Bash(command *)`), `Bash(exact command)`, `mcp__server__tool`, `mcp__server__*`, `WebSearch` and `WebFetch`. Edit, Write, NotebookEdit, Agent/Task, PowerShell and blanket rules (`Bash`, `Bash(*)`, `mcp__*`) are refused, with the reason under the field. Asked for by the owner, for employees who work in Review actions.
- **Strict matching.** A Bash command runs without asking only when it is one plain command whose first words are the listed ones, compared as written: any of ``; & | ` $ ( ) < > { } \``, a line break or other control character, an unquoted `*`, `?` or `[`, an unclosed quote, a leading `VAR=value`, a path or wrapper (`/tmp/acme-lookup`, `sudo acme-lookup`), a look-alike name (`acme-lookupx`, `acme-lookup-evil`) or an unexpected Bash option shows the card. Quoted arguments are fine. A server wildcard covers that server only (`mcp__memstem__*` does not match `mcp__memstemx__…`).
- **Same audit guarantees.** Each automatic approval is written to `approval-decisions.jsonl` before Pocket answers the CLI, as `"event":"auto-allowed"`, `"decision":"allow"`, `"source":"auto-trusted"` with the tool name and the rule, never the command or its arguments. If it cannot be recorded, Pocket falls back to the card. The blanket ask rules stay in place (they outrank allow rules in user and project settings). Full access and Codex turns are unaffected. A convenience, not a security boundary: a listed command runs with any arguments ([action approvals](docs/action-approvals.md#actions-that-run-without-asking)).
- **Where the list comes from:** a list saved in Settings (`trustedActions` in `pocket-settings.json`; an empty saved list means every action asks), else `POCKET_TRUSTED_ACTIONS` in `.env` (one rule per line or comma-separated; unusable rules are logged at start, shown in Settings and skipped), else none. Settings says which applies; **Use the server's list** forgets the saved one. A change applies to the next request, including in running turns.
- Migration: none. New optional settings key `trustedActions`; new optional env var `POCKET_TRUSTED_ACTIONS`. With neither set, behavior is unchanged.
- Tests: `test/trusted.test.mjs` (the matcher against injection, look-alikes, paths, env prefixes, globs, here-documents and MCP boundaries; rule validation and the env list) and `test/trusted-actions.test.mjs` (auto-allow bound to the live turn and audited first; over HTTP with the fake CLI: env default, a trusted Bash and MCP request answered without a card, untrusted ones still carded, Full access untouched, Settings validation and persistence, an empty saved list, an unwritable audit). The browser suite edits the list in Settings at 1440 and 390 with axe scans.
## [1.55.0] — 2026-10-16 · build 115

- **A Pocket can be locked to one workspace.** `POCKET_LOCK_CWD=1` beside `POCKET_DEFAULT_CWD` pins every session to that folder: the New session screen shows it under **Workspace** with *Every session starts here* and no picker or custom-path field, `GET /api/projects` answers with that one folder and `locked: true`, and a start that names another folder is moved there (logged, not refused), so a stale remembered workspace in a browser cannot escape it. Resuming a session keeps that session's own folder. Without a valid default folder the flag is ignored and logged. Made for staff seats, whose users should never have to think about folders; the seat provisioning kit sets it.
- Tests: `test/defaults.test.mjs` starts a locked daemon (one folder listed, a start elsewhere lands in the folder, the flag without a default is ignored); the browser suite shows the locked New screen (no radios, no path field, the summary names the folder) and the picker's return when the lock is off.

## [1.54.1] — 2026-10-16 · build 114

- **Only links to this Pocket's own things follow the setting.** 1.54.0 sent every link in a conversation through **Open files and links**, including outside websites, which it tried to show inside a pane or tab; a site that forbids that got a note instead of the page. The owner, on meeting the note for an outside site: "I really only meant for links that are to our own internal documents." Now a link to a file, a project, a session, a share or public link to one of your own files, or an image or file served by this Pocket opens the way the setting says; a link to any outside website opens in your browser, as before 1.54.0. The link view (`#/link/<address>`) stays for Pocket's own images and files only.
- **Removed:** the framing check (`GET /api/link/frameable` and `links.mjs`), the app's `frame-src https:` policy (back to `'self'`), and the refused-frame note. Nothing to migrate; the check kept no state.
- Tests: the browser suite now clicks a link to a kept file beside (a pane showing the file, the conversation staying put) and as a tab (Back to the conversation), and checks that an outside link is left to the browser under every setting. The fixture's first conversation ends with a link to a kept file when Files is on.

## [1.54.0] — 2026-10-16 · build 113

- **A link in a conversation opens the way files do.** Every link in a conversation used to open a new browser tab, whatever **Settings → Open files** said. The setting is now **Open files and links**, and a plain click on a link in a message (or in the Results panel) follows it: *as a tab* shows the page in this column with a tab in the strip, named by the link's text; *beside the conversation* opens it in a split pane (from a pane, a new pane to its left, as files do since 1.53.3); *in a new browser window* leaves the browser to it, as before. A Pocket address (`#/documents/…`, `#/projects/…`, a session) opens that view, following the projects setting for a project; a share or public link to one of your own files opens the file itself; a download link stays a download. Modified clicks (middle, Ctrl, Shift) keep the browser's behaviour. Asked for by the owner.
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

- **A file opened from a split pane gets a pane of its own, to the left.** With **Settings → Open files** (or **Open projects**) set to *Beside the conversation*, choosing a file inside the file library open in a split pane used to load the file in that same pane, over the library. The pane now asks the window around it for a new pane, placed to the pane's left (between the conversation and the library), so the list stays in view and the next file opens the same way. The same goes for a project chosen in a pane, a session chosen from a project card in a pane, and **Open beside** in a pane's file and project option sheets, which now say *In a new pane to the left of this one*. From the main conversation nothing changes: a new pane still goes to the right. The window still decides whether there is room (up to four views, each at least 380px wide) and says so when there is not. Asked for by the owner.
- Panes are inserted without moving existing frames, so the library's scroll position, search and selection survive, as before.
- Tests: the browser suite opens the library beside a conversation, picks a file in it, and checks that the file's pane appears to the left while the library pane keeps its frame and route.

## [1.53.2] — 2026-10-16 · build 109

- **Connectors names the real problem when a read fails.** On servers where Codex is signed in with ChatGPT and Gmail, Calendar and Drive are already connected, the sheet said *Codex could not list its apps. Check that it is signed in with ChatGPT*. The real cause: chatgpt.com sometimes answers a cloud server's connector-directory request with a Cloudflare bot check (an HTML page) instead of the list. The sheet now says *chatgpt.com turned away this server's request with a bot check … try again in a minute*. Timeouts and other failures read as such instead of blaming the sign-in, and the same goes for Claude Code.
- **A failed read is not kept.** 1.53.0 kept every result for a minute, failures included, so Refresh showed the same error. Failures are now logged on the server (`connectors: codex read failed: …`, a short detail, never the HTML page) and the next open or Refresh tries again.
- Tests: `test/connectors.test.mjs` covers the bot-check page (named, never shown), timeouts, HTML stripped from other errors, and that a failed read no longer blames the sign-in.

## [1.53.1] — 2026-10-16 · build 108

- **A signed-out Claude Code reads as signed out.** `claude auth status --json` exits 1 when nobody is signed in, though it still prints its status; Pocket treated the exit as a failed check. Accounts & instance said *Could not verify* (with **Switch account**) instead of *Not signed in* (with **Sign in**), and the 1.53.0 Connectors sheet listed Gmail, Calendar and Drive as *Not connected* instead of asking for a Claude sign-in first. Pocket now reads the printed status whatever the exit code; output it cannot read still counts as unknown. Found on shared installs right after the 1.53.0 rollout.
- Tests: `test/environment.test.mjs` covers a CLI that exits 1 with a signed-out status, and one that exits 1 with unreadable output.

## [1.53.0] — 2026-10-16 · build 107

- **Connectors: Gmail, Google Calendar and Google Drive for each agent.** **Settings → Agents & instance → Connectors** shows, for Claude Code and for Codex, whether each Google service is connected, with **Connect** or **Reconnect** beside the ones that are not and **Refresh status** to check again (it also checks again when you come back to the window after connecting). Pocket reuses the connectors the CLIs already have: Claude Code's claude.ai connectors (read with `claude mcp list`) and Codex's ChatGPT apps (read with the app-server's `app/list` and `app/read`). Anthropic and OpenAI hold the Google authorization, so Pocket stores no Google token and needs no Google Cloud project, and it works the same for every install. Neither CLI can make a first connection, so Connect opens claude.ai's connector settings or the app's chatgpt.com page. Both sets of tools go well beyond drafts: Claude's Gmail, Calendar and Drive connectors search, read, send, reply, label, manage events and create, edit and share files; Codex's Gmail, Calendar and Drive apps list 21, 15 and 45 tools. Asked for by the owner for the staff agent seats.
- The sheet explains instead of offering a broken button when connectors cannot work: Claude connectors switched off by `disableClaudeAiConnectors` (user settings or managed policy) or `ENABLE_CLAUDEAI_MCP_SERVERS=false`, a Claude or Codex sign-in that uses an API key, a signed-out CLI, or Codex turned off (`POCKET_CODEX=0`) or not installed. Connect links only ever point at claude.ai or chatgpt.com.
- `/api/connectors` (authenticated; `?refresh=1` forces a fresh read) returns each provider's rows. Results are kept for a minute, since `claude mcp list` health-checks every MCP server and a forced Codex refetch reads the whole app catalog (about 16 seconds); Codex reads only the head of `app/list`, where connected apps come first, instead of the full catalog (about 40 MB). New module `connectors.mjs`; `codex.mjs` exposes app reads only.
- Tests: `test/connectors.test.mjs` covers the `claude mcp list` parser, every switched-off and sign-in case, Codex paging, refetch on Refresh, admin-disabled apps and link validation; the HTTP test checks authentication and the response against the fake CLI; the browser suite checks the sheet at 390 and 1440 (states, link targets, Refresh, axe).

## [1.52.0] — 2026-10-15 · build 106

- **Choose which Claude models the picker offers.** **Settings → Agents & instance → Claude models in the picker** lists every Claude model Pocket knows; tap a row to offer it or stop offering it in the model menu on every device (at least one stays on). The choice is kept for the install in `pocket-settings.json`, outside the checkout, so updates leave it alone. For provisioning, `POCKET_CLAUDE_MODELS` in `.env` sets the list (comma-separated ids, e.g. `claude-sonnet-5-5,claude-opus-5-5[1m]`); a list saved in Settings wins over it, and **Use the server's list** goes back. With neither, every model is offered, as before. Asked for by the owner for the staff agent seats.
- **Claude Code's managed policy is honoured.** When `managed-settings.json` or `managed-settings.d/*.json` (`/etc/claude-code` on Linux and WSL, `/Library/Application Support/ClaudeCode` on macOS) sets `availableModels` or `deniedModels`, Pocket never offers a model the CLI would block, whatever the list says. Such a model keeps its row in Settings, marked *Blocked by this computer's Claude Code policy*. Matching follows the CLI's documented rules: drop-ins merged in name order, family aliases, version prefixes (and `availableModelsMatch: "exact"`), a specific version switching off its family's alias, `deniedModels` winning, and `[1m]`, dated and provider-prefixed spellings counting as the same model. File changes show within seconds, without a restart. MDM and claude.ai console policies are not visible to Pocket; the CLI still enforces them.
- **A blocked pick no longer runs on the expensive default unseen.** Before, a model the policy blocked was passed to the CLI, which silently swapped in the account default (on some installs the most expensive model), so picking Sonnet or Haiku to save usage could run Opus. The server now never passes a model the picker does not offer: the turn runs on Default and the response, a toast and a line in the conversation name both models. Default is `POCKET_CLAUDE_MODEL` only while it is offered, otherwise the CLI's own default; the Default row names a managed `model` ahead of `~/.claude/settings.json`. A saved Claude pick the picker no longer offers goes back to Default in the composer (a Codex model the menu does not list is still sent, as before).
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

- **Reminder pushes reach an idle phone.** A due task, a due reminder and a Vault request were sent at the push service's normal priority, which Android holds back while the phone is idle, so the 1.50.0 test reminders never showed on the owner's phone while the same pushes marked urgent arrived at once. Those three kinds are now sent with `Urgency: high`; a finished turn stays normal priority so a busy session does not keep waking the phone. Found with the owner.
- **The icon count can never cost a notification.** The service worker sets the app icon's count after the notification is shown, guarded, so a browser that refuses the badge still shows the notification.
- The browser suite's resizable-rail check waits for the shell after a viewport change that toggles touch emulation (Puppeteer reloads the page then); it was the suite's recurring flake on CI and locally.

## [1.50.1] — 2026-10-15 · build 103

- **Settings looks like settings.** The Settings button in the header and the rail drew a small circle with eight short rays, which reads as a sun (a brightness or light control), not a gear; a colleague raised it more than once. It is now an eight-toothed gear in the same 1.8px stroke, which also marks tool calls without a more specific icon. The composer's **Hide/Show message settings** toggle and **Permissions for the next turn** in a session's options use a new sliders icon, since they adjust one turn rather than open the app's Settings. No other change. Reported by a colleague, via the owner.

## [1.50.0] — 2026-10-15 · build 102

- **Tasks is the one due list.** With Projects on, every open project reminder appears in the Tasks list and the rail's Tasks list among the dated tasks, soonest first, so the due ones lead: the row names the reminder, its project and the step, opens the project card, and its hourglass (or options) offers Remind later and Dismiss. The Tasks badge on the rail switch, the phone's Tasks chip and the tab mark count due tasks and due reminders together, and the Projects segment stops counting while Tasks is on (a project's own card and tab still mark its due reminders). **Scheduled** (`#/projects/scheduled`) opens the Tasks list on such an install; the Projects list's chip reads **Reminders** and points there. Installs with Projects on and Tasks off keep Scheduled as it was. Asked for by the owner after a colleague found tasks and project reminders hard to tell apart.
- **A count on the app icon.** The installed app's icon shows how many tasks and reminders are due, on browsers that support it (Android, iOS 16.4 and later, Windows, macOS), updated whenever Pocket repaints its badges and, when a due item is announced, by the push itself, so a phone that has not opened Pocket shows the right number. **Settings → Notifications & voice → Count on the app icon** turns it off for a device.
- **Notifications, by kind and by device.** Settings → Notifications & voice now reads **Push to this device** (it was *Turn notifications*, though it already carried reminders and Vault requests) with three choices under it: **Finished turns**, **Due tasks and reminders** and **Vault requests**. The choices live with the device's subscription on the server (`/api/push/prefs`), so a phone can take reminders only while a desktop takes everything; subscriptions from earlier builds get everything, as before.
- **Answer a due notification where it arrives.** A due task's notification offers **Tomorrow** and **Done**; a due project reminder's offers **Tomorrow**. Tomorrow moves it to 9 AM the next day in the device's zone (a project reminder is replaced, the way Remind later works); Done finishes the task. Both go through the ordinary routes with the signed-in cookie; if the answer cannot land, Pocket opens instead. In the app, a dated task's sheet gains **Remind later** with the same quick picks as a project reminder.
- **A notice a day before.** **Settings → Notifications & voice → Notice a day before** (instance-wide) sends a second announcement 24 hours ahead of a dated task or reminder, by push, the reminder hook (with `ahead: true`) and email. An item set less than a day ahead gets only the due announcement.
- **Email, built in.** With `POCKET_SMTP_URL` (and `POCKET_SMTP_FROM`) in `.env`, **Settings → Notifications & voice** takes the address to email due tasks and reminders to, with **Send a test**. One short message per announcement, with a link to the list or card when the server knows its public address (`POCKET_PUBLIC_URL`, or the address the owner last signed in from). Pocket's own email is for due items only; the reminder hook remains for anything else. New dependency: `nodemailer`.
- **The counts show on every view.** The rail's Projects, Tasks and Vault segments only showed their counts after the Sessions home had loaded them or the segment had been opened; in a conversation, the badges stayed hidden until you clicked. The counts are now painted whenever the rail is drawn, from the cached lists at once and then from fresh ones, and refreshed every 30 seconds while the rail switch is on screen. Reported by the owner.
- `/api/tasks` and `/api/board` report `email`; `/api/settings` reports `email` (configured, from, to, hook) and `remindAhead`.
- Tests: `test/notify.test.mjs` covers push preferences (subscribe with prefs, read, change, old subscriptions), the settings (the address is checked, the day-before switch), announcements through the hook and a file mail transport for a due task, a due reminder and both day-before notices, and the test message; `test/tasks.test.mjs` covers the store's day-before rule; the browser suite checks the combined list, the badge handoff, the Scheduled redirect, Remind later on a task and the Notifications settings.

## [1.49.0] — 2026-10-15 · build 101

- **Start a session from a project.** Projects get the same Start that Tasks have. **Start session** on a project card (and first in the project's options) opens a New session in the project's directory with a briefing as the first message, ready to edit and send: where you left off, the next step, what it is waiting for, the open steps with their ids (up to 20), the last three notes, open reminders, the link, the last three sessions that worked on the project, and the `pocket-board` lines that keep the card current. The new session is linked to the project when it starts: `/api/new` takes an optional `project` and links the session for Claude and Codex alike, and a missing, finished or switched-off project never blocks the start. The project's chip beside Choose a skill shows which project the session will join; tapping it removes the link. The agent defaults to the one that last worked on the project, and a project's directory is chosen even when the install has a default workspace or the directory is not in the recent list. A briefing is not kept as a recent start. Requested by the owner.
- Task Start clears a pending project link, so a task's session is never linked to a project by an earlier Start session.
- Tests: `test/projects.test.mjs` starts a session with a project (linked, not a recent start) and with an unknown one (starts, logged); the browser suite checks the briefing, the directory, the chip, the payload, the link on the card and removing the link.

## [1.48.1] — 2026-10-14 · build 100

- **A just-sent Codex message no longer vanishes.** Pocket reads a Codex thread's history through a separate reader process, and that process has the new user message only a few hundred milliseconds after `turn/start` returns (measured against codex-cli 0.156.1). The client re-renders the conversation the moment the send is acknowledged, so it landed in that gap and dropped the optimistic bubble; the live stream then resumed after the turn's own `user` event, so the message stayed missing until the session was reopened. Claude sessions have been covered since 1.11.2; `/api/session/:id` now applies the same pending-message rule to Codex sessions, and the match allows for the "[Attached files…]" note Codex stores after the text when files are attached, so a message with attachments is not shown twice. Reported by the owner.
- Tests: `test/codex-session.test.mjs` sends a message the fake app-server writes to history 900 ms late, with and without the attachment note: shown at once as pending, replaced by the history item, never twice, nothing pending after the turn (fails on 1.48.0).

## [1.48.0] — 2026-10-14 · build 99

- **Codex context meter corrected.** Codex reports cached input tokens as part of its input tokens, not beside them the way Claude reports cache reads, and Pocket was adding the two. On a long session the ring read nearly double and sat at 100% from about 55% real (one session: 153k input, 152k cached, window 258k, shown as 118%). The context is the input alone now. Found, verified against every call in that session's rollout, and patched in place on two servers; this release carries the fix into the repository.
- **The meter reads the rollout.** A Codex session's context now comes from the rollout file Codex writes (`~/.codex/sessions/…/rollout-…-<thread>.jsonl`), the way a Claude session's comes from its transcript, so sessions run in a terminal or code-server show a figure too, and figures saved by the double-counting builds correct themselves on the next look. The daemon's own figure from `thread/tokenUsage/updated` remains the fallback.
- **Prompt-cache warmth for Codex sessions.** The ring's companion label (minutes left, amber in the last stretch, `cold`), the hourglass and snowflake tab marks on large sessions, the Prompt cache block in Usage and the `98% cached` / `cold start` note under a finished turn now apply to Codex sessions as well. Codex publishes no cache lifetime; OpenAI's guidance says five to ten minutes. Measured over 45,660 consecutive calls in 2,234 rollouts on the owner's server, every return after 60 to 120 idle minutes still read from cache (21 of 21) and every return after 150 minutes or more started cold (12 of 15, the rest partial), so Pocket uses two hours and the Lifetime fact says "measured; not published". Requested by the owner.
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

- **Select several files and remove them in one step.** **Select** beside Upload turns the Files library (list or grid) into checkboxes. Tick files, or **Select all** for what the search and filters show, and **Remove** moves them to the trash after one confirmation. A search or filter that hides a picked file drops it from the selection, so Remove never reaches a file out of sight. **Done** or Escape leaves select mode. Requested by a colleague.
- **Delete forever and Empty trash.** Removed files waited 30 days in the trash with no way to free the space sooner. Each file in the Trash now has **Delete forever** in its options, and the Trash has **Empty trash**; both ask once, then delete the file and its preview from the server at once. Owner only: the routes need the Pocket login from Pocket's own page, so an agent's `pocket-docs` can still move one file to the trash and never delete one. Requested by a colleague.
- **Previews go with their files.** Deleting a file (by hand or by the 30-day purge) left its preview pictures in `.thumbs/` for good. They are deleted with the file now, and each purge clears any picture whose file is gone, which also cleans up after earlier deletions. The purge also runs a minute after the server starts instead of waiting six hours.
- The Trash opens with a ▸/▾ beside its heading like the other collapsible sections, and stays open when the library refreshes.

## [1.44.2] — 2026-10-13 · build 95

- **Edit a saved value in place.** The Vault's Edit sheet started every field empty ("Unchanged"), and its **Show** only unmasked what you typed there, so on a saved field it showed nothing and a value could only be replaced blind, never seen and corrected. Now **Show** on a saved field loads its value into the box, one field per tap and recorded in the item's history as a view, the same as Show on the item's sheet. Change it and save; a value left as loaded is not sent, and one emptied is refused with a note instead of being kept silently (a custom field is dropped with **Remove**). A login's username loads the same way. A value with a line break opens in a box that keeps it. Adding and removing fields works as before. Reported by the owner, who had pasted extra text after an API secret and could neither see it nor trim it.
- **Line breaks show on the item.** A shown value keeps its line breaks, so text pasted on a second line is visible instead of running on.
- **The history names the fields an edit changed** ("Changed api_secret by you"). The audit row records the field names, never a value.
- Agents and terminals still cannot change or replace an item; correcting one is the owner's. Tests cover the store, the routes (owner, token, agent, cross-origin) and the browser at 390 and 1440px.

## [1.44.1] — 2026-10-13 · build 94

- **New projects, files and tasks show up without a reload.** Each list fetched its items once and then only on a 30-second poll while it was open, so something an agent added with `pocket-board`, `pocket-docs` or `pocket-tasks` could stay missing from the rail or a project card until the page was hard-refreshed. Now the lists refresh when the window comes back into view or focus, when a turn ends in any Pocket window on the device (a split pane, a window of its own or another tab, through a `BroadcastChannel`), and whenever the rail's Projects, Files or Tasks list is shown with data more than a few seconds old. Reported by a colleague.
- **A project card's Files section stays current.** It used the library loaded the first time and was never refreshed; it now reloads with the card and on the open card's poll.

## [1.44.0] — 2026-10-13 · build 93

- **The Vault sets up its own key.** Switching the Vault on in Settings no longer needs anyone to generate a key and edit `.env` on the server: when there is no key and no store yet, Pocket creates the key, saves it to this install's `.env` (mode `0600`, the file backups already leave out), opens an empty Vault, and shows a one-time **Save your recovery key** sheet with Copy and Download. Requested by the owner, so the people who run the other servers can turn it on themselves.
- **Download recovery key** in Settings → Vault gives the owner a copy at any time (recorded in the audit).
- **Rotate key saves the new key itself.** The new key is written to `.env` before the store is rewritten, with the old one kept beside it as `POCKET_VAULT_KEY_PREVIOUS` only until the rewrite finishes, so a crash in between still opens the Vault. No restart or manual edit.
- **Restore a missing key.** If a store exists but its key is gone (a lost `.env`, a rebuilt server), Pocket never creates a new key over it; Settings → Vault offers **Restore key**, which takes the recovery key (pasted, or the downloaded file), checks it opens the store, and saves it.
- An install with no `.env` file to write to (`POCKET_ENV_FILE` empty) still needs `POCKET_VAULT_KEY` set by hand. `POCKET_VAULT_KEY_PREVIOUS` is removed from every child's environment like the key itself.

## [1.43.1] — 2026-10-12 · build 92

- **Pocket's command-line tools can no longer be pointed at the wrong server by an inherited `PORT`.** `pocket-vault`, `pocket-board`, `pocket-docs`, `pocket-tasks` and the browser relay used to find the daemon from the `PORT` in their environment before Pocket's own `.env`. An agent working in a project that exports `PORT` (a dev server, say) would have sent Pocket's loopback access token to that app instead. The daemon now writes its address to `cli-url` in the data directory beside `cli-token` (mode `0600`), and the tools read it first, then this checkout's `.env`, and only then an inherited `PORT`. Found while testing Typed by Pocket live.
- **The browser relay retries once** if the answer to a fill is not the Vault's, and notes its status and type (never its body) on its own error output.
- `cli-token`, `cli-url`, `vault.enc` and `vault-audit.jsonl` are now in `.gitignore`, since the default data directory is the checkout.

## [1.43.0] — 2026-10-12 · build 91

- **Typed by Pocket: agents log into web pages without seeing the password.** `scripts/pocket-mcp-proxy.mjs` sits between an agent and a browser tool such as Playwright MCP. When a tool call names `{{vault:router-admin.password}}` (or any `{{vault:name}}` / `{{vault:name.field}}`), the relay gets the value from the Vault under your Agent access setting, types it into the call on its way to the browser, and replaces it with the placeholder in everything the tool sends back: its reply, page snapshots and logs. The model's tool call and the transcript only ever hold the placeholder. A call with no placeholder passes through untouched. Requested by the owner.
- **Same rules as a run.** Free rein fills at once; *Ask once per command* and *Ask every time* raise a Vault request (shown as "Fill into the browser tool"), answered from the push, the Vault view or the conversation, and the agent calls the tool again once allowed. *Only you* items are never filled. Each fill is recorded in the item's history as "Filled into a browser"; the value never is.
- **Setting it up.** Point the agent's browser tool at the relay, for example `claude mcp add playwright -s user -- node <pocket>/scripts/pocket-mcp-proxy.mjs --name playwright -- npx -y @playwright/mcp --headless --no-sandbox`. See the operations guide. Why not a Claude Code hook: hook output is written into the session's transcript file, which would put the value in the record the Vault exists to keep clean.
- Placeholders may now name a field: `{{vault:name.field}}`.

## [1.42.0] — 2026-10-12 · build 90

- **Pocket catches a secret before it is sent.** Paste an API key, token, private key, card number or "password: …" into a message and Pocket holds it instead of putting it in the box: **Store in the Vault** saves it under a suggested name and puts `{{vault:name}}` in the message, so the agent uses it by name and the value never reaches the model, the transcript or MemStem; **Paste as is** and **Cancel** are there too. The pasted text is held in memory only, never in the draft. The same check runs when you send, so a key typed or dictated into a message is caught too, with **Store and send**, **Send as is** and **Edit**. Requested by the owner.
- **The server enforces it.** A message that reaches Pocket with something secret-shaped in it is refused before anything is dispatched or receipted (`422 secret_detected`), naming what was found and where but never the value, unless it is sent anyway. The daemon log records only the kinds found.
- **What counts.** Known formats (OpenAI, Anthropic, OpenRouter, GitHub, GitLab, AWS, Stripe, Slack, Google, Twilio, SendGrid, signed JWTs), private keys, a password inside a URL, card numbers that pass the checksum with a card issuer's prefix, and assignments like `api_key: …` whose value has a digit or symbol. A pasted lone token that looks random is also offered. Placeholders, commit hashes, UUIDs, URLs, paths and words like "required" are left alone. Detection is a backstop, not a guarantee; storing a secret in the Vault first is still the surest way.
- Settings → Vault → **Catch secrets in messages** (on by default) turns the check off for the install. It works whether or not the Vault itself is on; with the Vault off, the sheet warns and lets you paste or cancel.

## [1.41.0] — 2026-10-12 · build 89

- **Agent access: approval is a dial, not a rule.** The Vault's job is to keep credentials out of conversations, transcripts and memory while agents still use them; how often you approve that use is now your choice. Settings → Vault → **Agent access**: *Free rein* (agents use any secret by name without asking; every use is still recorded and values never enter the conversation), *Ask once per command* (the 1.39 behaviour, and the default for a new install), or *Ask every time*. Each item follows that setting unless you set it otherwise: *Free rein*, *Ask once per command*, *Ask every time* or *Only you*. Items that were *Agents ask* by default now follow the setting. Requested by the owner.
- **Approve from the notification.** A Vault request push now has **Allow** and **Deny** buttons, so a request can be answered without finding it in Pocket.
- **Approve in the conversation.** When a run is waiting, the agent says so and ends its reply with *Allow zeta-books for this command* and *Deny zeta-books* as suggested replies; tapping or typing one in that conversation answers the request (a bare "Allow" works when only one is waiting). Only your own messages count, and only for requests raised by that session.
- *Always allow* is not offered for an item that asks every time.

## [1.40.0] — 2026-10-12 · build 88

- **A passphrase for the Vault.** Settings → Vault → **Set a passphrase** re-encrypts the store under a key derived from a passphrase you choose (12 characters or more, scrypt), held only in the daemon's memory. After a restart, or after **Lock now**, or after the idle time you pick under **Lock after** (15 minutes to 24 hours, or never), the Vault is locked: nothing on the server can open it, agents get "The Vault is locked" (exit code 3) and you get one push, and the Vault view shows **Unlock**. Wrong passphrases are limited to ten an hour. **Change passphrase** and **Remove passphrase** (back to the server key in `.env`) are there too. There is no reset: a forgotten passphrase means the store cannot be opened, so keep it in your password manager and keep an export. Requested by the owner.
- **Export and import.** Settings → Vault → **Export** downloads every item, values included, as one `.pvault` file encrypted under a passphrase you type for it; **Import** reads such a file into this or another Pocket Code, adding items whose names are new and listing the ones that already exist. Both are owner-only and recorded. A removed item is not exported; last-used stamps are not carried over.
- The locked state, the passphrase, exports and imports are recorded in the audit log (`lock`, `unlock`, `unlock-failed`, `passphrase-set`, `passphrase-removed`, `export`, `import`). `Rotate key` applies to the server-key mode only. `vault.enc` now starts with a format byte of 2 in passphrase mode; 1.39 files keep working.

## [1.39.1] — 2026-10-12 · build 87

- **Custom fields in the Vault.** Any item can carry named fields beside its kind's fixed ones: **Add field** in the editor takes a name (lowercase letters, digits and underscores, up to 32 characters) and a value, encrypted like the rest, shown masked with Show and Copy on the item sheet, and bound by agents as `name.field`. A new **Credentials** kind has no fixed fields at all, for things like a client ID and a client secret named the way the service names them. `pocket-vault put` takes several fields at once from a JSON object on standard input or in a file; `show` lists every field. Up to 20 custom fields per item; removing one is an edit, fixed fields stay. Requested by the owner, for a shipping API and a payment gateway.

## [1.39.0] — 2026-10-12 · build 86

- **The Vault.** A fourth library beside Projects, Files and Tasks, for API keys, tokens, logins and secure notes that agents need to do real work. It is off until **Settings → Projects, files, tasks & vault → Vault** turns it on for the whole install, which needs `POCKET_VAULT_KEY` in `.env` (32 random bytes in base64: `openssl rand -base64 32`). The Settings category was *Projects, files & tasks*. Requested by the owner.
- **Encrypted in one file.** Items and their approved commands live in `<data dir>/vault.enc`, one AES-256-GCM blob with no plain-text names or other metadata on disk; an altered file or a wrong key fails closed. The daemon reads the key at start and removes it from its environment, so agent turns, helpers, hooks and every other process it starts never see it. **Rotate key** in Settings → Vault re-encrypts the store and shows the new key once; the old key keeps working until you put the new one in `.env` and restart. Back up `vault.enc` and `vault-audit.jsonl` with the data directory and keep the key somewhere else.
- **Agents use secrets without seeing them.** `pocket-vault run --env TOKEN=zeta-books -- <command>` asks Pocket's daemon to run the command with the value in its environment, never in its arguments, and returns the output with each value (and its base64 and URL-encoded forms) replaced by `{{vault:name}}`. Output is capped at 1 MB and a run stops after 10 minutes unless `--timeout` says otherwise. There is no command that returns a value. `list` and `show` give names, kinds, URLs, tags, policy, expiry and last use; `put` lets an agent store a secret it meets, create-only, with the value from an environment variable, a file or standard input; `history` shows the session's own uses. Exit code 3 means the Vault is off, 4 that a request is waiting.
- **You approve each new command.** Each item has a policy: *Ask* (the default) runs a command you saved with *Always allow* and otherwise sends a "Vault request" push to your devices, answered with *Allow once*, *Always allow* or *Deny* in the Vault view; *Auto* runs any command; *Owner* keeps agents out. The agent waits 90 seconds, then reports `pending` and picks up your answer with `pocket-vault wait`; a request expires after 15 minutes. A saved recipe is exact (program, arguments and folder), so a changed argument asks again.
- **Every use is recorded.** Runs, requests, answers, views of a value, additions, changes, removals, restores and rotations go to `vault-audit.jsonl` (mode `0600`, append-only) with the session and the command, never a value. Each item's sheet shows when it was last used and its history. Agent processes carry a runner token so the record names the right session; calls from a terminal or code-server are recorded as `terminal` and follow the same policy.
- **The Vault view.** Add, edit, remove and restore items (removed items wait 30 days), see a value one field at a time on tap with Copy, set the policy, manage recipes and answer requests. Vault responses are `no-store`, stay out of the service worker, refuse changes from another origin, and values are never stored in the browser. **Store in the Vault**, in the composer's attach sheet and a session's options, opens the add sheet so a secret never enters the message. Pasted secrets are not detected automatically in this release.
- **Agents are told.** While the Vault is on, every turn's instruction says to refer to secrets by name and use them with `pocket-vault run`, never to print, write or send a value, to store any secret met at once and say it was seen, to wait on a pending request and stop on a refusal, and that `{{vault:name}}` in a message is the owner handing over a stored secret. A `pocket-vault` skill is installed for Claude Code and Codex. Turning the Vault on restarts idle agent processes so the rules reach them; running sessions get them from their next turn. Settings warns when Codex's `config.toml` sets `developer_instructions`, which stops Pocket's line reaching Codex.
- **Limits, stated plainly.** Agents run as the same OS user and could read `.env` and the store; the Vault keeps secrets out of prompts, transcripts, memory, backups and the provider and makes use visible, but it is not process isolation. A command the daemon runs does so with the daemon's permissions, outside the agent's sandbox, so under Codex's Review mode `pocket-vault run` cannot reach the daemon and needs Full access. Scrubbing output cannot stop a command that writes or sends a value elsewhere. See [SECURITY.md](SECURITY.md#vault).

## [1.38.1] — 2026-10-12 · build 85

- **An open file stays put while you read it.** Files re-checks the library every 30 seconds so new files, shares and project changes show up without a reload. With a file open, that check rebuilt the whole viewer, including the frame that shows an HTML report or PDF, so the document reloaded and jumped back to the top, most noticeable when a long report sat in a split pane. The check now redraws only the toolbar and the title line; the document is reloaded only if the file itself changed. A browser test checks that a repaint keeps the same frame. Reported by the owner.

## [1.38.0] — 2026-10-11 · build 84

- **Light, Dark and System.** Settings → Appearance adds a per-browser colour mode. System follows the device's preference and updates while Pocket is open. Existing browsers with Pocket preferences keep dark mode; new browsers start with System. Explicit choices survive reloads, and windows and split panes update without rebuilding a conversation or losing its draft.
- **Paired palettes.** Warm paper joins the existing warm ink interface. Orange, blue and purple highlights, message text, button labels, status colours, diff tints, shadows and native controls adapt together. Dark blue and purple highlights and the error colour were adjusted for readable small text.
- **Startup and offline.** A small same-origin script resolves appearance before the stylesheet and app load; it is included in the service-worker shell. Browser chrome follows the selected mode. Document and media canvases keep their original appearance; Pocket-rendered Markdown and tables follow the app.

## [1.37.2] — 2026-10-10 · build 83

- **Files keeps its previews in split view.** A split pane is a frame of its own, usually 380 to 650px wide, and the library treated anything under 700px as a phone, so in a pane it fell back to the list and hid the List/Grid buttons. A pane now gets the grid at any width, with a 160px minimum card so the narrowest pane holds two columns, and the List/Grid buttons show there; the choice is still shared with the tab. Phones keep the list. Requested by the owner.

## [1.37.1] — 2026-10-10 · build 82

- **The reminder command no longer sees Pocket's secrets.** `POCKET_REMINDER_HOOK`, run when a project reminder or a dated task comes due, used to start with the daemon's whole environment, including the login password (`POCKET_PASSWORD`), the cookie-signing key (`POCKET_SECRET`) and the push private key (`VAPID_PRIVATE`). It now gets the same filtered environment as agent turns, so those three are removed; everything else (PATH, PORT and your own variables) is unchanged. Found by the 1.37 documentation audit. A test checks that the hook cannot see them.

## [1.37.0] — 2026-10-10 · build 81

- **Agents offer tasks.** While Tasks is on, an agent that reaches a point you will need to come back to (a report that needs weeks of data, a test still to run, someone else's reply, a step you chose to put off, a date you mentioned) offers once to add a task, as one of the suggested-reply buttons at the end of its turn, written as you would say it: *Remind me Nov 7 to recheck the numbers*. With suggested replies off it asks in one line. Nothing is added unless you tap it or say yes, an offer you pass on is not repeated, and there is no offer for work the agent is about to do or for trivial errands. Requested by the owner.
- **Accepted offers carry the context.** The agent files the task with the session, a two-to-four-sentence briefing it writes from the whole conversation (what is being worked on, where it stands, what finishing needs) and the date or time from the offer. Pocket's per-turn instruction and the `pocket-tasks` skill say so for Claude Code and Codex.
- **Tasks from agents know their session.** `pocket-tasks add --session` now gets that session's title and workspace filled in by the server, as the Add task button does, so the list says where the task came from and **Start** opens New session in the right folder. An explicit `--dir` or title still wins; without a session id, agents are told to pass `--dir`.

## [1.36.0] — 2026-10-10 · build 80

- **Tasks.** A third library beside Projects and Files, off until **Settings → Projects, files & tasks → Tasks** turns it on for the whole install. A task is one line of text with an optional date and time, the session it came from and, when you ask for it, a short briefing on that session. The list (`#/tasks`) opens like a session: a tab, a split pane, its own window, or full-screen on a phone; open tasks come first, due ones at the top, finished ones collapsed under Done. The rail switch reads Sessions | Projects | Files | Tasks with the count of due tasks; the phone's session home gets a Tasks chip. A dated task is announced once when it comes due, by push with a link to the list and to the server's reminder hook (`kind: "task"`); it stays due until it is done or re-dated. Requested by the owner.
- **Add task from a conversation.** An **Add task** chip in the message toolbar beside Add project (a check-box button in the working row while a turn runs) and **Add task** in a session's options open the editor with the session remembered. *Include a summary of this session*, on by default there, asks the titles helper (Haiku or Codex) for a two-to-four-line briefing on the whole session so far and keeps it with the task; if no helper is available or the session is too short the task is added without it and the editor says so.
- **Start a task.** From a task's sheet, **Start** opens New session in the task's workspace with the task text, its briefing and its id as the draft, editable, so one tap of Send begins the work; an agent finishing it marks the task done. **Open the session** goes back to the conversation the task came from.
- **Agents keep tasks.** `pocket-tasks add "…" [--due] [--session] [--summary]`, `list`, `show`, `done`, `reopen`, `edit`, `remove` over the same loopback token as `pocket-board`; a `pocket-tasks` skill ships with Pocket and is installed for Claude Code and Codex while Tasks is on; Pocket's per-turn instruction tells agents to create a task only when the user asks, typed or spoken, to give it a time only when one is named, and to write the summary themselves when the user wants the context.
- **Add project.** The conversation's project chip and the session option now say *Add project* (the sheet is *Project for this session*); it still tracks a new project around the session or links it to an existing one. Requested by the owner.

## [1.35.0] — 2026-10-10 · build 79

- **Files opens where the button says.** The sidebar's Files list has three buttons: **Upload**, **Split** (the library in a pane beside the current view, desktop only) and **Tab** (the library as a tab). They replace *All files*, whose behaviour depended on a setting. Screen readers and tooltips name them in full: Open the file library in split view / in a tab. Requested by the owner.
- **The Files button can open the library directly.** Settings → Projects & files → **Files button**: list files in the sidebar (default), open the library in a tab, or open it in split view. Arrowing across the sidebar switch only focuses a Files button set to open the library. **Open files** still decides how a single file opens. Requested by the owner.
- **New session names the model and reasoning level.** The collapsed setup summary reads, for example, *Agent Claude Code · Opus 5.5 · High reasoning* (or *default reasoning* when neither Pocket nor the session sets one), and follows the Model and Reasoning choices. Requested by the owner.
- **Add to project is a toolbar chip.** It moved from a full-width row under the conversation header to the message toolbar, after Alerts and Voice; a linked session shows the project's name in clay. While a turn runs, the working row carries it as a folder button. It stays usable while a message is being delivered. Requested by the owner.
- **One conversation header.** The title bar's subtitle now carries the project, the run status in short words and the check age (*purchasing · Idle · Checked just now*), at every width. Sessions, Results, Queue and Git sit in the same bar: on the title row when the header is wide, on a second line inside it when narrow. The separate run-status strip, the session-links strip and the duplicate state label are gone; on desktop the three rows (about 125px) become one (about 60px). Phones keep the check age in the status tooltip. Requested by the owner.

## [1.34.0] — 2026-10-10 · build 78

- **Documents is now Files.** The library, its rail switch, the session-home chip, Split view, Back links, sheets, empty states and toasts all say Files, and a single item is a file: File options, Rename file, Remove this file?, Keep in Files on a session's Results. The Settings category is Projects & files, with Files and Open files under Tools. `pocket-docs` messages use the same words. Requested by the owner.
- **Agents understand every name for it.** Files, my files, documents, my documents and docs all mean Pocket's Files library, not a folder on the server or another drive unless the user names one. Pocket's per-turn instruction says so.
- **Agent skills ship with Pocket Code.** `skills/pocket-projects` covers when to create a project (only when asked), the steps, asking at most one question (which project, what it tracks, or when to remind) and setting reminders only when the user asks or agrees to a time. `skills/pocket-files` covers the names above, what to keep, how, and sharing only on request. While Projects or Files is on, Pocket writes the matching skill into `~/.claude/skills` and, where Codex is installed, `$CODEX_HOME/skills`, with this server's command filled in, so terminal and code-server agents know it too; turning the feature off removes it. Only folders carrying Pocket's `.pocket-managed` marker are touched. `POCKET_SKILLS=0` turns installation off. Requested by the owner.
- **A light divider in the rail switch.** Sessions | Projects | Files are separated by a thin, low-contrast pipe centred in a slightly wider gap. It is decorative, so it takes no clicks and screen readers skip it. Requested by the owner.
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

- **The Documents library is a grid of previews on a wide screen.** Each card shows a picture of the document (an HTML report as rendered, a PDF's first page, an image), with the title, where it came from, the visibility badge and the date under it; Copy link and the options button sit on the picture and show on hover or focus. List and Grid buttons above the library switch between the rows and the grid, remembered per browser; the grid is the default from 700px up and phones keep the list. Suggested by the owner.
- **Pictures are made on the server, once.** `GET /api/documents/<id>/thumb` (login only) renders a 480×300 picture with tools already on the box and caches it in `<documents dir>/.thumbs`, keyed by the file's size and modification time so an edited file gets a new picture: headless Chrome for HTML (its own sandbox kept, a throwaway profile, a four-second time budget), `pdftoppm` for PDF, ImageMagick's `convert` for images (or Chrome when `convert` is absent). The library response says which kinds this install can picture, so a card asks only when there is something to get; a failed render is remembered for ten minutes rather than retried on every paint. `POCKET_CHROME`, `POCKET_PDFTOPPM` and `POCKET_CONVERT` choose or disable a tool. Markdown, text, CSV, JSON, Office and video cards show their kind.
- Unit tests for tool discovery, the cache key, one job per key, failure memory and Chrome's arguments; an HTTP test for the route; the browser suite checks the grid, the kind card and the remembered choice.

## [1.31.1] — 2026-10-09 · build 73

- **Split view offers documents by name.** The chooser behind the Split view button listed each active project but only the Documents library as a whole, so a single report could be opened beside a conversation only from its own options sheet. It now lists the documents open as tabs first, then the six most recent, then the library, each with its kind, project and visibility. Noticed by the owner.
- The documents HTTP test altered a share token by replacing its last character with `A`, which did nothing about one time in sixty-four when the token already ended in `A`, so the "wrong token is refused" assertion failed at random (seen once locally and once in CI). It now picks a character that differs.

## [1.31.0] — 2026-10-09 · build 72

- **Three ways to open a project or a document.** Every options sheet and every project or document header now offers **Open in a new window**: the view in a browser tab or app window of its own (`?solo=1`), with no session list, tab strip or pane controls, and the document's or project's name as the window title. The other two ways are unchanged: as a tab in the strip, or beside the conversation in a split pane. Settings → Tools → Open projects / Open documents gains *In a new browser window* as the default for a plain click. Requested by the owner.
- **The Documents library looks after a real library.** Filter chips for Private, Link and Public (with counts), a Kind filter (HTML reports, PDFs, images, Markdown and text, CSV and JSON, Office and video), a Clear chip when anything is narrowed, and a heading that says what is shown ("Anyone with the link · 5 of 423"). Search covers the title, file name, project, session, kind and visibility words. Each row carries a visibility badge, and a shared row has a **Copy link** button beside its options. The rail's Docs list gains a search box.
- **Sharing in fewer taps.** Document options groups into Open, Share and Organize; a shared document offers **Copy link** right there. The Share sheet always shows an address with Copy: the in-app address for a private document (it needs the sign-in), the unguessable address for a link, the fixed address when public. The document view's chip row gains Copy link and icons. The Copy button in the Share sheet used to also fire the app's code-block copy handler and could leave the clipboard empty; fixed.
- **Sheets are dialogs on the desktop.** From 900px up, an options, share, session or settings sheet opens in the middle of the window with a border and a shadow instead of rising from the bottom edge; phones keep the bottom sheet. Link rows in a sheet (Open in your viewer, Download) and link chips no longer render in the browser's default blue with an underline.

## [1.30.1] — 2026-10-09 · build 71

- **Titles follow the session.** A generated title used to be made once, from the opening request, so a session that moved on kept a title about where it started. Now, after a turn run from Pocket ends, a session that has grown enough since its last check (four more of your turns, or about 8k characters of conversation, and at least ten minutes since the last check) is shown to the helper model as a digest of the whole session together with its current title. The model answers KEEP, or writes a better 3 to 7 word title; when a session took up a second substantial topic it names both ("Pocket titles, then away summaries"). Requested by the owner.
- An updated title ranks ahead of Claude Code's own one-shot title, since it reflects what happened since, and behind a rename, which is never touched. The titles a session had before are kept in `session-meta.json` (`titleHistory`). The open conversation's header follows a title that changes on the server at the next list refresh, as does a rename made from another device.
- **Settings → Update titles as sessions progress** turns it off (on by default; it needs Generate short titles and uses the same model choice). The line under it names the last update. Checks use the away-summary digest, one at a time: about 2k to 4k tokens with Claude Haiku, about 25k with Codex. `POCKET_LIVE_TITLE_GAP_MS` changes the minimum gap between checks (tests set it to 1 ms). Turns run from a terminal or code-server do not trigger a check.

## [1.30.0] — 2026-10-09 · build 70

- **Documents.** A library of the files that came out of the work: HTML reports and dashboards, PDFs, images, Markdown, text, CSV, JSON, Office files and video. Off until Settings → Tools turns it on. Files live in a documents folder (`POCKET_DOCUMENTS_DIR`, default `<data dir>/documents`); a file placed there appears as a private document on the next listing. Requested by the owner, after a conversation with a colleague.
- **Viewing.** HTML renders in a sandboxed frame: the response carries a sandbox policy and the frame denies the document any access to Pocket's cookies, storage or API, while a dashboard's own scripts still run. PDFs, images, Markdown, text, CSV/TSV and JSON render natively; Office files and video open in your device's own viewer. A document opens as a tab, beside a conversation, full-screen on the phone, **in your viewer**, or downloads.
- **Sharing.** Private (behind the Pocket login), **link** (an unguessable address, optional expiry, a new link revokes the old) or **public** (a fixed `/files/<name>` address), all served by Pocket on its own hostname with no-store, nosniff, noindex and frame-ancestors 'none'. Removing a document moves it to the trash for 30 days, where it can be restored; links stop working at once.
- **From a session and a project.** Results rows of document kind gain **Keep as document**, which copies the file in with the session and project links filled. A project card lists its documents; the library filters by project. Each document shows its project and session.
- **`pocket-docs` for agents.** `scripts/pocket-docs.mjs` (`npx pocket-docs`): `add`, `list`, `show`, `share`, `set`, `trash`, `restore`, `import`. Same loopback token as `pocket-board`, accepted only on the documents routes. With Documents on, agents started by Pocket are told to keep deliverables with it, linked to the session, and never to share unless asked. `pocket-docs import <metadata.json>` brings in an older dashboard's documents library once (public stays public, staff becomes link, private stays private).

## [1.29.0] — 2026-10-09 · build 69

- **Projects.** Track the work that comes out of your sessions, inside Pocket Code. Each project is one card: where you left off, the next step, what it is waiting for, a checklist of remaining steps, reminders, notes, history, and the sessions that worked on it, with their live status. States are Active, Waiting and Done. Finishing a project stops its reminders; resuming does not bring them back. Projects are tracked only when you ask: Track a project, or Add to project from a session's options. Off until you turn it on in Settings → Tools. Requested by the owner, after a conversation with a colleague.
- **Scheduled.** One list of every open reminder across your projects, due first. Only reminders Pocket Code itself keeps appear there, so the list is complete about what it shows. When a reminder comes due it is sent once to your devices by push, with a link to the card, and once to the server's reminder hook if `POCKET_REMINDER_HOOK` is set (the reminder arrives as JSON on the command's standard input, for email, chat or anything else).
- **From a conversation.** The row under the conversation header gains **Project**: the linked project's name, opening its card, or *Add to project* when there is none. When Projects is on, agents started by Pocket are told how to track the session as a project with `pocket-board`, and told to do so only when you ask; so "track this as a project" works in any session without editing your rules.
- **Open like a session.** On the desktop the rail head switches between Sessions and Projects, with a count of due reminders. A project opens as a tab in the same strip as sessions (pin, close, Alt [ / ] all work), or beside a conversation in a split pane. On the phone it opens full-screen. Settings → Tools chooses which happens when you pick a project from the rail.
- **`pocket-board` for agents.** A command in the repository (`scripts/pocket-board.mjs`, also `npx pocket-board`) lets Claude Code and Codex sessions keep a card current from the terminal: `track --requested`, `status`, `update`, `task add|done|reopen|edit`, `remind --at`, `dismiss`, `note`, `link-session`, `scheduled`, and `context --hook` for a Claude Code SessionStart hook that briefs the agent on the directory's tracked project. It uses a token Pocket writes to `<data dir>/cli-token` at start and accepts only on the board routes, only from a direct loopback connection; a request that arrived through a tunnel or proxy is refused. Times without an offset mean the server's time zone (`POCKET_TZ`, default the system zone). `pocket-board import <snapshot.json>` brings in an older dashboard's board once.
- The repository's prompts test no longer races the fake CLI on cleanup (the intermittent `ENOTEMPTY` CI failure seen since 1.27.1).
- Projects live in `<data dir>/projects.json`, written atomically with a per-project revision; an edit made from a stale card is refused and the current card is shown. Nothing in Projects depends on a domain, a Google account or email.

## [1.28.1] — 2026-10-09 · build 68

- **A cold prompt cache turns the ring ice blue.** Once a session's prompt cache has expired, the context ring (its track and fill) and the `cold` label beside it turn a light ice blue, and Usage → Prompt cache shows "Cold" in the same colour. Blue takes over from the clay, amber or red context colour while the cache is cold, because the next turn's cost is what matters then; how far the ring is filled still shows how full the context is, and the tooltip still gives the figures. Warm and cooling are unchanged, and so are the tab marks. Requested by the owner.

## [1.28.0] — 2026-10-08 · build 67

- **Prompt cache warmth.** Claude keeps a session's context in a prompt cache for a while after each request: one hour on a normal plan, five minutes in some cases such as extra usage. A turn that starts while the cache is warm reads the context at a fraction of the cost; after it expires, the next turn writes the whole context again, which on a large session uses noticeably more of your plan. Pocket now shows it. Requested by the owner.
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

- **Amber means waiting on you.** A session that needs your answer or approval now shows amber instead of clay on its tab, in the session list and in the conversation status bar. At tab size the still clay dot was hard to tell from the breathing ember of a running turn. Clay now always means Claude is working; amber means it is waiting on you. Requested by the owner.

## [1.27.0] — 2026-10-08 · build 64

- **Status on open-session tabs.** Each tab across the top carries the same status as its session-list row, as a small mark before the title: the breathing ember while a turn runs, a still clay dot when it needs your answer or approval, green for a reply you have not opened, red for a failed turn, and a ring for activity elsewhere or a paused queue. Quiet sessions show nothing, and no tab shows a status while the session list is unconfirmed. Hovering a tab adds the status in words; screen readers announce it with the title. Tabs for sessions older than the loaded list show no status. Requested by the owner.

## [1.26.1] — 2026-10-08 · build 63

- Account switching no longer waits forever on long-running background jobs such as health watchers. Current Claude turns still finish first; idle processes close, while background jobs and their Claude processes remain alive.
- Retained sessions refresh their login before the next requested turn after their jobs finish. While a retained job is running, start a new session to use the new account. This state survives Pocket restarts, and old processes cannot overwrite the new account’s displayed plan limits.
- The sign-in form explains that background jobs can keep the earlier login. Codes and authentication continue through the installed Claude CLI.

## [1.26.0] — 2026-10-08 · build 62

- **Switch Claude accounts.** Settings → Accounts & instance → Claude Code → Switch account opens a browser sign-in link and a field for Claude’s return code. The installed CLI handles authentication; Pocket never puts the code in a conversation or saves it in its data files.
- Sign-in waits for Pocket’s active Claude turns and background jobs to finish, closes idle Claude processes, and blocks new Claude turns until completion or cancellation. Codex can keep running. Return to the form after closing it to resume the pending sign-in. Links expire after ten minutes.
- A successful sign-in verifies the account and clears the previous account’s cached plan limits. It changes the server’s shared Claude login; other open Claude processes may need reopening. Configured API keys and cloud providers remain server-managed.

## [1.25.0] — 2026-10-08 · build 61

- **While you were away opens at the end.** Coming back to a session with work you have not seen now opens at the bottom of the conversation, not at the **New since** divider, so a long session needs no scrolling to reach the latest reply. The divider still marks the first new message. An **away card** under the latest message repeats the time ("New since 8:40 PM"), carries the short summary when the new part is more than a short exchange, and has **Read from there**, which jumps to the divider and holds the view there until you scroll, tap, type or send. When the latest reply ends in suggested replies, the card sits above them so the summary and the choices share the screen. When there is no summary and the divider is already on screen, the card is left out. Requested by the owner.
- Settings → **Summarize what you missed** describes the new placement. Off still marks where new work starts and still opens at the end.

## [1.24.1] — 2026-10-08 · build 60

- A message from another day shows its date with the time: "Yesterday 3:05 PM", "Oct 6, 3:05 PM", or "Oct 6, 2025, 3:05 PM" for an earlier year. Today's messages keep the time alone. In a conversation that runs across several days each bubble now says which day it belongs to, not only the day divider. Labels are set when the conversation is drawn, so a page left open past midnight shows yesterday's messages as today's until it is reopened. Requested by a colleague.

## [1.24.0] — 2026-10-08 · build 59

- **Message times.** Each message shows the time it was sent: under your own messages, inside the bubble, and above each reply, in the same small mono as the cost line. A divider marks the first message of each day (Today, Yesterday, Tue, Oct 6, or Oct 6, 2025 for an earlier year), including as a conversation crosses midnight while you watch. Times come from the transcript, so Claude and Codex sessions both have them; a message that is not in the transcript yet (just sent, or steered in) shows none. Requested by a colleague.
- Settings → **Show message times** turns the times and dividers off on this browser (on by default). The times are drawn by the stylesheet, so Copy message and Find in conversation never include them.

## [1.23.0] — 2026-10-08 · build 58

- **Saved prompts.** The New session screen has **Save as prompt** beside Choose a skill. It keeps the task's wording, workspace and agent, and, unless you switch it off in the save sheet, the model, effort, permissions and Codex mode. Saved prompts appear as a row of chips above the task box; tapping one fills the whole screen (the chip stays highlighted until you change the wording) and you still press Start, so a stray tap never starts work. The chip's tooltip lists what it will set. Requested by the owner.
- **Recent.** A Recent list under the chips holds your last five starts from any device (text, workspace, agent, when), newest first; a repeat moves to the top. Tapping one fills the screen the same way. It opens and closes on tap and remembers that on the browser.
- **Manage.** The Manage chip (or a long-press or right-click on a saved prompt) opens every saved prompt with Move earlier / later, Edit (rename, or replace with what is on screen) and Delete, which asks once more before deleting.
- Saved prompts and recent starts are kept on the server in `saved-prompts.json` beside pins and names, so the phone and desktop share them. Up to 50 saved prompts; names up to 60 characters, text up to 8,000. A start that fails is not added to Recent.

## [1.22.0] — 2026-10-08 · build 57

- **Search inside conversations.** Typing three or more characters in a session search box (home, desktop rail or the session switcher) still filters session titles at once, and after a short pause also searches inside conversations. An **In conversations** section lists up to 15 sessions with the matching passage, who wrote it (You, Claude or Codex) and the matched words marked; tap one to open the conversation with Find already on the match (the phrase, or its longest matching word). The section says how it searched, says so when nothing matched, and offers Try again when the search fails. Requested by the owner.
- **With MemStem** on the server (`POCKET_MEMSTEM_URL`, default `http://127.0.0.1:7821`; checked once a minute), search uses its keyword + semantic index of every Claude Code and Codex session, so it finds old conversations and related wording, not only exact phrases. Only transcripts in Pocket's own stores count (subagent transcripts and other Codex homes are left out). Snippets come from MemStem's plain-text copy of the conversation; a session that matched by meaning but contains none of the words is shown as **Related** with MemStem's own excerpt. If MemStem stops answering, Pocket falls back to its own search for that request.
- **Without MemStem** (or `POCKET_MEMSTEM=0`), Pocket searches the text of the 200 most recent conversations itself for the exact phrase, newest first, four at a time for up to six seconds, and says how many it covered.
- A search result opens at its match, not at the While you were away divider.

## [1.21.0] — 2026-10-08 · build 56

- **While you were away.** When you open a session (or come back to the app) and the agent did something you have not seen, a **New since 8:40 PM** line sits before the first new message and the conversation opens there instead of at the bottom. It stays there while the page settles, until you scroll, tap, type or send. Requested by the owner.
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

- Generated titles are a setting, not only an environment variable. Settings has **Generate short titles** directly under Sync names with code-server, and a **Title model** choice: Automatic (Claude first, then Codex), Claude · Haiku, or Codex · GPT-6-Luna. Both are server-wide, like name sync, and saved in `pocket-settings.json`. The line under the switch says whether titles are on and which provider is making them; a note gives the reason a provider is unavailable, which model made the last title, and, for Codex, that each Codex title sends about 25k tokens of your plan against about 400 for Claude. Requested by the owner.
- Turning titles off also stops showing the titles already made (they are kept and come back when you turn titles on), so with Sync names with code-server on, the list matches code-server.
- Each provider is checked before it is used: installed, signed in (`claude auth status`, Codex `account/read`) and, for Codex, offering GPT-6-Luna in its model list. A server with neither makes no title calls at all and Settings says why; before, a Codex-only server tried the missing `claude` once a day per session. A failure with one provider no longer blocks a retry with the other.
- Claude titles ask for the CLI's `haiku` alias, so they move to the newest Haiku when the Claude CLI is updated (Claude Code 2.1.293 maps it to Haiku 5.5; 2.1.281 to Haiku 4.5). Codex titles run `codex exec --ephemeral` read-only with GPT-6-Luna at low effort, without loading your config or rules, and save no session. `POCKET_TITLE_CLAUDE_MODEL` and `POCKET_TITLE_CODEX_MODEL` override the models.
- Title calls no longer receive Pocket's own secrets in their environment (they use the same environment as agent turns).
- `POCKET_AUTO_TITLES` now only sets the starting value; once changed in Settings, the Settings value is used.

## [1.19.1] — 2026-10-08 · build 53

- Generated titles are cleaner. On the first live run of 1.19.0 the model sometimes answered in Markdown ("# Planning Phase: …") or answered the request itself ("I don't have access to…") instead of naming it. The request is now framed as data with the instruction after it (8 of 8 good titles on the cases that went wrong, including the ones that failed), Markdown is stripped, and a multi-line or answer-like reply is rejected. Titles saved by 1.19.0 go through the same check: a bad one shows the request again until it is redone, and failures from the older prompt are retried once.
- Codex threads whose name is just their first message (Codex often stores the whole message as the name) count as untitled, so they get a short title as well. A name you gave the thread is kept.

## [1.19.0] — 2026-10-08 · build 52

From a full UI and UX audit of 1.18 on phone, tablet and desktop (2026-10-08). Requested by the owner.

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

- Pinned sessions are marked in the desktop tabs. A pinned session's tab shows the pin and its title in clay, the same marks as its row in the session list, so the sessions you are working on stand out from tabs you can close. Pinned tabs come first, in the pinned order, then the other tabs in the order you opened them; Alt [ / ] follow the same order. Requested by a colleague.
- Reorder pinned sessions. Pinned rows in the desktop list have a grip: drag it onto another pinned row to move the session, or focus it and press the up and down arrow keys. Session options also offers Move pin up and Move pin down on any device. The order is saved on the server beside pins and names (an order number in session-meta.json), so every device and the tabs follow it; a newly pinned session goes after the ordered pins by recency, and unpinning forgets its place. Older builds ignore the order number. Requested by a colleague.
- Mute voice in one tap. When voice is available, the composer has a Voice chip beside Alerts (an icon beside the bell while a turn runs) that mutes every spoken reply, announcement and approval or question prompt on this device, without changing Speak replies, Announce sessions or the other voice settings; tap it again to hear them. Muting stops anything being spoken and ends a hands-free conversation; starting hands-free, or saying "unmute", turns voice back on, and "mute" mutes it. While muted, quick commands show their answer in the voice strip instead of speaking it, the completion chime applies as configured, and Play a sample still plays. Settings → Voice shows the same switch. Requested by a colleague.

## [1.17.0] — 2026-10-06 · build 50

- Reply suggestions show the recommended option. When Claude or Codex has a clear recommendation among the choice buttons under a closing question, that button is filled clay with a small Recommended tag; the others keep their outlined look. The agent marks its pick by ending the option with "(Recommended)" in the choices block; Pocket strips the marker, so a tap still sends the plain option text and the reply reads cleanly in the transcript and in other clients. At most one option is marked, and an even choice stays unmarked. Older replies without a marker look as before. Requested by the owner.

## [1.16.0] — 2026-10-06 · build 49

- Subagent activity: a visible working count opens a list of delegated tasks. Expand an agent for its prompt, status, latest activity or result, and model/tool usage when reported. Available for Claude and Codex; Session options includes the view even before the first agent is recorded.
- Activity refreshes every five seconds, preserves expanded details, and survives browser reconnects through provider records. Unknown or stale states are labelled; background shell jobs do not inflate the agent count. Read-only inspection never resumes a child thread.

## [1.15.0] — 2026-10-06 · build 48

- Mark as reviewed. A session showing Response ready stayed in Attention until you opened it, even when you had already seen the reply elsewhere or did not need to. Long-press a session (or tap ⋯) and choose Mark as reviewed to clear it without opening it; failed turns can be cleared the same way. In Attention and New, a bar at the top shows how many are waiting and offers Mark all reviewed, with Undo for 10 seconds. Questions and approvals stay until they are answered.
- Reviewed is now shared by all your devices. Opening a session or marking it reviewed on the desktop clears Response ready (and a seen failed turn) on the phone too, and the reverse; before, each browser kept its own record, so the phone kept listing replies you had already read at your desk. The server keeps the markers in session-meta.json beside pins and names. Markers a browser saved before this release are sent up the first time it loads, so nothing already read comes back. Undo of Mark all reviewed restores the earlier state everywhere. The empty Attention list now says "Nothing needs your attention." Requested by the owner.

## [1.14.0] — 2026-10-06 · build 47

- Spoken reply length. Settings › Voice has Brief (one sentence, like the alert line), Normal (about two sentences, the default and the previous behavior) and Detailed (the whole reply, skipping code, tables and links, ending on a sentence after about three minutes with "The rest is on screen"). It applies to the reply spoken when a voice turn finishes and to "read it". "What's it doing" stays short at any length, and "read it all" always reads the whole reply. It only changes how much of the written reply is read aloud. It does not change what Claude or Codex writes. Requested by the owner.

## [1.13.2] — 2026-10-06 · build 46

- Session menu: the sheet opened from ⋯ (or a long-press on a session) is titled "Session options", with the conversation's name on its own line beneath. It used to show only the name as the heading, so a session called "Pocket Code version check" looked like a version feature with nothing in it. Reported by the owner.
- Version & updates in the session menu. Inside a conversation the ⋯ menu shows "Pocket Code 1.13.2 · build 46" and opens Settings with About & updates expanded and in view; before, the version was only reachable from the session list's gear, behind a collapsed section. The About & updates line in Settings now shows the version even when collapsed.

## [1.13.1] — 2026-10-06 · build 45

- The context window of a 1M session (Opus 5.5, Fable 5.1) no longer drops to 200k while a turn runs. The CLI reports the real window at the end of a turn under the name "claude-opus-5-5[1m]", but the next turn's streamed lines and transcript call the model "claude-opus-5-5". The transcript re-estimate then guessed 200k (anything under 200k used) and overwrote the reported window until the turn ended, so a session at 164k looked 82% full. A reported window is now kept while the session stays on that model, and when no window has been reported yet, the model Pocket launched the session with decides the estimate. Sessions started outside Pocket still show "estimated" until a turn reports the window. Reported by the owner.

## [1.13.0] — 2026-10-06 · build 44

- Context ring. A 22px gauge beside the composer's settings button (in the working row while a turn runs) fills as the session's context window fills, amber at 70% and red at 90%. Hover or focus it for the model, tokens used, the window and the percentage. Click it for a Usage panel: this session's context (window, used, free, as-of, estimate note) and the provider's plan windows. It replaces the text meter in the state bar. Unknown models get a readable name from their ID (claude-opus-5-5 → Opus 5.5).
- Hands-free confirmation. In a hands-free conversation an instruction is read back ("Ready to send: …. Say send it, or cancel.") and shown with Send, Edit and Cancel. Only a short yes (send it, yes, go ahead, do it) or a tap sends it. Cancel drops it, Edit moves it to the message box, and anything else replaces it and is read back again. Quick commands still answer at once; the plain mic still sends directly.

## [1.12.0] — 2026-10-05 · build 43

- The Attention filter and count include sessions marked Response ready until you open them, alongside questions, approvals and failed turns. The list summary counts them too. Session grouping and the voice "what's waiting on me" answer still mean a question, approval or failure.
- Phones and panes up to 600px wide give the message box its own full-width row, with settings, headset, mic and Send (and Steer now / After this turn while a turn runs) on the row beneath. Before, the box shrank to a few characters while steering. Contributed by a colleague.
- A message sent to an idle session no longer disappears until the turn ends. The CLI writes the user line to the transcript a moment after the turn starts, and the re-render right after the send landed in that gap. The session view now includes the running turn's own message, dimmed as pending, until the transcript has it. It matches on that message among lines written since the turn started, so a steered or queued message landing after it never brings it back twice. Reported, with a first patch, by a colleague.

## [1.11.1] — 2026-10-05 · build 42

- While a turn streams, consecutive tool calls stay in one fold even when an empty live placeholder sits between them, so you see one line whose summary shows the count and the latest call, updating as the turn runs. Contributed by a colleague.

## [1.11.0] — 2026-10-05 · build 41

- Reply suggestions. When a reply ends by asking you to choose between specific next steps, the options appear as buttons under the latest reply once the turn has finished. A tap sends the option as your next message. Typing in the message box hides them; the X dismisses them for that reply (remembered on this browser). They are excluded from Copy message and spoken replies.
- Pocket adds a short instruction to the turns it runs asking the agent to end such questions with a fenced `choices` block: Claude via `--append-system-prompt`, Codex via thread developer instructions. A Codex config with its own `developer_instructions` is never overridden (no suggestions there). The server turns a block at the very end of a reply into reply options, so the raw block never shows, even while streaming; an example mid-reply stays text. `POCKET_CHOICES=0` turns the instruction off.
- Session search includes the suggested options.

## [1.10.1] — 2026-10-05 · build 40

- With side conversations open (split view), the round + New session button is anchored to the main column instead of the window, so it no longer covers the Send button of the pane on the right. Reported by the owner from the dashboard wrapper.

## [1.10.0] — 2026-10-05 · build 39

- Hands-free has its own button. The headset beside the mic starts a hands-free conversation for the open session: each reply is read aloud and the mic listens for your answer, then repeats, until you tap the headset again, tap Cancel or Stop, leave the session or stay quiet past the wait. The mic sends one message and never reopens by itself. The Keep listening setting is removed, so hands-free is never on unless you start it; a saved Keep listening preference is ignored.
- Spoken announcements never turn the microphone on. Session alerts, approval and question prompts, and the spoken reply to a typed or single mic message are one-way, including while a hands-free conversation is on.
- The headset hides while the message box holds a typed draft (speech then only adds to the draft), which keeps the phone composer wide enough to type in. The placeholder stays on one line.
- Tool calls fold behind a one-line summary with the number of calls and the latest one ("12 tool calls · Edit app.js"); consecutive calls merge into one fold even across transcript messages. Settings → Collapse tool calls (on by default) opens them all.
- Settings → Highlight colour: Orange (default), Blue or Purple, saved on this browser. The search highlight follows it.
- A sent message appears immediately, dimmed until the server confirms it. If delivery fails it is removed, including its file chips, and the text returns to the box.
- An open window offers a reload when the server is running a newer build.
- Pinned sessions come first in each session group, in the highlight colour, with a rule before the rest.
- The tool-call folds, highlight colour, instant echo, reload banner and pinned-first list were contributed by a colleague.

## [1.9.0] — 2026-10-05 · build 38

- Spoken alerts (voice beta). Settings → Voice (beta) → Announce sessions: Off (default), Session name only, or Name and a one-line summary. While Pocket is open it says when any session finishes ("The warehouse inventory session finished. 42 products are below their reorder level."), stops with an error, or needs your approval or answer, and replaces the completion chime.
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

- Collapse the session header on any screen size, including its dashboard wrapper. The slim header retains session navigation, title and live server status.
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
- Project paths shorten to `~` under any home directory, not only `/home/user`.
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
