# Classic style guide (orange print look + pointing presenter)

Read this whole file before writing a classic scene. It is the contract between you and `engines/classic/`.

**What it looks like:** warm cream paper with a fine printed dot texture. Everything is drawn like a risograph/newsprint editorial:
crisp ink type and outlines on top, soft **halftone dot** shadows underneath, and exactly **one accent colour** (orange-red `#FF3B1F`)
for the thing that matters. White UI cards with hairline borders and mono `// labels`. Big word-by-word **captions** top-left in
Space Grotesk, with the key word in *Instrument Serif italic* in the accent colour. A flat-vector cartoon **presenter bust** sits in
the bottom-right corner and **points at the hero object the whole time**, changing gesture and expression every phrase.
Motion is springy and physical: things slam in, squash, overshoot, settle; one camera "kick" per big beat; scene changes are hard cuts
on a word (sometimes a halftone dot wipe).

Look at real frames first: `node tools/reel.mjs stills <project> 1 3 5 --only presenter` shows the presenter, the template scenes show
the cards, and `library/classic/INDEX.md` lists the creator's real scenes (read their header comments: that is the storytelling grammar).

---

## 0. Quality bar (read before writing any scene)

The creator's reels move at **motion 5.0-7.8 / big 0.7-1.6 per second**. A reel built from "one object per beat on empty paper" measures
~3.8 / 0.3 and looks like a slideshow. Open these strips of his reels before you plan anything (Read the JPGs; each frame ≈ 0.5-1 s apart):

| strip | what to notice |
|---|---|
| `guides/styles/classic_ref/reelA_hook.jpg` | 0-8 s: to-do laptop + clock + task stack + EFFORT gauge HIGH→MAX→BROKEN + NOT THE FIX stamp, all on ONE stage in 3 s; then a clothesline where an ID badge drops and swings per job word; halftone dot wipe out |
| `guides/styles/classic_ref/reelB_hook.jpg` | phone + "0 users" card side by side; the presenter becomes the hero: REC brackets close on his face, red glow behind him, hand over mouth, sweat; a prompt box types, a video scrubber runs |
| `guides/styles/classic_ref/plugins_strip.jpg` | (captions cropped) a dead power strip is the physical metaphor; the counter 0/4, the LED and the presenter carry the hook |
| `guides/styles/classic_ref/vibewise_strip.jpg` | code window + skill chips; a balance beam that tips; a concept card bursting out of a word; lanes racing |
| `guides/styles/classic_ref/onegtm_strip.jpg` | job post → offer letter $85,000 with paper bills → calendar flipping months → $22,000 in a red glow: every stressed word changes the stage |

### The principle: a stage that BUILDS UP
A scene is a **stage**. Every stressed word **adds one element or changes one element's state** (a new card lands, a needle jumps a
level, a counter rolls, a stamp slams, a badge drops, a plug goes in). **Earlier elements stay** (moved aside, a bit smaller) **and
keep living** (ticking, swinging, scrolling, blinking). After 2-3 s the frame is FULL (3-6 elements), yet the eye always knows where to
look, because **there is exactly ONE focus**: the newest element, the one that just moved, is accent-coloured and is being pointed at.
"One hero per beat" never meant "one small object alone on empty paper"; it means **one focus at a time on a full, building stage**.

### Required density (every scene, check it in the storyboard and with `reel motion`)
- **An event on every stressed word**, ≈ every **0.4-0.8 s**: something enters or changes state. Unstressed stretches still have motion.
- **Something big ≥ 0.7 times per second** on average: a slam/drop, a stamp, a topple, a cut, a whip, a dot wipe, a big counter roll,
  the presenter stepping in. (Big = a large part of the frame changes.)
- **Nothing is static for more than 1.2 s.** Every element that has landed keeps an idle life (see catalogue). A frozen frame = flat.
- A kick (`kick`) on the 1-2 biggest moments of each scene, not on every event.
- Measure it: `reel motion <project>` must PASS: motion ≥ 4.8, big/s ≥ 0.65, flat ≤ 27%. It lists every flat stretch with its words.

### Composition
- **Full stage, single focus.** Mid-beat the hero zone (y 540-1320) is 60-80% covered: 1 focus element (360-800 px wide, the
  newest) + 2-5 supporting elements (200-420 px) that arrived earlier. The focus gets the accent, the pointer and the camera lean;
  older elements step back (`moves` to the side, scale 0.75-0.9, dimmed header colour) but don't vanish until the stage resets.
