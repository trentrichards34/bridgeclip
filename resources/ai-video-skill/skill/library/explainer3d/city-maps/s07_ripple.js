/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s07_ripple.js - Slowdown spreads backwards like a ripple (32.25-40.3 s)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: "And here's the clever part. Traffic doesn't stay in one place. When an exit backs up, the slowdown creeps backwards, into the roads feeding it, like a ripple."
 * Shows:
 *   The exit ramp jams with simulated cars; a red front with an amber crest crawls BACKWARDS up the highway,
 *   branches down the feeder ramp, red rings ripple across the ground; the camera retreats with the front; status
 *   chip text follows the speed.
 * Techniques to steal:
 *   - green / red / crest ribbons per road, revealed by span() windows following the wave-front functions
 *   - pings where the jam starts and where it reaches the feeder, then big ground ripple rings (depth-tested + x-ray copies)
 *   - camera keys [t, tx, ty, tz, dist, az, el, fov] retreating with the front
 *   - hud.status text switching LIVE / SLOWING / JAM by measured speed
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
// s07_ripple (32.25-40.3): "And here's the clever part. Traffic doesn't stay in one place. When an exit backs up,
// the slowdown creeps backwards, into the roads feeding it, like a ripple."
// The exit ramp jams with real (simulated) cars, a red front with an amber crest crawls BACKWARDS up the highway,
// branches down the feeder on-ramp, and red rings ripple out across the ground. The camera retreats with the front.
import { shared, T7, rampTail, hwyFront, feedFront, ribbon, span, ringMesh, ringAt, spline } from './s07_ripple_jam.js';

let G = null;

