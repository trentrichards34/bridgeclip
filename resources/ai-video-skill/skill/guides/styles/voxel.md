# Voxel style guide (felt-toy diorama world)

Read this whole file before writing a voxel scene. It is the contract between you and `engines/voxel/`.

**What it looks like:** a tiny handmade world. Chunky bevelled boxes covered in a soft **felt** texture, little **toy people** with big
blocky heads and painted eyes, warm afternoon light, shallow **depth of field** (the hero is sharp, everything else melts), a little bloom
on bulbs and highlights, film grain, a vignette and a warm grade. Paper props with worn ink type, marquee signs with chasing bulbs,
confetti and sparkles. The camera is a restless handheld toy camera: **hard cuts on words, push-ins, dutch angles, whip pans between
places**. A taped paper **headline strip** sits at the top, chunky **speech-bubble captions** at the bottom.

Reference frames of the real thing: `library/voxel/INDEX.md` lists the 15 beats of the creator's reel; render any of them, or look at the
template stills you make in step 6 of SKILL.md.

---

## Creativity first (read before the storyboard)

`kits/shopfront.js` is the prop set of the creator's coffee-shop reel; `base.js` and `people.js` are the look (felt, toy people,
light). Use them for building blocks and a consistent look, never as the story. Read **`guides/patterns_3d.md`** (sections 2, 3,
6 and 7: toy-world patterns, the invention method, five worked voxel worlds, effort numbers, reference strips) and then:
- **Every reel invents its own toy world**: a set per idea (a race track, a rowing boat, a mountain trail, a sorting hall),
  each strategy as a character with a signature prop, and a physical gag per claim. A paper card with the claim written on it
  is not a gag.
- **Build 3+ custom props** for THIS script in your own `scenes/<topic>kit.js` (the reference reel built a 34-prop topic kit).
- **Stock props never carry the idea.** `makeShop`, `makeStreet` and skylines are fine as a backdrop; `makeBigSign`, `makeCup` and
  the other shopfront props at most once, only when the script is literally about them. Do not re-skin the coffee shops.
- **Before the final**: `node tools/reel.mjs craft <project>` (≥ 35 lines/s, ≥ 1.5 helpers/s, no stock prop reused) and
  `node tools/reel.mjs motion <project>` must both pass.


## Quality bar (read before writing any scene)

The creator's voxel reels measure **motion ~20** and **~6.7 big changes per second** (`reel motion <project>`; target ≥ 16 and ≥ 5, flat ≤ 5%). The first buyer test landed at 15 / 1.6: good-looking, but it held shots too long. What the creator's reels do:
- **Hard cuts on cue words every 1-1.5 s** (shot lists A-E per beat via `shots`/`shotAt`), plus a whip between beats. Never hold one framing for a whole sentence.
- **A pop or slap every 0.3-0.5 s:** someone hops, a sign slams, a card flips, confetti bursts, a crowd member reacts. Use `hopAt`, `landSquash`, slams with `shake`.
- **The camera moves inside every shot** (slow push or orbit), so even dialogue shots breathe.
- **People act constantly:** look at the action, react with expressions on the stressed word (`expr`), point, hold props, walk in and out.
- **Every stressed word changes the set:** a label card per word, a new character drops in, a sign changes text, a meter jumps.
- Planning template per beat: `shots (A/B/C on which words) | what slams/pops on each stressed word | who reacts how | camera move inside each shot | whip out`.
After the draft: `reel motion <project>`, then fix every flat stretch it lists before the final render.

**Timing gotchas (the engine enforces these; plan around them):**
- **The whip-out eats the end of every beat.** The whip into the next beat is centred on the cut, so the camera starts spinning out
  **~0.22 s before `t1`** (`blend / 2`). Anything cued on a beat's LAST word lands in the motion blur. Plan last-word events
  **≥ 0.25 s before `t1`** (`ctx.whipOut(spec)` returns the exact time the spin starts), or end the beat later, or set
  **`whipLead: 0.08`** on that beat in `plan.js` so the camera holds until just before the cut (the spin then finishes in the next beat).
- **Hard cuts need ≥ 0.4 s between them.** `U.shots` drops a cut that comes less than 0.4 s after the previous kept cut and logs
  `warning: U.shots dropped cut 'C' at ...` (reel.mjs lists it under warnings). Cue it on a later word or remove it.
- **SFX: cue only meaningful sounds, aim ≤ ~1.5 cues per second.** The mixer drops light cues (pop, click, tick, ding, type...) that
  come too close together: each needs ~0.35 s of room and at most ~1 per second survives; transitions and slams (whoosh, swoosh, slam,
  boom, impact, thud) are always kept. The visual pop every 0.3-0.5 s does NOT need a sound each: sound the big hits only.

## 1. Files and the page

```
<project>/
  index.html        engine page (never edit)          kit_preview.html / kit_preview.js   contact sheet of props (edit the .js)
  reel.json         {"style":"voxel","name","cta":{"keyword":"REEL"},"captions":{"style":4},"cast":["mei","jordan","zara"]}
  plan.js           the beats (you write it)          scenes/<id>.js   one scene per beat (you write them)
  build/words.json  word timings (tts.py)             audio/vo.mp3
engine (read-only, served at /engine/):  core/main.js plan.js studio.js captions.js util.js preview.js
                                         kits/base.js people.js shopfront.js
```
Imports inside scenes: `import * as THREE from 'three'`, `import * as L from '/engine/kits/base.js'`,
`import * as KT from '/engine/kits/shopfront.js'`, `import { namedPerson, extraPerson, makePerson } from '/engine/kits/people.js'`,
`import * as U from '/engine/core/util.js'`. Your own kit: `scenes/mykit.js` imported as `'./mykit.js'`.

