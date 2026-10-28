/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s01_lib.js - Helper module (route line, veil, fog, pin, projector)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: (helper, no line; used by s03_tiles and the original s01/s02)
 * Shows:
 *   Route strip ShaderMaterial (reveal head/tail, glowing head, a violet "future" zone that dissolves into blocky
 *   cells), route shadow, a fullscreen veil quad that flattens the busy city behind the infographics, distance-based
 *   city fog, map pin drop, minutes/clock along the route, world -> screen projector, golden-hour light grade.
 * Techniques to steal:
 *   - veil pattern: fullscreen quad drawn after the city (renderOrder), infographics drawn after it stay saturated
 *   - route reveal shader (head/tail uniforms, hot head that blooms)
 *   - cityFog(ctx, t, camDist): fog tightened on high wide shots
 *   - golden() touches ctx.sun / ctx.hemi: check the packaged core exposes them
 *
 * NOTE - written against the ORIGINAL per-reel core of the city reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   core/world.js + traffic.js -> '/engine/kits/city.js'. buildCity(ctx) returns the same world object, so read
 *                            ctx.city where this file reads ctx.world (e.g. `const { THREE, world, P, U } = ctx`
 *                            -> `const world = ctx.city`). ctx.traffic is unchanged. ctx.ribbonGeometry /
 *                            ctx.ribbonMaterial are exported from city.js and also on ctx.
 *   core/hud.js           -> ctx.hud: hud.eta(...) = alias of hud.card(...), hud.status(...) = alias of hud.chip(...),
 *                            hud.label(...), hud.big(...), hud.layer. Captions are automatic.
 *   palette               -> this file's P is the CITY palette = ctx.C in the packaged engine (route, live, slow, jam,
 *                            forecast, history, phone, ink, paper, ...). ctx.P there is the studio palette.
 *   core/util.js          -> ctx.U (same functions).
 *   TIMING: the seconds in the T / word tables below were locked to the original voiceover. Convert every one to a
 *   word cue (ctx.wordAt('word', spec.t0) or spec.cue('word', fallbackFraction)) when adapting.
 *   City scenes use absolute city coordinates (no spec.o station).
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// Shared helpers for s01_hook + s02_future (route line, pin, haze, projection, clock along the route).
import * as THREE from 'three';

// route line width in metres as a function of s: thin in the driveway, full on the roads
export function routeWidth(s) {
  return 3.2 + 6.3 * THREE.MathUtils.smoothstep(s, 4, 120);
}

// The route strip: reveal (tail..head), glowing head, and a "future" zone past `split` that turns
// violet and breaks up into blocky cells (dissolve) as `fut` goes 0 -> 1. Pure uniforms, no state.
export function routeMaterial(P, len) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: {
      cA: { value: new THREE.Color(P.route) },
      cG: { value: new THREE.Color(P.routeGlow) },
      cB: { value: new THREE.Color(P.forecast) },
      opacity: { value: 1 }, head: { value: 1 }, tail: { value: 0 },
      split: { value: 1 }, fut: { value: 0 }, headGlow: { value: 1 }, wk: { value: 0.42 },
      len: { value: len }, phase: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 cA, cG, cB; uniform float opacity, head, tail, split, fut, headGlow, len, phase, wk;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float u = vUv.x;
        if (u > head || u < tail) discard;
        float ay = abs(vUv.y * 2.0 - 1.0) / wk;
        if (ay > 1.0) discard;
        float across = 1.0 - smoothstep(0.8, 1.0, ay);
        float a = opacity * across;
        // white core line inside the blue band reads like a nav line
        vec3 c = mix(cA, cG, smoothstep(0.55, 0.0, ay) * 0.35);
        // head: hot white-blue tip that blooms
        float dm = (head - u) * len;            // metres behind the head
        float hk = headGlow * exp(-dm / 22.0) * step(head, 0.9995);
        c = mix(c, vec3(1.0), hk * 0.55) * (1.0 + 1.6 * hk);
        // future zone: violet, thinning out, dissolving in cells
        float f = smoothstep(split, split + 0.06, u) * fut;
        c = mix(c, cB, f);
        float far = smoothstep(split, 1.0, u);
        vec2 cell = floor(vec2(u * len / 7.0, vUv.y * 3.0 / wk));
        float n = hash(cell);
        float d = f * (0.25 + 0.75 * far);
        a *= step(d, n * 0.98 + 0.02);
        a *= 1.0 - 0.55 * f * far;
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
}

