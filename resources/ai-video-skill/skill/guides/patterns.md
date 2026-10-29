# Patterns: how the creator's hand-made reels are built

Read this before writing `STORYBOARD.md`. It is a frame-by-frame and code-level study of five of the creator's hand-made reels
(watched as 4 fps strips, scene code and word timings read line by line). It teaches the **craft** (how a sentence becomes a
moving physical system), not the props. The props in these reels were invented for those scripts; your script needs its own.

Reels studied (products are described generically):

| id | topic | length | look |
|---|---|---|---|
| reel A | solo founder doing every job / an AI agent team | 38.0 s | warm paper (problem) → dark navy product look (solution) |
| reel B | vibe-coded app gets no users, fear of showing your face / AI-generated UGC | 52.0 s | warm paper → dark brand look |
| reel C | 4 plugins for an AI coding assistant | 45.9 s | warm paper throughout |
| reel D | vibe coding makes you worse / a plugin that teaches while it codes | 29.3 s | warm paper throughout |
| reel E | the real cost of a first sales hire / an outbound agency | 25.4 s | warm paper (problem) → black product look (solution) |

## 0. Measured numbers (all five reels)

Code = the reel's own scene files only (shared engine, kits and presenter rig excluded). Motion = mean grey-level difference
between frames 0.1 s apart (108×192 px). "Big" = clustered steps where that difference exceeds 10.

| | A | B | C | D | E |
|---|---|---|---|---|---|
| scenes · avg length (range) | 9 · 4.2 s (2.9-7.5) | 8 · 6.5 s (1.7-9.7) | 6 · 7.6 s (3.5-12.1) | 8 · 3.7 s (2.6-4.8) | 8 · 3.2 s (2.3-4.9) |
| scene code, non-empty lines per second | 90 | 47 | 51 | 109 | 98 |
| lines per scene | 312-529 | 140-487 | 244-603 | 311-479 | 262-380 |
| custom drawing/motion helpers per second | 6.9 | 3.4 | 3.7 | 7.9 | 6.4 |
| word-cued anchors per second (`wi(n)` targets) | 2.5 | 1.7 | 2.1 | 2.3 | 3.2 |
| discrete visual events per second (counted from beats) | ~7 | ~2.5 | ~2.8 | ~7 | ~6 |
| motion per 0.1 s | 5.7 | 7.8 | 5.4 | 8.6 | 8.3 |
| big moments per second | 0.50 | 0.56 | 0.50 | 1.30 | 0.83 |
| 0.1 s steps with visible change | 99% | 96% | 96% | 98% | 99% |
| longest still stretch | 0.1 s | 0.5 s | 0.3 s | 0.4 s | 0.1 s |
| kicks (camera punch) | 9 (1/scene) | 7 | 6 | 8 | 8 |
| max props on stage at once | 9 | wall of 40 + 3 | 5 | 6 | 6 |

The newest and tightest reels (A, D, E) are the bar: 3-4 s scenes, ~100 lines and ~7 helpers per second, ~7 events per second.
B and C have longer scenes with fewer events but compensate with footage, a 40-tile wall and the presenter as hero.
For comparison, a reel made by following the old skill text measured 12-16 lines/s, 0.3-0.4 helpers/s, motion 3.8, and reused kit props.

---

## Part 1 · Per-reel breakdowns

Each breakdown: metaphor and why · beat table (stressed word → event, plus what keeps idling) · presenter · transitions · craft.
"Kick" = the one camera punch of a scene. Times are seconds.

### Reel A · solo founder / AI team (38 s)

Script shape: hook (working harder is the worst move) → list of 5 jobs you do alone → "now picture a team" → 4 example hand-offs →
parallel work, it asks you only for decisions → product reveal (name, memory, calendar, hand-offs) → free plan, comment KEYWORD.

**Metaphors and why**
- *Effort lever card* (`// EFFORT` LOW..MAX) for "working harder": "harder" is a quantity you can crank; a lever has a maximum and
  can break, so "worst" becomes the lever **snapping**. The overload around it (to-do list streaming faster than it is ticked, clock
  whirling, coffee-cup tower, notification stack) is the founder's real desk, all accelerating together.
