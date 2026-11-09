// util.js: small deterministic helpers shared by core and scenes  (import * as U from "/engine/core/util.js", or use ctx.U). Nothing here may use Math.random or wall time:
// every frame must be a pure function of t so stills and the final render match.
import * as THREE from 'three';

export function rng(seed) {            // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const inv = (a, b, x) => clamp((x - a) / (b - a));          // 0..1 progress of x through [a,b]
export const smooth = (k) => k * k * (3 - 2 * k);
export const smoother = (k) => k * k * k * (k * (k * 6 - 15) + 10);
export const easeOut = (k) => 1 - Math.pow(1 - k, 3);
export const easeIn = (k) => k * k * k;
export const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
export const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
// spring that settles: overshoot then rest at 1
export const spring = (k, freq = 3.2, damp = 5.5) => (k <= 0 ? 0 : 1 - Math.exp(-damp * k) * Math.cos(freq * Math.PI * k));

// fade window: 0 before t0, ramps in over fi, holds, ramps out over fo before t1
export function win(t, t0, t1, fi = 0.4, fo = 0.4) {
  if (t < t0 || t > t1) return 0;
  const a = fi > 0 ? clamp((t - t0) / fi) : 1;
  const b = fo > 0 ? clamp((t1 - t) / fo) : 1;
  return smooth(Math.min(a, b));
}

// keyframe track: keys = [[t, value], ...]; value = number | array; ease applied per span
export function track(keys, t, ease = smoother) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, va] = keys[i], [tb, vb] = keys[i + 1];
    if (t >= ta && t <= tb) {
      const k = ease((t - ta) / (tb - ta));
      if (Array.isArray(va)) return va.map((v, j) => lerp(v, vb[j], k));
      return lerp(va, vb, k);
    }
  }
  return last[1];
}

// camera pose helper: {pos:[x,y,z], target:[x,y,z], fov, roll}
export function pose(pos, target, fov = 35, roll = 0) { return { pos, target, fov, roll }; }

// pose keyframes: keys = [[t, pose], ...]
export function poseTrack(keys, t, ease = smoother) {
  return {
    pos: track(keys.map(([kt, p]) => [kt, p.pos]), t, ease),
    target: track(keys.map(([kt, p]) => [kt, p.target]), t, ease),
    fov: track(keys.map(([kt, p]) => [kt, p.fov ?? 35]), t, ease),
    roll: track(keys.map(([kt, p]) => [kt, p.roll ?? 0]), t, ease),
  };
}

// orbit helper: camera on a circle around target
export function orbit(target, dist, azimuthDeg, elevDeg, fov = 35) {
  const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevDeg);
  const pos = [
    target[0] + dist * Math.cos(el) * Math.sin(az),
    target[1] + dist * Math.sin(el),
    target[2] + dist * Math.cos(el) * Math.cos(az),
  ];
  return { pos, target, fov, roll: 0 };
}

export const v3 = (a) => (a.isVector3 ? a : new THREE.Vector3(a[0], a[1], a[2]));
export const arr = (v) => [v.x, v.y, v.z];

// deterministic smooth noise for handheld drift
export function drift(t, seed = 0) {
  return Math.sin(t * 0.83 + seed) * 0.5 + Math.sin(t * 1.71 + seed * 2.1) * 0.3 + Math.sin(t * 2.93 + seed * 3.7) * 0.2;
}

// pulse(t, at, len): 1 at time `at`, decays to 0 over len seconds (one-shot kick for squash / shake / flash)
export function pulse(t, at, len = 0.25) { const k = (t - at) / len; return k < 0 || k > 1 ? 0 : 1 - k; }
// hopAt(t, at, h, len): a single hop arc (0 -> h -> 0) starting at `at`
export function hopAt(t, at, h = 0.6, len = 0.32) { const k = (t - at) / len; return k <= 0 || k >= 1 ? 0 : Math.sin(k * Math.PI) * h; }
// landSquash(t, at): springy squash after a landing at time `at` (feed person.set({ squash }))
export function landSquash(t, at, amt = 0.35) { const d = t - at; return d < 0 ? 0 : amt * Math.exp(-d * 9) * Math.cos(d * 30); }
// blinkAt(t, seed): occasional 0/1 blink, different rhythm per seed
export function blinkAt(t, seed = 0) { return ((t * 0.9 + seed * 0.41) % 2.1) < 0.08 ? 1 : 0; }

// ---- shot lists (hard cuts on words) ----
// shots(list, end, minLen = 0.4): list = [[time, id], ...] (unsorted ok, null times dropped). MINIMUM GAP: a cut less than minLen
// (0.4 s) after the previous KEPT cut is dropped (a shot that short reads as a glitch), and the page logs
// "warning: U.shots dropped cut ..." naming it (reel.mjs lists it under warnings). Fix: cue it on a later word, drop it, or pass a
// smaller minLen on purpose. Returns [{ id, t0, t1 }] covering [first, end].
const _shotWarned = new Set();
export function shots(list, end, minLen = 0.4) {
  const L = list.filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [t, id] of L) {
    const prev = out[out.length - 1];
    if (prev && t - prev.t0 < minLen) {
      const msg = `warning: U.shots dropped cut '${id}' at ${t.toFixed(2)}s: only ${(t - prev.t0).toFixed(2)}s after cut '${prev.id}' at ${prev.t0.toFixed(2)}s (minimum gap ${minLen}s). Cue it on a later word, remove it, or pass minLen.`;
      if (!_shotWarned.has(msg)) { _shotWarned.add(msg); console.error(msg); }
      continue;
    }
    out.push({ id, t0: t });
  }
  out.forEach((s, i) => { s.t1 = i + 1 < out.length ? out[i + 1].t0 : end; });
  return out;
}
// shotAt(t, shotList) -> { id, t0, t1, k (0..1 through the shot), i }   (before the first shot = the first shot)
export function shotAt(t, S) {
  let i = 0; while (i + 1 < S.length && t >= S[i + 1].t0) i++;
  const s = S[i]; return { ...s, i, k: clamp((t - s.t0) / Math.max(0.001, s.t1 - s.t0)) };
}
// lerp3(a, b, k) for [x,y,z] arrays;  at(o, p) offsets a local point p by the station origin o
export const lerp3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
export const at = (o, p) => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];
// shot(o, posFrom, posTo, target, k, fov, roll): a camera pose drifting from posFrom to posTo (local coords) while looking at target
export function shot(o, from, to, target, k, fov = 40, roll = 0, targetTo = null) {
  const e = easeOut(k);
  return { pos: at(o, lerp3(from, to, e)), target: at(o, targetTo ? lerp3(target, targetTo, e) : target), fov, roll };
}
