# Security

## Reporting a vulnerability

Please report security problems privately via GitHub: **Security → Report a
vulnerability** on this repository. Don't open a public issue. You'll get an
acknowledgment, and a fix or an explanation, as soon as it can be looked at.

## Supported versions

The latest release is supported; fixes go into the next release.

## What an install trusts

`install.sh` clones this repository over HTTPS and checks out the newest `v*` release tag (or the
one `POCKET_RELEASE` names), then runs `npm ci` against the lockfile. Nothing in that chain is
checked against a signature: release tags are not signed, and the installer does not verify the
tag, the commit or itself. An install therefore trusts GitHub and everyone who can push a tag or
a commit to this repository. A tag pushed by someone who took over a maintainer's account would
be installed by the next new install. This is a known limit, accepted for now.

To depend on it less:

- Download `install.sh` and read it before you run it, instead of piping it into a shell.
- Set `POCKET_RELEASE` to a tag you chose, and compare the commit it checks out with the one the
  release page on GitHub shows.
- Or clone the repository yourself, check out a commit you have reviewed, and follow
  `docs/install.md` from there.

An existing install is never updated by the installer or by a new release; upgrades are a
deliberate step (`docs/operations.md`).

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
  request carries a Cloudflare Access token that verifies for this application (Sign in with Cloudflare Access is
  set up), or `POCKET_TRUSTED_PROXY=1` says the port is reachable only through a proxy that sets
  the header itself. Otherwise it is the connection's own address, so a caller that types a new
  header on each try no longer gets a fresh count. The trade-off: through a tunnel with neither,
  every caller arrives from the tunnel's `127.0.0.1` and shares one count, so a stranger who
  uses up the 20 tries locks the owner's password page for the hour too (a signed-in browser
  is not affected). Set `POCKET_TRUSTED_PROXY=1` only when nothing but that proxy can reach the
  port: with it, anything that reaches the port directly can again choose its own address.
  Since 1.118 an IPv6 address is counted by its /64 (one home or server network), so stepping
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
  Since 1.118, Settings has **Sign out** (this browser) and **Sign out everywhere**. Sign out
  ends the sign-in in this browser only: a copy of the cookie taken earlier stays valid until
  Sign out everywhere or until it expires. Sign out everywhere, and a change of `POCKET_PASSWORD` noticed at the next start, move the instance to a
  new sign-in generation (kept in `auth-state.json` in the data directory, mode `0600`, holding a
  keyed hash of the password, never the password), and every cookie from an earlier generation
  stops working. A start that finds no usable `auth-state.json` in a data folder a daemon has
  used before (the first start after upgrading to 1.118, or a deleted, unreadable or corrupt
  file) begins a new generation: every browser signs in once after the upgrade, a password
  changed in the same restart ends the old cookies, and deleting the file signs everyone out
  rather than reviving an old cookie. "Used before" is read from the files every start leaves
  in the data folder (`cli-token`, `cli-url`, `auth-state.json`); a folder with none of them is
  a new install, which starts with the pre-1.118 cookie form until the first Sign out
  everywhere. The limits: a data folder restored from a backup that holds an older
  `auth-state.json` brings that generation back, and the cookies it signed work again until they
  expire; removing all three files makes the folder look new, so cookies in the pre-1.118 form
  (from before the upgrade, at most 90 days old) work again. Choose Sign out everywhere after a
  restore. Anyone who can change the data folder runs as the service's user and can read
  `POCKET_SECRET` and make a cookie anyway, so these limits give such a caller nothing new. Two
  daemons sharing one data folder do not see each other's Sign out everywhere until they
  restart (sharing a folder is not supported). Sign out also removes that browser's
  push subscription, and Sign out everywhere removes every one, so a lost phone stops receiving
  notification text; the owner turns notifications on again on the devices that stay. With
  Cloudflare Access and Sign in with Cloudflare Access in front, a signed-out browser is signed in again by Access
  without the password; to end those sessions too, revoke them in Cloudflare.
- `Strict-Transport-Security: max-age=31536000` on responses to requests that reached the
  tunnel or proxy over HTTPS (`X-Forwarded-Proto` or Cloudflare's `CF-Visitor`), since 1.118.
- `/api/health` tells a caller that is neither signed in nor a direct loopback connection only
  `{"ok":true}` (since 1.118); the running counts and uptime are for the owner and the box itself.
- **A reverse proxy must send `X-Forwarded-For`** (and `X-Forwarded-Proto`). Pocket tells a request
  made on the box from one that came through a proxy by the proxy's headers: `X-Forwarded-For`,
  `Forwarded`, `X-Real-IP` or Cloudflare's `CF-Connecting-IP`. A proxy that sends none of them,
  such as nginx's `proxy_pass` on its own, makes every caller look local: strangers get the
  `/api/health` detail, every caller shares the intake links' per-address limits, and without
  `X-Forwarded-Proto` HSTS is not sent. Cloudflare Tunnel, Caddy and Tailscale Serve send
  `X-Forwarded-For` themselves; nginx needs the two `proxy_set_header` lines in
  `docs/install.md`.
- Uploads are written mode `0600` in folders that are `0700` (since 1.118), whatever the umask.
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

Changing `POCKET_SECRET` or `POCKET_PASSWORD` signs everyone out (the password since 1.118).

## Pause all and Automation (1.117)

**Pause all** stops every running reply and holds everything Pocket starts without the owner. Its limits
(**Settings → Unattended work**) hold unattended work back from using up a plan.

- **Owner only.** `GET` and `POST /api/pause`, `POST /api/resume`, `GET /api/automation` and
  `POST /api/automation/settings` take the owner's sign-in only (the session cookie, or the one sign-in
  through Cloudflare Access). The CLI token is refused (401), so no agent or script on the host can lift a
  pause or raise its own limits. For the same reason, while paused the token's `POST /api/inbox/watch` is refused
  (409) when it would set a paused Inbox Watch running again (1.124.2). The three `POST` routes also need a JSON body and refuse a cross-site
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

