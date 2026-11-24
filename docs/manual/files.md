<!-- manual
checked: 1.124.9
sources: documents.mjs, public/documents.js, scripts/pocket-docs.mjs, skills/pocket-files/SKILL.md, thumbnails.mjs
-->
# Files

Files is a library of the things that came out of your work: HTML reports and dashboards, PDFs, images, Markdown write-ups, spreadsheets, Office documents and video. You open them in Pocket Code on any device, keep them private or share them by link, and see which conversation and project each came from. Agents keep their deliverables here with the `pocket-docs` command, and treat "files", "my files", "documents" and "docs" as this library.

Files was called Documents in older releases. The internal names still say documents: the `#/documents` address, `documents.json`, `POCKET_DOCUMENTS_DIR` and the `pocket-docs` command.

## Turn it on

Files is off until you switch it on for the whole instance:

1. Open **Settings → Features**.
2. Turn on **Files**.

While Files is off, nothing in the library is served, including public and share links, and `pocket-docs` is refused. Your files and their records stay on disk and come back when you turn it on again. While it is on, Pocket installs the `pocket-files` skill for Claude Code and Codex and tells the agents it runs about the library (see [For agents](#for-agents)).

When Assistant mode is locked, ask the person who runs the install.

The **›** beside **Files** opens the Files page, which has three more choices (Developer mode):

| Setting | Scope | What it does |
|---|---|---|
| **Keep files from replies** | All your devices | After each reply, keeps the files the reply handed you in Files, once each, linked to the conversation. Needs Files on; always on in Assistant mode. |
| **Files button** | This device only | What the rail's Files segment does: **Lists files in the sidebar**, **Opens the library in a tab**, or **Opens the library in split view**. |
| **Open files and links** | This device only | Whether clicking a file opens it **As a tab, like a conversation**, **Beside the conversation**, or **In a new browser window**. A link in a conversation to one of your files, projects or conversations opens the same way. |

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

The toolbar above a file has **Open in your viewer** (the file itself, in the app your device uses for it), **Download**, **Share**, **Copy link** (when public), **Project** (when Projects is on) and **Conversation** (when it came from one).

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

When you make a link, the sheet shows its address once, with **Copy**. Copy it then: Pocket keeps only a fingerprint (a hash) of the address, so it cannot show it again. Afterwards the sheet says a link is open and when it expires, with **Make a new link** and **Revoke link**. **Make a new link** shows a new address once and the old one stops working at once; **Revoke link** makes the file private. **Expires** sets **Never**, **In 7 days** or **In 30 days**. Switching away from **Anyone with the link** also ends the old link; switching back makes a new one. Public files have **Copy link** in the toolbar, the options and on their row or card, since their address is fixed.

Links made before 1.118 keep working after the upgrade, but their addresses are no longer stored, so Pocket cannot show them; use the address you sent, or make a new link.

### When an agent asks to share

An agent can keep files and change their title or project, but it cannot share or publish a file on its own: text it reads could try to trick it. When an agent asks to make a file a link or public, give it a new link, or keep its link open longer, the file stays as it is and a **Requests** card appears at the top of Files (and in the side panel's Files list), with a push notification if push is on. The card says which conversation asks, the file, the exact change (for example *Make public at https://pocket.example.com/files/report.html* or *Create a share link, expires Dec 1, 2026, 9:00 AM*), where the file came from, and its kind and size.

- **Allow** makes that change, once. If the file's content, name or sharing changed since the agent asked, nothing changes and Pocket says why; ask the agent to try again if you still want it.
- **Deny** changes nothing. A request you don't answer ends after 15 minutes and changes nothing.
- **Allow** and **Deny** on the notification answer the same way; if the answer cannot be recorded, Files opens with the card. A card already answered on the notification or another device says what that answer did (*Already allowed. Shared …*) and goes away (1.124.5).

A reply that [a job key started](automation.md#job-keys) can ask too, and the request waits for you like any other: the run reads **needs you** to the script that started it ([What waits for you in a job reply](automation.md#what-waits-for-you-in-a-job-reply)).

Each request covers one file and one change. Allowing a link does not allow making the file public later; that is a new request. There is no "always allow". Making a file private, or its link expire sooner, needs no request, and nothing changes for what you do yourself in Pocket.

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
| Records (title, kind, visibility, project, conversation, a hash of the share link) | `documents.json` in `POCKET_DATA_DIR`, which defaults to the Pocket Code directory. |
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

Since 1.89 the tool reads a private copy of the file as Pocket opened and checked it, never the file by its name, and an image's format is read from the file's first bytes and must be PNG, JPEG, GIF or WebP. A JPEG or WebP saved under a `.png` name still gets its picture. Any other file, such as a `.png` that holds SVG or PostScript, gets no picture; the card shows the kind's name and the daemon log says `thumbnail failed … not a PNG, JPEG, GIF or WebP picture`.

Since 1.118 an HTML file's picture is drawn with its scripts off and the network shut: Chrome cannot look up any host, and the page cannot load another local file. A report's own text, inline styles and `data:` images appear; its remote images, web fonts and charts drawn by script do not. Opening the file shows everything as before.

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
| **Settings → Features → Files** | Turns the library on for the instance (`documents` in `pocket-settings.json`). |
| **Keep files from replies** | Keeps files named in replies automatically (`autoKeepFiles`). |
| `POCKET_DOCUMENTS_DIR` | Where the files are kept. Default `<data dir>/documents`. |
| `POCKET_PUBLIC_URL` | Makes the share and public addresses `pocket-docs` prints absolute. |
| `POCKET_CHROME`, `POCKET_PDFTOPPM`, `POCKET_CONVERT` | The preview tools; an empty value turns one off. |
| `POCKET_SKILLS=0` | Stops Pocket installing its skills into the agents' skill folders. |

## For agents

### When to keep a file

Keep a file when the user asks ("save it to my files", "put it in documents", "keep it where I can see it"), and on your own for a **finished deliverable meant for the user to read**: an HTML report or dashboard, a PDF, an image, a Markdown write-up, a CSV or spreadsheet, an Office document, a video. Do not keep code, configs, logs, scratch files or drafts unless asked. "Files", "my files", "documents", "my documents" and "docs" all mean this library, not a folder on the server or another drive, unless the user names one.

Never share on your own. "Send me a link" or "share it with Sam" means a link (`share`); "publish it" or "make it public" means public. Tell the user about a file by its title, not its server path.

Sharing or publishing asks the user first. `share`, `set --visibility link|public`, `set --expires` with a later date, and `add --visibility link|public` wait up to `--wait` seconds (default 90) for the user's **Allow**. If they have not answered by then, the command prints `pending <id>` and exits 6: tell the user it is waiting for their Allow in Files or on the notification, then run `wait <id>`. A denied or expired request exits 7 and nothing was shared. Don't retry a denied request unless the user asks again.

While Files is on, every conversation Pocket runs gets this instruction, with the install's command path and the conversation's id filled in:

> This Pocket Code keeps a Files library. When the user says files, my files, documents, my documents or docs, they mean this library (not a folder on the server or another drive, unless they name one); the pocket-files skill has the full procedure. When you produce a deliverable for the user to read (an HTML report or dashboard, a PDF, an image, a Markdown write-up, a CSV or spreadsheet), or the user asks to save something there, keep it with `add <path> --session <id> [--title "…"] [--project <id>]` so it appears in Pocket's Files, linked to this session; link it to the directory's tracked project when there is one. Files are private unless the user asks to share; use `share <id>` for a link only when asked. Sharing or publishing asks the user to allow it in Pocket: if the command prints `pending <id>`, tell the user it is waiting for their Allow and continue with `wait <id>`. Mention the file by its title in your reply, not by server path.

The [pocket-files skill](../../skills/pocket-files/SKILL.md) has the full procedure. While Files is on, Pocket installs it into `~/.claude/skills/pocket-files` and, when Codex is installed, `$CODEX_HOME/skills/pocket-files`, with the exact command for this server. It never overwrites a same-named folder it did not create.

### Running the command

Run `node scripts/pocket-docs.mjs` from the Pocket Code directory; the installed skill names the full path. It talks to the running server over loopback with the token in `<data dir>/cli-token` and never touches the library's folder itself. It finds the server and data directory the same way as [`pocket-board`](projects.md#running-the-command), and prints times in the user's time zone.

The file you `add` must be inside the home directory of the user Pocket runs as and not in a hidden folder. Write deliverables to the working directory or another folder under home, not `/tmp`.

### Command reference

| Command | What it does |
|---|---|
| `add <path> [--title "…"] [--project <id>] [--session <id>] [--visibility private\|link\|public] [--wait <s>]` | Copies the file into the library as private. With `--visibility link` or `public` it then asks the user (see above); once allowed, a link's address is printed, once. `--project` must name an existing project. `--session` is a Claude session id, or `cx:<id>` for Codex. |
| `list [--project <id>] [--q text] [--json]` | Files, newest first: id, visibility, kind, title, project, stored name and date. `--q` matches the title and stored file name. Prints how many are in the trash. |
| `show <id> [--json]` | One file, from the library or the trash, with its public address when it is public. For a link it says a link is open and when it expires, not the address: Pocket keeps only a hash of it. |
| `share <id> [--expires <n>d\|none] [--wait <s>]` | Asks the user to make the file link-visible, or to give an already shared file a new link (the old one stops working, and the command says so). Once allowed, prints the address, once. `--expires` takes a number of days followed by `d` (`7d`, `30d`), or `none`. Without it, a new link has no expiry and a renewed link keeps its old expiry. |
| `set <id> [--title "…"] [--project <id>] [--visibility private\|link\|public] [--expires <n>d\|none] [--wait <s>]` | Changes the title, project, visibility or link expiry, and prints the file. Making it private or its link shorter-lived happens at once; `link`, `public` or a later expiry asks the user first, and setting `link` prints the new address once allowed. `--project` must be the id of an existing project (`pocket-board status --all` lists them); an empty `--project ""` removes the project. |
| `wait <request-id> [--wait <s>]` | Continues a share or publish the user was asked to allow: prints the result once allowed (a link's address included), `pending <id>` again if they have not answered yet. Only the conversation (or terminal) that asked can continue it, once. |
| `trash <id>` | Moves the file to the trash (restorable for 30 days). Only when the user asks. |
| `restore <id>` | Brings a file back from the trash, as private. |
| `import <dashboard-files-meta.json>` | One-time import of an older dashboard's file metadata for files already in the library's folder. From an agent every file comes in private, and the command lists the ones the metadata had shared; the user shares them, or ask for each with `share` or `set`. |
| `help` | The usage summary. |

There is no delete command. If the user wants a file gone for good, trash it and tell them **Delete forever** or **Empty trash** is in the library's Trash.

When the user asks for the link to a file that is already shared by link, say Pocket cannot show it again and ask them for the address they were given; only if they want a new one, run `share` (the old address stops working). For a public file, give the address `show <id>` prints.

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
| 3 | Files is off. Tell the user to turn it on under **Settings → Features → Files**, and give the file's path until then. |
| 4 | The token was refused. |
| 5 | No file has that id. |
| 6 | Pending: the user has not answered yet. Tell them, then run `wait <id>`. |
| 7 | Denied, expired, already used, or the file changed before the user answered. Nothing was shared. |

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
| Pocket does not show a link you made earlier | Pocket keeps only a hash of a share link's address, so it shows it once, when it is made (since 1.118). | Use the address you copied or sent, or **Make a new link** (the old one stops working). |
| An agent says its share is `pending` | Sharing or publishing waits for your **Allow**. | Answer the card at the top of Files, or the notification. |
| **Allow** says the file changed | The file's content, name or sharing changed after the agent asked, so nothing was shared. | Ask the agent to ask again if you still want it shared. |
| A share request is refused: *That file is not a regular file inside the library* | The stored file was replaced by a link or something other than a plain file, so Pocket will not share it. | Put the real file back in the library's folder, or keep it again with `pocket-docs add`. |
| `pocket-docs` prints `/share/…` without a host | `POCKET_PUBLIC_URL` is not set. | Set it in `.env`, or put your Pocket address in front. |
| After a restart every file is private with its file name as the title, and shared links stopped working; Files says *Files could not read its list* (since 1.124.5; until you choose **Dismiss**) and the server log says `documents.json could not be read` | `documents.json` did not hold valid JSON when Pocket started (a hand edit, or a file damaged by a power cut). Since 1.124.2 Pocket keeps it beside the original as `documents.json.corrupt-<time>`, says so in the server log, and starts with no records, so the next listing adopts the folder's files again as new private ones. | Stop Pocket, fix the kept copy (or take `documents.json` from your backup), move it back to `documents.json`, then start Pocket. The files themselves were never touched; your titles, projects and links come back with the old records. |
| `No CLI token at …`, `not reachable`, exit 4 | The same causes as for `pocket-board`. | See [Projects troubleshooting](projects.md#troubleshooting). |
