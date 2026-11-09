// s01_hook: THE HOOK / thumbnail. Works with any script: the hero sign shows the last key word of the first sentence.
// frame 0: two people mid-hop in front of a street of shops, confetti already falling, the marquee sign behind them.
// word 3: shutters SLAM up (shake, confetti cannons) + low punch-in.   key word: the sign slams + lights (hard cut to the sign).
// 2nd sentence: if it negates ("It doesn't."), a red strike-through paints across the sign and the people react (shock).
// last: crane back to the whole street.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import { namedPerson } from '/engine/kits/people.js';
import * as U from '/engine/core/util.js';

const K = KT.K;
const PX = 1.65, PZ = 5.4;                 // the two people at (-PX / +PX, 0, PZ)
const SIGN = [0, 0, 2.0], LEGS = 2.7, SW = 6.2, SH = 2.9;
const SIGN_C = [0, LEGS + SH / 2, 2.2];    // board centre (local)
const NEG = /^(not|no|never|doesn't|don't|isn't|aren't|won't|can't|wrong|myth|stop|nope|false|nah)$/;

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const S = spec.state, root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const add = (o, x, y, z, ry = 0) => { o.group.position.set(x, y, z); o.group.rotation.y = ry; root.add(o.group); return o; };

    // ---- words -> cues (with fallbacks, so ANY script works) ----
    const sents = ctx.sentences(spec);
    const first = sents[0] ?? { i0: 0, i1: spec.words.length - 1 };
    const kws = ctx.keyWords({ ...spec, i0: spec.i0 + first.i0, i1: spec.i0 + first.i1 }, 3);
    const hero = kws[kws.length - 1] ?? ctx.keyWords(spec, 1)[0];
    let text = (hero?.w ?? 'WATCH THIS').toUpperCase();
    if (/\?$/.test(spec.words[first.i1]?.w ?? '')) text += '?';
    const second = sents[1];
    const negates = !!second && spec.words.slice(second.i0, second.i1 + 1).some((w) => NEG.test(U_bare(w.w)));
    S.T = {
      slam: ctx.wi(spec, 2),
      key: hero ? Math.max(hero.s, ctx.wi(spec, 2) + 0.45) : spec.t0 + 0.4 * (spec.t1 - spec.t0),
      cross: negates ? second.t0 + 0.05 : null,
      react: second ? second.t0 : null,
      end: spec.t1,
    };
    const T = S.T;
    // shot list: hard cuts on the cue words (min 0.4 s apart)
    S.shots = U.shots([[spec.t0, 'A'], [T.slam, 'B'], [T.key, 'C'], [T.react ?? T.key + 0.9, 'D'], [Math.max((T.react ?? T.key) + 1.0, spec.t1 - 0.9), 'E']], spec.t1 + 0.5);

    // ---- set ----
    const street = add(KT.makeStreet(ctx, { w: 70, walk: 12, lamps: 4 }), 0, 0, 0);
    const spots = [[-8.5, 11.2], [-12.5, 11.0], [8.5, 11.2], [12.5, 11.0], [-20, 11.2], [-24, 11.0], [20, 11.2], [24, 11.0]];
    street.props.forEach((p, i) => { if (spots[i]) { p.g.position.x = spots[i][0]; p.g.position.z = spots[i][1]; } });
    const sky = add(KT.makeSkyline(ctx, { w: 90, z: -15 }), 0, 0, 0);
    const shopL = add(KT.makeShop(ctx, { preset: 'red', name: 'MAIN ST', board: ['OPEN', 'TODAY'], aframeX: -3.2 }), -5.3, 0, -1.2, 0.22);
    const shopR = add(KT.makeShop(ctx, { preset: 'green', name: 'NEXT DOOR', board: ['NEW', 'IN TOWN'], aframeX: 3.2 }), 5.3, 0, -1.2, -0.22);
    [[-3.2, 11.0, 3, 1.2], [3.4, 11.4, 7, 1.1]].forEach(([x, z, seed, sc]) => { const p = L.makePlant(ctx, { seed }); p.group.position.set(x, 0, z); p.group.scale.setScalar(sc); root.add(p.group); });
    const sign = add(KT.makeBigSign(ctx, text, { color: K.red, w: SW, h: SH, legs: LEGS, seed: 17 }), ...SIGN);
    const spark = L.makeSparkle(ctx, { size: 1.3, seed: 9 }); spark.group.position.set(SW / 2 - 0.3, SIGN_C[1] + 1.2, SIGN_C[2] + 0.5); root.add(spark.group);

    // ---- cast (reel.json "cast": first two names) ----
    const cast = ctx.reel.cast ?? ['mei', 'jordan'];
    const A = add(namedPerson(ctx, cast[0] ?? 'mei', { mouth: 'teeth' }), -PX, 0, PZ);
    const B = add(namedPerson(ctx, cast[1] ?? 'jordan', { mouth: 'smile' }), PX, 0, PZ);

    // ---- FX ----
    const conf0 = add(L.makeConfetti(ctx, { n: 110, spread: 10, height: 4, seed: 3 }), 0, 7.5, 5.0);
    const confL = add(L.makeConfetti(ctx, { n: 70, spread: 5, height: 7, seed: 7, colors: [K.red, C_gold, '#ffffff', K.cream] }), -4.2, 4.0, 2.4);
    const confR = add(L.makeConfetti(ctx, { n: 70, spread: 5, height: 7, seed: 8, colors: [K.green, C_gold, '#ffffff', K.cream] }), 4.2, 4.0, 2.4);
    Object.assign(S, { root, street, sky, shopL, shopR, sign, spark, A, B, conf0, confL, confR, text });

    // ---- sound cues ----
    ctx.sfx(T.slam, 'slam', -3); ctx.sfx(T.key, 'boom', -2); ctx.sfx(T.key + 0.05, 'shimmer', -6);
    if (T.cross) ctx.sfx(T.cross, 'swoosh', -4);
  },

  update(ctx, t, spec) {
    const S = spec.state, T = S.T, { clamp, inv, smooth, spring, easeIn, lerp } = U;
    S.root.visible = t > spec.t0 - 0.6 && t < spec.t1 + 0.6;
    if (!S.root.visible) return;
    const ring = (dt, a = 1, f = 18, d = 8) => (dt < 0 ? 0 : a * Math.exp(-d * dt) * Math.cos(f * dt));
    const imp = (dt, a = 1, d = 12) => (dt < 0 ? 0 : a * Math.exp(-d * dt));

    S.street.set({ rise: 1 }); S.sky.set({ rise: 1 });
    // shutters: down until the slam word, then SLAM up with a tiny bounce
    const top = T.slam + 0.13;
    const shut = (dt) => { const tt = t - dt; if (tt < T.slam) return 1; if (tt < top) return 1 - easeIn(inv(T.slam, top, tt)); return tt < top + 0.22 ? Math.sin(inv(top, top + 0.22, tt) * Math.PI) * 0.13 : 0; };
    S.shopL.set({ shutter: shut(0), open: spring(inv(top, top + 0.6, t), 2.2, 4.5) * 0.85, sign: smooth(inv(top, top + 0.16, t)), t });
    S.shopR.set({ shutter: shut(0.04), open: spring(inv(top + 0.05, top + 0.65, t), 2.2, 4.5) * 0.85, sign: smooth(inv(top + 0.04, top + 0.2, t)), t: t + 0.7 });

    // the hero sign: dim until the key word, then slam (squash pulse) + full bulbs + sparkle; strike-through on the negation
    const hit = t - T.key, r = ring(hit, 0.16, 20, 8);
    S.sign.board.scale.set(1 + r, 1 - r * 0.8, 1);
    S.sign.board.position.y = LEGS + SH / 2 + (hit > -0.12 && hit < 0 ? (hit + 0.12) * 4 : 0);
    S.sign.set({ lit: 0.35 + 0.65 * smooth(inv(T.key, T.key + 0.15, t)), t, cross: T.cross ? smooth(inv(T.cross, T.cross + 0.28, t)) : 0 });
    S.spark.set({ k: inv(T.key, T.key + 0.9, t) });

    // people: hop in (frame 0 mid-air), wave; ta-da on the slam; point at the sign on the key word; shock on the negation
    const pose = (who, sgn, off) => {
      const land = 0.12 + off;
      let hop = t < land ? Math.sin(inv(-0.25, land, t) * Math.PI) * 0.9 : 0;
      let squash = U.landSquash(t, land, 0.35) - (t < land ? 0.15 : 0);
      hop += U.hopAt(t, T.slam - 0.05 + off, 0.45, 0.3); squash += U.landSquash(t, T.slam + 0.25 + off, 0.3);
      const wave = 1 - smooth(inv(T.slam - 0.1, T.slam + 0.05, t));
      const tada = spring(inv(T.slam, T.slam + 0.45, t), 2.6, 5) * (1 - smooth(inv(T.key - 0.15, T.key, t)));
      const point = smooth(inv(T.key - 0.05, T.key + 0.15, t)) * (T.react ? 1 - smooth(inv(T.react, T.react + 0.12, t)) : 1);
      const shock = T.react ? smooth(inv(T.react, T.react + 0.12, t)) : 0;
      const inner = { arm: lerp(lerp(lerp(25, 150, tada), 140, point), 165, shock), reach: lerp(lerp(20, 15, tada), 35, point) * (1 - shock), elbow: 120 * shock };
      const outer = { arm: lerp(lerp(lerp(15 + 120 * wave, 150, tada), 20, point), 165, shock), reach: 0, elbow: 120 * shock };
      const p = {
        hop, squash, turn: -sgn * (10 + 8 * point), tilt: sgn * 3 * Math.sin(t * 6 + off * 9) - sgn * 6 * shock, lean: -6 * shock,
        lookX: sgn * 0.25 * point, lookY: 0.45 * point + 0.15 * shock, nod: 4 * Math.sin(t * 7 + off * 20),
        mouth: shock > 0.5 ? 'o' : 'teeth', mouthOpen: 0.25 + 0.5 * tada + 0.4 * shock, blink: U.blinkAt(t, off * 10),
        waveR: sgn < 0 ? 0 : wave, waveL: sgn < 0 ? wave : 0, t,
      };
      // sgn +1 = the left person (inner arm = R), -1 = the right person (inner arm = L)
      if (sgn > 0) Object.assign(p, { armR: inner.arm, reachR: inner.reach, elbowR: inner.elbow, armL: outer.arm, reachL: outer.reach, elbowL: outer.elbow });
      else Object.assign(p, { armL: inner.arm, reachL: inner.reach, elbowL: inner.elbow, armR: outer.arm, reachR: outer.reach, elbowR: outer.elbow });
      who.set(p);
    };
    pose(S.A, 1, 0); pose(S.B, -1, 0.06);

    S.conf0.set({ k: inv(-0.6, 1.0, t) });
    S.confL.set({ k: inv(top, top + 1.5, t) }); S.confR.set({ k: inv(top + 0.04, top + 1.54, t) });

    if (t >= spec.t0 - 0.3 && t <= spec.t1 + spec.blend / 2 + 0.3) {
      ctx.bg = ctx.P.sky;
      ctx.shake = Math.min(1, imp(t - top, 0.7, 9) + imp(t - T.key, 0.45, 10) + (T.cross ? imp(t - T.cross - 0.2, 0.3, 12) : 0));
      ctx.flash = imp(t - top, 0.15, 22);
      const sh = U.shotAt(t, S.shots).id, o = spec.o;
      ctx.focus = U.at(o, sh === 'C' || sh === 'E' ? SIGN_C : [0, 2.2, PZ]);
      ctx.dof = sh === 'E' ? 0.5 : sh === 'C' ? 0.9 : 1.0;
    }
  },

  camera(ctx, t, spec) {
    const S = spec.state, o = spec.o, s = U.shotAt(t, S.shots);
    if (s.id === 'A') return U.shot(o, [0.4, 3.0, 18.5], [0.2, 2.9, 17.0], [0, 3.1, 3.2], U.inv(spec.t0 - 0.4, s.t1, t), 46, -2);           // wide thumbnail, fast push
    if (s.id === 'B') return U.shot(o, [-2.6, 1.2, 13.4], [-2.1, 1.3, 12.4], [0.2, 2.6, 4.0], s.k, 46, 4);                                   // low punch-in from the left
    if (s.id === 'C') return U.shot(o, [0.5, 3.9, 15.6], [0.25, 4.0, 14.4], SIGN_C, s.k, 50, -2.5);                                         // the sign
    if (s.id === 'D') return U.shot(o, [1.6, 2.5, 13.6], [1.1, 2.6, 12.6], [0, 3.0, 3.8], s.k, 50, 2);                                       // two-shot reaction, sign above
    return U.shot(o, [-0.8, 3.4, 17.0], [-0.4, 5.2, 21.5], [0, 3.6, 2.0], U.inv(s.t0, s.t0 + 1.4, t), 52, -1);                             // crane back
  },
};

const C_gold = '#e0b24a';
function U_bare(w) { return String(w).toLowerCase().replace(/[’]/g, "'").replace(/[^a-z']/g, ''); }