- **Stage reset = a cut or a transition** (every 1-3 sentences): the old stage falls / flies away / wipes, a new one starts building.
- Zones (scene space): captions top-left; a top band y 540-760 (hanging rows, pills, small live props); the middle y 760-1150 (the focus); a left
  column x 60-560 down to y 1400 for things that GROW (tower, stack, toasts); the right column x 640-1000 only down to y ≈ 1150
  (the presenter's head is below). Never a persistent bottom-left "through-object" card.
- Text: what must be READ is ≥ 40 px; mono labels, timestamps, statuses at 20-28 px are texture (they make it look real) and fine.
- Highlights sit exactly on their target. Accent on the newest/most important thing only.

### Secondary-motion catalogue (give EVERY landed element one)
ticking second hand / whirling minute hand · swinging badge or plug (pendulum) · tower sway that grows with height · rolling numbers
and odometers · live sparkline + pulsing end dot · blinking REC dot / LIVE pill / caret · typing text, streaming reply dot · video
playhead · spinner on a task row · notification stack pushing down · status line counting ("on a call 0:14", "12 tickets") · needle
straining at MAX with sparks · power dots flowing along a cable · idle float (`idleSway`, the stage does it for you).

### The presenter is an actor (and sometimes the hero)
- He **points at the focus constantly** (re-aims when the focus moves; `act({focus: t => ST.focus(t)})` does it) and **acts every
  phrase**: panic (hand over mouth + sweat + red glow), shock (hands to face, O mouth, jerk back), thinking, celebrate (both fists,
  bounce, confetti), lean in on the key reveal, shrug, facepalm, wave, thumbs + wink. Use `mood()` presets (section 12b).
- **Presenter as hero** (1× per reel, on a personal line: "you're scared", "you hide", "I did this"): he steps to the centre and
  grows (`heroAt` / mood `'hero'`), REC viewfinder brackets close on his face (`recFrame`), red glow behind him, he panics. The content
  steps aside for those 1.5-2.5 s.
- Clones of the presenter inside cards (ID badge photos) make abstract roles personal: draw `PRESENTER.draw(T, K, guyState(...))`
  clipped into your own card (the studied example `library/classic/props/clothesline.js` shows how).

### Invent the metaphor (every reel, no stock props)
Every reel **invents its own central metaphor** from its script and draws **2-5 custom props** for it, right in its scene files.
The creator never reuses a prop between reels: "4 plugins" became a power strip, "you do 6 jobs" a clothesline of ID badges,
"scared to show your face" a REC viewfinder on the presenter. His reels carry 52-111 lines of custom scene code per second; reels
assembled from finished props carry ~13 and all look the same. The engine therefore ships **motion primitives only**
(`kits/mechanics.js`: springs, pendulums, gravity, idle life, the build-up stage, acting, generic live UI): they are for HOW things
move; WHAT moves is yours. The method (find the metaphor in the script's own words, list its parts, give each word a physical
reaction) and the effort budget are in **`guides/patterns.md`**. Studied example props (`library/classic/props/`: gauge, alarm clock,
tower, clothesline, power strip, lever) show the techniques (overshoot values, physics, idle life): study them, never paste them.
The template's hook/middle props are plain placeholders inside a `// ── THIS REEL'S METAPHOR ... ──` block: replace that block.
Physics makes any prop read: things fall with gravity, overshoot and settle, swing as pendulums, squash on landing, jolt their
neighbours, and keep an idle life after they land.

### Real things, drawn like real life
When the script is about something REAL (a company, a restaurant or store, a product, a food, a city block, a floor plan, an app or
a video on a phone), draw THAT thing the way it looks in real life: isometric diorama or 3/4 view, real proportions, three tones per
surface + a highlight + an edge line, its signature details (lit windows with diners, a drive-thru lane, parked cars, a pole sign,
sesame seeds, a wire basket) and small life (traffic, walkers, steam, waving flags). Supporting real objects become die-cut stickers.
A video on a phone always PLAYS (shots cutting every ~1 s, captions, waveform), never a static card. Method, per-category details and
checklist: **`guides/illustration.md`**; primitives: `kits/illustrate.js` (section 12c); de-branded studied examples:
`library/classic/illustrated/` (restaurant, big-box store, corner lot, floor plan, burger, fries, trolley, playing mini reel).

### Transitions
Hard cut on the first word of a beat (default) · **halftone dot wipe** (`wipe(t, mode)`, 1-3 per reel: into a new section, into the
CTA) · **palette switch** for a contrasting section (`paletteFlood`, e.g. "now picture a team" in dark ink) · **carry-over morph**:
the focus of scene N becomes the first element of scene N+1 (a laptop screen morphs into a roster card, a step becomes a staircase;
`morphRect`) · **topple / fly-out**: the old stage falls (`exitMode: 'fall'`) while the new focus slams in on the same word.

### Per-beat planning template (write this in STORYBOARD.md for every beat before any code)
```
beat 03 · "You plan the perfect morning: a run, journaling, meditation and a cold shower, all before seven." (words 30-45, 8.1-13.5 s)
  stage stays : alarm clock top-right (ticking), routine tower base (left)
  each stressed word adds/changes : perfect → tower base plate slams + PERFECT MORNING sign · run → RUN 5K block drops (thud) ·
     journaling → JOURNAL block drops · meditation → block drops · cold shower → block drops, tower sways · seven → clock rings 7:00
  keeps moving : clock second hand, tower sway growing, TOTAL readout rolling up, sun icon rotating
  presenter    : points at the newest block · "perfect" lean-in · "seven" thumbs up, smug
  camera       : stageCam leans to each block; kick on "seven"
  big moments  : 6 drops + ring = ~1.1 / s ✓
```

### Do / don't (the skill's own first attempt vs the creator)
Same script, same voice, same frame times: `guides/styles/classic_ref/skill_before.jpg` (one object per beat: motion 3.8, big 0.31/s,
32% flat) vs `guides/styles/classic_ref/skill_after.jpg` (rebuilt with this section + the mechanics primitives: motion 6.6, big 0.98/s,
0% flat; its props were the creator's, which is why they now live in `library/classic/props/` as examples, not in the engine).
| don't (looks like a slideshow) | do (the creator's reels) |
|---|---|
| one stopwatch alone in the middle of empty paper for 3 s | stopwatch top-right ticking while the plan tower builds beside it and the presenter points at each new block |
| a card pops in, then nothing moves until the cut | the card lands, its rows tick in one by one, its counter rolls, a toast pushes in on the next word |
| the old object disappears, the new one pops in centred | the old object steps aside (smaller) and keeps moving; the new one slams into the focus spot |
| presenter in the corner doing the same point for a whole scene | presenter panics with a hand over his mouth, then leans in, then celebrates; once per reel he IS the hero |
| a stamp as the only "big" moment of a 4 s scene | needle HIGH → MAX → BROKEN, stamp, tower topples, camera kick, all on their words |
| "habit", "streak", "discipline" shown as a text label on a card | an object invented for THIS script that physically changes on each word (a calendar with ticks rolling, a chain of links snapping) |
| the same gauge / clothesline / tower as every other reel | 2-5 props drawn for this script, moved with the primitives (`reel craft` flags stock props) |

---

## 1. Files and commands

```
<project>/
  index.html       engine page (never edit)                 reel.json   style, name, language, cta.keyword, presenter, captions, theme, ui
  timeline.js      SCENE_FILES, cut times, TIMELINE, PHRASES, READOUT, global SFX   (you edit)
  scenes/*.js      one file per scene: an IIFE that registers SC.<key> = {...}    (you write)
  script.txt       build/words.json  build/word_index.txt  audio/vo.mp3  assets/ (your images)
engine (read-only, served at /engine/):
  core/  lib.js ui.js media.js words.js lipsync.js captions.js acting.js presenter.js halftone.js engine.js
  kits/  fx.js devices.js cards.js charts.js mechanics.js (motion primitives, build-up stage, live UI, acting presets: section 12b)
         illustrate.js (drawing primitives for real-looking places/products/food/videos: section 12c, guides/illustration.md)
library (read-only examples, NOT loaded): library/classic/props/*.js (studied example props) · library/classic/illustrated/*.js
         (real-looking subjects, de-branded) · library/classic/*.js (creator's scenes)
```
Load order: core → kits → engine boot: `reel.json` → `build/words.json` (fake timings from script.txt if missing) → `timeline.js` →
every file in `SCENE_FILES` (in order) → `TIMELINE()` → captions → lip sync → fonts + `ASSETS` images → `READY`.
All files are classic scripts sharing one global scope: top-level `const` in timeline.js is visible to scenes. Wrap each scene in
`(() => { ... })();` and prefix any helper you leave global (two scenes defining `const T_IN` at top level = crash). Never name your own
constants after engine/kit functions (`slot`, `stamp`, `glow`, `tag`, `toast`...): inside the IIFE they silently shadow the kit. The
template's own globals are `KEYWORD`, `CUT_MIDDLE`, `CUT_CTA`, `tplBeats`, `tplText`, `tplWord` (timeline.js); its scene locals are
prefixed (`CTA_SHEET`, `CTA_DM`, `CTA_BIG`, `mdSlot`).

```
node tools/reel.mjs stills <project> 0.3 1.5 3 5 7     -> stills/sheet.jpg  (LOOK at it, every time)
node tools/reel.mjs stills <project> 2 4 --only cta    -> only that scene (absolute times)
node tools/reel.mjs stills <project> 0 1 2 3 4 5 --only presenter   -> presenter sheet: 0 portrait, 1 poses, 2 expressions,
                                                       3 hairstyles, 4 act() aimed at up-left targets, 5 mood() presets + stamp
node tools/reel.mjs video <project> [--from a --to b]  -> build/draft.mp4 (half res)   --final for the real render
node tools/reel.mjs export <project>                   -> out/<name>.mp4 (voice + synthesized SFX)
URL params: ?t=3.5  ?play (click = start with audio/vo.mp3)  ?only=<sceneKey>
```

## 2. Tokens

| token | value | use |
|---|---|---|
| paper | `#F6F5F1` (shader) | the background. Never paint it yourself: leave T white |
| ink | `C.ink` `#111111` | type, outlines, icons |
| accent | `C.red` `#FF3B1F` (dark `C.redD` `#C81E0C`) | the ONE key thing per beat: emphasis words, ticks, stamps, the hot bar. Configurable: reel.json `theme.accent` |
| hairline | `HAIR` `#DDDAD2` | card borders, dividers |
| grey text | `#8a8780` | `// labels`, mono meta, done/dim states |
| card | `#FFFFFF` fill, radius 26-30, border `HAIR` 3 px, halftone shadow (blur 46, offset y 26) | every UI surface (`uiCard`) |
| warm greys | `#F3F1EC` `#E6E3DC` `#DAD7CF` `#CFCBC2` | chips, skeleton bars, empty boxes |
| dark surface | `#15161A` / `#111214` | terminals, code, one dark device per reel at most |
| tone layer | `C.k10..C.k100` greys, `C.r100 '#FF0000'` (accent dots), `'#00FF00'` (2nd ink, rarely) | shadows, glows, fills that should print as dots |

Fonts (`F`): `F.grot` Space Grotesk 500/700 (UI + captions), `F.serif` Instrument Serif (italic for emphasis, seals), `F.mono`
JetBrains Mono 500/700 (labels, readouts, code), `F.anton` Anton (stamps only). Also loaded: Inter 500-800. Never fonts from the web.
Type sizes: captions 84, card titles 40-52, body 30-36, mono labels 20-24, big figures 110-160. Nothing under 20 px; key text ≥ 40.

## 3. The two layers (the most important rule)

Every draw function gets `(T, K, t)`:
- **T = tone**: fills that become halftone dots. White = bare paper, grey = ink dots, pure `#FF0000` = accent dots. Use it for drop
  shadows, glows (`glow()`), dust (`puff()`), big soft shapes. Anything on T is *covered* by anything drawn on K.
- **K = ink**: crisp. Type, outlines, UI fills, icons, the presenter.

Consequence: inside a K card (a `panel`/`browser`/`phone` content callback) T is hidden. Use K-only drawing there: solid fills, or
`dotPattern(K, col, radius)` for printed-dot fills (the chart kit already does this). Card shadows go on T *before* the card.

## 4. Layout and safe zones (scene space)

Scene content is drawn in a 1080×1920 space that the engine scales by `SAFE_S = 0.88` around the bottom-centre (so the sides and the
right-hand Instagram buttons stay clear) and then applies the camera. Captions and chrome are drawn unscaled on top.

```
 y 150   // 0N — label  (mono 24, grey)                         READOUT k  v   (mono, v in accent when hot)
 y 330   Caption line 1 (84 px, x 130, wrap 800)   ← up to 3 lines, ends ≈ y 560 on screen
 y 520+  HERO ZONE: one card / object, x 90 … 990, y 520 … 1300 (scene space)
 y 1300+ presenter head + shoulders, bottom-right (PRESENTER_DOCK = {x 842, y 1990, s 0.8})
```
- **Presenter footprint (docked, scene space).** The top of his hair sits at y ≈ 1300 (`faceBox(PRESENTER_DOCK)` = centre 842, 1542,
  half-size 240 × 304, so its top edge is y ≈ 1240), the head spans x ≈ 610-990, the shoulders reach x ≈ 600, and his pointing
  hand moves in x ≈ 350-600, y ≈ 1400-1750. Keep the hero in y ≈ 480-1320 (520+ under 3 caption lines) and left of x ≈ 1000.
- **The bottom-left zone** (x ≈ 90-600, y ≈ 1300-1900, left of the bust) may hold ONE secondary element: a counter, a sticker, a label,
  the previous hero shrunk aside. Never the hero (it reads as "behind the presenter / under the Instagram caption"), never a persistent
  "through-object" card (the creator dislikes it), and keep its key content left of x ≈ 340 so the pointing hand doesn't cover it.
- The FOCUS element is big (360-800 px wide); it shares the stage with the 2-5 elements that came before it (see "Quality bar":
  one focus at a time on a full, building stage). Never a single small object alone on empty paper.
- **Fill the frame (the creator's #1 note: no empty space).** The hero zone is ~780 px tall: the hero's visual mass should cover
  **at least 55-70% of it**. A 300 px stopwatch or a 3-row card floating in empty paper reads as "AI slop". Scale objects up
  (stopwatch Ø 560-640, phone 520×1060, checklist rows 70-90 px tall with 40+ px text, icons 160-240 px), or stack the hero with its
  result (card + stamp, card + big number underneath). Between beats the frame is never empty: the next hero slams in on the same frame
  the old one leaves (or the old one transforms into the new one).
- **Caption zone in SCENE space.** Captions are drawn in screen space; your scene is scaled by `SAFE_S` around the bottom-centre, so
  the same y means different things. `captionBottom(t)` = the caption block's bottom in screen y; **`captionBottomScene(t)`** = the
  same line in scene y (what you compare your layout with). Formula (camera at identity): `sceneY = H - (H - screenY) / SAFE_S`,
  `sceneX = W / 2 + (screenX - W / 2) / SAFE_S` (and back: `screenY = H - (H - sceneY) * SAFE_S`). Helpers: `screenToSceneY(y, cam)`,
  `sceneToScreenY(y, cam)`. Typical values: 2 caption lines end at screen ≈ 446 = scene ≈ 245; 3 lines ≈ screen 560 = scene ≈ 375, so
  the hero zone (scene y ≥ 520) is always clear. `captionBottomScene(t, true)` also undoes this frame's camera (zoom/lean) for an
  exact fit; never call it with `true` inside your own `cam()` (it calls the camera).
- `"presenter": false` in reel.json → no bust; scenes may then use the full height (hero zone y 520 … 1500).

## 5. Captions

Automatic, from the voice: each word appears 0.3 s before it is spoken (reel.json captions.lead to change; more lead = easier to read) (0.06 s fade, 14 px rise), the old phrase lifts 40 px and fades
in 0.2 s when the next starts, phrases never cross a scene cut. Font: Space Grotesk 500, 84 px, -3% tracking, ink; emphasis words:
Instrument Serif italic ×1.16, accent, a small spring wobble.

Phrasing: `PHRASES = null` (default) splits on punctuation, pauses > 0.35 s, scene cuts and at most 6 words; emphasis = words listed in
reel.json `captions.emphasize`, the CTA keyword (in CAPS or within 3 words after the word for "comment" in the reel's language), else the
strongest word (numbers first, then the longest content word that is not a stop word of the reel's language).
**Choose emphasis yourself** for anything you care about: list them in `captions.emphasize` (e.g. `["camera", "40%", "free"]`), or
write explicit phrases in timeline.js:
```js
PHRASES = [[0, 4, [3, 4]], [5, 9, [9]], [10, 16, [12]]];   // [firstWordIdx, lastWordIdx, [emphasised idxs], {size, maxW, swap: {idx: 'text'}}]
```
How to choose emphasis words: the 1-2 words that carry the meaning of the phrase (the noun/number/verb that would be bold in a headline),
never function words, never more than 2 per phrase, the keyword on the CTA. Same word as the hero object on screen = best.
Per scene: `noHeadline: t => bool` hides captions, `hl: t => ({ x, y, color, em, alpha })` moves/recolours them for a beat.
Config (reel.json `captions`): `size, maxW, x, y, lead, maxWords, color, emphasis, emphasize`; `"captions": false` turns them off.

**Non-English reels** (reel.json `"language": "ru"`, ISO code): stop words and "comment" words exist for `en ru uk es pt de fr it tr ar hi`
(`LEX` in core/words.js; e.g. ru комментар*/напиши, es comenta, de kommentier*, fr commente, tr yorum, ar علّق/اكتب, hi कमेंट). Any other
language: no stop words, emphasis falls back to "longest word" only. Either way **review the emphasis yourself** for a non-English reel
(read `build/word_index.txt`, set `captions.emphasize` or explicit `PHRASES`): the heuristic can't tell a key noun from a long
function word. Lip sync works for every language (Cyrillic and Greek are transliterated; other scripts get a syllable-rate mouth).

