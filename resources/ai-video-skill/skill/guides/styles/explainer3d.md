# explainer3d: the 3D "how it actually works" explainer

Read this whole guide before writing a scene. It is the contract between you (writing `plan.js` and `scenes/*.js`)
and the engine (`engines/explainer3d/core`, never edited per reel).

The look in one line: **one beautiful hero object per beat, lit like a product film, the invisible mechanism made
visible with glowing blue energy, a camera that never stops moving, whip-pan cuts on the words, and captions where
the word being said is white and one key word wears a blue selection box.**

Two looks share that grammar, picked per reel (`reel.json "look"`) or per beat (`look` in `plan.js`):

| | `studio` (default) | `city` |
|---|---|---|
| for | objects and mechanisms: phone screens, batteries, engines, coffee machines, chips, cells, locks | anything spread over space: maps, delivery, networks, signals, travel, tracking |
| world | dark gradient studio, glossy floor disc that fades out, soft room reflections | seeded low-poly "paper city" at golden hour: suburb, highway, downtown, live traffic |
| units | **cm** (a phone is 7.2 x 15 x 0.8) | **m** (a car is 4.4 m, the city is ~2 km across) |
| light | key `#fff4e8` 2.2 + cool rim `#7fb0ff` 1.4 + hemi 0.35 + RoomEnvironment 0.55 | low warm sun `#ffeed6` 2.9 + sky hemi 0.95, distance fog `#ece4d6` |
| post | ACES, exposure 1.0, bloom 0.7 / radius 0.55 / threshold 0.82, vignette, grain 5% | ACES, exposure 1.02, bloom 0.55 / 0.6 / 0.9, light vignette, grain 5.5% |
| captions | "box" style at the top (y 250) | "pill" style low (y 1432) |
| labels | white text + dot + ring + thin leader line | paper pill (mono) + square leader line + dot |
| transition | whip pan (yaw up to +-14 deg, smaller for close shots, roll, 38 px motion blur; `whip` per beat) | swoop (fly up and over) between city beats; whip to/from studio |
| kits | `kits/studio.js` | `kits/city.js` (automatic) + `kits/gadgets.js` |

Every beat lives at its own **station** in space. Studio beats get `spec.o = [n*120, 0, z]` (never hard-code it, always
build around `spec.o`). City beats share the one city (`ctx.city`, absolute coordinates, `spec.o = [0,0,0]`).

---

## Creativity first (read before the storyboard)

The kits in this guide are the creator's props from HIS earlier reels (the charge orbs, wire grid and hand came from the
touchscreen reel; the coin tracker and handset from the tracker reel). They exist for building blocks and a consistent look,
not to carry your idea. Read **`guides/patterns_3d.md`** (the invention method, worked examples, effort numbers and reference
strips) and then:
- **Every reel invents its own central visual**: a world and a substance for the invisible process, named in one sentence
  ("a city of strangers' phones passing sealed notes", "the route cracks into tiles that stack into a tower of minutes").
  Waves or lines floating in a black void are a diagram, not a world.
- **Build 3+ custom hero props** for THIS script in `scenes/kit.js` / `scenes/<id>_kit.js` (8-15 named builders in total is
  normal), plus at least one scale jump and one change of visual language when the explanation changes level.
- **Stock props never carry the idea.** `makeCharges`, `makeGrid`, `makeHand`, `makeTracker`, `makeHandset`: at most once each,
  only if the script is literally about them. `makeHand` as a hand, the city and studio backdrops: fine.
- **Before the final**: `node tools/reel.mjs craft <project>` (≥ 35 lines/s, ≥ 1.5 helpers/s, no stock prop reused) and
  `node tools/reel.mjs motion <project>` must both pass.


## Quality bar (read before writing any scene)

The creator's explainers measure **motion 12.6-16.8** and **4-5 big changes per second** (`reel motion <project>` prints yours; target ≥ 11 and ≥ 3.5, flat ≤ 8%). The first buyer test landed at 9.5: correct, but too calm. What the creator's reels do that a "correct" reel doesn't:
- **The camera never stops.** Every shot drifts, orbits, dollies or cranes (even holds have `drift`), and the move changes direction or speed on stressed words. A static camera on a static object reads as a slide.
- **A camera beat every ~1 s.** Cut to a new angle, push in, rack focus, x-ray, or whip on the stressed word. Inside one explanation, alternate wide (context) → close (mechanism) → wide.
- **Something physical happens on every stressed word:** a part slides out (exploded view), a ring pulses, a packet flies, a value rolls, a label snaps on. Plan it per word, not per sentence.
- **Mechanisms move continuously** (waves travel, gears turn, charges flow, cars drive) so even "holds" are alive.
- **Flash/shake/bloom on impacts** (ctx.flash, ctx.shake, ctx.bloomK) and SFX on them: that's what makes a hit feel like a hit.
- Planning template per beat: `camera path (from → to, on which words) | what moves on each stressed word | what keeps moving | label/number | transition out`.
After the draft: `reel motion <project>`, then fix every flat stretch it lists before the final render.

## 1. Workflow (what you write)

```
<project>/
  reel.json        {"style":"explainer3d","name":"...","look":"studio","cta":{"keyword":"LINK","title":"Comment","sub":"and I'll send it to you"},
                    "captions":{"keys":["grid","charge","dip"],"style":"auto"},"tail":1.0}
  script.txt       the voiceover (tools/tts.py makes audio/vo.mp3 + build/words.json)
  plan.js          beats cued on words (section 3)
  scenes/<id>.js   one module per beat (section 4)
  index.html       from the template, never edit (page contract lives in /engine/core/main.js)
  showcase.html    kit preview (render: node engines/explainer3d/tools/showcase.mjs <project>)
```

