// EXPLAIN (studio look). Example scene: works with ANY words.json. Replace it for your topic, keep the grammar:
// one hero object, a new visual event every ~1-1.5 s, the camera changes language between steps.
//   step 1 (0-25%)   exploded view: the phone's layers lift apart (x-ray of what is inside)
//   step 2 (25-50%)  the hidden grid draws on, a scan sweeps it; label with a leader line
//   step 3 (50-75%)  a fingertip comes close: field lines + charge particles flow from the crossings into it
//   step 4 (75-100%) bar field: the charge under the finger becomes a crater; brackets of light, check pop
// Every step is cued with spec.cue('word', fraction): swap in the words of YOUR script.
import * as THREE from 'three';
import { makePhone, makeHand, makeCharges, makeFieldLines, makeIcon, studioFloor, bezier, rng } from '/engine/kits/studio.js';

let S = null;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TOUCH = { u: 0.58, v: 0.42 };

function cues(spec) {
  return {
    explode: spec.cue('inside', 0.04),
    grid: spec.cue('grid', 0.25),
    finger: spec.cue('finger', 0.5),
    dip: spec.cue('touch', 0.75),
  };
}

export default {
  init(ctx, spec) {
    const o = new THREE.Vector3(...spec.o);
    const root = ctx.station(spec);
    const phone = makePhone(ctx, { look: 'home' }); phone.group.position.copy(o); root.add(phone.group);
    const floor = studioFloor(ctx, { r: 70 }); floor.group.position.copy(o).add(V(0, -2.5, 0)); root.add(floor.group);
    const hand = makeHand(ctx); root.add(hand.group);
    const lines = makeFieldLines(ctx); ctx.scene.add(lines.group);          // world space
    const parts = makeCharges(ctx, 120); ctx.scene.add(parts.group);        // world space
    const check = makeIcon(ctx, 'check'); root.add(check.group);
    const R = rng(7);
    S = { root, phone, hand, lines, parts, check, jit: Array.from({ length: 120 }, () => R()) };
    const C = cues(spec);
    ctx.sfx(C.explode + 0.1, 'swoosh', 0.6); ctx.sfx(C.grid, 'shimmer', 0.6); ctx.sfx(C.dip, 'ding', 0.7);
  },

  update(ctx, t, spec) {
    const { U, P } = ctx, { root, phone, hand, lines, parts, check, jit } = S;
    const on = spec.on(t);
    root.visible = on; lines.group.visible = on; parts.group.visible = on;
    if (!on) return;
    const C = cues(spec);

    // 1. exploded view (spring out, never just appear)
    const ex = U.spring(U.inv(C.explode, C.explode + 0.9, t), 2.2, 6);
    phone.look('home');

    // 2. grid: draw on, scan, then (step 4) bars
    const g = phone.grid; g.reset();
    phone.explode(ex, { gap: 1, grid: true });
    g.reveal(U.inv(C.grid - 0.1, C.grid + 0.9, t));
    const sc = U.inv(C.grid + 0.6, C.grid + 1.6, t);
    g.scan(sc > 0 && sc < 1 ? sc : -1, { axis: 'row', width: 1.6 });

    // 3. finger + charge flow (positions from the hand every frame)
    const p = phone.screenPoint(TOUCH.u, TOUCH.v);
    const appr = 1 - U.easeOut(U.inv(C.finger - 0.6, C.finger + 0.3, t));
    hand.group.visible = t > C.finger - 0.65;
    hand.point({ pos: p.clone().add(V(8 * appr, 0.35 + 3 * appr, 1.5 * appr)),   // enters from the side, not through the caption band
      tilt: 42, yaw: 95, curl: 0.1 * appr });
    const tip = hand.tip(), lc = g.toLocal(tip);
    const pull = U.smooth(U.inv(C.finger + 0.1, C.finger + 0.8, t));
    g.setDips([{ x: lc.x, z: lc.z, r: 1.1, depth: 0.75 * pull }]);
    g.bars(U.easeInOut(U.inv(C.dip - 0.3, C.dip + 0.4, t)));
    const [ci, cj] = g.nearest(lc.x, lc.z), cells = [];
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) if (i >= 0 && j >= 0 && i < g.zs.length && j < g.xs.length && Math.hypot(g.xs[j] - lc.x, g.zs[i] - lc.z) < 1.5) cells.push([i, j]);
    const flowA = U.win(t, C.finger, spec.t1 + 0.3, 0.3, 0.3) * (1 - U.inv(C.dip, C.dip + 0.4, t));
    const aim = tip.clone().add(V(0, 0.35, 0));
    if (flowA > 0.01) lines.fromCrossings(g, cells, aim, 0.3).update({ k: U.inv(C.finger, C.finger + 0.5, t), phase: t * 1.5, alpha: flowA });
    else lines.update({ k: 0, alpha: 0 });
    parts.hideAll(); parts.alpha(flowA);
    if (flowA > 0.01) cells.forEach(([i, j], c) => {
      const a = g.pos(i, j);
      for (let q = 0; q < 6; q++) {
        const k = (t * 0.9 + q / 6 + jit[(c * 6 + q) % 120]) % 1;
        const ctrl = V(a.x + (a.x - aim.x) * 0.35, a.y + (aim.y - a.y) * 0.8, a.z + (a.z - aim.z) * 0.35);
        const pp = bezier(a, ctrl, aim, k);
        parts.setP(c * 6 + q, pp.x, pp.y, pp.z, 0.6 + 0.5 * Math.sin(k * Math.PI));
      }
    });

    // 4. touch ring + check pop on the dip word
    phone.clearTouches();
    if (t > C.dip) phone.touchAt(TOUCH.u, TOUCH.v, U.inv(C.dip, C.dip + 0.8, t), 0, { color: P.ok, size: 1.6 });
    const ck = U.inv(C.dip + 0.05, C.dip + 0.4, t);
    check.pop(ck); check.glow(1.3);
    check.group.position.copy(phone.screenPoint(TOUCH.u - 0.35, TOUCH.v - 0.1, undefined, 0)).add(V(0, 7.5, 0));
    check.group.scale.multiplyScalar(0.55);
    if (ck > 0) ctx.after.push(() => check.group.lookAt(ctx.camera.position));   // after the camera is placed (deterministic)

    // labels (core HUD, immediate mode: call every frame you want them; they project after the camera moves)
    const la = U.win(t, C.explode + 0.5, C.grid + 0.2, 0.25, 0.25);
    if (la > 0) ctx.hud.label('ex-glass', phone.screenPoint(0.12, 0.1), 'cover glass', { dx: -120, dy: -120, alpha: la });
    const lb = U.win(t, C.grid + 0.4, C.finger - 0.1, 0.25, 0.25);
    if (lb > 0) ctx.hud.label('ex-grid', g.pos(g.zs.length - 2, 0), 'sensor grid', { sub: 'rows x columns', dx: -110, dy: 150, alpha: lb });

    if (t >= spec.t0 && t < spec.t1) {
      const d = t - C.dip;
      ctx.flash = d > 0 ? 0.08 * Math.exp(-d * 20) : 0;
      ctx.bloomK = 0.7 + 0.2 * U.win(t, C.grid, C.grid + 1.6, 0.3, 0.6);
    }
  },

  camera(ctx, t, spec) {
    const U = ctx.U, o = spec.o, C = cues(spec);
    const tc = U.clamp(t, spec.t0 - 0.5, spec.t1 + 0.6);
    const at = (x, y, z) => [o[0] + x, o[1] + y, o[2] + z];
    // a pose per step, keyed to the step's word: 3/4 high -> low along the layers -> close on the finger -> top-down swing
    const keys = [
      [spec.t0, U.pose(at(17, 18, 30), at(0, 2.6, 0.5), 32)],
      [C.explode + 0.9, U.pose(at(20, 13, 25), at(0, 3.4, 0), 32)],
      [C.grid + 0.4, U.pose(at(-14, 10, 20), at(0.5, 4.6, 0), 34)],
      [C.finger + 0.2, U.pose(at(10, 13, 17), at(1, 6.6, -1), 32)],
      [C.dip + 0.3, U.pose(at(12, 19, 20), at(0.8, 6.2, -0.8), 32)],
      [spec.t1 + 0.6, U.pose(at(7, 24, 18), at(0.8, 6.0, -0.8), 34)],
    ].sort((a, b) => a[0] - b[0]);
    const p = U.poseTrack(keys, tc);
    p.pos = [p.pos[0] + 0.15 * U.drift(tc * 1.1, 4), p.pos[1] + 0.15 * U.drift(tc * 1.1, 5), p.pos[2]];
    return p;
  },
};
