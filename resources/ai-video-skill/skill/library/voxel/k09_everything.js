// LIBRARY REFERENCE (k09_everything.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k09_everything 25.8-29.6 "Their website, their packaging, their content, even their subscription offer."
// A green NEXT DOOR display cubby (2x2) on the sidewalk in front of the NEXT DOOR shop. One piece slots into each cell per word,
// lands with squash + shake, its cell lights up, then a green CHECK sticker slaps onto the cell corner.
// SHOT A (close, top-left cell): phone flies in on "Their", lands on "website" ("Order in 1 tap"), check.
// SHOT B (hard cut on 2nd "their", top-right cell): kraft bag lands on "packaging" ("Fresh at your door"), check.
// SHOT C (hard cut on 3rd "their", low, bottom-left cell): content card lands on "content", video plays, check.
// SHOT D (hard cut on "even", bottom-right cell + GREEN): GREEN winds up and throws the EVERY MONDAY box in on "subscription";
//   (wide on the full grid from "even"); on "offer" the lid pops, sparkles + confetti, all four checks ripple, GREEN jumps.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const C = L.C, K = KT.K;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const bump = (t, t0, dur) => { const k = (t - t0) / dur; return k < 0 || k > 1 ? 0 : Math.sin(Math.PI * k); };
const decay = (t, t0, rate = 9) => (t < t0 ? 0 : Math.exp(-(t - t0) * rate));

// cubby geometry (local to root)
const GZ = 2.5;                   // cubby centre z
const DEPTH = 2.0;
const FR = 0.25;                  // frame thickness
const CW = 2.95, CH = 3.1;        // inner cell size
const PL = 0.5;                   // plinth height
const COLX = [-(CW / 2 + FR / 2), CW / 2 + FR / 2];        // -1.6, +1.6
const FLOOR = [PL + CH + FR, PL];                           // top row floor 3.85, bottom row floor 0.5
const CELLS = [                                             // TL, TR, BL, BR
  { x: COLX[0], y0: FLOOR[0] }, { x: COLX[1], y0: FLOOR[0] },
  { x: COLX[0], y0: FLOOR[1] }, { x: COLX[1], y0: FLOOR[1] },
];
const GW = 2 * CW + 3 * FR, GH = PL + 2 * CH + 2 * FR;      // 6.65 x 7.2
const GREEN_AT = { x: 4.4, z: 4.4 };

let S = null;

