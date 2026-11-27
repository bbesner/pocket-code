<!-- manual
checked: 1.125.3
sources: vault.mjs, intake-page.mjs, public/intake/intake.css, public/vault.js, scripts/pocket-vault.mjs, skills/pocket-vault/SKILL.md, public/secret-detect.js, scripts/pocket-mcp-proxy.mjs
-->
# Vault

The Vault keeps API keys, tokens, logins and secure notes encrypted on the Pocket Code server, so agents can use them by name. An agent asks Pocket to run a command with a secret in its environment, and gets the output back with the value replaced by `{{vault:name}}`. In normal use the value stays out of the agent's conversation, the transcript, Pocket's logs and the agent's memory, and you decide which commands and which forms get it. It is not a wall against an agent that sets out to get a value; see [Security model and limits](#security-model-and-limits) before you choose how freely agents may use a secret.

## Turn it on

1. Open **Settings → Features** and tap the **Vault** switch.
2. The first time, Pocket creates the Vault's encryption key, saves it to the `.env` file in the Pocket Code directory (mode `0600`) and opens the **Save your recovery key** sheet. Use **Copy** or **Download** and keep the key in your password manager, then tap **Done**.

The recovery key is the only way to open a backup of `vault.enc` if the server or its `.env` is lost. **Download** saves a text file named `pocket-vault-recovery-key-<host>-<date>.txt` with one `POCKET_VAULT_KEY=…` line.

Turning the Vault on (or off) closes idle agent processes, so each conversation's next message starts a process with the new instructions. A conversation that is replying at that moment keeps its current instructions until its process is next started. The switch also installs (or removes) the `pocket-vault` skill. See [For agents](for-agents.md).

The **Vault** switch's description tells you its state:

| Description | What it means |
|---|---|
| Off. Turning it on creates this install's encryption key… | No key and no store yet. Tapping it sets everything up. |
| This Vault's key is missing on this server… | A `vault.enc` exists but no key is set. Use **Restore key…** (on the Vault page, which the **›** beside the switch opens). |
| Off. The Vault cannot be opened: … | A key is set but does not open the store. The switch stays disabled until the right key is in place. |

The **›** beside the switch opens the Vault page with the rest of the Vault's settings. In Assistant mode that page shows only **Restore key…**, when the key is missing; the other Vault settings stay in Developer mode. When Assistant mode is locked, ask the person who runs the install.

## Use it

Open the Vault from the rail's **Vault** entry, the **Vault** chip on the home screen, or `#/vault`. It opens like Tasks: as a tab, beside a conversation, or in a window of its own.

### Find a secret

- **Who can use it, at a glance.** Every secret's line starts with who can use it, as a small coloured dot and words: amber for **Free rein**, blue for **Asks once per command**, purple for **Asks every time**, green (a square dot) for **Only you**. A secret that follows the Vault default shows what that default means for it now.
- **Sort.** The list is **Newest first** by default. **Sort** also offers **A–Z**, **Who can use it** (least protected first: Free rein, then Asks once per command, Asks every time and Only you, each under its own heading), **Recently used**, **Kind** (Logins, API keys, Tokens, Credentials, Secure notes, each under a heading) and **Expiring soonest** (secrets with no expiry last). The order you pick is the order the Vault opens in next time, on every device; **Settings → Features → Vault ›** shows the same choice as **Default order**. A device that kept **A–Z** before 1.125 hands it to the server once, unless an order was already chosen.
- **New.** A secret stored in the last 24 hours carries a **New** mark, and its line says when and in which conversation it was added.
- **Search.** **Search secrets** narrows the list as you type. It matches the name, the kind, tags, the website, the conversation that stored it and the words for who can use it, so *free rein* or *only you* finds those secrets. With several words, all must match; matched words are marked. **Esc** clears the box.
- **Filter.** **Filter** opens a sheet with two groups, **Who can use it** and **Kind**, each choice with how many secrets it holds. Pick any number in each group: a secret shows when it matches one choice in every group you used. The button then names the filter, a line under the toolbar repeats it with **Clear**, and the count reads *2 of 5*. The filter clears when you leave the Vault.
- **In the rail.** The Vault segment has the same search box and a sort button that opens the order choices; the rail's **Filters** toggle folds them away. While you search, the rail lists every match. **Filter** is on the full page only.
- **Links.** `#/vault/item/<name>` opens the Vault with that secret's sheet open and its row marked. When an agent stores a secret from a conversation, the conversation shows a card for it under the next reply; tap it to open the secret. Agents link a secret the same way in their replies.

### Add a secret

1. Tap **Add secret** in the Vault view, or **Add** in the sidebar's Vault panel.
2. Fill in **Name** (lowercase letters, numbers and hyphens, up to 64 characters, such as `billing-api`). Agents use this name.
3. Choose a **Kind**. The kind is fixed once saved.
4. Enter the values. **Show** unmasks what you typed.
5. Optionally add **Website**, **Tags** (comma-separated), **Notes**, **Who can use it** and **Expires**. A secret whose expiry is less than 14 days away, or past, is marked in the list.
6. Tap **Save to the Vault**.

| Kind | Fixed fields | How an agent names it |
|---|---|---|
| **API key** | value | `name` |
| **Token** | value | `name` |
| **Login** | username, password | `name.username`, `name.password` |
| **Credentials** | none; only the fields you add | `name.client_id`, `name.client_secret`, … |
| **Secure note** | text | `name` or `name.text` |

Any item can carry up to 20 **custom fields** beside its fixed ones: tap **Add field**, give it a name (a lowercase letter, then up to 31 lowercase letters, digits or underscores, such as `client_id`) and a value. When an item has more than one field, an agent must always name the field (`name.field`).

