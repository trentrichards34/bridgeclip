// LIBRARY REFERENCE (k12_ignored.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k12_ignored 37.3-40.8 "Because when you're trying to speak to everyone, your message can become easy to ignore."
// A (Because..speak): RED lands on his crate, megaphone pumps per word, inhales on "trying", and on "speak" a big
//    WE MAKE GREAT COFFEE bubble bursts out of the megaphone.
// B ("everyone"): hard cut over RED's shoulder: the bubble sails toward the crowd while, one per word, they tune out:
//    headphones drop on, phones come up (everyone / ~ / ~ / your / message).
// C ("can"): hard cut to the crowd, front: they vibe with eyes shut; on "easy" the bubble boinks off the headphones,
//    falls to the pavement and deflates on "ignore". Nobody even looks.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const K = KT.K, C = L.C;
let S = null;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const pulse = (t, at, len = 0.22) => (t < at || t > at + len ? 0 : Math.sin(Math.PI * (t - at) / len));
const decay = (t, at, k = 7) => (t < at ? 0 : Math.exp(-k * (t - at)));
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

function makePhone() {
  const g = new THREE.Group();
  L.B(0.5, 0.9, 0.08, L.mat('#24242c', { rough: 0.45 }), { r: 0.04, parent: g });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.74), L.glowMat('#9fd4ff', 0.75));
  scr.position.z = -0.045; scr.rotation.y = Math.PI; g.add(scr);   // screen faces the holder (-Z)
  return g;
}

