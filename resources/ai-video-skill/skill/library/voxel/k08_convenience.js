// LIBRARY REFERENCE (k08_convenience.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k08_convenience 21.5-25.8 "So instead of just saying their coffee is great, they build everything around convenience."
// SHOT A (in front of NEXT DOOR): an "OUR COFFEE IS GREAT" marquee sign slams down on "So"; GREEN shakes his head on "instead",
//   pulls a red marker on "just"; CUT low on "saying"; bulbs chase on "coffee", wind-up on "is", two slashes X it out on "great".
// SHOT B (the busy pro's front door): CUT on "they"; he checks his watch; GREEN throws icon blocks that slam around him:
//   CLOCK on "build", DOOR on "everything", PHONE stacks on top; CUT wide on "around": CONVENIENCE letter blocks rain into a row
//   in front of him, finished by "convenience" -> he jumps, sparkles + confetti, GREEN waves.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const C = L.C, K = KT.K;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const smooth = (k) => k * k * (3 - 2 * k);
const easeIn = (k) => k * k * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const bump = (t, t0, dur) => { const k = (t - t0) / dur; return k < 0 || k > 1 ? 0 : Math.sin(Math.PI * k); };
const decay = (t, t0, rate = 9) => (t < t0 ? 0 : Math.exp(-(t - t0) * rate));
const popK = (k) => (k <= 0 ? 0.001 : k >= 1 ? 1 : Math.max(0.001, backOut(k, 2.4)));

const BX = 40;                 // shot B lives 40 units to the right of shot A inside the station
const SIGN = { x: -0.25, z: 3.0, w: 3.5, h: 2.6, legs: 2.15 };
const GA = { x: 0.95, z: 4.35 };   // GREEN in shot A
const ICON_S = 0.78;              // icon block size (kit scales icon blocks x1.3)
const WORD_S = 0.52;
const LEDGE_Y = 4.0;

let S = null;

function cues(ctx, spec) {
  const w = (word, d) => ctx.wordAt(word, spec.t0 - 0.1) ?? d;
  return {
    so: w('so', 21.55), instead: w('instead', 21.70), just: w('just', 22.18), saying: w('saying', 22.43),
    coffee: w('coffee', 22.82), is: w('is', 23.07), great: w('great', 23.30), they: w('they', 23.79),
    build: w('build', 23.95), every: w('everything', 24.18), around: w('around', 24.66), conv: w('convenience', 24.98),
  };
}

