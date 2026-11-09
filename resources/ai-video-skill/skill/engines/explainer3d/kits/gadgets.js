// GADGETS kit: people, devices and signal graphics for the CITY look (units = m, 1 unit = 1 m, +Y up, objects face +Z).
// API: guides/styles/explainer3d.md (Kit: gadgets).
//   makeTracker, makeSuitcase, makePerson + walk, makeHandset + drawMapScreen / drawArrowScreen, pulseRings,
//   makePacket + flyArc, makeCloud, makeContactShadow, linePath, placeOnPath, look, fade, libEnv,
//   location sets in the shared city: LOC, initLib, makeAirportProps, makeShuttle, makeHotelLobby, makeStreetProps, makeEmptyRoom.
// RULES: builders only CREATE objects (you ctx.scene.add them in init); every call makes fresh materials; geometry is cached.
// Small things (< ~1 m) carry a contact-shadow blob instead of casting sun shadows. Location sets come back already
// positioned at their LOC point (absolute city coordinates). Canvas text uses Inter / JetBrains Mono (redrawn when fonts load).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { C as P } from '../core/palette.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (k) => k * k * (3 - 2 * k);
export const toV3 = (a) => (a && a.isVector3 ? a.clone() : Array.isArray(a) ? new THREE.Vector3(a[0], a[1], a[2]) : new THREE.Vector3());
export function mixHex(a, b, k) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString(); }
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const hash = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

// fonts for canvas text: kick off loads now (before core awaits document.fonts.ready) and redraw on load
const FONTS = (typeof document !== 'undefined' && document.fonts)
  ? Promise.all(['800 40px Inter', '700 40px Inter', '600 40px Inter', '700 30px "JetBrains Mono"', '500 30px "JetBrains Mono"'].map((f) => document.fonts.load(f).catch(() => null)))
  : Promise.resolve();
function whenFonts(fn) { fn(); FONTS.then(fn); }

// ---------- shared resources ----------
const GEO = new Map();
const geo = (key, make) => { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; };
const rbox = (w, h, d, r, seg = 3) => geo(`rb${w}|${h}|${d}|${r}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
const cyl = (rt, rb, h, seg = 16) => geo(`cy${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sph = (r, ws = 24, hs = 16) => geo(`sp${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const box = (w, h, d) => geo(`bx${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));

// Private reflection env for lib materials only: a dark studio dome with a few softboxes, so polished metal
// reads as metal (dark body, crisp bright strips) and gloss shows clean highlights. scene.environment is untouched.
let ENV = null;
function studioScene() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.045,0.05,0.06), vec3(0.30,0.32,0.36), smoothstep(-0.35, 0.85, h)); gl_FragColor = vec4(c, 1.0); }' })));
  const panel = (w, h, pos, k, col = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(6, 6, [0, 14, 2], 4.5);                 // top softbox
  panel(2.4, 11, [-13, 3, 5], 6);               // key strip, left
  panel(1.6, 11, [12, 4, -6], 5);               // rim strip, right back
  panel(15, 1.8, [0, 1.5, 15], 2.2, '#fff0d8');  // warm low strip, front
  return s;
}
export function libEnv(ctx) {
  if (ENV) return ENV;
  const pm = new THREE.PMREMGenerator(ctx.renderer);
  ENV = pm.fromScene(studioScene(), 0.02).texture;
  pm.dispose();
  return ENV;
}

function M(g, m, { cast = false, recv = true, name } = {}) {
  const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = recv; if (name) o.name = name; return o;
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}

// one line of text on a transparent canvas (redrawn once the web fonts load)
function textTex(text, { w = 1024, h = 256, font = '800 120px Inter', color = '#ffffff', spacing = '0px', bg = null } = {}) {
  const { g, t } = canvasTex(w, h);
  whenFonts(() => { g.clearRect(0, 0, w, h); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = spacing; g.fillText(text, w / 2 + (parseFloat(spacing) || 0) / 2, h / 2 + 4); t.needsUpdate = true; });
  return t;
}

// rounded rectangle shape centred on the origin
function rrShape(w, h, r) {
  const s = new THREE.Shape(); const x = w / 2, y = h / 2; r = Math.min(r, x, y);
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function rrPath(s, w, h, r) {    // same, as a hole path
  const p = new THREE.Path(); const x = w / 2, y = h / 2;
  p.moveTo(-x + r, -y); p.lineTo(x - r, -y); p.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x, y - r); p.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  p.lineTo(-x + r, y); p.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(-x, -y + r); p.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  s.holes.push(p); return s;
}
// flat rounded-rect plane with 0..1 UVs (for screens and decals)
function rrPlane(w, h, r, seg = 10) {
  const g = new THREE.ShapeGeometry(rrShape(w, h, r), seg);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}
function cr2d(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

// ---------- contact shadow ----------
let BLOB = null;
function blobTex() {
  if (BLOB) return BLOB;
  const { g, t } = canvasTex(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#b0b0b0'); gr.addColorStop(0.7, '#3a3a3a'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  t.colorSpace = THREE.NoColorSpace; BLOB = t; return t;
}
export function makeContactShadow(ctx, { w = 1, d = 1, opacity = 0.35, color = '#3d3428' } = {}) {
  const pg = geo('blobplane', () => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; });
  const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color, alphaMap: blobTex(), transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
  m.scale.set(w, 1, d); m.position.y = 0.003; m.renderOrder = 1; m.name = 'contactShadow';
  return m;
}

// ---------- paths ----------
// A path object with the same API as ctx.city.paths.* (s = metres along).
function makePath(curve) {
  const length = curve.getLength();
  return {
    curve, length,
    at(s) { return curve.getPointAt(clamp(s / length)); },
    tangent(s) { return curve.getTangentAt(clamp(s / length)).clone(); },
    side(s, off = 0, dy = 0) {
      const p = this.at(s), tg = this.tangent(s);
      const right = new THREE.Vector3().crossVectors(tg, UP).normalize();
      return p.addScaledVector(right, off).add(new THREE.Vector3(0, dy, 0));
    },
    nearest(pt) {
      const v = toV3(pt); let best = 0, bd = Infinity; const N = Math.max(8, Math.ceil(length / 2));
      for (let i = 0; i <= N; i++) { const s = (i / N) * length; const d = this.at(s).distanceToSquared(v); if (d < bd) { bd = d; best = s; } }
      for (let ds = -2; ds <= 2; ds += 0.1) { const s = clamp(best + ds, 0, length); const d = this.at(s).distanceToSquared(v); if (d < bd) { bd = d; best = s; } }
      return best;
    },
  };
}
// polyline (arrays or Vector3s) → smooth path; 2 points = straight line
export function linePath(points) {
  const pts = points.map(toV3);
  const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  c.arcLengthDivisions = Math.max(200, Math.ceil(pts.reduce((a, p, i) => a + (i ? p.distanceTo(pts[i - 1]) : 0), 0) * 2));
  return makePath(c);
}
export function placeOnPath(obj, path, s, off = 0, dy = 0, { pitch = false } = {}) {
  obj.position.copy(path.side(s, off, dy));
  const tg = path.tangent(s);
  obj.rotation.set(0, Math.atan2(tg.x, tg.z), 0, 'YXZ');
  if (pitch) obj.rotation.x = -Math.asin(clamp(tg.y, -1, 1));
  return obj;
}

// thick strip along a path (deck slab, barrier)
function stripBox(path, s0, s1, width, height, yOff, off = 0, minY = -Infinity, step = 2) {
  const n = Math.max(2, Math.ceil((s1 - s0) / step)); const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * (i / n), p = path.at(s), tg = path.tangent(s);
    const right = new THREE.Vector3().crossVectors(tg, UP).normalize();
    const c = p.clone().addScaledVector(right, off);
    const vis = p.y > minY; const y0 = vis ? c.y + yOff : -5, y1 = vis ? y0 + height : -5;
    const L = c.clone().addScaledVector(right, -width / 2), R = c.clone().addScaledVector(right, width / 2);
    pos.push(L.x, y0, L.z, R.x, y0, R.z, R.x, y1, R.z, L.x, y1, L.z);
    if (i < n) { const a = i * 4, b = a + 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2, a + 2, b + 2, a + 3, a + 3, b + 2, b + 3, a + 3, b + 3, a, a, b + 3, b); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); return ng;
}

// ---------- small helpers ----------
export function look(from, to, fov = 35, roll = 0) {
  const a = toV3(from), b = toV3(to);
  return { pos: [a.x, a.y, a.z], target: [b.x, b.y, b.z], fov, roll };
}

// Multiply every material's opacity by alpha (originals cached on first call). alpha 0 hides the object.
// Materials with an `opacity` uniform (ShaderMaterial) are handled too. Don't also animate those opacities yourself.
export function fade(obj, alpha) {
  alpha = clamp(alpha);
  obj.visible = alpha > 0.003;
  if (!obj.visible) return obj;
  obj.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      let c = m.userData.__fade;
      const isU = !!(m.uniforms && m.uniforms.opacity);
      if (!c) c = m.userData.__fade = { opacity: isU ? m.uniforms.opacity.value : m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
      if (isU) m.uniforms.opacity.value = c.opacity * alpha; else m.opacity = c.opacity * alpha;
      const tr = c.transparent || alpha < 0.999;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    }
  });
  return obj;
}

// =====================================================================================================
// 1. coin-sized tracker (generic, no logo)
// =====================================================================================================
// white top: gently domed face, tight rounded edge, short vertical side band (reads as a coin, not a pebble)
const AT_TOP = [[0.488, 0.0], [0.497, 0.005], [0.5, 0.016], [0.5, 0.04], [0.497, 0.058], [0.489, 0.072], [0.475, 0.083], [0.455, 0.091],
  [0.42, 0.098], [0.35, 0.104], [0.25, 0.109], [0.12, 0.112], [0.0, 0.113]];
// polished steel back: a deeper dome
const AT_BACK = [[0.0, -0.115], [0.15, -0.112], [0.26, -0.104], [0.35, -0.09], [0.42, -0.07], [0.465, -0.048], [0.488, -0.027],
  [0.496, -0.012], [0.494, -0.003]];

export function makeTracker(ctx, { scale = 1, shadow = false } = {}) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'tracker';
  const white = new THREE.MeshPhysicalMaterial({ color: '#e1e1dc', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: '#e8ebef', metalness: 1, roughness: 0.22, envMap: env, envMapIntensity: 1.25 });
  const seam = new THREE.MeshStandardMaterial({ color: '#80858d', roughness: 0.5, metalness: 0.4, envMap: env, envMapIntensity: 0.4 });
  const top = M(geo('at-top', () => new THREE.LatheGeometry(AT_TOP.map(([r, y]) => new THREE.Vector2(r, y)), 96)), white, { name: 'trackerTop' });
  const back = M(geo('at-back', () => new THREE.LatheGeometry(AT_BACK.map(([r, y]) => new THREE.Vector2(r, y)), 96)), steel, { name: 'trackerBack' });
  const ring = M(geo('at-seam', () => { const t = new THREE.TorusGeometry(0.4905, 0.0055, 8, 96); t.rotateX(Math.PI / 2); return t; }), seam);
  ring.position.y = -0.0015;
  // faint engraved ring on the steel back
  const eng = M(geo('at-eng', () => { const t = new THREE.TorusGeometry(0.2, 0.0022, 6, 96); t.rotateX(Math.PI / 2); return t; }),
    new THREE.MeshStandardMaterial({ color: '#b9bec5', metalness: 1, roughness: 0.4, envMap: env, envMapIntensity: 0.8 }));
  eng.position.y = -0.108;
  g.add(top, back, ring, eng);
  if (shadow) { const s = makeContactShadow(ctx, { w: 1.25, d: 1.25, opacity: 0.4 }); s.position.y = -0.112; g.add(s); }
  const apex = new THREE.Object3D(); apex.position.y = 0.113; g.add(apex);
  g.userData = { radius: 0.5, top: apex, bottomY: -0.115, mats: { white, steel } };
  g.scale.setScalar(scale);
  return g;
}

