// LIBRARY REFERENCE (k07_one.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k07_one 16.1-21.5 "The second business chooses a smaller audience. Busy professionals who want quality coffee delivered to their door."
// Set 1 (dark stage): GREEN hops in, NEXT DOOR card pops ("second"), magnifier pops into his hand ("business"),
//   he spins round to scan the crowd ("chooses", over-shoulder shot through the lens).
//   "smaller": hard cut wide, the crowd pops away one by one; "audience": spotlight slams on the one busy pro.
//   "Busy": hard cut close, BUSY PRO card pops; "professionals": watch check; "who": hurry; "want": green cup pops in his hand,
//   "quality": sparkle.
// Set 2 (front door, at local x +40): "coffee": hard cut, door swings open with the pro waiting; "delivered": NEXT DOOR bike zooms by
//   and tosses the box; "to": hard cut low on the doormat; box SLAMS onto the mat on "door", flaps pop, cup rises, pro cheers.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import * as U from '/engine/core/util.js';

const C = L.C, K = KT.K;
const DX = 40;                      // front-door set offset inside the station
const GP = [-3.2, 0, 4.8];          // GREEN stand point
const PP = [0, 0, 0.5];             // busy pro stand point (stage)
const CROWD = [
  ['nerd', -3.0, -3.0], ['pro', 0.9, -3.3], ['student', 3.4, -3.0], ['anyone', -1.4, -3.4],
  ['anyone', -4.3, -0.7], ['pro', -1.7, -1.1], ['student', 1.7, -1.1], ['anyone', 4.3, -0.7],
  ['student', -2.5, 1.7], ['nerd', 2.5, 1.7],
];

let st = null;

