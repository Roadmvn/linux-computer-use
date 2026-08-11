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
if ! ( cd "$APP_DIR" && npx --yes playwright install chromium ); then
  fail "browser download failed. Fix the error above, then run: cd $APP_DIR && npx playwright install chromium"
fi

# The bundled browser needs system libraries. install-deps only knows apt, so
# elsewhere the user installs them from their own package manager.
if command -v apt-get >/dev/null 2>&1; then
  say "installing system libraries (may ask for your password)"
  ( cd "$APP_DIR" && npx --yes playwright install-deps chromium ) \
    || say "warning: could not install system libraries automatically. If the browser fails to start, run: cd $APP_DIR && sudo npx playwright install-deps chromium"
else
  say "note: not an apt system. If the browser fails to start with a missing library,"
  say "      install your distribution's Chromium dependencies (nss, cups, gbm, alsa, atk, xkbcommon, X11)."
fi

# --- optional desktop backend ------------------------------------------------
# Only needed to drive native applications. The browser backend works without
# any of it, so a missing tool is reported and never fatal.
MISSING=""
for tool in Xephyr xdotool import; do
  command -v "$tool" >/dev/null 2>&1 || MISSING="$MISSING $tool"
done
command -v xfwm4 >/dev/null 2>&1 || command -v openbox >/dev/null 2>&1 \
  || command -v fluxbox >/dev/null 2>&1 || MISSING="$MISSING window-manager"

if [ -n "$MISSING" ]; then
  say ""
  say "Driving native applications additionally needs:$MISSING"
  if command -v apt-get >/dev/null 2>&1; then
    say "  sudo apt install xserver-xephyr xdotool imagemagick xfwm4"
  else
    say "  install your distribution's packages for Xephyr, xdotool, ImageMagick and a window manager"
  fi
  say "Driving a browser works without them."
fi

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
say ""
say "Live view and human takeover, on this machine:"
say ""
say "  cd $APP_DIR && npx playwright-cli show"
say ""
say "To watch from another machine instead, serve it and open the printed URL:"
say ""
say "  cd $APP_DIR && npx playwright-cli show --port=7777 --host=0.0.0.0"
say ""
say "  Anyone who can reach that port can drive your browser. Bind it to a"
say "  private interface or a VPN address rather than 0.0.0.0 when you can."
say ""