1. Script first (short spoken sentences, hook first, CTA "Comment KEYWORD ..." last). Voice it with `tools/tts.py`.
2. Storyboard: one row per beat: words -> hero object -> what changes on which word -> camera move. A visual event every 1-1.5 s.
3. `plan.js`, then scenes. Start from the template scenes (`hook.js`, `explain.js`, `cta.js`, `city_example.js`) and from
   `library/explainer3d/` (real scenes, see its INDEX.md).
4. `node tools/reel.mjs stills <dir> 0.5 2 4 ... --only <id>` while building one scene; LOOK at `stills/sheet.jpg`.
5. Review with the checklist (section 11), then `reel video <dir>` (draft) and `reel export <dir>`.

---

## 2. Tokens

Studio palette `ctx.P` (`core/palette.js`), colour = meaning:

| token | hex | meaning |
|---|---|---|
| `P.bg` | `{top:#0b0d12, mid:#0f1219, bottom:#06070a}` | backdrop gradient (override per frame with `ctx.bg`) |
| `P.charge` / `P.chargeHot` | `#2a7afc` / `#7fb4ff` | THE accent: energy, data, signal, "the thing that matters" (same blue as the caption box) |
| `P.body` / `P.bodyHot` | `#ffb04a` / `#ffd59a` | second energy: warm amber (the human, heat, input, the cause) |
| `P.dip` | `#ff5a3c` | loss, missing, drop |
| `P.no` | `#ff3b4a` | rejection, X, fail |
| `P.ok` | `#34d27b` | success, "that works" |
| `P.wireRow` `P.wireCol` `P.glass` | `#3b7cff` `#9fc2ff` `#c9dcff` | structure lines, glass tint |
| `P.phoneBody` `P.phoneFrame` `P.skin` `P.glove` `P.water` `P.snow` `P.floor` | | materials |

City palette `ctx.C`: world `skyTop #b9cbe0, skyHorizon #f1e7d8, fog #ece4d6, ground #e6dfd2, block #efe9de, asphalt #40454d`,
signal colours `route #2f6bff` (you / your thing), `live #1fbf6a` (fine, flowing), `slow #f5a524` (warning), `jam #ec4a3c` (bad),
`forecast #8a5cf6` (predicted, model, future), `history #8b98ab` (past), `phone #3b82f6` (devices, pings), `ink #141820`, `paper #fbf8f2`.

Type (all from `/fonts/`, every stack ends with `Fallback`): captions + labels + big numbers **Figtree** (700 / 500), HUD values
**Inter** 800, micro-labels and kickers **JetBrains Mono** 700 caps with letter-spacing .16em. Canvas text inside 3D (phone screens,
cards): Figtree / Inter / 'JetBrains Mono'. No em dashes in any on-screen text.

Materials: glossy, physically lit, "designed" proportions (rounded radii, bevels, consistent thickness). Anything meant to glow is
emissive or `toneMapped:false` with colour > ~0.85 so bloom catches it; lit surfaces stay under the threshold (never brighten a
white material to make it pop, raise `ctx.bloomK` for a beat instead).

---

## 3. Layout and safe zones (1080 x 1920)

- Instagram UI covers the bottom ~300 px and the right ~120 px: key content above y 1400 and inside x 60..1020.
- **studio**: captions occupy y 250..420 over a dark top wash (y 0..640). Keep the top ~460 px free of important action:
  frame the hero in the middle/lower two thirds (aim the camera target ABOVE the object so it sits lower). A hand or finger
  must not cross the caption band (bring hands in from the side: yaw ~90-100, not from the top). `ctx.capDy` pushes captions
  down for a frame if a shot truly needs the top.
- **city**: optional top card y ~150..260 (`hud.card`), chip at y 1306 (`hud.chip`), caption pill y 1432..1520. Key action y 330..1290.
- Labels: 1-3 on screen at most, short lowercase nouns ("cover glass", "4 min", "the dip"), always pinned to the thing.
- Text on screen >= 40 px tall at 1080 wide (labels are 34 px Figtree with a sub line: keep them few and big enough).

---

## 4. The plan (`plan.js`)

```js
// R = { words, sentences: [{t0, t1, text, words, i0, i1}], end, wordAt(phrase, from=0, nth=0), find(phrase), wi(index), reel }
export default function plan({ sentences, wordAt, end }) {
  return [
    { id: 'hook',    t0: 0 },
    { id: 'layers',  at: 'under the glass', blend: 0.8 },          // a word or phrase (first occurrence)
    { id: 'charge',  at: 'charge', blend: 0.6 },
    { id: 'map',     at: 'across the city', look: 'city', blend: 0.9 },
    { id: 'cta',     t0: sentences.at(-1).t0, blend: 0.8 },
  ];
}   // or return { beats, duration, keys: [...extra caption key words] }
```

Beat fields: `id` (`scenes/<id>.js`), `t0` seconds OR `at` (word / phrase / word index), `look` (`'studio'|'city'`, default reel.json),
`blend` (transition length INTO the beat, default 0.8 s, 0 = hard cut), `transition` (`'whip'|'swoop'|'cut'`; default swoop between two
city beats, whip otherwise), `whip` (shape of the whip INTO this beat, see below), plus any custom fields you want to read from `spec`.