## Check-backs (1.119)

A check-back lets an agent, asked by the owner, start one more reply in its own conversation at a later time. It is
off until the owner turns it on in **Settings → Features → Check-backs**. This is what it adds.

- **Who may set one is enforced by the server.** `POST /api/checkbacks/agent/add` succeeds only while the conversation's
  current reply is one the owner started (origin `owner`), or a check-back's own reply with its chain under the **Chain
  limit**, which may set one follow-up and no more. A reply started by the queue, a usage-limit retry, a coordination wake or a job, or one the agent
  began itself after a background job or as a permission stand-in, is refused with the reason. The origin is decided
  inside Pocket and never read from a request. So an emailed alert, a pager message or a coordination wake that reaches
  an agent in a reply the owner did not start can't set one from that reply. In Codex it also needs Full access.
- **Runner token required.** The command carries the CLI token and the conversation's runner token (`x-pocket-runner`).
  The conversation always comes from the runner token, never from the request: an agent can't set, list or cancel a
  check-back in another conversation. A command with no runner token (a terminal, code-server, a side chat) is refused,
  and so is an OpenRouter conversation. The owner's sign-in is refused on the agent routes, and the CLI token is refused
  on the owner's (`GET /api/checkbacks`, `POST /api/checkbacks/cancel` and `cancel-all`), so an agent can't cancel
  another conversation's check-back or change a setting.
- **What an injected instruction could do.** If text an agent reads (a web page, a file, a mail) tells it to set a
  check-back during a reply the owner started, the agent could set one. That is deferred work with that reply's own
  power, not new power. The note is text the agent wrote and may repeat what it read. Pocket saves it on one line (each run of spaces and line breaks becomes one space), so it can't add lines that look like Pocket's own to the check-back's opening message. The later reply is no more powerful than the one
  that set it: it has the same permission mode, lowered to Review actions when the owner chose **Always Review actions**
  or the server disallows Full access, and under Review actions every action still asks the owner. It is bounded by
  the count limits, the time range, the chain limit, the daily and plan limits and the longest-reply limit, it is held
  by Pause all, and the owner sees a card in the conversation, a row in Tasks (while Tasks shows check-backs), and a push when it runs, and can cancel it.
- **What it could not do.** Set one from a reply the owner did not start (but see the runner token under *Limits*). Set one in another conversation, or raise its
  permissions, limits or the chain limit. Change the owner's settings. Make a check-back run without a card and an audit
  line. Run more than once (a check-back is saved as running before anything starts, and a crash marks it missed or
  cut off, never runs it again). Start a check-back while Pocket is paused.
- **Owner only.** The owner's routes and the settings take the sign-in only; the two `POST` routes also need a JSON body
  and refuse a cross-site request.
- **The audit file holds no note and no reply.** Each check-back event (set, cancelled, held, started, finished, missed)
  is one line in `automation-audit.jsonl` with the id, conversation, engine and chain depth. `checkbacks.json` itself holds
  each note, so keep the data directory private, as above. It is written with mode `0600`.
- **Limits of this protection.** The runner token is in the environment of the conversation's process, so a program the
  agent starts there has it, the same as it has the other things that process can reach. The token lasts as long as that
  process, and the origin rule looks at the reply running when the call arrives: a command left running by a reply the
  owner did not start is refused then, but accepted if it calls again while a later reply the owner started is running. An agent running as the same OS user
  could edit `checkbacks.json` or `pocket-settings.json` by hand; the boundary is the routes, not the files.

## Job keys

Job keys (1.122.0) let a script on the server start a reply, in a conversation the owner can watch, with an instruction the owner wrote. They are off until the owner turns them on in **Settings → Features → Job keys**. This is what they add.

- **Who may call.** `POST /api/jobs/run` and `GET /api/jobs/runs/<run>` take a job key and nothing else, and only from this server:
  the socket must be loopback and the request must carry none of `cf-connecting-ip`, `x-forwarded-for`, `forwarded` or
  `x-real-ip`. A call through the tunnel or a proxy is refused with 403 (*Job keys work only from this server …*). The app's
  session cookie and the CLI token are refused on these routes too (403), so neither opens them. A reverse proxy that adds
  none of those headers looks like a local caller; `docs/install.md` has the proxy send `X-Forwarded-For` for this reason.
  With job keys off, a caller that is not on this server gets the same plain 404 as before the feature existed, and one that
  is gets *Job keys are switched off on this Pocket.*
- **How a key is stored and compared.** A key is `pjk_` and 43 characters from 256 random bits. Pocket shows it once and keeps
  only its SHA-256 hash in `job-keys.json` (mode `0600`, written by tmp file and rename). A presented key is hashed and compared
  with every stored hash in constant time, with no early exit. The key is never logged, never audited and never in a
  response after creation: the owner's list shows a key's settings and state, not the key or its hash.
