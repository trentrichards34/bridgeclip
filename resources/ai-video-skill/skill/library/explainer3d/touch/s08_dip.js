/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s08_dip.js - Bar-field crater + targeting brackets (35.06-39.10 s)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: "The phone sees a small dip at those exact crossings and says, "That's a touch.""
 * Shows:
 *   Exploded phone, finger on the lifted glass. A read sweep runs the grid; on "small dip" the grid springs up into
 *   a 3D bar field with a red crater under the fingertip; brackets lock onto each dipped crossing + a reticle; on
 *   "says" the layers slam shut, green touch ring, the tapped app zooms open on a canvas screen, check pops.
 * Techniques to steal:
 *   - grid.bars(k) + grid.setDips: data as a 3D bar field, the dip becomes a crater
 *   - targeting brackets locking on one by one (makeBracket from s08_kit), reticle around the cluster
 *   - layers slam shut with a sharp shake; screen drawn to canvas (home -> ripple -> app card zoom)
 *   - camSpline (s08_kit) smooth camera through keyed poses
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
// s08_dip (35.06-39.10) "The phone sees a small dip at those exact crossings and says, 'That's a touch.'"
// Exploded phone, finger on the lifted glass. "sees": a read sweep runs the grid (top-down). "small dip": the grid
// springs up into a 3D bar field with a red crater under the fingertip (camera swings to a low 3/4). "exact crossings":
// targeting brackets lock onto each dipped crossing, a reticle + coordinates. "says": the layers slam shut,
// "That's a touch": green touch ring + ripple, the tapped app opens, a check pops.
import * as L from './lib.js';
import { makeBracket, makeTracker, camSpline, add, V } from './s08_kit.js';

const S = {};
const U0 = 0.613, V0 = 0.56, APP = 14;                 // the orange app icon (row 3, col 2) on the home look
const GRID = { cols: 12, rows: 26, orb: 0.075, barH: 1.2 };
const SCR = { w: 6.62, h: 14.36 };
const TL = { x: (U0 - 0.5) * SCR.w, z: (V0 - 0.5) * SCR.h };   // touch point in grid-local cm
const DIP = { r: 1.0, depth: 0.74 };

function times(ctx, spec) {
  const w = (s, fb) => ctx.wordAt(s, spec.t0) ?? fb;
  return { phone: w('phone', 35.22), sees: w('sees', 35.38), small: w('small', 35.86), dip: w('dip', 36.1), exact: w('exact', 36.66),
    cross: w('crossings', 36.98), says: w('says', 37.62), thats: w("that's", 38.02), touch: w('touch', 38.42) };
}

function camKeys(spec) {
  const o = spec.o, T = S.T;
  const G = add(o, [TL.x, 3.94, TL.z]);              // grid point under the finger (exploded)
  const C = add(o, [TL.x, 0.42, TL.z]);              // same point on the closed glass
  return [
    [spec.t0 - 0.4, { pos: add(G, [-1.5, 34, 11]), target: add(G, [0.5, 0, -3.6]), fov: 32, roll: -14 }],
    [T.sees + 0.2, { pos: add(G, [-3.2, 31, 13]), target: add(G, [0.4, 0, -3.3]), fov: 32, roll: -9 }],
    [T.small + 0.1, { pos: add(G, [-8.5, 24, 16]), target: add(G, [0, 0.4, -2.7]), fov: 31, roll: -3 }],
    [T.dip + 0.35, { pos: add(G, [-15, 11, 15.5]), target: add(G, [0, 0.9, -2.1]), fov: 30, roll: 1 }],
    [T.cross + 0.25, { pos: add(G, [-9.5, 9, 12.5]), target: add(G, [0, 0.9, -1.7]), fov: 27, roll: 3 }],
    [T.says + 0.05, { pos: add(G, [-8.5, 10, 13.5]), target: add(G, [0, 0.8, -1.8]), fov: 27, roll: 2 }],
    [T.says + 0.42, { pos: add(C, [-5, 24, 21]), target: add(C, [-0.3, 0, -4.0]), fov: 32, roll: 0 }],
    [spec.t1 + 0.5, { pos: add(C, [-2.5, 19, 16]), target: add(C, [-0.4, 0, -3.6]), fov: 30, roll: -2 }],
  ];
}

