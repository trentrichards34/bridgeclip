// LIBRARY REFERENCE (k05_crowd.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k05_crowd 9.4-13.3 "Students, professionals, coffee enthusiasts, anyone who drinks coffee."
// In front of CORNER CAFE (RED on a crate blasting the megaphone). One crowd type DROPS in per word with a label card,
// each in its own hard-cut close shot: STUDENT (Students), PROFESSIONAL (professionals), COFFEE NERD (coffee / enthusiasts).
// On "anyone" hard cut to a wide: a whole crowd floods in hopping from both sides, ANYONE card slams down;
// on "drinks" cups pop into every hand, on "coffee" everybody toasts + hops.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import * as U from '/engine/core/util.js';

const { clamp, inv, lerp, smooth, spring, backOut } = U;
const K = KT.K, C = L.C;
let S = null;

// front-row heroes (local coords)
const SLOT = { student: [-2.6, 0, 4.4], pro: [0, 0, 4.7], nerd: [2.6, 0, 4.4] };
// flood crowd slots [x, z, seed, type]
const FLOOD = [
  [-3.7, 2.4, 21, 'anyone'], [-1.3, 2.3, 22, 'student'], [1.2, 2.3, 23, 'anyone'], [3.6, 2.4, 24, 'pro'],
  [-4.4, 5.9, 25, 'anyone'], [4.4, 5.9, 26, 'anyone'], [-0.9, 0.3, 27, 'nerd'], [1.4, 0.4, 28, 'anyone'], [3.6, 0.5, 30, 'student'],
];

