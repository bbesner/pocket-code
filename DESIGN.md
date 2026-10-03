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
