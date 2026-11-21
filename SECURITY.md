# Security

## Reporting a vulnerability

Please report security problems privately via GitHub: **Security → Report a
vulnerability** on this repository. Don't open a public issue. You'll get an
acknowledgment, and a fix or an explanation, as soon as it can be looked at.

## Security model

Pocket Code runs AI coding agents on your server as the user the service runs as. New
turns default to **Review actions**: Claude asks before commands, edits, delegated tasks
and external tools (an `ask` rule, which wins over any `allow` rule in your CLI settings,
verified on Claude Code 2.1.281), and Codex runs in a read-only sandbox with an untrusted
approval policy. **Full access** (`--permission-mode bypassPermissions`, Codex
`danger-full-access`) is a per-turn choice the owner can make, or disallow for the
instance with `POCKET_ALLOW_FULL_ACCESS=0`. Either way, anyone who can sign in can run
commands on the box: an approved command has whatever effects it has, and the agent
has the OS user's credentials. Treat the password like an SSH key.

Built in:
- The server listens on `127.0.0.1` only. Expose it through an HTTPS tunnel or reverse proxy.
- Constant-time password comparison, and a limit of 20 wrong passwords per hour per address (a correct one does not count).
  Since 1.89 the address is the caller's `cf-connecting-ip` only when Pocket can trust it: the
  request carries a Cloudflare Access token that verifies for this application (One sign-in is
  set up), or `POCKET_TRUSTED_PROXY=1` says the port is reachable only through a proxy that sets
  the header itself. Otherwise it is the connection's own address, so a caller that types a new
  header on each try no longer gets a fresh count. The trade-off: through a tunnel with neither,
  every caller arrives from the tunnel's `127.0.0.1` and shares one count, so a stranger who
  uses up the 20 tries locks the owner's password page for the hour too (a signed-in browser
  is not affected). Set `POCKET_TRUSTED_PROXY=1` only when nothing but that proxy can reach the
  port: with it, anything that reaches the port directly can again choose its own address.
  Since 1.117 an IPv6 address is counted by its /64 (one home or server network), so stepping
  through addresses in one block no longer buys fresh tries. The instance also keeps one budget
  across all addresses: after 30 wrong passwords in an hour, sign-ins are checked one at a time,
  1 second apart, the gap doubling every 20 more failures up to 10 seconds, and a try that would
  wait more than 20 seconds is told to try again later without being checked. A flood from many
  addresses therefore slows to a crawl instead of guessing in parallel. A browser that has signed
  in before skips that queue: each sign-in sets a "known device" cookie (`pc_device`; `HttpOnly`,
  `SameSite=Lax`, `Secure` over HTTPS, sent only to `/api/login`, one year), signed with the
  server secret, the sign-in generation and a keyed hash of the password. It does not sign
  anything in by itself, it still counts against its address's 20 tries, and one that carries
  five wrong passwords in an hour stops skipping the queue. So the owner can sign in during a
  flood on any browser used before; a browser that never signed in can be turned away while the
  flood lasts (a signed-in browser is not affected). Sign out everywhere or a new
  `POCKET_PASSWORD` ends every known-device cookie.
