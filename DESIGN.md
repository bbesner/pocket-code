# DESIGN.md — Pocket Code

**Mode:** Operate. The user completes tasks: open session → read → send → done.
Scanability and native feel outrank expression; brand lives in warm material and one accent.

**World: "warm ink workbench."** A quiet, warm near-black surface — paper-in-lamplight, not
terminal green-on-black. Chat reads like a document. The machine's activity (tool calls) is
visibly *machinery*: small monospace ledger lines, dim, truthful. One living element: the
clay ember that breathes while Claude works.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#131110` | page |
| `--surface` | `#1D1A18` | header, input bar, rows |
| `--raised` | `#272322` | pressed/selected, code blocks |
| `--line` | `#2E2A27` | hairlines |
| `--text` | `#EDE7E0` | primary text (13.9:1 on bg) |
| `--dim` | `#A99E93` | secondary (6.9:1 on bg) |
| `--faint` | `#AA9C91` | readable timestamps and ledger |
| `--clay` | `#D97757` | accent: send, ember, active dot, links |
| `--clay-deep` | `#3A241C` | user message surface |
| `--ok` | `#7FB069` | success flashes only |
| `--err` | `#E2685C` | errors |

Type: system-ui stack (Operate mode: native feel + zero font payload on mobile).
Chat body **17px/1.6**; session titles 16px/500; view titles 19px/650; ledger mono 12.5px
(`ui-monospace` — earned: it renders commands, paths, data). Radius: 14px surfaces, 10px chips.
Spacing: 8/16/24 rhythm; more air above headings than below.

## Motion — one identity

The **ember**: a 10px clay dot that breathes (scale 1→1.28, opacity .55→1, 1.6s ease-in-out
alternate) wherever Claude is working (session row, chat header, input bar). Messages and
ledger lines enter with a single 180ms ease-out rise (6px). Nothing else moves.

## Surfaces

- **Sessions:** grouped, hairline-separated rows with a two-line title, workspace/provider,
  explicit state and last activity. Search and filters share behavior across the home
  view, desktop rail and mobile switcher. Only confirmed runs show a running ember.
  Visible More buttons expose pin/rename; the bottom-right FAB starts a session.
- **Chat:** slim header (back chevron, 1-line title, project tag). User messages: right-aligned
  clay-deep chips, max-width 85%. Assistant: full-width document text. Tool calls: ledger lines
  `⌁ Bash  pm2 list` in mono/faint with drawn 14px stroke icons. Input bar pinned bottom,
  auto-growing textarea, clay circular send (arrow-up). While working: input stays usable-looking
  but disabled, ember + "working" in the bar.
- **New:** recent project dirs as radio rows + free path field, message box, single primary action.
- **Login:** centered, one field, one button.

Icons: authored inline SVG, 1.8px stroke, round caps — chevron-left, plus, arrow-up, folder,
terminal, doc, globe, cog. No emoji as UI.

## Session workspace refinement (1.1)

Keep the warm charcoal/clay identity. Variance 4, motion 2, density 5. Status text
carries meaning without relying on color or animation. Dialogs contain keyboard
focus, close with Escape and restore focus. New toolbar targets are at least 44px.
Delivery errors preserve the message and show recovery actions beside the composer.

## Conversation workspace (1.2)

Reports retain document typography with real heading levels, nested lists and
quotes. Tables scroll in a named keyboard-focusable region without widening the
page. Results and Queue are visible next to the session switcher; phone sheets
use the available height, desktop sheets keep a bounded measure. New Session starts
with the task; skill discovery inserts editable instructions, with workspace and
agent setup below the start action. Existing color/type identity stays pinned.

## Daily workspace (1.3)

Desktop retains a readable center conversation between the existing session rail
and an optional 350px Results/Queue/Git panel at 1280px+. Open-session tabs persist
locally; closing a tab never stops a turn. Phones use full-width sheets, and a
narrowed desktop panel moves into a dialog without discarding its fields. Workspace
and agent filters use native selects; all actions keep visible keyboard focus.
Question forms render only provider requests, have no preselected answers and
support free text. Git text is escaped and scroll-contained. Accounts display
identity metadata, never secrets. Existing warm charcoal/clay identity stays pinned.

