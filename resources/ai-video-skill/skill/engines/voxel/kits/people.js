// people.js: chunky felt TOY PEOPLE for the voxel engine + a ready cast + crowd extras.
// Big blocky head (~40% of height), rounded box torso, stubby legs, mitten hands, canvas-drawn eyes / lids / mouth,
// 3D felt brows + nose + ears, soft blush. All felt materials from base.js. Original design (no studs, no C-hands, no pixel faces).
//   import { makePerson, makeActor, namedPerson, extraPerson, makeCrowd, PEOPLE, SKIN, HAIR, EXPR } from '/engine/kits/people.js';
//
// Units: height-1 person = ~2.6 tall (makeActor / namedPerson / extraPerson wrap it at scale 0.93 = ~2.4). Floor y = 0, faces +Z.
// armR / reachR / holdR = the arm on the +X side = SCREEN RIGHT when the person faces the camera (anatomically their LEFT hand).
// TURNED people (turn = body yaw): turn > 0 (facing screen right) swings the R hand to the FAR side (behind the body, hidden from
// the camera) and brings the L hand to the camera side; turn < 0 (facing screen left) puts the R hand on the camera side.
// At turn 180 (back to camera) R is on screen LEFT. So in profile, hold / point with the camera-side hand:
// facing right -> holdL / armL, facing left -> holdR / armR.
//
// makePerson(ctx, {
//   skin: SKIN.brown,            // any css colour. SKIN: porcelain light fair tan olive medium brown deep ebony
//   height: 1, width: 1,         // 0.85..1.15 / 0.8..1.25 (head size stays constant so faces read equally)
//   build: 'regular',            // 'regular'|'slim'|'broad'|'curvy'|'round'|'petite'
//   eyeColor, seed,              // seed = curl layout for curly/afro hair
//   hair: { style, color, beard, beardColor, browColor },   // style 'short'|'buzz'|'long'|'bun'|'ponytail'|'curly'|'afro'|'bob'|'bald'|'slick'
//                                // beard 'none'|'stubble'|'moustache'|'goatee'|'full'. HAIR: black brown chestnut auburn ginger blonde platinum grey white blue pink
//   hairTieColor,
//   outfit: { top, color, shirt, apron, stripe, pants, shoes, neck, neckColor, badge, pocketSquare },
//        // top 'suit'|'blazer'|'hoodie'|'shirt'|'sweater'|'apron'|'jumpsuit'|'raincoat'; neck 'none'|'tie'|'bowtie'|'lanyard'|'scarf'
//   accessories: [...],          // 'glasses','headset','headphones','beanie','cap','earrings','watch'
//   glassesStyle: 'round'|'square', glassesColor, lenses, hatColor, pomColor, capBadge, phonesColor, cushionColor, earringColor, watchColor,
// }) -> { group, rig, body, head, face, top, acc, arms{L,R}, elbows, hands{L,R}, legs, mats, height, set, holdR, holdL, focus, handWorld }
//
// p.set({...}) EVERY frame (all optional, degrees, missing = rest):
//   hop (units up) · squash (+1 flat & wide .. -0.3 stretched, pivot at the feet) · tilt (roll, + to screen right) · lean (pitch, + forward)
//   turn (yaw) · nod (+ forward) · headTilt · lookX, lookY (-1..1: pupils slide, head yaws 22 / pitches 10)
//   armL, armR (0 hanging .. 180 straight up) · reachL, reachR (swing forward 0..90+) · elbowL, elbowR (0..150)
//   waveL, waveR (0..1 hello wave, needs t) · cross (0..1 arms folded) · walk (phase: legs step, arms swing) · t (clock for wave / sway)
//   expr: 'neutral'|'happy'|'shock'|'sad'|'determined'|'wink' (or a custom object like EXPR.*) · blink 0..1 · talk 0..1
//   mouth: 'smile'|'open'|'teeth'|'o'|'frown'|'grit'|'flat'|'smirk'|'tongue'|'none' · brow (deg, + angry / - worried) · eye (scale)
// POINTING: armR 10-30 + reachR 70-90 points forward; armR 120-150 + reachR 30-40 points up-and-out at a sign beside/above.
// p.holdR(obj, [x,y,z]) / p.holdL(...)   parent a prop to the mitten; it stays upright while the arm moves.
// p.focus()                               world point between the eyes (ctx.focus = p.focus()).   p.top = group at the top of the hair (hats).
// p.handWorld('R'|'L', out?)              world position of that mitten NOW (call after set() this frame): aim lines, hand-offs,
//                                         attach a prop that must not follow the arm, put the focus on a held item.
// Hold offsets are in UPRIGHT BODY axes (the hand counter-rotates), not along the arm. OVERHEAD LIFT: the head is ~40 % of the
// body, so even armR 175-180 (elbowR ~10) leaves the mitten only at ~eye height beside the head (actor: hand y ~1.7, head top
// ~2.4, ~2.7 with tall hair). To show a prop ABOVE the head, hold it with a lift offset: holdR(obj, [-0.6, 1.0, 0.1]) (x toward the head centre,
// mirror x for holdL); for a two-hand lift raise both arms (~165) and parent the prop to p.group at y ~ height + 0.3 instead.
//
// makeActor(ctx, opts)   makePerson wrapped in a scaled group (opts.scale, default 0.93) with a simpler face API:
//   set() also takes mouth ('teeth'|'smile'|'flat'|'o'|'frown'|'none', picks a matching expression), mouthOpen (0..1 -> talk),
//   brow (+ determined / - worried). Returns {...person, group (wrapper), person, height, set, setMouth(m)}.
// PEOPLE: 10 named presets (marco alex sam kai jordan mei zara jade diane grace).  namedPerson(ctx, 'mei', {mouth}) -> actor
// extraPerson(ctx, seed, overrides) -> actor   varied crowd extra (skin, hair, build, outfit colour all from seed); never a clone of a preset.
// makeCrowd(ctx, n, {seed, spacing, rows, depth}) -> { group, people[], set(fn(i, person) -> pose) }   quick crowd block
//
// FRAMING (1080x1920, fov 30-40): face close-up ~4.5 from the face, target at eye height (~2.2 for an actor);
// waist-up two-shot 6.5-7.5 away; full body 8-10 away, target y ~1.6. Keep anything in front of a person below ~1.3 (hides the mouth).
import * as THREE from 'three';
import * as L from './base.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const rad = (d) => (d * Math.PI) / 180;

export const SKIN = {
  porcelain: '#f7dcc8', light: '#f2c9a6', fair: '#e9b48b', tan: '#d89c6c', olive: '#c48b58',
  medium: '#b0764a', brown: '#8e5634', deep: '#6b3d22', ebony: '#4b2a17',
};
export const HAIR = {
  black: '#231c1a', brown: '#5b3620', chestnut: '#7d4425', auburn: '#9c3b1f', ginger: '#d36a2c',
  blonde: '#e9c25e', platinum: '#efe3c4', grey: '#a19d98', white: '#eeeae2', blue: '#3f6fd8', pink: '#e77fa8',
};

// top = upper lid 0..1, ang = lid tilt (+ cross / - worried), low = lower lid (smile squint), pr = iris radius px,
// eye = eye scale, brow = deg (+ inner end down = angry), by = brow lift, mouth = shape, ly = pupil y, cheek = blush scale
export const EXPR = {
  neutral:    { top: 0.12, ang: 0,   low: 0.04, pr: 64, eye: 1.0,  brow: 0,   by: 0,     mouth: 'smile', ly: 0,     cheek: 0.8 },
  happy:      { top: 0.04, ang: -4,  low: 0.38, pr: 66, eye: 1.0,  brow: -10, by: 0.04,  mouth: 'open',  ly: 0.05,  cheek: 1.15 },
  shock:      { top: 0.0,  ang: 0,   low: 0.0,  pr: 40, eye: 1.22, brow: -6,  by: 0.12,  mouth: 'o',     ly: 0,     cheek: 0.7 },
  sad:        { top: 0.34, ang: -22, low: 0.0,  pr: 64, eye: 0.97, brow: -24, by: 0.02,  mouth: 'frown', ly: -0.4,  cheek: 0.6 },
  determined: { top: 0.34, ang: 22,  low: 0.14, pr: 56, eye: 1.0,  brow: 22,  by: -0.05, mouth: 'grit',  ly: 0,     cheek: 0.8 },
  wink:       { top: 0.04, ang: -4,  low: 0.38, pr: 66, eye: 1.0,  brow: -10, by: 0.04,  mouth: 'smirk', ly: 0.05,  cheek: 1.15, wink: 1 },
};
export const MOUTHS = ['smile', 'open', 'teeth', 'o', 'frown', 'grit', 'flat', 'smirk', 'tongue', 'none'];