### UI text (comment sheet, DM, browser tab, template labels)
Every word the kits and the template draw comes from `uiText(key)`: English by default, built-in translations for
`ru uk es pt de fr it tr ar hi` picked by reel.json `"language"`, and any key overridable per reel:
```json
"language": "ru",
"ui": { "post": "Отправить", "sentLink": "лови ссылку" }
```
Keys: `comments` "Comments" · `addComment` "Add a comment…" · `post` "Post" · `you` "you" · `newMessage` "new message" ·
`sentLink` "sent you the link" · `newTab` "New tab" · template: `workflow` "your workflow" · `today` · `plan` "the plan" · `done` "Done." ·
`doneCount` "DONE" · `nope` "NOPE" (stamp fallback) · `sceneProblem` / `sceneHow` / `sceneGet` (chrome labels). Your own keys work too
(`"ui": {"cvTitle": "// резюме"}` → `uiText('cvTitle')`). In your own scenes, write on-screen words in the reel's language (or via
`uiText`), never hard-coded English. `dmBubble(..., {title: true})` = `uiText('newMessage')`. Glyphs for any non-Latin text (voice
words, UI strings, the keyword) are preloaded from the "Fallback" font family before the first frame.

**Template CTA**: comment sheet → keyword typed + posted → big keyword pill → KEYWORD notifications + replies → DM "sent you the link"
→ thumbs-up. The comment COUNTER is **off by default** (never show invented engagement numbers). Turn it on only with a real number:
`"cta": { "keyword": "REEL", "counter": 1480 }` (a red odometer badge rolls up to it after Post; the readout shows it too). Its sound
is deliberately sparse (two keystrokes, Post click + pop, DM ding, closing shimmer): the mixer drops cues that crowd each other.

## 6. Presenter

Look (reel.json `"presenter"`, every field optional; `false` = no presenter). The default is a neutral, clean-shaven person in a slate tee.
| field | values |
|---|---|
| `skin` | `porcelain` `fair` `light` `medium` `olive` `tan` `brown` `deep` or `#hex` |
| `hair` | short straight: `swept` (deep side part) `crop` (short textured, high fringe) `fringe` (blunt bangs) `curtain` (middle part, jaw-free) `messy` (tousled spikes) · short wavy/curly: `wavy` (tousled medium waves) `curly` (short curls / afro-textured) · very short: `buzz` `bald` · long (to the shoulders): `long` (straight, middle part) `wavylong` (soft waves) `longcurly` (voluminous curls, curly mass behind) · tied back: `ponytail` `bun` |
| `hairColor` | `black` `darkbrown` `brown` `chestnut` `auburn` `red` `blonde` `platinum` `grey` `white` or `#hex` |
| `beard` / `beardColor` | `none` `stubble` `full` / colour (default = hair) |
| `beanie`, `beanieColor`, `beanieTab` | knit beanie on/off, `#hex`, small accent tab on/off |
| `glasses`, `glassesStyle`, `glassesColor`, `glassesW` | on/off, `round` `square`, `#hex`, frame thickness (default 7; 4-5 thin wire frames, 9-10 chunky) |
| `lashes` | `true` = small lashes on the outer corner of each upper lid (default off) |
| `top`, `topColor`, `innerColor` | `tee` `hoodie` `collar` (buttoned shirt) `overshirt` (open shirt over a tee in `innerColor`) |
| `accessories` | any of `earrings` `necklace` `headphones` `mic` |
| `face`, `slim` | `adult` / `young`, narrower face |
| `dock` | override the home spot `{x, y, s}` |
From a photo: pick the closest options (hair shape + colour, glasses and beard matter most), then render
`stills <project> 0 1 2 3 --only presenter` and compare; page 3 shows every hairstyle in the configured colours. See guides/presenter.md.

**Acting rules**
1. **Pointing is the default state.** Whenever a hero is on screen the presenter points at it and re-aims when it moves or the focus
   changes (`act()` does this: give it `focus`). Eyes and head follow the target.
2. **A gesture or expression change on every phrase** (`act()` cycles expression presets per phrase and adds a free-arm gesture on some
   phrases; add your own `beats`/`faces` for the big moments: shock on a big number, shrug on a question, fist on a win, thumbs-up +
   wink on the CTA close).