**`whip`** (optional, per beat). By default the whip yaws 14 deg, its direction alternates by beat index (beat `n` odd pans LEFT,
even pans RIGHT; you never need `spec.n % 2` tricks), roll = 0.12 deg per yaw deg, and in the studio the yaw shrinks with the
framing distance of each half (`yaw x clamp(distance / 30 cm, 0.3, 1)`), so a 7 cm macro shot whips ~4 deg and the hero stays
partly in frame. Override per beat:
```js
{ id: 'macro', at: 'the coil', whip: 5 },                                  // fixed 5 deg (no distance scaling), default direction
{ id: 'side',  at: 'meanwhile', whip: { dir: 'right', yaw: 10, roll: 0 } }, // any subset of dir 'left'|'right', yaw, roll, auto
{ id: 'soft',  at: 'then', whip: 0 },                                      // blur only, no pan
```
An explicit `yaw` turns the distance scaling off (add `auto: true` to keep it). `t1` = next beat's `t0`; the last beat ends at
`end + reel.tail`. A cue that is not found is spaced evenly between its neighbours (a warning is printed).
Beat length: 2-6 s. Over ~6 s, split into two beats (new station, new camera language).

---

## 5. Scene contract

```js
import * as THREE from 'three';
import { makePhone, makeHand, studioFloor } from '/engine/kits/studio.js';
let S = null;                                     // module state = handles built in init, never animation state
export default {
  init(ctx, spec) { /* build once: kits, meshes, materials; ctx.sfx(...) cues; ctx.traffic.addSlow(...) */ },
  update(ctx, t, spec) { /* EVERY frame for EVERY scene, absolute t: set every parameter you use as a pure function of t */ },
  camera(ctx, t, spec) { return { pos: [x,y,z], target: [x,y,z], fov: 32, roll: 0 }; },   // optional near / far
};
```

Rules:
- **Pure function of t.** Frames render in any order. No `Math.random` (use `ctx.U.rng(seed)` in init), no `Date` /
  `performance`, no accumulating state between frames, no "if first frame". Kit objects KEEP state, so set every
  parameter you use every frame (pose, charge, look, alpha), even when it is the default.
- **Hide outside your window**: `if (!spec.on(t)) { group.visible = false; return; }` (`spec.on` = `[t0 - blend/2, t1 + nextBlend/2]`).
  Your objects stay visible during both halves of the transition (the whip shows them).
- Set per-frame overrides (`ctx.flash`, `ctx.shake`, `ctx.bloomK`, `ctx.exposure`, `ctx.bg`, `ctx.capDy`, `ctx.capHide`) only while
  your beat is current: `if (t >= spec.t0 && t < spec.t1) { ... }`.
- `camera()` is also called up to `blend/2` before `t0` and after `t1`: clamp t (`U.clamp(t, spec.t0 - 0.6, spec.t1 + 0.6)`), never explode.
  Keep the camera MOVING the whole beat (at least a slow drift).
- Anything that must face the camera or project to the screen goes in `ctx.after.push(() => ...)` (runs after the camera is placed).
  Never read `ctx.camera` inside `update` directly (it still holds the previous frame).
- Builders only create: call kit builders in `init`, never in `update`. Geometry is cached by the kits; your own geometry
  goes in init too (or a module-level cache).
- SFX are static cues: call `ctx.sfx(t, name, gain)` in `init` (names: whoosh swoosh pop click tick ding thud impact boom shimmer
  riser type cash stamp). Transitions get a whoosh automatically. Keep it sparse: one sound per real event.

### `spec` (per beat)
`id, n, t0, t1, dur, blend` (in), `out` (next beat's blend), `look, transition, o` (station `[x,y,z]`), `words` (this beat's words
`{w,s,e,i}`), `line` (text), plus your custom plan fields, and helpers:
- `spec.cue(word, frac = 0.5, nth = 0)`: time of that word (or phrase) inside this beat; if it is not there, `t0 + frac * dur`.
  **Always cue with a sensible fallback**, so the scene works with any voiceover. `spec.cue(3)` (a number) = the 4th word of this beat.
  **Short repeated words are ambiguous**: `spec.cue('it')` in "it charges it" always hits the FIRST "it". Cue a longer phrase
  (`'charges it'`), a word index (`spec.cue(2)`, indices from `spec.words` / `spec.line`), or pass `nth` explicitly. A cue word of
  1-2 letters said more than once in the beat (without `nth`) prints a warning in the stills / render error list.
- `spec.wt(i, frac)`: start of the i-th word of the beat (negative = from the end).
- `spec.k(t)`: 0..1 progress through the beat. `spec.on(t, pad)`: inside the visible window.

