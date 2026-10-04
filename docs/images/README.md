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