Rendered phone/desktop scans and screenshots reviewed. Remaining flags are the
incumbent native font, intentional header/tab title ellipses, compact tool ledger,
existing slash-menu shadow and padded quote/message boxes. No low-contrast finding
on the new question form or workspace controls. Physical-device assistive-technology
certification is not claimed.

Source detector exceptions: the existing ember only pulses for confirmed owned
runs; it is functional state, not decorative liveness. The existing radial radio
selection fill is a control indicator. Both are retained from the pinned design.

## Compact desktop workspace (1.3.1)

Pinned refinement: variance 3, motion 1, density 8. Preserve the warm ink identity
and conversation typography. Reduce desktop chrome spacing on a 4px rhythm;
retain 44px targets. Independent disclosures hide tabs/subtitle or session filters,
keeping essential actions and warnings available. Active filters remain explained
and clearable. Change layout in place; preserve drafts, reading position and docks.
Desktop preferences do not hide phone controls.

Rendered desktop and mobile scans reviewed: native font, intentionally truncated
titles/tabs, existing table containment and compact header hierarchy are retained.
The existing slash-menu shadow is unchanged. Text-occlusion findings are report
paragraphs outside the conversation's scroll viewport, inspected with its composer
visible; they remain reachable by scrolling. No new contrast or touch-target
exceptions are introduced by the disclosures.

Conversation text has a per-browser 14–24px preference (17px default), exposed in
existing Session options and App Settings sheets to avoid extra permanent chrome.
Prose, report headings and tables scale together; table text has a 13px floor.
Code, tool ledgers and application controls keep their existing typography. The
14px prose minimum is an explicit user density preference; browser zoom remains
available. Both settings surfaces share one control with announced values, native
disabled bounds, a live sample and reset. Rendered phone/desktop scans at 24px have
only the existing ellipsis/table/shadow/native-font exceptions described above.

## Action approvals (1.4)

Pinned Operate brief: variance 3, motion 1, density 7. Keep the warm ink palette,
native text and existing sheet behavior. Pending-action banners are separate from
agent questions. Cards show complete escaped, scroll-contained details with explicit
Deny/Allow buttons, no preselected answer and no blanket permission shortcut. Native
turn-wide grants state their scope. Disabled uncertain replies direct users to review
and stop; closing a card never implies consent. Keep 44px targets and visible focus.
Rendered phone/desktop scans retain the existing title ellipsis, table containment,
native font, compact navigation and slash-menu shadow exceptions. Approval help copy
has a bounded measure and 16px outer padding.

## Responsive conversation workspace (1.5)

Pinned warm ink workbench; variance 3, motion 1, density 6. The conversation is one
continuous workspace across phone, Fold and desktop widths. Keep its flex columns
shrinkable and its composer outside the scrolling transcript, so viewport and keyboard
changes resize the existing DOM without losing the draft, selection or reading place.
At wider widths, the conversation and composer may span 1280px instead of the former
720px; narrower panes retain their own readable measure.

On phones, the 44px header controls remain reachable while optional status chrome
collapses. The composer stays in view, its text field has a bounded height, and its
single-row toolbar scrolls horizontally when actions do not fit. Attach opens a
choice between files and Paste screenshot; pasting an image directly into the
message field also attaches it. Plain text paste remains native.

Browser screenshots at closed Fold, open Fold and wide desktop widths preserve the
draft and visible composer. Compact layout increased the measured reading area by
93px (529px to 622px) in the test. These checks used emulated browser widths and a
synthetic visualViewport reduction; they do not certify behavior on a physical Fold.

The run-confirmation strip remains visible beneath the conversation header, including
in compact mode. It is28px tall with12px text, using existing status colors and a
non-animated check-age label. Only a fresh authenticated server response can confirm
a running turn; display age updates locally without renewing that confirmation.
Server checks occur every5seconds, become unconfirmed after failure or15seconds
without fresh proof, and distinguish waiting, finished and external activity.

