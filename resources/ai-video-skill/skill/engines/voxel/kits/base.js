// base.js: the generic felt-toy voxel kit (materials, mesh + canvas helpers, rooms, paper props, FX).
// Everything here is topic-neutral; topic kits (people.js, shopfront.js, your own) build on it.
//   import * as L from '/engine/kits/base.js';
//
// RULES (all kits): units ~ a person is 2.4 tall; floor y = 0, +Y up, every prop faces +Z (camera sits at +Z).
// Builders only CREATE objects: call them in a scene's init() after `await L.libFonts()`. Factories return
// { group, ...handles, set(params) }; state persists between frames, so call set() EVERY frame with every key you animate
// (missing keys = rest pose). Deterministic: no Math.random / Date, use L.rng(seed). Geometry is cached; every factory
// makes fresh materials, so tint / fade instances freely.
//
// API
//   C                                   palette tokens: coral coralDark paper ink wood woodDark woodLight carpet wall gold yes no blue window
//                                       cream white black blonde hairBlack hairBlue green mustard purple paleBlue navy kraft terracotta leaf
//   libFonts()                          await once before building text props (Nunito 900 / Playfair Display / VT323)
//   FONT(key, px)                       css font string for key 'round' | 'serif' | 'pixel'
//   rng(seed) toV3(a) mixHex(a,b,k) bezier(a,ctrl,b,k) fade(obj, a)      helpers (fade multiplies opacity of a whole subtree, hides at 0;
//                                       composes with nested fades + props' own opacity: call after the prop's set())
//   pop(k, s=2.2)                       overshoot scale for pop-ins (never 0)
//   mat(color, {rough, metal, felt=1, scale=1, bump, map, emissive, ei, transparent, opacity, side, alphaTest, depthWrite})
//                                       MeshStandardMaterial + object-space triplanar FELT (fibres, painterly blotches, soft bump). felt:0 = plain
//   glowMat(color, k=1.6, {map, transparent, opacity, toneMapped, side, depthWrite, blending})   unlit, boosted: blooms (bulbs, screens, panes)
//   feltTexture() feltify(material, amt, scale, bump)                   the felt shader on any MeshStandardMaterial
//   B(w,h,d, material, {r=0.06, x,y,z, rx,ry,rz, cast, recv, parent})  bevelled box mesh (THE building block)
//   rbox(w,h,d,r) geo(key, make) cyl(rt,rb,h,seg) sph(r) mesh(geometry, material, {x,y,z,rx,ry,rz,parent})   cached geometry + mesh helper
//   rrShape(w,h,r) normUV(geo,w,h)      rounded-rect THREE.Shape (extrude it for slabs / pills) + planar UVs
//   ctex(w,h) -> {c,g,t,W,H}            canvas + CanvasTexture (sRGB). Paint, then t.needsUpdate = true
//   inkText(g, text, x, y, {font:'round'|'serif'|'pixel', size, color, maxW, align, wear, seed, rot, knock})   worn ink text, auto-shrinks to maxW
//   paperFill(g, W, H, paper, seed, grunge)   cream paper with stains + specks + vignette
//   drawLines(g, W, H, lines, seed)     centred auto-fitted lines ('TEXT' | {text,color,size,font,dx,wear})
//   splitTwo(text)                      split a phrase into 1-2 balanced lines
//   paperPanel(w,h,{paper,thick,back,felt}) -> {mesh, draw(fn(g,W,H), 'front'|'back')}   thin paper slab with a painted face
//   decal(w,h, draw(g,W,H), {ppu, felt, basic, op})   transparent painted plane (icons, logos, glass text)
// SET PIECES (origin floor centre unless noted)
//   makeRoom(ctx,{wall,floor,w,d,h,side:'left'|'right'|'both'|null,wainscot,wainH,trim,baseboard}) -> {group, wallZ, wallAt(x,y)}
//   makeWindow(ctx,{w,h,frame,shaft,shaftDir,shaftLen,shaftOpacity})   tall arched window with glowing panes (+ light shafts)
//   makeClock(ctx,{r}).set({h,m})   makeBookshelf(ctx,{w,h,d,shelves,seed})   makeLamp(ctx,{glow}) -> {group,bulb}
//   makePodium(ctx,{h,color}) -> {group, top}   makeDesk(ctx,{w,d,h,color}) -> {group, top}   makePlant(ctx,{pot,leaf,h,seed})
// PAPER PROPS (centre origin, face +Z unless noted)
//   makeCard(ctx,{w,h,lines,paper,pin,pinColor,seed,grunge,border}) -> {group, setLines(lines), draw(fn)}   pinned paper card
//   makeSign(ctx,{text,color,chart:'up'|'down'|null,back,w,h,stick,stickH}).set({flip})   flip sign on a stick (origin stick foot)
//   makePrint(ctx,{text,color,w,h,style:'fill'|'outline',sub}) -> Mesh      distressed ink stamp print decal
//   makeStamp(ctx,{text,color,w,d,sub}) -> {group, print, printSet(k)}     rubber stamp (face at y 0 pointing -Y) + its print
//   makeTally(ctx,{w,h,left,right,leftColor,rightColor}).set({a,b})        two-column chalkboard score
//   makeChecklist(ctx,{title,items,w,h,footer}).set({ticks:[0..1,...]})   ticks draw in per item
//   makeCertificate(ctx,{title,sub,w,h})   makePriceTag(ctx,text,{w=3.2,h=1.6,color,paper}).set({tear})   (centre origin)
//   makeCommentPill(ctx,{w,h,placeholder,avatar}).set({text, caret})     comment bar (type a keyword into it)
//   makeShoppingBag(ctx,{color,stripe})   makeMoneyBag(ctx,{color})   makeBallotBox(ctx,{label,w,h,d}) -> {group, slot}
// FX
//   makeSparkle(ctx,{n,size,color,seed}).set({k})   camera-facing 4-point stars; k 0..1 pops, twinkles, fades (~0.8 s)
//   makeConfetti(ctx,{n,spread,height,colors,seed}).set({k})   burst from origin; k 0..1 over ~1.5-2.4 s
//   makeBigX(ctx,{size,color})   makeBigCheck(ctx,{size,color})   chunky red X / green tick
//
// BLOOM GOTCHA: paper and whites under the warm key can cross the bloom threshold and haze the frame. If paper glows,
// lower ctx.exposure / ctx.bloomK for that beat instead of recolouring props.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const C = {
  coral: '#e2704f', coralDark: '#d9603e', paper: '#f3ead8', ink: '#2a211c', wood: '#7a4a2e', woodDark: '#5a3420',
  woodLight: '#9a6238', carpet: '#b8323a', wall: '#2c3f8f', gold: '#e0b24a', yes: '#3fae5a', no: '#d8433a',
  blue: '#3a5bd0', window: '#9cc4ff', cream: '#efe6d2', white: '#f7f4ee', black: '#17110f', blonde: '#f2c84b',
  hairBlack: '#2a2522', hairBlue: '#3f6fd8', green: '#2f5a45', mustard: '#d9a93a', purple: '#5b3f8f', paleBlue: '#a9c6dc',
  navy: '#27335e', kraft: '#c98f4f', terracotta: '#c0643a', leaf: '#3d8a46',
};

// ---------- tiny math ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const rad = (d) => (d * Math.PI) / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const toV3 = (a) => (a && a.isVector3 ? a.clone() : Array.isArray(a) ? V(a[0], a[1], a[2]) : V());
export function mixHex(a, b, k) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), clamp(k)).getHexString(); }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function bezier(a, c, b, k) { a = toV3(a); c = toV3(c); b = toV3(b); const u = 1 - k; return a.multiplyScalar(u * u).add(c.multiplyScalar(2 * u * k)).add(b.multiplyScalar(k * k)); }

// fade(obj, a): multiplies every material's opacity under obj by a; hides obj at 0. Composes with other fades and with props
// that animate their own opacity in set(): each material keeps its BASE opacity (stored once; re-read whenever something else
// wrote m.opacity since the last fade) and one factor per fading object (nested groups / shared materials multiply, not fight).
// Call it every frame AFTER the prop's set().
export function fade(obj, a) {
  a = clamp(a);
  obj.visible = a > 0.001;
  const key = obj.uuid;
  obj.traverse((o) => {
    if (!o.material || o.userData.noFade) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const u = m.userData;
      if (u.op0 === undefined) { u.op0 = m.opacity; u.tr0 = m.transparent; u.fades = {}; }
      else if (u.opLast !== undefined && m.opacity !== u.opLast) u.op0 = m.opacity;   // someone else set the base since our last write
      u.fades[key] = a;
      let k = 1; for (const f in u.fades) k *= u.fades[f];
      m.opacity = u.op0 * k; u.opLast = m.opacity;
      m.transparent = u.tr0 || k < 0.999;
    }
  });
}

