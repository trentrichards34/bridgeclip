# AI Video Editing Skill: start here

Make ready-to-post 1080×1920 reels from one prompt. Claude writes the script (or uses yours), voices it, animates every scene, checks its own work and exports the mp4 into `videos/`.

## 1. Open this folder in your AI
- **Claude Code** (recommended): open a terminal in this folder and run `claude`, or open the folder in the Claude desktop app's Code tab.
- **Codex**: run `codex` in this folder.
- **Cursor**: File → Open Folder → this folder, then use Agent mode.

## 2. Say: "set up the AI video skill"
Claude checks your computer and walks you through anything missing, one step at a time (Node.js, ffmpeg, Python, a private browser for rendering, your ElevenLabs voice key, picking a voice). About 10 minutes, once. Details: `skill/SETUP.md`.

## 3. Ask for a reel
- "Make a reel about 3 Notion templates every freelancer needs."
- "Make a 3D explainer: how wireless charging actually works."
- "Use my script, cute voxel style: <paste your script>"
- "Make my presenter look like me" (send a photo or describe yourself)

Your video appears in `videos/<topic>/out/`. Each reel takes Claude roughly 30-80 minutes: it builds custom visuals scene by scene and reviews its own frames.

## What's in here
- `videos/`: your reels
- `bonus/`: how to land brand deals (playbook)
- `skill/`: the engine, guides and tools Claude uses (you don't need to touch it)

License: `skill/LICENSE.txt` (use it for yourself and clients; don't resell or share the skill).