### `ctx`
- `THREE, scene, camera, renderer, composer, bloom, key` (= `sun`), `rim, hemi, W, H, FPS, DURATION, PLAN, reel, look` (this frame's look)
- `P` (studio palette), `C` (city palette), `U` (util, below), `fx` (DOM layer for your own overlays), `hud` (section 7)
- words: `words, sentences, wordAt(phrase, from, nth)`, `find(phrase, from, nth)` -> word object, `wi(i)`
- `station(spec)`: a world-aligned `THREE.Group` added to the scene (put your kit objects in it and place the hero at `spec.o`)
- `light(type, o)`: a point / spot light that behaves at centimetre scale (section 10, "Extra lights"), `init` only
- `sfx(t, name, gain)` (init only)
- city: `city` (alias `world`), `traffic`, `ribbonGeometry`, `ribbonMaterial`, `carGeometry`
- per-frame overrides (reset every frame): `bg {top,mid,bottom}`, `exposure`, `bloomK`, `fog {near,far,color}`, `capDy` (px),
  `capHide`, `flash` 0..1 (white), `shake` 0..1, `after[]`
- debug: `window.__cam = {pos, target, fov}` freezes the camera; `?only=<id>` runs one scene (plus the neighbour beat while a
  transition into / out of it is on screen, so `reel stills <dir> <t in the blend> --only <id>` shows the real whip frames).

### `ctx.U` (core/util.js)
`rng(seed)` mulberry32 -> `() => 0..1` · `clamp(x,a=0,b=1)` · `lerp(a,b,k)` · `inv(a,b,x)` 0..1 progress of x through [a,b] ·
`smooth` `smoother` `easeIn` `easeOut` `easeInOut` `expoOut` `backOut(k,s)` · `spring(k,freq=3.2,damp=5.5)` overshoot then rest at 1 ·
`win(t,t0,t1,fadeIn=.4,fadeOut=.4)` 0..1 window · `track(keys,t,ease)` keys `[[t, number|array]]` eased per span ·
`pose(pos,target,fov=35,roll=0)` · `poseTrack(keys,t,ease)` eased pose keys (stops at each key) ·
`crTrack(keys,t)` Catmull-Rom through keys (no stops) · `poseSpline(keys,t)` flowing camera through pose keys ·
`orbit(target,dist,azimuthDeg,elevDeg,fov)` · `v3(arr)` `arr(v3)` · `drift(t,seed)` smooth handheld noise -1..1 ·
`wobble(t,t0,freq=32,decay=7)` decaying oscillation after an impact · `pulse(t,t0,decay=9)` decaying 1 -> 0.

---

## 6. Captions (automatic)

Built from `build/words.json`; you never draw spoken words yourself.
- **box** (studio): Figtree 72 px, <= 4 words a line, <= 2 lines, centred at y 250. Each word pops when said (expo, blur 14 -> 0,
  18 px rise); the current word is white 700, said words grey `#6b6b6b` 500; ONE key word per group gets the blue box
  (`rgba(42,122,252,.2)` fill, 3 px `#2a7afc` border, two round blue handles). A group leaves 0.12 s before the next starts.
- **pill** (city): a dark glass pill at y 1432, Inter 700 50 px, words grey until said, then white.
- `reel.json captions`: `{ "keys": [...], "style": "auto"|"box"|"pill", "off": false, "y": 250, "size": 72 }`.

**Choosing key words** (`captions.keys`, 6-15 per reel): the nouns and verbs that carry the idea and that you SHOW on that word
(the hero object, the mechanism, the twist, the number): "grid", "charge", "dip", "conducts", "forecast", the CTA keyword.
Never a pronoun, filler or a word that is not on screen. Only the first key word of a group gets the box, so two keys in one
phrase is wasted. If a key word must land as a visual, cue the visual on the same word.

---

## 7. HUD (`ctx.hud`, immediate mode: call every frame you want it)

- `hud.label(key, anchor, text, o)`: label pinned to a 3D point (`Vector3 | [x,y,z]`) or `{x, y}` px, projected after the camera.
  `o = { dx=60, dy=-90, alpha, style: 'line'|'pill' (default by look), sub, small, color (pill swatch), dark, size, dot=true, line=true, align }`.
- `hud.card(o)` (alias `eta`): glass info card, top centre. `o = { kicker:'ARRIVE', value:'6:42', prev:'6:39', k (0..1 digit roll), unit:'PM',
  sub:'23 min', state:'live'|'ok'|'warn'|'bad'|'future'|'accent'|'route'|'past', color, icon:'nav'|'tag'|'dot'|'bolt'|<svg>, iconColor, alpha, y=150, dy, scale }`.
  Rolling digits: keep `prev` and animate `k` 0 -> 1 on the word.
- `hud.chip(o)` (alias `status`): `{ label:'LIVE  58 MPH', color, alpha, x=64, y=1306 }`.
- `hud.big(key, text, o)`: big Figtree number/word `{ x=540, y=760, size=160, color, alpha, weight, sub, mono, scale, shadow }`.
- `hud.layer` / `ctx.fx`: your own DOM (create once in init, style in update, hide outside your window).
- Gate HUD calls of a city scene with `if (ctx.look === 'city')` so they do not ride into the next studio beat's whip.

The studio kit also has `makeLabel` (same look as `style:'line'`, object API) if you prefer handles.

---

## 8. Kits (full API)

### 8.1 `kits/studio.js` (cm, +Y up, a phone lies flat with its screen facing +Y and its top at -Z)
Factories return `{ group, ...handles, set... }`; add `.group` to your station. Every call makes fresh materials; geometry is cached.

- `makePhone(ctx, { look='off', grid, shadow=true })` -> `{ group, layers {glass, sensor, display, body}, glass, grid, screen, ui, mats, size }`
  - `look(name, params)`: `'off' | 'home' {open, hide, ghosts, glitch} | 'call' {name, sub, ring, answer, decline, answered, time} | 'map' {zoom, cx, cy} | 'solid' {color, color2}` (redraws only on change)
  - `screen.draw((g, W, H) => ...)` custom 600x1302 canvas; `screen.brightness(k)`; `ui.answer|decline|end` = `[u, v]`
  - `screenPoint(u, v, out?, lift=0)` world point on the glass; `uvOf(world)` inverse; `size.glassTop` (0.415)
  - `touchAt(u, v, k, slot=0, {color, size})` glowing touch ring (k 0..1); `clearTouches()`; `contactShadow(u, v, r, alpha)`
  - `explode(k, {gap=1, grid=true})` layers lift apart (glass +5.6, grid +3.6, display +1.8); `grid.alpha(a)` x-ray grid without exploding
- `makeGrid(ctx, { cols=9, rows=18, w=6.4, h=13.9, orb=0.085, barH=2.4, sheet=true, dipTint=true })` capacitive-style grid of glowing wires + orbs
  - `reset()` (top of update), `reveal(k)` draw-on, `scan(k, {axis:'row'|'col', width})` sweep (k<0 off), `setCharge(i,j,v)`, `setChargeFn(fn)`,
    `setDips([{x,z,r,depth}], base)`, `bars(k)` 3D bar field, `pulse(fn)`, `alpha(a)`, `orbs(k)`, `wires(k)`, `set({...})`,
    `pos(i,j)` world point of a crossing, `toLocal(world)`, `nearest(x,z)`, `charge(i,j)`, `xs[] zs[]`. Reads as ANY lattice: pixels, cells, sensors, data.
- `makeHand(ctx, { glove: null|'knit'|'touch', side:'right'|'left', skin, shadow })`, `makeFinger(ctx, opts)` (index finger only)
  - `point({pos, tilt=25..55, yaw, curl})` anchor = index pad; `pinch(spread, {pos, yaw, lean})`; `flat({pos, tilt, yaw})`
  - `tip()`, `thumbTip()`, `fingerPoint(s)` (0 forearm .. 1 tip), `xray(k, color)` glass skin + glowing core, `threadGlow(k)`; `HAND_POSES` (copy to make new poses)
- `makePen(ctx, { kind:'ballpoint'|'stylus', color, len=14 })` -> `set({pos, tilt, yaw})`, `press(k)`
- `makeCharges(ctx, n=200, { color=P.charge, size=0.09, glow=2.4 })` instanced glowing particles in WORLD space:
  `hideAll()`, `setP(i, x, y, z, scale)`, `setColor(c)`, `alpha(a)`
- `makeFieldLines(ctx, { max=48, color, radius=0.035 })` glowing curved tubes: `set([{from, to, ctrl?, lift?}])`,
  `fromCrossings(grid, [[i,j]...], target, lift)`, `update({k, phase, alpha, color, dash, flow, base})`
- `makeDrop(ctx, { r=0.55, color })` water bead: `set({pos, mode:'sit'|'fall', radius, squash, alpha})`, `splash(k, {ringR})`
- `makeLabel(ctx, text, { sub, dx, dy, size=34, color, subColor, dot, line, align })` -> `set(world, alpha, {text, sub, dx, dy})`, `hide()`
- `makeIcon(ctx, kind, { size })` glossy 3D glyph facing +Z (~4 units): `'x' 'check' 'snow' 'gauge' 'bolt' 'water' 'na' 'cl' 'salt' 'question'`;
  `pop(k)`, `glow(m)`, `set(v)` (gauge needle)
- `studioFloor(ctx, { r=70, y, color='#0d1016', shadow=0.55 })` glossy fading floor disc + shadow catcher
- `makeTouchRing(ctx, {color, rmax})` -> `{mesh, set(k, {size, alpha, color})}`
- helpers: `fade(obj, a)` (multiplies every material opacity, hides at 0), `bezier(a, ctrl, b, k)`, `rng`, `toV3`, `mixHex(a,b,k)`,
  `glassify(mat, boost, maxOut)` (glass that keeps highlights while transparent), `capGlare(mat, max)`, `libEnv(ctx)` (studio reflection env for your own materials)

### 8.2 `kits/city.js` (m; built automatically as `ctx.city` when a beat has `look:'city'`)
- `ctx.city.paths.{route, alt, highway, onRamp, exitRamp, altRamp, feeder, feederStreet}`: `{ length, at(s), tangent(s), side(s, offRight, dy), nearest(p) }`.
  `route` = driveway (`s=0`, suburb south-west) -> on-ramp -> elevated highway (y 8, half width 13, lanes +-2.8/6.4/10) -> exit -> downtown destination tower.
- `ctx.city.landmarks.{home, homeDoor, dest, destTop, downtown, merge, exit, altBranch, feederMerge}` (Vector3), `ctx.city.s.{...}` key distances,
  `ctx.city.segments` 8 pieces of the route `{i, s0, s1, mid, minutes}`, `ctx.city.lists.{towers, mids, houses, trees}`, `ctx.city.group`.
- `ctx.city.hero`: the blue car (hidden every frame by core). Show it: `hero.schedule({go, branch, speed})` then `hero.mesh.visible = true; hero.update(t)`;
  `hero.poseAt(t)` -> `{pos, dir, onAlt, s}`; `hero.halo` (blue disc, set its opacity).
- `ctx.traffic` (~400 instanced cars, precomputed): in **init** `addSlow({path:'highway', s0, s1, t0, t1, factor=0.25, ramp, tIn, tOut, dir})`
  (queues grow backwards by themselves); `carsOn(path, s0, s1, t, dir)` -> indices; `poseAt(i, t)` -> `{pos, dir, speed}`; `hiddenSet`.
- `ctx.ribbonGeometry(path, s0, s1, width, {off, dy, step, profile})` + `ctx.ribbonMaterial(color, {opacity, glow, dash, dashSpeed, edge, depthTest})`:
  flat strips hugging a path. Uniforms: `from`/`to` (0..1 reveal), `opacity`, `glow` (> 0.5 blooms), `dash`, `dashPhase`, `len`. THE tool for routes, flows and highlights on roads.
- `carGeometry()`.

### 8.3 `kits/gadgets.js` (m, objects face +Z, for the city look)
- `makeTracker(ctx, {scale=1, shadow})` coin tracker (dome +Y): `userData {radius, top, bottomY}`
- `makeSuitcase(ctx, {color, handle=1, lite})`: `userData {tagSlot, shell (fade it for x-ray), contents, wheels, handleTop, height}`
- `makePerson(ctx, {seed, phone, phoneIn:'pocket'|'hand', color, height})` + `walk(person, t, {path, s0, speed, t0, t1, off, stride})` (pure); `userData {phone, gait(phase, amp)}`
- `makeHandset(ctx, {w=0.075, screen:'live'})` phone at metre scale: `userData.screen.draw(fn)`; our own UIs:
  `drawMapScreen(screen, {t, label, sub, dist, pinXY, you, pan, zoom, kicker})`, `drawArrowScreen(screen, {t, angleDeg, distance, sub, label, kicker, chip, k})`
- `pulseRings(ctx, {color, maxR=4, count=3, period=1.6, mode:'flat'|'billboard'|'sphere', width, glow, normal, fill, speed})` -> `update(t, origin, alpha)`, `setColor(c)`
- `makePacket(ctx, {color})` sealed note card + `flyArc(obj, from, to, k, {lift, wobble, ctrl})` -> point
- `makeCloud(ctx)` server vault with padlock: `userData {inlet, lock, glow, keyhole}`
- `makeContactShadow(ctx, {w, d, opacity})`, `linePath(points)` (path API), `placeOnPath(obj, path, s, off, dy, {pitch})`, `look(from, to, fov, roll)`, `fade(obj, a)`, `libEnv(ctx)`
- sets placed in the city (`LOC` points): `initLib(ctx)`, `LOC.{airport, cartPath, shuttleStop, rampPath, shuttleRoute, hotel, hotelFront, lobbyWalk, street, streetWalk, stage}`,
  `makeAirportProps`, `makeShuttle`, `makeHotelLobby`, `makeStreetProps`, `makeEmptyRoom` (a clean lineup room at `LOC.stage`). Small things carry
  contact shadows (they do not cast sun shadows).

See every model: `node engines/explainer3d/tools/showcase.mjs <project>` -> `stills/showcase_sheet.jpg` (code: `engines/explainer3d/tools/showcase.js`).

---

## 9. Building NEW props for any topic

The kits cover phones, hands, grids, particles, cities and people. Everything else (a coffee machine, an engine, a battery cell,
a heart, a router, a turbine) you build procedurally in a helper `scenes/<id>_kit.js` (or a shared `scenes/kit.js`):

```js
// scenes/kit.js
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { libEnv, glassify } from '/engine/kits/studio.js';
const GEO = new Map(); const geo = (k, make) => GEO.get(k) || GEO.set(k, make()).get(k);   // cache geometry
export function makeCell(ctx, { color = ctx.P.charge } = {}) {
  const env = libEnv(ctx), group = new THREE.Group();
  const can = new THREE.Mesh(geo('cell-can', () => new THREE.CylinderGeometry(1.8, 1.8, 6.5, 64, 1, true)),
    new THREE.MeshPhysicalMaterial({ color: '#c9ced6', metalness: 0.9, roughness: 0.25, envMap: env, side: THREE.DoubleSide }));
  const core = new THREE.Mesh(geo('cell-core', () => new THREE.CylinderGeometry(1.4, 1.4, 6.2, 48)),
    new THREE.MeshStandardMaterial({ color: '#111', emissive: new THREE.Color(color), emissiveIntensity: 0 }));
  group.add(can, core); can.castShadow = true;
  const api = { group,
    xray(k) { can.material.transparent = true; can.material.opacity = 1 - 0.85 * k; can.material.depthWrite = k < 0.5; return api; },
    charge(k) { core.material.emissiveIntensity = 2.2 * k; return api; } };
  return api;
}
```

Conventions:
- **Builders only create** (`make*` in init); the returned API **sets state** and the scene calls it every frame.
- **Cache geometry** in a module-level Map; fresh materials per call (so fading one instance never touches another).
- **No Math.random**: `ctx.U.rng(seed)` inside the builder for any procedural variation (bolts, fins, cracks).
- **Scale**: studio cm, city m. Camera distance follows from the hero's WIDTH (see "Portrait framing" in the FAQ: a 7 cm wide phone
  needs ~28 cm at fov 32, a 20 cm head ~77 cm).
