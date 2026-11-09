// s02_middle: "label cards per word". Works with any script and can serve several beats (state lives in spec.state).
// A presenter stands in front of a tall pin board; each KEY WORD of the beat (up to 4) slaps onto the board as a paper label
// card the moment it is said, with a hard cut to that card; the presenter points at the newest card. Ends on a wide of the
// whole stack (hop + sparkle). Variant by beat number: even = indoor room, odd = street with a crowd flooding in behind.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import { namedPerson, extraPerson } from '/engine/kits/people.js';
import * as U from '/engine/core/util.js';

const K = KT.K, C = L.C;
const HERO = [1.55, 0, 0.5];
const BOARD = { x: -0.8, z: -0.6, w: 3.3, h: 6.0, y0: 0.8 };
const CARD_Y = [2.45, 3.6, 4.75, 5.9];
const CROWD = [[-2.9, 0.9], [-4.2, 0.2], [-3.6, 1.6], [-5.3, 1.0], [-4.9, -0.5], [2.9, 0.4], [4.1, 1.1], [3.5, -0.4], [5.2, 0.3], [4.7, 1.8]];
const COLORS = [C.blue, K.red, K.green, C.mustard, C.purple, K.navy];
const ICONS = ['star', 'bolt', 'check', 'heart', 'clock', 'phone', 'person', 'calendar', 'play', 'box'];
const WALLS = [['#2c3f8f', '#5a3420'], ['#7a3f5f', '#3e2a2a'], ['#2f6b4f', '#4a2c1b']];

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const S = spec.state, root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const add = (o, x, y, z, ry = 0) => { o.group.position.set(x, y, z); o.group.rotation.y = ry; root.add(o.group); return o; };
    S.variant = spec.n % 2;

    // ---- cues: the beat's key words (always at least one card) ----
    let kws = ctx.keyWords(spec, 4);
    if (!kws.length) kws = [{ w: 'THIS', s: spec.t0 + 0.3 }];
    let prevT = spec.t0 + 0.02;                    // each card cut >= 0.45 s after the previous cut (U.shots drops closer cuts with a warning)
    kws.forEach((k) => { k.t = prevT = Math.max(k.s, prevT + 0.45); });
    S.kws = kws;
    const wideT = Math.max(kws[kws.length - 1].t + 0.9, spec.t1 - 1.1);
    S.shots = U.shots([[spec.t0, 'intro'], ...kws.map((k, i) => [k.t - 0.04, 'card' + i]), [wideT, 'wide']], spec.t1 + 0.5, 0.42);
    S.wideT = wideT;

    // ---- set ----
    if (S.variant === 0) {
      const [wall, floor] = WALLS[Math.floor(spec.n / 2) % WALLS.length];
      add(L.makeRoom(ctx, { wall, floor, w: 30, d: 14, h: 18, side: null, wainscot: C.woodDark, wainH: 2.6, trim: C.gold }), 0, 0, 2);
      const win = add(L.makeWindow(ctx, { w: 3.2, h: 7.5 }), -5.8, 3.0, -4.9); win.group.scale.setScalar(0.9);
      const win2 = add(L.makeWindow(ctx, { w: 3.2, h: 7.5 }), 5.8, 3.0, -4.9); win2.group.scale.setScalar(0.9);
      [[-3.6, -1.2, 4], [4.2, -0.6, 6]].forEach(([x, z, seed]) => { const p = L.makePlant(ctx, { seed, h: 2.2 }); p.group.position.set(x, 0, z); p.group.scale.setScalar(1.3); root.add(p.group); });
      S.bg = ctx.P.night;
    } else {
      add(KT.makeStreet(ctx, { w: 60, walk: 10, lamps: 3, seed: 11, clear: 7 }), 0, 0, -3).set({ rise: 1 });
      add(KT.makeSkyline(ctx, { w: 80, z: -16, seed: 4 }), 0, 0, 0).set({ rise: 1 });
      // the crowd: two clusters either side of the board; they flood in from the sides at the beat start
      S.crowd = CROWD.map(([x, z], i) => { const p = add(extraPerson(ctx, 40 + spec.n * 13 + i * 7), x, 0, z); p.home = new THREE.Vector3(x, 0, z); p.side = x < 0 ? -1 : 1; p.delay = (i % 5) * 0.07; return p; });
      S.bg = ctx.P.sky;
    }
    // the pin board (wood frame + cork)
    const board = new THREE.Group(); board.position.set(BOARD.x, BOARD.y0, BOARD.z); root.add(board);
    L.B(BOARD.w + 0.4, BOARD.h + 0.4, 0.3, L.mat(C.wood), { r: 0.1, y: BOARD.h / 2, parent: board });
    L.B(BOARD.w, BOARD.h, 0.1, L.mat('#c79a62', { scale: 2.5 }), { r: 0.02, y: BOARD.h / 2, z: 0.17, parent: board });
    for (const s of [-1, 1]) L.B(0.3, BOARD.y0 + 0.2, 0.3, L.mat(C.woodDark), { r: 0.05, x: s * (BOARD.w / 2 - 0.4), y: -BOARD.y0 / 2, parent: board });
    // one label card per key word
    S.cards = kws.map((k, i) => {
      const c = KT.makeLabelCard(ctx, k.w.toUpperCase(), { color: COLORS[(i + spec.n) % COLORS.length], icon: ICONS[hash(k.w) % ICONS.length], w: 2.7, h: 1.0, pin: true, seed: 3 + i });
      root.add(c.group); c.home = new THREE.Vector3(BOARD.x + (i % 2 ? 0.15 : -0.15), CARD_Y[i], BOARD.z + 0.32); c.rz = (i % 2 ? -1 : 1) * 0.05;
      return c;
    });
    S.spark = L.makeSparkle(ctx, { size: 1.6, n: 6, seed: 21 + spec.n }); S.spark.group.position.set(BOARD.x, 6.2, BOARD.z + 0.8); root.add(S.spark.group);

    // ---- the presenter ----
    const cast = ctx.reel.cast ?? ['mei', 'jordan', 'zara'];
    S.hero = add(namedPerson(ctx, cast[(spec.n + 1) % cast.length] ?? 'zara', { mouth: 'smile' }), HERO[0], HERO[1], HERO[2], -0.25);
    S.root = root;
    kws.forEach((k) => ctx.sfx(k.t, 'pop', -3));
    ctx.sfx(wideT, 'shimmer', -6);
  },

  update(ctx, t, spec) {
    const S = spec.state, { inv, smooth, spring, lerp, clamp } = U;
    S.root.visible = t > spec.t0 - 0.6 && t < spec.t1 + 0.6;
    if (!S.root.visible) return;
    const imp = (dt, a = 1, d = 12) => (dt < 0 ? 0 : a * Math.exp(-d * dt));

    // cards fly in from the camera side and slap onto the board
    let newest = -1;
    S.cards.forEach((c, i) => {
      const k = inv(S.kws[i].t - 0.12, S.kws[i].t + 0.1, t);
      if (t >= S.kws[i].t - 0.12) newest = i;
      c.group.visible = k > 0;
      c.group.position.set(c.home.x - (1 - k) * 0.8, c.home.y + (1 - k) * 0.5, c.home.z + (1 - U.easeIn(k)) * 2.5);
      const squash = U.landSquash(t, S.kws[i].t + 0.1, 0.18);
      c.group.scale.set(1 + squash, 1 - squash, 1);
      c.group.rotation.set(0, 0, c.rz + (1 - k) * 0.5);
      c.set({ pop: 1 });
    });
    S.spark.set({ k: inv(S.wideT, S.wideT + 0.9, t) });

    // presenter: talks, points at the newest card (R arm up toward the board on screen left), hops on the wide
    const tgtY = newest >= 0 ? CARD_Y[newest] : 2.4;
    const pk = newest >= 0 ? spring(inv(S.kws[newest].t - 0.1, S.kws[newest].t + 0.25, t), 2.4, 5) : 0;
    const wide = smooth(inv(S.wideT, S.wideT + 0.2, t));
    const lift = clamp((tgtY - 2.4) / 3.8);
    const talk = 0.3 + 0.3 * Math.abs(Math.sin(t * 14));
    S.hero.set({
      hop: U.hopAt(t, S.wideT, 0.6, 0.34) + Math.max(0, ...S.kws.map((k) => U.hopAt(t, k.t - 0.05, 0.18, 0.22))),
      squash: U.landSquash(t, S.wideT + 0.34, 0.35),
      turn: lerp(-12, -26, pk) * (1 - wide), lookX: -0.45 * pk * (1 - wide), lookY: (0.05 + 0.6 * lift) * pk * (1 - wide),
      armL: lerp(lerp(15, 85 + 65 * lift, pk), 160, wide), reachL: lerp(lerp(0, 25 - 15 * lift, pk), 10, wide),
      armR: lerp(lerp(20, 35, pk), 160, wide), reachR: lerp(15, 30, pk) * (1 - wide), elbowR: 30 * (1 - wide),
      mouth: wide > 0.5 ? 'teeth' : 'smile', mouthOpen: talk * (1 - wide * 0.5), blink: U.blinkAt(t, spec.n),
      tilt: 3 * Math.sin(t * 4.2), nod: 4 * Math.sin(t * 6), t,
    });

    // crowd floods in from both sides at the beat start, then bobs and cheers on the wide
    if (S.crowd) {
      S.crowd.forEach((p, i) => {
        const k = smooth(inv(spec.t0 - 0.3 + p.delay, spec.t0 + 0.55 + p.delay, t));
        p.group.position.set(p.home.x + p.side * (1 - k) * 7, 0, p.home.z);
        const walking = k < 1;
        p.set({ walk: walking ? t * 2.4 + i * 0.3 : undefined, turn: walking ? -p.side * 70 : -p.side * 18, lookX: -0.25 * p.side, lookY: 0.35,
          hop: U.hopAt(t, S.wideT + i * 0.04, 0.4, 0.3) + (walking ? Math.abs(Math.sin(t * 15 + i)) * 0.08 : 0),
          armL: 20 + 140 * wide, armR: 20 + 140 * wide, mouth: wide > 0.5 ? 'teeth' : 'smile', blink: U.blinkAt(t, i + 3), t });
      });
    }

    if (t >= spec.t0 - spec.blend / 2 - 0.1 && t <= spec.t1 + 0.35) {
      ctx.bg = S.bg;
      const sh = U.shotAt(t, S.shots), o = spec.o;
      const i = sh.id.startsWith('card') ? +sh.id.slice(4) : -1;
      ctx.focus = U.at(o, i >= 0 ? [S.cards[i].home.x, CARD_Y[i], S.cards[i].home.z] : sh.id === 'wide' ? [0, 5, 0] : [HERO[0], 2.2, HERO[2]]);
      ctx.dof = sh.id === 'wide' ? 0.5 : 0.75;
      ctx.shake = Math.min(0.6, Math.max(0, ...S.kws.map((k) => imp(t - k.t - 0.1, 0.32, 14))));
    }
  },

  camera(ctx, t, spec) {
    const S = spec.state, o = spec.o, s = U.shotAt(t, S.shots);
    if (s.id === 'intro') return U.shot(o, [2.4, 2.0, 9.6], [1.9, 2.2, 8.6], [0.9, 2.5, 0.4], U.inv(spec.t0 - 0.4, s.t1, t), 44, -3);
    if (s.id === 'wide') return U.shot(o, [1.6, 3.4, 16.6], [0.9, 3.8, 18.0], [0, 3.9, 0], s.k, 50, 1.5);
    // card i: the new card (left) AND the presenter (right) in one frame, alternating angles, slow push
    const i = +s.id.slice(4), y = CARD_Y[i], side = i % 2 ? -1 : 1;
    const tgt = [0.05, Math.max(2.6, y - 0.9), 0];
    return U.shot(o, [tgt[0] + side * 1.0, tgt[1] - 0.5, 12.0], [tgt[0] + side * 0.7, tgt[1] - 0.35, 11.0], tgt, s.k, 42, side * 2.5);
  },
};

function hash(s) { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