- *Clothesline of ID badges* for "you're the founder, the salesperson, the marketer...": roles are identities you wear (badges with
  the presenter's clone as the photo); a line can be **overloaded**, so every badge makes it sag more until it snaps.
- *Org chart / dealing cards* for "a team" and "hands out the work": delegation = cards dealt on arcs to seats.
- *Tickets flying into drop zones* for "X goes to the designer": "goes to" = a delivery that lands and unfolds into the result.
- *Freeze scan* for "they only stop to ask you": everything literally stops, packets hang mid-air, one card taps the presenter.

**Beat table** (strips: `patterns_ref/A1_hook_overload.jpg`, `patterns_ref/A2_jobs_clothesline.jpg`)

| beat | stressed word → visual event | keeps idling |
|---|---|---|
| hook 0-2.96 | frame 0: to-do laptop already slamming in (burst lines), rows streaming in, clock and cups present · *solo* → red "TEAM OF 1" tag swings off the laptop · *working* → EFFORT lever card slides in, needle creeps · *harder* → lever slams to MAX, sparks, red glow, the list turbo-scrolls · *worst* → handle snaps off and tumbles + "NOT THE FIX" stamp (kick) · *thing* → every prop falls with its own velocity and spin; the laptop screen morphs into the next scene's card | rows spawn faster and faster, clock hands accelerate (red motion-blur fan), day pill flips MON→TUE, cup tower sways more as it grows, toasts push the stack down |
| jobs 2.96-7.14 | *You're* → clothesline whips across, pins clip on · *founder / salesperson / marketer / support desk* → one ID badge per word drops on a red lanyard (bungee stretch, pendulum, squash), its prop slams onto the clone (crown, tie + call timer, megaphone, headset + ticket pile), the line sags more, the other badges jolt · *newsletter* → heavy badge drops, line sags hard (kick), badges flip to "you." on the back, lanyards snap | badges swing, "on a call 0:12" counts, likes pop from the megaphone, "posting 24/7" |
| team 7.14-11.86 | dot-wipe to navy on *Now picture* · *picture* → viewfinder brackets frame the stage, a dashed blueprint org chart draws 6 empty slots · *team* → 6 agent cards pop into the slots (kick), the 5 job pills lift off the old solo card and land on agents · *all at once* → one pulse runs down every org line · *CEO agent* → its card grows into a goals doc · *looks* → live cursor reads, 3 goals type · *hands out* → 5 task cards deal out on arcs | working dots on every card, live cursor with name flag |
| creative 11.86-15.18 | *launch* → 2 tickets dealt into a dispatch bar · *graphic* → route draws · *designer* → ticket flies the route and slams into the designer's drop zone (kick, shockwave), unfolds into an artboard whose layers fill under the designer's cursor · *script* → ticket 2 flies · *scriptwriter* → unfolds into a doc, lines type, storyboard frames fill | two live cursors, palette swatches popping |
| seo 15.18-19.18 | *SEO* → avatar launches into a workspace header · *finds* → search bar types a seed · *searching* → query pills stream in from both edges, relative interest bars pump (no fake numbers) · *for* → rows re-sort · *niche* → highlight, top 2 tick, rest dim · *two* → 2 rows lift and morph into 2 blog drafts (kick) · *posts* → paragraphs fill · *around it* → keyword spans light | bars breathing, caret, author chip |
| inbox 19.18-23.06 | *inbox* → 10 mails stream in and pile · *sorts* → dealt card by card into Important / Later / Ignore (arcs, spin, squash), counters tick, unread badge counts down · *matters* → Important lights, Ignore folds into "4 archived" · *report* → important cards stack and morph into a report card that lands by the presenter (ping, kick) · *five hours* → calendar tab: slots at 9:00 / 14:00 / 19:00, the report drops into 14:00, "5 h" brackets draw, the week fills | lane counters, unread badge, glow pulses |
| parallel 23.06-27.62 | *working* → a focus card springs out of the presenter · *one thing* → "1 task · in focus" · *six* → 6 workstreams shoot up out of their seats into a lane column · *moving* → every lane live, packets hop lane to lane · *stop* → amber freeze scan, packets hang mid-air (kick) · *ask you* → one lane lifts, morphs into an "Approve?" card and taps the presenter's head twice · *decision* → Approve pulses, lanes resume | spinners, progress bars, micro screens per job |
| reveal 27.62-35.10 | *tool* → an orb lifts, avatars fall into orbit · *called* → rings charge, spin accelerates · product name → squash, pop, wordmark wipes out, shock rings and rays (kick) · *hire* → the logo unfolds into an app window playing the real product recording · *real jobs* → camera push, "Hired ✓" rows · *name / memory / calendar* → three tiles light on their own words · *hand work* → the window morphs into agent cards and a doc hops agent to agent | orbit, recording playing, glowing arcs |
| cta 35.10-38.04 | *free* → FREE badge slams onto a plan card (burst) · *start* → cursor clicks Start (ripple) · *Comment* → comment sheet rises · KEYWORD → typed in an outlined chip, posted, flies into the thread as a glowing pill (kick), copies from masked handles stack · *send* → DM springs out of the presenter, link card pops · *link* → ring sweep, check, thumbs-up + wink | floating keyword chips, typing |

Counts: ~7 events/s (hook: 21 events in 2.96 s), big moments 0.5/s measured, max 6 props in the hook and 9 in "parallel",
5-10 custom drawn objects per scene (hook: laptop, clock, cup, toast, lever, tag, stamp).

**Presenter.** Points up-left at the laptop on the hook with raised brows and a smile; fist + sweat while "working"; both fists
and a 5° head tilt on "harder"; jerks back with shock on "worst" (18 px recoil). In jobs he is *in* every badge as a clone. In the
dark half he points at each new focus (aim re-targets per beat, the pointing arm recoils with the hit on the CTA keyword), shock 0.45
when the freeze happens, thumbs-up + wink at the end.

**Transitions.** Every scene starts and ends in the same hand-off state (camera identity, presenter docked) so hard cuts are seamless;
the stage of each scene is "sucked back" into a returning object before the cut. One dot-wipe flips the palette exactly on the
problem → solution turn ("Now picture a team"). The hook's laptop screen *morphs* into the next scene's card.

**Craft.** Spawn rate is a function (`6.2 + 3.6t`, then a turbo term after "harder"), so overload accelerates instead of being a
loop; the incoming lever card physically knocks the tag off the laptop (objects interact); per-object gravity falls (5200-10000 px/s²)
with spin; jagged break shape on the snapped handle; newest row flashes red; stamp sub-line "MORE HOURS ≠ MORE DONE"; texture micro-text
everywhere ("ID 0001", "now", "overdue", "on a call 0:12", masked handles like `@a•••7`); SFX sparse: whoosh per cut, pop per badge,
ding per agent joining, impact + stamp on the hook punch.

### Reel B · vibe-coded app, fear of showing your face (52 s)

Script shape: hook (no users because you won't show your face; fixable with one prompt I'll give at the end) → the old way (hire
creators, ~40 videos, $10k before your first user) → what works is volume (same face, 40 first lines, 39 flop, one pays) → I made
40 in one night → how (API key, one prompt, two video models, same AI creator) → one rule so you don't get sued → time-limited
offer → comment KEYWORD for the link and the exact prompt.

**Metaphors and why**
- *Camera viewfinder closing on the presenter* for "you're scared of showing your face": the fear IS the camera, so the camera
  becomes the prop and the presenter becomes the hero (REC counter, red glow behind him, hand over mouth, "face cam: off").
- *Locked, blurred prompt + a video scrubber jumping to the end* for "one prompt that I'll give you at the end": the curiosity loop
  made visible: you SEE the prompt exists, can't read it, and see where in the video it unlocks. Paid off in the CTA ("UNLOCKED").
- *A wall of 40 video tiles that prints into a receipt* for "you need about forty... ten grand": quantity = a wall; cost = a receipt
  whose total slot-rolls.
- *Grey-out + one tile lifting with views rolling* for "39 flop, one pays for all": a red outline wave travels from the winner over
  every flop, so "pays for all" is drawn as a connection.
- *A clock rolling 11:48 PM → 6:02 AM over a laptop* for "in one night".
- *Literal glitch cut* on the word "glitch"; *✓ / ✗ rule cards* for "she demos the app / never pretends to be a customer".

**Beat table** (strips: `patterns_ref/B1_hook_shy.jpg`, `patterns_ref/B2_one_night.jpg`)

| beat | stressed word → visual event | keeps idling |
|---|---|---|
| hook 0-7.45 | frame 0: phone "my-app, built in one weekend" springs in · *never* → analytics card "users since launch" with a flat line · *users* → the digit rolls like a slot and lands on 0 (kick) · *scared* → stage clears, viewfinder brackets close on the presenter, REC 00:01 · *face* → hand over mouth, sweat, red halftone glow, a face-detect reticle hunts, "face cam: off" · *fixed* → a chat composer types a blurred prompt · *one prompt* → it is sent into a locked bubble ("unlocks at the end") · *end* → a scrubber appears and the playhead jumps to the end marker | LIVE dot, REC counter, reticle hunting, reply streaming (blurred) |
| old way 7.45-15.85 | *A year ago* → year card rolls 2026→2025 · *workaround* → it folds into a search bar, query types · *hiring creators* → 5 video results deal into a fan · *hundred bucks* → red price stickers slap on each · *forty* → the fan shrinks into an 8×5 wall filling outward, "n videos" counter · *one hits* → one tile marked · *ten grand* → the wall prints as a torn receipt, total slot-rolls to the figure (kick), "before user #1" sticker · *first user* → users: 0 | wall shimmer, counter, sticker wobble |
| volume 15.85-23.38 | *volume* → a wall of 40 tiles of one AI face builds out from the centre and breathes once · *same app, same face* → pills + face-match brackets, camera pushes into 6 tiles · *forty different first lines* → a hook caption pops on each tile (captions ≥ 26 px at the push-in) · *Thirty-nine flop* → wall greys out · *one pays* → one tile lifts to centre, views count up · *all of them* → red outline wave runs over every flop | tile clips playing, views rolling |
| night 23.38-25.05 | *made all forty* → clock card rolls (odometer digits) over a laptop scrolling code · *one night* → time lands on 6:02 AM in red, dawn glow · then the camera dives into the laptop's dark screen, which has the same colour as the dot-wipe | code scroll, moon twinkle, night track filling |
| how 25.05-33.5 | dashboard → key created (masked) → copied · *one prompt* → typed and sent in a terminal · *writes the hooks* → 40 hooks stream · *calls* two models → two model cards render clips with progress · *same AI creator in every clip* → face reference "accepted", a 00/40 → 40/40 grid fills, push in on six, pull back to all forty (kick) | progress bars, typing, clips playing |
| rule 33.5-37.85 | *One rule* → presenter raises one finger, slanted ONE RULE badge slams · *sued* → gavel sticker · *demos the app* → phone demo + big ✓ · *never pretends* → a 5-star "verified customer" card is struck through, ✗ slams (kick) | demo clip, sticker wobble |
| offer 37.85-47.55 | *glitch* → literal RGB glitch cut onto the offer page · amount → a live odometer rolls, a marker circle draws on it · *a dollar back for every dollar* → coin flip $1 → $1 + sticker · *first come* → countdown ticks · *until [date]* → "ENDS" badge stamps (kick) | odometer ticking down, countdown, marquee scrolling |
| cta 47.55-52 | KEYWORD typed and posted, a burst of KEYWORD comments · *setup link* → DM with link card · *exact prompt* → the hook's locked prompt card arrives UNLOCKED · end card: keyword badge, presenter points at the comment box, wink + thumbs-up | comment count rising |

Counts: ~2.5 events/s from props plus constant presenter acting; big 0.56/s; motion 7.8 (highest: full-frame wall builds, glitch,
dives); max on stage: 40-tile wall + pills + winner; 3-6 custom objects per beat.

**Presenter.** The clearest "presenter as hero" in the set: on "scared of showing your face" all content leaves and the viewfinder
closes on him for ~2.5 s (hand over mouth, sweat 0.85, red glow). Elsewhere one gesture per phrase, explicitly listed in code:
point at the year card → hold the phone → point at results → shrug on "few hundred bucks" → point at the wall → hand to mouth on
"before one hits" → both hands to cheeks on "ten grand" → facepalm on "first user" → fist on "volume" → thumb on "pays for all".

**Transitions.** Hard cuts inside the warm half; a dive into a screen whose colour equals the dot-wipe colour (the wipe reads as
going *into* the laptop); a literal glitch cut where the script says "glitch"; props pop out in place just before each cut so the
captions stay clear.

**Craft.** Slot digits with speed-scaled motion smear; a blurred-but-present prompt (unreadable on purpose); per-tile face-point
metadata so crops keep faces centred; duplicate tiles placed far apart; the wall lives in its own camera "world" so the push-in
doesn't move the presenter; only changing characters roll on the clock; never fake view counts on real people's videos.

### Reel C · 4 plugins (46 s)

Script shape: hook (don't start until you've installed these four) → plugin 1 (database: what it can do, without the dashboard) →
plugin 2 (deploy: say "deploy", ships to preview or production, without leaving the terminal) → plugin 3 (multi-agent crew: plan,
build, verify, fix) → plugin 4 (browser eyes: console, network, screenshots, traces, instead of coding blindfolded) → comment KEYWORD.

**Metaphors and why**
- *A dead power strip with four empty sockets* (the assistant) and *one physical plug per plugin*: "plugin" literally means plug-in;
  "four" = four sockets, so the list has visible slots and a 0/4 → 4/4 meter; "don't start until" = the master LED sputters and dies.
- *Power flowing up the cable into an appliance* = installing makes the plugin's panel boot (radial power-on from the cable entry).
- *A control panel of toggle switches on a power bus* for a list of capabilities: each toggle flips on its word and its result appears.
- *CRT power-off + red X* for "without ever opening the dashboard"; *19 branches lighting 19 badges* for "a crew of 19";
  *a 4-station circuit with a power baton* for "plan, build, verify and fix"; *a lens-eye* for "gives it eyes" and a *blindfold* for
  "coding blindfolded".

**Beat table** (strips: `patterns_ref/C1_hook_dead_strip.jpg`, `patterns_ref/C2_blindfold.jpg`)

| beat | stressed word → visual event | keeps idling |
|---|---|---|
| hook 0-3.54 | frame 0: the strip slams in tilted (kick at 0.15) · *vibe coding* → master LED sputters and dies · assistant name → its label underlines · *until* → the strip shakes "no", the 0/4 meter gets a red box, presenter reaches up · *four* → the 4 sockets pulse one by one with dashed ghost plugs · *plugins* → strip docks | LED flicker, meter box pulse |
| plugin 1 3.54-13.9 | *official [db] plugin* → plug swings in on its cable like a pendulum, overshoots, hovers, cocks back and slams into socket 1 (squash, sparks, red bloom, kick, 1/4) · power runs up the cable, a plugin card drops in and boots, install count rolls · *database* → a red line shoots into a database stack · *run SQL / write migrations / generate types / check security advisors* → 4 toggles on a power bus flip on their words; each branch lights, a small result shows and the DB reacts (query flash, a migration disc drops on the stack, a types file, a shield) · *without ever opening the dashboard* → a dashboard window pops, a cursor heads for it, its screen CRT-powers-off, a red X slashes it, it falls | cable sway, power dots flowing, LEDs |
| plugin 2 13.9-21.06 | *second* → plug bungee-drops from above, the presenter catches it · *official plugin* → he jams it in himself (kick, 2/4) · *deploy my app* → typed in a prompt and sent · *ships* → power flows build → deploy → live, a triangle ships along the pipeline, URL types · *preview or production* → a red selector jumps between two environment chips · *terminal* → a terminal rises and replays the deploy | pipeline dots, caret |
| plugin 3 21.06-29.91 | plug swings in, slams (3/4) · *turns [assistant] into* → mascot collapses into one agent at a hub · *crew of 19* → power splits into 19 branches, each lights an agent badge (ticks 0.09 s apart) · *type team* → hub opens into a prompt, "/team" typed · *plan, build, verify, fix* → crew regroups into a 4-station circuit, a power baton runs the loop, each station lights on its word · *together* → everything lit | baton circling, badges blinking |
| plugin 4 29.91-42.04 | slam (4/4), a surge runs the whole strip · browser window powers on with the real README · *eyes on a real browser* → the tab goes to the user's app, a lens-eye powers on and docks into the toolbar · *console errors / network requests / screenshots / performance traces* → each dev-tools capability lights on its word (red errors → "0 errors", waterfall, shutter + thumbnail, flame chart) with a pointing jab · *blindfolded* → power dims, a blindfold wraps the eye, then drops away · window powers down into its cable | eye blinking, waterfall rows, cable pulses |
| cta 42.04-45.9 | lit strip rises, a name tag clips onto each cable (0.12 s stagger) · *all four* → surge through every socket · *comment* KEYWORD → sheet rises, keyword typed, posted as a glowing pill (kick), copies stack · *links* → DM springs out of the presenter with the four links, wink + thumbs-up | cables flowing |

Counts: ~2.8 events/s; big 0.50/s; max 5 props (strip, cables, powered panel, sub-panel, eye); one reel-wide metaphor with a fresh
appliance per plugin. Weakest hook of the five (one object for 3.5 s), and its motion (5.4) is the lowest: the strip alone carries it.

**Presenter.** Reaches up for the strip on the hook; catches the second plug and plugs it in himself (the presenter physically does
the beat); a 9° pointing *jab* over 0.26 s on every listed capability word; hand over eye on "blindfolded", facepalm, shrug; thumbs-up
+ wink at the CTA.

**Transitions.** The strip springs from its dock to centre stage at the start of each plugin and returns at the end; each powered
panel "powers down into its cable"; hard cuts between plugins.

**Craft.** Pendulum swing with overshoot then a cock-back before the slam; squash of the strip on impact; power pulse along the
cable before the panel boots; real numbers and commands only (read from a facts file); 0/4 meter in the top-right readout ticking
exactly on each plug; tick SFX per badge; whoosh per cut; click + ding on each seat.

### Reel D · vibe coding makes you worse / a plugin that teaches (29 s)

Script shape: hook (it quietly makes you worse; now a plugin stops that) → name + where to install → before writing anything it asks
how you'd approach it → walks you through tradeoffs, explains concepts → you decide, it writes and explains what changed and why → on
existing projects it sketches a map → you ship as fast, but a month later you understand your app → comment KEYWORD.

**Metaphors and why**
- *Skill chips knocked out of a "your coding skills" card by every auto-accepted "Done!"*: "quietly making you worse" is decay by
  subtraction; each convenience costs one skill, silently (chips slip out and tumble, no alarm).
- *A plug jamming into an empty socket on that card, freezing the falling chip mid-air*: "made to stop that" = time stops.
- *Code stream rewinding + a padlock dropping, "0 lines written"* for "before it writes anything, it asks".
- *A balance beam on a fulcrum with a walker stepping across rows* for "walks you through the tradeoffs": tradeoff = balance; "walks
  through" = a literal walker whose every step re-tips the beam.
- *A concept card bursting out of a dashed (unknown) word* for "explains any concept you don't know yet".
- *Your decision as a red token you drag into the padlock* for "you make the decisions; it still writes the code".
- *Crooked file boxes snapping straight* for "a little map of how the pieces fit together".
- *Two race lanes that tie, then a tear-off calendar and fog vs clarity* for "just as fast... a month from now you'll understand".

**Beat table** (strips: `patterns_ref/D1_hook_drain.jpg`, `patterns_ref/D2_tradeoff_scale.jpg`)

| beat | stressed word → visual event | keeps idling |
|---|---|---|
| hook 0-4.46 | frame 0: vibe-coding window already streaming code with auto-accept ON, skills card below · *quietly* → each "Done!" fires a red spark that knocks one skill chip out; status flips "draining" · *worse* → the shipped code scrambles into gibberish (camera punch), cursor selects a line: "what does this do?", red ? marks · *now* → an empty socket pops on the card, one more chip works loose · *plugin* → a plug flies in on its cable and jams in (kick): sparks, the falling chip freezes mid-air, auto-accept flips off, "stopped" · *stop* → the loose chip snaps back; window whips off, the card flips into the next scene's card | code streaming, chips wobbling loose, "Done!" pills popping |
| name 4.46-7.5 | real repo page flies in · *called* → punch-in on the title · name → red marker underline strikes (kick) · whip-pan to the star count, which lifts off with sparkles · *it's in* → the page fly-scrolls (zoom out, travel, zoom in) to the install line · *[company]'s* → highlighter sweep + red loop · terminal pushes up and types the install line, a dashed leader ties it to the circled words · *directory* → "Installed", window whips off | caret, sparkles |
| asks 7.5-10.1 | request types into a prompt card · *writes* → code starts streaming · *anything* → stream freezes and rewinds, panel hatches over, padlock drops and clicks shut (kick), "0 lines written" rolls · *asks* → step 01 lights, a checkpoint card shoots out of it · *approach* → your cursor clicks into the answer box, caret blinks | caret, status roll |
| tradeoffs 10.1-13.38 | fulcrum rises, beam drops on it, two option cards tossed onto the ends tip it · *walks you through* → a red walker steps row by row (pro ✓ / cost −), each step re-tips the beam · *tradeoffs* → spark into the fulcrum "?", beam settles level · *explains* → walker hops onto the unknown term (dashed), marker sweep, ? pops · *concept* → a concept card bursts out of the term (kick), its diagram draws itself · *know yet* → ? flips to ✓ | beam bobbing, walker |
| decide 13.38-17.82 | your cursor clicks step 04 · *decisions* → you hover one option, hesitate, pick the other (red fill wipes from the click), the loser is struck and drops, YOUR DECISION stamp (kick) · the choice stays as a red token · *writes the code* → you drag the token into a padlock, it springs open and falls, a scan wakes the code; rows insert (shoving others down), one row struck (−), one added (+), "+2 −1" · *what it changed and why* → a report card pins to the changed line; your token flies into the WHY row | typing, row shoves |
| map 17.82-21.42 | *existing project* → a file tree pours in crooked, red ? on the key files, a dashed import tangle scribbles · *first* → a scan bar sweeps, each row snaps straight as read, ? flip into UI / API / DB tags · *sketches* → graph paper, tagged files fly into place, a red pencil sketches a box around each group, arrows draw · *how the pieces* → a request packet runs UI → API → DB and back · *fit* → crooked boxes snap into line (kick), "saved ✓" | packet running, pencil |
| month 21.42-26.18 | two lanes (without / with) on the same track · *ship* → both runners launch, leapfrog · *fast* → tie, "=" badge · *difference* → camera pushes to the one thing that differs · *a month from now* → a tear-off calendar drops, pages tear and tumble, it shrinks into a "+1 month" pill · lanes return: one map fogged ("wait... what does this do?"), the other crisp with ✓ per box · *understand* → meter 75% → 100% (kick) · *your own app* → the fogged lane sinks | runners, fog drifting |
| cta 26.18-29.3 | *Comment* → sheet springs up, camera pushes into the empty composer · KEYWORD → the same word inside the reel's own card selects red, its letters lift out, arc up and land one by one in the composer · *and* → Post pressed (kick), glowing pill flies into the thread, replies roll in · *send* → DM springs from the presenter's hand · *link* → link card unfurls, "delivered ✓", thumbs-up + wink, 0.5 s settled hold | replies rolling |

Counts: ~7 events/s (tradeoffs: ~24 events in 3.3 s); big 1.3/s (highest); motion 8.6 (highest); max ~6 props; 6-10 custom
objects per scene (map scene: 46 helpers in 3.6 s).

**Presenter.** Points the whole time and re-aims every phrase (`aimAt(t)` follows the moving focus); facepalm on "worse";
thumbs-up on "stop"; hold on "a month"; thumb + wink on "understand". His pose is blended across every cut (0.22 s) so scenes never pop.

**Transitions.** Whip-offs, a card flip from the hook's card into the reel's progress card, whip-pans inside a page, fly-scrolls
(zoom out, travel, zoom in) instead of plain scrolling, every scene's stage "filed" back into its numbered step.

**Craft.** Dashed outline = "unknown", solid = "understood" (a visual grammar kept all reel long); real example text from the
product's own docs; status lines that roll ("0 lines written", "+2 −1"); a top-right readout that climbs (UNDERSTANDING 13% → 38%
→ ...); the CTA keyword is physically taken from an object already on screen.

