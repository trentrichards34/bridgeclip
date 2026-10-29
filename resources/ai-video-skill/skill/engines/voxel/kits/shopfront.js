// shopfront.js: EXAMPLE TOPIC KIT (a street of small shops: coffee, delivery, marketing ideas). Built on base.js + people.js.
// Use it as-is for business / retail / marketing stories, and as the model for writing your own topic kit (kits are plain ES modules:
// copy the conventions, put yours in the project's scenes/ folder or a kits/ folder next to it).
//   import * as KT from '/engine/kits/shopfront.js';   const K = KT.K;
// Conventions = base.js: factories return { group, ...handles, set(...) }; call set() EVERY frame (missing keys = rest pose);
// everything faces +Z, floor y = 0, deterministic; `await L.libFonts()` before building anything with text.
//
// TOKENS   K: red redDark brick green greenDark forest navy kraft cream cup wall chalk steel gold asphalt sidewalk heart door
// ICONS    drawIcon(g, kind, cx, cy, sizePx, color, {bg, lw})   canvas icons: cup bean door clock phone calendar person heart check play bolt box star
//          bread cake burger pizza bag cart house car gift   (ICON_KINDS lists them all)
//          makeIconSticker(ctx, kind, {size, color, bg}) -> Mesh   round sticker decal (centre origin)
// CAST     makeFounder(ctx, 'red'|'green', opts)   the two shop owners (actors from people.js) + .side
//          makeBusyPro(ctx, opts)   hurried customer with a laptop bag (acc.bag); pro.set({ ...pro.hurry(t), turn: 30 }) = hurried walk
//          makeCrowdMember(ctx, 'student'|'pro'|'nerd'|'anyone', seed, opts)   typed crowd extra (acc.books / acc.kettle) + .type
// PLACES   makeShop(ctx, {preset:'red'|'green', name, color, icon, wall, glass, board:[...], w=9, aframeX})
//            .set({shutter 0..1 (1 = rolled DOWN), open 0..1 (door swings), sign 0..1 (CLOSED -> OPEN), t (pennant flutter)})
//            ~(w + 1) wide (cornice; 10 at the default w 9) x 8 tall, facade at z 0, interior to z -4.4, A-frame at z 2.6. w 6.2-12;
//            w 6.6 (7.6 wide) = two shops side by side in a portrait frame. anchors: door front sign window aframe awningLip
//          makeAFrame(ctx, {lines, frame, w, h})   chalkboard A-frame sign
//          makeStreet(ctx, {w=60, walk=7, road=10, lamps=4, clear}).set({rise})   sidewalk z -2..walk, curb, road beyond; lamps + trees pop in
//            at z walk-0.7 (IN FRONT of the shops, between them and your camera). clear: N moves every lamp/tree out of |x| < N (set it to
//            the x range your cameras and heroes use); omitted = only the one at |x| < 2.5 is dropped; 0 = keep all. .props[i].g to move them
//          makeSkyline(ctx, {w=60, z=-14, rows=2, colors}).set({rise})       window-grid blocks rise from the centre outward
//          makeFrontDoor(ctx, {wall, door, mat:'WELCOME', number:'42', w, h}).set({open})   house front; anchors.mat = top of the doormat
//          makeDeliveryBike(ctx, {color, icon}).set({roll})   side-on scooter (front to +X)
// PROPS    makeCup(ctx, {color, icon, steam, size}).set({steam, t})        paper cup with sleeve (~1.05 tall at size 1)
//          makeCoinJar(ctx, {label, coins, r, h}).set({fill})              glass jar of coins
//          makeSignpost(ctx, {left, right, leftColor, rightColor, road, h}).set({k})   fork signpost, arrows swing in
//          makeMegaphone(ctx, {color}).set({blast, t})                     points +Z, origin = grip, .mouth local point
//          makeBubble(ctx, {text, w, h, color, paper}).set({pop, deflate}) 3D paper speech bubble (centre origin)
//          makeBanner(ctx, text, {w, h, color, ink, ropes}).set({unroll})  cloth banner unrolling DOWN from its top rod
//          makeBigSign(ctx, text, {color, ink, w=7, h=3.4, legs=1.6, crossStyle:'line'|'x'}).set({lit, t, cross})
//            MARQUEE billboard with chasing bulbs; cross 0..1 paints a red strike-through. legs:0 = board bottom origin. THE hero sign.
//          makeSpotlight(ctx, {h, radius, color, lamp, tilt}).set({on, radius})   stage cone + floor pool
//          makeMagnifier(ctx, {r, color}).set({glint})
//          makeDeliveryBox(ctx, {label, icon, color, w, h, d}).set({open})
//          makeSubscriptionBox(ctx, {text, brand, color}).set({open})
//          makePhoneSite(ctx, {brand, title, icon, logo=icon, cta, sub, color, w, h}).set({tap, glow})   phone with a shop page (header logo + hero = icon); .buttonPoint
//          makePackaging(ctx, {brand, lines, icon, color})   makeContentCard(ctx, {title, color, tag}).set({play})
//          makeMeter(ctx, text, {r, left, right, stand}).set({value})     semicircle gauge
//          makeScale(ctx, {left, right, leftColor, rightColor, h, arm}).set({tip -1..1})   balance; put things in .panL / .panR
//          makeTarget(ctx, {r, h, colors}).set({hit}) (.center)   makeDart(ctx, {color, size}) (points -Z, origin = tip)
//          makeLabelCard(ctx, text, {color, sub, icon, w=3, h=1.3, pin, ink}).set({pop})   paper label with a colour band: name things!
//          makeHeadphones(ctx, {color, cushion}).set({on})   makeHeart(ctx, {size, color}).set({pop, beat})
//          makeLetterBlocks(ctx, word, {size, gap, icons, seed, woods, inks}).set({k})   wooden letter blocks fly in and land one by one
import * as THREE from 'three';
import * as L from './base.js';
import { namedPerson, extraPerson } from './people.js';

const C = L.C;
export const K = {
  red: '#c8423a', redDark: '#93302a', brick: '#a8432f',            // the 'red' shop preset
  green: '#2f8a55', greenDark: '#1f5e3a', forest: '#2f6b45',       // the 'green' shop preset
  navy: '#27335e', kraft: '#c98f4f', cream: '#f3ead8', cup: '#f6f1e7', wall: '#ecdcc0', chalk: '#26352e',
  steel: '#8f959e', gold: '#e0b24a', asphalt: '#3c3a44', sidewalk: '#bdb3a4', heart: '#e84a5f', door: '#2d6a7a',
};
// shop presets (name = the sign text; rename freely: makeShop(ctx, { preset: 'green', name: 'ANY NAME' }))
export const SHOPS = {
  red: { name: 'CORNER CAFE', color: K.red, icon: 'cup', glass: 'COFFEE', board: ['COFFEE', 'FOR', 'EVERYONE!'], accent: K.green },
  green: { name: 'NEXT DOOR', color: K.green, icon: 'door', glass: 'WE DELIVER', board: ['FRESH', 'TO YOUR', 'DOOR'], accent: K.red },
};

// ---------- tiny helpers ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const pop = (k, s = 2.2) => (k <= 0 ? 0.001 : k >= 1 ? 1 : Math.max(0.001, backOut(k, s)));
const fract = (x) => x - Math.floor(x);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GEO = new Map();
const geo = (key, make) => { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; };
const cyl = (rt, rb, h, s = 24, open = false) => geo(`cc${rt},${rb},${h},${s},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open));
const sph = (r, ws = 18, hs = 12) => geo(`cs${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const plane = (w, h) => geo(`cp${w},${h}`, () => new THREE.PlaneGeometry(w, h));
const torus = (r, t, a = Math.PI * 2, s = 28) => geo(`ct${r},${t},${a},${s}`, () => new THREE.TorusGeometry(r, t, 8, s, a));
function mesh(g, m, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true, recv = true, parent = null } = {}) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = cast; o.receiveShadow = recv;
  if (parent) parent.add(o); return o;
}
function ctex(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t, W: c.width, H: c.height };
}
function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const txt = (g, s, x, y, o = {}) => L.inkText(g, s, x, y, { wear: 0.12, ...o });
function normUV(g, w, h) { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5); return g; }
function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2; r = Math.min(r, x, y);
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
const rrPlane = (w, h, r) => geo(`crrp${w},${h},${r}`, () => normUV(new THREE.ShapeGeometry(rrShape(w, h, r), 10), w, h));
const rrSlab = (w, h, r, d) => geo(`crrs${w},${h},${r},${d}`, () => { const e = new THREE.ExtrudeGeometry(rrShape(w, h, r), { depth: d, bevelEnabled: true, bevelSize: Math.min(0.05, r * 0.4), bevelThickness: 0.04, bevelSegments: 2, curveSegments: 12 }); e.translate(0, 0, -d / 2); return e; });
// a thin slab (w x h, facing +Z) with a canvas on the front. draw(fn(g, W, H)) repaints it.
function slab(w, h, { paper = C.paper, thick = 0.05, ppu = 220, cap = 1400, felt = 0.35, side = null } = {}) {
  const s = Math.min(ppu, cap / Math.max(w, h)), T = ctex(w * s, h * s);
  const sm = L.mat(side ?? paper, { felt: 0.5 }), fm = L.mat('#ffffff', { map: T.t, felt }), bm = L.mat(L.mixHex(side ?? paper, '#7a6a50', 0.15), { felt: 0.6 });
  const m = new THREE.Mesh(L.rbox(w, h, thick, 0), [sm, sm, sm, sm, fm, bm]); m.castShadow = true; m.receiveShadow = true;
  return { mesh: m, T, fm, draw(fn) { fn(T.g, T.W, T.H); T.t.needsUpdate = true; } };
}
// a transparent decal plane with a canvas (icons, logos, text on glass)
function decal(w, h, fn, { ppu = 220, felt = 0, basic = false, op = 1 } = {}) {
  const T = ctex(w * ppu, h * ppu); fn(T.g, T.W, T.H); T.t.needsUpdate = true;
  const m = basic ? new THREE.MeshBasicMaterial({ map: T.t, transparent: true, depthWrite: false, opacity: op })
    : L.mat('#ffffff', { map: T.t, transparent: true, felt, depthWrite: false, opacity: op });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  const p = new THREE.Mesh(plane(w, h), m); p.renderOrder = 2; p.receiveShadow = true; return p;
}
// stick a cylinder between two points
const _Y = V(0, 1, 0);
function rod(a, b, r, m, parent) { a = L.toV3(a); b = L.toV3(b); const d = b.clone().sub(a), o = mesh(cyl(r, r, 1, 8), m, { parent }); o.scale.y = d.length(); o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(_Y, d.normalize()); return o; }
function splitTwo(text) {
  if (text.includes('\n')) return text.split('\n');
  if (text.length <= 10 || !text.includes(' ')) return [text];
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return [text.slice(0, best), text.slice(best + 1)];
}
// several lines centred in a box (y0..y0+h), each auto-fitted to maxW
function lines(g, arr, cx, y0, h, maxW, o = {}) {
  const n = arr.length, sz = Math.min(h / (n * 1.12), o.size ?? 1e9);
  arr.forEach((s, i) => { const l = typeof s === 'string' ? { text: s } : s; txt(g, l.text, cx, y0 + h / 2 + (i - (n - 1) / 2) * sz * 1.12, { size: sz * (l.k ?? 1), maxW, color: l.color ?? o.color ?? C.ink, seed: (o.seed ?? 1) + i, wear: o.wear ?? 0.12, font: l.font ?? o.font }); });
}