function makeMarker() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.85, 16), L.mat(C.no));
  body.castShadow = true; g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.22, 16), L.mat('#f3ead8'));
  band.position.y = -0.05; g.add(band);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 14), L.mat('#8e1f1a'));
  tip.position.y = 0.54; g.add(tip);
  return g;
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z) => { o.group.position.set(x, y, z); root.add(o.group); return o; };

    // ---------- world: one long street, skyline, NEXT DOOR shop (A) and the pro's front door (B) ----------
    const street = KT.makeStreet(ctx, { w: 110 }); street.group.position.x = BX / 2; root.add(street.group); street.set({ rise: 0 });
    const sky = at(KT.makeSkyline(ctx, { w: 120, z: -12, seed: 14 }), BX / 2, 0, 0); sky.set({ rise: 1 });
    const shop = at(KT.makeShop(ctx, { preset: 'green' }), 0, 0, 0);
    shop.aframe.group.visible = false;

    // the marquee claim (A)
    const sign = at(KT.makeBigSign(ctx, 'OUR COFFEE IS GREAT', { color: K.green, w: SIGN.w, h: SIGN.h, legs: SIGN.legs, crossStyle: 'x' }), SIGN.x, 0, SIGN.z);
    const greenA = at(KT.makeFounder(ctx, 'green'), GA.x, 0, GA.z);
    const marker = makeMarker(); greenA.holdL(marker, [0, 0.05, 0.25]);
    const sparkMk = at(L.makeSparkle(ctx, { size: 0.7, seed: 4 }), GA.x - 1.3, 1.6, GA.z + 0.4);
    const sparkX = at(L.makeSparkle(ctx, { size: 0.6, n: 4, seed: 11, color: '#ffe0d4' }), SIGN.x + SIGN.w / 2 - 0.1, SIGN.legs + SIGN.h - 0.1, SIGN.z + 0.5);

    // ---------- B: front door + busy pro + blocks ----------
    const home = at(KT.makeFrontDoor(ctx, { number: '42' }), BX, 0, 0);
    // side walls / hedges so the house fills the frame
    for (const s of [-1, 1]) {
      L.B(5, 6.5, 0.5, L.mat('#cdb48c', { scale: 0.8 }), { r: 0.02, x: BX + s * 6.5, y: 3.25, z: -0.6, parent: root });
      L.B(4.6, 1.2, 1.2, L.mat(C.leaf, { scale: 1.6 }), { r: 0.35, x: BX + s * 6.4, y: 0.6, z: 0.4, parent: root });
    }
    const pro = at(KT.makeBusyPro(ctx), BX - 0.15, 0.24, 0.75);
    const greenB = at(KT.makeFounder(ctx, 'green'), BX + 2.55, 0, 2.4);
    // wooden ledge above the door: the CONVENIENCE row lands on it
    const ledge = new THREE.Group(); ledge.position.set(BX, LEDGE_Y, 0.4); root.add(ledge);
    L.B(6.5, 0.2, 0.8, L.mat(C.wood), { r: 0.05, y: -0.1, parent: ledge });
    for (const s of [-1, 1]) L.B(0.18, 0.5, 0.5, L.mat(C.woodDark), { r: 0.04, x: s * 2.7, y: -0.42, z: -0.12, parent: ledge });

    const iconDefs = [
      { ic: 'clock', ink: C.blue, to: V(BX - 1.95, ICON_S * 0.65, 2.15), land: 'build' },
      { ic: 'door', ink: K.green, to: V(BX + 1.25, ICON_S * 0.65, 2.15), land: 'every' },
      { ic: 'phone', ink: '#c88a12', to: V(BX - 1.95, ICON_S * 1.95, 2.15), land: 'every2' },
    ];
    const icons = iconDefs.map((d, i) => {
      const b = at(KT.makeLetterBlocks(ctx, '', { size: ICON_S, icons: [d.ic], inks: [d.ink], seed: 40 + i }), 0, 0, 0);
      b.set({ k: 1 });
      return { ...d, b, blk: b.blocks[0] };
    });
    const word = at(KT.makeLetterBlocks(ctx, 'CONVENIENCE', { size: WORD_S, gap: 0.04, seed: 8 }), BX, LEDGE_Y, 0.45);
    const sparkPro = at(L.makeSparkle(ctx, { size: 0.8, n: 5, seed: 21 }), BX + 0.7, 2.7, 1.3);
    const sparkWord = at(L.makeSparkle(ctx, { size: 0.8, n: 4, seed: 33, color: '#fff6d0' }), BX + 3.0, LEDGE_Y + 0.6, 0.9);
    const conf = at(L.makeConfetti(ctx, { n: 60, spread: 3, height: 5, colors: [K.green, C.gold, '#ffffff', C.blue, C.coral] }), BX - 2.4, 2.4, 2.2);
    const conf2 = at(L.makeConfetti(ctx, { n: 60, spread: 3, height: 5, seed: 19, colors: [K.green, C.gold, '#ffffff', C.blue, C.coral] }), BX + 2.4, 2.4, 2.2);

    S = { conf2, ledge, root, street, shop, sign, greenA, marker, sparkMk, sparkX, home, pro, greenB, icons, word, sparkPro, sparkWord, conf };
  },

  update(ctx, t, spec) {
    if (!S) return;
    const on = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    S.root.visible = on; if (!on) return;
    const T = cues(ctx, spec);
    const inside = t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2;
    const shotB = t >= T.they;
    const o = spec.o;

    S.shop.set({ shutter: 0, open: 0.0, sign: 1, t });

    // ================= SHOT A =================
    {
      const { sign, greenA: g } = S;
      // sign drops in and slams on "So"
      const land = T.so;
      const kd = inv(land - 0.22, land, t);
      const y = t < land ? lerp(7, 0, easeIn(kd)) : 0.12 * bump(t, land, 0.16);
      const sq = decay(t, land, 11) * (t >= land ? 1 : 0);
      const hit1 = T.great + 0.02, hit2 = T.great + 0.14;
      const knock = (t >= hit1 ? decay(t, hit1, 7) : 0) + (t >= hit2 ? decay(t, hit2, 7) : 0);
      sign.group.position.set(SIGN.x, y, SIGN.z);
      sign.group.scale.set(1 + 0.08 * sq, 1 - 0.12 * sq, 1);
      sign.group.rotation.set(0, 0.06 + 0.04 * Math.sin(t * 1.3), (t < land ? 0.2 * (1 - kd) : 0) + 0.07 * Math.sin((t - land) * 22) * decay(t, land, 6) + 0.06 * knock * Math.sin((t - hit1) * 30) + (t > hit2 ? -0.035 * smooth(inv(hit2, hit2 + 0.3, t)) : 0));
      // bulbs: on at the slam, chase on "coffee", die after the X
      const lit = t < land ? 0 : t < T.great + 0.25 ? 1 : 1 - smooth(inv(T.great + 0.25, T.great + 0.5, t)) * (0.85 + 0.15 * Math.sin(t * 60));
      const chase = t >= T.coffee ? (t - T.coffee) * 3 : t * 0.4;
      // pulse on "coffee"
      const pulse = bump(t, T.coffee, 0.22);
      sign.board.scale.setScalar(1 + 0.06 * pulse);
      sign.set({ lit, t: chase, cross: inv(hit1 - 0.07, hit1, t) * 0.5 + inv(hit2 - 0.07, hit2, t) * 0.5 });
      if (inside && t >= land && t < land + 0.3) ctx.shake = Math.max(ctx.shake, 0.5 * (1 - (t - land) / 0.3));
      if (inside && t >= hit1 && t < hit2 + 0.25) ctx.shake = Math.max(ctx.shake, 0.35 * decay(t, t >= hit2 ? hit2 : hit1, 10));

      // GREEN: startle on the slam, head-shake on "instead", marker on "just", wind-up on "is", two slashes on "great"
      const startle = bump(t, land, 0.3);
      const shakeHead = t >= T.instead && t < T.just ? Math.sin((t - T.instead) * Math.PI * 2 * 4.2) * smooth(inv(T.instead, T.instead + 0.06, t)) * (1 - inv(T.just - 0.08, T.just, t)) : 0;
      const mk = popK(inv(T.just, T.just + 0.22, t));
      S.marker.scale.setScalar(mk); S.marker.visible = t >= T.just;
      S.marker.rotation.set(0.3, 0, 0.5);
      // arm: 0 = low, 1 = raised high (wind-up)
      let armL = 20, reachL = 10;
      if (t >= T.just) { armL = lerp(20, 95, backOut(inv(T.just, T.just + 0.25, t))); reachL = lerp(10, 55, smooth(inv(T.just, T.just + 0.25, t))); }
      if (t >= T.is - 0.05) { armL = lerp(95, 165, backOut(inv(T.is - 0.05, T.is + 0.18, t))); reachL = lerp(55, 25, inv(T.is - 0.05, T.is + 0.18, t)); }
      if (t >= hit1 - 0.08) {   // slash down, up, down
        const a = inv(hit1 - 0.08, hit1, t), b = inv(hit1 + 0.02, hit2 - 0.08, t), c = inv(hit2 - 0.08, hit2, t);
        armL = t < hit1 ? lerp(165, 40, easeIn(a)) : t < hit2 - 0.08 ? lerp(40, 160, easeOut(b)) : lerp(160, 40, easeIn(c));
        reachL = t < hit1 ? lerp(25, 85, a) : t < hit2 - 0.08 ? lerp(85, 30, b) : lerp(30, 85, c);
      }
      if (t > hit2 + 0.15) { const r = smooth(inv(hit2 + 0.15, hit2 + 0.45, t)); armL = lerp(40, 70, r); reachL = lerp(85, 30, r); }
      const proud = t > hit2 + 0.1 ? smooth(inv(hit2 + 0.1, hit2 + 0.35, t)) : 0;
      const windup = bump(t, T.is - 0.05, 0.3);
      let blink = Math.max(bump(t, 21.9, 0.12), bump(t, 22.95, 0.12), bump(t, 23.62, 0.12));
      g.set({
        hop: 0.35 * startle + 0.05 * Math.max(0, Math.sin(t * 9)) + 0.18 * bump(t, hit2, 0.25),
        squash: -0.2 * startle + 0.25 * windup + 0.3 * decay(t, hit1, 12) * (t > hit1 ? 1 : 0) + 0.3 * decay(t, hit2 + 0.2, 10) * (t > hit2 + 0.2 ? 1 : 0),
        turn: lerp(-28, -8, proud) + 32 * shakeHead,
        tilt: 4 * Math.sin(t * 2.7) + (t >= T.instead && t < T.just ? -6 : 0),
        lookX: t < land ? 0 : t < T.instead ? -0.75 : t < T.just ? 0.2 : t < hit2 + 0.1 ? -0.7 : lerp(-0.7, 0.15, proud),
        lookY: t >= T.saying && t < hit2 + 0.1 ? 0.55 : 0,
        armL, reachL, armR: 15 + 35 * proud, blink,
        brow: t >= T.instead && t < T.just ? -12 : t >= T.is - 0.05 && t < hit2 + 0.1 ? 14 : 0,
        mouth: t >= T.instead && t < T.just ? 'flat' : t >= hit1 ? 'teeth' : 'smile',
        mouthOpen: t >= T.instead && t < T.just ? 0 : 0,
      });
      S.sparkMk.set({ k: inv(T.just, T.just + 0.55, t) });
      S.sparkX.set({ k: inv(hit2, hit2 + 0.6, t) });
      if (inside && !shotB) {
        ctx.focus = [o[0] + SIGN.x, SIGN.legs + SIGN.h * 0.45, o[2] + SIGN.z + 0.3];
        ctx.dof = 0.9;
        ctx.bg = { top: '#8fb8de', mid: '#bcd6ea', bottom: '#efe2c8' };
      }
    }

    // ================= SHOT B =================
    {
      const { pro, greenB: g, icons, word } = S;
      S.home.set({ open: 0 });
      const landT = { build: T.build + 0.02, every: T.every + 0.02, every2: T.every + 0.24 };
      // icon blocks: thrown by GREEN in an arc from his raised hand, slam with squash
      const hand = V(BX + 2.6, 3.4, 3.3);
      let lastLand = -9;
      icons.forEach((d, i) => {
        const tl = landT[d.land], dur = 0.26, k = inv(tl - dur, tl, t);
        const vis = t >= tl - dur;
        d.b.group.visible = vis; if (!vis) return;
        const blk = d.blk;
        const e = smooth(k);
        blk.g.position.lerpVectors(hand, d.to, e);
        blk.g.position.y += Math.sin(Math.PI * e) * 1.6 * (1 - 0.0);
        const sp = 1 - e;
        blk.g.rotation.set(sp * 3.2, sp * (i % 2 ? -2.4 : 2.4), sp * 1.5);
        const sq = t >= tl ? decay(t, tl, 13) : 0;
        blk.g.scale.set(1.3 * (1 + 0.22 * sq), 1.3 * (1 - 0.3 * sq), 1.3 * (1 + 0.22 * sq));
        if (t >= tl) { blk.g.position.y = d.to.y - ICON_S * 0.65 * 0.3 * sq; lastLand = Math.max(lastLand, tl); }
        if (inside && t >= tl && t < tl + 0.25) ctx.shake = Math.max(ctx.shake, 0.3 * (1 - (t - tl) / 0.25));
      });
      // CONVENIENCE rains in from "around" to just after "convenience"
      const w0 = T.around - 0.04, w1 = T.conv + 0.16;
      word.group.visible = t >= w0;
      { const kl = inv(w0 - 0.2, w0 + 0.05, t); S.ledge.visible = kl > 0; S.ledge.scale.set(Math.max(0.001, popK(kl)), 1, 1); }
      word.set({ k: inv(w0, w1, t) });
      const wordDone = w1;
      const wb = t >= wordDone ? decay(t, wordDone, 8) : 0;
      word.group.scale.set(1 + 0.05 * wb, 1 - 0.08 * wb, 1);
      if (inside && t >= wordDone && t < wordDone + 0.25) ctx.shake = Math.max(ctx.shake, 0.3 * (1 - (t - wordDone) / 0.25));
      S.sparkWord.set({ k: 0 });
      S.sparkPro.set({ k: inv(T.conv + 0.02, T.conv + 0.75, t) });
      S.conf.set({ k: inv(T.conv + 0.05, T.conv + 1.6, t) });
      S.conf2.set({ k: inv(T.conv + 0.1, T.conv + 1.65, t) });

      // the busy pro
      const tb = t - T.they;
      const watch = t < T.build ? smooth(inv(T.they - 0.2, T.they + 0.08, t)) : 1 - smooth(inv(T.build, T.build + 0.1, t));
      const jolt = (tl) => bump(t, tl, 0.28);
      const j1 = jolt(landT.build), j2 = jolt(landT.every), j3 = jolt(landT.every2);
      const joy = t >= T.conv ? 1 : 0;
      const jumpK = inv(T.conv, T.conv + 0.42, t), jump = t >= T.conv && jumpK < 1 ? Math.sin(Math.PI * jumpK) : 0;
      const after = t >= T.conv + 0.42 ? 0.12 * Math.abs(Math.sin((t - T.conv - 0.42) * Math.PI * 3)) : 0;
      let lookX = 0, lookY = 0;
      if (t < T.build) { lookX = -0.35; lookY = -0.6; }
      else if (t < landT.every) { lookX = -0.8; lookY = -0.2; }
      else if (t < landT.every2) { lookX = 0.8; lookY = -0.2; }
      else if (t < T.around) { lookX = -0.6; lookY = 0.5; }
      else if (t < T.conv) { lookX = 0.0; lookY = -0.5; }
      else { lookX = 0.05; lookY = 0.1; }
      pro.set({
        hop: 0.25 * (j1 + j2 + j3) * 0.6 + 0.75 * jump + after + 0.03 * Math.max(0, Math.sin(t * 8)),
        squash: -0.15 * (j1 + j2 + j3) + (jump > 0 ? -0.25 * jump : 0) + 0.3 * (t >= T.conv + 0.42 ? decay(t, T.conv + 0.42, 10) : 0) + 0.25 * bump(t, T.conv - 0.12, 0.12),
        armL: joy ? 160 + 12 * Math.sin(t * 18) : lerp(18, 75, watch) + 40 * (j1 + j2 + j3) * 0.5,
        reachL: joy ? 0 : lerp(0, 70, watch),
        armR: joy ? 155 + 12 * Math.sin(t * 18 + 1) : 10 + 30 * (j1 + j2 + j3) * 0.5,
        nod: watch * 10, tilt: 3 * Math.sin(t * 2.4) + (t >= T.around && t < T.conv ? 5 * Math.sin(t * 7) : 0),
        lookX, lookY,
        brow: t < T.build ? -12 : 0,
        blink: Math.max(bump(t, 24.45, 0.12), bump(t, 25.5, 0.12)),
        mouth: t < T.build ? 'flat' : t < T.around ? 'o' : t < T.conv ? 'smile' : 'teeth',
        mouthOpen: t >= T.build && t < T.around ? 0.4 : 0,
      });
      // GREEN: throws on each icon land, then claps/waves at the end
      const throwA = (tl) => { const k = inv(tl - 0.34, tl - 0.12, t); return k > 0 && k < 1 ? Math.sin(Math.PI * k) : 0; };
      const thr = Math.max(throwA(landT.build), throwA(landT.every), throwA(landT.every2));
      const wave = t >= T.around ? 1 : 0;
      g.set({
        turn: wave ? lerp(-40, -10, smooth(inv(T.conv, T.conv + 0.3, t))) : -40,
        armR: wave ? (t >= T.conv ? 150 + 20 * Math.sin(t * 16) : 120 + 25 * Math.sin(t * 9)) : 40 + 120 * thr,
        reachR: wave ? 20 : 30 + 40 * thr,
        armL: 25 + (t >= T.conv ? 30 : 0), hop: 0.12 * thr + (t >= T.conv ? 0.15 * Math.abs(Math.sin((t - T.conv) * Math.PI * 3.2)) : 0),
        squash: 0.2 * bump(t, landT.build - 0.42, 0.12),
        lookX: -0.7, lookY: 0.1, mouth: 'smile', tilt: 5 * Math.sin(t * 3),
        blink: bump(t, 24.9, 0.12),
      });
      if (inside && shotB) {
        ctx.focus = t < T.around ? [o[0] + BX - 0.4, 1.7, o[2] + 1.2] : [o[0] + BX, 2.6, o[2] + 1.0];
        ctx.dof = t < T.around ? 0.9 : 0.6;
        ctx.bg = { top: '#8fb8de', mid: '#bcd6ea', bottom: '#efe2c8' };
      }
    }
  },

  camera(ctx, t, spec) {
    const T = cues(ctx, spec), o = spec.o;
    const W = (p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
    const dr = (s) => Math.sin(t * 0.9 + s) * 0.12 + Math.sin(t * 1.7 + s * 2) * 0.06;
    let pos, target, fov = 35, roll = 0;
    if (t < T.saying) {
      // A1: establishing push on sign + GREEN, NEXT DOOR sign above
      const k = inv(spec.t0 - 0.4, T.saying, t);
      pos = [lerp(1.8, 0.7, k) + dr(1), lerp(3.4, 2.8, k), lerp(20.5, 18.0, smooth(k))];
      target = [lerp(0.4, 0.2, k), lerp(2.55, 2.45, k), 3.2];
      roll = lerp(3, -1.5, k);
    } else if (t < T.they) {
      // A2: low, from the left, looking up at the sign; slow arc + punch-in on "great"
      const k = inv(T.saying, T.they, t);
      const punch = 1.0 * easeOut(inv(T.great, T.great + 0.18, t));
      pos = [lerp(-4.0, -3.0, k) + dr(2), lerp(0.9, 1.1, k), lerp(16.8, 15.6, k) - punch];
      target = [lerp(0.1, 0.2, k), 2.6, 3.3];
      roll = lerp(-5, -3, k) + 2 * Math.sin((t - T.great) * 30) * decay(t, T.great, 6) * (t > T.great ? 1 : 0);
    } else if (t < T.around) {
      // B1: low medium on the pro at his door, push in + dutch drift
      const k = inv(T.they, T.around, t);
      pos = [BX + lerp(0.7, 0.1, k) + dr(3), lerp(1.4, 1.6, k), lerp(16.4, 14.8, smooth(k))];
      target = [BX + lerp(-0.1, -0.2, k), lerp(1.75, 1.7, k), 1.4];
      roll = lerp(4, 2, k);
    } else {
      // B2: wide arc onto the house: CONVENIENCE on the ledge, the pro + icon blocks below, GREEN at the right
      const k = inv(T.around, spec.t1 + 0.4, t);
      const ka = smooth(inv(T.around, T.conv + 0.3, t));
      pos = [BX + lerp(2.2, 0.0, ka) + dr(4) * 0.15, lerp(3.2, 2.3, ka), lerp(21.5, 19.5, ka) - 0.3 * smooth(inv(T.conv + 0.3, spec.t1 + 0.4, t))];
      target = [BX + lerp(0.5, 0.0, ka), lerp(2.2, 1.95, ka), 1.4];
      roll = lerp(-4, 0, ka) + 0.4 * Math.sin(k * 6);
    }
    return { pos: W(pos), target: W(target), fov, roll };
  },
};
