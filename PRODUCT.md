# PRODUCT.md — Pocket Code

Design context for contributors. For setup and usage, see the README.

**What it is:** A self-hosted, mobile-first web app (PWA) for working with Claude Code and
Codex sessions away from the desk. It's a thin window onto sessions that live and run on
the server. The server owns every turn, so work continues when the phone screen goes dark.

**Who it's for:** Developers who already run Claude Code or Codex on a server, and use a
terminal, VS Code or code-server at the desk. The phone has to feel like the same sessions,
because it is the same store.

**Jobs:**
1. See recent sessions across all projects and open one.
2. Continue a session: send a message, watch progress, walk away, come back.
3. Start a new session in a chosen project directory.

**Principles:**
- Bare essentials: sessions, chat, new session. A clean screen, simple navigation, and as
  much room as possible for the conversation.
- Everything round-trips with the CLIs and editor extensions. No private history.
- Reading matters more than composing. Assistant text renders as a full-width document,
  not chat bubbles.
- Type is large and high-contrast, and comfortable to read outdoors or with tired eyes.
- Dark theme, because evening and on-the-go use is the main scenario.

**Out of scope:** general file browsing/editing, a terminal and multi-user accounts. Native questions and action approvals are
supported; review/full-access choices govern subsequent Pocket-owned turns, while
server credentials and provider rules remain the authority. Read-only Git inspection belongs to the
session workspace. Codex Plan mode guides the task but is not a security sandbox.

**Platform:** Mobile web / installable PWA, served by `server.mjs` (default port 3610)
behind an HTTPS tunnel or reverse proxy.
