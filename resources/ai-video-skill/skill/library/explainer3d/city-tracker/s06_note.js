/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-tracker/s06_note.js - Packet flies on an arc to a cloud (25.2-29.7 s)
 * Look: city + gadgets (same paper city, units m, tracker/suitcase/people props)
 * Original spoken line: "It already knows where it is, so it sends a small encrypted note to the servers: 'heard this tag, here.'"
 * Shows:
 *   A stranger walks past the bag; their phone's location blooms on the sidewalk (gps puck); a sealed note rises out
 *   of the back pocket, its 3D padlock snaps shut on "encrypted", it launches and arcs up the street into a cloud
 *   vault (camera cranes after it); chips pop with inline SVG icons: [tag] then [pin].
 * Techniques to steal:
 *   - makePacket + flyArc (quadratic bezier) with a tapered tube trail ShaderMaterial along the same curve
 *   - small 3D padlock that snaps shut on a word; rim flash on seal and dock
 *   - walk(): a person continuing along a path across beats (personPos from a shared start time)
 *   - hermite camera keys; during the flight aim between packet and target so both stay in frame
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
// s06_note (25.2-29.7): "It already knows where it is, so it sends a small encrypted note to the servers: 'heard this tag, here.'"
// The stranger keeps walking past the bag. Their phone's own location blooms on the sidewalk (gps puck) on "knows where it is";
// a tiny sealed note rises out of the back pocket on "sends", its padlock snaps shut on "encrypted", it launches on "note"
// and arcs up the street corridor into the cloud vault on "to the servers" (camera cranes up after it); docked in front of the
// cloud's lock, a chip pops: [tag] on "heard this tag", [pin] on "here".
import * as THREE from 'three';
import { makeSuitcase, makeTracker, makePerson, walk, pulseRings, makePacket, flyArc, makeCloud, makeStreetProps,
  LOC, fade, initLib } from './lib.js';

// word times (build/words_final.json)
const W6 = { it: 25.305, knows: 25.705, is: 26.185, sends: 26.585, small: 26.985, encrypted: 27.225, note: 27.625, to: 27.945,
  servers: 28.105, heard: 28.505, tag: 28.905, here: 29.39 };
const T0 = 25.2, T1 = 29.7, VIS0 = 24.75, VIS1 = 30.15;
const LAUNCH = W6.note - 0.02, DOCK = 28.45;

// the stranger's walk (continues s05: passes the bag, s≈34, around "hears")
const WALK = { path: null, s0: 29.5, t0: 21.2, speed: 1.35 };
const HOVER = new THREE.Vector3(-0.1, 1.32, -0.42);    // relative to the walk path point (sidewalk y = 0.25)       // note hovers behind the right shoulder (person faces +z, right = -x)
// cloud vault up the street corridor, facing back toward the street spot
const CLOUD_POS = new THREE.Vector3(151, 38, 50), CLOUD_SCALE = 1.8, CLOUD_YAW = 0;   // up the street corridor (north), front lit by the low sun
const TO_CAM = new THREE.Vector3(Math.sin(CLOUD_YAW), 0, Math.cos(CLOUD_YAW));             // the vault's front direction
const DOCK_LOCAL = new THREE.Vector3(-2.7, 1.25, 3.1);  // in front of the cloud, beside its lock

const ICON_TAG = '<svg width="34" height="34" viewBox="0 0 24 24" style="vertical-align:-9px"><circle cx="12" cy="12" r="9.5" fill="#fff"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="#9aa3ad" stroke-width="1.5"/></svg>';
const ICON_PIN = (c) => `<svg width="30" height="36" viewBox="0 0 20 24" style="vertical-align:-9px"><path d="M10 23 C10 23 2 14.5 2 9 A8 8 0 0 1 18 9 C18 14.5 10 23 10 23 Z" fill="${c}"/><circle cx="10" cy="9" r="3.2" fill="#fff"/></svg>`;

let S = null;

function personPos(t) {
  const s = WALK.s0 + WALK.speed * (Math.max(t, WALK.t0) - WALK.t0);
  return LOC.streetWalk.at(Math.min(s, LOC.streetWalk.length));
}