- **Shape language**: rounded boxes (`RoundedBoxGeometry`), lathes for anything round (cups, cans, bulbs, nozzles),
  `ExtrudeGeometry` of rounded shapes with small bevels for panels, tubes (`TubeGeometry` on a curve) for pipes and wires.
  Bevels catch the rim light: that is what makes it look premium.
- **Materials**: body `MeshPhysicalMaterial` (metalness 0.5-0.9, roughness 0.2-0.4, `envMap: libEnv(ctx)`, clearcoat for plastics),
  glass via `glassify(mat)`, energy parts emissive in `P.charge` / `P.body` with intensity animated 0..2.5.
- **Inside views**: build the inside as real parts (so x-ray and exploded views work): shell + internals + glowing flow path.
- **Hooks for motion**: expose `explode(k)`, `xray(k)`, `flow(k, phase)`, `glow(k)`, `pos(name)` (world anchor points for labels and particles).

---

## 10. Motion and camera language

Pacing: something new every **1-1.5 s** (a pop, a reveal, a camera change, a counter, a flash). One hero object per beat; a state
that must be read holds >= 0.4 s. Every visual lands on the word that names it (+-0.1 s): cue with `spec.cue('word', frac)`.

Camera:
- Keyframe poses ON WORD TIMES: `U.poseTrack([[spec.t0, U.pose(...)], [spec.cue('grid', .3), U.pose(...)], ...], tc)` (eases into each key,
  good for "arrive and look") or `U.poseSpline(keys, tc)` (flows through keys, good for travelling shots). Sort keys by time.