// =====================================================================================================
// ICONS (canvas): drawIcon(g, kind, cx, cy, s, color, { bg }) — kinds: cup, bean, door, clock, phone, calendar, person,
// heart, check, play, bolt, box, star, bread, cake, burger, pizza, bag, cart, house, car, gift. s = icon size in px (fits a s x s box).
// The newer kinds (bread..gift) knock their details out as transparent holes, so they read on any background. Unknown kind = nothing.
// =====================================================================================================
export function drawIcon(g, kind, cx, cy, s, color = C.ink, { bg = null, lw = s * 0.09 } = {}) {
  g.save(); g.translate(cx, cy); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = lw;
  const h = s / 2;
  if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(0, 0, h * 1.12, 0, 7); g.fill(); g.fillStyle = color; }
  if (kind === 'cup') {
    g.beginPath(); g.moveTo(-h * 0.5, -h * 0.35); g.lineTo(h * 0.5, -h * 0.35); g.lineTo(h * 0.38, h * 0.8); g.lineTo(-h * 0.38, h * 0.8); g.closePath(); g.fill();
    rr(g, -h * 0.6, -h * 0.55, h * 1.2, h * 0.24, h * 0.08); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.fillRect(-h * 0.5, h * 0.05, h, h * 0.28); g.globalCompositeOperation = 'source-over';
    g.fillRect(-h * 0.42, h * 0.1, h * 0.84, h * 0.18);
    g.lineWidth = lw * 0.8; for (const x of [-0.22, 0.12]) { g.beginPath(); g.moveTo(x * h, -h * 0.7); g.bezierCurveTo((x - 0.18) * h, -h * 0.85, (x + 0.18) * h, -h * 0.95, x * h, -h * 1.05); g.stroke(); }
  } else if (kind === 'bean') {
    g.save(); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, h * 0.55, h * 0.82, 0, 0, 7); g.fill();
    g.strokeStyle = bg ?? '#f3ead8'; g.lineWidth = lw; g.beginPath(); g.moveTo(0, -h * 0.66); g.bezierCurveTo(-h * 0.3, -h * 0.2, h * 0.3, h * 0.2, 0, h * 0.66); g.stroke(); g.restore();
  } else if (kind === 'door') {
    g.lineWidth = lw * 1.1; rr(g, -h * 0.5, -h * 0.85, h, h * 1.62, h * 0.12); g.stroke();
    rr(g, -h * 0.3, -h * 0.65, h * 0.6, h * 0.5, h * 0.06); g.fill();
    g.beginPath(); g.arc(h * 0.28, h * 0.12, lw * 0.75, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-h * 0.85, h * 0.82); g.lineTo(h * 0.85, h * 0.82); g.stroke();
  } else if (kind === 'clock') {
    g.lineWidth = lw * 1.1; g.beginPath(); g.arc(0, 0, h * 0.85, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -h * 0.55); g.moveTo(0, 0); g.lineTo(h * 0.4, h * 0.18); g.stroke();
    g.beginPath(); g.arc(0, 0, lw * 0.7, 0, 7); g.fill();
  } else if (kind === 'phone') {
    g.lineWidth = lw * 1.1; rr(g, -h * 0.48, -h * 0.9, h * 0.96, h * 1.8, h * 0.16); g.stroke();
    g.beginPath(); g.arc(0, h * 0.62, lw * 0.7, 0, 7); g.fill(); g.fillRect(-h * 0.15, -h * 0.72, h * 0.3, lw * 0.6);
  } else if (kind === 'calendar') {
    g.lineWidth = lw; rr(g, -h * 0.8, -h * 0.65, h * 1.6, h * 1.45, h * 0.12); g.stroke();
    g.fillRect(-h * 0.8, -h * 0.65, h * 1.6, h * 0.42);
    for (const x of [-0.4, 0.4]) { g.beginPath(); g.moveTo(x * h, -h * 0.85); g.lineTo(x * h, -h * 0.5); g.stroke(); }
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) g.fillRect((-0.55 + c * 0.42) * h, (0.0 + r * 0.38) * h, h * 0.24, h * 0.22);
  } else if (kind === 'person') {
    g.beginPath(); g.arc(0, -h * 0.4, h * 0.36, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-h * 0.7, h * 0.85); g.quadraticCurveTo(-h * 0.7, h * 0.05, 0, h * 0.05); g.quadraticCurveTo(h * 0.7, h * 0.05, h * 0.7, h * 0.85); g.closePath(); g.fill();
  } else if (kind === 'heart') {
    g.beginPath(); g.moveTo(0, h * 0.8); g.bezierCurveTo(-h * 1.1, 0, -h * 0.6, -h * 0.95, 0, -h * 0.4); g.bezierCurveTo(h * 0.6, -h * 0.95, h * 1.1, 0, 0, h * 0.8); g.fill();
  } else if (kind === 'check') {
    g.lineWidth = lw * 1.6; g.beginPath(); g.moveTo(-h * 0.6, 0); g.lineTo(-h * 0.15, h * 0.5); g.lineTo(h * 0.65, -h * 0.5); g.stroke();
  } else if (kind === 'play') {
    g.beginPath(); g.moveTo(-h * 0.35, -h * 0.55); g.lineTo(h * 0.6, 0); g.lineTo(-h * 0.35, h * 0.55); g.closePath(); g.fill();
  } else if (kind === 'bolt') {
    g.beginPath(); g.moveTo(h * 0.15, -h * 0.9); g.lineTo(-h * 0.5, h * 0.1); g.lineTo(-h * 0.02, h * 0.1); g.lineTo(-h * 0.15, h * 0.9); g.lineTo(h * 0.5, -h * 0.12); g.lineTo(h * 0.02, -h * 0.12); g.closePath(); g.fill();
  } else if (kind === 'box') {
    g.lineWidth = lw; g.beginPath(); g.moveTo(0, -h * 0.8); g.lineTo(h * 0.8, -h * 0.4); g.lineTo(h * 0.8, h * 0.5); g.lineTo(0, h * 0.9); g.lineTo(-h * 0.8, h * 0.5); g.lineTo(-h * 0.8, -h * 0.4); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-h * 0.8, -h * 0.4); g.lineTo(0, 0); g.lineTo(h * 0.8, -h * 0.4); g.moveTo(0, 0); g.lineTo(0, h * 0.9); g.stroke();
  } else if (kind === 'star') {
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? h * 0.42 : h * 0.9; (i ? g.lineTo : g.moveTo).call(g, Math.cos(a) * q, Math.sin(a) * q); } g.closePath(); g.fill();
  } else if (ICON2[kind]) {
    // drawn on a scratch canvas so the cut-outs (scores, windows, seeds) are real holes, then stamped on g
    const N = Math.ceil(s * 2.4), off = document.createElement('canvas'); off.width = off.height = N;
    const q = off.getContext('2d'); q.translate(N / 2, N / 2); q.lineCap = 'round'; q.lineJoin = 'round'; q.strokeStyle = color; q.fillStyle = color; q.lineWidth = lw;
    const cut = (fn) => { q.save(); q.globalCompositeOperation = 'destination-out'; q.fillStyle = q.strokeStyle = '#000'; fn(); q.restore(); };
    ICON2[kind](q, h, lw, cut); g.drawImage(off, -N / 2, -N / 2);
  }
  g.restore();
}
// generic everyday icons (food, shopping, home, transport). (q, h = half size, lw, cut(fn) = knock out) all filled silhouettes
const ICON2 = {
  bread(q, h, lw, cut) {          // loaf, side view, three scores
    q.beginPath(); q.moveTo(-h * 0.88, h * 0.62); q.lineTo(-h * 0.88, h * 0.05); q.bezierCurveTo(-h * 0.88, -h * 0.75, h * 0.88, -h * 0.75, h * 0.88, h * 0.05); q.lineTo(h * 0.88, h * 0.62); q.closePath(); q.fill();
    cut(() => { q.lineWidth = lw * 0.9; for (const x of [-0.42, 0, 0.42]) { q.beginPath(); q.moveTo((x - 0.13) * h, -h * 0.02); q.lineTo((x + 0.13) * h, -h * 0.36); q.stroke(); } });
  },
  cake(q, h, lw, cut) {           // two-tier cake with a candle
    rr(q, -h * 0.85, h * 0.12, h * 1.7, h * 0.7, h * 0.1); q.fill(); rr(q, -h * 0.58, -h * 0.32, h * 1.16, h * 0.5, h * 0.08); q.fill();
    q.fillRect(-h * 0.07, -h * 0.66, h * 0.14, h * 0.36); q.beginPath(); q.ellipse(0, -h * 0.82, h * 0.1, h * 0.15, 0, 0, 7); q.fill();
    cut(() => { q.lineWidth = lw * 0.8; q.beginPath(); q.moveTo(-h * 0.85, h * 0.36); for (let i = 0; i < 6; i++) q.quadraticCurveTo((-0.85 + (i + 0.5) * 0.283) * h, h * 0.52, (-0.85 + (i + 1) * 0.283) * h, h * 0.36); q.stroke(); });
  },
  burger(q, h, lw, cut) {         // bun, patty, bun + sesame seeds
    q.beginPath(); q.moveTo(-h * 0.88, -h * 0.12); q.bezierCurveTo(-h * 0.88, -h * 0.95, h * 0.88, -h * 0.95, h * 0.88, -h * 0.12); q.closePath(); q.fill();
    rr(q, -h * 0.95, -h * 0.02, h * 1.9, h * 0.3, h * 0.15); q.fill(); rr(q, -h * 0.85, h * 0.38, h * 1.7, h * 0.4, h * 0.16); q.fill();
    cut(() => { for (const [x, y] of [[-0.4, -0.42], [0, -0.58], [0.4, -0.42], [-0.15, -0.3], [0.2, -0.28]]) { q.beginPath(); q.ellipse(x * h, y * h, h * 0.07, h * 0.04, 0.3, 0, 7); q.fill(); } });
  },
  pizza(q, h, lw, cut) {          // slice, crust up
    q.beginPath(); q.moveTo(-h * 0.82, -h * 0.5); q.quadraticCurveTo(0, -h * 0.95, h * 0.82, -h * 0.5); q.lineTo(0, h * 0.9); q.closePath(); q.fill();
    cut(() => { q.lineWidth = lw * 0.7; q.beginPath(); q.moveTo(-h * 0.66, -h * 0.4); q.quadraticCurveTo(0, -h * 0.74, h * 0.66, -h * 0.4); q.stroke();
      for (const [x, y, r] of [[-0.28, -0.18, 0.13], [0.24, -0.12, 0.12], [0, 0.3, 0.11]]) { q.beginPath(); q.arc(x * h, y * h, r * h, 0, 7); q.fill(); } });
  },
  bag(q, h, lw, cut) {            // shopping bag with handle
    q.beginPath(); q.moveTo(-h * 0.62, -h * 0.32); q.lineTo(h * 0.62, -h * 0.32); q.lineTo(h * 0.74, h * 0.88); q.lineTo(-h * 0.74, h * 0.88); q.closePath(); q.fill();
    q.lineWidth = lw * 1.1; q.beginPath(); q.arc(0, -h * 0.32, h * 0.32, Math.PI, 0); q.stroke();
    cut(() => { for (const x of [-0.32, 0.32]) { q.beginPath(); q.arc(x * h, -h * 0.12, h * 0.07, 0, 7); q.fill(); } });
  },
  cart(q, h, lw, cut) {           // shopping cart
    q.lineWidth = lw * 1.1; q.beginPath(); q.moveTo(-h * 0.95, -h * 0.72); q.lineTo(-h * 0.7, -h * 0.72); q.lineTo(-h * 0.45, h * 0.4); q.lineTo(h * 0.62, h * 0.4); q.stroke();
    q.beginPath(); q.moveTo(-h * 0.62, -h * 0.45); q.lineTo(h * 0.88, -h * 0.45); q.lineTo(h * 0.66, h * 0.2); q.lineTo(-h * 0.48, h * 0.2); q.closePath(); q.fill();
    for (const x of [-0.32, 0.5]) { q.beginPath(); q.arc(x * h, h * 0.68, h * 0.15, 0, 7); q.fill(); }
  },
  house(q, h, lw, cut) {          // house with chimney + door
    q.fillRect(h * 0.38, -h * 0.78, h * 0.2, h * 0.5);
    q.beginPath(); q.moveTo(0, -h * 0.92); q.lineTo(h * 0.95, -h * 0.05); q.lineTo(h * 0.66, -h * 0.05); q.lineTo(h * 0.66, h * 0.85); q.lineTo(-h * 0.66, h * 0.85); q.lineTo(-h * 0.66, -h * 0.05); q.lineTo(-h * 0.95, -h * 0.05); q.closePath(); q.fill();
    cut(() => { rr(q, -h * 0.2, h * 0.28, h * 0.4, h * 0.57, h * 0.08); q.fill(); });
  },
  car(q, h, lw, cut) {            // side view, front to the right
    rr(q, -h * 0.95, -h * 0.08, h * 1.9, h * 0.52, h * 0.16); q.fill();
    q.beginPath(); q.moveTo(-h * 0.6, -h * 0.02); q.lineTo(-h * 0.36, -h * 0.52); q.lineTo(h * 0.3, -h * 0.52); q.lineTo(h * 0.62, -h * 0.02); q.closePath(); q.fill();
    cut(() => { q.beginPath(); q.moveTo(-h * 0.44, -h * 0.1); q.lineTo(-h * 0.3, -h * 0.4); q.lineTo(-h * 0.04, -h * 0.4); q.lineTo(-h * 0.04, -h * 0.1); q.closePath(); q.fill();
      q.beginPath(); q.moveTo(h * 0.06, -h * 0.1); q.lineTo(h * 0.06, -h * 0.4); q.lineTo(h * 0.26, -h * 0.4); q.lineTo(h * 0.44, -h * 0.1); q.closePath(); q.fill();
      for (const x of [-0.5, 0.5]) { q.beginPath(); q.arc(x * h, h * 0.44, h * 0.3, 0, 7); q.fill(); } });
    for (const x of [-0.5, 0.5]) { q.beginPath(); q.arc(x * h, h * 0.44, h * 0.22, 0, 7); q.fill(); }
    cut(() => { for (const x of [-0.5, 0.5]) { q.beginPath(); q.arc(x * h, h * 0.44, h * 0.08, 0, 7); q.fill(); } });
  },
  gift(q, h, lw, cut) {           // wrapped box with a bow
    rr(q, -h * 0.72, -h * 0.18, h * 1.44, h * 1.02, h * 0.08); q.fill(); rr(q, -h * 0.85, -h * 0.44, h * 1.7, h * 0.32, h * 0.08); q.fill();
    q.lineWidth = lw; for (const sx of [-1, 1]) { q.beginPath(); q.ellipse(sx * h * 0.24, -h * 0.62, h * 0.22, h * 0.13, sx * -0.4, 0, 7); q.stroke(); }
    cut(() => { q.fillRect(-h * 0.08, -h * 0.44, h * 0.16, h * 1.28); q.fillRect(-h * 0.85, -h * 0.12, h * 1.7, h * 0.06); });
  },
};
export const ICON_KINDS = ['cup', 'bean', 'door', 'clock', 'phone', 'calendar', 'person', 'heart', 'check', 'play', 'bolt', 'box', 'star', 'bread', 'cake', 'burger', 'pizza', 'bag', 'cart', 'house', 'car', 'gift'];
// round icon sticker (decal plane, centre origin, facing +Z)
export function makeIconSticker(ctx, kind, { size = 0.5, color = K.cream, bg = K.green } = {}) {
  return decal(size, size, (g, W, H) => { g.fillStyle = bg; g.beginPath(); g.arc(W / 2, H / 2, W * 0.48, 0, 7); g.fill(); g.strokeStyle = color; g.lineWidth = W * 0.035; g.beginPath(); g.arc(W / 2, H / 2, W * 0.41, 0, 7); g.stroke(); drawIcon(g, kind, W / 2, H / 2, W * 0.46, color); }, { ppu: 400 });
}

