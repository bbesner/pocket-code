<!-- manual
checked: 1.79.2
sources: install.sh, scripts/pocket-init.mjs, ecosystem.config.cjs, access.mjs, models.mjs, trusted.mjs, proctree.mjs
-->
# Install Pocket Code

This page is written so that a person, or a Claude Code or Codex session working for them, can
take a Linux or macOS machine to a running Pocket Code and know at each step whether it worked. The
short version is one command; the rest explains what it does, how to check it and what to do
when a step fails.

## What you need

- A Linux or macOS machine (macOS since 1.47) that stays on, running as the user whose Claude
  Code sessions Pocket will run. On Windows, use an Ubuntu WSL2 distribution; native Windows is
  not supported.
- Node.js 20.11 or newer, git and npm.
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`) and signed in on this
  machine (`claude auth status`). Codex is optional and is picked up when `codex` is on `PATH`.
- A way to give the server an HTTPS address: Tailscale, a Cloudflare Tunnel, or a reverse proxy
  such as Caddy. Phones need HTTPS to install the app and receive push notifications. See
  [HTTPS](#https) below; the installer tells you which of these it found.

## One command

```bash
curl -fsSL https://raw.githubusercontent.com/bbesner/pocket-code/main/install.sh | bash -s -- --yes --contact you@example.com
```

Replace the contact with the operator's email address (or an https URL); push services use it
to reach whoever runs the server. The script:

1. Checks the platform, git, Node.js and npm.
2. Clones the newest release into `~/pocket-code` (set `POCKET_DIR` to choose another
   directory, `POCKET_RELEASE=vX.Y.Z` or `main` to choose a version). An existing checkout
   there is used as it is.
3. Runs `npm ci --omit=dev`.
4. Runs `pocket-init` with the arguments after `--`.

From a checkout you already have:

```bash
cd ~/pocket-code && npm ci --omit=dev && node scripts/pocket-init.mjs --yes --contact you@example.com
```

## What pocket-init does

`pocket-init` prints one line per check, `ok`, `warn`, `FAIL` or `skip`, then a summary. It is
safe to run again: values already in `.env` are kept, a daemon already running from this
checkout is left alone.

| Check | ok means | On FAIL |
|---|---|---|
| Platform | Linux or macOS. Windows stops with a pointer to WSL2. | Install inside WSL2. |
| Node.js | 20.11 or newer. | Install a newer Node.js. |
| Dependencies | `node_modules` present, or `npm ci --omit=dev` just ran. | Run `npm ci --omit=dev` in the checkout and read its error. |
| Claude Code | `claude` found and signed in. Not signed in is a warning: sign in with `claude` in a terminal, or later from Pocket's **Settings → Agents & instance → Accounts & instance** (**Settings → Accounts** in Assistant mode). | Install Claude Code, or set `CLAUDE_BIN=/path/to/claude` in `.env`. |
| Codex | Found (optional). | Nothing; Pocket shows Codex sessions once `codex` is installed. |
| PM2 | `pm2` on `PATH`, or installed with `npm install -g pm2` (`--yes`, or answer the prompt). | Install PM2; a global npm prefix you cannot write to needs `sudo` or a user prefix. |
| PM2 app | No `pocket-claude` process, or one running from this checkout. | One from another directory: stop it (`pm2 delete pocket-claude`) or install there instead. One daemon per data directory. |
| Port | `127.0.0.1:<port>` is free (default 3610). Checked only when no `pocket-claude` process is running. | Choose another with `--port`, or stop whatever holds it. |
| .env | Created, or the missing lines added, with mode `0600`: `PORT`, `POCKET_PASSWORD`, `POCKET_SECRET`, `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_CONTACT`. Placeholders copied from `.env.example` (`change-me`, `you@example.com`) are replaced. An existing `PORT` is kept: `--port` with a different value is a FAIL. | Skipped when an earlier check failed; fix that and run again. |
| Daemon | `pm2 start ecosystem.config.cjs` then `pm2 save` (or `pm2 restart` when new settings were added to a running install). | Read `pm2 logs pocket-claude --lines 50`. |
| Health | `http://127.0.0.1:<port>/api/health` answered `{"ok":true}` within 30 seconds. | Same logs. A port mismatch between `.env` and an old process is the usual cause. |
| Boot | Linux: a `pm2-<user>.service` exists; macOS: a `pm2.<user>.plist` launch agent exists. Saved processes return after a reboot (Linux) or login (macOS). | Warning only: run `pm2 startup`, then the command it prints, then `pm2 save`. |