// tube along a quadratic bezier (parametric u, same as lib.bezier/flyArc), radius grows with u; uv.x = u
function trailGeometry(curve, N = 90, R = 8, r0 = 0.02, r1 = 0.32) {
  const pos = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const u = i / N, c = curve.getPoint(u), tg = curve.getTangent(u).normalize();
    n.crossVectors(tg, up); if (n.lengthSq() < 1e-6) n.set(1, 0, 0); n.normalize();
    b.crossVectors(n, tg).normalize();
    const r = r0 + (r1 - r0) * Math.pow(u, 1.3);
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2;
      pos.push(c.x + r * (Math.cos(a) * n.x + Math.sin(a) * b.x), c.y + r * (Math.cos(a) * n.y + Math.sin(a) * b.y), c.z + r * (Math.cos(a) * n.z + Math.sin(a) * b.z));
      uv.push(u, j / R);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) {
    const a = i * (R + 1) + j, c = a + R + 1;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function trailMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, head: { value: 0 }, len: { value: 0.4 }, opacity: { value: 1 }, glow: { value: 1.2 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 color; uniform float head, len, opacity, glow; varying vec2 vUv;
      void main(){ float u = vUv.x; if (u > head) discard; float a = smoothstep(head - len, head, u); a = a * a * opacity;
        if (a < 0.004) discard; gl_FragColor = vec4(color * (1.0 + glow * a), a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// small 3D padlock that snaps shut on the packet's seal (packet-local units: card is 1 × 0.66)
function makeLock(ctx) {
  const g = new THREE.Group();
  const bodyM = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.35, metalness: 0.1 });
  const steelM = new THREE.MeshStandardMaterial({ color: '#e3e7ec', roughness: 0.25, metalness: 0.9 });
  const keyM = new THREE.MeshBasicMaterial({ color: new THREE.Color(ctx.P.live).multiplyScalar(1.1) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.05), bodyM); g.add(body);
  const shackle = new THREE.Group(); g.add(shackle);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.016, 8, 24, Math.PI), steelM); arch.position.y = 0.11; shackle.add(arch);
  for (const x of [-0.058, 0.058]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 10), steelM); leg.position.set(x, 0.075, 0); shackle.add(leg); }
  const kh = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), keyM); kh.position.set(0, 0.008, 0.0255); g.add(kh);
  const ks = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.04), keyM); ks.position.set(0, -0.016, 0.0255); g.add(ks);
  g.userData = { shackle, keyM };
  return g;
}