// =====================================================================================================
// CAST
// =====================================================================================================
// makeFounder(ctx, 'red' | 'green'): the two shop owners. RED = marco (red apron + cap, beard, grin); GREEN = alex (green apron, smile).
// Returns a people.js actor (set / holdR / holdL / focus ...) + .side
export function makeFounder(ctx, side = 'red', o = {}) {
  const red = side === 'red';
  const c = namedPerson(ctx, red ? 'marco' : 'alex', { mouth: red ? 'teeth' : 'smile', ...o });
  c.side = side;
  return c;
}
// the hurried customer: yellow raincoat + red scarf (preset 'sam') with a laptop bag in the right hand.
// pro.hurry(t, k = 1) -> pose object for a hurried walk (merge: pro.set({ ...pro.hurry(t), turn: 30 }))
export function makeBusyPro(ctx, o = {}) {
  const c = namedPerson(ctx, 'sam', { mouth: 'flat', ...o });
  const bag = new THREE.Group(), bm = L.mat('#3b2a22', { rough: 0.7 }), bd = L.mat('#2a1d17');
  L.B(1.1, 0.78, 0.3, bm, { r: 0.07, y: -0.55, parent: bag });
  L.B(1.12, 0.36, 0.32, bd, { r: 0.06, y: -0.33, z: 0.01, parent: bag });
  L.B(0.16, 0.12, 0.05, L.mat(K.gold, { metal: 0.5, rough: 0.4, felt: 0.2 }), { r: 0.02, y: -0.47, z: 0.17, parent: bag });
  mesh(torus(0.22, 0.04, Math.PI, 12), bd, { y: -0.14, parent: bag });
  bag.rotation.y = Math.PI / 2; c.holdR(bag, [0.05, 0.05, 0]); c.acc.bag = bag;
  c.hurry = (t, k = 1) => ({ walk: t * 2.2, lean: 9 * k, hop: Math.abs(Math.sin(t * Math.PI * 2.2)) * 0.1 * k, armL: 18, reachL: Math.sin(t * Math.PI * 2.2) * 35 * k, armR: 8, brow: -10 * k, lookY: -0.1 });
  return c;
}
// crowd types: 'student' (cap + books), 'pro' (charcoal suit + blue tie), 'nerd' (glasses + pour-over kettle),
// 'anyone' (plain; seed varies the mouth). seed also varies colours; some seeds use named presets.
export function makeCrowdMember(ctx, type = 'anyone', seed = 1, o = {}) {
  const R = L.rng(seed * 31 + 7), pick = (a) => a[Math.floor(R() * a.length) % a.length];
  let c;
  if (type === 'student') {
    c = seed === 3 ? namedPerson(ctx, 'kai', { mouth: 'smile' }) : extraPerson(ctx, seed, { accessories: ['cap'], capColor: pick([C.blue, '#7a3fb0', C.yes]), mouth: 'smile' });
    const books = new THREE.Group();
    [['#c8423a', 0.0], ['#3a5bd0', 0.13], ['#3fae5a', 0.26]].forEach(([col, y], i) => { L.B(0.75 - i * 0.05, 0.13, 0.55, L.mat(col), { r: 0.02, y, rz: (i - 1) * 0.06, parent: books }); L.B(0.7 - i * 0.05, 0.1, 0.5, L.mat('#f4ecd8', { felt: 0.3 }), { r: 0.01, x: 0.03, y, z: 0.03, parent: books }); });
    c.holdL(books, [-0.1, -0.1, 0.35]); c.acc.books = books;
  } else if (type === 'pro') {
    c = seed === 4 || seed === 7 ? namedPerson(ctx, seed === 4 ? 'jordan' : 'diane', { mouth: 'flat' }) : extraPerson(ctx, seed, { outfit: { top: 'suit', color: '#4a4d57', pants: '#4a4d57', shoes: '#2a1e1a', neck: 'tie', neckColor: C.blue }, mouth: 'flat' });
  } else if (type === 'nerd') {
    c = seed === 4 || seed === 5 ? namedPerson(ctx, 'mei', { mouth: 'o' }) : extraPerson(ctx, seed, { accessories: ['glasses'], mouth: 'o' });
    const k = new THREE.Group(), km = L.mat('#cfd3d8', { rough: 0.4, metal: 0.55, felt: 0.3 });
    mesh(cyl(0.26, 0.34, 0.5, 22), km, { y: 0.25, parent: k });
    mesh(cyl(0.12, 0.2, 0.12, 18), km, { y: 0.56, parent: k });
    mesh(sph(0.05), L.mat('#1d1b20'), { y: 0.65, parent: k });
    const curve = new THREE.CubicBezierCurve3(V(0.28, 0.1, 0), V(0.65, 0.2, 0), V(0.45, 0.75, 0), V(0.75, 0.7, 0));
    mesh(geo('kettleNeck', () => new THREE.TubeGeometry(curve, 16, 0.035, 6)), km, { parent: k });
    mesh(torus(0.17, 0.035, Math.PI, 10), L.mat('#1d1b20'), { x: -0.32, y: 0.3, rz: Math.PI / 2, parent: k });
    k.rotation.y = -Math.PI / 2; c.holdR(k, [0.05, -0.2, 0.15]); c.acc.kettle = k;
  } else {
    c = seed === 6 ? namedPerson(ctx, 'jade', { mouth: 'smile' }) : extraPerson(ctx, seed, { mouth: pick(['none', 'smile', 'flat', 'o', 'smile']) });
  }
  c.type = type;
  return c;
}

