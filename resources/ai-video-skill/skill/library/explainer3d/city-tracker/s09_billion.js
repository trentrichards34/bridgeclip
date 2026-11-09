/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-tracker/s09_billion.js - A billion device dots (38.6-42.5 s)
 * Look: city + gadgets (same paper city, units m, tracker/suitcase/people props)
 * Original spoken line: "There are over a billion phones out there, and each one can relay the signal."
 * Shows:
 *   A spiral pull-back from a hotel lobby to the whole region: the world dims (veil) and ~100k device dots pop
 *   outward from the bag with the camera retreating with the reveal front; "over a billion" rolls the card to 1B+; a
 *   relay ripple hops dot to dot outward, every dot flashing as the wave passes.
 * Techniques to steal:
 *   - log-scaled pull-back: height and distance interpolate in log space so every scale feels even
 *   - reveal/relay times are functions of each dot's distance (baked into attributes) - see s09_billion_fx
 *   - marker that stays legible at any distance + beacon rings scaled to the shot
 *   - card number roll to "1B+"
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
// s09_billion (38.6-42.5): "There are over a billion phones out there, and each one can relay the signal."
// A spiral pull-back from the hotel lobby. The world dims (veil) and ~100k device dots pop outward from the bag,
// the camera retreating with the reveal front: the street, the city, the highway, then towns out to the edge of the frame.
// "over a billion" rolls the item card to 1B+. "each one can relay the signal": a green relay ripple hops dot to dot
// outward from the bag (arcs with bright heads), every dot flashing as the wave passes it.
// Pure function of t: reveal / relay times are functions of each dot's distance from the bag, baked into attributes.
import { makeSuitcase, makeHotelLobby, pulseRings, initLib } from './lib.js';
import { buildDots, buildArcs, buildVeil, buildMarker, REV, REL, revealTime, relayTime } from './s09_billion_fx.js';

const T = {
  t0: 38.6, t1: 42.5,
  there: 38.67,
  over: 38.99, billion: 39.31, devices: 39.95, outThere: 40.43,
  each: 40.99, relay: 41.55, signal: 42.03,
  showA: 38.0, showB: 43.1,      // own objects visible (blend in 1.1 / out 1.1)
};

let G = null;

// ---- camera: a crane straight up out of the street canyon (looking down at the lobby), then the camera backs away
// and tilts toward the horizon as the dots spread ("out there"). Height and backing distance run on log curves so the
// pull-back feels even at every scale. Phase 1 stays over the street (14 m in front of the lobby) until it clears the roofs.
function camPose(U, t) {
  const tc = U.clamp(t, 38.0, 43.1);
  let y = Math.exp(U.lerp(Math.log(2.6), Math.log(3150), U.smoother(U.inv(38.45, 40.75, tc))));
  let h = Math.exp(U.lerp(Math.log(13), Math.log(2930), U.smoother(U.inv(39.45, 41.05, tc))));
  const drift = 1 + 0.08 * U.smooth(U.inv(41.0, 43.1, tc));       // keeps drifting back after the reveal
  y *= drift; h *= drift * (1 + 0.06 * U.smooth(U.inv(41.2, 43.1, tc)));
  const d = Math.hypot(y, h);
  const el = (Math.atan2(y, h) * 180) / Math.PI;
  const az = U.lerp(7, 78, U.easeInOut(U.inv(39.3, 42.2, tc))) + 4 * U.smooth(U.inv(41.6, 43.1, tc)) + U.drift(t, 9) * 0.6;
  const fov = U.lerp(40, 42, U.smooth(U.inv(38.8, 40.5, tc)));
  return { d, el, az, fov, k: U.smooth(U.inv(38.5, 39.6, tc)) };
}