// ---------- fonts ----------
// Call `await libFonts()` once in init BEFORE building any prop with text (text is painted into canvases at build time).
export async function libFonts() {
  try { await Promise.all([document.fonts.load('900 64px Nunito'), document.fonts.load('700 64px "Playfair Display"'), document.fonts.load('64px VT323')]); await document.fonts.ready; } catch (e) { /* fall back */ }
}
// font keys for inkText / drawLines: 'round' (Nunito Black, default), 'serif' (Playfair Display Bold), 'pixel' (VT323)
export const FONT = (f, s) => (f === 'serif' ? `700 ${s}px "Playfair Display", Georgia, Fallback`
  : f === 'pixel' ? `${s}px VT323, monospace, Fallback` : `900 ${s}px Nunito, "Arial Black", Fallback`);

// ---------- felt / painterly noise ----------
let FELT = null;
function hash2(i, j, s) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function pnoise(x, y, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const m = (a) => ((a % P) + P) % P;
  return lerp(lerp(hash2(m(xi), m(yi), s), hash2(m(xi + 1), m(yi), s), u), lerp(hash2(m(xi), m(yi + 1), s), hash2(m(xi + 1), m(yi + 1), s), u), v);
}
// R = fine fibrous felt, G = big soft painterly blotches, B = grain. Tileable, deterministic.
export function feltTexture() {
  if (FELT) return FELT;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  const blot = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let f = 0, amp = 0.5, tot = 0;
    for (const P of [8, 16, 32, 64, 128]) { f += amp * pnoise(u * P, v * P, P, P + 1); tot += amp; amp *= 0.62; }
    f /= tot;
    let b = 0; amp = 0.6; tot = 0;
    for (const P of [3, 6, 12, 24]) { b += amp * pnoise(u * P, v * P, P, P + 77); tot += amp; amp *= 0.55; }
    blot[y * N + x] = b / tot;
    const val = clamp((f - 0.5) * 1.8 + 0.5) * 255, i = (y * N + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = val; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const R = rng(91);
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    const x = R() * N, y = R() * N, a = R() * Math.PI * 2, L = 4 + R() * 16, light = R() > 0.5;
    g.strokeStyle = light ? `rgba(255,255,255,${0.10 + R() * 0.25})` : `rgba(0,0,0,${0.10 + R() * 0.22})`;
    g.lineWidth = 0.6 + R() * 1.1;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(a + 0.6) * L * 0.5, y + oy + Math.sin(a + 0.6) * L * 0.5, x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L); g.stroke();
    }
  }
  const im2 = g.getImageData(0, 0, N, N), d2 = im2.data, R2 = rng(17);
  for (let i = 0; i < N * N; i++) { d2[i * 4 + 1] = clamp((blot[i] - 0.5) * 2.2 + 0.5) * 255; d2[i * 4 + 2] = R2() * 255; }
  g.putImageData(im2, 0, 0);
  FELT = new THREE.CanvasTexture(c);
  FELT.wrapS = FELT.wrapT = THREE.RepeatWrapping; FELT.colorSpace = THREE.NoColorSpace; FELT.anisotropy = 4;
  return FELT;
}

// Injects object-space triplanar felt into a MeshStandardMaterial: diffuse tint (fine fibres + big blotches),
// roughness variation and a soft bump. Same program for every felt material (cheap).
export function feltify(m, amt = 1, scale = 1, bump = 1) {
  m.userData.felt = { amt, scale, bump };
  m.onBeforeCompile = (sh) => {
    const f = m.userData.felt;
    sh.uniforms.uFelt = { value: feltTexture() };
    sh.uniforms.uFeltAmt = { value: f.amt };
    sh.uniforms.uFeltScale = { value: f.scale };
    sh.uniforms.uFeltBump = { value: f.bump };
    sh.vertexShader = 'varying vec3 vFeltP;\nvarying vec3 vFeltN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFeltP = position; vFeltN = normal;');
    sh.fragmentShader = 'uniform sampler2D uFelt;\nuniform float uFeltAmt;\nuniform float uFeltScale;\nuniform float uFeltBump;\nvarying vec3 vFeltP;\nvarying vec3 vFeltN;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 fw = pow(abs(normalize(vFeltN)), vec3(4.0)); fw /= (fw.x + fw.y + fw.z + 1e-5);
  vec3 fp = vFeltP * uFeltScale * 0.42;
  vec4 fs = texture2D(uFelt, fp.yz) * fw.x + texture2D(uFelt, fp.xz) * fw.y + texture2D(uFelt, fp.xy) * fw.z;
  vec3 fq = vFeltP * uFeltScale * 0.05;
  float fbig = texture2D(uFelt, fq.yz).g * fw.x + texture2D(uFelt, fq.xz).g * fw.y + texture2D(uFelt, fq.xy).g * fw.z;
  float feltH = fs.r;
  diffuseColor.rgb *= mix(1.0, (0.74 + 0.40 * fs.r) * (0.82 + 0.34 * fbig) * (0.97 + 0.06 * fs.b), uFeltAmt);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + (feltH - 0.5) * 0.3 * uFeltAmt, 0.05, 1.0);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition); vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1); float bs = 0.006 * uFeltBump * uFeltAmt;
    vec3 grad = sign(det) * (dFdx(feltH) * bs * r1 + dFdy(feltH) * bs * r2); normal = normalize(abs(det) * normal - grad); }`);
  };
  m.customProgramCacheKey = () => 'felt1';
  return m;
}

// mat(color, { rough, metal, felt (0 = off), scale (felt frequency), bump, map, emissive, ei, transparent, opacity, side, alphaTest })
export function mat(color = '#ffffff', o = {}) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: o.rough ?? 0.9, metalness: o.metal ?? 0, map: o.map ?? null, transparent: !!o.transparent,
    opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, alphaTest: o.alphaTest ?? 0,
  });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
  if (o.depthWrite === false) m.depthWrite = false;
  const f = o.felt ?? 1; if (f > 0) feltify(m, f, o.scale ?? 1, o.bump ?? 1);
  return m;
}
// a glowing material (bulbs, window panes): unlit, colour boosted so it blooms
export function glowMat(color, k = 1.6, o = {}) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), map: o.map ?? null, transparent: !!o.transparent, opacity: o.opacity ?? 1, toneMapped: o.toneMapped ?? true, side: o.side ?? THREE.FrontSide, depthWrite: o.depthWrite ?? true, blending: o.blending ?? THREE.NormalBlending });
}

// ---------- geometry cache + mesh helpers ----------
const GEO = new Map();
export const geo = (key, make) => { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; };
export function rbox(w, h, d, r = 0.08, seg = 3) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  if (r <= 0.004) return geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  return geo(`rb${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r));
}
export const cyl = (rt, rb, h, s = 20, open = false) => geo(`c${rt},${rb},${h},${s},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open));
export const sph = (r, ws = 20, hs = 14) => geo(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export function mesh(g, m, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true, recv = true, parent = null } = {}) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = cast; o.receiveShadow = recv;
  if (parent) parent.add(o); return o;
}
// B(w,h,d, material, { r = bevel, x,y,z, rx,ry,rz, cast, recv, parent }): bevelled box mesh
export function B(w, h, d, m, o = {}) { return mesh(rbox(w, h, d, o.r ?? 0.06), m, o); }
export function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2; r = Math.min(r, x, y);
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
export function normUV(g, w, h, ox = 0, oy = 0) { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - ox) / w + 0.5, (p.getY(i) - oy) / h + 0.5); return g; }

// ---------- canvas / paper helpers ----------
export function ctex(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t, W: c.width, H: c.height };
}
function fitSize(g, text, font, size, maxW) {
  let s = size; g.font = FONT(font, s);
  while (g.measureText(text).width > maxW && s > 6) { s *= 0.95; g.font = FONT(font, s); }
  return s;
}
// ink text with a little wear (specks punched out). Returns the font size used.
export function inkText(g, text, x, y, { font = 'round', size = 60, color = C.ink, maxW = 1e9, align = 'center', wear = 0.18, seed = 1, rot = 0, knock = false } = {}) {
  const s = fitSize(g, text, font, size, maxW);
  const tw = Math.ceil(g.measureText(text).width + s), th = Math.ceil(s * 1.5);
  const t = document.createElement('canvas'); t.width = tw; t.height = th; const q = t.getContext('2d');
  q.font = FONT(font, s); q.fillStyle = color; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(text, tw / 2, th / 2 + s * 0.06);
  if (wear > 0) {
    const R = rng(seed * 13 + 5); q.globalCompositeOperation = 'destination-out';
    const n = Math.round((tw * th) / 70 * wear);
    for (let i = 0; i < n; i++) { q.globalAlpha = 0.2 + R() * 0.7; q.beginPath(); q.arc(R() * tw, R() * th, 0.5 + R() * R() * Math.min(s * 0.045, 5), 0, 7); q.fill(); }
  }
  g.save(); g.translate(x, y); g.rotate(rot);
  if (knock) g.globalCompositeOperation = 'destination-out';
  const ox = align === 'left' ? -s / 2 : align === 'right' ? -tw + s / 2 : -tw / 2;
  g.drawImage(t, ox, -th / 2); g.restore();
  return s;
}
export function paperFill(g, W, H, paper = C.paper, seed = 1, grunge = 1) {
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.fillStyle = paper; g.fillRect(0, 0, W, H);
  if (grunge <= 0) return;
  const R = rng(seed * 7 + 3), M = Math.max(W, H);
  for (let i = 0; i < Math.round(7 * grunge); i++) {
    const x = R() * W, y = R() * H, r = (0.08 + R() * 0.3) * M, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(150,105,55,${0.05 + R() * 0.06})`); gr.addColorStop(1, 'rgba(150,105,55,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < (W * H) / 1400 * grunge; i++) { g.fillStyle = `rgba(80,58,36,${0.04 + R() * 0.14})`; g.fillRect(R() * W, R() * H, 1 + R() * 2.5, 1 + R() * 2.5); }
  for (let i = 0; i < 60 * grunge; i++) { g.strokeStyle = `rgba(110,80,50,${0.04 + R() * 0.08})`; g.lineWidth = 1; const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 30, y + (R() - 0.5) * 30); g.stroke(); }
  const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.56);
  gr.addColorStop(0, 'rgba(120,85,40,0)'); gr.addColorStop(1, `rgba(120,85,40,${0.28 * grunge})`); g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
