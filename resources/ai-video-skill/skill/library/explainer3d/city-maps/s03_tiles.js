/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s03_tiles.js - Route breaks into pieces (shared by s03_pieces + s04_live)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: "First, it breaks your trip into small pieces of road."
 * Shows:
 *   The route snaps into 8 tiles: gaps crack open on "breaks", tiles spring up and spread on "small pieces", number
 *   badges pop on "pieces"; later (s04) a live colour sweep runs through them and they land and dissolve back into
 *   the road.
 * Techniques to steal:
 *   - extruded walls along a path with a clip material (onBeforeCompile + "along" attribute discard = draw-on/cut)
 *   - one pure updateTiles(ctx, t) called by two scenes: shared objects across beats without state
 *   - fixed-pixel-size badges: sprite with sizeAttenuation false + pxScale(px, fov)
 *   - overviewPose + hazeFog: high overview camera with haze on the city
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
// Shared by s03_pieces and s04_live: the 8 route tiles ("pieces of road").
// Both scenes call updateTiles(ctx, t) every frame; it is a pure function of t, so calling it twice is harmless
// and either scene still works on its own with --only.
import * as THREE from 'three';
import { updateVeil, cityFog, RO } from './s01_lib.js';

const UP = new THREE.Vector3(0, 1, 0);
let S = null;

// timing (seconds, absolute)
export const T = {
  in0: 11.25, in1: 11.75,        // tiles fade in under s02's route line
  crack: 12.26,                   // "breaks": gaps open
  lift: 13.22,                    // "small pieces": tiles lift
  num: 13.5,                      // "pieces": numbers pop
  sweep: 14.62,                   // "every piece": live colours sweep through
  land: 15.45, gone: 16.35,       // dive: tiles settle and dissolve into the road
};
const TH = 24, W = 80, GAP = 24, LIFT = 88, BADGE_PX = 88;

// world-size sprite px helper (sizeAttenuation:false): px on a 1920-tall frame at fov
export const pxScale = (px, fov = 35) => (px / 960) * Math.tan(THREE.MathUtils.degToRad(fov / 2));

function clipMaterial(params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.u = { uFrom: { value: 0 }, uTo: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float along; varying float vAlong;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = along;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFrom, uTo; varying float vAlong;')
      .replace('void main() {', 'void main() {\nif (vAlong < uFrom || vAlong > uTo) discard;');
  };
  return m;
}

function wallGeo(path, s0, s1, width, y0, y1) {
  const n = Math.max(2, Math.ceil((s1 - s0) / 3));
  const pos = [], al = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, s = s0 + (s1 - s0) * k;
    const p = path.at(s), tg = path.tangent(s);
    const r = new THREE.Vector3().crossVectors(tg, UP).normalize();
    for (const sg of [-1, 1]) {
      const e = p.clone().addScaledVector(r, sg * width / 2);
      pos.push(e.x, e.y + y0, e.z, e.x, e.y + y1, e.z);
      al.push(k, k);
    }
    if (i < n) {
      const a = i * 4, b = a + 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);            // left wall
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // right wall
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(al, 1));
  g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  return ng;
}

