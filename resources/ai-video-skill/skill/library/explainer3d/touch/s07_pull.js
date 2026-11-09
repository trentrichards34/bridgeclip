/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s07_pull.js - Field lines + charge flowing into the finger (29.46-35.06 s)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: "When your bare fingertip gets close to the glass, it pulls a little of that charge away from the crossings right under it."
 * Shows:
 *   Phone flat, sensor grid glowing through the glass. A bare fingertip descends (gap readout counts down, contact
 *   shadow grows); on "pulls" field lines arc from the crossings under the pad up into the finger and blue charge
 *   streams up; those orbs shrink and redden while the neighbours stay full; push in low on the dimmed orbs + a dip
 *   ring.
 * Techniques to steal:
 *   - makeFieldLines arcs from grid crossings (grid.pos) to the fingertip; makeCharges particles flowing along bezier paths
 *   - grid.setDips gaussian dip: orbs shrink + tint toward P.dip, neighbours stay full (contrast = the explanation)
 *   - proximity cues: contact shadow growing, gap readout counting down (makeLabel)
 *   - crTrack camera keys [target height, dist, az, el, fov] for a continuous push
 *
 * NOTE - written against the ORIGINAL per-reel core of the studio reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   './lib.js'            -> '/engine/kits/studio.js' (same names: makePhone, makeGrid, makeHand, makeFinger,
 *                            makePen, makeCharges, makeFieldLines, makeDrop, makeLabel, makeIcon, studioFloor,
 *                            makeTouchRing, fade, bezier, rng, toV3, mixHex, glassify, capGlare, libEnv, HAND_POSES).
 *   '../core/palette.js'  -> ctx.P (studio palette: charge, chargeHot, body, dip, no, ok, wireCol, ...).
 *   core/util.js          -> ctx.U (same functions: clamp, lerp, inv, smooth, spring, backOut, track, poseTrack, orbit, ...).
 *   Word cues already use ctx.wordAt(word, spec.t0) ?? fallbackSeconds; the packaged spec.cue(word, fallbackFraction)
 *   works too. Builds at spec.o (its own station, units cm). Per-frame grade overrides: ctx.bg, ctx.flash, ctx.shake,
 *   ctx.bloomK, ctx.exposure, ctx.capDy. ctx.fx = DOM overlay layer.
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// s07_pull (29.46-35.06): "When your bare fingertip gets close to the glass, it pulls a little of that charge away
// from the crossings right under it."
// Phone flat, dark screen, the sensor grid glowing through the glass. A bare fingertip (faint amber body glow inside)
// descends; "fingertip": amber halo pops on the pad. "gets close": the gap readout counts down, contact shadow grows.
// "pulls": field lines arc from the crossings under the pad up into the finger, blue charge streams up; those orbs shrink
// and go red-orange while the neighbours stay full. "crossings right under it": push in low on the dimmed orbs + a dip ring.
import * as THREE from 'three';
import { makePhone, makeHand, makeCharges, makeFieldLines, makeLabel, makeTouchRing, studioFloor, bezier, rng } from './lib.js';
import { crTrack, fract, patchXray } from './s06_kit.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S = {};
const TU = 0.56, TV = 0.56;   // touch point on the screen (u, v)

