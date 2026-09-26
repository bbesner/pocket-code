# Security

## Reporting a vulnerability

Please report security problems privately via GitHub: **Security → Report a
vulnerability** on this repository. Don't open a public issue. You'll get an
acknowledgment, and a fix or an explanation, as soon as it can be looked at.

## Security model

Pocket Code runs AI coding agents on your server **without approval prompts**. Claude Code
runs with `--permission-mode bypassPermissions`, and Codex runs with full access and no
approval policy. Anyone who can sign in can run commands as the user the service runs as.
Treat the password like an SSH key.

Built in:
- The server listens on `127.0.0.1` only. Expose it through an HTTPS tunnel or reverse proxy.
- Constant-time password comparison, and a limit of 20 login attempts per hour per IP.
- An HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie with a 90-day expiry.

Recommended:
- A long random `POCKET_PASSWORD` and `POCKET_SECRET`, and a `.env` with mode `600`.
- An identity layer in front (for example Cloudflare Access) for a second factor.
- Running as a user whose access you're comfortable handing to an agent.

Changing `POCKET_SECRET` signs everyone out.