### Reel E · cost of a first sales hire / outbound agency (25 s)

Script shape: hook (founder about to hire a first salesperson: do this math first) → salary + tools → 3 months before a single call
→ $22,000 before anything happens → a client was about to make that hire → instead we built the system in 30 days → competitors still
interviewing, client already on calls → every month you wait = a month of calls you don't get → book a call, link below.

**Metaphors and why**
- *The hiring paperwork itself, made physical*: job post with a hold-to-publish bar, offer letter with an odometer salary, wall
  calendar of a new hire's ramp, client file folder. The topic's own objects carry it; no analogy needed.
- *A giant calculator slamming onto the publish click* for "do this math first": the math physically interrupts the hire.
- *Bills catching fire and burning to embers* for "$22,000 spent"; *a flat "calls booked" line* for "before anything happens".
- *FREEZE (viewfinder + pause chip) a hair above the Hire button* for "was about to make that same hire".
- *A segmented switch "Hire a rep | Build the system"* thrown on "Instead": the decision as a physical toggle that becomes the board.
- *A race with two calendars* for "competitors still interviewing, client already on calls"; *pages tearing per word* for "every
  month you wait".

**Beat table** (strips: `patterns_ref/E1_hook_calculator.jpg`, `patterns_ref/E2_numbers.jpg`)

