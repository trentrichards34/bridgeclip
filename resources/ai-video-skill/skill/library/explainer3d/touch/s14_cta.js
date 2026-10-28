/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s14_cta.js - CTA: glass follow card in 3D (70.02-75.6 s)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: "Follow me and send this to someone whose phone never works with wet hands."
 * Shows:
 *   A floating glass follow card pops in on "Follow"; a fingertip taps Follow on "me" (button crossfades to
 *   Following, ripple + charge burst), then taps send: a paper plane launches and the camera rides it down to a
 *   phone in a wet studio; drops fire phantom touches, the screen glitches, red X; end card with captions hidden, a
 *   second tap, slow float + sheen.
 * Techniques to steal:
 *   - UI card as real 3D: rounded-rect ShapeGeometry + canvas textures redrawn per state (Follow -> Following)
 *   - physical button press along the card normal, glow + ripple backdrop grid from every tap
 *   - paper plane launch with trail and a camera that rides it into the next set
 *   - end card: ctx.capHide hides captions; ctx.after for screen-space work. Headline strings are generic; change them per channel
 *
 * NOTE - written against the ORIGINAL per-reel core of the studio reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   './lib.js'            -> '/engine/kits/studio.js' (same names: makePhone, makeGrid, makeHand, makeFinger,
 *                            makePen, makeCharges, makeFieldLines, makeDrop, makeLabel, makeIcon, studioFloor,
 *                            makeTouchRing, fade, bezier, rng, toV3, mixHex, glassify, capGlare, libEnv, HAND_POSES).
 *   '../core/palette.js'  -> ctx.P (studio palette: charge, chargeHot, body, dip, no, ok, wireCol, ...).
 *   core/util.js          -> ctx.U (same functions: clamp, lerp, inv, smooth, spring, backOut, track, poseTrack, orbit, ...).
 *   Word cues already use ctx.wordAt(word, spec.t0) ?? fallbackSeconds; the packaged spec.cue(word, fallbackFraction)
 *   works too. Builds at spec.o (its own station, units cm). Per-frame grade overrides: ctx.bg, ctx.flash, ctx.shake,
 *   ctx.bloomK, ctx.exposure, ctx.capDy. ctx.fx = DOM overlay layer.
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// s14_cta (70.02-75.6) "Follow me and send this to someone whose phone never works with wet hands."
// A floating glass follow card (own design, Figtree font) pops in on "Follow"; a fingertip taps Follow on "me" (Following,
// ripple + charge burst), then taps the send button on "send": a paper plane launches and the camera rides it down to
// "someone": a phone lying in the rain-wet studio. "phone never works": a wet finger touches, the drops on the glass fire
// phantom touch rings, the screen glitches, a comic red X pops. "wet hands": drips fall off the knuckles and splash.
// 73.3-75.6 (captions hidden): the card owns the frame, the finger taps Follow once more, burst, slow float + sheen.
import * as THREE from 'three';
import { makePhone, makeHand, makeCharges, makeGrid, makeDrop, makeIcon, makeTouchRing, studioFloor, libEnv, bezier, rng } from './lib.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S = {};
const CW = 9.6, CH = 12.4, PXW = 1000, PXH = Math.round(PXW * CH / CW);   // card size (cm) and canvas size (px)
const BTN = { x: 405, y: 1072, w: 600, h: 150 }, SEND = { x: 838, y: 1072, r: 76 };
const CARD_TOP = 0.3;
const toLocal = (px, py) => V((px / PXW - 0.5) * CW, CARD_TOP, (py / PXH - 0.5) * CH);

