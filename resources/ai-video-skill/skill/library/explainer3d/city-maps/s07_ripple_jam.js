/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s07_ripple_jam.js - Shared jam mechanics (for s07_ripple and the original s09)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: (helper, no line)
 * Shows:
 *   Registers highway/ramp slowdowns with ctx.traffic, runs a small deterministic car-following sim for ramp lanes
 *   (InstancedMesh cars), exposes wave-front functions of t so ribbons and cars agree;
 *   ribbon/span/ringMesh/ringAt/spline helpers.
 * Techniques to steal:
 *   - wave fronts as pure functions of t (U.track keys) shared by visuals and simulation
 *   - deterministic car-following sim precomputed per frame (pure of t)
 *   - ribbon(...) + span(m, a, b): reveal any window of a strip along a path; ringAt for timed pulse rings
 *   - uses ctx.carGeometry: check the packaged core exposes it (else import from city.js)
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
// Shared jam mechanics for s07_ripple and s09_neighbor.
//  - registers the highway / ramp slowdowns with ctx.traffic (real cars brake, queues grow on their own)
//  - runs a small deterministic car-following sim for the exit ramp and the feeder ramp, because core's
//    one-shot ramp lanes (exitRamp, feeder) are empty by t≈20 s (their cars drive off once and never respawn)
//  - exposes the timing functions (wave fronts) so the ribbons and the cars agree.
import * as THREE from 'three';

let S = null;   // built once, shared by both scenes

// s07 timings, locked to the words (build/words_final.json)
export const T7 = {
  t0: 32.25, t1: 40.3,
  traffic: 33.62,      // "Traffic"
  backs: 35.95,        // "backs up"
  creeps: 37.04,       // "creeps backwards"
  feeding: 38.24,      // "roads feeding it"
  ripple: 39.40,       // "like a ripple"
  release: 41.3,       // jam lets go (camera is far above by then)
};
// s09 timings
export const T9 = {
  t0: 46.15, t1: 51.0,
  exit: 46.53, road: 47.73, learns: 48.85, next: 50.12,
  slowAt: 49.75,       // cars in the piece behind start braking (after the prediction lands)
};

// ---- wave fronts (pure functions of t) ----
const lin = (k) => k;
// exit ramp tail of the queue: whole ramp backs up over "backs up"
export function rampTail(U, len, t) {
  return U.track([[35.55, len + 2], [36.45, 0]], t, (k) => U.easeInOut(k));
}
// highway front (path s): from the exit back past the feeder merge and beyond
export function hwyFront(U, sExit, sFeed, t) {
  return U.track([[36.4, sExit + 3], [37.0, sExit - 22], [38.2, sFeed - 2], [39.6, sFeed - 105], [40.6, sFeed - 150]], t, lin);
}
// feeder front (feeder path s, 0 at the street, len at the merge): spreads back down the on-ramp
export function feedFront(U, len, t) {
  return U.track([[38.15, len + 2], [38.6, len - 45], [39.6, len - 150], [40.6, len - 200]], t, lin);
}

