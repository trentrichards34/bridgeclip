// LIBRARY REFERENCE (k14_matter.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k14_matter 47.3-51.2 (film ends 51.6) "You don't have to be for everyone. You have to matter to someone."
// Set A (street, skyline): a crowd under a lit EVERYONE marquee sign, GREEN in front.
//   "You": crowd bobbing, GREEN pops in; "don't": GREEN shakes his head; "have": hard cut 3/4 high, crowd rows hop on
//   "to" / "be" / "for" (a wave); "everyone": hard cut front, a red X slams across EVERYONE, the crowd poofs away
//   edge-first until only the busy pro is left, sparkle over him.
// Set B (the busy pro's front door, local x +DX): "You": hard cut, door swings open, pro steps out; GREEN hops in with a cup.
//   "matter": hard cut to the warm two-shot, GREEN holds the cup out; "to": the cup passes to the pro, he hops;
//   "someone": a heart pops between them + sparkle. Then a calm slow push, heart beating, steam: the last frame of the film.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import * as U from '/engine/core/util.js';

const C = L.C, K = KT.K;
const DX = 40;                       // front-door set offset inside the station
const PRO_A = [0, 0, 1.9];           // busy pro inside the crowd
const GA = [-1.9, 0, 6.4];           // GREEN in the street set
const CROWD = [   // type, x, z, row
  ['student', -3.15, -0.2, 0], ['nerd', -1.05, -0.3, 0], ['anyone', 1.05, -0.3, 0], ['pro', 3.15, -0.2, 0],
  ['anyone', -4.3, 1.7, 1], ['student', -2.15, 1.9, 1], ['nerd', 2.15, 1.9, 1], ['anyone', 4.3, 1.7, 1],
  ['pro', -3.3, 3.6, 2], ['student', 3.3, 3.6, 2], ['anyone', 1.6, 3.9, 2],
];
// poof order: edges first, inner last (index into CROWD)
const POOF = [10, 4, 7, 0, 3, 8, 9, 5, 6, 1, 2];
const PRO_B0 = [-0.35, 0.0, -0.75];  // pro inside the doorway (local to door set)
const PRO_B1 = [-0.95, 0.24, 0.7];    // on the step / doormat
const GB = [1.55, 0, 2.05];           // GREEN in front of the step

let st = null;

