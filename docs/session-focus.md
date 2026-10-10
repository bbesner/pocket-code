# Collapsible session controls

The header chevron and composer gear work on phone, tablet and desktop. Each
choice is saved in this browser and survives folding, resizing and reloads.

Collapse the header to keep the session title, the live run status, the Subagents
button and the options buttons. Expand it to restore the project name, the open-session
tabs, the Sessions, Results, Queue and Git buttons, Find, Changed files (wide windows),
and the age of the last status check. Since 1.35 the conversation has one header, so
those buttons sit in the same bar as the title: on the title row when it is wide, on a
second line inside it when it is narrow. In Mission Control, the same control also hides
or restores the outer branding and navigation. The session list has its existing
independent toggle.

Use the gear beside the message field to hide or show the toolbar: model, reasoning,
permissions, mode (Codex), Alerts and Voice, plus the Add project chip (since 1.35) and
the Add task chip (since 1.36), each shown only when that feature is on. The paperclip,
the context ring and Send remain available. Attached files, upload and delivery
problems, Stop, steering choices and agent requests stay visible.
The chat text size is unchanged.

## Verification history

The browser suite covers 360–2048px widths, the embedded app on separate origins,
folding and keyboard-sized viewports, independent toggles, keyboard operation,
reload persistence, retained input and attachments, preserved settings, visible
live/stale status, restored parent navigation and rejected foreign messages.
At 390×844, the embedded fixture gains 224px of conversation height when both
sections collapse (501px to 725px). Physical-device keyboard and hinge behavior
still needs a check on the phone.

The original source detector pass reported no findings. Rendered scan exceptions are documented
in DESIGN.md; they concern the existing app shell, native type, intentional
ellipsis, contained tables, slash menu and scrollable content outside the viewport.
