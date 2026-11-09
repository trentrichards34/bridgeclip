/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-tracker/s09_billion_fx.js - Helper module for s09_billion
 * Look: city + gadgets (same paper city, units m, tracker/suitcase/people props)
 * Original spoken line: (helper, no line)
 * Shows:
 *   buildDots (Points with per-dot seed/size/kind, reveal by log distance in GLSL), buildArcs (relay tree of hops
 *   from the bag outward), buildVeil (fullscreen dim), buildMarker (screen-sized point marker).
 * Techniques to steal:
 *   - ~100k points in one THREE.Points, all timing in attributes + a uTime uniform (pure of t)
 *   - shared JS + GLSL timing functions (revealTime / relayTime) so CPU and shader agree
 *   - populating a city procedurally: sidewalks, blocks, downtown crowd, highway, outlying towns
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
// s09_billion helpers: the device-dot field, the relay arcs, the dimming veil and the bag marker.
// All timing lives in attributes + a uTime uniform, so a frame is a pure function of t.
import * as THREE from 'three';

export const REV = { t0: 38.97, dur: 1.6, r0: 25, rmax: 4500 };    // dots pop outward from the bag ("over a billion" .. "out there")
export const REL = { t0: 41.0, dur: 1.15, r0: 40, rmax: 4500 };    // relay ripple ("each one can relay the signal")
export const revealTime = (d) => REV.t0 + REV.dur * Math.log(1 + d / REV.r0) / Math.log(1 + REV.rmax / REV.r0);
export const relayTime = (d) => REL.t0 + REL.dur * Math.log(1 + d / REL.r0) / Math.log(1 + REL.rmax / REL.r0);

const GLSL_TIMES = `
  uniform float uTime;
  float revealT(float d) { return ${REV.t0.toFixed(3)} + ${REV.dur.toFixed(3)} * log(1.0 + d / ${REV.r0.toFixed(1)}) / ${Math.log(1 + REV.rmax / REV.r0).toFixed(5)}; }
  float relayT(float d) { return ${REL.t0.toFixed(3)} + ${REL.dur.toFixed(3)} * log(1.0 + d / ${REL.r0.toFixed(1)}) / ${Math.log(1 + REL.rmax / REL.r0).toFixed(5)}; }
`;