function cues(ctx, spec) {
  const w = (word, d, n = 0) => ctx.wordAt(word, spec.t0, n) ?? d;
  return {
    you: w('you', 47.30), dont: w("don't", 47.45), have: w('have', 47.70), to: w('to', 47.94), be: w('be', 48.02), for: w('for', 48.17),
    everyone: w('everyone', 48.34), you2: w('you', 49.05, 1), have2: w('have', 49.22, 1), to2: w('to', 49.38, 1),
    matter: w('matter', 49.53), to3: w('to', 49.85, 2), someone: w('someone', 50.09),
  };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, parent = root) => { o.group.position.set(x, y, z); parent.add(o.group); return o; };

    // ---------- set A: street + crowd under EVERYONE ----------
    const setA = new THREE.Group(); root.add(setA);
    const street = at(KT.makeStreet(ctx, { w: 50 }), 0, 0, -2.5, setA);
    const sky = at(KT.makeSkyline(ctx, { w: 70, z: -12 }), 0, 0, 0, setA);
    const sign = at(KT.makeBigSign(ctx, 'EVERYONE', { color: K.red, w: 7.4, h: 2.9, legs: 2.5, crossStyle: 'x' }), 0, 0, -2.2, setA);
    const crowd = CROWD.map(([type, x, z, row], i) => ({ c: at(KT.makeCrowdMember(ctx, type, i + 11), x, 0, z, setA), x, z, row, i }));
    const pro = at(KT.makeBusyPro(ctx), ...PRO_A, setA);
    const greenA = at(KT.makeFounder(ctx, 'green'), ...GA, setA);
    const poofs = CROWD.map((_, i) => { const s = L.makeSparkle(ctx, { size: 0.7, n: 4, seed: 300 + i }); setA.add(s.group); return s; });
    const proSpark = L.makeSparkle(ctx, { size: 1.0, seed: 77 }); proSpark.group.position.set(PRO_A[0] + 1.1, 2.9, PRO_A[2] + 0.4); setA.add(proSpark.group);

    // ---------- set B: the busy pro's front door ----------
    const home = new THREE.Group(); home.position.set(DX, 0, 0); root.add(home);
    L.B(36, 0.4, 26, L.mat('#a9a196', { scale: 0.7 }), { r: 0, y: -0.2, z: 7, parent: home });
    for (const z of [3.4, 7.0]) L.B(36, 0.06, 0.25, L.mat('#8a8276'), { r: 0, y: 0.02, z, parent: home });
    const fd = at(KT.makeFrontDoor(ctx, { mat: 'WELCOME', number: '42', w: 14, h: 9 }), 0, 0, 0, home);
    for (const [s, x] of [[-1, -3.3], [1, 3.5]]) { const p = L.makePlant(ctx, { seed: 8 + s }); p.group.position.set(x, 0, 1.1); home.add(p.group); }
    const warm = new THREE.PointLight('#ffb36a', 18, 14, 1.6); warm.position.set(0.6, 4.2, 4.2); home.add(warm);
    const pro2 = at(KT.makeBusyPro(ctx), ...PRO_B0, home); pro2.group.scale.setScalar(0.9); pro2.acc.bag.visible = false;
    const green = at(KT.makeFounder(ctx, 'green'), ...GB, home);
    const cup = at(KT.makeCup(ctx, { color: K.green, icon: 'door', size: 0.95 }), 0, 0, 0, home);
    const heart = at(KT.makeHeart(ctx, { size: 0.85 }), 0.3, 3.75, 1.5, home);
    const hSpark = L.makeSparkle(ctx, { size: 1.3, seed: 91 }); hSpark.group.position.set(0.3, 3.8, 1.7); home.add(hSpark.group);
    const cSpark = L.makeSparkle(ctx, { size: 0.7, n: 4, seed: 93 }); home.add(cSpark.group);

    st = { root, setA, home, street, sky, sign, crowd, pro, greenA, poofs, proSpark, fd, pro2, green, cup, heart, hSpark, cSpark, warm };
  },

  update(ctx, t, spec) {
    const S = st, T = cues(ctx, spec);
    S.root.visible = !(t < spec.t0 - 0.6 || t > spec.t1 + 0.6);
    if (!S.root.visible) return;
    const { clamp, backOut, smooth, lerp } = U;
    const kk = (a, d) => clamp((t - a) / d);
    const blinkAt = (s) => (((t * 0.9 + s * 0.37) % 1.9) < 0.08 ? 1 : 0);
    const ring = (a, f = 22, dmp = 8) => (t > a ? Math.exp(-dmp * (t - a)) * Math.cos((t - a) * f) : 0);
    const bump = (a, d) => { const x = t - a; return x > 0 && x < d ? Math.sin(Math.PI * x / d) : 0; };

    // ================= set A =================
    {
      S.street.set({ rise: 1 }); S.sky.set({ rise: 1 });
      for (const q of S.street.props) if (Math.abs(q.g.position.x) < 5.5) q.g.visible = false;
      // sign: lit, wobbles on "for", red X slams on "everyone"
      const crossK = kk(T.everyone + 0.02, 0.22);
      S.sign.set({ lit: 1 - 0.6 * kk(T.everyone + 0.25, 0.3), t, cross: crossK });
      const sb = S.sign.board;
      sb.rotation.z = 0.035 * ring(T.for, 18, 6) + 0.05 * ring(T.everyone + 0.2, 20, 6);
      sb.scale.setScalar(1 + 0.06 * bump(T.for, 0.18) + 0.08 * Math.max(0, ring(T.everyone + 0.2, 26, 9)));

      // crowd: idle bob, row wave on to/be/for, poof away on everyone
      const rowCue = [T.to, T.be, T.for];
      S.crowd.forEach(({ c, x, z, row, i }) => {
        const pi = POOF.indexOf(i);
        const tp = T.everyone + 0.06 + pi * 0.036;
        const k = kk(tp, 0.14);
        c.group.visible = k < 1;
        const s = 1 - smooth(k);
        c.group.scale.set(Math.max(0.001, s * (1 + 0.2 * Math.sin(Math.PI * k))), Math.max(0.001, s * (1 - 0.15 * Math.sin(Math.PI * k))), Math.max(0.001, s));
        const wv = bump(rowCue[row], 0.3);
        const idle = Math.max(0, 0.12 * Math.sin(t * 6.3 + i * 1.9));
        c.set({ hop: idle + 0.75 * wv + 0.3 * bump(tp - 0.1, 0.12), squash: 0.05 * Math.sin(t * 6.3 + i * 1.9) - 0.2 * wv + 0.25 * Math.max(0, ring(rowCue[row] + 0.3, 24, 10)),
          armL: 20 + 120 * wv + 8 * Math.sin(t * 3 + i), armR: 20 + 120 * wv + 8 * Math.cos(t * 3 + i),
          lookX: 0.25 * Math.sin(t * 1.3 + i), lookY: 0.15, tilt: 6 * Math.sin(t * 2.4 + i), blink: blinkAt(i + 2), mouth: k > 0 ? 'o' : undefined });
        const pf = S.poofs[i];
        pf.group.position.set(x, 1.3, z + 0.3);
        pf.group.visible = t > tp - 0.02;
        pf.set({ k: kk(tp - 0.02, 0.6) });
      });

      // busy pro: part of the crowd, then left alone and looks up at camera
      {
        const p = S.pro;
        const lastPoof = T.everyone + 0.06 + (POOF.length - 1) * 0.036 + 0.14;
        const alone = kk(lastPoof, 0.2);
        const wv = bump(T.be, 0.3);
        const lh = t - lastPoof;
        let hop = Math.max(0, 0.08 * Math.sin(t * 6.1)) + 0.7 * wv, squash = 0.03 * Math.sin(t * 6.1) - 0.2 * wv;
        if (lh > 0 && lh < 0.28) { hop += 0.6 * Math.sin(Math.PI * lh / 0.28); squash -= 0.18 * Math.sin(Math.PI * lh / 0.28); }
        squash += 0.3 * Math.max(0, ring(lastPoof + 0.28, 24, 9));
        const lookAround = t > T.everyone + 0.1 && t < lastPoof ? 0.8 * Math.sin((t - T.everyone) * 14) : 0;
        p.set({ hop, squash, lookX: lerp(lookAround, 0, alone), lookY: 0.1, blink: blinkAt(5), mouth: alone > 0.5 ? 'smile' : (t > T.everyone ? 'o' : 'flat'),
          tilt: 5 * Math.sin(t * 3.2), armL: 15 + 60 * wv + 40 * bump(lastPoof, 0.4), armR: 10 + 60 * wv, brow: t > T.everyone && alone < 0.5 ? -10 : 0 });
        S.proSpark.group.visible = t > lastPoof;
        S.proSpark.set({ k: kk(lastPoof, 0.8) });
      }

      // GREEN: hop in on "You", head shake on "don't", points at the sign on "have"
      {
        const g = S.greenA;
        const h0 = spec.t0 - 0.3, h1 = spec.t0 + 0.05;
        let hop = 0, squash = 0;
        if (t < h1) { const k = clamp((t - h0) / (h1 - h0)); hop = 1.4 * Math.sin(Math.PI * k); squash = -0.22 * Math.sin(Math.PI * k); }
        squash += 0.3 * Math.max(0, ring(h1, 24, 9));
        const slide = t < h1 ? -1.8 * (1 - clamp((t - h0) / (h1 - h0))) : 0;
        g.group.position.set(GA[0] + slide, 0, GA[2]);
        const shake = t > T.dont && t < T.have + 0.1 ? 28 * Math.sin((t - T.dont) * 26) * (1 - kk(T.dont + 0.15, 0.2)) : 0;
        const point = kk(T.have, 0.16) * (1 - kk(T.everyone + 0.4, 0.25));
        const xK = kk(T.everyone + 0.2, 0.2);
        g.set({ hop: hop + 0.35 * bump(T.everyone + 0.22, 0.25), squash: squash + 0.03 * Math.sin(t * 6), turn: 18 + shake + 20 * point, armR: 20 + 120 * backOut(point, 2), reachR: 30 * point,
          armL: 15 + 150 * xK * (1 - kk(T.you2 - 0.2, 0.2)), lookX: 0.3 * point, lookY: -0.2 * point, nod: 4 * Math.sin(t * 5), tilt: 5 * Math.sin(t * 3),
          blink: blinkAt(1), mouth: 'smile', mouthOpen: t < T.everyone ? 0.3 + 0.3 * Math.sin(t * 10) : 0.2 });
      }
    }

    // ================= set B: front door =================
    {
      const openK = backOut(kk(T.you2 - 0.02, 0.18), 1.6);
      S.fd.set({ open: clamp(openK, 0, 1.06) });
      // pro steps out of the doorway onto the mat
      const p = S.pro2;
      const step = smooth(kk(T.you2 + 0.08, 0.32));
      const stepHop = bump(T.you2 + 0.08, 0.32);
      p.group.position.set(lerp(PRO_B0[0], PRO_B1[0], step), lerp(PRO_B0[1], PRO_B1[1], step) + 0.5 * stepHop, lerp(PRO_B0[2], PRO_B1[2], step));
      const got = kk(T.to3 + 0.05, 0.12);
      const gh = t - (T.to3 + 0.12);
      let hop = 0, squash = 0.025 * Math.sin(t * 4.2) - 0.15 * stepHop + 0.25 * Math.max(0, ring(T.you2 + 0.4, 22, 9));
      if (gh > 0 && gh < 0.3) { hop += 0.5 * Math.sin(Math.PI * gh / 0.3); squash -= 0.15 * Math.sin(Math.PI * gh / 0.3); }
      squash += 0.28 * Math.max(0, ring(T.to3 + 0.42, 22, 8));
      const reach = kk(T.matter + 0.08, 0.2);
      const settle = kk(T.someone + 0.35, 0.6);
      p.set({ hop, squash, turn: lerp(10, 32, step), lookX: lerp(0.2, 0.55, step) * (1 - 0.6 * settle), lookY: -0.1, blink: blinkAt(6),
        armR: lerp(10, lerp(30, 22, got), reach), reachR: lerp(0, lerp(80, 62, got), reach) - 8 * settle, armL: 12 + 5 * Math.sin(t * 2),
        mouth: t > T.to3 ? 'smile' : 'flat', mouthOpen: t > T.to3 ? 0.35 - 0.2 * settle : 0, tilt: 3 * Math.sin(t * 2.2) - 6 * settle,
        brow: t < T.to3 ? -8 : 0, nod: 4 * bump(T.someone + 0.1, 0.4) });

      // GREEN hops in from the right with the cup, holds it out on "matter", gives it on "to"
      const g = S.green;
      const in0 = T.you2 + 0.05, in1 = T.have2 + 0.08;
      const ink = clamp((t - in0) / (in1 - in0));
      let ghop = 0.55 * Math.abs(Math.sin(Math.PI * 2 * ink)) * (ink < 1 ? 1 : 0), gsq = 0;
      gsq += 0.28 * Math.max(0, ring(in1, 24, 9));
      g.group.position.set(GB[0] + 3.2 * (1 - smooth(ink)), 0, GB[2]);
      const offer = backOut(kk(T.matter, 0.18), 2);
      const give = kk(T.to3 + 0.05, 0.12);
      const gS = settle;
      g.set({ hop: ghop + 0.25 * bump(T.someone, 0.3), squash: gsq + 0.025 * Math.sin(t * 4.6) - 0.1 * bump(T.someone, 0.3), turn: lerp(-20, -48, smooth(ink)),
        walk: ink < 1 ? ink * 3 : undefined, armR: lerp(18, 26, offer) - 8 * give, reachR: lerp(25, 82, offer) - 50 * give, armL: 15 + 6 * Math.sin(t * 2.5),
        lookX: -0.45 * (1 - 0.5 * gS), lookY: -0.05, blink: blinkAt(3), mouth: 'smile', mouthOpen: 0.15 + 0.15 * bump(T.someone, 0.4), tilt: 3 * Math.sin(t * 2) + 5 * gS });

      // cup: rides GREEN's right hand, then slides into the pro's left hand
      g.group.updateMatrixWorld(true); p.group.updateMatrixWorld(true);
      const ha = new THREE.Vector3(), hb = new THREE.Vector3();
      g.hands.R.getWorldPosition(ha); p.hands.R.getWorldPosition(hb);
      S.home.worldToLocal(ha); S.home.worldToLocal(hb);
      ha.add(new THREE.Vector3(0, -0.1, 0.25)); hb.set(0.1, 1.0, 2.3);
      const pass = smooth(kk(T.to3 - 0.02, 0.2));
      const cp = ha.clone().lerp(hb, pass); cp.y += 0.25 * Math.sin(Math.PI * pass);
      S.cup.group.position.copy(cp);
      const cs = (1 + 0.18 * bump(T.matter, 0.22) + 0.12 * bump(T.to3 + 0.15, 0.2));
      S.cup.group.scale.setScalar(1.1 * cs);
      S.cup.group.visible = t > in0 - 0.05;
      S.cup.set({ steam: 1, t });
      S.cSpark.group.position.copy(cp).add(new THREE.Vector3(0.2, 0.9, 0.2));
      S.cSpark.group.visible = t > T.matter - 0.02 && t < T.matter + 0.8;
      S.cSpark.set({ k: kk(T.matter - 0.02, 0.7) });

      // heart pops on "someone", then beats gently
      const hk = kk(T.someone - 0.02, 0.4);
      S.heart.set({ pop: hk, beat: Math.max(0, t - T.someone - 0.4) * 0.85 });
      S.heart.group.position.set(0.3, 3.75 + 0.06 * Math.sin(t * 2.4) + 0.4 * (1 - smooth(hk)), 1.5);
      S.heart.group.rotation.y = 0.18 * Math.sin(t * 1.6);
      S.heart.group.rotation.z = 0.05 * Math.sin(t * 2.1);
      S.hSpark.group.visible = t > T.someone - 0.02;
      S.hSpark.set({ k: kk(T.someone - 0.02, 1.2) });
    }

    // ================= ctx =================
    if (t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2 + 0.6) {
      const o = spec.o;
      const Wp = (x, y, z) => [o[0] + x, o[1] + y, o[2] + z];
      if (t < T.you2) {
        ctx.bg = { top: '#8fb6e0', mid: '#bcd5ea', bottom: '#e8dcc4' };
        if (t < T.have) { ctx.focus = Wp(GA[0], 1.6, GA[2]); ctx.dof = 1.0; }
        else if (t < T.everyone) { ctx.focus = Wp(0, 2.2, 0.8); ctx.dof = 0.9; }
        else { ctx.focus = Wp(PRO_A[0], 1.6, PRO_A[2]); ctx.dof = 1.0; }
        const xs = t - (T.everyone + 0.2); if (xs > 0 && xs < 0.3) ctx.shake = Math.max(ctx.shake, 0.4 * (1 - xs / 0.3));
        const ls = t - (spec.t0 + 0.05); if (ls > 0 && ls < 0.2) ctx.shake = Math.max(ctx.shake, 0.25 * (1 - ls / 0.2));
      } else {
        ctx.bg = { top: '#f2c38f', mid: '#f6dcb8', bottom: '#e8dcc4' };
        ctx.exposure = 0.98;
        if (t < T.matter) { ctx.focus = Wp(DX - 0.4, 1.6, 0.6); ctx.dof = 0.9; }
        else { ctx.focus = Wp(DX + 0.3, 2.1, 1.5); ctx.dof = lerp(0.9, 0.7, kk(T.someone, 0.8)); }
      }
    }
  },

  camera(ctx, t, spec) {
    const T = cues(ctx, spec), o = spec.o;
    const W = (p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    const P = (pos, target, fov, roll) => ({ pos: W(pos), target: W(target), fov, roll });
    const lin = (k) => k;
    if (t < T.have) {
      // A: low front, GREEN foreground left, crowd + EVERYONE sign behind, pushing in
      return U.poseTrack([[spec.t0 - 0.45, P([1.4, 2.2, 18.5], [-0.3, 3.1, 1.5], 44, -4)], [T.have, P([0.9, 2.3, 16.6], [-0.4, 3.1, 1.5], 44, -1.5)]], t, lin);
    }
    if (t < T.everyone) {
      // B: high 3/4 from the right, crowd wave + sign, arcing
      return U.poseTrack([[T.have, P([6.8, 6.6, 15.5], [0.3, 3.0, 0.2], 42, 5)], [T.everyone, P([5.0, 6.2, 16.2], [0.3, 3.0, 0.2], 42, 2.5)]], t, lin);
    }
    if (t < T.you2) {
      // C: front, X slams, crowd poofs, push in on the lone busy pro
      return U.poseTrack([[T.everyone, P([0, 3.6, 18.5], [0, 3.0, 0.5], 42, 0)], [T.everyone + 0.35, P([0, 3.5, 17.6], [0, 2.9, 0.8], 42, -1)], [T.you2, P([0.6, 2.9, 11.5], [0.2, 2.1, 1.5], 40, -2)]], t, U.easeInOut);
    }
    if (t < T.matter) {
      // D1: door 3/4 from the left, door opens, GREEN hops in
      return U.poseTrack([[T.you2, P([DX - 3.8, 2.7, 11.6], [DX + 0.3, 1.6, 0.8], 42, -4)], [T.matter, P([DX - 3.2, 2.6, 10.6], [DX + 0.4, 1.6, 0.9], 42, -2)]], t, lin);
    }
    // D2: warm two-shot, slow push that settles for the final frame
    const e = (k) => U.easeOut(k);
    return U.poseTrack([[T.matter, P([DX + 1.2, 2.5, 14.4], [DX + 0.3, 1.62, 1.2], 44, 2)], [spec.t1 + 0.5, P([DX + 0.5, 2.3, 12.9], [DX + 0.3, 1.62, 1.2], 44, 0)]], t, e);
  },
};
