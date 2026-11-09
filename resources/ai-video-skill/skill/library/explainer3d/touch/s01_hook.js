/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s01_hook.js - Hook beat (0.00-5.16 s)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: "Your phone screen reacts to the lightest brush of your finger and ignores a pen pressed as hard as you can."
 * Shows:
 *   Dark phone spins into a low hero 3/4 with a light sweep; a bare fingertip brushes the glass (screen wakes,
 *   glowing charge trail, ripples, "0 g"); hard camera snap; a pen slams down (flex, shake, force arrows, "2.0 kg"
 *   count-up), the screen stays dead, red X.
 * Techniques to steal:
 *   - spring spin-in + frame-1 exposure punch (ctx.exposure 1.7 -> 1)
 *   - damped impact flex: a*exp(-d*7)*cos(d*32) drives phone squash + ctx.shake/ctx.flash
 *   - glowing particle trail laid along PAST path samples (age-based fade), touch ripples reusing slots
 *   - additive ShaderMaterial light sweep across the glass; anticipation-then-slam track for the pen
 *   - camera: orbit keys before the cut, expoOut snap to a new side angle on the word "ignores"
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
// s01_hook (0.00-5.16): "Your phone screen reacts to the lightest brush of your finger and ignores a pen pressed as hard as you can."
// A dark phone spins into a low 3/4 hero angle with a light sweep and a ghost of its sensor grid (hook in the first 0.5 s).
// "brush": a bare fingertip glides over the glass, the screen wakes, a blue charge trail + ripples follow it, "0 g" readout.
// "ignores": hard camera snap. "pen pressed": anticipation, slam, shake, the phone flexes, force arrows, "2 kg" count-up,
// the screen stays dead, red X on "can".
import { makePhone, makeHand, makePen, makeCharges, makeIcon, makeLabel, studioFloor, toV3 } from './lib.js';

let S = null;

const STROKE = { u0: 0.27, v0: 0.66, u1: 0.66, v1: 0.36 };   // finger glide across the screen