const SCENE = {
  init(ctx) {
    initLib(ctx);
    const { scene, P } = ctx;
    WALK.path = LOC.streetWalk;
    const root = new THREE.Group(); root.name = 's06'; root.visible = false; scene.add(root);

    // set: street spot + the bag with its tag (same as s05)
    const street = makeStreetProps(ctx); root.add(street);
    const bag = makeSuitcase(ctx); street.userData.bagSlot.add(bag);
    const tag = makeTracker(ctx, { scale: 0.09 }); bag.userData.tagSlot.add(tag);
    const bagRings = pulseRings(ctx, { maxR: 3.2, count: 3, period: 1.7 }); root.add(bagRings.group);

    // the stranger (pocket phone)
    const stranger = makePerson(ctx, { seed: 11, phone: true, phoneIn: 'pocket' }); root.add(stranger);
    const phoneRings = pulseRings(ctx, { maxR: 0.22, count: 2, period: 0.9, mode: 'billboard', width: 0.02, glow: 1.3, fill: 0.15 }); root.add(phoneRings.group);

    // gps puck on the sidewalk under the stranger
    const puck = new THREE.Group(); root.add(puck);
    const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };
    const off = { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8, transparent: true, depthWrite: false };
    const accM = new THREE.MeshBasicMaterial({ color: P.phone, opacity: 0.16, ...off });
    const acc = new THREE.Mesh(flat(new THREE.CircleGeometry(1.15, 64)), accM); puck.add(acc);
    const accEdgeM = new THREE.MeshBasicMaterial({ color: P.phone, opacity: 0.55, ...off });
    const accEdge = new THREE.Mesh(flat(new THREE.RingGeometry(1.12, 1.16, 96)), accEdgeM); puck.add(accEdge);
    const rimM = new THREE.MeshBasicMaterial({ color: '#ffffff', opacity: 1, ...off });
    const rim = new THREE.Mesh(flat(new THREE.CircleGeometry(0.2, 40)), rimM); rim.position.y = 0.002; puck.add(rim);
    const dotM = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.phone).multiplyScalar(1.25), opacity: 1, ...off });
    const dot = new THREE.Mesh(flat(new THREE.CircleGeometry(0.145, 40)), dotM); dot.position.y = 0.004; puck.add(dot);
    puck.children.forEach((m) => (m.renderOrder = 9));
    const puckRings = pulseRings(ctx, { color: P.phone, maxR: 1.9, count: 2, period: 1.25, width: 0.07, glow: 1.0, fill: 0.15 }); root.add(puckRings.group);

    // the note
    const packet = makePacket(ctx); root.add(packet);
    const lock = makeLock(ctx); lock.position.set(0, -0.045, 0.05); packet.add(lock);
    const sealRing = pulseRings(ctx, { color: P.live, maxR: 0.5, count: 1, period: 0.7, mode: 'billboard', width: 0.04, glow: 1.4, fill: 0.25 }); root.add(sealRing.group);

    // the cloud vault
    const cloud = makeCloud(ctx); cloud.scale.setScalar(CLOUD_SCALE); cloud.position.copy(CLOUD_POS); cloud.rotation.y = CLOUD_YAW; root.add(cloud);
    cloud.updateMatrixWorld(true);
    const dockW = cloud.localToWorld(DOCK_LOCAL.clone());
    const dockRing = pulseRings(ctx, { color: P.live, maxR: 3.2, count: 1, period: 1.0, mode: 'billboard', width: 0.12, glow: 1.4, fill: 0.2 }); root.add(dockRing.group);

    // flight arc (fixed endpoints: hover point at launch → dock)
    const A = personPos(LAUNCH).add(HOVER);
    const C = A.clone().lerp(dockW, 0.22).add(new THREE.Vector3(0, 16, 0));   // steep climb first: out of the street fast
    const curve = new THREE.QuadraticBezierCurve3(A, C, dockW);
    const trailM = trailMaterial(P.live);
    const trail = new THREE.Mesh(trailGeometry(curve), trailM); trail.renderOrder = 7; trail.frustumCulled = false; root.add(trail);

    const camQ = new THREE.Quaternion();
    S = { root, street, bag, bagRings, stranger, phoneRings, puck, acc, accEdge, puckRings, packet, lock, sealRing, cloud, dockW, dockRing,
      A, C, curve, trail, trailM, camQ, v: new THREE.Vector3(), v2: new THREE.Vector3(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), m: new THREE.Matrix4(), e: new THREE.Euler() };
    S.mats = { accM, accEdgeM, rimM, dotM };
  },

  update(ctx, t, spec) {
    const { U, P, hud } = ctx;
    const on = t >= VIS0 && t <= VIS1;
    S.root.visible = on;
    if (!on) return;
    const a = U.win(t, VIS0, VIS1, 0.25, 0.45);        // for glows/labels
    const v = S.v, v2 = S.v2;

    // --- stranger keeps walking ---
    walk(S.stranger, t, WALK);
    S.stranger.updateMatrixWorld(true);
    const pp = S.stranger.position;
    const phoneW = S.stranger.userData.phone.getWorldPosition(new THREE.Vector3());

    // tracker still beaconing in the bag (fades as the story leaves the bag)
    S.bag.getWorldPosition(v);
    S.bagRings.update(t, v, a * (1 - U.smooth(U.inv(26.2, 27.4, t))) * 0.9);

    // pocket phone glows softly ("heard"), bursts on "sends"
    const send = U.inv(W6.sends - 0.05, W6.sends + 0.5, t);
    S.phoneRings.update(t * 1.0, phoneW.clone().add(new THREE.Vector3(0, 0.06, -0.02)), a * (0.55 + 0.45 * Math.sin(Math.PI * send)) * (1 - U.smooth(U.inv(27.5, 28.0, t))));

    // --- gps puck: "it already knows where it is" ---
    const kP = U.inv(W6.knows - 0.12, W6.knows + 0.45, t);
    const puckA = U.smooth(U.clamp(kP * 3)) * (1 - U.smooth(U.inv(27.4, 28.1, t)));
    S.puck.visible = puckA > 0.003;
    if (S.puck.visible) {
      S.puck.position.set(pp.x, 0.255, pp.z);
      const sc = U.backOut(U.clamp(kP), 1.6);
      S.puck.scale.setScalar(Math.max(0.001, sc));
      S.acc.scale.setScalar(0.6 + 0.4 * U.easeOut(U.inv(W6.knows, W6.is + 0.2, t)));
      S.accEdge.scale.copy(S.acc.scale);
      S.mats.accM.opacity = 0.16 * puckA; S.mats.accEdgeM.opacity = 0.55 * puckA; S.mats.rimM.opacity = puckA; S.mats.dotM.opacity = puckA;
    }
    S.puckRings.update(t, [pp.x, 0.26, pp.z], puckA * 0.85);
    hud.label('s06gps', [pp.x, 0.27, pp.z], 'gps · here', { color: P.phone, alpha: U.win(t, W6.knows + 0.05, 27.15, 0.25, 0.3), dx: -70, dy: 120 });

    // --- the note ---
    const P6 = packetState(ctx, t, U.v3(SCENE.camera(ctx, t).pos).clone());
    const pk = S.packet;
    pk.visible = P6.alpha > 0.003;
    if (pk.visible) {
      pk.position.copy(P6.pos);
      pk.quaternion.copy(P6.quat);
      pk.scale.setScalar(Math.max(0.001, P6.scale));
      // rim flash on seal + on dock
      const flash = Math.exp(-Math.pow((t - (W6.encrypted + 0.22)) / 0.12, 2)) + 0.8 * Math.exp(-Math.pow((t - (DOCK + 0.05)) / 0.15, 2));
      pk.userData.rim.color.set(P.live).multiplyScalar(1.7 + 1.6 * flash);
      // padlock: shackle open, snaps shut on "encrypted"
      const lk = U.inv(W6.encrypted + 0.02, W6.encrypted + 0.32, t);
      const sp = U.spring(lk, 2.6, 6.5);
      S.lock.userData.shackle.position.y = 0.075 * (1 - sp);
      S.lock.userData.shackle.rotation.y = 1.1 * (1 - U.smooth(U.clamp(lk * 1.6)));
      S.lock.scale.setScalar(1 + 0.18 * Math.exp(-Math.pow((t - (W6.encrypted + 0.3)) / 0.1, 2)));
      S.lock.userData.keyM.color.set(P.live).multiplyScalar(1.1 + 1.2 * flash);
    }
    S.sealRing.update(t - (W6.encrypted + 0.28), P6.pos, a * (t > W6.encrypted + 0.28 && t < W6.encrypted + 0.98 ? 1 : 0));
    // grow the ring with the packet
    S.sealRing.group.scale.setScalar(Math.max(0.2, P6.scale / 0.2));

    // trail behind the flight
    const kF = flightK(ctx, t);
    S.trail.visible = t > LAUNCH && t < 29.6;
    S.trailM.uniforms.head.value = kF;
    S.trailM.uniforms.len.value = 0.55;
    S.trailM.uniforms.opacity.value = 0.9 * a * (1 - U.smooth(U.inv(DOCK, 29.3, t)));

    // --- cloud vault ---
    const cA = U.win(t, VIS0, VIS1, 0.2, 0.45);
    const land = Math.exp(-Math.pow((t - (DOCK + 0.08)) / 0.18, 2));
    S.cloud.userData.glow.opacity = (0.55 + 0.45 * land) * cA;
    S.cloud.userData.lock.scale.setScalar(1 + 0.12 * land);
    S.cloud.userData.keyhole.color.set(P.live).multiplyScalar(1.8 + 1.2 * land);
    S.dockRing.update(t - DOCK, S.dockW, a * (t > DOCK && t < DOCK + 0.95 ? 1 : 0));

    // --- labels ---
    hud.label('s06enc', P6.pos.clone().add(new THREE.Vector3(0, P6.scale * 0.36, 0)), 'encrypted', {
      color: P.live, small: 'sealed', alpha: U.win(t, W6.encrypted + 0.12, W6.to + 0.1, 0.2, 0.25), dx: 70, dy: -110 });
    hud.label('s06cloud', S.cloud.localToWorld(v2.set(0.5, 4.4, 0)), 'servers', {
      small: 'the network', dark: true, alpha: U.win(t, W6.to - 0.02, W6.heard + 0.05, 0.2, 0.25), dx: 60, dy: -90 });
    // "heard this tag, here": tag icon, then pin icon
    const kTag = U.inv(W6.heard - 0.02, W6.heard + 0.3, t), kPin = U.inv(W6.here - 0.04, W6.here + 0.26, t);
    const pinS = U.backOut(kPin, 2.2);
    const chip = `${ICON_TAG}<span style="display:inline-block;width:${Math.round(52 * U.smooth(Math.min(1, kPin * 2)))}px;overflow:hidden;vertical-align:-9px;text-align:center;opacity:${kPin > 0 ? 0.5 : 0}">+</span>`
      + `<span style="display:inline-block;width:${Math.round(32 * U.smooth(Math.min(1, kPin * 2)))}px;overflow:visible;vertical-align:-1px"><span style="display:inline-block;transform:scale(${pinS.toFixed(3)});transform-origin:50% 90%">${ICON_PIN(P.route)}</span></span>`;
    hud.label('s06chip', P6.pos.clone().add(new THREE.Vector3(0, -P6.scale * 0.3, 0)), chip, {
      dark: true, alpha: U.win(t, W6.heard - 0.02, VIS1, 0.22, 0.3), size: 1.6 * (0.6 + 0.4 * U.backOut(kTag, 2.0)), dx: 70, dy: 120, dotColor: P.live });

    // status chip once it is sealed
    hud.status({ label: 'END-TO-END ENCRYPTED', color: P.live, alpha: U.win(t, W6.encrypted + 0.1, VIS1, 0.25, 0.35) });
    // item card: a tiny bump when the note lands (the network just got a report)
    hud.eta({ kicker: 'SUITCASE', icon: 'tag', time: '2.4', unit: 'mi', sub: 'seen just now', state: 'live', scale: 1 + 0.04 * land });
  },

  camera(ctx, t) {
    const U = ctx.U;
    const tc = U.clamp(t, VIS0, VIS1);
    if (!S.camKeys) S.camKeys = buildCamKeys();
    const pose = hermitePose(S.camKeys, tc);
    // during the flight, aim between the note and the vault so the note stays in frame
    if (tc > LAUNCH - 0.1 && tc < DOCK + 0.5) {
      const P6 = packetState(ctx, tc);
      const w = U.smooth(U.inv(LAUNCH - 0.1, LAUNCH + 0.3, tc)) * (1 - U.smooth(U.inv(DOCK - 0.15, DOCK + 0.5, tc)));
      const tgt = U.v3(pose.target).clone().lerp(P6.pos, 0.6 * w);
      pose.target = [tgt.x, tgt.y, tgt.z];
    }
    const hand = 1 - U.smooth(U.inv(27.6, 28.4, tc));   // a touch of handheld on the street, steady in the sky
    pose.pos = [pose.pos[0] + U.drift(tc, 3.1) * 0.05 * hand, pose.pos[1] + U.drift(tc, 7.7) * 0.035 * hand, pose.pos[2]];
    return pose;
  },
};