// =====================================================================================================
// SHOP: chunky storefront. makeShop(ctx, { preset: 'red' | 'green', name, color, icon, wall, glass, board, w = 9, aframeX })
// set({ shutter 0..1 (1 = rolled down/closed), open 0..1 (door swings in), sign 0..1 (door sign CLOSED -> OPEN), t (pennant flutter), lights 0..1 })
// =====================================================================================================
function drawInterior(g, W, H, color) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#ffe3b0'); gr.addColorStop(1, '#e9a35a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(120,60,20,0.18)'; for (let x = 0; x < W; x += W / 22) g.fillRect(x, 0, 3, H * 0.62);
  for (let s = 0; s < 2; s++) { const y = H * (0.22 + s * 0.17); g.fillStyle = '#7a4a2e'; g.fillRect(W * 0.04, y, W * 0.92, H * 0.025);
    for (let i = 0; i < 14; i++) { const x = W * (0.07 + i * 0.065); g.fillStyle = i % 3 === 0 ? color : i % 3 === 1 ? '#f6f1e7' : '#c98f4f'; rr(g, x, y - H * 0.08, W * 0.035, H * 0.08, 6); g.fill(); } }
  g.fillStyle = '#6b3f22'; g.fillRect(0, H * 0.66, W, H * 0.34); g.fillStyle = '#8a5434'; g.fillRect(0, H * 0.66, W, H * 0.05);
  g.fillStyle = '#9aa1a8'; rr(g, W * 0.62, H * 0.47, W * 0.16, H * 0.2, 10); g.fill(); g.fillStyle = '#2a2a30'; g.fillRect(W * 0.65, H * 0.52, W * 0.1, H * 0.04);
  for (const x of [0.2, 0.5, 0.8]) { g.strokeStyle = '#3a2a20'; g.lineWidth = 3; g.beginPath(); g.moveTo(W * x, 0); g.lineTo(W * x, H * 0.08); g.stroke(); const r = g.createRadialGradient(W * x, H * 0.1, 0, W * x, H * 0.1, H * 0.16); r.addColorStop(0, 'rgba(255,250,220,0.95)'); r.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = r; g.fillRect(W * x - H * 0.2, 0, H * 0.4, H * 0.3); }
}
export function makeShop(ctx, o = {}) {
  const P = SHOPS[o.preset ?? 'red'] ?? SHOPS.red, name = o.name ?? P.name;
  const color = o.color ?? P.color, icon = o.icon ?? P.icon, wallC = o.wall ?? K.wall, w = o.w ?? 9, hw = w / 2;
  const group = new THREE.Group();
  const wm = L.mat(wallC, { scale: 0.8 }), am = L.mat(color, { scale: 1.2 }), dk = L.mat(L.mixHex(color, '#000', 0.35)), cm = L.mat(K.cream);
  const OT = 3.9, H = 7.6, dr = [hw - 3.4, hw - 1.4], win = [-hw + 0.9, Math.min(-0.8, dr[0] - 0.7)];   // opening top, facade height, door + window x ranges (same as before at w 9; w >= 6.2)
  const fz = -0.3;
  // facade pieces around the window + door openings
  const piece = (x0, x1, y0, y1) => L.B(x1 - x0, y1 - y0, 0.6, wm, { r: 0.02, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: fz, parent: group });
  piece(-hw, hw, OT, H); piece(-hw, win[0], 0, OT); piece(win[1], dr[0], 0, OT); piece(dr[1], hw, 0, OT); piece(win[0], win[1], 0, 1.0);
  L.B(win[1] - win[0], 0.85, 0.1, am, { r: 0.03, x: (win[0] + win[1]) / 2, y: 0.5, z: 0.04, parent: group });   // kick plate
  // building shell + interior
  for (const s of [-1, 1]) L.B(0.4, H, 4.0, wm, { r: 0.02, x: s * (hw - 0.2), y: H / 2, z: -2.6, parent: group });
  L.B(w, H, 0.4, wm, { r: 0.02, y: H / 2, z: -4.4, parent: group });
  L.B(w + 0.4, 0.4, 4.6, dk, { r: 0.04, y: H + 0.2, z: -2.2, parent: group });
  const im = L.mat('#7a4a2e'); L.B(w - 0.8, 0.1, 2.4, im, { r: 0, y: 0.05, z: -1.8, parent: group }); L.B(w - 0.8, 0.1, 2.4, im, { r: 0, y: OT, z: -1.8, parent: group });
  { const T = ctex(1400, 1400 * OT / (w - 0.8)); drawInterior(T.g, T.W, T.H, color); T.t.needsUpdate = true;
    mesh(plane(w - 0.8, OT), new THREE.MeshBasicMaterial({ map: T.t, color: new THREE.Color(0.8, 0.8, 0.8), toneMapped: false }), { y: OT / 2, z: -2.9, cast: false, parent: group }); }
  // pilasters + cornice
  for (const s of [-1, 1]) L.B(0.7, H + 0.2, 0.9, am, { r: 0.06, x: s * hw, y: (H + 0.2) / 2, z: -0.15, parent: group });
  L.B(w + 1.0, 0.5, 1.1, am, { r: 0.08, y: H + 0.15, z: -0.15, parent: group });
  L.B(w + 0.6, 0.16, 0.9, cm, { r: 0.04, y: H - 0.18, z: -0.15, parent: group });
  // window: frame, glass + text decal, sill with tiny plants
  const wx = (win[0] + win[1]) / 2, ww = win[1] - win[0], wh = OT - 1.0, wy = 1.0 + wh / 2;
  for (const [x, y, bw, bh] of [[wx, OT - 0.08, ww + 0.2, 0.18], [wx, 1.05, ww + 0.2, 0.18], [win[0], wy, 0.18, wh + 0.2], [win[1], wy, 0.18, wh + 0.2], [wx, wy, 0.1, wh]]) L.B(bw, bh, 0.22, dk, { r: 0.03, x, y, z: 0.0, parent: group });
  const glassM = new THREE.MeshStandardMaterial({ color: '#cfe4ff', transparent: true, opacity: 0.12, roughness: 0.08, depthWrite: false });
  mesh(plane(ww, wh), glassM, { x: wx, y: wy, z: -0.02, cast: false, parent: group });
  const gtext = o.glass ?? P.glass;
  const gd = decal(ww - 0.3, 1.0, (g, W, H2) => { txt(g, gtext, W / 2 + 5, H2 * 0.52 + 6, { size: H2 * 0.62, maxW: W * 0.9, color: '#4a2410', wear: 0.25 }); txt(g, gtext, W / 2, H2 * 0.52, { size: H2 * 0.62, maxW: W * 0.9, color: '#ffd76a', wear: 0.25 }); }, { ppu: 300 }); gd.position.set(wx, OT - 0.75, 0.0); group.add(gd);
  L.B(ww + 0.4, 0.16, 0.6, cm, { r: 0.04, x: wx, y: 1.0, z: 0.22, parent: group });
  for (let i = 0; i < 3; i++) { const x = wx - ww / 2 + 0.5 + i * (ww - 1) / 2; mesh(cyl(0.16, 0.12, 0.26, 12), L.mat(C.terracotta), { x, y: 1.21, z: 0.25, parent: group }); mesh(sph(0.2, 12, 8), L.mat(C.leaf, { scale: 2 }), { x, y: 1.45, z: 0.25, parent: group }); }
  // door (pivot on its left edge) + glass + knob + OPEN/CLOSED sign
  const dw = dr[1] - dr[0];
  for (const [x, y, bw, bh] of [[(dr[0] + dr[1]) / 2, OT - 0.05, dw + 0.25, 0.2], [dr[0], OT / 2, 0.16, OT], [dr[1], OT / 2, 0.16, OT]]) L.B(bw, bh, 0.24, dk, { r: 0.03, x, y, z: 0.0, parent: group });
  const door = new THREE.Group(); door.position.set(dr[0] + 0.06, 0, -0.12); group.add(door);
  L.B(dw - 0.1, OT - 0.12, 0.14, am, { r: 0.04, x: (dw - 0.1) / 2, y: (OT - 0.12) / 2, parent: door });
  mesh(plane(dw - 0.7, 1.5), new THREE.MeshBasicMaterial({ color: new THREE.Color('#f3c27e').multiplyScalar(0.7), toneMapped: false }), { x: (dw - 0.1) / 2, y: 2.75, z: 0.075, cast: false, parent: door });
  L.B(dw - 0.5, 0.9, 0.04, dk, { r: 0.03, x: (dw - 0.1) / 2, y: 0.9, z: 0.08, parent: door });
  mesh(sph(0.1, 12, 8), L.mat(K.gold, { metal: 0.5, rough: 0.35, felt: 0.2 }), { x: dw - 0.38, y: 1.8, z: 0.14, parent: door });
  const dsign = new THREE.Group(); dsign.position.set((dw - 0.1) / 2, 2.6, 0.12); door.add(dsign);
  const sgn = (t, col) => (g, W, H2) => { L.paperFill(g, W, H2, K.cream, t.length, 0.5); g.strokeStyle = col; g.lineWidth = H2 * 0.08; rr(g, H2 * 0.08, H2 * 0.08, W - H2 * 0.16, H2 * 0.84, H2 * 0.12); g.stroke(); txt(g, t, W / 2, H2 * 0.54, { size: H2 * 0.55, maxW: W * 0.82, color: col }); };
  const sOpen = decal(1.1, 0.48, sgn('OPEN', C.yes), { ppu: 300, felt: 0.3 }), sClosed = decal(1.1, 0.48, sgn('CLOSED', C.no), { ppu: 300, felt: 0.3 });
  sClosed.rotation.y = Math.PI; dsign.add(sOpen, sClosed);
  for (const s of [-1, 1]) rod([s * 0.35, 0.22, 0], [s * 0.1, 0.55, 0], 0.012, L.mat('#2a2a30'), dsign);
  // shutter (rolls up into the box under the awning)
  const shW = w - 1.0, NS = 14, shH = OT + 0.1, sh = shH / NS;
  const shutter = new THREE.Group(); group.add(shutter);
  const s1 = L.mat(K.steel, { rough: 0.6, metal: 0.25, scale: 1.5 }), s2 = L.mat(L.mixHex(K.steel, '#000', 0.18), { rough: 0.6, metal: 0.25, scale: 1.5 });
  const slats = []; for (let i = 0; i < NS; i++) slats.push(L.B(shW, sh * 0.96, 0.1, i % 2 ? s1 : s2, { r: 0.03, z: 0.2, parent: shutter }));
  L.B(shW + 0.3, 0.6, 0.7, dk, { r: 0.08, y: OT + 0.4, z: 0.3, parent: group });
  const handle = L.B(0.8, 0.12, 0.14, L.mat('#2a2a30'), { r: 0.04, z: 0.3, parent: shutter });
  // awning: stripes + pennant bunting along the lip
  const aw = new THREE.Group(); aw.position.set(0, 5.15, 0.05); aw.rotation.x = 0.36; group.add(aw);
  const NSt = 11, stW = (w + 0.2) / NSt, cream2 = L.mat('#f6eedc', { scale: 1.2 });
  for (let i = 0; i < NSt; i++) L.B(stW + 0.01, 0.1, 2.2, i % 2 ? cream2 : am, { r: 0.03, x: -(w + 0.2) / 2 + stW * (i + 0.5), z: 1.1, parent: aw });
  const lip = new THREE.Group(); lip.position.set(0, -0.02, 2.2); lip.rotation.x = -0.36; aw.add(lip);
  L.B(w + 0.3, 0.14, 0.12, dk, { r: 0.04, parent: lip });
  const penCols = [K.gold, color, '#f6eedc', o.accent ?? P.accent];
  const triG = geo('pennant', () => { const s = new THREE.Shape(); s.moveTo(-0.28, 0); s.lineTo(0.28, 0); s.lineTo(0, -0.6); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }); });
  const pens = []; const NP = Math.round(w / 0.62);
  for (let i = 0; i < NP; i++) { const m = mesh(triG, L.mat(penCols[i % 4], { side: THREE.DoubleSide }), { x: -w / 2 + 0.31 + i * (w - 0.62) / (NP - 1), y: -0.06, z: 0.04, parent: lip }); pens.push(m); }
  // sign board
  const sb = new THREE.Group(); sb.position.set(0, 6.35, 0.15); group.add(sb);
  L.B(w - 1.4, 1.5, 0.3, dk, { r: 0.08, parent: sb });
  L.B(w - 1.2, 0.12, 0.36, L.mat(K.gold, { rough: 0.45, metal: 0.4, felt: 0.4 }), { r: 0.04, y: 0.78, parent: sb }); L.B(w - 1.2, 0.12, 0.36, L.mat(K.gold, { rough: 0.45, metal: 0.4, felt: 0.4 }), { r: 0.04, y: -0.78, parent: sb });
  const signD = decal(w - 1.6, 1.36, (g, W, H2) => { drawIcon(g, icon, H2 * 0.62, H2 / 2, H2 * 0.7, K.cream, { bg: color }); txt(g, name, W / 2 + H2 * 0.38, H2 * 0.54, { size: H2 * 0.62, maxW: W - H2 * 1.5, color: K.cream, wear: 0.1 }); }, { ppu: 260, felt: 0.4 });
  signD.position.z = 0.16; sb.add(signD);
  // chalkboard A-frame
  const af = makeAFrame(ctx, { lines: o.board ?? P.board, frame: color }); af.group.position.set(o.aframeX ?? wx + 0.4, 0, 2.6); af.group.rotation.y = 0.25; group.add(af.group);
  const anchors = { door: V((dr[0] + dr[1]) / 2, 0, 0.9), front: V(0, 0, 3.2), sign: V(0, 6.35, 0.4), window: V(wx, wy, 0.3), aframe: af.group.position.clone(), awningLip: V(0, 4.4, 2.2) };
  const c = {
    group, door, shutter, sign: sb, awning: aw, aframe: af, anchors, color, name,
    set({ shutter: k = 0, open = 0, sign = 1, t = 0 } = {}) {
      k = clamp(k);
      const top = OT + 0.1;
      slats.forEach((s, i) => { const y = top - (i + 0.5) * sh + (1 - k) * shH; s.visible = y < top - sh * 0.2; s.position.y = y; });
      handle.position.y = top - shH * k + 0.25; handle.visible = k > 0.05;
      door.rotation.y = clamp(open) * 1.6;
      dsign.rotation.y = Math.PI * (1 - clamp(sign)); dsign.rotation.z = Math.sin(t * 5) * 0.04;
      pens.forEach((p, i) => { p.rotation.x = Math.sin(t * 4 + i * 0.9) * 0.18; });
      return c;
    },
  };
  return c.set();
}
// chalkboard A-frame sign. makeAFrame(ctx, { lines: [...], frame }) origin floor centre, faces +Z
export function makeAFrame(ctx, { lines: L0 = ['FRESH', 'COFFEE'], frame = K.red, w = 1.5, h = 2.2, seed = 3 } = {}) {
  const group = new THREE.Group(), fm = L.mat(frame), wd = L.mat(C.woodLight);
  for (const s of [1, -1]) {
    const leaf = new THREE.Group(); leaf.position.set(0, h, 0); leaf.rotation.x = -s * 0.24; if (s < 0) leaf.rotation.y = Math.PI; group.add(leaf);
    L.B(w + 0.16, h + 0.1, 0.1, fm, { r: 0.04, y: -h / 2, parent: leaf });
    if (s > 0) {
      const T = ctex(w * 300, h * 300), g = T.g, W = T.W, H = T.H, R = L.rng(seed);
      g.fillStyle = K.chalk; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + R() * 0.04})`; g.beginPath(); g.ellipse(R() * W, R() * H, 30 + R() * 90, 10 + R() * 30, R() * 3, 0, 7); g.fill(); }
      const cols = ['#f6f1e2', '#ffd36b', '#9fe0a8', '#f6f1e2'];
      lines(g, L0.map((t, i) => ({ text: t, color: cols[i % 4] })), W / 2, H * 0.08, H * 0.74, W * 0.86, { wear: 0.3, seed });
      drawIcon(g, 'cup', W / 2, H * 0.89, H * 0.12, '#f6f1e2');
      T.t.needsUpdate = true;
      mesh(plane(w - 0.1, h - 0.1), L.mat('#ffffff', { map: T.t, felt: 0.5 }), { y: -h / 2, z: 0.056, cast: false, parent: leaf });
    }
  }
  L.B(0.2, 0.16, 0.2, wd, { r: 0.04, y: h + 0.02, parent: group });
  return { group };
}
// delivery scooter with a crate (side view = faces +Z, front to +X). makeDeliveryBike(ctx, { color }) set({ roll })
export function makeDeliveryBike(ctx, { color = K.green, icon = 'door' } = {}) {
  const group = new THREE.Group(), bm = L.mat(color), tm = L.mat('#1d1b20', { rough: 0.6 }), mm = L.mat('#c9ccd2', { metal: 0.5, rough: 0.35, felt: 0.2 });
  const wheels = [-1.1, 1.1].map((x) => { const g = new THREE.Group(); g.position.set(x, 0.48, 0); group.add(g); mesh(torus(0.38, 0.12, Math.PI * 2, 24), tm, { parent: g }); mesh(cyl(0.12, 0.12, 0.2, 12), mm, { rx: Math.PI / 2, parent: g }); for (let i = 0; i < 3; i++) L.B(0.66, 0.04, 0.04, mm, { r: 0, rz: (i * Math.PI) / 3, parent: g }); return g; });
  L.B(2.0, 0.35, 0.6, bm, { r: 0.12, y: 0.75, parent: group });
  L.B(0.8, 0.18, 0.5, L.mat('#2a2522'), { r: 0.08, x: -0.4, y: 1.02, parent: group });
  L.B(0.18, 1.1, 0.18, bm, { r: 0.05, x: 1.0, y: 1.25, rz: -0.25, parent: group });
  L.B(0.12, 0.12, 0.9, tm, { r: 0.04, x: 1.15, y: 1.8, parent: group });
  const crate = new THREE.Group(); crate.position.set(-1.25, 1.55, 0); group.add(crate);
  L.B(1.1, 0.9, 0.9, L.mat(K.cream), { r: 0.08, parent: crate });
  L.B(1.14, 0.14, 0.94, bm, { r: 0.04, y: 0.42, parent: crate });
  const st = makeIconSticker(ctx, icon, { size: 0.62, bg: color }); st.position.set(0, -0.04, 0.46); crate.add(st);
  const c = { group, set({ roll = 0 } = {}) { wheels.forEach((w) => (w.rotation.z = -roll)); return c; } };
  return c.set();
}

// =====================================================================================================
// CITY: makeStreet (sidewalk + road + lamps/trees) and makeSkyline (pop-up blocks). both set({ rise 0..1 })
// =====================================================================================================
export function makeStreet(ctx, { w = 60, walk = 7, road = 10, lamps = 4, seed = 5, clear = null } = {}) {
  const group = new THREE.Group();
  L.B(w, 0.3, walk + 2, L.mat(K.sidewalk, { scale: 0.7 }), { r: 0, y: -0.15, z: walk / 2 - 1, parent: group });
  for (let x = -w / 2 + 2; x < w / 2; x += 2.5) L.B(0.05, 0.02, walk + 2, L.mat(L.mixHex(K.sidewalk, '#000', 0.15), { felt: 0.3 }), { r: 0, x, y: 0.005, z: walk / 2 - 1, cast: false, parent: group });
  L.B(w, 0.34, 0.5, L.mat('#d9d2c4'), { r: 0.06, y: -0.13, z: walk, parent: group });
  L.B(w, 0.3, road, L.mat(K.asphalt, { scale: 0.6 }), { r: 0, y: -0.35, z: walk + 0.25 + road / 2, parent: group });
  for (let x = -w / 2 + 1; x < w / 2; x += 3.2) L.B(1.6, 0.04, 0.24, L.mat(K.gold, { felt: 0.4 }), { r: 0.02, x, y: -0.19, z: walk + 0.25 + road / 2, cast: false, parent: group });
  L.B(w, 0.3, 30, L.mat('#4a5a3a', { scale: 0.5 }), { r: 0, y: -0.16, z: -16, parent: group });
  const props = [], R = L.rng(seed);
  for (let i = 0; i < lamps; i++) {
    const g = new THREE.Group(), x = -w / 2 + (i + 0.5) * (w / lamps); g.position.set(x, 0, walk - 0.6); group.add(g);
    const pm = L.mat('#2c3240', { rough: 0.5 });
    L.B(0.22, 4.6, 0.22, pm, { r: 0.05, y: 2.3, parent: g }); L.B(0.5, 0.3, 0.5, pm, { r: 0.06, y: 0.15, parent: g });
    L.B(0.8, 0.12, 0.2, pm, { r: 0.04, x: 0.3, y: 4.6, parent: g });
    mesh(sph(0.26, 14, 10), L.glowMat('#ffe2a8', 1.2), { x: 0.6, y: 4.38, parent: g, cast: false });
    props.push({ g, d: R() * 0.35 });
    const tr = new THREE.Group(); tr.position.set(x + w / lamps / 2, 0, walk - 0.8); group.add(tr);
    L.B(0.9, 0.6, 0.9, L.mat(C.terracotta), { r: 0.08, y: 0.3, parent: tr }); L.B(0.24, 1.6, 0.24, L.mat(C.woodDark), { r: 0.05, y: 1.2, parent: tr });
    L.B(1.6, 1.4, 1.6, L.mat(C.leaf, { scale: 1.6 }), { r: 0.35, y: 2.5, parent: tr }); L.B(1.1, 0.8, 1.1, L.mat(L.mixHex(C.leaf, '#fff', 0.12), { scale: 1.6 }), { r: 0.3, y: 3.3, parent: tr });
    props.push({ g: tr, d: R() * 0.35 });
  }
  // clear: keep lamps + trees out of the centre corridor |x| < clear (so they never block the hero / a camera on the sidewalk).
  // Default (clear omitted): the lamp/tree standing at the centre (|x| < 2.5) is left out, nothing else moves. clear: 0 = keep all.
  if (clear == null) { for (const p of props) if (Math.abs(p.g.position.x) < 2.5) p.off = true; }
  else if (clear > 0) for (const p of props) { const x = p.g.position.x; if (Math.abs(x) < clear) p.g.position.x = (x < 0 ? -1 : 1) * (clear + Math.abs(x) * 0.5); }
  const c = { group, props, set({ rise = 1 } = {}) { for (const p of props) { const q = clamp((rise - p.d) / 0.55); p.g.visible = q > 0 && !p.off; p.g.scale.setScalar(pop(q)); } return c; } };
  return c.set();
}
function drawBuilding(g, W, H, col, seed) {
  const R = L.rng(seed); g.fillStyle = col; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + R() * 0.05})`; g.beginPath(); g.arc(R() * W, R() * H, 10 + R() * 40, 0, 7); g.fill(); }
  const cols = 3 + Math.floor(R() * 2), rows = Math.max(3, Math.round(H / W * cols * 0.9)), mx = W * 0.12, gw = (W - 2 * mx) / cols, gh = (H * 0.92 - H * 0.06) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const lit = R() > 0.45; g.fillStyle = lit ? '#ffe2a0' : 'rgba(30,35,60,0.55)'; rr(g, mx + c * gw + gw * 0.18, H * 0.06 + r * gh + gh * 0.18, gw * 0.64, gh * 0.6, 4); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, H * 0.025);
}
export function makeSkyline(ctx, { w = 60, z = -14, rows = 2, seed = 9, colors = ['#7d93c9', '#c98a6a', '#e3c27a', '#9a7fc0', '#86b49a', '#d6b9a0', '#6f8ab8', '#b8655a'] } = {}) {
  const group = new THREE.Group(), R = L.rng(seed), blds = [];
  for (let r = 0; r < rows; r++) {
    let x = -w / 2;
    while (x < w / 2) {
      const bw = 3 + R() * 3.5, bh = (r ? 12 : 7) + R() * (r ? 12 : 8), bd = 3 + R() * 2, col = colors[Math.floor(R() * colors.length)];
      const g = new THREE.Group(); g.position.set(x + bw / 2, 0, z - r * 7 - R() * 2); group.add(g);
      const T = ctex(160, Math.round(160 * bh / bw)); drawBuilding(T.g, T.W, T.H, col, seed * 100 + blds.length); T.t.needsUpdate = true;
      const fm = L.mat('#ffffff', { map: T.t, felt: 0.6 }), sm = L.mat(L.mixHex(col, '#000', 0.12)), tm = L.mat(L.mixHex(col, '#000', 0.3));
      const m = new THREE.Mesh(L.rbox(bw, bh, bd, 0), [sm, sm, tm, tm, fm, sm]); m.position.y = bh / 2; m.castShadow = m.receiveShadow = true; g.add(m);
      if (R() > 0.5) { L.B(bw * 0.4, 0.8, bd * 0.4, tm, { r: 0.08, x: (R() - 0.5) * bw * 0.4, y: bh + 0.4, parent: g }); }
      else { mesh(cyl(0.5, 0.5, 1.2, 12), L.mat('#8a5a3a'), { x: bw * 0.2, y: bh + 0.9, parent: g }); mesh(geo('wtRoof', () => new THREE.ConeGeometry(0.62, 0.5, 12)), L.mat('#5a3420'), { x: bw * 0.2, y: bh + 1.75, parent: g }); }
      blds.push({ g, d: (Math.abs(x + bw / 2) / (w / 2)) * 0.45 + r * 0.1 });
      x += bw + 0.15;
    }
  }
  const c = { group, buildings: blds, set({ rise = 1 } = {}) { for (const b of blds) { const q = clamp((rise - b.d) / 0.45); b.g.visible = q > 0; b.g.scale.set(1, pop(q, 2.6), 1); } return c; } };
  return c.set();
}

