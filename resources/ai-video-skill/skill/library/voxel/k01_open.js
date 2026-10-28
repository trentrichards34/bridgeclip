// LIBRARY REFERENCE (k01_open.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k01_open (0 - 2.0): "Two people open a coffee business."  THE HOOK / thumbnail.
// Two shops on one street corner (CORNER CAFE left, NEXT DOOR right, facades angled like a corner block so both signs fit the
// portrait frame big). RED + GREEN land a hop in front (frame 0 mid-air, confetti already falling, balloons bobbing).
// "people" cut to a low side two-shot + wave; "open" both shutters SLAM up (shake), OPEN signs flip, doors swing, confetti
// cannons; "coffee" tight on both steaming cups raised (sparkles); "business" crane back as the A-frames slap down + confetti.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const C = L.C, K = KT.K;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k * k;
const smooth = (k) => k * k * (3 - 2 * k);
const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const spring = (k, f = 3.2, d = 5.5) => (k <= 0 ? 0 : 1 - Math.exp(-d * k) * Math.cos(f * Math.PI * k));
const ring = (dt, a = 1, f = 18, d = 8) => (dt < 0 ? 0 : a * Math.exp(-d * dt) * Math.cos(f * dt));
const imp = (dt, a = 1, d = 12) => (dt < 0 ? 0 : a * Math.exp(-d * dt));
const lerp3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));

const ANG = 0.7;          // corner angle of each facade (rad)
const HW = 4.85;          // shop half width incl. pilaster
const FX = 2.1, FZ = 5.5;  // founders at (-FX / +FX, 0, FZ) (they hop in to ~1.35 on "people" and "coffee")

let S = null;

// a hop arc: [tStart, dur, height] -> { y, sq } (sq: + squash on landing, - stretch in the air)
function hops(list, t) {
  let y = 0, sq = 0;
  for (const [t0, d, h] of list) {
    const q = (t - t0) / d;
    if (q > 0 && q < 1) { y += h * 4 * q * (1 - q); sq += -0.22 * Math.sin(Math.PI * q) * Math.min(1, h); }
    if (q >= 1) sq += ring(t - (t0 + d), 0.45 * Math.min(1, h + 0.3), 20, 9);
    if (q > -0.25 && q <= 0) sq += 0.25 * Math.min(1, h) * Math.sin(Math.PI * (q + 0.25) / 0.25);   // anticipation crouch
  }
  return { y, sq };
}

