// s04_cta: "Comment KEYWORD ...". The keyword comes from reel.json cta.keyword (ctx.keyword).
// "comment": a green marquee sign COMMENT <KEYWORD> slams down, the cast hops in.  <keyword>: bulbs light, confetti, the middle
// person points at the sign.  next: hard cut close, a comment bar pops up and types the keyword.  ~60 % in: hard cut wide,
// everyone points at the sign, sparkles, second confetti burst.
// DEFAULT ONLY: the shops (makeShop x2) and makeBigSign are the reference reel's coffee-shop set. For a real reel REPLACE the set
// with this reel's own world/props (its toy world, its hero prop); KEEP the three things that make the CTA work: the big readable
// keyword, the comment bar typing it, and the cast pointing at it.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import { namedPerson } from '/engine/kits/people.js';
import * as U from '/engine/core/util.js';

const K = KT.K;
// FRAMING (checked in stills): every shot keeps the whole sign + the comment bar inside x 60..1020, y 280..1440 px.
// The board starts at LEGS 3.4 (above the cast's heads, even mid-hop) and the cameras sit a little high (y ~4-5) so the layers
// stack on screen: sign (y ~500-880) > comment bar (~830-1040) > faces (~1000-1200). A wider sign needs the cameras further back.
const SIGN = [0, 0, -1.2], LEGS = 3.4, SW = 6.6, SH = 2.9, SIGN_C = [0, LEGS + SH / 2, -1.0];
const SPOTS = [[-0.1, 0, 3.0], [-2.45, 0, 2.5], [2.35, 0, 2.6]];
const PILL = [0, 3.34, 3.9], PILL_W = 4.0, PILL_H = 0.78;

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const S = spec.state, root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const add = (o, x, y, z, ry = 0) => { o.group.position.set(x, y, z); o.group.rotation.y = ry; root.add(o.group); return o; };
    const kw = ctx.keyword;

    // ---- cues ----
    const n = spec.words.length;
    const comment = ctx.cue(spec, 'comment', 0.02);
    const key = Math.max(comment + 0.3, ctx.cue(spec, kw, 0.15));
    const type = key + 0.45;
    const hero = Math.max(type + 1.0, n ? ctx.wi(spec, Math.floor(n * 0.6)) : spec.t0 + 2.5);
    S.T = { comment, key, type, hero };
    S.shots = U.shots([[spec.t0, 'sign'], [type - 0.1, 'pill'], [hero, 'hero']], spec.t1 + 1, 0.5);

    // ---- set ----
    add(KT.makeStreet(ctx, { w: 50, clear: 6 }), 0, 0, -3.5).set({ rise: 1 });
    add(KT.makeSkyline(ctx, { w: 70, z: -14 }), 0, 0, -1).set({ rise: 1 });
    add(KT.makeShop(ctx, { preset: 'green', name: 'NEXT DOOR' }), 9.5, 0, -3.2).set({ shutter: 0, open: 0.4, sign: 1 });
    add(KT.makeShop(ctx, { preset: 'red', name: 'MAIN ST' }), -9.5, 0, -3.2).set({ shutter: 0, open: 0.4, sign: 1 });
    S.sign = add(KT.makeBigSign(ctx, `COMMENT ${kw}`, { color: K.green, w: SW, h: SH, legs: LEGS, seed: 33 }), ...SIGN);

    const cast = ctx.reel.cast ?? ['mei', 'jordan', 'zara'];
    S.people = SPOTS.map((p, i) => add(namedPerson(ctx, cast[i % cast.length] ?? 'mei', { mouth: 'teeth' }), ...p));
    S.pill = L.makeCommentPill(ctx, { w: PILL_W, h: PILL_H }); S.pill.group.position.set(...PILL); root.add(S.pill.group);

    S.conf = add(L.makeConfetti(ctx, { n: 110, spread: 7, height: 7, colors: [K.green, K.red, '#f2c230', '#ffffff', '#3f6fd8'], seed: 77 }), 0, 0.2, 1.5);
    S.conf2 = add(L.makeConfetti(ctx, { n: 90, spread: 8, height: 6, seed: 78 }), 0, 7.4, 2.0);
    S.spark = add(L.makeSparkle(ctx, { size: 1.2, seed: 41 }), SW / 2 - 0.4, SIGN_C[1] + 1.4, -0.6);
    S.spark2 = add(L.makeSparkle(ctx, { size: 1.0, n: 4, seed: 43 }), -SW / 2 + 0.6, SIGN_C[1] - 1.2, -0.6);
    S.root = root;

    ctx.sfx(comment + 0.15, 'stamp', -2); ctx.sfx(key, 'ding', -4); ctx.sfx(type, 'pop', -4);
    for (let i = 0; i < Math.min(kw.length, 8); i++) ctx.sfx(type + 0.2 + i * 0.07, 'type', -8);
    ctx.sfx(hero, 'shimmer', -5);
  },

  update(ctx, t, spec) {
    const S = spec.state, T = S.T, { inv, smooth, backOut, lerp } = U;
    S.root.visible = t > spec.t0 - 0.6 && t < spec.t1 + 0.9;
    if (!S.root.visible) return;
    const kk = (a, d) => inv(a, a + d, t);

    // sign slams down on "comment", lights on the keyword
    const sk = kk(T.comment - 0.12, 0.3);
    S.sign.group.position.y = (1 - backOut(sk)) * 6;
    const land = U.landSquash(t, T.comment + 0.18, 0.12);
    S.sign.group.scale.set(1 + land, 1 - land, 1);
    S.sign.set({ lit: smooth(kk(T.key - 0.05, 0.3)), t });
    S.spark.set({ k: kk(T.key, 1.0) }); S.spark2.set({ k: kk(T.hero, 0.9) });

    // cast hops in (staggered), the middle one points at the sign on the keyword, everyone points on the hero shot
    const pointK = smooth(kk(T.key - 0.1, 0.25)), hk = smooth(kk(T.hero - 0.05, 0.25)), heroOn = t >= T.hero - 0.05;
    S.people.forEach((p, i) => {
      const a = T.comment - 0.05 + i * 0.15, k = kk(a, 0.32);
      const hop = (k < 1 ? Math.sin(k * Math.PI) * 0.9 : 0) + (heroOn ? Math.abs(Math.sin((t - T.hero) * 7 + i)) * 0.22 : 0);
      const squash = k >= 1 ? U.landSquash(t, a + 0.32, 0.35) : -0.15 * Math.sin(k * Math.PI);
      p.group.scale.setScalar(Math.max(0.01, smooth(kk(a - 0.05, 0.18))));
      const side = SPOTS[i][0] < -1 ? -1 : SPOTS[i][0] > 1 ? 1 : 0;      // -1 left, 0 middle, +1 right
      const pose = { hop, squash, blink: U.blinkAt(t, i + 1), t, mouth: 'teeth', lookY: 0.25 * hk };
      if (side === 0) Object.assign(pose, { turn: -14 * pointK * (1 - hk), lookX: -0.4 * pointK * (1 - hk), lookY: 0.3 * pointK,
        armR: 150 * pointK, reachR: 40 * pointK, armL: 30 + 120 * hk, reachL: 30 * hk,
        talk: t > T.comment && t < spec.t1 - 0.3 ? 0.5 + 0.5 * Math.sin(t * 22) : 0 });
      else if (side < 0) Object.assign(pose, { turn: 22, lookX: 0.3, armL: 20 + 130 * hk, reachL: 30 * hk, armR: 150 * hk * 0.9, reachR: 35 * hk });
      else Object.assign(pose, { turn: -24, lookX: -0.35, armR: 30 + 120 * hk, reachR: 35 * hk, armL: 30 + 120 * hk * 0.8, reachL: 40 });
      p.set(pose);
    });

    // comment bar: pops in for the close-up, types the keyword, then flies up out of the hero shot
    const pk = kk(T.type - 0.15, 0.25), away = kk(T.hero - 0.1, 0.25);
    S.pill.group.visible = pk > 0 && away < 1;
    S.pill.group.scale.setScalar(Math.max(0.01, backOut(pk) * (1 - away)));
    S.pill.group.position.set(PILL[0], PILL[1] + away * 2.5 + 0.05 * Math.sin(t * 3), PILL[2]);
    const typed = Math.max(0, Math.min(ctx.keyword.length, Math.floor((t - T.type - 0.2) / 0.07) + 1));
    S.pill.set({ text: t > T.type + 0.2 ? ctx.keyword.slice(0, typed) : '', caret: Math.floor(t * 3) % 2 ? 1 : 0 });

    S.conf.set({ k: kk(T.key, 2.4) }); S.conf2.set({ k: kk(T.hero, 2.0) });

    if (t >= spec.t0 - spec.blend / 2 - 0.1 && t <= spec.t1 + 0.9) {
      const sh = U.shotAt(t, S.shots).id, o = spec.o;
      ctx.bg = ctx.P.sky;
      ctx.focus = U.at(o, sh === 'pill' ? [0, 3.6, 2.0] : sh === 'hero' ? [0, 3.4, 1.2] : [0, 4.2, 0]);
      ctx.dof = sh === 'pill' ? 0.6 : 0.55;              // keep the sign AND the bar readable
      const s1 = t - (T.comment + 0.15); if (s1 > 0 && s1 < 0.25) ctx.shake = 0.45 * (1 - s1 / 0.25);
    }
  },

  camera(ctx, t, spec) {
    const S = spec.state, o = spec.o, s = U.shotAt(t, S.shots);
    if (s.id === 'sign') return U.shot(o, [0.8, 4.2, 21], [0.4, 4.1, 19.4], [0, 2.6, 0], U.inv(spec.t0 - 0.45, s.t1, t), 44, -2);
    if (s.id === 'pill') return U.shot(o, [-0.4, 5.0, 18.2], [-0.25, 4.9, 17.3], [0, 3.1, 1.5], s.k, 44, 2);
    return U.shot(o, [0.3, 3.6, 19.5], [0.3, 3.7, 18.2], [0.3, 2.6, 0.5], U.inv(s.t0, s.t0 + 2.5, t), 46, 0);
  },
};