// lay out text lines centred on a canvas. line = 'TEXT' | { text, color, size (fraction of H), font: 'round'|'serif'|'pixel', dx, wear }
export function drawLines(g, W, H, lines, seed = 1, padF = 0.08) {
  const L = lines.map((l) => (typeof l === 'string' ? { text: l } : l));
  if (!L.length) return;
  const sz = L.map((l) => fitSize(g, l.text, l.font, (l.size ?? (L.length > 2 ? 0.2 : 0.3)) * H, W * (1 - 2 * padF)));
  const gap = 0.14, total = sz.reduce((a, s) => a + s, 0) + gap * sz[0] * (L.length - 1);
  let y = H / 2 - total / 2;
  L.forEach((l, i) => { const s = sz[i]; inkText(g, l.text, W / 2 + (l.dx ?? 0) * W, y + s / 2, { font: l.font, size: s, color: l.color ?? C.ink, seed: seed + i, wear: l.wear ?? 0.15 }); y += s * (1 + gap); });
}
// a thin paper slab (w x h, facing +Z) with a canvas on the front (and optionally the back)
export function paperPanel(w, h, { paper = C.paper, thick = 0.03, back = false, felt = 0.35, ppu = 230, cap = 1400 } = {}) {
  const s = Math.min(ppu, cap / Math.max(w, h));
  const F = ctex(w * s, h * s), Bk = back ? ctex(w * s, h * s) : null;
  const side = mat(paper, { felt: 0.5 });
  const fm = mat('#ffffff', { map: F.t, felt });
  const bm = Bk ? mat('#ffffff', { map: Bk.t, felt }) : mat(mixHex(paper, '#8a7a60', 0.12), { felt: 0.6 });
  const m = new THREE.Mesh(rbox(w, h, thick, 0), [side, side, side, side, fm, bm]); m.castShadow = true; m.receiveShadow = true;
  return { mesh: m, front: F, back: Bk, mats: [side, fm, bm], draw(fn, which = 'front') { const T = which === 'back' ? Bk : F; fn(T.g, T.W, T.H); T.t.needsUpdate = true; } };
}

// decal(w, h, draw(g, W, H), { ppu, felt, basic, op }): transparent plane facing +Z with a canvas painted once (icons, logos, text on glass)
export function decal(w, h, fn, { ppu = 220, felt = 0, basic = false, op = 1 } = {}) {
  const T = ctex(w * ppu, h * ppu); fn(T.g, T.W, T.H); T.t.needsUpdate = true;
  const m = basic ? new THREE.MeshBasicMaterial({ map: T.t, transparent: true, depthWrite: false, opacity: op })
    : mat('#ffffff', { map: T.t, transparent: true, felt, depthWrite: false, opacity: op });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  const p = new THREE.Mesh(geo(`plane${w},${h}`, () => new THREE.PlaneGeometry(w, h)), m); p.renderOrder = 2; p.receiveShadow = true; return p;
}
// pop(k, s): 0..1 -> scale with overshoot, never exactly 0 (safe for .scale.setScalar)
export const pop = (k, s = 2.2) => (k <= 0 ? 0.001 : k >= 1 ? 1 : Math.max(0.001, backOut(k, s)));