// =====================================================================================================
// 2. Hard-shell spinner suitcase
// =====================================================================================================
export function makeSuitcase(ctx, { color = P.route, handle = 1, lite = false } = {}) {
  const env = libEnv(ctx);
  const W = 0.44, H = 0.6, D = 0.27, Y0 = 0.085, TOP = Y0 + H;
  const g = new THREE.Group(); g.name = 'suitcase';
  const shellM = new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.14, envMap: env, envMapIntensity: 0.6 });
  const darkM = std('#2c3036', { roughness: 0.55, envMap: env, envMapIntensity: 0.15 });
  const metalM = new THREE.MeshStandardMaterial({ color: '#cfd4da', metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 0.9 });
  const shell = new THREE.Group(); shell.name = 'shell'; g.add(shell);
  shell.add(at(M(rbox(W, H, D, 0.06, 5), shellM), 0, Y0 + H / 2, 0));
  // perimeter seam band (zip) between the two shells
  shell.add(at(M(rbox(W + 0.01, H + 0.01, 0.026, 0.064, 5), darkM), 0, Y0 + H / 2, 0));
  if (!lite) {
    // vertical ribs, front and back
    for (const zs of [-1, 1]) for (const x of [-0.135, -0.055, 0.055, 0.135]) {
      shell.add(at(M(rbox(0.03, H * 0.76, 0.03, 0.012, 2), shellM), x, Y0 + H / 2, zs * (D / 2 - 0.003)));
    }
    // corner guards (dark) top + bottom
    for (const xs of [-1, 1]) for (const ys of [0, 1]) {
      shell.add(at(M(rbox(0.07, 0.05, D + 0.008, 0.02, 2), darkM), xs * (W / 2 - 0.03), Y0 + 0.025 + ys * (H - 0.05), 0));
    }
  }
  // top carry handle
  for (const x of [-0.06, 0.06]) shell.add(at(M(rbox(0.022, 0.03, 0.034, 0.008, 2), darkM), x, TOP + 0.012, 0.02));
  const grip = M(geo('sc-grip', () => { const c = new THREE.CapsuleGeometry(0.013, 0.1, 4, 10); c.rotateZ(Math.PI / 2); return c; }), darkM);
  shell.add(at(grip, 0, TOP + 0.03, 0.02));
  // telescopic handle (extension 0..1)
  const ext = 0.36 * clamp(handle);
  shell.add(at(M(rbox(0.27, 0.014, 0.05, 0.006, 2), darkM), 0, TOP + 0.004, -D / 2 + 0.045));
  const handleTop = new THREE.Object3D();
  if (ext > 0.01) for (const x of [-0.1, 0.1]) {
    const rod = M(cyl(0.0078, 0.0078, 1, 10), metalM); rod.scale.y = ext; at(rod, x, TOP + ext / 2, -D / 2 + 0.045); shell.add(rod);
  }
  shell.add(at(M(rbox(0.25, 0.03, 0.036, 0.013, 3), darkM), 0, TOP + ext + 0.016, -D / 2 + 0.045));
  at(handleTop, 0, TOP + ext + 0.03, -D / 2 + 0.045); g.add(handleTop);
  // spinner wheels
  const wheels = [];
  const wheelG = geo('sc-wheel', () => { const c = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 18); c.rotateZ(Math.PI / 2); return c; });
  const hubM = std('#8f9aa6', { roughness: 0.5 });
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const w = new THREE.Group(); at(w, xs * (W / 2 - 0.05), 0, zs * (D / 2 - 0.05));
    w.add(at(M(rbox(0.056, 0.026, 0.052, 0.01, 2), darkM), 0, Y0 - 0.01, 0));
    w.add(at(M(box(0.036, 0.03, 0.012), darkM), 0, 0.05, 0));
    for (const dx of [-0.011, 0.011]) {
      w.add(at(M(wheelG, darkM), dx, 0.026, 0));
      if (!lite) w.add(at(M(geo('sc-hub', () => { const c = new THREE.CylinderGeometry(0.011, 0.011, 0.0135, 12); c.rotateZ(Math.PI / 2); return c; }), hubM), dx, 0.026, 0));
    }
    shell.add(w); wheels.push(w);
  }
  // luggage tag hanging over the front-top edge (amber accent)
  let tagSlotTag = new THREE.Object3D(); at(tagSlotTag, 0.1, TOP - 0.08, D / 2 + 0.02); g.add(tagSlotTag);
  if (!lite) {
    const tagM = std(P.slow, { roughness: 0.6 });
    const strapM = std('#3b4048', { roughness: 0.7 });
    shell.add(at(M(box(0.012, 0.004, D / 2 - 0.0), strapM), 0.03, TOP + 0.002, D / 4 + 0.01));
    const tag = new THREE.Group(); at(tag, 0.075, TOP - 0.065, D / 2 + 0.009); tag.rotation.set(-0.06, 0, 0.16); shell.add(tag);
    tag.add(at(M(box(0.012, 0.05, 0.004), strapM), -0.03, 0.045, -0.002));
    tag.add(M(rbox(0.078, 0.112, 0.008, 0.0035, 2), tagM));
    const card = M(geo('sc-card', () => rrPlane(0.056, 0.042, 0.006)), std(P.paper, { roughness: 0.9 }));
    at(card, 0, -0.012, 0.0045); tag.add(card);
    tag.add(at(M(geo('sc-hole', () => new THREE.CircleGeometry(0.006, 12)), darkM), -0.025, 0.04, 0.0045));
  }
  // folded clothes inside (only visible when the shell is faded)
  const contents = new THREE.Group(); contents.name = 'contents'; g.add(contents);
  if (!lite) [[P.history, 0.2], [P.roofs[3], 0.33], [P.trees[1], 0.46]].forEach(([c, y], i) => {
    contents.add(at(M(rbox(W - 0.09 - i * 0.02, 0.1, D - 0.1, 0.03, 2), std(c, { roughness: 0.95 })), 0, Y0 + y, -0.02));
  });
  const tagSlot = new THREE.Object3D(); tagSlot.name = 'tagSlot';
  at(tagSlot, 0, Y0 + H * 0.56, D / 2 - 0.035); tagSlot.rotation.x = Math.PI / 2; g.add(tagSlot);
  g.add(makeContactShadow(ctx, { w: W * 1.6, d: D * 1.9, opacity: 0.42 }));
  g.userData = { tagSlot, tagSlotTag, shell, contents, wheels, handleTop, height: TOP, width: W, depth: D, mat: shellM };
  return g;
}

// =====================================================================================================
// 3. People: stylised low-poly walkers
// =====================================================================================================
const JACKETS = [P.history, P.roofs[0], '#5c626b', P.trees[1], mixHex(P.slow, P.roofs[3], 0.5), P.towers[3], P.roofs[1], '#3b4048', mixHex(P.route, P.ink, 0.35), P.roofs[3]];
const PANTS = ['#3b4048', '#2c3036', '#5a6068', P.roofs[2], '#40454d'];
const SKIN = [mixHex(P.roofs[3], '#ffffff', 0.38), mixHex(P.roofs[0], '#ffffff', 0.5), mixHex(P.trunk, '#ffffff', 0.12), mixHex(P.roofs[4], '#ffffff', 0.55), mixHex(P.trunk, '#000000', 0.12)];
const HAIR = ['#2c3036', '#4a3b32', P.trunk, '#1f2328', mixHex(P.roofs[3], '#ffffff', 0.15)];

export function makePerson(ctx, { seed = 1, phone = false, phoneIn = 'pocket', color, height = 1.75 } = {}) {
  const r = (k) => hash(seed * 7.31 + k * 3.17);
  const jacket = color || JACKETS[Math.floor(r(1) * JACKETS.length)];
  const pants = PANTS[Math.floor(r(2) * PANTS.length)];
  const skin = SKIN[Math.floor(r(3) * SKIN.length)];
  const hair = HAIR[Math.floor(r(4) * HAIR.length)];
  const jM = std(jacket, { roughness: 0.85 }), pM = std(pants, { roughness: 0.9 }), sM = std(skin, { roughness: 0.7 });
  const hM = std(hair, { roughness: 0.9 }), shoeM = std('#2c3036', { roughness: 0.6 });
  const castOpt = { cast: true };

  const root = new THREE.Group(); root.name = 'person';
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); at(hips, 0, 0.95, 0); body.add(hips);
  hips.add(at(M(rbox(0.27, 0.18, 0.18, 0.075, 3), pM, castOpt), 0, -0.03, 0));
  const torso = new THREE.Group(); at(torso, 0, 0.02, 0); hips.add(torso);
  const TORSO = [[0, -0.07], [0.135, -0.07], [0.152, -0.03], [0.15, 0.04], [0.145, 0.13], [0.138, 0.21], [0.15, 0.3], [0.168, 0.39], [0.176, 0.45], [0.165, 0.5], [0.13, 0.54], [0.07, 0.565], [0, 0.57]];
  const torsoMesh = M(geo('p-torso', () => new THREE.LatheGeometry(TORSO.map(([a, b]) => new THREE.Vector2(a, b)), 20)), jM, castOpt);
  torsoMesh.scale.set(1.18, 1, 0.74); torso.add(torsoMesh);
  torso.add(at(M(cyl(0.046, 0.054, 0.12, 12), sM), 0, 0.6, 0));
  const head = new THREE.Group(); at(head, 0, 0.69, 0); torso.add(head);
  const headMesh = M(sph(0.105, 24, 16), sM, castOpt); headMesh.scale.set(0.95, 1.1, 1); head.add(headMesh);
  // hair: a crown cap + a back piece that comes down to the nape (front hairline stays high)
  const hairTop = M(geo('p-hair', () => new THREE.SphereGeometry(0.111, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.36)), hM);
  hairTop.scale.set(0.97, 1.12, 1.03); hairTop.rotation.x = -0.2; head.add(hairTop);
  const hairBack = M(geo('p-hairb', () => new THREE.SphereGeometry(0.11, 20, 10, Math.PI * 0.5, Math.PI, 0, Math.PI * 0.54)), hM);
  hairBack.scale.set(0.98, 1.11, 1.04); at(hairBack, 0, 0.002, -0.006); head.add(hairBack);

  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); at(hip, s * 0.085, -0.02, 0); hips.add(hip);
    hip.add(at(M(geo('p-thigh', () => new THREE.CapsuleGeometry(0.077, 0.29, 4, 12)), pM, castOpt), 0, -0.21, 0));
    const knee = new THREE.Group(); at(knee, 0, -0.43, 0); hip.add(knee);
    knee.add(at(M(geo('p-shin', () => new THREE.CapsuleGeometry(0.062, 0.31, 4, 12)), pM, castOpt), 0, -0.21, 0));
    const foot = new THREE.Group(); at(foot, 0, -0.45, 0); knee.add(foot);
    foot.add(at(M(rbox(0.105, 0.075, 0.25, 0.034, 2), shoeM, castOpt), 0, -0.012, 0.045));
    legs.push({ hip, knee, foot, s });
    const sh = new THREE.Group(); at(sh, s * 0.192, 0.445, 0); torso.add(sh);
    sh.add(at(M(geo('p-uarm', () => new THREE.CapsuleGeometry(0.054, 0.21, 4, 10)), jM, castOpt), 0, -0.14, 0));
    const elbow = new THREE.Group(); at(elbow, 0, -0.29, 0); sh.add(elbow);
    elbow.add(at(M(geo('p-farm', () => new THREE.CapsuleGeometry(0.047, 0.19, 4, 10)), jM, castOpt), 0, -0.13, 0));
    const hand = new THREE.Group(); at(hand, 0, -0.29, 0); elbow.add(hand);
    hand.add(M(sph(0.046, 12, 10), sM));
    arms.push({ sh, elbow, hand, s });
  }

  let phoneObj = null;
  const inHand = phone && phoneIn === 'hand';
  if (phone) {
    const ph = makeHandset(ctx, { w: 0.078, screen: inHand ? 'on' : 'off' });
    if (inHand) { arms[0].hand.add(ph); ph.position.set(0, -0.044, 0.024); ph.rotation.set(-0.49, 0, Math.PI); }   // right hand, screen tilted up toward the face
    else {   // right back pocket, top third sticking out
      legs[0].hip.add(ph); ph.position.set(0.0, -0.075, -0.073); ph.rotation.set(0.06, Math.PI, 0);
      const pocket = M(rbox(0.13, 0.13, 0.008, 0.02, 2), std(mixHex(pants, '#000000', 0.25), { roughness: 0.95 }));
      at(pocket, 0, -0.13, -0.08); legs[0].hip.add(pocket);
    }
    phoneObj = ph;
  }
  root.add(makeContactShadow(ctx, { w: 0.75, d: 0.6, opacity: 0.32 }));

  // gait: phase in cycles (1 = left + right step), amp 0 (standing) .. 1 (walking)
  function gait(phase, amp = 1) {
    const th = phase * Math.PI * 2, a = clamp(amp, 0, 1.4);
    for (const L of legs) {
      const q = L.s < 0 ? th : th + Math.PI;
      const thigh = -a * 0.42 * Math.sin(q);
      const kneeB = a * (0.1 + 0.75 * Math.pow(Math.max(0, Math.cos(q)), 2)) + 0.03;
      L.hip.rotation.x = thigh; L.knee.rotation.x = kneeB; L.foot.rotation.x = -(thigh + kneeB) * 0.8;
    }
    for (const A of arms) {
      const q = A.s < 0 ? th : th + Math.PI;
      if (inHand && A.s < 0) { A.sh.rotation.set(-0.42 - a * 0.03 * Math.sin(q), 0, -0.08); A.elbow.rotation.x = -1.2; continue; }
      A.sh.rotation.set(a * 0.36 * Math.sin(q), 0, -A.s * 0.035);
      A.elbow.rotation.x = -(0.22 + a * 0.28 * Math.max(0, Math.sin(q)));
    }
    body.position.y = a * (0.022 * Math.cos(2 * th) - 0.012);
    torso.rotation.y = a * 0.09 * Math.sin(th); hips.rotation.y = -a * 0.06 * Math.sin(th);
    torso.rotation.x = 0.04 * a;
    head.rotation.set(inHand ? 0.32 : 0, -torso.rotation.y * 0.7, 0);
  }
  gait(0, 0);
  root.userData = { phone: phoneObj, gait, height, legs, arms, head, mats: { jM, pM, sM } };
  root.userData.update = (t, o) => walk(root, t, o);
  root.scale.setScalar(height / 1.75);
  return root;
}

