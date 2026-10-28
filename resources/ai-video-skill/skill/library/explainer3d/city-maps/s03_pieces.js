/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s03_pieces.js - Wrapper scene (11.75-14.35 s)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: "First, it breaks your trip into small pieces of road."
 * Shows:
 *   A 10-line scene that only delegates to s03_tiles.js: shows how a beat reuses a shared helper module.
 * Techniques to steal:
 *   - thin scene wrapper over a shared helper (init/update/camera delegate)
 *
 * NOTE - written against the ORIGINAL per-reel core of the city reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   core/world.js + traffic.js -> '/engine/kits/city.js'. buildCity(ctx) returns the same world object, so read
 *                            ctx.city where this file reads ctx.world (e.g. `const { THREE, world, P, U } = ctx`
 *                            -> `const world = ctx.city`). ctx.traffic is unchanged. ctx.ribbonGeometry /
 *                            ctx.ribbonMaterial are exported from city.js and also on ctx.
 *   core/hud.js           -> ctx.hud: hud.eta(...) = alias of hud.card(...), hud.status(...) = alias of hud.chip(...),
 *                            hud.label(...), hud.big(...), hud.layer. Captions are automatic.
 *   palette               -> this file's P is the CITY palette = ctx.C in the packaged engine (route, live, slow, jam,
 *                            forecast, history, phone, ink, paper, ...). ctx.P there is the studio palette.
 *   core/util.js          -> ctx.U (same functions).
 *   TIMING: the seconds in the T / word tables below were locked to the original voiceover. Convert every one to a
 *   word cue (ctx.wordAt('word', spec.t0) or spec.cue('word', fallbackFraction)) when adapting.
 *   City scenes use absolute city coordinates (no spec.o station).
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// s03 · "First, it breaks your trip into small pieces of road." (11.75-14.35)
// The route snaps into the 8 world.segments tiles: gaps crack open on "breaks", the tiles spring up and
// spread on "small pieces", numbers pop on "pieces". Tiles live in s03_tiles.js (s04 recolours and lands them).
import { initTiles, updateTiles, overviewPose, hazeFog } from './s03_tiles.js';

export default {
  init(ctx) { initTiles(ctx); },
  update(ctx, t) {
    updateTiles(ctx, t);
    if (t >= 11.75 && t < 14.35) hazeFog(ctx, t, overviewPose(ctx, t));
  },
  camera(ctx, t) { return overviewPose(ctx, t); },
};