## Split view and tooltips (1.6)

Pinned Operate brief: variance 3, motion 2, density 8; warm ink identity unchanged.
Desktop (900px+) shows up to four conversations side by side, like editor groups.
The main column keeps the rail, tabs and dock; each extra pane is a full Pocket window
in a frame, so streams, drafts, sheets, questions and approvals stay independent.
Panes share width equally (the main conversation gets the same share as a pane, after
the rail), with 5px hairline dividers matching the rail grip. Keyboard arrows resize;
double-click resets. Pane headers replace Back with Swap and add Close; nothing else
changes inside a pane. A new pane needs at least 380px per conversation. Phones never
show panes.

Tooltips explain icon-only and abbreviated controls on mouse hover (350ms) or keyboard
focus, never on touch. Raised surface, hairline border, 10px radius, 13px text, no
animation or shadow. Escape and pointer-down dismiss them. The control's accessible name
is unchanged; the tooltip is attached through aria-describedby while visible.
Split view lists New session first; a new pane shows the standard New session screen
with Close in place of Back and its own draft. Messages steered into a running turn
render immediately as ordinary user messages; no extra pending chrome.

## Session focus controls (1.7)

Pinned refinement: Operate, variance 3, motion 1, density 8. Preserve the warm ink
palette, chat typography and 44px controls. The header chevron hides secondary
navigation at every width; the same live status element moves below the title.
Its check timestamp returns when expanded. The composer gear independently hides
model, effort, permission, mode and alert settings. Attachment access stays beside
the input, and attached files, upload/delivery problems and active-turn controls
remain visible. Preferences persist per browser without rebuilding the conversation.

Mission Control hides its masthead only after its verified Pocket iframe reports
an active session with a restore control. Expanding the session restores the parent
navigation. Old clients and non-chat views retain the parent's own restore button.
Messages contain only visibility state; both sides check origin and source window.

Rendered phone and desktop scans preserve the existing native-font, compact type,
intentional title ellipsis, contained tables and slash-menu shadow exceptions.
Detector occlusion reports concern content outside the conversation scroll viewport;
that content remains reachable by scrolling. The clipped-container advisory is the
existing app shell. Compact controls retain 44px targets and readable contrast.

## Usage meters and main-pane close (1.7)

Pinned brief (design-studio to impeccable handoff): Operate, variance 3, motion 1,
density 8 - the same dials as 1.6/1.7's other refinements. Read: a utility meter/panel
addition to an existing tool, not a new surface; refine in place, don't redesign.