export default {
  init(ctx) {
    initLib(ctx);
    const { THREE, scene } = ctx;
    const g = new THREE.Group(); g.visible = false; scene.add(g);
    const lobby = makeHotelLobby(ctx); g.add(lobby);
    const bag = makeSuitcase(ctx); lobby.userData.bagSlot.add(bag);
    lobby.updateMatrixWorld(true);
    const bagPos = new THREE.Vector3(); lobby.userData.bagSlot.getWorldPosition(bagPos);
    const dots = buildDots(ctx, bagPos);
    const arcs = buildArcs(ctx, bagPos, dots.nodes);
    const veil = buildVeil(ctx);
    const marker = buildMarker(ctx);
    marker.position.copy(bagPos).add(new THREE.Vector3(0, 0.9, 0));
    const devMark = buildMarker(ctx, { color: ctx.P.phone, size: 30 });
    g.add(dots.points, arcs.mesh, veil, marker, devMark);
    const rings = pulseRings(ctx, { color: ctx.P.phone, maxR: 1, count: 3, period: 1.35, glow: 1.3, fill: 0.25 });
    rings.mesh.renderOrder = 905; rings.mesh.material.depthTest = false;
    g.add(rings.group);

    // label anchors: a device dot near the bag, and a relay node reached right on "relay"
    const pickNode = (dTarget, pref) => {
      let best = null, bs = Infinity;
      for (const n of dots.nodes) { const s = Math.abs(Math.log(n.d / dTarget)) + pref(n); if (s < bs) { bs = s; best = n; } }
      return best.p.clone();
    };
    // view direction at the end is roughly toward -x (west); prefer dots to the left/front of the bag
    const devAnchor = pickNode(230, (n) => (n.p.x < bagPos.x - 60 && n.p.z > bagPos.z - 160 && n.p.z < bagPos.z + 20 ? 0 : 3));
    const relayAnchor = pickNode(480, (n) => (n.p.x < bagPos.x - 250 && Math.abs(n.p.z - bagPos.z) < 300 ? 0 : 3));   // reached ~41.6 s

    devMark.position.copy(devAnchor);
    G = { g, lobby, bag, bagPos, dots, arcs, veil, marker, devMark, rings, devAnchor, relayAnchor, v: new THREE.Vector3() };
  },

  update(ctx, t, spec) {
    const { U, P, hud } = ctx;
    const on = t > T.showA && t < T.showB;
    G.g.visible = on;
    if (!on) return;

    const cp = camPose(U, t);
    // veil: the city dims so the devices read as light; lifts across the s10 blend
    const veilA = U.smooth(U.inv(38.85, 39.75, t)) * (1 - U.smooth(U.inv(41.95, 42.95, t)));
    G.veil.material.uniforms.opacity.value = 0.9 * veilA;
    G.veil.visible = veilA > 0.002;

    // dots + arcs: everything inside the shaders keys off uTime
    const fadeAll = U.smooth(U.inv(38.85, 39.05, t)) * (1 - U.smooth(U.inv(42.2, 42.95, t)));
    const du = G.dots.points.material.uniforms;
    du.uTime.value = t; du.uFade.value = fadeAll;
    G.dots.points.visible = fadeAll > 0.002;
    const au = G.arcs.mesh.material.uniforms;
    au.uTime.value = t; au.uFade.value = U.smooth(U.inv(40.9, 41.0, t)) * (1 - U.smooth(U.inv(42.25, 42.9, t)));
    G.arcs.mesh.visible = t > REL.t0 - 0.05 && t < 42.95;

    // the bag: a bright marker that stays legible at any distance + beacon rings scaled to the shot
    const mA = U.smooth(U.inv(38.75, 39.1, t)) * (1 - U.smooth(U.inv(42.3, 42.95, t)));
    G.marker.material.uniforms.uAlpha.value = mA;
    G.marker.material.uniforms.uTime.value = t;
    G.marker.material.uniforms.uRelay.value = Math.exp(-Math.max(0, t - REL.t0) * 4) * (t > REL.t0 ? 1 : 0);
    G.marker.visible = mA > 0.002;
    G.rings.group.scale.setScalar(Math.max(3, cp.d * 0.055));
    G.rings.update(t, G.bagPos, 0.9 * U.smooth(U.inv(38.3, 38.8, t)) * (1 - U.smooth(U.inv(42.1, 42.8, t))));

    // ---- item card: 2.4 mi rolls to 1B+ devices on "billion" ----
    if (t >= T.billion - 0.06 && t < 42.55) {
      const k = U.inv(T.billion - 0.06, T.billion + 0.5, t);
      const relayOn = t >= T.each - 0.02;
      hud.eta({
        kicker: k > 0.25 ? 'THE NETWORK' : 'SUITCASE', icon: 'tag',
        time: '1B+', prev: '2.4', k, unit: k > 0.35 ? 'devices' : 'mi',
        sub: relayOn ? 'each one relays' : t >= T.devices - 0.04 ? 'phones · tablets · macs' : (k > 0.35 ? '' : 'seen just now'),
        state: 'live', flash: P.live,
        scale: 1 + 0.05 * Math.sin(Math.PI * U.clamp(k * 1.4)) + 0.035 * Math.sin(Math.PI * U.inv(T.each - 0.02, T.each + 0.3, t)),
      });
    }

    // ---- labels (max 2 at once) ----
    const bagTop = [G.bagPos.x, G.bagPos.y + 1.2, G.bagPos.z];
    hud.label('s09bag', bagTop, 'your suitcase', { dark: true, color: P.route, alpha: U.win(t, T.there, T.billion + 0.5, 0.25, 0.3), dx: 60, dy: -110 });
    const devA = U.win(t, T.devices - 0.05, T.each - 0.05, 0.25, 0.3);
    G.devMark.material.uniforms.uAlpha.value = devA; G.devMark.visible = devA > 0.002;
    hud.label('s09dev', G.devAnchor, 'each dot', { color: P.phone, small: 'a phone', alpha: devA, dx: -70, dy: -120 });
    hud.label('s09rel', G.relayAnchor, 'relay', { color: P.live, small: 'phone to phone', alpha: U.win(t, T.relay - 0.06, 42.4, 0.22, 0.3), dx: -60, dy: -130 });
  },

  camera(ctx, t) {
    const U = ctx.U;
    const cp = camPose(U, t);
    const b = G.bagPos;
    // look target slides ahead of the bag (away from the camera) so the bag sits low and the world fills the frame
    const az = (cp.az * Math.PI) / 180;
    const fwd = 0.1 * cp.d * U.smooth(U.inv(39.9, 40.9, U.clamp(t, 38, 43.1)));
    const tgt = [b.x - Math.sin(az) * fwd, b.y + 1.1 * (1 - cp.k), b.z - Math.cos(az) * fwd];
    return U.orbit(tgt, cp.d, cp.az, cp.el, cp.fov);
  },
};