// Walk a person along a path as a pure function of t. Without `path`, animates in place (treadmill).
export function walk(person, t, { path = null, s0 = 0, speed = 1.35, t0 = 0, t1 = Infinity, off = 0, dy = 0, stride = 1.45, ease = 0.35, phase = 0 } = {}) {
  const tt = clamp(t, t0, t1);
  // ease the speed in/out over `ease` seconds so starts/stops don't pop
  const e = Math.max(1e-3, ease);
  const s = s0 + speed * (tt - t0);
  const amp = Math.min(smooth(clamp((t - t0) / e)), smooth(clamp((t1 - t) / e)));
  const moving = t > t0 && t < t1;
  person.userData.gait((s - s0) / stride + phase, moving ? amp : 0);
  if (path) {
    const sc = clamp(s, 0, path.length);
    person.position.copy(path.side(sc, off, dy));
    const tg = path.tangent(sc);
    person.rotation.set(0, Math.atan2(tg.x, tg.z), 0);
    return { s: sc, pos: person.position.clone(), dir: tg, moving };
  }
  return { s, pos: person.position.clone(), dir: new THREE.Vector3(Math.sin(person.rotation.y), 0, Math.cos(person.rotation.y)), moving };
}

// =====================================================================================================
// 4. Phone slab with a live canvas screen
// =====================================================================================================
const PH_H = 2.06, PH_D = 0.105, PH_R = 0.17;
export function makeHandset(ctx, { w = 0.075, screen = 'live', color = '#2c3036' } = {}) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'phone';
  const bev = 0.022;
  const bodyG = geo('ph-body', () => {
    const e = new THREE.ExtrudeGeometry(rrShape(1 - 2 * bev, PH_H - 2 * bev, PH_R - bev), { depth: PH_D - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 10 });
    e.translate(0, 0, -(PH_D - 2 * bev) / 2); return e;
  });
  const frameM = new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.32, envMap: env, envMapIntensity: 0.8 });
  g.add(M(bodyG, frameM));
  const glassM = new THREE.MeshPhysicalMaterial({ color: '#07090c', roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMap: env, envMapIntensity: 0.9 });
  const glass = M(geo('ph-glass', () => rrPlane(1 - 0.03, PH_H - 0.03, PH_R - 0.012, 12)), glassM);
  glass.position.z = PH_D / 2 + 0.001; g.add(glass);
  // display
  const SW = 1 - 0.09, SH = PH_H - 0.09;
  let scr = null;
  const dispG = geo('ph-disp', () => rrPlane(SW, SH, PH_R - 0.05, 12));
  if (screen === 'live') {
    const W = 540, H = 1170; const { c, g: g2, t } = canvasTex(W, H);
    const mat = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.86, 0.86, 0.86) });   // whites stay under the bloom threshold
    const disp = M(dispG, mat); disp.position.z = PH_D / 2 + 0.002; g.add(disp);
    scr = { canvas: c, g: g2, tex: t, W, H, mesh: disp, mat, draw(fn) { fn(g2, W, H); t.needsUpdate = true; } };
    g2.fillStyle = '#0b0d12'; g2.fillRect(0, 0, W, H); t.needsUpdate = true;
  } else if (screen === 'on') {
    const disp = M(dispG, new THREE.MeshBasicMaterial({ color: '#b9cdf0' })); disp.position.z = PH_D / 2 + 0.002; g.add(disp);
  }
  // back: camera island (generic two-lens) + side buttons
  const isl = M(rbox(0.36, 0.36, 0.03, 0.08, 3), frameM); at(isl, -0.24, PH_H / 2 - 0.27, -PH_D / 2 - 0.008); g.add(isl);
  const lensM = new THREE.MeshPhysicalMaterial({ color: '#0d1014', roughness: 0.05, clearcoat: 1, envMap: env, envMapIntensity: 1 });
  const lensG = geo('ph-lens', () => { const c = new THREE.CylinderGeometry(0.07, 0.075, 0.03, 20); c.rotateX(Math.PI / 2); return c; });
  for (const [dx, dy] of [[-0.075, 0.075], [0.075, -0.075]]) g.add(at(M(lensG, lensM), -0.24 + dx, PH_H / 2 - 0.27 + dy, -PH_D / 2 - 0.03));
  for (const [y, h] of [[0.45, 0.16], [0.22, 0.16]]) g.add(at(M(rbox(0.02, h, 0.04, 0.009, 2), frameM), -0.505, y, 0));
  g.add(at(M(rbox(0.02, 0.26, 0.04, 0.009, 2), frameM), 0.505, 0.32, 0));
  g.userData = { screen: scr, width: w, height: PH_H * w };
  g.scale.setScalar(w);
  return g;
}

// ---- phone UI drawing (our own design) ----
function statusBar(g, W, dark) {
  g.fillStyle = dark ? '#ffffff' : P.ink;
  g.font = '600 28px Inter'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('6:42', 46, 46);
  // signal bars + battery
  const x0 = W - 150;
  for (let i = 0; i < 4; i++) { cr2d(g, x0 + i * 11, 54 - 8 - i * 4, 7, 8 + i * 4, 2); g.fill(); }
  g.globalAlpha = 0.45; cr2d(g, W - 92, 34, 48, 24, 7); g.lineWidth = 2.5; g.strokeStyle = g.fillStyle; g.stroke(); g.globalAlpha = 1;
  cr2d(g, W - 88, 38, 34, 16, 4); g.fill();
  cr2d(g, W - 41, 41, 4, 10, 2); g.fill();
  // hole-punch camera
  g.fillStyle = '#05060a'; g.beginPath(); g.arc(W / 2, 44, 15, 0, Math.PI * 2); g.fill();
}
function suitcaseGlyph(g, x, y, s, col) {
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = col; g.strokeStyle = col;
  cr2d(g, -14, -12, 28, 26, 5); g.fill();
  g.lineWidth = 3.2; cr2d(g, -6, -19, 12, 9, 3); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-7, -9, 2.6, 20); g.fillRect(4.4, -9, 2.6, 20);
  g.restore();
}

export function drawMapScreen(screen, o = {}) {
  if (!screen) return;
  const { g, W, H } = screen;
  const t = o.t ?? 0, pin = o.pinXY ?? [0.5, 0.4], pan = o.pan ?? [0, 0], zoom = o.zoom ?? 1;
  const px = pin[0] * W, py = pin[1] * H;
  g.save();
  g.fillStyle = '#ece5d8'; g.fillRect(0, 0, W, H);
  // ---- the map (static in map space; pan/zoom move the camera) ----
  g.save();
  g.translate(W / 2 + pan[0], H * 0.4 + pan[1]); g.scale(zoom, zoom); g.rotate(-0.2);
  const B = 86, N = 11;
  // water + park
  g.fillStyle = P.water; g.beginPath(); g.moveTo(-1200, 360); g.bezierCurveTo(-300, 250, 200, 520, 1200, 420); g.lineTo(1200, 560); g.bezierCurveTo(200, 660, -300, 400, -1200, 500); g.closePath(); g.fill();
  g.fillStyle = P.park; cr2d(g, B * 1 + 7, -B * 3 + 7, B * 2 - 14, B * 2 - 14, 10); g.fill();
  cr2d(g, -B * 4 + 7, B * 1 + 7, B - 14, B - 14, 10); g.fill();
  // building footprints
  for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) {
    if (i >= 1 && i < 3 && j >= -3 && j < -1) continue;
    const y0 = j * B; if (y0 > 300 && y0 < 560) continue;
    for (let k = 0; k < 2; k++) {
      const h1 = hash(i * 131 + j * 17 + k * 7.7), h2 = hash(i * 31 + j * 71 + k * 3.3);
      const bw = B * (0.3 + 0.22 * h1), bh = B * (0.26 + 0.3 * h2);
      g.fillStyle = h1 > 0.5 ? '#e2d9ca' : '#ddd3c3';
      cr2d(g, i * B + 10 + k * (B - 20 - bw), j * B + 10 + (1 - k) * (B - 20 - bh) * h2, bw, bh, 4); g.fill();
    }
  }
  // streets
  g.lineCap = 'round';
  g.strokeStyle = '#ffffff'; g.lineWidth = 10;
  g.beginPath();
  for (let i = -N; i <= N; i++) { g.moveTo(i * B, -N * B); g.lineTo(i * B, N * B); g.moveTo(-N * B, i * B); g.lineTo(N * B, i * B); }
  g.stroke();
  // arterials (wide, warm casing) + highway
  const art = (pts, w, fill, casing) => {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
    g.strokeStyle = casing; g.lineWidth = w + 6; g.stroke(); g.strokeStyle = fill; g.lineWidth = w; g.stroke();
  };
  art([[-N * B, -B], [N * B, -B]], 18, '#ffffff', '#d8cfc0');
  art([[-B * 2, -N * B], [-B * 2, N * B]], 18, '#ffffff', '#d8cfc0');
  art([[-N * B, B * 6], [-B * 3, B * 2.2], [B * 2, -B * 0.4], [N * B, -B * 5]], 22, mixHex(P.slow, '#ffffff', 0.45), mixHex(P.slow, '#9a7a40', 0.4));
  g.restore();

  // "you" dot (optional) + dashed link to the pin
  if (o.you) {
    const ux = o.you[0] * W, uy = o.you[1] * H;
    g.setLineDash([2, 16]); g.lineCap = 'round'; g.strokeStyle = rgba(P.route, 0.85); g.lineWidth = 8;
    g.beginPath(); g.moveTo(ux, uy); g.lineTo(px, py - 40); g.stroke(); g.setLineDash([]);
    g.fillStyle = rgba(P.route, 0.16); g.beginPath(); g.arc(ux, uy, 46, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(ux, uy, 20, 0, 7); g.fill();
    g.fillStyle = P.route; g.beginPath(); g.arc(ux, uy, 14, 0, 7); g.fill();
  }
  // pin: pulsing halo + teardrop
  for (let k = 0; k < 3; k++) {
    const ph = ((t * 0.65 + k / 3) % 1 + 1) % 1;
    g.strokeStyle = rgba(P.route, Math.pow(1 - ph, 1.6) * 0.55); g.lineWidth = 5;
    g.beginPath(); g.ellipse(px, py, 24 + 100 * ph, (24 + 100 * ph) * 0.62, 0, 0, 7); g.stroke();
  }
  g.fillStyle = 'rgba(30,25,15,.22)'; g.beginPath(); g.ellipse(px, py, 22, 9, 0, 0, 7); g.fill();
  const cy = py - 64, R = 40;
  g.save(); g.shadowColor = 'rgba(15,20,40,.35)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(px, cy, R + 7, Math.PI * 0.78, Math.PI * 2.22); g.lineTo(px, py - 2); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = P.route; g.beginPath(); g.arc(px, cy, R, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(px, py - 12); g.closePath(); g.fill();
  suitcaseGlyph(g, px, cy + 2, 1.15, '#ffffff');

  // top: status bar + floating kicker chip
  statusBar(g, W, false);
  if (o.kicker !== null) {
    const kick = o.kicker ?? 'ITEMS';
    g.font = '700 22px "JetBrains Mono"'; const kw = g.measureText(kick).width;
    g.fillStyle = 'rgba(251,248,242,.94)'; cr2d(g, 34, 90, kw + 64, 50, 25); g.fill();
    g.fillStyle = P.live; g.beginPath(); g.arc(60, 115, 7, 0, 7); g.fill();
    g.fillStyle = P.ink; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(kick, 78, 116);
  }
  // bottom card
  const cx0 = 22, cw = W - 44, ch = 318, cy0 = H - ch - 26;
  g.save(); g.shadowColor = 'rgba(20,24,32,.22)'; g.shadowBlur = 30; g.shadowOffsetY = -4;
  g.fillStyle = '#fbf8f2'; cr2d(g, cx0, cy0, cw, ch, 42); g.fill(); g.restore();
  g.fillStyle = 'rgba(20,24,32,.15)'; cr2d(g, W / 2 - 34, cy0 + 14, 68, 8, 4); g.fill();
  g.fillStyle = P.route; g.beginPath(); g.arc(cx0 + 74, cy0 + 96, 44, 0, 7); g.fill();
  suitcaseGlyph(g, cx0 + 74, cy0 + 98, 1.05, '#ffffff');
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = P.ink; g.font = '800 44px Inter'; g.fillText(o.label ?? 'Suitcase', cx0 + 138, cy0 + 92);
  g.fillStyle = '#7b818b'; g.font = '600 26px Inter'; g.fillText(o.sub ?? 'seen just now', cx0 + 140, cy0 + 130);
  g.textAlign = 'right'; g.fillStyle = P.ink; g.font = '700 30px "JetBrains Mono"'; g.fillText(o.dist ?? '2.4 mi', cx0 + cw - 30, cy0 + 92);
  // buttons: big "Find" + round bell
  const by = cy0 + 180, bh = 96;
  g.fillStyle = P.route; cr2d(g, cx0 + 26, by, cw - 52 - bh - 18, bh, 48); g.fill();
  g.fillStyle = '#ffffff'; g.font = '700 36px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('Find', cx0 + 26 + (cw - 52 - bh - 18) / 2 + 18, by + bh / 2 + 1);
  g.save(); g.translate(cx0 + 26 + (cw - 52 - bh - 18) / 2 - 52, by + bh / 2); g.rotate(Math.PI / 4);
  g.beginPath(); g.moveTo(0, -16); g.lineTo(12, 14); g.lineTo(0, 7); g.lineTo(-12, 14); g.closePath(); g.fill(); g.restore();
  g.fillStyle = '#ebe6dd'; g.beginPath(); g.arc(cx0 + cw - 26 - bh / 2, by + bh / 2, bh / 2, 0, 7); g.fill();
  g.fillStyle = P.ink; g.beginPath(); const bx = cx0 + cw - 26 - bh / 2, bcy = by + bh / 2;
  g.moveTo(bx - 15, bcy + 10); g.quadraticCurveTo(bx - 14, bcy - 18, bx, bcy - 18); g.quadraticCurveTo(bx + 14, bcy - 18, bx + 15, bcy + 10); g.closePath(); g.fill();
  g.beginPath(); g.arc(bx, bcy + 15, 5, 0, 7); g.fill();
  g.restore();
  screen.tex.needsUpdate = true;
}

