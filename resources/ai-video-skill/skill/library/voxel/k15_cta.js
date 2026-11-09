// LIBRARY REFERENCE (k15_cta.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k15_cta "Comment KEYWORD and I'll send you the checklist that makes people choose you."
// Street in front of NEXT DOOR. "Comment": the green COMMENT <KEYWORD> marquee slams down, cast hops in (Marco, Alex, Sam).
// the keyword: bulbs light, confetti, Alex points at the sign. "checklist": hard cut close, a CUSTOMER CHECKLIST pops up
// beside Alex and ticks itself (website / packaging / content / offer). "choose": hard cut wide hero, everyone points at the sign.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import * as U from '/engine/core/util.js';

const K = KT.K;
const SIGN = [0, 0, -1.2];
const ALEX = [-0.1, 0, 3.0], MARCO = [-2.45, 0, 2.5], SAM = [2.35, 0, 2.6];
const LIST = [2.2, 2.3, 3.6];
let st = null;

function cues(ctx, spec) {
  const w = (word, d, n = 0) => ctx.wordAt(word, spec.t0 - 0.1, n) ?? d;
  return { comment: w('comment', 51.98), customer: w('customer', 52.37), checklist: w('checklist', 53.69),
    makes: w('makes', 54.28), people: w('people', 54.54), choose: w('choose', 54.87), you: w('you', 55.26, 1) };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z) => { o.group.position.set(x, y, z); root.add(o.group); return o; };
    at(KT.makeStreet(ctx, { w: 50 }), 0, 0, -3.5).set({ rise: 0 });
    at(KT.makeSkyline(ctx, { w: 70, z: -14 }), 0, 0, -1);
    at(KT.makeShop(ctx, { preset: 'green' }), 9.5, 0, -3.2);
    at(KT.makeShop(ctx, { preset: 'red' }), -9.5, 0, -3.2);
    const sign = at(KT.makeBigSign(ctx, `COMMENT ${ctx.keyword}`, { color: K.green, w: 7.6, h: 3.2, legs: 2.3, seed: 33 }), ...SIGN);
    const alex = at(KT.makeFounder(ctx, 'green'), ...ALEX);
    const marco = at(KT.makeFounder(ctx, 'red'), ...MARCO);
    const sam = at(KT.makeBusyPro(ctx), ...SAM); sam.acc.bag.visible = false;
    const cup = KT.makeCup(ctx, { color: K.green, icon: 'door', size: 0.6 }); sam.holdL(cup.group, [0, -0.15, 0.2]);
    const list = L.makeChecklist(ctx, { title: 'CUSTOMER CHECKLIST', items: ['Website', 'Packaging', 'Content', 'Offer'], w: 3.0, h: 3.9, seed: 35 });
    list.group.position.set(...LIST); root.add(list.group);
    const conf = L.makeConfetti(ctx, { n: 110, spread: 7, height: 7, colors: [K.green, K.red, '#f2c230', '#ffffff', '#3f6fd8'], seed: 77 });
    conf.group.position.set(0, 0.2, 1.5); root.add(conf.group);
    const spark = L.makeSparkle(ctx, { size: 1.2, seed: 41 }); spark.group.position.set(SIGN[0] + 3.4, 5.2, SIGN[2] + 0.6); root.add(spark.group);
    const lSpark = L.makeSparkle(ctx, { size: 0.9, n: 4, seed: 43 }); lSpark.group.position.set(LIST[0] + 1.2, LIST[1] + 2.0, LIST[2] + 0.3); root.add(lSpark.group);
    st = { root, sign, alex, marco, sam, list, conf, spark, lSpark };
  },

  update(ctx, t, spec) {
    const S = st, T = cues(ctx, spec);
    S.root.visible = !(t < spec.t0 - 0.6 || t > spec.t1 + 0.8);
    if (!S.root.visible) return;
    const { clamp, backOut, smooth, spring } = U;
    const kk = (a, d) => clamp((t - a) / d);
    const blink = (s) => (((t * 0.9 + s * 0.41) % 2.1) < 0.08 ? 1 : 0);
    const hopIn = (a) => { const k = kk(a, 0.32); return { hop: k < 1 ? Math.sin(k * Math.PI) * 0.9 : 0, squash: k >= 1 ? 0.35 * Math.exp(-(t - a - 0.32) * 9) * Math.cos((t - a - 0.32) * 30) : -0.15 * Math.sin(k * Math.PI), s: smooth(clamp(kk(a - 0.05, 0.18))) }; };

    // sign slams down on "Comment", lights on the keyword
    const sk = kk(T.comment - 0.12, 0.3);
    S.sign.group.position.y = (1 - backOut(sk)) * 6;
    S.sign.group.scale.set(1 + 0.12 * Math.max(0, 1 - (t - T.comment - 0.18) * 5) * (t > T.comment + 0.18 ? 1 : 0), 1, 1);
    S.sign.set({ lit: smooth(kk(T.customer - 0.05, 0.3)), t });
    S.spark.group.visible = t > T.customer; S.spark.set({ k: kk(T.customer, 1.0) });

    // cast hops in, staggered
    const pa = hopIn(T.comment - 0.05), pm = hopIn(T.comment + 0.12), ps = hopIn(T.comment + 0.26);
    const pointK = smooth(kk(T.customer - 0.1, 0.25));
    const hero = t >= T.choose - 0.05, hk = smooth(kk(T.choose - 0.05, 0.25));
    const bounce = (o) => (hero ? Math.abs(Math.sin((t - T.choose) * 7 + o)) * 0.22 : 0);
    S.alex.group.scale.setScalar(Math.max(0.01, pa.s));
    S.alex.set({ hop: pa.hop + bounce(0), squash: pa.squash, turn: -14 * pointK * (1 - hk), lookX: -0.4 * pointK * (1 - hk), lookY: 0.3 * pointK,
      armR: 150 * pointK, reachR: 40 * pointK, armL: t > T.checklist ? 60 : 12, reachL: t > T.checklist ? 30 : 0,
      mouth: 'teeth', talk: t > T.comment && t < T.you + 0.3 ? 0.5 + 0.5 * Math.sin(t * 22) : 0, blink: blink(1), t });
    S.marco.group.scale.setScalar(Math.max(0.01, pm.s));
    S.marco.set({ hop: pm.hop + bounce(1), squash: pm.squash, turn: 22, lookX: 0.3, lookY: 0.25 * hk, armL: 20 + 130 * hk, reachL: 30 * hk, armR: 150 * hk * 0.9, reachR: 35 * hk, mouth: 'teeth', blink: blink(2), t });
    S.sam.group.scale.setScalar(Math.max(0.01, ps.s));
    S.sam.set({ hop: ps.hop + bounce(2), squash: ps.squash, turn: -24, lookX: -0.35, lookY: 0.25 * hk, armR: 30 + 120 * hk, reachR: 35 * hk, armL: 30, reachL: 40, mouth: hero ? 'teeth' : 'smile', blink: blink(3), t });

    // checklist pops on "checklist", ticks on the next words
    const lk = kk(T.checklist - 0.08, 0.35);
    S.list.group.visible = lk > 0.01;
    S.list.group.scale.setScalar(Math.max(0.01, backOut(lk)) * (0.8 - 0.22 * hk));
    S.list.group.rotation.set(0, -0.35 * (1 - hk), 0.06 * Math.sin(t * 2.2));
    S.list.group.position.set(LIST[0] + 2.2 * hk, LIST[1] + 2.6 * hk + 0.08 * Math.sin(t * 2.6), LIST[2] - 2.4 * hk);
    const tk = [T.checklist + 0.25, T.makes, T.people, T.choose].map((a) => smooth(kk(a, 0.18)));
    S.list.set({ ticks: tk });
    S.lSpark.group.visible = t > T.choose; S.lSpark.set({ k: kk(T.choose, 0.9) });

    // confetti on the keyword, again on choose
    S.conf.set?.({ k: kk(T.customer, 2.4) });
    S.conf.group.visible = t > T.customer;

    if (t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2 + 0.8) {
      const o = spec.o, W = (x, y, z) => [o[0] + x, o[1] + y, o[2] + z];
      ctx.bg = { top: '#8fb6e0', mid: '#bcd5ea', bottom: '#e8dcc4' };
      if (t < T.checklist) { ctx.focus = W(0, 3.2, 0.5); ctx.dof = 0.8; }
      else if (t < T.choose) { ctx.focus = W(1.1, 2.4, 3.2); ctx.dof = 1.0; }
      else { ctx.focus = W(0, 2.8, 1.5); ctx.dof = 0.75; }
      const s1 = t - (T.comment + 0.15); if (s1 > 0 && s1 < 0.25) ctx.shake = Math.max(ctx.shake || 0, 0.45 * (1 - s1 / 0.25));
    }
  },

  camera(ctx, t, spec) {
    const T = cues(ctx, spec), o = spec.o;
    const P = (pos, target, fov, roll) => ({ pos: [pos[0] + o[0], pos[1] + o[1], pos[2] + o[2]], target: [target[0] + o[0], target[1] + o[1], target[2] + o[2]], fov, roll });
    if (t < T.checklist) {
      return U.poseTrack([[spec.t0 - 0.45, P([1.2, 3.4, 18.5], [0, 3.6, 0], 44, -3)], [T.checklist, P([0.6, 3.2, 16.4], [0, 3.5, 0], 44, -1)]], t, (k) => k);
    }
    if (t < T.choose) {
      return U.poseTrack([[T.checklist, P([-2.2, 2.6, 10.8], [1.2, 2.4, 3.0], 40, 3)], [T.choose, P([-1.6, 2.6, 10.0], [1.2, 2.4, 3.0], 40, 1.5)]], t, (k) => k);
    }
    return U.poseTrack([[T.choose, P([0.3, 2.4, 16.4], [0.3, 3.4, 1.0], 46, 0)], [spec.t1 + 0.8, P([0.3, 2.5, 15.2], [0.3, 3.4, 1.0], 46, 0)]], t, U.easeOut);
  },
};