function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t, key: '' };
}
let BLUSH = null;
function blushTex() {
  if (BLUSH) return BLUSH;
  const T = canvasTex(64, 64), g = T.g, gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); BLUSH = T.t; return BLUSH;
}

// eye canvas 256x256 (shown on an oval plane). s.closed: 0 open, 1 blink lash line, 2 happy '^' (wink)
function drawEye(E, s, side) {
  const key = [s.top, s.ang, s.low, s.pr, s.lx, s.ly, s.closed].map((v) => Math.round(v * 40) / 40).join(',');
  if (key === E.key) return; E.key = key;
  const g = E.g, P = E.pal, inner = -side;
  g.clearRect(0, 0, 256, 256);
  g.save(); g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.clip();
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (s.closed) {
    g.fillStyle = P.lid; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = P.line; g.lineWidth = 20;
    if (s.closed === 2) {   // happy closed eye: an upward arc
      g.beginPath(); g.moveTo(50, 158); g.quadraticCurveTo(128, 66, 206, 158); g.stroke();
    } else {                // blink: a soft downward lash line with three little lashes
      const p0 = [40, 112], c = [128, 190], p1 = [216, 112];
      g.beginPath(); g.moveTo(...p0); g.quadraticCurveTo(...c, ...p1); g.stroke();
      g.lineWidth = 11;
      for (const k of [0.22, 0.5, 0.78]) {
        const u = 1 - k, x = u * u * p0[0] + 2 * u * k * c[0] + k * k * p1[0], y = u * u * p0[1] + 2 * u * k * c[1] + k * k * p1[1];
        const dx = (k - 0.5) * 34;
        g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + dx, y + 34); g.stroke();
      }
    }
  } else {
    const wg = g.createRadialGradient(116, 104, 20, 128, 128, 140); wg.addColorStop(0, '#fffdf8'); wg.addColorStop(0.78, '#efe7da'); wg.addColorStop(1, '#d6c8b6');
    g.fillStyle = wg; g.fillRect(0, 0, 256, 256);
    const px = 128 + s.lx * 44 + inner * 6, py = 136 - s.ly * 44, pr = s.pr;
    g.fillStyle = P.iris; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.pupil; g.beginPath(); g.arc(px, py, pr * 0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(px - pr * 0.34, py - pr * 0.38, Math.max(10, pr * 0.3), 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(px + pr * 0.34, py + pr * 0.3, Math.max(5, pr * 0.12), 0, Math.PI * 2); g.fill();
    const y0 = -8 + s.top * 266, tn = Math.tan(rad(s.ang));
    if (s.top > 0.01 || Math.abs(s.ang) > 0.5) {
      const yl = (x) => y0 + tn * (x - 128) * inner;
      g.fillStyle = P.lid; g.beginPath(); g.moveTo(0, -10); g.lineTo(256, -10); g.lineTo(256, yl(256)); g.lineTo(0, yl(0)); g.closePath(); g.fill();
      g.strokeStyle = P.line; g.lineWidth = 14; g.beginPath(); g.moveTo(0, yl(0)); g.lineTo(256, yl(256)); g.stroke();
    }
    if (s.low > 0.01) {
      const rr = 210, cy = 256 + rr - s.low * 170;
      g.fillStyle = P.lid; g.beginPath(); g.arc(128, cy, rr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = P.line; g.lineWidth = 9; g.beginPath(); g.arc(128, cy, rr, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
    }
  }
  g.strokeStyle = P.line; g.lineWidth = 12; g.globalAlpha = 0.85; g.beginPath(); g.arc(128, 128, 122, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  g.restore();
  E.t.needsUpdate = true;
}

// mouth canvas 256 x 160, transparent
function drawMouth(M, shape, open) {
  const key = shape + Math.round(open * 12); if (key === M.key) return; M.key = key;
  const g = M.g; g.clearRect(0, 0, 256, 160);
  const ink = M.ink, tongue = '#ea6f80', teeth = '#fbf6ee';
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (shape === 'none') { M.t.needsUpdate = true; return; }
  if (shape === 'smile' && open > 0.15) shape = 'open';
  if (shape === 'flat' && open > 0.15) shape = 'o';
  if (shape === 'o') {
    const h = 30 + open * 22;
    g.fillStyle = ink; g.beginPath(); g.ellipse(128, 80, 28 + open * 6, h, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = tongue; g.beginPath(); g.ellipse(128, 80 + h * 0.55, 18, h * 0.32, 0, 0, Math.PI * 2); g.fill();
  } else if (shape === 'frown') {
    g.strokeStyle = ink; g.lineWidth = 15; g.beginPath(); g.moveTo(84, 104); g.quadraticCurveTo(128, 60 - open * 18, 172, 104); g.stroke();
  } else if (shape === 'flat') {
    g.strokeStyle = ink; g.lineWidth = 14; g.beginPath(); g.moveTo(92, 78); g.lineTo(164, 78); g.stroke();
  } else if (shape === 'smirk') {
    g.strokeStyle = ink; g.lineWidth = 14; g.beginPath(); g.moveTo(84, 74); g.quadraticCurveTo(136, 100, 178, 58); g.stroke();
  } else if (shape === 'grit') {
    const h = 26 + open * 24;
    g.fillStyle = ink; g.beginPath(); g.roundRect(70, 78 - h / 2, 116, h, 12); g.fill();
    g.fillStyle = teeth; g.beginPath(); g.roundRect(76, 78 - h / 2 + 4, 104, Math.max(10, h - 8), 6); g.fill();
    g.strokeStyle = ink; g.lineWidth = 4; g.beginPath(); g.moveTo(76, 78); g.lineTo(180, 78); g.stroke();
    for (const x of [102, 128, 154]) { g.beginPath(); g.moveTo(x, 78 - h / 2); g.lineTo(x, 78 + h / 2); g.stroke(); }
  } else if (shape === 'smile') {
    g.strokeStyle = ink; g.lineWidth = 14; g.beginPath(); g.moveTo(86, 58); g.quadraticCurveTo(128, 108, 170, 58); g.stroke();
  } else if (shape === 'teeth') {   // big toothy grin
    const h = 30 + open * 30;
    g.fillStyle = ink; g.beginPath(); g.moveTo(58, 44); g.quadraticCurveTo(128, 50, 198, 44); g.quadraticCurveTo(190, 44 + h * 1.6, 128, 44 + h * 1.4); g.quadraticCurveTo(66, 44 + h * 1.6, 58, 44); g.closePath(); g.fill();
    g.save(); g.clip();
    g.fillStyle = tongue; g.beginPath(); g.ellipse(128, 44 + h * 1.5, 40, h * 0.45, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = teeth; g.fillRect(56, 38, 144, 26);
    g.strokeStyle = '#d9cfc2'; g.lineWidth = 3; for (const x of [92, 116, 140, 164]) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, 64); g.stroke(); }
    g.restore();
  } else {   // 'open' D-shaped smile with tongue; 'tongue' pokes it out
    const h = 26 + open * 40 + (shape === 'tongue' ? 6 : 0);
    g.fillStyle = ink; g.beginPath(); g.moveTo(70, 46); g.quadraticCurveTo(128, 52, 186, 46); g.quadraticCurveTo(178, 46 + h * 1.6, 128, 46 + h * 1.45); g.quadraticCurveTo(78, 46 + h * 1.6, 70, 46); g.closePath(); g.fill();
    g.save(); g.clip();
    g.fillStyle = tongue; g.beginPath(); g.ellipse(shape === 'tongue' ? 140 : 128, 46 + h * 1.45, 36, h * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = teeth; g.fillRect(76, 40, 104, 12);
    g.restore();
    if (shape === 'tongue') { g.fillStyle = tongue; g.beginPath(); g.roundRect(122, 46 + h * 1.2, 36, 30, 14); g.fill(); }
  }
  M.t.needsUpdate = true;
}

const BUILDS = {
  regular: { chest: 1, hip: 1, depth: 1 },
  slim: { chest: 0.9, hip: 0.9, depth: 0.92 },
  broad: { chest: 1.18, hip: 0.98, depth: 1.04 },
  curvy: { chest: 0.97, hip: 1.14, depth: 1 },
  round: { chest: 1.08, hip: 1.12, depth: 1.22 },
  petite: { chest: 0.92, hip: 0.96, depth: 0.94 },
};
const TOP_DEFAULTS = {
  suit: { color: '#2b3557', pants: null, tucked: false },
  blazer: { color: '#3d6f8f', pants: '#c9b79a', tucked: false },
  hoodie: { color: '#e0674c', pants: '#2e3550', tucked: false },
  shirt: { color: '#8fb8e8', pants: '#2e3550', tucked: true },
  sweater: { color: '#d9a93a', pants: '#3a4a5c', tucked: false },
  apron: { color: '#f3eee4', pants: '#3a3230', tucked: true },
  jumpsuit: { color: '#e08a2e', pants: null, tucked: false },
  raincoat: { color: '#f2c230', pants: '#2e3550', tucked: false },
};

export function makePerson(ctx, o = {}) {
  const hgt = clamp(o.height ?? 1, 0.85, 1.15), wd = clamp(o.width ?? 1, 0.8, 1.25);
  const bd = BUILDS[o.build ?? 'regular'] ?? BUILDS.regular;
  const skin = o.skin ?? SKIN.tan;
  const hair = { style: 'short', color: HAIR.brown, beard: 'none', ...(typeof o.hair === 'string' ? { style: o.hair } : o.hair ?? {}) };
  const topKind = (o.outfit?.top ?? 'shirt');
  const TD = TOP_DEFAULTS[topKind] ?? TOP_DEFAULTS.shirt;
  const fit = { top: topKind, color: TD.color, shirt: '#f6f1e6', apron: '#2f6b4f', stripe: null, shoes: '#2c221d', neck: 'none', neckColor: '#d8433a', badge: '#3a5bd0', ...(o.outfit ?? {}) };
  fit.pants = o.outfit?.pants ?? TD.pants ?? fit.color;
  const acc = new Set(o.accessories ?? []);
  const seed = o.seed ?? 1;

  // ---- dimensions ----
  const LEG = 0.5 * hgt * hgt;                          // hip joint height
  const CW = 1.04 * wd * bd.chest, HPW = 1.0 * wd * bd.hip, CD = 0.68 * bd.depth;
  const CH = 0.62 * hgt;                                // chest block height
  const TT = 0.2 + CH;                                  // torso top (body-local)
  const HW = 1.2, HH = 1.06, HD = 1.04;                 // head
  const EY = 0.55, EX = 0.25, ER = 0.17;                // eye centre y/x, radius

  // ---- materials ----
  const darker = (c, k = 0.2) => L.mixHex(c, '#1a0e08', k);
  const skinM = L.mat(skin, { rough: 0.85, felt: 0.6, scale: 1.6 });
  const noseM = L.mat(L.mixHex(skin, '#c0503a', 0.12), { rough: 0.85, felt: 0.6, scale: 1.6 });
  const topM = L.mat(fit.color, { rough: 0.95, scale: 1.4 });
  const topDM = L.mat(darker(fit.color, 0.22), { rough: 0.95, scale: 1.4 });
  const shirtM = L.mat(fit.shirt, { rough: 0.9, felt: 0.5 });
  const pantsM = L.mat(fit.pants, { rough: 0.95, scale: 1.4 });
  const shoeM = L.mat(fit.shoes, { rough: 0.6, felt: 0.5 });
  const soleM = L.mat(L.mixHex(fit.shoes, '#f1e9dc', 0.7), { rough: 0.8, felt: 0.4 });
  const hairM = L.mat(hair.style === 'buzz' ? L.mixHex(hair.color, skin, 0.3) : hair.color, { rough: 0.9, scale: 1.8 });
  const beardM = L.mat(hair.beardColor ?? hair.color, { rough: 0.95, scale: 2 });
  const browM = L.mat(hair.style === 'bald' && !hair.beardColor ? L.mixHex(hair.color, '#1a120e', 0.3) : (hair.browColor ?? darker(hair.color, 0.15)), { rough: 0.9, felt: 0.5 });
  const goldM = L.mat('#e0b24a', { rough: 0.35, metal: 0.5, felt: 0.2 });

  const group = new THREE.Group(), rig = new THREE.Group(); group.add(rig);
  const body = new THREE.Group(); body.position.y = LEG; rig.add(body);

  // ---- legs (hip pivots on the rig, so the torso can nod over them) ----
  const legs = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(s * (HPW / 2 - 0.2), LEG, 0); rig.add(p);
    const lh = LEG - 0.1;
    L.B(0.32, lh + 0.06, 0.36, topKind === 'jumpsuit' ? topM : pantsM, { r: 0.1, y: -lh / 2 + 0.03, parent: p });
    if (topKind === 'jumpsuit') L.B(0.34, 0.08, 0.38, topDM, { r: 0.03, y: -lh + 0.06, parent: p });
    L.B(0.34, 0.15, 0.48, shoeM, { r: 0.07, y: -LEG + 0.1, z: 0.07, parent: p });
    L.B(0.35, 0.05, 0.49, soleM, { r: 0.02, y: -LEG + 0.025, z: 0.07, parent: p });
    legs.push(p);
  }

  // ---- torso ----
  const tucked = TD.tucked;
  const hipM = tucked ? pantsM : (topKind === 'jumpsuit' ? topM : topM);
  L.B(HPW, 0.4, CD * 0.96, hipM, { r: 0.14, y: 0.12, parent: body });
  L.B(CW, CH, CD, topM, { r: 0.17, y: 0.2 + CH / 2, parent: body });
  if (o.build === 'round') L.B(CW * 0.8, CH * 0.7, 0.2, topM, { r: 0.1, y: 0.2 + CH * 0.38, z: CD / 2 - 0.02, parent: body });
  L.B(0.36, 0.16, 0.36, skinM, { r: 0.08, y: TT + 0.03, parent: body });   // neck
  const front = CD / 2 + (o.build === 'round' ? 0.08 : 0);
  const belt = () => {
    const bm = L.mat('#2a1e18', { rough: 0.6, felt: 0.4 });
    L.B(HPW + 0.02, 0.08, CD * 0.96 + 0.02, bm, { r: 0.03, y: 0.27, parent: body });
    L.B(0.14, 0.1, 0.04, goldM, { r: 0.02, y: 0.27, z: CD * 0.48 + 0.02, parent: body });
  };
  const collar = (m, spread = 0.5) => {
    for (const s of [-1, 1]) L.B(0.22, 0.11, 0.05, m, { r: 0.03, x: s * 0.12, y: TT - 0.04, z: front + 0.01, rz: -s * spread, parent: body });
  };
  const vee = (m, w = 0.44, h = 0.46) => {
    const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, -h); sh.closePath();
    const me = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }), m); me.position.set(0, TT - 0.01, front - 0.005); body.add(me); return me;
  };
  const hood = () => L.B(CW * 0.78, 0.3, 0.3, topM, { r: 0.13, y: TT - 0.02, z: -CD / 2 - 0.08, parent: body });
  let cuffM = null;
  if (topKind === 'suit' || topKind === 'blazer') {
    vee(shirtM);
    const lap = topDM;
    for (const s of [-1, 1]) L.B(0.11, 0.52, 0.04, lap, { r: 0.03, x: s * 0.14, y: TT - 0.23, z: front + 0.01, rz: s * 0.44, parent: body });
    collar(shirtM, 0.6);
    for (const y of [TT - 0.54, TT - 0.7]) if (y > 0.12) L.B(0.08, 0.08, 0.04, topDM, { r: 0.03, y, z: front + 0.01, parent: body });
    L.B(0.24, 0.05, 0.03, topDM, { r: 0.015, x: -CW * 0.27, y: TT - 0.3, z: front + 0.01, parent: body });   // breast pocket
    if (o.outfit?.pocketSquare) L.B(0.12, 0.07, 0.03, L.mat(o.outfit.pocketSquare), { r: 0.02, x: -CW * 0.27, y: TT - 0.25, z: front + 0.015, parent: body });
    cuffM = shirtM;
  } else if (topKind === 'hoodie') {
    hood();
    L.B(CW * 0.6, 0.24, 0.04, topDM, { r: 0.05, y: 0.32, z: front, parent: body });
    for (const s of [-1, 1]) L.B(0.04, 0.24, 0.03, L.mat('#f3eee4', { felt: 0.3 }), { r: 0.01, x: s * 0.11, y: TT - 0.17, z: front + 0.01, parent: body });
    L.B(0.46, 0.07, 0.05, topDM, { r: 0.03, y: TT - 0.02, z: front - 0.01, parent: body });
    L.B(HPW + 0.02, 0.1, CD * 0.96 + 0.02, topDM, { r: 0.04, y: -0.04, parent: body });
    cuffM = topDM;
  } else if (topKind === 'sweater') {
    if (fit.neck === 'tie' || fit.neck === 'none') collar(shirtM, 0.45);
    L.B(0.48, 0.08, 0.06, topDM, { r: 0.03, y: TT - 0.03, z: front - 0.02, parent: body });
    L.B(HPW + 0.02, 0.1, CD * 0.96 + 0.02, topDM, { r: 0.04, y: -0.04, parent: body });
    if (fit.stripe) L.B(CW + 0.01, 0.11, CD + 0.01, L.mat(fit.stripe), { r: 0.05, y: 0.2 + CH * 0.5, parent: body });
    cuffM = topDM;
  } else if (topKind === 'shirt') {
    collar(L.mat(L.mixHex(fit.color, '#ffffff', 0.25), { felt: 0.6 }), 0.5);
    L.B(0.05, CH - 0.12, 0.02, topDM, { r: 0.01, y: 0.2 + CH / 2 - 0.04, z: front, parent: body });
    for (let i = 0; i < 3; i++) L.B(0.05, 0.05, 0.03, shirtM, { r: 0.02, y: TT - 0.16 - i * 0.16, z: front + 0.01, parent: body });
    L.B(0.2, 0.17, 0.03, topDM, { r: 0.03, x: -CW * 0.26, y: TT - 0.25, z: front, parent: body });
    belt();
  } else if (topKind === 'apron') {
    collar(L.mat(L.mixHex(fit.color, '#ffffff', 0.3), { felt: 0.6 }), 0.5);
    const am = L.mat(fit.apron, { rough: 0.95, scale: 1.4 }), aTop = 0.2 + CH * 0.74, aBot = -0.2;
    L.B(CW * 0.8, aTop - aBot, 0.05, am, { r: 0.04, y: (aTop + aBot) / 2, z: front + 0.02, parent: body });
    for (const s of [-1, 1]) L.B(0.06, TT - aTop + 0.06, 0.04, am, { r: 0.015, x: s * 0.2, y: (TT + aTop) / 2, z: front + 0.01, rz: s * 0.3, parent: body });
    L.B(HPW + 0.03, 0.07, CD * 0.96 + 0.03, am, { r: 0.03, y: 0.3, parent: body });
    L.B(0.4, 0.18, 0.03, L.mat(darker(fit.apron, 0.18)), { r: 0.03, y: 0.06, z: front + 0.05, parent: body });
    belt();
  } else if (topKind === 'jumpsuit') {
    collar(topDM, 0.55);
    L.B(0.04, CH - 0.1, 0.02, L.mat('#cfcac2', { metal: 0.3, felt: 0.2 }), { r: 0.01, y: 0.2 + CH / 2 - 0.04, z: front, parent: body });
    L.B(HPW + 0.02, 0.09, CD * 0.96 + 0.02, topDM, { r: 0.03, y: 0.24, parent: body });
    L.B(0.22, 0.18, 0.03, topDM, { r: 0.03, x: -CW * 0.26, y: TT - 0.25, z: front, parent: body });
    cuffM = topDM;
  } else if (topKind === 'raincoat') {
    hood();
    collar(topM, 0.7);
    L.B(HPW + 0.12, 0.34, CD + 0.08, topM, { r: 0.12, y: -0.16, parent: body });
    for (let i = 0; i < 3; i++) L.B(0.12, 0.05, 0.04, L.mat('#f3e6c8'), { r: 0.02, x: 0.06, y: TT - 0.2 - i * 0.2, z: front + 0.01, parent: body });
    L.B(0.04, CH + 0.3, 0.02, topDM, { r: 0.01, x: 0.0, y: 0.2 + CH / 2 - 0.16, z: front, parent: body });
    cuffM = topDM;
  }
  if (!tucked && topKind !== 'raincoat' && topKind !== 'hoodie' && topKind !== 'sweater' && topKind !== 'jumpsuit') {
    // jacket hem line
    L.B(HPW + 0.01, 0.05, CD * 0.96 + 0.01, topDM, { r: 0.02, y: -0.06, parent: body });
  }

  // ---- neckwear ----
  const A = {};
  const accG = (name, parent) => { const g = new THREE.Group(); parent.add(g); A[name] = g; return g; };
  const nc = fit.neckColor;
  if (fit.neck === 'tie') {
    const g = accG('tie', body), tm = L.mat(nc, { rough: 0.7 }), sm = L.mat(darker(nc, 0.2));
    L.B(0.13, 0.11, 0.07, tm, { r: 0.03, y: TT - 0.07, z: front + 0.04, parent: g });
    const sh = new THREE.Shape(); sh.moveTo(-0.06, 0); sh.lineTo(0.06, 0); sh.lineTo(0.1, -0.34); sh.lineTo(0, -0.43); sh.lineTo(-0.1, -0.34); sh.closePath();
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 }), tm);
    blade.position.set(0, TT - 0.11, front + 0.01); blade.castShadow = true; g.add(blade);
    for (const y of [-0.14, -0.27]) L.B(0.17, 0.035, 0.03, sm, { r: 0.01, y: TT - 0.11 + y, z: front + 0.05, rz: 0.45, parent: g });
  } else if (fit.neck === 'bowtie') {
    const g = accG('bowtie', body), bm = L.mat(nc);
    const w = new THREE.ConeGeometry(0.11, 0.2, 4).rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) { const m = new THREE.Mesh(w, bm); m.position.set(s * 0.1, TT - 0.07, front + 0.05); if (s > 0) m.rotation.z = Math.PI; m.castShadow = true; g.add(m); }
    L.B(0.09, 0.09, 0.08, bm, { r: 0.03, y: TT - 0.07, z: front + 0.06, parent: g });
  } else if (fit.neck === 'lanyard') {
    const g = accG('lanyard', body), lm = L.mat(nc, { felt: 0.5 });
    for (const s of [-1, 1]) L.B(0.05, 0.42, 0.03, lm, { r: 0.01, x: s * 0.1, y: TT - 0.2, z: front + 0.02, rz: s * 0.22, parent: g });
    const badge = new THREE.Group(); badge.position.set(0, TT - 0.5, front + 0.04); g.add(badge);
    L.B(0.26, 0.32, 0.03, L.mat('#f7f3ea', { felt: 0.3 }), { r: 0.03, parent: badge });
    L.B(0.26, 0.08, 0.035, L.mat(fit.badge, { felt: 0.3 }), { r: 0.02, y: 0.12, parent: badge });
    L.B(0.12, 0.12, 0.035, L.mat(L.mixHex(skin, '#ffffff', 0.2), { felt: 0.3 }), { r: 0.02, y: -0.01, parent: badge });
    L.B(0.16, 0.03, 0.035, L.mat('#8a837a', { felt: 0.3 }), { r: 0.01, y: -0.11, parent: badge });
    A.badge = badge;
  } else if (fit.neck === 'scarf') {
    const g = accG('scarf', body), sm = L.mat(nc, { rough: 1, scale: 2.2 }), sd = L.mat(darker(nc, 0.15), { rough: 1, scale: 2.2 });
    L.B(0.62, 0.2, 0.62, sm, { r: 0.09, y: TT + 0.04, parent: g });
    L.B(0.2, 0.46, 0.08, sm, { r: 0.05, x: 0.16, y: TT - 0.2, z: front + 0.04, rz: 0.08, parent: g });
    for (const y of [-0.3, -0.38]) L.B(0.21, 0.03, 0.09, sd, { r: 0.01, x: 0.15, y: TT + y, z: front + 0.04, rz: 0.08, parent: g });
  }

  // ---- arms ----
  const sleeveM = topKind === 'apron' ? topM : topM;
  const arm = (side) => {
    const p = new THREE.Group(); p.position.set(side * (CW / 2 + 0.1), TT - 0.15, 0); body.add(p);
    L.B(0.26, 0.36, 0.28, sleeveM, { r: 0.11, y: -0.14, parent: p });
    const el = new THREE.Group(); el.position.y = -0.3; p.add(el);
    L.B(0.24, 0.3, 0.26, sleeveM, { r: 0.1, y: -0.12, parent: el });
    if (cuffM) L.B(0.25, 0.07, 0.27, cuffM, { r: 0.03, y: -0.26, parent: el });
    const mit = new THREE.Group(); mit.position.y = -0.3; el.add(mit);
    L.B(0.28, 0.27, 0.24, skinM, { r: 0.11, y: -0.11, parent: mit });
    L.B(0.1, 0.13, 0.1, skinM, { r: 0.045, x: -side * 0.08, y: -0.06, z: 0.13, parent: mit });
    const hand = new THREE.Group(); hand.position.set(0, -0.42, 0.04); el.add(hand);
    return { side, p, el, hand, mit };
  };
  const aL = arm(-1), aR = arm(1);
  if (acc.has('watch')) {
    const g = accG('watch', aL.el);
    L.B(0.27, 0.08, 0.29, L.mat(o.watchColor ?? '#3a2a22', { rough: 0.6, felt: 0.3 }), { r: 0.03, y: -0.22, parent: g });
    L.B(0.12, 0.1, 0.04, goldM, { r: 0.03, y: -0.22, z: 0.15, parent: g });
    L.B(0.08, 0.06, 0.02, L.mat('#f3eee4', { felt: 0 }), { r: 0.01, y: -0.22, z: 0.175, parent: g });
  }

  // ---- head ----
  const neckPivot = new THREE.Group(); neckPivot.position.y = TT + 0.06; body.add(neckPivot);
  const head = new THREE.Group(); neckPivot.add(head);
  L.B(HW, HH, HD, skinM, { r: 0.14, y: HH / 2, parent: head });
  for (const s of [-1, 1]) L.B(0.1, 0.24, 0.2, skinM, { r: 0.045, x: s * (HW / 2 + 0.03), y: 0.47, z: -0.02, parent: head });
  const face = new THREE.Group(); face.position.z = HD / 2; head.add(face);
  L.B(0.14, 0.12, 0.1, noseM, { r: 0.05, y: 0.33, z: 0.035, parent: face });
  const lidC = L.mixHex(skin, '#6b2e1a', 0.14), lineC = L.mixHex(skin, '#1e0c06', 0.72);
  const eyes = [];
  const eyeG = new THREE.CircleGeometry(ER, 40);
  for (const side of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(side * EX, EY, 0.012); face.add(e);
    const E = canvasTex(256, 256); E.pal = { lid: lidC, line: lineC, iris: o.eyeColor ?? '#4a2c1a', pupil: '#140c0a' };
    const ball = new THREE.Mesh(eyeG, new THREE.MeshStandardMaterial({ map: E.t, roughness: 0.85 })); ball.scale.set(1, 1.16, 1); e.add(ball);
    const brow = new THREE.Group(); brow.position.set(side * 0.01, 0.25, 0.03); e.add(brow);
    L.B(0.28, 0.075, 0.05, browM, { r: 0.03, parent: brow });
    eyes.push({ side, e, E, brow });
  }
  const M = canvasTex(256, 160); M.ink = L.mixHex(skin, '#2a0c08', 0.82);
  const bearded = hair.beard === 'full' || hair.beard === 'goatee';
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.36), new THREE.MeshStandardMaterial({ map: M.t, transparent: true, alphaTest: 0.05, roughness: 0.8 }));
  mouth.position.set(0, 0.15, bearded ? 0.075 : 0.012); face.add(mouth);
  const cheeks = [];
  const blushM = new THREE.MeshBasicMaterial({ color: L.mixHex(skin, '#ff4f6a', skin === SKIN.ebony || skin === SKIN.deep ? 0.55 : 0.6), map: blushTex(), transparent: true, depthWrite: false, opacity: 0.75 });
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.15), blushM); c.position.set(s * 0.39, 0.28, 0.006); face.add(c); cheeks.push(c); }

  // ---- hair ----
  const hg = new THREE.Group(); head.add(hg);
  const hb = { top: HH + 0.04, w: HW + 0.08, d: HD + 0.08, side: HW / 2 + 0.06 };   // bounds for hats / headphones
  const H = (w, h, d, x, y, z, ex = {}) => L.B(w, h, d, hairM, { r: ex.r ?? 0.08, x, y, z, rx: ex.rx ?? 0, ry: ex.ry ?? 0, rz: ex.rz ?? 0, parent: ex.parent ?? hg });
  const capTop = (th = 0.26) => { H(HW + 0.08, th, HD + 0.08, 0, HH + 0.06 - (0.26 - th) / 2, 0, { r: 0.1 }); hb.top = HH + 0.06 + th / 2 - (0.26 - th) / 2; };
  const back = (h = 0.62) => H(HW + 0.08, h, 0.16, 0, HH - h / 2 + 0.03, -HD / 2 + 0.03);
  const sides = (h = 0.42) => { for (const s of [-1, 1]) H(0.12, h, HD * 0.72, s * (HW / 2 + 0.03), HH - h / 2 + 0.01, -0.12); };
  const swoop = () => { H(HW * 0.6, 0.2, 0.15, -0.22, HH - 0.07, HD / 2 - 0.03, { rz: 0.1 }); H(HW * 0.48, 0.14, 0.15, 0.3, HH - 0.03, HD / 2 - 0.03, { rz: -0.05 }); };
  const st = hair.style;
  let tail = null;
  if (st === 'short') { capTop(); back(); sides(); swoop(); }
  else if (st === 'buzz') {
    capTop(0.12); back(0.5); for (const s of [-1, 1]) H(0.06, 0.32, HD * 0.7, s * (HW / 2 + 0.01), HH - 0.18, -0.12);
    H(HW + 0.04, 0.08, 0.06, 0, HH - 0.07, HD / 2 + 0.0, { r: 0.03 });
  } else if (st === 'slick') {
    capTop(0.22); back(0.55); sides(0.34);
    H(HW * 0.92, 0.3, 0.44, 0, HH + 0.13, HD / 2 - 0.2, { r: 0.14, rx: -0.12 });
    L.B(0.12, 0.05, HD * 0.7, L.mat(L.mixHex(hair.color, '#ffffff', 0.35), { rough: 0.4, felt: 0.3 }), { r: 0.02, x: 0.22, y: HH + 0.29, z: -0.05, parent: hg });
    hb.top = HH + 0.3;
  } else if (st === 'long' || st === 'bob') {
    capTop();
    const long = st === 'long';
    const bh = long ? HH + 0.45 : HH * 0.72;
    H(HW + 0.14, bh, 0.22, 0, HH + 0.08 - bh / 2, -HD / 2 + 0.02, { r: 0.1 });
    const sh = long ? HH * 0.95 : HH * 0.66;
    for (const s of [-1, 1]) H(0.17, sh, long ? HD * 0.6 : HD * 0.82, s * (HW / 2 + 0.07), HH - sh / 2 + 0.02, long ? -0.08 : -0.02, { r: 0.08 });
    if (long) { for (const s of [-1, 1]) H(HW * 0.56, 0.2, 0.15, s * 0.27, HH - 0.06, HD / 2 - 0.03, { rz: -s * 0.2 }); }
    else H(HW + 0.06, 0.22, 0.16, 0, HH - 0.07, HD / 2 - 0.02, { r: 0.07 });
    hb.side = HW / 2 + 0.16; hb.w = HW + 0.16;
  } else if (st === 'bun' || st === 'ponytail') {
    capTop(); back(); sides();
    for (const s of [-1, 1]) H(HW * 0.55, 0.16, 0.14, s * 0.28, HH - 0.04, HD / 2 - 0.03, { rz: -s * 0.12 });
    if (st === 'bun') {
      H(0.52, 0.44, 0.48, 0, HH + 0.32, -0.16, { r: 0.2 });
      L.B(0.42, 0.08, 0.4, L.mat(o.hairTieColor ?? '#e0674c'), { r: 0.03, y: HH + 0.14, z: -0.16, parent: hg });
    } else {
      L.B(0.26, 0.16, 0.14, L.mat(o.hairTieColor ?? '#e0674c'), { r: 0.05, y: HH - 0.12, z: -HD / 2 - 0.06, parent: hg });
      tail = new THREE.Group(); tail.position.set(0, HH - 0.12, -HD / 2 - 0.1); hg.add(tail);
      H(0.3, 0.72, 0.26, 0, -0.32, -0.06, { r: 0.12, rx: -0.12, parent: tail });
    }
  } else if (st === 'curly' || st === 'afro') {
    const k = st === 'afro' ? 1 : 0;
    const pw = HW + 0.3 + k * 0.3, ph = 0.62 + k * 0.3, pd = HD + 0.24 + k * 0.26;
    H(pw, ph, pd, 0, HH - 0.12 + ph / 2, -0.06 - k * 0.06, { r: 0.24 + k * 0.08 });
    for (const s of [-1, 1]) H(0.26 + k * 0.12, 0.62, HD * 0.78, s * (HW / 2 + 0.08 + k * 0.08), HH - 0.28, -0.14, { r: 0.12 });
    H(HW + 0.24, 0.7, 0.3, 0, HH - 0.3, -HD / 2 - 0.04, { r: 0.12 });
    // curls: little rounded cubes on the puff surface (deterministic)
    const R = L.rng(seed * 31 + 7), cm = hairM;
    const n = st === 'afro' ? 30 : 24;
    for (let i = 0; i < n; i++) {
      const u = R(), v = R(), cs = 0.2 + R() * 0.1;
      let x, y, z;
      if (i < n * 0.4) { x = (u - 0.5) * (pw - 0.15); y = HH - 0.1 + 0.02; z = HD / 2 + 0.02 + k * 0.08 - 0.04 * R(); y += v * 0.12; }      // front edge (fringe)
      else { x = (u - 0.5) * (pw - 0.2); z = (v - 0.5) * (pd - 0.2) - 0.06; y = HH - 0.12 + ph - 0.04; }                                        // top
      L.B(cs, cs, cs, cm, { r: cs * 0.42, x, y, z, rx: R(), ry: R(), parent: hg });
    }
    hb.top = HH - 0.12 + ph + 0.05; hb.w = pw; hb.d = pd; hb.side = HW / 2 + 0.2 + k * 0.14;
  } else if (st === 'bald') {
    H(HW + 0.04, 0.28, 0.1, 0, HH * 0.56, -HD / 2 + 0.0, { r: 0.04 });
    for (const s of [-1, 1]) H(0.08, 0.26, HD * 0.5, s * (HW / 2 + 0.01), HH * 0.58, -0.2, { r: 0.03 });
    hb.top = HH; hb.w = HW + 0.02; hb.d = HD + 0.02; hb.side = HW / 2 + 0.03;
  }
  // facial hair
  const bz = HD / 2;
  if (hair.beard === 'stubble') {
    const sm = L.mat(L.mixHex(hair.beardColor ?? hair.color, skin, 0.55), { rough: 1, scale: 2.5 });
    L.B(HW * 0.82, 0.34, 0.02, sm, { r: 0.01, y: 0.15, z: bz + 0.002, parent: face.parent === head ? head : head });
  }
  if (hair.beard === 'moustache' || hair.beard === 'goatee' || hair.beard === 'full') {
    L.B(0.38, 0.09, 0.08, beardM, { r: 0.04, y: 0.26, z: bz + 0.04 + (bearded ? 0.03 : 0), parent: head });
  }
  if (hair.beard === 'goatee') L.B(0.26, 0.2, 0.12, beardM, { r: 0.06, y: 0.0, z: bz + 0.02, parent: head });
  if (hair.beard === 'full') {
    L.B(HW * 0.74, 0.24, 0.16, beardM, { r: 0.08, y: -0.02, z: bz - 0.02, parent: head });
    for (const s of [-1, 1]) L.B(0.18, 0.46, HD * 0.62, beardM, { r: 0.08, x: s * (HW / 2 - 0.06), y: 0.17, z: 0.08, parent: head });
  }

  // ---- top group (custom hats sit on the hair) + built-in headwear ----
  const top = new THREE.Group(); top.position.y = hb.top; head.add(top);
  const hatC = o.hatColor ?? '#3a5bd0';
  if (acc.has('beanie')) {
    const g = accG('beanie', head), bm = L.mat(hatC, { rough: 1, scale: 2.2 }), cm = L.mat(darker(hatC, 0.15), { rough: 1, scale: 2.2 });
    const w = Math.max(HW + 0.18, hb.w + 0.06), d = Math.max(HD + 0.18, hb.d + 0.06), y0 = HH - 0.08, h = Math.max(0.5, hb.top - y0 + 0.12);
    L.B(w - 0.06, h, d - 0.06, bm, { r: 0.2, y: y0 + h / 2, parent: g });
    L.B(w, 0.2, d, cm, { r: 0.08, y: y0 + 0.02, parent: g });
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), L.mat(o.pomColor ?? '#f3eee4', { rough: 1, scale: 3 })); pom.position.y = y0 + h + 0.08; pom.castShadow = true; g.add(pom);
  }
  if (acc.has('cap')) {
    const g = accG('cap', head), cm = L.mat(hatC);
    const w = Math.max(HW + 0.1, hb.w + 0.02) * 0.96, d = Math.max(HD + 0.1, hb.d + 0.02) * 0.94, y0 = Math.max(HH - 0.02, hb.top - 0.3);
    L.B(w, 0.38, d, cm, { r: 0.17, y: y0 + 0.17, parent: g });
    L.B(0.98, 0.06, 0.56, cm, { r: 0.03, y: y0 + 0.03, z: d / 2 + 0.2, rx: 0.06, parent: g });
    L.B(0.12, 0.06, 0.12, L.mat(darker(hatC, 0.25)), { r: 0.03, y: y0 + 0.38, parent: g });
    if (o.capBadge) L.B(0.26, 0.2, 0.03, L.mat(o.capBadge), { r: 0.04, y: y0 + 0.2, z: d / 2 + 0.005, parent: g });
  }
  const cupX = Math.max(HW / 2 + 0.12, hb.side + 0.1);
  const band = (g, m, th) => {
    const R = cupX, topY = (acc.has('beanie') || acc.has('cap')) ? Math.max(hb.top, HH + 0.4) + 0.06 : hb.top + 0.04;
    // blocky band: two side straps + a top strap with soft corners (follows the hair volume)
    const w = th * 2.2, sh = topY - 0.56;
    for (const s of [-1, 1]) {
      L.B(w, sh, w * 1.6, m, { r: w * 0.4, x: s * R, y: 0.56 + sh / 2 - 0.06, z: -0.02, parent: g });
      L.B(w * 2.2, w, w * 1.6, m, { r: w * 0.4, x: s * (R - w * 0.5), y: topY - 0.05, z: -0.02, rz: s * 0.5, parent: g });
    }
    L.B(2 * R - w * 1.6, w, w * 1.6, m, { r: w * 0.4, y: topY, z: -0.02, parent: g });
  };
  if (acc.has('headphones')) {
    const g = accG('headphones', head), m = L.mat(o.phonesColor ?? '#2b2b33', { rough: 0.5, felt: 0.4 }), cu = L.mat(o.cushionColor ?? '#e0674c', { rough: 0.95, scale: 2 });
    band(g, m, 0.075);
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.2, 24).rotateZ(Math.PI / 2), m); c.position.set(s * (cupX + 0.06), 0.48, -0.02); c.castShadow = true; g.add(c);
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20).rotateZ(Math.PI / 2), cu); k.position.set(s * (cupX - 0.06), 0.48, -0.02); g.add(k);
    }
  }
  if (acc.has('headset')) {
    const g = accG('headset', head), m = L.mat(o.phonesColor ?? '#2b2b33', { rough: 0.5, felt: 0.4 });
    band(g, m, 0.05);
    for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 20).rotateZ(Math.PI / 2), m); c.position.set(s * (cupX + 0.03), 0.48, -0.02); c.castShadow = true; g.add(c); }
    const a = new THREE.Vector3(-(cupX + 0.08), 0.42, 0.05), b = new THREE.Vector3(-0.62, 0.16, HD / 2 + 0.06), c = new THREE.Vector3(-0.26, 0.15, HD / 2 + 0.12);
    for (const [p, q] of [[a, b], [b, c]]) { const len = p.distanceTo(q), mm = L.B(0.05, 0.05, len, m, { r: 0.02, parent: g }); mm.position.copy(p).add(q).multiplyScalar(0.5); mm.lookAt(q); }
    const foam = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), L.mat('#1c1b22', { rough: 1, scale: 3 })); foam.position.copy(c); foam.scale.set(1.3, 1, 1); g.add(foam);
  }
  if (acc.has('glasses')) {
    const g = accG('glasses', face), gm = L.mat(o.glassesColor ?? '#1b1b1f', { rough: 0.4, felt: 0.2 }), z = 0.06;
    const lens = new THREE.MeshStandardMaterial({ color: '#d8ecff', transparent: true, opacity: 0.07, roughness: 0.1, depthWrite: false });
    for (const s of [-1, 1]) {
      const x = s * EX;
      if ((o.glassesStyle ?? 'round') === 'round') {
        const r = new THREE.Mesh(new THREE.TorusGeometry(ER + 0.05, 0.03, 8, 30), gm); r.position.set(x, EY, z); r.scale.y = 1.12; g.add(r);
      } else {
        const w = ER * 2 + 0.12, h = ER * 2.3 + 0.08;
        L.B(w, 0.05, 0.05, gm, { r: 0.02, x, y: EY + h / 2, z, parent: g }); L.B(w, 0.05, 0.05, gm, { r: 0.02, x, y: EY - h / 2, z, parent: g });
        L.B(0.05, h, 0.05, gm, { r: 0.02, x: x - w / 2, y: EY, z, parent: g }); L.B(0.05, h, 0.05, gm, { r: 0.02, x: x + w / 2, y: EY, z, parent: g });
      }
      if (o.lenses) { const pl = new THREE.Mesh(new THREE.CircleGeometry(ER + 0.04, 24), lens); pl.position.set(x, EY, z); pl.scale.y = 1.12; g.add(pl); }
      L.B(0.04, 0.04, HD * 0.55, gm, { r: 0.015, x: s * (HW / 2 + 0.02), y: EY + 0.06, z: -HD * 0.27, parent: g });
      L.B(0.16, 0.04, 0.04, gm, { r: 0.015, x: s * (HW / 2 - 0.06), y: EY + 0.06, z, parent: g });
    }
    L.B(0.12, 0.035, 0.04, gm, { r: 0.015, y: EY + 0.04, z, parent: g });
  }
  if (acc.has('earrings')) {
    const g = accG('earrings', head), em = L.mat(o.earringColor ?? '#e0b24a', { rough: 0.3, metal: 0.6, felt: 0 });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), em); e.position.set(s * (HW / 2 + 0.05), 0.32, 0.0); g.add(e); }
  }

  const _q = new THREE.Quaternion();
  const height = LEG + TT + 0.06 + Math.max(hb.top, acc.has('beanie') ? HH + 0.55 : 0, acc.has('cap') ? HH + 0.4 : 0);
  const poseArm = (a, raise, reach, elbow, bend, twist) => {
    a.p.rotation.set(rad(-reach), rad(twist * a.side), rad(raise * a.side));
    a.el.rotation.set(rad(-elbow), 0, rad(bend * a.side));
    a.p.updateMatrix(); a.el.updateMatrix();
    a.hand.quaternion.copy(_q.copy(a.p.quaternion).multiply(a.el.quaternion).invert());
  };

  const m = {
    group, rig, body, head, face, top, acc: A, arms: { L: aL.p, R: aR.p }, elbows: { L: aL.el, R: aR.el }, hands: { L: aL.hand, R: aR.hand },
    legs: { L: legs[0], R: legs[1] }, eyes, mats: { skin: skinM, top: topM, pants: pantsM, hair: hairM }, height, opts: { hgt, wd, LEG, TT, HH, HD },
    set(p = {}) {
      const ex = typeof p.expr === 'object' ? { ...EXPR.neutral, ...p.expr } : (EXPR[p.expr ?? 'neutral'] ?? EXPR.neutral);
      const sq = p.squash ?? 0, w = p.walk, tt = p.t ?? 0;
      const ws = w === undefined ? 0 : Math.sin(w * Math.PI * 2);
      rig.position.y = Math.max(0, p.hop ?? 0) + (w === undefined ? 0 : Math.abs(Math.cos(w * Math.PI * 2)) * 0.06);
      rig.scale.set(1 + 0.2 * sq, 1 - 0.35 * sq, 1 + 0.2 * sq);
      rig.rotation.set(rad(p.lean ?? 0), rad(p.turn ?? 0), rad(-(p.tilt ?? 0)));
      const lx = p.lookX ?? 0, ly = p.lookY ?? 0;
      body.rotation.set(rad((p.nod ?? 0) * 0.25), rad(lx * 6), 0);
      head.rotation.set(rad((p.nod ?? 0) * 0.75 - ly * 10), rad(lx * 22), rad(-(p.headTilt ?? 0)));
      legs[0].rotation.x = rad(ws * 30); legs[1].rotation.x = rad(-ws * 30);
      if (tail) tail.rotation.set(rad(8 + (p.hop ?? 0) * 25 + Math.sin(tt * 5) * 4), 0, rad(Math.sin(tt * 3.1 + (w ?? 0) * 6.28) * 8));
      // arms
      const cr = clamp(p.cross ?? 0);
      for (const a of [aL, aR]) {
        const S = a.side > 0 ? 'R' : 'L';
        let raise = p['arm' + S] ?? 6, reach = (p['reach' + S] ?? 0) - ws * a.side * 22, elbow = p['elbow' + S] ?? 8, bend = 0, twist = 0;
        const wv = clamp(p['wave' + S] ?? 0);
        if (wv > 0) { raise = lerp(raise, 112, wv); elbow = lerp(elbow, 6, wv); bend = wv * (58 + 24 * Math.sin(tt * 14 + (a.side > 0 ? 0 : 1.7))); }
        if (cr > 0) { raise = lerp(raise, 8, cr); reach = lerp(reach, 62, cr); elbow = lerp(elbow, 0, cr); bend = lerp(bend, -(a.side > 0 ? 100 : 92), cr); twist = lerp(0, -8, cr); }
        poseArm(a, raise, reach, elbow, bend, twist);
      }
      if (cr > 0.5) { aL.p.position.z = 0.04; aR.p.position.z = -0.02; } else { aL.p.position.z = aR.p.position.z = 0; }
      // face
      const bl = clamp(p.blink ?? 0), es = p.eye ?? ex.eye;
      const browA = p.brow ?? ex.brow;
      for (const e of eyes) {
        e.e.scale.setScalar(es);
        const wink = ex.wink && e.side === 1;
        const closed = wink ? 2 : (bl > 0.85 ? 1 : 0);
        drawEye(e.E, { top: lerp(ex.top, 1.0, bl), ang: ex.ang * (1 - bl), low: ex.low * (1 - bl), pr: ex.pr, lx, ly: ly + ex.ly, closed }, e.side);
        e.brow.position.y = 0.25 + ex.by + (wink ? -0.03 : 0) + (es - 1) * 0.12;
        e.brow.rotation.z = rad(browA) * e.side;
      }
      drawMouth(M, p.mouth ?? ex.mouth, clamp(p.talk ?? 0));
      const ck = ex.cheek ?? 1; for (const c of cheeks) c.scale.set(ck, ck, 1);
      return m;
    },
    holdR(obj, off = [0, 0, 0]) { aR.hand.add(obj); obj.position.set(...off); return obj; },
    holdL(obj, off = [0, 0, 0]) { aL.hand.add(obj); obj.position.set(...off); return obj; },
    focus(out = new THREE.Vector3()) { face.updateWorldMatrix(true, false); return face.localToWorld(out.set(0, EY - 0.05, 0.1)); },
    handWorld(side = 'R', out = new THREE.Vector3()) { return (String(side).toUpperCase() === 'L' ? aL : aR).hand.getWorldPosition(out); },
  };
  m.set({});
  return m;
}