Flags: `--port N`, `--contact …`, `--yes` (install PM2 without asking), `--no-start` (write
`.env` only), `--dry-run` (report, write and start nothing), `--json` (the report as JSON for
a program to read; it never contains the password), `--show-password`. Exit code 0 means ready (or a
clean dry run), 1 a check failed, 2 bad arguments.

### The password

`pocket-init` generates a long random login password and saves it as `POCKET_PASSWORD` in
`.env`. On a terminal it prints the password once. **Run by an agent, or with output piped,
it does not print the password**: the owner reads it themselves with

```bash
grep '^POCKET_PASSWORD=' ~/pocket-code/.env
```

so the password never lands in a transcript. To choose the password instead, set
`POCKET_PASSWORD` in the environment of the `pocket-init` run (not on the command line, which
other users can see in `ps`). Change it later by editing `.env` and `pm2 restart ecosystem.config.cjs`.

### Running it as an agent

Use `--yes` and `--contact` so nothing waits for a keyboard, and `--json` if you want to read
the result as data. Then verify, in this order:

```bash
curl -s http://127.0.0.1:3610/api/health      # {"ok":true,...}
pm2 describe pocket-claude | grep -E 'status|script path'
ls -l ~/pocket-code/.env                      # -rw------- (0600)
```

Tell the owner where the password is (the `grep` above) rather than reading it to them, and
which HTTPS option the installer found on the machine. Do not edit `.env` to add settings the
owner did not ask for; [`.env.example`](../.env.example) documents the optional ones.

## HTTPS

The server listens on loopback only. Something in front of it has to terminate TLS and carry
the hostname. Pick one:

**Tailscale Serve** (private to your tailnet; simplest). With Tailscale installed and this
machine and your phone on the same tailnet:

```bash
tailscale serve --bg 3610
```

It prints an `https://<machine>.<tailnet>.ts.net` address with a valid certificate. Nothing is
exposed to the public internet. (`tailscale funnel` would make it public; Pocket's own login is
the only guard then, so prefer Serve.)

**Cloudflare Tunnel** (a public hostname on a domain you have on Cloudflare). With
`cloudflared` installed and a tunnel configured, add an ingress rule ahead of the catch-all in
`~/.cloudflared/config.yml`, route the name and restart:

```yaml
ingress:
  - hostname: code.yourdomain.com
    service: http://localhost:3610
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <tunnel-name> code.yourdomain.com
sudo systemctl restart cloudflared
```

Put Cloudflare Access in front of the hostname if you want an identity check before Pocket's
password. Since 1.63 Pocket can then skip its own password: set `POCKET_ACCESS_TEAM` (the
Zero Trust team name, as in `<team>.cloudflareaccess.com`), `POCKET_ACCESS_AUD` (the Access
application's audience tag, under the application's Overview) and `POCKET_ACCESS_EMAILS` (the
comma-separated emails that may sign in this way). Pocket checks Cloudflare's signature on the
`Cf-Access-Jwt-Assertion` header, the team, the audience, the expiry and the email, then signs
the browser in for as long as the Access token lasts, at most a day; anything else gets the
password page. Leave any of the three unset to
keep the password only. Since 1.67 the same can be set, changed or turned off in **Settings → Agents &
instance → One sign-in**.

**Caddy** (a public hostname with automatic certificates, on a machine with ports 80 and 443
open):

```
code.yourdomain.com {
    reverse_proxy 127.0.0.1:3610
}
```

**nginx**: a TLS server block proxying to `http://127.0.0.1:3610` with `proxy_http_version 1.1`
and the `Upgrade`/`Connection` headers passed through, so streamed replies are not buffered.

Whichever you use, `POCKET_FRAME_ANCESTORS` in `.env` is only needed if another page will embed
Pocket in a frame.

## macOS notes

Pocket Code runs on macOS since 1.47. The differences from Linux:

- Install Node.js and git with Homebrew (`brew install node git`); the one-liner then works as
  written. `claude` is found in `/opt/homebrew/bin` as well as the usual places.
- PM2 starts at **login**, not boot: `pm2 startup` writes a launch agent for your user. A Mac that
  sleeps stops the sessions too; set it to stay awake (System Settings → Energy, or `caffeinate`)
  if it is meant to run unattended.
- File previews in Files need `brew install poppler imagemagick` (PDFs and images); HTML previews
  use Chrome or Chromium from `/Applications`.
