# Illustration: drawing real places, products and objects like real life (classic style)

Read this when the script is about something REAL: a company, a restaurant, a store, a product, a food, a car, a city, a building,
a floor plan, an app or a video. The viewer must recognise the actual thing in half a second, so draw it like real life (real
proportions, real materials, the details that make it THAT thing), not as a flat icon or a labelled card.

The engine gives you the drawing primitives (`engines/classic/kits/illustrate.js`, loaded by every classic project) and the library
gives you finished, de-branded examples to study (`library/classic/illustrated/`). Your reel still draws its OWN subject: the
primitives are for HOW to draw it, the library shows the level of detail.

## 1. When to use it (and when not)

| the script says | draw |
|---|---|
| a company / chain / brand ("this burger chain is really a real-estate company", "why the furniture megastore is a maze") | its real building on a diorama pad, its product, its packaging, the place (lot, store, plan) |
| a product or object ("this $3 gadget", "wireless earbuds", "a flat-pack shelf") | the object, 3/4 or isometric, real proportions, its materials |
| a place or system ("your city's bus network", "a warehouse", "the drive-thru") | an isometric diorama or an aerial plan, with traffic, people, lights |
| food ("a burger costs 40 cents to make") | the food at sticker size: layers, gloss, texture, steam |
| a video, a reel, an ad, an app on a phone | a phone that PLAYS it (section 5), never a static screenshot card |
| an abstract idea ("effort", "habits", "trust") | not this guide: invent a metaphor machine (guides/patterns.md) |

Real-life drawings and invented metaphors mix well: the restaurant is the hero, a property-line + LAND sign is the metaphor ON it.

