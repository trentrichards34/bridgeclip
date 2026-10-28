// LIBRARY REFERENCE (k04_everyone.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k04_everyone 7.0-9.4  "The first business tries to attract everyone."
// CORNER CAFE on the street. RED hops onto a crate ("first"), the shop sign bounces ("business"), the megaphone pops into his hand.
// Hard cut on "tries": over RED's shoulder at the whole city across the street; red aim arrows fan out from the megaphone and
// thunk into every building, landing one after another across "attract". Hard cut on "everyone": front shot, a huge
// EVERYONE banner drops + unrolls above RED, flash, confetti, RED throws both arms up.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import * as U from '/engine/core/util.js';

const { clamp, inv, lerp, smooth, backOut, spring, easeOut } = U;
const K = KT.K, C = L.C;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const CRATE = V(1.4, 0, 6.2), CRATE_H = 1.0;
const SKY_Z = 10;          // across-the-street skyline group z (rotated to face the shop)
const BAN = V(1.4, 7.5, 3.6), BAN_W = 5.6, BAN_H = 2.5;

let S = null;

function makeArrow(ctx) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.0, 10), L.mat(C.woodLight, { felt: 0.5 }));
  shaft.rotation.x = Math.PI / 2; group.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 14), L.mat(K.red, { scale: 1.5 }));
  head.rotation.x = Math.PI / 2; head.position.z = 1.25; group.add(head);
  const fm = L.mat(K.cream, { side: THREE.DoubleSide });
  L.B(0.05, 0.42, 0.55, fm, { r: 0.02, z: -0.8, parent: group });
  L.B(0.42, 0.05, 0.55, fm, { r: 0.02, z: -0.8, parent: group });
  // tip at origin: shift children back so the head point sits at z 0
  group.children.forEach((m) => { m.position.z -= 1.55; });
  const outer = new THREE.Group(); outer.add(group);
  return { group: outer };
}

