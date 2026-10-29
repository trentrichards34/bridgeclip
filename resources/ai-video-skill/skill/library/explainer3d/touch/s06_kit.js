/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s06_kit.js - Helper module for s07_pull
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: (helper, no line)
 * Shows:
 *   Pure helpers: crTrack (Catmull-Rom through keyed value arrays so the camera never stops between keys),
 *   samplePath, fract, patchXray (fix for the x-ray hand shader).
 * Techniques to steal:
 *   - crTrack: non-uniform Catmull-Rom over [[t, [values...]], ...] - drop-in smooth camera/value track
 *
 * NOTE - written against the ORIGINAL per-reel core of the studio reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   './lib.js'            -> '/engine/kits/studio.js' (same names: makePhone, makeGrid, makeHand, makeFinger,
 *                            makePen, makeCharges, makeFieldLines, makeDrop, makeLabel, makeIcon, studioFloor,
 *                            makeTouchRing, fade, bezier, rng, toV3, mixHex, glassify, capGlare, libEnv, HAND_POSES).
 *   '../core/palette.js'  -> ctx.P (studio palette: charge, chargeHot, body, dip, no, ok, wireCol, ...).
 *   core/util.js          -> ctx.U (same functions: clamp, lerp, inv, smooth, spring, backOut, track, poseTrack, orbit, ...).
 *   Word cues already use ctx.wordAt(word, spec.t0) ?? fallbackSeconds; the packaged spec.cue(word, fallbackFraction)
 *   works too. Builds at spec.o (its own station, units cm). Per-frame grade overrides: ctx.bg, ctx.flash, ctx.shake,
 *   ctx.bloomK, ctx.exposure, ctx.capDy. ctx.fx = DOM overlay layer.
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// shared little helpers for s06_body / s07_pull (pure functions only)
import * as THREE from 'three';

// Catmull-Rom through keyed values ([[t, [a, b, ...]], ...]) so the camera never stops dead between keys
export function crTrack(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1].slice();
  if (t >= keys[n - 1][0]) return keys[n - 1][1].slice();
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t1, p1] = keys[i], [t2, p2] = keys[i + 1];
  const p0 = (keys[i - 1] || keys[i])[1], p3 = (keys[i + 2] || keys[i + 1])[1];
  const t0 = (keys[i - 1] || [t1 - (t2 - t1)])[0], t3 = (keys[i + 2] || [t2 + (t2 - t1)])[0];
  const u = (t - t1) / (t2 - t1), u2 = u * u, u3 = u2 * u;
  const d1 = t2 - t1;
  return p1.map((a, k) => {
    const b = p2[k];
    // non-uniform tangents scaled to this span
    const m1 = ((b - p0[k]) / (t2 - t0)) * d1, m2 = ((p3[k] - a) / (t3 - t1)) * d1;
    return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * m2;
  });
}

// polyline sampled along a curve: at(s) -> V3, tan(s) -> unit V3
export function samplePath(fn, n = 160) {
  const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(i / n).clone());
  const at = (s, out = new THREE.Vector3()) => {
    const x = Math.min(n, Math.max(0, s * n)), i = Math.min(n - 1, Math.floor(x));
    return out.copy(pts[i]).lerp(pts[i + 1], x - i);
  };
  const tan = (s, out = new THREE.Vector3()) => {
    const a = at(Math.max(0, s - 0.01)), b = at(Math.min(1, s + 0.01));
    return out.copy(b).sub(a).normalize();
  };
  // two unit normals perpendicular to the path at s
  const frame = (s) => {
    const T = tan(s), ref = Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const N1 = new THREE.Vector3().crossVectors(T, ref).normalize(), N2 = new THREE.Vector3().crossVectors(T, N1).normalize();
    return { T, N1, N2 };
  };
  return { pts, at, tan, frame };
}

export const fract = (x) => x - Math.floor(x);

// work around a NaN in the lib's x-ray shell shader (pow of a tiny negative when a surface faces the camera head-on):
// with bloom one NaN pixel blacks out the whole frame. Patch our own hand's material copy only.
export function patchXray(hand) {
  hand.group.traverse((m) => {
    const mt = m.material;
    if (mt && mt.isShaderMaterial && mt.uniforms && mt.uniforms.uK && !mt.userData.nanFix && mt.fragmentShader.includes('1.0 - abs(dot(')) {
      mt.fragmentShader = mt.fragmentShader.replace('pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4)', 'pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))), 2.4)');
      mt.userData.nanFix = true; mt.needsUpdate = true;
    }
  });
}