// camera keys: [t, pos, target, fov]
//  1) 3/4 rear tracking shot down the sidewalk, bag mid-ground left, the gps puck blooms under the walker (25.2-26.3)
//  2) fast push over the right shoulder onto the pocket: the note rises, its lock snaps shut (26.3-27.6)
//  3) crane up the street corridor after the note, out over the rooftops (27.6-28.45)
//  4) keep rising, easing to a level view of the vault while the chip pops (28.45-29.7)
function buildCamKeys() {
  const shot1 = (tt, back = 6.4, up = 1.55) => { const p = personPos(tt); return [tt, [p.x - 1.15, up, p.z - back], [p.x - 0.35, 0.85, p.z + 1.2], 34]; };
  // side view (camera on the street side looking east): the walker crosses left → right, the note trails behind him
  const shot2 = (tt, d = 1) => { const p = personPos(tt);
    return [tt, [p.x - 4.2 * d, 1.42, p.z - 0.45], [p.x - 0.05, 1.3, p.z - 0.35], 33]; };
  const D = S.dockW;
  const walkV = [0, 0, WALK.speed];
  const k2a = shot2(26.8, 1.08); k2a.push(walkV);
  // push in on the note as its lock snaps shut
  const pb = personPos(27.55), hb = pb.clone().add(HOVER);
  const k2b = [27.55, [pb.x - 2.75, hb.y + 0.02, pb.z - 0.6], [hb.x, hb.y - 0.06, hb.z + 0.1], 31, [0, 0.9, 0.7]];
  return [
    shot1(24.75, 6.8, 1.6),
    shot1(25.6, 6.4, 1.55),
    shot1(26.25, 5.4, 1.5),
    k2a,
    k2b,
    [28.05, [153.8, 7.0, 108.5], [D.x, D.y - 12, D.z], 40],
    [28.65, [152.8, 19.5, 101], [D.x + 2, D.y - 3, D.z], 40],
    [29.3, [152.6, 29.5, 94], [D.x + 3, D.y + 0.2, D.z], 39],
    [30.15, [152.7, 32.5, 89], [D.x + 3.2, D.y + 0.6, D.z], 38],
  ];
}
// cubic Hermite through keys (Catmull-Rom tangents for non-uniform times, zero velocity at the ends)
function hermitePose(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return { pos: keys[0][1].slice(), target: keys[0][2].slice(), fov: keys[0][3], roll: 0 };
  if (t >= keys[n - 1][0]) return { pos: keys[n - 1][1].slice(), target: keys[n - 1][2].slice(), fov: keys[n - 1][3], roll: 0 };
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const t0 = keys[i][0], t1 = keys[i + 1][0], h = t1 - t0, u = (t - t0) / h;
  const h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
  const tan = (j, f) => {
    if (keys[j][4] && f(keys[j]).length === 3) return keys[j][4];
    if (j <= 0 || j >= n - 1) return f(keys[j]).map(() => 0);
    const a = f(keys[j - 1]), b = f(keys[j + 1]), dt = keys[j + 1][0] - keys[j - 1][0];
    return a.map((_, c) => (b[c] - a[c]) / dt);
  };
  const ev = (f) => { const p0 = f(keys[i]), p1 = f(keys[i + 1]), m0 = tan(i, f), m1 = tan(i + 1, f);
    return p0.map((_, c) => h00 * p0[c] + h10 * h * m0[c] + h01 * p1[c] + h11 * h * m1[c]); };
  return { pos: ev((k) => k[1]), target: ev((k) => k[2]), fov: ev((k) => [k[3]])[0], roll: 0 };
}