**Context meter.** A compact mono line next to the session state ("70k / 1M . 7%"),
reusing the ledger's ui-monospace treatment for numeric data. New `--warn` token
(#D9A94E, warm amber) added for the 70%+ state; `--err` marks 90%+. An "est." suffix
marks a value computed from a transcript tail rather than the CLI's own reported
window. Updates on session load and on each `usage` SSE event; native `title`
attribute carries the longer explanation rather than a registered tooltip, matching
the existing `#ctitle` pattern for plain (non-button) text.

**Plan-usage panel.** A sheet (the existing sheet/.opt component, not a new
primitive) reachable from the session's options menu (current session only) and from
App Settings, both natural per the surfaces listed in README.md's Housekeeping
section. Bars are a real labeled meter (percentage + reset time + "as of" text
alongside the fill), not a decorative sparkline - satisfies craft-floor's
content-stand-in ban because the data is genuine and fully labeled. One accent
(--clay) for normal usage, --warn/--err thresholds matching the context meter. Reset
times convert to America/New_York per the brief; values only refresh when a turn
runs, so the panel says so explicitly ("Only updates when a turn runs, not live.").

**Main-pane close.** Desktop (900px+, matching the existing .desk breakpoint) gets
an X in the main pane's header, visually identical to a split pane's existing Close.
Phone has no header room (chevron, title, search, options, collapse already fill it),
so Close lives in the session options menu instead, as the brief allows. Closing
reuses the existing session-options sheet() component for the "still running" choice
(Keep running / Stop) rather than inventing a new confirm dialog.

Detector run: `npx impeccable detect` against a rendered, authenticated snapshot of
both the chat view (context meter + close button) and the open plan-usage panel.
Zero findings on the chat view. One advisory on the usage panel - flat-type-hierarchy
(body/h1/h2/h3 all ~16px) - inherited from the app-wide .sheet h2 convention (13.5px
uppercase label, shared by every existing sheet: Settings, session options, rename,
skills); not introduced by this work and out of scope to change here without
redesigning every sheet's heading system.

Lead review after merge (2026-10-04): at 390px the counts in the context meter squeezed the
Sessions control to "Sessi…". Phones (≤600px) now show only the percentage, with the full
figure in the title and accessible name; values under 1% read `<1%` rather than `0%`; and
`#session-switch` takes twice the share of the status bar (all four controls had equal
`flex: 1`). Rendered detector scan of the 390/1440 conversation pages: 0 findings.


## UI/UX repair pass (1.7.1)

Pinned Operate refinement: variance 3, motion 2, density 8. The warm ink palette,
native typography, draft storage and persistent-session behavior are unchanged.

Split width budgeting includes the session rail, any workspace dock, 380px for
each conversation, and 5px for each visible divider. Excess panes hide in place
and return when space is available; their frames are never rebuilt or moved. A
desktop notice explains hidden panes. Divider values report actual rendered widths.

Settings opens before network or notification lookups. Each service owns its own
loading, error and retry state. Notification readiness has a bounded wait; version
failures cannot imply an up-to-date server. Settings destinations precede About
and What's new disclosures, which remain keyboard reachable inside the focus trap.
Replacement dialogs return focus to their original connected opener.

The session list exposes All, Active and Attention; a remembered Filters disclosure
contains Workspace, Agent, New, Pinned and Hidden. Applied secondary filters remain
visible in its summary with a Clear filters action. The desktop rail keeps its
existing independent disclosure.

Message toolbars show 44px previous/next scroll buttons only when contents exceed
the available width. Collapsing message settings hides the whole scroll wrapper;
attachments, draft and Send stay in place. Tab/pane X buttons close views only;
Close session process is a labelled Session options action on every screen size,
with the existing keep-running/stop choice when work is active.

Agent and workspace choices follow radio-group keyboard conventions. The rail
resize control, conversation controls, composer and workspace dock have named
landmarks, without nesting the main or banner landmarks. Skip links point to the
current view's real task/message field.

Verification: repository tests and the full Chromium browser suite pass, including
15 audit regressions, five axe scans without violations, and split transitions from
390px to 2560px. Rendered detector review retains the native-font, compact-hierarchy,
title-ellipsis, table/toolbar scroll containment and slash-menu-shadow exceptions.
Off-screen transcript paragraphs remain scroll-reachable; they are not inaccessible
content behind the composer. These checks do not certify physical-device IME,
OS push delivery, or assistive-technology behavior outside Chromium.

## Voice mode (1.8)

Pinned brief (design-studio to impeccable handoff): Operate, variance 3, motion 3, density 6;
warm ink identity unchanged. Read: a voice-control addition for developers using the existing
composer, calm utility language. The mic is a 46px outlined circle beside the clay Send, so Send
stays the single primary action; while listening it takes the clay-deep fill and clay ring. One
status strip above the composer carries every voice state in words (Listening, Release to send,
Transcribing, Speaking, Heard/Sent) with Cancel or Stop. A three-bar level meter shows the
microphone is hearing you; it is functional feedback, driven by input level with `transform`, and
keeps tracking input under reduced motion without easing. The ember stays the only ambient motion.
Settings → Voice reuses the existing toggle rows, native select and a text field, with 44px targets.
Rendered 390px scans of the listening strip and Voice settings have no detector findings on voice
elements; remaining findings are the documented existing exceptions.