// ---------------------------------------------------------------------------------------------
// device dots
// ---------------------------------------------------------------------------------------------
export function buildDots(ctx, bag) {
  const { P, U, world } = ctx;
  const R = U.rng(90901);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-6, R()))) * Math.cos(2 * Math.PI * R());
  const pos = [], seed = [], size = [], kind = [];
  const LIM = 4420;
  const push = (x, y, z, s = 1, k = 0) => {
    if (Math.abs(x) > LIM || Math.abs(z) > LIM) return;
    pos.push(x, y, z); seed.push(R()); size.push(s * (2.6 + R() * 1.8)); kind.push(k);
  };
  // city streets (same grid as core/world.js) - people on sidewalks
  const xs = [], zs = [];
  for (let x = -810; x <= 890; x += 80) xs.push(x);
  for (let z = -870; z <= 650; z += 80) zs.push(z);
  for (let i = 0; i < 26000; i++) {
    if (R() < 0.5) { const x = xs[(R() * xs.length) | 0] + (R() < 0.5 ? -1 : 1) * (4 + R() * 3); push(x, 1, -870 + R() * 1520); }
    else { const z = zs[(R() * zs.length) | 0] + (R() < 0.5 ? -1 : 1) * (4 + R() * 3); push(-810 + R() * 1700, 1, z); }
  }
  // inside blocks (homes, offices)
  for (let i = 0; i < 14000; i++) push(-810 + R() * 1700, 1.5, -870 + R() * 1520, 0.85);
  // downtown crowd around the hotel
  for (let i = 0; i < 6000; i++) push(560 + gauss() * 170, 2, -380 + gauss() * 140, 0.9);
  // highway traffic: phones in cars
  const hw = world.paths.highway;
  for (let i = 0; i < 4000; i++) { const s = R() * hw.length, p = hw.side(s, (R() < 0.5 ? -1 : 1) * (2 + R() * 9.5), 1.2); push(p.x, p.y, p.z, 0.9); }
  // outskirts: thinning with distance from the city
  for (let i = 0; i < 24000; i++) {
    const a = R() * Math.PI * 2, r = 950 + (-Math.log(Math.max(1e-6, R()))) * 1100;
    push(Math.cos(a) * r * 1.05, 1, Math.sin(a) * r, 0.8);
  }
  // and a denser spill westward (the direction the wide shot looks)
  for (let i = 0; i < 14000; i++) {
    const x = -850 - (-Math.log(Math.max(1e-6, R()))) * 1400, z = -400 + gauss() * 1300;
    push(x, 1, z, 0.8);
  }
  // towns out to the edge of the world, joined by roads of dots
  const towns = [];
  // the final frame looks west across the city: most towns sit in that wedge, a few behind / around
  for (let i = 0; i < 18; i++) {
    let x, z, tries = 0;
    do {
      if (i < 10) { x = -1300 - R() * 2900; z = -2100 + R() * 3100; }
      else if (i < 13) { x = 1150 + R() * 1000; z = -1500 + R() * 2200; }
      else { const a = R() * Math.PI * 2, r = 1700 + R() * 2600; x = Math.cos(a) * r; z = Math.sin(a) * r; }
      tries++;
    }
    while (tries < 30 && (Math.abs(x) > 4200 || Math.abs(z) > 4200 || towns.some((tw) => Math.hypot(tw.x - x, tw.z - z) < 650)));
    towns.push({ x, z, s: 80 + R() * 200, n: 1400 + (R() * 2600) | 0, e: 0.6 + R() * 0.8 });
  }
  towns.push({ x: -1010, z: 262, s: 110, n: 2600, e: 1.3 });   // the airport
  for (const tw of towns) {
    for (let i = 0; i < tw.n; i++) push(tw.x + gauss() * tw.s * tw.e, 1, tw.z + gauss() * tw.s / tw.e, 0.9);
    // a road to the nearest neighbour (town or city edge)
    let best = { x: Math.sign(tw.x) * Math.min(Math.abs(tw.x), 850), z: Math.sign(tw.z) * Math.min(Math.abs(tw.z), 640) }, bd = Math.hypot(best.x - tw.x, best.z - tw.z);
    for (const o of towns) { if (o === tw) continue; const dd = Math.hypot(o.x - tw.x, o.z - tw.z); if (dd < bd) { bd = dd; best = o; } }
    const n = Math.round(bd / 9);
    const bend = (R() - 0.5) * 0.25 * bd;
    for (let i = 0; i < n; i++) {
      const k = i / n, nx = -(best.z - tw.z) / bd, nz = (best.x - tw.x) / bd, b = Math.sin(Math.PI * k) * bend;
      push(tw.x + (best.x - tw.x) * k + nx * (b + gauss() * 5), 1, tw.z + (best.z - tw.z) * k + nz * (b + gauss() * 5), 0.8);
    }
  }
  // relay nodes: existing dots picked evenly in log-distance from the bag
  const nAll = pos.length / 3;
  const bins = 22, lo = Math.log(28), hi = Math.log(4300);
  const byBin = Array.from({ length: bins }, () => []);
  for (let i = 0; i < nAll; i++) {
    const d = Math.hypot(pos[i * 3] - bag.x, pos[i * 3 + 2] - bag.z);
    if (pos[i * 3] > 1700) continue;               // keep relays out of the bottom edge of the wide shot
    const b = Math.floor(((Math.log(Math.max(d, 1)) - lo) / (hi - lo)) * bins);
    if (b >= 0 && b < bins) byBin[b].push(i);
  }
  const nodes = [];
  for (let bi = 0; bi < bins; bi++) {
    const list = byBin[bi], perBin = Math.round(3 + 11 * Math.pow(bi / (bins - 1), 0.8));
    for (let j = 0; j < perBin && list.length; j++) {
      const i = list.splice((R() * list.length) | 0, 1)[0];
      kind[i] = 1; size[i] *= 1.3;
      const p = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      nodes.push({ p, d: Math.hypot(p.x - bag.x, p.z - bag.z), i });
    }
  }
  const dist = new Float32Array(nAll);
  for (let i = 0; i < nAll; i++) dist[i] = Math.hypot(pos[i * 3] - bag.x, pos[i * 3 + 2] - bag.z);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aD', new THREE.BufferAttribute(dist, 1));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uFade: { value: 0 }, uScale: { value: 1 }, uRes: { value: 0.5 },
      cDev: { value: new THREE.Color(P.phone).lerp(new THREE.Color('#ffffff'), 0.25) },
      cRel: { value: new THREE.Color(P.live).lerp(new THREE.Color('#ffffff'), 0.15) },
    },
    vertexShader: GLSL_TIMES + `
      uniform float uFade, uScale, uRes;
      attribute float aD, aSeed, aSize, aKind;
      varying float vA, vFlash, vRel, vHot;
      float backOut(float k) { float s = 1.9; k -= 1.0; return 1.0 + (s + 1.0) * k * k * k + s * k * k; }
      void main() {
        float b = revealT(aD) + (aSeed - 0.5) * 0.14;
        float k = clamp((uTime - b) / 0.3, 0.0, 1.0);
        float r = uTime - (relayT(aD) + (aSeed - 0.5) * 0.08);
        float flash = r > 0.0 ? exp(-r * 4.5) : 0.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float px = aSize * uScale / max(1.0, -mv.z);          // px at 1080x1920
        float pxc = clamp(px, 2.6, 11.0);
        float cover = clamp(px / 2.6, 0.55, 1.0);              // sub-pixel dots: dimmer, not bigger
        float pop = k <= 0.0 ? 0.0 : backOut(k);
        pxc *= pop * (1.0 + flash * (0.6 + aKind * 1.2)) * (1.0 + aKind * 0.35);
        gl_PointSize = pxc * uRes;
        gl_Position = projectionMatrix * mv;
        float tw = 0.78 + 0.22 * sin(uTime * 2.6 + aSeed * 61.0);
        vA = uFade * smoothstep(0.0, 0.2, k) * cover * tw;
        vFlash = flash; vRel = r > 0.0 ? smoothstep(0.0, 0.35, r) : 0.0; vHot = aKind;
      }`,
    fragmentShader: `
      uniform vec3 cDev, cRel;
      varying float vA, vFlash, vRel, vHot;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float disc = smoothstep(1.0, 0.55, d);
        float core = smoothstep(0.55, 0.0, d);
        vec3 c = mix(cDev, cRel, max(vFlash, vRel * 0.5));
        c = c * (0.75 + 0.35 * core) + vec3(1.0) * core * (0.25 + vFlash * 0.45 + vHot * 0.15);
        gl_FragColor = vec4(c, disc * vA * (0.85 + vFlash * 0.3));
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 902;
  points.onBeforeRender = (renderer, scene, camera) => {
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    mat.uniforms.uScale.value = 1920 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    mat.uniforms.uRes.value = v.y / 1920;
  };
  return { points, nodes, towns };
}

// ---------------------------------------------------------------------------------------------
// relay arcs: a tree of hops from the bag outward, timed by relayT(distance)
// ---------------------------------------------------------------------------------------------
export function buildArcs(ctx, bag, nodes) {
  const { P, U } = ctx;
  const R = U.rng(4242);
  const sorted = [...nodes].sort((a, b) => a.d - b.d);
  const root = { p: new THREE.Vector3(bag.x, bag.y + 1, bag.z), d: 0 };
  const done = [root];
  const hops = [];
  for (const n of sorted) {
    let best = null, bd = Infinity;
    for (const c of done) {
      if (!(c.d < n.d * 0.72 && (c.d > n.d * 0.3 || c === root))) continue;
      const dd = c.p.distanceTo(n.p);
      if (dd < bd) { bd = dd; best = c; }
    }
    if (!best) for (const c of done) { const dd = c.p.distanceTo(n.p); if (c.d < n.d && dd < bd) { bd = dd; best = c; } }
    hops.push({ a: best, b: n, len: bd });
    done.push(n);
  }
  const pos = [], tan = [], side = [], along = [], times = [], idx = [];
  const SEG = 28;
  let base = 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  for (const h of hops) {
    A.copy(h.a.p); B.copy(h.b.p);
    C.copy(A).add(B).multiplyScalar(0.5); C.y += h.len * 0.14 + 5;
    const t0 = relayTime(h.a.d) + (R() - 0.5) * 0.03, t1 = Math.max(t0 + 0.12, relayTime(h.b.d));
    for (let i = 0; i <= SEG; i++) {
      const k = i / SEG;
      p.set(0, 0, 0).addScaledVector(A, (1 - k) * (1 - k)).addScaledVector(C, 2 * k * (1 - k)).addScaledVector(B, k * k);
      q.copy(C).sub(A).multiplyScalar(2 * (1 - k)).addScaledVector(B.clone().sub(C), 2 * k).normalize();
      for (const s of [-1, 1]) { pos.push(p.x, p.y, p.z); tan.push(q.x, q.y, q.z); side.push(s); along.push(k); times.push(t0, t1); }
      if (i < SEG) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    base += (SEG + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(times, 2));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uPx: { value: 0.0004 }, cLive: { value: new THREE.Color(P.live) } },
    vertexShader: `
      uniform float uTime, uPx;
      attribute vec3 aTan; attribute float aSide, aAlong; attribute vec2 aT;
      varying float vAlong, vHead, vAge, vEnd;
      void main() {
        vec3 vd = normalize(cameraPosition - position);
        vec3 sd = normalize(cross(aTan, vd));
        float depth = max(1.0, -(modelViewMatrix * vec4(position, 1.0)).z);
        float h = (uTime - aT.x) / max(aT.y - aT.x, 0.05);
        float age = uTime - (aT.x + aAlong * (aT.y - aT.x));
        float w = uPx * depth * (1.3 + 1.7 * exp(-max(age, 0.0) * 7.0));   // half width in px (1080 space): fat at the head
        vec3 p = position + sd * aSide * w;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vAlong = aAlong; vHead = h; vAge = age; vEnd = uTime - aT.y;
      }`,
    fragmentShader: `
      uniform float uFade; uniform vec3 cLive;
      varying float vAlong, vHead, vAge, vEnd;
      void main() {
        if (vHead <= 0.0 || vAlong > vHead) discard;
        float hot = exp(-max(vAge, 0.0) * 9.0);
        float a = 0.18 + 0.82 * exp(-max(vAge, 0.0) * 2.6);
        a *= 1.0 - 0.75 * smoothstep(0.0, 0.9, vEnd);                   // settle to a faint trace after landing
        vec3 c = mix(cLive, vec3(1.0), hot * 0.45) * (1.0 + hot * 0.4);
        gl_FragColor = vec4(c, a * uFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 903;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mat.uniforms.uPx.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / 1920;
  };
  return { mesh, hops };
}

