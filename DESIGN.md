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