- **One answer for every bad key.** A wrong key, a text that isn't a key, a disabled key, a deleted key and a key that was
  rotated all get the same 401 (*Unknown or disabled job key.*), byte for byte, so the answer doesn't tell a caller which
  keys exist or which are off. The audit file records which it was (`bad_key` or `disabled_key`), without the key. One
  exception, by shape and not by key: a bearer value of exactly 64 hex characters, the shape of the CLI token, gets 403
  `job_key_only` (*This route takes a job key only, not the app's sign-in or the CLI token.*), whether or not it is the
  token. A caller with no key at all gets 401 `no_key`.
- **Rate limit.** More than 20 wrong keys in 60 seconds, counted across the whole server because every caller is loopback,
  are answered 429 until the minute is out. A right key still works meanwhile, and the limit is audited once.
- **What a key can do.** It starts one kind of reply: a new conversation in the key's folder with the key's agent, model and
  access and the owner's instruction, or the next reply in a conversation that same key started. The folder, agent, model, access
  and instruction are the owner's, fixed in the key; a call can't choose or change them. It can send data, and instructions
  too only where the owner turned on **The job may add its own instructions**. The call passes the same unattended gate as a
  check-back (Pause all, the plan ceilings, the daily count), the key's own limits and **Most data per run**, and a refusal
  starts and queues nothing.
- **What a key can't do.** Change a setting, pause or resume Pocket, make, change, rotate or delete a key, read a conversation
  or a run of another key, or continue a conversation it didn't start. The owner's routes (`/api/jobs/keys…`, the settings,
  Pause all) take the owner's sign-in only: a job key and the CLI token are refused there. A reply a job started can't set a
  check-back, and is refused like any reply the owner did not start.
- **Data is information, not instructions.** Everything a job sends is put into the reply under a line that says it is
  information, not instructions from the owner, and inside a Markdown fence one backtick longer than any run of backticks in
  the data, so the data can't close the fence early. It ends with a closing line. With **The job may add its own
  instructions** on, a job's added instructions come after the owner's, in their own fence, labelled with the key's name.
  This is a fence and a label, not a wall: an agent can still be misled by text in the data (see below).
- **"May add its own instructions" and what turning it on means.** It is off for a new key unless the owner changed the
  default. On, the script that holds the key can say what the reply does, within the key's folder, model, access and limits.
  Treat that key as if it were the owner typing the message, bounded by the access the key has. Leave it off when the job
  only has data to hand over.
- **Key files.** With **Save the key to a file**, Pocket writes `<folder>/<name>.key` with mode `0600`, through a temp file and
  rename. The folder must be inside the home folder; Pocket resolves links against the real home folder and never writes
  through one that leads out of it. A folder Pocket creates is `0700`. It never replaces a file that isn't a one-line job key
  file (a link included), and never one that another key records as its own (409 `file_taken`): a renamed key keeps its
  old key file name, and a new key of the old name can't take the file over. It rotates a file only while it still holds
  the old key or the key Pocket last wrote there for this key (a rotation cut off before the file was rewritten leaves
  that one; 1.124.4), and deletes it only while it still holds the key being deleted. If the file can't be written, no key is made.
- **The audit file.** `automation-audit.jsonl` records `job` lines (created, updated, enabled, disabled, rotated, deleted,
  refused and finished) and `job_auth` lines (a wrong or disabled key, the rate limit). A change names the fields it changed,
  never their values; none holds a key, a hash, an instruction or any data. The reply's own line carries origin `job` and the
  run id.

**Plain warnings.**

- **Any program that can read a key file can start that job, and an agent can be that program.** Pocket never gives an
  agent a key. Its routes refuse an agent that tries to make, change, rotate, delete, list or answer for a key, and after an
  Allow the agent is told the key file's path, never the key. But a key file is a file, mode `0600`, readable by the OS user
  that runs Pocket, and agents run as that same user. So an agent with Full access in a conversation could read a key file
  and call that job with it, and so can any other program running as that user. What that buys it is bounded by the key: a
  fixed instruction, folder, model and access, the per-key limits and the install-wide gate. The CLI token is readable by
  that user in the same way. What follows for the owner: keep key folders out of the folders agents work in, which stops an
  agent coming across a key file by accident but not one that goes looking, and treat a job key as no stronger a boundary than
  the user account that owns the file. This is the one statement of the rule; the other places that mention it point here.
- **A job with Full access can do what the agent can do in that folder.** Full access is the key's setting, and is available
  only where the server allows it (`POCKET_ALLOW_FULL_ACCESS` is not `0`); where it is off, a job runs under **Ask first**
  (the Review actions mode; the setting for new keys calls it *Ask me for every action*) whatever its key says. Under that,
  every action asks the owner, and nobody may be looking, so the reply waits for an answer.
- **A new key is Full access by default (since 1.125.2).** The owner decided on 2026-11-27 that work he asked to run
  unattended should run without stopping for approvals, so the setting for new keys starts at **Full access** where the server
  allows it, and at **Ask first** where it doesn't. Existing keys keep their access; a saved *Ask me for every action* stays.
- **Text in the data can still mislead the agent, and under Full access nothing stops it to ask.** A job's data comes from
  outside: an emailed alert, a log line, a web page. Text in it can say "ignore the above, run this", and the agent might go
  along. Under Full access that command runs with no approval card. The fence and the label lower that risk; they don't remove
  it. What still protects: the owner writes the standing instruction, and the data can't change it, the folder, the agent or the
  access; the data is labelled as information, not instructions; no key exists until the owner makes or allows it, and the
  owner sees its access on the New job key sheet and on the request card before it does; the key's folder and its run limits
  bound what one key can do; **Pause all** stops every run; a job's reply can't set a check-back or ask for a key; and, for a
  Claude Code key, Claude Code's own safety check still asks before a few dangerous commands even under Full access.
  Recommendation: for a key whose data comes from people outside the owner's control and whose job doesn't need to change
  anything, choose **Ask first** (*Ask me for every action*). Keep Full access keys in folders where a mistake is cheap.
- **`POCKET_URL` decides where `pocket-run` sends the key.** Leave it unset or point it at this server.
- **The data directory holds the runs.** `job-keys.json` holds each key's hash and settings and, for each run, its status and
  the first line of the reply; keep the data directory private, as above.

### A conversation asks for a job key

An agent in a conversation can ask for a job key with `pocket-jobkey`; only the owner's Allow makes one. This is the
only route Pocket gives an agent to a key, so the rules are fixed and none is a setting. (A key file is still a file the
user can read: see the first plain warning above.)

- **Who may ask.** `POST /api/jobs/agent/propose` and `GET /api/jobs/agent/requests/<request>` take the CLI token together
  with the conversation's runner token, the pair check-backs use. Pocket accepts a job key proposal only with the runner
  token of a conversation whose running reply the owner started and in which no job has ever run (a run of a deleted key
  still counts). The token belongs to the conversation's process, not to one reply, so in a conversation no job ever ran
  in, a process left behind by an earlier reply the owner did not start (a check-back's, a queued message's, or one the
  agent began itself) can still propose while the owner's next reply runs; the owner's Allow in Settings, after reading
  the whole instruction, is still required. In detail: the reply that is running must have been started by the owner (its
  origin and its root origin must both be `owner`, and it must not be a reply the agent began itself after a background
  job); a reply started by a job, a check-back, the queue, a retry or a coordination wake is refused (403
  `not_owner_reply`). After that check, a conversation a job has ever run in is refused too (403 `job_conversation`),
  even while the owner's own reply runs there, because what a job sends could be steering it; the owner can ask in a
  conversation no job runs in, or make the key in Settings. A terminal or code-server has no runner token and is refused. The app's sign-in is refused
  on these routes (403), a job key gets 401, and OpenRouter and Antigravity conversations are refused. Every refusal
  after the caller is known is audited (`proposal_refused`).
- **What it can send.** Only the fields of the **New job key** sheet: name, folder, agent, model, effort, access,
  instruction, whether the job may add instructions, limits and the push choice. Any other field is refused, so a request
  can't name the key file or its folder, an existing key, or whether a key is on. The same checks as the sheet apply, and
  they run again at Allow, because the folder, the agent or Full access may have changed since.
- **What Pocket's routes refuse an agent.** Reading, listing, changing, turning off, rotating, deleting or using a key
  through Pocket, and answering a request, its own included. Reading another conversation's request: that and an unknown
  id get the same 404, so the answer doesn't say which exist. None of this stops an agent from reading a key file as the
  user (first plain warning above).
- **Only the owner answers.** `POST /api/jobs/requests/<request>/answer` takes the owner's sign-in cookie from Pocket's
  own page and nothing else. The CLI token and a job key are refused (401), and a request from another site is refused
  (403). The owner can edit any field before answering; the key is made from what the owner sent.
- **The push can't answer.** *Allow a job key?* has no action buttons, and it doesn't carry the instruction. A notification
  can't show a whole instruction, and an allowed key starts work without asking from then on, so the owner reads the whole
  instruction in Settings first. The push follows each device's **Vault requests** switch.
- **The whole instruction is on the card.** Every line of the instruction shows, in a block that grows with it and has no
  inner scroll, and the answers (**Deny**, **Edit first**, **Allow**) come after the last line. Enter never allows: not on
  the card, and not in a field of **Edit before you allow**, where only a click or tap on **Allow with these changes** (or
  Enter or Space with that button focused) allows.
- **No auto-approve.** There is no setting, preset or environment variable that allows a request by itself. A request
  waits for the owner, at most one for each conversation and five for the install, and expires after 24 hours: no key is
  made.
- **The key stays out of every answer.** On Allow, Pocket writes the key straight to its key file. The agent is told the
  status, the key's id and name and the file's path, never the key or its hash. No response to an agent, no log line and
  no audit line holds either. The audit lines (`proposed`, `proposal_allowed`, `proposal_denied`, `proposal_expired`,
  `proposal_refused`) name fields and never give their values. If the key file can't be written, Pocket deletes the key
  again: nothing exists, and the request stays waiting.
- **A waiting request holds the whole instruction** in `job-keys.json`, which is why that file is mode `0600`. Answered
  and expired requests are dropped after 7 days.

**Plain warning.** Read the whole instruction and the access before you allow a request. An agent wrote it, and it may
have been led by text it read. **An allowed key lets any program that can read the key file start that job**, with that
instruction, folder and access, as often as the key's limits allow, and an agent with Full access running as the same
user is such a program (first plain warning above). Keep the key folder out of the folders agents work in, and choose
**Full access** only for a folder where a mistake is cheap.

## Answering action approvals away from the app

Since 1.126.0 the owner can answer an agent's action approval from its notification. It is off on every install until
the owner turns on **Answer approvals from notifications** in **Settings → Features**. While it is off, every approval
notification is exactly as in 1.125.3: no buttons and no command. An answer that says it came from a notification is
then refused (404 `answers_off`). Turning it off again, or muting a conversation, replaces the approval notifications
already out (for that conversation, or everywhere) once, silently, with a line that says why and no buttons. Turning it on
adds the following. Answering by voice is not built.

- **Who can answer.** `POST /api/session/<id>/approvals/<request>/decision` takes the owner's sign-in only: the session
  cookie, or the sign-in through Cloudflare Access. The CLI token, runner tokens and job keys are refused (401), so an
  agent can't answer its own request. Since 1.126.0 the route also refuses a request whose `Origin` header names another
  site (403), for every caller, the app included. A request with no `Origin` header passes, as on the Vault routes.
  The check compares `Origin` with the `Host` header the request arrived with, so a reverse proxy must forward the public
  `Host` (`docs/install.md`). Behind one that does not, every answer from the app's buttons and from notifications gets
  403 until the proxy is fixed. A notification answer refused this way says Pocket refused the answer from that address;
  it does not say the device was signed out.
- **What the checks are for.** Anyone with the owner's sign-in can answer as the app does, from the full card. The checks
  below apply to an answer that says it came from a notification (`via: notification`). They tie an Allow tapped on a
  notification to the exact text the server built for that device, and refuse it when the server would no longer offer it.
  They are not a second sign-in.
- **When a notification offers Allow.** Only when all of these hold; otherwise it offers **Don't allow** only:
  - The device's **Allow button on this device** is on, tested at a limit at least today's (below).
  - The request can be stated in one line: a Claude Code command (Bash or PowerShell), web page (WebFetch) or web search
    (WebSearch) with no input field outside a short fixed list; a Codex command with no extra permissions that names its
    own folder; or an OpenRouter or Antigravity command whose text came from the command itself, with an allow-once
    option. Each of those two engines is read from its own field only (`command` for OpenRouter, `CommandLine` for
    Antigravity) with no field outside a short list; a request that carries both fields gets no Allow, and the app's card
    shows both under Show details. OpenCode's command may run in a folder of its own that the request does not carry,
    which is why an OpenRouter request's folder line reads "Conversation folder:", the folder the conversation started in. File edits, helpers, connector tools, network access, more access for the reply and any request Pocket
    doesn't know never get Allow. Nor does a request the app's card can't allow.
  - The action and the folder are printable ASCII only (space to `~`). That shuts out line breaks, tabs, zero-width and
    direction-changing characters, and look-alike letters such as a Cyrillic "а".
  - The action line and the folder line, labels included, together fit in **Longest action with an Allow button**, 80
    characters by default. With a usual folder that leaves room for a command of roughly 30 characters. The owner can
    raise the limit, up to 240; each device then needs a new test.
  - The folder is a full path (it starts with `/`), is not empty and has no `..` part. Nothing in it or in the action
    would change when the push cleans the line: no leading, trailing or doubled space. A folder the engine gave as `~/`
    counts as a relative path; only Pocket's own shortening of the home folder shows `~/`.
  - The secret detector finds nothing in the action or the folder.
  - The reply's origin allows it (the job rule, below).
  - The reply's engine is switched on under **Engines**.
  - The whole notification goes out uncut.
- **Never more than one request.** Allow from a notification covers the one request it names. **Always allow**, and a new
  rule for **Actions that run without asking**, are never offered there. **Don't allow** is offered on every approval
  notification: denying runs nothing, and the agent can ask again.
- **The device test.** Pocket can't see what a phone draws: a phone may show one line or three, fold a notification, or
  bundle it with others while the buttons still work. So the owner proves it per device. **Send a test notification**
  sends a sample in the real layout at today's limit: an action line and a folder line that together are exactly the
  limit, each ending in a two-character code, then the longest context lines. The owner types both codes back within 10
  minutes. Pocket keeps the limit the device was tested at with that device's push subscription in `push-subs.json`. The
  routes that save a device's notification choices and subscribe it never accept it. Subscribing again (turning push off
  and on, or a browser that changes its push address) turns the device's Allow button off, and raising the limit turns it
  off on every device. The test shows that someone read the end of both lines on that device once. It doesn't show that
  the device displays them in every view, every time.
