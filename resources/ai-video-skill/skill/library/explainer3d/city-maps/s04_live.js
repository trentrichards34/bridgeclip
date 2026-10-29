/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s04_live.js - Phones ping live speed (14.35-21.1 s)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: "For every piece, it already knows how fast traffic is moving right now, because phones driving through it are quietly sharing their speed."
 * Shows:
 *   Tiles sweep to their live colour; dive into piece 5 on the highway; the piece fills green "58 mph - live"; every
 *   real car in the piece pops a phone ping (dot on a stalk + pulse ring); speed readouts rise off a few cars and
 *   stream into the piece label; status chip.
 * Techniques to steal:
 *   - ctx.traffic.addSlow to shape real traffic in a stretch; traffic.carsOn + poseAt to attach pings to moving cars
 *   - stable deterministic picks with a hash(i), never Math.random
 *   - canvas-texture speed chips + stream dots flying from ping to label
 *   - hud.label with leader lines + hud.status chip; ground camera where "target leads, position follows"
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
// s04 · "For every piece, it already knows how fast traffic is moving right now, because phones driving
// through it are quietly sharing their speed." (14.35-21.1)
//   14.62 "every piece"   the 8 tiles sweep from route-blue to their own live colour (one amber)
//   15.45-16.7            dive into piece 5 on the highway; tiles land and dissolve into the road
//   17.48 "right now"     the piece fills green, "58 mph · live" + status chip
//   18.41 "phones"        every car in the piece pops a phone ping (dot on a stalk + pulse ring)
//   20.09 "sharing… speed" speed readouts rise off a few pings and stream into the piece's label
import * as THREE from 'three';
import { initTiles, updateTiles, overviewPose, pxScale, hazeFog } from './s03_tiles.js';

const PIECE = 4;            // world.segments index → "piece 5"
const POOL = 36;
const T_DIVE0 = 15.45, T_DIVE1 = 16.75;
const T_FILL = 17.2, T_PING = 18.3, T_CHIP = 20.02, T_STREAM = 20.4;
const hash = (i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };

