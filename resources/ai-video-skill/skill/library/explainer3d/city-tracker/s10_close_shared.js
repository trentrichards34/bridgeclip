/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-tracker/s10_close_shared.js - Time of flight + arrow UI (42.5-52.8 s)
 * Look: city + gadgets (same paper city, units m, tracker/suitcase/people props)
 * Original spoken line: "When you get close, the tracker uses something more precise. / Ultra Wideband measures how long the signal takes to travel, so your phone gets not just "nearby" but "four meters, to your left," and shows the arrow."
 * Shows:
 *   Dive down a street canyon to a lobby; YOU walk along the sidewalk, phone in hand; dolly in through the door to
 *   the bag (x-ray); soft rings snap into sharp white pulses on "more precise"; one pulse flies tag -> phone with a
 *   nanosecond counter riding it and a floor ruler counting; "nearby" = a fuzzy blob around you that collapses into
 *   a crisp "4 m" line + chevrons pointing left; push into the phone, the finder screen pops the arrow.
 * Techniques to steal:
 *   - visual language switch: soft rings -> sharp fast pulses = "more precise"
 *   - time-of-flight pulse: head + streak + glow + dotted 3D path, counter label riding it (ns)
 *   - fuzzy blob ShaderMaterial (uSharp 0..1) collapsing to a point; dashed ruler ribbon counting along
 *   - drawMapScreen -> drawArrowScreen on the handset; hermite camera blended into a head-relative pose for the push into the phone
 *   - walk with constant speed then a linear brake to a stop; foreground parallax props (bollards)
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
// s10_close (42.5-45.5) + s11_uwb (45.5-52.8): one continuous shot sequence at the hotel lobby.
//   s10 "When you get close, the tracker uses something more precise."
//     dive down the downtown street canyon into the lobby front; YOU walk along the sidewalk, phone in hand
//     ("close" 43.07: card → nearby, "you" label); the camera dollies in through the open door to the bag
//     ("tracker" 43.67: x-ray, the tag glows); "more precise" 44.79: the soft Bluetooth rings snap into sharp, fast
//     white pulses (a different language: thin, crisp, quick).
//   s11 "Ultra Wideband measures how long the signal takes to travel, so your phone gets not just "nearby" but
//     "four meters, to your left," and shows the arrow."
//     pull back out through the door, up behind you ("Ultra Wideband" 45.59 label); one pulse flies tag → phone
//     with a nanosecond counter riding it, the floor ruler counting along ("measures … travel" 46.39-47.99);
//     "nearby" 49.5: a fuzzy blob around you; "four meters" 50.47: the blob collapses onto the bag, a crisp
//     line draws with "4 m", chevrons point left ("to your left" 51.1-51.42); "shows the arrow" 51.98: push into
//     your phone, our finder screen pops the arrow (−81°, i.e. left), card "4 m · to your left".
// Pure function of t. The two scene files share this module; exactly one of them drives it per frame.
import * as THREE from 'three';
import { makeSuitcase, makeTracker, makePerson, makeHandset, drawMapScreen, drawArrowScreen, pulseRings,
  makeHotelLobby, linePath, fade, initLib } from './lib.js';

// ---- word times (build/words_final.json) ----
export const W = {
  when: 42.59, close: 43.07, the: 43.425, tracker: 43.665, uses: 44.145, something: 44.465, more: 44.785, precise: 45.025,
  ultra: 45.585, wideband: 45.905, measures: 46.385, how: 46.785, long: 47.025, signal: 47.345, takes: 47.585, travel: 47.985,
  so: 48.465, phone: 48.705, gets: 48.945, not: 49.185, nearby: 49.505, but: 50.385, four: 50.465, meters: 50.785,
  to: 51.105, your: 51.265, left: 51.425, and: 51.745, shows: 51.985, arrow: 52.385,
};
export const SPLIT = 45.5;            // s10 drives t < SPLIT, s11 drives t >= SPLIT
const SHOW_A = 41.95, SHOW_B = 53.3;  // own objects visible (s10 blend in 1.1, s12 blend out 1.0)
const NS = 13.3;                       // 4 m at light speed ≈ 13.3 ns
const ANGLE = -81;                     // bag direction relative to your heading (deg, − = left)
const UWB = '#fbf8f2';                 // sharp UWB pulses: white-hot (paper + glow), vs the soft phone-blue Bluetooth rings

// ---- the walk: along the lobby front (sidewalk, heading +x), stop 4.0 m from the bag, bag on your left ----
const WALK_V = 1.45, WALK_D = 1.4, T_STOP = 47.8;