// ---- makeActor: a person in a scaled wrapper, with mouth / mouthOpen / brow shortcuts ----
const MOUTH2EXPR = { teeth: 'happy', smile: 'neutral', flat: 'neutral', none: 'neutral', o: 'shock', frown: 'sad' };
const MOUTH2SHAPE = { teeth: 'teeth', smile: 'smile', flat: 'flat', none: 'smile', o: 'o', frown: 'frown' };
export function makeActor(ctx, o = {}) {
  const p = makePerson(ctx, o);
  const S = o.scale ?? 0.93;
  const outer = new THREE.Group(); p.group.scale.setScalar(S); outer.add(p.group);
  let mouth = o.mouth ?? 'smile';
  const base = p.set.bind(p);
  const c = {
    ...p, group: outer, person: p, height: p.height * S,
    set(q = {}) {
      const mm = q.mouth ?? mouth, b = q.brow ?? 0;
      const r = { ...q, talk: q.talk ?? (q.mouthOpen ?? 0), t: q.t ?? (q.walk ?? 0) };
      if (!q.expr) {
        const ex = { ...EXPR[MOUTH2EXPR[mm] ?? 'neutral'] };
        if (b > 6) Object.assign(ex, { brow: b, ang: Math.min(26, b), top: Math.max(ex.top, 0.28) });
        else if (b < -6) Object.assign(ex, { brow: b, ang: Math.max(-24, b), top: Math.max(ex.top, 0.2) });
        r.expr = ex; r.mouth = MOUTH2SHAPE[mm] ?? mm;
      }
      delete r.brow; delete r.mouthOpen;
      base(r); return c;
    },
    setMouth(mm) { mouth = mm; c.set({}); },
  };
  c.set({});
  return c;
}

