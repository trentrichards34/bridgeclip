# Setup (one time, ~10 minutes)

You don't need to code. After step 2, Claude can check everything for you: just say **"set up the AI video skill"**.

## 1. Open the AI Video folder in your AI

**Easiest (recommended):** open the whole `ai-video` folder (the one with `START HERE.md`) in your AI and chat there:
- **Claude Code**: run `claude` in a terminal inside the folder, or open it in the Claude desktop app's Code tab.
- **Codex**: run `codex` inside the folder.
- **Cursor**: File → Open Folder → the `ai-video` folder, Agent mode.
The folder's `CLAUDE.md` / `AGENTS.md` tell the AI where everything is; reels are saved in `videos/`.

**Alternative (use it from any folder):** copy just the `skill` folder to your AI's skills folder, named `ai-video`:
`~/.claude/skills/ai-video` (Claude Code) or `~/.codex/skills/ai-video` (Codex). Reels then go into `videos/` in whatever folder you're working in.

## 2. Install the tools (Claude can run these for you)

You need: **Node.js 18+**, **ffmpeg**, **Python 3**.
- Mac: install Homebrew (https://brew.sh), then `brew install node ffmpeg python`
- Windows: `winget install OpenJS.NodeJS.LTS Gyan.FFmpeg Python.Python.3.12` (reopen the terminal after)
- Linux: `sudo apt install nodejs npm ffmpeg python3 python3-pip`

Then, inside the `skill` folder:
```
npm install
npm run browser
python3 -m pip install numpy
```
(`npm run browser` downloads a private headless Chromium, ~100 MB. Your normal browser isn't touched.)

## 3. Voice (ElevenLabs)

1. Make a free account at https://elevenlabs.io (the free plan covers a few reels a month; Starter is cheap if you post daily).
2. Create an API key: Settings → API Keys → Create. Give it **Text to Speech** and **Voices** access (and "User: read" if you want the credits check).
3. Save the key as one line in this file (create the folders if needed):
   - Mac / Linux: `~/.config/ai-video/elevenlabs.key`
   - Windows: `C:\Users\<you>\.config\ai-video\elevenlabs.key`
   Don't paste your key into the chat.
4. Ask Claude: **"help me pick a voice"**. It searches the voice library, sends you previews, and saves your pick.

Prefer your own voice? Record a take and say "use my recording". Prefer OpenAI voices? Say "switch the voice provider to OpenAI".

## 4. Check
```
node tools/doctor.mjs
```
Everything ✓? Ask for your first reel: **"Make a reel about 3 Notion templates every freelancer needs"**.

## Troubleshooting
- `headless browser` ✗ → run `npm run browser` again inside the skill folder.
- `ffmpeg` not found right after installing → close and reopen the terminal.
- ElevenLabs `401` → the key is wrong or out of credits; make a new key.
- The fan gets loud → normal during the final render (a minute or two). Drafts are low-res on purpose, and only one render runs at a time.