3. Jab on emphasised words (automatic: finger dips 7°, brows pop).
3b. **Pose variety + body (automatic in `act()`):** per phrase the pointing arm alternates between `point`, `present` (open palm offered
   toward the target) and, on phrases ≥ 0.9 s, `frame` (both hands raised toward the target); poses cross-fade at phrase changes, the
   hand never drops. The body follows: lean + body turn toward the target, a small step toward it, head tipped back for targets above
   the head; a target right above the bust gets an out-and-up reach with the elbow bent out (never an arm folded over the head).
   Up aims (the docked presenter's usual up-left targets): `present` keeps the hand out at the side at shoulder height with the palm
   up, fingers toward the target side (an open hand raised beside the head would read as a salute / "hand to the ear"); `frame` is
   only used when the free hand can reach the target without crossing over the head, otherwise that phrase gets `present`.
   `act(t, { poses: false })` = always the plain point, `{ pose: 'present' }` = force one pose, `{ lean: false }` = no automatic
   lean/step. Page 4 of the presenter sheet shows point / present / frame aimed at up-left targets.
4. **Every scene starts and ends with the presenter at `PRESENTER_DOCK`.** In between it may move (hook: bigger + centred, then glide
   home in the last 0.4 s).
5. Lip sync, blinks, breathing bob and idle head motion are automatic (from words.json); never animate the mouth yourself unless
   it's a scripted "O" (`mouth: 0.8`).

State object (what `guy(t)` returns; `act()` builds it): `x, y, s` (bust bottom-centre, scale), `rot, sx, sy, lean, bodyTurn` ·
`armL, armR` pose names + `armLp, armRp` 0..1 · `pointAng` deg (0 = straight out sideways, -90 = straight up, +90 = down; applies to
any arm in `point` / `present` / `frame`; `pointAngL` / `pointAngR` per arm) · `armLFrom`/`armRFrom` + `armLMix`/`armRMix` (cross-fade
from another pose) · `wave` phase · `headTurn` -1..1, `headTilt` deg, `headNod` · `lookX, lookY` -1..1 · `brow` -1..1, `browTilt`,
`smile` -1..1, `shock`, `sweat`, `wink`, `blink` 0..1 · `mouth` (scripted O) · `look` (per-state look override) · `hide`.
Poses: `point` `present` (open palm toward pointAng; palm-up offering out at the side for up aims) `frame` (open hand raised toward
pointAng; use on both arms) `wave` `thumb` `shrug` `facepalm` `cover` `hold` (palm up, presenting) `fist` `shh` (index finger over the
lips) `down`. `L` = the arm on screen-left. Page 1 of the presenter sheet (`stills <project> 1 --only presenter`) shows every pose.

**Anchors (attach a prop to his hand / mouth):** `PRESENTER.anchors(state)` → `{head, top, mouth, handL, handR}` in scene space.
Pass the SAME state your `guy(t)` returns: a raw `act()`/`mood()` state is normalised inside (breathing bob, idle head motion, lip
sync, exactly as the engine does before drawing; `act()` stamps `t` on its state). A hand-built state needs the time:
`anchors(state, t)`. An already normalised `guyState(t, ...)` state is used as is.
```js
const G = t => act(t, { focus: t => ST.focus(t) });          // one function for guy() and the prop
SC.x = { guy: G, front: (T, K, t) => { const h = PRESENTER.anchors(G(t)).handL; if (h) dmBubble(T, K, h.x - 40, h.y - 260, [{ txt: uiText('sentLink'), t0: T_DM }], { t, w: 520 }); } };
```

## 7. Scene contract

```js
// ═════════════ 02 · NAME  [CUT_A → CUT_B] ═════════════
// Beats: what happens on which word (write this first: it is your storyboard).
(() => {
  const S0 = CUT_A, S1 = CUT_B;                         // from timeline.js
  const T_SLAM = wordAt('camera', S0, 1, S0 + 0.6);     // every beat = a word, with a fallback
  kick(T_SLAM + 0.02, 0.8, 0.8); cue(T_SLAM, 'stamp');  // register at load time
  SC.name = {
    label: '// 02 — name',                // top-left chrome (default "// 0N — key")
    readout: t => ({ k: 'SAVED', v: '3h', hot: t > T_SLAM }),   // optional top-right
    cam: t => ({ x, y, z, r }),           // optional camera (z 1 = identity). Return to identity at the cuts
    back: (T, K, t) => {},                // optional full-frame background (screen space, under everything)
    draw: (T, K, t) => {},                // the scene, scene space
    guy: t => act(t, { focus: ... }),     // presenter state (or an array of states, or null)
    front: (T, K, t) => {},               // drawn over the presenter (e.g. a DM bubble coming out of his hand)
    top: (T, K, t) => {},                 // screen space, over captions (rare)
    noHeadline: t => false, hl: t => ({}), noChrome: false,
  };
})();
```
`t` is absolute reel time. Pure function of `t`: no `Date`, no `Math.random` (use `rng(seed)`, `hash(n)`, `noise1(x)`), no state that
depends on the previous frame. Frames render in any order.

Timeline (`timeline.js`): `SCENE_FILES = [...]`, cut constants, `TIMELINE = () => [['hook', 0], ['how', CUT_A], ...]`, optional
`PHRASES`, `READOUT`, `END_AT` (else duration = last word end + `reel.json tail` (0.8)), global cues. `KEYWORD` = reel.json
`cta.keyword` uppercased. Scenes that are registered but not in `TIMELINE` can still be checked with `--only`.

## 8. Cue on words (never on seconds)

| helper | returns |
|---|---|
| `wi(i)` / `wiE(i)` | start / end of word index i (clamped). Indices: `build/word_index.txt` |
| `wordAt(word, fromT = 0, nth = 1, fallback)` | start of the nth word starting with `word` at/after `fromT` (prefix, case/punctuation-insensitive), else `fallback` |
| `wordEnd(...)`, `wordIndex(...)` | its end time / index (-1 if missing) |
| `cueAny(['send', 'link'], fromT, fallback)` | earliest of several candidates |
| `sentenceAfter(t)`, `sentenceAt(t)`, `lastSentence()`, `SENTENCES` | sentence starts `{i0, i1, s, e, text}`: robust cut points |
| `clauses(t0, t1)` | `[{i0, i1, s, e, key}]` comma-level clauses with their key word index (one beat per clause) |
| `keyWordIdx(i0, i1)`, `cleanWord(i)` | strongest word in a range, word text without punctuation |
| `frac(f)`, `VO_END` | f × voice length (fallback math), end of the last word |
| `phraseAt(t)`, `PHRASE_LIST`, `EMPH_TIMES` | caption phrases / emphasised word times (available at render time, not at scene load) |
| `sceneStart(key)`, `sceneEnd(key)`, `DUR_END()` | scene bounds / final duration |

**Matching is by prefix, on whole words as the voice clock splits them.** A hyphenated word is ONE word that keeps its hyphen
("co-founder"), so `wordAt('co')` matches it, but so do "Costco's", "combo" and "cost" earlier in the script, and `wordAt('founder')`
never matches it (search the start: `'co-f'` or `'co-founder'`). When a prefix is ambiguous: pass a from-time that starts after the
earlier matches (`wordAt('co', S0)`), pass `nth`, or look the word up in `build/word_index.txt` and use `wi(i)` (start) / `wiE(i)`
(end) with that exact index (e.g. `wi(22)` for "co-founder" at index 22). Check a cue with `wordIndex(word, fromT)`: it returns the index it picked (-1 = fallback used).

Big things land ON the stressed word: put the slam/tick at `wordAt(word)` (or 0.02-0.05 s after), never before the word is heard.

## 9. Motion vocabulary

Easing/progress: `P(t, t0, dur, ease)` 0..1 · `E.outCubic/inOutCubic/outBack/outBackX/inBack/outExpo/...` · `pop(dt, f, z)` spring
0→1 with overshoot (dt = t - start; `pop(dt, 2.6, 0.42)` default snappy, `2.0, 0.64` soft card rise) · `spring(dt, f, z)` ·
`ring(dt, f, k)` decaying wobble (add to scale: `1 + ring(t - T, 3, 8) * 0.1`) · `win(t, t0, t1, in, out)` on/off window ·
`enterY(t, t0, dist)` spring up from below · `exitY(t, t0, dur, dist)` fly up and out · `pulses(t, times, dur)` · `Track` keyframes.
Placement: `X([T, K], x, y, scale, rotDeg, () => draw in local coords)` (moves both layers together).
Camera: `cam: t => ({ z: 1 + 0.03 * win(t, a, b, 0.8, 0.3) })` slow push on the hero · `kick(t, amp = 1, shake = 1, dur = 0.8)` one
punch per big beat (zoom bump + shake). A kick never crosses a cut: when its scene ends sooner than `dur`, it is shortened and eased
out so the camera is exactly back to identity on the scene's last frame (a kick 0.1 s before a cut still punches, then settles by the
cut). Your own `cam()` must also return to identity at the cut.
Transitions: hard cut on the first word of the new beat (scene start = `wordAt(...) - 0.1`). Optional `wipe(t, mode, col)` halftone
dot wipe (mode 0 diagonal, 1 radial, 2 bottom-up, 3 left-right; covers 0.24 s before `t`, the next scene already shows through the
dots from `t` and clears in 0.3 s, so at most ~1 frame is fully covered; col `#111111` default,
`'#FF3B1F'` for an accent wipe). Use at most 1-2 wipes per reel (into the CTA or a big reveal). **A wipe at `t` covers the LAST
~0.24 s of the outgoing scene** (`t - 0.24` → `t`): nothing important may land there (no stamp, no number, no punchline word on
screen for the first time); finish the scene's beats by `t - 0.3` and have the presenter docked by then (the template hook ends its
moods at `S1 - 0.27`). Hand-offs: the end state of scene N = the start state of N+1 (presenter docked, nothing jumping). A hard cut
may also **reframe**: an element carried over from scene N may come back at another size or position in N+1 (a closer framing, the
stage rebuilt around it); that is a normal edit, not a jump to fix. Only the presenter must match (docked) across the cut.
SFX: `cue(t, name, gainDb = 0)` → names `whoosh swoosh pop click tick ding thud impact boom shimmer riser type cash stamp`
(gain is relative to the default level: 0 normal, -4 softer, -8 subtle; >0 is clamped). Sparse: a whoosh into cuts, one accent per
beat (stamp on a slam, tick on a checkbox, type while typing, ding on success), ≤ ~1 cue per 0.5 s.
**The mixer thins cues automatically** (`tools/mix.py`), so cue only sounds that MEAN something: transitions and slams (`whoosh stamp
impact boom`) always play; mid cues (`swoosh thud ding cash riser`) need 0.25 s of room after any other cue; light cues (`pop tick click
type shimmer` and anything unknown) need ~0.35 s of room AND at most 1 per second; the same sound never repeats within 0.12-0.25 s.
Everything else is dropped on purpose (the export log says how many). Ten pops in a second = one pop: pick the one that matters.

