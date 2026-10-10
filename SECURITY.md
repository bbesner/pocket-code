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
  removed from the environment of every agent process. That keeps them out of prompts
  and logs; it is not isolation, since the agent runs as the same user and can read
  `.env` if it goes looking.

Recommended:
- A long random `POCKET_PASSWORD` and `POCKET_SECRET`, and a `.env` with mode `600`.
- An identity layer in front (for example Cloudflare Access) for a second factor.
- Running as a user whose access you're comfortable handing to an agent.

Changing `POCKET_SECRET` signs everyone out.

## Projects, Files and Tasks

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

**CLI token.** The `pocket-board`, `pocket-docs` and `pocket-tasks` commands use a bearer
token that the daemon writes to `cli-token` in the data directory (mode `0600`) and
replaces at every start. It is accepted only on the Projects, Files and Tasks routes, and
only on a direct loopback connection: a request carrying a `cf-connecting-ip` or
`x-forwarded-for` header, as one arriving through a tunnel or proxy does, is refused. It
never replaces the login cookie anywhere else. Anyone who can read that file as the
service's OS user can read and change those libraries, and so can the agents, which run
as that user. Don't put the data directory on a shared path.

**Reminder hook.** `POCKET_REMINDER_HOOK`, if set, is run through a shell when a project
reminder or task comes due, with the item as JSON on standard input. It is a command from
the operator's own configuration, not from the browser or an agent, so keep `.env` and the
process environment writable only by the operator. The hook is started with the daemon's
environment as it stands, not the filtered environment agents get, so it can see
`POCKET_PASSWORD`, `POCKET_SECRET` and `VAPID_PRIVATE`. Use a trusted command, and have it
treat the reminder text as untrusted data, because an agent or a person can write it.

**Agent skills.** While a library is on, Pocket writes a skill into the Claude Code and
Codex skill folders of the service's user so agents know how to use it. It only changes
folders it created (marked `.pocket-managed`). Set `POCKET_SKILLS=0` to stop it.