### Store a secret from a conversation

Never paste a secret into a message. Use **Store in the Vault** instead, from the composer's attach button (**Attach a file or screenshot → Store in the Vault**) or from the conversation's options. It opens the same add sheet, and once saved puts `{{vault:name}}` into the message box. A `{{vault:name}}` in your message tells the agent which stored secret to use.

### Ask someone outside for a secret

When a customer or vendor has a login you need, send them a one-time link instead of asking for it by email, chat or phone (1.110).

1. In the Vault, tap **Ask someone**. It sits at the top of the Vault page and, on a computer, in the sidebar's Vault panel beside **Add**.
2. Fill in **Name** (what the secret will be called in the Vault, for example `acme-quickbooks`), **Kind** (Login by default), any **Extra fields** beyond the kind's own (for example `pin`), **Who it's for**, **What it is** (the page's heading) and **Link works for** (1, 3 or 7 days).
3. Tap **Create link**. Pocket shows the link once. **Copy** it and send it to the person yourself.

The person opens a plain page with your organisation's name, logo and colour, who asked and for what, the fields for that kind, an optional note, and **Send securely**. It shows nothing else from the Vault. What they type is stored as a new secret under the name you chose, with the Vault default policy, and the page answers *Received. Thank you.* without showing anything back. You get a notification (*<who> filled in <name>*) that opens the secret.

The link works once. Opening it does not use it up, so a mail scanner that follows it changes nothing; only sending the form does. A used, cancelled or expired link shows *This link is no longer active*. While the Vault is locked or off the page says *Temporarily unavailable*, keeps nothing, and the link stays open for when it is unlocked.

**Links sent**, above your secrets, lists the links that are waiting and the ones that ended in the last week. A link an agent made says so, with its conversation's title when known (*Made by the agent in "…"*), and one made from a terminal says *Made from a terminal*; a link replaced with **New link** says which one it is (*Link 2*). When the person sends the form you get a notification, which says which conversation asked (1.124.5). A waiting link has **New link** (the old address stops working and you copy the new one) and **Cancel**. A filled one has **Open**. The name stays reserved for the link while it waits: nothing else can be added or renamed to it. Up to 50 links can wait at once.

**Branding.** The page shows the organisation and colour from three settings in `.env` (restart Pocket after changing them):

| Variable | What it does |
|---|---|
| `POCKET_INTAKE_ORG` | Your organisation's name, for example `Example Security`. Without it the page says "the team that sent you this link". |
| `POCKET_INTAKE_ACCENT` | The button and focus colour, as `#rrggbb`. Pocket picks dark or white button text for contrast and darkens the colour where it is used as text. |
| `POCKET_INTAKE_LOGO` | Path to a PNG, JPEG or WebP logo for a light background, up to 512 KB. |

The page lives at `/intake/<token>` on Pocket's own address. If an identity proxy such as Cloudflare Access sits in front of Pocket, it must let `/intake/` through, as it does `/share/`; otherwise the person is asked to sign in.

### See, copy or edit a value

Tap a secret to open its sheet. Each field shows as dots; **Show** fetches that one field from the server and **Copy** copies it. A shown value is hidden again when the sheet closes or the app goes to the background. Every Show is recorded in the item's history.

**Edit** changes the name, values, custom fields, website, tags, notes and expiry. Value boxes start empty ("Unchanged"), and a box left empty keeps its value. **Show** on a saved field loads its current value into the box (recorded as a view) so you can correct it. To drop a custom field, use **Remove** beside it; fixed fields cannot be removed.

### Remove and restore

**Remove** moves a secret to **Removed**, where it stays for 30 days and is then deleted for good. **Restore** brings it back. A removed name cannot be reused until it is deleted. Agents cannot use a removed secret.

### Choose how freely agents use secrets

**Settings → Features → Vault → Agent access** sets the default for every secret:

| Agent access | Behavior |
|---|---|
| **Free rein** | Agents use any secret by name without asking. Every use is still recorded. Any agent on the server can obtain the value, so keep this for low-value keys. |
| **Ask once per command** (default) | A command you approved before with **Always allow** runs at once; a new command needs your approval. |
| **Ask every time** | Every use needs your approval. **Always allow** is not offered. |

Each secret can override the default with **Change who can use it** on its sheet (or **Who can use it** in the editor): **Vault default**, **Free rein**, **Ask once per command**, **Ask every time** or **Only you**. **Only you** means agents cannot use it at all.

### Answer a request

When a command needs your approval, Pocket files a **request** and tells you three ways. Any one of them answers it:

- **Push notification.** "Allow *name*?", with which conversation wants it and the command, and **Allow** and **Deny** buttons. **Allow** on the notification allows once; it never saves the command. The notification offers **Allow** only when it shows the whole request (1.125.3). A command longer than 80 characters is cut and ends with *… Open Pocket to read the whole command.*, and a title or text too long for a notification is cut too; such a notification has only **Deny**, and you tap it to read the whole command and answer in Pocket. Tapping the notification itself does not answer: it opens the Vault at that request. If an **Allow** or **Deny** from the notification cannot be recorded (the device was signed out, the Vault was locked, the device was offline, or the request had already ended), Pocket opens the request and says why, so you can answer it there. Turn these on per device in **Settings → Notifications → Vault requests**.
- **The Vault view.** Each request is one sentence, such as *The agent in "Staging site" wants to use staging-wp for this command*, with the exact command, **Runs** and the full path of the program that will run (for `env node sync.mjs`, the `node` that `env` starts), **Variables** with each variable and the secret it gets (*`TOKEN` gets staging-wp*), the folder and when it asked. A note under it says when Pocket cannot check everything the command runs (see **What Always allow checks** below). **Allow once** is the orange button; **Deny** sits beside it, and **Always allow** between them when the secret allows it. A request that was already answered, expired or ended when the Vault locked says so when its notification is opened.
- **The conversation.** The agent ends its reply with suggested replies such as *Allow billing-api for this command* and *Deny billing-api*. Tap one or type it. Pocket also accepts *Always allow billing-api for this command*, *approve*, *don't allow*, and a bare *Allow* or *Deny* when that conversation has exactly one request waiting. Only your own messages in the conversation that raised the request count, and the message is still delivered to the agent.

A reply that [a job key started](automation.md#job-keys) asks the same way, with nobody watching: the request waits for you, and the run reads **needs you** to the script that started it ([What waits for you in a job reply](automation.md#what-waits-for-you-in-a-job-reply)).

**Always allow** saves the exact command (program, every argument and the folder) and its variables for that secret, under **Approved commands** on its sheet, where you can remove it. A changed argument is a new command and asks again, and so does the same command with a secret under another variable name, another secret for a variable, or a variable added; the request then says the variables changed and shows what you allowed before. A request expires after 15 minutes.

Some variable names cannot be given a secret at all, because a program acts on them by itself: it runs or loads the value, reads it as options, creates a file or folder named after it, or sends it to another computer. Pocket refuses them when the agent asks (*`NODE_V8_COVERAGE` cannot be bound.*); the full list is in the table under **What a run does**. Ordinary names such as `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN` and `PGPASSWORD` work as before.

#### What Always allow checks

**Always allow** also saves what the command runs, each file by its content:

- the program Pocket finds for it, and the interpreter its `#!` line names;
- the program a launcher starts: `env`, `timeout`, `nice`, `nohup`, `stdbuf`, `ionice`, `setsid`, `taskset`, `chrt`, `time`, `xargs`, `sudo`, `doas`, `flock` and `sshpass` are looked through, so `timeout 60 node sync.mjs` records `node` and `sync.mjs`;
- the script an interpreter runs (`sh deploy.sh`, `node sync.mjs`, `python3 fetch.py`), found the way the interpreter finds it: `node sync` records `sync.js` when there is no file named `sync`, and `python3 -m tool` records `tool.py`, or `tool/__main__.py` and the package's `__init__.py` files, from the folder the command runs in;
- a file given by path to `node -r`, `--require`, `--import` or `--loader`, and the makefile `make` reads;
- every argument that is an existing file, including the value of `--flag=file` and `NAME=file`;
- in code given inline (`sh -c '…'`, `bash -c`, `node -e`, `python3 -c`, `perl -e`), the words that name an existing file, such as `deploy.sh` in `sh -c 'sh deploy.sh'`.

If any of them changes, the next run asks again and the request names the file that changed (or the new program, when another one of the same name is found first); nothing runs until you answer.

The request also says what Pocket cannot check:

- **Code given inline.** Pocket matches its text and the files it names plainly, but not what that code builds or fetches at run time.
- **A file Pocket cannot read, or one over 512 MB.** Pocket checks only its size and dates. Replacing it with a file of the same size and dates is still noticed, because the change date cannot be set back, but a change made by root or with the system clock moved is not.
- **A script an agent can change.** When `node`, `python3` or another interpreter opens the script by its path, and Pocket's user can write the script or a folder above it, the request says so (see **What runs is what was checked** below).
- **A script that is not a plain file**, such as a pipe, a device or a folder (`python3 app/` runs `app/__main__.py`). There is no content to compare, so **Always allow** is not offered and every run asks.

A folder, pipe or device given as an ordinary argument is not checked at all, and the request does not list it.

**Commands that are never allowed always.** When Pocket cannot tell what a command will run, the request says why in one sentence and offers only **Allow once** and **Deny**:

- an interpreter with no script Pocket can find, such as `xargs -a list.txt sh` (the script names come from a file) or `node` alone;
- a program that runs what it finds: `find … -exec`, `node --test`;
- a program that starts another command Pocket cannot follow, such as `parallel`, `watch`, `nodemon`, `pm2`, `strace`, `su`, `tmux`, `cross-env`, or a launcher option Pocket does not know (`env -S`, also in a script's `#!` line, or `sudo -i`);
- a command on another computer: `ssh` with a command, `rsync -e` (also written `-ave./x`), `scp -S` or `-D`, `sftp -S`, `-D` or `-b`;
- scripts the project defines: `npm run`, `npm test`, `npm install` and other npm, pnpm and yarn commands that can run them (`npm whoami` and `npm view` stay allowed), `node --run`, `bun run`, `deno task`;
- packages fetched and run: `npx`, `npm exec`, `bunx`;
- containers: `docker run`, `docker compose` and other `docker` or `podman` commands that start or build one (`docker push` and `docker pull` stay allowed);
- code from an address (`deno run https://…`) and live reloading or debugging (`node --watch`, `node --inspect`).

A command like this that you allowed always before asks every time and says so.

**Files the command writes.** When the command writes a file it names (an output, a log, a state file), that file changes on every run and would ask every time. The request lists the files **Always allow** will check, each ticked; untick the ones the command writes before you tap **Always allow**. An unticked file is not checked on later runs, and a later **Always allow** of the same command keeps it unticked. Untick only files the command writes, never a script or a file whose content decides what the command does.

**What runs is what was checked.** Pocket reads every file once, checks it, and on Linux starts a native program from that very file, and runs a shell script (`sh`, `bash`, `dash`, `ash`, `ksh`, `mksh`) from a private copy of what was checked, unless the script uses its own path (`$0`, `BASH_SOURCE`) or `sudo`, `doas`, `xargs`, `flock` or `sshpass` starts it. Anything else (a script `node` or `python3` runs, a makefile, those exceptions, a setuid program) is read again just before the start; if it changed, the run stops (the history says **Run stopped: a file changed as it started**) and the agent can run it again, which asks you. After that, `node` or `python3` opens the script by its path, and an agent that can write the script or its folder and swaps it at that moment will usually succeed. The request says when that is possible. To protect a credential such a script uses, keep the script in a folder the agent's user cannot write (nor any folder above it), or answer **Allow once** each time after reading the script.

Commands you allowed always before 1.118 ask once more the next time they run, because Pocket did not record which variable gets which secret: the request says so and shows the variables. **Always allow** on that request keeps the same entry and records the variables and the content as Pocket checks them now; **Allow once** runs it without recording, so it asks again next time.

### Protect the Vault with a passphrase

By default the key in `.env` opens the Vault whenever Pocket Code runs. To require a passphrase instead:

1. **Settings → Features → Vault → Passphrase → Set a passphrase**.
2. Enter a passphrase of at least 12 characters twice.

From then on Pocket holds the passphrase-derived key in memory only, and the Vault is **locked** after a restart, after **Lock now**, and after the idle time you pick in **Lock after** (**Never**, **15 minutes**, **1 hour**, **8 hours**, **24 hours**; counted from the last time you or an agent used it). While locked, agents cannot use secrets, the rail and home chip show a lock, and the Vault view shows **Unlock**. When an agent hits a locked Vault you get one "The Vault is locked" push (at most one every ten minutes).

**Change passphrase** and **Remove passphrase** (back to the server key) are in the same place. There is no reset: a forgotten passphrase means the Vault cannot be opened, so keep the passphrase in your password manager and keep an export. Unlocking is limited to ten wrong passphrases per hour in one signed-in session (one browser's sign-in); a right one clears the count.

### Export, import, rotate and restore the key

All of these are under **Settings → Features → Vault**:

- **Export…** downloads every secret, values included, as one `.pvault` file encrypted under a passphrase you type for it (at least 12 characters). Removed secrets and last-used details are left out.
- **Import…** reads a `.pvault` file into this or another Pocket Code. Secrets whose names are new are added; names already here are listed and left alone.
- **Download recovery key** shows the current key again (recorded in the history). Only in server-key mode.
- **Rotate key** re-encrypts the Vault under a new key, saves it to `.env` and shows the new recovery key. No restart is needed. Backups made before the rotation still need the old key. Only in server-key mode. While a rotation runs, `.env` briefly also holds the old key as `POCKET_VAULT_KEY_PREVIOUS`; if Pocket stops part-way, the next start puts `.env` back on the key the store is written under, so your recovery key still works.
- **Restore key…** appears when a `vault.enc` exists but its key is missing. Paste the recovery key or open the downloaded file; Pocket checks that it opens the Vault and saves it to `.env`.

### Catch secrets typed into messages

**Settings → Features → Vault → Catch secrets in messages** (on by default, for the whole install) holds a message that looks like it contains a secret:

- **On paste or drop** into a message box: Pocket holds the text and offers **Store in the Vault** (saves it under a suggested name and pastes `{{vault:name}}` instead), **Paste as is** or **Cancel**.
- **On send**: the same check runs, with **Store and send**, **Send as is** and **Edit**. The server runs the check too, for new conversations, messages, side chats and branches, and refuses an unchecked message that carries a secret.

It recognizes OpenAI, Anthropic, OpenRouter, GitHub, GitLab, AWS access key IDs, Stripe, Slack, Google API, Twilio and SendGrid key formats, signed JWTs, private keys, a password inside a URL, card numbers that pass the checksum and carry a card issuer's prefix, and text like `password: …` or `api_key = …` whose value has a digit or symbol. A paste of a single long random-looking token is also caught. The sheet names what it found and its length, never its characters. If the Vault is off or locked, the sheet says so and offers only the send-or-cancel choices. Detection is a backstop: storing a secret with **Store in the Vault** first is the reliable way.

## How it works

### Where data lives

| File | Contents |
|---|---|
| `POCKET_DATA_DIR/vault.enc` | Every secret, its policy and approved commands, encrypted as one AES-256-GCM blob. Nothing is readable without the key. Written with a sync before and after the rename. |
| `POCKET_DATA_DIR/vault-audit.jsonl` | The history: one line per event, mode `0600`, append-only. Never holds a value. |
| `.env` in the Pocket Code directory | `POCKET_VAULT_KEY` in server-key mode. |
| `POCKET_DATA_DIR/pocket-settings.json` | Vault on or off, Agent access, Lock after, Catch secrets in messages. |

`POCKET_DATA_DIR` defaults to the Pocket Code directory. Back up `vault.enc` and `vault-audit.jsonl` with the data directory and keep the recovery key somewhere else. Pending requests live in memory only: a restart drops them, and the agent is told the request no longer exists.

The daemon reads `POCKET_VAULT_KEY` at start and removes it from its own environment, so no agent, hook or command it starts can inherit it. A key set in the daemon's process environment (a PM2 ecosystem file or systemd unit) instead of `.env` cannot be rotated from Settings; move it into `.env` first.

### What a run does

When an agent runs `pocket-vault run --env TOKEN=billing-api -- node sync.mjs`:

1. Pocket resolves each binding to a secret and field, and checks the policy. If approval is needed it files a request and waits up to 90 seconds (`--wait`, at most 300).
2. Pocket finds the program on its own `PATH` (`POCKET_VAULT_PATH`, or the `PATH` Pocket started with; empty and relative entries are dropped, so the agent's folder is never searched), checks the program and the files the command names against an approved command (see **What Always allow checks** above), and starts what it checked (see **What runs is what was checked**), in the given folder, with the values set as environment variables. The command gets the daemon's environment (minus Pocket's own secrets) with that `PATH`, plus the bound variables, not the agent's shell environment. It has no terminal and no standard input.
3. Output streams back with every value replaced by `{{vault:name}}`, including its base64, base64url, URL-encoded, JSON-escaped, hex and reversed forms, and the value inside longer base64 text such as an HTTP Basic login header (values of 6 characters or more). Values shorter than 4 characters are not scrubbed. Scrubbing catches accidents; a command written to reveal a value can always spell it some other way, which is why what may run is decided by your approval, not by the scrubber.
4. The run is recorded in the history before any value is released. If the record cannot be written, nothing is released.

| Limit | Value |
|---|---|
| Output per run | 1 MB, then the command is stopped |
| Run time | 600 seconds by default, `--timeout` up to 3600 |
| Runs at once | 8 |
| Variables per run | 32. These names cannot be bound: `POCKET_*`, `PATH`, `HOME`, `LD_*`, `DYLD_*`, `NODE_*` (except `NODE_AUTH_TOKEN`), `NPM_CONFIG_*`, `PYTHON*`, `PERL*`, `RUBY*`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`, `BASH_ENV`, `ENV`, `IFS`, `PS0`–`PS9`, `PROMPT_COMMAND`, `SHELLOPTS`, `BASHOPTS`, `ZDOTDIR`, `SHELL`, `GIT_*` (except `GIT_TOKEN`, `GIT_PASSWORD`, `GIT_USERNAME`, `GIT_CREDENTIALS`, `GIT_AUTH_TOKEN`), `PAGER`, `MANPAGER`, `EDITOR`, `VISUAL`, `BROWSER`, `LESS*`, `SSH_ASKPASS`, `SUDO_ASKPASS`, `MAKEFLAGS`, `MFLAGS`, `MAKEFILES`, `TMPDIR`, `TMP`, `TEMP`, `TEMPDIR`, `XDG_*`, `SSLKEYLOGFILE`, `HISTFILE`, `GNUPGHOME`, `DOCKER_CONFIG`, `LANG`, `LANGUAGE`, `LC_*`, `TZ` |
| Secrets | 500 |
| Value size | 64 KB per field |
| Notes | 2,000 characters |
| Tags | 20 per secret |
| Approved commands | 50 per secret; the oldest is dropped |
| Request lifetime | 15 minutes to answer; an answer stays good for 15 minutes after it is given |

The command leads its own process group. When it exits, times out or exceeds the output cap, everything it started is stopped too, so a run cannot leave a background process behind.

### Browser logins

An agent driving a browser through the Playwright MCP tools can type a stored value into a page by writing `{{vault:name.field}}` as the text to type. Pocket's relay (`scripts/pocket-mcp-proxy.mjs`) asks the Vault for the value under the same Agent access rules and approval flow, types it into the tool call on its way to the browser, and replaces it with the placeholder in everything the browser tool sends back. The request shows in the Vault as *… wants to fill name into a web page, and will be able to read what is filled*: the agent drives that page, so it can read the value back once it is typed. Allow a fill as you would hand that login to the agent.

Set it up once by registering the browser tool through the relay, for example for Claude Code:

```bash
claude mcp add playwright -s user -- node <Pocket Code directory>/scripts/pocket-mcp-proxy.mjs \
  --name playwright -- npx -y @playwright/mcp --headless --no-sandbox
```

Rules the relay enforces:

- Values go only into the fill tools: `browser_type`, `browser_fill_form`, `type` and `fill`, or the comma-separated list in `POCKET_VAULT_FILL_TOOLS`. A call to any other tool that names a placeholder (`browser_evaluate`, `browser_navigate`) is refused.
- **Screenshot lockout.** Once a value has been typed, images, audio and other binary content from that browser are replaced with a note for the rest of the relay's life, because a value cannot be scrubbed out of a picture. Calls that make a picture (`browser_take_screenshot`, `browser_pdf_save`, `screenshot`, or a tool named in `POCKET_VAULT_PICTURE_TOOLS`) are refused and never reach the browser, since the browser tool saves each picture to a file the agent could open. So are the calls that can capture the page another way (1.124.5): `browser_run_code_unsafe`, which can take a screenshot or hand back the page as an image in text form, video (`browser_start_video`, `browser_stop_video`), tracing (`browser_start_tracing`, `browser_stop_tracing`) and `browser_annotate`. Text snapshots and `browser_evaluate` still work; the text they send back is scrubbed. So that no page text lands in a file the relay cannot scrub either, any call that names a `filename` (a snapshot, an evaluate result, console or network logs saved to a file) is refused too (1.124.3). Reading the browser's cookies and site storage is refused as well (1.124.8): `browser_storage_state`, `browser_cookie_list`, `browser_cookie_get`, `browser_localstorage_list`, `browser_localstorage_get`, `browser_sessionstorage_list`, `browser_sessionstorage_get`, and any tool named in `POCKET_VAULT_STORAGE_TOOLS`. They never hold the typed value, but after a login they hold the session it opened, and a session cookie signs anyone in. Setting or clearing storage still works.
- **Pictures wait for a fill.** The browser tool runs calls side by side, so a picture taken while a value is being typed could hold it (1.124.4). A picture or `filename` call sent while a fill is waiting, including while it waits for your approval, waits for that fill: it is refused if the value was typed and runs if it was not. A fill waits for any picture or `filename` call sent before it that is still running, up to `POCKET_VAULT_PICTURE_WAIT` seconds (default 30); if one is still running then, the fill is refused, nothing is typed, and the agent is told to call again. Other calls do not wait.
- A fill waits `POCKET_VAULT_FILL_WAIT` seconds (default 90) for your approval, then tells the agent to call the tool again once you allow it.

The page the agent is driving can read what was typed into it. Allow fills only on sites you trust with that login.

### The history

Each secret's sheet shows its last 20 events under **History**. The file records: stored, changed (naming the fields, never values), removed, restored, every run and browser fill, every request and how you answered it, every Show, and key and passphrase events (key created, rotated, restored, recovery key viewed, passphrase set or removed, lock, unlock, failed unlock, export, import). Each row names the conversation and the command.

### Settings and environment variables

| Name | Where | Effect |
|---|---|---|
| **Vault** | Settings → Features (the switch) | On or off for the install. Off by default. |
| **Agent access** | Settings → Features → Vault | Free rein, Ask once per command (default), Ask every time. |
| **Default order** | Settings → Features → Vault | The order the list opens in, on every device (`vaultOrder`: `new`, `name`, `who`, `used`, `kind` or `expiry`; default `new`). Picking an order in the list changes it too. |
| **Lock after** | Same, under Passphrase (passphrase mode only) | Never (default), 15 minutes, 1 hour, 8 hours, 24 hours. |
| **Catch secrets in messages** | Same | On by default. Works even while the Vault is off. |
| **Vault requests** | Settings → Notifications | Whether this device gets request pushes. The *Allow a job key?* push ([Automation](automation.md#let-a-conversation-set-one-up)) follows it too. |
| `POCKET_VAULT_KEY` | `.env` | The server key. Pocket writes it; set it by hand only when there is no `.env` to write. |
| `POCKET_VAULT_FILL_TOOLS` | Relay's environment | Tools the relay may type a value into. |
| `POCKET_VAULT_PICTURE_TOOLS` | Relay's environment | More tools that make a picture, refused once a value has been typed, on top of `browser_take_screenshot`, `browser_pdf_save`, `screenshot` and the capture tools listed under **Screenshot lockout**. |
| `POCKET_VAULT_FILL_WAIT` | Relay's environment | Seconds a fill waits for approval. Default 90. |
| `POCKET_VAULT_STORAGE_TOOLS` | Relay's environment | More tools that read cookies or site storage, refused once a value has been typed, on top of the seven listed under **Screenshot lockout** (1.124.8). It never removes one. |
| `POCKET_VAULT_PICTURE_WAIT` | Relay's environment | Seconds a fill waits for a picture or `filename` call sent before it to finish before it is refused. Default 30. |
| `POCKET_VAULT_PATH` | `.env` | The `PATH` Vault runs are found and started with. Default: the `PATH` Pocket started with. Absolute folders only. See **Choose the Vault's PATH** below. |

### Choose the Vault's PATH

A program an approved command names directly is checked by content. A program a script starts by name (`curl` inside `deploy.sh`) is not: it is looked up on the Vault's `PATH` when the script runs. If an agent can write to a folder on that `PATH`, it can put its own `curl` there, and an approved script will run it with the secret. So when the Vault is on, Pocket checks each folder on its `PATH` at start and logs one warning for each folder this user can write to, or could create or replace through a writable folder above it:

```
vault: warning: the Vault's PATH folder /home/you/.local/bin can be written by this user; an agent could put a program there that an approved command starts. Set POCKET_VAULT_PATH to folders this user cannot change (docs/manual/vault.md, Choose the Vault's PATH).
```

To clear it, set `POCKET_VAULT_PATH` in `.env` to folders this user cannot change, then restart Pocket Code:

```
POCKET_VAULT_PATH=/usr/local/bin:/usr/bin:/bin
```

If a command needs a program from a folder you own (a Node install under your home folder, say), give the command its full path instead (`pocket-vault run … -- /home/you/.nvm/versions/node/v22/bin/node sync.mjs`), or install the program somewhere this user cannot write.

### Security model and limits

In normal use the Vault keeps secrets out of prompts, transcripts, memory, backups and the model provider, gives you a say over which command or form gets a value, and makes every use visible. It is not process isolation, and it is not a wall against an agent that sets out to get a value:

- An item on **Free rein** can be obtained by any agent on the server: the agent chooses the command that receives the value, and that command can hand it on in any form.
- A value filled into a browser can be read back by the agent that asked for the fill, since that agent drives the page.
- A command you approve receives the real value and can do anything with it: print it encoded, write it to a file, send it elsewhere.
- So use **Free rein** only for low-value keys, and give high-value secrets **Ask once per command**, **Ask every time** or **Only you**, and read what you approve.

Also:

- Agents run as the same operating-system user as Pocket. An agent that goes looking can read `.env` and the store.
- A command run with a secret runs with the daemon's permissions, outside any sandbox the agent's CLI applies, and can do whatever the credential allows. Scrubbing cannot stop a command that writes a value to a file, spells it in a way the scrubber does not know, or sends it somewhere.
- **Always allow** trusts the program, the files named on the command line and the variables as they were when you allowed it. It does not see files a script reads, sources or includes itself (`. ./lib.sh`, `source .env`, `require('./lib')`), modules and libraries an interpreter loads (including a preload named by package, such as `node -r dotenv/config`, a module `python3 -m` finds outside the command's folder, and the compiled copies Python keeps in `__pycache__`), programs a script starts by name, a program's own configuration and hooks (git hooks, `.npmrc`, `~/.ssh/config`), what a command installs or builds and then runs (`pip install`, `cargo run`), the imports of a script run by a program Pocket does not know as an interpreter (`tsx`, `ts-node`), what is inside a folder passed as an argument, or a file you unticked as one the command writes. An agent that can change any of those can change what an approved command does without a new request. Allow always only commands whose whole behaviour sits in the files they name, kept where the agent cannot write, or use **Ask every time** for that secret. A script that `node`, `python3` or a similar interpreter opens by its path can be swapped at the start by an agent that can write it or its folder, and that usually succeeds; a process of the same user can also change a running command through `/proc`. The check stops a tricked agent from quietly changing what an approved command runs; it is not a wall against an agent that sets out to get a value.
- Under **Free rein**, any command can use a secret without your approval; only the record of use shows it. Under Full access the Vault's request is the only check on a run, which is why asking is the default. Under Review actions you also approve the agent's `pocket-vault run` call itself.
- A call from inside a conversation carries that conversation's identity (Claude Code, Codex and OpenRouter), so its requests name the conversation and you can answer them there.
- Calls from a terminal or code-server on the server carry no session identity. They follow the same rules, are recorded as "from a terminal", and share one identity, so any such process can continue a request another terminal process raised.

In the browser, Vault responses are never cached, changes are refused unless they come from Pocket's own origin, and a value is fetched one field at a time and never stored. See [SECURITY.md](../../SECURITY.md#vault) for the full model.

## For agents

Use the [pocket-vault skill](../../skills/pocket-vault/SKILL.md); Pocket installs it while the Vault is on, and the instructions Pocket gives each conversation name the exact command path. Run the CLI as `node <Pocket Code directory>/scripts/pocket-vault.mjs` (or `npx pocket-vault` from the Pocket Code directory).

**The rule:** never look at, print, echo, log, decode or write a value, never put one in a command's arguments, and never ask the user to paste a secret into the chat. Point them to **Store in the Vault** instead.

```text
pocket-vault list [--kind k] [--tag t] [--json]       names, kinds, fields, policy, url, tags, expiry; never values
pocket-vault show <name> [--json]                     one secret's fields, how to bind it, last use, approved commands
pocket-vault run --env VAR=<name>[.field] [--env …] [--cwd <dir>] [--timeout <s>] [--wait <s>] -- <command…>
pocket-vault wait <request-id> [--wait <s>]           continue a run the owner was asked to allow
pocket-vault put <name> --kind <api_key|token|login|credentials|note> (--stdin | --from-file <path> [--map field=key,…] | --from-env VAR) [--url u] [--tags a,b]
pocket-vault history [--name <name>] [--json]         this session's uses of the Vault
pocket-vault request <name> --kind <login|api_key|token|credentials|note> --for "<who>" [--note "<what it is>"] [--fields a,b] [--expires 72h|3d]
pocket-vault requests [--json]                        intake links waiting, and the ones that ended this week
pocket-vault await <name> [--wait <s>]                wait until the link is filled in (0), still waiting (4), cancelled or expired (5)
pocket-vault relink <name> | cancel <name>            a new link for a waiting request, or cancel it
```

`relink` and `cancel` work only on a link the CLI made, and from a conversation only on that conversation's own link; a link the owner made is the owner's (1.124.3, exit 5).

| Exit code | Meaning | What to do |
|---|---|---|
| child's code | The command ran | Read the scrubbed output. |
| 3 | The Vault is off, locked, or cannot be opened | Tell the user in one line. Off: it is turned on in Settings → Features → Vault. Locked: they unlock it in the Vault view (they were already notified). Never ask for the passphrase. |
| 4 | A request is waiting (`pending <id>`) | Say so in one line, end the reply offering `Allow <name> for this command` and `Deny <name>` as choices, then run `pocket-vault wait <id>`. If it prints `pending` again, do not loop. |
| 5 | Denied, expired, an **Only you** secret, or no such name | Say so and stop. Do not look for another way to the value. |
| 1 | Any other error (bad binding, unreachable server) | Read the message. |

Write commands so the child reads the variable itself. For a shell expansion, single-quote the script so your own shell does not expand it:

```bash
pocket-vault run --env TOKEN=billing-api -- sh -c 'curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/invoices'
pocket-vault run --env PORTAL_USER=vendor-portal.username --env PORTAL_PASS=vendor-portal.password -- python3 fetch.py
```

Keep commands stable: an approved command is an exact match on program, arguments and folder, and on the content of the program, its `#!` interpreter, the program a launcher such as `env` or `timeout` starts, and every file named in the arguments or plainly in inline code. Editing an approved script, or putting another program of the same name on Pocket's `PATH`, sends the next run back to the owner, and the request names what changed. Prefer a script file to inline code (`sh deploy.sh` over `sh -c '…'`): the owner is told inline code cannot be fully checked. If the command writes a file it names, say so when you ask, so the owner can untick it. `--cwd` defaults to your current directory.

**Storing a secret you meet.** When a secret appears in a message, file or tool result, store it at once with `put` (the value from `--stdin`, `--from-file` or `--from-env`, never the command line), use its name from then on, and tell the user in one or two sentences that it was seen in the conversation and may need rotating. Write the name as a Markdown link to `/#/vault/item/<name>` so it opens the secret; the conversation also shows a card for it. `put` is create-only: an existing name (including a removed one) is refused, and agents cannot change, rotate or remove a secret. A new secret follows the Vault default policy.

**Asking someone outside (1.110).** When a customer or vendor has a credential the work needs, never ask them to send it by email, chat or phone. Run `pocket-vault request <name> --kind login --for "<who>" --note "<what it is>"`, which prints a one-time link, and give the link to the owner or put it in the draft for them to send. `await <name>` or `show <name>` tells you when it has been filled in; you only ever see the name.

**Browser fills.** Put `{{vault:name.field}}` as the text in `browser_type` or `browser_fill_form`. If the reply says the Vault is asking the owner, tell them and call the same tool with the same arguments once they allow it. After a fill, use `browser_snapshot` instead of screenshots, without `filename`, and don't read cookies or storage. If the placeholder appears literally on the page, the relay is not in place: stop and tell the owner.

**Codex in Review mode** runs in a read-only sandbox that cannot reach Pocket's server, so `pocket-vault` fails there; the reply needs Full access.

**When to act and when to ask:** use a secret whenever the task needs it; store one the moment you see it; ask the owner only to add a missing secret, change a policy, or answer a request. `list` answers "what credentials do we have".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The **Vault** switch is greyed out with "This Vault's key is missing on this server" | `vault.enc` exists but `POCKET_VAULT_KEY` is gone (lost `.env`, rebuilt server) | **Restore key…** with the recovery key. Pocket never creates a new key over an existing store. |
| The Vault view says "The Vault cannot be opened" | The key in `.env` is not the one the store was saved with | Put the right key back (or use **Restore key…**) and restart Pocket Code. |
| Turning the Vault on fails with a message about `POCKET_VAULT_KEY` set in the daemon's environment | The key comes from the process environment and does not open the store | Fix or remove the key in the PM2 or systemd configuration and restart. |
| **Rotate key** answers that the key is set in the daemon's environment | Rotation can only write `.env` | Move the key into `.env`, remove it from the environment, restart, then rotate. |
| **Remove passphrase** fails: "POCKET_VAULT_KEY is not set" | Passphrase mode with no server key | Add `POCKET_VAULT_KEY` to `.env`, restart, unlock, then remove the passphrase. |
| Unlock says "Too many tries. Wait an hour." | Ten wrong passphrases or **Restore key** keys in this signed-in session within an hour of the first, or 50 across all sessions | Wait, then try again. A right passphrase or key clears the count. |
| Turning the Vault on fails: "This install has no .env file to keep the Vault key in" | `POCKET_ENV_FILE` is set to empty, so Pocket has nowhere to save a key | Set `POCKET_VAULT_KEY` yourself (`openssl rand -base64 32`) and restart. |
| Tapping **Allow** on a notification opens the Vault with "Your Allow from the notification didn't go through" | The answer could not be recorded; the line says why (signed out, locked, offline, or the request had ended) | Answer the request on that card. Sign in again on the device if it says signed out. |
| An agent's run answers `pending` and nothing arrives on the phone | Push is off on that device, or **Vault requests** is off for it | Answer in the Vault view or the conversation; turn on push in **Settings → Notifications**. |
| `pocket-vault wait` says the request does not exist or has expired | More than 15 minutes passed, or Pocket restarted | Run the command again to file a new request. |
| "That request was raised by another session" or "already used" | A request belongs to one conversation and serves one continuation | Run the command again from the conversation that needs it. |
| "… changed since the owner was asked; ask again" | The secret, a field or a policy changed after the approval, or the file the message names changed between the request and the run | Run the command again. |
| "… changed just before the command started; nothing ran" (history: **Run stopped**) | The file it names changed in the moment before the start | Check that file, then run the command again. |
| A command you allowed always asks again, naming a file that changed | The script, a file named in its arguments, its interpreter, the program a launcher starts, or the program found on Pocket's `PATH` is different from when you allowed it | Check what changed, then answer. **Always allow** records the new content. |
| A command you allowed always asks on every run | It names a file it writes itself (an output, a log), so that file is different each time | On the next request, untick that file before **Always allow**. |
| A command you allowed always asks again, saying its variables changed | The agent gave a secret under another variable name, another secret for a variable, or an extra variable | Check the **Variables** line against what you allowed before, then answer. |
| A request has no **Always allow** and a note ending "Always allow is not offered" | Pocket cannot tell what that command will run (`npm run`, `npx`, `docker run`, `find -exec`, `ssh` with a command, …) | Answer **Allow once** or **Deny**. To allow it always, have the agent run the script or program directly. |
| "… cannot be bound." | The variable name is one a program acts on by itself (see the limits table) | Have the agent use another name, such as `API_TOKEN`. |
| The log says "vault: warning: the Vault's PATH folder … can be written by this user" (or "can be replaced", "can create it") | A folder on the Vault's `PATH` can be changed by the user Pocket runs as | Set `POCKET_VAULT_PATH` (see **Choose the Vault's PATH**) and restart. |
| "… was not found on the Vault's PATH" | The program is not in any folder on `POCKET_VAULT_PATH` (or Pocket's own `PATH`) | Give the program's full path, or add its folder to `POCKET_VAULT_PATH` and restart. |
| "Too many vault runs at once" | Eight runs are in progress | Try again in a moment. |
| Output ends with `[output truncated at 1 MB]` or `[the command was stopped at the timeout]` | The run hit a limit | Reduce output, or pass `--timeout`. |
| A background service a command started stops when the run ends | Runs stop everything they started | Start long-lived services another way. |
| `{{vault:name}}` appears literally in a web page | The browser tool is not registered through `pocket-mcp-proxy.mjs` | Re-register it through the relay. |
| Screenshots come back as "Removed by Pocket…" | A value was typed in that browser session | Use text snapshots, or restart the browser tool. |
| `pocket-vault history` from a terminal shows nothing | Terminal calls have no session, and history shows only the calling session's rows | Open the secret's **History** in the Vault view. |
| Codex conversations ignore the Vault's rules; Settings warns about `developer_instructions` | Codex's `config.toml` sets its own `developer_instructions`, which keep Pocket's lines out | Remove that setting, or rely on the installed `pocket-vault` skill. |