function makeCrate(ctx) {
  const g = new THREE.Group();
  const wm = L.mat(C.woodLight, { scale: 1.3 }), dm = L.mat(C.wood, { scale: 1.3 });
  L.B(2.3, CRATE_H, 1.7, wm, { r: 0.06, y: CRATE_H / 2, parent: g });
  for (const y of [0.22, 0.5, 0.78]) L.B(2.36, 0.07, 1.76, dm, { r: 0.02, y, parent: g });
  for (const s of [-1, 1]) L.B(0.12, CRATE_H + 0.02, 1.78, dm, { r: 0.03, x: s * 1.1, y: CRATE_H / 2, parent: g });
  // stencil sticker: coffee cup on the front
  const st = KT.makeIconSticker(ctx, 'cup', { size: 0.62, bg: K.red, color: K.cream }); st.position.set(0, 0.5, 0.88); g.add(st);
  return { group: g };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, rotY = 0) => { o.group.position.set(x, y, z); o.group.rotation.y = rotY; root.add(o.group); return o; };

    // ---- street + shops + skyline behind ----
    const street = at(KT.makeStreet(ctx, { w: 60, lamps: 3 }), -4, 0, 0);
    const skyBack = at(KT.makeSkyline(ctx, { w: 70, z: -12, seed: 9 }), 0, 0, 0);
    const shop = at(KT.makeShop(ctx, { preset: 'red' }), 0, 0, 0);
    const shop2 = at(KT.makeShop(ctx, { preset: 'green' }), 10.2, 0, 0);
    // ---- across the street: ground + the whole city facing the shop ----
    L.B(90, 0.3, 30, L.mat(K.sidewalk, { scale: 0.7 }), { r: 0, y: -0.15, z: 17.25 + 15, parent: root });
    L.B(90, 0.34, 0.5, L.mat('#d9d2c4'), { r: 0.06, y: -0.13, z: 17.5, parent: root });
    const city = at(KT.makeSkyline(ctx, { w: 44, z: -12, seed: 23 }), 0, 0, SKY_Z, Math.PI);
    city.set({ rise: 1 });
    root.updateMatrixWorld(true);
    // pick front-row buildings facing us as arrow targets (world-local coords of root)
    const tmp = new THREE.Box3();
    const fronts = city.buildings.map((b, i) => {
      tmp.setFromObject(b.g);
      const lo = root.worldToLocal(tmp.min.clone()), hi = root.worldToLocal(tmp.max.clone());
      const box = { minX: Math.min(lo.x, hi.x), maxX: Math.max(lo.x, hi.x), minZ: Math.min(lo.z, hi.z), top: Math.max(lo.y, hi.y) };
      return { i, b, x: (box.minX + box.maxX) / 2, w: box.maxX - box.minX, z: box.minZ, top: box.top };
    }).filter((f) => f.z < SKY_Z + 15.5 && f.x > -8.5 && f.x < 9.5).sort((a, b) => b.x - a.x).slice(0, 8);
    const targets = fronts.map((f, j) => ({ f, p: V(f.x + (j % 2 ? 0.4 : -0.4), Math.min(f.top - 1.4, 4.5 + (j % 3) * 1.6), f.z - 0.05) }));

    // ---- the crate + RED ----
    const crate = makeCrate(ctx); crate.group.position.copy(CRATE); root.add(crate.group);
    const red = at(KT.makeFounder(ctx, 'red'), CRATE.x, CRATE_H, CRATE.z);
    const mega = KT.makeMegaphone(ctx); red.holdL(mega.group, [-0.1, -0.1, 0.2]); mega.group.rotation.y = -0.3;
    // dust puffs on the landing
    const dustM = new THREE.MeshStandardMaterial({ color: '#efe4cf', transparent: true, opacity: 0.6, depthWrite: false, roughness: 1 });
    const dust = [];
    for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), dustM); m.castShadow = false; root.add(m); dust.push({ m, a: (i / 7) * Math.PI * 2 + 0.3 }); }

    // ---- arrows with dotted trails ----
    const dotGeo = new THREE.SphereGeometry(0.14, 8, 6), dotM = L.mat(K.red, { felt: 0.3 });
    const arrows = targets.map((tg, i) => {
      const a = makeArrow(ctx); a.group.children[0].scale.setScalar(1.5); root.add(a.group);
      const dots = []; for (let d = 0; d < 18; d++) { const m = new THREE.Mesh(dotGeo, dotM); m.castShadow = false; root.add(m); dots.push(m); }
      const sp = L.makeSparkle(ctx, { size: 1.1, seed: 300 + i }); sp.group.position.copy(tg.p).add(V(0, 0, -0.4)); root.add(sp.group);
      return { ...a, tg, dots, sp, arcH: 1.6 + (i % 3) * 0.7 };
    });

    // ---- banner + fx ----
    const banner = KT.makeBanner(ctx, 'EVERYONE', { w: BAN_W, h: BAN_H }); root.add(banner.group);
    const conf = L.makeConfetti(ctx, { n: 110, spread: 7, height: 5 }); conf.group.position.set(BAN.x, BAN.y + 0.4, BAN.z + 1.2); root.add(conf.group);
    const sparks = [[-2.6, -0.3], [2.7, -1.9]].map(([x, y], i) => { const s = L.makeSparkle(ctx, { size: 0.9, seed: 400 + i }); s.group.position.set(BAN.x + x, BAN.y + y, BAN.z + 0.4); root.add(s.group); return s; });

    // fill light for the city faces (core's key comes from behind them when we look across the street)
    const fill = new THREE.DirectionalLight('#ffe6c8', 0); fill.position.set(6, 26, -8); fill.target.position.set(0, 4, 26);
    root.add(fill, fill.target);

    S = { root, street, skyBack, shop, shop2, city, crate, red, mega, dust, arrows, banner, conf, sparks, fill };
  },

  update(ctx, t, spec) {
    if (!S) return;
    const on = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    S.root.visible = on; if (!on) return;
    const W = (w) => ctx.wordAt(w, spec.t0 - 0.1) ?? spec.t0;
    const tFirst = W('first'), tBiz = W('business'), tTries = W('tries'), tAttract = W('attract'), tEvery = W('everyone');
    const after = (t0) => Math.max(0, t - t0);
    const decay = (t0, r = 8) => (t >= t0 ? Math.exp(-r * (t - t0)) : 0);
    const wob = (t0, f = 22, r = 6) => (t >= t0 ? Math.exp(-r * (t - t0)) * Math.sin((t - t0) * f) : 0);

    S.street.set({ rise: 1 }); S.skyBack.set({ rise: 1 });
    S.shop.set({ shutter: 0, open: 0.35, sign: 1, t });
    S.shop2.set({ shutter: 0, open: 0, sign: 1, t: t + 1 });
    // "business": the CORNER CAFE sign bounces
    const sb = 1 + 0.16 * wob(tBiz, 20, 5);
    S.shop.sign.scale.set(sb, 2 - sb, 1);

    // ---- RED: hop onto the crate, land on "first" ----
    const hop0 = tFirst - 0.42;
    const hk = clamp((t - hop0) / (tFirst - hop0));
    const from = V(CRATE.x - 1.3, 0, CRATE.z + 1.3), to = V(CRATE.x, CRATE_H, CRATE.z);
    const p = new THREE.Vector3().lerpVectors(from, to, smooth(hk));
    if (t < tFirst) p.y += 4 * hk * (1 - hk) * 1.5;
    S.red.group.position.copy(p);
    S.red.group.rotation.y = lerp(0.5, 0, smooth(hk));
    S.crate.group.scale.set(1 + 0.08 * Math.abs(wob(tFirst, 26, 7)), 1 - 0.12 * Math.abs(wob(tFirst, 26, 7)), 1);

    const land = wob(tFirst, 20, 6);
    let squash = t < tFirst ? (hk < 0.15 ? 0.3 : -0.25 * Math.sin(Math.PI * hk)) : 0.55 * land;
    let hop = 0, armL = 20, reachL = 0, armR = 20, reachR = 0, mouth = 'teeth', mouthOpen = 0, brow = 0, lean = 0, lookX = 0, lookY = 0;
    if (t < tFirst) { armL = armR = 120 * Math.sin(Math.PI * hk); }
    // megaphone pops into the left hand on "business", then up to the mouth
    const mp = clamp((t - (tBiz - 0.04)) / 0.22);
    S.mega.group.scale.setScalar(mp <= 0 ? 0.001 : Math.max(0.001, backOut(mp, 2.6)));
    const raise = smooth(inv(tBiz + 0.12, tBiz + 0.3, t));
    armL = lerp(lerp(armL, 150, smooth(inv(tBiz - 0.05, tBiz + 0.1, t))), 75, raise);
    reachL = lerp(0, 60, raise);
    armR = t > tBiz ? lerp(20, 35, raise) : armR;
    if (t >= tBiz + 0.2) { mouthOpen = 0.5 + 0.4 * Math.abs(Math.sin(t * 17)); brow = 14; }
    // shouting pumps from "tries"
    if (t >= tTries && t < tEvery) {
      hop = 0.12 * Math.abs(Math.sin((t - tTries) * Math.PI * 4.2)); lean = 8; squash += -0.08 * Math.sin((t - tTries) * Math.PI * 8.4);
      armR = 60 + 30 * Math.sin((t - tTries) * 16); reachR = 20;
    }
    // "everyone": both arms up, big hop
    if (t >= tEvery) {
      const e = after(tEvery);
      hop = 0.8 * Math.max(0, Math.sin(Math.PI * clamp(e / 0.34))) + 0.35 * Math.max(0, Math.sin(Math.PI * clamp((e - 0.5) / 0.28)));
      squash = e < 0.34 ? -0.25 * Math.sin(Math.PI * e / 0.34) : 0.4 * wob(tEvery + 0.34, 20, 7);
      armR = lerp(35, 160, smooth(clamp(e / 0.12))); armL = lerp(75, 150, smooth(clamp(e / 0.12))); reachL = lerp(60, 10, smooth(clamp(e / 0.12)));
      reachR = 0; lean = -6; lookY = 0.3; mouthOpen = 0.8; brow = 0;
    }
    const blink = ((t * 1.1 + 0.3) % 2.7) < 0.08 ? 1 : 0;
    S.red.set({ hop, squash, armL, reachL, armR, reachR, mouth, mouthOpen, brow, lean, lookX, lookY, blink, tilt: 4 * Math.sin(t * 5) });
    const up = t >= tEvery ? smooth(clamp((t - tEvery) / 0.15)) : 0;
    const aimUp = t >= tTries && t < tEvery ? -0.5 : 0;
    S.mega.group.rotation.set(-1.0 * up + aimUp, -0.3, 0);
    S.mega.set({ blast: t >= tBiz + 0.25 ? 1 : 0, t });

    // dust ring on the landing
    const dk = clamp((t - tFirst) / 0.5);
    S.dust.forEach((d) => {
      d.m.visible = t >= tFirst && dk < 1;
      const r = 0.9 + 1.1 * easeOut(dk);
      d.m.position.set(CRATE.x + Math.cos(d.a) * r * 1.2, 0.2 + 0.3 * dk, CRATE.z + Math.sin(d.a) * r * 0.9);
      d.m.scale.set(Math.max(0.001, 0.22 + 0.25 * dk), Math.max(0.001, 0.12 + 0.12 * dk), Math.max(0.001, 0.22 + 0.25 * dk));
    });
    S.dust[0].m.material.opacity = 0.45 * (1 - dk);

    // ---- arrows: launch from the megaphone mouth after "tries", land across "attract" ----
    S.root.updateMatrixWorld(true);
    const mouthW = S.mega.group.localToWorld(S.mega.mouth.clone().add(V(0, 0, 0.3)));
    const start = S.root.worldToLocal(mouthW);
    const n = S.arrows.length, FL = 0.42;
    const span = Math.max(0.25, (tEvery - 0.06) - (tAttract - 0.02) - 0.0);
    S.arrows.forEach((a, i) => {
      const land = (tAttract - 0.02) + (n > 1 ? (i / (n - 1)) * Math.min(span, 0.32) : 0);
      const l0 = land - FL, k = clamp((t - l0) / FL);
      const vis = k >= 0.14;
      a.group.visible = vis;
      const end = a.tg.p;
      const P = (s) => new THREE.Vector3().lerpVectors(start, end, s).add(V(0, 4 * s * (1 - s) * a.arcH, 0));
      const pos = P(k), ahead = k < 1 ? P(Math.min(1, k + 0.02)) : P(1).add(V(0, 0, 1).multiplyScalar(0.0)).add(end.clone().sub(P(0.98)));
      a.group.position.copy(pos);
      a.group.lookAt(ahead.clone().add(S.root.position));
      if (k >= 1) { const w = wob(land, 34, 7); a.group.rotateX(0.12 * w); a.group.rotateY(0.08 * w); }
      a.group.scale.setScalar(vis ? (k < 0.3 ? Math.max(0.001, backOut((k - 0.14) / 0.16)) : 1) : 0.001);
      a.dots.forEach((d, j) => { const s = (j + 0.5) / a.dots.length; d.visible = vis && s > 0.16 && s < k - 0.04; d.position.copy(P(s)); });
      a.sp.set({ k: t < land ? 0 : clamp((t - land) / 0.7) });
      // the hit building jumps
      const b = a.tg.f.b.g, bump = wob(land, 24, 6);
      b.scale.set(1 - 0.05 * bump, 1 + 0.08 * bump, 1);
    });

    // ---- banner drops + unrolls on "everyone" ----
    const e = after(tEvery);
    const drop = t < tEvery ? 0 : spring(clamp(e / 0.5), 2.6, 6);
    S.banner.group.position.set(BAN.x, BAN.y + (1 - drop) * 3.5, BAN.z);
    S.banner.group.rotation.x = -0.25 * wob(tEvery + 0.12, 14, 4);
    S.banner.group.rotation.z = 0.04 * wob(tEvery + 0.3, 9, 2.5);
    S.banner.group.visible = t >= tEvery - 0.02;
    S.banner.set({ unroll: easeOut(clamp((e - 0.06) / 0.26)) });
    S.conf.set({ k: t < tEvery ? 0 : clamp((e - 0.05) / 1.5) });
    S.sparks.forEach((s, i) => s.set({ k: t < tEvery + 0.3 + i * 0.15 ? 0 : clamp((t - tEvery - 0.3 - i * 0.15) / 0.8) }));

    // city fill light only while we look across the street
    S.fill.intensity = t >= tTries && t < tEvery ? 1.6 : 0;

    // ---- frame overrides ----
    if (t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2) {
      const o = spec.o, f = (v) => [o[0] + v.x, o[1] + v.y, o[2] + v.z];
      if (t < tTries) ctx.focus = f(S.red.group.position.clone().add(V(0, 1.6, 0.6)));
      else if (t < tEvery) { const j = clamp(Math.floor((t - tAttract) / 0.05), 0, S.arrows.length - 1); ctx.focus = f(t < tAttract ? V(0.5, 6, 18) : S.arrows[j].tg.p); }
      else ctx.focus = f(V(CRATE.x, 3.6, CRATE.z - 0.6));
      ctx.dof = t >= tTries && t < tEvery ? 0.45 : 0.9;
      ctx.bg = { top: '#7fa9dc', mid: '#b4d0ea', bottom: '#f1d8b4' };
      ctx.exposure = 1.0;
      ctx.shake = 0.4 * decay(tFirst, 9) + 0.18 * decay(tAttract, 10) + 0.45 * decay(tEvery + 0.1, 7);
      ctx.flash = t >= tEvery ? 0.3 * Math.exp(-12 * (t - tEvery)) : 0;
    }
  },

  camera(ctx, t, spec) {
    const o = spec.o, P = (p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
    const W = (w) => ctx.wordAt(w, spec.t0 - 0.1) ?? spec.t0;
    const tTries = W('tries'), tEvery = W('everyone');
    const dr = (s) => U.drift(t * 1.4, s) * 0.1;
    if (t < tTries) {
      // A: low front 3/4 on RED + crate, CORNER CAFE sign above; push in, dutch easing out
      const k = smooth(inv(spec.t0 - 0.4, tTries, t));
      return { pos: P([lerp(4.8, 3.2, k) + dr(1), lerp(1.3, 1.8, k) + dr(2), lerp(18.0, 14.8, k)]),
        target: P([lerp(1.3, 1.1, k), lerp(4.0, 3.8, k), 4.2]), fov: 46, roll: lerp(-7, -2.5, k) };
    }
    if (t < tEvery) {
      // B: over RED's shoulder at the city across the street; pans right (toward -X) following the arrows
      const k = smooth(inv(tTries, tEvery, t));
      const cam = [lerp(-0.1, 0.2, k) + dr(3), lerp(2.6, 2.75, k) + dr(4), lerp(0.9, 1.1, k)];
      const yaw = THREE.MathUtils.degToRad(lerp(2, -14, k)), pit = THREE.MathUtils.degToRad(lerp(18, 16, k)), D = 24;
      const tg = [cam[0] + D * Math.sin(yaw) * Math.cos(pit), cam[1] + D * Math.sin(pit), cam[2] + D * Math.cos(yaw) * Math.cos(pit)];
      return { pos: P(cam), target: P(tg), fov: 54, roll: lerp(3, -3, k) };
    }
    // C: front, a touch low, banner on top; slow push, dutch settling
    const k = smooth(inv(tEvery, spec.t1 + 0.4, t));
    return { pos: P([lerp(2.6, 1.9, k) + dr(5), lerp(2.0, 2.5, k) + dr(6), lerp(18.2, 16.4, k)]),
      target: P([1.4, lerp(4.2, 4.4, k), 4.0]), fov: 53, roll: lerp(5, 1.5, k) };
  },
};
