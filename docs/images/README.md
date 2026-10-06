# Documentation image provenance

The current README uses **desktop-split.png** and **mobile-workspace.png**, captured
from the 1.7.1/build 32 frontend on 2026-10-04. They show synthetic sessions supplied
by the browser test fixture, with no production data or model calls. Desktop capture
is 1600×1000; phone capture is a 390×844 Chromium viewport, not a physical device.

Reproduce the current assets from the repository root:

```bash
POCKET_DOCS_SCREENSHOTS="$PWD/docs/images" npm run test:browser
```

Set `PUPPETEER_EXECUTABLE_PATH` if Chrome is not in the default location. The capture
helper is `test/docs-screenshots.mjs`; the same command still runs the entire browser
suite. Inspect the images before committing them and keep alt text in the Markdown.

Other images in this directory are older release illustrations or screenshots retained
for historical design documents. They are not the current README screenshot set.

## Subagents previews (1.16.0 / build 49)

`subagents-mobile.png` (390×844) and `subagents-desktop.png` (1440×900) were captured
on 2026-10-06 by the Subagents regression in `test/ui-regressions.mjs`, using synthetic
tasks and the actual frontend. The phone shows a working agent; the desktop shows
its completed result. These are emulated Chromium views, not physical-device tests.
Capture with `POCKET_SCREENSHOTS=/tmp/pocket-preview npm run test:browser` and copy
those two images from that directory after inspecting them.