## 10. Pacing rules (from the creator's reels)

- A cut or a clear visual change every **1-1.5 s**. Something small moves every **0.3-0.5 s** (a tick, a counter, a cursor, a pulse).
- **One focus at a time on a full, building stage** (section 0): every stressed word adds or changes one element, earlier
  elements stay and keep moving, the newest one is the focus (accent + pointer). Readable with the sound off; text that must be read
  ≥ 40 px; readable states held ≥ 0.4 s; highlights exactly on their targets.
- Density: an event every 0.4-0.8 s, something big ≥ 0.7 / s, nothing static > 1.2 s. `reel motion` must PASS before the final.
- Frame 0 is already in motion (the hook object is slamming in at t = 0).
- One `kick` per big beat, not per small event. Accent only on the one thing that matters right now.
- Scenes are 2-6 s. A long section = several beats inside one scene (each beat on its own word) or several scenes.
- Physical metaphors beat abstract UI, and every reel invents its own (section 0 "Invent the metaphor", guides/patterns.md):
  one object that carries the idea, 2-5 custom props, a physical reaction on each word.

## 11. Recipes (copy-paste; all verified in the engine)

```js
// 1 · STAMP SLAM on a word (card + stamp + impact + kick + sound)
const T_SLAM = wordAt('paid', S0, 1, S0 + 0.8);
kick(T_SLAM + 0.1, 1, 1); cue(T_SLAM + 0.1, 'stamp');
// in draw(T, K, t):
uiCard(T, K, 140, 560, 720, 300); uiLabel(K, 'invoice', 180, 620);
stamp(K, T, 'PAID', 640, 760, t - T_SLAM, { size: 110, rot: -10 });   // dt-based: 0.14 s slam + ring
impact(T, K, 640, 760, t - T_SLAM - 0.1, 1, 7);                         // accent bloom, shock ring, bursts, sparks

// 2 · COUNTER ROLL (slot-machine digits), p 0..1
bigFigure(K, '$4,280', 500, 790, 150, P(t, T_NUM, 0.9));               // also: slot(ctx, str, x, y, fontOpts, p)
// plain count-up: text(K, Math.round(4280 * E.outCubic(P(t, T_NUM, 1))).toLocaleString('en-US'), x, y, {font: F.grot, weight: 700, size: 140})

// 3 · CHECKLIST TICK on words (rows deal in, tick with pop + drawn check + flash)
const ITEMS = clauses(S0, S1).slice(0, 5).map(c => ({ txt: cleanWord(c.key), t0: wi(c.key) }));
for (const it of ITEMS) cue(it.t0, 'tick', -2);
// draw: rows reveal with a (0..1)
checklist(T, K, 100, 560, 800, ITEMS.map((it, i) => ({ ...it, a: clamp(pop(t - S0 - 0.15 - i * 0.09, 3, 0.55), 0, 1) })), { t, title: 'the plan', size: 40 });

// 4 · PHONE WITH UI (springs up from below, content clipped to the screen)
const y = 560 + enterY(t, S0, 900);
phone(T, K, 330, y + 380, 380, (K, x, y0, w, h) => {
  const top = phoneHeader(K, x, y0, w, 'Today');
  [['Write script', T1], ['Record voice', T2]].forEach(([s, tt], i) => {
    const ry = top + 50 + i * 80, done = t >= tt;
    if (done) fillRR(K, x + 24, ry - 22, 44, 44, 12, C.red); else strokeRR(K, x + 24, ry - 22, 44, 44, 12, '#CFCBC2', 3);
    check(K, x + 46, ry, 26, clamp((t - tt) / 0.2), '#FFFFFF', 6);
    text(K, s, x + 88, ry + 11, { font: F.grot, weight: 500, size: 30, color: done ? '#8a8780' : C.ink, align: 'left' });
  });
});

// 5 · BROWSER WINDOW (light chrome; content callback gets the page rect)
browser(T, K, 90, 540, 900, 700, (K, x, y, w, h) => {
  text(K, 'Weekly views', x + 40, y + 70, { font: F.grot, weight: 700, size: 44, color: C.ink, align: 'left', ls: -1 });
}, { url: 'analytics.example.com', tab: 'Analytics' });

// 6 · BEFORE / AFTER SPLIT (divider wipes on a word)
beforeAfter(T, K, 90, 520, 900, 420, E.inOutCubic(P(t, T_AFTER, 0.8)),
  (K, x, y, w, h) => skeleton(K, x + 50, y + 120, [600, 420, 520, 300], { gap: 60, h: 22 }),           // before
  (K, x, y, w, h) => text(K, 'Clean.', x + 50, y + 240, { font: F.serif, italic: true, weight: 400, size: 140, color: C.red, align: 'left' }));

// 7 · BAR CHART (bars spring up staggered, values roll, one hot bar)
barChart(T, K, 150, 650, 780, 560, [{ v: 12, label: 'MON' }, { v: 18, label: 'TUE' }, { v: 9, label: 'WED' }, { v: 41, label: 'THU', hot: true }],
  { t, t0: wordAt('views', S0, 1, S0 + 0.3), fmt: v => Math.round(v) + 'k' });

// 8 · TERMINAL typing a command, then a spinner that resolves
terminal(T, K, 90, 1000, 640, 300, { t, fs: 22, lines: [
  { t0: T_CMD, kind: 'cmd', txt: 'make it faster' },
  { t0: T_CMD + 0.6, kind: 'spin', txt: 'Optimizing', dur: 0.6, done: 'Done in 1.2 s' }] });

// 9 · PRESENTER pointing at whatever is the hero (segments) + a win beat
guy: t => act(t, {
  focus: [[S0 + 0.2, T_B - 0.05, 300, 640], [T_B, S1 - 0.1, 540, t => cardY(t) + 200]],   // [t0, t1, x, y] (x/y may be functions)
  beats: [[T_WIN - 0.05, T_WIN + 0.7, 'R', 'fist']],
  faces: [[T_WIN, T_WIN + 0.8, { smile: 0.95, brow: 0.6 }]],
}),

// 10 · HAND-DRAWN MARKS: loop around a word, underline, arrow
scribbleCircle(K, cx, cy, 175, 46, P(t, T_LOOP, 0.35));            // red pen loop
underline(K, x, y + 14, wordWidth, P(t, T_U, 0.25));
arrow(K, x0, y0, x1, y1, P(t, T_A, 0.4), { bend: 80 });
```
More kits: `toast()` notification, `commentSheet()` (the CTA), `dmBubble()`, `statCard()`, `ringChart()`, `lineChart()`, `versus()`,
`toggle()`, `progress()`, `tag()`, `avatar()`, `panel()`, `codeChip()`, `flow()` energy along a bezier, `cable()`, `confetti()`,
`ripple()`, `speedLines()`, `dotShadow()`, `cursor()` (lib). Images: `ASSETS.push(['shot', 'assets/shot.png'])` at scene load, then
`coverImg(K, IMG.shot, x, y, w, h, { r: 18, fy: 0 })`.

## 12. API reference (every public function)

**lib.js (core drawing)**
- `W, H` 1080, 1920 · `D2R`, `TAU` · `C` colours (see tokens) · `F` font names
- `clamp(x, a=0, b=1)` · `lerp(a, b, t)` · `inv(a, b, x)` inverse lerp clamped · `E.*` easings · `P(t, t0, dur, e=E.lin)` progress
- `spring(dt, f, z)` damped spring 0→1 · `ring(dt, f, k)` decaying cosine · `hash(n)` 0..1 · `noise1(x)` smooth -1..1 · `rng(seed)()` seeded random · `money(n, cur)`
- `rr(ctx, x, y, w, h, r)` round-rect path · `fillRR(ctx, x, y, w, h, r, fill)` · `strokeRR(ctx, x, y, w, h, r, col, lw)`
- `card(T, K, x, y, w, h, {r, sh, shade, lw, stroke})` hard-offset halftone shadow card (sticker look)
- `circle(ctx, x, y, r, fill, stroke, lw)` · `line(ctx, x1, y1, x2, y2, col, lw, cap)` · `strokeP(ctx, pathFn, len, p, col, lw)` draw a path on progressively
- `font(o)` · `text(ctx, str, x, y, {font, weight, size, italic, align='center', base, ls, color, slw, stroke})` · `measure(ctx, str, o)`
- `letters(ctx, str, x, y, o, (i, n, ch) => ({dx, dy, s, sx, sy, r, a, c}))` per-letter kinetic type · `slot(ctx, str, x, y, o, p)` rolling digits
- `check(ctx, x, y, s, p, col, lw)` drawn check · `cross(ctx, x, y, s, p, col, lw)` drawn X
- `burst(ctx, x, y, dt, {n, r0, r1, color, lw, dur, rot})` radial lines · `shock(ctx, x, y, dt, {r, color, lw, dur})` expanding ring
- `stamp(K, T, str, x, y, dt, {size, rot, col, pad, font, sub})` rubber stamp slam with worn ink (the frame fits the wider of `str` and
  the mono `sub` line under it). The worn-ink specks erase only the stamp's own ink, so it is safe over any card or drawing (custom
  cards included; see §14 for your own erasing code).
