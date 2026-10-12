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
- Constant-time password comparison, and a limit of 20 login attempts per hour per IP
  (keyed on `cf-connecting-ip`, so it is reliable behind Cloudflare; another proxy that
  passes that header through unverified lets a client reset its own bucket).
- An HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie with a 90-day expiry.
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

Changing `POCKET_SECRET` signs everyone out.

## Projects, Files, Tasks and the Vault

These libraries are off until the owner switches them on in Settings. Turning one on adds
the following.

**File visibility.** Each file in Files is one of three kinds, and new files are private.
- *Private*: opened only behind Pocket's login.
- *Link*: opened at `/share/<token>` by anyone who has the address. The token is
  unguessable, only a hash of it is stored, and the link can carry an expiry.
- *Public*: opened at `/files/<name>` by anyone, with no token.

Link and public files are served **without a login**. Switch Files off and both stop
answering. Responses are `no-store`, `noindex`, and not framable by other sites. An HTML
file is served with a `sandbox` Content-Security-Policy and opens in a sandboxed frame, so
its own scripts can run but it cannot read Pocket's cookie, storage or API. The policy does not
restrict the page's own network requests, so treat a shared HTML file as published
content. Share only what you would be comfortable sending as an email attachment, and make
a file private again when you are done.

**Identity proxy in front.** If you put Cloudflare Access or a similar layer in front of
Pocket, check how it treats `/share/` and `/files/`. Pocket serves those paths without a
login, so an outside viewer can open a link or public file only if the proxy lets those
paths through to Pocket; otherwise the proxy will ask them to sign in first. Private files
and the rest of the app stay behind Pocket's own login whatever the proxy allows, since
Pocket checks its cookie itself. Test a link in a private window before you send it.

**CLI token.** The `pocket-board`, `pocket-docs`, `pocket-tasks` and `pocket-vault` commands
use a bearer token that the daemon writes to `cli-token` in the data directory (mode `0600`)
and replaces at every start. It is accepted only on the Projects, Files, Tasks and Vault
routes, and only on a direct loopback connection: a request carrying a `cf-connecting-ip` or
`x-forwarded-for` header, as one arriving through a tunnel or proxy does, is refused. It
never replaces the login cookie anywhere else. Anyone who can read that file as the
service's OS user can read and change those libraries, and so can the agents, which run
as that user. On the Vault routes the token can only do what an agent may (see below); it
never returns a value. Don't put the data directory on a shared path.

**Reminder hook.** `POCKET_REMINDER_HOOK`, if set, is run through a shell when a project
reminder or task comes due, with the item as JSON on standard input. It is a command from
the operator's own configuration, not from the browser or an agent, so keep `.env` and the
process environment writable only by the operator. Since 1.37.1 the hook gets the same
filtered environment as agent processes, without `POCKET_PASSWORD`, `POCKET_SECRET` or
`VAPID_PRIVATE` (before that it inherited them). Use a trusted command, and have it
treat the reminder text as untrusted data, because an agent or a person can write it.

**Agent skills.** While a library is on, Pocket writes a skill into the Claude Code and
Codex skill folders of the service's user so agents know how to use it. It only changes
folders it created (marked `.pocket-managed`). Set `POCKET_SKILLS=0` to stop it.

### Vault

**Secret guard (1.42).** Pasted or typed text that looks like a credential is held in the browser until the owner
stores it in the Vault, pastes it anyway or cancels, and the server refuses such a message unless it is sent anyway.
It reduces the chance of a secret reaching the model provider, the transcript or MemStem; it is pattern-based and
cannot catch every secret.


The Vault (1.39) keeps credentials so that agents can use them without the values reaching
the model provider, transcripts, turn logs, Pocket's search, MemStem or backups. It is off
until the owner switches it on, and it can only be switched on while `POCKET_VAULT_KEY` is set.

**Passphrase mode (1.40).** With a passphrase set, the store is encrypted under a key derived
from it (scrypt) that the daemon holds in memory only while unlocked; after a restart, a lock
or the idle time, nothing on the disk can open the store, including an agent that reads
`.env`. While unlocked the daemon serves agents as before, so the passphrase protects a
locked store, not a running one. Wrong passphrases are limited to ten an hour per address.
Exports are encrypted under their own passphrase; a lost passphrase cannot be recovered.

**At rest.** The store is one file, `vault.enc`, encrypted with AES-256-GCM under
`POCKET_VAULT_KEY` (32 random bytes): items and their approved commands together, with
no plain-text names or other metadata. A file that has been altered, or a wrong key, fails
closed. The key is never written to the data directory or a backup; keep it apart from your
backups, since a restore without it yields nothing. Rotating the key in Settings shows the
new key once in the browser; nothing prints it to a terminal or a log.

**The key in memory.** The daemon reads `POCKET_VAULT_KEY` at start and deletes it from its
own environment, so agent turns, helper models, hooks and every other process it starts
cannot inherit it.

**What agents can do.** An agent has no way to read a value. It can list items (names,
kinds, URLs, tags, policy, expiry, last use; never values or the owner's notes), create a new
item (an existing name is refused, so an agent cannot replace a credential), read its own
session's history, and ask the daemon to run a command with values in that command's
environment. The daemon starts the command itself, passes values only in the environment,
never in arguments, and returns the output with each value and its base64 and URL-encoded
forms replaced by `{{vault:name}}`. Reading a value, changing or removing an item, changing its
policy or recipes, answering requests and rotating the key need the owner's login cookie.

**What runs.** Each item's policy decides. *Ask*, the default, runs a command only if it
exactly matches a recipe the owner saved with *Always allow*; otherwise the owner is asked
and the request expires after 15 minutes. *Auto* runs any command. *Owner* refuses agents.
Under Review actions the owner also approves the agent's `pocket-vault run` call itself;
under Full access the Vault's request is the only check, which is why Ask is the default.
Calls from a terminal or code-server session on the host follow the same policy and are
recorded as `terminal`.

**Record of use.** Every run, request, answer, owner view of a value, addition, change,
removal, restore and rotation is written to `vault-audit.jsonl` (mode `0600`, append-only)
with the session and the command, never with a value. If the record cannot be written, the
action does not happen.

**In the browser.** Vault responses are `no-store` and kept out of the service worker's
cache, changes are refused unless the `Origin` header is Pocket's own, and a value is fetched
one field at a time when the owner taps it and is never stored in the browser. Notes and
command text are shown as text, never as HTML.

**Limits.** These are real, and the same as for the password above:
- Agents run as the same OS user as the daemon. An agent that goes looking can read `.env`,
  and with it the key and the store. The Vault keeps secrets out of prompts, transcripts,
  memory, backups and the provider, and makes their use visible. It is not process isolation.
- A command the daemon runs for an agent runs with the daemon's permissions, outside any
  sandbox the agent's CLI applies, and can do whatever the credential allows. Approve
  commands as you would approve giving that credential to the command.
- Output scrubbing reduces accidental exposure. It cannot stop a command that writes the value
  to a file, encodes it some other way, or sends it off the box.
- A secret pasted into a conversation, or one an agent read in a file before storing it, has
  already reached the provider and the transcript. Storing it protects later turns, not that
  one; rotate it. Pocket does not detect pasted secrets in this release; use **Store in the
  Vault** instead of pasting. Terminal and code-server sessions outside Pocket are guarded only
  by the `pocket-vault` skill.
