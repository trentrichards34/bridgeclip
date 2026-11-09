// LIBRARY REFERENCE (k11_reason.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k11_reason 32.2-37.3 "The second has a clear reason for a specific customer to choose them, and that difference matters."
// Set 1 (NEXT DOOR storefront): A: the busy pro sprints along the sidewalk to NEXT DOOR; "second" sign bounces + GREEN hops/waves,
//   "has" door swings open. "clear": HARD CUT close, a big REASON card slams down above the pro; "reason" clock pops,
//   + pops, "for" door pops, "=" and TIME SAVED stamp slam; "specific": lock-on reticle snaps round the pro.
//   "customer": HARD CUT low hero angle, card clicks down onto him (gold ring pulse, reticle turns green);
//   "choose": GREEN tosses a NEXT DOOR cup to him; "them": he catches it, arms up, big green check + sparkle.
// Set 2 (split, at local x +80): "and": HARD CUT wide on both shops side by side with a balance scale between; a red cup drops
//   into the CORNER CAFE pan (tips left); "difference": the REASON card drops into the NEXT DOOR pan; "matters": scale SLAMS to
//   GREEN (shake, flash, confetti), GREEN cheers, RED slumps, crash zoom on the NEXT DOOR pan.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import * as RK from './k11_reason_kit.js';
import * as U from '/engine/core/util.js';

const C = L.C, K = KT.K;
const P = [0.0, 0, 2.8];        // busy pro stop point (set 1)
const G = [2.5, 0, 1.9];        // GREEN by the door (set 1)
const CY = 4.05, CY2 = 3.6;     // REASON card centre height (slammed / locked)
const DX = 80;                  // set 2 offset
const SS = 0.52;                // shop scale in set 2
const SC = 1.15;                // balance scale size
const PED = 0.9;                // pedestal under the scale (pans clear the founders' heads)

let S = null;

