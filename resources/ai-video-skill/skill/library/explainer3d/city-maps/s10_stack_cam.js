/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s10_stack_cam.js - Helper: splineCam
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: (helper, no line)
 * Shows:
 *   splineCam(keys, t, U): centripetal Catmull-Rom through camera keys, eases only at the first/last key so the move
 *   never parks between keys.
 * Techniques to steal:
 *   - drop-in smooth camera for any scene: keys = [[t, {pos, target, fov}], ...]
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
// smooth camera through keyframes (Catmull-Rom on position/target, no stop at each key)
import * as THREE from 'three';
export function splineCam(keys, t, U) {
  const n = keys.length;
  if (!keys._c) {
    keys._c = {
      pos: new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[1].pos)), false, 'centripetal'),
      tgt: new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[1].target)), false, 'centripetal'),
    };
  }
  const t0 = keys[0][0], t1 = keys[n - 1][0];
  const tc = U.clamp(t, t0, t1);
  let i = 0; while (i < n - 2 && tc > keys[i + 1][0]) i++;
  const f = (tc - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
  // gentle ease only at the first/last key so the move starts and settles but never stops in between
  let fe = f;
  if (i === 0 && n > 2) fe = f * f * (2 - f);              // ease in from rest, exits at unit speed
  if (i === n - 2 && n > 2) fe = 1 - (1 - f) * (1 - f) * (1 + f);
  if (n === 2) fe = U.easeInOut(f);
  const u = (i + U.clamp(fe)) / (n - 1);
  const p = keys._c.pos.getPoint(u), g = keys._c.tgt.getPoint(u);
  const fov = U.lerp(keys[i][1].fov ?? 35, keys[i + 1][1].fov ?? 35, U.smooth(f));
  return { pos: [p.x, p.y, p.z], target: [g.x, g.y, g.z], fov, roll: 0 };
}