| beat | stressed word → visual event | keeps idling |
|---|---|---|
| hook 0-3.62 | frame 0: job post card mid-slam (bursts, red glow), title typing, NOW HIRING tape scrolling behind, presenter waving · *SaaS founder* → "Your team" card swings in · *about to* → checklist ticks, cursor flies in · *hire* → HIRING tag pulses, underline sweeps, status → Ready · *first salesperson* → "#1" stamps red, an empty "Sales #1" slot lights with a ghost hire; cursor locks on Publish, hold bar fills · *do* → a giant calculator drops from the sky and slams (kick): the click freezes, tape halts · *this / math / first* → keys hammer +, +, ×, = while the display builds SALARY + TOOLS × RAMP = ? | tape scrolling, hold bar, display building |
| salary 3.62-6.68 | *Salary* → offer letter spins down and slams · *$85,000* → odometer rolls to the figure in red (kick), bills spray, a pen signs · *a year* → 12-month strip ticks Jan → Dec, PER YEAR stamp · the figure peels off as a chip into the ledger · *sales tools* → 4 tool cards deal in one per beat, toggles flick ON · *another* → a total bar pops · *$6,000* → odometer rolls, cards are sucked into the bar | bills fluttering, toggles |
| months 6.68-8.94 | *need* → calendar springs, onboarding docs pop around it, Month 1 fills with training bars · *about* → Month 1 tears off, Month 2 riffles · *three* → Month 3 lands, "~3 months" tag shoots into the ledger · *before they book* → docs blow away, "Calls booked 0" lights, a red day-cursor stamps empty days · *single* → one lonely "Intro call" card drops on the last day (kick), 0 → 1 · *call* → it rings | day-cursor marching, flat line |
| burn 8.94-11.52 | *That's* → the three ledger values peel off and fly up on arcs · *$22,000* → they fuse into one giant slot-rolling number (shock ring, burst, kick), bills spray and burn to embers · *spent* → a chart grows out of the number, red spend line climbs month by month · *before* → calls line crawls flat · *anything* → scrub cursor hops Month 1 → 2 → 3, "0 calls" · *happens* → flat-line ring, NO CALLS YET stamp | embers, running $ tag |
| client 11.52-13.86 | *Our client* → a kraft client file whips in and slams (kick) · client name → glyph pops, name types · *was* → cover flips, job post rises out of the pocket · *about to make* → a hand glides in, the Hire button heats up · *that* → a dashed ghost lifts off the ledger's HIRE #1 and morphs onto the post · *same* → FREEZE: time stops a hair above the button, viewfinder + pause chip · *hire* → frozen stage sucked into the ledger | button heat shimmer |
| system 13.86-17.14 | dot-wipe to black · *Instead* → switch knob throws to "Build the system", stretches into a board header with DAY 00/30 · *built / whole / outreach / system* → pipeline nodes fly in from alternating sides and snap into slots, connectors draw, data dots flow · *live* → switch flips on · *30* → day ruler hits 30, LIVE pill slams (kick), everything lights | data dots flowing, day counter |
| race 17.14-20.58 | split line draws, "vs" badge · *competitors* → left: interview calendar, candidate stack, mug; right: calendar filling with "Intro call" blocks · *interviewing* → "Interview 3 of 9" rolls to 4, a candidate swipes away · client name → left dims, a call card rings, camera leans right · *already* → left panel falls away, client card takes centre, dot crosses the "1st call" flag (kick) · *calls* → collapses into a chip | feed rows pushing, waveform |
| cta 20.58-25.43 | calendar stack with ghost "Call" blocks · *month / wait / month / calls* → one page tears off per word, its ghost calls dissolve into dots · *don't get* → last ghosts struck out · *Book* → page flips into a booking panel, slots cascade · *call* → cursor picks a slot · brand → presses "Book a call" (kick, ripple, sparks) · *link below* → a link card, arrow bounces down | spinning clock, logo glint |

