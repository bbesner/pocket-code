<!-- manual
checked: 1.79.2
sources: documents.mjs, public/documents.js, scripts/pocket-docs.mjs, skills/pocket-files/SKILL.md, thumbnails.mjs
-->
# Files

Files is a library of the things that came out of your work: HTML reports and dashboards, PDFs, images, Markdown write-ups, spreadsheets, Office documents and video. You open them in Pocket Code on any device, keep them private or share them by link, and see which conversation and project each came from. Agents keep their deliverables here with the `pocket-docs` command, and treat "files", "my files", "documents" and "docs" as this library.

Files was called Documents in older releases. The internal names still say documents: the `#/documents` address, `documents.json`, `POCKET_DOCUMENTS_DIR` and the `pocket-docs` command.

## Turn it on

Files is off until you switch it on for the whole instance:

1. Open **Settings → Projects, files, tasks & vault**.
2. Turn on **Files**.

While Files is off, nothing in the library is served, including public and share links, and `pocket-docs` is refused. Your files and their records stay on disk and come back when you turn it on again. While it is on, Pocket installs the `pocket-files` skill for Claude Code and Codex and tells the agents it runs about the library (see [For agents](#for-agents)).

In Assistant mode the switch is under **Settings → Features** instead. When Assistant mode is locked, ask the person who runs the install.

The same Settings group has three more choices:

| Setting | Scope | What it does |
|---|---|---|
| **Keep files from replies** | Instance | After each reply, keeps the files the reply handed you in Files, once each, linked to the conversation. Needs Files on; always on in Assistant mode. |
| **Files button** | This device | What the rail's Files segment does: **Lists files in the sidebar**, **Opens the library in a tab**, or **Opens the library in split view**. |
| **Open files and links** | This device | Whether clicking a file opens it **As a tab, like a conversation**, **Beside the conversation**, or **In a new browser window**. A link in a conversation to one of your files, projects or conversations opens the same way. |

## Use it

### Open the library

- On a computer, use the **Files** segment in the rail. The sidebar list has **Upload**, **Split** (the library in a pane beside the current view), **Tab** and a search box, and shows the 20 newest files.
- On a phone, use the **Files** chip on the conversation list.
- The library itself is at `#/documents`.

From 700 pixels wide the library is a grid of previews; the **List** and **Grid with previews** buttons switch between rows and the grid, remembered per browser. Phones show the list. In a split-view pane the grid is offered at any width.

### Add files

There are five ways in:

- **Upload.** Click **Upload** in the library or the rail and pick one or more files. Each file can be up to 30 MB. When the library is filtered to a project, uploads are linked to that project.
- **From a conversation.** A file a reply hands you (named in the reply as a link, a code span or a path on its own line) shows as a card under the reply with **Keep in Files**; images show in the reply itself and get no card. The conversation's **Results** panel has **Keep in Files** on each file result too. A kept file is linked to the conversation; from Results it is also linked to the conversation's open project.
- **Automatically.** With **Keep files from replies** on, every PDF, Word, PowerPoint, Excel, CSV, HTML, Markdown, PNG, JPEG, GIF or WebP file a reply names is kept once, linked to the conversation.
- **By an agent.** An agent runs `pocket-docs add` (see [For agents](#for-agents)). Agents are told to do this for finished deliverables.
- **By putting a file in the folder.** A file copied straight into the library's folder on the server (`POCKET_DOCUMENTS_DIR`) appears as a private file the next time the library is listed. Only files at the top of the folder count; subfolders and names starting with a dot are ignored.

Accepted types: `.html .htm .pdf .md .txt .png .jpg .jpeg .gif .webp .csv .tsv .json .docx .xlsx .pptx .mp4`. Anything else is refused ("That file type cannot be kept in Files."); convert it first, for example to PDF.

A file kept from a conversation or by an agent must be a regular file inside the home directory of the user Pocket runs as, and not inside a hidden folder (one whose name starts with a dot). Pocket copies it into the library, so later changes to the original do not reach the kept copy.

The title is the HTML `<title>`, the first Markdown heading, or the file name with `_` and `-` turned into spaces, unless one is given. The stored name keeps only letters, digits, `.`, `_` and `-`, and gets `-2`, `-3` added when the name is taken.

### Read a file

Click a file to open it. What you see depends on the kind:

| Kind | Shown as |
|---|---|
| HTML | The page itself, in a sandboxed frame (see [HTML sandboxing](#html-sandboxing)). HTML over 10 MB is not shown inline. |
| PDF | The browser's PDF viewer. |
| Image | The image. |
| Markdown | Formatted text. |
| Text, JSON | Plain text; JSON is pretty-printed. |
| CSV, TSV | A table; the first row is the header, and the first 2,000 rows are shown. |
| Office (`.docx`, `.xlsx`, `.pptx`) | Not shown; open it in your viewer or download it. |
| Video | A player, plus open in your viewer or download. |

The toolbar above a file has **Open in your viewer** (the file itself, in the app your device uses for it), **Download**, **Share**, **Copy link** (when shared), **Project** (when Projects is on) and **Conversation** (when it came from one).

### Find a file

- **Search files** matches the title, file name, project, conversation, kind and visibility.
- The chips **All**, **Private**, **Link** and **Public** filter by visibility, with counts.
- **Kind** narrows to HTML reports, PDFs, Images, Markdown and text, CSV and JSON, or Office and video.
- **Project** (when you have projects) narrows to one project's files.
- **Clear** resets the search and filters.

### Share a file

Every file starts **Private**. Click **Share** (in the toolbar or the file's options) to choose who can open it:

| Choice | Who can open it | Address |
|---|---|---|
| **Private** | Only you, after signing in to Pocket Code. | `#/documents/<id>` on your Pocket address. |
| **Anyone with the link** | Anyone who has the link. | `/share/<token>`: an unguessable address. |
| **Public** | Anyone. | `/files/<file name>`: a fixed address by file name. |

For a link, **Expires** sets **Never**, **In 7 days** or **In 30 days**, and **New link** replaces the address; the old one stops working at once. Switching away from **Anyone with the link** also ends the old link; switching back makes a new one. Shared files have **Copy link** in the toolbar, the options and on their row or card.

Links are served by Pocket on its own address, with headers that tell search engines not to index them. A shared file cannot be framed by another site.

### Link files to projects and conversations

A file knows the conversation and the project it came from. In the file's options, **Add to a project** (or **Project: *name***) picks an open project or **No project**. A project's card lists its files (see [Projects](projects.md#what-a-card-holds)), and the library's **Project** filter shows them all. The **Conversation** button opens the conversation a file came from.

### Rename, remove and restore

- **Rename** in the file's options changes the title, not the stored file name.
- **Remove** moves the file to the trash for 30 days. Any share or public link stops working at once.
- **Select** in the library header turns the list into checkboxes. Tick files, or **Select all** for what the search and filters show, then **Remove** moves them all to the trash after one confirmation. **Done** or Escape leaves select mode. A file hidden by a search or filter is dropped from the selection.
- The **Trash** group at the bottom of the library lists removed files. **Restore** puts a file back as private; share it again if you need a link. **Delete forever** in a trashed file's options, and **Empty trash**, delete from the server at once with the file's preview. Neither can be undone.
- After 30 days in the trash a file is deleted automatically.

Only you can delete a file for good. An agent can move a file to the trash or restore it, but never delete one.

## How it works

### Where files live

| What | Where |
|---|---|
| The files | `POCKET_DOCUMENTS_DIR`, default `<data dir>/documents`. Stored with mode `0600`. |
| Records (title, kind, visibility, project, conversation, share link) | `documents.json` in `POCKET_DATA_DIR`, which defaults to the Pocket Code directory. |
| Trash | `.trash/` inside the files folder, as `<id>-<file name>`. |
| Preview pictures | `.thumbs/` inside the files folder. |

The server is the only writer of `documents.json`. A file deleted from the folder by hand keeps its record and shows **(file missing)**; its links stop working. Pocket serves a stored file only when it is a regular file inside the library's folder, so a stored file replaced by a symbolic link is not served on any link. The trash is cleared of files older than 30 days every six hours and a minute after the server starts.

### HTML sandboxing

An HTML file is sent with a Content Security Policy sandbox that lets its own scripts, forms, pop-ups and downloads run but gives it no access to Pocket's cookies, storage or API. A dashboard with charts works; a page cannot act as you. Inside Pocket it also renders in a sandboxed frame. Other kinds are sent with a policy that loads nothing else. The same rules apply to share and public links.

### Preview pictures

The grid's previews are made once with tools already on the server and cached in `.thumbs/`, keyed by the file's size and modification time, so a changed file gets a new picture:

| Kind | Tool | Variable to choose or disable |
|---|---|---|
| HTML | Chrome or Chromium, headless | `POCKET_CHROME` |
| PDF (first page) | `pdftoppm` from poppler | `POCKET_PDFTOPPM` |
| Image | ImageMagick `convert` or `magick`, else Chrome | `POCKET_CONVERT` |

Each variable takes a path; an empty value turns that tool off. Without a tool for a kind, the card shows the kind's name instead. Pocket makes two pictures at a time, gives each 20 seconds, and after a failure waits 10 minutes before trying the same file again.

### Limits

| Limit | Value |
|---|---|
| Files in the library | 5,000 |
| Upload | 30 MB per file |
| HTML shown inline | 10 MB |
| Title | 200 characters |
| Stored file name | 120 characters |
| Trash | 30 days |

### Settings and environment

| Setting or variable | Effect |
|---|---|
| **Settings → Projects, files, tasks & vault → Files** | Turns the library on for the instance (`documents` in `pocket-settings.json`). |
| **Keep files from replies** | Keeps files named in replies automatically (`autoKeepFiles`). |
| `POCKET_DOCUMENTS_DIR` | Where the files are kept. Default `<data dir>/documents`. |
| `POCKET_PUBLIC_URL` | Makes the share and public addresses `pocket-docs` prints absolute. |
| `POCKET_CHROME`, `POCKET_PDFTOPPM`, `POCKET_CONVERT` | The preview tools; an empty value turns one off. |
| `POCKET_SKILLS=0` | Stops Pocket installing its skills into the agents' skill folders. |

## For agents

### When to keep a file

Keep a file when the user asks ("save it to my files", "put it in documents", "keep it where I can see it"), and on your own for a **finished deliverable meant for the user to read**: an HTML report or dashboard, a PDF, an image, a Markdown write-up, a CSV or spreadsheet, an Office document, a video. Do not keep code, configs, logs, scratch files or drafts unless asked. "Files", "my files", "documents", "my documents" and "docs" all mean this library, not a folder on the server or another drive, unless the user names one.

Never share on your own. "Send me a link" or "share it with Sam" means a link (`share`); "publish it" or "make it public" means public. Tell the user about a file by its title, not its server path.

While Files is on, every conversation Pocket runs gets this instruction, with the install's command path and the conversation's id filled in:

> This Pocket Code keeps a Files library. When the user says files, my files, documents, my documents or docs, they mean this library (not a folder on the server or another drive, unless they name one); the pocket-files skill has the full procedure. When you produce a deliverable for the user to read (an HTML report or dashboard, a PDF, an image, a Markdown write-up, a CSV or spreadsheet), or the user asks to save something there, keep it with `add <path> --session <id> [--title "…"] [--project <id>]` so it appears in Pocket's Files, linked to this session; link it to the directory's tracked project when there is one. Files are private unless the user asks to share; use `share <id>` for a link only when asked. Mention the file by its title in your reply, not by server path.

The [pocket-files skill](../../skills/pocket-files/SKILL.md) has the full procedure. While Files is on, Pocket installs it into `~/.claude/skills/pocket-files` and, when Codex is installed, `$CODEX_HOME/skills/pocket-files`, with the exact command for this server. It never overwrites a same-named folder it did not create.

### Running the command

Run `node scripts/pocket-docs.mjs` from the Pocket Code directory; the installed skill names the full path. It talks to the running server over loopback with the token in `<data dir>/cli-token` and never touches the library's folder itself. It finds the server and data directory the same way as [`pocket-board`](projects.md#running-the-command), and prints times in the user's time zone.

The file you `add` must be inside the home directory of the user Pocket runs as and not in a hidden folder. Write deliverables to the working directory or another folder under home, not `/tmp`.

### Command reference

| Command | What it does |
|---|---|
| `add <path> [--title "…"] [--project <id>] [--session <id>] [--visibility private\|link\|public]` | Copies the file into the library. Private unless `--visibility` says otherwise; with `link`, the share address is printed. `--project` must name an existing project. `--session` is a Claude session id, or `cx:<id>` for Codex. |
| `list [--project <id>] [--q text] [--json]` | Files, newest first: id, visibility, kind, title, project, stored name and date. `--q` matches the title and stored file name. Prints how many are in the trash. |
| `show <id> [--json]` | One file, from the library or the trash, with its share address when it is shared. |
| `share <id> [--expires <n>d\|none]` | Makes the file link-visible, or gives an already shared file a new link (the old one stops working, and the command says so), and prints the address. `--expires` takes a number of days followed by `d` (`7d`, `30d`), or `none`. Without it, a new link has no expiry and a renewed link keeps its old expiry. |
| `set <id> [--title "…"] [--project <id>] [--visibility private\|link\|public]` | Changes the title, project or visibility, and prints the file with its share address. `--project` must be the id of an existing project (`pocket-board status --all` lists them); an empty `--project ""` removes the project. Setting `link` prints the new address. |
| `trash <id>` | Moves the file to the trash (restorable for 30 days). Only when the user asks. |
| `restore <id>` | Brings a file back from the trash, as private. |
| `import <dashboard-files-meta.json>` | One-time import of the older Mission Control dashboard's file metadata for files already in the library's folder. |
| `help` | The usage summary. |

There is no delete command. If the user wants a file gone for good, trash it and tell them **Delete forever** or **Empty trash** is in the library's Trash.

When the user asks for the link to a file that is already shared, give the address `show <id>` prints. Do not run `share` for it: that makes a new link and the one they already sent stops working.

### Examples

Here `pocket-docs` stands for `node scripts/pocket-docs.mjs`.

```bash
pocket-docs add ./reports/stock-report.html --title "Warehouse stock report" \
  --session 3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b --project acme-hoa-camera-upgrade
pocket-docs list --q stock
pocket-docs share 9c1e5b7d4e8f --expires 7d
pocket-docs set 9c1e5b7d4e8f --visibility private
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | Any other error; the message says what. |
| 3 | Files is off. Tell the user to turn it on under **Settings → Projects, files, tasks & vault → Files**, and give the file's path until then. |
| 4 | The token was refused. |
| 5 | No file has that id. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Files outside the home directory, or in hidden directories, are not kept.` | The path (after following links) is outside the home directory of the user Pocket runs as, or inside a folder starting with a dot. | Write the file under home, outside hidden folders, and add it from there. |
| `That file type cannot be kept in Files.` | The extension is not on the accepted list. | Convert it, for example to PDF or CSV. |
| An upload fails ("Payload Too Large" or similar) | The file is over 30 MB. | Keep it from a conversation or with `pocket-docs add`, which have no upload limit, or make it smaller. |
| "This file is too large to show here." | HTML over 10 MB. | Use **Open in your viewer** or **Download**. |
| A row says **(file missing)** | The stored file was deleted or moved on the server. Its links return 404. | Put the file back in the folder under the same name, or remove the record. |
| No preview pictures | The server has no tool for that kind, or the tool failed. | Install Chrome or Chromium, poppler or ImageMagick, or point `POCKET_CHROME`, `POCKET_PDFTOPPM` or `POCKET_CONVERT` at it. Failures are in the server log. |
| A share link stopped working | The file was made private, given a new link, removed, its link expired, or Files was turned off. | Share it again. |
| `pocket-docs` prints `/share/…` without a host | `POCKET_PUBLIC_URL` is not set. | Set it in `.env`, or put your Pocket address in front. |
| `No CLI token at …`, `not reachable`, exit 4 | The same causes as for `pocket-board`. | See [Projects troubleshooting](projects.md#troubleshooting). |
