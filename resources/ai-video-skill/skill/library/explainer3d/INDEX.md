# explainer3d reference library

Real scene files from three finished 1080x1920 three.js explainer reels, de-branded. Use them as code to copy from when
building a new topic (coffee machine, battery cell, Wi-Fi, ...): find the technique below, open the file, lift the
pattern, then adapt it to the packaged engine (last section). Every file starts with a header: beat, original spoken
line, what it shows, techniques, and the import mapping.

Looks:
- **studio**: dark product-film studio, units cm, each beat built at its own station `spec.o`; glowing charge, glass, macro shots.
- **city**: golden-hour paper city, units m, one continuous camera over absolute city coordinates; ribbons on roads, HUD labels.

Files marked *helper* are imported by a scene next to them; copy them together.

## Files

| Path | Look | What it shows | Techniques to steal |
|---|---|---|---|
| touch/s01_hook.js | studio | Finger brush wakes the screen, a pen slammed down does nothing | impact flex (exp*cos) + shake/flash; particle trail from past path samples; shader light sweep; camera snap on a word |
| touch/s04_grid.js | studio | Glass lifts off, hidden wire grid draws on, rows then columns flare | exploded layers (backOut lid, spring rise); grid reveal/scan/ghost by word; streaks along wires; 3-shot camera with 90 degree roll unwind |
| touch/s05_cross.js | studio | Macro on one crossing, then every crossing cascades + radar scan | macro-to-wide reveal; cascade delayed by distance on instanced orbs; accelerating scan beam + curtain; gaussian grade pulses |
| touch/s06_kit.js | studio | *helper* for s07_pull | crTrack Catmull-Rom value track; samplePath; patchXray |
| touch/s07_pull.js | studio | Fingertip nears the glass, field lines pull charge up from crossings | makeFieldLines from grid.pos to fingertip; charges along beziers; grid.setDips drain vs full neighbours; gap readout countdown |
| touch/s08_dip.js | studio | Grid becomes a 3D bar field with a crater, brackets lock on, "touch" | grid.bars + setDips crater; lock-on brackets + reticle; layers slam shut; canvas screen app-open |
| touch/s08_kit.js | studio | *helper* for s08_dip | makeBracket (3D lock-on corners); makeTracker = tracking RING (name clash, see below); camSpline |
| touch/s11_rain.js | studio | Raindrops fire phantom touches, each drop pulls charge like a finger | event schedule array; instanced rain streaks; one dip + field lines per drop; ghost fingers; rhythmic glitch flash |
| touch/s14_cta.js | studio | 3D glass follow card, finger taps Follow and Send, paper plane to a wet phone | UI card as 3D mesh + canvas textures per state; physical button press + ripple grid; plane the camera rides; ctx.capHide end card |
| city-maps/s01_lib.js | city | *helper*: route line shader, veil, fog, pin, projector | fullscreen veil quad + renderOrder; route reveal shader with hot head; distance fog; world-to-screen projector |
| city-maps/s03_tiles.js | city | *helper* + logic: route breaks into 8 tiles that crack, lift, number, recolour, land | path-extruded walls with onBeforeCompile clip; one pure update shared by 2 scenes; fixed-px sprites (pxScale) |
| city-maps/s03_pieces.js | city | Wrapper beat for the tiles | thin scene delegating to a shared module |
| city-maps/s04_live.js | city | Dive into one piece, every car pings its phone, speeds stream into a label | traffic.addSlow / carsOn / poseAt; hash-stable picks; canvas speed chips + stream dots; hud.label leader lines + chip |
| city-maps/s06_history.js | city | Floating 3D chart over the road: past Tuesdays as slabs, usual curve, 6 pm slice | chart in a local frame from slabs + tubes; curve draw-on; beams tying chart to the place; camera pre-compensation for the next blend |
| city-maps/s07_ripple_jam.js | city | *helper*: jam simulation + wave-front functions | wave fronts as pure functions of t; deterministic car-following sim; ribbon/span/ringAt helpers |
| city-maps/s07_ripple.js | city | A jam spreads BACKWARDS up the highway and into feeder ramps, ground ripples | span() windows following a front; crest ribbon; ground ripple rings; camera retreating with the front |
| city-maps/s08_network.js | city | City dims and redraws as a glowing graph, messages hop between nodes | BFS-in-time baked into vertex attributes; merged edges + instanced nodes/heads; veil + abstract redraw in place |
| city-maps/s10_stack.js | city | Route pieces rise as blocks, fly in arcs, stack into a tower, total flies into the card | staggered bezier flights; squash/stretch + landing spring; canvas-printed faces; hud.big equation + digit roll |
| city-maps/s10_stack_cam.js | city | *helper*: splineCam | centripetal Catmull-Rom camera that never parks between keys |
| city-tracker/s03_signal.js | city | Tracker beacons: pulse rings on a rhythm, dashed range circle sweeps on | pulseRings per emission on word list; angular sweep range shader; camera rides an emission; card unit roll |
| city-tracker/s06_note.js | city | Passer-by's phone seals a note (padlock snaps) and flies it on an arc to a cloud | makePacket + flyArc with tapered tube trail; 3D padlock snap; walk() across beats; aim between flyer and target |
| city-tracker/s09_billion.js | city | Spiral pull-back reveals ~100k device dots, relay ripple hops outward | log-space pull-back camera; reveal by distance; legible marker at any scale; 1B+ number roll |
| city-tracker/s09_billion_fx.js | city | *helper*: dots, relay arcs, veil, marker | 100k THREE.Points with timing in attributes + uTime; shared JS/GLSL timing; procedural population |
| city-tracker/s10_close.js | city | Wrapper: first half of the close-range sequence | two beats driving one continuous shared sequence (SPLIT) |
| city-tracker/s11_uwb.js | city | Wrapper: second half (time of flight, arrow) | same as above |
| city-tracker/s10_close_shared.js | city | Walk to the bag, soft rings snap to sharp pulses, ns counter rides a pulse, blob collapses to "4 m", arrow on the phone | visual-language switch; time-of-flight pulse + riding counter; fuzzy-to-crisp blob shader; push into a handset screen (drawArrowScreen) |

