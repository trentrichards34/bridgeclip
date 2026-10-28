/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-tracker/s03_signal.js - Pulse rings + range circle (12.35-18.9 s)
 * Look: city + gadgets (same paper city, units m, tracker/suitcase/people props)
 * Original spoken line: "A tracker does one thing: it sends out a small Bluetooth signal, over and over. That signal only reaches a few meters."
 * Shows:
 *   Macro x-ray on the tracker in a suitcase pocket; on "sends" the first bubble bursts out and the camera rides it
 *   back to the bag on the sidewalk; "over and over" = a steady beacon rhythm (sphere shells + ground rings); "only
 *   reaches a few meters": the camera cranes up, a dashed range circle sweeps on with a measured radius, every ring
 *   dies at it.
 * Techniques to steal:
 *   - pulseRings, one ring instance per emission so each lands on its own word (EMIT list)
 *   - range circle ShaderMaterial: angular sweep-on (uSweep), dashed line, soft fill
 *   - camera rides an emitted object; x-ray macro with ctx.exposure lift
 *   - hud.eta/card digit roll between units (2.4 mi -> 1 job -> few m) + hud.label + hud.status
 *
 * NOTE - written against the ORIGINAL per-reel core of the city + gadgets reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   './lib.js'            -> '/engine/kits/gadgets.js'. Identifiers in this file ALREADY use the packaged names:
 *                            makeTracker (tracker tag) and makeHandset (handheld phone). Everything else keeps its name
 *                            (makeSuitcase, makePerson, walk, drawMapScreen, drawArrowScreen, pulseRings, makePacket,
 *                            flyArc, bezier, makeCloud, makeContactShadow, linePath, placeOnPath, look, fade, LOC,
 *                            initLib, makeAirportProps, makeShuttle, makeHotelLobby, makeStreetProps, makeEmptyRoom).
 *   core/world.js + traffic.js -> '/engine/kits/city.js'; read ctx.city where this file reads ctx.world.
 *                            ctx.ribbonGeometry / ctx.ribbonMaterial: exported from city.js and also on ctx.
 *   core/hud.js           -> ctx.hud: hud.eta = alias of hud.card, hud.status = alias of hud.chip, hud.label, hud.big,
 *                            hud.layer. Captions are automatic.
 *   palette               -> this file's P is the CITY palette = ctx.C in the packaged engine. core/util.js -> ctx.U.
 *   TIMING: the seconds in the T / W word tables were locked to the original voiceover. Convert every one to a word
 *   cue (ctx.wordAt('word', spec.t0) or spec.cue('word', fallbackFraction)) when adapting.
 *   Absolute city coordinates (LOC.* spots), no spec.o station.
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// s03_signal (12.35-18.9): "A tracker does one thing: it sends out a small Bluetooth signal, over and over.
// That signal only reaches a few meters."
// The street spot (LOC.street, where the stranger walks by in s05). Macro x-ray on the tracker in the suitcase's
// front pocket; on "sends" the first bubble bursts out and the camera rides it back to the bag on the sidewalk;
// "over and over" = a steady beacon rhythm (sphere shells at the tag + rings on the ground); "only reaches a few
// meters" = the camera cranes up, a dashed range circle sweeps on with a measured radius, and every ring dies at it.
import * as THREE from 'three';
import { makeTracker, makeSuitcase, makeStreetProps, pulseRings, LOC, fade, initLib } from './lib.js';

// word times (build/words_final.json)
const T = {
  tracker: 12.56, one: 13.28, sends: 14.0, small: 14.56, bt: 14.8, over1: 15.79, over2: 16.34,
  that: 16.91, only: 17.39, reaches: 17.70, few: 18.18,
};
// beacon emissions: the first one alone on "sends", then a steady rhythm locked to "over" ... "over"
const EMIT = [14.0, 15.79, 16.34, 16.89, 17.44, 17.99, 18.54, 19.09];
const R_FEW = 3.0;            // range circle radius (m): "a few meters", no number on screen
const GROUND_DY = 0.03;       // rings / range circle above the sidewalk top