- An HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie with a 90-day expiry.
  Since 1.117, Settings has **Sign out** (this browser) and **Sign out everywhere**. Sign out
  everywhere, and a change of `POCKET_PASSWORD` noticed at the next start, move the instance to a
  new sign-in generation (kept in `auth-state.json` in the data directory, mode `0600`, holding a
  keyed hash of the password, never the password), and every cookie from an earlier generation
  stops working. A start that finds no usable `auth-state.json` in a data folder a daemon has
  used before (the first start after upgrading to 1.117, or a deleted, unreadable or corrupt
  file) begins a new generation: every browser signs in once after the upgrade, a password
  changed in the same restart ends the old cookies, and deleting the file signs everyone out
  rather than reviving an old cookie. "Used before" is read from the files every start leaves
  in the data folder (`cli-token`, `cli-url`, `auth-state.json`); a folder with none of them is
  a new install, which starts with the pre-1.117 cookie form until the first Sign out
  everywhere. The limits: a data folder restored from a backup that holds an older
  `auth-state.json` brings that generation back, and the cookies it signed work again until they
  expire; removing all three files makes the folder look new, so cookies in the pre-1.117 form
  (from before the upgrade, at most 90 days old) work again. Choose Sign out everywhere after a
  restore. Anyone who can change the data folder runs as the service's user and can read
  `POCKET_SECRET` and make a cookie anyway, so these limits give such a caller nothing new. Two
  daemons sharing one data folder do not see each other's Sign out everywhere until they
  restart (sharing a folder is not supported). Sign out also removes that browser's
  push subscription, and Sign out everywhere removes every one, so a lost phone stops receiving
  notification text; the owner turns notifications on again on the devices that stay. With
  Cloudflare Access and One sign-in in front, a signed-out browser is signed in again by Access
  without the password; to end those sessions too, revoke them in Cloudflare.
- `Strict-Transport-Security: max-age=31536000` on responses to requests that reached the
  tunnel or proxy over HTTPS (`X-Forwarded-Proto` or Cloudflare's `CF-Visitor`), since 1.117.
- `/api/health` tells a caller that is neither signed in nor a direct loopback connection only
  `{"ok":true}` (since 1.117); the running counts and uptime are for the owner and the box itself.
- **A reverse proxy must send `X-Forwarded-For`** (and `X-Forwarded-Proto`). Pocket tells a request
  made on the box from one that came through a proxy by the proxy's headers: `X-Forwarded-For`,
  `Forwarded`, `X-Real-IP` or Cloudflare's `CF-Connecting-IP`. A proxy that sends none of them,
  such as nginx's `proxy_pass` on its own, makes every caller look local: strangers get the
  `/api/health` detail, every caller shares the intake links' per-address limits, and without
  `X-Forwarded-Proto` HSTS is not sent. Cloudflare Tunnel, Caddy and Tailscale Serve send
  `X-Forwarded-For` themselves; nginx needs the two `proxy_set_header` lines in
  `docs/install.md`.
- Uploads are written mode `0600` in folders that are `0700` (since 1.117), whatever the umask.
- A Content-Security-Policy on every response: same-origin scripts, styles and
  connections only, no remote images (so Markdown written by an agent cannot load an
  image from, and leak text to, an outside host), and `frame-ancestors 'self'` plus
  whatever `POCKET_FRAME_ANCESTORS` names, so no other page can frame the approval UI.
- Unknown or malformed native permission requests are denied; a request the daemon
  cannot preview in full is never approvable.
- The daemon's own secrets (`POCKET_PASSWORD`, `POCKET_SECRET`, `VAPID_PRIVATE`) are
  removed from the environment of every agent process. `POCKET_VAULT_KEY` (1.39) is
  removed from the daemon's own environment at start, so nothing it starts inherits it.
  That keeps them out of prompts and logs; it is not isolation, since the agent runs as
  the same user and can read `.env` if it goes looking.

Recommended:
- A long random `POCKET_PASSWORD` and `POCKET_SECRET`, and a `.env` with mode `600`.
- An identity layer in front (for example Cloudflare Access) for a second factor.
- Running as a user whose access you're comfortable handing to an agent.

Changing `POCKET_SECRET` or `POCKET_PASSWORD` signs everyone out (the password since 1.117).

## Pause all and Automation (1.117)

**Pause all** stops every running reply and holds everything Pocket starts without the owner. Its limits
(**Settings → Automation**) hold unattended work back from using up a plan.

- **Owner only.** `GET` and `POST /api/pause`, `POST /api/resume`, `GET /api/automation` and
  `POST /api/automation/settings` take the owner's sign-in only (the session cookie, or the one sign-in
  through Cloudflare Access). The CLI token is refused (401), so no agent or script on the host can lift a
  pause or raise its own limits. The three `POST` routes also need a JSON body and refuse a cross-site
  request, even with a valid cookie. Settings are checked on the server and saved all or nothing.