function cues(ctx, spec) {
  const w = (word, d) => ctx.wordAt(word, spec.t0) ?? d;
  return {
    second: w('second', 16.27), business: w('business', 16.59), chooses: w('chooses', 16.91), smaller: w('smaller', 17.55),
    audience: w('audience', 17.86), busy: w('busy', 18.59), pros: w('professionals', 18.91), who: w('who', 19.30), want: w('want', 19.55),
    quality: w('quality', 19.79), coffee: w('coffee', 20.18), delivered: w('delivered', 20.43), to: w('to', 20.82), door: w('door', 21.14),
  };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, parent = root) => { o.group.position.set(x, y, z); parent.add(o.group); return o; };

    // ---------- set 1: dark blue stage ----------
    const room = L.makeRoom(ctx, { wall: C.wall, floor: C.carpet, w: 32, d: 22, h: 16, side: null, wainscot: C.wood, trim: C.gold });
    root.add(room.group);
    for (const x of [-6.5, 6.5]) { const w = L.makeWindow(ctx, { w: 3.8, h: 8.5 }); w.group.position.set(x, 3.0, -10.9); root.add(w.group); }

    const crowd = CROWD.map(([type, x, z], i) => ({ c: at(KT.makeCrowdMember(ctx, type, i + 3), x, 0, z), x, z, i }));
    const pro = at(KT.makeBusyPro(ctx), ...PP);
    const cup = KT.makeCup(ctx, { color: K.green, icon: 'door', size: 0.8 }); pro.holdL(cup.group, [0, -0.05, 0.3]);
    const spot = at(KT.makeSpotlight(ctx, { h: 10, radius: 1.8 }), PP[0], 0, PP[2]);
    const busyCard = at(KT.makeLabelCard(ctx, 'BUSY PRO', { color: K.navy, sub: 'no time to spare', icon: 'clock', w: 2.7, h: 1.15 }), 0, 3.4, 0.9);
    const qSpark = L.makeSparkle(ctx, { size: 1.0, seed: 7 }); root.add(qSpark.group);

    const green = at(KT.makeFounder(ctx, 'green'), ...GP);
    const mag = KT.makeMagnifier(ctx); green.holdR(mag.group, [0, 0.45, 0.45]);
    const dCard = at(KT.makeLabelCard(ctx, 'NEXT DOOR', { color: K.green, icon: 'door', w: 2.7, h: 1.0 }), GP[0] + 0.1, 3.45, GP[2] + 0.2);

    // ---------- set 2: the busy pro's front door ----------
    const home = new THREE.Group(); home.position.set(DX, 0, 0); root.add(home);
    L.B(34, 0.4, 24, L.mat('#a9a196', { scale: 0.7 }), { r: 0, y: -0.2, z: 6, parent: home });
    L.B(34, 0.06, 0.25, L.mat('#8a8276'), { r: 0, y: 0.02, z: 3.2, parent: home });
    L.B(34, 0.06, 0.25, L.mat('#8a8276'), { r: 0, y: 0.02, z: 6.8, parent: home });
    const fd = at(KT.makeFrontDoor(ctx, { mat: 'WELCOME', number: '42', w: 10 }), 0, 0, 0, home);
    for (const s of [-1, 1]) { const p = L.makePlant(ctx, { seed: 4 + s }); p.group.position.set(s * 2.9, 0, 1.0); home.add(p.group); }
    const pro2 = at(KT.makeBusyPro(ctx), -0.2, 0, -0.3, home); pro2.group.scale.setScalar(0.85);
    const bike = at(KT.makeDeliveryBike(ctx, { color: K.green }), 0, 0, 5.0, home);
    const box = at(KT.makeDeliveryBox(ctx, { label: 'NEXT DOOR' }), 0, 0.31, 0.75, home); box.group.scale.setScalar(0.7);
    const bcup = KT.makeCup(ctx, { color: K.green, icon: 'door', size: 0.9 }); box.group.add(bcup.group);
    const landSpark = L.makeSparkle(ctx, { size: 0.8, seed: 23 }); landSpark.group.position.set(1.2, 1.9, 1.0); home.add(landSpark.group);
    const conf = L.makeConfetti(ctx, { n: 50, spread: 2.6, height: 4, colors: [K.green, C.gold, '#ffffff', C.coral] }); conf.group.position.set(0, 1.0, 0.9); home.add(conf.group);

    st = { root, crowd, pro, cup, spot, busyCard, qSpark, green, mag, dCard, fd, pro2, bike, box, bcup, landSpark, conf };
  },

  update(ctx, t, spec) {
    const S = st, T = cues(ctx, spec);
    S.root.visible = !(t < spec.t0 - 0.6 || t > spec.t1 + 0.6);
    if (!S.root.visible) return;
    const { clamp, backOut, smooth, lerp } = U;
    const kk = (a, d) => clamp((t - a) / d);
    const blinkAt = (s) => (((t * 0.9 + s * 0.37) % 1.7) < 0.08 ? 1 : 0);
    const ring = (a, f = 22, dmp = 8) => (t > a ? Math.exp(-dmp * (t - a)) * Math.cos((t - a) * f) : 0);   // landing wobble

    // ================= set 1 =================
    // ---- GREEN: hop in, card, magnifier, spin to the crowd, scan ----
    {
      const g = S.green;
      const h0 = spec.t0 - 0.32, h1 = spec.t0 + 0.06;
      let hop = 0, squash = 0;
      if (t < h1) { const k = clamp((t - h0) / (h1 - h0)); hop = 1.6 * Math.sin(Math.PI * k); squash = -0.25 * Math.sin(Math.PI * k); }
      squash += 0.35 * Math.max(0, ring(h1, 24, 9));
      const ks = t - T.second; if (ks > 0 && ks < 0.26) { hop += 0.45 * Math.sin(Math.PI * ks / 0.26); squash -= 0.15 * Math.sin(Math.PI * ks / 0.26); }
      squash += 0.25 * Math.max(0, ring(T.second + 0.26, 24, 10));
      const slide = t < h1 ? -2.2 * (1 - clamp((t - h0) / (h1 - h0))) : 0;
      g.group.position.set(GP[0] + slide, 0, GP[2]);
      // spin round on "chooses", then scan left/right and lock onto the pro
      const sp = kk(T.chooses, 0.2);
      const scan = sp >= 1 ? 22 * Math.sin((t - T.chooses - 0.2) * 7.5) * (1 - smooth(kk(T.chooses + 0.2, T.smaller - T.chooses - 0.25))) : 0;
      const turn = lerp(18, 143, backOut(sp, 1.4)) + scan;
      const magK = kk(T.business, 0.22);
      const armR = 20 + 75 * backOut(magK, 2) + 10 * Math.sin(t * 4);
      g.set({ hop, squash: squash + 0.03 * Math.sin(t * 6), turn, armR, reachR: lerp(40, 75, sp) * smooth(magK), armL: 18 + 50 * (ks > 0 && ks < 0.3 ? Math.sin(Math.PI * ks / 0.3) : 0),
        tilt: 6 * Math.sin(t * 3.1), nod: 5 * Math.sin(t * 5), lookX: sp > 0 ? 0 : 0.25, blink: blinkAt(1), mouth: 'smile', mouthOpen: 0.3 + 0.3 * Math.sin(t * 9) * (t < T.chooses ? 1 : 0) });
      S.mag.group.scale.setScalar(Math.max(0.001, lerp(1.15, 1.5, sp) * backOut(magK, 2.6)));
      S.mag.group.visible = magK > 0;
      S.mag.set({ glint: 0.5 + 0.5 * Math.sin(t * 6) });
      // NEXT DOOR card above him (only while he faces camera)
      const ck = kk(T.second, 0.22);
      S.dCard.set({ pop: backOut(ck, 2.2) * (1 - kk(T.chooses, 0.12)) });
      S.dCard.group.position.x = GP[0] + 0.1;
      S.dCard.group.rotation.z = 0.05 * Math.sin(t * 3);
    }

    // ---- crowd: idle, then pop away on "smaller" (back row first) ----
    S.crowd.forEach(({ c, x, z, i }) => {
      const tr = T.smaller + 0.035 * i;
      const k = kk(tr, 0.15);
      c.group.visible = k < 1;
      const s = 1 - smooth(k);
      c.group.scale.set(Math.max(0.001, s * (1 - 0.25 * Math.sin(Math.PI * k))), Math.max(0.001, s * (1 + 0.6 * Math.sin(Math.PI * k))), Math.max(0.001, s));
      const scan = t > T.chooses ? 1 : 0;
      c.set({ hop: Math.max(0, 0.1 * Math.sin(t * 6.5 + i * 1.7)) + 0.5 * Math.sin(Math.PI * k), squash: 0.04 * Math.sin(t * 6.5 + i * 1.7),
        lookX: scan ? clamp((GP[0] - x) / 6, -1, 1) : 0.15 * Math.sin(t + i), lookY: 0.1, tilt: 5 * Math.sin(t * 2.3 + i), blink: blinkAt(i + 3),
        armL: 15 + 10 * Math.sin(t * 3 + i), armR: 15 + 10 * Math.cos(t * 3 + i), mouth: k > 0 ? 'o' : undefined });
    });

    // ---- busy pro on stage ----
    {
      const p = S.pro;
      p.group.position.set(...PP);
      const lit = t - T.audience;
      let hop = Math.max(0, 0.06 * Math.sin(t * 6.2)), squash = 0.03 * Math.sin(t * 6.2);
      if (lit > 0 && lit < 0.28) { hop += 0.7 * Math.sin(Math.PI * lit / 0.28); squash -= 0.2 * Math.sin(Math.PI * lit / 0.28); }
      squash += 0.35 * Math.max(0, ring(T.audience + 0.28, 24, 9));
      // watch check on "professionals", hurry on "who", cup on "want"
      const watch = kk(T.pros, 0.14) * (1 - kk(T.who, 0.12));
      const hurry = kk(T.who, 0.1);
      const cupK = kk(T.want, 0.2);
      const hp = p.hurry(t, hurry);
      let pose = { hop, squash, lookX: lit > 0 ? 0 : 0.3 * Math.sin(t * 2), lookY: 0.1, blink: blinkAt(9), mouth: cupK > 0 ? 'smile' : 'flat',
        tilt: 4 * Math.sin(t * 3.4), nod: 0, armL: 15, armR: 10, brow: 0 };
      if (hurry > 0) pose = { ...pose, ...hp, hop: hop + hp.hop, lean: hp.lean * hurry };
      if (watch > 0) pose = { ...pose, armL: lerp(15, 85, backOut(watch, 2)), reachL: 70 * watch, lookX: -0.55 * watch, nod: 10 * watch, brow: -14 * watch };
      if (cupK > 0) pose = { ...pose, armL: lerp(pose.armL ?? 15, 75, cupK), reachL: lerp(pose.reachL ?? 0, 45, cupK), lookX: -0.35, brow: -6 };
      const qk = t - T.quality; if (qk > 0 && qk < 0.25) { pose.hop += 0.3 * Math.sin(Math.PI * qk / 0.25); }
      p.set(pose);
      S.cup.group.scale.setScalar(Math.max(0.001, backOut(cupK, 2.6) * (1 + 0.25 * Math.max(0, ring(T.quality, 20, 7)))));
      S.cup.group.visible = cupK > 0;
      S.cup.set({ steam: cupK, t });
      // sparkle at the cup on "quality"
      const cw = new THREE.Vector3(); S.cup.group.getWorldPosition(cw); S.root.worldToLocal(cw);
      S.qSpark.group.position.copy(cw).add(new THREE.Vector3(0, 0.9, 0.3));
      S.qSpark.set({ k: kk(T.quality - 0.03, 0.8) });
      S.qSpark.group.visible = t > T.quality - 0.05;
      // spotlight slams on
      const on = kk(T.audience, 0.08);
      S.spot.set({ on: on * (1 + 0.15 * Math.sin(t * 13) * (1 - kk(T.audience, 0.5))), radius: 1.8 * (0.2 + 0.8 * backOut(kk(T.audience, 0.22), 2.5)) });
      // BUSY PRO card
      const bk = kk(T.busy, 0.22);
      S.busyCard.set({ pop: backOut(bk, 2.2) });
      S.busyCard.group.rotation.z = -0.05 + 0.03 * Math.sin(t * 3.3);
      S.busyCard.group.position.y = 3.4 + 0.05 * Math.sin(t * 4);
    }

    // ================= set 2: front door =================
    {
      const open = backOut(kk(T.coffee, 0.16), 1.6);
      S.fd.set({ open: clamp(open, 0, 1.08) });
      const p = S.pro2;
      p.group.visible = t > T.coffee + 0.04;
      const land = t - T.door;
      let hop = 0, squash = 0.03 * Math.sin(t * 7);
      const hp = p.hurry(t, 0.6);
      let pose = { lookX: 0.35, lookY: -0.25, blink: blinkAt(4), mouth: 'flat', tilt: 5 * Math.sin(t * 4), brow: -10,
        armL: lerp(15, 80, 0.5 + 0.5 * Math.sin(t * 7)), reachL: 60, armR: 10, walk: hp.walk };
      if (land > 0) {
        if (land < 0.3) hop += 0.6 * Math.sin(Math.PI * land / 0.3);
        squash += 0.3 * Math.max(0, ring(T.door + 0.3, 22, 8));
        pose = { ...pose, walk: undefined, armL: 150 * backOut(clamp(land / 0.15), 2), reachL: 0, armR: 130 * backOut(clamp(land / 0.15), 2), mouth: 'smile', mouthOpen: 0.6, brow: 0, lookX: 0.1, lookY: -0.4 };
      }
      p.set({ ...pose, hop, squash });

      // bike zooms in on "delivered", tosses the box, rides off
      const bx = -2.0 + 12 * (t - T.delivered);
      S.bike.group.position.set(bx, 0, 5.0);
      S.bike.group.visible = t > T.delivered - 0.2 && t < T.to;
      S.bike.group.rotation.z = 0.04 * Math.sin(t * 30);
      S.bike.set({ roll: bx / 0.5 });
      const tToss = T.delivered + 0.31;   // crate passes x ~0.5
      const A = new THREE.Vector3(bx - 1.25, 2.0, 5.0), Cc = new THREE.Vector3(0.2, 7.2, 2.4), Bp = new THREE.Vector3(0.6, 0.31, 0.8);
      const b = S.box;
      if (t < tToss) {
        const bt = Math.min(-2.0 + 12 * 0.31, bx);
        b.group.position.set(bt - 1.25, 1.75, 5.0); b.group.visible = S.bike.group.visible; b.group.rotation.set(0, 0, 0);
        b.group.scale.setScalar(0.45);
      } else if (t < T.door) {
        const k = (t - tToss) / (T.door - tToss);
        const A0 = new THREE.Vector3(-2.0 + 12 * 0.31 - 1.25, 1.75, 5.0);
        const pos = new THREE.Vector3().copy(A0).multiplyScalar((1 - k) * (1 - k)).addScaledVector(Cc, 2 * k * (1 - k)).addScaledVector(Bp, k * k);
        b.group.position.copy(pos); b.group.visible = true;
        b.group.rotation.set(1.4 * (1 - k), 0.8 * (1 - k), -0.9 * (1 - k));
        const s = lerp(0.45, 0.7, smooth(k));
        const str = k > 0.6 ? 1 + 0.25 * (k - 0.6) / 0.4 : 1;
        b.group.scale.set(s / Math.sqrt(str), s * str, s / Math.sqrt(str));
      } else {
        const r = ring(T.door, 26, 9);
        b.group.position.copy(Bp); b.group.visible = true; b.group.rotation.set(0, 0, 0.03 * r);
        const sq = 1 - 0.35 * Math.max(0, r) + 0.12 * Math.min(0, r);
        b.group.scale.set(0.7 / Math.sqrt(sq), 0.7 * sq, 0.7 / Math.sqrt(sq));
      }
      void A;
      const fl = kk(T.door + 0.12, 0.16);
      b.set({ open: fl });
      const ck = kk(T.door + 0.16, 0.22);
      S.bcup.group.position.set(0, lerp(0.05, 1.12, backOut(ck, 2.2)), 0);
      S.bcup.group.visible = ck > 0;
      S.bcup.set({ steam: ck, t });
      S.landSpark.set({ k: kk(T.door + 0.02, 0.85) }); S.landSpark.group.visible = t > T.door;
      S.conf.set({ k: kk(T.door, 1.5) }); S.conf.group.visible = t > T.door;
    }

    // ================= ctx =================
    if (t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2) {
      const o = spec.o;
      const Wp = (x, y, z) => [o[0] + x, o[1] + y, o[2] + z];
      if (t < T.coffee) {
        ctx.bg = { top: '#141130', mid: '#1f1a40', bottom: '#2a1d22' };
        if (t < T.chooses) { ctx.focus = Wp(GP[0], 1.6, GP[2]); ctx.dof = 1.3; }
        else if (t < T.smaller) { ctx.focus = Wp(PP[0], 1.4, PP[2]); ctx.dof = 1.0; }
        else if (t < T.busy) { ctx.focus = Wp(PP[0], 1.3, PP[2]); ctx.dof = 0.7; ctx.exposure = lerp(1.0, 0.85, kk(T.audience, 0.2)); }
        else { ctx.focus = Wp(PP[0], 1.8, PP[2] + 0.4); ctx.dof = 1.2; ctx.exposure = 0.88; }
        const ls = t - (spec.t0 + 0.06); if (ls > 0 && ls < 0.25) ctx.shake = Math.max(ctx.shake, 0.3 * (1 - ls / 0.25));
        const as = t - T.audience; if (as > 0 && as < 0.3) { ctx.shake = Math.max(ctx.shake, 0.35 * (1 - as / 0.3)); }
      } else {
        ctx.bg = { top: '#8fb6e0', mid: '#bcd5ea', bottom: '#e8dcc4' };
        if (t < T.to) { ctx.focus = Wp(DX, 1.4, 0.3); ctx.dof = 0.9; }
        else { ctx.focus = Wp(DX + 0.3, 1.0, 0.6); ctx.dof = 1.1; }
        const ds = t - T.door; if (ds > 0 && ds < 0.35) { ctx.shake = Math.max(ctx.shake, 0.55 * (1 - ds / 0.35)); ctx.flash = Math.max(ctx.flash, 0.1 * Math.max(0, 1 - ds / 0.1)); }
      }
    }
  },

  camera(ctx, t, spec) {
    const T = cues(ctx, spec), o = spec.o;
    const W = (p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    const P = (pos, target, fov, roll) => ({ pos: W(pos), target: W(target), fov, roll });
    const lin = (k) => k;
    let p;
    if (t < T.chooses) {
      // A: front, close on GREEN hopping in, pushing in
      p = U.poseTrack([[spec.t0 - 0.45, P([-1.2, 2.5, 15.0], [-2.7, 2.25, 4.6], 42, -5)], [T.chooses, P([-1.9, 2.6, 13.2], [-2.7, 2.3, 4.6], 42, -1)]], t, lin);
    } else if (t < T.smaller) {
      // A2: over GREEN's shoulder, through the magnifier at the crowd, arcing
      p = U.poseTrack([[T.chooses, P([-7.6, 6.4, 9.0], [-0.3, 1.2, 0.5], 40, 4)], [T.smaller, P([-6.8, 6.0, 9.8], [-0.1, 1.2, 0.5], 40, 1)]], t, lin);
    } else if (t < T.busy) {
      // B: wide front on the crowd, pushing in as it empties out
      p = U.poseTrack([[T.smaller, P([0.8, 3.8, 13.5], [0, 1.8, -0.2], 42, 3)], [T.busy, P([0.2, 2.9, 10.8], [0, 1.6, 0.3], 42, 0)]], t, lin);
    } else if (t < T.coffee) {
      // C: close low on the busy pro in the spotlight, dutch
      p = U.poseTrack([[T.busy, P([1.7, 2.0, 12.4], [-0.1, 2.25, 0.5], 40, -5)], [T.coffee, P([0.7, 2.2, 10.4], [-0.25, 2.25, 0.5], 40, -1.5)]], t, lin);
    } else if (t < T.to) {
      // D1: front door 3/4, bike zooms past
      p = U.poseTrack([[T.coffee, P([DX + 2.6, 2.7, 12.0], [DX + 0.1, 1.7, 1.4], 44, 3)], [T.to, P([DX + 1.9, 2.5, 10.6], [DX + 0.0, 1.7, 1.4], 44, 1)]], t, lin);
    } else {
      // D2: low on the doormat, box slams in on "door"
      p = U.poseTrack([[T.to, P([DX - 1.9, 2.9, 7.6], [DX + 0.15, 1.25, 0.5], 44, 5)], [spec.t1 + 0.5, P([DX - 1.3, 2.7, 6.6], [DX + 0.15, 1.25, 0.5], 44, 1)]], t, lin);
    }
    return p;
  },
};
