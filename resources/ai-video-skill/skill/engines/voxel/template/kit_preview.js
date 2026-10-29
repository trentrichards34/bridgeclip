// kit_preview.js: contact sheet of every kit prop + the cast (one page per t = 1, 2, 3 ...).
//   node tools/reel.mjs stills <project> 1 2 3 4 5 6 7 8 9 10 --only kit     then open stills/sheet.jpg
// ADD YOUR OWN PROPS: push a page { name, bg, cam: {pos, target, fov} (relative to the page origin), build(ctx, root) -> { pose() } }
// and render just that page (e.g. `stills <project> 9 --only kit`). Check: faces +Z, sits on y = 0, text readable, felt look.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';
import { namedPerson, extraPerson, PEOPLE } from '/engine/kits/people.js';

const C = L.C, K = KT.K;
const at = (o, x, y, z, parent) => { o.group.position.set(x, y, z); parent.add(o.group); return o; };
const room = (g, o) => { const r = L.makeRoom(null, { w: 26, d: 14, h: 18, side: null, ...o }); g.add(r.group); return r; };

export default [
  { name: 'cast: 10 named presets (people.js PEOPLE)', bg: '#1a1630', cam: { pos: [0, 3.6, 21], target: [0, 2.9, 0], fov: 50 },
    async build(ctx, g) {
      await L.libFonts();
      room(g, { wall: C.wall, floor: C.carpet, wainscot: C.wood, trim: C.gold });
      const names = Object.keys(PEOPLE);
      // back row on a riser, front row on the floor; name cards at their feet
      const ppl = names.map((n, i) => at(namedPerson(ctx, n), (i % 5 - 2) * 1.95, i < 5 ? 2.3 : 0, i < 5 ? -3.0 : 1.0, g));
      L.B(11, 2.3, 2.6, L.mat(C.woodDark), { r: 0.06, y: 1.15, z: -3.0, parent: g });
      const tags = names.map((n, i) => at(KT.makeLabelCard(ctx, n.toUpperCase(), { color: [C.blue, K.red, K.green, C.mustard, C.purple][i % 5], w: 1.7, h: 0.6 }), (i % 5 - 2) * 1.95, i < 5 ? 5.6 : 0.45, i < 5 ? -2.8 : 2.1, g));
      const ex = [11, 12].map((s, i) => at(extraPerson(ctx, s), i ? 5.6 : -5.6, 0, -0.8, g));
      const ex0 = KT.makeLabelCard(ctx, 'extraPerson(ctx, seed)', { color: C.ink, w: 4.2, h: 0.7 }); ex0.group.position.set(0, 7.0, -3.2); g.add(ex0.group);
      return { pose() {
        const EX = ['happy', 'shock', 'neutral', 'determined', 'wink', 'sad', 'happy', 'neutral', 'shock', 'happy'];
        ppl.forEach((p, i) => p.set({ expr: EX[i], armR: i % 3 === 0 ? 140 : 15, reachR: i % 3 === 0 ? 35 : 0, armL: i % 4 === 1 ? 120 : 10, waveL: i % 4 === 1 ? 0.8 : 0, t: 0.3, lookX: (i % 5 - 2) * -0.1 }));
        ex.forEach((p, i) => p.set({ armL: 30 + i * 40, mouth: i ? 'o' : 'teeth' })); tags.forEach((c) => c.set({ pop: 1 }));
      } };
    } },
  { name: 'shopfront: street, skyline, shops, founders', bg: '#9cc0e0', cam: { pos: [7, 5.5, 27], target: [0.3, 4.3, 0], fov: 55 },
    async build(ctx, g) {
      const street = at(KT.makeStreet(ctx, { w: 50 }), 0, 0, 0, g);
      const sky = at(KT.makeSkyline(ctx, { w: 70, z: -12 }), 0, 0, 0, g);
      const red = at(KT.makeShop(ctx, { preset: 'red' }), -5.0, 0, 0, g);
      const green = at(KT.makeShop(ctx, { preset: 'green' }), 5.0, 0, 0, g);
      const fr = at(KT.makeFounder(ctx, 'red'), -3.2, 0, 4.2, g), fg = at(KT.makeFounder(ctx, 'green'), 3.2, 0, 4.2, g);
      const c1 = KT.makeCup(ctx, { color: K.red, icon: 'bean' }); fr.holdR(c1.group, [0, -0.05, 0.3]);
      const c2 = KT.makeCup(ctx, { color: K.green, icon: 'door' }); fg.holdL(c2.group, [0, -0.05, 0.3]);
      const conf = at(L.makeConfetti(ctx, { n: 80 }), 0, 4, 3, g);
      return { pose() { street.set({ rise: 1 }); sky.set({ rise: 0.85 }); red.set({ shutter: 0.35, open: 0, sign: 1, t: 0.3 }); green.set({ shutter: 0, open: 0.5, t: 0.3 });
        fr.set({ armR: 120, hop: 0.2, squash: -0.1, lookX: 0.2 }); fg.set({ armL: 110, tilt: -6, lookX: -0.2 }); c1.set({ steam: 1, t: 0.4 }); c2.set({ steam: 1, t: 0.7 }); conf.set({ k: 0.3 }); } };
    } },
  { name: 'shopfront: crowd types, label cards, spotlight', bg: '#1a1630', cam: { pos: [0.5, 5.0, 18.5], target: [0, 2.9, -0.5], fov: 50 },
    async build(ctx, g) {
      room(g, { wall: C.wall, floor: C.carpet, d: 14, h: 14, wainscot: C.wood, trim: C.gold });
      const types = [['student', 'STUDENT'], ['pro', 'PROFESSIONAL'], ['nerd', 'COFFEE NERD'], ['anyone', 'ANYONE']];
      const crowd = types.map(([t, lab], i) => ({ c: at(KT.makeCrowdMember(ctx, t, i + 1), -4.2 + i * 2.8, 0, -2.5, g), card: at(KT.makeLabelCard(ctx, lab, { color: [C.blue, '#4a4d57', C.mustard, K.red][i], w: 2.6, h: 0.95 }), -4.2 + i * 2.8, 3.5 + (i % 2) * 0.5, -2.3, g) }));
      const extra = [5, 6].map((s, i) => at(KT.makeCrowdMember(ctx, 'anyone', s), -3.5 + i * 7, 0, 0.2, g));
      const hp = KT.makeHeadphones(ctx); hp.group.scale.setScalar(0.62); extra[1].top.add(hp.group);
      const pro = at(KT.makeBusyPro(ctx), 0, 0, 2.2, g);
      const spot = at(KT.makeSpotlight(ctx, { h: 10, radius: 1.7 }), 0, 0, 2.2, g);
      const tag = at(KT.makeLabelCard(ctx, 'BUSY PRO', { color: K.navy, sub: 'wants it delivered', icon: 'clock', w: 3.4, h: 1.3 }), 1.6, 5.2, 2.6, g); tag.group.rotation.z = -0.06;
      return { pose() { crowd.forEach(({ c, card }, i) => { c.set({ armR: i === 0 ? 40 : 10, tilt: (i % 2 ? 4 : -4), lookX: 0.3 }); card.set({ pop: 1 }); }); extra[0].set({ armL: 60, mouth: 'o' }); extra[1].set({ lookX: -0.4 }); hp.set({ on: 1 });
        pro.set({ ...pro.hurry(0.3), turn: 0 }); spot.set({ on: 1 }); tag.set({ pop: 1 }); } };
    } },
  { name: 'shopfront: marquee sign (cross), banner, megaphone, bubble', bg: '#1a1630', cam: { pos: [1.0, 5.2, 16], target: [0, 5.0, -1], fov: 54 },
    async build(ctx, g) {
      room(g, { wall: C.mustard, floor: '#6b3f22', d: 14, h: 16, wainscot: '#5a3420', trim: C.gold });
      const sign = at(KT.makeBigSign(ctx, 'YOUR BIG IDEA', { color: K.red }), 0, 0, -4.5, g);
      const ban = at(KT.makeBanner(ctx, 'EVERYONE', { w: 8, h: 2.4 }), 0, 11.6, -5.5, g);
      L.B(2.4, 1.0, 1.8, L.mat(C.woodLight), { r: 0.06, x: -2.2, y: 0.5, z: 1.5, parent: g });
      const red = at(KT.makeFounder(ctx, 'red'), -2.2, 1.0, 1.5, g);
      const mega = KT.makeMegaphone(ctx); red.holdR(mega.group, [0.1, -0.1, 0.2]); mega.group.rotation.y = 0.9;
      const bub = at(KT.makeBubble(ctx, { text: 'HELLO THERE!', w: 3.2, h: 1.7 }), 3.0, 7.4, 1.0, g);
      const p2 = at(KT.makeCrowdMember(ctx, 'anyone', 9), 3.2, 0, 3.5, g);
      return { pose() { sign.set({ lit: 1, t: 0.4, cross: 0.7 }); ban.set({ unroll: 0.8 }); red.set({ armR: 70, reachR: 60, hop: 0.05, brow: 14, mouthOpen: 0.5 }); mega.set({ blast: 1, t: 0.2 }); bub.set({ pop: 1, deflate: 0.3 }); p2.set({ turn: -20, lookX: -0.6, cross: 1, mouth: 'flat' }); } };
    } },
  { name: 'shopfront: site, packaging, content, boxes, bike', bg: '#cfe3d4', cam: { pos: [0.5, 4.4, 15], target: [0, 3.6, 0], fov: 50 },
    async build(ctx, g) {
      room(g, { wall: '#cfe3d4', floor: '#9a8a74', w: 22, d: 12, h: 16, wainscot: K.forest, trim: C.gold });
      const phone = at(KT.makePhoneSite(ctx), -2.0, 4.2, -1.0, g);
      at(KT.makePackaging(ctx), 2.0, 4.2, -1.0, g);
      L.B(9, 0.3, 2.2, L.mat(C.wood), { r: 0.06, y: 4.05, z: -1.0, parent: g });
      for (const s of [-1, 1]) L.B(0.4, 4.0, 2.0, L.mat(C.woodDark), { r: 0.05, x: s * 4.2, y: 2.0, z: -1, parent: g });
      const card = at(KT.makeContentCard(ctx), -2.0, 2.0, 1.4, g); card.group.rotation.set(-0.05, 0.12, 0.04);
      const sub = at(KT.makeSubscriptionBox(ctx), 2.0, 0, 1.6, g); sub.group.rotation.y = -0.2;
      const box = at(KT.makeDeliveryBox(ctx), 4.6, 0, 3.2, g); box.group.rotation.y = -0.4;
      const bike = at(KT.makeDeliveryBike(ctx), -5.2, 0, 3.6, g); bike.group.rotation.y = 0.5;
      const stamp = L.makePrint(ctx, { text: 'DONE!', color: K.green, w: 1.4, h: 0.6 }); stamp.position.set(0.7, 0.9, 0.12); stamp.rotation.z = -0.2; card.group.add(stamp);
      return { pose() { phone.set({ tap: 0, glow: 0.4 }); card.set({ play: 0.35 }); sub.set({ open: 0.25 }); box.set({ open: 0.8 }); bike.set({ roll: 0 }); } };
    } },
  { name: 'shopfront: front door, magnifier, heart, coin jars', bg: '#a9c6dc', cam: { pos: [1.5, 3.8, 13.5], target: [0, 2.6, -1], fov: 52 },
    async build(ctx, g) {
      room(g, { wall: C.paleBlue, floor: '#7a9a6a', w: 24, d: 12, h: 16 });
      const fd = at(KT.makeFrontDoor(ctx), 0, 0, -3.5, g);
      const pro = at(KT.makeBusyPro(ctx, { mouth: 'smile' }), -0.2, 0.24, -2.9, g);
      const box = at(KT.makeDeliveryBox(ctx, { w: 1.2, h: 0.8, d: 0.9 }), 1.4, 0, -1.4, g); box.group.scale.setScalar(0.9);
      const cup = at(KT.makeCup(ctx, { color: K.green, icon: 'door' }), 1.4, 0.35, -1.4, g);
      const gr = at(KT.makeFounder(ctx, 'green'), 2.9, 0, 0.6, g);
      const mag = KT.makeMagnifier(ctx); gr.holdL(mag.group, [0, 0.4, 0.5]); mag.group.scale.setScalar(0.8);
      const heart = at(KT.makeHeart(ctx, { size: 0.8 }), 1.8, 4.2, -1.0, g);
      const jarA = at(KT.makeCoinJar(ctx), -3.4, 0, 0.6, g), jarB = at(KT.makeCoinJar(ctx), -1.9, 0, 1.4, g);
      const sp = at(L.makeSparkle(ctx, { size: 1 }), 1.8, 4.2, -0.8, g);
      return { pose() { fd.set({ open: 0.75 }); pro.set({ armL: 40, reachL: 30, lookX: 0.4, mouth: 'smile' }); box.set({ open: 1 }); cup.set({ steam: 1, t: 0.2 }); gr.set({ armL: 70, reachL: 60, turn: -30, lookX: -0.4 }); mag.set({ glint: 0.5 }); heart.set({ pop: 1, beat: 0.25 }); jarA.set({ fill: 0.5 }); jarB.set({ fill: 0.9 }); sp.set({ k: 0.3 }); } };
    } },
  { name: 'shopfront: signpost, scale, target, blocks, meter', bg: '#1a1630', cam: { pos: [0.5, 5.2, 17], target: [0, 4.6, -1], fov: 56 },
    async build(ctx, g) {
      room(g, { wall: C.purple, floor: '#5a3420', wainscot: '#3e2a63' });
      const post = at(KT.makeSignpost(ctx, { road: false }), -3.4, 0, -5.2, g); post.group.scale.setScalar(0.8);
      const scale = at(KT.makeScale(ctx, { left: 'OPTION A', right: 'OPTION B' }), 3.6, 0, -3.8, g); scale.group.scale.setScalar(0.72);
      scale.panL.add(KT.makeCup(ctx, { color: K.red, icon: 'bean', steam: false, size: 0.8 }).group);
      scale.panR.add(KT.makeCup(ctx, { color: K.green, icon: 'door', steam: false, size: 0.8 }).group);
      const tgt = at(KT.makeTarget(ctx), 0, 3.6, -4.5, g);
      const dart = KT.makeDart(ctx, { size: 0.9 }); dart.group.position.copy(tgt.center).add(new THREE.Vector3(0.05, 0.05, 0)); dart.group.rotation.set(0.15, 0.2, 0); tgt.group.add(dart.group);
      L.B(3, 3.6, 2, L.mat(C.woodDark), { r: 0.06, y: 1.8, z: -4.8, parent: g });
      const cards = [['WHO', 'busy pros', 'person', C.blue], ['WHAT THEY VALUE', 'time', 'clock', C.mustard], ['WHY YOU', 'at your door', 'door', K.green]].map(([t, s, ic, col], i) => { const c = at(KT.makeLabelCard(ctx, t, { sub: s, icon: ic, color: col, w: 3.0, h: 1.15, pin: true }), -3.0 + i * 3.0, 8.0 + (i % 2) * 0.6, -1.5, g); c.group.rotation.z = (i - 1) * -0.05; return c; });
      const blocks = at(KT.makeLetterBlocks(ctx, 'CONVENIENCE', { size: 0.72, icons: ['clock', 'door', 'phone'] }), 0, 0, 1.8, g);
      const meter = at(KT.makeMeter(ctx, 'MAYBE?'), -2.6, 0, -1.6, g); meter.group.scale.setScalar(0.7); meter.group.rotation.y = 0.3;
      return { pose() { post.set({ k: 1 }); scale.set({ tip: 0.6 }); tgt.set({ hit: 0.3 }); cards.forEach((c) => c.set({ pop: 1 })); blocks.set({ k: 0.93 }); meter.set({ value: 0.45 }); } };
    } },
  { name: 'base: paper props, FX, furniture', bg: '#2a2350', cam: { pos: [0, 5.0, 17.5], target: [0, 4.4, 0], fov: 54 },
    async build(ctx, g) {
      room(g, { wall: '#7a3f5f', floor: C.woodDark, wainscot: C.woodDark, trim: C.gold });
      const card = at(L.makeCard(ctx, { lines: ['YOUR', { text: 'IDEA', color: C.no }] }), -3.6, 8.6, -4.5, g);
      const sign = at(L.makeSign(ctx, { text: 'IT WILL FAIL', chart: 'down' }), -3.7, 0, -2.0, g);
      const tally = at(L.makeTally(ctx, { left: 'NO', right: 'YES' }), 0.4, 3.4, -6.2, g); tally.group.scale.setScalar(0.6);
      const list = at(L.makeChecklist(ctx, { title: 'CHECKLIST', items: ['Hook in 1 s', 'One idea per beat', 'Comment keyword'] }), 4.0, 4.6, -3.5, g);
      const cert = at(L.makeCertificate(ctx), 0.2, 8.9, -6.0, g);
      const tag = at(L.makePriceTag(ctx, '$49/month'), -0.6, 2.4, 1.6, g);
      const pill = at(L.makeCommentPill(ctx, { w: 5.0, h: 0.8 }), 0.4, 1.0, 3.6, g);
      const stamp = at(L.makeStamp(ctx, { text: 'YES!' }), 3.3, 0, 2.6, g);
      stamp.print.position.set(4.4, 2.2, -3.4); g.add(stamp.print);
      at(L.makeMoneyBag(ctx), -2.6, 0, 1.4, g); at(L.makeShoppingBag(ctx), -1.4, 0, 2.6, g); at(L.makeBallotBox(ctx), 1.8, 0, 0.6, g);
      const x = at(L.makeBigX(ctx, { size: 1.4 }), -2.8, 6.0, -2.0, g), ck = at(L.makeBigCheck(ctx, { size: 1.4 }), 3.3, 8.4, -2.0, g);
      const clock = at(L.makeClock(ctx, { r: 1.0 }), 3.6, 11.2, -6.5, g);
      const sp = at(L.makeSparkle(ctx, { size: 1.2 }), 3.4, 8.4, -1.6, g);
      const conf = at(L.makeConfetti(ctx, { n: 60, spread: 5 }), 0, 6, -1, g);
      return { pose() { sign.set({ flip: 1 }); tally.set({ a: 3, b: 9 }); list.set({ ticks: [1, 1, 0.6] }); tag.set({ tear: 0.25 }); pill.set({ text: ctx.keyword, caret: 1 }); stamp.printSet(1); clock.set({ h: 10, m: 10 }); sp.set({ k: 0.3 }); conf.set({ k: 0.3 }); } };
    } },
  { name: 'icons (KT.ICON_KINDS), price tag + clock 12 away', bg: '#2a2350', cam: { pos: [0, 5, 14], target: [0, 5, 0], fov: 46 },
    async build(ctx, g) {
      await L.libFonts();
      room(g, { wall: C.wall, floor: C.woodDark, wainscot: C.woodDark, trim: C.gold });
      L.B(5.9, 3.9, 0.2, L.mat(C.kraft), { r: 0.08, y: 6.75, z: -0.25, parent: g });
      const cols = [K.green, K.red, C.blue, C.mustard, C.purple, K.navy];
      KT.ICON_KINDS.forEach((kind, i) => { const st = KT.makeIconSticker(ctx, kind, { size: 0.74, bg: cols[i % cols.length] }); st.position.set(-2.4 + (i % 6) * 0.96, 8.15 - Math.floor(i / 6) * 0.92, -0.1); g.add(st); });
      const tag = at(L.makePriceTag(ctx, '$4.99/loaf'), -1.0, 3.0, 2.0, g);
      const clock = at(L.makeClock(ctx, { r: 0.7 }), 1.6, 3.0, 2.0, g);
      return { pose() { tag.set({ tear: 0 }); clock.set({ h: 10, m: 10 }); } };
    } },
  { name: 'two shops w 6.6, facade 40 away, fov 46, street clear 9', bg: '#9cc0e0', cam: { pos: [0, 5.2, 40], target: [0, 4.2, 0], fov: 46 },
    async build(ctx, g) {
      await L.libFonts();
      const street = at(KT.makeStreet(ctx, { w: 60, clear: 9 }), 0, 0, 0, g);
      const sky = at(KT.makeSkyline(ctx, { w: 70, z: -12 }), 0, 0, 0, g);
      const a = at(KT.makeShop(ctx, { preset: 'red', name: 'BAKERY 1', icon: 'bread', w: 6.6 }), -3.8, 0, 0, g);
      const b = at(KT.makeShop(ctx, { preset: 'green', name: 'BAKERY 2', icon: 'cake', w: 6.6 }), 3.8, 0, 0, g);
      const fa = at(KT.makeFounder(ctx, 'red'), -3.8, 0, 3.4, g), fb = at(KT.makeFounder(ctx, 'green'), 3.8, 0, 3.4, g);
      return { pose() { street.set({ rise: 1 }); sky.set({ rise: 1 }); a.set({ shutter: 0, open: 0.3, t: 0.2 }); b.set({ shutter: 0, open: 0.3, t: 0.5 }); fa.set({ armR: 130, reachR: 30 }); fb.set({ armL: 130, reachL: 30 }); } };
    } },
];
