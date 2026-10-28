// Small deterministic helpers shared by core and scenes. Nothing here may use Math.random or wall time:
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

// Catmull-Rom value track: keys = [[t, [a, b, c...]], ...] (sorted). Passes THROUGH every key without stopping at it
// (smooth velocity), unlike track(), which eases in and out of each key. Use it for flowing camera paths.
export function crTrack(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1].slice();
  if (t >= keys[n - 1][0]) return keys[n - 1][1].slice();
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t1, p1] = keys[i], [t2, p2] = keys[i + 1];
  const p0 = (keys[i - 1] || keys[i])[1], p3 = (keys[i + 2] || keys[i + 1])[1];
  const t0 = (keys[i - 1] || [t1 - (t2 - t1)])[0], t3 = (keys[i + 2] || [t2 + (t2 - t1)])[0];
  const u = (t - t1) / (t2 - t1), u2 = u * u, u3 = u2 * u, d1 = t2 - t1;
  return p1.map((a, k) => {
    const b = p2[k], m1 = ((b - p0[k]) / (t2 - t0)) * d1, m2 = ((p3[k] - a) / (t3 - t1)) * d1;
    return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * m2;
  });
}

// camera through pose keys with crTrack: keys = [[t, pose], ...] -> pose (pos/target flow through, fov/roll too)
export function poseSpline(keys, t) {
  const pos = crTrack(keys.map(([kt, p]) => [kt, p.pos]), t), target = crTrack(keys.map(([kt, p]) => [kt, p.target]), t);
  const [fov, roll] = crTrack(keys.map(([kt, p]) => [kt, [p.fov ?? 35, p.roll ?? 0]]), t);
  return { pos, target, fov, roll };
}

// impact helpers: a decaying wobble after time t0 (for flex / bounce) and a decaying pulse (for shake / flash)
export const wobble = (t, t0, freq = 32, decay = 7) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay) * Math.cos((t - t0) * freq));
export const pulse = (t, t0, decay = 9) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay));
