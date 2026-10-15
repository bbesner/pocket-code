# Documentation image provenance

The seven workspace screenshots below were captured from the **1.37.0 / build 81** frontend on
2026-10-10, except `vault-desktop.png`, captured from **1.44.1 / build 94** on 2026-10-13, and
`tasks-mobile.png`, captured from **1.50.0 / build 102** on 2026-10-15. They
show synthetic sessions, projects, files, tasks and Vault items supplied by the browser
test fixture, with no production data or model calls. Desktop captures are emulated Chromium
viewports (1600×1000 for the split view; 1440×900 for Projects, Files and the Vault, cropped to the
content area because the hero already shows the session rail); phone captures are
390×844 viewports, not physical devices.

| Image | Shows |
|---|---|
| `desktop-split.png` | The session rail (Sessions, Projects, Files, Tasks) beside two conversations in split view |
| `mobile-workspace.png` | A conversation on a phone with the composer and message settings |
| `projects-desktop.png` | A project card: where we left off, next step, checklist, a due reminder, its session |
| `files-desktop.png` | The Files library as a list, with kinds, sharing state and the project a file came from |
| `tasks-mobile.png` | Tasks on a phone: tasks and project reminders in one list (1.50), due first, one task carrying context from its session |
| `task-offer-mobile.png` | A reply ending with suggested-reply buttons, the first an agent's task offer (1.37) |
| `vault-desktop.png` | The Vault: an agent's waiting request with Deny, Always allow and Allow once, above five items with their kind, site and Agent access |

Projects, Files, Tasks and the Vault are switched on in the fixture for the capture only. Reproduce the
set from the repository root:

```bash
POCKET_DOCS_SCREENSHOTS="$PWD/docs/images" POCKET_DOCS_ONLY=1 node test/browser.mjs
```

Drop `POCKET_DOCS_ONLY=1` (or use `npm run test:browser` with `POCKET_DOCS_SCREENSHOTS`) to
capture and then run the entire browser suite. Set `PUPPETEER_EXECUTABLE_PATH` if Chrome is
not in the default location. The capture helper is `test/docs-screenshots.mjs`. Inspect the
images before committing them and keep alt text in the Markdown.

Other images in this directory are older release illustrations or screenshots retained
for historical design documents. They are not the current README screenshot set.

## Subagents previews (1.16.0 / build 49)

`subagents-mobile.png` (390×844) and `subagents-desktop.png` (1440×900) were captured
on 2026-10-06 by the Subagents regression in `test/ui-regressions.mjs`, using synthetic
tasks and the actual frontend. The phone shows a working agent; the desktop shows
its completed result. These are emulated Chromium views, not physical-device tests.
Capture with `POCKET_SCREENSHOTS=/tmp/pocket-preview npm run test:browser` and copy
those two images from that directory after inspecting them.

## Appearance modes (1.38.0 / build 84)

`appearance-light.png` and `appearance-dark.png` show the same synthetic conversation
at 1440×900 in light and dark mode with the orange accent. Captured 2026-10-11 from
`test/theme-browser.mjs`; no production data or model calls. Reproduce with:

```bash
POCKET_THEME_ONLY=1 POCKET_SCREENSHOTS=/tmp/pocket-themes node test/browser.mjs
```

Copy `theme-light-clay-chat-1440.png` and `theme-dark-clay-chat-1440.png` from that
directory after inspecting them. The suite also captures phone views and blue/purple
palettes. Emulated viewports do not replace installed-app checks on physical devices.