- **The check when an answer arrives.** For an Allow from a notification, the server builds that notification again for
  the device that posts, with today's settings. It refuses the Allow (409) when the notification would no longer offer it,
  or that device's push service never accepted a push with Allow for this request (`not_offered`); when the push is older
  than **Allow works for**, 30 minutes by default (`too_old`); or when `shown` differs (`changed`). A switch turned off, a
  lower limit or **Only that an action waits** therefore takes back an Allow already on a phone. Any `via` other than `app`
  or `notification` is refused (400 `unknown_via`). As for every answer, the decision is recorded before the agent hears
  it.
- **What `shown` proves, and what it doesn't.** `shown` is a SHA-256 of the request's id, its kind, the action line and the
  folder line as built for that device. It proves that the Allow names text the server built from this request and would
  still offer now. It does not prove what the screen displayed, that the owner read it, or that the answer came from a
  notification at all. `via`, the push address the answer sends and the record's `source` are what the client says. The
  device test is what stands for "the whole line was shown".
- **The job rule.** A job's data (an emailed alert, a pager message) can steer the agent into proposing a command made to
  look harmless, and that text stays in the conversation. So a job's reply, and every later reply in a conversation a job
  has run in, offers **Don't allow** only unless the owner turns on **Allow on a job's actions** (off by default). That
  includes the owner's own replies there, any branch of such a conversation and any conversation handed off from one
  (Pocket follows both links back, at most 100 steps, and stops at a loop). A check-back's reply offers Allow while
  **Allow on a check-back's actions** is on (the default); in a conversation a job has run in, the job rule wins. The rule
  is checked when the notification is built and again when the answer arrives.