- Add life: `U.drift(tc * 1.3, seed) * 0.12` on position (cm in studio, x 2-10 in the city).
- Language changes between steps: macro push-in, orbit, top-down, low angle along a surface, crane up, snap zoom on a word.
- Roll: settle from -7 deg in the first 0.75 s of the hook; small roll (1-3 deg) on dramatic moves.
- Transitions are automatic: **whip pan** (studio) = outgoing shot yaws away (14 deg, less for close shots; per beat: `whip` in
  plan.js, section 4) with roll + motion blur, incoming spins in from the other side; **swoop** (city to city) = lift and fly over. Plan a strong first and last pose for each beat; they are the whip frames.
- Impacts: anticipation (small lift-off before), slam (fast ease-in), then `U.wobble(t, tImpact)` flex on the object,
  `ctx.shake = 0.6 * U.pulse(t, tImpact, 9)`, `ctx.flash = 0.12 * U.pulse(t, tImpact, 22)`, `ctx.sfx(tImpact, 'impact')` in init.
- Pops: `U.spring(U.inv(t0, t0 + 0.6, t))` or `U.backOut`; reveals: `U.expoOut`; never linear, never instant.
- Hook frame 0 is already moving (spin-in + light sweep + `ctx.exposure` punch from 1.7 to 1.0 over 0.18 s).