// =====================================================================================================
// SMALL PROPS
// =====================================================================================================
// paper coffee cup with sleeve + lid. makeCup(ctx, { color (sleeve), icon ('bean'|'door'|'cup'|null), steam = true, size = 1 })
// origin = cup bottom; ~1.05 tall at size 1. set({ steam 0..1, t })
export function makeCup(ctx, { color = K.red, icon = 'bean', steam = true, size = 1 } = {}) {
  const group = new THREE.Group(), inner = new THREE.Group(); inner.scale.setScalar(size); group.add(inner);
  const wm = L.mat(K.cup, { scale: 2 }), sm = L.mat(color, { scale: 2 }), lm = L.mat('#f2ece0', { rough: 0.6, felt: 0.4 });
  mesh(cyl(0.36, 0.27, 0.9, 28), wm, { y: 0.45, parent: inner });
  mesh(cyl(0.352, 0.312, 0.38, 28), sm, { y: 0.42, parent: inner });
  mesh(cyl(0.4, 0.4, 0.07, 28), lm, { y: 0.92, parent: inner });
  mesh(cyl(0.3, 0.37, 0.12, 28), lm, { y: 1.0, parent: inner });
  L.B(0.14, 0.04, 0.06, L.mat('#3a2a20'), { r: 0.015, y: 1.065, z: 0.2, parent: inner });
  if (icon) { const st = makeIconSticker(ctx, icon, { size: 0.3, bg: K.cream, color }); st.position.set(0, 0.42, 0.335); st.rotation.x = -0.1; inner.add(st); }
  const puffs = [];
  if (steam) for (let col = 0; col < 3; col++) for (let i = 0; i < 4; i++) {
    const m = mesh(sph(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#fffaf0', transparent: true, opacity: 0.4, depthWrite: false }), { parent: inner, cast: false, recv: false });
    puffs.push({ m, col, i });
  }
  const c = {
    group, inner,
    set({ steam: s = 1, t = 0 } = {}) {
      for (const p of puffs) {
        const q = fract(t * 0.55 + p.i / 4 + p.col * 0.13), x = (p.col - 1) * 0.14 + Math.sin(q * 6 + p.col * 2) * 0.07;
        p.m.position.set(x, 1.12 + q * 1.1, 0); p.m.scale.set(Math.max(0.001, (0.04 + 0.06 * q) * clamp(s * 1.5)), Math.max(0.001, (0.09 + 0.12 * q) * clamp(s * 1.5)), Math.max(0.001, (0.04 + 0.06 * q) * clamp(s * 1.5)));
        p.m.material.opacity = clamp(s) * Math.sin(Math.PI * q) * 0.42; p.m.visible = s > 0.01;
      }
      return c;
    },
  };
  return c.set();
}
// glass coin jar. makeCoinJar(ctx, { label = 'BUDGET', coins = 28 }) origin bottom; set({ fill 0..1 })
export function makeCoinJar(ctx, { label = 'BUDGET', coins = 28, r = 0.75, h = 1.6, labelColor = C.ink } = {}) {
  const group = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: '#d8ecff', transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const jar = mesh(cyl(r, r, h, 32, true), glass, { y: h / 2, cast: false, parent: group }); jar.renderOrder = 3;
  mesh(cyl(r, r, 0.06, 32), glass, { y: 0.03, cast: false, parent: group });
  mesh(cyl(r * 0.82, r * 0.82, 0.12, 28), glass, { y: h + 0.04, cast: false, parent: group });
  mesh(cyl(r * 0.86, r * 0.86, 0.2, 28), L.mat(K.gold, { metal: 0.45, rough: 0.4, scale: 2 }), { y: h + 0.18, parent: group });
  L.B(0.06, h * 0.7, 0.02, L.glowMat('#ffffff', 0.9, { transparent: true, opacity: 0.35 }), { r: 0, x: -r * 0.55, y: h * 0.55, z: r * 0.8, cast: false, parent: group });
  const cm = L.mat(K.gold, { metal: 0.5, rough: 0.35, scale: 3 }), list = [], R = L.rng(17);
  for (let i = 0; i < coins; i++) { const layer = Math.floor(i / 4), a = (i % 4) * (Math.PI / 2) + layer * 0.7; const m = mesh(cyl(0.26, 0.26, 0.08, 18), cm, { x: Math.cos(a) * r * 0.42, y: 0.1 + layer * (h - 0.25) / (coins / 4), z: Math.sin(a) * r * 0.42, rx: (R() - 0.5) * 0.5, rz: (R() - 0.5) * 0.5, parent: group }); list.push(m); }
  if (label) { const lb = decal(r * 1.5, 0.5, (g, W, H) => { L.paperFill(g, W, H, K.cream, 4, 0.6); txt(g, label, W / 2, H * 0.54, { size: H * 0.6, maxW: W * 0.86, color: labelColor }); }, { ppu: 300, felt: 0.3 }); lb.position.set(0, 0.42, r + 0.01); group.add(lb); }
  const c = { group, set({ fill = 1 } = {}) { const n = Math.round(clamp(fill) * coins); list.forEach((m, i) => (m.visible = i < n)); return c; } };
  return c.set();
}
// fork signpost with two arrow boards (+ optional Y road). makeSignpost(ctx, { left: '1', right: '2', leftColor, rightColor, road = true })
// origin = post foot; set({ k 0..1 }) boards swing in (left first)
export function makeSignpost(ctx, { left = '1', right = '2', leftColor = K.red, rightColor = K.green, road = true, h = 4.6 } = {}) {
  const group = new THREE.Group(), wd = L.mat(C.wood);
  L.B(0.32, h, 0.32, wd, { r: 0.06, y: h / 2, parent: group });
  mesh(geo('postCap', () => new THREE.ConeGeometry(0.3, 0.35, 4)), wd, { y: h + 0.17, ry: Math.PI / 4, parent: group });
  const board = (text, col, dir, y) => {
    const bw = 3.0, bh = 1.0, sh = new THREE.Shape(), x0 = -bw / 2, x1 = bw / 2, hd = bh * 0.5;
    if (dir > 0) { sh.moveTo(x0, -bh / 2); sh.lineTo(x1 - hd, -bh / 2); sh.lineTo(x1, 0); sh.lineTo(x1 - hd, bh / 2); sh.lineTo(x0, bh / 2); }
    else { sh.moveTo(x1, -bh / 2); sh.lineTo(x0 + hd, -bh / 2); sh.lineTo(x0, 0); sh.lineTo(x0 + hd, bh / 2); sh.lineTo(x1, bh / 2); }
    sh.closePath();
    const gm = normUV(new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }).translate(0, 0, -0.07), bw, bh);
    const T = ctex(bw * 220, bh * 220); L.paperFill(T.g, T.W, T.H, col, dir > 0 ? 3 : 4, 0.5);
    const tx = dir > 0 ? T.W * 0.42 : T.W * 0.58;
    txt(T.g, text, tx, T.H * 0.54, { size: T.H * 0.7, maxW: T.W * 0.7, color: K.cream }); T.t.needsUpdate = true;
    const piv = new THREE.Group(); piv.position.set(0, y, 0.22); group.add(piv);
    mesh(gm, [L.mat('#ffffff', { map: T.t, felt: 0.4 }), L.mat(L.mixHex(col, '#000', 0.3))], { x: dir * (bw / 2 - 0.25), parent: piv });
    return piv;
  };
  const bl = board(left, leftColor, -1, h - 0.7), br = board(right, rightColor, 1, h - 1.9);
  if (road) {
    const rm = L.mat('#a89a86', { scale: 0.7 }), lm = L.mat(K.cream, { felt: 0.4 });
    L.B(3.4, 0.08, 9, rm, { r: 0, y: 0.0, z: 4.6, parent: group });
    for (const s of [-1, 1]) { const g = new THREE.Group(); g.position.set(0, 0, 0.4); g.rotation.y = s * 0.62; group.add(g); L.B(3.2, 0.08, 14, rm, { r: 0, y: 0.005, z: -7, parent: g }); for (let i = 0; i < 5; i++) L.B(0.18, 0.02, 0.9, lm, { r: 0, y: 0.05, z: -1.8 - i * 2.4, parent: g }); }
    for (let i = 0; i < 4; i++) L.B(0.18, 0.02, 0.9, lm, { r: 0, y: 0.05, z: 1.8 + i * 2.2, parent: group });
  }
  const c = { group, left: bl, right: br, set({ k = 1 } = {}) { const a = clamp(k * 1.6), b = clamp(k * 1.6 - 0.6); bl.rotation.z = (1 - pop(a, 2.6)) * 1.3; bl.visible = a > 0; br.rotation.z = -(1 - pop(b, 2.6)) * 1.3; br.visible = b > 0; return c; } };
  return c.set();
}
// megaphone pointing +Z (mouth at +z). origin = handle grip. set({ blast 0..1, t }) sound rings fly out
export function makeMegaphone(ctx, { color = K.red } = {}) {
  const group = new THREE.Group(), body = new THREE.Group(); body.position.set(0, 0.35, 0); group.add(body);
  const rm = L.mat(color, { side: THREE.DoubleSide, scale: 1.6 }), cm = L.mat(K.cream), dm = L.mat('#2a2a30');
  mesh(cyl(0.62, 0.2, 1.4, 28, true), rm, { rx: Math.PI / 2, z: 0.3, parent: body });
  mesh(cyl(0.6, 0.6, 0.02, 28), L.mat('#3a1a16', { side: THREE.DoubleSide }), { rx: Math.PI / 2, z: 0.9, parent: body });
  mesh(torus(0.62, 0.06, Math.PI * 2, 30), cm, { z: 1.0, parent: body });
  mesh(geo('megaBand', () => new THREE.CylinderGeometry(0.43, 0.39, 0.16, 28, 1, true)), L.mat(K.cream, { side: THREE.DoubleSide }), { rx: Math.PI / 2, z: 0.39, parent: body });
  mesh(cyl(0.22, 0.22, 0.4, 18), dm, { rx: Math.PI / 2, z: -0.55, parent: body });
  L.B(0.18, 0.55, 0.22, dm, { r: 0.05, y: -0.3, z: -0.25, parent: body });
  const rings = [0, 1, 2].map(() => { const m = mesh(torus(0.62, 0.035, Math.PI * 2, 32), L.glowMat('#fff2c2', 1.1, { transparent: true, opacity: 0.6, depthWrite: false }), { z: 1.2, parent: body, cast: false, recv: false }); return m; });
  const c = { group, body, mouth: V(0, 0.35, 1.0), set({ blast = 0, t = 0 } = {}) { rings.forEach((m, i) => { const q = fract(t * 1.6 + i / 3); m.visible = blast > 0.01; m.position.z = 1.1 + q * 2.2; m.scale.setScalar(0.6 + q * 0.9); m.material.opacity = clamp(blast) * (1 - q) * 0.6; }); return c; } };
  return c.set();
}
// speech bubble (paper, tail bottom-left). makeBubble(ctx, { text, w, h }) centre origin. set({ pop 0..1, deflate 0..1 })
export function makeBubble(ctx, { text = 'HELLO!', w = 4.2, h = 2.2, color = C.ink, paper = '#fbf6ea', seed = 8 } = {}) {
  const group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
  const pm = L.mat(paper, { felt: 0.5 });
  mesh(rrSlab(w, h, h * 0.45, 0.16), pm, { parent: inner });
  const tail = geo('bubTail', () => { const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.3, 0); s.lineTo(-0.7, -0.9); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false }).translate(0, 0, -0.08); });
  mesh(tail, pm, { x: -w * 0.2, y: -h / 2 + 0.1, parent: inner });
  const d = decal(w - 0.4, h - 0.3, (g, W, H) => lines(g, splitTwo(text), W / 2, H * 0.06, H * 0.88, W * 0.9, { color, seed }), { ppu: 240, felt: 0.3 }); d.position.z = 0.13; inner.add(d);
  const c = { group, inner, set({ pop: p = 1, deflate = 0 } = {}) { const s = pop(clamp(p)), dfl = smooth(clamp(deflate)); inner.scale.set(s * lerp(1, 0.55, dfl), s * lerp(1, 0.18, dfl), s); inner.position.y = -dfl * h * 0.6; inner.rotation.z = dfl * -0.35 + Math.sin(dfl * 18) * 0.06 * dfl; return c; } };
  return c.set();
}
// hanging cloth banner. makeBanner(ctx, text, { w, h, color, ink }) origin = centre of the top rod. set({ unroll 0..1 })
export function makeBanner(ctx, text = 'EVERYONE', { w = 8, h = 2.6, color = K.red, ink = K.cream, ropes = true } = {}) {
  const group = new THREE.Group(), gm = L.mat(K.gold, { metal: 0.45, rough: 0.4, felt: 0.4 }), wd = L.mat(C.woodDark);
  mesh(cyl(0.14, 0.14, w + 0.6, 16), wd, { rz: Math.PI / 2, parent: group });
  for (const s of [-1, 1]) mesh(sph(0.22, 14, 10), gm, { x: s * (w / 2 + 0.35), parent: group });
  if (ropes) for (const s of [-1, 1]) rod([s * w * 0.42, 0, 0], [0, 1.6, 0], 0.025, L.mat('#c9b89a'), group);
  const T = ctex(w * 160, h * 160), g = T.g; L.paperFill(g, T.W, T.H, color, 12, 0.6);
  g.strokeStyle = K.gold; g.lineWidth = T.H * 0.04; g.strokeRect(T.H * 0.06, T.H * 0.06, T.W - T.H * 0.12, T.H * 0.88);
  lines(g, splitTwo(text), T.W / 2, T.H * 0.1, T.H * 0.8, T.W * 0.88, { color: ink, seed: 3, wear: 0.15 });
  T.t.needsUpdate = true;
  const cg = geo(`banner${w},${h}`, () => new THREE.PlaneGeometry(w, h).translate(0, -h / 2, 0));
  const cloth = mesh(cg, L.mat('#ffffff', { map: T.t, felt: 0.7, side: THREE.DoubleSide }), { z: 0.02, parent: group });
  const roll = mesh(cyl(1, 1, w + 0.1, 18), L.mat(L.mixHex(color, '#000', 0.15)), { rz: Math.PI / 2, parent: group });
  const c = { group, cloth, set({ unroll = 1 } = {}) { const k = clamp(unroll); cloth.visible = k > 0.01; cloth.scale.y = Math.max(0.001, k); T.t.repeat.y = Math.max(0.001, k); T.t.offset.y = 1 - k; const r = lerp(0.36, 0.13, k); roll.scale.set(r, 1, r); roll.position.set(0, -h * k, 0.03); return c; } };
  return c.set();
}
// marquee billboard (paper face, ink text, bulb border, legs). makeBigSign(ctx, text, { color, w, h, legs, crossStyle 'line'|'x' })
// origin = floor centre (legs) or board bottom centre (legs: 0). set({ lit 0..1, t (bulb chase), cross 0..1 (red strike-through paints on) })
export function makeBigSign(ctx, text = 'YOUR BIG IDEA', { color = K.red, ink = C.ink, w = 7, h = 3.4, legs = 1.6, crossStyle = 'line', seed = 21 } = {}) {
  const group = new THREE.Group(), board = new THREE.Group(); board.position.y = legs + h / 2; group.add(board);
  const fm = L.mat(color), wd = L.mat(C.woodDark);
  L.B(w, h, 0.4, fm, { r: 0.12, parent: board });
  const P = slab(w - 0.7, h - 0.7, { thick: 0.06 }); P.mesh.position.z = 0.22; board.add(P.mesh);
  P.draw((g, W, H) => { L.paperFill(g, W, H, C.paper, seed); lines(g, splitTwo(text), W / 2, H * 0.08, H * 0.84, W * 0.9, { color: ink, seed }); });
  if (legs > 0) for (const s of [-1, 1]) L.B(0.3, legs + 0.4, 0.3, wd, { r: 0.05, x: s * w * 0.3, y: (legs + 0.4) / 2, z: -0.3, parent: group });
  const bulbs = [], per = 2 * (w + h), n = Math.round(per / 0.55);
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per, x, y;
    if (d < w) { x = -w / 2 + d; y = h / 2; } else if ((d -= w) < h) { x = w / 2; y = h / 2 - d; } else if ((d -= h) < w) { x = w / 2 - d; y = -h / 2; } else { d -= w; x = -w / 2; y = -h / 2 + d; }
    const m = mesh(sph(0.11, 10, 8), L.glowMat('#ffe2a8', 1.3), { x: x * 0.94, y: y * 0.9, z: 0.23, parent: board, cast: false }); bulbs.push(m);
  }
  const off = new THREE.Color('#8a7a60'), on = new THREE.Color('#ffe2a8').multiplyScalar(1.3);
  const strokes = (crossStyle === 'x' ? [-0.42, 0.42] : [-0.14]).map((rz, i) => { const p = new THREE.Group(); p.rotation.z = rz; p.position.z = 0.3; board.add(p); const m = L.B(w * 1.08, 0.42, 0.06, L.mat(C.no, { scale: 2 }), { r: 0.06, parent: p }); m.geometry = m.geometry.clone().translate(w * 0.54, 0, 0); m.position.x = -w * 0.54; return { p, m }; });
  const c = { group, board, set({ lit = 1, t = 0, cross = 0 } = {}) {
    bulbs.forEach((b, i) => { const k = clamp(lit) * (0.55 + 0.45 * (Math.floor(t * 6 + i) % 3 === 0 ? 1 : 0.4)); b.material.color.copy(off).lerp(on, k); });
    strokes.forEach((s, i) => { const k = strokes.length > 1 ? clamp(cross * 2 - i) : clamp(cross); s.m.visible = k > 0.01; s.m.scale.x = Math.max(0.001, smooth(k)); });
    return c; } };
  return c.set();
}
// stage spotlight: light cone + floor pool (+ hanging lamp). origin = centre of the pool on the floor. set({ on 0..1, radius })
export function makeSpotlight(ctx, { h = 9, radius = 1.8, color = '#fff1c9', lamp = true, tilt = 0 } = {}) {
  const group = new THREE.Group();
  const FT = ctex(8, 256); { const gr = FT.g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0.12)'); FT.g.fillStyle = gr; FT.g.fillRect(0, 0, 8, 256); FT.t.needsUpdate = true; }
  const HT = ctex(256, 256); { const gr = HT.g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); HT.g.fillStyle = gr; HT.g.fillRect(0, 0, 256, 256); HT.t.needsUpdate = true; }
  const am = (map, op) => L.glowMat(color, 1.0, { map, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const coneM = am(FT.t, 0.3), poolM = am(HT.t, 0.45);
  const cone = mesh(cyl(0.35, 1, h, 32, true), coneM, { y: h / 2, cast: false, recv: false, parent: group }); cone.renderOrder = 4;
  const pool = mesh(geo('poolC', () => new THREE.CircleGeometry(1, 40)), poolM, { rx: -Math.PI / 2, y: 0.03, cast: false, recv: false, parent: group }); pool.renderOrder = 4;
  let can = null;
  if (lamp) { can = new THREE.Group(); can.position.y = h + 0.3; group.add(can); mesh(cyl(0.45, 0.6, 0.9, 20), L.mat('#2a2a30', { rough: 0.5 }), { parent: can }); mesh(geo('lensC', () => new THREE.CircleGeometry(0.55, 24)), L.glowMat(color, 1.6), { rx: Math.PI / 2, y: -0.46, cast: false, parent: can }); }
  const c = { group, cone, pool, set({ on = 1, radius: r = radius } = {}) { const k = clamp(on); cone.visible = pool.visible = k > 0.01; cone.scale.set(r, 1, r); pool.scale.setScalar(r * 1.15); coneM.opacity = 0.13 * k; poolM.opacity = 0.32 * k; return c; } };
  return c.set();
}
// magnifying glass. origin = lens centre, faces +Z, handle down-right. set({ glint 0..1 })
export function makeMagnifier(ctx, { r = 0.7, color = '#2a2a33' } = {}) {
  const group = new THREE.Group();
  mesh(torus(r, 0.11, Math.PI * 2, 36), L.mat(color, { rough: 0.45, felt: 0.4 }), { parent: group });
  const lens = mesh(geo(`magL${r}`, () => new THREE.CircleGeometry(r, 32)), new THREE.MeshStandardMaterial({ color: '#d8ecff', transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }), { cast: false, parent: group });
  const gl = mesh(plane(r * 0.18, r * 0.9), L.glowMat('#ffffff', 1.4, { transparent: true, opacity: 0.6, depthWrite: false }), { x: -r * 0.38, y: r * 0.15, z: 0.02, rz: -0.6, cast: false, parent: group });
  const hd = new THREE.Group(); hd.rotation.z = 0.6; group.add(hd);
  L.B(0.16, 0.4, 0.16, L.mat(K.gold, { metal: 0.45, rough: 0.4 }), { r: 0.04, y: -r - 0.18, parent: hd });
  L.B(0.26, 1.3, 0.26, L.mat(C.wood), { r: 0.1, y: -r - 1.0, parent: hd });
  const c = { group, lens, set({ glint = 0 } = {}) { gl.material.opacity = 0.35 + 0.55 * clamp(glint); gl.position.x = -r * 0.38 + clamp(glint) * r * 0.6; return c; } };
  return c.set();
}
// house front: wall + framed door (opens inward) + step + doormat + lamp + number + plant. origin floor centre, door at x 0.
// makeFrontDoor(ctx, { wall, door, mat: 'WELCOME', number: '42' }) set({ open 0..1 }); anchors.mat = top of the doormat
export function makeFrontDoor(ctx, { wall = '#e3cfa8', door: dc = K.door, mat: matText = 'WELCOME', number = '42', w = 8, h = 6.5 } = {}) {
  const group = new THREE.Group(), wm = L.mat(wall, { scale: 0.8 }), tm = L.mat('#f6f0e2'), dm = L.mat(dc), dk = L.mat(L.mixHex(dc, '#000', 0.3));
  const dw = 2.0, dh = 3.6;
  const piece = (x0, x1, y0, y1) => L.B(x1 - x0, y1 - y0, 0.5, wm, { r: 0.02, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: -0.25, parent: group });
  piece(-w / 2, -dw / 2, 0, h); piece(dw / 2, w / 2, 0, h); piece(-dw / 2, dw / 2, dh, h);
  for (let y = 0.5; y < h; y += 0.55) L.B(w, 0.05, 0.04, L.mat(L.mixHex(wall, '#000', 0.12), { felt: 0.3 }), { r: 0, y, z: 0.01, cast: false, parent: group });
  { const T = ctex(300, 540), g = T.g, gr = g.createLinearGradient(0, 0, 0, 540); gr.addColorStop(0, '#ffe0a8'); gr.addColorStop(1, '#c98a50'); g.fillStyle = gr; g.fillRect(0, 0, 300, 540); g.fillStyle = '#7a4a2e'; g.fillRect(0, 420, 300, 120); T.t.needsUpdate = true;
    mesh(plane(dw, dh), new THREE.MeshBasicMaterial({ map: T.t, color: new THREE.Color(0.75, 0.75, 0.75), toneMapped: false }), { y: dh / 2, z: -0.9, cast: false, parent: group });
    for (const s of [-1, 1]) L.B(0.05, dh, 0.7, wm, { r: 0, x: s * dw / 2, y: dh / 2, z: -0.6, parent: group }); }
  for (const [x, y, bw, bh] of [[0, dh + 0.12, dw + 0.6, 0.28], [-dw / 2 - 0.15, dh / 2, 0.3, dh], [dw / 2 + 0.15, dh / 2, 0.3, dh]]) L.B(bw, bh, 0.3, tm, { r: 0.05, x, y, z: 0.05, parent: group });
  const door = new THREE.Group(); door.position.set(-dw / 2 + 0.02, 0, -0.12); group.add(door);
  L.B(dw - 0.04, dh - 0.04, 0.14, dm, { r: 0.04, x: dw / 2, y: dh / 2, parent: door });
  for (const [y, hh] of [[0.95, 1.2], [2.45, 1.3]]) L.B(dw - 0.6, hh, 0.04, dk, { r: 0.03, x: dw / 2, y, z: 0.08, parent: door });
  mesh(sph(0.11, 12, 8), L.mat(K.gold, { metal: 0.5, rough: 0.35 }), { x: dw - 0.3, y: 1.75, z: 0.14, parent: door });
  L.B(0.5, 0.1, 0.06, L.mat(K.gold, { metal: 0.5, rough: 0.35 }), { x: dw / 2, y: 2.0, z: 0.1, parent: door });
  L.B(3.2, 0.24, 1.4, L.mat('#b9ada0'), { r: 0.05, y: 0.12, z: 0.7, parent: group });
  const mt = ctex(560, 300); { const g = mt.g; g.fillStyle = '#b07a42'; g.fillRect(0, 0, 560, 300); const R = L.rng(3); for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${R() > 0.5 ? '255,220,160' : '70,40,15'},${0.08 + R() * 0.15})`; g.fillRect(R() * 560, R() * 300, 2, 6 + R() * 8); } g.strokeStyle = '#4a2a14'; g.lineWidth = 12; g.strokeRect(18, 18, 524, 264); txt(g, matText, 280, 156, { size: 120, maxW: 470, color: '#3a200e', wear: 0.3 }); mt.t.needsUpdate = true; }
  const doormat = new THREE.Mesh(L.rbox(2.4, 0.07, 1.3, 0), [L.mat('#8a5a2a'), L.mat('#8a5a2a'), L.mat('#ffffff', { map: mt.t, felt: 0.8, scale: 3 }), L.mat('#8a5a2a'), L.mat('#8a5a2a'), L.mat('#8a5a2a')]);
  doormat.position.set(0, 0.275, 0.75); doormat.receiveShadow = true; group.add(doormat);
  const lampG = new THREE.Group(); lampG.position.set(dw / 2 + 0.9, 2.9, 0.1); group.add(lampG);
  L.B(0.3, 0.5, 0.2, L.mat('#2a2a30'), { r: 0.04, parent: lampG }); L.B(0.42, 0.6, 0.42, L.mat('#2a2a30'), { r: 0.04, y: 0.45, z: 0.25, parent: lampG }); L.B(0.32, 0.46, 0.32, L.glowMat('#ffd890', 1.3), { r: 0.02, y: 0.45, z: 0.25, parent: lampG });
  const num = decal(0.8, 0.55, (g, W, H) => { g.fillStyle = '#2a2a30'; rr(g, 0, 0, W, H, H * 0.15); g.fill(); txt(g, number, W / 2, H * 0.55, { size: H * 0.7, color: K.gold, wear: 0 }); }, { ppu: 300 }); num.position.set(-dw / 2 - 0.9, 3.0, 0.02); group.add(num);
  mesh(cyl(0.45, 0.35, 0.8, 16), L.mat(C.terracotta), { x: -dw / 2 - 1.1, y: 0.4, z: 0.6, parent: group });
  L.B(0.9, 1.1, 0.9, L.mat(C.leaf, { scale: 1.6 }), { r: 0.35, x: -dw / 2 - 1.1, y: 1.3, z: 0.6, parent: group });
  const c = { group, door, doormat, anchors: { mat: V(0, 0.31, 0.75), doorway: V(0, 0, -0.4) }, set({ open = 0 } = {}) { door.rotation.y = clamp(open) * 1.65; return c; } };
  return c.set();
}
// cardboard box with flaps. makeDeliveryBox(ctx, { label = 'DELIVERY', icon = 'door', color (sticker) }) origin = bottom centre. set({ open 0..1 })
export function makeDeliveryBox(ctx, { label = 'DELIVERY', icon = 'door', color = K.green, w = 1.7, h = 1.15, d = 1.3 } = {}) {
  const group = new THREE.Group(), km = L.mat(K.kraft, { scale: 1.6 }), kd = L.mat(L.mixHex(K.kraft, '#000', 0.25)), tm = L.mat(L.mixHex(color, '#fff', 0.1), { rough: 0.5, felt: 0.3 });
  L.B(w, h, d, km, { r: 0.04, y: h / 2, parent: group });
  L.B(w - 0.1, 0.02, d - 0.1, kd, { r: 0, y: h - 0.02, parent: group });
  const flap = (px, pz, fw, fd, ox, oz, axis, sgn, y) => { const p = new THREE.Group(); p.position.set(px, y, pz); group.add(p); L.B(fw, 0.04, fd, km, { r: 0.01, x: ox, z: oz, parent: p }); return { p, axis, sgn }; };
  const flaps = [flap(0, d / 2, w, d / 2, 0, -d / 4, 'x', 1, h + 0.02), flap(0, -d / 2, w, d / 2, 0, d / 4, 'x', -1, h + 0.02), flap(-w / 2, 0, w / 2, d, w / 4, 0, 'z', 1, h - 0.005), flap(w / 2, 0, w / 2, d, -w / 4, 0, 'z', -1, h - 0.005)];
  L.B(0.4, 0.015, d / 2, tm, { r: 0, y: 0.03, z: -d / 4, parent: flaps[0].p }); L.B(0.4, 0.015, d / 2, tm, { r: 0, y: 0.03, z: d / 4, parent: flaps[1].p });
  L.B(0.4, h * 0.45, 0.015, tm, { r: 0, y: h - h * 0.225, z: d / 2 + 0.01, parent: group });
  const st = decal(w * 0.82, h * 0.48, (g, W, H) => { g.fillStyle = color; rr(g, 0, 0, W, H, H * 0.14); g.fill(); drawIcon(g, icon, H * 0.5, H / 2, H * 0.6, K.cream); txt(g, label, W / 2 + H * 0.3, H * 0.55, { size: H * 0.48, maxW: W - H * 1.05, color: K.cream, wear: 0 }); }, { ppu: 300, felt: 0.3 });
  st.position.set(0, h * 0.36, d / 2 + 0.02); group.add(st);
  const c = { group, set({ open = 0 } = {}) { const k = smooth(clamp(open)); for (const f of flaps) { const a = k * 2.2 * f.sgn; if (f.axis === 'x') f.p.rotation.x = a; else f.p.rotation.z = a; } return c; } };
  return c.set();
}
// green subscription box with a lift-off lid and a big cream label. makeSubscriptionBox(ctx, { text = 'EVERY MONDAY', brand = 'YOUR BRAND' }) set({ open 0..1 })
export function makeSubscriptionBox(ctx, { text = 'EVERY MONDAY', brand = 'YOUR BRAND', color = K.green, w = 2.6, h = 1.4, d = 1.8 } = {}) {
  const group = new THREE.Group(), bm = L.mat(color, { scale: 1.4 }), lm = L.mat(L.mixHex(color, '#000', 0.12), { scale: 1.4 });
  L.B(w, h, d, bm, { r: 0.06, y: h / 2, parent: group });
  L.B(w - 0.16, 0.02, d - 0.16, L.mat('#1a2a20'), { r: 0, y: h + 0.001, parent: group });
  const lid = new THREE.Group(); lid.position.set(0, h, -d / 2); group.add(lid);
  L.B(w + 0.12, 0.34, d + 0.12, lm, { r: 0.06, y: 0.08, z: d / 2, parent: lid });
  L.B(0.3, 0.36, d + 0.14, L.mat(K.gold, { rough: 0.5 }), { r: 0.03, y: 0.08, z: d / 2, parent: lid });
  const lab = decal(w * 0.86, h * 0.8, (g, W, H) => { L.paperFill(g, W, H, K.cream, 6, 0.6); g.strokeStyle = color; g.lineWidth = H * 0.04; rr(g, H * 0.05, H * 0.05, W - H * 0.1, H * 0.9, H * 0.08); g.stroke();
    drawIcon(g, 'calendar', H * 0.34, H * 0.48, H * 0.4, color); lines(g, splitTwo(text), W / 2 + H * 0.22, H * 0.08, H * 0.66, W - H * 0.85, { color: C.ink, seed: 4 });
    txt(g, brand, W / 2 + H * 0.22, H * 0.83, { size: H * 0.15, maxW: W * 0.6, color, wear: 0 }); }, { ppu: 260, felt: 0.3 });
  lab.position.set(0, h * 0.47, d / 2 + 0.02); group.add(lab);
  const c = { group, lid, set({ open = 0 } = {}) { const k = clamp(open); lid.rotation.x = -smooth(k) * 1.9; lid.position.y = h + Math.sin(k * Math.PI) * 0.25; return c; } };
  return c.set();
}
// phone showing a one-product shop site. makePhoneSite(ctx, { brand, title = 'Fresh coffee', icon = 'cup', logo = icon, cta = 'Order in 1 tap', sub = 'At your door by 8 AM', color })
// origin = bottom centre (stands up), screen faces +Z. set({ tap 0..1 (>0.5 = button pressed, shows 'Ordered!'), glow 0..1 })
function drawSite(g, W, H, { brand, title, icon, logo, cta, sub, color, tapped }) {
  g.fillStyle = '#f7f2e8'; g.fillRect(0, 0, W, H);
  g.fillStyle = color; g.fillRect(0, 0, W, H * 0.17);
  drawIcon(g, logo, W * 0.15, H * 0.095, H * 0.08, K.cream);
  txt(g, brand, W * 0.58, H * 0.1, { size: H * 0.068, maxW: W * 0.66, color: K.cream, wear: 0 });
  const cx = W / 2, cy = H * 0.38; g.fillStyle = L.mixHex(color, '#ffffff', 0.78); g.beginPath(); g.arc(cx, cy, W * 0.3, 0, 7); g.fill();
  drawIcon(g, icon, cx, cy + H * 0.02, W * 0.34, C.ink);
  txt(g, title, W / 2, H * 0.605, { size: H * 0.06, maxW: W * 0.86, color: C.ink, wear: 0 });
  txt(g, sub, W / 2, H * 0.67, { size: H * 0.036, maxW: W * 0.86, color: '#6b6258', wear: 0, font: 'round' });
  const bx = W * 0.07, by = H * 0.74, bw = W * 0.86, bh = H * 0.15;
  g.fillStyle = tapped ? L.mixHex(color, '#000', 0.25) : color; rr(g, bx, by, bw, bh, bh * 0.3); g.fill();
  if (tapped) { drawIcon(g, 'check', bx + bh * 0.55, by + bh / 2, bh * 0.5, K.cream); txt(g, 'Ordered!', W / 2 + bh * 0.25, by + bh * 0.54, { size: bh * 0.44, maxW: bw * 0.7, color: K.cream, wear: 0 }); }
  else txt(g, cta, W / 2, by + bh * 0.54, { size: bh * 0.4, maxW: bw * 0.9, color: K.cream, wear: 0 });
  g.fillStyle = '#d6cfc2'; rr(g, W * 0.35, H * 0.955, W * 0.3, H * 0.012, 4); g.fill();
}
export function makePhoneSite(ctx, { brand = 'YOUR BRAND', title = 'Fresh coffee', icon = 'cup', logo = icon, cta = 'Order in 1 tap', sub = 'At your door by 8 AM', color = K.green, w = 2.6, h = 5.0, d = 0.4 } = {}) {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const bm = L.mat(L.mixHex(color, '#000', 0.2), { rough: 0.8, scale: 1.3 });
  L.B(w, h, d, bm, { r: 0.34, y: h / 2, parent: body });
  L.B(w - 0.16, h - 0.16, 0.06, L.mat('#1c1f24', { rough: 0.55, felt: 0.4 }), { r: 0.26, y: h / 2, z: d / 2 - 0.01, parent: body });
  const sw = w - 0.36, sh = h - 0.5, T = ctex(600, Math.round(600 * sh / sw));
  const scrM = new THREE.MeshBasicMaterial({ map: T.t, color: new THREE.Color(0.86, 0.86, 0.86), toneMapped: false });
  const scr = mesh(rrPlane(sw, sh, 0.2), scrM, { y: h / 2, z: d / 2 + 0.03, cast: false, parent: body });
  L.B(0.6, 0.09, 0.04, L.mat('#111'), { r: 0.04, y: h - 0.4, z: d / 2 + 0.04, parent: body });
  let key = null;
  const c = { group, body, screen: scr, buttonPoint: V(0, 0.25 + sh * (1 - 0.815), d / 2 + 0.05), set({ tap = 0, glow = 0 } = {}) {
    const tapped = tap > 0.5; if (tapped !== key) { key = tapped; drawSite(T.g, T.W, T.H, { brand, title, icon, logo, cta, sub, color, tapped }); T.t.needsUpdate = true; }
    scrM.color.setScalar(0.86 + 0.08 * clamp(glow)); body.position.z = -Math.sin(clamp(tap * 2) * Math.PI) * 0.08; return c; } };
  return c.set();
}
// kraft coffee bag with a coloured label. makePackaging(ctx, { brand, lines: ['Fresh at', 'your door'], color }) origin bottom centre
export function makePackaging(ctx, { brand = 'YOUR BRAND', lines: L0 = ['Fresh at', 'your door'], icon = 'door', color = K.green, w = 1.6, h = 2.2, d = 0.9 } = {}) {
  const group = new THREE.Group(), km = L.mat(K.kraft, { scale: 1.8 }), kd = L.mat(L.mixHex(K.kraft, '#000', 0.18), { scale: 1.8 });
  L.B(w, h, d, km, { r: 0.12, y: h / 2, parent: group });
  L.B(w * 0.98, 0.42, d * 0.5, kd, { r: 0.1, y: h + 0.15, parent: group });
  L.B(w + 0.3, 0.09, 0.12, L.mat('#2a2a30', { rough: 0.5 }), { r: 0.03, y: h + 0.04, z: d * 0.27, parent: group });
  mesh(cyl(0.11, 0.11, 0.04, 16), L.mat('#3a2a20'), { rx: Math.PI / 2, x: w * 0.3, y: h * 0.86, z: d / 2 + 0.01, parent: group });
  const lab = decal(w * 0.84, h * 0.6, (g, W, H) => { g.fillStyle = color; rr(g, 0, 0, W, H, W * 0.08); g.fill(); g.strokeStyle = K.cream; g.lineWidth = W * 0.02; rr(g, W * 0.05, W * 0.05, W * 0.9, H - W * 0.1, W * 0.06); g.stroke();
    drawIcon(g, icon, W / 2, H * 0.22, H * 0.2, K.cream); txt(g, brand, W / 2, H * 0.46, { size: H * 0.14, maxW: W * 0.84, color: K.cream, wear: 0 });
    lines(g, L0, W / 2, H * 0.56, H * 0.36, W * 0.84, { color: '#ffe7b0', wear: 0.05 }); }, { ppu: 300, felt: 0.3 });
  lab.position.set(0, h * 0.45, d / 2 + 0.02); group.add(lab);
  return { group };
}
// video content card (thumbnail + play + title + progress). makeContentCard(ctx, { title: '3-MIN MORNING BREWS', color, tag: 'NEW VIDEO' })
// centre origin, faces +Z. set({ play 0..1 (progress bar; play button fades as it plays) })
export function makeContentCard(ctx, { title = '3-MIN MORNING BREWS', color = K.green, tag = 'NEW VIDEO', w = 3.2, h = 3.9 } = {}) {
  const group = new THREE.Group();
  mesh(rrSlab(w, h, 0.25, 0.14), L.mat(color, { scale: 1.3 }), { parent: group });
  const P = slab(w - 0.3, h - 0.3, { thick: 0.03, paper: K.cream }); P.mesh.position.z = 0.12; group.add(P.mesh);
  let key = -1;
  const draw = (q) => P.draw((g, W, H) => {
    L.paperFill(g, W, H, '#f7f2e8', 9, 0.4);
    const th = H * 0.55, gr = g.createLinearGradient(0, 0, 0, th); gr.addColorStop(0, '#f2c27a'); gr.addColorStop(1, '#b8723e'); g.fillStyle = gr; rr(g, W * 0.04, W * 0.04, W * 0.92, th, W * 0.05); g.fill();
    g.fillStyle = '#6b3f22'; g.fillRect(W * 0.04, th * 0.78, W * 0.92, th * 0.22 + W * 0.04 - 6);
    drawIcon(g, 'cup', W * 0.32, th * 0.6, th * 0.38, '#f6f1e7'); drawIcon(g, 'clock', W * 0.72, th * 0.38, th * 0.32, '#3a2a20');
    g.fillStyle = color; rr(g, W * 0.08, W * 0.08, W * 0.36, H * 0.06, H * 0.02); g.fill(); txt(g, tag, W * 0.26, W * 0.08 + H * 0.032, { size: H * 0.034, maxW: W * 0.32, color: K.cream, wear: 0 });
    const pa = 1 - clamp(q * 4); if (pa > 0) { g.globalAlpha = pa; g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(W / 2, th * 0.5 + W * 0.04, th * 0.2, 0, 7); g.fill(); drawIcon(g, 'play', W / 2 + th * 0.02, th * 0.5 + W * 0.04, th * 0.22, color); g.globalAlpha = 1; }
    g.fillStyle = '#d6cfc2'; rr(g, W * 0.06, th + W * 0.08, W * 0.88, H * 0.022, 6); g.fill(); g.fillStyle = C.no; rr(g, W * 0.06, th + W * 0.08, Math.max(H * 0.022, W * 0.88 * q), H * 0.022, 6); g.fill();
    lines(g, splitTwo(title), W / 2, th + W * 0.1, H - th - W * 0.14, W * 0.9, { color: C.ink, seed: 5 });
  });
  const c = { group, set({ play = 0 } = {}) { const q = Math.round(clamp(play) * 24) / 24; if (q !== key) { key = q; draw(q); } return c; } };
  return c.set();
}
// semicircle gauge. makeMeter(ctx, 'MAYBE?', { left: 'NO', right: 'YES' }) origin floor centre (on a little stand). set({ value 0..1 })
export function makeMeter(ctx, text = 'MAYBE?', { r = 1.6, left = 'NO', right = 'YES', stand = 1.0 } = {}) {
  const group = new THREE.Group(), face = new THREE.Group(); face.position.y = stand + 1.0; group.add(face);
  const hm = L.mat(C.woodDark), half = geo(`halfD${r}`, () => { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI, false); s.lineTo(r, 0); return s; });
  mesh(geo(`halfX${r}`, () => new THREE.ExtrudeGeometry(new THREE.Shape(half.getPoints(40)).clone(), { depth: 0.3, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.06, bevelSegments: 2 }).translate(0, 0, -0.3)), hm, { parent: face });
  const T = ctex(800, 400), g = T.g; L.paperFill(g, 800, 400, C.paper, 5, 0.6);
  const zones = [[C.no, Math.PI, Math.PI * 1.36], ['#e8b53a', Math.PI * 1.36, Math.PI * 1.64], [C.yes, Math.PI * 1.64, Math.PI * 2]];
  for (const [col, a0, a1] of zones) { g.strokeStyle = col; g.lineWidth = 70; g.beginPath(); g.arc(400, 395, 300, a0, a1); g.stroke(); }
  g.strokeStyle = C.ink; g.lineWidth = 6; for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI; g.beginPath(); g.moveTo(400 + Math.cos(a) * 250, 395 + Math.sin(a) * 250); g.lineTo(400 + Math.cos(a) * 225, 395 + Math.sin(a) * 225); g.stroke(); }
  txt(g, left, 150, 330, { size: 56, color: C.no }); txt(g, right, 650, 330, { size: 56, color: C.yes });
  T.t.needsUpdate = true;
  const fg = geo(`halfF${r}`, () => { const gg = new THREE.ShapeGeometry(new THREE.Shape(half.getPoints(40)), 20); const p = gg.attributes.position, uv = gg.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * r) + 0.5, p.getY(i) / r * 0.9875 + 0.0125); return gg; });
  mesh(fg, L.mat('#ffffff', { map: T.t, felt: 0.4 }), { z: 0.13, scale: 0.95, cast: false, parent: face }).scale.setScalar(0.94);
  const needle = new THREE.Group(); needle.position.z = 0.2; face.add(needle);
  L.B(0.12, r * 0.86, 0.06, L.mat(C.ink), { r: 0.03, y: r * 0.43, parent: needle });
  mesh(cyl(0.2, 0.2, 0.12, 18), L.mat(K.gold, { metal: 0.5, rough: 0.35 }), { rx: Math.PI / 2, z: 0.25, parent: face });
  L.B(0.4, stand + 0.2, 0.4, hm, { r: 0.06, y: (stand + 0.2) / 2 + 0.0, z: -0.15, parent: group }); L.B(1.6, 0.2, 1.0, hm, { r: 0.06, y: 0.1, z: -0.15, parent: group });
  const pl = slab(2.9, 0.9, { thick: 0.08 }); pl.mesh.position.set(0, stand + 0.55, 0.15); pl.mesh.rotation.x = -0.12; group.add(pl.mesh);
  pl.draw((gg, W, H) => { L.paperFill(gg, W, H, C.paper, 3); txt(gg, text, W / 2, H * 0.55, { size: H * 0.66, maxW: W * 0.86, color: C.ink }); });
  const c = { group, face, needle, set({ value = 0.5 } = {}) { needle.rotation.z = (0.5 - clamp(value, -0.05, 1.05)) * Math.PI * 0.92; return c; } };
  return c.set();
}
// balance scale. makeScale(ctx, { left: 'OPTION A', right: 'OPTION B', leftColor, rightColor }) origin floor centre.
// set({ tip -1..1 }) (+ = right pan goes DOWN). put things in .panL / .panR (pan top at local y 0)
export function makeScale(ctx, { left = null, right = null, leftColor = K.red, rightColor = K.green, h = 3.6, arm = 2.4 } = {}) {
  const group = new THREE.Group(), bm = L.mat(K.gold, { metal: 0.5, rough: 0.38, scale: 2 }), wd = L.mat(C.woodDark);
  L.B(2.2, 0.3, 1.4, wd, { r: 0.08, y: 0.15, parent: group });
  mesh(cyl(0.12, 0.16, h, 16), bm, { y: h / 2 + 0.3, parent: group });
  mesh(geo('scaleTop', () => new THREE.ConeGeometry(0.22, 0.4, 16)), bm, { y: h + 0.5, parent: group });
  const beam = new THREE.Group(); beam.position.y = h + 0.2; group.add(beam);
  L.B(arm * 2 + 0.3, 0.18, 0.2, bm, { r: 0.06, parent: beam });
  const pan = (s, label, col) => {
    const hold = new THREE.Group(); hold.position.x = s * arm; beam.add(hold);
    mesh(sph(0.12, 10, 8), bm, { parent: hold });
    const p = new THREE.Group(); p.position.y = -2.0; hold.add(p);
    mesh(cyl(1.0, 0.75, 0.18, 28), bm, { y: -0.09, parent: p });
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; rod([0, 2.0, 0], [Math.cos(a) * 0.92, 0.0, Math.sin(a) * 0.92], 0.02, bm, p); }
    if (label) { const lb = decal(1.9, 0.55, (g, W, H) => { g.fillStyle = col; rr(g, 0, 0, W, H, H * 0.2); g.fill(); txt(g, label, W / 2, H * 0.55, { size: H * 0.56, maxW: W * 0.86, color: K.cream, wear: 0 }); }, { ppu: 280, felt: 0.3 }); lb.position.set(0, -0.45, 0.9); p.add(lb); }
    return { hold, p };
  };
  const L1 = pan(-1, left, leftColor), R1 = pan(1, right, rightColor);
  const c = { group, beam, panL: L1.p, panR: R1.p, set({ tip = 0 } = {}) { beam.rotation.z = -clamp(tip, -1, 1) * 0.32; L1.hold.rotation.z = R1.hold.rotation.z = -beam.rotation.z; return c; } };
  return c.set();
}
// archery-style target on an easel. origin floor centre; bullseye at .center (local). set({ hit 0..1 (wobble + flash after a dart lands) })
export function makeTarget(ctx, { r = 1.6, h = 2.8, colors = [C.no, '#f6eedc'] } = {}) {
  const group = new THREE.Group(), face = new THREE.Group(); face.position.y = h; group.add(face);
  mesh(cyl(r + 0.15, r + 0.15, 0.3, 40), L.mat(C.woodDark), { rx: Math.PI / 2, z: -0.1, parent: face });
  const N = 5; for (let i = 0; i < N; i++) mesh(cyl(r * (1 - i / N), r * (1 - i / N), 0.08, 40), L.mat(colors[i % 2], { scale: 2 }), { rx: Math.PI / 2, z: 0.07 + i * 0.012, parent: face });
  const flash = mesh(geo('tgtFlash', () => new THREE.CircleGeometry(1, 32)), L.glowMat('#fff2c2', 1.6, { transparent: true, opacity: 0, depthWrite: false }), { z: 0.2, cast: false, parent: face });
  const wd = L.mat(C.wood); for (const s of [-1, 1]) L.B(0.18, h + 0.4, 0.18, wd, { r: 0.04, x: s * 0.9, y: (h + 0.4) / 2 - 0.2, z: -0.35, rz: s * -0.18, parent: group });
  L.B(0.18, h, 0.18, wd, { r: 0.04, y: h / 2, z: -1.0, rx: -0.3, parent: group });
  const c = { group, face, center: V(0, h, 0.2), set({ hit = 0 } = {}) { const k = clamp(hit); face.rotation.x = Math.sin(k * Math.PI * 7) * (1 - k) * 0.14 * (k > 0 ? 1 : 0); flash.material.opacity = k > 0 ? (1 - k) * 0.45 : 0; flash.scale.setScalar(r * 0.2 + k * r * 0.9); flash.visible = k > 0 && k < 1; return c; } };
  return c.set();
}
// dart pointing -Z, origin = the tip. makeDart(ctx, { color, size })
export function makeDart(ctx, { color = K.green, size = 1 } = {}) {
  const group = new THREE.Group(), inner = new THREE.Group(); inner.scale.setScalar(size); group.add(inner);
  const mm = L.mat('#c9ccd2', { metal: 0.6, rough: 0.3, felt: 0.2 });
  mesh(geo('dartTip', () => new THREE.ConeGeometry(0.06, 0.4, 12)), mm, { rx: -Math.PI / 2, z: 0.2, parent: inner });
  mesh(cyl(0.11, 0.08, 0.6, 14), L.mat(K.gold, { metal: 0.5, rough: 0.35 }), { rx: Math.PI / 2, z: 0.7, parent: inner });
  mesh(cyl(0.04, 0.04, 0.7, 10), L.mat('#2a2a30'), { rx: Math.PI / 2, z: 1.3, parent: inner });
  const fl = geo('dartFlight', () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.38, 0.25); s.lineTo(0.38, 0.75); s.lineTo(0, 0.6); s.closePath(); return new THREE.ShapeGeometry(s); });
  const fm = L.mat(color, { side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) { const p = new THREE.Group(); p.position.z = 1.05; p.rotation.z = (i * Math.PI) / 2; inner.add(p); mesh(fl, fm, { ry: -Math.PI / 2, parent: p }); }
  return { group };
}
// paper label card with a coloured tab band (+ optional icon + sub line). makeLabelCard(ctx, 'STUDENT', { color, sub, icon, w, h, pin })
// centre origin, faces +Z. set({ pop 0..1 })
export function makeLabelCard(ctx, text = 'STUDENT', { color = K.green, sub = null, icon = null, w = 3.0, h = 1.3, pin = false, seed = 2, ink = C.ink } = {}) {
  const group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
  const P = slab(w, h, { thick: 0.05 }); inner.add(P.mesh);
  P.draw((g, W, H) => {
    L.paperFill(g, W, H, C.paper, seed, 0.8); g.fillStyle = color; g.fillRect(0, 0, W, H * 0.11);
    const x0 = icon ? H * 0.82 : 0, tw = W - x0;
    if (icon) { g.fillStyle = color; g.beginPath(); g.arc(H * 0.46, H * 0.56, H * 0.32, 0, 7); g.fill(); drawIcon(g, icon, H * 0.46, H * 0.56, H * 0.36, K.cream); }
    if (sub) { txt(g, text, x0 + tw / 2, H * 0.43, { size: H * 0.36, maxW: tw * 0.88, color: ink, seed }); txt(g, sub, x0 + tw / 2, H * 0.78, { size: H * 0.22, maxW: tw * 0.88, color, seed: seed + 1 }); }
    else txt(g, text, x0 + tw / 2, H * 0.58, { size: H * 0.48, maxW: tw * 0.88, color: ink, seed });
  });
  if (pin) { const p = new THREE.Group(), m = L.mat(color, { rough: 0.4, felt: 0.2 }); mesh(cyl(0.11, 0.11, 0.08, 16), m, { rx: Math.PI / 2, z: 0.07, parent: p }); mesh(sph(0.08, 12, 8), m, { z: 0.15, parent: p }); p.position.set(0, h / 2 - 0.08, 0); inner.add(p); }
  const c = { group, inner, set({ pop: p = 1 } = {}) { const k = clamp(p); inner.visible = k > 0; inner.scale.setScalar(pop(k)); inner.rotation.z = (1 - Math.min(1, k * 1.4)) * 0.4; return c; } };
  return c.set();
}
// chunky headphones prop (sized for a big head: scale ~0.6 on a person). Drop on: person.top.add(hp.group) (rest = worn).
// set({ on 0..1 }) falls from 2.5 above onto the head
export function makeHeadphones(ctx, { color = '#2b2b33', cushion = K.gold } = {}) {
  const group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
  const hm = L.mat(color, { rough: 0.5 });
  const band = mesh(torus(1.16, 0.09, Math.PI, 28), hm, { y: -0.5, parent: inner }); band.scale.y = 0.85;
  for (const s of [-1, 1]) { mesh(cyl(0.38, 0.38, 0.26, 20), hm, { x: s * 1.13, y: -0.56, rz: Math.PI / 2, parent: inner }); mesh(cyl(0.25, 0.25, 0.28, 16), L.mat(cushion), { x: s * 1.16, y: -0.56, rz: Math.PI / 2, parent: inner }); }
  const c = { group, set({ on = 1 } = {}) { const k = clamp(on); inner.position.y = (1 - (k < 1 ? Math.min(1, k * k * 1.1) : 1)) * 2.5 + (k > 0.9 && k < 1 ? Math.sin((k - 0.9) * 31) * 0.06 : 0); group.visible = k > 0; return c; } };
  return c.set();
}
// puffy heart. centre origin, faces +Z. set({ pop 0..1, beat (phase, cycles) })
export function makeHeart(ctx, { size = 1, color = K.heart } = {}) {
  const group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
  const hg = geo('heart', () => { const s = new THREE.Shape(); s.moveTo(0, -0.8); s.bezierCurveTo(-1.1, 0, -0.6, 0.95, 0, 0.4); s.bezierCurveTo(0.6, 0.95, 1.1, 0, 0, -0.8); const e = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelSize: 0.16, bevelThickness: 0.18, bevelSegments: 4, curveSegments: 20 }); e.translate(0, 0, -0.15); return e; });
  mesh(hg, L.mat(color, { emissive: color, ei: 0.15, rough: 0.7, scale: 2 }), { parent: inner }).scale.setScalar(size);
  mesh(plane(0.22 * size, 0.12 * size), L.glowMat('#ffffff', 1.2, { transparent: true, opacity: 0.55 }), { x: -0.42 * size, y: 0.35 * size, z: 0.33, rz: 0.6, cast: false, parent: inner });
  const c = { group, set({ pop: p = 1, beat = 0 } = {}) { const k = clamp(p); inner.visible = k > 0; const b = Math.pow(Math.max(0, Math.sin(beat * Math.PI * 2)), 6) * 0.12; inner.scale.setScalar(pop(k, 3) * (1 + b)); return c; } };
  return c.set();
}
// wooden letter blocks. makeLetterBlocks(ctx, 'CONVENIENCE', { size = 0.9, icons: ['clock','door','phone'], seed })
// origin = floor centre of the finished row; icon blocks sit centred on top of the row. set({ k 0..1 }) blocks fly in + land one by one
export function makeLetterBlocks(ctx, word = 'CONVENIENCE', { size = 0.9, gap = 0.08, icons = [], seed = 4, woods = ['#e9c98f', '#d9a96a'], inks = [K.green, K.red, C.blue, '#c88a12'] } = {}) {
  const group = new THREE.Group(), R = L.rng(seed), blocks = [];
  const make = (draw, i, tx, ty) => {
    const T = ctex(256, 256); L.paperFill(T.g, 256, 256, woods[i % 2], seed + i, 0.5); T.g.strokeStyle = 'rgba(90,50,20,0.35)'; T.g.lineWidth = 10; T.g.strokeRect(14, 14, 228, 228); draw(T.g); T.t.needsUpdate = true;
    const wm = L.mat(woods[i % 2], { scale: 2 }), fm = L.mat('#ffffff', { map: T.t, felt: 0.4 });
    const m = new THREE.Mesh(L.rbox(size, size, size, 0), [wm, wm, wm, wm, fm, wm]); m.castShadow = m.receiveShadow = true;
    const g = new THREE.Group(); g.add(m); group.add(g);
    blocks.push({ g, to: V(tx, ty + size / 2, 0), from: V(tx + (R() - 0.5) * 6, ty + 5 + R() * 4, (R() - 0.5) * 3 + 2), rot: V((R() - 0.5) * 6, (R() - 0.5) * 6, (R() - 0.5) * 6) });
  };
  const n = word.length, rowW = n * size + (n - 1) * gap;
  [...word].forEach((ch, i) => make((g) => txt(g, ch, 128, 136, { size: 190, color: inks[i % inks.length], seed: i, wear: 0.15 }), i, -rowW / 2 + size / 2 + i * (size + gap), 0));
  const iw = icons.length * size * 1.3 + (icons.length - 1) * gap;
  icons.forEach((ic, j) => make((g) => drawIcon(g, ic, 128, 128, 150, inks[j % inks.length]), n + j, -iw / 2 + size * 0.65 + j * (size * 1.3 + gap), size));
  icons.forEach((_, j) => blocks[n + j].g.scale.setScalar(1.3));
  const total = blocks.length;
  const c = { group, blocks, width: rowW, set({ k = 1 } = {}) {
    blocks.forEach((b, i) => {
      const st = (i / total) * 0.6, q = clamp((k - st) / 0.4); b.g.visible = q > 0;
      const e = smooth(clamp(q / 0.8)), land = q > 0.8 ? Math.sin((q - 0.8) / 0.2 * Math.PI) * 0.15 : 0;
      b.g.position.lerpVectors(b.from, b.to, e); b.g.position.y += land;
      b.g.rotation.set(b.rot.x * (1 - e), b.rot.y * (1 - e), b.rot.z * (1 - e));
    }); return c; } };
  return c.set();
}
