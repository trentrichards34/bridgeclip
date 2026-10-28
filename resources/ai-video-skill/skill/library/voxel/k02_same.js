// LIBRARY REFERENCE (k02_same.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k02_same 2.0-4.8 "Same city, similar products, similar budgets."
// Shot A (Same / city): both shops on one street, the skyline erupts behind them on "city", founders hop + look up in sync.
// Shot B (similar products): hard cut to a counter between the founders; both slam a cup down on "products", "=" card pops.
// Shot C (similar budgets): hard cut, 3/4 dutch angle; coins flicked into two jars on "budgets", jars fill in sync, "=" again.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const K = KT.K, C = L.C;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const inv = (a, b, x) => clamp((x - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k * k;
const backOut = (k, s = 2.2) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const spring = (k, f = 3.2, d = 5.5) => (k <= 0 ? 0 : 1 - Math.exp(-d * k) * Math.cos(f * Math.PI * k));
const dr = (t, s) => Math.sin(t * 0.83 + s) * 0.5 + Math.sin(t * 1.71 + s * 2.1) * 0.3 + Math.sin(t * 2.93 + s * 3.7) * 0.2;
// a quick squash pulse: 0 before t0, a sharp +1 at t0 settling to 0
const pulse = (t, t0, len = 0.35) => (t < t0 || t > t0 + len ? 0 : Math.exp(-6 * (t - t0) / len) * Math.cos(((t - t0) / len) * Math.PI * 2.2));
// hop arc in [t0, t0+len]
const hopArc = (t, t0, len, h) => (t < t0 || t > t0 + len ? 0 : Math.sin(((t - t0) / len) * Math.PI) * h);

