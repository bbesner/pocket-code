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