- **Outside text reaches the owner's own replies too.** A web page, an email or a file an agent reads can shape a command
  in a reply the owner started. That is why the rule that Allow appears only beside the whole action, in plain characters
  and short enough to read, is the main protection everywhere. The origin rule is a second one.
- **Nothing that looks like a secret goes into the push.** Push text passes through the browser's push service. An action,
  a folder, a conversation title, a job's name or a subagent name that looks like a password or key is replaced by a note,
  and so is the text of a summary or replacement notification. Each is checked as written and again as the push shows it
  (format characters (Unicode class Cf: zero-width and direction-changing ones) and default-ignorable code points (Default_Ignorable_Code_Point: variation selectors, the combining grapheme joiner, the tag characters and the like) removed; line breaks and a listed set of blank-looking characters turned into one space), and once
  more with those blank-looking characters removed, so none of those characters can split a key that the scanner
  would otherwise see whole. A tool's name (the Uses: line) is also scanned after each underscore run and each `__`
  part, as in `mcp__ghp_…`. The scanner's own patterns decide what looks like a key; a key in a form it doesn't know
  is not caught.
- **A stolen or borrowed phone.** By default the notification shows the action on the lock screen (**What approval
  notifications show: The action**). Whether a button works on a locked phone depends on the device, and nothing here has
  been verified on real phones yet. Allow from a locked phone on a tested device is accepted by design: each install's
  owner chooses it, per device, by turning that device's Allow button on. Anyone holding the phone unlocked, and on some phones locked, can read
  the action and tap Allow while the notification is younger than **Allow works for**. Pocket can't prevent that. The
  remedies: the phone's own setting that hides notification content on the lock screen (its effect on the buttons is
  unverified); **Only that an action waits**, which shows no conversation, no action and no Allow; leaving a device's
  Allow button off; and, for a lost phone, **Sign out everywhere**, which removes every push subscription at once.