// ---- the cast: 10 named presets ----
export const PEOPLE = {
  marco: { skin: SKIN.olive, height: 1.04, build: 'round', eyeColor: '#3a2416', seed: 4,
    hair: { style: 'curly', color: '#3a2418', beard: 'full', beardColor: '#3a2418' },
    outfit: { top: 'apron', color: '#f3eee4', apron: '#c8423a', pants: '#3b3a48', shoes: '#5a3a26' },
    accessories: ['watch', 'cap'], capColor: '#c8423a', watchColor: '#e0b24a' },
  alex: { skin: SKIN.tan, height: 1.0, build: 'regular', eyeColor: '#3b2414', seed: 4,
    hair: { style: 'curly', color: HAIR.brown, beard: 'stubble' },
    outfit: { top: 'apron', color: '#e9603f', apron: '#2f6b4f', pants: '#2e3a5a', shoes: '#f3eee4' },
    accessories: ['watch'], watchColor: '#2b2b33' },
  sam: { skin: SKIN.olive, height: 0.98, build: 'slim', eyeColor: '#3a2416', seed: 4,
    hair: { style: 'curly', color: HAIR.black },
    outfit: { top: 'raincoat', color: '#f2c230', pants: '#2e3550', shoes: '#f3eee4', neck: 'scarf', neckColor: '#d8433a' },
    accessories: ['watch'], watchColor: '#27335e' },
  kai: { skin: SKIN.olive, height: 1.0, build: 'slim', eyeColor: '#3a2416', seed: 2,
    hair: { style: 'short', color: HAIR.black },
    outfit: { top: 'hoodie', color: '#2e9e8f', pants: '#2e3550', shoes: '#f3eee4' },
    accessories: ['beanie', 'headphones'], hatColor: '#e8a93a', pomColor: '#e0674c', phonesColor: '#2a2a33', cushionColor: '#e0674c' },
  jordan: { skin: SKIN.deep, height: 1.0, build: 'broad', eyeColor: '#2a160c', seed: 4,
    hair: { style: 'slick', color: HAIR.black },
    outfit: { top: 'suit', color: '#3a4a7a', shirt: '#a9cdee', pants: '#2e3550', shoes: '#3a2418', neck: 'tie', neckColor: '#e0b24a' },
    accessories: ['watch'], watchColor: '#e0b24a' },
  mei: { skin: SKIN.light, height: 0.97, build: 'slim', eyeColor: '#2a1a12', seed: 2,
    hair: { style: 'bun', color: HAIR.black }, hairTieColor: '#e0b24a',
    outfit: { top: 'sweater', color: '#9a3f63', pants: '#2e2a3a', shoes: '#2a1e1a' },
    accessories: ['glasses', 'earrings'], glassesStyle: 'square', glassesColor: '#1d1b22', earringColor: '#e0b24a' },
  zara: { skin: SKIN.brown, height: 0.98, build: 'regular', eyeColor: '#2e1a10', seed: 4,
    hair: { style: 'curly', color: HAIR.black },
    outfit: { top: 'jumpsuit', color: '#7a5bd6', shoes: '#e0674c' },
    accessories: ['glasses', 'earrings'], glassesStyle: 'round', glassesColor: '#e0674c', earringColor: '#f2c84b' },
  jade: { skin: SKIN.light, height: 0.98, build: 'slim', eyeColor: '#3a2416', seed: 2,
    hair: { style: 'long', color: HAIR.black },
    outfit: { top: 'blazer', color: '#e2517f', shirt: '#fff6ea', pants: '#2c2f4a', shoes: '#fff6ea' },
    accessories: ['earrings'], earringColor: '#ffd166' },
  diane: { skin: SKIN.deep, height: 1.05, build: 'slim', eyeColor: '#2a160c', seed: 2,
    hair: { style: 'bob', color: '#b9bdc6', browColor: '#8e9098' },
    outfit: { top: 'suit', color: '#22305f', shirt: '#f6f1e6', pants: '#22305f', shoes: '#1d1a20' },
    accessories: ['earrings'], earringColor: '#f3eee4' },
  grace: { skin: SKIN.ebony, height: 1.0, build: 'regular', eyeColor: '#3a2416', seed: 9,
    hair: { style: 'bob', color: '#d8d3ca', browColor: '#cfc9bf' },
    outfit: { top: 'suit', color: '#b02a3e', shirt: '#f6efe2', pants: '#b02a3e', shoes: '#2a1a16' },
    accessories: ['glasses', 'earrings'], glassesStyle: 'round', glassesColor: '#6a4a2e' },
};

