/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s05_cross.js - Macro then cascade + radar scan (19.30-25.80 s)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: "Everywhere a row crosses a column, the phone holds a tiny electric charge and it checks every one of those crossings over and over."
 * Shows:
 *   Macro on ONE crossing: a row wire races in, a column slides under it (spark), charge spirals in and an orb pops.
 *   Fast pull-back to top-down: every crossing lights in a cascade from the centre, a radar-like scan sweeps the
 *   rows, faster each pass, camera tilts to a 3/4.
 * Techniques to steal:
 *   - macro-to-wide reveal: hero object first, then the whole system cascading from it (delay by distance)
 *   - post-scaling instanced orbs/glows per frame for the cascade
 *   - accelerating scan passes with a beam + light curtain (canvas gradient textures: radial, beam, curtain)
 *   - gaussian pulses for grade accents (bloomK / flash / shake = sum of gauss(t - wordTime))
 *   - DOM readout pill in ctx.fx
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
// s05_cross (19.30-25.80) "Everywhere a row crosses a column, the phone holds a tiny electric charge and it checks
// every one of those crossings over and over."
// Macro on one crossing: a row wire races in, a column slides under it (spark where they cross), charge spirals in and a
// tiny orb pops between them. Then a fast pull-back to top-down: every crossing lights in a cascade from the centre,
// and a radar-like scan line sweeps the rows again and again, faster each pass, while the camera tilts to a 3/4.
import { makePhone, makeGrid, makeCharges, makeTouchRing, studioFloor } from './lib.js';

let S = null;
const GY = 1.45;                       // grid height above the station floor plane
const HI = 8, HJ = 4;                  // the hero crossing (row 8, column 4)

function radialTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}
function beamTexture(THREE) {             // along v: bright leading edge at v=1, soft trail toward v=0
  const c = document.createElement('canvas'); c.width = 8; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.93, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.97, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256); return new THREE.CanvasTexture(c);
}
function curtainTexture(THREE) {          // vertical light curtain: bright at the bottom, fading up, soft sides
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
  const sx = g.createLinearGradient(0, 0, 64, 0); sx.addColorStop(0, 'rgba(0,0,0,1)'); sx.addColorStop(0.1, 'rgba(0,0,0,0)'); sx.addColorStop(0.9, 'rgba(0,0,0,0)'); sx.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = sx; g.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(c);
}

