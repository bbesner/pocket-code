# Plain Pocket and Assistant mode: plan

**Prepared:** October 19, 2026 · **Revised:** October 19, 2026 after Brad's review · **Status:** approved, in build · **Built against:** Pocket Code 1.58.0 (build 119)

## What it is

Two pieces of work that share one goal: Pocket Code should be easier to read and use without
taking anything away from people who want the full workbench.

1. **Plain Pocket (everyone).** Plainer words, readable progress lines, clearer approval cards,
   files shown as cards with previews inside the conversation, and one sign-in. These ship to
   every Pocket. Nothing is removed: every control, setting and technical detail is still one
   tap away.
2. **Assistant mode (a per-instance switch).** For people who never write code: account
   managers drafting email and quotes, a warehouse manager marking stock, anyone making a deck
   or a document. It hides the developer controls, starts on the message box, picks the model
   automatically, and calls the app **Pocket Assistant**. Same server, sessions, memory, Files,
   Tasks and Vault underneath.

Each Pocket belongs to one person (one seat per employee), so nothing here is multi-user.
Brad's own Pocket keeps the full workbench and gets the Plain Pocket improvements; the TechPro
seats switch to Assistant mode.

**The test Assistant mode has to pass:** an account manager who has never seen Pocket opens it,
makes a slide deck and finds it again the next day without asking anyone, and never sees a file
path, a model name, a dollar figure or a developer term.

## What goes where

