#!/usr/bin/env bash
# Install and open CreatorClips on Windows through WSL (Ubuntu), from its source code.
#
#   curl -fsSL https://raw.githubusercontent.com/trentrichards34/bridgeclip/feat/avatar-studio/scripts/setup-wsl.sh | bash
#
# Safe to run again: it skips what is already done, updates the app and opens it. It installs
# Git, Python 3.12, FFmpeg and the libraries the app window needs (with sudo), Node.js 22 (with
# nvm, no sudo), puts the app in ~/CreatorClips-app (your videos go to ~/CreatorClips), and adds a
# `creatorclips` command that updates and opens the app.
set -euo pipefail
# Everything sits inside one block so bash reads the whole script before running it (safe with `curl | bash`).
{

REPO_URL="${CREATORCLIPS_REPO:-https://github.com/trentrichards34/bridgeclip.git}"
BRANCH="${CREATORCLIPS_BRANCH:-feat/avatar-studio}"
APP_DIR="${CREATORCLIPS_DIR:-$HOME/CreatorClips-app}"
NODE_MAJOR=22

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || fail "This setup is for WSL (Ubuntu) on Windows. On a Mac, use setup-mac.sh instead."
command -v apt-get >/dev/null 2>&1 || fail "This setup needs Ubuntu (or another Debian-based Linux) in WSL. In PowerShell run: wsl --install -d Ubuntu-24.04"
[[ "$(uname -m)" == "x86_64" ]] || fail "This setup supports 64-bit Intel and AMD PCs only."
if [[ -z "${WSL_DISTRO_NAME:-}" ]] && ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "Note: this does not look like WSL. Continuing as a regular Ubuntu install."
elif [[ -z "${WAYLAND_DISPLAY:-}" && -z "${DISPLAY:-}" ]]; then
  fail "WSL can't show app windows here. CreatorClips needs Windows 11 (or Windows 10 with WSLg). In PowerShell run: wsl --update, then reopen Ubuntu and paste this again."
fi

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
  echo "Some steps need your Ubuntu password (the one you made when you set up Ubuntu). Nothing shows as you type; that's normal."
fi
apt_install() { $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null; }

say "1/6  Git, Python 3.12, FFmpeg and the app window libraries"
$SUDO apt-get update -qq >/dev/null
apt_install git curl ca-certificates ffmpeg software-properties-common
if ! apt-cache show python3.12-venv >/dev/null 2>&1; then
  # Ubuntu 22.04 and older don't ship Python 3.12; the deadsnakes archive does.
  $SUDO add-apt-repository -y ppa:deadsnakes/ppa >/dev/null
  $SUDO apt-get update -qq >/dev/null
fi
apt_install python3.12 python3.12-venv
# Libraries Electron needs to draw its window; Ubuntu 24.04 renamed libasound2.
asound="libasound2t64"; apt-cache show "$asound" >/dev/null 2>&1 || asound="libasound2"
apt_install libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
  libxcomposite1 libxdamage1 libxrandr2 libxkbcommon0 libpango-1.0-0 libxshmfence1 "$asound" \
  fonts-liberation xdg-utils
ffmpeg -hide_banner -filters 2>/dev/null | grep -E '[[:space:]]ass[[:space:]]' >/dev/null \
  || fail "This FFmpeg can't draw captions (no libass). Send a screenshot of this window for help."

say "2/6  Node.js $NODE_MAJOR"
export NVM_DIR="$HOME/.nvm"
# Many people who use Claude Code in WSL already have Node.js 22; use it when present.
if [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" == "$NODE_MAJOR" && ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "Using the Node.js $NODE_MAJOR you already have."
else
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash >/dev/null
fi
set +u
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_MAJOR" >/dev/null
nvm use "$NODE_MAJOR" >/dev/null
set -u
fi

say "3/6  The CreatorClips app"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" checkout -- package-lock.json 2>/dev/null || true
  git -C "$APP_DIR" fetch --quiet origin
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

say "4/6  The video engine (Python)"
[[ -x engine/.venv/bin/python ]] || python3.12 -m venv engine/.venv
lock_stamp="engine/.venv/.requirements.lock.sha"
lock_sha="$(sha256sum engine/requirements.lock | cut -d' ' -f1)"
if [[ "$(cat "$lock_stamp" 2>/dev/null)" != "$lock_sha" ]]; then
  engine/.venv/bin/pip install --quiet --require-hashes -r engine/requirements.lock
  echo "$lock_sha" > "$lock_stamp"
fi

say "5/6  App packages"
npm_stamp="node_modules/.package-lock.sha"
npm_sha="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ ! -d node_modules || "$(cat "$npm_stamp" 2>/dev/null)" != "$npm_sha" ]]; then
  npm ci --no-audit --no-fund
  echo "$npm_sha" > "$npm_stamp"
fi
npx --no-install install-electron >/dev/null
# Electron's sandbox helper must be owned by root to run on Ubuntu.
sandbox="node_modules/electron/dist/chrome-sandbox"
if [[ -f "$sandbox" && ( "$(stat -c %U "$sandbox")" != "root" || ! -u "$sandbox" ) ]]; then
  $SUDO chown root:root "$sandbox"
  $SUDO chmod 4755 "$sandbox"
fi

say "6/6  The creatorclips command"
if ! grep -q 'alias creatorclips=' "$HOME/.bashrc" 2>/dev/null; then
  printf '\n# Update and open CreatorClips\nalias creatorclips='"'"'curl -fsSL https://raw.githubusercontent.com/trentrichards34/bridgeclip/%s/scripts/setup-wsl.sh | bash'"'"'\n' "$BRANCH" >> "$HOME/.bashrc"
  echo "Added the creatorclips command. Next time, open Ubuntu and type: creatorclips"
fi

say "Opening CreatorClips. Keep this Ubuntu window open while you use it; close the app to stop."
npm run dev
}