- The turn watchdog reads process activity with `ps` instead of `/proc`; behavior is the same.
- A daemon restart reattaches Codex session processes as on Linux (since 1.81): with no `/proc`, Pocket
  proves a recorded app-server is the one it started from its start time as `ps` reports it. Earlier
  releases forgot the record at every restart and left the app-server holding the conversation; one
  orphaned that way before you upgraded still has to be ended by hand (`pkill -f 'codex app-server'`
  with Pocket stopped).
- Tailscale Serve is the simplest HTTPS path on a Mac at home, since home routers rarely allow a
  public hostname.

Not yet covered on macOS: voice mode (`scripts/voice-setup.sh` is untested there) and the
browser test suite. Report what you find in [issue #87](https://github.com/bbesner/pocket-code/issues/87).

## After installing

1. Open the HTTPS address and sign in with the password.
2. On a phone, choose **Add to Home screen**, then tap the bell to allow notifications.
3. Start a session: choose the agent, the working directory and the model.
4. Choose a mode in **Settings → Appearance → Mode**: **Developer mode** if you write code or run
   coding agents, **Assistant mode** if Pocket is your assistant for office work (see the
   [README](../README.md#developer-mode-or-assistant-mode)).
5. Projects, Files, Tasks, Inbox Watch and the Vault are off until you switch them on in **Settings →
   Projects, files, tasks & vault** (in Assistant mode, **Settings → Features**). With Inbox
   Watch on, Pocket runs the watcher itself every minute with `python3`, reading Gmail through the
   Gmail connector Claude Code or Codex already has (**Settings → Agents & instance → Connectors**); see the
   [README](../README.md#inbox-watch-your-mailbox-read-for-you). Voice is a separate optional install
   (`scripts/voice-setup.sh`, see the [README](../README.md#voice-mode-beta)).

### Limiting the Claude models

To provision a computer whose users should only run some models, set the list in `.env`
before the first start and restart after a change:

```bash
echo 'POCKET_CLAUDE_MODELS=claude-sonnet-5-5,claude-haiku-5-5' >> ~/pocket-code/.env
echo 'POCKET_CLAUDE_MODEL=claude-sonnet-5-5' >> ~/pocket-code/.env   # optional: what Default runs
```

The owner can change the list later in **Settings → Agents & instance → Claude models in the
picker**; once saved there, that choice wins over `.env` (**Use the server's list** goes back).
To make a limit binding, put it in Claude Code's managed settings
(`availableModels` and `deniedModels` in `managed-settings.json` or `managed-settings.d/*.json`, under
`/etc/claude-code` on Linux or `/Library/Application Support/ClaudeCode` on macOS): Pocket
reads the same file, never offers a model it blocks, marks such models in Settings, and never
passes one to the CLI. Without that, a blocked pick would run silently on the account's default
model. Details: [Models in the picker](manual/sessions.md#models-in-the-picker).

### Read-only actions that skip the approval card

Review actions shows a card for every Claude command and tool call. To let users' lookups and
memory searches run straight through, list them before the first start (restart after a change):

```bash
echo 'POCKET_TRUSTED_ACTIONS=Bash(acme-lookup:*),mcp__notes__search' >> ~/pocket-code/.env
```

The owner can change the list later in **Settings → Agents & instance → Actions that run without
asking**; a list saved there wins over `.env`. List only commands that cannot change anything,
whatever their arguments. Writes always ask. Syntax and matching:
[action approvals](action-approvals.md#actions-that-run-without-asking).

## By hand

Everything `pocket-init` does, as shell:

```bash
git clone https://github.com/bbesner/pocket-code.git ~/pocket-code
cd ~/pocket-code
git checkout --detach "$(git tag --list 'v*' --sort=-v:refname | head -n1)"
npm ci --omit=dev
KEYS=$(npx web-push generate-vapid-keys --json)
cat > .env <<'ENV'
PORT=3610
VAPID_CONTACT=you@example.com
ENV
echo "POCKET_PASSWORD=$(openssl rand -base64 18)" >> .env
echo "POCKET_SECRET=$(openssl rand -hex 32)" >> .env
echo "VAPID_PUBLIC=$(echo "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0)).publicKey')" >> .env
echo "VAPID_PRIVATE=$(echo "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0)).privateKey')" >> .env
chmod 600 .env
pm2 start ecosystem.config.cjs && pm2 save
curl -s localhost:3610/api/health
```

## Upgrading, moving and removing

Upgrades check out a reviewed release tag and restart from the ecosystem file; the
[operations guide](operations.md#upgrade-an-existing-installation) has the steps, the state
inventory and rollback notes. Moving the data directory, downgrading and uninstalling are in
[the same guide](operations.md#move-data-downgrade-or-uninstall). Close all session processes
first.