function badgeTexture(n, P) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(128, 128, 114, 0, Math.PI * 2); x.fillStyle = P.ink; x.fill();
  x.lineWidth = 12; x.strokeStyle = '#e2dfd8'; x.stroke();
  // number + ring kept just under the bloom threshold so the dark disc stays dark
  x.fillStyle = '#e2dfd8'; x.font = '800 150px Inter'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 128, 138);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function initTiles(ctx) {
  if (S) return S;
  const { world, P } = ctx;
  const route = world.paths.route;
  S = { tiles: [], root: new THREE.Group() };
  S.root.visible = false;
  ctx.scene.add(S.root);
  for (const seg of world.segments) {
    const g = new THREE.Group();
    const L = seg.s1 - seg.s0;
    const topGeo = ctx.ribbonGeometry(route, seg.s0, seg.s1, W, { dy: TH, step: 3 });
    const uv = topGeo.getAttribute('uv');
    const al = new Float32Array(uv.count); for (let i = 0; i < uv.count; i++) al[i] = uv.getX(i);
    topGeo.setAttribute('along', new THREE.BufferAttribute(al, 1));
    const topMat = clipMaterial({ color: P.route, roughness: 0.55, emissive: P.route, emissiveIntensity: 0.45, transparent: true, fog: false });
    const sideMat = clipMaterial({ color: P.route, roughness: 0.8, transparent: true, fog: false });
    const top = new THREE.Mesh(topGeo, topMat);
    const side = new THREE.Mesh(wallGeo(route, seg.s0, seg.s1, W, 0.1, TH), sideMat);
    top.castShadow = side.castShadow = true;
    top.renderOrder = RO.tiles + 1; side.renderOrder = RO.tiles;   // drawn after the veil: crisp over the hazed city
    g.add(top, side);
    S.root.add(g);
    const mid = route.at(seg.mid);
    const tg = route.tangent(seg.mid); tg.y = 0; tg.normalize();
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false }));
    badge.renderOrder = RO.badge; badge.visible = false;
    S.root.add(badge);
    S.tiles.push({ seg, g, top, side, topMat, sideMat, L, mid, tg, badge, tex: null });
  }
  // faint footprint of the route on the ground, so lifted tiles read as "taken from the road"
  S.ghost = new THREE.Mesh(ctx.ribbonGeometry(route, 0, route.length, 16, { dy: 0.5, step: 3 }), ctx.ribbonMaterial(P.route, { opacity: 0 }));
  S.ghost.renderOrder = RO.shadow; S.ghost.material.depthTest = false;
  S.root.add(S.ghost);
  // glints that burst at each cut on "breaks"
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const gx = gc.getContext('2d'); const gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
  const gt = new THREE.CanvasTexture(gc);
  S.glints = world.segments.slice(0, -1).map((seg) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    sp.position.copy(route.at(seg.s1)).add(new THREE.Vector3(0, TH + 2, 0)); sp.renderOrder = RO.glint; sp.visible = false;
    S.root.add(sp); return { sp, i: seg.i };
  });
  S.cA = new THREE.Color(); S.cB = new THREE.Color();
  return S;
}

// live colour of each piece (index 5, just before the exit, is slowing)
export const liveColor = (P, i) => (i === 5 ? P.slow : P.live);

