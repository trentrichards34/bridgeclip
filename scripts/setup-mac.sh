#!/usr/bin/env bash
# Install and open CreatorClips on a Mac from its source code.
#
#   curl -fsSL https://raw.githubusercontent.com/trentrichards34/bridgeclip/feat/avatar-studio/scripts/setup-mac.sh | bash
#
# Safe to run again: it skips what is already done, updates the app and opens it. It installs
# Homebrew (if missing), Git, Node.js 22, Python 3.12 and the caption libraries; puts the app in
# ~/CreatorClips-app (your videos still go to ~/CreatorClips); builds the video engine's FFmpeg
# once (about 5-10 minutes); and adds "Open CreatorClips" to your Desktop.
set -euo pipefail
# Everything sits inside one block so bash reads the whole script before running it (safe with `curl | bash`).
{

REPO_URL="${CREATORCLIPS_REPO:-https://github.com/trentrichards34/bridgeclip.git}"
BRANCH="${CREATORCLIPS_BRANCH:-feat/avatar-studio}"
APP_DIR="${CREATORCLIPS_DIR:-$HOME/CreatorClips-app}"
LAUNCHER="$HOME/Desktop/Open CreatorClips.command"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "CreatorClips runs on a Mac. This computer is not a Mac."
arch="$(uname -m)"
macos_major="$(sw_vers -productVersion | cut -d. -f1)"
if [[ "$arch" == "arm64" && "$macos_major" -lt 14 ]] || [[ "$arch" == "x86_64" && "$macos_major" -lt 15 ]]; then
  fail "CreatorClips needs macOS 14 Sonoma or newer on Apple silicon (M1 and later), or macOS 15 Sequoia or newer on Intel. Update macOS in System Settings, then run this again."
fi

say "1/7  Apple's command line tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  fail "A window opened to install Apple's command line tools. Click Install, wait for it to finish, then paste the same command again."
fi

say "2/7  Homebrew"
if ! command -v brew >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/brew && ! -x /usr/local/bin/brew ]]; then
  echo "Homebrew installs the tools CreatorClips needs. It will ask for your Mac password."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
fi
if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; else eval "$(/usr/local/bin/brew shellenv)"; fi

say "3/7  Git, Node.js 22, Python 3.12 and caption libraries"
packages=(git node@22 python@3.12 pkg-config libass)
[[ "$arch" == "x86_64" ]] && packages+=(nasm)
for package in "${packages[@]}"; do
  brew list --versions "$package" >/dev/null 2>&1 || brew install "$package"
done
node_bin="$(brew --prefix node@22)/bin"
python_bin="$(brew --prefix python@3.12)/bin"
export PATH="$node_bin:$python_bin:$PATH"
PYTHON="$python_bin/python3.12"

say "4/7  The CreatorClips app"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" checkout -- package-lock.json 2>/dev/null || true
  git -C "$APP_DIR" fetch --quiet origin
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

say "5/7  The video engine (Python)"
[[ -x engine/.venv/bin/python ]] || "$PYTHON" -m venv engine/.venv
lock_stamp="engine/.venv/.requirements.lock.sha"
lock_sha="$(shasum -a 256 engine/requirements.lock | cut -d' ' -f1)"
if [[ "$(cat "$lock_stamp" 2>/dev/null)" != "$lock_sha" ]]; then
  engine/.venv/bin/pip install --quiet --require-hashes -r engine/requirements.lock
  echo "$lock_sha" > "$lock_stamp"
fi

say "6/7  FFmpeg with captions (first time only, about 5-10 minutes)"
if [[ ! -x engine-bin/ffmpeg || ! -x engine-bin/ffprobe ]]; then
  bash scripts/build-ffmpeg-mac.sh engine-bin
fi

say "7/7  App packages"
npm_stamp="node_modules/.package-lock.sha"
npm_sha="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
if [[ ! -d node_modules || "$(cat "$npm_stamp" 2>/dev/null)" != "$npm_sha" ]]; then
  npm ci --no-audit --no-fund
  echo "$npm_sha" > "$npm_stamp"
fi

if [[ ! -f "$LAUNCHER" ]]; then
  cat > "$LAUNCHER" <<LAUNCH
#!/bin/bash
# Updates CreatorClips to the newest version, then opens it. Keep this window open while you use the app.
curl -fsSL https://raw.githubusercontent.com/trentrichards34/bridgeclip/$BRANCH/scripts/setup-mac.sh | bash
LAUNCH
  chmod +x "$LAUNCHER"
  echo "Added \"Open CreatorClips\" to your Desktop. Double-click it any time to update and open the app."
fi

say "Opening CreatorClips. Keep this Terminal window open while you use it; close the app to stop."
npm run dev
}
