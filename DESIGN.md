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
| `--faint` | `#7A7169` | timestamps, ledger (4.6:1 on bg) |
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

- **Sessions:** hairline-separated rows (no cards): 2-line title, meta line `project · time`.
  Active session shows the ember left of the title. FAB bottom-right (drawn + icon) → New.
- **Chat:** slim header (back chevron, 1-line title, project tag). User messages: right-aligned
  clay-deep chips, max-width 85%. Assistant: full-width document text. Tool calls: ledger lines
  `⌁ Bash  pm2 list` in mono/faint with drawn 14px stroke icons. Input bar pinned bottom,
  auto-growing textarea, clay circular send (arrow-up). While working: input stays usable-looking
  but disabled, ember + "working" in the bar.
- **New:** recent project dirs as radio rows + free path field, message box, single primary action.
- **Login:** centered, one field, one button.

Icons: authored inline SVG, 1.8px stroke, round caps — chevron-left, plus, arrow-up, folder,
terminal, doc, globe, cog. No emoji as UI.