export function makeRouteMesh(ctx) {
  const { THREE: T, world, P } = ctx;
  const route = world.paths.route, L = route.length;
  const g = ctx.ribbonGeometry(route, 0, L, 1, { dy: 0.22, step: 2, profile: (k) => routeWidth(k * L) * ROUTE_GEO });
  const m = new T.Mesh(g, routeMaterial(P, L));
  m.renderOrder = RO.route; m.frustumCulled = false;
  return m;
}
// geometry is ROUTE_GEO x routeWidth wide; uniform wk picks the visible fraction of it
export const ROUTE_GEO = 4.0;
// render orders: everything we want crisp over the city is drawn AFTER the veil (950)
export const RO = { veil: 950, shadow: 1001, route: 1002, sweep: 1003, motes: 1004, haze: 1005, pin: 1006, you: 1007, tiles: 1010, glint: 1015, badge: 1020 };

// soft dark shadow under the route: separates the blue line from the busy city when seen from high up
export function makeRouteShadow(ctx) {
  const { world, P } = ctx;
  const route = world.paths.route, L = route.length;
  const g = ctx.ribbonGeometry(route, 0, L, 1, { dy: 0.15, step: 2, profile: (k) => routeWidth(k * L) * 8.0 });
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { color: { value: new THREE.Color(P.ink) }, opacity: { value: 0 }, head: { value: 1 }, tail: { value: 0 }, split: { value: 1 }, fut: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 color; uniform float opacity, head, tail, split, fut; varying vec2 vUv;
      void main(){
        float u = vUv.x; if (u > head || u < tail) discard;
        float ay = abs(vUv.y * 2.0 - 1.0);
        float a = opacity * pow(max(1.0 - ay, 0.0), 1.6) * smoothstep(0.0, 0.004, head - u + 0.004);
        a *= 1.0 - 0.85 * smoothstep(split, split + 0.06, u) * fut;
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  }));
  m.renderOrder = RO.shadow; m.frustumCulled = false;
  return m;
}