- `person(ctx, x, y, s, fill)` glyph · `cursor(ctx, x, y, s, press)` mouse pointer · `envelope(ctx, x, y, w, h, lw, col, fill)` · `warn(ctx, x, y, s, col)` triangle
- `Track(defaults).key(t, props, ease).at(t)` keyframe tracks

**ui.js** `uiText(key)` UI word in the reel's language (`UI` table, reel.json `language` / `ui`) · `pop(dt, f=2.6, z=0.42)` · `X(ctxs, x, y, s, rotDeg, fn)` · `HAIR` · `uiCard(T, K, x, y, w, h, {r, shadow, fill, border, lw})` ·
`uiLabel(K, str, x, y, {size, color, align})` "// label" · `uiPill(K, str, cx, cy, w, h, {fill, color, size, press, stroke})` ·
`uiField(K, x, y, w, h, value, {label, missing, focus, size})` · `bigFigure(K, str, x, y, size, p, {color, align})` ·
`seal(K, str, x, y, dt, {size, col, rot})` serif-italic seal ("Done.") · `iconCheck(K, x, y, s, p, col)` · `iconX(...)`

**media.js** `IMG` · `ASSETS` · `loadImg(key, src)` · `coverImg(ctx, im, x, y, w, h, {fx, fy, zoom, r, gray, bright})` ·
`containImg(ctx, im, x, y, w, h)` · `typedStr(str, t, t0, cps=26)` · `typeSeg(t, [[str, t0, t1], ...])` typing that follows words ·
`caretAt(K, x, y, h, t, col)` · `sparkle4(ctx, x, y, r, col)`

**words.js / captions.js** see §5 and §8. `captionBottom(t)` · `CAP` caption settings · `commentIndex(fromT)` first "comment" word
(any language) · `isCommentWord(w)` · `isStopWord(w)` · `reelLang()` · `LEX` per-language stop/comment words.

**acting.js** `PRESENTER_DOCK` · `act(t, {at, focus, side, beats, faces, gestures, poses, pose, lean, jab, extra})` · `arms(t, [[t0, t1, 'L'|'R'|'LR', pose, extra]])` ·
`expr(t, [[t0, t1, {props}]])` · `win` · `enterY` · `exitY` · `inAt(t, t0, f, z)` · `pulses(t, times, dur)` ·
`shoulderAt(g, side)` · `aimAt(g, side, tx, ty)` → pointAng · `headAt(g)`

**presenter.js** `PRESENTER.draw(T, K, state)` (low level; scenes return states from `guy` instead) · `PRESENTER.anchors(state, t?)` →
`{head, top, mouth, handL, handR}` scene points (attach props to a hand: a DM bubble growing out of it; raw `act()` states are
normalised inside, see §6 "Anchors") · `PRESENTER.look(o)`
normalized look · `PRESENTER.DEFAULT`, `SKINS`, `HAIRCOLS`, `HAIRSTYLES`. `GUY3D` is an alias (library code).

**engine.js** `SC` registry · `cue(t, name, gainDb)` · `kick(t, amp, shake, dur = 0.8)` (clamped to its scene) · `wipe(t, mode, col)` ·
`sceneAt(t)` · `sceneStart(key)` · `sceneEnd(key)` · `DUR_END()` · `guy(T, K, t, state)` draw an extra presenter (e.g. a clone) ·
`guyState(t, state)` the normalised state the engine draws · `captionBottomScene(t, withCam)` · `screenToSceneY(y, cam)` /
`sceneToScreenY(y, cam)` · `REEL` (reel.json) · `THEME` · `SAFE_S` `SAFE_X` · `DUR` (after boot)

**kits/fx.js** `glow(T, x, y, rx, ry, a, rgb='255,0,0')` · `puff(T, x, y, dt, s, dir)` · `impact(T, K, x, y, dt, s, seed)` ·
`bez(P, u)` · `bezPath(K, P)` · `cable(K, P, p, col, lw)` · `flow(T, K, P, t, t0, {lead, r, gap, speed, a, s})` ·
`dotShadow(K, x, y, w, h, r, dense)` · `underline(K, x, y, w, p, col, lw)` · `highlight(ctx, x, y, w, h, p, col)` ·
`scribbleCircle(K, cx, cy, rx, ry, p, col, lw, seed)` · `arrow(K, x0, y0, x1, y1, p, {col, lw, bend, head})` ·
`confetti(K, x, y, dt, {n, spread, seed, dur})` · `ripple(K, x, y, dt, col)` · `speedLines(K, x, y, angRad, a, {n, len, gap})`

**kits/devices.js** `phone(T, K, cx, cy, w, content, {frame, screen, shadow, notch})` → screen rect · `phoneHeader(K, x, y, w, title)` → y below ·
`browser(T, K, x, y, w, h, content, {url, tab, page, r})` · `panel(T, K, x, y, w, h, content, {label, right, dot, dark, r, head})` ·
`terminal(T, K, x, y, w, h, {t, title, lines, input, status, fs})` (line kinds `cmd ai ok warn spin dim blank`) · `TERM` colours ·
`codeChip(K, str, x, y, {size, fill, color})` · `skeleton(K, x, y, widths, {h, gap, col})`

**kits/cards.js** `tag(K, str, x, y, {fill, color, size})` · `avatar(K, x, y, r, {img, fill})` · `toggle(K, x, y, on)` ·
`progress(K, x, y, w, p, {h, fill})` · `checklist(T, K, x, y, w, items, {t, title, row, size, strike, counter})` ·
`commentSheet(T, K, x, y, {t, w, keyword, tType, tSend, replies, cps})` · `dmBubble(T, K, x, y, lines, {t, w, title, tail})` ·
`toast(T, K, x, y, w, title, body, {icon, glyph, time})` · `statCard(T, K, x, y, w, h, label, value, p, {size, delta})`

**kits/charts.js** `dotPattern(K, col, rad)` · `barChart(T, K, x, y, w, h, bars, {t, t0, max, fmt, gap})` ·
`lineChart(T, K, x, y, w, h, values, p, {min, max, hotLast})` · `ringChart(T, K, cx, cy, r, p, {label, col, lw})` ·
`beforeAfter(T, K, x, y, w, h, p, drawBefore, drawAfter, {a, b})` · `versus(T, K, x, y, w, rows, {t, tWin, winner})`

## 12b. Mechanics kit (`kits/mechanics.js`): motion PRIMITIVES

The engine ships HOW things move, not WHAT moves: every reel invents its own central metaphor and draws 2-5 custom props for it
(section 0 "Invent the metaphor"; method + effort budget in **`guides/patterns.md`**). Loaded by the template's index.html. Projects
made before it existed: add `'/engine/kits/mechanics.js'` as the FIRST entry of `SCENE_FILES` (harmless if also in index.html).
All functions are pure functions of `t`, take word times you computed with `wordAt`, draw shadows/glows on T and ink on K, and
return anchor points in scene space for `act({ focus })`.

**Physics primitives**
| function | returns / does |
|---|---|
| `springTo(t, [[t0, v0], [t1, v1], ...], f = 2.2, z = 0.42)` | value that springs (overshoot, settle) from key to key: needles, positions, counters. Lower z = more overshoot (0.28 strains, 0.6 settles calmly) |
| `springObj(t, [[t, {x, y, s, r}], ...], f, z)` | same for objects (an element moving aside on a word) |
| `pendulum(dt, amp = 14, f = 1.2, k = 2)` | damped swing angle in degrees after a hit (anything hanging, hinged or struck) |
| `gravityFall(t, t0, vx, vy, spin, g = 5200)` | `{dx, dy, r, on}`: things that fall off the stage, shatter, get knocked away |
| `phaseAt(t, [[t, speed], ...])` / `speedAt` | integrated speed (hands, wheels, belts, scrolling lists that accelerate and brake) |
| `idleSway(t, seed, amp = 1)` | `{dx, dy, r}` idle float for anything that landed |
| `focusTrack(t, [[t, x, y], ...], glide = 0.25)` | a pointing target that glides from focus to focus (x/y may be functions) |
| `morphRect(a, b, p, lift)` | rect morph with an arc lift (carry-over transitions) |
| `wrapText(str, font, maxW)` · `spinner(K, x, y, r, t)` · `typingDots(K, x, y, t)` · `liveDot(K, x, y, r, t)` | small live bits |
Core helpers you combine with them (lib.js / ui.js / fx.js): `spring(dt, f, z)`, `pop(dt, f, z)`, `ring(dt, f, k)` (decaying wobble for
shakes and squash), `win(t, t0, t1)`, `noise1`, `rng(seed)`, `burst`, `shock`, `puff`, `impact`, `glow`, `confetti`, `speedLines`, `flow`.