**Brands.** A reel about a named company or product ("a reel about Costco", "why IKEA stores are mazes") is editorial commentary:
in the buyer's project, draw its recognisable real look without asking: the building shape, its colours, its signage text set in a
plain font, its products and packaging. Draw it in code and keep it accurate. Reproduce logo artwork (the exact wordmark lettering,
the emblem, an image file of the logo) only if the user asks for it and supplies or has the right to it. Never imply sponsorship or
endorsement (no "official", no "partnered with", no brand as the narrator) and never invent claims about the company (SKILL.md "Rules
that always apply"). Shipped skill files (`library/`, kits, guides) stay generic: no real logos, wordmarks or trade dress there.

## 2. The method (per subject, before code)

1. **Reference.** Picture (or look up) the real thing. List what you would see in a photo: overall shape, materials, colours, the
   3-5 details that make it instantly THAT thing (section 3). Write them in STORYBOARD.md next to the beat.
2. **Silhouette + real proportions.** Block it as 1-4 simple volumes with the real ratios (a fast-food restaurant is 3:2:1 low and
   wide with one tall entrance tower; a big-box store is huge and FLAT; a burger is 1.5:1 wide). If the silhouette alone doesn't
   read, no amount of detail will save it.
3. **Construction.** Buildings, places, boxes, devices on a table: **isometric** (`ISO`, `isoBox`, `isoPrism`, `isoCylinder` on an
   `isoSlab` pad). Food, products, characters, vehicles side-on: **3/4 or front view** with gradients. Plans and maps: **top-down**.
   One projection per object; don't mix inside one object.
4. **Three tones per surface + a highlight + an edge line.** Top lightest, front (left) face mid, side (right) face darkest
   (`isoBox` does it from one base colour; `tones(col)`); round things get `roundGrad`, cylinders `cylGrad`, glossy things `gloss`;
   outline in a darker shade of the object's OWN colour (`shade(col, 0.4)`, rgba), never pure black except tyres and ink UI.
5. **Signature details** (section 3): drawn ON the faces with `isoLeft` / `isoRight` / `isoTop` so they sit in perspective.
6. **Life.** Something always moves: cars drive (`isoCar` on a loop), tiny people walk (`tinyPerson` / `isoPerson`), windows glow
   (`litWindow`, `windowGrid` with `t`), flags wave, steam rises (`steam`), trees sway (`isoTree` with `t`), a sign swings
   (`pendulum`), a route marches (`isoPath` with `offset: -t * 22`), a brake light pulses.
7. **Read at size.** It must read at the size you show it (a 300 px sticker, a 120 px thumbnail inside a phone). Check the still at
   100 % AND at sheet size. One hero per beat; supporting illustrations smaller, as die-cut stickers (section 4).
8. **Entrance + reaction.** Real things still move like the classic style: buildings grow up from the ground (`scale(1, rise)` with
   `E.outBack`), signs shoot up on their pole (`poleSign` `p`), layers drop in (the burger `build`), stickers pop + tilt
   (`pop`), parked cars slide into their bays. Cue all of it on the stressed words.

## 3. Signature details per category (the checklist that makes it "real")

- **Buildings** · a plinth band at the bottom, a fascia/sign band at the top, lit windows with people silhouettes and a reflection
  streak, a door (dark, with a handle dot), rooftop HVAC boxes or skylights, a parapet, an awning or canopy over the entrance,
  vertical panel seams (very low-alpha), a cast shadow on its own pad (`isoCastShadow`), a sidewalk, one tree. Category tells:
  fast food = drive-thru window + lane arrow + pole sign + car waiting; big-box = flat huge box + loading docks + parking rows +
  pylon; shop = awning + display window; office = window grid; house = gable roof + chimney.
- **Places / plans / maps** · roads with dashed centre lines, crosswalks, sidewalk joints, parking stripes, a ground tile with soil
  sides (diorama), property lines with stakes, a yard sign; plans: furniture glyphs per room, thick walls with door gaps, IN / EXIT,
  a route that snakes (Catmull-Rom) with marching dashes + chevrons and a tiny walker; maps: street grid, a park, a river, pins.
- **Food** · layers in the real order, each layer its own gradient + outline in its own darker colour, gloss on buns/sauces,
  seeded texture (grill specks, sesame seeds, salt), irregular edges (lettuce ruffle, cheese drips), steam, a soft contact shadow.
- **Packaging / products** · the signature silhouette (carton flare, bottle neck, box flap), a curved-surface gradient (dark edges,
  bright at 30-50 %), one sheen band, printed stripes that follow the curve, a label rectangle, a barcode, a fold line.
- **Devices** · a dark bezel with a lighter inner edge, a screen that is ON (content, glow), a camera dot/notch, buttons on the side,
  a reflection streak across the glass; use the engine's `phone()` / `browser()` for screens.
- **Vehicles** · body box + cabin box with dark glass, wheels as dark ellipses, a window glint, brake/head lights; a cart/trolley:
  wire mesh drawn OVER its contents, a grip, wheels with a hub and a spoke so spin reads.
- **People (tiny)** · a 3-shape body (legs, shirt, head) with walk phase, a hair cap, an optional bag; at 30-60 px they are life,
  not characters. The presenter is the only big character.

## 4. The die-cut sticker pattern

Secondary real-world objects next to the hero (a burger beside the restaurant, a LAND lot beside the caption) look best as
**die-cut stickers**: white border + soft shadow, slightly tilted, popping in on their word and idling with a small sway.
```js
// natural bounds of the drawer, at s = 1: [x0, y0, x1, y1] (placement point = bottom-centre)
const k = clamp(pop(t - T_BURGER, 2.8, 0.5), 0, 1.3);
if (k > 0.01) X([T, K], 250, 660, k, 8 + Math.sin(t * 2) * 2, () =>
  sticker(K, MY_BURGER_BOX, 0, 0, 0.9, c => myBurgerArt(c, { noShadow: true }), { T, cache: 'burger' }));
```
- `{ T }` prints the sticker's shadow as halftone dots (the classic look); transform T like K (`X([T, K], ...)`).
- `cache: 'key'` = the art doesn't change with `t`: rendered once and reused (much faster). Animated art: no cache.
- Pass `noShadow: true` to your drawer inside a sticker (the sticker brings its own shadow).

## 5. The playing phone (a video on screen must PLAY)

Whenever a reel, a TikTok, an ad, a YouTube video or an app recording appears in your reel, show it PLAYING, like a real one. A
static thumbnail card reads as a slide; a phone where shots cut every ~1 s reads as "a real video". Pattern
(`library/classic/illustrated/playingMiniReel.js`, primitives in illustrate.js §8):
- write a tiny edit: 4-7 shots, ~1 s each, `shots = [{ id, t0, cut: 'kick' | 'zoom' | 'whip' | 'cut', dark }]`, a loop length;
- `shotClock(t, shots, loop, off)` clocks it by the ABSOLUTE reel time, so it keeps playing across your scene cuts; pick `off` so the
  right shot is on screen on the right word of your reel;
- one small drawer per shot built from your reel's own props at small scale (`u = screenWidth / 400`), each with its own entrance;
- `shotCam` for the edit's camera (punch-ins, whip pans + `whipStreaks`, a zoom kick on accent words);
- on top: `reelCaption` (word captions popping), `voiceWave` (bars peak on the word onsets), `miniGuy` (the presenter talking,
  a pose per shot), `reelOverlay` (generic app UI + progress bar; real numbers only, or none);
- build it on your words with layers `L = { hook, scene, voice, caps, play }` 0..1 (headline types, scene springs up, voice +
  presenter, captions, overlay), then `scene: 1` = playing. Draw it as `phone(T, K, ...)` content.

## 6. Layers, performance, sizes

- Illustration on **K**; contact shadow on **T** (`softShadow(T, x, y, rx, ry, 0.35, '0,0,0')`) on open paper → halftone like the
  rest of the classic look. Shadows that fall on the illustration's own surfaces stay on K (rgba). Inside phone/card content: all K.
- Drawers take natural coordinates and a bounds box; place them with `placeArt(ctx, box, x, y, s, fn)` (bottom-centre).
- Cost: a full diorama is ~300-600 path fills; 3-4 per frame are fine. `dieCut` without `cache` renders 3 off-screen canvases per
  call: keep ≤ 3 uncached stickers per frame and cache every static one. Never `Math.random` (use `hash(i + seed)`); never state
  that depends on the previous frame.
- Size on screen: a hero illustration 500-900 px wide; stickers 220-420 px; things inside a phone are drawn with `u` so they scale.
  Text ON an illustration (a sign, a fascia) is texture (it may be small); text that must be READ goes in the captions or a ≥ 40 px label.

## 7. API (engines/classic/kits/illustrate.js; full signatures in its header)

| group | functions |
|---|---|
| colour | `shade(col, k)` · `mixCol(a, b, f)` · `withAlpha(col, a)` · `tones(col)` → `{top, left, right, edge}` |
| light | `vGrad` / `hGrad(ctx, a, b, cols)` · `roundGrad(ctx, cx, cy, r, col)` · `cylGrad(ctx, x0, x1, col)` · `gloss(ctx, x, y, rx, ry, rot, a)` · `glassStreak(ctx, x, y, w, h, a)` |
| shadows | `softShadow(ctx, x, y, rx, ry, a, rgb)` · `isoCastShadow(ctx, x0, y0, x1, y1, h, a, k)` |
| isometric | `ISO(x, y, z)` · `poly` / `fillPoly` / `edgePoly` · `isoLeft(ctx, y, fn)` / `isoRight(ctx, x, fn)` / `isoTop(ctx, z, fn)` · `isoQuad` · `isoPath(ctx, pts, z, col, lw, {dash, offset})` · `isoBox(ctx, x0, y0, x1, y1, z0, z1, col, {edge})` · `isoPrism(ctx, x0, y0, x1, y1, z, rise, col, {ridge})` · `isoCylinder(ctx, x, y, r, z0, z1, col)` · `isoSlab(ctx, x0, y0, x1, y1, depth, {top, side})` |
| windows | `litWindow(ctx, x, y, w, h, {seed, mull, people, lit})` · `windowGrid(ctx, x, y, w, h, cols, rows, {t, seed, on})` · `awning(ctx, x, y, w, h, [a, b])` |
| life | `isoTree(ctx, x, y, s, {t})` · `isoCar(ctx, x, y, 'x'|'y', col, {brake})` · `tinyPerson(ctx, x, y, s, {ph, shirt, bag, flip})` · `isoPerson` · `poleSign(ctx, bx, by, h, {p, col, w, h, draw})` · `steam(ctx, x, y, t)` |
| stickers | `placeArt(ctx, box, x, y, s, fn)` · `dieCut(ctx, box, fn, {pad, T, cache})` · `sticker(ctx, box, x, y, s, fn, {T, cache})` |
| playing reel | `shotClock` · `shotCam` · `whipStreaks` · `reelCaption` · `voiceEnv` / `voiceWave` · `reelOverlay` · `miniGuy` |

Iso convention: `ISO(x, y, z)` = 2:1 isometric, x runs right-down, y runs left-down, z up. Visible faces: front-left (y = max),
right (x = max), top. On `isoLeft(ctx, y, fn)` you draw in (x, -z): `fillRect(x0, -z1, w, z1 - z0)` is a band between heights.
On `isoRight(ctx, x, fn)` you draw in (-y, -z). Draw back to front (painter's order): ground → back things → building → front things.

**Short example** (a corner café on its pad, growing up on its word, steam from the chimney, a walker passing):
```js
const T_CAFE = wordAt('café', S0, 1, S0 + 0.3);
function cafeArt(K, t, rise) {                         // natural iso coords, origin = pad centre
  isoSlab(K, -90, -70, 90, 70, 10);
  isoQuad(K, -90, 40, 90, 70, 0, '#D8D3C9');           // sidewalk
  K.save(); K.scale(1, rise);
  isoCastShadow(K, -50, -40, 40, 30, 50);
  isoBox(K, -50, -40, 40, 30, 0, 50, '#E9DCC6', { edge: true });
  isoPrism(K, -54, -44, 44, 34, 50, 26, '#4A5260', { edge: true });
  isoLeft(K, 30, () => { litWindow(K, -44, -30, 46, 22, { seed: 2, mull: 11.5 }); fillRR(K, 10, -30, 14, 30, 1, '#5A3A2A');
                         awning(K, -46, -38, 50, 8, ['#2F6B5A', '#FFF6E6']); });
  K.restore();
  steam(K, ...ISO(20, -20, 50 * rise + 34), t, { n: 2, h: 60, col: '150,140,130' });
  isoPerson(K, -90 + ((t * 30) % 180), 55, 0.7, { ph: t * 12, shirt: '#D8402F' });
}
// draw:
softShadow(T, 540, 1130, 300, 50, 0.35, '0,0,0');
X([K], 540, 1000, 2.4, Math.sin(t * 1.2) * 0.6, () => cafeArt(K, t, E.outBack(clamp((t - T_CAFE) / 0.5))));
```

## 8. Library (study, never paste)

`library/classic/illustrated/` (listed in `library/classic/INDEX.md`): `fastFoodRestaurant.js`, `bigBoxStore.js`, `cornerLot.js`,
`floorPlan.js`, `burger.js`, `fries.js`, `shoppingCart.js`, `playingMiniReel.js`. Each header lists its techniques. They are
de-branded technique references: read the one closest to your subject, then draw YOUR subject with the primitives (`reel craft`
counts pasted library drawers as stock). `test`-style check: a throwaway project can load them via
`SCENE_FILES = ['/skill/library/classic/illustrated/burger.js', ...]`.

## 9. Quality checklist (look at the still at 100 % and at sheet size)

- [ ] Would a stranger name the thing in half a second with the sound off? (silhouette + 3-5 signature details)
- [ ] Real proportions? (a burger isn't a ball; a megastore isn't a cube)
- [ ] Every surface has 3 tones or a gradient, a highlight where light hits, an edge line in its own darker colour
- [ ] Shadows: contact shadow on T (paper) or K (inside cards); cast shadow on its own ground
- [ ] Something moves on it every frame (traffic, walkers, windows, steam, flags, route dashes) and it ENTERS on a word
- [ ] One hero per beat; the rest smaller (stickers), nothing fighting it; highlights exactly on their target
- [ ] Readable at its on-screen size; no text that must be read under 40 px
- [ ] No real logos/wordmarks in shipped files; a real brand's look only in the buyer's project when the reel is about it
- [ ] `reel stills` lists no "error while drawing frames"

## 10. Common mistakes

- A flat icon or a card with the company NAME instead of the place itself. Draw the place.
- One flat colour per object (no tones) → looks like clip art. Use `isoBox` tones / gradients / gloss.
- Pure black outlines on everything → heavy. Outline in a darker shade of each object's own colour.
- Detail that disappears at size (30 tiny windows on a 200 px sticker) while the silhouette is wrong. Fix the silhouette first.
- Mixed projections inside one object (an isometric building with a front-view door). Draw details ON the face (`isoLeft`).
- A dead diorama: no cars, no people, no lights. Add 2-3 life loops.
- A screenshot of a video. Make it play (section 5).
- Illustration drawn on T (it becomes halftone mush) or a shadow drawn on T inside a phone (invisible).
- Uncached stickers ×8 per frame (slow renders). Cache static art.
- `Math.random()` for texture (flickers between frames). Use `hash(i + seed)`.