- **Blocked means blocked.** With own messages set to **Blocked until you resume**, every owner send waits
  while paused: a message, a branch, a side chat, and a message held for background jobs on the earlier
  Claude login.
- **Agents can't change the limits, and an agent running as the same OS user could edit
  `pocket-settings.json` by hand.** As with the CLI token and `.env`, the boundary is the routes, not the file:
  an agent with write access to the data directory can already do far more. Keep the data directory
  private, as above.
- **The audit file holds no message text.** `automation-audit.jsonl` (created with mode `0600`, append-only)
  records pauses, resumes, settings changes, limit notices and each finished unattended reply: its origin,
  engine, model, duration, cost or tokens and outcome. A conversation's text, an Inbox entry and a note
  never go in it.
- **Pause is not a sandbox.** It stops the replies Pocket owns, side chats, and the background jobs of Claude
  conversations it runs (unless the owner turned that off), and it stops any reply an agent starts by itself
  while paused. It doesn't stop Codex's background terminals or anything else an agent started outside
  Pocket's processes, and it doesn't revoke approvals or credentials.
- **Origins are set by the server.** Who started a reply (the owner, the queue, a retry, a coordination wake)
  is decided inside Pocket and never read from a request body, so a message can't claim to be the owner's.

## Projects, Files, Tasks and the Vault

These libraries are off until the owner switches them on in Settings. Turning one on adds
the following.

**File visibility.** Each file in Files is one of three kinds, and new files are private.
- *Private*: opened only behind Pocket's login.
- *Link*: opened at `/share/<token>` by anyone who has the address. The token is
  unguessable and the link can carry an expiry. Since 1.117 only a hash of the token is
  kept: the address is handed out once, in the answer that made it, and neither the
  library nor `documents.json` can show it again. A lost address is replaced with a new
  link, which stops the old one. A `documents.json` written before 1.117 also held each
  address in plain text; the first start of 1.117 removes those (keeping each hash, or making
  it from the address when it was missing) and writes the file back, so links already handed
  out keep working. Copies of the old file in backups still hold the addresses: revoke or
  replace a link if a backup may have been read.
- *Public*: opened at `/files/<name>` by anyone, with no token.

Link and public files are served **without a login**. Switch Files off and both stop
answering. Responses are `no-store`, `noindex`, and not framable by other sites. An HTML
file is served with a `sandbox` Content-Security-Policy and opens in a sandboxed frame, so
its own scripts can run but it cannot read Pocket's cookie, storage or API. The policy does not
restrict the page's own network requests, so treat a shared HTML file as published
content. Share only what you would be comfortable sending as an email attachment, and make
a file private again when you are done.

**Identity proxy in front.** If you put Cloudflare Access or a similar layer in front of
Pocket, check how it treats `/share/`, `/files/` and `/intake/`. Pocket serves those paths without a
login, so an outside viewer can open a link or public file only if the proxy lets those
paths through to Pocket; otherwise the proxy will ask them to sign in first. Private files
and the rest of the app stay behind Pocket's own login whatever the proxy allows, since
Pocket checks its cookie itself. Test a link in a private window before you send it.
Since 1.76.3 a public, shared or signed-in file is sent only when the stored copy is a regular
file inside the library reached through no link; a stored copy replaced by a symlink answers 404.
Since 1.89 that check is made on the file as opened (no link followed at the last step, the
real path of the open file inside the library), and the send, and the Files grid's preview
picture, read that same open file; the check used to look at the name, and the send reopened
it, so a swap in between still served the link's target. A file card in a conversation works
the same way: the file must be a regular file whose real path is in the home directory outside
any hidden folder, it is opened once, and its download, inline view and picture all come from
that open file. A file card that is itself a symlink is refused.

