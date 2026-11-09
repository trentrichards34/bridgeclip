/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/touch/s08_kit.js - Helper module for s08_dip (and the original s09_pinch)
 * Look: studio (dark product-film studio, units cm, each beat at its own station spec.o)
 * Original spoken line: (helper, no line)
 * Shows:
 *   makeBracket (flat 4-corner targeting bracket, bloom-bright), makeTracker (a green TRACKING RING, not the gadgets
 *   tracker tag), camSpline (Catmull-Rom over full camera poses), add, V.
 * Techniques to steal:
 *   - makeBracket: reusable "lock-on" UI that lives in 3D
 *   - camSpline over {pos,target,fov,roll} keys
 *   - NAME CLASH: this makeTracker is a tracking ring; gadgets.js also exports makeTracker (the tag). Import with an alias if you use both.
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
// Helpers shared by s08_dip and s09_pinch: targeting brackets, tracking rings, a smooth camera spline.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// flat targeting bracket (4 L corners) lying in XZ, half-size `half`, line thickness `th`
const BOX = new THREE.BoxGeometry(1, 1, 1);
export function makeBracket(ctx, { half = 0.3, arm = 0.4, th = 0.05, color = '#ffffff', k = 2.2, plane = 'xz' } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false, transparent: true, depthWrite: false });
  const a = half * arm;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const m1 = new THREE.Mesh(BOX, mat); m1.scale.set(a, th * 0.4, th); m1.position.set(sx * (half - a / 2), 0, sz * half); g.add(m1);
    const m2 = new THREE.Mesh(BOX, mat); m2.scale.set(th, th * 0.4, a); m2.position.set(sx * half, 0, sz * (half - a / 2)); g.add(m2);
  }
  if (plane === 'xy') for (const m of g.children) { m.position.set(m.position.x, -m.position.z, 0); m.scale.set(m.scale.x, m.scale.z, m.scale.y); }
  g.renderOrder = 7; g.traverse((o) => { o.renderOrder = 7; o.frustumCulled = false; });
  const base = new THREE.Color(color);
  return {
    group: g, mat,
    set(pos, { s = 1, alpha = 1, color: c, k: kk = k, rot = 0, face = null } = {}) {
      g.visible = alpha > 0.002 && s > 0.001; if (!g.visible) return;
      g.position.copy(pos);
      if (face) { g.scale.set(s, s, 1); g.lookAt(face); g.rotateZ(rot); } else { g.scale.set(s, 1, s); g.rotation.set(0, rot, 0); }
      mat.color.copy(c ? new THREE.Color(c) : base).multiplyScalar(kk); mat.opacity = clamp(alpha);
    },
  };
}

// tracking ring: thin full ring + 3 rotating arc dashes, flat in XZ
export function makeTracker(ctx, { r = 1, color = '#34d27b', k = 2.4 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mat2 = mat.clone();
  const full = new THREE.Mesh(new THREE.RingGeometry(r * 0.97, r * 1.0, 96), mat2); full.rotation.x = -Math.PI / 2; g.add(full);
  const arcs = new THREE.Group(); g.add(arcs);
  for (let n = 0; n < 3; n++) { const m = new THREE.Mesh(new THREE.RingGeometry(r * 1.08, r * 1.2, 48, 1, n * (Math.PI * 2 / 3), Math.PI * 0.42), mat); m.rotation.x = -Math.PI / 2; arcs.add(m); }
  g.traverse((o) => { o.renderOrder = 7; o.frustumCulled = false; });
  const base = new THREE.Color(color);
  return {
    group: g,
    set(pos, { s = 1, alpha = 1, spin = 0, color: c } = {}) {
      g.visible = alpha > 0.002 && s > 0.001; if (!g.visible) return;
      g.position.copy(pos); g.scale.setScalar(s); arcs.rotation.y = spin;
      const col = c ? new THREE.Color(c) : base;
      mat.color.copy(col).multiplyScalar(k); mat2.color.copy(col).multiplyScalar(k * 0.6);
      mat.opacity = clamp(alpha); mat2.opacity = clamp(alpha) * 0.7;
    },
  };
}

// Catmull-Rom camera spline through keys [[t, {pos, target, fov, roll}], ...] (moves through keys, never stops)
function cr(p0, p1, p2, p3, k) {
  const k2 = k * k, k3 = k2 * k;
  return 0.5 * ((2 * p1) + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (-p0 + 3 * p1 - 3 * p2 + p3) * k3);
}
export function camSpline(keys, t, ease = (k) => k) {
  const n = keys.length;
  if (t <= keys[0][0]) return clone(keys[0][1]);
  if (t >= keys[n - 1][0]) return clone(keys[n - 1][1]);
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const k = ease((t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]));
  const P = (j) => keys[clamp(j, 0, n - 1)][1];
  const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
  const f = (key, x) => cr(a[key][x], b[key][x], c[key][x], d[key][x], k);
  const s = (key, def) => cr(a[key] ?? def, b[key] ?? def, c[key] ?? def, d[key] ?? def, k);
  return { pos: [0, 1, 2].map((x) => f('pos', x)), target: [0, 1, 2].map((x) => f('target', x)), fov: s('fov', 32), roll: s('roll', 0) };
}
function clone(p) { return { pos: [...p.pos], target: [...p.target], fov: p.fov ?? 32, roll: p.roll ?? 0 }; }
export const add = (a, d) => [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
export { V };