// ---- the readability veil for the high wide shots (s01 crane -> s04 dive) ----
// A fullscreen quad drawn after the city (renderOrder 950, no depth test) that flattens the busy blocks
// towards warm paper (stronger towards the far/top of frame) with a soft darker vignette. Route, pins and
// tiles render after it (RO.* > 950) so they stay saturated. One singleton, opacity is a pure function of t.
let _veil = null;
export function veilAmount(ctx, t) {
  const U = ctx.U;
  return U.smooth(U.inv(1.9, 2.9, t)) * (1 - U.smoother(U.inv(15.45, 16.2, t)));
}
export function updateVeil(ctx, t) {
  if (!_veil) {
    _veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { paper: { value: new THREE.Color(ctx.P.buildings[7]) }, ink: { value: new THREE.Color(ctx.P.ink) }, amt: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform vec3 paper, ink; uniform float amt; varying vec2 vP;
        void main(){
          float a = mix(0.12, 0.36, smoothstep(-0.9, 0.95, vP.y));
          float vig = 0.20 * smoothstep(0.7, 1.5, length(vP * vec2(1.05, 0.85)));
          float A = a + vig;
          gl_FragColor = vec4(mix(paper, ink, vig / max(A, 1e-3)), A * amt);
          #include <colorspace_fragment>
        }`,
    }));
    _veil.frustumCulled = false; _veil.renderOrder = RO.veil;
    ctx.scene.add(_veil);
  }
  const a = veilAmount(ctx, t);
  _veil.visible = a > 0.001;
  _veil.material.uniforms.amt.value = a;
  return a;
}

// fog for our window: a warm close haze in the opening (city melts into the sky behind the house),
// then a strong depth fog on the high wide shots so the far city recedes. d = camera->target distance.
const _fogC = new THREE.Color();
export function cityFog(ctx, t, d) {
  const U = ctx.U;
  const fO = 1 - U.smooth(U.inv(1.2, 2.6, t));
  const fW = U.smooth(U.inv(2.0, 3.2, t)) * (1 - U.smoother(U.inv(15.3, 16.4, t)));
  if (t > 16.4) return;
  let near = U.lerp(Math.max(200, d * 1.6), d * 1.05, fW), far = U.lerp(d * 6 + 1800, d * 4.2, fW);
  near = U.lerp(near, 72, fO); far = U.lerp(far, 250, fO);
  _fogC.set(ctx.P.fog).lerp(new THREE.Color(ctx.P.skyHorizon), fO);
  ctx.fog = { near, far, color: _fogC };
}

// soft radial sprite texture (deterministic)
let _radial = null;
export function radialTexture() {
  if (_radial) return _radial;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)');
  gr.addColorStop(0.7, 'rgba(255,255,255,.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _radial = new THREE.CanvasTexture(c); _radial.colorSpace = THREE.SRGBColorSpace;
  return _radial;
}

// destination pin: beam + glowing bead + flat ring, sitting on the destination tower
export function makePin(ctx) {
  const { THREE: T, P, world } = ctx;
  const g = new T.Group();
  const top = world.landmarks.destTop;
  g.position.set(top.x, top.y, top.z);
  const bright = (c, k) => new T.Color(c).multiplyScalar(k);
  const beam = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 1, 12, 1, true), new T.MeshBasicMaterial({ color: bright(P.routeGlow, 1.2), transparent: true, opacity: 0.55, depthWrite: false }));
  beam.geometry.translate(0, 0.5, 0);
  const bead = new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.MeshBasicMaterial({ color: bright(P.routeGlow, 1.7), transparent: true }));
  const ring = new T.Mesh(new T.RingGeometry(0.86, 1, 64), new T.MeshBasicMaterial({ color: bright(P.routeGlow, 1.5), transparent: true, side: T.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  const ring2 = ring.clone(); ring2.material = ring.material.clone();
  const halo = new T.Sprite(new T.SpriteMaterial({ map: radialTexture(), color: P.route, transparent: true, depthWrite: false, opacity: 0.5 }));
  g.add(beam, bead, ring, ring2, halo);
  g.userData = { beam, bead, ring, ring2, halo };
  return g;
}
// k: 0..1 born, tHit: seconds since impact (for the ring burst), breathe: idle t
export function setPin(pin, k, tHit, t, scale = 1) {
  const { beam, bead, ring, ring2, halo } = pin.userData;
  pin.visible = k > 0.001;
  if (!pin.visible) return;
  const sp = Math.max(0, k);
  beam.scale.set(scale, 46 * sp * scale, scale);
  beam.material.opacity = 0.5 * Math.min(1, k);
  bead.position.y = 46 * sp * scale;
  bead.scale.setScalar(5.2 * scale * Math.min(1, k * 1.2));
  halo.position.y = bead.position.y; halo.scale.setScalar(44 * scale * Math.min(1, k)); halo.material.opacity = 0.45 * Math.min(1, k);
  // impact ring + slow breathing ring
  const h = Math.max(0, tHit);
  const r1 = 1 - Math.pow(1 - Math.min(1, h / 1.1), 3);
  ring.scale.setScalar(scale * (6 + 70 * r1)); ring.material.opacity = tHit > 0 ? 0.9 * (1 - r1) : 0;
  const ph = ((t * 0.55) % 1 + 1) % 1;
  ring2.scale.setScalar(scale * (8 + 40 * ph)); ring2.material.opacity = 0.5 * (1 - ph) * Math.min(1, k);
}

// minutes along the route at s (piecewise by the 8 segments' minutes)
export function minutesAt(world, s) {
  let m = 0;
  for (const g of world.segments) m += g.minutes * THREE.MathUtils.clamp((s - g.s0) / (g.s1 - g.s0), 0, 1);
  return m;
}
export function sAtMinutes(world, min) {
  let acc = 0;
  for (const g of world.segments) {
    if (acc + g.minutes >= min) return g.s0 + (g.s1 - g.s0) * ((min - acc) / g.minutes);
    acc += g.minutes;
  }
  return world.paths.route.length;
}
export function clockText(minFrom619) {
  const tot = 19 + Math.floor(minFrom619 + 1e-6);
  return `6:${String(tot).padStart(2, '0')}`;
}

// private camera for projecting points in update() (main applies the camera after update)
export function projector(ctx) {
  const cam = new ctx.THREE.PerspectiveCamera(35, 1080 / 1920, 0.5, 9000);
  const v = new ctx.THREE.Vector3();
  return {
    set(p) {
      cam.position.set(...p.pos); cam.fov = p.fov ?? 35; cam.updateProjectionMatrix();
      cam.up.set(0, 1, 0); cam.lookAt(...p.target);
      if (p.roll) cam.rotateZ(ctx.THREE.MathUtils.degToRad(p.roll));
      cam.updateMatrixWorld();
    },
    project(p) { v.copy(p).project(cam); return { x: (v.x + 1) / 2 * 1080, y: (1 - v.y) / 2 * 1920, behind: v.z > 1 }; },
    dist(p) { return cam.position.distanceTo(p); },
  };
}

// golden hour grade for our window (restored outside it as a pure function of t).
// m = 0..1 hands the key light to our own low sun (long shadows in the opening), see s01_hook.
export function golden(ctx, k, store, m = 0) {
  if (!store.sun) { store.sun = ctx.sun.color.clone(); store.sunI = ctx.sun.intensity; store.hemiI = ctx.hemi.intensity; store.warm = store.sun.clone().lerp(new ctx.THREE.Color(ctx.P.slow), 0.2); }
  ctx.sun.color.copy(store.sun).lerp(store.warm, k);
  ctx.sun.intensity = store.sunI * (1 + 0.12 * k) * (1 - m);
  ctx.hemi.intensity = store.hemiI * (1 - 0.22 * k + 0.12 * m);
}