- **The record.** Each `decision` line in `approval-decisions.jsonl` now has `source` (`app` or `notification`). One from a
  notification also has `device` (12 hex digits of a SHA-256 of the push address, or `unknown` when that address isn't
  subscribed), `pushService` (the push address's host) and `action` (the kind of action). A refused answer from a
  notification writes a `refused` line with its reason, also when the request was no longer waiting (`gone`) or had been
  answered already (`answered`, or `answered_in_app` when the app answered it). If that line can't be written the answer
  is still refused, and Pocket does not try again; a decision that could not be recorded is not also recorded as refused.
  No line holds a command, an argument or file content.

**Weaknesses inherited from the Vault's notification flow, stated and not fixed.** The first one in the plan, a cut
command beside Allow, was fixed in 1.125.3. These still apply:

1. **The Vault's own record has no source.** A Vault answer is still recorded as the owner's wherever it came from. Action
   approvals now record a source, as the answer states it.
2. **Stale buttons on other devices.** Once a request is answered or withdrawn, Pocket sends a silent replacement to the
   other devices that got it. That is a new push: it can be late or lost, and none is sent after a restart or with
   **Update other devices after an answer** off. A tap on a stale Allow is refused (409) and says so. It can't answer
   another request, because every answer names its own.
3. **A failure on a locked phone.** The notification closes before the answer is sent. When the answer doesn't land,
   Pocket shows a second notification saying so and opens the conversation at the request, but on a locked phone that page
   waits for the unlock.
4. **No recent sign-in.** Any device with the 90-day cookie and a push subscription can answer; with its Allow button on,
   it can allow. Pocket asks for no fresh sign-in.
5. **Behind Cloudflare Access (unverified).** When the Access session has ended, the answer meets a redirect to the Access
   login. For action approvals the service worker doesn't follow it and reports that the device was signed out; this has
   not been checked against a real Access login. A Vault answer still follows the redirect, and what it reports then has
   not been checked either.

## Projects, Files, Tasks and the Vault

These libraries are off until the owner switches them on in Settings. Turning one on adds
the following.

**File visibility.** Each file in Files is one of three kinds, and new files are private.
- *Private*: opened only behind Pocket's login.
- *Link*: opened at `/share/<token>` by anyone who has the address. The token is
  unguessable and the link can carry an expiry. Since 1.118 the token is never stored in
  the clear: `documents.json` keeps a hash of it, and since 1.124.10 also the token sealed
  with AES-256-GCM under a key derived from `POCKET_SECRET` (HMAC-SHA-256 with a label of
  its own), bound to the record's id. The sealed token is never in a listing or a record's
  view. Only the signed-in owner can read it back (**Copy link**, `POST /api/documents/:id/link`,
  cookie plus same origin, answered `no-store`); the CLI token cannot, so an agent gets a
  link's address only in the answer that made it. Someone who has both `documents.json`
  and `.env` can therefore recover open link addresses; before 1.124.10 they could not.
  Changing `POCKET_SECRET` leaves links working but Pocket can no longer show those made
  before the change. A lost address is replaced with a new link, which stops the old one. A `documents.json` written before 1.118 also held each
  address in plain text; the first start of 1.118 removes those (keeping each hash, or making
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
Since 1.118 an HTML file is pictured inside a sandboxed frame (no scripts, forms or plugins) under a
policy that allows only inline styles and `data:` images and fonts, from a folder holding nothing
else, and Chrome runs with every host name unresolvable and every network request sent to a proxy
that does not exist. A hostile page can no longer picture another local file or reach a server
from the box; the price is that a page's remote images, web fonts and scripted charts are left out
of its picture.

**CLI token.** The `pocket-board`, `pocket-docs`, `pocket-tasks`, `pocket-coord`, `pocket-vault` and
`pocket-checkback` and `pocket-jobkey` commands use a bearer token that the daemon writes to `cli-token` in the data directory
(mode `0600`) and replaces at every start. It is accepted only on the Projects, Files, Tasks and Vault
routes and, together with a conversation's runner token, on the check-back agent routes
(`/api/checkbacks/agent/*`) and the job key request routes (`/api/jobs/agent/*`), and only on a direct loopback connection: a request carrying a `cf-connecting-ip`,
`x-forwarded-for`, `forwarded` or `x-real-ip` header, as one arriving through a tunnel or proxy
does, is refused. It
never replaces the login cookie anywhere else. Anyone who can read that file as the
service's OS user can read and change those libraries, and so can the agents, which run
as that user. On the Vault routes the token can do what an agent may (see below), and that
includes a browser fill, which hands the value to the caller that asked for it: anything that
holds the token can obtain any value an agent could have filled. Don't put the data directory
on a shared path.

**Agents and sharing (1.118).** Text an agent reads can try to trick it, so the token cannot make a
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
- A script that `node`, `python3` or another interpreter opens by its path can be swapped by an agent that
  can write the script or its folder, timed to the moment the command starts; such a swap will usually
  succeed. What protects a credential there is a script in a folder the agent's user cannot write, or
  *Allow once* after reading the script. The request says when an agent can change the script.
- A command Pocket cannot fully check (code given inline, the modules a script loads, a program's own
  configuration) can still change what it does without the request changing; see **What it does not check**.
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
own messages in that session count. The notification offers **Allow** only when the command, the title and
the text were sent uncut and in plain characters (1.125.3): a command over 80 characters or with any character
outside printable ASCII, and a title or text cut to fit or holding a control, format or line-separator character,
leave **Deny** only. This covers what the server sent, not what a phone draws: a phone can fold a long notification
until it is opened out, and the notification never carries the folder or the variables. Under Review actions the owner also approves the agent's
`pocket-vault run` call itself; under Full access the Vault's request is the only check, which
is why asking is the default. Calls from a terminal or code-server session on the host follow
the same rules and are recorded as `terminal`.

**What an Always allow trusts.** A recipe holds the command's text (program, arguments, folder), its variables and what
it runs: the program found on the Vault's own `PATH` (`POCKET_VAULT_PATH`, or the daemon's `PATH` at start, absolute
folders only; never the caller's); the interpreter named on its `#!` line (and the program `#!/usr/bin/env` finds, and
the `#!` line of an interpreter that is itself a script); the program a known launcher starts (`env`, `timeout`, `nice`,
`nohup`, `stdbuf`, `ionice`, `setsid`, `taskset`, `chrt`,
`time`, `xargs`, `sudo`, `doas`, `flock`, `sshpass`), found on that `PATH` and passed to the launcher by full path; the
script a known interpreter runs, found the way the interpreter finds it (`node job` runs `job`, else `job.js`, `job.json`
or `job.node`; `python3 -m tool` runs `tool.py`, or `tool/__main__.py` with the package's `__init__.py` files, from the
working folder); a file given by path to `node -r`, `--require`, `--import` or `--loader` (and bun's `--preload`); the
makefile `make` reads (after `-C`, or the one `-f` names); every argument that names an existing regular file, including
the value of a `--flag=file` or `NAME=file` argument; and, in code given inline, each word that names an existing file.
Each file is recorded by absolute path and the SHA-256 of its content. A file Pocket cannot read, or one over 512 MB, is
recorded by its size, modification time and change time instead (the change time cannot be set back by an ordinary
user, so a replacement with the same size and dates still differs). A run matches a recipe only while all of that is
unchanged; otherwise the request names what changed, and nothing runs. The owner can mark an argument file as data the
command writes itself (an output, log or state file) when choosing *Always allow*; its content is then not compared.

**Variables (1.118).** A recipe records which variable gets which item (and which field of a login or card), and a run
matches only the same set: the same command run with the value under another name, with another item for a name, or
with a variable added asks again, and the request shows each variable with the item it gets. Some names cannot be
bound at all, because a program acts on them by itself, before or instead of anything the approved command does with
the value: it runs, loads or parses the value as code, options or a command (so a part of the value can show in an
error), creates a file or folder named after it, or sends it to another computer. They are Pocket's own (`POCKET_*`),
`PATH` and `HOME`; the loader's (`LD_*`, `DYLD_*`); interpreter start-up (`NODE_*` except `NODE_AUTH_TOKEN`,
`NPM_CONFIG_*`, `PYTHON*`, `PERL*`, `RUBY*`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`); the shell's
(`BASH_ENV`, `ENV`, `IFS`, `PS0` to `PS9`, `PROMPT_COMMAND`, `SHELLOPTS`, `BASHOPTS`, `ZDOTDIR`, `SHELL`); git's
(`GIT_*`, except `GIT_TOKEN`, `GIT_PASSWORD`, `GIT_USERNAME`, `GIT_CREDENTIALS` and `GIT_AUTH_TOKEN`, which git does not
read); programs started by name (`PAGER`, `MANPAGER`, `EDITOR`, `VISUAL`, `BROWSER`, `LESS*`, `SSH_ASKPASS`,
`SUDO_ASKPASS`, `MAKEFLAGS`, `MFLAGS`, `MAKEFILES`); files and folders a program creates (`TMPDIR`, `TMP`, `TEMP`,
`TEMPDIR`, `XDG_*`, `SSLKEYLOGFILE`, `HISTFILE`, `GNUPGHOME`, `DOCKER_CONFIG`); and names sent along or shown in part
(`LANG`, `LANGUAGE`, `LC_*`, which ssh passes to the other computer, and `TZ`). Ordinary credential names such as
`GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN` and `PGPASSWORD` are not affected. The list cannot name every
variable every program reads; the variable line on the request is what shows the rest.

**What runs is what was checked (1.118).** Every pinned file is opened once and hashed from that open file. On Linux, a
native program is started from that same open file (`/proc/self/fd/N`), so a file renamed or rewritten after the check
does not run; a setuid or setgid program is started by path. A shell script (one handed to `sh`, `dash`, `bash`, `ash`,
`ksh` or `mksh`, or a program whose `#!` line names one) runs from a private, read-only copy of the bytes that were
hashed, unless the script uses its own path (`$0`, `BASH_SOURCE`) or a launcher that cannot pass an open file (`sudo`,
`doas`, `xargs`, `flock`, `sshpass`) comes first. Everything else, including a script run by `node`, `python3` or another
interpreter, and a makefile, is read again in the same step just before the start; a difference stops the run and the
history records *Run stopped*. The interpreter then opens the script by its path, and an agent that can write the script
or its folder and swaps it at that moment will usually succeed: in a test that swapped an approved script repeatedly
around the start, `node job.js` and `python3 job.py` ran the swapped content almost every time, while `sh job.sh` never
did. Interpreters were not moved to the checked bytes: `node` given an open file opens the script by its path again, and
`python3` given one reports the open file as the script's own path, which breaks scripts that find files beside
themselves; the modules a script imports would stay unchecked in any case. So the request notes when an agent can change
such a script or a folder above it. What protects a credential is a script in a folder the agent's user cannot write
(nor any folder above it), or *Allow once* after reading the script.

**Commands Pocket does not offer Always allow (1.118).** When Pocket cannot tell what a command will run, the request
says why in one sentence, and offers *Allow once* and *Deny* only: an interpreter with no script it can find (`node`
with no file, `xargs … sh` reading names from a file, a `-r` path that does not exist, a module `python3 -m` would load
from a partial package); a program that runs what it finds (`find -exec`, `-execdir`, `-ok`, `node --test`, `bun test`,
`deno test`); a program that starts another command Pocket cannot follow (`parallel`, `watch`, `entr`, `nodemon`, `pm2`,
`strace`, `gdb`, `chroot`, `unshare`, `su`, `runuser`, `script`, `systemd-run`, `tmux`, `screen`, `expect`, `cross-env`,
`concurrently` and similar, or a launcher option Pocket does not know, such as `env -S` (on the command line or in a
`#!` line) or `sudo -i`); a command run on another computer (`ssh` with a command, a `ProxyCommand`-style option,
`rsync -e` written any way, `scp -S` or `-D`, `sftp -S`, `-D` or a batch file); scripts a project defines
(`npm run`, `npm test`, `npm install`, `npm publish` and every other npm, pnpm or yarn command except a short list that
runs nothing of the project's, such as `npm whoami` or `npm view`; `node --run`, `bun run`, `deno task`); packages
fetched and run (`npx`, `pnpx`, `bunx`, `npm exec`, `deno x`); containers (`docker`, `podman` and `nerdctl` commands
other than `login`, `logout`, `pull`, `push`, `search`, `version`, `info`, `images`, `ps`, `inspect` and `tag`); code
from an address (`deno run https://…`, `npm:` or `jsr:` specifiers); and live reloading or debugging (`node --watch`,
`--inspect`, `bun --hot`). A command Pocket refuses in this way, which was allowed always before, asks every time and
says so.

**What it does not check.** Pocket pins what a command names; it does not read what a program does next. Not checked:
files a script reads, sources or includes itself (`. ./lib.sh`, `require('./lib')`, `import`, a makefile's `include`);
modules and libraries an interpreter loads, including a preload given by package name (`node -r dotenv/config`,
`ruby -r json`), a module `python3 -m` finds outside the working folder (the interpreter's library, installed packages,
the user's own site folder) and the compiled copy Python keeps in `__pycache__`; code given inline (`sh -c`, `bash -c`,
`python3 -c`, `perl -e`, `node -e`, `make --eval`) beyond its text and the files it names plainly (the request says so);
a program's own configuration and hooks (git hooks and `.git/config`, `.npmrc`, `~/.ssh/config`, a tool's config file in
the working folder); what a program installs or builds and then runs (`pip install`, `cargo run`, `go run`); and a
program Pocket does not know as an interpreter (`tsx`, `ts-node` and the like), whose script is checked as a named file
but whose imports are not. Programs a script starts by name are looked up on the Vault's `PATH`, which is why Pocket
logs a start-up warning for every folder on it this user can write to, or create or replace. A folder, pipe or device
given as an argument is not checked (a script that is not a regular file is never allowed always, so it asks every
time); nor is a process of the same user that changes a running command through `/proc` or a debugger. On systems
without `/proc` every file is only checked again before the start. Agents run as the same user as Pocket, so none of
this is a wall: it stops a tricked agent from quietly changing what an approved command runs. For a credential that
matters, use *Ask every time*, set `POCKET_VAULT_PATH` to folders this user cannot write, and allow always only commands
whose whole behaviour sits in files the agent cannot write.

**Recipes saved before 1.118.** Every command allowed always before 1.118 asks once more, because none recorded which
variable gets which item: the request says so and shows the variables, and *Always allow* keeps the same entry and
records them, with the content as it is checked now. A recipe with no content recorded says it was allowed before
Pocket checked what a command runs. A command that Pocket now refuses as above asks every time.

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
of its life, because a screenshot of the page cannot be scrubbed. Since 1.124.2 it also refuses
the calls that make a picture (`browser_take_screenshot`, `browser_pdf_save`, `screenshot`, plus
`POCKET_VAULT_PICTURE_TOOLS`): Playwright MCP saves every screenshot and PDF to a file and names
it, and the agent could open that file with its own tools; since 1.124.5 also the tools that capture
the page another way (`browser_run_code_unsafe`, video, tracing, `browser_annotate`). Since 1.124.3 it also refuses any call
that names a `filename` (Playwright MCP saves a snapshot, an evaluate result or a log there), as
the relay scrubs only what comes back to the agent, never a file the server writes. Since 1.124.4
the browser tool running calls side by side cannot slip such a call past a fill: one that arrives
while a fill waits (for approval too) is held until the fill settles, and a fill is typed only once
every such call sent before it has answered (it is refused, with nothing typed, after
`POCKET_VAULT_PICTURE_WAIT` seconds, default 30). The relay is the agent's own
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
`Sec-Fetch-Site`. The per-address limits apply only to an address Pocket can place (since 1.118): a `cf-connecting-ip` it
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