Counts: ~6 events/s (salary: ~19 events in 3.06 s); big 0.83/s; max 6 props (job post, team card, tape, cursor, calculator, ledger);
5-8 custom objects per scene.

**Presenter.** The reference performance for pointing: point is the default and re-aims every 0.3-0.6 s; one gesture and one
expression window per phrase, in code: wave (hook) → thumb on "SaaS founder" → point at the post on "hire" → both hands hold on
"do" with shock 0.85 → point at the calculator on "math"; shrug + shock + sweat on "$85,000"; point at the tools; thumb on "another";
shrug + sweat on "$6,000"; shock 1.0 on "$22,000"; wink on "already". Gaze follows the focus (separate `lookX/lookY` targets per 0.3-0.8 s).

**Transitions.** Hand-off state at every cut; the calculator *crushes into* the next scene's object; client stage "sucked into" the
ledger; one dot-wipe on "Instead," flips warm paper → black product look (problem → solution).

**Craft.** Bills that catch fire individually; a NOW HIRING tape that halts when time freezes; ghost (dashed) versions of things that
don't exist yet (the hire, future calls); alternating-side fly-ins for pipeline nodes; a top-right readout that turns the story into
one running number ("SPENT BEFORE 1ST CALL $0" → "$22,000" → "OUTREACH LIVE" → "ON CALLS"); "cash" SFX on each money figure.