export default {
  async init(ctx, spec) {
    const { THREE, P } = ctx;
    S.T = times(ctx, spec);
    const o = L.toV3(spec.o);
    const root = new THREE.Group(); ctx.scene.add(root); S.root = root;
    const phone = L.makePhone(ctx, { look: 'home', grid: GRID }); phone.group.position.copy(o); root.add(phone.group); S.phone = phone;
    const hand = L.makeHand(ctx); root.add(hand.group); S.hand = hand;
    const floor = L.studioFloor(ctx, { r: 60 }); floor.group.position.copy(o).add(V(0, -0.57, 0)); root.add(floor.group);
    S.q = L.makeCharges(ctx, 70, { size: 0.08 }); root.add(S.q.group);
    S.check = L.makeIcon(ctx, 'check'); root.add(S.check.group);
    S.lab = L.makeLabel(ctx, 'row 15, col 8', { sub: 'charge dropped here', dx: -230, dy: 210, size: 40 });
    // which crossings dip (deterministic from the dip shape)
    const g = phone.grid, cells = [];
    for (let i = 0; i < g.rows; i++) for (let j = 0; j < g.cols; j++) {
      const v = 1 - DIP.depth * Math.exp(-((g.xs[j] - TL.x) ** 2 + (g.zs[i] - TL.z) ** 2) / (DIP.r * DIP.r));
      if (v < 0.72) cells.push({ i, j, v, d: Math.hypot(g.xs[j] - TL.x, g.zs[i] - TL.z) });
    }
    cells.sort((a, b) => a.d - b.d);
    S.cells = cells.slice(0, 8);
    const [ci, cj] = g.nearest(TL.x, TL.z);
    S.lab.set(null, 0, { text: `row ${ci + 1}, col ${cj + 1}` });
    const cellW = Math.min(g.w / (g.cols - 1), g.h / (g.rows - 1));
    S.br = S.cells.map(() => { const b = makeBracket(ctx, { plane: 'xy', half: cellW * 0.5, arm: 0.62, th: 0.06, color: '#ffffff' }); root.add(b.group); return b; });
    let ext = 0; for (const c of S.cells) ext = Math.max(ext, Math.abs(g.xs[c.j] - TL.x), Math.abs(g.zs[c.i] - TL.z));
    S.ret = makeBracket(ctx, { plane: 'xy', half: ext + cellW * 0.8, arm: 0.3, th: 0.08, color: P.ok }); root.add(S.ret.group);
    S.trk = makeTracker(ctx, { r: 1.0, color: P.ok }); root.add(S.trk.group);
    const R = L.rng(81); S.seeds = Array.from({ length: 70 }, () => [R(), R(), R()]);
    S.icCol = ['#ff8a4c', '#e5452f'];
  },

  update(ctx, t, spec) {
    const { U, P, THREE } = ctx, T = S.T, ph = S.phone, g = ph.grid;
    const vis = t > spec.t0 - 0.7 && t < spec.t1 + 0.7;
    S.root.visible = vis;
    if (!vis) { S.lab.hide(); return; }
    const cur = t >= spec.t0 && t < spec.t1;

    // ---- layers: exploded until "says", then slam shut
    const close = U.inv(T.says - 0.02, T.says + 0.34, t);
    const e = 1 - (close < 1 ? U.easeIn(close) : 1);
    const settle = t > T.says + 0.34 ? Math.exp(-(t - T.says - 0.34) * 9) * Math.sin((t - T.says - 0.34) * 40) * 0.06 : 0;
    ph.explode(Math.max(0, e) + settle, { grid: false });

    // ---- the finger: on the glass, lifts off after "That's"
    const lift = U.smoother(U.inv(T.thats + 0.14, T.thats + 0.7, t));
    const tp = ph.screenPoint(U0, V0);
    S.hand.point({ pos: tp.clone().add(V(0.64 * lift * 2.5, lift * 5.5, -0.77 * lift * 2.5)), tilt: 38 + lift * 6, yaw: 140 });

    // ---- grid: bars spring up on "small", crater = the dip
    const barsK = U.spring(U.inv(T.small - 0.14, T.small + 0.9, t), 2.3, 5) * Math.max(0, e);
    const breathe = 1 + 0.04 * Math.sin(t * 9);
    const dip = DIP.depth * (1 - lift) * breathe;
    g.reset();
    g.setDips([{ x: TL.x, z: TL.z, r: DIP.r, depth: dip }]);
    g.bars(barsK);
    const sk = U.inv(T.sees - 0.12, T.sees + 0.5, t);
    g.scan(sk > 0 && sk < 1 ? sk : -1, { axis: 'row', width: 1.6 });
    // a second, quicker read wave ripples out from the crater right as the bars land
    const wv = t - (T.dip - 0.05);
    g.pulse(wv > 0 && wv < 0.9 ? (i, j, x, z) => { const d = Math.hypot(x - TL.x, z - TL.z); return Math.exp(-(((d - wv * 11) / 0.9) ** 2)) * (1 - wv / 0.9); } : null);
    g.alpha(U.clamp(e * 1.6));
    ph.screen.brightness(U.lerp(1, 0.32, U.clamp(e)));

    // ---- charge still trickling up from the crater into the fingertip (continuity with s07)
    const q = S.q; q.hideAll();
    const qa = 1 - U.smooth(U.inv(T.small - 0.3, T.dip + 0.1, t));
    if (qa > 0.01 && e > 0.5) {
      const tip = S.hand.tip().add(V(0, 0.25, 0));
      S.seeds.forEach(([a, b, c], n) => {
        const cell = S.cells[n % S.cells.length], A = g.pos(cell.i, cell.j);
        const k = (t * (0.9 + 0.5 * b) + a) % 1;
        const ctrl = V(A.x + (A.x - tip.x) * 0.4 + (c - 0.5) * 0.6, A.y + (tip.y - A.y) * 0.7, A.z + (A.z - tip.z) * 0.4);
        const p = L.bezier(A, ctrl, tip, k);
        q.setP(n, p.x, p.y, p.z, qa * (0.5 + 0.6 * Math.sin(Math.PI * k)));
      });
    }

    const camP = L.toV3(this.camera(ctx, t, spec).pos);
    // ---- "exact crossings": brackets lock on one by one, then a reticle around the cluster
    const brOut = 1 - U.smooth(U.inv(T.says - 0.1, T.says + 0.15, t));
    S.cells.forEach((c, n) => {
      const k = U.inv(T.exact - 0.04 + n * 0.035, T.exact + 0.2 + n * 0.035, t);
      const p = g.pos(c.i, c.j).add(V(0, 0.22, 0));
      const s = k <= 0 ? 0 : U.lerp(2.6, 1, U.backOut(k, 2.2));
      const hot = Math.exp(-(((t - T.exact - n * 0.035 - 0.2) / 0.08) ** 2));
      S.br[n].set(p, { s, alpha: U.clamp(k * 2) * brOut, color: U.clamp(k) < 1 ? '#ffffff' : L.mixHex('#ffd2c4', '#ffffff', hot), k: 1.6 + 2.5 * hot, face: camP });
    });
    const rk = U.inv(T.cross - 0.06, T.cross + 0.22, t);
    const cen = g.group.localToWorld(V(TL.x, barsK * GRID.barH * 0.75 + 0.15, TL.z));
    S.ret.set(cen, { s: rk <= 0 ? 0 : U.lerp(1.9, 1, U.backOut(rk, 2.5)), alpha: U.clamp(rk * 2) * brOut, rot: (1 - U.easeOut(rk)) * 0.8, k: 2.2 + 2 * Math.exp(-(((t - T.cross - 0.22) / 0.1) ** 2)), face: camP });
    S.lab.set(g.pos(...g.nearest(TL.x, TL.z)), U.clamp(rk * 2) * (1 - U.smooth(U.inv(T.says - 0.15, T.says + 0.1, t))));

    // ---- "That's a touch": green ring + tracker on the glass, screen ripple + the app opens, check pops
    const tk = U.inv(T.thats - 0.03, T.thats + 0.85, t);
    ph.touchAt(U0, V0, tk, 0, { color: P.ok, size: 1.0 });
    ph.touchAt(U0, V0, U.inv(T.thats + 0.12, T.thats + 1.0, t), 1, { color: P.chargeHot, size: 1.7 });
    const tr = U.inv(T.thats - 0.05, T.thats + 0.2, t);
    S.trk.set(ph.screenPoint(U0, V0, V(), 0.03), { s: tr <= 0 ? 0 : U.lerp(1.8, 1, U.backOut(tr, 2)), alpha: U.clamp(tr * 2) * (1 - U.smooth(U.inv(T.touch + 0.25, T.touch + 0.6, t))), spin: t * 2.2 });
    drawScreen(ctx, t);
    const ck = U.inv(T.touch - 0.1, T.touch + 0.35, t);
    const cp = ph.screenPoint(0.14, 0.74, V(), 2.4 + 0.25 * Math.sin(t * 3));
    S.check.group.position.copy(cp); S.check.pop(ck); S.check.group.scale.multiplyScalar(0.62); S.check.glow(1 + 1.5 * Math.exp(-(((t - T.touch - 0.15) / 0.12) ** 2)));
    S.check.group.lookAt(camP); S.check.group.rotateZ(Math.sin(t * 2.4) * 0.08);

    if (cur) {
      ctx.shake = 0.32 * Math.exp(-(((t - (T.small + 0.12)) / 0.09) ** 2)) + 0.35 * Math.exp(-(((t - (T.says + 0.36)) / 0.07) ** 2));
      ctx.flash = 0.07 * Math.exp(-(((t - T.thats) / 0.06) ** 2));
      ctx.bloomK = 0.75 + 0.25 * Math.exp(-(((t - T.dip) / 0.25) ** 2)) + 0.2 * Math.exp(-(((t - T.thats - 0.1) / 0.2) ** 2));
    }
  },

  camera(ctx, t, spec) {
    const p = camSpline(camKeys(spec), t);
    const d = 0.12;
    p.pos = [p.pos[0] + ctx.U.drift(t * 0.9, 1) * d, p.pos[1] + ctx.U.drift(t * 0.9, 2) * d, p.pos[2] + ctx.U.drift(t * 0.9, 3) * d];
    return p;
  },
};