function cues(ctx, spec) {
  const w = (word, d, n = 0) => ctx.wordAt(word, spec.t0 - 0.1, n) ?? d;
  return {
    their1: w('their', 25.82, 0), website: w('website', 26.06), their2: w('their', 26.62, 1), packaging: w('packaging', 26.86),
    their3: w('their', 27.42, 2), content: w('content', 27.58), even: w('even', 28.30), their4: w('their', 28.46, 3),
    sub: w('subscription', 28.70), offer: w('offer', 29.18),
  };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, parent = root) => { o.group.position.set(x, y, z); parent.add(o.group); return o; };

    // ---------- world: street, skyline, NEXT DOOR shop behind ----------
    const street = KT.makeStreet(ctx, { w: 70, seed: 19 }); root.add(street.group); street.set({ rise: 1 });
    for (const pr of street.props) if (Math.abs(pr.g.position.x) < 8) pr.g.visible = false;   // keep the cubby + GREEN clear
    const sky = at(KT.makeSkyline(ctx, { w: 90, z: -14, seed: 23 }), 0, 0, 0); sky.set({ rise: 1 });
    const shop = at(KT.makeShop(ctx, { preset: 'green' }), 0.4, 0, -1.6);
    if (shop.aframe) shop.aframe.group.visible = false;
    // little planters either side so the frame never shows bare sidewalk
    for (const s of [-1, 1]) {
      L.B(1.4, 0.9, 1.2, L.mat(K.greenDark, { scale: 1.2 }), { r: 0.08, x: s * 6.9, y: 0.45, z: 2.6, parent: root });
      L.B(1.2, 0.9, 1.0, L.mat(C.leaf ?? '#4f9a4a', { scale: 1.6 }), { r: 0.35, x: s * 6.9, y: 1.25, z: 2.6, parent: root });
    }

    // ---------- the NEXT DOOR display cubby ----------
    const cub = new THREE.Group(); cub.position.set(0, 0, GZ); root.add(cub);
    const fm = L.mat(K.green, { scale: 1.3 }), fmD = L.mat(K.greenDark, { scale: 1.3 });
    L.B(GW + 0.2, PL, DEPTH + 0.2, fmD, { r: 0.06, y: PL / 2, parent: cub });                       // plinth
    L.B(GW, FR, DEPTH, fm, { r: 0.05, y: PL + CH + FR / 2, parent: cub });                          // middle shelf
    L.B(GW + 0.2, FR, DEPTH + 0.2, fm, { r: 0.06, y: GH - FR / 2, parent: cub });                   // top
    for (const x of [-(GW / 2 - FR / 2), 0, GW / 2 - FR / 2]) L.B(FR, GH - PL, DEPTH, fm, { r: 0.05, x, y: PL + (GH - PL) / 2, parent: cub });
    // gold lip along the front of each shelf
    for (const y of [PL, PL + CH + FR, GH]) L.B(GW, 0.07, 0.06, L.mat(K.gold, { rough: 0.5 }), { r: 0.02, y: y - 0.05, z: DEPTH / 2 + 0.01, parent: cub });
    // per-cell back panels (light up when filled)
    const backs = CELLS.map((c) => {
      const m = L.mat('#3b7550', { scale: 1.2 });
      L.B(CW, CH, 0.12, m, { r: 0.02, x: c.x, y: c.y0 + CH / 2, z: -DEPTH / 2 + 0.06, parent: cub });
      return m;
    });
    // NEXT DOOR plate on the plinth front
    const plate = KT.makeIconSticker(ctx, 'door', { size: 0.42, bg: K.cream, color: K.green });
    plate.position.set(0, PL / 2, DEPTH / 2 + 0.11); cub.add(plate);

    // ---------- the four pieces (each inside a pivot at its cell floor) ----------
    const pivot = (i, z) => { const p = new THREE.Group(); p.position.set(CELLS[i].x, CELLS[i].y0, z); cub.add(p); return p; };
    const P0 = pivot(0, 0.45), P1 = pivot(1, 0.25), P2 = pivot(2, 0.45), P3 = pivot(3, -0.05);
    const phone = KT.makePhoneSite(ctx, { cta: 'Order in 1 tap' }); phone.group.scale.setScalar(0.56); phone.group.rotation.x = -0.07; P0.add(phone.group);
    const bag = KT.makePackaging(ctx, { lines: ['Fresh at', 'your door'] }); bag.group.scale.setScalar(1.1); P1.add(bag.group);
    const card = KT.makeContentCard(ctx, { title: '3-MIN MORNING BREWS' }); card.group.scale.setScalar(0.72); card.group.position.y = 3.9 * 0.72 / 2 + 0.02; card.group.rotation.x = -0.06; P2.add(card.group);
    const box = KT.makeSubscriptionBox(ctx, { text: 'EVERY MONDAY' }); box.group.scale.setScalar(0.95); P3.add(box.group);
    const pieces = [P0, P1, P2, P3];

    // check stickers on each cell's top-right corner + a landing sparkle per cell
    const checks = CELLS.map((c) => {
      const g = new THREE.Group(); g.position.set(c.x + CW / 2 - 0.25, c.y0 + CH - 0.3, DEPTH / 2 + 0.12); cub.add(g);
      const st = KT.makeIconSticker(ctx, 'check', { size: 0.95, bg: K.green, color: K.cream }); g.add(st);
      const ring = KT.makeIconSticker(ctx, 'check', { size: 1.05, bg: K.cream, color: K.cream }); ring.position.z = -0.01; g.add(ring);
      return g;
    });
    const sparks = CELLS.map((c, i) => at(L.makeSparkle(ctx, { size: 0.75, n: 5, seed: 50 + i, color: '#ffd98a' }), c.x - CW / 2 + 0.35, c.y0 + 0.45, GZ + 1.3));

    // GREEN beside the cubby + payoff FX
    const green = at(KT.makeFounder(ctx, 'green'), GREEN_AT.x, 0, GREEN_AT.z);
    const boxSpark = at(L.makeSparkle(ctx, { size: 1.6, n: 7, seed: 71, color: '#ffe08a' }), CELLS[3].x, CELLS[3].y0 + 2.75, GZ + 0.9);
    const conf = at(L.makeConfetti(ctx, { n: 120, spread: 6, height: 7, colors: [K.green, C.gold, '#ffffff', C.blue, C.coral] }), CELLS[3].x, CELLS[3].y0 + 1.6, GZ + 0.6);

    S = { root, shop, cub, backs, phone, bag, card, box, pieces, checks, sparks, green, boxSpark, conf };
  },

  update(ctx, t, spec) {
    if (!S) return;
    const on = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    S.root.visible = on; if (!on) return;
    const T = cues(ctx, spec);
    const inside = t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2;
    const o = spec.o;
    const shake = (v) => { if (inside) ctx.shake = Math.max(ctx.shake || 0, v); };

    S.shop.set({ shutter: 0, open: 0, sign: 1, t });

    // landing times + where each piece flies in from (cell-local offsets)
    const LAND = [T.website + 0.05, T.packaging + 0.04, T.content + 0.05, T.sub + 0.05];
    const DUR = [0.26, 0.24, 0.26, 0.24];
    const FROM = [V(-3.6, 2.4, 3.6), V(3.8, 2.2, 3.4), V(-2.6, 1.4, 2.6), V(2.0, 2.4, 2.2)];
    const SPIN = [[0.5, 2.4, 0.9], [0.4, -2.6, -0.8], [-0.6, 2.2, 1.0], [0.6, -2.0, 0.7]];
    const BASE_ROT = [[-0.07, 0.08, 0], [0, -0.12, 0], [-0.06, 0.1, 0], [0, -0.06, 0]];
    const CHECK = LAND.map((l, i) => l + (i === 3 ? 0.2 : 0.27));

    S.pieces.forEach((p, i) => {
      const land = LAND[i], dur = DUR[i];
      const vis = t >= land - dur;
      p.visible = vis;
      const cell = CELLS[i];
      const restZ = [0.45, 0.25, 0.45, -0.05][i];
      if (!vis) return;
      const k = inv(land - dur, land, t), e = 1 - Math.pow(1 - k, 2.2);
      const f = FROM[i];
      const sp = Math.pow(1 - k, 1.6);
      p.position.set(cell.x + f.x * (1 - e), cell.y0 + f.y * (1 - e) + Math.sin(Math.PI * e) * 0.9, restZ + f.z * (1 - e));
      const [bx, by, bz] = BASE_ROT[i];
      const wob = t >= land ? Math.sin((t - land) * 26) * decay(t, land, 7) : 0;
      p.rotation.set(bx + SPIN[i][0] * sp, by + SPIN[i][1] * sp + 0.12 * wob, bz + SPIN[i][2] * sp + 0.06 * wob);
      const sq = t >= land ? decay(t, land, 12) : 0;
      const stretch = t < land ? 0.18 * k : 0;
      const sc = 1.05 * (1 - k) + 1 * k;
      p.scale.set(sc * (1 + 0.2 * sq - 0.08 * stretch), sc * (1 - 0.28 * sq + stretch), sc * (1 + 0.2 * sq - 0.08 * stretch));
      if (t >= land && t < land + 0.25) shake(0.38 * (1 - (t - land) / 0.25));
      // cell lights up
      const lit = t >= land ? 1 : 0, flashK = bump(t, land, 0.3) + (t >= T.offer ? bump(t, T.offer + 0.05 + i * 0.07, 0.3) : 0);
      S.backs[i].color.set(L.mixHex(L.mixHex('#3b7550', '#4f9a68', lit), '#8fd3a6', clamp(flashK) * 0.6));
      S.sparks[i].set({ k: inv(land - 0.02, land + 0.55, t) });
    });

    // check stickers: slap on (big + rotated -> settle), ripple on "offer"
    S.checks.forEach((g, i) => {
      const tc = CHECK[i];
      g.visible = t >= tc - 0.1;
      if (!g.visible) return;
      const k = inv(tc - 0.1, tc, t);
      const after = t >= tc ? decay(t, tc, 10) : 0;
      const ripple = t >= T.offer ? bump(t, T.offer + 0.05 + i * 0.07, 0.28) : 0;
      const s = (t < tc ? lerp(1.8, 1, k * k) : 1 - 0.18 * after) * (1 + 0.4 * ripple);
      g.scale.setScalar(s);
      g.rotation.z = (t < tc ? lerp(-0.9, -0.2, k) : -0.2 + 0.12 * Math.sin((t - tc) * 30) * after) + 0.25 * ripple;
      if (t >= tc && t < tc + 0.18) shake(0.2 * (1 - (t - tc) / 0.18));
    });

    // piece-specific life
    const tapPulse = bump(t, LAND[0] + 0.15, 0.3);
    S.phone.set({ tap: 0, glow: 0.3 + 0.7 * tapPulse + (t >= T.offer ? 0.5 * bump(t, T.offer + 0.05, 0.3) : 0) });
    S.card.set({ play: t < LAND[2] + 0.1 ? 0 : clamp((t - LAND[2] - 0.1) / 1.4) });
    const lidK = t < T.offer - 0.02 ? 0.06 * bump(t, CHECK[3], 0.2) : 0.85 * clamp(backOut(inv(T.offer - 0.02, T.offer + 0.28, t), 2.2));
    S.box.set({ open: lidK });
    if (t >= T.offer && t < T.offer + 0.35) shake(0.45 * (1 - (t - T.offer) / 0.35));
    S.boxSpark.set({ k: inv(T.offer, T.offer + 0.8, t) });
    S.conf.set({ k: inv(T.offer + 0.02, T.offer + 1.6, t) });

    // ---------- GREEN: idle bob, wind-up + throw of the box, celebrates on "offer" ----------
    {
      const g = S.green;
      const rel = LAND[3] - DUR[3];            // release
      const wind = smooth(inv(T.even, rel - 0.02, t)) * (t < rel ? 1 : 0);
      const thr = t >= rel ? 1 - smooth(inv(rel, rel + 0.3, t)) : 0;
      const party = t >= T.offer;
      const jk = inv(T.offer, T.offer + 0.42, t), jump = party && jk < 1 ? Math.sin(Math.PI * jk) : 0;
      const bounce = t >= T.offer + 0.42 ? 0.14 * Math.abs(Math.sin((t - T.offer - 0.42) * Math.PI * 3.2)) : 0;
      let armL = 25 + 10 * Math.sin(t * 3), reachL = 10;
      if (t >= T.even && t < rel) { armL = lerp(25, 150, wind); reachL = lerp(10, 0, wind); }
      if (t >= rel && !party) { armL = lerp(80, 60, 1 - thr); reachL = lerp(85, 60, 1 - thr); }   // follow-through = pointing at the box
      if (party) { armL = 160 + 12 * Math.sin(t * 18); reachL = 0; }
      g.set({
        hop: 0.06 * Math.max(0, Math.sin(t * 8)) + 0.8 * jump + bounce + 0.15 * bump(t, rel, 0.22),
        squash: 0.25 * bump(t, rel - 0.2, 0.18) - 0.25 * jump + 0.3 * (t >= T.offer + 0.42 ? decay(t, T.offer + 0.42, 10) : 0) + 0.25 * bump(t, T.offer - 0.1, 0.1),
        turn: party ? lerp(-38, -12, smooth(inv(T.offer, T.offer + 0.3, t))) : -38,
        tilt: 4 * Math.sin(t * 2.6) + (t < rel ? -6 * wind : 0),
        armL, reachL,
        armR: party ? 150 + 14 * Math.sin(t * 18 + 1) : 20 + 8 * Math.sin(t * 2.4),
        lookX: party ? -0.1 : -0.75, lookY: party ? 0.15 : -0.15,
        mouth: party ? 'teeth' : 'smile', brow: t >= T.even && t < rel ? 10 : 0,
        blink: Math.max(bump(t, 25.95, 0.12), bump(t, 27.3, 0.12), bump(t, 28.35, 0.12)),
      });
    }

    // ---------- per-shot focus ----------
    if (inside) {
      ctx.bg = { top: '#8fb8de', mid: '#bcd6ea', bottom: '#efe2c8' };
      const fz = o[2] + GZ + 0.9;
      if (t < T.their2) { ctx.focus = [o[0] + CELLS[0].x, CELLS[0].y0 + 1.5, fz]; ctx.dof = 1.0; }
      else if (t < T.their3) { ctx.focus = [o[0] + CELLS[1].x, CELLS[1].y0 + 1.5, fz]; ctx.dof = 1.0; }
      else if (t < T.even) { ctx.focus = [o[0] + CELLS[2].x, CELLS[2].y0 + 1.5, fz]; ctx.dof = 1.0; ctx.exposure = 0.9; }
      else { ctx.focus = [o[0] + 1.0, 3.2, o[2] + GZ + 1.0]; ctx.dof = 0.5; }
    }
  },

  camera(ctx, t, spec) {
    const T = cues(ctx, spec), o = spec.o;
    const W = (p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
    const dr = (s) => Math.sin(t * 0.9 + s) * 0.12 + Math.sin(t * 1.7 + s * 2) * 0.06;
    const fz = GZ + 0.6;
    let pos, target, fov = 35, roll = 0;
    if (t < T.their2) {
      // A: close on the top-left cell from the left, push in, dutch settles; punch on "website"
      const k = inv(spec.t0 - 0.4, T.their2, t);
      const punch = 0.8 * easeOut(inv(T.website + 0.05, T.website + 0.2, t));
      fov = 38;
      pos = [lerp(-3.8, -2.8, k) + dr(1), lerp(4.4, 4.8, k), lerp(15.0, 13.6, smooth(k)) - punch];
      target = [CELLS[0].x + lerp(0.25, 0.1, k), lerp(4.85, 5.0, k), fz];
      roll = lerp(5, 1.5, k);
    } else if (t < T.their3) {
      // B: close on the top-right cell from the right, slightly high, arc left
      const k = inv(T.their2, T.their3, t);
      const punch = 0.7 * easeOut(inv(T.packaging + 0.04, T.packaging + 0.2, t));
      fov = 38;
      pos = [lerp(4.4, 3.3, k) + dr(2), lerp(6.6, 6.1, k), lerp(14.2, 13.2, smooth(k)) - punch];
      target = [CELLS[1].x - 0.15, 4.95, fz];
      roll = lerp(-5, -2, k);
    } else if (t < T.even) {
      // C: low on the bottom-left cell, looking up, slow arc right + push
      const k = inv(T.their3, T.even, t);
      const punch = 0.7 * easeOut(inv(T.content + 0.05, T.content + 0.2, t));
      fov = 38;
      // framed on the whole left column: the phone already in place above, the content card lands below (pieces stacking up,
      // never an empty green cell filling the frame)
      pos = [lerp(-0.6, -1.3, k) + dr(3), lerp(1.6, 1.9, k), lerp(16.4, 15.0, smooth(k)) - punch];
      target = [CELLS[2].x + 0.05, 3.3, fz];
      roll = lerp(3, 5, k);
    } else {
      // D: the whole grid + GREEN; he throws the box in on "subscription", lid pops + checks ripple on "offer"; steady push
      const k = inv(T.even, spec.t1 + 0.4, t);
      const punch = 0.6 * easeOut(inv(T.sub + 0.05, T.sub + 0.22, t)) + 0.9 * easeOut(inv(T.offer, T.offer + 0.2, t));
      fov = 38;
      pos = [lerp(1.8, 1.1, k) + dr(4) * 0.7, lerp(3.3, 2.9, k), fz + lerp(24.0, 21.0, smooth(k)) - punch];
      target = [lerp(1.15, 1.05, k), lerp(2.95, 3.05, k), fz];
      roll = lerp(-3, 1, k) + 1.2 * Math.sin((t - T.offer) * 28) * decay(t, T.offer, 7) * (t > T.offer ? 1 : 0);
    }
    return { pos: W(pos), target: W(target), fov, roll };
  },
};
