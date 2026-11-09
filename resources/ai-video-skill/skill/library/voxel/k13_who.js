// LIBRARY REFERENCE (k13_who.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k13_who 40.8-47.3 "Having the biggest possible audience, it's about knowing exactly who you're serving, what they value,
//   and why they should choose you."
// SHOT A (CORNER CAFE street): a red BIGGEST AUDIENCE marquee slams down on "Having", punches on "biggest"; CUT high-wide on
//   "possible": the crowd floods in around it ("audience"); two red slashes X it out (end of "audience" + "it's"), crowd droops.
// SHOT B (NEXT DOOR street): CUT side-angle on "knowing": the busy pro hurries onto his mark, a green dart flies in and hits the
//   bullseye right above his head on "exactly". CUT front on "who": WHO / busy pros card slaps onto the cork board.
//   CUT low dutch on "what": he checks his watch, WHAT / their time card on "value". CUT wide on "why": WHY / at their door card,
//   a NEXT DOOR box slams at his feet on "choose", he jumps for joy on "you" (sparkles + confetti), all three cards pulse.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const C = L.C, K = KT.K;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const smooth = (k) => k * k * (3 - 2 * k);
const easeIn = (k) => k * k * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const bump = (t, t0, dur) => { const k = (t - t0) / dur; return k < 0 || k > 1 ? 0 : Math.sin(Math.PI * k); };
const decay = (t, t0, rate = 9) => (t < t0 ? 0 : Math.exp(-(t - t0) * rate));
const popK = (k) => (k <= 0 ? 0.001 : k >= 1 ? 1 : Math.max(0.001, backOut(k, 2.4)));

const BX = 40;                                   // shot B area, 40 units right of shot A
const SIGN = { x: 0, z: 1.2, w: 5.0, h: 2.7, legs: 2.5 };
const PRO = { x: -1.25, z: 1.7 };                // pro's mark (B, local to BX)
const TGT = { x: -1.25, z: -0.9, h: 4.35, r: 1.3 };
const BOARD = { x: 2.1, z: 0.3, w: 3.7, h: 4.75, y0: 0.45 };
const CARD_Y = [4.15, 2.7, 1.25];
const CARD_W = 3.3, CARD_H = 1.28;

let S = null;

function cues(ctx, spec) {
  const w = (word, d, n = 0) => ctx.wordAt(word, spec.t0 - 0.1, n) ?? d;
  return {
    having: w('having', 40.81), biggest: w('biggest', 41.38), possible: w('possible', 41.70), audience: w('audience', 42.09),
    its: w("it's", 42.81), about: w('about', 42.98, 1), knowing: w('knowing', 43.13), exactly: w('exactly', 43.45),
    who: w('who', 43.94), serving: w('serving', 44.49), what: w('what', 45.05), value: w('value', 45.38),
    and: w('and', 45.85), why: w('why', 46.02), should: w('should', 46.49), choose: w('choose', 46.66), you: w('you', 46.90),
  };
}

