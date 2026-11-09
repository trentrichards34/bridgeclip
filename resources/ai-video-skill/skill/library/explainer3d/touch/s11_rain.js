/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s11_rain.js - Rain = phantom touches (51.87-57.50 s)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: "Also, while your screen goes crazy in the rain, water conducts too, so every drop looks like a finger."
 * Shows:
 *   Rain streaks and drops hammer a phone; every landing fires a phantom touch (rings, apps jump, glitch flashes).
 *   Then the glass lifts: each drop pulls charge out of the grid (field lines, dips), the bar field shows craters,
 *   ghost fingers appear inside the drops, "touch" pills pop on them.
 * Techniques to steal:
 *   - a hand-written event schedule ([u, v, tHit, radius]) driving many identical events deterministically
 *   - instanced additive rain streaks (InstancedMesh thin cylinders)
 *   - one dip per drop in grid.setDips + field lines per drop; ghost fingers = "looks like a finger"
 *   - rhythmic glitch flash ((t - t0) % 0.13 < 0.035); DOM pills positioned in ctx.after (runs after the camera is final; check the packaged core exposes ctx.after, else do it in update)
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
// s11_rain (51.87-57.50) "Also, while your screen goes crazy in the rain, water conducts too, so every drop looks like a finger."
// Rain streaks + drops hammer a phone; every landing is a phantom touch (rings, apps jump, glitch). Then the glass lifts:
// each drop pulls charge out of the grid (field lines, dips), the bar field shows craters, and ghost fingers appear in the drops.
import { makePhone, makeDrop, makeTouchRing, makeFieldLines, makeCharges, makeFinger, studioFloor, bezier, rng } from './lib.js';

let S = null;
const V = (THREE, x, y, z) => new THREE.Vector3(x, y, z);

// drop schedule: [u, v, tHit, radius]
const DROPS0 = [
  [0.40, 0.46, 52.10, 0.6],
  [0.30, 0.27, 52.42, 0.55],
  [0.70, 0.55, 52.72, 0.5],
  [0.52, 0.72, 52.95, 0.6],
  [0.22, 0.60, 53.12, 0.45],
  [0.76, 0.22, 53.37, 0.5],
  [0.62, 0.36, 53.46, 0.5],
  [0.27, 0.86, 53.55, 0.5],
  [0.80, 0.80, 53.63, 0.45],
  [0.50, 0.12, 53.73, 0.45],
  [0.16, 0.14, 53.92, 0.4],
  [0.66, 0.92, 54.08, 0.4],
];
const DROPS = DROPS0.map(([u, v, t, r]) => [u, v, t, r * 1.3]);
const GHOSTS = [];   // ghost fingers tried: unreadable at phone size; the 'touch' pills + synced rings carry the idea   // drops that grow a ghost finger
const NSTREAK = 170;