export function drawArrowScreen(screen, o = {}) {
  if (!screen) return;
  const { g, W, H } = screen;
  const t = o.t ?? 0, k = clamp(o.k ?? 1);
  const ang = ((o.angleDeg ?? 0) * Math.PI) / 180;
  g.save();
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0f1319'); bg.addColorStop(1, '#18202c');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.41;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
  const rg = g.createRadialGradient(cx, cy, 10, cx, cy, W * 0.62);
  rg.addColorStop(0, rgba(P.route, 0.42 + 0.12 * pulse)); rg.addColorStop(0.55, rgba(P.route, 0.12)); rg.addColorStop(1, rgba(P.route, 0));
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  // dot ring: brighter toward the arrow direction
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    let d = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)));
    const lit = Math.pow(clamp(1 - d / 0.9), 2);
    g.fillStyle = `rgba(255,255,255,${0.16 + 0.8 * lit})`;
    const rr = 222, x = cx + Math.sin(a) * rr, y = cy - Math.cos(a) * rr;
    g.beginPath(); g.arc(x, y, 4.5 + 4 * lit, 0, 7); g.fill();
  }
  // the arrow
  g.save(); g.translate(cx, cy); g.rotate(ang); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
  g.shadowColor = rgba(P.routeGlow, 0.9); g.shadowBlur = 40;
  g.fillStyle = '#ffffff'; g.lineJoin = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 22;
  g.beginPath(); g.moveTo(0, -150); g.lineTo(98, -34); g.lineTo(34, -34); g.lineTo(34, 128); g.lineTo(-34, 128); g.lineTo(-34, -34); g.lineTo(-98, -34); g.closePath();
  g.fill(); g.stroke();
  g.restore();
  statusBar(g, W, true);
  // kicker + label
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '700 22px "JetBrains Mono"'; g.fillStyle = 'rgba(255,255,255,.5)';
  if ('letterSpacing' in g) g.letterSpacing = '4px';
  g.fillText(o.kicker ?? 'FINDING', cx, 140);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.font = '800 40px Inter'; g.fillStyle = '#ffffff'; g.fillText(o.label ?? 'Suitcase', cx, 192);
  // distance
  const dist = String(o.distance ?? '4 m'); const m = dist.match(/^([\d.,]+)\s*(.*)$/);
  const num = m ? m[1] : dist, unit = m ? m[2] : '';
  g.font = '800 220px Inter'; const wn = g.measureText(num).width;
  g.font = '700 84px Inter'; const wu = unit ? g.measureText(' ' + unit).width : 0;
  const x0 = cx - (wn + wu) / 2, by = H * 0.79;
  g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = '800 220px Inter'; g.fillText(num, x0, by);
  g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '700 84px Inter'; if (unit) g.fillText(' ' + unit, x0 + wn, by);
  g.textAlign = 'center'; g.font = '700 48px Inter'; g.fillStyle = 'rgba(255,255,255,.66)';
  g.fillText(o.sub ?? 'to your left', cx, by + 76);
  // chip
  const chip = o.chip ?? 'ULTRA WIDEBAND';
  g.font = '700 21px "JetBrains Mono"'; const cw = g.measureText(chip).width + 62;
  g.fillStyle = 'rgba(255,255,255,.08)'; cr2d(g, cx - cw / 2, H - 120, cw, 50, 25); g.fill();
  g.fillStyle = P.live; g.beginPath(); g.arc(cx - cw / 2 + 26, H - 95, 6, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.75)'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(chip, cx - cw / 2 + 42, H - 94);
  g.restore();
  screen.tex.needsUpdate = true;
}