// =====================================================================================================
// SET PIECES
// =====================================================================================================
function archShape(w, h) {
  const s = new THREE.Shape(), r = w / 2, cy = h - r;
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, cy); s.absarc(0, cy, r, 0, Math.PI, false); s.lineTo(-r, 0); return s;
}
let PANE = null;
function paneTex() {
  if (PANE) return PANE;
  const T = ctex(256, 512), g = T.g;
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#e4f1ff'); gr.addColorStop(0.45, '#a9cdf8'); gr.addColorStop(1, '#5f8fdc');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
  const R = rng(4); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + R() * 0.08})`; g.beginPath(); g.arc(R() * 256, R() * 512, 6 + R() * 30, 0, 7); g.fill(); }
  g.strokeStyle = '#efe6d2'; g.lineWidth = 9;
  for (const x of [85, 171]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 128; y < 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  g.beginPath(); g.arc(128, 128, 64, Math.PI, 0); g.stroke();
  PANE = T.t; return PANE;
}
let SHAFT = null;
function shaftTex() {
  if (SHAFT) return SHAFT;
  const T = ctex(64, 256), g = T.g;
  for (let y = 0; y < 256; y++) { const a = Math.pow(1 - y / 256, 1.4) * 0.9; const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, y, 64, 1); }
  SHAFT = T.t; return SHAFT;
}
// tall arched window with glowing cold-blue panes (faces +Z, bottom at y = 0)
export function makeWindow(ctx, { w = 4.4, h = 9.5, frame = C.cream, shaft = false, shaftDir = [0, -0.7, 1], shaftLen = 22, shaftOpacity = 0.08 } = {}) {
  const group = new THREE.Group(), f = 0.32;
  const shape = archShape(w + 2 * f, h + f);
  const hole = archShape(w, h); const holePath = new THREE.Path(hole.getPoints(24).map((p) => new THREE.Vector2(p.x, p.y + f * 0.5)));
  shape.holes.push(holePath);
  const fg = geo(`winF${w},${h}`, () => new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 24 }));
  mesh(fg, mat(frame, { scale: 1.2 }), { y: -f * 0.5, parent: group });
  const pg = geo(`winP${w},${h}`, () => normUV(new THREE.ShapeGeometry(archShape(w, h), 24), w, h, 0, h / 2));
  mesh(pg, glowMat('#ffffff', 1.25, { map: paneTex() }), { z: 0.08, cast: false, recv: false, parent: group });
  B(w + 1.0, 0.3, 0.7, mat(frame), { r: 0.05, y: -0.25, z: 0.2, parent: group });   // sill
  if (shaft) {
    const sm = glowMat('#9cc4ff', 1, { map: shaftTex(), transparent: true, opacity: shaftOpacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const dir = toV3(shaftDir).normalize();
    const sg = geo(`shaft${w},${shaftLen}`, () => new THREE.PlaneGeometry(w * 0.95, shaftLen).translate(0, -shaftLen / 2, 0));
    for (const a of [0, Math.PI / 2]) {
      const s = mesh(sg, sm, { y: h * 0.55, z: 0.2, cast: false, recv: false, parent: group });
      s.quaternion.setFromUnitVectors(V(0, -1, 0), dir); s.rotateY(a); s.userData.noFade = false;
    }
  }
  return { group };
}
// round wall clock, faces +Z, centre at origin. set({ h, m })
export function makeClock(ctx, { r = 1.4 } = {}) {
  const group = new THREE.Group();
  const T = ctex(256, 256), g = T.g;
  paperFill(g, 256, 256, '#f6efdc', 3, 0.6);
  g.strokeStyle = C.ink; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.lineWidth = i % 3 ? 3 : 7; g.beginPath(); g.moveTo(128 + Math.sin(a) * 104, 128 - Math.cos(a) * 104); g.lineTo(128 + Math.sin(a) * (i % 3 ? 92 : 84), 128 - Math.cos(a) * (i % 3 ? 92 : 84)); g.stroke(); }
  [['12', 0], ['3', 3], ['6', 6], ['9', 9]].forEach(([s, i]) => { const a = (i / 12) * Math.PI * 2; inkText(g, s, 128 + Math.sin(a) * 66, 128 - Math.cos(a) * 66, { font: 'serif', size: 34, wear: 0.05 }); });
  T.t.needsUpdate = true;
  mesh(geo(`clockFace${r}`, () => new THREE.CircleGeometry(r, 40)), mat('#fff', { map: T.t, felt: 0.3 }), { z: 0.13, cast: false, parent: group });   // body front is at z 0.1: keep the face clear of it (no z-fight)
  mesh(geo(`clockRim${r}`, () => new THREE.TorusGeometry(r + 0.06, 0.14, 10, 40)), mat(C.gold, { rough: 0.4, metal: 0.4 }), { z: 0.12, parent: group });
  mesh(cyl(r, r, 0.2, 40), mat(C.woodDark), { rx: Math.PI / 2, parent: group });
  const handM = mat(C.ink, { felt: 0 });
  const hh = new THREE.Group(), mh = new THREE.Group(); hh.position.z = mh.position.z = 0.16; group.add(hh, mh);
  B(0.1, r * 0.5, 0.04, handM, { r: 0, y: r * 0.22, parent: hh }); B(0.07, r * 0.78, 0.04, handM, { r: 0, y: r * 0.36, z: 0.03, parent: mh });
  mesh(cyl(0.08, 0.08, 0.08, 10), handM, { rx: Math.PI / 2, z: 0.2, parent: group });
  const c = { group, set({ h = 10, m = 10 } = {}) { mh.rotation.z = -(m / 60) * Math.PI * 2; hh.rotation.z = -((h % 12) / 12 + m / 720) * Math.PI * 2; return c; } };
  return c.set();
}
// bookshelf against a wall (back at z = 0, faces +Z, floor y = 0)
export function makeBookshelf(ctx, { w = 5, h = 9, d = 1.4, shelves = 5, seed = 1 } = {}) {
  const group = new THREE.Group(), wm = mat(C.woodDark), wl = mat(C.wood);
  B(w, h, 0.2, wm, { r: 0.02, y: h / 2, z: 0.1, parent: group });
  for (const s of [-1, 1]) B(0.25, h, d, wl, { r: 0.04, x: s * (w / 2 - 0.125), y: h / 2, z: d / 2, parent: group });
  const sh = (h - 0.4) / shelves;
  for (let i = 0; i <= shelves; i++) B(w, 0.18, d, wl, { r: 0.03, y: 0.2 + i * sh, z: d / 2, parent: group });
  B(w + 0.3, 0.3, d + 0.2, mat(C.gold, { rough: 0.5, metal: 0.3 }), { r: 0.04, y: h + 0.1, z: d / 2, parent: group });
  const cols = ['#8c2f2f', '#2f4f8c', '#3f7a4a', '#c79a3a', '#6b3f7a', '#a0522d', '#2a4a5a', '#d8c9a8'];
  const R = rng(seed + 40), items = [];
  for (let i = 0; i < shelves; i++) {
    let x = -w / 2 + 0.35; const y0 = 0.29 + i * sh;
    while (x < w / 2 - 0.5) { const bw = 0.16 + R() * 0.16, bh = sh * (0.6 + R() * 0.3); if (R() < 0.08) { x += 0.3; continue; } items.push([x + bw / 2, y0 + bh / 2, bw, bh, cols[(R() * cols.length) | 0], R() < 0.1 ? 0.25 : 0]); x += bw + 0.02; }
  }
  const im = new THREE.InstancedMesh(geo('unitBox', () => new THREE.BoxGeometry(1, 1, 1)), mat('#ffffff', { scale: 3 }), items.length);
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  items.forEach(([x, y, bw, bh, col, tilt], i) => { M4.compose(V(x, y, d * 0.45), q.setFromEuler(e.set(0, 0, tilt)), V(bw, bh, d * 0.75)); im.setMatrixAt(i, M4); im.setColorAt(i, new THREE.Color(col)); });
  im.castShadow = true; im.receiveShadow = true; group.add(im);
  return { group };
}
// brass wall sconce with a warm glowing bulb (back plate at z = 0, faces +Z)
export function makeLamp(ctx, { glow = 1 } = {}) {
  const group = new THREE.Group(), gm = mat(C.gold, { rough: 0.35, metal: 0.5, felt: 0.4 });
  B(0.5, 0.8, 0.1, gm, { r: 0.03, z: 0.05, parent: group });
  B(0.1, 0.1, 0.6, gm, { r: 0.02, z: 0.35, y: -0.1, parent: group });
  const bulb = mesh(sph(0.22, 14, 10), glowMat('#ffd08a', 2.2 * glow, { toneMapped: false }), { y: 0.15, z: 0.65, cast: false, parent: group });
  mesh(cyl(0.22, 0.42, 0.45, 14, true), mat('#f6e6c4', { side: THREE.DoubleSide, emissive: '#ffb860', ei: 0.6, felt: 0.4 }), { y: 0.3, z: 0.65, cast: false, parent: group });
  return { group, bulb };
}
export function makePodium(ctx, { h = 2.0, color = C.wood } = {}) {
  const group = new THREE.Group(), wm = mat(color), wd = mat(C.woodDark), gm = mat(C.gold, { rough: 0.45, metal: 0.3 });
  B(1.7, 0.22, 1.3, wd, { r: 0.05, y: 0.11, parent: group });
  B(1.3, h - 0.4, 0.95, wm, { r: 0.06, y: (h - 0.4) / 2 + 0.2, parent: group });
  B(0.9, h - 0.9, 0.06, wd, { r: 0.02, y: (h - 0.4) / 2 + 0.2, z: 0.49, parent: group });
  B(1.75, 0.2, 1.3, wd, { r: 0.05, y: h - 0.05, rx: -0.22, parent: group });
  B(1.8, 0.08, 0.1, gm, { r: 0.02, y: h - 0.12, z: 0.66, parent: group });
  return { group, top: V(0, h, 0) };
}
export function makeDesk(ctx, { w = 4.2, d = 1.8, h = 1.6, color = C.wood } = {}) {
  const group = new THREE.Group(), wm = mat(color), wd = mat(C.woodDark), gm = mat(C.gold, { rough: 0.45, metal: 0.3 });
  B(w + 0.25, 0.22, d + 0.25, wd, { r: 0.05, y: h - 0.11, parent: group });
  B(w, h - 0.22, 0.16, wm, { r: 0.04, y: (h - 0.22) / 2, z: d / 2 - 0.08, parent: group });
  for (const s of [-1, 1]) B(0.16, h - 0.22, d, wm, { r: 0.04, x: s * (w / 2 - 0.08), y: (h - 0.22) / 2, parent: group });
  for (const s of [-1, 1]) B(w / 2 - 0.5, h - 0.75, 0.06, wd, { r: 0.02, x: s * w / 4, y: (h - 0.22) / 2, z: d / 2 + 0.01, parent: group });
  B(w + 0.3, 0.07, 0.07, gm, { r: 0.02, y: h - 0.24, z: d / 2 + 0.1, parent: group });
  return { group, top: h };
}
export function makePlant(ctx, { pot = C.terracotta, leaf = C.leaf, h = 1.6, seed = 2 } = {}) {
  const group = new THREE.Group(), pm = mat(pot), lm = mat(leaf, { rough: 0.8 });
  B(1.0, 0.85, 1.0, pm, { r: 0.08, y: 0.425, parent: group });
  B(1.12, 0.18, 1.12, pm, { r: 0.05, y: 0.82, parent: group });
  const R = rng(seed);
  for (let i = 0; i < 7; i++) { const a = (i / 7 - 0.5) * 1.6, L = h * (0.7 + R() * 0.4); B(0.2, L, 0.08, lm, { r: 0.04, x: Math.sin(a) * L * 0.35, y: 0.85 + Math.cos(a) * L * 0.45, z: (R() - 0.5) * 0.4, rz: -a * 0.8, ry: (R() - 0.5) * 0.8, parent: group }); }
  return { group };
}

// ---------- simple rooms (back wall + floor + side wall) ----------
export function makeRoom(ctx, { wall = C.mustard, floor = C.woodDark, w = 26, d = 18, h = 18, side = 'left', wainscot = null, wainH = 3, trim = null, baseboard = true } = {}) {
  const group = new THREE.Group(), wm = mat(wall, { scale: 0.55, rough: 0.97 }), fm = mat(floor, { scale: 0.7 });
  B(w, 0.4, d, fm, { r: 0, y: -0.2, parent: group });
  B(w, h, 0.5, wm, { r: 0, y: h / 2, z: -d / 2 - 0.25, parent: group });
  if (side === 'left' || side === 'both') B(0.5, h, d, wm, { r: 0, x: -w / 2 - 0.25, y: h / 2, parent: group });
  if (side === 'right' || side === 'both') B(0.5, h, d, wm, { r: 0, x: w / 2 + 0.25, y: h / 2, parent: group });
  let y0 = 0;
  if (wainscot) {
    const wsm = mat(wainscot); B(w, wainH, 0.3, wsm, { r: 0.04, y: wainH / 2, z: -d / 2 + 0.15, parent: group }); y0 = wainH;
    for (let x = -w / 2 + 1.5; x < w / 2 - 1; x += 2.6) B(2.0, wainH - 1, 0.1, mat(mixHex(wainscot, '#000', 0.2)), { r: 0.03, x, y: wainH / 2, z: -d / 2 + 0.33, parent: group });
  }
  if (trim) B(w, 0.18, 0.4, mat(trim, { rough: 0.5, metal: 0.3 }), { r: 0.04, y: y0 + 0.09, z: -d / 2 + 0.2, parent: group });
  if (baseboard && !wainscot) B(w, 0.4, 0.16, mat(mixHex(floor, '#000', 0.25)), { r: 0.03, y: 0.2, z: -d / 2 + 0.08, parent: group });
  return { group, wallZ: -d / 2, wallAt: (x, y, lift = 0.05) => V(x, y, -d / 2 + lift) };
}

// =====================================================================================================
// PAPER PROPS (call after await libFonts())
// =====================================================================================================
function makePin(color) {
  const g = new THREE.Group(), m = mat(color, { rough: 0.4, felt: 0.2 });
  mesh(cyl(0.11, 0.11, 0.08, 16), m, { rx: Math.PI / 2, z: 0.08, parent: g });
  mesh(cyl(0.06, 0.08, 0.1, 12), m, { rx: Math.PI / 2, z: 0.15, parent: g });
  mesh(sph(0.075, 12, 8), m, { z: 0.22, parent: g });
  return g;
}
// pinned paper card (faces +Z, centre origin)
export function makeCard(ctx, { w = 2.6, h = 1.7, lines = ['YOUR', { text: 'IDEA', color: C.no }], paper = C.paper, pin = true, pinColor = C.no, seed = 1, grunge = 1, border = null } = {}) {
  const group = new THREE.Group(), P = paperPanel(w, h, { paper });
  group.add(P.mesh);
  const draw = (L) => P.draw((g, W, H) => { paperFill(g, W, H, paper, seed, grunge); if (border) { g.strokeStyle = border; g.lineWidth = H * 0.025; g.strokeRect(H * 0.05, H * 0.05, W - H * 0.1, H - H * 0.1); } drawLines(g, W, H, L, seed); });
  draw(lines);
  if (pin) { const p = makePin(pinColor); p.position.set(0, h / 2 - 0.2, 0.0); group.add(p); }
  return { group, panel: P.mesh, w, h, setLines: draw, draw: (fn) => P.draw((g, W, H) => { paperFill(g, W, H, paper, seed, grunge); fn(g, W, H); }) };
}
export function splitTwo(text) {
  if (text.includes('\n')) return text.split('\n');
  if (text.length <= 9 || !text.includes(' ')) return [text];
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return [text.slice(0, best), text.slice(best + 1)];
}
function drawChart(g, x, y, w, h, kind, color) {
  g.strokeStyle = C.ink; g.lineWidth = w * 0.022; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h); g.lineTo(x + w, y + h); g.stroke();
  const pts = kind === 'up' ? [[0.05, 0.85], [0.28, 0.62], [0.45, 0.7], [0.68, 0.38], [0.92, 0.1]] : [[0.05, 0.12], [0.28, 0.4], [0.45, 0.3], [0.68, 0.62], [0.92, 0.88]];
  g.strokeStyle = color; g.lineWidth = w * 0.05; g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo : g.moveTo).call(g, x + u * w, y + v * h)); g.stroke();
  const [a, b] = pts.slice(-2), ang = Math.atan2((b[1] - a[1]) * h, (b[0] - a[0]) * w), L = w * 0.16, ex = x + b[0] * w, ey = y + b[1] * h;
  g.fillStyle = color; g.beginPath(); g.moveTo(ex + Math.cos(ang) * L * 0.5, ey + Math.sin(ang) * L * 0.5); g.lineTo(ex + Math.cos(ang + 2.5) * L, ey + Math.sin(ang + 2.5) * L); g.lineTo(ex + Math.cos(ang - 2.5) * L, ey + Math.sin(ang - 2.5) * L); g.closePath(); g.fill();
}
// big flip sign on a stick. Origin = bottom of the stick (or board bottom if stick:false). set({ flip }) 0 = back ('?') to camera, 1 = front
export function makeSign(ctx, { text = 'IT WILL FAIL', color = C.no, chart = 'down', back = '?', w = 2.6, h = 3.2, stick = true, stickH = 1.5, paper = C.paper, seed = 3 } = {}) {
  const group = new THREE.Group(), sh = stick ? stickH : 0;
  const pivot = new THREE.Group(); pivot.position.y = sh + h / 2; group.add(pivot);
  const P = paperPanel(w, h, { paper, back: true, thick: 0.06 }); pivot.add(P.mesh);
  P.draw((g, W, H) => {
    paperFill(g, W, H, paper, seed);
    const L = splitTwo(text), top = chart ? 0.06 : 0.5 - L.length * 0.11;
    L.forEach((s, i) => inkText(g, s, W / 2, H * (top + 0.1 + i * 0.19), { size: H * 0.17, maxW: W * 0.86, color, seed: seed + i, wear: 0.2 }));
    if (chart) drawChart(g, W * 0.16, H * (top + 0.1 + L.length * 0.19 + 0.02), W * 0.68, H * 0.36, chart, color);
  });
  P.draw((g, W, H) => { paperFill(g, W, H, paper, seed + 9); if (back) inkText(g, back, W / 2, H / 2, { size: H * 0.6, maxW: W * 0.8, color: '#d39a52', seed: seed + 5, wear: 0.15 }); }, 'back');
  if (stick) B(0.16, sh + 0.4, 0.12, mat(C.woodLight), { r: 0.03, y: (sh + 0.4) / 2, z: -0.1, parent: group });
  const c = { group, pivot, board: P.mesh, set({ flip = 1 } = {}) { pivot.rotation.y = Math.PI * (1 - clamp(flip)); return c; } };
  return c.set();
}
// ink print decal (filled block with knocked-out paper text, distressed). Plane facing +Z, centre origin.
export function makePrint(ctx, { text = 'YES!', color = C.yes, w = 1.6, h = 0.8, style = 'fill', seed = 7, sub = null } = {}) {
  const s = 300, T = ctex(w * s, h * s), g = T.g, W = T.W, H = T.H, R = rng(seed);
  g.clearRect(0, 0, W, H);
  const pad = H * 0.06, rr = H * 0.1;
  g.fillStyle = color; g.strokeStyle = color;
  const rrect = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); };
  if (style === 'fill') {
    rrect(pad, pad, W - 2 * pad, H - 2 * pad, rr); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.lineWidth = H * 0.035; rrect(pad + H * 0.08, pad + H * 0.08, W - 2 * pad - H * 0.16, H - 2 * pad - H * 0.16, rr * 0.6); g.stroke(); g.globalCompositeOperation = 'source-over';
    inkText(g, text, W / 2, sub ? H * 0.42 : H / 2, { size: H * (sub ? 0.42 : 0.55), maxW: W * 0.78, knock: true, wear: 0, seed });
    if (sub) inkText(g, sub, W / 2, H * 0.74, { size: H * 0.2, maxW: W * 0.6, knock: true, wear: 0, seed: seed + 1 });
  } else {
    g.lineWidth = H * 0.07; rrect(pad, pad, W - 2 * pad, H - 2 * pad, rr); g.stroke();
    inkText(g, text, W / 2, H / 2, { size: H * 0.55, maxW: W * 0.78, color, wear: 0, seed });
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (W * H) / 260; i++) { g.globalAlpha = 0.3 + R() * 0.7; g.beginPath(); g.arc(R() * W, R() * H, 0.8 + R() * R() * 5, 0, 7); g.fill(); }
  for (let i = 0; i < 6; i++) { g.globalAlpha = 0.15 + R() * 0.25; const x = R() * W, y = R() * H, gr = g.createRadialGradient(x, y, 0, x, y, H * (0.2 + R() * 0.4)); gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  T.t.needsUpdate = true;
  const m = mat('#ffffff', { map: T.t, transparent: true, felt: 0.3, depthWrite: false });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  const p = new THREE.Mesh(geo(`plane${w},${h}`, () => new THREE.PlaneGeometry(w, h)), m); p.renderOrder = 2; p.receiveShadow = true;
  return p;
}
// wooden rubber stamp: rubber face at y = 0 facing -Y, handle up. Returns { group, print } (print = separate decal mesh,
// not added to anything: put it on a card at z = +0.02 and pop it with stamp.printSet(k)).
export function makeStamp(ctx, { text = 'YES!', color = C.yes, w = 1.5, d = 0.85, sub = null } = {}) {
  const group = new THREE.Group(), wm = mat(C.woodLight), wd = mat('#4a2a18');
  B(w, 0.1, d, mat(mixHex(color, '#000', 0.35), { rough: 0.6 }), { r: 0.03, y: 0.05, parent: group });
  B(w + 0.06, 0.42, d + 0.06, wm, { r: 0.06, y: 0.31, parent: group });
  const T = ctex(256, 72); paperFill(T.g, 256, 72, C.paper, 2, 0.5); inkText(T.g, text, 128, 38, { size: 46, maxW: 220, color, wear: 0.1 }); T.t.needsUpdate = true;
  mesh(geo(`stLab${w}`, () => new THREE.PlaneGeometry(w * 0.7, w * 0.7 * 72 / 256)), mat('#fff', { map: T.t, felt: 0.3 }), { y: 0.31, z: (d + 0.06) / 2 + 0.005, cast: false, parent: group });
  mesh(cyl(0.13, 0.17, 0.5, 14), wd, { y: 0.77, parent: group });
  mesh(sph(0.3, 18, 12), wd, { y: 1.15, parent: group }).scale.y = 0.85;
  const print = makePrint(ctx, { text, color, w: w * 1.05, h: d * 1.05, sub });
  const c = { group, print, printSet(k) { print.visible = k > 0.001; const s = 1 + 0.25 * (1 - smooth(clamp(k * 1.6))); print.scale.setScalar(s); print.material.opacity = clamp(k * 3); return c; } };
  return c;
}
// two-column chalkboard tally. Faces +Z, origin = bottom centre of the frame. makeTally(ctx, { left: 'NO', right: 'YES' })
// set({ a, b }) = the two counts (rounded; redraws only on change)
export function makeTally(ctx, { w = 6, h = 4, left = 'NO', right = 'YES', leftColor = '#f0857a', rightColor = '#8ee09a', seed = 21 } = {}) {
  const group = new THREE.Group(), wm = mat(C.wood);
  B(w + 0.5, h + 0.5, 0.25, wm, { r: 0.06, y: (h + 0.5) / 2, parent: group });
  B(w + 0.8, 0.18, 0.5, wm, { r: 0.04, y: 0.2, z: 0.25, parent: group });
  const T = ctex(w * 180, h * 180);
  mesh(geo(`plane${w},${h}`, () => new THREE.PlaneGeometry(w, h)), mat('#ffffff', { map: T.t, felt: 0.5, rough: 1 }), { y: (h + 0.5) / 2, z: 0.13, cast: false, parent: group });
  for (let i = 0; i < 2; i++) B(0.4, 0.08, 0.08, mat('#f4f1ea', { felt: 0 }), { r: 0.02, x: -1 + i * 0.6, y: 0.33, z: 0.35, parent: group });
  let key = '';
  const c = {
    group,
    set({ a = 0, b = 0 } = {}) {
      const ra = Math.round(a), rb = Math.round(b), k = ra + '/' + rb; if (k === key) return c; key = k;
      const g = T.g, W = T.W, H = T.H, R = rng(seed);
      g.globalCompositeOperation = 'source-over'; g.fillStyle = '#25382d'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + R() * 0.04})`; g.beginPath(); g.ellipse(R() * W, R() * H, 40 + R() * 160, 14 + R() * 40, R() * 3, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(240,240,230,0.75)'; g.lineWidth = 8; g.beginPath(); g.moveTo(W / 2, H * 0.08); g.lineTo(W / 2 + 6, H * 0.92); g.stroke();
      inkText(g, left, W * 0.25, H * 0.17, { size: H * 0.11, maxW: W * 0.44, color: leftColor, wear: 0.35, seed: 1 });
      inkText(g, right, W * 0.75, H * 0.17, { size: H * 0.11, maxW: W * 0.44, color: rightColor, wear: 0.35, seed: 2 });
      inkText(g, String(ra), W * 0.25, H * 0.6, { size: H * 0.52, color: leftColor, wear: 0.12, seed: 3 + ra });
      inkText(g, String(rb), W * 0.75, H * 0.6, { size: H * 0.52, color: rightColor, wear: 0.12, seed: 30 + rb });
      T.t.needsUpdate = true; return c;
    },
  };
  return c.set();
}
// checklist sheet. Faces +Z, centre origin. set({ ticks: [0..1, ...] }) green ticks draw in (redraws when they change)
export function makeChecklist(ctx, { title = 'CHECKLIST', items = ['Step one', 'Step two', 'Step three'], w = 3.4, h = 4.4, seed = 31, footer = null } = {}) {
  const group = new THREE.Group(), P = paperPanel(w, h, { paper: '#f6eedb', thick: 0.03 }); group.add(P.mesh);
  let key = null;
  const c = {
    group, panel: P.mesh,
    set({ ticks = [] } = {}) {
      const q = items.map((_, i) => Math.round(clamp(ticks[i] ?? 0) * 12) / 12), k = q.join(','); if (k === key) return c; key = k;
      P.draw((g, W, H) => {
        paperFill(g, W, H, '#f6eedb', seed);
        inkText(g, title, W / 2, H * 0.1, { font: 'serif', size: H * 0.085, color: '#9a4a32', wear: 0.2, seed });
        g.strokeStyle = 'rgba(154,74,50,0.6)'; g.lineWidth = H * 0.006; g.beginPath(); g.moveTo(W * 0.12, H * 0.165); g.lineTo(W * 0.88, H * 0.165); g.stroke();
        const n = items.length, top = H * 0.28, step = Math.min(H * 0.2, (H * (footer ? 0.5 : 0.62)) / Math.max(1, n - 1 || 1));
        items.forEach((s, i) => {
          const y = top + i * step, bs = H * 0.075, bx = W * 0.09;
          g.strokeStyle = C.ink; g.lineWidth = H * 0.008; g.strokeRect(bx, y - bs / 2, bs, bs);
          inkText(g, s, bx + bs * 1.45, y, { size: H * 0.058, maxW: W * 0.7, align: 'left', color: C.ink, wear: 0.12, seed: seed + i });
          const t = q[i];
          if (t > 0) {
            const p0 = [bx + bs * 0.1, y], p1 = [bx + bs * 0.45, y + bs * 0.45], p2 = [bx + bs * 1.25, y - bs * 0.85];
            const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), L = (l1 + l2) * t;
            g.strokeStyle = C.yes; g.lineWidth = H * 0.022; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(...p0);
            if (L <= l1) g.lineTo(p0[0] + (p1[0] - p0[0]) * L / l1, p0[1] + (p1[1] - p0[1]) * L / l1);
            else { g.lineTo(...p1); const k2 = (L - l1) / l2; g.lineTo(p1[0] + (p2[0] - p1[0]) * k2, p1[1] + (p2[1] - p1[1]) * k2); }
            g.stroke();
          }
        });
        if (footer) inkText(g, footer, W / 2, H * 0.88, { size: H * 0.1, color: C.yes, wear: 0.2, seed: seed + 9 });
      });
      return c;
    },
  };
  return c.set();
}
// framed certificate. Faces +Z, centre origin
export function makeCertificate(ctx, { title = 'BEST IN CLASS', sub = 'OF THE MONTH', w = 3.0, h = 2.1, seed = 41 } = {}) {
  const group = new THREE.Group(), P = paperPanel(w, h, { paper: '#f5ecd6', thick: 0.04 }); group.add(P.mesh);
  P.draw((g, W, H) => {
    paperFill(g, W, H, '#f5ecd6', seed, 0.8);
    g.strokeStyle = '#c9a050'; g.lineWidth = H * 0.018; g.strokeRect(H * 0.05, H * 0.05, W - H * 0.1, H - H * 0.1); g.lineWidth = H * 0.006; g.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16);
    inkText(g, title, W / 2, H * 0.3, { size: H * 0.2, maxW: W * 0.8, color: C.ink, wear: 0.12, seed });
    inkText(g, sub, W / 2, H * 0.48, { size: H * 0.085, color: C.no, wear: 0.12, seed: seed + 1 });
    g.strokeStyle = 'rgba(42,33,28,0.5)'; g.lineWidth = H * 0.012; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(W * 0.14, H * (0.66 + i * 0.1)); g.lineTo(W * 0.62, H * (0.66 + i * 0.1)); g.stroke(); }
    const sx = W * 0.8, sy = H * 0.72, sr = H * 0.13;
    g.fillStyle = C.no; g.beginPath(); g.moveTo(sx - sr * 0.6, sy); g.lineTo(sx - sr * 0.9, sy + sr * 1.6); g.lineTo(sx - sr * 0.3, sy + sr * 1.2); g.lineTo(sx, sy); g.fill();
    g.fillStyle = '#d9a93a'; g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.fill(); g.strokeStyle = '#b07e22'; g.lineWidth = sr * 0.15; g.beginPath(); g.arc(sx, sy, sr * 0.7, 0, 7); g.stroke();
  });
  const fm = mat(C.gold, { rough: 0.45, metal: 0.3 }), f = 0.12;
  for (const s of [-1, 1]) { B(w + 2 * f, f, 0.1, fm, { r: 0.03, y: s * (h / 2 + f / 2), parent: group }); B(f, h, 0.1, fm, { r: 0.03, x: s * (w / 2 + f / 2), parent: group }); }
  return { group };
}
// price tag with a hole + string; set({ tear }) 0..1 rips it in two. Faces +Z, centre origin
// default 3.2 x 1.6: the price reads ≥ 80 px and '/MONTH' ≥ 40 px at a 9-10 unit prop shot (fov 46). Pass w/h (keep 2:1) to scale.
export function makePriceTag(ctx, text = '$49/month', { w = 3.2, h = 1.6, color = C.no, paper = '#f1e2c2', seed = 51 } = {}) {
  const group = new THREE.Group(), s = 300, Wp = Math.round(w * s), Hp = Math.round(h * s);
  const full = document.createElement('canvas'); full.width = Wp; full.height = Hp; const g = full.getContext('2d');
  const notch = Hp * 0.35;
  const tagPath = () => { g.beginPath(); g.moveTo(notch, 0); g.lineTo(Wp, 0); g.lineTo(Wp, Hp); g.lineTo(notch, Hp); g.lineTo(0, Hp / 2); g.closePath(); };
  paperFill(g, Wp, Hp, paper, seed, 1);
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = '#000'; tagPath(); g.fill(); g.globalCompositeOperation = 'source-over';   // opaque mask (paperFill leaves a translucent fillStyle)
  const [main, per] = text.includes('/') ? [text.slice(0, text.indexOf('/')), '/' + text.slice(text.indexOf('/') + 1)] : [text, ''];
  inkText(g, main, Wp * 0.58, Hp * (per ? 0.39 : 0.5), { size: Hp * (per ? 0.52 : 0.6), maxW: Wp * 0.64, color, wear: 0.12, seed });
  if (per) inkText(g, per.toUpperCase(), Wp * 0.58, Hp * 0.8, { size: Hp * 0.25, maxW: Wp * 0.62, color, wear: 0.12, seed: seed + 1 });
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(notch * 0.75, Hp / 2, Hp * 0.07, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(120,85,40,0.6)'; g.lineWidth = 4; g.beginPath(); g.arc(notch * 0.75, Hp / 2, Hp * 0.09, 0, 7); g.stroke();
  const R = rng(seed), jag = []; for (let i = 0; i <= 10; i++) jag.push([Wp * (0.5 + (R() - 0.5) * 0.08), (i / 10) * Hp]);
  const half = (left) => {
    const T = ctex(Wp, Hp), q = T.g; q.save(); q.beginPath();
    if (left) { q.moveTo(0, 0); jag.forEach(([x, y]) => q.lineTo(x, y)); q.lineTo(0, Hp); } else { q.moveTo(Wp, 0); jag.forEach(([x, y]) => q.lineTo(x, y)); q.lineTo(Wp, Hp); }
    q.closePath(); q.clip(); q.drawImage(full, 0, 0); q.restore(); T.t.needsUpdate = true;
    const m = mat('#ffffff', { map: T.t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, felt: 0.4 });
    const piv = new THREE.Group(); const mm = mesh(geo(`plane${w},${h}`, () => new THREE.PlaneGeometry(w, h)), m, { parent: piv }); mm.customDepthMaterial = new THREE.MeshDepthMaterial({ map: T.t, alphaTest: 0.4, depthPacking: THREE.RGBADepthPacking });
    group.add(piv); return piv;
  };
  const L = half(true), Rh = half(false);
  const holeX = -w / 2 + (notch * 0.75) / s;
  const str = B(0.03, 1.2, 0.03, mat('#e8dcc0'), { r: 0, x: holeX, y: 0.6, parent: L });
  const c = {
    group, left: L, right: Rh, string: str, hole: V(holeX, 0, 0),
    set({ tear = 0 } = {}) { const k = clamp(tear); L.rotation.z = 0.25 * k; L.position.set(-0.15 * k, 0.05 * k, 0); Rh.rotation.z = -0.9 * k; Rh.position.set(0.5 * k, -1.2 * k * k, 0.1 * k); return c; },
  };
  return c.set();
}
// social-app style comment bar (generic, no logos). Faces +Z, centre origin. set({ text, caret }) (caret 0..1 alpha, blinking is up to you)
export function makeCommentPill(ctx, { w = 6.4, h = 0.95, placeholder = 'Add a comment...', avatar = C.blue } = {}) {
  const group = new THREE.Group();
  const slab = geo(`pill${w},${h}`, () => { const e = new THREE.ExtrudeGeometry(rrShape(w, h, h / 2), { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 16 }); e.translate(0, 0, -0.15); return e; });
  mesh(slab, mat('#d9d9d9', { felt: 0.3, rough: 0.7 }), { parent: group });
  const s = 220, T = ctex(w * s, h * s);
  mesh(geo(`pillF${w},${h}`, () => normUV(new THREE.ShapeGeometry(rrShape(w, h, h / 2), 16), w, h)), new THREE.MeshBasicMaterial({ map: T.t, color: new THREE.Color(0.8, 0.8, 0.8), toneMapped: false }), { z: 0.005, cast: false, recv: false, parent: group });
  let key = null;
  const c = {
    group,
    set({ text = '', caret = 0 } = {}) {
      const k = text + '|' + (caret > 0.5 ? 1 : 0); if (k === key) return c; key = k;
      const g = T.g, W = T.W, H = T.H;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      const ax = H * 0.55, r = H * 0.32;
      g.fillStyle = avatar; g.beginPath(); g.arc(ax, H / 2, r, 0, 7); g.fill();   // generic avatar: head + shoulders
      g.save(); g.beginPath(); g.arc(ax, H / 2, r, 0, 7); g.clip(); g.fillStyle = '#fbf6ea';
      g.beginPath(); g.arc(ax, H / 2 - r * 0.18, r * 0.36, 0, 7); g.fill(); g.beginPath(); g.ellipse(ax, H / 2 + r * 0.78, r * 0.68, r * 0.52, 0, 0, 7); g.fill(); g.restore();
      const tx = H * 1.05;
      let endX = tx;
      if (text) { const sz = inkText(g, text, tx, H / 2, { size: H * 0.5, maxW: W * 0.62, align: 'left', color: '#111', wear: 0 }); g.font = FONT('round', sz); endX = tx + g.measureText(text).width + H * 0.08; }
      else { inkText(g, placeholder, tx, H / 2, { size: H * 0.3, maxW: W * 0.6, align: 'left', color: '#9b9b9b', wear: 0 }); }
      if (caret > 0.5) { g.fillStyle = '#3897f0'; g.fillRect(endX, H * 0.22, H * 0.05, H * 0.56); }
      inkText(g, 'Post', W - H * 0.9, H / 2, { size: H * 0.3, color: text ? '#3897f0' : '#a9cdf5', wear: 0 });
      T.t.needsUpdate = true; return c;
    },
  };
  return c.set();
}
export function makeShoppingBag(ctx, { color = '#e8c547', stripe = '#ffffff' } = {}) {
  const group = new THREE.Group(), m = mat(color);
  B(0.95, 1.05, 0.45, m, { r: 0.03, y: 0.525, parent: group });
  B(0.97, 0.12, 0.47, mat(mixHex(color, '#000', 0.15)), { r: 0.02, y: 1.0, parent: group });
  B(0.97, 0.14, 0.47, mat(stripe), { r: 0.02, y: 0.45, parent: group });
  const hg = geo('bagHandle', () => new THREE.TorusGeometry(0.22, 0.035, 6, 14, Math.PI));
  mesh(hg, mat('#3a2a1e'), { y: 1.05, z: 0.12, parent: group }); mesh(hg, mat('#3a2a1e'), { y: 1.05, z: -0.12, parent: group });
  return { group };
}
export function makeMoneyBag(ctx, { color = '#c8a165' } = {}) {
  const group = new THREE.Group(), m = mat(color, { scale: 2 });
  mesh(sph(0.6, 22, 16), m, { y: 0.55, parent: group }).scale.set(1, 0.92, 0.9);
  mesh(cyl(0.16, 0.26, 0.3, 14), m, { y: 1.1, parent: group });
  mesh(cyl(0.36, 0.14, 0.28, 14), m, { y: 1.36, parent: group });
  mesh(geo('bagTie', () => new THREE.TorusGeometry(0.18, 0.05, 6, 16)), mat(C.gold, { rough: 0.4, metal: 0.3 }), { y: 1.18, rx: Math.PI / 2, parent: group });
  const T = ctex(256, 256); inkText(T.g, '$', 128, 135, { size: 220, color: '#2f6b3a', wear: 0.1 }); T.t.needsUpdate = true;
  mesh(geo('dollar', () => new THREE.PlaneGeometry(0.75, 0.75)), mat('#fff', { map: T.t, transparent: true, felt: 0.2, depthWrite: false }), { y: 0.55, z: 0.555, cast: false, parent: group });
  return { group };
}
// kraft box with a slot and a green label (ballots, suggestions, tips...)
export function makeBallotBox(ctx, { label = 'BALLOTS', w = 2.0, h = 1.3, d = 1.3 } = {}) {
  const group = new THREE.Group();
  B(w, h, d, mat(C.kraft, { scale: 1.5 }), { r: 0.05, y: h / 2, parent: group });
  B(w * 0.5, 0.04, 0.12, mat('#2a1a10'), { r: 0, y: h + 0.005, parent: group });
  const T = ctex(400, 120); T.g.fillStyle = C.green; T.g.fillRect(0, 0, 400, 120); T.g.strokeStyle = '#f4ead0'; T.g.lineWidth = 6; T.g.strokeRect(10, 10, 380, 100); inkText(T.g, label, 200, 62, { size: 64, maxW: 340, color: '#f4ead0', wear: 0.15 }); T.t.needsUpdate = true;
  mesh(geo(`bbLab${w}`, () => new THREE.PlaneGeometry(w * 0.62, w * 0.62 * 0.3)), mat('#fff', { map: T.t, felt: 0.3 }), { y: h * 0.55, z: d / 2 + 0.01, cast: false, parent: group });
  return { group, slot: V(0, h, 0) };
}

// =====================================================================================================
// FX
// =====================================================================================================
const _bq = new THREE.Quaternion();
function billboard(m) {
  m.onBeforeRender = (r, s, cam) => { if (!m.parent) return; m.parent.getWorldQuaternion(_bq); m.quaternion.copy(_bq.invert().multiply(cam.quaternion)); m.updateMatrix(); m.matrixWorld.multiplyMatrices(m.parent.matrixWorld, m.matrix); m.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, m.matrixWorld); m.normalMatrix.getNormalMatrix(m.modelViewMatrix); };
}
// sparkle burst (camera-facing 4-point stars). set({ k }) 0..1: pop, twinkle, fade. size = overall radius
export function makeSparkle(ctx, { n = 5, size = 1.2, color = '#fff2c2', seed = 61 } = {}) {
  const group = new THREE.Group(), R = rng(seed);
  const star = geo('star4', () => { const s = new THREE.Shape(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.2 : 1; (i ? s.lineTo : s.moveTo).call(s, Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); return new THREE.ShapeGeometry(s); });
  const m = glowMat(color, 2.4, { transparent: true, toneMapped: false, depthWrite: false });
  const items = [];
  for (let i = 0; i < n; i++) {
    const holder = new THREE.Group(); group.add(holder);
    const a = R() * Math.PI * 2, r = i === 0 ? 0 : size * (0.45 + R() * 0.55);
    holder.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    const s = new THREE.Mesh(star, m); s.renderOrder = 5; billboard(s); holder.add(s);
    items.push({ s, holder, sc: (i === 0 ? 0.55 : 0.18 + R() * 0.25) * size, d: i === 0 ? 0 : R() * 0.3 });
  }
  const c = {
    group,
    set({ k = 0 } = {}) {
      group.visible = k > 0 && k < 1;
      for (const it of items) { const q = clamp((k - it.d) / (1 - it.d)); const pop = q < 0.3 ? backOut(q / 0.3) : 1 - smooth((q - 0.3) / 0.7); it.s.scale.setScalar(Math.max(1e-3, it.sc * pop)); it.s.rotation.z = q * 1.2; }
      return c;
    },
  };
  return c.set();
}
// confetti burst from the origin. set({ k }) 0..1 over the burst (~1.5 s feels right)
export function makeConfetti(ctx, { n = 90, spread = 4, height = 6, colors = [C.coral, C.gold, C.yes, C.blue, '#ffffff', C.no], seed = 71 } = {}) {
  const m = mat('#ffffff', { side: THREE.DoubleSide, felt: 0.2, rough: 0.7 });
  const im = new THREE.InstancedMesh(geo('confetto', () => new THREE.PlaneGeometry(0.14, 0.22)), m, n);
  const R = rng(seed), P = [];
  for (let i = 0; i < n; i++) { P.push({ v: V((R() - 0.5) * spread, height * (0.7 + R() * 0.6), (R() - 0.5) * spread), w: V(R() * 9, R() * 9, R() * 9), ph: R() * 6 }); im.setColorAt(i, new THREE.Color(colors[i % colors.length])); }
  im.castShadow = false; im.frustumCulled = false;
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = V(1, 1, 1), p = V();
  const c = {
    group: im,
    set({ k = 0 } = {}) {
      im.visible = k > 0 && k < 1; if (!im.visible) return c;
      const t = k * 1.8;
      P.forEach((d, i) => {
        const drag = 1 - Math.exp(-t * 2.2);
        p.set(d.v.x * drag * 0.45 + Math.sin(t * 5 + d.ph) * 0.15 * t, d.v.y * drag * 0.45 - 2.2 * t * t, d.v.z * drag * 0.45);
        M4.compose(p, q.setFromEuler(e.set(d.w.x * t, d.w.y * t, d.w.z * t)), one); im.setMatrixAt(i, M4);
      });
      im.instanceMatrix.needsUpdate = true; m.opacity = 1 - smooth(clamp((k - 0.75) / 0.25)); m.transparent = m.opacity < 1;
      return c;
    },
  };
  return c.set();
}
export function makeBigX(ctx, { size = 2.4, color = C.no } = {}) {
  const group = new THREE.Group(), m = mat(color, { emissive: color, ei: 0.25 });
  B(size, size * 0.22, size * 0.14, m, { r: size * 0.05, rz: Math.PI / 4, parent: group });
  B(size, size * 0.22, size * 0.14, m, { r: size * 0.05, rz: -Math.PI / 4, z: 0.01, parent: group });
  return { group };
}
export function makeBigCheck(ctx, { size = 2.4, color = C.yes } = {}) {
  const group = new THREE.Group(), m = mat(color, { emissive: color, ei: 0.25 }), t = size * 0.22;
  B(size * 0.45, t, t * 0.7, m, { r: size * 0.05, x: -size * 0.28, y: -size * 0.05, rz: -Math.PI / 4, parent: group });
  B(size * 0.95, t, t * 0.7, m, { r: size * 0.05, x: size * 0.12, y: size * 0.12, rz: Math.PI / 3.4, parent: group });
  return { group };
}
