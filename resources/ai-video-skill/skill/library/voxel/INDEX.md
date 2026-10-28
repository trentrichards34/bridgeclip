# Voxel library: 15 beats from a real reel

These are the scenes of the creator's ~52 s voxel reel *"You don't have to be for everyone"* (a marketing explainer: two coffee
shops, one tries to serve everyone, one serves a single customer). They are de-branded (shops are now `CORNER CAFE` / `NEXT DOOR`,
the CTA uses `ctx.keyword`) and import the shipped kits (`/engine/kits/base.js`, `people.js`, `shopfront.js`).

**Reference code, not drop-ins.** Each one was written for that reel's timing: cues are `ctx.wordAt('word', spec.t0) ?? <old seconds>`,
state is module-level (`let S`), so each file can serve only one beat. To reuse one: copy it to your project's `scenes/`, add a beat
for it in `plan.js`, change the cue words to words in YOUR script (keep a fallback), swap the props/text for your topic, then
render stills with `--only <id>`. Every file was verified to render with the shipped engine.

Cast used throughout: `makeFounder(ctx,'red')` (marco, red apron, the "shout at everyone" owner), `makeFounder(ctx,'green')`
(alex, green apron, the focused owner), `makeBusyPro(ctx)` (sam, yellow raincoat, the one customer), crowd via
`makeCrowdMember` / `extraPerson`.

| file | line it illustrated | what it shows | techniques worth stealing |
|---|---|---|---|
| `k01_open.js` | "Two people open a coffee business." | HOOK. Two shops on a street corner (facades angled so both signs fit portrait), two owners land a hop, balloons, confetti | frame 0 mid-air; `hops()` helper with anticipation crouch + landing ring; shutter SLAM (easeIn up, tiny bounce); 5 shots A-E switched by `_shot(t)`; crane back on the last word; confetti already falling at t=0 |
| `k02_same.js` | "Same city, similar products, similar budgets." | Skyline erupts on "city"; cups slammed on a counter with "="; coins flicked into two jars | sync two characters with one pose function (mirror by sign); "=" card pop; coin jar `fill`; 3 hard cuts, dutch angle on the last |
| `k03_fork.js` | "But they make two very different decisions." | Owners walk a road, signpost 1 / 2 slams up, road forks, they split with flip cards | tracking walk (`walk` phase + moving camera); worm's-eye shot; `makeSign` flip from '?' to the answer on the key word |
| `k04_everyone.js` | "The first business tries to attract everyone." | Owner on a crate with a megaphone, arrows fan out into every building, EVERYONE banner unrolls | over-the-shoulder shot; staggered projectiles landing across one word; `makeBanner` unroll + flash |
| `k05_crowd.js` | "Students, professionals, coffee enthusiasts, anyone…" | One crowd type drops in per word with a label card, then a crowd FLOOD, cups pop into every hand, toast | **label card per word** with its own hard-cut close shot; crowd flood from both sides with hops; props popping into hands (`holdR`) |
| `k06_message.js` | "Their message is simple. We make great coffee." | WE MAKE GREAT COFFEE marquee slams, bulbs bounce per word, crowd turns its back, "SO?" card | **marquee slam** (drop + dust + shake); bulbs keyed per word; deadpan synced blink; reaction card |
| `k07_one.js` | "The second business chooses a smaller audience…" | Dark stage: magnifier scan, crowd pops away until one customer is left in a spotlight; then front door delivery | two sets in one beat (second set at local x +40, hard cut between); crowd removal one by one; `makeSpotlight` slam; delivery box SLAM on the doormat |
| `k08_convenience.js` | "So instead of just saying their coffee is great…" | OUR COFFEE IS GREAT sign gets X'd with a marker, icon blocks slam around the customer, CONVENIENCE letter blocks rain in | **strike-through** with two slashes (`crossStyle: 'x'`); `makeLetterBlocks` raining into a word; icon blocks stacking |
| `k09_everything.js` | "Their website, their packaging, their content, even their subscription offer." | 2x2 display cubby, one product slots into each cell per word, green check per cell | **one cell per word** with hard cuts to each cell (`wordAt('their', t0, n)` for repeated words); checks ripple at the end |
| `k10_might.js` | "The first business has a product people might like." | Owner presents a cup, crowd stares blankly, MAYBE? meter can't decide, tumbleweed | comic timing: blank synced blink, `makeMeter` needle oscillation, grin dropping to a flat line |
| `k11_reason.js` (+ `k11_reason_kit.js`) | "The second has a clear reason for a specific customer…" | REASON card (clock + door = TIME SAVED) slams over the customer, lock-on reticle; then a balance scale tips to the focused shop | a scene-specific prop file (`*_kit.js`); reticle lock-on; **scale tipping** (`makeScale` + things dropped in the pans); crash zoom |
| `k12_ignored.js` | "…your message can become easy to ignore." | A speech bubble sails at the crowd; one per word they tune out (headphones drop on, phones up); bubble bounces off and deflates | per-word reactions across a crowd; `makeBubble` deflate; `makeHeadphones` drop-on |
| `k13_who.js` | "…knowing exactly who you're serving, what they value, and why…" | BIGGEST AUDIENCE marquee X'd, crowd droops; dart hits a bullseye over the customer; WHO / WHAT / WHY cards slap onto a cork board | target + dart on "exactly"; **cards slapping onto a board** one per question word; payoff jump with sparkles + confetti |
| `k14_matter.js` | "You don't have to be for everyone. You have to matter to someone." | Crowd under a lit EVERYONE sign, red X, crowd poofs away leaving one person; then a warm two-shot, cup handed over, heart pops | crowd removal edge-first; emotional ending: slow push, heart `beat`, steam; warm backdrop |
| `k15_cta.js` | "Comment KEYWORD and I'll send you the checklist…" | Green COMMENT marquee slams down, three people hop in and point, a checklist pops up and ticks itself | **the CTA pattern** (the template's `s04_cta.js` is derived from it); `makeChecklist` ticks on successive words; everyone points on the last cut |

## Patterns that recur in every file
- `init`: `await L.libFonts()`, one `root` group at `spec.o`, build everything, store handles.
- `update`: hide root outside `[t0 - 0.6, t1 + 0.6]`; compute every pose from `t` (springs/rings from cue times, never accumulated state);
  set `ctx.bg / focus / dof / shake / flash` only while inside the beat (+ half the blend).
- `camera`: a shot letter chosen by comparing `t` with cue times, each shot a short `lerp3`/`poseTrack` drift (push, arc, dutch roll).
- Hit = squash (`ring()` / `U.landSquash`) + `ctx.shake` pulse + sparkle or confetti, on the exact word.
