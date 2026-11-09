/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-tracker/s11_uwb.js - Wrapper scene (45.5-52.8 s)
 * Look: city + gadgets (same paper city, units m, tracker/suitcase/people props)
 * Original spoken line: "Ultra Wideband measures how long the signal takes to travel, so your phone gets not just "nearby" but "four meters, to your left," and shows the arrow."
 * Shows:
 *   Drives the second half of s10_close_shared.js (t >= SPLIT).
 * Techniques to steal:
 *   - see s10_close.js
 *
 * NOTE - written against the ORIGINAL per-reel core of the city + gadgets reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   './lib.js'            -> '/engine/kits/gadgets.js'. Identifiers in this file ALREADY use the packaged names:
 *                            makeTracker (tracker tag) and makeHandset (handheld phone). Everything else keeps its name
 *                            (makeSuitcase, makePerson, walk, drawMapScreen, drawArrowScreen, pulseRings, makePacket,
 *                            flyArc, bezier, makeCloud, makeContactShadow, linePath, placeOnPath, look, fade, LOC,
 *                            initLib, makeAirportProps, makeShuttle, makeHotelLobby, makeStreetProps, makeEmptyRoom).
 *   core/world.js + traffic.js -> '/engine/kits/city.js'; read ctx.city where this file reads ctx.world.
 *                            ctx.ribbonGeometry / ctx.ribbonMaterial: exported from city.js and also on ctx.
 *   core/hud.js           -> ctx.hud: hud.eta = alias of hud.card, hud.status = alias of hud.chip, hud.label, hud.big,
 *                            hud.layer. Captions are automatic.
 *   palette               -> this file's P is the CITY palette = ctx.C in the packaged engine. core/util.js -> ctx.U.
 *   TIMING: the seconds in the T / W word tables were locked to the original voiceover. Convert every one to a word
 *   cue (ctx.wordAt('word', spec.t0) or spec.cue('word', fallbackFraction)) when adapting.
 *   Absolute city coordinates (LOC.* spots), no spec.o station.
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// s11_uwb (45.5-52.8): "Ultra Wideband measures how long the signal takes to travel, so your phone gets not just
// "nearby" but "four meters, to your left," and shows the arrow."
// Continues s10_close's sequence (see s10_close_shared.js). This file drives t >= 45.5.
import { initShared, updateShared, cameraShared, SPLIT } from './s10_close_shared.js';

const ONLY = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('only') : null;

export default {
  init(ctx) { initShared(ctx); },
  update(ctx, t) { if (ONLY === 's11_uwb' || (ONLY !== 's10_close' && t >= SPLIT)) updateShared(ctx, t); },
  camera(ctx, t) { return cameraShared(ctx, t); },
};