export default {
  init(ctx) {
    const { THREE, world, P, U } = ctx;
    const S = shared(ctx);
    const W = world.paths;
    const g = new THREE.Group(); g.visible = false; ctx.scene.add(g);
    const H0 = S.sFeed - 170, H1 = S.sExit + 2;          // highway strip we paint
    const HW = 12.6, HO = 6.6;                          // our three lanes (towards downtown)
    G = {
      g, H0, H1,
      hGreen: ribbon(ctx, g, W.highway, H0, H1, HW, P.live, { off: HO, opacity: 0.5, glow: 0.1 }),
      hRed: ribbon(ctx, g, W.highway, H0, H1, HW, P.jam, { off: HO, opacity: 0.78, glow: 0.35, order: 3 }),
      hCrest: ribbon(ctx, g, W.highway, H0, H1, HW + 1.2, P.slow, { off: HO, opacity: 1, glow: 1.4, order: 4, dy: 0.16 }),
      rGreen: ribbon(ctx, g, W.exitRamp, 0, S.rampLen, 8.4, P.live, { opacity: 0.5, glow: 0.1 }),
      rRed: ribbon(ctx, g, W.exitRamp, 0, S.rampLen, 8.4, P.jam, { opacity: 0.85, glow: 0.4, order: 3 }),
      rCrest: ribbon(ctx, g, W.exitRamp, 0, S.rampLen, 9.4, P.slow, { opacity: 1, glow: 1.4, order: 4, dy: 0.16 }),
      fGreen: ribbon(ctx, g, W.feeder, 0, S.feedLen, 8.4, P.live, { opacity: 0.5, glow: 0.1 }),
      fRed: ribbon(ctx, g, W.feeder, 0, S.feedLen, 8.4, P.jam, { opacity: 0.85, glow: 0.4, order: 3 }),
      fCrest: ribbon(ctx, g, W.feeder, 0, S.feedLen, 9.4, P.slow, { opacity: 1, glow: 1.4, order: 4, dy: 0.16 }),
      // pings where the jam starts / where it reaches the feeder, then the big ground ripple
      pingExit: [ringMesh(ctx, g, P.jam, { y: 0 }), ringMesh(ctx, g, P.jam, { y: 0 })],
      pingFeed: [ringMesh(ctx, g, P.jam, { y: 0 }), ringMesh(ctx, g, P.jam, { y: 0 })],
      ripples: [0, 1, 2, 3, 4].map(() => ringMesh(ctx, g, P.jam, { y: 1.0, inner: 0.955 })),
      ripplesX: [0, 1, 2, 3, 4].map(() => ringMesh(ctx, g, P.jam, { y: 1.0, inner: 0.955, depthTest: false, order: 1 })),
    };
    const ex = W.exitRamp.at(10), fm = W.highway.side(S.sFeed, 8, 0);
    G.pingExit.forEach((m) => { m.position.set(ex.x, ex.y + 0.5, ex.z); });
    G.pingFeed.forEach((m) => { m.position.set(fm.x, fm.y + 0.5, fm.z); });
    const ground = world.landmarks.exit;
    [...G.ripples, ...G.ripplesX].forEach((m) => { m.position.x = ground.x + 10; m.position.z = ground.z + 25; });

    // camera keys: [t, tx,ty,tz, dist, az, el, fov]
    const H = (s, off = 6, dy = 0) => W.highway.side(s, off, dy);
    const k = (t, p, d, az, el, fov = 35) => [t, [p.x, p.y, p.z, d, az, el, fov]];
    G.cam = [
      k(31.6, H(S.sExit + 8), 300, -62, 42),
      k(33.6, H(S.sExit + 2), 272, -55, 40),
      k(35.9, H(S.sExit - 10), 242, -48, 38),
      k(36.6, H(S.sExit - 28), 240, -44, 37),
      k(38.2, H(S.sFeed + 15, 10), 262, -32, 40),
      k(39.3, new THREE.Vector3(345, 3, -150), 380, -20, 56),
      k(40.9, new THREE.Vector3(352, 0, -195), 560, -14, 74),
    ];
  },

  update(ctx, t, spec) {
    const { U, P, world, hud } = ctx;
    const S = shared(ctx);
    S.updateCars(t);
    const a = U.win(t, spec.t0 - 0.5, spec.t1 + 0.6, 0.6, 0.6);
    G.g.visible = a > 0;
    if (!G.g.visible) return;
    const W = world.paths;

    // --- colour on the roads ---
    const live = a * U.smooth(U.inv(T7.traffic - 0.2, T7.traffic + 0.5, t));      // green arrives on "Traffic"
    // exit ramp
    const tail = rampTail(U, S.rampLen, t);
    span(G.rGreen, 0, Math.min(S.rampLen, tail), live);
    span(G.rRed, tail, S.rampLen, a);
    span(G.rCrest, tail - 7, tail, a * U.smooth(U.inv(35.5, 35.7, t)) * (1 - U.smooth(U.inv(36.4, 36.7, t))));
    // highway
    const hf = t < 36.4 ? S.sExit + 3 : hwyFront(U, S.sExit, S.sFeed, t);
    span(G.hGreen, G.H0, Math.min(G.H1, hf), live);
    span(G.hRed, hf, G.H1, a);
    span(G.hCrest, hf - 9, hf, a * U.smooth(U.inv(36.35, 36.6, t)));
    // feeder
    const ff = t < 38.15 ? S.feedLen + 2 : feedFront(U, S.feedLen, t);
    span(G.fGreen, 0, Math.min(S.feedLen, ff), live);
    span(G.fRed, ff, S.feedLen, a);
    span(G.fCrest, ff - 8, ff, a * U.smooth(U.inv(38.15, 38.35, t)));

    // --- rings ---
    ringAt(ctx, G.pingExit[0], t, T7.backs - 0.1, 1.3, 3, 46, 0.9 * a);
    ringAt(ctx, G.pingExit[1], t, T7.backs + 0.25, 1.3, 3, 40, 0.6 * a);
    ringAt(ctx, G.pingFeed[0], t, T7.feeding - 0.08, 1.3, 3, 46, 0.9 * a);
    ringAt(ctx, G.pingFeed[1], t, T7.feeding + 0.25, 1.3, 3, 40, 0.6 * a);
    G.ripples.forEach((m, i) => ringAt(ctx, m, t, T7.ripple - 0.12 + i * 0.26, 2.6, 12, 230, 0.95 * a));
    G.ripplesX.forEach((m, i) => ringAt(ctx, m, t, T7.ripple - 0.12 + i * 0.26, 2.6, 12, 230, 0.32 * a));

    // --- labels (max 2 at once) ---
    const exitA = a * U.win(t, T7.backs - 0.05, T7.feeding + 0.1, 0.3, 0.35);
    hud.label('s07exit', W.exitRamp.at(40).add(new ctx.THREE.Vector3(0, 2, 0)), 'exit backed up', { color: P.jam, alpha: exitA, dx: 70, dy: -80 });
    const waveA = a * U.win(t, T7.creeps - 0.1, T7.ripple, 0.3, 0.35);
    hud.label('s07wave', W.highway.side(hf, 6, 1.5), 'slowdown', { color: P.slow, alpha: waveA, dx: -60, dy: -110, small: 'moving back' });
    const feedA = a * U.win(t, T7.feeding + 0.25, spec.t1 + 0.4, 0.3, 0.4);
    hud.label('s07feed', W.feeder.at(Math.max(40, ff - 4)).add(new ctx.THREE.Vector3(0, 1.5, 0)), 'feeder ramp', { color: P.jam, alpha: feedA, dx: 60, dy: 90, small: 'next' });

    // --- live speed chip from the real cars just upstream of the exit ---
    const mph = Math.round(S.mph(S.sFeed, S.sExit, t));
    const col = mph > 40 ? P.live : mph > 18 ? P.slow : P.jam;
    hud.status({ label: (mph > 40 ? 'LIVE · ' : mph > 18 ? 'SLOWING · ' : 'JAM · ') + mph + ' MPH', color: col, alpha: a * U.inv(T7.traffic - 0.3, T7.traffic + 0.2, t) });
  },

  camera(ctx, t) {
    const U = ctx.U;
    const v = spline(G.cam, U.clamp(t, 31.6, 40.9));
    const dr = U.drift(t, 7) * 1.5;
    return U.orbit([v[0], v[1], v[2]], v[3], v[4] + dr, v[5] + dr * 0.3, v[6]);
  },
};