// crowd layout for shot A: [type, x, z, appear-index]
const CROWD = [
  ['student', -1.6, 4.3, 0], ['pro', 1.5, 4.4, 1], ['nerd', -2.9, 3.0, 2], ['anyone', 2.9, 3.1, 3],
  ['anyone', 0.0, 5.1, 4], ['pro', -3.6, 5.0, 5], ['student', 3.6, 5.0, 6], ['nerd', 4.6, 1.6, 7],
  ['anyone', -4.6, 1.7, 8], ['student', -0.9, 6.2, 9], ['anyone', 1.1, 6.3, 10], ['pro', -5.6, 3.6, 11],
  ['nerd', 5.6, 3.5, 12], ['anyone', -2.4, 6.6, 13], ['student', 2.6, 6.7, 14], ['anyone', 6.3, 5.6, 15], ['pro', -6.4, 5.7, 16],
];

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z) => { o.group.position.set(x, y, z); root.add(o.group); return o; };

    // ---------- world ----------
    const street = KT.makeStreet(ctx, { w: 110, seed: 13 }); street.group.position.set(BX / 2, 0, -1.5); root.add(street.group); street.set({ rise: 1 });
    const sky = at(KT.makeSkyline(ctx, { w: 130, z: -14, seed: 17 }), BX / 2, 0, 0); sky.set({ rise: 1 });
    const shopA = at(KT.makeShop(ctx, { preset: 'red' }), 0, 0, -3.5);
    shopA.aframe.group.visible = false;
    const shopB = at(KT.makeShop(ctx, { preset: 'green' }), BX, 0, -3.8);
    shopB.aframe.group.visible = false;

    // ---------- A: the marquee + the crowd ----------
    const sign = at(KT.makeBigSign(ctx, 'BIGGEST AUDIENCE', { color: K.red, w: SIGN.w, h: SIGN.h, legs: SIGN.legs, crossStyle: 'x', seed: 31 }), SIGN.x, 0, SIGN.z);
    const crowd = CROWD.map(([type, x, z, i], j) => {
      const m = at(KT.makeCrowdMember(ctx, type, 50 + j * 7), x, 0, z * 0.8);
      return { m, x, z, i, ph: j * 1.37 };
    });
    const sparkX = at(L.makeSparkle(ctx, { size: 0.9, n: 5, seed: 12, color: '#ffe0d4' }), SIGN.x + 2.7, SIGN.legs + SIGN.h + 0.35, SIGN.z + 0.6);

    // ---------- B: target, pro, cork board, cards ----------
    const tgt = at(KT.makeTarget(ctx, { r: TGT.r, h: TGT.h }), BX + TGT.x, 0, TGT.z);
    const dart = KT.makeDart(ctx, { size: 1.35, color: K.green }); root.add(dart.group);
    const pro = at(KT.makeBusyPro(ctx), BX + PRO.x, 0, PRO.z);

    const board = new THREE.Group(); board.position.set(BX + BOARD.x, 0, BOARD.z); root.add(board);
    const wm = L.mat(C.wood), wd = L.mat(C.woodDark);
    L.B(BOARD.w + 0.3, BOARD.h + 0.3, 0.25, wm, { r: 0.08, y: BOARD.y0 + BOARD.h / 2, parent: board });
    L.B(BOARD.w, BOARD.h, 0.1, L.mat('#b98657', { scale: 3.5 }), { r: 0.02, y: BOARD.y0 + BOARD.h / 2, z: 0.12, parent: board });
    for (const s of [-1, 1]) L.B(0.26, BOARD.y0 + 0.6, 0.26, wd, { r: 0.05, x: s * (BOARD.w / 2 - 0.3), y: (BOARD.y0 + 0.6) / 2, z: -0.05, parent: board });

    const defs = [
      { text: 'WHO', sub: 'busy pros', icon: 'person', color: K.navy },
      { text: 'WHAT', sub: 'their time', icon: 'clock', color: '#a9461b' },
      { text: 'WHY', sub: 'at their door', icon: 'door', color: K.greenDark },
    ];
    const cards = defs.map((d, i) => {
      const c = KT.makeLabelCard(ctx, d.text, { sub: d.sub, icon: d.icon, color: d.color, w: CARD_W, h: CARD_H, pin: true, seed: 5 + i });
      c.group.position.set(0, CARD_Y[i], 0.3); board.add(c.group);
      return c;
    });

    const box = at(KT.makeDeliveryBox(ctx, { label: 'NEXT DOOR' }), BX + PRO.x + 1.75, 0, PRO.z + 0.9);
    const sparkHit = at(L.makeSparkle(ctx, { size: 1.0, n: 6, seed: 23 }), BX + TGT.x, TGT.h + 0.2, TGT.z + 0.6);
    const sparkPro = at(L.makeSparkle(ctx, { size: 0.9, n: 5, seed: 41 }), BX + PRO.x, 2.6, PRO.z + 0.6);
    const sparkBoard = at(L.makeSparkle(ctx, { size: 1.0, n: 6, seed: 57, color: '#fff6d0' }), BX + BOARD.x + 2.0, 5.2, BOARD.z + 0.8);
    const confCols = [K.green, C.gold, '#ffffff', C.blue, C.coral];
    const conf = at(L.makeConfetti(ctx, { n: 60, spread: 3, height: 5, colors: confCols }), BX + PRO.x - 0.5, 2.6, PRO.z + 0.8);
    const conf2 = at(L.makeConfetti(ctx, { n: 50, spread: 3, height: 5, seed: 29, colors: confCols }), BX + BOARD.x + 0.5, 3.0, BOARD.z + 1.2);

    S = { root, street, shopA, shopB, sign, crowd, sparkX, tgt, dart, pro, board, cards, box, sparkHit, sparkPro, sparkBoard, conf, conf2 };
  },

  update(ctx, t, spec) {
    if (!S) return;
    const on = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    S.root.visible = on; if (!on) return;
    const T = cues(ctx, spec);
    const inside = t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2;
    const shotB = t >= T.knowing;
    const o = spec.o;
    const shake = (v) => { if (inside) ctx.shake = Math.max(ctx.shake || 0, v); };

    S.shopA.set({ shutter: 0, open: 0, sign: 1, t });
    S.shopB.set({ shutter: 0, open: 0, sign: 1, t });

    // ================= SHOT A =================
    const land = T.having + 0.02;
    const hit1 = T.audience + 0.46, hit2 = T.its + 0.02;
    {
      const { sign } = S;
      const kd = inv(land - 0.24, land, t);
      const y = t < land ? lerp(8, 0, easeIn(kd)) : 0.14 * bump(t, land, 0.16);
      const sq = t >= land ? decay(t, land, 11) : 0;
      const knock = decay(t, hit1, 7) + decay(t, hit2, 7);
      sign.group.position.set(SIGN.x, y, SIGN.z);
      sign.group.scale.set(1 + 0.08 * sq, 1 - 0.12 * sq, 1);
      sign.group.rotation.set(0, -0.05 + 0.04 * Math.sin(t * 1.3),
        (t < land ? 0.22 * (1 - kd) : 0) + 0.07 * Math.sin((t - land) * 22) * decay(t, land, 6)
        + 0.06 * knock * Math.sin((t - hit1) * 30) + (t > hit2 ? -0.05 * smooth(inv(hit2, hit2 + 0.3, t)) : 0));
      // "biggest" punch + "audience" pulse
      const pulse = 0.14 * bump(t, T.biggest, 0.24) + 0.1 * bump(t, T.audience, 0.22);
      sign.board.scale.setScalar(1 + pulse);
      const lit = t < land ? 0 : t < hit2 + 0.2 ? 1 : 1 - smooth(inv(hit2 + 0.2, hit2 + 0.45, t)) * (0.85 + 0.15 * Math.sin(t * 60));
      const chase = t >= T.biggest ? (t - T.biggest) * 3.5 : t * 0.4;
      sign.set({ lit, t: chase, cross: inv(hit1 - 0.07, hit1, t) * 0.5 + inv(hit2 - 0.07, hit2, t) * 0.5 });
      if (t >= land && t < land + 0.3) shake(0.5 * (1 - (t - land) / 0.3));
      if (t >= hit1 && t < hit2 + 0.3) shake(0.4 * decay(t, t >= hit2 ? hit2 : hit1, 9));
      S.sparkX.set({ k: inv(hit2, hit2 + 0.6, t) });

      // crowd: 5 already there, the rest flood in from "possible" through "audience"
      const crossed = t >= hit1 ? smooth(inv(hit1, hit2 + 0.15, t)) : 0;
      S.crowd.forEach((c, j) => {
        const tin = c.i < 5 ? spec.t0 - 1 + c.i * 0.01 : T.possible + 0.05 + (c.i - 5) * 0.075;
        const k = inv(tin, tin + 0.28, t);
        const vis = t >= tin;
        c.m.group.visible = vis; if (!vis) return;
        const s = popK(k);
        c.m.group.scale.setScalar(s);
        const ph = c.ph;
        const jolt = bump(t, land + 0.03, 0.3) + bump(t, hit1, 0.25) + bump(t, hit2, 0.25);
        const cheer = t >= T.biggest && t < hit1 ? 1 : 0;
        c.m.set({
          hop: (k < 1 ? 0.6 * Math.sin(Math.PI * k) : 0) + (cheer ? 0.12 * Math.abs(Math.sin(t * 7 + ph)) : 0.03 * Math.max(0, Math.sin(t * 5 + ph))) + 0.15 * jolt * (1 - crossed),
          squash: (k < 1 ? -0.25 * Math.sin(Math.PI * k) : 0) + 0.28 * crossed * (0.8 + 0.2 * Math.sin(t * 3 + ph)),
          turn: -c.x * 4,
          lookX: lerp(-c.x * 0.12, -c.x * 0.12, 0), lookY: 0.6,
          armL: cheer ? 120 + 30 * Math.sin(t * 9 + ph) : lerp(20, 8, crossed), armR: cheer ? 120 + 30 * Math.sin(t * 9 + ph + 1) : lerp(20, 8, crossed),
          tilt: 4 * Math.sin(t * 2 + ph) + 8 * crossed * (j % 2 ? 1 : -1),
          nod: -6 + 16 * crossed,
          mouth: crossed > 0.3 ? 'o' : cheer ? 'smile' : undefined,
          blink: bump(t, 41.1 + (j % 5) * 0.37, 0.12),
        });
      });
      if (inside && !shotB) {
        ctx.focus = [o[0] + SIGN.x, SIGN.legs + SIGN.h * 0.5, o[2] + SIGN.z + 0.3];
        ctx.dof = 0.9;
        ctx.bg = { top: '#8fb8de', mid: '#bcd6ea', bottom: '#efe2c8' };
      }
    }

    // ================= SHOT B =================
    {
      const { pro, tgt, dart, cards } = S;
      // dart: launched on "knowing", bullseye on "exactly"
      const hit = T.exactly + 0.1, fly0 = hit - 0.36;
      const C0 = V(BX + TGT.x, TGT.h, TGT.z + 0.2);
      const from = V(BX + TGT.x + 3.5, TGT.h + 2.5, TGT.z + 8.0);
      dart.group.visible = t >= fly0 - 0.05;
      if (t < hit) {
        const k = inv(fly0, hit, t), e = k * k * (1.5 - 0.5 * k);
        const p = from.clone().lerp(C0, e); p.y += Math.sin(Math.PI * e) * 0.8;
        const dir = C0.clone().sub(from).normalize();
        dart.group.position.copy(p);
        dart.group.quaternion.setFromUnitVectors(V(0, 0, -1), dir);
        dart.group.rotateZ(t * 14);
      } else {
        const dir = C0.clone().sub(from).normalize();
        dart.group.position.copy(C0);
        dart.group.quaternion.setFromUnitVectors(V(0, 0, -1), dir);
        const wob = 0.12 * Math.sin((t - hit) * 40) * decay(t, hit, 5);
        dart.group.rotateX(wob); dart.group.rotateY(wob * 0.6);
      }
      tgt.set({ hit: t >= hit ? inv(hit, hit + 0.9, t) : 0 });
      tgt.group.scale.setScalar(1 + 0.08 * bump(t, hit, 0.2));
      if (t >= hit && t < hit + 0.3) shake(0.45 * (1 - (t - hit) / 0.3));
      S.sparkHit.set({ k: inv(hit, hit + 0.7, t) });

      // cards: slap onto the board on "who", "value", "why"; all pulse on "choose"
      const cardT = [T.who - 0.02, T.value - 0.02, T.why - 0.02];
      cards.forEach((c, i) => {
        const k = inv(cardT[i], cardT[i] + 0.3, t);
        c.set({ pop: k });
        const sl = t >= cardT[i] ? decay(t, cardT[i] + 0.12, 10) : 0;
        c.group.position.z = 0.3 + 1.6 * (1 - easeOut(clamp(k * 1.6)));
        const pulse = 0.1 * bump(t, T.choose + i * 0.08, 0.22);
        c.group.scale.set(1 + 0.1 * sl + pulse, 1 - 0.1 * sl + pulse, 1);
        c.group.rotation.z = (i - 1) * 0.035 + 0.02 * Math.sin(t * 2 + i);
        if (t >= cardT[i] + 0.12 && t < cardT[i] + 0.35) shake(0.22 * (1 - (t - cardT[i] - 0.12) / 0.23));
      });
      S.board.scale.set(1, 1 + 0.03 * (bump(t, cardT[0] + 0.12, 0.15) + bump(t, cardT[1] + 0.12, 0.15) + bump(t, cardT[2] + 0.12, 0.15)), 1);

      // NEXT DOOR box drops at his feet on "choose"
      const bland = T.choose + 0.04;
      const bk = inv(bland - 0.24, bland, t);
      S.box.group.visible = t >= bland - 0.24;
      S.box.group.position.y = t < bland ? lerp(6, 0, easeIn(bk)) : 0.1 * bump(t, bland, 0.15);
      const bsq = t >= bland ? decay(t, bland, 12) : 0;
      S.box.group.scale.set(1 + 0.15 * bsq, 1 - 0.2 * bsq, 1 + 0.15 * bsq);
      S.box.group.rotation.set(0, -0.35 + (t < bland ? 0.6 * (1 - bk) : 0), 0);
      S.box.set({ open: 0 });
      if (t >= bland && t < bland + 0.25) shake(0.35 * (1 - (t - bland) / 0.25));
      S.sparkPro.set({ k: inv(T.you, T.you + 0.7, t) });
      S.sparkBoard.set({ k: inv(T.choose + 0.1, T.choose + 0.8, t) });
      S.conf.set({ k: inv(T.you, T.you + 1.5, t) });
      S.conf2.set({ k: 0 }); S.conf2.group.visible = false;

      // the busy pro
      const arrive = T.knowing + 0.3;
      const wk = inv(T.knowing - 0.45, arrive, t);
      const walking = t < arrive;
      const px = lerp(PRO.x + 3.6, PRO.x, easeOut(wk));
      pro.group.position.set(BX + px, 0, PRO.z);
      const startle = bump(t, hit, 0.32);
      const watch = smooth(inv(T.what - 0.05, T.what + 0.15, t)) * (1 - smooth(inv(T.value + 0.25, T.value + 0.45, t)));
      const point = t >= T.who && t < T.what ? smooth(inv(T.who, T.who + 0.15, t)) : 0;
      const pointV = t >= T.value + 0.3 && t < T.why ? smooth(inv(T.value + 0.3, T.value + 0.45, t)) : 0;
      const pointW = t >= T.why && t < T.choose ? smooth(inv(T.why, T.why + 0.15, t)) : 0;
      const joyK = inv(T.you, T.you + 0.45, t);
      const jump = t >= T.you && joyK < 1 ? Math.sin(Math.PI * joyK) : 0;
      const joy = t >= T.you ? 1 : 0;
      const after = t >= T.you + 0.45 ? 0.1 * Math.abs(Math.sin((t - T.you - 0.45) * Math.PI * 3)) : 0;
      const boxJolt = bump(t, bland, 0.25);
      const ptAny = Math.max(point, pointV, pointW);
      let lookX = 0.1, lookY = 0;
      if (t < hit) { lookX = -0.4; lookY = -0.2; }
      else if (t < T.who) { lookX = 0; lookY = 0.9; }
      else if (t < T.what) { lookX = 0.85; lookY = 0.4; }
      else if (t < T.value + 0.3) { lookX = -0.5; lookY = -0.7; }
      else if (t < T.why) { lookX = 0.85; lookY = 0.0; }
      else if (t < T.choose) { lookX = 0.85; lookY = -0.3; }
      else if (t < T.you) { lookX = 0.6; lookY = -0.7; }
      else { lookX = 0.05; lookY = 0.1; }
      const base = walking ? pro.hurry(t) : {};
      pro.set({
        ...base,
        turn: walking ? lerp(-70, 0, smooth(inv(arrive - 0.2, arrive, t))) : 6 * Math.sin(t * 1.5),
        hop: (base.hop || 0) + 0.45 * startle + 0.16 * bump(t, T.who, 0.22) + 0.12 * bump(t, T.value, 0.22) + 0.12 * bump(t, T.why, 0.22) + 0.85 * jump + after + 0.15 * boxJolt + (walking ? 0 : 0.03 * Math.max(0, Math.sin(t * 7))),
        squash: -0.3 * startle + 0.3 * (t >= arrive ? decay(t, arrive, 12) : 0) - 0.25 * jump + 0.3 * (t >= T.you + 0.45 ? decay(t, T.you + 0.45, 10) : 0) + 0.25 * bump(t, T.you - 0.12, 0.12) - 0.1 * boxJolt,
        lean: walking ? base.lean : 0,
        armL: joy ? 160 + 12 * Math.sin(t * 18) : walking ? base.armL : lerp(lerp(15, 75, watch), 30, 0) + 25 * startle,
        reachL: joy ? 0 : walking ? base.reachL : lerp(0, 70, watch),
        armR: joy ? 155 + 12 * Math.sin(t * 18 + 1) : walking ? base.armR : lerp(10, 105 + 8 * Math.sin(t * 10), ptAny) + 25 * startle,
        reachR: joy ? 0 : walking ? 0 : lerp(0, 35, ptAny),
        nod: watch * 12,
        tilt: 3 * Math.sin(t * 2.4) + 5 * point * Math.sin(t * 8),
        lookX, lookY,
        brow: walking ? -10 : t < T.who ? -8 : watch > 0.5 ? -10 : 0,
        blink: Math.max(bump(t, 44.7, 0.12), bump(t, 45.95, 0.12)),
        mouth: t < hit ? 'flat' : t < T.who ? 'o' : t < T.you ? (watch > 0.5 ? 'flat' : 'smile') : 'teeth',
        mouthOpen: t >= hit && t < T.who ? 0.5 : 0,
      });
      if (inside && shotB) {
        if (t < T.who) ctx.focus = t < hit - 0.1 ? [o[0] + BX + PRO.x, 2.6, o[2] + 0.6] : [o[0] + BX + TGT.x, TGT.h - 0.6, o[2] + TGT.z + 0.8];
        else if (t < T.why) ctx.focus = [o[0] + BX + 0.3, t < T.what ? 3.2 : 2.3, o[2] + 1.0];
        else ctx.focus = [o[0] + BX + 0.3, 2.4, o[2] + 0.9];
        ctx.dof = t < T.why ? 0.85 : 0.55;
        ctx.bg = { top: '#8fb8de', mid: '#bcd6ea', bottom: '#efe2c8' };
      }
    }
  },

  camera(ctx, t, spec) {
    const T = cues(ctx, spec), o = spec.o;
    const W = (p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
    const dr = (s) => Math.sin(t * 0.9 + s) * 0.12 + Math.sin(t * 1.7 + s * 2) * 0.06;
    let pos, target, fov = 35, roll = 0;
    if (t < T.possible) {
      // A1: low push up at the marquee over the first crowd heads
      const k = smooth(inv(spec.t0 - 0.4, T.possible, t));
      const punch = 0.9 * easeOut(inv(T.biggest, T.biggest + 0.15, t));
      pos = [lerp(1.4, 0.5, k) + dr(1), lerp(1.9, 2.3, k), lerp(17.5, 15.8, k) - punch];
      target = [lerp(0.3, 0.0, k), lerp(3.6, 3.7, k), SIGN.z];
      roll = lerp(4, 1, k);
    } else if (t < T.knowing) {
      // A2: high wide from the left: the crowd floods in, the X, punch on "it's"
      const k = smooth(inv(T.possible, T.knowing, t));
      const hit2 = T.its + 0.02;
      const punch = 1.6 * easeOut(inv(hit2, hit2 + 0.2, t));
      pos = [lerp(-3.4, -2.6, k) + dr(2), lerp(7.0, 6.4, k), lerp(21.0, 19.6, k) - punch];
      target = [lerp(-0.2, 0.1, k), lerp(3.0, 3.3, k), lerp(2.6, 2.2, k)];
      roll = lerp(-4, -2, k) + 2 * Math.sin((t - hit2) * 30) * decay(t, hit2, 6) * (t > hit2 ? 1 : 0);
    } else if (t < T.who) {
      // B1: side angle (~35 deg) on target + pro, dart flies in from camera right
      const k = smooth(inv(T.knowing, T.who, t));
      pos = [BX + lerp(-6.0, -5.3, k) + dr(3), lerp(3.2, 3.5, k), lerp(12.2, 11.2, k)];
      target = [BX + TGT.x + lerp(0.3, 0.5, k), lerp(2.35, 2.55, k), lerp(0.3, 0.0, k)];
      roll = lerp(-3, -5, k);
    } else if (t < T.what) {
      // B2: front medium push: pro + target + WHO card
      const k = smooth(inv(T.who, T.what, t));
      pos = [BX + lerp(1.3, 1.0, k) + dr(4), lerp(3.8, 3.6, k), lerp(19.2, 17.9, k)];
      target = [BX + 0.85, lerp(2.85, 2.9, k), 0.8];
      roll = lerp(3, 1.5, k);
    } else if (t < T.why) {
      // B3: low dutch from the left: watch check, WHAT card
      const k = smooth(inv(T.what, T.why, t));
      pos = [BX + lerp(-3.0, -2.5, k) + dr(5), lerp(1.9, 2.1, k), lerp(15.6, 14.6, k)];
      target = [BX + lerp(0.7, 0.8, k), lerp(1.85, 1.9, k), 0.9];
      roll = lerp(-6, -4, k);
    } else {
      // B4: pull back to the whole picture: target, pro, WHO / WHAT / WHY board, box drop, joy
      const k = smooth(inv(T.why, spec.t1 + 0.4, t));
      pos = [BX + lerp(1.2, 0.75, k) + dr(6) * 0.4, lerp(3.4, 3.3, k), lerp(17.2, 20.5, k)];
      target = [BX + lerp(0.7, 0.65, k), lerp(2.95, 2.9, k), 0.8];
      roll = lerp(-2, 0, k) + 1.5 * Math.sin((t - T.choose) * 28) * decay(t, T.choose, 6) * (t > T.choose ? 1 : 0);
    }
    return { pos: W(pos), target: W(target), fov, roll };
  },
};