**Build-up stage**: `const ST = buildStage([...elements], { sfx: true, focus: [[t0, t1, target], ...] })` → `ST.draw(T, K, t)`,
`ST.focus(t)`, `ST.at(id, t)`, `ST.newest(t)`, `ST.focusOn(target, t0, t1)`.
Element: `{ id, t, x, y, s, r, draw(T, K, t, e), enter, from, idle, nudge, moves, exit, exitMode, focus, z, sfx, gain, kick, carry }`.
`enter`: `pop` (spring scale) · `drop` (falls, squash, dust) · `slide` (from: 1 right / -1 left) · `rise` · `swing` · `stamp` · `none`.
An element is HIDDEN until its entrance starts (`t`); only `drop` shows ~0.2 s early (it is falling in).
`draw` gets LOCAL coords centred on (0, 0) and `e = {age, p, newest, i, x, y, s}` (use `e.newest` to accent the focus).
Elements idle-float after landing (`idle: 0` to stop), jolt when a newer element lands (`nudge`), spring to new spots on `moves:
[[t, {x, y, s}]]`, leave with `exit: t, exitMode: 'fall' | 'up' | 'shrink' | 'left' | 'right'`. Entrance SFX are cued automatically.
- **Carry-over across a cut**: `carry: true` = the element is on stage from the scene's first frame (no entrance, no SFX, already
  idling; `t` optional, it counts as the oldest element for focus). Use it for the object that continues from the previous scene
  (draw it at the same spot the previous scene left it), then let new elements build around it.
- **Focus override**: the presenter's point and `stageCam` follow the NEWEST element by default. To look elsewhere (back at an older
  element, at a point, at nobody), pass `focus: [[t0, t1, target], ...]` or call `ST.focusOn(target, t0, t1)` (chainable); `target`
  = an element id, `[x, y]`, `t => [x, y]` or `null`. It glides in and out over 0.25 s and the camera leans to it too. Never add
  invisible `draw: null` elements to move the focus.
`stageCam(t, ST, { k = 0.1, z = 0.035, push = 0.006, release, t0 })` = camera that leans toward each new element / focus override
(identity again from `release`). `t0` = when its zoom-in (0.6 s) and slow push start; it defaults to the start of the scene being drawn,
so a late scene starts at z ≈ 1 like an early one (pass `t0` only to start the push later, e.g. on the first build-up word).

**Presenter as hero + acting presets**
| function | what it does |
|---|---|
| `recFrame(T, K, t, { t0, t1, cx, cy, hw, hh, from = 1.8, tag, tagT, glow, hunt: [t0, t1] })` | viewfinder brackets close on the target with a spring, blinking REC pill + timer, tag pill, red hot-seat glow, hunting reticle. Call in `front`. |
| `heroAt(t, t0, t1, { x = 540, y = 1990, s = 1.1 })` · `faceBox(g)` | presenter steps to the centre big and back · his face box for `recFrame` |
| `mood(t, MOODS, actOptions)` → act options | MOODS = `[[name, t0, t1, extra], ...]`: `panic` `shock` `thinking` `celebrate` `lean` `shrug` `facepalm` `wave` `thumbs` `shh` (finger to the lips, mouth shut: a "secret" / "quietly" line) `no` `nod` `hero`. `extra.side` picks the arm for one-hand moods |
| `moodFx(T, K, t, MOODS, actOptions)` | the effects: red glow (panic), burst lines (shock), thought bubble (thinking; `['thinking', t0, t1, { bubble: [x, y] }]` or `bubble: t => [x, y]` puts the bubble's centre at a scene point, e.g. right of the head when the left is busy; also `actOptions.bubble`), confetti (celebrate). Page 5 of the presenter sheet shows the moods |

**Generic live UI** (x, y = top-left; generic interface pieces, not metaphors)
| function | what it does |
|---|---|
| `promptBox(T, K, x, y, w, h, t, { title, label, text, tType, cps, tSend, reply, blur, size })` | composer types the prompt with a caret, send turns accent, press + shock, prompt rides into a sent bubble, the reply streams |
| `videoPlayer(T, K, x, y, w, h, t, { t0, dur, start, seek: [[t, sec]], markers: [{sec, label}], paused: [[t0, t1]], content(K, x, y, w, h, sec) })` | playhead runs in real time, seeks jump with an expo ease, markers; default content = a live waveform |
| `liveStat(T, K, x, y, w, h, t, { label, keys: [[t, value]], prefix, suffix, size, roll, hot, delta: [t, '+12%'], spark })` | LIVE pill, odometer number rolling between keys (motion smear when fast), live sparkline with a pulsing end dot |
| `odometer(K, value, x, y, { size, prefix, suffix, digits, align, vel })` | mechanical-counter digits (carries roll the next column) |
| `toastStack(T, K, x, y, w, t, [{t, title, body, glyph, time}], { max, h, from })` | notifications push in, older ones slide down, shrink, fade |
| `paletteFlood(T, K, t, t0, t1, { col, x, y })` (in `back`) + `paletteOn(t, t0, t1)` | a whole section in another colour (circle reveal); set `hl` caption colour from `paletteOn` |

**Example props (`library/classic/props/`): study the techniques, never paste them.** `gauge.js` (needle overshoot + strain + break),
`alarmClock.js` (integrated speed, per-tick overshoot, ringing), `stackTower.js` (drop + squash, sway that grows with height, topple),
`clothesline.js` (sagging line, bungee + pendulum badges, presenter clones), `powerStrip.js` (swing, cock back, slam, power flow),
`leverSwitch.js` (spring flip + sparks). Each file's header lists the idea it visualised and the exact motion values. They are not
loaded by the engine; `test/classic-showcase` loads them (via `/skill/library/classic/props/...`) only to show them working:
`reel stills test/classic-showcase 1.5 6.6 8.3 12.7 15 19.4 21.9 25.3 27.9 29.9` (from the skill folder).

**Recipes**
```js
// A · BUILD-UP STAGE: your own props on their words, presenter points at the newest, camera leans to it
const ST = buildStage([
  { id: 'base', carry: true, x: 300, y: 720, draw: (T, K, t, e) => myBase(T, K, t) },            // continues from the previous scene
  { id: 'part', t: wordAt('first', S0), x: 820, y: 660, enter: 'pop', draw: (T, K, t, e) => myPart(T, K, t, e) },
  { id: 'hit',  t: wordAt('harder', S0), x: 800, y: 1040, s: 0.8, enter: 'slide', from: 1, draw: (T, K, t, e) => myHit(T, K, t, e) },
  { id: 'stamp', t: T_B, x: 430, y: 840, enter: 'none', idle: 0, sfx: null, draw: (T, K, t) => stamp(K, T, 'NOT THE FIX', 0, 0, t - T_B, { size: 100, rot: -9 }) },
]).focusOn('base', T_BACK, T_BACK + 0.8);                                                         // look back at the base for a beat
kick(T_B + 0.02, 1, 1); cue(T_B, 'stamp');
const MOODS = [['panic', T_M, T_B - 0.05], ['shock', T_B, T_B + 0.5]];
SC.grind = { cam: t => stageCam(t, ST, { release: S1 - 0.3 }), draw: (T, K, t) => { moodFx(T, K, t, MOODS); ST.draw(T, K, t); },
  guy: t => act(t, mood(t, MOODS, { focus: t => ST.focus(t) })) };

// B · A CUSTOM PROP with physics (the shape of every prop you write): entrance, word reactions, idle life
function myPart(T, K, t, e) {
  const hit = ring(t - T_HIT, 5, 9) * 10;                        // shake on its word
  const lvl = springTo(t, [[0, 0.1], [T_UP, 0.6], [T_MAX, 0.97]], 2.0, 0.3);   // overshooting level
  const sw = pendulum(t - e.el.t, 12, 1.3, 2) + Math.sin(t * 2.1) * 1.2;      // swing in, then idle sway
  X([T, K], hit, 0, 1, sw, () => { /* draw it: uiCard / fillRR / line / text ... using lvl */ });
}

// C · PRESENTER AS HERO on a personal line (REC frame + panic), then back to the dock
const MOODS = [['hero', S0, T_BACK, { s: 1.12 }], ['panic', T_SCARED, T_BACK]];
draw: (T, K, t) => moodFx(T, K, t, MOODS),
front: (T, K, t) => { const f = faceBox(mood(t, MOODS).at); recFrame(T, K, t, { t0: T_SCARED, t1: T_BACK - 0.2, ...f, tag: 'face cam: off', tagT: T_FACE }); },
guy: t => act(t, mood(t, MOODS, { focus: null })),
```

## 12c. Illustrate kit (`kits/illustrate.js`): drawing PRIMITIVES for real-looking subjects

Loaded by the template's index.html after mechanics.js (projects made before it existed: add `'/engine/kits/illustrate.js'` as the first
entry of `SCENE_FILES`). Generic and brand-free; pure functions of their arguments; `ctx` is usually K. Method and checklist:
`guides/illustration.md`. Draw the illustration on K; on open paper put its contact shadow on T (`softShadow(T, ..., '0,0,0')`,
`sticker(..., { T })`) so it prints as halftone; inside phone/card content everything is K.

