// LIBRARY REFERENCE (k10_might.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k10_might 29.6-32.2 "The first business has a product people might like."
// A (The..has): CORNER CAFE storefront, RED pops up behind his market counter mid-hop (frame 0), points up at his sign on "first",
//   ta-da arms on "business", ducks under the counter on "has".
// B ("product"): hard cut, close + low: the cup slams onto the counter (shake, steam burst, sparkle), RED presents it proudly.
// C ("people"): hard cut, reverse over RED's shoulder: the crowd pops up staring blankly at the cup, synced blink.
// D ("might" -> "like."): hard cut, high front: MAYBE? meter springs up on the counter, needle swings NO<->YES and can't decide;
//   crowd shrugs one by one, a tumbleweed bounces across on "like", RED's grin drops to a flat line, sweat drop.
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
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, ry = 0) => { o.group.position.set(x, y, z); o.group.rotation.y = ry; root.add(o.group); return o; };
    const w = (n, d) => ctx.wordAt(n, spec.t0 - 0.1) ?? d;
    const T = {
      the: w('The', 29.66), first: w('first', 29.82), business: w('business', 29.98), has: w('has', 30.30),
      product: w('product', 30.62), people: w('people', 30.86), might: w('might', 31.18), like: w('like.', 31.50),
    };

    const street = at(KT.makeStreet(ctx, { w: 60 }), 0, 0, -3.5);
    at(KT.makeSkyline(ctx, { w: 70, z: -14 }), 0, 0, -7);
    const sky2 = at(KT.makeSkyline(ctx, { w: 70, z: -14 }), 0, 0, 16, Math.PI);   // fills the reverse shot
    const shop = at(KT.makeShop(ctx, { preset: 'red' }), 0.3, 0, -6.2);

    // market counter in front of the shop: red front panel with cream stripes, cream top
    const counter = new THREE.Group(); counter.position.set(0.5, 0, 0); root.add(counter);
    const cw = 5.6, ch = 0.85;
    L.B(cw, ch, 1.2, L.mat(K.red, { scale: 1.2 }), { r: 0.08, y: ch / 2, parent: counter });
    for (let i = 0; i < 5; i++) L.B(0.32, ch - 0.18, 0.04, L.mat(K.cream), { r: 0.02, x: -cw / 2 + 0.7 + i * (cw - 1.4) / 4, y: ch / 2, z: 0.61, parent: counter });
    L.B(cw + 0.3, 0.14, 1.45, L.mat(C.woodLight), { r: 0.05, y: ch + 0.07, parent: counter });
    const top = ch + 0.14;

    const red = at(KT.makeFounder(ctx, 'red'), -1.3, 0.3, -1.1);
    const cup = at(KT.makeCup(ctx, { color: K.red, icon: 'bean', size: 1.35 }), 0.3, top, 0.05);
    const meter = at(KT.makeMeter(ctx, 'MAYBE?', { stand: 0.7 }), 2.2, top, -0.05, -0.12);
    const sweat = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), L.mat('#8fd0f2', { felt: 0.2, rough: 0.2 }));
    sweat.scale.set(1, 1.5, 1); root.add(sweat);

    // crowd in front of the counter, facing it (backs to the front camera, faces for the reverse shot)
    const crowd = [
      at(KT.makeCrowdMember(ctx, 'student', 3), -0.9, 0, 3.6, Math.PI - 0.15),
      at(KT.makeCrowdMember(ctx, 'nerd', 4), 1.2, 0, 4.1, Math.PI),
      at(KT.makeCrowdMember(ctx, 'anyone', 6), 3.3, 0, 3.5, Math.PI + 0.2),
      at(KT.makeCrowdMember(ctx, 'pro', 7), -2.9, 0, 3.0, Math.PI - 0.35),
    ];

    // tumbleweed: a ball of crossed twigs
    const tw = new THREE.Group(); root.add(tw);
    const twM = L.mat('#b08a55', { felt: 1 }), twD = L.mat('#8a6a3e', { felt: 1 }), r = L.rng(10);
    for (let i = 0; i < 22; i++) {
      const m = L.B(1.3 + r() * 0.3, 0.07, 0.07, i % 2 ? twM : twD, { r: 0.02, parent: tw });
      m.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI); m.position.set((r() - 0.5) * 0.2, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2);
    }
    tw.scale.setScalar(0.85);

    const spark = at(L.makeSparkle(ctx, { size: 0.7 }), 1.0, top + 1.6, 0.2);
    const spark2 = at(L.makeSparkle(ctx, { size: 1.4, seed: 7 }), 0.3, 6.4, -5.6);
    S = { root, T, shop, red, cup, meter, sweat, crowd, tw, spark, spark2, top, sky2, street };
  },

  update(ctx, t, spec) {
    const { root, T, shop, red, cup, meter, sweat, crowd, tw, spark, spark2, top, street } = S;
    const U = ctx.U;
    root.visible = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    if (!root.visible) return;
    const inWin = t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2;

    street.set({ rise: 1 }); for (const p of street.props) if (Math.abs(p.g.position.x) < 6.5) p.g.visible = false;   // keep the counter clear
    shop.set({ shutter: 0, open: 0.3, sign: 1, t: t * 1.4 });
    shop.sign.scale.setScalar(1 + 0.1 * pulse(t, T.first, 0.22) + 0.06 * pulse(t, T.business, 0.2));

    // ---- RED
    const pop0 = spec.t0 - 0.5;   // already mid-hop at t0 (frame 0 = action)
    const hopK = clamp((t - pop0) / (T.the + 0.02 - pop0));
    const hopA = t < T.the + 0.02 ? Math.sin(Math.PI * hopK) * 1.1 : 0;
    const land = T.the + 0.02, landSq = t >= land ? 0.32 * decay(t, land, 9) * Math.cos((t - land) * 18) : 0;
    const duck = U.win(t, T.has, T.product + 0.02, 0.12, 0.06);               // ducks under counter to grab the cup
    const pres = t >= T.product ? U.spring(clamp((t - T.product) / 0.45)) : 0;  // presenting
    const doubt = t >= T.might + 0.12 ? U.easeOut(clamp((t - T.might - 0.12) / 0.3)) : 0;
    const ta = pulse(t, T.business, 0.32);
    const point = U.win(t, T.first - 0.04, T.business, 0.08, 0.06);
    red.group.position.y = 0.3 - duck * 0.75;
    red.set({
      hop: hopA + 0.25 * pulse(t, T.business, 0.22) + 0.3 * pulse(t, T.product, 0.2),
      squash: landSq + duck * 0.25 - 0.18 * pulse(t, T.business, 0.22) + 0.2 * pulse(t, T.product + 0.18, 0.15),
      armL: Math.max(160 * point, 120 * ta, 70 * pres * (1 - doubt), 35), reachL: 20 * point + 50 * pres * (1 - doubt),
      armR: Math.max(130 * ta, 75 * pres * (1 - doubt), 40 * (1 - point)), reachR: 50 * pres * (1 - doubt),
      lookX: point > 0.3 ? -0.2 : doubt > 0 ? 0.55 * Math.sin((t - T.might) * 9) : 0.25 * pres,
      lookY: point > 0.3 ? 0.9 : pres > 0 && doubt < 0.5 ? -0.2 : 0,
      tilt: Math.sin(t * 6.5) * 3 + doubt * 6, nod: duck * 25 - 8 * doubt,
      mouth: doubt > 0.4 ? 'flat' : 'teeth', mouthOpen: 0.4 * Math.max(pulse(t, T.business, 0.3), pulse(t, T.product, 0.3)),
      brow: doubt > 0.3 ? -14 : 0, blink: pulse(t, 30.42, 0.1) + pulse(t, T.like + 0.25, 0.12),
    });
    // sweat drop slides down RED's temple once doubt sets in
    const sk = clamp((t - T.like + 0.05) / 0.7);
    sweat.visible = t > T.like - 0.05;
    sweat.position.set(-0.35, 2.55 - sk * 0.45, -0.25);
    sweat.scale.set(1, 1.5, 1).multiplyScalar(Math.max(0.01, U.backOut(clamp(sk * 3))));

    // ---- the cup: slams down from above on "product"
    const sl = T.product + 0.05, fallT0 = T.product - 0.1, fk = clamp((t - fallT0) / (sl - fallT0));
    cup.group.position.y = top + (t < fallT0 ? 6 : (1 - fk * fk) * 3.5);
    const csq = t >= sl ? decay(t, sl, 8) * Math.cos((t - sl) * 24) : 0;
    const wob = t > T.might ? 0.05 * Math.sin((t - T.might) * 7) * decay(t, T.might, 1.5) : 0;
    cup.group.scale.set(1 + 0.22 * csq, Math.max(0.3, 1 - 0.3 * csq), 1 + 0.22 * csq);
    cup.group.rotation.z = wob;
    cup.group.visible = t > fallT0;
    const steamK = t < sl ? 0 : 1.2 * decay(t, sl, 3) + 0.6 - 0.4 * clamp((t - T.like) / 0.6);
    cup.set({ steam: steamK, t });
    spark.set({ k: clamp((t - sl) / 1.0) }); spark.group.visible = t > sl && t < T.people;
    spark2.set({ k: clamp((t - T.business) / 0.9) }); spark2.group.visible = t > T.business && t < T.business + 0.9;

    // ---- meter: springs up on "might", needle swings wildly and can't settle
    const mT = T.might, mk = t > mT ? U.spring(clamp((t - mT) / 0.5), 2.8, 5) : 0;
    meter.group.visible = mk > 0.01;
    meter.group.scale.set(Math.max(0.01, mk) * 0.62, Math.max(0.01, mk) * 0.62 * (1 + 0.1 * decay(t, mT + 0.12, 9) * Math.sin((t - mT) * 30)), Math.max(0.01, mk) * 0.62);
    const nt = t - mT;
    const val = nt < 0 ? 0.5 : 0.5 + 0.42 * Math.sin(nt * 11 + 0.6) * Math.exp(-nt * 1.1) + 0.06 * Math.sin(nt * 5.3);
    meter.set({ value: val });
    meter.face.rotation.z = 0.04 * Math.sin(nt * 13) * decay(t, mT, 2);

    // ---- crowd: pops up on "people" (blank stare), shrugs one by one on might/like
    const shrugT = [T.might + 0.18, T.like, T.like + 0.1, T.might + 0.3];
    crowd.forEach((c, i) => {
      const pT = T.people + i * 0.06, pk = t > pT ? 1 : 0;
      const ps = pk ? U.spring(clamp((t - pT) / 0.4), 2.6, 5) : 0;
      c.group.visible = ps > 0.01; c.group.scale.setScalar(Math.max(0.01, ps));
      const ph = i * 1.9, idle = Math.sin(t * 5 + ph) * 0.04;
      const upHop = 0.55 * pulse(t, pT, 0.24);
      const sh = t > shrugT[i] ? U.spring(clamp((t - shrugT[i]) / 0.5)) : 0;
      c.set({ hop: upHop + idle + 0.18 * pulse(t, shrugT[i], 0.2), squash: (pk ? -0.2 * decay(t, pT, 7) * Math.cos((t - pT) * 18) : 0.15),
        armL: 80 * sh, armR: 80 * sh, tilt: (i % 2 ? -8 : 8) * sh + Math.sin(t * 3 + ph) * 2,
        lookX: i < 2 ? 0.2 : -0.25, lookY: -0.15, mouth: 'flat', mouthOpen: 0, nod: -4 * sh,
        blink: pulse(t, T.people + 0.18, 0.12) + pulse(t, T.like + 0.3, 0.12) });
    });

    // ---- tumbleweed bounces across between crowd and counter (screen left -> right)
    const twT0 = T.might + 0.15, twk = (t - twT0) / 1.5;
    tw.visible = twk > 0 && twk < 1;
    const x = -5.5 + twk * 12, bounce = Math.abs(Math.sin(twk * Math.PI * 3.2)) * 1.1;
    tw.position.set(x, 0.6 + bounce, 1.9);
    tw.rotation.set(0.3, 0, -twk * 14);

    if (!inWin) return;
    const o = spec.o;
    const shot = t < T.product ? 'A' : t < T.people ? 'B' : t < T.might ? 'C' : 'D';
    ctx.focus = shot === 'A' ? [o[0] - 1.3, 2.2, o[2] - 1.1] : shot === 'B' ? [o[0] + 0.3, top + 0.8, o[2]]
      : shot === 'C' ? [o[0] + 0.3, 1.6, o[2] + 3.8] : [o[0] + 1.3, top + 1.4, o[2]];
    ctx.dof = shot === 'B' ? 0.9 : shot === 'D' ? 0.55 : 0.8;
    ctx.bg = { top: '#7fb0de', mid: '#b5d3ec', bottom: '#efe2c8' };
    ctx.shake = Math.max(0.35 * decay(t, land, 12), 0.8 * decay(t, sl, 10) * (t >= sl ? 1 : 0), 0.25 * decay(t, mT + 0.1, 12) * (t > mT ? 1 : 0));
    ctx.flash = t >= sl ? 0.15 * decay(t, sl, 16) : 0;
  },

  camera(ctx, t, spec) {
    const { T, top } = S, o = spec.o, U = ctx.U;
    const W = (p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
    const dr = (s) => U.drift(t * 1.4, s) * 0.12;
    if (t < T.product) {   // A: low front-right, pushing in on RED behind the counter with the CORNER CAFE sign above
      const k = clamp((t - (spec.t0 - 0.4)) / (T.product - spec.t0 + 0.4)), ek = U.easeOut(k);
      return { pos: W([2.6 - ek * 1.4 + dr(1), 1.8 + ek * 0.3, 11.0 - ek * 2.2]), target: W([-0.9 + dr(2), 3.4 - ek * 0.4, -2.5]),
        fov: 50 - ek * 3 + 2 * pulse(t, T.first, 0.15), roll: -5 + ek * 4 + 3 * pulse(t, T.business, 0.3) };
    }
    if (t < T.people) {   // B: close + low on the counter top, slight push
      const k = clamp((t - T.product) / 0.5), ek = U.easeOut(k);
      return { pos: W([1.4 + dr(3), top + 0.75, 5.4 - ek * 0.5]), target: W([-0.1, top + 1.25, -0.4]), fov: 44 + 4 * decay(t, T.product + 0.05, 9), roll: 4 - ek * 2 };
    }
    if (t < T.might) {   // C: reverse over RED's shoulder onto the crowd's blank faces
      const k = clamp((t - T.people) / 0.4), ek = U.easeOut(k);
      return { pos: W([1.0 + dr(4), 3.3, -3.7 + ek * 0.4]), target: W([0.2, 1.5, 3.8]), fov: 64 - ek * 3, roll: -3 };
    }
    // D: high front over the crowd's heads: cup + MAYBE? meter + RED, push in, punch on "like"
    const k = clamp((t - T.might) / 1.2), ek = U.easeOut(k);
    return { pos: W([1.4 + dr(5) - ek * 0.2, 8.4 - ek * 0.4, 12.0 - ek * 1.6]), target: W([1.1, top + 1.0, -0.4]),
      fov: 44 - 3 * U.easeOut(clamp((t - T.like) / 0.25)) + 1.5 * decay(t, T.like, 6), roll: 3 - ek * 2 };
  },
};
