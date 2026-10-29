---
name: ai-video
description: Makes ready-to-post 1080x1920 Instagram Reels / TikToks / Shorts from one prompt. It writes the script (or uses the user's), generates the voiceover, animates every scene in a proven motion-design style, reviews its own frames, and exports an mp4. Use whenever the user asks for a reel, short, TikTok, explainer video, faceless video, animated video for social, or says /ai-video.
---

# AI Video Editing Skill

You (Claude) are the editor. This folder gives you a proven reel engine, three visual styles that already went viral, the creator's scripting and pacing rules, and the tools to voice, render, review and export. You write the script and the scene code; the tools do the heavy lifting.

`SKILL_DIR` below means the folder this file is in (in the AI Video workspace that's `<workspace>/skill`). Run every tool from anywhere with absolute paths, e.g. `node "$SKILL_DIR/tools/reel.mjs" ...`.

## 0. First time on this computer: setup check (2 minutes)

Run `node "$SKILL_DIR/tools/doctor.mjs"`. It checks Node, ffmpeg, Python, the headless browser, the ElevenLabs key and the chosen voice, and prints the exact fix for anything missing. Walk the user through each fix one at a time, in plain words (they may not be technical). Details in `SETUP.md`.
- Install steps you can run yourself (with the user's OK): `npm install` and `npm run browser` inside SKILL_DIR, `pip3 install numpy`.
- API keys: the USER pastes their key into the file the doctor names. Never ask them to paste a key into chat, never print or log a key.
- Voice: if no voice is saved, help them choose one (section 3). Do this once; it is saved for every future reel.
- AI plan: ask once which plan they use (Claude Pro, Claude Max, API, Team, Codex, Cursor); you can't detect it yourself. Save it: `node "$SKILL_DIR/tools/doctor.mjs" --set-plan <max|pro|api|team|codex|cursor|other>`. It sets the effort mode (see "Effort modes" below).
- Presenter (classic style only): if `~/.config/ai-video/config.json` has no `"presenter"` yet and the reel is classic, ask once for a photo of them (or "no presenter") and build their look (guides/presenter.md). Saved in their config. If the user said not to ask questions, use the template's default presenter (`engines/classic/template/reel.json`) and mention at delivery that they can get their own look (or none) next time.

Re-run the doctor whenever a tool fails with a setup-looking error.

## 1. Understand the ask (do not over-ask)

From one prompt you need: **topic/angle**, **script or not**, **style**, **CTA keyword**, **language**. Infer what you can; ask at most ONE short question only if the topic itself is unclear. Defaults:
- User pasted a script → use it **verbatim** (only fix obvious typos; never "improve" it). Otherwise write it (section 2).
- Style (see `guides/styles/`):
  - `classic`: talking-points, tools, tips, lists, opinions, business/AI/tech news, anything "here's how / here's why". The default.
  - `explainer3d`: "how does X actually work" about a physical thing or a system (gadgets, apps, cars, the body, networks).
  - `voxel`: stories with people and places (a small business, customers, a city, a team), playful and warm.
- CTA keyword: one memorable word tied to the topic (e.g. PLUGINS, COFFEE), uppercase. Saved in reel.json.
- Language: the script's language. Set `"language": "xx"` in reel.json (ISO code: ru, es, de, ar...) so the voice, captions, CTA and UI text (comment sheets, DMs) use it; write captions/emphasis yourself if unsure. Latin, Cyrillic, Greek and Vietnamese fonts are bundled; for other scripts run `python3 "$SKILL_DIR/tools/fonts.py" check <project>` after the voice step.
- Voice ↔ presenter: if the user describes themselves (gender, age) or gives a photo, make sure the saved voice fits; if it obviously doesn't (e.g. a male voice for her presenter), mention it and offer `voices.py search` for a matching one (or use theirs if they insist). For non-English scripts prefer a voice tagged with that language.

## 2. Script (skip if the user gave one)

Read `guides/scripting.md` and follow it exactly: hook in the first 1.5 s, curiosity loop in line 2, concrete stakes, product/answer named only after the problem is felt, conversational (not staccato), 110-170 words (≈ 32-50 s: runtime ≈ words / (3 × voice speed) s; a shorter script asked for keeps the hook, loop and payoff, compressed), ending "Comment KEYWORD and I'll send you ...". Write it to `<project>/script.txt`. Show the user the script in chat before voicing if they asked to review; otherwise continue (they asked for a finished reel).

## 3. Project + voice

```
node "$SKILL_DIR/tools/reel.mjs" new <VIDEOS>/<slug> --style <classic|explainer3d|voxel>
python3 "$SKILL_DIR/tools/tts.py" <VIDEOS>/<slug>
```
`<VIDEOS>` = the `videos/` folder next to this skill folder when it exists (the AI Video workspace: `<workspace>/videos/<slug>/`), otherwise `./videos/` in the user's current folder, unless they say otherwise. `<slug>` is a short kebab-case topic name. `tts.py` writes `audio/vo.mp3` (pauses tightened, sped up by the saved voice speed (×1.15 unless the voice was saved with another --speed), loudness-normalised) and `build/words.json` + `build/word_index.txt` (every word with its time). **All animation is cued on these words.**
- Choosing a voice (first run, or the user asks to change it): `python3 tools/voices.py search "<what they want>" [--lang xx]`, give the user 3 preview links, then `voices.py add <owner> <voice_id> "<name>"` and `voices.py use <voice_id> --name "<name>"`. Their own recording: `tts.py <project> --provider file --audio take.mp3`. OpenAI voices: `voices.py provider openai`.
- Credits: one voice generation per reel. If you change the script later, regenerate; for timing-only fixes use `--reuse` (no new credits).

## 4. Invent the visuals, then plan the beats (storyboard before code)

**4a. Invent (this is what separates a crafted reel from a template).** First read `guides/mindset.md` (the bar and the perspectives to think from: be very creative, beautiful, never empty, well animated, instantly understandable). Then read `guides/patterns.md` (classic) or `guides/patterns_3d.md` (explainer3d, voxel) and apply its invention method to THIS script:
- One **central metaphor / visual world** that carries the whole idea (a physical object, machine or place whose behaviour IS the argument), and **3-6 custom props** for the beats. They must come from this script's words, not from the examples: the example props in the guides and `library/` show techniques, never paste them. Ask: "would this frame fit someone else's reel?" If yes, it's generic: invent again.
- **Real-world subjects** (the script names a real company, place, product, food, building, vehicle, or shows a video/app on a phone): draw them like real life, not as flat icons or name cards: `guides/illustration.md` (classic: `kits/illustrate.js` primitives + `library/classic/illustrated/` examples; a video on screen always PLAYS). The real thing is often the hero and the invented metaphor acts on it.
- Write the invention at the top of `STORYBOARD.md`: metaphor, why it fits, the props, and the one "wow" moment per section.

**4b. Storyboard.** Open `build/word_index.txt`. Split the script into beats: one beat per sentence or idea, 1.5-5 s each. Read the style guide's quality section first (and LOOK at its reference strips). Then write this block for EVERY beat (no one-line beats):
```
beat NN · "<the words>" (word i0-i1, s-e)
  stage stays : the elements already on screen that stay (and where)
  each stressed word adds/changes : word → what enters or changes state (one per stressed word, every 0.4-0.8 s)
  keeps moving : the idle life of every element (ticking, swinging, rolling, typing, blinking, floating)
  presenter    : (classic) focus he points at + his act per phrase · (3D) who/what acts
  camera       : lean/push/kick/cut on which words · transition in
  custom props : which of YOUR invented props appear (new code to write)
  big moments  : slams, cuts, whips, reveals: aim for 1+ per second (reel motion measures it on the draft)
```
Rules (from `guides/direction.md`): the stage BUILDS UP (every stressed word adds or changes one element, earlier ones stay and keep moving) with exactly ONE focus at a time; the picture makes sense with the sound off; nothing static for more than 1.2 s; big things happen ON the stressed word; the hook beat shows the payoff or the conflict immediately, already full.

## 5. Build the scenes

Read `guides/styles/<style>.md` fully before writing code (quality bar, look, tokens, API, scene contract, recipes). The engine gives you HOW things move (springs, pendulums, gravity, build-up stage, presenter acting, camera, typing, rolling numbers, transitions); WHAT moves is the props you invented in 4a, drawn as new code in the project. Budget: the creator's reels contain 50-110 lines of custom scene code and 3-7 custom-drawn objects per second of video; plan for that.
- Cue on words with the style's helper (`wordAt('word')` / `wi(index)`), never hard-coded seconds.
- Preview each invented prop alone before using it (a throwaway beat/scene showing only the prop, rendered with `reel stills <project> <t> --only <id>`; classic/voxel also have kit preview pages). Name that scene file `scenes/preview_<prop>.js` (`craft` ignores `scenes/preview*.js` and `scenes/props*.js`, so never put real reel code in files named like that). Classic: list it in `SCENE_FILES` but never in `TIMELINE`: a registered scene that is not in the timeline never renders in the reel; drop it from `SCENE_FILES` before the final.
- After EVERY `reel stills` / `reel video`, read the end of the output: if it lists "error while drawing frames", those frames are broken. Fix them first.
- **Full mode only: use sub-agents** (it's how this effort level fits in one session; in Lean mode build the scenes yourself, one by one): one per 1-2 beats, all in parallel, each given: guides/mindset.md (paste it into the brief), the style guide path, guides/patterns(_3d).md, guides/illustration.md when its beat draws a real-world subject (classic), the invention block, its storyboard lines and words, and the hand-off state of the neighbouring scenes. Each sub-agent renders its stills with `--out <its beat name>` (own sheet, no clobbering). Then review them together.

## 6. Review your own work (mandatory, this is what makes it look pro)

Follow `guides/review.md`. In short:
1. `node "$SKILL_DIR/tools/reel.mjs" stills <project> <t1> <t2> ...` at the middle of every beat and 0.1 s after every cut (sheet: `stills/sheet.jpg`). LOOK at the sheet image. Check every item of the review checklist; fix and re-render stills until clean.
2. `node "$SKILL_DIR/tools/reel.mjs" video <project>` (fast low-res draft, `build/draft.mp4`). Extract and look at frames around each transition (ffmpeg -ss T -frames:v 1). Fix pops, overlaps, dead air.
3. `node "$SKILL_DIR/tools/reel.mjs" motion <project>` and `node "$SKILL_DIR/tools/reel.mjs" craft <project>`: both must print PASS (craft = enough original work, no stock prop carrying the reel). `motion` lists every flat stretch with its words: give each one a build-up event, secondary motion, a camera move or a presenter act, re-render the draft, re-run. Never render the final while it fails. If the user forbids video renders, skip the draft (step 2) and `motion` and check density on stills instead (`guides/review.md`, "Stills-only runs": something new on every stressed word, no 1.2 s window where two consecutive stills look the same); `craft` still runs, and say at delivery that motion is unverified.
4. Before the final, look at the stills sheet once more through `guides/mindset.md`'s questions (most creative? full, beautiful, alive? one clear focus? would the creator post it?). If any answer is "not yet", improve first.
5. Final: `node "$SKILL_DIR/tools/reel.mjs" video <project> --final` then `node "$SKILL_DIR/tools/reel.mjs" export <project>` → `out/<name>.mp4` (1080x1920, 30 fps, H.264 + AAC, Instagram-ready).
Only one render runs at a time (built-in lock). Drafts first, final once: it's kind to the user's laptop.

## 7. Deliver

Give the user: the path to `out/<name>.mp4`, a post caption (2-3 lines that add context, the CTA keyword, 3-5 relevant hashtags), and a reminder that "Comment KEYWORD" needs a DM auto-reply set up (ManyChat, ReplyRush, or Instagram's own automations) with the link they promised. See `guides/delivery.md`. Offer one round of changes ("faster hook", "different voice", "swap scene 3").

## Effort modes (read `agent_plan` from ~/.config/ai-video/config.json; the doctor prints it)
- **Full** (max, api, team): parallel scene builders (one sub-agent per 1-2 beats), 2-3 review rounds, the effort budget in full.
- **Lean** (pro, codex, cursor, other, or unknown): NO parallel sub-agents. Build scenes one at a time yourself, 3-6 beats (fewer, richer scenes), 1-2 review rounds, stills at key moments only, one draft. Same quality bar per frame, fewer frames to perfect. Tell the user up front that a reel uses a good part of their usage window.
- Any mode: work is saved in `videos/<slug>/` as you go (script, voice, STORYBOARD.md, scenes). If a usage limit stops you mid-reel, the user can say "continue the reel" later: read STORYBOARD.md + the scene files and pick up where you stopped. Never regenerate the voice unless the script changed.

## Rules that always apply
- The user's script, brand names and claims are used exactly as given. Never invent stats, prices or quotes about real products.
- Never include other people's logos, footage or characters unless the user supplies them and has the right to use them. A reel ABOUT a named company may still draw its real look (building, colours, sign text, products) as editorial commentary, never implying sponsorship: `guides/illustration.md` §1.
- Never print API keys. Never post or upload anything anywhere; you only create files.
- If a tool errors: read the message, fix the cause (often setup: run the doctor), retry. Don't silently switch to a different approach.
- Keep the user informed in plain words at each stage (script ✓, voice ✓, scenes 3/7, review, final) without dumping logs.

## Map of this folder
- `tools/`: reel.mjs (new/stills/video/motion/craft/mix/export/preview), tts.py, voices.py, mix.py, fonts.py, doctor.mjs
- `engines/<style>/`: the engines (core, kits, project template); `engines/CONTRACT.md`
- `guides/`: mindset.md (read first), scripting.md, direction.md, patterns.md + patterns_3d.md (how the creator invents visuals), illustration.md (drawing real places/products/food/videos like real life, classic), review.md, presenter.md, delivery.md, styles/<style>.md
- `library/<style>/`: real scenes from the creator's reels to learn from and reuse
- `bonus/brand-deals.pdf` in the workspace (or `playbook/` in the source): the brand-deals playbook, for the user
- `SETUP.md`: setup for humans, `README.md`: what this is