let S = null;

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, p = root) => { o.group.position.set(x, y, z); p.add(o.group); return o; };

    const street = at(KT.makeStreet(ctx, { w: 60 }), 0, 0, 0);
    const sky = at(KT.makeSkyline(ctx, { w: 70, z: -12 }), 0, 0, 0);
    const shopR = at(KT.makeShop(ctx, { preset: 'red' }), -5, 0, 0);
    const shopG = at(KT.makeShop(ctx, { preset: 'green' }), 5, 0, 0);

    const red = at(KT.makeFounder(ctx, 'red'), -3.2, 0, 4.2);
    const green = at(KT.makeFounder(ctx, 'green'), 3.2, 0, 4.2);
    // cups held in the hand (shots A + B until the slam)
    const heldR = KT.makeCup(ctx, { color: K.red, icon: 'bean', size: 1.0 }); red.holdR(heldR.group, [0, -0.05, 0.3]);
    const heldG = KT.makeCup(ctx, { color: K.green, icon: 'door', size: 1.0 }); green.holdL(heldG.group, [0, -0.05, 0.3]);
    // coins held in shot C
    const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.07, 24);
    const coinMat = L.mat(C.gold, { rough: 0.35, metal: 0.6, felt: 0.3 });
    const mkCoin = () => { const g = new THREE.Group(); const m = new THREE.Mesh(coinGeo, coinMat); m.rotation.x = Math.PI / 2; m.castShadow = true; g.add(m); return g; };
    const coinR = mkCoin(), coinG = mkCoin();
    red.holdR(coinR, [0, 0.15, 0.25]); green.holdL(coinG, [0, 0.15, 0.25]);

    // the counter between the founders (shots B + C): half red, half green front
    const counter = new THREE.Group(); counter.position.set(0, 0, 5.6); root.add(counter);
    const CH = 0.9, CW = 3.6;
    L.B(CW, CH - 0.12, 1.3, L.mat(C.woodDark), { r: 0.06, y: (CH - 0.12) / 2, parent: counter });
    L.B(CW + 0.2, 0.14, 1.5, L.mat(C.woodLight), { r: 0.05, y: CH - 0.07, parent: counter });
    L.B(CW / 2 - 0.12, CH - 0.3, 0.06, L.mat(K.red), { r: 0.03, x: -CW / 4, y: (CH - 0.12) / 2, z: 0.66, parent: counter });
    L.B(CW / 2 - 0.12, CH - 0.3, 0.06, L.mat(K.forest), { r: 0.03, x: CW / 4, y: (CH - 0.12) / 2, z: 0.66, parent: counter });

    const crateM = L.mat(C.woodLight);
    const crates = [-1, 1].map((sx) => L.B(1.9, 0.7, 1.5, crateM, { r: 0.06, x: sx * 2.35, y: 0.35, z: -0.4, parent: counter }));
    // cups on the counter (after the slam)
    const cupR = at(KT.makeCup(ctx, { color: K.red, icon: 'bean', size: 1.35 }), -0.9, CH, 0.1, counter);
    const cupG = at(KT.makeCup(ctx, { color: K.green, icon: 'door', size: 1.35 }), 0.9, CH, 0.1, counter);
    // coin jars
    const jarR = at(KT.makeCoinJar(ctx, { label: 'BUDGET' }), -0.95, CH, 0.05, counter); jarR.group.scale.setScalar(0.95);
    const jarG = at(KT.makeCoinJar(ctx, { label: 'BUDGET' }), 0.95, CH, 0.05, counter); jarG.group.scale.setScalar(0.95);
    // the "=" card
    const eq = at(L.makeCard(ctx, { w: 0.82, h: 0.82, lines: [], pin: false, seed: 7 }), 0, 0, 0, counter);
    eq.draw((g, W, H) => { g.fillStyle = C.ink; const bw = W * 0.62, bh = H * 0.15; g.fillRect((W - bw) / 2, H * 0.3, bw, bh); g.fillRect((W - bw) / 2, H * 0.55, bw, bh); });
    const eqInner = eq.group;
    eqInner.scale.setScalar(1.35);
    const eqWrap = new THREE.Group(); counter.add(eqWrap); eqWrap.position.set(0, CH + 2.05, 0.2); eqWrap.add(eqInner); eqInner.position.set(0, 0, 0);
    const spark = at(L.makeSparkle(ctx, { size: 1.0 }), 1.5, CH + 3.0, 0.6, counter);
    const sparkJ = at(L.makeSparkle(ctx, { size: 1.0, seed: 9 }), -1.5, CH + 3.1, 0.6, counter);

    S = { root, street, sky, shopR, shopG, red, green, heldR, heldG, coinR, coinG, counter, cupR, cupG, jarR, jarG, eqWrap, spark, sparkJ, CH };
  },

  update(ctx, t, spec) {
    const s = S; if (!s) return;
    s.root.visible = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    if (!s.root.visible) return;
    const W = (w, n = 0) => ctx.wordAt(w, spec.t0, n);
    const tCity = W('city') ?? 2.24, tSim = W('similar') ?? 2.8, tProd = W('products') ?? 3.2, tSim2 = W('similar', 1) ?? 3.76, tBud = W('budgets') ?? 4.16;
    const shot = t < tSim ? 0 : t < tSim2 ? 1 : 2;

    // ---- set ----
    s.street.set({ rise: 1 }); for (const q of s.street.props) if (Math.abs(q.g.position.x) < 3) q.g.visible = false;
    s.sky.set({ rise: shot === 0 ? clamp((t - tCity) / 0.62) * 1.08 : 1.08 });
    s.shopR.set({ shutter: 0, open: 0.35, sign: 1, t });
    s.shopG.set({ shutter: 0, open: 0.35, sign: 1, t: t + 0.5 });
    const blink = (o) => { const p = (t + o) % 2.3; return p < 0.09 ? 1 - Math.abs(p - 0.045) / 0.045 : 0; };

    const { red, green } = s;
    s.counter.visible = shot > 0;
    s.coinR.visible = s.coinG.visible = false;
    s.heldR.group.visible = s.heldG.group.visible = false;
    s.cupR.group.visible = s.cupG.group.visible = false;
    s.jarR.group.visible = s.jarG.group.visible = false;
    s.eqWrap.visible = false;
    s.spark.set({ k: 0 }); s.sparkJ.set({ k: 0 });

    if (shot === 0) {
      // founders out front with cups, mirrored: hop on "Same", look up at the skyline on "city", second hop as it lands
      red.group.position.set(-3.2, 0, 4.2); green.group.position.set(3.2, 0, 4.2);
      s.heldR.group.visible = s.heldG.group.visible = true;
      s.heldR.set({ steam: 1, t }); s.heldG.set({ steam: 1, t: t + 0.3 });
      const hop = hopArc(t, spec.t0 - 0.05, 0.32, 0.55) + hopArc(t, tCity + 0.3, 0.3, 0.45);
      const sq = pulse(t, spec.t0 + 0.27, 0.3) * 0.6 + pulse(t, tCity + 0.6, 0.3) * 0.6 - (hop > 0.05 ? 0.2 : 0);
      const look = smooth(inv(tCity, tCity + 0.2, t));
      const p = { hop, squash: sq, lookY: look, lean: -10 * look, blink: blink(0) };
      red.set({ ...p, armR: 120 - 20 * look, turn: 12, tilt: -4 });
      green.set({ ...p, armL: 120 - 20 * look, turn: -12, tilt: 4 });
      if (t >= tCity && t < tCity + 0.5) ctx.shake = 0.35 * (1 - inv(tCity, tCity + 0.5, t));
    } else if (shot === 1) {
      // counter: both raise their cup, wind up, SLAM on "products"
      red.group.position.set(-2.35, 0.7, 5.2); green.group.position.set(2.35, 0.7, 5.2);
      const slam = tProd;
      const wind = smooth(inv(tSim, slam - 0.1, t));             // cups rise
      const down = easeIn(inv(slam - 0.08, slam, t));            // fast swing down
      const after = t >= slam;
      const arm = after ? 62 : lerp(lerp(70, 165, wind), 62, down);
      const reach = after ? 55 : lerp(lerp(20, 10, wind), 55, down);
      const sq = after ? pulse(t, slam, 0.35) * 0.5 : -0.15 * wind;
      const nodT = slam + 0.35;                                  // both nod at the "=" card
      const nod = after ? 14 * Math.sin(Math.PI * inv(nodT, nodT + 0.28, t)) : 0;
      const look = after ? smooth(inv(slam + 0.2, slam + 0.4, t)) : 0;
      const hop = hopArc(t, tSim, 0.26, 0.35);
      red.set({ armR: arm, reachR: reach, squash: sq, hop, nod, turn: 14, lookX: 0.6 * look, lean: after ? 4 : -6 * wind, brow: after ? 0 : 10 * wind, mouthOpen: 0.5 * wind, blink: blink(0.4) });
      green.set({ armL: arm, reachL: reach, squash: sq, hop, nod, turn: -14, lookX: -0.6 * look, lean: after ? 4 : -6 * wind, brow: after ? 0 : 10 * wind, mouthOpen: 0.5 * wind, blink: blink(0.4) });
      if (!after) { s.heldR.group.visible = s.heldG.group.visible = true; s.heldR.set({ steam: 1, t }); s.heldG.set({ steam: 1, t: t + 0.3 }); }
      else {
        s.cupR.group.visible = s.cupG.group.visible = true;
        const k = t - slam, sy = 1 - pulse(t, slam, 0.4) * 0.35;
        for (const c of [s.cupR, s.cupG]) { c.group.scale.set(2 - sy, sy, 2 - sy); c.set({ steam: clamp(k / 0.3), t }); }
        if (k < 0.45) ctx.shake = 0.55 * (1 - k / 0.45);
        // "=" pops in
        const eqT = slam + 0.18;
        if (t >= eqT) { s.eqWrap.visible = true; const q = clamp((t - eqT) / 0.24); s.eqWrap.scale.setScalar(Math.max(0.001, spring(q * 1.2, 2.6, 4.5) * 1.0)); s.eqWrap.rotation.z = (1 - q) * 0.5 - 0.03; }
        s.spark.set({ k: clamp((t - eqT) / 0.9) });
      }
    } else {
      // jars: coins raised, glance at each other, flick in on "budgets", jars fill in sync, "=" slaps, both hop
      red.group.position.set(-2.35, 0.7, 5.2); green.group.position.set(2.35, 0.7, 5.2);
      s.jarR.group.visible = s.jarG.group.visible = true;
      const drop = tBud;
      const pre = t < drop;
      const rise = smooth(inv(tSim2, tSim2 + 0.18, t));
      const flick = easeIn(inv(drop - 0.07, drop, t));
      const arm = pre ? lerp(lerp(60, 160, rise), 70, flick) : 70;
      const reach = pre ? lerp(10, 55, flick) : 55 - 30 * smooth(inv(drop, drop + 0.3, t));
      const glance = Math.sin(Math.PI * inv(tSim2 + 0.15, drop - 0.08, t));
      const hopT = drop + 0.3;
      const hop = hopArc(t, hopT, 0.3, 0.55);
      const sq = pulse(t, hopT + 0.3, 0.3) * 0.6 + (pre ? -0.12 * rise : pulse(t, drop, 0.3) * 0.3) - (hop > 0.05 ? 0.2 : 0);
      const look = pre ? glance : 0;
      red.set({ armR: arm, reachR: reach, hop, squash: sq, turn: 14, lookX: 0.8 * look, lookY: pre ? 0.3 : 0, mouth: pre ? undefined : 'teeth', blink: blink(1.1) });
      green.set({ armL: arm, reachL: reach, hop, squash: sq, turn: -14, lookX: -0.8 * look, lookY: pre ? 0.3 : 0, blink: blink(1.1) });
      s.coinR.visible = s.coinG.visible = pre;
      // fill in clinking steps
      const fk = inv(drop, drop + 0.32, t), fill = Math.floor(fk * 7) / 7 * 0.82;
      const bump = pulse(t, drop, 0.35) * 0.25;
      for (const j of [s.jarR, s.jarG]) { j.set({ fill: pre ? 0.05 : fill }); j.group.scale.set(0.95 * (1 + bump * 0.5), 0.95 * (1 - bump), 0.95 * (1 + bump * 0.5)); }
      if (!pre && t < drop + 0.4) ctx.shake = 0.4 * (1 - (t - drop) / 0.4);
      const eqT = drop + 0.12;
      if (t >= eqT) { s.eqWrap.visible = true; const q = clamp((t - eqT) / 0.22); s.eqWrap.scale.setScalar(Math.max(0.001, spring(q * 1.2, 2.6, 4.5))); s.eqWrap.rotation.z = (1 - q) * -0.5 + 0.03; }
      s.sparkJ.set({ k: clamp((t - (drop + 0.05)) / 0.9) });
    }

    // ---- ctx ----
    if (t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2) {
      const o = spec.o;
      ctx.bg = { top: '#7fa9d8', mid: '#b4cfe9', bottom: '#efdcc2' };
      if (shot === 0) { ctx.focus = [o[0], 4.0, o[2] + 1]; ctx.dof = 0.5; }
      else { ctx.focus = [o[0], 2.1, o[2] + 5.6]; ctx.dof = 0.9; }
    }
  },

  camera(ctx, t, spec) {
    const o = spec.o;
    const W = (w, n = 0) => ctx.wordAt(w, spec.t0, n);
    const tSim = W('similar') ?? 2.8, tSim2 = W('similar', 1) ?? 3.76, tProd = W('products') ?? 3.2, tBud = W('budgets') ?? 4.16;
    const P = (p, tg, fov, roll) => ({ pos: [o[0] + p[0], o[1] + p[1], o[2] + p[2]], target: [o[0] + tg[0], o[1] + tg[1], o[2] + tg[2]], fov, roll });
    const hx = dr(t * 1.3, 1) * 0.12, hy = dr(t * 1.3, 2) * 0.08;
    if (t < tSim) {
      // low on the street, craning up + back as the skyline erupts
      const k = smooth(inv(spec.t0 - 0.4, tSim, t));
      return P([lerp(-2.6, 1.6, k) + hx, lerp(3.4, 4.8, k) + hy, lerp(21.0, 19.5, k)], [lerp(0, 0.3, k), lerp(2.9, 4.6, k), lerp(1.0, -0.5, k)], 54, lerp(-3, 2, k));
    }
    if (t < tSim2) {
      // counter, front, low: slow push + slight arc, punch-in on the slam
      const k = smooth(inv(tSim, tSim2, t));
      const punch = t >= tProd ? Math.exp(-8 * (t - tProd)) * 0.9 : 0;
      return P([lerp(-1.4, 0.8, k) + hx, lerp(3.1, 3.4, k) + hy, lerp(18.2, 16.6, k) - punch], [0, lerp(2.0, 1.9, k), 5.4], 46, lerp(3.5, -1.5, k));
    }
    // 3/4 from the right, a touch higher, dutch; arc left
    const k = smooth(inv(tSim2, spec.t1 + 0.4, t));
    const punch = t >= tBud ? Math.exp(-8 * (t - tBud)) * 0.8 : 0;
    return P([lerp(5.4, 3.2, k) + hx, lerp(4.0, 3.6, k) + hy, lerp(17.4, 15.8, k) - punch], [lerp(0.2, -0.1, k), 1.9, 5.4], 46, lerp(-6, -3, k));
  },
};