---

## Part 2 · Cross-reel synthesis

### 2.1 The patterns that repeat in every reel

1. **Frame 0 is already mid-action and full.** A, D, E open with 3-4 elements on stage at 0.0 s and something already slamming
   or streaming (to-do laptop mid-burst, code window mid-stream, job post mid-slam). B opens on the phone springing in; C on the strip
   slamming in. Never a fade-in, never a title card, never an empty frame.
2. **The hook's key verb is a state change of a physical object, landing on the word.** working → lever creeps, harder → MAX,
   worst → snap (A) · users → slot lands on 0 (B) · until → dead LED, 0/4 boxed (C) · plugin → plug jams in and freezes the fall (D)
   · do this math → calculator slams onto the click (E). The hook kick lands at 0.15-3.3 s.
3. **Escalate, then break.** Inside a beat the system accelerates (spawn rate, clock speed, needle creep, sag) and the punch word
   *breaks* it (snap, freeze, flat-line, crash, stamp). The break is the scene's one kick.
4. **A stage builds; nothing leaves until the reset.** Each stressed word adds or changes one element; earlier ones stay, shrink
   or dim, and keep an idle. Elements on stage: 1-2 at 0.5 s, 3-6 by 3 s (C's hook is the one exception and the weakest), peaks of 6-9.
   At the scene cut (every 2.3-4.9 s in A/D/E) the whole stage is absorbed, falls or whips off together.
5. **Lists are slots that fill, one per word, with a counter.** 4 sockets and a 0/4 meter (C), 5 badges on a line that sags (A), 6
   numbered steps that light (D), ledger rows that receive chips (E), 4 toggles on a bus, 19 branches. Each item is a *different*
   physical act (crown vs tie vs megaphone; query flash vs disc drop vs file vs shield). The presenter jabs on every item.
6. **Problem and solution live in different worlds.** Problem: warm paper, red, overload, gravity, decay, chaos, flat lines, empty
   slots. Solution: order, flow, light, power, things snapping into place. In 3 of 5 reels a dot-wipe flips the palette exactly on the
   turn word ("Now picture", "Instead", "I gave..."), in the others the "power on" / "unlock" moment does the same job.
7. **Numbers ride objects and roll onto the word.** An odometer on an offer letter, a receipt total, a slot digit landing on 0, a
   clock rolling through the night. Parts fly together and fuse into totals; a figure then peels off as a chip into a running total.
   The top-right readout keeps the story's one number live (JOBS ON YOU 4, PLUGINS 3/4, SPENT BEFORE 1ST CALL $22,000, UNDERSTANDING 38%).
8. **Negation is shown, then destroyed.** "without opening the dashboard" → the dashboard appears and is powered off and slashed;
   "not the fix" → stamp; "before anything happens" → a flat line; "before it writes anything" → the code rewinds. You must draw
   the thing you are saying "no" to.
9. **Time is physical.** Rolling clocks, tearing calendar pages (one page per stressed word), day rulers counting to 30, a day
   cursor stamping empty days, "+1 month" seam pills.
10. **The topic's own artifacts first, an analog machine only for abstract verbs.** ~70% of props are real objects from the
    script's world made physical (to-do list, job post, offer letter, inbox, code window, repo page, terminal, calendar, comment
    sheet); ~30% are machines invented for abstract lines (lever, clothesline, power strip, balance beam, padlock, burning bills).
11. **Everything has a texture of reality.** Mono labels (`// EFFORT`, `// your coding skills`), IDs, timestamps, statuses that
    count ("on a call 0:12", "0 lines written", "Interview 3 of 9"), masked handles, real numbers and commands from a facts list,
    halftone shadows under every card.
12. **The presenter points at the focus and acts every phrase.** Pointing is the default; aim re-targets with the focus; a
    gesture or expression change every 0.3-0.8 s; jab on list items; shock on money; hand over mouth on fear; once per reel he can
    be the hero (B: the viewfinder closes on him); thumbs-up + wink on the CTA.
13. **Transitions come from the words.** A dot-wipe on the turn word, a dive into a screen whose colour matches the wipe, a literal
    glitch cut on "glitch", a freeze on "stop" / "same", a page tear on "month". Within a scene: hard cuts and whips. At most two
    transition types per reel plus the CTA.