export default {
  async init(ctx, spec) {
    const { THREE, P } = ctx, U = ctx.U;
    const o = toV3(spec.o);
    const root = new THREE.Group(); root.name = 's01'; ctx.scene.add(root);
    const phone = makePhone(ctx, { look: 'off' }); phone.group.position.copy(o); root.add(phone.group);
    const floor = studioFloor(ctx, { r: 80, shadow: 0.5 }); floor.group.position.copy(o).add(new THREE.Vector3(0, -5.5, 0)); root.add(floor.group);
    const hand = makeHand(ctx); root.add(hand.group);
    const pen = makePen(ctx); root.add(pen.group);
    const trail = makeCharges(ctx, 90, { color: P.chargeHot, size: 0.075, glow: 2.6 }); ctx.scene.add(trail.group);
    const tipGlow = makeCharges(ctx, 2, { color: P.chargeHot, size: 0.16, glow: 3 }); ctx.scene.add(tipGlow.group);
    const xIcon = makeIcon(ctx, 'x'); root.add(xIcon.group);
    const lab0 = makeLabel(ctx, '0 g', { sub: 'of force', dx: 150, dy: 250, size: 64 });
    const lab2 = makeLabel(ctx, '0.0 kg', { sub: 'of force', dx: 190, dy: 210, size: 64 });

    // light sweep across the dark glass (additive band, lives in the glass layer)
    const sweepMat = new THREE.ShaderMaterial({
      uniforms: { uPos: { value: -1 }, uA: { value: 0 }, uC: { value: new THREE.Color('#cfe0ff') } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uPos, uA; uniform vec3 uC; varying vec2 vUv;
        void main(){ float s = vUv.x * 0.55 + vUv.y; float d = s - uPos;
          float band = exp(-pow(d / 0.05, 2.0)) * 0.9 + exp(-pow((d + 0.16) / 0.018, 2.0)) * 0.5 + exp(-pow(d / 0.22, 2.0)) * 0.12;
          vec2 e = min(vUv, 1.0 - vUv); float edge = smoothstep(0.0, 0.03, min(e.x, e.y * 2.17));
          gl_FragColor = vec4(uC * band * uA * edge, 1.0); }`,
    });
    const sweep = new THREE.Mesh(new THREE.PlaneGeometry(phone.size.screenW + 0.25, phone.size.screenH + 0.25), sweepMat);
    sweep.rotation.x = -Math.PI / 2; sweep.position.y = phone.size.glassTop + 0.003; sweep.renderOrder = 6; phone.glass.add(sweep);

    // force arrows: three chunky arrows around the pen pointing down at the tip
    const arrows = new THREE.Group(); root.add(arrows);
    const arrowMat = new THREE.MeshStandardMaterial({ color: '#ff6b5e', emissive: new THREE.Color(P.no), emissiveIntensity: 0.22, roughness: 0.3, metalness: 0.1 });
    const shaft = new THREE.CylinderGeometry(0.16, 0.16, 1.5, 16); shaft.translate(0, 1.55, 0);
    const head = new THREE.ConeGeometry(0.42, 0.8, 24); head.rotateX(Math.PI); head.translate(0, 0.4, 0);
    const arrowList = [0, 1, 2].map((i) => {
      const a = new THREE.Group();
      a.add(new THREE.Mesh(shaft, arrowMat), new THREE.Mesh(head, arrowMat));
      arrows.add(a); return a;
    });

    const R = U.rng(11);
    const jit = Array.from({ length: 90 }, () => [R() - 0.5, R() - 0.5, R()]);
    S = { root, phone, floor, hand, pen, trail, tipGlow, xIcon, lab0, lab2, sweep, sweepMat, arrows, arrowList, arrowMat, jit, o };
  },

  update(ctx, t, spec) {
    const { THREE, P, U } = ctx;
    const { root, phone, hand, pen, trail, tipGlow, xIcon, lab0, lab2, sweepMat, arrows, arrowList, jit, o } = S;
    const on = t >= spec.t0 - 0.6 && t <= spec.t1 + 0.6;
    root.visible = on; trail.group.visible = on; tipGlow.group.visible = on;
    if (!on) { lab0.hide(); lab2.hide(); trail.alpha(0); tipGlow.alpha(0); return; }
    trail.alpha(1); tipGlow.alpha(1);
    const W = times(ctx, spec);
    const cur = t >= spec.t0 && t < spec.t1;

    // ---------- phone: spin-in, float, impact flex ----------
    const kin = U.clamp(t / 0.75);
    const spin = 1 - U.spring(kin, 1.6, 4.2);  // 1 -> 0 with a little overshoot
    const dImp = t - W.slam, dImp2 = t - W.hard;
    const imp = (d, a) => (d < 0 ? 0 : a * Math.exp(-d * 7) * Math.cos(d * 32));
    const flex = imp(dImp, 1) + imp(dImp2, 0.7);
    phone.group.position.set(o.x, o.y + 0.25 * Math.sin(t * 1.3) * (t < W.ign ? 1 : 0.3) - 0.35 * flex, o.z);
    phone.group.rotation.set(0.05 * Math.sin(t * 0.9) * (t < 1.7 ? 1 : 0.2) + 0.02 * flex, -0.25 * spin, 0.14 * spin - 0.025 * flex);
    phone.group.scale.set(1 + 0.03 * flex, 1 - 0.16 * flex, 1 + 0.03 * flex);
    phone.explode(0, { grid: false });

    // grid ghost: a blue scan rolls through the hidden sensor on "screen" (teases the mechanism), then hides
    const g = phone.grid; g.reset();
    const gk = U.inv(-0.25, W.screen + 0.5, t);
    const gA = Math.sin(Math.PI * gk) * 0.6;
    g.alpha(gA); g.scan(gA > 0 ? gk : -1, { axis: 'row', width: 2.5 });
    phone.layers.sensor.visible = gA > 0.01;

    // light sweep on the dark glass at the very start
    const sk = U.inv(-0.25, 0.8, t);
    sweepMat.uniforms.uPos.value = U.lerp(-0.4, 1.8, U.easeInOut(sk));
    sweepMat.uniforms.uA.value = (sk > 0 && sk < 1 ? 1 : 0) * (t < W.brush ? 1 : 0);

    // ---------- screen: dark -> wakes on "brush" -> sleeps as the finger leaves; stays dead under the pen ----------
    const wake = U.inv(W.brush - 0.02, W.brush + 0.12, t), sleep = U.inv(W.lift + 0.05, W.lift + 0.35, t);
    const bright = wake * (1 - sleep);
    if (bright > 0.001) { phone.look('home', {}); phone.screen.brightness(bright * (1 + 0.35 * Math.exp(-Math.max(0, t - W.brush) * 6))); }
    else { phone.look('off'); phone.screen.brightness(1); }

    // ---------- finger glide ----------
    const pathAt = (tt) => {
      const k = U.easeInOut(U.inv(W.brush, W.glideEnd, tt));
      return [U.lerp(STROKE.u0, STROKE.u1, k), U.lerp(STROKE.v0, STROKE.v1, k) + 0.03 * Math.sin(k * Math.PI)];
    };
    const handOn = t > W.lightest - 0.55 && t < W.lift + 0.22;
    hand.group.visible = handOn;
    phone.clearTouches(); phone.contactShadow(0.5, 0.5, 1, 0);
    trail.hideAll(); tipGlow.hideAll();
    if (handOn) {
      const [u, v] = pathAt(t);
      const base = phone.screenPoint(u, v);
      const appr = 1 - U.easeOut(U.inv(W.lightest - 0.55, W.brush, t));       // 1 far .. 0 on the glass
      const leave = U.easeIn(U.inv(W.lift - 0.05, W.lift + 0.22, t));
      const gap = 0.06;                                                       // feather-light: a hair above the glass
      const pos = base.clone().add(new THREE.Vector3(5 * appr + 6 * leave, gap + 5.5 * appr + 9 * leave, -3 * appr - 4 * leave));
      hand.point({ pos, tilt: 44 - 6 * appr, yaw: 128, curl: 0.15 * appr });
      // proximity cue + touch ripples
      phone.contactShadow(u, v, 0.9, 0.55 * (1 - appr) * (1 - leave));
      const touching = t >= W.brush && t < W.lift;
      if (touching || (t >= W.brush && t < W.lift + 0.6)) {
        phone.touchAt(...pathAt(W.brush), U.inv(W.brush, W.brush + 0.75, t), 0, { color: P.chargeHot, size: 1.8 });
        for (let s = 1; s <= 3; s++) {
          // ripples dropped along the stroke every 0.2 s (slot s reuses: phase-shifted)
          const per = 0.6, tt = t - W.brush - 0.2 * s;
          if (tt < 0) continue;
          const n = Math.floor(tt / per), born = W.brush + 0.2 * s + n * per;
          if (born > W.lift) continue;
          phone.touchAt(...pathAt(born), (t - born) / per, s, { color: P.chargeHot, size: 1.1 });
        }
      }
      // glowing trail: particles laid along the last ~0.45 s of the stroke, dying with age
      if (t >= W.brush) {
        const tEnd = Math.min(t, W.lift);
        for (let i = 0; i < 90; i++) {
          const age = (i / 90) * 0.5 + 0.0, tt = tEnd - age;
          if (tt < W.brush) continue;
          const life = 1 - age / 0.5, fadeOut = 1 - U.inv(W.lift, W.lift + 0.35, t);
          const [pu, pv] = pathAt(tt);
          const p = phone.screenPoint(pu + jit[i][0] * 0.04 * (1 - life), pv + jit[i][1] * 0.03 * (1 - life), undefined, 0.04 + 0.25 * (1 - life) * jit[i][2]);
          trail.setP(i, p.x, p.y, p.z, (0.4 + 0.9 * life) * fadeOut);
        }
        if (touching) { const tp = hand.tip(); tipGlow.setP(0, tp.x, tp.y + 0.02, tp.z, 1 + 0.3 * Math.sin(t * 30)); }
      }
      // "0 g" readout
      const la = U.win(t, W.brush + 0.08, W.lift + 0.1, 0.15, 0.2);
      if (la > 0) lab0.set(hand.tip(), la); else lab0.hide();
    } else lab0.hide();

    // ---------- pen: enters, anticipates, slams, presses harder ----------
    const penOn = t > W.pen - 0.4;
    pen.group.visible = penOn;
    const pu = 0.5, pv = 0.52;
    const tip = phone.screenPoint(pu, pv);
    if (penOn) {
      const lift = U.track([[W.pen - 0.4, 14], [W.pen, 3.2], [W.slam - 0.12, 3.9], [W.slam, 0]], t, (k) => k * k * (3 - 2 * k));
      const slamK = U.inv(W.slam - 0.12, W.slam, t);
      const lifted = t < W.slam ? (slamK > 0 ? 3.9 * (1 - slamK * slamK * slamK) : lift) : 0;
      const sink = t >= W.slam ? 0.35 * flex : 0;
      pen.set({ pos: tip.clone().add(new THREE.Vector3(0, lifted - sink, 0)), tilt: 18 + 6 * (lifted > 0 ? U.inv(0, 4, lifted) : 0), yaw: 118 });
      pen.press(t >= W.slam ? 0.7 + 0.8 * U.smooth(U.inv(W.hard - 0.1, W.hard + 0.1, t)) + 0.15 * flex : 0);
    }
    // impacts
    if (cur) {
      const shk = (d, a) => (d < 0 ? 0 : a * Math.exp(-d * 9));
      ctx.shake = Math.max(shk(dImp, 1), shk(dImp2, 0.6), t > W.ign && t < W.ign + 0.12 ? 0.25 : 0);
      ctx.flash = Math.max(dImp >= 0 ? 0.18 * Math.exp(-dImp * 22) : 0, wake > 0 && wake < 1 ? 0.06 : 0);
      ctx.bloomK = 0.7 + 0.25 * Math.exp(-Math.max(0, t - W.brush) * 3) * (t > W.brush ? 1 : 0);
      ctx.exposure = t < 0.18 ? U.lerp(1.7, 1.0, U.easeOut(t / 0.18)) : 1;   // punch-in from bright on frame 1
      ctx.capDy = 0;
    }
    // force arrows
    const aK = U.easeOut(U.inv(W.slam - 0.02, W.slam + 0.18, t));
    const pump = 1 + 0.35 * U.smooth(U.inv(W.hard - 0.08, W.hard + 0.1, t)) + 0.12 * flex;
    arrows.visible = aK > 0.01;
    arrowList.forEach((a, i) => {
      const ang = (i / 3) * Math.PI * 2 + 0.6, r = 1.05;
      const drop = (1 - aK) * 4 + 0.5 * Math.sin(t * 9 + i) * 0.15;
      a.position.set(tip.x + Math.cos(ang) * r, tip.y + 0.35 + drop + 0.25 * (pump - 1), tip.z + Math.sin(ang) * r);
      a.rotation.set(0, -ang, -0.28);   // lean in toward the tip
      a.scale.setScalar(Math.max(0.001, aK * pump * 0.55));
    });
    // "2 kg" count-up
    const kg = 2 * U.easeOut(U.inv(W.slam, W.hard + 0.15, t));
    const la2 = U.win(t, W.slam + 0.02, spec.t1 + 0.3, 0.12, 0.25);
    if (la2 > 0) lab2.set(tip.clone().add(new THREE.Vector3(0, 0.05, 0)), la2, { text: kg.toFixed(1) + ' kg' }); else lab2.hide();
    // red X: the screen did nothing
    const xk = U.inv(W.can - 0.05, W.can + 0.35, t);
    xIcon.pop(xk); xIcon.glow(1.4);
    if (xk > 0) {
      const cp = camPose(ctx, t, spec);
      const camR = new THREE.Vector3().subVectors(toV3(cp.pos), tip).cross(new THREE.Vector3(0, 1, 0)).normalize();
      xIcon.group.position.copy(tip).addScaledVector(camR, -3.2).add(new THREE.Vector3(0, 2.4, 0));
      xIcon.group.scale.multiplyScalar(0.6);
      xIcon.group.lookAt(toV3(cp.pos));
    }
  },

  camera(ctx, t, spec) { return camPose(ctx, t, spec); },
};

function times(ctx, spec) {
  const w = (s, d) => ctx.wordAt(s, spec.t0) ?? d;
  const brush = w('brush', 1.84), pen = w('pen', 3.44), hard = w('hard', 4.16);
  return {
    screen: w('screen', 0.56), phone: w('phone', 0.32), lightest: w('lightest', 1.52), brush, glideEnd: brush + 0.95, lift: brush + 0.98,
    ign: w('ignores', 2.88), pen, slam: w('pressed', 3.6) + 0.04, hard, can: w('can', 4.64),
  };
}

// camera: low hero 3/4 orbit + push, tracking the stroke; snap on "ignores" to a low side angle on the pen
function camPose(ctx, t, spec) {
  const U = ctx.U, o = spec.o, W = times(ctx, spec);
  const tc = U.clamp(t, spec.t0 - 0.5, spec.t1 + 0.6);
  let az, el, dist, tgt, fov;
  if (tc < W.ign) {
    az = U.track([[0, 42], [0.8, 28], [W.brush, 22], [W.ign, 12]], tc, U.easeOut);
    el = U.track([[0, 13], [0.8, 16], [W.ign, 22]], tc);
    dist = U.track([[0, 28], [0.8, 24.5], [W.brush, 23], [W.ign, 21]], tc);
    const fx = U.track([[0, 0], [W.brush, 0.3], [W.ign, 0.9]], tc), fz = U.track([[0, 0.4], [W.brush, 1.2], [W.ign, -0.6]], tc);
    tgt = [o[0] + fx, o[1] + 2.2 + U.track([[0, 0.6], [1.2, 0]], tc), o[2] + fz];
    fov = 32;
  } else {
    const k = U.inv(W.ign, W.ign + 0.16, tc);
    az = U.lerp(-34, -50, U.smoother(U.inv(W.ign + 0.16, spec.t1 + 0.6, tc))) + (1 - U.easeOut(k)) * 44;
    el = U.track([[W.ign, 20], [W.slam, 18], [W.can, 23], [spec.t1 + 0.6, 26]], tc);
    dist = U.track([[W.ign, 29], [W.slam, 27.5], [W.hard, 24.5], [W.can, 26], [spec.t1 + 0.6, 29]], tc);
    tgt = [o[0] + 0.6, o[1] + 4.4 + U.track([[W.ign, 1.2], [W.slam, 0]], tc), o[2] + 0.6];
    fov = U.track([[W.ign, 30], [W.hard, 28.5], [W.can, 31]], tc);
  }
  const p = U.orbit(tgt, dist, az, el, fov);
  p.pos = [p.pos[0] + 0.12 * U.drift(tc * 1.3, 1), p.pos[1] + 0.12 * U.drift(tc * 1.3, 2), p.pos[2]];
  p.roll = tc < 0.75 ? U.lerp(-7, 0, U.easeOut(U.clamp(tc / 0.75))) : 0;
  return p;
}
