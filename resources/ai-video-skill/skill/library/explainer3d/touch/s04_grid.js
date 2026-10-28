/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s04_grid.js - Exploded view + hidden grid reveal (13.46-19.30 s)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: "Under the glass of your phone, there's a grid of wires you can't see, rows going one way and columns going the other."
 * Shows:
 *   Camera dives at the phone, the cover glass lifts like a lid and flies away, the sensor layer springs up and its
 *   wires draw on, ghosts out on "can't see", then rows flare + stream, then columns flare + stream as the camera
 *   cranes overhead with a 90 degree roll unwinding.
 * Techniques to steal:
 *   - exploded layers: lid lift with backOut, then easeIn fly-away + fade(); inner layer rises on U.spring
 *   - grid.reveal / grid.scan / grid.alpha driven by word times; per-axis wire brightness via instanced material colour
 *   - streak particles racing along rows then columns (grid-local points -> localToWorld)
 *   - three-shot camera in one beat: poseTrack dive, expoOut snap low along the rows, crane overhead with roll 90 -> 0
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
// s04_grid (13.46-19.30) "Under the glass of your phone, there's a grid of wires you can't see,
// rows going one way and columns going the other."
// Dive at the phone, the cover glass lifts off like a lid, the sensor layer rises out of the phone and its wires draw on,
// goes ghost-invisible on "can't see", then rows flare + stream (camera low along them), then columns flare + stream
// while the camera swings overhead with a 90 degree roll to show the weave.
import { makePhone, studioFloor, makeCharges, fade } from './lib.js';

let S = null;

