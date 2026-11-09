# Self-review: check your own render before the user sees it

You can't watch video, but you can look at frames. Do this every reel.

## 1. Stills sheet (fast, run it many times)
```
node "$SKILL_DIR/tools/reel.mjs" stills <project> <times...>
```
Pick times from `build/word_index.txt`:
- the middle of every beat,
- 0.1 s and 0.4 s after every scene change,
- the hook at 0.0 s and 0.8 s,
- the moment each key word is spoken,
- the last 0.5 s.
Then open `<project>/stills/sheet.jpg` (and single stills in `stills/` for detail) and check:

| Check | Fix |
|---|---|
| Frame 0.0 shows something interesting (not empty paper / a black screen) | start the hook visual at t=0 |
| One focus per frame (newest element: accent + pointed at), understandable in half a second | demote the others (smaller, no accent, settled) |
| The stage is full mid-beat (3-6 elements, 60-80% of the hero zone), not one small object on empty paper | add the earlier elements back, keep them on stage, scale the focus up |
| Every landed element has an idle life (compare two stills 0.6 s apart: something changed everywhere) | add secondary motion (ticking, swing, roll, typing, idle float) |
| Text readable (≥ 40 px), not clipped, not overlapping other text | resize, re-wrap, move |
| Signs, cards and words fully inside the frame (no "AKERY" cut at the edge), unless deliberately mostly off-frame | pull the camera back, shrink or move the object |
| Nothing important under the bottom 300 px / right 120 px | move it up/left |
| Captions don't cover the hero; emphasis word is the right one | adjust caption zone/emphasis list |
| Highlights sit exactly on their targets | align at full size (`--scale 1`) |
| Presenter (classic) points at the current hero, not at empty space | re-aim pointing target |
| Colors: accent used only for the key thing | tone others down |
| Matches the style guide's look (compare with library stills) | follow the tokens |
| A real company/place/product/food is recognisable at its on-screen size (real proportions, signature details, 3 tones + highlight, some life); a video on a phone is visibly PLAYING (compare two stills 1 s apart: different shot) | guides/illustration.md checklist |
| No placeholder text, no "undefined", no NaN, no missing images (grey boxes) | fix the data/asset path |

## 2. Draft video (low-res, fast)
```
node "$SKILL_DIR/tools/reel.mjs" video <project>        # build/draft.mp4
```
Grab frames around every transition and big moment:
`ffmpeg -v error -ss 4.2 -i build/draft.mp4 -frames:v 1 stills/check_4.2.jpg` (or tile several: `-vf "fps=4,scale=270:-1,tile=6x2" -frames:v 1`).
Look for: pops (an object appearing/vanishing with no animation), jumps at scene hand-offs (end state of scene N ≠ start state of N+1), dead stretches (> 1.2 s with no change), things moving too fast to read.

Then measure the motion (mandatory before the final):
```
node "$SKILL_DIR/tools/reel.mjs" motion <project>
```
It must print PASS (classic: motion ≥ 4.8, big/s ≥ 0.65, flat ≤ 27%). For every flat stretch it lists, open the storyboard line for
those words and add what is missing: a build-up event on the stressed word, secondary motion on the elements already there, a camera
lean/push, a presenter mood. Re-render the draft and re-run until PASS. Never go to the final with a failing motion check.

**Stills-only runs** (the user forbids video renders, or the laptop can't take one): `reel motion` needs the draft video, so check
density on stills instead. Render a still every 0.6 s through the whole reel plus one 0.1 s after every stressed word (`--out density`,
`--scale 0.5` is enough) and check two rules: something new or changed on every stressed word (compare it with the still before the
word), and no 1.2 s window in which two consecutive stills look the same (same elements in the same states, only idle wobble: a flat
stretch, fix it as above). Tell the user at delivery that motion is unverified
(no draft, no `reel motion`) and offer to run it later.

## 3. Audio
- `reel.mjs export` mixes and muxes. Check `build/sfx.json` is not crowded (≤ ~1 cue per 0.5 s on average).
- If a word is mispronounced, re-voice with a phonetic spelling in script.txt (e.g. "Supa-base"), then re-cue scenes (words.json changes).

## 4. Final
Only when stills + draft are clean and `reel motion` passes: `reel.mjs video <project> --final` then `reel.mjs export <project>`. Spot-check 3 frames of `out/<name>.mp4` at full size.

Tell the user briefly what you checked and fixed ("fixed overlapping text in beat 3, moved the CTA up out of the Instagram UI").