export default {
  async init(ctx, spec) {
    const { THREE, P } = ctx;
    const o = spec.o;
    const G = new THREE.Group(); G.position.set(o[0], o[1], o[2]); ctx.scene.add(G);

    // the phone, twice life size, as the stage: body + dark screen, no cover glass
    const phone = makePhone(ctx, { look: 'off' }); phone.group.scale.setScalar(2); G.add(phone.group);
    phone.layers.glass.visible = false;
    const floor = studioFloor(ctx, { r: 90 }); floor.group.position.set(0, -1.15, 0); G.add(floor.group);

    // our own sensor grid at the same proportions as the phone's (9 x 18), scaled up
    const grid = makeGrid(ctx, { cols: 9, rows: 18, w: 12.6, h: 27.6, wire: 0.05, gap: 0.26, orb: 0.17, dipTint: false });
    grid.group.position.set(0, GY, 0); G.add(grid.group);
    const sh = grid.parts.sheet; if (sh) { sh.material.envMapIntensity = 0.08; sh.material.clearcoat = 0; sh.material.color.set('#0a1430'); sh.material.roughness = 0.6; }
    phone.mats.metal.envMapIntensity = 0.5;
    const hx = grid.xs[HJ], hz = grid.zs[HI];
    const ext = 0.35;

    // hero wires (smooth, slightly thicker than the grid's) + soft additive sleeves
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true); cyl.rotateZ(Math.PI / 2); cyl.translate(0.5, 0, 0);   // grows from its start along +X
    const mk = (col) => new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true });
    const add = (col) => new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const hero = new THREE.Group(); hero.position.set(0, GY, 0); G.add(hero);
    const row = new THREE.Mesh(cyl, mk('#ffffff')); const rowS = new THREE.Mesh(cyl, add('#ffffff'));
    const col = new THREE.Mesh(cyl, mk('#ffffff')); const colS = new THREE.Mesh(cyl, add('#ffffff'));
    for (const m of [row, rowS]) { m.position.set(-grid.w / 2 - ext, 0.13, hz); hero.add(m); }
    for (const m of [col, colS]) { m.rotation.y = -Math.PI / 2; m.position.set(hx, -0.13, -grid.h / 2 - ext); hero.add(m); }   // grows along +Z
    // the charge orb between them + halo + flat ring
    const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mk('#ffffff')); orb.position.set(hx, 0, hz); hero.add(orb);
    const rtex = radialTexture(THREE);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: rtex, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true }));
    halo.position.copy(orb.position); hero.add(halo);
    const spark = new THREE.Sprite(halo.material.clone()); spark.position.copy(orb.position); hero.add(spark);
    const ring = makeTouchRing(ctx, { color: P.chargeHot, rmax: 1.2 }); ring.mesh.position.set(hx, 0.0, hz); hero.add(ring.mesh);
    const ring2 = makeTouchRing(ctx, { color: P.chargeHot, rmax: 6 }); ring2.mesh.position.set(hx, 0.0, hz); hero.add(ring2.mesh);

    // particles: charge spiralling into the crossing, sparks flowing along the hero wires (world space)
    const inflow = makeCharges(ctx, 70, { color: P.chargeHot, size: 0.024, glow: 3 }); ctx.scene.add(inflow.group);
    const wflow = makeCharges(ctx, 48, { color: P.chargeHot, size: 0.02, glow: 3 }); ctx.scene.add(wflow.group);
    const R = ctx.U.rng(505);
    const seeds = Array.from({ length: 120 }, () => [R(), R(), R(), R()]);

    // scan beam: a flat light bar with a trail + a thin vertical curtain
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), add(P.chargeHot)); beam.material.map = beamTexture(THREE);
    beam.rotation.x = -Math.PI / 2; G.add(beam);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), add(P.chargeHot)); curtain.material.map = curtainTexture(THREE); curtain.material.side = THREE.DoubleSide; G.add(curtain);

    // readout pill (DOM)
    const pill = document.createElement('div');
    pill.style.cssText = 'position:absolute;left:50%;top:1600px;transform:translateX(-50%);display:flex;align-items:center;gap:18px;padding:18px 34px;border-radius:999px;' +
      'background:rgba(12,20,38,0.62);border:1.5px solid rgba(127,180,255,0.45);color:#e8f0ff;font:500 40px Figtree, Inter, sans-serif;letter-spacing:0.5px;white-space:nowrap;opacity:0;backdrop-filter:blur(6px)';
    pill.innerHTML = '<span style="width:18px;height:18px;border-radius:50%;background:#7fb4ff;box-shadow:0 0 18px 4px #2a7afc"></span><span>scanning every crossing</span>';
    ctx.fx.appendChild(pill);

    S = { G, phone, floor, grid, hero, row, rowS, col, colS, orb, halo, spark, ring, ring2, inflow, wflow, seeds, beam, curtain, pill, hx, hz, ext,
      m4: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color(), v: new THREE.Vector3() };
  },

  update(ctx, t, spec) {
    const { U, P } = ctx;
    const s = S;
    const on = t > spec.t0 - 0.7 && t < spec.t1 + 0.7;
    s.G.visible = on; s.inflow.group.visible = on; s.wflow.group.visible = on;
    if (!on) { s.pill.style.opacity = 0; s.inflow.hideAll(); s.wflow.hideAll(); return; }
    const T = timings(ctx, spec);
    const { grid, hx, hz, ext } = s;
    const gauss = (x, w) => Math.exp(-(x * x) / (w * w));

    s.phone.look('off'); s.phone.screen.brightness(0.5);

    // ---------- hero wires: row races in from the left, column slides in underneath from the far end
    const rowFront = U.track([[spec.t0 - 0.3, -grid.w / 2 - ext], [T.row, hx], [T.row + 0.55, grid.w / 2 + ext]], t, U.easeOut);
    const colFront = U.track([[T.crosses - 0.55, -grid.h / 2 - ext], [T.crossAt, hz], [T.column + 0.25, grid.h / 2 + ext]], t, (k) => k);
    const rowLen = Math.max(1e-3, rowFront + grid.w / 2 + ext), colLen = Math.max(1e-3, colFront + grid.h / 2 + ext);
    const macro = 1 - U.smooth(U.inv(T.pull + 0.1, T.pull + 0.5, t));      // hero fades into the grid after the pull-back
    const rowB = (1.2 + 1.6 * gauss(t - T.row - 0.05, 0.14)) * macro, colB = (1.0 + 1.6 * gauss(t - T.column - 0.05, 0.14)) * macro;
    s.row.scale.set(rowLen, 0.055, 0.055); s.rowS.scale.set(rowLen, 0.11, 0.11);
    s.col.scale.set(colLen, 0.055, 0.055); s.colS.scale.set(colLen, 0.11, 0.11);
    s.row.visible = s.rowS.visible = rowFront > -grid.w / 2 - ext + 0.01 && macro > 0.01;
    s.col.visible = s.colS.visible = colFront > -grid.h / 2 - ext + 0.01 && macro > 0.01;
    s.row.material.color.set(P.wireRow).multiplyScalar(rowB); s.rowS.material.color.set(P.wireRow).multiplyScalar(0.12 * rowB);
    s.col.material.color.set(P.wireCol).multiplyScalar(colB * 0.9); s.colS.material.color.set(P.wireCol).multiplyScalar(0.1 * colB);
    s.row.material.opacity = s.col.material.opacity = Math.min(1, macro * 1.5);

    // spark where the column slides under the row ("crosses")
    const sp = gauss(t - T.crossAt - 0.03, 0.12);
    s.spark.visible = sp > 0.01; s.spark.scale.setScalar(1.3 * sp + 0.1); s.spark.material.color.set(P.wireCol).multiplyScalar(1.4 * sp);

    // ---------- the charge: particles spiral in on "holds", orb pops on "charge"
    const pop = U.spring(U.inv(T.charge - 0.08, T.charge + 0.9, t), 2.6, 4.2);
    const pre = U.smooth(U.inv(T.tiny - 0.05, T.charge - 0.08, t)) * 0.18;        // a faint seed glows on "tiny"
    const orbR = (pre + 0.82 * pop) * 0.17 * (1 + 0.06 * Math.sin(t * 9));
    const heroOrbOn = 1 - U.smooth(U.inv(T.pull + 0.25, T.pull + 0.55, t));     // the grid's own orb takes over after the pull-back
    s.orb.visible = orbR > 0.002 && heroOrbOn > 0.01;
    s.orb.scale.setScalar(Math.max(1e-3, orbR));
    s.orb.material.color.set(P.chargeHot).multiplyScalar(2.2 + 2 * gauss(t - T.charge, 0.15));
    s.orb.material.opacity = heroOrbOn;
    s.halo.visible = s.orb.visible; s.halo.scale.setScalar(orbR * 7 + 0.9 * gauss(t - T.charge - 0.05, 0.2));
    s.halo.material.color.set(P.charge).multiplyScalar((0.7 + 0.9 * gauss(t - T.charge, 0.18)) * heroOrbOn);
    s.ring.set(U.inv(T.charge - 0.02, T.charge + 0.7, t), { size: 1, alpha: 1 });
    s.ring2.set(U.inv(T.pull + 0.05, T.pull + 0.9, t), { size: 1, alpha: 0.8 });

    // inflow particles
    s.inflow.hideAll();
    s.hero.updateWorldMatrix(true, false);
    const cW = s.v.set(hx, 0, hz).applyMatrix4(s.hero.matrixWorld).clone();
    for (let n = 0; n < 70; n++) {
      const sd = s.seeds[n];
      const k0 = T.holds - 0.25 + sd[0] * 0.9, k1 = T.charge + 0.02 + sd[1] * 0.05;
      const k = U.inv(k0, k1, t); if (k <= 0 || k >= 1) continue;
      const e = U.easeIn(k), a = sd[2] * 6.283 + e * 4.2, r = (0.6 + 1.5 * sd[3]) * (1 - e);
      const y = (sd[1] - 0.5) * 1.4 * (1 - e) + 0.3 * Math.sin(a) * (1 - e);
      s.inflow.setP(n, cW.x + Math.cos(a) * r, cW.y + y, cW.z + Math.sin(a) * r, 0.5 + 0.8 * Math.sin(Math.PI * k));
    }
    // sparks running along the hero wires
    s.wflow.hideAll();
    for (let n = 0; n < 48; n++) {
      const sd = s.seeds[70 + n];
      const isRow = n < 24;
      const tStart = isRow ? T.row : T.column;
      const a = U.smooth(U.inv(tStart, tStart + 0.25, t)) * macro;
      if (a <= 0.01) continue;
      const k = ((t - tStart) * (0.18 + 0.12 * sd[0]) + sd[1]) % 1;
      const d = (k - 0.5) * 9;                      // 9 cm of wire around the crossing
      if (isRow) s.wflow.setP(n, cW.x + d, cW.y + 0.13, cW.z, a * (0.7 + 0.6 * sd[2]));
      else s.wflow.setP(n, cW.x, cW.y - 0.13, cW.z + d, a * (0.7 + 0.6 * sd[2]));
    }
    s.wflow.setColor(P.chargeHot, 3);

    // ---------- the whole grid: ghost in macro, then wires flood + orbs cascade from the hero on the pull-back
    grid.reset();
    const flood = U.inv(T.pull - 0.05, T.pull + 0.45, t);
    grid.reveal(1);                                   // orbs are scaled per crossing below (cascade)
    grid.alpha(U.lerp(0.28 * U.smooth(U.inv(spec.t0 - 0.2, T.row, t)), 1, U.smooth(flood)));
    grid.wires(1 + 0.4 * gauss(t - T.pull - 0.25, 0.25));
    // scan passes: accelerating, like a radar
    let scanPos = -100, passStart = T.checks, dur = 0.74, pass = -1;
    if (t >= T.checks) {
      while (passStart + dur <= t) { passStart += dur; dur = Math.max(0.2, dur * 0.78); pass++; }
      pass++;
      const k = (t - passStart) / dur;
      grid.scan(k, { axis: 'row', width: 1.0 });
      scanPos = k * (grid.rows - 1 + 2) - 1;
    }
    const scanOn = U.smooth(U.inv(T.checks - 0.05, T.checks + 0.15, t));
    grid.pulse(t >= T.checks ? (i) => { const d = scanPos - i; return d < 0 ? 0 : 0.9 * Math.exp(-d / 1.6); } : null);
    // orb cascade: post-scale the grid's instanced orbs + glows
    const tc = T.pull + 0.05, speed = 22;
    const O = grid.parts.orbs, Gl = grid.parts.glows;
    for (let i = 0; i < grid.rows; i++) for (let j = 0; j < grid.cols; j++) {
      const k = i * grid.cols + j;
      const dist = Math.hypot(grid.xs[j] - hx, grid.zs[i] - hz);
      let f = U.backOut(U.inv(tc + dist / speed, tc + dist / speed + 0.28, t), 2.2);
      if (i === HI && j === HJ) f = U.smooth(U.inv(T.pull + 0.25, T.pull + 0.55, t));
      f = Math.max(0, f);
      for (const [m, xz] of [[O, false], [Gl, true]]) {
        m.getMatrixAt(k, s.m4); s.m4.decompose(s.p, s.q, s.s);
        if (xz) s.s.set(s.s.x * f * 0.45, s.s.y, s.s.z * f * 0.45); else s.s.multiplyScalar(f);
        s.s.set(Math.max(1e-4, s.s.x), Math.max(1e-4, s.s.y), Math.max(1e-4, s.s.z));
        m.setMatrixAt(k, s.m4.compose(s.p, s.q, s.s));
      }
    }
    O.instanceMatrix.needsUpdate = true; Gl.instanceMatrix.needsUpdate = true;

    // scan beam + curtain ride the scan line
    const beamA = t >= T.checks ? scanOn * (1 - U.smooth(U.inv(spec.t1 + 0.2, spec.t1 + 0.6, t))) : 0;
    const zScan = -grid.h / 2 + (scanPos / (grid.rows - 1)) * grid.h;
    const visBeam = beamA > 0.01 && zScan > -grid.h / 2 - 2 && zScan < grid.h / 2 + 2;
    s.beam.visible = s.curtain.visible = visBeam;
    const trail = U.lerp(2.6, 5, U.inv(T.checks, spec.t1, t));
    s.beam.scale.set(grid.w + 1.4, trail, 1); s.beam.position.set(0, GY + 0.02, zScan - trail / 2 + 0.15);
    s.beam.material.color.set(P.chargeHot).multiplyScalar(0.9 * beamA);
    s.curtain.scale.set(grid.w + 1.4, 1.3, 1); s.curtain.position.set(0, GY + 0.65, zScan + 0.05);
    s.curtain.material.color.set(P.charge).multiplyScalar(0.8 * beamA);

    // readout pill
    const pa = U.smooth(U.inv(T.every - 0.1, T.every + 0.25, t)) * (1 - U.smooth(U.inv(spec.t1 - 0.1, spec.t1 + 0.25, t)));
    s.pill.style.opacity = pa.toFixed(3);
    s.pill.style.transform = `translateX(-50%) translateY(${(1 - U.backOut(U.inv(T.every - 0.1, T.every + 0.35, t))) * 40}px) scale(${1 + 0.04 * Math.exp(-Math.pow((t - passStart) / 0.08, 2))})`;

    // ---------- grade
    if (t >= spec.t0 && t < spec.t1) {
      ctx.bg = { top: '#070a11', mid: '#0a1020', bottom: '#040508' };
      ctx.bloomK = 0.75 + 0.3 * gauss(t - T.charge, 0.25) + 0.1 * scanOn;
      ctx.flash = 0.12 * gauss(t - T.charge, 0.06) + 0.06 * gauss(t - T.crossAt, 0.05);
      ctx.shake = 0.3 * gauss(t - T.charge - 0.03, 0.1) + 0.15 * gauss(t - T.crossAt, 0.08) + 0.12 * gauss(t - T.pull - 0.1, 0.12);
    }
  },

  camera(ctx, t, spec) {
    const { U } = ctx;
    const o = spec.o;
    const T = timings(ctx, spec);
    const hz = (HI / 17 - 0.5) * 27.6;
    const c = [o[0], o[1] + GY, o[2] + hz];
    const orb = (az, el, d, fov = 30, roll = 0) => ({ ...U.orbit(c, d, az, el, fov), roll });
    const L = (p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    let p;
    if (t < T.pull) {
      // macro: slow drift across the crossing, closer with each event
      const keys = [
        [spec.t0 - 0.4, [46, 20, 11, 30, -4]],
        [T.row, [32, 18, 9, 30, -2]],
        [T.column, [12, 26, 8, 30, 0]],
        [T.holds, [-6, 24, 6.4, 30, 2]],
        [T.charge, [-18, 20, 5, 28, 3]],
        [T.pull, [-24, 22, 4.7, 28, 3]],
      ];
      const v = U.track(keys, t, U.easeInOut);
      p = orb(v[0], v[1], v[2], v[3], v[4]);
    } else {
      // pull back fast to top-down (with a twist), then tilt into a low 3/4 while the scans speed up
      const top = { pos: L([0.6, 80, 6.0]), target: L([0, GY, -5]), fov: 32, roll: 0 };
      const tilt = { pos: L([18, 30, 40]), target: L([0, GY, -2.5]), fov: 32, roll: -3 };
      const macroEnd = orb(-24, 22, 4.7, 28, 3);
      const k = U.expoOut(U.inv(T.pull, T.pull + 0.75, t));
      const k2 = U.smoother(U.inv(T.crossings - 0.4, spec.t1 + 0.3, t));
      const hold = { pos: U.arr(U.v3(top.pos).add(U.v3([-1.5 * U.inv(T.pull, T.crossings, t), -4 * U.inv(T.pull, T.crossings, t), 0]))), target: top.target, fov: 32, roll: 0 };
      const b = {
        pos: U.arr(U.v3(hold.pos).lerp(U.v3(tilt.pos), k2)), target: U.arr(U.v3(hold.target).lerp(U.v3(tilt.target), k2)),
        fov: 32, roll: U.lerp(0, tilt.roll, k2),
      };
      p = {
        pos: U.arr(U.v3(macroEnd.pos).lerp(U.v3(b.pos), k)), target: U.arr(U.v3(macroEnd.target).lerp(U.v3(b.target), k)),
        fov: U.lerp(28, 32, k), roll: U.lerp(3, b.roll, k) - 28 * Math.sin(Math.PI * Math.min(1, k)) * (1 - k * 0.3),
      };
    }
    return p;
  },
};

function timings(ctx, spec) {
  const W = (w, n = 0) => ctx.wordAt(w, spec.t0 - 0.1, n) ?? spec.t0;
  const T = {
    row: W('row'), crosses: W('crosses'), column: W('column,') ?? W('column'), holds: W('holds'), tiny: W('tiny'), charge: W('charge'),
    and: W('and'), checks: W('checks'), every: W('every'), crossings: W('crossings'), over: W('over'),
  };
  T.column = W('column');
  T.crossAt = (T.crosses + T.column) / 2 - 0.05;
  T.pull = T.and;
  return T;
}