## Techniques index

| Technique | Files |
|---|---|
| Land a visual on the spoken word (word times, cue tables) | touch/* (ctx.wordAt), city-* (T/W tables to convert) |
| Impact: anticipation, slam, flex, ctx.shake / ctx.flash | touch/s01_hook, touch/s08_dip, touch/s04_grid |
| Exploded view / layers lifting apart | touch/s04_grid, touch/s08_dip |
| Hidden structure reveal (draw-on, ghost, scan) | touch/s04_grid, touch/s05_cross |
| Macro on one element, then cascade to the whole system | touch/s05_cross, city-tracker/s09_billion |
| Scan / read sweep / radar pass | touch/s05_cross, touch/s08_dip, touch/s04_grid |
| Particles flowing along paths (charge, streaks, trails) | touch/s01_hook, touch/s04_grid, touch/s07_pull, touch/s11_rain |
| Field lines between two objects | touch/s07_pull, touch/s11_rain |
| Data as a 3D bar field / crater | touch/s08_dip, touch/s11_rain |
| 3D chart panel floating over the subject | city-maps/s06_history |
| Lock-on brackets, reticle, tracking ring | touch/s08_kit, touch/s08_dip |
| Many repeated events from a schedule array | touch/s11_rain, city-tracker/s03_signal (EMIT) |
| Pulse rings / beacon rhythm / range circle | city-tracker/s03_signal, city-tracker/s10_close_shared, city-maps/s07_ripple |
| Wave spreading (front as a pure function of t) | city-maps/s07_ripple_jam, city-maps/s07_ripple, city-tracker/s09_billion_fx |
| Break a whole into pieces / tiles | city-maps/s03_tiles, city-maps/s10_stack |
| Objects fly on arcs and stack / dock | city-maps/s10_stack, city-tracker/s06_note |
| Graph / network redraw with messages hopping | city-maps/s08_network, city-tracker/s09_billion_fx |
| Thousands of elements, pure of t (attributes + uTime) | city-maps/s08_network, city-tracker/s09_billion_fx |
| Veil: dim the world so the infographic owns the frame | city-maps/s01_lib, city-maps/s08_network, city-tracker/s09_billion_fx |
| Ribbons on paths (colour state, reveal windows) | city-maps/s07_ripple_jam, city-maps/s04_live, city-maps/s10_stack |
| Phone/device pings on moving things | city-maps/s04_live |
| Time-of-flight / measurement with a counter riding the object | city-tracker/s10_close_shared, touch/s07_pull (gap readout) |
| Fuzzy-to-precise visual switch | city-tracker/s10_close_shared |
| UI card / screen as a real 3D object (canvas textures) | touch/s14_cta, touch/s08_dip, city-tracker/s10_close_shared, city-maps/s10_stack |
| HUD: labels with leader lines, status chip, card digit roll, big type | city-maps/s04_live, city-maps/s10_stack, city-tracker/s03_signal |
| Smooth camera splines (never parks) | touch/s06_kit (crTrack), touch/s08_kit (camSpline), city-maps/s10_stack_cam (splineCam), city-tracker/s10_close_shared (hermite) |
| Camera snap / whip on a word, roll unwind | touch/s01_hook, touch/s04_grid, touch/s05_cross |
| Camera rides a moving object | city-tracker/s03_signal, city-tracker/s06_note, touch/s14_cta |
| Log-scale pull-back (street to region) | city-tracker/s09_billion |
| Two beats sharing one continuous sequence or one helper | city-tracker/s10_close + s11_uwb, city-maps/s03_pieces + s03_tiles |
| CTA / follow end card | touch/s14_cta |

## Adapting to the packaged engine

These files were written against each reel's own core. Map them like this:

- **touch `scenes/lib.js` -> `/engine/kits/studio.js`**, same function names: makePhone, makeGrid, makeHand, makeFinger,
  makePen, makeCharges, makeFieldLines, makeDrop, makeLabel, makeIcon, studioFloor, makeTouchRing, fade, bezier, rng,
  toV3, mixHex, glassify, capGlare, libEnv, HAND_POSES.
- **tracker reel `scenes/lib.js` -> `/engine/kits/gadgets.js`**. The tag constructor is `makeTracker` and the handheld phone is
  `makeHandset` (the copies in city-tracker/ already use these names). Everything else keeps its name: makeSuitcase,
  makePerson, walk, drawMapScreen, drawArrowScreen, pulseRings, makePacket, flyArc, bezier, makeCloud, makeContactShadow,
  linePath, placeOnPath, look, fade, LOC, initLib, makeAirportProps, makeShuttle, makeHotelLobby, makeStreetProps, makeEmptyRoom.
- **maps/tracker `core/world.js` + `traffic.js` -> `/engine/kits/city.js`**. `buildCity(ctx)` returns the same world object;
  in scenes read `ctx.city` instead of `ctx.world` (e.g. `const { THREE, world, P, U } = ctx` becomes `const world = ctx.city`).
  `ctx.traffic` is unchanged. `ribbonGeometry` / `ribbonMaterial` are exported from city.js and also on ctx.
- **maps `core/hud.js` -> `ctx.hud`**: `hud.card(...)` (alias `hud.eta`), `hud.chip(...)` (alias `hud.status`), `hud.label(...)`,
  `hud.big(...)`, `hud.layer`. Captions are automatic; never draw the spoken words yourself.
- **`core/util.js` -> `ctx.U`** (same functions).
- **Palettes**: `ctx.P` = studio palette (touch names: charge, chargeHot, body, dip, no, ok, ...); `ctx.C` = city palette
  (maps names: route, live, slow, jam, forecast, history, phone, ink, paper, ...). In city/tracker files, `P` means the city
  palette, so read it from `ctx.C`.
- **Timing**: packaged scenes cue on words with `ctx.wordAt(word, spec.t0)` or `spec.cue(word, fallbackFraction)`. The studio
  files already do this. The city and tracker files use hard-coded seconds (T / W tables, EMIT lists, tracks with literal
  times): convert each one to a word cue when adapting.
- **Space**: studio scenes build at `spec.o` (their own station, cm). City scenes use absolute city coordinates (m).
- **Core hooks**: the packaged core provides all of them: `ctx.after` (post-camera callbacks), `ctx.capHide`, `ctx.capDy`,
  `ctx.flash`, `ctx.shake`, `ctx.bloomK`, `ctx.exposure`, `ctx.bg`, `ctx.fog`, `ctx.carGeometry`, `ctx.sun` (= `ctx.key`, the
  sun on city frames), `ctx.hemi`, `ctx.world` (= `ctx.city`). City files that change `sun` / `hemi` / fog must set them every
  frame of their window only (core re-applies the look each frame). `ctx.typeDark` and the maps title/header do not exist.
- **Name clash**: touch/s08_kit.js exports its own `makeTracker` (a green tracking ring). If a scene also imports gadgets.js,
  alias one of them (`import { makeTracker as makeTrackRing } from './s08_kit.js'`).
- **Rules carried by every file**: `update` is a pure function of t (no Math.random, use `ctx.U.rng(seed)` in init; no
  accumulated state); hide your objects outside your window; `camera()` clamps its t and keeps moving.
- **Wrapper-only files** (`s03_pieces`, `s10_close`, `s11_uwb`) are there to show module sharing. The `?only=` check in
  s10_close / s11_uwb belongs to the original render harness; drop it.
