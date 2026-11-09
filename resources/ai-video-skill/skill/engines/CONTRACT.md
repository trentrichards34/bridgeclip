# Engine contract (for whoever packages or extends an engine)

The skill ships three engines. Each is a self-contained renderer that Claude drives by writing scene files.
Shared tooling lives in `tools/` and must stay engine-agnostic.

| style | look | tech |
|---|---|---|
| `classic` | cream paper, ink + one orange-red accent, halftone print texture, word-by-word captions with serif-italic emphasis, cartoon presenter bust bottom-right that points at the content | Canvas 2D (two layers + WebGL halftone shader) |
| `explainer3d` | 3D "how it works" explainers: studio or golden-hour city, soft PBR shading, bloom, whip-pan cuts between stations, grey→white captions with one blue key-word box | three.js WebGL |
| `voxel` | felt-toy voxel diorama world, little procedural people, warm key light, depth of field, hard camera cuts on words, chunky bubble captions | three.js WebGL |

## Folder layout (per engine)

```
engines/<style>/
  core/        engine code, served at /engine/core/...  (never edited per reel)
  kits/        reusable prop/character libraries, served at /engine/kits/...
  template/    copied into every new project by `reel new`  (index.html, reel.json, plan/timeline, 2-3 example scenes, script.txt)
  tools/       optional engine-specific helpers
guides/styles/<style>.md   THE style guide Claude reads before writing scenes (look, tokens, API, scene contract, recipes, review checklist)
library/<style>/           real scenes from the creator's reels (de-branded) as reference code + INDEX.md
```

## The page contract (tools/reel.mjs relies on exactly this)

The project's `index.html` (from the template) is served over http by `tools/serve.mjs`:
- `/engine/...` → `engines/<style>/`, `/fonts/...` → `fonts/` (load `/fonts/fonts.css`), `/skill/...` → skill root, everything else → the project folder.

It must define:
- `window.READY`: a Promise that resolves once fonts, assets, words and all scenes are loaded and ready.
- `window.DURATION`: output length in seconds (normally: last word end + a short tail; the plan may extend it).
- `window.renderAt(t)`: draws output time `t` (seconds). Pure function of t (no wall clock, no Math.random; seeded RNG only), so frames can be rendered in any order. May return a Promise.
- `window.CAPTURE`: `'canvas'` (frame = `<canvas id="c">`, 1080×1920) or `'screenshot'` (WebGL + DOM overlays; the page is captured).
- `window.SFX` (optional): `[{t, name, gain}]` sound cues for `tools/mix.py` (names: whoosh swoosh pop click tick ding thud impact boom shimmer riser type cash stamp). Do not ship audio files for SFX.

Query params: `?t=3.5` (draw one frame), `?play` (real-time playback, with `audio/vo.mp3` playing in sync on click), `?only=<sceneId>` (only that scene, for fast checks).

## Inputs a project always has
- `build/words.json`: `[{"w","s","e"}]` word timings on the final audio clock (from `tools/tts.py`). Load it with fetch at runtime; no extra build step.
- `audio/vo.mp3`, `script.txt`, `reel.json` (`{style, name, voice?, cta: {keyword}, presenter?, ...}`).
- Scenes cue on WORDS, never on hard-coded seconds: a helper like `wordAt('fingertip', fromT, nth)` / `wi(index)` with a sensible fallback.

## Rules
- Fonts only from `/fonts/` (all OFL). Put `"Fallback"` (on-demand non-Latin fonts) before any generic family in every font stack. Display fonts: `Nunito` 900 (chunky rounded), `Playfair Display` (bold serif), `Figtree` (geometric sans).
- No absolute paths, no machine-specific tools, no personal handles, no third-party brands or logos, no third-party footage, no music or SFX files (the mixer synthesizes SFX).
- Deterministic, 1080×1920, safe zones: Instagram UI covers the bottom ~300 px and right ~120 px; keep key content above y≈1400 (in screen space) and inside x 60..1020.
- Clarity over density: one hero object per beat, text ≥ 40 px on screen, readable states held ≥ 0.4 s.