let st = null;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export default {
  init(ctx) {
    initTiles(ctx);
    const { THREE: T3, world, P, scene } = ctx;
    const hw = world.paths.highway, route = world.paths.route;
    const seg = world.segments[PIECE];
    let hs0 = hw.nearest(route.at(seg.s0)), hs1 = hw.nearest(route.at(seg.s1));
    if (hs0 > hs1) [hs0, hs1] = [hs1, hs0];
    const hm = (hs0 + hs1) / 2;
    // traffic in this piece runs a touch under free flow (≈58 mph average)
    ctx.traffic.addSlow({ path: 'highway', s0: hs0, s1: hs1, t0: 10, t1: 23, factor: 0.88, dir: 1, ramp: 40, tIn: 3, tOut: 2 });

    const root = new T3.Group(); root.visible = false; scene.add(root);
    const OFF = 6.4, WD = 12.6;
    const rib = (s0, s1, w, color, o, off = OFF) => {
      const m = new T3.Mesh(ctx.ribbonGeometry(hw, s0, s1, w, { off, dy: 0.12, step: 2 }), ctx.ribbonMaterial(color, o));
      m.renderOrder = 2; root.add(m); return m;
    };
    const base = rib(hs0, hs1, WD, P.live, { opacity: 0.0, edge: 0.04 });
    const fill = rib(hs0, hs1, WD, P.live, { opacity: 0.0, glow: 0.25, edge: 0.04 });
    const edges = [rib(hs0, hs1, 0.7, P.paper, { opacity: 0, edge: 0.3 }, OFF - WD / 2), rib(hs0, hs1, 0.7, P.paper, { opacity: 0, edge: 0.3 }, OFF + WD / 2)];
    const gates = [rib(hs0, hs0 + 1.6, WD + 0.7, P.paper, { opacity: 0, edge: 0.05 }), rib(hs1 - 1.6, hs1, WD + 0.7, P.paper, { opacity: 0, edge: 0.05 })];

    // phone pings
    const pingTex = canvasTex(96, 96, (x) => {
      x.beginPath(); x.arc(48, 48, 44, 0, 7); x.fillStyle = '#ffffff'; x.fill();
      x.beginPath(); x.arc(48, 48, 34, 0, 7); x.fillStyle = P.phone; x.fill();
    });
    const ringGeo = new T3.RingGeometry(0.86, 1, 48); ringGeo.rotateX(-Math.PI / 2);
    const stalkGeo = new T3.CylinderGeometry(0.11, 0.11, 1, 6); stalkGeo.translate(0, 0.5, 0);
    const stalkMat = new T3.MeshBasicMaterial({ color: P.phone });
    const pings = [];
    for (let i = 0; i < POOL; i++) {
      const dot = new T3.Sprite(new T3.SpriteMaterial({ map: pingTex, transparent: true, depthWrite: false }));
      dot.renderOrder = 6;
      const ring = new T3.Mesh(ringGeo, new T3.MeshBasicMaterial({ color: P.phone, transparent: true, depthWrite: false, toneMapped: false }));
      ring.renderOrder = 3;
      const stalk = new T3.Mesh(stalkGeo, stalkMat);
      root.add(dot, ring, stalk);
      pings.push({ dot, ring, stalk });
    }
    // speed chips + stream dots
    const chips = [], streams = [];
    for (let j = 0; j < 4; j++) {
      const c = new T3.Sprite(new T3.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false }));
      c.center.set(0.5, -0.55); c.renderOrder = 22; root.add(c); chips.push(c);
      const d = new T3.Sprite(new T3.SpriteMaterial({ map: pingTex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false }));
      d.renderOrder = 23; root.add(d); streams.push(d);
    }
    st = { root, hs0, hs1, hm, base, fill, edges, gates, pings, chips, streams, chipTex: new Map(), labelCar: null,
      labelAnchor: hw.side(hm + 25, OFF + WD / 2 + 0.5, 1.0) };
  },

  chipTexture(ctx, v) {
    if (st.chipTex.has(v)) return st.chipTex.get(v);
    const P = ctx.P;
    const t = canvasTex(200, 92, (x) => {
      x.fillStyle = P.phone; x.beginPath(); x.roundRect(4, 4, 192, 84, 42); x.fill();
      x.fillStyle = '#f2f4f8'; x.textBaseline = 'middle';
      x.font = '700 50px JetBrains Mono'; x.textAlign = 'right'; x.fillText(String(v), 116, 50);
      x.font = '700 24px JetBrains Mono'; x.textAlign = 'left'; x.fillStyle = 'rgba(242,244,248,.75)'; x.fillText('mph', 124, 54);
    });
    st.chipTex.set(v, t);
    return t;
  },

  update(ctx, t) {
    updateTiles(ctx, t);
    if (t >= 14.35) hazeFog(ctx, t, this.camera(ctx, t));
    const { U, P, traffic, hud } = ctx;
    const vis = U.win(t, 15.0, 21.65, 0.2, 0.5);
    st.root.visible = vis > 0;
    if (!st.root.visible) return;
    const { hs0, hs1, hm } = st;

    // the piece on the road
    const g = U.smoother(U.inv(15.75, 16.5, t)) * vis;
    st.base.material.uniforms.opacity.value = 0.2 * g;
    const kf = U.inv(T_FILL, T_FILL + 0.7, t);
    st.fill.material.uniforms.to.value = U.easeInOut(kf);
    const arrive = Math.max(0, ...[0, 1, 2].map((j) => Math.sin(Math.PI * U.inv(T_STREAM + 0.42 + j * 0.1, T_STREAM + 0.75 + j * 0.1, t))));
    st.fill.material.uniforms.opacity.value = (0.5 + 0.12 * arrive) * vis * (kf > 0 ? 1 : 0);
    st.fill.material.uniforms.glow.value = 0.25 + 0.5 * Math.sin(Math.PI * U.clamp(kf)) + 0.3 * arrive;
    for (const e of st.edges) { e.material.uniforms.opacity.value = 0.9 * g; e.material.uniforms.to.value = U.easeOut(U.inv(15.9, 16.7, t)); }
    st.gates.forEach((e, j) => { e.material.uniforms.opacity.value = 0.7 * g * U.inv(16.1 + j * 0.15, 16.45 + j * 0.15, t); });

    // pings on every car inside the piece (cars come and go on their own; a ping fades with the piece edge)
    const ids = traffic.carsOn('highway', hs0 - 12, hs1 + 12, t, 1);
    const onCars = [];
    let n = 0;
    for (const i of ids) {
      if (n >= POOL) break;
      const ps = traffic.poseAt(i, t);
      if (ps.hidden) continue;
      const ef = Math.min(U.inv(hs0 - 10, hs0 + 6, ps.s), U.inv(hs1 + 10, hs1 - 6, ps.s));
      const h = hash(i);
      const kp = U.inv(T_PING + h * 0.4, T_PING + h * 0.4 + 0.4, t);
      const a = U.clamp(kp * 2.5) * ef * vis;
      const p = st.pings[n++];
      const sc = U.backOut(U.clamp(kp), 2.0) * ef;
      p.dot.visible = p.stalk.visible = p.ring.visible = a > 0.01;
      if (!p.dot.visible) continue;
      p.dot.position.set(ps.pos.x, ps.pos.y + 4.4, ps.pos.z);
      p.dot.scale.setScalar(3.2 * sc);
      p.dot.material.opacity = a;
      p.stalk.position.set(ps.pos.x, ps.pos.y + 1.9, ps.pos.z);
      p.stalk.scale.set(1, 2.4 * sc, 1);
      const ph = ((t * 0.8 + h) % 1 + 1) % 1;
      p.ring.position.set(ps.pos.x, ps.pos.y + 0.3, ps.pos.z);
      p.ring.scale.setScalar(2 + 4.5 * U.easeOut(ph));
      p.ring.material.opacity = Math.pow(1 - ph, 1.6) * 0.6 * a;
      onCars.push({ i, ps, ef, h });
    }
    for (; n < POOL; n++) { const p = st.pings[n]; p.dot.visible = p.stalk.visible = p.ring.visible = false; }

    // speed readouts: a few well-placed cars (stable choice: hash) show their real speed, then stream it home
    const picks = onCars.filter((c) => c.ef > 0.95 && c.h < 0.45 && c.ps.s > hs0 + 25 && c.ps.s < hs1 - 50)
      .sort((a, b) => a.i - b.i).slice(0, 3);
    st.chips.forEach((c, j) => { c.visible = false; st.streams[j].visible = false; });
    picks.forEach((c, j) => {
      const mph = Math.round(c.ps.speed * 2.237);
      const kc = U.inv(T_CHIP + j * 0.11, T_CHIP + j * 0.11 + 0.3, t);
      const out = U.inv(T_STREAM + 0.3 + j * 0.1, T_STREAM + 0.55 + j * 0.1, t);
      const chip = st.chips[j];
      const a = U.clamp(kc * 2) * (1 - out) * vis;
      if (a > 0.01) {
        chip.visible = true;
        chip.material.map = this.chipTexture(ctx, mph); chip.material.needsUpdate = chip.material.userData.m !== mph; chip.material.userData.m = mph;
        chip.material.opacity = a;
        const s = U.backOut(U.clamp(kc), 2.0);
        chip.scale.set(pxScale(124) * s, pxScale(57) * s, 1);
        chip.position.set(c.ps.pos.x, c.ps.pos.y + 4.4 + 1.6 * U.easeOut(kc), c.ps.pos.z);
      }
      // stream dot flies from the ping to the piece label
      const ks = U.inv(T_STREAM + 0.2 + j * 0.1, T_STREAM + 0.7 + j * 0.1, t);
      if (ks > 0 && ks < 1) {
        const d = st.streams[j]; d.visible = true;
        const e = U.easeInOut(ks);
        const A = c.ps.pos, B = st.labelAnchor;
        d.position.set(U.lerp(A.x, B.x, e), U.lerp(A.y + 5, B.y, e) + Math.sin(Math.PI * e) * 9, U.lerp(A.z, B.z, e));
        const s = pxScale(26) * (1 - 0.35 * e);
        d.scale.set(s, s, 1);
        d.material.opacity = U.clamp(ks * 6) * vis;
      }
    });

    // labels + chip
    const la = U.win(t, 16.25, 17.55, 0.3, 0.15) * vis;
    if (la > 0) hud.label('s04piece', st.labelAnchor, 'piece 5', { alpha: la, dx: 70, dy: -80, color: P.paper, dark: true });
    const lb = U.win(t, 17.45, 21.05, 0.25, 0.45) * vis;
    if (lb > 0) hud.label('s04live', st.labelAnchor, '58 mph · live', { alpha: lb, dx: 70, dy: -80, color: P.live, dark: true, dotColor: P.live, size: 1 + 0.07 * arrive });
    // phone count, tied to one car chosen once at T_PING (deterministic)
    if (st.labelCar == null && t >= T_PING) {
      const c0 = traffic.carsOn('highway', hm - 30, hm + 10, T_PING + 0.9, 1);
      st.labelCar = c0.length ? c0[0] : -1;
      st.phoneCount = traffic.carsOn('highway', hs0, hs1, T_PING + 0.9, 1).length;
    }
    const lc = U.win(t, T_PING + 0.35, T_CHIP - 0.05, 0.25, 0.25) * vis;
    if (lc > 0 && st.labelCar >= 0) {
      const ps = traffic.poseAt(st.labelCar, t);
      hud.label('s04phones', [ps.pos.x, ps.pos.y + 4.4, ps.pos.z], `${st.phoneCount} phones in this piece`, { alpha: lc, dx: -60, dy: 130, color: P.phone, dotColor: P.phone });
    }
    const sa = U.win(t, 17.5, 21.35, 0.3, 0.35);
    if (sa > 0) hud.status({ label: 'LIVE · 58 MPH', color: P.live, alpha: sa });
  },

  camera(ctx, t) {
    const { U, world } = ctx;
    const hw = world.paths.highway;
    const s0 = st ? st.hs0 : 1271;
    // ground keyframes, relative to the piece start: [t, back, off, up, ahead, targetOff, fov]
    const K = [
      [T_DIVE1 - 0.3, 215, -16, 172, 250, 6, 32],
      [18.2, 186, -13, 150, 248, 6, 32],
      [19.9, 104, -11, 86, 160, 6.5, 33],
      [21.6, 66, -8, 58, 135, 7, 34],
    ];
    const ground = (tt) => {
      const v = U.track(K.map((k) => [k[0], k.slice(1)]), tt, (k) => 0.55 * k + 0.45 * U.smoother(k));
      const sway = Math.sin(tt * 0.5) * 2.5;
      const p = hw.side(s0 - v[0], v[1] + sway, v[2]);
      const q = hw.side(s0 - v[0] + v[3], v[4], 0);
      return { pos: U.arr(p), target: U.arr(q), fov: v[5], roll: 0 };
    };
    const ov = overviewPose(ctx, Math.min(t, T_DIVE0));
    if (t <= T_DIVE0) return ov;
    const gp = ground(Math.max(t, T_DIVE1 - 0.6));
    const k = U.easeInOut(U.inv(T_DIVE0, T_DIVE1, t));
    if (k >= 1) return ground(t);
    const lerp3 = (a, b, e) => a.map((v, j) => U.lerp(v, b[j], e));
    // target leads, position follows, so we swing down onto the road instead of zooming flat
    return { pos: lerp3(ov.pos, gp.pos, k), target: lerp3(ov.target, gp.target, U.smoother(U.inv(T_DIVE0, T_DIVE1 - 0.35, t))), fov: U.lerp(ov.fov, gp.fov, k), roll: 0 };
  },
};
