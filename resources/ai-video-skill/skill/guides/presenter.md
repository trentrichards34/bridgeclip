# Your own presenter (classic style)

The classic style has a cartoon presenter bust in the bottom-right corner that points at whatever is being talked about. It's drawn in code, so anyone can have their own: no image generation needed.

## Make it from a photo (first run, once)
1. Ask the user for a clear photo of their face and shoulders (or a description: "short curly dark hair, glasses, beard..."). If they'd rather not appear, offer: a neutral presenter, or `"presenter": false` (no presenter, scenes use the full frame).
2. Look at the photo and fill the presenter look (all fields in `guides/styles/classic.md` → Presenter): skin tone, hair style + colour, facial hair, glasses, headwear, top type + colour, accessories. Pick the closest options; it's a friendly caricature, not a likeness.
3. Render the presenter sheet and compare with the photo:
   `node "$SKILL_DIR/tools/reel.mjs" stills <project> 0 --only presenter` (or the presenter preview page described in the classic guide). Adjust until it reads as "them" at a glance (hair shape and colour, glasses and beard matter most).
4. Save it as their default: write the look into `~/.config/ai-video/config.json` under `"presenter"` (every new classic reel copies it into reel.json). Tell the user it's saved and can be changed anytime ("make my presenter's hair longer").

## Look options (reel.json "presenter")
- **Hair** (`hair`):
  - short straight: `swept` (deep side part, fringe swept across), `crop` (short textured crop, high choppy fringe), `fringe` (blunt bangs to the brows), `curtain` (middle part framing the forehead, ends above the jaw), `messy` (tousled spiky volume)
  - short wavy / curly: `wavy` (tousled medium waves with a stray lock), `curly` (short curls / afro-textured, bumpy round silhouette)
  - very short: `buzz` (close shadow on the skull), `bald`
  - long, past the jaw onto the shoulders: `long` (straight, middle part), `wavylong` (soft waves down both sides), `longcurly` (big voluminous curls all round, spiral texture)
  - tied back: `ponytail` (tail behind one side, accent hair tie), `bun` (top bun)
- **Hair colour** (`hairColor`): `black` `darkbrown` `brown` `chestnut` `auburn` `red` `blonde` `platinum` `grey` `white` or `#hex`.
- **Glasses**: `glasses: true`, `glassesStyle` `round` | `square`, `glassesColor` `#hex`, `glassesW` frame thickness (default 7; 4-5 = thin wire frames, 9-10 = chunky).
- **Lashes**: `lashes: true` adds small lashes on the outer corner of each upper lid (reads more feminine at reel size).
- Also: `skin`, `beard`/`beardColor`, `beanie`, `top`/`topColor`/`innerColor`, `accessories`, `face` (`adult` | `young`), `slim` (full table in `guides/styles/classic.md` → Presenter).
- Page 3 of the presenter sheet shows every hairstyle in the configured colours: pick by looking, not by name.

## Acting rules (what makes it feel alive)
- Pointing is the default state: the hand points at the current hero object and re-aims when the focus moves.
- A gesture or expression change on every phrase: wave on the hook, shock on a big number, thinking pose on a question, thumbs-up/nod on the answer, point at the keyword on the CTA.
- Head and eyes look at the content, not at the camera, except on the hook and CTA.
- One fixed corner spot for the whole reel. Content stays full size; never shrink scenes to make room.

## Privacy
Keep the photo only in the project folder (or don't save it at all). Never upload it anywhere.