export default {
  async init(ctx, spec) {
    const { P } = ctx, O = V(...spec.o);
    const G = new THREE.Group(); G.name = 's07'; G.position.copy(O); ctx.scene.add(G); S.G = G; S.O = O;
    const phone = makePhone(ctx, { look: 'off', grid: { orb: 0.12 } }); G.add(phone.group); S.phone = phone;
    const floor = studioFloor(ctx, { r: 60 }); floor.group.position.set(0, -0.57, 0); G.add(floor.group);
    S.hand = makeHand(ctx); G.add(S.hand.group); patchXray(S.hand);
    S.p0 = phone.screenPoint(TU, TV);
    S.lc = phone.grid.toLocal(S.p0);
    // crossings under the pad
    const g = phone.grid, [ci, cj] = g.nearest(S.lc.x, S.lc.z); S.cells = [];
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) {
      if (i < 0 || j < 0 || i >= g.rows || j >= g.cols) continue;
      if (Math.hypot(g.xs[j] - S.lc.x, g.zs[i] - S.lc.z) < 1.25) S.cells.push([i, j]);
    }
    S.lines = makeFieldLines(ctx, { max: 24, color: P.chargeHot, radius: 0.03 }); ctx.scene.add(S.lines.group);
    S.NQ = 9; S.q = makeCharges(ctx, S.cells.length * S.NQ, { color: P.chargeHot, size: 0.045, glow: 1.8 }); ctx.scene.add(S.q.group);
    S.halo = makeCharges(ctx, 14, { color: P.body, size: 0.07, glow: 2.4 }); ctx.scene.add(S.halo.group);
    S.tipG = makeCharges(ctx, 2, { color: P.body, size: 0.22, glow: 1.8 }); ctx.scene.add(S.tipG.group);
    const R = rng(707); S.hd = Array.from({ length: 14 }, () => [R() * 6.28, 0.5 + 0.5 * R(), R() * 6.28, R()]);
    S.dipRing = makeTouchRing(ctx, { color: P.dip, rmax: 1.5 }); G.add(S.dipRing.mesh);
    S.glassRing = makeTouchRing(ctx, { color: P.body, rmax: 1.4 }); G.add(S.glassRing.mesh);
    S.lGap = makeLabel(ctx, '', { dx: 130, dy: -30, size: 46 });
    S.lFull = makeLabel(ctx, 'still full', { dx: -150, dy: 120, size: 42 });
    S.lLow = makeLabel(ctx, 'charge pulled away', { dx: -60, dy: 210, size: 44, color: '#ffd2c4' });
    G.visible = false; for (const o of [S.q, S.halo, S.tipG]) o.group.visible = false; S.lines.update({ alpha: 0 });
  },

  gap(ctx, t, spec) {
    const { U } = ctx, w = (x) => ctx.wordAt(x, spec.t0);
    const tTip = w('fingertip') ?? 30.02, tClose = w('close') ?? 30.74, tGlass = w('glass') ?? 31.22;
    // high, drifting down; then on "gets close" it comes in; settles a hair above the glass on "glass"
    const g1 = U.lerp(7.5, 4.6, U.easeOut(U.inv(spec.t0 - 0.6, tTip + 0.3, t)));
    const g2 = U.lerp(g1, 0.12, U.easeInOut(U.inv(tClose - 0.25, tGlass + 0.05, t)));
    const bob = U.inv(tGlass, tGlass + 0.4, t);
    return Math.max(0.06, g2 + 0.1 * Math.sin(bob * Math.PI) * (1 - bob) + 0.03 * Math.sin(t * 2.3) * U.inv(tGlass, tGlass + 0.5, t));
  },

  update(ctx, t, spec) {
    const { U, P } = ctx, w = (x, n = 0) => ctx.wordAt(x, spec.t0, n);
    const on = t > spec.t0 - 0.6 && t < spec.t1 + 0.6;
    S.G.visible = on;
    for (const o of [S.q, S.halo, S.tipG]) o.group.visible = on;
    if (!on) { S.lines.update({ alpha: 0 }); for (const l of [S.lGap, S.lFull, S.lLow]) l.hide(); return; }
    const cur = t >= spec.t0 && t < spec.t1;
    const tTip = w('fingertip') ?? 30.02, tClose = w('close') ?? 30.74, tGlass = w('glass') ?? 31.22, tPull = w('pulls') ?? 32.02;
    const tCharge = w('charge') ?? 32.9, tAway = w('away') ?? 33.22, tCross = w('crossings') ?? 33.78, tUnder = w('under') ?? 34.42;
    const phone = S.phone, grid = phone.grid, hand = S.hand;

    phone.look('off'); phone.explode(0);
    // ---- finger
    const gap = this.gap(ctx, t, spec);
    hand.point({ pos: S.p0.clone().sub(S.O).add(V(0, gap, 0)), tilt: 38 - 6 * U.inv(tClose, tGlass, t), yaw: 150 + 6 * U.inv(spec.t0, spec.t1, t) });
    // faint amber body glow inside the finger (continuity with the x-ray), stronger once it pulls
    const hk = U.smooth(U.inv(tTip - 0.1, tTip + 0.25, t));
    const pk = U.smooth(U.inv(tPull, tPull + 0.4, t));
    hand.xray(0.16 + 0.22 * hk + 0.15 * pk);
    for (const m of [hand.mats.skin, hand.mats.nail]) { m.transparent = false; m.opacity = 1; m.depthWrite = true; }
    const tip = hand.tip(), tipC = tip.clone().add(V(0, 0.55, 0));

    // ---- grid: full charge, neighbours steady, the crossings under the pad drain
    const drain = U.smooth(U.inv(tPull + 0.1, tAway + 0.35, t));
    const prox = U.smooth(U.inv(tClose, tGlass + 0.2, t));     // a hint of the pull as it nears
    grid.reset(); grid.alpha(1);
    grid.setDips([{ x: S.lc.x, z: S.lc.z, r: 0.95, depth: 0.08 * prox + 0.8 * drain }]);
    const pulseUnder = U.win(t, tCross - 0.05, spec.t1 + 0.6, 0.15, 0.3);
    grid.pulse((i, j, x, z) => {
      const d = Math.hypot(x - S.lc.x, z - S.lc.z);
      // neighbours shimmer bright and full; the drained ones flicker weakly
      return d > 1.3 ? 0.18 * pulseUnder * (0.5 + 0.5 * Math.sin(t * 7 + i + j)) : 0;
    });
    phone.contactShadow(TU, TV, 0.9 + 0.5 * U.clamp(gap / 3), 0.55 * U.clamp(1 - gap / 4) * U.inv(spec.t0, tClose, t));

    // ---- amber halo on the pad ("fingertip"), proximity ring on the glass ("glass")
    const H = S.halo; H.hideAll(); const TG = S.tipG; TG.hideAll();
    if (hk > 0) {
      const pop = U.backOut(U.clamp((t - tTip) / 0.3));
      for (let i = 0; i < 14; i++) {
        const [a0, r0, ph, sp] = S.hd[i], a = a0 + t * (1.4 + sp);
        const r = (0.95 + 0.25 * Math.sin(t * 3 + ph)) * r0 * pop;
        H.setP(i, tip.x + Math.cos(a) * r, tip.y + 0.35 + 0.35 * Math.sin(a * 0.7 + ph), tip.z + Math.sin(a) * r, 0.7 + 0.5 * sp);
      }
      H.alpha(hk * (1 - 0.35 * pk));
      TG.setP(0, tip.x, tip.y + 0.32, tip.z, (0.9 + 0.5 * Math.exp(-4 * Math.max(0, t - tTip))) * pop * (1 + 0.5 * pk));
      TG.setColor(new THREE.Color(P.body).lerp(new THREE.Color(P.chargeHot), 0.55 * drain)); TG.alpha(1);
      if (cur && t > tTip && t < tTip + 0.25) ctx.flash = Math.max(ctx.flash, 0.12 * (1 - (t - tTip) / 0.25));
    } else { H.alpha(0); TG.alpha(0); }
    const gr = U.inv(tGlass - 0.05, tGlass + 0.75, t);
    S.glassRing.mesh.position.copy(S.p0).sub(S.O).add(V(0, 0.012, 0));
    S.glassRing.set(gr > 0 && gr < 1 ? gr : 0, { size: 1.2, alpha: 0.9 });
    if (cur && t > tGlass && t < tGlass + 0.2) ctx.shake = Math.max(ctx.shake, 0.18);

    // ---- "pulls": field lines + charge streaming up from the crossings under the pad
    const lk = U.easeOut(U.inv(tPull - 0.05, tPull + 0.38, t));
    if (lk > 0) {
      S.lines.fromCrossings(grid, S.cells, tipC, 0.32).update({ k: lk, phase: t * 1.8, alpha: 1 - 0.3 * U.inv(tCross, spec.t1, t), dash: 4, flow: 1.4, base: 0.45 });
      if (cur && t < tPull + 0.25) { ctx.flash = Math.max(ctx.flash, 0.16 * (1 - (t - tPull) / 0.25)); ctx.shake = Math.max(ctx.shake, 0.22); }
    } else S.lines.update({ alpha: 0 });
    const Q = S.q; Q.hideAll();
    if (t > tPull) {
      const sp = 0.9 + 0.7 * U.smooth(U.inv(tCharge - 0.1, tCharge + 0.3, t));
      const el = (t - tPull);
      let n = 0;
      S.cells.forEach(([i, j], c) => {
        const a = grid.pos(i, j), ctrl = V(a.x + (a.x - tipC.x) * 0.32, U.lerp(a.y, tipC.y, 0.8), a.z + (a.z - tipC.z) * 0.32);
        const strength = 1 - 0.55 * drain * 0;   // stream continues while it drains
        for (let q = 0; q < S.NQ; q++) {
          const born = q / S.NQ / sp;                          // first wave leaves staggered
          if (el < born * 0.9) { n++; continue; }
          const k = fract(q / S.NQ + el * sp * 0.85 + c * 0.13);
          const p = bezier(a, ctrl, tipC, U.easeIn(k) * 0.4 + k * 0.6);
          Q.setP(n++, p.x, p.y, p.z, strength * U.smooth(U.clamp((k - 0.04) / 0.18)) * (0.7 + 0.6 * Math.sin(k * Math.PI)) * (1 - 0.6 * k * k));
        }
      });
      Q.alpha(1);
    } else Q.alpha(0);

    // ---- "crossings right under it": red dip ring on the grid plane + labels
    const dk = U.inv(tUnder - 0.15, tUnder + 0.75, t);
    const gp = grid.toLocal(S.p0); const cw = grid.group.localToWorld(V(S.lc.x, 0.02, S.lc.z));
    S.dipRing.mesh.position.copy(cw).sub(S.O);
    S.dipRing.set(dk > 0 && dk < 1 ? dk : 0, { size: 1.15, alpha: 1 });

    // gap readout while it closes in
    const gw = U.win(t, tClose - 0.3, tGlass + 0.45, 0.15, 0.25);
    const mm = Math.max(1, Math.round(gap * 10));
    S.lGap.set(S.p0.clone().lerp(tip, 0.5).add(V(0.9, 0, 0)), gw, { text: `${mm} mm` });
    const lw = U.win(t, tCross + 0.05, spec.t1 + 0.4, 0.2, 0.2);
    const [c0i, c0j] = grid.nearest(S.lc.x, S.lc.z), [fi, fj] = [c0i + 3, c0j - 1];
    S.lFull.set(grid.pos(Math.max(0, fi), Math.min(grid.cols - 1, fj)), lw * 0.95);
    const low = S.cells.reduce((b, c) => (grid.charge(c[0], c[1]) < grid.charge(b[0], b[1]) ? c : b), S.cells[0]);
    S.lLow.set(grid.pos(low[0], low[1]), U.win(t, tAway + 0.05, spec.t1 + 0.4, 0.2, 0.2));

    if (cur) {
      ctx.bloomK = 0.62 + 0.15 * pk;
      ctx.bg = { top: '#080a10', mid: '#0b0f18', bottom: '#050609' };
    }
  },

  camera(ctx, t, spec) {
    const { U } = ctx, w = (x) => ctx.wordAt(x, spec.t0);
    const tTip = w('fingertip') ?? 30.02, tClose = w('close') ?? 30.74, tGlass = w('glass') ?? 31.22, tPull = w('pulls') ?? 32.02;
    const tCharge = w('charge') ?? 32.9, tCross = w('crossings') ?? 33.78;
    // [target height above the glass (or tip blend), distance, azimuth, elevation, fov]
    const keys = [
      [spec.t0 - 0.5, [3.2, 26, 104, 12, 30]],
      [tTip - 0.05, [4.0, 20, 92, 10, 30]],
      [tTip + 0.3, [3.6, 13, 82, 9, 28]],
      [tClose, [1.7, 12, 74, 7, 28]],
      [tGlass + 0.1, [0.9, 11.5, 64, 6, 28]],
      [tPull - 0.05, [0.9, 12.5, 54, 10, 28]],
      [tPull + 0.45, [0.6, 16, 40, 30, 30]],
      [tCharge + 0.2, [0.5, 16, 28, 36, 30]],
      [tCross - 0.05, [0.45, 15, 34, 36, 30]],
      [tCross + 0.45, [0.2, 9.5, 2, 15, 28]],
      [spec.t1, [0.15, 8.2, -22, 13, 28]],
      [spec.t1 + 1, [0.15, 8.0, -28, 12, 28]],
    ];
    const [h, d, az, el, fov] = crTrack(keys, t);
    const base = S.p0;
    const tg = base.clone().add(V(0, h, 0));
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    const dir = V(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    const pos = tg.clone().addScaledVector(dir, d).add(V(U.drift(t, 7) * 0.08, U.drift(t * 1.1, 9) * 0.05, 0));
    pos.y = Math.max(pos.y, base.y + 0.35);
    const target = tg.clone().add(V(0, d * 0.06, 0));
    return { pos: pos.toArray(), target: target.toArray(), fov, roll: U.lerp(3, -3, U.smooth(U.inv(spec.t0, spec.t1, t))) };
  },
};
