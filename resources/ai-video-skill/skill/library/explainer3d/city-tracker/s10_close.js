/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-tracker/s10_close.js - Wrapper scene (42.5-45.5 s)
 * Look: city + gadgets (same paper city, units m, tracker/suitcase/people props)
 * Original spoken line: "When you get close, the tracker uses something more precise."
 * Shows:
 *   Drives the first half of the continuous sequence in s10_close_shared.js (t < SPLIT).
 * Techniques to steal:
 *   - two beats sharing ONE continuous shot sequence (SPLIT time); the ?only= check is the original render harness, drop it
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
// s10_close (42.5-45.5): "When you get close, the tracker uses something more precise."
// Shares one continuous sequence with s11_uwb (see s10_close_shared.js). This file drives t < 45.5.
import { initShared, updateShared, cameraShared, SPLIT } from './s10_close_shared.js';

const ONLY = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('only') : null;

export default {
  init(ctx) { initShared(ctx); },
  update(ctx, t) { if (ONLY === 's10_close' || (ONLY !== 's11_uwb' && t < SPLIT)) updateShared(ctx, t); },
  camera(ctx, t) { return cameraShared(ctx, t); },
};