// drop-in: falls from h, lands at tl with squash; returns {vis, y, squash, shake}
function drop(t, tl, h = 5.5, dur = 0.2) {
  if (t < tl - dur) return { vis: false, y: h, squash: 0, shake: 0 };
  if (t < tl) { const u = (t - (tl - dur)) / dur; return { vis: true, y: h * (1 - u * u), squash: -0.35 * u, shake: 0 }; }
  const d = t - tl;
  return { vis: true, y: 0.25 * Math.max(0, Math.sin(Math.min(1, d / 0.22) * Math.PI)) * (d < 0.22 ? 1 : 0), squash: 0.6 * Math.exp(-8 * d) * Math.cos(d * 24), shake: 0.35 * Math.exp(-14 * d) };
}
const blinkAt = (t, s) => { const q = ((t * 0.45 + s * 0.37) % 1 + 1) % 1; return q < 0.06 ? Math.sin((q / 0.06) * Math.PI) : 0; };
const kick = (t, t0, dur = 0.3) => (t < t0 || t > t0 + dur ? 0 : Math.sin(((t - t0) / dur) * Math.PI));

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z) => { o.group.position.set(x, y, z); root.add(o.group); return o; };

    const street = at(KT.makeStreet(ctx, { w: 46 }), 0, 0, -1);
    const sky = at(KT.makeSkyline(ctx, { w: 70, z: -12 }), 0, 0, -1);
    const shop = at(KT.makeShop(ctx, { preset: 'red', aframeX: 4.6 }), 0.6, 0, -1.4);
    const shop2 = at(KT.makeShop(ctx, { preset: 'green' }), 11.0, 0, -1.4);

    // RED on a crate, back left, megaphone aimed at the crowd (screen right)
    const crate = new THREE.Group(); crate.position.set(-3.2, 0, 0.3); root.add(crate);
    L.B(2.3, 1.15, 1.8, L.mat(C.woodLight, { scale: 1.4 }), { r: 0.06, y: 0.575, parent: crate });
    for (const s of [-1, 1]) L.B(0.12, 1.0, 1.84, L.mat(C.wood), { r: 0.03, x: s * 0.9, y: 0.575, parent: crate });
    const red = KT.makeFounder(ctx, 'red'); red.group.position.set(-3.2, 1.15, 0.3); root.add(red.group);
    const mega = KT.makeMegaphone(ctx); red.holdR(mega.group, [0.1, -0.1, 0.2]); mega.group.rotation.y = 0.9;

    // heroes + their label cards
    const heroes = {};
    const mk = (key, type, seed, label, color) => {
      const c = KT.makeCrowdMember(ctx, type, seed, type === 'pro' ? { hairColor: C.hairBlack } : {}); c.group.position.set(...SLOT[key]); root.add(c.group);
      const card = at(KT.makeLabelCard(ctx, label, { color, w: key === 'pro' ? 4.1 : 3.1, h: key === 'pro' ? 1.2 : 1.0, pin: true, seed }), SLOT[key][0], 3.45, { student: 4.5, pro: 4.95, nerd: 5.35 }[key]);
      const cup = KT.makeCup(ctx, { color: K.red, icon: 'bean', size: 0.72 });
      if (type === 'nerd') c.holdL(cup.group, [0, -0.05, 0.3]); else c.holdR(cup.group, [0, -0.05, 0.3]);
      heroes[key] = { c, card, cup, type };
    };
    mk('student', 'student', 3, 'STUDENT', C.blue);
    mk('pro', 'pro', 4, 'PROFESSIONAL', '#4a4d57');
    mk('nerd', 'nerd', 5, 'COFFEE NERD', '#b07a12');

    // flood crowd
    const flood = FLOOD.map(([x, z, seed, type], i) => {
      const c = KT.makeCrowdMember(ctx, type, seed, type === 'pro' ? { hairColor: '#8a4b2a' } : {}); root.add(c.group);
      const cup = KT.makeCup(ctx, { color: K.red, icon: 'bean', size: 0.72 });
      if (type === 'nerd') c.holdL(cup.group, [0, -0.05, 0.3]); else c.holdR(cup.group, [0, -0.05, 0.3]);
      return { c, cup, x, z, type, i, side: x < 0 ? -1 : 1, d: Math.abs(x) };
    });
    // arrival order: front/outer first so the frame fills from the edges in
    const order = flood.slice().sort((a, b) => (b.z - a.z) * 0.3 + (b.d - a.d)); order.forEach((f, j) => (f.j = j));

    const anyCard = at(KT.makeLabelCard(ctx, 'ANYONE', { color: K.red, sub: 'who drinks coffee', icon: 'cup', w: 5.0, h: 1.75, pin: true, seed: 9 }), -0.2, 5.7, 3.4);
    const conf = at(L.makeConfetti(ctx, { n: 70 }), -0.2, 6.2, 3.6);

    S = { root, street, sky, shop, shop2, red, mega, heroes, flood, anyCard, conf };
  },

  update(ctx, t, spec) {
    if (!S) return;
    const on = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    S.root.visible = on; if (!on) return;
    const W = (w, n = 0) => ctx.wordAt(w, spec.t0, n) ?? spec.t0;
    const tStu = W('students'), tPro = W('professionals'), tCof = W('coffee'), tEnth = W('enthusiasts'), tAny = W('anyone'), tDrink = W('drinks'), tCof2 = W('coffee', 1);
    const inside = t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2;
    let shake = 0;

    S.street.set({ rise: 1 }); S.sky.set({ rise: 1 });
    for (const pr of S.street.props) if (Math.abs(pr.g.position.x) < 8) pr.g.visible = false;   // no tree/lamp behind the heroes
    S.shop.set({ shutter: 0, open: 0.35, sign: 1, t });
    S.shop2.set({ shutter: 0, open: 0, sign: 1, t: t + 0.4 });

    // RED shouting all beat long
    const talk = Math.abs(Math.sin(t * 13)) * 0.7;
    S.red.set({ armR: 70, reachR: 60, armL: 40 + 25 * Math.abs(Math.sin(t * 4.2)), hop: 0.08 * Math.abs(Math.sin(t * 6.3)), squash: -0.05 * Math.sin(t * 12.6),
      brow: 14, mouthOpen: 0.3 + talk, lookX: 0.4, turn: 18, blink: blinkAt(t, 1) });
    S.mega.set({ blast: 1, t });

    // ---- heroes: drop in on their word ----
    const landT = { student: tStu + 0.09, pro: tPro + 0.09, nerd: tCof + 0.08 };
    const cardT = { student: tStu + 0.17, pro: tPro + 0.17, nerd: tCof + 0.17 };
    // one hero card at a time: each card pops out on the next hero's word (no cropped neighbour labels in the close shots)
    const cardOut = { student: tPro, pro: tCof, nerd: tAny };
    const raise = smooth(inv(tDrink, tDrink + 0.22, t));                 // cups up on "drinks"
    const toast = t < tCof2 ? 0 : Math.exp(-5 * (t - tCof2)) * Math.sin((t - tCof2) * 16);
    const cheerHop = (ph) => (t < tCof2 + ph ? 0 : 0.45 * Math.max(0, Math.sin(Math.min(1, (t - tCof2 - ph) / 0.3) * Math.PI)));
    const cupPop = (tt) => (t < tt ? 0 : backOut(clamp((t - tt) / 0.22), 2.6));
    let k = 0;
    for (const key of ['student', 'pro', 'nerd']) {
      const h = S.heroes[key], dp = drop(t, landT[key]);
      h.c.group.visible = dp.vis;
      shake = Math.max(shake, dp.shake);
      const [x, , z] = SLOT[key];
      h.c.group.position.set(x, dp.y + cheerHop(0.02 * k), z);
      const p = { squash: dp.squash, blink: blinkAt(t, k + 3), lookX: 0, turn: 0, tilt: 0 };
      if (key === 'student') {
        const wv = kick(t, tStu + 0.38, 0.5);
        Object.assign(p, { armR: 20 + 120 * wv, tilt: -6 * wv + 3 * Math.sin(t * 5), mouth: 'smile', hop: 0.25 * kick(t, tStu + 0.48, 0.24) });
      } else if (key === 'pro') {
        const w = smooth(inv(tPro + 0.33, tPro + 0.45, t)) * (1 - smooth(inv(tCof - 0.05, tCof + 0.2, t)));
        Object.assign(p, { armL: 75 * w, reachL: 55 * w, lookX: -0.6 * w, nod: 10 * kick(t, tPro + 0.55, 0.2), brow: -8 * w });
      } else {
        const pour = kick(t, tCof + 0.3, 0.55);
        h.c.acc.kettle.rotation.x = -0.7 * pour;
        Object.assign(p, { armR: 25 + 30 * pour, mouth: 'o', hop: 0.3 * kick(t, tEnth + 0.5, 0.26), squash: dp.squash - 0.15 * kick(t, tEnth + 0.5, 0.26), lookX: 0.5 * Math.sin((t - tCof) * 3), tilt: 6 * kick(t, tEnth + 0.8, 0.35) });
      }
      // cups up on "drinks", toast on "coffee"
      const cupK = cupPop(tDrink + 0.03 * k);
      h.cup.group.scale.setScalar(Math.max(0.001, cupK)); h.cup.group.visible = cupK > 0.01; h.cup.set({ steam: smooth(inv(tCof2, tCof2 + 0.2, t)), t });
      if (t >= tDrink) {
        if (h.type === 'nerd') Object.assign(p, { armL: 30 + 100 * raise + 10 * toast, armR: 25 });
        else Object.assign(p, { armR: 30 + 100 * raise + 10 * toast });
        p.mouth = t > tCof2 ? 'teeth' : p.mouth; p.lookX = 0; p.turn = 0;
      }
      if (t >= tAny) p.squash = (p.squash || 0) - 0.12 * kick(t, tCof2, 0.3);
      h.c.set(p);
      // label card pops, pops out on "anyone"
      const cp = clamp((t - cardT[key]) / 0.32), out = clamp((t - cardOut[key] - 0.02) / 0.12);
      h.card.set({ pop: t < cardOut[key] ? cp : 1 - out });
      // "enthusiasts": the COFFEE NERD card re-slams (squash pulse) on the second half of the label
      if (key === 'nerd') { const sl = kick(t, tEnth + 0.03, 0.22); h.card.group.scale.set(1 + 0.12 * sl, 1 - 0.1 * sl, 1); if (sl > 0.5) shake = Math.max(shake, 0.12); }
      h.card.group.position.y = 3.45 + 0.05 * Math.sin(t * 3 + k);
      h.card.group.rotation.z = 0.05 * Math.sin(t * 2.2 + k * 2);
      if (t >= cardT[key] && t < cardT[key] + 0.1) shake = Math.max(shake, 0.12);
      k++;
    }

    // ---- flood crowd on "anyone" ----
    for (const f of S.flood) {
      const ts = tAny - 0.02 + f.j * 0.035, dur = 0.42;
      const u = (t - ts) / dur;
      if (u < 0) { f.c.group.visible = false; continue; }
      f.c.group.visible = true;
      const uu = clamp(u), e = 1 - Math.pow(1 - uu, 2);
      const x = lerp(f.x + f.side * 8.5, f.x, e);
      const travelHop = uu < 1 ? Math.abs(Math.sin(uu * Math.PI * 2)) * 0.7 : 0;
      const d = Math.max(0, t - ts - dur), land = u >= 1 ? 0.5 * Math.exp(-8 * d) * Math.cos(d * 24) : -0.2 * Math.abs(Math.cos(uu * Math.PI * 2));
      f.c.group.position.set(x, travelHop + cheerHop(0.015 * f.j), f.z);
      const p = { squash: land, turn: uu < 1 ? -f.side * 55 * (1 - uu) : 0, walk: uu < 1 ? t * 3 : undefined, blink: blinkAt(t, f.i + 7),
        lookX: -0.25 * f.side * smooth(inv(ts + dur, ts + dur + 0.4, t)), mouth: t > tCof2 ? 'teeth' : undefined };
      const cupK = cupPop(tDrink + 0.012 * f.j);
      f.cup.group.scale.setScalar(Math.max(0.001, cupK)); f.cup.group.visible = cupK > 0.01; f.cup.set({ steam: smooth(inv(tCof2, tCof2 + 0.2, t)), t: t + f.i * 0.3 });
      if (t >= tDrink) { const a = 30 + 100 * raise + 10 * toast; if (f.type === 'nerd') p.armL = a; else p.armR = a; p.lookX = 0; }
      if (f.type === 'nerd' && f.c.acc.kettle) f.c.acc.kettle.visible = false;
      f.c.set(p);
    }

    // ---- ANYONE card slams down ----
    const ta = tAny + 0.1;
    const fall = clamp((t - (ta - 0.16)) / 0.16);
    S.anyCard.set({ pop: t < ta - 0.16 ? 0 : 1 });
    S.anyCard.group.position.y = 5.7 + (1 - fall * fall) * 6 + (t > ta ? 0.25 * Math.exp(-7 * (t - ta)) * Math.sin((t - ta) * 22) : 0);
    S.anyCard.inner.scale.set(1 + (t > ta ? 0.12 * Math.exp(-8 * (t - ta)) : 0), 1 - (t > ta ? 0.12 * Math.exp(-8 * (t - ta)) : 0), 1);
    S.anyCard.group.rotation.z = -0.04 + 0.03 * Math.sin(t * 2.4);
    if (t > ta) shake = Math.max(shake, 0.5 * Math.exp(-10 * (t - ta)));
    S.conf.set({ k: t < tCof2 ? 0 : clamp((t - tCof2) / 1.5) });
    if (t > tCof2) shake = Math.max(shake, 0.25 * Math.exp(-12 * (t - tCof2)));

    if (inside) {
      ctx.bg = { top: '#7fa9dc', mid: '#b3cfea', bottom: '#f1dfc4' };
      ctx.shake = shake;
      const o = spec.o, f = (a) => [a[0] + o[0], a[1] + o[1], a[2] + o[2]];
      if (t < tPro) ctx.focus = f([SLOT.student[0], 1.8, SLOT.student[2]]);
      else if (t < tCof) ctx.focus = f([SLOT.pro[0], 1.8, SLOT.pro[2]]);
      else if (t < tAny) ctx.focus = f([SLOT.nerd[0], 1.8, SLOT.nerd[2]]);
      else ctx.focus = f([0, 3.0, 3.6]);
      ctx.dof = t < tAny ? 1.2 : 0.45;
    }
  },

  camera(ctx, t, spec) {
    const o = spec.o;
    const W = (w, n = 0) => ctx.wordAt(w, spec.t0, n) ?? spec.t0;
    const tPro = W('professionals'), tCof = W('coffee'), tEnth = W('enthusiasts'), tAny = W('anyone'), tCof2 = W('coffee', 1);
    const P = (pos, tg, fov, roll) => ({ pos: [pos[0] + o[0], pos[1] + o[1], pos[2] + o[2]], target: [tg[0] + o[0], tg[1] + o[1], tg[2] + o[2]], fov, roll });
    const L3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
    const dr = (s) => U.drift(t * 1.3, s) * 0.12;
    let pos, tg, fov = 35, roll = 0;
    if (t < tPro) {                      // A: student, low from the right, push in
      const k = smooth(inv(spec.t0 - 0.4, tPro, t));
      pos = L3([-0.5, 1.5, 20.0], [-1.3, 1.9, 18.2], k); tg = [-2.6 + dr(1), 2.15, 4.4]; roll = lerp(-4, -1.5, k);
    } else if (t < tCof) {               // B: pro, from the left, dutch the other way
      const k = smooth(inv(tPro, tCof, t));
      pos = L3([-2.9, 3.0, 19.6], [-2.0, 2.6, 18.2], k); tg = [0.15 + dr(2), 2.15, 4.7]; roll = lerp(4.5, 2, k);
    } else if (t < tEnth + 0.45) {       // C1: nerd, high-ish front-right
      const k = smooth(inv(tCof, tEnth + 0.45, t));
      pos = L3([4.8, 3.6, 19.4], [4.0, 3.0, 17.8], k); tg = [2.5 + dr(3), 2.15, 4.4]; roll = lerp(-3.5, -1.5, k);
    } else if (t < tAny) {               // C2: punch in, low left
      const k = smooth(inv(tEnth + 0.45, tAny, t));
      pos = L3([1.5, 1.6, 18.6], [1.8, 1.7, 17.4], k); tg = [2.6, 2.25, 4.4]; roll = lerp(3, 1.5, k);
    } else {                             // D: wide, pull back to reveal the flood, punch on "coffee"
      const k = U.easeOut(inv(tAny, tAny + 0.7, t));
      const pk = t < tCof2 ? 0 : spring(clamp((t - tCof2) / 0.6), 2.4, 6) ;
      pos = L3([0.8, 5.6, 19.0], [1.4, 7.4, 23.6], k); pos = L3(pos, [1.2, 6.8, 21.6], pk);
      tg = [-0.1 + dr(4), 2.7, 2.8]; roll = lerp(-3, 1.5, k); fov = 38;
    }
    return P(pos, tg, fov, roll);
  },
};