function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function rrPlaneXZ(w, h, r) {
  const g = new THREE.ShapeGeometry(rrShape(w, h, r), 16), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  g.rotateX(-Math.PI / 2); return g;
}
function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}
function radialTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------- card artwork ----------
function drawCard(g, glow) {
  const W = PXW, H = PXH;
  g.clearRect(0, 0, W, H);
  g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 88); g.clip();
  const bg = g.createLinearGradient(0, 0, W * 0.3, H); bg.addColorStop(0, '#16203a'); bg.addColorStop(0.5, '#0e1424'); bg.addColorStop(1, '#090c14');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const halo = g.createRadialGradient(W / 2, 330, 0, W / 2, 330, 560); halo.addColorStop(0, 'rgba(60,130,255,0.32)'); halo.addColorStop(1, 'rgba(60,130,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, W, H);
  // sensor-grid motif: faint wires + orbs, a soft dip of charge around the avatar
  for (let y = 70; y < 560; y += 62) { g.strokeStyle = 'rgba(80,140,255,0.10)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  for (let x = 38; x < W; x += 62) { g.strokeStyle = 'rgba(160,195,255,0.07)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 560); g.stroke(); }
  for (let y = 70; y < 560; y += 62) for (let x = 38; x < W; x += 62) {
    const d = Math.hypot(x - W / 2, y - 330), fall = Math.min(1, y < 420 ? 1 : (560 - y) / 140);
    const a = (0.12 + 0.5 * Math.exp(-((d - 210) ** 2) / 9000)) * fall;
    g.fillStyle = `rgba(127,180,255,${a})`; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
  }
  g.restore();
  // avatar: our own touch glyph (a fingertip ring on a charge orb)
  const ax = W / 2, ay = 330, ar = 150;
  const ring = g.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar); ring.addColorStop(0, '#9cc6ff'); ring.addColorStop(0.5, '#2a7afc'); ring.addColorStop(1, '#ffb04a');
  g.fillStyle = '#0b1222'; g.beginPath(); g.arc(ax, ay, ar, 0, 7); g.fill();
  g.strokeStyle = ring; g.lineWidth = 12; g.beginPath(); g.arc(ax, ay, ar - 6, 0, 7); g.stroke();
  for (const [r, a] of [[92, 0.28], [64, 0.5]]) { g.strokeStyle = `rgba(127,180,255,${a + 0.2 * glow})`; g.lineWidth = 7; g.beginPath(); g.arc(ax, ay, r, 0, 7); g.stroke(); }
  const core = g.createRadialGradient(ax, ay, 0, ax, ay, 40); core.addColorStop(0, '#ffffff'); core.addColorStop(0.45, '#9cc6ff'); core.addColorStop(1, 'rgba(42,122,252,0)');
  g.fillStyle = core; g.beginPath(); g.arc(ax, ay, 40, 0, 7); g.fill();
  // headline
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '700 96px Figtree, Inter, sans-serif'; g.fillStyle = '#ffffff'; g.fillText('Follow for more', W / 2, 655);
  const tg = g.createLinearGradient(160, 0, 840, 0); tg.addColorStop(0, '#8fc0ff'); tg.addColorStop(1, '#4f95ff');
  g.fillStyle = tg; g.fillText('tech explainers', W / 2, 768);
  g.font = '500 42px Figtree, Inter, sans-serif'; g.fillStyle = '#8d96a8'; g.fillText('How everyday tech really works', W / 2, 862);
  // border (inner stroke)
  g.strokeStyle = 'rgba(150,190,255,0.30)'; g.lineWidth = 4; g.beginPath(); g.roundRect(3, 3, W - 6, H - 6, 86); g.stroke();
}
function drawFollow(g, k) {   // k 0 = "Follow", 1 = "Following"
  const W = BTN.w, H = BTN.h; g.clearRect(0, 0, W, H);
  const r = H / 2;
  if (k < 1) {
    g.globalAlpha = 1 - k;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#4a95ff'); gr.addColorStop(1, '#2468ec');
    g.fillStyle = gr; g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.roundRect(6, 6, W - 12, H * 0.45, r - 6); g.fill();
    g.fillStyle = '#fff'; g.font = '700 66px Figtree, Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    const tw = g.measureText('Follow').width, x0 = W / 2 - (tw + 64) / 2;
    g.lineWidth = 9; g.lineCap = 'round'; g.strokeStyle = '#fff';
    g.beginPath(); g.moveTo(x0 + 6, H / 2); g.lineTo(x0 + 42, H / 2); g.moveTo(x0 + 24, H / 2 - 18); g.lineTo(x0 + 24, H / 2 + 18); g.stroke();
    g.fillText('Follow', x0 + 64, H / 2 + 3);
  }
  if (k > 0) {
    g.globalAlpha = k;
    g.fillStyle = '#1b2231'; g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
    g.strokeStyle = 'rgba(160,190,240,0.45)'; g.lineWidth = 4; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, r - 2); g.stroke();
    g.fillStyle = '#dfe6f2'; g.font = '600 62px Figtree, Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    const tw = g.measureText('Following').width, x0 = W / 2 - (tw + 66) / 2;
    g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#34d27b';
    g.beginPath(); g.moveTo(x0 + 4, H / 2 + 2); g.lineTo(x0 + 18, H / 2 + 16); g.lineTo(x0 + 44, H / 2 - 14); g.stroke();
    g.fillText('Following', x0 + 66, H / 2 + 3);
  }
  g.globalAlpha = 1;
}
function drawSend(g, k) {
  const D = SEND.r * 2; g.clearRect(0, 0, D, D);
  g.fillStyle = k > 0 ? `rgb(${27 + 20 * k | 0},${34 + 60 * k | 0},${49 + 150 * k | 0})` : '#1b2231'; g.beginPath(); g.arc(D / 2, D / 2, D / 2 - 2, 0, 7); g.fill();
  g.strokeStyle = 'rgba(160,190,240,0.45)'; g.lineWidth = 4; g.beginPath(); g.arc(D / 2, D / 2, D / 2 - 3, 0, 7); g.stroke();
  // paper plane glyph
  g.save(); g.translate(D / 2 - 2, D / 2 + 2); g.rotate(-0.45);
  g.fillStyle = '#eef3fb'; g.beginPath(); g.moveTo(38, 0); g.lineTo(-32, -28); g.lineTo(-18, 0); g.lineTo(-32, 28); g.closePath(); g.fill();
  g.fillStyle = 'rgba(27,34,49,0.9)'; g.beginPath(); g.moveTo(38, 0); g.lineTo(-18, 0); g.lineTo(-10, 4); g.closePath(); g.fill();
  g.restore();
}
function paperPlaneGeo() {
  // nose at +Z
  const v = [0, 0, 1.2, -0.75, 0.05, -0.6, 0, 0, -0.35, 0.75, 0.05, -0.6, 0, -0.28, -0.5];
  const idx = [0, 1, 2, 0, 2, 3, 0, 4, 2];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export default {
  async init(ctx, spec) {
    const { P } = ctx;
    const o = V(...spec.o);
    const root = new THREE.Group(); root.position.copy(o); ctx.scene.add(root); S.root = root;
    const env = libEnv(ctx);
    const tex = radialTex();
    // ---- card rig: card lies in its local XZ (face +Y), rig rotated to face +Z ----
    const rig = new THREE.Group(); root.add(rig); S.rig = rig;
    const slab = new THREE.ExtrudeGeometry(rrShape(CW, CH, 0.95), { depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 20 });
    slab.rotateX(-Math.PI / 2); slab.translate(0, 0.06, 0);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#0b0f18', metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1.2 });
    const body = new THREE.Mesh(slab, bodyMat); body.castShadow = true; rig.add(body);
    const face = canvasTex(PXW, PXH); S.face = face;
    const faceMat = new THREE.MeshBasicMaterial({ map: face.t, transparent: true, toneMapped: false, color: new THREE.Color(0.75, 0.75, 0.75) });
    const faceM = new THREE.Mesh(rrPlaneXZ(CW - 0.02, CH - 0.02, 0.92), faceMat); faceM.position.y = CARD_TOP + 0.003; rig.add(faceM);
    // sheen sweep (subtle moving glint across the face)
    const sh = canvasTex(256, 256); { const g = sh.g, gr = g.createLinearGradient(0, 256, 256, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.38, 'rgba(255,255,255,0)'); gr.addColorStop(0.47, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.62, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); sh.t.needsUpdate = true; }
    sh.t.wrapS = THREE.RepeatWrapping; sh.t.colorSpace = THREE.NoColorSpace;
    const sheenMat = new THREE.MeshBasicMaterial({ map: sh.t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.1 });
    const sheen = new THREE.Mesh(rrPlaneXZ(CW - 0.05, CH - 0.05, 0.9), sheenMat); sheen.position.y = CARD_TOP + 0.03; sheen.renderOrder = 5; rig.add(sheen);
    S.sheen = sheen;
    // buttons (own canvases, physically press)
    const fb = canvasTex(BTN.w, BTN.h); S.fb = fb;
    const fbM = new THREE.Mesh(rrPlaneXZ(BTN.w / PXW * CW, BTN.h / PXW * CW, BTN.h / 2 / PXW * CW), new THREE.MeshBasicMaterial({ map: fb.t, transparent: true, toneMapped: false, color: new THREE.Color(0.92, 0.92, 0.92) }));
    const fbP = toLocal(BTN.x, BTN.y); fbM.position.set(fbP.x, CARD_TOP + 0.02, fbP.z); rig.add(fbM); S.fbM = fbM;
    const sb = canvasTex(SEND.r * 2, SEND.r * 2); S.sb = sb;
    const sbM = new THREE.Mesh(rrPlaneXZ(SEND.r * 2 / PXW * CW, SEND.r * 2 / PXW * CW, SEND.r / PXW * CW - 0.001), new THREE.MeshBasicMaterial({ map: sb.t, transparent: true, toneMapped: false, color: new THREE.Color(0.92, 0.92, 0.92) }));
    const sbP = toLocal(SEND.x, SEND.y); sbM.position.set(sbP.x, CARD_TOP + 0.02, sbP.z); rig.add(sbM); S.sbM = sbM;
    // button glow + ripple
    const bGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(P.chargeHot).multiplyScalar(1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    bGlow.position.set(fbP.x, CARD_TOP + 0.04, fbP.z); bGlow.renderOrder = 6; rig.add(bGlow); S.bGlow = bGlow;
    const ripple = makeTouchRing(ctx, { color: P.chargeHot, rmax: 2.6 }); ripple.mesh.position.set(fbP.x, CARD_TOP + 0.05, fbP.z); rig.add(ripple.mesh); S.ripple = ripple;
    const ripple2 = makeTouchRing(ctx, { color: P.chargeHot, rmax: 1.4 }); ripple2.mesh.position.set(sbP.x, CARD_TOP + 0.05, sbP.z); rig.add(ripple2.mesh); S.ripple2 = ripple2;
    // halo behind the card
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#2a64d8'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55 }));
    halo.scale.set(30, 1, 34); halo.position.y = -1.2; rig.add(halo); S.halo = halo;
    // the tapping hand lives in the rig (taps along the card normal)
    const hand = makeHand(ctx); rig.add(hand.group); S.hand = hand;
    // backdrop: a big faint sensor grid behind the card, rippling from each tap
    const bgRig = new THREE.Group(); bgRig.rotation.x = Math.PI / 2; bgRig.position.set(0, 0, -9); root.add(bgRig); S.bgRig = bgRig;
    const bgGrid = makeGrid(ctx, { cols: 15, rows: 25, w: 42, h: 70, orb: 0.26, wire: 0.07, sheet: false, dipTint: false }); bgRig.add(bgGrid.group); S.bgGrid = bgGrid;
    // ambient charge motes around the card + tap burst
    const motes = makeCharges(ctx, 150, { color: P.charge, size: 0.1, glow: 2.2 }); ctx.scene.add(motes.group); S.motes = motes;
    const R = rng(1414); S.seeds = Array.from({ length: 160 }, () => [R(), R(), R(), R(), R()]);
    // paper plane + trail
    const plane = new THREE.Mesh(paperPlaneGeo(), new THREE.MeshStandardMaterial({ color: '#f4f7fc', emissive: '#9cc6ff', emissiveIntensity: 0.3, roughness: 0.4, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.6 }));
    plane.castShadow = true; plane.scale.setScalar(1.1); root.add(plane); S.plane = plane;
    // ---- wet-hands set: a phone lying flat below the card ----
    const P0 = V(-4, -21, 5); S.P0 = P0;
    const ph = new THREE.Group(); ph.position.copy(P0); root.add(ph); S.ph = ph;
    const phone = makePhone(ctx, { look: 'home' }); phone.group.rotation.y = 0.12; ph.add(phone.group); S.phone = phone;
    const floor = studioFloor(ctx, { r: 55 }); floor.group.position.set(0, -0.57, 0); ph.add(floor.group);
    const wet = makeHand(ctx); ph.add(wet.group); S.wet = wet;
    const sk = wet.mats.skin; sk.clearcoat = 1; sk.clearcoatRoughness = 0.04; sk.roughness = 0.32; sk.needsUpdate = true;
    // drops sitting on the glass (they are what fires the phantom touches)
    S.spots = [[0.24, 0.24, 0.55], [0.74, 0.36, 0.45], [0.33, 0.66, 0.6], [0.78, 0.8, 0.5], [0.55, 0.15, 0.35], [0.15, 0.48, 0.4]];
    S.sitDrops = S.spots.map(() => { const d = makeDrop(ctx); ph.add(d.group); return d; });
    S.drips = [0, 1, 2].map(() => { const d = makeDrop(ctx); ph.add(d.group); return d; });
    S.hang = [0, 1].map(() => { const d = makeDrop(ctx); ph.add(d.group); return d; });
    const x = makeIcon(ctx, 'x'); ph.add(x.group); S.x = x;
  },

  update(ctx, t, spec) {
    const { U, P } = ctx;
    const on = t > spec.t0 - 0.7 && t < spec.t1 + 0.7;
    S.root.visible = on;
    if (!on) { S.motes.alpha(0); return; }
    const W = (w, n = 0) => ctx.wordAt(w, spec.t0, n) ?? spec.t0;
    const T = S.T = {
      follow: W('follow'), me: W('me'), send: W('send'), someone: W('someone'), phone: W('phone'), never: W('never'),
      works: W('works'), wet: W('wet'), hands: W('hands'),
    };
    T.tap1 = T.me - 0.02; T.tap2 = T.send + 0.08; T.fly0 = T.tap2 + 0.06; T.fly1 = T.someone + 0.32;
    T.end = 73.3; T.tap3 = 74.0;
    const { rig, hand } = S;

    // ---- card pop + float ----
    const pop = U.spring(U.inv(T.follow - 0.12, T.follow + 0.75, t), 2.4, 5.0);
    const endIn = U.inv(T.end - 0.3, T.end + 0.35, t);
    const fl = Math.sin(t * 1.3) * 0.12;
    rig.position.set(0, fl, 0);
    rig.rotation.set(Math.PI / 2 - 0.08 + 0.35 * (1 - pop) + 0.03 * Math.sin(t * 0.9), 0.04 * Math.sin(t * 0.7) - 0.25 * (1 - pop), 0.05 * (1 - pop));
    rig.scale.setScalar(Math.max(1e-3, pop));
    rig.visible = pop > 0.001;
    // which taps have happened (the card resets offscreen for the end card)
    const fk1 = U.smooth(U.inv(T.tap1 + 0.02, T.tap1 + 0.16, t)) * (t < T.end - 0.25 ? 1 : 0);
    const fk3 = U.smooth(U.inv(T.tap3 + 0.02, T.tap3 + 0.16, t));
    const fk = Math.max(fk1, fk3);
    const press = (tt) => Math.exp(-Math.pow((t - tt - 0.03) / 0.07, 2));
    const pF = Math.max(press(T.tap1), press(T.tap3)), pS = press(T.tap2);
    const glowA = Math.exp(-Math.max(0, t - T.tap1) * 3) * (t > T.tap1 ? 1 : 0) + Math.exp(-Math.max(0, t - T.tap3) * 2.5) * (t > T.tap3 ? 1 : 0);
    const faceKey = 'c' + Math.round(glowA * 8);
    if (S.faceKey !== faceKey) { S.faceKey = faceKey; drawCard(S.face.g, U.clamp(glowA)); S.face.t.needsUpdate = true; }
    const fbKey = 'f' + Math.round(fk * 20);
    if (S.fbKey !== fbKey) { S.fbKey = fbKey; drawFollow(S.fb.g, fk); S.fb.t.needsUpdate = true; }
    const sbKey = 's' + Math.round(pS * 10);
    if (S.sbKey !== sbKey) { S.sbKey = sbKey; drawSend(S.sb.g, pS); S.sb.t.needsUpdate = true; }
    S.fbM.position.y = CARD_TOP + 0.02 - 0.12 * pF; S.fbM.scale.setScalar(1 - 0.06 * pF + 0.04 * Math.sin(Math.PI * U.inv(T.tap1, T.tap1 + 0.4, t)) * (t > T.tap1 + 0.4 ? 0 : 1));
    S.sbM.position.y = CARD_TOP + 0.02 - 0.12 * pS; S.sbM.scale.setScalar(1 - 0.08 * pS);
    // button idle pulse before the tap (invites the tap), glow after
    const invite = (t < T.tap1 ? 0.35 + 0.25 * Math.sin(t * 9) : 0) + (t > T.end && t < T.tap3 ? 0.35 + 0.3 * Math.sin((t - T.end) * 9) : 0);
    const bg = U.clamp(invite + 1.6 * glowA);
    S.bGlow.scale.set(7.5 + 2 * glowA, 1, 3.4 + 1.5 * glowA); S.bGlow.material.opacity = bg * 0.55; S.bGlow.visible = bg > 0.01;
    const rk1 = U.inv(T.tap1, T.tap1 + 0.7, t), rk3 = U.inv(T.tap3, T.tap3 + 0.9, t);
    S.ripple.set(rk3 > 0 ? rk3 : rk1, { size: 1, alpha: 1 });
    S.ripple2.set(U.inv(T.tap2, T.tap2 + 0.6, t), { size: 1 });
    S.sheen.material.map.offset.x = -0.6 + ((t - T.follow) * 0.28) % 1.6; S.sheen.material.opacity = 0.035 + 0.025 * U.inv(T.end, T.end + 0.5, t);
    S.halo.material.opacity = 0.4 + 0.25 * glowA;

    // ---- the tapping finger (rig-local: +Y = toward the camera) ----
    const fbP = toLocal(BTN.x, BTN.y), sbP = toLocal(SEND.x, SEND.y);
    const offscreen = V(CW * 0.9, 0, CH * 0.95), exitR = V(CW * 1.1, 0, CH * 1.4);
    let hp = null, lift = 0, hA = 0;
    if (t < T.end - 0.3) {
      if (t < T.tap1 + 0.12) {
        const k = U.smooth(U.inv(T.follow, T.tap1 - 0.12, t));
        hp = offscreen.clone().lerp(fbP, U.easeOut(k)); lift = U.lerp(4.5, 0, U.easeOut(U.inv(T.tap1 - 0.3, T.tap1, t))) * (t < T.tap1 ? 1 : 0);
      } else if (t < T.tap2 + 0.1) {
        const k = U.smoother(U.inv(T.tap1 + 0.12, T.tap2 - 0.06, t));
        hp = fbP.clone().lerp(sbP, k); lift = Math.sin(Math.PI * k) * 1.8 + (t > T.tap2 ? 0 : 0);
      } else {
        const k = U.easeIn(U.inv(T.tap2 + 0.06, T.tap2 + 0.2, t));
        hp = sbP.clone().lerp(exitR, k); lift = 1.0 * k;
      }
      hA = 1;
    } else {
      // end card: enters, taps, leaves
      const kin = U.smooth(U.inv(T.end - 0.1, T.tap3 - 0.12, t)), kout = U.easeIn(U.inv(T.tap3 + 0.35, T.tap3 + 1.1, t));
      hp = offscreen.clone().lerp(fbP, U.easeOut(kin)).lerp(offscreen, kout);
      lift = U.lerp(4, 0, U.easeOut(U.inv(T.tap3 - 0.35, T.tap3, t))) * (t < T.tap3 ? 1 : 0) + 0.5 * kout + 1.4 * U.smooth(U.inv(T.tap3 + 0.05, T.tap3 + 0.35, t)) * (1 - kout);
      hA = kout < 1 ? 1 : 0;
    }
    if (t > T.tap2 + 0.2 && t < T.end - 0.3) hA = 0;
    hand.group.visible = hA > 0 && pop > 0.01;
    if (hand.group.visible) hand.point({ pos: V(hp.x, CARD_TOP + lift, hp.z), tilt: 32, yaw: 28, curl: 0.05 });

    // ---- backdrop grid: faint, rippling outward from every tap ----
    const g = S.bgGrid;
    g.reset(); g.alpha(0.42 * U.clamp(pop)).wires(0.55);
    const waves = [T.tap1, T.tap2, T.tap3].map((tt) => t - tt).filter((d) => d > 0 && d < 1.6);
    g.pulse((i, j, x, z) => {
      let v = 0.25 * Math.max(0, Math.sin(t * 2.2 - x * 0.18 - z * 0.12));
      for (const d of waves) { const r = Math.hypot(x, z); v += Math.exp(-((r - d * 32) ** 2) / 18) * (1 - d / 1.6) * 1.5; }
      return Math.min(1.5, v);
    });

    // ---- charge motes + tap bursts (world) ----
    const m = S.motes; m.hideAll(); m.alpha(U.clamp(pop));
    const rw = (v) => v.clone().applyMatrix4(rig.matrixWorld);
    rig.updateWorldMatrix(true, true);
    for (let i = 0; i < 70; i++) {
      const s = S.seeds[i], a = s[0] * Math.PI * 2 + t * (0.15 + 0.1 * s[1]), rr = 7 + s[2] * 9;
      const p = V(Math.cos(a) * rr * 0.75, (s[3] - 0.5) * 2 - 1.5, Math.sin(a) * rr * 0.95 + Math.sin(t * 0.8 + s[4] * 6) * 0.5);
      const w = rw(p); m.setP(i, w.x, w.y, w.z, 0.5 + 0.7 * s[4]);
    }
    const burst = (tt, base, n0, n, spd) => {
      const d = t - tt; if (d <= 0 || d > 1.1) return;
      for (let i = 0; i < n; i++) {
        const s = S.seeds[(n0 + i) % 160], a = s[0] * Math.PI * 2, v = (0.6 + s[1]) * spd, k = U.expoOut(Math.min(1, d / 1.1));
        const p = V(base.x + Math.cos(a) * v * k * 1.6, base.y + 0.3 + s[2] * 2.5 * k, base.z + Math.sin(a) * v * k);
        const w = rw(p); m.setP(70 + ((n0 + i) % 50), w.x, w.y, w.z, (1 - d / 1.1) * (0.8 + s[3]));
      }
    };
    burst(T.tap1, fbP, 0, 22, 4); burst(T.tap3, fbP, 22, 28, 5); burst(T.tap2, sbP, 0, 10, 2);

    // ---- paper plane: launches from the send button, flies down to the phone ----
    const S0 = rw(sbP.clone().add(V(0, 0.9, 0))), ph = S.phone;
    S.ph.updateWorldMatrix(true, true);
    const E = ph.screenPoint(0.5, 0.42, V(), 0.6);
    const C = S0.clone().add(V(-11, 2.5, 10));
    const fk_ = U.inv(T.fly0, T.fly1, t);
    S.plane.visible = fk_ > 0 && fk_ < 1;
    if (S.plane.visible) {
      const k = U.easeInOut(fk_), p = bezier(S0, C, E, k), p2 = bezier(S0, C, E, Math.min(1, k + 0.02));
      S.plane.position.copy(S.root.worldToLocal(p.clone()));
      S.plane.lookAt(p2.clone().add(p2.clone().sub(p).multiplyScalar(0.0)));
      S.plane.rotateZ(Math.sin(fk_ * Math.PI * 2) * 0.5);
      S.plane.scale.setScalar(1.7 * (1 - 0.6 * U.inv(0.8, 1, fk_)));
      for (let i = 0; i < 26; i++) {
        const kk = k - i * 0.012; if (kk <= 0) continue;
        const q = bezier(S0, C, E, kk), s = S.seeds[100 + i];
        m.setP(120 + i, q.x + (s[1] - 0.5) * 0.25, q.y + (s[2] - 0.5) * 0.25, q.z, (1 - i / 26) * 0.9);
      }
    }
    S.planeEnd = E; S.planeW = S.plane.visible ? S.root.localToWorld(S.plane.position.clone()) : null; S.flyK = fk_;

    // ---- wet-hands set ----
    const wetOn = t > T.someone - 0.6 && t < T.end + 0.2;
    S.ph.visible = wetOn;
    if (wetOn) this.wet(ctx, t, T);

    // ---- look ----
    if (t >= spec.t0 && t < spec.t1 + 1) {
      const atPhone = U.smooth(U.inv(T.someone - 0.2, T.someone + 0.2, t)) * (1 - U.smooth(U.inv(T.hands + 0.35, T.end, t)));
      ctx.bg = atPhone > 0.5 ? { top: '#0a0f17', mid: '#0d141e', bottom: '#05070a' } : { top: '#0a0e18', mid: '#0d1322', bottom: '#05060a' };
      ctx.bloomK = 0.8 + 0.4 * glowA;
      ctx.flash = 0.1 * press(T.tap3);
      ctx.shake = 0.18 * Math.max(press(T.tap1), press(T.tap3)) + 0.35 * Math.exp(-Math.pow((t - T.hands - 0.08) / 0.1, 2)) + 0.2 * Math.exp(-Math.pow((t - T.never - 0.12) / 0.1, 2));
      if (t >= T.end) ctx.capHide = true;
    }
  },

  wet(ctx, t, T) {
    const { U, P } = ctx;
    const { phone, wet } = S;
    // finger comes in from the back right, touches on "phone"
    const tc = T.phone;
    const touch = phone.screenPoint(0.5, 0.42);
    const lp = (w) => S.ph.worldToLocal(w.clone());
    const hov = U.track([[T.someone + 0.05, 9], [tc - 0.05, 0], [T.wet - 0.1, 0], [T.wet + 0.25, 0.5], [T.hands, 0], [T.end, 2]], t, U.easeInOut);
    const press = Math.exp(-Math.pow((t - tc) / 0.12, 2));
    wet.group.visible = t > T.someone + 0.05;
    wet.point({ pos: lp(touch).add(V(0, hov - 0.05 * press, 0)), tilt: 40, yaw: 128, curl: 0.0 });
    // screen: home, goes haywire: phantom touches at the drops + glitch bands
    const crazy = U.smooth(U.inv(tc, tc + 0.25, t));
    const ghosts = [];
    S.spots.forEach(([u, v], i) => {
      const ph = (t - tc) * 3.2 + i * 0.37, a = crazy * (0.5 + 0.5 * Math.sin(ph * Math.PI * 2));
      if (a > 0.08) ghosts.push([u, v, Math.round(a * 4) / 4]);
    });
    const glitch = Math.round(crazy * (0.25 + 0.5 * Math.exp(-Math.pow((t - T.never - 0.1) / 0.15, 2)) + 0.6 * Math.exp(-Math.pow((t - T.hands - 0.1) / 0.18, 2))) * 6) / 6;
    const open = crazy > 0 ? [5, 14, 2, 19, 9][Math.floor((t - tc) * 5) % 5] : -1;
    phone.look('home', { ghosts, glitch, seed: Math.floor(t * 8) % 9 + 1, open });
    phone.screen.brightness(1);
    // touch rings: phantom rings popping at the drops (slots 0..2), the real finger's ring (slot 3) flickers red
    for (let s = 0; s < 3; s++) {
      const per = 0.55, ph = (t - tc - s * 0.17) / per, k = ph - Math.floor(ph), idx = (Math.floor(ph) * 2 + s) % S.spots.length;
      if (crazy > 0 && ph > 0) phone.touchAt(S.spots[idx][0], S.spots[idx][1], k, s, { color: P.chargeHot, size: 1.1 });
      else phone.touchAt(0, 0, 0, s);
    }
    phone.touchAt(0.5, 0.42, U.inv(tc, tc + 0.6, t), 3, { color: P.no, size: 0.9 });
    // drops on the glass
    S.sitDrops.forEach((d, i) => { const [u, v, r] = S.spots[i]; d.set({ pos: lp(phone.screenPoint(u, v)), mode: 'sit', radius: r * (1 + 0.05 * Math.sin(t * 3 + i)), alpha: 1 }); });
    // drops hanging under the finger, drip off on "wet"
    wet.group.updateWorldMatrix(true, true);
    const anchors = [wet.fingerPoint(0.86).add(V(0, -0.85, 0)), wet.fingerPoint(0.62).add(V(0.0, -1.0, 0))];
    const drops = [[T.wet + 0.02, 0, 0.32], [T.wet + 0.16, 1, 0.26], [T.hands + 0.02, 0, 0.3]];
    S.hang.forEach((d, i) => {
      const done = drops.filter(([tt, a]) => a === i && t > tt).map(([tt]) => tt), tl = done.length ? done[done.length - 1] : null;
      const grow = U.clamp((t - T.someone + 0.5) / 0.8);
      const r = (tl == null ? 0.26 : U.lerp(0.08, 0.24, U.clamp((t - tl) / 0.6))) * grow;
      d.set({ pos: lp(anchors[i]), mode: 'fall', radius: r, alpha: grow > 0 ? 1 : 0 });
    });
    S.drips.forEach((d, i) => {
      const [tt, a, r] = drops[i], dt = t - tt;
      if (dt < 0) { d.set({ alpha: 0 }); d.splash(0); return; }
      const from = anchors[a], land = V(from.x, phone.screenPoint(0.5, 0.5).y, from.z);
      const fallT = Math.sqrt(2 * Math.max(0.1, from.y - land.y) / 980);
      if (dt < fallT) { const y = from.y - 0.5 * 980 * dt * dt; d.set({ pos: lp(V(from.x, y, from.z)), mode: 'fall', radius: r, alpha: 1 }); d.splash(0); }
      else { const k = U.clamp((dt - fallT) / 0.5); d.set({ pos: lp(land), mode: 'sit', radius: r * 1.2, squash: 0.6 * (1 - k), alpha: 1 }); d.splash(k, { ringR: 1.6 }); }
    });
    // comic red X on "never works", re-bounces on "hands"
    const x = S.x;
    const xk = U.inv(T.never + 0.02, T.never + 0.5, t), xb = Math.exp(-Math.pow((t - T.hands - 0.1) / 0.1, 2));
    // the X is placed in camera space (always framed: left of the finger, mid height), popped + wobbling
    const wob = 0.25 * Math.sin((t - T.never) * 14) * Math.exp(-Math.max(0, t - T.never) * 3) + 0.3 * xb;
    x.pop(xk);
    const xs = x.group.scale.x;
    ctx.after.push((c) => {
      const cam = c.camera, D = 12, hh = D * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), hw = hh * cam.aspect;
      const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion), rt = V(1, 0, 0).applyQuaternion(cam.quaternion), up = V(0, 1, 0).applyQuaternion(cam.quaternion);
      const wp = cam.position.clone().addScaledVector(fwd, D).addScaledVector(rt, -0.55 * hw).addScaledVector(up, 0.02 * hh);
      x.group.position.copy(S.ph.worldToLocal(wp));
      x.group.scale.setScalar(Math.max(1e-4, xs * 0.26 * (1 + 0.3 * xb)));
      x.group.lookAt(cam.position); x.group.rotateZ(wob);
    });
    x.glow(1 + xb);
  },

  camera(ctx, t, spec) {
    const { U } = ctx;
    const W = (w, n = 0) => ctx.wordAt(w, spec.t0, n) ?? spec.t0;
    const o = V(...spec.o);
    const tt = U.clamp(t, spec.t0 - 0.6, 75.5);
    const follow = W('follow'), me = W('me'), send = W('send'), someone = W('someone'), never = W('never'), wetW = W('wet'), hands = W('hands');
    const P0 = o.clone().add(S.P0 || V(-4, -21, 5));
    const C = (p, g, fov = 32, roll = 0) => ({ pos: [o.x + p[0], o.y + p[1], o.z + p[2]], target: [o.x + g[0], o.y + g[1], o.z + g[2]], fov, roll });
    const Ph = (p, g, fov = 32, roll = 0) => ({ pos: [P0.x + p[0], P0.y + p[1], P0.z + p[2]], target: [P0.x + g[0], P0.y + g[1], P0.z + g[2]], fov, roll });
    const end = 73.3;
    const tap2 = send + 0.08, fly0 = tap2 + 0.06, fly1 = someone + 0.32;
    let keys;
    if (tt < fly1) {
      keys = [
        [spec.t0 - 0.6, C([-6, -3, 38], [0, 1.6, 0], 32, -4)],
        [me, C([-3.2, -2.0, 34], [0, 1.4, 0], 32, -1)],
        [tap2, C([-1.2, -1.6, 32.5], [0.5, 1.0, 0], 32, 1.5)],
        [fly0 + 0.32, C([-13, -5, 30], [-8, -6, 9], 33, -7)],             // riding the paper plane down
        [fly1, Ph([-12, 15, 20], [0.0, 1.4, -0.3], 32, -3)],
      ];
    } else if (tt < end - 0.3) {
      keys = [
        [fly1, Ph([-12, 15, 20], [0.0, 1.4, -0.3], 32, -3)],
        [never, Ph([-9.5, 11.5, 15.5], [0.3, 1.5, -0.4], 32, -2)],
        [wetW, Ph([-6.5, 6.0, 14], [0.6, 1.8, 0], 33, 1)],            // swing low on "wet"
        [hands + 0.2, Ph([-5.6, 5.4, 12.5], [0.6, 1.8, 0], 32, 2)],
        [end - 0.3, Ph([-5.2, 5.6, 12], [0.6, 1.8, 0], 32, 2)],
      ];
    } else {
      keys = [
        [end - 0.3, Ph([-5.2, 5.6, 12], [0.6, 1.8, 0], 32, 2)],
        [end + 0.25, C([0.8, 0.2, 34], [0, 0.0, 0], 32, 0)],       // whip back up: the card owns the frame
        [75.5, C([-0.6, 0.0, 30.5], [0, 0.1, 0], 32, 0)],
      ];
    }
    const pz = U.poseTrack(keys, tt, U.smoother);
    if (S.planeW && S.flyK > 0 && S.flyK < 1 && Math.abs(ctx.t - tt) < 1e-6) {   // keep the plane in frame
      const w = Math.sin(Math.PI * S.flyK) * 0.75;
      pz.target = pz.target.map((v, i) => U.lerp(v, S.planeW.getComponent(i), w));
    }
    return pz;
  },
};