function makeBalloons(colors, seed) {
  const group = new THREE.Group(), R = L.rng(seed), items = [];
  const sm = L.mat('#f3ead8', { felt: 0.2 });
  colors.forEach((col, i) => {
    const g = new THREE.Group(); group.add(g);
    const x = (i - (colors.length - 1) / 2) * 0.75 + (R() - 0.5) * 0.2, y = 1.6 + R() * 1.1 + (i % 2) * 0.4;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), L.mat(col, { rough: 0.45, felt: 0.5, scale: 2 }));
    b.scale.set(1, 1.18, 1); b.position.set(x, y, (R() - 0.5) * 0.4); b.castShadow = true; g.add(b);
    L.B(0.14, 0.14, 0.14, L.mat(col), { r: 0.04, x, y: y - 0.68, z: b.position.z, parent: g });
    const len = y - 0.7; const s = L.B(0.03, len, 0.03, sm, { r: 0, x: x * 0.5, y: len / 2, z: b.position.z * 0.5, rz: Math.atan2(x * 0.5, len), parent: g });
    s.castShadow = false;
    items.push({ g, ph: R() * 6.28, sp: 1.6 + R() * 0.8 });
  });
  return { group, set(t) { for (const it of items) { it.g.rotation.z = Math.sin(t * it.sp + it.ph) * 0.07; it.g.position.y = Math.sin(t * it.sp * 1.3 + it.ph) * 0.08; } } };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);

    const street = KT.makeStreet(ctx, { w: 60, walk: 12, lamps: 4 }); root.add(street.group);
    // move lamps/trees off the centre line (they would block the founders)
    const spots = [[-9.5, 11.4], [-13.5, 11.2], [9.5, 11.4], [13.5, 11.2], [-21, 11.4], [-25, 11.2], [21, 11.4], [25, 11.2]];
    // blurred foreground pots in the bottom corners (fill the sidewalk under the founders)
    [[-3.1, 11.0, 3, 1.25], [3.3, 11.6, 7, 1.15]].forEach(([x, z, seed, sc]) => { const pl = L.makePlant(ctx, { seed }); pl.group.position.set(x, 0, z); pl.group.scale.setScalar(sc); root.add(pl.group); });
    street.props.forEach((p, i) => { const s = spots[i]; if (s) { p.g.position.x = s[0]; p.g.position.z = s[1]; } });

    // two shops meeting at a corner (facades angled away from each other, both face the camera)
    const shopL = KT.makeShop(ctx, { preset: 'red', aframeX: -3.3 });
    const shopR = KT.makeShop(ctx, { preset: 'green', aframeX: 3.3 });
    shopL.group.rotation.y = -ANG; shopR.group.rotation.y = ANG;
    const cx = HW * Math.cos(ANG), cz = HW * Math.sin(ANG);
    shopL.group.position.set(-cx, 0, 0.3 - cz); shopR.group.position.set(cx, 0, 0.3 - cz);
    root.add(shopL.group, shopR.group);
    // a shared corner post to hide the seam between the two facades
    L.B(1.0, 8.2, 1.0, L.mat('#d8c7a5', { scale: 0.8 }), { r: 0.08, y: 4.1, z: 0.0, parent: root });
    L.B(1.3, 0.45, 1.3, L.mat(K.gold, { rough: 0.45, metal: 0.3 }), { r: 0.06, y: 8.25, z: 0.0, parent: root });

    // balloons on the outer roof corners + over the corner post
    const balL = makeBalloons([K.red, K.cream, C.gold, K.red], 11); balL.group.position.set(-3.6, 7.8, -0.4); shopL.group.add(balL.group);
    const balR = makeBalloons([K.green, K.cream, C.gold, K.green], 23); balR.group.position.set(3.6, 7.8, -0.4); shopR.group.add(balR.group);
    const balC = makeBalloons([K.red, C.gold, K.green], 37); balC.group.position.set(0, 8.4, 0); balC.group.scale.setScalar(0.9); root.add(balC.group);

    // founders + cups (cup in the INNER hand)
    const red = KT.makeFounder(ctx, 'red'), green = KT.makeFounder(ctx, 'green');
    red.group.position.set(-FX, 0, FZ); green.group.position.set(FX, 0, FZ); root.add(red.group, green.group);
    const cupR = KT.makeCup(ctx, { color: K.red, icon: 'bean' }); red.holdR(cupR.group, [0, -0.05, 0.3]);
    const cupG = KT.makeCup(ctx, { color: K.green, icon: 'door' }); green.holdL(cupG.group, [0, -0.05, 0.3]);
    const spR = L.makeSparkle(ctx, { size: 0.5, n: 4, seed: 5 }); root.add(spR.group);   // clink sparkle (placed per frame)
    const spG = { set() {} };

    // confetti: one already falling at frame 0, cannons from both shops on "open", one more on "business"
    const conf0 = L.makeConfetti(ctx, { n: 110, spread: 10, height: 4, seed: 3 }); conf0.group.position.set(0, 7.5, 5.0); root.add(conf0.group);
    const confL = L.makeConfetti(ctx, { n: 70, spread: 5, height: 7, seed: 7, colors: [K.red, C.gold, '#ffffff', K.cream, C.coral] }); confL.group.position.set(-3.4, 4.4, 3.4); root.add(confL.group);
    const confR = L.makeConfetti(ctx, { n: 70, spread: 5, height: 7, seed: 8, colors: [K.green, C.gold, '#ffffff', K.cream, C.yes] }); confR.group.position.set(3.4, 4.4, 3.4); root.add(confR.group);
    const confB = L.makeConfetti(ctx, { n: 90, spread: 8, height: 6, seed: 12 }); confB.group.position.set(0, 6.0, 6.0); root.add(confB.group);

    const W = (w, fb) => ctx.wordAt(w, spec.t0) ?? fb;
    const T = { two: W('two', 0.0), people: W('people', 0.32), open: W('open', 0.56), a: W('a', 0.88), coffee: W('coffee', 1.04), business: W('business', 1.36) };
    const afBase = [shopL.aframe.group.position.clone(), shopR.aframe.group.position.clone()];
    S = { root, street, shopL, shopR, balL, balR, balC, red, green, cupR, cupG, spR, spG, conf0, confL, confR, confB, T, afBase };
  },

  update(ctx, t, spec) {
    if (!S) return;
    const { root, street, shopL, shopR, balL, balR, balC, red, green, cupR, cupG, spR, spG, conf0, confL, confR, confB, T, afBase } = S;
    root.visible = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    if (!root.visible) return;

    street.set({ rise: 1 });

    // --- shutters: down until "open", then SLAM up (easeIn), tiny bounce back, settle ---
    const slam = T.open + 0.02, top = slam + 0.13;
    const shut = (dt) => {
      const tt = t - dt;
      if (tt < slam) return 1;
      if (tt < top) return 1 - easeIn(inv(slam, top, tt));
      return Math.max(0, Math.sin(inv(top, top + 0.22, tt) * Math.PI) * 0.13 * (tt < top + 0.22 ? 1 : 0));
    };
    const doorK = (dt) => spring(inv(top + 0.02 + dt, top + 0.6 + dt, t), 2.2, 4.5) * 0.85;
    const signK = (dt) => smooth(inv(top + dt, top + 0.16 + dt, t));
    shopL.set({ shutter: shut(0), open: doorK(0), sign: signK(0), t });
    shopR.set({ shutter: shut(0.03), open: doorK(0.05), sign: signK(0.04), t: t + 0.7 });

    // A-frames slap down on "business" (drop + squash)
    [shopL, shopR].forEach((sh, i) => {
      const g = sh.aframe.group, b = afBase[i], t0 = T.business - 0.12 + i * 0.07, q = inv(t0, t0 + 0.16, t);
      g.visible = t >= t0;
      g.position.set(b.x, (1 - easeIn(q)) * 3.2, b.z);
      const r = ring(t - (t0 + 0.16), 0.3, 22, 9);
      g.scale.set(1 + r * 0.6, Math.max(0.05, 1 - r), 1 + r * 0.6);
      g.rotation.z = (1 - q) * (i ? 0.5 : -0.5);
    });

    balL.set(t); balR.set(t + 1.3); balC.set(t + 2.1);

    // --- founders ---
    const P = T.people, O = T.open, Co = T.coffee, Bu = T.business;
    const xs = {};
    const pose = (side) => {
      const isR = side === 'red', sgn = isR ? 1 : -1, off = isR ? 0 : 0.05;   // sgn: toward the centre (+X for RED)
      const HL = [[-0.32 + off * 0.5, 0.4, 1.1], [P - 0.03 + off * 0.4, 0.22, 0.45], [O + 0.03 + off * 0.6, 0.28, 0.75], [Co - 0.05 + off * 0.4, 0.24, 0.5], [Bu - 0.02 + off, 0.32, 0.8]];
      const h = hops(HL, t);
      // x: land at FX, hop together on "people", apart on "open", together (clink) on "coffee", apart on "business"
      const XS = [FX, 1.38, FX, 1.55, FX + 0.15];
      let x = XS[0];
      for (let i = 1; i < HL.length; i++) { const [h0, hd] = HL[i]; x = lerp(x, XS[i], smooth(inv(h0, h0 + hd, t))); }
      xs[side] = x;
      // arms: cup arm = inner arm (RED R, GREEN L), free arm = outer
      const bLow = inv(P - 0.05, P + 0.1, t) * (1 - inv(O - 0.05, O + 0.05, t));
      let cupArm = 40 - 25 * bLow, cupReach = 45 - 30 * bLow, freeArm = 12, freeReach = 0;
      // "people": free arm waves
      const wv = inv(P, P + 0.1, t) * (1 - inv(O - 0.02, O + 0.06, t));
      freeArm = lerp(freeArm, 135 + Math.sin((t - P) * 28) * 22, wv);
      // "open": ta-da, both arms up
      const td = spring(inv(O, O + 0.5, t), 2.6, 5) * (1 - smooth(inv(Co - 0.1, Co + 0.05, t)));
      freeArm = lerp(freeArm, 160, td); cupArm = lerp(cupArm, 150, td); cupReach = lerp(cupReach, 15, td);
      // "coffee": cup raised high toward the centre, free arm on the hip-ish
      const cf = spring(inv(Co - 0.06, Co + 0.4, t), 2.4, 5) * (1 - smooth(inv(Bu - 0.05, Bu + 0.15, t)));
      cupArm = lerp(cupArm, 100, cf); cupReach = lerp(cupReach, 25, cf); freeArm = lerp(freeArm, 35, cf);
      // "business": arms wide, welcoming
      const bz = spring(inv(Bu, Bu + 0.45, t), 2.4, 5);
      cupArm = lerp(cupArm, 115, bz); cupReach = lerp(cupReach, 30, bz); freeArm = lerp(freeArm, 120, bz);
      const look = t < P ? 0.15 * sgn : t < O ? 0.0 : t < Co ? 0.1 * sgn : t < Bu ? 0.55 * sgn : 0.1 * sgn;
      const tilt = sgn * (6 * cf + 3 * Math.sin(t * 6 + off * 20)) + sgn * ring(t - (O + 0.34), 4, 16, 6);
      const blink = (Math.abs(t - (isR ? 0.2 : 0.24)) < 0.05 || Math.abs(t - (isR ? 1.62 : 1.7)) < 0.05) ? 1 : 0;
      const p = {
        hop: h.y, squash: h.sq, tilt, turn: -sgn * (8 + 4 * bz), lookX: look, lookY: t > Co && t < Bu ? 0.25 : 0,
        blink, nod: 4 * Math.sin(t * 7 + off * 30) - 8 * imp(t - (top), 1, 10),
      };
      if (isR) Object.assign(p, { armR: cupArm, reachR: cupReach, armL: freeArm, reachL: freeReach, mouth: 'teeth', mouthOpen: 0.15 + 0.6 * td + 0.3 * cf });
      else Object.assign(p, { armL: cupArm, reachL: cupReach, armR: freeArm, reachR: freeReach, mouth: td > 0.3 ? 'o' : 'smile', mouthOpen: 0.3 * td });
      return p;
    };
    red.set(pose('red')); green.set(pose('green'));
    red.group.position.set(-xs.red, 0, FZ); green.group.position.set(xs.green, 0, FZ);

    // cups: steam always, bigger + pop on "coffee"
    const cpop = (dt) => 1 + ring(t - (Co + dt), 0.35, 20, 7);
    cupR.group.scale.setScalar(cpop(0)); cupG.group.scale.setScalar(cpop(0.05));
    cupR.set({ steam: 0.75 + 0.25 * inv(Co - 0.1, Co + 0.1, t), t: t + 0.3 }); cupG.set({ steam: 0.75 + 0.25 * inv(Co - 0.1, Co + 0.1, t), t: t + 1.1 });
    spR.group.position.set(0, 3.3, FZ + 0.6); spR.set({ k: inv(Co + 0.05, Co + 0.75, t) });

    conf0.set({ k: inv(-0.6, 0.95, t) });
    confL.set({ k: inv(top - 0.02, top + 1.5, t) }); confR.set({ k: inv(top + 0.02, top + 1.54, t) });
    confB.set({ k: inv(Bu + 0.02, Bu + 1.5, t) });

    // --- ctx ---
    if (t >= spec.t0 - 0.3 && t <= spec.t1 + spec.blend / 2 + 0.25) {
      ctx.bg = { top: '#6fa6df', mid: '#a9d0ef', bottom: '#f3dcb8' };
      ctx.shake = Math.min(1, imp(t - top, 0.75, 9) + imp(t - 0.08, 0.2, 14) + imp(t - (Bu + 0.04), 0.3, 12));
      ctx.flash = imp(t - top, 0.18, 22);
      const shot = this._shot(t);
      if (shot === 'D') ctx.focus = [0, 3.1, FZ + 0.3];
      else if (shot === 'B') ctx.focus = [0, 2.0, FZ + 0.3];
      else ctx.focus = [0, 3.2, FZ - 1.2];
      ctx.dof = shot === 'D' ? 1.1 : shot === 'B' ? 0.9 : 0.45;
    }
  },

  _shot(t) {
    const T = S.T;
    return t < T.people ? 'A' : t < T.open ? 'B' : t < T.coffee ? 'C' : t < T.business ? 'D' : 'E';
  },

  camera(ctx, t, spec) {
    const T = S.T, o = spec.o;
    const off = (p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    const mk = (pos, target, fov, roll) => ({ pos: off(pos), target: off(target), fov, roll });
    const shot = this._shot(t);
    if (shot === 'A') {        // "Two": wide thumbnail two-shot, fast push in
      const k = easeOut(inv(-0.4, T.people, t));
      return mk(lerp3([0.4, 3.5, 19.6], [0.2, 3.3, 18.3], k), lerp3([0, 3.0, 0.4], [0, 3.0, 0.6], k), 54, lerp(-2.5, -0.5, k));
    }
    if (shot === 'B') {        // "people": punch in low from the left, both founders shoulder to shoulder, signs above
      const k = easeOut(inv(T.people, T.open, t));
      return mk(lerp3([-2.1, 1.4, 17.8], [-1.6, 1.55, 16.9], k), lerp3([0.1, 2.2, 5.5], [0.1, 2.25, 5.5], k), 46, lerp(4.5, 2.5, k));
    }
    if (shot === 'C') {        // "open": low frontal wide on both shutters slamming up
      const k = easeOut(inv(T.open, T.coffee, t));
      return mk(lerp3([-0.5, 1.0, 19.4], [-0.15, 1.3, 17.8], k), lerp3([0, 3.6, 0.3], [0, 3.55, 0.6], k), 56, lerp(2.5, -1, k));
    }
    if (shot === 'D') {        // "coffee": tight on the clink, faces + cups
      const k = easeOut(inv(T.coffee, T.business, t));
      return mk(lerp3([0.4, 2.3, 18.4], [0.15, 2.5, 17.4], k), lerp3([0, 2.65, FZ], [0, 2.75, FZ], k), 44, lerp(-3, -1.5, k));
    }
    // "business": crane back + up to the full corner, keeps drifting through the whip
    const k = expoOut(inv(T.business, T.business + 0.6, t)), d = inv(T.business + 0.4, 2.6, t);
    return mk(lerp3([1.4, 2.2, 14.2], [0.5 - d * 0.8, 3.7 + d * 0.5, 19.8 + d * 1.0], k), lerp3([0, 2.8, 4.0], [0, 3.0 + d * 0.2, 0.4], k), lerp(48, 54, k), lerp(4, -1.5, k) + d * 1.5);
  },
};