let S = null;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion();

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// fuzzy "nearby" blob → crisp point (uSharp 0..1)
const BLOB_VS = 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const BLOB_FS = `
  uniform vec3 color; uniform float uAlpha, uTime, uSharp;
  varying vec2 vP;
  void main(){
    float ang = atan(vP.y, vP.x);
    float r = length(vP);
    float wob = (0.045 * sin(5.0 * ang + uTime * 1.3) + 0.03 * sin(9.0 * ang - uTime * 2.1) + 0.02 * sin(14.0 * ang + uTime * 0.7)) * (1.0 - uSharp);
    float rr = r + wob;
    float body = (1.0 - smoothstep(0.0, 0.95, rr)) * mix(0.38, 0.6, uSharp);
    float rim = exp(-pow((rr - 0.8) / mix(0.12, 0.03, uSharp), 2.0)) * 0.5;
    float a = (body + rim) * (1.0 - smoothstep(0.96, 1.0, r));
    if (a < 0.003) discard;
    gl_FragColor = vec4(color * (1.0 + 0.35 * rim), a * uAlpha);
    #include <colorspace_fragment>
  }`;

// Hermite spline through keys [t, [..values]] (velocity continuous, so the camera never parks)
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
    const m1 = i > 0 ? ((p2[j] - p0[j]) / (t2 - t0)) * dt : 0;
    const m2 = i + 2 < n ? ((p3[j] - p1[j]) / (t3 - t1)) * dt : 0;
    return h00 * a + h10 * m1 + h01 * p2[j] + h11 * m2;
  });
}