export function shared(ctx) {
  if (S) return S;
  const { THREE: T3, world, traffic, P, U } = ctx;
  const W = world.paths;
  const sExit = world.s.hwyExit, sFeed = world.s.hwyFeed;
  const rampLen = W.exitRamp.length, feedLen = W.feeder.length;

  // ---------- real traffic: highway queue that grows backwards (s07) ----------
  // a chain of zones, each switched on when the red front reaches it, so cars brake exactly as the wave passes
  for (let s = sExit + 4; s > sFeed - 160; s -= 14) {
    // time the front reaches s
    let tk = 36.4;
    for (let tt = 36.4; tt < 41; tt += 0.02) { if (hwyFront(U, sExit, sFeed, tt) <= s) { tk = tt; break; } }
    traffic.addSlow({ path: 'highway', s0: s, s1: sExit + 6, t0: tk - 0.15, t1: T7.release, tIn: 0.7, tOut: 1.4, ramp: 10, factor: 0.07, dir: 1 });
  }
  // s09: the piece behind the exit starts slowing AFTER the prediction (cause → effect)
  traffic.addSlow({ path: 'highway', s0: sFeed - 4, s1: sExit + 4, t0: T9.slowAt, t1: 55.5, tIn: 1.6, tOut: 2.0, ramp: 18, factor: 0.32, dir: 1 });
  // the ramps too (core's one-shot ramp lanes are empty by now, so these mostly document intent; our own sim below does the work)
  traffic.addSlow({ path: 'exitRamp', s0: 0, s1: rampLen, t0: T7.backs - 0.3, t1: 60, tIn: 0.8, factor: 0.05, dir: 1 });
  traffic.addSlow({ path: 'feeder', s0: feedLen - 200, s1: feedLen, t0: T7.feeding, t1: T7.release, tIn: 0.8, factor: 0.1, dir: 1 });

  // ---------- own ramp cars ----------
  const rampFactor = (s, t) => {
    if (t < 35.5) return 1;
    const tail = rampTail(U, rampLen, t);
    return 1 - 0.96 * U.smooth(U.clamp((s - (tail - 14)) / 14));
  };
  const feedFactor = (s, t) => {
    if (t < 38.1 || t > T7.release + 1.5) return 1;
    const rel = 1 - U.smooth(U.clamp((t - T7.release) / 1.5));
    const fr = feedFront(U, feedLen, t);
    return 1 - 0.92 * rel * U.smooth(U.clamp((s - (fr - 14)) / 14));
  };
  const lanes = [
    simLane(U, P, W.exitRamp, { seed: 11, v0: 15, prefill: 22, interval: (t) => (t < 35.5 ? 1.5 : 0.55), factor: rampFactor }),
    simLane(U, P, W.feeder, { seed: 12, v0: 16, prefill: 26, interval: (t) => (t < 37.8 ? 1.9 : (t < 42 ? 0.7 : 1.8)), factor: feedFactor }),
  ];
  const N = lanes.reduce((a, l) => a + l.cars.length, 0);
  const mat = new T3.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.08 });
  const mesh = new T3.InstancedMesh(ctx.carGeometry(), mat, N);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  let n = 0;
  for (const l of lanes) for (const c of l.cars) { c.inst = n++; mesh.setColorAt(c.inst, new T3.Color(c.color)); }
  mesh.instanceColor.needsUpdate = true;
  mesh.visible = false;
  ctx.scene.add(mesh);

  const M = new T3.Matrix4(), q = new T3.Quaternion(), e = new T3.Euler(), sc = new T3.Vector3(), up = new T3.Vector3(0, 1, 0);
  function updateCars(t) {
    // visible only in our two windows (s07 and s09, plus blend margins)
    const vis = (t > T7.t0 - 0.6 && t < T7.t1 + 0.7) || (t > T9.t0 - 0.6 && t < T9.t1 + 0.6);
    mesh.visible = vis;
    if (!vis) return;
    for (const l of lanes) {
      for (const c of l.cars) {
        const s = l.sAt(c, t);
        if (s == null) { M.makeScale(0, 0, 0); mesh.setMatrixAt(c.inst, M); continue; }
        const p = l.path.at(s), dir = l.path.tangent(s);
        const k = U.clamp(Math.min(s / 6, (l.path.length - s) / 7));
        e.set(Math.atan2(-dir.y, Math.hypot(dir.x, dir.z)), Math.atan2(dir.x, dir.z), 0, 'YXZ');
        q.setFromEuler(e);
        sc.setScalar(U.smooth(k));
        M.compose(p, q, sc);
        mesh.setMatrixAt(c.inst, M);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // mean live speed (mph) of real highway cars between s0..s1 (towards downtown)
  function mph(s0, s1, t) {
    const ids = traffic.carsOn('highway', s0, s1, t, 1);
    if (!ids.length) return 0;
    let sum = 0; for (const i of ids) sum += traffic.speedAt(i, t);
    return (sum / ids.length) * 2.237;
  }

  S = { updateCars, mph, lanes, sExit, sFeed, rampLen, feedLen };
  return S;
}

// deterministic single-lane car-following sim, precomputed at 30 fps between tA..tB
function simLane(U, P, path, { seed, v0, prefill, interval, factor, tA = 24, tB = 53, fps = 30 }) {
  const R = U.rng(seed), L = path.length, dt = 1 / fps, F = Math.ceil((tB - tA) * fps) + 1;
  const cars = [];
  const mk = (s) => { const c = { s, v: v0, color: P.cars[(R() * P.cars.length) | 0], track: new Float32Array(F).fill(NaN), f0: 0 }; cars.push(c); return c; };
  for (let s = L - 8; s > 4; s -= prefill * (0.75 + 0.5 * R())) mk(s);
  let next = tA + 0.5;
  const active = [...cars];
  for (let f = 0; f < F; f++) {
    const t = tA + f * dt;
    if (f > 0) {
      for (let k = 0; k < active.length; k++) {
        const c = active[k];
        if (c.done) continue;
        const target = v0 * factor(c.s, t) * (0.94 + 0.12 * ((c.color.charCodeAt(2) % 7) / 6));
        let v = c.v < target ? Math.min(target, c.v + 4.5 * dt) : Math.max(target, c.v - 11 * dt);
        let ns = c.s + v * dt;
        const lead = active.slice(0, k).reverse().find((x) => !x.done);
        if (lead) ns = Math.min(ns, Math.max(c.s, lead.s - 7.4));
        c.v = (ns - c.s) / dt; c.s = ns;
        if (c.s > L) c.done = true;
      }
    }
    // entry at the ramp mouth when there is room
    const last = [...active].reverse().find((x) => !x.done);
    if (t >= next && (!last || last.s > 10)) {
      const c = mk(0); c.f0 = f; c.v = v0 * factor(0, t); active.push(c);
      next = t + interval(t) * (0.75 + 0.5 * R());
    }
    for (const c of active) if (!c.done) c.track[f] = c.s;
  }
  return {
    path, cars,
    sAt(c, t) {
      const x = (t - tA) * fps;
      if (x < 0 || x > F - 1) return null;
      const f0 = Math.floor(x), k = x - f0;
      const a = c.track[f0], b = c.track[Math.min(F - 1, f0 + 1)];
      if (Number.isNaN(a)) return null;
      if (Number.isNaN(b)) return k < 0.5 ? a : null;
      return a + (b - a) * k;
    },
  };
}

// ---------- small builders ----------
export function ribbon(ctx, group, path, s0, s1, width, color, o = {}) {
  const geo = ctx.ribbonGeometry(path, s0, s1, width, { off: o.off ?? 0, dy: o.dy ?? 0.12, step: o.step ?? 1.5 });
  const mat = ctx.ribbonMaterial(color, { opacity: o.opacity ?? 1, glow: o.glow ?? 0, edge: o.edge ?? 0.12 });
  const m = new ctx.THREE.Mesh(geo, mat);
  m.renderOrder = o.order ?? 2;
  m.userData = { s0, s1, base: o.opacity ?? 1 };
  group.add(m);
  return m;
}
// set the visible window of a ribbon in path-s units
export function span(m, a, b, alpha = 1) {
  const { s0, s1, base } = m.userData;
  const u = (s) => (s - s0) / (s1 - s0);
  const lo = Math.min(u(a), u(b)), hi = Math.max(u(a), u(b));
  m.material.uniforms.from.value = lo;
  m.material.uniforms.to.value = hi;
  m.material.uniforms.opacity.value = base * alpha;
  m.visible = alpha > 0.002 && hi > 0 && lo < 1 && hi - lo > 1e-4;
}

export function ringMesh(ctx, group, color, { inner = 0.93, y = 0.4, depthTest = true, order = 3 } = {}) {
  const T3 = ctx.THREE;
  const m = new T3.Mesh(new T3.RingGeometry(inner, 1, 128), new T3.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, depthTest, side: T3.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = order;
  group.add(m);
  return m;
}
// a ring that expands from r0 to r1 over dur seconds starting at ts
export function ringAt(ctx, m, t, ts, dur, r0, r1, peak = 0.9) {
  const U = ctx.U;
  const k = (t - ts) / dur;
  if (k <= 0 || k >= 1) { m.visible = false; return; }
  m.visible = true;
  const r = U.lerp(r0, r1, U.expoOut(k));
  m.scale.set(r, r, r);
  m.material.opacity = peak * Math.min(1, k * 8) * Math.pow(1 - k, 1.6);
}

// smooth camera path through keys [[t, [values]]...]: Catmull-Rom per component, never stops at a key
export function spline(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1].slice();
  if (t >= keys[n - 1][0]) return keys[n - 1][1].slice();
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const k = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
  const p0 = keys[Math.max(0, i - 1)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(n - 1, i + 2)][1];
  const k2 = k * k, k3 = k2 * k;
  return p1.map((_, j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * k + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * k2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * k3));
}
