// HOOK (studio look). Example scene: works with ANY words.json (every cue has a fallback). Replace it for your topic.
// Frame 0 is already moving: a dark phone springs into a low 3/4 hero angle while a light sweep crosses the glass and a
// blue scan rolls through its hidden sensor grid. Mid-beat a fingertip taps the screen: the screen wakes, touch rings,
// tiny flash + shake + 'pop'. The camera never stops (push-in + drift), roll settles from -7 deg.
import * as THREE from 'three';
import { makePhone, makeHand, makeCharges, studioFloor, toV3 } from '/engine/kits/studio.js';

let S = null;

// word cues for this beat. spec.cue(word, fallbackFraction) = time of that word inside the beat, or t0 + frac * duration.
function cues(spec) {
  const tap = spec.cue('screen', 0.45);                 // put YOUR key word here (the moment the hero action lands)
  return { tap, wake: tap + 0.02, lift: Math.min(spec.t1 - 0.25, tap + 0.9) };
}

export default {
  init(ctx, spec) {
    const o = toV3(spec.o);                             // this beat's own station in space (never hard-code it)
    const root = ctx.station(spec);                     // world-aligned Group, shown/hidden with the beat
    const phone = makePhone(ctx, { look: 'off' }); phone.group.position.copy(o); root.add(phone.group);
    const floor = studioFloor(ctx, { r: 80, shadow: 0.5 }); floor.group.position.copy(o).add(new THREE.Vector3(0, -5.5, 0)); root.add(floor.group);
    const hand = makeHand(ctx); root.add(hand.group);
    const glow = makeCharges(ctx, 2, { color: ctx.P.chargeHot, size: 0.16, glow: 3 }); ctx.scene.add(glow.group);   // world space
    // light sweep across the dark glass (additive band inside the glass layer)
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
    S = { root, phone, hand, glow, sweepMat, o };
    const C = cues(spec);
    ctx.sfx(C.tap, 'pop', 0.8);                         // SFX are cues for tools/mix.py (synthesised there)
  },

  update(ctx, t, spec) {
    const { U, P } = ctx, { root, phone, hand, glow, sweepMat, o } = S;
    const on = spec.on(t);
    root.visible = on; glow.group.visible = on;
    if (!on) return;                                    // hidden outside [t0 - blend/2, t1 + next blend/2]
    const C = cues(spec), lt = t - spec.t0;

    // phone: spring spin-in, gentle float, tiny dip on the tap
    const spin = 1 - U.spring(U.clamp(lt / 0.75), 1.6, 4.2);
    const dTap = t - C.tap, hit = dTap < 0 ? 0 : Math.exp(-dTap * 7) * Math.cos(dTap * 32);
    phone.group.position.set(o.x, o.y + 0.25 * Math.sin(t * 1.3) - 0.12 * hit, o.z);
    phone.group.rotation.set(0.05 * Math.sin(t * 0.9), -0.25 * spin, 0.14 * spin);
    phone.explode(0, { grid: false });

    // sensor-grid ghost: a blue scan rolls through the hidden grid (teases the mechanism), then hides
    const g = phone.grid; g.reset();
    const gk = U.inv(spec.t0 - 0.25, C.tap - 0.1, t), gA = Math.sin(Math.PI * gk) * 0.6;
    g.alpha(gA); g.scan(gA > 0 ? gk : -1, { axis: 'row', width: 2.5 });
    phone.layers.sensor.visible = gA > 0.01;

    // light sweep over the glass at the very start
    const sk = U.inv(spec.t0 - 0.25, spec.t0 + 0.8, t);
    sweepMat.uniforms.uPos.value = U.lerp(-0.4, 1.8, U.easeInOut(sk));
    sweepMat.uniforms.uA.value = sk > 0 && sk < 1 ? 1 : 0;

    // screen wakes on the tap
    const wake = U.inv(C.wake - 0.02, C.wake + 0.12, t);
    if (wake > 0.001) { phone.look('home', {}); phone.screen.brightness(wake * (1 + 0.35 * Math.exp(-Math.max(0, dTap) * 6))); }
    else { phone.look('off'); phone.screen.brightness(1); }

    // finger: approach, tap, lift (every parameter set every frame: pure function of t)
    const u = 0.42, v = 0.5, base = phone.screenPoint(u, v);
    const handOn = t > C.tap - 0.7 && t < C.lift + 0.3;
    hand.group.visible = handOn;
    phone.clearTouches(); phone.contactShadow(u, v, 1, 0); glow.hideAll();
    if (handOn) {
      const appr = 1 - U.easeOut(U.inv(C.tap - 0.7, C.tap, t)), leave = U.easeIn(U.inv(C.lift - 0.1, C.lift + 0.3, t));
      hand.point({ pos: base.clone().add(new THREE.Vector3(4 * appr + 5 * leave, 0.02 + 5 * appr + 8 * leave, -2 * appr - 3 * leave)), tilt: 42 - 5 * appr, yaw: 100, curl: 0.15 * appr });
      phone.contactShadow(u, v, 0.9, 0.55 * (1 - appr) * (1 - leave));
      if (t >= C.tap) {
        phone.touchAt(u, v, U.inv(C.tap, C.tap + 0.75, t), 0, { color: P.chargeHot, size: 1.8 });
        phone.touchAt(u, v, U.inv(C.tap + 0.25, C.tap + 1.0, t), 1, { color: P.chargeHot, size: 1.2 });
        if (t < C.lift) { const tp = hand.tip(); glow.setP(0, tp.x, tp.y + 0.02, tp.z, 1 + 0.3 * Math.sin(t * 30)); }
      }
    }

    // impacts only while this beat is the current one
    if (t >= spec.t0 && t < spec.t1) {
      ctx.flash = dTap >= 0 ? 0.12 * Math.exp(-dTap * 22) : 0;
      ctx.shake = dTap >= 0 ? 0.6 * Math.exp(-dTap * 9) : 0;
      ctx.bloomK = 0.7 + 0.25 * Math.exp(-Math.max(0, dTap) * 3) * (dTap > 0 ? 1 : 0);
      ctx.exposure = lt < 0.18 ? U.lerp(1.7, 1.0, U.easeOut(U.clamp(lt / 0.18))) : 1;   // punch in from bright on frame 1
    }
  },

  camera(ctx, t, spec) {
    const U = ctx.U, o = spec.o, C = cues(spec);
    const tc = U.clamp(t, spec.t0 - 0.5, spec.t1 + 0.6), lt = tc - spec.t0;
    // keyframes on WORD times: wide low 3/4 -> push toward the tap point -> slow drift after
    const az = U.track([[spec.t0, 42], [spec.t0 + 0.8, 28], [C.tap, 18], [spec.t1 + 0.6, 6]], tc, U.easeOut);
    const el = U.track([[spec.t0, 13], [spec.t0 + 0.8, 17], [C.tap, 24], [spec.t1 + 0.6, 28]], tc);
    const dist = U.track([[spec.t0, 28], [spec.t0 + 0.8, 24.5], [C.tap, 20.5], [spec.t1 + 0.6, 19]], tc);
    const p = U.orbit([o[0] + 0.3, o[1] + 3.4, o[2] + 0.4], dist, az, el, 32);   // target above the phone = subject sits low, captions stay clear
    p.pos = [p.pos[0] + 0.12 * U.drift(tc * 1.3, 1), p.pos[1] + 0.12 * U.drift(tc * 1.3, 2), p.pos[2]];
    p.roll = lt < 0.75 ? U.lerp(-7, 0, U.easeOut(U.clamp(lt / 0.75))) : 0;
    return p;
  },
};