| Change | Developer Pocket | Assistant mode |
|---|---|---|
| Plain words ("conversation", Allow / Don't allow, plain errors) | Yes | Yes |
| Plain progress lines, raw detail behind "Show details" | Yes; a setting shows raw lines by default | Yes, raw lines only on request |
| Clearer approval cards | Yes | Yes |
| File cards with thumbnails in the conversation, opened per **Open files and links** | Yes | Yes |
| Every made file kept in Files automatically | Optional setting | On |
| One sign-in through Cloudflare Access | Yes, when configured | Yes, when configured |
| Model, effort, permissions, Codex mode chips | Shown | Hidden; chosen automatically |
| Results, Queue, Git, Split, changed files, subagents panel | Shown | Hidden (More menu keeps Find and Files) |
| Cost, timing and cache meters | Shown (a setting can hide them) | Hidden |
| Home screen | Conversation list | The message box, with recent conversations below |
| Settings | Everything | Appearance, notifications, voice, accounts, sign out |
| App name | Pocket Code | Pocket Assistant |

## Design brief (pinned for the build)

> *Reading this as: a simpler surface for non-technical office staff and a calmer one for
> developers, in a plain, trustworthy language, leaning "well-made notes app" for Assistant
> mode and "warm ink workbench, easier to read" for the developer Pocket.*

- **Plain Pocket: VARIANCE 2 · MOTION 1 · DENSITY 5.** The existing Operate setting. It
  rewords and refines; it doesn't relayout the workbench.
- **Assistant mode: VARIANCE 3 · MOTION 2 · DENSITY 3.** Fewer things on every screen, one
  obvious next step, no motion beyond the existing working ember.
- **Existing tokens, no new colour.** DESIGN.md's warm ink/paper themes, clay accent, native
  system font, 44px touch targets. Monospace stays the "machinery" font and only appears where
  machinery is shown (Show details, the developer's raw ledger).
- **No customer branding.** Assistant mode is named Pocket Assistant; no TechPro logo.
- Build flow: this brief, then `impeccable` with the brief pinned; rendered checks at 390 and
  1440, axe clean, detector run on the rendered pages, as for every recent release.

## Release 1.59: plain words, progress lines and approval cards (everyone)

**Words.** User-visible text changes in every Pocket; ids, routes, API fields, CLI commands and
file names don't. "Session" becomes "conversation" in labels, headings, buttons, toasts, tips,
notifications and help text. A short glossary in `DESIGN.md` keeps future text consistent:

| Was | Now |
|---|---|
| Session(s), Your sessions, New session | Conversation(s), Your conversations, New conversation |
| Message this session… | Reply… |
| Allow once / Deny | Allow / Don't allow |
| Turn failed — tap to see why | Something went wrong. Tap to see what happened |
| Agent needs your answer | Claude has a question (Codex: Codex has a question) |
| Action needs approval · Review | Claude wants to do something · Review |
| No confirmed runs | Nothing running |

**Progress lines.** A server module, `phrases.mjs`, turns each tool call into a line a person
can read; the client shows it in place of the raw mono line:

| Tool | Line |
|---|---|
| Read / Glob / Grep | Looked at Proposal-draft.docx · Searched files for "QT-10432" |
| Write / Edit / NotebookEdit | Saved Proposal.pdf · Edited server.mjs |
| Bash | Claude Code's own description ("Convert the deck to PDF"), else "Ran a command" |
| WebSearch / WebFetch | Searched the web for "…" · Read example.com |
| Gmail / Calendar / Drive / Docs / Sheets / Slides connectors | Checked Gmail · Made a Gmail draft · Looked at your calendar |
| MemStem | Checked past conversations |
| Task / Agent | Started a helper: "…" |
| Skill | Followed the "techpro-quote-proposal" steps |
| TodoWrite | Updated the plan |
| Anything else (`mcp__server__tool`) | Used *Server name* |

Every line keeps the raw call under **Show details** (the existing ledger). Developer Pocket gets a
setting, **Settings → Conversation → Show raw tool lines**, for people who prefer the mono
ledger by default. Seat-specific tools (the lookup, site and image brokers) get phrases by adding
rows to the module's table.

**Approval cards.** Title is the same phrase as a question ("Save Proposal.pdf in work?",
"Run: Convert the deck to PDF?", "Make a Gmail draft?"), then one plain line of scope, then
**Allow** and **Don't allow**. The JSON block moves under **Show details**. The approval engine,
trusted actions and the audit log don't change.

## Release 1.60: Assistant mode

**Switch.** `POCKET_ASSISTANT_MODE=locked|on|off` seeds `assistantMode` in
`pocket-settings.json` (same pattern as `autoTitles`). `locked` (seats): the person can't turn it
off. `on`: on, and Settings can switch to the full view. Exposed at `/api/me` →
`features.assistantMode`, read by an `assistantMode()` helper beside `projectsOn()`. Seats get
`agent-seats/provision/22-assistant-mode.sh`, which also sets `POCKET_LOCK_CWD`, Review actions
and no Full access (already available).

**Home is the start screen.** "What would you like done?", the saved-prompt buttons and the
message box (Attach, mic, Send). Above it, **Waiting for you** cards for an approval or a
question, each with the conversation's title. Below, **Recent**: five conversations as title and
"2 hours ago" with a working / needs-you dot, then **See all conversations** (search and rows
only). Hidden: Refresh, the status summary, the filter chips, the footnote, the "+" button, the
setup card.

**Message box.** Attach, mic, text, Send; while working, the ember, "Working on it" and Stop.
Hidden: model, effort, permissions, Codex mode, alerts, voice mute, Add project, Add task, the
settings sliders, the cache ring, Steer now / After this turn (a message sent while Claude works
goes in after the current step). "Choose a skill" and "Save as prompt" move into a More menu.
Projects and tasks still work by asking ("remind me Friday to follow up").

**Conversation header.** Back, title, More (Find, Files in this conversation, Rename, Hide). The
subagents panel becomes one line under the reply ("Working on 2 things at once").

**No meters.** Cost, timing, cache and token counts are hidden. Push notifications say what
finished: "Ready: Proposal for Village of Golf" (all Pockets get this wording; the developer
Pocket keeps the cost after it).

**Settings.** Appearance, Notifications (this device), Voice, Accounts (Claude sign-in and Google
connectors), Files / Tasks / Projects on and off if allowed, Sign out.

**Name.** In Assistant mode the header, page title, manifest name and notification title say
**Pocket Assistant**. The manifest becomes a small server route so the name follows the mode.

**First-run card.** On a fresh install, home shows one card: "Start with a button below, or just
type what you need. I'll ask before I send, save or change anything."

**Done when:** an automated walk of home → start → reply → approval → finished reply at 390 and
1440 finds none of `session`, `workspace`, `tool call`, `/home/`, `$`, `cache`, `effort`,
`Sonnet`, `Opus` in the rendered text; axe clean.

## Release 1.61: files in the conversation (everyone)

When a reply mentions a file Pocket can serve (pdf, docx, pptx, xlsx, csv, html, md, images;
`PocketFormat.href`), it renders a **file card**: thumbnail, name, type and size, with **Open**,
**Download** and **Keep in Files** (or **Kept · Open in Files**).

- **Open** and a tap on the card follow **Settings → Open files and links** exactly as a link
  does today: a tab, side by side, or a window. Brad's "side by side" keeps working.
- Thumbnails reuse `thumbnails.mjs` (HTML via headless Chrome, PDF via pdftoppm, images), now
  for conversation artifacts too, cached by path and modified time. Office files (docx, pptx,
  xlsx) show a type tile until a LibreOffice → PDF step is available; the seats don't have
  LibreOffice today (about 400 MB to add to the seat image).
- **Keep every file Claude makes in Files**: a setting in every Pocket, on in Assistant mode.
  Files are titled from the conversation and linked to it.

## Release 1.62: choosing the model automatically (Assistant mode; optional "Auto" elsewhere)

1. **Saved prompts carry a model and effort.** Two optional fields in `saved-prompts.json` and
   the seats' `seat-config/prompts/*.json`: "Check my email" → Sonnet 5.5 low; "Draft a reply"
   → Sonnet 5.5 medium; "Proposal from a quote", "Slide deck" → Opus 5.5 high.
2. **A router for typed requests.** One decision-model call picks among the combinations the
   managed policy allows before the first turn. Candidates: TypeSafe Jev through OpenRouter
   (p50 0.42 s, about $0.0003 a call, already used by the directory picker; alpha, had timeouts
   in September) and OpenAI's Decisions API with `gpt-6-luna` (public beta since October 6,
   p50 0.24–0.47 s, deterministic, already in TechPro Vision). Backtest both on about 200 real
   first messages and keep the more accurate. Fail open: 1.5 s timeout, error, refusal or low
   confidence → the instance default (Sonnet 5.5, medium). The choice is kept for the rest of
   the conversation (a model change restarts the Claude process and loses the prompt cache).
3. **"Try harder"** on any reply re-runs the last request on the strongest allowed model at high
   effort. In Assistant mode it is the only model control.
4. **Honour `maxEffortLevel`** from the managed policy, which Pocket doesn't read today.

The developer Pocket can offer the router as **Auto** in the model picker; the explicit
choices stay.

## Release 1.63: one sign-in (everyone, when configured)

Pocket trusts Cloudflare Access instead of asking for its own password as well: validate
`Cf-Access-Jwt-Assertion` (signature against the team's published keys, the application's
audience tag, expiry, issuer), check the email against an allow list, then set the normal
`pc_auth` cookie. The password stays as the fallback. Configured by `POCKET_ACCESS_TEAM`,
`POCKET_ACCESS_AUD` and `POCKET_ACCESS_EMAILS`. New security-sensitive code: its own tests
(forged token, wrong audience, wrong issuer, expired, wrong email, missing header) and a
security review before release.

## What stays the same

Sessions on disk, MemStem capture, Vault, brokers, managed policy, approval rules and audit,
Codex support and every workbench control. Plain Pocket rewords and refines; Assistant mode
hides. Every Assistant-mode change sits behind `assistantMode()`.

## Rollout

Each release follows CONTRIBUTING.md: branch, tests and browser suite, PR, Brad's merge and
deploy on brads-server, ledger entry in `~/ari/maintenance/ai-services/POCKET-CLAUDE.md`. Seats
follow: Guy's seat for two working days, then the other three; seat changes logged in
`AGENT-SEATS.md`.

## Decisions (Brad, October 19)

- Plain words, progress lines, approval cards, file cards and one sign-in go to every Pocket.
- File cards open according to the **Open files and links** setting.
- Assistant mode is called **Pocket Assistant**; no TechPro branding.
- Still open: locked or switchable on the seats (recommended locked); router provider
  (recommended: backtest both); auto-keep files (recommended on in Assistant mode).