// =====================================================================================================
// 5. Bluetooth pulse rings
// =====================================================================================================
const RING_VS = `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const RING_FS = `
  uniform vec3 color; uniform float uTime, uAlpha, count, width, glow, fillAmt;
  varying vec3 vP;
  void main(){
    float r = length(vP.xy);            // 0..1
    float a = 0.0;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= count) break;
      float ph = fract(uTime + float(i) / count);
      float band = 1.0 - smoothstep(0.0, width, abs(r - ph));
      float fadeR = pow(max(1.0 - ph, 0.0), 1.35) * smoothstep(0.0, 0.06, ph);
      float wake = fillAmt * smoothstep(ph - 0.22, ph, r) * step(r, ph);   // soft wavefront trailing inside the ring
      a += (band + wake) * fadeR;
    }
    a *= 1.0 - smoothstep(0.97, 1.0, r);
    if (a < 0.003) discard;
    gl_FragColor = vec4(color * (1.0 + glow), clamp(a, 0.0, 1.0) * uAlpha);
    #include <colorspace_fragment>
  }`;
const SHELL_VS = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const SHELL_FS = `uniform vec3 color; uniform float uAlpha, glow; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2); float a = (0.05 + 0.95 * f) * uAlpha;
    gl_FragColor = vec4(color * (1.0 + glow * f), a);
    #include <colorspace_fragment>
  }`;

export function pulseRings(ctx, { color = P.phone, maxR = 4, count = 3, period = 1.6, mode = 'flat', width, glow = 1.1, normal = null, fill = 0.3, speed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'pulseRings';
  const col = new THREE.Color(color);
  let disc = null, shells = [];
  if (mode === 'sphere') {
    const sg = geo('ring-shell', () => new THREE.SphereGeometry(1, 48, 24));
    for (let i = 0; i < count; i++) {
      const m = new THREE.ShaderMaterial({ uniforms: { color: { value: col }, uAlpha: { value: 0 }, glow: { value: glow } }, vertexShader: SHELL_VS, fragmentShader: SHELL_FS,
        transparent: true, depthWrite: false });
      const s = new THREE.Mesh(sg, m); s.renderOrder = 8; group.add(s); shells.push(s);
    }
  } else {
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: col }, uTime: { value: 0 }, uAlpha: { value: 1 }, count: { value: Math.min(8, count) }, width: { value: (width ?? maxR * 0.04) / maxR }, glow: { value: glow }, fillAmt: { value: fill } },
      vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    disc = new THREE.Mesh(geo('ring-disc', () => new THREE.CircleGeometry(1, 128)), mat);
    disc.scale.setScalar(maxR); disc.renderOrder = 8; disc.frustumCulled = false;
    if (mode === 'billboard') {
      const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      disc.onBeforeRender = (r, sc, cam) => { disc.matrixWorld.decompose(p, q, s); disc.matrixWorld.compose(p, cam.quaternion, s); };
    } else {
      const n = normal ? toV3(normal).normalize() : UP;
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    }
    group.add(disc);
  }
  return {
    group, mesh: disc, shells,
    update(t, origin, alpha = 1) {
      if (origin) group.position.copy(toV3(origin));
      group.visible = alpha > 0.003;
      const u = (t * speed) / period;
      if (disc) { disc.material.uniforms.uTime.value = u; disc.material.uniforms.uAlpha.value = alpha; }
      shells.forEach((s, i) => {
        const ph = ((u + i / count) % 1 + 1) % 1;
        s.scale.setScalar(Math.max(1e-3, ph * maxR));
        s.material.uniforms.uAlpha.value = alpha * Math.pow(1 - ph, 1.4) * smooth(clamp(ph / 0.08)) * 0.9;
      });
    },
    setColor(c) { col.set(c); },
  };
}

// =====================================================================================================
// 6. The encrypted note (packet) + Bezier flight
// =====================================================================================================
export function makePacket(ctx, { color = P.live } = {}) {
  const g = new THREE.Group(); g.name = 'packet';
  const body = M(rbox(1, 0.66, 0.05, 0.022, 3), std(P.paper, { roughness: 0.55 }));
  g.add(body);
  const { g: c2, t: tex } = canvasTex(512, 338);
  const draw = () => {
    const x = c2; x.clearRect(0, 0, 512, 338);
    x.fillStyle = '#fbf8f2'; x.fillRect(0, 0, 512, 338);
    // envelope flap
    x.strokeStyle = 'rgba(20,24,32,.16)'; x.lineWidth = 7; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(18, 22); x.lineTo(256, 196); x.lineTo(494, 22); x.stroke();
    x.beginPath(); x.moveTo(18, 316); x.lineTo(196, 176); x.moveTo(494, 316); x.lineTo(316, 176); x.stroke();
    // lock seal
    x.fillStyle = color; x.beginPath(); x.arc(256, 196, 74, 0, 7); x.fill();
    x.strokeStyle = '#ffffff'; x.lineWidth = 14; x.beginPath(); x.arc(256, 176, 26, Math.PI, 0); x.lineTo(282, 192); x.moveTo(230, 192); x.lineTo(230, 176); x.stroke();
    x.fillStyle = '#ffffff'; cr2d(x, 212, 186, 88, 64, 12); x.fill();
    x.fillStyle = color; x.beginPath(); x.arc(256, 212, 9, 0, 7); x.fill(); x.fillRect(252, 214, 8, 20);
  };
  whenFonts(() => { draw(); tex.needsUpdate = true; });
  const faceM = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.86, 0.86, 0.86) });
  const faceG = geo('pk-face', () => rrPlane(0.97, 0.63, 0.02));
  const f1 = M(faceG, faceM); f1.position.z = 0.0255; g.add(f1);
  const f2 = M(faceG, faceM); f2.position.z = -0.0255; f2.rotation.y = Math.PI; g.add(f2);
  // bright rim (blooms)
  const rimG = geo('pk-rim', () => { const s = rrPath(rrShape(1.07, 0.73, 0.1), 1.015, 0.675, 0.05); const e = new THREE.ExtrudeGeometry(s, { depth: 0.024, bevelEnabled: false, curveSegments: 8 }); e.translate(0, 0, -0.012); return e; });
  const rimM = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.7), transparent: true, opacity: 1 });
  g.add(M(rimG, rimM));
  g.userData = { rim: rimM, face: faceM };
  return g;
}
export function bezier(from, ctrl, to, k) {
  const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
  return new THREE.Vector3(a * from.x + b * ctrl.x + c * to.x, a * from.y + b * ctrl.y + c * to.y, a * from.z + b * ctrl.z + c * to.z);
}
// Places obj on a quadratic arc from → to at progress k (0..1). The card flies edge-first, nosing along the arc.
export function flyArc(obj, from, to, k, { lift, wobble = 1, ctrl } = {}) {
  const A = toV3(from), B = toV3(to), kk = clamp(k);
  const C = ctrl ? toV3(ctrl) : A.clone().add(B).multiplyScalar(0.5).add(new THREE.Vector3(0, lift ?? Math.max(0.35 * A.distanceTo(B), 0.4), 0));
  const p = bezier(A, C, B, kk);
  const tg = C.clone().sub(A).multiplyScalar(2 * (1 - kk)).add(B.clone().sub(C).multiplyScalar(2 * kk));
  if (tg.lengthSq() < 1e-8) tg.set(0, 1, 0);
  tg.normalize();
  const yaw = Math.atan2(tg.x, tg.z), pitch = Math.asin(clamp(tg.y, -1, 1));
  obj.position.copy(p);
  obj.rotation.set(wobble * 0.25 * Math.sin(kk * Math.PI * 2), yaw - Math.PI / 2, pitch * 0.85, 'YZX');
  return p;
}

// =====================================================================================================
// 7. The cloud vault ("the servers", no logo)
// =====================================================================================================
export function makeCloud(ctx) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'cloud';
  const cg = geo('cloud', () => {
    const puffs = [[-3.5, 1.0, 0, 1.45], [-1.7, 1.25, 0.25, 2.0], [0.6, 1.35, 0, 2.35], [2.9, 1.05, 0.15, 1.75], [4.3, 0.75, 0, 1.1],
      [-0.6, 2.75, -0.1, 1.85], [1.75, 2.35, 0.05, 1.5], [-2.5, 2.15, 0.05, 1.3]];
    const parts = puffs.map(([x, y, z, r]) => { const s = new THREE.IcosahedronGeometry(r, 1); s.scale(1, 1, 0.82); s.translate(x, y, z); return s; });
    const m = mergeGeometries(parts);
    const p = m.attributes.position, col = [];
    const lo = new THREE.Color(mixHex(P.towers[2], P.skyTop, 0.35)), hi = new THREE.Color('#fbfcfe');
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0.15) p.setY(i, 0.15 + (p.getY(i) - 0.15) * 0.08);
      const k = clamp((p.getY(i) - 0.1) / 3.6); const c = lo.clone().lerp(hi, smooth(k)); col.push(c.r, c.g, c.b);
    }
    m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    m.computeVertexNormals();
    return m;
  });
  g.add(M(cg, new THREE.MeshStandardMaterial({ color: '#ebedf1', vertexColors: true, roughness: 0.92, flatShading: true })));
  // the lock (dark body, steel shackle, glowing keyhole)
  const lock = new THREE.Group(); at(lock, 0.55, 1.45, 1.95); g.add(lock);
  lock.add(M(rbox(1.5, 1.2, 0.5, 0.2, 4), std(P.ink, { roughness: 0.4, envMap: env, envMapIntensity: 0.2 })));
  const steel = new THREE.MeshStandardMaterial({ color: '#dfe3e8', metalness: 1, roughness: 0.25, envMap: env, envMapIntensity: 1 });
  const shackle = M(geo('cl-shackle', () => new THREE.TorusGeometry(0.44, 0.11, 12, 32, Math.PI)), steel); at(shackle, 0, 0.78, 0); lock.add(shackle);
  for (const x of [-0.44, 0.44]) lock.add(at(M(cyl(0.11, 0.11, 0.3, 12), steel), x, 0.63, 0));
  const keyM = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.live).multiplyScalar(1.8) });
  const kh = M(geo('cl-key', () => { const s = new THREE.Shape(); s.absarc(0, 0.08, 0.14, 0, Math.PI * 2, false); const a = new THREE.ShapeGeometry(s, 16);
    const b = new THREE.ShapeGeometry(rrShape(0.12, 0.3, 0.04)); b.translate(0, -0.1, 0); return mergeGeometries([a, b]); }), keyM);
  kh.position.z = 0.252; lock.add(kh);
  // halo ring under the cloud (blooms)
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.routeGlow).multiplyScalar(1.9), transparent: true, opacity: 0.9 });
  const halo = M(geo('cl-halo', () => { const t = new THREE.TorusGeometry(4.2, 0.06, 6, 128); t.rotateX(Math.PI / 2); t.scale(1, 1, 0.55); return t; }), glowM);
  at(halo, 0.4, 0.05, 0); g.add(halo);
  const inlet = new THREE.Object3D(); at(inlet, -0.4, 4.6, 0); g.add(inlet);
  g.userData = { inlet, lock, glow: glowM, keyhole: keyM, width: 10 };
  return g;
}

// =====================================================================================================
// 8. LOC: story locations in the existing city (see notes/lib.md)
// =====================================================================================================
const RAMP_PTS = [[-1108, 0.1, 252], [-1140, 0.1, 252], [-1168, 0.4, 246], [-1186, 1.6, 232], [-1190, 3.4, 216], [-1180, 5.4, 204], [-1160, 7.0, 199], [-1132, 7.8, 198], [-1104, 8, 198]];
export const LOC = {
  airport: V(-1000, 0, 262),            // baggage cart (cart 1) on the apron, in front of the terminal's baggage door
  airportBelt: V(-994, 1.3, 255),       // end of the baggage belt (top surface)
  plane: V(-1035, 0, 288),              // parked jet (centre)
  cartPath: linePath([[-1000, 0, 262], [-1006, 0, 263.5], [-1010, 0, 272], [-1010, 0, 288], [-1015, 0, 298], [-1028, 0, 301]]),   // cart 1 centre: belt → round the wingtip → plane hold
  shuttleStop: V(-1108, 0.1, 252),      // airport curb (west end of the terminal): start of LOC.shuttleRoute
  rampPath: linePath(RAMP_PTS),         // curb → up onto the highway's west end (deck built by makeAirportProps)
  hotel: V(630.25, 0.3, -323),          // inside the glass lobby (floor), downtown, base of the 118 m tower
  hotelFront: V(630.25, 0, -318.5),     // lobby façade centre (street z = -310 is in front, +z)
  lobbyWalk: linePath([[623.4, 0.3, -320.4], [630, 0.3, -320.9], [637.2, 0.3, -321.6]]),
  street: V(156.3, 0.25, 104),          // quiet sidewalk, mid-city (east side of the x=150 street), café front behind
  streetWalk: linePath([[157.8, 0.25, 70], [157.8, 0.25, 142]]),   // stranger's line (heading +z), passes 1.5 m from LOC.street (s≈34)
  stage: V(0, 0.05, 3200),              // empty studio room floor centre, far south of the city (inside the sky dome)
};
let SHUTTLE = null;
function shuttleRoute() {
  if (SHUTTLE) return SHUTTLE;
  const w = (globalThis.ctx && globalThis.ctx.city) || null;
  if (!w) throw new Error('gadgets.js: LOC.shuttleRoute needs ctx.city (call initLib(ctx) first)');
  const hw = w.paths.highway, route = w.paths.route;
  const sMerge = w.s.hwyMerge + 4;
  const pts = RAMP_PTS.map(toV3);
  for (let s = 6; s < sMerge; s += 3) pts.push(hw.side(s, 8, 0));
  for (let s = w.s.routeHwyStart; s <= route.length; s += 3) pts.push(route.at(s));
  pts.push(V(624, 0.1, -311.6), V(640, 0.1, -312.5), V(652, 0.1, -312.5));
  const dd = []; for (const p of pts) if (!dd.length || dd[dd.length - 1].distanceTo(p) > 1.0) dd.push(p);
  const c = new THREE.CatmullRomCurve3(dd, false, 'centripetal'); c.arcLengthDivisions = 8000;
  const path = makePath(c);
  SHUTTLE = { path, length: path.length, sHwy0: path.nearest(hw.side(8, 8)), sHwy1: path.nearest(hw.side(w.s.hwyExit, 8)), sHotel: path.nearest(V(630.25, 0.1, -312.5)),
    highway: { path: hw, s0: 6, s1: w.s.hwyExit, off: 8 } };
  return SHUTTLE;
}
Object.defineProperty(LOC, 'shuttleRoute', { get: shuttleRoute, enumerable: true });
export function initLib(ctx) { if (!globalThis.ctx) globalThis.ctx = ctx; libEnv(ctx); return LOC; }

// =====================================================================================================
// Airport (terminal + canopy, baggage belt, tug + carts, jet, tower, runway, ramp to the highway)
// =====================================================================================================
function makeBagLite(ctx, color, s = 1) { const b = makeSuitcase(ctx, { color, lite: true, handle: 0 }); b.scale.setScalar(s); return b; }
function makeDuffel(ctx, color) {
  const g = new THREE.Group();
  const m = M(geo('duffel', () => { const c = new THREE.CapsuleGeometry(0.17, 0.42, 6, 14); c.rotateZ(Math.PI / 2); return c; }), std(color, { roughness: 0.85 }));
  m.scale.set(1, 0.85, 1); m.position.y = 0.15; g.add(m);
  g.add(at(M(geo('duffel-h', () => { const t = new THREE.TorusGeometry(0.1, 0.014, 6, 16, Math.PI); return t; }), std('#2c3036')), 0, 0.29, 0));
  return g;
}

function makeTug(ctx) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'tug';
  const body = std(P.slow, { roughness: 0.5, envMap: env, envMapIntensity: 0.1 }), dark = std('#2c3036', { roughness: 0.6 });
  g.add(at(M(rbox(1.35, 0.7, 2.5, 0.16, 3), body, { cast: true }), 0, 0.62, 0));
  g.add(at(M(rbox(1.25, 0.08, 1.1, 0.03, 2), dark, { cast: true }), 0, 1.9, -0.45));
  for (const x of [-0.56, 0.56]) for (const z of [-0.95, 0.05]) g.add(at(M(cyl(0.035, 0.035, 0.95, 8), dark), x, 1.45, z));
  g.add(at(M(rbox(0.5, 0.5, 0.45, 0.08, 2), std(P.history)), 0, 1.15, -0.55));         // seat
  const sw = M(cyl(0.16, 0.16, 0.05, 16), dark); at(sw, 0, 1.25, 0.25); sw.rotation.x = -0.9; g.add(sw);   // steering wheel
  const wg = geo('tug-wheel', () => { const c = new THREE.CylinderGeometry(0.3, 0.3, 0.24, 18); c.rotateZ(Math.PI / 2); return c; });
  for (const x of [-0.6, 0.6]) for (const z of [-0.8, 0.85]) g.add(at(M(wg, dark), x, 0.3, z));
  for (const x of [-0.4, 0.4]) g.add(at(M(rbox(0.2, 0.1, 0.04, 0.02, 2), new THREE.MeshBasicMaterial({ color: '#fff6dc' })), x, 0.78, 1.26));
  g.add(at(M(box(0.06, 0.06, 0.6), dark), 0, 0.35, -1.5));
  return g;
}
function makeBagCart(ctx, { roof = true } = {}) {
  const g = new THREE.Group(); g.name = 'bagCart';
  const frame = std('#5a6068', { roughness: 0.6 }), deckM = std('#8f9aa6', { roughness: 0.8 }), dark = std('#2c3036');
  g.add(at(M(rbox(1.5, 0.12, 2.8, 0.04, 2), deckM, { cast: true }), 0, 0.55, 0));
  g.add(at(M(box(1.42, 0.12, 2.7), frame), 0, 0.44, 0));
  for (const z of [-1.38, 1.38]) g.add(at(M(rbox(1.5, 0.5, 0.06, 0.02, 2), frame, { cast: true }), 0, 0.86, z));
  const wg = geo('cart-wheel', () => { const c = new THREE.CylinderGeometry(0.22, 0.22, 0.16, 16); c.rotateZ(Math.PI / 2); return c; });
  for (const x of [-0.62, 0.62]) for (const z of [-1.0, 1.0]) g.add(at(M(wg, dark), x, 0.22, z));
  g.add(at(M(box(0.06, 0.06, 0.7), dark), 0, 0.38, 1.7));
  if (roof) {
    for (const x of [-0.7, 0.7]) for (const z of [-1.36, 1.36]) g.add(at(M(cyl(0.035, 0.035, 1.5, 8), frame), x, 1.35, z));
    g.add(at(M(rbox(1.62, 0.07, 2.95, 0.03, 2), std(P.paper, { roughness: 0.7 }), { cast: true }), 0, 2.12, 0));
  }
  const slot = new THREE.Object3D(); at(slot, 0, 0.61, 0); g.add(slot); g.userData.slot = slot;
  return g;
}
function makeJet(ctx) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'jet';
  const white = std('#e9e5dd', { roughness: 0.5, envMap: env, envMapIntensity: 0.1 }), belly = std(P.towers[2], { roughness: 0.6 });
  const accent = std(P.route, { roughness: 0.5 }), dark = std('#2c3036', { roughness: 0.4 });
  // fuselage (lathe along y, then laid along z: nose = +z)
  const prof = [[0, -18], [0.55, -17.4], [1.2, -16.2], [1.7, -14.4], [1.93, -12.2], [2.0, -9.5], [2.0, 6], [1.96, 11.5], [1.75, 14.2], [1.4, 15.9], [0.85, 17.2], [0, 18]];
  const fus = M(geo('jet-fus', () => { const l = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28); l.rotateX(Math.PI / 2); return l; }), white, { cast: true });
  fus.position.y = 3.2; g.add(fus);
  // window stripe + cockpit
  for (const s of [-1, 1]) g.add(at(M(box(0.05, 0.26, 21), dark), s * 1.99, 3.55, -0.5));
  g.add(at(M(rbox(2.2, 0.42, 1.0, 0.16, 2), dark), 0, 3.95, 15.4));
  // wings (swept), engines
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 3.5); wingShape.lineTo(17, -4.5); wingShape.lineTo(17, -6.2); wingShape.lineTo(0, -3.5); wingShape.closePath();
  const wingG = geo('jet-wing', () => { const e = new THREE.ExtrudeGeometry(wingShape, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1 }); e.rotateX(Math.PI / 2); return e; });
  for (const s of [-1, 1]) {
    const w = M(wingG, white, { cast: true }); w.scale.x = s; at(w, 0, 2.3, 0); g.add(w);
    const eng = M(geo('jet-eng', () => { const c = new THREE.CylinderGeometry(1.0, 0.85, 3.8, 20); c.rotateX(Math.PI / 2); return c; }), belly, { cast: true });
    at(eng, s * 6.2, 1.25, 1.2); g.add(eng);
    g.add(at(M(geo('jet-inlet', () => { const c = new THREE.CircleGeometry(0.86, 20); return c; }), dark), s * 6.2, 1.25, 3.11));
    g.add(at(M(box(0.3, 0.7, 2), white), s * 6.2, 1.95, 0.6));
  }
  // tail: fin (accent) + stabilisers
  const finShape = new THREE.Shape(); finShape.moveTo(0, 0); finShape.lineTo(5.5, 0); finShape.lineTo(6.3, 6.6); finShape.lineTo(4.2, 6.6); finShape.closePath();
  const fin = M(geo('jet-fin', () => { const e = new THREE.ExtrudeGeometry(finShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1 }); e.translate(0, 0, -0.15); e.rotateY(Math.PI / 2); return e; }), accent, { cast: true });
  at(fin, 0, 4.7, -11.3); g.add(fin);
  const stabShape = new THREE.Shape(); stabShape.moveTo(0, 1.5); stabShape.lineTo(6, -1.6); stabShape.lineTo(6, -2.6); stabShape.lineTo(0, -1.8); stabShape.closePath();
  const stabG = geo('jet-stab', () => { const e = new THREE.ExtrudeGeometry(stabShape, { depth: 0.22, bevelEnabled: false }); e.rotateX(Math.PI / 2); return e; });
  for (const s of [-1, 1]) { const st = M(stabG, white, { cast: true }); st.scale.x = s; at(st, 0, 3.5, -15.6); g.add(st); }
  // gear
  for (const [x, z] of [[0, 13], [-2.4, -1.2], [2.4, -1.2]]) { g.add(at(M(cyl(0.12, 0.12, 1.6, 8), dark), x, 0.9, z)); g.add(at(M(geo('jet-tyre', () => { const c = new THREE.CylinderGeometry(0.42, 0.42, 0.4, 14); c.rotateZ(Math.PI / 2); return c; }), dark), x, 0.42, z)); }
  return g;
}

export function makeAirportProps(ctx) {
  const env = libEnv(ctx);
  const O = LOC.airport;
  const g = new THREE.Group(); g.name = 'airport'; g.position.copy(O);
  const L = (x, y, z) => V(x - O.x, y - O.y, z - O.z);     // world → local
  const apronM = std(mixHex(P.street, P.curb, 0.55), { roughness: 1 });
  const lineAmber = std(P.slow, { roughness: 0.9 }), lineWhite = std(P.lane, { roughness: 0.9 });
  const flat = (w, d, m, x, z, y = 0.04) => { const p = M(geo(`flat${w}|${d}`, () => { const q = new THREE.PlaneGeometry(w, d); q.rotateX(-Math.PI / 2); return q; }), m); at(p, x, y, z); g.add(p); return p; };
  // apron (local z: terminal front at -22)
  flat(230, 190, apronM, 25, 73, 0.03);
  // apron markings
  flat(0.35, 120, lineAmber, -35, 50, 0.05);                       // jet lead-in line
  flat(6, 0.5, lineAmber, -35, 8.5, 0.05);                         // stop bar
  for (let x = -75; x < 135; x += 9) flat(5, 0.25, lineWhite, x, 12, 0.05);   // service road dashes
  flat(210, 0.25, lineWhite, 25, -7, 0.05);
  flat(210, 0.4, lineAmber, 25, -15, 0.05);
  // runway far south (outside the suburb)
  const rwM = std('#5a6068', { roughness: 0.95 });
  flat(560, 46, rwM, -110, 232, 0.035);
  for (let x = -380; x < 160; x += 30) flat(14, 0.8, lineWhite, x, 232, 0.05);
  for (const z of [212, 252]) flat(560, 0.6, lineWhite, -110, z, 0.05);

  // terminal body + glass front + baggage door
  const termM = std(P.buildings[0], { roughness: 0.9 });
  g.add(at(M(box(180, 13, 26), termM, { cast: true }), 0, 6.5, -35));
  const { g: gc, t: glassTex } = canvasTex(512, 128);
  gc.fillStyle = mixHex(P.water, P.towers[1], 0.4); gc.fillRect(0, 0, 512, 128);
  const gr = gc.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(20,30,45,.18)'); gc.fillStyle = gr; gc.fillRect(0, 0, 512, 128);
  gc.fillStyle = 'rgba(240,236,228,.95)'; for (let x = 0; x < 512; x += 32) gc.fillRect(x, 0, 3, 128); gc.fillRect(0, 62, 512, 3);
  glassTex.wrapS = THREE.RepeatWrapping; glassTex.repeat.set(11, 1);
  const glassFront = M(geo('ap-glass', () => new THREE.PlaneGeometry(178, 11.5)), new THREE.MeshStandardMaterial({ map: glassTex, roughness: 0.15, metalness: 0.1, envMap: env, envMapIntensity: 0.5 }));
  at(glassFront, 0, 6.6, -21.94); g.add(glassFront);
  // baggage door: dark opening with rubber strips, and the belt
  const dark = std('#2c3036', { roughness: 0.7 });
  g.add(at(M(box(7, 3.8, 0.3), std('#1d2129')), 6, 1.9, -21.85));
  for (let i = 0; i < 12; i++) g.add(at(M(box(0.5, 3.4, 0.06), std(i % 2 ? '#3b4048' : '#33373e')), 3.25 + i * 0.5, 2.0, -21.62));
  g.add(at(M(rbox(7.6, 0.4, 0.4, 0.1, 2), std(P.slow)), 6, 4.0, -21.6));
  const belt = new THREE.Group(); at(belt, 6, 0, -14); g.add(belt);
  belt.add(at(M(rbox(1.5, 0.22, 14, 0.06, 2), dark, { cast: true }), 0, 1.15, 0));
  belt.add(at(M(box(1.62, 0.3, 14), std('#8f9aa6')), 0, 0.92, 0));
  for (const z of [-6, -2, 2, 6]) for (const x of [-0.65, 0.65]) belt.add(at(M(box(0.12, 0.8, 0.12), std('#8f9aa6')), x, 0.4, z));
  // canopy roof (wave), with slender columns
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-50, 13.5); roofShape.quadraticCurveTo(-30, 19.5, -6, 15.6); roofShape.lineTo(-6, 14.8); roofShape.quadraticCurveTo(-30, 18.5, -50, 12.6); roofShape.closePath();
  const roofG = geo('ap-roof', () => { const e = new THREE.ExtrudeGeometry(roofShape, { depth: 192, bevelEnabled: false, curveSegments: 24 }); e.rotateY(-Math.PI / 2); e.translate(96, 0, 0); return e; });
  g.add(M(roofG, std(P.paper, { roughness: 0.7, side: THREE.DoubleSide }), { cast: true }));
  for (let x = -90; x <= 90; x += 20) g.add(at(M(cyl(0.35, 0.35, 15.4, 10), std(P.paper, { roughness: 0.6 }), { cast: true }), x, 7.7, -9));
  // jet bridge to the plane's door
  const jet = makeJet(ctx); at(jet, -35, 0, 26); jet.rotation.y = Math.PI; g.add(jet);   // nose toward the terminal (-z)
  const bridgeM = std(P.buildings[3], { roughness: 0.8 });
  const bA = V(-46, 4.6, -21), bB = V(-38.4, 4.3, 12.2);
  const bl = bA.distanceTo(bB);
  const bridge = M(rbox(2.6, 2.8, bl, 0.3, 2), bridgeM, { cast: true }); bridge.position.copy(bA).lerp(bB, 0.5); bridge.lookAt(bB); g.add(bridge);
  g.add(at(M(cyl(0.3, 0.3, 3.4, 8), dark), -40.2, 1.7, 5));
  // control tower (west)
  const tw = new THREE.Group(); at(tw, -175, 0, 40); g.add(tw);
  tw.add(at(M(cyl(2.2, 3.0, 30, 16), std(P.paper, { roughness: 0.8 }), { cast: true }), 0, 15, 0));
  tw.add(at(M(cyl(5.2, 3.8, 1.4, 8), std(P.paper), { cast: true }), 0, 30.4, 0));
  tw.add(at(M(cyl(5.0, 5.0, 3.6, 8), new THREE.MeshStandardMaterial({ color: mixHex(P.water, P.ink, 0.35), roughness: 0.15, metalness: 0.2, envMap: env, envMapIntensity: 0.7 })), 0, 32.9, 0));
  tw.add(at(M(cyl(5.6, 5.6, 0.7, 8), std(P.paper), { cast: true }), 0, 35, 0));
  tw.add(at(M(cyl(0.12, 0.12, 4, 6), dark), 0, 37, 0));
  // baggage train: tug + 2 carts, local +z = forward; parked heading west (-x)
  const train = new THREE.Group(); train.name = 'train'; train.rotation.y = -Math.PI / 2; g.add(train);
  const tug = makeTug(ctx); at(tug, 0, 0, 3.15); train.add(tug);
  const cart1 = makeBagCart(ctx, { roof: false }); train.add(cart1);
  const cart2 = makeBagCart(ctx, { roof: true }); at(cart2, 0, 0, -3.35); train.add(cart2);
  const bagCols = [P.history, '#3b4048', P.roofs[0], P.trees[1], P.towers[3], P.roofs[3], '#5c626b'];
  const placeBag = (parent, obj, x, z, ry, lay = true) => { if (lay) { obj.rotation.set(-Math.PI / 2, 0, ry); obj.position.set(x, 0.14, z); } else { obj.rotation.y = ry; obj.position.set(x, 0, z); } parent.add(obj); return obj; };
  placeBag(cart1.userData.slot, makeBagLite(ctx, bagCols[0]), -0.36, -0.6, 0.1);
  placeBag(cart1.userData.slot, makeDuffel(ctx, bagCols[2]), 0.35, -0.85, 0.05, false).rotation.y = Math.PI / 2;
  placeBag(cart1.userData.slot, makeBagLite(ctx, bagCols[4]), 0.38, 0.95, -0.12);
  placeBag(cart2.userData.slot, makeBagLite(ctx, bagCols[1]), -0.36, -0.6, 0.05);
  placeBag(cart2.userData.slot, makeBagLite(ctx, bagCols[3]), 0.36, -0.62, -0.08);
  placeBag(cart2.userData.slot, makeBagLite(ctx, bagCols[5]), -0.34, 0.6, 0.12);
  placeBag(cart2.userData.slot, makeDuffel(ctx, bagCols[6]), 0.3, 0.75, 0, false).rotation.y = Math.PI / 2;
  const cartSlot = new THREE.Object3D(); cartSlot.name = 'cartSlot'; at(cartSlot, -0.1, 0, 0.25); cart1.userData.slot.add(cartSlot);
  // a few bags waiting at the belt end
  placeBag(g, makeBagLite(ctx, bagCols[5]), 7.6, -6.2, 0.4, false);
  placeBag(g, makeBagLite(ctx, bagCols[1]), 4.6, -6.6, -0.3, false);
  // ramp: curb → highway west end (asphalt deck, slab, barriers, pillars)
  const rp = LOC.rampPath;
  const rampG = new THREE.Group(); rampG.position.copy(O).multiplyScalar(-1); g.add(rampG);
  const asphalt = std(P.asphalt, { roughness: 0.92 }), pillarM = std(P.pillar, { roughness: 0.95 }), barrierM = std(P.barrier, { roughness: 0.9, side: THREE.DoubleSide });
  const deck = M(ctx.ribbonGeometry(rp, 0, rp.length, 10, { dy: 0.07, step: 1.5 }), asphalt); rampG.add(deck);
  rampG.add(M(stripBox(rp, 0, rp.length, 11, 1.3, -1.36, 0, 1.2), std(P.pillar, { roughness: 1, side: THREE.DoubleSide }), { cast: true }));
  for (const sg of [-1, 1]) rampG.add(M(stripBox(rp, 0, rp.length, 0.5, 1.0, 0, sg * 5.1, 0.6), barrierM, { cast: true }));
  for (let s = 10; s < rp.length; s += 18) { const p = rp.at(s); if (p.y < 2.8) continue; const pil = M(box(2, p.y - 1.3, 5), pillarM, { cast: true }); at(pil, p.x, (p.y - 1.3) / 2, p.z); const tg = rp.tangent(s); pil.rotation.y = Math.atan2(tg.x, tg.z); rampG.add(pil); }
  rampG.add(at(M(box(1.0, 1.1, 14), barrierM, { cast: true }), -1100.3, 8.5, 184));   // end cap for the westbound half
  // curb + drop-off canopy at the ramp foot
  rampG.add(at(M(box(26, 0.25, 4), std(P.curb)), -1110, 0.125, 258.5));
  rampG.add(at(M(box(24, 0.4, 7), std(P.paper), { cast: true }), -1112, 5.2, 258));
  for (const x of [-1122, -1102]) rampG.add(at(M(cyl(0.25, 0.25, 5, 8), std(P.paper)), x, 2.5, 260));
  g.userData = { cartSlot, train, tug, carts: [cart1, cart2], belt, plane: jet, rampPath: rp, terminalFront: L(-1000, 0, 240) };
  return g;
}

// =====================================================================================================
// Airport shuttle bus (faces +z, origin ground centre)
// =====================================================================================================
export function makeShuttle(ctx, { color = P.route } = {}) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'shuttle';
  const Wd = 2.5, Ln = 10.5;
  const white = new THREE.MeshPhysicalMaterial({ color: '#e9e5dd', roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.35 });
  const accent = std(color, { roughness: 0.45, envMap: env, envMapIntensity: 0.1 });
  const dark = std('#2c3036', { roughness: 0.6 });
  g.add(at(M(rbox(Wd, 1.2, Ln, 0.2, 3), white, { cast: true }), 0, 1.0, 0));      // lower body 0.4 .. 1.6
  g.add(at(M(rbox(Wd, 0.5, Ln, 0.22, 3), white, { cast: true }), 0, 2.85, 0));    // roof 2.6 .. 3.1
  g.add(at(M(rbox(1.5, 0.3, 3.2, 0.1, 2), std(P.pillar), { cast: true }), 0, 3.2, -1.5));   // AC unit
  // accent band + skirt
  for (const s of [-1, 1]) g.add(at(M(box(0.03, 0.34, Ln - 0.6), accent), s * (Wd / 2 + 0.002), 1.28, 0));
  g.add(at(M(rbox(Wd + 0.02, 0.26, Ln + 0.02, 0.1, 2), dark), 0, 0.48, 0));
  // pillars + glass
  const pil = (x, z, w = 0.14) => g.add(at(M(box(w, 1.02, 0.2), white), x, 2.1, z));
  for (const s of [-1, 1]) { for (let z = -Ln / 2 + 0.15; z <= Ln / 2 - 0.1; z += 1.7) pil(s * (Wd / 2 - 0.07), z); pil(s * (Wd / 2 - 0.07), Ln / 2 - 0.12); }
  const glassM = new THREE.MeshPhysicalMaterial({ color: '#25303c', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.6, envMap: env, envMapIntensity: 1.0, side: THREE.DoubleSide, depthWrite: false });
  for (const s of [-1, 1]) { const p = M(geo('sh-side', () => new THREE.PlaneGeometry(Ln - 0.3, 1.0)), glassM); p.rotation.y = s * Math.PI / 2; at(p, s * (Wd / 2 - 0.02), 2.1, 0); g.add(p); }
  const fg = M(geo('sh-front', () => new THREE.PlaneGeometry(Wd - 0.2, 1.25)), glassM); at(fg, 0, 1.98, Ln / 2 - 0.02); g.add(fg);
  const rg = M(geo('sh-rear', () => new THREE.PlaneGeometry(Wd - 0.4, 0.9)), glassM); rg.rotation.y = Math.PI; at(rg, 0, 2.1, -Ln / 2 + 0.02); g.add(rg);
  // interior: floor + seat backs
  g.add(at(M(box(Wd - 0.2, 0.04, Ln - 0.4), std(P.history)), 0, 1.62, 0));
  const seatM = std(mixHex(P.route, P.ink, 0.45), { roughness: 0.8 });
  for (let z = -2.4; z <= 3.6; z += 1.0) for (const x of [-0.62, 0.62]) g.add(at(M(rbox(0.52, 0.55, 0.12, 0.05, 2), seatM), x, 1.95, z));
  // door (right side = -x), lights, mirrors, sign
  g.add(at(M(box(0.03, 2.0, 1.2), std('#3b4048')), -Wd / 2 - 0.004, 1.5, Ln / 2 - 1.3));
  for (const x of [-0.85, 0.85]) {
    g.add(at(M(rbox(0.42, 0.16, 0.06, 0.04, 2), new THREE.MeshBasicMaterial({ color: '#fff4d8' })), x, 0.95, Ln / 2 + 0.005));
    g.add(at(M(rbox(0.3, 0.18, 0.06, 0.04, 2), new THREE.MeshBasicMaterial({ color: P.jam })), x, 1.05, -Ln / 2 - 0.005));
    g.add(at(M(rbox(0.08, 0.32, 0.18, 0.03, 2), dark), x * 1.62, 2.3, Ln / 2 - 0.25));
  }
  const { g: sc, t: signTex } = canvasTex(512, 64);
  whenFonts(() => { sc.fillStyle = '#14171c'; sc.fillRect(0, 0, 512, 64); sc.fillStyle = '#ffb347'; sc.font = '700 36px "JetBrains Mono"'; sc.textAlign = 'center'; sc.textBaseline = 'middle'; sc.fillText('AIRPORT ⇄ HOTELS', 256, 34); signTex.needsUpdate = true; });
  const sign = M(geo('sh-sign', () => new THREE.PlaneGeometry(1.9, 0.24)), new THREE.MeshBasicMaterial({ map: signTex })); at(sign, 0, 2.74, Ln / 2 + 0.006); g.add(sign);
  const { g: dc, t: decTex } = canvasTex(1024, 64);
  whenFonts(() => { dc.clearRect(0, 0, 1024, 64); dc.fillStyle = '#ffffff'; dc.font = '800 40px Inter'; dc.textBaseline = 'middle'; dc.textAlign = 'left'; if ('letterSpacing' in dc) dc.letterSpacing = '6px'; dc.fillText('AIRPORT SHUTTLE', 30, 34); decTex.needsUpdate = true; });
  for (const s of [-1, 1]) { const d = M(geo('sh-dec', () => new THREE.PlaneGeometry(6.4, 0.3)), new THREE.MeshBasicMaterial({ map: decTex, transparent: true, depthWrite: false }));
    d.rotation.y = s * Math.PI / 2; at(d, s * (Wd / 2 + 0.02), 1.28, s * -0.6); if (s < 0) d.scale.x = 1; g.add(d); }
  // wheels
  const wheels = [];
  const wg = geo('sh-wheel', () => { const c = new THREE.CylinderGeometry(0.5, 0.5, 0.34, 20); c.rotateZ(Math.PI / 2); return c; });
  const hg = geo('sh-hub', () => { const c = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 12); c.rotateZ(Math.PI / 2); return c; });
  const archG = geo('sh-arch', () => new THREE.CircleGeometry(0.64, 20, 0, Math.PI));
  for (const x of [-1, 1]) for (const z of [-3.4, 3.4]) { const a = M(archG, dark); a.rotation.y = x * Math.PI / 2; at(a, x * 1.256, 0.42, z); g.add(a); }
  for (const x of [-1.11, 1.11]) for (const z of [-3.4, 3.4]) { const w = new THREE.Group(); at(w, x, 0.5, z); w.add(M(wg, dark, { cast: true }), M(hg, std('#c5cacf', { roughness: 0.5 }))); g.add(w); wheels.push(w); }
  const bagSlot = new THREE.Object3D(); bagSlot.name = 'bagSlot'; at(bagSlot, 0.45, 1.64, -4.3); g.add(bagSlot);
  g.add(makeContactShadow(ctx, { w: 3.6, d: 12, opacity: 0.38 }));
  g.userData = { bagSlot, wheels, sign, length: Ln, width: Wd };
  return g;
}

// =====================================================================================================
// Hotel lobby: glass pavilion filling the alcove at the base of the downtown tower (open front, +z)
// =====================================================================================================
export function makeHotelLobby(ctx, { glass = 0.06 } = {}) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'hotelLobby'; g.position.copy(LOC.hotelFront);
  const Wl = 16.4, Dl = 8.4, Hl = 6.2, F = 0.3;
  const stone = std(mixHex(P.block, P.curb, 0.3), { roughness: 0.6, envMap: env, envMapIntensity: 0.08 });
  const wood = std(mixHex(P.roofs[3], '#ffffff', 0.12), { roughness: 0.7 });
  const woodDark = std(mixHex(P.roofs[3], P.ink, 0.3), { roughness: 0.6 });
  const wall = std(P.paper, { roughness: 0.9 });
  const ink = std('#2c3036', { roughness: 0.5, envMap: env, envMapIntensity: 0.15 });
  const brass = new THREE.MeshStandardMaterial({ color: '#d4b071', metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 1 });
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1d6').multiplyScalar(0.98) });
  // floor slab + front step + rug
  g.add(at(M(box(Wl, F, Dl + 1.2), stone), 0, F / 2, -Dl / 2 + 0.6));
  g.add(at(M(box(Wl, 0.15, 1.0), std(P.curb)), 0, 0.075, 1.45));
  g.add(at(M(box(5.2, 0.02, 3.4), std(mixHex(P.roofs[0], P.paper, 0.35), { roughness: 1 })), -4.3, F + 0.01, -4.6));
  // interior walls: back (wood slats + backlit sign), sides
  g.add(at(M(box(Wl, Hl, 0.2), wood), 0, F + Hl / 2, -Dl - 0.1));
  for (let x = -7.6; x <= 7.6; x += 0.55) g.add(at(M(box(0.16, Hl - 0.4, 0.12), woodDark), x, F + Hl / 2, -Dl + 0.05));
  const signTex = textTex('HOTEL', { w: 1024, h: 256, font: '800 150px Inter', color: '#ffeacc', spacing: '40px' });
  const recTex = textTex('RECEPTION', { w: 1024, h: 160, font: '700 70px Inter', color: '#ffeacc', spacing: '18px' });
  g.add(at(M(box(5.6, 1.0, 0.1), ink), 2.9, F + 3.3, -Dl + 0.16));
  const signIn = M(geo('ht-sign-in', () => new THREE.PlaneGeometry(5.2, 0.81)), new THREE.MeshBasicMaterial({ map: recTex, transparent: true, color: new THREE.Color(0.9, 0.9, 0.9) })); at(signIn, 2.9, F + 3.3, -Dl + 0.22); g.add(signIn);
  for (const s of [-1, 1]) g.add(at(M(box(0.2, Hl, Dl), wall), s * (Wl / 2 + 0.1), F + Hl / 2, -Dl / 2));
  // ceiling with a warm light cove + pendant lamps
  g.add(at(M(box(Wl + 0.4, 0.35, Dl + 0.2), wall), 0, F + Hl + 0.17, -Dl / 2));
  for (const z of [-2.2, -5.6]) g.add(at(M(box(Wl - 3, 0.04, 0.5), warm), 0, F + Hl - 0.03, z));
  for (const x of [-4.4, 0, 4.4]) { g.add(at(M(cyl(0.012, 0.012, 1.8, 4), ink), x, F + Hl - 0.9, -3.8)); g.add(at(M(sph(0.28, 18, 12), warm), x, F + Hl - 1.9, -3.8)); }
  // reception desk
  g.add(at(M(rbox(4.6, 1.1, 0.9, 0.12, 3), wood), 2.9, F + 0.55, -6.2));
  g.add(at(M(rbox(4.8, 0.08, 1.0, 0.03, 2), ink), 2.9, F + 1.12, -6.2));
  g.add(at(M(cyl(0.12, 0.16, 0.3, 12), brass), 1.4, F + 1.3, -6.1));
  // sofas + coffee table (lounge, left)
  const sofaM = std(P.history, { roughness: 0.9 });
  const sofa = (x, z, ry) => { const s = new THREE.Group(); at(s, x, F, z); s.rotation.y = ry; g.add(s);
    s.add(at(M(rbox(2.4, 0.42, 0.95, 0.14, 3), sofaM), 0, 0.3, 0)); s.add(at(M(rbox(2.4, 0.6, 0.25, 0.1, 3), sofaM), 0, 0.72, -0.38));
    for (const sx of [-1, 1]) s.add(at(M(rbox(0.25, 0.55, 0.95, 0.1, 2), sofaM), sx * 1.2, 0.48, 0)); };
  sofa(-6.6, -4.6, Math.PI / 2); sofa(-4.3, -6.9, 0);
  g.add(at(M(cyl(0.6, 0.6, 0.06, 24), woodDark), -4.4, F + 0.42, -4.6)); g.add(at(M(cyl(0.08, 0.12, 0.4, 10), ink), -4.4, F + 0.2, -4.6));
  // plants
  const potM = std(P.paper, { roughness: 0.7 });
  for (const [x, z] of [[-7.2, -1.3], [7.1, -1.3], [-0.6, -7.4]]) { g.add(at(M(cyl(0.42, 0.34, 0.75, 16), potM), x, F + 0.37, z));
    const c = M(geo('ht-leaf', () => new THREE.IcosahedronGeometry(0.75, 0)), std(P.trees[1], { roughness: 1, flatShading: true })); c.scale.set(1, 1.35, 1); at(c, x, F + 1.55, z); g.add(c); }
  // bell cart (brass luggage trolley)
  const cart = new THREE.Group(); at(cart, -2.4, F, -2.3); cart.rotation.y = 0.25; g.add(cart);
  cart.add(at(M(rbox(1.3, 0.1, 0.75, 0.04, 2), woodDark), 0, 0.2, 0));
  for (const x of [-0.6, 0.6]) { cart.add(at(M(cyl(0.025, 0.025, 1.7, 8), brass), x, 1.05, -0.3)); for (const z of [-0.3, 0.3]) cart.add(at(M(sph(0.07, 10, 8), ink), x, 0.07, z)); }
  const arch = M(geo('ht-arch', () => new THREE.TorusGeometry(0.6, 0.025, 8, 24, Math.PI)), brass); at(arch, 0, 1.9, -0.3); cart.add(arch);
  const cb1 = makeBagLite(ctx, P.roofs[0]); cb1.rotation.y = 0.1; at(cb1, -0.28, 0.25, 0.05); cart.add(cb1);
  const cb2 = makeDuffel(ctx, P.towers[3]); at(cb2, 0.32, 0.25, 0.05); cart.add(cb2);
  const cartSlot = new THREE.Object3D(); at(cartSlot, 0.3, 0.55, 0.05); cart.add(cartSlot);
  // façade: mullions, transom, faint glass, door frames
  const mull = std('#3b4048', { roughness: 0.4, envMap: env, envMapIntensity: 0.5 });
  for (const x of [-Wl / 2, -Wl / 4, -1.3, 1.3, Wl / 4, Wl / 2]) g.add(at(M(box(0.14, Hl, 0.2), mull, { cast: true }), x, F + Hl / 2, 0));
  g.add(at(M(box(Wl, 0.16, 0.2), mull), 0, F + Hl - 0.08, 0)); g.add(at(M(box(Wl, 0.12, 0.2), mull), 0, F + 2.9, 0));
  if (glass > 0) {
    const gm = new THREE.MeshPhysicalMaterial({ color: '#dbe6ee', roughness: 0.04, transparent: true, opacity: glass, envMap: env, envMapIntensity: 0.5, depthWrite: false });
    const gp = M(geo('ht-glass', () => new THREE.PlaneGeometry(Wl, Hl)), gm); at(gp, 0, F + Hl / 2, 0.02); g.add(gp);
  }
  for (const x of [-0.6, 0.6]) g.add(at(M(cyl(0.02, 0.02, 1.4, 6), brass), x, F + 1.2, 0.18));
  // canopy over the sidewalk + fascia sign + downlights
  g.add(at(M(box(Wl + 0.2, 0.4, 3.6), wall, { cast: false }), 0, F + Hl + 0.55, 1.6));
  const fascia = M(geo('ht-fascia', () => new THREE.PlaneGeometry(4.6, 1.15)), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  at(fascia, 0, F + Hl + 0.56, 3.41); fascia.scale.set(0.5, 0.3, 1); g.add(fascia);
  for (let x = -6; x <= 6; x += 2) g.add(at(M(geo('ht-dl', () => { const c = new THREE.CircleGeometry(0.14, 12); c.rotateX(Math.PI / 2); return c; }), warm), x, F + Hl + 0.34, 1.9));
  // big sign on the tower above the canopy
  g.add(at(M(box(9.4, 2.3, 0.3), ink), 0, 12.5, -Dl + 0.1));
  const signOut = M(geo('ht-sign-out', () => new THREE.PlaneGeometry(9.0, 2.25)), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  at(signOut, 0, 12.5, -Dl + 0.27); g.add(signOut);
  const bagSlot = new THREE.Object3D(); bagSlot.name = 'bagSlot'; at(bagSlot, 0.9, F, -2.4); bagSlot.rotation.y = -0.35; g.add(bagSlot);
  const inside = new THREE.Object3D(); at(inside, 0, F + 1.4, -Dl / 2); g.add(inside);
  g.userData = { bagSlot, cartSlot, inside, sign: signTex, width: Wl, depth: Dl, floorY: F };
  return g;
}

// =====================================================================================================
// Street spot: bench, lamp post, planter tree, café front (sidewalk at the block plate top, y = 0.25)
// =====================================================================================================
export function makeStreetProps(ctx) {
  const env = libEnv(ctx);
  const g = new THREE.Group(); g.name = 'streetProps'; g.position.copy(LOC.street);
  const metal = std('#3b4048', { roughness: 0.45, envMap: env, envMapIntensity: 0.4 });
  const wood = std(mixHex(P.roofs[3], '#ffffff', 0.1), { roughness: 0.75 });
  // bench facing the street (-x)
  const bench = new THREE.Group(); at(bench, 2.95, 0, 7.0); bench.rotation.y = -Math.PI / 2; g.add(bench);
  for (let i = 0; i < 3; i++) bench.add(at(M(rbox(1.8, 0.04, 0.12, 0.015, 2), wood), 0, 0.45, -0.17 + i * 0.15));
  for (let i = 0; i < 2; i++) { const b = M(rbox(1.8, 0.11, 0.035, 0.012, 2), wood); at(b, 0, 0.62 + i * 0.15, -0.26); b.rotation.x = -0.12; bench.add(b); }
  for (const x of [-0.75, 0.75]) { bench.add(at(M(box(0.05, 0.45, 0.45), metal), x, 0.225, -0.04)); bench.add(at(M(box(0.05, 0.4, 0.05), metal), x, 0.65, -0.27)); }
  const benchSeat = new THREE.Object3D(); at(benchSeat, 0, 0.47, 0); bench.add(benchSeat);
  // lamp post near the curb
  const lamp = new THREE.Group(); at(lamp, -0.4, 0, -8.0); g.add(lamp);
  lamp.add(at(M(cyl(0.06, 0.09, 4.6, 10), metal, { cast: true }), 0, 2.3, 0));
  lamp.add(at(M(box(0.9, 0.06, 0.08), metal), 0.38, 4.55, 0));
  lamp.add(at(M(rbox(0.55, 0.12, 0.28, 0.05, 2), metal), 0.75, 4.5, 0));
  lamp.add(at(M(box(0.44, 0.02, 0.2), new THREE.MeshBasicMaterial({ color: '#fff3d8' })), 0.75, 4.43, 0));
  // planter + tree
  const pl = new THREE.Group(); at(pl, -0.25, 0, 12.5); g.add(pl);
  pl.add(at(M(rbox(1.1, 0.5, 1.1, 0.08, 2), std(P.pillar)), 0, 0.25, 0));
  pl.add(at(M(cyl(0.08, 0.1, 2.0, 6), std(P.trunk)), 0, 1.4, 0));
  const can = M(geo('st-tree', () => new THREE.IcosahedronGeometry(1.1, 0)), std(P.trees[0], { roughness: 1, flatShading: true }), { cast: true }); can.scale.set(1, 1.15, 1); at(can, 0, 2.9, 0); pl.add(can);
  // bin
  g.add(at(M(cyl(0.24, 0.22, 0.8, 14), metal), 2.95, 0.4, 9.4));
  // café front on the building face (x = +2.1 local), facing the street (-x)
  const shop = new THREE.Group(); at(shop, 3.33, 0, 3.0); shop.rotation.y = -Math.PI / 2; g.add(shop);
  shop.add(at(M(box(9.5, 3.3, 0.12), std('#3b4048', { roughness: 0.5 })), 0, 1.65, 0));
  const win = new THREE.MeshStandardMaterial({ color: mixHex(P.water, P.ink, 0.45), roughness: 0.08, metalness: 0.2, envMap: env, envMapIntensity: 0.8 });
  for (const x of [-2.6, 2.4]) shop.add(at(M(box(3.6, 2.4, 0.06), win), x, 1.5, 0.07));
  shop.add(at(M(box(1.3, 2.5, 0.06), std(mixHex(P.roofs[3], P.ink, 0.25))), -0.1, 1.25, 0.07));
  shop.add(at(M(box(1.0, 0.4, 0.06), new THREE.MeshBasicMaterial({ color: '#ffe6bf' })), 2.4, 0.5, 0.11));
  // awning: striped
  const { g: ac, t: awTex } = canvasTex(256, 64);
  for (let i = 0; i < 16; i++) { ac.fillStyle = i % 2 ? P.paper : P.roofs[0]; ac.fillRect(i * 16, 0, 16, 64); }
  const aw = M(geo('st-awn', () => new THREE.PlaneGeometry(9.6, 1.7)), new THREE.MeshStandardMaterial({ map: awTex, roughness: 0.9, side: THREE.DoubleSide }), { cast: true });
  at(aw, 0, 3.35, 0.72); aw.rotation.x = -1.05; shop.add(aw);
  const bagSlot = new THREE.Object3D(); bagSlot.name = 'bagSlot'; bagSlot.rotation.y = -1.2; g.add(bagSlot);   // = LOC.street
  g.userData = { bagSlot, benchSeat, lamp };
  return g;
}

// =====================================================================================================
// Empty studio room at LOC.stage: floor with a faint 1 m grid, cyclorama back wall, low side walls, open front
// =====================================================================================================
export function makeEmptyRoom(ctx, { w = 14, d = 12, h = 5 } = {}) {
  const g = new THREE.Group(); g.name = 'emptyRoom'; g.position.copy(LOC.stage);
  const { g: fc, t: floorTex } = canvasTex(256, 256);
  fc.fillStyle = mixHex(P.block, P.paper, 0.35); fc.fillRect(0, 0, 256, 256);
  fc.fillStyle = 'rgba(120,105,85,.10)'; fc.fillRect(0, 0, 256, 3); fc.fillRect(0, 0, 3, 256);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(w, d);
  const floorM = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 });
  const wallM = std(P.paper, { roughness: 0.95 });
  const fl = M(geo(`rm-floor${w}|${d}`, () => { const p = new THREE.PlaneGeometry(w, d); p.rotateX(-Math.PI / 2); return p; }), floorM);
  fl.position.set(0, 0.002, 0); g.add(fl);
  g.add(at(M(box(w + 0.4, 0.05, d + 0.4), std(P.curb)), 0, -0.026, 0));
  // cyclorama: quarter-round cove into the back wall
  const R = 1.4;
  const cove = M(geo(`rm-cove${w}`, () => { const c = new THREE.CylinderGeometry(R, R, w, 24, 1, true, Math.PI, Math.PI / 2); c.rotateZ(Math.PI / 2); return c; }), new THREE.MeshStandardMaterial({ color: mixHex(P.block, P.paper, 0.35), roughness: 0.9, side: THREE.BackSide }));
  at(cove, 0, R, -d / 2 + R); g.add(cove);
  g.add(at(M(box(w, h - R, 0.2), wallM), 0, R + (h - R) / 2, -d / 2 - 0.1));
  for (const s of [-1, 1]) g.add(at(M(box(0.2, h, d), wallM), s * (w / 2 + 0.1), h / 2, 0));
  const center = new THREE.Object3D(); g.add(center);
  g.userData = { center, size: { w, d, h } };
  return g;
}