14. **CTA = the keyword as a physical object.** Comment sheet rises → keyword typed (in D its letters are lifted out of a card already
    on screen) → posted as a glowing pill (kick) → copies stack from masked handles → DM springs from the presenter with a link card
    (in B it pays off the hook's locked prompt) → thumbs-up + wink → 0.5 s settled hold. 3-5 s.
15. **Sound is sparse and attached to events.** Whoosh on every cut, pop/ding per list item, stamp/impact on the kick, cash on money,
    tick per counter step, all 10-21 dB under the voice, about one cue per 1-1.5 s.

### 2.2 Hook construction (first 3 s)

| | frame 0 | elements by 1 s / 3 s | first big moment | hook punch (kick) | presenter |
|---|---|---|---|---|---|
| A | laptop slamming in, rows streaming, clock, cups | 4 / 6 | 0.0 slam | 2.0 lever snaps + stamp | points at laptop, then fists + sweat, shock |
| B | phone springing in | 2 / 3 (+ viewfinder) | 0.0 phone | 2.22 counter lands on 0 | wave, point, then becomes the hero |
| C | strip slamming in tilted | 1 / 1 | 0.15 slam | 0.15 slam | reaches up, points at sockets |
| D | code window streaming, skills card | 3 / 4 | 0.5 first chip knocked out | 3.25 plug jams in, chip freezes | point, facepalm on "worse" |
| E | job post mid-slam, tape scrolling, presenter waving | 3 / 5 | 0.0 slam | 2.75 calculator slams | wave, thumb, point, shock on "do" |

Recipe: the problem's everyday object is already on screen and moving at 0.0 s; within 1 s it is surrounded by its context
(2-4 more objects, each with an idle); something accelerates; on the hook's stressed verb a big object slams or breaks (kick); by
3.5 s the stage hands off. Curiosity loops get a visible object too (B's locked prompt + scrubber).

### 2.3 Metaphor invention method

> The examples below illustrate the METHOD. If your topic matches one of them, invent a different metaphor anyway: every reel gets its own visual idea, never a copy of an example.

1. **Write the beat's core relation in plain words.** Not the topic, the *relation*: overload, decay, transfer, blocking, choice,
   accumulation, comparison, waste, delay, transformation, unlocking, order-from-chaos.
2. **Look for the literal object first.** Does the script's world already contain a thing that shows this relation (the job post, the
   invoice, the calendar, the inbox, the code window)? If yes, use it and make it physical: it slams, prints, tears, rolls, burns.
3. **If the line is abstract, pick a machine that has the same relation AND a visible limit or failure.** A lever has a max and can
   snap; a line can sag and snap; a socket can be empty or dead; a beam tips; a tank fills and overflows; a door jams; a fuse blows.
   The limit is where your punch word lands.
4. **Map every stressed word to one state of that system.** Write the list: word → state (enters, rises, maxes, breaks, freezes,
   snaps back, lights, fills). If you can't give each stressed word a distinct state, the metaphor is too thin: choose another.
5. **Give it a label so it reads with the sound off.** `// EFFORT`, `your coding skills`, `HIRE #1`, a meter "0/4". One mono label
   turns an abstract machine into a sentence.
6. **Give every part an idle.** What does it do when nothing happens? Ticks, sways, drips, scrolls, blinks, flows.
7. **Decide its exit.** Does it morph into the next beat's object, get absorbed into a returning object, or fall with gravity?
8. **Check uniqueness.** Is this prop from another reel or from a kit? Then it is a costume, not a metaphor. Reuse only if the script
   literally names it (a script about plugins may use a plug; a script about habits may not).

**Ten worked examples from the creator's beats**

| sentence (paraphrased) | relation | metaphor | event per stressed word |
|---|---|---|---|
| working harder is the worst thing you can do | overload with a limit | effort lever card + accelerating desk | working: needle creeps · harder: MAX, sparks · worst: handle snaps + NOT THE FIX stamp · thing: whole desk falls |
| you're the founder, salesperson, marketer, support, newsletter | burden accumulating | clothesline of ID badges with clone photos | each role: badge drops, prop slams on clone, line sags more · newsletter: heavy drop, line snaps |
| a launch graphic goes to the designer | transfer | ticket on a drawn route into a drop zone | launch: ticket dealt · graphic: route draws · designer: ticket slams in, unfolds into the artboard |
| they only stop to ask you when there's a decision | interruption | freeze scan over live lanes | stop: amber scan, packets hang mid-air · ask: a lane lifts and taps the presenter · decision: Approve pulses |
| you're scared of showing your face | fear of exposure | camera viewfinder closing on the presenter | scared: REC brackets close · face: hand over mouth, reticle hunts, "face cam: off" |
| 39 flop, one pays for all of them | many fail, one carries | 40-tile wall, one lifts | thirty-nine: wall greys out · one: a tile lifts, views roll · all: outline wave from winner over every flop |
| don't start until you've installed these four | missing capacity | dead power strip, 4 empty sockets | start: LED dies · until: meter boxed red · four: sockets pulse one by one |
| vibe coding is quietly making you worse | silent decay | skill chips knocked out by each "Done!" | quietly: chips slip out unannounced · worse: code scrambles · plugin: plug jams in, falling chip freezes |
| it walks you through the tradeoffs | weighing options | beam on a fulcrum + a walker | walks: walker steps row by row, beam re-tips · tradeoffs: beam settles level, "?" lights |
| that's $22,000 spent before anything happens | money wasted, zero result | values fuse into a burning number + a flat line | $22,000: parts fuse, bills burn · spent: line climbs · anything: cursor hops months, "0 calls" · happens: flat-line + stamp |

**Ten new examples (unrelated topics, different props)**

| sentence | relation | metaphor | event per stressed word |
|---|---|---|---|
| Fitness: "More cardio won't burn belly fat if you sleep five hours a night." | inflow beats outflow | a bathtub labelled `// body fat` with a drain (cardio) and a tap (stress hormones) | cardio: drain plug pulled, swirl · won't: water level holds · five hours: a moon dial clicks to 5h and the tap opens 5 notches · night: water crests the rim |
| Cooking: "Your pasta is bland because you salt the sauce, not the water." | wrong place of input | two pots in cross-section, a noodle drawn as a sponge | bland: noodle core stays pale · sauce: grains bounce off the noodle surface · water: grains dissolve and the noodle core darkens from the outside in |
| Personal finance: "Five dollars a day doesn't feel like money until you see the year." | small amounts compound into a big one | a glass jar on a shelf, one coin dropping per tick of a day counter | five dollars: one coin clinks · a day: counter flips fast, coins pour · year: jar fills to the lid, its label rolls up to the yearly total (computed, not invented) |
| Dating apps: "You swipe through two hundred people a week and none of it feels real." | volume without substance | a conveyor belt stamping out profile cards | two hundred: belt speeds up, counter rolls · week: day ticker flips · real: the presenter taps a card and it falls flat, a cardboard cutout |
| Real estate: "Rent isn't money thrown away, it's the price of being able to leave." | cost re-framed as a feature | a house with a price tag that grows wheels | thrown away: bills fall into a shredder, then the shredder rewinds · price: tag clips onto the house · leave: wheels drop out, the house rolls to another pin on a map |
| Language learning: "You know two thousand words but freeze when someone actually talks to you." | stored but not retrievable | a warehouse of word boxes behind one narrow loading door | two thousand: shelves fill, counter rolls · freeze: frost spreads over the door, the forklift stalls · talks: a speech bubble pushes on the door, boxes jam in the frame |
| Career: "Asking for a raise without numbers is asking for a favour." | input missing, output blocked | a vending machine labelled `RAISE` | raise: presenter steps up · numbers: coin slot stays empty, he shakes the machine · favour: the display reads "OUT OF ORDER", a tiny "please?" note slides out |
| Local business: "Your bakery has 3,000 followers and none of them live within ten miles." | audience in the wrong place | a map with a radius ring around the shop and follower pins | 3,000: pins rain onto a world map · none: radius ring draws around the bakery, empty inside · ten miles: the ring's label snaps on, all pins dim outside |
| Studying: "Rereading your notes feels like studying, but testing yourself is what makes it stick." | feeling vs retention | a wall where facts are taped or nailed | rereading: notes get glossy coats of paint and slide down · feels: a "done ✓" badge lights falsely · testing: a hammer nails each fact card · stick: the presenter yanks one card, it holds |
| Job hunting: "Sending a hundred applications a week is why you're not getting interviews." | spray vs aim | a paper-airplane launcher facing a wall of closed doors | hundred: airplanes swarm out, counter rolls · week: calendar ticks · not getting: planes crumple against doors and pile up · interviews: one plane with a cut-to-fit key opens one door |

Note how none of these reuse a gauge, clothesline, power strip, beam, padlock, clock or calendar: each comes from its own relation.

### 2.4 Effort budget (per second of finished video, from the code)

| item | creator (A/D/E, the bar) | creator (B/C, longer scenes) | minimum to accept |
|---|---|---|---|
| scene length | 2.3-4.9 s (median ~3.6) | 1.7-12 s | 2-6 s |
| scene code (non-empty lines) | 90-110 /s, 260-530 per scene | 47-51 /s, 140-600 per scene | ≥ 50 /s, ≥ 200 per scene |
| custom helpers (drawing or motion functions written for this reel) | 6.4-7.9 /s, 17-61 per scene | 3.4-3.7 /s | ≥ 3 /s |
| custom drawn objects per scene | 5-10 | 3-6 + footage | ≥ 4 per scene, ≥ 2 invented for this script |
| word-cued anchors | 2.3-3.2 /s | 1.7-2.1 /s | ≥ 2 /s (an event every 0.3-0.6 s) |
| discrete visual events | ~6-7 /s | ~2.5-3 /s | ≥ 3 /s |
| big moments (large part of frame changes) | 0.5-1.3 /s | 0.5-0.56 /s | ≥ 0.6 /s |
| kicks | 1 per scene (0.25-0.35 /s) | 1 per scene | 1 per scene, never more |
| props on stage | 3-6 mid-beat, peaks 6-9 | 2-5 or one dense wall | ≥ 3 by second 3 of every scene |
| visible change per 0.1 s step | 98-99% | 96% | ≥ 95%, no still stretch > 0.5 s |
| presenter changes (gesture, expression or gaze) | ~2 /s | ~1.5 /s | ≥ 1 per phrase |
| SFX cues | ~1 per 1-1.5 s | same | one per meaningful event |

Depth layers per frame (back to front): paper/grid → halftone glows and shadows → receding older props (scaled 0.75-0.9, dimmer) →
the focus prop → front FX (bursts, sparks, stamps, shock rings, flying items) → presenter → captions and frame UI (section label
top-left, live readout top-right). Each prop itself is 5-7 drawn layers: shadow, body, stroke, label, micro-text, state indicator,
glow.

Motion constants found in the code (use them as defaults, not as a look):
- entrances: damped spring `pop(dt, f 2.6-3.0, damping 0.45-0.55)` → peak at ~0.2 s, 15-20% overshoot, settled by ~0.45 s.
- jolts and wobbles: `ring(dt, 3-4 Hz, decay 7-9)`; squash on landing ~12%; neighbours jolt when something lands near them.
- exits: `inBack` over 0.22-0.4 s, or gravity 5200-10000 px/s² with per-object horizontal velocity and spin.
- staggers: 0.05-0.09 s between list items (0.07 most common), 0.12 s for slower clip-on rows.
- events land 0-0.1 s before the word starts; gestures start 0.04-0.12 s before the word and blend in over 0.12-0.22 s.
- pointing jab: +9° over 0.26 s per listed item.

### 2.5 Anti-patterns (what makes a reel look templated)

| looks templated | what the creator does instead |
|---|---|
| the same prop family in every reel (a gauge here, a clothesline there, because the kit has them) | a prop derived from this sentence's relation; kit props only when the script names them |
| one object alone in empty space for a whole beat | 3-6 elements by second 3, one of them the focus, the rest idling |
| uniform timing: everything pops in with the same spring, same delay, on a grid | timing follows the voice: stressed words get slams, unstressed stretches get idles, lists get 0.05-0.09 s staggers, punches get kicks |
| captions doing the work ("EFFORT ↑" as text on a card) | the word becomes a state of an object (the needle goes to MAX); captions only repeat the voice |
| a number typed as text | a number that rolls on an object, lands on the word, then travels into a running total |
| icons and badges sprinkled on cards | each list item is a different physical act |
| the old object vanishes, a new one pops in centred | the old object steps aside or transforms into the new one |
| the stage freezes after the event until the cut | every landed element keeps an idle; nothing static for more than 0.5 s |
| a presenter doing one point for the whole scene | a gesture or expression per phrase, aim follows the focus, one hero moment per reel |
| negation shown as a red X on nothing | draw the thing being negated, then kill it physically |
| the problem and the solution look the same | change the world on the turn word (palette, physics, order) |
| a CTA card with the keyword as plain text | the keyword is typed, posted, glows, multiplies, then a DM delivers the promised thing |
| clutter mistaken for density: chips, tags and overlapping windows all fighting | full stage, ONE focus: newest element gets the accent, the pointer and the camera lean; readable text ≥ 40 px, held ≥ 0.4 s |
| a card parked bottom-left for the whole reel as a "through-object" (some of these reels did this; the creator later dropped it) | continuity through objects that return at cuts and absorb the stage, then leave; the stage belongs to the scene |
| fake specifics (invented stats, real people's names, fake view counts on real people's videos) | real numbers from the brief, masked handles, "relative" bars when no number is known |

### 2.6 Before you write any scene code, answer these per beat

1. What is the relation in this sentence, and which literal object or invented machine shows it with a visible limit?
2. Which state does each stressed word trigger (one per word, all different)?
3. What is already on stage, and what does each element do while idle?
4. Which word gets the break (the kick)?
5. Where does the presenter point on each phrase, and which expression or gesture changes?
6. How does the stage leave (absorbed, morph, fall, whip), and what does the next beat start with?
7. Is any prop copied from another reel or a kit without the script naming it? If yes, invent again.