const RANGE_VS = `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const RANGE_FS = `
  uniform vec3 lineCol, fillCol; uniform float uSweep, uAlpha, uR, uFill, uStart;
  varying vec2 vP;
  void main(){
    float r = length(vP);
    float a = fract((atan(vP.y, vP.x) - uStart) / 6.2831853 + 1.0);
    float w = uR * 0.012;
    float line = 1.0 - smoothstep(w, w + uR * 0.008, abs(r - uR));
    float dash = smoothstep(0.30, 0.36, fract(a * 56.0)) * (1.0 - smoothstep(0.86, 0.92, fract(a * 56.0)));
    float fill = uFill * (1.0 - smoothstep(uR - 0.02, uR, r)) * (0.25 + 0.75 * smoothstep(0.0, uR, r));
    float on = 1.0 - smoothstep(uSweep - 0.004, uSweep, a);
    float lk = line * dash;
    float alpha = (lk * 0.9 + fill * (1.0 - lk)) * on * uAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(mix(fillCol, lineCol, clamp(lk * 1.5, 0.0, 1.0)), alpha);
    #include <colorspace_fragment>
  }`;

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// non-uniform Catmull-Rom (Hermite) through camera keys: velocity stays continuous, so the camera never parks
function spline(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t1, p1] = keys[i], [t2, p2] = keys[i + 1];
  const [t0, p0] = keys[Math.max(0, i - 1)], [t3, p3] = keys[Math.min(n - 1, i + 2)];
  const dt = t2 - t1, u = (t - t1) / dt, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return p1.map((a, j) => {
    const m1 = i > 0 ? ((p2[j] - p0[j]) / (t2 - t0)) * dt : (p2[j] - p1[j]) * 0.5;
    const m2 = i + 2 < n ? ((p3[j] - p1[j]) / (t3 - t1)) * dt : (p2[j] - p1[j]) * 0.5;
    return h00 * a + h10 * m1 + h01 * p2[j] + h11 * m2;
  });
}

let S = null;

export default {
  init(ctx, spec) {
    initLib(ctx);
    const { P } = ctx;
    const root = new THREE.Group(); root.name = 's03'; root.visible = false; ctx.scene.add(root);

    const street = makeStreetProps(ctx); root.add(street);
    const bag = makeSuitcase(ctx);                       // same default bag as s02 / s06 on this spot
    street.userData.bagSlot.add(bag);
    const tag = makeTracker(ctx, { scale: 0.09 });
    bag.userData.tagSlot.add(tag);
    // bright ring hugging the coin: marks the transmitter in the x-ray macro (blooms)
    const haloM = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.phone).multiplyScalar(1.7), transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.028, 8, 72), haloM);
    halo.rotation.x = Math.PI / 2; halo.renderOrder = 13; tag.add(halo);
    root.updateMatrixWorld(true);

    const B = new THREE.Vector3(); bag.getWorldPosition(B);                       // bag foot (sidewalk top)
    const tagW = new THREE.Vector3(); tag.getWorldPosition(tagW);                 // tracker centre
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(bag.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    const frontAz = THREE.MathUtils.radToDeg(Math.atan2(front.x, front.z));       // camera azimuth straight in front of the bag

    // glow at the tag (flashes with every emission)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: P.phone, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.position.copy(tagW).addScaledVector(front, 0.03); glow.renderOrder = 12; root.add(glow);

    // one ring instance per emission, so each can be driven on its own word
    // lib shell shader: pow() of a tiny negative base (dot rounding past 1) gives NaN, which bloom smears into a black frame.
    // Clamp it on our own instances (reported in notes/s03_signal.md for lib.js).
    const fixShell = (r) => { r.shells.forEach((m) => { m.material.fragmentShader = m.material.fragmentShader.replace('pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2)', 'pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2)'); m.material.needsUpdate = true; }); return r; };
    const shells = EMIT.map((e, i) => { const r = pulseRings(ctx, { mode: 'sphere', maxR: 0.85, count: 1, period: 1, glow: 1.2 }); root.add(r.group); return fixShell(r); });
    const rings = EMIT.map(() => { const r = pulseRings(ctx, { maxR: R_FEW + 0.15, count: 1, period: 1, width: 0.11, fill: 0.34, glow: 1.15 }); root.add(r.group); return r; });

    // camera keys: [t, [tx,ty,tz, dist, az, el, fov]] (targets relative to world)
    const tg = (y) => [B.x, B.y + y, B.z];
    const tt = [tagW.x, tagW.y, tagW.z];
    const mix = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k);
    const A = frontAz;
    const keys = [
      [11.8, [...mix(tt, tg(0.5), 0.3), 3.2, A + 34, 18, 22]],
      [12.6, [...tt, 1.9, A + 30, 16, 15]],
      [13.4, [...tt, 1.6, A + 16, 11, 13]],
      [14.0, [...tt, 1.45, A + 5, 8, 12.5]],
      [14.65, [...mix(tt, tg(0.42), 0.7), 2.6, A - 16, 9, 24]],
      [15.1, [...tg(0.36), 4.6, A - 30, 20, 34]],
      [15.8, [...tg(0.33), 5.6, A - 46, 23, 35]],
      [16.3, [...tg(0.3), 6.6, A - 70, 22, 36]],
      [17.2, [...tg(0.2), 10.5, A - 98, 28, 37]],
      [17.9, [...tg(0.0), 16.5, A - 106, 49, 38]],
      [18.4, [...tg(0.0), 19.5, A - 110, 57, 38]],
      [19.4, [...tg(0.0), 22.0, A - 114, 63, 38]],
    ];
    // measure line points to screen-right of the crane shot
    const azM = THREE.MathUtils.degToRad(A - 110);
    const fwd = new THREE.Vector3(-Math.sin(azM), 0, -Math.cos(azM));
    const mDir = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();                 // camera right on the ground

    // range circle (dashed edge + faint fill), sweeping on from the measure line
    const rangeMat = new THREE.ShaderMaterial({
      uniforms: { lineCol: { value: new THREE.Color(P.ink) }, fillCol: { value: new THREE.Color(P.phone) }, uSweep: { value: 0 }, uAlpha: { value: 0 },
        uR: { value: R_FEW }, uFill: { value: 0.16 }, uStart: { value: Math.atan2(-mDir.z, mDir.x) } },
      vertexShader: RANGE_VS, fragmentShader: RANGE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    const range = new THREE.Mesh(new THREE.CircleGeometry(R_FEW * 1.03, 160), rangeMat);
    range.rotation.x = -Math.PI / 2; range.position.set(B.x, B.y + GROUND_DY + 0.005, B.z); range.renderOrder = 9; root.add(range);

    // measured radius: line + end tick + centre dot
    const ink = new THREE.MeshBasicMaterial({ color: P.ink, transparent: true, opacity: 0, depthWrite: false });
    const meas = new THREE.Group(); meas.position.set(B.x, B.y + GROUND_DY + 0.012, B.z);
    meas.rotation.y = Math.atan2(-mDir.z, mDir.x); root.add(meas);
    const lineGeo = new THREE.BoxGeometry(1, 0.01, 0.045); lineGeo.translate(0.5, 0, 0);
    const mLine = new THREE.Mesh(lineGeo, ink); mLine.renderOrder = 10; meas.add(mLine);
    const mTick = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.01, 0.42), ink); mTick.position.x = R_FEW; mTick.renderOrder = 10; meas.add(mTick);
    const mDot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 24), ink); mDot.renderOrder = 10; meas.add(mDot);

    const onlyMe = typeof location !== 'undefined' && new URLSearchParams(location.search).get('only') === spec.id;
    const strays = onlyMe ? ctx.scene.children.filter((c) => c !== root && c.getObjectByName && c.getObjectByName('streetProps')) : [];
    // s02 leaves its own copy of this bag + street set on screen until 12.85 (its fade-out under the blend).
    // Ours takes over from 12.3 so the x-ray works: hide their suitcase on our spot, and our duplicate set while theirs shows.
    const foreign = [];
    ctx.scene.traverse((o) => { if (o.name === 'suitcase' && o !== bag) { const p = o.getWorldPosition(new THREE.Vector3()); if (p.distanceTo(B) < 0.3) foreign.push(o); } });
    const foreignSets = ctx.scene.children.filter((c) => c !== root && c.getObjectByName && c.getObjectByName('streetProps'));
    S = { foreign, foreignSets, halo, haloM, strays, root, street, bag, tag, B, tagW, front, glow, shells, rings, keys, range, rangeMat, meas, mLine, mTick, mDot, ink, mDir,
      v: new THREE.Vector3(), v2: new THREE.Vector3() };
  },

  update(ctx, t, spec) {
    const { U, P, hud } = ctx;
    const a = U.win(t, spec.t0 - 0.5, spec.t1 + 0.45, 0.25, 0.3);
    S.root.visible = a > 0;
    S.strays.forEach((c) => (c.visible = false));
    if (!S.root.visible) return;
    S.foreign.forEach((o) => (o.visible = t < 12.3));
    S.street.visible = !S.foreignSets.some((c) => c.visible);
    const { B, tagW } = S;

    // ---- x-ray: shell ghosted for the macro, solid again as we pull back ----
    const xr = 1 - U.smooth(U.inv(14.55, 15.05, t));
    fade(S.bag.userData.shell, 1 - 0.8 * xr);
    ctx.exposure = 1.02 + 0.16 * xr;                     // lift the x-ray macro a touch (it sits in the café's shade)
    S.bag.userData.contents.visible = xr > 0.02;

    // ---- emissions ----
    let flash = 0;
    EMIT.forEach((e, i) => {
      const first = i === 0;
      // sphere bubble out of the tag
      const ks = U.clamp((t - e) / (first ? 1.25 : 0.95));
      const live = t >= e && ks < 1;
      S.shells[i].update(live ? (1 - Math.pow(1 - ks, 1.7)) * 0.999 : 0, tagW, live ? a * (first ? 1 : 0.8) * (0.45 + 0.55 * xr) : 0);
      // ground ring around the bag, dies at the range circle
      const kg = U.clamp((t - e - 0.05) / (first ? 2.4 : 1.45));
      const liveG = t >= e + 0.05 && kg < 1;
      S.v.set(B.x, B.y + GROUND_DY, B.z);
      S.rings[i].update(liveG ? (first ? kg : 1 - Math.pow(1 - kg, 1.5)) * 0.999 : 0, S.v, liveG ? a * (0.25 + 0.75 * (1 - xr)) : 0);
      if (t >= e) flash += Math.exp(-(t - e) * 7);
    });
    // the tag lights up on "tracker", then pulses with every emission
    const named = U.smooth(U.inv(T.tracker - 0.05, T.tracker + 0.25, t));
    S.glow.material.opacity = a * Math.min(1, named * (0.35 + 0.15 * Math.sin(t * 5)) * (0.3 + 0.7 * xr) + flash * 0.9);
    S.glow.scale.setScalar(0.09 + 0.05 * Math.min(1, flash) + 0.06 * (1 - xr));
    S.haloM.opacity = a * xr * Math.min(1, named * 0.55 + flash * 0.8);
    S.halo.scale.setScalar(1 + 0.12 * Math.min(1, flash));

    // ---- range circle + measured radius ("only reaches a few meters") ----
    const sw = U.easeInOut(U.inv(T.reaches - 0.05, T.reaches + 0.55, t));
    const rA = a * U.smooth(U.inv(T.reaches - 0.1, T.reaches + 0.1, t));
    S.rangeMat.uniforms.uSweep.value = sw;
    S.rangeMat.uniforms.uAlpha.value = rA;
    S.range.visible = rA > 0.003;
    const ml = U.expoOut(U.inv(T.reaches - 0.05, T.reaches + 0.4, t));
    S.mLine.scale.x = Math.max(1e-3, ml * R_FEW);
    S.mTick.scale.z = Math.max(1e-3, U.backOut(U.inv(T.reaches + 0.3, T.reaches + 0.55, t)));
    S.mDot.scale.setScalar(Math.max(1e-3, U.backOut(U.inv(T.reaches - 0.1, T.reaches + 0.15, t))));
    S.ink.opacity = rA * 0.85;
    S.meas.visible = rA > 0.003;

    // ---- labels (one at a time) ----
    const labA1 = a * U.win(t, T.tracker, 13.95, 0.22, 0.3);
    hud.label('s03tag', tagW, 'tracker', { alpha: labA1, dx: 80, dy: -170, small: t < T.one ? 'in the front pocket' : 'one job', color: P.paper });
    // "bluetooth" rides the first ground ring's edge, screen-right
    const cam = this.camera(ctx, t);
    const fx = cam.target[0] - cam.pos[0], fz = cam.target[2] - cam.pos[2], fl = Math.hypot(fx, fz) || 1;
    const rx = -fz / fl, rz = fx / fl;
    const k1 = U.clamp((t - EMIT[0] - 0.05) / 2.4), r1 = k1 * (R_FEW + 0.15);
    const btR = Math.min(r1, 1.1);
    S.v2.set(B.x + rx * btR, B.y + 0.3 + 0.25 * (1 - k1), B.z + rz * btR);
    const labA2 = a * U.win(t, T.bt - 0.02, 15.85, 0.22, 0.3);
    hud.label('s03bt', S.v2, 'bluetooth', { alpha: labA2, dx: 60, dy: -150, small: 'low energy', color: P.phone });
    // "a few meters" on the measured radius
    S.v.set(B.x + S.mDir.x * R_FEW * 0.5, B.y + 0.05, B.z + S.mDir.z * R_FEW * 0.5);
    const labA3 = a * U.win(t, T.few - 0.04, spec.t1 + 0.4, 0.22, 0.35);
    hud.label('s03few', S.v, 'a few meters', { alpha: labA3, dx: 20, dy: -150, color: P.phone, small: 'then it fades' });

    // ---- status chip: the beacon rhythm ----
    hud.status({ label: 'BLUETOOTH · REPEATING', color: P.phone, alpha: a * U.win(t, T.over1 - 0.05, 18.0, 0.2, 0.35) });

    // ---- item card ----
    if (t < T.one) {
      hud.eta({ kicker: 'SUITCASE · TRACKER', icon: 'tag', time: '2.4', unit: 'mi', sub: 'seen just now', state: 'live' });
    } else if (t < T.reaches) {
      hud.eta({ kicker: 'TRACKER · ONE JOB', icon: 'tag', time: '1', prev: '2.4', k: U.inv(T.one, T.one + 0.35, t), unit: t < T.one + 0.1 ? 'mi' : 'job',
        sub: t < T.bt ? 'send a signal' : 'bluetooth signal, on repeat', state: 'live' });
    } else {
      const kr = U.inv(T.reaches, T.reaches + 0.3, t);
      hud.eta({ kicker: 'SIGNAL RANGE', icon: 'tag', time: 'few', prev: '1', k: kr, unit: kr < 0.3 ? 'job' : 'm',
        sub: 'then it fades out', state: 'live' });
    }
  },

  camera(ctx, t) {
    const U = ctx.U;
    const v = spline(S.keys, U.clamp(t, 11.8, 19.4));
    const macro = 1 - U.smooth(U.inv(14.2, 15.2, t));
    const dr = U.drift(t, 3) * (1 - 0.8 * macro);
    return U.orbit([v[0], v[1], v[2]], v[3], v[4] + dr * 1.2, v[5] + dr * 0.4, v[6]);
  },
};