export default {
  async init(ctx, spec) {
    const { THREE, P } = ctx;
    const o = spec.o;
    const G = new THREE.Group(); G.position.set(o[0], o[1], o[2]); ctx.scene.add(G);
    const phone = makePhone(ctx, { look: 'home' }); G.add(phone.group);
    const floor = studioFloor(ctx, { r: 70 }); floor.group.position.set(0, -0.57, 0); G.add(floor.group);
    // light streaks travelling along the wires (world space)
    const flow = makeCharges(ctx, 140, { color: P.chargeHot, size: 0.045, glow: 2.6 }); ctx.scene.add(flow.group);
    const R = ctx.U.rng(404);
    const seeds = Array.from({ length: 140 }, () => [R(), R(), R()]);
    // tame reflections: the dielectric sheet (glassify raises alpha with reflected light -> milky) and the frame glint
    const sh = phone.grid.parts.sheet; if (sh) { sh.material.envMapIntensity = 0.08; sh.material.clearcoat = 0; sh.material.color.set('#0a1430'); sh.material.roughness = 0.6; }
    phone.mats.metal.envMapIntensity = 0.75;
    S = { G, phone, floor, flow, seeds, tmp: new THREE.Vector3() };
  },

  update(ctx, t, spec) {
    const { U, P } = ctx;
    const { G, phone, flow, seeds, tmp } = S;
    const on = t > spec.t0 - 0.7 && t < spec.t1 + 0.7;
    G.visible = on; flow.group.visible = on;
    if (!on) { flow.hideAll(); return; }
    const W = (w, n = 0) => ctx.wordAt(w, spec.t0 - 0.1, n) ?? spec.t0;
    const tGlass = W('glass'), tGrid = W('grid'), tWires = W('wires'), tCant = W("can't"), tRows = W('rows'),
      tCols = W('columns'), tOther = W('other');
    const grid = phone.grid;

    // ---- screen: lit home screen, dims once the layers come apart
    phone.look('home');
    const dimK = U.smooth(U.inv(tGlass + 0.2, tGrid, t));
    const ghostS = U.smooth(U.inv(tCant - 0.05, tCant + 0.25, t)) * (1 - U.smooth(U.inv(tRows - 0.22, tRows + 0.02, t)));
    phone.screen.brightness(U.lerp(0.95, 0.07, dimK) + 0.45 * ghostS);

    // ---- cover glass lifts like a lid on "glass", tilts away and dissolves
    const lift = U.backOut(U.inv(tGlass - 0.05, tGlass + 0.55, t), 1.4);
    const gl = phone.layers.glass;
    const away = U.easeIn(U.inv(tGlass + 0.45, tGrid + 0.2, t));
    gl.position.set(14 * away, 4.2 * lift + 6 * away, -1.5 * away);
    gl.rotation.set(-0.18 * lift, 0, -0.12 * lift - 0.9 * away);
    fade(gl, 1 - U.smooth(U.inv(tGrid - 0.1, tGrid + 0.25, t)));

    // ---- sensor layer rises out of the phone, display drops a touch
    const rise = U.spring(U.inv(W('phone') - 0.1, W('phone') + 0.9, t), 2.2, 5);
    phone.layers.sensor.position.y = 2.3 * rise;
    phone.layers.display.position.y = -0.05 * rise;

    // ---- the grid: draws on with "grid of wires"
    grid.reset();
    const rev = U.inv(tGrid - 0.05, tWires + 0.45, t);
    grid.reveal(U.easeInOut(rev) * 0.84);                 // rows then columns, stop before the orbs
    grid.orbs(0);                                         // crossings belong to the next beat
    // "you can't see": the grid ghosts out (it is transparent in real life), then rows burst back
    const ghost = U.smooth(U.inv(tCant - 0.05, tCant + 0.25, t)) * (1 - U.smooth(U.inv(tRows - 0.22, tRows + 0.02, t)));
    grid.alpha(t < tGrid - 0.05 ? 0 : (1 - 0.86 * ghost) * U.smooth(U.inv(tGrid - 0.05, tGrid + 0.15, t)));

    // rows light up sweeping across on "rows"; columns crosswise on "columns"
    const rowsK = U.inv(tRows - 0.04, tRows + 0.7, t), colsK = U.inv(tCols - 0.04, tCols + 0.6, t);
    if (t >= tRows - 0.04 && t < tRows + 0.8) grid.scan(rowsK, { axis: 'row', width: 2.2 });
    else if (t >= tCols - 0.04 && t < tCols + 0.7) grid.scan(colsK, { axis: 'col', width: 1.6 });
    const rowsOn = U.smooth(U.inv(tRows - 0.04, tRows + 0.25, t));
    const colsOn = U.smooth(U.inv(tCols - 0.04, tCols + 0.2, t));
    const both = U.smooth(U.inv(tOther, tOther + 0.35, t));
    // per-axis brightness through the (multiplying) material colour of each instanced wire mesh
    let rB = 1, cB = 1;
    if (t >= tRows - 0.04) { rB = U.lerp(1, 1.9, rowsOn); cB = U.lerp(1, 0.2, rowsOn); }
    if (t >= tCols - 0.04) { rB = U.lerp(1.9, 0.75, colsOn); cB = U.lerp(0.2, 1.9, colsOn); }
    if (t >= tOther) { rB = U.lerp(rB, 1.4, both); cB = U.lerp(cB, 1.5, both); }
    rB *= 1 + 0.6 * Math.exp(-Math.pow((t - tRows - 0.05) / 0.12, 2));
    cB *= 1 + 0.6 * Math.exp(-Math.pow((t - tCols - 0.05) / 0.12, 2));
    grid.parts.rows.material.color.setScalar(rB);
    grid.parts.cols.material.color.setScalar(cB);

    // ---- streaks: charge racing along every row (+X), then along every column (+Z, toward the viewer)
    flow.hideAll();
    const A = grid.group.visible ? 1 : 0;
    let n = 0;
    const rowFlow = U.smooth(U.inv(tRows, tRows + 0.2, t)) * (1 - 0.7 * colsOn) * A;
    const colFlow = U.smooth(U.inv(tCols, tCols + 0.2, t)) * A;
    const ext = 0.35, w = grid.w, h = grid.h;
    if (rowFlow > 0.01) for (let i = 0; i < grid.rows; i++) for (let q = 0; q < 3; q++) {
      const sd = seeds[n]; const sp = 0.9 + 0.5 * sd[1];
      const k = ((t - tRows) * sp + sd[0] + q / 3) % 1;
      tmp.set(-w / 2 - ext + (w + 2 * ext) * k, 0.03, grid.zs[i]);
      grid.group.localToWorld(tmp);
      flow.setP(n++, tmp.x, tmp.y, tmp.z, rowFlow * (0.6 + 0.6 * Math.sin(Math.PI * k)));
    }
    n = 60;
    if (colFlow > 0.01) for (let j = 0; j < grid.cols; j++) for (let q = 0; q < 6; q++) {
      const sd = seeds[n]; const sp = 0.55 + 0.3 * sd[1];
      const k = ((t - tCols) * sp + sd[0] + q / 6) % 1;
      tmp.set(grid.xs[j], -0.03, -h / 2 - ext + (h + 2 * ext) * k);
      grid.group.localToWorld(tmp);
      flow.setP(n++, tmp.x, tmp.y, tmp.z, colFlow * (0.6 + 0.6 * Math.sin(Math.PI * k)));
    }
    flow.setColor(t >= tCols ? P.wireCol : P.chargeHot, 2.4);

    // ---- grade
    if (t >= spec.t0 && t < spec.t1) {
      ctx.bg = { top: '#080b12', mid: '#0c1220', bottom: '#05060a' };
      ctx.bloomK = 0.7 + 0.15 * Math.max(rowsOn * (1 - colsOn), colsOn);
      ctx.flash = 0.10 * Math.exp(-Math.pow((t - tGrid - 0.05) / 0.07, 2));
      ctx.shake = 0.25 * Math.exp(-Math.pow((t - tGlass - 0.35) / 0.12, 2)) + 0.18 * Math.exp(-Math.pow((t - tRows) / 0.1, 2)) + 0.18 * Math.exp(-Math.pow((t - tCols) / 0.1, 2));
    }
  },

  camera(ctx, t, spec) {
    const { U } = ctx;
    const o = spec.o;
    const W = (w) => ctx.wordAt(w, spec.t0 - 0.1) ?? spec.t0;
    const tGlass = W('glass'), tGrid = W('grid'), tCant = W("can't"), tRows = W('rows'), tCols = W('columns'), tOther = W('other');
    const L = (p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    const K = (pos, target, fov = 32, roll = 0) => ({ pos: L(pos), target: L(target), fov, roll });
    // shot 1: dive at the glass, then rise with the layers into a 3/4 hero, slow orbit through the reveal
    const keys = [
      [spec.t0 - 0.5, K([12, 40, 33], [0, 0, -2.5], 32, -4)],
      [spec.t0 + 0.05, K([10, 36, 29], [0, 0, -2.5], 32, -3)],
      [tGlass + 0.35, K([5, 26, 21], [0, 1.0, -2.2], 32, 0)],          // dive
      [tGrid, K([-8, 25, 23], [0, 2.4, -2.4], 32, 2)],                // swing round as the glass flies
      [tCant + 0.15, K([-15, 21, 20], [0, 2.4, -2.4], 32, 3)],
      [tRows - 0.08, K([-17, 17, 17], [0, 2.4, -2.2], 32, 4)],
    ];
    let p;
    if (t < tRows - 0.08) p = U.poseTrack(keys, t);
    else if (t < tCols - 0.06) {
      // shot 2: snap low along the rows (camera at +X, rows recede toward the lens), slide along Z
      const k = U.inv(tRows - 0.08, tCols - 0.06, t);
      const snap = U.expoOut(U.inv(tRows - 0.08, tRows + 0.35, t));
      const a = K([-17, 17, 17], [0, 2.4, -2.2], 32, 4);
      const b = K(U.arr(U.v3([11.5, 6.2, 4.5]).lerp(U.v3([10.5, 5.6, -3.5]), U.smooth(k))), [-3, 2.4, U.lerp(0.5, -3.0, U.smooth(k))], 34, -5);
      p = { pos: U.arr(U.v3(a.pos).lerp(U.v3(b.pos), snap)), target: U.arr(U.v3(a.target).lerp(U.v3(b.target), snap)), fov: 34, roll: U.lerp(4, -5, snap) };
    } else {
      // shot 3: crane overhead with a 90 degree roll unwinding, so the weave rotates into place
      const k = U.expoOut(U.inv(tCols - 0.06, tCols + 0.75, t));
      const a = { pos: L([10.5, 5.6, -3.5]), target: L([-3, 2.4, -3.0]), fov: 34, roll: -5 };
      const drift = U.inv(tCols, spec.t1 + 0.6, t);
      const b = { pos: L([1.2 - 2.4 * drift, 34 - 3 * drift, 2.6]), target: L([0, 2.3, -2.6]), fov: 32, roll: U.lerp(90, 0, U.smoother(U.inv(tCols, tOther + 0.2, t))) - 6 * drift };
      p = { pos: U.arr(U.v3(a.pos).lerp(U.v3(b.pos), k)), target: U.arr(U.v3(a.target).lerp(U.v3(b.target), k)), fov: U.lerp(34, b.fov, k), roll: U.lerp(a.roll, b.roll, k) };
    }
    return p;
  },
};