export default {
  async init(ctx, spec) {
    const { THREE, P } = ctx, o = spec.o;
    const g = new THREE.Group(); ctx.scene.add(g);   // at the world origin: lib positions (screenPoint, tip) are world space
    const phone = makePhone(ctx, { look: 'home' }); phone.group.position.set(...o); g.add(phone.group);
    const floor = studioFloor(ctx, { r: 60, color: '#0b1016' }); floor.group.position.set(o[0], -0.57, o[2]); g.add(floor.group);
    const drops = DROPS.map(() => { const d = makeDrop(ctx); g.add(d.group); return d; });
    const rings = DROPS.map(() => { const r = makeTouchRing(ctx, { color: P.chargeHot, rmax: 1.5 }); ctx.scene.add(r.mesh); return r; });
    const lines = makeFieldLines(ctx, { max: 48, radius: 0.045 }); ctx.scene.add(lines.group);
    const ch = makeCharges(ctx, 160, { size: 0.095 }); ctx.scene.add(ch.group);
    const fingers = GHOSTS.map(() => { const f = makeFinger(ctx, { shadow: false }); g.add(f.group); return f; });
    // rain streaks (instanced thin cylinders, additive)
    const sg = new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true);
    const sm = new THREE.MeshBasicMaterial({ color: '#a9c8ff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const streaks = new THREE.InstancedMesh(sg, sm, NSTREAK); streaks.frustumCulled = false; g.add(streaks);
    const R = rng(1111);
    const sd = Array.from({ length: NSTREAK }, () => ({ x: o[0] + (R() - 0.5) * 34, z: o[2] + (R() - 0.5) * 34 + 2, ph: R(), sp: 0.85 + R() * 0.4, len: 1.4 + R() * 1.6 }));
    // pills: "touch" badges with a fingertip glyph
    const pills = DROPS.map((d, i) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;opacity:0;white-space:nowrap;display:flex;align-items:center;gap:8px;'
        + 'padding:7px 16px 7px 10px;border-radius:40px;background:rgba(14,22,40,0.78);border:2px solid rgba(127,180,255,0.9);'
        + 'box-shadow:0 0 18px rgba(80,150,255,0.55);font-family:Figtree,Inter,sans-serif;font-weight:600;font-size:26px;color:#fff;transform-origin:50% 100%;';
      el.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M9 28 V9 a4 4 0 0 1 8 0 V19" fill="none" stroke="#9fc8ff" stroke-width="3.2" stroke-linecap="round"/>'
        + '<path d="M17 15 a3.4 3.4 0 0 1 6.8 0 V22 a7 7 0 0 1 -7 7 H12" fill="none" stroke="#9fc8ff" stroke-width="3.2" stroke-linecap="round"/>'
        + '<circle cx="13" cy="5" r="0" fill="#fff"/></svg><span>touch</span>';
      ctx.fx.appendChild(el); return el;
    });
    S = { g, phone, floor, drops, rings, lines, ch, fingers, streaks, sd, pills, m4: new THREE.Matrix4(), q: new THREE.Quaternion(), sc: new THREE.Vector3(), p3: new THREE.Vector3() };
  },

  update(ctx, t, spec) {
    if (!S) return;
    const { THREE, P, U } = ctx, { phone, drops, rings, lines, ch, fingers, pills } = S;
    const on = t > spec.t0 - 0.6 && t < spec.t1 + 0.6;
    S.g.visible = on; lines.group.visible = on; ch.group.visible = on;
    rings.forEach((r) => (r.mesh.visible = false));
    if (!on) { pills.forEach((p) => (p.style.opacity = 0)); return; }
    const w = (x, n = 0) => ctx.wordAt(x, spec.t0, n) ?? spec.t0;
    const tCrazy = w('crazy'), tWater = w('water'), tCond = w('conducts'), tEvery = w('every'), tDrop = w('drop'), tFinger = w('finger.'), tLooks = w('looks');
    const current = t >= spec.t0 && t < spec.t1;

    if (current) {
      ctx.bg = { top: '#141e2b', mid: '#0d141d', bottom: '#05070a' };
      ctx.bloomK = 0.75;
    }

    // ---- x-ray: glass lifts, grid shows (water conducts)
    const ex = U.easeInOut(U.inv(tWater - 0.15, tWater + 0.5, t));
    const ga = U.smooth(U.inv(tWater - 0.05, tWater + 0.45, t));
    phone.grid.reset(); phone.explode(0.62 * ex, { grid: false }); phone.grid.alpha(ga);
    const bars = U.easeOut(U.inv(tEvery - 0.1, tDrop + 0.1, t));
    phone.grid.bars(0.32 * bars);
    phone.screen.brightness(U.lerp(1, 0.22, ga));

    // ---- drops
    const sitting = [], ghostsUV = [];
    let shake = 0;
    DROPS.forEach(([u, v, th, r], i) => {
      const d = drops[i];
      const dt = t - th;
      if (dt < -0.6) { d.set({ alpha: 0 }); d.splash(0); return; }
      if (dt < 0) {
        const h = -dt * 55;
        d.set({ pos: phone.screenPoint(u, v, S.p3, h + 0.4), mode: 'fall', radius: r * 0.75, alpha: 1 });
        d.splash(0);
        return;
      }
      const sq = Math.max(0, 1 - U.spring(U.clamp(dt / 0.45), 3, 4)) * 0.9;
      const grow = U.lerp(0.55, 1, U.easeOut(U.clamp(dt / 0.25)));
      d.set({ pos: phone.screenPoint(u, v, S.p3), mode: 'sit', radius: r * grow, squash: U.clamp(sq), alpha: 1 });
      d.splash(U.clamp(dt / 0.55), { ringR: 2.2 });
      sitting.push(i);
      ghostsUV.push([u, v, 0.9]);
      // phantom touch ring at the landing (rains blue rings, re-pulses in the "crazy" stretch)
      let k = dt / 0.65;
      if (k >= 1 && t > tCrazy && t < tWater) k = ((t - tCrazy + i * 0.17) % 0.7) / 0.7;
      if (t > tLooks) k = ((t - tLooks + i * 0.09) % 0.8) / 0.8;
      if (t > tFinger - 0.03) k = ((t - tFinger + 0.03) % 0.75) / 0.75;   // every drop fires at once on "finger"
      if (k > 0 && k < 1) {
        const rr = rings[i]; rr.mesh.position.copy(phone.screenPoint(u, v, S.p3, 0.02));
        rr.set(k, { size: t > tFinger - 0.03 ? 0.85 : 0.62, alpha: ga > 0.5 && t < tLooks ? 0.4 : 1, color: t > tLooks ? P.chargeHot : P.chargeHot });
      }
      if (dt < 0.12) shake = Math.max(shake, (1 - dt / 0.12) * (t > tCrazy ? 0.45 : 0.3));
    });
    if (current) ctx.shake = shake * (1 - ga) + (t > tFinger && t < tFinger + 0.15 ? 0.2 : 0);

    // ---- screen: phantom touches, apps jumping, glitch
    if (t < tWater + 0.3) {
      if (t < tCrazy) {
        const n = sitting.length;
        phone.look('home', { ghosts: ghostsUV, open: n > 1 ? [5, 9, 2, 14][n % 4] : -1 });
      } else {
        const step = Math.floor((t - tCrazy) / 0.13), R = rng(500 + step), c = step % 5;
        const glitch = 0.35 + 0.5 * R();
        if (c === 1) phone.look('solid', { color: ['#1f9d55', '#d0452f', '#3b6cf0', '#c9a227'][step % 4], color2: '#0b0f18', ghosts: ghostsUV, glitch, seed: step });
        else if (c === 3) phone.look('map', { zoom: 1 + 2.5 * R(), cx: R(), cy: R(), ghosts: ghostsUV, glitch, seed: step });
        else phone.look('home', { open: (R() * 24) | 0, hide: [(R() * 24) | 0], ghosts: ghostsUV, glitch, seed: step });
        if (current && (t - tCrazy) % 0.13 < 0.035 && t < tWater) ctx.flash = 0.05;
      }
    } else phone.look('home', { ghosts: ghostsUV });

    // ---- grid dips under the drops (water pulls charge)
    const pull = U.smooth(U.inv(tCond - 0.1, tCond + 0.35, t));
    const dips = [];
    sitting.forEach((i) => { const lc = phone.grid.toLocal(phone.screenPoint(DROPS[i][0], DROPS[i][1], S.p3)); dips.push({ x: lc.x, z: lc.z, r: 0.85, depth: 0.75 * pull }); });
    phone.grid.setDips(dips);

    // ---- field lines + charge particles: crossings -> drop
    const lns = [], tops = [];
    ch.hideAll();
    let n = 0;
    if (pull > 0.001) {
      sitting.forEach((i, si) => {
        const [u, v, , r] = DROPS[i];
        const top = phone.screenPoint(u, v, new THREE.Vector3(), r * 0.45);
        const lc = phone.grid.toLocal(top);
        const [ci, cj] = phone.grid.nearest(lc.x, lc.z);
        const cells = [];
        for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) {
          if (a < 0 || b < 0 || a >= 18 || b >= 9) continue;
          if (Math.hypot(phone.grid.xs[b] - lc.x, phone.grid.zs[a] - lc.z) < 1.05) cells.push([a, b]);
        }
        cells.slice(0, 4).forEach(([a, b], c) => {
          const from = phone.grid.pos(a, b);
          lns.push({ from, to: top, lift: 0.25, seed: ((si * 4 + c) * 0.37) % 1 });
          for (let q = 0; q < 3 && n < 160; q++) {
            const k = ((t - tCond) * 1.4 + q / 3 + c * 0.21 + si * 0.13) % 1;
            const ctrl = V(THREE, from.x + (from.x - top.x) * 0.3, from.y + (top.y - from.y) * 0.8, from.z + (from.z - top.z) * 0.3);
            const pp = bezier(from, ctrl, top, k);
            ch.setP(n++, pp.x, pp.y, pp.z, pull * (0.6 + 0.5 * Math.sin(k * Math.PI)));
          }
        });
      });
    }
    if (lns.length) { lines.set(lns.slice(0, 48)); lines.update({ k: pull, phase: t * 1.6, alpha: pull, color: P.chargeHot, base: 0.7 }); lines.group.visible = true; }
    else lines.group.visible = false;

    // ---- drops glow a little blue once they "conduct"
    drops.forEach((d) => { if (d.mat.emissive) { d.mat.emissive.set(P.charge); d.mat.emissiveIntensity = 0.35 * pull; } });

    // ---- ghost fingers: every drop looks like a finger
    GHOSTS.forEach((di, gi) => {
      const f = fingers[gi];
      const tt = tLooks - 0.15 + gi * 0.12;
      const k = U.clamp((t - tt) / 0.45);
      if (k <= 0 || !current && t > spec.t1 + 0.5) { f.group.visible = false; return; }
      f.group.visible = true;
      const [u, v, , r] = DROPS[di];
      const s = U.spring(k, 2.4, 5);
      const pos = phone.screenPoint(u, v, new THREE.Vector3(), r * 0.15 + (1 - U.easeOut(k)) * 2.5);
      f.point({ pos, tilt: 48, yaw: [185, 170, 195][gi] });
      f.group.scale.setScalar(Math.max(0.01, 0.75 * (0.5 + 0.5 * s)));
      f.xray(0.55, P.chargeHot);
      f.group.traverse((m) => { if (m.material && m.material.opacity !== undefined && m.material.isMeshPhysicalMaterial) m.material.opacity = 0.5 * U.easeOut(k); });
    });

    // ---- streaks
    const tallH = 34, fallSp = 70;
    const rainA = current || Math.abs(t - spec.t0) < 0.7 ? 1 : 0;
    S.streaks.visible = rainA > 0;
    S.streaks.material.opacity = 0.3 * (1 - 0.45 * ga);
    S.sd.forEach((s, i) => {
      const y = tallH - (((t * fallSp * s.sp) / tallH + s.ph) % 1) * tallH - 0.5;
      S.p3.set(s.x, y + s.len * 0.5, s.z);
      S.sc.set(1, s.len, 1);
      S.streaks.setMatrixAt(i, S.m4.compose(S.p3, S.q, S.sc));
    });
    S.streaks.instanceMatrix.needsUpdate = true;

    // ---- "touch" pills on the drops
    const pillOn = current;
    const pillT = DROPS.map((d, i) => tDrop - 0.05 + i * 0.07);
    ctx.after.push(() => {
      pills.forEach((el, i) => {
        const k = U.clamp((t - pillT[i]) / 0.3);
        if (!pillOn || k <= 0 || i % 2 === 1 && i > 6) { el.style.opacity = 0; return; }
        const [u, v, , r] = DROPS[i];
        const p = phone.screenPoint(u, v, new THREE.Vector3(), r * 0.8 + 0.3).project(ctx.camera);
        const x = (p.x + 1) / 2 * ctx.W, y = (1 - p.y) / 2 * ctx.H;
        const sc = U.backOut(k, 2.2) * (t > tFinger ? 1 + 0.12 * Math.max(0, 1 - (t - tFinger) / 0.25) : 1);
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -110%) scale(${1.5 * sc})`;
        el.style.opacity = Math.min(1, k * 2);
      });
    });
  },

  camera(ctx, t, spec) {
    const U = ctx.U, o = spec.o;
    const w = (x) => ctx.wordAt(x, spec.t0) ?? spec.t0;
    const tCrazy = w('crazy'), tWater = w('water'), tEvery = w('every'), tFinger = w('finger.');
    const O = (x, y, z) => [o[0] + x, o[1] + y, o[2] + z];
    const keys = [
      [spec.t0 - 0.5, { pos: O(-13, 5, 19), target: O(0.2, 2.6, -0.3), fov: 34, roll: 3 }],
      [tCrazy - 0.2, { pos: O(-10, 7.5, 18), target: O(0.3, 2.8, 0), fov: 32, roll: -2 }],
      [tCrazy + 0.12, { pos: O(4, 26, 12), target: O(0, 0, 0.3), fov: 36, roll: -8 }],
      [tWater - 0.2, { pos: O(2, 24, 14), target: O(0, 0.4, 0.3), fov: 34, roll: 5 }],
      [tWater + 0.35, { pos: O(16, 11, 15), target: O(0, 2.6, 0.5), fov: 33, roll: 0 }],
      [tEvery - 0.1, { pos: O(14, 12, 2), target: O(-0.5, 2.4, 0.8), fov: 33, roll: -2 }],
      [tEvery + 0.55, { pos: O(-5, 25, 14), target: O(0, 1.6, 0.6), fov: 34, roll: 0 }],
      [spec.t1 + 0.5, { pos: O(-1, 24, 15), target: O(0, 2.2, -0.6), fov: 34, roll: 3 }],
    ];
    const k = U.clamp(t, keys[0][0], keys[keys.length - 1][0]);
    // snap moves use expoOut, the rest smoother
    let ease = U.smoother;
    if (k > tCrazy - 0.2 && k < tCrazy + 0.12) ease = U.expoOut;
    const p = U.poseTrack(keys, k, ease);
    const d = 0.25;
    p.pos = [p.pos[0] + U.drift(t * 0.9, 1) * d, p.pos[1] + U.drift(t * 0.9, 2) * d, p.pos[2] + U.drift(t * 0.9, 3) * d];
    return p;
  },
};
