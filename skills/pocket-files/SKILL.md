---
name: pocket-files
description: Save, find and share files in Pocket Code's Files library. Use when the user asks to save, put, keep, add or upload something to "files", "my files", "documents", "my documents", "docs" or "the library", to share or publish a report, or to find a file they kept. All of those names mean Pocket's Files storage. Also use when you finish a deliverable meant for the user to read, such as an HTML report, a PDF, an image or a spreadsheet.
---

# Pocket Code Files

Pocket Code keeps a library called **Files** on its own server: reports, dashboards, PDFs,
images, write-ups and spreadsheets that came out of the work. The user opens them in Pocket
Code on any device, and can share them by link. You manage the library with the
`pocket-docs` command.

<!-- pocket:commands -->
Run `pocket-docs` from the Pocket Code directory (`node scripts/pocket-docs.mjs`, or
`npx pocket-docs`). The session instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->

## What the user means

People name it differently. **All of these mean Pocket's Files library:**

| The user says | It means |
|---|---|
| files, my files, the files | Pocket's Files |
| documents, my documents, docs, my docs | Pocket's Files |
| the library, file storage, Pocket, Pocket Code | Pocket's Files |
| "save it", "keep it", "put it somewhere I can see it" (for a deliverable) | Pocket's Files |

It is **not** a `~/Documents` folder on the server, a Google Drive, Dropbox or any other
storage, unless the user names that place. If they name another place, use that place.
"Documents" was the library's name before Pocket Code 1.34, so older notes may say that.

## When to keep a file

Keep a file when the user asks, and on your own for a **finished deliverable meant for the
user to read**: an HTML report or dashboard, a PDF, an image or screenshot, a Markdown
write-up, a CSV or spreadsheet, an Office document, a video.

Do not keep code, configs, logs, scratch files or intermediate drafts unless asked.

Accepted types: `.html .htm .pdf .md .txt .png .jpg .jpeg .gif .webp .csv .tsv .json .docx
.xlsx .pptx .mp4`. For anything else, convert it first (for example to PDF) or tell the user.

## Steps to keep a file

1. **Write the file** to disk as usual.
2. **Keep it:**
   ```bash
   pocket-docs add ./report.html --title "Warehouse stock report" --session <session-id> \
     [--project <project-id>]
   ```
   - Title: what the user would call it, not the file name.
   - `--session`: the current session id, when you know it.
   - `--project`: when the working directory has a tracked Pocket project
     (`pocket-board status` shows it), link the file to it.
   - It is kept **private** (only the signed-in user can open it).
3. **Tell the user** by the file's title: "It's in Files as *Warehouse stock report*."
   Do not give them a server path as the way to open it.

To replace an earlier version, keep the new file and say which one is current; remove the
old one only if the user asks.

## Sharing

Files are private until the user asks to share. Never share on your own.

```bash
pocket-docs share <id> [--expires 7d|30d|none]   # an unguessable link; prints the URL
pocket-docs set <id> --visibility public         # a fixed public address; only when asked to publish
pocket-docs set <id> --visibility private        # stop sharing
```

"Send me a link" or "share it with Sam" means a link (`share`). "Publish it" or "make it
public" means public. Making a new link stops the old one working.

## Finding and tidying

```bash
pocket-docs list [--q "stock"] [--project <id>]   # newest first
pocket-docs show <id>
pocket-docs set <id> --title "New title" [--project <id>]
pocket-docs trash <id>       # only when the user asks; restorable for 30 days
pocket-docs restore <id>
```

## If Files is off

`pocket-docs` exits with code 3 and says so. Tell the user that Files is turned off and can
be turned on in Pocket Code under **Settings → Projects & files → Files**. Until then, leave
the file where you wrote it and give its path.