| group | functions |
|---|---|
| colour | `shade(col, k)` (k < 1 darker, > 1 toward white) · `mixCol(a, b, f)` · `withAlpha(col, a)` · `tones(col)` → `{top, left, right, edge}` |
| light | `vGrad(ctx, y0, y1, cols)` / `hGrad(ctx, x0, x1, cols)` (cols = colours or `[pos, col]`) · `roundGrad(ctx, cx, cy, r, col)` volume of round things · `cylGrad(ctx, x0, x1, col)` poles/cans/cups · `gloss(ctx, x, y, rx, ry, rot, a)` specular · `glassStreak(ctx, x, y, w, h, a)` |
| shadows | `softShadow(ctx, x, y, rx, ry, a = 0.24, rgb)` contact shadow · `isoCastShadow(ctx, x0, y0, x1, y1, h, a, k)` a box's shadow on the ground |
| isometric | `ISO(x, y, z)` → `[sx, sy]` (2:1; x right-down, y left-down, z up; visible faces front-left y max, right x max, top) · `poly` / `fillPoly(ctx, pts, fill)` / `edgePoly(ctx, pts, col, lw, open)` · `isoLeft(ctx, y, fn)` draw ON the front face in (x, -z) · `isoRight(ctx, x, fn)` in (-y, -z) · `isoTop(ctx, z, fn)` in (x, y) · `isoQuad(ctx, x0, y0, x1, y1, z, fill)` · `isoPath(ctx, [[x, y]...], z, col, lw, {dash, offset, cap})` · `isoBox(ctx, x0, y0, x1, y1, z0, z1, col \| {top, left, right}, {edge, lw})` · `isoPrism(ctx, x0, y0, x1, y1, z, rise, col, {ridge: 'x'\|'y', edge, gable})` gable roof · `isoCylinder(ctx, x, y, r, z0, z1, col, {edge, top})` · `isoSlab(ctx, x0, y0, x1, y1, depth, {top, side, lip, shadow, specks})` diorama ground tile |
| windows | `litWindow(ctx, x, y, w, h, {seed, people, mull, lit, frame})` warm interior + diners + reflection · `windowGrid(ctx, x, y, w, h, cols, rows, {t, seed, on, gap, frame})` office facades (some windows switch with t) · `awning(ctx, x, y, w, h, [a, b], {n, scallop})` |
| life | `isoTree(ctx, x, y, s, {t, col})` · `isoCar(ctx, x, y, 'x'\|'y', col, {brake, s})` · `tinyPerson(ctx, x, y, s, {ph, walking, flip, shirt, pants, skin, hair, bag})` (feet at x, y) · `isoPerson(ctx, x, y, s, o)` · `poleSign(ctx, bx, by, h, {p, w, h, col, draw(ctx, w, h)})` · `steam(ctx, x, y, t, {n, h, a, col, gap, lw})` |
| stickers | `placeArt(ctx, box, x, y, s, fn)` draw fn in natural coords, box bottom-centre at (x, y) · `dieCut(ctx, box, fn, {pad, border, shadow: [dx, dy, a], shadowCol, T, cache})` · `sticker(ctx, box, x, y, s, fn, o)` (border stays `pad` px at any s) |
| playing reel | `shotClock(t, shots, loop, off)` → `{lt, sh, d, p}` · `shotCam(lt, shots, w, {hot})` → `{z, dx, whip}` · `whipStreaks(ctx, x, y, w, h, k, seed)` · `reelCaption(ctx, cx, cy, u, maxW, words, d, {scale, dark})` · `voiceEnv(lt, onsets)` · `voiceWave(ctx, t, lt, x0, x1, y, u, onsets, {dark, p})` · `reelOverlay(ctx, t, x, y, w, h, u, {handle, a, progress, counts})` · `miniGuy(ctx, t, x, y, s, pose)` |

Global names it defines (don't declare your own top-level `const` with these names): `ISO shade mixCol withAlpha tones vGrad hGrad
roundGrad cylGrad gloss glassStreak softShadow isoCastShadow poly fillPoly edgePoly isoLeft isoRight isoTop isoQuad isoPath isoBox
isoPrism isoCylinder isoSlab litWindow windowGrid awning isoTree isoCar tinyPerson isoPerson poleSign steam placeArt dieCut sticker
shotClock shotCam whipStreaks reelCaption voiceEnv voiceWave reelOverlay miniGuy` (inside your scene IIFE, shadowing is harmless).

## 13. How to check your work

1. After writing each scene: `stills <project> <t...> --only <key>` at its start + 0.1, the middle of every beat, each big word, end - 0.1.
2. Whole reel: `stills <project>` at 0.3, every cut + 0.1 and + 0.4, every slam word, the CTA keyword, the last 0.5 s. LOOK at
   `stills/sheet.jpg` and single stills for detail. Compare with the template stills / library look.
3. Presenter: `stills <project> 0 1 2 3 --only presenter` whenever the look changes (4 = pointing poses at up-left targets with the
   `anchors()` rings on the hands, 5 = moods).
4. Draft: `video <project>`, grab frames around transitions (`ffmpeg -ss 4.2 -i build/draft.mp4 -frames:v 1 x.jpg`), look for pops/jumps.
5. `motion <project>`: must PASS (motion ≥ 4.8, big/s ≥ 0.65, flat ≤ 27%). Every flat stretch it lists gets a build-up event, secondary
   motion or a camera move on its words; re-render the draft and re-check.
5b. `craft <project>`: enough ORIGINAL work? Targets: **lines/s ≥ 40, helpers/s ≥ 2.5, no stock prop carrying the reel** (a prop from
   `library/classic/props` used more than once = generic). Untouched template files are ignored, so a reel that only kept the template
   scenes fails: replace the "THIS REEL'S METAPHOR" blocks with props invented for the script (guides/patterns.md).
6. Then `video --final` + `export`. Read `guides/review.md` for the full checklist.

## 14. Common mistakes

- Drawing a fill on T inside a K card → invisible. Use K (or `dotPattern`) inside cards.
- Erasing on K (`destination-out`: worn ink, cut-outs, holes) over a card → the holes show T, so a custom card with only a T shadow
  gets dark dots. Erase on a scratch canvas and draw that onto K (the engine's `stamp()` does this), or put a white fill on T under
  the card (`uiCard` does).
- Painting the background: leave T white; the paper colour comes from the shader.
- Hard-coded seconds (`if (t > 4.2)`) → breaks when the voice changes. Use `wordAt` / `wi` / `sentenceAfter`.
- Using `PHRASE_LIST`/`EMPH_TIMES`/`DUR` at scene load (they are empty there): use them inside `draw`/`guy`, or `DUR_END()`.
- Top-level `const` names shared between scenes → "Identifier has already been declared". Wrap in an IIFE.
- Presenter not docked at the cut → visible jump. Start and end every scene at `PRESENTER_DOCK`.
- Presenter pointing at empty space (target coordinates in screen space instead of scene space, or a stale target after the hero moved).
- Two heroes fighting, accent on three things, text under 40 px, hero below y 1300 (behind the presenter / Instagram UI).
- Effects happening before the word is heard; kicks on every small event; SFX on every frame (machine-gun).
- `Math.random()` / `Date.now()` → frames differ between renders. Use `rng(seed)`.
- Long scene with nothing changing for > 1.5 s. Add a beat on the next stressed word.
- A persistent bottom-left "through-object" card (don't).
- A real company/place/product shown as a name card or a flat icon, or a video shown as a static screenshot: draw it like real life
  and make the video play (guides/illustration.md).
- Small heroes in a big empty frame (see "Fill the frame" in section 4). Check every stills sheet for empty paper.
- One object per beat that pops in and then freezes: build a STAGE (section 0) where elements accumulate and keep an idle life.
- Pointing at an element right above the presenter's head (x 650-1000, below y 1000): the arm can only point straight up. Keep the
  focus left of x ≈ 640 or high (y < 900), or lift the presenter (`mood('lean')`).

## 15. FAQ (things buyers' agents had to guess)

- **Easings that exist** (`E.*`): `lin, outQuad, inCubic, outCubic, inOutCubic, inQuart, outQuart, outQuint, outExpo, inExpo, inOutExpo,
  inOutQuint, outBack, outBackX, inBack`, plus `inQuad, inOutQuad, inOutBack, inSine, outSine, inOutSine`.
- **The "point" pose** is the forearm raised with the index finger aimed along `pointAng` (deg: 0 = out sideways, -90 = straight up,
  90 = down). Because the presenter sits bottom-right and heroes are above it, a correct point usually aims up-left (-120..-150).
  Use `act(t, {focus})` and it aims for you; aim at the hero's centre in SCENE space.
- **Helper files** (shared drawing functions for several scenes) can be listed in `SCENE_FILES` before the scenes that use them.
- **PHRASES / `swap`** only change the on-screen caption text, never the voice.
- **A slam right before a cut:** fine. Its `kick` is cut short so the camera is at identity on the cut; but if the cut is a dot wipe,
  the slam must land before `cut - 0.3` or the dots hide it.
- **Word search is prefix-tolerant**: `wordAt('you')` can match "you'll". Pass a from-time (`wordAt('you', S0)`) or use `wi(index)`
  from `build/word_index.txt` for exact words.
- **Errors while drawing**: the engine catches them per scene so a frame still renders, but `reel stills/video` lists them at the end
  ("⚠ ... error while drawing frames") and writes `build/render_errors.txt`. Treat any entry as a bug to fix.
- **Motion blur**: `video --final` renders without motion blur; `--blur 2` adds it (smoother whips, but it doubles text during kicks).