// camera (standalone so update can billboard the bubble toward it)
function cam(ctx, t, spec) {
  const { T } = S, o = spec.o, U = ctx.U;
  const W = (p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
  const dr = (s) => U.drift(t * 1.4, s) * 0.12;
  if (t < T.everyone) {   // A: low front-right on RED, push in, dutch
    const k = clamp((t - (spec.t0 - 0.4)) / (T.everyone - spec.t0 + 0.4)), ek = U.easeOut(k);
    const kick = 2.5 * pulse(t, T.speak, 0.18);
    return { pos: W([-0.2 - ek * 0.6 + dr(1), 2.6 + ek * 0.3, 12.0 - ek * 1.4]), target: W([-2.6 + dr(2), 3.9 + ek * 0.2, 1.6]), fov: 46 - ek * 2 + kick, roll: -6 + ek * 3 };
  }
  if (t < T.can) {        // B: over RED's left shoulder toward the crowd, tracking the bubble's flight, arc right
    const k = clamp((t - T.everyone) / (T.can - T.everyone)), ek = U.easeInOut(k);
    return { pos: W([-8.5 + ek * 0.9 + dr(3), 6.0 - ek * 0.6, 9.0 - ek * 0.4]), target: W([1.0 + ek * 0.8 + dr(4), 3.0 - ek * 0.4, -0.2 - ek * 0.2]), fov: 44 - ek * 2, roll: 4 - ek * 3 };
  }
  // C: front, low, on the vibing crowd; follows the bubble down to the pavement
  const k = clamp((t - T.can) / (spec.t1 + 0.4 - T.can)), ek = U.easeOut(k);
  const fall = clamp((t - T.easy) / (T.ignore - T.easy));
  const ef = U.easeInOut(fall);
  return { pos: W([0.7 - ek * 0.3 + dr(5), 2.9 - ef * 0.3, 11.2 - ek * 0.5 - ef * 0.6]), target: W([1.0 - ef * 0.4 + dr(6), 2.8 - ef * 1.6, 0.5 + ef * 1.3]), fov: 46 - ek * 2, roll: -4 + ek * 3 };
}

export default {
  async init(ctx, spec) {
    await L.libFonts();
    const root = new THREE.Group(); root.position.set(...spec.o); ctx.scene.add(root);
    const at = (o, x, y, z, ry = 0) => { o.group.position.set(x, y, z); o.group.rotation.y = ry; root.add(o.group); return o; };
    const w = (n, d) => ctx.wordAt(n, spec.t0) ?? d;
    const T = {
      because: w('Because', 37.34), when: w('when', 37.50), youre: w("you're", 37.66), trying: w('trying', 37.82),
      speak: w('speak', 38.14), everyone: w('everyone,', 38.46), your: w('your', 39.10), message: w('message', 39.26),
      can: w('can', 39.58), become: w('become', 39.74), easy: w('easy', 39.98), ignore: w('ignore.', 40.46),
    };
    T.to2 = ctx.wordAt('to', T.easy + 0.05) ?? 40.30;

    const street = at(KT.makeStreet(ctx, { w: 60 }), 0, 0, -3);
    const sky = at(KT.makeSkyline(ctx, { w: 70, z: -14 }), 0, 0, -6);
    const shop = at(KT.makeShop(ctx, { preset: 'red' }), -4.5, 0, -6.5);

    // RED on a crate, megaphone aimed at the crowd (screen right)
    const crate = new THREE.Group(); crate.position.set(-3.6, 0, 1.4); root.add(crate);
    L.B(2.2, 1.0, 1.7, L.mat(C.woodLight), { r: 0.06, y: 0.5, parent: crate });
    for (const y of [0.25, 0.75]) L.B(2.24, 0.08, 1.74, L.mat(C.wood), { r: 0.02, y, parent: crate });
    const red = at(KT.makeFounder(ctx, 'red'), -3.6, 1.0, 1.4, 0.55);
    const mega = KT.makeMegaphone(ctx); red.holdR(mega.group, [0.1, -0.1, 0.2]); mega.group.rotation.y = 0.9;

    // the crowd: they will tune out one by one
    const crowd = [
      { c: at(KT.makeCrowdMember(ctx, 'anyone', 2), 1.3, 0, 0.7, -0.75), mode: 'hp', on: T.everyone + 0.04, hpCol: '#3a5bd0' },       // bubble target
      { c: at(KT.makeCrowdMember(ctx, 'nerd', 4), 2.6, 0, -1.5, -0.85), mode: 'hp', on: T.everyone + 0.28, hpCol: '#2b2b33' },
      { c: at(KT.makeCrowdMember(ctx, 'student', 3), 3.6, 0, 0.5, -0.9), mode: 'phone', on: T.everyone + 0.5 },
      { c: at(KT.makeCrowdMember(ctx, 'pro', 7), 4.9, 0, -1.3, -1.0), mode: 'phone', on: T.your },
      { c: at(KT.makeCrowdMember(ctx, 'anyone', 11), 0.2, 0, -1.9, -0.6), mode: 'hp', on: T.message, hpCol: '#c8423a' },
    ];
    for (const m of crowd) {
      if (m.mode === 'hp') { m.hp = KT.makeHeadphones(ctx, { color: m.hpCol }); m.c.top.add(m.hp.group); }
      else { m.phone = makePhone(); m.c.holdR(m.phone, [0, 0.25, 0.35]); m.phone.rotation.x = -0.35; }
      if (m.c.acc.kettle) m.c.acc.kettle.visible = true;
    }

    const bubble = at(KT.makeBubble(ctx, { text: 'WE MAKE GREAT COFFEE' }), 0, 0, 0);
    // pavement puff when the bubble lands
    const dm = L.mat('#efe3cc', { felt: 0.6, transparent: true, opacity: 1 });
    const dust = []; for (let i = 0; i < 8; i++) { const m = L.B(0.3, 0.3, 0.3, dm, { r: 0.1, parent: root }); m.castShadow = false; dust.push({ m, a: (i / 8) * Math.PI * 2 }); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.07, 8, 32), L.glowMat('#fff2c2', 1.0, { transparent: true, opacity: 0.8, depthWrite: false }));
    root.add(ring);
    S = { root, T, street, sky, shop, red, mega, crowd, bubble, dm, dust, ring, mouthW: new THREE.Vector3() };
  },

  update(ctx, t, spec) {
    const { root, T, street, sky, shop, red, mega, crowd, bubble, dm, dust, ring } = S;
    const U = ctx.U, o = spec.o;
    root.visible = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    if (!root.visible) return;
    const inWin = t >= spec.t0 - spec.blend / 2 && t <= spec.t1 + spec.blend / 2;
    street.set({ rise: 1 }); sky.set({ rise: 1 });
    for (const p of street.props) if (Math.abs(p.g.position.x) < 9) p.g.visible = false;   // no tree/lamp in front of the crowd
    shop.set({ shutter: 0, open: 0.3, sign: 1, t });

    // ---- RED: mid-hop at frame 0, lands on "Because", pumps per word, inhales on "trying", blasts on "speak"
    const land = T.because + 0.06;
    const hopUp = t < land ? Math.max(0, Math.sin(Math.PI * clamp((t - (land - 0.5)) / 0.5))) * 0.8 : 0;
    const landSq = t >= land ? 0.4 * decay(t, land, 8) * Math.cos((t - land) * 18) : 0;
    const inhale = U.win(t, T.trying, T.speak + 0.02, 0.2, 0.04);
    const yell = decay(t, T.speak, 4);
    const words = [T.because, T.when, T.youre, T.trying, T.speak, T.everyone];
    let talk = 0; for (const s of words) talk = Math.max(talk, pulse(t, s, 0.2));
    const armR = U.track([[spec.t0 - 0.5, 60], [T.when, 60], [T.when + 0.1, 85], [T.trying, 70], [T.speak, 100]], t, U.easeOut);
    const sad = clamp((t - T.ignore) / 0.25);
    red.set({ hop: hopUp, squash: landSq - inhale * 0.25 + yell * 0.18 * Math.cos((t - T.speak) * 14),
      armR: lerp(armR, 40, sad), reachR: 55, armL: 30 + 60 * pulse(t, T.youre, 0.35) + 40 * yell,
      lean: -inhale * 12 + yell * 9, tilt: Math.sin(t * 7) * 3, lookX: 0.5, lookY: 0.1, brow: lerp(16, -12, sad),
      mouth: t > T.ignore ? 'frown' : 'o', mouthOpen: 0.25 + 0.75 * Math.max(talk, yell * 0.9), blink: pulse(t, 38.9, 0.12) });
    const blast = Math.max(...words.map((s) => decay(t, s, 5)));
    mega.set({ blast: clamp(0.3 + blast), t });
    mega.group.scale.setScalar(1 + 0.16 * Math.max(...words.map((s) => pulse(t, s, 0.18))) + 0.25 * pulse(t, T.speak, 0.25));

    // ---- crowd: watch RED, then tune out one by one; vibe to music (synced nod), eyes shut
    const beat = (t - T.everyone) * 2.4;
    crowd.forEach((m, i) => {
      const c = m.c, k = clamp((t - m.on) / 0.32), gone = t >= m.on;
      const pop = gone ? U.spring(clamp((t - m.on) / 0.45), 2.8, 6) : 0;
      const groove = gone ? Math.abs(Math.sin(Math.PI * beat + i * 0.3)) : 0;
      const hit = i === 0 ? decay(t, T.easy, 8) * (t >= T.easy ? 1 : 0) : 0;
      const pose = { hop: Math.sin(t * 4.5 + i * 1.7) * 0.03 + (gone ? 0.25 * pulse(t, m.on + 0.3, 0.2) : 0), lookX: gone ? 0 : -0.35, lookY: gone ? -0.1 : 0.25,
        tilt: Math.sin(t * 3 + i) * 2 + (gone && m.mode === 'hp' ? 5 * Math.sin(Math.PI * beat * 0.5 + i) : 0) - 9 * hit * Math.cos((t - T.easy) * 20),
        squash: hit * 0.25 * Math.cos((t - T.easy) * 22) + (gone ? -0.04 * groove : 0),
        mouth: gone ? (m.mode === 'hp' ? 'smile' : 'flat') : 'flat', mouthOpen: 0,
        blink: gone ? (m.mode === 'hp' ? 0.85 : pulse(t, 39.9 + i * 0.2, 0.12)) : pulse(t, 37.6 + i * 0.31, 0.12) };
      if (m.mode === 'hp') {
        m.hp.set({ on: k });
        Object.assign(pose, { nod: gone ? 8 * groove : 0 });
      } else {
        m.phone.visible = pop > 0.01; m.phone.scale.setScalar(Math.max(0.01, pop));
        Object.assign(pose, { armR: 18, reachR: 75 * pop, nod: 12 * pop, lookY: lerp(0.25, -0.7, pop), lookX: lerp(-0.35, 0.2, pop) });
      }
      c.set(pose);
    });

    // ---- the bubble: bursts out on "speak", hovers, flies at the crowd, boinks off on "easy", lands, deflates on "ignore"
    root.updateMatrixWorld(true);
    const mw = mega.group.localToWorld(S.mouthW.copy(mega.mouth));
    const mouthL = [mw.x - o[0], mw.y - o[1], mw.z - o[2]];
    const H = [-2.0, 5.3, 2.2], P = [1.0, 3.5, 1.3], F = [0.0, 0.7, 2.2], CTRL = [-0.6, 5.6, 2.0];
    const hitT = T.easy, landT = T.to2 + 0.06;
    let pos, sc = 0.66, rz = 0, popK = 0, defl = 0, sx = 1, sy = 1;
    if (t < T.speak) { popK = 0; pos = mouthL; }
    else if (t < T.everyone) {
      const k = clamp((t - T.speak) / 0.26);
      popK = clamp((t - T.speak) / 0.3);
      pos = lerp3(mouthL, H, U.easeOut(k)); pos[1] += Math.sin((t - T.speak) * 9) * 0.06;
      rz = 0.25 * (1 - U.easeOut(k)) + Math.sin((t - T.speak) * 11) * 0.04;
    } else if (t < hitT) {
      const k = clamp((t - T.everyone) / (hitT - T.everyone)), e = Math.pow(k, 1.35);
      const a = lerp3(H, CTRL, e), b = lerp3(CTRL, P, e); pos = lerp3(a, b, e);
      popK = 1; sc = lerp(0.66, 0.72, k); rz = Math.sin(t * 6) * 0.07 - 0.05;
      const wob = pulse(t, T.message, 0.25); sx = 1 + 0.08 * wob; sy = 1 - 0.08 * wob;
    } else if (t < landT) {
      const k = clamp((t - hitT) / (landT - hitT));
      pos = lerp3(P, F, k); pos[1] += Math.sin(Math.PI * k) * 1.3;
      popK = 1; sc = lerp(0.72, 0.62, k); rz = k * 0.9;
      const sq = decay(t, hitT, 12); sx = 1 + 0.3 * sq; sy = 1 - 0.3 * sq;
    } else {
      pos = F.slice(); popK = 1; sc = 0.62; rz = 0.9 * decay(t, landT, 6) * Math.cos((t - landT) * 14) * 0.3;
      const sq = decay(t, landT, 10); sx = 1 + 0.25 * sq; sy = 1 - 0.25 * sq;
      defl = clamp((t - T.ignore + 0.04) / 0.2);
    }
    bubble.group.position.set(...pos);
    bubble.group.scale.set(sc * sx, sc * sy, sc);
    bubble.group.visible = t >= T.speak;
    // billboard yaw toward the camera
    const cp = cam(ctx, t, spec).pos;
    bubble.group.rotation.set(0, Math.atan2(cp[0] - o[0] - pos[0], cp[2] - o[2] - pos[2]) * 0.85, rz);
    bubble.set({ pop: popK, deflate: defl });

    // impact ring at the boink + dust on landing
    const rk = clamp((t - hitT) / 0.3);
    ring.visible = t >= hitT && rk < 1;
    ring.position.set(P[0] + 0.2, P[1] - 0.6, P[2]); ring.scale.setScalar(0.5 + rk * 1.6); ring.material.opacity = 0.8 * (1 - rk);
    ring.rotation.set(-0.3, 0, 0);
    const dk = clamp((t - landT) / 0.55);
    dust.forEach(({ m, a }, i) => {
      const r = 0.4 + dk * (1.6 + (i % 3) * 0.4);
      m.visible = t > landT && dk < 1;
      m.position.set(F[0] + Math.cos(a) * r * 1.3, 0.2 + dk * (1 - dk) * 1.4 + (i % 2) * 0.15, F[2] + Math.sin(a) * r * 0.6);
      m.scale.setScalar(Math.max(0.01, (1 - dk) * (1 + (i % 3) * 0.3)));
    });
    dm.opacity = 1 - dk;

    if (!inWin) return;
    const shotA = t < T.everyone, shotB = !shotA && t < T.can;
    if (shotA) ctx.focus = t < T.speak ? [o[0] - 3.4, 3.2, o[2] + 1.6] : [o[0] + pos[0] * 0.5 - 1.7, 4.0, o[2] + 2.0];
    else if (shotB) ctx.focus = [o[0] + pos[0], o[1] + pos[1], o[2] + pos[2]];
    else ctx.focus = t < T.easy ? [o[0] + 1.3, 2.6, o[2] + 0.9] : [o[0] + pos[0], o[1] + pos[1], o[2] + pos[2]];
    ctx.dof = shotA ? 0.9 : shotB ? 0.6 : 0.6;
    ctx.bg = { top: '#7fb0de', mid: '#b5d3ec', bottom: '#efe2c8' };
    ctx.shake = Math.max(0.5 * decay(t, T.speak, 10) * (t >= T.speak ? 1 : 0), 0.55 * decay(t, hitT, 10) * (t >= hitT ? 1 : 0),
      0.3 * decay(t, landT, 12) * (t >= landT ? 1 : 0), 0.25 * decay(t, land, 12) * (t >= land ? 1 : 0));
    ctx.flash = t >= T.speak ? 0.15 * decay(t, T.speak, 14) : 0;
  },

  camera(ctx, t, spec) { return cam(ctx, t, spec); },
};
