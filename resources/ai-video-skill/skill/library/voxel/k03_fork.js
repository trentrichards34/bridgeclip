// LIBRARY REFERENCE (k03_fork.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k03_fork 4.8-7.0 "But they make two very different decisions."
// A: low tracking front shot, RED + GREEN stride down a road side by side ("But they make", glance at each other)
// B on "two": worm's-eye, a signpost slams up between them, arrow "1" then "2" swing in; they look up at their arrow on "very"
// C on "different": high crane, the road forks toward camera, they split down opposite branches with '?' cards overhead;
//   on "decisions" the cards flip: FOR EVERYONE (red) vs FOR ONE CUSTOMER (green) + sparkle + punch.
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const S = {};
const BR = 0.62;                       // branch angle (rad)
const DIR_L = [-Math.sin(BR), Math.cos(BR)], DIR_R = [Math.sin(BR), Math.cos(BR)];
const FACE_L = -BR * 180 / Math.PI, FACE_R = BR * 180 / Math.PI;

function tree(THREE, parent, x, z, s, seed) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); parent.add(g);
  const R = L.rng(seed);
  L.B(0.5, 2.2, 0.5, L.mat(L.C.woodDark), { r: 0.08, y: 1.1, parent: g });
  const gm = L.mat(L.mixHex('#4f9a4a', '#7cbf5a', R()), { scale: 1.2 });
  L.B(2.4, 1.8, 2.4, gm, { r: 0.3, y: 2.9, parent: g });
  L.B(1.6, 1.2, 1.6, gm, { r: 0.25, y: 4.1, x: (R() - 0.5) * 0.4, parent: g });
  return g;
}
function bush(parent, x, z, s, c) { L.B(1.6 * s, 1.0 * s, 1.2 * s, L.mat(c, { scale: 1.3 }), { r: 0.3 * s, x, y: 0.45 * s, z, parent }); }

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const THREE = ctx.THREE;
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root); S.root = root;

    // ground + roads (stem comes from the back, branches fork toward the camera)
    L.B(90, 0.4, 90, L.mat('#7fb35a', { scale: 0.6 }), { r: 0, y: -0.22, z: 0, parent: root });
    const rm = L.mat('#a89a86', { scale: 0.7 }), lm = L.mat(KT.K.cream, { felt: 0.4 }), cm = L.mat('#8f8270');
    L.B(3.4, 0.08, 40, rm, { r: 0, y: 0.0, z: -19.6, parent: root });
    for (const sx of [-1, 1]) L.B(0.25, 0.14, 40, cm, { r: 0.03, x: sx * 1.82, y: 0.02, z: -19.6, parent: root });
    for (let i = 0; i < 9; i++) L.B(0.18, 0.02, 0.9, lm, { r: 0, y: 0.05, z: -2.2 - i * 2.4, parent: root });
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(0, 0, 0.4); g.rotation.y = s * BR; root.add(g);
      L.B(3.2, 0.08, 30, rm, { r: 0, y: 0.005, z: 15, parent: g });
      for (const sx of [-1, 1]) L.B(0.25, 0.14, 30, cm, { r: 0.03, x: sx * 1.72, y: 0.02, z: 15.6, parent: g });
      for (let i = 0; i < 8; i++) L.B(0.18, 0.02, 0.9, lm, { r: 0, y: 0.05, z: 2.2 + i * 2.4, parent: g });
    }
    // signpost (no built-in road: our fork is mirrored)
    S.post = KT.makeSignpost(ctx, { left: '1', right: '2', road: false, h: 4.8 });
    S.postWrap = new THREE.Group(); S.postWrap.position.set(0, 0, 0.2); S.postWrap.add(S.post.group); root.add(S.postWrap);

    // backdrop: skyline + trees + bushes
    S.sky = KT.makeSkyline(ctx, { w: 80, z: -30 }); root.add(S.sky.group);
    const R = L.rng(303);
    const spots = [[-6, -6], [6.5, -7], [-9, -13], [9.5, -12], [-5, -18], [5.5, -20], [-12, -4], [12, -3], [-8, 6], [8.5, 7], [-13, 10], [13, 11], [-4.5, -11], [4.8, -13.5]];
    spots.forEach(([x, z], i) => tree(THREE, root, x, z, 0.8 + R() * 0.35, 40 + i));
    [[-3.2, -3], [3.3, -4], [-3.5, -8], [3.4, -9.5], [-6, 3], [6.2, 3.5]].forEach(([x, z], i) => bush(root, x, z, 0.8 + R() * 0.4, ['#5f9e4c', '#6aa955', '#4c8b40'][i % 3]));
    // little flower dots
    const fm = [L.mat('#f2d35c'), L.mat('#f0f0e6'), L.mat('#e98ca0')];
    for (let i = 0; i < 60; i++) {
      const x = (R() - 0.5) * 30, z = -16 + R() * 28;
      if (Math.abs(x) < 2.6 && z < 1) continue;
      if (z > 0 && Math.abs(Math.abs(x) - Math.tan(BR) * (z - 0.4)) < 2.3) continue;
      L.B(0.22, 0.22, 0.22, fm[i % 3], { r: 0.05, x, y: 0.1, z, parent: root });
    }

    // founders
    S.red = KT.makeFounder(ctx, 'red'); S.green = KT.makeFounder(ctx, 'green');
    root.add(S.red.group); root.add(S.green.group);
    // decision cards (floating above heads, arms up)
    S.cardR = L.makeSign(ctx, { text: 'FOR\nEVERYONE', color: KT.K.red, chart: null, back: '?', w: 2.9, h: 2.4, stick: true, stickH: 2.5, seed: 11 });
    S.cardG = L.makeSign(ctx, { text: 'FOR ONE\nCUSTOMER', color: KT.K.forest, chart: null, back: '?', w: 2.9, h: 2.4, stick: true, stickH: 2.5, seed: 13 });
    root.add(S.cardR.group); root.add(S.cardG.group);
    S.spR = L.makeSparkle(ctx, { size: 0.9, seed: 7 }); S.spG = L.makeSparkle(ctx, { size: 0.9, seed: 9 });
    root.add(S.spR.group); root.add(S.spG.group);
  },

  update(ctx, t, spec) {
    const U = ctx.U, { clamp, inv, backOut, spring, smoother, track, lerp } = U;
    const vis = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6; S.root.visible = vis; if (!vis) return;
    const w = (s) => ctx.wordAt(s, spec.t0) ?? spec.t0;
    const tBut = w('but'), tThey = w('they'), tMake = w('make'), tTwo = w('two'), tVery = w('very'), tDiff = w('different'), tDec = w('decisions');

    S.sky.set({ rise: 1 });

    // ---- signpost: slams up on "two", arrows swing in
    const up = inv(tTwo, tTwo + 0.2, t);
    S.postWrap.scale.set(1 + 0.25 * Math.sin(up * Math.PI) * (1 - up), Math.max(0.001, backOut(up, 2.2)), 1 + 0.25 * Math.sin(up * Math.PI) * (1 - up));
    S.postWrap.visible = t >= tTwo;
    S.post.set({ k: inv(tTwo + 0.04, tTwo + 0.4, t) });
    S.postWrap.rotation.z = Math.sin((t - tTwo) * 22) * 0.05 * Math.exp(-(t - tTwo) * 6) * (t > tTwo ? 1 : 0);

    // ---- founders
    const stopZ = -0.85, sideX = 1.2;
    const walkIn = inv(spec.t0 - 0.5, tThey + 0.06, t);                // stride down the stem
    const zIn = lerp(-5.6, stopZ, 1 - Math.pow(1 - walkIn, 1.6));
    const split = clamp((t - tDiff + 0.08) / 0.5);                      // walk down branches
    const sDist = 1.6 * (1 - Math.pow(1 - split, 1.4));
    const turnK = smoother(inv(tVery + 0.05, tDiff - 0.02, t));
    const spin = 0; void spin;
    const decK = inv(tDec, tDec + 0.16, t);
    const poses = [];
    for (const [c, sd] of [[S.red, -1], [S.green, 1]]) {
      const dir = sd < 0 ? DIR_L : DIR_R, face = sd < 0 ? FACE_L : FACE_R;
      const x0 = sd * sideX, z0 = zIn;
      const x = x0 + dir[0] * sDist + sd * 0.25 * split, z = z0 + dir[1] * sDist;
      c.group.position.set(x, 0, z);
      const walking = t < tThey + 0.06 || (t > tDiff - 0.05 && split < 1);
      const ph = t * 2.4 + (sd > 0 ? 0.5 : 0);
      // land hop on "they"
      const land = inv(tThey + 0.02, tThey + 0.3, t);
      let squash = land > 0 && land < 1 ? Math.sin(land * Math.PI) * 0.35 * (1 - land) : 0;
      let hop = walking ? Math.abs(Math.sin(ph * Math.PI)) * 0.14 : 0;
      // startle hop on "two"
      const st = inv(tTwo + 0.02, tTwo + 0.38, t);
      if (st > 0 && st < 1) { hop += Math.sin(st * Math.PI) * 0.9; squash += st < 0.12 ? 0.3 : (st > 0.85 ? (1 - st) * 1.5 : -0.15); }
      // anticipation before split
      const an = inv(tVery, tVery + 0.3, t);
      if (an > 0 && an < 1) squash += Math.sin(an * Math.PI) * 0.25;
      // decision hop
      if (decK > 0 && decK < 1) { hop += Math.sin(decK * Math.PI) * 0.7; }
      const dl = inv(tDec + 0.16, tDec + 0.36, t); if (dl > 0 && dl < 1) squash += Math.sin(dl * Math.PI) * 0.3;
      const turn = lerp(0, face, turnK) + (t > tDiff ? 0 : 0);
      // look: glance at each other on "make", up at the arrows on "two"/"very", at camera after "different"
      const glance = U.win(t, tMake - 0.02, tTwo, 0.08, 0.05);
      const lookUp = U.win(t, tTwo + 0.05, tDiff, 0.1, 0.1);
      const lookX = -sd * glance * 1 + sd * -0.5 * lookUp;
      const lookY = lookUp * 0.9 - glance * 0.1;
      // arms: swing while walking, raise both to hold the card from "different"
      const raise = backOut(inv(tDiff + 0.02, tDiff + 0.2, t), 1.5);
      const sw = walking ? Math.sin(ph * Math.PI) * 30 : 0;
      const blinkT = (t + (sd > 0 ? 0.37 : 0)) % 1.7;
      c.set({
        hop, squash, turn, lookX, lookY, nod: -lookUp * 8 + (walking ? 4 : 0),
        tilt: Math.sin(t * 5 + sd) * 2 + glance * sd * -6,
        walk: walking ? ph : undefined,
        armL: lerp(15 + Math.max(0, sw) * 0.4, 165, raise), armR: lerp(15 + Math.max(0, -sw) * 0.4, 165, raise),
        reachL: lerp(sw, 8, raise), reachR: lerp(-sw, 8, raise),
        blink: blinkT < 0.09 ? 1 : 0,
        brow: st > 0 && st < 1 ? -16 : (decK > 0 ? (sd < 0 ? 14 : -4) : 0),
        mouthOpen: glance * 0.4 + (decK > 0 ? 0.6 * (1 - inv(tDec + 0.2, tDec + 0.7, t)) : 0),
      });
      poses.push({ x, z, hop, squash });
    }
    // ---- cards above heads
    [[S.cardR, poses[0], S.spR], [S.cardG, poses[1], S.spG]].forEach(([card, p, sp], i) => {
      const pk = inv(tDiff + 0.02, tDiff + 0.2, t);
      const s = Math.max(0.001, backOut(pk, 2.4));
      card.group.visible = pk > 0;
      card.group.scale.setScalar(s);
      card.group.position.set(p.x - (i ? 0.45 : -0.45), 1.95 + p.hop + (1 - p.squash * 0.35 - 1) * 2 + Math.sin(t * 6 + i) * 0.04, p.z + 0.15);
      card.group.rotation.z = (i ? -1 : 1) * 0.06 * Math.sin(t * 4.2 + i);
      const fk = spring(clamp((t - tDec - 0.04) / 0.5) * 0.5 + 0, 2.2, 5.0);
      const flip = t < tDec + 0.04 ? 0 : spring((t - tDec - 0.04) / 0.45, 2.0, 5.5);
      void fk;
      card.pivot.rotation.y = Math.PI * (1 - flip);
      sp.group.position.set(p.x - (i ? 0.45 : -0.45) + (i ? 1.35 : -1.35), 7.0, p.z + 0.5);
      sp.set({ k: clamp((t - tDec - 0.1) / 0.9) });
    });

    // ---- ctx overrides inside the window
    if (t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2) {
      const o = spec.o;
      ctx.bg = { top: '#7fb4e2', mid: '#bfe0f2', bottom: '#eadfc6' };
      if (t < tTwo) ctx.focus = [o[0], 1.4, o[2] + zIn];
      else if (t < tDiff) ctx.focus = [o[0], 3.2, o[2] + 0.2];
      else ctx.focus = [o[0], 3.4, o[2] + poses[0].z];
      ctx.dof = t < tDiff ? 1.0 : 0.8;
      const sh1 = clamp(1 - (t - tTwo - 0.18) / 0.25); if (t > tTwo + 0.15) ctx.shake = Math.max(ctx.shake || 0, 0.35 * sh1);
      const sh2 = clamp(1 - (t - tDec - 0.16) / 0.25); if (t > tDec + 0.14) ctx.shake = Math.max(ctx.shake || 0, 0.25 * sh2);
      if (t > tDec && t < tDec + 0.12) ctx.flash = 0.18 * (1 - (t - tDec) / 0.12);
    }
  },

  camera(ctx, t, spec) {
    const U = ctx.U, o = spec.o, { inv, lerp, smoother } = U;
    const w = (s) => ctx.wordAt(s, spec.t0) ?? spec.t0;
    const tThey = w('they'), tTwo = w('two'), tDiff = w('different'), tDec = w('decisions');
    const P = (p, tg, fov, roll = 0) => ({ pos: [o[0] + p[0], o[1] + p[1], o[2] + p[2]], target: [o[0] + tg[0], o[1] + tg[1], o[2] + tg[2]], fov, roll });
    if (t < tTwo) {
      // A: low tracking two-shot, backing away in front of them
      const walkIn = inv(spec.t0 - 0.5, tThey + 0.06, t);
      const zf = lerp(-5.6, -0.85, 1 - Math.pow(1 - walkIn, 1.6));
      const k = inv(spec.t0 - 0.4, tTwo, t);
      return P([lerp(2.6, 1.4, k), lerp(1.7, 1.4, k), zf + lerp(18.5, 16.5, k)], [0, 1.25, zf], 30, lerp(-4, -1.5, k));
    }
    if (t < tDiff) {
      // B: worm's-eye up at the signpost slamming in, slow push
      const k = smoother(inv(tTwo, tDiff, t));
      return P([lerp(-3.6, -2.4, k), lerp(0.45, 0.7, k), lerp(18.5, 16.5, k)], [0, lerp(2.6, 2.8, k), -0.5], 34, lerp(6, 8, k));
    }
    // C: high crane, the fork opens toward camera; punch on "decisions"
    const k = inv(tDiff, spec.t1 + 0.4, t);
    const pk = smoother(inv(tDec, tDec + 0.14, t));
    const d = lerp(1, 0.93, pk);
    const tg = [0, lerp(3.6, 3.9, k), lerp(1.2, 1.8, k)];
    const pos = [lerp(-0.5, 0.2, k), lerp(9.5, 8.4, k), lerp(27.5, 25.5, k)];
    const pp = [tg[0] + (pos[0] - tg[0]) * d, tg[1] + (pos[1] - tg[1]) * d, tg[2] + (pos[2] - tg[2]) * d];
    return P(pp, tg, 30, lerp(-2, 2, k) + pk * -1.5);
  },
};