export function updateTiles(ctx, t) {
  const S = initTiles(ctx);
  const { U, P } = ctx;
  updateVeil(ctx, t);
  const vis = U.win(t, T.in0, T.gone + 0.05, T.in1 - T.in0, 0.0001);
  S.root.visible = vis > 0;
  if (!S.root.visible) { for (const ti of S.tiles) ti.badge.visible = false; return; }
  const n = S.tiles.length;
  for (const g of S.glints) {
    const k = U.inv(T.crack + g.i * 0.05, T.crack + g.i * 0.05 + 0.45, t);
    g.sp.visible = k > 0 && k < 1;
    g.sp.material.opacity = Math.pow(1 - k, 1.5);
    g.sp.scale.setScalar(40 + 150 * U.easeOut(k));
  }
  S.ghost.material.uniforms.opacity.value = 0.45 * U.smooth(U.inv(T.lift, T.lift + 0.5, t)) * (1 - U.smooth(U.inv(T.land, T.land + 0.5, t)));
  for (const ti of S.tiles) {
    const i = ti.seg.i;
    if (!ti.tex && document.fonts.check('800 68px Inter')) { ti.tex = badgeTexture(i + 1, P); ti.badge.material.map = ti.tex; ti.badge.material.needsUpdate = true; }
    // crack: gaps open in a cascade from the driveway end
    const kc = U.expoOut(U.inv(T.crack + i * 0.05, T.crack + i * 0.05 + 0.55, t));
    const gapM = GAP * kc;
    ti.topMat.userData.u.uFrom.value = i === 0 ? 0 : gapM / ti.L;
    ti.topMat.userData.u.uTo.value = i === n - 1 ? 1 : 1 - gapM / ti.L;
    ti.sideMat.userData.u.uFrom.value = ti.topMat.userData.u.uFrom.value;
    ti.sideMat.userData.u.uTo.value = ti.topMat.userData.u.uTo.value;
    // lift: small hop on the crack, big spring lift on "small pieces", settle back on the dive
    const kl = U.inv(T.lift + i * 0.045, T.lift + i * 0.045 + 0.9, t);
    const land = U.smoother(U.inv(T.land + (n - 1 - i) * 0.03, T.land + 0.6 + (n - 1 - i) * 0.03, t));
    const lift = (8 * kc + LIFT * U.spring(kl, 2.2, 5.0) * (i % 2 ? 0.85 : 1)) * (1 - land);
    const spread = (i - 3.5) * 9 * U.easeOut(kl) * (1 - land);
    ti.g.position.set(ti.tg.x * spread, lift, ti.tg.z * spread);
    // colour: blue route → its own live colour in a sweep
    const ks = U.inv(T.sweep + i * 0.085, T.sweep + i * 0.085 + 0.2, t);
    S.cA.set(P.route).lerp(S.cB.set(liveColor(P, i)), U.smooth(ks));
    ti.topMat.color.copy(S.cA); ti.topMat.emissive.copy(S.cA);
    const flash = Math.sin(Math.PI * U.clamp(ks)) * 0.9;
    // a quick white-ish crack glint while the gaps open
    const crackGlint = Math.sin(Math.PI * kc) * 0.25;
    ti.topMat.emissiveIntensity = 0.3 + flash + crackGlint;
    ti.sideMat.color.copy(S.cA).multiplyScalar(0.55);
    // fade: in with the route, out once landed on the road
    const fade = vis * (1 - U.smoother(U.inv(T.land + 0.2, T.gone - 0.2, t)));
    ti.topMat.opacity = fade; ti.sideMat.opacity = fade;
    ti.top.castShadow = ti.side.castShadow = fade > 0.6;
    ti.g.visible = fade > 0.002;
    // number badge
    const kb = U.inv(T.num + i * 0.05, T.num + i * 0.05 + 0.35, t);
    const ba = U.clamp(kb * 3) * (1 - U.smoother(U.inv(T.land - 0.1, T.land + 0.3, t)));
    ti.badge.visible = ba > 0.002 && !!ti.tex;
    ti.badge.material.opacity = ba;
    const sc = pxScale(BADGE_PX) * U.backOut(U.clamp(kb), 2.2);
    ti.badge.scale.set(sc, sc, 1);
    ti.badge.position.set(ti.mid.x + ti.tg.x * spread, ti.mid.y + lift + TH + 20, ti.mid.z + ti.tg.z * spread);
  }
}

// the overview camera both scenes share (route runs bottom→top of the vertical frame)
// Looks up the trip from the south-west (home near the bottom, downtown at the top) and pushes in so the
// 8 pieces fill the frame; s02 ends on this exact pose.
export function overviewPose(ctx, t) {
  const { U } = ctx;
  const k = U.inv(11.3, 15.5, t);
  const target = [U.lerp(20, 45, k), 0, U.lerp(70, 35, k)];
  return U.orbit(target, U.lerp(2750, 2350, U.easeInOut(k)), U.lerp(-32, -24, k), U.lerp(43, 44, k), 35);
}

// haze the city down while the tiles are the story (tiles ignore fog). f = 0..1 strength, d = camera distance
// (same depth fog as s01/s02, see s01_lib cityFog; fades out with the dive)
export function hazeFog(ctx, t, pose) {
  if (t > 16.4) return;
  const d = Math.hypot(pose.pos[0] - pose.target[0], pose.pos[1] - pose.target[1], pose.pos[2] - pose.target[2]);
  cityFog(ctx, t, d);
}
