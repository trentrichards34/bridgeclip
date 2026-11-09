# AI Video workspace

This folder is the AI Video Editing Skill's workspace. The user opens a chat here and asks for reels.

- For ANY request about a reel, short, TikTok, explainer or animated video (or "set up"): read and follow `skill/SKILL.md` exactly. `SKILL_DIR` = `skill/` in this folder.
- Finished and in-progress reels live in `videos/<slug>/` (the finished file is `videos/<slug>/out/<name>.mp4`). List them when the user asks "what have we made".
- First time here (or if a tool errors with a setup-looking message): run `node skill/tools/doctor.mjs` and walk the user through the fixes in plain words (see `skill/SETUP.md`). `npm install` and `npm run browser` run inside `skill/`.
- Bonus material for the user is in `bonus/` (brand-deals playbook).
- Don't edit files inside `skill/` unless the user asks you to change the skill itself. Never print API keys.