// ---------------------------------------------------------------------------------------------
// veil: fullscreen dim drawn after the opaque world, before the dots
// ---------------------------------------------------------------------------------------------
export function buildVeil(ctx) {
  const { P } = ctx;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { color: { value: new THREE.Color(P.ink).lerp(new THREE.Color('#1d2a44'), 0.55) }, opacity: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform vec3 color; uniform float opacity; varying vec2 vP;
      void main(){ float r = length(vP * vec2(0.8, 0.62)); float a = opacity * mix(0.9, 1.1, smoothstep(0.25, 1.05, r));
        gl_FragColor = vec4(color, clamp(a, 0.0, 0.97));
        #include <colorspace_fragment>
      }`,
  });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  veil.frustumCulled = false; veil.renderOrder = 900;
  return veil;
}

// ---------------------------------------------------------------------------------------------
// bag marker: screen-sized blue beacon with a white ring, always on top
// ---------------------------------------------------------------------------------------------
export function buildMarker(ctx, { color, size = 64 } = {}) {
  const { P } = ctx;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uRelay: { value: 0 }, uRes: { value: 0.5 }, cBlue: { value: new THREE.Color(color || P.route) }, uSize: { value: size }, cLive: { value: new THREE.Color(P.live) } },
    vertexShader: `uniform float uRes, uRelay, uSize; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * (1.0 + 0.45 * uRelay) * uRes; }`,
    fragmentShader: `uniform float uAlpha, uTime, uRelay; uniform vec3 cBlue, cLive;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float halo = smoothstep(1.0, 0.3, d) * 0.35;
        float ring = smoothstep(0.62, 0.55, d) * smoothstep(0.38, 0.45, d);
        float core = smoothstep(0.42, 0.34, d);
        vec3 c = mix(cBlue, cLive, uRelay);
        vec3 col = c * halo + vec3(1.0) * ring + c * 1.25 * core;
        float a = max(max(halo, ring), core);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col / max(a, 0.001), a * uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const pt = new THREE.Points(geo, mat);
  pt.frustumCulled = false; pt.renderOrder = 906;
  pt.onBeforeRender = (renderer) => { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); mat.uniforms.uRes.value = v.y / 1920; };
  return pt;
}
