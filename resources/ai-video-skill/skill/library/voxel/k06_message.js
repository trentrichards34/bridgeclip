// LIBRARY REFERENCE (k06_message.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k06_message 13.3-16.1 "Their message is simple. We make great coffee."
// A (Their/message/is): RED lands on a crate, megaphone blasts per word, inhales.  B ("simple"): the big WE MAKE GREAT COFFEE sign
// drops and slams (shake, dust), crowd backs flinch; bulbs light on "We", bounce per word.  C ("great"): hard cut, the crowd turns
// its back on the sign and stares at us deadpan; on "coffee" the student shrugs and a "SO?" card pops, synced blank blink.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const K = KT.K, C = L.C;
let S = null;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const pulse = (t, at, len = 0.22) => (t < at || t > at + len ? 0 : Math.sin(Math.PI * (t - at) / len));
const decay = (t, at, k = 7) => (t < at ? 0 : Math.exp(-k * (t - at)));

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const U = ctx.U, root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, ry = 0) => { o.group.position.set(x, y, z); o.group.rotation.y = ry; root.add(o.group); return o; };
    const w = (n, d) => ctx.wordAt(n, spec.t0) ?? d;
    const T = {
      their: w('Their', 13.38), message: w('message', 13.71), is: w('is', 14.03), simple: w('simple.', 14.19),
      we: w('We', 14.82), make: w('make', 14.98), great: w('great', 15.30), coffee: w('coffee.', 15.62),
    };

    const street = at(KT.makeStreet(ctx, { w: 60 }), 0, 0, -3);
    const sky = at(KT.makeSkyline(ctx, { w: 70, z: -14 }), 0, 0, -6);
    const shop = at(KT.makeShop(ctx, { preset: 'red' }), 0.6, 0, -5.2);
    const sign = at(KT.makeBigSign(ctx, 'WE MAKE GREAT COFFEE', { color: K.red, w: 5.6, h: 3.5, legs: 3.8 }), 1.4, 0, -2.4);
    // RED on a crate, megaphone toward the crowd (screen right)
    const crateM = L.mat(C.woodLight);
    const crate = new THREE.Group(); crate.position.set(-1.9, 0, 0.0); root.add(crate);
    L.B(2.2, 1.0, 1.7, crateM, { r: 0.06, y: 0.5, parent: crate });
    for (const y of [0.25, 0.75]) L.B(2.24, 0.08, 1.74, L.mat(C.wood), { r: 0.02, y, parent: crate });
    const red = at(KT.makeFounder(ctx, 'red'), -1.9, 1.0, 0.0, 0.0);
    const mega = KT.makeMegaphone(ctx); red.holdR(mega.group, [0.1, -0.1, 0.2]); mega.group.rotation.y = 0.9;
    // crowd in front, facing camera
    const crowd = [
      at(KT.makeCrowdMember(ctx, 'student', 3), -0.2, 0, 3.0, Math.PI + 0.35),
      at(KT.makeCrowdMember(ctx, 'nerd', 4), 2.2, 0, 2.6, Math.PI - 0.1),
      at(KT.makeCrowdMember(ctx, 'anyone', 6), 4.1, 0, 1.8, Math.PI - 0.3),
      at(KT.makeCrowdMember(ctx, 'pro', 7), 5.7, 0, 0.6, Math.PI - 0.4),
    ];
    const pro = at(KT.makeBusyPro(ctx), 8, 0, 0.6, -Math.PI / 2);
    const soCard = at(L.makeCard(ctx, { w: 1.7, h: 1.05, lines: [{ text: 'SO?', color: C.ink, size: 0.6 }], pin: true, seed: 6 }), 2.3, 3.15, 3.0);
    const meh = at(L.makeCard(ctx, { w: 1.7, h: 1.0, lines: [{ text: 'MEH.', color: C.ink, size: 0.5 }], pin: true, seed: 9 }), 2.4, 3.0, 3.0);
    // slam dust: little cream puffs at the sign's feet
    const dust = [];
    const dm = L.mat('#efe3cc', { felt: 0.6, transparent: true, opacity: 1 });
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; const m = L.B(0.35, 0.35, 0.35, dm, { r: 0.12, parent: root }); m.castShadow = false; dust.push({ m, a }); }
    const spark = at(L.makeSparkle(ctx, { size: 1.0 }), 3.9, 7.4, -2.0);
    S = { root, T, street, sky, shop, sign, red, mega, crowd, pro, soCard, meh, dust, dm, spark, crate };
  },

  update(ctx, t, spec) {
    const { root, T, street, sky, shop, sign, red, mega, crowd, pro, soCard, meh, dust, dm, spark } = S;
    const U = ctx.U;
    root.visible = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    if (!root.visible) return;
    const inWin = t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2;

    street.set({ rise: 1 }); sky.set({ rise: 1 });
    shop.set({ shutter: 0, open: 0.35, sign: 1, t });

    // ---- RED: lands on crate (mid-action at frame 0), revs up, shouts every word
    const land = T.their - 0.1;
    const hopUp = t < land ? Math.sin(Math.PI * clamp((t - (land - 0.35)) / 0.35)) * 0.9 : 0;
    const landSq = t >= land ? 0.35 * decay(t, land, 9) * Math.cos((t - land) * 18) : 0;
    const shoutTimes = [T.their, T.message, T.is, T.simple, T.we, T.make, T.great, T.coffee];
    let talk = 0, blast = 0; for (const s of shoutTimes) { talk = Math.max(talk, pulse(t, s, 0.24)); blast = Math.max(blast, decay(t, s, 5)); }
    const inhale = U.win(t, T.is, T.simple + 0.05, 0.15, 0.06);
    const yell = decay(t, T.simple, 6) + 0.6 * decay(t, T.we, 6);
    const armUp = U.track([[spec.t0, 55], [T.message, 55], [T.message + 0.12, 95], [T.is, 80], [T.simple, 100], [T.we, 85]], t, U.easeOut);
    red.set({ hop: hopUp, squash: landSq - inhale * 0.22 + yell * 0.15, armR: armUp, reachR: 55, armL: 30 + 50 * pulse(t, T.make, 0.4),
      lean: -inhale * 10 + yell * 8, tilt: Math.sin(t * 7) * 3, lookX: 0.45, brow: 16, mouth: 'o', mouthOpen: 0.25 + 0.75 * Math.max(talk, yell * 0.8),
      blink: pulse(t, 13.95, 0.12) });
    mega.set({ blast: clamp(0.25 + blast), t });
    mega.group.scale.setScalar(1 + 0.18 * Math.max(pulse(t, T.message, 0.2), pulse(t, T.simple, 0.2), pulse(t, T.we, 0.2)));

    // ---- the sign: falls on "simple", slams, bulbs light on "We", bounce per word, jolt on "great"
    const fallT0 = T.simple - 0.04, slam = T.simple + 0.11;
    const fall = clamp((t - fallT0) / (slam - fallT0));
    const yDrop = t < fallT0 ? 30 : (1 - fall * fall) * 10;
    const sq = t >= slam ? decay(t, slam, 7) * Math.cos((t - slam) * 22) : 0;
    const bounce = [T.we, T.make, T.great, T.coffee].reduce((m, s) => Math.max(m, pulse(t, s, 0.18)), 0);
    sign.group.position.y = yDrop;
    sign.group.scale.set(1 + 0.08 * sq + 0.04 * bounce, 1 - 0.12 * sq + 0.06 * bounce, 1);
    sign.board.rotation.z = (t > T.great ? 0.05 * decay(t, T.great, 6) * Math.sin((t - T.great) * 30) : 0) + 0.015 * sq;
    const lit = t < T.we ? 0.08 : clamp((t - T.we) / 0.08);
    sign.set({ lit, t: t * 1.6, cross: 0 });
    spark.set({ k: clamp((t - T.we) / 1.0) });
    spark.group.visible = t > T.we && t < T.we + 1.0;
    // slam dust
    const dk = clamp((t - slam) / 0.6);
    dust.forEach(({ m, a }, i) => {
      const r = 0.6 + dk * (2.2 + (i % 3) * 0.5);
      m.visible = t > slam && dk < 1;
      m.position.set(1.4 + Math.cos(a) * r * 1.6, 0.25 + dk * 0.6 * (1 - dk) * 2 + (i % 2) * 0.2, -2.4 + Math.sin(a) * r * 0.7);
      m.scale.setScalar(Math.max(0.01, (1 - dk) * (1 + (i % 3) * 0.3)));
    });
    dm.opacity = 1 - dk;

    // ---- crowd: backs to us watching RED/the sign, flinch at the slam; on "great" they turn their backs on it: deadpan
    const flinch = t >= slam ? decay(t, slam, 6) : 0;
    const spinT = T.great + 0.03, dead = t >= spinT;
    const spin = dead ? U.spring(clamp((t - spinT) / 0.45), 2.6, 6) : 0;
    const base = [Math.PI + 0.35, Math.PI - 0.1, Math.PI - 0.3, Math.PI - 0.4], face = [0.15, -0.08, -0.25, -0.3];
    const blinkSync = pulse(t, T.coffee + 0.3, 0.14);
    crowd.forEach((c, i) => {
      const ph = i * 1.7, idle = Math.sin(t * 5 + ph) * 0.04;
      const hop = flinch * 0.45 * Math.max(0, Math.sin((t - slam - i * 0.03) * 14)) + (dead ? 0.35 * pulse(t, spinT + i * 0.03, 0.22) : 0);
      c.group.rotation.y = U.lerp(base[i], face[i], spin);
      c.set({ hop: hop + idle, squash: -0.15 * flinch * Math.cos((t - slam) * 16), lookX: dead ? 0 : (i ? -0.4 : 0.3), lookY: dead ? 0 : 0.35,
        mouth: 'flat', mouthOpen: 0, blink: dead ? blinkSync : pulse(t, 13.6 + i * 0.37, 0.12), tilt: Math.sin(t * 3 + ph) * 2,
        cross: i === 2 && t > T.coffee + 0.1 ? 1 : 0 });
    });
    // student shrug + SO? card on "coffee"; nerd MEH. right after
    const shrugT = T.coffee, shrug = t > shrugT ? U.spring(clamp((t - shrugT) / 0.5)) : 0;
    crowd[0].set({ armL: 75 * shrug, armR: 75 * shrug, tilt: 8 * shrug, hop: 0.15 * pulse(t, shrugT, 0.25) + (dead ? 0.35 * pulse(t, spinT, 0.22) : 0),
      mouth: 'flat', blink: dead ? blinkSync : pulse(t, 13.6, 0.12), lookX: dead ? 0 : 0.3, lookY: dead ? 0 : 0.35 });
    const sk = t > shrugT + 0.04 ? U.spring(clamp((t - shrugT - 0.04) / 0.5)) : 0;
    soCard.group.visible = sk > 0.01; soCard.group.scale.setScalar(Math.max(0.01, sk)); soCard.group.rotation.z = 0.12 - 0.05 * sk;
    const mT = shrugT + 0.2, mk = t > mT ? U.spring(clamp((t - mT) / 0.5)) : 0;
    meh.group.visible = false;
    if (dead) crowd[1].set({ mouth: 'flat', tilt: -7 * mk, nod: -5 * mk, blink: blinkSync, hop: 0.35 * pulse(t, spinT + 0.03, 0.22) });

    // ---- busy pro hurries past behind the crowd, eyes on his watch (ignores the sign entirely)
    const pt0 = T.great - 0.1, pk = clamp((t - pt0) / 1.1);
    pro.group.position.x = 7.0 - pk * 10.0;
    pro.group.visible = false;
    pro.set({ ...pro.hurry(t), armL: 70, reachL: 75, lookY: -0.3, lookX: 0.4 });

    if (!inWin) return;
    const o = spec.o;
    const shot = t < T.simple ? 'A' : t < T.great ? 'B' : 'C';
    if (shot === 'A') ctx.focus = [o[0] - 1.9, 2.5, o[2]];
    else if (shot === 'B') ctx.focus = [o[0] + 1.4, 5.5, o[2] - 2.2];
    else ctx.focus = [o[0] + 1.2, 1.6, o[2] + 2.4];
    ctx.dof = shot === 'A' ? 1.1 : shot === 'B' ? 0.6 : 0.5;
    ctx.bg = { top: '#7fb0de', mid: '#b5d3ec', bottom: '#efe2c8' };
    ctx.shake = Math.max(0.7 * decay(t, slam, 10) * (t >= slam ? 1 : 0), 0.25 * pulse(t, T.great, 0.15));
    ctx.flash = t >= T.we ? 0.18 * decay(t, T.we, 14) : 0;
  },

  camera(ctx, t, spec) {
    const { T } = S, o = spec.o, U = ctx.U;
    const W = (p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
    const dr = (s) => U.drift(t * 1.3, s) * 0.12;
    if (t < T.simple) {   // A: low, dutch, from front-left pushing in on RED + megaphone, crowd backs on the right
      const k = clamp((t - (spec.t0 - 0.4)) / (T.simple - spec.t0 + 0.4)), ek = U.easeOut(k);
      return { pos: W([-5.4 + ek * 0.8 + dr(1), 2.5 + ek * 0.3, 9.8 - ek * 1.6]), target: W([-0.9 + dr(2), 2.8, 0.5]), fov: 46 - ek * 3 + 3 * pulse(t, T.message, 0.15), roll: -6 + ek * 3 };
    }
    if (t < T.great) {   // B: frontal on the sign over the crowd's heads, push in
      const k = clamp((t - T.simple) / (T.great - T.simple)), ek = U.easeOut(k);
      return { pos: W([0.8 + ek * 0.3 + dr(3), 4.0 + ek * 0.2, 16.0 - ek * 2.0]), target: W([1.3 + dr(4), 4.9, -1.0]), fov: 46 - 2 * pulse(t, T.we, 0.2), roll: 2.5 - ek * 2 };
    }
    // C: lower, from the right, the crowd faces us deadpan with the lit sign behind
    const k = clamp((t - T.great) / 1.0), ek = U.easeOut(k);
    return { pos: W([1.7 - ek * 0.4 + dr(5), 2.5, 12.4 - ek * 1.0]), target: W([1.3, 3.1, -0.5]), fov: 52, roll: -3 + ek * 2 };
  },
};