function cues(ctx, spec) {
  const w = (word, d) => ctx.wordAt(word, spec.t0) ?? d;
  return {
    second: w('second', 32.38), has: w('has', 32.70), clear: w('clear', 33.18), reason: w('reason', 33.42), for: w('for', 33.74),
    specific: w('specific', 34.06), customer: w('customer', 34.46), choose: w('choose', 35.02), them: w('them', 35.26),
    and: w('and', 35.82), difference: w('difference', 36.06), matters: w('matters', 36.46),
  };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, parent = root) => { o.group.position.set(x, y, z); parent.add(o.group); return o; };

    // ---------- set 1: NEXT DOOR storefront ----------
    const street = KT.makeStreet(ctx, { w: 50, lamps: 4 }); root.add(street.group);
    const spots = [[-9.5, 6.4], [-14, 6.2], [9.5, 6.4], [14, 6.2], [-20, 6.4], [-24, 6.2], [20, 6.4], [24, 6.2]];
    street.props.forEach((p, i) => { const s = spots[i]; if (s) { p.g.position.x = s[0]; p.g.position.z = s[1]; } });
    const sky = KT.makeSkyline(ctx, { w: 60, z: -11, seed: 13 }); root.add(sky.group);
    const shop = at(KT.makeShop(ctx, { preset: 'green', aframeX: -3.9 }), 0, 0, 0);
    const shopL = at(KT.makeShop(ctx, { preset: 'red' }), -10.2, 0, 0);   // neighbour at the left edge (continuity)
    const pro = at(KT.makeBusyPro(ctx), ...P);
    const green = at(KT.makeFounder(ctx, 'green'), ...G);
    const gcup = KT.makeCup(ctx, { color: K.green, icon: 'door', size: 0.8 }); green.holdL(gcup.group, [0, -0.05, 0.3]);
    const pcup = KT.makeCup(ctx, { color: K.green, icon: 'door', size: 0.8 }); pro.holdL(pcup.group, [0, -0.05, 0.3]);
    const fcup = KT.makeCup(ctx, { color: K.green, icon: 'door', size: 0.8 }); root.add(fcup.group);
    const card = at(RK.makeReasonCard(ctx), P[0], CY, P[2] + 0.2);
    const ret = at(RK.makeReticle(ctx, { w: 3.1, h: 2.6 }), P[0], 1.35, P[2] + 1.0);
    const ringM = L.glowMat(C.gold, 1.4, { transparent: true, opacity: 0, depthWrite: false });
    const lockRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 48), ringM); lockRing.position.set(P[0], CY2, P[2] + 0.3); root.add(lockRing);
    const check = L.makeBigCheck(ctx, { size: 1.3 }); check.group.position.set(P[0] + 1.55, 3.0, P[2] + 0.7); root.add(check.group);
    const spark1 = L.makeSparkle(ctx, { size: 0.9, seed: 31 }); spark1.group.position.set(P[0] + 2.3, 3.9, P[2] + 0.4); root.add(spark1.group);
    const conf1 = L.makeConfetti(ctx, { n: 40, spread: 3, height: 4, colors: [K.green, C.gold, '#ffffff', C.coral], seed: 19 }); conf1.group.position.set(P[0] + 1.0, 5.4, P[2] + 0.8); root.add(conf1.group);

    // ---------- set 2: both shops + the balance scale ----------
    const s2 = new THREE.Group(); s2.position.set(DX, 0, 0); root.add(s2);
    const street2 = KT.makeStreet(ctx, { w: 50, lamps: 4, seed: 8 }); s2.add(street2.group);
    const sky2 = KT.makeSkyline(ctx, { w: 50, z: -8, seed: 21 }); sky2.group.scale.setScalar(0.8); s2.add(sky2.group);
    const bt = at(KT.makeShop(ctx, { preset: 'red' }), -2.6, 0, 0, s2); bt.group.scale.setScalar(SS);
    const ds = at(KT.makeShop(ctx, { preset: 'green' }), 2.6, 0, 0, s2); ds.group.scale.setScalar(SS);
    L.B(0.5, 4.6, 0.6, L.mat('#d8c7a5', { scale: 0.8 }), { r: 0.06, x: 0, y: 2.3, z: 0.0, parent: s2 });   // seam post between shops
    const scale = at(KT.makeScale(ctx, { left: 'CORNER CAFE', right: 'NEXT DOOR' }), 0, PED, 4.2, s2); scale.group.scale.setScalar(SC);
    L.B(2.9, PED, 1.9, L.mat(C.wood, { scale: 1.2 }), { r: 0.08, y: PED / 2, z: 4.2, parent: s2 });
    L.B(3.1, 0.14, 2.1, L.mat(K.gold, { rough: 0.45, metal: 0.3 }), { r: 0.04, y: PED - 0.05, z: 4.2, parent: s2 });
    const rcup = KT.makeCup(ctx, { color: K.red, icon: 'cup', size: 0.95 }); scale.panL.add(rcup.group);
    const card2 = RK.makeReasonCard(ctx, { seed: 9 }); card2.group.scale.setScalar(0.4); scale.panR.add(card2.group);
    const red2 = at(KT.makeFounder(ctx, 'red'), -2.6 + 2.1 * SS, 0, 0.75, s2); red2.group.scale.setScalar(0.6);
    const green2 = at(KT.makeFounder(ctx, 'green'), 2.6 + 2.1 * SS, 0, 0.75, s2); green2.group.scale.setScalar(0.6);
    const spark2 = L.makeSparkle(ctx, { size: 1.1, seed: 47 }); root.add(spark2.group);
    const conf2 = L.makeConfetti(ctx, { n: 70, spread: 4, height: 5, colors: [K.green, C.gold, '#ffffff', K.forest], seed: 23 }); root.add(conf2.group);

    S = { root, street, sky, shop, shopL, pro, green, gcup, pcup, fcup, card, ret, lockRing, ringM, check, spark1, conf1,
      street2, sky2, bt, ds, scale, rcup, card2, red2, green2, spark2, conf2 };
  },

  update(ctx, t, spec) {
    const T = cues(ctx, spec);
    S.root.visible = !(t < spec.t0 - 0.6 || t > spec.t1 + 0.6);
    if (!S.root.visible) return;
    const { clamp, backOut, smooth, lerp, easeOut, easeIn } = U;
    const kk = (a, d) => clamp((t - a) / d);
    const blinkAt = (s) => (((t * 0.9 + s * 0.37) % 1.7) < 0.08 ? 1 : 0);
    const ring = (a, f = 22, dmp = 8) => (t > a ? Math.exp(-dmp * (t - a)) * Math.cos((t - a) * f) : 0);
    const bump = (a, d) => { const q = (t - a) / d; return q > 0 && q < 1 ? Math.sin(Math.PI * q) : 0; };

    // ================= set 1 =================
    S.street.set({ rise: 1 }); S.sky.set({ rise: 1 });
    S.shopL.set({ shutter: 0, open: 0, sign: 1, t });
    S.shop.set({ shutter: 0, open: clamp(backOut(kk(T.has, 0.22), 1.8), 0, 1.1) * 0.9, sign: 1, t });
    S.shop.sign.scale.setScalar(1 + 0.16 * bump(T.second, 0.22) + 0.05 * Math.max(0, ring(T.second + 0.22, 24, 9)));
    S.shop.sign.rotation.z = 0.04 * ring(T.second, 18, 5);

    // ---- busy pro: sprint in, skid, face camera ----
    {
      const p = S.pro, ta = spec.t0 - 0.55, tb = T.clear - 0.12;
      const run = clamp((t - ta) / (tb - ta));
      const x = lerp(-8.5, P[0], easeOut(run));
      p.group.position.set(x, 0, P[2]);
      const arrived = t >= tb;
      const turnK = kk(tb - 0.04, 0.16);
      let pose;
      if (!arrived) {
        const hp = p.hurry(t * 1.5, 1);
        pose = { ...hp, hop: hp.hop * 1.6, lean: 14, turn: 62, armR: 8, lookX: 0.4, mouth: 'flat', brow: -12, blink: blinkAt(2) };
      } else {
        // looking up at the card, reacting per word
        const land = t - (T.clear + 0.16);
        let hop = Math.max(0, 0.05 * Math.sin(t * 6.5)), squash = 0.03 * Math.sin(t * 6.5) + 0.3 * Math.max(0, ring(tb, 24, 9));
        hop += 0.45 * bump(T.clear + 0.16, 0.26); squash -= 0.18 * bump(T.clear + 0.16, 0.26);
        squash += 0.3 * Math.max(0, ring(T.clear + 0.42, 24, 9));
        const lockN = bump(T.customer + 0.08, 0.25);
        const catchK = kk(T.them - 0.06, 0.16);
        hop += 0.55 * bump(T.them, 0.3); squash -= 0.15 * bump(T.them, 0.3); squash += 0.3 * Math.max(0, ring(T.them + 0.3, 22, 9));
        const reachForCup = kk(T.choose, 0.12) * (1 - catchK);
        pose = { hop, squash, turn: lerp(62, 0, backOut(turnK, 2)), lean: lerp(-12, 0, smooth(kk(tb, 0.25))),
          lookX: t < T.choose ? 0 : 0.5 * (1 - catchK), lookY: t < T.customer ? 0.7 : 0.3, nod: -10 * (t < T.customer ? 1 : 0) + 14 * lockN,
          tilt: 5 * Math.sin(t * 3.2), blink: blinkAt(5), mouth: land > 0 ? 'o' : 'flat', mouthOpen: 0.2,
          armL: 18 + 50 * reachForCup + 125 * backOut(catchK, 2), reachL: 40 * reachForCup, armR: 12 + 110 * backOut(catchK, 2), brow: land > 0 && t < T.customer ? -8 : 0 };
        if (t > T.customer) pose.mouth = 'smile';
        if (catchK > 0) { pose.mouth = 'o'; pose.mouthOpen = 0.3; pose.lookY = 0.2; }
      }
      p.set(pose);
      S.pcup.group.visible = t >= T.them - 0.04;
      S.pcup.set({ steam: 1, t });
    }

    // ---- GREEN at the door: hop + wave on "second", toss the cup on "choose", cheer on "them" ----
    {
      const g = S.green;
      let hop = Math.max(0, 0.05 * Math.sin(t * 6 + 1)), squash = 0.03 * Math.sin(t * 6 + 1);
      hop += 0.6 * bump(T.second, 0.28); squash -= 0.18 * bump(T.second, 0.28); squash += 0.3 * Math.max(0, ring(T.second + 0.28, 24, 9));
      hop += 0.5 * bump(T.them + 0.08, 0.28); squash += 0.25 * Math.max(0, ring(T.them + 0.36, 24, 9));
      const wave = t < T.clear ? 1 : 0;
      const toss = bump(T.choose - 0.06, 0.3);
      const cheer = kk(T.them, 0.15);
      g.set({ hop, squash, turn: t < T.clear ? -10 : -30, tilt: 6 * Math.sin(t * 3.4), nod: 4 * Math.sin(t * 5),
        armR: wave ? 120 + 30 * Math.sin(t * 16) : 15 + 130 * backOut(cheer, 2), armL: 35 + 50 * toss + 30 * (t > T.customer && t < T.choose ? 1 : 0) + 90 * cheer,
        reachL: 50 * toss + 40 * (t > T.customer && t < T.choose ? 1 : 0), lookX: t < T.clear ? 0.3 : -0.5, blink: blinkAt(1), mouth: 'smile', mouthOpen: 0.3 + 0.3 * (wave ? Math.abs(Math.sin(t * 9)) : cheer) });
      S.gcup.group.visible = t < T.choose + 0.06;
      S.gcup.set({ steam: 1, t });
    }

    // ---- flying cup (GREEN's hand -> pro's hand) ----
    {
      S.root.updateMatrixWorld(true);
      const f0 = T.choose + 0.06, f1 = T.them - 0.04;
      const fly = (t - f0) / (f1 - f0);
      S.fcup.group.visible = fly > 0 && fly < 1;
      if (S.fcup.group.visible) {
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        S.gcup.group.getWorldPosition(a); S.pcup.group.getWorldPosition(b);
        S.root.worldToLocal(a); S.root.worldToLocal(b);
        const k = smooth(clamp(fly));
        S.fcup.group.position.lerpVectors(a, b, k); S.fcup.group.position.y += 1.3 * Math.sin(Math.PI * k);
        S.fcup.group.rotation.set(0, 0, -6.28 * k);
        S.fcup.group.scale.setScalar(0.8);
        S.fcup.set({ steam: 0, t });
      }
    }

    // ---- REASON card: slam on "clear", parts pop per word, lock down on "customer" ----
    {
      const fall = kk(T.clear - 0.02, 0.18);
      const lock = kk(T.customer, 0.14);
      let y = lerp(CY + 6, CY, easeIn(fall));
      y = lerp(y, CY2, backOut(lock, 2.5));
      S.card.group.position.set(P[0], y, P[2] + 0.2);
      const imp = Math.max(0, ring(T.clear + 0.16, 26, 9)) + Math.max(0, ring(T.customer + 0.14, 30, 10));
      S.card.inner.scale.set(1 + 0.12 * imp, 1 - 0.18 * imp, 1);
      S.card.group.rotation.z = (1 - fall) * 0.25 + 0.03 * Math.sin(t * 3) * (1 - lock) + 0.04 * ring(T.customer + 0.14, 20, 8);
      S.card.set({ pop: fall > 0 ? 1 : 0, parts: [kk(T.reason, 0.2), kk(T.reason + 0.16, 0.18), kk(T.for, 0.2), kk(T.for + 0.08, 0.16), kk(T.for + 0.16, 0.2)] });
      S.card.group.visible = t >= T.clear - 0.02 && t < T.and;
      // gold lock ring pulse
      const rk = kk(T.customer + 0.12, 0.45);
      S.lockRing.visible = rk > 0 && rk < 1;
      S.lockRing.scale.set(1.9 + 0.7 * easeOut(rk), 1.3 + 0.5 * easeOut(rk), 1);
      S.ringM.opacity = 0.55 * (1 - rk);
      // reticle
      const rt = kk(T.specific, 0.22);
      S.ret.set({ k: rt, lock: kk(T.customer, 0.12) });
      S.ret.group.visible = rt > 0 && t < T.choose;
      S.ret.group.rotation.z = 0.25 * (1 - smooth(rt));
      S.ret.group.position.set(P[0], 1.35 + 0.04 * Math.sin(t * 9), P[2] + 1.0);
      // big check + sparkle + confetti on "them"
      const ck = kk(T.them + 0.02, 0.24);
      S.check.group.visible = ck > 0 && t < T.and;
      S.check.group.scale.setScalar(Math.max(0.001, backOut(ck, 2.6)));
      S.check.group.rotation.z = -0.3 * (1 - ck) + 0.05 * Math.sin(t * 5);
      S.spark1.set({ k: kk(T.them, 0.8) }); S.spark1.group.visible = t > T.them && t < T.and;
      S.conf1.set({ k: kk(T.them, 1.4) }); S.conf1.group.visible = t > T.them && t < T.and;
    }

    // ================= set 2 =================
    {
      S.street2.set({ rise: 0 }); S.sky2.set({ rise: 1 });
      S.bt.set({ shutter: 0, open: 0.9, sign: 1, t }); S.ds.set({ shutter: 0, open: 0.9, sign: 1, t });
      // red cup drops into the CORNER CAFE pan on "and"
      const cupLand = T.and + 0.14, cardLand = T.difference + 0.18;
      const cf = kk(T.and - 0.04, 0.18);
      S.rcup.group.position.set(0, lerp(4.5, 0, easeIn(cf)), 0);
      S.rcup.group.visible = cf > 0;
      const rsq = Math.max(0, ring(cupLand, 26, 9));
      S.rcup.group.scale.set(0.95 * (1 + 0.2 * rsq), 0.95 * (1 - 0.3 * rsq), 0.95 * (1 + 0.2 * rsq));
      S.rcup.set({ steam: cf, t });
      // card drops into the NEXT DOOR pan on "difference"
      const df = kk(T.difference, 0.18);
      const ch = 2.3 * 0.4 / 2 + 0.02;
      S.card2.group.position.set(0, lerp(ch + 5, ch, easeIn(df)), 0.1);
      S.card2.group.rotation.set(0, 0, (1 - df) * 0.5);
      S.card2.group.visible = df > 0;
      const csq = Math.max(0, ring(cardLand, 26, 9));
      S.card2.inner.scale.set(1 + 0.1 * csq, 1 - 0.15 * csq, 1);
      S.card2.set({ pop: 1, parts: [1, 1, 1, 1, 1] });
      // tip: left a little, back up a bit, then SLAM right on "matters"
      const e1 = backOut(kk(cupLand, 0.22), 2), e2 = backOut(kk(cardLand, 0.22), 2), e3 = backOut(kk(T.matters, 0.3), 1.6);
      let tip = -0.28 * e1 + 0.36 * e2 + 0.92 * e3;
      tip += 0.06 * ring(T.matters + 0.3, 16, 4);
      S.scale.set({ tip });
      S.scale.group.position.y = PED + 0.08 * bump(T.matters, 0.2);
      // founders
      const m = t - T.matters;
      const gHop = 0.75 * bump(T.matters + 0.04, 0.32) + 0.4 * bump(T.matters + 0.5, 0.26);
      S.green2.set({ hop: gHop + Math.max(0, 0.05 * Math.sin(t * 6)), squash: -0.2 * bump(T.matters + 0.04, 0.32) + 0.3 * Math.max(0, ring(T.matters + 0.36, 22, 9)),
        armL: m > 0 ? 150 + 15 * Math.sin(t * 14) : 25 + 10 * Math.sin(t * 4), armR: m > 0 ? 150 - 15 * Math.sin(t * 14) : 25, turn: -10, lookX: m > 0 ? 0 : -0.6,
        tilt: 6 * Math.sin(t * 3.4), blink: blinkAt(3), mouth: 'smile', mouthOpen: m > 0 ? 0.8 : 0.2 });
      // GREEN steps out in front of his shop to celebrate next to the winning pan (stays in the crash-zoom frame)
      { const st = U.easeOut(kk(T.matters, 0.3)); S.green2.group.position.x = lerp3(2.6 + 2.1 * SS, 4.45, st); S.green2.group.position.z = lerp3(0.75, 3.7, st);
        S.green2.group.scale.setScalar(lerp3(0.6, 0.72, st)); }
      const slump = kk(T.matters + 0.05, 0.25);
      S.red2.set({ hop: Math.max(0, 0.05 * Math.sin(t * 6 + 2)) * (1 - slump) + 0.4 * bump(T.and + 0.14, 0.26), squash: 0.2 * slump + 0.03 * Math.sin(t * 6), turn: 10, armR: 20 + 120 * bump(T.and + 0.1, 0.4),
        lookX: m > 0 ? 0.7 : 0.6, lookY: m > 0 ? -0.4 : 0, nod: 14 * slump, armL: 15 - 10 * slump,
        tilt: -8 * slump + 4 * Math.sin(t * 3), blink: blinkAt(7), mouth: m > 0 ? 'frown' : 'teeth', brow: -16 * slump });
      // burst at the NEXT DOOR pan
      S.root.updateMatrixWorld(true);
      const pw = new THREE.Vector3(); S.scale.panR.getWorldPosition(pw); S.root.worldToLocal(pw);
      S.spark2.group.position.copy(pw).add(new THREE.Vector3(-1.3, 2.4, 0.2));   // above-left of the card, never over its text
      S.spark2.set({ k: kk(T.matters + 0.1, 0.8) }); S.spark2.group.visible = t > T.matters + 0.1;
      S.conf2.group.position.copy(pw).add(new THREE.Vector3(0, 0.8, 0.4));
      S.conf2.set({ k: kk(T.matters + 0.12, 1.4) }); S.conf2.group.visible = t > T.matters + 0.12;
    }

    // ================= ctx =================
    if (t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2) {
      const o = spec.o;
      const Wp = (x, y, z) => [o[0] + x, o[1] + y, o[2] + z];
      ctx.bg = { top: '#6fa6df', mid: '#a9d0ef', bottom: '#f3dcb8' };
      if (t < T.clear) { ctx.focus = U.arr(S.pro.focus()); ctx.dof = 0.8; }
      else if (t < T.customer) { ctx.focus = Wp(P[0], 2.6, P[2] + 0.4); ctx.dof = 1.1; }
      else if (t < T.and) { ctx.focus = Wp(P[0] + 0.6, 2.4, P[2]); ctx.dof = 1.0; }
      else { ctx.focus = Wp(DX + (t > T.matters ? 2.6 : 0), 2.8, 4.2); ctx.dof = 0.7; }
      const sh = (a, amt, d = 0.3) => { const q = t - a; if (q > 0 && q < d) ctx.shake = Math.max(ctx.shake, amt * (1 - q / d)); };
      sh(T.clear + 0.16, 0.45); sh(T.for + 0.2, 0.15, 0.2); sh(T.customer + 0.14, 0.35); sh(T.them, 0.2);
      sh(T.and + 0.14, 0.2); sh(T.difference + 0.18, 0.25); sh(T.matters + 0.1, 0.7, 0.45);
      const fq = t - (T.matters + 0.1); if (fq > 0 && fq < 0.2) ctx.flash = Math.max(ctx.flash, 0.28 * (1 - fq / 0.2));
    }
  },

  camera(ctx, t, spec) {
    const T = cues(ctx, spec), o = spec.o;
    const Wd = (p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    const Pz = (pos, target, fov, roll) => ({ pos: Wd(pos), target: Wd(target), fov, roll });
    const lin = (k) => k;
    const hd = (s) => [0.06 * U.drift(t * 1.3, s), 0.05 * U.drift(t * 1.1, s + 4), 0];
    let p;
    if (t < T.clear) {
      // A: wide-ish street shot tracking the sprinting pro, NEXT DOOR sign up top, pushing in
      const ta = spec.t0 - 0.55, tb = T.clear - 0.12;
      const px = lerp3(-8.5, P[0], U.easeOut(U.clamp((t - ta) / (tb - ta))));
      const k = U.clamp((t - (spec.t0 - 0.45)) / (T.clear - spec.t0 + 0.45));
      p = Pz([px * 0.35 - 0.6, lerp3(4.4, 4.0, k), lerp3(18.4, 16.4, k)], [px * 0.45 + 0.7, lerp3(2.5, 2.4, k), 1.2], 46, lerp3(-4, -1, k));
    } else if (t < T.customer) {
      // B: close front on the pro + the REASON card, slow push + dutch drift
      p = U.poseTrack([[T.clear, Pz([0.9, 2.9, 16.2], [0.25, 2.55, 2.6], 40, 3)], [T.customer, Pz([0.55, 2.8, 14.8], [0.2, 2.55, 2.6], 40, 0.5)]], t, lin);
    } else if (t < T.and) {
      // C: low hero angle from the left, GREEN in the door at right, arcing
      p = U.poseTrack([[T.customer, Pz([-3.4, 1.3, 14.2], [0.6, 2.75, 2.4], 44, 5)], [T.and, Pz([-2.4, 1.15, 13.2], [0.7, 2.8, 2.4], 44, 2)]], t, lin);
    } else if (t < T.matters) {
      // D: split wide, both shops + scale, slow push
      p = U.poseTrack([[T.and, Pz([DX + 0.2, 5.6, 19.2], [DX, 2.9, 2.5], 48, -1.5)], [T.matters, Pz([DX + 0.3, 5.2, 18.0], [DX + 0.1, 2.9, 2.5], 48, 0)]], t, lin);
    } else {
      // D2: crash zoom toward the NEXT DOOR pan, roll
      p = U.poseTrack([[T.matters, Pz([DX + 0.3, 5.2, 18.0], [DX + 0.1, 2.9, 2.5], 48, 0)], [T.matters + 0.28, Pz([DX + 2.2, 4.4, 14.6], [DX + 3.0, 2.5, 3.4], 44, -4)],
        [spec.t1 + 0.6, Pz([DX + 2.4, 4.2, 13.8], [DX + 3.1, 2.5, 3.4], 44, -2.5)]], t, U.easeOut);
    }
    const h = hd(3);
    p.pos = [p.pos[0] + h[0], p.pos[1] + h[1], p.pos[2]];
    return p;
  },
};
function lerp3(a, b, k) { return a + (b - a) * k; }