**Extra lights (units).** Studio scenes are in **centimetres**, but three.js lights use physical inverse-square falloff that assumes
**metres**: a raw `new THREE.PointLight(c, 2)` 20 cm away is ~400x dimmer than you expect, so people crank it to 500+ and the
hero blows out the moment the camera or object moves closer. Use the helper instead (in `init`):
```js
const glow = ctx.light('point', { color: P.chargeHot, intensity: 1.2, range: 8, pos: [x, y, z] });          // near a macro part
const beam = ctx.light('spot', { intensity: 2, range: 30, pos: [...], target: [...], angle: 25, shadow: true });
// update: glow.level(spec.on(t) ? U.win(t, a, b) : 0);   level(k) scales it; prefer level(0) to visible = false (no shader rebuild)
```
`intensity` is in studio units: 1 = a directional light of intensity 1 on a surface `range` cm away (the key is 2.2, the rim 1.4),
and the light fades to 0 at 4 x `range`, so it never leaks onto other stations. Set `range` to the light-to-subject distance.
Recommended: accent / glow light 0.6-1.5, practical (lamp, LED, screen spill) 1-2, a light that replaces the key 2-3; macro
shots (hero < 10 cm, camera 5-30 cm): `range` 3-10. Raw three.js equivalent if you must: `decay: 2`,
`intensity = studioUnits x range²`, `distance = 4 x range`. Never `decay: 0` (no falloff = flat, it lights every station).

---

## 11. Recipes

**X-ray reveal**: fade the shell, light the inside.
```js
const k = U.smooth(U.inv(spec.cue('inside', .3), spec.cue('inside', .3) + 0.6, t));
fade(shellGroup, 1 - 0.8 * k);  core.material.emissiveIntensity = 2.2 * k;  hand.xray(k);   // kits: hand.xray, phone.grid.alpha
```

**Exploded view**: layers apart on a spring, labels per layer, camera low along the stack.
```js
const ex = U.spring(U.inv(tc, tc + 0.9, t), 2.2, 6);   phone.explode(ex);   // own props: layer.position.y = base + gap * i * ex
ctx.hud.label('l-glass', phone.screenPoint(.12, .1), 'cover glass', { dx: -120, dy: -120, alpha: U.win(t, tc + .5, tc + 2) });
```

**Signal rings**: rhythm on words.
```js
const rings = pulseRings(ctx, { color: C.phone, maxR: 3, period: 1.6 });   // init (gadgets)
rings.update(t, emitterWorldPos, U.win(t, spec.cue('signal', .3), spec.t1, .2, .4));
// studio: phone.touchAt(u, v, U.inv(t0, t0 + .75, t), slot) for rings on glass, or several makeTouchRing
```

**Data packet flying along an arc**:
```js
const k = U.easeInOut(U.inv(spec.cue('sends', .4), spec.cue('sends', .4) + 1.1, t));
flyArc(packet, fromV3, toV3, k, { lift: 4 });        // gadgets; studio: p = bezier(a, ctrl, b, k) then charges.setP(i, p.x, p.y, p.z, s)
// trail: draw 20 particles at bezier(a, ctrl, b, k - i * 0.02) with shrinking scale
```

**Label with leader line**: `ctx.hud.label('key', worldPoint, 'text', { sub, dx, dy, alpha })` every frame you show it (fade with `U.win`).

**Counter / ETA card**:
```js
const tk = spec.cue('twenty', .5);
ctx.hud.card({ kicker: 'ARRIVE', prev: '6:39', value: '6:42', k: U.inv(tk, tk + .5, t), unit: 'PM', sub: '23 min', state: 'live' });
ctx.hud.big('n', String(Math.round(U.lerp(0, 1000, U.easeOut(U.inv(tk, tk + .8, t))))), { y: 900, size: 200, alpha: U.win(t, tk, spec.t1) });
```

**Step-by-step zoom-in** (system -> part -> detail): three pose keys on three words, each closer, with a reveal at each stop.
```js
const a = spec.cue('engine', .1), b = spec.cue('piston', .4), c = spec.cue('spark', .7);
return U.poseTrack([[spec.t0, wide], [a + .2, wide2], [b, mid], [c, macro], [spec.t1 + .6, macroDrift]], tc);
// and in update: hide the parts that block each closer view (fade(shell, 1 - inv(b - .2, b + .3, t)))
```

**Particle flow along a path** (current in a wire, water in a pipe): `k = (t * speed + i / n + jit[i]) % 1; p = curve.getPointAt(k)`
with `makeCharges` (studio) or instanced spheres; colour by meaning.

**Bar field / crater** (measurements across a surface): `grid.bars(k)` + `grid.setDips([...])` (studio kit), or ribbons with colour (city).

**Lock-on brackets**: 4 L-shaped corners scaling from 1.6x to 1x around a target on the word + a small 'tick' SFX. See `library/explainer3d/touch/s08_kit.js`.

