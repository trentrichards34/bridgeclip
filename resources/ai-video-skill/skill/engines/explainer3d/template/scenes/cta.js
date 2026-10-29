// CTA (studio look). Example scene: works with ANY words.json. Copy comes from reel.json "cta":
//   { "keyword": "LINK", "title": "Comment", "sub": "and I'll send it to you" }
// A dark glass card springs in on the word "comment" (fallback: start of the beat), the KEYWORD sits in the same blue
// key-word box as the captions, a fingertip taps it (ring + charge burst + click), then the card floats with a sheen.
// After the last spoken word the captions hide and the card owns the frame.
import * as THREE from 'three';
import { makeHand, makeCharges, studioFloor, libEnv, rng } from '/engine/kits/studio.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const CW = 9.6, CH = 7.2, PXW = 1200, PXH = Math.round(PXW * CH / CW);   // card size (cm) and face canvas (px)
const KEY = { y: 455, h: 210 };                                           // keyword box row on the canvas
let S = null;

function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function drawCard(g, cta, press) {
  const W = PXW, H = PXH;
  g.clearRect(0, 0, W, H);
  g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 96); g.clip();
  const bg = g.createLinearGradient(0, 0, W * 0.3, H); bg.addColorStop(0, '#16203a'); bg.addColorStop(0.5, '#0e1424'); bg.addColorStop(1, '#090c14');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const halo = g.createRadialGradient(W / 2, KEY.y, 0, W / 2, KEY.y, 620); halo.addColorStop(0, `rgba(60,130,255,${0.28 + 0.2 * press})`); halo.addColorStop(1, 'rgba(60,130,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, W, H);
  for (let y = 60; y < H; y += 70) for (let x = 40; x < W; x += 70) { g.fillStyle = 'rgba(127,180,255,0.10)'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  g.restore();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = "700 46px 'JetBrains Mono', monospace"; g.fillStyle = 'rgba(255,255,255,0.55)';
  if ('letterSpacing' in g) g.letterSpacing = '10px';
  g.fillText(String(cta.title || 'Comment').toUpperCase(), W / 2, 230);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  // keyword in the caption key-word box (blue fill, 3 px border scaled, two round handles)
  const word = String(cta.keyword || 'LINK').toUpperCase();
  g.font = '800 170px Figtree, Inter, sans-serif'; const tw = Math.min(W - 240, g.measureText(word).width);
  const bw = tw + 110, bx = W / 2 - bw / 2, by = KEY.y - KEY.h / 2;
  g.fillStyle = `rgba(42,122,252,${0.22 + 0.25 * press})`; g.beginPath(); g.roundRect(bx, by, bw, KEY.h, 14); g.fill();
  g.strokeStyle = '#2a7afc'; g.lineWidth = 7; g.beginPath(); g.roundRect(bx + 3.5, by + 3.5, bw - 7, KEY.h - 7, 12); g.stroke();
  for (const [hx, hy] of [[bx, by], [bx + bw, by + KEY.h]]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(hx, hy, 30, 0, 7); g.fill(); g.fillStyle = '#2a7afc'; g.beginPath(); g.arc(hx, hy, 22, 0, 7); g.fill(); }
  g.fillStyle = '#ffffff'; g.fillText(word, W / 2, KEY.y + 8, W - 240);
  g.font = '500 54px Figtree, Inter, sans-serif'; g.fillStyle = '#8d96a8';
  g.fillText(cta.sub || "and I'll send it to you", W / 2, 700, W - 160);
  g.strokeStyle = 'rgba(150,190,255,0.30)'; g.lineWidth = 5; g.beginPath(); g.roundRect(3, 3, W - 6, H - 6, 94); g.stroke();
}

function cues(spec) {
  const pop = spec.cue('comment', 0.02) - 0.3;            // starts during the whip-in, so the incoming shot is never empty
  const tap = Math.max(pop + 0.6, spec.cue(spec.reel?.cta?.keyword || 'link', 0.35));
  const last = spec.words.length ? spec.words[spec.words.length - 1].e : spec.t1 - 0.6;
  return { pop, tap, last };
}

export default {
  init(ctx, spec) {
    spec.reel = ctx.reel;
    const root = ctx.station(spec);
    const env = libEnv(ctx);
    const o = new THREE.Vector3(...spec.o);
    const rig = new THREE.Group(); root.add(rig);
    const slab = new THREE.ExtrudeGeometry(rrShape(CW, CH, 0.95), { depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 20 });
    slab.translate(0, 0, -0.24);
    const body = new THREE.Mesh(slab, new THREE.MeshPhysicalMaterial({ color: '#0b0f18', metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1.2 }));
    body.castShadow = true; rig.add(body);
    const c = document.createElement('canvas'); c.width = PXW; c.height = PXH;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const face = new THREE.Mesh(new THREE.ShapeGeometry(rrShape(CW - 0.02, CH - 0.02, 0.92), 16), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, color: new THREE.Color(0.8, 0.8, 0.8) }));
    { const uv = face.geometry.attributes.uv, p = face.geometry.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / CW + 0.5, p.getY(i) / CH + 0.5); }
    face.position.z = 0.005; rig.add(face);
    const floor = studioFloor(ctx, { r: 60 }); floor.group.position.copy(o).add(V(0, -6.5, 0)); root.add(floor.group);
    const hand = makeHand(ctx); root.add(hand.group);
    const burst = makeCharges(ctx, 60, { color: ctx.P.chargeHot, size: 0.08 }); ctx.scene.add(burst.group);
    const R = rng(9);
    S = { o, root, rig, tex, ctx2d: c.getContext('2d'), hand, burst, drawn: -1, dirs: Array.from({ length: 60 }, () => [R() * 2 - 1, R() * 2 - 1, R() * 0.6, 0.6 + R() * 0.8]) };
    const C = cues(spec);
    ctx.sfx(C.pop, 'pop', 0.9); ctx.sfx(C.tap, 'click', 0.9); ctx.sfx(C.tap + 0.05, 'shimmer', 0.5);
  },

  update(ctx, t, spec) {
    const { U } = ctx, { o, root, rig, hand, burst } = S;
    const on = spec.on(t);
    root.visible = on; burst.group.visible = on;
    if (!on) return;
    const C = cues(spec);
    // card: spring in on "comment", float, press dip on the tap
    const k = U.spring(U.inv(C.pop - 0.05, C.pop + 0.75, t), 1.8, 5);
    const dT = t - C.tap, press = dT < 0 ? 0 : Math.exp(-dT * 5);
    rig.position.set(o.x, o.y + 3.2 + 0.2 * Math.sin(t * 1.4) - 0.15 * press, o.z - 0.15 * press);
    rig.rotation.set(-0.12 + 0.03 * Math.sin(t * 0.8) + (1 - k) * 0.9, 0.06 * Math.sin(t * 0.6) + (1 - k) * -0.5, (1 - k) * 0.2);
    rig.scale.setScalar(Math.max(0.001, 0.35 + 0.65 * k));
    const pq = Math.round(press * 20) / 20;                 // redraw the face only when the press glow changes
    if (pq !== S.drawn) { drawCard(S.ctx2d, ctx.reel.cta || {}, pq); S.tex.needsUpdate = true; S.drawn = pq; }
    // finger taps the keyword box
    rig.updateMatrixWorld(true);
    const keyPt = V(0, (0.5 - KEY.y / PXH) * CH, 0.02).applyMatrix4(rig.matrixWorld);
    const appr = 1 - U.easeOut(U.inv(C.tap - 0.45, C.tap, t)), leave = U.easeIn(U.inv(C.tap + 0.25, C.tap + 0.7, t));
    hand.group.visible = t > C.tap - 0.45 && t < C.tap + 0.75;
    hand.point({ pos: keyPt.clone().add(V(0, 0, 0.35)).add(V(6 * appr + 5 * leave, -4 * appr - 5 * leave, 2 * appr + 3 * leave)), tilt: 72, yaw: 25, curl: 0.1 });
    // burst of charge on the tap (world space)
    burst.hideAll();
    if (dT > 0 && dT < 1.2) {
      const w = keyPt.clone(), q = U.easeOut(U.clamp(dT / 1.0));
      S.dirs.forEach(([x, y, z, s], i) => burst.setP(i, w.x + x * 4 * q * s, w.y + y * 2.6 * q * s, w.z + z * 2 * q + 0.3, (1 - q) * 1.2));
    }
    if (t >= spec.t0 && t < spec.t1) {
      ctx.flash = dT > 0 ? 0.1 * Math.exp(-dT * 18) : 0;
      ctx.shake = dT > 0 ? 0.3 * Math.exp(-dT * 10) : 0;
      ctx.capHide = t > C.last + 0.25;                    // the card owns the frame after the last word
    }
  },

  camera(ctx, t, spec) {
    const U = ctx.U, o = spec.o, C = cues(spec);
    const tc = U.clamp(t, spec.t0 - 0.5, spec.t1 + 0.6);
    const at = (x, y, z) => [o[0] + x, o[1] + y, o[2] + z];
    const p = U.poseTrack([
      [spec.t0, U.pose(at(-8, 1, 44), at(0, 2.2, 0), 32, -4)],
      [C.pop + 0.6, U.pose(at(-2.5, 3.5, 39), at(0, 2.6, 0), 32)],
      [C.tap, U.pose(at(1.5, 3.4, 35), at(0, 2.7, 0), 31)],
      [spec.t1 + 0.6, U.pose(at(3, 4.4, 36), at(0, 2.7, 0), 31, 1.5)],
    ].sort((a, b) => a[0] - b[0]), tc);
    p.pos = [p.pos[0] + 0.1 * U.drift(tc * 1.2, 7), p.pos[1] + 0.1 * U.drift(tc * 1.2, 8), p.pos[2]];
    return p;
  },
};
