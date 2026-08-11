#!/usr/bin/env bash
# linux-computer-use installer
# curl -fsSL https://raw.githubusercontent.com/Roadmvn/linux-computer-use/main/scripts/install.sh | bash
set -euo pipefail

REPO="https://github.com/Roadmvn/linux-computer-use.git"
HOME_DIR="${LCU_HOME:-$HOME/.linux-computer-use}"
APP_DIR="$HOME_DIR/app"

say()  { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

say "linux-computer-use installer"
say ""

# --- requirements -----------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || say "warning: this targets Linux, continuing anyway on $(uname -s)"

command -v git >/dev/null 2>&1 || fail "git is required. Install it, then run this again."
command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is required. See https://nodejs.org"
command -v npm >/dev/null 2>&1 || fail "npm is required (it ships with Node.js)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20 or newer is required, found $(node --version)."
say "node $(node --version)"

# --- fetch ------------------------------------------------------------------
mkdir -p "$HOME_DIR"
if [ -d "$APP_DIR/.git" ]; then
  say "updating $APP_DIR"
  git -C "$APP_DIR" pull --ff-only --quiet
else
  say "cloning into $APP_DIR"
  rm -rf "$APP_DIR"
  git clone --depth 1 --quiet "$REPO" "$APP_DIR"
fi

# --- dependencies -----------------------------------------------------------
say "installing dependencies"
( cd "$APP_DIR" && npm install --omit=dev --silent --no-fund --no-audit )

say "installing the bundled browser"
( cd "$APP_DIR" && npx --yes playwright install chromium >/dev/null 2>&1 ) \
  || say "warning: browser download failed. Run 'npx playwright install chromium' in $APP_DIR"

# --- done -------------------------------------------------------------------
ENTRY="$APP_DIR/src/index.js"
[ -f "$ENTRY" ] || fail "install looks incomplete, $ENTRY is missing."

say ""
say "installed at $APP_DIR"
say ""
say "Register it with your agent:"
say ""
say "  claude mcp add --scope user linux-computer-use -- node $ENTRY"
say "  codex mcp add linux-computer-use -- node $ENTRY"
say ""
say "Then restart your client and ask it to open a page."
say "Live view and human takeover:"
say ""
say "  cd $APP_DIR && npx playwright-cli show"
say ""