export function initShared(ctx) {
  if (S) return S;
  initLib(ctx);
  const { P } = ctx;
  const root = new THREE.Group(); root.name = 's10s11'; root.visible = false; ctx.scene.add(root);

  // set: our own lobby + the hero bag with its tracker (same lib models as s08/s09)
  const lobby = makeHotelLobby(ctx); root.add(lobby);
  const bag = makeSuitcase(ctx); lobby.userData.bagSlot.add(bag);
  const tag = makeTracker(ctx, { scale: 0.09 }); bag.userData.tagSlot.add(tag);
  const haloM = new THREE.MeshBasicMaterial({ color: new THREE.Color(UWB).multiplyScalar(1.6), transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 72), haloM);
  halo.rotation.x = Math.PI / 2; halo.renderOrder = 13; tag.add(halo);
  root.updateMatrixWorld(true);
  const B = new THREE.Vector3(); bag.getWorldPosition(B);             // bag foot (lobby floor top)
  const TAG = new THREE.Vector3(); tag.getWorldPosition(TAG);         // tracker centre
  const bagFront = new THREE.Vector3(0, 0, 1).applyQuaternion(bag.getWorldQuaternion(q1)).setY(0).normalize();

  // you: heading +x along the lobby front; at the stop the bag is 4.0 m away at ANGLE (left)
  const a = THREE.MathUtils.degToRad(ANGLE);                        // heading +x: ahead = +x, left = −z
  const ahead = 4.0 * Math.cos(a), left = -4.0 * Math.sin(a);
  const SIDEWALK_Y = 0.25;
  const E = new THREE.Vector3(B.x - ahead, SIDEWALK_Y, B.z + left);   // your stop (feet)
  const walkPath = linePath([[E.x - 7.7, SIDEWALK_Y, E.z + 0.35], [E.x - 3.8, SIDEWALK_Y, E.z + 0.05], [E.x, SIDEWALK_Y, E.z]]);
  const L = walkPath.length;
  const T_DEC = T_STOP - WALK_D;
  const T0 = T_DEC - (L - (WALK_V * WALK_D) / 2) / WALK_V;
  const you = makePerson(ctx, { seed: 4, phone: true, phoneIn: 'hand', color: P.route });
  root.add(you);
  you.userData.phone.visible = false;                                 // swap the lib's plain phone for a live screen
  const hand = you.userData.arms[0].hand;
  const phone = makeHandset(ctx, { w: 0.082 });
  phone.position.set(0, -0.047, 0.082); phone.rotation.set(-0.49, 0, Math.PI);   // lib's hand pose, nudged so the palm sits behind the screen
  hand.add(phone);

  // soft Bluetooth rings (the film's beacon language) → sharp UWB pulses
  const soft = pulseRings(ctx, { color: P.phone, maxR: 2.6, count: 3, period: 1.6, fill: 0.3, glow: 1.1 });
  const sharpFloor = pulseRings(ctx, { color: UWB, maxR: 1.7, count: 4, period: 0.55, width: 0.02, fill: 0, glow: 1.1 });
  const sharpTag = pulseRings(ctx, { color: UWB, maxR: 0.5, count: 4, period: 0.42, width: 0.009, fill: 0, glow: 1.5, mode: 'billboard' });
  const sharpPhone = pulseRings(ctx, { color: UWB, maxR: 0.32, count: 4, period: 0.42, width: 0.007, fill: 0, glow: 1.5, mode: 'billboard' });
  root.add(soft.group, sharpFloor.group, sharpTag.group, sharpPhone.group);
  // one-off snap ring on "more precise"
  const snapM = new THREE.MeshBasicMaterial({ color: new THREE.Color(UWB).multiplyScalar(2.0), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const snap = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 96), snapM); snap.rotation.x = -Math.PI / 2; snap.renderOrder = 9; root.add(snap);

  const gTex = glowTex();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: UWB, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  glow.renderOrder = 12; root.add(glow);

  // time-of-flight pulse: bright head + streak + glow, and a dotted 3D path tag ↔ phone
  const headM = new THREE.MeshBasicMaterial({ color: new THREE.Color(UWB).multiplyScalar(2.2), transparent: true, depthWrite: false });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), headM); head.renderOrder = 14; root.add(head);
  const streakG = new THREE.CylinderGeometry(0.0, 0.016, 1, 10, 1, true); streakG.translate(0, -0.5, 0); streakG.rotateX(Math.PI / 2);   // tip at origin, tail along −z
  const streakM = new THREE.MeshBasicMaterial({ color: new THREE.Color(UWB).multiplyScalar(1.8), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const streak = new THREE.Mesh(streakG, streakM); streak.renderOrder = 14; root.add(streak);
  const headGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: UWB, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  headGlow.renderOrder = 13; root.add(headGlow);
  const NDOT = 34;
  const dotM = new THREE.MeshBasicMaterial({ color: new THREE.Color(UWB).multiplyScalar(1.3), transparent: true, opacity: 0, depthWrite: false });
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 8, 6), dotM, NDOT); dots.renderOrder = 12; dots.frustumCulled = false; root.add(dots);

  // floor: ruler (dashed, counting with the pulse) + the crisp measured line, chevrons, reticle on the bag
  const fl = linePath([[E.x, 0.275, E.z], [E.x + (B.x - E.x) * 0.45, 0.285, E.z + (B.z - E.z) * 0.45], [B.x, 0.322, B.z]]);
  const flLen = fl.length;
  const rulerM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { color: { value: new THREE.Color(P.paper) }, opacity: { value: 0 }, from: { value: 0 }, to: { value: 1 }, len: { value: flLen } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 color; uniform float opacity, from, to, len; varying vec2 vUv;
      void main(){
        if (vUv.x < from || vUv.x > to) discard;
        float m = (1.0 - vUv.x) * len;                       // metres from the bag
        float across = abs(vUv.y * 2.0 - 1.0);
        float minor = step(fract(m / 0.25 + 0.03), 0.06) * step(across, 0.45);
        float major = step(fract(m + 0.012), 0.024) * 1.0;
        float a = max(minor * 0.8, major);
        if (a < 0.01) discard;
        gl_FragColor = vec4(color * 1.3, a * opacity);
        #include <colorspace_fragment>
      }` });
  const ruler = new THREE.Mesh(ctx.ribbonGeometry(fl, 0, flLen, 0.3, { dy: 0.012, step: 0.1 }), rulerM); ruler.renderOrder = 9; root.add(ruler);
  const rulerSpine = new THREE.Mesh(ctx.ribbonGeometry(fl, 0, flLen, 0.035, { dy: 0.014, step: 0.1 }), ctx.ribbonMaterial(P.paper, { opacity: 0, glow: 0.3 }));
  rulerSpine.renderOrder = 9; root.add(rulerSpine);
  const line = new THREE.Mesh(ctx.ribbonGeometry(fl, 0.35, flLen - 0.3, 0.09, { dy: 0.018, step: 0.1 }), ctx.ribbonMaterial(P.route, { opacity: 0, glow: 0.9, edge: 0.3 }));
  line.renderOrder = 10; root.add(line);
  const chevG = (() => { const s = new THREE.Shape(); s.moveTo(0.16, 0); s.lineTo(-0.07, 0.15); s.lineTo(-0.02, 0); s.lineTo(-0.07, -0.15); s.closePath(); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return g; })();
  const chevs = [0.22, 0.34, 0.46].map((k) => {
    const m = new THREE.Mesh(chevG, new THREE.MeshBasicMaterial({ color: new THREE.Color(P.route).multiplyScalar(1.5), transparent: true, opacity: 0, depthWrite: false }));
    const p = fl.at(flLen * k); const tg = fl.tangent(flLen * k);
    m.position.set(p.x, p.y + 0.024, p.z); m.rotation.y = Math.atan2(-tg.z, tg.x); m.renderOrder = 11; root.add(m); return m;
  });
  const retM = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.route).multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const ret = new THREE.Group(); ret.position.set(B.x, B.y + 0.02, B.z); root.add(ret);
  const retRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.47, 64), retM); retRing.rotation.x = -Math.PI / 2; retRing.renderOrder = 11; ret.add(retRing);
  for (let i = 0; i < 4; i++) { const tk = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.16), retM); tk.rotation.x = -Math.PI / 2; const an = i * Math.PI / 2; tk.position.set(Math.cos(an) * 0.56, 0, Math.sin(an) * 0.56); tk.rotation.z = -an + Math.PI / 2; tk.renderOrder = 11; ret.add(tk); }

  const blobM = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(P.phone) }, uAlpha: { value: 0 }, uTime: { value: 0 }, uSharp: { value: 0 } },
    vertexShader: BLOB_VS, fragmentShader: BLOB_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 128), blobM); blob.rotation.x = -Math.PI / 2; blob.renderOrder = 8; root.add(blob);

  // foreground parallax on the street: bollards along the curb
  const bolM = new THREE.MeshStandardMaterial({ color: '#3b4048', roughness: 0.5 });
  const bolG = new THREE.CylinderGeometry(0.11, 0.13, 0.95, 16);
  for (const x of [623.2, 628.9, 632.8, 636.6]) { const b = new THREE.Mesh(bolG, bolM); b.position.set(x, 0.72, -314.6); b.castShadow = true; root.add(b);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), bolM); cap.position.set(x, 1.195, -314.6); root.add(cap); }

  S = { root, lobby, bag, tag, halo, haloM, B, TAG, bagFront, E, walkPath, L, T0, T_DEC, you, phone, soft, sharpFloor, sharpTag, sharpPhone,
    snap, snapM, glow, head, headM, streak, streakM, headGlow, dots, dotM, NDOT, fl, flLen, ruler, rulerSpine, line, chevs, ret, retM, blob, blobM,
    phoneW: new THREE.Vector3(), mat4: new THREE.Matrix4() };
  // final phone pose (you stand still after T_STOP) for the push-in
  poseYou(ctx, T_STOP + 1);
  const PW = phone.getWorldPosition(new THREE.Vector3());
  const PQ = phone.getWorldQuaternion(new THREE.Quaternion());
  S.phoneEnd = PW; S.phoneN = new THREE.Vector3(0, 0, 1).applyQuaternion(PQ); S.phoneUp = new THREE.Vector3(0, 1, 0).applyQuaternion(PQ);
  S.headEnd = you.userData.head.getWorldPosition(new THREE.Vector3());
  S.keys = buildKeys(ctx);
  return S;
}

// distance walked: constant speed, then a linear brake to a stop at T_STOP
function walkS(t) {
  const { T0, T_DEC, L } = S;
  if (t <= T0) return 0;
  if (t <= T_DEC) return WALK_V * (t - T0);
  const u = Math.min(t - T_DEC, WALK_D);
  return Math.min(L, WALK_V * (T_DEC - T0) + WALK_V * (u - (u * u) / (2 * WALK_D)));
}
function poseYou(ctx, t) {
  const { you, walkPath } = S;
  const s = walkS(t);
  const p = walkPath.at(s), tg = walkPath.tangent(s);
  you.position.copy(p);
  you.rotation.set(0, Math.atan2(tg.x, tg.z), 0);
  const speed = t < S.T_DEC ? 1 : Math.max(0, 1 - (t - S.T_DEC) / WALK_D);
  const amp = (t < S.T0 ? 0 : 1) * ctx.U.smooth(Math.min(1, speed * 1.15));
  you.userData.gait(s / 1.45, amp);
  you.updateMatrixWorld(true);
}

function buildKeys(ctx) {
  const { TAG, E, phoneEnd, headEnd } = S;
  const tg = [TAG.x, TAG.y, TAG.z];
  const mid = [(TAG.x + E.x) / 2, 0.7, (TAG.z + E.z) / 2];
  const ph = [phoneEnd.x, phoneEnd.y, phoneEnd.z];
  const H = headEnd;                                   // you face +x: behind = −x, right = +z
  const K = (t, pos, target, fov) => [t, [...pos, ...target, fov]];
  // walker position at a time (for the tracking shot)
  const wx = (t) => S.walkPath.at(walkS(t)).x;
  return [
    // s10: dive down the street canyon from the east (s09's far camera blends in until 43.05), land low on the street
    // side and track you (bollards slide past in the foreground), pan to the bag through the glass on "the tracker",
    // dolly in through the open door and settle on the bag for the switch to sharp pulses
    K(41.95, [900, 520, -300], [650, 0, -314], 40),
    K(42.5, [770, 200, -309], [640, 1, -315], 40),
    K(43.0, [672, 30, -310], [632, 2, -316], 39),
    K(43.27, [640, 4.2, -311.4], [wx(43.27) + 1.0, 1.3, -316.8], 38),
    K(43.55, [wx(43.55) + 2.9, 1.35, -312.1], [wx(43.55) + 0.4, 1.1, -316.9], 37),
    K(43.85, [wx(43.85) + 3.1, 1.3, -312.4], [wx(43.85) + 2.2, 0.95, -318.4], 37),
    K(44.2, [629.75, 1.22, -314.9], [630.95, 0.75, -320.3], 36),
    K(44.6, [630.25, 1.08, -317.7], tg, 35),
    K(45.0, [630.35, 1.3, -318.9], [tg[0], 0.55, tg[2]], 38),
    K(45.5, [630.45, 1.22, -319.1], [tg[0], 0.55, tg[2]], 36),
    // s11: pull back out through the door, cranes up over the sidewalk; measuring view looks down the tag → you line
    K(46.0, [630.3, 1.7, -317.4], [TAG.x - 0.15, 0.72, TAG.z + 0.6], 37),
    K(46.65, [630.25, 4.7, -313.0], mid, 40),
    K(48.3, [629.65, 5.5, -312.0], [mid[0], 0.62, mid[2] - 0.1], 41),
    // "nearby" → "four meters": high over the sidewalk, the whole blob in frame, you at the bottom, the bag at the top
    K(49.35, [629.7, 7.6, -309.6], [630.9, 0.3, -319.3], 43),
    K(50.9, [630.1, 7.9, -309.9], [630.95, 0.3, -319.5], 42),
    // "to your left": down behind you (your left = screen left, the bag top-left), then push into the phone
    K(51.5, [627.9, 3.8, -315.0], [630.7, 0.7, -318.2], 40),
    K(51.8, [630.25, 2.25, -316.0], [630.9, 1.3, -316.9], 34),
    K(52.1, [H.x - 0.3, H.y + 0.12, H.z + 0.22], ph, 30),
    K(53.3, [H.x - 0.23, H.y + 0.08, H.z + 0.17], ph, 28),
  ];
}

export function cameraShared(ctx, t) {
  if (!S) return null;
  const { U } = ctx;
  const tc = U.clamp(t, SHOW_A, SHOW_B);
  const k = spline(S.keys, tc).slice();
  // the push lands on the live phone: blend the spline into an exact head-relative pose looking at the phone
  const wl = U.smoother(U.inv(51.55, 52.1, tc));
  if (wl > 0) {
    poseYou(ctx, tc);
    const ph = S.phone.getWorldPosition(v1);
    const kk = U.smooth(U.inv(52.1, 53.3, tc));
    const n = v2.set(0, 0, 1).applyQuaternion(S.phone.getWorldQuaternion(q1));
    const dd = U.lerp(0.52, 0.45, kk);
    const pos = [ph.x + n.x * dd, ph.y + n.y * dd, ph.z + n.z * dd];
    for (let j = 0; j < 3; j++) { k[j] = U.lerp(k[j], pos[j], wl); k[3 + j] = U.lerp(k[3 + j], [ph.x, ph.y, ph.z][j], wl); }
    k[6] = U.lerp(k[6], U.lerp(30, 28, kk), wl);
  }
  const d = 0.04 * U.clamp(1 - U.inv(51.3, 51.9, tc));        // handheld drift (fades for the screen push)
  return { pos: [k[0] + d * U.drift(t, 1), k[1] + d * U.drift(t, 2), k[2] + d * U.drift(t, 3)], target: [k[3], k[4], k[5]], fov: k[6], roll: 0 };
}

export function updateShared(ctx, t) {
  const { U, P, hud } = ctx;
  const vis = t > SHOW_A && t < SHOW_B;
  S.root.visible = vis;
  // near plane: our phone push gets close (restore only what we set)
  const NEAR = 0.0601;
  if (vis && t > 51.2) ctx.camera.near = NEAR;
  else if (ctx.camera.near === NEAR) ctx.camera.near = 0.5;
  if (!vis) return;

  poseYou(ctx, t);
  S.phone.getWorldPosition(S.phoneW);
  const PH = S.phoneW, TAG = S.TAG, B = S.B, E = S.E;
  const fadeOut = 1 - U.smooth(U.inv(52.9, 53.3, t));

  // ---- the bag: x-ray from "tracker" so the tag reads; solid again for the 4 m reveal ----
  const xr = U.smooth(U.inv(43.6, 44.0, t)) * (1 - U.smooth(U.inv(49.6, 50.2, t)));
  fade(S.bag.userData.shell, 1 - 0.58 * xr);
  S.bag.userData.contents.visible = xr > 0.02;
  ctx.exposure = 1.02 + 0.1 * xr * U.inv(44.0, 44.5, t) * (1 - U.inv(45.6, 46.2, t));

  // ---- soft Bluetooth rings → sharp UWB pulses on "more precise" ----
  const softA = U.smooth(U.inv(42.2, 42.8, t)) * (1 - U.smooth(U.inv(W.more - 0.05, W.more + 0.2, t)));
  S.soft.update(t, [B.x, B.y + 0.02, B.z], 0.9 * softA);
  const sharpA = U.smooth(U.inv(W.more - 0.02, W.more + 0.12, t)) * fadeOut;
  const sharpDim = 1 - 0.55 * U.smooth(U.inv(46.3, 46.8, t)) * (1 - U.smooth(U.inv(48.0, 48.4, t)));   // calmer while the single pulse flies
  S.sharpFloor.update(t, [B.x, B.y + 0.025, B.z], 0.6 * sharpA * sharpDim * (1 - 0.7 * U.smooth(U.inv(49.3, 49.8, t))));
  S.sharpTag.update(t, TAG, 0.8 * sharpA * sharpDim);
  S.sharpPhone.update(t, PH, U.smooth(U.inv(45.6, 46.0, t)) * sharpDim * fadeOut * (1 - U.smooth(U.inv(51.3, 51.6, t))));
  // snap: a fast crisp ring out of the bag on "more"
  const ks = U.inv(W.more, W.more + 0.55, t);
  S.snap.visible = ks > 0 && ks < 1;
  S.snap.position.set(B.x, B.y + 0.03, B.z); S.snap.scale.setScalar(0.2 + 3.2 * U.expoOut(ks));
  S.snapM.opacity = Math.pow(1 - ks, 1.5);
  // glow + halo at the tag
  const pulse = Math.pow(1 - (((t - W.more) / 0.42) % 1 + 1) % 1, 3);
  const gA = Math.max(U.win(t, 43.6, 49.8, 0.3, 0.4) * (0.35 + 0.25 * softA), sharpA * (0.4 + 0.45 * pulse) * (1 - 0.5 * U.smooth(U.inv(49.6, 50.2, t))));
  S.glow.position.copy(TAG).addScaledVector(S.bagFront, 0.04);
  S.glow.material.opacity = gA * 0.5; S.glow.scale.setScalar(0.13 + 0.06 * pulse * sharpA);
  S.glow.material.color.set(sharpA > 0.5 ? UWB : P.phone);
  S.haloM.opacity = U.win(t, 43.6, 49.8, 0.3, 0.4) * (0.25 + 0.2 * sharpA);

  // ---- time of flight: one pulse tag → phone, counter riding it ----
  const T_FLY0 = 46.85, T_FLY1 = 47.95;
  const kf = U.inv(T_FLY0, T_FLY1, t);
  const flying = t > T_FLY0 - 0.05 && t < T_FLY1 + 0.25;
  const dir = v1.copy(PH).sub(TAG); const dLen = dir.length(); dir.normalize();
  const kE = U.easeInOut(kf) * 0.15 + kf * 0.85;               // nearly constant speed (light doesn't ease), soft ends
  const hp = v2.copy(TAG).addScaledVector(dir, dLen * kE);
  const flyA = U.smooth(U.inv(T_FLY0 - 0.05, T_FLY0 + 0.05, t)) * (1 - U.smooth(U.inv(T_FLY1, T_FLY1 + 0.25, t)));
  S.head.visible = S.streak.visible = S.headGlow.visible = flying && flyA > 0.01;
  if (S.head.visible) {
    S.head.position.copy(hp); S.headM.opacity = flyA;
    S.headGlow.position.copy(hp); S.headGlow.scale.setScalar(0.2); S.headGlow.material.opacity = 0.7 * flyA;
    S.streak.position.copy(hp); S.streak.lookAt(v1.copy(hp).add(dir));
    S.streak.scale.set(1, 1, Math.max(0.01, Math.min(0.55, dLen * kE))); S.streakM.opacity = 0.8 * flyA;
  }
  const dotA = U.win(t, 46.5, 49.4, 0.35, 0.4);
  S.dots.visible = dotA > 0.01;
  if (S.dots.visible) {
    S.dotM.opacity = 0.75 * dotA;
    for (let i = 0; i < S.NDOT; i++) {
      const kk = (i + 0.5) / S.NDOT;
      const passed = U.clamp((kE - kk) * 6 + 0.0) * (t > T_FLY0 ? 1 : 0);
      const near = Math.exp(-Math.pow((kk - kE) * 14, 2)) * (flying ? 1 : 0);
      const sc = (0.6 + 0.6 * passed + 1.6 * near) * U.clamp((t - 46.5 - kk * 0.3) / 0.3);
      S.mat4.compose(v1.copy(TAG).addScaledVector(dir, dLen * kk), q1.identity(), new THREE.Vector3(sc, sc, sc));
      S.dots.setMatrixAt(i, S.mat4);
    }
    S.dots.instanceMatrix.needsUpdate = true;
  }
  // floor ruler counts along with the pulse (bag → you)
  const rulerA = U.win(t, 46.7, 49.55, 0.25, 0.3);
  S.ruler.material.uniforms.opacity.value = 0.85 * rulerA;
  const rTo = U.clamp(t < T_FLY0 ? 0 : kE);
  // ruler spans you(0) → bag(1); the pulse flies bag → you, so reveal from the bag end
  S.ruler.material.uniforms.from.value = 1 - rTo; S.ruler.material.uniforms.to.value = 1;
  S.rulerSpine.material.uniforms.opacity.value = 0.7 * rulerA;
  S.rulerSpine.material.uniforms.from.value = 1 - rTo; S.rulerSpine.material.uniforms.to.value = 1;
  S.ruler.visible = S.rulerSpine.visible = rulerA > 0.01 && rTo > 0.001;

  // ---- "nearby": fuzzy blob around you → collapses onto the bag on "four meters" ----
  const kc = U.expoOut(U.inv(W.four - 0.02, W.four + 0.5, t));
  const blobA = U.smooth(U.inv(W.nearby - 0.1, W.nearby + 0.25, t)) * (1 - U.smooth(U.inv(W.four + 0.3, W.four + 0.6, t)));
  S.blob.visible = blobA > 0.01;
  if (S.blob.visible) {
    const grow = U.backOut(U.clamp(U.inv(W.nearby - 0.1, W.nearby + 0.4, t)), 1.2);
    const r = U.lerp(2.35 * grow, 0.42, kc) * (1 + 0.03 * Math.sin(t * 2.6) * (1 - kc));
    S.blob.position.set(B.x, B.y + 0.025, B.z);
    S.blob.scale.setScalar(Math.max(0.01, r));
    S.blobM.uniforms.uAlpha.value = 0.75 * blobA; S.blobM.uniforms.uTime.value = t; S.blobM.uniforms.uSharp.value = kc;
    S.blobM.uniforms.color.value.set(kc > 0.5 ? P.route : P.phone);
  }
  // crisp line + reticle + chevrons
  const kl = U.inv(W.four + 0.05, W.meters + 0.15, t);
  const lineA = U.smooth(U.inv(W.four, W.four + 0.15, t)) * (1 - U.smooth(U.inv(51.9, 52.4, t)));
  S.line.visible = lineA > 0.01;
  S.line.material.uniforms.opacity.value = 0.95 * lineA; S.line.material.uniforms.from.value = 0; S.line.material.uniforms.to.value = U.easeInOut(kl);
  S.line.material.uniforms.glow.value = 0.6 + 0.6 * Math.sin(Math.PI * U.clamp(kl));
  const kr = U.inv(W.four + 0.3, W.four + 0.75, t);
  S.retM.opacity = U.clamp(kr * 3) * lineA;
  S.ret.visible = S.retM.opacity > 0.01;
  S.ret.scale.setScalar(Math.max(0.01, U.backOut(U.clamp(kr), 2.2))); S.ret.rotation.y = 0.6 * (1 - U.easeOut(U.clamp(kr)));
  S.chevs.forEach((m, i) => {
    const kk = U.inv(W.to + i * 0.08, W.to + i * 0.08 + 0.2, t);
    const run = 0.5 + 0.5 * Math.cos(Math.PI * 2 * ((t - W.to) * 1.6 - i * 0.22));
    m.material.opacity = U.clamp(kk) * lineA * (0.55 + 0.45 * run);
    m.visible = m.material.opacity > 0.01;
  });

  // ---- your phone screen ----
  const screenOn = t > 42.2 && t < SHOW_B;
  if (screenOn) {
    const scr = S.phone.userData.screen;
    const arrowA = U.smooth(U.inv(W.shows - 0.12, W.shows + 0.08, t));
    if (arrowA < 0.999) drawMapScreen(scr, { t, label: 'Suitcase', sub: t > W.four ? 'to your left' : t > W.close ? 'nearby' : 'seen just now', dist: t > W.four ? '4 m' : t > W.close ? 'near' : '0.1 mi', pinXY: [0.55, 0.36], you: [0.42, 0.5], zoom: 1.6, kicker: 'ITEMS' });
    if (arrowA > 0.001) {
      scr.g.globalAlpha = arrowA;
      drawArrowScreen(scr, { t, angleDeg: ANGLE, distance: '4 m', sub: 'to your left', label: 'Suitcase', kicker: 'FINDING', chip: 'ULTRA WIDEBAND', k: U.backOut(U.clamp(U.inv(W.shows, W.arrow, t)), 1.8) });
      scr.g.globalAlpha = 1;
    }
  }

  // ---- item card ----
  if (t >= 42.55) {
    let o;
    if (t < W.close) o = { kicker: 'SUITCASE', icon: 'tag', time: '0.1', prev: '1B+', k: U.inv(42.55, 42.95, t), unit: 'mi', sub: 'hotel lobby', state: 'live' };
    else if (t < W.four) {
      const kN = U.inv(W.close, W.close + 0.45, t);
      const uwb = t >= W.more - 0.02;
      o = { kicker: t >= W.ultra ? 'SUITCASE · ULTRA WIDEBAND' : 'SUITCASE', icon: 'tag', time: kN < 0.3 ? '0.1' : 'nearby', prev: kN < 0.3 ? '0.1' : '      ', k: kN < 0.3 ? 1 : U.inv(0.3, 1, kN), unit: kN < 0.3 ? 'mi' : '',
        alpha: 1 - Math.sin(Math.PI * U.clamp(kN / 0.6)) * 0.85,
        sub: t >= W.nearby - 0.05 ? 'rough guess' : t >= W.measures ? 'measuring' : uwb ? 'precise mode' : 'with you', state: uwb ? 'plan' : 'live', flash: '#fff',
        scale: 1 + 0.045 * Math.sin(Math.PI * U.clamp(kN * 1.3)) + 0.04 * Math.sin(Math.PI * U.inv(W.nearby, W.nearby + 0.4, t)) + 0.03 * Math.sin(Math.PI * U.inv(W.more, W.more + 0.3, t)) };
    } else {
      const k4 = U.inv(W.four, W.four + 0.45, t);
      o = { kicker: 'SUITCASE · ULTRA WIDEBAND', icon: 'tag', time: k4 < 0.3 ? 'nearby' : '4', prev: k4 < 0.3 ? 'nearby' : ' ', k: k4 < 0.3 ? 1 : U.inv(0.3, 1, k4), unit: k4 < 0.3 ? '' : 'm',
        alpha: 1 - Math.sin(Math.PI * U.clamp(k4 / 0.6)) * 0.85, sub: t >= W.to ? 'to your left' : '', state: 'plan', flash: P.route,
        scale: 1 + 0.05 * Math.sin(Math.PI * U.clamp(k4 * 1.3)) + 0.03 * Math.sin(Math.PI * U.inv(W.to, W.to + 0.3, t)) };
    }
    hud.eta(o);
  }
  // status chip: which radio
  const btA = U.win(t, W.close, W.more + 0.05, 0.2, 0.12);
  if (btA > 0) hud.status({ label: 'BLUETOOTH · NEARBY', color: P.phone, alpha: btA });
  const uwA = U.win(t, W.more + 0.02, 51.85, 0.15, 0.25);   // gone before the phone fills the frame
  if (uwA > 0 && btA < 0.05) hud.status({ label: 'ULTRA WIDEBAND · PRECISE', color: P.paper, alpha: uwA });

  // ---- labels (≤ 2 at once) ----
  const headP = [S.you.position.x, S.you.position.y + 1.4, S.you.position.z];
  hud.label('s10you', headP, 'you', { color: P.route, dark: true, alpha: U.win(t, W.close - 0.04, 44.0, 0.2, 0.3), dx: 80, dy: -50 });
  hud.label('s10tag', TAG, 'tracker', { color: P.paper, dark: true, alpha: U.win(t, W.tracker - 0.04, 45.4, 0.2, 0.3), dx: 70, dy: -150 });
  hud.label('s11uwb', TAG, 'ultra wideband', { color: P.paper, dark: true, small: 'sharp radio pulses', alpha: U.win(t, W.ultra - 0.03, 46.75, 0.2, 0.25), dx: 70, dy: -120 });
  const ns = U.clamp(kE) * NS;
  const nsDone = t >= W.travel - 0.05;
  hud.label('s11ns', nsDone ? PH : hp.clone(), `${ns.toFixed(1)} ns`, { color: P.paper, dark: true, small: nsDone ? 'time of flight' : 'timing', alpha: U.win(t, T_FLY0 - 0.02, 49.25, 0.15, 0.3), dx: 60, dy: -110, size: 1 + 0.08 * Math.sin(Math.PI * U.inv(W.travel - 0.05, W.travel + 0.25, t)) });
  hud.label('s11near', [B.x - 2.1, 0.33, B.z + 0.4], '"nearby"', { color: P.phone, dark: true, small: 'somewhere around here', alpha: U.win(t, W.nearby - 0.02, W.four + 0.2, 0.2, 0.2), dx: 40, dy: -120 });
  const midL = S.fl.at(S.flLen * 0.55);
  hud.label('s11m', [midL.x, midL.y + 0.03, midL.z], '4 m', { color: P.route, dark: true, small: t >= W.to ? 'to your left' : '', alpha: U.win(t, W.four + 0.08, 51.85, 0.2, 0.25), dx: -70, dy: -120, size: 1 + 0.06 * Math.sin(Math.PI * U.inv(W.to, W.to + 0.3, t)) });
}