// generic extras for crowds (varied, never a clone of a named person)
const STYLES = ['short', 'long', 'bun', 'ponytail', 'afro', 'bob', 'buzz', 'slick', 'curly', 'bald'];
const HAIRS = [HAIR.black, HAIR.brown, HAIR.chestnut, HAIR.blonde, HAIR.auburn, HAIR.ginger, HAIR.grey, HAIR.black];
const SKINS = [SKIN.tan, SKIN.brown, SKIN.light, SKIN.deep, SKIN.olive, SKIN.fair, SKIN.medium, SKIN.ebony, SKIN.porcelain];
const TOPS = ['shirt', 'sweater', 'hoodie', 'blazer', 'raincoat'];
const COLS = ['#3f6fd8', '#e0674c', '#2e9e8f', '#e8a93a', '#7a5bd6', '#d65a8c', '#4fa36a', '#c8423a', '#5b7fd6'];
export function extraPerson(ctx, seed, o = {}) {
  const k = (n, m) => (seed * m + n) % 9973;
  const style = STYLES[k(1, 7) % STYLES.length];
  return makeActor(ctx, {
    scale: 0.93, seed, skin: SKINS[k(3, 5) % SKINS.length], height: 0.92 + (k(5, 3) % 5) * 0.04,
    build: ['regular', 'slim', 'broad', 'curvy', 'round'][k(2, 11) % 5],
    hair: { style, color: HAIRS[k(4, 13) % HAIRS.length], beard: style === 'bald' || seed % 5 === 0 ? 'full' : 'none' },
    outfit: { top: TOPS[k(6, 17) % TOPS.length], color: COLS[k(7, 19) % COLS.length], pants: '#2e3550', shoes: '#f3eee4' },
    accessories: seed % 4 === 0 ? ['glasses'] : [],
    ...o,
  });
}
export function namedPerson(ctx, who, o = {}) {
  const pr = PEOPLE[who];
  return makeActor(ctx, { scale: 0.93, ...pr, ...o, hair: pr.hair, outfit: pr.outfit, accessories: pr.accessories, skin: pr.skin });
}

// quick crowd block: n extras on a jittered grid behind the origin, facing +Z. set(fn) poses each: fn(i, person) -> set() params
export function makeCrowd(ctx, n = 12, { seed = 100, spacing = 1.9, rows = 3, depth = 1.7 } = {}) {
  const group = new THREE.Group(), R = L.rng(seed), people = [];
  const per = Math.ceil(n / rows);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / per), c = i % per, p = extraPerson(ctx, seed + i * 7 + 1);
    p.group.position.set((c - (per - 1) / 2) * spacing + (r % 2) * spacing * 0.5 + (R() - 0.5) * 0.4, 0, -r * depth + (R() - 0.5) * 0.3);
    p.group.rotation.y = (R() - 0.5) * 0.3; group.add(p.group); people.push(p);
  }
  const out = { group, people, set(fn = () => ({})) { people.forEach((p, i) => p.set(fn(i, p) ?? {})); return out; } };
  return out.set();
}