**Preview pictures.** Thumbnails (the Files grid and a conversation's file cards) are made by
Chrome, `pdftoppm` or ImageMagick from a private copy of the checked file, never by its name.
Since 1.89 an image's format is read from the file's first bytes and must be PNG, JPEG, GIF or
WebP; ImageMagick is told that coder (`png:`, `jpeg:`, `gif:`, `webp:`), so a `.png` holding
PostScript or SVG gets no picture instead of reaching Ghostscript or the SVG reader (which can
read other local files into the picture). A JPEG or WebP saved as `.png` is pictured as what it is. You can also restrict ImageMagick's coders in its `policy.xml`.
Since 1.117 an HTML file is pictured inside a sandboxed frame (no scripts, forms or plugins) under a
policy that allows only inline styles and `data:` images and fonts, from a folder holding nothing
else, and Chrome runs with every host name unresolvable and every network request sent to a proxy
that does not exist. A hostile page can no longer picture another local file or reach a server
from the box; the price is that a page's remote images, web fonts and scripted charts are left out
of its picture.

**CLI token.** The `pocket-board`, `pocket-docs`, `pocket-tasks`, `pocket-coord` and `pocket-vault` commands
use a bearer token that the daemon writes to `cli-token` in the data directory (mode `0600`)
and replaces at every start. It is accepted only on the Projects, Files, Tasks and Vault
routes, and only on a direct loopback connection: a request carrying a `cf-connecting-ip`,
`x-forwarded-for`, `forwarded` or `x-real-ip` header, as one arriving through a tunnel or proxy
does, is refused. It
never replaces the login cookie anywhere else. Anyone who can read that file as the
service's OS user can read and change those libraries, and so can the agents, which run
as that user. On the Vault routes the token can do what an agent may (see below), and that
includes a browser fill, which hands the value to the caller that asked for it: anything that
holds the token can obtain any value an agent could have filled. Don't put the data directory
on a shared path.

**Agents and sharing (1.117).** Text an agent reads can try to trick it, so the token cannot make a
file more exposed on its own. With the token an agent can keep files, edit their title, project and
conversation, and make a file private or its link shorter-lived. Anything that exposes a file more
(private to link or public, link to public, a new or replacement share link, a later expiry or none,
including `pocket-docs add --visibility` and `pocket-docs import`) becomes a request for the owner:
the call answers `pending <id>` and the file stays as it was. The owner gets a push and a card in
Files naming the file, its path, kind and size, and the exact change, with **Allow** and **Deny**.
The answer route accepts only the owner's cookie (or Access sign-in) from Pocket's own origin, never
the token. **Allow** first checks that the file, its name, its sharing and its content (a SHA-256 of
the file, read without following links) are what the card showed, then makes exactly that change;
otherwise it changes nothing and the request ends. **Deny**, or no answer within 15 minutes, changes
nothing. A request covers one file and one change and is answered once; the agent that raised it
collects the result once (a new link's address included), and a later change raises a new request.
There is no "always allow". Requests live in memory, so a restart drops them unanswered. This guards
the API: an agent running as the service's user can still edit `documents.json` or a published file
directly, or read `.env`, so choosing the user Pocket runs as (above) still matters. Files
dropped into the library's folder come in private, as before.

**Reminder hook.** `POCKET_REMINDER_HOOK`, if set, is run through a shell when a project
reminder or task comes due, with the item as JSON on standard input. It is a command from
the operator's own configuration, not from the browser or an agent, so keep `.env` and the
process environment writable only by the operator. Since 1.37.1 the hook gets the same
filtered environment as agent processes, without `POCKET_PASSWORD`, `POCKET_SECRET` or
`VAPID_PRIVATE` (before that it inherited them). Use a trusted command, and have it
treat the reminder text as untrusted data, because an agent or a person can write it.
Since 1.73.7 each run is ended, with everything it started, after
`POCKET_REMINDER_HOOK_TIMEOUT_MS` (default 60000) and when the daemon exits.

**Agent skills.** While a library is on, Pocket writes a skill into the Claude Code and
Codex skill folders of the service's user so agents know how to use it. It only changes
folders it created (marked `.pocket-managed`). Set `POCKET_SKILLS=0` to stop it.

### Vault

The Vault (1.39) keeps credentials so that agents can use them, in normal use, without the values
reaching the model provider, transcripts, turn logs, Pocket's search, MemStem or backups, and gives
the owner a say over which command or which form gets a value. It is not a wall against an agent that
sets out to get a value (see **What the Vault does not stop** below). It is off
until the owner switches it on. Since 1.44, switching it on with no key and no store creates
the key, saves it to the install's `.env` (mode `0600`) and shows a recovery key once.

**Secret guard (1.42).** Pasted or typed text that looks like a credential is held in the browser until the owner
stores it in the Vault, pastes it anyway or cancels, and the server refuses such a message unless it is sent anyway.
It reduces the chance of a secret reaching the model provider, the transcript or MemStem; it is pattern-based and
cannot catch every secret.

**Passphrase mode (1.40).** With a passphrase set, the store is encrypted under a key derived
from it (scrypt) that the daemon holds in memory only while unlocked; after a restart, a lock
or the idle time, nothing on the disk can open the store, including an agent that reads
`.env`. While unlocked the daemon serves agents as before, so the passphrase protects a
locked store, not a running one. Wrong passphrases (and recovery keys that do not open the
store) are limited to ten wrong tries an hour per signed-in session (since 1.89; it was per
address, and a caller could name a new address on each try). A new session can only be had
through the login and its own limit, or a Cloudflare Access sign-in. As a backstop for sessions
minted without the login's limit (a replayed Access token), the whole instance also allows only
50 wrong tries an hour across all sessions, unlocks and key restores together; past that every
unlock and restore answers "Too many tries. Wait an hour.", the owner's included, and the daemon
log says so.
Exports are encrypted under their own passphrase; a lost passphrase cannot be recovered.

**At rest.** The store is one file, `vault.enc`, encrypted with AES-256-GCM under
`POCKET_VAULT_KEY` (32 random bytes): items and their approved commands together, with
no plain-text names or other metadata. A file that has been altered, or a wrong key, fails
closed. The key lives in `.env`, which Pocket's backups leave out, never in the data
directory; keep the recovery key apart from your backups, since a restore without it yields
nothing. **Rotate key** writes the new key to `.env` before the store is rewritten, keeping
the old one as `POCKET_VAULT_KEY_PREVIOUS` only until the rewrite finishes, so a crash in
between still opens the store. **Restore key** accepts a recovery key only if it opens the
existing store, and Pocket never creates a new key over an existing store. Since 1.73.6 the
store takes a new key, salt or item only once the file holds it, so a failed write leaves memory
and disk agreeing (the recovery key is always the key the store is under), the file is synced
around its rename, and a key set in the process environment rather than `.env` is refused
rotation with 409 rather than left as a key the next start will not find. Since 1.76.3 a
rotation that stopped between its two `.env` saves is rolled back at the next start to the key
that opened the store, so a passphrase set and later removed never moves the store to a key the
owner was not shown. Keys are shown in the browser or downloaded by the owner; nothing prints
them to a terminal or a log.

**The key in memory.** The daemon reads `POCKET_VAULT_KEY` (and `POCKET_VAULT_KEY_PREVIOUS`,
when present) at start and deletes them from its own environment, so agent turns, helper models, hooks and every other process it starts
cannot inherit it. Since 1.73.3 the same is done for `POCKET_SMTP_URL` (its URL carries the mail password), `POCKET_SMTP_FROM`
and `POCKET_ROUTER_KEY`; the daemon's own login, cookie and push secrets were never passed on.

**What the Vault does not stop.** In normal use a value stays out of the agent's conversation, the
transcript and the logs. It is not a wall against an agent that sets out to get one:

- An item on *Free rein* can be obtained by any agent on the server: the agent chooses the command that
  receives the value, and that command can hand it on in any form.
- A value filled into a browser can be read back by the agent that asked for the fill, since that agent
  drives the page.
- A command you approve receives the real value and can do anything with it: print it encoded, write it
  to a file, send it elsewhere.
- So use *Free rein* only for low-value keys, and give high-value items *Ask once per command*, *Ask every
  time* or *Only you*, and read what you approve.

**What agents can do.** An agent can list items (names,
kinds, URLs, tags, policy, expiry, last use; never values or the owner's notes), create a new
item (an existing name is refused, so an agent cannot replace a credential), read its own
session's history, and ask the daemon to run a command with values in that command's
environment. The daemon starts the command itself, passes values only in the environment,
never in arguments, and returns the output with each value and its base64, URL-encoded, hex and reversed
forms replaced by `{{vault:name}}`, including a value carried inside longer base64 such as an HTTP
Basic header (1.82.1; values of 6 characters or more). The command leads its own process group (1.73.7): when it
exits, times out, passes the output cap or is stopped, everything still in that group is ended, so a
run cannot leave a daemon behind with the values in its environment. A program that deliberately
leaves the group (`setsid`, a double fork into a new session) is not followed. Reading a value, changing or removing an item, changing its
policy or recipes, answering requests and rotating the key need the owner's login cookie.

**What runs.** **Agent access** in Settings (1.41) sets the default, and each item can
override it. *Ask once per command*, the default, runs a command only if it exactly matches a
recipe the owner saved with *Always allow* (what a recipe holds is below); otherwise the owner is asked and the request
expires after 15 minutes; an answer stays good for 15 minutes after it is given (1.82.1). *Ask every time* asks for every run and offers no *Always allow*.
*Free rein* runs any command without asking (every use is still recorded). *Only you* refuses
agents. The owner answers from the Vault view, from the push notification's **Allow** and
**Deny** buttons, or by replying in the conversation that raised the request; only the owner's
own messages in that session count. Under Review actions the owner also approves the agent's
`pocket-vault run` call itself; under Full access the Vault's request is the only check, which
is why asking is the default. Calls from a terminal or code-server session on the host follow
the same rules and are recorded as `terminal`.

**What an Always allow trusts.** A recipe holds the command's text (program, arguments, folder) and what it runs: the
program found on the Vault's own `PATH` (`POCKET_VAULT_PATH`, or the daemon's `PATH` at start, absolute folders only;
never the caller's); the interpreter named on its `#!` line (and the program `#!/usr/bin/env` finds); the program a
known launcher starts (`env`, `timeout`, `nice`, `nohup`, `stdbuf`, `ionice`, `setsid`, `taskset`, `chrt`, `time`,
`xargs`, `sudo`, `doas`), found on that `PATH` and passed to the launcher by full path; the script a known interpreter
runs; every argument that names an existing regular file, including the value of a `--flag=file` argument; and, in code
given inline, each word that names an existing file. Each file is recorded by absolute path and the SHA-256 of its
content. A file Pocket cannot read, or one over 512 MB, is recorded by its size, modification time and change time
instead (the change time cannot be set back by an ordinary user, so a replacement with the same size and dates still
differs). A run matches a recipe only while all of that is unchanged; otherwise the request names what changed, and
nothing runs. The owner can mark an argument file as data the command writes itself (an output, log or state file) when
choosing *Always allow*; its content is then not compared.

**What runs is what was checked (1.117).** Every pinned file is opened once and hashed from that open file. On Linux, a
native program is started from that same open file (`/proc/self/fd/N`), so a file renamed or rewritten after the check
does not run; a setuid or setgid program is started by path. A shell script (one handed to `sh`, `dash`, `bash`, `ash`,
`ksh` or `mksh`, or a program whose `#!` line names one) runs from a private, read-only copy of the bytes that were
hashed, unless the script uses its own path (`$0`, `BASH_SOURCE`) or a launcher that cannot pass an open file (`sudo`,
`doas`, `xargs`) comes first. Everything else, including a script run by `node`, `python3` or another interpreter, is
read again in the same step just before the start, after the Vault's bookkeeping; a difference stops the run and the
history records *Run stopped*. What is left is the moment between the start and the moment such an interpreter opens its
script by path: an agent that swaps the file at exactly that moment can still win. In a test that swapped an approved
script at every delay from 0 to 20 ms after the request, 15 tries each, `sh job.sh` and `./job.sh` never ran the swapped
content (before this change about half of the tries did); `node job.js`, swapped at delays from 0 to 80 ms, still ran it
in about a quarter of the tries, all in a band around 10 to 40 ms.

**What it does not check.** Files a script reads or sources itself (`. ./lib.sh`, `require('./lib')`), modules and
libraries an interpreter or program loads, `package.json` scripts behind `npm run`, a `Makefile`, and programs a script
starts by name (those are looked up on the Vault's `PATH`, which is why Pocket logs a start-up warning for every folder on
it this user can write to, or create or replace); a folder, pipe or device given as an argument (a script that is not a
regular file is never allowed always, so it asks every time); code given inline beyond the files it names plainly (the request says so); what follows a launcher option
Pocket does not know, such as `env -S`, `env PATH=…`, `sudo -i` or `sudo -s` (the request says Pocket cannot tell what
it starts); and a process of the same user that changes a running command through `/proc` or a debugger. On systems
without `/proc` every file is only checked again before the start. Agents run as the same user as Pocket, so none of
this is a wall: it stops a tricked agent from quietly changing what an approved command runs. For a credential that
matters, use *Ask every time*, set `POCKET_VAULT_PATH` to folders this user cannot write, and allow always only commands
whose whole behaviour sits in files the agent cannot write.

**Recipes saved before 1.117.** A recipe with no content recorded asks once more, saying it was allowed before Pocket
checked what a command runs; *Always allow* keeps the same entry and records the content. A recipe recorded by the first
form of this check (program, interpreter and named files) still runs while what it recorded is unchanged and nothing new
needs recording; if this check now records more (the program a launcher starts, a file that could not be read), it asks
once in the same way.

**Requests are bound (1.73.4).** A pending request belongs to the kind of use it was raised for (a
command run, or a browser fill) and to the session that raised it: `pocket-vault wait` or the relay's
retry from another session is refused, a run cannot be continued as a fill or the reverse, one answer
serves one continuation, and the items' policies are checked again at that moment, so an item made
owner-only or removed after the approval no longer releases. Terminal and code-server calls carry the
CLI token and no runner token, so they share one identity, `terminal`: any such process on the host
can continue a request another terminal process raised. An agent that needs an identity of its own
runs inside a Pocket session.

**Browser fills (1.43).** `scripts/pocket-mcp-proxy.mjs` relays an agent's browser tool and
asks `/api/vault/release` for each `{{vault:name.field}}` it finds in a tool call, under the
same rules; a fill is recorded as such. The value goes only into the call to the browser tool
and is replaced by the placeholder in everything the tool sends back. Values are typed into
fill tools only (1.73.5: `browser_type`, `browser_fill_form`, `type`, `fill`, or the list in
`POCKET_VAULT_FILL_TOOLS`), never handed to `browser_evaluate` or put in an address; and once a
value has been typed, the relay withholds images, audio and blobs from that server for the rest
of its life, because a screenshot of the page cannot be scrubbed. The relay is the agent's own
tool, running as the same user, and the agent drives the page: the agent that asked for a fill
can read the value back, and so can the page. The placeholder keeps the value out of the
transcript in normal use; it does not keep it out of the agent's reach. Allow a fill as you would
hand that login to the agent, and only on sites you trust with it. The relay and the commands find the daemon through `<data dir>/cli-url` (1.43.1),
never an inherited `PORT`.

**Record of use.** Every run, request, answer, owner view of a value, addition, change,
removal, restore and rotation is written to `vault-audit.jsonl` (mode `0600`, append-only)
with the session and the command, never with a value. If the record cannot be written, the
action does not happen.

**In the browser.** Vault responses are `no-store` and kept out of the service worker's
cache, changes are refused unless the `Origin` header is Pocket's own, and a value is fetched
one field at a time when the owner taps it (on the item, or into the editor to correct it) and is never stored in the browser. Notes and
command text are shown as text, never as HTML.

**Intake links (1.110).** `/intake/<token>` is the one Vault page served without a login: someone outside types a
credential into it and it is stored as a new item. The token is 32 random bytes; only its SHA-256 is kept, inside
`vault.enc` with the rest of the store, and a lookup compares it against every link in constant time. A link works once,
expires after 1 to 168 hours (72 by default), and can be cancelled or replaced by the owner; up to 50 wait at once, and
the name each one will fill is reserved until it ends. The page shows the link's heading, who it is for, the asker and
the fields, never another item, name or value. It is sent `no-store`, `noindex`, with `Referrer-Policy: same-origin`,
`X-Frame-Options: DENY` and a CSP of `default-src 'none'` with same-origin script, style and form action only; the page
has no inline code. A post needs the link's own form nonce, and a post another site makes is refused by `Origin` or
`Sec-Fetch-Site`. The per-address limits apply only to an address Pocket can place (since 1.117): a `cf-connecting-ip` it
trusts (by the rules above), or the connection's own address when the request came through no proxy, an IPv6 address
counted by its /64. Such an address gets 60 page loads and 15 posts per ten minutes and 20 unknown tokens an hour. A
caller behind a tunnel or proxy that Pocket cannot place is not counted per address, so a stranger's wrong links cannot
close the page for the person a link was sent to. Across the install, past 300 unknown tokens an hour each further one is
answered after 1.5 seconds; nothing is refused for it, and a right link is not slowed. Opening a link does not use it, so a
mail scanner that follows it changes nothing. A post is parsed in memory and stored in the same write that marks the
link used; nothing typed is written back into a page, a log line, the audit record, a push or an agent's output (they
carry the item's name, the link's id and the field names). While the Vault is off or locked the page answers 503
*Temporarily unavailable* and keeps nothing; the link stays open. Paths with a token are redacted in error logs.

**Limits.** These are real, and the same as for the password above:
- Agents run as the same OS user as the daemon. An agent that goes looking can read `.env`,
  and with it the key and the store. The Vault keeps secrets out of prompts, transcripts,
  memory, backups and the provider in normal use, and makes their use visible. It is not process
  isolation, and it is not a wall against an agent that sets out to get a value (see **What the
  Vault does not stop**).
- A command the daemon runs for an agent runs with the daemon's permissions, outside any
  sandbox the agent's CLI applies, and can do whatever the credential allows. Approve
  commands as you would approve giving that credential to the command.
- Output scrubbing reduces accidental exposure. It cannot stop a command that writes the value
  to a file, encodes it some other way, or sends it off the box. What may run with a value is
  decided by the owner's approval and the recipe's content check, not by the scrubber.
- A secret pasted into a conversation, or one an agent read in a file before storing it, has
  already reached the provider and the transcript. Storing it protects later turns, not that
  one; rotate it. The secret guard catches common shapes of key, token and password, not every
  secret; use **Store in the Vault** instead of pasting. Terminal and code-server sessions
  outside Pocket are guarded only by the `pocket-vault` skill.