export default SCENE;

// flight progress 0..1 (bezier parameter): quick launch, decelerates into the dock
function flightK(ctx, t) {
  const U = ctx.U;
  const k = U.inv(LAUNCH, DOCK, t);
  return k <= 0 ? 0 : k >= 1 ? 1 : (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2.6) / 2);
}

// the note's position / orientation / scale / alpha as a pure function of t
function packetState(ctx, t, camPos = null) {
  const U = ctx.U;
  const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 0, alpha: 0 };
  const born = U.inv(W6.sends - 0.02, W6.sends + 0.42, t);
  if (born <= 0) return out;
  const SC0 = 0.17;
  const pp = personPos(Math.min(t, LAUNCH));
  const hover = pp.clone().add(HOVER).add(new THREE.Vector3(0, 0.025 * Math.sin(t * 5.2), 0));
  // camera-facing orientation (yaw + slight pitch toward the camera pose)
  const cam = camPos || new THREE.Vector3(0, 0, -1e4);
  const face = (p) => { const m = new THREE.Matrix4().lookAt(cam, p, new THREE.Vector3(0, 1, 0)); return new THREE.Quaternion().setFromRotationMatrix(m); };
  if (t < LAUNCH) {
    // rises out of the back pocket
    const pocket = pp.clone().add(new THREE.Vector3(-0.09, 0.88, -0.14));
    const e = U.easeOut(born);
    out.pos.copy(pocket).lerp(hover, e);
    out.scale = SC0 * U.backOut(born, 1.8) * (W6.small <= t ? 1 : 0.85 + 0.15 * U.inv(W6.sends, W6.small, t));
    out.quat.copy(face(out.pos));
    // small tumble as it emerges
    out.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.5 * (1 - e))));
    out.alpha = 1;
    return out;
  }
  const k = flightK(ctx, t);
  const obj = new THREE.Object3D();
  const p = flyArc(obj, S.A, S.dockW, k, { ctrl: S.C, wobble: 0.6 });
  out.pos.copy(p);
  const qFly = obj.quaternion.clone();
  const qFace = face(p);
  const wIn = U.smooth(U.inv(0, 0.18, k)), wOut = U.smooth(U.inv(0.8, 1, k));
  out.quat.copy(qFace).slerp(qFly, wIn * (1 - wOut));
  // grows as it flies away (stays readable at the vault), settles with a spring on the dock
  const SC1 = 4.0;
  const settle = t > DOCK ? 1 + 0.12 * Math.exp(-6 * (t - DOCK)) * Math.sin(18 * (t - DOCK)) : 1;
  out.scale = (SC0 + (SC1 - SC0) * Math.pow(k, 1.25)) * settle;
  if (t > DOCK) out.pos.y += 0.12 * Math.sin((t - DOCK) * 3.0);
  out.alpha = 1;
  return out;
}

// debug hook (node-side camera checks; unused by the film)
export const __s06 = { buildCamKeys: () => buildCamKeys(), hermitePose, personPos, setDock(v) { S = S || {}; S.dockW = v; } };