**CTA**: template `scenes/cta.js`: a glass card in 3D with the keyword in the caption key-box style (copy comes from `reel.json cta`), a fingertip
taps it, `ctx.capHide` after the last word so the card owns the final second. It uses `makeHand` + `makeCharges`; that does not count
against the stock-prop rule. The template CTA is a safe default, not a requirement: you may replace it with a reel-specific CTA
(the hero object turns into the card, the keyword is stamped on your prop, ...) as long as it keeps the keyword from `reel.json cta`
readable for >= 1 s and hides the captions after the last word.

More, with real code: `library/explainer3d/INDEX.md` (exploded grid, macro-to-cascade, field lines, bar crater, rain of events, route ribbons,
jam ripple, network graph, stacking blocks, history chart, signal rings, packet to cloud, 100k device dots, time of flight).

---

## 12. Review checklist (stills first: `reel stills <dir> ...` and LOOK at the sheet)

- [ ] Sound off: would a stranger understand each beat from the picture alone? One hero object per beat, readable at phone size.
- [ ] Every key visual lands on its word (+-0.1 s); every caption key word is something we SEE at that moment.
- [ ] Something changes every 1-1.5 s; the camera never parks; camera language changes between steps.
- [ ] Top 460 px clear in studio (no hand or object under the captions); key content above y 1400, inside x 60..1020.
- [ ] Colour = meaning (blue energy/data, amber input, red loss/fail, green success); no new random colours.
- [ ] Glow is intentional: no white blow-outs over the captions, no giant bloom blobs (lower `ctx.bloomK` instead of materials).
- [ ] Labels: <= 3 at once, short, pinned with leader lines, faded in/out (never popping on/off), inside the safe zone.
- [ ] Whip frames: the first and last 0.4 s of each beat show something (no empty black frame mid-whip).
- [ ] Deterministic: no Math.random / Date; `?t=` renders of the same t are identical; no flicker between neighbouring frames.
- [ ] No em dashes in on-screen text, no brand logos or trademarks drawn, fonts only from `/fonts/`.
- [ ] CTA: keyword from reel.json, readable >= 1 s, captions hidden after the last word.
- [ ] Then a short draft (`reel video <dir> --to 6`), watch it, then the full render.

## FAQ and gotchas (learned from real buyer runs)

- **Portrait framing: WIDTH is the trap, not height.** The frame is 9:16, so the visible width at the target is only
  ≈ 0.32 × camera distance at `fov` 32 (0.28 × at 28, 0.41 × at 40); height is 1.78 × that and almost never the limit.
  Size the shot by the hero's width: **distance ≈ width ÷ (0.8 × widthFactor)** (hero fills ~80 % of the frame width):

  | hero width (cm, studio) | example | fov 28 | fov 32 | fov 40 |
  |---|---|---|---|---|
  | 2 | chip, coin, pill | 9 | 8 | 6 |
  | 5 | earbud, battery cell | 22 | 19 | 15 |
  | 7.2 | phone (portrait) | 32 | 28 | 22 |
  | 10 | mug, watch | 45 | 39 | 31 |
  | 15 | phone sideways, hand | 67 | 58 | 46 |
  | 20 | head from the front (16-20 cm) | 89 | 77 | 61 |
  | 30 | laptop, keyboard half | 134 | 116 | 92 |
  | 50 | monitor, torso | 223 | 194 | 153 |

  (city: same numbers in metres.) A frontal head needs **65-80 cm** at fov 32, not 35 cm. Frame tall things upright (a phone,
  a person, headphones on a stand); turn wide things (a car, a keyboard, a wave) diagonally, crop them on purpose, or show the
  part that matters. Remember the top ~460 px belong to the captions: aim the target slightly above the hero so it sits lower.
- **Plan `at` phrases** are searched from the previous beat's time, but prefer a word index (`at: 57`, from `build/word_index.txt`) or a
  phrase that is unique in the script. The page prints `plan: beat "x" starts before ...` if beats land out of order: fix it.
- **Labels** (`hud.label`) are 42 px by default (pills 30 px mono); `o.size` is a SCALE factor (1.2 = 20 % bigger). They only show
  inside the beat that draws them (not during the whip into the next beat); pass `keep: true` to override.
- **Checking a transition alone**: `reel stills <project> <t0 - 0.3> <t0> <t0 + 0.3> --only <beatId>` shows the whip-in with the previous
  beat drawn (and the whip-out with the next beat near `t1`). Neighbours are drawn only inside the shared blend.
- **Phone screen flicker** (z-fighting) at large scale / far away is fixed in the kit (screen offset + polygonOffset). If your own
  props stack flat layers (a label on a panel, a decal), keep >= 0.01 cm (studio) between them and add
  `polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4` to the top layer's material.
- **Previewing a new prop**: make a throwaway beat that only shows the prop on a turntable and render it alone:
  `reel stills <project> <t> --only <beatId>`. (The kit showcase page only shows the built-in kits.)
- **Shared materials**: `fade(obj, a)` writes opacity into the object's materials. If two objects share a material, fading one fades
  both: give each instance its own materials (`mat.clone()`). Note `Material.clone()` copies `clippingPlanes` as the SAME array:
  assign a new array if instances need different clipping.
- **Particles + bloom**: hundreds of glowing particles with halos (e.g. `makeCharges`) bloom into a white slab. For big counts set
  `halo.visible = false` or lower `ctx.bloomK` for that beat.
- **Metal in x-ray views**: specular highlights on metal bloom into blobs when the shell is transparent. Lower `roughness`/`metalness`
  or `envMapIntensity` on those parts during the x-ray, or clamp with a dimmer key light for that beat.
- **Errors while drawing** are listed after every `reel stills/video` run (and in `build/render_errors.txt`): fix every entry.