// home screen + (after the tap) a ripple and the app card zooming open from its icon
function drawScreen(ctx, t) {
  const { U } = ctx, T = S.T, ph = S.phone;
  const pressed = t > T.thats - 0.05;
  ph.look('home', pressed ? { open: APP } : {});
  const rip = U.inv(T.thats, T.thats + 0.55, t), app = U.inv(T.thats + 0.22, T.thats + 0.72, t);
  if (rip <= 0 || (rip >= 1 && app <= 0)) return;
  ph.screen.draw((g, W, H) => {
    const x = U0 * W, y = V0 * H;
    if (rip > 0 && rip < 1) {
      for (let n = 0; n < 2; n++) {
        const k = U.clamp(rip * 1.25 - n * 0.25); if (k <= 0) continue;
        g.strokeStyle = `rgba(190,255,215,${0.85 * (1 - k)})`; g.lineWidth = 10 * (1 - k) + 2;
        g.beginPath(); g.arc(x, y, 30 + k * W * 0.55, 0, 7); g.stroke();
      }
    }
    if (app > 0) {
      const k = U.easeInOut(app), s = W * 0.17;
      const x0 = U.lerp(x - s / 2, 0, k), y0 = U.lerp(y - s / 2, 0, k), w = U.lerp(s, W, k), h = U.lerp(s, H, k);
      const gr = g.createLinearGradient(x0, y0, x0, y0 + h); gr.addColorStop(0, S.icCol[0]); gr.addColorStop(1, S.icCol[1]);
      g.fillStyle = gr; g.beginPath(); g.roundRect(x0, y0, w, h, U.lerp(s * 0.24, 70, k)); g.fill();
      const cx = x0 + w / 2, cy = y0 + h / 2, r = U.lerp(s * 0.26, W * 0.16, k);
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = U.lerp(s * 0.09, 26, k); g.lineCap = 'round';
      g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 1.85); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(cx + r * 0.48, cy - r * 0.2, r * 0.2, 0, 7); g.fill();
    }
  });
}
