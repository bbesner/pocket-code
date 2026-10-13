#!/usr/bin/env bash
# Pocket Code one-command install (1.46). Clones the latest release, installs dependencies and runs pocket-init.
#
#   curl -fsSL https://raw.githubusercontent.com/bbesner/pocket-code/main/install.sh | bash -s -- --yes --contact you@example.com
#
# Arguments after `--` go to pocket-init (--port, --contact, --yes, --no-start, --dry-run, --json). Environment:
#   POCKET_DIR      where to install (default ~/pocket-code)
#   POCKET_RELEASE  a tag such as v1.46.0, or `main`; default: the newest release tag
#   POCKET_REPO     the git URL or path to clone (default: the GitHub repository; set for a fork or a test)
# An existing checkout in POCKET_DIR is used as it is (not updated); upgrades follow docs/operations.md.
set -euo pipefail
DIR="${POCKET_DIR:-$HOME/pocket-code}"
REPO="${POCKET_REPO:-https://github.com/bbesner/pocket-code.git}"
say() { printf '%s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || { say "pocket-code install: '$1' is required but not found. $2"; exit 1; }; }

case "$(uname -s)" in
  Linux) ;;
  Darwin) say "macOS: Pocket Code is developed and tested on Linux; continuing, see https://github.com/bbesner/pocket-code/issues/87" ;;
  *) say "Pocket Code runs on Linux (on Windows, inside WSL2). Unsupported: $(uname -s)"; exit 1 ;;
esac
need git "Install git first."
need node "Install Node.js 20.11 or newer (https://nodejs.org or your distribution's packages)."
need npm "Install npm with Node.js."
NODE_OK="$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>20||(a===20&&b>=11)?"yes":"no")')"
[ "$NODE_OK" = yes ] || { say "Node.js $(node --version) is too old; Pocket Code needs 20.11 or newer."; exit 1; }

if [ -d "$DIR/.git" ]; then
  say "Using the existing checkout in $DIR (not updated; see docs/operations.md to upgrade)."
else
  say "Cloning Pocket Code into $DIR"
  git clone --quiet "$REPO" "$DIR"
  REL="${POCKET_RELEASE:-}"
  if [ -z "$REL" ]; then REL="$(git -C "$DIR" tag --list 'v*' --sort=-v:refname | head -n1)"; fi
  if [ -n "$REL" ] && [ "$REL" != main ]; then
    say "Checking out release $REL"
    git -C "$DIR" checkout --quiet --detach "$REL"
  fi
  if [ ! -f "$DIR/scripts/pocket-init.mjs" ]; then
    say "$REL predates pocket-init (1.46); using main instead."
    git -C "$DIR" checkout --quiet main
    [ -f "$DIR/scripts/pocket-init.mjs" ] || { say "This repository has no scripts/pocket-init.mjs; follow the by-hand steps in docs/install.md."; exit 1; }
  fi
fi

cd "$DIR"
say "Installing dependencies (npm ci --omit=dev)"
npm ci --omit=dev --no-fund --no-audit --loglevel=error
# When piped from curl, stdin is the script itself: give pocket-init the terminal if there is one, so it can ask.
if [ -t 1 ] && [ -r /dev/tty ]; then exec node scripts/pocket-init.mjs "$@" </dev/tty; else exec node scripts/pocket-init.mjs "$@"; fi