Commands (run with absolute paths, from the skill folder):
```
node tools/reel.mjs stills <project> 0.3 1.2 2.5 ... [--only s03_cards]      -> stills/sheet.jpg  (LOOK at it)
node tools/reel.mjs stills <project> 1 2 3 4 5 6 7 8 9 10 --only kit         -> the kit preview sheet (9 = all icons, 10 = two shops)
node tools/reel.mjs video <project> [--from a --to b]                         -> draft;  --final for the real render
node tools/reel.mjs export <project>                                          -> out/<name>.mp4 (voice + synthesized SFX)
URL params: ?t=3.5  ?play (click = audio)  ?only=<beatId>  ?only=kit
```
`--only <beatId>` loads ONLY that beat's scene (other beats get a placeholder camera and are not imported, so their missing or
unfinished files print nothing): any error it prints is that scene's. It does not rewrite `build/sfx.json`.

## 2. Plan: beats from words (`plan.js`)

```js
export const BEATS = [
  { id: 's01_hook',   at: 0,                                       head: 'TWO NEW COFFEE SHOPS' },
  { id: 's02_same',   at: 'same',                                  head: 'SAME CITY, SAME BUDGET' },
  { id: 's03_fork',   at: { word: 'but', or: { sentence: 2 } },    head: 'TWO DIFFERENT DECISIONS' },
  { id: 's04_more',   scene: 's02_same', at: { word: 'similar', nth: 1 }, head: 'auto' },   // reuse a scene file
  { id: 's09_cta',    at: 'comment',                               head: 'cta' },             // COMMENT <KEYWORD>
];
export const OPTIONS = { tail: 0.6, blend: 0.45, gap: 300 };
```
Optional per-beat fields: `blend` (whip length into this beat, 0.45), **`whipLead`** (seconds before THIS beat's end that the
whip out starts; default blend/2 ≈ 0.22, use 0.05-0.1 when the payoff is on the last word; also `OPTIONS.whipLead`),
**`tone`** (`'bright'` = exposure 0.9 / bloom 0.2 for bright interiors, `'dim'`, `'normal'`, or `{ exposure, bloomK }`).
- `at`: `'word'` (first occurrence after the previous beat's start; punctuation ignored), `{word, nth}`, a word index (`-1` = last),
  `{sentence: n}`, `{frac: 0.5}`, plus `or:` fallback. The first beat starts at 0. Unresolvable beats are spread evenly (never crash).
- **Cue on word indices or unique words.** `at: 'the'` / `'and'` / `'you'` match the very next occurrence, which is usually the wrong
  spot. Open `build/word_index.txt` (`index start end word`, written by tts.py) and use the index (`at: 17`), or a word that appears once.
  The plan prints `console.warn` for stopword cues (the a an and or to of in on it is you your i that this so but) and `console.error`
  when a beat resolves at/before the previous one, is not found, overlaps, or is shorter than 0.8 s: reel.mjs shows these, fix them all.
- Each beat gets a **station** `spec.o = [n*300, 0, 0]`: build your set around it. Beats are 1.5-5 s; one idea each.
- `head`: the headline strip, 2-4 words, CAPS, max ~24 chars. Consecutive beats with the same `head` keep one strip (no re-slap).
- Spec fields your scene receives: `id, scene, n, t0, t1, blend, o, i0, i1, words [{w,s,e,i}], line, head, state {}`.
- `DURATION` = last word end + `tail`. `window.SFX` gets a whoosh at every whip automatically.

## 3. Scene contract

```js
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import { namedPerson } from '/engine/kits/people.js';
import * as U from '/engine/core/util.js';

export default {
  async init(ctx, spec) {                       // BUILD once
    await L.libFonts();                         // before any text prop
    const S = spec.state, root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    S.T = { slam: ctx.cue(spec, 'open', 0.3), hit: ctx.cue(spec, 'coffee', 0.6) };      // cue words -> seconds (with fallbacks)
    S.shots = U.shots([[spec.t0, 'A'], [S.T.slam, 'B'], [S.T.hit, 'C']], spec.t1 + 0.5); // hard cuts on words
    S.sign = KT.makeBigSign(ctx, 'OPEN LATE', { w: 6, h: 2.8, legs: 2.4 }); root.add(S.sign.group);
    S.hero = namedPerson(ctx, 'mei'); S.hero.group.position.set(0, 0, 4); root.add(S.hero.group);
    S.root = root;
    ctx.sfx(S.T.slam, 'slam', -3); ctx.sfx(S.T.hit, 'pop', -4);                         // sound cues (synthesized by mix.py)
  },
  update(ctx, t, spec) {                        // POSE everything from t (frames render out of order!)
    const S = spec.state;
    S.root.visible = t > spec.t0 - 0.6 && t < spec.t1 + 0.6; if (!S.root.visible) return;
    const k = U.inv(S.T.slam - 0.1, S.T.slam + 0.15, t);
    S.sign.group.position.y = (1 - U.backOut(k)) * 6;                                    // slams down
    S.sign.set({ lit: U.smooth(U.inv(S.T.hit, S.T.hit + 0.2, t)), t });
    S.hero.set({ hop: U.hopAt(t, S.T.hit, 0.5), squash: U.landSquash(t, S.T.hit + 0.32), armR: 140, reachR: 35, blink: U.blinkAt(t), t });
    if (t > spec.t0 - spec.blend / 2 - 0.1 && t < spec.t1 + 0.35) {                      // only inside my window
      ctx.bg = ctx.P.sky; ctx.focus = U.at(spec.o, [0, 2.2, 4]); ctx.dof = 1;
      ctx.shake = Math.max(0, 0.5 - (t - S.T.slam) * 2) * (t > S.T.slam ? 1 : 0);
    }
  },
  camera(ctx, t, spec) {                        // WORLD coords; valid for t in [t0 - 0.45, t1 + 0.45]
    const S = spec.state, s = U.shotAt(t, S.shots), o = spec.o;
    if (s.id === 'A') return U.shot(o, [0.5, 3, 17], [0.2, 3, 15.5], [0, 3, 2], s.k, 46, -2);
    if (s.id === 'B') return U.shot(o, [-2.4, 1.2, 12], [-2, 1.3, 11], [0, 2.6, 3], s.k, 44, 4);
    return U.shot(o, [1.4, 2.5, 13], [1, 2.6, 12], [0, 3, 3], s.k, 48, 2);
  },
};
```
**ctx** (shared): `THREE U P W H FPS PLAN DURATION words reel keyword scene camera renderer key rim hemi bloom composer fx`.
Word helpers: `ctx.wordAt(word, from, nth)` → seconds | null; `ctx.cue(spec, word, frac=0.5, nth=0)` → seconds, falls back to
`t0 + frac*(t1-t0)` (always use this); `ctx.wi(spec, k)` → start of the beat's k-th word (negative from the end);
`ctx.keyWords(spec, n)` → the beat's most important words `[{w,s,e,i}]`; `ctx.sentences(spec)` → `[{i0,i1,t0,t1,text}]`;
`ctx.sfx(t, name, gainDb)` (init only; names: whoosh swoosh pop click tick ding thud impact boom shimmer riser type cash stamp slam;
≤ ~1.5 cues/s, light cues ≥ 0.35 s apart or the mixer drops them, see Timing gotchas); `ctx.whipOut(spec)` / `ctx.whipIn(spec)` → when the
camera starts spinning out of / has settled into this beat; `ctx.TONES.bright|normal|dim` → `{exposure, bloomK}` presets.
Per-frame overrides (reset every frame, set them only inside your beat's window):
`ctx.bg {top,mid,bottom}` (presets `ctx.P.sky / dusk / night / stage / warm`), `ctx.focus [x,y,z]` (world point kept sharp),
`ctx.dof` (0 = off, 0.5 wide shots, 1 normal, 1.2 macro), `ctx.exposure` (1.0), `ctx.bloomK` (0.35), `ctx.shake` 0..1, `ctx.flash` 0..1,
`ctx.capHide`, `ctx.capDy` (move captions px), `ctx.headHide`, `ctx.after.push(fn)` (runs after the camera, e.g. DOM labels).

## 4. The look: tokens (engine `core/studio.js` LOOK, do not fight them)

| what | value |
|---|---|
| renderer | ACES filmic, exposure 1.0, PCF shadows (2048), RoomEnvironment reflections 0.35 |
| lights | hemisphere `#ffe7cf` / `#3a2c44` 0.5 · warm key `#ffe2c0` 1.9 from front-right-top, follows the camera target, casts shadows · cool rim `#8fb2ff` 1.1 from behind-left |
| post | Bokeh DOF (aperture 0.004, focus = ctx.focus) → Unreal bloom (0.35, radius 0.6, threshold 0.9) → lens (radial chromatic aberration 0.006, vignette 0.32, warm tint 1.03/1.0/0.96) → DOM radial grade + 10 % overlay grain |
| backdrop | screen-space gradient from `ctx.bg`; outdoor sky `#8fb6e0 → #bcd5ea → #e8dcc4`, indoor night `#2a2350 → #1f1a3a → #120f22` |
| palette (`L.C`) | coral `#e2704f`, paper `#f3ead8`, ink `#2a211c`, wood `#7a4a2e` / dark `#5a3420` / light `#9a6238`, gold `#e0b24a`, yes `#3fae5a`, no `#d8433a`, blue `#3a5bd0`, wall `#2c3f8f`, carpet `#b8323a`, mustard `#d9a93a`, purple `#5b3f8f`, navy `#27335e`, kraft `#c98f4f`, leaf `#3d8a46` |
| shopfront (`KT.K`) | red `#c8423a`, green `#2f8a55`, forest `#2f6b45`, cream `#f3ead8`, sidewalk `#bdb3a4`, asphalt `#3c3a44`, heart `#e84a5f`, door `#2d6a7a` |
| materials | everything `L.mat(color)` (felt on); glass/metal `rough 0.3-0.5, metal 0.3-0.5, felt 0.2-0.4`; glowing bulbs/screens `L.glowMat` |
| type | props: Nunito 900 (`'round'`) for signs and labels, Playfair Display 700 (`'serif'`) for certificates/checklist titles, VT323 (`'pixel'`) for screens |

Saturated but warm: reds, greens, mustard, sky blue, cream paper. No pure black, no pure white surfaces (cream `#fbf6ea` max).
**Bright interiors bloom.** Cream paper, white boards, light walls and pale props under the warm key cross the bloom threshold and
haze the frame (the defaults are tuned for the street). For a bright interior beat use **`tone: 'bright'`** in plan.js (exposure 0.9,
bloom 0.2), or inside your window `Object.assign(ctx, ctx.TONES.bright)`. Do this instead of recolouring props.

## 5. Layout (1080 × 1920)

- Headline strip: top 110-240 px (core draws it). Captions: block top at y 1470 px, up to ~1620 (core). Instagram UI covers the bottom
  ~300 px and the right ~120 px.
- **Hero lives in y 280-1440 px, x 60-1020.** Faces and prop text never under the captions. Check every still for this.
- Fill the frame: the set continues behind (blurred): street + skyline, or a room with windows, plants, wainscot. No void, no black.
- Units: a person (actor) is ~2.4 tall, eyes at ~2.0. Floor y = 0. Everything faces +Z; the camera sits at +Z looking toward -Z.
- Framing (fov 40-50): face close-up ~4.5 from the face; waist-up two-shot 7-9; full body + sign 12-14; wide set 16-20.
  Portrait width is the limit: visible width = 2·d·tan(fov/2)·0.5625. A 6-wide sign needs d ≈ 13 at fov 50.

**Portrait framing (measured from the core camera).** Visible width ≈ **k × d** (d = distance from the camera to the object's plane):
k = **0.41** at fov 40 (`U.shot` default), 0.45 at 44, 0.48 at 46, 0.52 at 50 (0.32 at the core fallback fov 32). Visible height = 1.78 × that.
To keep something inside the safe x 60..1020 with breathing room, frame it at ≤ 80 % of the width: **d ≥ width / (0.8 k)**.

| shops side by side (`makeShop`, facade at d) | total width | d at fov 40 | fov 46 | fov 50 |
|---|---|---|---|---|
| 1 shop, default w 9 | 10 | 31 | 26 | 24 |
| 1 shop, w 6.6 | 7.6 | 23 | 20 | 18 |
| 2 shops, w 6.6 (centres 7.6 apart) | 15.2 | 46 | 40 | 36 |
| 2 shops, default w 9 | 20 | 61 | 52 | 48 |
| 3 shops, w 6.6 | 22.8 | 70 | 60 | 54 |

A shop is ~(w + 1) wide. At 36-40 away the shop-name letters are only ~30-35 px and people ~130 px: use it as the establishing wide
(1-1.5 s), then cut in to one shop. Two shops never fit at the default w 9 in a normal shot: pass `w: 6.6` (kit preview page 10 shows the result).
- **Text on props ≥ 40 px on screen** (a 0.5-unit-tall letter at distance 13, fov 50 ≈ 80 px). Prefer 1-2 words per sign.

## 6. Captions and headline

Captions are the speech bubble (the only style; `reel.json "captions"` can still set `y`, `maxWords`, `maxChars`):
| N | style | use when |
|---|---|---|
| **4** | speech bubble: white comic bubble, 7 px ink border, Nunito 900 74 px, said word `#e2553a`, tail alternates | The only caption style (the creator's own). People-driven stories read like the little people talking |
Words group ≤ 3 words / 16 chars; punctuation ends a group. Headline: `head` text from the plan, taped cream strip `#f1e7d2`, Nunito 900 50-60 px.

## 7. Camera language (this is what makes it feel alive)

- **A hard cut on a cue word every 1-1.5 s.** Plan shots A-E per beat (`U.shots([[t, 'A'], ...])`): A establishing/thumbnail, B low punch-in
  on the people, C tight on the hero prop, D reaction two-shot, E crane back / wide payoff. Cuts land ON the stressed word (−0.04 s).
- **Something pops/slaps/hops every 0.3-0.5 s**: a card lands, a person hops, bulbs light, a stamp hits, confetti fires.
- Inside a shot the camera never stops: push in 0.8-1.5 units with `easeOut`, slow arc, dutch roll ±2-5°. Alternate the roll sign per cut.
- Low angles (camera y 1.0-1.5 looking up) for heroes; high crane for crowds and reveals; over-the-shoulder for "they look at X".
- Between beats the core **whip-pans** (14° yaw + roll + horizontal motion blur, 0.45 s). Keep your camera() valid for t0-0.45..t1+0.45
  and keep the set visible at the edges of your beat (no empty frames during the whip). The whip-out starts ~0.22 s BEFORE t1: last-word
  events ≥ 0.25 s before t1 or `whipLead` on the beat (Timing gotchas, top of this file).
- Cuts in one `U.shots` list must be ≥ 0.4 s apart (closer ones are dropped with a `warning:`).
- Impacts: `ctx.shake` 0.3-0.7 decaying over 0.25 s; `ctx.flash` ≤ 0.2 on the biggest hit of the reel only.
- `ctx.focus` on the hero every frame (the face, or the prop being read). `ctx.dof` 0.45-0.6 on wides so the set still reads.
- Frame 0 of the reel = the thumbnail: already mid-action (people mid-hop, confetti falling) and readable (one big sign/prop).

## 8. Acting: people (`people.js`)

- `namedPerson(ctx, name)` for the recurring cast (keep the SAME people across beats: reel.json `cast`), `extraPerson(ctx, seed)` for crowds.
- `set()` every frame with every key you animate: `hop squash tilt lean turn nod headTilt lookX lookY armL armR reachL reachR elbowL elbowR waveL waveR cross walk t expr blink talk mouth brow`.
- **`turn` (degrees, body yaw): + turns the person toward screen RIGHT (+X), − toward screen LEFT.** 0 = facing the camera (+Z),
  ±90 = profile, 180 = back. So a person on the left looking at a sign in the middle takes `turn: +20`, one on the right `turn: -20`.
- **Point constantly at what matters**: up-and-out at a sign = `armR 130-150, reachR 30-40`; straight at something = `armR 10-30, reachR 70-90`;
  turn the body 10-25° and `lookX/lookY` toward it. The arm on the +X side (`armR`) is on SCREEN RIGHT.
- Reactions on the word: `expr: 'shock'` (O mouth, wide eyes) on surprises, `'happy'` on wins, `'sad'` on losses, `'determined'` before
  action, `'wink'` on a punchline. Actors also take `mouth: 'teeth'|'smile'|'flat'|'o'|'frown'` + `mouthOpen` + `brow`.
- Hops land with squash: `hop: U.hopAt(t, at, 0.5)`, `squash: U.landSquash(t, at + 0.32)`; anticipation crouch before big jumps.
- Idle life: `blink: U.blinkAt(t, seed)`, `nod: 4*sin(t*6)`, `tilt: 3*sin(t*4)`, `talk` while their line plays.
- Props in hands: `p.holdR(cup.group, [0, -0.05, 0.3])` (stays upright; the offset is in upright body axes, not along the arm). Hats: `p.top.add(hat)`.
- **Which hand when turned:** `R` is the +X-side hand (screen right when facing the camera; anatomically their left). Facing screen
  right (`turn > 0`) the R hand goes to the FAR side, hidden behind the body, and L is the camera-side hand; facing screen left
  (`turn < 0`) R is on the camera side; at `turn 180` R is on screen left. In profile, hold and point with the camera-side hand.
- `p.handWorld('R' | 'L', outVec3?)` → the mitten's world position this frame (after `set()`): aim a pointer line, hand a prop over,
  focus on a held item (`ctx.focus = p.handWorld('R').toArray()`).
- **Overhead lift:** the head is ~40 % of the body, so a fully raised arm (`armR 175-180, elbowR ~10`) only reaches about eye height
  beside the head (actor: hand y ≈ 1.7, head top ≈ 2.4, ≈ 2.7 with tall hair). To hold something ABOVE the head use a lift offset,
  `p.holdR(obj, [-0.6, 1.0, 0.1])` (bottom of the prop at y ≈ 2.6) (x toward the head centre; mirror x for holdL), or for a two-hand lift raise both arms ~165 and
  parent the prop to `p.group` at y ≈ `p.height + 0.3`.
- Never leave a person in the T-pose rest for a whole beat; never let people face away unless it is the joke.

## 9. Full API reference

### core/util.js (`U`)
| function | does |
|---|---|
| `rng(seed)` | deterministic random 0..1 generator (mulberry32) |
| `clamp(x,a=0,b=1)` `lerp(a,b,k)` `inv(a,b,x)` | clamp, mix, 0..1 progress of x through [a,b] |
| `smooth` `smoother` `easeOut` `easeIn` `easeInOut` `expoOut` `backOut(k,s)` | easings (backOut overshoots) |
| `spring(k, freq=3.2, damp=5.5)` | overshoot then settle at 1 |
| `win(t,t0,t1,fi,fo)` | fade window 0→1→0 |
| `track(keys,t,ease)` `poseTrack(keys,t,ease)` | keyframes `[[t, value]]` / `[[t, pose]]` |
| `pose(pos,target,fov,roll)` `orbit(target,dist,azDeg,elDeg,fov)` | camera pose helpers |
| `v3(a)` `arr(v)` `drift(t,seed)` | array↔Vector3, smooth handheld noise |
| `pulse(t,at,len)` `hopAt(t,at,h,len)` `landSquash(t,at,amt)` `blinkAt(t,seed)` | one-shot kick, hop arc, landing squash, idle blink |
| `shots(list,end,minLen=0.4)` `shotAt(t,shots)` | hard-cut shot list on words → `{id,t0,t1,k,i}`; cuts < minLen after the previous kept cut are dropped with a `warning:` |
| `shot(o,from,to,target,k,fov,roll,targetTo)` `lerp3` `at(o,p)` | a drifting camera pose in station-local coords |

### kits/base.js (`L`)
| function | does |
|---|---|
| `C` `FONT(key,px)` `libFonts()` | palette, font strings ('round','serif','pixel'), await fonts |
| `mat(color,{rough,metal,felt,scale,bump,map,emissive,ei,transparent,opacity,side,alphaTest,depthWrite})` | felt MeshStandardMaterial |
| `glowMat(color,k,{...})` `feltTexture()` `feltify(m,amt,scale,bump)` | unlit glowing material; the felt shader |
| `B(w,h,d,mat,{r,x,y,z,rx,ry,rz,parent})` | bevelled box mesh: THE building block |
| `rbox` `geo(key,make)` `cyl(rt,rb,h,seg)` `sph(r)` `mesh(geo,mat,{...})` `rrShape(w,h,r)` `normUV` | cached geometry + mesh helpers |
| `ctex(w,h)` `inkText(g,text,x,y,{font,size,color,maxW,align,wear,seed,rot,knock})` `paperFill(g,W,H,paper,seed,grunge)` `drawLines(g,W,H,lines,seed)` `splitTwo(text)` | canvas text/paper painting |
| `paperPanel(w,h,{paper,thick,back})` `decal(w,h,draw,{ppu,felt,basic,op})` | painted paper slab; transparent painted plane |
| `rng` `toV3` `mixHex(a,b,k)` `bezier(a,c,b,k)` `fade(obj,a)` `pop(k,s)` | helpers; `fade` multiplies each material's base opacity (nested fades multiply; props that set their own opacity keep working: call fade after their `set()`) |
| `makeRoom(ctx,{wall,floor,w,d,h,side,wainscot,wainH,trim,baseboard})` | back wall + floor (+ side walls) |
| `makeWindow` `makeClock(ctx,{r}).set({h,m})` `makeBookshelf` `makeLamp` `makePodium` `makeDesk` `makePlant` | set dressing (clock: centre origin, faces +Z) |
| `makeCard(ctx,{w,h,lines,pin,border})` | pinned paper card (`setLines`) |
| `makeSign(ctx,{text,color,chart,back,w,h,stick}).set({flip})` | flip sign on a stick ('?' → answer) |
| `makePrint(ctx,{text,color,w,h,style,sub})` `makeStamp(ctx,{text,color}).printSet(k)` | ink print decal; rubber stamp + print |
| `makeTally(ctx,{left,right}).set({a,b})` | chalkboard score |
| `makeChecklist(ctx,{title,items,footer}).set({ticks})` | ticks draw in |
| `makeCertificate` `makePriceTag(ctx,text,{w=3.2,h=1.6}).set({tear})` `makeCommentPill(ctx,{w,h}).set({text,caret})` | paper props; `'$49/month'` prints `$49` big + `/MONTH` under it (reads ≥ 40 px up to ~12 away at fov 46; scale w/h together, keep 2:1); comment bar types a keyword |
| `makeShoppingBag` `makeMoneyBag` `makeBallotBox` | small props |
| `makeSparkle(ctx,{n,size,color}).set({k})` `makeConfetti(ctx,{n,spread,height,colors}).set({k})` `makeBigX` `makeBigCheck` | FX |

### kits/people.js
| function | does |
|---|---|
| `makePerson(ctx, {skin,height,width,build,hair{style,color,beard},outfit{top,color,shirt,apron,pants,shoes,neck,neckColor},accessories,...})` | the rig (~2.6 tall) |
| `makeActor(ctx, opts)` | person in a 0.93 wrapper + `mouth/mouthOpen/brow` shortcuts (what named/extra return) |
| `namedPerson(ctx, name, {mouth})` | presets: marco alex sam kai jordan mei zara jade diane grace |
| `extraPerson(ctx, seed, overrides)` `makeCrowd(ctx, n, {seed,spacing,rows,depth}).set(fn)` | crowd extras / block |
| `SKIN` `HAIR` `EXPR` `MOUTHS` `PEOPLE` | presets |
| person handles | `group set holdR holdL focus() handWorld('R'|'L', out?) top acc.{glasses,cap,beanie,headset,headphones,earrings,watch,tie,...} arms hands height` |

### kits/shopfront.js (`KT`, the example topic kit; many props are generic)
Generic hero props for any topic: **`makeBigSign(ctx,text,{color,w,h,legs,crossStyle}).set({lit,t,cross})`** (marquee + strike-through),
**`makeLabelCard(ctx,text,{color,sub,icon,w,h,pin}).set({pop})`** (name anything), `makeBubble`, `makeBanner`, `makeSpotlight`,
`makeMeter`, `makeScale`, `makeTarget`/`makeDart`, `makeSignpost`, `makeLetterBlocks`, `makeHeart`, `makeMegaphone`, `makeMagnifier`,
`drawIcon(g,kind,cx,cy,px,color)` / `makeIconSticker(ctx,kind,{size,color,bg})`. Icon kinds (`KT.ICON_KINDS`): **cup bean door clock phone
calendar person heart check play bolt box star bread cake burger pizza bag cart house car gift** (kit preview page 9 shows them all).
Any prop with an `icon` option (`makeShop`, `makeLabelCard`, `makeCup`, `makeDeliveryBox`, `makePhoneSite` (header logo + hero), `makePackaging`) takes these names.
Places: `makeStreet(ctx,{w,walk,lamps,clear}).set({rise})`, `makeSkyline(ctx,{w,z}).set({rise})`,
`makeShop(ctx,{preset:'red'|'green',name,icon,board,glass,w=9}).set({shutter,open,sign,t})` (~(w+1) wide, 8 tall; **`w: 6.6` for two shops side by side**,
w 6.2-12; see the portrait framing table in section 5), `makeFrontDoor().set({open})`, `makeAFrame`.
**Street lamps and trees stand at z ≈ walk − 0.7, IN FRONT of the shops**, between them and any camera on the sidewalk. Always pass
**`clear: N`** (moves every lamp/tree out of |x| < N) covering the x range of your heroes and cameras, e.g. `clear: 6` for one shop,
`clear: 9` for two w 6.6 shops. Without it only the prop at the exact centre (|x| < 2.5) is dropped; `clear: 0` keeps all.
Topic props: `makeCup` `makeCoinJar` `makeDeliveryBox` `makeSubscriptionBox` `makePhoneSite({icon,logo})` `makePackaging({icon})`
`makeContentCard` `makeDeliveryBike` `makeHeadphones`. Cast: `makeFounder(ctx,'red'|'green')`, `makeBusyPro` (+`.hurry(t)`), `makeCrowdMember(ctx,type,seed)`.
Every signature + set() keys is in the header of `engines/voxel/kits/shopfront.js`.

## 10. Build new props and characters for ANY topic

You will need things the kits do not have (a laptop, a rocket, a bank vault, a dentist chair). Build them procedurally:

```js
// scenes/mykit.js
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
const C = L.C;
// a chunky laptop: origin = bottom centre, faces +Z, screen painted once; set({ open 0..1, glow 0..1 })
export function makeLaptop(ctx, { color = '#9aa3ad', screen = 'HELLO', w = 2.4 } = {}) {
  const group = new THREE.Group(), body = L.mat(color, { rough: 0.5, metal: 0.3, felt: 0.4 });
  L.B(w, 0.14, w * 0.66, body, { r: 0.06, y: 0.07, parent: group });                       // base
  L.B(w * 0.86, 0.02, w * 0.4, L.mat('#2b2b33'), { r: 0.01, y: 0.15, z: -0.05, parent: group }); // keys
  const lid = new THREE.Group(); lid.position.set(0, 0.14, -w * 0.33); group.add(lid);
  L.B(w, w * 0.62, 0.1, body, { r: 0.06, y: w * 0.31, parent: lid });
  const scr = L.decal(w * 0.88, w * 0.52, (g, W, H) => { g.fillStyle = '#1d2a44'; g.fillRect(0, 0, W, H);
    L.inkText(g, screen, W / 2, H / 2, { size: H * 0.3, maxW: W * 0.85, color: '#ffe2a8', wear: 0 }); }, { basic: true });
  scr.position.set(0, w * 0.31, 0.06); lid.add(scr);
  const c = { group, lid, set({ open = 1, glow = 1 } = {}) { lid.rotation.x = -(1 - open) * 1.5; scr.material.opacity = glow; return c; } };
  return c.set();
}
```
Rules:
1. **Bevelled boxes first** (`L.B`, r 0.04-0.15), cylinders/spheres sparingly. Chunky, slightly oversized details read better than accuracy.
2. **Felt on everything** (`L.mat`); metal/glass get `felt: 0.2-0.4`. Light sources and screens: `L.glowMat` or `decal(..., {basic:true})`.
3. **Face +Z, floor at y = 0, origin = bottom centre** (or centre for flat cards). Document the origin in a one-line comment.
4. **Factories only build**; return `{ group, ...handles, set(params) }`; `set()` is a pure function of its params (no accumulation),
   called EVERY frame with all animated keys; missing keys = rest pose. Redraw canvases only when a value changes (cache a key string).
5. **No Math.random / Date**: `L.rng(seed)`. No network textures; paint canvases (`ctex`, `paperFill`, `inkText`, `drawIcon`).
6. **Text ≥ 40 px on screen**; 1-3 words; `inkText` auto-shrinks to `maxW`. `await L.libFonts()` before painting text.
7. Size against a person (2.4 tall): a cup ~1, a laptop ~2.4 wide, a door 3.2 tall, a shop 8 tall. Toy proportions, big and readable.
8. Palette from `L.C` / `KT.K`; 2-3 colours per prop; darker trim via `L.mixHex(color, '#000', 0.25)`.
9. Characters: build on `makePerson` (outfits, accessories, hats on `p.top`, held props via `holdR`), never a new body type.
   Mascots/animals: same language (rounded boxes, painted eyes with `decal`), squash on `set({hop, squash})`.
10. **Preview it**: add a page to `kit_preview.js` and run `stills <project> 9 --only kit`. Check scale next to a person, the felt, the text.

**Your own topic kit** (when a reel needs 4+ custom props, or for a series): one file `scenes/<topic>kit.js`, header listing every factory
`name(ctx, opts).set({...})` with origin and units (copy the header style of `shopfront.js`), a `K` palette object, imports only
`base.js` / `people.js`. Add one preview page per 6-8 props.

## 11. Recipes (copy, then cue on your words)

**Shutter slam open** (store opens, launch, reveal):
```js
const top = T.open + 0.13, tt = t;
const shutter = tt < T.open ? 1 : tt < top ? 1 - U.easeIn(U.inv(T.open, top, tt)) : (tt < top + 0.22 ? Math.sin(U.inv(top, top + 0.22, tt) * Math.PI) * 0.13 : 0);
shop.set({ shutter, open: U.spring(U.inv(top, top + 0.6, t), 2.2, 4.5) * 0.85, sign: U.smooth(U.inv(top, top + 0.16, t)), t });
ctx.shake = Math.max(0, 0.7 * Math.exp(-(t - top) * 9)) * (t > top ? 1 : 0); ctx.flash = t > top ? 0.15 * Math.exp(-(t - top) * 22) : 0;
```
**Crowd flood** (everyone, the market, followers): build 8-12 `extraPerson` at home spots in two clusters; per person
`k = U.smooth(U.inv(T.flood + delay, T.flood + 0.8 + delay, t))`, `x = home.x + side * (1 - k) * 7`, while `k < 1`: `walk: t * 2.4`,
`turn: -side * 70`, small bounce; after: face the camera/hero, `hop: U.hopAt(t, T.cheer + i * 0.04, 0.4)`, arms up. (template `s02_middle.js`, library `k05_crowd.js`)
**Label cards per word** (lists, names, features): `ctx.keyWords(spec, 4)` or your own words → one `makeLabelCard` each; on its word it flies
from +2.5 z and slaps onto a board (scale squash `U.landSquash`), `ctx.shake` 0.3, SFX `pop`, hard cut to a shot framing that card + the
presenter, presenter points at the newest card; end on a wide of all cards + sparkle. (template `s02_middle.js`)
**Marquee slam + strike-through** (myths, "not X"): `KT.makeBigSign(ctx, 'BIGGEST AUDIENCE', {crossStyle: 'x'})`; drop
`group.position.y = (1 - U.backOut(k)) * 6` with `k = inv(T.say - 0.12, T.say + 0.18)`; `set({ lit, t, cross: U.smooth(U.inv(T.no, T.no + 0.28, t)) })`;
people `expr: 'shock'` on the cross. (template `s01_hook.js`, library `k08`, `k13`)
**Checklist tick**: `L.makeChecklist(ctx, {title, items})`, pop with `backOut`, `set({ ticks: [T.a, T.b, T.c].map(x => U.smooth(U.inv(x, x + 0.18, t))) })`, sparkle on the last.
**Scale tipping** (comparison): `KT.makeScale(ctx, {left, right})`; drop props into `.panL/.panR` on words; `set({ tip: lerp(-0.3, 1, U.spring(U.inv(T.win, T.win + 0.5, t))) })`, shake + confetti on the slam. (library `k11_reason.js`)
**Confetti / sparkle payoff**: `L.makeConfetti(ctx, {n: 110, spread: 7, height: 7})` at the hero, `set({ k: U.inv(T.win, T.win + 2.4, t) })`;
`L.makeSparkle(ctx, {size: 1.2})` beside the hero prop, `set({ k: U.inv(T.win, T.win + 0.9, t) })`. Biggest moment of the reel only gets both + flash.
**CTA**: the template `s04_cta.js` is a DEFAULT built from the reference reel's set (`makeShop` ×2 + `makeBigSign`). For a real reel
**replace it with a CTA set from this reel's own world** (its hero prop, its place), and keep the three parts that make it work: the
**big readable keyword**, the **comment bar typing it**, and the **cast pointing at it**. What the template does:
green `COMMENT ${ctx.keyword}` marquee slams on "comment", the cast hops in and points, bulbs on the keyword,
comment bar types it, wide with everyone pointing + confetti. Its framing is checked: the whole sign (6.6 wide, board from y 3.4, above the
cast's heads and hats even mid-hop) and the whole comment bar (avatar to Post) stay inside x 60..1020 / y 280..1440 in every shot, with the
cameras 17-21 away and a little high (y 4-5) so sign, bar and faces stack without overlapping. If you change the sign size or keyword
length, keep that: wider sign = cameras further back (section 5), and re-check stills on the comment word, the typing and the wide.

## 12. Review checklist (look at every sheet before any video)

- [ ] Frame 0 is mid-action and readable as a thumbnail (people + one big prop + the headline).
- [ ] Every beat: ≥ 2 hard cuts on words, a pop/hop every 0.3-0.5 s, the camera always drifting. Nothing static for > 1 s.
- [ ] One hero per moment, landing ON its word (scrub `?t=` around the word: ±0.05 s).
- [ ] Faces and prop text inside y 280-1440 px, x 60-1020; nothing important under the captions or the headline.
- [ ] No sign or text cropped at the frame edges (`BAKERY 1` → `AKERY 2` across two signs is the classic): every sign is fully inside
      x 60..1020, or deliberately off-frame by > 40 % so it reads as background. Check whole words on every sign, bar and label.
- [ ] No hats/heads/props covering sign letters (raise the sign: its board bottom above ~3.4 when people stand in front of it).
- [ ] Prop text ≥ 40 px, readable states held ≥ 0.4 s. Headlines ≤ 24 chars.
- [ ] `ctx.focus` on the hero (sharp), background blurred but readable; no camera inside geometry, no black/void frames (check whips).
- [ ] People act: pointing at the hero prop, looking at it, reacting with expressions; the same cast across beats.
- [ ] Felt look intact: no flat plastic colours, no glowing paper (`tone: 'bright'` on interior beats), warm light.
- [ ] Nothing important on a beat's last ~0.25 s (the whip-out blur) unless that beat has a small `whipLead`.
- [ ] No `warning: U.shots dropped cut` in the stills output; SFX ≤ ~1.5 cues/s, light cues ≥ 0.35 s apart.
- [ ] Deterministic: no Math.random / Date; stills match the video.
- [ ] CTA: `COMMENT <KEYWORD>` sign readable for ≥ 1.5 s; keyword matches reel.json.
- [ ] The page console is clean (reel.mjs prints page errors after a render).
